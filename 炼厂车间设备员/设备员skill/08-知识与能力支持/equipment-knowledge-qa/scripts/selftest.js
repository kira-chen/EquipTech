#!/usr/bin/env node
'use strict';
/** 自测：断言 qa.js 与 lib/rules.js 行为。用法：node scripts/selftest.js（全绿退出 0） */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { writeXlsx } = require('./lib/xlsx-lite');
const lite = require('./lib/docx-lite');
const R = require('./lib/rules');

const F = path.join(__dirname, 'qa.js');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ekqa-selftest-'));
let pass = 0, fail = 0;
const failures = [];
const ok = (c, n) => { if (c) pass++; else { fail++; failures.push(n); } };
const eq = (a, e, n) => ok(a === e, `${n}（期望 ${JSON.stringify(e)}，实际 ${JSON.stringify(a)}）`);

let seq = 0;
function run(args, tag) {
  const out = path.join(work, `${tag || 'r'}-${++seq}-out`);
  const r = spawnSync(process.execPath, [F, ...args, '--out', out], { encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  let s; try { s = JSON.parse(lines[lines.length - 1]); } catch (e) { s = { ok: false, error: 'no-json:' + r.stdout + r.stderr }; }
  let j = null, md = null;
  if (fs.existsSync(path.join(out, 'qa.json'))) j = JSON.parse(fs.readFileSync(path.join(out, 'qa.json'), 'utf8'));
  if (fs.existsSync(path.join(out, 'qa.md'))) md = fs.readFileSync(path.join(out, 'qa.md'), 'utf8');
  return { code: r.status, s, j, md, out };
}
function raw(args) {
  const x = spawnSync(process.execPath, [F, ...args], { encoding: 'utf8' });
  const l = x.stdout.trim().split('\n');
  try { return { code: x.status, s: JSON.parse(l[l.length - 1]) }; } catch (e) { return { code: x.status, s: { ok: false } }; }
}

// ============ 造厂内资料 ============
const DOCS = path.join(work, 'docs');
fs.mkdirSync(DOCS, { recursive: true });
const wf = (n, t) => { fs.writeFileSync(path.join(DOCS, n), t, 'utf8'); return path.join(DOCS, n); };

wf('P-01机泵检修规程.md', [
  '# P-01 检修规程（版本 B/1）',
  '本泵采用单端面集装式机械密封，动静环端面贴合形成密封面。',
  '机械密封压盖螺栓紧固力矩 50N·m，分三次对角均匀上紧。',
  '轴承润滑油更换周期 6 个月。',
].join('\n'));
fs.writeFileSync(path.join(DOCS, '车间设备管理规定.docx'), lite.buildDocx([
  lite.pXml('一联合车间设备管理规定', { bold: true }),
  lite.pXml('第三条　我们车间机泵备用件实行一用一备原则，关键机泵机械密封按台套备用。'),
  lite.pXml('第八条　本厂机泵润滑油统一采用 L-TSA46 汽轮机油。'),
].join('')));
wf('培训教材.md', [
  '# 培训教材',
  '汽蚀是指泵入口压力降到饱和蒸汽压以下时液体局部汽化、气泡溃灭剥蚀叶轮的现象。',
  '填料密封靠填料与轴接触实现密封，结构简单但有微量泄漏。',
].join('\n'));
fs.writeFileSync(path.join(DOCS, 'P-01装配图.pdf'), Buffer.from('%PDF-1.4\n%%EOF\n', 'utf8'));
writeXlsx(path.join(DOCS, '设备台账.xlsx'), { '设备台账': [['位号', '设备名称'], ['P-01', '回流泵A']] });
wf('空白资料.txt', '   \n\n');

// ============ A. 数值标准类拦截（本技能最关键，15+ 个问法逐一验证）============
const NUMERIC_QUESTIONS = [
  '机械密封压盖螺栓上多大力矩',
  '联轴器对中径向偏差不能超过多少',
  '泵轴承温度限值是多少',
  '这个间隙应该是多大',
  '轴承多久换一次油',
  '安全阀校验周期是多久',
  '泵壳水压试验压力是多少 MPa',
  '振动报警值定在多少',
  '机械密封的允许泄漏量上限是多少',
  '换热器管束最小壁厚要求多少',
  '润滑油加注量是多少',
  '电机绝缘电阻多少算合格',
  '叶轮口环配合公差取多少',
  '联锁整定值应该设多少',
  '我测出来振动 6.5mm/s 算超标吗',
  '螺栓预紧力要多大',
  '检修周期一般几个月',
  '标准里规定的数值是多少',
];
let numericAllHit = true, numericAllNotice = true, numericAllBlocked = true, numericNoGeneral = true, numericWhere = true;
for (const q of NUMERIC_QUESTIONS) {
  const r = run(['--question', q], 'num');
  if (r.s.questionType !== 'numeric') { numericAllHit = false; failures.push(`  ↳ 未识别为 numeric 的问法：「${q}」→ ${r.s.questionType}`); }
  if (!/该数值须以厂内规程\/设备说明书为准，本技能不提供记忆中的数值/.test(r.md || '')) numericAllNotice = false;
  if (!(r.j && r.j.classification.blockedFromAnswer === true)) numericAllBlocked = false;
  if (r.j && r.j.guidance.answerBasis !== 'none') numericNoGeneral = false;
  if (!(r.j && r.j.guidance.whereToLook.length >= 1)) numericWhere = false;
}
ok(numericAllHit, `A1 ${NUMERIC_QUESTIONS.length} 个数值类问法全部识别为 numeric`);
ok(numericAllNotice, 'A2 每个数值类问题 md 中都写明「不提供记忆中的数值」');
ok(numericAllBlocked, 'A3 每个数值类问题 blockedFromAnswer=true');
ok(numericNoGeneral, 'A4 无资料时数值类 answerBasis 一律为 none（不退回通用原理给数）');
ok(numericWhere, 'A5 每个数值类问题都给出「该去哪查」的指路');
eq(NUMERIC_QUESTIONS.length >= 15, true, 'A6 数值类问法样本 ≥15 条');

let r = run(['--question', '机械密封压盖螺栓上多大力矩'], 'numone');
eq(r.s.ok, true, 'A7 数值类问题正常退出');
eq(r.code, 0, 'A8 退出码 0');
eq(r.j.questionType, 'numeric', 'A9 qa.json 顶层 questionType 为 numeric');
eq(r.j.classification.notice, R.NOTICE.numeric, 'A10 classification.notice 为固定拦截语');
eq(r.s.notice, R.NOTICE.numeric, 'A11 末行摘要同样带拦截语');
eq(r.j.guidance.canAnswer, false, 'A12 无资料时数值类不可作答');
eq(r.j.guidance.generalPrincipleAllowed, false, 'A13 数值类不允许用通用原理作答');
ok(/本问题属数值标准类，已拦截/.test(r.md), 'A14 md 明写已拦截');
ok(/只指路，不给数/.test(r.md), 'A15 md 声明只指路不给数');
ok(r.j.guidance.mustNotSay.some((x) => /行业惯例给出数值/.test(x)), 'A16 禁止凭行业惯例给数值');
ok(r.j.guidance.mustNotSay.some((x) => /国标|API/.test(x)), 'A17 禁止把标准条文当本厂执行值');
ok(r.j.guidance.whereToLook.some((w) => /力矩/.test(w.kind)), 'A18 力矩问题指向紧固力矩类文件');
ok(r.j.guidance.whereToLook.every((w) => !/\d+\s*(N·m|MPa|mm|℃)/.test(w.where)), 'A19 指路文本中不含任何数值');
// 「二、厂内资料原文」到「五、必须说明的话」之间是作答内容区，无资料时其中不得出现任何数值
// （第五节的 mustNotSay 里有「一般取 40~50N·m」这样的**反例**，那是禁止句式示范，不算给数）
const answerZone = r.md.slice(r.md.indexOf('## 二、厂内资料原文'), r.md.indexOf('## 五、必须说明的话'));
ok(!/\d+\s*(N·m|MPa|mm|℃|%|r\/min)/.test(answerZone), 'A20 无资料时作答内容区不出现任何数值');
ok(/一般取 40~50N·m/.test(r.md), 'A20b 禁止句式以反例形式给出（提醒模型不要这么说）');
ok(r.j.guidance.nextSkills.some((x) => x.skill === 'technical-document-finder'), 'A21 提示接 technical-document-finder');

// 数值类优先级高于原理类：混合问句仍按 numeric
r = run(['--question', '机械密封是什么原理，压盖螺栓力矩应该是多大'], 'mixed');
eq(r.j.questionType, 'numeric', 'A22 原理+数值混合问句按 numeric 处理');
eq(r.j.classification.mixedPrinciple, true, 'A23 标记 mixedPrinciple');
ok(r.j.guidance.generalPrincipleAllowed, 'A24 混合问句允许解释原理部分');
ok(r.j.guidance.mustSay.some((x) => /数值部分仍不作答/.test(x)), 'A25 混合问句声明数值部分仍不作答');
ok(/通用原理，非本厂规定/.test(r.md), 'A26 md 要求原理部分标注非本厂规定');

// 数值类优先级高于本厂类
r = run(['--question', '我们厂规定轴承温度不能超过多少'], 'numplant');
eq(r.j.questionType, 'numeric', 'A27 本厂+数值混合问句按 numeric 处理');
ok(r.j.classification.matched.plant.length > 0, 'A28 本厂规则同样记录在 matched 中可追溯');

// 有资料时数值类：引用原文，但仍带拦截声明
r = run(['--question', '机械密封压盖螺栓紧固力矩是多少', '--docs', DOCS], 'numdoc');
eq(r.j.questionType, 'numeric', 'A29 有资料时仍判为 numeric');
eq(r.j.guidance.canAnswer, true, 'A30 有资料原文时可基于资料回答');
eq(r.j.guidance.answerBasis, 'plant-docs', 'A31 作答依据为厂内资料原文');
ok(r.j.passages.some((p) => /50N·m/.test(p.text)), 'A32 资料中的数值以原文形式给出');
ok(r.j.passages.every((p) => p.file && p.location), 'A33 每条原文都带文件与段落出处');
ok(/该数值须以厂内规程\/设备说明书为准/.test(r.md), 'A34 有资料时同样保留拦截声明');
ok(r.j.guidance.mustSay.some((x) => /核实资料版本是否现行有效/.test(x)), 'A35 提示核实资料版本');

// ============ B. 本厂规定类：无资料明确说无法回答 ============
const PLANT_QUESTIONS = [
  '我们厂机泵备用件是怎么规定的',
  '咱们车间润滑油用什么牌号的规定',
  '本厂设备缺陷定级归谁审批',
  '这台泵用什么型号',
  'P-1101A 的制造厂是哪家',
  '厂里现行做法是什么',
];
let plantAllHit = true, plantAllBlocked = true;
for (const q of PLANT_QUESTIONS) {
  const x = run(['--question', q], 'plant');
  if (x.s.questionType !== 'plant') { plantAllHit = false; failures.push(`  ↳ 未识别为 plant 的问法：「${q}」→ ${x.s.questionType}`); }
  if (x.j && (x.j.guidance.generalPrincipleAllowed !== false || x.j.guidance.canAnswer !== false)) plantAllBlocked = false;
}
ok(plantAllHit, `B1 ${PLANT_QUESTIONS.length} 个本厂类问法全部识别为 plant`);
ok(plantAllBlocked, 'B2 无资料时本厂类一律不可作答且不允许通用原理');

r = run(['--question', '我们厂机泵备用件是怎么规定的'], 'plantnodoc');
eq(r.j.questionType, 'plant', 'B3 本厂规定类识别正确');
eq(r.j.guidance.canAnswer, false, 'B4 无资料时明确不可作答');
eq(r.j.guidance.answerBasis, 'none', 'B5 无资料时作答依据为 none');
eq(r.j.guidance.generalPrincipleAllowed, false, 'B6 本厂类不得用通用原理搪塞');
ok(r.j.guidance.mustSay.some((x) => /未提供厂内资料，本技能无法回答本厂是怎么规定的/.test(x)), 'B7 必须说明无法回答');
ok(r.j.guidance.mustSay.some((x) => /未用通用原理代替本厂规定作答/.test(x)), 'B8 声明未用通用原理代替');
ok(r.j.guidance.mustNotSay.some((x) => /用通用原理、行业惯例或其他厂的做法回答/.test(x)), 'B9 禁止用通用原理回答本厂规定');
ok(r.j.guidance.mustNotSay.some((x) => /一般来说厂里都是/.test(x)), 'B10 禁止把通用做法说成本厂规定');
ok(/不可用通用原理作答本问题/.test(r.md), 'B11 md 明写不可用通用原理');
ok(/不得用通用原理搪塞/.test(r.md), 'B12 md 出现「不得用通用原理搪塞」');
eq(r.j.classification.requiresPlantDocs, true, 'B13 标记必须有厂内资料');

// 提供了资料但没命中 → 仍明确无法回答
r = run(['--question', '我们厂备品备件仓库怎么盘点的规定', '--docs', DOCS], 'plantmiss');
eq(r.j.questionType, 'plant', 'B14 有资料时仍判为 plant');
eq(r.j.counts.passages, 0, 'B15 资料中未命中');
eq(r.j.guidance.canAnswer, false, 'B16 资料未覆盖时不可作答');
ok(r.j.guidance.mustSay.some((x) => /所提供资料中未涉及该问题/.test(x)), 'B17 明确说明资料中未涉及');
ok(r.j.guidance.generalPrincipleAllowed === false, 'B18 资料未覆盖也不放行通用原理');
ok(/所提供资料中未涉及该问题/.test(r.md), 'B19 md 写明资料未涉及');
ok(/未用通用知识补充到本节，也未用其他设备的资料代替/.test(r.md), 'B20 md 声明未用通用知识补充');
ok(r.s.warnings.some((x) => /未检索到/.test(x) && /未用通用知识补充/.test(x)), 'B21 warning 同样声明不补知识');

// 有资料且命中 → 可答，基于资料并标出处
r = run(['--question', '我们厂机泵备用件的规定', '--docs', DOCS], 'planthit');
eq(r.j.guidance.canAnswer, true, 'B22 资料命中时可作答');
eq(r.j.guidance.answerBasis, 'plant-docs', 'B23 作答依据为厂内资料');
eq(r.j.guidance.plantRuleAnswerable, true, 'B24 plantRuleAnswerable 为 true');
ok(r.j.passages.some((p) => /一用一备/.test(p.text)), 'B25 从 docx 中抽到本厂规定原文');
ok(r.j.sources.length >= 1 && r.j.sources[0].file, 'B26 sources 带来源文件');
ok(/出处：/.test(r.md), 'B27 md 中原文带出处');
ok(/第\d+段/.test(r.md), 'B28 出处精确到段落序号');

// ============ C. 原理概念类 ============
const PRINCIPLE_QUESTIONS = [
  '什么是汽蚀',
  '为什么会发生汽蚀',
  '机械密封是怎么工作的',
  '机械密封和填料密封有什么区别',
  '离心泵由哪些部件组成',
  '平衡盘起什么作用',
  '怎么判断泵发生了汽蚀',
  '怎么防止换热器结垢',
  'NPSH 是什么意思',
];
let princAllHit = true;
for (const q of PRINCIPLE_QUESTIONS) {
  const x = run(['--question', q], 'princ');
  if (x.s.questionType !== 'principle') { princAllHit = false; failures.push(`  ↳ 未识别为 principle 的问法：「${q}」→ ${x.s.questionType}`); }
}
ok(princAllHit, `C1 ${PRINCIPLE_QUESTIONS.length} 个原理类问法全部识别为 principle`);

r = run(['--question', '什么是汽蚀'], 'princone');
eq(r.j.questionType, 'principle', 'C2 原理概念类识别正确');
eq(r.j.guidance.canAnswer, true, 'C3 原理类可作答');
eq(r.j.guidance.answerBasis, 'general-principle', 'C4 无资料时依据为通用原理');
eq(r.j.guidance.generalPrincipleAllowed, true, 'C5 允许通用原理');
eq(r.j.classification.notice, R.NOTICE.principle, 'C6 带「通用原理，非本厂规定」标注');
ok(/以下为通用原理说明，\*\*非本厂规定\*\*/.test(r.md), 'C7 md 中要求整段标注非本厂规定');
ok(/不得出现任何具体数值、限值、周期/.test(r.md), 'C8 md 禁止原理段夹带数值');
ok(r.j.guidance.mustNotSay.some((x) => /夹带具体数值/.test(x)), 'C9 禁止原理解释里夹带数值');
ok(r.j.guidance.mustNotSay.some((x) => /把通用原理写成本厂规定/.test(x)), 'C10 禁止把通用原理写成本厂规定');
ok(r.j.guidance.nextSkills.some((x) => x.skill === 'anomaly-triage-advisor'), 'C11 提示可接 anomaly-triage-advisor');

// 有资料且命中 → 优先基于资料
r = run(['--question', '汽蚀是怎么产生的', '--docs', DOCS], 'princdoc');
eq(r.j.questionType, 'principle', 'C12 有资料时仍是原理类');
eq(r.j.guidance.answerBasis, 'plant-docs', 'C13 有资料命中时优先基于资料');
ok(r.j.passages.some((p) => /汽蚀/.test(p.text)), 'C14 抽到培训教材原文');
ok(r.j.guidance.mustSay.some((x) => /优先照录所提供厂内资料原文并标注出处/.test(x)), 'C15 要求优先照录资料原文');
ok(r.j.guidance.mustSay.some((x) => /资料未覆盖的部分再按通用原理补充/.test(x)), 'C16 资料未覆盖处才用通用原理');

// 有资料但未命中 → 明确说明后再用通用原理
r = run(['--question', '什么是水锤', '--docs', DOCS], 'princmiss');
eq(r.j.counts.passages, 0, 'C17 资料未命中');
eq(r.j.guidance.answerBasis, 'general-principle', 'C18 资料未命中时退回通用原理');
ok(r.j.guidance.mustSay.some((x) => /所提供资料中未涉及该问题，以下为通用原理说明，非本厂规定/.test(x)), 'C19 先说明资料未涉及再用通用原理');

// ============ D. 通用原理与厂内规定分节标注 ============
r = run(['--question', '我们厂机泵备用件的规定', '--docs', DOCS], 'section');
ok(/## 二、厂内资料原文/.test(r.md), 'D1 md 单列「厂内资料原文」一节');
ok(/## 三、通用原理适用性/.test(r.md), 'D2 md 单列「通用原理适用性」一节');
ok(r.md.indexOf('## 二、厂内资料原文') < r.md.indexOf('## 三、通用原理适用性'), 'D3 资料原文节在通用原理节之前');
ok(r.j.passages.every((p) => p.sourceKind === '厂内资料原文'), 'D4 passages 逐条标注来源性质');
r = run(['--question', '什么是汽蚀'], 'section2');
ok(/\*\*未提供厂内资料，本节无内容。\*\*/.test(r.md), 'D5 无资料时资料节明写无内容');
ok(/本节只放厂内资料原文。未提供资料时不以通用原理填充本节/.test(r.md), 'D6 声明不用通用原理填充资料节');
ok(/## 一、问题分类/.test(r.md) && /## 四、数值类处理/.test(r.md) && /## 五、必须说明的话/.test(r.md), 'D7 md 章节用中文序号且齐全');
ok(/## 六、无法检索内容的文件/.test(r.md) && /## 七、回答组织/.test(r.md), 'D8 md 六七节齐全');
ok(/<!-- ANALYSIS_START -->/.test(r.md) && /<!-- ANALYSIS_END -->/.test(r.md), 'D9 分析段占位符存在');
ok(/本回答区分「厂内资料原文」与「通用原理」两类内容/.test(r.md), 'D10 保留声明行');
ok(/本技能不提供记忆中的数值/.test(r.j.meta.disclaimer), 'D11 JSON 中同样带声明行');
ok(fs.existsSync(path.join(r.out, 'summary.json')), 'D12 summary.json 落盘');
ok(fs.existsSync(path.join(r.out, 'qa.json')), 'D13 qa.json 落盘');
ok(fs.existsSync(path.join(r.out, 'qa.md')), 'D14 qa.md 落盘');
ok(['questionType', 'classification', 'passages', 'sources', 'guidance', 'counts'].every((k) => k in r.j), 'D15 qa.json 含六大块');

// 非数值类同样带数值边界提醒
ok(/本问题不属数值标准类。若回答过程中出现具体数值/.test(r.md), 'D16 非数值类也带数值边界提醒');

// ============ E. 未判定：不按任一类默认 ============
r = run(['--question', '帮我看看这个'], 'undet');
eq(r.s.ok, true, 'E1 未判定问题仍正常退出');
eq(r.j.questionType, 'undetermined', 'E2 三组规则均未命中 → undetermined');
eq(r.j.classification.ruleId, 'U1', 'E3 未判定规则号为 U1');
eq(r.j.guidance.canAnswer, false, 'E4 未判定时不作答');
eq(r.j.guidance.generalPrincipleAllowed, false, 'E5 未判定时不默认按原理类放行');
ok(/未按任一类默认处理/.test(r.j.classification.notice), 'E6 notice 声明未按任一类默认');
ok(/本问题未能归入三类中的任一类，未按任一类默认处理/.test(r.md), 'E7 md 单列未判定说明');
ok(r.j.guidance.mustNotSay.some((x) => /默认按原理概念类给出通用解释/.test(x)), 'E8 禁止默认按原理类作答');
ok(r.j.guidance.mustNotSay.some((x) => /猜测用户意图后直接作答/.test(x)), 'E9 禁止猜意图作答');

// ============ F. 资料解析边界 ============
r = run(['--question', '机械密封原理', '--docs', DOCS], 'docs');
eq(r.s.ok, true, 'F1 提供资料时正常退出');
eq(r.j.counts.filesScanned, 6, 'F2 扫描到全部 6 个文件');
eq(r.j.counts.documentsContentSearchable, 3, 'F3 可检索文字资料 3 份');
ok(r.j.unreadable.some((u) => u.file === 'P-01装配图.pdf' && /无文字层/.test(u.reason)), 'F4 PDF 进 unreadable 且写明无文字层');
ok(r.j.documents.some((d) => d.file === 'P-01装配图.pdf' && d.contentSearchable === false && d.paragraphs === null), 'F5 PDF 段落数为 null 不是 0');
ok(r.j.passages.every((p) => !/\.pdf$/i.test(p.file)), 'F6 无文字层文件绝不产生原文引用');
ok(r.j.unreadable.some((u) => u.file === '设备台账.xlsx' && /表格文件/.test(u.reason)), 'F7 表格文件不作为资料原文');
ok(r.s.warnings.some((x) => /设备台账\.xlsx/.test(x) && /technical-document-finder/.test(x)), 'F8 表格文件 warning 指向资料检索技能');
ok(r.j.unreadable.some((u) => u.file === '空白资料.txt' && /无文字内容/.test(u.reason)), 'F9 空文件进 unreadable');
ok(r.j.unreadable.every((u) => u.contentSearched === false), 'F10 unreadable 明确标记未检索内容');
ok(/只做了文件定位，未读取其中任何内容/.test(r.md), 'F11 md 声明未读取无文字层内容');

// 损坏 docx 不中断
const BAD = path.join(DOCS, '损坏文件.docx');
fs.writeFileSync(BAD, Buffer.from('这不是一个合法的 docx', 'utf8'));
r = run(['--question', '机械密封原理', '--docs', DOCS], 'bad');
eq(r.s.ok, true, 'F12 单个文件解析失败不中断');
ok(r.j.unreadable.some((u) => u.file === '损坏文件.docx' && /解析失败/.test(u.reason)), 'F13 解析失败文件单列');
ok(r.s.warnings.some((x) => /损坏文件\.docx/.test(x) && /解析失败/.test(x)), 'F14 解析失败出 warning');
ok(r.j.passages.every((p) => p.file !== '损坏文件.docx'), 'F15 解析失败文件不产生引用');
fs.unlinkSync(BAD);

// 单文件输入
r = run(['--question', '机械密封原理', '--docs', path.join(DOCS, 'P-01机泵检修规程.md')], 'single');
eq(r.s.ok, true, 'F16 --docs 可指向单个文件');
eq(r.j.counts.filesScanned, 1, 'F17 单文件时只扫 1 个文件');
ok(r.j.passages.length >= 1, 'F18 单文件同样抽出原文');

// 无有效检索词
r = run(['--question', '为什么'], 'nokw');
eq(r.s.ok, true, 'F19 无有效检索词仍正常退出');
eq(r.j.meta.keywords.length, 0, 'F19b 疑问词被剥净后无有效检索词');
ok(r.s.warnings.some((x) => /没有长度 ≥2 的有效检索词/.test(x)), 'F20 无检索词出 warning');

// 截断
const MANY = path.join(work, 'many');
fs.mkdirSync(MANY, { recursive: true });
fs.writeFileSync(path.join(MANY, '大文档.md'), Array.from({ length: 30 }, (_, i) => `第 ${i + 1} 条：机械密封检查要点。`).join('\n'), 'utf8');
r = run(['--question', '机械密封是什么原理', '--docs', MANY], 'trunc');
eq(r.j.counts.passages, 20, 'F21 默认最多返回 20 段');
eq(r.j.counts.passagesTotal, 30, 'F22 总命中数如实记录');
ok(r.s.warnings.some((x) => /仅返回前 20 段/.test(x)), 'F23 截断时 warning');
r = run(['--question', '机械密封是什么原理', '--docs', MANY, '--all-matches'], 'all');
eq(r.j.counts.passages, 30, 'F24 --all-matches 返回全部');

// 资料全无文字层
const NOTXT = path.join(work, 'notxt');
fs.mkdirSync(NOTXT, { recursive: true });
fs.writeFileSync(path.join(NOTXT, '图纸.pdf'), Buffer.from('%PDF-1.4\n%%EOF\n', 'utf8'));
r = run(['--question', '我们厂这台设备的规定', '--docs', NOTXT], 'notxt');
eq(r.j.counts.documentsContentSearchable, 0, 'F25 全无文字层时可检索份数为 0');
ok(r.s.warnings.some((x) => /没有可检索文字内容的文件/.test(x)), 'F26 全无文字层出 warning');
ok(r.j.guidance.mustSay.some((x) => /均无可检索的文字内容/.test(x)), 'F27 本厂类在此情形下仍明确无法回答');
eq(r.j.guidance.canAnswer, false, 'F28 全无文字层时不可作答');

// ============ G. 参数校验 ============
eq(raw([]).s.ok, false, 'G1 无参数报错');
eq(raw(['--question']).s.ok, false, 'G2 --question 缺值报错');
ok(/缺少取值/.test(raw(['--question']).s.error), 'G3 缺值信息正确');
eq(raw(['--question', ' ']).s.ok, false, 'G4 空白 --question 报错');
eq(raw(['--docs', DOCS]).s.ok, false, 'G5 缺 --question 报错');
eq(raw(['--question', '什么是汽蚀', '--docs', '/不存在的目录']).s.ok, false, 'G6 资料路径不存在报错');
eq(raw(['--question', '什么是汽蚀', '--docs', '/不存在的目录']).code, 1, 'G7 退出码 1');
eq(raw(['--question', '什么是汽蚀', '--equip-type', '随便什么']).s.ok, false, 'G8 非法 --equip-type 报错');
ok(/只能是/.test(raw(['--question', '什么是汽蚀', '--equip-type', '随便什么']).s.error), 'G9 错误信息列出可用类型');
eq(raw(['--question', '什么是汽蚀', '--context', 'abc']).s.ok, false, 'G10 非法 --context 报错');
eq(raw(['--question', '什么是汽蚀', '--未知参数', 'x']).s.ok, false, 'G11 未知参数报错');
const EMPTY = path.join(work, 'emptydir');
fs.mkdirSync(EMPTY, { recursive: true });
eq(raw(['--question', '什么是汽蚀', '--docs', EMPTY]).s.ok, false, 'G12 资料目录下无文件报错');
r = run(['--question', '什么是汽蚀', '--equip-type', '泵'], 'equip');
eq(r.j.meta.equipType, '泵', 'G13 合法 --equip-type 写入 meta');
r = run(['--question', '机械密封原理', '--docs', DOCS, '--context', '5'], 'ctx');
eq(r.j.meta.contextChars, 5, 'G14 meta 记录 context 取值');
ok(r.j.passages.every((p) => p.text && p.excerpt.length <= p.text.length), 'G15 excerpt 按 context 截取，text 保持完整段落');

// ============ H. rules.js 直接单测 ============
eq(R.classify('间隙应该是多大').questionType, 'numeric', 'H1 rules 直接判定 numeric');
eq(R.classify('我们厂怎么规定的').questionType, 'plant', 'H2 rules 直接判定 plant');
eq(R.classify('机械密封工作原理').questionType, 'principle', 'H3 rules 直接判定 principle');
eq(R.classify('').questionType, 'undetermined', 'H4 空问题 → undetermined');
eq(R.classify('').ruleId, 'U0', 'H5 空问题规则号 U0');
ok(R.classify('力矩多少').matched.numeric.length >= 1, 'H6 matched 记录命中的数值规则');
ok(R.whereToLook('试压压力多少').some((w) => /试压/.test(w.kind)), 'H7 whereToLook 按问题给出对应文件类别');
ok(R.whereToLook('随便问点什么值')[0].ruleId === 'W0', 'H8 指路判不出时给通用兜底');
ok(R.whereToLook('力矩多少').every((w) => !/\d/.test(w.where.replace(/PM/g, ''))), 'H9 指路文本不含数字');
eq(R.splitQuery('什么是汽蚀').includes('什么是'), false, 'H10 检索词切分去掉疑问词');
ok(R.splitQuery('机械密封的工作原理').includes('机械密封'), 'H11 检索词保留业务术语');
eq(R.splitQuery('').length, 0, 'H12 空问题无检索词');
eq(R.NOTICE.numeric, '该数值须以厂内规程/设备说明书为准，本技能不提供记忆中的数值。', 'H13 数值类固定表述与 SKILL.md 一致');
ok(/不用通用原理代替/.test(R.NOTICE.plant), 'H14 本厂类固定表述含不用通用原理代替');
ok(/通用原理，非本厂规定/.test(R.NOTICE.principle), 'H15 原理类固定表述含标注语');

// ============ I. make-sample 可再生 ============
const MS = path.join(__dirname, 'make-sample.js');
function sample(dir, seed) {
  const args = ['--out', dir];
  if (seed !== undefined) args.push('--seed', String(seed));
  const x = spawnSync(process.execPath, [MS, ...args], { encoding: 'utf8' });
  const l = x.stdout.trim().split('\n');
  try { return JSON.parse(l[l.length - 1]); } catch (e) { return { ok: false }; }
}
const S1 = path.join(work, 's1'), S7 = path.join(work, 's7');
const m1 = sample(S1, 1), m7 = sample(S7, 7);
eq(m1.ok, true, 'I1 make-sample 默认 seed 成功');
eq(m7.ok, true, 'I2 make-sample --seed 7 成功');
eq(JSON.stringify(m1.docs), JSON.stringify(m7.docs), 'I3 seed 变化时资料文件构成不变');
const q1 = run(['--question', '机械密封压盖螺栓力矩是多少', '--docs', path.join(S1, 'sample-docs')], 'samp1');
const q7 = run(['--question', '机械密封压盖螺栓力矩是多少', '--docs', path.join(S7, 'sample-docs')], 'samp7');
eq(q1.j.questionType, q7.j.questionType, 'I4 seed 变化时问题类型结论不变');
eq(q1.j.counts.documentsContentSearchable, q7.j.counts.documentsContentSearchable, 'I5 可检索资料份数不变');
eq(q1.j.counts.documentsNoTextLayer, q7.j.counts.documentsNoTextLayer, 'I6 无文字层文件数不变');
eq(q1.j.counts.documentsContentSearchable, 3, 'I7 样例可检索资料恒为 3 份');
ok(q1.j.passages.length >= 1 && q7.j.passages.length >= 1, 'I8 两个 seed 都能命中力矩原文');
eq(sample(path.join(work, 'sbad'), 'abc').ok, false, 'I9 非法 --seed 报错');

// ============ J. 中石化口径改造（2026-10-26）============
// J1~J5 PDF 统一前置步骤：不中断、warning 与 md 提示、unreadable 原因、meta.pdfNote
r = run(['--question', '机械密封原理', '--docs', DOCS], 'pdfnote');
eq(r.s.ok, true, 'J1 含 PDF 的资料目录不报错终止');
ok(r.s.warnings.some((x) => /P-01装配图\.pdf/.test(x) && /先用平台 pdf 技能转为 txt\/docx/.test(x) && /OCR/.test(x)), 'J2 PDF warning 带统一前置步骤（转 txt/docx、扫描件 OCR）');
ok(/【注意】本脚本不读 PDF：请先用平台 pdf 技能转为 txt\/docx 再传入/.test(r.md), 'J3 md 第六节提示 PDF 前置步骤');
ok(r.j.unreadable.some((u) => u.ext === '.pdf' && /先用平台 pdf 技能/.test(u.reason)), 'J4 unreadable 原因写明前置步骤');
ok(/先用平台 pdf 技能/.test(r.j.meta.pdfNote), 'J5 meta.pdfNote 记录前置步骤原文');
ok(!/扫描版 PDF \/ 本脚本不解析 PDF 内容/.test(r.md), 'J5b 旧 PDF 措辞不再出现');
// J6~J8 引用范围只限 --docs
ok(/引用只能来自 `--docs` 范围内的文件/.test(r.md), 'J6 md 声明引用只能来自 --docs 范围');
eq(r.j.meta.citeScope, 'docs-only', 'J7 给 --docs 时 citeScope=docs-only');
ok(/引用只能来自上述 --docs 范围内的文件并带文件名与段号/.test(r.md), 'J8 ANALYSIS 占位写明引用范围');
r = run(['--question', '什么是汽蚀'], 'noscope');
eq(r.j.meta.citeScope, 'none', 'J9 无 --docs 时 citeScope=none');
ok(/本次未提供/.test(r.md), 'J10 无资料时引用范围声明写「本次未提供」');
// J11~J12 声明行补「仅供参考，不替代操作规程与检修规程」
ok(/仅供参考，不替代操作规程与检修规程/.test(r.md), 'J11 md 声明行含「仅供参考，不替代操作规程与检修规程」');
ok(/仅供参考，不替代操作规程与检修规程/.test(r.j.meta.disclaimer), 'J12 JSON 声明行同样含该句');
// J13~J16 指路表中石化文件名示例
r = run(['--question', '机械密封压盖螺栓上多大力矩'], 'where');
ok(r.j.guidance.whereToLook.every((w) => typeof w.example === 'string' && w.example.length > 0), 'J13 每条指路都带 example');
ok(r.j.guidance.whereToLook.some((w) => /《炼化企业设备维护检修规程》/.test(w.example)), 'J14 力矩指路示例引《炼化企业设备维护检修规程》');
ok(R.WHERE_RULES.every(([, , , , ex]) => !/\d+(?:\.\d+)?\s*(N·m|MPa|kPa|mm|μm|℃|%|r\/min|mm\/s|个月|年|天|小时)/.test(ex)), 'J15 指路示例只引文件名不含任何数值');
ok(/中石化体系炼化厂常见文件示例（只引名称）/.test(r.md) && /各厂受控文件名可能不同/.test(r.md), 'J16 md 数值类指路表带文件示例列与说明');
ok(R.whereToLook('随便问点什么值')[0].example && /炼化企业设备维护检修规程/.test(R.whereToLook('随便问点什么值')[0].example), 'J17 W0 兜底同样带文件示例');
// J18~J23 通用原理段约束：checkPrincipleText 正反例
eq(R.PRINCIPLE_MAX_CHARS, 300, 'J18 通用原理段上限为 300 字');
ok(R.checkPrincipleText('机械密封靠端面比压维持液膜，比压过高端面磨损快、过低易泄漏。').ok, 'J19 无数字无单位的短段落通过');
ok(R.checkPrincipleText('端面比压一般控制在 0.3~0.5MPa').hasNumber, 'J20 夹带数值被识别');
ok(R.checkPrincipleText('比压约零点几 MPa 左右').hasNumber, 'J21 只出现单位也判为夹带');
ok(R.checkPrincipleText('原理'.repeat(200)).overLength, 'J22 超过 300 字判超长');
ok(!R.checkPrincipleText('原理'.repeat(150)).overLength, 'J23 300 字以内不判超长');
// J24~J26 产出 ANALYSIS 段扫描：占位说明本身不得带数字/单位（否则模型照抄就违例）
r = run(['--question', '为什么会发生汽蚀', '--docs', DOCS], 'analysis');
const analysisSeg = (r.md.match(/<!-- ANALYSIS_START -->([\s\S]*?)<!-- ANALYSIS_END -->/) || ['', ''])[1];
ok(analysisSeg.length > 0, 'J24 产出含 ANALYSIS 段');
ok(/不得出现任何数字或单位/.test(analysisSeg) && /引用只能来自/.test(analysisSeg), 'J25 ANALYSIS 占位写明原理段与引用范围约束');
ok(!R.checkPrincipleText(analysisSeg).hasNumber, 'J26 ANALYSIS 段本身不含数字/单位（selftest 扫描）');
ok(/【注意】通用原理段 \*\*不超过 300 字\*\*/.test(r.md), 'J27 md 第三节写明通用原理段 ≤300 字');
// J28~J30 sample-output 示范的原理段扫描（示范五、六、七）
const SO = fs.readFileSync(path.join(__dirname, '..', 'references', 'sample-output.md'), 'utf8');
const seg5 = (SO.match(/## 示范五[\s\S]*?\*\*结论\*\*([\s\S]*?)\*\*注意\*\*/) || ['', ''])[1];
const seg6 = (SO.match(/## 示范六[\s\S]*?\n(水锤是指[^\n]+)/) || ['', ''])[1];
const seg7 = (SO.match(/### 第一部分：机械密封的原理[\s\S]*?非本厂规定，具体以厂内规程为准。\*\*\n\n([^\n]+)/) || ['', ''])[1];
ok(seg5.length > 50 && R.checkPrincipleText(seg5).ok, `J28 sample-output 示范五原理段无数字无单位且 ≤300 字（${R.checkPrincipleText(seg5).chars} 字）`);
ok(seg6.length > 20 && R.checkPrincipleText(seg6).ok, 'J29 sample-output 示范六原理段无数字无单位且 ≤300 字');
ok(seg7.length > 20 && R.checkPrincipleText(seg7).ok, 'J30 sample-output 示范七原理部分无数字无单位且 ≤300 字');
// J31 产出 md 不含 emoji
ok(!/[\u2705\u274C\u26A0\u{1F600}-\u{1F6FF}]/u.test(r.md), 'J31 产出 md 不含 emoji');
// J32~J35 文档与 SKILL.md 同步
const SK = fs.readFileSync(path.join(__dirname, '..', 'SKILL.md'), 'utf8');
ok(/PDF 先用平台 pdf 技能转为 txt\/docx 再传入，脚本不读 PDF；扫描件需 OCR/.test(SK), 'J32 SKILL.md 写明 PDF 统一前置步骤');
ok(/allowed-tools: Read,Write,Bash,Grep,Glob/.test(SK) && /只允许在用户通过 `--docs` 指定的目录内检索/.test(SK), 'J33 SKILL.md 增加 Grep/Glob 并限定只在 --docs 目录内检索');
ok(/不超过 300 字且不得出现任何数字或单位/.test(SK), 'J34 SKILL.md 写明通用原理段约束');
ok(/明确告知用户并终止/.test(SK) && !/只能给出通用原理回答并标注该限制/.test(SK), 'J35 SKILL.md node 不可用改为终止');
const CK = fs.readFileSync(path.join(__dirname, '..', 'references', 'checklist.md'), 'utf8');
ok(/不超过 300 字/.test(CK) && /只能在 `--docs` 范围内引用/.test(CK), 'J36 checklist 含原理段长度与引用范围核对项');
const QR = fs.readFileSync(path.join(__dirname, '..', 'references', 'qa-rules.md'), 'utf8');
ok(/《炼化企业设备维护检修规程》/.test(QR) && /先用平台 pdf 技能/.test(QR) && !/[❌✅]/.test(QR), 'J37 qa-rules 含中石化文件名示例、PDF 前置步骤且无 emoji');
// J38~J40 样例：SAP 列名与 A/B/C 缺陷口径
const { readXlsx } = require('./lib/xlsx-lite');
const ledger = readXlsx(path.join(S1, 'sample-docs', '设备台账.xlsx'));
const hdr = ledger['设备台账'][0].map(String);
ok(hdr.includes('功能位置') && hdr.includes('设备描述') && hdr.includes('制造商'), 'J38 样例台账用 SAP PM 导出列名');
const docxTxt = lite.docxToText(fs.readFileSync(path.join(S1, 'sample-docs', '车间设备管理规定.docx'))).text;
ok(/A 级（重大）/.test(docxTxt) && !/I 级缺陷/.test(docxTxt), 'J39 样例制度缺陷分级改为 A/B/C 三级');
ok(/公司设备管理部门（机动部\/设备部）/.test(docxTxt), 'J40 样例制度用「公司设备管理部门（机动部/设备部）」口径');

console.log(`\n${'='.repeat(56)}`);
console.log(`equipment-knowledge-qa 自测：${pass} 通过，${fail} 失败`);
if (failures.length) { console.log('\n失败项：'); failures.forEach((f) => console.log('  ✗ ' + f)); }
console.log('='.repeat(56));
try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
