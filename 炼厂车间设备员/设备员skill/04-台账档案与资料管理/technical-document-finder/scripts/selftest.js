#!/usr/bin/env node
'use strict';
/** 自测：断言 find.js 行为。用法：node scripts/selftest.js（全绿退出 0） */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { writeXlsx } = require('./lib/xlsx-lite');
const lite = require('./lib/docx-lite');

const F = path.join(__dirname, 'find.js');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tdf-selftest-'));
let pass = 0, fail = 0;
const failures = [];
const ok = (c, n) => { if (c) pass++; else { fail++; failures.push(n); } };
const eq = (a, e, n) => ok(a === e, `${n}（期望 ${JSON.stringify(e)}，实际 ${JSON.stringify(a)}）`);

function run(args, tag) {
  const out = path.join(work, tag + '-out');
  const r = spawnSync(process.execPath, [F, ...args, '--out', out], { encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  let s; try { s = JSON.parse(lines[lines.length - 1]); } catch (e) { s = { ok: false, error: 'no-json:' + r.stdout + r.stderr }; }
  let j = null, md = null;
  if (fs.existsSync(path.join(out, 'matches.json'))) j = JSON.parse(fs.readFileSync(path.join(out, 'matches.json'), 'utf8'));
  if (fs.existsSync(path.join(out, 'matches.md'))) md = fs.readFileSync(path.join(out, 'matches.md'), 'utf8');
  return { code: r.status, s, j, md, out };
}
function raw(args) {
  const x = spawnSync(process.execPath, [F, ...args], { encoding: 'utf8' });
  const l = x.stdout.trim().split('\n');
  try { return { code: x.status, s: JSON.parse(l[l.length - 1]) }; } catch (e) { return { code: x.status, s: { ok: false } }; }
}

// ============ 造资料 ============
const DOCS = path.join(work, 'docs');
fs.mkdirSync(DOCS, { recursive: true });
const wf = (n, t) => { fs.writeFileSync(path.join(DOCS, n), t, 'utf8'); return path.join(DOCS, n); };

// 说明书 docx：安装力矩 45N·m
fs.writeFileSync(path.join(DOCS, 'P-01使用说明书.docx'), lite.buildDocx([
  lite.pXml('P-01 泵使用说明书（版本 A/0）', { bold: true }),
  lite.pXml('机械密封压盖螺栓安装力矩 45N·m，不得超拧。'),
  lite.tblXml([['项目', '数值', '单位'], ['设计压力', '4.0', 'MPa']], { widths: [2000, 2000, 2000] }),
].join('')));
// 检修规程 md：同一力矩写 50N·m → 冲突
wf('P-01检修规程.md', '# P-01 检修规程（版本 B/1）\n\n## 3 机械密封更换\n机械密封压盖螺栓紧固力矩 50N·m。\n');
// 技术协议 txt
wf('P-01技术协议.txt', 'P-01 技术协议\n泵壳水压试验压力 6.0MPa，保压 30 分钟。\n');
// 其他设备资料
wf('E-99换热器说明书.md', '# E-99 换热器说明书\n法兰螺栓紧固力矩 220N·m。\n');
// 无文字层：伪 PDF 与图片
fs.writeFileSync(path.join(DOCS, 'P-01装配图.pdf'), Buffer.from('%PDF-1.4\n%%EOF\n', 'utf8'));
fs.writeFileSync(path.join(DOCS, 'P-01铭牌照片.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
// 内容含位号但文件名不含位号
wf('一区动设备通用维护要点.md', '# 一区动设备维护要点\n\nP-01 泵冷态对中径向偏差不大于 0.05mm。\n');
// 空文件
wf('空白资料.txt', '   \n\n');

const LEDGER = path.join(work, 'led.xlsx');
writeXlsx(LEDGER, { '设备台账': [['位号', '设备名称', '规格型号'], ['P-01', '常压塔顶回流泵A', 'ZA-100-250'], ['E-99', '换热器', 'BES-800']] });

const CATALOG = path.join(DOCS, '资料目录清单.xlsx');
writeXlsx(CATALOG, {
  '资料目录': [
    ['文件名', '资料类型', '关联位号', '版本', '存放位置', '归档日期'],
    ['P-01使用说明书.docx', '说明书', 'P-01', 'A/0', '档案柜1-3', '2012-06-20'],
    ['P-01检修规程.md', '规程', 'P-01', 'B/1', '车间受控文件夹', '2024-05-11'],
    ['P-01装配图.pdf', '图纸', 'P-01', 'A/1', '图纸柜2-4', '2012-06-20'],
    ['P-01水压试验报告.pdf', '检验报告', 'P-01', 'A/0', '档案室3-2-15', '2012-05-30'],
    ['合计', '', '', '', '', ''],
  ],
});

// ============ A. 正常路径：定位 + 原文引用 ============
let r = run(['--docs', DOCS, '--tag', 'P-01', '--query', '机械密封 安装力矩'], 'basic');
eq(r.s.ok, true, 'A1 正常路径成功');
eq(r.code, 0, 'A2 退出码 0');
ok(r.j.counts.documentsRelated >= 5, 'A3 关联到 P-01 的文件 ≥5');
ok(r.j.documents.some((d) => d.file === 'P-01使用说明书.docx'), 'A4 定位到说明书');
ok(r.j.passages.length > 0, 'A5 抽到原文段落');
ok(r.j.passages.every((p) => p.file && p.location), 'A6 每条引用都带文件名与位置');
ok(/出处：/.test(r.md), 'A7 md 中引用标注出处');
ok(/第\d+段/.test(r.md), 'A8 出处精确到段落序号');
ok(r.j.passages.some((p) => /45N·m/.test(p.text)), 'A9 docx 中的技术数值被检出');
ok(/一、相关资料文件/.test(r.md) && /二、原文引用/.test(r.md), 'A10 md 章节用中文序号');
ok(/<!-- ANALYSIS_START -->/.test(r.md) && /<!-- ANALYSIS_END -->/.test(r.md), 'A11 分析段占位符存在');
ok(/引用内容来自所提供资料，资料版本有效性请以受控文件系统为准/.test(r.md), 'A12 保留版本声明行');
ok(/未能解析的文件已列出/.test(r.md), 'A13 声明行含未解析文件提示');
eq(r.j.meta.disclaimer.includes('受控文件系统'), true, 'A14 JSON 中同样带声明');
ok(fs.existsSync(path.join(r.out, 'summary.json')), 'A15 summary.json 落盘');
ok(fs.existsSync(path.join(r.out, 'matches.json')), 'A16 matches.json 落盘');
ok(fs.existsSync(path.join(r.out, 'matches.md')), 'A17 matches.md 落盘');
ok(['documents', 'passages', 'unreadable', 'counts'].every((k) => k in r.j), 'A18 matches.json 含四大块');

// ============ B. 无文字层：只定位不读内容（最关键）============
const pdfDoc = r.j.documents.find((d) => d.file === 'P-01装配图.pdf') || {};
const pngDoc = r.j.documents.find((d) => d.file === 'P-01铭牌照片.png') || {};
ok(!!pdfDoc.file, 'B1 扫描版 PDF 仍被定位为相关文件');
eq(pdfDoc.contentSearchable, false, 'B2 PDF 标记为内容不可检索');
eq(pdfDoc.paragraphs, null, 'B3 PDF 段落数为 null 不是 0');
ok(pngDoc.contentSearchable === false, 'B4 图片同样标记不可检索');
ok(r.j.unreadable.some((u) => u.file === 'P-01装配图.pdf' && /先用平台 pdf 技能转为 txt\/docx/.test(u.reason) && /扫描件需先 OCR/.test(u.reason)), 'B5 PDF 进 unreadable 且写明前置转换（平台 pdf 技能 + OCR）');
ok(r.j.unreadable.some((u) => u.file === 'P-01铭牌照片.png' && /无文字层/.test(u.reason)), 'B6 图片进 unreadable 且写明无文字层');
ok(r.j.unreadable.every((u) => u.contentSearched === false), 'B7 unreadable 明确标记未检索内容');
ok(r.s.warnings.some((w) => /装配图\.pdf/.test(w) && /本脚本不读 PDF/.test(w)), 'B8 PDF 出 warning 说明脚本不读 PDF');
ok(r.s.warnings.some((w) => /铭牌照片\.png/.test(w) && /无文字层/.test(w)), 'B9 图片无文字层出 warning');
ok(/无法检索内容的文件/.test(r.md), 'B10 md 单列无法检索内容的文件一节');
ok(/只做了文件定位，未读取其中任何内容/.test(r.md), 'B11 md 明确声明未读取内容');
ok(/图纸上的尺寸、材质、编号等一律不得据此作答/.test(r.md), 'B12 md 禁止据图纸作答');
ok(r.j.passages.every((p) => !/\.pdf$|\.png$/i.test(p.file)), 'B13 无文字层文件绝不产生原文引用');
ok(/\*\*否（未解析）\*\*/.test(r.md), 'B14 文件清单里加粗标出未解析');
ok(/PDF 请先用平台 pdf 技能转为 txt\/docx（扫描件需 OCR）后重跑/.test(r.md), 'B15 md 无法检索节给出 PDF 前置转换指引');
ok(r.j.meta.pdfNote && /平台 pdf 技能/.test(r.j.meta.pdfNote), 'B16 meta 记录 PDF 前置转换说明');
ok(/经平台 pdf 技能转换的文本属模型读取产生，未经脚本验证，须人工核对原件/.test(r.md), 'B17 声明行含「转换文本由模型读取产生、未经脚本验证」');

// ============ C. 命中为空：不放宽、不补通用知识 ============
r = run(['--docs', DOCS, '--tag', 'P-01', '--query', '汽蚀余量 NPSH'], 'nohit');
eq(r.s.ok, true, 'C1 命中为空仍正常退出');
eq(r.j.counts.passagesTotal, 0, 'C2 命中段落为 0');
ok(/所提供资料中未找到与「汽蚀余量 NPSH」相关的内容/.test(r.md), 'C3 md 明确回答未找到');
ok(/未用通用知识补充/.test(r.md), 'C4 md 声明未用通用知识补充');
ok(/未用其他设备的资料代替/.test(r.md), 'C5 md 声明未用其他设备资料代替');
ok(r.s.warnings.some((w) => /未检索到/.test(w) && /未用通用知识补充/.test(w)), 'C6 warning 同样声明不补知识');

// 设备本身查不到 → 不拿别的设备顶上
r = run(['--docs', DOCS, '--tag', 'P-9999', '--query', '机械密封'], 'notag');
eq(r.s.ok, true, 'C7 设备无资料仍正常退出');
eq(r.j.counts.documentsRelated, 0, 'C8 关联文件为 0');
eq(r.j.counts.passages, 0, 'C9 不产生任何原文引用');
ok(/所提供资料中未找到与「P-9999」关联的文件/.test(r.md), 'C10 md 明确未找到关联文件');
ok(/未放宽关联条件，也未用其他设备的资料代替/.test(r.md), 'C11 md 声明未放宽关联');
ok(r.s.warnings.some((w) => /未用其他设备的资料代替/.test(w)), 'C12 warning 声明未用别的设备资料');
ok(r.j.unrelated.some((d) => d.file === 'E-99换热器说明书.md'), 'C13 其他设备资料进「无法关联」单列');
ok(/不是"查过了没有"，而是"没有可查的资料"/.test(r.md), 'C14 区分「查过没命中」与「没有可查的资料」');
// 有可读资料时不应出现这句区分说明
r = run(['--docs', DOCS, '--tag', 'P-01', '--query', '汽蚀余量 NPSH'], 'nohit2');
ok(!/没有可查的资料/.test(r.md), 'C15 有可读资料时按「查过没命中」表述');

// ============ D. 多处原文不一致：全列不取其一 ============
r = run(['--docs', DOCS, '--tag', 'P-01', '--query', '机械密封'], 'conflict');
eq(r.j.counts.conflicts, 1, 'D1 识别到 1 组取值冲突');
const cf = r.j.conflicts[0] || { unit: null, values: [], note: '' };
eq(cf.unit, 'N·m', 'D2 冲突按同一单位归组');
eq(cf.values.length, 2, 'D3 冲突取值两个都在');
ok(cf.values.some((v) => v.value === '45N·m') && cf.values.some((v) => v.value === '50N·m'), 'D4 45 与 50 全部列出');
ok(cf.values.every((v) => v.sources.every((s) => s.file && s.location)), 'D5 每个取值都带出处');
ok(/未自行取其一/.test(cf.note), 'D6 注明未自行取其一');
ok(/多处原文不一致/.test(r.md), 'D7 md 单列不一致一节');
ok(/45N·m/.test(r.md) && /50N·m/.test(r.md), 'D8 md 两个取值都呈现');
ok(/请核实资料版本后以受控文件为准/.test(r.md), 'D9 md 提示核实版本');
// 同一文件内的不同单位不算冲突
r = run(['--docs', DOCS, '--tag', 'P-01', '--query', '水压试验'], 'noconflict');
eq(r.j.counts.conflicts, 0, 'D10 单一来源不误判为冲突');

// ============ E. 关联判定口径 ============
r = run(['--docs', DOCS, '--tag', 'P-01', '--query', '对中'], 'relate');
const byName = r.j.documents.find((d) => d.file === 'P-01检修规程.md') || {};
ok(/文件名含位号/.test(byName.relatedBy || ''), 'E1 文件名含位号 → 关联');
const byContent = r.j.documents.find((d) => d.file === '一区动设备通用维护要点.md') || {};
ok(!!byContent.file, 'E2 文件名不含位号但内容含位号 → 关联');
ok(/内容中出现位号/.test(byContent.relatedBy || ''), 'E3 关联依据写明来自内容');
ok(/第\d+段/.test(byContent.relatedAt || ''), 'E4 内容关联标出段落位置');
ok(r.j.documents.every((d) => d.relatedBy), 'E5 每份相关文件都有关联依据');
// 位号写法差异
r = run(['--docs', DOCS, '--tag', 'p01'], 'tagnorm');
ok(r.j.counts.documentsRelated >= 5, 'E6 位号大小写与分隔符差异可匹配');
// 台账线索：按设备名称关联
r = run(['--docs', DOCS, '--tag', 'P-01', '--ledger', LEDGER], 'ledger');
eq((r.j.meta.ledgerInfo || {}).name, '常压塔顶回流泵A', 'E7 台账读出设备名称');
r = run(['--docs', DOCS, '--tag', 'P-02', '--ledger', LEDGER], 'ledger-miss');
ok(r.s.warnings.some((w) => /设备台账中未查到位号/.test(w) && /未用近似位号代替/.test(w)), 'E8 台账查不到位号时 warning 且不放宽');

// ============ F. 资料目录清单 ============
r = run(['--docs', DOCS, '--tag', 'P-01', '--query', '机械密封'], 'catalog');
const md0 = r.j.documents.find((d) => d.file === 'P-01使用说明书.docx') || {};
eq(md0.version, 'A/0', 'F1 从资料目录取到版本');
eq(md0.location, '档案柜1-3', 'F2 从资料目录取到存放位置');
ok(/第\d+行/.test(md0.catalogRow || ''), 'F3 记录目录清单行号');
eq(r.j.counts.catalogOnly, 1, 'F4 登记但无实体文件的条目单列');
eq((r.j.catalogOnly[0] || {}).fileName, 'P-01水压试验报告.pdf', 'F5 catalogOnly 条目正确');
ok(/未读到文件内容/.test(r.md), 'F6 md 声明目录登记项未读到内容');
ok(r.s.warnings.some((w) => /未找到实体文件/.test(w)), 'F7 缺实体文件出 warning');
ok(r.s.warnings.some((w) => /合计行/.test(w)), 'F8 目录清单合计行被跳过并 warning');

// ============ G. 空文件与解析失败 ============
ok(r.j.unreadable.some((u) => u.file === '空白资料.txt' && /无文字内容/.test(u.reason)), 'G1 空文件进 unreadable');
ok(r.s.warnings.some((w) => /空白资料\.txt/.test(w)), 'G2 空文件出 warning');
const BADDOCX = path.join(DOCS, 'P-01损坏文件.docx');
fs.writeFileSync(BADDOCX, Buffer.from('这不是一个合法的 docx', 'utf8'));
r = run(['--docs', DOCS, '--tag', 'P-01', '--query', '机械密封'], 'baddocx');
eq(r.s.ok, true, 'G3 单个文件解析失败不中断整体检索');
ok(r.j.unreadable.some((u) => u.file === 'P-01损坏文件.docx' && /解析失败/.test(u.reason)), 'G4 解析失败文件单列');
ok(r.s.warnings.some((w) => /损坏文件\.docx/.test(w) && /解析失败/.test(w)), 'G5 解析失败出 warning');
ok(r.j.passages.every((p) => p.file !== 'P-01损坏文件.docx'), 'G6 解析失败的文件不产生引用');
fs.unlinkSync(BADDOCX);

// ============ H. 资料类型与过滤 ============
r = run(['--docs', DOCS, '--tag', 'P-01', '--doc-type', '规程'], 'doctype');
eq(r.j.counts.documentsRelated, 1, 'H1 --doc-type 过滤后只剩规程');
eq((r.j.documents[0] || {}).file, 'P-01检修规程.md', 'H2 过滤结果正确');
ok(r.j.unrelated.some((d) => d.filteredOut && /doc-type/.test(d.filteredOut)), 'H3 被类型过滤掉的文件注明原因');
r = run(['--docs', DOCS, '--tag', 'P-01'], 'notype');
ok(r.j.documents.some((d) => d.file === 'P-01铭牌照片.png' && d.docType === null), 'H4 类型判不出写 null 不硬归类');
ok(/—（未判定）/.test(r.md), 'H5 md 中类型未判定显示为「—（未判定）」');
ok(/本次未提供有效检索词，仅做资料定位/.test(r.md), 'H6 无 --query 时只定位不抽原文');
eq(r.j.counts.passages, 0, 'H7 无 --query 时不产生引用');

// ============ I. 截断与 --all-matches ============
const MANY = path.join(work, 'many');
fs.mkdirSync(MANY, { recursive: true });
fs.writeFileSync(path.join(MANY, 'P-01大文档.md'),
  Array.from({ length: 40 }, (_, i) => `第 ${i + 1} 条：机械密封检查要点。`).join('\n'), 'utf8');
r = run(['--docs', MANY, '--tag', 'P-01', '--query', '机械密封'], 'trunc');
eq(r.j.counts.passages, 30, 'I1 默认最多返回 30 段');
eq(r.j.counts.passagesTotal, 40, 'I2 总命中数如实记录');
ok(r.s.warnings.some((w) => /仅返回前 30 段/.test(w)), 'I3 截断时 warning');
r = run(['--docs', MANY, '--tag', 'P-01', '--query', '机械密封', '--all-matches'], 'all');
eq(r.j.counts.passages, 40, 'I4 --all-matches 返回全部');

// ============ J. 参数校验 ============
eq(raw([]).s.ok, false, 'J1 无参数报错');
eq(raw(['--docs']).s.ok, false, 'J2 --docs 缺值报错');
ok(/缺少取值/.test(raw(['--docs']).s.error), 'J3 缺值信息正确');
eq(raw(['--docs', DOCS]).s.ok, false, 'J4 缺 --tag 报错');
eq(raw(['--docs', '/不存在的目录', '--tag', 'P-01']).s.ok, false, 'J5 资料路径不存在报错');
eq(raw(['--docs', '/不存在的目录', '--tag', 'P-01']).code, 1, 'J6 退出码 1');
eq(raw(['--docs', DOCS, '--tag', 'P-01', '--ledger', '/不存在.xlsx']).s.ok, false, 'J7 台账不存在报错');
eq(raw(['--docs', DOCS, '--tag', 'P-01', '--doc-type', '随便什么']).s.ok, false, 'J8 非法 --doc-type 报错');
ok(/只能是/.test(raw(['--docs', DOCS, '--tag', 'P-01', '--doc-type', '随便什么']).s.error), 'J9 错误信息列出可用类型');
eq(raw(['--docs', DOCS, '--tag', 'P-01', '--context', 'abc']).s.ok, false, 'J10 非法 --context 报错');
eq(raw(['--docs', DOCS, '--tag', 'P-01', '--未知参数', 'x']).s.ok, false, 'J11 未知参数报错');
eq(raw(['--docs', DOCS, '--tag', ' ']).s.ok, false, 'J12 空白 --tag 报错');
const EMPTY = path.join(work, 'emptydir');
fs.mkdirSync(EMPTY, { recursive: true });
eq(raw(['--docs', EMPTY, '--tag', 'P-01']).s.ok, false, 'J13 资料目录下无文件报错');

// ============ K. 单文件输入与上下文 ============
r = run(['--docs', path.join(DOCS, 'P-01检修规程.md'), '--tag', 'P-01', '--query', '机械密封'], 'single');
eq(r.s.ok, true, 'K1 --docs 可直接指向单个文件');
eq(r.j.counts.filesScanned, 1, 'K2 单文件时只扫 1 个文件');
ok(r.j.passages.length >= 1, 'K3 单文件同样抽出原文');
r = run(['--docs', DOCS, '--tag', 'P-01', '--query', '机械密封', '--context', '5'], 'ctx');
ok(r.j.passages.every((p) => p.text), 'K4 原文字段始终是完整段落（excerpt 另存）');
ok(r.j.passages.some((p) => p.excerpt.length <= p.text.length), 'K5 excerpt 按 --context 截取');
eq(r.j.meta.contextChars, 5, 'K6 meta 记录 context 取值');


// ============ L. 中石化口径：PDF 前置转换产物、.doc/.xls、--max-files、SAP 台账列名 ============
const CONV = path.join(work, 'conv');
fs.mkdirSync(CONV, { recursive: true });
fs.writeFileSync(path.join(CONV, 'P-01水压试验报告.pdf'), Buffer.from('%PDF-1.4\n%%EOF\n', 'utf8'));
fs.writeFileSync(path.join(CONV, 'P-01水压试验报告.pdf.txt'), 'P-01 泵壳水压试验报告\n试验压力 6.0MPa，保压 30 分钟，无渗漏。\n', 'utf8');
fs.writeFileSync(path.join(CONV, 'P-01旧版说明书.doc'), Buffer.from('d0cf11e0a1b11ae1', 'hex'));
fs.writeFileSync(path.join(CONV, '旧目录清单.xls'), Buffer.from('d0cf11e0a1b11ae1', 'hex'));
fs.writeFileSync(path.join(CONV, 'P-01随手记.rtf'), 'x', 'utf8');
writeXlsx(path.join(CONV, '资料目录清单.xlsx'), {
  '资料目录': [
    ['文件名', '资料类型', '功能位置', '版本', '存放位置'],
    ['P-01水压试验报告.pdf', '检验报告', 'P-01', 'A/0', '档案室3-2-15'],
    ['P-01性能曲线.pdf', '说明书', 'P-01', 'A/0', '档案室3-2-16'],
  ],
});
r = run(['--docs', CONV, '--tag', 'P-01', '--query', '试验压力'], 'conv');
eq(r.s.ok, true, 'L1 转换产物目录可检索');
const convDoc = r.j.documents.find((d) => d.file === 'P-01水压试验报告.pdf.txt') || {};
eq(convDoc.convertedFrom, 'P-01水压试验报告.pdf', 'L2 「原名.pdf.txt」识别为该 PDF 的转换文本');
eq(convDoc.contentSearchable, true, 'L3 转换文本可检索');
eq(convDoc.version, 'A/0', 'L4 转换文本沿用目录清单里 PDF 的版本');
ok(r.j.passages.some((p) => /6\.0MPa/.test(p.text) && p.convertedFrom === 'P-01水压试验报告.pdf'), 'L5 转换文本的引用标注来源 PDF');
ok(/PDF 转换文本，须核对原件/.test(r.md), 'L6 md 引用处提示须核对原件');
ok(/【注意】本次有 1 份资料是 PDF 的转换文本/.test(r.md), 'L7 md 顶部【注意】提示转换文本份数');
ok(r.s.warnings.some((w) => /转换文本/.test(w) && /未经脚本验证/.test(w)), 'L8 转换文本 warning 声明未经脚本验证');
eq(r.j.counts.documentsConverted, 1, 'L9 counts 记录转换文本数');
ok(r.j.unreadable.some((u) => u.file === 'P-01水压试验报告.pdf' && /已提供转换文本/.test(u.reason)), 'L10 PDF 原件标注已提供转换文本');
eq(r.j.counts.catalogOnly, 1, 'L11 已提供转换文本的 PDF 不再算「登记但无实体文件」，只剩性能曲线');
eq((r.j.catalogOnly[0] || {}).fileName, 'P-01性能曲线.pdf', 'L12 catalogOnly 条目正确');
ok(r.j.unreadable.some((u) => u.file === 'P-01旧版说明书.doc' && /旧版 Office 二进制格式/.test(u.reason) && /另存为 \.docx/.test(u.reason)), 'L13 .doc 进 unreadable 并提示另存为 .docx');
ok(r.j.unreadable.some((u) => u.file === '旧目录清单.xls' && /另存为 \.xlsx/.test(u.reason)), 'L14 .xls 进 unreadable 并提示另存为 .xlsx');
eq(r.j.counts.oldOfficeFiles, 2, 'L15 counts 记录旧版 Office 文件数');
ok(r.j.passages.every((p) => !/\.doc$/i.test(p.file)), 'L16 .doc 不产生引用');
ok(r.s.warnings.some((w) => /随手记\.rtf/.test(w) && /格式未识别/.test(w)), 'L17 未识别格式出 warning 而非静默跳过');
ok(r.j.documents.some((d) => d.file === 'P-01水压试验报告.pdf.txt' && /资料目录清单标注关联位号|文件名含位号/.test(d.relatedBy)), 'L18 目录清单「功能位置」列可作关联位号');

// --max-files
eq(raw(['--docs', CONV, '--tag', 'P-01', '--max-files', '3']).s.ok, false, 'L19 文件数超过 --max-files 报错');
ok(/超过 --max-files 上限 3/.test(raw(['--docs', CONV, '--tag', 'P-01', '--max-files', '3']).s.error), 'L20 错误信息写明上限与不截断');
eq(raw(['--docs', CONV, '--tag', 'P-01', '--max-files', '0']).s.ok, false, 'L21 --max-files 非正整数报错');
eq(raw(['--docs', CONV, '--tag', 'P-01', '--max-files', 'abc']).s.ok, false, 'L22 --max-files 非数字报错');
r = run(['--docs', CONV, '--tag', 'P-01', '--max-files', '10'], 'maxok');
eq(r.s.ok, true, 'L23 未超上限正常运行');
eq(r.j.meta.maxFiles, 10, 'L24 meta 记录 maxFiles');
eq(r.j.counts.maxFiles, 10, 'L25 counts 记录 maxFiles');

// SAP PM 台账列名：功能位置 / 设备 / 设备描述 / 型号编号；「设备」流水号可命中但不作位号
const SAPLED = path.join(work, 'sapled.xlsx');
writeXlsx(SAPLED, { '技术对象清单': [['功能位置', '设备', '设备描述', '型号编号', '制造商'], ['P-01', '10012345', '常压塔顶回流泵A', 'ZA-100-250', '某泵厂']] });
r = run(['--docs', DOCS, '--tag', 'P-01', '--ledger', SAPLED], 'sapled');
eq((r.j.meta.ledgerInfo || {}).name, '常压塔顶回流泵A', 'L26 SAP「设备描述」读为设备名称');
eq((r.j.meta.ledgerInfo || {}).model, 'ZA-100-250', 'L27 SAP「型号编号」读为规格型号');
eq((r.j.meta.ledgerInfo || {}).matchedBy, '位号', 'L28 按功能位置命中');
eq((r.j.meta.ledgerInfo || {}).equipNo, '10012345', 'L29 SAP「设备」流水号单列为设备编号');
r = run(['--docs', DOCS, '--tag', '10012345', '--ledger', SAPLED], 'sapno');
eq((r.j.meta.ledgerInfo || {}).matchedBy, '设备编号', 'L30 用设备编号查台账时标注按设备编号命中');
eq((r.j.meta.ledgerInfo || {}).tag, 'P-01', 'L31 命中后带出功能位置');
ok(!/[✅⚠️❌]/.test(r.md), 'L32 md 不含 emoji');

// ============ M. A/B 同名设备：台账名称/型号不唯一时不作关联线索（防串台）============
const AB = path.join(work, 'ab');
fs.mkdirSync(AB, { recursive: true });
const wab = (n, t) => fs.writeFileSync(path.join(AB, n), t, 'utf8');
wab('P-21A技术协议.txt', 'P-21A 进料泵技术协议\n型号 ZA-80-200，泵壳水压试验压力 3.75MPa。\n');
wab('P-21A检修规程.md', '# P-21A 进料泵检修规程\n机械密封压盖螺栓紧固力矩 40N·m。\n');
wab('P-21A_P-21B进料泵使用说明书.md', '# P-21A/P-21B 进料泵使用说明书\n型号 ZA-80-200。\n');
wab('机泵通用检修规程.md', '# 机泵通用检修规程\n适用范围：P-21A、P-21B 及同类离心泵。\n');
wab('设备档案卡.txt', '设备档案卡\n设备编号 10002102，投用日期 2016-01-10。\n');
wab('原料换热器维护要点.md', '# 原料换热器维护要点\n管束清洗后做水压试验。\n');
fs.writeFileSync(path.join(AB, '出厂合格证扫描件.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
// 资料目录清单为 CSV（带 BOM，文件名不含「目录/清单」字样）
fs.writeFileSync(path.join(AB, '设备资料登记.csv'), '﻿文件名,资料类型,关联位号,版本,存放位置\n'
  + '出厂合格证扫描件.png,检验报告,P-21B,A/0,档案室1-1\nP-21B性能曲线.pdf,说明书,P-21B,A/0,档案室1-2\n', 'utf8');
const ABLED = path.join(work, 'abled.xlsx');
writeXlsx(ABLED, { '设备台账': [['位号', '设备编号', '设备名称', '规格型号'],
  ['P-21A', '10002101', '进料泵', 'ZA-80-200'], ['P-21B', '10002102', '进料泵', 'ZA-80-200'], ['E-31', '10003101', '原料换热器', 'BES-600']] });
r = run(['--docs', AB, '--tag', 'P-21B', '--ledger', ABLED], 'ab-b');
const abFiles = (r.j && r.j.documents || []).map((d) => d.file);
eq(r.s.ok, true, 'M1 A/B 同名场景正常运行');
ok(!abFiles.includes('P-21A技术协议.txt'), 'M2 查 P-21B 不带出 P-21A 技术协议（同名「进料泵」不作线索）');
ok(!abFiles.includes('P-21A检修规程.md'), 'M3 查 P-21B 不带出 P-21A 检修规程');
ok(abFiles.includes('P-21A_P-21B进料泵使用说明书.md') && abFiles.includes('机泵通用检修规程.md'), 'M4 A/B 共用说明书与通用规程仍按位号关联');
ok((r.j.documents || []).every((d) => !/设备名称|规格型号/.test(d.relatedBy || '')), 'M5 不唯一的设备名称、规格型号都不出现在关联依据中');
ok(r.s.warnings.some((w) => /设备名称「进料泵」/.test(w) && /不唯一/.test(w) && /P-21A/.test(w) && /不作关联线索/.test(w)), 'M6 设备名称不唯一出 warning 并写明同名位号');
ok(r.s.warnings.some((w) => /规格型号「ZA-80-200」/.test(w) && /不唯一/.test(w)), 'M7 规格型号不唯一同样出 warning');
const dropped = ((r.j.meta.ledgerInfo || {}).droppedClues || []);
ok(dropped.some((x) => x.kind === '设备名称' && x.value === '进料泵' && x.sharedWith.includes('P-21A')), 'M8 ledgerInfo.droppedClues 记录被弃用的设备名称线索');
r = run(['--docs', AB, '--tag', 'P-21A', '--ledger', ABLED], 'ab-a');
ok(['P-21A技术协议.txt', 'P-21A检修规程.md'].every((f) => r.j.documents.some((d) => d.file === f && /位号/.test(d.relatedBy))), 'M9 查 P-21A 时专属资料仍按位号关联');
r = run(['--docs', AB, '--tag', 'E-31', '--ledger', ABLED], 'ab-e');
ok(r.j.documents.some((d) => d.file === '原料换热器维护要点.md' && d.relatedBy === '文件名含设备名称（台账）'), 'M10 台账中唯一的设备名称仍作关联线索');
eq(((r.j.meta.ledgerInfo || {}).droppedClues || []).length, 0, 'M11 名称唯一时 droppedClues 为空');

// ============ N. 用设备编号查：台账命中后改用位号关联，同时保留编号 ============
r = run(['--docs', AB, '--tag', '10002102', '--ledger', ABLED], 'ab-no');
eq((r.j.meta.ledgerInfo || {}).matchedBy, '设备编号', 'N1 按设备编号命中台账');
const nDoc = (f) => r.j.documents.find((d) => d.file === f) || {};
eq(nDoc('P-21A_P-21B进料泵使用说明书.md').relatedBy, '文件名含位号', 'N2 文件名含台账位号的资料关联上');
eq(nDoc('P-21A_P-21B进料泵使用说明书.md').relatedClue, 'P-21B', 'N3 关联线索为台账位号 P-21B');
eq(nDoc('机泵通用检修规程.md').relatedBy, '内容中出现位号', 'N4 内容含台账位号的资料关联上');
eq(nDoc('机泵通用检修规程.md').relatedClue, 'P-21B', 'N4b 内容关联同样记下线索（relatedClue）');
eq(nDoc('设备档案卡.txt').relatedBy, '内容中出现设备编号', 'N5 内容含设备编号的资料仍关联（保留编号线索）');
eq(nDoc('出厂合格证扫描件.png').relatedBy, '资料目录清单标注关联位号', 'N6 目录清单关联位号按台账位号比对');
ok(!r.j.documents.some((d) => /^P-21A(?!_P-21B)/.test(d.file)), 'N7 用编号查 P-21B 也不带出 P-21A 专属资料');
ok(/台账位号 P-21B/.test(r.md), 'N8 md 标明设备编号对应的台账位号');
eq(r.j.meta.tag, '10002102', 'N9 meta.tag 保留原始输入');

// ============ O. 资料目录清单为 CSV ============
r = run(['--docs', AB, '--tag', 'P-21B'], 'ab-csv');
ok(!r.s.warnings.some((w) => /设备资料登记\.csv/.test(w) && /无法读取/.test(w)), 'O1 CSV 目录清单不再当 xlsx 打开失败');
eq(r.j.counts.catalogFiles, 1, 'O2 CSV 计入目录清单数');
const csvDoc = r.j.documents.find((d) => d.file === '出厂合格证扫描件.png') || {};
eq(csvDoc.relatedBy, '资料目录清单标注关联位号', 'O3 CSV 的关联位号可作关联依据');
eq(csvDoc.version, 'A/0', 'O4 从 CSV 取到版本');
eq(csvDoc.location, '档案室1-1', 'O5 从 CSV 取到存放位置');
eq(csvDoc.catalogRow, '设备资料登记.csv 第2行', 'O6 记录 CSV 文件名与行号');
eq(csvDoc.docType, '检验报告', 'O7 资料类型取自 CSV');
ok(r.j.catalogOnly.some((e) => e.fileName === 'P-21B性能曲线.pdf' && e.catalog === '设备资料登记.csv'), 'O8 CSV 登记但无实体文件的条目进 catalogOnly');
const BADCSV = path.join(AB, '杂项.csv');
fs.writeFileSync(BADCSV, '序号,备注\n1,无关内容\n', 'utf8');
r = run(['--docs', AB, '--tag', 'P-21B'], 'ab-badcsv');
eq(r.s.ok, true, 'O9 缺「文件名」列的 CSV 不中断检索');
ok(r.s.warnings.some((w) => /缺少列: 文件名/.test(w)), 'O10 缺「文件名」列出 warning');
fs.unlinkSync(BADCSV);
// 同目录另有读不了的「.csv」（如名为 xxx.csv 的文件夹）时，不牵连正常的 CSV 目录清单
const ODDCSV = path.join(AB, '旧资料.csv');
fs.mkdirSync(ODDCSV);
r = run(['--docs', AB, '--tag', 'P-21B'], 'ab-oddcsv');
ok(!r.s.warnings.some((w) => /设备资料登记\.csv/.test(w) && /无法读取/.test(w)), 'O11 同目录有读不了的 .csv 时，正常的 CSV 目录清单照常读取');
eq(r.j.counts.catalogFiles, 1, 'O12 CSV 目录清单仍计 1 份');
fs.rmdirSync(ODDCSV);

console.log(`\n${'='.repeat(56)}`);
console.log(`technical-document-finder 自测：${pass} 通过，${fail} 失败`);
if (failures.length) { console.log('\n失败项：'); failures.forEach((f) => console.log('  ✗ ' + f)); }
console.log('='.repeat(56));
try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
