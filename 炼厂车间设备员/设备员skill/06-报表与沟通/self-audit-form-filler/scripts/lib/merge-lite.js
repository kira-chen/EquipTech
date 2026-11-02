'use strict';
/**
 * merge-lite.js —— 读取 xlsx 的合并单元格区域（仅 Node.js 内置模块）
 *
 * lib/xlsx-lite.js 的 readXlsx 只返回单元格值矩阵，丢掉了 <mergeCells>。
 * 自查表里合并单元格非常常见（检查大类跨多行、填写栏跨多列），**合并情况直接影响
 * 能不能安全填写**，所以必须单独读出来：合并多时脚本要提示「先请用户确认解析结果」。
 *
 * 不改动 xlsx-lite.js（规范要求 lib/common.js、lib/xlsx-lite.js 保持原样直接 require），
 * 本文件独立解析同一个 zip，只取 mergeCells 一段。
 */
const fs = require('fs');
const zlib = require('zlib');

function readZipEntries(buf) {
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
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    entries[buf.toString('utf8', p + 46, p + 46 + nlen)] = { method, csize, lho };
    p += 46 + nlen + elen + clen;
  }
  return {
    names: Object.keys(entries),
    get(name) {
      const e = entries[name];
      if (!e) return null;
      const nlen = buf.readUInt16LE(e.lho + 26);
      const elen = buf.readUInt16LE(e.lho + 28);
      const start = e.lho + 30 + nlen + elen;
      const data = buf.subarray(start, start + e.csize);
      if (e.method === 0) return data;
      if (e.method === 8) return zlib.inflateRawSync(data);
      throw new Error('不支持的压缩方式 ' + e.method + ': ' + name);
    },
  };
}

function attr(tag, name) {
  const m = tag.match(new RegExp('(?:^|\\s)' + name + '="([^"]*)"'));
  return m ? m[1] : undefined;
}
function colIndex(ref) {
  let n = 0;
  for (const ch of ref) { if (ch < 'A' || ch > 'Z') break; n = n * 26 + (ch.charCodeAt(0) - 64); }
  return n - 1;
}
/** "B3:D5" → {r1,c1,r2,c2}（0 基），无法解析返回 null */
function parseRange(ref) {
  const m = String(ref).match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
  if (!m) return null;
  return { c1: colIndex(m[1]), r1: +m[2] - 1, c2: colIndex(m[3]), r2: +m[4] - 1, ref: String(ref) };
}

/**
 * readMerges(file) → { sheetName: [{r1,c1,r2,c2,ref}] }
 * 读取失败（非 xlsx、结构异常）时返回 {}，由调用方决定是否 warning——
 * 合并信息读不到不是致命错误，但**不得据此假定「没有合并单元格」**，调用方需区分这两种情况。
 */
function readMerges(file) {
  const zip = readZipEntries(fs.readFileSync(file));
  const wb = zip.get('xl/workbook.xml');
  if (!wb) throw new Error('缺少 xl/workbook.xml，不是 xlsx 文件');
  const rels = {};
  const relXml = zip.get('xl/_rels/workbook.xml.rels');
  if (relXml) {
    const s = relXml.toString('utf8');
    const re = /<Relationship\b[^>]*\/?>/g;
    let m;
    while ((m = re.exec(s))) {
      const id = attr(m[0], 'Id');
      let target = attr(m[0], 'Target') || '';
      if (target.startsWith('/')) target = target.slice(1);
      else if (!target.startsWith('xl/')) target = 'xl/' + target;
      rels[id] = target;
    }
  }
  const out = {};
  const wbs = wb.toString('utf8');
  const sheetRe = /<sheet\b[^>]*\/?>/g;
  let m, idx = 0;
  while ((m = sheetRe.exec(wbs))) {
    idx++;
    const nameRaw = attr(m[0], 'name') || `Sheet${idx}`;
    const name = nameRaw.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
    const rid = attr(m[0], 'r:id') || attr(m[0], 'id');
    const target = rels[rid] || `xl/worksheets/sheet${idx}.xml`;
    const xml = zip.get(target);
    const list = [];
    if (xml) {
      const s = xml.toString('utf8');
      const mc = s.match(/<mergeCells\b[^>]*>([\s\S]*?)<\/mergeCells>/);
      if (mc) {
        const cRe = /<mergeCell\b[^>]*\/?>/g;
        let cm;
        while ((cm = cRe.exec(mc[1]))) {
          const r = parseRange(attr(cm[0], 'ref') || '');
          if (r) list.push(r);
        }
      }
    }
    out[name] = list;
  }
  return out;
}

/** 某单元格(0 基 r,c)是否落在某合并区内；返回该区或 null */
function mergeAt(merges, r, c) {
  for (const m of merges) if (r >= m.r1 && r <= m.r2 && c >= m.c1 && c <= m.c2) return m;
  return null;
}
/** 某单元格是否是合并区的「从属格」（非左上角） */
function isMergedFollower(merges, r, c) {
  const m = mergeAt(merges, r, c);
  return !!m && !(m.r1 === r && m.c1 === c);
}

module.exports = { readMerges, mergeAt, isMergedFollower, parseRange, colIndex };
