#!/usr/bin/env node
'use strict';
/**
 * 生成待办汇集样例输入（可再生）。用法：node scripts/make-sample.js --out <dir> [--seed <n>] [--date <YYYY-MM-DD>]
 * 全量输入（6 个上游 JSON + 待办表 + 文字待办，共 8 个可识别来源；另 1 个无法识别 JSON）恒为：
 * 待办 23 项 —— 逾期 8、今日到期 2、前瞻期内 7、无到期日 6，疑似重复 3 组。
 * 另生成：shift-handover-record 的 handover.json（meta.skill 约定，pending 3 条：1 期限已过 / 1 近期 / 1 无期限）、
 *         SAP/EM 导出风格待办表（工作事项/要求完成日期/紧急程度/功能位置/工单号，含 SAP 1~4、A 级与旧 II 级写法）。
 * seed 改变逾期天数等数值细节，但不改变上述结论。
 */
const fs = require('fs');
const path = require('path');
const { writeXlsx } = require('./lib/xlsx-lite');
const C = require('./lib/common');

const a = C.parseArgs(process.argv.slice(2), ['out', 'seed', 'date'], []);
const out = a.out || path.join(__dirname, '..', 'examples');
const date = a.date || '2026-09-21';
const seed = a.seed ? Number(a.seed) : 1;
let s = seed * 7919 + 13;
const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
/** 在 [lo,hi] 内抖动，保证仍落在同一分桶 */
const pick = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const D = (n) => C.addDays(date, n);

fs.mkdirSync(out, { recursive: true });

// ---- 1. 工单跟踪 orders.json（2 超期、1 停滞、1 临期）
const orders = {
  meta: { workshop: '常减压车间', date, generatedAt: C.localDateTime() },
  counts: { total: 12, overdue: 2, stalled: 1, dueSoon: 1, closedAll: 8 },
  byStatus: [{ status: '派工中', count: 3 }],
  metrics: { closeRate: 66.7 },
  overdue: [
    { no: 'WO-26090012', tag: 'P-1101B', name: '常压塔顶回流泵B', fault: '机封滴漏', status: '维修中',
      priority: '高', dueAt: D(-pick(5, 8)), dueBasis: '台账要求完成时间', overdueDays: pick(5, 8),
      party: '钳工班 / 李维修', owner: '李维修', reason: '备件未到', source: '工单台账 第12行' },
    { no: 'WO-26090007', tag: 'E-1201', name: '原油换热器', fault: '法兰渗漏', status: '待派工',
      priority: '中', dueAt: D(-pick(2, 4)), dueBasis: '台账要求完成时间', overdueDays: pick(2, 4),
      party: '外委 / 甲乙丙公司', owner: '', reason: '原因未记录', source: '工单台账 第7行' },
  ],
  stalled: [
    { no: 'WO-26082033', tag: 'K-1501', name: '循环氢压缩机', status: '维修中', priority: '中',
      lastNode: '开工时间', lastTime: D(-pick(14, 20)) + ' 09:00', idleDays: pick(14, 20),
      party: '钳工班 / 王工', owner: '王工', reason: '等待厂家技术支持', source: '工单台账 第33行' },
  ],
  dueSoon: [
    { no: 'WO-26090021', tag: 'V-1301', name: '原油缓冲罐', status: '维修中', priority: '中',
      dueAt: D(2), daysLeft: 2, party: '铆焊班 / 赵工', owner: '赵工', source: '工单台账 第21行' },
  ],
  closed: [], stallUndetermined: [], unknownStatus: [], groups: [], warnings: [],
};
fs.writeFileSync(path.join(out, 'sample-orders.json'), JSON.stringify(orders, null, 2), 'utf8');

// ---- 2. 隐患整改 hazard.json（1 超期重大、1 临期、1 已整改未验收）
const hazard = {
  meta: { workshop: '常减压车间', date, generatedAt: C.localDateTime() },
  counts: { total: 9, overdue: 1, dueSoon: 1, unverified: 1, closed: 5 },
  metrics: { closureRate: 55.6 },
  overdue: [
    { no: 'YH-2609-03', desc: '常压炉区消防水炮阀门锈死无法开启', level: 'major', levelCn: '重大隐患',
      owner: '张设备', unit: '常减压车间', deadline: D(-pick(9, 13)), overdueDays: pick(9, 13),
      measure: '更换阀门并做操作试验', rawStatus: '整改中', bucket: 'overdue', sheet: '隐患台账', row: 3 },
  ],
  dueSoon: [
    { no: 'YH-2609-07', desc: '二区平台护栏局部变形', level: 'general', levelCn: '一般隐患',
      owner: '张设备', unit: '常减压车间', deadline: D(3), daysToDeadline: 3,
      measure: '校正并补焊', rawStatus: '整改中', bucket: 'dueSoon', sheet: '隐患台账', row: 7 },
  ],
  unverified: [
    { no: 'YH-2608-11', desc: '泵房照明缺失', level: 'general', levelCn: '一般隐患',
      owner: '张设备', unit: '常减压车间', deadline: D(-pick(1, 3)), measure: '补装防爆灯具',
      unverifiedReason: '整改状态为「已整改」但无验收记录', bucket: 'unverified', sheet: '隐患台账', row: 11 },
  ],
  inProgress: [], closed: [], majorHazards: [], undetermined: [], conflicts: [], items: [], warnings: [],
};
fs.writeFileSync(path.join(out, 'sample-hazard.json'), JSON.stringify(hazard, null, 2), 'utf8');

// ---- 3. 特种设备定检 inspection.json（1 超期、1 临期）
const inspection = {
  meta: { workshop: '常减压车间', date, leadDays: 60, generatedAt: C.localDateTime() },
  counts: { total: 24, overdue: 1, dueSoon: 1, normal: 20, undetermined: 2 },
  byCategory: [{ category: '压力容器', total: 14, overdue: 1, dueSoon: 1, normal: 12, undetermined: 0 }],
  overdue: [
    { tag: 'V-1301', name: '原油缓冲罐', category: '压力容器', regCode: '容11鲁00001', licence: '',
      unit: '常减压车间', grade: 2, lastDate: D(-1100), nextDate: D(-pick(20, 30)), overdueDays: pick(20, 30),
      nextSource: '台账（检验报告载明）', sheet: '特种设备台账', row: 5 },
  ],
  dueSoon: [
    { tag: 'V-1405', name: '常压塔顶回流罐', category: '压力容器', regCode: '容11鲁00042',
      unit: '常减压车间', grade: 2, lastDate: D(-1040), nextDate: D(5), remainDays: 5,
      nextSource: '台账（检验报告载明）', sheet: '特种设备台账', row: 18 },
  ],
  normal: [], undetermined: [], dateConflict: [], monitored: [], stopped: [],
  prepMaterials: [], openIssues: null, reports: null, warnings: [],
};
fs.writeFileSync(path.join(out, 'sample-inspection.json'), JSON.stringify(inspection, null, 2), 'utf8');

// ---- 4. 阀门仪表校验 calibration.json（1 超期安全联锁、1 临期、1 不合格未整改）
const calibration = {
  meta: { workshop: '常减压车间', date, leadDays: 30, generatedAt: C.localDateTime() },
  counts: { total: 86, overdue: 1, dueSoon: 1, unresolvedFail: 1, normal: 80, undetermined: 3 },
  overdue: [
    { tag: 'PSV-1102', category: '安全阀', name: '常压塔顶安全阀', model: 'A46Y-16C', lastDate: D(-400),
      nextDate: D(-pick(30, 40)), overdueDays: pick(30, 40), safetyCritical: true, cert: 'JY-2508-0033',
      state: 'overdue', sheet: '校验台账', row: 9 },
  ],
  dueSoon: [
    { tag: 'PT-1203', category: '压力变送器', name: '常压塔顶压力', lastDate: D(-350), nextDate: D(6),
      daysLeft: 6, safetyCritical: false, cert: 'JY-2509-0102', state: 'dueSoon', sheet: '校验台账', row: 22 },
  ],
  unresolvedFail: [
    { tag: 'TT-1308', category: '温度变送器', name: '加热炉出口温度', lastDate: D(-60),
      resultRaw: '不合格', cert: 'JY-2607-0210', state: 'unresolvedFail', sheet: '校验台账', row: 41 },
  ],
  normal: [], undetermined: [], byCategory: [], sendList: [], dupCerts: [], warnings: [],
};
fs.writeFileSync(path.join(out, 'sample-calibration.json'), JSON.stringify(calibration, null, 2), 'utf8');

// ---- 5. 润滑管理 lube.json（1 逾期、1 临期）
const lube = {
  meta: { workshop: '常减压车间', date, leadDays: 7, generatedAt: C.localDateTime() },
  counts: { ledgerItems: 48, overdue: 1, dueSoon: 1, normal: 44, undetermined: 2 },
  overdue: [
    { tag: 'P-1102A', name: '常压渣油泵A', part: '轴承箱', oil: 'L-TSA 46', mode: '油浴',
      periodRaw: '3个月', periodDays: 90, lastDate: D(-pick(100, 110)), dueDate: D(-pick(10, 20)),
      overdueDays: pick(10, 20), overdueRatio: 0.15, level: '轻微逾期', sheet: '润滑台账', row: 14 },
  ],
  dueSoon: [
    { tag: 'P-1101A', name: '常压塔顶回流泵A', part: '轴承箱', oil: 'L-TSA 46', mode: '油浴',
      periodRaw: '3个月', periodDays: 90, lastDate: D(-86), dueDate: D(4), remainDays: 4,
      sheet: '润滑台账', row: 6 },
  ],
  normal: [], undetermined: [], consumption: null,
  oilAnalysis: { provided: false, abnormal: [], normal: [], noLimit: [], note: '未提供油液分析数据。' },
  oilNameConflicts: [], warnings: [],
};
fs.writeFileSync(path.join(out, 'sample-lube.json'), JSON.stringify(lube, null, 2), 'utf8');

// ---- 6. 缺陷登记 defects.json（1 有时限、1 未定级无时限；P-1101B 与工单 P-1101B 构成疑似重复）
const defects = {
  meta: { workshop: '常减压车间', generatedAt: C.localDateTime(), mode: 'batch' },
  counts: { total: 2, byLevel: { 'B（较重）': 1, 未定级: 1 }, undetermined: 1, possibleDuplicate: 0 },
  defects: [
    { no: 'QX-26090015', tag: 'P-1101B', name: '常压塔顶回流泵B', part: '机封',
      phenomenon: 'leak', phenomenonCn: '泄漏', desc: '机封滴漏约5滴/分', medium: '常压渣油',
      affectsRun: false, foundAt: D(-6) + ' 08:20', by: '张班', level: 'B', levelCn: 'B（较重）',
      basis: '泄漏且介质易燃', dueDays: 7, dueDate: D(1), discipline: '动设备', srcRow: 2 },
    { no: 'QX-26090016', tag: 'M-1501', name: '加热炉鼓风机电机', part: '',
      phenomenon: 'other', phenomenonCn: '其他', desc: '运行有异响，具体部位待查', medium: '',
      affectsRun: null, foundAt: D(-2) + ' 10:20', by: '张班', level: 'undetermined', levelCn: '未定级',
      basis: '是否影响运行未填写，无法定级', dueDays: null, dueDate: null, discipline: '电气', srcRow: 3 },
  ],
  undetermined: [{ no: 'QX-26090016', tag: 'M-1501', desc: '运行有异响，具体部位待查', missing: ['是否影响运行'], note: '无法定级' }],
  possibleDuplicate: [], warnings: [],
};
fs.writeFileSync(path.join(out, 'sample-defects.json'), JSON.stringify(defects, null, 2), 'utf8');

// ---- 7. 自记待办表 xlsx（1 逾期、2 今日、1 无到期日、1 已完成不计）
writeXlsx(path.join(out, 'sample-todo-sheet.xlsx'), {
  '待办清单': [
    ['本人待办登记表'],
    [],
    ['事项', '到期日', '来源', '优先级', '位号', '责任人', '状态', '备注'],
    ['整理三季度备件申报表并报计划科', D(-pick(1, 3)), '上级交办', '高', '', '张设备', '进行中', '已与计划科对接过一次'],
    ['参加车间安全例会并汇报设备状况', date, '车间例会', '中', '', '张设备', '待办', ''],
    ['核对常压塔顶安全阀校验报告归档', date, '自记', '中', 'PSV-1102', '张设备', '待办', '与校验台账一并核对'],
    ['联系厂家询价机封备件', '', '自记', '中', 'P-1101B', '张设备', '待办', '厂家未回复报价'],
    ['提交上月设备月报', D(-10), '上级交办', '高', '', '张设备', '已完成', ''],
    ['合计', '', '', '', '', '', '', ''],
  ],
});

// ---- 8. 纯文字待办（1 带截止、2 无到期日）
fs.writeFileSync(path.join(out, 'sample-todo-text.txt'), [
  '# 随手记的几件事',
  '- 找电气班确认 M-1501 电机绝缘测试安排，截止 ' + D(4),
  '- 把上周检修总结补进技术档案',
  '1. 给新来的实习生讲一遍巡检路线',
  '',
].join('\n'), 'utf8');

// ---- 9. 工作交接 handover.json（shift-handover-record 产出；约定 meta.skill + pending 数组）
const handover = {
  meta: { skill: 'shift-handover-record', workshop: '常减压车间', type: '值班交接', shift: '值班交接', date: D(-1),
    handoverAt: D(-1) + ' 17:00', generatedAt: C.localDateTime(), declaration: '交接以双方现场确认签字为准' },
  counts: { pending: 3, carriedOver: 1, focusItems: 1 },
  pending: [
    { tag: 'P-1101B', name: '常压塔顶回流泵B', content: '机封备件到货后安排更换，更换前每班观察滴漏', state: '未完成', owner: '李维修',
      due: D(-pick(2, 4)), dueText: D(-pick(2, 4)), source: '常减压车间 值班交接', originShift: D(-1) + ' 值班交接', carried: false, carryTimes: 0, sheet: '未完成事项', row: 4 },
    { tag: 'E-1201', name: '原油换热器', content: '法兰复紧后观察 24 小时无渗漏再关闭通知单', state: '未完成', owner: '张设备',
      due: D(2), dueText: D(2), source: '常减压车间 值班交接', originShift: D(-3) + ' 值班交接', carried: true, carryTimes: 2, sheet: '未完成事项', row: 5 },
    { tag: '（待补）', name: '', content: '联系仪表车间确认 TT-1308 复校时间', state: '未判定', owner: '（待补）',
      due: null, dueText: '（待补）', source: '常减压车间 值班交接', originShift: D(-1) + ' 值班交接', carried: false, carryTimes: 0, sheet: '未完成事项', row: 6 },
  ],
  focusItems: [{ tag: 'K-1501', content: '循环氢压缩机油温偏高，已报工程师' }], carriedOver: [], prevClosed: [], warnings: [],
};
fs.writeFileSync(path.join(out, 'sample-handover.json'), JSON.stringify(handover, null, 2), 'utf8');

// ---- 10. SAP / EM 导出风格待办表（列名：工作事项 / 要求完成日期 / 紧急程度 / 功能位置 / 工单号 / 责任人 / 处理状态）
writeXlsx(path.join(out, 'sample-todo-sap-style.xlsx'), {
  '跟进事项': [
    ['工作事项', '要求完成日期', '紧急程度', '功能位置', '工单号', '责任人', '处理状态'],
    ['催办 K-1501 压缩机厂家技术支持到场', D(1), '1 非常高', 'CDU-K1501', '10045871', '张设备', '处理中'],
    ['回流泵 B 机封更换后验收', D(3), 'A级', 'CDU-P1101B', '10045902', '张设备', '待办'],
    ['旧口径登记：换热器法兰复紧复查', D(2), 'II级', 'CDU-E1201', '', '张设备', '待办'],
    ['整理特种设备年度检查资料', D(10), '3 中', '', '', '张设备', '待办'],
    ['已关闭的事项不应出现', D(-5), '4 低', 'CDU-V1301', '10046001', '张设备', '已关闭'],
  ],
});

// ---- 11. 无法识别的 JSON（验证 warning 且不中断）
fs.writeFileSync(path.join(out, 'sample-unknown.json'),
  JSON.stringify({ meta: { note: '某个不相干系统的导出' }, rows: [{ a: 1 }, { b: 2 }] }, null, 2), 'utf8');

console.log(JSON.stringify({
  ok: true, out, date, seed,
  files: fs.readdirSync(out).filter((f) => /\.(xlsx|json|txt)$/.test(f)).sort(),
}));
