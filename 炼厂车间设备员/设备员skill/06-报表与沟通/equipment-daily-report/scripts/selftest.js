#!/usr/bin/env node
'use strict';
/** 自测：断言 daily.js 行为。用法：node scripts/selftest.js（全绿退出 0） */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { writeXlsx } = require('./lib/xlsx-lite');

const D = path.join(__dirname, 'daily.js');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'edr-selftest-'));
const DATE = '2026-09-21';
let pass = 0, fail = 0;
const failures = [];
const ok = (c, n) => { if (c) pass++; else { fail++; failures.push(n); } };
const eq = (a, e, n) => ok(a === e, `${n}（期望 ${JSON.stringify(e)}，实际 ${JSON.stringify(a)}）`);

function run(input, extra = [], tag) {
  const out = path.join(work, tag + '-out');
  const r = spawnSync(process.execPath, [D, '--input', input, '--workshop', '测试车间', '--date', DATE, '--out', out, ...extra], { encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  let s; try { s = JSON.parse(lines[lines.length - 1]); } catch (e) { s = { ok: false, error: 'no-json:' + r.stdout + r.stderr }; }
  let j = null, md = null;
  if (fs.existsSync(path.join(out, 'daily.json'))) j = JSON.parse(fs.readFileSync(path.join(out, 'daily.json'), 'utf8'));
  if (fs.existsSync(path.join(out, 'daily.md'))) md = fs.readFileSync(path.join(out, 'daily.md'), 'utf8');
  return { code: r.status, s, j, md, out };
}
const mk = (n, b) => { const p = path.join(work, n); writeXlsx(p, b); return p; };
const mkj = (n, o) => { const p = path.join(work, n); fs.writeFileSync(p, JSON.stringify(o, null, 2)); return p; };

// ============ A. 全量 xlsx ============
const FULL = mk('full.xlsx', {
  '巡检汇总': [['位号', '设备名称', '状态', '异常描述'],
    ['P-01', '泵1', '正常', ''], ['P-02', '泵2', '异常', '机封漏'], ['P-03', '泵3', '正常', '']],
  '缺陷台账': [['位号', '设备名称', '缺陷描述', '等级', '状态', '发现时间'],
    ['P-02', '泵2', '机封漏', 'II 级', '待处理', DATE],
    ['P-01', '泵1', '轴承温高', 'III 级', '处理中', '2026-09-18'],
    ['P-03', '泵3', '锈蚀', 'IV 级', '已闭环', '2026-09-10']],
  '工单台账': [['工单号', '位号', '缺陷描述', '状态', '要求完成时间', '责任人'],
    ['WO-01', 'P-02', '换机封', '施工中', '2026-09-19', '一队'],
    ['WO-02', 'P-01', '查轴承', '已派工', '2026-09-25', '一队'],
    ['WO-03', 'P-03', '除锈', '已闭环', '2026-09-12', '保运队']],
  '异常事件': [['时间', '位号', '事件描述', '影响', '处置措施', '状态'],
    [`${DATE} 03:20`, 'P-02', '泄漏增大切泵', '回流波动', '切备泵', '已闭环'],
    [`${DATE} 15:45`, 'P-01', '轴温报警', '降量', '通知检修', '处理中']],
  '检修进度': [['项目名称', '位号', '状态', '完成比例', '计划完成', '责任人'],
    ['换机封', 'P-02', '施工中', 60, '2026-09-22', '一队']],
});
let r = run(FULL, ['--shift', '乙班张工'], 'full');
eq(r.s.ok, true, 'A1 全量运行成功');
eq(r.s.counts.equipment, 3, 'A2 设备数');
eq(r.s.counts.abnormal, 1, 'A3 异常数');
eq(r.s.counts.newDefects, 1, 'A4 本日新增缺陷（按发现日期过滤）');
eq(r.s.counts.openDefects, 2, 'A5 未闭环缺陷');
eq(r.s.counts.overdueOrders, 1, 'A6 超期工单（要求完成早于日报日期且未闭环）');
eq(r.s.counts.openOrders, 2, 'A7 未闭环工单');
eq(r.s.counts.events, 2, 'A8 异常事件数');
eq(r.s.counts.unclosedEvents, 1, 'A9 未闭环事件数');
eq(r.s.counts.maintProjects, 1, 'A10 检修项目数');
ok(/值班：乙班张工/.test(r.md), 'A11 值班信息写入');
ok(r.s.sources.length === 5, 'A12 识别到 5 类数据源');

// ============ B. 缺数据不补零（核心） ============
const ONLY = mk('only.xlsx', { '巡检汇总': [['位号', '设备名称', '状态'], ['P-01', '泵1', '正常']] });
r = run(ONLY, [], 'only');
eq(r.s.ok, true, 'B1 单一数据源可运行');
eq(r.s.counts.newDefects, null, 'B2 无缺陷数据时为 null 不是 0');
eq(r.s.counts.overdueOrders, null, 'B3 无工单数据时为 null 不是 0');
eq(r.s.counts.events, null, 'B4 无事件数据时为 null 不是 0');
eq(r.s.counts.maintProjects, null, 'B5 无检修数据时为 null 不是 0');
ok(/本日未提供缺陷数据/.test(r.md), 'B6 md 写明未提供缺陷数据');
ok(/本日未提供工单数据/.test(r.md), 'B7 md 写明未提供工单数据');
ok(/本日未提供异常事件数据/.test(r.md), 'B8 md 写明未提供异常事件数据');
ok(/本日未提供检修进度数据/.test(r.md), 'B9 md 写明未提供检修进度数据');
ok(!/\| 新增缺陷 \| 0 \|/.test(r.md), 'B10 未出现 0 值伪装成真实数据');

// ============ C. 上游 JSON 对接 ============
const ST = mkj('status.json', {
  meta: { workshop: '测试车间', date: DATE }, counts: { equipment: 7, normal: 4, abnormal: 2, unknown: 1, missed: 2 },
  byEquipment: [{ tag: 'P-01', state: 'normal' }],
  abnormal: [{ tag: 'P-02', name: '泵2', desc: '机封漏', area: '一区', discipline: '动设备' },
    { tag: 'P-05', name: '泵5', desc: '振动高', area: '二区', discipline: '动设备' }],
});
r = run(ST, [], 'json-status');
eq(r.s.ok, true, 'C1 status.json 可识别');
eq(r.s.counts.equipment, 7, 'C2 从 JSON 读设备数');
eq(r.s.counts.abnormal, 2, 'C3 从 JSON 读异常数');
ok(/巡检汇总\(JSON\)/.test(r.s.sources[0]), 'C4 来源标注为 JSON');
ok(/P-05/.test(r.md), 'C5 异常清单渲染');
ok(r.j.status.missed === 2, 'C6 漏检数透传');

const ORD = mkj('orders.json', {
  counts: { total: 14, open: 9, overdue: 3, stalled: 3, closedInRange: 3, closedAll: 3 },
  metrics: { closeRate: 25, avgCycleDays: 5.5 },
  byStatus: { '施工中': 5 },
  overdue: [{ no: 'WO-01', tag: 'P-02', desc: '换机封', overdueDays: 5, owner: '一队' }],
});
r = run(ORD, [], 'json-orders');
eq(r.s.ok, true, 'C7 orders.json 可识别');
eq(r.s.counts.overdueOrders, 3, 'C8 从 JSON 读超期数');
ok(/25%/.test(r.md), 'C9 完成率渲染');
ok(/WO-01/.test(r.md), 'C10 超期工单清单渲染');

const DEF = mkj('defects.json', {
  counts: { total: 6, byLevel: { 'I 级（紧急）': 2, 'III 级（一般）': 3, '未判定': 1 } },
  defects: [{ no: 'QX-001', tag: 'P-02', name: '泵2', desc: '机封漏', levelCn: 'I 级（紧急）', dueDate: '2026-09-22' }],
  undetermined: [{ no: 'QX-006', tag: 'P-09' }],
});
r = run(DEF, [], 'json-defects');
eq(r.s.ok, true, 'C11 defects.json 可识别');
eq(r.s.counts.newDefects, 1, 'C12 从 JSON 读缺陷条数');
ok(/QX-001/.test(r.md), 'C13 缺陷清单渲染');

// 多 JSON 合并
r = run([ST, ORD, DEF].join(','), [], 'json-multi');
eq(r.s.ok, true, 'C14 多 JSON 合并成功');
eq(r.s.sources.length, 3, 'C15 三个来源都识别');
eq(r.s.counts.equipment, 7, 'C16 巡检数据来自 status.json');
eq(r.s.counts.overdueOrders, 3, 'C17 工单数据来自 orders.json');

// 无法识别的 JSON
const BAD = mkj('bad.json', { hello: 'world' });
r = run([ST, BAD].join(','), [], 'json-bad');
eq(r.s.ok, true, 'C18 无法识别的 JSON 不中断');
ok(r.j.warnings.some((w) => w.includes('无法识别')), 'C19 无法识别的 JSON 有 warning');

// hazard.json 进隐患章节（与 hazard-closure-tracker hazard-rules.md「本期隐患进日报」口径一致，不再忽略）
const HAZ = mkj('hazard.json', { majorHazards: [{ no: 'YH-1', desc: '可燃气报警器未投用', levelCn: '重大隐患', statusCn: '整改中', deadline: '2026-10-01' }], counts: { total: 3, overdue: 1, major: 1, closed: 1, inProgress: 1 }, metrics: { closureRate: 33.3 }, overdue: [{ no: 'YH-2', desc: '栏杆缺失', levelCn: '一般隐患', owner: '保运队', deadline: '2026-09-19', overdueDays: 2 }] });
r = run([ST, HAZ].join(','), [], 'json-hazard');
ok(!r.j.warnings.some((w) => w.includes('已忽略')), 'C20 隐患 JSON 不再被忽略');
ok(/隐患跟踪\(JSON\)/.test(r.s.sources[1]), 'C20a 隐患来源标注');
eq(r.s.counts.hazards, 3, 'C20b 隐患总数从 hazard.json 读取');
eq(r.s.counts.overdueHazards, 1, 'C20c 超期隐患数');
ok(/可燃气报警器未投用/.test(r.md) && /33\.3%/.test(r.md), 'C20d 重大隐患与闭环率渲染');

// ============ D. 完成比例异常值 ============
const PCT = mk('pct.xlsx', {
  '检修进度': [['项目名称', '位号', '状态', '完成比例', '计划完成', '责任人'],
    ['A', 'P-01', '施工中', 0.6, '2026-09-22', '一队'],
    ['B', 'P-02', '施工中', 150, '2026-09-23', '一队'],
    ['C', 'P-03', '施工中', -10, '2026-09-24', '一队'],
    ['D', 'P-04', '施工中', '快好了', '2026-09-25', '一队']],
});
r = run(PCT, [], 'pct');
eq(r.j.maintenance.list[0].percent, 60, 'D1 小数 0.6 转为 60%');
eq(r.j.maintenance.list[1].percent, null, 'D2 超出 100 置 null');
eq(r.j.maintenance.list[2].percent, null, 'D3 负数置 null');
eq(r.j.maintenance.list[3].percent, null, 'D4 无法解析置 null 不是 0');
ok(r.j.warnings.filter((w) => w.includes('超出 0~100')).length === 2, 'D5 越界各有 warning');
ok(r.j.warnings.some((w) => w.includes('无法解析')), 'D6 无法解析有 warning');
ok(/\| — \|/.test(r.md), 'D7 md 中 null 显示为 —');

// ============ E. 环比 ============
r = run(FULL, [], 'prev-src');
const prevPath = path.join(r.out, 'daily.json');
const FULL2 = mk('full2.xlsx', {
  '巡检汇总': [['位号', '设备名称', '状态', '异常描述'],
    ['P-01', '泵1', '异常', '漏'], ['P-02', '泵2', '异常', '漏'], ['P-03', '泵3', '异常', '漏']],
  '缺陷台账': [['位号', '设备名称', '缺陷描述', '等级', '状态', '发现时间'],
    ['P-02', '泵2', '机封漏', 'II 级', '待处理', DATE]],
  '工单台账': [['工单号', '位号', '缺陷描述', '状态', '要求完成时间', '责任人'],
    ['WO-01', 'P-02', '换机封', '施工中', '2026-09-19', '一队'],
    ['WO-04', 'P-01', 'x', '已派工', '2026-09-18', '一队']],
});
r = run(FULL2, ['--prev', prevPath], 'compare');
eq(r.s.ok, true, 'E1 带环比运行成功');
ok(r.j.compare !== null, 'E2 环比数据存在');
eq(r.j.compare.abnormal, 2, 'E3 异常设备环比 +2');
eq(r.j.compare.overdueOrders, 1, 'E4 超期工单环比 +1');
ok(/## 九、环比/.test(r.md), 'E5 环比章节存在（第九节）');
ok(/## 十、设备运行情况说明/.test(r.md) && /## 十一、次日计划/.test(r.md), 'E5a 有环比时共十一节');
ok(/\+2/.test(r.md), 'E6 环比正值带 + 号');

// 环比文件不存在 → 报错
r = run(FULL, ['--prev', '/不存在.json'], 'badprev');
eq(r.s.ok, false, 'E7 环比文件不存在时报错');
eq(r.code, 1, 'E8 退出码 1');

// ============ F. 次日计划不编造 ============
r = run(FULL, [], 'noplan');
ok(/次日计划由车间填写，本技能不代为拟定/.test(r.md), 'F1 无计划时明确不代拟');
r = run(FULL, ['--plan', '1. 完成 P-02 机封更换\n2. 复查 P-01 轴承温度'], 'withplan');
ok(/完成 P-02 机封更换/.test(r.md), 'F2 用户提供的计划原样写入');

// ============ G. 参数校验 ============
function raw(args) {
  const x = spawnSync(process.execPath, [D, ...args], { encoding: 'utf8' });
  const l = x.stdout.trim().split('\n');
  try { return { code: x.status, s: JSON.parse(l[l.length - 1]) }; } catch (e) { return { code: x.status, s: { ok: false } }; }
}
eq(raw([]).s.ok, false, 'G1 无参数报错');
eq(raw(['--input']).s.ok, false, 'G2 --input 缺值报错');
ok(/缺少取值/.test(raw(['--input']).s.error), 'G3 缺值信息正确');
eq(raw(['--input', FULL]).s.ok, false, 'G4 缺 --workshop 报错');
eq(raw(['--input', FULL, '--workshop', 'X']).s.ok, false, 'G5 缺 --date 报错');
eq(raw(['--input', FULL, '--workshop', 'X', '--date', '2026-13-45']).s.ok, false, 'G6 非法日期报错');
eq(raw(['--input', '/不存在.xlsx', '--workshop', 'X', '--date', DATE]).s.ok, false, 'G7 输入不存在报错');
eq(raw(['--input', FULL, '--workshop', 'X', '--date', DATE, '--未知', 'v']).s.ok, false, 'G8 未知参数报错');
const EMPTY = mk('empty.xlsx', { '无关表': [['a'], [1]] });
eq(raw(['--input', EMPTY, '--workshop', 'X', '--date', DATE]).s.ok, false, 'G9 无任何可用数据报错');
ok(/未在输入中识别到任何可用数据/.test(raw(['--input', EMPTY, '--workshop', 'X', '--date', DATE]).s.error), 'G10 错误信息明确');

// ============ H. 产出完整性 ============
r = run(FULL, [], 'outputs');
ok(fs.existsSync(path.join(r.out, 'daily.json')), 'H1 daily.json 生成');
ok(fs.existsSync(path.join(r.out, 'daily.md')), 'H2 daily.md 生成');
ok(fs.existsSync(path.join(r.out, 'summary.json')), 'H3 summary.json 生成');
ok(/## 一、设备状态概览/.test(r.md), 'H4 一节');
ok(/## 二、特护设备运行状况/.test(r.md), 'H5 二节 特护');
ok(/## 三、异常与缺陷/.test(r.md), 'H5a 三节');
ok(/## 四、工单执行/.test(r.md), 'H6 四节');
ok(/## 五、当日检修作业与作业票/.test(r.md) && /\*\*检修进度\*\*/.test(r.md), 'H7 五节 作业票含检修进度');
ok(/## 六、泄漏点/.test(r.md), 'H7a 六节');
ok(/## 七、隐患/.test(r.md), 'H7b 七节');
ok(/## 八、异常事件/.test(r.md), 'H8 八节');
ok(/## 九、设备运行情况说明/.test(r.md) && /## 十、次日计划/.test(r.md), 'H8a 无环比时共十节');
eq(r.s.sections, 10, 'H8b summary.sections=10');
ok(/本材料由脚本汇总、模型成文，仅供设备员复核参考/.test(r.md), 'H12 声明行写入');
ok(!/[\u2600-\u27BF\u{1F300}-\u{1FAFF}]/u.test(r.md), 'H13 产出无 emoji');
ok(/设备运行情况说明/.test(r.md), 'H9 情况说明节');
ok(/次日计划/.test(r.md), 'H10 次日计划节');
ok(/<!-- ANALYSIS_START -->/.test(r.md) && /<!-- ANALYSIS_END -->/.test(r.md), 'H11 分析段占位符');

// ============ I. 合计行与别名列头 ============
const ALIAS = mk('alias.xlsx', {
  '巡检汇总': [['某厂巡检汇总导出'], [],
    ['设备位号', '名称', '结论', '问题描述'],
    ['P-01', '泵1', '正常', ''], ['合计', '', '', '']],
});
r = run(ALIAS, [], 'alias');
eq(r.s.ok, true, 'I1 别名列头可读');
eq(r.s.counts.equipment, 1, 'I2 合计行被跳过');
ok(r.j.warnings.some((w) => w.includes('合计行')), 'I3 合计行 warning');

// ---- J. 状态归一与闭环判定（中石化口径：完工≠闭环；不合格≠合格；未关闭≠关闭）
const J = mk('closed.xlsx', {
  '巡检汇总': [['位号', '设备名称', '状态', '异常描述'], ['P-01', '泵1', '不合格', '漏'], ['P-02', '泵2', '无异常', ''], ['P-03', '泵3', '合格', '']],
  '缺陷台账': [['位号', '设备名称', '缺陷描述', '等级', '状态', '发现时间'],
    ['P-01', '泵1', '漏', 'C', '未关闭', DATE], ['P-02', '泵2', '响', 'C', '已完成', DATE], ['P-03', '泵3', '热', 'C', '已闭环', DATE]],
  '工单台账': [['工单号', '位号', '缺陷描述', '状态', '要求完成时间', '责任人'],
    ['GD-1', 'P-01', '漏', 'TECO', DATE, '王'], ['GD-2', 'P-02', '响', 'CLSD', DATE, '王'], ['GD-3', 'P-03', '热', '未关闭', DATE, '王'], ['GD-4', 'P-03', '热', '已取消', DATE, '王']],
  '异常事件': [['时间', '位号', '事件描述', '影响', '处置措施', '状态'], [`${DATE} 08:00`, 'P-01', '跳停', '无', '切备机', '未关闭'], [`${DATE} 09:00`, 'P-02', '漏', '无', '紧固', '关闭']],
});
r = run(J, [], 'closed');
eq(r.j.status.normal, 2, 'J1 不合格不计入正常，无异常计入正常');
eq(r.s.counts.abnormal, 1, 'J2 不合格计异常');
eq(r.s.counts.openDefects, 2, 'J3 未关闭 + 已完成（待验收）均未闭环');
eq(r.s.counts.openOrders, 2, 'J4 TECO（待验收）与未关闭为未闭环，CLSD 闭环，已取消不计');
eq(r.s.counts.unclosedEvents, 1, 'J5 事件「未关闭」未闭环、「关闭」已闭环');
eq(r.s.counts.pendingAcceptDefects, 1, 'J6 「已完成」缺陷单列待验收');
eq(r.s.counts.pendingAcceptOrders, 1, 'J7 TECO 工单单列待验收');
ok(/其中待验收 1 条（已完工、尚未验收关闭，不计入闭环）/.test(r.md), 'J8 md 待验收说明');
ok(/\| 其中待验收（完工未验收） \| 1 \|/.test(r.md), 'J9 工单表待验收行');

// ---- K. 设备状态六档
const K = mk('six.xlsx', {
  '巡检汇总': [['位号', '设备名称', '状态', '异常描述'],
    ['P-1', '泵1', '运行', ''], ['P-2', '泵2', '备用', ''], ['P-3', '泵3', '检修中', ''], ['P-4', '泵4', '封存', ''],
    ['P-5', '泵5', '异常', '漏'], ['P-6', '泵6', '', ''], ['P-7', '泵7', '无异常', ''], ['P-8', '泵8', 'standby', ''], ['P-9', '泵9', '停用', ''], ['P-10', '泵10', '待定', '']],
});
r = run(K, [], 'six');
eq(r.j.status.byState['运行'], 2, 'K1 运行=运行+无异常');
eq(r.j.status.byState['备用'], 2, 'K2 备用含 standby');
eq(r.j.status.byState['检修'], 1, 'K3 检修中');
eq(r.j.status.byState['停用'], 2, 'K4 停用含封存');
eq(r.j.status.byState['异常'], 1, 'K5 异常');
eq(r.j.status.byState['未判定'], 2, 'K6 空与无法归档为未判定，不计运行');
ok(/\| 备用 \| 2 \|/.test(r.md) && /\| 停用 \| 2 \|/.test(r.md), 'K7 六档进表');
ok(/【未判定】2 台/.test(r.md), 'K8 未判定提示行');
ok(!/\| 正常 \|/.test(r.md), 'K9 不再只分正常/异常');
ok(Array.isArray(r.j.meta.stateScheme) && r.j.meta.stateScheme.length === 6, 'K10 meta 记录六档');
r = run(ST, [], 'six-json');
eq(r.j.status.byState['备用'], null, 'K11 上游 status.json 无备用档 → null 不是 0');
ok(r.j.warnings.some((w) => w.includes('三档')), 'K12 三档来源有 warning');
ok(/\| 备用 \| —（未提供） \|/.test(r.md), 'K13 md 显示未提供');
// 新版 inspection-data-digest 的 status.json 带 counts.sixTier 与 byEquipment[].special：直接用六档、特护逐台
const ST6 = mkj('status6.json', {
  meta: { workshop: '测试车间', date: DATE }, counts: { equipment: 4, normal: 2, abnormal: 1, unknown: 0, missed: 0, special: 2, specialAbnormal: 1, sixTier: { 运行: 2, 备用: 1, 检修: 0, 停用: 0, 异常: 1, 未判定: 0 } },
  byEquipment: [{ tag: 'P-01', name: '泵1', special: true, state: 'abnormal', stateCn: '异常' }, { tag: 'K-01', name: '压缩机', special: true, state: 'normal', stateCn: '运行' },
    { tag: 'P-02', name: '泵2', special: false, state: 'normal', stateCn: '备用' }, { tag: 'P-03', name: '泵3', special: false, state: 'normal', stateCn: '运行' }],
  abnormal: [{ tag: 'P-01', name: '泵1', desc: '振动 7.3 报警' }],
});
r = run(ST6, [], 'six-json-tier');
eq(r.j.status.byState['备用'], 1, 'K14 status.json 带 counts.sixTier 时直接取六档');
ok(!r.j.warnings.some((w) => w.includes('三档')), 'K15 带六档时不再 warning');
eq(r.s.counts.specialEquipment, 2, 'K16 特护设备取 byEquipment[].special');
eq(r.s.counts.specialAbnormal, 1, 'K17 特护异常数');
ok(/P-01/.test((r.md.split('二、特护设备')[1] || '').split('## 三')[0]) && /振动 7\.3 报警/.test(r.md), 'K18 特护设备逐台列出，异常带描述');

// ---- L. 特护设备
const L1 = mk('special.xlsx', {
  '巡检汇总': [['位号', '设备名称', '状态', '异常描述', '重要度'], ['K-1', '压缩机', '运行', '', 'A/特护'], ['P-1', '泵', '运行', '', 'B']],
});
r = run(L1, [], 'special-insp');
eq(r.s.counts.specialEquipment, 1, 'L1 巡检汇总重要度含特护 → 特护节 1 台');
ok(/来源：巡检汇总（重要度含特护）/.test(r.md), 'L2 来源标注');
const L2 = mk('special2.xlsx', {
  '特护设备': [['位号', '设备名称', '状态', '运行参数', '备注'], ['K-1', '压缩机', '运行', '轴振 3.2mm/s', ''], ['K-2', '汽轮机', '异常', '轴位移报警', '已通知']],
});
r = run(L2, [], 'special-sheet');
eq(r.s.counts.specialEquipment, 2, 'L3 特护设备表 2 台');
eq(r.s.counts.specialAbnormal, 1, 'L4 特护异常 1 台');
ok(/轴振 3\.2mm\/s/.test(r.md), 'L5 运行参数原样列出');
r = run(ONLY, [], 'special-none');
eq(r.s.counts.specialEquipment, null, 'L6 无特护数据 → null');
ok(/本日未提供特护设备数据/.test(r.md), 'L7 md 写未提供');

// ---- M. 作业票
const M = mk('permit.xlsx', {
  '作业票': [['作业票编号', '作业类型', '动火级别', '作业区域', '施工单位', '属地监护人'],
    ['YH-1', '动火作业', '二级', '泵区', '一队', '王'], ['SX-1', '受限空间作业', '', '罐内', '二队', ''], ['GC-1', '高处作业', '一级', '罐顶', '二队', '李']],
});
r = run(M, [], 'permit');
eq(r.s.counts.permits, 3, 'M1 作业票 3 张（许可证编号别名「作业票编号」）');
eq(r.j.permits.byType['用火作业'], 1, 'M2 「动火作业」归一为「用火作业」');
eq(r.j.permits.noGuardian, 1, 'M3 属地监护人未填 1 张');
ok(/用火作业 1/.test(r.md) && !/动火作业/.test(r.md), 'M4 md 用「用火」不用「动火」');
ok(/级别以作业票为准，本技能不自判/.test(r.md), 'M5 不自判级别声明');
r = run(ONLY, [], 'permit-none');
ok(/本日未提供作业票数据/.test(r.md), 'M6 无作业票写未提供');

// ---- N. 泄漏点（JSON 与表）
const LK = mkj('leaks.json', { counts: { records: 10, leaks: 3, newLeaks: 1, open: 2, overdue: 1, repaired: 1, undetermined: 0 }, metrics: { repairRate: 33.3 },
  overdue: [{ no: 'LD-1', tag: 'E-1', comp: '法兰', owner: '二队', statusCn: '未修复', finalOverdueDays: 3 }], repaired: [{ no: 'LD-0' }] });
r = run(LK, [], 'leaks-json');
eq(r.s.ok, true, 'N1 leaks.json 可识别');
ok(/泄漏点跟踪\(JSON\)/.test(r.s.sources[0]), 'N2 来源标注');
eq(r.s.counts.openLeaks, 2, 'N3 未修复数');
eq(r.s.counts.overdueLeaks, 1, 'N4 超期数');
ok(/LD-1/.test(r.md) && /33\.3%/.test(r.md), 'N5 超期清单与修复率渲染');
const LK2 = mk('leaks.xlsx', { '泄漏点': [['漏点编号', '位号', '状态', '发现时间', '责任人', '整改期限'],
  ['LD-1', 'P-1', '未修复', DATE, '一队', '2026-09-30'], ['LD-2', 'P-2', '未修复', '2026-09-01', '一队', '2026-09-10'], ['LD-3', 'P-3', '已修复', '2026-09-01', '一队', '2026-09-10']] });
r = run(LK2, [], 'leaks-sheet');
eq(r.s.counts.openLeaks, 2, 'N6 表输入未修复 2');
eq(r.s.counts.overdueLeaks, 1, 'N7 表输入超期 1');
eq(r.j.leaks.newLeaks, 1, 'N8 本日新增 1');
eq(r.j.leaks.repairRate, null, 'N9 表输入不算修复率（由 leak-point-tracker 算）');
ok(/泄漏率（静\/动密封点）按月在周报月报核算/.test(r.md), 'N10 泄漏率归口说明');

// ---- O. 隐患（表输入：等级映射、无期限未判定）
const HZ = mk('hazard.xlsx', { '隐患台账': [['隐患描述', '隐患等级', '状态', '整改期限', '责任人'],
  ['报警器未投用', '重大隐患', '整改中', '2026-10-01', '仪表'], ['栏杆缺失', '一般隐患', '整改中', '2026-09-19', '保运'],
  ['地沟盖板缺失', 'B 级', '整改中', '', '车间'], ['通道占用', '一般', '已闭环', '2026-09-10', '车间']] });
r = run(HZ, [], 'hazard-sheet');
eq(r.s.counts.hazards, 4, 'O1 隐患 4 条');
eq(r.j.hazards.major, 1, 'O2 重大隐患 1');
eq(r.j.hazards.overdue, 1, 'O3 超期 1');
eq(r.j.hazards.undetermined, 1, 'O4 无整改期限 → 未判定，不默认天数');
ok(r.j.warnings.some((w) => w.includes('管理层级')), 'O5 「B 级」不映射并 warning');
ok(/以安全部门意见为准/.test(r.md) && /五定/.test(r.md), 'O6 隐患声明与五定');
ok(!/三定四不推/.test(r.md), 'O7 不出现旧口号');

// ---- P. SAP / 智能巡检导出列名（共享别名）；设备编号不是位号
const SAP = mk('sap.xlsx', {
  '巡检汇总': [['设备编号', '功能位置', '设备描述', '状态', 'ABC标识'], ['10000001', 'P-2101A', '进料泵A', '运行', 'A'], ['10000002', 'P-2102', '循环油泵', '不合格', 'B']],
  '工单台账': [['订单', '功能位置', '描述', '系统状态', '基本结束日期', '主工作中心'],
    ['4000123', 'P-2102', '异响检查', 'REL', '2026-09-19', '机泵班'], ['4000124', 'P-2101A', '换机封', 'TECO', '2026-09-20', '机泵班'], ['4000125', 'P-2101A', '过滤器', 'CLSD', '2026-09-18', '机泵班'], ['4000126', 'P-2101A', 'x', 'DLFL', '2026-09-18', '机泵班']],
  '缺陷台账': [['通知单', '功能位置', '设备描述', '通知单描述', '通知单状态', '通知日期'], ['10050001', 'P-2102', '循环油泵', '异响', 'OSNO', DATE], ['10050002', 'P-2101A', '进料泵A', '渗漏', 'NOCO', '2026-09-01']],
});
r = run(SAP, [], 'sap');
eq(r.s.ok, true, 'P1 SAP 列名可读');
eq(r.j.status.abnormalList[0].tag, 'P-2102', 'P2 位号取功能位置而非设备编号');
eq(r.j.status.abnormalList[0].name, '循环油泵', 'P3 设备名称取设备描述');
eq(r.s.counts.openOrders, 2, 'P4 REL+TECO 未闭环；CLSD 闭环；DLFL 不计');
eq(r.s.counts.pendingAcceptOrders, 1, 'P5 TECO 待验收');
eq(r.s.counts.overdueOrders, 2, 'P6 基本结束日期早于日报日期判超期');
eq(r.j.orders.overdueList[0].owner, '机泵班', 'P7 责任方取主工作中心');
eq(r.s.counts.newDefects, 1, 'P8 通知日期=日报日期计新增');
eq(r.s.counts.openDefects, 1, 'P9 OSNO 未闭环、NOCO 闭环');
eq(r.j.defects.newList[0].no, '10050001', 'P10 通知单号进表');
ok(/新增缺陷（维修通知单）/.test(r.md), 'P11 md 用「维修通知单」口径');

// ---- Q. HSE 平台隐患台账列名（整改状态 / 要求整改期限 / 等级 重大·一般 / 验收情况）与作业票系统「作业清单」
const HZ3 = mk('hse.xlsx', {
  '隐患台账': [['隐患编号', '隐患描述', '等级', '要求整改期限', '整改状态', '验收情况'],
    ['HZ-1', '减顶管线腐蚀减薄', '重大', '2026-09-18', '整改中', ''],
    ['HZ-2', '平台栏杆松动', '一般', '2026-10-30', '未整改', ''],
    ['HZ-3', '排气阀反复损坏', '一般', '2026-09-10', '已整改', '验收合格'],
    ['HZ-4', '地沟盖板缺失', '一般', '2026-09-15', '已整改', ''],
    ['HZ-5', '消防通道占用', '一般', '', '整改中', '']],
  '作业清单': [['许可证编号', '作业类别', '作业级别', '位号', '区域', '作业单位', '属地监护人', '状态'],
    ['YH-1', '用火作业', '二级', 'E-1201', '换热器区', '检修一队', '王属地', '作业中'], ['MB-1', '盲板抽堵作业', '—', 'E-1201', '换热器区', '检修一队', '', '作业中']],
});
r = run(HZ3, [], 'hse');
eq(r.s.counts.hazards, 5, 'Q1 HSE 隐患台账 5 条');
eq(r.s.counts.overdueHazards, 1, 'Q2 「要求整改期限」「整改状态」可识别：整改中且过期限判超期');
eq(r.j.hazards.major, 1, 'Q3 等级「重大」认作重大隐患');
eq(r.j.hazards.closed, 1, 'Q4 已整改且验收合格计已闭环');
eq(r.j.hazards.unverified, 1, 'Q5 已整改未验收单列，不计闭环、不判超期');
eq(r.j.hazards.undetermined, 1, 'Q6 无整改期限 → 未判定');
eq(r.j.hazards.inProgress, 1, 'Q7 整改中只计有期限未超期的，不与超期、未判定重复');
eq((r.j.hazards.overdueList[0] || {}).no, 'HZ-1', 'Q8 隐患编号进超期清单');
ok(/已整改未验收 \| 1/.test(r.md), 'Q9 md 列已整改未验收');
eq(r.s.counts.permits, 2, 'Q10 作业票系统「作业清单」表可识别');
eq(((r.j.permits || {}).list || [{}])[0].place, '换热器区', 'Q11 作业地点取「区域」列');

// ---- R. 直接读隐患台账：完成态 / 验收态词表与 hazard-closure-tracker 同口径；验收人、验收日期独立成列
const HZ4 = mk('hse-words.xlsx', {
  '隐患台账': [['隐患编号', '隐患描述', '等级', '要求整改期限', '整改状态', '验收情况'],
    ['H1', '栏杆缺失', '一般', '2026-09-01', '已销号', '合格'],
    ['H2', '盖板缺失', '一般', '2026-09-01', '已完成', '验收合格'],
    ['H3', '通道占用', '一般', '2026-09-01', '已整改', '验收未通过'],
    ['H4', '防护罩缺失', '一般', '2026-09-01', '已整改', '否'],
    ['H5', '标识缺失', '一般', '2026-09-01', '已处理', '合格']],
});
r = run(HZ4, [], 'hse-words');
eq(r.j.hazards.overdue, 0, 'R1 已销号/已完成/已处理 属完成态，过期也不判超期');
eq(r.j.hazards.closed, 3, 'R2 完成态 + 验收合格 计已闭环（与 hazard.js 同为 3）');
eq(r.j.hazards.unverified, 2, 'R3 「验收未通过」「否」不算验收通过，归已整改未验收');
const HZ5 = mk('hse-acceptor.xlsx', {
  '隐患台账': [['隐患编号', '隐患描述', '等级', '要求整改期限', '整改状态', '验收情况', '验收人', '验收日期'],
    ['H1', '栏杆缺失', '一般', '2026-09-01', '已整改', '', '张三', ''],
    ['H2', '盖板缺失', '一般', '2026-09-01', '已整改', '', '', '2026-09-05'],
    ['H3', '通道占用', '一般', '2026-09-01', '已整改', '不合格', '李四', '2026-09-05'],
    ['H4', '防护罩缺失', '一般', '2026-09-01', '已整改', '', '', ''],
    ['H5', '标识缺失', '一般', '2026-09-01', '未完成', '', '', ''],
    ['H6', '照明缺失', '一般', '2026-09-01', '部分完成', '', '', '']],
});
r = run(HZ5, [], 'hse-acceptor');
eq(r.j.hazards.closed, 2, 'R4 验收情况空但填了验收人或验收日期 → 有验收记录，计已闭环');
eq(r.j.hazards.unverified, 2, 'R5 验收情况「不合格」即使填了验收人/日期也不算通过；四项全空归未验收');
eq(r.j.hazards.overdue, 2, 'R6 「未完成」「部分完成」不因含「完成」误判完成态，过期判超期');
const HZ6 = mk('hse-negation.xlsx', {
  '隐患台账': [['隐患编号', '隐患描述', '等级', '要求整改期限', '整改状态', '验收情况'],
    ['N1', '栏杆缺失', '一般', '2026-09-01', '整改未完成', ''],
    ['N2', '盖板缺失', '一般', '2026-09-01', '暂未完成', ''],
    ['N3', '通道占用', '一般', '2026-09-01', '已整改未销号', ''],
    ['N4', '防护罩缺失', '一般', '2026-09-01', '尚未闭环', ''],
    ['N5', '标识缺失', '一般', '2026-09-01', '已闭环', '']],
});
r = run(HZ6, [], 'hse-negation');
eq(r.j.hazards.overdue, 3, 'R7 「整改未完成」「暂未完成」「尚未闭环」过期判超期（与 hazard.js 同口径）');
eq(r.j.hazards.unverified, 2, 'R8 「已整改未销号」「已闭环」无验收记录归已整改未验收，不计闭环（与 hazard.js 同口径）');
eq(r.j.hazards.closed, 0, 'R9 无验收记录不计已闭环');

// ---- S. 「检修作业清单」不是作业票；只认以「作业清单」开头或「作业票清单」
const D2 = path.join(work, 'd2'); fs.mkdirSync(D2, { recursive: true });
fs.writeFileSync(path.join(D2, '检修作业清单.csv'), '项目名称,位号,状态,完成比例,责任人\n更换机封,P-101A,施工中,60%,检修一队\n清洗换热器,E-201,未开始,0,检修二队\n');
r = run(D2, [], 'maint-list');
eq(r.s.counts.permits, null, 'S1 「检修作业清单」不被当成作业票');
eq(r.s.counts.maintProjects, 2, 'S2 「检修作业清单」仍按检修进度读取');
const D3 = mk('permit-list.xlsx', { '作业票清单': [['许可证编号', '作业类别', '属地监护人'], ['YH-9', '用火作业', '王']] });
r = run(D3, [], 'permit-list');
eq(r.s.counts.permits, 1, 'S3 「作业票清单」可识别为作业票');

// ---- T. 车间范围核对（D007）：表格带车间列时剔除其他车间的行；上游 JSON 车间不一致不纳入
const OTHER = '二车间';
const WS = mk('ws-mixed.xlsx', {
  '巡检汇总': [['位号', '设备名称', '状态', '异常描述', '车间'],
    ['P-01', '泵1', '运行', '', '测试车间'], ['P-02', '泵2', '异常', '漏', '测试'], ['P-03', '泵3', '运行', '', ''],
    ['P-91', '外泵1', '异常', '外车间漏', OTHER], ['P-92', '外泵2', '异常', '外车间漏', OTHER]],
  '特护设备': [['位号', '设备名称', '状态', '运行参数', '车间'], ['K-1', '压缩机', '运行', '', '测试车间'], ['K-9', '外压缩机', '异常', '', OTHER]],
  '缺陷台账': [['位号', '设备名称', '缺陷描述', '等级', '状态', '发现时间', '车间'],
    ['P-01', '泵1', '漏', 'II 级', '待处理', DATE, '测试车间'], ['P-91', '外泵1', '漏', 'II 级', '待处理', DATE, OTHER]],
  '工单台账': [['工单号', '位号', '缺陷描述', '状态', '要求完成时间', '责任人', '车间'],
    ['WO-1', 'P-01', '换机封', '施工中', '2026-09-19', '一队', '测试车间'], ['WO-9', 'P-91', '外车间', '施工中', '2026-09-19', '一队', OTHER]],
  '作业票': [['许可证编号', '作业类别', '属地监护人', '车间'], ['YH-1', '用火作业', '王', '测试车间'], ['YH-9', '用火作业', '李', OTHER]],
  '泄漏点': [['密封点编号', '位号', '状态', '发现时间', '整改期限', '车间'],
    ['LD-1', 'P-01', '未修复', DATE, '2026-09-30', '测试车间'], ['LD-9', 'P-91', '未修复', DATE, '2026-09-30', OTHER]],
  '隐患台账': [['隐患编号', '隐患描述', '等级', '整改期限', '整改状态', '车间'],
    ['H1', '栏杆缺失', '一般', '2026-09-30', '整改中', '测试车间'], ['H9', '外车间隐患', '一般', '2026-09-30', '整改中', OTHER]],
  '异常事件': [['时间', '位号', '事件描述', '状态', '车间'], [`${DATE} 08:00`, 'P-01', '跳停', '处理中', '测试车间'], [`${DATE} 09:00`, 'P-91', '外车间跳停', '处理中', OTHER]],
  '检修进度': [['项目名称', '位号', '状态', '完成比例', '车间'], ['换机封', 'P-01', '施工中', 50, '测试车间'], ['外车间项目', 'P-91', '施工中', 50, OTHER]],
});
r = run(WS, [], 'ws-mixed');
const sc = (name) => (r.j.meta.workshopScope || []).find((x) => x.sheet.endsWith('/' + name)) || {};
eq(r.s.ok, true, 'T1 两车间混合输入可运行');
eq(r.s.counts.equipment, 3, 'T2 巡检汇总只保留本车间（含「测试」写法与车间列为空的行），剔除二车间 2 行');
eq(r.s.counts.abnormal, 1, 'T3 异常数只含本车间');
ok(!/P-91/.test(r.md), 'T4 其他车间设备不出现在日报');
ok(r.j.warnings.some((w) => w.includes('巡检汇总') && w.includes('剔除其他车间 2 行') && w.includes(OTHER)), 'T5 剔除行数与车间名写进 warning');
eq(sc('巡检汇总').status, 'checked', 'T6 meta.workshopScope 记录巡检汇总已核对');
eq(sc('巡检汇总').droppedRows, 2, 'T7 meta.workshopScope 记剔除行数');
eq((sc('巡检汇总').dropped || {})[OTHER], 2, 'T8 meta.workshopScope 记剔除车间名');
eq(sc('巡检汇总').blank, 1, 'T9 车间列为空的行保留并计数');
ok(r.j.warnings.some((w) => w.includes('巡检汇总') && w.includes('车间列为空 1 行')), 'T10 车间列为空有 warning');
ok(/车间范围：已按车间列核对「测试车间」/.test(r.md) && /「ws-mixed\.xlsx\/巡检汇总」2 行（二车间 2 行）/.test(r.md), 'T11 md 口径处写明剔除情况');
ok(!/【注意】/.test(r.md.split('## 一、')[0]), 'T12 部分剔除时开头不加【注意】');
eq(r.s.counts.specialEquipment, 1, 'T13 特护设备表剔除其他车间');
eq(r.s.counts.newDefects, 1, 'T14 缺陷台账剔除其他车间');
eq(r.s.counts.openOrders, 1, 'T15 工单台账剔除其他车间');
eq(r.s.counts.permits, 1, 'T16 作业票剔除其他车间');
eq(r.s.counts.openLeaks, 1, 'T17 泄漏点剔除其他车间');
eq(r.s.counts.hazards, 1, 'T18 隐患台账剔除其他车间');
eq(r.s.counts.events, 1, 'T19 异常事件剔除其他车间');
eq(r.s.counts.maintProjects, 1, 'T20 检修进度剔除其他车间');
eq((r.j.meta.workshopScope || []).length, 9, 'T21 九张主表各自核对');
// 车间列全不一致：不筛，warning 与 md 开头【注意】
const WSX = mk('ws-mismatch.xlsx', { '巡检汇总': [['位号', '设备名称', '状态', '车间'], ['P-91', '外泵1', '运行', OTHER], ['P-92', '外泵2', '异常', OTHER]] });
r = run(WSX, [], 'ws-mismatch');
eq(r.s.counts.equipment, 2, 'T22 车间列全不一致时不筛');
eq(sc('巡检汇总').status, 'mismatch', 'T23 meta.workshopScope 记 mismatch');
ok(r.j.warnings.some((w) => w.startsWith('【注意】') && w.includes(OTHER)), 'T24 warning 以【注意】开头');
ok(/【注意】.*车间列取值与 --workshop「测试车间」不一致，未按车间筛选，请核对输入/.test(r.md.split('## 一、')[0]), 'T25 md 标题后、第一节前有【注意】');
// 无车间列：不筛，口径写「以取数条件为准」
r = run(ONLY, [], 'ws-nocol');
eq(sc('巡检汇总').status, 'noColumn', 'T26 无车间列 status=noColumn');
ok(/车间范围：输入未含车间列，车间范围以取数条件为准。/.test(r.md), 'T27 md 口径写明以取数条件为准');
// 维护工厂不是车间列
const WSF = mk('ws-plant.xlsx', { '巡检汇总': [['位号', '设备名称', '状态', '维护工厂'], ['P-01', '泵1', '运行', '1100'], ['P-02', '泵2', '运行', '1200']] });
r = run(WSF, [], 'ws-plant');
eq(sc('巡检汇总').status, 'noColumn', 'T28 「维护工厂」列不当车间列');
eq(r.s.counts.equipment, 2, 'T29 维护工厂列不参与筛选');
// 「所属车间」可识别；「车间监护人」不当车间列，也不抢属地监护人的列
const WSO = mk('ws-alias.xlsx', {
  '巡检汇总': [['位号', '设备名称', '状态', '所属车间'], ['P-01', '泵1', '运行', '测试车间'], ['P-91', '外泵', '运行', OTHER]],
  '作业票': [['许可证编号', '作业类别', '车间监护人'], ['YH-1', '用火作业', '王']],
});
r = run(WSO, [], 'ws-alias');
eq(sc('巡检汇总').column, '所属车间', 'T30 「所属车间」列认作车间列');
eq(r.s.counts.equipment, 1, 'T31 按「所属车间」剔除其他车间');
eq(r.j.permits.noGuardian, 0, 'T32 加车间列后「车间监护人」仍归属地监护人');
eq(sc('作业票').status, 'noColumn', 'T33 「车间监护人」不当车间列');
const WSG = mk('ws-guard.xlsx', { '作业票': [['许可证编号', '作业类别', '属地监护人', '车间监护人'], ['YH-1', '用火作业', '王', '李']] });
r = run(WSG, [], 'ws-guard');
eq(sc('作业票').status, 'noColumn', 'T34 属地监护人与车间监护人并存时，车间监护人不当车间列');
ok(!/【注意】/.test(r.md), 'T35 人员列不触发车间不一致提示');
// 上游 JSON：一致纳入、不一致不纳入、未注明照常纳入并说明；新增的 meta.workshopScope 不影响读取
const STO = mkj('status-other.json', { meta: { workshop: OTHER, date: DATE }, counts: { equipment: 9, normal: 9, abnormal: 0, unknown: 0 }, byEquipment: [], abnormal: [] });
r = run([STO, ORD].join(','), [], 'ws-json-mismatch');
eq(r.s.ok, true, 'T36 上游 JSON 车间不一致时仍可运行');
eq(r.s.counts.equipment, null, 'T37 车间不一致的 status.json 不纳入');
ok(!r.s.sources.some((x) => x.includes('status-other')), 'T38 不纳入的 JSON 不进数据来源');
ok(r.j.warnings.some((w) => w.includes('status-other.json') && w.includes(OTHER) && w.includes('测试车间')), 'T39 warning 写明文件名与两个车间名');
eq((((r.j.meta.upstreamWorkshop || {}).excluded || [])[0] || {}).file, 'status-other.json', 'T40 meta.upstreamWorkshop 记不纳入的来源');
ok(/【注意】上游 JSON「status-other\.json」的车间「二车间」/.test(r.md.split('## 一、')[0]), 'T41 md 开头提示有上游 JSON 未纳入');
ok(/上游 JSON 未注明车间，无法核对（「orders\.json」）/.test(r.md), 'T42 无车间字段的 JSON 照常纳入并在口径处说明');
eq(r.s.counts.overdueOrders, 3, 'T43 无车间字段的 orders.json 照常纳入');
const STW = mkj('status-ws.json', { meta: { workshop: '测试', date: DATE, workshopScope: [{ sheet: 'x/巡检记录', status: 'checked', droppedRows: 1 }] }, counts: { equipment: 5, normal: 5, abnormal: 0, unknown: 0 }, byEquipment: [], abnormal: [] });
r = run(STW, [], 'ws-json-scope');
eq(r.s.counts.equipment, 5, 'T44 带 meta.workshopScope 的上游 JSON 正常读取（车间写法「测试」视同一致）');
ok(/「status-ws\.json」与「测试车间」一致，已纳入/.test(r.md), 'T45 口径写明一致纳入');
const STT = mkj('status-top.json', { workshop: OTHER, counts: { equipment: 5, normal: 5, abnormal: 0, unknown: 0 }, byEquipment: [], abnormal: [] });
r = run([STT, ORD].join(','), [], 'ws-json-top');
eq(r.s.counts.equipment, null, 'T46 无 meta.workshop 时取顶层 workshop 核对');
// --prev 上一日 daily.json 车间不一致：不做环比
r = run(WS, [], 'ws-prev-src');
const wsPrev = JSON.parse(fs.readFileSync(path.join(r.out, 'daily.json'), 'utf8'));
ok(Array.isArray(wsPrev.meta.workshopScope), 'T47 daily.json 输出 meta.workshopScope 数组');
wsPrev.meta.workshop = OTHER;
const wsPrevPath = mkj('prev-other.json', wsPrev);
r = run(FULL, ['--prev', wsPrevPath], 'ws-prev');
eq(r.j.compare, null, 'T48 上一日 daily.json 车间不一致不做环比');
ok(r.j.warnings.some((w) => w.includes('prev-other.json') && w.includes('不一致')), 'T49 上一日车间不一致有 warning');

console.log(`\n${'='.repeat(56)}`);
console.log(`equipment-daily-report 自测：${pass} 通过，${fail} 失败`);
if (failures.length) { console.log('\n失败项：'); failures.forEach((f) => console.log('  ✗ ' + f)); }
console.log('='.repeat(56));
try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
