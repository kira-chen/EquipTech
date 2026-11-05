#!/usr/bin/env node
'use strict';
/**
 * 备件需求提报与计划生成（仅 Node.js 内置模块）
 * 用法：node scripts/demand.js --input <xlsx[,xlsx2]> --workshop <车间> --period <需求周期> [--out <dir>]
 * 可选：--stock <库存xlsx> --safety <安全库存xlsx> --intransit <在途xlsx>
 *       --method <plan|history|both> --lookback <历史回溯月数> --months <需求周期月数>
 *       --lead-days <建议到货提前天数，默认 15> --min-periods <历史期数下限，默认 6>
 * 产出：<out>/demand.json、demand.md、备件需求表.xlsx、summary.json
 *
 * 中石化口径（见顶层《中石化口径对照.md》）：
 *   - 列名接 SAP PM/MM：检修计划可用 PM 工单/预留导出（订单号、订单描述、基本开始日期、物料、预留数量），
 *     历史消耗可用 MB51 物料凭证导出（物料、过账日期、数量、移动类型：261/201 发料，262/202 冲销按负数）
 *   - 多个输入文件都含同名工作表时合并读取并 warning，不再只取第一个
 *   - 毛需求分列：计划毛需求 / 历史毛需求 / 合计
 *   - 建议到货提前天数与历史期数下限参数化（--lead-days / --min-periods），默认值在 README 写明
 *
 * 硬约束：
 *   1. 历史期数 < 6 → lowConfidence 单列，不按不足数据外推为正常需求
 *   2. 编码/名称不一致 → codeAmbiguity 待确认，绝不自动合并不同编码的物料
 *   3. 未提供 --stock → 毛需求，标注「未扣减在库量」，绝不默认库存为零当作采购量
 *   4. 每项需求必须注明依据，无依据的项只进 noHistory 建议核实区
 *   5. 单位不一致 → 按单位分别统计并 warning，绝不强行换算
 *   6. 净需求 = 毛需求 − 在库 − 在途，负数置 0 并注明「库存充足，本期无需采购」
 */
const fs = require('fs');
const path = require('path');
const { readXlsx, readCsvDir, writeXlsx } = require('./lib/xlsx-lite');
const C = require('./lib/common');

const warnings = [];
const num = C.makeNum(warnings);
const VALUE_OPTS = ['input', 'workshop', 'period', 'out', 'stock', 'safety', 'intransit', 'method', 'lookback', 'months', 'lead-days', 'min-periods'];
const FLAG_OPTS = ['help'];

const STATEMENT = '本清单为车间申报稿，采购数量与定额以物资部门审定为准。';
const DEFAULT_MIN_PERIODS = 6; // 历史消耗期数下限默认值（--min-periods 可调）
const DEFAULT_LEAD_DAYS = 15;  // 建议到货提前天数默认值（--lead-days 可调）
let MIN_PERIODS = DEFAULT_MIN_PERIODS;
let LEAD_DAYS = DEFAULT_LEAD_DAYS;

// 与 spare-parts-inventory-query 的列名别名表对齐；局部 + 共享 SYSTEM_ALIASES（SAP PM/MM 列名），局部优先
// 「数量」只作历史消耗（MB51）的消耗数量别名，不作库存量别名；「设备编号」不作位号别名
const ALIASES = C.mergeAliases({
  '备件编码': ['备件编码', '编码', '物料编码', '物料', '物料号', '物料编号', '物资编码', '备件编号', '料号'],
  '备件名称': ['备件名称', '名称', '物料名称', '物料描述', '物资名称', '备件', '短文本'],
  '规格型号': ['规格型号', '型号', '规格', '型号编号'],
  '单位': ['单位', '计量单位', '基本计量单位'],
  '库存量': ['库存量', '库存', '非限制使用库存', '非限制库存', '可用库存', '现有量', '现有库存', '结存'],
  '安全库存': ['安全库存', '最低库存', '警戒库存', '再订货点', '储备定额'],
  '库位': ['库位', '存放库位', '货位', '存放位置', '库存地点', '仓库', '存放地点'],
  '位号': ['位号', '设备位号', '适用设备', '功能位置', '技术对象'],
  '状态': ['状态', '备件状态'],
  // 检修计划（SAP PM 工单 / 预留导出：订单号、订单描述、基本开始日期、预留数量）
  '项目编号': ['项目编号', '检修项目编号', '计划编号', '项目号', '工单号', '订单号', '订单', '工单', 'PM订单', '维修订单号', '通知单号', '维修通知单号', '预留号', '编号'],
  '项目名称': ['项目名称', '检修项目', '检修内容', '作业内容', '订单描述', '工单描述', '通知单描述', '订单短文本'],
  '计划开工': ['计划开工', '开工日期', '计划开始', '基本开始日期', '计划开始日期', '要求开始', '计划开工日期', '计划日期', '检修日期', '需求日期'],
  '需求数量': ['需求数量', '计划用量', '用量', '需用量', '申请数量', '需求量', '预留数量', '需求数'],
  // 历史消耗（MB51 物料凭证导出：过账日期、数量、移动类型）
  '消耗月份': ['消耗月份', '月份', '期间', '消耗期间', '领用月份', '统计月份', '过账日期', '凭证日期', '出库日期', '领用日期'],
  '消耗数量': ['消耗数量', '消耗量', '领用数量', '出库数量', '领用量', '出库量', '数量'],
  '移动类型': ['移动类型', '业务类型', '移动类型代码'],
  // 在途
  '到货数量': ['到货数量', '在途数量', '采购数量', '订单数量'],
  '预计到货': ['预计到货', '到货日期', '预计到货日期', '交期', '交货日期'],
});
/** SAP 移动类型：发料计正、冲销计负；其他类型（收货/转储等）不计入消耗 */
const MVT_ISSUE = /^(261|201|221|281|291|601)$/;
const MVT_REVERSAL = /^(262|202|222|282|292|602)$/;

function loadBook(p) { return fs.statSync(p).isDirectory() ? readCsvDir(p) : readXlsx(p); }
const norm = (v) => C.str(v).toLowerCase().replace(/[\s\-_]/g, '');

/** 需求周期 → 月数。2026-Q4 → 3；2026-10 → 1；2026-10~2026-12 → 3 */
function periodMonths(period) {
  const s = C.str(period).replace(/\s/g, '');
  if (/^\d{4}-?Q[1-4]$/i.test(s)) return 3;
  if (/^\d{4}[-/年]\d{1,2}月?$/.test(s)) return 1;
  const m = s.match(/^(\d{4})[-/](\d{1,2})[~～至\-]+(\d{4})[-/](\d{1,2})$/);
  if (m) return (+m[3] - +m[1]) * 12 + (+m[4] - +m[2]) + 1;
  if (/^\d{4}(年度|)$/.test(s) && s.length <= 6) return 12;
  if (/^\d{4}[-/]H[12]$/i.test(s)) return 6;
  return null;
}

/** 需求周期 → 起止日期 {from, to}（YYYY-MM-DD）；识别不了返回 null。2026-Q4 → 2026-10-01~2026-12-31 */
function periodRange(period) {
  const s = C.str(period).replace(/\s/g, '');
  const pad = (n) => String(n).padStart(2, '0');
  const last = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mk = (y1, m1, y2, m2) => (m1 >= 1 && m1 <= 12 && m2 >= 1 && m2 <= 12 ? { from: `${y1}-${pad(m1)}-01`, to: `${y2}-${pad(m2)}-${pad(last(y2, m2))}` } : null);
  let m;
  if ((m = s.match(/^(\d{4})-?Q([1-4])$/i))) return mk(+m[1], +m[2] * 3 - 2, +m[1], +m[2] * 3);
  if ((m = s.match(/^(\d{4})[-/年](\d{1,2})月?$/))) return mk(+m[1], +m[2], +m[1], +m[2]);
  if ((m = s.match(/^(\d{4})[-/](\d{1,2})[~～至\-]+(\d{4})[-/](\d{1,2})$/))) return mk(+m[1], +m[2], +m[3], +m[4]);
  if ((m = s.match(/^(\d{4})(年度|年)?$/))) return mk(+m[1], 1, +m[1], 12);
  if ((m = s.match(/^(\d{4})[-/]H([12])$/i))) return m[2] === '1' ? mk(+m[1], 1, +m[1], 6) : mk(+m[1], 7, +m[1], 12);
  return null;
}

function main() {
  const a = C.parseArgs(process.argv.slice(2), VALUE_OPTS, FLAG_OPTS);
  if (!a.input) throw new Error('缺少 --input');
  if (!a.workshop) throw new Error('缺少 --workshop（车间名称）');
  if (!a.period) throw new Error('缺少 --period（需求周期，如 2026-Q4 或 2026-10）');

  const inputs = C.str(a.input).split(',').map((x) => x.trim()).filter(Boolean);
  if (!inputs.length) throw new Error('--input 为空');
  for (const p of inputs) if (!fs.existsSync(p)) throw new Error(`输入文件不存在: ${p}`);

  const method = a.method ? C.str(a.method).toLowerCase() : 'both';
  if (!['plan', 'history', 'both'].includes(method)) throw new Error(`--method 「${a.method}」非法，只能是 plan / history / both`);

  const lookback = a.lookback ? Number(a.lookback) : 12;
  if (a.lookback && (!Number.isFinite(lookback) || lookback <= 0)) throw new Error(`--lookback 「${a.lookback}」不是正数`);

  if (a['lead-days'] !== undefined) {
    const ld = Number(String(a['lead-days']).trim());
    if (!Number.isInteger(ld) || ld < 0) throw new Error(`--lead-days 「${a['lead-days']}」应为非负整数（建议到货提前天数）`);
    LEAD_DAYS = ld;
  }
  if (a['min-periods'] !== undefined) {
    const mp = Number(String(a['min-periods']).trim());
    if (!Number.isInteger(mp) || mp < 1) throw new Error(`--min-periods 「${a['min-periods']}」应为正整数（历史期数下限）`);
    MIN_PERIODS = mp;
  }

  let months = a.months ? Number(a.months) : periodMonths(a.period);
  if (a.months && (!Number.isFinite(months) || months <= 0)) throw new Error(`--months 「${a.months}」不是正数`);
  if (months === null) {
    warnings.push(`需求周期「${a.period}」无法识别月数，历史消耗推算按 1 个月计；如需按季度/年度请显式给 --months`);
    months = 1;
  }

  const outDir = a.out || path.join(path.dirname(inputs[0]), 'spd-out');

  // ---------------- 读取各表（多输入文件：同名工作表全部合并读取，不只取第一个）
  const books = inputs.map((p) => ({ file: path.basename(p), book: loadBook(p) }));
  function findAll(label, ...names) {
    const hits = [];
    for (const b of books) { const r = C.pickSheet(b.book, ...names); if (r) hits.push({ rows: r, file: b.file }); }
    if (hits.length > 1) warnings.push(`${hits.length} 个输入文件均含「${label}」工作表（${hits.map((h) => h.file).join('、')}），已合并读取；同一编码跨文件的数量会累加，请确认不是重复导出`);
    return hits;
  }
  const mergedSources = { plan: [], history: [] };

  // ---------------- 一、检修计划驱动
  const planItems = [];
  let planFound = false;
  if (method === 'plan' || method === 'both') {
    const pfs = findAll('检修计划', '检修计划', '检修计划表', '计划', '检修项目', '工单备件', '预留');
    if (!pfs.length) {
      warnings.push('输入文件中未找到「检修计划」工作表，检修计划驱动的需求未纳入');
    } else {
      planFound = true;
      mergedSources.plan = pfs.map((h) => h.file);
      const recs = pfs.flatMap((pf) => C.toRecords(pf.rows, ['备件编码'], `检修计划（${pf.file}）`,
        ['项目编号', '项目名称', '计划开工', '备件名称', '规格型号', '单位', '需求数量', '位号'], warnings, ALIASES));
      for (const r of recs) {
        const code = C.str(r['备件编码']);
        if (!code) { warnings.push(`工作表「检修计划」第${r._row}行 备件编码为空，已跳过`); continue; }
        const proj = C.str(r['项目编号']);
        const qty = num(r['需求数量'], { sheet: '检修计划', row: r._row, col: '需求数量' });
        if (!proj) {
          warnings.push(`工作表「检修计划」第${r._row}行 备件「${code}」无项目编号，无依据，未进入正式清单`);
          planItems.push({ code, name: C.str(r['备件名称']), spec: C.str(r['规格型号']), unit: C.str(r['单位']),
            qty, project: null, projectName: C.str(r['项目名称']), start: C.normDate(r['计划开工']),
            tag: C.str(r['位号']), _row: r._row, _noBasis: '缺项目编号' });
          continue;
        }
        if (qty === null) {
          planItems.push({ code, name: C.str(r['备件名称']), spec: C.str(r['规格型号']), unit: C.str(r['单位']),
            qty: null, project: proj, projectName: C.str(r['项目名称']), start: C.normDate(r['计划开工']),
            tag: C.str(r['位号']), _row: r._row, _noBasis: '需求数量为空或无法解析' });
          continue;
        }
        planItems.push({ code, name: C.str(r['备件名称']), spec: C.str(r['规格型号']), unit: C.str(r['单位']),
          qty, project: proj, projectName: C.str(r['项目名称']), start: C.normDate(r['计划开工']),
          tag: C.str(r['位号']), _row: r._row, _noBasis: null });
      }
    }
  }

  // ---------------- 二、历史消耗驱动
  const histAgg = new Map(); // key: code|unit
  let mb51Window = null;     // MB51 导出窗口（无领用月按 0 计）
  let histFound = false;
  if (method === 'history' || method === 'both') {
    const hfs = findAll('历史消耗', '历史消耗', '消耗记录', '消耗', '领用记录', '出库记录', '物料凭证', 'MB51');
    if (!hfs.length) {
      warnings.push('输入文件中未找到「历史消耗」工作表，历史消耗驱动的需求未纳入');
    } else {
      histFound = true;
      mergedSources.history = hfs.map((h) => h.file);
      const recs = hfs.flatMap((hf) => C.toRecords(hf.rows, ['备件编码'], `历史消耗（${hf.file}）`,
        ['备件名称', '规格型号', '单位', '消耗月份', '消耗数量', '位号', '移动类型'], warnings, ALIASES));
      let mvtSkipped = 0, mvtReversed = 0;
      // MB51 物料凭证只记发生的业务：导出窗口（全表过账日期的首末月，含 101 收货等不计消耗的行）内没有领用凭证的月份就是当月没领，按 0 期计；
      // 汇总式消耗表（一行一个月）没列的月份可能是没统计，仍只数有值的期（口径不变）
      const mbMonths = new Set();
      // 数量无法解析的行所在月份（key: code|unit）：该月不按 0 补齐、不计入期数，依据栏写明剔除了几期
      const badMonths = new Map();
      for (const r of recs) {
        const code = C.str(r['备件编码']);
        if (!code) { warnings.push(`工作表「历史消耗」第${r._row}行 备件编码为空，已跳过`); continue; }
        // 月份：支持 2026-08 / 2026年8月，也支持 MB51 的过账日期（取到月）
        const rawMon = C.str(r['消耗月份']).replace(/\s/g, '');
        let mon = rawMon.replace(/年/, '-').replace(/月$/, '');
        const asDate = /^\d{4}-?\d{1,2}$/.test(mon) ? null : C.normDate(r['消耗月份']);
        if (asDate) mon = asDate.slice(0, 7);
        else if (/^\d{4}-\d{1}$/.test(mon)) mon = mon.replace(/-(\d)$/, '-0$1');
        let qty = num(r['消耗数量'], { sheet: '历史消耗', row: r._row, col: '消耗数量' });
        const unit = C.str(r['单位']);
        const mvt = C.str(r['移动类型']);
        if (mvt && /^\d{4}-\d{2}$/.test(mon)) mbMonths.add(mon);
        if (mvt) {
          if (MVT_REVERSAL.test(mvt)) { if (qty !== null) qty = -Math.abs(qty); mvtReversed++; }
          else if (MVT_ISSUE.test(mvt)) { if (qty !== null) qty = Math.abs(qty); }
          else { mvtSkipped++; continue; }
        }
        if (!mon) { warnings.push(`工作表「历史消耗」第${r._row}行 备件「${code}」消耗月份为空，该条不计入期数`); continue; }
        if (qty === null) {
          warnings.push(`工作表「历史消耗」第${r._row}行 备件「${code}」消耗数量无法解析，未按 0 计，该条不计入`);
          if (/^\d{4}-\d{2}$/.test(mon)) { const bk = code + '|' + unit; if (!badMonths.has(bk)) badMonths.set(bk, new Set()); badMonths.get(bk).add(mon); }
          continue;
        }
        const key = code + '|' + unit;
        if (!histAgg.has(key)) {
          histAgg.set(key, { code, unit, name: C.str(r['备件名称']), spec: C.str(r['规格型号']),
            tag: C.str(r['位号']), periods: new Map(), rows: [], mb51: false, zeroMonths: new Set(), badMonths: new Set() });
        }
        const g = histAgg.get(key);
        if (!g.name) g.name = C.str(r['备件名称']);
        if (!g.spec) g.spec = C.str(r['规格型号']);
        g.periods.set(mon, (g.periods.get(mon) || 0) + qty);
        g.rows.push(r._row);
        if (mvt) g.mb51 = true;
      }
      for (const [bk, ms] of badMonths) { const g = histAgg.get(bk); if (g) for (const m of ms) if (!g.periods.has(m)) g.badMonths.add(m); }
      if (mbMonths.size) {
        const sorted = [...mbMonths].sort();
        const toIdx = (m) => { const [y, mm] = m.split('-').map(Number); return y * 12 + mm - 1; };
        const toMon = (i) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
        let lo = toIdx(sorted[0]), hi = toIdx(sorted[sorted.length - 1]);
        // 窗口最后一个月是运行当月：未满月，不计入期数，该月领用也不计入月均（否则按整月摊会压低月均）。
        // 窗口只有当月时同样剔除，此时没有可用的历史月，按历史不足处理
        const cur = C.localDate().slice(0, 7);
        if (toMon(hi) === cur) {
          hi--;
          let dropped = 0;
          for (const g of histAgg.values()) if (g.mb51 && g.periods.has(cur)) { g.periods.delete(cur); dropped++; }
          if (hi >= lo) warnings.push(`物料凭证（MB51）最后一个月 ${cur} 为当月、未满月，不计入期数与月均${dropped ? `（涉及 ${dropped} 个物料的当月领用）` : ''}`);
          else warnings.push(`物料凭证（MB51）只有当月 ${cur} 的数据，当月未满月，不计入期数与月均${dropped ? `（涉及 ${dropped} 个物料）` : ''}；没有可用的历史月份，无法按月均推算，请补充此前月份的物料凭证`);
        }
        if (hi >= lo) {
          let filled = 0;
          for (const g of histAgg.values()) {
            if (!g.mb51) continue;
            for (let i = lo; i <= hi; i++) { const m = toMon(i); if (!g.periods.has(m) && !g.badMonths.has(m)) { g.periods.set(m, 0); g.zeroMonths.add(m); } }
            if (g.zeroMonths.size) filled++;
          }
          mb51Window = { from: toMon(lo), to: toMon(hi), months: hi - lo + 1 };
          if (filled) warnings.push(`物料凭证（MB51）导出窗口 ${toMon(lo)}~${toMon(hi)} 共 ${hi - lo + 1} 个月，${filled} 个物料窗口内无领用的月份按 0 计入期数（凭证表没有领用凭证即当月未领用）`);
        }
      }
      if (mvtReversed) warnings.push(`历史消耗含 ${mvtReversed} 行冲销（移动类型 262/202 等），已按负数抵减当月消耗`);
      if (mvtSkipped) warnings.push(`历史消耗含 ${mvtSkipped} 行非发料/非冲销移动类型（如 101 收货、311 转储），不计入消耗`);
    }
  }

  if (method === 'plan' && !planFound) throw new Error('--method plan 需要「检修计划」工作表，但输入文件中未找到');
  if (method === 'history' && !histFound) throw new Error('--method history 需要「历史消耗」工作表，但输入文件中未找到');
  if (method === 'both' && !planFound && !histFound) throw new Error('输入文件中既无「检修计划」也无「历史消耗」工作表，无法推算需求');

  // ---------------- 安全库存标准（可选）
  const safetyMap = new Map();
  if (a.safety) {
    if (!fs.existsSync(a.safety)) throw new Error(`安全库存标准表不存在: ${a.safety}`);
    const sr = C.pickSheet(loadBook(a.safety), '安全库存', '安全库存标准', '定额', '库存标准');
    if (!sr) warnings.push('安全库存文件中未找到「安全库存」工作表，需求推算未加安全库存');
    else {
      const ss = C.toRecords(sr, ['备件编码'], '安全库存', ['备件名称', '单位', '安全库存'], warnings, ALIASES);
      for (const r of ss) {
        const code = C.str(r['备件编码']); if (!code) continue;
        safetyMap.set(code, { qty: num(r['安全库存'], { sheet: '安全库存', row: r._row, col: '安全库存' }), unit: C.str(r['单位']) });
      }
    }
  }

  // ---------------- 库存现状（可选，核心硬约束 3）
  let stockMap = null;
  if (a.stock) {
    if (!fs.existsSync(a.stock)) throw new Error(`库存现状表不存在: ${a.stock}`);
    const kr = C.pickSheet(loadBook(a.stock), '库存表', '库存', '备件库存');
    if (!kr) warnings.push('库存文件中未找到「库存表」工作表，需求量按毛需求给出，未扣减在库量');
    else {
      stockMap = new Map();
      const kk = C.toRecords(kr, ['备件编码'], '库存表', ['备件名称', '规格型号', '单位', '库存量', '安全库存', '库位'], warnings, ALIASES);
      for (const r of kk) {
        const code = C.str(r['备件编码']); if (!code) continue;
        const q = num(r['库存量'], { sheet: '库存表', row: r._row, col: '库存量' });
        if (q !== null && q < 0) warnings.push(`工作表「库存表」第${r._row}行 备件「${code}」库存量为负（${q}），请核实台账`);
        stockMap.set(code, { qty: q, unit: C.str(r['单位']), loc: C.str(r['库位']), _row: r._row });
        if (!safetyMap.has(code)) {
          const s = num(r['安全库存'], { sheet: '库存表', row: r._row, col: '安全库存' });
          if (s !== null) safetyMap.set(code, { qty: s, unit: C.str(r['单位']) });
        }
      }
    }
  }
  if (!a.stock) warnings.push('未提供库存现状表（--stock），输出为毛需求，未扣减在库量，不得直接作为采购量');

  // ---------------- 在途（可选）
  let transitMap = null;
  if (a.intransit) {
    if (!fs.existsSync(a.intransit)) throw new Error(`在途采购表不存在: ${a.intransit}`);
    const ir = C.pickSheet(loadBook(a.intransit), '在途采购', '在途', '采购在途', '采购');
    if (!ir) warnings.push('在途文件中未找到「在途采购」工作表，净需求未扣减在途量');
    else {
      transitMap = new Map();
      const ii = C.toRecords(ir, ['备件编码'], '在途采购', ['备件名称', '到货数量', '预计到货', '单位'], warnings, ALIASES);
      for (const r of ii) {
        const code = C.str(r['备件编码']); if (!code) continue;
        const q = num(r['到货数量'], { sheet: '在途采购', row: r._row, col: '到货数量' });
        const eta = C.normDate(r['预计到货']);
        if (r['预计到货'] && !eta) warnings.push(`工作表「在途采购」第${r._row}行 预计到货「${C.str(r['预计到货'])}」无法解析`);
        if (!transitMap.has(code)) transitMap.set(code, { qty: null, unit: C.str(r['单位']), arrivals: [] });
        const t = transitMap.get(code);
        t.arrivals.push({ qty: q, eta, unit: C.str(r['单位']) });
        if (q !== null) t.qty = (t.qty === null ? 0 : t.qty) + q;
      }
    }
  }

  // ---------------- 组装需求项
  const items = [];          // 正式清单（有依据）
  const lowConfidence = [];  // 历史期数不足
  const noHistory = [];      // 无依据，只进建议核实区

  // 计划驱动：按 --period 起止日期核对「基本开始日期（计划开工）」
  //  - 晚于周期末 → 属后续周期，单列 planOutOfPeriod，不计入本期；
  //  - 早于周期初 → 工单/预留仍未关闭、料未领出，仍是本期要备的料，计入并标记 startBeforePeriod、warning 提示核实；
  //  - 无日期 → 无法核对，计入并 warning。周期识别不了起止日期时不过滤并 warning。
  const range = periodRange(a.period);
  const today = C.localDate();
  const planOutOfPeriod = [], beforePeriod = [], noStart = [], passed = [];
  if (planItems.length && !range) warnings.push(`需求周期「${a.period}」无法识别起止日期，检修计划需求未按周期过滤（全部计入），请核对基本开始日期是否都在本期`);
  for (const p of planItems) {
    if (!p._noBasis && range && p.start && p.start > range.to) {
      planOutOfPeriod.push({ code: p.code, name: p.name, spec: p.spec, unit: p.unit, qty: p.qty, project: p.project, projectName: p.projectName,
        tag: p.tag, planStart: p.start, row: p._row, reason: `基本开始日期 ${p.start} 晚于需求周期末 ${range.to}，属后续周期`, note: '未计入本期需求' });
      continue;
    }
    if (p._noBasis) {
      noHistory.push({ code: p.code, name: p.name, spec: p.spec, unit: p.unit, qty: p.qty,
        source: '检修计划', reason: p._noBasis,
        note: '无有效依据，未进入正式清单，请补齐后重新提报', row: p._row });
      continue;
    }
    const startBefore = !!(range && p.start && p.start < range.from);
    if (startBefore) beforePeriod.push(`${p.code}（${p.project}，${p.start}）`);
    if (!p.start) noStart.push(`${p.code}（${p.project}）`);
    const sa = p.start ? C.addDays(p.start, -LEAD_DAYS) : null;
    if (sa && sa < today) passed.push(`${p.code}（${p.project}，建议到货 ${sa}）`);
    items.push({
      code: p.code, name: p.name, spec: p.spec, unit: p.unit,
      grossQty: p.qty, source: '检修计划', startBeforePeriod: startBefore, arrivalPassed: sa ? sa < today : null,
      basis: `检修项目 ${p.project}${p.projectName ? '（' + p.projectName + '）' : ''}`,
      project: p.project, projectName: p.projectName, tag: p.tag,
      suggestArrival: sa,
      planStart: p.start, periodsUsed: null, monthlyAvg: null, safetyQty: null,
      formula: `检修计划用量 ${C.fmt(p.qty)}`,
    });
  }

  if (planOutOfPeriod.length) warnings.push(`${planOutOfPeriod.length} 项检修计划需求的基本开始日期晚于需求周期「${a.period}」（${range.from}~${range.to}），属后续周期，已单列、未计入本期：${planOutOfPeriod.map((x) => `${x.code}（${x.project}，${x.planStart}）`).join('、')}`);
  if (beforePeriod.length) warnings.push(`${beforePeriod.length} 项检修计划需求的基本开始日期早于需求周期，工单/预留尚未关闭，仍计入本期需求，请核实工单是否仍要执行：${beforePeriod.join('、')}`);
  if (noStart.length) warnings.push(`${noStart.length} 项检修计划需求无基本开始日期（计划开工），无法核对是否在需求周期内，已计入本期：${noStart.join('、')}`);
  if (passed.length) warnings.push(`${passed.length} 项检修计划需求的建议到货日已过（早于今天 ${today}），请尽快催办或与计划员确认开工日期：${passed.join('、')}`);

  // 历史驱动
  for (const g of histAgg.values()) {
    const months12 = [...g.periods.keys()].sort();
    const used = months12.slice(-Math.round(lookback));
    const n = used.length;
    const total = used.reduce((s, m) => s + g.periods.get(m), 0);
    const avg = n > 0 ? C.round(total / n, 2) : null;
    const safety = safetyMap.has(g.code) ? safetyMap.get(g.code).qty : null;
    const gross = avg === null ? null : C.round(avg * months + (safety === null ? 0 : safety), 2);
    const zeroUsed = used.filter((m) => g.zeroMonths.has(m)).length;
    const badUsed = n ? [...g.badMonths].filter((m) => m >= used[0] && m <= used[n - 1]).length : 0;
    const basis = `历史消耗 ${n} 期（${used[0] || '—'}~${used[n - 1] || '—'}${zeroUsed ? `，其中无领用月按 0 计 ${zeroUsed} 期` : ''}${badUsed ? `，数量无法解析剔除 ${badUsed} 期` : ''}）`;
    const row = {
      code: g.code, name: g.name, spec: g.spec, unit: g.unit,
      grossQty: gross, source: '历史消耗', basis,
      project: null, projectName: null, tag: g.tag,
      suggestArrival: null, planStart: null,
      periodsUsed: n, monthlyAvg: avg, safetyQty: safety,
      formula: `月均 ${C.fmt(avg)} × ${months} 个月${safety === null ? '（未提供安全库存标准，未加安全库存）' : ' + 安全库存 ' + C.fmt(safety)} = ${C.fmt(gross)}`,
    };
    if (n < MIN_PERIODS) {
      warnings.push(`备件「${g.code}」历史消耗仅 ${n} 期（少于 ${MIN_PERIODS} 期），推算量置信度低，已单列不进正式清单`);
      lowConfidence.push({ ...row,
        reason: `历史消耗仅 ${n} 期，少于 ${MIN_PERIODS} 期`,
        note: '期数不足，推算量仅供参考，未按不足的数据外推作为正常需求；请人工核定或补齐历史记录' });
    } else {
      items.push(row);
    }
  }

  // ---------------- 编码/名称不一致待确认（硬约束 2：绝不自动合并）
  const codeAmbiguity = [];
  const allRefs = [...items, ...lowConfidence, ...noHistory];
  // (a) 同名不同编码
  const byName = new Map();
  for (const x of allRefs) { if (!x.name) continue; const k = norm(x.name) + '|' + norm(x.spec || ''); if (!byName.has(k)) byName.set(k, []); byName.get(k).push(x); }
  for (const list of byName.values()) {
    const codes = [...new Set(list.map((x) => x.code))];
    if (codes.length > 1) {
      codeAmbiguity.push({ type: '同名同规格多编码', name: list[0].name, spec: list[0].spec || null, codes,
        items: codes.map((c) => { const f = list.find((x) => x.code === c); return { code: c, name: f.name, spec: f.spec, unit: f.unit, source: f.source }; }),
        note: '名称规格相同但编码不同，未自动合并，请确认是否为同一物料' });
      warnings.push(`备件「${list[0].name}」对应 ${codes.length} 个编码（${codes.join('、')}），未自动合并，请按编码确认`);
    }
  }
  // (b) 同编码多名称
  const byCode = new Map();
  for (const x of allRefs) { const k = x.code; if (!byCode.has(k)) byCode.set(k, []); byCode.get(k).push(x); }
  for (const [code, list] of byCode) {
    const names = [...new Set(list.map((x) => C.str(x.name)).filter(Boolean))];
    if (names.length > 1) {
      codeAmbiguity.push({ type: '同编码多名称', code, name: names[0], spec: null, codes: [code], names,
        items: list.map((x) => ({ code: x.code, name: x.name, spec: x.spec, unit: x.unit, source: x.source })),
        note: '同一编码在不同来源表中名称不一致，未自动归并，请核对台账' });
      warnings.push(`编码「${code}」在不同表中名称不一致（${names.join('、')}），未自动归并，请核对台账`);
    }
  }

  // ---------------- 单位不一致（硬约束 5：分别统计并 warning，绝不换算）
  const unitConflicts = [];
  for (const [code, list] of byCode) {
    const units = [...new Set(list.map((x) => C.str(x.unit)).filter(Boolean))];
    if (units.length > 1) {
      unitConflicts.push({ code, name: list[0].name, units,
        items: units.map((u) => ({ unit: u,
          qty: list.filter((x) => C.str(x.unit) === u).reduce((s, x) => (x.grossQty === null ? s : s + x.grossQty), 0),
          sources: [...new Set(list.filter((x) => C.str(x.unit) === u).map((x) => x.source))].join('、') })),
        note: '单位不一致，已按单位分别统计，未做任何换算' });
      warnings.push(`备件「${code}」存在 ${units.length} 种单位（${units.join('、')}），已按单位分别统计，未强行换算`);
    }
  }

  // ---------------- 毛需求汇总（按 编码+单位 分别汇总，绝不跨单位合并）
  const grossMap = new Map();
  for (const it of items) {
    const key = it.code + '|' + C.str(it.unit);
    if (!grossMap.has(key)) grossMap.set(key, { code: it.code, name: it.name, spec: it.spec, unit: it.unit, gross: null, grossPlan: null, grossHistory: null, bases: [], sources: [] });
    const g = grossMap.get(key);
    if (it.grossQty !== null) {
      g.gross = C.round((g.gross === null ? 0 : g.gross) + it.grossQty, 2);
      if (it.source === '检修计划') g.grossPlan = C.round((g.grossPlan === null ? 0 : g.grossPlan) + it.grossQty, 2);
      else g.grossHistory = C.round((g.grossHistory === null ? 0 : g.grossHistory) + it.grossQty, 2);
    }
    g.bases.push(it.basis);
    if (!g.sources.includes(it.source)) g.sources.push(it.source);
    if (!g.name) g.name = it.name;
    if (!g.spec) g.spec = it.spec;
  }

  // ---------------- 净需求（硬约束 3 与 6）
  const netDemand = [];
  for (const g of grossMap.values()) {
    const st = stockMap ? stockMap.get(g.code) : undefined;
    const tr = transitMap ? transitMap.get(g.code) : undefined;
    const onHand = stockMap ? (st ? st.qty : 0) : null;
    const onHandNote = !stockMap ? '未提供库存表，未扣减在库量'
      : (st ? (st.qty === null ? '库存量为空或无法解析，未扣减' : null) : '库存表中无此编码，按未入库处理（在库 0），请核实是否漏登');
    if (stockMap && !st) warnings.push(`备件「${g.code}」在库存表中无记录，净需求按在库 0 计算，请核实台账是否漏登`);
    const inTransit = transitMap ? (tr ? tr.qty : 0) : null;

    // 单位不一致不扣减
    let unitMismatch = null;
    if (st && C.str(st.unit) && C.str(g.unit) && C.str(st.unit) !== C.str(g.unit)) {
      unitMismatch = `需求单位「${g.unit}」与库存单位「${st.unit}」不一致，未做换算，未扣减在库量`;
      warnings.push(`备件「${g.code}」${unitMismatch}`);
    }

    let net = null, netNote = null, sufficient = false;
    if (g.gross === null) {
      netNote = '毛需求无法计算（数量缺失），未按 0 处理';
    } else if (!stockMap) {
      net = null;
      netNote = '未提供库存表（--stock），本项为毛需求，**未扣减在库量**，不得直接作为采购量';
    } else if (unitMismatch) {
      net = null;
      netNote = unitMismatch;
    } else if (st && st.qty === null) {
      net = null;
      netNote = '库存量为空或无法解析，无法计算净需求，未按库存为 0 处理';
    } else {
      const raw = C.round(g.gross - (onHand || 0) - (inTransit || 0), 2);
      if (raw <= 0) { net = 0; sufficient = true; netNote = '库存充足，本期无需采购'; }
      else net = raw;
    }
    netDemand.push({
      code: g.code, name: g.name, spec: g.spec, unit: g.unit,
      gross: g.gross, grossPlan: g.grossPlan, grossHistory: g.grossHistory, onHand, onHandNote, inTransit,
      inTransitNote: transitMap ? null : '未提供在途采购表，未扣减在途量',
      net, netNote, sufficient, sources: g.sources.join('、'), basis: g.bases.join('；'),
      formula: stockMap && net !== null ? `${C.fmt(g.gross)} − 在库 ${C.fmt(onHand)} − 在途 ${C.fmt(inTransit)} = ${C.fmt(net)}` : null,
    });
  }
  netDemand.sort((x, y) => (y.net === null ? -1 : y.net) - (x.net === null ? -1 : x.net));

  const counts = {
    items: items.length,
    itemsFromPlan: items.filter((x) => x.source === '检修计划').length,
    itemsFromHistory: items.filter((x) => x.source === '历史消耗').length,
    netDemand: netDemand.length,
    needPurchase: stockMap ? netDemand.filter((x) => x.net !== null && x.net > 0).length : null,
    sufficient: stockMap ? netDemand.filter((x) => x.sufficient).length : null,
    lowConfidence: lowConfidence.length,
    codeAmbiguity: codeAmbiguity.length,
    noHistory: noHistory.length,
    unitConflicts: unitConflicts.length,
    planOutOfPeriod: planOutOfPeriod.length,
    arrivalPassed: items.filter((x) => x.arrivalPassed).length,
  };

  // ---------------- 产出
  C.ensureDir(outDir);
  const grossOnly = !stockMap;
  const result = {
    meta: {
      workshop: C.str(a.workshop), period: C.str(a.period), months, method, lookback: Math.round(lookback),
      sources: inputs.map((p) => path.basename(p)),
      stockProvided: !!stockMap, safetyProvided: safetyMap.size > 0, intransitProvided: !!transitMap,
      grossOnly, minPeriods: MIN_PERIODS, leadDays: LEAD_DAYS, mergedSources, mb51Window, periodRange: range, today,
      generatedAt: C.localDateTime(),
      statement: STATEMENT,
      demandKind: grossOnly ? '毛需求（未扣减在库量）' : '净需求（已扣减在库与在途）',
    },
    counts, items, netDemand, lowConfidence, codeAmbiguity, noHistory, unitConflicts, planOutOfPeriod, warnings,
  };
  fs.writeFileSync(path.join(outDir, 'demand.json'), JSON.stringify(result, null, 2), 'utf8');

  const methodText = { plan: '仅按检修计划', history: '仅按历史消耗', both: '检修计划与历史消耗合并' }[method];
  const L = [];
  L.push(`# ${C.str(a.workshop)} 备件需求申报稿（${C.str(a.period)}）`);
  L.push('');
  L.push(`数据来源：${result.meta.sources.join('、')}　推算口径：${methodText}`);
  L.push(`需求周期：${C.str(a.period)}（按 ${months} 个月计）　历史回溯：${Math.round(lookback)} 个月　历史期数下限：${MIN_PERIODS} 期　建议到货提前：${LEAD_DAYS} 天`);
  L.push(`生成时间：${C.localDateTime()}（北京时间）`);
  L.push('');
  L.push(`> ${STATEMENT}`);
  L.push('');

  L.push('## 一、需求概况与口径说明');
  L.push('');
  L.push(C.mdTable(['项目', '数值'], [
    ['正式清单项数', C.fmt(counts.items)],
    ['　其中检修计划驱动', C.fmt(counts.itemsFromPlan)],
    ['　其中历史消耗驱动', C.fmt(counts.itemsFromHistory)],
    ['净需求行数（按编码+单位）', C.fmt(counts.netDemand)],
    ['需采购项数', C.fmt(counts.needPurchase)],
    ['库存充足无需采购项数', C.fmt(counts.sufficient)],
    ['低置信度项（期数不足）', C.fmt(counts.lowConfidence)],
    ['编码待确认组数', C.fmt(counts.codeAmbiguity)],
    ['无依据待核实项', C.fmt(counts.noHistory)],
    ['单位不一致项', C.fmt(counts.unitConflicts)],
  ]));
  L.push('**口径说明**');
  L.push('');
  L.push(`- 推算方式：${methodText}。检修计划驱动按项目（PM 工单/预留）备件清单直接取用量，建议到货 = 计划开工 − ${LEAD_DAYS} 天${a['lead-days'] === undefined ? '（默认值，厂内采购周期不同时用 --lead-days 调整）' : ''}；历史消耗驱动按「月均消耗 × ${months} 个月 + 安全库存」。`);
  if (planFound) L.push(range ? `- 检修计划需求按需求周期 ${range.from}~${range.to} 核对基本开始日期：晚于周期末的属后续周期，单列于第二节末、不计入本期；早于周期初而工单/预留未关闭的仍计入本期并提示核实；建议到货日已过的标「已过，请催办」。` : `- 需求周期「${C.str(a.period)}」无法识别起止日期，检修计划需求未按周期过滤。`);
  L.push(`- 历史消耗期数少于 ${MIN_PERIODS} 期的备件不进正式清单，单列于第四节，**未按不足的数据外推当作正常需求**${a['min-periods'] === undefined ? '（期数下限为默认值，可用 --min-periods 调整）' : ''}。`);
  if (mb51Window) L.push(`- 历史消耗来自 MB51 物料凭证：导出窗口 ${mb51Window.from}~${mb51Window.to}（${mb51Window.months} 个月），窗口内没有领用凭证的月份按 0 计入期数，月均按窗口月数摊；运行当月未满月不计入。`);
  if (mergedSources.plan.length > 1 || mergedSources.history.length > 1) L.push(`- 多个输入文件含同名工作表，已合并读取：检修计划来自 ${mergedSources.plan.join('、') || '—'}；历史消耗来自 ${mergedSources.history.join('、') || '—'}。`);
  L.push('- 毛需求分列为「计划毛需求」与「历史毛需求」，合计后再扣减在库与在途。');
  if (grossOnly) {
    L.push('- **本清单未提供库存现状表（`--stock`），所列数量为毛需求，未扣减在库量，不得直接作为采购量。**');
  } else {
    L.push('- 净需求 = 毛需求 − 在库量 − 在途量；结果为负时置 0 并注明「库存充足，本期无需采购」。');
    if (!transitMap) L.push('- 未提供在途采购表（`--intransit`），净需求未扣减在途量。');
  }
  if (!safetyMap.size) L.push('- 未提供安全库存标准（`--safety`），历史消耗推算未加安全库存。');
  L.push('- 单位不一致的备件按单位分别统计，**未做任何换算**。');
  L.push('- 每项需求均注明依据（检修项目编号或历史消耗期数）；无依据的项只列入第六节建议核实区。');
  L.push('');

  L.push('## 二、需求明细');
  L.push('');
  if (!items.length) L.push('_本期无有依据的需求项。_\n');
  else {
    L.push(C.mdTable(['备件编码', '名称', '规格型号', '单位', '毛需求量', '来源', '依据', '推算式', '建议到货'],
      items.map((x) => [x.code, x.name || '—', x.spec || '—', x.unit || '—', C.fmt(x.grossQty), x.source, x.basis, x.formula,
        x.suggestArrival ? `${x.suggestArrival}${x.arrivalPassed ? '（已过，请催办）' : ''}` : '—'])));
  }
  if (planOutOfPeriod.length) {
    L.push(`**需求周期外的检修计划需求（基本开始日期晚于 ${range.to}，单列，不计入本期）**`);
    L.push('');
    L.push(C.mdTable(['备件编码', '名称', '单位', '数量', '订单/项目', '基本开始日期', '说明'],
      planOutOfPeriod.map((x) => [x.code, x.name || '—', x.unit || '—', C.fmt(x.qty), `${x.project}${x.projectName ? '（' + x.projectName + '）' : ''}`, x.planStart, x.reason])));
  }

  L.push(`## 三、${grossOnly ? '毛需求汇总（未扣减在库量）' : '净需求'}`);
  L.push('');
  if (grossOnly) {
    L.push('> **未提供库存现状表，以下为毛需求，未扣减在库量与在途量，不得直接作为采购量。** 请补充库存表后重新推算，或由物资部门按实际库存核减。');
    L.push('');
  }
  if (!netDemand.length) L.push('_无_\n');
  else {
    L.push(C.mdTable(['备件编码', '名称', '单位', '计划毛需求', '历史毛需求', '毛需求合计', '在库', '在途', '净需求', '说明'],
      netDemand.map((x) => [x.code, x.name || '—', x.unit || '—', C.fmt(x.grossPlan), C.fmt(x.grossHistory), C.fmt(x.gross), C.fmt(x.onHand), C.fmt(x.inTransit), C.fmt(x.net),
        x.netNote || x.onHandNote || '—'])));
  }

  L.push('## 四、低置信度项（历史期数不足，单列不进正式清单）');
  L.push('');
  if (!lowConfidence.length) L.push('_无_\n');
  else {
    L.push(C.mdTable(['备件编码', '名称', '单位', '参考推算量', '期数', '月均', '原因', '处理'],
      lowConfidence.map((x) => [x.code, x.name || '—', x.unit || '—', C.fmt(x.grossQty), C.fmt(x.periodsUsed), C.fmt(x.monthlyAvg), x.reason, x.note])));
  }

  L.push('## 五、编码待确认项（未自动合并）');
  L.push('');
  if (!codeAmbiguity.length) L.push('_无_\n');
  else {
    for (const am of codeAmbiguity) {
      L.push(`**${am.type}：${am.name || am.code}**　${am.note}`);
      L.push('');
      L.push(C.mdTable(['备件编码', '名称', '规格型号', '单位', '来源'],
        am.items.map((x) => [x.code, x.name || '—', x.spec || '—', x.unit || '—', x.source])));
    }
  }
  if (unitConflicts.length) {
    L.push('**单位不一致（按单位分别统计，未换算）**');
    L.push('');
    for (const uc of unitConflicts) {
      L.push(C.mdTable(['备件编码', '名称', '单位', '该单位下合计', '来源'],
        uc.items.map((x) => [uc.code, uc.name || '—', x.unit, C.fmt(x.qty), x.sources])));
    }
  }

  L.push('## 六、无依据项（建议核实，不进正式清单）');
  L.push('');
  if (!noHistory.length) L.push('_无_\n');
  else {
    L.push(C.mdTable(['备件编码', '名称', '规格型号', '单位', '数量', '来源', '缺什么依据', '处理'],
      noHistory.map((x) => [x.code, x.name || '—', x.spec || '—', x.unit || '—', C.fmt(x.qty), x.source, x.reason, x.note])));
  }

  L.push('## 七、申报说明');
  L.push('');
  L.push('<!-- ANALYSIS_START -->');
  L.push('（此处由模型补写：本期需求的主要构成、重点保障项、与上期的差异、需要物资部门重点关注的事项。数字一律引用上表，不得另行估算。）');
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
  fs.writeFileSync(path.join(outDir, 'demand.md'), L.join('\n'), 'utf8');

  // ---------------- 申报表 xlsx
  const sheets = {
    '备件需求表': [
      [`${C.str(a.workshop)} 备件需求申报表　需求周期：${C.str(a.period)}　推算口径：${methodText}`],
      [STATEMENT],
      [grossOnly ? '未提供库存现状表，下表数量为毛需求，未扣减在库量，不得直接作为采购量。' : '净需求 = 毛需求 − 在库 − 在途；负值置 0（库存充足，本期无需采购）。'],
      [],
      ['物料编码', '物料描述', '规格型号', '单位', '计划毛需求', '历史毛需求', '毛需求合计', '在库', '在途', grossOnly ? '净需求（未扣减）' : '净需求', '来源', '依据', '说明'],
      ...netDemand.map((x) => [x.code, x.name, x.spec, x.unit, x.grossPlan, x.grossHistory, x.gross, x.onHand, x.inTransit, x.net, x.sources, x.basis, x.netNote || x.onHandNote || '']),
    ],
    '需求明细': [
      ['备件编码', '备件名称', '规格型号', '单位', '毛需求量', '来源', '依据', '推算式', '建议到货'],
      ...items.map((x) => [x.code, x.name, x.spec, x.unit, x.grossQty, x.source, x.basis, x.formula, x.suggestArrival]),
    ],
    '低置信度项': [
      ['备件编码', '备件名称', '单位', '参考推算量', '历史期数', '月均消耗', '原因', '处理'],
      ...lowConfidence.map((x) => [x.code, x.name, x.unit, x.grossQty, x.periodsUsed, x.monthlyAvg, x.reason, x.note]),
    ],
    '编码待确认': [
      ['类型', '备件编码', '备件名称', '规格型号', '单位', '来源', '说明'],
      ...codeAmbiguity.flatMap((am) => am.items.map((x) => [am.type, x.code, x.name, x.spec, x.unit, x.source, am.note])),
    ],
    '周期外计划需求': [
      ['备件编码', '备件名称', '规格型号', '单位', '数量', '订单/项目', '基本开始日期', '说明'],
      ...planOutOfPeriod.map((x) => [x.code, x.name, x.spec, x.unit, x.qty, x.project, x.planStart, x.reason]),
    ],
    '无依据待核实': [
      ['备件编码', '备件名称', '规格型号', '单位', '数量', '来源', '缺什么依据', '处理'],
      ...noHistory.map((x) => [x.code, x.name, x.spec, x.unit, x.qty, x.source, x.reason, x.note]),
    ],
  };
  writeXlsx(path.join(outDir, '备件需求表.xlsx'), sheets);

  C.emitOk(outDir, {
    ok: true, out: outDir, workshop: C.str(a.workshop), period: C.str(a.period),
    method, months, grossOnly, minPeriods: MIN_PERIODS, leadDays: LEAD_DAYS, counts, warnings,
  });
}

try { main(); } catch (e) { C.fail(e, warnings); }
