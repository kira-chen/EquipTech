#!/usr/bin/env node
'use strict';
/**
 * 重复故障识别脚本（中石化体系炼化厂车间设备员口径，仅 Node.js 内置模块）
 * 用法：node "<技能目录>/scripts/detect.js" --input <xlsx[,xlsx2,...]|csv目录> --workshop "常减压车间" [--from 2025-09-22] [--to 2026-09-21] [--out <dir>]
 *       [--min-count <n>] [--ledger <设备台账xlsx>] [--by equipment|model|part] [--similarity <0~1>]
 * 输入：SAP PM 通知单/订单导出（功能位置、设备、对象部件、损坏代码、原因代码、通知单短文本、通知日期）或车间故障记录；多文件用逗号分隔。
 * 默认口径：同一设备同一部位一年内 ≥2 次即重复故障；--to 默认当日，--from 默认 --to 往前 12 个自然月。
 * 产出：<out>/repeats.json、repeats.md、summary.json；末行打印 JSON 摘要
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readXlsx, readCsvDir } = require('./lib/xlsx-lite');
const C = require('./lib/common');
const R = require('./lib/detect-rules');

const warnings = [];
const VALUE_OPTS = ['input', 'workshop', 'from', 'to', 'out', 'min-count', 'ledger', 'by', 'similarity'];
const FLAG_OPTS = ['help'];

const DISCLAIMER = '本材料由脚本汇总、模型成文，仅供设备员复核参考，不替代审批、定性、验收与签字；厂内制度与系统数据为准。';

/**
 * 别名：局部优先，再并入共享 SYSTEM_ALIASES（SAP PM 通知单/订单/技术对象列名）。
 * 局部不把「设备编号」当位号、不把「设备」当设备名称（SAP「设备」列是 8 位设备编号）；工单号别名不含裸「编号」。
 * 「对象部件」归故障部位（声明顺序先于故障代码，避免共享表里的「对象部件」被故障代码抢走）。
 */
const ALIASES = C.mergeAliases({
  '位号': ['位号', '设备位号', 'TAG', 'tag'],
  '设备名称': ['设备名称', '名称'],
  '型号': ['型号', '规格型号', '设备型号', '规格', '型号编号'],
  '设备类型': ['设备类型', '类型', '设备类别', '类别', '对象类型', '设备分类'],
  '故障现象': ['故障现象', '现象', '故障描述', '缺陷描述', '描述', '问题描述', '故障情况', '异常描述', '通知单短文本', '短文本', '订单描述', '损坏文本', '损坏代码文本'],
  '故障部位': ['故障部位', '部位', '故障位置', '位置', '损坏部位', '对象部件', '对象部件文本'],
  '原因代码': ['原因代码', '原因', '原因代码文本', '故障原因代码', '原因文本'],
  '故障代码': ['故障代码', '损坏代码', '损坏', '故障现象代码', '损坏类型', '故障模式代码'],
  '故障时间': ['故障时间', '时间', '发生时间', '报修时间', '发现时间', '故障日期', '日期', '通知日期', '创建日期', '故障开始', '报告日期', '基本开始日期'],
  '处理方式': ['处理方式', '处理措施', '处理情况', '维修方式', '措施', '处理结果', '活动', '活动文本', '措施文本'],
  '工单号': ['工单号', '工单编号', '单号', '缺陷编号', '缺陷登记号'],
  '区域': ['区域', '装置区', '所在区域', '位置区域', '工厂区段', '装置'],
  '专业': ['专业', '所属专业', '专业类别'],
});

function loadBook(p) { return fs.statSync(p).isDirectory() ? readCsvDir(p) : readXlsx(p); }

/** 单链分组：按相似度阈值把同一集合内的记录归并成相似故障组 */
function clusterBySimilarity(items, simThreshold) {
  const groups = [];
  for (const it of items) {
    let placed = null;
    for (const g of groups) {
      // 与组内任一成员相似即归入该组（单链），记录最高分依据
      let best = null;
      for (const m of g.members) {
        const s = R.similarity(it, m);
        if (s.score >= simThreshold && (!best || s.score > best.s.score)) best = { m, s };
      }
      if (best) { placed = { g, best }; break; }
    }
    if (placed) {
      placed.g.members.push(it);
      placed.g.pairs.push({
        a: placed.best.m.seq, b: it.seq,
        score: C.round(placed.best.s.score, 2),
        byCode: !!placed.best.s.byCode,
        matchBasis: placed.best.s.matchBasis,
      });
    } else {
      groups.push({ members: [it], pairs: [] });
    }
  }
  return groups;
}

/** 相邻两次故障的间隔天数序列 */
function intervals(dates) {
  const ds = dates.filter(Boolean).slice().sort();
  const out = [];
  for (let i = 1; i < ds.length; i++) {
    const d = C.diffDays(ds[i], ds[i - 1]);
    if (d !== null) out.push(d);
  }
  return out;
}

/** D4 故障间隔缩短：≥3 次故障、间隔序列单调不增且严格出现下降、末次间隔 ≤ 首次间隔的 60% */
function isShortening(iv) {
  if (iv.length < 2) return false;
  for (let i = 1; i < iv.length; i++) if (iv[i] > iv[i - 1]) return false;
  if (!(iv[iv.length - 1] < iv[0])) return false;
  return iv[iv.length - 1] <= iv[0] * 0.6;
}

/** 相似组的展示键：组内有 SAP 代码时用代码，否则用现象类型中文 */
function groupKey(members) {
  const codes = [...new Set(members.map((m) => R.normCode(m.faultCode)).filter(Boolean))];
  if (codes.length === 1 && members.every((m) => R.normCode(m.faultCode))) return `损坏代码 ${codes[0]}`;
  return R.PHEN_CN[members[0].phenomenon];
}

function main() {
  const a = C.parseArgs(process.argv.slice(2), VALUE_OPTS, FLAG_OPTS);
  if (!a.input) throw new Error('缺少 --input');
  if (!a.workshop) throw new Error('缺少 --workshop');
  // --to 默认当日；--from 默认 --to 往前 12 个自然月的次日（「一年内」）
  const to = a.to ? C.normDate(a.to) : C.localDate();
  if (!to) throw new Error(`--to 「${a.to}」不是有效日期，应为 YYYY-MM-DD`);
  let from, fromDefaulted = false;
  if (a.from) {
    from = C.normDate(a.from);
    if (!from) throw new Error(`--from 「${a.from}」不是有效日期，应为 YYYY-MM-DD`);
  } else {
    from = C.addDays(C.addMonths(to, -R.DEFAULT_PERIOD_MONTHS), 1);
    fromDefaulted = true;
    warnings.push(`未指定 --from，按默认口径取截止日 ${to} 往前 ${R.DEFAULT_PERIOD_MONTHS} 个自然月（${from} ~ ${to}，「一年内」）统计；如需跨大修节点重新起算请显式指定`);
  }
  if (C.diffDays(to, from) < 0) throw new Error(`--from ${from} 晚于 --to ${to}`);
  const periodDays = C.diffDays(to, from) + 1;

  const by = a.by || 'equipment';
  if (!['equipment', 'model', 'part'].includes(by)) throw new Error(`--by 「${a.by}」无效，应为 equipment / model / part`);

  let minCount = R.DEFAULT_PART_MIN;
  if (a['min-count'] !== undefined) {
    const n = Number(a['min-count']);
    if (!Number.isInteger(n) || n < 2) throw new Error(`--min-count 「${a['min-count']}」无效，应为 ≥2 的整数`);
    minCount = n;
  }
  const phenMin = Math.max(R.DEFAULT_PHEN_MIN, minCount - 1);

  let simThreshold = R.DEFAULT_SIM;
  if (a.similarity !== undefined) {
    const v = Number(a.similarity);
    if (!Number.isFinite(v) || v <= 0 || v > 1) throw new Error(`--similarity 「${a.similarity}」无效，应为 0~1 之间的小数`);
    simThreshold = v;
  }

  // ---- 多文件：逗号分隔（按装置分文件是常态）
  const inputs = String(a.input).split(/[,，;；]/).map((x) => x.trim()).filter(Boolean);
  if (!inputs.length) throw new Error('缺少 --input');
  for (const p of inputs) if (!fs.existsSync(p)) throw new Error(`输入不存在: ${p}`);
  const multi = inputs.length > 1;
  const outDir = a.out || path.join(os.tmpdir(), 'rfd-out');

  // 区间长度提示（不阻断）
  if (periodDays < R.PERIOD_ADVICE.lo) {
    warnings.push(`统计区间 ${periodDays} 天短于建议下限 ${R.PERIOD_ADVICE.lo} 天（约 6 个月），可能漏判间隔较长的重复故障`);
  } else if (periodDays > R.PERIOD_ADVICE.hi + 1) {
    warnings.push(`统计区间 ${periodDays} 天长于建议上限 ${R.PERIOD_ADVICE.hi} 天（约 12 个月），可能掺入已整改的历史问题`);
  }

  // ---- 读取故障记录（逐文件读、合并）
  const records = [];        // 参与重复判定的有效记录
  const uninformative = [];  // 现象无信息量，单列，不参与判定
  let seq = 0;
  let skippedOutOfRange = 0;
  let filesWithSheet = 0;
  const fileStats = [];
  for (const p of inputs) {
    let book;
    try { book = loadBook(p); } catch (e) { throw new Error(`读取失败 ${p}: ${e.message}`); }
    const rows = C.pickSheet(book, '工单台账', '故障记录', '维修记录', '通知单', '订单', '故障', '工单');
    const fname = path.basename(p);
    if (!rows) {
      warnings.push(`文件「${fname}」中未找到「工单台账」「故障记录」或「通知单」工作表，已跳过该文件`);
      fileStats.push({ file: fname, rows: 0, skipped: true });
      continue;
    }
    filesWithSheet++;
    const sheetName = multi ? `${fname}/故障记录` : '工单台账/故障记录';
    const recs = C.toRecords(rows, ['位号', '故障时间'], sheetName,
      ['设备编号', '设备名称', '型号', '设备类型', '故障现象', '故障部位', '原因代码', '故障代码', '处理方式', '工单号', '通知单号', '区域', '专业'], warnings, ALIASES);
    let n = 0;
    for (const r of recs) {
      const tag = C.str(r['位号']);
      if (!tag) { warnings.push(`工作表「${sheetName}」第${r._row}行 位号为空，已跳过`); continue; }
      const raw = r['故障时间'];
      const date = C.normDate(raw);
      if (!date) {
        warnings.push(`工作表「${sheetName}」第${r._row}行 故障时间「${C.str(raw)}」无法解析，该行未参与统计`);
        continue;
      }
      if (C.diffDays(date, from) < 0 || C.diffDays(to, date) < 0) {
        skippedOutOfRange++;
        continue;
      }
      n++;
      const desc = C.str(r['故障现象']);
      const part = C.str(r['故障部位']);
      const faultCode = C.str(r['故障代码']);
      const causeCode = C.str(r['原因代码']);
      const item = {
        seq: ++seq, tag, equipNo: C.str(r['设备编号']), name: C.str(r['设备名称']),
        model: C.str(r['型号']), type: C.str(r['设备类型']),
        desc, part, partNorm: R.normPart(part),
        faultCode, causeCode,
        phenomenon: R.classifyPhenomenon(desc), phenomenonCn: '',
        date, action: C.str(r['处理方式']), orderNo: C.str(r['工单号']), notifNo: C.str(r['通知单号']),
        area: C.str(r['区域']), discipline: C.str(r['专业']),
        srcRow: r._row, srcFile: fname, src: multi ? `${fname} 第${r._row}行` : `第${r._row}行`,
      };
      item.phenomenonCn = R.PHEN_CN[item.phenomenon];

      const inf = R.checkInformative(desc, faultCode);
      if (inf.uninformative) {
        uninformative.push({
          seq: item.seq, tag, name: item.name, part, date, orderNo: item.orderNo, notifNo: item.notifNo,
          desc, reason: inf.reason, ruleId: 'U1',
          note: '该记录未参与任何重复故障判定，需补填具体故障现象或 SAP 损坏代码后重新统计',
          srcRow: r._row, srcFile: fname, src: item.src,
        });
        warnings.push(`工作表「${sheetName}」第${r._row}行 ${tag} ${inf.reason}，已列入未参与判定清单`);
        continue;
      }
      records.push(item);
    }
    fileStats.push({ file: fname, rows: n, skipped: false });
  }
  if (!filesWithSheet) throw new Error('未在输入中找到「工单台账」「故障记录」或「通知单」工作表');
  if (skippedOutOfRange) warnings.push(`有 ${skippedOutOfRange} 条记录的故障时间不在统计区间 ${from} ~ ${to} 内，已跳过`);
  if (!records.length && !uninformative.length) throw new Error(`统计区间 ${from} ~ ${to} 内没有可用的故障记录`);
  const withCode = records.filter((x) => R.normCode(x.faultCode)).length;
  if (withCode && withCode < records.length) {
    warnings.push(`${withCode} 条记录带 SAP 损坏/故障代码、${records.length - withCode} 条不带：有代码的按代码归类，无代码的退回文本相似比对，两类记录之间只能按文本比对`);
  }

  // ---- 设备台账（补型号/类型，SAP 技术对象列名）
  let ledgerUsed = false;
  if (a.ledger) {
    if (!fs.existsSync(a.ledger)) throw new Error(`设备台账不存在: ${a.ledger}`);
    const lrows = C.pickSheet(loadBook(a.ledger), '设备台账', '台账', '设备清单', '技术对象');
    if (!lrows) warnings.push('台账文件中未找到「设备台账」工作表，无法按型号归类');
    else {
      const lr = C.toRecords(lrows, ['位号'], '设备台账', ['设备编号', '设备名称', '型号', '设备类型', '区域', '专业'], warnings, ALIASES);
      const m = new Map();
      for (const x of lr) { const t = C.str(x['位号']); if (t) m.set(t, x); }
      ledgerUsed = true;
      const missTags = new Set();
      for (const it of records.concat(uninformative)) {
        const e = m.get(it.tag);
        if (!e) { missTags.add(it.tag); continue; }
        if (!it.name) it.name = C.str(e['设备名称']);
        if (it.equipNo !== undefined && !it.equipNo) it.equipNo = C.str(e['设备编号']);
        if (it.model !== undefined && !it.model) it.model = C.str(e['型号']);
        if (it.type !== undefined && !it.type) it.type = C.str(e['设备类型']);
        if (it.area !== undefined && !it.area) it.area = C.str(e['区域']);
        if (it.discipline !== undefined && !it.discipline) it.discipline = C.str(e['专业']);
      }
      for (const t of missTags) warnings.push(`位号「${t}」不在设备台账中，型号与设备类型未补全`);
    }
  } else {
    warnings.push('未提供设备台账（--ledger），同型号共性故障仅依据记录表自带的「型号」列归类');
  }

  // ---- 一、同设备重复故障（D1 同部位 / D2 同现象或同代码）
  const byTagMap = new Map();
  for (const it of records) {
    if (!byTagMap.has(it.tag)) byTagMap.set(it.tag, []);
    byTagMap.get(it.tag).push(it);
  }
  const byEquipment = [];
  for (const [tag, items] of byTagMap) {
    const rep = items.find((x) => x.name) || items[0];
    const dates = items.map((x) => x.date);
    const iv = intervals(dates);

    // D1：同部位（归一后）计数
    const partMap = new Map();
    for (const it of items) {
      const k = it.partNorm;
      if (k === null) continue;
      if (!partMap.has(k)) partMap.set(k, []);
      partMap.get(k).push(it);
    }
    const noPart = items.filter((x) => x.partNorm === null);
    if (noPart.length) warnings.push(`位号「${tag}」有 ${noPart.length} 条记录的故障部位（对象部件）为空，未参与同部位判定`);

    // D2：相似故障组（SAP 代码优先；否则现象文本 + 部位 + 现象类型）
    const clusters = clusterBySimilarity(items, simThreshold);

    const hits = [];
    for (const [pk, pitems] of partMap) {
      if (pitems.length >= minCount) {
        hits.push({
          ruleId: 'D1', rule: R.RULE_CN.D1, key: pk, count: pitems.length,
          threshold: minCount,
          basis: `区间内「${pk}」部位故障 ${pitems.length} 次，达到同部位阈值 ${minCount} 次`,
          matchBasis: [`故障部位（对象部件）字段归一后同为「${pk}」`, '同部位判定只比对部位字段，不比对现象文本'],
          seqs: pitems.map((x) => x.seq),
          dates: pitems.map((x) => x.date),
        });
      }
    }
    for (const g of clusters) {
      if (g.members.length >= phenMin) {
        const basisSet = [];
        for (const p of g.pairs) for (const b of p.matchBasis) if (!basisSet.includes(b)) basisSet.push(b);
        const byCode = g.pairs.length > 0 && g.pairs.every((p) => p.byCode);
        hits.push({
          ruleId: 'D2', rule: R.RULE_CN.D2,
          key: groupKey(g.members), byCode,
          count: g.members.length, threshold: phenMin,
          basis: `区间内${byCode ? '同一 SAP 损坏代码' : '相似故障现象'}出现 ${g.members.length} 次，达到同现象阈值 ${phenMin} 次`,
          matchBasis: basisSet.length ? basisSet : ['组内仅 1 条记录，无配对依据'],
          pairs: g.pairs,
          seqs: g.members.map((x) => x.seq),
          dates: g.members.map((x) => x.date),
        });
      }
    }
    if (!hits.length) continue;

    byEquipment.push({
      tag, equipNo: rep.equipNo || '', name: rep.name, model: rep.model, type: rep.type,
      area: rep.area, discipline: rep.discipline,
      count: items.length,
      firstDate: dates.slice().sort()[0], lastDate: dates.slice().sort().pop(),
      intervals: iv,
      avgInterval: iv.length ? C.round(iv.reduce((s, x) => s + x, 0) / iv.length, 1) : null,
      minInterval: iv.length ? Math.min(...iv) : null,
      shortening: isShortening(iv),
      hits,
      records: items.map((x) => ({
        seq: x.seq, date: x.date, part: x.part || '', partNorm: x.partNorm,
        desc: x.desc, faultCode: x.faultCode || '', causeCode: x.causeCode || '', phenomenonCn: x.phenomenonCn, action: x.action || '',
        orderNo: x.orderNo || '', notifNo: x.notifNo || '', srcRow: x.srcRow, src: x.src,
      })),
      note: '需组织根因分析；相似判定为代码/文本与字段匹配，不代表各次故障同因',
    });
  }
  byEquipment.sort((x, y) => y.count - x.count || x.tag.localeCompare(y.tag, 'zh'));

  // ---- 二、同型号/同类设备共性故障（D3）
  const modelKeyOf = (it) => (by === 'part' ? (it.partNorm || null) : (it.model || it.type || null));
  const modelMap = new Map();
  const noModel = [];
  for (const it of records) {
    const k = modelKeyOf(it);
    if (k === null) { noModel.push(it); continue; }
    if (!modelMap.has(k)) modelMap.set(k, []);
    modelMap.get(k).push(it);
  }
  if (noModel.length) {
    warnings.push(by === 'part'
      ? `有 ${noModel.length} 条记录的故障部位为空，未参与按部位维度的共性故障归类`
      : `有 ${noModel.length} 条记录既无型号也无设备类型，未参与同型号共性故障归类`);
  }
  const byModel = [];
  for (const [key, items] of modelMap) {
    const tags = [...new Set(items.map((x) => x.tag))];
    if (tags.length < R.DEFAULT_MODEL_EQUIP_MIN || items.length < R.DEFAULT_MODEL_COUNT_MIN) continue;
    // 共性阈值同时作用于相似故障组本身：组内涉及台数 ≥ 阈值且组内次数 ≥ 阈值
    const clusters = clusterBySimilarity(items, simThreshold)
      .filter((g) => new Set(g.members.map((m) => m.tag)).size >= R.DEFAULT_MODEL_EQUIP_MIN
        && g.members.length >= R.DEFAULT_MODEL_COUNT_MIN);
    if (!clusters.length) continue;
    for (const g of clusters) {
      const gtags = [...new Set(g.members.map((m) => m.tag))];
      const basisSet = [];
      for (const p of g.pairs) for (const b of p.matchBasis) if (!basisSet.includes(b)) basisSet.push(b);
      byModel.push({
        dimension: by === 'part' ? '故障部位' : '型号/设备类型',
        key, ruleId: 'D3', rule: R.RULE_CN.D3,
        equipmentCount: gtags.length, count: g.members.length,
        tags: gtags,
        phenomenon: groupKey(g.members),
        basis: `${by === 'part' ? '同部位' : '同型号/同类'}「${key}」下有 ${gtags.length} 台设备出现相似故障，累计 ${g.members.length} 次，达到共性阈值（台数 ≥${R.DEFAULT_MODEL_EQUIP_MIN} 且次数 ≥${R.DEFAULT_MODEL_COUNT_MIN}）`,
        matchBasis: basisSet.length ? basisSet : ['组内记录未产生配对依据'],
        records: g.members.map((x) => ({ seq: x.seq, tag: x.tag, name: x.name, date: x.date, part: x.part || '', faultCode: x.faultCode || '', desc: x.desc, srcRow: x.srcRow, src: x.src })),
        note: '共性故障线索，是否属同一失效模式须由设备工程师专项分析确定',
      });
    }
  }
  byModel.sort((x, y) => y.count - x.count || y.equipmentCount - x.equipmentCount);

  // ---- 三、故障频次排行
  const topFrequency = [...byTagMap.entries()].map(([tag, items]) => {
    const rep = items.find((x) => x.name) || items[0];
    const iv = intervals(items.map((x) => x.date));
    return {
      tag, equipNo: rep.equipNo || '', name: rep.name, model: rep.model, count: items.length,
      firstDate: items.map((x) => x.date).sort()[0],
      lastDate: items.map((x) => x.date).sort().pop(),
      avgInterval: iv.length ? C.round(iv.reduce((s, x) => s + x, 0) / iv.length, 1) : null,
      phenomena: [...new Set(items.map((x) => (R.normCode(x.faultCode) ? `代码 ${R.normCode(x.faultCode)}` : x.phenomenonCn)))],
    };
  }).sort((x, y) => y.count - x.count || x.tag.localeCompare(y.tag, 'zh'));

  // ---- 四、故障间隔缩短（D4）
  const shorteningInterval = [];
  for (const [tag, items] of byTagMap) {
    const dates = items.map((x) => x.date).sort();
    const iv = intervals(dates);
    if (!isShortening(iv)) continue;
    const rep = items.find((x) => x.name) || items[0];
    shorteningInterval.push({
      tag, name: rep.name, model: rep.model, ruleId: 'D4', rule: R.RULE_CN.D4,
      count: items.length, dates, intervals: iv,
      firstInterval: iv[0], lastInterval: iv[iv.length - 1],
      shrinkPct: C.round((1 - iv[iv.length - 1] / iv[0]) * 100, 1),
      basis: `相邻故障间隔由 ${iv[0]} 天逐次缩短至 ${iv[iv.length - 1]} 天（缩短 ${C.round((1 - iv[iv.length - 1] / iv[0]) * 100, 1)}%），间隔序列单调不增`,
      note: '间隔缩短仅为统计现象，是否存在劣化趋势须结合设备状态数据由工程师判断',
    });
  }
  shorteningInterval.sort((x, y) => y.shrinkPct - x.shrinkPct);

  const counts = {
    files: inputs.length,
    records: records.length + uninformative.length,
    valid: records.length,
    withCode,
    equipment: byTagMap.size,
    repeatEquipment: byEquipment.length,
    modelGroups: byModel.length,
    shortening: shorteningInterval.length,
    uninformative: uninformative.length,
    outOfRange: skippedOutOfRange,
  };

  // ---- 产出
  C.ensureDir(outDir);
  const result = {
    meta: {
      workshop: a.workshop, from, to, fromDefaulted, periodDays, by,
      inputs: inputs.map((p) => path.basename(p)), fileStats,
      minCount, phenMin, similarity: simThreshold,
      thresholdNote: `默认口径：同一设备同一部位一年内 ≥${R.DEFAULT_PART_MIN} 次即重复故障（厂内另有口径时用 --min-count 覆盖）`,
      periodAdvice: `建议统计区间 ${R.PERIOD_ADVICE.lo}~${R.PERIOD_ADVICE.hi} 天（约 6~12 个月）；本次实际区间 ${from} ~ ${to}，共 ${periodDays} 天`,
      codePriority: 'SAP 损坏/故障代码优先：双方都有代码时按代码归类，无代码时按现象文本与部位比对',
      ledgerProvided: !!a.ledger, ledgerUsed,
      generatedAt: C.localDateTime(),
      disclaimer: DISCLAIMER,
      ruleDisclaimer: R.DISCLAIMER,
    },
    counts, byEquipment, byModel, topFrequency, shorteningInterval, uninformative, warnings,
  };
  fs.writeFileSync(path.join(outDir, 'repeats.json'), JSON.stringify(result, null, 2), 'utf8');

  const L = [];
  L.push(`# ${a.workshop} 重复故障识别报告（${from} ~ ${to}）`);
  L.push('');
  L.push(`> ${DISCLAIMER}`);
  L.push(`> ${R.DISCLAIMER}。`);
  L.push('');
  L.push(`统计区间：${from} ~ ${to}，共 ${periodDays} 天${fromDefaulted ? '（起始日按默认「一年内」口径推算）' : ''} ｜ 归类维度：${by === 'equipment' ? '按设备' : by === 'model' ? '按型号/设备类型' : '按故障部位'} ｜ 数据文件：${inputs.map((p) => path.basename(p)).join('、')}`);
  L.push(`判定阈值：同设备同部位 ≥${minCount} 次，同设备同现象/同代码 ≥${phenMin} 次，相似度阈值 ${simThreshold}`);
  L.push(`生成时间：${C.localDateTime()}（北京时间）`);
  L.push('');
  L.push(`【注意】${result.meta.thresholdNote}。${result.meta.codePriority}。`);
  L.push(`【注意】${result.meta.periodAdvice}。区间过短会漏判间隔较长的重复故障，过长会掺入已整改的历史问题；跨大检修节点的区间应按大检修后重新起算。`);
  L.push('');

  L.push('## 一、统计概览');
  L.push('');
  L.push(C.mdTable(['指标', '数量'], [
    ['数据文件数', counts.files],
    ['区间内故障记录', counts.records],
    ['参与判定的记录', counts.valid],
    ['　其中带 SAP 损坏/故障代码', counts.withCode],
    ['涉及设备台数', counts.equipment],
    ['命中重复故障的设备', counts.repeatEquipment],
    ['同型号共性故障组', counts.modelGroups],
    ['故障间隔缩短设备', counts.shortening],
    ['现象无信息量未参与判定', counts.uninformative],
    ['区间外被跳过记录', counts.outOfRange],
  ]));

  L.push('## 二、同设备重复故障');
  L.push('');
  if (!byEquipment.length) L.push('_区间内未发现达到阈值的同设备重复故障。_\n');
  else {
    for (const g of byEquipment) {
      L.push(`### ${g.tag}${g.name ? ' ' + g.name : ''}　区间内 ${g.count} 次`);
      L.push('');
      L.push(C.mdTable(['项目', '内容'], [
        ['SAP 设备编号', g.equipNo || '—'],
        ['型号', g.model || '—'], ['设备类型', g.type || '—'],
        ['首次/末次故障', `${g.firstDate} / ${g.lastDate}`],
        ['故障间隔（天）', g.intervals.length ? g.intervals.join('、') : '—'],
        ['平均间隔', g.avgInterval === null ? '—' : `${g.avgInterval} 天`],
        ['最短间隔', g.minInterval === null ? '—' : `${g.minInterval} 天`],
        ['间隔是否缩短', g.shortening ? '是' : '否'],
      ]));
      for (const h of g.hits) {
        L.push(`**命中规则 ${h.ruleId}（${h.rule}）**：${h.basis}`);
        L.push('');
        L.push('判定依据（matchBasis）：');
        for (const b of h.matchBasis) L.push(`- ${b}`);
        L.push('');
      }
      L.push(C.mdTable(['序号', '故障时间', '故障部位', '损坏代码', '原因代码', '故障现象', '现象类型', '处理方式', '通知单/工单号', '出处'],
        g.records.map((x) => [x.seq, x.date, x.part || '—', x.faultCode || '—', x.causeCode || '—', x.desc || '—', x.phenomenonCn, x.action || '—', [x.notifNo, x.orderNo].filter(Boolean).join(' / ') || '—', x.src])));
      L.push(`【注意】${g.note}。`);
      L.push('');
    }
  }

  L.push('## 三、同型号/同类设备共性故障');
  L.push('');
  if (!byModel.length) L.push('_区间内未发现达到阈值的共性故障组。_\n');
  else {
    for (const g of byModel) {
      L.push(`### ${g.dimension}「${g.key}」　${g.equipmentCount} 台设备 / ${g.count} 次`);
      L.push('');
      L.push(`**命中规则 ${g.ruleId}（${g.rule}）**：${g.basis}`);
      L.push('');
      L.push('判定依据（matchBasis）：');
      for (const b of g.matchBasis) L.push(`- ${b}`);
      L.push('');
      L.push(C.mdTable(['序号', '位号', '设备名称', '故障时间', '故障部位', '损坏代码', '故障现象', '出处'],
        g.records.map((x) => [x.seq, x.tag, x.name || '—', x.date, x.part || '—', x.faultCode || '—', x.desc || '—', x.src])));
      L.push(`【注意】${g.note}。`);
      L.push('');
    }
  }

  L.push('## 四、故障频次排行');
  L.push('');
  L.push(C.mdTable(['排名', '位号', '设备名称', '型号', '故障次数', '首次', '末次', '平均间隔(天)', '现象类型/代码'],
    topFrequency.slice(0, 20).map((x, i) => [i + 1, x.tag, x.name || '—', x.model || '—', x.count, x.firstDate, x.lastDate, C.fmt(x.avgInterval, 1), x.phenomena.join('、')])));

  L.push('## 五、故障间隔缩短设备');
  L.push('');
  if (!shorteningInterval.length) L.push('_区间内未发现故障间隔呈递减趋势的设备。_\n');
  else {
    L.push(C.mdTable(['位号', '设备名称', '故障次数', '间隔序列(天)', '首次间隔', '末次间隔', '缩短幅度', '判定依据'],
      shorteningInterval.map((x) => [x.tag, x.name || '—', x.count, x.intervals.join('→'), `${x.firstInterval} 天`, `${x.lastInterval} 天`, C.pct(x.shrinkPct, 1), x.basis])));
    L.push('【注意】间隔缩短仅为统计现象，是否存在劣化趋势须结合设备状态数据由工程师判断。');
    L.push('');
  }

  L.push('## 六、故障现象无信息量清单（未参与判定）');
  L.push('');
  if (!uninformative.length) L.push('_无_\n');
  else {
    L.push(C.mdTable(['序号', '位号', '设备名称', '故障时间', '故障部位', '原始现象', '原因', '出处'],
      uninformative.map((x) => [x.seq, x.tag, x.name || '—', x.date, x.part || '—', x.desc === '' ? '（空）' : x.desc, x.reason, x.src])));
    L.push('【注意】以上记录的故障现象为空或只写「故障」「坏了」这类泛指描述，且无 SAP 损坏代码，**未据此判定为任何一类重复故障**，需补填具体现象或代码后重新统计。');
    L.push('');
  }

  L.push('## 七、重复故障分析');
  L.push('');
  L.push('<!-- ANALYSIS_START -->');
  L.push('（由模型依据 references/detection-rules.md 口径撰写 250~450 字，结构：总体情况 → 同设备重复故障与建议 → 同型号共性问题 → 故障间隔缩短设备 → 建议开展根因分析的对象与理由 → 数据质量问题。次数与间隔一律引用 repeats.json；不得给出具体根本原因结论，只提示需要分析。）');
  L.push('<!-- ANALYSIS_END -->');
  L.push('');

  if (warnings.length) {
    L.push('## 附：数据提示');
    L.push('');
    for (const w of warnings) L.push(`- ${w}`);
    L.push('');
  }
  fs.writeFileSync(path.join(outDir, 'repeats.md'), L.join('\n'), 'utf8');

  C.emitOk(outDir, { ok: true, out: outDir, workshop: a.workshop, from, to, periodDays, by, minCount, similarity: simThreshold, counts, warnings });
}

try { main(); } catch (e) { C.fail(e, warnings); }
