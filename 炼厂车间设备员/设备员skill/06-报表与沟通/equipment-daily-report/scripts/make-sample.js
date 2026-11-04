#!/usr/bin/env node
'use strict';
/**
 * 生成设备日报样例输入（可再生）。用法：node scripts/make-sample.js --out <dir> [--seed <n>] [--date <YYYY-MM-DD>]
 * 主样例恒为：10 台设备（运行 5 / 备用 1 / 检修 1 / 停用 1 / 异常 2 / 未判定 0，特护 1 台）、3 条新增缺陷、5 条未闭环缺陷（1 待验收）、
 *             6 张工单（2 超期、1 待验收）、4 张作业票、3 个泄漏点（1 超期）、3 条隐患（1 重大、1 超期）、2 条异常事件（1 未闭环）、3 个检修项目。
 * 另产出：sample-sap-export.xlsx（SAP PM / 智能巡检导出列名）、sample-inspection-only.xlsx、sample-bad-percent.xlsx、
 *         upstream/{status,orders,defects,leaks,hazard}.json（上游技能 JSON 样例，使案例 3 可跑）。
 */
const fs = require('fs');
const path = require('path');
const { writeXlsx } = require('./lib/xlsx-lite');
const C = require('./lib/common');

const a = C.parseArgs(process.argv.slice(2), ['out', 'seed', 'date'], []);
// 默认输出到演示样例目录：仓库内在 炼厂车间设备员/演示case/<分类>/<技能>/，开发包内在技能目录 examples/
const skillsRoot = path.resolve(__dirname, '../../..');
const caseDir = path.basename(skillsRoot) === '设备员skill' ? path.join(skillsRoot, '..', '演示case', path.relative(skillsRoot, path.resolve(__dirname, '..'))) : path.join(__dirname, '..', 'examples');
const out = a.out || caseDir;
const date = a.date || '2026-09-21';
const yest = C.addDays(date, -1);
const seed = a.seed ? Number(a.seed) : 1;
let s = seed * 7919 + 13;
const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pct = (lo, hi) => Math.round(lo + rnd() * (hi - lo));
const temp = (lo, hi) => `${pct(lo, hi)}℃`;

fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(path.join(out, 'upstream'), { recursive: true });

writeXlsx(path.join(out, `sample-daily-source-${date}.xlsx`), {
  '巡检汇总': [
    ['位号', '设备名称', '状态', '异常描述', '重要度', '运行参数'],
    ['P-1101A', '常压塔顶回流泵A', '运行', '', 'B', ''],
    ['P-1101B', '常压塔顶回流泵B', '异常', '机封滴漏', 'B', ''],
    ['P-1102A', '常压渣油泵A', '正常', '', 'B', ''],
    ['P-1102B', '常压渣油泵B', '备用', '', 'B', ''],
    ['E-1201', '原油换热器', '无异常', '', 'C', ''],
    ['V-1301', '原油缓冲罐', '检修', '保温修复中', 'C', ''],
    ['C-1401', '常压塔', '正常', '', 'A', ''],
    ['M-1501', '鼓风机电机', '异常', '电流偏高', 'B', ''],
    ['K-1601', '富气压缩机', '运行', '', 'A/特护', `轴振 ${(2 + rnd() * 2).toFixed(1)}mm/s，轴承温 ${temp(55, 68)}`],
    ['P-1701', '旧原油泵', '停用', '', 'C', ''],
  ],
  '缺陷台账': [
    ['通知单号', '位号', '设备名称', '缺陷描述', '等级', '状态', '发现时间'],
    ['10045001', 'P-1101B', '常压塔顶回流泵B', '机封滴漏约5滴/分', 'B 级（严重）', '待处理', date],
    ['10045002', 'M-1501', '鼓风机电机', '运行电流较额定偏高', 'C 级（一般）', '待处理', date],
    ['10045003', 'E-1201', '原油换热器', '封头法兰渗漏', 'C 级（一般）', '待处理', date],
    ['10044990', 'P-1102A', '常压渣油泵A', '轴承温度偏高', 'C 级（一般）', '处理中', yest],
    ['10044980', 'V-1301', '原油缓冲罐', '保温层破损', 'C 级（一般）', '已完成', C.addDays(date, -5)],
    ['10044970', 'C-1401', '常压塔', '平台栏杆锈蚀', 'C 级（一般）', '已闭环', C.addDays(date, -10)],
  ],
  '工单台账': [
    ['工单号', '位号', '缺陷描述', '状态', '要求完成时间', '责任人'],
    ['WO-2609001', 'P-1101B', '更换机械密封', '施工中', date, '检修一队'],
    ['WO-2609002', 'P-1102A', '检查轴承', '待验收', yest, '检修一队'],
    ['WO-2609003', 'V-1301', '保温修复', '已派工', C.addDays(date, -3), '保运队'],
    ['WO-2609004', 'E-1201', '法兰紧固', '待审核', C.addDays(date, 2), '检修二队'],
    ['WO-2609005', 'C-1401', '栏杆除锈刷漆', '已闭环', C.addDays(date, -8), '保运队'],
    ['WO-2609006', 'M-1501', '电机电流检测', '已派工', C.addDays(date, 1), '电气班'],
  ],
  '作业票': [
    ['许可证编号', '作业类别', '作业级别', '作业地点', '位号', '作业单位', '属地监护人', '状态'],
    [`YH-${date.replace(/-/g, '')}-01`, '用火作业', '二级', '常压塔顶泵区', 'P-1101B', '检修一队', '王属地', '作业中'],
    [`SX-${date.replace(/-/g, '')}-02`, '受限空间作业', '—', '原油缓冲罐内', 'V-1301', '保运队', '李属地', '作业中'],
    [`GC-${date.replace(/-/g, '')}-03`, '高处作业', '一级', '缓冲罐顶', 'V-1301', '保运队', '', '已关闭'],
    [`LD-${date.replace(/-/g, '')}-04`, '临时用电作业', '—', '泵区配电', 'M-1501', '电气班', '张属地', '作业中'],
  ],
  '泄漏点': [
    ['密封点编号', '位号', '状态', '发现时间', '责任人', '整改期限'],
    ['LD-0901', 'P-1101B', '未修复', date, '检修一队', C.addDays(date, 7)],
    ['LD-0875', 'E-1201', '未修复', C.addDays(date, -20), '检修二队', C.addDays(date, -3)],
    ['LD-0860', 'V-1301', '已修复', C.addDays(date, -15), '保运队', C.addDays(date, -5)],
  ],
  '隐患台账': [
    ['隐患描述', '隐患等级', '状态', '整改期限', '责任人', '位号'],
    ['压缩机厂房可燃气报警器未投用', '重大隐患', '整改中', C.addDays(date, 10), '仪表班', 'K-1601'],
    ['泵区平台栏杆缺失一段', '一般隐患', '整改中', C.addDays(date, -2), '保运队', 'P-1101A'],
    ['消防通道被临时堆放物占用', '一般隐患', '已闭环', C.addDays(date, -4), '车间', ''],
  ],
  '异常事件': [
    ['时间', '位号', '事件描述', '影响', '处置措施', '状态'],
    [`${date} 03:20`, 'P-1101B', '机封泄漏量增大，切换至备泵', '短时塔顶回流波动', '切至 P-1101A 运行，B 泵停运待修', '已闭环'],
    [`${date} 15:45`, 'M-1501', '鼓风机电机电流冲高报警', '加热炉风量短时下降', '降负荷运行，通知电气检查', '处理中'],
  ],
  '检修进度': [
    ['项目名称', '位号', '状态', '完成比例', '计划完成', '责任人'],
    ['回流泵B机封更换', 'P-1101B', '施工中', pct(50, 75), C.addDays(date, 1), '检修一队'],
    ['缓冲罐保温修复', 'V-1301', '施工中', pct(20, 45), C.addDays(date, 3), '保运队'],
    ['换热器法兰紧固', 'E-1201', '未开工', 0, C.addDays(date, 5), '检修二队'],
  ],
});

// 变体：SAP PM / 智能巡检导出列名（功能位置、设备描述、系统状态、基本结束日期、主工作中心、通知单）
writeXlsx(path.join(out, 'sample-sap-export.xlsx'), {
  '巡检汇总': [
    ['功能位置', '设备描述', '状态', '异常描述', 'ABC标识'],
    ['P-2101A', '加氢进料泵A', '运行', '', 'A'],
    ['P-2101B', '加氢进料泵B', '备用', '', 'A'],
    ['K-2201', '循环氢压缩机', '运行', '', 'A/特护'],
    ['P-2102', '循环油泵', '不合格', '异响', 'B'],
  ],
  '工单台账': [
    ['订单', '功能位置', '描述', '系统状态', '基本结束日期', '主工作中心'],
    ['4000123', 'P-2102', '循环油泵异响检查', 'REL', C.addDays(date, -2), '机泵班'],
    ['4000124', 'P-2101A', '更换机封', 'TECO', C.addDays(date, -1), '机泵班'],
    ['4000125', 'K-2201', '压缩机润滑油过滤器切换', 'CLSD', C.addDays(date, -3), '机泵班'],
    ['4000126', 'P-2101B', '备泵盘车', 'CRTD', C.addDays(date, 3), '机泵班'],
  ],
  '缺陷台账': [
    ['通知单', '功能位置', '设备描述', '通知单描述', '等级', '通知单状态', '通知日期'],
    ['10050001', 'P-2102', '循环油泵', '运行异响', 'B', 'OSNO', date],
    ['10050002', 'P-2101A', '加氢进料泵A', '机封渗漏', 'C', 'NOCO', C.addDays(date, -4)],
  ],
});

// 变体：只有巡检汇总，其余章节应写「本日未提供 XX 数据」
writeXlsx(path.join(out, 'sample-inspection-only.xlsx'), {
  '巡检汇总': [
    ['位号', '设备名称', '状态', '异常描述'],
    ['P-2101', '加氢进料泵', '正常', ''],
    ['P-2102', '循环油泵', '异常', '异响'],
  ],
});

// 变体：完成比例异常（负数、超 100、小数形式、无法解析）
writeXlsx(path.join(out, 'sample-bad-percent.xlsx'), {
  '检修进度': [
    ['项目名称', '位号', '状态', '完成比例', '计划完成', '责任人'],
    ['项目A', 'P-01', '施工中', 0.6, C.addDays(date, 1), '一队'],
    ['项目B', 'P-02', '施工中', 150, C.addDays(date, 2), '一队'],
    ['项目C', 'P-03', '施工中', -10, C.addDays(date, 3), '一队'],
    ['项目D', 'P-04', '施工中', '快好了', C.addDays(date, 4), '一队'],
  ],
});

// ---- 上游技能 JSON 样例（字段按各技能产出的特征字段裁剪，数字与主样例一致口径，便于案例 3 链式运行）
const wj = (n, o) => fs.writeFileSync(path.join(out, 'upstream', n), JSON.stringify(o, null, 2), 'utf8');
wj('status.json', {
  meta: { workshop: '常减压车间', date, skill: 'inspection-data-digest' },
  counts: { equipment: 10, normal: 7, abnormal: 2, unknown: 1, missed: 1 },
  byEquipment: [{ tag: 'P-1101A', state: 'normal' }, { tag: 'P-1101B', state: 'abnormal' }, { tag: 'M-1501', state: 'abnormal' }, { tag: 'K-1601', state: 'normal' }],
  abnormal: [
    { tag: 'P-1101B', name: '常压塔顶回流泵B', desc: '机封滴漏', area: '泵区', discipline: '动设备' },
    { tag: 'M-1501', name: '鼓风机电机', desc: '电流偏高', area: '炉区', discipline: '电气' },
  ],
  missed: [{ tag: 'P-1701' }],
});
wj('orders.json', {
  meta: { workshop: '常减压车间', date, skill: 'work-order-tracker' },
  counts: { total: 6, open: 4, overdue: 2, stalled: 1, closedInRange: 1, closedAll: 1, pendingAccept: 1 },
  metrics: { closeRate: 16.7, avgCycleDays: 4.5 },
  byStatus: { '施工中': 1, '待验收': 1, '已派工': 2, '待审核': 1, '已闭环': 1 },
  overdue: [
    { no: 'WO-2609002', tag: 'P-1102A', desc: '检查轴承', overdueDays: 1, owner: '检修一队' },
    { no: 'WO-2609003', tag: 'V-1301', desc: '保温修复', overdueDays: 3, owner: '保运队' },
  ],
  stalled: [{ no: 'WO-2609004', tag: 'E-1201' }],
});
wj('defects.json', {
  meta: { workshop: '常减压车间', date, skill: 'defect-intake-grading' },
  counts: { total: 3, byLevel: { 'B 级（严重）': 1, 'C 级（一般）': 2 } },
  defects: [
    { no: '10045001', tag: 'P-1101B', name: '常压塔顶回流泵B', desc: '机封滴漏约5滴/分', level: 'B', levelCn: 'B 级（严重）', dueDate: C.addDays(date, 3) },
    { no: '10045002', tag: 'M-1501', name: '鼓风机电机', desc: '运行电流较额定偏高', level: 'C', levelCn: 'C 级（一般）', dueDate: C.addDays(date, 7) },
    { no: '10045003', tag: 'E-1201', name: '原油换热器', desc: '封头法兰渗漏', level: 'C', levelCn: 'C 级（一般）', dueDate: C.addDays(date, 7) },
  ],
  undetermined: [],
});
wj('leaks.json', {
  meta: { workshop: '常减压车间', date, skill: 'leak-point-tracker' },
  counts: { records: 12, leaks: 3, newLeaks: 1, open: 2, overdue: 1, repaired: 1, undetermined: 0, noLeak: 9 },
  metrics: { repairRate: 33.3, avgRepairDays: 10 },
  newLeaks: [{ no: 'LD-0901', tag: 'P-1101B', comp: '机封' }],
  open: [{ no: 'LD-0901', tag: 'P-1101B', comp: '机封', owner: '检修一队', statusCn: '未修复' }, { no: 'LD-0875', tag: 'E-1201', comp: '法兰', owner: '检修二队', statusCn: '未修复' }],
  overdue: [{ no: 'LD-0875', tag: 'E-1201', comp: '法兰', owner: '检修二队', statusCn: '未修复', finalOverdueDays: 3 }],
  repaired: [{ no: 'LD-0860', tag: 'V-1301', comp: '阀门填料' }],
  undetermined: [],
});
wj('hazard.json', {
  meta: { workshop: '常减压车间', date, skill: 'hazard-closure-tracker' },
  counts: { total: 3, overdue: 1, dueSoon: 0, inProgress: 1, closed: 1, unverified: 0, undetermined: 0, major: 1, conflicts: 0 },
  metrics: { closureRate: 33.3, avgClosureDays: null, byLevel: { major: 1, general: 2 } },
  overdue: [{ no: 'YH-003', desc: '泵区平台栏杆缺失一段', level: 'general', levelCn: '一般隐患', owner: '保运队', deadline: C.addDays(date, -2), overdueDays: 2 }],
  majorHazards: [{ no: 'YH-001', desc: '压缩机厂房可燃气报警器未投用', level: 'major', levelCn: '重大隐患', statusCn: '整改中', deadline: C.addDays(date, 10) }],
  dueSoon: [], inProgress: [], closed: [], unverified: [], undetermined: [], conflicts: [],
});

console.log(JSON.stringify({ ok: true, out, date, seed, files: fs.readdirSync(out).filter((f) => f.endsWith('.xlsx')), upstream: fs.readdirSync(path.join(out, 'upstream')) }));
