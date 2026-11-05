#!/usr/bin/env node
'use strict';
/** 自测：断言 periodic.js 行为。用法：node scripts/selftest.js（全绿退出 0） */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { writeXlsx } = require('./lib/xlsx-lite');
const C = require('./lib/common');

const P = path.join(__dirname, 'periodic.js');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ewmr-selftest-'));
const FROM = '2026-09-14', TO = '2026-09-20';
const D = (n) => C.addDays(FROM, n);
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
const eq = (a, e, n) => ok(a === e, `${n}（期望 ${JSON.stringify(e)}，实际 ${JSON.stringify(a)}）`);

let seq = 0;
function run(input, extra = [], tag, from = FROM, to = TO, period = 'weekly') {
  const out = path.join(work, `${tag}-${++seq}-out`);
  const r = spawnSync(process.execPath, [P, '--input', input, '--workshop', '测试车间',
    '--period', period, '--from', from, '--to', to, '--out', out, ...extra], { encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  let s; try { s = JSON.parse(lines[lines.length - 1]); } catch (e) { s = { ok: false, error: 'no-json:' + r.stdout + r.stderr }; }
  let j = null, md = null;
  if (fs.existsSync(path.join(out, 'periodic.json'))) j = JSON.parse(fs.readFileSync(path.join(out, 'periodic.json'), 'utf8'));
  if (fs.existsSync(path.join(out, 'periodic.md'))) md = fs.readFileSync(path.join(out, 'periodic.md'), 'utf8');
  return { code: r.status, s, j, md, out };
}
const mk = (n, b) => { const p = path.join(work, n); writeXlsx(p, b); return p; };
const mkDailyDir = (dir, days, mut = () => {}) => {
  const d = path.join(work, dir);
  fs.mkdirSync(d, { recursive: true });
  for (const i of days) {
    const date = D(i);
    const o = {
      meta: { workshop: '测试车间', date },
      counts: { equipment: 20, abnormal: 1, newDefects: 2, openDefects: 5, overdueOrders: 1, openOrders: 6, events: 0, unclosedEvents: 0, maintProjects: 6 },
    };
    mut(o, i);
    fs.writeFileSync(path.join(d, `daily-${date}.json`), JSON.stringify(o, null, 2), 'utf8');
  }
  return d;
};
const gi = (c, k) => c.rows.find((x) => x.key === k);
function raw(args) {
  const x = spawnSync(process.execPath, [P, ...args], { encoding: 'utf8' });
  const l = x.stdout.trim().split('\n');
  try { return { code: x.status, s: JSON.parse(l[l.length - 1]) }; } catch (e) { return { code: x.status, s: { ok: false, error: '' } }; }
}
const BASEARGS = ['--workshop', 'X', '--period', 'weekly', '--from', FROM, '--to', TO];
let r;

// 全量原始台账（20 台设备 / 18 完好；8 条故障；6 项区间内检修计划、按期 3；8 张应闭环工单、按期 5）
const FULL = mk('full.xlsx', {
  '设备台账': [['位号', '设备名称', '设备类型', '专业', '在用', '完好'],
    ...Array.from({ length: 20 }, (_, i) => [`EQ-${1100 + i}`, `设备${i + 1}`, i % 2 ? '离心泵' : '电机', i % 3 ? '动设备' : '电气', '是', i < 18 ? '完好' : '非完好'])],
  '故障记录': [['位号', '设备名称', '设备类型', '专业', '故障描述', '故障时间', '停机时长', '修复时长'],
    ['P-1101B', '回流泵B', '离心泵', '动设备', '机封泄漏', D(0), 4, 2],
    ['P-1101B', '回流泵B', '离心泵', '动设备', '轴承温高', D(1), 3, 1.5],
    ['P-1101B', '回流泵B', '离心泵', '动设备', '振动超标', D(2), 2, 1],
    ['M-1501', '鼓风机电机', '电机', '电气', '电流冲高', D(3), 5, 3],
    ['P-1102A', '渣油泵A', '离心泵', '动设备', '对中偏差', D(4), 1, 0.5],
    ['E-1201', '换热器', '换热器', '静设备', '法兰渗漏', D(5), 6, 4],
    ['C-1401', '常压塔', '塔器', '静设备', '内件积垢', D(6), 2, 2],
    ['M-1502', '引风机电机', '电机', '电气', '绝缘下降', D(6), 1, 1]],
  '检修计划': [['项目名称', '位号', '状态', '计划完成', '实际完成', '责任人'],
    ['项目1', 'P-1101B', '已完成', D(1), D(1), '一队'],
    ['项目2', 'P-1102A', '已完成', D(2), D(2), '一队'],
    ['项目3', 'E-1201', '已完成', D(3), D(3), '二队'],
    ['项目4', 'M-1501', '已完成', D(4), D(6), '电气班'],
    ['项目5', 'V-1301', '施工中', D(5), '', '保运队'],
    ['项目6', 'C-1401', '未开工', D(6), '', '二队'],
    ['区间外项目', 'P-1103', '未开工', C.addDays(TO, 10), '', '一队']],
  '工单台账': [['工单号', '位号', '缺陷描述', '状态', '要求完成时间', '闭环时间', '责任人'],
    ['WO-01', 'P-1101B', '换机封', '已闭环', D(1), D(1), '一队'],
    ['WO-02', 'P-1102A', '对中', '已闭环', D(2), D(2), '一队'],
    ['WO-03', 'E-1201', '紧固', '已闭环', D(3), D(3), '二队'],
    ['WO-04', 'M-1501', '检测', '已闭环', D(4), D(6), '电气班'],
    ['WO-05', 'V-1301', '保温', '施工中', D(4), '', '保运队'],
    ['WO-06', 'C-1401', '除锈', '已闭环', D(5), D(5), '保运队'],
    ['WO-07', 'M-1502', '绝缘', '已派工', D(5), '', '电气班'],
    ['WO-08', 'P-1103', '检查', '已闭环', D(6), D(6), '一队'],
    ['WO-09', 'P-1104', '区间外', '已派工', C.addDays(TO, 8), '', '一队']],
  '缺陷台账': [['位号', '设备名称', '缺陷描述', '等级', '状态', '发现时间', '闭环时间'],
    ['P-1101B', '回流泵B', '机封漏', 'II 级', '已闭环', D(0), D(1)],
    ['M-1501', '鼓风机电机', '电流高', 'III 级', '处理中', D(3), ''],
    ['C-1401', '常压塔', '锈蚀', 'IV 级', '待处理', D(6), '']],
  '备件消耗': [['备件名称', '位号', '数量', '单位', '金额', '时间'],
    ['机械密封', 'P-1101B', 2, '套', 5000, D(1)],
    ['滚动轴承', 'P-1102A', 4, '套', 1200, D(2)],
    ['保温棉', 'V-1301', 20, '平方米', '', D(5)]],
});

// ============ A. 正常路径 ============
section('BVT', () => {
  r = run(FULL, [], 'full');
  eq(r.s.ok, true, 'A1 全量运行成功');
  eq(r.s.metrics.intactRate, 90, 'A2 设备完好率 18/20 = 90%');
  eq(r.s.metrics.intactGood, 18, 'A3 完好台数');
  eq(r.s.metrics.intactTotal, 20, 'A4 设备总台数（分母）');
  eq(r.s.metrics.planRate, 50, 'A5 检修计划完成率 3/6 = 50%');
  eq(r.s.counts.maintPlanned, 6, 'A6 区间外检修项目不计入分母');
  eq(r.s.metrics.orderRate, 62.5, 'A7 工单及时率 5/8 = 62.5%');
  eq(r.s.counts.ordersDue, 8, 'A8 区间外工单不计入应闭环分母');
  eq(r.s.metrics.downtime, 24, 'A9 故障停机时长合计 24 小时');
  eq(r.s.metrics.repairCount, 8, 'A10 修复次数');
  eq(r.s.metrics.mttr, 1.88, 'A11 MTTR = 15/8 = 1.88 小时');
  eq(r.s.counts.faults, 8, 'A12 故障次数');
  eq(r.j.failures.byDiscipline[0].name, '动设备', 'A13 按专业分布首位为动设备');
  eq(r.j.failures.byDiscipline[0].count, 4, 'A14 动设备故障 4 次');
  eq(r.j.failures.top[0].tag, 'P-1101B', 'A15 故障频次排行首位');
  eq(r.j.failures.top[0].count, 3, 'A16 频次排行次数');
  eq(r.j.failures.byType.length, 4, 'A17 按设备类型分布 4 类');
  eq(r.s.counts.spareItems, 3, 'A18 备件消耗行数');
  eq(r.j.spare.totalAmount, 6200, 'A19 备件金额仅累加已填写行，未按 0 计');
});

// ============ B. 缺失日期不外推（核心） ============
const DDIR = mkDailyDir('daily5', [0, 1, 3, 4, 6]);
section('A', () => {
  r = run(DDIR, [], 'gap');
  eq(r.s.ok, true, 'B1 日报目录输入可运行');
  eq(r.s.counts.dailyFiles, 5, 'B2 自动扫目录读到 5 份 daily.json');
  eq(r.s.counts.coveredDays, 5, 'B3 实际覆盖 5 天');
  eq(r.s.counts.missingDays, 2, 'B4 缺失 2 天');
  eq(r.j.dataGaps.missingDates.join(','), `${D(2)},${D(5)}`, 'B5 缺失的具体日期列出');
  ok(r.j.warnings.some((w) => w.includes(D(2)) && w.includes(D(5)) && w.includes('未外推补齐')), 'B6 warning 列出缺失日期并声明未外推');
  eq(r.s.metrics.basedOn, '基于 5 天数据（应为 7 天）', 'B7 指标注明基于 N 天（应为 M 天）');
  eq(r.s.counts.newDefects, 10, 'B8 新增缺陷为 5 天实际累加（2×5），未按 7 天外推');
  ok(r.s.counts.newDefects !== 14, 'B9 未按日均 2 条 ×7 天外推为 14');
  ok(/基于 5 天数据（应为 7 天）/.test(r.md.replace(/[（）]/g, (m) => m)) || /基于 5 天数据/.test(r.md), 'B10 md 中写明基于天数');
  ok(/未按已有天数平均后外推补齐/.test(r.md), 'B11 md 明确声明未外推补齐');
  ok(new RegExp(D(2)).test(r.md) && new RegExp(D(5)).test(r.md), 'B12 md 数据缺口节列出缺失日期');

  // 全覆盖时无缺失
  r = run(mkDailyDir('daily7', [0, 1, 2, 3, 4, 5, 6]), [], 'nogap');
  eq(r.s.counts.missingDays, 0, 'B13 全覆盖时缺失天数为 0');
  ok(!r.j.warnings.some((w) => w.includes('缺少')), 'B14 全覆盖时无缺失 warning');

  // daily.json 中该项为 null 时不按 0 计
  r = run(mkDailyDir('dailynull', [0, 1, 2, 3, 4, 5, 6], (o, i) => { if (i > 3) o.counts.newDefects = null; }), [], 'dailynull');
  eq(r.s.counts.newDefects, 8, 'B15 null 天数不参与求和（4 天 ×2）');
  ok(r.j.warnings.some((w) => w.includes('仅覆盖') && w.includes('未按 0 计')), 'B16 部分天数为空有 warning');
});

// ============ C. 完好率分母缺失 → null 不是 0%（核心） ============
const NOLEDGER = mk('noledger.xlsx', {
  '故障记录': [['位号', '设备名称', '设备类型', '专业', '故障描述', '故障时间', '停机时长', '修复时长'],
    ['P-01', '泵1', '离心泵', '动设备', '漏', D(1), 2, 1]],
});
section('A', () => {
  r = run(NOLEDGER, [], 'noledger');
  eq(r.s.ok, true, 'C1 无设备台账仍可运行');
  eq(r.s.metrics.intactRate, null, 'C2 完好率分母缺失时为 null 不是 0');
  ok(r.s.metrics.intactRate !== 0, 'C3 未按 0% 处理');
  eq(r.s.counts.equipmentTotal, null, 'C4 设备总台数为 null');
  ok(r.j.dataGaps.noDenominator.some((x) => x.metric === '设备完好率'), 'C5 分母缺失指标单列');
  ok(r.j.dataGaps.noDenominator.find((x) => x.metric === '设备完好率').reason.includes('不以在册台数或估计值代替'), 'C6 声明不用在册台数或估计值代替');
  ok(r.j.warnings.some((w) => w.includes('未使用在册台数或估计值代替')), 'C7 warning 声明未用估计值');
  ok(/设备完好率 \| — \|/.test(r.md), 'C8 md 中完好率显示 —');
  ok(!/设备完好率 \| 0\.0%/.test(r.md), 'C9 md 中未显示 0.0%');
  ok(/因分母缺失未计算/.test(r.md), 'C10 md 单列分母缺失说明');

});
// 台账缺「完好」列
const NOGOODCOL = mk('nogoodcol.xlsx', {
  '设备台账': [['位号', '设备名称', '在用'], ['EQ-01', '设备1', '是'], ['EQ-02', '设备2', '是']],
});
section('A', () => {
  r = run(NOGOODCOL, [], 'nogoodcol');
  eq(r.s.metrics.intactRate, null, 'C11 台账缺「完好」列时完好率为 null');
  ok(r.j.warnings.some((w) => w.includes('缺少「完好」列')), 'C12 缺列有 warning');
});

// 「完好」列取值无法判定 → 不按完好默认
const AMBIG = mk('ambig.xlsx', {
  '设备台账': [['位号', '在用', '完好'],
    ['EQ-01', '是', '完好'], ['EQ-02', '是', '完好'], ['EQ-03', '是', ''], ['EQ-04', '是', '说不清']],
});
section('A', () => {
  r = run(AMBIG, [], 'ambig');
  eq(r.s.metrics.intactGood, 2, 'C13 无法判定的台数不计入完好（未按最宽松默认）');
  eq(r.s.metrics.intactTotal, 4, 'C14 分母仍为在用台数');
  ok(r.j.warnings.some((w) => w.includes('无法判定') && w.includes('未按完好默认处理')), 'C15 未判定台数有 warning 并声明不默认');
});

// ============ D. 周期与区间不匹配 ============
section('C', () => {
  r = run(FULL, [], 'mismatch', '2026-08-22', '2026-09-20', 'weekly');
  eq(r.s.ok, true, 'D1 周期不匹配不中断');
  ok(r.j.warnings.some((w) => w.includes('区间与周期不匹配')), 'D2 weekly 给 30 天有 warning');
  ok(r.j.warnings.some((w) => w.includes('共 30 天')), 'D3 warning 写明实际天数');
  r = run(FULL, [], 'mismatch2', '2026-09-14', '2026-09-20', 'monthly');
  ok(r.j.warnings.some((w) => w.includes('区间与周期不匹配')), 'D4 monthly 给 7 天有 warning');
  r = run(FULL, [], 'match-m', '2026-08-01', '2026-08-31', 'monthly');
  ok(!r.j.warnings.some((w) => w.includes('区间与周期不匹配')), 'D5 monthly 给 31 天无 warning');
  eq(r.j.meta.periodCn, '月报', 'D6 月报中文名');
});

// ============ E. 环比与同比 ============
r = run(FULL, [], 'base');
const BASE = path.join(r.out, 'periodic.json');
const FULL2 = mk('full2.xlsx', {
  '设备台账': [['位号', '在用', '完好'],
    ...Array.from({ length: 20 }, (_, i) => [`EQ-${1100 + i}`, '是', i < 19 ? '完好' : '非完好'])],
  '故障记录': [['位号', '设备名称', '设备类型', '专业', '故障描述', '故障时间', '停机时长', '修复时长'],
    ['P-01', '泵1', '离心泵', '动设备', '漏', D(1), 4, 2],
    ['P-02', '泵2', '离心泵', '动设备', '响', D(2), 2, 1]],
});
section('B', () => {
  r = run(FULL2, ['--prev', BASE], 'prev');
  eq(r.s.ok, true, 'E1 带环比运行成功');
  ok(r.j.compare && r.j.compare.prev, 'E2 环比数据存在');
  eq(gi(r.j.compare.prev, 'intactRate').delta, 5, 'E3 完好率环比 95-90 = +5');
  eq(gi(r.j.compare.prev, 'faultCount').delta, -6, 'E4 故障次数环比 2-8 = -6');
  ok(/\*\*环比\*\*/.test(r.md), 'E5 md 环比小节存在');
  ok(/\+5/.test(r.md), 'E6 环比正值带 + 号');

  r = run(FULL2, ['--yoy', BASE], 'yoy');
  ok(r.j.compare && r.j.compare.yoy, 'E7 同比数据存在');
  ok(/\*\*同比\*\*/.test(r.md), 'E8 md 同比小节存在');
  r = run(FULL2, ['--prev', BASE, '--yoy', BASE], 'both');
  ok(r.j.compare.prev && r.j.compare.yoy, 'E9 环比同比可同时给出');

  // 对比一侧为 null 时 delta 为 null
  r = run(NOLEDGER, ['--prev', BASE], 'cmpnull');
  eq(gi(r.j.compare.prev, 'intactRate').delta, null, 'E10 本期指标为 null 时变化为 null 不是负数');

  // 环比 / 同比文件不存在 → 报错
  r = run(FULL, ['--prev', '/不存在/prev.json'], 'badprev');
  eq(r.s.ok, false, 'E11 环比文件不存在报错');
  eq(r.code, 1, 'E12 环比文件不存在退出码 1');
  ok(/上期 periodic.json 不存在/.test(r.s.error), 'E13 环比错误信息明确');
  r = run(FULL, ['--yoy', '/不存在/yoy.json'], 'badyoy');
  eq(r.s.ok, false, 'E14 同比文件不存在报错');
  ok(/同期 periodic.json 不存在/.test(r.s.error), 'E15 同比错误信息明确');
});
// 传入的不是 periodic.json
const NOTPER = path.join(work, 'notper.json');
fs.writeFileSync(NOTPER, JSON.stringify({ hello: 'world' }));
section('B', () => {
  r = run(FULL, ['--prev', NOTPER], 'notper');
  eq(r.s.ok, false, 'E16 --prev 文件不是 periodic.json 报错');
  // 周期不一致 → warning 不中断
  r = run(FULL, ['--prev', BASE], 'periodmix', '2026-08-01', '2026-08-31', 'monthly');
  ok(r.s.ok === true && r.j.warnings.some((w) => w.includes('周期为 weekly')), 'E17 基准周期不一致有 warning 不中断');
});

// ============ F. 混合输入 ============
section('B', () => {
  r = run([DDIR, FULL].join(','), [], 'mixed');
  eq(r.s.ok, true, 'F1 daily.json 目录与 xlsx 混合输入成功');
  eq(r.s.counts.dailyFiles, 5, 'F2 混合输入仍读到 5 份日报');
  eq(r.s.metrics.intactRate, 90, 'F3 完好率来自 xlsx 台账');
  eq(r.s.counts.missingDays, 2, 'F4 混合输入仍识别缺失天数');
  ok(r.s.sources.some((x) => x.includes('(JSON)')) && r.s.sources.some((x) => x.includes('设备台账')), 'F5 来源同时标注 JSON 与 xlsx');
});
// 单份 daily.json 逗号列表
const d1 = path.join(DDIR, `daily-${D(0)}.json`), d2 = path.join(DDIR, `daily-${D(1)}.json`);
section('B', () => {
  r = run([d1, d2, FULL].join(','), [], 'mixed2');
  eq(r.s.counts.dailyFiles, 2, 'F6 逗号分隔的多份 daily.json 可读');
});
// 区间外的 daily.json 不计入
const OUTDIR = mkDailyDir('dailyout', [0, 1, 2, 3, 4, 5, 6, 8, 9]);
section('B', () => {
  r = run(OUTDIR, [], 'outrange');
  eq(r.s.counts.dailyFiles, 7, 'F7 区间外日报不计入');
  ok(r.j.dataGaps.outOfRange.length === 2, 'F8 区间外日报被记录');
  ok(r.j.warnings.some((w) => w.includes('不在统计区间')), 'F9 区间外日报有 warning');
});
// 非 daily.json 的 JSON 被忽略且不中断
const BADJ = path.join(work, 'badjson');
fs.mkdirSync(BADJ, { recursive: true });
fs.writeFileSync(path.join(BADJ, `daily-${D(0)}.json`), JSON.stringify({ meta: { date: D(0) }, counts: { equipment: 10 } }));
fs.writeFileSync(path.join(BADJ, 'other.json'), JSON.stringify({ hello: 'world' }));
section('C', () => {
  r = run(BADJ, [], 'badjson');
  eq(r.s.ok, true, 'F10 无法识别的 JSON 不中断');
  ok(r.j.warnings.some((w) => w.includes('不是 equipment-daily-report')), 'F11 无法识别的 JSON 有 warning');
});


// ============ G. 指标口径表覆盖 ============
const RULES = mk('rules.xlsx', {
  '指标口径': [['指标', '算法'],
    ['设备完好率', '完好台数 / 在册设备台数，厂标 Q/XX-虚构-001'],
    ['检修计划完成率', '（按期完成 + 经批准顺延）项数 / 计划项数']],
});
section('A', () => {
  r = run(FULL, [], 'defrules');
  eq(r.s.usingDefaultRules, true, 'G1 未传口径表时为默认口径');
  ok(/采用默认口径，非厂内正式口径/.test(r.md), 'G2 md 声明采用默认口径非厂内正式口径');
  ok(/默认口径（references\/metrics-rules.md）/.test(r.md), 'G3 md 标注默认口径来源');
});
section('B', () => {
  r = run(FULL, ['--metrics', RULES], 'ovrules');
  eq(r.s.ok, true, 'G4 传入口径表运行成功');
  eq(r.s.usingDefaultRules, false, 'G5 口径表覆盖后非默认口径');
  ok(/rules.xlsx/.test(r.j.meta.rulesSource), 'G6 口径来源标注厂内口径表');
  ok(/Q\/XX-虚构-001/.test(r.md), 'G7 md 中指标算法被厂内口径覆盖');
  ok(!/采用默认口径，非厂内正式口径/.test(r.md), 'G8 使用厂内口径时不再声明默认口径');
  ok(!/Q\/SH-/.test(r.md), 'G7b 虚构标准号不形似真实企标前缀');
  // 口径表命中但算法与默认不一致、且无结构化参数 → 不出数、标“需按厂内口径复算”，绝不只换文字
  eq(r.s.metrics.intactRate, null, 'G13 厂内算法不一致且无结构化参数时完好率不出数');
  ok(r.s.recompute.includes('设备完好率'), 'G14 summary.recompute 列出需复算指标');
  ok(/需按厂内口径复算/.test(r.md), 'G15 md 标注需按厂内口径复算');
  ok(r.j.dataGaps.recompute.some((x) => x.metric === '设备完好率' && /不一致/.test(x.reason)), 'G16 dataGaps.recompute 写明原因');
  eq(r.j.metrics.modes['设备完好率'], '需按厂内口径复算', 'G17 计算方式标为需复算');
  eq(r.s.metrics.planRate, null, 'G18 检修计划完成率同样不出数');
  eq(r.s.metrics.orderRate, 62.5, 'G19 口径表未命中的指标仍按默认口径出数');
  // 给结构化口径参数后可算
  r = run(FULL, ['--metrics', RULES, '--intact-denominator', '在册'], 'ovrules-struct');
  eq(r.s.metrics.intactRate, 90, 'G20 --intact-denominator 在册 给出结构化口径后按在册算出 18/20');
  eq(r.j.metrics.modes['设备完好率'], '厂内口径（结构化参数）', 'G21 计算方式标为结构化参数');
  ok(!r.s.recompute.includes('设备完好率'), 'G22 结构化后不再列入需复算');
  eq(r.j.meta.intactDenominator, '在册', 'G23 meta 记录分母口径');
});
// 口径表自带 分母 / 剔除封存 列 → 结构化
const RULES2 = mk('rules2.xlsx', {
  '指标口径': [['指标', '算法', '分母', '剔除封存'],
    ['设备完好率', '完好台数 / 在册设备台数，厂标 Q/XX-虚构-001', '在册', '否']],
});
section('B', () => {
  r = run(FULL, ['--metrics', RULES2], 'ovrules-col');
  eq(r.s.metrics.intactRate, 90, 'G24 口径表分母列给出结构化口径后可算');
  eq(r.j.meta.intactSealedOut, false, 'G25 剔除封存=否 被读取');
});
// 口径表算法与默认一致 → 可算，标“与默认算法一致”
const RULES3 = mk('rules3.xlsx', {
  '指标口径': [['指标', '算法'], ['设备完好率', '完好台数 ÷ 在用设备台数（剔除长期停用、封存）']],
});
section('B', () => {
  r = run(FULL, ['--metrics', RULES3], 'ovrules-same');
  eq(r.s.metrics.intactRate, 90, 'G26 厂内算法与默认一致时照常出数');
  eq(r.j.metrics.modes['设备完好率'], '厂内口径（与默认算法一致）', 'G27 计算方式标为与默认一致');
  // 非法结构化参数
  eq(raw(['--input', FULL, ...BASEARGS, '--intact-denominator', '随便']).s.ok, false, 'G28 非法 --intact-denominator 报错');
  eq(raw(['--input', FULL, ...BASEARGS, '--sealed', '随便']).s.ok, false, 'G29 非法 --sealed 报错');
  // 口径表不存在 / 无对应 sheet
  r = run(FULL, ['--metrics', '/不存在/rules.xlsx'], 'norules');
  eq(r.s.ok, false, 'G9 口径表不存在报错');
});
const EMPTYRULES = mk('emptyrules.xlsx', { '无关表': [['a'], [1]] });
section('B', () => {
  r = run(FULL, ['--metrics', EMPTYRULES], 'badrules');
  eq(r.s.ok, true, 'G10 口径表无对应 sheet 不中断');
  eq(r.s.usingDefaultRules, true, 'G11 口径表无法解析时回落默认口径');
  ok(r.j.warnings.some((w) => w.includes('未找到「指标口径」工作表')), 'G12 口径表无法解析有 warning');
});

// ============ H. 参数校验与错误路径 ============
section('B', () => {
  eq(raw([]).s.ok, false, 'H1 无参数报错');
  eq(raw(['--input']).s.ok, false, 'H2 --input 缺值报错');
  ok(/缺少取值/.test(raw(['--input']).s.error), 'H3 缺值信息正确');
  eq(raw(['--input', FULL]).s.ok, false, 'H4 缺 --workshop 报错');
  eq(raw(['--input', FULL, '--workshop', 'X']).s.ok, false, 'H5 缺 --period 报错');
  eq(raw(['--input', FULL, '--workshop', 'X', '--period', 'weekly']).s.ok, false, 'H6 缺 --from 报错');
  eq(raw(['--input', FULL, '--workshop', 'X', '--period', 'weekly', '--from', FROM]).s.ok, false, 'H7 缺 --to 报错');
  eq(raw(['--input', FULL, '--workshop', 'X', '--period', 'daily', '--from', FROM, '--to', TO]).s.ok, false, 'H8 非法 --period 报错');
  eq(raw(['--input', FULL, '--workshop', 'X', '--period', 'weekly', '--from', '2026-13-45', '--to', TO]).s.ok, false, 'H9 非法 --from 报错');
  eq(raw(['--input', FULL, '--workshop', 'X', '--period', 'weekly', '--from', FROM, '--to', '不是日期']).s.ok, false, 'H10 非法 --to 报错');
  ok(/晚于/.test(raw(['--input', FULL, '--workshop', 'X', '--period', 'weekly', '--from', TO, '--to', FROM]).s.error), 'H11 from 晚于 to 报错');
  eq(raw(['--input', '/不存在.xlsx', ...BASEARGS]).s.ok, false, 'H12 输入不存在报错');
  eq(raw(['--input', FULL, ...BASEARGS, '--未知', 'v']).s.ok, false, 'H13 未知参数报错');
  eq(raw(['--input', FULL, ...BASEARGS]).code, 0, 'H14 正常路径退出码 0');
  eq(raw(['--input', '/不存在.xlsx', ...BASEARGS]).code, 1, 'H15 失败退出码 1');
});
// 空目录
const EMPTYDIR = path.join(work, 'emptydir');
fs.mkdirSync(EMPTYDIR, { recursive: true });
section('C', () => {
  r = raw(['--input', EMPTYDIR, ...BASEARGS]);
  eq(r.s.ok, false, 'H16 空目录报错');
  eq(r.code, 1, 'H17 空目录退出码 1');
  ok(/没有 .json \/ .xlsx \/ .csv 文件/.test(r.s.error), 'H18 空目录错误信息明确');
});
// 无可用数据的 xlsx
const NODATA = mk('nodata.xlsx', { '无关表': [['a'], [1]] });
section('B', () => {
  r = raw(['--input', NODATA, ...BASEARGS]);
  eq(r.s.ok, false, 'H19 无任何可用数据报错');
  ok(/未在输入中识别到任何可用数据/.test(r.s.error), 'H20 无可用数据错误信息明确');
  // 备件表不存在
  eq(raw(['--input', FULL, ...BASEARGS, '--spare', '/不存在.xlsx']).s.ok, false, 'H21 --spare 文件不存在报错');
});

// ============ I. 未判定项不按默认处理 ============
const UND = mk('und.xlsx', {
  '检修计划': [['项目名称', '位号', '状态', '计划完成', '实际完成', '责任人'],
    ['按期项', 'P-01', '已完成', D(1), D(1), '一队'],
    ['缺实际完成', 'P-02', '已完成', D(2), '', '一队'],
    ['缺计划完成', 'P-03', '已完成', '', D(3), '一队']],
  '工单台账': [['工单号', '位号', '状态', '要求完成时间', '闭环时间', '责任人'],
    ['WO-01', 'P-01', '已闭环', D(1), D(1), '一队'],
    ['WO-02', 'P-02', '已闭环', D(2), '', '一队']],
});
section('A', () => {
  r = run(UND, [], 'und');
  eq(r.j.maintenance.total, 2, 'I1 缺「计划完成」的项目不计入分母');
  eq(r.j.maintenance.onTime, 1, 'I2 缺「实际完成」的已完成项不计按期（未按按期默认）');
  eq(r.j.maintenance.rate, 50, 'I3 检修完成率 1/2');
  eq(r.j.maintenance.undetermined.length, 2, 'I4 未判定项单列（缺实际完成 + 缺计划完成）');
  ok(r.j.maintenance.undetermined.some((x) => x.reason === '缺「实际完成」日期'), 'I4b 未判定项写明缺哪个字段');
  ok(r.j.maintenance.undetermined.some((x) => x.reason === '缺「计划完成」日期'), 'I4c 缺计划完成也单列');
  ok(/未判定项（缺字段/.test(r.md), 'I5 md 单列未判定节');
  ok(/\| 未判定 \|/.test(r.md), 'I6 md 中未判定项标注为「未判定」');
  ok(r.j.warnings.some((w) => w.includes('未填「计划完成」日期')), 'I7 缺计划完成日期有 warning');
  ok(r.j.warnings.some((w) => w.includes('无法判断是否按期')), 'I8 无法判断按期有 warning');
  eq(r.j.orders.onTime, 1, 'I9 标记闭环但缺闭环时间不计按期（未按按期默认）');
  ok(r.j.warnings.some((w) => w.includes('标记已闭环但缺「闭环时间」')), 'I10 工单缺闭环时间有 warning');
});

// ============ J. 数值无法解析 → null 不是 0 ============
const BADNUM = mk('badnum.xlsx', {
  '故障记录': [['位号', '设备名称', '专业', '故障描述', '故障时间', '停机时长', '修复时长'],
    ['P-01', '泵1', '动设备', '漏', D(1), '说不清', '不详'],
    ['P-02', '泵2', '动设备', '响', D(2), '', '']],
  '备件消耗': [['备件名称', '位号', '数量', '单位', '金额', '时间'],
    ['垫片', 'P-01', '若干', '件', '未结算', D(1)]],
});
section('A', () => {
  r = run(BADNUM, [], 'badnum');
  eq(r.j.metrics.downtime, null, 'J1 停机时长全不可解析时为 null 不是 0');
  eq(r.j.metrics.mttr, null, 'J2 修复时长全不可解析时 MTTR 为 null');
  eq(r.j.metrics.repairCount, null, 'J3 修复次数为 null 不是 0');
  eq(r.j.spare.totalAmount, null, 'J4 备件金额不可解析时为 null 不是 0');
  ok(r.j.warnings.some((w) => w.includes('无法解析为数字')), 'J5 无法解析有 warning');
  ok(r.j.warnings.some((w) => w.includes('未按 0 计')), 'J6 声明未按 0 计');
  ok(/故障停机时长合计 \| — \|/.test(r.md), 'J7 md 中停机时长显示 —');
});
// 故障时间缺失不计入区间
const NOTIME = mk('notime.xlsx', {
  '故障记录': [['位号', '专业', '故障描述', '故障时间', '停机时长', '修复时长'],
    ['P-01', '动设备', '漏', D(1), 2, 1],
    ['P-02', '动设备', '响', '', 3, 2]],
});
section('A', () => {
  r = run(NOTIME, [], 'notime');
  eq(r.j.counts.faults, 1, 'J8 缺故障时间的记录不计入区间统计');
  ok(r.j.warnings.some((w) => w.includes('未填「故障时间」')), 'J9 缺故障时间有 warning');
});

// ============ K. 合计行与别名列头 ============
const ALIAS = mk('alias.xlsx', {
  '设备台账表': [['某厂设备台账导出'], [],
    ['设备位号', '名称', '类别', '所属专业', '是否在用', '是否完好'],
    ['EQ-01', '设备1', '离心泵', '动设备', '是', '完好'],
    ['EQ-02', '设备2', '离心泵', '动设备', '是', '非完好'],
    ['合计', '', '', '', '', '']],
});
section('B', () => {
  r = run(ALIAS, [], 'alias');
  eq(r.s.ok, true, 'K1 别名列头与标题行可读');
  eq(r.s.metrics.intactTotal, 2, 'K2 合计行被跳过');
  eq(r.s.metrics.intactRate, 50, 'K3 完好率 1/2');
  ok(r.j.warnings.some((w) => w.includes('合计行')), 'K4 合计行 warning');
});

// ============ L. 产出完整性 ============
section('BVT', () => {
  r = run([DDIR, FULL].join(','), ['--prev', BASE], 'outputs');
  ok(fs.existsSync(path.join(r.out, 'periodic.json')), 'L1 periodic.json 生成');
  ok(fs.existsSync(path.join(r.out, 'periodic.md')), 'L2 periodic.md 生成');
  ok(fs.existsSync(path.join(r.out, 'summary.json')), 'L3 summary.json 生成');
  ok(fs.existsSync(path.join(r.out, '指标表.xlsx')), 'L4 指标表.xlsx 生成');
  ok(/## 一、总体概况/.test(r.md), 'L5 一节');
  ok(/## 二、关键指标/.test(r.md), 'L6 二节');
  ok(/## 三、特护设备运行状况/.test(r.md), 'L7 三节（特护设备）');
  ok(/## 四、故障统计/.test(r.md), 'L8 四节');
  ok(/## 五、检修计划执行/.test(r.md), 'L9 五节');
  ok(/## 六、工单与缺陷/.test(r.md), 'L10 六节');
  ok(/## 七、备件消耗/.test(r.md), 'L11 七节');
  ok(/## 八、重点事项/.test(r.md), 'L12 八节');
  ok(/## 九、环比与同比/.test(r.md), 'L13 九节');
  ok(/## 十、数据缺口/.test(r.md), 'L14 十节');
  ok(/## 十一、设备管理分析/.test(r.md), 'L15 十一节');
  ok(/## 十二、下期重点/.test(r.md), 'L15b 十二节');
  eq(r.s.sections, 12, 'L15c summary.sections 为 12，与 SKILL.md 预期结果一致');
});
section('C', () => {
  ok(!/⚠|✅|❌/.test(r.md), 'L15d 产出 md 不含 emoji');
  ok(/本材料由脚本汇总、模型成文，仅供设备员复核参考，不替代审批、定性、验收与签字；厂内制度与系统数据为准。/.test(r.md), 'L15e 末尾通用声明行');
  ok(/公司设备管理部门/.test(r.md) && !/以设备部发布/.test(r.md), 'L15f 口径声明用“公司设备管理部门”而非旧称');
  ok(/泄漏率考核线以厂内指标为准/.test(r.md), 'L15g 泄漏率考核线声明以厂内为准');
});
section('BVT', () => {
  ok(/<!-- ANALYSIS_START -->/.test(r.md) && /<!-- ANALYSIS_END -->/.test(r.md), 'L16 分析段占位符');
});
section('C', () => {
  ok(/400~600 字/.test(r.md), 'L17 分析段写明字数要求');
  ok(/原因待分析/.test(r.md), 'L18 分析段提示原因待分析');
});
section('A', () => {
  ok(/下期重点由车间填写，本技能不代为拟定/.test(r.md), 'L19 下期重点不代拟');
});
section('B', () => {
  const xl = require('./lib/xlsx-lite').readXlsx(path.join(r.out, '指标表.xlsx'));
  ok(Object.keys(xl).includes('指标表'), 'L20 指标表.xlsx 含「指标表」sheet');
  ok(Object.keys(xl).includes('故障统计'), 'L21 指标表.xlsx 含「故障统计」sheet');
  ok(Object.keys(xl).includes('数据缺口'), 'L22 指标表.xlsx 含「数据缺口」sheet');
  ok(JSON.stringify(xl['指标表']).includes('设备完好率'), 'L23 指标表含设备完好率行');
  ok(JSON.stringify(xl['数据缺口']).includes(D(2)), 'L24 数据缺口 sheet 列出缺失日期');
});
section('BVT', () => {
  const sum = JSON.parse(fs.readFileSync(path.join(r.out, 'summary.json'), 'utf8'));
  eq(sum.ok, true, 'L25 summary.json 内容与末行一致');
});
section('A', () => {
  ok(r.j.highlights.length > 0, 'L26 重点事项从已有记录提取');
  ok(r.j.highlights.some((h) => h.type === '故障频发设备'), 'L27 故障频发设备列为重点事项');
  ok(r.j.highlights.some((h) => h.type === '超期工单'), 'L28 超期工单列为重点事项');
});

// ============ M. topn ============
section('B', () => {
  r = run(FULL, ['--topn', '2'], 'topn');
  eq(r.j.failures.top.length, 2, 'M1 --topn 控制排行条数');
  ok(/Top 2/.test(r.md), 'M2 md 中标题反映 topN');
});

// ============ N. 中石化指标集：在用口径、主要设备完好率、泄漏率、备机、停工、分级完成率、停机次数 ============
// N1 台账缺「在用」列 → 完好率 null，不得按在册算
const NOINUSE = mk('noinuse.xlsx', {
  '设备台账': [['位号', '设备名称', '完好'], ['EQ-01', '设备1', '完好'], ['EQ-02', '设备2', '完好'], ['EQ-03', '设备3', '非完好']],
});
section('A', () => {
  r = run(NOINUSE, [], 'noinuse');
  eq(r.s.metrics.intactRate, null, 'N1 台账缺「在用」列时完好率为 null（不按在册算）');
  ok(r.j.warnings.some((w) => w.includes('缺「在用」列') && w.includes('不得按在册台数')), 'N2 缺在用列 warning 声明不得按在册算');
  ok(r.j.dataGaps.noDenominator.some((x) => x.metric === '设备完好率' && /在用/.test(x.reason)), 'N3 分母缺失原因写明缺在用列');
});
section('B', () => {
  r = run(NOINUSE, ['--intact-denominator', '在册'], 'noinuse-reg');
  eq(r.s.metrics.intactRate, 66.7, 'N4 显式 --intact-denominator 在册 时才按在册 2/3 计算');
  ok(/在册/.test(r.j.metrics.intactNote) || r.j.meta.intactDenominator === '在册', 'N5 在册口径在 meta 中可追溯');
});
// N6 「在用」列取值：停用/封存/长期停用 剔除；空值不计分母也不按在用默认
const INUSE = mk('inuse.xlsx', {
  '设备台账': [['功能位置', '设备描述', '使用状态', '完好', 'ABC标识'],
    ['EQ-01', '设备1', '是', '完好', 'A'], ['EQ-02', '设备2', '在用', '完好', 'B'], ['EQ-03', '设备3', '封存', '完好', 'C'],
    ['EQ-04', '设备4', '长期停用', '非完好', 'A'], ['EQ-05', '设备5', '', '完好', 'B'], ['EQ-06', '设备6', '运行', '非完好', 'C'], ['EQ-07', '设备7', '备用', '完好', '']],
});
section('A', () => {
  r = run(INUSE, [], 'inuse');
  eq(r.s.metrics.intactTotal, 4, 'N6 封存/长期停用剔除、在用列为空不计分母（SAP 列名 功能位置/设备描述/使用状态 可读）');
  eq(r.s.metrics.intactGood, 3, 'N7 完好台数只数在用台');
  eq(r.s.metrics.intactRate, 75, 'N8 完好率 3/4');
  ok(r.j.warnings.some((w) => w.includes('「在用」列为空') && w.includes('未按在用默认')), 'N9 在用为空 warning 声明不按在用默认');
  // 主要设备完好率（A/B 类）：EQ-01 A 完好、EQ-02 B 完好、EQ-06 C、EQ-07 重要度空 → A/B 2 台 全完好
  eq(r.s.metrics.majorTotal, 2, 'N10 主要设备分母限 A/B 类在用台数（ABC标识 列）');
  eq(r.s.metrics.majorRate, 100, 'N11 主要设备完好率 2/2');
  ok(r.j.warnings.some((w) => w.includes('「重要度」为空或无法归入')), 'N12 重要度为空 warning');
  r = run(FULL, [], 'nomajor');
  eq(r.s.metrics.majorRate, null, 'N13 台账无重要度列时主要设备完好率为 null');
  ok(r.j.dataGaps.noDenominator.some((x) => x.metric === '主要设备完好率'), 'N14 主要设备完好率分母缺失单列');
  ok(/主要设备完好率（A\/B 类） \| — \|/.test(r.md), 'N15 md 中主要设备完好率显示 —');
});

// N16 密封点泄漏率（‰）
const SEAL = mk('seal.xlsx', {
  '密封点统计': [['密封点类型', '密封点总数', '泄漏点数'], ['静密封点', 12000, 5], ['动密封点', 600, 1], ['其他', 10, 0]],
});
const SEALBAD = mk('sealbad.xlsx', { '密封点统计': [['密封点类型', '密封点总数', '泄漏点数'], ['静密封点', '', 5], ['动密封点', '若干', 1]] });
section('A', () => {
  r = run(SEAL, [], 'seal');
  eq(r.s.metrics.staticLeakRate, 0.42, 'N16 静密封点泄漏率 5/12000 = 0.42‰');
  eq(r.s.metrics.dynamicLeakRate, 1.67, 'N17 动密封点泄漏率 1/600 = 1.67‰');
  ok(r.j.warnings.some((w) => w.includes('不是静/动密封')), 'N18 非静/动类型行 warning 忽略');
  ok(/静密封点泄漏率 \| 0\.42‰/.test(r.md), 'N19 md 泄漏率以 ‰ 显示');
  ok(!/≤0\.5‰|≤2‰/.test(r.md), 'N20 md 不比对考核线数值（以厂内指标为准）');
  r = run(SEALBAD, [], 'sealbad');
  eq(r.s.metrics.staticLeakRate, null, 'N21 密封点总数缺失时泄漏率为 null 不是 0');
  ok(r.j.dataGaps.noDenominator.some((x) => x.metric === '静密封点泄漏率'), 'N22 泄漏率分母缺失单列');
});
// leaks.json 带 sealPoints
const LEAKS = path.join(work, 'leaks.json');
fs.writeFileSync(LEAKS, JSON.stringify({ meta: { skill: 'leak-point-tracker' }, counts: { leaks: 3, open: 2, overdue: 1, repaired: 1 }, repaired: [], metrics: { repairRate: 33.3 }, sealPoints: { static: { total: 10000, leaks: 4 }, dynamic: { total: 500, leaks: 1 } } }));
const LEAKS2 = path.join(work, 'leaks2.json');
fs.writeFileSync(LEAKS2, JSON.stringify({ counts: { leaks: 3, open: 2, overdue: 1, repaired: 1 }, repaired: [], metrics: { repairRate: 33.3 } }));
section('B', () => {
  r = run([LEAKS, FULL].join(','), [], 'leaksjson');
  eq(r.s.metrics.staticLeakRate, 0.4, 'N23 leaks.json 的 sealPoints 可算泄漏率');
  eq(r.s.counts.leakOpen, 2, 'N24 泄漏点未修复数来自 leaks.json');
  ok(/泄漏点（来自 leaks.json）/.test(r.md), 'N25 md 列出泄漏点概况');
  r = run(LEAKS2, [], 'leaksjson2');
  eq(r.s.ok, true, 'N26 仅 leaks.json 也可运行');
  eq(r.s.metrics.staticLeakRate, null, 'N27 leaks.json 无 sealPoints 时泄漏率 null');
  ok(r.j.dataGaps.notProvided.some((x) => x.metric === '静/动密封点泄漏率' && /sealPoints/.test(x.reason)), 'N28 未提供密封点总数时单列说明');
});

// N29 备机完好率
const STANDBY = mk('standby.xlsx', {
  '备机': [['位号', '设备名称', '状态', '是否可投用'], ['P-01B', '泵1B', '备用', '是'], ['P-02B', '泵2B', '备用', '是'], ['P-03B', '泵3B', '检修', '是'], ['P-04B', '泵4B', '备用', '否']],
});
const STANDBY2 = mk('standby2.xlsx', { '备机': [['位号', '状态'], ['P-01B', '备用'], ['P-02B', '检修']] });
section('A', () => {
  r = run(STANDBY, [], 'standby');
  eq(r.s.metrics.standbyTotal, 4, 'N29 备机总数');
  eq(r.s.metrics.standbyGood, 2, 'N30 检修中备机不进分子');
  eq(r.s.metrics.standbyRate, 50, 'N31 备机完好率 2/4');
  r = run(STANDBY2, [], 'standby2');
  eq(r.s.metrics.standbyRate, null, 'N32 缺「是否可投用」列且有无法判定的备机时不出数');
  ok(r.j.warnings.some((w) => w.includes('缺「是否可投用」列')), 'N33 缺列 warning');
  r = run(FULL, [], 'nostandby');
  ok(r.j.dataGaps.notProvided.some((x) => x.metric === '备机完好率'), 'N34 未提供备机表时单列未提供');
});

// N35 非计划停工次数
const SHUT = mk('shut.xlsx', {
  '停工记录': [['停工时间', '装置', '停工类别', '原因'], [D(1), '常减压', '非计划', '原料泵故障'], [D(3), '常减压', '计划', '消缺停工'], [D(5), '常减压', '非计划停工', '压缩机联锁'], [C.addDays(TO, 3), '常减压', '非计划', '区间外']],
});
const SHUT2 = mk('shut2.xlsx', { '停工记录': [['停工时间', '原因'], [D(1), '泵故障']] });
section('A', () => {
  r = run(SHUT, [], 'shut');
  eq(r.s.metrics.unplannedShutdowns, 2, 'N35 非计划停工次数 2（区间外不计）');
  ok(/非计划停工管理规定/.test(r.md), 'N36 md 引用《炼化企业非计划停工管理规定》且不判定');
  ok(r.j.highlights.some((h) => h.type === '非计划停工'), 'N37 非计划停工进重点事项');
  r = run(SHUT2, [], 'shut2');
  eq(r.s.metrics.unplannedShutdowns, null, 'N38 缺停工类别列时不出数');
  r = run(FULL, [], 'noshut');
  ok(r.j.dataGaps.notProvided.some((x) => x.metric === '非计划停工次数'), 'N39 未提供停工记录时单列');
});

// N40 检修计划完成率按分级分列（旧口径 大修/中修/小修 映射）
const PLANCAT = mk('plancat.xlsx', {
  '检修计划': [['项目名称', '位号', '检修类别', '状态', '计划完成', '实际完成', '责任人'],
    ['A', 'P-01', '大修', '已完成', D(1), D(1), '一队'],
    ['B', 'P-02', '装置大检修', '施工中', D(2), '', '一队'],
    ['C', 'P-03', '小修', '已完成', D(3), D(3), '二队'],
    ['D', 'P-04', '中修', '已完成', D(4), D(6), '二队'],
    ['E', 'P-05', '抢修', '已完成', D(5), D(5), '二队'],
    ['F', 'P-06', '技改', '未开工', D(6), '', '二队'],
    ['G', 'P-07', '不知道', '未开工', D(6), '', '二队']],
});
section('A', () => {
  r = run(PLANCAT, [], 'plancat');
  eq(r.s.metrics.planRate, 42.9, 'N40 合计完成率 3/7');
  eq(r.s.metrics.planRateOverhaul, 50, 'N41 大检修完成率 1/2（大修→大检修）');
  eq(r.s.metrics.planRateRoutine, 50, 'N42 日常维修完成率 1/2（中修/小修→日常维修）');
  ok(r.j.maintenance.byCategory['抢修'] && r.j.maintenance.byCategory['专项'], 'N43 抢修/专项分列');
  ok(r.j.maintenance.byCategory['未归类'] && r.j.warnings.some((w) => w.includes('无法归入 大检修/日常维修/抢修/专项')), 'N44 无法归类的类别单列并 warning');
  ok(/其中 大检修/.test(r.md) && /其中 日常维修/.test(r.md), 'N45 md 关键指标分列大检修/日常维修');
  r = run(FULL, [], 'plannocat');
  eq(r.s.metrics.planRateOverhaul, null, 'N46 无检修类别列时分列为 null');
  ok(r.j.warnings.some((w) => w.includes('缺「检修类别」列')), 'N47 缺检修类别列 warning');
});

// N48 故障停机次数
const DOWN = mk('down.xlsx', {
  '故障记录': [['位号', '专业', '故障描述', '故障时间', '停机时长', '是否停机'],
    ['P-01', '动设备', 'a', D(1), 4, ''], ['P-02', '动设备', 'b', D(2), 0, ''], ['P-03', '动设备', 'c', D(3), '', '是'], ['P-04', '动设备', 'd', D(4), '', '']],
});
section('A', () => {
  r = run(DOWN, [], 'down');
  eq(r.s.counts.faults, 4, 'N48 故障 4 次');
  eq(r.s.metrics.downtimeCount, 2, 'N49 故障停机次数 2（停机时长>0 或 是否停机=是）');
  ok(r.j.warnings.some((w) => w.includes('无法判断是否停机')), 'N50 既无是否停机也无停机时长的记录 warning 不计');
  ok(/故障停机次数/.test(r.md), 'N51 md 含故障停机次数');
});

// N52 SAP PM 列名：订单/系统状态/功能位置/基本结束日期；TECO 归待验收不算闭环；DLFL 不计
const SAP = mk('sap.xlsx', {
  '订单清单': [['订单', '功能位置', '描述', '系统状态', '基本结束日期', '实际结束日期', '主工作中心'],
    ['4000001', 'P-1101B', '更换机封', 'CLSD', D(1), D(1), '机泵班'],
    ['4000002', 'P-1102A', '对中', 'TECO', D(2), D(2), '机泵班'],
    ['4000003', 'E-1201', '紧固', 'REL', D(3), '', '静设备班'],
    ['4000004', 'C-1401', '作废单', 'DLFL', D(4), '', '静设备班']],
  '通知单清单': [['通知单', '功能位置', '通知单描述', '通知单状态', '通知日期', '业务完成日期'],
    ['10001', 'P-1101B', '机封漏', 'NOCO', D(0), D(1)], ['10002', 'E-1201', '法兰渗', 'OSNO', D(3), ''], ['10003', 'C-1401', '已完成待验', '已完成', D(4), '']],
});
section('A', () => {
  r = run(SAP, [], 'sap');
  eq(r.s.counts.ordersDue, 3, 'N52 已删除标记（DLFL）工单不计入分母');
  eq(r.s.counts.ordersOnTime, 1, 'N53 TECO（技术完成）不算闭环，仅 CLSD 计按期');
  eq(r.s.counts.ordersPendingAccept, 1, 'N54 待验收单列计数');
  ok(r.j.orders.overdueList.some((x) => x.no === '4000002' && x.status === '待验收'), 'N55 TECO 工单在未按期闭环清单中标为待验收');
  eq(r.s.counts.newDefects, 3, 'N56 通知单清单作为缺陷台账：3 条新增');
  eq(r.j.defects.pendingAcceptAtEnd, 1, 'N57 「已完成」通知单归待验收');
  eq(r.j.defects.openAtEnd, 2, 'N58 待验收不计闭环，期末未闭环 2');
  ok(/待验收（完工未验收，不计闭环）/.test(r.md), 'N59 md 说明待验收不计闭环');
});

// N60 特护设备：特护设备表 / 日报 special 节
const SPEC = mk('spec.xlsx', { '特护设备': [['位号', '设备名称', '状态', '运行参数'], ['K-1601', '富气压缩机', '运行', '振动 4.1mm/s']] });
section('A', () => {
  r = run(SPEC, [], 'spec');
  eq(r.s.counts.specialEquipment, 1, 'N60 特护设备表读入');
  ok(/K-1601/.test(r.md) && /## 三、特护设备运行状况/.test(r.md), 'N61 md 特护一节逐台列出');
});
const DSPEC = mkDailyDir('dailyspec', [0, 1, 2], (o, i) => { o.special = { total: 1, abnormal: i === 1 ? 1 : 0, list: [{ tag: 'K-1601', name: '富气压缩机', state: i === 1 ? '异常' : '运行', params: '振动 5.2mm/s', desc: i === 1 ? '振动升高' : '' }] }; });
section('B', () => {
  r = run(DSPEC, [], 'dailyspec');
  eq(r.s.counts.specialEquipment, 1, 'N62 日报 special 节汇总为特护设备');
  ok(r.j.special.list[0].abnormalDays === 1 && r.j.special.list[0].days === 3, 'N63 区间内异常天数 1/3');
  ok(r.j.highlights.some((h) => h.type === '特护设备异常'), 'N64 特护异常进重点事项');
});
section('A', () => {
  r = run(FULL, [], 'nospec');
  ok(r.j.dataGaps.notProvided.some((x) => x.metric === '特护设备运行状况'), 'N65 未提供特护数据时单列未提供');
});

// N66 指标表.xlsx 含中石化指标行
section('B', () => {
  r = run([SEAL, STANDBY, SHUT, FULL].join(','), [], 'allmetrics');
  const xl2 = require('./lib/xlsx-lite').readXlsx(path.join(r.out, '指标表.xlsx'));
  const flat = JSON.stringify(xl2['指标表']);
  ok(['主要设备完好率', '备机完好率', '静密封点泄漏率', '动密封点泄漏率', '检修计划完成率（大检修）', '故障停机次数', '非计划停工次数'].every((k) => flat.includes(k)), 'N66 指标表含中石化指标集各行');
  ok(/口径来源/.test(flat) && /计算方式/.test(flat), 'N67 指标表含口径来源与计算方式列');
  // 环比字段含新增指标
  r = run([SEAL, STANDBY, SHUT, FULL].join(','), ['--prev', BASE], 'cmpnew');
  ok(['majorRate', 'standbyRate', 'staticLeakRate', 'downtimeCount', 'unplannedShutdowns', 'planRateOverhaul'].every((k) => gi(r.j.compare.prev, k)), 'N68 环比覆盖新增指标');
  eq(gi(r.j.compare.prev, 'staticLeakRate').delta, null, 'N69 基准期无该指标时变化为 null');
});

// ---- R. rotation.json（standby-rotation-reminder）作为备机完好率来源
{
  const rot = path.join(work, 'rotation.json');
  fs.writeFileSync(rot, JSON.stringify({ meta: { skill: 'standby-rotation-reminder' }, standbyAvailability: { pairs: 10, available: 8, inRepair: 1, stopped: 1, statusMissing: 0, statusUnknown: 0, rate: 80 } }), 'utf8');
  const rot2 = path.join(work, 'rotation2.json');
  fs.writeFileSync(rot2, JSON.stringify({ standbyAvailability: { pairs: 10, available: 7, statusMissing: 2, statusUnknown: 1, rate: null } }), 'utf8');
  section('B', () => {
    const r = run(rot, [], 'rot');
    eq(r.s.ok, true, 'R1 rotation.json 可作为唯一输入运行');
    eq(r.j.metrics.standbyRate, 80, 'R2 备机完好率取自 rotation.json（8/10）');
    ok(/备机切换\(JSON\)/.test((r.j.meta.sources || []).join(',')), 'R3 来源标注为备机切换(JSON)');
    const r2 = run(rot2, [], 'rot2');
    eq(r2.j.metrics.standbyRate, null, 'R4 rotation.json 的 rate 为 null（备机状态有未判定）时不出数');
    ok((r2.j.dataGaps?.noDenominator || []).some((x) => x.metric === '备机完好率'), 'R5 列入分母缺失');
  });
}

// ---- S. 只给工单台账、缺陷台账（MCP 导出常见情形）时，不把「工单台账」「缺陷台账」误当设备台账
{
  const SO = mk('orders-only.xlsx', {
    '工单台账': [['工单号', '位号', '状态', '要求完成时间', '闭环时间'], ['W-1', 'P-1', 'CLSD', D(2), D(1)], ['W-2', 'P-2', 'REL', D(3), '']],
    '缺陷台账': [['位号', '缺陷描述', '状态', '发现时间'], ['P-1', '渗漏', 'NOCO', D(0)]],
  });
  const SL = mk('special-ledger.xlsx', { '特种设备台账': [['位号', '设备名称', '在用', '完好'], ['V-1', '容器', '在用', '完好']] });
  section('B', () => {
    const r = run(SO, [], 'orders-only');
    ok(!(r.s.sources || []).some((x) => /设备台账/.test(x)), 'S1 无设备台账时，工单台账/缺陷台账不被识别为设备台账');
    ok(/未提供设备台账/.test((r.j && r.j.metrics.intactNote) || ''), 'S2 完好率说明为「未提供设备台账」而非「台账缺在用列」');
    eq(r.j && r.j.metrics.orderDue, 2, 'S3 工单台账照常计入工单及时率');
    const r2 = run(SL, [], 'special-ledger');
    ok(!(r2.s.sources || []).some((x) => /设备台账/.test(x)), 'S4 特种设备台账不当作全车间设备台账');
  });
}

// ---- T. 表名含「设备台账」「技术对象」先放行（「二作业部设备台账」不因含「作业」被排除）；润滑台账、巡检台账不是设备台账
{
  const T1 = mk('dept-ledger.xlsx', { '二作业部设备台账': [['位号', '设备名称', '在用', '完好'], ['P-1', '泵', '在用', '完好'], ['P-2', '泵', '在用', '待修']] });
  const T2 = mk('dept-tech.xlsx', { '检修作业部技术对象': [['位号', '设备名称', '在用', '完好'], ['P-1', '泵', '在用', '完好']] });
  const T3 = mk('lube-ledger.xlsx', {
    '润滑台账': [['位号', '设备名称', '润滑点', '油品'], ['P-1', '泵', '轴承箱', 'L-TSA46']],
    '巡检台账': [['位号', '设备名称', '在用', '完好'], ['P-1', '泵', '在用', '完好']],
    '工单台账': [['工单号', '位号', '状态', '要求完成时间', '闭环时间'], ['W-1', 'P-1', 'CLSD', D(2), D(1)]],
  });
  const T4 = mk('special-dept.xlsx', { '二作业部特种设备台账': [['位号', '设备名称', '在用', '完好'], ['V-1', '容器', '在用', '完好']] });
  section('B', () => {
    const r = run(T1, [], 'dept-ledger');
    eq(r.s.ok, true, 'T1 只给「二作业部设备台账」时脚本正常运行');
    ok((r.s.sources || []).some((x) => /设备台账/.test(x)), 'T2 「二作业部设备台账」识别为设备台账');
    eq(r.s.metrics && r.s.metrics.intactRate, 50, 'T3 完好率按该台账计算（1/2）');
    const r2 = run(T2, [], 'dept-tech');
    ok((r2.s.sources || []).some((x) => /设备台账/.test(x)), 'T4 表名含「技术对象」时放行');
    const r3 = run(T3, [], 'lube-ledger');
    ok(!(r3.s.sources || []).some((x) => /设备台账/.test(x)), 'T5 润滑台账、巡检台账不当作设备台账');
    const r4 = run(T4, [], 'special-dept');
    ok(!(r4.s.sources || []).some((x) => /设备台账/.test(x)), 'T6 「二作业部特种设备台账」仍不当作全车间设备台账');
  });
}

// ---- T7. 「压力容器设备台账」「安全阀设备台账」等专项台账不当作全车间设备台账（R6）
{
  section('B', () => {
    for (const [i, nm] of ['压力容器设备台账', '安全阀设备台账', '停工检修设备台账', '密封设备台账', '二作业部压力容器设备台账'].entries()) {
      const T = mk(`special-ledger-${i}.xlsx`, { [nm]: [['位号', '设备名称', '在用', '完好'], ['V-1', '容器', '在用', '完好'], ['V-2', '容器', '在用', '待修']] });
      const r = run(T, [], `special-ledger-${i}`);
      ok(!(r.s.sources || []).some((x) => /设备台账/.test(x)) && !(r.s.metrics && r.s.metrics.intactRate !== null), `T7.${i + 1} 「${nm}」是专项台账，不当作全车间设备台账、不出完好率`);
    }
  });
}

// ---- U. 缺陷台账期末数按 --to 回推（v4-1）：发现日期晚于 --to 的不计；--to 之后才闭环的仍算期末未闭环
{
  const U1 = mk('defect-asof.xlsx', {
    '缺陷台账': [['位号', '缺陷描述', '等级', '状态', '发现时间', '闭环时间'],
      ['P-01', '期内发现未闭环', 'II 级', '未处理', D(0), ''],
      ['P-02', '期末后发现A', 'II 级', '未处理', C.addDays(TO, 5), ''],
      ['P-03', '期末后发现B', 'II 级', '处理中', C.addDays(TO, 6), ''],
      ['P-04', '期末后才闭环', 'II 级', '已闭环', D(1), C.addDays(TO, 3)],
      ['P-05', '期内闭环', 'II 级', '已闭环', D(2), D(3)],
      ['P-06', '闭环缺日期', 'II 级', '已闭环', D(2), ''],
      ['P-07', '缺发现日期', 'II 级', '未处理', '', ''],
      ['P-08', '期末后发现待验收', 'II 级', '已完成', C.addDays(TO, 2), '']],
  });
  section('A', () => {
    const r = run(U1, [], 'defect-asof');
    eq(r.j.defects.openAtEnd, 3, 'U1 期末未闭环按 --to 回推：期内未闭环 + 期末后才闭环 + 缺发现日期 = 3（期末后发现的不计）');
    eq(r.j.defects.pendingAcceptAtEnd, 0, 'U2 期末后发现的待验收缺陷不计入期末待验收');
    eq(r.j.defects.foundAfterTo, 3, 'U3 发现日期晚于 --to 的 3 条单独计数');
    ok(r.j.defects.asOfNote && /当前/.test(r.j.defects.asOfNote), 'U4 --to 早于今天时注明待验收为当前状态快照');
    ok(r.j.warnings.some((w) => /缺「?闭环时间/.test(w) || /闭环日期/.test(w)), 'U5 已闭环但缺闭环日期的给 warning');
    ok(r.j.warnings.some((w) => /发现(时间|日期)/.test(w) && /P-07|1 条/.test(w)), 'U6 缺发现日期的给 warning');
    ok(/当前/.test(r.md.split('**缺陷（维修通知单）**')[1].split('\n')[0]), 'U7 md 缺陷行注明当前快照');
    // 完好率是台账当前状态：--to 早于今天时注明
    ok(r.j.metrics.intactSnapshotNote === undefined || r.j.metrics.intactSnapshotNote === null, 'U8 未提供设备台账时不写完好率快照说明');
    const r2 = run(FULL, [], 'intact-snap');
    ok(/当前/.test(r2.j.metrics.intactSnapshotNote || ''), 'U9 --to 早于今天且完好率来自台账时，注明是台账当前快照');
    ok(/台账当前状态/.test(r2.md), 'U10 md 注明完好率为台账当前状态');
    const r3 = run(FULL, ['--prev', path.join(r2.out, 'periodic.json')], 'cmp-snap');
    ok(/快照/.test(r3.j.compare.prev.snapshotNote || ''), 'U11 环比基准期的完好率注明为基准报告生成时的快照');
    ok(/快照/.test(r3.md.split('## ')[r3.md.split('## ').findIndex((x) => x.includes('环比与同比'))] || ''), 'U12 md 环比节注明基准期完好率为快照');
  });
}

// ---- V. 超期工单责任方写工作中心（单位），不写责任人姓名；highlights 带 no / tag / unit 结构字段（v4-4）
{
  const V1 = mk('wc.xlsx', { '工单台账': [['工单号', '位号', '缺陷描述', '状态', '要求完成时间', '闭环时间', '工作中心', '责任人'],
    ['20032936', 'P-2105A', '机封漏油', '已闭环', D(1), D(3), '检维修中心动设备班', '郑八'],
    ['20032937', 'P-2106A', '对中', '已闭环', D(1), D(1), '检维修中心动设备班', '赵三']] });
  section('B', () => {
    const r = run(V1, [], 'wc');
    const h = (r.j.highlights || []).find((x) => x.type === '超期工单');
    ok(h && /责任方 检维修中心动设备班/.test(h.text) && !/郑八/.test(h.text), 'V1 超期工单重点事项责任方写工作中心，不写责任人姓名');
    ok(h && h.unit === '检维修中心动设备班' && h.no === '20032936' && h.tag === 'P-2105A', 'V2 highlights 带 no / tag / unit 结构字段');
    eq(r.j.orders.overdueList[0].workCenter, '检维修中心动设备班', 'V3 overdueList 带 workCenter');
  });
}

// ---- W. 车间范围核对（D007）：表格带车间列时剔除其他车间的行；上游 JSON 车间不一致不纳入
{
  const OT = '二车间';
  const scOf = (r, name) => ((r.j && r.j.meta.workshopScope) || []).find((x) => x.sheet.endsWith('/' + name)) || {};
  const W1 = mk('ws-mixed.xlsx', {
    '设备台账': [['位号', '在用', '完好', '车间'],
      ['EQ-1', '是', '完好', '测试车间'], ['EQ-2', '是', '完好', '测试'], ['EQ-3', '是', '非完好', ''],
      ['EQ-91', '是', '非完好', OT], ['EQ-92', '是', '非完好', OT], ['EQ-93', '是', '非完好', OT]],
    '故障记录': [['位号', '故障描述', '故障时间', '停机时长', '修复时长', '车间'], ['P-1', '漏', D(1), 2, 1, '测试车间'], ['P-91', '外车间漏', D(1), 9, 9, OT]],
    '检修计划': [['项目名称', '位号', '状态', '计划完成', '实际完成', '车间'], ['项目1', 'P-1', '已完成', D(1), D(1), '测试车间'], ['外车间项目', 'P-91', '未开工', D(2), '', OT]],
    '工单台账': [['工单号', '位号', '状态', '要求完成时间', '闭环时间', '车间'], ['WO-1', 'P-1', '已闭环', D(1), D(1), '测试车间'], ['WO-91', 'P-91', '施工中', D(1), '', OT]],
    '缺陷台账': [['位号', '缺陷描述', '状态', '发现时间', '车间'], ['P-1', '漏', '待处理', D(1), '测试车间'], ['P-91', '外车间漏', '待处理', D(1), OT]],
    '备件消耗': [['备件名称', '数量', '金额', '车间'], ['机封', 1, 100, '测试车间'], ['外车间备件', 1, 9000, OT]],
    '特护设备': [['位号', '设备名称', '状态', '车间'], ['K-1', '压缩机', '运行', '测试车间'], ['K-91', '外压缩机', '运行', OT]],
    '备机': [['位号', '设备名称', '状态', '是否可投用', '车间'], ['P-1B', '泵B', '备用', '是', '测试车间'], ['P-91B', '外泵B', '备用', '否', OT]],
    '密封点统计': [['密封点类型', '密封点总数', '泄漏点数', '车间'], ['静密封点', 1000, 1, '测试车间'], ['静密封点', 5000, 50, OT], ['动密封点', 100, 0, '测试车间']],
    '停工记录': [['停工时间', '停工类别', '原因', '车间'], [D(1), '非计划', '跳电', '测试车间'], [D(2), '非计划', '外车间停工', OT]],
  });
  section('A', () => {
    r = run(W1, [], 'ws-mixed');
    eq(r.s.ok, true, 'W1 两车间混合输入可运行');
    eq(r.s.metrics.intactTotal, 3, 'W2 设备台账只保留本车间（含「测试」写法与车间列为空的行），剔除二车间 3 台');
    eq(r.s.metrics.intactRate, 66.7, 'W3 完好率只按本车间算（2/3）');
    ok(r.j.warnings.some((w) => w.includes('设备台账') && w.includes('剔除其他车间 3 行') && w.includes(OT)), 'W4 剔除行数与车间名写进 warning');
    eq(scOf(r, '设备台账').status, 'checked', 'W5 meta.workshopScope 记设备台账已核对');
    eq(scOf(r, '设备台账').droppedRows, 3, 'W6 meta.workshopScope 记剔除行数');
    eq((scOf(r, '设备台账').dropped || {})[OT], 3, 'W7 meta.workshopScope 记剔除车间名');
    eq(scOf(r, '设备台账').blank, 1, 'W8 车间列为空的行保留并计数');
    ok(r.j.warnings.some((w) => w.includes('设备台账') && w.includes('车间列为空 1 行')), 'W9 车间列为空有 warning');
    ok(/车间范围：已按车间列核对「测试车间」/.test(r.md) && /「ws-mixed\.xlsx\/设备台账」3 行（二车间 3 行）/.test(r.md), 'W10 md 口径处写明剔除情况');
    ok(!/【注意】/.test(r.md.split('## 一、')[0]), 'W11 部分剔除时开头不加【注意】');
    eq(r.s.counts.faults, 1, 'W12 故障记录剔除其他车间');
    eq(r.s.metrics.planTotal, 1, 'W13 检修计划剔除其他车间');
    eq(r.s.metrics.orderDue, 1, 'W14 工单台账剔除其他车间');
    eq(r.s.counts.newDefects, 1, 'W15 缺陷台账剔除其他车间');
    eq(r.j.spare.totalAmount, 100, 'W16 备件消耗剔除其他车间');
    eq(r.s.counts.specialEquipment, 1, 'W17 特护设备剔除其他车间');
    eq(r.s.metrics.standbyRate, 100, 'W18 备机剔除其他车间');
    eq(r.s.metrics.staticLeakRate, 1, 'W19 密封点统计剔除其他车间行（1/1000）');
    eq(r.s.metrics.unplannedShutdowns, 1, 'W20 停工记录剔除其他车间');
    eq((r.j.meta.workshopScope || []).length, 10, 'W21 十张主表各自核对');
  });
  const SPX = mk('ws-spare.xlsx', { '备件消耗': [['备件名称', '数量', '金额', '车间'], ['机封', 1, 100, '测试车间'], ['外车间备件', 1, 9000, OT]] });
  section('B', () => {
    r = run(FULL, ['--spare', SPX], 'ws-spare');
    eq(r.j.spare.totalAmount, 100, 'W22 --spare 备件消耗表也按车间剔除');
  });
  // 车间列全不一致：不筛，warning 与 md 开头【注意】
  const W2 = mk('ws-mismatch.xlsx', { '设备台账': [['位号', '在用', '完好', '车间'], ['EQ-91', '是', '完好', OT], ['EQ-92', '是', '非完好', OT]] });
  section('A', () => {
    r = run(W2, [], 'ws-mismatch');
    eq(r.s.metrics.intactTotal, 2, 'W23 车间列全不一致时不筛');
    eq(scOf(r, '设备台账').status, 'mismatch', 'W24 meta.workshopScope 记 mismatch');
    ok(r.j.warnings.some((w) => w.startsWith('【注意】') && w.includes(OT)), 'W25 warning 以【注意】开头');
    ok(/【注意】.*车间列取值与 --workshop「测试车间」不一致，未按车间筛选，请核对输入/.test(r.md.split('## 一、')[0]), 'W26 md 标题后、第一节前有【注意】');
  });
  // 无车间列
  section('B', () => {
    r = run(FULL, [], 'ws-nocol');
    eq(scOf(r, '设备台账').status, 'noColumn', 'W27 无车间列 status=noColumn');
    ok(/车间范围：输入未含车间列，车间范围以取数条件为准。/.test(r.md), 'W28 md 口径写明以取数条件为准');
  });
  // 维护工厂不是车间列
  const W3 = mk('ws-plant.xlsx', { '设备台账': [['位号', '在用', '完好', '维护工厂'], ['EQ-1', '是', '完好', '1100'], ['EQ-2', '是', '完好', '1200']] });
  section('B', () => {
    r = run(W3, [], 'ws-plant');
    eq(scOf(r, '设备台账').status, 'noColumn', 'W29 「维护工厂」列不当车间列');
    eq(r.s.metrics.intactTotal, 2, 'W30 维护工厂列不参与筛选');
  });
  // 上游 JSON：日报 / leaks.json / rotation.json 车间不一致不纳入；未注明车间照常纳入并说明；带 meta.workshopScope 照常读取
  const WD = mkDailyDir('ws-daily', [0, 1, 2], (o, i) => { if (i === 2) o.meta.workshop = OT; if (i === 1) o.meta.workshopScope = [{ sheet: 'x/巡检汇总', status: 'checked', droppedRows: 2 }]; });
  section('B', () => {
    r = run(WD, [], 'ws-daily');
    eq(r.s.counts.dailyFiles, 2, 'W31 车间不一致的日报不纳入，带 meta.workshopScope 的日报照常纳入');
    ok(r.j.warnings.some((w) => w.includes(`daily-${D(2)}.json`) && w.includes(OT) && w.includes('测试车间')), 'W32 warning 写明文件名与两个车间名');
    eq((((r.j.meta.upstreamWorkshop || {}).excluded || [])[0] || {}).file, `daily-${D(2)}.json`, 'W33 meta.upstreamWorkshop 记不纳入的来源');
    ok(/【注意】上游 JSON「daily-2026-09-16\.json」的车间「二车间」/.test(r.md.split('## 一、')[0]), 'W34 md 开头提示有上游 JSON 未纳入');
    ok(/上游 JSON 车间核对：「daily-2026-09-14\.json」、「daily-2026-09-15\.json」与「测试车间」一致，已纳入/.test(r.md), 'W35 口径写明一致纳入');
  });
  const LKO = path.join(work, 'leaks-other.json');
  fs.writeFileSync(LKO, JSON.stringify({ meta: { workshop: OT }, counts: { leaks: 3, open: 2, overdue: 1, repaired: 1 }, repaired: [], metrics: {} }));
  const ROTO = path.join(work, 'rotation-other.json');
  fs.writeFileSync(ROTO, JSON.stringify({ meta: { workshop: OT }, standbyAvailability: { pairs: 10, available: 8, statusMissing: 0, statusUnknown: 0, rate: 80 } }));
  section('B', () => {
    r = run([LKO, ROTO, LEAKS2, FULL].join(','), [], 'ws-json');
    eq(r.s.counts.leakOpen, 2, 'W36 车间不一致的 leaks.json 不纳入，改用未注明车间的 leaks2.json');
    ok(!r.s.sources.some((x) => /leaks-other|rotation-other/.test(x)), 'W37 车间不一致的 leaks.json / rotation.json 不进数据来源');
    eq(r.s.metrics.standbyRate, null, 'W38 车间不一致的 rotation.json 不作备机完好率来源');
    ok(/上游 JSON 未注明车间，无法核对（「leaks2\.json」），已照常纳入/.test(r.md), 'W39 无车间字段的 JSON 照常纳入并在口径处说明');
  });
  // --prev 基准期车间不一致：不做环比
  section('B', () => {
    r = run(FULL, [], 'ws-prev-src');
    const pj = JSON.parse(fs.readFileSync(path.join(r.out, 'periodic.json'), 'utf8'));
    ok(Array.isArray(pj.meta.workshopScope), 'W40 periodic.json 输出 meta.workshopScope 数组');
    pj.meta.workshop = OT;
    const PO = path.join(work, 'prev-other.json');
    fs.writeFileSync(PO, JSON.stringify(pj));
    r = run(FULL, ['--prev', PO], 'ws-prev');
    eq(r.j.compare, null, 'W41 基准期 periodic.json 车间不一致不做环比');
    ok(r.j.warnings.some((w) => w.includes('prev-other.json') && w.includes('不一致')), 'W42 基准期车间不一致有 warning');
  });
}

console.log(`\n${'='.repeat(56)}`);
console.log(`equipment-weekly-monthly-report 自测：${pass} 通过，${fail} 失败`);
console.log(`用例级别 ${LEVELS[RUN_LEVEL]}：BVT ${byLevel.BVT}，A ${byLevel.A}，B ${byLevel.B}，C ${byLevel.C}`);
if (failures.length) { console.log('\n失败项：'); failures.forEach((f) => console.log('  ✗ ' + f)); }
console.log('='.repeat(56));
try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
