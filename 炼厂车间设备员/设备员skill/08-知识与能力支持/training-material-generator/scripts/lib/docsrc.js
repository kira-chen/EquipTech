'use strict';
/**
 * 资料读取与条款抽取
 * 支持 .md / .txt（按行）与 .docx（经 docx-lite 抽取段落与表格）
 *
 * **每一条抽出来的条款都带出处（文件名 + 位置 + 条款号），
 * 没有出处的内容不得进入数值类考题。**
 */
const fs = require('fs');
const path = require('path');

/** 读一个资料文件 → [{text, loc}]，loc 形如「第12行」「第3段」「表1第2行」 */
function readDocFile(p, warnings) {
  const ext = path.extname(p).toLowerCase();
  const base = path.basename(p);
  const out = [];
  if (ext === '.md' || ext === '.txt' || ext === '.csv') {
    const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      const t = line.trim();
      if (t) out.push({ text: t, loc: `第${i + 1}行` });
    });
    return out;
  }
  if (ext === '.docx') {
    let D;
    try { D = require('./docx-lite'); } catch (e) {
      warnings.push(`资料「${base}」为 docx，但 docx-lite 不可用，已跳过`);
      return out;
    }
    let blocks;
    try { blocks = D.extractBlocks(fs.readFileSync(p)); } catch (e) {
      warnings.push(`资料「${base}」无法解析（${e.message}），已跳过`);
      return out;
    }
    let pi = 0, ti = 0;
    for (const b of blocks) {
      if (b.kind === 'paragraph') {
        pi++;
        const t = String(b.text || '').trim();
        if (t) out.push({ text: t, loc: `第${pi}段` });
      } else if (b.kind === 'table') {
        ti++;
        (b.rows || []).forEach((row, ri) => {
          const t = row.map((c) => String(c || '').trim()).filter(Boolean).join(' ');
          if (t) out.push({ text: t, loc: `表${ti}第${ri + 1}行` });
        });
      }
    }
    return out;
  }
  warnings.push(`资料「${base}」扩展名「${ext || '无'}」不支持（支持 .md/.txt/.docx），已跳过`);
  return out;
}

/** 展开资料路径：文件直接返回；目录返回其中受支持的文件（不递归子目录） */
function expandDocPaths(spec, warnings) {
  const files = [];
  for (const raw of String(spec).split(',').map((x) => x.trim()).filter(Boolean)) {
    if (!fs.existsSync(raw)) throw new Error(`资料路径不存在: ${raw}`);
    if (fs.statSync(raw).isDirectory()) {
      const inner = fs.readdirSync(raw)
        .filter((f) => /\.(md|txt|docx|csv)$/i.test(f) && !f.startsWith('~$'))
        .map((f) => path.join(raw, f)).sort();
      if (!inner.length) warnings.push(`资料目录「${raw}」中没有受支持的文件（.md/.txt/.docx）`);
      files.push(...inner);
    } else {
      files.push(raw);
    }
  }
  return files;
}

/** 条款号识别：「4.2.1」「第4.2条」「4.2 xxx」 */
const CLAUSE_RE = /^(?:第\s*)?(\d+(?:\.\d+){0,3})\s*(?:条)?[、.．\s]/;

/**
 * 抽取条款。返回 {clauses, files}
 * clause = {id, text, source:{file, loc, clause}, numeric:boolean, topicHint}
 */
function extractClauses(paths, warnings) {
  const clauses = [];
  const files = [];
  const { hasNumericValue } = require('./tm');
  let seq = 0;
  let heading = null;
  for (const p of paths) {
    const base = path.basename(p);
    const items = readDocFile(p, warnings);
    if (!items.length) { files.push({ file: base, path: p, lines: 0 }); continue; }
    files.push({ file: base, path: p, lines: items.length });
    heading = null;
    for (const it of items) {
      const raw = it.text;
      // markdown 标题作为主题线索，不单独成条款
      const h = raw.match(/^#{1,6}\s*(.+)$/);
      if (h) { heading = h[1].trim(); continue; }
      // 表格分隔行、引用块（说明与免责声明，不是条款）、代码围栏跳过
      if (/^\|?\s*:?-{2,}/.test(raw)) continue;
      if (/^>/.test(raw)) continue;
      if (/^```/.test(raw)) continue;
      const text = raw.replace(/^[|\s]+|[|\s]+$/g, '').replace(/\s*\|\s*/g, ' ');
      if (text.length < 4) continue;
      const m = text.match(CLAUSE_RE);
      seq++;
      clauses.push({
        id: `C${String(seq).padStart(3, '0')}`,
        text,
        topicHint: heading,
        numeric: hasNumericValue(text),
        source: { file: base, loc: it.loc, clause: m ? m[1] : null },
      });
    }
  }
  return { clauses, files };
}

/** 出处的显示写法：「《泵类设备管理规定》第4.2条（文件名，第12行）」 */
function citeOf(src) {
  if (!src) return null;
  const c = src.clause ? `第${src.clause}条` : '';
  return `${src.file}${c ? ' ' + c : ''}（${src.loc}）`;
}

module.exports = { readDocFile, expandDocPaths, extractClauses, citeOf, CLAUSE_RE };
