#!/usr/bin/env node
'use strict';
/**
 * 设备润滑管理脚本（仅 Node.js 内置模块）—— 中石化体系炼化厂车间设备员口径（五定三过滤）
 * 用法：node "<技能目录>/scripts/lube.js" --input <xlsx> --workshop "常减压车间" --date 2026-09-21 [--out <dir>]
 *       [--lead-days 7] [--lead-hours 168] [--equipment "P-1101A,P-1102A"] [--price <油品单价表xlsx>]
 *       [--run-hours <runtime-hours-tracker 的 runtime.json 或 含「累计运行小时」的xlsx>]
 *       [--ref-standard <参考限值表xlsx>] [--oil-analysis]
 * 产出：<out>/lube.json、<out>/lube-report.md、<out>/summary.json；末行打印 JSON 摘要
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readXlsx, readCsvDir } = require('./lib/xlsx-lite');
const C = require('./lib/common');

const warnings = [];
const num = C.makeNum(warnings);
const VALUE_OPTS = ['input', 'workshop', 'date', 'out', 'lead-days', 'lead-hours', 'equipment', 'price', 'run-hours', 'ref-standard'];
const FLAG_OPTS = ['oil-analysis', 'help'];

const DECLARATION = '本材料由脚本汇总、模型成文，仅供设备员复核参考，不替代审批、定性、验收与签字；厂内制度与系统数据为准。';

/**
 * 别名：局部优先，再合并共享 SYSTEM_ALIASES（SAP PM / EM / 智能巡检导出列名）。
 * 注意：局部不把「设备编号」作位号别名 —— SAP 设备编号是流水号，不是功能位置/位号。
 */
const ALIASES = C.mergeAliases({
  '位号': ['位号', '设备位号', '润滑点位号', 'TAG', 'tag'],
  '设备名称': ['设备名称', '名称'],
  '润滑部位': ['润滑部位', '部位', '加油部位', '润滑点', '润滑点名称', '加注部位'],
  '油品名称': ['油品名称', '油品牌号', '润滑油牌号', '油品', '牌号', '油号', '润滑油', '润滑剂', '用油'],
  '润滑方式': ['润滑方式', '方式', '作业方式', '加换油方式', '加注方式'],
  '润滑周期': ['润滑周期', '周期', '加换油周期', '换油周期', '加油周期', '换油期', '润滑间隔', '加换油间隔'],
  '上次加换油日期': ['上次加换油日期', '上次加换油', '上次换油日期', '上次加油日期', '上次日期', '末次加换油日期', '上次作业日期', '最近加换油日期'],
  '加油量': ['加油量', '标准加油量', '单次加油量', '定额油量', '加注量', '用量'],
  '油品规格': ['油品规格', '黏度等级', '粘度等级', '牌号规格', '规格'],
  '责任人': ['责任人', '润滑责任人', '定人', '包机人', '岗位责任人', '负责人', '责任班组', '责任岗位'],
  '累计运行小时': ['累计运行小时', '累计运行时间', '累计运行时数', '运行小时', '运行时数', '累计小时'],
  '上次加换油时累计小时': ['上次加换油时累计小时', '上次换油时累计小时', '上次加换油时运行小时', '换油时累计小时', '上次加换油小时数'],
  '自上次加换油运行小时': ['自上次加换油运行小时', '换油后运行小时', '加换油后运行小时', '换油后累计小时', '本周期运行小时'],
  '日期': ['日期', '加换油日期', '作业日期', '记录日期', '时间'],
  '类型': ['类型', '加换油类型', '作业类型', '方式'],
  '数量': ['数量', '用量', '加油量', '加注量', '耗量', '消耗量', '领用量'],
  '单位': ['单位', '计量单位'],
  '执行人': ['执行人', '操作人', '加油人', '记录人', '作业人'],
  '取样日期': ['取样日期', '取样时间', '采样日期', '送样日期'],
  '检测项': ['检测项', '检测项目', '分析项目', '项目', '指标'],
  '检测值': ['检测值', '实测值', '结果值', '测值', '数值'],
  '限值': ['限值', '控制限值', '厂内限值', '标准限值', '报警值', '界限值', '换油指标'],
  '结论': ['结论', '判定', '化验结论', '评价'],
  '单价': ['单价', '价格', '油品单价', '参考单价'],
  '标准号': ['标准号', '标准', '依据', '出处', '参考标准'],
  '油品类型': ['油品类型', '油品种类', '适用油品', '油类'],
});

// 五定：每一定对应的台账列
const WUDING = [
  { key: '定点', col: '润滑部位', note: '润滑部位（点）' },
  { key: '定质', col: '油品名称', note: '油品牌号（质）' },
  { key: '定量', col: '加油量', note: '加油量（量）' },
  { key: '定期', col: '润滑周期', note: '润滑周期（期）' },
  { key: '定人', col: '责任人', note: '责任人（人）' },
];

// 润滑方式归一
function normMode(v) {
  const s = C.str(v);
  if (!s) return '';
  if (s.includes('换')) return '换油';
  if (s.includes('补')) return '补油';
  if (s.includes('加')) return '加油';
  return s;
}
// 单位归一：仅做写法归一，不同量纲绝不换算
function normUnit(v) {
  const s = C.str(v).replace(/\s/g, '');
  if (!s) return '';
  if (/^(l|L|升|公升)$/.test(s)) return 'L';
  if (/^(kg|KG|Kg|千克|公斤)$/.test(s)) return 'kg';
  if (/^(g|克)$/.test(s)) return 'g';
  if (/^(桶|drum|DRUM)$/.test(s)) return '桶';
  if (/^(支|条|管)$/.test(s)) return '支';
  return s;
}
/** 油品品牌词（归一时剥离，仅用于比对，不改写原名） */
const BRAND_WORDS = ['长城', '昆仑', '壳牌', '美孚', '嘉实多', '道达尔', '福斯', '克鲁勃', '统一', 'SHELL', 'MOBIL', 'CASTROL', 'TOTAL', 'FUCHS', 'KLUBER', 'GREATWALL', 'KUNLUN', 'SINOPEC', 'PETROCHINA'];
/** 油品牌号归一键：转大写、去品牌词、去空格与标点（仅用于疑似同一油品的比对与单价匹配） */
function oilKey(s) {
  let k = C.str(s).toUpperCase().replace(/[\s\-_/()（）·、,，．.]/g, '');
  for (const b of BRAND_WORDS) k = k.split(b.toUpperCase()).join('');
  return k;
}
/** 检测项归一键：去单位括号、空格、全角标点 */
function itemKey(s) {
  return C.str(s).replace(/[（(].*?[)）]/g, '').replace(/[\s　,，．.、/]/g, '').toUpperCase();
}

function loadBook(p) {
  const st = fs.statSync(p);
  return st.isDirectory() ? readCsvDir(p) : readXlsx(p);
}

/** 读 --run-hours：runtime-hours-tracker 的 runtime.json（byEquipment[].cumHours）或含「位号/累计运行小时」的表 */
function loadRunHours(p) {
  const map = new Map();
  map.partial = new Map();   // tag → 累计可能偏小的原因（runtime.json 中本期运行小时不可算 / 仅本期增量）
  if (/\.json$/i.test(p)) {
    let j; try { j = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { throw new Error(`--run-hours JSON 解析失败 ${p}: ${e.message}`); }
    const list = Array.isArray(j.byEquipment) ? j.byEquipment : (Array.isArray(j) ? j : null);
    if (!list) throw new Error(`--run-hours JSON 中未找到 byEquipment 数组（应为 runtime-hours-tracker 的 runtime.json）`);
    for (const x of list) {
      const tag = C.str(x.tag || x['位号']);
      const h = typeof x.cumHours === 'number' ? x.cumHours : num(x.cumHours === undefined ? x['累计运行小时'] : x.cumHours);
      if (!tag) continue;
      if (h === null) { warnings.push(`--run-hours 中设备「${tag}」累计运行小时为空或无法解析，该设备运行小时周期不判定`); continue; }
      map.set(tag, h);
      if (x.periodHours === null) map.partial.set(tag, `本期运行小时不可算（periodHours 为空），累计 ${h}h 仅为期初/上期值`);
      else if (x.cumBasis === 'periodOnly') map.partial.set(tag, `累计口径为仅本期增量（无期初累计），累计 ${h}h 不含上次大检修前的运行小时`);
    }
    return map;
  }
  let b; try { b = loadBook(p); } catch (e) { throw new Error(`读取 --run-hours 失败 ${p}: ${e.message}`); }
  const rows = C.pickSheet(b, '累计运行小时', '运行小时', '运行时长', '运行统计') || b[Object.keys(b)[0]];
  if (!rows) throw new Error(`--run-hours 表中无工作表`);
  const recs = C.toRecords(rows, ['位号', '累计运行小时'], '累计运行小时', [], warnings, ALIASES);
  for (const r of recs) {
    const tag = C.str(r['位号']);
    if (!tag) continue;
    const h = num(r['累计运行小时'], { sheet: '累计运行小时', row: r._row, col: '累计运行小时' });
    if (h === null) { warnings.push(`--run-hours 表第${r._row}行 设备「${tag}」累计运行小时无法解析，该设备运行小时周期不判定`); continue; }
    map.set(tag, h);
  }
  return map;
}

/** 读 --ref-standard：参考限值表（用户提供的国标/厂家换油指标转录，脚本不内置任何数值） */
function loadRefStandard(p) {
  let b; try { b = loadBook(p); } catch (e) { throw new Error(`读取 --ref-standard 失败 ${p}: ${e.message}`); }
  const rows = C.pickSheet(b, '参考限值', '换油指标', '参考标准', '限值');
  if (!rows) throw new Error('--ref-standard 表中未找到「参考限值」工作表');
  const recs = C.toRecords(rows, ['检测项', '限值'], '参考限值', ['油品类型', '标准号'], warnings, ALIASES);
  const list = [];
  for (const r of recs) {
    const item = C.str(r['检测项']);
    const raw = C.str(r['限值']);
    if (!item || !raw) continue;
    const lim = parseLimit(raw);
    if (!lim) { warnings.push(`工作表「参考限值」第${r._row}行 检测项「${item}」限值「${raw}」无法解析，该参考项不启用`); continue; }
    list.push({ itemKey: itemKey(item), item, oilType: C.str(r['油品类型']), oilKey: oilKey(r['油品类型']), limit: lim, standard: C.str(r['标准号']) || '（未填标准号）', row: r._row });
  }
  if (!list.length) warnings.push('「参考限值」表无可用参考项，油液分析不作参考比对');
  return list;
}

function main() {
  const a = C.parseArgs(process.argv.slice(2), VALUE_OPTS, FLAG_OPTS);
  if (!a.input) throw new Error('缺少 --input');
  if (!a.workshop) throw new Error('缺少 --workshop');
  if (!a.date) throw new Error('缺少 --date');
  const date = C.normDate(a.date);
  if (!date) throw new Error(`--date 「${a.date}」不是有效日期，应为 YYYY-MM-DD`);
  let leadDays = 7;
  if (a['lead-days'] !== undefined) {
    const n = Number(a['lead-days']);
    if (!Number.isFinite(n) || n < 0) throw new Error(`--lead-days 「${a['lead-days']}」不是有效的非负天数`);
    leadDays = Math.round(n);
  }
  let leadHours = leadDays * 24;
  if (a['lead-hours'] !== undefined) {
    const n = Number(a['lead-hours']);
    if (!Number.isFinite(n) || n < 0) throw new Error(`--lead-hours 「${a['lead-hours']}」不是有效的非负小时数`);
    leadHours = n;
  }
  if (!fs.existsSync(a.input)) throw new Error(`输入不存在: ${a.input}`);
  if (a.price && !fs.existsSync(a.price)) throw new Error(`单价表不存在: ${a.price}`);
  if (a['run-hours'] && !fs.existsSync(a['run-hours'])) throw new Error(`--run-hours 文件不存在: ${a['run-hours']}`);
  if (a['ref-standard'] && !fs.existsSync(a['ref-standard'])) throw new Error(`--ref-standard 文件不存在: ${a['ref-standard']}`);
  const outDir = a.out || path.join(os.tmpdir(), 'lube-out');

  const scope = a.equipment ? a.equipment.split(/[,，]/).map((s) => s.trim()).filter(Boolean) : null;
  const inScope = (tag) => !scope || scope.includes(tag);

  let book;
  try { book = loadBook(a.input); } catch (e) { throw new Error(`读取失败 ${a.input}: ${e.message}`); }
  const runHoursMap = a['run-hours'] ? loadRunHours(a['run-hours']) : null;
  const refStd = a['ref-standard'] ? loadRefStandard(a['ref-standard']) : null;

  // ---------------------------------------------------------------- 一、润滑台账 → 到期判定
  const ledgerRows = C.pickSheet(book, '润滑台账', '润滑计划', '润滑点台账', '五定表', '润滑五定', '台账');
  if (!ledgerRows) throw new Error('未在输入中找到「润滑台账」工作表，无法做到期判定');
  const ledger = C.toRecords(ledgerRows, ['位号', '油品名称'], '润滑台账',
    ['设备名称', '设备编号', '润滑部位', '润滑方式', '润滑周期', '上次加换油日期', '加油量', '油品规格', '责任人',
      '累计运行小时', '上次加换油时累计小时', '自上次加换油运行小时'], warnings, ALIASES);

  const overdue = [], dueSoon = [], normal = [], undetermined = [];
  const oilNames = new Map();       // oilKey → Set(原始写法)
  const nameOf = new Map();         // 位号 → 设备名称（台账为准，供其余表补名）
  const oilOf = new Map();          // 位号 → 油品牌号（台账为准，供油液分析匹配参考限值的油品类型）
  const ledgerTags = new Set();     // 本次参与判定的台账位号（油液分析出现台账外位号时提示）
  let scopeSkipped = 0;
  const wd = {};                    // 五定齐备计数
  for (const w of WUDING) wd[w.key] = { filled: 0, total: 0, hasCol: ledger.hasCol(w.col) };
  const missingWd = WUDING.filter((w) => !ledger.hasCol(w.col));
  if (missingWd.length) warnings.push(`润滑台账无「${missingWd.map((w) => w.col).join('、')}」列，五定中「${missingWd.map((w) => w.key).join('、')}」齐备率无法计算（不按已齐备处理）`);
  if (!ledger.hasCol('责任人')) warnings.push('润滑台账缺「责任人」列，无法落实五定之「定人」，请在台账中补齐润滑责任人');

  for (const r of ledger) {
    const tag = C.str(r['位号']);
    if (!tag) { warnings.push(`工作表「润滑台账」第${r._row}行 位号为空，已跳过`); continue; }
    if (!inScope(tag)) { scopeSkipped++; continue; }
    ledgerTags.add(tag);
    if (C.str(r['设备名称']) && !nameOf.has(tag)) nameOf.set(tag, C.str(r['设备名称']));
    const oil = C.str(r['油品名称']);
    if (oil) {
      const k = oilKey(oil);
      if (!oilNames.has(k)) oilNames.set(k, new Set());
      oilNames.get(k).add(oil);
      if (!oilOf.has(tag)) oilOf.set(tag, oil);
    }
    for (const w of WUDING) {
      if (!wd[w.key].hasCol) continue;
      wd[w.key].total++;
      if (C.str(r[w.col])) wd[w.key].filled++;
    }
    const rawPeriod = C.str(r['润滑周期']);
    const rawLast = C.str(r['上次加换油日期']);
    const runH = C.parseRunHours(r['润滑周期']);            // 运行小时周期（>168h）
    const periodDays = runH === null ? C.parsePeriod(r['润滑周期']) : null;
    const lastDate = C.normDate(r['上次加换油日期']);

    const base = {
      tag, name: C.str(r['设备名称']), equipNo: C.str(r['设备编号']) || null, part: C.str(r['润滑部位']), oil,
      mode: normMode(r['润滑方式']), spec: C.str(r['油品规格']), owner: C.str(r['责任人']) || null,
      periodRaw: rawPeriod || null, periodType: runH !== null ? 'runHours' : 'calendar',
      periodDays, periodHours: runH,
      lastDate, qty: num(r['加油量'], { sheet: '润滑台账', row: r._row, col: '加油量' }),
      sheet: '润滑台账', row: r._row,
    };

    // ---- 运行小时周期：按累计运行小时判定，不折算成日历天
    if (runH !== null) {
      // 台账与 --run-hours 都给了累计小时：以台账为准；两者不一致时提示核对，不静默取其一
      if (runHoursMap && runHoursMap.has(tag) && C.str(r['累计运行小时'])) {
        const ledgerCum = num(r['累计运行小时'], { sheet: '润滑台账', row: r._row, col: '累计运行小时' });
        const extCum = runHoursMap.get(tag);
        if (ledgerCum !== null && Math.abs(ledgerCum - extCum) >= 1) {
          warnings.push(`工作表「润滑台账」第${r._row}行 ${tag}：台账累计运行小时 ${ledgerCum}h 与 --run-hours ${extCum}h 不一致（差 ${C.round(extCum - ledgerCum, 1)}h），到期判定以台账为准，请核对台账是否需按启停记录更新`);
        }
      }
      const sinceRaw = C.str(r['自上次加换油运行小时']);
      let used = sinceRaw ? num(r['自上次加换油运行小时'], { sheet: '润滑台账', row: r._row, col: '自上次加换油运行小时' }) : null;
      let usedSource = used !== null ? '台账「自上次加换油运行小时」' : null;
      const miss = [];
      if (used === null) {
        const cumRaw = C.str(r['累计运行小时']);
        let cum = cumRaw ? num(r['累计运行小时'], { sheet: '润滑台账', row: r._row, col: '累计运行小时' }) : null;
        let cumSource = cum !== null ? '台账「累计运行小时」' : null;
        if (cum === null && runHoursMap && runHoursMap.has(tag)) {
          cum = runHoursMap.get(tag); cumSource = '--run-hours';
          if (runHoursMap.partial && runHoursMap.partial.has(tag)) warnings.push(`--run-hours 中设备「${tag}」${runHoursMap.partial.get(tag)}，可能偏小，自上次加换油运行小时与到期判定可能偏晚，请核实启停记录后重跑`);
        }
        const lastHRaw = C.str(r['上次加换油时累计小时']);
        const lastH = lastHRaw ? num(r['上次加换油时累计小时'], { sheet: '润滑台账', row: r._row, col: '上次加换油时累计小时' }) : null;
        if (cum === null) miss.push('缺累计运行小时（台账「累计运行小时」列或 --run-hours）');
        if (lastH === null) miss.push('缺「上次加换油时累计小时」（或直接给「自上次加换油运行小时」）');
        if (!miss.length) { used = C.round(cum - lastH, 1); usedSource = `${cumSource} − 上次加换油时累计小时`; }
      }
      if (miss.length) {
        undetermined.push({ ...base, dueDate: null, daysDiff: null, usedHours: null, remainHours: null, reason: `运行小时周期「${rawPeriod}」：${miss.join('；')}` });
        warnings.push(`工作表「润滑台账」第${r._row}行 ${tag}：运行小时周期「${rawPeriod}」${miss.join('；')}，无法判定到期（未按日历天折算，未按默认处理）`);
        continue;
      }
      if (used < 0) {
        undetermined.push({ ...base, dueDate: null, daysDiff: null, usedHours: used, remainHours: null, reason: `自上次加换油运行小时为负（${used}h），累计小时与上次加换油时小时数矛盾` });
        warnings.push(`工作表「润滑台账」第${r._row}行 ${tag}：累计运行小时小于上次加换油时累计小时（差 ${used}h），数据矛盾，无法判定`);
        continue;
      }
      const remainH = C.round(runH - used, 1);
      const item = { ...base, dueDate: null, daysDiff: null, usedHours: used, remainHours: remainH, usedSource };
      if (remainH < 0) {
        const ratio = -remainH / runH;
        overdue.push({ ...item, overdueDays: null, overdueHours: -remainH, overdueRatio: C.round(ratio, 2), level: ratio > 1 ? '严重逾期' : (ratio > 0.2 ? '明显逾期' : '轻微逾期') });
      } else if (remainH <= leadHours) {
        dueSoon.push({ ...item, remainDays: null });
      } else {
        normal.push({ ...item, remainDays: null });
      }
      continue;
    }

    // ---- 日历周期：周期或上次日期缺失/不可解析 → 未判定，绝不按常见周期默认
    const miss = [];
    if (!rawPeriod) miss.push('润滑周期为空');
    else if (periodDays === null) miss.push(`润滑周期「${rawPeriod}」无法解析`);
    if (!rawLast) miss.push('上次加换油日期为空');
    else if (!lastDate) miss.push(`上次加换油日期「${rawLast}」无法解析`);
    if (miss.length) {
      undetermined.push({ ...base, dueDate: null, daysDiff: null, reason: miss.join('；') });
      warnings.push(`工作表「润滑台账」第${r._row}行 ${tag}：${miss.join('；')}，无法判定到期（未按默认周期处理）`);
      continue;
    }

    const dueDate = C.addDays(lastDate, periodDays);
    const daysDiff = C.diffDays(dueDate, date);   // >0 还有几天到期；<0 已逾期
    const item = { ...base, dueDate, daysDiff };
    if (daysDiff < 0) {
      const od = -daysDiff, ratio = od / periodDays;
      overdue.push({ ...item, overdueDays: od, overdueHours: null, overdueRatio: C.round(ratio, 2), level: ratio > 1 ? '严重逾期' : (ratio > 0.2 ? '明显逾期' : '轻微逾期') });
    } else if (daysDiff <= leadDays) {
      dueSoon.push({ ...item, remainDays: daysDiff });
    } else {
      normal.push({ ...item, remainDays: daysDiff });
    }
  }
  if (scope && scopeSkipped) warnings.push(`已按 --equipment 限定范围，台账中 ${scopeSkipped} 行不在范围内未参与判定`);

  const bySort = (x, y) => x.tag.localeCompare(y.tag, 'zh');
  overdue.sort((x, y) => y.overdueRatio - x.overdueRatio || bySort(x, y));
  dueSoon.sort((x, y) => (x.remainDays ?? x.remainHours / 24) - (y.remainDays ?? y.remainHours / 24) || bySort(x, y));
  normal.sort(bySort); undetermined.sort(bySort);

  const wuding = WUDING.map((w) => {
    const o = wd[w.key];
    const rate = o.hasCol && o.total ? C.round(o.filled / o.total * 100, 1) : null;
    return { key: w.key, col: w.col, note: w.note, hasCol: o.hasCol, filled: o.hasCol ? o.filled : null, total: o.hasCol ? o.total : null, rate,
      missing: o.hasCol ? o.total - o.filled : null };
  });

  // ---------------------------------------------------------------- 二、加换油记录 → 消耗统计
  const recRows = C.pickSheet(book, '加换油记录', '加油记录', '换油记录', '润滑记录', '润滑作业记录');
  let consumption = null;
  if (!recRows) {
    warnings.push('输入中未找到「加换油记录」工作表，不输出油品消耗统计');
  } else {
    const recs = C.toRecords(recRows, ['日期', '位号', '油品名称', '数量'], '加换油记录',
      ['类型', '单位', '执行人', '设备名称'], warnings, ALIASES);
    const byOil = new Map(), byEquip = new Map();
    let used = 0, skipped = 0;
    for (const r of recs) {
      const tag = C.str(r['位号']);
      if (!tag) { warnings.push(`工作表「加换油记录」第${r._row}行 位号为空，已跳过`); skipped++; continue; }
      if (!inScope(tag)) { skipped++; continue; }
      const d = C.normDate(r['日期']);
      if (C.str(r['日期']) && !d) warnings.push(`工作表「加换油记录」第${r._row}行 日期「${C.str(r['日期'])}」无法解析，该条不计入期间统计`);
      const oil = C.str(r['油品名称']) || '（未填写油品）';
      const unit = normUnit(r['单位']) || '（未填写单位）';
      const q = num(r['数量'], { sheet: '加换油记录', row: r._row, col: '数量' });
      if (q === null) {
        warnings.push(`工作表「加换油记录」第${r._row}行 ${tag} 数量缺失或无法解析，已按未知计（不按 0 计）`);
      }
      if (oil !== '（未填写油品）') {
        const k = oilKey(oil);
        if (!oilNames.has(k)) oilNames.set(k, new Set());
        oilNames.get(k).add(oil);
      }
      const push = (map, key, extra) => {
        if (!map.has(key)) map.set(key, { key, units: new Map(), records: 0, unknownQty: 0, ...extra });
        const o = map.get(key);
        o.records++;
        if (q === null) { o.unknownQty++; return; }
        if (!o.units.has(unit)) o.units.set(unit, 0);
        o.units.set(unit, o.units.get(unit) + q);
      };
      push(byOil, oil, {});
      push(byEquip, tag, { name: C.str(r['设备名称']) || nameOf.get(tag) || '' });
      used++;
    }

    // 单位混用检查：绝不强行换算
    const mixed = [];
    const flat = (map, label) => [...map.values()].map((o) => {
      const units = [...o.units.entries()].map(([unit, qty]) => ({ unit, qty: C.round(qty, 2) }))
        .sort((x, y) => x.unit.localeCompare(y.unit, 'zh'));
      if (units.length > 1) {
        mixed.push({ scope: label, key: o.key, units: units.map((u) => u.unit) });
        warnings.push(`${label}「${o.key}」的加换油记录存在多种计量单位（${units.map((u) => u.unit).join('、')}），已按单位分别统计，未做换算`);
      }
      return { key: o.key, name: o.name || undefined, records: o.records, unknownQty: o.unknownQty, units };
    }).sort((x, y) => x.key.localeCompare(y.key, 'zh'));

    consumption = {
      records: used, skipped,
      byOil: flat(byOil, '油品'),
      byEquipment: flat(byEquip, '设备'),
      mixedUnits: mixed,
      amount: null,
      priceProvided: !!a.price,
    };

    // ---- 可选：单价折算金额
    if (a.price) {
      let pb;
      try { pb = loadBook(a.price); } catch (e) { throw new Error(`读取单价表失败 ${a.price}: ${e.message}`); }
      const pRows = C.pickSheet(pb, '油品单价', '单价', '价格');
      if (!pRows) {
        warnings.push('单价表中未找到「油品单价」工作表，不折算金额（未使用估计单价）');
      } else {
        const pr = C.toRecords(pRows, ['油品名称', '单价'], '油品单价', ['单位'], warnings, ALIASES);
        const price = new Map();   // oilKey|unit → 单价
        for (const r of pr) {
          const oil = C.str(r['油品名称']);
          if (!oil) continue;
          const p = num(r['单价'], { sheet: '油品单价', row: r._row, col: '单价' });
          if (p === null) { warnings.push(`工作表「油品单价」第${r._row}行 ${oil} 单价无法解析，该油品不折算金额`); continue; }
          price.set(oilKey(oil) + '|' + (normUnit(r['单位']) || ''), p);
        }
        const items = [];
        let total = 0, hasAny = false;
        for (const o of consumption.byOil) {
          for (const u of o.units) {
            const p = price.has(oilKey(o.key) + '|' + u.unit) ? price.get(oilKey(o.key) + '|' + u.unit)
              : (price.has(oilKey(o.key) + '|') ? price.get(oilKey(o.key) + '|') : null);
            if (p === null) {
              warnings.push(`油品「${o.key}」（单位 ${u.unit}）在单价表中未找到匹配单价，金额不折算（未使用估计单价）`);
              items.push({ oil: o.key, unit: u.unit, qty: u.qty, price: null, amount: null, note: '单价表无匹配项' });
              continue;
            }
            const amt = C.round(u.qty * p, 2);
            items.push({ oil: o.key, unit: u.unit, qty: u.qty, price: p, amount: amt, note: '' });
            total += amt; hasAny = true;
          }
        }
        consumption.amount = { items, total: hasAny ? C.round(total, 2) : null, currency: 'CNY' };
      }
    } else {
      warnings.push('未提供油品单价表（--price），消耗金额不折算（未使用估计单价）');
    }
  }

  // 油品名称不一致：同一归一键（去品牌词、空格、标点）有多种写法（台账与加换油记录合并后比对）
  const oilNameConflicts = [];
  for (const [k, set] of oilNames) {
    if (set.size > 1) {
      const names = [...set];
      oilNameConflicts.push({ key: k, names });
      warnings.push(`油品牌号写法不一致，疑似同一油品：${names.join(' / ')}（未自动合并，请人工确认）`);
    }
  }

  // ---------------------------------------------------------------- 三、油液分析
  const oaRows = C.pickSheet(book, '油液分析', '油样分析', '油品化验', '油品分析', '油液监测');
  let oilAnalysis = null;
  if (a['oil-analysis'] && !oaRows) {
    warnings.push('已指定 --oil-analysis，但输入中未找到「油液分析」工作表，该节写「未提供」');
  }
  if (oaRows) {
    const recs = C.toRecords(oaRows, ['位号', '检测项', '检测值'], '油液分析',
      ['取样日期', '限值', '结论', '油品名称', '设备名称'], warnings, ALIASES);
    const abnormal = [], normalItems = [], noLimit = [], refChecked = [], outOfLedger = [];
    const notInLedger = new Set();
    for (const r of recs) {
      const tag = C.str(r['位号']);
      if (!tag) { warnings.push(`工作表「油液分析」第${r._row}行 位号为空，已跳过`); continue; }
      if (!inScope(tag)) continue;
      if (!ledgerTags.has(tag)) notInLedger.add(tag);
      const item = C.str(r['检测项']);
      const value = num(r['检测值'], { sheet: '油液分析', row: r._row, col: '检测值' });
      const rawLimit = C.str(r['限值']);
      const conclusion = C.str(r['结论']);
      const base = {
        tag, name: C.str(r['设备名称']) || nameOf.get(tag) || '', oil: C.str(r['油品名称']) || oilOf.get(tag) || '',
        sampleDate: C.normDate(r['取样日期']), item, value, valueRaw: C.str(r['检测值']),
        limitRaw: rawLimit || null, conclusion: conclusion || null, sheet: '油液分析', row: r._row,
      };
      // 台账外位号（全厂导出混入其他车间、或台账漏登）：单列，不计入本车间异常/正常/无限值计数；仍按厂内限值标出是否超限供核实
      if (!ledgerTags.has(tag)) {
        const l = value !== null && rawLimit ? parseLimit(rawLimit) : null;
        outOfLedger.push({ ...base, limit: l ? l.text : null, exceeded: l ? l.test(value) : null });
        continue;
      }
      if (value === null) {
        noLimit.push({ ...base, reason: '检测值缺失或无法解析，不作异常判定' });
        warnings.push(`工作表「油液分析」第${r._row}行 ${tag} 检测项「${item}」检测值缺失或无法解析，不判异常（未按 0 计）`);
        continue;
      }
      // 无厂内限值 → 仅在 --ref-standard 显式提供参考限值时做"参考比对"（单列、标注非厂内标准），否则只列数值
      let lim = rawLimit ? parseLimit(rawLimit) : null;
      if (!lim) {
        const reason = !rawLimit ? '该检测项未提供厂内判定限值' : `限值「${rawLimit}」无法解析`;
        if (rawLimit && !lim) warnings.push(`工作表「油液分析」第${r._row}行 ${tag} 检测项「${item}」限值「${rawLimit}」无法解析，不按厂内限值判定`);
        const ref = refStd ? findRef(refStd, item, base.oil) : null;
        if (ref) {
          const exceededRef = ref.limit.test(value);
          refChecked.push({ ...base, refLimit: ref.limit.text, refStandard: ref.standard, refItem: ref.item, exceededRef,
            note: `${reason}，按 --ref-standard 参考限值比对：非厂内标准，仅供参考` });
          warnings.push(`工作表「油液分析」第${r._row}行 ${tag} 检测项「${item}」${reason}，已按参考限值（${ref.standard}）比对，结果非厂内标准仅供参考`);
          continue;
        }
        noLimit.push({ ...base, reason: `${reason}，仅列示数值不作异常判定` });
        warnings.push(`工作表「油液分析」第${r._row}行 ${tag} 检测项「${item}」${reason}，仅列示数值不判异常（未引用通用限值）`);
        continue;
      }
      const exceeded = lim.test(value);
      const rec = { ...base, limit: lim.text, exceeded };
      if (exceeded) abnormal.push(rec); else normalItems.push(rec);
    }
    // 全厂导出的油液分析可能混入其他车间设备：照常列示，不静默丢弃，但点名提示
    if (notInLedger.size) warnings.push(`油液分析中位号「${[...notInLedger].join('、')}」不在本次润滑台账内（可能属其他车间或台账漏登），已单列为「台账外油样」，不计入本车间异常/正常计数，请确认是否属本车间`);
    oilAnalysis = {
      provided: true,
      refStandardProvided: !!refStd,
      abnormal: abnormal.sort(bySort),
      normal: normalItems.sort(bySort),
      refChecked: refChecked.sort(bySort),
      noLimit: noLimit.sort(bySort),
      outOfLedger: outOfLedger.sort(bySort),
      note: '油液分析结论以化验室报告为准，本表仅按厂内限值做超限标记，不作故障判定；参考限值比对项非厂内标准，仅供参考。',
    };
  } else {
    oilAnalysis = { provided: false, refStandardProvided: !!refStd, abnormal: [], normal: [], refChecked: [], noLimit: [], outOfLedger: [], note: '未提供油液分析数据。' };
  }

  // ---------------------------------------------------------------- 计数与产出
  const counts = {
    ledgerItems: overdue.length + dueSoon.length + normal.length + undetermined.length,
    overdue: overdue.length,
    dueSoon: dueSoon.length,
    normal: normal.length,
    undetermined: undetermined.length,
    runHoursItems: [...overdue, ...dueSoon, ...normal, ...undetermined].filter((x) => x.periodType === 'runHours').length,
    consumptionRecords: consumption === null ? null : consumption.records,
    oilKinds: consumption === null ? null : consumption.byOil.length,
    mixedUnits: consumption === null ? null : consumption.mixedUnits.length,
    oilNameConflicts: oilNameConflicts.length,
    oaAbnormal: oilAnalysis.provided ? oilAnalysis.abnormal.length : null,
    oaNormal: oilAnalysis.provided ? oilAnalysis.normal.length : null,
    oaRefChecked: oilAnalysis.provided ? oilAnalysis.refChecked.length : null,
    oaRefExceeded: oilAnalysis.provided ? oilAnalysis.refChecked.filter((x) => x.exceededRef).length : null,
    oaNoLimit: oilAnalysis.provided ? oilAnalysis.noLimit.length : null,
    oaOutOfLedger: oilAnalysis.provided ? oilAnalysis.outOfLedger.length : null,
  };

  C.ensureDir(outDir);
  const result = {
    meta: {
      workshop: a.workshop, date, leadDays, leadHours, source: path.basename(a.input),
      equipmentScope: scope, priceProvided: !!a.price, runHoursProvided: !!runHoursMap, refStandardProvided: !!refStd,
      oilAnalysisProvided: oilAnalysis.provided, generatedAt: C.localDateTime(), declaration: DECLARATION,
    },
    counts, wuding, overdue, dueSoon, normal, undetermined,
    consumption, oilAnalysis, oilNameConflicts, warnings,
  };
  fs.writeFileSync(path.join(outDir, 'lube.json'), JSON.stringify(result, null, 2), 'utf8');
  fs.writeFileSync(path.join(outDir, 'lube-report.md'), renderMd(a, result), 'utf8');

  C.emitOk(outDir, { ok: true, out: outDir, date, workshop: a.workshop, counts, warnings });
}

/** 参考限值匹配：检测项归一键相同；参考表填了油品类型时还须与油样油品归一键互含 */
function findRef(list, item, oil) {
  const ik = itemKey(item);
  const ok = oilKey(oil);
  const cands = list.filter((x) => x.itemKey === ik);
  const typed = cands.filter((x) => x.oilKey && ok && (ok.includes(x.oilKey) || x.oilKey.includes(ok)));
  if (typed.length) return typed[0];
  const generic = cands.filter((x) => !x.oilKey);
  return generic.length ? generic[0] : null;
}

/** 限值表达式：「≤8」「>=3」「10」「2~8」「40-60」「不大于 0.1」 */
function parseLimit(raw) {
  const s = C.str(raw).replace(/\s/g, '')
    .replace(/不大于|不超过|最大|max|MAX/g, '≤').replace(/不小于|不低于|最小|min|MIN/g, '≥')
    .replace(/<=/g, '≤').replace(/>=/g, '≥');
  let m = s.match(/^(-?\d+(?:\.\d+)?)[~～至\-—](-?\d+(?:\.\d+)?)$/);
  if (m) { const lo = +m[1], hi = +m[2]; return { text: `${lo}~${hi}`, test: (v) => v < lo || v > hi }; }
  m = s.match(/^([≤≥<>])(-?\d+(?:\.\d+)?)$/);
  if (m) {
    const n = +m[2];
    if (m[1] === '≤') return { text: `≤${n}`, test: (v) => v > n };
    if (m[1] === '<') return { text: `<${n}`, test: (v) => v >= n };
    if (m[1] === '≥') return { text: `≥${n}`, test: (v) => v < n };
    return { text: `>${n}`, test: (v) => v <= n };
  }
  m = s.match(/^(-?\d+(?:\.\d+)?)$/);
  if (m) { const n = +m[1]; return { text: `≤${n}`, test: (v) => v > n }; }
  return null;
}

const periodText = (x) => (x.periodType === 'runHours' ? `运行${C.fmt(x.periodHours)}h` : (x.periodRaw || '—'));
const dueText = (x) => (x.periodType === 'runHours' ? `按运行小时（已运行 ${C.fmt(x.usedHours, 1)}h）` : x.dueDate);
const overdueText = (x) => (x.periodType === 'runHours' ? `${C.fmt(x.overdueHours, 1)}h` : `${x.overdueDays}天`);
const remainText = (x) => (x.periodType === 'runHours' ? `${C.fmt(x.remainHours, 1)}h` : `${x.remainDays}天`);

function renderMd(a, R) {
  const c = R.counts;
  const L = [];
  L.push(`# ${a.workshop} 设备润滑管理报告（基准日 ${R.meta.date}）`);
  L.push('');
  L.push(`数据来源：${R.meta.source}${R.meta.equipmentScope ? ` ｜ 设备范围：${R.meta.equipmentScope.join('、')}` : ''} ｜ 提前提醒：${R.meta.leadDays} 天 / 运行小时周期 ${C.fmt(R.meta.leadHours)} h`);
  L.push(`生成时间：${R.meta.generatedAt}（北京时间）`);
  L.push('');
  L.push(`> ${R.meta.declaration}`);
  L.push('');
  L.push('## 一、到期概览');
  L.push('');
  L.push(C.mdTable(['指标', '数量'], [
    ['台账润滑项', c.ledgerItems], ['已逾期', c.overdue], ['临期（≤' + R.meta.leadDays + '天 / ≤' + C.fmt(R.meta.leadHours) + 'h）', c.dueSoon],
    ['周期内正常', c.normal], ['无法判定', c.undetermined], ['其中按运行小时周期管理', c.runHoursItems],
    ['加换油记录条数', c.consumptionRecords === null ? '—（未提供记录表）' : c.consumptionRecords],
    ['油液分析异常项（超厂内限值）', c.oaAbnormal === null ? '—（未提供油液分析）' : c.oaAbnormal],
    ['油液分析参考比对超限项（非厂内标准）', c.oaRefExceeded === null ? '—' : c.oaRefExceeded],
    ...(c.oaOutOfLedger ? [['台账外油样（不计入上面统计）', c.oaOutOfLedger]] : []),
  ]));
  L.push('## 二、五定齐备率');
  L.push('');
  L.push('_润滑「五定」（定点、定质、定量、定期、定人）按台账对应列是否填写统计；「三过滤」（领油、转桶、加油）属现场作业要求，不从台账判定，见 references/lube-rules.md。_');
  L.push('');
  L.push(C.mdTable(['五定', '对应台账列', '已填/应填', '齐备率', '说明'],
    R.wuding.map((w) => [w.key, w.col, w.hasCol ? `${w.filled}/${w.total}` : '—', w.rate === null ? '—' : C.pct(w.rate), w.hasCol ? (w.missing ? `${w.missing} 项未填` : '齐全') : '台账无此列，无法统计（不按齐备处理）'])));
  L.push('## 三、逾期清单');
  L.push('');
  L.push(C.mdTable(['位号', '设备名称', '润滑部位', '油品', '方式', '周期', '责任人', '上次加换油', '应到期', '逾期', '逾期程度'],
    R.overdue.map((x) => [x.tag, x.name || '—', x.part || '—', x.oil || '—', x.mode || '—', periodText(x), x.owner || '—', x.lastDate || '—', dueText(x), overdueText(x), x.level])));
  L.push('## 四、临期清单');
  L.push('');
  L.push(C.mdTable(['位号', '设备名称', '润滑部位', '油品', '方式', '周期', '责任人', '上次加换油', '应到期', '剩余'],
    R.dueSoon.map((x) => [x.tag, x.name || '—', x.part || '—', x.oil || '—', x.mode || '—', periodText(x), x.owner || '—', x.lastDate || '—', dueText(x), remainText(x)])));
  L.push('## 五、无法判定清单');
  L.push('');
  if (!R.undetermined.length) L.push('_无_\n');
  else {
    L.push('【未判定】以下润滑项因周期、上次加换油日期或运行小时数据缺失/无法解析，未作到期判定；**未按常见周期默认处理**，请补齐台账后重跑。');
    L.push('');
    L.push(C.mdTable(['位号', '设备名称', '润滑部位', '油品', '周期原文', '上次加换油原文', '缺失原因', '出处'],
      R.undetermined.map((x) => [x.tag, x.name || '—', x.part || '—', x.oil || '—', x.periodRaw || '（空）', x.lastDate || '（空）', x.reason, `${x.sheet} 第${x.row}行`])));
  }
  L.push('## 六、油品消耗统计');
  L.push('');
  if (R.consumption === null) L.push('_未提供「加换油记录」数据，不输出油品消耗统计。_\n');
  else {
    L.push('**按油品**');
    L.push('');
    L.push(C.mdTable(['油品牌号', '消耗量（按单位分列）', '记录条数', '数量缺失条数'],
      R.consumption.byOil.map((o) => [o.key, o.units.map((u) => `${C.fmt(u.qty)} ${u.unit}`).join(' ； ') || '—', o.records, o.unknownQty || '—'])));
    L.push('**按设备**');
    L.push('');
    L.push(C.mdTable(['位号', '设备名称', '消耗量（按单位分列）', '记录条数', '数量缺失条数'],
      R.consumption.byEquipment.map((o) => [o.key, o.name || '—', o.units.map((u) => `${C.fmt(u.qty)} ${u.unit}`).join(' ； ') || '—', o.records, o.unknownQty || '—'])));
    if (R.consumption.mixedUnits.length) {
      L.push('【注意】单位混用：以下条目的加换油记录使用了多种计量单位，已按单位分别统计，**未做任何换算**，请核实计量口径：');
      L.push('');
      for (const m of R.consumption.mixedUnits) L.push(`- ${m.scope}「${m.key}」：${m.units.join('、')}`);
      L.push('');
    }
    L.push('**金额折算**');
    L.push('');
    if (!R.consumption.amount) L.push('_未提供油品单价表（`--price`），不折算消耗金额；**未使用任何估计单价**。_\n');
    else {
      L.push(C.mdTable(['油品牌号', '单位', '消耗量', '单价(元)', '金额(元)', '说明'],
        R.consumption.amount.items.map((x) => [x.oil, x.unit, C.fmt(x.qty), C.fmt(x.price), C.fmt(x.amount), x.note || '—'])));
      L.push(`合计金额：${R.consumption.amount.total === null ? '—（无可折算项）' : C.fmt(R.consumption.amount.total) + ' 元'}`);
      L.push('');
    }
  }
  L.push('## 七、油液分析');
  L.push('');
  if (!R.oilAnalysis.provided) L.push('_未提供油液分析数据。_\n');
  else {
    L.push(`_${R.oilAnalysis.note}_`);
    L.push('');
    L.push('**异常项（超出厂内限值）**');
    L.push('');
    L.push(C.mdTable(['位号', '设备名称', '取样日期', '检测项', '检测值', '厂内限值', '化验结论'],
      R.oilAnalysis.abnormal.map((x) => [x.tag, x.name || '—', x.sampleDate || '—', x.item, C.fmt(x.value, 3), x.limit, x.conclusion || '—'])));
    L.push('**参考限值比对项（非厂内标准，仅供参考）**');
    L.push('');
    if (!R.oilAnalysis.refStandardProvided) L.push('_未提供 `--ref-standard` 参考限值表，不作参考比对。_\n');
    else if (!R.oilAnalysis.refChecked.length) L.push('_无（有厂内限值的项不走参考比对；无厂内限值且参考表无对应项的见下表）。_\n');
    else {
      L.push('【注意】以下检测项无厂内限值，按用户提供的参考限值表（国标换油指标或厂家推荐值转录）比对，**结果为非厂内标准、仅供参考，不作为换油或异常判定依据**，须由润滑专业确认厂内指标后复核。');
      L.push('');
      L.push(C.mdTable(['位号', '设备名称', '取样日期', '检测项', '检测值', '参考限值', '参考出处', '参考比对', '化验结论'],
        R.oilAnalysis.refChecked.map((x) => [x.tag, x.name || '—', x.sampleDate || '—', x.item, C.fmt(x.value, 3), x.refLimit, x.refStandard, x.exceededRef ? '超参考限值（非厂内标准）' : '未超参考限值', x.conclusion || '—'])));
    }
    L.push('**无判定限值项（仅列示数值，未作异常判定）**');
    L.push('');
    if (!R.oilAnalysis.noLimit.length) L.push('_无_\n');
    else {
      L.push('【未判定】以下检测项未提供厂内判定限值或数值无法解析，**仅列示数值，不判异常，也未引用任何通用限值替代厂内标准**。');
      L.push('');
      L.push(C.mdTable(['位号', '设备名称', '取样日期', '检测项', '检测值', '限值原文', '说明', '出处'],
        R.oilAnalysis.noLimit.map((x) => [x.tag, x.name || '—', x.sampleDate || '—', x.item, x.valueRaw || '—', x.limitRaw || '（空）', x.reason, `${x.sheet} 第${x.row}行`])));
    }
    L.push('**正常项**');
    L.push('');
    L.push(C.mdTable(['位号', '检测项', '检测值', '厂内限值'],
      R.oilAnalysis.normal.map((x) => [x.tag, x.item, C.fmt(x.value, 3), x.limit])));
    if (R.oilAnalysis.outOfLedger.length) {
      L.push('**台账外油样（不计入本车间统计）**');
      L.push('');
      L.push('【注意】以下油样的位号不在本次润滑台账内（可能属其他车间，或台账漏登），**不计入上面的异常/正常计数**，仅列示供核实；属本车间的请补登润滑台账后重跑。');
      L.push('');
      L.push(C.mdTable(['位号', '设备名称', '取样日期', '检测项', '检测值', '厂内限值', '是否超限', '出处'],
        R.oilAnalysis.outOfLedger.map((x) => [x.tag, x.name || '—', x.sampleDate || '—', x.item, x.valueRaw || '—', x.limit || x.limitRaw || '（空）',
          x.exceeded === null ? '—（无可用限值或检测值）' : x.exceeded ? '超限' : '未超限', `${x.sheet} 第${x.row}行`])));
    }
  }
  L.push('## 八、润滑管理情况说明');
  L.push('');
  L.push('<!-- ANALYSIS_START -->');
  L.push('（由模型依据 references/lube-rules.md 口径撰写 200~350 字，结构：到期情况 → 五定落实与逾期项 → 油品消耗情况 → 油液分析异常 → 下一步安排。数字一律引用 lube.json。）');
  L.push('<!-- ANALYSIS_END -->');
  L.push('');
  if (R.oilNameConflicts.length) {
    L.push('## 附一、油品牌号写法不一致提示');
    L.push('');
    L.push('_以下写法去品牌词、空格与标点后相同，疑似同一油品，脚本**未自动合并**，统计按原写法分列，请人工确认后统一台账口径。_');
    L.push('');
    L.push(C.mdTable(['疑似同一油品的写法'], R.oilNameConflicts.map((x) => [x.names.join(' / ')])));
  }
  if (R.warnings.length) {
    L.push('## 附二、数据提示');
    L.push('');
    for (const w of R.warnings) L.push(`- ${w}`);
    L.push('');
  }
  return L.join('\n');
}

try { main(); } catch (e) { C.fail(e, warnings); }
