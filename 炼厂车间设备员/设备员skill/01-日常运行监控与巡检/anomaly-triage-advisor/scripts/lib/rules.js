'use strict';
/**
 * 设备异常初判规则引擎
 * 口径见 references/fault-patterns-*.md。
 *
 * 核心原则（与 defect-intake-grading 一致，但更严格）：
 *  1. 候选原因只排序、不定论，每条都必须带「需核实」标记与支持依据。
 *  2. 区分依据所需的字段缺失时，该原因项标 undetermined 单列，
 *     **绝不因为缺数据就把某个可能原因从候选里删掉**。
 *  3. 设备类型不在知识库中时只给通用框架，不凭通用知识编造具体原因。
 *  4. 不判读频谱/油液/无损检测的专业结论，只把它们列为建议核实项。
 */

// ---------------------------------------------------------------- 设备类型归一
/**
 * 关键词 → 类型。匹配规则（避免「离心压缩机」被「泵/机」误抢）：
 *   1. 先取出现在字符串**末尾**的关键词（设备名称通常以本体词结尾：「循环氢压缩机电机」→ 电机）；
 *   2. 末尾无命中时取**最长**命中的关键词；
 *   3. 安全阀单列类型 safetyValve，不并入静设备泛类（校验与整定由厂内规定与校验报告为准）。
 */
const TYPE_KEYWORDS = [
  ['safetyValve', ['安全阀', '弹簧式安全阀', '先导式安全阀', '安全泄放阀', 'PSV', 'psv']],
  ['pump', ['离心泵', '往复泵', '柱塞泵', '齿轮泵', '螺杆泵', '屏蔽泵', '磁力泵', '计量泵', '隔膜泵', '真空泵', '液下泵', '泵']],
  ['compressor', ['离心压缩机', '往复压缩机', '螺杆压缩机', '压缩机', '风机', '鼓风机', '引风机', '汽轮机', '透平', '膨胀机', '机组', '大机组']],
  ['static', ['换热器', '冷却器', '再沸器', '空冷器', '空冷', '塔', '容器', '储罐', '罐', '反应器', '管道', '管线', '法兰', '阀门', '调节阀', '截止阀', '闸阀', '球阀', '加热炉']],
  ['electrical', ['电机', '电动机', '马达', '变频器', '配电', '开关柜', '软启', '软启动器', '仪表', '变送器', '流量计', '分析仪', '热电偶', '液位计']],
];
const TYPE_CN = {
  pump: '泵类（离心泵/往复泵）',
  compressor: '机组类（压缩机/风机/汽轮机）',
  static: '静设备类（塔器/容器/换热器/管道/阀门）',
  electrical: '电仪类（电机/变频器/仪表）',
  safetyValve: '安全阀（单列：校验与整定以厂内规定与校验报告为准）',
  generic: '未覆盖类型（仅通用框架）',
};
/** 返回类型键；不认识 → generic，不硬套。末尾词优先，其次最长匹配。 */
function classifyEquipType(v) {
  const s = String(v || '').trim();
  if (!s) return 'generic';
  const hits = [];
  for (const [k, list] of TYPE_KEYWORDS) {
    for (const kw of list) {
      const i = s.lastIndexOf(kw);
      if (i < 0) continue;
      hits.push({ k, kw, len: kw.length, tail: i + kw.length === s.length });
    }
  }
  if (!hits.length) return 'generic';
  hits.sort((a, b) => (b.tail - a.tail) || (b.len - a.len));
  return hits[0].k;
}

// ---------------------------------------------------------------- 现象识别
const SYMPTOM_PATTERNS = [
  ['vibration', /振动|震动|抖动|摆动|晃动/],
  ['noise', /异响|异音|噪音|响声|杂音|敲击|摩擦声|尖叫|啸叫/],
  // 「温度偏高/升高/上升」是现场最常见的说法；「温度偏低」不进温升口径
  ['temperature', /温度(?:有点|有些|略|稍|较|比较|很|非常|太|明显|持续|越来越)?(?:偏高|升高|上升|高)|温升|过热|发烫|发热|高温|超温|温度异常|烫手/],
  ['leak', /泄漏|渗漏|滴漏|漏油|漏气|漏水|漏料|冒油|外漏|窜漏|内漏|串漏/],
  // 内漏/串漏同时进性能类：换热器内漏（SF2）、泵口环内漏（PF2）、压缩机内漏（CF2/CF3）在性能表。
  // 只因内漏类词进性能类时，triage 按设备类型只补对应条目（见 INTERNAL_LEAK_SUPPLEMENT），不并入整张性能表
  ['performance', /流量不足|压力不足|打不上量|出力下降|效率下降|抽空|汽蚀|气蚀|不上量|憋压|压差大|压降大|内漏|窜漏|串漏|串料|互串/],
  ['current', /电流|负荷波动|功率波动|跳闸|过载/],
  ['instrument', /指示不准|示值|偏差|信号|显示异常|无显示|飘移|波动大/],
  ['lubrication', /油位|油压低|油温|乳化|油质|润滑不良|断油/],
];
const INTERNAL_LEAK_RE = /内漏|窜漏|串漏|串料|互串/g;
/** 性能类是否只由内漏类词触发（去掉内漏类词后性能类不再命中）；无文本时返回 false，按原口径并整张性能表 */
function performanceOnlyByInternalLeak(desc) {
  const s = String(desc || '');
  if (!s || !INTERNAL_LEAK_RE.test(s)) return false;
  INTERNAL_LEAK_RE.lastIndex = 0;
  const perf = SYMPTOM_PATTERNS.find((x) => x[0] === 'performance')[1];
  return !perf.test(s.replace(INTERNAL_LEAK_RE, ''));
}
/**
 * 只因内漏类词进性能类时，按设备类型补的性能条目（其余性能条目与内漏无关，不并入，免得压过泄漏表）：
 *   换热器类（换热器/冷却器/冷凝器/再沸器/空冷/管束/管程/壳程）→ SF2；阀门、塔、容器等不补
 *   压缩机/机组 → CF2、CF3；泵 → 仅口环/叶轮/级间内漏语境补 PF2（机封内漏不补）；安全阀、电仪不补
 */
const INTERNAL_LEAK_SUPPLEMENT = {
  static: { ruleIds: ['SF2'], when: /换热|冷却器|冷凝器|再沸器|空冷|管束|管程|壳程/ },
  compressor: { ruleIds: ['CF2', 'CF3'], when: null },
  pump: { ruleIds: ['PF2'], when: /口环|叶轮|级间/ },
};
const SYMPTOM_CN = {
  vibration: '振动偏大', noise: '异响', temperature: '温度异常', leak: '泄漏',
  performance: '性能下降', current: '电流/负荷异常', instrument: '仪表指示异常',
  lubrication: '润滑异常', other: '其他现象',
};
/** 从自由文本里抽出所有命中的现象；一个都没命中返回 ['other'] */
function classifySymptoms(desc) {
  const s = String(desc || '');
  const hit = [];
  for (const [k, re] of SYMPTOM_PATTERNS) if (re.test(s)) hit.push(k);
  return hit.length ? hit : ['other'];
}

// ---------------------------------------------------------------- 辅助字段解析
/** 是否突发：true|false|null（未填 → null） */
function parseSudden(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  if (/^(是|突发|突然|骤然|Y|yes|true|1)/i.test(s)) return true;
  if (/^(否|渐变|逐渐|缓慢|N|no|false|0)/i.test(s)) return false;
  return null;
}
/** 是否影响运行：true|false|null（未填 → null，绝不默认为否） */
function parseAffects(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  if (/^(是|有|会|影响|Y|yes|true|1)/i.test(s)) return true;
  if (/^(否|无|不影响|不|N|no|false|0)/i.test(s)) return false;
  return null;
}
/** 近期是否检修过：true|false|null */
function parseRecentRepair(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  if (/^(是|有|刚|近期|Y|yes|true|1)/i.test(s)) return true;
  if (/^(否|无|没有|N|no|false|0)/i.test(s)) return false;
  return null;
}

// ---------------------------------------------------------------- 证据判定
/**
 * 每条候选原因的区分依据用「证据探针」表达。
 * 探针在 evidence 里查一个字段：
 *   命中          → 'support'（支持）
 *   明确不符      → 'against'（反证）
 *   字段缺失/空   → 'unknown'（未判定，不做任何默认）
 */
const PROBES = {
  // 频谱倍频：只接收用户已给出的结论性描述，脚本自身不判读频谱图
  freq2x: {
    field: 'spectrum', label: '振动频谱以 2 倍频为主',
    test: (v) => (/2\s*倍频|二倍频|2X|2x/.test(v) ? true : /1\s*倍频|一倍频|工频为主|1X/.test(v) ? false : null),
  },
  freq1x: {
    field: 'spectrum', label: '振动频谱以 1 倍频（工频）为主',
    test: (v) => (/1\s*倍频|一倍频|工频为主|1X|1x/.test(v) ? true : /2\s*倍频|二倍频|高频|宽频/.test(v) ? false : null),
  },
  freqHigh: {
    field: 'spectrum', label: '振动频谱含高频或宽带成分',
    test: (v) => (/高频|宽频|宽带|冲击|包络/.test(v) ? true : /工频为主|1\s*倍频|2\s*倍频/.test(v) ? false : null),
  },
  flowFluct: {
    field: 'flowPressure', label: '流量或出口压力波动',
    test: (v) => (/波动|不稳|摆动|跳动/.test(v) ? true : /平稳|稳定|无波动/.test(v) ? false : null),
  },
  suctionLow: {
    field: 'suction', label: '入口压力/罐位偏低或汽化裕量不足',
    test: (v) => (/偏低|不足|低于|下降|抽空/.test(v) ? true : /正常|充足|偏高/.test(v) ? false : null),
  },
  bearingTempUp: {
    field: 'bearingTemp', label: '轴承温度较平时上升',
    test: (v) => (/升高|偏高|上升|超标|高于/.test(v) ? true : /正常|无变化|平稳/.test(v) ? false : null),
  },
  afterRepair: {
    field: 'recentRepair', label: '近期做过检修或复位',
    test: (v) => (/是|有|刚|近期/.test(v) ? true : /否|无|没有/.test(v) ? false : null),
  },
  sudden: {
    field: 'sudden', label: '现象为突发',
    test: (v) => (/是|突发|突然|骤然/.test(v) ? true : /否|渐变|逐渐|缓慢/.test(v) ? false : null),
  },
  gradual: {
    field: 'sudden', label: '现象为渐变',
    test: (v) => (/否|渐变|逐渐|缓慢/.test(v) ? true : /是|突发|突然|骤然/.test(v) ? false : null),
  },
  loadChanged: {
    field: 'load', label: '负荷或工况近期有调整',
    test: (v) => (/调整|提量|降量|变更|切换|变化/.test(v) ? true : /未变|无变化|稳定|正常/.test(v) ? false : null),
  },
  currentUp: {
    field: 'current', label: '电流较平时上升',
    test: (v) => (/升高|偏高|上升|超|大/.test(v) ? true : /正常|无变化|下降|偏低/.test(v) ? false : null),
  },
  oilBad: {
    field: 'oil', label: '油质或油位异常',
    test: (v) => (/乳化|发黑|变质|偏低|不足|进水|杂质/.test(v) ? true : /正常|合格|无异常/.test(v) ? false : null),
  },
  hasHistory: {
    field: 'history', label: '历史上有同类故障记录',
    test: (v) => (v ? true : null),   // 无历史记录 → unknown，不当作反证
  },
  foundationLoose: {
    field: 'foundation', label: '地脚螺栓/底座有松动或二次灌浆开裂',
    test: (v) => (/松动|开裂|脱空|缺失|断裂/.test(v) ? true : /紧固|完好|正常/.test(v) ? false : null),
  },
  noiseCavitation: {
    field: 'symptomText', label: '伴随砾石声/爆裂声等汽蚀特征噪声',
    test: (v) => (/砾石|爆裂|噼啪|碎石|像打石头/.test(v) ? true : null),
  },
  pressureDiffUp: {
    field: 'pressureDiff', label: '压差较投用初期上升',
    test: (v) => (/升高|偏高|上升|增大|超/.test(v) ? true : /正常|无变化|下降/.test(v) ? false : null),
  },
  tempApproachUp: {
    field: 'heatDuty', label: '换热端差扩大或换热量下降',
    test: (v) => (/端差|下降|变差|不足|恶化/.test(v) ? true : /正常|达标|无变化/.test(v) ? false : null),
  },
  insulationLow: {
    field: 'insulation', label: '绝缘电阻偏低',
    test: (v) => (/偏低|下降|不合格|低于/.test(v) ? true : /合格|正常|良好/.test(v) ? false : null),
  },
  threePhaseUnbal: {
    field: 'current', label: '三相电流不平衡',
    test: (v) => (/不平衡|偏差|三相不一致/.test(v) ? true : /平衡|一致|正常/.test(v) ? false : null),
  },
  ventBlocked: {
    field: 'cooling', label: '通风/冷却条件变差',
    test: (v) => (/堵|脏|积灰|不畅|失效|停用/.test(v) ? true : /正常|畅通|良好/.test(v) ? false : null),
  },
  sealFlush: {
    field: 'sealFlush', label: '机封冲洗中断或压差不足',
    test: (v) => (/中断|不足|停|无冲洗|偏低|堵/.test(v) ? true : /正常|投用|达标/.test(v) ? false : null),
  },
  instrumentRecheck: {
    field: 'recheck', label: '现场便携仪器复测结果与在线示值不一致',
    test: (v) => (/不一致|偏差|不符|差异/.test(v) ? true : /一致|相符|无偏差/.test(v) ? false : null),
  },
};

/** 在 evidence 上跑一个探针 → {probe, label, field, verdict:'support'|'against'|'unknown', value} */
function runProbe(name, evidence) {
  const p = PROBES[name];
  if (!p) return { probe: name, label: name, field: null, verdict: 'unknown', value: null };
  const raw = evidence ? evidence[p.field] : null;
  const s = raw === null || raw === undefined ? '' : String(raw).trim();
  if (s === '') return { probe: name, label: p.label, field: p.field, verdict: 'unknown', value: null };
  const t = p.test(s);
  return {
    probe: name, label: p.label, field: p.field,
    verdict: t === true ? 'support' : t === false ? 'against' : 'unknown',
    value: s,
  };
}

// ---------------------------------------------------------------- 候选原因表
/**
 * PATTERNS[设备类型][现象] = [候选原因...]
 * 每条：{ id, cause, mechanism, supports[], againsts[], checks[], ruleId }
 *   supports —— 探针命中即视为支持依据
 *   againsts —— 探针命中即视为反证（该原因可能性下调，但**不删除**）
 *   checks   —— 建议核实项（人工去核，脚本不代判）
 */
const PATTERNS = {
  pump: {
    vibration: [
      { id: 'P-V-01', ruleId: 'PV1', cause: '联轴器不对中', mechanism: '泵与电机轴线偏差，产生周期性交变载荷',
        supports: ['freq2x', 'afterRepair', 'bearingTempUp'], againsts: ['freqHigh'],
        checks: ['冷态/热态对中数据复测（径向、轴向偏差）', '联轴器胶块或膜片是否有磨损、裂纹', '确认近期是否动过泵体、电机或管线'] },
      { id: 'P-V-02', ruleId: 'PV2', cause: '转子动平衡不良', mechanism: '叶轮结垢、磨损或缺块导致质量偏心',
        supports: ['freq1x', 'gradual'], againsts: ['freq2x'],
        checks: ['查是否有叶轮冲刷、结垢或掉块的历史', '记录振动随转速/流量的变化趋势', '如具备条件安排现场动平衡校验（由专业人员实施）'] },
      { id: 'P-V-03', ruleId: 'PV3', cause: '滚动轴承损伤', mechanism: '滚道或滚动体剥落、点蚀，产生高频冲击',
        supports: ['freqHigh', 'bearingTempUp', 'oilBad'], againsts: [],
        checks: ['测听轴承部位有无周期性冲击声', '查轴承润滑油位、油质与加油记录', '如有条件做轴承包络谱检测（结论由诊断人员出具）'] },
      { id: 'P-V-04', ruleId: 'PV4', cause: '汽蚀', mechanism: '入口汽化裕量不足，气泡在叶轮内溃灭',
        supports: ['noiseCavitation', 'suctionLow', 'flowFluct'], againsts: [],
        checks: ['核对入口罐位、入口压力与介质温度', '确认入口过滤器压差是否增大', '核对当前流量是否偏离额定工况点'] },
      { id: 'P-V-05', ruleId: 'PV5', cause: '基础或地脚松动', mechanism: '地脚螺栓松动、二次灌浆开裂造成刚度下降',
        supports: ['foundationLoose', 'gradual'], againsts: [],
        checks: ['逐颗复紧地脚螺栓并做标记', '检查底板与基础之间是否有间隙或灌浆层开裂', '测量泵脚软脚（soft foot）量'] },
      { id: 'P-V-06', ruleId: 'PV6', cause: '转子弯曲', mechanism: '轴受热不均或撞击后产生永久弯曲',
        supports: ['freq1x', 'afterRepair'], againsts: [],
        checks: ['盘车检查轴的径向跳动量', '确认是否有过抽空、急冷急热或异物进入的经历', '查上次解体记录中的轴跳动数据'] },
      { id: 'P-V-07', ruleId: 'PV7', cause: '联轴器本身缺陷', mechanism: '膜片断裂、胶块老化或对中垫片松动',
        supports: ['afterRepair', 'sudden'], againsts: [],
        checks: ['停机后手动检查联轴器元件有无裂纹、缺块', '核对联轴器紧固件力矩', '查联轴器更换记录与使用时长'] },
      { id: 'P-V-08', ruleId: 'PV8', cause: '管线应力传递', mechanism: '进出口管线支吊架失效，把管系应力压到泵口',
        supports: ['afterRepair', 'loadChanged'], againsts: [],
        checks: ['检查进出口管线支吊架是否脱空、弹簧是否到位', '松开泵口法兰观察位移量（需按停机检修流程执行）', '确认管线保温、伴热是否造成热位移'] },
    ],
    noise: [
      { id: 'P-N-01', ruleId: 'PN1', cause: '汽蚀', mechanism: '气泡溃灭产生砾石状噪声',
        supports: ['noiseCavitation', 'suctionLow', 'flowFluct'], againsts: [],
        checks: ['核对入口罐位、入口压力与介质温度', '确认入口过滤器压差是否增大', '核对当前流量是否偏离额定工况点'] },
      { id: 'P-N-02', ruleId: 'PN2', cause: '滚动轴承损伤', mechanism: '滚道剥落产生周期性冲击，伴周期性异响',
        supports: ['freqHigh', 'bearingTempUp'], againsts: [],
        checks: ['测听轴承部位有无周期性冲击声', '查轴承润滑油位、油质与加油记录', '查轴承运行时长与更换记录'] },
      { id: 'P-N-03', ruleId: 'PN3', cause: '动静部件摩擦（口环/机封）', mechanism: '间隙消失后金属摩擦',
        supports: ['afterRepair', 'bearingTempUp'], againsts: [],
        checks: ['查上次解体的口环间隙数据', '确认机封冲洗方案是否正常投用', '观察噪声是否随转速变化'] },
      { id: 'P-N-04', ruleId: 'PN4', cause: '异物进入泵腔', mechanism: '焊渣、垫片碎片等进入流道',
        supports: ['sudden', 'afterRepair'], againsts: [],
        checks: ['确认近期管线是否做过开口作业或吹扫', '检查入口过滤器滤网是否破损', '核对噪声出现时间与检修作业时间'] },
    ],
    temperature: [
      { id: 'P-T-01', ruleId: 'PT1', cause: '润滑不良', mechanism: '油位低、油质劣化或油路不畅导致摩擦热上升',
        supports: ['oilBad', 'bearingTempUp'], againsts: [],
        checks: ['查轴承箱油位、油品牌号与上次换油时间', '确认油冷器投用是否正常、冷却水是否畅通', '观察油是否乳化、发黑或含水'] },
      { id: 'P-T-02', ruleId: 'PT2', cause: '轴承损伤或预紧过大', mechanism: '轴承内部异常接触产生额外热量',
        supports: ['freqHigh', 'bearingTempUp', 'afterRepair'], againsts: [],
        checks: ['同步查看该轴承点的振动数据', '查上次装配的轴承预紧与配合记录', '对比同型号并联泵的轴承温度'] },
      { id: 'P-T-03', ruleId: 'PT3', cause: '机封冲洗失效', mechanism: '冲洗液中断使密封面干摩擦',
        supports: ['sealFlush', 'bearingTempUp'], againsts: [],
        checks: ['确认冲洗管线是否畅通、冲洗压差是否达标', '检查机封腔温度与泄漏情况', '核对冲洗方案（API Plan）是否与介质匹配'] },
      { id: 'P-T-04', ruleId: 'PT4', cause: '小流量运行或憋压', mechanism: '偏离额定工况使泵内能量转为热量',
        supports: ['flowFluct', 'loadChanged'], againsts: [],
        checks: ['核对当前流量与额定流量的比例', '确认最小流量回流线是否投用', '检查出口阀开度与系统背压'] },
    ],
    performance: [
      { id: 'P-F-01', ruleId: 'PF1', cause: '汽蚀或入口汽化', mechanism: '入口条件不足导致排量下降',
        supports: ['suctionLow', 'noiseCavitation', 'flowFluct'], againsts: [],
        checks: ['核对入口罐位、压力与介质温度', '检查入口过滤器压差', '确认入口管线有无气囊或泄漏吸气'] },
      { id: 'P-F-02', ruleId: 'PF2', cause: '叶轮磨损或口环间隙增大', mechanism: '内漏量增加使有效排量下降',
        supports: ['gradual'], againsts: ['sudden'],
        checks: ['查泵累计运行时长与上次解体的口环间隙', '对比当前扬程与性能曲线的偏离量', '确认介质是否含固体颗粒'] },
      { id: 'P-F-03', ruleId: 'PF3', cause: '系统阻力变化', mechanism: '下游堵塞、阀门误关或换热器结垢抬高背压',
        supports: ['loadChanged', 'pressureDiffUp'], againsts: [],
        checks: ['核对出口压力与下游各点压力', '确认沿线阀门开度与联锁状态', '检查下游过滤器或换热器压差'] },
      { id: 'P-F-04', ruleId: 'PF4', cause: '转速下降（驱动端问题）', mechanism: '变频给定变化或电机异常导致转速不足',
        supports: ['currentUp', 'loadChanged'], againsts: [],
        checks: ['核对变频器给定频率与实际输出', '测量电机实际转速', '查电机电流与铭牌值的偏差'] },
    ],
    leak: [
      { id: 'P-L-01', ruleId: 'PL1', cause: '机械密封失效', mechanism: '密封面磨损、开裂或辅助 O 圈老化',
        supports: ['afterRepair', 'bearingTempUp'], againsts: [],
        checks: ['确认泄漏点是在机封腔还是压盖法兰', '核对冲洗方案是否正常投用', '查机封使用时长与更换记录'] },
      { id: 'P-L-02', ruleId: 'PL2', cause: '法兰或垫片密封失效', mechanism: '垫片老化、螺栓松弛或热循环导致松弛',
        supports: ['afterRepair', 'loadChanged'], againsts: [],
        checks: ['确认泄漏点位于哪个法兰、是静密封还是动密封', '核对螺栓紧固力矩与垫片材质', '查是否经历过温度或压力大幅波动'] },
      { id: 'P-L-03', ruleId: 'PL3', cause: '泵体或管件本体减薄穿孔', mechanism: '冲刷、腐蚀造成壁厚不足',
        supports: ['gradual'], againsts: ['sudden'],
        checks: ['查该部位测厚记录与腐蚀回路资料', '确认介质是否含腐蚀性组分或固体颗粒', '安排测厚复测（结论由检测人员出具）'] },
    ],
  },

  compressor: {
    vibration: [
      { id: 'C-V-01', ruleId: 'CV1', cause: '转子不平衡（结垢或叶片损伤）', mechanism: '流道结垢或叶片掉块造成质量偏心',
        supports: ['freq1x', 'gradual'], againsts: ['freq2x'],
        checks: ['查机组水洗/清洗记录与进气过滤效果', '核对振动随负荷变化的规律', '查上次开缸检查的叶轮状况'] },
      { id: 'C-V-02', ruleId: 'CV2', cause: '对中不良或管系应力', mechanism: '机组与驱动机对中偏差、管线推力过大',
        supports: ['freq2x', 'afterRepair'], againsts: [],
        checks: ['核对热态对中数据与膨胀量', '检查进排气管线支吊架与膨胀节状态', '确认基础与台板有无松动'] },
      { id: 'C-V-03', ruleId: 'CV3', cause: '滑动轴承间隙超标或油膜失稳', mechanism: '轴瓦磨损后油膜涡动、油膜振荡',
        supports: ['freqHigh', 'bearingTempUp', 'oilBad'], againsts: [],
        checks: ['核对轴瓦间隙、轴位移与轴振探头数据', '查润滑油压、油温与油质分析送检记录', '确认低频分量是否接近半速（由诊断人员判读）'] },
      { id: 'C-V-04', ruleId: 'CV4', cause: '喘振或旋转失速', mechanism: '流量低于喘振线造成气流周期性倒流',
        supports: ['flowFluct', 'loadChanged', 'currentUp'], againsts: [],
        checks: ['核对当前工作点与喘振线的裕度', '确认防喘振阀动作是否正常', '检查进气温度、分子量是否变化'] },
      { id: 'C-V-05', ruleId: 'CV5', cause: '往复机运动部件松动或间隙超标', mechanism: '十字头、连杆瓦或活塞杆连接松动',
        supports: ['sudden', 'afterRepair'], againsts: [],
        checks: ['检查十字头滑道间隙与活塞杆沉降量', '核对气阀工作状况与各级排温', '确认机身地脚与中体连接螺栓力矩'] },
      { id: 'C-V-06', ruleId: 'CV6', cause: '基础或台板松动', mechanism: '地脚螺栓松动、灌浆层开裂',
        supports: ['foundationLoose', 'gradual'], againsts: [],
        checks: ['复紧地脚螺栓并做标记观察', '检查灌浆层有无脱空、开裂', '测量台板与基础的相对振动'] },
    ],
    noise: [
      { id: 'C-N-01', ruleId: 'CN1', cause: '气阀故障（往复机）', mechanism: '阀片断裂或弹簧失效引起气流冲击声',
        supports: ['sudden'], againsts: [],
        checks: ['测各级气阀阀盖温度，找异常高的那一级', '核对各级排气温度与压力与基准值偏差', '查气阀使用时长与上次更换记录'] },
      { id: 'C-N-02', ruleId: 'CN2', cause: '喘振', mechanism: '气流周期性倒流产生沉闷轰鸣',
        supports: ['flowFluct', 'loadChanged'], againsts: [],
        checks: ['核对工作点与喘振线裕度', '确认防喘振回流阀是否正常动作', '记录噪声与流量波动是否同步'] },
      { id: 'C-N-03', ruleId: 'CN3', cause: '动静摩擦或异物', mechanism: '密封齿、隔板与转子摩擦',
        supports: ['afterRepair', 'sudden'], againsts: [],
        checks: ['核对轴位移与胀差数据', '确认进气过滤器是否破损', '查上次开缸的动静间隙记录'] },
    ],
    temperature: [
      { id: 'C-T-01', ruleId: 'CT1', cause: '级间冷却效果下降', mechanism: '中间冷却器结垢或冷却水不足',
        supports: ['pressureDiffUp', 'tempApproachUp', 'ventBlocked'], againsts: [],
        checks: ['核对各级进出口温度与冷却水进出水温', '检查中间冷却器压差与水侧流量', '确认冷却器是否需要清洗'] },
      { id: 'C-T-02', ruleId: 'CT2', cause: '气阀泄漏（往复机）', mechanism: '阀片密封不严造成级间回流发热',
        supports: ['currentUp'], againsts: [],
        checks: ['逐级测阀盖温度找异常级', '核对各级压比是否偏离设计值', '查气阀更换周期'] },
      { id: 'C-T-03', ruleId: 'CT3', cause: '轴承或润滑异常', mechanism: '油量不足、油温高或轴瓦磨损',
        supports: ['bearingTempUp', 'oilBad'], againsts: [],
        checks: ['核对润滑油压、油温与油冷器投用情况', '查油质分析送检记录（结论由化验出具）', '同步查看该点振动趋势'] },
      { id: 'C-T-04', ruleId: 'CT4', cause: '入口条件变化', mechanism: '进气温度升高或分子量变化抬高排温',
        supports: ['loadChanged'], againsts: [],
        checks: ['核对进气温度、压力与组分分析数据', '确认上游工艺是否有调整', '对比同工况历史排温'] },
    ],
    performance: [
      { id: 'C-F-01', ruleId: 'CF1', cause: '流道结垢或叶轮磨损', mechanism: '通流面积变化导致效率下降',
        supports: ['gradual', 'pressureDiffUp'], againsts: ['sudden'],
        checks: ['对比当前性能曲线与出厂曲线', '查进气过滤器压差与清洗记录', '确认介质是否带液或带粉尘'] },
      { id: 'C-F-02', ruleId: 'CF2', cause: '气阀或活塞环泄漏（往复机）', mechanism: '级间内漏使排量下降',
        supports: ['currentUp'], againsts: [],
        checks: ['测各级阀盖温度与排温', '核对各级压比', '查活塞杆沉降量与环的使用时长'] },
      { id: 'C-F-03', ruleId: 'CF3', cause: '密封齿磨损内漏', mechanism: '迷宫密封间隙增大造成内部回流',
        supports: ['gradual', 'afterRepair'], againsts: [],
        checks: ['核对密封气压力与流量', '查上次开缸的密封齿间隙记录', '确认是否有过喘振或摩擦经历'] },
    ],
  },

  static: {
    leak: [
      { id: 'S-L-01', ruleId: 'SL1', cause: '法兰垫片失效', mechanism: '垫片老化、螺栓松弛或热循环导致密封失效',
        supports: ['afterRepair', 'loadChanged'], againsts: [],
        checks: ['确认泄漏点在法兰面、螺栓孔还是本体', '核对垫片材质与介质、温度的匹配性', '查该法兰是否经历过温度或压力大幅波动'] },
      { id: 'S-L-02', ruleId: 'SL2', cause: '壁厚减薄穿孔', mechanism: '腐蚀或冲刷使局部壁厚不足',
        supports: ['gradual'], againsts: ['sudden'],
        checks: ['查该点测厚记录与腐蚀回路资料', '核对介质腐蚀性组分与流速', '安排测厚复测（数据由检测人员出具）'] },
      { id: 'S-L-03', ruleId: 'SL3', cause: '焊缝或接管根部开裂', mechanism: '应力集中或疲劳裂纹扩展',
        supports: ['sudden', 'afterRepair'], againsts: [],
        checks: ['确认泄漏点是否位于焊缝或接管根部', '查该部位有无振动源或热应力', '安排无损检测（结论由检测人员出具）'] },
      { id: 'S-L-04', ruleId: 'SL4', cause: '阀门填料或阀盖泄漏', mechanism: '填料老化、压盖松弛',
        supports: ['afterRepair'], againsts: [],
        checks: ['确认泄漏点是填料函还是阀体', '核对填料材质与更换记录', '检查阀杆有无划伤、锈蚀'] },
    ],
    performance: [
      { id: 'S-F-01', ruleId: 'SF1', cause: '换热器结垢或堵塞', mechanism: '污垢热阻上升、通道堵塞',
        supports: ['pressureDiffUp', 'tempApproachUp', 'gradual'], againsts: ['sudden'],
        checks: ['核对壳程/管程进出口温度与端差变化', '对比压差与投用初期的差值', '查上次清洗时间与介质结垢倾向'] },
      { id: 'S-F-02', ruleId: 'SF2', cause: '内漏（管束穿孔或内件损坏）', mechanism: '两侧介质串混',
        supports: ['sudden', 'pressureDiffUp'], againsts: [],
        checks: ['取样化验两侧介质是否串混（结论由化验出具）', '核对两侧压力的相对关系', '安排停用后打压试漏'] },
      { id: 'S-F-03', ruleId: 'SF3', cause: '过滤器或塔盘堵塞', mechanism: '固体杂质、结焦或积液堵塞流道',
        supports: ['pressureDiffUp', 'loadChanged'], againsts: [],
        checks: ['核对过滤器或塔段压差趋势', '确认上游是否有过带料、带水或催化剂跑损', '查清洗、切换记录'] },
      { id: 'S-F-04', ruleId: 'SF4', cause: '工艺条件变化', mechanism: '负荷、组分或温度变化引起表观性能变化',
        supports: ['loadChanged'], againsts: [],
        checks: ['核对负荷、进料组分与操作温度的变化', '对比同负荷下的历史数据', '与工艺员确认是否为正常工况差异'] },
    ],
    vibration: [
      { id: 'S-V-01', ruleId: 'SV1', cause: '管线振动（气流/液流脉动）', mechanism: '压缩机或泵的脉动激励管系共振',
        supports: ['loadChanged', 'flowFluct'], againsts: [],
        checks: ['确认振动是否随机组负荷或转速变化', '检查支吊架、限位是否失效', '核对是否有相邻机组同时运行'] },
      { id: 'S-V-02', ruleId: 'SV2', cause: '阀门内件抖动或闪蒸', mechanism: '大压降下的汽蚀、闪蒸引起阀件振动',
        supports: ['flowFluct', 'pressureDiffUp'], againsts: [],
        checks: ['核对阀前后压差与开度', '确认介质是否接近饱和温度', '检查阀笼、阀芯有无冲刷痕迹'] },
      { id: 'S-V-03', ruleId: 'SV3', cause: '支吊架失效', mechanism: '弹簧支架卡死、脱空使管系约束改变',
        supports: ['foundationLoose', 'gradual'], againsts: [],
        checks: ['沿线逐个检查支吊架是否脱空、弹簧是否到位', '核对保温与伴热是否改变热位移', '确认近期是否做过管线改造'] },
    ],
    temperature: [
      { id: 'S-T-01', ruleId: 'ST1', cause: '保温层破损或失效', mechanism: '散热增加导致外壁温度升高',
        supports: ['ventBlocked'], againsts: [],
        checks: ['检查保温层有无破损、进水、脱落', '核对外壁温度分布是否局部异常', '确认是否存在保温层下腐蚀风险'] },
      { id: 'S-T-02', ruleId: 'ST2', cause: '衬里或耐火层损坏', mechanism: '内衬脱落造成壳体超温',
        supports: ['sudden', 'ventBlocked'], againsts: [],
        checks: ['用测温枪扫描壳体温度场找热点', '查衬里施工与上次检查记录', '安排红外热像普查（结论由检测人员出具）'] },
      { id: 'S-T-03', ruleId: 'ST3', cause: '工艺温度本身升高', mechanism: '上游操作变化传导至该设备',
        supports: ['loadChanged'], againsts: [],
        checks: ['核对上下游工艺温度的联动关系', '与工艺员确认是否为操作调整', '对比同工况历史温度'] },
    ],
  },

  electrical: {
    temperature: [
      { id: 'E-T-01', ruleId: 'ET1', cause: '过载运行', mechanism: '负载超出电机能力，铜损铁损增大',
        supports: ['currentUp', 'loadChanged'], againsts: [],
        checks: ['核对实测电流与铭牌额定电流', '确认被驱动设备负荷是否增加（如泵憋压、结垢）', '查历史同工况电流水平'] },
      { id: 'E-T-02', ruleId: 'ET2', cause: '通风散热不良', mechanism: '风扇失效、散热筋积灰或环境温度高',
        supports: ['ventBlocked'], againsts: [],
        checks: ['检查风扇、风罩与散热筋是否积灰堵塞', '核对环境温度与通风条件', '确认是否近期加装了遮挡物'] },
      { id: 'E-T-03', ruleId: 'ET3', cause: '绝缘劣化或匝间短路', mechanism: '局部短路产生附加损耗',
        supports: ['insulationLow', 'threePhaseUnbal'], againsts: [],
        checks: ['测量绝缘电阻与吸收比（由电气人员实施）', '核对三相电流平衡度', '查有无焦糊味或绕组变色'] },
      { id: 'E-T-04', ruleId: 'ET4', cause: '轴承损坏', mechanism: '轴承摩擦热向机壳传导',
        supports: ['bearingTempUp', 'freqHigh', 'oilBad'], againsts: [],
        checks: ['测听轴承部位并同步看振动数据', '查电机加脂周期与脂型号', '对比前后轴承温差'] },
    ],
    current: [
      { id: 'E-C-01', ruleId: 'EC1', cause: '负载侧异常', mechanism: '被驱动设备卡涩、堵塞或工况变化',
        supports: ['loadChanged', 'currentUp'], againsts: [],
        checks: ['核对被驱动设备的流量、压力与温度', '确认出口阀开度与系统背压', '盘车确认转动是否轻快'] },
      { id: 'E-C-02', ruleId: 'EC2', cause: '缺相或三相不平衡', mechanism: '一相断路或接触不良使其余两相电流异常',
        supports: ['threePhaseUnbal'], againsts: [],
        checks: ['测量三相电流与电压平衡度（由电气人员实施）', '检查接线端子、接触器触头有无过热痕迹', '查配电室有无相关报警记录'] },
      { id: 'E-C-03', ruleId: 'EC3', cause: '电机绕组故障', mechanism: '匝间或相间短路改变阻抗',
        supports: ['insulationLow', 'threePhaseUnbal'], againsts: [],
        checks: ['测量绝缘电阻与直流电阻（由电气人员实施）', '确认有无异味、异响与冒烟', '查该电机的故障与返修历史'] },
      { id: 'E-C-04', ruleId: 'EC4', cause: '变频器参数或供电异常', mechanism: '给定变化、谐波或母线电压波动',
        supports: ['loadChanged', 'flowFluct'], againsts: [],
        checks: ['核对变频器给定、输出频率与故障代码', '查母线电压是否波动', '确认参数是否被改动过'] },
    ],
    vibration: [
      { id: 'E-V-01', ruleId: 'EV1', cause: '电机轴承损伤', mechanism: '滚道剥落产生高频冲击',
        supports: ['freqHigh', 'bearingTempUp'], againsts: [],
        checks: ['测听轴承并记录振动频谱（判读由诊断人员出具）', '查加脂记录与脂的相容性', '对比前后轴承振动值'] },
      { id: 'E-V-02', ruleId: 'EV2', cause: '对中不良', mechanism: '电机与被驱动设备轴线偏差',
        supports: ['freq2x', 'afterRepair'], againsts: [],
        checks: ['复测冷态/热态对中数据', '检查电机底脚垫片与软脚量', '确认近期是否动过机脚或管线'] },
      { id: 'E-V-03', ruleId: 'EV3', cause: '电磁力不平衡（气隙不均/转子断条）', mechanism: '气隙偏心或断条产生电磁激励',
        supports: ['threePhaseUnbal', 'currentUp'], againsts: [],
        checks: ['确认断电瞬间振动是否立即消失（由电气人员配合）', '测量气隙均匀度', '查电机是否有频繁重载启动史'] },
      { id: 'E-V-04', ruleId: 'EV4', cause: '底座或地脚松动', mechanism: '紧固件松动造成支撑刚度下降',
        supports: ['foundationLoose', 'gradual'], againsts: [],
        checks: ['复紧地脚螺栓并做标记', '检查底座与基础之间有无间隙', '测量各机脚振动差异'] },
    ],
    instrument: [
      { id: 'E-I-01', ruleId: 'EI1', cause: '取样或引压管线堵塞/泄漏', mechanism: '一次元件侧通道不畅使示值失真',
        supports: ['gradual'], againsts: [],
        checks: ['检查引压管、导压阀是否堵塞或泄漏', '确认伴热是否正常（冬季易凝介质）', '对比同一工艺点的其他仪表示值'] },
      { id: 'E-I-02', ruleId: 'EI2', cause: '变送器零点漂移或故障', mechanism: '电子元件老化、受潮',
        supports: ['gradual', 'afterRepair'], againsts: [],
        checks: ['查上次校验日期与校验记录', '确认接线盒有无进水、端子有无锈蚀', '联系仪表做现场校验（结论由仪表人员出具）'] },
      { id: 'E-I-03', ruleId: 'EI3', cause: '信号回路或供电干扰', mechanism: '屏蔽接地不良、回路接触不良',
        supports: ['sudden', 'flowFluct'], againsts: [],
        checks: ['检查屏蔽接地与端子紧固情况', '核对 DCS 侧是否有同批次点位一起异常', '确认附近是否有大功率设备启停'] },
      { id: 'E-I-04', ruleId: 'EI4', cause: '工艺本身确实在波动', mechanism: '示值正确，是工艺工况变化',
        supports: ['loadChanged', 'flowFluct'], againsts: [],
        checks: ['与工艺员核对该时段的操作调整', '对比上下游关联点位是否同步变化', '现场就地表与 DCS 示值比对'] },
    ],
  },

  safetyValve: {
    leak: [
      { id: 'V-L-01', ruleId: 'VL1', cause: '阀座密封面损伤或有异物', mechanism: '起跳回座时介质夹带杂质划伤密封面，或密封面本身有缺陷，回座后不严',
        supports: ['sudden', 'afterRepair'], againsts: [],
        checks: ['确认泄漏是阀座内漏（出口侧有介质）还是法兰/阀盖外漏', '查近期是否有起跳记录与起跳后的回座情况', '核对上次校验报告中的密封试验结果（结论以校验报告为准）'] },
      { id: 'V-L-02', ruleId: 'VL2', cause: '运行压力接近整定压力（压差裕量不足）', mechanism: '工作压力与整定压力过近导致阀瓣微启、持续泄漏',
        supports: ['loadChanged', 'flowFluct'], againsts: [],
        checks: ['核对当前系统压力与铭牌/校验报告整定压力的比值', '确认近期工艺是否提压或压力波动', '与工艺员确认操作压力是否在设计范围内'] },
      { id: 'V-L-03', ruleId: 'VL3', cause: '弹簧松弛或整定漂移', mechanism: '弹簧疲劳、腐蚀或调节螺栓松动使整定压力下降',
        supports: ['gradual'], againsts: ['sudden'],
        checks: ['查校验台账：上次校验日期、整定值与下次校验到期（校验周期以厂内规定为准）', '检查铅封是否完好、调节螺栓有无松动痕迹', '安排送校验（整定结果由校验机构出具，本报告不代判）'] },
      { id: 'V-L-04', ruleId: 'VL4', cause: '法兰或阀盖外漏', mechanism: '垫片老化、螺栓松弛或热循环导致外密封失效',
        supports: ['afterRepair', 'loadChanged'], againsts: [],
        checks: ['确认泄漏点在进出口法兰、阀盖还是阀体', '核对垫片材质与螺栓紧固情况', '查该阀是否近期拆装或更换过'] },
    ],
    performance: [
      { id: 'V-F-01', ruleId: 'VF1', cause: '频跳或起跳不回座', mechanism: '进口管线压降过大、背压变化或排放管不畅',
        supports: ['flowFluct', 'loadChanged'], againsts: [],
        checks: ['核对进口管线长度/口径与压降是否符合安装要求', '确认排放管或排放总管有无背压异常、积液', '查起跳记录与同时段系统压力波动'] },
      { id: 'V-F-02', ruleId: 'VF2', cause: '阀瓣卡涩或介质结晶堵塞', mechanism: '介质结晶、结焦或腐蚀产物使阀瓣动作不灵',
        supports: ['gradual'], againsts: [],
        checks: ['确认介质是否易结晶、结焦，伴热与保温是否正常', '查校验台账与上次拆检记录', '安排送校验（结论由校验机构出具）'] },
    ],
  },
};

// ---------------------------------------------------------------- 通用框架（类型未覆盖时）
const GENERIC_FRAME = [
  { id: 'G-01', ruleId: 'G1', cause: '通用框架：运行工况变化', mechanism: '负荷、介质、上下游操作调整引起的表观异常',
    supports: ['loadChanged'], againsts: [],
    checks: ['核对异常出现前后的负荷与工艺参数变化', '与工艺员确认是否有操作调整', '对比同工况的历史数据'] },
  { id: 'G-02', ruleId: 'G2', cause: '通用框架：检修或变更引入的问题', mechanism: '近期检修、复位或改造后未恢复到位',
    supports: ['afterRepair', 'sudden'], againsts: [],
    checks: ['查近期检修、变更与复位记录', '核对复位后的验收数据', '确认现场是否有遗留工具、盲板或临时设施'] },
  { id: 'G-03', ruleId: 'G3', cause: '通用框架：部件自然劣化', mechanism: '磨损、老化、腐蚀等随运行时长累积的劣化',
    supports: ['gradual'], againsts: ['sudden'],
    checks: ['查该设备累计运行时长与上次检修时间', '查历史同类故障记录', '核对定期检测数据的趋势'] },
  { id: 'G-04', ruleId: 'G4', cause: '通用框架：检测或显示侧的问题', mechanism: '测点、仪表或记录本身失真，设备实际未必异常',
    supports: ['instrumentRecheck'], againsts: [],
    checks: ['用便携仪器在现场复测一次', '与同一部位的其他测点比对', '确认测点安装位置与上次是否一致'] },
];

// ---------------------------------------------------------------- 排序打分
/**
 * scoreCandidate(cand, evidence)
 * 返回 {supports[], againsts[], unknowns[], score, likelihood, likelihoodCn, undetermined}
 *
 * 打分只用于**排序**，不构成结论：
 *   支持依据每条 +2，反证每条 -2，未判定探针 0（不加不减，但单列）
 * undetermined 的判定（关键约束）：
 *   该原因的**全部**区分探针都取不到数据 → undetermined=true，
 *   此时仍保留在候选里，只是排在「需补充数据」一列，绝不因缺数据删除。
 */
const LIKELIHOOD_CN = { high: '较高（需核实）', medium: '中等（需核实）', low: '较低（需核实）', undetermined: '未判定（缺数据）' };

function scoreCandidate(cand, evidence) {
  const probes = [...new Set([...(cand.supports || []), ...(cand.againsts || [])])];
  const supportSet = new Set(cand.supports || []);
  const supports = [], againsts = [], unknowns = [];
  for (const name of probes) {
    const r = runProbe(name, evidence);
    if (r.verdict === 'unknown') { unknowns.push(r); continue; }
    // 探针出现在 supports 里：命中算支持，不符算反证；
    // 出现在 againsts 里：命中算反证。
    if (supportSet.has(name)) (r.verdict === 'support' ? supports : againsts).push(r);
    else if (r.verdict === 'support') againsts.push(r);
    else supports.push(r);
  }
  const undetermined = probes.length > 0 && supports.length === 0 && againsts.length === 0;
  const score = supports.length * 2 - againsts.length * 2;
  let likelihood;
  if (undetermined) likelihood = 'undetermined';
  else if (score >= 4) likelihood = 'high';
  else if (score >= 1) likelihood = 'medium';
  else likelihood = 'low';
  return {
    supports, againsts, unknowns, score,
    likelihood, likelihoodCn: LIKELIHOOD_CN[likelihood], undetermined,
  };
}

/**
 * triage({equipType, symptoms, evidence})
 * 返回 {typeKey, typeCn, covered, candidates[], undetermined[], notes[]}
 * covered=false 时只给 GENERIC_FRAME，并由调用方补 warning。
 */
function triage({ equipType, symptoms, evidence, symptomText }) {
  const typeKey = classifyEquipType(equipType);
  const table = PATTERNS[typeKey];
  const covered = !!table;
  const syms = (symptoms && symptoms.length ? symptoms : ['other']);
  // 性能类只由内漏类词触发 → 性能表按设备类型只取对应条目
  let perfFilter = null;
  if (syms.includes('performance') && performanceOnlyByInternalLeak(symptomText)) {
    const sup = INTERNAL_LEAK_SUPPLEMENT[typeKey];
    const ctx = `${equipType || ''} ${symptomText || ''}`;
    perfFilter = new Set(sup && (!sup.when || sup.when.test(ctx)) ? sup.ruleIds : []);
  }

  const raw = [];
  const seenId = new Set();
  const byCause = new Map();
  if (covered) {
    for (const s of syms) {
      const list = table[s];
      if (!list) continue;
      for (const c of list) {
        if (s === 'performance' && perfFilter && !perfFilter.has(c.ruleId)) continue;
        if (seenId.has(c.id)) continue;
        seenId.add(c.id);
        // 同一原因在多个现象表里都出现（如「滚动轴承损伤」既在振动也在异响表）：
        // 只保留一条，把另一现象并入 symptomCn，避免候选表里出现重复原因。
        const dup = byCause.get(c.cause);
        if (dup) {
          if (!dup.symptomList.includes(s)) {
            dup.symptomList.push(s);
            dup.symptomCn = dup.symptomList.map((x) => SYMPTOM_CN[x] || x).join('、');
            // 合并两条的探针与核实项，保留并集
            dup.supports = [...new Set([...dup.supports, ...(c.supports || [])])];
            dup.againsts = [...new Set([...dup.againsts, ...(c.againsts || [])])];
            dup.checks = [...new Set([...dup.checks, ...c.checks])];
            dup.alsoRuleIds = [...new Set([...(dup.alsoRuleIds || []), c.ruleId])];
          }
          continue;
        }
        const item = { ...c, supports: [...(c.supports || [])], againsts: [...(c.againsts || [])],
          checks: [...c.checks], symptom: s, symptomList: [s], symptomCn: SYMPTOM_CN[s] || s };
        byCause.set(c.cause, item);
        raw.push(item);
      }
    }
  }
  // 该类型覆盖但这些现象没有对应表，或类型本身不覆盖 → 通用框架兜底
  const usedGeneric = raw.length === 0;
  if (usedGeneric) for (const c of GENERIC_FRAME) raw.push({ ...c, symptom: 'generic', symptomCn: '通用' });

  const scored = raw.map((c) => {
    const sc = scoreCandidate(c, evidence);
    return {
      id: c.id, ruleId: c.ruleId, alsoRuleIds: c.alsoRuleIds || [],
      cause: c.cause, mechanism: c.mechanism,
      symptom: c.symptom, symptomCn: c.symptomCn,
      likelihood: sc.likelihood, likelihoodCn: sc.likelihoodCn, score: sc.score,
      supports: sc.supports.map((x) => ({ label: x.label, field: x.field, value: x.value })),
      againsts: sc.againsts.map((x) => ({ label: x.label, field: x.field, value: x.value })),
      unknowns: sc.unknowns.map((x) => ({ label: x.label, field: x.field })),
      checks: c.checks,
      undetermined: sc.undetermined,
      // 无任何支持依据时必须标「推测」，不允许当成有依据的判断
      evidenceLevel: sc.supports.length ? 'evidenced' : 'speculative',
      needVerify: true,
    };
  });

  // 排序：有依据的在前（按分降序），未判定的统一沉底但**保留在候选表内**
  scored.sort((a, b) => {
    if (a.undetermined !== b.undetermined) return a.undetermined ? 1 : -1;
    if (b.score !== a.score) return b.score - a.score;
    return a.ruleId.localeCompare(b.ruleId);
  });

  const undetermined = scored.filter((c) => c.undetermined).map((c) => ({
    id: c.id, ruleId: c.ruleId, cause: c.cause,
    missing: [...new Set(c.unknowns.map((u) => u.field))],
    missingLabels: c.unknowns.map((u) => u.label),
    note: `区分该原因所需的数据全部缺失（${[...new Set(c.unknowns.map((u) => u.field))].map((f) => FIELD_CN[f] || f).join('、')}），暂无法评估可能性；该原因仍保留在候选中，不予排除`,
  }));

  const notes = [];
  if (!covered) notes.push(`设备类型「${equipType || '（未填）'}」不在知识库覆盖范围内，仅给出通用排查框架，未套用其他设备类型的具体原因`);
  else if (usedGeneric) notes.push(`设备类型「${TYPE_CN[typeKey]}」已覆盖，但所述现象（${syms.map((s) => SYMPTOM_CN[s] || s).join('、')}）在该类型口径表中无对应条目，仅给出通用排查框架`);

  return { typeKey, typeCn: TYPE_CN[typeKey], covered, usedGeneric, candidates: scored, undetermined, notes };
}

// ---------------------------------------------------------------- 参数类型与偏差阈值
/**
 * 参数类型（按参数名/单位识别）：温度 / 压力 / 振动 / 电流 / 流量 / 液位 / 其他。
 * 偏差阈值**不写死**：由 --dev-pct（按类型给百分比）或限值表（上限/下限或偏差阈值%）给出；
 * 两者都没有 → 该参数不判「升高/偏低」，依赖它的原因判未判定（不按 15% 默认）。
 */
const PARAM_KINDS = [
  ['温度', /温度|温升|瓦温|油温|风温|排温|℃|°C/i],
  ['压力', /压力|压差|压降|MPa|kPa|bar/i],
  ['振动', /振动|振幅|振速|位移|mm\/s|μm|um/i],
  ['电流', /电流|功率|负荷率|\bA\b|kW/i],
  ['流量', /流量|排量|t\/h|m3\/h|m³\/h|Nm3/i],
  ['液位', /液位|罐位|油位|%/],
];
function classifyParamKind(name, unit) {
  const s = `${name || ''} ${unit || ''}`;
  for (const [k, re] of PARAM_KINDS) if (re.test(s)) return k;
  return '其他';
}
/**
 * 解析 --dev-pct："15" → 所有类型 15%；"温度=10,压力=8,振动=20,其他=15" → 按类型；
 * 返回 Map(类型 → 百分比)，无法解析的项抛错（不静默）。
 */
function parseDevPct(v) {
  const out = {};
  const s = String(v === null || v === undefined ? '' : v).trim();
  if (!s) return out;
  if (/^\d+(\.\d+)?%?$/.test(s)) { out['*'] = parseFloat(s); return out; }
  for (const part of s.split(/[,，;；]/)) {
    const m = part.trim().match(/^([^=:：]+)[=:：]\s*(\d+(?:\.\d+)?)%?$/);
    if (!m) throw new Error(`--dev-pct 片段「${part.trim()}」无法解析，格式应为 温度=10,压力=8（百分比）`);
    const k = m[1].trim().replace(/^(其它|默认|default|\*)$/i, '其他');
    out[k] = parseFloat(m[2]);
  }
  return out;
}
/**
 * compareToBase({value, base, upper, lower, devPct}) → '升高' | '偏低' | '正常' | null
 *   1. 有上限/下限（限值表或参数表列）→ 按限值判；
 *   2. 有基准值且有 devPct（该类型或 *）→ 按偏差百分比判；
 *   3. 否则 null（未判定，不猜）。
 * 返回 {trend, basis} 便于写明依据。
 */
function compareToBase({ value, base, upper, lower, devPct }) {
  if (value === null || value === undefined || !Number.isFinite(value)) return { trend: null, basis: null };
  const hasU = Number.isFinite(upper), hasL = Number.isFinite(lower);
  if (hasU || hasL) {
    if (hasU && value > upper) return { trend: '升高', basis: `实测 ${value} > 上限 ${upper}` };
    if (hasL && value < lower) return { trend: '偏低', basis: `实测 ${value} < 下限 ${lower}` };
    return { trend: '正常', basis: `实测 ${value} 在限值内（${hasL ? '下限 ' + lower : ''}${hasL && hasU ? '，' : ''}${hasU ? '上限 ' + upper : ''}）` };
  }
  if (base === null || base === undefined || !Number.isFinite(base) || base === 0) return { trend: null, basis: null };
  if (devPct === null || devPct === undefined || !Number.isFinite(devPct)) return { trend: null, basis: null };
  const r = (value - base) / Math.abs(base) * 100;
  const rs = `${r >= 0 ? '+' : ''}${r.toFixed(1)}%`;
  if (r >= devPct) return { trend: '升高', basis: `实测 ${value} vs 基准 ${base}（${rs}，阈值 ±${devPct}%）` };
  if (r <= -devPct) return { trend: '偏低', basis: `实测 ${value} vs 基准 ${base}（${rs}，阈值 ±${devPct}%）` };
  return { trend: '正常', basis: `实测 ${value} vs 基准 ${base}（${rs}，阈值 ±${devPct}%）` };
}

// ---------------------------------------------------------------- 字段中文名
const FIELD_CN = {
  spectrum: '振动频谱特征描述', flowPressure: '流量/出口压力是否波动', suction: '入口压力或罐位',
  bearingTemp: '轴承温度变化', recentRepair: '近期是否检修', sudden: '是否突发',
  load: '负荷或工况是否调整', current: '电流变化', oil: '油质/油位',
  history: '历史故障记录', foundation: '地脚/基础状况', symptomText: '现象描述',
  pressureDiff: '压差变化', heatDuty: '换热端差/换热量', insulation: '绝缘电阻',
  cooling: '通风/冷却条件', recheck: '现场复测比对结果', sealFlush: '机封冲洗状况',
};

// ---------------------------------------------------------------- 关注度提示（红/橙/黄）
/**
 * riskLevel({symptoms, sudden, affectsRun, special})
 * 只给「关注度提示」，**不等于停机建议**。缺字段 → undetermined。
 * 口径：关注度用 红 / 橙 / 黄 三档（《中石化口径对照.md》第三节），避免与设备重要度 A/B/C 撞名。
 * 红 需尽快安排专业人员到场 / 橙 加密监控 / 黄 按计划跟踪 / undetermined 信息不足
 * special=true（特护设备）：关注度按最高档「红」强制提示，并在 basis 注明。
 */
const RISK_CN = {
  '红': '红（建议尽快联系专业人员到场核实）',
  '橙': '橙（建议加密监控并跟踪趋势）',
  '黄': '黄（建议按计划跟踪）',
  undetermined: '未判定（信息不足）',
};
/** 旧口径/口语 → 红橙黄：A/一级/高→红，B/二级/中→橙，C/三级/低→黄；无法识别 → null */
const RISK_ALIAS = {
  '红': ['红', '红色', 'A', 'a', 'A级', 'A 级', '一级', '高', 'red', 'RED'],
  '橙': ['橙', '橙色', 'B', 'b', 'B级', 'B 级', '二级', '中', 'orange', 'ORANGE'],
  '黄': ['黄', '黄色', 'C', 'c', 'C级', 'C 级', '三级', '低', 'yellow', 'YELLOW'],
};
function normRiskLevel(v) {
  const s = String(v === null || v === undefined ? '' : v).trim().replace(/\s+/g, '');
  if (!s) return null;
  for (const [k, list] of Object.entries(RISK_ALIAS)) if (list.some((x) => x.replace(/\s+/g, '') === s)) return k;
  return null;
}
function riskLevel({ symptoms, sudden, affectsRun, special }) {
  const missing = [];
  if (sudden === null || sudden === undefined) missing.push('是否突发');
  if (affectsRun === null || affectsRun === undefined) missing.push('是否影响运行');
  if (special === true) {
    return { level: '红', levelCn: RISK_CN['红'], ruleId: 'RK0', special: true,
      basis: '特护设备，关注度按最高档提示' + (missing.length ? `（「${missing.join('」「')}」未提供，但特护设备不因缺项降档）` : ''), missing };
  }
  if (missing.length) {
    return { level: 'undetermined', levelCn: RISK_CN.undetermined, ruleId: 'RU1', special: false,
      basis: `关注度提示所需字段缺失：${missing.join('、')}；补充后可给出关注度提示`, missing };
  }
  const has = (k) => symptoms.includes(k);
  if (affectsRun === true && sudden === true) {
    return mk('红', 'RK1', '突发且已影响装置运行');
  }
  if (sudden === true && (has('vibration') || has('noise') || has('leak'))) {
    return mk('红', 'RK2', '突发的振动、异响或泄漏，劣化速度不确定');
  }
  if (affectsRun === true) return mk('橙', 'RK3', '已影响装置运行但非突发，可在监控下安排核实');
  if (has('leak')) return mk('橙', 'RK4', '存在泄漏现象，须跟踪泄漏量变化');
  return mk('黄', 'RK5', '渐变型异常且未影响运行，可按计划跟踪');

  function mk(level, ruleId, basis) {
    return { level, levelCn: RISK_CN[level], ruleId, basis, missing: [], special: false };
  }
}

// ---------------------------------------------------------------- 上报建议
/** 是否建议上报；缺 riskLevel 时给保守表述而非结论。上报对象：设备工程师 / 车间设备主任；特护设备同步公司设备管理部门（机动部/设备部）。 */
function escalation(risk, candCount, undCount) {
  const tail = `候选原因 ${candCount} 项${undCount ? `（其中 ${undCount} 项因缺数据未判定）` : ''}`;
  if (risk.special) {
    return { escalate: true, text: `【注意】特护设备：建议立即上报车间设备主任与设备工程师，并按厂内特护设备管理规定同步公司设备管理部门（机动部/设备部）。本初判不包含是否停机、降负荷的意见，该决策由设备工程师会同生产调度按厂内规定作出。${tail}。` };
  }
  if (risk.level === 'undetermined') {
    return { escalate: null, text: '因关注度所需信息不全，暂不给出上报建议；建议先补齐「是否突发」「是否影响运行」两项后重新初判。若现场已判断有安全风险，按厂内异常上报流程直接上报车间设备主任，不必等待本初判。' };
  }
  if (risk.level === '红') {
    return { escalate: true, text: '建议立即上报设备工程师与车间设备主任，并按厂内异常上报流程处理。本初判不包含是否停机、降负荷的意见，该决策由设备工程师会同生产调度按厂内规定作出。' };
  }
  if (risk.level === '橙') {
    return { escalate: true, text: `建议向设备工程师报备并同步现有数据，由工程师决定是否到场；视情况向车间设备主任通报。${tail}，核实后可缩小范围。` };
  }
  return { escalate: false, text: `暂不需要即刻上报，建议按建议核实项逐项核实后，把结果连同本初判一并提交设备工程师复核。${tail}。` };
}

// ---------------------------------------------------------------- 固定声明行
const DISCLAIMER = '本结论为初判辅助，由脚本汇总、模型成文，不替代专业诊断与停机决策，须由设备工程师或车间设备主任复核；厂内制度与系统数据为准';

module.exports = {
  classifyEquipType, TYPE_CN, classifySymptoms, SYMPTOM_CN, performanceOnlyByInternalLeak, INTERNAL_LEAK_SUPPLEMENT,
  parseSudden, parseAffects, parseRecentRepair,
  PROBES, runProbe, PATTERNS, GENERIC_FRAME,
  scoreCandidate, triage, FIELD_CN,
  riskLevel, RISK_CN, RISK_ALIAS, normRiskLevel, escalation, LIKELIHOOD_CN, DISCLAIMER,
  TYPE_KEYWORDS, PARAM_KINDS, classifyParamKind, parseDevPct, compareToBase,
};
