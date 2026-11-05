'use strict';
/**
 * docx-lite —— 仅用 Node.js 内置模块（zlib）的极简 docx 读写工具
 *  - ZIP 读取：EOCD → central directory → local header → zlib.inflateRawSync
 *  - ZIP 写入：deflateRawSync + CRC32，生成标准 zip（Word / WPS 可直接打开）
 *  - XML 解析：极简 DOM（节点 {name, attrs, children, text}），够用于 word/document.xml
 *  - docx 抽取：把 document.xml 变成 [{kind:'paragraph',text} | {kind:'table',rows:[[cell...]]}]
 *    勾选框统一为 [x] / [ ]；叉选 ✘✗ → [×]（含义需人工判断）；删除线文本 → ~~…~~
 *    合并单元格：gridSpan 被合并列占位「‹›」（区别于真正留白的空串），vMerge 续行用「〃」
 *    文本框（w:txbxContent，含 DrawingML wps:txbx 与 VML v:textbox）内容以「【文本框】…」内联输出
 *    页眉/页脚（word/header*.xml、footer*.xml）追加为「### 页眉 / ### 页脚」块
 */
const zlib = require('zlib');

/* ============================ ZIP 读取 ============================ */
function readZip(buf) {
  if (!Buffer.isBuffer(buf)) throw new Error('readZip 需要 Buffer');
  // 1. 从尾部找 EOCD（0x06054b50），注释区最多 65535 字节
  let eocd = -1;
  const minPos = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= minPos; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 zip/docx：未找到 EOCD 记录');
  const cdCount = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  // 2. 遍历 central directory
  const entries = new Map();
  let p = cdOffset;
  for (let n = 0; n < cdCount; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('central directory 损坏');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const uncompSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    entries.set(name, { method, compSize, uncompSize, localOff });
    p += 46 + nameLen + extraLen + commentLen;
  }
  // 3. 按需解压
  const files = new Map();
  for (const [name, e] of entries) {
    const lh = e.localOff;
    if (buf.readUInt32LE(lh) !== 0x04034b50) throw new Error(`local header 损坏：${name}`);
    const nameLen = buf.readUInt16LE(lh + 26);
    const extraLen = buf.readUInt16LE(lh + 28);
    const start = lh + 30 + nameLen + extraLen;
    const raw = buf.slice(start, start + e.compSize);
    let data;
    if (e.method === 0) data = raw;
    else if (e.method === 8) data = zlib.inflateRawSync(raw);
    else throw new Error(`不支持的压缩方式 ${e.method}：${name}`);
    files.set(name, data);
  }
  return files;
}

/* ============================ ZIP 写入 ============================ */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function dosDateTime(d = new Date()) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}
/** entries: [{name, data: Buffer|string, store?: boolean}] → Buffer */
function writeZip(entries) {
  const { time, date } = dosDateTime();
  const locals = [], centrals = [];
  let offset = 0;
  for (const ent of entries) {
    const nameBuf = Buffer.from(ent.name, 'utf8');
    const data = Buffer.isBuffer(ent.data) ? ent.data : Buffer.from(String(ent.data), 'utf8');
    const store = ent.store || data.length === 0;
    const comp = store ? data : zlib.deflateRawSync(data, { level: 9 });
    const method = store ? 0 : 8;
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); // UTF-8 名称标志
    lh.writeUInt16LE(method, 8); lh.writeUInt16LE(time, 10); lh.writeUInt16LE(date, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(method, 10); ch.writeUInt16LE(time, 12); ch.writeUInt16LE(date, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36); ch.writeUInt32LE(0, 38); ch.writeUInt32LE(offset, 42);
    locals.push(lh, nameBuf, comp);
    centrals.push(ch, nameBuf);
    offset += lh.length + nameBuf.length + comp.length;
  }
  const cdSize = centrals.reduce((s, b) => s + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdSize, 12); eocd.writeUInt32LE(offset, 16); eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, ...centrals, eocd]);
}

/* ============================ XML 极简 DOM ============================ */
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function xmlDecode(s) {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return e in ENTITIES ? ENTITIES[e] : m;
  });
}
function xmlEscape(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function parseAttrs(s) {
  const attrs = {};
  const re = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(s))) attrs[m[1]] = xmlDecode(m[2] !== undefined ? m[2] : m[3]);
  return attrs;
}
/** 解析 XML 字符串 → 根节点 {name, attrs, children:[node|{text}]} */
function parseXml(xml) {
  const root = { name: '#root', attrs: {}, children: [] };
  const stack = [root];
  let i = 0;
  const len = xml.length;
  while (i < len) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) { pushText(xml.slice(i)); break; }
    if (lt > i) pushText(xml.slice(i, lt));
    if (xml.startsWith('<!--', lt)) { i = xml.indexOf('-->', lt) + 3; continue; }
    if (xml.startsWith('<![CDATA[', lt)) { const e = xml.indexOf(']]>', lt); stack[stack.length - 1].children.push({ text: xml.slice(lt + 9, e) }); i = e + 3; continue; }
    if (xml.startsWith('<?', lt)) { i = xml.indexOf('?>', lt) + 2; continue; }
    if (xml.startsWith('<!', lt)) { i = xml.indexOf('>', lt) + 1; continue; }
    // 找标签结束（属性值内可能有 >，简单处理引号）
    let j = lt + 1, q = null;
    for (; j < len; j++) {
      const ch = xml[j];
      if (q) { if (ch === q) q = null; }
      else if (ch === '"' || ch === "'") q = ch;
      else if (ch === '>') break;
    }
    const inner = xml.slice(lt + 1, j);
    i = j + 1;
    if (inner[0] === '/') { stack.pop(); if (!stack.length) stack.push(root); continue; }
    const selfClose = inner.endsWith('/');
    const body = selfClose ? inner.slice(0, -1) : inner;
    const sp = body.search(/[\s]/);
    const name = sp < 0 ? body : body.slice(0, sp);
    const node = { name, attrs: sp < 0 ? {} : parseAttrs(body.slice(sp)), children: [] };
    stack[stack.length - 1].children.push(node);
    if (!selfClose) stack.push(node);
  }
  function pushText(t) { if (t) stack[stack.length - 1].children.push({ text: xmlDecode(t) }); }
  return root;
}
function isElem(n) { return n && typeof n.name === 'string'; }
function child(node, name) { return (node.children || []).find(c => c.name === name); }
function childAttr(node, name, attr, dflt) { const c = child(node, name); return c && attr in c.attrs ? c.attrs[attr] : dflt; }
/** 深度优先查找所有名为 name 的后代（含自身） */
function findAll(node, name, out = []) {
  if (isElem(node) && node.name === name) out.push(node);
  for (const c of node.children || []) if (isElem(c)) findAll(c, name, out);
  return out;
}

/* ============================ docx → 结构化文本 ============================ */
const BOX_CHECKED = '[x]', BOX_EMPTY = '[ ]', BOX_CROSS = '[×]', SPAN_PLACEHOLDER = '‹›';
// 常见 Unicode 勾选符号：实心/带勾方块视为已勾；空心方块视为未勾；✘✗ 单独输出 [×]（可能是“选中”也可能是“否定”，需人工判断）
const CHECKED_CHARS = /[☑☒✓✔√■▣◼✅]/g; // ☑ ☒ ✓ ✔ √ ■ ▣ ◼ ✅
const EMPTY_CHARS = /[☐□◻❏]/g; // ☐ □ ◻ ❏
const CROSS_CHARS = /[✘✗]/g;
// Wingdings / Wingdings 2 常用符号（w:sym w:char）
const SYM_CHECKED = new Set(['F0FE', 'F0FD', 'F0FC', 'F0F8', 'F052', 'F0D2', 'F0D3', 'F0A8', 'F06E']); // þ ý ü ø R Ò Ó ■ n
const SYM_EMPTY = new Set(['F0A8', 'F06F', 'F0A0', 'F0A1', 'F0A6', 'F0A7', 'F0B0', 'F0AF']); // 空框
function normalizeBoxes(s) {
  return s.replace(CHECKED_CHARS, BOX_CHECKED).replace(EMPTY_CHARS, BOX_EMPTY).replace(CROSS_CHARS, BOX_CROSS);
}
/** 查找后代节点，跳过 mc:Fallback（避免 DrawingML 文本框与其 VML 回退重复输出） */
function findAllSkipFallback(node, name, out = []) {
  if (isElem(node) && node.name === name) out.push(node);
  for (const c of node.children || []) if (isElem(c) && c.name !== 'mc:Fallback') findAllSkipFallback(c, name, out);
  return out;
}
/** 文本框内容 → 「【文本框】段1 / 段2」 */
function textboxText(container) {
  const boxes = findAllSkipFallback(container, 'w:txbxContent');
  const parts = [];
  for (const b of boxes) {
    const ps = (b.children || []).filter(isElem).flatMap(n => n.name === 'w:p' ? [n] : findAll(n, 'w:p'));
    const t = ps.map(paragraphText).filter(Boolean).join(' / ');
    if (t) parts.push('【文本框】' + t);
  }
  return parts.join(' ');
}
/** run 是否带删除线 */
function isStrike(r) {
  const pr = child(r, 'w:rPr');
  if (!pr) return false;
  const st = child(pr, 'w:strike') || child(pr, 'w:dstrike');
  if (!st) return false;
  const v = st.attrs['w:val'];
  return v === undefined || !/^(0|false|off)$/i.test(v);
}
function symToBox(node) {
  const ch = String(node.attrs['w:char'] || '').toUpperCase();
  const font = String(node.attrs['w:font'] || '');
  if (/Wingdings|Webdings|Symbol|MS Gothic|Segoe UI Symbol/i.test(font) || ch.startsWith('F0')) {
    // F0A8 在 Wingdings 中是「▪」空心/实心难辨，按空框处理
    if (ch === 'F0A8') return BOX_EMPTY;
    if (SYM_CHECKED.has(ch)) return BOX_CHECKED;
    if (SYM_EMPTY.has(ch)) return BOX_EMPTY;
  }
  return '';
}

/** 段落 → 纯文本（含勾选框归一化） */
function paragraphText(p) {
  let out = '';
  (function walk(n) {
    for (const c of n.children || []) {
      if (!isElem(c)) continue;
      switch (c.name) {
        case 'w:t': out += (c.children || []).map(x => x.text || '').join(''); break;
        case 'w:tab': out += '\t'; break;
        case 'w:br': case 'w:cr': out += '\n'; break;
        case 'w:sym': out += symToBox(c); break;
        case 'w:noBreakHyphen': out += '-'; break;
        case 'w:softHyphen': break;
        case 'w:del': case 'w:delText': case 'w:instrText': case 'w:rPr': case 'w:pPr': break;
        case 'w:drawing': case 'w:pict': { const t = textboxText(c); if (t) out += (out && !/\s$/.test(out) ? ' ' : '') + t + ' '; break; }
        case 'w:r': {
          if (isStrike(c)) { const before = out.length; walk(c); const inner = out.slice(before); out = out.slice(0, before) + (inner.trim() ? '~~' + inner + '~~' : inner); }
          else walk(c);
          break;
        }
        case 'w:fldChar': {
          const ff = child(c, 'w:ffData');
          const cb = ff && child(ff, 'w:checkBox');
          if (cb) {
            const v = childAttr(cb, 'w:checked', 'w:val', null) ?? childAttr(cb, 'w:default', 'w:val', '0');
            out += (v === '1' || v === 'true' || v === 'on') ? BOX_CHECKED : BOX_EMPTY;
          }
          break;
        }
        case 'w:sdt': {
          const pr = child(c, 'w:sdtPr');
          const cb = pr && child(pr, 'w14:checkbox');
          if (cb) {
            const v = childAttr(cb, 'w14:checked', 'w14:val', '0');
            out += (v === '1' || v === 'true') ? BOX_CHECKED : BOX_EMPTY;
          } else {
            const content = child(c, 'w:sdtContent');
            if (content) walk(content);
          }
          break;
        }
        default: walk(c);
      }
    }
  })(p);
  return normalizeBoxes(out).replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').trim();
}

/** 表格 → rows[][]，处理 gridSpan / vMerge，嵌套表格拍平进单元格 */
function tableRows(tbl) {
  const rows = [];
  const trs = (tbl.children || []).filter(c => c.name === 'w:tr' || (c.name === 'w:sdt'));
  const trList = [];
  for (const c of trs) {
    if (c.name === 'w:tr') trList.push(c);
    else { const sc = child(c, 'w:sdtContent'); if (sc) trList.push(...(sc.children || []).filter(x => x.name === 'w:tr')); }
  }
  for (const tr of trList) {
    const cells = [];
    const tcs = [];
    for (const c of tr.children || []) {
      if (c.name === 'w:tc') tcs.push(c);
      else if (c.name === 'w:sdt') { const sc = child(c, 'w:sdtContent'); if (sc) tcs.push(...(sc.children || []).filter(x => x.name === 'w:tc')); }
    }
    for (const tc of tcs) {
      const pr = child(tc, 'w:tcPr') || { children: [] };
      const span = parseInt(childAttr(pr, 'w:gridSpan', 'w:val', '1'), 10) || 1;
      const vm = child(pr, 'w:vMerge');
      const vMerge = vm ? (vm.attrs['w:val'] || 'continue') : null;
      const parts = [];
      for (const b of tc.children || []) {
        if (b.name === 'w:p') { const t = paragraphText(b); if (t) parts.push(t); }
        else if (b.name === 'w:tbl') parts.push(tableRows(b).map(r => r.join(' | ')).join(' / '));
        else if (b.name === 'w:sdt') { const sc = child(b, 'w:sdtContent'); if (sc) for (const p of sc.children || []) if (p.name === 'w:p') { const t = paragraphText(p); if (t) parts.push(t); } }
      }
      let text = parts.join('\n');
      if (vMerge === 'continue' && !text) text = '〃';
      cells.push(text);
      for (let k = 1; k < span; k++) cells.push(SPAN_PLACEHOLDER);
    }
    rows.push(cells);
  }
  return rows;
}

/** document.xml 字符串 → blocks */
function extractBlocks(documentXml) {
  const root = parseXml(documentXml);
  const doc = findAll(root, 'w:document')[0] || root;
  const body = findAll(doc, 'w:body')[0] || doc;
  const blocks = [];
  (function walkBody(n) {
    for (const c of n.children || []) {
      if (!isElem(c)) continue;
      if (c.name === 'w:p') blocks.push({ kind: 'paragraph', text: paragraphText(c) });
      else if (c.name === 'w:tbl') blocks.push({ kind: 'table', rows: tableRows(c) });
      else if (c.name === 'w:sdt') { const sc = child(c, 'w:sdtContent'); if (sc) walkBody(sc); }
      else if (c.name === 'w:sectPr') { /* 忽略 */ }
      else walkBody(c);
    }
  })(body);
  return blocks;
}

/** blocks → 人读文本 */
function renderBlocks(blocks) {
  const lines = [];
  let tableNo = 0, lastBlank = false;
  for (const b of blocks) {
    if (b.kind === 'paragraph') {
      if (!b.text) { if (!lastBlank && lines.length) { lines.push(''); lastBlank = true; } continue; }
      lines.push(b.text); lastBlank = false;
    } else {
      tableNo++;
      const cols = Math.max(0, ...b.rows.map(r => r.length));
      lines.push('', `### 表格 ${tableNo}（${b.rows.length} 行 × ${cols} 列）`);
      for (const r of b.rows) lines.push('| ' + r.map(c => c.replace(/\|/g, '｜').replace(/\n/g, ' ')).join(' | ') + ' |');
      lines.push(''); lastBlank = true;
    }
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/** docx Buffer → {blocks, text, summary}；页眉/页脚追加在正文之后 */
function docxToText(buf) {
  const files = readZip(buf);
  const doc = files.get('word/document.xml');
  if (!doc) throw new Error('docx 中缺少 word/document.xml');
  const blocks = extractBlocks(doc.toString('utf8'));
  let text = renderBlocks(blocks);
  const hf = [...files.keys()].filter(n => /^word\/(header|footer)\d*\.xml$/.test(n)).sort();
  let hfCount = 0;
  for (const name of hf) {
    const hb = extractBlocks(files.get(name).toString('utf8'));
    const t = renderBlocks(hb).trim();
    if (!t) continue;
    hfCount++;
    text += `\n### ${/header/.test(name) ? '页眉' : '页脚'}（${name.replace('word/', '')}）\n${t}\n`;
  }
  const checked = (text.match(/\[x\]/g) || []).length, unchecked = (text.match(/\[ \]/g) || []).length;
  const crossed = (text.match(/\[×\]/g) || []).length, textboxes = (text.match(/【文本框】/g) || []).length;
  return { blocks, text, summary: { paragraphs: blocks.filter(b => b.kind === 'paragraph' && b.text).length, tables: blocks.filter(b => b.kind === 'table').length, checked, unchecked, crossed, textboxes, header_footer: hfCount } };
}

/* ============================ docx 写入端（极简 WordprocessingML） ============================ */
const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="w14"';

function runXml(text, o = {}) {
  const rpr = [];
  if (o.font) rpr.push(`<w:rFonts w:ascii="${o.font}" w:eastAsia="${o.font}" w:hAnsi="${o.font}" w:cs="${o.font}"/>`);
  if (o.bold) rpr.push('<w:b/>');
  if (o.size) rpr.push(`<w:sz w:val="${o.size * 2}"/><w:szCs w:val="${o.size * 2}"/>`);
  const parts = String(text).split('\n').map((seg, i) => (i ? '<w:br/>' : '') + `<w:t xml:space="preserve">${xmlEscape(seg)}</w:t>`).join('');
  return `<w:r>${rpr.length ? `<w:rPr>${rpr.join('')}</w:rPr>` : ''}${parts}</w:r>`;
}
/** 特殊 run：Wingdings 勾选符号 */
function symRunXml(checked) { return `<w:r><w:sym w:font="Wingdings" w:char="${checked ? 'F0FE' : 'F0A8'}"/></w:r>`; }
/** 特殊 run：Word 2010 复选框内容控件 */
function checkboxSdtXml(checked) {
  return `<w:sdt><w:sdtPr><w14:checkbox><w14:checked w14:val="${checked ? 1 : 0}"/><w14:checkedState w14:val="2612" w14:font="MS Gothic"/><w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/></w14:checkbox></w:sdtPr><w:sdtContent><w:r><w:rPr><w:rFonts w:ascii="MS Gothic" w:eastAsia="MS Gothic" w:hAnsi="MS Gothic"/></w:rPr><w:t>${checked ? '☒' : '☐'}</w:t></w:r></w:sdtContent></w:sdt>`;
}
/**
 * 段落。content 可为字符串或 run 片段数组（字符串或 {text, bold, size, font} 或 {raw: xml}）
 */
function pXml(content, o = {}) {
  const ppr = [];
  if (o.align) ppr.push(`<w:jc w:val="${o.align}"/>`);
  if (o.spacing !== undefined) ppr.push(`<w:spacing w:before="${o.spacing}" w:after="${o.spacing}"/>`);
  const runs = (Array.isArray(content) ? content : [content]).map(c => {
    if (typeof c === 'string') return runXml(c, o);
    if (c.raw) return c.raw;
    return runXml(c.text, Object.assign({}, o, c));
  }).join('');
  return `<w:p>${ppr.length ? `<w:pPr>${ppr.join('')}</w:pPr>` : ''}${runs}</w:p>`;
}
/**
 * 表格。rows: [[cell, ...]]，cell 为字符串 或 {text|content, span, vMerge:'restart'|'continue', bold, align, shade}
 * widths: 各列宽（twips），可选
 */
function tblXml(rows, o = {}) {
  const widths = o.widths || [];
  const grid = widths.length ? `<w:tblGrid>${widths.map(w => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>` : '';
  const border = 'w:val="single" w:sz="4" w:space="0" w:color="000000"';
  const tblPr = `<w:tblPr><w:tblW w:w="${o.width || 9800}" w:type="dxa"/><w:jc w:val="center"/><w:tblBorders><w:top ${border}/><w:left ${border}/><w:bottom ${border}/><w:right ${border}/><w:insideH ${border}/><w:insideV ${border}/></w:tblBorders><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr>`;
  const trs = rows.map(r => {
    let col = 0;
    const tcs = r.map(c => {
      const cell = typeof c === 'string' ? { text: c } : c;
      const span = cell.span || 1;
      let w = 0; for (let k = 0; k < span; k++) w += widths[col + k] || 0; col += span;
      const pr = [];
      if (w) pr.push(`<w:tcW w:w="${w}" w:type="dxa"/>`);
      if (span > 1) pr.push(`<w:gridSpan w:val="${span}"/>`);
      if (cell.vMerge) pr.push(cell.vMerge === 'restart' ? '<w:vMerge w:val="restart"/>' : '<w:vMerge/>');
      if (cell.shade) pr.push(`<w:shd w:val="clear" w:color="auto" w:fill="${cell.shade}"/>`);
      pr.push('<w:vAlign w:val="center"/>');
      const content = cell.content !== undefined ? cell.content : (cell.text ?? '');
      const paras = Array.isArray(content) && content.length && Array.isArray(content[0])
        ? content.map(line => pXml(line, { align: cell.align, bold: cell.bold, size: cell.size || o.size, spacing: 20 }))
        : [pXml(content, { align: cell.align, bold: cell.bold, size: cell.size || o.size, spacing: 20 })];
      return `<w:tc><w:tcPr>${pr.join('')}</w:tcPr>${paras.join('')}</w:tc>`;
    });
    return `<w:tr>${o.rowHeight ? `<w:trPr><w:trHeight w:val="${o.rowHeight}"/></w:trPr>` : ''}${tcs.join('')}</w:tr>`;
  });
  return `<w:tbl>${tblPr}${grid}${trs.join('')}</w:tbl>`;
}
/** bodyXml（若干 w:p / w:tbl 串接）→ docx Buffer */
function buildDocx(bodyXml, o = {}) {
  const font = o.font || '宋体';
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W_NS}><w:body>${bodyXml}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1000" w:right="1000" w:bottom="1000" w:left="1000" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${W_NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${font}" w:eastAsia="${font}" w:hAnsi="${font}" w:cs="${font}"/><w:sz w:val="21"/><w:szCs w:val="21"/><w:lang w:val="zh-CN" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="60" w:line="260" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEscape(o.title || '')}</dc:title><dc:creator>${xmlEscape(o.creator || 'docx-lite')}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
  const app = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>docx-lite</Application></Properties>`;
  return writeZip([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rels },
    { name: 'word/document.xml', data: documentXml },
    { name: 'word/_rels/document.xml.rels', data: docRels },
    { name: 'word/styles.xml', data: stylesXml },
    { name: 'docProps/core.xml', data: core },
    { name: 'docProps/app.xml', data: app },
  ]);
}

module.exports = {
  readZip, writeZip, crc32,
  parseXml, findAll, child, childAttr, xmlEscape, xmlDecode,
  paragraphText, tableRows, extractBlocks, renderBlocks, docxToText, normalizeBoxes, textboxText, SPAN_PLACEHOLDER,
  runXml, symRunXml, checkboxSdtXml, pXml, tblXml, buildDocx,
};
