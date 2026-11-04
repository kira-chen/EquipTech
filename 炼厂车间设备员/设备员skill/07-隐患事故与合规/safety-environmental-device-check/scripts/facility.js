#!/usr/bin/env node
'use strict';
/**
 * 安全环保设施状态检查脚本（仅 Node.js 内置模块）——安全环保设施台账的到期与状态汇总
 * 口径：安全阀校验用 valve-instrument-calibration-ledger，特种设备本体定检用 special-equipment-inspection-due，压力表温度计检定归计量（仪表）专业，SIS 功能测试归仪表专业；本脚本只按台账登记做到期与状态汇总
 * 周期折算：月/季/年/半年按自然月（C.addMonths），天/周/小时按 addDays
 * 用法：node "<技能目录>/scripts/facility.js" --input <xlsx> --workshop "常减压车间" --date 2026-09-21 [--out <dir>]
 *       [--lead-days 15] [--category 报警器] [--issues <失效整改记录xlsx>] [--reports <检测报告目录>]
 * 产出：<out>/facility.json、<out>/facility.md、<out>/检测计划.xlsx、<out>/summary.json；末行打印 JSON 摘要
 */
const fs = require('fs');
const path = require('path');
const { readXlsx, readCsvDir, writeXlsx } = require('./lib/xlsx-lite');
const C = require('./lib/common');

const warnings = [];
const VALUE_OPTS = ['input', 'workshop', 'date', 'out', 'lead-days', 'category', 'issues', 'reports'];
const FLAG_OPTS = ['help'];

/** 存在失效设施或超期未检时必须原样写入 md 开头的醒目提示（SKILL.md 要求，不得删除或弱化） */
const ALERT = '【注意】存在失效或超期未检的安全环保设施，可能影响安全保护功能有效性，应立即整改并评估风险';
/** 声明行（口径对照第九节通用模板 + 归口说明），写入 md 末尾与 meta.statement */
const STATEMENT = '本材料由脚本汇总、模型成文，仅供设备员复核参考，不替代审批、定性、验收与签字；厂内制度与系统数据为准。';
const SCOPE_NOTE = '本技能只做安全环保设施台账的到期与状态汇总：安全阀校验台账与校验到期用 valve-instrument-calibration-ledger，特种设备本体定期检验用 special-equipment-inspection-due，压力表、温度计检定归计量（仪表）专业，联锁/SIS 功能测试归仪表专业，检测结论以有资质单位报告为准。';

/**
 * 列名别名：局部别名经 C.mergeAliases 与共享 SYSTEM_ALIASES（SAP PM / EM / 特种设备台账 / 智能巡检导出列名）合并，局部优先。
 * 本脚本的键名（设施编号/设施名称/…）与共享表键名（位号/设备名称/…）不同，共享表只补充同名键；
 * 为承接 SAP/EM/特种设备台账导出，局部别名显式加入 功能位置、设备描述、装置、检验类型/检验周期/检验日期/检验结论 等列名。
 */
const ALIASES = C.mergeAliases({
  '设施类别': ['设施类别', '类别', '设施类型', '类型', '设备类别', '设备类型', '对象类型', '设备分类', '专业类别', '设备品种', '专业'],
  // 「功能位置」排在「设备编号」之前：SAP 设备编号是 8 位流水号，两列并存时设施编号优先取功能位置
  '设施编号': ['设施编号', '编号', '位号', '设施位号', '设备位号', '功能位置', '功能位置编号', '技术对象', '技术标识', '设备代码', 'TAG', 'Tag', 'tag', '设备编号'],
  '设施名称': ['设施名称', '名称', '设备名称', '设备描述', '技术对象描述', '功能位置描述', '描述'],
  '安装位置': ['安装位置', '位置', '装置区', '区域', '所在位置', '安装地点', '装置', '工厂区段', '单元', '装置名称'],
  '检测项目': ['检测项目', '检测内容', '维护项目', '检查项目', '检验类型', '检验类别', '检验项目', '项目'],
  '检测周期': ['检测周期', '维护周期', '周期', '检查周期', '检定周期', '校验周期', '检验周期'],
  '上次检测日期': ['上次检测日期', '上次检测', '末次检测日期', '上次检查日期', '检测日期', '检查日期', '上次维护日期', '上次检定日期', '上次检验日期', '检验日期', '校验日期'],
  '检测结果': ['检测结果', '结果', '检测结论', '结论', '检查结果', '检验结论', '检验结果', '校验结果', '判定'],
  '当前状态': ['当前状态', '状态', '设施状态', '运行状态', '完好状态', '设备状态', '用户状态'],
  '责任人': ['责任人', '负责人', '管理人', '专责', '属地专责'],
  '下次检测日期': ['下次检测日期', '下次检测', '下次检查日期', '下次检验日期', '下次校验日期', '到期日期', '有效期至', '有效期'],
  '整改状态': ['整改状态', '整改情况', '处理状态', '状态'],
  '整改完成日期': ['整改完成日期', '整改日期', '完成日期', '处理日期'],
  '整改措施': ['整改措施', '措施', '整改内容', '处理措施'],
});

/** 设施类别归一：无法识别时返回 null，单列不猜测 */
const CATEGORY_RULES = [
  { key: '报警器', kws: ['报警器', '可燃气体', '有毒气体', '气体检测', '检测报警', '探测器', '硫化氢', 'H2S', 'LEL', '一氧化碳', 'CO报警'] },
  // 安全附件：只做台账到期与状态，安全阀校验用 valve-instrument-calibration-ledger
  { key: '安全附件', kws: ['安全阀', '爆破片', '阻火器', '呼吸阀', '安全附件', '紧急泄放', '泄压阀', '液位计（安全附件）'] },
  // 联锁/SIS、紧急切断、防爆电气：只记台账状态，SIS 功能测试归仪表专业
  { key: '联锁与防爆', kws: ['联锁', 'SIS', '安全仪表', '紧急切断', 'ESD', '切断阀', '紧急停车', '防爆', '隔爆', '本安', '增安'] },
  { key: '消防', kws: ['消防', '灭火器', '消火栓', '泡沫', '喷淋', '水喷雾', '火灾报警', '灭火系统', '消防水炮', '干粉', '消防水', '消防泵', '稳压泵'] },
  { key: '接地', kws: ['接地', '防雷', '防静电', '接地电阻', '避雷', '静电跨接', '导除静电'] },
  { key: '应急器材', kws: ['洗眼器', '空气呼吸器', '正压式', '应急照明', '安全淋浴', '急救', '逃生', '应急器材', '呼吸器'] },
  { key: '环保设施', kws: ['在线监测', '比对', 'VOCs', 'voc', '废气', '废水', '污水', '脱硫', '脱硝', '除尘', '环保', 'CEMS', 'cems', '烟气'] },
];
function classifyCategory(rawCat, rawName, rawItem) {
  const s = C.str(rawCat) + ' ' + C.str(rawName) + ' ' + C.str(rawItem);
  if (s.trim() === '') return null;
  for (const r of CATEGORY_RULES) if (r.kws.some((k) => s.includes(k))) return r.key;
  return null;
}

/**
 * 当前状态归一：inService（在用/完好）/ outOfService（失效、故障、停用）/ null（无法归类或为空）
 * outOfService 无论是否在检测周期内都必须单列并醒目提示。
 */
const OUT_KW = ['失效', '故障', '停用', '损坏', '报废', '拆除', '瘫痪', '不可用', '待修', '离线', '未投用', '罢工'];
const IN_KW = ['在用', '完好', '正常', '投用', '运行', '好用', '有效', 'OK', 'ok', '√'];
function classifyStatus(v) {
  const s = C.str(v);
  if (s === '') return { code: null, reason: '当前状态为空' };
  if (OUT_KW.some((k) => s.includes(k))) return { code: 'outOfService', reason: '' };
  if (IN_KW.some((k) => s.includes(k))) return { code: 'inService', reason: '' };
  return { code: null, reason: `当前状态「${s}」无法归类为在用/失效` };
}

/** 检测结果归一：pass / fail / null（无法归类或为空，不猜测） */
const PASS_KW = ['合格', '通过', '符合', '正常', '良好', 'OK', 'ok', '√'];
const FAIL_KW = ['不合格', '未通过', '不符合', '超标', '超差', '异常', '失效', '故障', 'NG', 'ng', '不达标'];
function classifyResult(v) {
  const s = C.str(v);
  if (s === '') return { code: null, reason: '检测结果为空' };
  if (FAIL_KW.some((k) => s.includes(k))) return { code: 'fail', reason: '' };
  if (PASS_KW.some((k) => s.includes(k))) return { code: 'pass', reason: '' };
  return { code: null, reason: `检测结果「${s}」无法归类为合格/不合格` };
}

/** 整改状态是否为「已闭环」：含否定词（未/待/不/正在/进行中）一律视为未整改，不放宽 */
function isResolved(v) {
  const s = C.str(v);
  if (s === '') return false;
  if (/(未|待|不|正在|进行中)/.test(s)) return false;
  return /(已整改|已完成|已处理|已更换|已修复|已复检|已消项|完成|闭环|合格)/.test(s);
}

/**
 * 按周期折算下次检测日期：月/季/年/半年按自然月（C.addMonths，年检 1 年 = 12 个月而非 365 天），
 * 天/周/小时/班按 addDays；非整数月（如 1.5 月）退回 addDays。返回 {next, mode}，无法计算时 next 为 null。
 */
function calcNextDate(lastDate, detail) {
  if (!lastDate || !detail) return { next: null, mode: null };
  const monthsPerUnit = { '月': 1, '季': 3, '年': 12, '半年': 6 };
  if (detail.unit in monthsPerUnit) {
    const base = detail.unit === '月' ? 30 : detail.unit === '季' ? 90 : detail.unit === '年' ? 365 : 182;
    const n = detail.unit === '半年' ? 6 : Math.round((detail.days / base) * monthsPerUnit[detail.unit] * 1000) / 1000;
    if (Number.isInteger(n) && n > 0) return { next: C.addMonths(lastDate, n), mode: 'months', months: n };
  }
  return { next: C.addDays(lastDate, Math.round(detail.days)), mode: 'days', months: null };
}

function loadBook(p) {
  const st = fs.statSync(p);
  return st.isDirectory() ? readCsvDir(p) : readXlsx(p);
}

const CN_STATE = {
  overdue: '超期未检', dueSoon: '临期', normal: '完好',
  undetermined: '待确认', unresolvedFail: '不合格未整改', outOfService: '失效停用',
};

function main() {
  const a = C.parseArgs(process.argv.slice(2), VALUE_OPTS, FLAG_OPTS);
  if (!a.input) throw new Error('缺少 --input');
  if (!a.workshop) throw new Error('缺少 --workshop');
  if (!a.date) throw new Error('缺少 --date');
  const date = C.normDate(a.date);
  if (!date) throw new Error(`--date 「${a.date}」不是有效日期，应为 YYYY-MM-DD`);
  let leadDays = 15;
  if (a['lead-days'] !== undefined) {
    const n = Number(a['lead-days']);
    if (!Number.isFinite(n) || n < 0) throw new Error(`--lead-days 「${a['lead-days']}」不是有效的非负天数`);
    leadDays = Math.round(n);
  }
  if (!fs.existsSync(a.input)) throw new Error(`输入不存在: ${a.input}`);
  const outDir = a.out || path.join(require('os').tmpdir(), 'sedc-out');

  // ---- 读取安全环保设施台账
  let book;
  try { book = loadBook(a.input); } catch (e) { throw new Error(`读取失败 ${a.input}: ${e.message}`); }
  const rows = C.pickSheet(book, '安全环保设施台账', '安全环保设施', '设施台账', '安全设施', '环保设施');
  if (!rows) throw new Error('未在输入中找到「安全环保设施台账」工作表');
  const sheetName = `${path.basename(a.input)}/安全环保设施台账`;
  const recs = C.toRecords(rows, ['设施编号', '检测周期', '上次检测日期'], sheetName,
    ['设施类别', '设施名称', '安装位置', '检测项目', '检测结果', '当前状态', '责任人', '下次检测日期'], warnings, ALIASES);

  // ---- 失效整改记录（可选）
  const resolvedIds = new Map();
  let issuesProvided = false;
  if (a.issues) {
    if (!fs.existsSync(a.issues)) throw new Error(`失效整改记录不存在: ${a.issues}`);
    const ib = loadBook(a.issues);
    const irows = C.pickSheet(ib, '整改记录', '整改清单', '失效整改', '整改', '不合格项');
    if (!irows) warnings.push('整改记录文件中未找到「整改记录」工作表，无法核对不合格项整改情况');
    else {
      issuesProvided = true;
      const ir = C.toRecords(irows, ['设施编号'], `${path.basename(a.issues)}/整改记录`, ['整改状态', '整改完成日期', '整改措施'], warnings, ALIASES);
      for (const r of ir) {
        const id = C.str(r['设施编号']);
        if (!id) continue;
        if (isResolved(r['整改状态'])) {
          if (!resolvedIds.has(id)) resolvedIds.set(id, []);
          resolvedIds.get(id).push({ status: C.str(r['整改状态']), doneAt: C.normDate(r['整改完成日期']), action: C.str(r['整改措施']) || null });
        }
      }
    }
  } else {
    warnings.push('未提供失效整改记录（--issues），检测结果不合格的设施一律按未整改处理并单列');
  }

  if (a.reports && !fs.existsSync(a.reports)) throw new Error(`检测报告目录不存在: ${a.reports}`);

  // ---- 逐条判定
  const items = [];
  const idSeen = new Map();
  for (const r of recs) {
    const id = C.str(r['设施编号']);
    if (!id) { warnings.push(`${r._sheet} 第${r._row}行 设施编号为空，已跳过`); continue; }
    if (!idSeen.has(id)) idSeen.set(id, []);
    idSeen.get(id).push(r._row);

    const rawCat = C.str(r['设施类别']);
    const name = C.str(r['设施名称']);
    const item = C.str(r['检测项目']);
    const category = classifyCategory(rawCat, name, item);
    if (category === null) warnings.push(`${r._sheet} 第${r._row}行 设施编号「${id}」设施类别「${rawCat || '空'}」无法识别，已归入待确认`);

    const periodDetail = C.parsePeriodDetail(r['检测周期']);
    const periodDays = periodDetail ? periodDetail.days : null;
    if (r['检测周期'] && periodDays === null) warnings.push(`${r._sheet} 第${r._row}行 设施编号「${id}」检测周期「${C.str(r['检测周期'])}」无法解析`);
    const lastDate = C.normDate(r['上次检测日期']);
    if (r['上次检测日期'] && !lastDate) warnings.push(`${r._sheet} 第${r._row}行 设施编号「${id}」上次检测日期「${C.str(r['上次检测日期'])}」无法解析`);

    const st = classifyStatus(r['当前状态']);
    if (st.code === null && st.reason && !st.reason.includes('为空')) warnings.push(`${r._sheet} 第${r._row}行 设施编号「${id}」${st.reason}`);

    const res = classifyResult(r['检测结果']);
    if (res.code === null && res.reason && !res.reason.includes('为空')) warnings.push(`${r._sheet} 第${r._row}行 设施编号「${id}」${res.reason}`);

    // 状态与结果矛盾：状态在用但结果不合格 / 状态失效但结果合格
    let contradiction = null;
    if (st.code === 'inService' && res.code === 'fail') {
      contradiction = '当前状态为在用但检测结果为不合格';
      warnings.push(`${r._sheet} 第${r._row}行 设施编号「${id}」${contradiction}，请核实`);
    } else if (st.code === 'outOfService' && res.code === 'pass') {
      contradiction = '当前状态为失效停用但检测结果为合格';
      warnings.push(`${r._sheet} 第${r._row}行 设施编号「${id}」${contradiction}，请核实`);
    }

    const ledgerNext = C.normDate(r['下次检测日期']);
    if (r['下次检测日期'] && !ledgerNext) warnings.push(`${r._sheet} 第${r._row}行 设施编号「${id}」下次检测日期「${C.str(r['下次检测日期'])}」无法解析`);

    const calc = calcNextDate(lastDate, periodDetail);
    const calcNext = calc.next;
    let nextMismatch = null;
    if (calcNext && ledgerNext && calcNext !== ledgerNext) {
      nextMismatch = { ledger: ledgerNext, calc: calcNext, diffDays: C.diffDays(ledgerNext, calcNext) };
      warnings.push(`${r._sheet} 第${r._row}行 设施编号「${id}」台账下次检测日期 ${ledgerNext} 与按周期计算值 ${calcNext} 不一致（相差 ${nextMismatch.diffDays} 天），两者并列，请核实`);
    }

    const missing = [];
    if (periodDays === null) missing.push('检测周期');
    if (!lastDate) missing.push('上次检测日期');
    if (category === null) missing.push('设施类别');
    if (st.code === null) missing.push('当前状态');

    // 整改记录跨表配对：整改完成日期早于本次（上次）检测日期的，是上一轮不合格的整改，不能闭环本次不合格；
    // 同一设施有多条闭环记录时取整改完成日期最近的一条（无日期的排最后，仍可采信）
    let fixed = null;
    if (res.code === 'fail' && resolvedIds.has(id)) {
      const cands = resolvedIds.get(id);
      const valid = cands.filter((x) => !x.doneAt || !lastDate || C.diffDays(x.doneAt, lastDate) >= 0)
        .sort((x, y) => String(y.doneAt || '').localeCompare(String(x.doneAt || '')));
      if (valid.length) fixed = valid[0];
      else warnings.push(`${r._sheet} 第${r._row}行 设施编号「${id}」整改记录的整改完成日期（${cands.map((x) => x.doneAt).join('、')}）早于本次检测日期 ${lastDate}，属上一轮整改，不能作为本次不合格的闭环依据，仍按不合格未整改处理`);
    }
    const unresolved = res.code === 'fail' && !fixed;

    // 到期计算（独立于状态归档，失效设施同样给出超期信息供整改排期）
    let daysLeft = null, overdueDays = null, dueState = null;
    if (calcNext) {
      daysLeft = C.diffDays(calcNext, date);
      if (daysLeft < 0) { dueState = 'overdue'; overdueDays = -daysLeft; }
      else if (daysLeft <= leadDays) dueState = 'dueSoon';
      else dueState = 'normal';
    }

    // 归档优先级：失效停用 > 不合格未整改 > 待确认 > 到期三态
    let state;
    if (st.code === 'outOfService') state = 'outOfService';          // 无论是否在检测周期内都必须列出
    else if (unresolved) state = 'unresolvedFail';                    // 不得计入完好设施
    else if (missing.length) state = 'undetermined';                  // 绝不按同类设施默认周期处理
    else state = dueState;

    items.push({
      id, category, rawCategory: rawCat || null, name: name || null,
      location: C.str(r['安装位置']) || null, checkItem: item || null,
      owner: C.str(r['责任人']) || null,
      periodRaw: C.str(r['检测周期']) || null, periodDays, periodUnit: periodDetail ? periodDetail.unit : null, calcMode: calc.mode, periodMonths: calc.months === undefined ? null : calc.months,
      lastDate, ledgerNext, calcNext, nextDate: calcNext || ledgerNext || null, nextMismatch,
      statusRaw: C.str(r['当前状态']) || null, status: st.code,
      resultRaw: C.str(r['检测结果']) || null, result: res.code,
      contradiction,
      state, dueState, daysLeft, overdueDays,
      missing, remediation: fixed,
      sheet: r._sheet, row: r._row,
    });
  }

  if (!items.length) warnings.push(`工作表「${sheetName}」未解析出任何有效台账记录`);

  const dupIds = [];
  for (const [id, rws] of idSeen) {
    if (rws.length > 1) {
      dupIds.push({ id, rows: rws });
      warnings.push(`设施编号「${id}」在台账中重复出现 ${rws.length} 次（第${rws.join('、')}行），请核实是否重复登记`);
    }
  }

  // ---- 类别过滤（仅影响报表范围，不影响判定口径）
  let scope = items;
  if (a.category) {
    const want = C.str(a.category);
    scope = items.filter((x) => x.category === want || (x.rawCategory || '').includes(want));
    if (!scope.length) warnings.push(`按 --category「${want}」过滤后无匹配记录，报表为空`);
  }

  const byId = (x, y) => x.id.localeCompare(y.id, 'zh');
  const outOfService = scope.filter((x) => x.state === 'outOfService').sort(byId);
  const unresolvedFail = scope.filter((x) => x.state === 'unresolvedFail').sort(byId);
  const overdue = scope.filter((x) => x.state === 'overdue').sort((x, y) => y.overdueDays - x.overdueDays || byId(x, y));
  const dueSoon = scope.filter((x) => x.state === 'dueSoon').sort((x, y) => x.daysLeft - y.daysLeft || byId(x, y));
  const normal = scope.filter((x) => x.state === 'normal').sort(byId);
  const undetermined = scope.filter((x) => x.state === 'undetermined').sort(byId);

  // ---- 完好率：完好台数 / 设施总台数；分母为 0 或状态无法判定时 null（显示「—」，绝不写 0%）
  const intactRate = (group) => {
    if (!group.length) return null;                                   // 分母为 0 → null
    if (group.some((x) => x.status === null)) return null;            // 存在状态无法判定 → null
    const intact = group.filter((x) => x.state === 'normal' || x.state === 'dueSoon').length;   // 临期仍是完好设施
    return C.round((intact / group.length) * 100, 1);
  };

  const catKeys = [...CATEGORY_RULES.map((r) => r.key), '未识别'];
  const byCategory = catKeys.map((k) => {
    const g = scope.filter((x) => (x.category || '未识别') === k);
    return {
      category: k, total: g.length,
      intact: g.filter((x) => x.state === 'normal' || x.state === 'dueSoon').length,
      overdue: g.filter((x) => x.state === 'overdue').length,
      dueSoon: g.filter((x) => x.state === 'dueSoon').length,
      outOfService: g.filter((x) => x.state === 'outOfService').length,
      unresolvedFail: g.filter((x) => x.state === 'unresolvedFail').length,
      undetermined: g.filter((x) => x.state === 'undetermined').length,
      intactRate: intactRate(g),
      rateUndetermined: g.length === 0 ? true : g.some((x) => x.status === null),
    };
  }).filter((x) => x.total > 0);

  const statusUnknown = scope.filter((x) => x.status === null).length;
  const metrics = {
    total: scope.length,
    intact: scope.filter((x) => x.state === 'normal' || x.state === 'dueSoon').length,
    intactRate: intactRate(scope),
    rateUndetermined: scope.length === 0 || statusUnknown > 0,
    rateNote: scope.length === 0
      ? '设施总台数为 0，完好率无法计算'
      : (statusUnknown > 0 ? `有 ${statusUnknown} 台设施当前状态无法判定，完好率不予计算` : null),
    statusUnknown,
  };

  const counts = {
    total: scope.length,
    outOfService: outOfService.length,
    overdue: overdue.length,
    dueSoon: dueSoon.length,
    normal: normal.length,
    unresolvedFail: unresolvedFail.length,
    undetermined: undetermined.length,
    // 失效设施中同时已超期的台数（提示整改与复检一并安排）
    outOfServiceOverdue: outOfService.filter((x) => x.dueState === 'overdue').length,
    contradiction: scope.filter((x) => x.contradiction).length,
    nextMismatch: scope.filter((x) => x.nextMismatch).length,
    dupIds: dupIds.length,
    statusUnknown,
  };

  // ---- 醒目提示：存在失效设施或超期未检时必须写入 md 开头
  const alertNeeded = counts.outOfService > 0 || counts.overdue > 0;

  // ---- 检测计划：按类别与时间排布（超期 → 临期 → 失效停用复检 → 不合格复检）
  const planItems = [...overdue, ...dueSoon, ...outOfService, ...unresolvedFail];
  const planMap = new Map();
  for (const x of planItems) {
    const cat = x.category || '未识别';
    if (!planMap.has(cat)) planMap.set(cat, []);
    const dueKey = x.state === 'outOfService' ? (x.calcNext || '待定')
      : x.state === 'unresolvedFail' ? (x.calcNext || '待定')
        : (x.calcNext || '待定');
    planMap.get(cat).push({
      id: x.id, name: x.name, location: x.location, checkItem: x.checkItem, owner: x.owner,
      periodRaw: x.periodRaw, lastDate: x.lastDate, dueDate: dueKey,
      state: x.state, overdueDays: x.overdueDays, daysLeft: x.daysLeft,
      action: x.state === 'outOfService' ? '设施失效或停用，须立即整改或更换后复检，整改前按失去该项安全保护功能管理'
        : x.state === 'unresolvedFail' ? '上次检测不合格且无整改记录，须先整改后复检'
          : x.state === 'overdue' ? `已超期 ${x.overdueDays} 天，须立即安排检测`
            : `${x.daysLeft} 天内到期，按计划安排检测`,
    });
  }
  const plan = [...planMap.entries()].map(([category, list]) => ({
    category,
    items: list.sort((p, q) => String(p.dueDate).localeCompare(String(q.dueDate)) || p.id.localeCompare(q.id, 'zh')),
  })).sort((p, q) => q.items.length - p.items.length || p.category.localeCompare(q.category, 'zh'));

  // ---- 产出
  C.ensureDir(outDir);
  const result = {
    meta: {
      workshop: a.workshop, date, leadDays, category: a.category || null,
      source: path.basename(a.input), issuesProvided, reports: a.reports || null,
      generatedAt: C.localDateTime(), alert: ALERT, alertNeeded,
      statement: STATEMENT, scopeNote: SCOPE_NOTE,
      periodRule: '月/季/年/半年按自然月折算（C.addMonths），天/周/小时按天折算',
    },
    counts, metrics,
    outOfService, unresolvedFail, overdue, dueSoon, normal, undetermined,
    byCategory, plan, dupIds, warnings,
  };
  fs.writeFileSync(path.join(outDir, 'facility.json'), JSON.stringify(result, null, 2), 'utf8');

  // ---- 检测计划.xlsx
  const planRows = [['设施类别', '设施编号', '设施名称', '安装位置', '检测项目', '检测周期', '上次检测', '应检测日期', '当前归档', '超期天数', '剩余天数', '责任人', '处置要求']];
  for (const g of plan) {
    for (const it of g.items) {
      planRows.push([g.category, it.id, it.name || '', it.location || '', it.checkItem || '', it.periodRaw || '',
        it.lastDate || '', it.dueDate, CN_STATE[it.state],
        it.overdueDays === null || it.overdueDays === undefined ? '' : it.overdueDays,
        it.daysLeft === null || it.daysLeft === undefined ? '' : it.daysLeft,
        it.owner || '', it.action]);
    }
  }
  if (planRows.length === 1) planRows.push(['（本期无需安排检测或整改的设施）', '', '', '', '', '', '', '', '', '', '', '', '']);
  const catRows = [['设施类别', '设施台数', '完好', '失效停用', '超期未检', '临期', '不合格未整改', '待确认', '完好率']];
  for (const x of byCategory) {
    catRows.push([x.category, x.total, x.intact, x.outOfService, x.overdue, x.dueSoon, x.unresolvedFail, x.undetermined,
      x.intactRate === null ? '—' : `${x.intactRate}%`]);
  }
  writeXlsx(path.join(outDir, '检测计划.xlsx'), {
    '检测计划': planRows,
    '类别汇总': catRows,
  });

  // ---- facility.md
  const L = [];
  L.push(`# ${a.workshop} 安全环保设施状态检查（基准日 ${date}）`);
  L.push('');
  if (alertNeeded) {
    L.push(`> **${ALERT}**`);
    L.push('');
    L.push(`> 失效或停用 ${counts.outOfService} 台、超期未检 ${counts.overdue} 台，明细见第二、三节。`);
    L.push('');
  }
  L.push(`数据来源：${path.basename(a.input)}／安全环保设施台账${a.category ? ` ｜ 筛选类别：${a.category}` : ''} ｜ 提前提醒：${leadDays} 天`);
  L.push(`生成时间：${C.localDateTime()}（北京时间）`);
  L.push('');
  L.push(`> ${SCOPE_NOTE}`);
  L.push('');
  L.push('## 一、总体概览与完好率');
  L.push('');
  L.push(C.mdTable(['指标', '数量'], [
    ['设施总台数', counts.total],
    ['完好（在检测周期内且结果合格，含临期）', counts.normal + counts.dueSoon],
    ['失效或停用', counts.outOfService],
    ['超期未检', counts.overdue],
    [`临期（${leadDays} 天内）`, counts.dueSoon],
    ['不合格未整改', counts.unresolvedFail],
    ['待确认', counts.undetermined],
    ['其中：失效设施同时已超期', counts.outOfServiceOverdue],
    ['状态与结果矛盾', counts.contradiction],
  ]));
  L.push(`**总体完好率：${metrics.intactRate === null ? '—' : C.pct(metrics.intactRate)}**（完好台数 ${metrics.intact} ÷ 设施总台数 ${counts.total}；完好 = 在用 + 检测结果未否定 + 未超期（含临期））`);
  L.push('');
  L.push('_应检测日期按「上次检测日期 + 检测周期」计算：月/季/年/半年按自然月折算，天/周按天折算；台账未登记周期的不代入任何默认周期。_');
  if (metrics.rateNote) L.push(`\n_${metrics.rateNote}，完好率显示为「—」，不按 0% 处理。_`);
  L.push('');
  L.push('## 二、失效停用设施（醒目）');
  L.push('');
  L.push('_状态为失效、故障或停用的设施，无论是否在检测周期内一律列出；整改完成前按失去该项安全保护功能管理。_');
  L.push('');
  L.push(C.mdTable(['设施编号', '类别', '名称', '安装位置', '状态原文', '上次检测', '应检测日期', '到期情况', '责任人', '出处'],
    outOfService.map((x) => [x.id, x.category || '未识别', x.name || '—', x.location || '—', x.statusRaw || '—',
      x.lastDate || '—', x.calcNext || '—',
      x.dueState === 'overdue' ? `已超期 ${x.overdueDays} 天` : x.dueState === 'dueSoon' ? `${x.daysLeft} 天内到期` : x.dueState === 'normal' ? '在周期内' : '无法计算',
      x.owner || '—', `${x.sheet} 第${x.row}行`])));
  L.push('## 三、超期未检清单');
  L.push('');
  L.push(C.mdTable(['设施编号', '类别', '名称', '安装位置', '检测项目', '周期', '上次检测', '应检测日期', '超期天数', '责任人'],
    overdue.map((x) => [x.id, x.category || '未识别', x.name || '—', x.location || '—', x.checkItem || '—',
      x.periodRaw || '—', x.lastDate || '—', x.calcNext || '—', x.overdueDays, x.owner || '—'])));
  L.push('## 四、不合格未整改清单');
  L.push('');
  if (!issuesProvided) L.push('_未提供失效整改记录（--issues），以下项一律按未整改处理，不计入完好设施。_\n');
  L.push(C.mdTable(['设施编号', '类别', '名称', '安装位置', '上次检测', '检测结果', '状态原文', '出处'],
    unresolvedFail.map((x) => [x.id, x.category || '未识别', x.name || '—', x.location || '—',
      x.lastDate || '—', x.resultRaw || '—', x.statusRaw || '—', `${x.sheet} 第${x.row}行`])));
  L.push('## 五、临期清单');
  L.push('');
  L.push(C.mdTable(['设施编号', '类别', '名称', '安装位置', '检测项目', '上次检测', '应检测日期', '剩余天数', '责任人'],
    dueSoon.map((x) => [x.id, x.category || '未识别', x.name || '—', x.location || '—', x.checkItem || '—',
      x.lastDate || '—', x.calcNext || '—', x.daysLeft, x.owner || '—'])));
  L.push('## 六、待确认项');
  L.push('');
  L.push('_检测周期、上次检测日期、设施类别或当前状态缺失的设施不按同类设施默认周期推算，须补齐后重算。_');
  L.push('');
  L.push(C.mdTable(['设施编号', '类别', '名称', '缺失字段', '周期原文', '上次检测', '状态原文', '出处'],
    undetermined.map((x) => [x.id, x.category || '未识别', x.name || '—', x.missing.join('、'),
      x.periodRaw || '（空）', x.lastDate || '（空）', x.statusRaw || '（空）', `${x.sheet} 第${x.row}行`])));
  L.push('## 七、分类完好率');
  L.push('');
  L.push(C.mdTable(['设施类别', '台数', '完好', '失效停用', '超期未检', '临期', '不合格未整改', '待确认', '完好率'],
    byCategory.map((x) => [x.category, x.total, x.intact, x.outOfService, x.overdue, x.dueSoon, x.unresolvedFail, x.undetermined,
      x.intactRate === null ? '—' : C.pct(x.intactRate)])));
  L.push('_完好率 = 完好台数 ÷ 设施总台数；类别内存在状态无法判定的设施时显示「—」，不按 0% 处理。_');
  L.push('');
  L.push('## 八、检测计划安排');
  L.push('');
  if (!plan.length) L.push('_本期无需安排检测或整改的设施。_\n');
  else {
    L.push('_按设施类别与应检测日期排布，明细见 `检测计划.xlsx`。_');
    L.push('');
    L.push(C.mdTable(['设施类别', '待安排台数', '设施编号'],
      plan.map((g) => [g.category, g.items.length, g.items.map((i) => i.id).join('、')])));
  }
  if (counts.contradiction) {
    L.push('## 附一、状态与检测结果矛盾');
    L.push('');
    L.push('_两处登记不一致，不擅自采信其一，请核实台账。_');
    L.push('');
    L.push(C.mdTable(['设施编号', '状态原文', '结果原文', '矛盾说明', '出处'],
      scope.filter((x) => x.contradiction).map((x) => [x.id, x.statusRaw || '—', x.resultRaw || '—', x.contradiction, `${x.sheet} 第${x.row}行`])));
  }
  if (counts.nextMismatch) {
    L.push('## 附二、台账下次检测日期与计算值不一致');
    L.push('');
    L.push('_两者并列展示，不擅自采信其一，请核实台账登记是否有误。_');
    L.push('');
    L.push(C.mdTable(['设施编号', '台账登记', '按周期计算', '相差天数', '出处'],
      scope.filter((x) => x.nextMismatch).map((x) => [x.id, x.nextMismatch.ledger, x.nextMismatch.calc, x.nextMismatch.diffDays, `${x.sheet} 第${x.row}行`])));
  }
  if (dupIds.length) {
    L.push('## 附三、设施编号重复');
    L.push('');
    L.push(C.mdTable(['设施编号', '出现行号'], dupIds.map((x) => [x.id, x.rows.join('、')])));
  }
  L.push('## 九、安全环保设施状态说明');
  L.push('');
  L.push('<!-- ANALYSIS_START -->');
  L.push('（由模型依据 references/facility-rules.md 口径撰写 200~400 字，结构：总体情况与完好率 → 失效停用设施（醒目）→ 超期未检设施 → 不合格未整改 → 临期安排 → 待确认项。数量与完好率一律引用 facility.json；不得给出「暂不影响使用」的意见。）');
  L.push('<!-- ANALYSIS_END -->');
  L.push('');
  L.push('---');
  L.push('');
  L.push(`> ${STATEMENT}`);
  L.push('');
  if (warnings.length) {
    L.push('## 附：数据提示');
    L.push('');
    for (const w of warnings) L.push(`- ${w}`);
    L.push('');
  }
  fs.writeFileSync(path.join(outDir, 'facility.md'), L.join('\n'), 'utf8');

  C.emitOk(outDir, { ok: true, out: outDir, date, workshop: a.workshop, leadDays, alertNeeded, counts, metrics, warnings });
}

try { main(); } catch (e) { C.fail(e, warnings); }
