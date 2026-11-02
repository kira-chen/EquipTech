#!/usr/bin/env node
'use strict';
/**
 * 生成技术资料样例（可再生）。用法：node scripts/make-sample.js --out <dir> [--seed <n>]
 * 恒定产出（seed 只改厂家/型号等表面数值，不改这些结论）：
 *   - P-1101A 说明书 .docx（含机械密封安装力矩 45N·m）
 *   - P-1101A 检修规程 .md（同一力矩写成 50N·m → 制造版本冲突）
 *   - P-1101A 技术协议 .txt
 *   - E-1201 说明书 .md（其他设备资料，用于验证"不拿别的设备顶上"）
 *   - P-1101A 装配图 .pdf（伪文件，脚本不读 PDF → 只做文件定位，提示先用平台 pdf 技能转换）
 *   - P-1101A 水压试验报告 .pdf（伪文件）+ 同名 .pdf.txt（模拟平台 pdf 技能转换产物 → 可检索，标注须核对原件）
 *   - P-1101A 旧版说明书 .doc（伪文件，旧版 Office 格式 → 只做文件定位，提示另存为 .docx）
 *   - P-1101A 铭牌照片 .png（伪文件，无文字层）
 *   - 资料目录清单 .xlsx（含一条已登记但无实体文件的条目：性能曲线）
 *   - 设备台账 .xlsx（SAP PM 技术对象清单列名：功能位置 / 设备 / 设备描述 / 型号编号 / 制造商，供 --ledger 用）
 */
const fs = require('fs');
const path = require('path');
const { writeXlsx } = require('./lib/xlsx-lite');
const lite = require('./lib/docx-lite');
const C = require('./lib/common');

const a = C.parseArgs(process.argv.slice(2), ['out', 'seed'], []);
const out = a.out || path.join(__dirname, '..', 'examples');
const seed = a.seed ? Number(a.seed) : 1;
if (!Number.isFinite(seed)) { console.log(JSON.stringify({ ok: false, error: `--seed 「${a.seed}」不是数字` })); process.exit(1); }
let s = seed * 7919 + 13;
const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (arr) => arr[Math.floor(rnd() * arr.length) % arr.length];

const docsDir = path.join(out, 'sample-docs');
fs.mkdirSync(docsDir, { recursive: true });

const MAKERS = ['大连耐酸泵厂', '沈阳水泵厂', '重庆水泵厂'];
const maker = pick(MAKERS);
const model = `${pick(['ZA', 'OH2', 'ZE'])}-100-250`;

// ---------------- 1. 说明书（真实 .docx，含结构化表格）----------------
const body = [
  lite.pXml('P-1101A 常压塔顶回流泵　使用说明书', { bold: true, size: 16, align: 'center' }),
  lite.pXml(`制造厂：${maker}　　型号：${model}　　版本：A/0`),
  lite.pXml('一、主要技术参数', { bold: true }),
  lite.tblXml([
    [{ text: '项目', bold: true }, { text: '数值', bold: true }, { text: '单位', bold: true }],
    ['额定流量', '100', 'm3/h'],
    ['额定扬程', '250', 'm'],
    ['设计压力', '4.0', 'MPa'],
    ['轴承型号', '6310', '—'],
  ], { widths: [3200, 3200, 3200] }),
  lite.pXml('二、机械密封安装要求', { bold: true }),
  lite.pXml('机械密封压盖螺栓应对角均匀紧固，安装力矩 45N·m，不得超拧。'),
  lite.pXml('机械密封端面比压按 0.35MPa 控制，冲洗方案为 API Plan 11。'),
  lite.pXml('三、联轴器对中要求', { bold: true }),
  lite.pXml('冷态对中径向偏差不大于 0.05mm，轴向偏差不大于 0.08mm。'),
  lite.pXml('四、轴承润滑', { bold: true }),
  lite.pXml('轴承采用 L-TSA46 汽轮机油润滑，油位保持在油位计中线，运行温度不超过 75℃。'),
].join('');
fs.writeFileSync(path.join(docsDir, 'P-1101A常压塔顶回流泵使用说明书.docx'),
  lite.buildDocx(body, { title: 'P-1101A 使用说明书', creator: 'make-sample' }));

// ---------------- 2. 检修规程 .md（力矩与说明书不一致：50N·m）----------------
fs.writeFileSync(path.join(docsDir, 'P-1101A检修规程.md'), [
  '# P-1101A 常压塔顶回流泵检修规程（版本 B/1）',
  '',
  '## 1 适用范围',
  '本规程适用于 P-1101A 常压塔顶回流泵的解体检修与回装。',
  '',
  '## 2 解体前准备',
  '确认泵已停运、电机已挂牌断电，进出口阀关闭并加盲板，泵内介质已排空、置换合格。',
  '',
  '## 3 机械密封更换',
  '机械密封压盖螺栓紧固力矩 50N·m，分三次对角均匀上紧。',
  '更换密封时应同时检查轴套磨损量，超过 0.10mm 予以更换。',
  '',
  '## 4 联轴器对中',
  '回装后复测冷态对中，径向偏差不大于 0.05mm。',
  '',
  '## 5 试运',
  '试运 2 小时，轴承温度不超过 75℃，振动速度有效值不超过 4.5mm/s。',
  '',
].join('\n'));

// ---------------- 3. 技术协议 .txt ----------------
fs.writeFileSync(path.join(docsDir, 'P-1101A技术协议.txt'), [
  'P-1101A 常压塔顶回流泵 技术协议（版本 A/0）',
  '',
  `买方：某某炼化厂　卖方：${maker}`,
  '',
  '一、设备参数',
  `型号：${model}`,
  '介质：常压塔顶汽油，介质温度 95℃',
  '设计压力：4.0MPa',
  '泵壳水压试验压力：6.0MPa，保压 30 分钟不渗不漏。',
  '',
  '二、材质要求',
  '泵壳材质 ZG1Cr18Ni9Ti，叶轮材质 2Cr13，轴材质 40Cr。',
  '',
  '三、随机文件',
  '供方随机提供：使用说明书、装配图、材质证明书、水压试验报告各一份。',
  '',
].join('\n'));

// ---------------- 4. 其他设备资料（E-1201），验证不拿别的设备顶上 ----------------
fs.writeFileSync(path.join(docsDir, 'E-1201原油换热器使用说明书.md'), [
  '# E-1201 原油换热器使用说明书（版本 A/0）',
  '',
  '## 1 主要参数',
  '型式 BES-800-2.5，换热面积 260m2，设计压力 2.5MPa，设计温度 350℃。',
  '',
  '## 2 检修要求',
  '管束抽芯清洗后应做管程水压试验，试验压力 3.2MPa，保压 30 分钟。',
  '法兰螺栓紧固力矩 220N·m。',
  '',
].join('\n'));

// ---------------- 5. 无文字层文件（伪 PDF 与图片）----------------
// 伪 PDF：只有文件头，脚本一律不解析 PDF 内容，用于验证"无文字层"路径
fs.writeFileSync(path.join(docsDir, 'P-1101A装配图.pdf'),
  Buffer.from('%PDF-1.4\n% 扫描件，无文字层，仅供本技能验证文件定位路径使用\n%%EOF\n', 'utf8'));
fs.writeFileSync(path.join(docsDir, 'P-1101A铭牌照片.png'),
  Buffer.from('89504e470d0a1a0a', 'hex'));
// 水压试验报告：PDF 原件（伪）+ 平台 pdf 技能转换产物（原名.pdf.txt），验证"前置转换"路径
fs.writeFileSync(path.join(docsDir, 'P-1101A水压试验报告.pdf'),
  Buffer.from('%PDF-1.4\n% 伪文件，脚本不读 PDF，内容以同名 .pdf.txt 转换文本为准\n%%EOF\n', 'utf8'));
fs.writeFileSync(path.join(docsDir, 'P-1101A水压试验报告.pdf.txt'), [
  'P-1101A 常压塔顶回流泵 泵壳水压试验报告（版本 A/0）',
  `制造厂：${maker}　试验日期：2012-05-28`,
  '试验压力：6.0MPa，保压 30 分钟，泵壳及各连接处无渗漏、无可见变形。',
  '结论：合格。',
  '',
].join('\n'));
// 旧版 Office 二进制格式（伪）：脚本不解析，提示另存为 .docx
fs.writeFileSync(path.join(docsDir, 'P-1101A旧版说明书.doc'), Buffer.from('d0cf11e0a1b11ae1', 'hex'));

// ---------------- 6. 资料目录清单 xlsx（同时放一份到资料目录内，便于 --docs 指向目录时一并读到）----------------
const CATALOG_BOOK = {
  '资料目录': [
    ['文件名', '资料类型', '关联位号', '版本', '存放位置', '归档日期'],
    ['P-1101A常压塔顶回流泵使用说明书.docx', '说明书', 'P-1101A', 'A/0', '设备室档案柜1-3', '2012-06-20'],
    ['P-1101A检修规程.md', '规程', 'P-1101A', 'B/1', '车间受控文件夹', '2024-05-11'],
    ['P-1101A技术协议.txt', '技术协议', 'P-1101A', 'A/0', '设备室档案柜1-3', '2012-03-08'],
    ['P-1101A装配图.pdf', '图纸', 'P-1101A', 'A/1', '图纸柜2-4', '2012-06-20'],
    ['P-1101A铭牌照片.png', '', 'P-1101A', '', '设备室档案柜1-3', '2021-09-01'],
    ['P-1101A水压试验报告.pdf', '检验报告', 'P-1101A', 'A/0', '档案室3-2-15', '2012-05-30'],
    ['P-1101A性能曲线.pdf', '说明书', 'P-1101A', 'A/0', '档案室3-2-16', '2012-05-30'],
    ['P-1101A旧版说明书.doc', '说明书', 'P-1101A', 'A/0', '设备室档案柜1-3', '2012-06-20'],
    ['E-1201原油换热器使用说明书.md', '说明书', 'E-1201', 'A/0', '设备室档案柜2-1', '2012-06-20'],
    ['合计', '', '', '', '', ''],
  ],
};
writeXlsx(path.join(out, 'sample-doc-catalog.xlsx'), CATALOG_BOOK);
writeXlsx(path.join(docsDir, '资料目录清单.xlsx'), CATALOG_BOOK);

// ---------------- 7. 设备台账 xlsx（供 --ledger，SAP PM 技术对象清单列名）----------------
const eq8 = (i) => String(10001000 + seed * 17 + i);
writeXlsx(path.join(out, 'sample-equipment-ledger.xlsx'), {
  '技术对象清单': [
    ['功能位置', '设备', '设备描述', '型号编号', '制造商', '开始日期', '对象类型'],
    ['P-1101A', eq8(1), '常压塔顶回流泵A', model, maker, '2012-06-15', '离心泵'],
    ['E-1201', eq8(2), '原油换热器', 'BES-800-2.5', pick(MAKERS), '2012-06-15', '换热器'],
    ['V-1301', eq8(3), '原油缓冲罐', 'φ3000×8000', pick(MAKERS), '2012-06-15', '压力容器'],
  ],
});

console.log(JSON.stringify({
  ok: true, out, seed,
  docsDir,
  docs: fs.readdirSync(docsDir).sort(),
  xlsx: fs.readdirSync(out).filter((f) => f.endsWith('.xlsx')).sort(),
}));
