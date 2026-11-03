#!/usr/bin/env node
'use strict';
/**
 * 自测：生成变体输入并断言 handover.js 行为。用法：node scripts/selftest.js（全绿退出 0）
 * 重点覆盖：上次交接遗留事项结转（无对应记录 / 有记录未闭环 / 有记录已闭环三条路径）、
 *           连续多次结转、责任人缺失写「待明确」不省略条目、--time 非法报错、在修设备无状态说明 warning、
 *           --type 值班/休假/调岗交接、meta.skill 约定、SAP/EM 列名、术语不含「交接班」。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { writeXlsx } = require('./lib/xlsx-lite');

const HO = path.join(__dirname, 'handover.js');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'shr-selftest-'));
const D = '2026-09-21';
const TIME = '2026-09-22T08:00:00+08:00';
let pass = 0, fail = 0;
const failures = [];

function ok(cond, name) { if (cond) { pass++; } else { fail++; failures.push(name); } }
function eq(actual, expect, name) { ok(actual === expect, `${name}（期望 ${JSON.stringify(expect)}，实际 ${JSON.stringify(actual)}）`); }

function run(file, extra = [], tag, opt = {}) {
  const out = path.join(work, (tag || path.basename(file, '.xlsx')) + '-out');
  const args = [HO, '--input', file, '--workshop', opt.workshop || '测试车间', '--type', opt.type || '值班交接',
    ...(opt.shift ? ['--shift', opt.shift] : []), '--time', opt.time || TIME, '--by', opt.by || '张设备', '--out', out, ...extra];
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', env: opt.env ? { ...process.env, ...opt.env } : process.env });
  const lines = r.stdout.trim().split('\n');
  let summary;
  try { summary = JSON.parse(lines[lines.length - 1]); } catch (e) { summary = { ok: false, error: 'no-json:' + r.stdout + r.stderr }; }
  let ho = null, md = null;
  if (fs.existsSync(path.join(out, 'handover.json'))) ho = JSON.parse(fs.readFileSync(path.join(out, 'handover.json'), 'utf8'));
  if (fs.existsSync(path.join(out, 'handover.md'))) md = fs.readFileSync(path.join(out, 'handover.md'), 'utf8');
  return { code: r.status, summary, ho, md, out };
}
function mk(name, book) { const p = path.join(work, name); writeXlsx(p, book); return p; }
const HDR = ['时间', '位号', '设备名称', '事项类型', '内容', '处理情况', '状态', '责任人', '要求完成时间'];

// ================================================================ 1. 基础分类
const base = mk('base.xlsx', {
  '值班记录': [
    HDR,
    [`${D} 20:00`, 'P-01', '泵1', '状态变化', '由备用切运行', '已确认正常', '已完成', '张', ''],
    [`${D} 21:00`, 'P-02', '泵2', '异常处理', '机封渗漏', '已紧固压盖', '已完成', '张', ''],
    [`${D} 22:00`, 'P-03', '泵3', '异常处理', '轴承温度偏高', '已加油观察', '未完成', '李', `${D} 23:00`],
    [`${D} 23:00`, 'P-04', '泵4', '在修', '机封更换施工中', '已拆解等备件', '未完成', '王检修', '2026-09-23 12:00'],
  ],
});
let r = run(base, [], 'base');
eq(r.summary.ok, true, '1.1 基础运行成功');
eq(r.summary.counts.records, 4, '1.2 记录条数');
eq(r.summary.counts.statusChanges, 1, '1.3 状态变化数');
eq(r.summary.counts.abnormalHandled, 2, '1.4 异常处理数');
eq(r.summary.counts.abnormalClosed, 1, '1.5 异常已闭环数');
eq(r.summary.counts.inRepair, 1, '1.6 在修设备数（由在修事项补入）');
eq(r.summary.counts.pending, 2, '1.7 未完成事项数（P-03 + P-04）');
eq(r.summary.counts.carriedOver, null, '1.8 未提供 --prev 时结转为 null');
ok(r.ho.warnings.some((w) => w.includes('无法核对上次交接遗留事项')), '1.9 未提供 --prev 的 warning');
ok(/未提供上次交接记录/.test(r.md), '1.10 md 说明无法核对遗留事项');
eq(r.ho.meta.skill, 'shift-handover-record', '1.11 meta.skill 约定，供 worklog-todo-manager 识别');
ok(Array.isArray(r.ho.pending), '1.12 pending 为数组');
eq(r.ho.meta.type, '值班交接', '1.13 meta.type 记录交接类型');
ok(/设备员值班交接记录/.test(r.md), '1.14 标题为设备员值班交接记录');
ok(!/交接班/.test(r.md.replace(/不是操作班组交接班/g, '')), '1.15 md 不出现「交接班」（排除操作班组交接班的说明句）');
ok(/不是操作班组交接班/.test(r.md), '1.16 md 声明不是操作班组交接班');
ok(/## 一、交接信息/.test(r.md) && /交接人 \| /.test(r.md) && /接手人 \| /.test(r.md), '1.17 交接信息表用交接人/接手人');

// ================================================================ 2. 结转路径 A：上次交接遗留、本次完全无记录 → 必须原样结转
const prevXlsx = mk('prev.xlsx', {
  '未完成事项': [
    ['位号', '设备名称', '内容', '责任人', '要求完成时间', '来源交接'],
    ['P-02', '泵2', '机封渗漏需紧固观察', '李设备', `${D} 08:00`, '2026-09-20 值班交接'],   // 本次已闭环
    ['P-03', '泵3', '轴承温度偏高需跟踪', '李', `${D} 10:00`, '2026-09-20 值班交接'],       // 本次有记录未闭环
    ['P-99', '泵99', '联轴器护罩螺栓缺失2条待补装', '', `${D} 12:00`, '2026-09-20 值班交接'], // 本次无任何记录
  ],
});
r = run(base, ['--prev', prevXlsx], 'carry');
eq(r.summary.ok, true, '2.1 带 --prev 运行成功');
const carried = r.ho.carriedOver;
ok(carried.some((x) => x.tag === 'P-99'), '2.2 本次无对应记录的遗留项被结转（P-99）');
const p99 = carried.find((x) => x.tag === 'P-99') || {};
eq(p99.note, '上次交接遗留，本次未处理', '2.3 结转项标注「上次交接遗留，本次未处理」');
eq(p99.originShift, '2026-09-20 值班交接', '2.4 结转项保留原始来源交接');
eq(p99.originDue, `${D} 12:00`, '2.5 结转项保留原始要求完成时间');
eq(p99.dueText, `${D} 12:00`, '2.6 结转项未被自动延期到本次之后');
eq(p99.owner, '待明确', '2.7 责任人缺失写「待明确」');
ok(r.ho.pending.some((x) => x.tag === 'P-99'), '2.8 结转项同时进入 pending，未被丢弃');
ok(r.ho.warnings.some((w) => w.includes('P-99') && w.includes('未见处理')), '2.9 结转 warning 具体到事项');
ok(/P-99/.test(r.md), '2.10 md 中出现结转项 P-99');
ok(/上次交接遗留，本次未处理/.test(r.md), '2.11 md 中保留结转标注原文');
ok(!/上班次遗留/.test(r.md), '2.11b md 不再出现倒班口径的「上班次」');

// 路径 B：本次有记录但未闭环 → 结转，来源记回原始交接，保留原始期限
const p03 = carried.find((x) => x.tag === 'P-03') || {};
ok(!!p03.note, '2.12 本次跟进但未闭环的遗留项也计入结转');
eq(p03.originShift, '2026-09-20 值班交接', '2.13 未闭环结转项来源记回原始交接');
eq(p03.originDue, `${D} 10:00`, '2.14 未闭环结转项保留原始要求完成时间');
eq(p03.note, '上次交接遗留，本次已跟进但未闭环', '2.15 未闭环结转项标注本次已跟进');

// 路径 C：本次已闭环 → 不结转
ok(!carried.some((x) => x.tag === 'P-02'), '2.16 本次已闭环的遗留项不结转');
const pc = r.ho.prevClosed.find((x) => x.tag === 'P-02') || {};
eq(pc.closed, true, '2.17 已闭环遗留项在 prevClosed 中标记 closed');
eq(r.summary.counts.carriedOver, 2, '2.18 结转项计数（P-99 + P-03）');
eq(r.summary.counts.prevClosedOk, 1, '2.19 上次遗留闭环数');

// ================================================================ 3. 连续两次结转：第三次交接仍能看到第一次的遗留项
// 第二次：读第一次 handover.json
const shift2src = mk('shift2.xlsx', {
  '值班记录': [
    HDR,
    [`${D} 20:00`, 'P-01', '泵1', '状态变化', '由备用切运行', '已确认', '已完成', '张', ''],
  ],
});
const s2 = run(shift2src, ['--prev', path.join(r.out, 'handover.json')], 'shift2', { shift: '第二次值班', type: '休假交接' });
eq(s2.summary.ok, true, '3.1 第二次交接运行成功');
const s2p99 = s2.ho.carriedOver.find((x) => x.tag === 'P-99') || {};
ok(!!s2p99.note, '3.2 第二次仍结转 P-99');
eq(s2p99.originShift, '2026-09-20 值班交接', '3.3 第二次保留最初来源交接（非上一次）');
eq(s2p99.originDue, `${D} 12:00`, '3.4 第二次保留最初要求完成时间');
eq(s2p99.carryTimes, 2, '3.5 累计结转次数递增');
// 第三次：读第二次 handover.json
const s3 = run(shift2src, ['--prev', path.join(s2.out, 'handover.json')], 'shift3', { type: '调岗交接' });
const s3p99 = s3.ho.carriedOver.find((x) => x.tag === 'P-99') || {};
ok(!!s3p99.note, '3.6 第三次仍能看到第一次的遗留项 P-99');
eq(s3p99.originShift, '2026-09-20 值班交接', '3.7 第三次仍指向最初来源交接');
eq(s3p99.originDue, `${D} 12:00`, '3.8 连续结转未自动延期');
eq(s3p99.carryTimes, 3, '3.9 第三次累计结转次数为 3');
ok(/P-99/.test(s3.md), '3.10 第三次 md 仍列出该遗留项');
ok(/设备员调岗交接记录/.test(s3.md), '3.11 调岗交接类型写入标题');
ok(s3.ho.pending.some((x) => x.tag === 'P-99' && x.source === '2026-09-20 值班交接'), '3.12 结转项 source 指向最初来源而非上一次交接标签');

// ================================================================ 4. 责任人 / 期限缺失写「待明确」，绝不省略条目
const miss = mk('missing.xlsx', {
  '值班记录': [
    HDR,
    [`${D} 20:00`, 'P-11', '泵11', '异常处理', '出口压力波动', '已切备用泵', '未完成', '', ''],
    [`${D} 21:00`, 'P-12', '泵12', '异常处理', '声音异常', '观察中', '未完成', '孙', ''],
  ],
});
r = run(miss, [], 'missing');
eq(r.summary.counts.pending, 2, '4.1 责任人缺失的事项仍完整保留');
const m11 = r.ho.pending.find((x) => x.tag === 'P-11') || {};
eq(m11.owner, '待明确', '4.2 责任人缺失写「待明确」');
eq(m11.dueText, '待明确', '4.3 要求完成时间缺失写「待明确」');
eq(m11.ownerMissing, true, '4.4 标记 ownerMissing 供下游识别');
ok(/P-11/.test(r.md) && /待明确/.test(r.md), '4.5 md 中该条未被省略且写「待明确」');

// ================================================================ 5. --time 强校验
function runRaw(args) {
  const x = spawnSync(process.execPath, [HO, ...args], { encoding: 'utf8' });
  const lines = x.stdout.trim().split('\n');
  try { return { code: x.status, s: JSON.parse(lines[lines.length - 1]) }; } catch (e) { return { code: x.status, s: { ok: false, error: 'no-json' } }; }
}
const OKARGS = ['--input', base, '--workshop', '车间', '--type', '值班交接', '--by', '张'];
let x = runRaw([...OKARGS, '--time', '今天早上']);
eq(x.s.ok, false, '5.1 模糊时间报错');
eq(x.code, 1, '5.2 退出码为 1');
ok(/ISO 8601/.test(x.s.error), '5.3 错误信息说明需带时区 ISO 8601');
x = runRaw([...OKARGS, '--time', '2026-09-22']);
eq(x.s.ok, false, '5.4 仅日期无时点报错');
x = runRaw([...OKARGS, '--time', '2026-09-22T08:00:00']);
eq(x.s.ok, false, '5.5 无时区的时点报错');
x = runRaw([...OKARGS, '--time', '2026-09-22T08:00:00+08:00']);
eq(x.s.ok, true, '5.6 带时区 ISO 8601 通过');
x = runRaw([...OKARGS, '--time', '2026-13-45T08:00:00+08:00']);
eq(x.s.ok, false, '5.7 非法月日报错');

// ================================================================ 6. 在修设备无状态说明 → warning
const rep = mk('repair.xlsx', {
  '值班记录': [HDR, [`${D} 20:00`, 'P-01', '泵1', '状态变化', '投用', '正常', '已完成', '张', '']],
  '在修设备': [
    ['功能位置', '设备描述', '当前状态', '订单', '主工作中心', '基本结束日期'],
    ['E-01', '换热器1', '已抽芯清洗中', '4000001', '王', '2026-09-23 12:00'],
    ['E-02', '换热器2', '', 'WO-2', '王', ''],
  ],
});
r = run(rep, [], 'repair');
eq(r.summary.counts.inRepair, 2, '6.1 在修设备数（SAP 列名 功能位置/设备描述/订单/主工作中心/基本结束日期 可读）');
eq((r.ho.inRepair.find((y) => y.tag === 'E-01') || {}).order, '4000001', '6.1b SAP「订单」归工单号');
eq((r.ho.inRepair.find((y) => y.tag === 'E-01') || {}).eta, '2026-09-23 12:00', '6.1c 基本结束日期归预计完工');
ok(r.ho.warnings.some((w) => w.includes('E-02') && w.includes('无当前状态说明')), '6.2 在修无状态说明 warning');
eq((r.ho.inRepair.find((y) => y.tag === 'E-02') || {}).state, null, '6.3 无状态说明为 null，不猜测');
ok(/E-02/.test(r.md) && /无状态说明，需当面确认/.test(r.md), '6.4 md 标注需当面确认');
ok(r.ho.focusItems.some((f) => f.tag === 'E-02'), '6.5 在修无状态说明进入重点关注');

// ================================================================ 7. 未判定：事项类型 / 完成状态
const und = mk('undet.xlsx', {
  '值班记录': [
    HDR,
    [`${D} 20:00`, 'P-21', '泵21', '待定', '取压管疑似堵塞', '', '未完成', '赵', ''],
    [`${D} 21:00`, 'P-22', '泵22', '异常处理', '温度偏高', '已调整观察', '观察中', '张', ''],
    [`${D} 22:00`, 'P-23', '泵23', '', '阀门内漏', '已记录', '已完成', '张', ''],
  ],
});
r = run(und, [], 'undet');
eq(r.summary.counts.undetermined, 2, '7.1 事项类型未判定 2 条（「待定」+ 空）');
eq(r.summary.counts.statusUndetermined, 1, '7.2 完成状态未判定 1 条（「观察中」）');
eq(r.summary.counts.statusChanges, 0, '7.3 未归类事项未被默认塞入状态变化');
eq(r.summary.counts.abnormalHandled, 1, '7.4 未归类事项未被默认塞入异常处理');
ok(r.ho.pending.some((y) => y.tag === 'P-22'), '7.5 状态未判定的事项仍随本次交接（就严）');
eq((r.ho.pending.find((y) => y.tag === 'P-22') || {}).stateDetermined, false, '7.6 标记状态未判定');
ok(/## 七、未判定事项/.test(r.md), '7.7 md 单列未判定一节');
ok(r.ho.focusItems.some((f) => f.reason.includes('完成状态未判定')), '7.8 状态未判定进入重点关注');

// ================================================================ 8. 合计行 / 标题行表头 / 别名列头
const mes = mk('mes.xlsx', {
  '工作记录': [
    ['某厂设备员工作记录导出'],
    [],
    ['发生时间', '设备位号', '名称', '类型', '事项内容', '处置情况', '完成情况', '负责人', '计划完成时间'],
    [`${D} 19:00`, 'P-31', '泵31', '异常', '轴温偏高', '已加脂', '未完成', '周', `${D} 23:00`],
    [`${D} 20:00`, 'P-32', '泵32', '状态变更', '投用', '正常', '已完成', '周', ''],
    ['合计', '', '', '', '', '', '', '', ''],
  ],
});
r = run(mes, [], 'mes');
eq(r.summary.ok, true, '8.1 导出风格可读');
eq(r.summary.counts.records, 2, '8.2 合计行被跳过');
ok(r.ho.warnings.some((w) => w.includes('合计行')), '8.3 合计行 warning');
eq(r.summary.counts.abnormalHandled, 1, '8.4 别名列头「类型/事项内容」识别正确');
eq(r.summary.counts.statusChanges, 1, '8.5 「状态变更」归入状态变化');

// ================================================================ 9. 参数校验
x = runRaw(['--input']);
eq(x.s.ok, false, '9.1 --input 缺值报错');
ok(/缺少取值/.test(x.s.error), '9.2 缺值错误信息正确');
x = runRaw(['--input', base, '--type', '值班交接', '--time', TIME, '--by', '张']);
eq(x.s.ok, false, '9.3 缺 --workshop 报错');
x = runRaw(['--input', base, '--workshop', '车间', '--time', TIME, '--by', '张']);
eq(x.s.ok, false, '9.4 缺 --type 报错');
ok(/值班交接 \/ 休假交接 \/ 调岗交接/.test(x.s.error) && /操作班组/.test(x.s.error), '9.4b 错误信息列出三种交接类型并排除操作班组交接班');
x = runRaw(['--input', base, '--workshop', '车间', '--type', '夜班交接班', '--time', TIME, '--by', '张']);
eq(x.s.ok, false, '9.4c --type 取值「夜班交接班」被拒绝');
x = runRaw(['--input', base, '--workshop', '车间', '--type', '休假交接', '--time', TIME, '--by', '张', '--out', path.join(work, 'noshift-out')]);
eq(x.s.ok, true, '9.4d --shift 可选，不传也能运行');
eq(x.s.type, '休假交接', '9.4e summary 记录交接类型');
x = runRaw(['--input', base, '--workshop', '车间', '--type', '值班交接', '--time', TIME]);
eq(x.s.ok, false, '9.5 缺 --by 报错');
x = runRaw([...OKARGS, '--time', TIME, '--未知参数', 'x']);
eq(x.s.ok, false, '9.6 未知参数报错');
x = runRaw(['--input', '/不存在的路径.xlsx', '--workshop', '车间', '--type', '值班交接', '--time', TIME, '--by', '张']);
eq(x.s.ok, false, '9.7 输入不存在报错');
x = runRaw([...OKARGS, '--time', TIME, '--prev', '/不存在的上班记录.json']);
eq(x.s.ok, false, '9.8 --prev 不存在报错');

// ================================================================ 10. 无「本班记录」表 → ok:false exit 1
const bad = mk('bad.xlsx', { '随便一张表': [['a', 'b'], [1, 2]] });
r = run(bad, [], 'bad');
eq(r.summary.ok, false, '10.1 无本次记录表时 ok:false');
eq(r.code, 1, '10.2 退出码为 1');
ok(/未在输入中找到/.test(r.summary.error), '10.3 错误信息明确');

// ================================================================ 11. 位号为空不丢事项
const notag = mk('notag.xlsx', {
  '本班记录': [   // 旧 sheet 名仍可识别
    HDR,
    [`${D} 20:00`, '', '', '异常处理', '三楼平台有异响来源未确认', '已记录待查', '未完成', '', ''],
    [`${D} 21:00`, 'P-41', '泵41', '状态变化', '投用', '正常', '已完成', '张', ''],
  ],
});
r = run(notag, [], 'notag');
eq(r.summary.counts.records, 2, '11.1 位号为空的事项未被丢弃（旧 sheet 名「本班记录」仍可读）');
eq((r.ho.pending.find((y) => y.content.includes('异响')) || {}).tag, '待明确', '11.2 位号缺失记为「待明确」');
ok(r.ho.warnings.some((w) => w.includes('位号为空') && w.includes('仍予保留')), '11.3 位号为空 warning 说明已保留');

// ================================================================ 12. 声明行与产出结构
r = run(base, ['--prev', prevXlsx, '--to', '李设备'], 'struct');
ok(/交接以双方现场确认签字为准，本记录为辅助整理/.test(r.md), '12.1 md 保留声明行');
eq((r.md.match(/交接以双方现场确认签字为准，本记录为辅助整理/g) || []).length >= 2, true, '12.2 声明行在开头与签字栏均出现');
eq(r.ho.meta.declaration, '交接以双方现场确认签字为准，本记录为辅助整理', '12.3 json 中记录声明行');
ok(/## 一、交接信息/.test(r.md) && /## 二、设备状态变化/.test(r.md) && /## 三、异常与处理/.test(r.md)
  && /## 四、在修设备状态/.test(r.md) && /## 五、未完成事项/.test(r.md) && /## 六、需重点关注事项/.test(r.md)
  && /## 八、交接说明/.test(r.md) && /## 九、交接签字/.test(r.md), '12.4 各章节齐全');
ok(/<!-- ANALYSIS_START -->/.test(r.md) && /<!-- ANALYSIS_END -->/.test(r.md), '12.5 分析段占位符存在');
ok(/2026-09-22 08:00:00/.test(r.md), '12.6 交接时间明确到时点（北京时间）');
ok(/2026-09-22T08:00:00\+08:00/.test(r.md), '12.7 md 保留原始 ISO 入参');
eq(r.ho.meta.to, '李设备', '12.8 接手人写入 meta');
r = run(base, [], 'noto');
ok(/接手人 \| 待明确/.test(r.md), '12.9 接手人未提供时写「待明确」');
ok(!/⚠|✅|❌/.test(r.md), '12.10 产出 md 不含 emoji');
ok(/【注意】/.test(run(base, ['--prev', prevXlsx], 'notice').md), '12.11 结转提示用「【注意】」');

// ================================================================ 13. summary.json 落盘
r = run(base, [], 'summaryfile');
ok(fs.existsSync(path.join(r.out, 'summary.json')), '13.1 summary.json 已写入');
const sj = JSON.parse(fs.readFileSync(path.join(r.out, 'summary.json'), 'utf8'));
eq(sj.ok, true, '13.2 summary.json 内容正确');
ok(fs.existsSync(path.join(r.out, 'handover.json')), '13.3 handover.json 已写入');

// ================================================================ 14. 超期事项进入重点关注
const over = mk('overdue.xlsx', {
  '值班记录': [
    HDR,
    [`${D} 20:00`, 'P-51', '泵51', '异常处理', '密封件待更换', '已申请备件', '未完成', '张', `${D} 22:00`],
    [`${D} 20:30`, 'P-52', '泵52', '异常处理', '待复查振动', '已安排', '未完成', '张', '2026-09-30 08:00'],
  ],
});
r = run(over, [], 'overdue');
ok(r.ho.focusItems.some((f) => f.tag === 'P-51' && f.reason.includes('已超过交接时点')), '14.1 超期事项进入重点关注');
ok(!r.ho.focusItems.some((f) => f.tag === 'P-52'), '14.2 未到期事项不误报超期');

// ================================================================ 15. JSON 形式的 --prev
r = run(base, ['--prev', prevXlsx], 'jsonprev-src');
const jsonPrev = path.join(r.out, 'handover.json');
r = run(shift2src, ['--prev', jsonPrev], 'jsonprev');
eq(r.summary.ok, true, '15.1 JSON 形式 --prev 可读');
ok(r.ho.carriedOver.length >= 2, '15.2 JSON --prev 的未完成事项全部核对');
ok(r.ho.carriedOver.every((y) => y.originShift && y.originDue !== undefined), '15.3 结转项均带原始来源与原始期限');

// ================================================================ 16. 与 worklog-todo-manager 的衔接字段
r = run(base, ['--prev', prevXlsx], 'worklog');
ok(r.ho.pending.every((x) => 'tag' in x && 'content' in x && 'state' in x && 'owner' in x && 'due' in x && 'dueText' in x && 'originShift' in x && 'carryTimes' in x), '16.1 pending 每条含 worklog 读取的字段');
ok(r.ho.focusItems !== undefined && r.ho.carriedOver !== undefined, '16.2 focusItems / carriedOver 存在');
// 设备编号不作位号：SAP「设备」列是流水号
const sap = mk('sap.xlsx', {
  '值班记录': [['发生时间', '功能位置', '设备', '设备描述', '事项类型', '通知单描述', '处理情况', '状态', '责任人', '基本结束日期'],
    [`${D} 20:00`, 'P-61', '10000061', '泵61', '异常处理', '机封漏', '已报通知单', '未完成', '张', `${D} 23:00`]],
});
r = run(sap, [], 'sap');
eq(r.summary.counts.records, 1, '16.3 SAP 列名的记录可读');
eq(r.ho.pending[0].tag, 'P-61', '16.4 功能位置归位号，「设备」流水号不作位号');
eq(r.ho.pending[0].content, '机封漏', '16.5 通知单描述归内容');
eq(r.ho.pending[0].due, `${D} 23:00`, '16.6 基本结束日期归要求完成时间');

// ================================================================ 17. SAP 状态码归一（口径对照第四节：CLSD/NOCO 已闭环，TECO/CNF 待验收不算闭环）
const sapSt = mk('sap-status.xlsx', {
  '本次记录': [
    HDR,
    [`${D} 08:10`, 'P-71', '泵71', '异常处理', '机封渗漏', '已更换机封', 'CLSD', '张', ''],
    [`${D} 08:20`, 'P-72', '泵72', '异常处理', '轴承异响', '已更换轴承', 'NOCO', '张', ''],
    [`${D} 08:30`, 'P-73', '泵73', '异常处理', '出口法兰渗漏', '已紧固，待验收', 'TECO', '王检修', ''],
    [`${D} 08:40`, 'P-74', '泵74', '异常处理', '振动偏高', '已报通知单', 'OSNO', '李', ''],
    [`${D} 08:50`, 'P-75', '泵75', '异常处理', '冷却水管堵', '已派工', 'REL', '李', ''],
    [`${D} 09:00`, 'P-76', '泵76', '异常处理', '油位计破损', '已更换', '技术完成', '李', ''],
    [`${D} 09:10`, 'P-77', '泵77', '异常处理', '密封冲洗管漏', '已焊补', 'REL CNF', '李', ''],
    [`${D} 09:20`, 'P-78', '泵78', '异常处理', '联轴器护罩松动', '已紧固', '已关闭', '李', ''],
    [`${D} 09:30`, 'P-79', '泵79', '异常处理', '重复报的通知单', '', 'DLFL', '李', ''],
    [`${D} 09:40`, 'P-80', '泵80', '异常处理', '压力表失灵', '已报仪表', 'CRTD', '赵', ''],
  ],
});
r = run(sapSt, [], 'sap-status');
eq(r.summary.ok, true, '17.1 SAP 状态码记录可运行');
eq(r.summary.counts.statusUndetermined, 1, '17.2 SAP 状态码不再整体判「状态未判定」，仅 DLFL（已取消，需确认）1 条');
eq(r.summary.counts.abnormalClosed, 3, '17.3 CLSD / NOCO / 已关闭 判已闭环（3 条）');
const sp = (t) => r.ho.pending.find((y) => y.tag === t);
ok(!sp('P-71') && !sp('P-72') && !sp('P-78'), '17.4 CLSD / NOCO / 已关闭 不进未完成事项');
ok(!!sp('P-73') && sp('P-73').stateDetermined === true, '17.5 TECO（技术完成）不算闭环，进未完成事项且状态已判定');
ok(/待验收/.test((sp('P-73') || {}).state || ''), '17.6 TECO 未完成事项注明「待验收」');
ok(!!sp('P-76') && /待验收/.test(sp('P-76').state), '17.7 「技术完成」归待验收，不按已完成销账');
ok(!!sp('P-74') && sp('P-74').stateDetermined === true, '17.8 OSNO（通知单未处理）判未完成');
ok(!!sp('P-75') && sp('P-75').stateDetermined === true, '17.9 REL（已下达）判未完成');
ok(!!sp('P-77') && /待验收/.test(sp('P-77').state), '17.10 多码组合「REL CNF」取最靠后的状态（待验收）');
ok(!!sp('P-80') && sp('P-80').stateDetermined === true, '17.11 CRTD（已创建）判未完成');
ok(!!sp('P-79') && sp('P-79').stateDetermined === false, '17.12 DLFL（删除标记）不默认销账，随本次交接并标状态未判定');
ok(r.ho.statusUndetermined.some((y) => y.tag === 'P-79' && /已取消|删除标记/.test(y.reason)), '17.13 DLFL 未判定原因写明已取消/删除标记需确认');
eq(r.summary.counts.pending, 7, '17.14 未完成事项 7 条（TECO/OSNO/REL/技术完成/REL CNF/CRTD + DLFL 待确认）');
ok(!r.ho.warnings.some((w) => /「(CLSD|NOCO|TECO|OSNO|REL|CRTD)」无法判定/.test(w)), '17.15 SAP 状态码不再出「无法判定」warning');
// 中文「已删除」（EAM 导出的 DLFL 中文写法）与 DLFL 同口径：列入待确认并写明已取消/删除，不销账、不按未完成
const delSt = mk('deleted-status.xlsx', {
  '本次记录': [
    HDR,
    [`${D} 09:30`, 'P-81', '泵81', '异常处理', '重复报的通知单', '', '已删除', '李', ''],
    [`${D} 09:40`, 'P-82', '泵82', '异常处理', '误建工单', '', '删除', '李', ''],
  ],
});
r = run(delSt, [], 'deleted-status');
eq(r.summary.counts.statusUndetermined, 2, '17.17 「已删除」「删除」与 DLFL 同口径，列入状态未判定（待确认）');
ok(r.ho.statusUndetermined.every((y) => /已取消/.test(y.reason)), '17.18 原因写明已取消/删除标记需确认，不是笼统的「无法判定」');
ok(!r.ho.warnings.some((w) => /「(已删除|删除)」无法判定/.test(w)), '17.19 「已删除」不再出「无法判定」warning');
// 原有中文状态口径不变
r = run(base, [], 'sap-status-cn');
eq(r.summary.counts.pending, 2, '17.16 中文「已完成 / 未完成」口径不变');

// ================================================================ 18. 「要求完成时间已过」统一按北京时间（+08:00）解析，与主机时区无关
const tz = mk('tz.xlsx', {
  '本次记录': [
    HDR,
    // 交接时点 2026-09-22 08:00（北京时间）
    [`${D} 20:00`, 'P-91', '泵91', '异常处理', '机封待更换', '已申请备件', '未完成', '张', '2026-09-22 07:30'],   // 已过 30 分钟
    [`${D} 20:10`, 'P-92', '泵92', '异常处理', '振动复测', '已安排', '未完成', '张', '2026-09-22 10:00'],      // 未到
  ],
});
for (const zone of ['UTC', 'Pacific/Kiritimati', 'America/Los_Angeles', 'Asia/Shanghai']) {
  r = run(tz, [], `tz-${zone.replace(/\W/g, '')}`, { env: { TZ: zone } });
  ok(r.ho.focusItems.some((f) => f.tag === 'P-91' && f.reason.includes('已超过交接时点')), `18.1 TZ=${zone}：北京时间 07:30 到期、08:00 交接判已超期`);
  ok(!r.ho.focusItems.some((f) => f.tag === 'P-92'), `18.2 TZ=${zone}：北京时间 10:00 到期不误报超期`);
}

// ================================================================ 19. make-sample 主样例结论与 README 一致
{
  const msOut = path.join(work, 'ms');
  const ms = spawnSync(process.execPath, [path.join(__dirname, 'make-sample.js'), '--out', msOut, '--seed', '3'], { encoding: 'utf8' });
  eq(ms.status, 0, '19.1 make-sample 运行成功');
  const mainS = path.join(msOut, 'sample-handover-2026-09-21.xlsx');
  r = run(mainS, [], 'ms-main');
  eq(r.summary.counts.pending, 5, '19.2 主样例（不带 --prev）未完成事项 5 项');
  eq(r.summary.counts.statusChanges, 3, '19.3 主样例状态变化 3 项');
  eq(r.summary.counts.abnormalHandled, 5, '19.4 主样例异常处理 5 项');
  r = run(mainS, ['--prev', path.join(msOut, 'sample-prev-handover-2026-09-20.xlsx')], 'ms-main-prev');
  eq(r.summary.counts.pending, 6, '19.5 主样例带上次交接 --prev 后未完成事项 6 项（含 1 项本次未处理结转）');
  eq(r.summary.counts.carriedOver, 2, '19.6 带 --prev 结转 2 项');
}

// ================================================================ 输出
console.log(`\n${'='.repeat(56)}`);
console.log(`shift-handover-record 自测：${pass} 通过，${fail} 失败`);
if (failures.length) { console.log('\n失败项：'); failures.forEach((f) => console.log('  ✗ ' + f)); }
console.log('='.repeat(56));
try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
