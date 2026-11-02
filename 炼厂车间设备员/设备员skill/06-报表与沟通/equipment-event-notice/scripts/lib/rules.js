'use strict';
/**
 * 设备事件通报 —— 推测性/定性表述检测规则引擎
 * 口径见 references/notice-rules.md。
 *
 * 核心原则：
 *  1. 原因未经调查确认 → 一律写「原因正在分析中」，脚本绝不把推测写进 cause。
 *  2. 命中禁用表述 → warning + speculative 数组列出原文、位置、规则号、建议改法，
 *     由模型改写为客观事实陈述或标注「待核实」，脚本不自动删改用户原文。
 *  3. 是否需走事故快报流程只给提示（escalationHint），脚本不判定、不定性。
 */

// ---------------------------------------------------------------- 禁用表述规则表
/**
 * 每条：{ id, category, categoryCn, re, severity, why, suggest }
 * severity: 'block'（必须改写）｜'review'（需有依据方可使用，否则改写）
 */
const SPEC_RULES = [
  // ---- S1x 归因类：未经调查不得写因果
  { id: 'S11', category: 'attribution', re: /由于/g, why: '在调查结论出具前陈述因果关系', suggest: '删去因果表述，改写为「相关情况正在分析中」或只陈述已确认的事实先后顺序' },
  { id: 'S12', category: 'attribution', re: /因为|因而|系因/g, why: '在调查结论出具前陈述因果关系', suggest: '删去因果表述，只陈述已观察到的现象' },
  { id: 'S13', category: 'attribution', re: /导致|致使/g, why: '断言了尚未确认的因果链条', suggest: '改为「其后出现……」「随后发生……」等时序表述' },
  { id: 'S14', category: 'attribution', re: /造成/g, why: '断言了尚未确认的因果链条', suggest: '改为「现场出现……」并在原因分析情况一节写明「原因正在分析中」' },
  { id: 'S15', category: 'attribution', re: /原因是|原因为|起因是|根本原因/g, why: '在正式调查结论前给出原因结论', suggest: '统一写为「原因正在分析中」' },
  { id: 'S16', category: 'attribution', re: /系.{0,12}?所致|所致|引起的是|造成的是/g, why: '在正式调查结论前给出原因结论', suggest: '统一写为「原因正在分析中」' },

  // ---- S2x 责任类：通报不做责任认定
  { id: 'S21', category: 'responsibility', re: /操作不当|操作失误|误操作/g, why: '属于责任认定，须由调查组结论确定', suggest: '改为客观描述当时的操作动作与参数，不作评价' },
  { id: 'S22', category: 'responsibility', re: /违章|违规|违反操作规程/g, why: '属于责任认定与定性', suggest: '如确有检查发现，引用检查记录编号并写「待核实」；否则删去' },
  { id: 'S23', category: 'responsibility', re: /失职|渎职|履职不到位/g, why: '属于责任认定', suggest: '删去；责任认定以正式调查结论为准' },
  { id: 'S24', category: 'responsibility', re: /未按规程|未按操作规程|不按规程|未执行规程/g, why: '属于责任认定，须有核查依据', suggest: '改为陈述实际操作步骤与规程要求的差异，并标注「待核实」' },
  { id: 'S25', category: 'responsibility', re: /疏忽|大意|麻痹/g, why: '对人员主观状态的推断', suggest: '删去，只陈述客观事实' },
  { id: 'S26', category: 'responsibility', re: /把关不严|监管不力|管理缺失|管理不到位/g, why: '属于管理责任认定', suggest: '删去；如需提出管理改进，放入举一反三一节并写为建议' },

  // ---- S3x 厂家/质量类：涉及外部责任，未经鉴定不得断言
  { id: 'S31', category: 'vendor', re: /厂家质量问题|厂家责任|制造质量问题/g, why: '涉及外部责任认定，须经检测鉴定', suggest: '改为「部件失效形式待检测鉴定后确认」' },
  { id: 'S32', category: 'vendor', re: /设备本身缺陷|设计缺陷|先天缺陷|固有缺陷/g, why: '涉及设计制造责任认定，须经鉴定', suggest: '改为「设备状态待进一步检查确认」' },
  { id: 'S33', category: 'vendor', re: /质量不合格|不合格产品|以次充好|假冒伪劣/g, why: '涉及质量判定与外部责任，须有检验报告', suggest: '如有检验报告，引用报告编号；否则删去' },

  // ---- S4x 定性类：事件性质由正式调查确定
  { id: 'S41', category: 'characterization', re: /事故(?!池|柜|罩|照明|状态|应急|预案|柴油|泵|排放|水|阀|排污|电源|风机|隔离)/g, why: '「事故」是正式定性用语，未经定性不得使用', suggest: '改为「事件」「故障」「异常」' },
  { id: 'S42', category: 'characterization', re: /严重违反|恶意|蓄意|故意/g, why: '属于性质与主观故意的认定', suggest: '删去' },
  { id: 'S43', category: 'characterization', re: /重大隐患|重大问题|重大风险/g, why: '「重大」是分级定性用语，须依据隐患分级标准', suggest: '如已按厂内标准分级，引用分级结论；否则改为「已发现的问题」' },

  // ---- S5x 程度夸大：需有量化依据
  { id: 'S51', category: 'exaggeration', re: /严重/g, severity: 'review', why: '程度形容词，需有量化依据（数值、范围、时长）', suggest: '替换为可核实的量化描述，如「泄漏量约 X kg」「停车 X 小时」' },
  { id: 'S52', category: 'exaggeration', re: /重大/g, severity: 'review', why: '程度形容词兼分级用语，需依据分级标准', suggest: '引用分级标准结论，或改为中性描述' },
  { id: 'S53', category: 'exaggeration', re: /恶劣|极其|非常严重|十分严重|大面积/g, severity: 'review', why: '程度形容词，需有量化依据', suggest: '替换为可核实的量化描述' },
];

const CATEGORY_CN = {
  attribution: '归因类（未经调查的因果表述）',
  responsibility: '责任类（责任认定表述）',
  vendor: '厂家质量类（外部责任认定）',
  characterization: '定性类（事件性质用语）',
  exaggeration: '程度夸大类（需量化依据）',
};

/**
 * 扫描文本，返回命中的推测性表述。
 * @param {string} text 待检文本
 * @param {string} field 字段名（经过/影响/措施…），写入结果便于定位
 * @returns {Array<{ruleId,category,categoryCn,field,text,index,severity,why,suggest,context}>}
 */
function scanSpeculative(text, field) {
  const s = String(text === null || text === undefined ? '' : text);
  if (!s) return [];
  const hits = [];
  for (const r of SPEC_RULES) {
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
  // 同一位置被多条规则命中时保留全部（规则号可追溯），按位置排序
  hits.sort((a, b) => (a.index - b.index) || a.ruleId.localeCompare(b.ruleId));
  return hits;
}

// ---------------------------------------------------------------- 个人姓名追责性表述
/** 常见中文姓氏（用于「姓+名/职务」+追责动词的组合检测） */
const SURNAME = '赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮齐康伍余元卜顾孟平黄和穆萧尹姚邵湛汪祁毛狄米贝明臧计伏成戴谈宋茅庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯昝管卢莫';
/** 追责性动词/评价词，出现在姓名附近即判为追责表述 */
const BLAME_WORD = /负有责任|承担责任|责任在|失职|渎职|违章|违规|操作不当|误操作|疏忽|未按规程|把关不严|处理不当|擅自|私自|未经许可|已被处理|予以处分|检讨|追责/;
/** 人员身份标记：出现在姓名紧邻位置才认定这是一个人名，避免把普通词切成「姓+2字」 */
const ROLE_BEFORE = /(操作工|操作员|班长|值班长|主操|副操|内操|外操|司泵|钳工|电工|仪表工|焊工|班组长|工段长|车间主任|主任|设备员|技术员|工程师|巡检员|点检员|当班人员|当班|员工|职工)$/;
const ROLE_AFTER = /^(师傅|班长|主任|工程师|技术员|设备员|同志)/;

/**
 * 检测是否存在「个人姓名 + 追责性表述」。
 * 认定条件（三者同时满足，避免把普通词误判为姓名）：
 *   1. 形如「姓 + 1~2 个汉字」；
 *   2. 紧邻位置有人员身份标记（前置职务如「操作工」，或后置称谓如「师傅」）；
 *   3. 前后 25 字范围内出现追责性表述。
 * 返回命中数组；脚本只提示人工删改，不自动改写原文。
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
    // 身份标记：前置职务，或后置称谓（后置时姓名取「姓+1字」也算，故单独再试）
    let name = m[0];
    let isPerson = ROLE_BEFORE.test(before);
    if (!isPerson && ROLE_AFTER.test(after)) isPerson = true;
    if (!isPerson) {
      // 「姓+1字」后紧跟称谓的情形，如「王师傅」
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
      why: '通报不得出现指向个人的追责性表述',
      suggest: '删去姓名，改为岗位或班组的客观事实陈述（如「当班操作人员按……执行」），责任认定以正式调查结论为准',
      context: around,
    });
  }
  return hits;
}

// ---------------------------------------------------------------- 上报提示
/**
 * 事故快报上报提示触发词。**只提示、不判定**：脚本不判断是否构成事故，
 * 仅在描述中出现下列情形时提醒用户按厂内规定自行判断。
 */
const ESCALATION_RULES = [
  { id: 'E1', re: /人员受伤|受伤|烧伤|烫伤|中毒|窒息|骨折|送医|就医|伤亡|死亡/, note: '描述中提到人员伤害' },
  { id: 'E2', re: /着火|起火|火灾|明火|过火|爆炸|闪爆|爆燃/, note: '描述中提到着火或爆炸' },
  { id: 'E3', re: /泄漏.{0,10}(外排|外溢|进入.{0,6}(河|沟|管网|土壤))|环保超标|超标排放|排入.{0,6}(河|沟|管网)|污染/, note: '描述中提到可能的环境影响' },
  { id: 'E4', re: /全厂停车|装置停车|非计划停车|紧急停车|联锁停车|停工/, note: '描述中提到装置停车' },
  { id: 'E5', re: /爆管|爆裂|大量泄漏|喷出|喷溅|物料外泄/, note: '描述中提到物料大量外泄' },
];
const ESCALATION_TEXT = '请按厂内规定判断是否需走事故快报流程，可使用 incident-flash-report 技能';

/**
 * 扫描是否需要提示走上报流程。
 * @returns {{hint: boolean, text: string|null, triggers: Array<{ruleId,keyword,note}>}}
 * 说明：hint 为 true 只代表「需要用户自行判断」，**不代表脚本认定构成事故**。
 */
function scanEscalation(texts) {
  const joined = (Array.isArray(texts) ? texts : [texts]).filter(Boolean).join('　');
  const triggers = [];
  for (const r of ESCALATION_RULES) {
    const m = joined.match(r.re);
    if (m) triggers.push({ ruleId: r.id, keyword: m[0], note: r.note });
  }
  return {
    hint: triggers.length > 0,
    text: triggers.length ? ESCALATION_TEXT : null,
    triggers,
    note: '本提示仅供参考，脚本不判定事件性质，是否构成需上报事故由用户按厂内规定判断',
  };
}

// ---------------------------------------------------------------- 通报要素
/** 七要素定义；required=true 的缺失即列入 missing */
const ELEMENT_DEFS = [
  { key: 'tag', cn: '设备位号', required: true, arg: '--tag', ask: '这次事件涉及哪台设备？位号是多少？' },
  { key: 'time', cn: '发生时间', required: true, arg: '--time', ask: '事件是什么时间发生的？（精确到分）' },
  { key: 'desc', cn: '事件经过', required: true, arg: '--desc', ask: '当时的经过是怎样的？按时间顺序说一下现场观察到的现象与处置动作。' },
  { key: 'status', cn: '当前状态', required: true, arg: '--status', ask: '设备与装置现在是什么状态？停运、备用还是已恢复？' },
  { key: 'impact', cn: '影响情况', required: true, arg: '--impact', ask: '对生产、安全、环保各有什么影响？没有影响也请明确说明。' },
  { key: 'measures', cn: '已采取措施', required: true, arg: '--measures', ask: '已经采取了哪些措施？谁在什么时间做的？' },
  { key: 'followup', cn: '后续安排', required: false, arg: '--followup', ask: '后续怎么安排？什么时间由谁负责做什么？' },
];

/** 固定原因表述：原因未经调查确认时一律使用这句话 */
const CAUSE_UNDER_ANALYSIS = '原因正在分析中';
/** 固定声明行：必须原样写进 md，不得删改 */
const DISCLAIMER = '本通报为情况告知，事件原因与性质以正式调查结论为准';

/**
 * 校验七要素完整性。
 * @param {Object} vals {tag,time,desc,status,impact,measures,followup}
 * @returns {{elements: Array, missing: Array}}
 */
function checkElements(vals) {
  const elements = [], missing = [];
  for (const d of ELEMENT_DEFS) {
    const v = String(vals[d.key] === null || vals[d.key] === undefined ? '' : vals[d.key]).trim();
    const present = v !== '';
    elements.push({
      key: d.key, cn: d.cn, required: d.required, present,
      value: present ? v : null, arg: d.arg,
    });
    if (!present && d.required) missing.push({ key: d.key, cn: d.cn, arg: d.arg, ask: d.ask, note: '要素缺失，须向用户补充，不得用推测填补' });
  }
  return { elements, missing };
}

module.exports = {
  SPEC_RULES, CATEGORY_CN, scanSpeculative,
  scanBlameNames, SURNAME, BLAME_WORD,
  ESCALATION_RULES, ESCALATION_TEXT, scanEscalation,
  ELEMENT_DEFS, checkElements,
  CAUSE_UNDER_ANALYSIS, DISCLAIMER,
};
