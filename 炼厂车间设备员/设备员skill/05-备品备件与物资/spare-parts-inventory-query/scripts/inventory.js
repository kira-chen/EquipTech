#!/usr/bin/env node
'use strict';
/**
 * 备件库存查询与代用候选提示（仅 Node.js 内置模块）
 * 用法：node scripts/inventory.js --input <库存xlsx> --query "<编码/名称/规格>" [--out <dir>]
 * 可选：--tag <设备位号> --mapping <备件设备对应表xlsx> --intransit <在途xlsx> --catalog <备件目录xlsx> --alternatives --fuzzy --limit <n>
 * 产出：<out>/inventory.json、inventory.md、summary.json
 *
 * 硬约束：代用只列候选与技术确认要点，**不给出「可以代用」的结论**。
 * 中石化口径（见顶层《中石化口径对照.md》）：
 *   - 列名接 SAP MM（MB52/MMBE）导出：物料 / 物料描述 / 基本计量单位 / 非限制使用库存 / 库存地点 / 再订货点（局部别名 + 共享 SYSTEM_ALIASES）
 *   - 「数量」过宽，不作库存量别名（在途表的「数量」仍按到货数量读）
 *   - 「按位号查备件」归口本技能（--tag，可配 --mapping 备件设备对应表）；设备台账参数查询归 equipment-ledger-query
 *   - 所查件无库存（库存量为 0 / 空）时，有库存的同类候选置顶
 */
const fs = require('fs');
const path = require('path');
const { readXlsx, readCsvDir, writeXlsx } = require('./lib/xlsx-lite');
const C = require('./lib/common');
const SUB = require('./lib/substitution');

const warnings = [];
const num = C.makeNum(warnings);
const VALUE_OPTS = ['input', 'query', 'out', 'tag', 'mapping', 'intransit', 'catalog', 'limit'];
const FLAG_OPTS = ['alternatives', 'fuzzy', 'help'];

/** 列名别名：局部 + 共享 SYSTEM_ALIASES（SAP MM / EM 列名），局部优先。
 *  「数量」不作库存量别名（过宽：MB51 的「数量」是业务量不是库存）；「设备编号」不作位号别名（SAP 设备编号是流水号）。*/
const ALIASES = C.mergeAliases({
  '备件编码': ['备件编码', '编码', '物料编码', '物料', '物料号', '物料编号', '物资编码', '备件编号', '料号'],
  '备件名称': ['备件名称', '名称', '物料名称', '物料描述', '物资名称', '备件'],
  '规格型号': ['规格型号', '型号', '规格', '型号编号'],
  '单位': ['单位', '计量单位', '基本计量单位'],
  '库存量': ['库存量', '库存', '非限制使用库存', '非限制库存', '可用库存', '现有量', '现有库存', '结存'],
  '安全库存': ['安全库存', '最低库存', '警戒库存', '再订货点', '储备定额'],
  '库位': ['库位', '存放库位', '货位', '存放位置', '库存地点', '仓库', '存放地点'],
  '状态': ['状态', '备件状态', '库存状态'],
  '位号': ['位号', '设备位号', '适用设备', '适用位号', '功能位置', '安装位置'],
  '到货数量': ['到货数量', '在途数量', '采购数量', '订单数量', '数量'],
  '预计到货': ['预计到货', '到货日期', '预计到货日期', '交期', '交货日期'],
  '采购订单': ['采购订单', '采购订单号', '采购凭证', '采购单号', 'PO号', 'PO'],
  '材质': ['材质', '材料'],
  '压力等级': ['压力等级', '公称压力', 'PN'],
  '温度范围': ['温度范围', '使用温度', '工作温度'],
});

function loadBook(p) { return fs.statSync(p).isDirectory() ? readCsvDir(p) : readXlsx(p); }
const norm = (v) => C.str(v).toLowerCase().replace(/[\s\-_]/g, '');
/**
 * 位号比对（适用位号列常写成「P-2101A/P-2101B」「P-2101AB」「1#P-2101A」）：在单元格文字里找位号，
 * 字符之间允许空白、-、_，大小写不敏感；前面不能紧挨字母或数字（查 SV-101 不中 PSV-101，「1#P-101A」的 # 算边界）。
 *  - 查询以数字结尾（P-2101）：后面不能紧跟数字（不误中 P-21011A、P-2101-1），可跟任意个字母后缀（P-2101A、P-2101AB）；
 *  - 查询以字母结尾（P-2101A）：完全相同，或「P-2101AB」「P-2101A/B」「P-2101A、C」里的同组字母含该字母（参考 technical-document-finder 的 tagRes.ab）；
 *    同组字母后面不能紧跟「-数字」：「P-2101A、C-101」「P-2101A, B-202」里的 C-101、B-202 是另一个位号，不算同组字母。
 */
const TAG_SEP = '[\\s\\-_]*';
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const tagReCache = new Map();
function tagRes(t) {
  if (tagReCache.has(t)) return tagReCache.get(t);
  const body = (s) => [...s].map(reEsc).join(TAG_SEP);
  const res = { main: null, ab: null, letter: null };
  if (/\d$/.test(t)) res.main = new RegExp(`(?<![a-z0-9])${body(t)}(?![\\-_]*\\d)(?=[a-z]*(?![a-z0-9]))`);
  else {
    res.main = new RegExp(`(?<![a-z0-9])${body(t)}(?![a-z0-9])`);
    const m = t.match(/^(.*\d)([a-z])$/);
    if (m) {
      res.ab = new RegExp(`(?<![a-z0-9])${body(m[1])}${TAG_SEP}([a-z](?:(?:\\s*[/／、，,&＆]\\s*)?[a-z])+)(?![a-z0-9])(?!\\s*[\\-_－—]\\s*\\d)`, 'g');
      res.letter = m[2];
    }
  }
  tagReCache.set(t, res);
  return res;
}
const tagHit = (cell, t) => {
  if (!t) return false;
  const s = C.str(cell).toLowerCase();
  const r = tagRes(t);
  if (r.main.test(s)) return true;
  if (!r.ab) return false;
  r.ab.lastIndex = 0;
  let m;
  while ((m = r.ab.exec(s))) { if (m[1].split(/[^a-z]+/).join('').includes(r.letter)) return true; }
  return false;
};

function main() {
  const a = C.parseArgs(process.argv.slice(2), VALUE_OPTS, FLAG_OPTS);
  if (!a.input) throw new Error('缺少 --input');
  if (!fs.existsSync(a.input)) throw new Error(`库存表不存在: ${a.input}`);
  if (!a.query && !a.tag) throw new Error('缺少 --query（编码/名称/规格）或 --tag（按设备位号查）');
  const limit = a.limit ? Number(a.limit) : 50;
  if (a.limit && !Number.isFinite(limit)) throw new Error(`--limit 「${a.limit}」不是数字`);
  const outDir = a.out || path.join(path.dirname(a.input), 'spi-out');

  // ---- 库存表
  const rows = C.pickSheet(loadBook(a.input), '库存表', '库存', '备件库存');
  if (!rows) throw new Error('输入文件中未找到「库存表」工作表');
  const recs = C.toRecords(rows, ['备件编码'], '库存表',
    ['备件名称', '规格型号', '单位', '库存量', '安全库存', '库位', '状态', '位号', '材质', '压力等级', '温度范围'], warnings, ALIASES);
  if (!recs.length) throw new Error('库存表中没有有效数据行');

  const stock = [];
  for (const r of recs) {
    const code = C.str(r['备件编码']);
    if (!code) { warnings.push(`工作表「库存表」第${r._row}行 备件编码为空，已跳过`); continue; }
    const qty = num(r['库存量'], { sheet: '库存表', row: r._row, col: '库存量' });
    if (qty !== null && qty < 0) warnings.push(`工作表「库存表」第${r._row}行 备件「${code}」库存量为负（${qty}），请核实台账`);
    stock.push({
      code, name: C.str(r['备件名称']), spec: C.str(r['规格型号']), unit: C.str(r['单位']),
      qty, safety: num(r['安全库存'], { sheet: '库存表', row: r._row, col: '安全库存' }),
      loc: C.str(r['库位']), status: C.str(r['状态']), tag: C.str(r['位号']),
      material: C.str(r['材质']), pressure: C.str(r['压力等级']), temp: C.str(r['温度范围']),
      _row: r._row,
    });
  }

  // ---- 同名多编码索引（库存一律不合并）
  // 注意：备件同名不同规格是常态（如「机械密封」有多种型号），全表报警会淹没真正的问题。
  // 因此索引全表建立，但只对**与本次查询相关**的名称给出 warning。
  const byName = new Map();
  for (const s of stock) { if (!s.name) continue; const k = norm(s.name); if (!byName.has(k)) byName.set(k, []); byName.get(k).push(s); }
  const ambiguousAll = [];
  for (const [k, list] of byName) {
    const codes = [...new Set(list.map((x) => x.code))];
    if (codes.length > 1) {
      ambiguousAll.push({ key: k, name: list[0].name, codes,
        items: list.map((x) => ({ code: x.code, spec: x.spec, qty: x.qty, unit: x.unit, loc: x.loc })),
        note: '同名不同编码，库存未合并，请按编码确认' });
    }
  }

  // ---- 备件设备对应表（可选，--mapping）：位号 → 备件编码，用于库存表无「位号」列时按位号查备件
  let mapping = null;
  if (a.mapping) {
    if (!fs.existsSync(a.mapping)) throw new Error(`备件设备对应表不存在: ${a.mapping}`);
    const mr = C.pickSheet(loadBook(a.mapping), '备件设备对应', '对应', '设备备件', 'BOM', '备件清单');
    if (!mr) warnings.push('备件设备对应表文件中未找到「备件设备对应」工作表，按位号查仅用库存表的「位号」列');
    else {
      const mm = C.toRecords(mr, ['位号', '备件编码'], '备件设备对应', [], warnings, ALIASES);
      mapping = new Map();
      for (const r of mm) {
        const t = C.str(r['位号']), code = C.str(r['备件编码']);
        if (!t || !code) continue;
        if (!mapping.has(t)) mapping.set(t, new Set());
        mapping.get(t).add(norm(code));
      }
    }
  }

  // ---- 检索
  let matches = [];
  const q = a.query ? norm(a.query) : '';
  let tagSource = null;
  if (a.tag) {
    const t = norm(a.tag);
    const viaCol = stock.filter((s) => s.tag && tagHit(s.tag, t));
    const mappedCodes = new Set();
    if (mapping) for (const [k, codes] of mapping) if (tagHit(k, t)) for (const c of codes) mappedCodes.add(c);
    const viaMap = stock.filter((s) => mappedCodes.has(norm(s.code)));
    const seen = new Set();
    matches = viaCol.concat(viaMap).filter((s) => (seen.has(s.code) ? false : (seen.add(s.code), true)));
    tagSource = viaCol.length && viaMap.length ? '库存表位号列 + 备件设备对应表' : viaCol.length ? '库存表位号列' : viaMap.length ? '备件设备对应表' : null;
    if (mappedCodes.size && viaMap.length < mappedCodes.size) warnings.push(`备件设备对应表中「${a.tag}」对应的 ${mappedCodes.size - viaMap.length} 个备件编码不在库存表中（无库存记录，不按 0 处理）`);
    if (!matches.length) warnings.push(`${recs.hasCol('位号') ? '库存表位号列' : '库存表无「位号」列'}${mapping ? '与备件设备对应表' : ''}中均未查到适用设备「${a.tag}」的备件${!recs.hasCol('位号') && !mapping ? '；SAP MM 库存导出通常不带位号，请提供备件设备对应表（--mapping）' : ''}`);
  } else {
    matches = stock.filter((s) => norm(s.code) === q);
    if (!matches.length) matches = stock.filter((s) => norm(s.name) === q || norm(s.spec) === q);
    if (!matches.length && a.fuzzy) {
      matches = stock.filter((s) => norm(s.code).includes(q) || norm(s.name).includes(q) || norm(s.spec).includes(q));
      if (matches.length) warnings.push(`精确匹配无结果，已按 --fuzzy 做包含匹配，命中 ${matches.length} 条，请核对是否为所需备件`);
    }
    if (!matches.length) warnings.push(`库存表中未查到「${a.query}」；未放宽条件返回近似结果（需要模糊匹配请加 --fuzzy）`);
  }
  if (matches.length > limit) { warnings.push(`命中 ${matches.length} 条，按 --limit 仅返回前 ${limit} 条`); matches = matches.slice(0, limit); }

  // ---- 同名多编码：只保留与命中结果相关的（按名称匹配用户查的是哪一类）
  const hitNames = new Set(matches.map((m) => norm(m.name)).filter(Boolean));
  const ambiguous = ambiguousAll.filter((x) => hitNames.has(x.key)).map(({ key, ...rest }) => rest);
  for (const am of ambiguous) {
    warnings.push(`备件名「${am.name}」对应 ${am.codes.length} 个编码（${am.codes.join('、')}），库存未合并，请按编码确认`);
  }

  // ---- 低于安全库存
  const belowSafety = matches.filter((m) => m.qty !== null && m.safety !== null && m.qty < m.safety)
    .map((m) => ({ code: m.code, name: m.name, qty: m.qty, safety: m.safety, gap: C.round(m.safety - m.qty, 2), unit: m.unit }));
  // 安全库存或库存量缺失 → 无法判定
  const safetyUndetermined = matches.filter((m) => m.qty === null || m.safety === null)
    .map((m) => ({ code: m.code, name: m.name, qty: m.qty, safety: m.safety,
      reason: m.qty === null ? '库存量为空或无法解析' : '未设安全库存', note: '无法判定是否低于安全库存，未按满足处理' }));

  // ---- 在途
  let inTransit = null;
  let hasPo = false;
  if (a.intransit) {
    if (!fs.existsSync(a.intransit)) throw new Error(`在途采购表不存在: ${a.intransit}`);
    const ir = C.pickSheet(loadBook(a.intransit), '在途采购', '在途', '采购在途', '采购');
    if (!ir) warnings.push('在途文件中未找到「在途采购」工作表');
    else {
      const it = C.toRecords(ir, ['备件编码'], '在途采购', ['备件名称', '到货数量', '预计到货', '单位', '采购订单'], warnings, ALIASES);
      hasPo = it.hasCol('采购订单');
      const map = new Map();
      for (const r of it) {
        const code = C.str(r['备件编码']); if (!code) continue;
        const eta = C.normDate(r['预计到货']);
        if (r['预计到货'] && !eta) warnings.push(`工作表「在途采购」第${r._row}行 预计到货「${C.str(r['预计到货'])}」无法解析`);
        if (!map.has(code)) map.set(code, []);
        map.get(code).push({ qty: num(r['到货数量'], { sheet: '在途采购', row: r._row, col: '到货数量' }), eta, unit: C.str(r['单位']), po: C.str(r['采购订单']) || null });
      }
      inTransit = matches.map((m) => ({ code: m.code, name: m.name, arrivals: map.get(m.code) || [] }))
        .filter((x) => x.arrivals.length);
    }
  }

  // ---- 代用候选（仅列候选与差异，不下结论）
  let alternatives = null;
  if (a.alternatives) {
    const pool = [];
    if (a.catalog) {
      if (!fs.existsSync(a.catalog)) throw new Error(`备件目录不存在: ${a.catalog}`);
      const cr = C.pickSheet(loadBook(a.catalog), '备件目录', '目录', '备件清单');
      if (!cr) warnings.push('备件目录文件中未找到「备件目录」工作表，代用候选仅在库存表内检索');
      else {
        const cc = C.toRecords(cr, ['备件编码'], '备件目录',
          ['备件名称', '规格型号', '单位', '材质', '压力等级', '温度范围'], warnings, ALIASES);
        for (const r of cc) {
          const code = C.str(r['备件编码']); if (!code) continue;
          pool.push({ code, name: C.str(r['备件名称']), spec: C.str(r['规格型号']), unit: C.str(r['单位']),
            material: C.str(r['材质']), pressure: C.str(r['压力等级']), temp: C.str(r['温度范围']), qty: null, from: '备件目录' });
        }
      }
    }
    // 同一编码既在库存表又在目录里（MCP 备件目录含库存表全部物料）：合并为一条，库存量取库存表，缺的参数由目录补齐
    const byCode = new Map(pool.map((p) => [p.code, p]));
    for (const s of stock) {
      const c = byCode.get(s.code);
      if (!c) { pool.push({ ...s, from: '库存表' }); continue; }
      const merged = { ...s, from: '库存表 + 备件目录' };
      for (const f of ['name', 'spec', 'unit', 'material', 'pressure', 'temp']) if (!merged[f] && c[f]) merged[f] = c[f];
      pool[pool.indexOf(c)] = merged;
      byCode.set(s.code, merged);
    }

    alternatives = matches.map((m) => {
      const cat = SUB.categoryOf(m.name || m.spec);
      // 所查件无库存（0 或空）时，有库存的候选置顶（先按有无库存，再按相似度）；有库存时只按相似度
      const noStock = m.qty === null || m.qty <= 0;
      const cands = pool
        .filter((p) => p.code !== m.code)
        .filter((p) => SUB.categoryOf(p.name || p.spec) === cat)
        .map((p) => ({ ...p, score: C.round(SUB.specSimilarity(m.spec, p.spec) * 0.6 + SUB.specSimilarity(m.name, p.name) * 0.4, 2) }))
        .filter((p) => p.score > 0)
        .sort((x, y) => (noStock ? ((y.qty > 0 ? 1 : 0) - (x.qty > 0 ? 1 : 0)) : 0) || y.score - x.score)
        .slice(0, 5)
        .map((p) => ({
          code: p.code, name: p.name, spec: p.spec, qty: p.qty, unit: p.unit, from: p.from, score: p.score,
          // SAP 导出常无规格列、规格写在物料描述里：两边规格都空时把名称/描述纳入差异比对
          diffs: SUB.diffFields(m, p, (!m.spec && !p.spec ? ['name'] : []).concat(['spec', 'material', 'pressure', 'temp']))
            .map((d) => ({ field: { name: '名称/物料描述', spec: '规格型号', material: '材质', pressure: '压力等级', temp: '温度范围' }[d.field] || d.field,
              target: d.target, candidate: d.candidate })),
        }));
      return {
        code: m.code, name: m.name, spec: m.spec, category: cat, queriedNoStock: noStock,
        stockedFirst: noStock,
        candidates: cands,
        checkPoints: SUB.checkPoints(m.name || m.spec),
        note: '以上仅为同类候选与参数差异，**代用是否可行须由设备工程师或技术人员确认**',
      };
    });
  }

  const counts = {
    stockTotal: stock.length, matched: matches.length,
    belowSafety: belowSafety.length, safetyUndetermined: safetyUndetermined.length,
    inTransit: inTransit === null ? null : inTransit.length,
    alternatives: alternatives === null ? null : alternatives.reduce((n, x) => n + x.candidates.length, 0),
    ambiguous: ambiguous.length,
  };

  // ---- 产出
  C.ensureDir(outDir);
  const result = {
    meta: { source: path.basename(a.input), query: a.query || null, tag: a.tag || null, tagSource,
      generatedAt: C.localDateTime(), fuzzy: !!a.fuzzy, alternativesEnabled: !!a.alternatives,
      intransitProvided: !!a.intransit, catalogProvided: !!a.catalog, mappingProvided: !!a.mapping,
      statement: '库存数据来自所提供文件，实物数量以仓库实盘为准。代用是否可行须由设备工程师或技术人员确认，本技能不给出可否代用的结论。' },
    counts, matches, belowSafety, safetyUndetermined, inTransit, alternatives, ambiguous, warnings,
  };
  fs.writeFileSync(path.join(outDir, 'inventory.json'), JSON.stringify(result, null, 2), 'utf8');

  const L = [];
  L.push('# 备件库存查询结果');
  L.push('');
  L.push(`数据来源：${path.basename(a.input)}（库存共 ${stock.length} 条）　查询：${a.query || `设备 ${a.tag}${tagSource ? `（匹配依据：${tagSource}）` : ''}`}`);
  L.push(`查询时间：${C.localDateTime()}（北京时间）`);
  L.push('');
  L.push('## 一、查询结果');
  L.push('');
  if (!matches.length) {
    L.push(`**库存表中未查到${a.tag ? `适用设备「${a.tag}」的备件` : `「${a.query}」`}。**`);
    L.push('');
    L.push('> 未放宽条件返回近似结果。如需模糊匹配请加 `--fuzzy`，匹配结果需人工核对是否为所需备件。');
    L.push('');
  } else {
    L.push(C.mdTable(['备件编码', '名称', '规格型号', '库存量', '单位', '安全库存', '库位', '状态'],
      matches.map((m) => [m.code, m.name || '—', m.spec || '—', C.fmt(m.qty), m.unit || '—', C.fmt(m.safety), m.loc || '—', m.status || '—'])));
  }
  L.push('## 二、低于安全库存');
  L.push('');
  L.push(C.mdTable(['备件编码', '名称', '库存量', '安全库存', '缺口', '单位'],
    belowSafety.map((x) => [x.code, x.name || '—', C.fmt(x.qty), C.fmt(x.safety), C.fmt(x.gap), x.unit || '—'])));
  if (safetyUndetermined.length) {
    L.push('**无法判定是否低于安全库存**');
    L.push('');
    L.push(C.mdTable(['备件编码', '名称', '库存量', '安全库存', '原因'],
      safetyUndetermined.map((x) => [x.code, x.name || '—', C.fmt(x.qty), C.fmt(x.safety), x.reason])));
  }
  L.push('## 三、在途情况');
  L.push('');
  if (inTransit === null) L.push('_未提供在途采购表（--intransit），不显示在途情况。_\n');
  else if (!inTransit.length) L.push('_所查备件无在途采购记录。_\n');
  else {
    for (const t of inTransit) {
      L.push(`**${t.code}${t.name ? ' ' + t.name : ''}**`);
      L.push('');
      L.push(hasPo
        ? C.mdTable(['到货数量', '单位', '预计到货', '采购订单'], t.arrivals.map((x) => [C.fmt(x.qty), x.unit || '—', x.eta || '—', x.po || '—']))
        : C.mdTable(['到货数量', '单位', '预计到货'], t.arrivals.map((x) => [C.fmt(x.qty), x.unit || '—', x.eta || '—'])));
    }
  }
  L.push('## 四、同规格候选（代用参考）');
  L.push('');
  if (alternatives === null) L.push('_未启用代用候选检索（--alternatives）。_\n');
  else {
    for (const alt of alternatives) {
      L.push(`### ${alt.code}${alt.name ? ' ' + alt.name : ''}　（类别：${alt.category}）`);
      L.push('');
      if (alt.queriedNoStock) { L.push('> 【注意】所查件当前无库存（库存量为 0 或空），下表把有库存的同类候选置顶；仍只是候选，不是代用结论。'); L.push(''); }
      if (!alt.candidates.length) L.push('_未检索到同类候选。_\n');
      else {
        L.push(C.mdTable(['候选编码', '名称', '规格型号', '库存量', '来源', '与所查件的参数差异'],
          alt.candidates.map((c) => [c.code, c.name || '—', c.spec || '—', C.fmt(c.qty), c.from,
            c.diffs.length ? c.diffs.map((d) => `${d.field}：${d.target || '—'} → ${d.candidate || '—'}`).join('<br>') : '（所列字段无差异，其余参数未比对）'])));
      }
      L.push('**代用前须确认的技术要点**');
      L.push('');
      for (const p of alt.checkPoints) L.push(`- ${p}`);
      L.push('');
      L.push(`> ${alt.note}`);
      L.push('');
    }
  }
  L.push('## 五、同名多编码待确认');
  L.push('');
  if (!ambiguous.length) L.push('_无_\n');
  else {
    for (const am of ambiguous) {
      L.push(`**${am.name}**　${am.note}`);
      L.push('');
      L.push(C.mdTable(['备件编码', '规格型号', '库存量', '单位', '库位'],
        am.items.map((x) => [x.code, x.spec || '—', C.fmt(x.qty), x.unit || '—', x.loc || '—'])));
    }
  }
  L.push('---');
  L.push('');
  L.push(`> ${result.meta.statement}`);
  L.push('');
  L.push('> 设备台账参数（型号、投用年限、检修历史）请用 equipment-ledger-query 技能；备件需求提报用 spare-parts-demand；消耗分析用 spare-parts-consumption-analysis。');
  L.push('');
  if (warnings.length) {
    L.push('## 附：数据提示');
    L.push('');
    for (const w of warnings) L.push(`- ${w}`);
    L.push('');
  }
  fs.writeFileSync(path.join(outDir, 'inventory.md'), L.join('\n'), 'utf8');

  if (matches.length > 1) {
    writeXlsx(path.join(outDir, 'inventory.xlsx'), {
      '查询结果': [['备件编码', '名称', '规格型号', '库存量', '单位', '安全库存', '库位', '状态'],
        ...matches.map((m) => [m.code, m.name, m.spec, m.qty, m.unit, m.safety, m.loc, m.status])],
    });
  }

  C.emitOk(outDir, { ok: true, out: outDir, query: a.query || null, tag: a.tag || null, tagSource, counts, warnings });
}

try { main(); } catch (e) { C.fail(e, warnings); }
