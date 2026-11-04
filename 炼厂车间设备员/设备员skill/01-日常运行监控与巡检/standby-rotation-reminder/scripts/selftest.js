#!/usr/bin/env node
'use strict';
/**
 * 自测：生成变体输入并断言 rotation.js 行为。用法：node scripts/selftest.js（全绿退出 0）
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { writeXlsx } = require('./lib/xlsx-lite');
const C = require('./lib/common');

const ROT = path.join(__dirname, 'rotation.js');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'srr-selftest-'));
const DATE = '2026-09-21';
const back = (n) => C.addDays(DATE, -n);
let pass = 0, fail = 0;
const failures = [];

function ok(cond, name) { if (cond) { pass++; } else { fail++; failures.push(name); } }
function eq(actual, expect, name) { ok(actual === expect, `${name}（期望 ${JSON.stringify(expect)}，实际 ${JSON.stringify(actual)}）`); }

function run(file, extra = [], tag) {
  const out = path.join(work, (tag || path.basename(file, '.xlsx')) + '-out');
  const r = spawnSync(process.execPath, [ROT, '--input', file, '--workshop', '测试车间', '--date', DATE, '--out', out, ...extra], { encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  let summary;
  try { summary = JSON.parse(lines[lines.length - 1]); } catch (e) { summary = { ok: false, error: 'no-json:' + r.stdout + r.stderr }; }
  let rot = null, md = null;
  if (fs.existsSync(path.join(out, 'rotation.json'))) rot = JSON.parse(fs.readFileSync(path.join(out, 'rotation.json'), 'utf8'));
  if (fs.existsSync(path.join(out, 'rotation-report.md'))) md = fs.readFileSync(path.join(out, 'rotation-report.md'), 'utf8');
  return { code: r.status, summary, rot, md, out };
}
function mk(name, book) { const p = path.join(work, name); writeXlsx(p, book); return p; }

const LED_HDR = ['主用位号', '备用位号', '设备名称', '机组', '切换周期', '盘车周期', '试运周期', '上次切换日期', '上次盘车日期', '上次试运日期'];
const REC_HDR = ['日期', '位号', '作业类型', '执行人', '备注'];

// ---- 1. 基础：切换与盘车的逾期/临期/周期内分档
const base = mk('base.xlsx', {
  '备用设备台账': [LED_HDR,
    // 切换逾期 30 天（90 天周期，上次 120 天前）；盘车周期内
    ['P-01A', 'P-01B', '泵1', 'P-01', '3个月', '14天', '', back(120), back(2), ''],
    // 切换剩 2 天 → 临期（lead 3）；盘车逾期 6 天
    ['P-02A', 'P-02B', '泵2', 'P-02', '90天', '7天', '', back(88), back(13), ''],
    // 全周期内
    ['P-03A', 'P-03B', '泵3', 'P-03', '1年', '14天', '', back(30), back(1), ''],
  ],
});
let r = run(base, [], 'base');
eq(r.summary.ok, true, '1.1 基础运行成功');
eq(r.summary.counts.pairs, 3, '1.2 已配对主备组数');
eq(r.summary.counts.switchOverdue, 1, '1.3 切换逾期数');
eq(r.summary.counts.switchDueSoon, 1, '1.4 切换临期数');
eq(r.summary.counts.switchNormal, 1, '1.5 切换周期内数');
eq(r.summary.counts.turningOverdue, 1, '1.6 盘车逾期数');
eq(r.summary.counts.turningNormal, 2, '1.7 盘车周期内数');
eq(r.summary.counts.undetermined, 0, '1.8 无未判定项');
eq(r.rot.switchOverdue[0].overdueDays, 30, '1.9 切换逾期天数计算正确');
eq(r.rot.switchOverdue[0].dueDate, back(30), '1.10 应到期日 = 上次执行日期 + 周期');
eq(r.rot.switchDueSoon[0].remainDays, 2, '1.11 临期剩余天数正确');
eq(r.rot.turningOverdue[0].overdueDays, 6, '1.12 盘车逾期天数正确');
eq(r.rot.meta.declaration, '切换实施前需由工艺确认具备切换条件并按操作票执行，本清单仅为周期提醒', '1.13 说明行写入 meta');
eq(r.rot.switchOverdue[0].groupKey, 'P-01', '1.14 机组列作为机组键');
eq(r.rot.pairs[0].roleSource, '台账', '1.15 无记录表时当前主用按台账');

// ---- 2. --lead-days 改变临期窗口
r = run(base, ['--lead-days', '1'], 'lead1');
eq(r.summary.counts.switchDueSoon, 0, '2.1 lead-days=1 时不算临期');
eq(r.summary.counts.switchNormal, 2, '2.2 临期项转入周期内');
r = run(base, ['--lead-days', '400'], 'lead400');
eq(r.summary.counts.switchDueSoon, 2, '2.3 lead-days 放大后临期数增加');

// ---- 3. 未判定：周期/上次执行日期缺失或无法解析 —— 绝不按默认周期替用户设定
const und = mk('undetermined.xlsx', {
  '备用设备台账': [LED_HDR,
    ['P-01A', 'P-01B', '泵1', '', '', '14天', '', back(400), back(2), ''],          // 切换周期空
    ['P-02A', 'P-02B', '泵2', '', '3个月', '14天', '', '', back(2), ''],            // 上次切换日期空
    ['P-03A', 'P-03B', '泵3', '', '随机组检修', '14天', '', back(400), back(2), ''], // 周期无法解析
    ['P-04A', 'P-04B', '泵4', '', '3个月', '14天', '', '去年冬天', back(2), ''],     // 日期无法解析
    ['P-05A', 'P-05B', '泵5', '', '3个月', '', '', back(10), back(2), ''],           // 盘车周期空
    ['P-06A', 'P-06B', '泵6', '', '3个月', '14天', '', back(10), back(2), ''],       // 正常
  ],
});
r = run(und, [], 'und');
eq(r.summary.counts.undetermined, 5, '3.1 五类缺失全部计入未判定');
eq(r.summary.counts.switchOverdue, 0, '3.2 未判定项不计入逾期（未按最严默认）');
eq(r.summary.counts.switchDueSoon, 0, '3.3 未判定项不计入临期');
eq(r.summary.counts.switchNormal, 2, '3.4 未判定项不计入正常（未按最宽松默认）');
ok(r.rot.undetermined.every((x) => x.dueDate === null && x.daysDiff === null), '3.5 未判定项不生成应到期日');
ok(r.rot.undetermined.some((x) => x.reason.includes('切换周期为空')), '3.6 切换周期为空原因标注');
ok(r.rot.undetermined.some((x) => x.reason.includes('上次切换日期为空')), '3.7 上次切换日期为空原因标注');
ok(r.rot.undetermined.some((x) => x.reason.includes('盘车周期为空')), '3.8 盘车周期为空原因标注');
ok(r.rot.undetermined.some((x) => x.reason.includes('无法解析')), '3.9 无法解析原因标注');
eq(r.rot.warnings.filter((w) => w.includes('未按默认周期处理')).length, 5, '3.10 每条未判定均有 warning');
ok(/未按默认周期（如一月一次）替用户设定/.test(r.md), '3.11 报告明示未按默认周期替用户设定');
ok(r.rot.undetermined.every((x) => x.periodDays === null || x.lastDate === null), '3.12 未判定项不补齐缺失字段');
ok(/【未判定】/.test(r.md), '3.13 未判定节用「【未判定】」提示');
ok(!r.rot.warnings.some((w) => w.includes('无「机组/泵组」列')), '3.14 有机组列（即使为空）不报无机组列 warning');
eq(r.rot.pairs.find((p) => p.mainTag === 'P-06A').groupKey, 'P-06A/P-06B', '3.15 机组列为空时机组键 = 主用/备用位号组合');

// ---- 4. 长期未切换项仍来自已判定项，不因未判定而丢失（P-01A 周期空 → 不进 longIdle 但也不按默认周期）
ok(!r.rot.longIdle.some((x) => x.mainTag === 'P-01A'), '4.1 周期缺失的项不参与长期未切换判定（未补默认周期）');

// ---- 5. 主备位号无法配对 → 单列 warning，绝不猜测配对关系
const pairbad = mk('pairbad.xlsx', {
  '备用设备台账': [LED_HDR,
    ['P-01A', '', '泵1', '常压', '3个月', '14天', '', back(120), back(2), ''],   // 备用位号空
    ['', 'P-02B', '泵2', '常压', '3个月', '14天', '', back(120), back(2), ''],   // 主用位号空
    ['P-03A', 'P-03A', '泵3', '常压', '3个月', '14天', '', back(120), back(2), ''], // 主备同号
    ['P-04A', 'P-04B', '泵4', '常压', '3个月', '14天', '', back(120), back(2), ''],
  ],
});
r = run(pairbad, [], 'pairbad');
eq(r.summary.counts.pairingIssues, 3, '5.1 三类配对异常全部单列');
eq(r.summary.counts.pairs, 1, '5.2 只有真正成对的行参与判定');
eq(r.summary.counts.switchOverdue, 1, '5.3 配对异常行不参与到期判定（未猜测配对后判逾期）');
eq(r.summary.counts.undetermined, 0, '5.4 配对异常行不混入未判定清单');
ok(r.rot.pairingIssues.some((x) => x.reason.includes('备用位号为空')), '5.5 备用位号为空原因标注');
ok(r.rot.pairingIssues.some((x) => x.reason.includes('主用位号为空')), '5.6 主用位号为空原因标注');
ok(r.rot.pairingIssues.some((x) => x.reason.includes('相同')), '5.7 主备同号原因标注');
eq(r.rot.warnings.filter((w) => w.includes('未自行猜测配对关系')).length, 3, '5.8 每条配对异常均有 warning');
ok(/未自行猜测配对关系/.test(r.md), '5.9 报告明示未自行猜测配对关系');
ok(r.rot.pairingIssues.every((x) => x.row > 0 && x.sheet === '备用设备台账'), '5.10 配对异常保留出处行号');
ok(!r.rot.executionRate || !r.rot.executionRate.byPair.some((x) => x.mainTag === 'P-01A'), '5.11 配对异常不进执行率统计');

// ---- 6. 执行率：分母为 0 → null 显示「—」，绝不写 0%
const rate = mk('rate.xlsx', {
  '备用设备台账': [LED_HDR,
    // 90 天周期，区间 180 天 → 计划 2 次，实际 1 次 → 50%
    ['P-01A', 'P-01B', '泵1', '常压', '3个月', '14天', '', back(120), back(2), ''],
    // 5 年周期 → 区间内计划 0 次 → 分母 0，执行率 null
    ['P-02A', 'P-02B', '泵2', '常压', '5y', '14天', '', back(120), back(2), ''],
  ],
  '切换盘车记录': [REC_HDR,
    [back(120), 'P-01A', '主备切换', '张班', ''],
    [back(30), 'P-02A', '主备切换', '张班', ''],
  ],
});
r = run(rate, ['--from', back(180)], 'rate');
const sw1 = r.rot.executionRate.byPair.find((x) => x.mainTag === 'P-01A' && x.kind === 'switch');
const sw2 = r.rot.executionRate.byPair.find((x) => x.mainTag === 'P-02A' && x.kind === 'switch');
eq(sw1.planned, 2, '6.1 计划次数 = 区间天数 / 周期天数');
eq(sw1.actual, 1, '6.2 实际执行次数来自记录表');
eq(sw1.rate, 50, '6.3 执行率 = 实际 / 计划');
eq(sw2.planned, 0, '6.4 长周期在区间内计划次数为 0');
eq(sw2.rate, null, '6.5 分母为 0 时执行率为 null 而非 0');
ok(r.rot.warnings.some((w) => w.includes('机组「常压」与第') && w.includes('重复')), '6.0 同一机组号重复出现 warning 且不合并');
const zeroRow = r.md.split('\n').find((l) => l.startsWith('| 常压 | P-02A | P-02B | 切换'));
ok(zeroRow && /\|\s*—\s*\|\s*$/.test(zeroRow) && !zeroRow.includes('0.0%'), `6.6 分母为 0 的行执行率列显示「—」而非 0%（实际：${zeroRow}）`);
ok(r.rot.warnings.some((w) => w.includes('未写 0%')), '6.7 分母为 0 有 warning 且明示不写 0%');
ok(/不按 0% 计/.test(r.md), '6.8 报告明示不按 0% 计');
ok(/\| — \|/.test(r.md), '6.9 执行率为 null 时 md 显示「—」');
ok(r.rot.warnings.some((w) => w.includes('无「切换后主用」列')) && r.rot.pairs.every((p) => p.roleSource.startsWith('台账')), '6.10 记录表无切换方向列 → warning，当前主用按台账（未按次数奇偶猜测）');

// ---- 7. 执行率：周期缺失 → 计划次数 null，不按 0 计
const rateNoPeriod = mk('rate-noperiod.xlsx', {
  '备用设备台账': [LED_HDR, ['P-01A', 'P-01B', '泵1', '常压', '', '14天', '', back(120), back(2), '']],
  '切换盘车记录': [REC_HDR, [back(30), 'P-01A', '主备切换', '张班', '']],
});
r = run(rateNoPeriod, ['--from', back(180)], 'ratenop');
const sw3 = r.rot.executionRate.byPair.find((x) => x.kind === 'switch');
eq(sw3.planned, null, '7.1 周期缺失时计划次数为 null 而非 0');
eq(sw3.rate, null, '7.2 计划次数 null 时执行率为 null');
ok(r.rot.warnings.some((w) => w.includes('未按 0 计')), '7.3 warning 明示未按 0 计');
eq(r.rot.executionRate.overall.switch.rate, null, '7.4 合计执行率无可用分母时为 null');

// ---- 8. 执行率：记录位号不在台账中、作业类型无法归类 → 不计入，不猜测
const rateOdd = mk('rate-odd.xlsx', {
  '备用设备台账': [LED_HDR, ['P-01A', 'P-01B', '泵1', '常压', '3个月', '14天', '', back(120), back(2), '']],
  '切换盘车记录': [REC_HDR,
    [back(30), 'P-01A', '主备切换', '张班', ''],
    [back(20), 'P-99X', '主备切换', '张班', '台账无此位号'],
    [back(10), 'P-01B', '检查', '张班', '类型无法归类'],
    [back(300), 'P-01A', '主备切换', '张班', '区间外'],
  ],
});
r = run(rateOdd, ['--from', back(180)], 'rateodd');
eq(r.summary.counts.records, 4, '8.1 记录总条数');
eq(r.summary.counts.countedRecords, 1, '8.2 只有位号可归属、类型可归类且在区间内的记录计入');
ok(r.rot.warnings.some((w) => w.includes('无对应机组')), '8.3 台账无对应机组 warning');
ok(r.rot.warnings.some((w) => w.includes('未自行猜测归属')), '8.4 warning 明示未自行猜测归属');
ok(r.rot.warnings.some((w) => w.includes('无法归入切换/盘车/试运')), '8.5 作业类型无法归类 warning');
eq(r.rot.records.outOfRange, 1, '8.6 区间外记录单独计数');
// 记录表混入其他车间（全厂导出）：台账外位号多条时合并为一条 warning，列出位号与行号，不逐行刷屏
const rateMix = mk('rate-mix.xlsx', {
  '备用设备台账': [LED_HDR, ['P-01A', 'P-01B', '泵1', '常压', '3个月', '14天', '', back(120), back(2), '']],
  '切换盘车记录': [REC_HDR,
    [back(30), 'P-01A', '主备切换', '张班', ''],
    [back(20), 'P-51A', '盘车', '张班', ''],
    [back(13), 'P-51A', '盘车', '张班', ''],
    [back(6), 'C-53B', '盘车', '张班', ''],
  ],
});
r = run(rateMix, ['--from', back(180)], 'ratemix');
const mixW = r.rot.warnings.filter((w) => w.includes('无对应机组'));
eq(mixW.length, 1, '8.8 台账外位号多条记录合并为一条 warning');
ok(mixW[0] && mixW[0].includes('P-51A') && mixW[0].includes('C-53B') && mixW[0].includes('3 条') && mixW[0].includes('未自行猜测归属'), '8.9 合并 warning 列出位号、条数并保留「未自行猜测归属」');
eq(r.summary.counts.countedRecords, 1, '8.10 台账外记录仍不计入执行率');
ok(r.rot.warnings.some((w) => w.includes('晚于台账上次切换日期')), '8.7 记录切换晚于台账上次切换日期 → warning 提示核对台账，到期仍按台账');
eq(r.rot.switchOverdue[0].lastDate, back(120), '8.8 到期判定未被记录表倒推覆盖');

// ---- 9. 长期未切换：阈值 = 倍数 × 切换周期（默认 2 倍），--overdue-factor / --long-idle-days 可调
const idle = mk('idle.xlsx', {
  '备用设备台账': [LED_HDR,
    ['P-01A', 'P-01B', '泵1', 'P-01', '1个月', '14天', '', back(120), back(2), ''],  // 30 天周期，阈值 60 → 120 天 longIdle
    ['P-02A', 'P-02B', '泵2', 'P-02', '3个月', '14天', '', back(120), back(2), ''],  // 90 天周期，阈值 180 → 120 天不算（旧 90 天固定阈值会误列）
    ['P-03A', 'P-03B', '泵3', 'P-03', '1个月', '14天', '', back(60), back(2), ''],   // 恰好 60 天 → 算
    ['P-04A', 'P-04B', '泵4', 'P-04', '', '14天', '', back(400), back(2), ''],       // 无切换周期 → 未判定，不判长期未切换
  ],
});
r = run(idle, [], 'idle');
eq(r.summary.counts.longIdle, 2, '9.1 默认 2 倍切换周期识别长期未切换');
eq(r.rot.longIdle[0].idleDays, 120, '9.2 未切换天数按距上次切换日期计');
ok(r.rot.longIdle.every((x) => x.threshold === 60 && x.thresholdBasis.includes('2 × 切换周期')), '9.3 阈值与依据写入明细');
ok(!r.rot.longIdle.some((x) => x.mainTag === 'P-02A'), '9.4 120 天 < 2×90 天 不列入（不再按固定 90 天默认）');
ok(!r.rot.longIdle.some((x) => x.mainTag === 'P-04A'), '9.5 无切换周期的机组不判长期未切换（已进未判定，未按默认天数）');
eq(r.rot.meta.overdueFactor, 2, '9.6 默认倍数 2 写入 meta');
r = run(idle, ['--overdue-factor', '1.2'], 'idlef');
eq(r.summary.counts.longIdle, 3, '9.7 --overdue-factor 1.2 → 120 天 ≥ 108 天 列入');
ok(r.rot.longIdle.some((x) => x.mainTag === 'P-02A' && x.threshold === 108), '9.8 阈值 = 倍数 × 周期 取整');
r = run(idle, ['--long-idle-days', '100'], 'idle100');
eq(r.summary.counts.longIdle, 2, '9.9 --long-idle-days 显式绝对天数覆盖倍数口径');
ok(r.rot.longIdle.every((x) => x.threshold === 100 && x.thresholdBasis.includes('--long-idle-days')), '9.10 显式阈值依据写明');
ok(/长期未切换清单/.test(r.md) && /≥100 天（--long-idle-days）/.test(r.md), '9.11 报告含长期未切换一节并标明阈值口径');
r = run(idle, ['--long-idle-days', '30'], 'idle30');
eq(r.summary.counts.longIdle, 3, '9.12 阈值降低后全部可判项列入');

// ---- 10. 上次执行日期晚于基准日期 → 不判定并 warning
const future = mk('future.xlsx', {
  '备用设备台账': [LED_HDR, ['P-01A', 'P-01B', '泵1', '常压', '3个月', '14天', '', C.addDays(DATE, 5), back(2), '']],
});
r = run(future, [], 'future');
eq(r.summary.counts.switchOverdue, 0, '10.1 越界日期不判逾期');
eq(r.summary.counts.switchNormal, 0, '10.2 越界日期不判正常');
ok(r.rot.undetermined.some((x) => x.reason.includes('晚于基准日期')), '10.3 越界日期进未判定并注明原因');
ok(r.rot.warnings.some((w) => w.includes('晚于基准日期')), '10.4 越界日期 warning');

// ---- 11. 无切换盘车记录表 → 不统计执行率，计数为 null 而非 0
r = run(base, [], 'norec');
eq(r.rot.executionRate, null, '11.1 无记录表时 executionRate 为 null');
eq(r.summary.counts.records, null, '11.2 记录条数为 null 而非 0');
eq(r.summary.counts.switchRate, null, '11.3 执行率为 null 而非 0');
ok(/未提供「切换盘车记录」数据/.test(r.md), '11.4 报告写未提供记录表');
ok(r.rot.warnings.some((w) => w.includes('未找到「切换盘车记录」')), '11.5 缺记录表 warning 且不中断');

// ---- 12. 合计行跳过 + 标题行表头识别 + EM/SAP 导出列名（mergeAliases）+ 多种周期写法
const exp = mk('export.xlsx', {
  '备用设备台账': [
    ['某厂 EM 备用设备定期切换台账导出'],
    [],
    ['机组编号', '主用', '备用', '设备描述', '装置名称', '倒泵周期', '盘车间隔', '试运转周期', '上次切换', '上次盘车', '上次试运', '备用状态'],
    ['P-01', 'P-01A', 'P-01B', '泵1', '加氢装置', '180', '7天', '', back(200), back(1), '', '备用'],
    ['P-02', 'P-02A', 'P-02B', '泵2', '加氢装置', '1季', '每2小时', '', back(30), back(1), '', '备用'],
    ['P-03', 'P-03A', 'P-03B', '泵3', '加氢装置', '半年', '每班', '', back(30), DATE, '', '备用'],
    ['合计', '', '', '', '', '', '', '', '', '', '', ''],
  ],
  '切换盘车记录': [
    ['执行日期', '功能位置', '工作类型', '切换后主用', '操作人', '说明'],
    [back(200), 'P-01A', '倒泵', 'P-01B', '王班', ''],
    [back(1), 'P-01B', '盘车', '', '王班', ''],
  ],
});
r = run(exp, [], 'export');
eq(r.summary.ok, true, '12.1 导出风格表可读（标题行+系统列名）');
eq(r.summary.counts.pairs, 3, '12.2 合计行被跳过');
ok(r.rot.warnings.some((w) => w.includes('合计行')), '12.3 合计行 warning');
const p01 = r.rot.switchOverdue.find((x) => x.groupKey === 'P-01');
eq(p01 && p01.overdueDays, 20, '12.4 纯数字周期按天解析（180天）');
eq(r.rot.switchNormal.find((x) => x.groupKey === 'P-02').periodDays, 90, '12.5 「1季」按 90 天解析');
eq(r.rot.switchNormal.find((x) => x.groupKey === 'P-03').periodDays, 182, '12.6 「半年」现可解析为 182 天（不再进未判定）');
eq(p01 && p01.name, '泵1', '12.7 「设备描述」（SAP）归设备名称');
eq(p01 && p01.unit, '加氢装置', '12.8 「装置名称」归装置列');
eq(p01 && p01.groupKey, 'P-01', '12.9 「机组编号」归机组键');
eq(p01 && p01.mainTag, 'P-01B', '12.10 记录表「功能位置」列（共享别名）命中位号并推导当前主用');
eq(r.rot.pairs.find((x) => x.groupKey === 'P-01').roleSource, '切换记录', '12.11 当前主用来源 = 切换记录');
eq(r.summary.counts.rolesFromRecords, 1, '12.12 推导计数');
eq(r.rot.turningOverdue.find((x) => x.groupKey === 'P-02').overdueDays, 1, '12.13 「每2小时」可解析，上次为昨日 → 逾期 1 天（按日粒度）');
const p03t = r.rot.turningDueSoon.find((x) => x.groupKey === 'P-03');
ok(p03t && p03t.remainDays === 0 && p03t.shiftLevel === true && /班次/.test(p03t.note), '12.14 「每班」可解析，上次为当日 → 本日内按班次到期');
eq(r.rot.executionRate.byPair.find((x) => x.groupKey === 'P-02' && x.kind === 'turning').planned, null, '12.15 班次级周期不折算计划次数（显示「—」）');
ok(r.rot.warnings.some((w) => w.includes('班次级/小时级周期')), '12.16 班次级周期执行率 warning');
eq(r.rot.standbyAvailability.rate, 100, '12.17 「备用状态」列（别名）命中，全部备用 → 完好率 100%');
eq(r.summary.counts.undetermined, 0, '12.18 导出样例无未判定');

// ---- 13. 主备位号全空行跳过并 warning
const notag = mk('notag.xlsx', {
  '备用设备台账': [LED_HDR,
    ['', '', '无位号', '常压', '3个月', '14天', '', back(10), back(2), ''],
    ['P-01A', 'P-01B', '泵1', '常压', '3个月', '14天', '', back(10), back(2), ''],
  ],
});
r = run(notag, [], 'notag');
eq(r.summary.counts.pairs, 1, '13.1 主备位号全空行被跳过');
eq(r.summary.counts.pairingIssues, 0, '13.2 全空行不计入配对异常');
ok(r.rot.warnings.some((w) => w.includes('均为空')), '13.3 全空行 warning');

// ---- 14. --equipment 限定范围
r = run(und, ['--equipment', 'P-06A,P-06B'], 'scope');
eq(r.summary.counts.pairs, 1, '14.1 仅统计范围内主备组');
eq(r.summary.counts.undetermined, 0, '14.2 范围外未判定项不计入');
ok(r.rot.warnings.some((w) => w.includes('不在范围内')), '14.3 范围过滤 warning');

// ---- 15. 缺少备用设备台账（唯一数据源）→ ok:false 且 exit 1
const bad = mk('bad.xlsx', { '随便一张表': [['a', 'b'], [1, 2]] });
r = run(bad, [], 'bad');
eq(r.summary.ok, false, '15.1 无备用设备台账时 ok:false');
eq(r.code, 1, '15.2 退出码为 1');
ok(/未在输入中找到「备用设备台账」/.test(r.summary.error), '15.3 错误信息明确');

// ---- 16. 参数校验
function runRaw(args) {
  const x = spawnSync(process.execPath, [ROT, ...args], { encoding: 'utf8' });
  const lines = x.stdout.trim().split('\n');
  try { return { code: x.status, s: JSON.parse(lines[lines.length - 1]) }; } catch (e) { return { code: x.status, s: { ok: false, error: 'no-json' } }; }
}
let x = runRaw(['--input']);
eq(x.s.ok, false, '16.1 --input 缺值报错');
ok(/缺少取值/.test(x.s.error), '16.2 缺值错误信息正确');
eq(x.code, 1, '16.3 参数错误退出码为 1');
x = runRaw(['--input', base, '--workshop', '车间', '--date', '2026-13-45']);
eq(x.s.ok, false, '16.4 非法日期报错');
x = runRaw(['--input', base, '--workshop', '车间', '--date', DATE, '--未知参数', 'x']);
eq(x.s.ok, false, '16.5 未知参数报错');
x = runRaw(['--input', '/不存在的路径.xlsx', '--workshop', '车间', '--date', DATE]);
eq(x.s.ok, false, '16.6 输入不存在报错');
x = runRaw(['--input', base, '--workshop', '车间', '--date', DATE, '--lead-days', '三天']);
eq(x.s.ok, false, '16.7 非法 lead-days 报错');
x = runRaw(['--input', base, '--workshop', '车间', '--date', DATE, '--long-idle-days', '0']);
eq(x.s.ok, false, '16.8 非法 long-idle-days 报错');
x = runRaw(['--input', base, '--date', DATE]);
eq(x.s.ok, false, '16.9 缺 --workshop 报错');
x = runRaw(['--input', base, '--workshop', '车间', '--date', DATE, '--from', C.addDays(DATE, 5)]);
eq(x.s.ok, false, '16.10 --from 晚于 --date 报错');
x = runRaw(['--input', base, '--workshop', '车间', '--date', DATE, '--from', '上个月']);
eq(x.s.ok, false, '16.11 非法 --from 报错');
x = runRaw(['--input', base, '--workshop', '车间', '--date', DATE, '--overdue-factor', '0']);
eq(x.s.ok, false, '16.12 非法 --overdue-factor 报错');
x = runRaw(['--input', base, '--workshop', '车间', '--date', DATE]);
ok(x.s.ok === true && x.s.out.startsWith(os.tmpdir()), '16.13 未给 --out 时默认写系统临时目录');

// ---- 17. summary.json 落盘与产出结构、说明行、分析段占位
r = run(rate, ['--from', back(180)], 'struct');
ok(fs.existsSync(path.join(r.out, 'summary.json')), '17.1 summary.json 已写入');
const sj = JSON.parse(fs.readFileSync(path.join(r.out, 'summary.json'), 'utf8'));
eq(sj.ok, true, '17.2 summary.json 内容正确');
ok(fs.existsSync(path.join(r.out, 'rotation.json')), '17.3 rotation.json 已写入');
ok(/## 一、到期概览/.test(r.md) && /## 二、切换逾期与临期/.test(r.md) && /## 三、盘车逾期与临期/.test(r.md)
  && /## 四、长期未切换清单/.test(r.md) && /## 五、备机检修中与停用/.test(r.md) && /## 六、执行率统计/.test(r.md)
  && /## 七、无法判定与主备配对异常/.test(r.md) && /## 八、备用设备管理说明/.test(r.md), '17.4 七节正文 + 说明段结构齐全');
ok(/<!-- ANALYSIS_START -->/.test(r.md) && /<!-- ANALYSIS_END -->/.test(r.md), '17.5 分析段占位符存在');
ok(/（北京时间）/.test(r.md), '17.6 报告标注北京时间');
eq((r.md.match(/切换实施前需由工艺确认具备切换条件并按操作票执行，本清单仅为周期提醒/g) || []).length, 2, '17.7 说明行原文出现在报告头尾');
ok(/不编制切换操作方案与操作票，不判定工艺是否具备切换条件/.test(r.md), '17.8 报告写明不编制操作票、不判定切换条件');
ok(/本材料由脚本汇总、模型成文，仅供设备员复核参考，不替代审批、定性、验收与签字；厂内制度与系统数据为准。/.test(r.md), '17.9 通用声明行写入报告');
ok(/切换条件确认由工艺归口/.test(r.md), '17.10 归口声明');
ok(/车间设备主任 \/ 公司设备管理部门（机动部\/设备部）/.test(r.md) && !/机动处/.test(r.md), '17.11 报送对象用中石化层级口径，不用「机动处」');
ok(!/[✅⚠❌\u{1F300}-\u{1FAFF}]/u.test(r.md), '17.12 产出 md 不含 emoji');
ok(/【注意】|【未判定】/.test(run(pairbad, [], 'struct2').md), '17.13 醒目提示用「【注意】」');

// ---- 18. 样例可再生：seed 改变数值但结论不变
const MS = path.join(__dirname, 'make-sample.js');
function sample(seed) {
  const dir = path.join(work, 'sample-' + seed);
  spawnSync(process.execPath, [MS, '--out', dir, '--seed', String(seed), '--date', DATE], { encoding: 'utf8' });
  return run(path.join(dir, `sample-rotation-${DATE}.xlsx`), [], 'sample' + seed);
}
const s1 = sample(1), s7 = sample(7);
eq(s1.summary.ok, true, '18.1 样例可运行');
eq(s1.summary.counts.switchOverdue, s7.summary.counts.switchOverdue, '18.2 seed 变化切换逾期数不变');
eq(s1.summary.counts.turningOverdue, s7.summary.counts.turningOverdue, '18.3 seed 变化盘车逾期数不变');
eq(s1.summary.counts.undetermined, s7.summary.counts.undetermined, '18.4 seed 变化未判定数不变');
eq(s1.summary.counts.pairingIssues, s7.summary.counts.pairingIssues, '18.5 seed 变化配对异常数不变');
eq(s1.summary.counts.longIdle, s7.summary.counts.longIdle, '18.6 seed 变化长期未切换数不变');
eq(s1.summary.counts.switchOverdue, 2, '18.7 样例切换逾期恒为 2');
eq(s1.summary.counts.switchDueSoon, 1, '18.8 样例切换临期恒为 1');
eq(s1.summary.counts.turningOverdue, 2, '18.9 样例盘车逾期恒为 2');
eq(s1.summary.counts.turningDueSoon, 2, '18.10 样例盘车临期恒为 2');
eq(s1.summary.counts.undetermined, 3, '18.11 样例未判定恒为 3');
eq(s1.summary.counts.pairingIssues, 2, '18.12 样例配对异常恒为 2');
eq(s1.summary.counts.longIdle, 2, '18.13 样例长期未切换恒为 2');
eq(s1.summary.counts.standbyInRepair, 1, '18.14 样例备机检修中恒为 1');
eq(s1.summary.counts.rolesFromRecords, 5, '18.15 样例 5 个机组当前主用由记录推导');
eq(s1.rot.pairs.find((p) => p.groupKey === 'P-1101').mainTag, 'P-1101B', '18.16 P-1101 当前主用按记录为 B 泵（与台账相反）');
ok(!s1.rot.switchOverdue.some((x) => x.groupKey === 'P-1601') && s1.rot.standbyUnavailable.some((x) => x.groupKey === 'P-1601'), '18.17 检修中备机 P-1601 不进切换逾期清单，单列');
ok(s1.rot.turningDueSoon.some((x) => x.groupKey === 'P-1302' && x.shiftLevel), '18.18 样例「每班」盘车按班次级到期');
eq(s1.summary.counts.standbyAvailabilityRate, 90.9, '18.19 备机完好率 10/11');

// ---- 19. 导出风格样例：主备同号进配对异常；仅台账样例
const expSample = run(path.join(work, 'sample-1', 'sample-rotation-export.xlsx'), [], 'sampleexp');
eq(expSample.summary.ok, true, '19.1 导出风格样例可运行');
eq(expSample.summary.counts.pairingIssues, 1, '19.2 导出样例主备同号进配对异常');
eq(expSample.summary.counts.pairs, 2, '19.3 导出样例成对 2 组');
eq(expSample.summary.counts.rolesFromRecords, 1, '19.4 导出样例「功能位置」+「切换后主用」推导当前主用');
eq(expSample.summary.counts.standbyAvailable, null, '19.5 无备机状态列 → 备机完好台数 null 而非按全部备用');
ok(expSample.rot.warnings.some((w) => w.includes('无「备机状态」列')), '19.6 无备机状态列 warning');
const ledOnly = run(path.join(work, 'sample-1', `sample-ledger-only-${DATE}.xlsx`), [], 'sampleled');
eq(ledOnly.rot.executionRate, null, '19.7 仅台账样例不统计执行率');
eq(ledOnly.summary.counts.records, null, '19.8 仅台账样例记录条数为 null');
eq(ledOnly.summary.counts.rolesFromRecords, 0, '19.9 仅台账样例当前主用全按台账');

// ---- 20. 备机状态：检修中/停用不进到期清单；未填/无法识别不算完好率
const LED_S = ['机组号', '主用位号', '备用位号', '设备名称', '备机状态', '切换周期', '盘车周期', '试运周期', '上次切换日期', '上次盘车日期', '上次试运日期'];
const st = mk('status.xlsx', {
  '备用设备台账': [LED_S,
    ['G-01', 'P-01A', 'P-01B', '泵1', '检修中', '1个月', '7天', '', back(200), back(30), ''],  // 严重逾期但检修中 → 不进清单
    ['G-02', 'P-02A', 'P-02B', '泵2', '封存', '1个月', '7天', '', back(200), back(30), ''],    // 停用
    ['G-03', 'P-03A', 'P-03B', '泵3', '备用', '1个月', '7天', '', back(200), back(30), ''],    // 正常判定 → 逾期
    ['G-04', 'P-04A', 'P-04B', '泵4', '', '1个月', '7天', '', back(10), back(1), ''],          // 未填
    ['G-05', 'P-05A', 'P-05B', '泵5', '待定', '1个月', '7天', '', back(10), back(1), ''],      // 无法识别
  ],
  '切换盘车记录': [REC_HDR, [back(10), 'P-01A', '切换', '张', '']],
});
r = run(st, ['--from', back(180)], 'status');
eq(r.summary.counts.standbyInRepair, 1, '20.1 检修中备机计数');
eq(r.summary.counts.standbyStopped, 1, '20.2 停用备机计数');
eq(r.summary.counts.switchOverdue, 1, '20.3 检修中/停用备机不进切换逾期清单');
eq(r.summary.counts.turningOverdue, 1, '20.4 检修中/停用备机不进盘车逾期清单');
eq(r.summary.counts.longIdle, 1, '20.5 检修中/停用备机不进长期未切换');
ok(!r.rot.executionRate.byPair.some((x) => x.groupKey === 'G-01' || x.groupKey === 'G-02'), '20.6 检修中/停用备机不参与执行率');
eq(r.summary.counts.standbyAvailable, 1, '20.7 可随时投用台数只计「备用」');
eq(r.summary.counts.standbyAvailabilityRate, null, '20.8 有未填/无法识别状态时完好率 null（未按备用默认计入分子）');
eq(r.rot.standbyAvailability.statusMissing, 1, '20.9 状态未填计数');
eq(r.rot.standbyAvailability.statusUnknown, 1, '20.10 状态无法识别计数');
ok(r.rot.warnings.some((w) => w.includes('「待定」无法识别')), '20.11 无法识别状态 warning');
ok(r.rot.warnings.some((w) => w.includes('备机完好率不计算')), '20.12 完好率不计算 warning');
ok(/## 五、备机检修中与停用/.test(r.md) && /\| G-01 \|/.test(r.md) && /三级验收后请更新台账/.test(r.md), '20.13 报告单列检修中备机并提示三级验收后更新台账');
eq(r.rot.standbyUnavailable.find((x) => x.groupKey === 'G-02').standbyStatus, 'stopped', '20.14 「封存」归停用');
eq(r.rot.pairs.find((x) => x.groupKey === 'G-04').standbyStatus, null, '20.15 未填状态为 null 不是 standby');
eq(r.rot.pairs.find((x) => x.groupKey === 'G-04').standbyStatusLabel, '未填', '20.16 未填标签');
eq(r.summary.counts.switchNormal, 2, '20.17 未填/无法识别状态仍按备用进到期判定（提醒口径从严）');

// ---- 21. 当前主用推导：方向列不在机组内 → warning 按台账；多条取最近；记录晚于基准日不采用
const roles = mk('roles.xlsx', {
  '备用设备台账': [LED_S,
    ['G-01', 'P-01A', 'P-01B', '泵1', '备用', '1个月', '7天', '', back(10), back(1), ''],
    ['G-02', 'P-02A', 'P-02B', '泵2', '备用', '1个月', '7天', '', back(10), back(1), ''],
    ['G-03', 'P-03A', 'P-03B', '泵3', '备用', '1个月', '7天', '', back(10), back(1), ''],
  ],
  '切换盘车记录': [['日期', '位号', '作业类型', '切至位号', '执行人'],
    [back(40), 'P-01A', '切换', 'P-01B', '张'],
    [back(10), 'P-01B', '切换', 'P-01A', '张'],       // 最近一条 → 当前主用 A
    [back(10), 'P-02A', '切换', 'P-09Z', '张'],       // 方向不在机组内 → 按台账
    [C.addDays(DATE, 3), 'P-03A', '切换', 'P-03B', '张'], // 晚于基准日 → 不采用
  ],
});
r = run(roles, [], 'roles');
eq(r.rot.pairs.find((x) => x.groupKey === 'G-01').mainTag, 'P-01A', '21.1 多条切换记录取最近一条推导当前主用');
eq(r.rot.pairs.find((x) => x.groupKey === 'G-01').roleRecordDate, back(10), '21.2 推导依据日期写入');
eq(r.rot.pairs.find((x) => x.groupKey === 'G-02').mainTag, 'P-02A', '21.3 方向不在机组两位号内 → 当前主用按台账');
ok(r.rot.warnings.some((w) => w.includes('「P-09Z」不在机组')), '21.4 方向越界 warning');
eq(r.rot.pairs.find((x) => x.groupKey === 'G-03').roleSource, '台账', '21.5 晚于基准日的记录不用于推导');
eq(r.rot.records.items.find((x) => x.tag === 'P-01B').switchTo, 'P-01A', '21.6 记录明细保留切换方向');
ok(/当前主用\/当前备用」按切换记录/.test(r.md), '21.7 报告说明当前主用推导口径');

// ---- 22. 别名口径：「设备编号」不再归位号；「项目」不再作作业类型别名；记录表只有设备编号时兜底并 warning；运行小时周期提示
const al1 = mk('alias1.xlsx', {
  '备用设备台账': [['主用位号', '备用位号', '设备编号', '设备', '设备名称', '切换周期', '盘车周期', '上次切换日期', '上次盘车日期'],
    ['P-01A', 'P-01B', '10001234', '10001234', '泵1', '运行2000小时', '7天', back(10), back(1)],
  ],
  '切换盘车记录': [['日期', '设备编号', '项目', '执行人'],
    [back(10), 'P-01A', '切换', '张'],
  ],
});
r = run(al1, [], 'alias1');
eq(r.rot.pairs[0].name, '泵1', '22.1 裸「设备」列（SAP 设备编号）不被当作设备名称');
ok(r.rot.warnings.some((w) => /缺少列: .*作业类型/.test(w)), '22.2 「项目」不再作作业类型别名（缺列 warning）');
ok(r.rot.warnings.some((w) => w.includes('已用「设备编号」列作位号匹配')), '22.3 记录表无位号列时用设备编号兜底并 warning');
ok(r.rot.undetermined.some((x) => x.kind === 'switch' && x.reason.includes('运行小时周期') && x.reason.includes('runtime-hours-tracker')), '22.4 运行小时周期不按日历判定，进未判定并指向 runtime-hours-tracker');
ok(r.rot.warnings.some((w) => w.includes('无「机组/泵组」列')) && r.rot.pairs[0].groupKey === 'P-01A/P-01B', '22.4a 无机组列 → warning 并以主用/备用位号组合作机组键');
const al2 = mk('alias2.xlsx', {
  '备用设备台账': [['泵组', '位号A', '位号B', '功能位置描述', '备用机状态', '切换频次', '盘车频次', '上次倒泵日期', '上次盘车'],
    ['G-1', 'P-01A', 'P-01B', '泵1', '热备', '每月', '每周', back(10), back(1)],
  ],
});
r = run(al2, [], 'alias2');
eq(r.summary.counts.pairs, 1, '22.5 「泵组/位号A/位号B」别名命中');
eq(r.rot.pairs[0].name, '泵1', '22.6 「功能位置描述」（SAP）归设备名称');
eq(r.rot.pairs[0].standbyStatus, 'standby', '22.7 「热备」归备用');
eq(r.rot.switchNormal[0].periodDays, 30, '22.8 「每月」解析为 30 天');
eq(r.rot.turningNormal[0].periodDays, 7, '22.9 「每周」解析为 7 天');

// ============ 23. 文档、上架信息与口径一致性 ============
{
  const ROOT = path.join(__dirname, '..');
  const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
  const exists = (p) => fs.existsSync(path.join(ROOT, p));
  // 演示样例：仓库内在 炼厂车间设备员/演示case/<分类>/<技能>/，开发包内在技能目录 examples/
  const skillsRoot = path.resolve(__dirname, '../../..');
  const EX = path.basename(skillsRoot) === '设备员skill' ? path.join(skillsRoot, '..', '演示case', path.relative(skillsRoot, path.resolve(__dirname, '..'))) : path.join(__dirname, '..', 'examples');
  const skill = rd('SKILL.md');
  const listing = (exists('上架信息.md') ? rd('上架信息.md') : '') + (exists('样例问题.md') ? rd('样例问题.md') : '');
  const attach = [...listing.matchAll(/(sample-[\w.-]+\.xlsx)/g)].map((m) => m[1]);
  const descText = ((exists('上架信息.md') ? rd('上架信息.md') : '').split('**技能描述**')[1] || '').split('**示例问题**')[0].replace(/\s/g, '');

  ok(/^agent_created: true$/m.test(skill) && /^allowed-tools: /m.test(skill), '23.1 SKILL.md 保留 agent_created 与 allowed-tools');
  ok(/inspection-task-dispatch/.test(skill) && /runtime-hours-tracker/.test(skill) && /lubrication-manager/.test(skill), '23.2 description 含同类技能互指');
  ok(/机组/.test(skill) && /备机完好/.test(skill) && /N 倍切换周期|倍切换周期/.test(skill) && /--overdue-factor/.test(skill), '23.3 SKILL.md 含机组键、备机完好与倍数阈值');
  ok(/八节/.test(skill) && /归口/.test(skill) && /os\.tmpdir|系统临时目录/.test(skill), '23.4 SKILL.md 预期结果八节、归口声明与默认临时目录');
  const b23 = mk('doc23.xlsx', {
    '备用设备台账': [LED_HDR, ['P-D1A', 'P-D1B', '泵D', '机组D', '1个月', '7天', '', back(10), back(1), '']],
    '切换盘车记录': [REC_HDR, [back(1), 'P-D1A', '盘车', '当班', '']],
  });
  const r23 = run(b23, [], 'doc23');
  eq((r23.md.match(/^## [一二三四五六七八九]、/gm) || []).length, 8, '23.5 产出 md 正文恰为八节，与 SKILL.md 预期结果一致');
  const spec = rd('references/input-spec.md');
  ok(/切换后主用/.test(spec) && /备机状态/.test(spec) && /机组/.test(spec) && /半年/.test(spec) && /每班/.test(spec) && /runtime-hours-tracker/.test(spec), '23.6 input-spec 含切换后主用、备机状态、机组键、半年/每班周期与运行小时指引');
  ok(/^\| 位号 \| /m.test(spec) && !/^\| 位号 \| [^|\n]*设备编号[^|\n]*\|/m.test(spec) && !/^\| 作业类型 \| [^|\n]*、项目[、 |][^|\n]*\|/m.test(spec), '23.7 input-spec 别名表：位号不含设备编号、作业类型不含「项目」（与脚本一致）');
  ok(/mergeAliases/.test(spec) && /功能位置/.test(spec), '23.8 input-spec 写明合并共享 SYSTEM_ALIASES');
  const rules = rd('references/rotation-rules.md');
  ok(/倍/.test(rules) && /备机完好/.test(rules) && /当前主用/.test(rules) && /《中国石化设备管理规定》/.test(rules), '23.9 rotation-rules 含倍数阈值、备机完好、当前主用与制度引用');
  ok(!/默认 90 天/.test(rules) && !/90 天长期未切换阈值/.test(rules), '23.10 rotation-rules 不再写 90 天默认阈值');
  const so = rd('references/sample-output.md');
  ok(/倍切换周期/.test(so) && /备机完好率/.test(so) && /## 八、/.test(so) && !/90 天/.test(so), '23.11 sample-output 按机组键、倍数阈值、八节口径');
  const ck = rd('references/checklist.md');
  ok(/当前主用/.test(ck) && /备机状态/.test(ck) && /本材料由脚本汇总、模型成文/.test(ck) && !/work-order-generator` 开工单/.test(ck), '23.12 checklist 含当前主用、备机状态、通用声明行，不再说"开工单"');
  const tpl = rd('assets/templates/rotation-report-template.md');
  ok(/## 八、/.test(tpl) && /meta\.longIdleBasis/.test(tpl) && /counts\.standbyAvailable/.test(tpl) && /meta\.generalDeclaration/.test(tpl), '23.13 模板为八节且含倍数阈值、备机完好、通用声明行占位符');
  const get = (o, p) => p.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);
  const keys = [...tpl.matchAll(/\{\{#?((?:meta|counts|executionRate|standbyAvailability)\.[\w.]+)\}\}/g)].map((m) => m[1]);
  const missing = [...new Set(keys)].filter((k) => get(r23.rot, k) === undefined);
  ok(keys.length > 10 && missing.length === 0, `23.14 模板 meta/counts/executionRate/standbyAvailability 占位符均能在 rotation.json 取到（缺：${missing.join(',')}）`);
  const tables = [...tpl.matchAll(/\{\{table:([\w.]+)\}\}/g)].map((m) => m[1]);
  const badTables = tables.filter((k) => !Array.isArray(get(r23.rot, k)));
  ok(tables.length >= 10 && badTables.length === 0, `23.15 模板 table 节均为 rotation.json 数组（缺：${badTables.join(',')}）`);
  ok(!/EAM|机动处|动火/.test(spec + rules + ck + skill), '23.16 不含「EAM」「机动处」「动火」旧术语');
  const readme = rd('scripts/README.md');
  ok(/--overdue-factor/.test(readme) && /--long-idle-days/.test(readme) && /os\.tmpdir\(\)/.test(readme) && /roleSource/.test(readme), '23.17 scripts/README 含倍数/绝对阈值参数、默认临时目录与角色来源');
  const ex = fs.readFileSync(path.join(EX, 'README.md'), 'utf8');
  ok(/--overdue-factor/.test(ex) && /倍切换周期/.test(ex) && /检修中/.test(ex) && /当前主用/.test(ex) && !/默认 90 天/.test(ex), '23.18 演示case/README 对照表含倍数阈值、检修中备机、当前主用，不再写 90 天');
  ok(exists('上架信息.md') && exists('样例问题.md'), '23.19 上架信息.md 与 样例问题.md 存在');
  ok(attach.length >= 5 && attach.every((f) => fs.existsSync(path.join(EX, f))), `23.20 上架信息/样例问题引用的附件均存在于 演示case（${[...new Set(attach)].join(',')}）`);
  ok(/\*\*技能名称\*\*/.test(listing) && /\*\*技能简介\*\*/.test(listing) && /\*\*技能描述\*\*/.test(listing) && /\*\*示例问题\*\*/.test(listing), '23.21 上架信息格式四要素齐全');
  ok(descText.length >= 240 && descText.length <= 330, `23.22 技能描述约 250~300 字（实际 ${descText.length}）`);
  ok((listing.match(/^\d+\. /gm) || []).length >= 15 && /工艺确认/.test(listing), '23.23 上架信息 5 题 + 样例问题 10 题，并写明切换条件由工艺确认');
}

// ---- 输出
console.log(`\n${'='.repeat(56)}`);
console.log(`standby-rotation-reminder 自测：${pass} 通过，${fail} 失败`);
if (failures.length) { console.log('\n失败项：'); failures.forEach((f) => console.log('  x ' + f)); }
console.log('='.repeat(56));
try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
