#!/usr/bin/env node
'use strict';
/**
 * 技术资料检索与问答脚本（仅 Node.js 内置模块）—— 中石化炼化厂车间设备员口径
 * 用法：node scripts/find.js --docs <资料目录或文件> --tag <位号> [--query <查询内容>] [--out <dir>]
 * 可选：--ledger <设备台账 xlsx 或 CSV 目录>--doc-type <图纸|说明书|规程|技术协议|检验报告> --context <字数> --all-matches --max-files <N>
 * 产出：<out>/matches.json、matches.md、summary.json
 *
 * 硬口径：
 *  - PDF 统一前置转换：脚本不读 PDF，用户须先用平台 pdf 技能转为 txt/docx 再传入（扫描件需 OCR）；
 *    转换产物按「原名.pdf.txt / .pdf.docx / .pdf.md」命名可被识别为同一份资料，并标注「转换文本，须人工核对原件」
 *  - 未转换的 .pdf、图片、CAD 与旧版 .doc/.xls/.ppt 不解析内容 → 进 unreadable，只做文件定位，绝不声称读到了内容
 *  - 命中为空 → 明确写「所提供资料中未找到相关内容」，不放宽、不用通用知识补
 *  - 同一关键词在多份资料中原文不一致 → conflicts 全部列出，不自行取其一
 *  - 每条引用必须带出处（文件名 + 段落序号）
 *  - 文件数超过 --max-files（默认 300）直接报错，不静默截断
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const C = require('./lib/common');
const { readXlsx, readCsvDir } = require('./lib/xlsx-lite');
const lite = require('./lib/docx-lite');

const warnings = [];
const VALUE_OPTS = ['docs', 'tag', 'query', 'out', 'ledger', 'doc-type', 'context', 'max-files'];
const FLAG_OPTS = ['all-matches', 'help'];
const DEFAULT_MAX_FILES = 300;

// 可解析出文字层的格式
const TEXT_EXT = ['.md', '.txt', '.docx'];
// 明确不解析内容的格式（无文字层或本脚本不解析）
const NO_TEXT_EXT = ['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tif', '.tiff', '.dwg', '.dxf'];
// 旧版 Office 二进制格式：本脚本不解析，须另存为 .docx/.xlsx 后传入
const OLD_OFFICE_EXT = ['.doc', '.xls', '.ppt'];
const CATALOG_EXT = ['.xlsx', '.csv'];
/** PDF 前置转换说明（SKILL.md / README / input-spec 三处与此一致） */
const PDF_NOTE = '本脚本不读 PDF：请先用平台 pdf 技能转为 txt/docx 再传入（扫描件需先 OCR），转换产物按「原名.pdf.txt」命名可识别为同一份资料；本次只做文件定位，未读取内容';
/** 转换产物识别：原名.pdf.txt / .pdf.docx / .pdf.md → 视为该 PDF 的转换文本 */
const CONVERTED_RE = /\.pdf\.(txt|docx|md)$/i;
function convertedSource(base) {
  const m = C.str(base).match(CONVERTED_RE);
  return m ? C.str(base).replace(CONVERTED_RE, '.pdf') : null;
}

const DOC_TYPES = ['图纸', '说明书', '规程', '技术协议', '检验报告'];
// 文件名/标题 → 资料类型的判定词（判不出来写 null，不猜）
const TYPE_HINTS = [
  ['图纸', ['图纸', '装配图', '总图', '结构图', '外形图', '流程图', '管线图', '接线图', 'P&ID', 'PID']],
  ['说明书', ['说明书', '使用手册', '操作手册', '维护手册', '安装手册', '手册']],
  ['规程', ['规程', '操作法', '作业指导书', '检修规程', '工艺卡片']],
  ['技术协议', ['技术协议', '技术条件', '订货协议', '供货协议', '技术规格书']],
  ['检验报告', ['检验报告', '试验报告', '检测报告', '探伤报告', '出厂报告', '合格证', '监检']],
];

// 局部别名优先，再并入共享 SYSTEM_ALIASES（SAP PM / EM 列名）。「设备编号」是 SAP 流水号，不作位号别名。
const CATALOG_ALIASES = C.mergeAliases({
  '文件名': ['文件名', '资料名称', '文件名称', '名称', '资料', '图纸名称', '文档名称', '文件'],
  '资料类型': ['资料类型', '类型', '文件类型', '文档类型', '资料类别', '类别'],
  '关联位号': ['关联位号', '位号', '设备位号', '功能位置', 'TAG', 'tag'],
  '版本': ['版本', '版次', '版本号', '修订版', 'Rev', 'rev'],
  '存放位置': ['存放位置', '存放路径', '位置', '归档位置', '档案柜', '路径'],
  '归档日期': ['归档日期', '归档时间', '日期', '发布日期', '生效日期'],
});
const LEDGER_ALIASES = C.mergeAliases({
  '位号': ['位号', '设备位号', 'TAG', 'tag'],
  '设备名称': ['设备名称', '名称', '设备描述'],
  '规格型号': ['规格型号', '型号', '规格', '型号编号'],
});

const norm = (v) => C.str(v).toLowerCase();

/** 位号归一：去掉分隔符与空白，便于 P-1101A / P1101A / P_1101A 互相匹配 */
function tagKey(v) { return norm(v).replace(/[\s\-_·./]/g, ''); }

/**
 * 位号（或设备编号）是否出现在一段文字 / 文件名中：字符之间允许 `- _ · . /` 与空白，大小写不敏感；
 * 前面不能紧挨字母或数字（查 V-1101 不命中 PSV-1101、LV-1101），后面不能紧跟数字（查 V-1101 不命中 V-11011）。
 * 以字母结尾的位号还认「P-2101A/B」「P-2101A、B」这类 A/B 简写（查 P-2101B 能命中，查 P-2101C 不命中）。
 */
const TAG_SEP = '[\\s\\-_·./]*';
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const tagReCache = new Map();
function tagRes(v) {
  const k = tagKey(v);
  if (tagReCache.has(k)) return tagReCache.get(k);
  const body = (s) => [...s].map(reEsc).join(TAG_SEP);
  const res = { main: k ? new RegExp(`(?<![a-z0-9])${body(k)}(?!\\d)`) : null, ab: null, letter: null };
  const m = k.match(/^(.*\d)([a-z])$/);
  if (m) { res.ab = new RegExp(`(?<![a-z0-9])${body(m[1])}${TAG_SEP}([a-z](?:\\s*[/／、，,&＆]\\s*[a-z])+)(?![a-z0-9])`, 'g'); res.letter = m[2]; }
  tagReCache.set(k, res);
  return res;
}
function tagInText(text, v) {
  const t = norm(text);
  const r = tagRes(v);
  if (!r.main) return false;
  if (r.main.test(t)) return true;
  if (!r.ab) return false;
  r.ab.lastIndex = 0;
  let m;
  while ((m = r.ab.exec(t))) { if (m[1].split(/[^a-z]+/).includes(r.letter)) return true; }
  return false;
}

/** 资料类型判定：判不出来返回 null，不默认归到某一类 */
function guessDocType(name) {
  const s = C.str(name);
  for (const [type, words] of TYPE_HINTS) {
    if (words.some((w) => s.toLowerCase().includes(w.toLowerCase()))) return type;
  }
  return null;
}

/** 递归收集资料文件 */
function collectFiles(root) {
  const st = fs.statSync(root);
  if (!st.isDirectory()) return [root];
  const out = [];
  const walk = (d, depth) => {
    if (depth > 6) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name.startsWith('~$')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else out.push(p);
    }
  };
  walk(root, 0);
  return out.sort();
}

/**
 * 读单个 CSV 目录清单：复用共享库 readCsvDir（UTF-8/BOM/GBK 解码 + 引号转义）→ { 文件名: rows }。
 * readCsvDir 按目录读，这里把该文件单独复制到临时目录再读：只解析这一个文件，同目录其他 CSV 读不了也不受牵连。
 */
function readCatalogCsv(file) {
  const name = path.basename(file, path.extname(file));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tdf-catalog-'));
  try {
    fs.copyFileSync(file, path.join(tmp, path.basename(file)));
    const book = readCsvDir(tmp);
    if (!book[name]) throw new Error('CSV 读取失败');
    return { [name]: book[name] };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** 读出文字层，返回段落数组 [{no, text}]；读不出抛错 */
function readPassages(file, ext) {
  if (ext === '.docx') {
    const res = lite.docxToText(fs.readFileSync(file));
    return splitParagraphs(res.text);
  }
  const raw = fs.readFileSync(file, 'utf8');
  return splitParagraphs(raw);
}

function splitParagraphs(text) {
  const out = [];
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  for (const ln of lines) {
    const t = ln.trim();
    if (!t) continue;
    out.push({ no: out.length + 1, text: t });
  }
  return out;
}

/** 把一段文本按关键词截上下文 */
function excerpt(text, kw, ctx) {
  const i = norm(text).indexOf(norm(kw));
  if (i < 0 || text.length <= ctx * 2) return text;
  const from = Math.max(0, i - ctx);
  const to = Math.min(text.length, i + kw.length + ctx);
  return (from > 0 ? '…' : '') + text.slice(from, to) + (to < text.length ? '…' : '');
}

/** 查询词切分：中文按 2 字以上片段，英文/数字按词；空查询返回 [] */
function splitQuery(q) {
  const s = C.str(q);
  if (!s) return [];
  const toks = s.split(/[\s，,、。；;：:？?！!（）()「」【】"'/]+/).filter(Boolean);
  const out = [];
  for (const t of toks) {
    if (t.length < 2) continue;
    if (/^(的|是|在|有|了|和|与|或|哪|什么|怎么|多少|一下|这台|这个|资料|文件|里面|写的|请问|帮我|看看)$/.test(t)) continue;
    out.push(t);
  }
  return [...new Set(out)];
}

/** 抽出一段文本中的「数值+单位」，用于版本冲突比对；无单位的裸数字不参与比对 */
function extractValues(text) {
  const out = [];
  const re = /(-?\d+(?:\.\d+)?)\s*(MPa|kPa|N·m|N\.m|Nm|kN|mm|cm|m3\/h|m³\/h|m\/s|kW|kg|℃|°C|%|r\/min|rpm)/gi;
  let m;
  while ((m = re.exec(text))) {
    const unit = m[2].replace(/\s+/g, '').replace(/N\.m|Nm/i, 'N·m').replace(/°C/i, '℃').replace(/m³/, 'm3').replace(/rpm/i, 'r/min');
    out.push({ value: `${m[1]}${unit}`, num: m[1], unit });
  }
  return out;
}

function main() {
  const a = C.parseArgs(process.argv.slice(2), VALUE_OPTS, FLAG_OPTS);
  if (!a.docs) throw new Error('缺少 --docs');
  if (!fs.existsSync(a.docs)) throw new Error(`资料路径不存在: ${a.docs}`);
  if (!a.tag) throw new Error('缺少 --tag（设备位号或名称）');
  const tag = C.str(a.tag);
  const tkey = tagKey(tag);
  if (!tkey) throw new Error('--tag 不能为空白');
  const docType = a['doc-type'] ? C.str(a['doc-type']) : null;
  if (docType && !DOC_TYPES.includes(docType)) {
    throw new Error(`--doc-type 只能是 ${DOC_TYPES.join(' / ')}，收到「${docType}」`);
  }
  const ctx = a.context ? Number(a.context) : 60;
  if (a.context && (!Number.isFinite(ctx) || ctx < 0)) throw new Error(`--context 「${a.context}」不是非负数字`);
  let maxFiles = DEFAULT_MAX_FILES;
  if (a['max-files'] !== undefined) {
    const n = Number(a['max-files']);
    if (!Number.isFinite(n) || n < 1 || Math.round(n) !== n) throw new Error(`--max-files 「${a['max-files']}」不是正整数`);
    maxFiles = n;
  }
  const outDir = a.out || path.join(os.tmpdir(), 'tdf-out');
  const maxPassages = a['all-matches'] ? Infinity : 30;
  const query = C.str(a.query);
  const keywords = splitQuery(query);

  // ---- 设备台账（可选）：用于拿到设备名称、型号，作为关联判定的补充线索
  let ledgerInfo = null;
  if (a.ledger) {
    if (!fs.existsSync(a.ledger)) throw new Error(`设备台账不存在: ${a.ledger}`);
    const book = fs.statSync(a.ledger).isDirectory() ? readCsvDir(a.ledger) : readXlsx(a.ledger);
    const rows = C.pickSheet(book, '设备台账', '台账', '设备清单', '技术对象', '功能位置', '设备');
    if (!rows) warnings.push('设备台账文件中未找到「设备台账」工作表，已忽略台账线索');
    else {
      const recs = C.toRecords(rows, ['位号'], '设备台账', ['设备名称', '规格型号', '设备编号'], warnings, LEDGER_ALIASES);
      let hit = recs.find((r) => tagKey(r['位号']) === tkey);
      let matchedBy = '位号';
      if (!hit) { hit = recs.find((r) => C.str(r['设备编号']) && tagKey(r['设备编号']) === tkey); if (hit) matchedBy = '设备编号'; }
      if (!hit) warnings.push(`设备台账中未查到位号「${tag}」（按位号/功能位置与设备编号均未命中），未用近似位号代替`);
      else {
        ledgerInfo = { tag: C.str(hit['位号']), equipNo: C.str(hit['设备编号']) || null, matchedBy, name: C.str(hit['设备名称']) || null, model: C.str(hit['规格型号']) || null, droppedClues: [] };
        // 设备名称 / 规格型号在台账中不唯一（A/B 泵同名同型号最常见）→ 不作关联线索，否则会把同名设备的专属资料串进来。
        // 「不唯一」= 台账里另有位号不同的设备，其名称（型号）与本设备相同，或包含本设备的名称（型号）。
        const hitKey = tagKey(hit['位号']);
        const others = recs.filter((r) => r !== hit && (!hitKey || tagKey(r['位号']) !== hitKey));
        for (const [col, field] of [['设备名称', 'name'], ['规格型号', 'model']]) {
          const v = ledgerInfo[field];
          if (!v || v.length < 2) continue;
          const shared = others.filter((r) => norm(r[col]).includes(norm(v))).map((r) => C.str(r['位号']) || C.str(r['设备编号']) || `第${r._row}行`);
          if (!shared.length) continue;
          ledgerInfo.droppedClues.push({ kind: col, value: v, sharedWith: shared });
          warnings.push(`设备台账中${col}「${v}」不唯一（${shared.slice(0, 5).join('、')}${shared.length > 5 ? ` 等 ${shared.length} 台` : ''}的${col}与之相同或包含它），不作关联线索，以免把其他设备的资料关联进来`);
        }
      }
    }
  }
  // 关联线索：位号（用设备编号命中台账时改用台账位号，同时保留编号）+ 台账里唯一的设备名称、型号（都要非空且长度 ≥ 2）
  const tagClues = [];
  const tagKeys = new Set();          // 位号类线索的归一值，资料目录清单「关联位号」按这些比对
  const addTagClue = (v, kind) => { const k = tagKey(v); if (!k || tagKeys.has(k)) return; tagKeys.add(k); tagClues.push({ value: C.str(v), kind }); };
  if (ledgerInfo && ledgerInfo.matchedBy === '设备编号') { addTagClue(ledgerInfo.tag, '位号'); addTagClue(tag, '设备编号'); }
  else addTagClue(tag, '位号');
  const isTagKind = (k) => k === '位号' || k === '设备编号';
  const dropped = new Set(ledgerInfo ? ledgerInfo.droppedClues.map((x) => x.kind) : []);
  if (ledgerInfo) {
    if (ledgerInfo.name && ledgerInfo.name.length >= 2 && !dropped.has('设备名称')) tagClues.push({ value: ledgerInfo.name, kind: '设备名称（台账）' });
    if (ledgerInfo.model && ledgerInfo.model.length >= 2 && !dropped.has('规格型号')) tagClues.push({ value: ledgerInfo.model, kind: '规格型号（台账）' });
  }
  // 报告里显示的设备：用设备编号查时带出台账位号
  const tagLabel = ledgerInfo && ledgerInfo.matchedBy === '设备编号' && ledgerInfo.tag ? `${tag}（台账位号 ${ledgerInfo.tag}）` : tag;

  // ---- 分拣文件
  const files = collectFiles(a.docs);
  if (!files.length) throw new Error(`资料路径下没有文件: ${a.docs}`);
  if (files.length > maxFiles) {
    throw new Error(`资料路径下共 ${files.length} 个文件，超过 --max-files 上限 ${maxFiles}；请缩小目录范围（按装置/设备分目录）或显式提高 --max-files，脚本不静默截断`);
  }
  const catalogFiles = [], textFiles = [], noTextFiles = [], oldOfficeFiles = [], otherFiles = [];
  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    if (CATALOG_EXT.includes(ext)) catalogFiles.push(f);
    else if (TEXT_EXT.includes(ext)) textFiles.push(f);
    else if (NO_TEXT_EXT.includes(ext)) noTextFiles.push(f);
    else if (OLD_OFFICE_EXT.includes(ext)) oldOfficeFiles.push(f);
    else otherFiles.push(f);
  }
  for (const f of otherFiles) warnings.push(`文件「${path.basename(f)}」格式未识别，已跳过（可解析：.docx/.md/.txt；目录清单：.xlsx/.csv；PDF 请先转换）`);

  // ---- 资料目录清单（xlsx/csv）：只做文件定位线索，不当作资料原文
  const catalogEntries = [];
  for (const f of catalogFiles) {
    const isCsv = path.extname(f).toLowerCase() === '.csv';
    let book;
    try { book = isCsv ? readCatalogCsv(f) : readXlsx(f); } catch (e) { warnings.push(`资料目录「${path.basename(f)}」无法读取：${e.message}`); continue; }
    // CSV 只有一张表，文件名不必含「目录/清单」字样
    const rows = isCsv ? Object.values(book)[0] : C.pickSheet(book, '资料目录', '资料清单', '目录', '清单', '档案');
    if (!rows) { warnings.push(`「${path.basename(f)}」中未找到「资料目录」工作表，已跳过`); continue; }
    const recs = C.toRecords(rows, ['文件名'], '资料目录',
      ['资料类型', '关联位号', '版本', '存放位置', '归档日期'], warnings, CATALOG_ALIASES);
    for (const r of recs) {
      const fname = C.str(r['文件名']);
      if (!fname) continue;
      catalogEntries.push({
        catalog: path.basename(f), row: r._row, fileName: fname,
        docType: C.str(r['资料类型']) || guessDocType(fname),
        linkedTag: C.str(r['关联位号']) || null,
        version: C.str(r['版本']) || null,
        location: C.str(r['存放位置']) || null,
        archivedAt: C.normDate(r['归档日期']) || (C.str(r['归档日期']) || null),
      });
    }
  }

  // ---- 逐文件判定关联并抽段落
  const documents = [];       // 与设备关联的文件
  const unrelated = [];       // 无法关联的文件（单列）
  const unreadable = [];      // 无文字层 / 解析失败
  const passages = [];        // 命中段落

  const relateByName = (base) => {
    for (const c of tagClues) {
      if (isTagKind(c.kind)) { if (tagInText(base, c.value)) return { by: `文件名含${c.kind}`, clue: c.value }; }
      else if (norm(base).includes(norm(c.value))) return { by: `文件名含${c.kind}`, clue: c.value };
    }
    return null;
  };
  const linkedToTag = (e) => !!(e.linkedTag && tagKeys.has(tagKey(e.linkedTag)));
  const relateByCatalog = (base) => {
    const src = convertedSource(base);
    const e = catalogEntries.find((x) => norm(x.fileName) === norm(base) || norm(base).includes(norm(x.fileName)) || norm(x.fileName).includes(norm(base))
      || (src && (norm(x.fileName) === norm(src) || norm(src).includes(norm(x.fileName)))));
    if (e && linkedToTag(e)) return { by: '资料目录清单标注关联位号', clue: `${e.catalog} 第${e.row}行`, entry: e };
    return e ? { entry: e } : null;
  };

  for (const f of textFiles) {
    const base = path.basename(f);
    const ext = path.extname(f).toLowerCase();
    let paras = null;
    try { paras = readPassages(f, ext); }
    catch (e) {
      warnings.push(`文件「${base}」解析失败：${e.message}`);
      unreadable.push({ file: base, path: f, ext, reason: `解析失败：${e.message}`, contentSearched: false });
      continue;
    }
    if (!paras.length) {
      warnings.push(`文件「${base}」没有可检索的文字内容`);
      unreadable.push({ file: base, path: f, ext, reason: '文件内无文字内容', contentSearched: false });
      continue;
    }
    // 关联判定：文件名 或 内容中出现位号/设备名称/型号
    let rel = relateByName(base);
    const inContent = [];
    for (const c of tagClues) {
      const hit = paras.find((p) => (isTagKind(c.kind) ? tagInText(p.text, c.value) :norm(p.text).includes(norm(c.value))));
      if (hit) inContent.push({ clue: c.value, kind: c.kind, no: hit.no });
    }
    if (!rel && inContent.length) rel = { by: `内容中出现${inContent[0].kind}`, clue: inContent[0].clue, at: `第${inContent[0].no}段` };
    const cat = relateByCatalog(base);
    if (!rel && cat && cat.by) rel = { by: cat.by, clue: cat.clue };
    const entry = cat && cat.entry ? cat.entry : null;
    const type = (entry && entry.docType) || guessDocType(base);
    const convertedFrom = convertedSource(base);
    if (convertedFrom) warnings.push(`文件「${base}」是 PDF「${convertedFrom}」的转换文本：内容由平台 pdf 技能转换产生，未经脚本验证，引用时须人工核对原件`);

    const doc = {
      file: base, path: f, ext, docType: type,
      related: !!rel,
      relatedBy: rel ? rel.by : null,
      relatedClue: rel ? rel.clue : null,
      relatedAt: rel && rel.at ? rel.at : null,
      contentSearchable: true,
      convertedFrom,
      paragraphs: paras.length,
      version: entry ? entry.version : null,
      location: entry ? entry.location : null,
      catalogRow: entry ? `${entry.catalog} 第${entry.row}行` : null,
    };
    if (!rel) { unrelated.push(doc); continue; }
    if (docType && type !== docType) { doc.filteredOut = `--doc-type=${docType}，本文件类型为${type || '未判定'}`; unrelated.push(doc); continue; }
    documents.push(doc);

    // 命中段落：有 --query 时按关键词，无 --query 时只做定位不抽段落
    if (!keywords.length) continue;
    for (const p of paras) {
      const hits = keywords.filter((k) => norm(p.text).includes(norm(k)));
      if (!hits.length) continue;
      passages.push({
        file: base, docType: type, location: `第${p.no}段`, paragraphNo: p.no,
        keywords: hits, hitCount: hits.length,
        text: p.text,
        excerpt: excerpt(p.text, hits[0], ctx),
        version: doc.version,
        convertedFrom,
        values: extractValues(p.text),
      });
    }
  }

  // ---- 无文字层 / 不解析的文件：只做文件定位，绝不声称读到内容
  const convertedSources = new Set(textFiles.map((f) => convertedSource(path.basename(f))).filter(Boolean).map(norm));
  for (const f of noTextFiles.concat(oldOfficeFiles)) {
    const base = path.basename(f);
    const ext = path.extname(f).toLowerCase();
    const cat = relateByCatalog(base);
    let rel = relateByName(base);
    if (!rel && cat && cat.by) rel = { by: cat.by, clue: cat.clue };
    const entry = cat && cat.entry ? cat.entry : null;
    const type = (entry && entry.docType) || guessDocType(base);
    let reason;
    if (ext === '.pdf') reason = convertedSources.has(norm(base)) ? `PDF 原件（已提供转换文本「${base}.txt/.docx/.md」，检索以转换文本为准）：${PDF_NOTE}` : PDF_NOTE;
    else if (OLD_OFFICE_EXT.includes(ext)) reason = `旧版 Office 二进制格式（${ext}），本脚本不解析：请在 Office 中另存为 ${ext === '.doc' ? '.docx' : ext === '.xls' ? '.xlsx（目录清单）' : '.pptx 后再转 .docx/.txt'} 再传入；本次只做文件定位，未读取内容`;
    else if (['.dwg', '.dxf'].includes(ext)) reason = 'CAD 图纸文件：无文字层可供本脚本检索，仅做文件定位';
    else reason = '图片格式图纸 / 扫描件：无文字层，无法检索内容，仅做文件定位（需 OCR 后以 txt 传入）';
    warnings.push(`文件「${base}」${reason}`);
    const doc = {
      file: base, path: f, ext, docType: type,
      related: !!rel, relatedBy: rel ? rel.by : null, relatedClue: rel ? rel.clue : null, relatedAt: null,
      contentSearchable: false, convertedFrom: null, paragraphs: null,
      version: entry ? entry.version : null,
      location: entry ? entry.location : null,
      catalogRow: entry ? `${entry.catalog} 第${entry.row}行` : null,
    };
    unreadable.push({ file: base, path: f, ext, reason, contentSearched: false, related: !!rel, relatedBy: doc.relatedBy });
    if (!rel) { unrelated.push(doc); continue; }
    if (docType && type !== docType) { doc.filteredOut = `--doc-type=${docType}，本文件类型为${type || '未判定'}`; unrelated.push(doc); continue; }
    documents.push(doc);
  }

  // ---- 资料目录清单中登记、但目录下没有实体文件的条目（PDF 的转换文本视为该 PDF 已提供）
  const presentNames = new Set(files.map((f) => norm(path.basename(f))));
  for (const f of textFiles) { const src = convertedSource(path.basename(f)); if (src) presentNames.add(norm(src)); }
  const catalogOnly = [];
  for (const e of catalogEntries) {
    if (presentNames.has(norm(e.fileName))) continue;
    if (!linkedToTag(e) && !relateByName(e.fileName)) continue;
    if (docType && e.docType !== docType) continue;
    catalogOnly.push(e);
    warnings.push(`资料目录「${e.catalog}」第${e.row}行登记的「${e.fileName}」在所提供路径下未找到实体文件，仅返回登记信息`);
  }

  // ---- 版本冲突：同一关键词、同一量纲（单位），不同文件给出不同取值
  const conflicts = [];
  for (const k of keywords) {
    const rel = passages.filter((p) => p.keywords.includes(k) && p.values.length);
    if (rel.length < 2) continue;
    const byUnit = new Map();                              // 单位 → Map(取值 → 出处[])
    for (const p of rel) {
      for (const v of p.values) {
        if (!byUnit.has(v.unit)) byUnit.set(v.unit, new Map());
        const m = byUnit.get(v.unit);
        if (!m.has(v.value)) m.set(v.value, []);
        m.get(v.value).push({ file: p.file, location: p.location, version: p.version, text: p.text });
      }
    }
    for (const [unit, m] of byUnit) {
      const distinct = [...m.entries()];
      if (distinct.length < 2) continue;                   // 同一单位下只有一个取值 → 不算冲突
      // 按文件归集取值：只有两份资料各有对方没有的取值时才算冲突。
      // 同一文件内的多个取值不算；一份资料的取值被另一份完全包含也不算（规程只写径向 0.05mm、说明书写径向 0.05mm + 轴向 0.08mm）
      const byFile = new Map();
      for (const [v, srcs] of distinct) for (const x of srcs) { if (!byFile.has(x.file)) byFile.set(x.file, new Set()); byFile.get(x.file).add(v); }
      const sets = [...byFile.values()];
      const covers = (a, b) => [...b].every((v) => a.has(v));
      if (!sets.some((a, i) => sets.some((b, j) => j > i && !covers(a, b) && !covers(b, a)))) continue;
      conflicts.push({
        keyword: k, unit,
        values: distinct.map(([v, srcs]) => ({ value: v, sources: srcs })),
        note: '多处原文取值不一致，已全部列出，未自行取其一；请核实资料版本后以受控文件为准',
      });
    }
  }

  // ---- 命中段落排序与截断
  passages.sort((x, y) => (y.hitCount - x.hitCount) || x.file.localeCompare(y.file) || (x.paragraphNo - y.paragraphNo));
  const passagesTotal = passages.length;
  const passagesOut = passagesTotal > maxPassages ? passages.slice(0, maxPassages) : passages;
  if (passagesTotal > maxPassages) warnings.push(`命中 ${passagesTotal} 段，仅返回前 ${maxPassages} 段（加 --all-matches 返回全部）`);

  if (!documents.length) warnings.push(`所提供资料中没有与「${tagLabel}」关联的文件，未用其他设备的资料代替`);
  if (keywords.length && !passagesTotal) warnings.push(`在关联资料中未检索到与「${query}」相关的内容，未用通用知识补充`);
  if (query && !keywords.length) warnings.push(`--query「${query}」中没有长度 ≥2 的有效检索词，仅做文件定位`);

  const searchable = documents.filter((d) => d.contentSearchable);
  const counts = {
    filesScanned: files.length,
    maxFiles,
    catalogFiles: catalogFiles.length,
    oldOfficeFiles: oldOfficeFiles.length,
    documentsRelated: documents.length,
    documentsContentSearchable: searchable.length,
    documentsConverted: documents.filter((d) => d.convertedFrom).length,
    documentsNoTextLayer: documents.filter((d) => !d.contentSearchable).length,
    passages: passagesOut.length,
    passagesTotal,
    conflicts: conflicts.length,
    unreadable: unreadable.length,
    unrelated: unrelated.length,
    catalogOnly: catalogOnly.length,
  };

  // ---- 产出
  C.ensureDir(outDir);
  const DISCLAIMER = '引用内容来自所提供资料，资料版本有效性请以受控文件系统为准；未能解析的文件已列出。经平台 pdf 技能转换的文本属模型读取产生，未经脚本验证，须人工核对原件。';
  const result = {
    meta: {
      docsRoot: path.resolve(a.docs), tag, query: query || null,
      keywords, docTypeFilter: docType, contextChars: ctx, maxFiles,
      allMatches: !!a['all-matches'], pdfNote: PDF_NOTE,
      ledgerProvided: !!a.ledger, ledgerInfo,
      generatedAt: C.localDateTime(), disclaimer: DISCLAIMER,
    },
    counts, documents, passages: passagesOut, conflicts, unreadable, unrelated, catalogOnly, warnings,
  };
  fs.writeFileSync(path.join(outDir, 'matches.json'), JSON.stringify(result, null, 2), 'utf8');

  const L = [];
  L.push('# 技术资料检索结果');
  L.push('');
  L.push(`设备：${tagLabel}${ledgerInfo && ledgerInfo.name ? `　${ledgerInfo.name}` : ''}　查询内容：${query || '（仅资料定位）'}`);
  L.push(`资料路径：${path.resolve(a.docs)}（扫描 ${counts.filesScanned} 个文件）　检索时间：${C.localDateTime()}（北京时间）`);
  if (docType) L.push(`资料类型过滤：${docType}`);
  L.push('');
  if (counts.documentsConverted) {
    L.push(`【注意】本次有 ${counts.documentsConverted} 份资料是 PDF 的转换文本（平台 pdf 技能转换产生，未经脚本验证），引用时须人工核对原件。`);
    L.push('');
  }

  L.push('## 一、相关资料文件');
  L.push('');
  if (!documents.length) {
    L.push(`**所提供资料中未找到与「${tagLabel}」关联的文件。**`);
    L.push('');
    L.push('> 未放宽关联条件，也未用其他设备的资料代替。请确认位号是否正确，或补充提供该设备的资料目录。');
    L.push('');
  } else {
    L.push(C.mdTable(['文件名', '资料类型', '关联依据', '内容可检索', '版本', '存放位置'],
      documents.map((d) => [d.file, d.docType || '—（未判定）', `${d.relatedBy}${d.relatedClue ? `：${d.relatedClue}` : ''}${d.relatedAt ? `（${d.relatedAt}）` : ''}`,
        d.contentSearchable ? (d.convertedFrom ? `是（${d.paragraphs} 段，PDF 转换文本，须核对原件）` : `是（${d.paragraphs} 段）`) : '**否（未解析）**', d.version || '—', d.location || '—'])));
  }

  L.push('## 二、原文引用');
  L.push('');
  if (!keywords.length) {
    L.push('本次未提供有效检索词，仅做资料定位，未抽取原文。');
    L.push('');
  } else if (!passagesOut.length) {
    L.push(`**所提供资料中未找到与「${query}」相关的内容。**`);
    L.push('');
    if (!counts.documentsContentSearchable) {
      L.push(`> 本次没有可检索文字内容的关联资料${documents.length ? '（关联到的文件均无文字层）' : ''}，因此未做原文检索——不是"查过了没有"，而是"没有可查的资料"。`);
      L.push('');
    }
    L.push('> 未用通用知识补充，也未用其他设备的资料代替。若该参数应有出处，请补充提供对应的说明书、规程或技术协议。');
    L.push('');
  } else {
    L.push(`命中 **${passagesTotal}** 段${passagesTotal > passagesOut.length ? `，以下列出前 ${passagesOut.length} 段` : ''}。原文照录，解释另列：`);
    L.push('');
    for (const p of passagesOut) {
      L.push(`**出处：${p.file}　${p.location}${p.version ? `　版本 ${p.version}` : ''}**（命中词：${p.keywords.join('、')}${p.convertedFrom ? `；PDF 转换文本，须核对原件 ${p.convertedFrom}` : ''}）`);
      L.push('');
      L.push(`> ${p.text}`);
      L.push('');
    }
  }

  L.push('## 三、多处原文不一致');
  L.push('');
  if (!conflicts.length) {
    L.push('未发现同一内容在不同资料中取值不一致的情况。');
    L.push('');
  } else {
    for (const c of conflicts) {
      L.push(`### 关键词「${c.keyword}」（单位 ${c.unit}）`);
      L.push('');
      L.push(C.mdTable(['取值', '出处', '版本', '原文'],
        c.values.flatMap((v) => v.sources.map((s) => [v.value, `${s.file}　${s.location}`, s.version || '—', s.text]))));
      L.push(`> ${c.note}`);
      L.push('');
    }
  }

  L.push('## 四、无法检索内容的文件');
  L.push('');
  if (!unreadable.length) {
    L.push('无。所提供资料均可检索文字内容。');
    L.push('');
  } else {
    L.push(C.mdTable(['文件名', '格式', '原因', '是否与本设备关联'],
      unreadable.map((u) => [u.file, u.ext, u.reason, u.related === undefined ? '—' : (u.related ? '是' : '否')])));
    L.push('> 以上文件**只做了文件定位，未读取其中任何内容**；图纸上的尺寸、材质、编号等一律不得据此作答，需人工打开原件查看。PDF 请先用平台 pdf 技能转为 txt/docx（扫描件需 OCR）后重跑；.doc/.xls 请另存为 .docx/.xlsx。');
    L.push('');
  }

  if (catalogOnly.length) {
    L.push('## 五、资料目录已登记但未提供实体文件');
    L.push('');
    L.push(C.mdTable(['文件名', '资料类型', '版本', '存放位置', '登记来源'],
      catalogOnly.map((e) => [e.fileName, e.docType || '—（未判定）', e.version || '—', e.location || '—', `${e.catalog} 第${e.row}行`])));
    L.push('> 以上仅为台账登记信息，**未读到文件内容**，需按存放位置调阅原件。');
    L.push('');
  }

  L.push(`## ${catalogOnly.length ? '六' : '五'}、无法关联的文件`);
  L.push('');
  if (!unrelated.length) {
    L.push('无。');
    L.push('');
  } else {
    L.push(C.mdTable(['文件名', '资料类型', '说明'],
      unrelated.map((d) => [d.file, d.docType || '—（未判定）', d.filteredOut || `文件名与内容中均未出现「${tagLabel}」及台账线索，未强行关联`])));
    L.push('');
  }

  L.push(`## ${catalogOnly.length ? '七' : '六'}、资料解读`);
  L.push('');
  L.push('<!-- ANALYSIS_START -->');
  L.push('（由模型依据 references/retrieval-rules.md 口径撰写：先照录原文与出处，再用一两句话解释；解释不得引入原文没有的数值或结论；多处不一致时全部列出并提示核实版本；资料中没有的内容写「资料中未找到」。）');
  L.push('<!-- ANALYSIS_END -->');
  L.push('');

  L.push('---');
  L.push('');
  L.push(`> ${DISCLAIMER}`);
  L.push('');
  if (warnings.length) {
    L.push('## 附：数据提示');
    L.push('');
    for (const w of warnings) L.push(`- ${w}`);
    L.push('');
  }
  fs.writeFileSync(path.join(outDir, 'matches.md'), L.join('\n'), 'utf8');

  C.emitOk(outDir, { ok: true, out: outDir, tag, query: query || null, counts, conflicts: conflicts.map((c) => `${c.keyword}/${c.unit}`), warnings });
}

try { main(); } catch (e) { C.fail(e, warnings); }
