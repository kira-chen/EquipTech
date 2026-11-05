#!/usr/bin/env node
'use strict';
/**
 * 自测：生成变体输入并断言 turnaround.js 行为（中石化大检修口径）。用法：node scripts/selftest.js（全绿退出 0）
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { writeXlsx, readXlsx } = require('./lib/xlsx-lite');

const TA = path.join(__dirname, 'turnaround.js');
const ROOT = path.join(__dirname, '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tawt-selftest-'));
const DATE = '2026-09-21';
const START = '2026-09-10';
const END = '2026-10-10';
const EMOJI = /[⚠✅❌✔✖\u{1F300}-\u{1FAFF}]/u;
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
  const r = spawnSync(process.execPath, [TA, '--input', file, '--workshop', '测试车间', '--project', '测试大检修',
    '--date', DATE, '--start', START, '--end', END, '--out', out, ...extra], { encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  let summary;
  try { summary = JSON.parse(lines[lines.length - 1]); } catch (e) { summary = { ok: false, error: 'no-json:' + r.stdout + r.stderr }; }
  let prog = null, md = null;
  if (fs.existsSync(path.join(out, 'progress.json'))) prog = JSON.parse(fs.readFileSync(path.join(out, 'progress.json'), 'utf8'));
  if (fs.existsSync(path.join(out, 'progress.md'))) md = fs.readFileSync(path.join(out, 'progress.md'), 'utf8');
  return { code: r.status, summary, prog, md, out };
}
function mk(name, book) { const p = path.join(work, name); writeXlsx(p, book); return p; }
const P = (no) => (prog) => prog.byProject.find((x) => x.no === no);
const LIN = ['--linear-check'];

const HDR = ['项目编号', '项目名称', '位号', '专业', '计划开工', '计划完工', '实际开工', '实际完工', '工期', '施工单位', '责任人', '状态', '完成比例', '备注'];
let r;

// ---- 1. 基础：状态分布、总体加权、正常项目（--linear-check 下应有进度）
const base = mk('base.xlsx', {
  '项目清单': [HDR,
    ['T-01', '塔内件更换', 'C-01', '静设备', '2026-09-11', '2026-09-23', '2026-09-11', '', 12, '机修一队', '张班长', '施工中', 80, ''],
    ['T-02', '空冷器清洗', 'A-01', '静设备', '2026-09-10', '2026-09-15', '2026-09-10', '2026-09-15', 5, '机修一队', '张班长', '已完工', 100, ''],
    ['T-03', '管线换阀', 'L-01', '静设备', '2026-09-25', '2026-10-01', '', '', 6, '机修二队', '李工长', '未开工', 0, ''],
  ],
});
section('BVT', () => {
  r = run(base, LIN, 'base');
  eq(r.summary.ok, true, '1.1 基础运行成功');
  eq(r.summary.counts.total, 3, '1.2 项目总数');
  eq(r.summary.counts.done, 1, '1.3 已完工数');
  eq(r.summary.counts.running, 1, '1.4 施工中数');
  eq(r.summary.counts.notStartedStatus, 1, '1.5 未开工数');
  eq(r.summary.overall.percent, 63.5, '1.6 总体完成比例按工期加权');
  eq(r.prog.overall.weightedSample, 3, '1.7 加权样本数');
  eq(r.prog.overall.weightSumDays, 23, '1.8 加权权重合计为工期之和');
  eq(r.summary.overall.calendarPercent, 36.7, '1.9 日历进度按大检修计划期推算（11/30）');
  eq(r.summary.counts.lagging, 0, '1.10 未超阈值不判滞后');
});
section('B', () => {
  eq(P('T-01')(r.prog).expectedPercent, 83.3, '1.11 --linear-check 下应有进度按计划节点日历推算');
  eq(P('T-01')(r.prog).deviationPct, -3.3, '1.12 偏差 = 实际 − 应有');
});
section('C', () => {
  ok(!EMOJI.test(r.md), '1.13 md 不含 emoji');
  ok(/本材料由脚本汇总、模型成文，仅供设备员复核参考/.test(r.md), '1.14 md 末尾含通用声明行');
});

// ---- 1b. 【核心】默认不启用 --linear-check：类型③不判定，应有进度为 null
section('A', () => {
  r = run(base, [], 'nolinear');
  eq(r.summary.ok, true, '1b.1 默认运行成功');
  eq(r.prog.meta.linearCheck, false, '1b.2 meta 记录未启用线性核对');
  eq(P('T-01')(r.prog).expectedPercent, null, '1b.3 **未启用时应有进度为 null（不推算）**');
  eq(P('T-01')(r.prog).deviationPct, null, '1b.4 未启用时偏差为 null');
  ok(r.summary.warnings.some((w) => w.includes('未启用 --linear-check')), '1b.5 未启用时 warning 说明只判①②');
  ok(/③ 完成比例落后应有进度未启用（需 --linear-check）/.test(r.md), '1b.6 md 判定口径写明③未启用');
  ok(/线性进度核对：未启用/.test(r.md), '1b.7 md 抬头显示未启用');
  ok(/「应有进度」与「偏差」列显示「—」/.test(r.md), '1b.8 md 进度表说明应有进度列为「—」');
});
section('B', () => {
  r = run(base, LIN, 'linear');
  ok(/线性进度核对：已启用（--linear-check）/.test(r.md) && /--linear-check 已启用/.test(r.md), '1b.9 启用时 md 抬头与判定口径注明');
  eq(r.prog.overall.linearCheck, true, '1b.10 overall 记录已启用');
});

// ---- 2. 【核心】完成比例与状态矛盾：单列 + warning，绝不修正任一字段
section('A', () => {
  const conflict = mk('conflict.xlsx', {
    '项目清单': [HDR,
      ['C-01', '呼吸阀更换', 'V-01', '静设备', '2026-09-16', '2026-09-22', '', '', 6, '机修一队', '张班长', '未开工', 50, ''],
      ['C-02', '变送器更换', 'I-01', '仪表', '2026-09-14', '2026-09-18', '2026-09-14', '2026-09-18', 4, '仪表车间', '李主办', '已完工', 30, ''],
      ['C-03', '正常项目', 'P-01', '动设备', '2026-09-12', '2026-09-20', '2026-09-12', '', 8, '机修一队', '张班长', '施工中', 60, ''],
    ],
  });
  r = run(conflict, [], 'conflict');
  eq(r.summary.ok, true, '2.1 状态-比例矛盾不中断执行');
  eq(r.summary.counts.inconsistent, 2, '2.2 矛盾项单列计数');
  const c1 = r.prog.inconsistent.find((x) => x.no === 'C-01');
  const c2 = r.prog.inconsistent.find((x) => x.no === 'C-02');
  eq(c1.status, '未开工', '2.3 矛盾项状态按原值保留，未被改写');
  eq(c1.percent, 50, '2.4 矛盾项完成比例按原值保留，未被改写为 0');
  eq(c2.status, '已完工', '2.5 「已完工」状态原值保留');
  eq(c2.percent, 30, '2.6 「已完工」但 30% 的比例未被改写为 100');
  eq(P('C-01')(r.prog).status, '未开工', '2.7 byProject 中矛盾项状态仍为原值');
  eq(P('C-01')(r.prog).percent, 50, '2.8 byProject 中矛盾项比例仍为原值');
  ok(P('C-01')(r.prog).inconsistent !== null, '2.9 byProject 标注 inconsistent');
  ok(r.prog.warnings.some((w) => w.includes('C-01') && w.includes('矛盾') && w.includes('未作任何修正')), '2.10 warning 声明未作任何修正');
  ok(r.prog.warnings.some((w) => w.includes('第2行')), '2.11 矛盾 warning 含行号');
  eq(P('C-01')(r.prog).lagging, false, '2.12 矛盾项不参与滞后判定');
  eq(P('C-01')(r.prog).inWeighting, false, '2.13 矛盾项不参与总体加权');
  eq(r.summary.overall.percent, 60, '2.14 总体加权剔除矛盾项');
  eq(r.prog.overall.excludedInconsistent.length, 2, '2.15 overall 单列被剔除的矛盾项');
  ok(r.prog.undetermined.some((x) => x.no === 'C-01' && x.reason.includes('矛盾')), '2.16 矛盾项列入未判定');
  ok(/完成比例与状态矛盾/.test(r.md), '2.17 报告单列「完成比例与状态矛盾」一节');
  ok(/脚本不修正任一字段/.test(r.md), '2.18 报告声明脚本不修正任一字段');
  ok(/50%（原文：50）/.test(r.md), '2.19 报告同时给出台账原文');
  const conflict2 = mk('conflict2.xlsx', {
    '项目清单': [HDR,
      ['C-11', '项目', 'P-11', '动设备', '2026-09-12', '2026-09-20', '2026-09-12', '', 8, '机修一队', '张班长', '施工中', 100, ''],
      ['C-12', '中交项目', 'P-12', '动设备', '2026-09-12', '2026-09-18', '2026-09-12', '2026-09-18', 6, '机修一队', '张班长', '已中交', 90, ''],
      ['C-13', '开工项目', 'P-13', '动设备', '2026-09-12', '2026-09-18', '2026-09-12', '2026-09-18', 6, '机修一队', '张班长', '已开工', 95, ''],
    ],
  });
  r = run(conflict2, [], 'conflict2');
  eq(r.summary.counts.inconsistent, 3, '2.20 「施工中」100%、「已中交」90%、「已开工」95% 均判矛盾');
  eq(r.prog.inconsistent[0].percent, 100, '2.21 该项比例仍为 100，未改为 99');
  ok(r.prog.inconsistent.some((x) => x.no === 'C-12' && x.expectation.includes('已中交时完成比例应为 100')), '2.22 已中交相容规则为 100');
});

// ---- 2b. 【核心】已中交 / 已开工 独立状态，≠ 已完工
section('A', () => {
  const nodes = mk('nodes.xlsx', {
    '项目清单': [HDR,
      ['N-01', '已完工项目', 'C-01', '静设备', '2026-09-10', '2026-09-15', '2026-09-10', '2026-09-15', 5, '机修一队', '张班长', '已完工', 100, ''],
      ['N-02', '中交项目', 'C-02', '静设备', '2026-09-10', '2026-09-16', '2026-09-10', '2026-09-16', 6, '机修一队', '张班长', '已中交', 100, ''],
      ['N-03', '中交项目2', 'C-03', '静设备', '2026-09-10', '2026-09-16', '2026-09-10', '2026-09-16', 6, '机修一队', '张班长', '中间交接', 100, ''],
      ['N-04', '开工项目', 'P-04', '动设备', '2026-09-10', '2026-09-14', '2026-09-10', '2026-09-14', 4, '机修一队', '张班长', '已开工', 100, ''],
      ['N-05', '开车项目', 'P-05', '动设备', '2026-09-10', '2026-09-14', '2026-09-10', '2026-09-14', 4, '机修一队', '张班长', '已开车', 100, ''],
      ['N-06', '施工中', 'P-06', '动设备', '2026-09-12', '2026-09-30', '2026-09-12', '', 18, '机修一队', '张班长', '施工中', 50, ''],
    ],
  });
  r = run(nodes, [], 'nodes');
  eq(r.summary.counts.done, 1, '2b.1 已完工只计 1（已中交/已开工不混入）');
  eq(r.summary.counts.handedOver, 2, '2b.2 **已中交独立计数（含同义词「中间交接」）**');
  eq(r.summary.counts.startedUp, 2, '2b.3 **已开工独立计数（含同义词「已开车」）**');
  eq(r.summary.counts.finished, 5, '2b.4 finished = 已完工 + 已中交 + 已开工');
  eq(P('N-02')(r.prog).status, '已中交', '2b.5 「已中交」不映射为已完工');
  eq(P('N-04')(r.prog).status, '已开工', '2b.6 「已开工」不映射为施工中');
  eq(r.summary.counts.lagging, 0, '2b.7 已中交/已开工项目不判已过计划完工日未完工');
  eq(r.summary.overall.percent, C_round(((5 + 6 + 6 + 4 + 4) * 100 + 18 * 50) / (5 + 6 + 6 + 4 + 4 + 18)), '2b.8 已中交/已开工参与加权');
  ok(r.summary.warnings.some((w) => w.includes('「已开工」') && w.includes('中交后开工') && w.includes('施工中')), '2b.9 **出现「已开工」时 warning 提示语义（中交后开车，非开始施工）**');
  ok(/已中交（中间交接）/.test(r.md) && /已开工（中交后开车）/.test(r.md), '2b.10 总体表分列已中交与已开工');
  ok(/「已中交」为中间交接/.test(r.md) && /不等于「已完工」/.test(r.md), '2b.11 md 状态口径说明');
  ok(r.prog.meta.statusEnum.join('/') === '未开工/施工中/已完工/已中交/已开工/已中止/取消', '2b.12 meta 记录七态枚举');
  ok(r.prog.overall.byStatus.some((x) => x.status === '已中交' && x.count === 2), '2b.13 byStatus 含已中交');
});
function C_round(v) { return Math.round(v * 10) / 10; }

// ---- 3. 【核心】完成比例为空 → 显示「—」，按状态给定性进度，绝不按 0 或线性推算
section('A', () => {
  const nopct = mk('nopct.xlsx', {
    '项目清单': [HDR,
      ['N-01', '抽芯检查', 'E-01', '静设备', '2026-09-16', '2026-09-24', '2026-09-16', '', 8, '机修一队', '张班长', '施工中', '', ''],
      ['N-02', '阀门更换', 'V-02', '静设备', '2026-09-22', '2026-09-29', '', '', 7, '机修二队', '李工长', '未开工', '', ''],
      ['N-03', '正常项目', 'P-03', '动设备', '2026-09-12', '2026-09-20', '2026-09-12', '', 8, '机修一队', '张班长', '施工中', 60, ''],
      ['N-04', '中交未填', 'C-04', '静设备', '2026-09-10', '2026-09-16', '2026-09-10', '2026-09-16', 6, '机修一队', '张班长', '已中交', '', ''],
    ],
  });
  r = run(nopct, LIN, 'nopct');
  eq(P('N-01')(r.prog).percent, null, '3.1 完成比例为空 → null，不是 0');
  ok(P('N-01')(r.prog).percentQualitative.includes('施工中'), '3.2 按状态给定性进度');
  ok(P('N-01')(r.prog).percentQualitative.includes('未填报'), '3.3 定性进度写明未填报');
  eq(P('N-02')(r.prog).percentQualitative, '按状态为「未开工」，未填报完成比例', '3.4 未开工项的定性进度');
  ok(P('N-04')(r.prog).percentQualitative.includes('已中交'), '3.4b 已中交项的定性进度');
  eq(P('N-01')(r.prog).inWeighting, false, '3.5 比例为空不参与加权');
  eq(r.summary.overall.percent, 60, '3.6 总体加权只用有比例的项目（未按 0 拉低）');
  eq(r.summary.counts.noPercent, 3, '3.7 比例未填报项单独计数');
  eq(r.prog.overall.excludedNoPercent.length, 3, '3.8 overall 单列比例未填报项');
  ok(r.prog.warnings.some((w) => w.includes('未按 0 计')), '3.9 warning 声明未按 0 计');
  ok(/未按 0 计，也未按工期线性推算/.test(r.md), '3.10 报告声明未按 0 也未线性推算');
  ok(/\| — \|/.test(r.md), '3.11 报告中 null 显示为「—」');
  ok(r.prog.undetermined.some((x) => x.no === 'N-01' && x.reason.includes('不按 0 也不按工期线性推算')), '3.12 比例为空的在办项列入未判定（--linear-check）');
  eq(P('N-01')(r.prog).lagging, false, '3.13 比例为空不按推算值判滞后');
  ok(P('N-01')(r.prog).expectedPercent !== null, '3.14 应有进度仍测算（供参照）');
  eq(P('N-01')(r.prog).percent, null, '3.15 应有进度未回填到完成比例');
  r = run(nopct, [], 'nopct-nolinear');
  ok(!r.prog.undetermined.some((x) => x.no === 'N-01'), '3.16 未启用线性核对时比例为空不列入未判定（无线性判据）');
});

// ---- 4. 【核心】完成比例超出 0~100 → warning + 置 null，不截断
section('C', () => {
  const outr = mk('outrange.xlsx', {
    '项目清单': [HDR,
      ['O-01', '超上限', 'C-11', '静设备', '2026-09-12', '2026-09-20', '2026-09-12', '', 8, '机修一队', '张班长', '施工中', 150, ''],
      ['O-02', '负值', 'C-12', '静设备', '2026-09-12', '2026-09-20', '2026-09-12', '', 8, '机修一队', '张班长', '施工中', -20, ''],
      ['O-03', '正常', 'C-13', '静设备', '2026-09-12', '2026-09-20', '2026-09-12', '', 8, '机修一队', '张班长', '施工中', 60, ''],
    ],
  });
  r = run(outr, [], 'outrange');
  eq(P('O-01')(r.prog).percent, null, '4.1 超 100 → null，未截断到 100');
  eq(P('O-02')(r.prog).percent, null, '4.2 负值 → null，未截断到 0');
  eq(P('O-01')(r.prog).percentOutOfRange, true, '4.3 标记 percentOutOfRange');
  eq(P('O-01')(r.prog).rawPercent, '150', '4.4 保留台账原文供核实');
  ok(r.prog.warnings.some((w) => w.includes('150') && w.includes('未截断到边界值')), '4.5 warning 声明未截断');
  ok(r.prog.warnings.some((w) => w.includes('-20')), '4.6 负值也有 warning');
  eq(r.summary.overall.percent, 60, '4.7 越界项不参与加权');
  eq(r.summary.counts.inconsistent, 0, '4.8 越界置空后不再判为状态矛盾');
  ok(P('O-01')(r.prog).percentQualitative !== null, '4.9 越界置空后按状态给定性进度');
});

// ---- 5. 【核心】滞后三类与免责声明
const lag = mk('lag.xlsx', {
  '项目清单': [HDR,
    ['L-01', '滞后项目', 'C-21', '静设备', '2026-09-11', '2026-09-23', '2026-09-11', '', 12, '外委队', '王经理', '施工中', 20, '人员未到齐'],
    ['L-02', '超期未完工', 'F-01', '静设备', '2026-09-10', '2026-09-19', '2026-09-10', '', 9, '外委队', '王经理', '施工中', 80, '焊口返修'],
    ['L-03', '未开工', 'P-21', '动设备', '2026-09-18', '2026-09-27', '', '', 9, '机修一队', '张班长', '未开工', 0, '等待交出'],
    ['L-04', '正常', 'A-21', '静设备', '2026-09-15', '2026-09-24', '2026-09-15', '', 9, '机修一队', '张班长', '施工中', 90, ''],
  ],
});
section('A', () => {
  r = run(lag, LIN, 'lag');
  eq(r.summary.counts.lagging, 3, '5.1 启用 --linear-check 时三类滞后全部识别');
  const l1 = r.prog.lagging.find((x) => x.no === 'L-01');
  eq(l1.lagType, '完成比例落后应有进度', '5.2 滞后类型③');
  eq(l1.lagDays, 7.6, '5.3 落后比例按工期折算天数');
  ok(l1.basis.includes('--linear-check'), '5.3b 类型③测算依据注明 --linear-check');
  eq(r.prog.lagging.find((x) => x.no === 'L-02').lagType, '已过计划完工日未完工', '5.4 滞后类型①');
  eq(r.prog.lagging.find((x) => x.no === 'L-02').lagDays, 2, '5.5 超计划完工天数');
  eq(r.prog.lagging.find((x) => x.no === 'L-03').lagType, '超计划开工日未开工', '5.6 滞后类型②');
  eq(r.prog.lagging.find((x) => x.no === 'L-03').lagDays, 3, '5.7 超计划开工天数');
  ok(l1.disclaimer.includes('最终以指挥部判定为准'), '5.8 每个滞后条目带免责声明');
  ok(l1.basis.includes('按计划'), '5.9 滞后条目写明测算依据');
  ok(/基于计划节点测算，最终以指挥部判定为准/.test(r.md), '5.10 报告正文出现免责声明');
  eq(r.prog.meta.disclaimer, '滞后天数与工期影响均基于计划节点测算，最终以指挥部判定为准。', '5.11 meta 中固化免责声明');
  eq(r.summary.disclaimer, r.prog.meta.disclaimer, '5.12 摘要中同步免责声明');
  eq(r.prog.overall.disclaimer, r.prog.meta.disclaimer, '5.13 overall 中同步免责声明');
  ok((r.md.match(/最终以指挥部判定为准/g) || []).length >= 3, '5.14 报告中免责声明出现在多处');
});
section('B', () => {
  r = run(lag, [...LIN, '--lag-days', '8'], 'lag8');
  ok(!r.prog.lagging.some((x) => x.no === 'L-01'), '5.15 提高阈值后小幅落后不再判滞后');
});
section('A', () => {
  // 默认不启用：类型③不判
  r = run(lag, [], 'lag-nolinear');
  eq(r.summary.counts.lagging, 2, '5.16 **默认只判①②，类型③不判定**');
  ok(!r.prog.lagging.some((x) => x.no === 'L-01'), '5.17 默认下落后应有进度的项目不判滞后');
  eq(P('L-01')(r.prog).judged, true, '5.18 默认下该项按正常判定（无线性判据不算未判定）');
});

// ---- 6. 关键路径项目滞后单独醒目标注
section('B', () => {
  r = run(lag, [...LIN, '--critical', 'L-01,L-03'], 'critical');
  eq(r.summary.counts.criticalLagging, 2, '6.1 关键路径滞后计数');
  eq(r.prog.criticalLagging.length, 2, '6.2 criticalLagging 单列');
  eq(P('L-01')(r.prog).critical, true, '6.3 byProject 标注关键路径');
  eq(P('L-02')(r.prog).critical, false, '6.4 非关键路径项目不误标');
  eq(r.prog.lagging[0].critical, true, '6.5 滞后清单关键路径项排在最前');
  ok(/【注意】关键路径滞后/.test(r.md), '6.6 报告中关键路径滞后单独成节且用【注意】（无 emoji）');
  ok(/关键路径项目滞后直接影响大检修总工期/.test(r.md), '6.7 关键路径滞后有影响说明');
  ok(/★/.test(r.md), '6.8 进度表中关键路径用★标注');
  r = run(lag, ['--critical', 'L-99'], 'criticalmiss');
  ok(r.prog.meta.criticalMissing.includes('L-99'), '6.9 关键路径编号不存在时单列');
  ok(r.prog.warnings.some((w) => w.includes('L-99') && w.includes('不存在')), '6.10 关键路径编号不存在 warning');
  r = run(lag, [...LIN, '--critical', 'L-01、L-03'], 'criticalsep');
  eq(r.summary.counts.criticalLagging, 2, '6.11 关键路径编号支持顿号等分隔符');
});

// ---- 7. 【核心】计划完工早于计划开工 → warning 单列
section('C', () => {
  const badplan = mk('badplan.xlsx', {
    '项目清单': [HDR,
      ['B-01', '计划倒序', 'C-31', '静设备', '2026-09-23', '2026-09-20', '', '', 4, '机修一队', '张班长', '未开工', 0, ''],
      ['B-02', '正常', 'C-32', '静设备', '2026-09-12', '2026-09-20', '2026-09-12', '', 8, '机修一队', '张班长', '施工中', 60, ''],
    ],
  });
  r = run(badplan, LIN, 'badplan');
  eq(r.summary.ok, true, '7.1 计划节点倒序不中断');
  eq(r.summary.counts.planIssue, 1, '7.2 计划节点异常单列计数');
  ok(r.prog.planIssues[0].issue.includes('早于计划开工'), '7.3 异常说明明确');
  eq(r.prog.planIssues[0].planStart, '2026-09-23', '7.4 计划节点原样保留未对调');
  eq(r.prog.planIssues[0].planEnd, '2026-09-20', '7.5 计划完工原值保留');
  ok(r.prog.warnings.some((w) => w.includes('早于计划开工') && w.includes('原样保留')), '7.6 warning 声明原样保留');
  eq(P('B-01')(r.prog).expectedPercent, null, '7.7 计划异常项不测算应有进度');
  eq(P('B-01')(r.prog).lagging, false, '7.8 计划异常项不判滞后');
  ok(r.prog.undetermined.some((x) => x.no === 'B-01' && x.reason.includes('计划节点异常')), '7.9 计划异常项列入未判定');
  ok(/计划节点异常/.test(r.md), '7.10 报告单列计划节点异常');
});

// ---- 8. 【核心】开工条件未具备 readyGap 单列
section('B', () => {
  const ready = mk('ready.xlsx', {
    '项目清单': [HDR,
      ['R-01', '待开工项目', 'E-41', '静设备', '2026-09-18', '2026-09-27', '', '', 9, '机修一队', '张班长', '未开工', 0, ''],
      ['R-02', '正常项目', 'C-41', '静设备', '2026-09-12', '2026-09-20', '2026-09-12', '', 8, '机修一队', '张班长', '施工中', 60, ''],
    ],
    '开工条件': [['项目编号', '条件项', '是否具备', '责任单位', '责任人', '备注'],
      ['R-01', '设备交出', '否', '生产运行班', '王班长', '装置未降温'],
      ['R-01', '作业许可办理', '是', '安全科', '赵安全员', ''],
      ['R-02', '安全交底', '', '安全科', '赵安全员', '未填报'],
    ],
  });
  r = run(ready, [], 'ready');
  eq(r.summary.counts.readyGap, 2, '8.1 条件未具备与未判定各计一条');
  eq(r.prog.readyGap.find((x) => x.item === '设备交出').judged, false, '8.2 「否」判为条件未具备');
  eq(r.prog.readyGap.find((x) => x.item === '安全交底').judged, null, '8.3 空值 → 未判定，未按已具备处理');
  ok(r.prog.readyGap.find((x) => x.item === '安全交底').reason.includes('未判定'), '8.4 未判定原因明确');
  ok(!r.prog.readyGap.some((x) => x.item === '作业许可办理'), '8.5 「是」的条件不列入缺口');
  eq(P('R-01')(r.prog).readyGap, true, '8.6 byProject 标注条件缺口');
  ok(r.prog.warnings.some((w) => w.includes('未按已具备处理')), '8.7 warning 声明未按已具备处理');
  ok(/开工条件缺口/.test(r.md), '8.8 报告单列开工条件缺口');
});

// ---- 9. 【核心】材料未到货 materialGap 单列
section('B', () => {
  const mat = mk('mat.xlsx', {
    '项目清单': [HDR,
      ['M-01', '换泵项目', 'P-51', '动设备', '2026-09-19', '2026-09-26', '', '', 7, '机修一队', '张班长', '未开工', 0, ''],
      ['M-02', '正常项目', 'C-51', '静设备', '2026-09-12', '2026-09-20', '2026-09-12', '', 8, '机修一队', '张班长', '施工中', 60, ''],
    ],
    '材料到货': [['项目编号', '材料名称', '需求数量', '到货数量', '需求日期', '到货状态', '备注'],
      ['M-01', '离心泵机组', 1, 0, '2026-09-18', '未到货', '厂家延期'],
      ['M-01', '联轴器', 1, 1, '2026-09-18', '已到货', ''],
      ['M-02', '密封垫', 8, 3, '2026-09-16', '', '到货不足'],
      ['M-02', '螺栓', 20, '', '2026-09-16', '', '未填报'],
    ],
  });
  r = run(mat, [], 'mat');
  eq(r.summary.counts.materialGap, 3, '9.1 未到货/到货不足/未判定各计一条');
  eq(r.prog.materialGap.find((x) => x.material === '离心泵机组').judged, false, '9.2 到货状态「未到货」判为缺口');
  eq(r.prog.materialGap.find((x) => x.material === '密封垫').judged, false, '9.3 无状态时按数量比较判缺口');
  ok(r.prog.materialGap.find((x) => x.material === '密封垫').basis.includes('到货 3 / 需求 8'), '9.4 标注数量判定依据');
  eq(r.prog.materialGap.find((x) => x.material === '螺栓').judged, null, '9.5 状态与数量均缺 → 未判定');
  ok(!r.prog.materialGap.some((x) => x.material === '联轴器'), '9.6 已到货材料不列入缺口');
  eq(P('M-01')(r.prog).materialGap, true, '9.7 byProject 标注材料缺口');
  ok(r.prog.warnings.some((w) => w.includes('未按已到货处理')), '9.8 warning 声明未按已到货处理');
  ok(/材料到货缺口/.test(r.md), '9.9 报告单列材料到货缺口');
});

// ---- 9b. 【核心】三查四定问题：单独一节，四定不全/超期/未判定单列
section('A', () => {
  const tcfd = mk('tcfd.xlsx', {
    '项目清单': [HDR,
      ['Q-01', '塔内件更换', 'C-01', '静设备', '2026-09-11', '2026-09-23', '2026-09-11', '', 12, '外委队', '王经理', '施工中', 80, ''],
      ['Q-02', '已中交项目', 'C-02', '静设备', '2026-09-10', '2026-09-16', '2026-09-10', '2026-09-16', 6, '机修一队', '张班长', '已中交', 100, ''],
    ],
    '三查四定': [['问题编号', '项目编号', '位号', '问题类别', '问题描述', '整改措施', '责任单位', '责任人', '整改期限', '整改状态', '备注'],
      ['S-1', 'Q-01', 'C-01', '查工程质量', '焊缝咬边', '补焊复检', '外委队', '王经理', '2026-09-19', '未关闭', ''],
      ['S-2', 'Q-02', 'C-02', '查未完工程', '平台栏杆未恢复', '', '', '', '', '未整改', '中交留项'],
      ['S-3', 'Q-01', 'C-01', '查设计漏项', '缺压力表接口', '增设接口', '外委队', '王经理', '2026-09-25', '已关闭', ''],
      ['S-4', 'Q-01', 'C-01', '查工程质量', '保温未恢复', '恢复保温', '机修一队', '李工长', '2026-09-23', '已上报', ''],
      ['S-5', 'Q-99', '', '查工程质量', '项目不存在的问题', '处理', '队', '人', '2026-09-23', '已整改', ''],
    ],
  });
  r = run(tcfd, [], 'tcfd');
  eq(r.summary.ok, true, '9b.1 三查四定表可读');
  eq(r.prog.meta.tcfdProvided, true, '9b.2 meta 标记已提供三查四定');
  eq(r.summary.counts.tcfdTotal, 5, '9b.3 问题总数');
  eq(r.summary.counts.tcfdOpen, 2, '9b.4 未关闭计数（未关闭 + 未整改）');
  eq(r.summary.counts.tcfdUndetermined, 1, '9b.5 **「已上报」无法判定关闭 → 未判定，不按已关闭**');
  eq(r.prog.tcfd.counts.closed, 2, '9b.6 已关闭计数（已关闭 + 已整改）');
  eq(r.summary.counts.tcfdIncompleteSiDing, 1, '9b.7 **四定不全单列（缺措施/人员/时间）**');
  const s2 = r.prog.tcfd.items.find((t) => t.id === 'S-2');
  ok(s2.missingSiDing.join('、') === '定任务/定措施、定人员、定时间', '9b.8 四定不全写明缺哪几定');
  eq(r.summary.counts.tcfdOverdue, 1, '9b.9 超期未关闭计数');
  eq(r.prog.tcfd.items.find((t) => t.id === 'S-1').overdueDays, 2, '9b.10 超期天数');
  eq(r.prog.tcfd.items.find((t) => t.id === 'S-4').closed, null, '9b.11 未判定项 closed 为 null');
  ok(r.prog.warnings.some((w) => w.includes('已上报') && w.includes('未按已关闭处理')), '9b.12 未判定 warning 声明未按已关闭');
  ok(r.prog.warnings.some((w) => w.includes('Q-99') && w.includes('不存在')), '9b.13 项目编号不存在 warning');
  eq(P('Q-01')(r.prog).tcfdOpen, 2, '9b.14 byProject 标注未关闭三查四定问题数（含未判定）');
  ok(/## 六、三查四定问题/.test(r.md), '9b.15 **md 三查四定单独一节**');
  ok(/未关闭·超期 2 天/.test(r.md), '9b.16 md 标注超期');
  ok(/不全：缺定任务\/定措施、定人员、定时间/.test(r.md), '9b.17 md 标注四定不全');
  ok(/【未判定】关闭状态无法识别的问题/.test(r.md), '9b.18 md 未判定说明');
  ok(/三查四定问题（未关闭 \/ 未判定 \/ 总数） \| 2 \/ 1 \/ 5/.test(r.md), '9b.19 总体表显示三查四定计数');
});
section('B', () => {
  const xb = readXlsx(path.join(r.out, '进度表.xlsx'));
  ok(xb['三查四定问题'] && xb['三查四定问题'].length === 6, '9b.20 进度表.xlsx 附三查四定问题工作表');
});
section('A', () => {
  r = run(base, [], 'notcfd');
  eq(r.prog.meta.tcfdProvided, false, '9b.21 缺三查四定表时标记未提供');
  ok(/未提供三查四定问题数据/.test(r.md), '9b.22 md 写「未提供三查四定问题数据」');
  ok(/三查四定问题（未关闭 \/ 未判定 \/ 总数） \| 未提供/.test(r.md), '9b.23 总体表显示「未提供」而非 0');
});

// ---- 10. 缺可选表 → warning + 该节写「未提供 XX 数据」，不中断
section('B', () => {
  r = run(base, [], 'nooptional');
  eq(r.summary.ok, true, '10.1 缺四张可选表不中断');
  eq(r.prog.meta.materialProvided, false, '10.2 标记未提供材料数据');
  eq(r.prog.meta.readyProvided, false, '10.3 标记未提供开工条件数据');
  eq(r.prog.meta.manpowerProvided, false, '10.4 标记未提供人员数据');
  ok(/未提供材料到货数据/.test(r.md), '10.5 报告写「未提供材料到货数据」');
  ok(/未提供开工条件数据/.test(r.md), '10.6 报告写「未提供开工条件数据」');
  ok(/未提供人员到位数据/.test(r.md), '10.7 报告写「未提供人员到位数据」');
  ok(r.prog.warnings.some((w) => w.includes('未找到「材料到货」工作表')), '10.8 缺材料表 warning');
  ok(/材料到货缺口 \| 未提供/.test(r.md), '10.9 总体表中缺口显示「未提供」而非 0');
});

// ---- 11. 工期缺失 → 不参与加权并单列说明
section('B', () => {
  const nodur = mk('nodur.xlsx', {
    '项目清单': [HDR,
      ['W-01', '工期缺失', 'I-61', '仪表', '2026-09-17', '2026-09-23', '2026-09-17', '', '', '仪表车间', '李主办', '施工中', 60, ''],
      ['W-02', '工期非法', 'I-62', '仪表', '2026-09-17', '2026-09-23', '2026-09-17', '', '很快', '仪表车间', '李主办', '施工中', 40, ''],
      ['W-03', '工期为零', 'I-63', '仪表', '2026-09-17', '2026-09-23', '2026-09-17', '', 0, '仪表车间', '李主办', '施工中', 40, ''],
      ['W-04', '正常', 'C-61', '静设备', '2026-09-12', '2026-09-20', '2026-09-12', '', 8, '机修一队', '张班长', '施工中', 70, ''],
    ],
  });
  r = run(nodur, [], 'nodur');
  eq(P('W-01')(r.prog).duration, null, '11.1 工期空 → null');
  eq(P('W-02')(r.prog).duration, null, '11.2 工期无法解析 → null');
  eq(P('W-03')(r.prog).duration, null, '11.3 工期为 0 → null');
  eq(r.summary.counts.noDuration, 3, '11.4 工期缺失项计数');
  eq(r.summary.overall.percent, 70, '11.5 总体加权只用有工期的项目');
  eq(r.prog.overall.weightedSample, 1, '11.6 加权样本数正确');
  eq(r.prog.overall.excludedNoDuration.length, 3, '11.7 overall 单列工期缺失项');
  ok(r.prog.warnings.some((w) => w.includes('不参与加权')), '11.8 warning 声明不参与加权');
  ok(/不按任何默认工期补齐/.test(r.md), '11.9 报告声明未按默认工期补齐');
  ok(/未参与加权（工期缺失）/.test(r.md), '11.10 报告单列工期缺失一节');
});

// ---- 12. 无任何可加权项目 → 总体完成比例 null，不按 0
section('A', () => {
  const noweight = mk('noweight.xlsx', {
    '项目清单': [HDR,
      ['Z-01', '无比例无工期', 'C-71', '静设备', '2026-09-12', '2026-09-20', '2026-09-12', '', '', '机修一队', '张班长', '施工中', '', ''],
    ],
  });
  r = run(noweight, [], 'noweight');
  eq(r.summary.overall.percent, null, '12.1 无可加权样本时总体比例为 null');
  ok(/总体完成比例（按工期加权） \| —/.test(r.md), '12.2 报告中显示「—」而非 0%');
  ok(r.prog.warnings.some((w) => w.includes('不按 0，也不按项目数简单平均')), '12.3 warning 声明不按 0 不按简单平均');
});

// ---- 13. 状态未知：单列 unknownStatus，绝不就近映射
section('A', () => {
  const badst = mk('badstatus.xlsx', {
    '项目清单': [HDR,
      ['U-01', '挂起项目', 'P-81', '动设备', '2026-09-17', '2026-09-23', '2026-09-17', '', 6, '机修一队', '张班长', '挂起', 40, ''],
      ['U-02', '空状态', 'P-82', '动设备', '2026-09-17', '2026-09-23', '2026-09-17', '', 6, '机修一队', '张班长', '', 40, ''],
      ['U-03', '正常', 'P-83', '动设备', '2026-09-12', '2026-09-20', '2026-09-12', '', 8, '机修一队', '张班长', '施工中', 60, ''],
    ],
  });
  r = run(badst, [], 'badstatus');
  eq(r.summary.counts.unknownStatus, 2, '13.1 非法状态与空状态各单列一条');
  eq(r.prog.unknownStatus.find((x) => x.no === 'U-01').rawStatus, '挂起', '13.2 保留台账原文');
  eq(r.prog.unknownStatus.find((x) => x.no === 'U-02').reason, '状态为空', '13.3 空状态原因标注正确');
  eq(P('U-01')(r.prog).status, null, '13.4 未知状态未被映射为任何标准态');
  eq(P('U-01')(r.prog).inWeighting, false, '13.5 未知状态不参与加权');
  eq(r.summary.overall.percent, 60, '13.6 总体加权剔除未知状态项');
  ok(r.prog.warnings.some((w) => w.includes('不做就近映射')), '13.7 warning 声明不做就近映射');
  ok(/状态未知项目/.test(r.md), '13.8 报告单列状态未知一节');
  eq(r.summary.counts.total, 3, '13.9 未知状态项仍计入项目总数');
});

// ---- 14. 取消项目不参与进度统计但如实列出
section('B', () => {
  const cancel = mk('cancel.xlsx', {
    '项目清单': [HDR,
      ['X-01', '取消项目', 'P-91', '动设备', '2026-09-12', '2026-09-20', '', '', 8, '机修一队', '张班长', '取消', 0, '本次不实施'],
      ['X-02', '正常', 'P-92', '动设备', '2026-09-12', '2026-09-20', '2026-09-12', '', 8, '机修一队', '张班长', '施工中', 60, ''],
    ],
  });
  r = run(cancel, [], 'cancel');
  eq(r.summary.counts.cancelled, 1, '14.1 取消项计数');
  eq(r.summary.counts.active, 1, '14.2 取消项不计入有效项目');
  eq(r.summary.overall.percent, 60, '14.3 取消项不参与加权');
  eq(P('X-01')(r.prog).lagging, false, '14.4 取消项不判滞后');
  eq(r.summary.counts.undetermined, 0, '14.5 取消项不列入未判定');
  eq(r.summary.counts.total, 2, '14.6 取消项仍计入项目总数');
});

// ---- 15. --prev 日进度对比（含中交/开工节点变化）
section('B', () => {
  const day1 = mk('day1.xlsx', {
    '项目清单': [HDR,
      ['D-01', '推进项目', 'C-01', '静设备', '2026-09-11', '2026-09-23', '2026-09-11', '', 12, '机修一队', '张班长', '施工中', 40, ''],
      ['D-02', '停滞项目', 'C-02', '静设备', '2026-09-11', '2026-09-23', '2026-09-11', '', 12, '机修一队', '张班长', '施工中', 50, ''],
      ['D-03', '比例未填', 'C-03', '静设备', '2026-09-11', '2026-09-23', '2026-09-11', '', 12, '机修一队', '张班长', '施工中', '', ''],
      ['D-04', '将完工', 'C-04', '静设备', '2026-09-11', '2026-09-20', '2026-09-11', '', 9, '机修一队', '张班长', '施工中', 90, ''],
      ['D-06', '待中交', 'C-06', '静设备', '2026-09-11', '2026-09-18', '2026-09-11', '2026-09-18', 7, '机修一队', '张班长', '已完工', 100, ''],
    ],
  });
  const day2 = mk('day2.xlsx', {
    '项目清单': [HDR,
      ['D-01', '推进项目', 'C-01', '静设备', '2026-09-11', '2026-09-23', '2026-09-11', '', 12, '机修一队', '张班长', '施工中', 55, ''],
      ['D-02', '停滞项目', 'C-02', '静设备', '2026-09-11', '2026-09-23', '2026-09-11', '', 12, '机修一队', '张班长', '施工中', 50, ''],
      ['D-03', '比例未填', 'C-03', '静设备', '2026-09-11', '2026-09-23', '2026-09-11', '', 12, '机修一队', '张班长', '施工中', '', ''],
      ['D-04', '将完工', 'C-04', '静设备', '2026-09-11', '2026-09-20', '2026-09-11', '2026-09-20', 9, '机修一队', '张班长', '已完工', 100, ''],
      ['D-05', '新增项目', 'C-05', '静设备', '2026-09-20', '2026-09-28', '', '', 8, '机修一队', '张班长', '未开工', 0, ''],
      ['D-06', '待中交', 'C-06', '静设备', '2026-09-11', '2026-09-18', '2026-09-11', '2026-09-18', 7, '机修一队', '张班长', '已中交', 100, ''],
    ],
  });
  const prevRun = spawnSync(process.execPath, [TA, '--input', day1, '--workshop', '测试车间', '--project', '测试大检修',
    '--date', '2026-09-20', '--start', START, '--end', END, '--out', path.join(work, 'day1-out')], { encoding: 'utf8' });
  eq(JSON.parse(prevRun.stdout.trim().split('\n').pop()).ok, true, '15.1 上一日进度生成成功');
  r = run(day2, ['--prev', path.join(work, 'day1-out', 'progress.json')], 'day2');
  eq(r.summary.ok, true, '15.2 --prev 对比运行成功');
  ok(r.prog.dayChange !== null, '15.3 dayChange 已输出');
  eq(r.prog.dayChange.prevDate, '2026-09-20', '15.4 记录对比基准日期');
  eq(r.prog.dayChange.items.find((x) => x.no === 'D-01').delta, 15, '15.5 本日进度增量计算正确');
  eq(r.prog.dayChange.items.find((x) => x.no === 'D-03').delta, null, '15.6 比例未填报时增量为 null，不按 0 增量');
  ok(r.prog.dayChange.items.find((x) => x.no === 'D-03').remark.includes('未按 0 增量'), '15.7 增量 null 附说明');
  eq(r.prog.dayChange.items.find((x) => x.no === 'D-04').statusChanged, true, '15.8 状态变更被识别');
  eq(r.prog.dayChange.advancedCount, 2, '15.9 本日有进展的项目数');
  ok(r.prog.dayChange.stagnant.some((x) => x.no === 'D-02'), '15.10 本日零进度项目单列');
  ok(!r.prog.dayChange.stagnant.some((x) => x.no === 'D-01'), '15.11 有进展的项目不列入零进度');
  eq(r.prog.dayChange.newProjects.length, 1, '15.12 本日新增项目识别');
  eq(r.prog.dayChange.newProjects[0].no, 'D-05', '15.13 新增项目编号正确');
  ok(r.prog.dayChange.overallDelta !== null, '15.14 总体完成比例增量');
  ok(/## 八、本日进度变化/.test(r.md), '15.15 报告输出本日进度变化一节（第八节）');
  ok(/本日零进度/.test(r.md), '15.16 报告列出本日零进度项目');
  eq(r.prog.dayChange.nodeChanged.length, 1, '15.17 **本日到达中交节点的项目单列**');
  eq(r.prog.dayChange.nodeChanged[0].to, '已中交', '15.18 节点变化记录目标状态');
  ok(/本日到达中交\/开工节点/.test(r.md), '15.19 md 列出本日中交/开工节点');
  r = run(day2, [], 'noprev');
  eq(r.prog.dayChange, null, '15.20 未传 --prev 时 dayChange 为 null');
  ok(/未提供上一日 progress.json/.test(r.md), '15.21 报告说明未做日对比');
  const day2b = mk('day2b.xlsx', {
    '项目清单': [HDR, ['D-01', '推进项目', 'C-01', '静设备', '2026-09-11', '2026-09-23', '2026-09-11', '', 12, '机修一队', '张班长', '施工中', 55, '']],
  });
  r = run(day2b, ['--prev', path.join(work, 'day1-out', 'progress.json')], 'dropped');
  eq(r.prog.dayChange.dropped.length, 4, '15.22 上一日存在本日缺失的项目单列');
  ok(r.prog.warnings.some((w) => w.includes('未按完工或取消处理')), '15.23 缺失项 warning 声明未按完工处理');
});

// ---- 16. 进度表.xlsx 产出
section('B', () => {
  r = run(lag, [...LIN, '--critical', 'L-01'], 'xlsxout');
  const xp = path.join(r.out, '进度表.xlsx');
  ok(fs.existsSync(xp), '16.1 进度表.xlsx 已生成');
  const xb2 = readXlsx(xp);
  const xs = xb2['进度表'];
  ok(Array.isArray(xs) && xs.length > 5, '16.2 进度表可被读回');
  ok(String(xs[0][0]).includes('检修进度表'), '16.3 首行为标题含大检修与统计日期');
  ok(String(xs[1][0]).includes('总体完成比例') && String(xs[1][0]).includes('已中交'), '16.4 第二行为关键指标摘要（含中交/开工）');
  ok(String(xs[2][0]).includes('最终以指挥部判定为准'), '16.5 表内固化免责声明');
  ok(xs[4].includes('完成比例') && xs[4].includes('滞后天数') && xs[4].includes('关键路径') && xs[4].includes('三查四定未关闭') && xs[4].includes('承修单位'), '16.6 表头列齐全（含三查四定、承修单位）');
  ok(xs.some((row) => row.some((c) => String(c).includes('★关键路径'))), '16.7 关键路径项在表中醒目标注');
  ok(xs.some((row) => row.some((c) => String(c).includes('未按 0'))), '16.8 表尾附口径说明');
});

// ---- 17. 别名列头 / 标题行 / 合计行 / 状态同义词（指挥部导出）
section('B', () => {
  const hq = mk('hq.xlsx', {
    '检修项目表': [
      ['某厂大检修项目进度导出'],
      [],
      ['项目号', '检修项目', '设备位号', '所属专业', '计划开工日期', '计划完工日期', '实际开工日期', '计划工期', '承包商', '项目负责人', '项目状态', '形象进度'],
      ['HQ-01', '催化剂卸装', 'R-01', '静设备', '2026-09-11', '2026-09-19', '2026-09-11', 8, '外委队', '王经理', '进行中', 75],
      ['HQ-02', '压缩机检修', 'K-01', '动设备', '2026-09-13', '2026-09-25', '2026-09-13', 12, '外委队', '王经理', '在建', 40],
      ['HQ-03', '高分罐检查', 'V-01', '静设备', '2026-09-10', '2026-09-15', '2026-09-10', 5, '机修一队', '张班长', '已中交', 100],
      ['合计', '', '', '', '', '', '', '', '', '', '', ''],
    ],
  });
  r = run(hq, [], 'hq');
  eq(r.summary.ok, true, '17.1 指挥部导出风格可读');
  eq(r.summary.counts.total, 3, '17.2 合计行被跳过');
  ok(r.prog.warnings.some((w) => w.includes('合计行')), '17.3 合计行 warning');
  eq(r.summary.counts.running, 2, '17.4 「进行中」「在建」识别为施工中');
  eq(r.summary.counts.handedOver, 1, '17.5 **「已中交」识别为独立状态已中交（不再归已完工）**');
  eq(r.summary.counts.done, 0, '17.5b 已完工为 0');
  eq(P('HQ-01')(r.prog).name, '催化剂卸装', '17.6 「检修项目」别名列头识别');
  eq(P('HQ-01')(r.prog).percent, 75, '17.7 「形象进度」别名列头识别');
  eq(P('HQ-01')(r.prog).duration, 8, '17.8 「计划工期」别名列头识别');
  eq(P('HQ-01')(r.prog).contractor, '外委队', '17.9 「承包商」别名列头识别');
});

// ---- 17b. SAP PM 工单导出列名（共享别名：订单号 / 订单描述 / 功能位置 / 基本开始日期 / 基本结束日期 / 主工作中心 / 用户状态）
section('A', () => {
  const sap = mk('sap.xlsx', {
    '订单清单': [
      ['SAP PM 大检修订单清单'],
      [],
      ['订单号', '订单描述', '功能位置', '设备', '基本开始日期', '基本结束日期', '实际开始日期', '实际结束日期', '主工作中心', '用户状态', '完成比例'],
      ['40012001', '常压塔内件更换', 'C-1101', '10023001', '2026-09-11', '2026-09-23', '2026-09-11', '', 'JX01', '施工中', 35],
      ['40012002', '常压炉炉管更换', 'F-1201', '10023002', '2026-09-10', '2026-09-19', '2026-09-10', '', 'JX02', '施工中', 80],
      ['40012003', '脱硫塔内件更换', 'C-1104', '10023003', '2026-09-10', '2026-09-16', '2026-09-10', '2026-09-16', 'JX01', '已中交', 100],
    ],
  });
  r = run(sap, [], 'sap');
  eq(r.summary.ok, true, '17b.1 **SAP PM 订单导出可读（工作表「订单清单」）**');
  eq(r.summary.counts.total, 3, '17b.2 订单号作为项目编号');
  eq(P('40012001')(r.prog).name, '常压塔内件更换', '17b.3 「订单描述」→ 项目名称');
  eq(P('40012001')(r.prog).tag, 'C-1101', '17b.4 「功能位置」→ 位号（共享别名）');
  eq(P('40012001')(r.prog).planStart, '2026-09-11', '17b.5 「基本开始日期」→ 计划开工');
  eq(P('40012001')(r.prog).planEnd, '2026-09-23', '17b.6 「基本结束日期」→ 计划完工');
  eq(P('40012003')(r.prog).actEnd, '2026-09-16', '17b.7 「实际结束日期」→ 实际完工');
  eq(P('40012001')(r.prog).contractor, 'JX01', '17b.8 「主工作中心」→ 承修单位');
  eq(P('40012003')(r.prog).status, '已中交', '17b.9 「用户状态」→ 状态');
  ok(P('40012001')(r.prog).tag !== '10023001', '17b.10 **SAP「设备」编号不被当作位号**');
  eq(r.summary.counts.lagging, 1, '17b.11 SAP 样例按①判出 1 项滞后');
  eq(r.summary.overall.percent, null, '17b.12 无工期列时总体比例为 null（不按 0）');
});

// ---- 18. 项目编号为空跳过、重复保留
section('C', () => {
  const noNo = mk('nono.xlsx', {
    '项目清单': [HDR,
      ['', '无编号', 'C-01', '静设备', '2026-09-12', '2026-09-20', '', '', 8, '机修一队', '张班长', '施工中', 50, ''],
      ['K-01', '项目A', 'C-02', '静设备', '2026-09-12', '2026-09-20', '2026-09-12', '', 8, '机修一队', '张班长', '施工中', 50, ''],
      ['K-01', '项目B', 'C-03', '静设备', '2026-09-12', '2026-09-20', '2026-09-12', '', 8, '机修一队', '张班长', '施工中', 70, ''],
    ],
  });
  r = run(noNo, [], 'nono');
  eq(r.summary.counts.total, 2, '18.1 空项目编号行被跳过');
  ok(r.prog.warnings.some((w) => w.includes('项目编号为空')), '18.2 空编号 warning');
  eq(r.summary.counts.duplicated, 1, '18.3 重复编号计数');
  ok(r.prog.warnings.some((w) => w.includes('重复出现') && w.includes('两条均已保留')), '18.4 重复编号 warning');
  eq(r.summary.overall.percent, 60, '18.5 重复的两条均参与加权');
});

// ---- 19. 日期无法解析 → warning + 按缺失处理，不猜测
section('C', () => {
  const badtime = mk('badtime.xlsx', {
    '项目清单': [HDR,
      ['E-01', '日期非法', 'C-01', '静设备', '下周一', '尽快', '', '', 8, '机修一队', '张班长', '施工中', 50, ''],
    ],
  });
  r = run(badtime, LIN, 'badtime');
  eq(r.summary.ok, true, '19.1 日期无法解析不中断');
  ok(r.prog.warnings.some((w) => w.includes('计划开工「下周一」无法解析')), '19.2 计划开工无法解析 warning');
  ok(r.prog.warnings.some((w) => w.includes('计划完工「尽快」无法解析')), '19.3 计划完工无法解析 warning');
  eq(P('E-01')(r.prog).planStart, null, '19.4 无法解析的日期为 null，未猜测');
  eq(P('E-01')(r.prog).expectedPercent, null, '19.5 无计划节点时不测算应有进度');
  eq(r.summary.counts.lagging, 0, '19.6 无计划节点时不判滞后');
  ok(r.prog.missingPlan.some((x) => x.no === 'E-01'), '19.7 缺计划节点项单列');
});

// ---- 20. 缺表 / 缺列
section('B', () => {
  const nosheet = mk('nosheet.xlsx', { '随便一张表': [['a', 'b'], [1, 2]] });
  r = run(nosheet, [], 'nosheet');
  eq(r.summary.ok, false, '20.1 无「项目清单」工作表时 ok:false');
  eq(r.code, 1, '20.2 退出码为 1');
  ok(/未在输入中找到/.test(r.summary.error), '20.3 错误信息明确');
  const nocol = mk('nocol.xlsx', {
    '项目清单': [['项目编号', '项目名称', '位号'], ['NC-01', '项目1', 'C-01'], ['NC-02', '项目2', 'C-02']],
  });
  r = run(nocol, [], 'nocol');
  eq(r.summary.ok, true, '20.4 缺「状态」「完成比例」列不中断');
  ok(r.prog.warnings.some((w) => w.includes('缺少列') && w.includes('状态')), '20.5 缺列 warning');
  eq(r.summary.counts.unknownStatus, 2, '20.6 缺状态列时全部归入未知状态，不按任何默认');
  eq(r.summary.overall.percent, null, '20.7 无可用样本时总体比例为 null 而非 0');
});

// ---- 21. 参数校验
function runRaw(args) {
  const rr = spawnSync(process.execPath, [TA, ...args], { encoding: 'utf8' });
  const lines = rr.stdout.trim().split('\n');
  try { return { code: rr.status, s: JSON.parse(lines[lines.length - 1]) }; } catch (e) { return { code: rr.status, s: { ok: false, error: 'no-json' } }; }
}
section('B', () => {
  const OKARGS = ['--input', base, '--workshop', '车间', '--project', '大检修', '--date', DATE, '--start', START, '--end', END];
  let x = runRaw(['--input']);
  eq(x.s.ok, false, '21.1 --input 缺值报错');
  ok(/缺少取值/.test(x.s.error), '21.2 缺值错误信息正确');
  eq(x.code, 1, '21.3 退出码为 1');
  x = runRaw(['--input', base, '--workshop', '车间', '--project', '大检修', '--date', '2026-13-45', '--start', START, '--end', END]);
  eq(x.s.ok, false, '21.4 非法 --date 报错');
  x = runRaw(['--input', base, '--workshop', '车间', '--project', '大检修', '--date', DATE, '--start', '不是日期', '--end', END]);
  eq(x.s.ok, false, '21.5 非法 --start 报错');
  x = runRaw(['--input', base, '--workshop', '车间', '--project', '大检修', '--date', DATE, '--start', '2026-10-10', '--end', '2026-09-10']);
  eq(x.s.ok, false, '21.6 --end 早于 --start 报错');
  x = runRaw([...OKARGS, '--未知参数', 'x']);
  eq(x.s.ok, false, '21.7 未知参数报错');
  x = runRaw(['--input', '/不存在的路径.xlsx', '--workshop', '车间', '--project', '大检修', '--date', DATE, '--start', START, '--end', END]);
  eq(x.s.ok, false, '21.8 输入不存在报错');
  x = runRaw(['--input', base, '--workshop', '车间', '--date', DATE, '--start', START, '--end', END]);
  eq(x.s.ok, false, '21.9 缺 --project 报错');
  x = runRaw(['--input', base, '--workshop', '车间', '--project', '大检修', '--date', DATE, '--end', END]);
  eq(x.s.ok, false, '21.10 缺 --start 报错');
  x = runRaw([...OKARGS, '--lag-days', '零']);
  eq(x.s.ok, false, '21.11 --lag-days 非数字报错');
  x = runRaw([...OKARGS, '--prev', '/不存在的进度.json']);
  eq(x.s.ok, false, '21.12 --prev 文件不存在报错');
  const badjson = path.join(work, 'bad.json');
  fs.writeFileSync(badjson, '{不是 json');
  x = runRaw([...OKARGS, '--prev', badjson]);
  eq(x.s.ok, false, '21.13 --prev 文件非法 JSON 报错');
  const wrongjson = path.join(work, 'wrong.json');
  fs.writeFileSync(wrongjson, '{"foo":1}');
  x = runRaw([...OKARGS, '--prev', wrongjson]);
  eq(x.s.ok, false, '21.14 --prev 文件结构不符报错');
  ok(/byProject/.test(x.s.error), '21.15 结构不符错误信息指明缺 byProject');
  x = runRaw([...OKARGS, '--linear-check', 'yes']);
  eq(x.s.ok, false, '21.16 --linear-check 是开关，带取值视为未知参数报错');
  // 默认输出目录为系统临时目录
  x = runRaw(OKARGS);
  ok(x.s.ok === true && x.s.out.startsWith(os.tmpdir()), '21.17 不传 --out 时默认写系统临时目录');
});

// ---- 22. 统计日期落在计划期外只提示不改口径
section('C', () => {
  r = run(base, [], 'inrange');
  ok(!r.prog.warnings.some((w) => w.includes('早于大检修计划开始日期')), '22.1 区间内无越界提示');
  const rOut = spawnSync(process.execPath, [TA, '--input', base, '--workshop', '车间', '--project', '大检修',
    '--date', '2026-10-20', '--start', START, '--end', END, '--out', path.join(work, 'late-out')], { encoding: 'utf8' });
  const sOut = JSON.parse(rOut.stdout.trim().split('\n').pop());
  eq(sOut.ok, true, '22.2 统计日期晚于计划结束仍可运行');
  ok(sOut.warnings.some((w) => w.includes('大检修计划期已过')), '22.3 超出计划期 warning');
  eq(sOut.overall.calendarPercent, 100, '22.4 日历进度封顶 100%');
});

// ---- 23. 产出结构与落盘
section('BVT', () => {
  r = run(lag, [...LIN, '--critical', 'L-01'], 'struct');
  ok(fs.existsSync(path.join(r.out, 'summary.json')), '23.1 summary.json 已写入');
  const sj = JSON.parse(fs.readFileSync(path.join(r.out, 'summary.json'), 'utf8'));
  eq(sj.ok, true, '23.2 summary.json 内容正确');
  ok(fs.existsSync(path.join(r.out, 'progress.json')), '23.3 progress.json 已写入');
  ok(fs.existsSync(path.join(r.out, 'progress.md')), '23.4 progress.md 已写入');
  ok(fs.existsSync(path.join(r.out, '进度表.xlsx')), '23.5 进度表.xlsx 已写入');
  ok(/## 一、总体进度/.test(r.md) && /## 二、项目进度表/.test(r.md) && /## 三、滞后项目/.test(r.md)
    && /## 四、超计划开工日未开工/.test(r.md) && /## 五、开工条件与材料缺口/.test(r.md)
    && /## 六、三查四定问题/.test(r.md) && /## 七、数据矛盾与未判定项/.test(r.md) && /## 八、本日进度变化/.test(r.md)
    && /## 九、进度说明/.test(r.md), '23.6 九节结构齐全');
  ok(/<!-- ANALYSIS_START -->/.test(r.md) && /<!-- ANALYSIS_END -->/.test(r.md), '23.7 分析段占位符存在');
  ok(/## 附：数据提示/.test(r.md) === (r.prog.warnings.length > 0), '23.8 有 warning 时报告附数据提示');
  const keys = ['byProject', 'lagging', 'notStarted', 'readyGap', 'materialGap', 'tcfd', 'overall', 'dayChange', 'inconsistent', 'counts'];
  ok(keys.every((k) => k in r.prog), '23.9 progress.json 含全部约定键（含 tcfd）');
});
section('C', () => {
  ok(!/施工单位 \|/.test(r.md) && /承修单位/.test(r.md), '23.10 md 表头用「承修单位」');
});

// ---- 24. CSV 目录输入
section('B', () => {
  const csvdir = path.join(work, 'csvin');
  fs.mkdirSync(csvdir, { recursive: true });
  fs.writeFileSync(path.join(csvdir, '项目清单.csv'),
    '项目编号,项目名称,位号,专业,计划开工,计划完工,实际开工,实际完工,工期,施工单位,责任人,状态,完成比例,备注\n'
    + 'V-01,清洗项目,C-01,静设备,2026-09-12,2026-09-20,2026-09-12,,8,机修一队,张班长,施工中,60,\n', 'utf8');
  r = run(csvdir, [], 'csvdir');
  eq(r.summary.ok, true, '24.1 CSV 目录可读');
  eq(r.summary.counts.total, 1, '24.2 CSV 记录数正确');
  eq(r.summary.overall.percent, 60, '24.3 CSV 加权计算正确');
});

// ---- W. 车间范围核对（D007）：项目清单全套，其余四张表各一条混合剔除
{
  const pj = (no, ws) => [no, `项目${no}`, `P-${no}`, '动设备', '2026-09-12', '2026-09-20', '2026-09-12', '', 8, '机修一队', '张班长', '施工中', 60, '', ws];
  const pjNo = (no) => pj(no).slice(0, 14);
  const wsOf = (x, i = 0) => ((x.prog && x.prog.meta && x.prog.meta.workshopScope) || [])[i] || {};
  const nos = (x) => ((x.prog && x.prog.byProject) || []).map((p) => p.no);
  let w;
  section('A', () => {
    w = run(mk('ws-mix.xlsx', { '项目清单': [[...HDR, '车间'], pj('W-01', '测试车间'), pj('W-02', '加氢车间'), pj('W-03', ''), pj('W-04', '测试')] }), [], 'ws-mix');
    eq(w.prog && w.prog.counts.total, 3, 'W1 两车间混合：只跟踪本车间与车间为空的项目（3 个）');
    ok(w.prog && !nos(w).includes('W-02') && nos(w).includes('W-01') && nos(w).includes('W-04'), 'W2 加氢车间的 W-02 不进进度表');
    ok(w.prog && w.prog.warnings.some((x) => /剔除其他车间 1 行/.test(x) && /加氢车间 1 行/.test(x)), 'W3 warning 写明剔除行数与车间名');
    ok(wsOf(w).status === 'checked' && wsOf(w).droppedRows === 1 && (wsOf(w).dropped || {})['加氢车间'] === 1, 'W4 meta.workshopScope 记录剔除情况');
    ok(wsOf(w).blank === 1 && nos(w).includes('W-03'), 'W5 车间列为空的行按本车间保留');
    ok(w.md && /车间范围：已按车间列核对「测试车间」，剔除其他车间的行/.test(w.md), 'W6 md 口径写明按车间核对');
    w = run(mk('ws-mis.xlsx', { '项目清单': [[...HDR, '车间'], pj('W-01', '加氢车间'), pj('W-02', '焦化车间')] }), [], 'ws-mis');
    ok(w.prog && w.prog.counts.total === 2 && wsOf(w).status === 'mismatch', 'W7 车间列全不一致：不筛，status=mismatch');
    ok(w.prog && w.prog.warnings.some((x) => /^【注意】/.test(x)), 'W8 车间列全不一致 warning 以【注意】开头');
    const at = w.md ? w.md.indexOf('的车间列取值与 --workshop「测试车间」不一致') : -1;
    ok(at > 0 && at < w.md.indexOf('## 一'), 'W9 md 开头（第一节之前）有【注意】提示');
  });
  section('B', () => {
    w = run(mk('ws-nocol.xlsx', { '项目清单': [HDR, pjNo('W-01'), pjNo('W-02')] }), [], 'ws-nocol');
    ok(wsOf(w).status === 'noColumn' && w.prog.counts.total === 2 && /输入未含车间列，车间范围以取数条件为准/.test(w.md), 'W10 无车间列：不筛，md 口径说明以取数条件为准');
    w = run(mk('ws-plant.xlsx', { '项目清单': [[...HDR, '维护工厂'], pj('W-01', '1100'), pj('W-02', '1200')] }), [], 'ws-plant');
    ok(wsOf(w).status === 'noColumn' && w.prog.counts.total === 2, 'W11 「维护工厂」列不当车间列（noColumn，不筛）');
    // 材料到货 / 人员到位 / 开工条件 / 三查四定：各自带车间列时也核对
    w = run(mk('ws-sub.xlsx', {
      '项目清单': [HDR, pjNo('W-01')],
      '材料到货': [['项目编号', '材料名称', '需求数量', '到货数量', '到货状态', '车间'], ['W-01', '机封', 1, 0, '未到货', '测试车间'], ['W-01', '垫片', 1, 0, '未到货', '加氢车间']],
      '人员到位': [['项目编号', '施工单位', '计划人数', '到位人数', '车间'], ['W-01', '机修一队', 5, 3, '测试车间'], ['W-01', '机修二队', 5, 1, '加氢车间']],
      '开工条件': [['项目编号', '条件项', '是否具备', '责任单位', '车间'], ['W-01', '设备交出', '否', '测试车间', '测试车间'], ['W-01', '盲板确认', '否', '加氢车间', '加氢车间']],
      '三查四定': [['问题编号', '项目编号', '问题描述', '整改状态', '车间'], ['Q-1', 'W-01', '螺栓未紧固', '未整改', '测试车间'], ['Q-2', 'W-01', '保温未恢复', '未整改', '加氢车间']],
    }), [], 'ws-sub');
    const sc = (name) => ((w.prog && w.prog.meta && w.prog.meta.workshopScope) || []).find((x) => x.sheet === `ws-sub.xlsx/${name}`) || {};
    ok(w.prog && w.prog.materialGap.length === 1 && w.prog.materialGap[0].material === '机封' && sc('材料到货').droppedRows === 1, 'W12 材料到货混合：剔除其他车间的材料行');
    ok(w.prog && w.prog.manpower.length === 1 && w.prog.manpower[0].contractor === '机修一队' && sc('人员到位').droppedRows === 1, 'W13 人员到位混合：剔除其他车间的人员行');
    ok(w.prog && w.prog.readyGap.length === 1 && w.prog.readyGap[0].item === '设备交出' && sc('开工条件').droppedRows === 1, 'W14 开工条件混合：剔除其他车间的条件行');
    ok(w.prog && w.prog.tcfd.items.length === 1 && w.prog.tcfd.items[0].id === 'Q-1' && sc('三查四定').droppedRows === 1, 'W15 三查四定混合：剔除其他车间的问题行');
    ok(sc('项目清单').status === 'noColumn' && w.md && /「ws-sub\.xlsx\/项目清单」未含车间列/.test(w.md), 'W16 项目清单无车间列、子表有车间列时口径分表写明');
    w = run(mk('ws-ssc.xlsx', { '项目清单': [[...HDR, '所属车间'], pj('W-01', '测试车间'), pj('W-02', '加氢车间')] }), [], 'ws-ssc');
    ok(wsOf(w).status === 'checked' && wsOf(w).column === '所属车间' && w.prog.counts.total === 1, 'W17 「所属车间」列同样核对');
  });
}

// ---- 25. 文档口径（出现与不出现两个方向）
section('C', () => {
  const skill = fs.readFileSync(path.join(ROOT, 'SKILL.md'), 'utf8');
  ok(/大修进度日报/.test(skill), '25.1 SKILL.md 触发词用「大修进度日报」');
  ok(!/"大修日报"/.test(skill), '25.2 SKILL.md 不再用裸「大修日报」抢设备日报触发');
  ok(/equipment-daily-report/.test(skill) && /work-order-tracker/.test(skill), '25.3 description 互指设备日报与工单跟踪');
  ok(/三查四定/.test(skill) && /已中交/.test(skill) && /已开工/.test(skill), '25.4 SKILL.md 写明三查四定与中交/开工节点');
  ok(/--linear-check/.test(skill), '25.5 SKILL.md 说明 --linear-check 可选');
  ok(/九节|九个部分/.test(skill), '25.6 SKILL.md 预期结果章节数与脚本一致（九节）');
  ok(/归口|指挥部/.test(skill), '25.7 SKILL.md 写明归口');
  ok(/agent_created: true/.test(skill) && /allowed-tools:/.test(skill), '25.8 frontmatter 保留 agent_created 与 allowed-tools');
  ok(/SAP/.test(skill) && /功能位置|订单号/.test(skill), '25.9 SKILL.md 说明 SAP 工单导出列名');
  const rules = fs.readFileSync(path.join(ROOT, 'references', 'turnaround-rules.md'), 'utf8');
  ok(!/escalation-report/.test(rules) && !/equipment-monthly-report/.test(rules), '25.10 **turnaround-rules.md 不再引用不存在的技能**');
  ok(/三查四定/.test(rules) && /已中交/.test(rules) && /--linear-check/.test(rules), '25.11 turnaround-rules.md 写三查四定、中交、线性核对口径');
  ok(/炼化企业设备管理技术规定|中国石化设备管理规定/.test(rules), '25.12 turnaround-rules.md 写制度引用');
  const spec = fs.readFileSync(path.join(ROOT, 'references', 'input-spec.md'), 'utf8');
  ok(/三查四定/.test(spec) && /订单号/.test(spec) && /功能位置/.test(spec) && /已中交/.test(spec), '25.13 input-spec 含三查四定表、SAP 列名与七态');
  const chk = fs.readFileSync(path.join(ROOT, 'references', 'checklist.md'), 'utf8');
  ok(!/escalation-report/.test(chk), '25.14 checklist 不再引用不存在的技能');
  const readme = fs.readFileSync(path.join(ROOT, 'scripts', 'README.md'), 'utf8');
  ok(/tmpdir/.test(readme) && /--linear-check/.test(readme) && /三查四定/.test(readme), '25.15 scripts/README 记录默认输出目录、--linear-check 与三查四定');
});

// ---- 输出
console.log(`\n${'='.repeat(56)}`);
console.log(`turnaround-workshop-tracker 自测：${pass} 通过，${fail} 失败`);
console.log(`用例级别 ${LEVELS[RUN_LEVEL]}：BVT ${byLevel.BVT}，A ${byLevel.A}，B ${byLevel.B}，C ${byLevel.C}`);
if (failures.length) { console.log('\n失败项：'); failures.forEach((f) => console.log('  ✗ ' + f)); }
console.log('='.repeat(56));
try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
