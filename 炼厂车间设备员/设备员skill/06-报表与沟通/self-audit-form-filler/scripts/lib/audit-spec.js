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
  { key: 'special', name: '特种设备台账', item: ['特种设备', '压力容器', '压力管道', '锅炉', '起重机', '使用登记'], sheet: ['特种设备', '压力容器', '压力管道', '特种设备台账'],
    // 同类多张表时的首选表：自查项写了哪类设备，就先取表名带该类设备的表
    prefer: [
      { item: ['压力容器'], sheet: ['压力容器'] },
      { item: ['压力管道'], sheet: ['压力管道', '管道'] },
      { item: ['起重'], sheet: ['起重'] },
      { item: ['锅炉'], sheet: ['锅炉'] },
    ] },
  { key: 'inspection', name: '检验检测台账', item: ['定期检验', '检验报告', '检测报告', '检验有效期', '法定检验', '探伤', '测厚'], sheet: ['检验台账', '检验记录', '定期检验', '检测台账'] },
  { key: 'calibration', name: '校验检定台账', item: ['校验', '检定', '计量器具', '标定', '仪表校验'], sheet: ['校验台账', '检定台账', '计量台账', '仪表校验'] },
  { key: 'safetyValve', name: '安全阀台账', item: ['安全阀', '安全附件', '爆破片', '铅封'], sheet: ['安全阀台账', '安全附件台账', '安全阀'] },
  { key: 'patrol', name: '巡检点检记录', item: ['巡检', '点检', '班检', '巡回检查'], sheet: ['巡检记录', '点检记录', '巡检台账'] },
  { key: 'maintenance', name: '检修维修记录', item: ['检修', '维修', '保养', '润滑'], sheet: ['检修记录', '维修记录', '检修台账', '保养记录'] },
  { key: 'defect', name: '缺陷隐患台账', item: ['缺陷', '隐患', '报修', '故障', '整改单'], sheet: ['缺陷台账', '隐患台账', '缺陷记录', '隐患排查'],
    // 缺陷与隐患同属一类但不是一回事：问隐患取隐患表，问缺陷/报修/故障取缺陷表
    prefer: [
      { item: ['隐患'], sheet: ['隐患'] },
      { item: ['缺陷', '报修', '故障', '消缺'], sheet: ['缺陷', '报修', '故障', '通知单'] },
    ] },
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

/** 在类别词表里找表名包含的最长关键词；同长按 SOURCES 顺序。返回类别 key 或 null */
function longestHit(t, field) {
  let best = null, len = 0;
  for (const s of SOURCES) {
    for (const k of s[field]) {
      const nk = norm(k);
      if (nk && t.includes(nk) && nk.length > len) { best = s.key; len = nk.length; }
    }
  }
  return best;
}

/**
 * 数据表（sheet）名落在哪个数据源类别；无命中返回 null。四轮，前一轮命中即返回：
 *  1. 全等：表名与某类别的表名词完全相同（「特种设备台账」→ 特种设备，不会被「设备台账」抢走）
 *  2. 表名包含类别表名词：取**最长**的那个词（更长更具体的优先，如「车间特种设备台账」→ 特种设备）
 *  3. 类别表名词包含表名（表名是简写，如「巡检」「设备」）：按 SOURCES 顺序取第一个，与修复前口径一致，
 *     避免「设备」这类简写表整张漏掉
 *  4. 表名包含自查项用语：同样取最长的词
 */
function sheetSource(sheetName) {
  const t = norm(sheetName);
  if (!t) return null;
  for (const s of SOURCES) if (s.sheet.some((k) => norm(k) === t)) return s.key;
  const fwd = longestHit(t, 'sheet');
  if (fwd) return fwd;
  const rev = SOURCES.find((s) => s.sheet.some((k) => norm(k).includes(t)));
  if (rev) return rev.key;
  return longestHit(t, 'item');
}

/**
 * 同一自查项能用的数据表不止一张时，按类别的首选表规则（SOURCES[].prefer）排序后取第一张。
 * 首选规则：自查项写了某个词（如「隐患」），就先取表名带对应词（如「隐患」）的表。
 * 都不命中首选规则时保持原表序（与旧行为一致）。
 * 返回 { table, hitWord, basis }；basis 为多表时的选表说明，单表时为 null。
 */
function pickTable(text, cands) {
  const ti = norm(text);
  const hitOf = (t) => {
    const s = SOURCES.find((x) => x.key === t.sourceKey);
    if (!s || !s.prefer) return null;
    // 先看表名；表名归不了类（类别取自文件名）时才看文件名，避免一个文件里几张表因文件名同时命中
    const name = norm(sheetSource(t.sheet) ? t.sheet : `${t.file || ''}${t.sheet || ''}`);
    for (const p of s.prefer) {
      const w = p.item.find((k) => ti.includes(norm(k)));
      if (w && p.sheet.some((k) => name.includes(norm(k)))) return w;
    }
    return null;
  };
  const scored = cands.map((t, i) => ({ t, i, w: hitOf(t) }));
  scored.sort((a, b) => (b.w ? 1 : 0) - (a.w ? 1 : 0) || a.i - b.i);
  const top = scored[0];
  let basis = null;
  if (cands.length > 1) {
    const names = cands.map((t) => `${t.file}/${t.sheet}`).join('、');
    basis = `可用数据表 ${cands.length} 张（${names}），${top.w ? `按自查项「${top.w}」选用表名对应的本表` : '自查项未指向其中某一张，取排在最前的本表'}`;
  }
  return { table: top.t, hitWord: top.w, basis };
}

/* ================================================================== 四、行过滤口径
 * 自查项写了「在用」或某类特种设备时，只统计对应的行。
 * 口径从严：状态或类别为空、写法认不出的行**不推断为符合**，单列「不详」并写明行号。
 * 台账里没有对应列时，按全部记录取数，但在来源说明与 warning 里写明「未按 XX 筛选」。
 */
/** 使用状态列：先全等，再包含（裸「状态」只认全等，避免把「完好状态」当使用状态） */
const STATUS_FIELDS = { exact: ['使用状态', '设备状态', '运行状态', '状态'], contains: ['使用状态', '设备状态', '运行状态'] };
/** 中石化口径：在用设备 = 运行 + 备用，剔除停用、封存、报废等 */
const STATUS_IN_USE = ['在用', '运行', '运行中', '备用'];
const STATUS_NOT_IN_USE = ['停用', '封存', '闲置', '报废', '拆除', '停运', '调出', '调拨'];
/** 设备类别列：先全等，再包含（裸「类别」「种类」只认全等，避免把「检验类别」「作业类别」当设备类别） */
const CATEGORY_FIELDS = { exact: ['设备类别', '特种设备类别', '设备种类', '特种设备种类', '类别', '种类'], contains: ['设备类别', '设备种类'] };
/**
 * 特种设备类别：item = 自查项里的说法，value = 台账类别列里包含即算的写法，
 * short = 只在特种设备、检验台账里、且整格等于该词时才算的简写（通用设备台账里的「容器」「管道」可能是常压容器、工艺管道）
 */
const SPECIAL_KINDS = [
  { name: '压力容器', item: ['压力容器'], value: ['压力容器'], short: ['容器'] },
  { name: '压力管道', item: ['压力管道'], value: ['压力管道'], short: ['管道'] },
  { name: '锅炉', item: ['锅炉'], value: ['锅炉'] },
  { name: '起重机械', item: ['起重机'], value: ['起重'] },
  { name: '电梯', item: ['电梯'], value: ['电梯'] },
  { name: '场（厂）内专用机动车辆', item: ['专用机动车辆', '厂内机动车辆', '叉车'], value: ['机动车辆', '叉车'] },
  { name: '气瓶', item: ['气瓶'], value: ['气瓶'] },
];

/** 按「全等优先、再包含」在表头里找列 */
function findHeader(header, spec) {
  for (const w of spec.exact) { const h = header.find((x) => x && norm(x) === norm(w)); if (h) return h; }
  for (const w of spec.contains) { const h = header.find((x) => x && norm(x).includes(norm(w))); if (h) return h; }
  return null;
}
const statusField = (header) => findHeader(header, STATUS_FIELDS);
const categoryField = (header) => findHeader(header, CATEGORY_FIELDS);

/** 使用状态取值归类：'in' 在用 / 'out' 非在用 / null 不详（空或认不出） */
function statusClass(v) {
  const t = norm(v);
  if (!t) return null;
  if (STATUS_NOT_IN_USE.some((k) => t.includes(norm(k)))) return 'out';
  if (STATUS_IN_USE.some((k) => t.startsWith(norm(k)))) return 'in';
  return null;
}
/** 自查项要求「在用」口径（「不在用 / 非在用 / 未在用」是反义，不按在用筛选） */
const wantsInUse = (text) => /(?<![不非未])在用/.test(norm(text));
/** 自查项点名的特种设备类别（可多类） */
const itemSpecialKinds = (text) => { const t = norm(text); return SPECIAL_KINDS.filter((k) => k.item.some((w) => t.includes(norm(w)))); };
/** 类别取值是否属于给定类别之一：true / false / null（空，不详）。sourceKey 决定是否认简写（见 SPECIAL_KINDS.short） */
function categoryMatch(v, kinds, sourceKey) {
  const t = norm(v);
  if (!t) return null;
  const shortOk = ['special', 'inspection'].includes(sourceKey);
  return kinds.some((k) => {
    if (k.short && /常压|非压力/.test(t)) return false;
    return k.value.some((w) => t.includes(norm(w))) || (shortOk && (k.short || []).some((w) => t === norm(w)));
  });
}

/** 自查项问的是特种作业（含特种设备作业）人员的证书：只计特种作业类证书，不计入厂教育、体检、培训记录 */
const wantsSpecialCert = (text) => /特种作业|持证|操作证|作业人员证|证书/.test(norm(text));
/** 自查项要的是人数（按人去重，不按记录行数） */
const wantsPersons = (text) => /人数|几人|[（(]人[）)]/.test(String(text || ''));
const CERT_TYPE_FIELDS = { exact: ['证书类型', '证书名称', '证件类型', '证件名称', '资质类型', '资质名称', '证书种类'], contains: ['证书类型', '证书名称', '证件类型', '证件名称', '资质类型'] };
const NAME_FIELDS = { exact: ['姓名', '人员姓名', '持证人', '持证人姓名', '员工姓名'], contains: ['姓名'] };
const certTypeField = (header) => findHeader(header, CERT_TYPE_FIELDS);
const nameField = (header) => findHeader(header, NAME_FIELDS);
/** 证书类型归类：'cert' 特种作业类证书 / 'non' 入厂教育、体检、培训记录、资质证明等非证书记录 / null 不详 */
function certClass(v) {
  const t = norm(v);
  if (!t) return null;
  if (/教育|体检|健康|培训|证明$|记录$|告知|交底/.test(t)) return 'non';
  if (/证|操作资格|作业资格/.test(t)) return 'cert';
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
  STATUS_IN_USE, STATUS_NOT_IN_USE, SPECIAL_KINDS,
  norm, judgmentRules, objectiveRules, itemSources, sheetSource, pickTable, classify, checkFillValue,
  statusField, categoryField, statusClass, wantsInUse, itemSpecialKinds, categoryMatch,
  wantsSpecialCert, wantsPersons, certTypeField, nameField, certClass,
};
