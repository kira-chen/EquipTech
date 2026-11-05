'use strict';
/**
 * 故障调查辅助 —— 时间线口径与禁止表述规则引擎
 * 口径见 references/investigation-rules.md。
 *
 * 核心原则：
 *  1. 时间线只陈述记录中的事实，**不得出现因果连接词**（C1~C8）；命中即列入 causalHits 并 warning。
 *  2. 原因认定、事故定性、责任划分一律不做；分析与结论章节恒为空，标注「由调查组填写」。
 *  3. 各来源时间戳不一致 → 全部保留并标注来源与差异，脚本绝不校准、绝不取其一。
 *  4. 时间窗口内的数据缺口 → 标注缺口区间，绝不插值、绝不推测填补。
 *  5. 不涉及人员姓名与追责性内容（N1）。
 *
 * 规则同源说明：本文件的禁用词规则（C1~C8、J1~J5）与
 *   `06-报表与沟通/equipment-event-notice/scripts/lib/rules.js` 的 S1x~S4x 规则同源
 *   （同一套"未经调查不得归因/定性/认定责任"口径；J1 与 S41 的「事故」负向排除词表必须保持一致）。
 *   目前两处各自维护、没有单一事实源：改一处须同步另一处，并在两边 selftest 各加断言。
 */

// ---------------------------------------------------------------- 因果连接词规则表
/**
 * 每条：{ id, category, categoryCn, re, severity, why, suggest }
 * severity 恒为 'block'：时间线是事实陈述，任何因果表述都必须改写。
 */
const CAUSAL_RULES = [
  { id: 'C1', category: 'causal', re: /导致/g, why: '「导致」在时间线中断言了尚未认定的因果链条', suggest: '改为时序表述：「其后出现……」「随后……」' },
  { id: 'C2', category: 'causal', re: /因此|故而|因而/g, why: '「因此」是推论连接词，时间线只陈述记录事实', suggest: '拆成两条独立的时间线条目，各自标注来源' },
  { id: 'C3', category: 'causal', re: /造成/g, why: '「造成」断言了尚未认定的因果链条', suggest: '改为「现场出现……」，因果留给调查组认定' },
  { id: 'C4', category: 'causal', re: /引起|引发/g, why: '「引起」断言了尚未认定的因果关系', suggest: '改为「同期出现……」或按时序分条陈述' },
  // C5 只拦"推论句式"：动词用法且后接结论性子句（如「说明密封已失效」「表明存在磨损」）。
  //   名词性用法（说明书、使用说明、情况说明、备注说明、说明栏、说明如下、已向班长说明）不命中。
  { id: 'C5', category: 'causal', re: /(?<!使用|情况|补充|备注|操作|产品|技术|设备|相关|另行|详见|见|书面|口头|作|做|予以|进行)(说明|表明|反映出)(?!书|栏|文件|如下|：|:|，|,|。|$)(?=[^，。；,.;\n]{2,})/g, why: '「说明/表明/反映出 + 结论」是从事实推出的结论，属于分析范畴', suggest: '删去推论，只保留观察到的记录内容' },
  { id: 'C6', category: 'causal', re: /由于|因为|系因/g, why: '在调查结论出具前陈述因果关系', suggest: '删去因果表述，只陈述已记录的现象与动作' },
  { id: 'C7', category: 'causal', re: /致使|以致|从而/g, why: '断言了尚未认定的因果链条', suggest: '改为时序表述' },
  { id: 'C8', category: 'causal', re: /所致|造成的是|原因是|原因为|根本原因|起因是/g, why: '在正式调查结论前给出原因结论', suggest: '删去；原因由调查组认定，本材料不含原因认定' },
];

// ---------------------------------------------------------------- 定性/责任表述规则表
const JUDGMENT_RULES = [
  { id: 'J1', category: 'characterization', re: /事故(?!池|柜|罩|照明|状态|应急|预案|柴油|泵|排放|水|阀|排污|电源|风机|隔离)/g, why: '「事故」是正式定性用语，事件性质须由调查组认定', suggest: '改为「故障」「事件」「异常」' },
  { id: 'J2', category: 'characterization', re: /定性为|认定为|构成.{0,4}事故|属于.{0,4}事故/g, why: '属于事件定性，须由依规成立的调查组认定', suggest: '删去；本材料只归集事实，不作定性' },
  { id: 'J3', category: 'responsibility', re: /责任在|负有责任|承担责任|追责|失职|渎职/g, why: '属于责任划分，须由调查组认定', suggest: '删去；责任划分不在本材料范围内' },
  { id: 'J4', category: 'responsibility', re: /操作不当|操作失误|误操作|违章|违规|未按规程|把关不严/g, why: '属于责任认定用语，须有核查依据并由调查组认定', suggest: '改为陈述记录中的实际操作动作与参数，不作评价' },
  { id: 'J5', category: 'speculation', re: /可能是|估计是|怀疑|初步判断|应该是|大概率/g, why: '属于原因推测，本材料不含原因认定', suggest: '删去推测，改列入「待查材料清单」由调查组核实' },
];

const CATEGORY_CN = {
  causal: '因果连接类（时间线禁止）',
  characterization: '定性类（事件性质用语）',
  responsibility: '责任类（责任划分表述）',
  speculation: '推测类（原因推测）',
};

/**
 * 扫描文本中的因果连接词与定性/责任表述。
 * @param {string} text 待检文本
 * @param {string} field 字段名（时间线内容/故障现象…），便于定位
 * @param {Array} ruleSet 规则表，默认因果 + 定性两张表
 */
function scanCausal(text, field, ruleSet) {
  const s = String(text === null || text === undefined ? '' : text);
  if (!s) return [];
  const rules = ruleSet || CAUSAL_RULES.concat(JUDGMENT_RULES);
  const hits = [];
  for (const r of rules) {
    const re = new RegExp(r.re.source, 'g');
    let m;
    while ((m = re.exec(s)) !== null) {
      if (m[0] === '') { re.lastIndex++; continue; }
      hits.push({
        ruleId: r.id,
        category: r.category,
        categoryCn: CATEGORY_CN[r.category],
        field: field || '',
        text: m[0],
        index: m.index,
        severity: r.severity || 'block',
        why: r.why,
        suggest: r.suggest,
        context: s.slice(Math.max(0, m.index - 12), Math.min(s.length, m.index + m[0].length + 12)),
      });
    }
  }
  hits.sort((a, b) => (a.index - b.index) || a.ruleId.localeCompare(b.ruleId));
  return hits;
}

// ---------------------------------------------------------------- 个人姓名追责性表述
const SURNAME = '赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮齐康伍余元卜顾孟平黄和穆萧尹姚邵湛汪祁毛狄米贝明臧计伏成戴谈宋茅庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯昝管卢莫';
const BLAME_WORD = /负有责任|承担责任|责任在|失职|渎职|违章|违规|操作不当|误操作|疏忽|未按规程|把关不严|处理不当|擅自|私自|未经许可|已被处理|予以处分|检讨|追责/;
const ROLE_BEFORE = /(操作工|操作员|班长|值班长|主操|副操|内操|外操|司泵|钳工|电工|仪表工|焊工|班组长|工段长|车间主任|主任|设备员|技术员|工程师|巡检员|点检员|当班人员|当班|员工|职工)$/;
const ROLE_AFTER = /^(师傅|班长|主任|工程师|技术员|设备员|同志)/;

/**
 * 检测「个人姓名 + 追责性表述」。认定条件三者同时满足：
 *   1. 形如「姓 + 1~2 个汉字」；2. 紧邻有人员身份标记；3. 前后 25 字内出现追责词。
 * 脚本只提示人工删改，不自动改写原文。
 */
function scanBlameNames(text, field) {
  const s = String(text === null || text === undefined ? '' : text);
  if (!s) return [];
  const hits = [];
  const nameRe = new RegExp(`[${SURNAME}](?:[\\u4e00-\\u9fa5]{1,2})`, 'g');
  let m;
  const seen = new Set();
  while ((m = nameRe.exec(s)) !== null) {
    const before = s.slice(Math.max(0, m.index - 6), m.index);
    const after = s.slice(m.index + m[0].length, m.index + m[0].length + 4);
    let name = m[0];
    let isPerson = ROLE_BEFORE.test(before);
    if (!isPerson && ROLE_AFTER.test(after)) isPerson = true;
    if (!isPerson) {
      const short = m[0].slice(0, 2);
      if (ROLE_AFTER.test(s.slice(m.index + 2, m.index + 6))) { name = short; isPerson = true; }
    }
    if (!isPerson) continue;
    const around = s.slice(Math.max(0, m.index - 25), Math.min(s.length, m.index + name.length + 25));
    if (!BLAME_WORD.test(around)) continue;
    const key = name + '@' + m.index;
    if (seen.has(key)) continue;
    seen.add(key);
    m.lastIndex = m.index + name.length;
    hits.push({
      ruleId: 'N1',
      category: 'blameName',
      categoryCn: '个人追责类（姓名 + 追责性表述）',
      field: field || '',
      text: name,
      index: m.index,
      severity: 'block',
      why: '调查归集材料不得出现指向个人的追责性表述',
      suggest: '删去姓名，改为岗位或班组的客观事实陈述；责任划分由调查组认定',
      context: around,
    });
  }
  return hits;
}

// ---------------------------------------------------------------- 待查材料清单模板
/**
 * 建议进一步收集的材料。每条：{ id, cn, why, when(ctx) → bool }
 * when 为空表示无条件建议收集。ctx 字段见 investigate.js 的 buildToInvestigate。
 */
const TO_INVESTIGATE_DEFS = [
  { id: 'T1', cn: 'DCS 历史趋势原始导出（故障前后完整时段，含秒级采样）', why: '核对运行参数记录与 DCS 原始数据是否一致' },
  { id: 'T2', cn: '报警与事件（SOE）原始记录', why: '确认报警先后顺序与首出报警', when: (c) => c.alarms === 0 },
  { id: 'T3', cn: '联锁动作记录与联锁投用状态台账', why: '确认联锁投用与动作情况' },
  { id: 'T4', cn: '该设备近一个检修周期的检修与技改记录', why: '核对检修范围、更换部件与验收结论', when: (c) => c.maintenanceHistory === 0 },
  { id: 'T5', cn: '备品备件领用与材质证明、到货验收记录', why: '核对所用备件的规格与材质' },
  { id: 'T6', cn: '当班值班记录与交接班记录原件', why: '核对操作动作的时间与内容', when: (c) => c.dutyLogs === 0 },
  { id: 'T7', cn: '操作规程、操作卡与工艺卡片现行版本', why: '核对操作动作对应的规程条款' },
  { id: 'T8', cn: '现场照片、视频与解体检查影像资料', why: '固定现场状态与失效形貌' },
  { id: 'T9', cn: '失效件解体检查报告与材质、金相检测报告', why: '由具备资质的机构出具检测结论' },
  { id: 'T10', cn: '同类设备同期运行参数与状态监测数据', why: '作对照参考' },
  { id: 'T11', cn: '数据缺口时段的其他来源记录（纸质记录、班组台账、DCS 备份）', why: '补齐时间窗口内的缺口区间', when: (c) => c.dataGaps > 0 },
  { id: 'T12', cn: '各来源系统的对时记录与时钟校准记录', why: '核实不同来源时间戳的差异来源', when: (c) => c.timeInconsistency > 0 },
  { id: 'T13', cn: '设备台账、出厂资料与历年大修档案', why: '核对设备基础信息与历史状况' },
];

/** 依据归集结果生成待查材料清单 */
function buildToInvestigate(ctx) {
  const list = [];
  for (const d of TO_INVESTIGATE_DEFS) {
    if (d.when && !d.when(ctx)) continue;
    list.push({ id: d.id, item: d.cn, why: d.why, source: '由调查组向相关单位调取' });
  }
  return list;
}

// ---------------------------------------------------------------- 固定文案
/** 固定声明行：必须原样写进 md，不得删改 */
const DISCLAIMER = '本材料为调查辅助归集，不含原因认定与事故定性；故障原因、性质与责任须由依规成立的调查组认定';
/** 通用声明行（《中石化口径对照》第九节），与 DISCLAIMER 一并写入 md */
const DISCLAIMER_GENERAL = '本材料由脚本汇总、模型成文，仅供设备员复核参考，不替代审批、定性、验收与签字；厂内制度与系统数据为准。';
/** 事故分级与报送衔接说明：脚本不判定等级、不判定是否非计划停工、不判定报送时限 */
const GRADING_NOTE = '是否构成设备事故及其等级、是否属于非计划停工事件，按《中国石化设备事故管理规定》《炼化企业非计划停工管理规定》由公司设备管理部门与调查组认定；报送时限以厂内规定为准，本技能不判定。需上报的事故快报用事故事件快报（incident-flash-report），内部情况通报用 equipment-event-notice。';
/** 默认时间窗口与缺口阈值是经验默认，不是制度数值 */
const DEFAULTS_NOTE = '回溯 72 小时 / 后续 24 小时 / 缺口阈值 120 分钟为经验默认，不是制度规定；须与用户确认，用 --before / --after / --gap 按本次调查需要调整。';
/**
 * 检修分级口径（《中石化口径对照》第五节）：装置大检修 / 日常维修 / 抢修 / 专项（技改技措）。
 * 旧称映射：大修→装置大检修，中修/小修→日常维修；原文保留在 category，映射值放 categoryNorm。
 * SAP 订单类型只映射口径对照明确写出的 PM01（日常维修）/ PM03（抢修）；PM02「计划检修」等厂内可配置项不猜 → null。
 */
const REPAIR_CATEGORY_MAP = [
  ['装置大检修', /大检修|停工检修|大修|停车检修|装置检修/],
  ['抢修', /抢修|紧急修|应急修|^PM03$/i],
  ['专项（技改技措）', /技改|技措|专项|改造/],
  ['日常维修', /日常维修|日常|中修|小修|消缺|维修|检修|^PM01$/i],
];
function normRepairCategory(v) {
  const t = String(v === null || v === undefined ? '' : v).trim();
  if (!t) return null;
  for (const [name, re] of REPAIR_CATEGORY_MAP) if (re.test(t)) return name;
  return null;
}
/** 原因分析 / 责任分析 / 防范措施章节的固定占位文字 */
const ANALYSIS_PLACEHOLDER = '（由调查组填写）';
/** 损失情况章节的固定占位文字：损失由调查组核定，脚本不估算 */
const LOSS_PLACEHOLDER = '（由调查组核定；脚本不估算损失，不判定是否构成非计划停工）';
/** 用户要求填写原因结论时的固定答复 */
const REFUSAL_NOTE = '本技能不提供原因认定、事故定性与责任划分内容；该部分须由依规成立的调查组填写';

module.exports = {
  CAUSAL_RULES, JUDGMENT_RULES, CATEGORY_CN, scanCausal,
  scanBlameNames, SURNAME, BLAME_WORD,
  TO_INVESTIGATE_DEFS, buildToInvestigate,
  DISCLAIMER, DISCLAIMER_GENERAL, GRADING_NOTE, DEFAULTS_NOTE,
  ANALYSIS_PLACEHOLDER, LOSS_PLACEHOLDER, REFUSAL_NOTE,
  REPAIR_CATEGORY_MAP, normRepairCategory,
};
