'use strict';
/**
 * audit-spec.js —— 自查表预填规则表
 * 口径与 references/fill-rules.md 同源（规则号一一对应）。改本文件前必须先读该文档。
 *
 * 本技能的命脉，三条：
 *  1. **判断类 / 评价类 / 承诺类自查项一律留空标 needJudgment**，绝不预填「符合」「已落实」「健全」。
 *     判断类识别优先级最高：只要命中 J 系列任一规则，无论有没有数据源，一律 needJudgment。
 *  2. **有数据源但数据缺失 → noData 留空**并说明缺什么数据，绝不按「符合」处理。
 *  3. 预填只做两类事实的搬运：**有没有、多少、什么时候**。不做任何达标 / 合规 / 优劣判定。
 */

/* ================================================================== 一、判断类识别（J 系列）
 * 每条规则给出规则号、名称、命中词、说明。命中即 needJudgment，不可预填。
 * 词表按「谓语/评价词」而非主语设计：主语（制度、台账、培训）本身是中性的，
 * 「是否健全」「是否到位」这类评价谓语才是判断类的标志。
 */
const JUDGMENT_RULES = [
  {
    id: 'J1', name: '健全性评价',
    words: ['健全', '完善', '完备', '完整有效', '系统完整', '科学合理', '合理完善'],
    desc: '「是否健全 / 是否完善」属对管理体系的整体评价，无客观量纲，须责任人判断',
  },
  {
    id: 'J2', name: '落实到位评价',
    words: ['落实到位', '是否落实', '已落实', '执行到位', '是否到位', '贯彻落实', '严格执行', '认真执行', '落实情况'],
    desc: '「落实是否到位」是对执行质量的主观评价，台账只能证明做没做，不能证明到不到位',
  },
  {
    id: 'J3', name: '职责与责任评价',
    words: ['责任明确', '职责明确', '职责清晰', '责任落实', '责任到人', '明确到人', '落实到人', '责任制落实', '分工明确', '权责', '是否明确'],
    desc: '责任是否明确须结合实际岗位运行判断，不能由台账有无直接推出',
  },
  {
    id: 'J4', name: '有效性评价',
    words: ['有效性', '是否有效', '培训有效', '效果', '成效', '有实效', '取得实效', '运行有效'],
    desc: '有效性、效果类评价须责任人结合实际情况判断',
  },
  {
    id: 'J5', name: '措施得当评价',
    words: ['得当', '得力', '恰当', '适当', '适宜', '措施有力', '针对性强', '可行', '切实可行'],
    desc: '措施是否得当属专业判断，不能由记录条数推出',
  },
  {
    id: 'J6', name: '符合性/达标判定',
    words: ['符合要求', '是否符合', '满足要求', '是否达标', '达到要求', '合规', '是否合规', '符合规定', '达标情况'],
    desc: '合规达标判定不属本技能范围（用 regulation-compliance-check），一律留空',
  },
  {
    id: 'J7', name: '规范性评价',
    words: ['规范', '是否规范', '标准化', '规范化', '整洁', '良好', '状况良好', '运行正常', '完好'],
    desc: '规范、良好、完好属状态评价，须现场确认，不能由记录条数推出',
  },
  {
    id: 'J8', name: '承诺与保证',
    words: ['承诺', '保证', '确保', '决不', '杜绝', '不再发生', '严禁', '负责到底'],
    desc: '承诺类表述涉及责任承担，只能由责任人本人填写',
  },
  {
    id: 'J9', name: '意识与能力评价',
    words: ['意识', '能力', '素质', '熟悉掌握', '熟练', '掌握程度', '知晓', '清楚了解'],
    desc: '人员意识与能力须通过考核与观察判断，不能由培训记录条数推出',
  },
  {
    id: 'J10', name: '隐患判定与风险评价',
    words: ['存在隐患', '有无隐患', '存在重大隐患', '重大隐患', '风险可控', '风险受控', '安全可靠', '隐患排查到位', '重大风险', '风险是否'],
    desc: '是否构成隐患、风险是否可控属专业判定，须责任人现场核实',
  },
  {
    id: 'J11', name: '原因分析与整改评价',
    words: ['原因分析', '分析透彻', '整改彻底', '闭环有效', '举一反三', '触类旁通', '整改到位'],
    desc: '整改是否彻底、分析是否透彻属评价性结论，不能由整改记录状态直接推出',
  },
  {
    id: 'J12', name: '适用性与充分性评价',
    words: ['适用', '适用性', '充分', '充分性', '足够', '满足生产需要', '匹配'],
    desc: '适用、充分属相对判断，须结合工艺与生产实际由责任人判断',
  },
  {
    id: 'J13', name: '总体结论与自评',
    words: ['总体评价', '自评结论', '综合评价', '整体情况', '总体情况', '评价意见', '自查结论', '总评'],
    desc: '总体结论是自查表的最终结论，必须由责任人填写并签字',
  },
  {
    id: 'J14', name: '主观程度副词',
    words: ['及时', '是否及时', '按时完成情况', '认真', '严格', '全面', '深入', '扎实'],
    desc: '及时、认真、全面这类程度词没有客观口径，须责任人判断',
  },
  {
    id: 'J15', name: '改进建议与下一步',
    words: ['建议', '下一步', '改进措施', '整改计划', '拟采取', '下步打算', '努力方向'],
    desc: '改进建议与下一步安排属主观填报内容，由责任人填写',
  },
];

/* ================================================================== 二、客观项识别（O 系列）
 * 只有命中 O 系列、且未命中任何 J 系列，才进入取数流程。
 * kind 决定取数方式与填入格式。
 */
const OBJECTIVE_RULES = [
  {
    id: 'O1', name: '有无类', kind: 'exist',
    words: ['是否建立', '有无', '是否有', '是否编制', '是否办理', '是否登记', '是否配备', '是否设置', '是否取得'],
    desc: '台账 / 记录 / 证件在不在，可由台账条目直接查到',
  },
  {
    id: 'O2', name: '数量类', kind: 'count',
    words: ['数量', '台数', '台套', '共有', '几台', '几项', '几人', '人数', '份数', '条数', '合计数'],
    desc: '数量可由台账计数直接得出',
  },
  {
    id: 'O3', name: '日期类', kind: 'date',
    words: ['日期', '时间', '上次', '最近一次', '最后一次', '检验日期', '校验日期', '投用日期', '完成日期'],
    desc: '日期可由台账字段直接取值',
  },
  {
    id: 'O4', name: '到期类', kind: 'due',
    words: ['是否到期', '是否超期', '有效期', '到期日', '下次检验', '下次校验', '是否在有效期内', '超期数量'],
    desc: '到期与否由台账中的到期日与自查时点比较得出（只报事实，不判合规）',
  },
  {
    id: 'O5', name: '齐全类（按条目计）', kind: 'complete',
    words: ['是否齐全', '是否完整', '是否全部', '是否逐台', '覆盖率', '是否全覆盖'],
    desc: '齐全与否只按「台账条目是否全部有对应字段」计数，**不做「管理是否完备」的评价**',
  },
  {
    id: 'O6', name: '名称与编号类', kind: 'text',
    words: ['名称', '编号', '位号', '型号', '规格', '责任人姓名', '联系方式', '装置名称'],
    desc: '标识信息可由台账字段直接取值',
  },
];

/* ================================================================== 三、数据源类别
 * 自查项 ↔ 台账数据表的类别对应。与 references/input-spec.md 同源。
 * 口径从严：只认同类，不做语义近似兜底（近似兜底会把无关台账算成依据）。
 */
const SOURCES = [
  { key: 'equipment', name: '设备台账', item: ['设备台账', '设备清单', '设备总数', '设备数量', '在用设备', '资产'], sheet: ['设备台账', '设备清单', '设备总表', '资产台账'] },
  { key: 'special', name: '特种设备台账', item: ['特种设备', '压力容器', '压力管道', '锅炉', '起重机', '使用登记'], sheet: ['特种设备', '压力容器', '压力管道', '特种设备台账'] },
  { key: 'inspection', name: '检验检测台账', item: ['定期检验', '检验报告', '检测报告', '检验有效期', '法定检验', '探伤', '测厚'], sheet: ['检验台账', '检验记录', '定期检验', '检测台账'] },
  { key: 'calibration', name: '校验检定台账', item: ['校验', '检定', '计量器具', '标定', '仪表校验'], sheet: ['校验台账', '检定台账', '计量台账', '仪表校验'] },
  { key: 'safetyValve', name: '安全阀台账', item: ['安全阀', '安全附件', '爆破片', '铅封'], sheet: ['安全阀台账', '安全附件台账', '安全阀'] },
  { key: 'patrol', name: '巡检点检记录', item: ['巡检', '点检', '班检', '巡回检查'], sheet: ['巡检记录', '点检记录', '巡检台账'] },
  { key: 'maintenance', name: '检修维修记录', item: ['检修', '维修', '保养', '润滑'], sheet: ['检修记录', '维修记录', '检修台账', '保养记录'] },
  { key: 'defect', name: '缺陷隐患台账', item: ['缺陷', '隐患', '报修', '故障', '整改单'], sheet: ['缺陷台账', '隐患台账', '缺陷记录', '隐患排查'] },
  { key: 'training', name: '培训与资质台账', item: ['培训', '资质', '持证', '操作证', '上岗证', '特种作业人员', '证书'], sheet: ['培训记录', '资质台账', '人员台账', '持证台账'] },
  { key: 'drill', name: '演练记录', item: ['演练', '应急预案', '应急'], sheet: ['演练记录', '应急演练', '演练台账'] },
  { key: 'permit', name: '作业票台账', item: ['作业票', '动火', '受限空间', '高处作业', '吊装', '临时用电', '盲板'], sheet: ['作业票台账', '作业票', '票证台账'] },
  { key: 'spare', name: '备件台账', item: ['备件', '备品', '物资', '库存'], sheet: ['备件台账', '备品台账', '物资台账'] },
  { key: 'env', name: '环保监测记录', item: ['排放', '废水', '废气', '固废', '危废', '噪声', '在线监测'], sheet: ['环保记录', '排放台账', '监测记录', '危废台账'] },
  { key: 'energy', name: '能耗计量记录', item: ['能耗', '用能', '电耗', '水耗', '蒸汽消耗'], sheet: ['能耗台账', '计量台账', '能耗记录'] },
  { key: 'meeting', name: '会议与活动记录', item: ['会议记录', '例会', '专题会', '交底', '班前会'], sheet: ['会议记录', '活动记录', '会议台账'] },
  { key: 'system', name: '制度文件清单', item: ['制度', '管理办法', '规程', '职责文件', '作业指导书'], sheet: ['制度清单', '制度台账', '文件清单', '规程清单'] },
];

/* ================================================================== 工具 */

/** 归一：去空白与常见标点，便于包含匹配 */
function norm(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/[\s　\-_（）()【】\[\]、，,。.：:；;"'"'？?！!／/]/g, '');
}

/**
 * 判断类识别：返回命中的规则数组（可多条），空数组表示不是判断类。
 * **这是本技能最重要的函数**。宁可误判为判断类留空，也不能漏判而预填「符合」。
 */
function judgmentRules(text) {
  const t = norm(text);
  const hit = [];
  for (const r of JUDGMENT_RULES) {
    const w = r.words.find((k) => t.includes(norm(k)));
    if (w) hit.push({ id: r.id, name: r.name, word: w, desc: r.desc });
  }
  return hit;
}

/** 客观项识别：返回命中的规则数组，空数组表示不是可识别的客观项 */
function objectiveRules(text) {
  const t = norm(text);
  const hit = [];
  for (const r of OBJECTIVE_RULES) {
    const w = r.words.find((k) => t.includes(norm(k)));
    if (w) hit.push({ id: r.id, name: r.name, kind: r.kind, word: w, desc: r.desc });
  }
  return hit;
}

/** 自查项文本落在哪些数据源类别（可多类） */
function itemSources(text) {
  const t = norm(text);
  const out = [];
  for (const s of SOURCES) if (s.item.some((k) => t.includes(norm(k)))) out.push(s.key);
  return out;
}

/** 数据表（sheet）名落在哪个数据源类别，取第一个命中；无命中返回 null */
function sheetSource(sheetName) {
  const t = norm(sheetName);
  for (const s of SOURCES) if (s.sheet.some((k) => t.includes(norm(k)) || norm(k).includes(t))) return s.key;
  for (const s of SOURCES) if (s.item.some((k) => t.includes(norm(k)))) return s.key;
  return null;
}

const SOURCE_CN = new Map(SOURCES.map((s) => [s.key, s.name]));

/**
 * 分类总决策。返回 {category, rules, kind, sources, reason}
 *   category: 'judgment' | 'objective' | 'unparsed'
 * 优先级（**不可调换**）：
 *   1. 命中判断类 → judgment（即便同时命中客观类，也按判断类处理，从严）
 *   2. 命中客观类 → objective
 *   3. 都不命中 → unparsed（无法判断类型，留空交人工，绝不猜测）
 */
function classify(text) {
  const j = judgmentRules(text);
  if (j.length) {
    return { category: 'judgment', rules: j, kind: null, sources: itemSources(text),
      reason: `命中判断类规则 ${j.map((x) => `${x.id}「${x.word}」`).join('、')}：${j[0].desc}` };
  }
  const o = objectiveRules(text);
  if (o.length) {
    // 多条客观规则同时命中时取「信息量最大」的那条：
    // 到期(due) > 齐全计数(complete) > 日期(date) > 数量(count) > 标识(text) > 有无(exist)。
    // 例：「压力容器是否在检验有效期内、有无超期」同时命中 O1(有无) 与 O4(到期)，
    // 只答「有 5 条记录」等于没答，按 O4 报「已过期 N 台、未到期 M 台」才是这一项要的事实。
    const rank = { due: 6, complete: 5, date: 4, count: 3, text: 2, exist: 1 };
    const main = o.slice().sort((x, y) => (rank[y.kind] || 0) - (rank[x.kind] || 0))[0];
    return { category: 'objective', rules: o, kind: main.kind, sources: itemSources(text),
      reason: `命中客观项规则 ${o.map((x) => `${x.id}「${x.word}」`).join('、')}，按 ${main.id}（${main.name}）取数` };
  }
  return { category: 'unparsed', rules: [], kind: null, sources: itemSources(text),
    reason: '未命中任何客观项规则，也未命中判断类规则，无法确定该项类型' };
}

/** 填写状态中文 */
const STATUS_CN = {
  prefilled: '已预填',
  needJudgment: '需责任人判断（留空）',
  noData: '缺数据（留空）',
  unparsed: '无法解析（留空）',
};

/** 禁止出现在预填内容里的词：一旦出现说明代做了判断 */
const BANNED_FILL = ['符合', '不符合', '已落实', '未落实', '健全', '不健全', '达标', '不达标', '合规',
  '良好', '正常', '完好', '有效', '到位', '规范', '合格', '不合格', '满足要求', '无隐患'];

/** 校验一条预填内容是否越界。返回命中的禁用词数组（空表示安全） */
function checkFillValue(v) {
  const t = norm(v);
  return BANNED_FILL.filter((w) => t.includes(norm(w)));
}

module.exports = {
  JUDGMENT_RULES, OBJECTIVE_RULES, SOURCES, SOURCE_CN, STATUS_CN, BANNED_FILL,
  norm, judgmentRules, objectiveRules, itemSources, sheetSource, classify, checkFillValue,
};
