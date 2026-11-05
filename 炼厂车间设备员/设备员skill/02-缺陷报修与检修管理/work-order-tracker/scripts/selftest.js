#!/usr/bin/env node
'use strict';
/**
 * 自测：生成变体输入并断言 track.js 行为。用法：node scripts/selftest.js（全绿退出 0）
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { writeXlsx } = require('./lib/xlsx-lite');

const TRACK = path.join(__dirname, 'track.js');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wot-selftest-'));
const DATE = '2026-09-21';
let pass = 0, fail = 0;
const failures = [];

// 用例分级（见 文档/规范/自测用例分级规范.md）：SELFTEST_LEVEL=BVT|A|B|C 只跑该级及更高优先级的节，不设时跑全量
const LEVELS = ['BVT', 'A', 'B', 'C'];
const RUN_LEVEL = LEVELS.indexOf(String(process.env.SELFTEST_LEVEL || 'C').toUpperCase());
if (RUN_LEVEL < 0) { console.error(`SELFTEST_LEVEL 只能取 ${LEVELS.join('、')}`); process.exit(2); }
const byLevel = { BVT: 0, A: 0, B: 0, C: 0 };
let curLevel = null;
function section(level, fn) {
  if (!LEVELS.includes(level)) throw new Error(`未知用例级别 ${level}`);
  if (LEVELS.indexOf(level) > RUN_LEVEL) return;
  curLevel = level; fn(); curLevel = null;
}
const ok = (c, n) => {
  if (!curLevel) throw new Error(`断言须写在 section() 内：${n}`);
  byLevel[curLevel]++;
  if (c) pass++; else { fail++; failures.push(`[${curLevel}] ${n}`); }
};
function eq(actual, expect, name) { ok(actual === expect, `${name}（期望 ${JSON.stringify(expect)}，实际 ${JSON.stringify(actual)}）`); }

function run(file, extra = [], tag) {
  const out = path.join(work, (tag || path.basename(file, '.xlsx')) + '-out');
  const r = spawnSync(process.execPath, [TRACK, '--input', file, '--workshop', '测试车间', '--date', DATE, '--out', out, ...extra], { encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  let summary;
  try { summary = JSON.parse(lines[lines.length - 1]); } catch (e) { summary = { ok: false, error: 'no-json:' + r.stdout + r.stderr }; }
  let orders = null, md = null, urge = null;
  if (fs.existsSync(path.join(out, 'orders.json'))) orders = JSON.parse(fs.readFileSync(path.join(out, 'orders.json'), 'utf8'));
  if (fs.existsSync(path.join(out, 'tracking.md'))) md = fs.readFileSync(path.join(out, 'tracking.md'), 'utf8');
  if (fs.existsSync(path.join(out, '催办清单.md'))) urge = fs.readFileSync(path.join(out, '催办清单.md'), 'utf8');
  return { code: r.status, summary, orders, md, urge, out };
}
function mk(name, book) { const p = path.join(work, name); writeXlsx(p, book); return p; }

const HDR = ['工单号', '位号', '设备名称', '故障描述', '状态', '优先级', '报修时间', '要求完成时间', '派工时间', '开工时间', '完工时间', '验收时间', '承修单位', '责任人', '超期原因'];
let r;

// ---- 1. 基础：状态分布、超期、闭环
const base = mk('base.xlsx', {
  '工单台账': [HDR,
    // 超期：中级，要求完成 09-15，已过 6 天
    ['WO-01', 'P-01', '泵1', '机封漏', '施工中', '中', '2026-09-08 08:00', '2026-09-15', '2026-09-08 10:00', '2026-09-09 08:00', '', '', '机修一队', '张班长', '备件未到'],
    // 在办未超期
    ['WO-02', 'P-02', '泵2', '振动高', '已派工', '高', '2026-09-20 08:00', '2026-09-25', '2026-09-20 10:00', '', '', '', '机修一队', '张班长', ''],
    // 已闭环，按期
    ['WO-03', 'P-03', '泵3', '轴承温高', '已闭环', '中', '2026-09-10 08:00', '2026-09-17', '2026-09-10 09:00', '2026-09-11 08:00', '2026-09-14 16:00', '2026-09-15 09:00', '机修二队', '李工长', ''],
    // 已取消
    ['WO-04', 'P-04', '泵4', '重复报修', '已取消', '低', '2026-09-12 08:00', '2026-09-27', '', '', '', '', '机修二队', '李工长', ''],
  ],
});
section('BVT', () => {
  r = run(base, [], 'base');
  eq(r.summary.ok, true, '1.1 基础运行成功');
  eq(r.summary.counts.total, 4, '1.2 工单总数');
  eq(r.summary.counts.open, 2, '1.3 在办（未闭环）数');
  eq(r.summary.counts.overdue, 1, '1.4 超期数');
  eq(r.summary.counts.closedAll, 1, '1.5 已闭环数');
  eq(r.summary.counts.cancelled, 1, '1.6 已取消数');
  eq(r.orders.byStatus.find((x) => x.status === '施工中').count, 1, '1.7 状态分布：施工中');
});
section('A', () => {
  eq(r.orders.overdue[0].overdueDays, 6, '1.8 超期天数计算正确');
  eq(r.summary.metrics.closeRate, 33.3, '1.9 完成率剔除已取消（1/3）');
  eq(r.summary.metrics.avgCycleDays, 5, '1.10 平均闭环时长（报修→验收）');
});

// ---- 2. 状态非法：单列 unknownStatus，绝不就近映射
const badst = mk('badstatus.xlsx', {
  '工单台账': [HDR,
    ['WO-11', 'P-11', '泵11', '漏', '挂起', '中', '2026-09-08 08:00', '2026-09-15', '', '', '', '', '机修一队', '张班长', ''],
    ['WO-12', 'P-12', '泵12', '漏', '', '中', '2026-09-08 08:00', '2026-09-15', '', '', '', '', '机修一队', '张班长', ''],
    ['WO-13', 'P-13', '泵13', '漏', '施工中', '中', '2026-09-08 08:00', '2026-09-15', '', '', '', '', '机修一队', '张班长', ''],
  ],
});
section('A', () => {
  r = run(badst, [], 'badstatus');
  eq(r.summary.counts.unknownStatus, 2, '2.1 非法状态与空状态各单列一条');
  eq(r.summary.counts.known, 1, '2.2 未知状态不计入已知状态工单');
  eq(r.summary.counts.overdue, 1, '2.3 未知状态不参与超期判定（仅合法的 WO-13）');
  ok(!r.orders.overdue.some((x) => x.no === 'WO-11'), '2.4 「挂起」未被映射进任何状态');
  ok(r.orders.byStatus.every((x) => x.status !== '挂起'), '2.5 状态分布中不出现台账原文态');
  ok(r.orders.unknownStatus.some((x) => x.no === 'WO-11' && x.rawStatus === '挂起'), '2.6 unknownStatus 保留台账原文');
  ok(r.orders.unknownStatus.some((x) => x.no === 'WO-12' && x.reason === '状态为空'), '2.7 空状态原因标注正确');
  ok(r.orders.warnings.some((w) => w.includes('不做就近映射')), '2.8 warning 明确不做就近映射');
  ok(/## 七、未知状态工单/.test(r.md), '2.9 报告单列未知状态一节');
});

// ---- 3. 节点时间倒序：warning 且原样保留
section('C', () => {
  const rev = mk('reverse.xlsx', {
    '工单台账': [HDR,
      ['WO-21', 'P-21', '泵21', '漏', '待验收', '中', '2026-09-10 08:00', '2026-09-25', '2026-09-10 09:00', '2026-09-18 08:00', '2026-09-16 16:00', '', '机修一队', '张班长', ''],
    ],
  });
  r = run(rev, [], 'reverse');
  eq(r.summary.ok, true, '3.1 时间倒序不中断执行');
  ok(r.orders.warnings.some((w) => w.includes('节点时间倒序') && w.includes('完工时间')), '3.2 倒序 warning 指明节点');
  ok(/第\d+行/.test(r.orders.warnings.find((w) => w.includes('倒序'))), '3.3 倒序 warning 含行号');
  ok(/原样保留/.test(r.orders.warnings.find((w) => w.includes('倒序'))), '3.4 warning 说明原样保留未改数据');
});

// ---- 4. 工单号重复：warning 且两条都保留
section('C', () => {
  const dup = mk('dup.xlsx', {
    '工单台账': [HDR,
      ['WO-31', 'P-31', '泵31A', '漏', '施工中', '中', '2026-09-18 08:00', '2026-09-25', '2026-09-18 09:00', '2026-09-19 08:00', '', '', '机修一队', '张班长', ''],
      ['WO-31', 'P-31B', '泵31B', '漏', '已派工', '中', '2026-09-18 08:10', '2026-09-25', '2026-09-18 09:10', '', '', '', '机修一队', '张班长', ''],
    ],
  });
  r = run(dup, [], 'dup');
  eq(r.summary.counts.total, 2, '4.1 重复工单号两条均保留');
  eq(r.summary.counts.duplicated, 1, '4.2 重复号计数');
  ok(r.orders.warnings.some((w) => w.includes('重复出现') && w.includes('两条均已保留')), '4.3 重复 warning');
  eq(r.orders.byStatus.find((x) => x.status === '施工中').count + r.orders.byStatus.find((x) => x.status === '已派工').count, 2, '4.4 两条分别计入各自状态');
});

// ---- 5. 要求完成时间缺失 → 按 报修时间 + 优先级时限 推算，并标注依据
const noDue = mk('nodue.xlsx', {
  '工单台账': [HDR,
    // 中级默认 7 天：09-05 + 7 = 09-12，已超 9 天
    ['WO-41', 'P-41', '泵41', '漏', '施工中', '中', '2026-09-05 08:00', '', '2026-09-05 09:00', '2026-09-06 08:00', '', '', '机修一队', '张班长', ''],
    // 紧急默认 1 天：09-19 + 1 = 09-20，已超 1 天
    ['WO-42', 'P-42', '泵42', '抢修', '施工中', '紧急', '2026-09-19 08:00', '', '2026-09-19 09:00', '2026-09-19 10:00', '', '', '机修一队', '张班长', ''],
    // 无优先级且无要求完成时间 → 不推算、不判超期
    ['WO-43', 'P-43', '泵43', '漏', '施工中', '', '2026-09-01 08:00', '', '2026-09-01 09:00', '2026-09-02 08:00', '', '', '机修一队', '张班长', ''],
  ],
});
section('A', () => {
  r = run(noDue, [], 'nodue');
  eq(r.summary.counts.overdue, 2, '5.1 缺要求完成时间时按推算判超期');
  const o41 = r.orders.overdue.find((x) => x.no === 'WO-41');
  eq(o41.dueAt, '2026-09-12', '5.2 推算要求完成日期正确（报修+7天）');
  eq(o41.overdueDays, 9, '5.3 推算后的超期天数');
  ok(/^推算：/.test(o41.dueBasis), '5.4 条目标注推算依据');
  ok(o41.dueBasis.includes('「一般」时限 7 天') && o41.dueBasis.includes('按优先级 3 中 推定'), '5.5 推算依据写明时限类别、天数与类别来源');
  ok(r.orders.overdue.find((x) => x.no === 'WO-42').dueBasis.includes('「抢修」时限 1 天'), '5.6 优先级 1（紧急）归抢修按 24 小时推算');
  ok(!r.orders.overdue.some((x) => x.no === 'WO-43'), '5.7 无优先级不推算、不判超期');
  eq(r.summary.counts.noPriority, 1, '5.8 无优先级工单单独计数');
  ok(/非厂内正式口径/.test(r.md), '5.9 报告注明默认口径非厂内正式口径');
});

// ---- 6. --sla 覆盖厂内口径
section('B', () => {
  const slaFile = mk('sla.xlsx', {
    '时限口径': [['优先级', '时限(天)'], ['紧急', 1], ['高', 2], ['中', 3], ['低', 10]],
  });
  r = run(noDue, ['--sla', slaFile], 'sla');
  eq(r.orders.meta.slaDays['一般'], 3, '6.1 厂内口径覆盖默认时限（旧版按优先级写的口径表：中→一般）');
  eq(r.orders.meta.slaOfficial, true, '6.2 标记为厂内口径');
  eq(r.orders.overdue.find((x) => x.no === 'WO-41').dueAt, '2026-09-08', '6.3 按厂内口径重算要求完成日');
  ok(!/非厂内正式口径/.test(r.md), '6.4 用厂内口径时不再打默认口径声明');
  const slaBad = mk('slabad.xlsx', { '时限口径': [['优先级', '时限(天)'], ['特别急', 1], ['中', '随便']] });
  r = run(base, ['--sla', slaBad], 'slabad');
  eq(r.summary.ok, true, '6.5 口径表含非法行不中断');
  ok(r.orders.warnings.some((w) => w.includes('不在枚举内')), '6.6 口径表非法优先级 warning');
  ok(r.orders.warnings.some((w) => w.includes('无法解析为天数')), '6.7 口径表非法时限 warning');
  eq(r.orders.meta.slaDays['一般'], 7, '6.8 非法行跳过后仍按默认口径');
});

// ---- 7. 停滞判定：用最后一个有值节点，节点全缺则未判定（绝不按当前时间补齐）
const stall = mk('stall.xlsx', {
  '工单台账': [HDR,
    // 最后节点为开工 09-10，停滞 11 天
    ['WO-51', 'P-51', '泵51', '漏', '施工中', '中', '2026-09-01 08:00', '2026-09-30', '2026-09-02 09:00', '2026-09-10 08:00', '', '', '机修一队', '张班长', ''],
    // 最后节点为派工 09-19，仅 2 天，不停滞
    ['WO-52', 'P-52', '泵52', '漏', '已派工', '中', '2026-09-18 08:00', '2026-09-30', '2026-09-19 09:00', '', '', '', '机修一队', '张班长', ''],
    // 节点时间全缺 → 停滞未判定
    ['WO-53', 'P-53', '泵53', '漏', '待审核', '中', '', '2026-09-30', '', '', '', '', '机修一队', '张班长', ''],
  ],
});
section('A', () => {
  r = run(stall, [], 'stall');
  eq(r.summary.counts.stalled, 1, '7.1 停滞数（默认阈值 7 天）');
  eq(r.orders.stalled[0].no, 'WO-51', '7.2 停滞工单识别正确');
  eq(r.orders.stalled[0].idleDays, 11, '7.3 停滞天数按最后有值节点计算');
  eq(r.orders.stalled[0].lastNode, '开工时间', '7.4 标注最后有值节点名');
  eq(r.summary.counts.stallUndetermined, 1, '7.5 节点全缺 → 停滞未判定单列');
  ok(!r.orders.stalled.some((x) => x.no === 'WO-53'), '7.6 节点全缺未被按当前时间补齐计入停滞');
  ok(r.orders.warnings.some((w) => w.includes('无法判定是否停滞')), '7.7 未判定 warning');
  ok(/停滞未判定/.test(r.md), '7.8 报告单列停滞未判定');
});
section('B', () => {
  r = run(stall, ['--stall-days', '2'], 'stall2');
  eq(r.summary.counts.stalled, 2, '7.9 --stall-days 2 时停滞数变化');
});

// ---- 8. 时长无法计算 → null（显示「—」），绝不补齐为 0 或当前时间
section('A', () => {
  const nocycle = mk('nocycle.xlsx', {
    '工单台账': [HDR,
      // 已闭环但报修时间缺失 → cycleDays null
      ['WO-61', 'P-61', '泵61', '漏', '已闭环', '中', '', '2026-09-17', '2026-09-10 09:00', '2026-09-11 08:00', '2026-09-14 16:00', '2026-09-15 09:00', '机修一队', '张班长', ''],
      ['WO-62', 'P-62', '泵62', '漏', '已闭环', '中', '2026-09-10 08:00', '2026-09-17', '2026-09-10 09:00', '2026-09-11 08:00', '2026-09-14 16:00', '2026-09-15 09:00', '机修一队', '张班长', ''],
    ],
  });
  r = run(nocycle, [], 'nocycle');
  eq(r.orders.closed.find((x) => x.no === 'WO-61').cycleDays, null, '8.1 报修时间缺失时闭环时长为 null');
  eq(r.summary.metrics.avgCycleDays, 5, '8.2 平均值只用可计算样本（不含 null）');
  eq(r.orders.metrics.cycleUnavailable, 1, '8.3 不可计算样本单独计数');
  ok(/\| — \|/.test(r.md), '8.4 报告中 null 显示为「—」');
  ok(!/闭环时长\(天\).*\| 0 \|/.test(r.md), '8.5 未把不可计算的时长按 0 显示');
  ok(r.orders.warnings.some((w) => w.includes('不按当前时间补齐')), '8.6 warning 声明不按当前时间补齐');
});

// ---- 9. 按期达标率：缺依据的不判定，既不算达标也不算超标
section('A', () => {
  const ontime = mk('ontime.xlsx', {
    '工单台账': [HDR,
      ['WO-71', 'P-71', '泵71', '漏', '已闭环', '中', '2026-09-10 08:00', '2026-09-17', '', '', '2026-09-14 16:00', '2026-09-15 09:00', '机修一队', '张班长', ''],
      ['WO-72', 'P-72', '泵72', '漏', '已闭环', '中', '2026-09-01 08:00', '2026-09-08', '', '', '2026-09-14 16:00', '2026-09-15 09:00', '机修一队', '张班长', ''],
      // 无要求完成时间、无优先级 → onTime 未判定
      ['WO-73', 'P-73', '泵73', '漏', '已闭环', '', '2026-09-01 08:00', '', '', '', '2026-09-14 16:00', '2026-09-15 09:00', '机修一队', '张班长', ''],
    ],
  });
  r = run(ontime, [], 'ontime');
  const mid = r.orders.metrics.byCategory.find((x) => x.category === '一般');
  eq(mid.judged, 2, '9.1 可判定按期的样本数');
  eq(mid.onTime, 1, '9.2 按期数');
  eq(mid.onTimeRate, 50, '9.3 达标率 50%');
  eq(r.orders.closed.find((x) => x.no === 'WO-73').onTime, null, '9.4 缺依据时按期为 null 未判定');
  eq(r.summary.counts.noPriority, 1, '9.5 无优先级不进任何优先级分组');
});

// ---- 10. 无任何未闭环工单：各节显示「无」，催办清单说明无需催办
section('C', () => {
  const allclosed = mk('allclosed.xlsx', {
    '工单台账': [HDR,
      ['WO-81', 'P-81', '泵81', '漏', '已闭环', '中', '2026-09-10 08:00', '2026-09-17', '2026-09-10 09:00', '2026-09-11 08:00', '2026-09-14 16:00', '2026-09-15 09:00', '机修一队', '张班长', ''],
      ['WO-82', 'P-82', '泵82', '漏', '已闭环', '低', '2026-09-01 08:00', '2026-09-16', '2026-09-02 09:00', '2026-09-03 08:00', '2026-09-09 16:00', '2026-09-10 09:00', '机修二队', '李工长', ''],
    ],
  });
  r = run(allclosed, [], 'allclosed');
  eq(r.summary.counts.open, 0, '10.1 无未闭环工单');
  eq(r.summary.counts.overdue, 0, '10.2 超期 0');
  eq(r.summary.counts.stalled, 0, '10.3 停滞 0');
  eq(r.summary.counts.dueSoon, 0, '10.4 临期 0');
  eq(r.summary.metrics.closeRate, 100, '10.5 完成率 100%');
  ok(/## 二、超期工单\n\n_无_/.test(r.md), '10.6 超期节显示「无」');
  ok(/## 四、临期工单\n\n_判定口径[^\n]*\n\n_无_/.test(r.md), '10.7 临期节显示「无」');
  ok(/无超期或停滞工单，无需催办/.test(r.urge), '10.8 催办清单说明无需催办');
});

// ---- 11. 催办清单：按责任方分组，原因未记录不得推测
section('B', () => {
  r = run(base, [], 'urge');
  ok(fs.existsSync(path.join(r.out, '催办清单.md')), '11.1 催办清单.md 已生成');
  ok(/## 1\. 机修一队 \/ 张班长/.test(r.urge), '11.2 按「承修单位 / 责任人」分组');
  ok(/备件未到/.test(r.urge), '11.3 台账已记录的原因原样带出');
});
section('A', () => {
  r = run(noDue, [], 'urge2');
  ok(/原因未记录/.test(r.urge), '11.4 台账未记录原因时写「原因未记录」');
  ok(r.orders.overdue.every((x) => x.reason === '原因未记录' || x.reason.length > 0), '11.5 超期原因字段恒有值');
  ok(/未作任何推测/.test(r.urge), '11.6 催办清单声明未推测原因');
});

// ---- 12. 责任方缺失时不臆造
section('B', () => {
  const noparty = mk('noparty.xlsx', {
    '工单台账': [HDR,
      ['WO-91', 'P-91', '泵91', '漏', '施工中', '中', '2026-09-05 08:00', '2026-09-10', '2026-09-05 09:00', '2026-09-06 08:00', '', '', '', '', ''],
    ],
  });
  r = run(noparty, [], 'noparty');
  eq(r.orders.overdue[0].party, '（未填写责任方）', '12.1 责任方缺失时标注未填写');
  ok(/（未填写责任方）/.test(r.urge), '12.2 催办清单保留未填写责任方分组');
});

// ---- 13. 合计行跳过 + 标题行表头识别 + 别名列头 + 状态同义词
section('B', () => {
  const mes = mk('mes.xlsx', {
    '工单台账': [
      ['某厂 MES 工单导出'],
      [],
      ['工单编号', '设备位号', '名称', '故障现象', '工单状态', '紧急程度', '报修日期', '计划完成日期', '派单时间', '实际完工时间', '施工单位', '负责人'],
      ['MES-01', 'P-01', '泵1', '异响', '维修中', '二级', '2026-09-08 08:00', '2026-09-12', '2026-09-08 10:00', '', '外委队', '刘经理'],
      ['MES-02', 'P-02', '泵2', '堵塞', '已关闭', '三级', '2026-09-01 08:00', '2026-09-08', '2026-09-01 09:00', '2026-09-06 17:00', '机修一队', '周班长'],
      ['合计', '', '', '', '', '', '', '', '', '', '', ''],
    ],
  });
  r = run(mes, [], 'mes');
  eq(r.summary.ok, true, '13.1 MES 风格可读');
  eq(r.summary.counts.total, 2, '13.2 合计行被跳过');
  ok(r.orders.warnings.some((w) => w.includes('合计行')), '13.3 合计行 warning');
  eq(r.orders.byStatus.find((x) => x.status === '施工中').count, 1, '13.4 「维修中」识别为施工中');
  eq(r.orders.byStatus.find((x) => x.status === '已闭环').count, 1, '13.5 「已关闭」识别为已闭环');
  eq(r.orders.metrics.byPriority.find((x) => x.priority === 2).total, 1, '13.6 「二级」识别为 SAP 优先级 2 高');
});

// ---- 14. 工单号为空跳过并 warning
section('C', () => {
  const noNo = mk('nono.xlsx', {
    '工单台账': [HDR,
      ['', 'P-01', '泵1', '漏', '施工中', '中', '2026-09-18 08:00', '2026-09-25', '', '', '', '', '机修一队', '张班长', ''],
      ['WO-A1', 'P-02', '泵2', '漏', '施工中', '中', '2026-09-18 08:00', '2026-09-25', '', '', '', '', '机修一队', '张班长', ''],
    ],
  });
  r = run(noNo, [], 'nono');
  eq(r.summary.counts.total, 1, '14.1 空工单号行被跳过');
  ok(r.orders.warnings.some((w) => w.includes('工单号为空')), '14.2 空工单号 warning');
});

// ---- 15. 缺表 / 缺列
section('B', () => {
  const nosheet = mk('nosheet.xlsx', { '随便一张表': [['a', 'b'], [1, 2]] });
  r = run(nosheet, [], 'nosheet');
  eq(r.summary.ok, false, '15.1 无「工单台账」工作表时 ok:false');
  eq(r.code, 1, '15.2 退出码为 1');
  ok(/未在输入中找到/.test(r.summary.error), '15.3 错误信息明确');
  const nocol = mk('nocol.xlsx', {
    '工单台账': [['工单号', '位号', '设备名称'], ['WO-C1', 'P-01', '泵1'], ['WO-C2', 'P-02', '泵2']],
  });
  r = run(nocol, [], 'nocol');
  eq(r.summary.ok, true, '15.4 缺「状态」列不中断');
  ok(r.orders.warnings.some((w) => w.includes('缺少列') && w.includes('状态')), '15.5 缺列 warning');
  eq(r.summary.counts.unknownStatus, 2, '15.6 缺状态列时全部归入未知状态，不按已闭环或在办默认');
  eq(r.summary.counts.known, 0, '15.7 无已知状态工单');
  eq(r.summary.metrics.closeRate, null, '15.8 无可用分母时完成率为 null 而非 0');
  ok(/完成率 \| —/.test(r.md), '15.9 完成率 null 显示为「—」');
});

// ---- 16. 无法解析的时间 → warning + 按缺失处理，绝不猜测
section('C', () => {
  const badtime = mk('badtime.xlsx', {
    '工单台账': [HDR,
      ['WO-D1', 'P-01', '泵1', '漏', '施工中', '中', '上周三', '尽快', '', '', '', '', '机修一队', '张班长', ''],
    ],
  });
  r = run(badtime, [], 'badtime');
  eq(r.summary.ok, true, '16.1 时间无法解析不中断');
  ok(r.orders.warnings.some((w) => w.includes('报修时间「上周三」无法解析')), '16.2 报修时间无法解析 warning');
  ok(r.orders.warnings.some((w) => w.includes('要求完成时间「尽快」无法解析')), '16.3 要求完成时间无法解析 warning');
  eq(r.summary.counts.overdue, 0, '16.4 时间不可解析时不判超期（不猜测）');
  eq(r.summary.counts.stallUndetermined, 1, '16.5 时间不可解析时停滞列未判定');
});

// ---- 17. 参数校验
function runRaw(args) {
  const rr = spawnSync(process.execPath, [TRACK, ...args], { encoding: 'utf8' });
  const lines = rr.stdout.trim().split('\n');
  try { return { code: rr.status, s: JSON.parse(lines[lines.length - 1]) }; } catch (e) { return { code: rr.status, s: { ok: false, error: 'no-json' } }; }
}
section('B', () => {
  let x = runRaw(['--input']);
  eq(x.s.ok, false, '17.1 --input 缺值报错');
  ok(/缺少取值/.test(x.s.error), '17.2 缺值错误信息正确');
  eq(x.code, 1, '17.3 退出码为 1');
  x = runRaw(['--input', base, '--workshop', '车间', '--date', '2026-13-45']);
  eq(x.s.ok, false, '17.4 非法日期报错');
  x = runRaw(['--input', base, '--workshop', '车间', '--date', DATE, '--未知参数', 'x']);
  eq(x.s.ok, false, '17.5 未知参数报错');
  x = runRaw(['--input', '/不存在的路径.xlsx', '--workshop', '车间', '--date', DATE]);
  eq(x.s.ok, false, '17.6 输入不存在报错');
  x = runRaw(['--input', base, '--workshop', '车间', '--date', DATE, '--from', '2026-10-01']);
  eq(x.s.ok, false, '17.7 --from 晚于 --date 报错');
  x = runRaw(['--input', base, '--workshop', '车间', '--date', DATE, '--stall-days', '零']);
  eq(x.s.ok, false, '17.8 --stall-days 非数字报错');
  x = runRaw(['--input', base, '--workshop', '车间']);
  eq(x.s.ok, false, '17.9 缺 --date 报错');
  x = runRaw(['--input', base, '--workshop', '车间', '--date', DATE, '--sla', '/不存在的口径.xlsx']);
  eq(x.s.ok, false, '17.10 --sla 文件不存在报错');
});

// ---- 18. --from 区间过滤闭环工单
section('B', () => {
  r = run(base, ['--from', '2026-09-16'], 'fromfilter');
  eq(r.summary.counts.closedInRange, 0, '18.1 --from 之后无闭环工单');
  eq(r.summary.counts.closedAll, 1, '18.2 已闭环总数不受区间影响');
  r = run(base, ['--from', '2026-09-01'], 'fromfilter2');
  eq(r.summary.counts.closedInRange, 1, '18.3 区间内闭环工单计入');
});

// ---- 19. --vendor / --owner 范围过滤
section('B', () => {
  r = run(base, ['--vendor', '机修一队'], 'vendor');
  eq(r.summary.counts.total, 2, '19.1 按承修单位过滤');
  r = run(base, ['--owner', '李工长'], 'owner');
  eq(r.summary.counts.total, 2, '19.2 按责任人过滤');
  r = run(badst, ['--vendor', '不存在的队'], 'vendornone');
  eq(r.summary.counts.total, 0, '19.3 过滤后无工单不报错');
  eq(r.summary.counts.unknownStatus, 0, '19.4 未知状态清单随过滤范围收敛，计数不失真');
  ok(r.orders.warnings.some((w) => w.includes('过滤后无工单')), '19.5 过滤后无工单 warning');
});

// ---- 20. 产出结构与落盘
section('BVT', () => {
  r = run(base, [], 'struct');
  ok(fs.existsSync(path.join(r.out, 'summary.json')), '20.1 summary.json 已写入');
  const sj = JSON.parse(fs.readFileSync(path.join(r.out, 'summary.json'), 'utf8'));
  eq(sj.ok, true, '20.2 summary.json 内容正确');
  ok(fs.existsSync(path.join(r.out, 'orders.json')), '20.3 orders.json 已写入');
  ok(/## 一、状态分布/.test(r.md) && /## 二、超期工单/.test(r.md) && /## 三、停滞工单/.test(r.md)
    && /## 四、临期工单/.test(r.md) && /## 五、区间内闭环工单/.test(r.md) && /## 六、指标统计/.test(r.md)
    && /## 七、未知状态工单/.test(r.md) && /## 八、工单执行情况说明/.test(r.md), '20.4 八节结构齐全');
  ok(/<!-- ANALYSIS_START -->/.test(r.md) && /<!-- ANALYSIS_END -->/.test(r.md), '20.5 分析段占位符存在');
  ok(/## 附：数据提示/.test(r.md) === (r.orders.warnings.length > 0), '20.6 有 warning 时报告附数据提示');
});


// ---- 21. SAP PM 订单导出列名（订单/功能位置/设备/系统状态/订单类型/基本开始/结束日期/主工作中心）
const sap = mk('sap.xlsx', {
  '订单': [
    ['订单', '通知单', '订单类型', '功能位置', '设备', '设备描述', '订单描述', '优先级', '系统状态', '创建日期', '基本开始日期', '基本结束日期', '实际结束日期', '主工作中心'],
    ['40010001', '10020001', 'PM03', 'P-01', '10000001', '进料泵A', '机封泄漏', '1', 'REL', '2026-09-18 08:00', '2026-09-18 09:00', '', '', 'JX-DSB1'],
    ['40010002', '10020002', 'PM01', 'E-01', '10000002', '换热器', '法兰渗漏', '3', 'TECO', '2026-09-05 08:00', '2026-09-05 09:00', '2026-09-12', '2026-09-10 16:00', 'JX-JSB2'],
    ['40010003', '10020003', 'PM02', 'V-01', '10000003', '缓冲罐', '定期检查', '4', 'CLSD', '2026-08-01 08:00', '2026-08-02 09:00', '2026-08-31', '2026-08-20 16:00', 'JX-JSB2'],
    ['40010004', '10020004', 'PM01', 'K-01', '10000004', '压缩机', '振动高', '2', 'CRTD', '2026-09-20 08:00', '', '', '', 'JX-DSB1'],
    ['40010005', '', 'PM01', 'T-01', '10000005', '分馏塔', '塔顶阀内漏', '3', 'DLFL', '2026-09-01 08:00', '', '', '', 'JX-JSB2'],
  ],
});
{
  let o1;
  section('A', () => {
    r = run(sap, [], 'sap');
    eq(r.summary.ok, true, '21.1 SAP 订单导出可读（工作表名「订单」）');
    eq(r.summary.counts.total, 5, '21.2 5 张订单全部读入');
    eq(r.orders.byStatus.find((x) => x.status === '已派工').count, 1, '21.3 REL→已派工');
    eq(r.orders.byStatus.find((x) => x.status === '待验收').count, 1, '21.4 TECO→待验收（不是已闭环）');
    eq(r.orders.byStatus.find((x) => x.status === '已闭环').count, 1, '21.5 CLSD→已闭环');
    eq(r.orders.byStatus.find((x) => x.status === '待审核').count, 1, '21.6 CRTD→待审核');
    eq(r.orders.byStatus.find((x) => x.status === '已取消').count, 1, '21.7 DLFL→已取消');
    eq(r.summary.counts.unknownStatus, 0, '21.8 SAP 系统状态无一进未知状态');
    o1 = r.orders.overdue.find((x) => x.no === '40010001');
    ok(!!o1, '21.9 PM03 抢修订单无基本结束日期时按 24 小时推算判超期');
    ok(o1 && o1.dueBasis.includes('「抢修」时限 1 天') && o1.dueBasis.includes('工单类型「PM03」'), '21.10 推算依据标注类别来源为工单类型 PM03');
    eq(o1 && o1.category, '抢修', '21.11 订单类型 PM03→抢修');
  });
  section('B', () => {
    eq(o1 && o1.vendor, 'JX-DSB1', '21.12 主工作中心→承修单位');
    eq(o1 && o1.notifNo, '10020001', '21.13 通知单号带出');
    eq(o1 && o1.equipNo, '10000001', '21.14 「设备」列作设备编号，不当位号');
    eq(o1 && o1.tag, 'P-01', '21.15 「功能位置」作位号');
  });
  section('A', () => {
    const o2 = r.orders.overdue.find((x) => x.no === '40010002');
    ok(!!o2 && o2.dueAt === '2026-09-12' && o2.dueBasis === '台账要求完成时间', '21.16 基本结束日期作要求完成时间，TECO 待验收仍在办可超期');
    eq(o2 && o2.category, '一般', '21.17 PM01→一般');
    eq(r.orders.closed.find((x) => x.no === '40010003').category, '计划性', '21.18 PM02→计划性');
    eq(r.orders.metrics.byCategory.find((x) => x.category === '计划性').slaDays, 30, '21.19 计划性默认 30 天');
    eq(r.orders.metrics.byCategory.find((x) => x.category === '抢修').slaDays, 1, '21.20 抢修默认 1 天');
    eq(r.orders.metrics.byCategory.find((x) => x.category === '一般').slaDays, 7, '21.21 一般默认 7 天');
  });
  section('B', () => {
    ok(/40010001/.test(r.urge) && /JX-DSB1/.test(r.urge), '21.22 催办清单按工作中心分组');
    ok(r.orders.metrics.byType['PM03'] === 1 && r.orders.metrics.byType['PM01'] === 3, '21.23 按工单类型计数');
  });
}

// ---- 22. 「已完成/完工」归待验收而非闭环；否定前缀先判；中文 SAP 状态
section('A', () => {
  const done = mk('done.xlsx', {
    '工单台账': [HDR,
      ['WO-E1', 'P-01', '泵1', '漏', '已完成', '中', '2026-09-10 08:00', '2026-09-17', '2026-09-10 09:00', '2026-09-11 08:00', '2026-09-14 16:00', '', '机修一队', '张班长', ''],
      ['WO-E2', 'P-02', '泵2', '漏', '完工', '中', '2026-09-10 08:00', '2026-09-30', '2026-09-10 09:00', '2026-09-11 08:00', '2026-09-20 16:00', '', '机修一队', '张班长', ''],
      ['WO-E3', 'P-03', '泵3', '漏', '未验收', '中', '2026-09-10 08:00', '2026-09-30', '2026-09-10 09:00', '', '', '', '机修一队', '张班长', ''],
      ['WO-E4', 'P-04', '泵4', '漏', '技术完成', '中', '2026-09-10 08:00', '2026-09-30', '2026-09-10 09:00', '', '', '', '机修一队', '张班长', ''],
      ['WO-E5', 'P-05', '泵5', '漏', '业务完成', '中', '2026-09-01 08:00', '2026-09-10', '2026-09-01 09:00', '2026-09-02 08:00', '2026-09-05 16:00', '2026-09-06 09:00', '机修一队', '张班长', ''],
      ['WO-E6', 'P-06', '泵6', '漏', '已下达', '中', '2026-09-19 08:00', '2026-09-30', '2026-09-19 09:00', '', '', '', '机修一队', '张班长', ''],
      ['WO-E7', 'P-07', '泵7', '漏', '删除标记', '中', '2026-09-19 08:00', '2026-09-30', '', '', '', '', '机修一队', '张班长', ''],
    ],
  });
  r = run(done, [], 'done');
  eq(r.orders.byStatus.find((x) => x.status === '待验收').count, 4, '22.1 已完成/完工/未验收/技术完成 均归待验收');
  eq(r.orders.byStatus.find((x) => x.status === '已闭环').count, 1, '22.2 只有「业务完成」归已闭环');
  eq(r.summary.counts.closedAll, 1, '22.3 「已完成」不计入已闭环');
  ok(r.orders.overdue.some((x) => x.no === 'WO-E1'), '22.4 「已完成」且已过要求完成时间 → 仍在办并判超期');
  eq(r.orders.byStatus.find((x) => x.status === '已派工').count, 1, '22.5 已下达→已派工');
  eq(r.orders.byStatus.find((x) => x.status === '已取消').count, 1, '22.6 删除标记→已取消');
  eq(r.summary.metrics.closeRate, C_round1(1 / 6 * 100), '22.7 完成率分母剔除删除标记，已完成不进分子');
  ok(/「已完成」不等于闭环/.test(r.md), '22.8 md 注明已完成不等于闭环');
});

// ---- 23. 时限类别缺失（无工单类型且无优先级）→ 不推算、单独计数；工单类型认不出 → warning 改按优先级
section('B', () => {
  const nocat = mk('nocat.xlsx', {
    '工单台账': [['工单号', '位号', '状态', '工单类型', '优先级', '报修时间'],
      ['WO-F1', 'P-01', '施工中', '', '', '2026-09-01 08:00'],
      ['WO-F2', 'P-02', '施工中', '临时', '2', '2026-09-01 08:00'],
      ['WO-F3', 'P-03', '施工中', '抢修', '', '2026-09-19 08:00'],
    ],
  });
  r = run(nocat, [], 'nocat');
  eq(r.summary.counts.noCategory, 1, '23.1 无类型无优先级 → 无时限类别单独计数');
  ok(!r.orders.overdue.some((x) => x.no === 'WO-F1'), '23.2 无时限类别不推算、不判超期');
  ok(r.orders.warnings.some((w) => w.includes('WO-F2') && w.includes('无法归入')), '23.3 工单类型认不出 warning');
  eq(r.orders.overdue.find((x) => x.no === 'WO-F2').category, '一般', '23.4 类型认不出时改按优先级 2→一般');
  eq(r.orders.overdue.find((x) => x.no === 'WO-F3').category, '抢修', '23.5 中文类型「抢修」直接归抢修');
  ok(/无法归入时限类别/.test(r.md), '23.6 md 说明无时限类别工单不参与达标率');
});

// ---- 24. 口径表按类别写法 + 临期窗口参数化 + 产出口径
section('B', () => {
  const slaCat = mk('slacat.xlsx', { '时限口径': [['类别', '时限'], ['抢修', '1天'], ['一般', '5天'], ['计划性', '20天']] });
  r = run(noDue, ['--sla', slaCat], 'slacat');
  eq(r.orders.meta.slaDays['一般'], 5, '24.1 口径表按类别（一般）覆盖');
  eq(r.orders.meta.slaDays['计划性'], 20, '24.2 口径表按类别（计划性）覆盖');
  ok(!r.orders.warnings.some((w) => w.includes('未给出')), '24.3 三类齐全时无缺口径 warning');
  r = run(base, ['--due-soon', '5'], 'duesoon5');
  eq(r.summary.counts.dueSoon, 1, '24.4 --due-soon 5 时 WO-02（剩 4 天）进临期');
  r = run(base, [], 'duesoon2');
  eq(r.summary.counts.dueSoon, 0, '24.5 默认临期窗口 2 天时 WO-02 不进临期');
});
section('C', () => {
  ok(r.md.includes('本材料由脚本汇总、模型成文，仅供设备员复核参考'), '24.6 md 开头带通用声明行');
  ok(/【注意】/.test(r.md) && !/[✅⚠️❌]/.test(r.md) && !/[✅⚠️❌]/.test(r.urge), '24.7 md 用【注意】提示且不含 emoji');
  ok(/抢修 1 天、一般 7 天、计划性 30 天/.test(r.md), '24.8 md 头部时限口径按 抢修/一般/计划性 展示');
  ok(/\| 1 非常高 \|/.test(r.md) || /\| 3 中 \|/.test(r.md), '24.9 md 优先级同时显示数字与中文');
  ok(/按时限类别达标情况/.test(r.md) && /按 SAP 优先级分布/.test(r.md), '24.10 md 含时限类别达标表与优先级分布表');
  ok(!/机动处/.test(r.md) && !/EAM/.test(r.md), '24.11 md 不出现旧称机动处/EAM');
});
// 默认输出目录为系统临时目录，不落在输入文件旁
{
  section('B', () => {
    const rr = spawnSync(process.execPath, [TRACK, '--input', base, '--workshop', '测试车间', '--date', DATE], { encoding: 'utf8' });
    const lines = rr.stdout.trim().split('\n');
    const sj2 = JSON.parse(lines[lines.length - 1]);
    ok(sj2.ok && sj2.out.startsWith(os.tmpdir()) && !fs.existsSync(path.join(path.dirname(base), 'wot-out')), '24.12 默认输出目录为 os.tmpdir()/wot-out，不写入输入同目录');
  });
}

function C_round1(v) { return Math.round(v * 10) / 10; }


// ---- W. 车间范围核对（D007）
{
  const wsHead = ['工单号', '位号', '状态', '要求完成时间'];
  const wsBook = (col, vals) => mk(`ws-${col}-${vals.join('_') || 'none'}.xlsx`, {
    '工单台账': [col ? [...wsHead, col] : wsHead,
      ...vals.map((v, i) => (col ? [`WS-0${i}`, `P-90${i}`, '施工中', '2026-09-15', v] : [`WS-0${i}`, `P-90${i}`, '施工中', '2026-09-15']))],
  });
  const wsOf = (x) => ((x.orders && x.orders.meta && x.orders.meta.workshopScope) || [])[0] || {};
  const wsNos = (x) => ((x.orders && x.orders.overdue) || []).map((o) => o.no);
  let w;
  section('A', () => {
    w = run(wsBook('车间', ['测试车间', '催化车间', '', '测试']), [], 'ws-mix');
    eq(w.orders && w.orders.counts.total, 3, 'W1 两车间混合：只统计本车间与车间为空的工单（3 张）');
    ok(w.orders && !wsNos(w).includes('WS-01') && wsNos(w).includes('WS-00'), 'W2 催化车间的 WS-01 不进超期清单');
    ok(w.orders && w.orders.warnings.some((x) => /剔除其他车间 1 行/.test(x) && /催化车间 1 行/.test(x)), 'W3 warning 写明剔除行数与车间名');
    ok(wsOf(w).status === 'checked' && wsOf(w).droppedRows === 1 && (wsOf(w).dropped || {})['催化车间'] === 1, 'W4 meta.workshopScope 记录剔除情况');
    ok(wsOf(w).blank === 1 && wsNos(w).includes('WS-02'), 'W5 车间列为空的行按本车间保留');
    ok(w.md && /车间范围：已按车间列核对「测试车间」，剔除其他车间的行/.test(w.md), 'W6 tracking.md 口径写明按车间核对');
    ok(w.urge && !/WS-01/.test(w.urge), 'W7 催办清单不含其他车间工单');
    w = run(wsBook('车间', ['催化车间', '焦化车间']), [], 'ws-mis');
    ok(w.orders && w.orders.counts.total === 2 && wsOf(w).status === 'mismatch', 'W8 车间列全不一致：不筛，status=mismatch');
    ok(w.orders && w.orders.warnings.some((x) => /^【注意】/.test(x)), 'W9 车间列全不一致 warning 以【注意】开头');
    const at = w.md ? w.md.indexOf('的车间列取值与 --workshop「测试车间」不一致') : -1;
    ok(at > 0 && at < w.md.indexOf('## 一') && /^【注意】|\*\*【注意】/m.test(w.md.slice(0, w.md.indexOf('## 一'))), 'W10 tracking.md 开头（第一节之前）有【注意】提示');
    ok(w.urge && /的车间列取值与 --workshop「测试车间」不一致/.test(w.urge), 'W11 催办清单开头同样提示');
  });
  section('B', () => {
    w = run(wsBook(null, ['', '']), [], 'ws-nocol');
    ok(wsOf(w).status === 'noColumn' && w.md && /输入未含车间列，车间范围以取数条件为准/.test(w.md), 'W12 无车间列：不筛，md 口径说明以取数条件为准');
    w = run(wsBook('维护工厂', ['1100', '1200']), [], 'ws-plant');
    ok(wsOf(w).status === 'noColumn' && w.orders.counts.total === 2, 'W13 「维护工厂」列不当车间列（noColumn，不筛）');
    w = run(wsBook('所属车间', ['测试车间', '催化车间']), [], 'ws-ssc');
    ok(wsOf(w).status === 'checked' && wsOf(w).column === '所属车间' && w.orders.counts.total === 1, 'W14 「所属车间」列同样核对');
  });
}

// ---- 25. 演示case 样例预期计数（目录不存在则跳过）
// 演示样例：仓库内在 炼厂车间设备员/演示case/<分类>/<技能>/，开发包内在技能目录 examples/
section('B', () => {
  const skillsRoot = path.resolve(__dirname, '../../..');
  const EX = path.basename(skillsRoot) === '设备员skill' ? path.join(skillsRoot, '..', '演示case', path.relative(skillsRoot, path.resolve(__dirname, '..'))) : path.join(__dirname, '..', 'examples');
  if (fs.existsSync(path.join(EX, 'sample-work-orders-2026-09-21.xlsx'))) {
    r = run(path.join(EX, 'sample-work-orders-2026-09-21.xlsx'), [], 'ex-main');
    ok(r.summary.counts.total === 14 && r.summary.counts.overdue === 3 && r.summary.counts.stalled === 3 && r.summary.counts.dueSoon === 4 && r.summary.counts.unknownStatus === 1, '25.1 演示case 主样例：14 张、超期 3、停滞 3、临期 4、未知 1');
    eq(r.summary.metrics.closeRate, 25, '25.2 演示case 主样例完成率 25%');
    r = run(path.join(EX, 'sample-work-orders-2026-09-21.xlsx'), ['--sla', path.join(EX, 'sample-sla.xlsx')], 'ex-sla');
    ok(r.orders.meta.slaOfficial && r.orders.meta.slaDays['一般'] === 5 && r.orders.meta.slaDays['计划性'] === 20, '25.3 演示case 厂内口径表按类别生效');
    eq(r.orders.overdue.find((x) => x.no === 'WO-26090103').dueAt, '2026-09-14', '25.4 演示case 推算条目按厂内口径（一般 5 天）提前');
    r = run(path.join(EX, 'sample-sap-export.xlsx'), [], 'ex-sap');
    ok(r.summary.counts.total === 6 && r.summary.counts.overdue === 2 && r.summary.counts.stalled === 1 && r.summary.counts.closedAll === 1 && r.summary.counts.cancelled === 1 && r.summary.counts.unknownStatus === 0, '25.5 演示case SAP 导出：6 张、超期 2、停滞 1、闭环 1、取消 1、未知 0');
    ok(r.orders.overdue.some((x) => x.no === '40012302' && x.status === '待验收'), '25.6 演示case SAP TECO 订单归待验收并判超期');
    ok(r.orders.overdue.some((x) => x.no === '40012301' && x.category === '抢修'), '25.7 演示case SAP PM03 订单按抢修 24h 推算超期');
    r = run(path.join(EX, 'sample-mes-export.xlsx'), [], 'ex-mes');
    ok(r.summary.counts.total === 3 && r.summary.counts.overdue === 2, '25.8 演示case MES 导出：3 张、超期 2');
    r = run(path.join(EX, 'sample-all-closed.xlsx'), [], 'ex-closed');
    ok(r.summary.counts.open === 0 && r.summary.metrics.closeRate === 100, '25.9 演示case 全闭环样例完成率 100%');
  }
});

// ---- 输出
console.log(`\n${'='.repeat(56)}`);
console.log(`work-order-tracker 自测：${pass} 通过，${fail} 失败`);
console.log(`用例级别 ${LEVELS[RUN_LEVEL]}：BVT ${byLevel.BVT}，A ${byLevel.A}，B ${byLevel.B}，C ${byLevel.C}`);
if (failures.length) { console.log('\n失败项：'); failures.forEach((f) => console.log('  ✗ ' + f)); }
console.log('='.repeat(56));
try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
