#!/usr/bin/env node
'use strict';
/**
 * 迎检资料准备比对脚本（仅 Node.js 内置模块）
 * 用法：node "<技能目录>/scripts/evidence.js" --notice <检查通知/检查表> --materials <台账记录目录或清单xlsx>
 *       --workshop "<车间名>" [--out <dir>]
 * 可选：--inspection "<检查名称>" --date-range <YYYY-MM-DD~YYYY-MM-DD> --scope "<检查范围>"
 *       --spec "<厂内归档规范>" --last "<上次资料包目录>"
 * 产出：<out>/evidence.json、evidence.md、资料清单.xlsx、summary.json；末行打印 JSON 摘要
 *
 * 硬规则（见 references/evidence-rules.md，改动前务必先读）：
 *  - 找不到对应材料 → missing「未找到对应材料」，不得用相近材料充数、不得写「可用 XX 替代」
 *  - 有材料但时间不覆盖检查期 → partialCoverage 如实写覆盖区间，不按完整覆盖处理
 *  - 有材料但全都没有日期（清单未填、文件名推不出）→ unknownPeriod「期限未知」单列，不算齐全也不算覆盖不全
 *  - 缺口项醒目列出并说明影响，不得淡化
 *  - 不编制、不补录、不代写任何资料；不判定检查项是否达标合规
 */
const fs = require('fs');
const path = require('path');
const { readXlsx, readCsvDir, writeXlsx } = require('./lib/xlsx-lite');
const lite = require('./lib/docx-lite');
const C = require('./lib/common');
const S = require('./lib/evidence-spec');

const warnings = [];
const VALUE_OPTS = ['notice', 'materials', 'workshop', 'out', 'inspection', 'date-range', 'scope', 'spec', 'last'];
const FLAG_OPTS = ['help'];

/** SKILL.md 要求逐字保留的声明行，不得删除或改写 */
const STATEMENT = '本清单基于所提供材料比对生成，资料的真实性、完整性由车间负责；缺失资料应如实说明，不得事后补编记录。';
/** 存在缺口时写在 md 开头的醒目提示（不得淡化） */
const GAP_ALERT = '【注意】存在未找到对应材料的检查项，缺口项须如实向检查组说明；不得用相近材料充数，不得事后补编记录';

const ITEM_ALIASES = {
  '检查项': ['检查项', '检查项目', '检查内容', '项目', '内容', '检查要点', '要点'],
  '资料要求': ['资料要求', '应提供资料', '需提供资料', '查阅资料', '证据材料', '要求', '所需资料', '支撑材料'],
  '检查类别': ['检查类别', '类别', '专业', '分类', '检查类型'],
  '序号': ['序号', '编号', 'No', 'NO'],
};
const MAT_ALIASES = {
  '文件名': ['文件名', '资料名称', '材料名称', '名称', '文件', '台账名称'],
  '存放位置': ['存放位置', '位置', '路径', '存放', '存档位置', '归档位置'],
  '起始日期': ['起始日期', '起始时间', '开始日期', '起始', '记录起始'],
  '截止日期': ['截止日期', '截止时间', '结束日期', '截止', '记录截止'],
  '资料类型': ['资料类型', '类型', '类别'],
  '备注': ['备注', '说明'],
};

function loadBook(p) { return fs.statSync(p).isDirectory() ? readCsvDir(p) : readXlsx(p); }

/* ------------------------------------------------------------------ 检查项解析 */

/** 从 .docx / .md / .txt 的纯文本里抽检查项：带序号的行优先，否则取非空且够长的行 */
function itemsFromText(text, srcName) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n').map((x) => x.trim()).filter(Boolean);
  const numbered = [];
  const plain = [];
  for (let i = 0; i < lines.length; i++) {
    let ln = lines[i];
    if (/^#/.test(ln)) continue;                              // md 标题不当检查项
    if (/^[-=|＿_]{3,}$/.test(ln)) continue;
    const m = ln.match(/^\s*(?:\(|（)?(\d{1,3}|[一二三四五六七八九十]{1,3})(?:\)|）|\.|、|．|\s)\s*(.+)$/);
    if (m && m[2].length >= 3) numbered.push({ no: String(m[1]), text: m[2].trim(), line: i + 1 });
    else if (ln.replace(/[|｜]/g, '').trim().length >= 5) plain.push({ no: null, text: ln, line: i + 1 });
  }
  const picked = numbered.length ? numbered : plain;
  if (!picked.length) warnings.push(`检查通知「${srcName}」中未解析出任何检查项（既无带序号条目，也无足够长度的正文行）`);
  return picked.map((x, i) => ({ no: x.no || String(i + 1), text: x.text, requirement: '', category: '', src: `${srcName} 第${x.line}行` }));
}

/** 从 docx 表格里抽检查项：命中表头「检查项/检查内容」列时按列取，否则退回文本模式 */
function itemsFromDocx(file) {
  const src = path.basename(file);
  let res;
  try { res = lite.docxToText(fs.readFileSync(file)); } catch (e) { throw new Error(`检查通知解析失败 ${src}: ${e.message}`); }
  const out = [];
  for (const b of res.blocks) {
    if (b.kind !== 'table' || !b.rows || b.rows.length < 2) continue;
    const hdr = (b.rows[0] || []).map((c) => C.str(c).replace(/\s+/g, ''));
    const ci = C.findCol(hdr, '检查项', ITEM_ALIASES);
    if (ci < 0) continue;
    const ri = C.findCol(hdr, '资料要求', ITEM_ALIASES);
    const ni = C.findCol(hdr, '序号', ITEM_ALIASES);
    const gi = C.findCol(hdr, '检查类别', ITEM_ALIASES);
    for (let i = 1; i < b.rows.length; i++) {
      const r = b.rows[i] || [];
      const t = C.str(r[ci]);
      if (!t || t === S.norm(hdr[ci])) continue;
      if (/^(合计|小计|总计|共计)/.test(t)) { warnings.push(`检查通知「${src}」表格第${i + 1}行为合计行，已跳过`); continue; }
      out.push({
        no: (ni >= 0 && C.str(r[ni])) || String(out.length + 1),
        text: t, requirement: ri >= 0 ? C.str(r[ri]) : '',
        category: gi >= 0 ? C.str(r[gi]) : '', src: `${src} 表格第${i + 1}行`,
      });
    }
  }
  if (out.length) return out;
  warnings.push(`检查通知「${src}」中未找到含「检查项」表头的表格，已按正文逐行解析`);
  return itemsFromText(res.text, src);
}

/** 从 xlsx 检查表抽检查项 */
function itemsFromXlsx(file) {
  const src = path.basename(file);
  const book = loadBook(file);
  const rows = C.pickSheet(book, '检查表', '检查项', '检查项目', '检查清单', '检查内容');
  if (!rows) throw new Error(`检查表文件中未找到「检查表」「检查项」等工作表（实际工作表：${Object.keys(book).join('、') || '空'}）`);
  const recs = C.toRecords(rows, ['检查项'], `${src}/检查表`, ['资料要求', '检查类别', '序号'], warnings, ITEM_ALIASES);
  const out = [];
  for (const r of recs) {
    const t = C.str(r['检查项']);
    if (!t) { warnings.push(`工作表「${src}/检查表」第${r._row}行 检查项为空，已跳过`); continue; }
    out.push({
      no: C.str(r['序号']) || String(out.length + 1), text: t,
      requirement: C.str(r['资料要求']), category: C.str(r['检查类别']),
      src: `${src}/检查表 第${r._row}行`,
    });
  }
  return out;
}

function parseNotice(p) {
  if (!fs.existsSync(p)) throw new Error(`检查通知/检查表不存在: ${p}`);
  const ext = path.extname(p).toLowerCase();
  if (ext === '.docx') return itemsFromDocx(p);
  if (ext === '.xlsx' || ext === '.xlsm') return itemsFromXlsx(p);
  if (ext === '.md' || ext === '.txt' || ext === '') {
    if (fs.statSync(p).isDirectory()) throw new Error(`--notice 不接受目录: ${p}`);
    return itemsFromText(fs.readFileSync(p, 'utf8'), path.basename(p));
  }
  throw new Error(`--notice 不支持的格式「${ext}」，仅支持 .docx / .xlsx / .md / .txt；PDF 请先用平台 pdf 技能转为 txt/docx 再传入（扫描件需 OCR），脚本不读 PDF`);
}

/* ------------------------------------------------------------------ 材料收集 */

/**
 * 设备位号段：1~3 个字母 + 连字符 + 2~5 位数字 + 可选字母后缀（E-1201、V-1101、P-2101A）。
 * 位号里的数字不是年份，推断日期前先抹掉，否则「E-1201-2026年测厚报告」会被读成 1201~2026 年。
 * 数字后紧跟「年/月/季」的不算位号（如「SIS-2026年」里的 2026 仍是年份）；19xx/20xx 后接月份、季度、上下半年
 * 或区间符的也是年份（如「EAM-2026-09」「SAP-2026.01-2026.06」「QC-2026上半年」），不当位号抹掉。
 */
const TAG_SEG = /(?<![A-Za-z])[A-Za-z]{1,3}-(?!(?:19|20)\d{2}(?:[-./_]\d{1,2}(?!\d)|[Qq季上下~～至到]))\d{2,5}[A-Za-z]?(?![A-Za-z\d年月季])/g;

/** 从文件名里猜时间区间：2026-09、2026年9月、2026Q3、2026 上半年、2026-01~2026-06（先排除位号段） */
function periodFromName(name) {
  const s = String(name).replace(TAG_SEG, ' ');
  const range = s.match(/(\d{4})[-/年.]?(\d{1,2})?[^\d]{0,3}[~～至到\-—]{1,2}(\d{4})[-/年.]?(\d{1,2})?/);
  if (range) {
    const f = monthStart(+range[1], range[2] ? +range[2] : 1);
    const t = monthEnd(+range[3], range[4] ? +range[4] : 12);
    if (f && t) return { from: f, to: t, basis: '文件名区间' };
  }
  const q = s.match(/(\d{4})\s*[-年]?\s*[Qq]([1-4])|(\d{4})\s*年?第?([一二三四])季度/);
  if (q) {
    const y = +(q[1] || q[3]);
    const n = q[2] ? +q[2] : ({ 一: 1, 二: 2, 三: 3, 四: 4 })[q[4]];
    return { from: monthStart(y, n * 3 - 2), to: monthEnd(y, n * 3), basis: '文件名季度' };
  }
  const half = s.match(/(\d{4})\s*年?\s*(上|下)半年/);
  if (half) {
    const y = +half[1];
    return half[2] === '上' ? { from: monthStart(y, 1), to: monthEnd(y, 6), basis: '文件名半年' }
      : { from: monthStart(y, 7), to: monthEnd(y, 12), basis: '文件名半年' };
  }
  const day = s.match(/(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})/);
  if (day) { const d = C.normDate(`${day[1]}-${day[2]}-${day[3]}`); if (d) return { from: d, to: d, basis: '文件名日期' }; }
  const mon = s.match(/(\d{4})\s*[-/年.]\s*(\d{1,2})\s*月?(?!\d)/);
  if (mon && +mon[2] >= 1 && +mon[2] <= 12) return { from: monthStart(+mon[1], +mon[2]), to: monthEnd(+mon[1], +mon[2]), basis: '文件名月份' };
  const year = s.match(/(?:^|[^\d])(\d{4})\s*年/);
  if (year) return { from: monthStart(+year[1], 1), to: monthEnd(+year[1], 12), basis: '文件名年份' };
  return null;
}
function monthStart(y, m) { if (!(m >= 1 && m <= 12)) return null; return `${y}-${String(m).padStart(2, '0')}-01`; }
function monthEnd(y, m) {
  if (!(m >= 1 && m <= 12)) return null;
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** 目录递归扫描 或 xlsx 资料清单 */
function collectMaterials(p) {
  if (!fs.existsSync(p)) throw new Error(`台账与记录目录/清单不存在: ${p}`);
  const st = fs.statSync(p);
  const out = [];
  if (st.isDirectory()) {
    const walk = (d, rel, depth) => {
      if (depth > 6) { warnings.push(`目录「${rel || '.'}」层级超过 6 层，未继续深入扫描`); return; }
      for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((x, y) => x.name.localeCompare(y.name, 'zh'))) {
        if (e.name.startsWith('.') || e.name.startsWith('~$')) continue;
        const full = path.join(d, e.name);
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(full, r, depth + 1);
        else out.push({ name: e.name, location: r, declaredType: '', note: '', period: periodFromName(r), src: '目录扫描' });
      }
    };
    walk(p, '', 0);
    if (!out.length) warnings.push(`材料目录「${p}」中没有文件`);
    return out;
  }
  const book = loadBook(p);
  const rows = C.pickSheet(book, '资料清单', '材料清单', '台账清单', '记录清单', '资料');
  if (!rows) throw new Error(`资料清单文件中未找到「资料清单」「材料清单」等工作表（实际工作表：${Object.keys(book).join('、') || '空'}）`);
  const recs = C.toRecords(rows, ['文件名'], '资料清单', ['存放位置', '起始日期', '截止日期', '资料类型', '备注'], warnings, MAT_ALIASES);
  for (const r of recs) {
    const n = C.str(r['文件名']);
    if (!n) { warnings.push(`工作表「资料清单」第${r._row}行 文件名为空，已跳过`); continue; }
    const rawFrom = r['起始日期'], rawTo = r['截止日期'];
    const f = C.normDate(rawFrom), t = C.normDate(rawTo);
    if (C.str(rawFrom) && !f) warnings.push(`工作表「资料清单」第${r._row}行 起始日期「${C.str(rawFrom)}」无法解析，该材料时间覆盖按「无法确定」处理`);
    if (C.str(rawTo) && !t) warnings.push(`工作表「资料清单」第${r._row}行 截止日期「${C.str(rawTo)}」无法解析，该材料时间覆盖按「无法确定」处理`);
    // 清单填报的起止日期优先；只填了一端时，另一端尝试由文件名推断（basis 标明来源），两端都没有再整体按文件名推断
    let period = null;
    if (f && t) period = { from: f, to: t, basis: '清单填报' };
    else if (f || t) {
      const byName = periodFromName(n);
      const otherFrom = !f && byName && byName.from ? byName.from : null;
      const otherTo = !t && byName && byName.to ? byName.to : null;
      period = { from: f || otherFrom, to: t || otherTo, basis: (otherFrom || otherTo) ? '清单填报+文件名推断' : '清单填报（仅一端）' };
      if (otherFrom || otherTo) warnings.push(`工作表「资料清单」第${r._row}行 只填了${f ? '起始' : '截止'}日期，${f ? '截止' : '起始'}日期按文件名推断为 ${otherFrom || otherTo}（${byName.basis}），请核对`);
      else warnings.push(`工作表「资料清单」第${r._row}行 只填了${f ? '起始' : '截止'}日期，另一端无法从文件名推断，覆盖判定按已填一端处理`);
    } else period = periodFromName(n);
    out.push({
      name: n, location: C.str(r['存放位置']) || n, declaredType: C.str(r['资料类型']),
      note: C.str(r['备注']), period, src: `资料清单 第${r._row}行`, _row: r._row,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ 主流程 */

function main() {
  const a = C.parseArgs(process.argv.slice(2), VALUE_OPTS, FLAG_OPTS);
  for (const k of ['notice', 'materials', 'workshop']) if (!a[k]) throw new Error(`缺少 --${k}`);

  // 检查期
  let period = null;
  if (a['date-range']) {
    const parts = String(a['date-range']).split(/[~～至到]|--/).map((x) => x.trim()).filter(Boolean);
    if (parts.length !== 2) throw new Error(`--date-range 「${a['date-range']}」格式应为 YYYY-MM-DD~YYYY-MM-DD`);
    const f = C.normDate(parts[0]), t = C.normDate(parts[1]);
    if (!f) throw new Error(`--date-range 起始日期「${parts[0]}」不是有效日期，应为 YYYY-MM-DD`);
    if (!t) throw new Error(`--date-range 截止日期「${parts[1]}」不是有效日期，应为 YYYY-MM-DD`);
    if (C.diffDays(t, f) < 0) throw new Error(`--date-range 截止日期（${t}）早于起始日期（${f}）`);
    period = { from: f, to: t };
  } else {
    warnings.push('未提供 --date-range（检查期），不做时间覆盖判定，覆盖状态一律为「未指定检查期」');
  }
  if (a.spec && !fs.existsSync(a.spec)) throw new Error(`厂内归档规范不存在: ${a.spec}`);
  if (a.last && !fs.existsSync(a.last)) throw new Error(`上次资料包目录不存在: ${a.last}`);

  const outDir = a.out || path.join(require('os').tmpdir(), 'iep-out');

  // ---- 解析检查项与材料
  const rawItems = parseNotice(a.notice);
  if (!rawItems.length) throw new Error(`未从「${path.basename(a.notice)}」解析出任何检查项，请确认检查通知/检查表内容或改用 .xlsx 检查表格式`);
  const materials = collectMaterials(a.materials);

  const matCats = materials.map((m) => S.fileCategories(`${m.name} ${m.declaredType}`));

  // ---- 逐检查项比对
  const items = [], ready = [], missing = [], partialCoverage = [], unknownPeriod = [];
  const usedIdx = new Set();
  for (const it of rawItems) {
    // 只用「检查项」与「资料要求」参与匹配：「检查类别」是粗分类标签（如「运行维护」），
    // 拿它匹配会把整类材料都算成证据，反而掩盖缺口，故只作展示不作匹配依据。
    const searchText = [it.text, it.requirement].filter(Boolean).join(' ');
    const cats = S.itemCategories(searchText);
    const hits = [];
    for (let i = 0; i < materials.length; i++) {
      const m = materials[i];
      const r = S.matchItem(searchText, `${m.name} ${m.declaredType} ${m.location}`, cats, matCats[i]);
      if (r.matched) { hits.push({ idx: i, basis: r.basis }); usedIdx.add(i); }
    }

    const evidence = hits.map((h) => {
      const m = materials[h.idx];
      const cov = S.coverage(period, m.period && m.period.from, m.period && m.period.to);
      return {
        name: m.name, location: m.location, basis: h.basis,
        periodFrom: (m.period && m.period.from) || null, periodTo: (m.period && m.period.to) || null,
        periodBasis: (m.period && m.period.basis) || null, coverage: cov,
      };
    });

    let status, coverageNote;
    if (!evidence.length) {
      status = 'missing';
      coverageNote = '—';
    } else if (!period) {
      status = 'ready';
      coverageNote = '未指定检查期，不做覆盖判定';
    } else if (evidence.some((e) => e.coverage === 'full')) {
      status = 'ready';
      const weak = evidence.filter((e) => e.coverage !== 'full');
      coverageNote = `完整覆盖 ${period.from} ~ ${period.to}`;
      // 同一检查项下其余材料若时间不详或不覆盖，仍如实点出，不因为有一份齐全就掩盖
      if (weak.length) coverageNote += `（另 ${weak.length} 份材料时间不详或未覆盖：${weak.map((e) => e.name).join('、')}）`;
    } else if (evidence.every((e) => e.coverage === 'unknown')) {
      // 材料全都没有可用日期（清单未填、文件名也推不出，如 MCP 导出文件）—— 覆盖与否无从判定，
      // 单列「期限未知」：不按完整覆盖计入齐全，也不当作已确认的覆盖不全
      status = 'unknownPeriod';
      coverageNote = `期限未知：${evidence.length} 份材料无法确定时间范围，未判定是否覆盖检查期 ${period.from} ~ ${period.to}`;
    } else {
      // 有日期的材料部分覆盖 / 无交集（可能夹带时间不明的材料）—— 一律不按完整覆盖处理
      status = 'partial';
      const segs = evidence.filter((e) => e.periodFrom || e.periodTo)
        .map((e) => `${e.name}：${e.periodFrom || '不详'} ~ ${e.periodTo || '不详'}`);
      const unknownN = evidence.filter((e) => e.coverage === 'unknown').length;
      const noneN = evidence.filter((e) => e.coverage === 'none').length;
      const bits = [];
      if (segs.length) bits.push(`材料覆盖区间 ${segs.join('；')}`);
      if (unknownN) bits.push(`${unknownN} 份材料无法确定时间范围`);
      if (noneN) bits.push(`${noneN} 份材料时间与检查期 ${period.from} ~ ${period.to} 无交集`);
      coverageNote = `未完整覆盖检查期 ${period.from} ~ ${period.to}：${bits.join('；')}`;
    }

    const item = {
      no: it.no, text: it.text, requirement: it.requirement || '',
      category: it.category || '', src: it.src,
      categories: cats, evidence, status,
      statusCn: S.STATUS_CN[status], coverageNote,
      note: ({
        missing: '未找到对应材料；不得用相近材料充数，也不得事后补编记录',
        partial: '资料存在但时间范围未完整覆盖检查期，须如实说明覆盖区间',
        unknownPeriod: '资料存在但缺起始日期、截止日期（资料清单未填报，文件名中也无日期），是否覆盖检查期未判定；须由车间核实材料实际起止日期，不得按完整覆盖报送',
      })[status] || '',
    };
    items.push(item);
    if (status === 'ready') ready.push(item);
    else if (status === 'partial') partialCoverage.push(item);
    else if (status === 'unknownPeriod') unknownPeriod.push(item);
    else missing.push(item);
  }

  // ---- 有材料但对不上任何检查项
  const unmatched = [];
  for (let i = 0; i < materials.length; i++) {
    if (usedIdx.has(i)) continue;
    const m = materials[i];
    unmatched.push({
      name: m.name, location: m.location, declaredType: m.declaredType || null,
      periodFrom: (m.period && m.period.from) || null, periodTo: (m.period && m.period.to) || null,
      note: '未对应到任何检查项，请人工确认是否属于本次检查范围；未按名称猜测强行对应',
    });
  }
  if (unmatched.length) warnings.push(`有 ${unmatched.length} 份材料未对应到任何检查项，已列入「未对应材料」由人工确认`);
  if (missing.length) warnings.push(`有 ${missing.length} 个检查项未找到对应材料，须如实向检查组说明，不得用相近材料充数`);
  if (partialCoverage.length) warnings.push(`有 ${partialCoverage.length} 个检查项的材料未完整覆盖检查期，须说明覆盖区间`);
  if (unknownPeriod.length) warnings.push(`有 ${unknownPeriod.length} 个检查项的材料无法确定时间范围（期限未知：资料清单未填起止日期，文件名中也无日期），未判定是否覆盖检查期，须核实起止日期`);

  const counts = {
    items: items.length, ready: ready.length, missing: missing.length,
    partialCoverage: partialCoverage.length, unknownPeriod: unknownPeriod.length, unmatched: unmatched.length,
    materials: materials.length,
  };

  // ---- 产出
  C.ensureDir(outDir);
  const result = {
    meta: {
      workshop: a.workshop, inspection: a.inspection || null, scope: a.scope || null,
      period, noticeSource: path.basename(a.notice), materialsSource: a.materials,
      specProvided: a.spec || null, lastPackage: a.last || null,
      generatedAt: C.localDateTime(), statement: STATEMENT,
    },
    counts, items, ready, missing, partialCoverage, unknownPeriod, unmatched,
    materials: materials.map((m) => ({
      name: m.name, location: m.location, declaredType: m.declaredType || null,
      periodFrom: (m.period && m.period.from) || null, periodTo: (m.period && m.period.to) || null,
      periodBasis: (m.period && m.period.basis) || null, src: m.src,
    })),
    warnings,
  };
  fs.writeFileSync(path.join(outDir, 'evidence.json'), JSON.stringify(result, null, 2), 'utf8');

  // ---- 资料清单.xlsx
  const listRows = [['检查项序号', '检查项', '资料要求', '对应材料', '文件位置', '时间覆盖', '状态', '说明']];
  for (const it of items) {
    listRows.push([
      it.no, it.text, it.requirement || '—',
      it.evidence.map((e) => e.name).join('；') || '—',
      it.evidence.map((e) => e.location).join('；') || '—',
      it.coverageNote, it.statusCn, it.note || '—',
    ]);
  }
  const gapRows = [['检查项序号', '检查项', '缺口类型', '说明', '出处']];
  for (const it of missing) gapRows.push([it.no, it.text, '未找到对应材料', it.note, it.src]);
  for (const it of partialCoverage) gapRows.push([it.no, it.text, '覆盖不全', it.coverageNote, it.src]);
  const upRows = [['检查项序号', '检查项', '对应材料', '覆盖情况', '说明', '出处']];
  for (const it of unknownPeriod) upRows.push([it.no, it.text, it.evidence.map((e) => e.name).join('；'), it.coverageNote, it.note, it.src]);
  const unmRows = [['文件名', '存放位置', '标注类型', '起始', '截止', '说明']];
  for (const u of unmatched) unmRows.push([u.name, u.location, u.declaredType || '—', u.periodFrom || '—', u.periodTo || '—', u.note]);
  writeXlsx(path.join(outDir, '资料清单.xlsx'), {
    '资料对照': listRows, '缺口清单': gapRows, '期限未知': upRows, '未对应材料': unmRows,
    '声明': [['声明'], [STATEMENT]],
  });

  // ---- evidence.md
  const L = [];
  L.push(`# ${a.workshop} 迎检资料清单${a.inspection ? `　${a.inspection}` : ''}`);
  L.push('');
  if (missing.length) {
    L.push(`> **${GAP_ALERT}**`);
    L.push('');
    L.push(`> 未找到对应材料 ${missing.length} 项${partialCoverage.length ? `，覆盖不全 ${partialCoverage.length} 项` : ''}${unknownPeriod.length ? `，期限未知 ${unknownPeriod.length} 项` : ''}，缺口明细见第三节${unknownPeriod.length ? '，期限未知明细见第五节' : ''}。`);
    L.push('');
  } else if (partialCoverage.length) {
    L.push(`> **【注意】有 ${partialCoverage.length} 个检查项的材料未完整覆盖检查期，须如实说明覆盖区间，不得按完整覆盖报送**`);
    L.push('');
  }
  if (!missing.length && unknownPeriod.length) {
    L.push(`> **【注意】有 ${unknownPeriod.length} 个检查项的材料无法确定时间范围（期限未知），未判定是否覆盖检查期，须核实材料起止日期，不得按完整覆盖报送**`);
    L.push('');
  }
  L.push('## 一、检查基本信息');
  L.push('');
  L.push(C.mdTable(['项目', '内容'], [
    ['车间', a.workshop],
    ['检查名称', a.inspection || '—'],
    ['检查范围', a.scope || '—'],
    ['检查期', period ? `${period.from} ~ ${period.to}` : '—（未指定，不做时间覆盖判定）'],
    ['检查通知/检查表', path.basename(a.notice)],
    ['材料来源', a.materials],
    ['厂内归档规范', a.spec ? path.basename(a.spec) : '—'],
    ['上次资料包', a.last || '—'],
    ['检查项总数', counts.items],
    ['资料齐全', counts.ready],
    ['未找到对应材料', counts.missing],
    ['覆盖不全', counts.partialCoverage],
    ['期限未知', counts.unknownPeriod],
    ['未对应材料', counts.unmatched],
    ['生成时间', `${C.localDateTime()}（北京时间）`],
  ]));
  L.push('## 二、逐检查项资料对照');
  L.push('');
  L.push(C.mdTable(['序号', '检查项', '资料要求', '对应材料', '文件位置', '时间覆盖', '状态'],
    items.map((x) => [x.no, x.text, x.requirement || '—',
      x.evidence.map((e) => e.name).join('<br>') || '—',
      x.evidence.map((e) => e.location).join('<br>') || '—',
      x.coverageNote, x.status === 'ready' ? x.statusCn : `**${x.statusCn}**`])));
  L.push('## 三、资料缺口清单');
  L.push('');
  if (!missing.length) L.push('_无未找到对应材料的检查项。_\n');
  else {
    L.push(C.mdTable(['序号', '检查项', '资料要求', '状态', '影响与说明', '检查项出处'],
      missing.map((x) => [x.no, `**${x.text}**`, x.requirement || '—', '**未找到对应材料**',
        `本项无可提交的证据材料，检查时将构成资料缺口，须如实说明；${x.note}`, x.src])));
    L.push('> 缺口项一律如实上报。**不得用相近材料充数，不得标注为「可用 XX 替代」，不得事后补编记录。**');
    L.push('');
  }
  L.push('## 四、覆盖不全项');
  L.push('');
  if (!partialCoverage.length) L.push('_无覆盖不全的检查项。_\n');
  else {
    L.push(C.mdTable(['序号', '检查项', '对应材料', '覆盖情况', '说明'],
      partialCoverage.map((x) => [x.no, `**${x.text}**`,
        x.evidence.map((e) => `${e.name}（${e.periodFrom || '不详'} ~ ${e.periodTo || '不详'}）`).join('<br>'),
        x.coverageNote, x.note])));
    L.push('> 覆盖不全项按实际覆盖区间说明，**不得按完整覆盖报送**，缺口区间不得补录记录。');
    L.push('');
  }
  L.push('## 五、期限未知项');
  L.push('');
  if (!unknownPeriod.length) L.push(period ? '_无期限未知的检查项。_\n' : '_未指定检查期，不做时间覆盖判定。_\n');
  else {
    L.push(C.mdTable(['序号', '检查项', '对应材料', '覆盖情况', '缺少的信息与处理'],
      unknownPeriod.map((x) => [x.no, `**${x.text}**`,
        x.evidence.map((e) => e.name).join('<br>'), x.coverageNote, x.note])));
    L.push('> 期限未知项既不算资料齐全，也不算覆盖不全：材料在，但起止日期无从判断。**须由车间核实材料实际起止日期后再说明，不得按完整覆盖报送，不得补录记录。**');
    L.push('');
  }
  L.push('## 六、未对应材料');
  L.push('');
  L.push(C.mdTable(['文件名', '存放位置', '标注类型', '时间范围', '说明'],
    unmatched.map((x) => [x.name, x.location, x.declaredType || '—',
      x.periodFrom || x.periodTo ? `${x.periodFrom || '不详'} ~ ${x.periodTo || '不详'}` : '—', x.note])));
  L.push('## 七、归集包目录建议');
  L.push('');
  if (!ready.length && !partialCoverage.length && !unknownPeriod.length) L.push('_暂无可归集的材料。_\n');
  else {
    for (const it of items) {
      if (it.status === 'missing') continue;
      L.push(`- \`${it.no}-${it.text.slice(0, 20)}/\``);
      for (const e of it.evidence) L.push(`  - ${e.name}　（现存放：${e.location}）`);
      if (it.status === 'partial' || it.status === 'unknownPeriod') L.push(`  - 【注意】${it.coverageNote}`);
    }
    L.push('');
    if (missing.length) {
      L.push(`> 以下 ${missing.length} 个检查项不建目录，因未找到对应材料：${missing.map((x) => `${x.no} ${x.text}`).join('；')}。**不得建空目录后补放材料。**`);
      L.push('');
    }
  }
  L.push('## 八、准备工作提示');
  L.push('');
  L.push('<!-- ANALYSIS_START -->');
  L.push('（由模型依据 references/evidence-rules.md 口径撰写 200~400 字，结构：资料齐备情况 → 缺口项及其影响 → 覆盖不全与期限未知项的说明口径 → 迎检准备建议。数字一律引用 evidence.json 的 counts；不判定检查项是否达标合规；不建议用其他材料替代缺失资料，不建议补编记录。）');
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
  fs.writeFileSync(path.join(outDir, 'evidence.md'), L.join('\n'), 'utf8');

  C.emitOk(outDir, { ok: true, out: outDir, workshop: a.workshop, inspection: a.inspection || null, period, counts, warnings });
}

try { main(); } catch (e) { C.fail(e, warnings); }
