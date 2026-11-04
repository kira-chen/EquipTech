#!/usr/bin/env node
'use strict';
/**
 * 安全阀校验台账与到期管理脚本（仅 Node.js 内置模块）—— 中石化炼化厂车间设备员口径
 * 用法：node "<技能目录>/scripts/calibration.js" --input <xlsx> --workshop "常减压车间" --date 2026-09-21 [--out <dir>]
 *       [--lead-days 30] [--category 安全阀|爆破片|计量器具|报警器|联锁回路|计量装置|全部] [--issues <不合格整改清单xlsx>] [--certs <校验证书目录>]
 * 产出：<out>/calibration.json、<out>/calibration.md、<out>/送检清单.xlsx、<out>/summary.json；末行打印 JSON 摘要
 *
 * 口径（见顶层《中石化口径对照.md》）：
 *  - 车间设备员归口的是安全阀（安全附件）校验台账，默认只统计 --category 安全阀；
 *  - 压力表/温度计检定、报警器标定、SIS/联锁功能测试由计量（仪表）专业归口，本技能对这些类别只做台账到期提醒（--category 全部 或指定类别），不判定、不安排检定；
 *  - 到期日按自然月推（1 年 = 12 个月，用 C.addMonths），不按 365 天；
 *  - 「故障」是设备状态不是校验结论，不归入不合格；
 *  - 周期或上次校验日期缺失 → undetermined，绝不按同类默认周期；不合格无整改记录 → unresolvedFail，不参与到期计算。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readXlsx, readCsvDir, writeXlsx } = require('./lib/xlsx-lite');
const C = require('./lib/common');

const warnings = [];
const VALUE_OPTS = ['input', 'workshop', 'date', 'out', 'lead-days', 'category', 'issues', 'certs'];
const FLAG_OPTS = ['help'];

/** 必须原样写入 md 的说明行（SKILL.md 要求保留） */
const STATEMENT = '校验结论以有资质检定机构出具的证书为准；超期未校的安全附件与安全仪表不得作为有效安全保护措施。';
/** 归口说明（计量/仪表类对象只做台账提醒） */
const OWNERSHIP_NOTE = '压力表、温度计等计量器具的检定，可燃/有毒气体报警器的标定，联锁与安全仪表回路的功能测试，由计量（仪表）专业归口；本表对这些对象只做台账到期提醒，不判定、不安排检定。';

// 局部别名优先，再并入共享 SYSTEM_ALIASES（SAP PM / EM / 特种设备台账列名）。「设备编号」是 SAP 流水号，不作位号别名。
const ALIASES = C.mergeAliases({
  '对象类别': ['对象类别', '类别', '设备类别', '器具类别', '对象类型', '类型', '设备品种'],
  '位号': ['位号', '设备位号', '仪表位号', '器具编号', '安全阀位号', 'TAG', 'tag'],
  '名称': ['名称', '设备名称', '器具名称', '仪表名称', '设备描述'],
  '型号': ['型号', '规格型号', '规格', '型号编号'],
  '量程': ['量程', '测量范围', '范围', '整定压力'],
  '精度等级': ['精度等级', '精度', '准确度等级', '准确度'],
  '校验周期': ['校验周期', '检定周期', '周期', '标定周期', '检验周期'],
  '上次校验日期': ['上次校验日期', '上次校验', '末次校验日期', '上次检定日期', '检定日期', '校验日期', '上次标定日期', '上次检验日期', '检验日期'],
  '校验结论': ['校验结论', '结论', '检定结论', '校验结果', '结果', '判定', '检验结论'],
  '证书编号': ['证书编号', '证书号', '检定证书编号', '报告编号', '证书', '校验报告编号'],
  '下次校验日期': ['下次校验日期', '下次校验', '下次检定日期', '到期日期', '有效期至', '下次检验日期'],
  '安装位置': ['安装位置', '位置', '装置区', '区域', '所在位置', '所属设备'],
  '整改状态': ['整改状态', '整改情况', '处理状态', '状态'],
  '整改完成日期': ['整改完成日期', '整改日期', '完成日期', '处理日期'],
});

/** 对象类别归一：无法识别时返回 null，单列不猜测 */
const CATEGORY_RULES = [
  { key: '安全阀', kws: ['安全阀', '泄压阀', 'PSV', 'psv', 'SV'] },
  { key: '爆破片', kws: ['爆破片', '防爆片', '爆破盘', '泄爆片'] },
  { key: '计量器具', kws: ['压力表', '温度计', '压力变送器', '温度变送器', '计量器具', '压力仪表', '热电偶', '双金属', '真空表'] },
  { key: '报警器', kws: ['报警器', '可燃气体', '有毒气体', '气体检测', '探测器', '检测报警'] },
  { key: '联锁回路', kws: ['联锁', '安全仪表', 'SIS', 'sis', 'ESD', 'esd', '安全回路', '连锁'] },
  { key: '计量装置', kws: ['流量计', '称重', '地磅', '衡器', '质量流量', '计量装置', '流量计量'] },
];
const CATEGORY_KEYS = CATEGORY_RULES.map((r) => r.key);
function classifyCategory(rawCat, rawName) {
  const s = C.str(rawCat) + ' ' + C.str(rawName);
  if (C.str(rawCat) === '' && C.str(rawName) === '') return null;
  for (const r of CATEGORY_RULES) if (r.kws.some((k) => s.includes(k))) return r.key;
  return null;
}
/** 车间设备员归口类别（默认统计范围） */
const EQUIPMENT_ENGINEER_SCOPE = ['安全阀', '爆破片'];
/** 由计量（仪表）专业归口、本技能只做台账提醒的类别 */
const INSTRUMENT_SCOPE = ['计量器具', '报警器', '联锁回路', '计量装置'];

/** 安全联锁相关类别：超期时影响安全保护有效性 */
const SAFETY_CRITICAL = ['安全阀', '爆破片', '报警器', '联锁回路'];

/** 校验结论归一：pass / fail / null（无法归类或为空，不猜测）。「故障」「待修」是设备状态，不是校验结论 */
const PASS_KW = ['合格', '通过', '符合', '正常', 'OK', 'ok', '校验合格', '检定合格', '√'];
const FAIL_KW = ['不合格', '未通过', '不符合', '超差', '失效', 'NG', 'ng', '报废'];
const STATE_KW = ['故障', '待修', '检修中', '停用'];
function classifyResult(v) {
  const s = C.str(v);
  if (s === '') return { code: null, reason: '校验结论为空' };
  if (FAIL_KW.some((k) => s.includes(k))) return { code: 'fail', reason: '' };
  if (PASS_KW.some((k) => s.includes(k))) return { code: 'pass', reason: '' };
  if (STATE_KW.some((k) => s.includes(k))) return { code: null, reason: `校验结论「${s}」是设备状态不是校验结论，未归入不合格，请补填检定机构结论` };
  return { code: null, reason: `校验结论「${s}」无法归类为合格/不合格` };
}

/** 整改状态是否为「已闭环」：含否定词（未/待/不/正在）一律视为未整改，不放宽 */
function isResolved(v) {
  const s = C.str(v);
  if (s === '') return false;
  if (/(未|待|不|正在|进行中)/.test(s)) return false;
  return /(已整改|已完成|已处理|已更换|已复校|已复检|已消项|完成|闭环|合格)/.test(s);
}

/** 校验周期 → 下次校验日期：月/季/年按自然月推（C.addMonths），天/周按天推 */
function nextByPeriod(lastDate, detail) {
  if (!lastDate || !detail) return null;
  const { days, unit } = detail;
  let months = null;
  if (unit === '月') months = Math.round(days / 30);
  else if (unit === '季') months = Math.round(days / 90) * 3;
  else if (unit === '年') months = Math.round(days / 365 * 12);
  else if (unit === '半年') months = 6;
  if (months !== null && months > 0) return C.addMonths(lastDate, months);
  return C.addDays(lastDate, Math.round(days));
}

function loadBook(p) {
  const st = fs.statSync(p);
  return st.isDirectory() ? readCsvDir(p) : readXlsx(p);
}

const CN_STATE = { overdue: '超期', dueSoon: '临期', normal: '正常', undetermined: '待确认', unresolvedFail: '不合格未整改' };

function main() {
  const a = C.parseArgs(process.argv.slice(2), VALUE_OPTS, FLAG_OPTS);
  if (!a.input) throw new Error('缺少 --input');
  if (!a.workshop) throw new Error('缺少 --workshop');
  if (!a.date) throw new Error('缺少 --date');
  const date = C.normDate(a.date);
  if (!date) throw new Error(`--date 「${a.date}」不是有效日期，应为 YYYY-MM-DD`);
  let leadDays = 30;
  if (a['lead-days'] !== undefined) {
    const n = Number(a['lead-days']);
    if (!Number.isFinite(n) || n < 0) throw new Error(`--lead-days 「${a['lead-days']}」不是有效的非负天数`);
    leadDays = Math.round(n);
  }
  // 默认只统计安全阀（车间设备员归口）；全部 = 含计量/仪表类（仅台账提醒）
  let categoryArg = a.category === undefined ? '安全阀' : C.str(a.category);
  const categoryDefaulted = a.category === undefined;
  if (categoryArg === '全部' || /^all$/i.test(categoryArg)) categoryArg = '全部';
  else if (!CATEGORY_KEYS.includes(categoryArg)) {
    throw new Error(`--category 「${categoryArg}」无法识别，应为 ${CATEGORY_KEYS.join(' / ')} / 全部（默认 安全阀）`);
  }
  if (!fs.existsSync(a.input)) throw new Error(`输入不存在: ${a.input}`);
  const outDir = a.out || path.join(os.tmpdir(), 'vicl-out');

  // ---- 读取校验台账
  let book;
  try { book = loadBook(a.input); } catch (e) { throw new Error(`读取失败 ${a.input}: ${e.message}`); }
  const rows = C.pickSheet(book, '校验台账', '校验', '检定台账', '仪表台账', '计量台账', '安全阀台账', '安全附件');
  if (!rows) throw new Error('未在输入中找到「校验台账」工作表（可识别：校验台账/检定台账/仪表台账/计量台账/安全阀台账/安全附件台账）');
  const sheetName = `${path.basename(a.input)}/校验台账`;
  const recs = C.toRecords(rows, ['位号', '校验周期', '上次校验日期'], sheetName,
    ['对象类别', '名称', '型号', '量程', '精度等级', '校验结论', '证书编号', '下次校验日期', '安装位置', '设备编号', '检验机构'], warnings, ALIASES);

  // ---- 不合格整改清单（可选）
  const resolvedTags = new Map();   // 位号 → [闭环整改记录]（同一位号可有多行，判定时在全部记录里配对本次不合格）
  let issuesProvided = false;
  if (a.issues) {
    if (!fs.existsSync(a.issues)) throw new Error(`不合格整改清单不存在: ${a.issues}`);
    const ib = loadBook(a.issues);
    const irows = C.pickSheet(ib, '整改清单', '不合格整改', '整改', '不合格项');
    if (!irows) warnings.push('整改清单文件中未找到「整改清单」工作表，无法核对不合格项整改情况');
    else {
      issuesProvided = true;
      const ir = C.toRecords(irows, ['位号'], `${path.basename(a.issues)}/整改清单`, ['整改状态', '整改完成日期', '证书编号'], warnings, ALIASES);
      for (const r of ir) {
        const tag = C.str(r['位号']);
        if (!tag) continue;
        if (isResolved(r['整改状态'])) {
          if (!resolvedTags.has(tag)) resolvedTags.set(tag, []);
          resolvedTags.get(tag).push({ status: C.str(r['整改状态']), doneAt: C.normDate(r['整改完成日期']), cert: C.str(r['证书编号']) });
        }
      }
    }
  } else {
    warnings.push('未提供不合格整改清单（--issues），不合格项一律按未整改处理并单列');
  }

  // ---- 逐条判定
  const items = [];
  const staleOf = new Map();        // 记录 → 最晚的旧整改完成日期（只用于范围内 warning，不进 JSON）
  const unknownCatOf = new Map();   // 记录 → 类别无法识别的 warning 前半句（过滤后按是否在范围内补全）
  const certSeen = new Map();       // 证书编号 → [位号]
  for (const r of recs) {
    const tag = C.str(r['位号']);
    if (!tag) { warnings.push(`${r._sheet} 第${r._row}行 位号为空，已跳过`); continue; }

    const rawCat = C.str(r['对象类别']);
    const name = C.str(r['名称']);
    const category = classifyCategory(rawCat, name);
    // 类别无法识别的 warning 在类别过滤后发出：在统计范围内才写「已归入待确认」，默认范围外的只说明未纳入
    const unknownCat = category === null ? `${r._sheet} 第${r._row}行 位号「${tag}」对象类别「${rawCat || '空'}」无法识别` : null;

    const periodDetail = C.parsePeriodDetail(r['校验周期']);
    const periodDays = periodDetail ? periodDetail.days : null;
    if (r['校验周期'] && periodDetail === null) warnings.push(`${r._sheet} 第${r._row}行 位号「${tag}」校验周期「${C.str(r['校验周期'])}」无法解析`);
    const lastDate = C.normDate(r['上次校验日期']);
    if (r['上次校验日期'] && !lastDate) warnings.push(`${r._sheet} 第${r._row}行 位号「${tag}」上次校验日期「${C.str(r['上次校验日期'])}」无法解析`);

    const res = classifyResult(r['校验结论']);
    if (res.code === null && res.reason && !res.reason.includes('为空')) warnings.push(`${r._sheet} 第${r._row}行 位号「${tag}」${res.reason}`);

    const cert = C.str(r['证书编号']);
    if (cert) {
      if (!certSeen.has(cert)) certSeen.set(cert, []);
      certSeen.get(cert).push(tag);
    }

    // 台账中登记的下次校验日期
    const ledgerNext = C.normDate(r['下次校验日期']);
    if (r['下次校验日期'] && !ledgerNext) warnings.push(`${r._sheet} 第${r._row}行 位号「${tag}」下次校验日期「${C.str(r['下次校验日期'])}」无法解析`);

    // 计算下次校验日期：周期与上次校验日期都在才算；月/季/年按自然月推
    const calcNext = (periodDetail && lastDate) ? nextByPeriod(lastDate, periodDetail) : null;
    let nextMismatch = null;
    if (calcNext && ledgerNext && calcNext !== ledgerNext) {
      nextMismatch = { ledger: ledgerNext, calc: calcNext, diffDays: C.diffDays(ledgerNext, calcNext) };
      // warning 在类别过滤后只对统计范围内的记录发出，与附一、counts.nextMismatch 一致
    }

    // 判定状态：待确认优先于到期计算；不合格未整改不参与到期计算
    const missing = [];
    if (periodDays === null) missing.push('校验周期');
    if (!lastDate) missing.push('上次校验日期');
    if (category === null) missing.push('对象类别');

    // 整改完成日期早于本次（不合格）校验日期的是上一次不合格的旧记录，不能证明本次不合格已整改。
    // 同一位号多行时在全部闭环记录里找能配对的（完成日期 ≥ 本次校验日期，或未填完成日期），有日期的取最晚一条；
    // 全部都是旧记录才判未整改，warning 在类别过滤后只对统计范围内的记录发出
    let fixed = null, staleFix = null;
    if (res.code === 'fail' && resolvedTags.has(tag)) {
      const list = resolvedTags.get(tag);
      const valid = list.filter((x) => !x.doneAt || !lastDate || x.doneAt >= lastDate);
      const dated = valid.filter((x) => x.doneAt).sort((x, y) => (x.doneAt < y.doneAt ? 1 : x.doneAt > y.doneAt ? -1 : 0));
      fixed = dated[0] || valid[0] || null;
      if (!fixed) staleFix = list.map((x) => x.doneAt).sort().pop();
    }
    const unresolved = res.code === 'fail' && !fixed;

    let state, daysLeft = null, overdueDays = null;
    if (unresolved) {
      state = 'unresolvedFail';                       // 不得按合格处理参与到期计算
    } else if (missing.length) {
      state = 'undetermined';                         // 绝不按同类对象默认周期处理
    } else {
      daysLeft = C.diffDays(calcNext, date);
      if (daysLeft < 0) { state = 'overdue'; overdueDays = -daysLeft; }
      else if (daysLeft <= leadDays) state = 'dueSoon';
      else state = 'normal';
    }

    items.push({
      tag, equipNo: C.str(r['设备编号']) || null, category, rawCategory: rawCat || null, name: name || null,
      model: C.str(r['型号']) || null, range: C.str(r['量程']) || null, accuracy: C.str(r['精度等级']) || null,
      location: C.str(r['安装位置']) || null, inspector: C.str(r['检验机构']) || null,
      periodRaw: C.str(r['校验周期']) || null, periodDays, periodUnit: periodDetail ? periodDetail.unit : null,
      lastDate, resultRaw: C.str(r['校验结论']) || null, result: res.code,
      cert: cert || null,
      ledgerNext, calcNext, nextDate: calcNext || ledgerNext || null, nextMismatch,
      state, daysLeft, overdueDays,
      missing, remediation: fixed,
      safetyCritical: category !== null && SAFETY_CRITICAL.includes(category),
      ownership: category === null ? null : (INSTRUMENT_SCOPE.includes(category) ? '计量（仪表）专业归口，本表仅作台账提醒' : '车间设备员归口'),
      sheet: r._sheet, row: r._row,
    });
    if (staleFix) staleOf.set(items[items.length - 1], staleFix);
    if (unknownCat) unknownCatOf.set(items[items.length - 1], unknownCat);
  }

  if (!items.length) warnings.push(`工作表「${sheetName}」未解析出任何有效台账记录`);

  // ---- 证书编号重复
  const dupCerts = [];
  for (const [cert, tags] of certSeen) {
    if (tags.length > 1) {
      dupCerts.push({ cert, tags });
      warnings.push(`证书编号「${cert}」在台账中重复出现 ${tags.length} 次（位号：${tags.join('、')}），请核实是否串号`);
    }
  }

  // ---- 类别过滤（仅影响报表范围，不影响判定口径）
  let scope = items;
  if (categoryArg !== '全部') {
    scope = items.filter((x) => x.category === categoryArg);
    const excluded = items.length - scope.length;
    if (excluded > 0) {
      const exCats = [...new Set(items.filter((x) => x.category !== categoryArg).map((x) => x.category || '未识别'))];
      warnings.push(categoryDefaulted
        ? `默认只统计安全阀（车间设备员归口），台账中另有 ${excluded} 条 ${exCats.join('/')} 记录未纳入；需要时加 --category 全部（计量/仪表类仅作台账提醒，检定由计量（仪表）专业归口）`
        : `已按 --category ${categoryArg} 过滤，${excluded} 条其他类别记录未纳入`);
    }
    if (!scope.length) warnings.push(`按 --category「${categoryArg}」过滤后无匹配记录，报表为空`);
  }
  const inScope = new Set(scope);
  for (const [x, msg] of unknownCatOf) {
    warnings.push(inScope.has(x) ? `${msg}，已归入待确认`
      : `${msg}，不在本次统计范围（${categoryDefaulted ? '默认只统计安全阀' : `--category ${categoryArg}`}），未纳入报表；需要时加 --category 全部，届时归入待确认`);
  }
  for (const x of scope) {
    if (staleOf.has(x)) warnings.push(`${x.sheet} 第${x.row}行 位号「${x.tag}」整改清单的整改完成日期 ${staleOf.get(x)} 早于本次不合格校验日期 ${x.lastDate}，属旧整改记录，不据此判为已整改`);
    if (x.nextMismatch) warnings.push(`${x.sheet} 第${x.row}行 位号「${x.tag}」台账下次校验日期 ${x.nextMismatch.ledger} 与按周期计算值 ${x.nextMismatch.calc} 不一致（相差 ${x.nextMismatch.diffDays} 天），两者并列，请核实`);
  }
  const instrumentInScope = scope.some((x) => x.category && INSTRUMENT_SCOPE.includes(x.category));

  const bySort = (x, y) => (x.overdueDays || 0) - (y.overdueDays || 0) || x.tag.localeCompare(y.tag, 'zh');
  const overdue = scope.filter((x) => x.state === 'overdue').sort((x, y) => y.overdueDays - x.overdueDays || x.tag.localeCompare(y.tag, 'zh'));
  const dueSoon = scope.filter((x) => x.state === 'dueSoon').sort((x, y) => x.daysLeft - y.daysLeft || x.tag.localeCompare(y.tag, 'zh'));
  const normal = scope.filter((x) => x.state === 'normal').sort(bySort);
  const undetermined = scope.filter((x) => x.state === 'undetermined').sort(bySort);
  const unresolvedFail = scope.filter((x) => x.state === 'unresolvedFail').sort(bySort);

  // ---- 分类汇总
  const catKeys = [...CATEGORY_KEYS, '未识别'];
  const byCategory = catKeys.map((k) => {
    const g = scope.filter((x) => (x.category || '未识别') === k);
    return {
      category: k, total: g.length,
      ownership: INSTRUMENT_SCOPE.includes(k) ? '计量（仪表）专业归口，仅台账提醒' : (EQUIPMENT_ENGINEER_SCOPE.includes(k) ? '车间设备员归口' : '—'),
      overdue: g.filter((x) => x.state === 'overdue').length,
      dueSoon: g.filter((x) => x.state === 'dueSoon').length,
      normal: g.filter((x) => x.state === 'normal').length,
      undetermined: g.filter((x) => x.state === 'undetermined').length,
      unresolvedFail: g.filter((x) => x.state === 'unresolvedFail').length,
    };
  }).filter((x) => x.total > 0);

  // ---- 送检清单：超期 + 临期 + 不合格未整改，按「类别 + 周期」归一批
  const sendCandidates = [...overdue, ...dueSoon, ...unresolvedFail];
  const batchMap = new Map();
  for (const x of sendCandidates) {
    const cat = x.category || '未识别';
    const period = x.periodRaw === null ? '周期待确认' : (x.periodDays === null ? '周期待确认' : x.periodRaw);
    const key = `${cat}｜${period}`;
    if (!batchMap.has(key)) batchMap.set(key, { batch: key, category: cat, period, items: [] });
    batchMap.get(key).items.push({
      tag: x.tag, name: x.name, model: x.model, range: x.range, accuracy: x.accuracy,
      location: x.location, lastDate: x.lastDate, nextDate: x.nextDate,
      state: x.state, overdueDays: x.overdueDays, daysLeft: x.daysLeft,
      note: x.state === 'unresolvedFail' ? '上次不合格且无整改记录，须先整改后复校'
        : x.state === 'overdue' ? `已超期 ${x.overdueDays} 天`
          : `${x.daysLeft} 天内到期`,
    });
  }
  const sendList = [...batchMap.values()].sort((x, y) => y.items.length - x.items.length || x.batch.localeCompare(y.batch, 'zh'));

  // ---- 校验证书归档核对（可选 --certs）：按文件名含证书编号或位号匹配，只核对文件是否存在，不读内容
  let certs = null;
  if (a.certs) {
    if (!fs.existsSync(a.certs)) throw new Error(`校验证书目录不存在: ${a.certs}`);
    if (!fs.statSync(a.certs).isDirectory()) throw new Error(`--certs 应为目录: ${a.certs}`);
    let files = [];
    try { files = fs.readdirSync(a.certs).filter((f) => !f.startsWith('.')); } catch (e) { throw new Error(`校验证书目录读取失败: ${e.message}`); }
    certs = { dir: a.certs, fileCount: files.length, missing: [] };
    for (const x of scope) {
      const keys = [x.cert, x.tag].filter(Boolean);
      const hit = files.some((f) => keys.some((k) => f.includes(k)));
      if (!hit) certs.missing.push({ tag: x.tag, name: x.name, category: x.category || '未识别', cert: x.cert, lastDate: x.lastDate });
    }
    if (certs.missing.length) warnings.push(`校验证书目录中有 ${certs.missing.length} 台件未找到对应证书文件（按证书编号或位号匹配文件名，未读取证书内容）`);
  } else {
    warnings.push('未提供校验证书目录（--certs），不做证书归档核对');
  }

  const counts = {
    total: scope.length,
    totalInLedger: items.length,
    overdue: overdue.length,
    dueSoon: dueSoon.length,
    normal: normal.length,
    undetermined: undetermined.length,
    unresolvedFail: unresolvedFail.length,
    safetyCriticalOverdue: overdue.filter((x) => x.safetyCritical).length,
    instrumentItems: scope.filter((x) => x.category && INSTRUMENT_SCOPE.includes(x.category)).length,
    sendBatches: sendList.length,
    sendItems: sendCandidates.length,
    dupCerts: dupCerts.length,
    nextMismatch: scope.filter((x) => x.nextMismatch).length,
    certsMissing: certs === null ? null : certs.missing.length,
  };

  // ---- 产出
  C.ensureDir(outDir);
  const result = {
    meta: {
      workshop: a.workshop, date, leadDays, category: categoryArg, categoryDefaulted,
      source: path.basename(a.input), issuesProvided, certsProvided: !!a.certs,
      generatedAt: C.localDateTime(), statement: STATEMENT, ownershipNote: OWNERSHIP_NOTE,
      periodNote: '月/季/年周期按自然月推算下次校验日期（1 年 = 12 个月）；安全阀校验周期以厂内规定与校验报告为准，脚本不代入默认周期',
    },
    counts, overdue, dueSoon, normal, undetermined, unresolvedFail,
    byCategory, sendList, dupCerts, certs, warnings,
  };
  fs.writeFileSync(path.join(outDir, 'calibration.json'), JSON.stringify(result, null, 2), 'utf8');

  // ---- 送检清单.xlsx
  const xlsxRows = [['送检批次', '对象类别', '校验周期', '位号', '名称', '型号', '量程', '精度等级', '安装位置', '上次校验日期', '下次校验日期', '当前状态', '备注']];
  for (const b of sendList) {
    for (const it of b.items) {
      xlsxRows.push([b.batch, b.category, b.period, it.tag, it.name || '', it.model || '', it.range || '', it.accuracy || '',
        it.location || '', it.lastDate || '', it.nextDate || '', CN_STATE[it.state], it.note]);
    }
  }
  if (xlsxRows.length === 1) xlsxRows.push(['（无需送检项）', '', '', '', '', '', '', '', '', '', '', '', '']);
  writeXlsx(path.join(outDir, '送检清单.xlsx'), {
    '送检清单': xlsxRows,
    '批次汇总': [['送检批次', '对象类别', '校验周期', '台件数']].concat(sendList.map((b) => [b.batch, b.category, b.period, b.items.length])),
  });

  // ---- calibration.md
  const L = [];
  L.push(`# ${a.workshop} 安全阀校验台账到期管理（基准日 ${date}）`);
  L.push('');
  L.push(`数据来源：${path.basename(a.input)}／校验台账 ｜ 统计类别：${categoryArg}${categoryDefaulted ? '（默认，车间设备员归口）' : ''} ｜ 提前提醒：${leadDays} 天`);
  L.push(`生成时间：${C.localDateTime()}（北京时间）　提交对象：车间设备主任 / 公司设备管理部门`);
  L.push('');
  L.push(`> ${STATEMENT}`);
  L.push('');
  if (instrumentInScope) {
    L.push(`【注意】${OWNERSHIP_NOTE}`);
    L.push('');
  }
  L.push('## 一、到期概览');
  L.push('');
  L.push(C.mdTable(['指标', '数量'], [
    ['台账记录（本次统计范围）', counts.total],
    ['台账记录（文件总计）', counts.totalInLedger],
    ['超期未校', counts.overdue],
    [`临期（${leadDays} 天内）`, counts.dueSoon],
    ['正常', counts.normal],
    ['不合格未整改', counts.unresolvedFail],
    ['待确认', counts.undetermined],
    ['其中：安全附件与安全仪表超期', counts.safetyCriticalOverdue],
    ['其中：计量/仪表类（仅台账提醒）', counts.instrumentItems],
    ['送检批次', counts.sendBatches],
  ]));
  L.push('## 二、超期清单');
  L.push('');
  L.push(C.mdTable(['位号', '对象类别', '名称', '型号', '量程', '上次校验', '应校验日期', '超期天数', '影响安全保护', '归口'],
    overdue.map((x) => [x.tag, x.category || '未识别', x.name || '—', x.model || '—', x.range || '—',
      x.lastDate || '—', x.nextDate || '—', x.overdueDays, x.safetyCritical ? '是' : '否', x.ownership || '—'])));
  L.push('## 三、不合格未整改清单');
  L.push('');
  if (!issuesProvided) L.push(`_未提供不合格整改清单（--issues），以下项一律按未整改处理，不参与到期计算。_\n`);
  L.push(C.mdTable(['位号', '对象类别', '名称', '上次校验', '校验结论', '证书编号', '出处'],
    unresolvedFail.map((x) => [x.tag, x.category || '未识别', x.name || '—', x.lastDate || '—', x.resultRaw || '—', x.cert || '—', `${x.sheet} 第${x.row}行`])));
  L.push('## 四、临期清单');
  L.push('');
  L.push(C.mdTable(['位号', '对象类别', '名称', '上次校验', '应校验日期', '剩余天数', '归口'],
    dueSoon.map((x) => [x.tag, x.category || '未识别', x.name || '—', x.lastDate || '—', x.nextDate || '—', x.daysLeft, x.ownership || '—'])));
  L.push('## 五、待确认项');
  L.push('');
  L.push('_周期或上次校验日期缺失的对象不按同类默认周期推算，须由设备员与仪表专责补齐后重算。_');
  L.push('');
  L.push(C.mdTable(['位号', '对象类别', '名称', '缺失字段', '周期原文', '上次校验', '出处'],
    undetermined.map((x) => [x.tag, x.category || '未识别', x.name || '—', x.missing.join('、'),
      x.periodRaw || '（空）', x.lastDate || '（空）', `${x.sheet} 第${x.row}行`])));
  L.push('## 六、分类汇总');
  L.push('');
  L.push(C.mdTable(['对象类别', '归口', '台件数', '超期', '临期', '正常', '不合格未整改', '待确认'],
    byCategory.map((x) => [x.category, x.ownership, x.total, x.overdue, x.dueSoon, x.normal, x.unresolvedFail, x.undetermined])));
  L.push('## 七、送检批次建议');
  L.push('');
  if (!sendList.length) L.push('_本期无需送检项。_\n');
  else {
    L.push('_同类别同周期归为一批，便于集中委托与停车窗口安排；明细见 `送检清单.xlsx`。计量/仪表类批次仅作提醒，委托检定由计量（仪表）专业办理。_');
    L.push('');
    L.push(C.mdTable(['送检批次', '对象类别', '校验周期', '台件数', '位号'],
      sendList.map((b) => [b.batch, b.category, b.period, b.items.length, b.items.map((i) => i.tag).join('、')])));
  }
  if (result.counts.nextMismatch) {
    L.push('## 附一、台账下次校验日期与计算值不一致');
    L.push('');
    L.push('_两者并列展示，不擅自采信其一，请核实台账登记是否有误（计算值按自然月推算）。_');
    L.push('');
    L.push(C.mdTable(['位号', '台账登记', '按周期计算', '相差天数', '出处'],
      scope.filter((x) => x.nextMismatch).map((x) => [x.tag, x.nextMismatch.ledger, x.nextMismatch.calc, x.nextMismatch.diffDays, `${x.sheet} 第${x.row}行`])));
  }
  if (dupCerts.length) {
    L.push('## 附二、证书编号重复');
    L.push('');
    L.push(C.mdTable(['证书编号', '涉及位号'], dupCerts.map((x) => [x.cert, x.tags.join('、')])));
  }
  L.push('## 附三、校验证书归档核对');
  L.push('');
  if (certs === null) L.push('_未提供校验证书目录（--certs），不做归档核对。_\n');
  else if (!certs.missing.length) L.push(`_已核对 ${certs.fileCount} 个证书文件，统计范围内台件均可匹配到证书文件（仅按文件名匹配，未读取证书内容）。_\n`);
  else {
    L.push(`_证书目录含 ${certs.fileCount} 个文件；以下台件未匹配到证书文件（按证书编号或位号匹配文件名，未读取内容）。_`);
    L.push('');
    L.push(C.mdTable(['位号', '名称', '对象类别', '台账证书编号', '上次校验'],
      certs.missing.map((x) => [x.tag, x.name || '—', x.category, x.cert || '—（台账未填）', x.lastDate || '—'])));
  }
  L.push('## 八、校验管理说明');
  L.push('');
  L.push('<!-- ANALYSIS_START -->');
  L.push('（由模型依据 references/calibration-rules.md 口径撰写 200~350 字，结构：到期概览 → 超期项与风险 → 不合格未整改项 → 送检安排建议 → 待确认项。数量与天数一律引用 calibration.json；安全阀与安全仪表回路超期须明确提示影响安全联锁有效性；计量/仪表类对象只提醒，不替计量（仪表）专业安排检定。）');
  L.push('<!-- ANALYSIS_END -->');
  L.push('');
  if (warnings.length) {
    L.push('## 附：数据提示');
    L.push('');
    for (const w of warnings) L.push(`- ${w}`);
    L.push('');
  }
  fs.writeFileSync(path.join(outDir, 'calibration.md'), L.join('\n'), 'utf8');

  C.emitOk(outDir, { ok: true, out: outDir, date, workshop: a.workshop, leadDays, category: categoryArg, counts, warnings });
}

try { main(); } catch (e) { C.fail(e, warnings); }
