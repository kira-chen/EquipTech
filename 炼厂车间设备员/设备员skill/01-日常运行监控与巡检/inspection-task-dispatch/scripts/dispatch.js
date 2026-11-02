#!/usr/bin/env node
'use strict';
/**
 * 车间巡检任务清单生成脚本（仅 Node.js 内置模块）——中石化体系炼化厂车间设备员口径
 * 用法：node "<技能目录>/scripts/dispatch.js" --input <xlsx> --workshop "常减压车间" --date 2026-09-21 [--shift "白班"] [--time HH:mm] [--out <dir>]
 *       [--area <区域>] [--discipline <专业>] [--criticality <A|B|C>] [--group <人员分组>] [--due-soon <10%|N>]
 * 产出：<out>/tasks.json、<out>/tasklist.md、<out>/summary.json；末行打印 JSON 摘要
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readXlsx, readCsvDir } = require('./lib/xlsx-lite');
const C = require('./lib/common');

const warnings = [];
const VALUE_OPTS = ['input', 'workshop', 'date', 'shift', 'time', 'out', 'area', 'discipline', 'criticality', 'group', 'due-soon'];
const FLAG_OPTS = ['help'];

/**
 * 列名别名：局部别名优先，再合并共享 SYSTEM_ALIASES（SAP PM/EM/智能巡检/点检仪导出列名）。
 * 注意：局部「位号」不含「设备编号」——SAP 的设备编号是 8 位流水号，不是位号，合并后单独归「设备编号」列；
 *      局部「设备名称」不含「设备」——SAP 导出的「设备」列是设备编号，合并后归「设备编号」。
 */
const ALIASES = C.mergeAliases({
  '位号': ['位号', '设备位号', 'TAG', 'tag'],
  '设备编号': ['设备编号', '设备', '设备号', '设备编码', 'EM编码'],
  '设备名称': ['设备名称', '名称', '设备描述'],
  '区域': ['区域', '装置区', '位置', '所在区域', '巡检区域', '工厂区段'],
  '专业': ['专业', '所属专业', '专业类别', '类别'],
  '重要度': ['重要度', '重要性', '设备分级', 'ABC标识', '设备等级', '关键度', 'ABC分类', '分级'],
  '特护': ['特护', '是否特护', '特护设备', '特护标记', '特护机组'],
  '是否需巡检': ['是否需巡检', '需巡检', '是否巡检', '纳入巡检', '是否点检'],
  '设备类型': ['设备类型', '类型', '设备类别', '对象类型', '设备分类', '设备品种', '机型'],
  '检查项': ['检查项', '检查内容', '点检项', '点检项目', '巡检项', '检查项目', '项目'],
  '判定标准': ['判定标准', '标准', '合格标准', '判据', '技术要求', '限值'],
  '所需工具': ['所需工具', '工具', '检测工具', '仪器', '器具'],
  '巡检周期': ['巡检周期', '周期', '点检周期', '检查周期', '频次', '巡检频次', '点检频次'],
  '适用班次': ['适用班次', '班次', '执行班次', '巡检班次'],
  '上次巡检日期': ['上次巡检日期', '上次巡检', '上次检查日期', '最近巡检日期', '上次日期', '巡检时间', '巡检日期', '点检时间', '检查时间', '记录时间', '完成时间'],
  '结果': ['结果', '上次结果', '检查结果', '巡检结果', '点检结果', '结论', '判定'],
});

// 重要度归一：关键设备 A / 主要设备 B / 一般设备 C；特护归 A 并单列 special；无法归类 → null（不猜测，1/2/3 数字级别厂内可配置不默认映射）
function normCrit(v) {
  const s = C.str(v).toUpperCase().replace(/\s/g, '');
  if (s === '') return null;
  if (/特护/.test(s)) return 'A';
  if (/^(A|一级|1级|关键|重点)/.test(s)) return 'A';
  if (/^(B|二级|2级|主要|重要)/.test(s)) return 'B';
  if (/^(C|三级|3级|一般|次要)/.test(s)) return 'C';
  return null;
}
// 上次巡检结果归一（共享库 classifyResult：先整词匹配正常集合，"无异常"是正常）
function normResult(v) { return C.classifyResult(v); }
function isNo(v) { const s = C.str(v); return !!s && /^(否|不|无|N|no|false|0)/i.test(s); }
function isYes(v) { const s = C.str(v); return !!s && /^(是|Y|yes|true|1|√|✓|特护)/i.test(s); }

// 区域排序键：一区/二区/1区/A区 按自然顺序，无数字的排在有数字的之后
const CN_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
function areaKey(s) {
  const t = C.str(s);
  let m = t.match(/^(\d+)/);
  if (m) return +m[1];
  m = t.match(/^([一二三四五六七八九十])/);
  if (m) return CN_NUM[m[1]];
  return 1000;
}

/** 适用班次判定：标准未填 / 每班 / 全部 → 任何班次都适用；填了具体班次则须包含 --shift */
function shiftApplies(stdShift, shift) {
  if (!shift) return true;
  const s = C.str(stdShift).replace(/\s/g, '');
  if (s === '' || /^(每班|各班|全部|所有|全天|任意班次|任意|不限)$/.test(s)) return true;
  const tokens = s.split(/[/、,，;；|]+/).filter(Boolean);
  return tokens.some((t) => t === shift || t.includes(shift) || shift.includes(t));
}

/** 临期阈值：--due-soon 为「10%」按周期比例，为数字按天；未给按周期的 10% */
function parseDueSoon(v) {
  if (v === undefined) return { ratio: 0.1, days: null, text: '周期的 10%' };
  const s = C.str(v);
  let m = s.match(/^(\d+(?:\.\d+)?)%$/);
  if (m) return { ratio: +m[1] / 100, days: null, text: `周期的 ${m[1]}%` };
  m = s.match(/^(\d+(?:\.\d+)?)(天|d)?$/);
  if (m) return { ratio: null, days: +m[1], text: `${m[1]} 天` };
  throw new Error(`--due-soon 「${v}」无法识别，应为百分比（如 10%）或天数（如 2）`);
}

const hasTimePart = (v) => (typeof v === 'number' ? v % 1 !== 0 : /\d{1,2}:\d{2}/.test(C.str(v)));
const dtMs = (dt) => Date.parse(dt.replace(' ', 'T') + ':00Z');

function loadBook(p) {
  const st = fs.statSync(p);
  return st.isDirectory() ? readCsvDir(p) : readXlsx(p);
}

function main() {
  const a = C.parseArgs(process.argv.slice(2), VALUE_OPTS, FLAG_OPTS);
  if (!a.input) throw new Error('缺少 --input');
  if (!a.workshop) throw new Error('缺少 --workshop');
  if (!a.date) throw new Error('缺少 --date');
  const date = C.normDate(a.date);
  if (!date) throw new Error(`--date 「${a.date}」不是有效日期，应为 YYYY-MM-DD`);
  const shift = a.shift ? C.str(a.shift) : null;
  let refTime = null;
  if (a.time !== undefined) {
    const m = C.str(a.time).match(/^(\d{1,2}):(\d{2})$/);
    if (!m || +m[1] > 23 || +m[2] > 59) throw new Error(`--time 「${a.time}」不是有效时间，应为 HH:mm`);
    refTime = `${m[1].padStart(2, '0')}:${m[2]}`;
  }
  const dueSoonRule = parseDueSoon(a['due-soon']);
  if (!fs.existsSync(a.input)) throw new Error(`输入不存在: ${a.input}`);
  const crit = a.criticality ? normCrit(a.criticality) : null;
  if (a.criticality && !crit) throw new Error(`--criticality 「${a.criticality}」不是有效重要度，应为 A / B / C`);
  const outDir = a.out || path.join(os.tmpdir(), 'itd-out');

  let book;
  try { book = loadBook(a.input); } catch (e) { throw new Error(`读取失败 ${a.input}: ${e.message}`); }

  // ---- 1. 设备台账（唯一必需数据源）
  const ledgerRows = C.pickSheet(book, '设备台账', '台账', '设备清单', '技术对象清单', '功能位置清单');
  if (!ledgerRows) throw new Error('未在输入中找到「设备台账」工作表，无法生成任务清单');
  const ledger = C.toRecords(ledgerRows, ['位号'], '设备台账',
    ['设备编号', '设备名称', '区域', '专业', '特护', '重要度', '是否需巡检', '设备类型'], warnings, ALIASES);
  const hasCritCol = ledger.hasCol('重要度');
  const hasSpecialCol = ledger.hasCol('特护');
  const hasEquipNoCol = ledger.hasCol('设备编号');
  if (!hasCritCol) warnings.push('工作表「设备台账」未提供「重要度/设备分级/ABC标识」列，全部设备重要度记为未知，排序时按常规处理');

  const equipment = [], excluded = [];
  const seen = new Set();
  for (const r of ledger) {
    const tag = C.str(r['位号']);
    if (!tag) { warnings.push(`工作表「设备台账」第${r._row}行 位号为空，已跳过`); continue; }
    if (seen.has(tag)) { warnings.push(`工作表「设备台账」第${r._row}行 位号「${tag}」重复，已跳过重复行`); continue; }
    seen.add(tag);
    const critRaw = C.str(r['重要度']);
    const special = (hasSpecialCol && isYes(r['特护'])) || /特护/.test(critRaw);
    const item = {
      tag, equipNo: C.str(r['设备编号']) || null, name: C.str(r['设备名称']), area: C.str(r['区域']), discipline: C.str(r['专业']),
      type: C.str(r['设备类型']),
      criticality: normCrit(r['重要度']), criticalityRaw: critRaw, special,
      row: r._row,
    };
    if (isNo(r['是否需巡检'])) { excluded.push({ ...item, reason: `台账标注「${C.str(r['是否需巡检'])}」，不纳入巡检` }); continue; }
    if (hasCritCol && critRaw && !item.criticality) {
      warnings.push(`工作表「设备台账」第${r._row}行 重要度「${critRaw}」无法归类为 关键(A)/主要(B)/一般(C)，按未知处理（数字级别映射属厂内可配置，未默认）`);
    }
    equipment.push(item);
  }
  if (!equipment.length) throw new Error('设备台账中无任何需巡检设备（全部为空位号或标注不需巡检）');

  // ---- 2. 巡检标准（按位号优先，其次按设备类型）
  const stdRows = C.pickSheet(book, '巡检标准', '点检标准', '标准', '检查项');
  const stdByTag = new Map(), stdByType = new Map();
  let stdCount = 0;
  const otherShift = [], otherShiftKeys = new Map();
  if (!stdRows) {
    warnings.push('未找到工作表「巡检标准」，全部设备将归入「无巡检标准」一节，不生成任务项');
  } else {
    const stds = C.toRecords(stdRows, ['检查项'], '巡检标准',
      ['位号', '设备类型', '判定标准', '所需工具', '巡检周期', '适用班次'], warnings, ALIASES);
    for (const r of stds) {
      const item = C.str(r['检查项']);
      if (!item) { warnings.push(`工作表「巡检标准」第${r._row}行 检查项为空，已跳过`); continue; }
      const tag = C.str(r['位号']), type = C.str(r['设备类型']);
      const stdShift = C.str(r['适用班次']);
      stdCount++;
      if (!shiftApplies(stdShift, shift)) {
        otherShift.push({ tag: tag || null, type: type || null, item, shift: stdShift, row: r._row });
        const key = tag ? `tag:${tag}` : (type ? `type:${type}` : null);
        if (key) { if (!otherShiftKeys.has(key)) otherShiftKeys.set(key, new Set()); otherShiftKeys.get(key).add(stdShift); }
        continue;
      }
      const raw = C.str(r['巡检周期']);
      const pd = C.parsePeriodDetail(r['巡检周期']);
      const runHours = C.parseRunHours(r['巡检周期']);
      if (!pd) {
        warnings.push(`工作表「巡检标准」第${r._row}行 检查项「${item}」的巡检周期${raw ? `「${raw}」${runHours ? '是运行小时周期，本技能只按日历/班次周期排期' : '无法解析'}` : '为空'}，已归入「周期待确认」，未按日检默认处理`);
      }
      const s = {
        item, criterion: C.str(r['判定标准']), tool: C.str(r['所需工具']),
        periodRaw: raw, periodDays: pd ? pd.days : null, periodHours: pd ? pd.hours : null,
        granularity: pd ? (pd.days < 1 ? 'hour' : 'day') : null,
        shift: stdShift, row: r._row,
      };
      if (tag) { if (!stdByTag.has(tag)) stdByTag.set(tag, []); stdByTag.get(tag).push(s); }
      else if (type) { if (!stdByType.has(type)) stdByType.set(type, []); stdByType.get(type).push(s); }
      else warnings.push(`工作表「巡检标准」第${r._row}行 既无位号也无设备类型，无法匹配到设备，已跳过`);
    }
  }

  // ---- 3. 上次巡检记录（可选；缺失时全部视为未检）
  const lastRows = C.pickSheet(book, '上次巡检记录', '上次巡检', '巡检记录', '历史记录', '巡检明细', '点检数据');
  const lastByTag = new Map();
  let lastProvided = false;
  if (!lastRows) {
    warnings.push('未找到工作表「上次巡检记录」，全部设备按「从未巡检」处理，到期状态为未检');
  } else {
    lastProvided = true;
    const lasts = C.toRecords(lastRows, ['位号'], '上次巡检记录', ['上次巡检日期', '结果', '是否报警', '设备名称'], warnings, ALIASES);
    const hasResult = lasts.hasCol('结果'), hasAlarm = lasts.hasCol('是否报警');
    for (const r of lasts) {
      const tag = C.str(r['位号']);
      if (!tag) { warnings.push(`工作表「上次巡检记录」第${r._row}行 位号为空，已跳过`); continue; }
      const raw = C.str(r['上次巡检日期']);
      const d = C.normDate(r['上次巡检日期']);
      const dt = hasTimePart(r['上次巡检日期']) ? C.normDateTime(r['上次巡检日期']) : null;
      if (raw && !d) warnings.push(`工作表「上次巡检记录」第${r._row}行 上次巡检日期「${raw}」无法解析，该设备按未检处理`);
      if (d && C.diffDays(d, date) > 0) warnings.push(`工作表「上次巡检记录」第${r._row}行 上次巡检日期 ${d} 晚于任务日期 ${date}，请核实`);
      let result = null, resultRaw = '';
      if (hasResult && C.str(r['结果'])) { result = normResult(r['结果']); resultRaw = C.str(r['结果']); }
      else if (hasAlarm && C.str(r['是否报警'])) { result = isYes(r['是否报警']) ? 'abnormal' : (isNo(r['是否报警']) ? 'normal' : 'unknown'); resultRaw = `是否报警=${C.str(r['是否报警'])}`; }
      const prev = lastByTag.get(tag);
      const cur = { date: d, dateTime: dt, result, resultRaw, row: r._row };
      // 同一设备多条记录取最近一次（智能巡检一行一检查项：任一检查项异常/报警即记为上次异常）
      if (!prev || (cur.date && (!prev.date || cur.date > prev.date || (cur.date === prev.date && cur.dateTime && (!prev.dateTime || cur.dateTime > prev.dateTime))))) {
        if (prev && prev.date === cur.date && prev.result === 'abnormal' && cur.result !== 'abnormal') { cur.result = 'abnormal'; cur.resultRaw = prev.resultRaw; }
        lastByTag.set(tag, cur);
      } else if (prev && prev.date === cur.date && cur.result === 'abnormal' && prev.result !== 'abnormal') { prev.result = 'abnormal'; prev.resultRaw = cur.resultRaw; }
    }
  }

  // ---- 4. 过滤器
  const filters = {
    area: a.area ? C.str(a.area) : null,
    discipline: a.discipline ? C.str(a.discipline) : null,
    criticality: crit,
    group: a.group ? C.str(a.group) : null,
  };
  const filteredOut = [];
  const inScope = equipment.filter((e) => {
    if (filters.area && e.area !== filters.area) { filteredOut.push({ ...e, reason: `区域「${e.area || '未填'}」不匹配 --area ${filters.area}` }); return false; }
    if (filters.discipline && e.discipline !== filters.discipline) { filteredOut.push({ ...e, reason: `专业「${e.discipline || '未填'}」不匹配 --discipline ${filters.discipline}` }); return false; }
    if (filters.criticality && e.criticality !== filters.criticality) { filteredOut.push({ ...e, reason: `重要度「${e.criticalityRaw || '未填'}」不匹配 --criticality ${filters.criticality}` }); return false; }
    return true;
  });
  if (!inScope.length) warnings.push('按当前过滤条件（区域/专业/重要度）筛选后无任何设备，任务清单为空');

  // ---- 5. 逐台设备 × 逐条标准，生成任务项
  const tasks = [], unscheduled = [], noStandard = [], otherShiftOnly = [], overdue = [], dueSoon = [];
  const refDT = refTime ? `${date} ${refTime}` : null;
  let hourNoTimeNoted = false;
  for (const e of inScope) {
    let stds = stdByTag.get(e.tag);
    let matchBy = '位号';
    if (!stds || !stds.length) { stds = e.type ? stdByType.get(e.type) : null; matchBy = '设备类型'; }
    if (!stds || !stds.length) {
      const skipped = otherShiftKeys.get(`tag:${e.tag}`) || (e.type ? otherShiftKeys.get(`type:${e.type}`) : null);
      const rec = { tag: e.tag, equipNo: e.equipNo, name: e.name, area: e.area, discipline: e.discipline,
        criticality: e.criticality, criticalityRaw: e.criticalityRaw, special: e.special, type: e.type };
      if (skipped) otherShiftOnly.push({ ...rec, shifts: [...skipped].join('/'), reason: `该设备巡检标准的适用班次「${[...skipped].join('/')}」不含本班「${shift}」，本班未排` });
      else noStandard.push({ ...rec, reason: e.type ? `按位号与设备类型「${e.type}」均未匹配到巡检标准` : '按位号未匹配到巡检标准，且台账未填设备类型' });
      continue;
    }
    const last = lastByTag.get(e.tag) || null;
    for (const s of stds) {
      const base = {
        tag: e.tag, equipNo: e.equipNo, name: e.name, area: e.area, discipline: e.discipline,
        criticality: e.criticality, criticalityRaw: e.criticalityRaw, special: e.special,
        item: s.item, criterion: s.criterion || null, tool: s.tool || null,
        periodRaw: s.periodRaw || null, periodDays: s.periodDays, periodHours: s.periodHours, granularity: s.granularity,
        periodText: C.fmtPeriod(s.periodDays), applicableShift: s.shift || null,
        matchBy, stdRow: s.row,
        lastDate: last ? last.date : null, lastDateTime: last ? last.dateTime : null,
        lastResult: last ? last.result : null,
        lastResultRaw: last ? last.resultRaw : null,
      };
      // 周期无法解析 → unscheduled，绝不默认按日检
      if (!s.periodDays) {
        unscheduled.push({ ...base, dueStatus: 'unscheduled',
          reason: s.periodRaw ? `巡检周期「${s.periodRaw}」无法解析` : '巡检标准未填写巡检周期' });
        continue;
      }
      let dueStatus, dueDate = null, overdueDays = null, daysToDue = null, overdueHours = null, dueSoonThreshold = null, dueNote = null;
      if (!base.lastDate) {
        dueStatus = 'never';        // 无上次记录 → 未检，纳入本班
      } else if (s.granularity === 'hour') {
        // 班次级周期（每班/每 N 小时）：按小时判定；上次记录与 --time 都带时间才算逾期小时数，否则本班到期
        if (base.lastDateTime && refDT) {
          const dueMs = dtMs(base.lastDateTime) + s.periodHours * 3600000;
          dueDate = new Date(dueMs).toISOString().slice(0, 16).replace('T', ' ');
          const diffH = Math.round((dtMs(refDT) - dueMs) / 360000) / 10;
          if (diffH > 0) { dueStatus = 'overdue'; overdueHours = diffH; overdueDays = Math.floor(diffH / 24); }
          else if (diffH === 0) { dueStatus = 'due'; }
          else { dueStatus = 'notDue'; }
        } else {
          dueStatus = 'due';
          dueNote = '班次级周期，本班须执行；' + (base.lastDateTime ? '未给 --time' : '上次记录无时间') + '，未按小时判定逾期';
          if (!hourNoTimeNoted) { hourNoTimeNoted = true; warnings.push(`存在班次级周期（每班/每 N 小时）的检查项，${base.lastDateTime ? '未给 --time 班次开始时间' : '上次巡检记录不带时间'}，按「本班到期」处理，未按小时判定逾期`); }
        }
      } else {
        dueDate = C.addDays(base.lastDate, Math.round(s.periodDays));
        const d = C.diffDays(date, dueDate);   // >0 已过到期日
        daysToDue = d === null ? null : -d;
        dueSoonThreshold = dueSoonRule.ratio !== null ? Math.round(s.periodDays * dueSoonRule.ratio * 10) / 10 : dueSoonRule.days;
        if (d === null) { dueStatus = 'unscheduled'; }
        else if (d > 0) { dueStatus = 'overdue'; overdueDays = d; }
        else if (d === 0) { dueStatus = 'due'; }
        else if (-d <= dueSoonThreshold) { dueStatus = 'dueSoon'; }
        else { dueStatus = 'notDue'; }
      }
      const t = { ...base, dueDate, dueStatus, overdueDays, overdueHours, daysToDue, dueSoonThreshold, dueNote };
      if (dueStatus === 'unscheduled') { unscheduled.push({ ...t, reason: '到期日无法计算' }); continue; }
      if (dueStatus === 'notDue') continue;   // 未到期不进本班清单
      tasks.push(t);
      if (dueStatus === 'overdue') overdue.push(t);
      if (dueStatus === 'dueSoon') dueSoon.push(t);
    }
  }

  // ---- 6. 优先级：特护 > 逾期 > 关键设备(A) > 上次异常 > 临期 > 常规（见 references/dispatch-rules.md）
  function priorityOf(t) {
    if (t.special) return { level: 'P1', score: 1, reason: '特护设备（强制最高优先级）' + (t.dueStatus === 'overdue' ? `，且已逾期 ${t.overdueHours !== null ? t.overdueHours + ' 小时' : t.overdueDays + ' 天'}` : '') };
    if (t.dueStatus === 'overdue') return { level: 'P2', score: 2, reason: `已逾期 ${t.overdueHours !== null ? t.overdueHours + ' 小时' : t.overdueDays + ' 天'}` };
    if (t.criticality === 'A') return { level: 'P3', score: 3, reason: '关键设备（A 类）' };
    if (t.lastResult === 'abnormal') return { level: 'P4', score: 4, reason: `上次巡检结果「${t.lastResultRaw}」为异常` };
    if (t.dueStatus === 'dueSoon') return { level: 'P5', score: 5, reason: `临期（距到期 ${t.daysToDue} 天，阈值 ${dueSoonRule.text}）` };
    if (t.dueStatus === 'never') return { level: 'P6', score: 6, reason: lastProvided ? '无上次巡检记录，按未检纳入' : '未提供上次巡检记录，按未检纳入' };
    return { level: 'P6', score: 6, reason: t.dueNote || '常规到期项' };
  }
  for (const t of tasks) { const p = priorityOf(t); t.priority = p.level; t.priorityScore = p.score; t.priorityReason = p.reason; }
  tasks.sort((x, y) => x.priorityScore - y.priorityScore
    || (y.overdueDays || 0) - (x.overdueDays || 0)
    || (y.overdueHours || 0) - (x.overdueHours || 0)
    || x.tag.localeCompare(y.tag, 'zh')
    || x.item.localeCompare(y.item, 'zh'));

  // ---- 7. 路线编排：按区域聚类 → 区内按位号排序（建议顺序，实际路线由车间确定）
  const areaOrder = [...new Set(tasks.map((t) => t.area || ''))].sort((x, y) => {
    if (x === '') return 1; if (y === '') return -1;   // 区域未填排最后
    const kx = areaKey(x), ky = areaKey(y);
    if (kx !== ky) return kx - ky;
    return x.localeCompare(y, 'zh');
  });
  const route = [];
  let seq = 0;
  for (const ar of areaOrder) {
    const inArea = tasks.filter((t) => (t.area || '') === ar)
      .sort((x, y) => x.tag.localeCompare(y.tag, 'zh') || x.item.localeCompare(y.item, 'zh'));
    const tagsInArea = [];
    for (const t of inArea) { t.routeSeq = ++seq; if (!tagsInArea.includes(t.tag)) tagsInArea.push(t.tag); }
    route.push({ area: ar || '（区域未填）', tags: tagsInArea, taskCount: inArea.length });
  }

  overdue.sort((x, y) => (y.overdueDays || 0) - (x.overdueDays || 0) || (y.overdueHours || 0) - (x.overdueHours || 0) || x.tag.localeCompare(y.tag, 'zh'));
  dueSoon.sort((x, y) => x.tag.localeCompare(y.tag, 'zh'));
  unscheduled.sort((x, y) => x.tag.localeCompare(y.tag, 'zh'));
  noStandard.sort((x, y) => x.tag.localeCompare(y.tag, 'zh'));
  otherShiftOnly.sort((x, y) => x.tag.localeCompare(y.tag, 'zh'));

  const tools = [...new Set(tasks.map((t) => t.tool).filter(Boolean))].sort((x, y) => x.localeCompare(y, 'zh'));
  const specialTasks = tasks.filter((t) => t.special);
  const counts = {
    ledgerEquipment: equipment.length + excluded.length,
    excluded: excluded.length,
    inScopeEquipment: inScope.length,
    filteredOut: filteredOut.length,
    standards: stdCount,
    otherShift: otherShift.length,
    tasks: tasks.length,
    taskEquipment: new Set(tasks.map((t) => t.tag)).size,
    special: specialTasks.length,
    specialEquipment: new Set(specialTasks.map((t) => t.tag)).size,
    overdue: overdue.length,
    dueSoon: dueSoon.length,
    due: tasks.filter((t) => t.dueStatus === 'due').length,
    never: tasks.filter((t) => t.dueStatus === 'never').length,
    hourly: tasks.filter((t) => t.granularity === 'hour').length,
    unscheduled: unscheduled.length,
    noStandard: noStandard.length,
    otherShiftOnlyEquipment: otherShiftOnly.length,
    areas: route.length,
  };

  // ---- 8. 产出
  C.ensureDir(outDir);
  const DUE_CN = { overdue: '已逾期', due: '本班到期', dueSoon: '临期', never: '未检', unscheduled: '周期待确认' };
  const shiftText = shift || '全天';
  const generatedAt = C.localDateTime();
  const fdesc = [filters.area && `区域=${filters.area}`, filters.discipline && `专业=${filters.discipline}`, filters.criticality && `重要度=${filters.criticality}`].filter(Boolean);
  const disclaimer = '本清单由脚本按台账、巡检标准与上次记录生成，模型只成文说明，仅供车间设备员复核与下发参考；不判定设备状况，不替代巡检标准与检修规程；厂内制度与系统数据为准。';
  const routeNote = '建议顺序按区域聚类后位号排序生成，仅供参考，实际巡检路线由车间确定。';
  const out = {
    meta: {
      workshop: a.workshop, date, shift, shiftText, refTime, group: filters.group,
      source: path.basename(a.input), filters, filtersText: fdesc.length ? fdesc.join('、') : '无（全车间）',
      dueSoonRule: dueSoonRule.text,
      lastRecordProvided: lastProvided, standardProvided: !!stdRows,
      hasEquipNo: hasEquipNoCol, hasSpecialCol,
      generatedAt, routeNote, disclaimer,
      toolsText: tools.length ? tools.join('、') : '—（标准表未填写所需工具）',
    },
    counts, tasks, special: specialTasks, overdue, dueSoon, unscheduled, noStandard, otherShiftOnly, otherShift, excluded, filteredOut, route, tools, warnings,
  };
  fs.writeFileSync(path.join(outDir, 'tasks.json'), JSON.stringify(out, null, 2), 'utf8');

  const dueText = (t) => {
    if (t.dueStatus === 'overdue') return t.overdueHours !== null ? `逾期${t.overdueHours}小时` : `逾期${t.overdueDays}天`;
    return t.dueDate || (t.dueNote ? '本班' : '—');
  };
  const L = [];
  L.push(`# ${a.workshop} 巡检任务清单（${date} ${shiftText}）`);
  L.push('');
  L.push(`数据来源：${out.meta.source}${filters.group ? ` ｜ 人员分组：${filters.group}` : ''}`);
  L.push(`筛选条件：${out.meta.filtersText}`);
  L.push(`班次：${shift ? `${shift}（巡检标准「适用班次」不含本班的检查项已剔除 ${counts.otherShift} 项）` : '未指定（按全天排，不按适用班次过滤）'}${refTime ? ` ｜ 班次开始时间：${refTime}` : ''}`);
  L.push(`临期阈值：距到期 ≤ ${dueSoonRule.text}`);
  L.push(`生成时间：${generatedAt}（北京时间）`);
  L.push('');
  L.push('## 一、任务概览');
  L.push('');
  L.push(C.mdTable(['指标', '数量'], [
    ['台账设备', counts.ledgerEquipment], ['不需巡检（台账标注）', counts.excluded],
    ['本次范围内设备', counts.inScopeEquipment], ['筛选排除', counts.filteredOut],
    ['任务项合计', counts.tasks], ['涉及设备', counts.taskEquipment],
    ['其中特护设备任务项', counts.special], ['特护设备台数', counts.specialEquipment],
    ['已逾期', counts.overdue], ['本班到期', counts.due], ['临期', counts.dueSoon], ['未检（无上次记录）', counts.never],
    ['班次级周期项（每班/每 N 小时）', counts.hourly],
    ['不属本班（适用班次不含）', counts.otherShift],
    ['周期待确认', counts.unscheduled], ['无巡检标准', counts.noStandard],
    ['标准仅适用其他班次的设备', counts.otherShiftOnlyEquipment],
  ]));
  L.push(`所需工具汇总：${out.meta.toolsText}`);
  L.push('');
  if (specialTasks.length) {
    L.push('【注意】本班含特护设备任务项，已强制排在最高优先级 P1：' + [...new Set(specialTasks.map((t) => t.tag))].join('、'));
    L.push('');
  }
  L.push('## 二、任务明细（按建议路线顺序）');
  L.push('');
  if (!tasks.length) L.push('_本班无到期任务项。_\n');
  else {
    const hdr = ['建议顺序', '位号'].concat(hasEquipNoCol ? ['设备编号'] : [], ['设备名称', '专业', '重要度', '检查项', '判定标准', '所需工具', '周期', '优先级', '到期状态', '到期日']);
    for (const r of route) {
      L.push(`### ${r.area}（${r.taskCount} 项）`);
      L.push('');
      const rows = tasks.filter((t) => (t.area || '（区域未填）') === r.area || (t.area === '' && r.area === '（区域未填）'))
        .sort((x, y) => x.routeSeq - y.routeSeq)
        .map((t) => [t.routeSeq, t.tag].concat(hasEquipNoCol ? [t.equipNo || '—'] : [],
          [t.name || '—', t.discipline || '—', (t.criticalityRaw || '—') + (t.special ? '（特护）' : ''),
            t.item, t.criterion || '—', t.tool || '—', t.periodText, t.priority, DUE_CN[t.dueStatus] || t.dueStatus, dueText(t)]));
      L.push(C.mdTable(hdr, rows));
    }
  }
  L.push('## 三、逾期与临期专项');
  L.push('');
  L.push('**已逾期未检**');
  L.push('');
  L.push(C.mdTable(['位号', '设备名称', '区域', '检查项', '周期', '上次巡检', '到期', '逾期', '上次结果'],
    overdue.map((t) => [t.tag, t.name || '—', t.area || '—', t.item, t.periodText, t.lastDateTime || t.lastDate || '—', t.dueDate || '—',
      t.overdueHours !== null ? `${t.overdueHours} 小时` : `${t.overdueDays} 天`, t.lastResultRaw || '—'])));
  L.push(`**临期（距到期 ≤ ${dueSoonRule.text}）**`);
  L.push('');
  L.push(C.mdTable(['位号', '设备名称', '区域', '检查项', '周期', '到期日', '距到期天数', '本项阈值(天)'],
    dueSoon.map((t) => [t.tag, t.name || '—', t.area || '—', t.item, t.periodText, t.dueDate || '—', t.daysToDue, t.dueSoonThreshold])));
  L.push('## 四、周期待确认');
  L.push('');
  L.push('_以下检查项的巡检周期为空或无法解析，脚本未按日检默认处理，也未丢弃，请车间确认周期后再排期。_');
  L.push('');
  L.push(C.mdTable(['位号', '设备名称', '区域', '检查项', '周期原文', '原因'],
    unscheduled.map((t) => [t.tag, t.name || '—', t.area || '—', t.item, t.periodRaw || '（空）', t.reason])));
  L.push('**无巡检标准的设备**（未生成任务项，请补齐标准表）');
  L.push('');
  L.push(C.mdTable(['位号', '设备名称', '区域', '专业', '重要度', '原因'],
    noStandard.map((e) => [e.tag, e.name || '—', e.area || '—', e.discipline || '—', (e.criticalityRaw || '—') + (e.special ? '（特护）' : ''), e.reason])));
  if (shift && otherShiftOnly.length) {
    L.push(`**巡检标准仅适用其他班次的设备**（本班未排，不算无标准，共 ${otherShiftOnly.length} 台）`);
    L.push('');
    L.push(C.mdTable(['位号', '设备名称', '区域', '标准适用班次', '说明'], otherShiftOnly.map((e) => [e.tag, e.name || '—', e.area || '—', e.shifts, e.reason])));
  }
  if (shift && otherShift.length) {
    L.push(`**不属本班的检查项**（巡检标准「适用班次」不含「${shift}」，本班未排，共 ${otherShift.length} 项）`);
    L.push('');
    L.push(C.mdTable(['位号/设备类型', '检查项', '适用班次'], otherShift.map((o) => [o.tag || `类型:${o.type}`, o.item, o.shift])));
  }
  L.push('## 五、执行提示与交接事项');
  L.push('');
  L.push('<!-- NOTES_START -->');
  L.push('（由模型依据 references/dispatch-rules.md 口径撰写，说明本班重点、特护设备与逾期项、需带检测工具、与上一班的衔接事项。数量与逾期天数/小时一律引用 tasks.json。）');
  L.push('<!-- NOTES_END -->');
  L.push('');
  L.push(`> ${routeNote}`);
  L.push(`> ${disclaimer}`);
  L.push('');
  if (warnings.length) {
    L.push('## 附：数据提示');
    L.push('');
    for (const w of warnings) L.push(`- ${w}`);
    L.push('');
  }
  fs.writeFileSync(path.join(outDir, 'tasklist.md'), L.join('\n'), 'utf8');

  C.emitOk(outDir, { ok: true, out: outDir, date, shift, workshop: a.workshop, counts, warnings });
}

try { main(); } catch (e) { C.fail(e, warnings); }
