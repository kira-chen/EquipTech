'use strict';
/**
 * 缺陷分级规则引擎（中石化体系炼化厂口径）
 * 口径见 references/grading-rules.md 与顶层《中石化口径对照.md》第三节。
 * 默认分级方案 abc：A 级（重大）/ B 级（严重）/ C 级（一般）/ undetermined 未判定
 * 旧方案 iv（I 紧急 / II 严重 / III 一般 / IV 轻微）保留，用 --grading-scheme iv 启用。
 * 核心原则：定级依赖字段缺失时一律 undetermined，绝不按最低或最高等级默认。
 */

// ---------------------------------------------------------------- 现象分类
const PHEN_PATTERNS = [
  // 单字「漏」兜底：排除遗漏、疏漏、防漏、堵漏，以及漏检、漏报、漏装、漏加、漏斗、漏电、漏掉等（含「漏了检 / 漏了加」），不是介质泄漏
  ['leak', /泄漏|渗漏|滴漏|漏油|漏气|漏水|漏料|冒油|喷漏|外漏|窜漏|内漏|(?<![遗疏防堵])漏(?!了?[检报项判记填写洞电装加斗签投扫测查做掉])/],
  ['vibration', /振动|震动|抖动|摆动/],
  ['noise', /异响|异音|噪音|响声|杂音|敲击声|摩擦声/],
  // 温升：口语「温度偏高/升高/上升」与数值写法「偏高 8℃」「比同类高约 15℃」（与 anomaly-triage-advisor 同口径）
  ['temperature', /温度(?:有点|有些|略|稍|较|比较|很|非常|太|明显|持续|越来越)?(?:偏高|升高|上升|高)|温升|过热|发烫|高温|超温|温度异常|偏高.{0,4}(?:℃|°C)|高约?\s*\d+(?:\.\d+)?\s*(?:℃|°C)/],
  ['corrosion', /腐蚀|锈蚀|生锈|减薄|点蚀|冲刷/],
  ['deformation', /变形|开裂|裂纹|裂缝|鼓包|凹陷|断裂/],
  ['failure', /失效|损坏|故障|不动作|拒动|卡涩|卡死|不好用|失灵/],
  ['performance', /效率|出力|流量不足|压力不足|打不上量|抽空|汽蚀/],
  ['electrical', /绝缘|接地|短路|跳闸|电流|电压|发热.*电机/],
  ['instrument', /指示不准|示值|偏差|信号|显示异常|无显示|飘移/],
];
const PHEN_CN = {
  leak: '泄漏', vibration: '振动', noise: '异响', temperature: '温升',
  corrosion: '腐蚀', deformation: '变形开裂', failure: '失效', performance: '性能下降',
  electrical: '电气异常', instrument: '仪表异常', other: '其他',
};
/** 现象类型 → SAP 通知单「损坏/故障代码」建议文本（厂内目录代码由设备员按本厂目录对照填写） */
const PHEN_SAP_CODE = {
  leak: '泄漏', vibration: '振动超标', noise: '异响', temperature: '温度异常',
  corrosion: '腐蚀减薄', deformation: '变形开裂', failure: '功能失效', performance: '性能下降',
  electrical: '电气故障', instrument: '仪表故障', other: '',
};
function classifyPhenomenon(desc) {
  const s = String(desc || '');
  for (const [k, re] of PHEN_PATTERNS) if (re.test(s)) return k;
  return 'other';
}

// ---------------------------------------------------------------- 介质危险性
const HAZ_CN = { high: '高危（易燃易爆/有毒/高温高压）', medium: '中等', low: '低', none: '无特殊危险' };
const MEDIUM_HIGH = /氢|硫化氢|H2S|液化气|轻烃|石脑油|汽油|瓦斯|干气|丙烯|乙烯|丁烷|丙烷|苯|甲苯|二甲苯|氨|一氧化碳|环氧|甲醇|原油|渣油.*高温|高温油|液氯|氯气|酸性气|燃料气/i;
// 含硫污水 / 酸性水 / 含油污水 为中危（含硫化氢与烃类，不按"水"归低危）
const MEDIUM_MED = /含硫污水|酸性水|含油污水|污油|柴油|蜡油|航煤|煤油|润滑油|导热油|渣油|油浆|酸|碱|胺液|溶剂/i;
const MEDIUM_LOW = /水|蒸汽|氮气|空气|除盐水|循环水|净化风|仪表风/i;
/** 返回 'high'|'medium'|'low'|null（未填或不在库中 → null，交由 grade 判 undetermined） */
function mediumHazard(medium) {
  const s = String(medium || '').trim();
  if (!s) return null;
  if (MEDIUM_HIGH.test(s)) return 'high';
  if (MEDIUM_MED.test(s)) return 'medium';
  if (MEDIUM_LOW.test(s)) return 'low';
  return null;
}

// ---------------------------------------------------------------- 是否影响运行
/** 返回 true|false|null（未填 → null） */
function parseAffects(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  if (/^(是|有|会|Y|yes|true|1|影响)/i.test(s)) return true;
  if (/^(否|无|不|N|no|false|0|不影响)/i.test(s)) return false;
  return null;
}

// ---------------------------------------------------------------- 专业归属
/**
 * 判定顺序（先特殊后一般，避免前缀互抢）：
 *  1. 电机 / EM- / M- → 电气（电机类位号在"泵"前判，否则"电机拖动泵"会被动设备抢走）
 *  2. 安全阀 / 疏水阀 / 爆破片 / 阻火器 → 静设备（安全附件归静设备，不归仪表）
 *  3. 仪表 / 调节阀 / 变送器 / I- T- FT PT TT LT → 仪表
 *  4. 泵 / 压缩机 / 风机 / 机组 / 汽轮机 / P- K- → 动设备
 *  5. 换热器 / 容器 / 塔 / 管道 / 阀门 / E- V- C- T- D- R- → 静设备
 * 仅为建议值，派工以车间与承修单位实际分工为准。
 */
function disciplineOf(tag, name) {
  const s = `${tag || ''} ${name || ''}`;
  if (/^(EM|M)-|电机|电动机|变频|配电|开关柜|电缆|变压器|电气/.test(s)) return '电气';
  if (/安全阀|疏水阀|爆破片|阻火器|呼吸阀/.test(s)) return '静设备';
  if (/^(I|FT|PT|TT|LT|FIC|PIC|TIC|LIC|AT)-|仪表|变送器|调节阀|流量计|分析仪|报警器|热电偶|液位计/.test(s)) return '仪表';
  if (/^(P|K|GB|J|B)-|泵|压缩机|风机|机组|汽轮机|搅拌/.test(s)) return '动设备';
  if (/^(E|V|C|T|D|R|F)-|换热器|冷却器|再沸器|空冷|罐|容器|塔|管道|管线|阀门|加热炉|反应器/.test(s)) return '静设备';
  return '待定';
}

// ---------------------------------------------------------------- 分级
const SCHEMES = {
  abc: {
    name: 'A/B/C 三级（中石化炼化厂缺陷台账口径）',
    levels: ['A', 'B', 'C'],
    cn: { A: 'A 级（重大）', B: 'B 级（严重）', C: 'C 级（一般）', undetermined: '未判定' },
    due: { A: 1, B: 3, C: 7 },
    // 旧四级 → 三级：I→A，II→B，III/IV→C
    fromIV: { I: 'A', II: 'B', III: 'C', IV: 'C' },
    // SAP 通知单优先级 1 非常高 / 2 高 / 3 中 / 4 低
    sapPriority: { A: 1, B: 2, C: 3 },
  },
  iv: {
    name: 'I~IV 四级（旧口径，仅兼容）',
    levels: ['I', 'II', 'III', 'IV'],
    cn: { I: 'I 级（紧急）', II: 'II 级（严重）', III: 'III 级（一般）', IV: 'IV 级（轻微）', undetermined: '未判定' },
    due: { I: 1, II: 3, III: 7, IV: 30 },
    fromIV: { I: 'I', II: 'II', III: 'III', IV: 'IV' },
    sapPriority: { I: 1, II: 2, III: 3, IV: 4 },
  },
};
const DEFAULT_SCHEME = 'abc';
/** 旧接口：默认方案的中文名与时限（供外部单测） */
const LEVEL_CN = SCHEMES[DEFAULT_SCHEME].cn;
const DUE = SCHEMES[DEFAULT_SCHEME].due;

/**
 * 解析 --due 覆盖：形如 "A=1,B=3,C=7"（天）。返回 {due, errors[]}
 */
function parseDueOverride(v, scheme = DEFAULT_SCHEME) {
  const sc = SCHEMES[scheme];
  const due = { ...sc.due };
  const errors = [];
  const s = String(v || '').trim();
  if (!s) return { due, errors };
  for (const part of s.split(/[,，;；]/)) {
    const m = part.trim().match(/^([A-Za-z]+)\s*[=:：]\s*(\d+(?:\.\d+)?)$/);
    if (!m) { errors.push(`--due 片段「${part}」格式应为 等级=天数`); continue; }
    const lv = m[1].toUpperCase();
    if (!sc.levels.includes(lv)) { errors.push(`--due 等级「${lv}」不属于方案 ${scheme}（可用 ${sc.levels.join('/')}）`); continue; }
    due[lv] = Number(m[2]);
  }
  return { due, errors };
}

/**
 * grade({phenomenon, affectsRun, mediumHazard, desc}, opts)
 * opts: {scheme:'abc'|'iv', due:{A:1,...}}
 * 返回 {level, levelCn, basis, ruleId, dueDays, missing[], sapPriority, scheme}
 *
 * 规则顺序（命中即返回；右侧为 四级口径 → 三级口径）：
 *  R1 结构性失效（变形/开裂/断裂）+ 高危介质 → I → A
 *  R2 泄漏 + 高危介质 → I → A
 *  R3 影响运行 + 高危介质 → I → A
 *  R4 影响运行 = 是（介质中低危或无） → II → B
 *  R5 泄漏 + 中危介质 → II → B
 *  R6 结构性失效（任何介质） → II → B
 *  R7 振动/异响/温升/性能下降/电气/仪表/失效，不影响运行 → III → C
 *  R8 泄漏 + 低危介质 → III → C
 *  R9 腐蚀/其他，不影响运行 → IV → C
 *  U1 是否影响运行未填 → undetermined
 *  U2 需要介质危险性判定但介质未填/不在库 → undetermined
 */
function grade({ phenomenon, affectsRun, mediumHazard: haz, desc }, opts = {}) {
  const scheme = opts.scheme || DEFAULT_SCHEME;
  const sc = SCHEMES[scheme];
  if (!sc) throw new Error(`未知分级方案「${scheme}」，可用：${Object.keys(SCHEMES).join('|')}`);
  const due = opts.due || sc.due;
  const missing = [];
  const needMedium = ['leak', 'deformation'].includes(phenomenon) || affectsRun === true;

  // 未判定优先：缺关键字段时不猜
  if (affectsRun === null) missing.push('是否影响运行');
  if (needMedium && haz === null) missing.push('介质危险性');
  if (missing.length) {
    return {
      level: 'undetermined', levelCn: sc.cn.undetermined,
      basis: `定级所需字段缺失：${missing.join('、')}；补充后可定级`,
      ruleId: missing.includes('是否影响运行') ? 'U1' : 'U2',
      dueDays: null, missing, sapPriority: null, scheme,
    };
  }

  const hi = haz === 'high', mid = haz === 'medium';
  const structural = phenomenon === 'deformation';

  if (structural && hi) return mk('I', 'R1', '结构性失效（变形/开裂/断裂）且介质为高危，存在突发泄漏或破裂风险');
  if (phenomenon === 'leak' && hi) return mk('I', 'R2', '高危介质泄漏，存在着火、中毒或爆炸风险');
  if (affectsRun === true && hi) return mk('I', 'R3', '影响装置运行且介质为高危');
  if (affectsRun === true) return mk('II', 'R4', '影响装置运行，需尽快处理');
  if (phenomenon === 'leak' && mid) return mk('II', 'R5', '中等危险介质泄漏');
  if (structural) return mk('II', 'R6', '结构性失效，须评估继续使用条件');
  if (['vibration', 'noise', 'temperature', 'performance', 'electrical', 'instrument', 'failure'].includes(phenomenon)) {
    return mk('III', 'R7', `${PHEN_CN[phenomenon]}类缺陷，当前不影响运行，按计划处理`);
  }
  if (phenomenon === 'leak') return mk('III', 'R8', '低危介质泄漏（如水、蒸汽、氮气）');
  return mk('IV', 'R9', '一般性缺陷，不影响运行，可纳入日常维修计划');

  function mk(ivLevel, ruleId, basis) {
    const level = sc.fromIV[ivLevel];
    return { level, levelCn: sc.cn[level], basis, ruleId, dueDays: due[level], missing: [], sapPriority: sc.sapPriority[level], scheme };
  }
}

/**
 * 通知单类型建议（厂内可配置）：A/B 级或影响运行 → M2 故障报告；C 级 → M1 维修申请；未判定 → null
 */
function notificationType(level, affectsRun, scheme = DEFAULT_SCHEME) {
  if (level === 'undetermined' || !level) return null;
  const sc = SCHEMES[scheme];
  const top2 = sc.levels.slice(0, 2);
  if (top2.includes(level) || affectsRun === true) return 'M2';
  return 'M1';
}

module.exports = {
  classifyPhenomenon, PHEN_CN, PHEN_SAP_CODE, mediumHazard, HAZ_CN, parseAffects, disciplineOf,
  grade, SCHEMES, DEFAULT_SCHEME, LEVEL_CN, DUE, parseDueOverride, notificationType,
};
