#!/usr/bin/env node
'use strict';
/**
 * 生成厂内资料样例（可再生）。用法：node scripts/make-sample.js --out <dir> [--seed <n>]
 * 恒定产出（seed 只改厂家、型号等表面数值，不改下列结论）：
 *   - 机泵检修规程 .md（含机械密封原理描述 + 力矩数值，用于验证「有资料时基于资料答并标出处」）
 *   - 设备管理规定 .docx（含本厂规定条款，用于验证「本厂规定类有资料可答」）
 *   - 设备基础知识培训教材 .md（纯原理，不含数值）
 *   - 装配图 .pdf（伪文件，无文字层 → 只定位不读内容，warning 提示「先用平台 pdf 技能转为 txt/docx」）
 *   - 设备台账 .xlsx（表格文件，本技能不作为资料原文）
 * 无论 seed 取值：可检索文字资料恒为 3 份、无文字层文件恒为 1 份、表格文件恒为 1 份。
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
const num = (lo, hi) => Math.round(lo + rnd() * (hi - lo));

const docsDir = path.join(out, 'sample-docs');
fs.mkdirSync(docsDir, { recursive: true });

const maker = pick(['大连耐酸泵厂', '沈阳水泵厂', '重庆水泵厂']);
const model = `${pick(['ZA', 'OH2', 'ZE'])}-100-250`;
const torque = num(40, 60);
const period = pick(['3 个月', '6 个月', '12 个月']);

// ---------------- 1. 检修规程 .md：既有原理描述，也有数值（验证「资料里有数值可以引用原文」）----------------
fs.writeFileSync(path.join(docsDir, 'P-1101A机泵检修规程.md'), [
  '# P-1101A 常压塔顶回流泵检修规程（版本 B/1）',
  '',
  '## 1 机械密封',
  '本泵采用单端面集装式机械密封，依靠动环与静环端面贴合形成密封面，端面间形成液膜实现润滑与密封。',
  `机械密封压盖螺栓紧固力矩 ${torque}N·m，分三次对角均匀上紧。`,
  '密封冲洗方案为 API Plan 11，由泵出口引冲洗液至密封腔。',
  '',
  '## 2 联轴器对中',
  '回装后复测冷态对中，径向偏差不大于 0.05mm，轴向偏差不大于 0.08mm。',
  '',
  '## 3 润滑管理',
  `轴承润滑油更换周期 ${period}，润滑油牌号 L-TSA46。`,
  '',
].join('\n'));

// ---------------- 2. 设备管理规定 .docx：本厂规定条款 ----------------
fs.writeFileSync(path.join(docsDir, '车间设备管理规定.docx'), lite.buildDocx([
  lite.pXml('某某炼化厂一联合车间　设备管理规定（试行）', { bold: true, size: 16, align: 'center' }),
  lite.pXml('第一章　职责分工', { bold: true }),
  lite.pXml('第三条　车间设备员负责本车间设备的日常运行监控、缺陷登记、检修计划编制与资料归档。'),
  lite.pXml('第四条　设备缺陷由发现人登记，设备员当班确认并按 A 级（重大）/ B 级（严重）/ C 级（一般）定级，A 级缺陷须当班上报公司设备管理部门（机动部/设备部）。'),
  lite.pXml('第二章　备件与润滑', { bold: true }),
  lite.pXml(`第七条　我们车间机泵备用件管理实行"一用一备"原则，关键机泵机械密封按台套备用。`),
  lite.pXml(`第八条　本厂机泵润滑油统一采用 ${pick(['L-TSA46', 'L-TSA32'])} 汽轮机油，由车间润滑工按润滑图表执行。`),
  lite.tblXml([
    [{ text: '设备类别', bold: true }, { text: '归口专业', bold: true }, { text: '资料归档要求', bold: true }],
    ['机泵', '动设备', '说明书、检修规程、技术协议各一份'],
    ['换热器', '静设备', '说明书、图纸、定期检验报告'],
  ], { widths: [3000, 3000, 3600] }),
], { title: '车间设备管理规定', creator: 'make-sample' }));

// ---------------- 3. 培训教材 .md：纯原理，刻意不含任何数值 ----------------
fs.writeFileSync(path.join(docsDir, '设备基础知识培训教材.md'), [
  '# 车间设备基础知识培训教材（新员工用）',
  '',
  '## 第一节　离心泵汽蚀',
  '汽蚀是指泵入口处液体压力降低到该温度下的饱和蒸汽压以下时，液体局部汽化产生气泡，气泡随液流进入高压区后急剧溃灭，溃灭瞬间产生的冲击导致叶轮表面材料剥落的现象。',
  '汽蚀发生时泵体会发出连续的噼啪声，伴随振动增大、流量与扬程下降。',
  '防止汽蚀的基本思路是提高装置汽蚀余量或降低泵的必需汽蚀余量，例如抬高吸入液位、减少吸入管阻力、降低输送介质温度。',
  '',
  '## 第二节　机械密封与填料密封的区别',
  '机械密封靠垂直于轴线的动静环端面相互贴合并相对滑动实现密封，泄漏通道短、泄漏量小、功耗低，但结构复杂、对轴的跳动敏感。',
  '填料密封靠填料函内压紧的填料与轴表面接触实现密封，结构简单、便于现场更换，但存在持续微量泄漏、轴套磨损快、功耗较高。',
  '',
  '## 第三节　换热器管束结垢的机理',
  '结垢是介质中的溶解盐类、悬浮颗粒、腐蚀产物或结焦物在换热面上沉积的过程，污垢层热阻增大导致传热系数下降，表现为热端温差拉大、装置换热负荷不足。',
  '',
].join('\n'));

// ---------------- 4. 无文字层文件（伪 PDF）----------------
fs.writeFileSync(path.join(docsDir, 'P-1101A装配图.pdf'),
  Buffer.from('%PDF-1.4\n% 扫描件，无文字层，仅供本技能验证文件定位路径使用\n%%EOF\n', 'utf8'));

// ---------------- 5. 设备台账 xlsx（SAP PM 导出列名；表格文件，本技能不作资料原文）----------------
writeXlsx(path.join(docsDir, '设备台账.xlsx'), {
  '设备台账': [
    ['功能位置', '设备描述', '型号编号', '制造商', '开始日期'],
    ['P-1101A', '常压塔顶回流泵A', model, maker, '2012-06-15'],
    ['E-1201', '原油换热器', 'BES-800-2.5', maker, '2012-06-15'],
  ],
});

console.log(JSON.stringify({
  ok: true, out, seed, docsDir,
  docs: fs.readdirSync(docsDir).sort(),
  constants: { textFiles: 3, noTextLayerFiles: 1, spreadsheetFiles: 1 },
}));
