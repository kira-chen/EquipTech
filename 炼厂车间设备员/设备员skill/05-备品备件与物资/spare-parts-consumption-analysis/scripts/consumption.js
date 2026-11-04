#!/usr/bin/env node
'use strict';
/**
 * 备件消耗统计与异常识别（仅 Node.js 内置模块）
 * 用法：node scripts/consumption.js --input <出库xlsx> --workshop "车间" --from <YYYY-MM-DD> --to <YYYY-MM-DD> [--out <dir>]
 * 可选：--price <单价表xlsx> --prev <上期consumption.json 或 上期出库xlsx> --prev-from/--prev-to <基期起止>
 *       --ledger <设备台账xlsx> --by <equipment|part|month> --top <n> --anomaly-ratio <倍数>
 * 产出：<out>/consumption.json、consumption.md、消耗统计表.xlsx、summary.json
 *
 * 硬约束：单位不一致分别统计不换算；位号缺失单列不平摊；异常增长只提示需核实方向，不断言原因。
 * 中石化口径（见顶层《中石化口径对照.md》）：
 *   - 列名接 SAP MM MB51 物料凭证导出：物料 / 物料描述 / 基本计量单位 / 过账日期 / 数量 / 移动类型 / 本位币金额 / 订单 / 成本中心
 *   - 移动类型：261/201 等发料计正；262/202 等冲销按负数抵减；101 收货、311 转储等不计入消耗
 *   - 金额：有「本位币金额」列直接取用（优先），否则按单价表折算；两者都无则不折算，绝不用估计单价
 *   - 基期：--prev 可接上期 consumption.json，也可接上期出库 xlsx；或在同一导出里用 --prev-from/--prev-to 切基期
 */
const fs = require('fs');
const path = require('path');
const { readXlsx, readCsvDir, writeXlsx } = require('./lib/xlsx-lite');
const C = require('./lib/common');

const warnings = [];
const num = C.makeNum(warnings);
const VALUE_OPTS = ['input', 'workshop', 'from', 'to', 'out', 'price', 'prev', 'prev-from', 'prev-to', 'ledger', 'by', 'top', 'anomaly-ratio'];
const FLAG_OPTS = ['help'];

/** 列名别名：局部 + 共享 SYSTEM_ALIASES（SAP MM MB51 列名），局部优先。「设备编号」不作位号别名（SAP 设备编号是流水号） */
const ALIASES = C.mergeAliases({
  '出库日期': ['出库日期', '日期', '领用日期', '消耗日期', '出库时间', '过账日期', '凭证日期', '输入日期'],
  '备件编码': ['备件编码', '编码', '物料编码', '物料', '物料号', '物料编号', '物资编码', '备件编号', '料号'],
  '备件名称': ['备件名称', '名称', '物料名称', '物料描述', '物资名称', '备件', '短文本'],
  '数量': ['数量', '出库数量', '领用数量', '消耗数量', '以录入单位计的数量'],
  '单位': ['单位', '计量单位', '基本计量单位', '录入单位'],
  '位号': ['位号', '设备位号', '领用设备', '使用设备', '功能位置', '技术对象', '适用设备'],
  '领用单位': ['领用单位', '领用部门', '使用单位', '班组', '成本中心', '工作中心', '收货方'],
  '用途': ['用途', '领用原因', '备注', '说明', '项目文本', '凭证抬头文本'],
  '工单号': ['工单号', '关联工单', '单号', '工单编号', '订单', '订单号', 'PM订单', '维修订单号'],
  '移动类型': ['移动类型', '业务类型', '移动类型代码'],
  '金额': ['金额', '本位币金额', '本币金额', '金额(本位币)', '出库金额'],
  '单价': ['单价', '价格', '单位价格', '移动平均价'],
  '设备名称': ['设备名称', '设备描述', '设备'],
  '设备类型': ['设备类型', '类型', '设备类别', '对象类型'],
});
/** SAP 移动类型：发料计正、冲销计负、其余不计入 */
const MVT_ISSUE = /^(261|201|221|281|291|601|Z61)$/i;
const MVT_REVERSAL = /^(262|202|222|282|292|602|Z62)$/i;

function loadBook(p) { return fs.statSync(p).isDirectory() ? readCsvDir(p) : readXlsx(p); }
const monthOf = (d) => (d ? d.slice(0, 7) : null);

function main() {
  const a = C.parseArgs(process.argv.slice(2), VALUE_OPTS, FLAG_OPTS);
  if (!a.input) throw new Error('缺少 --input');
  if (!fs.existsSync(a.input)) throw new Error(`出库记录不存在: ${a.input}`);
  if (!a.workshop) throw new Error('缺少 --workshop');
  if (!a.from) throw new Error('缺少 --from');
  if (!a.to) throw new Error('缺少 --to');
  const from = C.normDate(a.from), to = C.normDate(a.to);
  if (!from) throw new Error(`--from 「${a.from}」不是有效日期，应为 YYYY-MM-DD`);
  if (!to) throw new Error(`--to 「${a.to}」不是有效日期，应为 YYYY-MM-DD`);
  if (C.diffDays(to, from) < 0) throw new Error(`--to（${to}）早于 --from（${from}）`);
  const topN = a.top ? Number(a.top) : 10;
  if (a.top && !Number.isFinite(topN)) throw new Error(`--top 「${a.top}」不是数字`);
  const ratio = a['anomaly-ratio'] ? Number(a['anomaly-ratio']) : 2;
  if (a['anomaly-ratio'] && (!Number.isFinite(ratio) || ratio <= 1)) throw new Error(`--anomaly-ratio 「${a['anomaly-ratio']}」应为大于 1 的数字`);
  const by = a.by || 'equipment';
  if (!['equipment', 'part', 'month'].includes(by)) throw new Error(`--by 只能是 equipment / part / month，收到「${by}」`);
  const outDir = a.out || path.join(path.dirname(a.input), 'spc-out');

  // ---- 出库记录读取（本期与基期共用）：支持 MB51 物料凭证（移动类型 / 本位币金额）
  function readIssues(book, f, t, label) {
    const rows = C.pickSheet(book, '出库记录', '消耗记录', '出库', '领用记录', '物料凭证', 'MB51', '发料');
    if (!rows) throw new Error(`${label}中未找到「出库记录」工作表（亦可为「物料凭证」「MB51」）`);
    const recs = C.toRecords(rows, ['备件编码', '数量'], label,
      ['出库日期', '备件名称', '单位', '位号', '领用单位', '用途', '工单号', '移动类型', '金额'], warnings, ALIASES);
    if (!recs.length) throw new Error(`${label}中没有有效数据行`);
    const list = [];
    let outOfRange = 0, mvtSkipped = 0, mvtReversed = 0;
    const hasMvt = recs.hasCol('移动类型'), hasAmt = recs.hasCol('金额');
    for (const r of recs) {
      const code = C.str(r['备件编码']);
      if (!code) { warnings.push(`工作表「${label}」第${r._row}行 备件编码为空，已跳过`); continue; }
      const d = C.normDate(r['出库日期']);
      if (r['出库日期'] && !d) warnings.push(`工作表「${label}」第${r._row}行 出库日期「${C.str(r['出库日期'])}」无法解析`);
      if (d && (C.diffDays(d, f) < 0 || C.diffDays(t, d) < 0)) { outOfRange++; continue; }
      let qty = num(r['数量'], { sheet: label, row: r._row, col: '数量' });
      let amt = hasAmt ? num(r['金额'], { sheet: label, row: r._row, col: '金额' }) : null;
      const mvt = C.str(r['移动类型']);
      if (mvt) {
        if (MVT_REVERSAL.test(mvt)) { if (qty !== null) qty = -Math.abs(qty); if (amt !== null) amt = -Math.abs(amt); mvtReversed++; }
        else if (MVT_ISSUE.test(mvt)) { if (qty !== null) qty = Math.abs(qty); if (amt !== null) amt = Math.abs(amt); }
        else { mvtSkipped++; continue; }
      }
      list.push({
        code, name: C.str(r['备件名称']), date: d, month: monthOf(d),
        qty, unit: C.str(r['单位']) || '（未填单位）',
        tag: C.str(r['位号']), dept: C.str(r['领用单位']),
        purpose: C.str(r['用途']), orderNo: C.str(r['工单号']), mvt: mvt || null, amountCol: amt, _row: r._row,
      });
    }
    if (outOfRange) warnings.push(`${label}：${outOfRange} 条记录的出库日期不在统计区间 ${f} ~ ${t}，已排除`);
    if (mvtReversed) warnings.push(`${label}：${mvtReversed} 条为冲销（移动类型 262/202 等），已按负数抵减，未当作领用`);
    if (mvtSkipped) warnings.push(`${label}：${mvtSkipped} 条为非发料/非冲销移动类型（如 101 收货、311 转储），不计入消耗`);
    return { items: list, hasMvt, hasAmt };
  }
  const cur = readIssues(loadBook(a.input), from, to, '出库记录');
  const items = cur.items;
  if (!items.length) throw new Error(`统计区间 ${from} ~ ${to} 内没有出库记录`);

  // ---- 金额：有「本位币金额」列直接取用（优先）；否则按单价表折算；两者都无则不折算，绝不用估计单价
  let priceMap = null;
  const amountFromColumn = cur.hasAmt;
  if (amountFromColumn) {
    warnings.push('出库记录含「金额/本位币金额」列，金额直接取该列' + (a.price ? '（已提供的单价表仅用于该列为空的记录）' : '，未再乘单价'));
  }
  if (a.price) {
    if (!fs.existsSync(a.price)) throw new Error(`单价表不存在: ${a.price}`);
    const pr = C.pickSheet(loadBook(a.price), '单价表', '单价', '价格表');
    if (!pr) warnings.push('单价文件中未找到「单价表」工作表，不折算金额');
    else {
      const pp = C.toRecords(pr, ['备件编码'], '单价表', ['单价', '单位'], warnings, ALIASES);
      priceMap = new Map();
      for (const r of pp) {
        const code = C.str(r['备件编码']); if (!code) continue;
        const v = num(r['单价'], { sheet: '单价表', row: r._row, col: '单价' });
        if (v !== null) priceMap.set(code, { price: v, unit: C.str(r['单位']) });
      }
    }
  } else if (!amountFromColumn) {
    warnings.push('未提供单价表（--price），出库记录也无「本位币金额」列，不折算金额；未使用任何估计单价');
  }
  const amountOf = (it) => {
    if (it.amountCol !== null && it.amountCol !== undefined) return C.round(it.amountCol, 2);
    if (!priceMap) return null;
    const p = priceMap.get(it.code);
    if (!p || it.qty === null) return null;
    return C.round(p.price * it.qty, 2);
  };
  const amountSource = amountFromColumn ? (priceMap ? '本位币金额列（空值按单价表折算）' : '本位币金额列') : (priceMap ? '单价表折算' : null);

  // ---- 设备台账（按设备类型归类）
  let equipMap = null;
  if (a.ledger) {
    if (!fs.existsSync(a.ledger)) throw new Error(`设备台账不存在: ${a.ledger}`);
    const lr = C.pickSheet(loadBook(a.ledger), '设备台账', '台账', '设备清单');
    if (!lr) warnings.push('台账文件中未找到「设备台账」工作表，不按设备类型归类');
    else {
      const ll = C.toRecords(lr, ['位号'], '设备台账', ['设备名称', '设备类型', '专业'], warnings, ALIASES);
      equipMap = new Map();
      for (const r of ll) {
        const t = C.str(r['位号']); if (!t) continue;
        equipMap.set(t, { name: C.str(r['设备名称']), type: C.str(r['设备类型']), discipline: C.str(r['专业']) });
      }
    }
  }

  // ---- 未归属（位号为空）：单列，绝不平摊
  const unattributed = items.filter((x) => !x.tag);
  const attributed = items.filter((x) => x.tag);
  if (unattributed.length) {
    warnings.push(`${unattributed.length} 条出库记录未填领用设备位号，已单列「未归属消耗」，未平摊到其他设备`);
  }

  /** 按单位分组聚合数量；单位不一致时分别统计，绝不换算 */
  function aggQty(list) {
    const byUnit = new Map();
    let unknownQty = 0;
    for (const it of list) {
      if (it.qty === null) { unknownQty++; continue; }
      const u = it.unit;
      byUnit.set(u, C.round((byUnit.get(u) || 0) + it.qty, 3));
    }
    return { byUnit: [...byUnit.entries()].map(([unit, qty]) => ({ unit, qty })), unknownQty };
  }
  function aggAmount(list) {
    let sum = 0, hit = 0, miss = 0;
    for (const it of list) {
      const amt = amountOf(it);
      if (amt === null) { miss++; continue; }
      sum += amt; hit++;
    }
    return hit ? { amount: C.round(sum, 2), priced: hit, unpriced: miss } : { amount: null, priced: 0, unpriced: miss };
  }

  function groupBy(list, keyFn, labelFn) {
    const m = new Map();
    for (const it of list) {
      const k = keyFn(it); if (k === null || k === undefined) continue;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(it);
    }
    return [...m.entries()].map(([k, list]) => {
      const q = aggQty(list), amt = aggAmount(list);
      return { key: k, label: labelFn ? labelFn(k, list) : k, records: list.length,
        ...q, ...amt, codes: [...new Set(list.map((x) => x.code))].length };
    });
  }

  const byEquipment = groupBy(attributed, (x) => x.tag, (k) => {
    const e = equipMap && equipMap.get(k);
    return e && e.name ? `${k} ${e.name}` : k;
  }).sort((x, y) => (y.amount ?? 0) - (x.amount ?? 0) || y.records - x.records);

  const byPart = groupBy(items, (x) => x.code, (k, list) => {
    const n = list.find((x) => x.name)?.name;
    return n ? `${k} ${n}` : k;
  }).sort((x, y) => (y.amount ?? 0) - (x.amount ?? 0) || y.records - x.records);

  const byMonth = groupBy(items.filter((x) => x.month), (x) => x.month).sort((x, y) => x.key.localeCompare(y.key));

  let byType = null;
  if (equipMap) {
    byType = groupBy(attributed.filter((x) => equipMap.get(x.tag)), (x) => equipMap.get(x.tag).type || '（未填类型）')
      .sort((x, y) => y.records - x.records);
  }

  const topConsumers = (by === 'part' ? byPart : byEquipment).slice(0, topN);

  // ---- 基期来源：--prev 接上期 consumption.json；或 --prev 接上期出库 xlsx（需 --prev-from/--prev-to）；或只给 --prev-from/--prev-to 在同一导出里切基期
  let anomalies = null, compare = null;
  let newInPeriod = null; // 基期没有该编码（或该编码基期全部单位数量为 0）、本期新出现的备件：无倍数可算，单列提示（不计入异常）
  let unitMismatch = null; // 基期有该编码的消耗、只是单位不同：两期不可比，单列提示（不算新出现，也不计入异常）
  let prevSource = null;
  const pf = a['prev-from'] !== undefined ? C.normDate(a['prev-from']) : null;
  const pt = a['prev-to'] !== undefined ? C.normDate(a['prev-to']) : null;
  if (a['prev-from'] !== undefined && !pf) throw new Error(`--prev-from 「${a['prev-from']}」不是有效日期，应为 YYYY-MM-DD`);
  if (a['prev-to'] !== undefined && !pt) throw new Error(`--prev-to 「${a['prev-to']}」不是有效日期，应为 YYYY-MM-DD`);
  if ((pf && !pt) || (!pf && pt)) throw new Error('--prev-from 与 --prev-to 须同时给出');
  if (pf && pt && C.diffDays(pt, pf) < 0) throw new Error(`--prev-to（${pt}）早于 --prev-from（${pf}）`);
  if (pf && pt && !(C.diffDays(from, pt) > 0 || C.diffDays(pf, to) > 0)) throw new Error(`基期 ${pf} ~ ${pt} 与本期 ${from} ~ ${to} 重叠，无法作同比环比`);
  const prevIsJson = a.prev && /\.json$/i.test(a.prev);
  if (a.prev && !prevIsJson && !pf) throw new Error('--prev 为出库表（非 consumption.json）时须同时给 --prev-from/--prev-to 指定基期');
  let prev = null;
  if (prevIsJson) {
    if (!fs.existsSync(a.prev)) throw new Error(`上期 consumption.json 不存在: ${a.prev}`);
    try { prev = JSON.parse(fs.readFileSync(a.prev, 'utf8')); } catch (e) { throw new Error(`上期 consumption.json 解析失败: ${e.message}`); }
    prevSource = `上期 consumption.json（${path.basename(a.prev)}）`;
    if (pf) warnings.push('同时给了 --prev（consumption.json）与 --prev-from/--prev-to，基期以 consumption.json 的区间为准，--prev-from/--prev-to 未使用');
  } else if (pf) {
    const src = a.prev || a.input;
    if (!fs.existsSync(src)) throw new Error(`基期出库表不存在: ${src}`);
    const pv = readIssues(loadBook(src), pf, pt, a.prev ? '基期出库记录' : '基期出库记录（同一导出）');
    if (!pv.items.length) warnings.push(`基期 ${pf} ~ ${pt} 内没有出库记录，异常增长无可比项`);
    prev = { meta: { from: pf, to: pt }, counts: { records: pv.items.length }, byPart: groupBy(pv.items, (x) => x.code) };
    prevSource = a.prev ? `上期出库表（${path.basename(a.prev)}，基期 ${pf} ~ ${pt}）` : `同一导出切基期（${pf} ~ ${pt}）`;
  }
  if (prev) {
    const prevByPart = new Map((prev.byPart || []).map((x) => [x.key, x]));
    // 两期天数不等时按日均归一，否则「3个月 vs 1个月」会得出虚高倍数
    const curDays = C.diffDays(to, from) + 1;
    const prevDays = prev.meta && prev.meta.from && prev.meta.to ? C.diffDays(prev.meta.to, prev.meta.from) + 1 : null;
    const normalized = prevDays !== null && prevDays > 0 && prevDays !== curDays;
    if (prevDays === null) warnings.push('上期数据缺少统计区间信息，异常增长按原始数量比对，未做区间长度归一');
    else if (normalized) warnings.push(`本期 ${curDays} 天、上期 ${prevDays} 天，异常增长已按日均归一后比对`);
    anomalies = [];
    newInPeriod = [];
    unitMismatch = [];
    const prevHasData = prevByPart.size > 0; // 基期整段无记录时没有可比基期，不把本期全部备件列为新出现
    for (const cur of byPart) {
      const p = prevByPart.get(cur.key);
      // 只在两期同单位可比时判断。基期无同单位消耗、本期有消耗时：基期该编码别的单位有消耗 → unitMismatch（两期单位不同、不可比）；
      // 基期完全没有该编码，或该编码基期全部单位数量都为 0 → newInPeriod
      const prevUnitsWithQty = p ? (p.byUnit || []).filter((x) => x.qty > 0) : [];
      for (const cu of cur.byUnit) {
        const pu = p ? (p.byUnit || []).find((x) => x.unit === cu.unit) : null;
        if ((!pu || pu.qty === 0) && prevHasData && cu.qty > 0) {
          if (prevUnitsWithQty.length) {
            unitMismatch.push({ code: cur.key, label: cur.label, unit: cu.unit, current: cu.qty,
              prevUnits: prevUnitsWithQty.map((x) => ({ unit: x.unit, qty: x.qty })),
              note: `两期单位不同、不可比（本期按「${cu.unit}」，基期按「${prevUnitsWithQty.map((x) => x.unit).join('、')}」），未换算、不计算增长倍数；请按同一计量单位核对后再比` });
          } else {
            newInPeriod.push({ code: cur.key, label: cur.label, unit: cu.unit, current: cu.qty,
              note: '基期无该备件消耗，本期新出现，无增长倍数可算；建议核实是否与某次检修、重复故障或统计口径变化相关；本技能不断言原因' });
          }
        }
        if (!pu || pu.qty === 0) continue;
        const curRate = normalized ? cu.qty / curDays : cu.qty;
        const prevRate = normalized ? pu.qty / prevDays : pu.qty;
        if (prevRate === 0) continue;
        const r = curRate / prevRate;
        if (r >= ratio) {
          anomalies.push({
            code: cur.key, label: cur.label, unit: cu.unit,
            current: cu.qty, previous: pu.qty,
            currentPerDay: normalized ? C.round(curRate, 4) : null,
            previousPerDay: normalized ? C.round(prevRate, 4) : null,
            normalized, ratio: C.round(r, 2),
            note: `本期消耗达到上期 ${C.round(r, 2)} 倍${normalized ? '（按日均归一后）' : ''}，建议核实是否与某次检修、重复故障或统计口径变化相关；本技能不断言原因`,
          });
        }
      }
    }
    anomalies.sort((x, y) => y.ratio - x.ratio);
    newInPeriod.sort((x, y) => x.code.localeCompare(y.code));
    unitMismatch.sort((x, y) => x.code.localeCompare(y.code));
    if (unitMismatch.length) warnings.push(`${unitMismatch.length} 项备件两期单位不同、不可比（${unitMismatch.map((x) => x.code).join('、')}），未换算，不计入异常增长也不算本期新出现`);
    compare = { prevPeriod: prev.meta ? `${prev.meta.from} ~ ${prev.meta.to}` : null, prevSource,
      prevDays, currentDays: curDays, normalized,
      prevRecords: prev.counts ? prev.counts.records : null, currentRecords: items.length };
  } else {
    warnings.push('未提供基期数据（--prev 或 --prev-from/--prev-to），不做同比环比与异常增长识别');
  }

  const unknownQtyTotal = items.filter((x) => x.qty === null).length;
  const unitSet = [...new Set(items.map((x) => x.unit))];
  if (unitSet.length > 1) warnings.push(`出库记录含 ${unitSet.length} 种单位（${unitSet.join('、')}），已按单位分别统计，未做换算`);

  const totalAmt = aggAmount(items);
  const counts = {
    records: items.length, codes: new Set(items.map((x) => x.code)).size,
    equipment: byEquipment.length, months: byMonth.length,
    unattributed: unattributed.length, unknownQty: unknownQtyTotal,
    units: unitSet.length,
    anomalies: anomalies === null ? null : anomalies.length,
    newInPeriod: newInPeriod === null ? null : newInPeriod.length,
    unitMismatch: unitMismatch === null ? null : unitMismatch.length,
    amount: totalAmt.amount, unpriced: (priceMap || amountFromColumn) ? totalAmt.unpriced : null,
    reversals: items.filter((x) => x.mvt && MVT_REVERSAL.test(x.mvt)).length,
  };

  // ---- 产出
  C.ensureDir(outDir);
  const result = {
    meta: { workshop: a.workshop, from, to, by, topN, anomalyRatio: ratio,
      generatedAt: C.localDateTime(), priceProvided: !!priceMap, amountFromColumn, amountSource, mvtColumn: cur.hasMvt,
      ledgerProvided: !!equipMap, prevProvided: !!prev, prevSource },
    counts, byEquipment, byPart, byMonth, byType, topConsumers, anomalies, newInPeriod, unitMismatch, compare,
    unattributed: unattributed.map((x) => ({ code: x.code, name: x.name, qty: x.qty, unit: x.unit,
      date: x.date, dept: x.dept, purpose: x.purpose, row: x._row })),
    warnings,
  };
  fs.writeFileSync(path.join(outDir, 'consumption.json'), JSON.stringify(result, null, 2), 'utf8');

  const qtyText = (g) => g.byUnit.map((u) => `${C.fmt(u.qty)} ${u.unit}`).join(' / ') + (g.unknownQty ? `（${g.unknownQty} 条数量未填）` : '');
  const L = [];
  L.push(`# ${a.workshop} 备件消耗分析（${from} ~ ${to}）`);
  L.push('');
  L.push(`数据来源：${path.basename(a.input)}　生成时间：${C.localDateTime()}（北京时间）`);
  L.push('');
  L.push('## 一、统计概览');
  L.push('');
  L.push(C.mdTable(['指标', '数值'], [
    ['出库记录条数', counts.records], ['涉及备件种类', counts.codes],
    ['涉及设备', counts.equipment], ['统计月份数', counts.months],
    ['未归属消耗', counts.unattributed], ['数量未填', counts.unknownQty],
    ['单位种类', `${counts.units}${counts.units > 1 ? '（分别统计，未换算）' : ''}`],
    ['冲销记录（已抵减）', counts.reversals],
    ['消耗金额', (priceMap || amountFromColumn) ? `${counts.amount === null ? '—' : counts.amount}（${amountSource}${counts.unpriced ? `；${counts.unpriced} 条无金额`: ''}）` : '—（未提供单价表且无本位币金额列，未折算）'],
  ]));
  L.push('## 二、按设备分布');
  L.push('');
  L.push(C.mdTable(['设备', '记录数', '备件种类', '消耗量', '金额'],
    byEquipment.slice(0, topN).map((g) => [g.label, g.records, g.codes, qtyText(g), g.amount === null ? '—' : C.fmt(g.amount)])));
  L.push('## 三、按备件分布');
  L.push('');
  L.push(C.mdTable(['备件', '记录数', '涉及设备', '消耗量', '金额'],
    byPart.slice(0, topN).map((g) => [g.label, g.records, '—', qtyText(g), g.amount === null ? '—' : C.fmt(g.amount)])));
  L.push('## 四、时间分布');
  L.push('');
  L.push(C.mdTable(['月份', '记录数', '消耗量', '金额'],
    byMonth.map((g) => [g.key, g.records, qtyText(g), g.amount === null ? '—' : C.fmt(g.amount)])));
  if (byType) {
    L.push('## 五、按设备类型');
    L.push('');
    L.push(C.mdTable(['设备类型', '记录数', '消耗量'], byType.map((g) => [g.key, g.records, qtyText(g)])));
  }
  L.push(`## ${byType ? '六' : '五'}、消耗排行（前 ${topN}）`);
  L.push('');
  L.push(C.mdTable(['排名', by === 'part' ? '备件' : '设备', '记录数', '消耗量', '金额'],
    topConsumers.map((g, i) => [i + 1, g.label, g.records, qtyText(g), g.amount === null ? '—' : C.fmt(g.amount)])));
  L.push(`## ${byType ? '七' : '六'}、异常增长项`);
  L.push('');
  if (anomalies === null) L.push('_未提供基期数据（--prev 或 --prev-from/--prev-to），不做异常增长识别。_\n');
  else { L.push(`基期来源：${prevSource}${prevIsJson ? `（${compare.prevPeriod || '—'}）` : ''}`); L.push(''); }
  if (anomalies === null) { /* 已说明 */ }
  else if (!anomalies.length) L.push(`_未发现消耗量达到上期 ${ratio} 倍及以上的备件。_\n`);
  else {
    const norm = anomalies.some((x) => x.normalized);
    L.push(C.mdTable(norm ? ['备件', '单位', '本期', '上期', '本期日均', '上期日均', '增长倍数']
      : ['备件', '单位', '本期', '上期', '增长倍数'],
      anomalies.map((x) => (norm
        ? [x.label, x.unit, C.fmt(x.current), C.fmt(x.previous), C.fmt(x.currentPerDay, 3), C.fmt(x.previousPerDay, 3), x.ratio]
        : [x.label, x.unit, C.fmt(x.current), C.fmt(x.previous), x.ratio]))));
    if (norm) { L.push(`> 两期统计区间长度不同（本期 ${compare.currentDays} 天 / 上期 ${compare.prevDays} 天），倍数按日均归一后计算。`); L.push(''); }
    L.push('> 异常增长仅为统计结果，**建议核实是否与某次检修、重复故障或统计口径变化相关；本技能不断言原因**。');
    L.push('');
  }
  if (newInPeriod && newInPeriod.length) {
    L.push(`基期无消耗、本期新出现的备件（${newInPeriod.length} 项，无增长倍数可算，不计入异常增长）：`);
    L.push('');
    L.push(C.mdTable(['备件', '单位', '本期', '基期'], newInPeriod.map((x) => [x.label, x.unit, C.fmt(x.current), '无消耗'])));
    L.push('> 仅为统计结果，建议核实是否与某次检修、重复故障或统计口径变化相关；本技能不断言原因。');
    L.push('');
  }
  if (unitMismatch && unitMismatch.length) {
    L.push(`两期单位不同、不可比的备件（${unitMismatch.length} 项，未换算，不计入异常增长，也不算本期新出现）：`);
    L.push('');
    L.push(C.mdTable(['备件', '本期单位', '本期', '基期'], unitMismatch.map((x) => [x.label, x.unit, C.fmt(x.current), x.prevUnits.map((u) => `${C.fmt(u.qty)} ${u.unit}`).join('、')])));
    L.push('> 请按同一计量单位核对两期数据后再作比较。');
    L.push('');
  }
  L.push(`## ${byType ? '八' : '七'}、未归属消耗`);
  L.push('');
  if (!unattributed.length) L.push('_无_\n');
  else {
    L.push(`${unattributed.length} 条出库记录未填领用设备位号，**未平摊到其他设备，也未排除后当作完整统计**。`);
    L.push('');
    L.push(C.mdTable(['备件编码', '名称', '数量', '单位', '出库日期', '领用单位', '出处'],
      unattributed.slice(0, 20).map((x) => [x.code, x.name || '—', C.fmt(x.qty), x.unit, x.date || '—', x.dept || '—', `第${x._row}行`])));
    if (unattributed.length > 20) { L.push(`_（另有 ${unattributed.length - 20} 条，详见 consumption.json）_`); L.push(''); }
  }
  L.push(`## ${byType ? '九' : '八'}、消耗分析`);
  L.push('');
  L.push('<!-- ANALYSIS_START -->');
  L.push('（由模型依据 references/analysis-rules.md 口径撰写 250~400 字，结构：总体情况 → 消耗集中的设备与备件 → 异常增长项与建议核实的方向 → 未归属消耗 → 建议跟进事项。数量与倍数一律引用 consumption.json；异常增长只提示需核实的方向，不得断言原因。）');
  L.push('<!-- ANALYSIS_END -->');
  L.push('');
  if (warnings.length) {
    L.push('## 附：数据提示');
    L.push('');
    for (const w of warnings) L.push(`- ${w}`);
    L.push('');
  }
  fs.writeFileSync(path.join(outDir, 'consumption.md'), L.join('\n'), 'utf8');

  // 统计表 xlsx
  const sheetOf = (g, keyName) => [[keyName, '记录数', '备件种类/设备数', '单位', '消耗量', '金额'],
    ...g.flatMap((x) => (x.byUnit.length ? x.byUnit.map((u) => [x.label, x.records, x.codes, u.unit, u.qty, x.amount])
      : [[x.label, x.records, x.codes, '—', null, x.amount]]))];
  writeXlsx(path.join(outDir, '消耗统计表.xlsx'), {
    '按设备': sheetOf(byEquipment, '设备'),
    '按备件': sheetOf(byPart, '备件'),
    '按月份': sheetOf(byMonth, '月份'),
    '未归属': [['备件编码', '名称', '数量', '单位', '出库日期', '领用单位', '用途', '行号'],
      ...unattributed.map((x) => [x.code, x.name, x.qty, x.unit, x.date, x.dept, x.purpose, x._row])],
  });

  C.emitOk(outDir, { ok: true, out: outDir, workshop: a.workshop, from, to, amountSource, prevSource, counts, warnings });
}

try { main(); } catch (e) { C.fail(e, warnings); }
