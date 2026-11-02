'use strict';
/**
 * evidence-spec.js —— 迎检资料比对规则表
 * 口径与 references/evidence-rules.md、references/common-checklists.md 同源。
 *
 * 核心原则（改动本文件前先读 references/evidence-rules.md）：
 *  1. 找不到对应材料 → missing，标注「未找到对应材料」。**不得用相近材料充数，不得给出「可用 XX 替代」的建议。**
 *  2. 材料存在但时间范围不覆盖检查期 → partialCoverage，如实写覆盖区间，**不得按完整覆盖处理**。
 *  3. 匹配靠关键词命中，命中不到就是找不到；**不做语义近似兜底**。
 */

/* ------------------------------------------------------------------ 资料类别词表
 * 每一类给出「检查项中出现的说法」与「材料文件名中出现的说法」两组词。
 * 检查项与材料只有落在同一类别、或直接共享特征词时才算匹配。
 * 共 25 类；与 regulation-compliance-check 的 compliance-spec.js（25 类）不是同一张表，差异见 references/evidence-rules.md 第八节。
 * 术语：作业许可按中石化八大类，「用火作业」为正式名称，「动火」作旧写法别名保留。
 */
const CATEGORIES = [
  { key: 'ledger', name: '设备台账', item: ['设备台账', '设施台账', '设备清单', '设备总表', '资产清单', '设备总账'], file: ['设备台账', '设施台账', '设备清单', '设备总表', '资产清单'] },
  { key: 'inspection', name: '巡检点检记录', item: ['巡检', '点检', '班检'], file: ['巡检', '点检', '班检'] },
  { key: 'maintenance', name: '检修与维修记录', item: ['检修', '维修', '保养', '维护'], file: ['检修', '维修', '保养', '维护'] },
  { key: 'plan', name: '计划与方案', item: ['检修计划', '施工方案', '检修方案', '作业指导书', '操作规程', '管理规程'], file: ['计划', '方案', '作业指导书', '规程'] },
  { key: 'permit', name: '作业票（作业许可）', item: ['作业票', '作业许可', '用火', '动火', '受限空间', '高处作业', '吊装', '临时用电', '盲板', '动土', '断路'], file: ['作业票', '作业许可', '用火', '动火', '受限空间', '高处', '吊装', '临时用电', '盲板', '动土', '断路'] },
  { key: 'defect', name: '缺陷与隐患记录', item: ['缺陷', '隐患', '报修', '故障'], file: ['缺陷', '隐患', '报修', '故障'] },
  { key: 'inspectionReport', name: '检验检测报告', item: ['检验报告', '检测报告', '定期检验', '法定检验', '定期检测', '检验有效期', '检验'], file: ['检验报告', '检测报告', '定期检验', '检验', '探伤', '无损', '测厚'] },
  { key: 'calibration', name: '校验检定记录', item: ['校验', '检定', '计量', '标定'], file: ['校验', '检定', '计量', '标定'] },
  { key: 'safetyDevice', name: '安全附件与安全设施记录', item: ['安全阀', '安全附件', '报警器', '可燃气体', '联锁', '安全设施', '消防设施'], file: ['安全阀', '安全附件', '报警器', '可燃气体', '联锁', '安全设施', '消防'] },
  { key: 'training', name: '培训与资质记录', item: ['培训', '资质', '持证', '取证', '操作证', '上岗证', '考核', '特种作业人员', '人员资质'], file: ['培训', '资质', '持证', '操作证', '上岗证', '考核', '证书'] },
  { key: 'drill', name: '演练与应急记录', item: ['演练', '应急预案', '应急'], file: ['演练', '应急'] },
  { key: 'meeting', name: '会议与活动记录', item: ['会议记录', '例会', '专题会', '活动记录', '交底'], file: ['会议', '例会', '纪要', '交底'] },
  { key: 'environment', name: '环保监测与治理记录', item: ['排放', '废水', '废气', '固废', '危废', '噪声', '环保', '在线监测'], file: ['排放', '废水', '废气', '固废', '危废', '噪声', '环保', '在线监测'] },
  { key: 'energy', name: '能耗与计量记录', item: ['能耗', '用能', '蒸汽消耗', '电耗', '水耗'], file: ['能耗', '用能', '电耗', '水耗'] },
  { key: 'spare', name: '备件与物资记录', item: ['备件', '备品', '物资', '库存'], file: ['备件', '备品', '物资', '库存'] },
  { key: 'acceptance', name: '验收资料', item: ['验收', '竣工', '投用'], file: ['验收', '竣工', '投用'] },
  { key: 'archive', name: '设备档案', item: ['设备档案', '技术档案', '设备履历'], file: ['设备档案', '技术档案', '履历'] },
  { key: 'system', name: '制度与职责文件', item: ['制度', '职责', '管理办法', '责任制'], file: ['制度', '职责', '管理办法', '责任制'] },
  { key: 'specialEquipment', name: '特种设备管理资料', item: ['特种设备', '压力容器', '压力管道', '锅炉', '起重机', '使用登记'], file: ['特种设备', '压力容器', '压力管道', '锅炉', '起重机', '使用登记'] },
  // ---- 中石化炼化厂设备管理常见检查项补充（2026-10-26）
  { key: 'moc', name: '变更管理（MOC）资料', item: ['变更管理', 'MOC', '变更申请', '变更审批', '设备设施变更', '工艺技术变更', '变更台账', '临时变更'], file: ['变更', 'MOC'] },
  { key: 'interlock', name: '安全仪表与联锁（SIS）记录', item: ['联锁', 'SIS', '安全仪表', '联锁投用', '联锁摘除', '联锁旁路', '功能测试', '联锁定值'], file: ['联锁', 'SIS', '安全仪表', '旁路'] },
  { key: 'specialCare', name: '特护设备（大机组）记录', item: ['特护', '特护设备', '特护机组', '大机组', '关键机组', '特级维护'], file: ['特护', '大机组', '关键机组'] },
  { key: 'lubrication', name: '润滑管理（五定三过滤）记录', item: ['润滑', '五定三过滤', '五定', '三过滤', '换油', '油品分析', '油液监测', '加油记录'], file: ['润滑', '换油', '油品', '油液', '加油', '五定'] },
  { key: 'ldar', name: '泄漏检测与修复（LDAR）记录', item: ['LDAR', '泄漏检测', '密封点', '泄漏率', '泄漏点', '动静密封'], file: ['LDAR', '泄漏检测', '密封点', '泄漏'] },
  { key: 'equipmentFile', name: '一机一档', item: ['一机一档', '一台一档', '单机档案', '设备卡片', '设备履历卡'], file: ['一机一档', '一台一档', '单机档案', '设备卡片', '履历卡'] },
];

const CAT_BY_KEY = new Map(CATEGORIES.map((c) => [c.key, c]));

/** 归一：去空白与常见分隔符，便于包含匹配 */
function norm(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[\s　\-_（）()【】\[\]、，,。.：:；;"'"']/g, '');
}

/** 检查项文本落在哪些类别（可多类） */
function itemCategories(text) {
  const t = norm(text);
  const hit = [];
  for (const c of CATEGORIES) if (c.item.some((k) => t.includes(k))) hit.push(c.key);
  return hit;
}

/** 材料名称落在哪些类别（可多类） */
function fileCategories(name) {
  const t = norm(name);
  const hit = [];
  for (const c of CATEGORIES) if (c.file.some((k) => t.includes(k))) hit.push(c.key);
  return hit;
}

/**
 * 检查项 ↔ 材料是否匹配。**从严**：只认两种依据，宁可判为「未找到对应材料」，
 * 也不把相近材料算作证据（相近材料充数正是本技能明令禁止的）。
 *  - 'category:<key>'  检查项与材料落在同一个具体资料类别
 *  - 'feature:<词>'    检查项里的具体特征词（设备位号、专有名词）直接出现在材料名中
 * **不做语义近似、不做泛词兜底、不做编辑距离兜底。**
 */
function matchItem(itemText, fileName, itemCats, fileCats) {
  const cats = itemCats || itemCategories(itemText);
  const fcats = fileCats || fileCategories(fileName);
  for (const k of cats) if (fcats.includes(k)) return { matched: true, basis: `category:${k}` };
  const f = norm(fileName);
  for (const w of featureWords(itemText)) {
    if (f.includes(w)) return { matched: true, basis: `feature:${w}` };
  }
  return { matched: false, basis: null };
}

/**
 * 从检查项文本抽「特征词」——只取足以单独定位一份材料的具体说法：
 *  - 设备位号 / 编号样式（P-1101A、V-2301）
 *  - 特征词白名单中出现的专有说法
 * 「设备」「记录」「台账」「车间」「资料」这类泛词一律不作为匹配依据，
 * 否则任何一份材料都能对上任何一个检查项，缺口就被掩盖了。
 */
const FEATURE_TERMS = [
  '润滑油', '润滑管理', '油品分析', '油液监测', '防腐', '保温', '接地电阻', '绝缘电阻', '防雷防静电',
  '密封点', '泄漏检测', 'LDAR', '振动监测', '测厚', '腐蚀监测', '阴极保护',
  '转动设备', '静设备', '电气设备', '仪表设备', '机泵', '压缩机', '加热炉', '冷换设备', '储罐',
  '停用设备', '备用设备', '闲置设备', '报废', '技改', '变更管理', '开停工',
  '外委施工', '承包商', '监护', '交出', '复位',
];
function featureWords(text) {
  const t = String(text || '');
  const out = [];
  for (const m of t.matchAll(/[A-Za-z]{1,3}-\d{2,5}[A-Za-z]?/g)) out.push(norm(m[0]));
  const n = norm(t);
  for (const w of FEATURE_TERMS) if (n.includes(norm(w))) out.push(norm(w));
  return [...new Set(out)].filter(Boolean);
}

/* ------------------------------------------------------------------ 时间覆盖
 * 检查期 [from, to] 与材料时间区间 [mFrom, mTo] 比较。
 * 返回：
 *   'full'       完整覆盖
 *   'partial'    有交集但不完整（含只覆盖一端）
 *   'none'       无交集
 *   'unknown'    材料没有可解析的时间信息（**不得按完整覆盖处理**）
 *   'noPeriod'   未指定检查期，不做覆盖判定
 */
function coverage(period, mFrom, mTo) {
  if (!period || !period.from || !period.to) return 'noPeriod';
  if (!mFrom && !mTo) return 'unknown';
  const a = mFrom || mTo;
  const b = mTo || mFrom;
  if (b < period.from || a > period.to) return 'none';
  if (a <= period.from && b >= period.to) return 'full';
  return 'partial';
}

const STATUS_CN = {
  ready: '资料齐全',
  partial: '覆盖不全',
  missing: '未找到对应材料',
};

module.exports = { CATEGORIES, CAT_BY_KEY, FEATURE_TERMS, norm, itemCategories, fileCategories, matchItem, featureWords, coverage, STATUS_CN };
