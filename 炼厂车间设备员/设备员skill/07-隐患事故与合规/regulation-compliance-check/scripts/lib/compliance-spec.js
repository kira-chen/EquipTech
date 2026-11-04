'use strict';
/**
 * compliance-spec.js —— 法规标准条款 ↔ 本车间资料的对照规则表
 * 口径与 references/compliance-rules.md 同源。改动本文件前先读该文档。
 *
 * 核心原则（本技能的表述红线）：
 *  1. **状态只有四档**：已见对应材料 / 未见对应材料 / 材料不完整 / 需进一步确认。
 *     **绝不使用「符合」「不符合」作为判定结论** —— 达标与否由监管部门、内审或法务判定，本技能只做材料对照。
 *  2. **条款文本必须由用户提供**。本文件不内置任何真实条款编号与原文，不得凭记忆补全。
 *  3. 条款要求笼统、无法直接对照到具体资料 → needInterpretation，**不得自行解释条款含义后判定**。
 *  4. 找不到对应资料 → noEvidence「未见对应材料」，既不写「不符合」也不写「符合」。
 *  5. 匹配靠关键词命中，命中不到就是未见；**不做语义近似兜底**。
 */

/* ------------------------------------------------------------------ 资料类别词表
 * 每类给出「条款要求中出现的说法」与「资料名称中出现的说法」两组词。
 * 条款与资料只有落在同一具体类别、或直接共享特征词时才算对应上。
 */
/** 「用火」作业票词：前面不是「备 / 使 / 启 / 停 / 采 / 选 / 利」（备用火炬、使用火炬、启用火炬……），后面不是「炬 / 嘴」 */
const USE_FIRE = /(?<![备使启停采选利])用火(?![炬嘴])/;
/** 词表项可以是字符串（包含匹配）或正则 */
const hasWord = (t, k) => (k instanceof RegExp ? k.test(t) : t.includes(k));

const CATEGORIES = [
  { key: 'system', name: '管理制度与职责文件', rule: ['制度', '管理办法', '职责', '责任制', '管理规定', '实施细则'], file: ['制度', '管理办法', '职责', '责任制', '管理规定', '细则'] },
  // 注意：'台账' 单独一个词不作为条款侧的归类依据。隐患台账、检修台账、持证台账……
  // 各类台账都带「台账」二字，只认这两个字会让任何一条提到台账的条款都对上设备台账，缺口反被掩盖。
  { key: 'ledger', name: '设备台账', rule: ['设备台账', '设施台账', '设备清单', '设备总账', '资产清单'], file: ['设备台账', '设施台账', '设备清单', '设备总账', '资产清单'] },
  { key: 'archive', name: '设备技术档案', rule: ['技术档案', '设备档案', '设备履历', '随机资料', '出厂资料'], file: ['技术档案', '设备档案', '履历', '随机资料', '出厂资料'] },
  { key: 'registration', name: '使用登记与告知资料', rule: ['使用登记', '登记证', '开工告知', '注销', '变更登记'], file: ['使用登记', '登记证', '告知', '注销'] },
  { key: 'periodicInspection', name: '定期检验报告', rule: ['定期检验', '法定检验', '检验周期', '检验有效期', '定期检测', '年度检验'], file: ['定期检验', '检验报告', '检测报告', '检验证书', '年度检验'] },
  { key: 'ndt', name: '无损检测与测厚记录', rule: ['无损检测', '射线', '超声', '测厚', '腐蚀监测', '壁厚'], file: ['无损', '探伤', '射线', '超声', '测厚', '腐蚀监测', '壁厚'] },
  { key: 'safetyValve', name: '安全阀与安全附件校验记录', rule: ['安全阀', '安全附件', '爆破片', '泄放装置', '铅封'], file: ['安全阀', '安全附件', '爆破片', '泄放', '铅封'] },
  { key: 'calibration', name: '计量器具校验检定记录', rule: ['校验', '检定', '计量器具', '压力表', '温度计', '标定', '液位计'], file: ['校验', '检定', '计量', '压力表', '温度计', '标定', '液位计'] },
  { key: 'interlock', name: '安全联锁与报警记录', rule: ['联锁', '报警器', '可燃气体', '有毒气体', '安全仪表', 'SIS'], file: ['联锁', '报警', '可燃气体', '有毒气体', '安全仪表', 'SIS'] },
  { key: 'patrol', name: '巡检点检记录', rule: ['巡检', '点检', '日常检查', '班检', '运行记录'], file: ['巡检', '点检', '班检', '运行记录'] },
  // 条款侧不用裸「维修」「维护」：「维修人员」「维护管理」指的是人和职责，不是检修记录。
  { key: 'maintenance', name: '检修与维护保养记录', rule: ['检修', '维修记录', '维修台账', '保养', '维护保养', '大修', '中修'], file: ['检修', '维修', '保养', '维护', '大修', '中修'] },
  { key: 'plan', name: '计划与方案', rule: ['年度计划', '检修计划', '施工方案', '检修方案', '实施方案', '计划应'], file: ['计划', '方案'] },
  { key: 'procedure', name: '操作规程与作业指导书', rule: ['操作规程', '作业指导书', '工艺规程', '安全操作规程', '规程'], file: ['操作规程', '作业指导书', '工艺规程', '规程'] },
  // 中石化口径正式名称是「用火作业」；「动火」并列保留，旧票面与旧条款仍大量使用。
  // 「用火」用正则 USE_FIRE：排除「备用火炬 / 备用火嘴 / 使用火炬 / 启用火炬」等子串误命中（与 inspection-evidence-package 的 evidence-spec.js 同口径）
  { key: 'permit', name: '作业票与作业许可', rule: ['作业票', '作业许可', USE_FIRE, '动火', '受限空间', '高处作业', '吊装', '临时用电', '盲板', '动土', '断路'], file: ['作业票', '作业许可', USE_FIRE, '动火', '受限空间', '高处', '吊装', '临时用电', '盲板', '动土', '断路'] },
  // 缺陷故障与隐患分两类：设备缺陷/故障走 SAP PM 通知单，隐患走隐患排查治理台账，是两本账，不能互相充数
  { key: 'defect', name: '缺陷与故障记录', rule: ['缺陷', '报修', '故障'], file: ['缺陷', '报修', '故障'] },
  { key: 'hazard', name: '隐患排查治理记录', rule: ['隐患排查', '隐患治理', '隐患登记', '事故隐患', '隐患'], file: ['隐患'] },
  { key: 'training', name: '培训教育与持证记录', rule: ['培训', '教育', '持证', '取证', '操作证', '上岗证', '资格', '考核', '作业人员资格'], file: ['培训', '教育', '持证', '操作证', '上岗证', '资格', '考核', '证书'] },
  { key: 'drill', name: '应急预案与演练记录', rule: ['应急预案', '应急演练', '演练', '事故预案', '应急处置'], file: ['应急', '演练', '预案'] },
  { key: 'accident', name: '事故与异常情况报告', rule: ['事故报告', '事故调查', '异常情况报告', '事故处理', '险情'], file: ['事故', '调查报告', '异常情况', '险情'] },
  { key: 'acceptance', name: '验收与投用资料', rule: ['验收', '竣工', '投用', '安装监督检验', '监督检验'], file: ['验收', '竣工', '投用', '监督检验'] },
  { key: 'change', name: '变更与报废记录', rule: ['变更管理', '变更', '报废', '停用', '改造', '移装'], file: ['变更', '报废', '停用', '改造', '移装'] },
  { key: 'environment', name: '环保监测与排放记录', rule: ['排放', '废水', '废气', '固废', '危废', '噪声', '在线监测', '环保'], file: ['排放', '废水', '废气', '固废', '危废', '噪声', '在线监测', '环保'] },
  { key: 'energy', name: '能耗计量与用能记录', rule: ['能耗', '用能', '节能', '电耗', '水耗', '蒸汽消耗'], file: ['能耗', '用能', '节能', '电耗', '水耗'] },
  { key: 'spare', name: '备件与物资记录', rule: ['备件', '备品', '物资', '库存'], file: ['备件', '备品', '物资', '库存'] },
  { key: 'contractor', name: '外委与承包商管理资料', rule: ['外委', '承包商', '分包', '相关方', '施工单位资质'], file: ['外委', '承包商', '分包', '相关方', '施工单位'] },
  { key: 'meeting', name: '会议与活动记录', rule: ['会议', '例会', '专题会', '交底', '安全活动'], file: ['会议', '例会', '纪要', '交底', '安全活动'] },
];

const CAT_BY_KEY = new Map(CATEGORIES.map((c) => [c.key, c]));

/** 归一：去空白与常见分隔符，便于包含匹配 */
function norm(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[\s　\-_（）()【】\[\]、，,。.：:；;""''"']/g, '');
}

/** 条款要求文本落在哪些资料类别（可多类） */
function ruleCategories(text) {
  const t = norm(text);
  const hit = [];
  for (const c of CATEGORIES) if (c.rule.some((k) => hasWord(t, k))) hit.push(c.key);
  return hit;
}

/**
 * 资料侧别名：系统导出文件（EAM / SAP PM / 作业票系统）的常用名称，类别词表认不出时补充。
 * 只收「这个名称本身就是该类资料」的说法，正则作用在归一后的名称上（已去掉空白与 . - _ 等分隔符）。
 *  - 故障记录：EAM 故障历史导出，每行带处理措施（实际检修做法），与「检修历史」「维修记录」是同一份数据，
 *    算检修记录；同时仍按「故障」二字归缺陷与故障类。只带「故障」二字的（故障率统计等）不算检修记录。
 *  - 通知单：SAP PM 维修通知单，即缺陷/故障报修单。只认以「通知单」开头，或前缀为维修/缺陷/故障/报修/设备/PM/SAP 的，
 *    「停电通知单」「会议通知单」「整改通知单」不归。
 *  - 作业清单：作业票系统导出的作业票清单。只认以「作业清单」开头的，「检修作业清单」这类说的是检修工作量，不归作业许可。
 */
const FILE_ALIASES = [
  { key: 'maintenance', re: /故障记录|故障维修|故障处理记录|检修历史|维修历史|维修工单|检修工单|^工单/i },
  { key: 'defect', re: /(?:^|维修|缺陷|故障|报修|设备|PM|SAP)通知单/i },
  { key: 'permit', re: /^作业清单|作业票清单|特殊作业/i },
];

/** 资料名称落在哪些类别（可多类）：类别词表 + 资料侧别名，均为正面命中 */
function fileCategories(name) {
  const t = norm(name);
  const hit = [];
  for (const c of CATEGORIES) {
    if (c.file.some((k) => hasWord(t, k)) || FILE_ALIASES.some((a) => a.key === c.key && a.re.test(t))) hit.push(c.key);
  }
  return hit;
}

/**
 * 一份资料的归类：先读资料清单的「资料类型」列，再读资料名称，两者命中的类别合并。
 * 返回 {keys, from}，from[key] 记该类别最先由哪一列认出：「资料类型」/「资料名称」/「资料名称+资料类型」（两列连读才命中）。
 * 「台账」「记录」「文件」这类泛称落不到任何具体类别，资料名称也认不出时就归不进任何类别，**不按信息缺失推断**。
 */
function materialCategories(name, declaredType) {
  const type = String(declaredType === null || declaredType === undefined ? '' : declaredType).trim();
  const from = {};
  if (type) for (const k of fileCategories(type)) from[k] = '资料类型';
  for (const k of fileCategories(name)) if (!from[k]) from[k] = '资料名称';
  if (type) for (const k of fileCategories(`${name} ${type}`)) if (!from[k]) from[k] = '资料名称+资料类型';
  return { keys: CATEGORIES.map((c) => c.key).filter((k) => from[k]), from };
}

/**
 * 从条款文本抽「特征词」——足以单独定位一份资料的具体说法。
 * 「设备」「记录」「资料」「管理」「单位」「企业」这类泛词一律不作为对照依据，
 * 否则任何一份资料都能对上任何一条条款，缺口全被掩盖。
 */
const FEATURE_TERMS = [
  '压力容器', '压力管道', '锅炉', '起重机械', '厂内机动车', '特种设备',
  '储罐', '加热炉', '机泵', '压缩机', '冷换设备', '转动设备', '静设备', '电气设备', '仪表设备',
  '防雷', '防静电', '接地电阻', '绝缘电阻', '阴极保护', '防腐', '保温',
  '密封点', '泄漏检测', 'LDAR', '振动监测', '润滑', '油品分析',
  '消防设施', '消防器材', '气防', '正压呼吸器', '洗眼器',
];
function featureWords(text) {
  const t = String(text || '');
  const out = [];
  for (const m of t.matchAll(/[A-Za-z]{1,3}-\d{2,5}[A-Za-z]?/g)) out.push(norm(m[0]));
  const n = norm(t);
  for (const w of FEATURE_TERMS) if (n.includes(norm(w))) out.push(norm(w));
  return [...new Set(out)].filter(Boolean);
}

/**
 * 条款 ↔ 资料是否对应上。**从严**：只认两种依据。
 *  - 'category:<key>'  条款要求与资料落在同一个具体资料类别
 *  - 'feature:<词>'    条款里的具体特征词直接出现在资料名中
 * **不做语义近似、不做泛词兜底、不做编辑距离兜底。**
 */
function matchRule(ruleText, fileName, rCats, fCats) {
  const cats = rCats || ruleCategories(ruleText);
  const fcats = fCats || fileCategories(fileName);
  for (const k of cats) if (fcats.includes(k)) return { matched: true, basis: `category:${k}` };
  const f = norm(fileName);
  for (const w of featureWords(ruleText)) if (f.includes(w)) return { matched: true, basis: `feature:${w}` };
  return { matched: false, basis: null };
}

/* ------------------------------------------------------------------ 条款笼统性识别
 * 条款要求笼统、无法直接对照到某一份具体资料时，一律归入 needInterpretation，
 * **绝不自行解释条款含义后判定**。判断只看条款文本本身，不看有没有资料。
 */

/** 明显笼统的提法：只提原则性要求，没有指向任何具体资料 */
const VAGUE_TERMS = [
  '健全', '完善', '加强', '有效', '适当', '必要', '合理', '妥善', '及时', '定期',
  '相应', '相关', '有关', '适用', '符合要求', '满足要求', '视情况', '根据需要',
  '原则上', '一般', '必要时', '应当重视', '高度重视', '切实', '严格执行',
];

/** 指向具体资料的名词——出现这类词就说明条款点到了可对照的资料 */
function hasConcreteTarget(text) {
  return ruleCategories(text).length > 0 || featureWords(text).length > 0;
}

/**
 * 条款是否笼统到无法直接对照。返回 {vague:boolean, reason:string|null}
 * 判据（任一成立即笼统）：
 *   V1 条款文本没有落到任何具体资料类别，也没有任何特征词 —— 无从对照到某份资料
 *   V2 条款文本很短（去标点后 < 8 字），信息不足以定位资料
 *   V3 条款只由原则性词汇构成（命中笼统词且没有具体资料指向）
 * **不做任何"猜它大概是指某某台账"式的补全。**
 */
function vagueness(text) {
  const raw = String(text || '');
  const n = norm(raw);
  if (!n) return { vague: true, reason: '条款要求文本为空，无法对照' };
  const concrete = hasConcreteTarget(raw);
  if (n.length < 8 && !concrete) {
    return { vague: true, reason: `条款要求表述过短（${n.length} 字）且未指向任何具体资料，无法直接对照` };
  }
  const hitVague = VAGUE_TERMS.filter((w) => n.includes(norm(w)));
  if (!concrete) {
    return {
      vague: true,
      reason: hitVague.length
        ? `条款要求为原则性表述（含「${hitVague.slice(0, 3).join('」「')}」），未指向任何具体资料类别，需由用户或法务明确其具体含义后再对照`
        : '条款要求未指向任何可对照的具体资料类别，需由用户明确其具体含义后再对照',
    };
  }
  return { vague: false, reason: null };
}

/* ------------------------------------------------------------------ 四档状态
 * 这是本技能唯一允许出现的状态用语。任何位置都不得替换成「符合 / 不符合」。
 */
const STATUS_CN = {
  hasEvidence: '已见对应材料',
  noEvidence: '未见对应材料',
  partialEvidence: '材料不完整',
  needInterpretation: '需进一步确认',
};
const STATUS_KEYS = Object.keys(STATUS_CN);

/** 明令禁止出现在产出中的结论性表述（selftest 会逐条扫描 md 与 json） */
const FORBIDDEN_TERMS = ['符合', '不符合', '达标', '不达标', '合规', '违规', '违法', '合格', '不合格', '法律责任'];

module.exports = {
  CATEGORIES, CAT_BY_KEY, FEATURE_TERMS, VAGUE_TERMS, FILE_ALIASES,
  norm, ruleCategories, fileCategories, materialCategories, featureWords, matchRule,
  hasConcreteTarget, vagueness,
  STATUS_CN, STATUS_KEYS, FORBIDDEN_TERMS,
};
