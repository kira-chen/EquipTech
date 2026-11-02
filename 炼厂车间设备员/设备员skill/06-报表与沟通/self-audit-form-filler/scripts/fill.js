#!/usr/bin/env node
'use strict';
/**
 * 专项检查自查表预填脚本（仅 Node.js 内置模块）
 * 用法：node "<技能目录>/scripts/fill.js" --form <自查表xlsx/docx> --data <台账xlsx[,xlsx2...]>
 *       --workshop "<车间名>" [--out <dir>]
 * 可选：--last "<上次自查表>" --spec "<厂内填报要求>" --period "<自查周期或时点>"
 * 产出：<out>/自查表预填稿.xlsx、填写说明.md、filled.json、summary.json；末行打印 JSON 摘要
 *
 * 硬约束（见 references/fill-rules.md，改动前务必先读）：
 *  1. 判断类 / 评价类 / 承诺类自查项一律留空标 needJudgment，**绝不预填「符合」「已落实」「健全」**
 *  2. 有数据源但数据缺失 → noData 留空并说明缺什么数据，**绝不按「符合」处理**
 *  3. 预填项必须在备注/依据列注明数据来源文件与记录
 *  4. 不做合规性达标判定
 *  5. 不代替责任人签字
 *  6. 固定声明行逐字保留
 *  7. 表结构复杂或合并单元格多 → 提示先请用户确认解析结果，不直接交付填写结果
 */
const fs = require('fs');
const path = require('path');
const { readXlsx, readCsvDir, writeXlsx } = require('./lib/xlsx-lite');
const M = require('./lib/merge-lite');
const lite = require('./lib/docx-lite');
const C = require('./lib/common');
const S = require('./lib/audit-spec');

const warnings = [];
const VALUE_OPTS = ['form', 'data', 'workshop', 'out', 'last', 'spec', 'period'];
const FLAG_OPTS = ['help'];

/** SKILL.md 要求逐字保留的声明行，不得删除或改写 */
const STATEMENT = '本表为预填稿，判断类项目与最终结论须由责任人核实填写并签字；预填内容需逐项核对后方可提交。';
/** 表结构复杂时写在 md 开头的醒目提示 */
const COMPLEX_ALERT = '【注意】本自查表结构复杂（合并单元格较多或表头层次多），预填结果须先与用户核对解析是否正确，确认后再填写提交';
/** 存在判断类项时写在 md 开头的醒目提示 */
const JUDGMENT_ALERT = '【注意】存在须责任人判断的自查项，脚本一律留空未填；不得以「符合」「已落实」「健全」等表述代填';

const FORM_ALIASES = {
  '自查项': ['自查项', '自查内容', '检查内容', '自查项目', '检查项', '检查项目', '项目', '内容', '自查要点', '检查要点', '要点'],
  '序号': ['序号', '编号', 'No', 'NO'],
  '自查类别': ['自查类别', '类别', '检查类别', '专业', '分类', '大类', '项目类别'],
  '自查依据': ['自查依据', '依据', '标准依据', '法规依据', '对照标准'],
  '现状': ['现状', '自查情况', '实际情况', '现状描述', '填写内容', '自查结果', '检查情况', '情况说明'],
  '是否符合': ['是否符合', '符合情况', '是否达标', '自查结论', '结论', '评价'],
  '证据材料': ['证据材料', '支撑材料', '佐证材料', '查阅资料', '依据记录'],
  '整改措施': ['整改措施', '整改要求', '整改意见', '措施', '下步措施'],
  '责任人': ['责任人', '负责人', '填报人', '签字'],
  '备注': ['备注', '说明', '备注说明'],
  // 打分与结论类列：写了就是代做考核评价，一律不写
  '得分': ['得分', '实得分', '分数', '评分', '自评得分', '实际得分'],
  '扣分': ['扣分', '扣分值', '扣减分', '扣分原因'],
  '标准分': ['标准分', '分值', '应得分', '满分', '标准分值'],
  '检查结论': ['检查结论', '检查意见', '审核结论', '复查结论', '核查结论', '检查结果'],
  '自评': ['自评', '自评结果', '自我评价', '自查评价', '自评等级', '自评结论'],
};
/** 允许脚本写入的「可填列」——现状/证据材料/备注三类。是否符合、整改措施、责任人一律不写 */
const WRITABLE = ['现状', '证据材料', '备注'];
/** 脚本绝不写入的列（写了就等于代做判断、代打分或代签字） */
const NEVER_WRITE = ['是否符合', '整改措施', '责任人', '得分', '扣分', '标准分', '检查结论', '自评'];

function loadBook(p) { return fs.statSync(p).isDirectory() ? readCsvDir(p) : readXlsx(p); }

/* ================================================================== 一、自查表结构解析 */

/**
 * 解析 xlsx 自查表：保留原始行列矩阵（后面要原样回写），并定位表头行与各列下标。
 * 返回 { sheetName, rows, headerRow, cols, merges, items }
 */
function parseFormXlsx(file) {
  const src = path.basename(file);
  const book = loadBook(file);
  const keys = Object.keys(book);
  if (!keys.length) throw new Error(`自查表文件「${src}」中没有任何工作表`);
  // 先按名字找，找不到就取第一张有内容的表
  let sheetName = null;
  for (const n of ['自查表', '自查', '检查表', '自查清单', '检查清单']) {
    const norm = (s) => String(s).replace(/[\s表]/g, '');
    const t = norm(n);
    const k = keys.find((x) => norm(x) === t) || keys.find((x) => norm(x).includes(t) || t.includes(norm(x)));
    if (k) { sheetName = k; break; }
  }
  if (!sheetName) {
    sheetName = keys.find((k) => (book[k] || []).some((r) => (r || []).some((c) => C.str(c)))) || keys[0];
    warnings.push(`自查表「${src}」中未找到名为「自查表」的工作表，已按第一张有内容的工作表「${sheetName}」解析`);
  }
  const rows = (book[sheetName] || []).map((r) => (r || []).slice());
  if (!rows.length) throw new Error(`自查表工作表「${sheetName}」为空`);

  // 合并单元格
  let merges = [];
  let mergeReadable = true;
  try {
    const all = M.readMerges(file);
    merges = all[sheetName] || [];
  } catch (e) {
    mergeReadable = false;
    warnings.push(`自查表「${src}」的合并单元格信息读取失败（${e.message}），已按无合并处理，但填写前请人工确认表结构`);
  }

  // 表头行：前 12 行中命中「自查项」别名的那一行（自查表常有 1~3 行标题）
  const normRow = (r) => (r || []).map((c) => C.str(c).replace(/\s+/g, ''));
  let headerRow = -1;
  for (let i = 0; i < Math.min(12, rows.length); i++) {
    if (C.findCol(normRow(rows[i]), '自查项', FORM_ALIASES) >= 0) { headerRow = i; break; }
  }
  if (headerRow < 0) throw new Error(`自查表工作表「${sheetName}」前 12 行中未找到含「自查项」「检查内容」等表头的行（实际首行：${normRow(rows[0]).filter(Boolean).join(' | ') || '空'}）`);

  const header = normRow(rows[headerRow]);
  // 两轮分配（全等优先、再前缀），与 common.toRecords 同口径，避免「自查项」抢走「自查项类别」
  const names = Object.keys(FORM_ALIASES);
  const cols = {};
  const taken = new Set();
  for (const n of names) cols[n] = -1;
  for (const n of names) {
    for (const al of FORM_ALIASES[n]) {
      const j = header.findIndex((x, i) => x === al && !taken.has(i));
      if (j >= 0) { cols[n] = j; taken.add(j); break; }
    }
  }
  for (const n of names) {
    if (cols[n] >= 0) continue;
    for (const al of FORM_ALIASES[n]) {
      const j = header.findIndex((x, i) => x && x.startsWith(al) && !taken.has(i));
      if (j >= 0) { cols[n] = j; taken.add(j); break; }
    }
  }

  // 可填列：至少要有一个，否则没法写
  const writable = WRITABLE.filter((n) => cols[n] >= 0);
  if (!writable.length) {
    warnings.push(`自查表工作表「${sheetName}」未找到「现状」「证据材料」「备注」中的任何一列，预填内容无处写入，将只输出待填清单（实际表头：${header.filter(Boolean).join(' | ') || '空'}）`);
  }

  // 逐行抽自查项
  const items = [];
  const ci = cols['自查项'];
  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    if (!r.some((c) => C.str(c))) continue;
    const first = C.str(r[0]);
    if (/^(合计|小计|总计|共计)/.test(first)) { warnings.push(`自查表「${sheetName}」第${i + 1}行为合计行，已跳过`); continue; }
    // 签字栏、填报说明行不是自查项
    if (/^(填报人|责任人签字|车间负责人|签字|审核人|说明|注)[:：]?$/.test(first)) {
      warnings.push(`自查表「${sheetName}」第${i + 1}行为签字/说明栏「${first}」，不作为自查项，脚本不代签字`);
      continue;
    }
    const text = C.str(r[ci]);
    if (!text) {
      // 合并单元格的从属行：自查项列被上一行合并占用，不重复计一项
      if (merges.length && M.isMergedFollower(merges, i, ci)) continue;
      warnings.push(`自查表「${sheetName}」第${i + 1}行 自查项为空，已跳过（未按上一行内容补齐）`);
      continue;
    }
    items.push({
      no: cols['序号'] >= 0 ? (C.str(r[cols['序号']]) || String(items.length + 1)) : String(items.length + 1),
      text,
      category: cols['自查类别'] >= 0 ? C.str(r[cols['自查类别']]) : '',
      basis: cols['自查依据'] >= 0 ? C.str(r[cols['自查依据']]) : '',
      row: i,
      src: `${src}/${sheetName} 第${i + 1}行`,
      inMerge: merges.length ? !!M.mergeAt(merges, i, ci) : false,
    });
  }
  return { file, src, sheetName, rows, headerRow, header, cols, writable, merges, mergeReadable, items };
}

/** 解析 docx 自查表：只抽自查项文字，不回写 docx（docx 原样回写超出本技能范围） */
function parseFormDocx(file) {
  const src = path.basename(file);
  let res;
  try { res = lite.docxToText(fs.readFileSync(file)); } catch (e) { throw new Error(`自查表解析失败 ${src}: ${e.message}`); }
  const items = [];
  for (const b of res.blocks) {
    if (b.kind !== 'table' || !b.rows || b.rows.length < 2) continue;
    const hdr = (b.rows[0] || []).map((c) => C.str(c).replace(/\s+/g, ''));
    const ci = C.findCol(hdr, '自查项', FORM_ALIASES);
    if (ci < 0) continue;
    const ni = C.findCol(hdr, '序号', FORM_ALIASES);
    const gi = C.findCol(hdr, '自查类别', FORM_ALIASES);
    const bi = C.findCol(hdr, '自查依据', FORM_ALIASES);
    for (let i = 1; i < b.rows.length; i++) {
      const r = b.rows[i] || [];
      const t = C.str(r[ci]);
      if (!t) continue;
      if (/^(合计|小计|总计|共计)/.test(C.str(r[0]))) { warnings.push(`自查表「${src}」表格第${i + 1}行为合计行，已跳过`); continue; }
      items.push({
        no: (ni >= 0 && C.str(r[ni])) || String(items.length + 1), text: t,
        category: gi >= 0 ? C.str(r[gi]) : '', basis: bi >= 0 ? C.str(r[bi]) : '',
        row: -1, src: `${src} 表格第${i + 1}行`, inMerge: false,
      });
    }
  }
  if (!items.length) throw new Error(`自查表「${src}」中未找到含「自查项」「检查内容」等表头的表格，请改用 .xlsx 自查表`);
  warnings.push(`自查表为 .docx 格式，脚本只抽取自查项并输出 xlsx 预填稿，**不回写原 docx**，原表版式需人工套用`);
  return { file, src, sheetName: null, rows: null, headerRow: -1, header: [], cols: {}, writable: [], merges: [], mergeReadable: true, items };
}

function parseForm(p) {
  if (!fs.existsSync(p)) throw new Error(`自查表不存在: ${p}`);
  if (fs.statSync(p).isDirectory()) throw new Error(`--form 不接受目录: ${p}`);
  const ext = path.extname(p).toLowerCase();
  if (ext === '.xlsx' || ext === '.xlsm') return parseFormXlsx(p);
  if (ext === '.docx') return parseFormDocx(p);
  throw new Error(`--form 不支持的格式「${ext}」，仅支持 .xlsx / .docx；PDF 请先用平台 pdf 技能转为 docx/xlsx 再传入（扫描件需 OCR），脚本不读 PDF`);
}

/* ================================================================== 二、台账数据装载 */

/**
 * 把每个数据文件的每张工作表读成一个「数据表」对象：
 *  { file, sheet, sourceKey, rows, headerRow, header, records }
 * 不预设字段——自查表千变万化，字段在取数时按需找。
 */
function loadData(paths) {
  const tables = [];
  for (const p of paths) {
    if (!fs.existsSync(p)) throw new Error(`台账与记录文件不存在: ${p}`);
    const src = path.basename(p);
    let book;
    try { book = loadBook(p); } catch (e) { throw new Error(`台账与记录文件解析失败 ${src}: ${e.message}`); }
    const names = Object.keys(book);
    if (!names.length) { warnings.push(`台账文件「${src}」中没有任何工作表，已跳过`); continue; }
    for (const n of names) {
      const rows = (book[n] || []).filter((r) => (r || []).some((c) => C.str(c)));
      if (!rows.length) { warnings.push(`台账「${src}/${n}」为空表，已跳过`); continue; }
      // 表头行：前 6 行中非空单元格最多的一行
      let headerRow = 0, best = -1;
      for (let i = 0; i < Math.min(6, rows.length); i++) {
        const cnt = (rows[i] || []).filter((c) => C.str(c)).length;
        if (cnt > best) { best = cnt; headerRow = i; }
      }
      const header = (rows[headerRow] || []).map((c) => C.str(c).replace(/\s+/g, ''));
      const records = [];
      for (let i = headerRow + 1; i < rows.length; i++) {
        const r = rows[i] || [];
        if (/^(合计|小计|总计|共计)/.test(C.str(r[0]))) {
          warnings.push(`台账「${src}/${n}」第${i + 1}行为合计行，已跳过`);
          continue;
        }
        const o = { _row: i + 1 };
        header.forEach((h, j) => { if (h) o[h] = r[j] === undefined ? null : r[j]; });
        records.push(o);
      }
      const sourceKey = S.sheetSource(n) || S.sheetSource(src);
      if (!sourceKey) warnings.push(`台账「${src}/${n}」无法归入任何已知数据源类别，该表不会被自动取数（可在自查项中写明具体台账名后重试）`);
      tables.push({ file: src, sheet: n, sourceKey, header, records, count: records.length });
    }
  }
  if (!tables.length) throw new Error('所提供的台账与记录文件中没有任何可用数据表');
  return tables;
}

/** 在数据表 header 里找第一个包含任一关键词的列名 */
function findField(header, words) {
  for (const w of words) { const h = header.find((x) => x && S.norm(x).includes(S.norm(w))); if (h) return h; }
  return null;
}

const DATE_FIELDS = ['下次检验', '下次校验', '有效期至', '到期日', '到期时间', '检验有效期'];
const LAST_FIELDS = ['上次检验', '本次检验', '检验日期', '校验日期', '上次校验', '完成日期', '记录日期', '日期'];

/* ================================================================== 三、逐项取数 */

/**
 * 对一个客观自查项取数。返回 { value, sourceNote, evidence } 或 null（取不到数）。
 * **只搬运事实**：有无、多少、什么时候、到没到期。绝不生成「符合」「正常」这类结论。
 */
function fetchValue(item, cls, tables, asOf) {
  const cands = tables.filter((t) => t.sourceKey && cls.sources.includes(t.sourceKey));
  if (!cands.length) return { value: null, reason: 'noSource', missing: cls.sources.length
    ? `未提供「${cls.sources.map((k) => S.SOURCE_CN.get(k)).join('、')}」类数据表`
    : '自查项中未出现可识别的台账名称，无法确定数据源' };

  const t = cands[0];
  const where = `${t.file}/${t.sheet}`;
  if (!t.records.length) {
    return { value: null, reason: 'empty', missing: `数据表「${where}」中没有任何数据行`, table: where };
  }

  switch (cls.kind) {
    case 'exist': {
      return {
        value: `有，${t.records.length} 条记录`,
        sourceNote: `数据来源：${where}（共 ${t.records.length} 条记录）`,
        evidence: `${where} 第${t.records[0]._row}~${t.records[t.records.length - 1]._row}行`,
        table: where,
      };
    }
    case 'count': {
      return {
        value: `${t.records.length}`,
        sourceNote: `数据来源：${where}，按记录行计数`,
        evidence: `${where} 共 ${t.records.length} 行`,
        table: where,
      };
    }
    case 'text': {
      const f = findField(t.header, ['名称', '设备名称', '位号', '编号', '型号', '规格', '装置']);
      if (!f) return { value: null, reason: 'noField', missing: `数据表「${where}」中没有名称/位号/编号类字段`, table: where };
      const vals = [...new Set(t.records.map((r) => C.str(r[f])).filter(Boolean))];
      if (!vals.length) return { value: null, reason: 'noField', missing: `数据表「${where}」列「${f}」全为空`, table: where };
      const shown = vals.slice(0, 5).join('、') + (vals.length > 5 ? ` 等 ${vals.length} 项` : '');
      return { value: shown, sourceNote: `数据来源：${where} 列「${f}」`, evidence: `${where} 列「${f}」`, table: where };
    }
    case 'date': {
      const f = findField(t.header, LAST_FIELDS);
      if (!f) return { value: null, reason: 'noField', missing: `数据表「${where}」中没有日期类字段（上次检验/校验日期/完成日期等）`, table: where };
      const ds = t.records.map((r) => ({ d: C.normDate(r[f]), row: r._row, raw: C.str(r[f]) }));
      const bad = ds.filter((x) => !x.d && x.raw);
      for (const b of bad) warnings.push(`台账「${where}」第${b.row}行 列「${f}」日期「${b.raw}」无法解析，该条不参与取数（未按空值或今日处理）`);
      const good = ds.filter((x) => x.d);
      if (!good.length) return { value: null, reason: 'noValue', missing: `数据表「${where}」列「${f}」没有可解析的日期`, table: where };
      good.sort((a, b) => (a.d < b.d ? 1 : -1));
      return {
        value: good[0].d,
        sourceNote: `数据来源：${where} 列「${f}」，取最近一条（第${good[0].row}行）${bad.length ? `；另有 ${bad.length} 条日期无法解析未参与` : ''}`,
        evidence: `${where} 第${good[0].row}行`, table: where,
      };
    }
    case 'due': {
      const f = findField(t.header, DATE_FIELDS);
      if (!f) return { value: null, reason: 'noField', missing: `数据表「${where}」中没有到期日字段（下次检验/有效期至/到期日等）`, table: where };
      let overdue = 0, valid = 0, unknown = 0;
      const overdueRows = [];
      for (const r of t.records) {
        const d = C.normDate(r[f]);
        if (!d) { unknown++; continue; }
        const diff = C.diffDays(d, asOf);
        if (diff === null) { unknown++; continue; }
        if (diff < 0) { overdue++; overdueRows.push(`第${r._row}行(${d})`); } else valid++;
      }
      if (unknown === t.records.length) {
        return { value: null, reason: 'noValue', missing: `数据表「${where}」列「${f}」全部无法解析为日期，到期情况无法取数`, table: where };
      }
      if (unknown) warnings.push(`台账「${where}」列「${f}」有 ${unknown} 条到期日为空或无法解析，已计入「到期日不详」，未按未超期处理`);
      const bits = [`截至 ${asOf}：已过期 ${overdue} 台/项，未到期 ${valid} 台/项`];
      if (unknown) bits.push(`到期日不详 ${unknown} 台/项`);
      return {
        value: bits.join('，'),
        sourceNote: `数据来源：${where} 列「${f}」，与自查时点 ${asOf} 比较得出${overdueRows.length ? `；已过期条目：${overdueRows.slice(0, 5).join('、')}${overdueRows.length > 5 ? ' 等' : ''}` : ''}`,
        evidence: `${where} 列「${f}」`, table: where,
        extra: { overdue, valid, unknown },
      };
    }
    case 'complete': {
      // 「齐全」只按条目字段填报率算，不做「管理完备」的评价
      // 先找「结论/记录/状态」这类逐条填报的业务字段，找不到再退回日期字段
      const f = findField(t.header, ['结论', '记录', '状态', '结果', '情况'].concat(LAST_FIELDS, DATE_FIELDS));
      if (!f) return { value: null, reason: 'noField', missing: `数据表「${where}」中没有可用于判断条目完整性的字段（日期/记录/状态）`, table: where };
      const filled = t.records.filter((r) => C.str(r[f])).length;
      const blank = t.records.length - filled;
      return {
        value: `共 ${t.records.length} 条，列「${f}」已填 ${filled} 条、空缺 ${blank} 条`,
        sourceNote: `数据来源：${where}，按列「${f}」填报情况计数；**齐全与否由责任人判断，此处只报条目计数**`,
        evidence: `${where} 列「${f}」`, table: where,
        extra: { total: t.records.length, filled, blank },
      };
    }
    default:
      return { value: null, reason: 'noSource', missing: '未能确定取数方式' };
  }
}

/* ================================================================== 四、主流程 */

function main() {
  const a = C.parseArgs(process.argv.slice(2), VALUE_OPTS, FLAG_OPTS);
  for (const k of ['form', 'data', 'workshop']) if (!a[k]) throw new Error(`缺少 --${k}`);

  // 自查时点必填：到期类自查项以它为基准日，不得默认按脚本运行日（硬约束：缺数据不补齐、不按默认）
  if (!a.period) throw new Error('缺少 --period（自查时点，YYYY-MM-DD）：到期类自查项以此为基准日，脚本不按运行日默认');
  const asOf = C.normDate(a.period);
  if (!asOf) throw new Error(`--period「${a.period}」不是 YYYY-MM-DD 日期；自查周期为「2026年三季度」这类文字时，请把周期截止日（如 2026-09-30）作为自查时点传入`);
  const periodText = String(a.period).trim();
  if (a.last && !fs.existsSync(a.last)) throw new Error(`上次自查表不存在: ${a.last}`);
  if (a.spec && !fs.existsSync(a.spec)) throw new Error(`厂内填报要求说明不存在: ${a.spec}`);

  const outDir = a.out || path.join(require('os').tmpdir(), 'saff-out');

  const form = parseForm(a.form);
  if (!form.items.length) throw new Error(`未从「${form.src}」解析出任何自查项，请确认自查表内容或检查表头是否含「自查项」「检查内容」等列`);

  const dataPaths = String(a.data).split(',').map((x) => x.trim()).filter(Boolean);
  if (!dataPaths.length) throw new Error('--data 未提供任何有效路径');
  const tables = loadData(dataPaths);

  /* ---- 表结构复杂度判定：合并单元格多 / 表头不在首行 → 要用户先确认 */
  const mergeCount = form.merges.length;
  const complexReasons = [];
  if (mergeCount >= 5) complexReasons.push(`存在 ${mergeCount} 处合并单元格`);
  if (form.headerRow > 2) complexReasons.push(`表头位于第 ${form.headerRow + 1} 行（上方有 ${form.headerRow} 行标题）`);
  if (!form.mergeReadable) complexReasons.push('合并单元格信息读取失败，表结构未能完全确认');
  if (form.items.some((x) => x.inMerge)) complexReasons.push('部分自查项落在合并单元格内');
  const needConfirm = complexReasons.length > 0;
  if (needConfirm) warnings.push(`自查表结构复杂（${complexReasons.join('；')}），**须先向用户展示解析结果并确认后再填写**，不得直接交付`);

  /* ---- 逐项分类与取数 */
  const results = [];
  const prefilled = [], needJudgment = [], noData = [], unparsed = [];
  for (const it of form.items) {
    const cls = S.classify(it.text);
    const base = {
      no: it.no, text: it.text, category: it.category || '', basis: it.basis || '',
      row: it.row, src: it.src,
      ruleIds: cls.rules.map((r) => r.id),
      ruleNames: cls.rules.map((r) => `${r.id} ${r.name}`),
      sources: cls.sources.map((k) => S.SOURCE_CN.get(k)),
      reason: cls.reason,
    };

    if (cls.category === 'judgment') {
      const item = { ...base, status: 'needJudgment', statusCn: S.STATUS_CN.needJudgment, value: null,
        sourceNote: null, evidence: null,
        note: `判断类自查项，脚本一律留空。${cls.reason}。须由责任人核实后填写，不得以「符合」「已落实」「健全」代填` };
      results.push(item); needJudgment.push(item);
      continue;
    }
    if (cls.category === 'unparsed') {
      const item = { ...base, status: 'unparsed', statusCn: S.STATUS_CN.unparsed, value: null,
        sourceNote: null, evidence: null,
        note: `无法判定该自查项是客观事实类还是判断类，脚本留空交人工处理；${cls.reason}，未做任何猜测性填写` };
      results.push(item); unparsed.push(item);
      continue;
    }

    // 客观项：取数
    const got = fetchValue(it, cls, tables, asOf);
    if (!got || got.value === null) {
      const miss = (got && got.missing) || '数据来源不明确';
      const item = { ...base, status: 'noData', statusCn: S.STATUS_CN.noData, value: null,
        sourceNote: null, evidence: null, table: (got && got.table) || null,
        missing: miss,
        note: `该项为客观事实类但取不到数据：${miss}。**留空，不按「符合」或「无」处理**，请补充相应台账后重跑，或由责任人手工核实填写` };
      results.push(item); noData.push(item);
      continue;
    }
    // 兜底：预填内容里绝不能出现判定性词汇
    const banned = S.checkFillValue(got.value);
    if (banned.length) {
      const item = { ...base, status: 'noData', statusCn: S.STATUS_CN.noData, value: null,
        sourceNote: null, evidence: null, table: got.table || null,
        missing: `取数结果含判定性词汇「${banned.join('、')}」，按不可预填处理`,
        note: '取数结果包含判定性表述，脚本拒绝填入并留空，须由责任人判断填写' };
      results.push(item); noData.push(item);
      warnings.push(`自查项「${it.text}」的取数结果含判定性词汇「${banned.join('、')}」，已拒绝预填并改标缺数据`);
      continue;
    }
    const item = { ...base, status: 'prefilled', statusCn: S.STATUS_CN.prefilled,
      value: got.value, sourceNote: got.sourceNote, evidence: got.evidence,
      table: got.table || null, extra: got.extra || null,
      note: '客观事实类，已按台账取数预填；数据来源见「依据/备注」列，须逐项核对后方可提交' };
    results.push(item); prefilled.push(item);
  }

  if (needJudgment.length) warnings.push(`有 ${needJudgment.length} 个自查项属判断类/评价类/承诺类，脚本一律留空，须由责任人核实填写`);
  if (noData.length) warnings.push(`有 ${noData.length} 个客观自查项因数据缺失留空，未按「符合」处理，缺什么数据见 filled.json 的 noData[].missing`);
  if (unparsed.length) warnings.push(`有 ${unparsed.length} 个自查项无法判定类型，脚本未做任何填写，须人工确认`);

  const counts = {
    items: results.length,
    prefilled: prefilled.length,
    needJudgment: needJudgment.length,
    noData: noData.length,
    unparsed: unparsed.length,
    dataTables: tables.length,
    merges: mergeCount,
  };

  /* ---- 产出 */
  C.ensureDir(outDir);
  const result = {
    meta: {
      workshop: a.workshop, formSource: form.src, formSheet: form.sheetName,
      period: periodText, asOf, dataSources: dataPaths.map((p) => path.basename(p)),
      lastForm: a.last || null, spec: a.spec || null,
      headerRow: form.headerRow >= 0 ? form.headerRow + 1 : null,
      writableCols: form.writable, neverWriteCols: NEVER_WRITE.filter((n) => form.cols[n] >= 0),
      needConfirm, complexReasons,
      generatedAt: C.localDateTime(), statement: STATEMENT,
    },
    counts, items: results, prefilled, needJudgment, noData, unparsed,
    dataTables: tables.map((t) => ({ file: t.file, sheet: t.sheet, source: t.sourceKey ? S.SOURCE_CN.get(t.sourceKey) : null, rows: t.count })),
    warnings,
  };
  fs.writeFileSync(path.join(outDir, 'filled.json'), JSON.stringify(result, null, 2), 'utf8');

  /* ---- 预填后的自查表（保持原表结构，只往可填列写字） */
  const outRows = form.rows ? form.rows.map((r) => (r || []).slice()) : null;
  let written = 0;
  if (outRows && form.writable.length) {
    const colState = form.cols['现状'] >= 0 ? form.cols['现状'] : form.cols['证据材料'];
    const colEvid = form.cols['证据材料'] >= 0 ? form.cols['证据材料']
      : (form.cols['备注'] >= 0 ? form.cols['备注'] : colState);
    for (const it of results) {
      if (it.row < 0) continue;
      const r = outRows[it.row] || (outRows[it.row] = []);
      if (it.status === 'prefilled') {
        if (colState >= 0) { r[colState] = it.value; written++; }
        // 硬约束 3：预填项必须注明数据来源
        if (colEvid >= 0 && colEvid !== colState) r[colEvid] = it.sourceNote;
        else if (colEvid >= 0) r[colEvid] = `${it.value}（${it.sourceNote}）`;
      } else {
        // 留空：现状列保持空白，只在备注列写为什么空着
        const colNote = form.cols['备注'] >= 0 ? form.cols['备注'] : colEvid;
        if (colNote >= 0 && colNote !== colState) r[colNote] = `【${it.statusCn}】${it.note}`;
      }
      // 「是否符合」「整改措施」「责任人」列：一个字都不写
    }
  } else if (outRows) {
    warnings.push('自查表无可写入列，预填稿仅追加「预填明细」工作表，原表结构原样保留');
  }

  const detailRows = [['序号', '自查项', '自查类别', '状态', '预填内容', '数据来源与依据', '命中规则', '说明']];
  for (const it of results) {
    detailRows.push([
      it.no, it.text, it.category || '—', it.statusCn,
      it.value === null ? '（留空）' : it.value,
      it.sourceNote || (it.missing ? `缺数据：${it.missing}` : '—'),
      it.ruleNames.join('；') || '—', it.note,
    ]);
  }
  const judgeRows = [['序号', '自查项', '命中规则', '为什么必须由人填', '出处']];
  for (const it of needJudgment) judgeRows.push([it.no, it.text, it.ruleNames.join('；'), it.reason, it.src]);
  const noDataRows = [['序号', '自查项', '缺什么数据', '说明', '出处']];
  for (const it of noData) noDataRows.push([it.no, it.text, it.missing || '—', it.note, it.src]);
  const unparsedRows = [['序号', '自查项', '说明', '出处']];
  for (const it of unparsed) unparsedRows.push([it.no, it.text, it.note, it.src]);

  const sheets = {};
  if (outRows) sheets[form.sheetName || '自查表'] = outRows;
  sheets['预填明细'] = detailRows;
  sheets['需责任人判断'] = judgeRows;
  sheets['缺数据项'] = noDataRows;
  sheets['无法解析项'] = unparsedRows;
  sheets['声明'] = [['声明'], [STATEMENT]];
  writeXlsx(path.join(outDir, '自查表预填稿.xlsx'), sheets);

  /* ---- 填写说明.md */
  const L = [];
  L.push(`# ${a.workshop} 自查表预填说明　${form.src}`);
  L.push('');
  if (needConfirm) { L.push(`> **${COMPLEX_ALERT}**`); L.push(''); L.push(`> 复杂之处：${complexReasons.join('；')}。`); L.push(''); }
  if (needJudgment.length) {
    L.push(`> **${JUDGMENT_ALERT}**`);
    L.push('');
    L.push(`> 需责任人判断 ${needJudgment.length} 项${noData.length ? `，缺数据留空 ${noData.length} 项` : ''}${unparsed.length ? `，无法解析 ${unparsed.length} 项` : ''}，明细见第三、四节。`);
    L.push('');
  }
  L.push('## 一、基本信息');
  L.push('');
  L.push(C.mdTable(['项目', '内容'], [
    ['车间', a.workshop],
    ['自查表', `${form.src}${form.sheetName ? `／工作表「${form.sheetName}」` : ''}`],
    ['自查周期/时点', `${periodText}（到期判定基准日 ${asOf}）`],
    ['到期判定基准日', asOf],
    ['台账数据来源', result.meta.dataSources.join('、')],
    ['可用数据表', counts.dataTables],
    ['上次自查表', a.last ? path.basename(a.last) : '—'],
    ['厂内填报要求', a.spec ? path.basename(a.spec) : '—'],
    ['表头所在行', result.meta.headerRow === null ? '—' : `第 ${result.meta.headerRow} 行`],
    ['合并单元格', mergeCount],
    ['脚本可写列', form.writable.join('、') || '—（无可写列）'],
    ['脚本不写的列', result.meta.neverWriteCols.join('、') || '—'],
    ['自查项总数', counts.items],
    ['已预填', counts.prefilled],
    ['需责任人判断', counts.needJudgment],
    ['缺数据留空', counts.noData],
    ['无法解析', counts.unparsed],
    ['生成时间', `${C.localDateTime()}（北京时间）`],
  ]));
  L.push('## 二、已预填项与数据来源');
  L.push('');
  if (!prefilled.length) L.push('_本次没有可预填的客观项。_\n');
  else {
    L.push(C.mdTable(['序号', '自查项', '预填内容', '数据来源与依据', '命中规则'],
      prefilled.map((x) => [x.no, x.text, x.value, x.sourceNote, x.ruleNames.join('；')])));
    L.push('> 预填内容只是台账事实的搬运，**不代表该项合规达标**；提交前须逐项核对数据来源，核对无误后由责任人确认。');
    L.push('');
  }
  L.push('## 三、需责任人判断项（脚本一律留空）');
  L.push('');
  if (!needJudgment.length) L.push('_本表未识别出判断类自查项。_\n');
  else {
    L.push(C.mdTable(['序号', '自查项', '命中规则', '为什么必须由人填', '出处'],
      needJudgment.map((x) => [x.no, `**${x.text}**`, x.ruleNames.join('；'), x.reason, x.src])));
    L.push('> 以上各项脚本**一个字都没有填**。**不得以「符合」「已落实」「健全」「到位」等表述代填**，须由责任人核实实际情况后本人填写。');
    L.push('');
  }
  L.push('## 四、缺数据留空项');
  L.push('');
  if (!noData.length) L.push('_无因数据缺失而留空的客观项。_\n');
  else {
    L.push(C.mdTable(['序号', '自查项', '缺什么数据', '处理方式', '出处'],
      noData.map((x) => [x.no, `**${x.text}**`, x.missing || '—', '留空，待补充数据后重跑或由责任人手工核实填写', x.src])));
    L.push('> 缺数据就是缺数据。**绝不按「符合」「无」「正常」处理**，也不得用其他台账推算代替。');
    L.push('');
  }
  L.push('## 五、无法解析项');
  L.push('');
  if (!unparsed.length) L.push('_所有自查项均已判定类型。_\n');
  else {
    L.push(C.mdTable(['序号', '自查项', '说明', '出处'],
      unparsed.map((x) => [x.no, x.text, x.note, x.src])));
    L.push('> 无法判定类型的自查项，脚本未做任何猜测性填写，请人工确认后填写。');
    L.push('');
  }
  L.push('## 六、填写与提交提示');
  L.push('');
  L.push('<!-- ANALYSIS_START -->');
  L.push('（由模型依据 references/fill-rules.md 口径撰写 200~400 字，结构：预填覆盖情况 → 需责任人判断项的填写要点 → 缺数据项要补什么台账 → 提交前的核对与签字提醒。数字一律引用 filled.json 的 counts；不做合规达标判定；不代填判断类项；不代替责任人签字。）');
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
  fs.writeFileSync(path.join(outDir, '填写说明.md'), L.join('\n'), 'utf8');

  C.emitOk(outDir, {
    ok: true, out: outDir, workshop: a.workshop, form: form.src,
    asOf, period: periodText, needConfirm, counts, cellsWritten: written, warnings,
  });
}

try { main(); } catch (e) { C.fail(e, warnings); }
