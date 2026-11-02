'use strict';
/**
 * 设备变更管理（MOC）判定规则引擎 —— 中石化《变更管理规定》口径
 * 口径见 references/moc-rules.md 与顶层《中石化口径对照.md》第七节。
 *
 * 变更分类（changeType）：工艺技术变更 process_tech / 设备设施变更 equipment_facility / 管理变更 management
 * 变更级别（level）：重大 major / 一般 general / 不属于变更 none（同类替换）/ 待厂内评审 review / 未判定 undetermined
 * 「临时」是属性（temporary: true/false），不是级别；临时变更必须有恢复期限与恢复计划。
 *
 * 核心原则（硬约束）：
 *  1. 判定所需要素缺失时一律 undetermined，并列出还需补充哪个要素；
 *     **绝不因信息不足而判定「不需要走变更」**——不属于变更只能由 RN1（同类替换）正面命中。
 *  2. 原状态与变更后状态必须具体到参数或型号，单个位号、"换成备用那台"不算具体。
 *  3. 厂内制度与默认口径冲突时以厂内制度为准，冲突点列出。
 *  4. 判定依据一律带规则条款编号。
 *  5. 涉及压力容器/压力管道结构或材质改动，附加"改造告知、监督检验、使用登记变更"三项法定手续提示（只提示名称，不写数值）。
 *  6. 工艺参数与联锁定值变更由工艺/仪表专业提报，车间设备员只做提示与台账衔接。
 */

// ---------------------------------------------------------------- 变更类别（细分，用于评估项与资料清单）
const CAT_CN = {
  material: '材质变更',
  model: '型号规格变更',
  structure: '结构改动',
  process: '工艺参数变更',
  control: '控制方案/联锁定值变更',
  substitute: '备件代用（同规格不同厂家）',
  management: '管理变更',
  unknown: '未识别',
};
/** 细分类别 → 中石化三大类 */
const CHANGE_TYPE = {
  process_tech: '工艺技术变更',
  equipment_facility: '设备设施变更',
  management: '管理变更',
};
const CAT_TO_TYPE = {
  material: 'equipment_facility',
  model: 'equipment_facility',
  structure: 'equipment_facility',
  substitute: 'equipment_facility',
  process: 'process_tech',
  control: 'process_tech',
  management: 'management',
};
/** 归口提报专业：车间设备员可提报 / 由工艺或仪表专业提报 */
const CAT_OWNER = {
  material: { owner: '车间设备员（设备专业）', note: '设备设施变更由车间设备员提报，涉及承压设备须附特种设备法定手续' },
  model: { owner: '车间设备员（设备专业）', note: '设备设施变更由车间设备员提报' },
  structure: { owner: '车间设备员（设备专业）', note: '设备设施变更由车间设备员提报，涉及承压设备须附特种设备法定手续' },
  substitute: { owner: '车间设备员（设备专业）', note: '走材料代用单 / 同类替换评审，是否报变更以厂内制度为准' },
  process: { owner: '工艺专业（车间工艺员 / 技术员）提报', note: '工艺参数属工艺技术变更，由工艺专业提报；车间设备员只做设备适应性提示与台账衔接，不自行提报' },
  control: { owner: '仪表专业（联锁定值 / 控制方案）提报', note: '联锁定值与控制方案属工艺技术变更，由仪表专业（SIS 由仪表与工艺共同）提报；车间设备员只做设备保护功能提示' },
  management: { owner: '车间 / 分厂管理部门提报', note: '管理变更（组织机构、制度、人员、承包商）由对应管理部门提报，设备员只做设备管理相关提示' },
};
/** 用户可用 --category 指定的中文/英文写法 */
const CAT_ALIAS = {
  material: ['material', '材质', '材质变更', '材料'],
  model: ['model', '型号', '规格', '型号规格', '型号规格变更', '选型'],
  structure: ['structure', '结构', '结构改动', '结构变更', '改造'],
  process: ['process', '工艺', '工艺参数', '工艺参数变更', '操作条件', '工艺技术'],
  control: ['control', '控制', '控制方案', '控制方案变更', '联锁', '联锁定值', '仪表逻辑'],
  substitute: ['substitute', '备件代用', '代用', '代用件', '替代', '材料代用'],
  management: ['management', '管理', '管理变更', '制度', '组织', '人员', '承包商'],
};
/** 「临时」不是类别而是属性；--category 临时 → temporary=true，类别从描述识别 */
const TEMP_ALIAS = ['temporary', '临时', '临时措施', '临时变更'];
function isTempWord(v) {
  const s = String(v || '').trim().toLowerCase();
  return !!s && TEMP_ALIAS.some((x) => s === x || s.includes(x));
}
function normCategory(v) {
  const s = String(v || '').trim().toLowerCase();
  if (!s) return null;
  if (isTempWord(s)) return null;
  for (const [k, list] of Object.entries(CAT_ALIAS)) {
    if (list.some((x) => s === String(x).toLowerCase() || s.includes(String(x).toLowerCase()))) return k;
  }
  return null;
}
function normChangeType(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  if (/工艺|技术/.test(s)) return 'process_tech';
  if (/设备|设施/.test(s)) return 'equipment_facility';
  if (/管理|组织|制度/.test(s)) return 'management';
  return null;
}

// ---------------------------------------------------------------- 类别识别（从文本）
const CAT_PATTERNS = [
  ['control', /联锁|连锁|报警值|报警定值|控制方案|控制回路|调节回路|逻辑|SIS|DCS组态|PID参数|整定值|保护值/],
  ['process', /操作压力|操作温度|设计压力|设计温度|工艺参数|操作条件|流量提至|提量|处理量|升温至|升压至|介质更换|换介质|操作弹性/],
  ['structure', /增加管口|增开口|开孔|加管口|减少管口|堵管口|封堵|连接方式|焊接改法兰|法兰改焊接|改造|增设|拆除|切除|加装|支撑形式|结构改动|新增接管|新增.{0,6}管口|取样口|跨线|短接/],
  ['material', /材质|碳钢|不锈钢|304|316|合金|双相钢|衬里|材料牌号|20#|Q345|15CrMo|钛材|哈氏合金/],
  ['substitute', /代用|替代品|其他厂家|另一厂家|国产替代|进口替代|同规格不同|换厂家|不同厂家/],
  ['model', /型号|规格|叶轮直径|扬程|流量|功率|转速|换热面积|公称直径|DN|台数|机型/],
  ['management', /组织机构|岗位|定员|管理制度|操作规程修订|承包商更换|维保单位更换|人员资质|管理流程/],
];
/** 从原状态/变更后状态/原因文本识别类别；识别不出返回 'unknown' */
function classifyCategory(text) {
  const s = String(text || '');
  for (const [k, re] of CAT_PATTERNS) if (re.test(s)) return k;
  return 'unknown';
}

// ---------------------------------------------------------------- 承压设备（特种设备）识别
const PRESSURE_RE = /压力容器|压力管道|承压|容器|换热器|反应器|分离器|缓冲罐|储罐|球罐|塔(?!架)|汽包|锅炉|管线|管道|工艺管道/;
/** 从设备类别/名称/描述判断是否承压设备；返回 true / null（识别不出） */
function detectPressure(text) {
  const s = String(text || '');
  if (!s) return null;
  if (PRESSURE_RE.test(s)) return true;
  return null;
}
/** 压力容器/压力管道结构或材质改动须附的法定手续（只提示名称，不写数值；依据 TSG 21 / TSG D7005 与厂内特种设备管理规定） */
const STATUTORY_ITEMS = [
  { item: '改造告知', note: '改造施工前向特种设备安全监督管理部门办理告知' },
  { item: '监督检验', note: '改造过程由有资质的检验机构实施监督检验' },
  { item: '使用登记变更', note: '改造完成后办理使用登记证变更' },
];

// ---------------------------------------------------------------- 描述具体性
const VAGUE_PATTERNS = [/^换个?[一二三两]?[台个只根]?/, /^改一下/, /^换一下/, /^动一动/, /^修一下/, /^换成?备用/, /^用备用/];
/** 位号样式（P-2101A、E-2201、1000-CDU-P1101A 等），不算"具体到参数或型号" */
const TAG_TOKEN_RE = /\b[A-Za-z]{1,3}-\d{3,5}[A-Za-z]?\b(?!-\d)|\b\d{3,4}-[A-Z]{2,4}-[A-Za-z]{1,3}\d{3,5}[A-Za-z]?\b/g;
/** 描述里是否出现参数或型号：数字+单位、牌号、型号串、材质牌号 */
const CONCRETE_RE = /\d+(\.\d+)?\s*(MPa|kPa|bar|℃|度|°C|mm|m3\/h|m³\/h|t\/h|kW|kw|KW|V|A|Hz|rpm|r\/min|m2|m²|DN|寸|kg|MPag)|DN\s*\d+|[A-Za-z]{1,6}[-–]?\d{2,}|(304|316L?|321|Q235|Q345|20#|15CrMo|12Cr1MoV|2205|TA2|C276|N08800)/i;
const TECH_NOUN_RE = /材质|型号|规格|压力|温度|流量|扬程|功率|转速|联锁|报警|管口|接管|法兰|焊接|厂家|牌号|衬里|叶轮|换热面积|定值|逻辑/;
/**
 * describeQuality(text) → {concrete:boolean, reason}
 * 具体 = 去掉位号后仍含参数/型号串，或含材质名称，或长度足够、含分隔符且含技术名词
 * 只写一个位号（「换成 P-2101B」）不算具体——位号只说明是哪台，不说明参数或型号变了什么
 */
function describeQuality(text) {
  const s = String(text || '').trim();
  if (!s) return { concrete: false, reason: '未填写' };
  const stripped = s.replace(TAG_TOKEN_RE, ' ');
  const onlyTag = stripped.trim() !== s && !CONCRETE_RE.test(stripped) && !/碳钢|不锈钢|合金钢|双相钢|钛材|铸铁|衬里|衬胶|衬氟/.test(stripped);
  if (onlyTag && !(stripped.length >= 12 && /[：:，,、]/.test(stripped) && TECH_NOUN_RE.test(stripped))) {
    return { concrete: false, reason: `只给了位号（「${s}」），未说明具体参数或型号` };
  }
  if (VAGUE_PATTERNS.some((re) => re.test(s)) && !CONCRETE_RE.test(stripped)) {
    return { concrete: false, reason: `描述笼统（「${s}」），未说明具体参数或型号` };
  }
  if (CONCRETE_RE.test(stripped)) return { concrete: true, reason: '' };
  if (/碳钢|不锈钢|合金钢|双相钢|钛材|铸铁|衬里|衬胶|衬氟/.test(s)) return { concrete: true, reason: '' };
  if (s.length >= 12 && /[：:，,、]/.test(s) && TECH_NOUN_RE.test(s)) return { concrete: true, reason: '' };
  return { concrete: false, reason: `描述未具体到参数或型号（「${s}」）` };
}

// ---------------------------------------------------------------- 材质档位
/** 材质等级序（数值越大耐蚀/耐温能力越强），用于判断是否降级 */
const MATERIAL_RANK = [
  [/铸铁|HT\d/i, 1, '铸铁'],
  [/碳钢|Q235|Q345|20#|20号|A105|碳素钢|16MnR/i, 2, '碳钢'],
  [/15CrMo|12Cr1MoV|合金钢|铬钼钢/i, 3, '低合金钢'],
  [/304L?|0Cr18|321|奥氏体不锈钢|不锈钢(?!.*(316|双相|2205))/i, 4, '304 系不锈钢'],
  [/316L?|00Cr17|317/i, 5, '316 系不锈钢'],
  [/2205|双相钢|双相不锈钢/i, 6, '双相钢'],
  [/TA[12]|钛材|哈氏合金|C276|Inconel|蒙乃尔|镍基/i, 7, '钛材/镍基合金'],
];
function materialRank(text) {
  const s = String(text || '');
  let best = null;
  for (const [re, rank, name] of MATERIAL_RANK) {
    if (re.test(s) && (!best || rank > best.rank)) best = { rank, name };
  }
  return best;
}
function materialFamily(rank) {
  if (rank === null || rank === undefined) return null;
  if (rank <= 3) return 'ferrous';
  if (rank <= 6) return 'stainless';
  return 'exotic';
}
function materialFamilyCn(rank) {
  const f = materialFamily(rank);
  return f === 'ferrous' ? '黑色金属（铸铁/碳钢/低合金钢）' : f === 'stainless' ? '不锈钢系' : '特种合金';
}

// ---------------------------------------------------------------- 布尔解析
function parseBool(v) {
  if (v === true) return true;
  if (v === false) return false;
  const s = String(v === null || v === undefined ? '' : v).trim();
  if (!s) return null;
  if (/^(是|有|会|Y|yes|true|1|影响|超出|变了|改变)/i.test(s)) return true;
  if (/^(否|无|不|N|no|false|0|不影响|未超|不变|没变)/i.test(s)) return false;
  return null;
}

// ---------------------------------------------------------------- 级别
const LEVEL_CN = {
  major: '重大变更',
  general: '一般变更',
  review: '待厂内评审（材料代用单 / 同类替换评审）',
  none: '不属于变更（同类替换）',
  undetermined: '未判定',
};

// ---------------------------------------------------------------- 规则表
/**
 * 规则条款（与 references/moc-rules.md 一一对应）
 * RN1 同类替换（同型号同材质同厂家）                  → 不属于变更
 * R1  材质降级或改变材质类别                          → 设备设施变更 / 重大
 * R2  型号规格改变影响性能参数                        → 设备设施变更 / 一般
 * R3  结构改动（增减管口、改变连接方式）              → 设备设施变更 / 重大；承压设备附三项法定手续
 * R4  工艺参数超出设计范围                            → 工艺技术变更 / 重大（未超 → 一般）；由工艺专业提报
 * R5  控制方案 / 联锁定值改变                         → 工艺技术变更 / 重大；由仪表专业提报
 * R6  同规格不同厂家代用                              → 待厂内评审：建议走材料代用单 / 同类替换评审，是否报变更以厂内制度为准
 * R7  临时属性                                        → 在上述级别上标 temporary=true，须设期限与恢复计划
 * R8  管理变更                                        → 管理变更，级别由厂内制度确定（未提供 → U6）
 * U1~U6 未判定条款
 */
const RULE_TEXT = {
  RN1: '同类替换：同型号、同材质、同厂家的备件更换，属恢复性维修，不属于变更',
  R1: '材质降级或改变材质类别，影响耐蚀、耐温与强度裕度（设备设施变更）',
  R2: '型号规格改变且影响性能参数（流量、扬程、功率、换热面积等）（设备设施变更）',
  R3: '结构改动（增减管口、改变连接方式、增设或拆除构件）（设备设施变更）',
  R4: '工艺参数超出设计范围（操作压力、温度、介质、处理量）（工艺技术变更，由工艺专业提报）',
  R5: '控制方案 / 联锁定值改变（联锁逻辑、报警值、保护定值、控制回路）（工艺技术变更，由仪表专业提报）',
  R6: '同规格不同厂家代用：建议走材料代用单 / 同类替换评审，是否报变更以厂内制度为准',
  R7: '临时变更属性：须设定恢复期限与恢复计划',
  R8: '管理变更（组织机构、制度、人员、承包商），级别按厂内制度确定',
  U1: '原状态或变更后状态未具体到参数或型号（单个位号不算），无法判定',
  U2: '变更类别无法识别，需用户明确属于哪一类改动',
  U3: '材质类变更但原材质或变更后材质牌号无法识别，无法判断是否降级',
  U4: '型号规格类变更但「是否影响性能参数」未确认 / 工艺参数变更但「是否超出设计范围」未确认',
  U5: '临时变更但未给出恢复期限',
  U6: '管理变更的级别须由厂内制度（--spec）或主管部门确定',
};

/**
 * judge(input) → {isChange, level, levelCn, changeType, changeTypeCn, temporary, ruleId, basis, missing[], temporaryNote}
 *
 * input:
 *   category      细分类别 key，可为 null
 *   before/after  原状态、变更后状态（原文）
 *   beforeQ/afterQ describeQuality 结果
 *   sameModelMaterial  true|false|null —— 是否同型号同材质同厂家（同类替换判定用）
 *   affectsPerf   true|false|null
 *   exceedsDesign true|false|null
 *   temporary     boolean —— 是否临时属性
 *   until         期限（YYYY-MM-DD）或 null
 *
 * 判定顺序：U1 → U2 → RN1 → 临时期限（U5）→ 按类别定级 → 叠加临时属性。
 * **不属于变更（RN1）只能正面命中，缺信息一律 undetermined。**
 */
function judge(input) {
  const {
    category, before, after, beforeQ, afterQ,
    sameModelMaterial, affectsPerf, exceedsDesign, temporary, until,
  } = input;
  const isTemp = !!temporary;
  const missing = [];

  // 管理变更没有"参数或型号"，具体性只要求原状态与变更后状态都写清对象（非空、非笼统）
  if (category === 'management') {
    if (!String(before || '').trim()) missing.push('原状态：未填写');
    if (!String(after || '').trim()) missing.push('变更后状态：未填写');
  } else {
    if (!beforeQ.concrete) missing.push(`原状态：${beforeQ.reason}`);
    if (!afterQ.concrete) missing.push(`变更后状态：${afterQ.reason}`);
  }
  if (missing.length) {
    return mkU('U1', missing, '原状态与变更后状态必须具体到参数或型号（只写位号不算），请补充后重新判定；在补齐前不得认定为「不需要走变更」');
  }

  if (!category || category === 'unknown') {
    return mkU('U2', ['变更类别（材质/型号规格/结构/工艺参数/控制方案/备件代用/管理）'],
      '无法从描述中识别变更类别，请明确属于哪一类改动；在明确前不得认定为「不需要走变更」');
  }

  // RN1：同类替换 → 不属于变更（仅正面命中）
  if (category === 'substitute' || category === 'model' || category === 'material') {
    if (sameModelMaterial === true) {
      return {
        isChange: false, level: 'none', levelCn: LEVEL_CN.none, changeType: null, changeTypeCn: null, temporary: isTemp, ruleId: 'RN1',
        basis: `${RULE_TEXT.RN1}；已确认型号、材质与厂家均未改变`,
        missing: [], temporaryNote: null,
      };
    }
  }

  // 临时属性：期限缺失先拦截（U5）
  if (isTemp && !until) {
    return mkU('U5', ['恢复期限（--until）'],
      `${RULE_TEXT.R7}；临时变更必须设定期限，未给出期限前不得按临时变更放行`);
  }

  let v = null;
  if (category === 'material') {
    const rb = materialRank(before), ra = materialRank(after);
    if (!rb || !ra) {
      return mkU('U3', [!rb ? '原材质牌号' : null, !ra ? '变更后材质牌号' : null].filter(Boolean),
        `${RULE_TEXT.U3}；在补齐前不得认定为「不需要走变更」`);
    }
    const downgrade = ra.rank < rb.rank;
    const familyChanged = materialFamily(ra.rank) !== materialFamily(rb.rank);
    if (downgrade || familyChanged) {
      const why = [downgrade ? `材质由${rb.name}降为${ra.name}` : null,
        familyChanged ? `材质类别由${materialFamilyCn(rb.rank)}改为${materialFamilyCn(ra.rank)}` : null].filter(Boolean).join('，');
      v = mk('major', 'R1', `${RULE_TEXT.R1}：${why}`);
    } else {
      v = mk('general', 'R2', `材质由${rb.name}变为${ra.name}，未降级且未改变材质类别，按型号规格变更口径处理，需确认焊接工艺与热处理适应性`);
    }
  } else if (category === 'structure') {
    v = mk('major', 'R3', `${RULE_TEXT.R3}：${before} → ${after}`);
  } else if (category === 'process') {
    if (exceedsDesign === null) {
      return mkU('U4', ['是否超出设计范围（--exceeds-design 是/否，由工艺专业确认）'],
        '工艺参数变更须确认是否超出设计范围才能定级；在确认前不得认定为「不需要走变更」');
    }
    v = exceedsDesign === true
      ? mk('major', 'R4', `${RULE_TEXT.R4}：${before} → ${after}`)
      : mk('general', 'R4', `工艺参数改变但未超出设计范围（${before} → ${after}），按一般变更处理，仍须评估操作规程与联锁定值的适应性；由工艺专业提报`);
  } else if (category === 'control') {
    v = mk('major', 'R5', `${RULE_TEXT.R5}：${before} → ${after}`);
  } else if (category === 'substitute') {
    v = mkReview('R6', `${RULE_TEXT.R6}：${before} → ${after}`);
  } else if (category === 'model') {
    if (affectsPerf === null) {
      return mkU('U4', ['是否影响性能参数（--affects-perf 是/否）'],
        `${RULE_TEXT.U4}；在确认前不得认定为「不需要走变更」`);
    }
    v = affectsPerf === true
      ? mk('general', 'R2', `${RULE_TEXT.R2}：${before} → ${after}`)
      : mkReview('R6', `型号规格改变但不影响性能参数，按同规格代用口径处理：${RULE_TEXT.R6}`);
  } else if (category === 'management') {
    return mkU('U6', ['管理变更级别（厂内制度 --spec 或主管部门确定）'],
      `${RULE_TEXT.R8}；${RULE_TEXT.U6}`, 'management');
  }
  if (!v) return mkU('U2', ['变更类别'], '未能匹配任何判定条款，请人工确认变更类别');

  if (isTemp) {
    v.temporary = true;
    v.ruleId = `${v.ruleId}+R7`;
    v.basis = `${v.basis}；临时变更（R7），恢复期限 ${until}`;
    v.temporaryNote = `临时变更须在 ${until} 前恢复原状或转为正式变更；到期未恢复须重新申请延期。恢复计划须明确恢复责任人、恢复内容与验收方式。`;
  }
  return v;

  function base(level, ruleId, basis, isChange) {
    const ct = CAT_TO_TYPE[category] || null;
    return {
      isChange, level, levelCn: LEVEL_CN[level], changeType: ct, changeTypeCn: ct ? CHANGE_TYPE[ct] : null,
      temporary: isTemp, ruleId, basis, missing: [], temporaryNote: null,
    };
  }
  function mk(level, ruleId, basis) { return base(level, ruleId, basis, true); }
  function mkReview(ruleId, basis) { return base('review', ruleId, basis, null); }
  function mkU(ruleId, miss, basis, cat) {
    const ct = CAT_TO_TYPE[cat || category] || null;
    return {
      isChange: null, level: 'undetermined', levelCn: LEVEL_CN.undetermined,
      changeType: ruleId === 'U1' || ruleId === 'U2' ? null : ct, changeTypeCn: ruleId === 'U1' || ruleId === 'U2' ? null : (ct ? CHANGE_TYPE[ct] : null),
      temporary: isTemp, ruleId, basis, missing: miss, temporaryNote: null,
    };
  }
}

// ---------------------------------------------------------------- 需评估项
const ASSESS_MAP = {
  material: {
    安全: ['材质变更后的泄漏与失效风险再评估', '是否需要重新进行应力与强度校核'],
    工艺: ['材质与介质相容性（腐蚀速率、氢脆、应力腐蚀）', '是否影响产品质量与污染风险'],
    设备: ['焊接工艺评定与热处理要求是否变化', '定期检验周期与检验方法是否需调整', '设备设计温度与压力等级是否仍满足'],
    电气仪表: ['接地与防静电要求是否变化（衬里、非金属材质时）'],
    环保: ['材质变更是否影响挥发性有机物逸散与废弃物属性'],
    操作规程: ['开停工与吹扫置换步骤是否需调整'],
  },
  model: {
    安全: ['性能参数变化后的超压、超流量保护是否仍有效'],
    工艺: ['流量、扬程、换热面积变化对工艺平衡的影响', '上下游设备匹配性与操作弹性'],
    设备: ['基础、地脚螺栓与管口方位是否匹配', '备件通用性与库存影响', '润滑与冷却系统是否需调整'],
    电气仪表: ['电机功率、启动电流与配电容量是否匹配', '就地仪表量程与联锁定值是否需调整'],
    环保: ['噪声与能耗是否变化'],
    操作规程: ['正常操作参数范围与开停机步骤是否需修订'],
  },
  structure: {
    安全: ['结构改动的受力与稳定性影响', '用火与受限空间作业风险（按作业许可办票）', '是否影响安全附件（安全阀、爆破片）的设置'],
    工艺: ['流场与死区变化、介质滞留与堵塞风险'],
    设备: ['承压部件开孔补强计算', '焊接工艺、无损检测比例与合格级别', '改动后是否需重新进行耐压试验与气密试验', '设备档案中的竣工图是否随之更新'],
    电气仪表: ['新增管口是否需配套仪表与接线', '防雷防静电跨接是否受影响'],
    环保: ['改动是否新增排放点或密封点'],
    操作规程: ['巡检路线与检查部位是否需调整'],
  },
  process: {
    安全: ['是否超出设计压力、设计温度与安全阀整定值', '超压与超温保护措施的有效性', '是否触发工艺危害分析（HAZOP）复审'],
    工艺: ['物料平衡与热平衡的重新核算（由工艺专业出具）', '上下游装置与公用工程的承受能力', '操作弹性与波动裕度'],
    设备: ['承压设备在新参数下的强度与疲劳裕度', '管道等级与支吊架适应性', '转动设备的运行工况点是否偏离高效区'],
    电气仪表: ['报警值与联锁定值是否需同步修订（由仪表专业提报）', '仪表量程是否覆盖新参数范围'],
    环保: ['排放浓度与总量是否变化，是否需变更排污许可'],
    操作规程: ['操作卡、工艺卡片与开停工方案的修订'],
  },
  control: {
    安全: ['联锁逻辑变更对安全功能完整性（SIF/SIL）的影响', '旁路与强制期间的补偿措施', '是否需要 SIL 定级复核'],
    工艺: ['控制回路调整对工艺稳定性的影响', '与相邻回路的耦合与干扰'],
    设备: ['联锁动作对设备保护功能（防喘振、低流量保护）是否削弱'],
    电气仪表: ['DCS/SIS 组态修改与版本管理（由仪表专业执行）', '报警分级与报警泛滥评估', '回路测试与功能验证方案'],
    环保: ['环保联锁与在线监测联动是否受影响'],
    操作规程: ['报警响应卡与异常处置预案的修订', '操作人员培训与考核'],
  },
  substitute: {
    安全: ['代用件失效模式是否引入新的风险'],
    工艺: ['代用件性能参数等效性验证'],
    设备: ['技术协议与关键尺寸、材质证明的核对', '材料代用单 / 同类替换评审记录', '首次使用的跟踪观察期与验证要求', '备件台账与物料编码的同步更新'],
    电气仪表: ['配套电气仪表接口与信号制式是否一致'],
    环保: ['代用件材质是否涉及禁限用物质'],
    操作规程: ['维护保养要求是否有差异'],
  },
  management: {
    安全: ['管理变更对安全职责、应急响应的影响'],
    工艺: ['操作规程与工艺纪律执行的衔接'],
    设备: ['设备管理职责、维保单位与检修资质的衔接', '设备台账与档案管理责任人的变更'],
    电气仪表: ['仪表维护责任的衔接'],
    环保: ['环保设施运行责任的衔接'],
    操作规程: ['制度与规程修订、培训与考核'],
  },
  temporary: {
    安全: ['临时措施期间的补偿性安全措施', '期限内的加密巡检与监控要求', '到期不恢复的升级处置要求'],
    工艺: ['临时状态下的操作限制条件'],
    设备: ['临时设施的完整性检查频次', '恢复计划：恢复责任人、恢复内容、验收方式'],
    电气仪表: ['临时旁路与强制点的登记、挂牌与定期复核'],
    环保: ['临时措施是否引起额外排放'],
    操作规程: ['临时操作规定与值班交接记录要求'],
  },
};
const DISCIPLINES = ['安全', '工艺', '设备', '电气仪表', '环保', '操作规程'];

/**
 * assessItems(category, level, temporary) → [{discipline, items:[...]}]
 * 重大变更「安全」组附加多专业会审；临时属性并入「临时措施」评估项并按专业去重。
 */
function assessItems(category, level, temporary) {
  const map = ASSESS_MAP[category] || {};
  const temp = temporary ? ASSESS_MAP.temporary : {};
  const out = [];
  for (const d of DISCIPLINES) {
    const items = (map[d] || []).slice();
    for (const t of (temp[d] || [])) if (!items.includes(t)) items.push(t);
    if (level === 'major' && d === '安全') items.push('重大变更须组织多专业会审并保留评审记录');
    if (items.length) out.push({ discipline: d, items });
  }
  return out;
}

// ---------------------------------------------------------------- 应更新资料
const DOC_MAP = {
  material: [
    ['设备台账（EM / SAP PM 技术对象）', '材质字段、设计参数字段'],
    ['设备档案', '材质证明书、材料代用单、焊接工艺评定记录'],
    ['P&ID', '如材质等级号（管道等级）随之变化需同步修改'],
    ['设备技术档案（竣工资料）', '制造数据表、质量证明文件'],
    ['定期检验计划 / 特种设备台账', '检验周期与检验方法；承压设备附使用登记变更'],
    ['操作规程', '涉及材质限制的操作条件说明'],
  ],
  model: [
    ['设备台账（EM / SAP PM 技术对象）', '型号、规格、性能参数、制造厂'],
    ['设备档案', '新设备说明书、合格证、性能曲线'],
    ['P&ID', '设备位号后的规格标注'],
    ['备件台账 / SAP MM 物料主数据', '物料编码、通用性关系'],
    ['操作规程', '正常操作参数范围、开停机步骤'],
    ['培训记录', '操作与维护人员对新型号的培训'],
  ],
  structure: [
    ['设备台账（EM / SAP PM 技术对象）', '结构参数、管口表'],
    ['P&ID', '管口增减、连接方式、走向'],
    ['设备布置图 / 管道单线图', '改动部位'],
    ['设备档案', '改造施工方案、竣工图、无损检测报告、耐压试验记录'],
    ['定期检验计划 / 特种设备台账', '新增检查部位与测厚点；承压设备附改造告知与监督检验资料、使用登记变更'],
    ['操作规程', '巡检路线与检查部位'],
    ['培训记录', '改动部位的操作与巡检交底'],
  ],
  process: [
    ['工艺卡片 / 工艺指标', '操作压力、温度、流量、处理量（由工艺专业修订）'],
    ['P&ID', '注明的操作条件与设计条件'],
    ['设备台账（EM / SAP PM 技术对象）', '实际操作参数字段'],
    ['操作规程', '正常操作法、开停工方案、异常处置'],
    ['联锁定值台账', '报警值与联锁值（由仪表专业修订）'],
    ['培训记录', '新参数下的操作培训与考核'],
    ['排污许可 / 环保台账', '排放参数如有变化'],
  ],
  control: [
    ['联锁定值台账', '联锁值、报警值、动作逻辑（由仪表专业修订）'],
    ['控制逻辑图 / 因果图', '逻辑关系'],
    ['DCS/SIS 组态文件与版本记录', '组态修改记录与回路测试报告'],
    ['P&ID', '仪表回路与联锁标注'],
    ['操作规程', '报警响应卡、异常处置预案'],
    ['培训记录', '新逻辑的操作培训'],
    ['设备档案', '回路功能测试记录'],
  ],
  substitute: [
    ['材料代用单 / 同类替换评审记录', '代用依据、评审意见、批准人'],
    ['备件台账 / SAP MM 物料主数据', '代用关系、厂家、物料编码'],
    ['设备档案', '代用件材质证明、合格证、技术协议'],
    ['设备台账（EM / SAP PM 技术对象）', '如实际装用件与台账不一致需注明'],
    ['维护保养规程', '保养要求差异'],
  ],
  management: [
    ['管理制度 / 岗位职责文件', '修订版本与发布记录'],
    ['设备管理责任清单', '责任人、维保单位、承包商变更'],
    ['培训记录', '制度宣贯与考核'],
  ],
  temporary: [
    ['临时变更台账', '期限、恢复责任人、恢复计划'],
    ['设备台账（EM / SAP PM 技术对象）', '临时状态标注'],
    ['P&ID', '临时流程以临时标识标注，恢复后撤除'],
    ['操作规程', '临时操作规定'],
    ['值班与工作交接记录', '临时状态的交接'],
    ['旁路 / 强制点登记表', '仪表联锁临时旁路时'],
  ],
};
/** docUpdates(category, temporary) → [{doc, what}]；临时属性并入临时类资料，按资料名去重 */
function docUpdates(category, temporary) {
  const out = (DOC_MAP[category] || []).map(([doc, what]) => ({ doc, what }));
  if (temporary) {
    for (const [doc, what] of DOC_MAP.temporary) {
      if (!out.some((x) => x.doc === doc)) out.push({ doc, what });
    }
  }
  return out;
}

module.exports = {
  CAT_CN, CAT_ALIAS, CHANGE_TYPE, CAT_TO_TYPE, CAT_OWNER, isTempWord, normCategory, normChangeType, classifyCategory,
  PRESSURE_RE, detectPressure, STATUTORY_ITEMS,
  describeQuality, materialRank, materialFamily, materialFamilyCn,
  parseBool, LEVEL_CN, RULE_TEXT, judge,
  ASSESS_MAP, DISCIPLINES, assessItems, DOC_MAP, docUpdates,
};
