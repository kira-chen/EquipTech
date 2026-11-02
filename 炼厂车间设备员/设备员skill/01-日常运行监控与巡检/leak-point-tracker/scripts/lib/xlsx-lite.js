'use strict';
/**
 * xlsx-lite —— 零依赖的最小 xlsx 读写模块（仅 Node.js 内置模块）
 *
 * 读取：readXlsx(path) -> { sheetName: string[][] }   （单元格为 string | number | null）
 *   - 解析 zip central directory，zlib.inflateRawSync 解压条目
 *   - 支持共享字符串(t="s")、内联字符串(t="inlineStr")、公式字符串(t="str")、布尔(t="b")、数字
 *   - 读取 styles.xml 的 cellXfs/numFmts：日期格式（numFmtId 14-22/45-47 或自定义格式含 y/m/d/h）的数字单元格
 *     转为 "YYYY-MM-DD"（格式含时/分/秒时为 "YYYY-MM-DD HH:mm"）
 * 写入：writeXlsx(path, { sheetName: any[][] })
 *   - 字符串写为 inlineStr，数字写为 <v>，Date 对象写为日期样式(numFmtId 22)的序列号，zip 用 deflateRaw + 自算 CRC32
 * 另提供 readCsvDir(dir)：读取同结构 CSV 目录（文件名 = sheet 名）
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---------------------------------------------------------------- zip 读取
function readZip(buf) {
  // 从尾部查找 EOCD 签名 0x06054b50
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 zip/xlsx 文件（未找到 EOCD）');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = {};
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('central directory 损坏');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    entries[name] = { method, csize, usize, lho };
    p += 46 + nlen + elen + clen;
  }
  const get = (name) => {
    const e = entries[name];
    if (!e) return null;
    const lh = e.lho;
    if (buf.readUInt32LE(lh) !== 0x04034b50) throw new Error('local header 损坏: ' + name);
    const nlen = buf.readUInt16LE(lh + 26);
    const elen = buf.readUInt16LE(lh + 28);
    const start = lh + 30 + nlen + elen;
    const data = buf.subarray(start, start + e.csize);
    if (e.method === 0) return data;
    if (e.method === 8) return zlib.inflateRawSync(data);
    throw new Error('不支持的压缩方式 ' + e.method + ': ' + name);
  };
  return { names: Object.keys(entries), get };
}

// ---------------------------------------------------------------- XML 工具
function unescapeXml(s) {
  return s.replace(/&(lt|gt|amp|quot|apos|#x[0-9a-fA-F]+|#\d+);/g, (m, c) => {
    switch (c) {
      case 'lt': return '<'; case 'gt': return '>'; case 'amp': return '&';
      case 'quot': return '"'; case 'apos': return "'";
      default: return String.fromCodePoint(c[1] === 'x' ? parseInt(c.slice(2), 16) : parseInt(c.slice(1), 10));
    }
  });
}
function escapeXml(s) {
  return String(s).replace(/[<>&"']/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[ch]));
}
function attr(tag, name) {
  const m = tag.match(new RegExp('(?:^|\\s)' + name + '="([^"]*)"'));
  return m ? unescapeXml(m[1]) : undefined;
}
/** 取一段 xml 内所有 <t> 文本并拼接（处理富文本 <r><t>..</t></r>） */
function textOf(xml) {
  let out = '';
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
  let m;
  while ((m = re.exec(xml))) out += unescapeXml(m[1]);
  return out;
}
function colIndex(ref) {
  let n = 0;
  for (const ch of ref) {
    if (ch < 'A' || ch > 'Z') break;
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1;
}
function colLetter(i) {
  let s = '';
  i += 1;
  while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); }
  return s;
}

// ---------------------------------------------------------------- xlsx 读取
// ---------------------------------------------------------------- 日期样式
const BUILTIN_DATE_FMT = { 14: 'd', 15: 'd', 16: 'd', 17: 'd', 18: 't', 19: 't', 20: 't', 21: 't', 22: 'dt', 45: 't', 46: 't', 47: 't' };
/** 解析 styles.xml，返回 cellXfs 索引 -> 'd' | 'dt' | 't' | null（是否日期/时间格式） */
function parseStyles(xml) {
  const custom = {};
  const nfRe = /<numFmt\b[^>]*\/?>/g;
  let m;
  while ((m = nfRe.exec(xml))) {
    const id = parseInt(attr(m[0], 'numFmtId'), 10);
    const code = (attr(m[0], 'formatCode') || '').replace(/\[[^\]]*\]/g, '').replace(/"[^"]*"/g, '');
    const hasDate = /[ymd]/i.test(code), hasTime = /[hs]/i.test(code) || /m{1,2}(?=:|\s*ss)/i.test(code);
    custom[id] = hasDate && hasTime ? 'dt' : hasDate ? 'd' : hasTime ? 't' : null;
  }
  const xfs = [];
  const cx = xml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/);
  if (cx) {
    const xfRe = /<xf\b[^>]*\/?>/g;
    while ((m = xfRe.exec(cx[1]))) {
      const id = parseInt(attr(m[0], 'numFmtId') || '0', 10);
      xfs.push(BUILTIN_DATE_FMT[id] || custom[id] || null);
    }
  }
  return xfs;
}
const pad2 = (n) => String(n).padStart(2, '0');
/** Excel 序列号（1900 日期系统）-> 文本 */
function serialToText(n, kind) {
  const ms = Math.round((n - 25569) * 86400 * 1000);
  const d = new Date(ms);
  const date = d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  const time = pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes());
  if (kind === 't') return n < 1 ? time : date + ' ' + time;
  if (kind === 'dt') return date + ' ' + time;
  return date;
}

function parseSheet(xml, shared, styles) {
  styles = styles || [];
  const rows = [];
  const rowRe = /<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g;
  let rm;
  while ((rm = rowRe.exec(xml))) {
    const rowTag = rm[0].slice(0, rm[0].indexOf('>') + 1);
    const rIdx = parseInt(attr(rowTag, 'r') || (rows.length + 1), 10) - 1;
    const row = [];
    const body = rm[1] || '';
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm;
    let autoCol = 0;
    while ((cm = cellRe.exec(body))) {
      const a = cm[1], inner = cm[2] || '';
      const ref = attr('<c ' + a + '>', 'r');
      const c = ref ? colIndex(ref) : autoCol;
      autoCol = c + 1;
      const t = attr('<c ' + a + '>', 't');
      let val = null;
      if (t === 'inlineStr') {
        val = textOf(inner);
      } else {
        const vm = inner.match(/<v>([\s\S]*?)<\/v>/);
        if (vm) {
          const raw = unescapeXml(vm[1]);
          if (t === 's') val = shared[parseInt(raw, 10)] ?? '';
          else if (t === 'str') val = raw;
          else if (t === 'b') val = raw === '1';
          else {
            const n = Number(raw);
            val = Number.isFinite(n) ? n : raw;
            const sIdx = attr('<c ' + a + '>', 's');
            const kind = sIdx !== undefined ? styles[parseInt(sIdx, 10)] : null;
            if (kind && typeof val === 'number' && val >= 0 && val < 2958466) val = serialToText(val, kind);
          }
        }
      }
      row[c] = val;
    }
    // 补 null，保证稀疏数组稳定
    for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = null;
    rows[rIdx] = row;
  }
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
  return rows;
}

function readXlsx(file) {
  const zip = readZip(fs.readFileSync(file));
  const shared = [];
  const ssXml = zip.get('xl/sharedStrings.xml');
  if (ssXml) {
    const re = /<si>([\s\S]*?)<\/si>/g;
    let m;
    const s = ssXml.toString('utf8');
    while ((m = re.exec(s))) shared.push(textOf(m[1]));
  }
  const wb = zip.get('xl/workbook.xml');
  if (!wb) throw new Error('缺少 xl/workbook.xml，不是 xlsx 文件');
  const rels = {};
  const relXml = zip.get('xl/_rels/workbook.xml.rels');
  if (relXml) {
    const re = /<Relationship\b[^>]*\/?>/g;
    let m;
    const s = relXml.toString('utf8');
    while ((m = re.exec(s))) {
      const id = attr(m[0], 'Id');
      let target = attr(m[0], 'Target') || '';
      if (target.startsWith('/')) target = target.slice(1); else if (!target.startsWith('xl/')) target = 'xl/' + target;
      rels[id] = target;
    }
  }
  const stylesXml = zip.get('xl/styles.xml');
  const styles = stylesXml ? parseStyles(stylesXml.toString('utf8')) : [];
  const out = {};
  const sheetRe = /<sheet\b[^>]*\/?>/g;
  let m;
  let idx = 0;
  const wbs = wb.toString('utf8');
  while ((m = sheetRe.exec(wbs))) {
    idx++;
    const name = attr(m[0], 'name');
    const rid = attr(m[0], 'r:id') || attr(m[0], 'id');
    let target = rels[rid] || ('xl/worksheets/sheet' + idx + '.xml');
    const xml = zip.get(target);
    out[name] = xml ? parseSheet(xml.toString('utf8'), shared, styles) : [];
  }
  return out;
}

// ---------------------------------------------------------------- CSV 目录读取
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.map((r) => r.map((v) => {
    if (v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) && v.trim() !== '' ? n : v;
  }));
}
/** 解码 CSV：UTF-8 优先；无 BOM 且解码结果含替换符 U+FFFD 时按 GBK 重解 */
function decodeCsv(buf) {
  const hasBom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  let text = buf.toString('utf8');
  if (!hasBom && text.includes('\uFFFD')) {
    try { text = new TextDecoder('gbk').decode(buf); } catch (e) { /* 运行时不支持 gbk 时保留 utf8 结果 */ }
  }
  return text;
}
function readCsvDir(dir) {
  const out = {};
  for (const f of fs.readdirSync(dir)) {
    if (!/\.csv$/i.test(f)) continue;
    out[path.basename(f, path.extname(f))] = parseCsv(decodeCsv(fs.readFileSync(path.join(dir, f))));
  }
  return out;
}

// ---------------------------------------------------------------- zip 写入
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function dosDateTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}
function writeZip(files /* [{name, data:Buffer}] */) {
  const parts = [], central = [];
  let offset = 0;
  const { time, date } = dosDateTime(new Date());
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8');
    const comp = zlib.deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(time, 10); lh.writeUInt16LE(date, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    parts.push(lh, name, comp);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0x0800, 8); cd.writeUInt16LE(8, 10);
    cd.writeUInt16LE(time, 12); cd.writeUInt16LE(date, 14); cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(data.length, 24); cd.writeUInt16LE(name.length, 28);
    cd.writeUInt16LE(0, 30); cd.writeUInt16LE(0, 32); cd.writeUInt16LE(0, 34); cd.writeUInt16LE(0, 36); cd.writeUInt32LE(0, 38); cd.writeUInt32LE(offset, 42);
    central.push(cd, name);
    offset += lh.length + name.length + comp.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(offset, 16); eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...parts, cdBuf, eocd]);
}

// ---------------------------------------------------------------- xlsx 写入
function sheetXml(rows) {
  let body = '';
  rows.forEach((row, r) => {
    let cells = '';
    (row || []).forEach((v, c) => {
      if (v === null || v === undefined || v === '') return;
      const ref = colLetter(c) + (r + 1);
      if (typeof v === 'number' && Number.isFinite(v)) cells += `<c r="${ref}"><v>${v}</v></c>`;
      else if (v instanceof Date) cells += `<c r="${ref}" s="1"><v>${(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate(), v.getHours(), v.getMinutes(), v.getSeconds()) / 86400000 + 25569)}</v></c>`;
      else if (typeof v === 'boolean') cells += `<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`;
      else cells += `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(v)}</t></is></c>`;
    });
    if (cells) body += `<row r="${r + 1}">${cells}</row>`;
  });
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + body + '</sheetData></worksheet>';
}
function writeXlsx(file, sheets /* {name: rows} */) {
  const names = Object.keys(sheets);
  const files = [];
  files.push({
    name: '[Content_Types].xml',
    data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
      '</Types>',
  });
  files.push({
    name: '_rels/.rels',
    data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>',
  });
  files.push({
    name: 'xl/workbook.xml',
    data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      names.map((n, i) => `<sheet name="${escapeXml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
      '</sheets></workbook>',
  });
  files.push({
    name: 'xl/_rels/workbook.xml.rels',
    data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
      `<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      '</Relationships>',
  });
  files.push({
    name: 'xl/styles.xml',
    data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
      '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="22" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '</styleSheet>',
  });
  names.forEach((n, i) => files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(sheets[n]) }));
  fs.writeFileSync(file, writeZip(files));
}

module.exports = { readXlsx, readCsvDir, writeXlsx, crc32, colLetter, colIndex, serialToText, parseStyles };
