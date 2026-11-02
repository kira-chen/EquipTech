'use strict';
/**
 * 重复故障判定规则引擎
 * 口径见 references/detection-rules.md。
 * 核心原则：
 *  1. 故障现象无信息量（空 / 只写「故障」「坏了」）→ uninformative，绝不参与重复判定；
 *  2. 相似判定是文本 bigram + 部位字段的机械匹配，matchBasis 必须写明依据；
 *  3. 只给出「建议开展根因分析」，绝不给出根本原因结论。
 */

// ---------------------------------------------------------------- 无信息描述
/**
 * 无信息描述白名单：整条描述去掉标点空白后落在这些词内，即视为无信息量。
 * 注意是「整条等于」而非「包含」，「机封故障」含具体部位信息，不算无信息。
 */
const UNINFORMATIVE_WORDS = [
  '故障', '坏了', '坏', '有问题', '问题', '异常', '不好用', '不正常', '损坏',
  '维修', '检修', '修理', '处理', '缺陷', '不能用', '用不了', '停了', '停机',
  '报修', '临修', '抢修', '无', '暂无', '待查', '不详', '未填', '其他', '待定',
  'NA', 'N/A', '-', '/', '—', '?', '？',
];
const UNINFORMATIVE_SET = new Set(UNINFORMATIVE_WORDS.map((x) => x.toUpperCase()));
/** 最短有效描述长度（去标点空白后）：少于该长度且不含具体部位/现象词的描述视为无信息 */
const MIN_DESC_LEN = 4;
/**
 * 泛指主语：只说明「谁」而不说明「什么现象」的词。
 * 「设备故障」「机器坏了」= 泛指主语 + 泛指故障词 → 仍无信息量。
 * 注意不含「机封」「轴承」等具体部位词，那些属于有效信息。
 */
const GENERIC_SUBJECTS = ['设备', '机器', '机组', '装置', '该设备', '本设备', '此设备', '这台'];

function cleanText(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/[\s　]/g, '')
    .replace(/[，。；、！,.;!：:（）()【】\[\]"'"'`~]/g, '');
}

/**
 * 现象描述是否无信息量。
 * 返回 {uninformative:boolean, reason:string|null}
 */
function checkInformative(desc, faultCode) {
  const t = cleanText(desc);
  // SAP 损坏/故障代码本身就是结构化的故障信息：有代码的记录不因文本笼统而被排除
  if (cleanText(faultCode)) return { uninformative: false, reason: null, byCode: true };
  if (t === '') return { uninformative: true, reason: '故障现象为空' };
  if (UNINFORMATIVE_SET.has(t.toUpperCase())) return { uninformative: true, reason: `故障现象仅填写「${t}」，无具体现象信息` };
  // 去掉无信息词后仍无剩余内容（如「设备故障」「泵坏了」这类只有对象+故障的写法）
  let rest = t;
  for (const w of UNINFORMATIVE_WORDS.concat(GENERIC_SUBJECTS)) {
    if (w.length >= 2) rest = rest.split(w).join('');
  }
  if (cleanText(rest).length === 0) return { uninformative: true, reason: `故障现象「${t}」去除「故障/坏了」等泛指词后无具体信息` };
  if (t.length < MIN_DESC_LEN && !PHEN_ANY.test(t)) {
    return { uninformative: true, reason: `故障现象「${t}」过短（少于 ${MIN_DESC_LEN} 字）且未匹配到任何现象类型` };
  }
  return { uninformative: false, reason: null };
}

// ---------------------------------------------------------------- 现象分类（与 defect-intake-grading 口径一致）
const PHEN_PATTERNS = [
  ['leak', /泄漏|渗漏|滴漏|漏油|漏气|漏水|漏料|冒油|喷漏|外漏|窜漏|内漏|串油|串气|串漏/],
  ['vibration', /振动|震动|抖动|摆动/],
  ['noise', /异响|异音|噪音|响声|杂音|敲击声|摩擦声/],
  ['temperature', /温度高|温升|过热|发烫|高温|超温|温度异常|温度偏高/],
  ['corrosion', /腐蚀|锈蚀|生锈|减薄|点蚀|冲刷/],
  ['deformation', /变形|开裂|裂纹|裂缝|鼓包|凹陷|断裂|折断/],
  ['blocked', /堵塞|结焦|结垢|积灰|堵了|不通/],
  ['performance', /效率|出力|流量不足|压力不足|打不上量|抽空|汽蚀|降量/],
  ['electrical', /绝缘|接地|短路|跳闸|过流|电流高|电压|缺相/],
  ['instrument', /指示不准|示值|偏差|信号|显示异常|无显示|飘移|误报/],
  ['seize', /卡涩|卡死|抱轴|盘不动|盘车沉重|咬死/],
  ['failure', /失效|拒动|不动作|失灵/],
];
const PHEN_CN = {
  leak: '泄漏', vibration: '振动', noise: '异响', temperature: '温升',
  corrosion: '腐蚀', deformation: '变形开裂', blocked: '堵塞结焦',
  performance: '性能下降', electrical: '电气异常', instrument: '仪表异常',
  seize: '卡涩抱死', failure: '失效拒动', other: '其他',
};
const PHEN_ANY = new RegExp(PHEN_PATTERNS.map(([, re]) => re.source).join('|'));

function classifyPhenomenon(desc) {
  const s = String(desc || '');
  for (const [k, re] of PHEN_PATTERNS) if (re.test(s)) return k;
  return 'other';
}

// ---------------------------------------------------------------- 部位归一
/** 常见故障部位同义归并，便于「同部位」判定；不在表内的按原文去空白比对 */
const PART_GROUPS = [
  ['机械密封', /机封|机械密封|密封件|填料函|填料密封/],
  ['轴承', /轴承|轴瓦|滚动体|轴承箱/],
  ['联轴器', /联轴器|对轮|靠背轮/],
  ['电机', /电机|马达|电动机/],
  ['叶轮', /叶轮|转子|叶片|导叶/],
  ['管线法兰', /法兰|管线|接管|短节|弯头/],
  ['阀门', /阀门|阀|闸阀|截止阀|止回阀|调节阀/],
  ['润滑系统', /润滑|油站|油路|油泵|油箱|油封/],
  ['冷却系统', /冷却|冷却水|冷却器|水套/],
  ['管束', /管束|换热管|列管|U型管/],
  ['筒体壳体', /筒体|壳体|简体|外壳|封头/],
  ['仪表元件', /变送器|热电偶|压力表|传感器|探头|仪表/],
  ['控制回路', /控制柜|PLC|DCS|回路|接线|端子/],
];
function normPart(part) {
  const t = cleanText(part);
  if (!t) return null;
  for (const [name, re] of PART_GROUPS) if (re.test(t)) return name;
  return t;
}

// ---------------------------------------------------------------- 文本相似
/** bigram Dice 系数；描述不足 2 字时按整串相等处理 */
function textSim(a, b) {
  const ta = cleanText(a), tb = cleanText(b);
  if (!ta || !tb) return 0;
  if (ta.length < 2 || tb.length < 2) return ta === tb ? 1 : 0;
  const g = (t) => { const out = new Set(); for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2)); return out; };
  const A = g(ta), B = g(tb);
  let inter = 0; for (const x of A) if (B.has(x)) inter++;
  return (2 * inter) / (A.size + B.size);
}

/**
 * similarity(x, y) —— 故障记录相似度
 * = 0.5 × 现象文本 bigram Dice
 * + 0.3 × 故障部位（归一后）是否相同
 * + 0.2 × 现象类型是否相同
 * 返回 {score, matchBasis[]}：matchBasis 逐项写明相似依据，供人工复核。
 * **这是文本与字段的机械匹配，不代表两次故障同因。**
 */
function similarity(x, y) {
  const t = textSim(x.desc, y.desc);
  const px = normPart(x.part), py = normPart(y.part);
  const samePart = px !== null && py !== null && px === py;
  const samePhen = x.phenomenon === y.phenomenon && x.phenomenon !== 'other';
  const cx = normCode(x.faultCode), cy = normCode(y.faultCode);
  const matchBasis = [];
  // SAP 损坏/故障代码优先：双方都有代码时按代码定相似，不再依赖文本
  if (cx && cy) {
    if (cx === cy) {
      matchBasis.push(`SAP 损坏/故障代码同为「${cx}」（代码优先于文本相似）`);
      if (samePart) matchBasis.push(`故障部位同为「${px}」`);
      return { score: 1, matchBasis, samePart, samePhen, textScore: t, sameCode: true, byCode: true };
    }
    matchBasis.push(`SAP 损坏/故障代码不同（${cx} / ${cy}），不归为同一相似组`);
    return { score: 0, matchBasis, samePart, samePhen, textScore: t, sameCode: false, byCode: true };
  }
  const score = 0.5 * t + 0.3 * (samePart ? 1 : 0) + 0.2 * (samePhen ? 1 : 0);
  if (cx || cy) matchBasis.push('仅一方有 SAP 损坏/故障代码，退回文本与字段比对');
  matchBasis.push(`现象文本 bigram 相似度 ${t.toFixed(2)}`);
  if (samePart) matchBasis.push(`故障部位同为「${px}」`);
  else if (px === null || py === null) matchBasis.push('故障部位字段有缺失，未参与比对');
  else matchBasis.push(`故障部位不同（${px} / ${py}）`);
  if (samePhen) matchBasis.push(`现象类型同为「${PHEN_CN[x.phenomenon]}」`);
  else matchBasis.push('现象类型不同或无法归类');
  return { score, matchBasis, samePart, samePhen, textScore: t, sameCode: false, byCode: false };
}

/** SAP 损坏/故障代码归一：去空白、统一大写；空返回 null */
function normCode(v) {
  const t = cleanText(v).toUpperCase();
  return t || null;
}

// ---------------------------------------------------------------- 阈值
/** 默认阈值（中石化口径：同一设备同一部位一年内 ≥2 次即重复故障）：同设备同部位 ≥2 次、同设备同现象 ≥2 次 */
const DEFAULT_PART_MIN = 2;
const DEFAULT_PHEN_MIN = 2;
/** 默认统计区间：截止日向前 12 个自然月（「一年内」） */
const DEFAULT_PERIOD_MONTHS = 12;
/** 同型号共性故障阈值：涉及台数 ≥2 且总次数 ≥3 */
const DEFAULT_MODEL_EQUIP_MIN = 2;
const DEFAULT_MODEL_COUNT_MIN = 3;
/** 相似度阈值：≥ 该值才归入同一相似故障组 */
const DEFAULT_SIM = 0.55;
/** 建议统计区间（天）：短于 lo 会漏判，长于 hi 会掺入已整改的历史问题 */
const PERIOD_ADVICE = { lo: 180, hi: 365 };

/**
 * 规则号：
 *  D1 同设备同部位达阈值
 *  D2 同设备同现象达阈值
 *  D3 同型号共性故障（涉及台数与总次数均达阈值）
 *  D4 故障间隔缩短（相邻间隔单调递减且末次间隔 ≤ 首次间隔的 60%）
 *  U1 故障现象无信息量，不参与重复判定
 */
const RULE_CN = {
  D1: '同设备同部位重复故障',
  D2: '同设备同现象重复故障',
  D3: '同型号/同类设备共性故障',
  D4: '故障间隔缩短',
  U1: '故障现象无信息量，未参与重复判定',
};

const DISCLAIMER = '本结果为频次统计与文本相似匹配，重复故障的根本原因须由设备工程师组织专项分析确定';

module.exports = {
  cleanText, checkInformative, UNINFORMATIVE_WORDS, GENERIC_SUBJECTS, MIN_DESC_LEN,
  classifyPhenomenon, PHEN_CN, normPart, PART_GROUPS,
  textSim, similarity, normCode,
  DEFAULT_PART_MIN, DEFAULT_PHEN_MIN, DEFAULT_MODEL_EQUIP_MIN, DEFAULT_MODEL_COUNT_MIN,
  DEFAULT_SIM, DEFAULT_PERIOD_MONTHS, PERIOD_ADVICE, RULE_CN, DISCLAIMER,
};
