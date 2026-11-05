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
// 按 hazard-closure-tracker 真实 hazard.json 结构裁剪：闭环率字段为 metrics.closureRate（不是 closeRate），
// 顶层同时带 overdue / dueSoon / closed 等数组与 items。
const hz = (no, desc, level, bucket, bucketCn) => ({ no, desc, level, levelCn: level === 'major' ? '重大隐患' : '一般隐患', status: bucket === 'closed' ? 'done' : 'doing', bucket, bucketCn, owner: '张工', deadline: '2026-09-09', sheet: '隐患台账', row: 2 });
const HZ1 = hz('YH-001', '栏杆锈蚀', 'major', 'overdue', '超期未整改');
const HZ2 = hz('YH-005', '保温层破损', 'general', 'dueSoon', '临期');
const HAZ = mkj('hazard.json', {
  meta: { workshop: '常减压车间', date: '2026-09-21', from: null, rulesSource: '默认口径（references/hazard-rules.md）' },
  counts: { total: 12, overdue: 2, dueSoon: 1, inProgress: 1, closed: 3, unverified: 2, undetermined: 3, major: 3, conflicts: 0, fiveFixedIncomplete: 6, duplicateNo: 0 },
  metrics: { closureRate: 25, avgClosureDays: 36.7, byLevel: { major: { total: 3, closed: 1, overdue: 1 } }, byUnit: { 常减压车间: 9 }, bySource: { 日常巡检: 4 } },
  overdue: [HZ1], dueSoon: [HZ2], inProgress: [], closed: [], unverified: [],
  majorHazards: [HZ1], undetermined: [], conflicts: [], fiveFixedIncomplete: [], trend: null, items: [HZ1, HZ2], warnings: [],
});
r = run(['--input', HAZ, '--meeting', 'X', '--duration', '10', '--audience', '车间'], 'haz');
eq(r.s.ok, true, 'H1 隐患 JSON 可识别');
ok(r.j.metrics.some((x) => x.label === '重大隐患'), 'H2 抽取重大隐患指标');
ok(r.j.issues.some((x) => x.text.includes('重大隐患')), 'H3 重大隐患进问题项');
// 缺陷复现：上游真实字段是 metrics.closureRate，旧版只读 closeRate，闭环率始终缺失
ok(r.j.metrics.some((x) => x.label === '闭环率' && x.value === 25 && x.unit === '%'), 'H4 读取上游真实字段 metrics.closureRate 得闭环率 25%');
ok(/\| 闭环率 \| 25% \| hazard\.json \|/.test(r.md), 'H5 汇报稿关键指标表含隐患闭环率');
eq(r.j.keyPoints.find((k) => k.topic === '隐患跟踪') !== undefined, true, 'H6 真实结构归为隐患跟踪，不被工单分支抢走');
ok(r.j.metrics.some((x) => x.label === '隐患总数' && x.value === 12) && r.j.metrics.some((x) => x.label === '超期未整改' && x.value === 2), 'H7 隐患总数与超期数原样引自 counts');
// 兼容旧字段 closeRate（早期样例或手工整理的 JSON）
const HAZ_OLD = mkj('hazard-old.json', { counts: { total: 12, major: 2, overdue: 3 }, metrics: { closeRate: 30 }, majorHazards: [{ no: 'YH-001', desc: '栏杆锈蚀' }] });
r = run(['--input', HAZ_OLD, '--meeting', 'X', '--duration', '10', '--audience', '车间'], 'haz-old');
ok(r.j.metrics.some((x) => x.label === '闭环率' && x.value === 30), 'H8 兼容旧字段 metrics.closeRate');
// closureRate 为 null（如无隐患）不补 0
const HAZ_NULL = mkj('hazard-null.json', { counts: { total: 0, major: 0, overdue: 0 }, metrics: { closureRate: null, avgClosureDays: null }, majorHazards: [], items: [] });
r = run(['--input', `${HAZ_NULL},${STATUS}`, '--meeting', 'X', '--duration', '10', '--audience', '车间'], 'haz-null');
ok(!r.j.metrics.some((x) => x.label === '闭环率' && x.value === 0), 'H9 closureRate 为 null 时不按 0 出数');
// 已闭环（bucket=closed，已整改且已验收）的重大隐患不进「存在问题」，改列「主要工作」；已整改未验收仍是问题
const HZC = hz('YH-002', '报警器失效', 'major', 'closed', '已闭环');
const HZU = hz('YH-003', '护栏缺失', 'major', 'unverified', '已整改未验收');
const HAZ_MIX = mkj('hazard-mix.json', { counts: { total: 3, major: 3, overdue: 1 }, metrics: { closureRate: 33.3 }, overdue: [HZ1], closed: [HZC], unverified: [HZU], majorHazards: [HZ1, HZC, HZU], items: [HZ1, HZC, HZU] });
r = run(['--input', HAZ_MIX, '--meeting', 'X', '--duration', '10', '--audience', '车间'], 'haz-mix');
ok(!r.j.issues.some((x) => x.text.includes('报警器失效')), 'H12 已闭环重大隐患不进存在问题');
ok(r.j.issues.some((x) => x.text.includes('栏杆锈蚀')) && r.j.issues.some((x) => x.text.includes('护栏缺失')), 'H13 超期、已整改未验收的重大隐患仍进存在问题');
ok(r.j.doneItems.length === 1 && /报警器失效（YH-002）/.test(r.j.doneItems[0].text) && r.j.counts.done === 1, 'H14 已闭环重大隐患记入 doneItems');
const workSec = r.md.split('## 三、主要工作')[1].split('## 四、')[0];
ok(/报警器失效/.test(workSec) && /<!-- WORK_START -->/.test(workSec), 'H15 汇报稿「主要工作」列出已闭环事项，并保留汇报人补充占位');
ok(!/报警器失效/.test(r.md.split('## 四、存在问题')[1].split('## 五、')[0]), 'H16 汇报稿「存在问题」不含已闭环事项');
ok(r.j.slides.find((s) => s.title === '三、主要工作').bullets.some((b) => /报警器失效/.test(b)), 'H17 slides 主要工作页含已闭环事项');
// work-order-tracker 真实 orders.json：vendor=承修单位/工作中心，owner=责任人（个人）。责任方应写单位，不点人名
const ORD_REAL = mkj('orders-real.json', {
  meta: { workshop: '常减压车间', date: '2026-09-21' },
  counts: { total: 14, known: 13, unknownStatus: 1, open: 9, overdue: 1, stalled: 0, dueSoon: 0, closedInRange: 3, closedAll: 3, cancelled: 1 },
  byStatus: [{ status: '已派工', count: 4 }],
  overdue: [{ no: 'WO-26090102', tag: 'K-1201', name: '循环氢压缩机', status: '已派工', vendor: '外委-华东检修', owner: '项目经理李', party: '外委-华东检修 / 项目经理李', fault: '二级出口温度偏高', dueAt: '2026-09-15', overdueDays: 6 }],
  metrics: { closeRate: 25, avgCycleDays: 5.5, cycleSample: 2 },
});
r = run(['--input', ORD_REAL, '--meeting', 'X', '--duration', '10', '--audience', '车间'], 'orders-real');
ok(r.j.issues.some((x) => /WO-26090102 K-1201 超期 6 天，责任方 外委-华东检修/.test(x.text)), 'H10 超期工单责任方取上游 vendor（承修单位）');
ok(!r.j.issues.some((x) => /项目经理李/.test(x.text)), 'H11 不把上游 owner（责任人个人）写成责任方');
ok(r.j.issues.some((x) => /WO-26090102/.test(x.text) && /循环氢压缩机/.test(x.text) && /二级出口温度偏高/.test(x.text)), 'H18 超期工单问题项带设备名称与故障描述');
r = run(['--input', ORD_REAL, '--meeting', 'X', '--duration', '8', '--audience', '公司'], 'orders-real-company');
{ const sec = (r.md.split('## 四、存在问题')[1] || '').split('## 五')[0];
  ok(!/K-1201|WO-26090102/.test(sec) && /循环氢压缩机/.test(sec), 'H19 公司层级去位号后超期工单仍保留设备名称（去位号不等于去信息）'); }

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

// 上游 periodic.json 把指标列为需复算、却仍带数值（旧样例或手工 JSON）：不引用该数值，避免「50%」与「本期未出数」并存
const PER_BAD = mkj('periodic-bad.json', {
  meta: { workshop: '测试车间', period: 'weekly' },
  metrics: { intactRate: 90, planRate: 50, planRateOverhaul: 0, planRateRoutine: 100, orderRate: 62.5 },
  failures: { total: 1 }, dataGaps: { recompute: [{ metric: '检修计划完成率', algo: 'x' }] },
});
r = run(['--input', PER_BAD, '--meeting', '分厂设备月会', '--duration', '10', '--audience', '分厂'], 'periodic-recompute-value');
ok(!r.j.metrics.some((m) => /检修计划完成率/.test(m.label)), 'R10 需复算的检修计划完成率（含大检修、日常维修分列）不进关键指标');
ok(r.j.metrics.some((m) => m.label === '设备完好率' && m.value === 90), 'R11 其余指标照常引用');
ok(r.s.warnings.some((w) => /检修计划完成率/.test(w) && /需复算/.test(w)), 'R12 上游需复算却带数值时 warning');


// ============ S. periodic.json 超期工单责任方写单位，不点人名（v4-4） ============
{
  // 新版 periodic.json：highlights 带 unit（工作中心）
  const PER_NEW = mkj('periodic-unit.json', {
    meta: { period: 'monthly', from: '2026-10-05', to: '2026-11-04' }, metrics: { intactRate: 95 }, failures: { total: 1 }, dataGaps: {},
    orders: { overdueList: [{ no: '20032936', tag: 'P-2105A', desc: '机封漏油', owner: '郑八', workCenter: '检维修中心动设备班' }] },
    highlights: [{ type: '超期工单', no: '20032936', tag: 'P-2105A', unit: '检维修中心动设备班', text: '20032936 P-2105A 机封漏油，要求完成 2026-10-13，实际 2026-10-16 闭环，超期 3 天，责任方 检维修中心动设备班' }],
  });
  let r = run(['--input', PER_NEW, '--meeting', '分厂设备月会', '--duration', '10', '--audience', '分厂'], 'periodic-unit');
  ok(r.j.issues.some((x) => /责任方 检维修中心动设备班/.test(x.text)) && !/郑八/.test(JSON.stringify(r.j)), 'S1 periodic.json 超期工单责任方写工作中心，不出现人名');
  // 旧版 periodic.json：highlights 只有文字，责任方是人名，overdueList 有 owner 无 workCenter
  const PER_OLD = mkj('periodic-person.json', {
    meta: { period: 'monthly', from: '2026-10-05', to: '2026-11-04' }, metrics: { intactRate: 95 }, failures: { total: 1 }, dataGaps: {},
    orders: { overdueList: [{ no: '20032936', tag: 'P-2105A', desc: '机封漏油', owner: '郑八' }] },
    highlights: [{ type: '超期工单', text: '20032936 P-2105A 机封漏油，要求完成 2026-10-13，实际 2026-10-16 闭环，超期 3 天，责任方 郑八' },
      { type: '检修计划未完成', text: '项目5（V-1301） 计划完成 2026-10-20，截至 2026-11-04 未完工，责任人 王五' }],
  });
  r = run(['--input', PER_OLD, '--meeting', '分厂设备月会', '--duration', '10', '--audience', '分厂'], 'periodic-person');
  ok(!/郑八|王五/.test(r.md) && !/郑八|王五/.test(JSON.stringify(r.j.issues)), 'S2 旧版 periodic.json 的责任人姓名不进汇报稿和问题项');
  ok(r.j.issues.some((x) => /20032936 P-2105A 机封漏油/.test(x.text) && /超期 3 天/.test(x.text)), 'S3 去掉人名后超期工单事实保留');
  ok(r.s.warnings.some((w) => /人名|姓名|责任人/.test(w) && /工作中心|单位/.test(w)), 'S4 去掉人名时给 warning，提示补单位');
}

// ============ T. 公司层级需决策事项同样去位号（v4 疑点 4） ============
{
  let r = run([...BASE, '--duration', '8', '--audience', '公司', '--need-decision', 'P-2101A 进料泵是否提前安排检修；20033023 工单需协调外委'], 'decision-company');
  const sec = (r.md.match(/## 五[\s\S]*?(\n## |$)/) || [''])[0];
  ok(!/P-2101A|20033023/.test(sec) && /进料泵是否提前安排检修/.test(sec), 'T1 公司层级需决策节去掉位号、工单号，保留设备名称与事项');
  ok(!r.j.needDecision.some((d) => /P-2101A|20033023/.test(d.text)), 'T2 outline.json needDecision 文本去位号');
  const sl = (r.j.slides || []).find((x) => /需协调决策/.test(x.title));
  ok(sl && !sl.bullets.some((b) => /P-2101A/.test(b)), 'T3 slides 需决策页去位号');
  r = run([...BASE, '--duration', '8', '--audience', '车间', '--need-decision', 'P-2101A 进料泵是否提前安排检修'], 'decision-ws');
  ok(r.j.needDecision.some((d) => /P-2101A/.test(d.text)), 'T4 车间层级需决策保留位号');
}

// ============ U. 车间范围核对（D007）：给了 --workshop 时，上游 JSON 车间不一致不纳入 ============
{
  const OT = '二车间';
  const ST_MINE = mkj('ws-status.json', { meta: { workshop: '测试车间', date: '2026-09-21', workshopScope: [{ sheet: 'x/巡检记录', status: 'checked', droppedRows: 2, dropped: { 二车间: 2 } }] },
    counts: { equipment: 7, normal: 5, abnormal: 2, unknown: 0, missed: 0 }, byEquipment: [], abnormal: [{ tag: 'P-1101B', name: '回流泵B', desc: '机封滴漏' }] });
  const ORD_OT = mkj('ws-orders-other.json', { meta: { workshop: OT }, counts: { total: 99, open: 88, overdue: 77 }, metrics: { closeRate: 11 }, byStatus: {}, overdue: [{ no: 'WO-999', tag: 'X-9', overdueDays: 9, vendor: '外车间队' }] });
  const DAY_WS = mkj('ws-daily.json', { meta: { workshop: '测试', date: '2026-09-21', workshopScope: [{ sheet: 'x/巡检汇总', status: 'checked' }] }, counts: { equipment: 20, permits: 4 }, status: {}, orders: {} });
  const PER_WS = mkj('ws-periodic.json', { meta: { workshop: '测试车间', period: 'weekly', workshopScope: [], upstreamWorkshop: { matched: [], unknown: [], excluded: [] } }, metrics: { intactRate: 92 }, failures: { total: 0 }, dataGaps: {} });
  const ORD_TOP = mkj('ws-orders-top.json', { workshop: OT, counts: { total: 5, open: 5, overdue: 5 }, metrics: { closeRate: 0 }, byStatus: {}, overdue: [] });
  const args = (input, extra = []) => ['--input', input, '--meeting', '设备例会', '--duration', '10', '--audience', '车间', '--workshop', '测试车间', ...extra];
  let r = run(args([ST_MINE, ORD_OT, ORDERS, DAY_WS, PER_WS].join(',')), 'ws-mix');
  eq(r.s.ok, true, 'U1 上游 JSON 车间混合时可运行');
  ok(r.s.sources.some((x) => /ws-status\.json/.test(x)), 'U2 车间一致的 JSON 纳入（带 meta.workshopScope 照常读取）');
  ok(!r.s.sources.some((x) => /ws-orders-other/.test(x)), 'U3 车间不一致的 JSON 不纳入数据来源');
  ok(!r.j.metrics.some((m) => m.value === 88 || m.value === 77) && !/WO-999/.test(r.md), 'U4 不纳入的 JSON 数字与事项不进汇报稿');
  ok(r.s.warnings.some((w) => w.includes('ws-orders-other.json') && w.includes(OT) && w.includes('测试车间')), 'U5 warning 写明文件名与两个车间名');
  const PER_OT = mkj('ws-periodic-other.json', { meta: { workshop: OT, period: 'weekly' }, metrics: { planRate: 50 }, failures: { total: 0 }, dataGaps: { recompute: [{ metric: '检修计划完成率', algo: 'x' }] } });
  const rx = run(args([ST_MINE, PER_OT].join(',')), 'ws-per-other');
  ok(!rx.s.warnings.some((w) => /需复算/.test(w)) && rx.s.warnings.some((w) => w.includes('ws-periodic-other.json')), 'U5a 不纳入的 JSON 不产生抽取类提示，只留车间不一致的 warning');
  eq((((r.j.meta.upstreamWorkshop || {}).excluded || [])[0] || {}).file, 'ws-orders-other.json', 'U6 outline.json meta.upstreamWorkshop 记不纳入的来源');
  ok(/【注意】上游 JSON「ws-orders-other\.json」的车间「二车间」与 --workshop「测试车间」不一致/.test(r.md.split('## 一、')[0]), 'U7 汇报稿开头提示有上游 JSON 未纳入');
  ok(/【注意】上游 JSON「ws-orders-other\.json」/.test(r.ol || ''), 'U8 要点提纲开头同样提示');
  ok(/上游 JSON 未注明车间，无法核对（「orders\.json」），已照常纳入/.test(r.md), 'U9 无车间字段的 JSON 照常纳入并在口径处说明');
  ok(r.s.sources.some((x) => /^orders\.json/.test(x)), 'U10 无车间字段的 orders.json 照常纳入');
  ok(r.j.metrics.some((m) => m.label === '当日作业票' && m.value === 4), 'U11 带 meta.workshopScope 的 daily.json 照常读取（「测试」视同一致）');
  ok(r.j.metrics.some((m) => m.label === '设备完好率' && m.value === 92), 'U12 带 meta.workshopScope 的 periodic.json 照常读取');
  ok(/上游 JSON 车间核对：「ws-status\.json」、「ws-daily\.json」、「ws-periodic\.json」与「测试车间」一致，已纳入/.test(r.md), 'U13 口径写明一致纳入');
  r = run(args([ST_MINE, ORD_TOP].join(',')), 'ws-top');
  ok(!r.s.sources.some((x) => /ws-orders-top/.test(x)), 'U14 无 meta.workshop 时取顶层 workshop 核对');
  r = run(args(ORD_OT), 'ws-all-other');
  eq(r.s.ok, false, 'U15 上游 JSON 全部车间不一致时报错');
  ok(/车间与 --workshop 不一致未纳入/.test(r.s.error || ''), 'U16 报错写明因车间不一致未纳入');
  // 未给 --workshop：不核对、全部纳入；各 JSON 车间不一致时 warning
  r = run(['--input', [ST_MINE, ORD_OT].join(','), '--meeting', '设备例会', '--duration', '10', '--audience', '车间'], 'ws-none');
  ok(r.s.sources.some((x) => /ws-orders-other/.test(x)), 'U17 未给 --workshop 时不核对，照常纳入');
  eq(r.j.meta.upstreamWorkshop, null, 'U18 未给 --workshop 时 meta.upstreamWorkshop 为 null');
  ok(r.s.warnings.some((w) => w.startsWith('【注意】') && w.includes('车间不一致') && w.includes(OT)), 'U19 未给 --workshop 但上游 JSON 车间不一致时提示');
  ok(!/上游 JSON 车间核对/.test(r.md), 'U20 未给 --workshop 时口径处不写车间核对');
}
console.log(`\n${'='.repeat(56)}`);
console.log(`meeting-material-builder 自测：${pass} 通过，${fail} 失败`);
if (failures.length) { console.log('\n失败项：'); failures.forEach((f) => console.log('  ✗ ' + f)); }
console.log('='.repeat(56));
try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
