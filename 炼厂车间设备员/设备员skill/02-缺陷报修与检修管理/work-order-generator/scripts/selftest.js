#!/usr/bin/env node
'use strict';
/** 自测：断言 workorder.js（维修通知单草稿）与 dispatch.js 行为。用法：node scripts/selftest.js（全绿退出 0） */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { writeXlsx } = require('./lib/xlsx-lite');
const C = require('./lib/common');
const D = require('./lib/dispatch');

const WO = path.join(__dirname, 'workorder.js');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-selftest-'));
const DATE = '2026-09-21';
const TODAY = C.localDate();
let pass = 0, fail = 0;
const failures = [];
const ok = (c, n) => { if (c) pass++; else { fail++; failures.push(n); } };
const eq = (a, e, n) => ok(a === e, `${n}（期望 ${JSON.stringify(e)}，实际 ${JSON.stringify(a)}）`);

function run(args, tag) {
  const out = path.join(work, tag + '-out');
  const r = spawnSync(process.execPath, [WO, ...args, '--out', out], { encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  let s; try { s = JSON.parse(lines[lines.length - 1]); } catch (e) { s = { ok: false, error: 'no-json:' + r.stdout + r.stderr }; }
  let j = null, md = null, csv = null;
  if (fs.existsSync(path.join(out, 'notifications.json'))) j = JSON.parse(fs.readFileSync(path.join(out, 'notifications.json'), 'utf8'));
  if (fs.existsSync(path.join(out, 'notifications.md'))) md = fs.readFileSync(path.join(out, 'notifications.md'), 'utf8');
  if (fs.existsSync(path.join(out, 'notifications.csv'))) csv = fs.readFileSync(path.join(out, 'notifications.csv'), 'utf8');
  return { code: r.status, s, j, md, csv, out };
}
const mk = (n, b) => { const p = path.join(work, n); writeXlsx(p, b); return p; };
const mkjson = (n, o) => { const p = path.join(work, n); fs.writeFileSync(p, JSON.stringify(o, null, 2), 'utf8'); return p; };
const BASE = ['--applicant', '加氢车间', '--due', '2026-12-31'];

// ============ A. 规则引擎单元测试 ============
eq(D.classifyPhenomenon('机封处持续滴漏'), 'leak', 'A1 现象识别-泄漏');
eq(D.classifyPhenomenon('指示不准，与现场表偏差大'), 'instrument', 'A2 现象识别-仪表异常');
eq(D.classifyPhenomenon('V-1101 排凝阀关不严，还在漏'), 'leak', 'A2b 单字「漏」识别为泄漏（与 defect-intake-grading 同口径）');
eq(D.classifyPhenomenon('巡检漏检两次'), 'other', 'A2c 「漏检」不当泄漏');
eq(D.classifyPhenomenon('P-201 泵振动大，巡检遗漏未及时发现'), 'vibration', 'A2d 「遗漏」不当泄漏');
eq(D.classifyPhenomenon('检修后漏装联轴器防护罩'), 'other', 'A2e 「漏装」不当泄漏');
eq(D.classifyPhenomenon('出口法兰又漏了'), 'leak', 'A2f 「又漏了」识别为泄漏');
eq(D.classifyPhenomenon('法兰发现漏点，有油迹'), 'leak', 'A2g 「漏点」仍为泄漏');
eq(D.classifyPhenomenon('疏水阀漏汽'), 'leak', 'A2h 「漏汽」仍为泄漏');
eq(D.classifyPhenomenon('P-201 泵振动大，存在漏检'), 'vibration', 'A2i 「存在漏检」不算泄漏');
eq(D.classifyPhenomenon('P-2105A 轴承温度偏高'), 'temperature', 'A2j 「温度偏高」识别为温升（与 defect-intake-grading 同口径）');
eq(D.classifyPhenomenon('出口温度持续上升'), 'temperature', 'A2k 「温度持续上升」识别为温升');
eq(D.classifyPhenomenon('轴承箱 91℃，比同类泵高约 15℃'), 'temperature', 'A2l 「高约 15℃」识别为温升');
eq(D.classifyPhenomenon('出口压力偏高'), 'other', 'A2m 「压力偏高」不算温升');
eq(D.disciplineOf('P-2101A', '进料泵', ''), '动设备', 'A3 专业归属-动设备');
eq(D.disciplineOf('E-2201', '换热器', ''), '静设备', 'A4 专业归属-静设备');
eq(D.disciplineOf('I-2501', '压力变送器', ''), '仪表', 'A5 专业归属-仪表');
eq(D.disciplineOf('XYZ-9999', '不明设备', ''), '待定', 'A6 无法归属→待定，不塞到动设备');
eq(D.disciplineOf('XYZ-9999', '不明设备', '仪表'), '仪表', 'A7 台账专业列优先于位号推断');
eq(D.disciplineOf('T-2401', '分馏塔', ''), '静设备', 'A8 T- 位号归静设备（不再与仪表冲突）');
eq(D.disciplineOf('TT-2401', '塔顶温度变送器', ''), '仪表', 'A9 TT- 位号归仪表');
eq(D.disciplineOf('EM-2502', '循环水泵B电机', ''), '电气', 'A10 EM- 电机不被"泵"抢成动设备');
eq(D.disciplineOf('M-301', '进料泵电机', ''), '电气', 'A11 M- 位号归电气');
eq(D.disciplineOf('PSV-2503', '液化气球罐安全阀', ''), '静设备', 'A12 安全阀归静设备');
eq(D.disciplineOf('K-101', '富气压缩机', ''), '动设备', 'A13 K- 压缩机归动设备');
ok(typeof D.suggestHours === 'undefined' && typeof D.HOUR_TABLE === 'undefined', 'A14 工时参考表已删除（工时由承修单位填）');
ok(typeof D.spareHint === 'undefined', 'A15 备件方向表已删除');
// SAP 优先级 1~4
eq(D.decidePriority({ explicit: '紧急' }).priority, 1, 'A16 紧急→SAP 优先级 1');
eq(D.decidePriority({ explicit: '非常高' }).priority, 1, 'A17 非常高→1');
eq(D.decidePriority({ explicit: '2' }).priority, 2, 'A18 数字 2 直接识别');
eq(D.decidePriority({ explicit: '紧急' }).priorityCn, '1 非常高', 'A19 优先级显示数字+中文');
eq(D.decidePriority({ explicit: '紧急' }).source, '用户指定', 'A20 优先级来源标注用户指定');
eq(D.decidePriority({ explicit: '', defectLevel: 'A 级（重大）' }).priority, 1, 'A21 A 级→1');
eq(D.decidePriority({ explicit: '', defectLevel: 'B 级（严重）' }).priority, 2, 'A22 B 级→2');
eq(D.decidePriority({ explicit: '', defectLevel: 'C 级（一般）' }).priority, 3, 'A23 C 级→3');
eq(D.decidePriority({ explicit: '', defectLevel: 'I 级（紧急）' }).priority, 1, 'A24 旧 I 级→1');
eq(D.decidePriority({ explicit: '', defectLevel: 'II 级（严重）' }).priority, 2, 'A25 旧 II 级→2');
eq(D.decidePriority({ explicit: '', defectLevel: 'III 级（一般）' }).priority, 3, 'A26 旧 III 级→3');
eq(D.decidePriority({ explicit: '', defectLevel: 'IV 级（轻微）' }).priority, 4, 'A27 旧 IV 级→4');
eq(D.decidePriority({ explicit: '', defectLevel: '' }).undetermined, true, 'A28 无优先级无等级→未判定');
eq(D.decidePriority({ explicit: '', defectLevel: '' }).priority, null, 'A29 未判定时优先级为 null 不按「3 中」默认');
eq(D.decidePriority({ explicit: '', defectLevel: '未判定' }).undetermined, true, 'A30 上游未判定等级→优先级仍未判定');
eq(D.decidePriority({ explicit: '特别急' }).undetermined, true, 'A31 优先级写法认不出→未判定不静默丢弃');
eq(D.parsePriority(''), null, 'A32 空优先级返回 null');
eq(D.parsePriority('5'), null, 'A33 超出 1~4 返回 null');
// 通知单类型
eq(D.decideNotifType({ explicit: '', priority: 1 }).type, 'M2', 'A34 优先级 1→M2 故障报告');
eq(D.decideNotifType({ explicit: '', priority: 3 }).type, 'M1', 'A35 优先级 3→M1 维修申请');
eq(D.decideNotifType({ explicit: 'M1', priority: 1 }).type, 'M1', 'A36 显式 --notif-type 覆盖');
eq(D.decideNotifType({ explicit: '', priority: null }).undetermined, true, 'A37 优先级未判定→类型未判定不按 M1 默认');
eq(D.parseNotifType('故障报告'), 'M2', 'A38 中文通知单类型可识别');
eq(D.parseNotifType('M9'), null, 'A39 非法类型返回 null');

// ============ B. 单张（文字描述路径） ============
let r = run(['--defect', '机封处持续滴漏，约5滴/分', '--tag', 'P-101A', ...BASE], 'text');
eq(r.s.ok, true, 'B1 文字描述路径成功');
eq(r.s.counts.total, 1, 'B2 生成 1 张草稿');
eq(r.j.orders[0].draftNo, 1, 'B3 草稿序号从 1 起');
ok(!('no' in r.j.orders[0]), 'B4 不再自编工单号字段');
ok(!/GD-\d{8}-\d{3}/.test(r.md) && !/GD-\d{8}-\d{3}/.test(r.csv), 'B5 产出中无 GD-YYYYMMDD-NNN 自编工单号');
eq(r.j.orders[0].fault.phenomenonCn, '泄漏', 'B6 文字描述识别出现象类型');
eq(r.j.orders[0].dispatch.discipline, '动设备', 'B7 按位号判定专业');
eq(r.j.orders[0].srcType, '文字描述', 'B8 来源标注为文字描述');
eq(r.j.orders[0].equipment.model, null, 'B9 无台账时规格型号为 null 不猜测');
ok(/待补充/.test(r.md), 'B10 md 中设备信息标「待补充」');
ok(r.md.includes('通知单号由系统生成'), 'B11 md 声明通知单号由 SAP 生成');
ok(r.md.includes('本材料由脚本汇总、模型成文，仅供设备员复核参考'), 'B12 声明行写入 md');
ok(/<!-- ANALYSIS_START -->/.test(r.md) && /<!-- ANALYSIS_END -->/.test(r.md), 'B13 分析段占位符存在');
eq(r.j.orders[0].priority.undetermined, true, 'B14 无优先级无等级→优先级未判定');
ok(/## 三、信息缺口清单/.test(r.md) && /未判定项/.test(r.md), 'B15 未判定单列一节');
eq(r.j.orders[0].notification.typeUndetermined, true, 'B16 优先级未判定→通知单类型未判定');
eq(r.j.orders[0].dispatch.laborHours, null, 'B17 工时留空由承修单位填');
eq(r.j.orders[0].dispatch.spare, null, 'B18 备件不给方向');
ok(!/人·小时/.test(r.md) && !/建议备件方向/.test(r.md), 'B19 md 不出现工时数值与备件方向');
ok(/工时由承修单位在工单（订单）中填写/.test(r.md), 'B20 md 说明工时归口');
ok(!/[✅⚠️]/.test(r.md), 'B21 md 不含 emoji');
ok(/【注意】/.test(r.md) && /【未判定】/.test(r.md), 'B22 md 用【注意】【未判定】提示');
ok(r.md.includes('维修通知单草稿'), 'B23 md 标题为维修通知单草稿');
eq(r.j.orders[0].notification.requiredStart, TODAY, 'B24 无发现时间时要求开始=当日');
eq(r.j.orders[0].notification.requiredEnd, '2026-12-31', 'B25 要求结束=--due');

r = run(['--defect', '机封滴漏', ...BASE], 'notag');
eq(r.s.ok, false, 'B26 文字描述缺 --tag 报错');
ok(/功能位置|位号/.test(r.s.error), 'B27 错误信息点明缺位号');

// ============ C. defects.json 上游对接（A/B/C 口径 + 旧四级兼容） ============
const dj = mkjson('defects.json', {
  meta: { mode: 'batch', gradingScheme: 'abc' },
  counts: { total: 3 },
  defects: [
    { no: 'QX-20260921-001', tag: 'P-01', equipNo: '10000001', name: '进料泵1', part: '机械密封', desc: '机封处持续滴漏', medium: '石脑油', phenomenon: 'leak', phenomenonCn: '泄漏', level: 'A', levelCn: 'A 级（重大）', basis: '高危介质泄漏', ruleId: 'R2', dueDays: 1, dueDate: '2026-09-22', foundAt: '2026-09-21 08:20', by: '设备员王', discipline: '动设备' },
    { no: 'QX-20260921-002', tag: 'E-01', name: '换热器1', part: '法兰', desc: '法兰面渗漏', medium: '柴油', phenomenon: 'leak', phenomenonCn: '泄漏', level: 'B', levelCn: 'B 级（严重）', basis: '中危介质泄漏', ruleId: 'R5', dueDays: 3, dueDate: '2026-09-24', discipline: '静设备' },
    { no: 'QX-20260921-003', tag: 'P-03', name: '泵3', part: '', desc: '出口法兰渗漏', medium: '', phenomenon: 'leak', phenomenonCn: '泄漏', level: 'undetermined', levelCn: '未判定', basis: '定级所需字段缺失：是否影响运行', ruleId: 'U1', dueDays: null, dueDate: null, discipline: '动设备' },
  ],
});
r = run(['--defect', dj, ...BASE], 'fromjson');
eq(r.s.ok, true, 'C1 defects.json 输入成功');
eq(r.s.counts.total, 3, 'C2 批量转出 3 张草稿');
eq(r.j.orders[0].defectNo, 'QX-20260921-001', 'C3 带出上游缺陷登记号');
eq(r.j.orders[0].fault.defectLevel, 'A 级（重大）', 'C4 带出缺陷等级');
eq(r.j.orders[0].fault.defectRuleId, 'R2', 'C5 带出定级规则号');
eq(r.j.orders[0].priority.key, 1, 'C6 A 级映射为 SAP 优先级 1');
eq(r.j.orders[1].priority.key, 2, 'C7 B 级映射为 2');
eq(r.j.orders[0].notification.type, 'M2', 'C8 优先级 1→M2');
eq(r.j.orders[2].priority.undetermined, true, 'C9 上游未判定等级→优先级未判定不默认');
eq(r.s.counts.undeterminedPriority, 1, 'C10 未判定计数正确');
eq(r.j.orders[0].equipment.equipNo, '10000001', 'C11 上游 equipNo 带入设备编号');
eq(r.j.orders[0].notification.requiredStart, '2026-09-21', 'C12 上游发现时间作要求开始');
eq(r.j.orders[0].notification.reporter, '设备员王', 'C13 上游发现人作报告人');
ok(r.j.orders[0].srcType === 'defects.json', 'C14 来源标注为 defects.json');
r = run(['--defect', dj, '--priority', '低', ...BASE], 'prioverride');
ok(r.j.orders.every((o) => o.priority.key === 4), 'C15 --priority 低→4 覆盖等级默认映射');
ok(r.j.orders[0].priority.source === '用户指定', 'C16 覆盖时来源标注用户指定');
ok(r.j.orders.every((o) => o.notification.type === 'M1'), 'C17 优先级 4→M1');
r = run(['--defect', dj, '--notif-type', 'M2', '--priority', '4', ...BASE], 'typeoverride');
ok(r.j.orders.every((o) => o.notification.type === 'M2'), 'C18 --notif-type 覆盖类型推断');
const notjson = path.join(work, 'notjson.json');
fs.writeFileSync(notjson, '这不是JSON', 'utf8');
r = run(['--defect', notjson, '--tag', 'P-1', ...BASE], 'notjson');
eq(r.s.ok, false, 'C19 传入的文件非有效 JSON 时报错');
// 旧四级 defects.json 仍可转
const djiv = mkjson('defects-iv.json', { defects: [{ no: 'QX-1', tag: 'V-1', desc: '外壁锈蚀', level: 'IV', levelCn: 'IV 级（轻微）' }] });
r = run(['--defect', djiv, ...BASE], 'fromjson-iv');
eq(r.j.orders[0].priority.key, 4, 'C20 旧 IV 级→4，兼容历史 defects.json');

// ============ D. 设备台账带出与位号查不到（SAP 技术对象列名） ============
const led = mk('led.xlsx', {
  '设备台账': [
    ['功能位置', '设备', '设备描述', '型号编号', '工厂区段', '专业类别', '开始日期'],
    ['P-01', '10000101', '进料泵1', 'ZA50-250', '一区泵房', '动设备', '2019-06-15'],
    ['E-01', '10000102', '换热器1', 'BES800', '一区框架', '静设备', '2018-11-20'],
  ],
});
r = run(['--defect', dj, '--ledger', led, ...BASE], 'ledger');
eq(r.j.orders[0].equipment.equipNo, '10000101', 'D1 SAP「设备」列带出设备编号（不当位号）');
eq(r.j.orders[0].equipment.model, 'ZA50-250', 'D2 「型号编号」带出规格型号');
eq(r.j.orders[0].equipment.location, '一区泵房', 'D3 「工厂区段」带出安装位置');
eq(r.j.orders[0].equipment.commissioned, '2019-06-15', 'D4 「开始日期」带出投用日期');
eq(r.j.orders[0].equipment.discipline, '动设备', 'D5 「专业类别」带出所属专业');
eq(r.j.orders[0].equipment.inLedger, true, 'D6 在台账中标记为 true');
eq(r.j.orders[2].equipment.inLedger, false, 'D7 位号不在台账标记为 false');
eq(r.j.orders[2].equipment.model, null, 'D8 位号不在台账→规格型号 null，绝不按设备名猜测');
eq(r.j.orders[2].equipment.equipNo, null, 'D9 位号不在台账→设备编号 null');
eq(r.j.orders[2].equipment.source, '台账中未查到', 'D10 信息来源标注台账中未查到');
ok(r.j.warnings.some((w) => w.includes('P-03') && w.includes('不在设备台账')), 'D11 位号不在台账 warning');
eq(r.s.counts.notInLedger, 1, 'D12 不在台账计数正确');
ok(r.j.missingInfo.some((m) => m.draftNo === 3 && m.missing.includes('SAP 设备编号')), 'D13 设备编号列入信息缺口清单');
ok(/未按设备名推测规格型号/.test(r.md), 'D14 md 声明未按设备名推测');
ok(/"10000101"/.test(r.csv), 'D15 CSV 设备编号列写入');
r = run(['--defect', dj, ...BASE], 'noledger');
eq(r.s.ok, true, 'D16 未提供台账不中断');
ok(r.j.warnings.some((w) => w.includes('未提供设备台账')), 'D17 未提供台账 warning');

// ============ E. 历史维修记录（SAP 订单历史列名） ============
const hist = mk('hist.xlsx', {
  '维修记录': [
    ['订单', '功能位置', '基本开始日期', '订单描述', '主工作中心'],
    ['40000001', 'P-01', '2025-03-12', '更换机械密封', 'JX-DSB1'],
    ['40000002', 'P-01', '2025-08-20', '更换驱动端轴承', 'JX-DSB1'],
    ['40000003', 'P-01', '2026-01-15', '更换O形圈', 'JX-DSB2'],
    ['40000004', 'P-01', '2026-06-05', '解体检查更换口环', 'JX-DSB1'],
    ['40000005', 'E-01', '2025-11-10', '封头法兰更换垫片', 'JX-JSB2'],
  ],
});
r = run(['--defect', dj, '--ledger', led, '--history', hist, ...BASE], 'hist');
eq(r.j.orders[0].history.length, 3, 'E1 默认取近 3 次维修记录');
eq(r.j.orders[0].history[0].date, '2026-06-05', 'E2 「基本开始日期」倒序，最近一次在前');
eq(r.j.orders[0].history[2].date, '2025-08-20', 'E3 截断掉最早的一次');
eq(r.j.orders[0].history[0].vendor, 'JX-DSB1', 'E4 「主工作中心」带出承修单位');
eq(r.j.orders[0].history[0].orderNo, '40000004', 'E5 「订单」带出原订单号');
eq(r.j.orders[0].history[0].content, '解体检查更换口环', 'E6 「订单描述」带出维修内容');
ok(/共 4 条，展示近 3 次/.test(r.j.orders[0].historyNote), 'E7 说明总条数与展示条数');
eq(r.j.orders[2].history, null, 'E8 无历史记录→history 为 null');
ok(/无位号「P-03」的记录/.test(r.j.orders[2].historyNote), 'E9 无记录时写明位号');
ok(r.j.warnings.some((w) => w.includes('P-03') && w.includes('历史维修记录中无记录')), 'E10 无历史记录 warning');
eq(r.s.counts.withoutHistory, 1, 'E11 无历史记录计数正确');
ok(/不编造检修履历/.test(r.md), 'E12 md 声明不编造检修履历');
r = run(['--defect', dj, '--history', hist, '--history-n', '2', ...BASE], 'histn');
eq(r.j.orders[0].history.length, 2, 'E13 --history-n 2 取近 2 次');
r = run(['--defect', dj, ...BASE], 'nohist');
ok(r.j.orders.every((o) => o.history === null), 'E14 未提供历史记录时全部为 null');
ok(r.j.orders.every((o) => o.historyNote === '未提供历史维修记录'), 'E15 未提供时章节写「未提供历史维修记录」');
// 旧式中文列名也可读
const histCn = mk('histcn.xlsx', { '维修记录': [['工单号', '位号', '维修日期', '维修内容', '承修单位'], ['GD-1', 'P-01', '2025-03-12', '更换机械密封', '检修一班']] });
r = run(['--defect', dj, '--history', histCn, ...BASE], 'histcn');
eq(r.j.orders[0].history[0].vendor, '检修一班', 'E16 中文列名历史记录仍可读');
// 未完工工单（无维修日期、无维修内容，只有工单号）不当历史维修记录展示
const histOpen = mk('histopen.xlsx', {
  '维修记录': [
    ['工单号', '位号', '实际结束日期', '检修内容', '承修单位'],
    ['20000001', 'P-01', '2026-02-06', '更换驱动端轴承', '动设备班'],
    ['20000002', 'P-01', '', '', '动设备班'],
  ],
});
r = run(['--defect', dj, '--history', histOpen, ...BASE], 'histopen');
ok(r.j.orders[0].history.length === 1 && r.j.orders[0].history.every((h) => h.date && h.content), 'E17 无维修日期且无维修内容的行（未完工工单）不列入历史维修摘要');
ok(r.j.warnings.some((w) => w.includes('未完工') && w.includes('1 行')), 'E18 跳过未完工工单行时 warning 说明行数');

// ============ F. 不再编工单号 / 已废参数 ============
r = run(['--defect', dj, '--prefix', 'WX', ...BASE], 'prefix');
eq(r.s.ok, false, 'F1 --prefix 已废止（通知单号由 SAP 生成），传入报未知参数');
r = run(['--defect', dj, '--order-ledger', led, ...BASE], 'orderledger');
eq(r.s.ok, false, 'F2 --order-ledger 已废止');
r = run(['--defect', dj, ...BASE], 'seq');
ok(r.j.orders.map((o) => o.draftNo).join(',') === '1,2,3', 'F3 草稿序号连续 1..N');
ok(r.csv.split('\n')[0].includes('通知单号(SAP生成)'), 'F4 CSV 含通知单号列且留空');
ok(r.csv.split('\n')[1].startsWith('"1",""'), 'F5 CSV 通知单号留空');

// ============ G. 要求结束早于当前 ============
r = run(['--defect', dj, '--applicant', '加氢车间', '--due', '2020-01-01'], 'overdue');
eq(r.s.ok, true, 'G1 要求结束早于当前仍生成草稿');
ok(r.j.warnings.some((w) => w.includes('早于当前日期')), 'G2 要求结束早于当前 warning');
ok(r.j.orders[0].schedule.overdue === true, 'G3 草稿标记 overdue');
ok(r.j.orders[0].schedule.daysToDue < 0, 'G4 距要求结束天数为负');
ok(/早于当前日期，请确认是否改期/.test(r.md), 'G5 md 提示确认改期');
r = run(['--defect', dj, ...BASE], 'notoverdue');
ok(!r.j.warnings.some((w) => w.includes('早于当前日期')), 'G6 未过期时无该 warning');
ok(r.j.orders[0].schedule.overdue === false, 'G7 未过期 overdue 为 false');

// ============ H. 批量（xlsx，含 SAP 通知单列名） ============
const batch = mk('batch.xlsx', {
  '缺陷记录': [
    ['缺陷编号', '位号', '设备名称', '缺陷描述', '等级'],
    ['QX-001', 'P-01', '泵1', '机封泄漏', 'A 级（重大）'],
    ['QX-002', 'E-01', '换热器1', '法兰渗漏', 'B 级（严重）'],
    ['QX-003', 'I-01', '变送器', '指示不准', 'C 级（一般）'],
    ['', '', '无位号', '异响', 'C 级（一般）'],
    ['QX-005', 'P-05', '泵5', '', 'C 级（一般）'],
  ],
});
r = run(['--input', batch, ...BASE], 'batch');
eq(r.s.ok, true, 'H1 批量转单成功');
eq(r.s.counts.total, 3, 'H2 空位号行与空描述行均被跳过');
ok(r.j.warnings.some((w) => w.includes('位号为空')), 'H3 空位号 warning');
ok(r.j.warnings.some((w) => w.includes('缺陷描述为空')), 'H4 空描述 warning（不编造故障现象）');
eq(Object.keys(r.s.counts.byDiscipline).length, 3, 'H5 三个专业各 1 张');
eq(r.s.counts.byPriority['1 非常高'], 1, 'H6 A 级 1 张→优先级 1');
const sap = mk('sap.xlsx', {
  '通知单': [
    ['功能位置', '设备', '设备描述', '对象部件', '通知单短文本', '介质', '通知日期', '报告人'],
    ['P-11', '10000011', '酸性水泵', '机械密封', '机封泄漏', '含硫污水', `${DATE} 07:50`, '刘'],
  ],
});
r = run(['--input', sap, '--priority', '2', ...BASE], 'sap');
eq(r.s.ok, true, 'H7 SAP 通知单导出列名可读');
eq(r.j.orders[0].equipment.equipNo, '10000011', 'H8 「设备」列作设备编号');
eq(r.j.orders[0].fault.part, '机械密封', 'H9 「对象部件」作部位');
eq(r.j.orders[0].notification.requiredStart, DATE, 'H10 「通知日期」作要求开始');
eq(r.j.orders[0].notification.reporter, '刘', 'H11 「报告人」带入');

// ============ I. 产出完整性 ============
r = run(['--defect', dj, '--ledger', led, '--history', hist, '--vendor', '检修一班', '--workshop', '加氢车间', '--reporter', '设备员王', ...BASE], 'outputs');
ok(fs.existsSync(path.join(r.out, 'notifications.json')), 'I1 notifications.json 生成');
ok(fs.existsSync(path.join(r.out, 'notifications.md')), 'I2 notifications.md 生成');
ok(fs.existsSync(path.join(r.out, 'notifications.csv')), 'I3 notifications.csv 生成');
ok(fs.existsSync(path.join(r.out, 'summary.json')), 'I4 summary.json 生成');
ok(!fs.existsSync(path.join(r.out, 'workorders.json')), 'I5 不再生成 workorders.json');
ok(/## 一、通知单草稿清单概览/.test(r.md) && /## 二、通知单草稿正文/.test(r.md) && /## 三、信息缺口清单/.test(r.md), 'I6 三节结构齐全');
ok(r.csv.charCodeAt(0) === 0xFEFF, 'I7 CSV 带 BOM');
ok(/功能位置.*设备编号.*通知单短文本.*长文本.*优先级.*故障代码.*要求开始.*要求结束/.test(r.csv.split('\n')[0]), 'I8 CSV 为 SAP 通知单列');
ok(!r.csv.includes('建议工时') && !r.csv.includes('备件方向'), 'I9 CSV 不含工时与备件列');
ok(!r.csv.includes('待审核派发') && !r.csv.includes('EAM'), 'I10 CSV 不再是 EAM 导入格式');
ok(/专业归口建议值，需车间与承修单位确认/.test(r.md), 'I11 md 标注专业归口为建议值');
eq(r.j.meta.notice, '本通知单草稿由车间设备员核对后在 SAP 中创建，通知单号由系统生成；维修工单（订单）、工时与备件由计划员或承修单位编制，本草稿不替代审核派发。', 'I12 JSON 中保留说明行');
eq((r.md.match(/本通知单草稿由车间设备员核对后在 SAP 中创建/g) || []).length, 2, 'I13 md 首尾各一处说明行');
eq(r.j.orders[0].dispatch.vendor, '检修一班', 'I14 --vendor 写入草稿');
ok(!r.j.orders[0].missing.includes('建议承修单位'), 'I15 指定承修单位后不再列入缺口');
eq(r.j.orders[1].notification.reporter, '设备员王', 'I16 --reporter 写入报告人');
const sm = JSON.parse(fs.readFileSync(path.join(r.out, 'summary.json'), 'utf8'));
eq(sm.ok, true, 'I17 summary.json 内容与末行一致');
eq(sm.counts.total, 3, 'I18 summary.json 含 counts');
ok(!/机动处/.test(r.md), 'I19 md 不出现旧称"机动处"');

// ============ J. 参数校验 ============
function raw(args) {
  const x = spawnSync(process.execPath, [WO, ...args], { encoding: 'utf8' });
  const l = x.stdout.trim().split('\n');
  try { return { code: x.status, s: JSON.parse(l[l.length - 1]) }; } catch (e) { return { code: x.status, s: { ok: false, error: '' } }; }
}
eq(raw([]).s.ok, false, 'J1 无参数报错');
eq(raw([]).code, 1, 'J2 退出码 1');
eq(raw(['--defect', 'x', '--tag', 'P-1']).s.ok, false, 'J3 缺 --applicant 报错');
ok(/报告单位/.test(raw(['--defect', 'x', '--tag', 'P-1']).s.error), 'J4 错误信息点明报告单位');
eq(raw(['--defect', 'x', '--tag', 'P-1', '--applicant', '车间']).s.ok, false, 'J5 缺 --due 报错');
eq(raw(['--defect', 'x', '--tag', 'P-1', '--applicant', '车间', '--due', '下周三']).s.ok, false, 'J6 非法日期报错');
ok(/YYYY-MM-DD/.test(raw(['--defect', 'x', '--tag', 'P-1', '--applicant', '车间', '--due', '下周三']).s.error), 'J7 日期错误提示格式');
eq(raw(['--defect']).s.ok, false, 'J8 --defect 缺值报错');
ok(/缺少取值/.test(raw(['--defect']).s.error), 'J9 缺值信息正确');
eq(raw(['--defect', 'x', '--tag', 'P-1', ...BASE, '--未知', 'v']).s.ok, false, 'J10 未知参数报错');
eq(raw(['--input', '/不存在.xlsx', ...BASE]).s.ok, false, 'J11 输入不存在报错');
eq(raw(['--defect', 'x', '--tag', 'P-1', ...BASE, '--ledger', '/不存在.xlsx']).s.ok, false, 'J12 台账不存在报错');
eq(raw(['--defect', 'x', '--tag', 'P-1', ...BASE, '--history', '/不存在.xlsx']).s.ok, false, 'J13 历史记录不存在报错');
eq(raw(['--defect', 'x', '--tag', 'P-1', ...BASE, '--history-n', '0']).s.ok, false, 'J14 --history-n 非正整数报错');
eq(raw(['--input', mk('empty.xlsx', { '别的表': [['a'], [1]] }), ...BASE]).s.ok, false, 'J15 无缺陷记录表报错');
eq(raw(['--defect', mkjson('empty.json', { defects: [] }), ...BASE]).s.ok, false, 'J16 defects 数组为空报错');
eq(raw(['--defect', 'x', '--tag', 'P-1', ...BASE, '--notif-type', 'M9']).s.ok, false, 'J17 非法 --notif-type 报错');

// ============ K. 合计行、别名列头与缺表 ============
const alias = mk('alias.xlsx', {
  '缺陷记录': [
    ['某厂缺陷导出'],
    [],
    ['设备位号', '名称', '故障现象', '缺陷等级'],
    ['P-01', '泵1', '机封泄漏', 'A 级（重大）'],
    ['合计', '', '', ''],
  ],
});
r = run(['--input', alias, ...BASE], 'alias');
eq(r.s.ok, true, 'K1 别名列头可读');
eq(r.s.counts.total, 1, 'K2 合计行被跳过');
ok(r.j.warnings.some((w) => w.includes('合计行')), 'K3 合计行 warning');
const ledNoModel = mk('lednomodel.xlsx', { '设备台账': [['位号', '设备名称'], ['P-01', '泵1']] });
r = run(['--defect', dj, '--ledger', ledNoModel, ...BASE], 'nomodelcol');
eq(r.s.ok, true, 'K4 台账缺列不中断');
eq(r.j.orders[0].equipment.model, null, 'K5 台账缺规格型号列→留空不猜');
eq(r.j.orders[0].equipment.name, '泵1', 'K6 台账已有列正常带出');
const badHist = mk('badhist.xlsx', { '其他表': [['位号'], ['P-01']] });
r = run(['--defect', dj, '--history', badHist, ...BASE], 'badhist');
eq(r.s.ok, true, 'K7 历史记录表名不匹配不中断');
ok(r.j.warnings.some((w) => w.includes('未找到「维修记录」')), 'K8 历史记录缺表 warning');
const ledBadDate = mk('ledbaddate.xlsx', { '设备台账': [['位号', '设备名称', '投用日期'], ['P-01', '泵1', '大前年']] });
r = run(['--defect', dj, '--ledger', ledBadDate, ...BASE], 'baddate');
eq(r.j.orders[0].equipment.commissioned, null, 'K9 投用日期无法解析→null 不猜');
ok(r.j.warnings.some((w) => w.includes('投用日期') && w.includes('无法解析')), 'K10 投用日期无法解析 warning 带行号');
// 位号与设备编号不混：台账只有「设备编号」列而无功能位置 → 位号缺列 warning，不把流水号当位号
const ledOnlyNo = mk('ledonlyno.xlsx', { '设备台账': [['设备编号', '设备名称'], ['10000101', '泵1']] });
r = run(['--defect', dj, '--ledger', ledOnlyNo, ...BASE], 'onlyno');
ok(r.j.warnings.some((w) => w.includes('缺少列: 位号')), 'K11 「设备编号」不再被当作位号，台账缺位号列 warning');

// ============ M. 输入已带通知单号：原样带出「已有通知单号」，注明系统已存在 ============
{
  const ex = mk('m-exist.xlsx', {
    '通知单': [['通知单号', '通知单类型', '位号', '设备名称', '描述', '缺陷等级', '优先级', '发现时间'],
      ['10046716', 'M2', 'P-2108', '缓蚀剂注入泵', 'P-2108 出口压力不足', 'B', '2', '2026-11-14 09:05'],
      ['', 'M2', 'P-2109', '回流泵', 'P-2109 机封滴漏', 'C', '3', '2026-11-14 10:05']],
  });
  r = run(['--input', ex, ...BASE], 'm-exist');
  const o1 = ((r.j && r.j.orders) || [])[0] || {}, o2 = ((r.j && r.j.orders) || [])[1] || {};
  eq(o1.existingNotifNo, '10046716', 'M1 输入「通知单号」原样带到 existingNotifNo');
  eq(o2.existingNotifNo, null, 'M2 通知单号为空的行 existingNotifNo 为 null');
  const head = r.csv ? r.csv.replace(/^\uFEFF/, '').split('\r\n')[0] : '';
  const row1 = r.csv ? r.csv.split('\r\n')[1] : '';
  ok(/"已有通知单号"/.test(head) && /"10046716"/.test(row1), 'M3 CSV 单独一列「已有通知单号」并原样写入');
  ok(r.csv && r.csv.split('\r\n')[1].startsWith('"1","",'), 'M4 「通知单号(SAP生成)」列仍留空，不把已有号填进去');
  ok(r.md && /10046716/.test(r.md) && /系统已存在，勿重复创建/.test(r.md), 'M5 md 注明「系统已存在，勿重复创建」');
  eq(r.j && r.j.counts.existingNotif, 1, 'M6 counts.existingNotif 计 1');
  ok(r.j && r.j.warnings.some((w) => /10046716/.test(w) && /勿重复创建/.test(w)), 'M7 有已存在通知单时给 warning');
  // 上游 defects.json 带 sourceNoKind=notification 时同样带出；sourceNoKind=defect（缺陷编号）不算已有通知单
  const dj2 = mkjson('m-defects.json', { counts: { byLevel: {} }, defects: [
    { no: 'QX-1', tag: 'P-2108', desc: '出口压力不足', level: 'B', levelCn: 'B 级（严重）', sourceNo: '10046716', sourceNoKind: 'notification' },
    { no: 'QX-2', tag: 'P-2109', desc: '机封滴漏', level: 'C', levelCn: 'C 级（一般）', sourceNo: 'QX-0901', sourceNoKind: 'defect' }] });
  r = run(['--defect', dj2, ...BASE], 'm-defects');
  const os2 = (r.j && r.j.orders) || [];
  ok(os2.length === 2 && os2[0].existingNotifNo === '10046716' && os2[1].existingNotifNo === null, 'M8 defects.json 的 sourceNo（通知单号）带出，缺陷编号不当已有通知单号');
}

// ============ W. 车间范围核对（D007，批量 --input） ============
const wsHead = ['位号', '缺陷描述', '等级', '介质'];
const wsBook = (col, vals) => mk(`ws-${col}-${vals.join('_') || 'none'}.xlsx`, {
  '缺陷记录': [col ? [...wsHead, col] : wsHead,
    ...vals.map((v, i) => (col ? [`P-90${i}`, '机封滴漏', 'C', '柴油', v] : [`P-90${i}`, '机封滴漏', 'C', '柴油']))],
});
const wsOf = (x) => ((x.j && x.j.meta && x.j.meta.workshopScope) || [])[0] || {};
const wsTags = (x) => ((x.j && x.j.orders) || []).map((o) => o.equipment && o.equipment.tag);
r = run(['--input', wsBook('车间', ['常减压车间', '催化车间', '', '常减压']), '--workshop', '常减压车间', ...BASE], 'ws-mix');
eq(r.j && r.j.counts.total, 3, 'W1 两车间混合：只为本车间与车间为空的行出草稿（3 张）');
ok(r.j && !wsTags(r).includes('P-901') && wsTags(r).includes('P-900'), 'W2 催化车间的 P-901 不出草稿');
ok(r.j && r.j.warnings.some((w) => /剔除其他车间 1 行/.test(w) && /催化车间 1 行/.test(w)), 'W3 warning 写明剔除行数与车间名');
ok(wsOf(r).status === 'checked' && wsOf(r).droppedRows === 1 && (wsOf(r).dropped || {})['催化车间'] === 1, 'W4 meta.workshopScope 记录剔除情况');
ok(wsOf(r).blank === 1 && wsTags(r).includes('P-902'), 'W5 车间列为空的行按本车间保留');
ok(r.md && /车间范围：已按车间列核对「常减压车间」，剔除其他车间的行/.test(r.md), 'W6 md 口径写明按车间核对');
r = run(['--input', wsBook('车间', ['催化车间', '焦化车间']), '--workshop', '常减压车间', ...BASE], 'ws-mis');
ok(r.j && r.j.counts.total === 2 && wsOf(r).status === 'mismatch', 'W7 车间列全不一致：不筛，status=mismatch');
ok(r.j && r.j.warnings.some((w) => /^【注意】/.test(w)), 'W8 车间列全不一致 warning 以【注意】开头');
const wsAt = r.md ? r.md.indexOf('【注意】工作表「缺陷记录」的车间列取值') : -1;
ok(wsAt > 0 && wsAt < r.md.indexOf('## 一'), 'W9 md 开头（第一节之前）有【注意】提示');
r = run(['--input', wsBook(null, ['', '']), '--workshop', '常减压车间', ...BASE], 'ws-nocol');
ok(wsOf(r).status === 'noColumn' && r.md && /输入未含车间列，车间范围以取数条件为准/.test(r.md), 'W10 无车间列：不筛，md 口径说明以取数条件为准');
r = run(['--input', wsBook('维护工厂', ['1100', '1200']), '--workshop', '常减压车间', ...BASE], 'ws-plant');
ok(wsOf(r).status === 'noColumn' && r.j.counts.total === 2, 'W11 「维护工厂」列不当车间列（noColumn，不筛）');
r = run(['--input', wsBook('车间', ['催化车间']), ...BASE], 'ws-nows');
ok(wsOf(r).status === 'noWorkshop' && r.md && !/车间范围：/.test(r.md), 'W12 未给 --workshop 不核对、不写口径句');

r = run(['--input', wsBook('所属车间', ['常减压车间', '催化车间']), '--workshop', '常减压车间', ...BASE], 'ws-ssc');
ok(wsOf(r).status === 'checked' && wsOf(r).column === '所属车间' && r.j.counts.total === 1, 'W13 「所属车间」列同样核对');

// ============ L. 演示case 样例预期计数 ============
// 演示样例：仓库内在 炼厂车间设备员/演示case/<分类>/<技能>/，开发包内在技能目录 examples/
const skillsRoot = path.resolve(__dirname, '../../..');
const EX = path.basename(skillsRoot) === '设备员skill' ? path.join(skillsRoot, '..', '演示case', path.relative(skillsRoot, path.resolve(__dirname, '..'))) : path.join(__dirname, '..', 'examples');
if (fs.existsSync(path.join(EX, 'sample-defects-2026-09-21.xlsx'))) {
  r = run(['--input', path.join(EX, 'sample-defects-2026-09-21.xlsx'), '--ledger', path.join(EX, 'sample-equip-ledger.xlsx'), '--history', path.join(EX, 'sample-repair-history.xlsx'), ...BASE], 'ex');
  eq(r.s.counts.total, 4, 'L1 演示case 主样例 4 张草稿');
  eq(r.s.counts.byPriority['1 非常高'], 1, 'L2 演示case A 级 1→优先级 1');
  eq(r.s.counts.byType['M2 故障报告'], 2, 'L3 演示case M2 2 张');
  eq(r.s.counts.notInLedger, 1, 'L4 演示case P-2103A 不在台账');
  eq(r.s.counts.withoutHistory, 2, 'L5 演示case 2 张无历史');
  eq(r.j.orders[0].equipment.equipNo, '10002101', 'L6 演示case SAP 台账带出设备编号');
  r = run(['--input', path.join(EX, 'sample-no-level.xlsx'), ...BASE], 'ex-nolevel');
  eq(r.s.counts.undeterminedPriority, 2, 'L7 演示case 无等级样例优先级全部未判定');
  eq(r.s.counts.undeterminedType, 2, 'L8 演示case 无等级样例通知单类型全部未判定');
  r = run(['--input', path.join(EX, 'sample-no-level.xlsx'), '--priority', '2', '--notif-type', 'M2', ...BASE], 'ex-override');
  eq(r.s.counts.undeterminedPriority, 0, 'L9 演示case 显式 --priority 后无未判定');
  eq(r.s.counts.byPriority['2 高'], 2, 'L10 演示case 显式优先级 2 高 全部命中');
  eq(r.s.counts.byType['M2 故障报告'], 2, 'L11 演示case 显式 --notif-type M2 全部命中');
  ok(!/【未判定】/.test(r.md), 'L12 演示case 无未判定时 md 不出现【未判定】');
  r = run(['--input', path.join(EX, 'sample-defects-2026-09-21.xlsx'), '--ledger', path.join(EX, 'sample-equip-ledger.xlsx'), ...BASE], 'ex-ledger');
  ok(!/GD-\d{8}-\d{3}/.test(r.md) && !/EAM|机动处|人·小时|备件方向/.test(r.md), 'L13 演示case 产出无自编工单号、EAM、机动处、工时与备件方向');
  ok(/公司设备管理部门|承修单位/.test(r.md), 'L14 演示case 产出使用中石化口径的归口说法');
}

console.log(`\n${'='.repeat(56)}`);
console.log(`work-order-generator 自测：${pass} 通过，${fail} 失败`);
if (failures.length) { console.log('\n失败项：'); failures.forEach((f) => console.log('  ✗ ' + f)); }
console.log('='.repeat(56));
try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
