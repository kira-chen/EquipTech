#!/usr/bin/env node
'use strict';
/**
 * 设备台账自然语言查询脚本（仅 Node.js 内置模块）
 * 用法：node scripts/query.js --input <台账xlsx> --query '<查询表达式JSON或简写>' [--out <dir>]
 *       node scripts/query.js --input <台账xlsx> --describe [--out <dir>]      # 只输出列名与样例值
 * 可选：--history <检修历史xlsx> --fields "位号,设备名称" --limit 50 --format table|detail
 * 产出：<out>/result.json、result.md、result.xlsx（多条时）、summary.json
 *
 * 口径（见顶层《中石化口径对照.md》第二节）：
 *   - 「位号」= SAP PM 功能位置 / EM 设备位号；「设备编号」= SAP 8 位设备流水号 / EM 编码，两者分列。
 *   - detail 查询同时在位号与设备编号两列里找，命中后分别展示并记录 matchedBy。
 *   - 备件关联查询不在本技能做（用 spare-parts-inventory-query）。
 *
 * 查询表达式（JSON）：
 *   {"type":"detail","tag":"P-101A"}            tag 可以是位号或设备编号
 *   {"type":"filter","where":[["专业","eq","动设备"],["投用日期","lt","2015-01-01"]],"orderBy":{"field":"投用日期","dir":"asc"}}
 *   {"type":"stats","groupBy":"专业","agg":"count"}
 * 简写：直接给位号/设备编号（如 P-101A、10012345）等价于 detail
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readXlsx, readCsvDir, writeXlsx } = require('./lib/xlsx-lite');
const C = require('./lib/common');

const warnings = [];
const VALUE_OPTS = ['input', 'query', 'out', 'history', 'spare', 'fields', 'limit', 'format'];
const FLAG_OPTS = ['help', 'describe'];

// 局部别名优先，再并入共享 SYSTEM_ALIASES（SAP PM / EM 导出列名）。
// 注意：局部不把「设备编号」作为位号别名——SAP 的设备编号是流水号，与位号分列。
//       局部也不把「设备」作为设备名称别名——SAP 导出里「设备」列就是设备编号。
const ALIASES = C.mergeAliases({
  '位号': ['位号', '设备位号', 'TAG', 'tag'],
  '设备编号': ['设备编号', 'EM编码', '设备', '设备号', '设备编码'],
  '设备名称': ['设备名称', '设备描述', '名称'],
  '规格型号': ['规格型号', '型号编号', '设备型号', '型号', '规格'],
  '制造厂': ['制造厂', '制造商', '厂家', '生产厂家', '供应商'],
  '投用日期': ['投用日期', '投用时间', '投产日期', '开始日期', '启用日期', '安装日期', '建造年份'],
  '专业': ['专业', '所属专业', '类别', '设备类别', '对象类型', '设备类型'],
  '区域': ['区域', '装置区', '位置', '所在区域', '安装位置'],
  '介质': ['介质', '工艺介质'],
  '重要度': ['重要度', 'ABC标识', '重要性', '关键度', '设备等级', 'ABC分类'],
  '状态': ['状态', '设备状态', '运行状态', '系统状态'],
  '检修日期': ['检修日期', '日期', '完工日期', '检修时间', '实际结束日期'],
  '检修内容': ['检修内容', '内容', '工作内容', '检修项目', '订单描述'],
  '工作中心': ['工作中心', '主工作中心', '承修单位', '维修班组', '施工单位'],
  '建造年份': ['建造年份', '制造年份', '出厂年份', '出厂日期'],
});
// 「设备编号」放最后：其别名含「设备」，前缀匹配时不能抢走「设备型号」等其它列
const LEDGER_OPTIONAL = ['设备名称', '规格型号', '制造厂', '建造年份', '投用日期', '专业', '区域', '介质', '重要度', '状态', '装置', '车间', '成本中心', '工作中心', '出厂编号', '设备代码', '设备编号'];
const DECLARATION = '数据来自所提供台账文件，权威数据以 EM 设备管理信息系统 / ERP（SAP PM）技术对象主数据与设备档案为准。';

const OPS = {
  eq: (a, b) => norm(a) === norm(b),
  ne: (a, b) => norm(a) !== norm(b),
  contains: (a, b) => norm(a).includes(norm(b)),
  startsWith: (a, b) => norm(a).startsWith(norm(b)),
  in: (a, b) => (Array.isArray(b) ? b.map(norm).includes(norm(a)) : false),
  gt: (a, b) => cmp(a, b) > 0, gte: (a, b) => cmp(a, b) >= 0,
  lt: (a, b) => cmp(a, b) < 0, lte: (a, b) => cmp(a, b) <= 0,
  empty: (a) => norm(a) === '', notEmpty: (a) => norm(a) !== '',
};
const norm = (v) => C.str(v).toLowerCase();
function cmp(a, b) {
  const da = C.normDate(a), db = C.normDate(b);
  if (da && db) return da < db ? -1 : da > db ? 1 : 0;
  const na = Number(C.str(a).replace(/[,，\s]/g, '')), nb = Number(C.str(b).replace(/[,，\s]/g, ''));
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb ? (na < nb ? -1 : 1) : 0;
  const sa = norm(a), sb = norm(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

function loadBook(p) { return fs.statSync(p).isDirectory() ? readCsvDir(p) : readXlsx(p); }

function parseQuery(raw) {
  const s = String(raw || '').trim();
  if (!s) throw new Error('缺少 --query（只看列名请用 --describe）');
  if (s.startsWith('{')) {
    let q; try { q = JSON.parse(s); } catch (e) { throw new Error(`--query 不是合法 JSON: ${e.message}`); }
    if (!q.type) throw new Error('--query 缺少 type 字段（detail / filter / stats）');
    if (!['detail', 'filter', 'stats'].includes(q.type)) throw new Error(`--query type 只能是 detail / filter / stats，收到「${q.type}」`);
    return q;
  }
  return { type: 'detail', tag: s };   // 简写：直接给位号或设备编号
}

/** 投用年限：仅投用日期可解析为完整日期时计算；「建造年份」只有年 → null 并提示 */
function serviceYears(v, baseDate) {
  const d = C.normDate(v);
  if (!d) return null;
  return C.round(C.diffDays(baseDate, d) / 365.25, 1);
}

function main() {
  const a = C.parseArgs(process.argv.slice(2), VALUE_OPTS, FLAG_OPTS);
  if (!a.input) throw new Error('缺少 --input');
  if (!fs.existsSync(a.input)) throw new Error(`台账不存在: ${a.input}`);
  if (a.spare) throw new Error('本技能不做备件关联查询，--spare 已停用；按位号查备件请改用 spare-parts-inventory-query 技能');
  const outDir = a.out || path.join(os.tmpdir(), 'elq-out');
  const limit = a.limit ? Number(a.limit) : 200;
  if (a.limit && !Number.isFinite(limit)) throw new Error(`--limit 「${a.limit}」不是数字`);
  const baseDate = C.localDate();

  // ---- 读台账
  const book = loadBook(a.input);
  const rows = C.pickSheet(book, '设备台账', '台账', '设备清单', '技术对象', '功能位置', '设备');
  if (!rows) throw new Error('输入文件中未找到「设备台账」工作表（可接受：设备台账 / 台账 / 设备清单 / 技术对象 / 功能位置 / 设备）');
  // 先按「位号」找表头行；旧台账只有「设备编号」列时，改以「设备编号」为必需列再识别一次表头
  let recs = C.toRecords(rows, ['位号'], '设备台账', LEDGER_OPTIONAL, [], ALIASES);
  if (!recs.hasCol('位号')) {
    const w2 = [];
    const alt = C.toRecords(rows, ['设备编号'], '设备台账', LEDGER_OPTIONAL.filter((c) => c !== '设备编号').concat('位号'), w2, ALIASES);
    if (!alt.hasCol('设备编号')) throw new Error('设备台账既无「位号」（功能位置）列也无「设备编号」列，无法定位设备');
    recs = alt; warnings.push(...w2);
    warnings.push('台账无「位号/功能位置」列，仅按「设备编号」定位设备');
  } else {
    // 重跑一次以收集 warning（第一次为探测，未收集）
    recs = C.toRecords(rows, ['位号'], '设备台账', LEDGER_OPTIONAL, warnings, ALIASES);
  }
  if (!recs.length) throw new Error('设备台账中没有有效数据行');

  // 实际存在的列（查询不存在的字段时要明确告知，不能用相近字段替代）
  const allCols = new Set();
  for (const r of recs) for (const k of Object.keys(r)) if (!k.startsWith('_')) allCols.add(k);
  const FIRST = ['位号', '设备编号'];
  const presentCols = [...allCols].filter((c) => recs.hasCol(c)).sort((x, y) => (FIRST.indexOf(x) < 0 ? 9 : FIRST.indexOf(x)) - (FIRST.indexOf(y) < 0 ? 9 : FIRST.indexOf(y)));
  const fieldsNotFound = [];
  const checkField = (f) => {
    if (!presentCols.includes(f)) { if (!fieldsNotFound.includes(f)) fieldsNotFound.push(f); return false; }
    return true;
  };

  // ---- --describe：只输出列名与样例值，不做查询
  if (a.describe) {
    const describe = presentCols.map((c) => {
      const vals = [];
      let filled = 0;
      for (const r of recs) {
        const v = C.str(r[c]);
        if (!v) continue;
        filled++;
        if (vals.length < 3 && !vals.includes(v)) vals.push(v);
      }
      return { column: c, filled, empty: recs.length - filled, samples: vals };
    });
    C.ensureDir(outDir);
    const result = {
      meta: { source: path.basename(a.input), generatedAt: C.localDateTime(), queryType: 'describe', baseDate, presentColumns: presentCols },
      counts: { ledgerTotal: recs.length, columns: presentCols.length },
      describe, warnings,
    };
    fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(result, null, 2), 'utf8');
    const L = [];
    L.push('# 设备台账列结构');
    L.push('');
    L.push(`数据来源：${path.basename(a.input)}（台账共 ${recs.length} 条，识别到 ${presentCols.length} 列）　生成时间：${C.localDateTime()}（北京时间）`);
    L.push('');
    L.push('## 一、列名与样例值');
    L.push('');
    L.push(C.mdTable(['技能内列名', '已填行数', '空行数', '样例值（最多 3 个）'],
      describe.map((d) => [d.column, d.filled, d.empty, d.samples.join('；') || '—'])));
    L.push('> 列名已按别名表归一（如 SAP 的「功能位置」显示为「位号」、「设备描述」显示为「设备名称」）。查询条件请用本表第一列的名字。');
    L.push('');
    L.push('---');
    L.push('');
    L.push(`> ${DECLARATION}`);
    L.push('');
    if (warnings.length) { L.push('## 附：数据提示'); L.push(''); for (const w of warnings) L.push(`- ${w}`); L.push(''); }
    fs.writeFileSync(path.join(outDir, 'result.md'), L.join('\n'), 'utf8');
    C.emitOk(outDir, { ok: true, out: outDir, queryType: 'describe', counts: result.counts, columns: presentCols, warnings });
    return;
  }

  const q = parseQuery(a.query);

  // ---- 关联表：检修历史（通知单/工单导出亦可，按位号关联）
  let historyMap = null;
  if (a.history) {
    if (!fs.existsSync(a.history)) throw new Error(`检修历史不存在: ${a.history}`);
    const hr = C.pickSheet(loadBook(a.history), '检修历史', '检修记录', '维修记录', '历史', '工单', '订单');
    if (!hr) warnings.push('检修历史文件中未找到「检修历史」工作表');
    else {
      const h = C.toRecords(hr, ['位号'], '检修历史', ['检修日期', '检修内容', '工作中心', '工单号', '工单类型'], warnings, ALIASES);
      historyMap = new Map();
      for (const r of h) {
        const t = norm(r['位号']); if (!t) continue;
        if (!historyMap.has(t)) historyMap.set(t, []);
        historyMap.get(t).push({ date: C.normDate(r['检修日期']), content: C.str(r['检修内容']), vendor: C.str(r['工作中心']), order: C.str(r['工单号']) || null, orderType: C.str(r['工单类型']) || null });
      }
      for (const v of historyMap.values()) v.sort((x, y) => (y.date || '').localeCompare(x.date || ''));
    }
  }

  // ---- 执行查询
  let records = [], stats = null, appliedFilters = [];
  if (q.type === 'detail') {
    if (!q.tag) throw new Error('detail 查询缺少 tag（位号或设备编号）');
    const key = norm(q.tag);
    const hit = recs.filter((r) => norm(r['位号']) === key || norm(r['设备编号']) === key);
    for (const r of hit) r._matchedBy = norm(r['位号']) === key ? '位号' : '设备编号';
    if (!hit.length) warnings.push(`台账中未查到位号或设备编号「${q.tag}」`);
    records = hit;
    appliedFilters = [`位号或设备编号 = ${q.tag}`];
  } else if (q.type === 'filter' || q.type === 'stats') {
    let list = recs;
    for (const w of (q.where || [])) {
      if (!Array.isArray(w) || w.length < 2) throw new Error(`where 条件格式应为 [字段, 操作符, 值]，收到 ${JSON.stringify(w)}`);
      const [f, op, val] = w;
      if (!OPS[op]) throw new Error(`不支持的操作符「${op}」，可用: ${Object.keys(OPS).join(', ')}`);
      // 字段不存在时不能"跳过条件后照常返回"，否则用户会误以为结果是按条件筛出来的
      if (!checkField(f)) throw new Error(`台账中无字段「${f}」，无法按该条件筛选；台账实际字段：${presentCols.join('、')}（可用 --describe 查看列名与样例值）`);
      list = list.filter((r) => OPS[op](r[f], val));
      appliedFilters.push(`${f} ${op} ${Array.isArray(val) ? JSON.stringify(val) : val === undefined ? '' : val}`);
    }
    if (q.orderBy && q.orderBy.field) {
      if (checkField(q.orderBy.field)) {
        const dir = q.orderBy.dir === 'desc' ? -1 : 1;
        list = list.slice().sort((x, y) => dir * cmp(x[q.orderBy.field], y[q.orderBy.field]));
      } else warnings.push(`台账中无字段「${q.orderBy.field}」，排序已跳过`);
    }
    if (q.type === 'filter') {
      records = list.slice(0, limit);
      if (list.length > limit) warnings.push(`命中 ${list.length} 条，按 --limit 仅返回前 ${limit} 条`);
    } else {
      const gb = q.groupBy;
      if (gb && !checkField(gb)) throw new Error(`统计字段「${gb}」不在台账中（可用 --describe 查看列名）`);
      const groups = new Map();
      for (const r of list) {
        const k = gb ? (C.str(r[gb]) || '（空）') : '全部';
        groups.set(k, (groups.get(k) || 0) + 1);
      }
      stats = {
        total: list.length, groupBy: gb || null,
        groups: [...groups.entries()].map(([k, v]) => ({ key: k, count: v })).sort((x, y) => y.count - x.count),
      };
      records = [];
    }
  }

  // ---- 补充派生信息
  let yearOnlyCount = 0;
  const enriched = records.map((r) => {
    const o = { _row: r._row };
    for (const c of presentCols) o[c] = C.str(r[c]) || null;
    if (r._matchedBy) o._matchedBy = r._matchedBy;
    const tag = norm(r['位号']);
    // 投用年限：仅在投用日期可解析时计算，并注明基准；「建造年份」只有年 → null
    const raw = C.str(r['投用日期']);
    o['_投用年限'] = serviceYears(raw, baseDate);
    if (raw && o['_投用年限'] === null) { yearOnlyCount++; o['_投用年限说明'] = `投用日期「${raw}」不是完整日期，未推算年限`; }
    else if (!raw && C.str(r['建造年份'])) { yearOnlyCount++; o['_投用年限说明'] = `台账只有建造年份「${C.str(r['建造年份'])}」（SAP 建造年份只到年）且无投用/开始日期，未推算年限`; }
    if (historyMap) o['_检修历史'] = (tag && historyMap.get(tag)) || [];
    return o;
  });
  if (yearOnlyCount) warnings.push(`${yearOnlyCount} 台投用日期缺失或不是完整日期（如只有建造年份），投用年限未推算`);

  const counts = { ledgerTotal: recs.length, matched: q.type === 'stats' ? stats.total : enriched.length, fieldsNotFound: fieldsNotFound.length };

  // ---- 产出
  C.ensureDir(outDir);
  const result = {
    meta: { source: path.basename(a.input), generatedAt: C.localDateTime(), queryType: q.type, baseDate,
      historyProvided: !!historyMap, presentColumns: presentCols, hasTagCol: recs.hasCol('位号'), hasEquipNoCol: recs.hasCol('设备编号') },
    counts, appliedFilters, records: enriched, stats, fieldsNotFound, warnings,
  };
  fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(result, null, 2), 'utf8');

  const L = [];
  L.push('# 设备台账查询结果');
  L.push('');
  L.push(`数据来源：${path.basename(a.input)}（台账共 ${recs.length} 条）　查询时间：${C.localDateTime()}（北京时间）`);
  L.push('');
  if (appliedFilters.length) { L.push(`生效条件：${appliedFilters.join('　且　')}`); L.push(''); }

  const showId = (r) => {
    const t = r['位号'] || '—（位号未填）';
    const n = r['设备编号'];
    return recs.hasCol('设备编号') ? `${t}（设备编号 ${n || '—'}）` : t;
  };
  if (q.type === 'stats') {
    L.push('## 一、统计结果');
    L.push('');
    L.push(`命中 **${stats.total}** 条${stats.groupBy ? `，按「${stats.groupBy}」分组：` : ''}`);
    L.push('');
    L.push(C.mdTable([stats.groupBy || '分组', '数量', '占比'],
      stats.groups.map((g) => [g.key, g.count, stats.total ? `${(g.count / stats.total * 100).toFixed(1)}%` : '—'])));
  } else if (!enriched.length) {
    L.push('## 一、查询结果');
    L.push('');
    L.push('**台账中未查到符合条件的设备。**');
    L.push('');
    L.push('> 未放宽条件返回近似结果。如需模糊匹配，请改用 `contains` 操作符重新查询；若用的是设备编号，请确认是 SAP 8 位设备号而不是功能位置。');
    L.push('');
  } else if (q.type === 'detail' || a.format === 'detail' || enriched.length === 1) {
    L.push('## 一、设备详情');
    L.push('');
    for (const r of enriched) {
      L.push(`### ${showId(r)}${r['设备名称'] ? '　' + r['设备名称'] : ''}`);
      L.push('');
      if (r._matchedBy) L.push(`命中依据：按「${r._matchedBy}」匹配。`);
      L.push('');
      const rows = presentCols.map((c) => [c, r[c] === null ? '—（台账未填）' : r[c]]);
      if (r['_投用年限'] !== null) rows.push(['投用年限', `${r['_投用年限']} 年（以 ${baseDate} 为基准计算）`]);
      else if (r['_投用年限说明']) rows.push(['投用年限', `—（${r['_投用年限说明']}）`]);
      L.push(C.mdTable(['字段', '值'], rows));
      if (historyMap) {
        L.push('#### 检修历史（通知单/工单）');
        L.push('');
        L.push(C.mdTable(['检修日期', '工单号', '检修内容', '工作中心/承修单位'],
          (r['_检修历史'] || []).map((h) => [h.date || '—', h.order || '—', h.content || '—', h.vendor || '—'])));
      }
    }
  } else {
    const cols = a.fields ? a.fields.split(',').map((s) => s.trim()).filter((f) => { const okf = presentCols.includes(f); if (!okf) { warnings.push(`台账中无字段「${f}」，已从返回列中移除`); if (!fieldsNotFound.includes(f)) fieldsNotFound.push(f); } return okf; })
      : presentCols.slice(0, 8);
    L.push(`## 一、查询结果（${enriched.length} 条）`);
    L.push('');
    L.push(C.mdTable(cols, enriched.map((r) => cols.map((c) => r[c] === null ? '—' : r[c]))));
  }

  if (fieldsNotFound.length) {
    L.push('## 二、台账中不存在的字段');
    L.push('');
    for (const f of fieldsNotFound) L.push(`- **${f}**：台账中无此列，未用相近字段代替，也未补充推算值`);
    L.push('');
  }
  L.push('【注意】备件库存与代用请用 spare-parts-inventory-query 技能；图纸、说明书、规程请用 technical-document-finder 技能。');
  L.push('');
  L.push('---');
  L.push('');
  L.push(`> ${DECLARATION}`);
  L.push('');
  if (warnings.length) {
    L.push('## 附：数据提示');
    L.push('');
    for (const w of warnings) L.push(`- ${w}`);
    L.push('');
  }
  fs.writeFileSync(path.join(outDir, 'result.md'), L.join('\n'), 'utf8');

  // 多条结果导出 xlsx
  if (enriched.length > 1) {
    const cols = presentCols;
    writeXlsx(path.join(outDir, 'result.xlsx'), { '查询结果': [cols, ...enriched.map((r) => cols.map((c) => r[c]))] });
  }

  C.emitOk(outDir, { ok: true, out: outDir, queryType: q.type, counts, appliedFilters, fieldsNotFound, warnings });
}

try { main(); } catch (e) { C.fail(e, warnings); }
