#!/usr/bin/env node
/**
 * docx2text —— 把 Word 作业票（.docx）转成结构化文本，供抽取 permit.json 使用
 * 用法：node scripts/docx2text.js --input <docx> [--out <txt>] [--json <blocks.json>]
 *  - 仅用 Node.js ≥18 内置模块（fs/path/zlib），无需 npm
 *  - 段落按顺序输出；表格逐个输出，每行以 | 分隔单元格
 *  - 合并单元格：横向合并（gridSpan）被合并列输出占位「‹›」（区别于票面留白的空串）；纵向合并（vMerge）续行用「〃」
 *  - 复选框：☑/☐/√/■/□、Wingdings 符号、w14:checkbox 内容控件、传统窗体域 → 统一 [x] / [ ]；✘✗ → [×]（含义需人工判断）
 *  - 删除线文本 → ~~…~~；文本框内容 → 【文本框】…；页眉/页脚追加为「### 页眉/页脚」块
 *  - 末行打印 JSON 摘要 {"paragraphs","tables","checked","unchecked","crossed","textboxes","header_footer","out"}
 */
'use strict';
const fs = require('fs');
const path = require('path');
const lite = require('./lib/docx-lite');

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { const k = argv[i].slice(2); a[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; }
  }
  return a;
}

/** 出错约定：末行 stdout 输出 {"ok":false,"error":"…"} 并退出码 1（与 work-permit-precheck 的同名脚本不同，那份用 stderr 文本，见 scripts/README.md） */
function fail(msg) { console.log(JSON.stringify({ ok: false, error: msg })); process.exit(1); }

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.error('用法: node scripts/docx2text.js --input <docx> [--out <txt>] [--json <blocks.json>]');
    process.exit(0);
  }
  if (!args.input || args.input === true) fail('缺少 --input 参数。用法: node scripts/docx2text.js --input <docx> [--out <txt>] [--json <blocks.json>]');
  const input = path.resolve(args.input);
  if (!fs.existsSync(input)) fail(`文件不存在: ${input}`);
  let res;
  try { res = lite.docxToText(fs.readFileSync(input)); }
  catch (e) { fail(`解析失败: ${e.message}`); return; }

  const header = `# docx2text 输出\n来源：${path.basename(input)}\n说明：[x]=已勾选 [ ]=未勾选 [×]=叉选（可能表示选中也可能表示否定，含义需人工判断）；表格行以 | 分隔；「〃」表示与上一行纵向合并；「‹›」为横向合并单元格的占位（不是留白）；空单元格才是票面留白；~~文字~~ 为删除线文本；【文本框】为文本框内容；页眉/页脚在末尾单列\n\n`;
  const text = header + res.text;
  if (args.out) { fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true }); fs.writeFileSync(args.out, text); }
  else process.stdout.write(text + '\n');
  if (args.json) fs.writeFileSync(args.json, JSON.stringify(res.blocks, null, 2));
  console.log(JSON.stringify(Object.assign({}, res.summary, { out: args.out ? path.resolve(args.out) : null })));
}

if (require.main === module) main();
module.exports = { docxToText: lite.docxToText };
