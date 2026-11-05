#!/usr/bin/env node
'use strict';
/**
 * 车间设备周报月报生成脚本（仅 Node.js 内置模块；中石化体系炼化厂车间设备员口径）
 * 用法：node scripts/periodic.js --input <路径[,路径2]|目录> --workshop "车间" --period <weekly|monthly|quarterly|yearly>
 *       --from YYYY-MM-DD --to YYYY-MM-DD [--out <dir>]
 * 可选：--metrics <指标口径表xlsx> --prev <上期 periodic.json> --yoy <同期 periodic.json> --spare <备件消耗xlsx>
 *       --intact-denominator <在用|在册> --sealed <剔除|计入> --topn <n>
 * 输入可以是：多份 daily.json（来自 equipment-daily-report）、leaks.json（来自 leak-point-tracker），或区间内的原始 xlsx
 *             （含「设备台账」「故障记录」「检修计划」「工单台账」「缺陷台账」「备件消耗」「特护设备」「备机」「密封点统计」「停工记录」任一工作表），可混合。
 * 产出：<out>/periodic.json、periodic.md、指标表.xlsx、summary.json
 *
 * 指标口径（《中石化口径对照.md》第六节）：
 *  - 设备完好率 = 完好台数 / 在用设备台数（剔除长期停用、封存）；台账无「在用」列 → null，不得按在册算
 *  - 主要设备完好率：分子分母限 A/B 类（关键/主要设备）
 *  - 静/动密封点泄漏率（‰）= 泄漏点数 / 密封点总数；考核线以厂内指标为准，脚本不比对
 *  - 故障停机次数 = 区间内停机时长 > 0 的故障记录条数
 *  - 检修计划完成率按 大检修 / 日常维修 分列（抢修、专项另列）
 *  - 备机完好率 = 可随时投用的备用设备台数 / 备机总数（检修中备机不进分子）
 *  - 非计划停工次数：来自停工记录，缺数据写「未提供」，不估算
 *  - 厂内口径表命中但算法与默认不一致、且未给结构化口径参数 → 该指标输出 null 并标「需按厂内口径复算」，绝不只换文字
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readXlsx, readCsvDir, writeXlsx } = require('./lib/xlsx-lite');
const C = require('./lib/common');

const warnings = [];
const num = C.makeNum(warnings);
const VALUE_OPTS = ['input', 'workshop', 'period', 'from', 'to', 'out', 'metrics', 'prev', 'yoy', 'spare', 'topn', 'intact-denominator', 'sealed'];
const FLAG_OPTS = ['help'];

/** 周期定义：中文名 + 期望天数区间（用于区间与周期匹配校验） */
const PERIODS = {
  weekly: { cn: '周报', label: '本周', min: 5, max: 10 },
  monthly: { cn: '月报', label: '本月', min: 26, max: 35 },
  quarterly: { cn: '季报', label: '本季', min: 85, max: 97 },
  yearly: { cn: '年报', label: '本年', min: 350, max: 380 },
};

// 局部别名优先，再合并中石化常用系统导出列名；「设备编号」不是位号，局部不作位号别名
const ALIASES = C.mergeAliases({
  '位号': ['位号', '设备位号', 'TAG'],
  '设备名称': ['设备名称', '名称'],
  '设备类型': ['设备类型', '类型', '设备类别', '类别'],
  '专业': ['专业', '所属专业', '专业类别'],
  '缺陷描述': ['缺陷描述', '描述', '现象', '问题描述', '内容', '通知单描述', '通知单短文本'],
  '等级': ['等级', '缺陷等级', '级别'],
  '状态': ['状态', '处理状态', '当前状态'],
  '发现时间': ['发现时间', '时间', '发现日期', '通知日期', '通知单日期'],
  '闭环时间': ['闭环时间', '完成时间', '闭环日期', '实际完成', '关闭日期', '业务完成日期', '实际结束日期', '实际完成日期'],
  '工单号': ['工单号', '单号', '工单编号'],
  '要求完成时间': ['要求完成时间', '计划完成时间', '要求完成', '计划完成', '基本结束日期', '要求结束'],
  '责任人': ['责任人', '负责人', '承办人'],
  '项目名称': ['项目名称', '项目', '检修项目', '名称'],
  '检修类别': ['检修类别', '检修类型', '检修分级', '项目类别', '项目类型', '维修类型', '订单类型', '工单类型'],
  '计划完成': ['计划完成', '计划完成时间', '计划工期', '计划结束', '基本结束日期'],
  '实际完成': ['实际完成', '实际完成时间', '实际结束', '完工时间', '实际结束日期', '技术完成日期'],
  '故障描述': ['故障描述', '故障现象', '描述', '现象', '内容'],
  '故障时间': ['故障时间', '发生时间', '时间', '发生日期'],
  '停机时长': ['停机时长', '停机时间', '停机小时', '影响时长'],
  '是否停机': ['是否停机', '停机', '是否非计划停机'],
  '修复时长': ['修复时长', '修复时间', '修复工时', '抢修时长'],
  '备件名称': ['备件名称', '备件', '物料名称', '物料描述', '名称'],
  '数量': ['数量', '消耗数量', '领用数量', '用量'],
  '金额': ['金额', '消耗金额', '费用', '金额(元)', '本位币金额'],
  '单位': ['单位', '计量单位', '基本计量单位'],
  '指标': ['指标', '指标名称', '口径名称'],
  '算法': ['算法', '口径', '计算方法', '公式', '定义'],
  '分母': ['分母', '分母口径', '分母范围'],
  '剔除封存': ['剔除封存', '是否剔除封存', '剔除停用封存'],
  '在用': ['在用', '是否在用', '使用状态', '在用状态'],
  '完好': ['完好', '完好状态', '是否完好', '设备状态', '完好情况'],
  '重要度': ['重要度', '设备分级', '设备等级', 'ABC标识', 'ABC', '关键等级', '重要程度', '特护'],
  '运行参数': ['运行参数', '参数', '主要参数', '关键参数', '运行工况'],
  '是否可投用': ['是否可投用', '可投用', '可随时投用', '备用状态', '可用'],
  '密封点类型': ['密封点类型', '类型', '密封类型', '密封点类别'],
  '密封点总数': ['密封点总数', '总数', '密封点数', '点数'],
  '泄漏点数': ['泄漏点数', '泄漏点', '漏点数', '泄漏数'],
  '停工类别': ['停工类别', '类别', '停工类型', '是否计划', '计划性'],
  '停工时间': ['停工时间', '时间', '停工日期', '发生时间'],
  '原因': ['原因', '停工原因', '事件描述', '描述'],
});
ALIASES['设备名称'] = ALIASES['设备名称'].filter((x) => x !== '描述');

// ---- 车间范围核对（D007）：表格带车间列时按 --workshop 剔除其他车间的行；上游 JSON 按 meta.workshop 核对，不一致的不纳入
// 车间列只认 车间 / 所属车间 / 属地车间 / 运行部（共享别名里的维护工厂、属地单位、使用单位不当车间列）；
// 「车间」放在各表 optional 末尾，前缀匹配时不抢「车间监护人」等别的字段的列
ALIASES['车间'] = C.WORKSHOP_COLS.slice();
/** 「车间负责人」「车间监护人」这类人员列不当车间列 */
const NOT_WORKSHOP_COL = /(人|员|长|签字|签名|电话|意见)$/;
function scopeRows(recs, sheet, workshop, scopes) {
  const col = recs.hasCol && recs.hasCol('车间') ? recs.colName('车间') : null;
  let input = recs;
  if (col && NOT_WORKSHOP_COL.test(col)) {
    input = recs.slice();
    input.hasCol = (n) => n !== '车间' && recs.hasCol(n);
    input.colName = (n) => (n === '车间' ? null : recs.colName(n));
  }
  const { records, scope } = C.workshopScope(input, workshop, sheet, warnings);
  if (input !== recs) scope.ignoredColumn = col;
  scopes.push(scope);
  return records;
}
/** 上游 JSON 的车间：先取 meta.workshop，没有再看顶层 workshop */
const jsonWorkshop = (j) => C.str(j && j.meta && j.meta.workshop) || C.str(j && j.workshop);
/** 上游 JSON 车间与 --workshop 一致或未注明 → 纳入；不一致 → 不纳入并 warning */
function jsonInScope(name, j, workshop, js) {
  const w = jsonWorkshop(j);
  if (!w) { js.unknown.push(name); return true; }
  if (C.sameWorkshop(w, workshop)) { js.matched.push(name); return true; }
  js.excluded.push({ file: name, workshop: w });
  warnings.push(`上游 JSON「${name}」的车间为「${w}」，与 --workshop「${workshop}」不一致，未纳入本报告`);
  return false;
}
function jsonScopeNote(js, workshop) {
  const q = (l) => l.map((f) => `「${f}」`).join('、');
  const parts = [];
  if (js.matched.length) parts.push(`${q(js.matched)}与「${workshop}」一致，已纳入`);
  if (js.excluded.length) parts.push(`${js.excluded.map((x) => `「${x.file}」（${x.workshop}）`).join('、')}车间不一致，未纳入`);
  if (js.unknown.length) parts.push(`上游 JSON 未注明车间，无法核对（${q(js.unknown)}），已照常纳入`);
  return {
    note: parts.length ? `上游 JSON 车间核对：${parts.join('；')}。` : null,
    alert: js.excluded.length ? `【注意】上游 JSON${js.excluded.map((x) => `「${x.file}」的车间「${x.workshop}」`).join('、')}与 --workshop「${workshop}」不一致，未纳入本报告，请核对输入。` : null,
  };
}

/** 闭环判定：先否定前缀，再 SAP 六态；「已完成/完工/TECO」是待验收，不算闭环 */
function isClosed(s) {
  const v = C.str(s);
  if (!v) return false;
  if (/^(未|待|不|非)/.test(v)) return false;
  return C.normSapStatus(v) === '已闭环';
}
/** 检修项目是否完工：有实际完成日期，或状态为 待验收/已闭环（计划完成率考核完工，不考核验收） */
function planDoneBy(actEnd, status) {
  if (actEnd) return true;
  const v = C.str(status);
  if (!v || /^(未|待|不|非)/.test(v) && !/待验收/.test(v)) return false;
  const st = C.normSapStatus(v);
  return st === '待验收' || st === '已闭环';
}

/** 检修分级归一：大检修 / 日常维修 / 抢修 / 专项；旧口径 大修→大检修，中修/小修→日常维修 */
function maintCategory(v) {
  const s = C.str(v);
  if (!s) return null;
  if (/大检修|停工检修|大修|停工/.test(s)) return '大检修';
  if (/抢修/.test(s)) return '抢修';
  if (/专项|技改|技措/.test(s)) return '专项';
  if (/日常|中修|小修|维修|保养|PM01/i.test(s)) return '日常维修';
  if (/PM02/i.test(s)) return '大检修';
  if (/PM03/i.test(s)) return '抢修';
  return null;
}
/** 重要度是否为 A/B 类（关键/主要设备） */
function isMajor(v) {
  const s = C.str(v).toUpperCase();
  if (!s) return null;
  if (/^(A|B)\b|^(A|B)类|^(A|B)级|^(A|B)\//.test(s) || /关键|主要|特护|^1$|^2$|一级|二级/.test(s)) return true;
  if (/^C\b|^C类|^C级|一般|^3$|三级/.test(s)) return false;
  return null;
}

// ---------------------------------------------------------------- 输入装载
function loadAny(p) {
  if (!fs.existsSync(p)) throw new Error(`输入不存在: ${p}`);
  const st = fs.statSync(p);
  if (st.isDirectory()) {
    const files = fs.readdirSync(p).filter((f) => /\.(json|xlsx)$/i.test(f)).sort();
    if (files.length) return { kind: 'dir', files: files.map((f) => path.join(p, f)), name: path.basename(p) };
    const csv = readCsvDir(p);
    if (Object.keys(csv).length) return { kind: 'book', data: csv, name: path.basename(p) };
    throw new Error(`输入目录内没有 .json / .xlsx / .csv 文件: ${p}`);
  }
  if (/\.json$/i.test(p)) {
    let j;
    try { j = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { throw new Error(`JSON 解析失败 ${p}: ${e.message}`); }
    return { kind: 'json', data: j, name: path.basename(p) };
  }
  return { kind: 'book', data: readXlsx(p), name: path.basename(p) };
}
/** 是否为 equipment-daily-report 的 daily.json */
function isDaily(j) {
  return !!(j && j.meta && j.meta.date && j.counts && Object.prototype.hasOwnProperty.call(j.counts, 'equipment'));
}
/** 不是全车间设备台账的表名（工单、缺陷、特种设备、润滑、巡检等专项台账） */
const NOT_LEDGER = /工单|订单|缺陷|通知单|故障|检修|备件|特护|备机|密封|停工|隐患|作业|特种|安全阀|校验|压力容器|润滑|巡检|点检/;
/** 表名含「设备台账」「技术对象」先放行（如「二作业部设备台账」），但「特种设备台账」「特护设备台账」「压力容器设备台账」「安全阀设备台账」等专项写法仍排除 */
const LEDGER_NAME = /设备台账|技术对象/;
const SPECIAL_KIND = '特种|特护|备机|备用|压力容器|容器|安全阀|安全附件|检修|维修|密封|润滑|巡检|点检|校验|停工|缺陷|故障|备件|隐患';
const SPECIAL_LEDGER = new RegExp(`^(特种|特护|备机|备用)设备|(${SPECIAL_KIND})设备(使用)?(台账|技术对象)|(${SPECIAL_KIND})技术对象`);
function isNotLedger(name) {
  const s = String(name).replace(/\s/g, '');
  if (LEDGER_NAME.test(s) && !SPECIAL_LEDGER.test(s)) return false;
  return NOT_LEDGER.test(s);
}
/** 是否为 standby-rotation-reminder 的 rotation.json（备机完好来源） */
function isRotation(j) {
  return !!(j && j.standbyAvailability && typeof j.standbyAvailability === 'object');
}
/** 是否为 leak-point-tracker 的 leaks.json */
function isLeaks(j) {
  return !!(j && j.counts && j.counts.leaks !== undefined && j.repaired !== undefined);
}

// ---------------------------------------------------------------- 指标口径表
const DEFAULT_ALGO = {
  '设备完好率': '完好台数 / 在用设备台数（剔除长期停用、封存）',
  '主要设备完好率': '完好的 A/B 类在用台数 / A/B 类在用台数',
  '备机完好率': '可随时投用的备用设备台数 / 备机总数（检修中备机不进分子）',
  '静密封点泄漏率': '静密封泄漏点数 / 静密封点总数（‰）',
  '动密封点泄漏率': '动密封泄漏点数 / 动密封点总数（‰）',
  '检修计划完成率': '按期完成项数 / 计划项数（按大检修 / 日常维修分列）',
  '工单及时率': '按期闭环工单数 / 应闭环工单数',
  '平均修复时间': '累计修复时长 / 修复次数',
  '故障停机时长': '区间内各次故障停机时长求和',
  '故障停机次数': '区间内停机时长大于 0 的故障记录条数',
  '非计划停工次数': '区间内停工记录中类别为非计划的条数',
};
const normAlgo = (s) => C.str(s).replace(/[\s（）()，,、;；。]/g, '').replace(/／/g, '/').replace(/÷/g, '/').replace(/设备总台数/g, '在用设备台数').replace(/剔除长期停用封存|剔除停用封存|剔除封存|剔除长期停用/g, '').replace(/台数$/, '');

/** 读取厂内口径表：sheet「指标口径」，列 指标 / 算法 [/ 分母 / 剔除封存]。返回 {指标: {algo, denominator, sealed}} */
function loadMetricsRules(file) {
  if (!fs.existsSync(file)) throw new Error(`指标口径表不存在: ${file}`);
  const book = readXlsx(file);
  const sh = C.pickSheet(book, '指标口径', '口径', '指标');
  if (!sh) { warnings.push(`指标口径表「${path.basename(file)}」中未找到「指标口径」工作表，仍采用默认口径`); return null; }
  const recs = C.toRecords(sh, ['指标'], `${path.basename(file)}/指标口径`, ['算法', '分母', '剔除封存'], warnings, ALIASES);
  const map = {};
  for (const r of recs) {
    const k = C.str(r['指标']).replace(/\s/g, '');
    if (!k) continue;
    const den = C.str(r['分母']);
    const sealed = C.str(r['剔除封存']);
    map[k] = {
      algo: C.str(r['算法']) || '（口径表未填写算法）',
      denominator: /在册/.test(den) ? '在册' : /在用/.test(den) ? '在用' : null,
      sealed: sealed === '' ? null : /^(是|Y|剔除|1|true)$/i.test(sealed) ? true : /^(否|N|计入|0|false)$/i.test(sealed) ? false : null,
    };
  }
  if (!Object.keys(map).length) { warnings.push(`指标口径表「${path.basename(file)}」未解析到任何指标行，仍采用默认口径`); return null; }
  return map;
}

const CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三'];
const STATEMENT = '本材料由脚本汇总、模型成文，仅供设备员复核参考，不替代审批、定性、验收与签字；厂内制度与系统数据为准。';

// ---------------------------------------------------------------- 主流程
function main() {
  const a = C.parseArgs(process.argv.slice(2), VALUE_OPTS, FLAG_OPTS);
  if (!a.input) throw new Error('缺少 --input');
  if (!a.workshop) throw new Error('缺少 --workshop');
  if (!a.period) throw new Error('缺少 --period');
  if (!a.from) throw new Error('缺少 --from');
  if (!a.to) throw new Error('缺少 --to');

  const period = String(a.period).toLowerCase();
  if (!PERIODS[period]) throw new Error(`--period「${a.period}」无效，应为 weekly / monthly / quarterly / yearly`);
  const from = C.normDate(a.from);
  const to = C.normDate(a.to);
  if (!from) throw new Error(`--from「${a.from}」不是有效日期，应为 YYYY-MM-DD`);
  if (!to) throw new Error(`--to「${a.to}」不是有效日期，应为 YYYY-MM-DD`);
  if (C.diffDays(to, from) < 0) throw new Error(`--from（${from}）晚于 --to（${to}）`);
  const spanDays = C.diffDays(to, from) + 1;
  if (a['intact-denominator'] && !/^(在用|在册)$/.test(a['intact-denominator'])) throw new Error(`--intact-denominator「${a['intact-denominator']}」无效，应为 在用 / 在册`);
  if (a.sealed && !/^(剔除|计入)$/.test(a.sealed)) throw new Error(`--sealed「${a.sealed}」无效，应为 剔除 / 计入`);

  const P = PERIODS[period];
  if (spanDays < P.min || spanDays > P.max) {
    warnings.push(`区间与周期不匹配：--period ${period}（${P.cn}）常规为 ${P.min}~${P.max} 天，实际区间 ${from} ~ ${to} 共 ${spanDays} 天，请确认周期类型或起止日期`);
  }
  const topN = a.topn ? Math.max(1, Math.round(Number(a.topn) || 5)) : 5;
  const inRange = (d) => d && C.diffDays(d, from) >= 0 && C.diffDays(to, d) >= 0;

  // 展开输入：目录 → 目录内文件
  const rawInputs = a.input.split(',').map((s) => s.trim()).filter(Boolean);
  const inputs = [];
  for (const p of rawInputs) {
    const got = loadAny(p);
    if (got.kind === 'dir') { for (const f of got.files) inputs.push(f); }
    else inputs.push(p);
  }
  if (!inputs.length) throw new Error('未展开到任何输入文件');
  const outDir = a.out || path.join(os.tmpdir(), 'ewmr-out');

  // ---- 指标口径来源
  let rules = null, rulesSource = '默认口径（references/metrics-rules.md）';
  if (a.metrics) {
    rules = loadMetricsRules(a.metrics);
    if (rules) rulesSource = `厂内口径表（${path.basename(a.metrics)}）`;
  }
  const usingDefault = !rules;
  const DEFAULT_NOTICE = '本报告指标采用默认口径，非厂内正式口径，考核数据以公司设备管理部门发布口径为准。';
  const ruleOf = (name) => (rules && rules[name] ? rules[name].algo : DEFAULT_ALGO[name]);
  /**
   * 判断某指标是否可按脚本算法计算：
   *  - 无口径表 → 可算（默认口径）
   *  - 口径表未命中 → 可算（默认口径）
   *  - 命中且算法表述与默认一致 → 可算（厂内口径，与默认一致）
   *  - 命中且有结构化参数（口径表 分母/剔除封存 列，或 --intact-denominator/--sealed）→ 可算（按结构化口径）
   *  - 否则 → 不可算，输出 null 并标「需按厂内口径复算」
   */
  const recompute = [];   // 需按厂内口径复算的指标
  function ruleMode(name, structured) {
    if (!rules || !rules[name]) return { ok: true, mode: usingDefault ? '默认口径' : '默认口径（口径表未命中）' };
    const r = rules[name];
    if (structured) return { ok: true, mode: '厂内口径（结构化参数）' };
    if (normAlgo(r.algo) === normAlgo(DEFAULT_ALGO[name])) return { ok: true, mode: '厂内口径（与默认算法一致）' };
    recompute.push({ metric: name, algo: r.algo, reason: '厂内口径表算法与脚本默认算法不一致，且未提供结构化口径参数（分母 / 剔除封存 列或 --intact-denominator / --sealed），脚本不按默认算法出数' });
    return { ok: false, mode: '需按厂内口径复算' };
  }

  // ---- 归集：daily.json / leaks.json 与 xlsx 原始表
  const dailies = [];
  const outOfRange = [];
  const sources = [];
  let leaksJson = null, rotationJson = null;
  let defectRows = null, orderRows = null, planRows = null, faultRows = null, ledgerRows = null, spareRows = null;
  let specialRows = null, standbyRows = null, sealRows = null, shutdownRows = null;
  const scopes = [];                                          // 各表车间范围核对结果 → meta.workshopScope
  const jsonScope = { matched: [], unknown: [], excluded: [] };  // 上游 JSON 车间核对 → meta.upstreamWorkshop
  const scoped = (recs, sheet) => scopeRows(recs, sheet, a.workshop, scopes);
  const inScope = (name, j) => jsonInScope(name, j, a.workshop, jsonScope);

  for (const p of inputs) {
    const got = loadAny(p);
    if (got.kind === 'json') {
      if ((isLeaks(got.data) || isRotation(got.data) || isDaily(got.data)) && !inScope(got.name, got.data)) continue;
      if (isLeaks(got.data)) { if (!leaksJson) { leaksJson = got.data; sources.push(`${got.name}→泄漏点跟踪(JSON)`); } continue; }
      if (isRotation(got.data)) { if (!rotationJson) { rotationJson = got.data; sources.push(`${got.name}→备机切换(JSON)`); } continue; }
      if (!isDaily(got.data)) { warnings.push(`${got.name} 不是 equipment-daily-report 的 daily.json（缺 meta.date 或 counts.equipment），也不是 leak-point-tracker 的 leaks.json，已忽略`); continue; }
      const d = C.normDate(got.data.meta.date);
      if (!d) { warnings.push(`${got.name} 的 meta.date「${C.str(got.data.meta.date)}」无法解析为日期，已忽略`); continue; }
      if (!inRange(d)) { outOfRange.push({ file: got.name, date: d }); continue; }
      if (dailies.some((x) => x.date === d)) { warnings.push(`${got.name} 与已读入的日报日期重复（${d}），已忽略后者`); continue; }
      dailies.push({ date: d, file: got.name, data: got.data });
      continue;
    }
    const book = got.data;
    const sDef = C.pickSheet(book, '缺陷台账', '缺陷', '通知单');
    if (sDef && !defectRows) {
      defectRows = scoped(C.toRecords(sDef, ['位号'], `${got.name}/缺陷台账`, ['设备名称', '缺陷描述', '等级', '状态', '发现时间', '闭环时间', '专业', '设备类型', '车间'], warnings, ALIASES), `${got.name}/缺陷台账`);
      sources.push(`${got.name}→缺陷台账`);
    }
    const sOrd = C.pickSheet(book, '工单台账', '工单', '订单');
    if (sOrd && !orderRows) {
      orderRows = scoped(C.toRecords(sOrd, ['工单号'], `${got.name}/工单台账`, ['位号', '状态', '要求完成时间', '闭环时间', '责任人', '缺陷描述', '工作中心', '车间'], warnings, ALIASES), `${got.name}/工单台账`);
      sources.push(`${got.name}→工单台账`);
    }
    const sPlan = C.pickSheet(book, '检修计划', '检修');
    if (sPlan && !planRows) {
      planRows = scoped(C.toRecords(sPlan, ['项目名称'], `${got.name}/检修计划`, ['位号', '状态', '计划完成', '实际完成', '责任人', '检修类别', '车间'], warnings, ALIASES), `${got.name}/检修计划`);
      sources.push(`${got.name}→检修计划`);
    }
    const sFlt = C.pickSheet(book, '故障记录', '故障');
    if (sFlt && !faultRows) {
      faultRows = scoped(C.toRecords(sFlt, ['位号'], `${got.name}/故障记录`, ['设备名称', '设备类型', '专业', '故障描述', '故障时间', '停机时长', '修复时长', '是否停机', '车间'], warnings, ALIASES), `${got.name}/故障记录`);
      sources.push(`${got.name}→故障记录`);
    }
    // 「台账」是宽匹配：先排除工单台账、缺陷台账、特种设备台账、润滑/巡检台账等其它台账，避免没给设备台账时把它们当成设备台账；表名含「设备台账」「技术对象」的先放行
    const ledgerBook = Object.fromEntries(Object.entries(book).filter(([k]) => !isNotLedger(k)));
    const sLdg = C.pickSheet(ledgerBook, '设备台账', '台账', '技术对象');
    if (sLdg && !ledgerRows) {
      ledgerRows = scoped(C.toRecords(sLdg, ['位号'], `${got.name}/设备台账`, ['设备名称', '设备类型', '专业', '在用', '完好', '重要度', '车间'], warnings, ALIASES), `${got.name}/设备台账`);
      sources.push(`${got.name}→设备台账`);
    }
    const sSpr = C.pickSheet(book, '备件消耗', '备件', '领料');
    if (sSpr && !spareRows) {
      spareRows = scoped(C.toRecords(sSpr, ['备件名称'], `${got.name}/备件消耗`, ['位号', '数量', '单位', '金额', '时间', '车间'], warnings, ALIASES), `${got.name}/备件消耗`);
      sources.push(`${got.name}→备件消耗`);
    }
    const sSpec = C.pickSheet(book, '特护设备', '特护', '特护机组');
    if (sSpec && !specialRows) {
      specialRows = scoped(C.toRecords(sSpec, ['位号'], `${got.name}/特护设备`, ['设备名称', '状态', '运行参数', '备注', '车间'], warnings, ALIASES), `${got.name}/特护设备`);
      sources.push(`${got.name}→特护设备`);
    }
    const sStb = C.pickSheet(book, '备机', '备用设备', '备机台账');
    if (sStb && !standbyRows) {
      standbyRows = scoped(C.toRecords(sStb, ['位号'], `${got.name}/备机`, ['设备名称', '状态', '是否可投用', '备注', '车间'], warnings, ALIASES), `${got.name}/备机`);
      sources.push(`${got.name}→备机`);
    }
    const sSeal = C.pickSheet(book, '密封点统计', '密封点', '泄漏率', 'LDAR');
    if (sSeal && !sealRows) {
      sealRows = scoped(C.toRecords(sSeal, ['密封点类型'], `${got.name}/密封点统计`, ['密封点总数', '泄漏点数', '车间'], warnings, ALIASES), `${got.name}/密封点统计`);
      sources.push(`${got.name}→密封点统计`);
    }
    const sShut = C.pickSheet(book, '停工记录', '非计划停工', '停工');
    if (sShut && !shutdownRows) {
      shutdownRows = scoped(C.toRecords(sShut, ['停工时间'], `${got.name}/停工记录`, ['停工类别', '原因', '装置', '车间'], warnings, ALIASES), `${got.name}/停工记录`);
      sources.push(`${got.name}→停工记录`);
    }
  }
  if (a.spare) {
    if (!fs.existsSync(a.spare)) throw new Error(`备件消耗表不存在: ${a.spare}`);
    const book = readXlsx(a.spare);
    const sSpr = C.pickSheet(book, '备件消耗', '备件', '领料');
    if (!sSpr) warnings.push(`备件消耗表「${path.basename(a.spare)}」中未找到「备件消耗」工作表`);
    else {
      spareRows = scoped(C.toRecords(sSpr, ['备件名称'], `${path.basename(a.spare)}/备件消耗`, ['位号', '数量', '单位', '金额', '时间', '车间'], warnings, ALIASES), `${path.basename(a.spare)}/备件消耗`);
      sources.push(`${path.basename(a.spare)}→备件消耗`);
    }
  }

  dailies.sort((x, y) => (x.date < y.date ? -1 : 1));
  for (const d of dailies) sources.push(`${d.file}→日报 ${d.date}(JSON)`);
  if (outOfRange.length) warnings.push(`${outOfRange.length} 份日报日期不在统计区间 ${from} ~ ${to} 内，未计入：${outOfRange.map((x) => `${x.file}(${x.date})`).join('、')}`);
  if (!sources.length) throw new Error(`未在输入中识别到任何可用数据（daily.json / leaks.json / rotation.json，或含设备台账/故障记录/检修计划/工单台账/缺陷台账/备件消耗/特护设备/备机/密封点统计/停工记录的 xlsx）${jsonScope.excluded.length ? `；另有 ${jsonScope.excluded.length} 份上游 JSON 因车间与 --workshop 不一致未纳入` : ''}`);

  // ---- 数据缺口
  const allDates = [];
  for (let i = 0; i < spanDays; i++) allDates.push(C.addDays(from, i));
  const haveDates = new Set(dailies.map((d) => d.date));
  const missingDates = dailies.length ? allDates.filter((d) => !haveDates.has(d)) : [];
  const coveredDays = dailies.length;
  const basedOn = dailies.length ? `基于 ${coveredDays} 天数据（应为 ${spanDays} 天）` : '基于原始台账数据（未提供日报 JSON，无逐日覆盖信息）';
  if (dailies.length && missingDates.length) {
    warnings.push(`统计区间内缺少 ${missingDates.length} 天日报数据：${missingDates.join('、')}；指标已按实际覆盖的 ${coveredDays} 天计算，未外推补齐`);
  }
  const dataGaps = {
    spanDays, coveredDays: dailies.length ? coveredDays : null, missingDates, basedOn,
    dailyFiles: dailies.map((d) => ({ date: d.date, file: d.file })), outOfRange,
    noDenominator: [], notProvided: [], recompute,
  };

  function sumDaily(key) {
    let sum = null, n = 0;
    for (const d of dailies) {
      const v = d.data.counts ? d.data.counts[key] : null;
      if (v === null || v === undefined || !Number.isFinite(Number(v))) continue;
      sum = (sum === null ? 0 : sum) + Number(v);
      n++;
    }
    return { sum, days: n };
  }
  function lastDaily(key) {
    for (let i = dailies.length - 1; i >= 0; i--) {
      const v = dailies[i].data.counts ? dailies[i].data.counts[key] : null;
      if (v !== null && v !== undefined && Number.isFinite(Number(v))) return { value: Number(v), date: dailies[i].date };
    }
    return { value: null, date: null };
  }

  // ================================================================ 指标
  // 1) 设备完好率 = 完好台数 / 在用设备台数（剔除长期停用、封存）；无「在用」列 → null
  const denomParam = a['intact-denominator'] || (rules && rules['设备完好率'] && rules['设备完好率'].denominator) || null;
  const sealedParam = a.sealed ? a.sealed === '剔除' : (rules && rules['设备完好率'] && rules['设备完好率'].sealed !== null && rules['设备完好率'].sealed !== undefined ? rules['设备完好率'].sealed : null);
  const intactStructured = !!(denomParam || sealedParam !== null);
  const intactMode = ruleMode('设备完好率', intactStructured);
  const intactDenom = denomParam || '在用';
  const intactSealedOut = sealedParam === null ? true : sealedParam;
  const today = C.localDate();
  const pastTo = to < today;
  let intactRate = null, intactGood = null, intactTotal = null, intactNote = '';
  let majorRate = null, majorGood = null, majorTotal = null, majorNote = '';
  const majorMode = ruleMode('主要设备完好率', false);
  const judgeGood = (r, undet) => {
    const bad = /^(非|不|未)|待修|带病|停用|故障|否$|^N$|^0$/i;
    const good = /完好|良好|正常|^是$|^Y$|^1$/i;
    const v = C.str(r['完好']);
    if (v === '') { undet.push(r._row); return false; }
    if (bad.test(v)) return false;
    if (good.test(v)) return true;
    undet.push(r._row);
    return false;
  };
  if (ledgerRows && ledgerRows.length) {
    const hasInUse = ledgerRows.hasCol && ledgerRows.hasCol('在用');
    const hasGood = ledgerRows.hasCol && ledgerRows.hasCol('完好');
    const hasImp = ledgerRows.hasCol && ledgerRows.hasCol('重要度');
    let base = null;
    if (intactDenom === '在册') {
      base = ledgerRows.slice();
      if (intactSealedOut && hasInUse) base = base.filter((r) => !/封存|长期停|闲置|报废|退役/.test(C.str(r['在用'])));
      intactNote = `分母按在册台数${intactSealedOut ? '（剔除封存）' : '（含封存）'}，为厂内结构化口径`;
    } else if (!hasInUse) {
      intactNote = '台账缺「在用」列，无法确定在用台数（分母），不得按在册台数计算';
    } else {
      const undetUse = [];
      base = ledgerRows.filter((r) => {
        const v = C.str(r['在用']);
        if (v === '') { undetUse.push(r._row); return false; }
        if (/^(否|N|0)$|停用|停运|封存|长期停|闲置|报废|退役|不在用|非在用/i.test(v)) return false;
        if (!intactSealedOut && /封存/.test(v)) return true;
        return true;
      });
      if (undetUse.length) warnings.push(`设备台账有 ${undetUse.length} 台「在用」列为空，无法判定是否在用，未计入完好率分母，也未按在用默认处理（行号：${undetUse.join('、')}）`);
    }
    if (base) {
      intactTotal = base.length || null;
      if (hasGood) {
        const undet = [];
        intactGood = base.filter((r) => judgeGood(r, undet)).length;
        if (undet.length) warnings.push(`设备台账有 ${undet.length} 台「完好」列为空或取值无法判定（行号：${undet.join('、')}），未计入完好台数，也未按完好默认处理`);
        // 主要设备完好率（A/B 类）
        if (hasImp) {
          const undetImp = [];
          const major = base.filter((r) => { const m = isMajor(r['重要度']); if (m === null) undetImp.push(r._row); return m === true; });
          if (undetImp.length) warnings.push(`设备台账有 ${undetImp.length} 台「重要度」为空或无法归入 A/B/C（行号：${undetImp.join('、')}），未计入主要设备完好率`);
          majorTotal = major.length || null;
          const u2 = [];
          majorGood = majorTotal ? major.filter((r) => judgeGood(r, u2)).length : null;
          if (!majorTotal) majorNote = '台账中无 A/B 类（关键/主要）在用设备';
        } else majorNote = '台账缺「重要度」列（ABC 标识），无法区分 A/B 类设备';
      } else {
        warnings.push('设备台账缺少「完好」列，无法统计完好台数，设备完好率输出为空');
        intactNote = '台账未提供「完好」列';
        majorNote = '台账未提供「完好」列';
      }
    } else if (!majorNote) majorNote = intactNote;
  } else { intactNote = '未提供设备台账，在用设备台数（分母）缺失'; majorNote = '未提供设备台账'; }
  const intactSnapshotNote = pastTo && ledgerRows && ledgerRows.length ? `完好率、主要设备完好率按设备台账当前状态计算（本报告 ${today} 生成），不是 ${to} 时点的状态` : null;
  if (!intactMode.ok) { intactRate = null; intactNote = '需按厂内口径复算'; }
  else if (intactTotal && intactGood !== null) intactRate = C.round((intactGood / intactTotal) * 100, 1);
  else {
    intactRate = null;
    if (!intactNote) intactNote = '分母（在用设备台数）缺失';
    dataGaps.noDenominator.push({ metric: '设备完好率', reason: intactNote + '，指标输出为空，不以在册台数或估计值代替' });
    warnings.push(`设备完好率无法计算：${intactNote}；已输出空值（—），未使用在册台数或估计值代替`);
  }
  if (!majorMode.ok) { majorRate = null; majorNote = '需按厂内口径复算'; }
  else if (majorTotal && majorGood !== null) majorRate = C.round((majorGood / majorTotal) * 100, 1);
  else { majorRate = null; dataGaps.noDenominator.push({ metric: '主要设备完好率', reason: (majorNote || '分母缺失') + '，指标输出为空' }); }

  // 2) 备机完好率
  const standbyMode = ruleMode('备机完好率', false);
  let standby = null, standbyRate = null, standbyTotal = null, standbyGood = null;
  if (standbyRows && standbyRows.length) {
    const hasAvail = standbyRows.hasCol && standbyRows.hasCol('是否可投用');
    const list = standbyRows.map((r) => {
      const st = C.str(r['状态']);
      const av = C.str(r['是否可投用']);
      let good = null;
      if (/检修|在修|维修|故障|待修/.test(st)) good = false;
      else if (av) good = /^(是|Y|1|可|可投用|可用)$/i.test(av) ? true : /^(否|N|0|不可|不可投用|不可用)$/i.test(av) ? false : null;
      return { tag: C.str(r['位号']), name: C.str(r['设备名称']), status: st, avail: av, good, note: C.str(r['备注']), row: r._row };
    });
    const undet = list.filter((x) => x.good === null);
    if (!hasAvail) warnings.push('备机表缺「是否可投用」列，仅状态为检修/故障的备机判为不完好，其余无法判定');
    if (undet.length) warnings.push(`备机表有 ${undet.length} 台无法判定是否可投用（行号：${undet.map((x) => x.row).join('、')}），未计入完好备机，也未按完好默认处理`);
    standbyTotal = list.length;
    standbyGood = list.filter((x) => x.good === true).length;
    standby = { total: standbyTotal, good: standbyGood, undetermined: undet.length, list };
    if (!standbyMode.ok) standbyRate = null;
    else if (!undet.length || hasAvail) standbyRate = C.round((standbyGood / standbyTotal) * 100, 1);
    else { standbyRate = null; dataGaps.noDenominator.push({ metric: '备机完好率', reason: '备机表缺「是否可投用」列且存在无法判定的备机，不按默认出数' }); }
  } else if (rotationJson) {
    // 来自 standby-rotation-reminder 的 rotation.json：standbyAvailability.{pairs, available, rate, statusMissing, statusUnknown}
    // 该技能已把检修中/停用备机排除在 available 之外；状态未填或无法识别时其 rate 为 null，这里同样不出数
    const sa = rotationJson.standbyAvailability || {};
    const total = Number.isFinite(sa.pairs) ? sa.pairs : null;
    const good = Number.isFinite(sa.available) ? sa.available : null;
    const undet = (Number.isFinite(sa.statusMissing) ? sa.statusMissing : 0) + (Number.isFinite(sa.statusUnknown) ? sa.statusUnknown : 0);
    standbyTotal = total; standbyGood = good;
    standby = { total, good, undetermined: undet, list: [], source: 'rotation.json', inRepair: sa.inRepair ?? null, stopped: sa.stopped ?? null };
    if (!standbyMode.ok || total === null || good === null || total <= 0 || sa.rate === null || sa.rate === undefined) {
      standbyRate = null;
      dataGaps.noDenominator.push({ metric: '备机完好率', reason: 'rotation.json 的 standbyAvailability 缺备机状态或存在未判定备机（rate 为空），不按默认出数' });
    } else standbyRate = C.round((good / total) * 100, 1);
  } else dataGaps.notProvided.push({ metric: '备机完好率', reason: '未提供备机表或 standby-rotation-reminder 的 rotation.json' });

  // 3) 静/动密封点泄漏率（‰）
  const sealStatic = { mode: ruleMode('静密封点泄漏率', false) }, sealDynamic = { mode: ruleMode('动密封点泄漏率', false) };
  let seal = null;
  function sealFrom(total, leaks, label) {
    const t = total, l = leaks;
    if (t === null || t === undefined || l === null || l === undefined) return { total: t ?? null, leaks: l ?? null, rate: null, note: `${label}密封点总数或泄漏点数缺失` };
    if (!t) return { total: t, leaks: l, rate: null, note: `${label}密封点总数为 0 或缺失，分母缺失` };
    return { total: t, leaks: l, rate: C.round((l / t) * 1000, 2), note: '' };
  }
  if (sealRows && sealRows.length) {
    let st = null, sl = null, dt = null, dl = null;
    for (const r of sealRows) {
      const t = C.str(r['密封点类型']);
      const tot = num(r['密封点总数'], { sheet: '密封点统计', row: r._row, col: '密封点总数' });
      const lk = num(r['泄漏点数'], { sheet: '密封点统计', row: r._row, col: '泄漏点数' });
      if (/静/.test(t)) { st = tot; sl = lk; } else if (/动/.test(t)) { dt = tot; dl = lk; } else warnings.push(`密封点统计 第${r._row}行 类型「${t}」不是静/动密封，已忽略`);
    }
    seal = { source: '密封点统计表', static: sealFrom(st, sl, '静'), dynamic: sealFrom(dt, dl, '动') };
  } else if (leaksJson && leaksJson.sealPoints) {
    const sp = leaksJson.sealPoints;
    seal = { source: 'leaks.json', static: sealFrom(sp.static?.total ?? null, sp.static?.leaks ?? null, '静'), dynamic: sealFrom(sp.dynamic?.total ?? null, sp.dynamic?.leaks ?? null, '动') };
  } else if (leaksJson) {
    seal = null;
    dataGaps.notProvided.push({ metric: '静/动密封点泄漏率', reason: 'leaks.json 未含 sealPoints（静/动密封点总数与泄漏点数），只能列泄漏点数，不算泄漏率' });
  } else dataGaps.notProvided.push({ metric: '静/动密封点泄漏率', reason: '未提供密封点统计表或 leaks.json' });
  if (seal) {
    if (!sealStatic.mode.ok) seal.static.rate = null;
    if (!sealDynamic.mode.ok) seal.dynamic.rate = null;
    for (const [k, cn] of [['static', '静密封点泄漏率'], ['dynamic', '动密封点泄漏率']]) {
      if (seal[k].rate === null && seal[k].note) dataGaps.noDenominator.push({ metric: cn, reason: seal[k].note });
    }
  }
  const leakPoints = leaksJson ? { leaks: leaksJson.counts.leaks ?? null, open: leaksJson.counts.open ?? null, overdue: leaksJson.counts.overdue ?? null, repaired: leaksJson.counts.repaired ?? null, repairRate: leaksJson.metrics?.repairRate ?? null } : null;

  // 4) 检修计划完成率（按大检修 / 日常维修分列）
  const planMode = ruleMode('检修计划完成率', false);
  let planTotal = null, planOnTime = null, planDone = null, planRate = null, planList = [], planByCat = null, planHasCat = false;
  if (planRows && planRows.length) {
    planHasCat = !!(planRows.hasCol && planRows.hasCol('检修类别'));
    planList = planRows.map((r) => {
      const planEnd = C.normDate(r['计划完成']);
      const actEnd = C.normDate(r['实际完成']);
      const st = C.str(r['状态']);
      const done = planDoneBy(actEnd, st);
      let onTime = null;
      if (done && planEnd && actEnd) onTime = C.diffDays(actEnd, planEnd) <= 0;
      const cat = planHasCat ? (maintCategory(r['检修类别']) || '未归类') : '未提供类别';
      return { project: C.str(r['项目名称']), tag: C.str(r['位号']), status: st, planEnd, actEnd, done, onTime, owner: C.str(r['责任人']), category: cat, rawCategory: C.str(r['检修类别']), row: r._row };
    });
    const inR = planList.filter((x) => inRange(x.planEnd));
    const noPlanEnd = planList.filter((x) => !x.planEnd);
    if (noPlanEnd.length) warnings.push(`检修计划有 ${noPlanEnd.length} 项未填「计划完成」日期，无法判断是否落在统计区间，未计入完成率分母（行号：${noPlanEnd.map((x) => x.row).join('、')}）`);
    const unCat = inR.filter((x) => x.category === '未归类');
    if (unCat.length) warnings.push(`检修计划有 ${unCat.length} 项「检修类别」无法归入 大检修/日常维修/抢修/专项（行号：${unCat.map((x) => x.row).join('、')}），按「未归类」单列`);
    planTotal = inR.length || null;
    const rateOf = (list) => {
      const t = list.length || null;
      if (!t) return { total: null, done: null, onTime: null, rate: null };
      const d = list.filter((x) => x.done).length, o = list.filter((x) => x.onTime === true).length;
      return { total: t, done: d, onTime: o, rate: planMode.ok ? C.round((o / t) * 100, 1) : null };
    };
    if (planTotal) {
      const all = rateOf(inR);
      planDone = all.done; planOnTime = all.onTime; planRate = all.rate;
      const und = inR.filter((x) => x.done && x.onTime === null);
      if (und.length) warnings.push(`检修计划有 ${und.length} 项已完工但缺「实际完成」日期，无法判断是否按期，未计入按期完成数（行号：${und.map((x) => x.row).join('、')}）`);
      planByCat = {};
      for (const cat of ['大检修', '日常维修', '抢修', '专项', '未归类', '未提供类别']) {
        const l = inR.filter((x) => x.category === cat);
        if (l.length) planByCat[cat] = rateOf(l);
      }
      if (!planHasCat) warnings.push('检修计划缺「检修类别」列，无法按大检修/日常维修分列完成率，仅给合计');
    } else dataGaps.noDenominator.push({ metric: '检修计划完成率', reason: '统计区间内无计划完成日期的检修项目，分母为空' });
  } else dataGaps.noDenominator.push({ metric: '检修计划完成率', reason: '未提供检修计划数据，分母缺失' });

  // 5) 工单及时率
  const orderMode = ruleMode('工单及时率', false);
  let orderDue = null, orderOnTime = null, orderRate = null, orderOverdueList = [], orderPending = null;
  if (orderRows && orderRows.length) {
    const rows = orderRows.map((r) => ({
      no: C.str(r['工单号']), tag: C.str(r['位号']), status: C.str(r['状态']),
      due: C.normDate(r['要求完成时间']), closedAt: C.normDate(r['闭环时间']),
      owner: C.str(r['责任人']) || C.str(r['工作中心']), workCenter: C.str(r['工作中心']) || null, desc: C.str(r['缺陷描述']), row: r._row,
    })).filter((x) => C.normSapStatus(x.status) !== '已取消');
    const shouldClose = rows.filter((x) => inRange(x.due));
    const noDue = rows.filter((x) => !x.due);
    if (noDue.length) warnings.push(`工单台账有 ${noDue.length} 张未填「要求完成时间」，未计入应闭环工单分母（行号：${noDue.map((x) => x.row).join('、')}）`);
    orderDue = shouldClose.length || null;
    orderPending = shouldClose.filter((x) => C.normSapStatus(x.status) === '待验收').length;
    if (orderDue) {
      const undet = shouldClose.filter((x) => isClosed(x.status) && !x.closedAt);
      if (undet.length) warnings.push(`工单台账有 ${undet.length} 张标记已闭环但缺「闭环时间」，无法判断是否按期，未计入按期闭环数（工单号：${undet.map((x) => x.no || '第' + x.row + '行').join('、')}）`);
      orderOnTime = shouldClose.filter((x) => isClosed(x.status) && x.closedAt && C.diffDays(x.closedAt, x.due) <= 0).length;
      orderRate = orderMode.ok ? C.round((orderOnTime / orderDue) * 100, 1) : null;
      orderOverdueList = shouldClose
        .filter((x) => !isClosed(x.status) || (x.closedAt && C.diffDays(x.closedAt, x.due) > 0))
        .map((x) => ({ no: x.no, tag: x.tag, desc: x.desc, due: x.due, closedAt: isClosed(x.status) ? x.closedAt : null, status: C.normSapStatus(x.status) || x.status, owner: x.owner, workCenter: x.workCenter, overdueDays: isClosed(x.status) && x.closedAt ? C.diffDays(x.closedAt, x.due) : C.diffDays(to, x.due) }));
    } else dataGaps.noDenominator.push({ metric: '工单及时率', reason: '统计区间内无要求完成时间的工单，分母为空' });
  } else if (dailies.length) dataGaps.noDenominator.push({ metric: '工单及时率', reason: '仅提供日报 JSON，缺工单逐张的要求完成与闭环时间，分母无法确定' });
  else dataGaps.noDenominator.push({ metric: '工单及时率', reason: '未提供工单台账，分母缺失' });

  // 6) MTTR、故障停机时长、故障停机次数
  const mttrMode = ruleMode('平均修复时间', false), downMode = ruleMode('故障停机时长', false), downCntMode = ruleMode('故障停机次数', false);
  let faults = [], mttr = null, downtime = null, repairCount = null, downtimeCount = null;
  if (faultRows && faultRows.length) {
    faults = faultRows.map((r) => {
      const at = C.normDate(r['故障时间']);
      const stopRaw = C.str(r['是否停机']);
      return {
        tag: C.str(r['位号']), name: C.str(r['设备名称']),
        type: C.str(r['设备类型']) || '未填类型', discipline: C.str(r['专业']) || '未填专业',
        desc: C.str(r['故障描述']), at,
        down: num(r['停机时长'], { sheet: '故障记录', row: r._row, col: '停机时长' }),
        repair: num(r['修复时长'], { sheet: '故障记录', row: r._row, col: '修复时长' }),
        stop: stopRaw ? /^(是|Y|1)$/i.test(stopRaw) : null,
        row: r._row,
      };
    });
    const noDate = faults.filter((x) => !x.at);
    if (noDate.length) warnings.push(`故障记录有 ${noDate.length} 条未填「故障时间」，无法判断是否落在统计区间，未计入故障统计（行号：${noDate.map((x) => x.row).join('、')}）`);
    faults = faults.filter((x) => inRange(x.at));
    const withRepair = faults.filter((x) => x.repair !== null);
    repairCount = withRepair.length || null;
    if (repairCount && mttrMode.ok) mttr = C.round(withRepair.reduce((s, x) => s + x.repair, 0) / repairCount, 2);
    else if (!repairCount) dataGaps.noDenominator.push({ metric: '平均修复时间 MTTR', reason: '故障记录中无可解析的「修复时长」，分母（修复次数）为空' });
    const withDown = faults.filter((x) => x.down !== null);
    downtime = withDown.length && downMode.ok ? C.round(withDown.reduce((s, x) => s + x.down, 0), 2) : null;
    if (faults.length && !withDown.length) warnings.push('故障记录中「停机时长」均无法解析或为空，故障停机时长合计输出为空（—），未按 0 计');
    const missDown = faults.length - withDown.length;
    if (withDown.length && missDown > 0) warnings.push(`故障记录有 ${missDown} 条未填「停机时长」，停机时长合计仅累加已填写的 ${withDown.length} 条`);
    // 故障停机次数：是否停机=是，或停机时长>0；两者皆无 → 不计且 warning
    const undetStop = faults.filter((x) => x.stop === null && x.down === null);
    downtimeCount = downCntMode.ok ? faults.filter((x) => x.stop === true || (x.stop === null && x.down !== null && x.down > 0)).length : null;
    if (faults.length && undetStop.length) warnings.push(`故障记录有 ${undetStop.length} 条既无「是否停机」也无「停机时长」，无法判断是否停机，未计入故障停机次数（行号：${undetStop.map((x) => x.row).join('、')}）`);
    if (faults.length && undetStop.length === faults.length) downtimeCount = null;
  }

  const tally = (list, key) => {
    const m = {};
    for (const x of list) { const k = x[key] || '未填'; m[k] = (m[k] || 0) + 1; }
    return Object.entries(m).sort((p, q) => q[1] - p[1]).map(([name, count]) => ({ name, count }));
  };
  const rank = {};
  for (const f of faults) {
    const k = f.tag || '（未填位号）';
    if (!rank[k]) rank[k] = { tag: k, name: f.name, discipline: f.discipline, type: f.type, count: 0, downtime: null };
    rank[k].count++;
    if (f.down !== null) rank[k].downtime = (rank[k].downtime === null ? 0 : rank[k].downtime) + f.down;
  }
  const topFaults = Object.values(rank).sort((p, q) => q.count - p.count || (q.downtime || 0) - (p.downtime || 0)).slice(0, topN)
    .map((x) => ({ ...x, downtime: C.round(x.downtime, 2) }));
  const failures = faultRows ? {
    total: faults.length, downtimeCount,
    byDiscipline: tally(faults, 'discipline'), byType: tally(faults, 'type'), top: topFaults,
    list: faults.map((x) => ({ tag: x.tag, name: x.name, type: x.type, discipline: x.discipline, desc: x.desc, at: x.at, down: x.down, repair: x.repair, stop: x.stop })),
  } : null;

  // 7) 非计划停工次数
  const shutMode = ruleMode('非计划停工次数', false);
  let shutdown = null, unplannedShutdowns = null;
  if (shutdownRows && shutdownRows.length) {
    const hasCat = shutdownRows.hasCol && shutdownRows.hasCol('停工类别');
    const list = shutdownRows.map((r) => {
      const at = C.normDate(r['停工时间']);
      const cat = C.str(r['停工类别']);
      const unplanned = !hasCat || !cat ? null : /非计划|非计划停工|否|N/i.test(cat) ? true : /计划|是|Y/i.test(cat) ? false : null;
      return { at, category: cat, unplanned, reason: C.str(r['原因']), unit: C.str(r['装置']), row: r._row };
    }).filter((x) => inRange(x.at));
    const undet = list.filter((x) => x.unplanned === null);
    if (!hasCat) warnings.push('停工记录缺「停工类别」列，无法区分计划/非计划停工，非计划停工次数不出数');
    else if (undet.length) warnings.push(`停工记录有 ${undet.length} 条类别无法判定为计划/非计划（行号：${undet.map((x) => x.row).join('、')}），未计入`);
    unplannedShutdowns = hasCat && shutMode.ok ? list.filter((x) => x.unplanned === true).length : null;
    shutdown = { total: list.length, unplanned: unplannedShutdowns, undetermined: undet.length, list };
  } else dataGaps.notProvided.push({ metric: '非计划停工次数', reason: '未提供停工记录（按《炼化企业非计划停工管理规定》报送口径，与事故快报分开），不估算' });

  // 8) 特护设备运行状况（优先特护设备表；否则汇总各日报 special 节）
  let special = null;
  if (specialRows && specialRows.length) {
    special = { source: '特护设备表', list: specialRows.map((r) => ({ tag: C.str(r['位号']), name: C.str(r['设备名称']), state: C.str(r['状态']) || '—', params: C.str(r['运行参数']), note: C.str(r['备注']), abnormalDays: null, days: null })) };
  } else if (dailies.some((d) => d.data.special && Array.isArray(d.data.special.list))) {
    const m = {};
    for (const d of dailies) {
      if (!d.data.special || !Array.isArray(d.data.special.list)) continue;
      for (const x of d.data.special.list) {
        if (!m[x.tag]) m[x.tag] = { tag: x.tag, name: x.name || '', state: '', params: '', note: '', abnormalDays: 0, days: 0, lastDate: null };
        const it = m[x.tag];
        it.days++;
        if (x.state === '异常') it.abnormalDays++;
        it.state = x.state || it.state; it.params = x.params || it.params; it.note = x.desc || it.note; it.lastDate = d.date;
      }
    }
    special = { source: '日报汇总', list: Object.values(m).map((x) => ({ ...x, state: `${x.state}（${x.lastDate}）` })) };
  } else dataGaps.notProvided.push({ metric: '特护设备运行状况', reason: '未提供特护设备表，日报 JSON 亦无 special 节' });
  if (special) special.total = special.list.length;

  // ---- 缺陷（优先日报汇总，其次台账）
  let defects = null;
  if (dailies.length) {
    const nd = sumDaily('newDefects');
    const od = lastDaily('openDefects');
    const pa = lastDaily('pendingAcceptDefects');
    defects = { source: '日报汇总', newTotal: nd.sum, newDays: nd.days, openAtEnd: od.value, openAtEndDate: od.date, pendingAcceptAtEnd: pa.value, closedInRange: null, byLevel: null };
    if (nd.days && nd.days < coveredDays) warnings.push(`新增缺陷累计仅覆盖 ${nd.days} 天（读入日报 ${coveredDays} 天），其余日报该项为空，未按 0 计`);
  } else if (defectRows && defectRows.length) {
    const rows = defectRows.map((r) => ({
      tag: C.str(r['位号']), name: C.str(r['设备名称']), desc: C.str(r['缺陷描述']),
      level: C.str(r['等级']) || '未填等级', status: C.str(r['状态']),
      foundAt: C.normDate(r['发现时间']), closedAt: C.normDate(r['闭环时间']), row: r._row,
    })).filter((x) => C.normSapStatus(x.status) !== '已取消');
    const newOnes = rows.filter((x) => inRange(x.foundAt));
    const byLevel = {};
    for (const x of newOnes) byLevel[x.level] = (byLevel[x.level] || 0) + 1;
    // 期末存量按 --to 回推：发现日期晚于 --to 的不计；已闭环但闭环日期晚于 --to 的仍算期末未闭环
    const asOf = rows.filter((x) => !x.foundAt || x.foundAt <= to);
    const foundAfter = rows.length - asOf.length;
    const openAt = (x) => !isClosed(x.status) || (x.closedAt && x.closedAt > to);
    const noFound = asOf.filter((x) => !x.foundAt);
    const closedNoDate = asOf.filter((x) => isClosed(x.status) && !x.closedAt);
    if (pastTo && noFound.length) warnings.push(`缺陷台账有 ${noFound.length} 条缺「发现时间」（行号：${noFound.map((x) => x.row).join('、')}），无法判断是否在 ${to} 前发现，按当前状态计入期末存量`);
    if (pastTo && closedNoDate.length) warnings.push(`缺陷台账有 ${closedNoDate.length} 条已闭环但缺「闭环时间」（行号：${closedNoDate.map((x) => x.row).join('、')}），无法判断是否在 ${to} 前闭环，按已闭环计`);
    defects = {
      source: '缺陷台账', newTotal: newOnes.length, newDays: null,
      openAtEnd: asOf.filter(openAt).length, openAtEndDate: to,
      pendingAcceptAtEnd: asOf.filter((x) => C.normSapStatus(x.status) === '待验收' && openAt(x)).length,
      closedInRange: rows.filter((x) => isClosed(x.status) && inRange(x.closedAt)).length, byLevel,
      foundAfterTo: foundAfter,
      asOfNote: pastTo ? `期末未闭环按发现时间、闭环时间回推到 ${to}；待验收没有状态变更日期，按 ${today} 的当前状态计` : null,
    };
  }

  // ---- 工单存量
  let ordersSec = null;
  if (orderDue !== null || orderRows) ordersSec = { source: '工单台账', due: orderDue, onTime: orderOnTime, rate: orderRate, pendingAccept: orderPending, overdueList: orderOverdueList, openAtEnd: null };
  if (dailies.length) {
    const oo = lastDaily('openOrders'), ov = lastDaily('overdueOrders'), pa = lastDaily('pendingAcceptOrders');
    if (!ordersSec) ordersSec = { source: '日报汇总', due: null, onTime: null, rate: null, pendingAccept: null, overdueList: [], openAtEnd: null };
    ordersSec.openAtEnd = oo.value; ordersSec.overdueAtEnd = ov.value; ordersSec.pendingAcceptAtEnd = pa.value; ordersSec.snapshotDate = oo.date || ov.date;
  }

  // ---- 检修
  const maintenance = planRows ? {
    total: planTotal, done: planDone, onTime: planOnTime, rate: planRate, hasCategory: planHasCat, byCategory: planByCat,
    list: planList.map((x) => ({ project: x.project, tag: x.tag, category: x.category, status: x.status, planEnd: x.planEnd, actEnd: x.actEnd, onTime: x.onTime, owner: x.owner })),
    undetermined: planList.filter((x) => x.done && x.onTime === null).map((x) => ({ project: x.project, reason: x.planEnd ? '缺「实际完成」日期' : '缺「计划完成」日期' })),
  } : null;

  // ---- 备件
  let spare = null;
  if (spareRows && spareRows.length) {
    const rows = spareRows.map((r) => ({
      name: C.str(r['备件名称']), tag: C.str(r['位号']), unit: C.str(r['单位']) || '',
      qty: num(r['数量'], { sheet: '备件消耗', row: r._row, col: '数量' }),
      amount: num(r['金额'], { sheet: '备件消耗', row: r._row, col: '金额' }),
      at: C.normDate(r['时间']), row: r._row,
    }));
    const withAmt = rows.filter((x) => x.amount !== null);
    const byName = {};
    for (const x of rows) {
      if (!byName[x.name]) byName[x.name] = { name: x.name, unit: x.unit, qty: null, amount: null, times: 0 };
      byName[x.name].times++;
      if (x.qty !== null) byName[x.name].qty = (byName[x.name].qty === null ? 0 : byName[x.name].qty) + x.qty;
      if (x.amount !== null) byName[x.name].amount = (byName[x.name].amount === null ? 0 : byName[x.name].amount) + x.amount;
    }
    const missAmt = rows.length - withAmt.length;
    if (missAmt > 0) warnings.push(`备件消耗有 ${missAmt} 行「金额」为空或无法解析，金额合计仅累加已填写的 ${withAmt.length} 行，未按 0 计`);
    spare = {
      items: rows.length,
      totalAmount: withAmt.length ? C.round(withAmt.reduce((s, x) => s + x.amount, 0), 2) : null,
      amountRows: withAmt.length,
      top: Object.values(byName).sort((p, q) => (q.amount || 0) - (p.amount || 0) || q.times - p.times).slice(0, topN).map((x) => ({ ...x, qty: C.round(x.qty, 2), amount: C.round(x.amount, 2) })),
    };
  }

  // ---- 重点事项（只从已有记录中挑）
  const highlights = [];
  for (const f of topFaults.filter((x) => x.count > 1)) {
    highlights.push({ type: '故障频发设备', text: `${f.tag}${f.name ? '（' + f.name + '）' : ''} 区间内故障 ${f.count} 次${f.downtime !== null ? `，累计停机 ${f.downtime} 小时` : '，停机时长未记录'}` });
  }
  for (const o of orderOverdueList.slice(0, topN)) {
    // 责任方写单位（工作中心），没有工作中心列时才退回责任人；unit 供 meeting-material-builder 判断责任方是不是单位
    highlights.push({ type: '超期工单', no: o.no || null, tag: o.tag || null, unit: o.workCenter || null, text: `${o.no || '（未填工单号）'} ${o.tag || ''} ${o.desc || ''}，要求完成 ${o.due}，${o.closedAt ? `实际 ${o.closedAt} 闭环，超期 ${o.overdueDays} 天` : `截至 ${to} 未闭环（${o.status}），超期 ${o.overdueDays} 天`}，责任方 ${o.workCenter || o.owner || '未记录'}` });
  }
  if (maintenance) {
    for (const m of maintenance.list.filter((x) => !x.actEnd && x.planEnd && C.diffDays(to, x.planEnd) > 0 && !planDoneBy(null, x.status))) {
      highlights.push({ type: '检修计划未完成', tag: m.tag || null, text: `${m.project}${m.tag ? '（' + m.tag + '）' : ''}${m.category && m.category !== '未提供类别' ? `［${m.category}］` : ''} 计划完成 ${m.planEnd}，截至 ${to} 未完工，责任人 ${m.owner || '未记录'}` });
    }
  }
  if (special) for (const s of special.list.filter((x) => x.abnormalDays)) highlights.push({ type: '特护设备异常', text: `${s.tag}${s.name ? '（' + s.name + '）' : ''} 区间内 ${s.abnormalDays} 天日报记为异常（共 ${s.days} 天有记录）` });
  if (shutdown && shutdown.unplanned) highlights.push({ type: '非计划停工', text: `区间内非计划停工 ${shutdown.unplanned} 次，是否构成非计划停工事件按《炼化企业非计划停工管理规定》另行报送，本技能不判定` });

  // ---- 环比 / 同比
  function loadCompare(file, label) {
    if (!fs.existsSync(file)) throw new Error(`${label} periodic.json 不存在: ${file}`);
    let j;
    try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(`${label} periodic.json 解析失败: ${e.message}`); }
    if (!j.metrics || !j.meta) throw new Error(`${label} 文件不是 periodic.json（缺 meta 或 metrics）: ${file}`);
    return j;
  }
  const curMetrics = {
    intactRate, intactGood, intactTotal, majorRate, majorGood, majorTotal, standbyRate, standbyGood, standbyTotal,
    staticLeakRate: seal ? seal.static.rate : null, dynamicLeakRate: seal ? seal.dynamic.rate : null,
    planRate, planTotal, planOnTime,
    planRateOverhaul: planByCat && planByCat['大检修'] ? planByCat['大检修'].rate : null,
    planRateRoutine: planByCat && planByCat['日常维修'] ? planByCat['日常维修'].rate : null,
    orderRate, orderDue, orderOnTime,
    mttr, repairCount, downtime, downtimeCount, unplannedShutdowns,
    faultCount: faultRows ? faults.length : null,
    newDefects: defects ? defects.newTotal : null,
    openDefects: defects ? defects.openAtEnd : null,
  };
  const CMP_FIELDS = [
    ['intactRate', '设备完好率', '%'], ['majorRate', '主要设备完好率', '%'], ['standbyRate', '备机完好率', '%'],
    ['staticLeakRate', '静密封点泄漏率', '‰'], ['dynamicLeakRate', '动密封点泄漏率', '‰'],
    ['planRate', '检修计划完成率', '%'], ['planRateOverhaul', '大检修计划完成率', '%'], ['planRateRoutine', '日常维修计划完成率', '%'],
    ['orderRate', '工单及时率', '%'],
    ['mttr', '平均修复时间', '小时'], ['downtime', '故障停机时长', '小时'], ['faultCount', '故障次数', '次'], ['downtimeCount', '故障停机次数', '次'],
    ['unplannedShutdowns', '非计划停工次数', '次'],
    ['newDefects', '新增缺陷', '条'], ['openDefects', '未闭环缺陷', '条'],
  ];
  function buildCompare(j, label) {
    const rows = CMP_FIELDS.map(([k, cn, unit]) => {
      const cur = curMetrics[k], pre = j.metrics ? j.metrics[k] : null;
      const delta = (cur === null || cur === undefined || pre === null || pre === undefined) ? null : C.round(cur - pre, 2);
      return { key: k, name: cn, unit, current: cur === undefined ? null : cur, base: pre === undefined ? null : pre, delta };
    });
    const genDate = C.normDate(C.str(j.meta.generatedAt).slice(0, 10));
    const snapshotNote = j.meta.to && genDate && genDate > j.meta.to
      ? `基准期报告生成于 ${genDate}，晚于其期末 ${j.meta.to}；基准期的设备完好率、主要设备完好率、备机完好率是生成时的台账快照，不是基准期期末状态`
      : null;
    return { label, baseFrom: j.meta.from || null, baseTo: j.meta.to || null, basePeriod: j.meta.period || null, snapshotNote, rows };
  }
  let compare = null;
  if (a.prev || a.yoy) {
    compare = {};
    if (a.prev) {
      const j = loadCompare(a.prev, '上期');
      if (inScope(path.basename(a.prev), j)) {   // 车间不一致的基准期不做环比
        if (j.meta.period && j.meta.period !== period) warnings.push(`环比基准（${path.basename(a.prev)}）周期为 ${j.meta.period}，与本期 ${period} 不一致，对比结果仅供参考`);
        compare.prev = buildCompare(j, '环比');
      }
    }
    if (a.yoy) {
      const j = loadCompare(a.yoy, '同期');
      if (inScope(path.basename(a.yoy), j)) {   // 车间不一致的基准期不做同比
        if (j.meta.period && j.meta.period !== period) warnings.push(`同比基准（${path.basename(a.yoy)}）周期为 ${j.meta.period}，与本期 ${period} 不一致，对比结果仅供参考`);
        compare.yoy = buildCompare(j, '同比');
      }
    }
    if (!compare.prev && !compare.yoy) compare = null;
  }

  const counts = {
    dailyFiles: dailies.length || null,
    spanDays, coveredDays: dailies.length ? coveredDays : null, missingDays: dailies.length ? missingDates.length : null,
    equipmentTotal: intactTotal, equipmentGood: intactGood, majorTotal, majorGood, standbyTotal, standbyGood,
    faults: faultRows ? faults.length : null, downtimeCount,
    maintPlanned: planTotal, maintDone: planDone, maintOnTime: planOnTime,
    ordersDue: orderDue, ordersOnTime: orderOnTime, ordersPendingAccept: orderPending,
    newDefects: defects ? defects.newTotal : null, openDefects: defects ? defects.openAtEnd : null,
    spareItems: spare ? spare.items : null, specialEquipment: special ? special.total : null,
    unplannedShutdowns, leakOpen: leakPoints ? leakPoints.open : null,
    highlights: highlights.length, recompute: recompute.length,
  };

  // ================================================================ 产出
  C.ensureDir(outDir);
  const modes = {
    '设备完好率': intactMode.mode, '主要设备完好率': majorMode.mode, '备机完好率': standbyMode.mode,
    '静密封点泄漏率': sealStatic.mode.mode, '动密封点泄漏率': sealDynamic.mode.mode,
    '检修计划完成率': planMode.mode, '工单及时率': orderMode.mode, '平均修复时间': mttrMode.mode,
    '故障停机时长': downMode.mode, '故障停机次数': downCntMode.mode, '非计划停工次数': shutMode.mode,
  };
  const metrics = {
    ...curMetrics,
    intactNote: intactRate === null ? intactNote : '', intactSnapshotNote, intactDenominator: intactDenom, intactSealedOut,
    planByCategory: planByCat, pendingAcceptOrders: orderPending,
    seal, leakPoints, basedOn, rulesSource, usingDefaultRules: usingDefault, modes,
  };
  const notice = usingDefault ? DEFAULT_NOTICE
    : `本报告指标采用厂内口径表（${path.basename(a.metrics)}）${recompute.length ? `；其中 ${recompute.map((x) => x.metric).join('、')} 因厂内算法与脚本默认算法不一致且无结构化口径参数，未出数，需按厂内口径复算` : ''}。`;
  const out = {
    meta: {
      workshop: a.workshop, period, periodCn: P.cn, from, to, spanDays,
      rulesSource, usingDefaultRules: usingDefault, notice,
      intactDenominator: intactDenom, intactSealedOut,
      sources, generatedAt: C.localDateTime(),
      workshopScope: scopes, upstreamWorkshop: jsonScope,
    },
    counts, metrics, failures, maintenance, defects, orders: ordersSec, spare, special, standby, seal, leakPoints, shutdown,
    highlights, compare, dataGaps, warnings,
  };
  fs.writeFileSync(path.join(outDir, 'periodic.json'), JSON.stringify(out, null, 2), 'utf8');

  // ---- 指标表.xlsx
  const V = (v) => (v === null || v === undefined ? '—' : v);
  const catRate = (cat) => (planByCat && planByCat[cat] ? planByCat[cat] : { rate: null, onTime: null, total: null });
  const rulesTable = [
    ['指标', '数值', '单位', '分子', '分母', '口径来源', '计算方式', '算法'],
    ['设备完好率', V(intactRate), '%', C.fmt(intactGood, 0), C.fmt(intactTotal, 0), rulesSource, modes['设备完好率'], ruleOf('设备完好率')],
    ['主要设备完好率（A/B 类）', V(majorRate), '%', C.fmt(majorGood, 0), C.fmt(majorTotal, 0), rulesSource, modes['主要设备完好率'], ruleOf('主要设备完好率')],
    ['备机完好率', V(standbyRate), '%', C.fmt(standbyGood, 0), C.fmt(standbyTotal, 0), rulesSource, modes['备机完好率'], ruleOf('备机完好率')],
    ['静密封点泄漏率', V(seal ? seal.static.rate : null), '‰', C.fmt(seal ? seal.static.leaks : null, 0), C.fmt(seal ? seal.static.total : null, 0), rulesSource, modes['静密封点泄漏率'], ruleOf('静密封点泄漏率')],
    ['动密封点泄漏率', V(seal ? seal.dynamic.rate : null), '‰', C.fmt(seal ? seal.dynamic.leaks : null, 0), C.fmt(seal ? seal.dynamic.total : null, 0), rulesSource, modes['动密封点泄漏率'], ruleOf('动密封点泄漏率')],
    ['检修计划完成率（合计）', V(planRate), '%', C.fmt(planOnTime, 0), C.fmt(planTotal, 0), rulesSource, modes['检修计划完成率'], ruleOf('检修计划完成率')],
    ['检修计划完成率（大检修）', V(catRate('大检修').rate), '%', C.fmt(catRate('大检修').onTime, 0), C.fmt(catRate('大检修').total, 0), rulesSource, modes['检修计划完成率'], '同上，限大检修（停工检修）项目'],
    ['检修计划完成率（日常维修）', V(catRate('日常维修').rate), '%', C.fmt(catRate('日常维修').onTime, 0), C.fmt(catRate('日常维修').total, 0), rulesSource, modes['检修计划完成率'], '同上，限日常维修项目'],
    ['工单及时率', V(orderRate), '%', C.fmt(orderOnTime, 0), C.fmt(orderDue, 0), rulesSource, modes['工单及时率'], ruleOf('工单及时率')],
    ['平均修复时间 MTTR', V(mttr), '小时', '累计修复时长', C.fmt(repairCount, 0), rulesSource, modes['平均修复时间'], ruleOf('平均修复时间')],
    ['故障停机时长合计', V(downtime), '小时', '—', '—', rulesSource, modes['故障停机时长'], ruleOf('故障停机时长')],
    ['故障次数', faultRows ? faults.length : '—', '次', '—', '—', rulesSource, '默认口径', '区间内故障记录条数'],
    ['故障停机次数', V(downtimeCount), '次', '—', '—', rulesSource, modes['故障停机次数'], ruleOf('故障停机次数')],
    ['非计划停工次数', V(unplannedShutdowns), '次', '—', '—', rulesSource, modes['非计划停工次数'], ruleOf('非计划停工次数')],
    ['新增缺陷（维修通知单）', defects && defects.newTotal !== null ? defects.newTotal : '—', '条', '—', '—', rulesSource, '默认口径', defects ? `来源：${defects.source}` : '未提供缺陷数据'],
    ['未闭环缺陷', defects && defects.openAtEnd !== null ? defects.openAtEnd : '—', '条', '—', '—', rulesSource, '默认口径', defects ? `截至 ${defects.openAtEndDate || to}；待验收不计闭环` : '未提供缺陷数据'],
  ];
  const sheets = {
    '指标表': [
      [`${a.workshop} 设备${P.cn}指标表`],
      ['统计区间', `${from} ~ ${to}`, `共 ${spanDays} 天`, basedOn],
      ['口径来源', rulesSource],
      [notice],
      [],
      ...rulesTable,
    ],
    '故障统计': failures
      ? [['按专业分布'], ['专业', '次数'], ...failures.byDiscipline.map((x) => [x.name, x.count]), [],
        ['按设备类型分布'], ['设备类型', '次数'], ...failures.byType.map((x) => [x.name, x.count]), [],
        [`故障频次排行 Top ${topN}`], ['位号', '设备名称', '专业', '次数', '累计停机(小时)'],
        ...failures.top.map((x) => [x.tag, x.name || '—', x.discipline, x.count, V(x.downtime)])]
      : [['未提供故障记录数据']],
    '数据缺口': [
      ['统计区间天数', spanDays],
      ['实际覆盖天数', dailies.length ? coveredDays : '—（未提供日报 JSON）'],
      ['缺失天数', dailies.length ? missingDates.length : '—'],
      ['缺失日期', missingDates.join('、') || '无'],
      [],
      ['分母缺失的指标', '原因'],
      ...(dataGaps.noDenominator.length ? dataGaps.noDenominator.map((x) => [x.metric, x.reason]) : [['无', '—']]),
      [],
      ['未提供数据的指标', '原因'],
      ...(dataGaps.notProvided.length ? dataGaps.notProvided.map((x) => [x.metric, x.reason]) : [['无', '—']]),
      [],
      ['需按厂内口径复算的指标', '厂内算法', '原因'],
      ...(recompute.length ? recompute.map((x) => [x.metric, x.algo, x.reason]) : [['无', '—', '—']]),
      [],
      ['警告'],
      ...(warnings.length ? warnings.map((w) => [w]) : [['无']]),
    ],
  };
  writeXlsx(path.join(outDir, '指标表.xlsx'), sheets);

  // ---- periodic.md
  const NA = (label) => `_本期未提供${label}数据。_\n`;
  const sign = (v, unit) => (v === null ? '—' : `${v > 0 ? '+' : ''}${v}${unit || ''}`);
  const pm = (v) => (v === null || v === undefined ? '—' : `${v}‰`);
  const L = [];
  let n = 0;
  const H = (t) => { L.push(`## ${CN[n++]}、${t}`); L.push(''); };
  L.push(`# ${a.workshop} 设备${P.cn}（${from} ~ ${to}）`);
  L.push('');
  const wsNote = C.workshopScopeNote(scopes, a.workshop);
  const jsNote = jsonScopeNote(jsonScope, a.workshop);
  for (const al of [wsNote.alert, jsNote.alert].filter(Boolean)) { L.push(`> **${al}**`); L.push(''); }
  L.push(`统计区间：${from} ~ ${to}，共 ${spanDays} 天；${basedOn}`);
  L.push(`指标口径：${rulesSource}`);
  L.push(`数据来源：${sources.join('、')}`);
  if (wsNote.note) L.push(wsNote.note);
  if (jsNote.note) L.push(jsNote.note);
  L.push(`生成时间：${C.localDateTime()}（北京时间）`);
  L.push('');
  L.push(`> ${notice}`);
  L.push('');

  H('总体概况');
  L.push(C.mdTable(['项目', '内容'], [
    ['统计区间', `${from} ~ ${to}（${spanDays} 天）`],
    ['数据覆盖', dailies.length ? `${coveredDays} 天日报${missingDates.length ? `，缺 ${missingDates.length} 天` : '，无缺失'}` : '原始台账（未提供日报 JSON）'],
    ['故障次数 / 故障停机次数', `${C.fmt(counts.faults, 0)} / ${C.fmt(counts.downtimeCount, 0)}`],
    ['非计划停工次数', C.fmt(counts.unplannedShutdowns, 0)],
    ['新增缺陷（维修通知单）', C.fmt(counts.newDefects, 0)],
    ['未闭环缺陷', C.fmt(counts.openDefects, 0)],
    ['检修计划项数', C.fmt(counts.maintPlanned, 0)],
    ['特护设备台数', C.fmt(counts.specialEquipment, 0)],
    ['重点事项', C.fmt(counts.highlights, 0)],
  ]));

  H('关键指标');
  L.push(C.mdTable(['指标', '本期值', '分子/分母', '计算方式', '算法'], [
    ['设备完好率', C.pct(intactRate), `${C.fmt(intactGood, 0)} / ${C.fmt(intactTotal, 0)}（${intactDenom}${intactSealedOut ? '，剔除封存' : '，含封存'}）`, modes['设备完好率'], ruleOf('设备完好率')],
    ['主要设备完好率（A/B 类）', C.pct(majorRate), `${C.fmt(majorGood, 0)} / ${C.fmt(majorTotal, 0)}`, modes['主要设备完好率'], ruleOf('主要设备完好率')],
    ['备机完好率', C.pct(standbyRate), `${C.fmt(standbyGood, 0)} / ${C.fmt(standbyTotal, 0)}`, modes['备机完好率'], ruleOf('备机完好率')],
    ['静密封点泄漏率', pm(seal ? seal.static.rate : null), `${C.fmt(seal ? seal.static.leaks : null, 0)} / ${C.fmt(seal ? seal.static.total : null, 0)}`, modes['静密封点泄漏率'], ruleOf('静密封点泄漏率')],
    ['动密封点泄漏率', pm(seal ? seal.dynamic.rate : null), `${C.fmt(seal ? seal.dynamic.leaks : null, 0)} / ${C.fmt(seal ? seal.dynamic.total : null, 0)}`, modes['动密封点泄漏率'], ruleOf('动密封点泄漏率')],
    ['检修计划完成率（合计）', C.pct(planRate), `${C.fmt(planOnTime, 0)} / ${C.fmt(planTotal, 0)}`, modes['检修计划完成率'], ruleOf('检修计划完成率')],
    ['　其中 大检修', C.pct(catRate('大检修').rate), `${C.fmt(catRate('大检修').onTime, 0)} / ${C.fmt(catRate('大检修').total, 0)}`, modes['检修计划完成率'], planHasCat ? '限大检修（停工检修）项目' : '未提供检修类别列'],
    ['　其中 日常维修', C.pct(catRate('日常维修').rate), `${C.fmt(catRate('日常维修').onTime, 0)} / ${C.fmt(catRate('日常维修').total, 0)}`, modes['检修计划完成率'], planHasCat ? '限日常维修项目' : '未提供检修类别列'],
    ['工单及时率', C.pct(orderRate), `${C.fmt(orderOnTime, 0)} / ${C.fmt(orderDue, 0)}`, modes['工单及时率'], ruleOf('工单及时率')],
    ['平均修复时间 MTTR', mttr === null ? '—' : `${mttr} 小时`, `修复 ${C.fmt(repairCount, 0)} 次`, modes['平均修复时间'], ruleOf('平均修复时间')],
    ['故障停机时长合计', downtime === null ? '—' : `${downtime} 小时`, '—', modes['故障停机时长'], ruleOf('故障停机时长')],
    ['故障停机次数', C.fmt(downtimeCount, 0), '—', modes['故障停机次数'], ruleOf('故障停机次数')],
    ['非计划停工次数', C.fmt(unplannedShutdowns, 0), '—', modes['非计划停工次数'], ruleOf('非计划停工次数')],
  ]));
  L.push(`指标口径说明：${basedOn}。泄漏率考核线以厂内指标为准，本技能不比对；未提供的指标写「未提供」，不估算。`);
  if (intactSnapshotNote) L.push(`完好率时点：${intactSnapshotNote}；设备台账只记当前状态，不能回推历史。`);
  L.push('');
  if (recompute.length) {
    L.push('【注意】以下指标厂内口径表命中、但算法与脚本默认算法不一致且未提供结构化口径参数，**未出数（显示 —），需按厂内口径复算**，不得只换文字沿用默认算法结果：');
    L.push('');
    L.push(C.mdTable(['指标', '厂内算法', '处理'], recompute.map((x) => [x.metric, x.algo, '需按厂内口径复算（可用口径表「分母 / 剔除封存」列或 --intact-denominator / --sealed 给出结构化口径后重跑）'])));
  }
  if (dataGaps.noDenominator.length) {
    L.push('**以下指标因分母缺失未计算（显示 —），未以在册台数或估计值代替：**');
    L.push('');
    L.push(C.mdTable(['指标', '原因'], dataGaps.noDenominator.map((x) => [x.metric, x.reason])));
  }
  if (dataGaps.notProvided.length) {
    L.push('**以下指标本期未提供数据（显示 —），不估算：**');
    L.push('');
    L.push(C.mdTable(['指标', '说明'], dataGaps.notProvided.map((x) => [x.metric, x.reason])));
  }
  if (leakPoints) {
    L.push(`泄漏点（来自 leaks.json）：累计 ${C.fmt(leakPoints.leaks, 0)}，未修复 ${C.fmt(leakPoints.open, 0)}，超期 ${C.fmt(leakPoints.overdue, 0)}，已修复 ${C.fmt(leakPoints.repaired, 0)}，修复率 ${C.pct(leakPoints.repairRate)}。`);
    L.push('');
  }

  H('特护设备运行状况');
  if (!special) L.push(NA('特护设备'));
  else {
    L.push(`共 ${special.total} 台（来源：${special.source}）。逐台列状态与参数，趋势判断由设备员复核。`);
    L.push('');
    L.push(C.mdTable(['位号', '设备名称', '期末状态', '运行参数', '区间内异常天数', '备注'],
      special.list.map((x) => [x.tag, x.name || '—', x.state || '—', x.params || '—', x.abnormalDays === null ? '—' : `${x.abnormalDays} / ${x.days}`, x.note || '—'])));
  }

  H('故障统计');
  if (!failures) L.push(NA('故障记录'));
  else if (!failures.total) L.push('_统计区间内无故障记录。_\n');
  else {
    L.push(`区间内故障共 ${failures.total} 次，其中故障停机 ${C.fmt(failures.downtimeCount, 0)} 次。`);
    L.push('');
    L.push('**按专业分布**');
    L.push('');
    L.push(C.mdTable(['专业', '次数'], failures.byDiscipline.map((x) => [x.name, x.count])));
    L.push('**按设备类型分布**');
    L.push('');
    L.push(C.mdTable(['设备类型', '次数'], failures.byType.map((x) => [x.name, x.count])));
    L.push(`**故障频次排行 Top ${topN}**`);
    L.push('');
    L.push(C.mdTable(['位号', '设备名称', '专业', '故障次数', '累计停机(小时)'],
      failures.top.map((x) => [x.tag, x.name || '—', x.discipline, x.count, V(x.downtime)])));
  }
  if (shutdown) {
    L.push(`**停工记录** 区间内 ${shutdown.total} 条，非计划 ${C.fmt(shutdown.unplanned, 0)} 次${shutdown.undetermined ? `，${shutdown.undetermined} 条类别未判定` : ''}。是否构成非计划停工事件按《炼化企业非计划停工管理规定》另行报送，本技能不判定。`);
    L.push('');
    if (shutdown.list.length) L.push(C.mdTable(['时间', '装置', '类别', '原因'], shutdown.list.map((x) => [x.at, x.unit || '—', x.category || '（未填）', x.reason || '—'])));
  }

  H('检修计划执行');
  if (!maintenance) L.push(NA('检修计划'));
  else {
    L.push(`计划项数 ${C.fmt(maintenance.total, 0)}，已完工 ${C.fmt(maintenance.done, 0)}，其中按期完成 ${C.fmt(maintenance.onTime, 0)}，完成率 ${C.pct(maintenance.rate)}。`);
    L.push('');
    if (maintenance.byCategory) {
      L.push(C.mdTable(['检修分级', '计划项数', '已完工', '按期完成', '完成率'],
        Object.entries(maintenance.byCategory).map(([k, v]) => [k, C.fmt(v.total, 0), C.fmt(v.done, 0), C.fmt(v.onTime, 0), C.pct(v.rate)])));
    }
    L.push(C.mdTable(['项目名称', '位号', '检修分级', '状态', '计划完成', '实际完成', '是否按期', '责任人'],
      maintenance.list.map((m) => [m.project, m.tag || '—', m.category, m.status || '—', m.planEnd || '—', m.actEnd || '—',
        m.onTime === null ? (m.actEnd || planDoneBy(null, m.status) ? '未判定' : '未完工') : m.onTime ? '按期' : '延期', m.owner || '—'])));
    if (maintenance.undetermined.length) {
      L.push('**未判定项（缺字段，未按按期或延期默认处理）**');
      L.push('');
      L.push(C.mdTable(['项目名称', '缺失字段'], maintenance.undetermined.map((x) => [x.project, x.reason])));
    }
  }

  H('工单与缺陷');
  if (!ordersSec) L.push(NA('工单'));
  else {
    L.push(C.mdTable(['指标', '数值'], [
      ['应闭环工单', C.fmt(ordersSec.due, 0)],
      ['按期闭环', C.fmt(ordersSec.onTime, 0)],
      ['工单及时率', C.pct(ordersSec.rate)],
      ['应闭环中待验收（完工未验收，不计闭环）', C.fmt(ordersSec.pendingAccept, 0)],
      ['期末未闭环', C.fmt(ordersSec.openAtEnd, 0)],
      ['期末待验收', C.fmt(ordersSec.pendingAcceptAtEnd === undefined ? null : ordersSec.pendingAcceptAtEnd, 0)],
      ['期末超期', C.fmt(ordersSec.overdueAtEnd === undefined ? null : ordersSec.overdueAtEnd, 0)],
    ]));
    if (ordersSec.overdueList.length) {
      L.push('**超期或未按期闭环工单**');
      L.push('');
      L.push(C.mdTable(['工单号', '位号', '内容', '要求完成', '实际闭环', '状态', '超期天数', '责任方'],
        ordersSec.overdueList.map((x) => [x.no || '—', x.tag || '—', x.desc || '—', x.due, x.closedAt || '未闭环', x.status || '—', C.fmt(x.overdueDays, 0), x.workCenter || x.owner || '未记录'])));
    }
  }
  if (!defects) L.push(NA('缺陷'));
  else {
    L.push(`**缺陷（维修通知单）**（来源：${defects.source}）新增 ${C.fmt(defects.newTotal, 0)} 条，截至 ${defects.openAtEndDate || to} 未闭环 ${C.fmt(defects.openAtEnd, 0)} 条（其中待验收 ${C.fmt(defects.pendingAcceptAtEnd, 0)} 条${defects.asOfNote ? `，待验收按 ${today} 当前状态计` : ''}）${defects.closedInRange !== null ? `，区间内闭环 ${defects.closedInRange} 条` : ''}${defects.foundAfterTo ? `；另有 ${defects.foundAfterTo} 条在 ${to} 之后发现，不计入本期` : ''}。`);
    L.push('');
    if (defects.byLevel && Object.keys(defects.byLevel).length) L.push(C.mdTable(['等级', '新增条数'], Object.entries(defects.byLevel).map(([k, v]) => [k, v])));
  }

  H('备件消耗');
  if (!spare) L.push(NA('备件消耗'));
  else {
    L.push(`消耗记录 ${spare.items} 行，金额合计 ${spare.totalAmount === null ? '—' : `${spare.totalAmount} 元`}${spare.amountRows < spare.items ? `（仅 ${spare.amountRows} 行填写了金额）` : ''}。`);
    L.push('');
    L.push(C.mdTable(['备件名称', '数量', '单位', '金额(元)', '领用次数'], spare.top.map((x) => [x.name, C.fmt(x.qty, 2), x.unit || '—', C.fmt(x.amount, 2), x.times])));
  }

  H('重点事项');
  if (!highlights.length) L.push('_本期数据中未提取到需列为重点的事项（故障频发设备、超期工单、逾期检修项目、特护设备异常、非计划停工）。_\n');
  else L.push(C.mdTable(['类别', '事项'], highlights.map((h) => [h.type, h.text])));

  H('环比与同比');
  if (!compare) L.push('_未提供上期或同期 periodic.json，本节无对比数据。_\n');
  else {
    for (const key of ['prev', 'yoy']) {
      const c = compare[key];
      if (!c) continue;
      L.push(`**${c.label}**（基准区间 ${c.baseFrom || '—'} ~ ${c.baseTo || '—'}）`);
      L.push('');
      L.push(C.mdTable(['指标', '本期', '基准期', '变化'],
        c.rows.map((r) => [`${r.name}${r.unit === '%' || r.unit === '‰' ? `(${r.unit})` : `(${r.unit})`}`, r.current === null ? '—' : r.current, r.base === null ? '—' : r.base, sign(r.delta)])));
      if (c.snapshotNote) { L.push(`注：${c.snapshotNote}。`); L.push(''); }
    }
    L.push('任一侧数值缺失时变化列显示「—」，不按 0 参与计算。');
    L.push('');
  }

  H('数据缺口');
  L.push(C.mdTable(['项目', '内容'], [
    ['统计区间天数', String(spanDays)],
    ['实际覆盖天数', dailies.length ? String(coveredDays) : '—（未提供日报 JSON）'],
    ['缺失天数', dailies.length ? String(missingDates.length) : '—'],
    ['缺失日期', missingDates.join('、') || '无'],
    ['需按厂内口径复算的指标', recompute.length ? recompute.map((x) => x.metric).join('、') : '无'],
  ]));
  if (missingDates.length) {
    L.push('**缺失日期的数据未按已有天数平均后外推补齐**，所有指标仅基于实际覆盖的天数计算。');
    L.push('');
  }

  H('设备管理分析');
  L.push('<!-- ANALYSIS_START -->');
  L.push('（由模型依据 references/metrics-rules.md 口径撰写 400~600 字，结构：总体评价 → 关键指标与环比同比 → 特护设备与故障分布 → 检修计划执行（大检修/日常维修分述） → 工单与缺陷 → 备件消耗 → 存在问题 → 下期重点。所有数字引用 periodic.json；指标变化的原因只在数据支持时陈述，否则写「原因待分析」；分母缺失或需复算的指标写「未计算」，不得估算。）');
  L.push('<!-- ANALYSIS_END -->');
  L.push('');

  H('下期重点');
  L.push('_下期重点由车间填写，本技能不代为拟定。_\n');
  L.push(STATEMENT);
  L.push('');

  if (warnings.length) {
    L.push('## 附：数据提示');
    L.push('');
    for (const w of warnings) L.push(`- ${w}`);
    L.push('');
  }
  fs.writeFileSync(path.join(outDir, 'periodic.md'), L.join('\n'), 'utf8');

  C.emitOk(outDir, {
    ok: true, out: outDir, workshop: a.workshop, period, periodCn: P.cn, from, to, spanDays,
    rulesSource, usingDefaultRules: usingDefault, recompute: recompute.map((x) => x.metric), sources, counts, metrics: { ...curMetrics, basedOn }, sections: n, warnings,
  });
}

try { main(); } catch (e) { C.fail(e, warnings); }
