#!/usr/bin/env node
'use strict';
/** 自测：断言 build.js 行为。用法：node scripts/selftest.js */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { writeXlsx } = require('./lib/xlsx-lite');

const B = path.join(__dirname, 'build.js');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mmb-selftest-'));
let pass = 0, fail = 0;
const failures = [];
const ok = (c, n) => { if (c) pass++; else { fail++; failures.push(n); } };
const eq = (a, e, n) => ok(a === e, `${n}（期望 ${JSON.stringify(e)}，实际 ${JSON.stringify(a)}）`);

function run(args, tag) {
  const out = path.join(work, tag + '-out');
  const r = spawnSync(process.execPath, [B, ...args, '--out', out], { encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  let s; try { s = JSON.parse(lines[lines.length - 1]); } catch (e) { s = { ok: false, error: 'no-json:' + r.stdout + r.stderr }; }
  let j = null, md = null, ol = null;
  if (fs.existsSync(path.join(out, 'outline.json'))) j = JSON.parse(fs.readFileSync(path.join(out, 'outline.json'), 'utf8'));
  if (fs.existsSync(path.join(out, '汇报稿.md'))) md = fs.readFileSync(path.join(out, '汇报稿.md'), 'utf8');
  if (fs.existsSync(path.join(out, '要点提纲.md'))) ol = fs.readFileSync(path.join(out, '要点提纲.md'), 'utf8');
  return { code: r.status, s, j, md, ol, out };
}
const mkj = (n, o) => { const p = path.join(work, n); fs.writeFileSync(p, JSON.stringify(o, null, 2)); return p; };

const STATUS = mkj('status.json', {
  meta: { date: '2026-09-21' },
  counts: { equipment: 7, normal: 4, abnormal: 2, unknown: 1, missed: 2 },
  byEquipment: [{ tag: 'P-01' }],
  abnormal: [{ tag: 'P-1101B', name: '回流泵B', desc: '机封滴漏' }, { tag: 'M-1501', name: '鼓风机电机', desc: '电流偏高' }],
});
const ORDERS = mkj('orders.json', {
  counts: { total: 14, open: 9, overdue: 3, stalled: 3, closedInRange: 3 },
  metrics: { closeRate: 25, avgCycleDays: 5.5 },
  byStatus: { 施工中: 5 },
  overdue: [{ no: 'WO-001', tag: 'K-1201', desc: '出口温度检查', overdueDays: 6, owner: '二队' }],
});
const BASE = ['--input', `${STATUS},${ORDERS}`, '--meeting', '设备例会'];

// ============ A. 基础生成 ============
let r = run([...BASE, '--duration', '15', '--audience', '车间'], 'base');
eq(r.s.ok, true, 'A1 基础生成成功');
eq(r.s.counts.sources, 2, 'A2 识别两个来源');
ok(r.s.counts.metrics > 0, 'A3 抽取到指标');
ok(r.s.counts.issues > 0, 'A4 抽取到问题项');
ok(/## 一、开场/.test(r.md) && /## 二、关键指标/.test(r.md) && /## 三、主要工作/.test(r.md)
  && /## 四、存在问题/.test(r.md) && /## 五、需协调决策事项/.test(r.md) && /## 六、下步打算/.test(r.md), 'A5 六节齐全');
ok(fs.existsSync(path.join(r.out, '汇报稿.md')), 'A6 汇报稿生成');
ok(fs.existsSync(path.join(r.out, '要点提纲.md')), 'A7 要点提纲生成');
ok(fs.existsSync(path.join(r.out, 'outline.json')), 'A8 outline.json 生成');
ok(fs.existsSync(path.join(r.out, 'summary.json')), 'A9 summary.json 生成');

// ============ B. 数字不新增不修改（核心） ============
const m = r.j.metrics;
ok(m.some((x) => x.label === '涉及设备' && x.value === 7), 'B1 指标值原样引自来源');
ok(m.some((x) => x.label === '超期' && x.value === 3), 'B2 工单超期数原样');
ok(m.some((x) => x.label === '完成率' && x.value === 25), 'B3 完成率原样');
ok(m.every((x) => x.source), 'B4 每个指标标注来源文件');
ok(/未做任何新增、修改或美化/.test(r.md), 'B5 md 声明未美化数字');
// 不得出现来源中没有的数字（抽查：来源无「合格率」）
ok(!/合格率/.test(r.md), 'B6 未凭空添加来源中没有的指标');

// ============ C. 听众层级差异（核心） ============
const wk = run([...BASE, '--duration', '15', '--audience', '车间'], 'wk');
const lead = run([...BASE, '--duration', '8', '--audience', '公司'], 'lead');
ok(/P-1101B/.test(wk.md), 'C1 车间层级保留位号');
ok(!/P-1101B|WO-001|K-1201/.test((lead.md.match(/## 四、存在问题[\s\S]*?## 五/) || [''])[0]), 'C2 公司层级去除位号与工单号');
ok(/回流泵B/.test(lead.md), 'C3 公司层级保留设备名称（比「相关设备」有信息量）');
eq(wk.j.meta.audienceSpec.includes('具体位号'), true, 'C4 车间层级口径说明');
eq(lead.j.meta.audienceSpec.includes('不列具体位号'), true, 'C5 公司层级口径说明');
// 时间分配权重不同
const wkDec = wk.j.timeAllocation.find((t) => t.section === '需决策').minutes / wk.j.meta.duration;
const ldDec = lead.j.timeAllocation.find((t) => t.section === '需决策').minutes / lead.j.meta.duration;
ok(ldDec > wkDec, 'C6 公司层级需决策占比更高');
const wkWork = wk.j.timeAllocation.find((t) => t.section === '主要工作').minutes / wk.j.meta.duration;
const ldWork = lead.j.timeAllocation.find((t) => t.section === '主要工作').minutes / lead.j.meta.duration;
ok(wkWork > ldWork, 'C7 车间层级主要工作占比更高');
// 公司层级问题项截断
ok(lead.j.issues.length >= 3, 'C8 JSON 保留全部问题项');

// ============ D. 议题无数据不编造（核心） ============
r = run([...BASE, '--duration', '15', '--audience', '车间', '--topics', '工单,能耗管理,备件库存'], 'topics');
ok(r.s.counts.noData >= 1, 'D1 检出无数据支撑的议题');
ok(r.j.noData.some((x) => x.topic === '能耗管理'), 'D2 能耗管理无数据');
ok(r.j.noData.every((x) => x.note.includes('需补充')), 'D3 标注需补充');
ok(r.j.warnings.some((w) => w.includes('未编造内容')), 'D4 warning 声明未编造');
ok(/无数据支撑的议题/.test(r.md), 'D5 md 单列该节');
// 不得为无数据议题编造内容
const naSec = (r.md.match(/## 附：无数据支撑的议题[\s\S]*/) || [''])[0];
ok(!/\d+%|\d+ 台|\d+ 项/.test(naSec.replace(/该议题暂无数据支撑，需补充/g, '')), 'D6 无数据议题节内无编造数字');

// ============ E. 不代拟工作与计划（核心） ============
r = run([...BASE, '--duration', '15', '--audience', '车间'], 'noplan');
ok(/<!-- WORK_START -->/.test(r.md) && /本技能不代拟/.test(r.md), 'E1 主要工作留占位不代拟');
ok(/<!-- PLAN_START -->/.test(r.md), 'E2 下步打算留占位');
ok(/由汇报人补充|由汇报人填写/.test(r.md), 'E3 明确由汇报人填写');
ok(/避免编造未发生的工作内容/.test(r.md), 'E4 说明不编造工作内容');

// ============ F. 需决策与遗留事项 ============
r = run([...BASE, '--duration', '15', '--audience', '分厂',
  '--need-decision', '机封备件采购需加急；检修队伍不足需协调', '--pending', '上月提出的备件定额调整'], 'decision');
eq(r.s.counts.needDecision, 2, 'F1 解析两项需决策');
eq(r.s.counts.pending, 1, 'F2 解析遗留事项');
ok(/请求决策的具体内容/.test(r.md), 'F3 提示写清请求决策内容');
ok(/可选方案/.test(r.md), 'F4 提示写清可选方案');
ok(/上次会议遗留事项进展/.test(r.md), 'F5 遗留事项单列');
ok(r.ol.includes('必须提到的决策事项'), 'F6 提纲含决策事项');
r = run([...BASE, '--duration', '15', '--audience', '车间'], 'nodecision');
eq(r.s.counts.needDecision, 0, 'F7 未提供时为 0');
ok(r.j.warnings.some((w) => w.includes('由汇报人填写')), 'F8 warning 提示');

// ============ G. 无法识别的 JSON ============
const BAD = mkj('bad.json', { hello: 'world' });
r = run(['--input', `${STATUS},${BAD}`, '--meeting', 'X', '--duration', '10', '--audience', '车间'], 'badjson');
eq(r.s.ok, true, 'G1 无法识别的 JSON 不中断');
ok(r.j.warnings.some((w) => w.includes('无法识别')), 'G2 warning 提示');
eq(r.s.counts.sources, 1, 'G3 只计有效来源');
// 全部无法识别 → 报错
function raw(args) {
  const x = spawnSync(process.execPath, [B, ...args], { encoding: 'utf8' });
  const l = x.stdout.trim().split('\n');
  try { return { code: x.status, s: JSON.parse(l[l.length - 1]) }; } catch (e) { return { code: x.status, s: { ok: false } }; }
}
eq(raw(['--input', BAD, '--meeting', 'X', '--duration', '10', '--audience', '车间']).s.ok, false, 'G4 全部无法识别时报错');

// ============ H. 隐患与周报 JSON ============
const HAZ = mkj('hazard.json', {
  counts: { total: 12, major: 2, overdue: 3 }, metrics: { closeRate: 25 },
  majorHazards: [{ no: 'YH-001', desc: '栏杆锈蚀' }],
});
r = run(['--input', HAZ, '--meeting', 'X', '--duration', '10', '--audience', '车间'], 'haz');
eq(r.s.ok, true, 'H1 隐患 JSON 可识别');
ok(r.j.metrics.some((x) => x.label === '重大隐患'), 'H2 抽取重大隐患指标');
ok(r.j.issues.some((x) => x.text.includes('重大隐患')), 'H3 重大隐患进问题项');

// ============ I. 内容量与时长匹配 ============
r = run([...BASE, '--duration', '3', '--audience', '车间'], 'short');
ok(r.j.warnings.some((w) => w.includes('内容量偏大')), 'I1 时长过短提示');
r = run([...BASE, '--duration', '120', '--audience', '车间'], 'long');
ok(r.j.warnings.some((w) => w.includes('内容量偏少')), 'I2 时长过长提示');

// ============ J. 参数校验 ============
eq(raw([]).s.ok, false, 'J1 无参数报错');
eq(raw(['--input']).s.ok, false, 'J2 缺值报错');
ok(/缺少取值/.test(raw(['--input']).s.error), 'J3 缺值信息正确');
eq(raw(['--input', STATUS]).s.ok, false, 'J4 缺 meeting 报错');
eq(raw(['--input', STATUS, '--meeting', 'X']).s.ok, false, 'J5 缺 audience 报错');
eq(raw(['--input', STATUS, '--meeting', 'X', '--audience', '车间']).s.ok, false, 'J6 缺 duration 报错');
eq(raw(['--input', STATUS, '--meeting', 'X', '--audience', '董事长', '--duration', '10']).s.ok, false, 'J7 非法 audience 报错');
eq(raw(['--input', STATUS, '--meeting', 'X', '--audience', '厂领导', '--duration', '10']).s.ok, false, 'J7b 旧称「厂领导」不再接受');
eq(raw(['--input', STATUS, '--meeting', 'X', '--audience', '设备部', '--duration', '10']).s.ok, false, 'J7c 旧称「设备部」不再接受');
ok(/只能是/.test(raw(['--input', STATUS, '--meeting', 'X', '--audience', 'X', '--duration', '10']).s.error), 'J8 列出可选值');
eq(raw(['--input', STATUS, '--meeting', 'X', '--audience', '车间', '--duration', '-5']).s.ok, false, 'J9 非法 duration 报错');
eq(raw(['--input', '/不存在.json', '--meeting', 'X', '--audience', '车间', '--duration', '10']).s.ok, false, 'J10 输入不存在报错');
eq(raw([...BASE, '--duration', '10', '--audience', '车间', '--未知', 'x']).s.ok, false, 'J11 未知参数报错');
const BADJSON = path.join(work, 'broken.json');
fs.writeFileSync(BADJSON, '{坏');
eq(raw(['--input', BADJSON, '--meeting', 'X', '--audience', '车间', '--duration', '10']).s.ok, false, 'J12 非法 JSON 报错');

// ============ K. 表格输入提示 ============
const XLS = path.join(work, 'x.xlsx');
writeXlsx(XLS, { '数据': [['a', 'b'], [1, 2]] });
r = run(['--input', `${STATUS},${XLS}`, '--meeting', 'X', '--duration', '10', '--audience', '车间'], 'xlsx');
ok(r.j.warnings.some((w) => w.includes('不做二次统计')), 'K1 表格输入提示不做二次统计');
ok(r.j.warnings.some((w) => w.includes('先用对应报表技能')), 'K2 提示先用报表技能');

// ============ L. 提纲内容 ============
r = run([...BASE, '--duration', '15', '--audience', '公司'], 'outline');
ok(/时间分配建议/.test(r.ol), 'L1 提纲含时间分配');
ok(/要点速览/.test(r.ol), 'L2 提纲含要点速览');
ok(/口头汇报提示/.test(r.ol), 'L3 提纲含汇报提示');
ok(/数字念准/.test(r.ol), 'L4 提示数字念准');
ok(/不归因到人/.test(r.ol), 'L5 提示不归因');
ok(/只讲结论与需决策事项/.test(r.ol), 'L6 公司层级专属提示');

// ============ M. 不做责任归因 ============
r = run([...BASE, '--duration', '15', '--audience', '车间'], 'noblame');
ok(/只陈述事实与影响，不做责任归因/.test(r.md), 'M1 存在问题节带不归因提示');
ok(!/拖延|不作为|失职|能力差/.test(r.md), 'M2 全文无归因性表述');

// ============ N. 层级三档与 --audience-spec ============
r = run([...BASE, '--duration', '10', '--audience', '分厂', '--audience-spec', '烯烃厂设备科'], 'sub');
eq(r.s.ok, true, 'N1 分厂层级可用');
eq(r.j.meta.audienceCn, '分厂（烯烃厂设备科）', 'N2 --audience-spec 作为厂内层级名称');
ok(/听众：分厂（烯烃厂设备科）/.test(r.md), 'N3 md 显示层级与厂内名称');
eq(r.j.meta.detail, 'medium', 'N4 分厂默认中等详略');
ok(/P-1101B/.test(r.md), 'N5 分厂层级保留位号');
r = run([...BASE, '--duration', '10', '--audience', '分厂', '--audience-spec', '分厂领导:low'], 'sub-low');
eq(r.j.meta.detail, 'low', 'N6 --audience-spec 可带 :low 覆盖详略档位');
ok(!/P-1101B/.test((r.md.match(/## 四、存在问题[\s\S]*?## 五/) || [''])[0]), 'N7 覆盖为 low 后去位号');
r = run([...BASE, '--duration', '10', '--audience', '公司', '--audience-spec', '公司设备管理部门（机动部）'], 'co');
ok(/公司（公司设备管理部门（机动部））/.test(r.md), 'N8 公司层级厂内名称');
ok(!/厂领导|设备部范围/.test(r.md), 'N9 md 不出现旧称「厂领导」');

// ============ O. --weights ============
r = run([...BASE, '--duration', '10', '--audience', '车间', '--weights', '开场:0.1,关键指标:0.3,主要工作:0.2,存在问题:0.2,需决策:0.1,下步打算:0.1'], 'weights');
eq(r.s.ok, true, 'O1 --weights 可用');
eq(r.j.meta.weightsSource, '用户指定（--weights）', 'O2 权重来源记录');
eq(r.j.timeAllocation.find((t) => t.section === '关键指标').minutes, 3, 'O3 关键指标 10×0.3 = 3 分钟');
eq(r.j.timeAllocation.find((t) => t.section === '开场').weight, 0.1, 'O4 权重写入 timeAllocation');
ok(/时间权重：用户指定/.test(r.ol), 'O5 提纲标注权重来源');
eq(raw([...BASE, '--duration', '10', '--audience', '车间', '--weights', '开场:0.5,关键指标:0.5']).s.ok, false, 'O6 缺环节报错');
ok(/缺少环节/.test(raw([...BASE, '--duration', '10', '--audience', '车间', '--weights', '开场:0.5,关键指标:0.5']).s.error), 'O7 错误信息列出缺少的环节');
eq(raw([...BASE, '--duration', '10', '--audience', '车间', '--weights', '开场:0.2,关键指标:0.3,主要工作:0.2,存在问题:0.2,需决策:0.1,下步打算:0.1']).s.ok, false, 'O8 权重和不为 1 报错');
eq(raw([...BASE, '--duration', '10', '--audience', '车间', '--weights', '开场:0.1,关键指标:0.3,主要工作:0.2,存在问题:0.2,需决策:0.1,茶歇:0.1']).s.ok, false, 'O9 未知环节报错');
eq(raw([...BASE, '--duration', '10', '--audience', '车间', '--weights', '开场:abc,关键指标:0.3,主要工作:0.2,存在问题:0.2,需决策:0.1,下步打算:0.2']).s.ok, false, 'O10 非数字权重报错');
r = run([...BASE, '--duration', '10', '--audience', '车间'], 'weights-default');
eq(r.j.meta.weightsSource, '默认（按听众层级）', 'O11 未传 --weights 时为默认权重');

// ============ P. --hide-tags ============
r = run([...BASE, '--duration', '15', '--audience', '车间', '--hide-tags'], 'hide');
ok(!/P-1101B|WO-001|K-1201/.test((r.md.match(/## 四、存在问题[\s\S]*?## 五/) || [''])[0]), 'P1 车间层级加 --hide-tags 后去位号与工单号');
ok(/回流泵B/.test(r.md), 'P2 --hide-tags 仍保留设备名称');
eq(r.j.meta.hideTags, true, 'P3 meta 记录 hideTags');
ok(/已按 --hide-tags 去位号/.test(r.md), 'P4 md 说明已去位号');
ok(r.j.issues.some((x) => /P-1101B/.test(x.text)), 'P5 outline.json 的 issues 仍保留原文（去位号只影响稿件）');

// ============ Q. slides 提纲（供 pptx） ============
r = run([...BASE, '--duration', '15', '--audience', '车间', '--need-decision', '机封备件加急', '--topics', '工单,能耗管理'], 'slides');
ok(Array.isArray(r.j.slides) && r.j.slides.length >= 7, 'Q1 outline.json 含 slides 数组（封面 + 六节）');
ok(r.j.slides.every((x) => typeof x.title === 'string' && Array.isArray(x.bullets)), 'Q2 每页含 title 与 bullets');
ok(r.j.slides.some((x) => x.title === '二、关键指标' && x.bullets.some((b) => /涉及设备：7/.test(b))), 'Q3 关键指标页数字原样');
ok(r.j.slides.some((x) => x.title === '三、主要工作' && /不代拟/.test(x.bullets[0])), 'Q4 主要工作页为占位不代拟');
ok(r.j.slides.some((x) => x.title === '五、需协调决策事项' && x.bullets.some((b) => /机封备件加急/.test(b))), 'Q5 需决策页含用户给的事项');
ok(r.j.slides.some((x) => /无数据支撑的议题/.test(x.title) && x.bullets.some((b) => /能耗管理/.test(b))), 'Q6 无数据议题单独一页写需补充');
eq(r.s.slides, r.j.slides.length, 'Q7 summary 记录页数');
ok(/outline\.json 的 slides 数组/.test(r.ol) && /不得手写 pptx XML/.test(r.ol), 'Q8 提纲说明 slides 可交 pptx 技能转换且不手写 XML');
ok(!/⚠|✅|❌/.test(r.md) && !/⚠|✅|❌/.test(r.ol), 'Q9 产出不含 emoji');
ok(/【注意】/.test(run([...BASE, '--duration', '15', '--audience', '车间'], 'notice').ol), 'Q10 提纲醒目提示用「【注意】」');

// ============ R. periodic.json / daily.json 中文标签 ============
const PER = mkj('periodic.json', {
  meta: { period: 'weekly', from: '2026-09-14', to: '2026-09-20' },
  metrics: { intactRate: 90, majorRate: 85.7, staticLeakRate: 0.42, planRateOverhaul: 0, orderRate: 62.5, unplannedShutdowns: 1, basedOn: '基于 5 天数据（应为 7 天）' },
  failures: { total: 8 }, dataGaps: { missingDates: ['2026-09-16'], recompute: [{ metric: '检修计划完成率', algo: 'x' }] },
  highlights: [{ type: '故障频发设备', text: 'P-1101B 区间内故障 3 次' }],
});
r = run(['--input', PER, '--meeting', '周例会', '--duration', '10', '--audience', '车间'], 'periodic');
eq(r.s.ok, true, 'R1 periodic.json 可识别');
ok(r.j.metrics.some((m) => m.label === '设备完好率' && m.value === 90 && m.unit === '%'), 'R2 指标键映射为中文标签与单位');
ok(r.j.metrics.some((m) => m.label === '静密封点泄漏率' && m.unit === '‰'), 'R3 泄漏率单位 ‰');
ok(!r.j.metrics.some((m) => /^[a-zA-Z]+$/.test(m.label)), 'R4 不再出现英文键名');
ok(r.j.issues.some((x) => /需按厂内口径复算/.test(x.text)), 'R5 需复算指标进问题项');
ok(r.j.issues.some((x) => /故障频发设备/.test(x.text)), 'R6 周报重点事项进问题项');
ok(r.j.metrics.every((m) => m.value !== undefined), 'R7 null 指标保留为 null 不补数');
const DAY = mkj('daily.json', { meta: { date: '2026-09-21' }, counts: { equipment: 20, abnormal: 2, overdueOrders: 1, permits: 4 }, status: {}, orders: {}, special: { list: [{ tag: 'K-1601', name: '富气压缩机', state: '异常', desc: '振动升高' }] } });
r = run(['--input', DAY, '--meeting', '早会', '--duration', '5', '--audience', '车间'], 'daily');
ok(r.j.metrics.some((m) => m.label === '当日作业票' && m.value === 4), 'R8 daily.json counts 映射为中文');
ok(r.j.issues.some((x) => /特护设备 K-1601/.test(x.text)), 'R9 日报特护异常进问题项');

console.log(`\n${'='.repeat(56)}`);
console.log(`meeting-material-builder 自测：${pass} 通过，${fail} 失败`);
if (failures.length) { console.log('\n失败项：'); failures.forEach((f) => console.log('  ✗ ' + f)); }
console.log('='.repeat(56));
try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
