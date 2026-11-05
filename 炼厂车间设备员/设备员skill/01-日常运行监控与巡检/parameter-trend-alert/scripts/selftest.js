#!/usr/bin/env node
'use strict';
/** 自测：断言 trend.js 行为。用法：node scripts/selftest.js */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { writeXlsx } = require('./lib/xlsx-lite');

const TR = path.join(__dirname, 'trend.js');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pta-selftest-'));
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
const eq = (a, e, n) => ok(a === e, `${n}（期望 ${JSON.stringify(e)}，实际 ${JSON.stringify(a)}）`);
const near = (a, e, tol, n) => ok(typeof a === 'number' && Math.abs(a - e) <= tol, `${n}（期望 ≈${e}±${tol}，实际 ${JSON.stringify(a)}）`);

function run(input, extra = [], tag) {
  const out = path.join(work, tag + '-out');
  const r = spawnSync(process.execPath, [TR, '--input', input, '--workshop', '测试车间', '--date', DATE, '--out', out, ...extra], { encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  let s; try { s = JSON.parse(lines[lines.length - 1]); } catch (e) { s = { ok: false, error: 'no-json:' + r.stdout + r.stderr }; }
  let j = null, md = null;
  if (fs.existsSync(path.join(out, 'trends.json'))) j = JSON.parse(fs.readFileSync(path.join(out, 'trends.json'), 'utf8'));
  if (fs.existsSync(path.join(out, 'alert.md'))) md = fs.readFileSync(path.join(out, 'alert.md'), 'utf8');
  return { code: r.status, s, j, md, out };
}
function raw(args) {
  const x = spawnSync(process.execPath, [TR, ...args], { encoding: 'utf8' });
  const l = x.stdout.trim().split('\n');
  try { return { code: x.status, s: JSON.parse(l[l.length - 1]) }; } catch (e) { return { code: x.status, s: { ok: false } }; }
}
const mk = (n, b) => { const p = path.join(work, n); writeXlsx(p, b); return p; };
const HDR = ['设备位号', '设备名称', '参数名', '采集时间', '数值', '单位'];
const find = (j, tag, param) => j.items.find((x) => x.tag === tag && x.param === param);
let r;

// ============ A. 基础趋势计算 ============
// P-01 振动：每 2 天 +1.0，共 5 期（4.0→8.0），上限 12 → 斜率 0.5/天，到限 8 天
const BASE = mk('base.xlsx', {
  '参数记录': [HDR,
    ['P-01', '泵1', '振动速度', '2026-09-01 08:00', 4.0, 'mm/s'],
    ['P-01', '泵1', '振动速度', '2026-09-03 08:00', 5.0, 'mm/s'],
    ['P-01', '泵1', '振动速度', '2026-09-05 08:00', 6.0, 'mm/s'],
    ['P-01', '泵1', '振动速度', '2026-09-07 08:00', 7.0, 'mm/s'],
    ['P-01', '泵1', '振动速度', '2026-09-09 08:00', 8.0, 'mm/s'],
    ['P-02', '泵2', '轴承温度', '2026-09-01 08:00', 60, '℃'],
    ['P-02', '泵2', '轴承温度', '2026-09-03 08:00', 60, '℃'],
    ['P-02', '泵2', '轴承温度', '2026-09-05 08:00', 60, '℃'],
    ['P-02', '泵2', '轴承温度', '2026-09-07 08:00', 60, '℃'],
    ['P-03', '泵3', '轴承温度', '2026-09-01 08:00', 70, '℃'],
    ['P-03', '泵3', '轴承温度', '2026-09-03 08:00', 74, '℃'],
    ['P-03', '泵3', '轴承温度', '2026-09-05 08:00', 78, '℃'],
  ],
  '报警限值': [['设备位号', '参数名', '报警上限', '报警下限', '单位'],
    ['P-01', '振动速度', 12, '', 'mm/s'],
    ['P-02', '轴承温度', 90, '', '℃'],
    ['P-03', '轴承温度', 75, '', '℃'],
  ],
});
section('BVT', () => {
  r = run(BASE, [], 'base');
  eq(r.s.ok, true, 'A1 基础运行成功');
  eq(r.s.counts.series, 3, 'A2 序列数');
  const a01 = find(r.j, 'P-01', '振动速度');
  near(a01.slope, 0.5, 1e-6, 'A3 斜率 0.5/天');
  near(a01.r2, 1, 1e-6, 'A4 完美线性 R²=1');
  near(a01.changeRate, 100, 0.01, 'A5 变化率（4→8 为 +100%）');
  near(a01.daysToLimit, 8, 0.05, 'A6 预计到限天数（(12-8)/0.5=8）');
  eq(a01.etaDate, '2026-09-17', 'A7 预计到限日期');
  eq(a01.category, 'deteriorating', 'A8 归入趋势恶化');
  eq(find(r.j, 'P-02', '轴承温度').category, 'stable', 'A9 平直序列归为稳定');
  eq(find(r.j, 'P-03', '轴承温度').category, 'overLimit', 'A10 最新值 78>75 判已越限');
  near(find(r.j, 'P-03', '轴承温度').exceedBy, 3, 1e-6, 'A11 超限幅度');
  eq(r.s.counts.overLimit, 1, 'A12 越限计数');
  eq(r.s.counts.deteriorating, 1, 'A13 恶化计数');
  eq(r.s.counts.stable, 1, 'A14 稳定计数');
  ok(/## 一、预警概览/.test(r.md) && /## 二、已越限/.test(r.md) && /## 三、趋势恶化/.test(r.md)
    && /## 四、趋势稳定/.test(r.md) && /## 五、数据不足说明/.test(r.md) && /## 六、趋势研判与建议/.test(r.md), 'A15 六节齐全');
  ok(/<!-- ANALYSIS_START -->/.test(r.md) && /<!-- ANALYSIS_END -->/.test(r.md), 'A16 分析段占位符');
});

// ============ B. 期数不足 3 期（最关键） ============
section('A', () => {
  const TWO = mk('two.xlsx', {
    '参数记录': [HDR,
      ['P-01', '泵1', '振动速度', '2026-09-01 08:00', 3.0, 'mm/s'],
      ['P-01', '泵1', '振动速度', '2026-09-19 08:00', 8.5, 'mm/s'],
      ['P-02', '泵2', '振动速度', '2026-09-01 08:00', 3.0, 'mm/s'],
    ],
    '报警限值': [['设备位号', '参数名', '报警上限', '单位'],
      ['P-01', '振动速度', 9.0, 'mm/s'], ['P-02', '振动速度', 9.0, 'mm/s']],
  });
  r = run(TWO, [], 'two');
  eq(r.s.counts.insufficientData, 2, 'B1 两条序列均判数据不足');
  eq(r.s.counts.deteriorating, 0, 'B2 不足 3 期不进恶化清单');
  const b01 = find(r.j, 'P-01', '振动速度');
  eq(b01.category, 'insufficientData', 'B3 2 期归入 insufficientData');
  eq(b01.slope, null, 'B4 **绝不用两点连线当趋势**：斜率为 null');
  eq(b01.r2, null, 'B5 R² 为 null');
  eq(b01.changeRate, null, 'B6 变化率不给（避免被当成趋势）');
  eq(b01.daysToLimit, null, 'B7 **绝不预测到限时间**');
  eq(b01.etaDate, null, 'B8 无预计到限日期');
  ok(b01.note.includes('两点连线不构成趋势'), 'B9 说明写明两点不构成趋势');
  eq(find(r.j, 'P-02', '振动速度').periodsUsed, 1, 'B10 单点也归数据不足');
  ok(r.j.warnings.some((w) => w.includes('不足 3 期') && w.includes('未预测到限时间')), 'B11 warning 明确不预测');
  ok(/## 五、数据不足说明/.test(r.md) && /两点连线不构成趋势/.test(r.md), 'B12 md 单列数据不足');
  ok(!/预计到限/.test((r.md.match(/## 五、数据不足说明[\s\S]*?## 六/) || [''])[0]), 'B13 数据不足节不出现到限预测值');

  // 期数不足但已越限：越限是单点事实，仍应呈现
  const TWOOVER = mk('twoover.xlsx', {
    '参数记录': [HDR,
      ['P-01', '泵1', '轴承温度', '2026-09-01 08:00', 70, '℃'],
      ['P-01', '泵1', '轴承温度', '2026-09-19 08:00', 82, '℃']],
    '报警限值': [['设备位号', '参数名', '报警上限', '单位'], ['P-01', '轴承温度', 75, '℃']],
  });
  r = run(TWOOVER, [], 'twoover');
  eq(r.s.counts.overLimit, 1, 'B14 期数不足但已越限仍入越限清单');
  eq(r.s.counts.insufficientData, 1, 'B15 同时单列数据不足');
  eq(r.j.overLimit[0].slope, null, 'B16 越限项仍不给斜率');
  eq(r.j.overLimit[0].daysToLimit, null, 'B17 越限项不给到限预测');

  // 恰好 3 期 → 可以算
  r = run(BASE, [], 'three');
  eq(find(r.j, 'P-03', '轴承温度').periodsUsed, 3, 'B18 恰好 3 期');
  ok(find(r.j, 'P-03', '轴承温度').slope !== null, 'B19 3 期可计算斜率');
});

// ============ C. 数值无法解析 → null 不是 0（核心） ============
section('A', () => {
  const BADV = mk('badv.xlsx', {
    '参数记录': [HDR,
      ['P-01', '泵1', '振动速度', '2026-09-01 08:00', 4.0, 'mm/s'],
      ['P-01', '泵1', '振动速度', '2026-09-03 08:00', '未记录', 'mm/s'],
      ['P-01', '泵1', '振动速度', '2026-09-05 08:00', 6.0, 'mm/s'],
      ['P-01', '泵1', '振动速度', '2026-09-07 08:00', 7.0, 'mm/s'],
      ['P-01', '泵1', '振动速度', '2026-09-09 08:00', 8.0, 'mm/s']],
    '报警限值': [['设备位号', '参数名', '报警上限', '单位'], ['P-01', '振动速度', 12, 'mm/s']],
  });
  r = run(BADV, [], 'badv');
  const c01 = find(r.j, 'P-01', '振动速度');
  eq(c01.periodsUsed, 4, 'C1 不可解析点不计入有效期数');
  eq(c01.invalidPoints.length, 1, 'C2 不可解析点单列');
  eq(c01.invalidPoints[0].value, null, 'C3 该点值为 null');
  ok(c01.invalidPoints[0].reason.includes('未按 0 计入'), 'C4 说明写明未按 0');
  ok(!c01.points.some((p) => p.value === 0), 'C5 **绝不按 0 计入趋势计算**');
  near(c01.slope, 0.5, 1e-6, 'C6 斜率与去掉该点后一致（未被 0 拉偏）');
  ok(r.j.warnings.some((w) => w.includes('无法解析为数字')), 'C7 解析失败 warning');
  eq(r.s.counts.invalidPoints, 1, 'C8 概览计数');
  ok(/数据质量明细/.test(r.md) && /未按 0 计入/.test(r.md), 'C9 md 呈现数据质量明细');

  // 不可解析点导致有效期数 < 3 → 退回数据不足
  const BADV2 = mk('badv2.xlsx', {
    '参数记录': [HDR,
      ['P-01', '泵1', '振动速度', '2026-09-01 08:00', 4.0, 'mm/s'],
      ['P-01', '泵1', '振动速度', '2026-09-03 08:00', '故障', 'mm/s'],
      ['P-01', '泵1', '振动速度', '2026-09-05 08:00', '故障', 'mm/s'],
      ['P-01', '泵1', '振动速度', '2026-09-07 08:00', 7.0, 'mm/s']],
  });
  r = run(BADV2, [], 'badv2');
  eq(r.s.counts.insufficientData, 1, 'C10 剔除不可解析点后不足 3 期');
  eq(find(r.j, 'P-01', '振动速度').slope, null, 'C11 该情况不算斜率');
});

// ============ D. 未提供限值表（核心） ============
section('A', () => {
  const NOLIM = mk('nolim.xlsx', {
    '参数记录': [HDR,
      ['P-01', '泵1', '振动速度', '2026-09-01 08:00', 4.0, 'mm/s'],
      ['P-01', '泵1', '振动速度', '2026-09-03 08:00', 5.0, 'mm/s'],
      ['P-01', '泵1', '振动速度', '2026-09-05 08:00', 6.0, 'mm/s'],
      ['P-01', '泵1', '振动速度', '2026-09-07 08:00', 7.0, 'mm/s']],
  });
  r = run(NOLIM, [], 'nolim');
  eq(r.s.ok, true, 'D1 无限值表可运行');
  eq(r.s.counts.limitsProvided, false, 'D2 标记未提供限值');
  eq(r.s.counts.overLimit, 0, 'D3 不判越限');
  const d01 = find(r.j, 'P-01', '振动速度');
  eq(d01.limitState, null, 'D4 越限状态为 null 不是 within');
  eq(d01.limitProvided, false, 'D5 该项限值未提供');
  eq(d01.daysToLimit, null, 'D6 无限值不预测到限时间');
  near(d01.slope, 0.5, 1e-6, 'D7 趋势照算');
  ok(r.j.warnings.some((w) => w.includes('未提供') && w.includes('不判越限')), 'D8 warning 说明');
  ok(/未提供「报警限值」工作表，不做越限判定/.test(r.md), 'D9 md 说明');
  ok(/—（未提供限值表）/.test(r.md), 'D10 概览显示 — 不是 0');

  // 有限值表但个别参数查不到限值
  const PARTLIM = mk('partlim.xlsx', {
    '参数记录': [HDR,
      ['P-01', '泵1', '振动速度', '2026-09-01 08:00', 4.0, 'mm/s'],
      ['P-01', '泵1', '振动速度', '2026-09-03 08:00', 5.0, 'mm/s'],
      ['P-01', '泵1', '振动速度', '2026-09-05 08:00', 6.0, 'mm/s'],
      ['P-02', '泵2', '振动速度', '2026-09-01 08:00', 4.0, 'mm/s'],
      ['P-02', '泵2', '振动速度', '2026-09-03 08:00', 5.0, 'mm/s'],
      ['P-02', '泵2', '振动速度', '2026-09-05 08:00', 6.0, 'mm/s']],
    '报警限值': [['设备位号', '参数名', '报警上限', '单位'], ['P-01', '振动速度', 12, 'mm/s']],
  });
  r = run(PARTLIM, [], 'partlim');
  eq(find(r.j, 'P-02', '振动速度').limitProvided, false, 'D11 查不到限值的项标记未提供');
  eq(find(r.j, 'P-02', '振动速度').daysToLimit, null, 'D12 查不到限值不预测');
  ok(r.j.warnings.some((w) => w.includes('查不到限值')), 'D13 查不到限值 warning');

  // 限值上下限均无法解析 → 该项不判越限
  const BADLIM = mk('badlim.xlsx', {
    '参数记录': [HDR,
      ['P-01', '泵1', '振动速度', '2026-09-01 08:00', 4.0, 'mm/s'],
      ['P-01', '泵1', '振动速度', '2026-09-03 08:00', 5.0, 'mm/s'],
      ['P-01', '泵1', '振动速度', '2026-09-05 08:00', 6.0, 'mm/s']],
    '报警限值': [['设备位号', '参数名', '报警上限', '报警下限', '单位'], ['P-01', '振动速度', '视情况', '', 'mm/s']],
  });
  r = run(BADLIM, [], 'badlim');
  eq(r.s.counts.overLimit, 0, 'D14 限值不可解析不判越限');
  ok(r.j.warnings.some((w) => w.includes('不判越限')), 'D15 warning 说明不判越限');
});

// ============ E. 方向不对不预测（核心） ============
section('A', () => {
  const DOWN = mk('down.xlsx', {
    '参数记录': [HDR,
      ['P-01', '泵1', '出口压力', '2026-09-01 08:00', 1.60, 'MPa'],
      ['P-01', '泵1', '出口压力', '2026-09-03 08:00', 1.55, 'MPa'],
      ['P-01', '泵1', '出口压力', '2026-09-05 08:00', 1.50, 'MPa'],
      ['P-01', '泵1', '出口压力', '2026-09-07 08:00', 1.45, 'MPa']],
    '报警限值': [['设备位号', '参数名', '报警上限', '报警下限', '单位'], ['P-01', '出口压力', 2.0, '', 'MPa']],
  });
  r = run(DOWN, [], 'down');
  const e01 = find(r.j, 'P-01', '出口压力');
  ok(e01.slope < 0, 'E1 斜率为负');
  eq(e01.daysToLimit, null, 'E2 **下降趋势 + 仅上限 → 不预测到限时间**');
  eq(e01.etaDate, null, 'E3 无到限日期');
  ok(e01.etaNote && e01.etaNote.includes('不预测'), 'E4 说明不预测的原因');
  eq(e01.category, 'stable', 'E5 方向不对不进恶化清单');

  // 下降 + 有下限 → 预测到下限
  const DOWNLO = mk('downlo.xlsx', {
    '参数记录': [HDR,
      ['P-01', '泵1', '出口压力', '2026-09-01 08:00', 1.60, 'MPa'],
      ['P-01', '泵1', '出口压力', '2026-09-03 08:00', 1.50, 'MPa'],
      ['P-01', '泵1', '出口压力', '2026-09-05 08:00', 1.40, 'MPa'],
      ['P-01', '泵1', '出口压力', '2026-09-07 08:00', 1.30, 'MPa']],
    '报警限值': [['设备位号', '参数名', '报警上限', '报警下限', '单位'], ['P-01', '出口压力', 2.0, 1.0, 'MPa']],
  });
  r = run(DOWNLO, [], 'downlo');
  const e02 = find(r.j, 'P-01', '出口压力');
  near(e02.daysToLimit, 6, 0.05, 'E6 下降 + 下限 → 到限 6 天');
  eq(e02.etaLimitKind, '低报(L)', 'E7 到限方向为低报(L)');
  eq(e02.category, 'deteriorating', 'E8 归入恶化');

  // 上升 + 无上限 → 不预测
  const UPNOHI = mk('upnohi.xlsx', {
    '参数记录': [HDR,
      ['P-01', '泵1', '流量', '2026-09-01 08:00', 100, 't/h'],
      ['P-01', '泵1', '流量', '2026-09-03 08:00', 110, 't/h'],
      ['P-01', '泵1', '流量', '2026-09-05 08:00', 120, 't/h']],
    '报警限值': [['设备位号', '参数名', '报警上限', '报警下限', '单位'], ['P-01', '流量', '', 50, 't/h']],
  });
  r = run(UPNOHI, [], 'upnohi');
  eq(find(r.j, 'P-01', '流量').daysToLimit, null, 'E9 上升但只设下限 → 不预测');
  ok(find(r.j, 'P-01', '流量').etaNote.includes('未设上限'), 'E10 说明未设上限');

  // 已越限 → 不再预测到限时间
  r = run(BASE, [], 'overeta');
  eq(find(r.j, 'P-03', '轴承温度').daysToLimit, null, 'E11 已越限不再预测到限时间');
  ok(find(r.j, 'P-03', '轴承温度').etaNote.includes('已越高报(H)'), 'E12 说明已越高报');
});

// ============ F. 采集时间重复不去重（核心） ============
section('A', () => {
  const DUP = mk('dup.xlsx', {
    '参数记录': [HDR,
      ['P-01', '泵1', '振动速度', '2026-09-01 08:00', 4.0, 'mm/s'],
      ['P-01', '泵1', '振动速度', '2026-09-03 08:00', 5.0, 'mm/s'],
      ['P-01', '泵1', '振动速度', '2026-09-03 08:00', 5.2, 'mm/s'],
      ['P-01', '泵1', '振动速度', '2026-09-05 08:00', 6.0, 'mm/s']],
  });
  r = run(DUP, [], 'dup');
  eq(r.s.counts.duplicateTimes, 1, 'F1 检出采集时间重复');
  const f01 = find(r.j, 'P-01', '振动速度');
  eq(f01.periodsUsed, 4, 'F2 **重复点原样保留，未自动去重**');
  eq(f01.duplicateTimes[0].rows.length, 2, 'F3 重复行号成对记录');
  ok(r.j.warnings.some((w) => w.includes('采集时间相同') && w.includes('未去重')), 'F4 warning 明确未去重');
  ok(/采集时间重复，已原样保留未去重/.test(r.md), 'F5 md 说明未去重');
});

// 全部时间相同 → 跨度为 0，不算趋势
section('C', () => {
  const SAMET = mk('samet.xlsx', {
    '参数记录': [HDR,
      ['P-01', '泵1', '振动速度', '2026-09-01 08:00', 4.0, 'mm/s'],
      ['P-01', '泵1', '振动速度', '2026-09-01 08:00', 5.0, 'mm/s'],
      ['P-01', '泵1', '振动速度', '2026-09-01 08:00', 6.0, 'mm/s']],
  });
  r = run(SAMET, [], 'samet');
  eq(find(r.j, 'P-01', '振动速度').slope, null, 'F6 时间跨度为 0 时斜率不猜');
  eq(r.s.counts.insufficientData, 1, 'F7 跨度为 0 归入数据不足');
});

// ============ G. 置信提示与 R² 分档 ============
const NOISY = mk('noisy.xlsx', {
  '参数记录': [HDR,
    ['P-01', '泵1', '振动速度', '2026-09-01 08:00', 4.0, 'mm/s'],
    ['P-01', '泵1', '振动速度', '2026-09-03 08:00', 9.0, 'mm/s'],
    ['P-01', '泵1', '振动速度', '2026-09-05 08:00', 4.2, 'mm/s'],
    ['P-01', '泵1', '振动速度', '2026-09-07 08:00', 8.5, 'mm/s'],
    ['P-01', '泵1', '振动速度', '2026-09-09 08:00', 4.5, 'mm/s'],
    ['P-01', '泵1', '振动速度', '2026-09-11 08:00', 8.8, 'mm/s']],
  '报警限值': [['设备位号', '参数名', '报警上限', '单位'], ['P-01', '振动速度', 12, 'mm/s']],
});
section('A', () => {
  r = run(NOISY, [], 'noisy');
  const g01 = find(r.j, 'P-01', '振动速度');
  ok(g01.r2 !== null && g01.r2 < 0.5, 'G1 离散数据 R² 低');
  eq(g01.confidence, 'low', 'G2 低 R² → 低置信');
  ok(g01.confidenceText.includes('数据离散，趋势不明显'), 'G3 置信提示文案');
  eq(g01.daysToLimit, null, 'G4 R² 过低不给到限日期（斜率是噪声）');
  eq(g01.category, 'stable', 'G5 离散数据不误报为恶化');
});
const MID = mk('mid.xlsx', {
  '参数记录': [HDR,
    ['P-01', '泵1', '振动速度', '2026-09-01 08:00', 4.0, 'mm/s'],
    ['P-01', '泵1', '振动速度', '2026-09-03 08:00', 4.4, 'mm/s'],
    ['P-01', '泵1', '振动速度', '2026-09-05 08:00', 5.6, 'mm/s'],
    ['P-01', '泵1', '振动速度', '2026-09-07 08:00', 5.0, 'mm/s'],
    ['P-01', '泵1', '振动速度', '2026-09-09 08:00', 6.4, 'mm/s'],
    ['P-01', '泵1', '振动速度', '2026-09-11 08:00', 5.9, 'mm/s']],
  '报警限值': [['设备位号', '参数名', '报警上限', '单位'], ['P-01', '振动速度', 12, 'mm/s']],
});
section('B', () => {
  r = run(BASE, [], 'conf');
  eq(find(r.j, 'P-01', '振动速度').confidence, 'high', 'G6 完美线性 5 期 → 高置信');
  ok(find(r.j, 'P-01', '振动速度').confidenceText.includes('趋势明显'), 'G7 趋势明显文案');
  const g03 = find(r.j, 'P-03', '轴承温度');
  ok(g03.confidenceText.includes('期数偏少'), 'G8 3 期时提示期数偏少');
  ok(g03.confidence !== 'high', 'G9 期数偏少时置信降档');
  ok(r.j.meta.confidenceRule.includes('R²'), 'G10 meta 写明分档规则');

  // 中等 R²
  r = run(MID, [], 'mid');
  const g04 = find(r.j, 'P-01', '振动速度');
  ok(g04.r2 >= 0.5 && g04.r2 < 0.8, 'G11 中等 R² 落在中档');
  eq(g04.confidence, 'medium', 'G12 中档置信');
  ok(g04.confidenceText.includes('趋势一般'), 'G13 趋势一般文案');
});

// ============ H. 预测口径说明行（核心） ============
section('A', () => {
  r = run(BASE, [], 'stmt');
  ok(/不是设备故障预测/.test(r.md), 'H1 报告保留「不是设备故障预测」说明行');
  ok(/不代表设备将在该时间损坏/.test(r.md), 'H2 说明行含不代表损坏时间');
  ok(/线性外推/.test(r.md), 'H3 说明行写明线性外推');
  ok(r.j.meta.statement.includes('线性外推') && r.j.meta.statement.includes('不是设备故障预测'), 'H4 JSON 含声明');
  ok((r.md.match(/不是设备故障预测/g) || []).length >= 2, 'H5 恶化清单处与文末均带说明');
});

// ============ I. 回溯期数与范围过滤 ============
section('B', () => {
  r = run(BASE, ['--periods', '3'], 'periods');
  eq(find(r.j, 'P-01', '振动速度').periodsUsed, 3, 'I1 --periods 限制窗口');
  eq(find(r.j, 'P-01', '振动速度').periodsTotal, 5, 'I2 记录总期数保留');
  r = run(BASE, ['--equipment', 'P-01'], 'eq');
  eq(r.s.counts.series, 1, 'I3 按位号过滤');
  r = run(BASE, ['--param', '轴承温度'], 'param');
  eq(r.s.counts.series, 2, 'I4 按参数名过滤');
  eq(raw(['--input', BASE, '--workshop', 'X', '--date', DATE, '--equipment', 'P-99']).s.ok, false, 'I5 范围内无记录报错');
  r = run(BASE, ['--threshold', '0.3'], 'thr');
  ok(r.s.counts.deteriorating >= 1, 'I6 斜率阈值生效');
});

// ============ J. 参数校验 ============
section('B', () => {
  eq(raw([]).s.ok, false, 'J1 无参数报错');
  eq(raw(['--input']).s.ok, false, 'J2 缺值报错');
  ok(/缺少取值/.test(raw(['--input']).s.error), 'J3 缺值信息正确');
  eq(raw(['--input', BASE]).s.ok, false, 'J4 缺 workshop 报错');
  eq(raw(['--input', BASE, '--workshop', 'X']).s.ok, false, 'J5 缺 date 报错');
  eq(raw(['--input', BASE, '--workshop', 'X', '--date', '2026-13-45']).s.ok, false, 'J6 非法日期报错');
  eq(raw(['--input', BASE, '--workshop', 'X', '--date', DATE, '--from', '2026-10-01']).s.ok, false, 'J7 from 晚于 date 报错');
  eq(raw(['--input', '/不存在.xlsx', '--workshop', 'X', '--date', DATE]).s.ok, false, 'J8 输入不存在报错');
  eq(raw(['--input', BASE, '--workshop', 'X', '--date', DATE, '--未知', 'v']).s.ok, false, 'J9 未知参数报错');
  eq(raw(['--input', BASE, '--workshop', 'X', '--date', DATE, '--periods', '2']).s.ok, false, 'J10 periods<3 报错');
  eq(raw(['--input', BASE, '--workshop', 'X', '--date', DATE, '--threshold', '-1']).s.ok, false, 'J11 负斜率阈值报错');
  eq(raw(['--input', mk('nosheet.xlsx', { '别的': [['a'], [1]] }), '--workshop', 'X', '--date', DATE]).s.ok, false, 'J12 无参数记录表报错');
  eq(raw(['--input', BASE, '--workshop', 'X', '--date', DATE]).code, 0, 'J13 成功退出码 0');
  eq(raw(['--input', '/不存在.xlsx', '--workshop', 'X', '--date', DATE]).code, 1, 'J14 失败退出码 1');
});

// ============ K. 产出落盘 ============
section('BVT', () => {
  r = run(BASE, [], 'outputs');
  ok(fs.existsSync(path.join(r.out, 'trends.json')), 'K1 trends.json 生成');
  ok(fs.existsSync(path.join(r.out, 'alert.md')), 'K2 alert.md 生成');
  ok(fs.existsSync(path.join(r.out, 'summary.json')), 'K3 summary.json 生成');
  const sum = JSON.parse(fs.readFileSync(path.join(r.out, 'summary.json'), 'utf8'));
  eq(sum.ok, true, 'K4 summary.json 内容正确');
  ok(r.j.items.length === 3 && r.j.counts.series === 3, 'K5 items 与计数一致');
  eq(r.j.counts.overLimit + r.j.counts.deteriorating + r.j.counts.stable + r.j.counts.insufficientData >= r.j.counts.series, true, 'K6 分类覆盖全部序列');
});

// ============ L. 别名、合计行、标题行表头 ============
section('B', () => {
  const ALIAS = mk('alias.xlsx', {
    '参数数据': [['某厂DCS导出'], [],
      ['TAG', '名称', '测点名称', '记录时间', '实测值', '计量单位'],
      ['P-01', '泵1', '振动速度', '2026-09-01 08:00', 4.0, 'mm/s'],
      ['P-01', '泵1', '振动速度', '2026-09-03 08:00', 5.0, 'mm/s'],
      ['P-01', '泵1', '振动速度', '2026-09-05 08:00', 6.0, 'mm/s'],
      ['合计', '', '', '', '', '']],
    '限值': [['TAG', '参数名称', '上限值', '下限值', '单位'], ['P-01', '振动速度', 12, '', 'mm/s']],
  });
  r = run(ALIAS, [], 'alias');
  eq(r.s.ok, true, 'L1 别名列头与标题行可读');
  eq(r.s.counts.series, 1, 'L2 合计行被跳过');
  ok(r.j.warnings.some((w) => w.includes('合计行')), 'L3 合计行 warning');
  eq(r.s.counts.limitsProvided, true, 'L4 「限值」sheet 名可匹配');
  near(find(r.j, 'P-01', '振动速度').slope, 0.5, 1e-6, 'L5 别名读数正确');
  eq(find(r.j, 'P-01', '振动速度').unit, 'mm/s', 'L6 单位读取');
});

// 位号/参数名为空的行跳过
section('C', () => {
  const EMPTY = mk('empty.xlsx', {
    '参数记录': [HDR,
      ['', '泵1', '振动速度', '2026-09-01 08:00', 4.0, 'mm/s'],
      ['P-01', '泵1', '', '2026-09-01 08:00', 4.0, 'mm/s'],
      ['P-01', '泵1', '振动速度', '2026-09-01 08:00', 4.0, 'mm/s'],
      ['P-01', '泵1', '振动速度', '2026-09-03 08:00', 5.0, 'mm/s'],
      ['P-01', '泵1', '振动速度', '2026-09-05 08:00', 6.0, 'mm/s']],
  });
  r = run(EMPTY, [], 'empty');
  eq(r.s.counts.series, 1, 'L7 位号/参数名为空的行跳过');
  ok(r.j.warnings.some((w) => w.includes('位号为空')), 'L8 位号为空 warning');
  ok(r.j.warnings.some((w) => w.includes('参数名为空')), 'L9 参数名为空 warning');

  // 采集时间无法解析 → 该点不参与，不猜时间
  const BADT = mk('badt.xlsx', {
    '参数记录': [HDR,
      ['P-01', '泵1', '振动速度', '上周', 4.0, 'mm/s'],
      ['P-01', '泵1', '振动速度', '2026-09-03 08:00', 5.0, 'mm/s'],
      ['P-01', '泵1', '振动速度', '2026-09-05 08:00', 6.0, 'mm/s'],
      ['P-01', '泵1', '振动速度', '2026-09-07 08:00', 7.0, 'mm/s']],
  });
  r = run(BADT, [], 'badt');
  eq(find(r.j, 'P-01', '振动速度').periodsUsed, 3, 'L10 时间不可解析点不参与');
  ok(r.j.warnings.some((w) => w.includes('采集时间') && w.includes('无法解析')), 'L11 时间解析 warning');
});

// ============ M. 样例可再生（seed 变结论不变） ============
section('C', () => {
  const MS = path.join(__dirname, 'make-sample.js');
  function sample(seed, tag) {
    const d = path.join(work, 'sample-' + tag);
    const x = spawnSync(process.execPath, [MS, '--out', d, '--seed', String(seed)], { encoding: 'utf8' });
    ok(x.status === 0, `M-gen seed=${seed} 生成成功`);
    return run(path.join(d, 'sample-trend.xlsx'), [], 'smp' + tag);
  }
  const m1 = sample(1, 's1');
  const m2 = sample(7, 's7');
  eq(m1.s.ok, true, 'M1 样例可读');
  eq(m1.s.counts.series, 7, 'M2 主样例 7 条序列');
  eq(m1.s.counts.overLimit, 2, 'M3 恒 2 条已越限');
  eq(m1.s.counts.overHighHigh, 1, 'M3a 恒 1 条越高高报（HH）');
  eq(m1.s.counts.overHigh, 1, 'M3b 恒 1 条越高报（H）');
  eq(m1.s.counts.twoLevelLimits, true, 'M3c 主样例限值表为两级');
  ok(m1.j.warnings.some((w) => w.includes('已剥离单位「℃」')), 'M3d 主样例含带单位数值且被剥离单位');
  eq(m1.s.counts.insufficientData, 1, 'M4 恒 1 条数据不足');
  eq(m1.s.counts.invalidPoints, 1, 'M5 恒 1 个不可解析数值');
  eq(m1.s.counts.duplicateTimes, 1, 'M6 恒 1 组时间重复');
  eq(m2.s.counts.overLimit, m1.s.counts.overLimit, 'M7 换 seed 越限数不变');
  eq(m2.s.counts.deteriorating, m1.s.counts.deteriorating, 'M8 换 seed 恶化数不变');
  eq(m2.s.counts.insufficientData, m1.s.counts.insufficientData, 'M9 换 seed 数据不足数不变');
  ok(m2.j.items.some((x, i) => x.lastValue !== m1.j.items[i].lastValue), 'M10 换 seed 数值确实变化');

  // 宽表样例（DCS/SAP 列名）
  function sampleWide(seed, tag) {
    const d = path.join(work, 'sample-' + tag);
    return run(path.join(d, 'sample-dcs-wide.xlsx'), [], 'smpw' + tag);
  }
  const mw1 = sampleWide(1, 's1'), mw2 = sampleWide(7, 's7');
  eq(mw1.s.ok, true, 'M11 宽表样例可读');
  eq(mw1.s.inputShape, 'wide', 'M12 识别为宽表');
  eq(mw1.s.counts.series, 3, 'M13 宽表样例 3 条序列');
  eq(mw1.s.counts.deteriorating, 1, 'M14 恒 1 条恶化');
  eq(mw1.s.counts.insufficientData, 1, 'M15 恒 1 条数据不足（宽表空格=未测，不按 0）');
  eq(mw2.s.counts.deteriorating, mw1.s.counts.deteriorating, 'M16 换 seed 宽表恶化数不变');
  eq(mw2.s.counts.insufficientData, mw1.s.counts.insufficientData, 'M17 换 seed 宽表数据不足数不变');
  ok(mw1.j.items.every((x) => x.pointTag && /^(TI|VI)-/.test(x.pointTag)), 'M18 宽表样例测点号（仪表位号）全部读到');
  ok(mw1.j.items.every((x) => /^(P|K)-/.test(x.tag)), 'M19 功能位置列归位号');
});

// ============ N. 两级限值：高报(H)/高高报(HH)/低报(L)/低低报(LL) ============
section('A', () => {
  const TWOLVL = mk('twolvl.xlsx', {
    '参数记录': [HDR,
      ['P-01', '泵1', '轴承温度', '2026-09-01 08:00', 70, '℃'],
      ['P-01', '泵1', '轴承温度', '2026-09-03 08:00', 80, '℃'],
      ['P-01', '泵1', '轴承温度', '2026-09-05 08:00', 92, '℃'],
      ['P-02', '泵2', '轴承温度', '2026-09-01 08:00', 70, '℃'],
      ['P-02', '泵2', '轴承温度', '2026-09-03 08:00', 74, '℃'],
      ['P-02', '泵2', '轴承温度', '2026-09-05 08:00', 78, '℃'],
      ['P-03', '泵3', '轴承温度', '2026-09-01 08:00', 60, '℃'],
      ['P-03', '泵3', '轴承温度', '2026-09-03 08:00', 62, '℃'],
      ['P-03', '泵3', '轴承温度', '2026-09-05 08:00', 64, '℃'],
      ['P-04', '泵4', '出口压力', '2026-09-01 08:00', 1.0, 'MPa'],
      ['P-04', '泵4', '出口压力', '2026-09-03 08:00', 0.8, 'MPa'],
      ['P-04', '泵4', '出口压力', '2026-09-05 08:00', 0.4, 'MPa'],
      ['P-05', '泵5', '轴承温度', '2026-09-01 08:00', 60, '℃'],
      ['P-05', '泵5', '轴承温度', '2026-09-03 08:00', 62, '℃'],
      ['P-05', '泵5', '轴承温度', '2026-09-05 08:00', 64, '℃']],
    '报警限值': [['设备位号', '参数名', '高报', '高高报', '低报', '低低报', '单位'],
      ['P-01', '轴承温度', 75, 90, '', '', '℃'],
      ['P-02', '轴承温度', 75, 90, '', '', '℃'],
      ['P-03', '轴承温度', 75, 90, '', '', '℃'],
      ['P-04', '出口压力', '', '', 0.8, 0.5, 'MPa'],
      ['P-05', '轴承温度', '', 90, '', '', '℃']],
  });
  r = run(TWOLVL, [], 'twolvl');
  eq(r.s.ok, true, 'N1 两级限值表可读');
  eq(r.s.counts.twoLevelLimits, true, 'N2 识别为两级限值');
  const n01 = find(r.j, 'P-01', '轴承温度'), n02 = find(r.j, 'P-02', '轴承温度'), n03 = find(r.j, 'P-03', '轴承温度'), n04 = find(r.j, 'P-04', '出口压力'), n05 = find(r.j, 'P-05', '轴承温度');
  eq(n01.limitState, 'overHighHigh', 'N3 92>90 判越高高报');
  eq(n01.limitLevel, 'HH', 'N4 等级 HH');
  near(n01.exceedBy, 2, 1e-6, 'N5 超限幅度按 HH 算（92-90）');
  eq(n02.limitState, 'overHigh', 'N6 78 在 H 与 HH 之间 → 越高报');
  eq(n02.limitLevel, 'H', 'N7 等级 H');
  eq(n03.limitState, 'within', 'N8 64 未越限');
  eq(n03.etaLimitKind, '高报(H)', 'N9 两级都给时先向高报外推');
  near(n03.daysToLimit, 11, 0.05, 'N10 到高报 (75-64)/1=11 天');
  eq(n04.limitState, 'overLowLow', 'N11 0.4<0.5 判越低低报');
  eq(n04.limitLevel, 'LL', 'N12 等级 LL');
  eq(n05.etaLimitKind, '高高报(HH)', 'N13 只给 HH 时向 HH 外推');
  near(n05.daysToLimit, 26, 0.05, 'N14 到 HH (90-64)/1=26 天');
  eq(r.s.counts.overLimit, 3, 'N15 越限 3 条');
  eq(r.s.counts.overHighHigh, 2, 'N16 HH/LL 共 2 条');
  eq(r.s.counts.overHigh, 1, 'N17 H/L 共 1 条');
  eq(r.j.overLimit[0].limitLevel === 'HH' || r.j.overLimit[0].limitLevel === 'LL', true, 'N18 越限清单 HH/LL 排前');
});
section('C', () => {
  ok(/越限等级/.test(r.md) && /高高报\(HH\)/.test(r.md), 'N19 md 显示越限等级');
  ok(/【注意】越高高报\/低低报/.test(r.md), 'N20 越 HH 时 md 有【注意】提示');
  ok(!/[☀-➿️]|[\uD83C-\uDBFF]/.test(r.md), 'N21 md 不含 emoji');
  ok(/本技能不做停机判定/.test(r.md), 'N22 不做停机判定声明');
  ok(r.j.meta.limitRule.includes('HH/LL'), 'N23 meta 写明两级判定规则');
});

// 英文列名 H/HH/L/LL 与 高高报<高报 的核实提示
section('B', () => {
  const TWOLVL2 = mk('twolvl2.xlsx', {
    '参数记录': [HDR,
      ['P-01', '泵1', '轴承温度', '2026-09-01 08:00', 70, '℃'],
      ['P-01', '泵1', '轴承温度', '2026-09-03 08:00', 71, '℃'],
      ['P-01', '泵1', '轴承温度', '2026-09-05 08:00', 72, '℃']],
    '报警限值': [['设备位号', '参数名', 'H', 'HH', 'L', 'LL'],
      ['P-01', '轴承温度', 90, 85, 10, 5]],
  });
  r = run(TWOLVL2, [], 'twolvl2');
  eq(find(r.j, 'P-01', '轴承温度').limitHighHigh, 85, 'N24 英文列头 HH 可识别');
  eq(find(r.j, 'P-01', '轴承温度').limitHigh, 90, 'N25 英文列头 H 可识别（不被 HH 抢占）');
  eq(find(r.j, 'P-01', '轴承温度').limitLowLow, 5, 'N26 英文列头 LL 可识别');
  ok(r.j.warnings.some((w) => w.includes('高高报（85）小于高报（90）')), 'N27 高高报小于高报 → 核实提示');
  r = run(BASE, [], 'onelvl');
  eq(r.s.counts.twoLevelLimits, false, 'N28 单级限值表不标两级');
  ok(!/【注意】越高高报/.test(r.md), 'N29 无 HH 越限时不出现提示');
});

// ============ O. 宽表（一列一期）自动转长表 ============
const WIDE = mk('wide.xlsx', {
  '参数记录': [['功能位置', '功能位置描述', '仪表位号', '参数名称', '工程单位', '2026-09-01', '2026-09-03', '2026-09-05', '2026-09-07'],
    ['P-01', '泵1', 'TI-101', '轴承温度', '℃', 60, 62, 64, 66],
    ['P-02', '泵2', 'TI-102', '轴承温度', '℃', 60, '', 64, ''],
    ['P-03', '泵3', 'VI-103', '振动速度', 'mm/s', '4.0mm/s', '4.5mm/s', '5.0mm/s', '5.5mm/s'],
    ['合计', '', '', '', '', '', '', '', '']],
  '报警限值': [['仪表位号', '参数名称', '高报', '高高报'], ['TI-101', '轴承温度', 75, 90]],
});
section('B', () => {
  r = run(WIDE, [], 'wide');
  eq(r.s.ok, true, 'O1 宽表可读');
  eq(r.s.inputShape, 'wide', 'O2 自动识别为宽表');
  ok(r.j.warnings.some((w) => w.includes('识别为宽表') && w.includes('4 个日期列')), 'O3 warning 写明日期列数');
  const o01 = find(r.j, 'P-01', '轴承温度');
  eq(o01.periodsUsed, 4, 'O4 4 个日期列展开为 4 期');
  near(o01.slope, 1, 1e-6, 'O5 宽表斜率正确（每 2 天 +2）');
  eq(o01.pointTag, 'TI-101', 'O6 仪表位号归测点号');
  near(o01.daysToLimit, 9, 0.05, 'O7 限值表按仪表位号配对（(75-66)/1=9）');
  eq(find(r.j, 'P-02', '轴承温度').periodsUsed, 2, 'O8 宽表空格=未测，不按 0，只剩 2 期');
  eq(find(r.j, 'P-02', '轴承温度').category, 'insufficientData', 'O9 空格多的序列归数据不足');
  ok(!find(r.j, 'P-02', '轴承温度').points.some((p) => p.value === 0), 'O10 宽表空格未被当作 0');
  near(find(r.j, 'P-03', '振动速度').slope, 0.25, 1e-6, 'O11 宽表带单位数值剥离单位后参与回归');
  ok(r.j.warnings.some((w) => w.includes('已剥离单位「mm/s」')), 'O12 宽表带单位 warning');
  eq(r.s.counts.series, 3, 'O13 合计行跳过');
  ok(/宽表（已转长表）/.test(r.md), 'O14 md 写明数据形态');
  ok(/P-01（TI-101）/.test(r.md), 'O15 md 位号后带测点号');
});
// 宽表无参数名列：须 --wide-param，不猜
section('C', () => {
  const WIDENP = mk('widenp.xlsx', {
    '参数记录': [['设备位号', '2026-09-01', '2026-09-03', '2026-09-05'], ['P-01', 4, 5, 6]],
  });
  eq(raw(['--input', WIDENP, '--workshop', 'X', '--date', DATE]).s.ok, false, 'O16 宽表无参数名列且无 --wide-param → 报错不猜');
  r = run(WIDENP, ['--wide-param', '振动速度'], 'widenp');
  eq(r.s.ok, true, 'O17 --wide-param 指定参数名后可读');
  eq(find(r.j, 'P-01', '振动速度').periodsUsed, 3, 'O18 参数名取自 --wide-param');
  eq(raw(['--input', BASE, '--workshop', 'X', '--date', DATE, '--wide']).s.ok, false, 'O19 长表加 --wide 报错（未识别出日期列头）');
  r = run(BASE, ['--wide-param', '振动速度'], 'wideignore');
  eq(r.s.inputShape, 'long', 'O20 长表不受 --wide-param 影响');
  ok(r.j.warnings.some((w) => w.includes('--wide-param 仅在宽表时生效')), 'O21 长表时提示 --wide-param 被忽略');
  // 日期列头不含年份 → 不识别为宽表
  const WIDENY = mk('wideny.xlsx', {
    '参数记录': [['设备位号', '参数名', '9/1', '9/3', '9/5'], ['P-01', '振动速度', 4, 5, 6]],
  });
  eq(raw(['--input', WIDENY, '--workshop', 'X', '--date', DATE]).s.ok, false, 'O22 列头无年份不猜年份，按长表读取后缺采集时间列报错');
});

// ============ P. --r2-min 与 --horizon 参数化 ============
section('B', () => {
  r = run(NOISY, ['--r2-min', '0'], 'r2min0');
  ok(find(r.j, 'P-01', '振动速度').daysToLimit !== null, 'P1 --r2-min 0 时离散数据也给到限天数');
  eq(r.j.meta.r2Min, 0, 'P2 meta 记录 r2Min');
  r = run(BASE, ['--r2-min', '0.9999'], 'r2min1');
  eq(find(r.j, 'P-01', '振动速度').daysToLimit !== null, true, 'P3 R²=1 的序列在 r2-min 0.9999 下仍可预测');
  r = run(MID, ['--r2-min', '0.9'], 'r2min9');
  eq(find(r.j, 'P-01', '振动速度').daysToLimit, null, 'P4 提高 r2-min 后中等 R² 不给到限日期');
  ok(find(r.j, 'P-01', '振动速度').etaNote.includes('--r2-min'), 'P5 etaNote 提示参数名');
  eq(raw(['--input', BASE, '--workshop', 'X', '--date', DATE, '--r2-min', '1.5']).s.ok, false, 'P6 r2-min>1 报错');
  eq(raw(['--input', BASE, '--workshop', 'X', '--date', DATE, '--r2-min', 'abc']).s.ok, false, 'P7 r2-min 非数字报错');
  r = run(BASE, [], 'r2def');
  eq(r.j.meta.r2Min, 0.5, 'P8 默认 r2-min 0.5');
  eq(r.j.meta.horizonDays, 365, 'P9 默认 horizon 365');
  r = run(BASE, ['--horizon', '5'], 'hz5');
  eq(find(r.j, 'P-01', '振动速度').daysToLimit, null, 'P10 到限 8 天 > horizon 5 → 不作预警');
  ok(find(r.j, 'P-01', '振动速度').etaNote.includes('--horizon'), 'P11 etaNote 提示 horizon 参数');
  eq(find(r.j, 'P-01', '振动速度').category, 'stable', 'P12 超窗口归稳定');
  eq(raw(['--input', BASE, '--workshop', 'X', '--date', DATE, '--horizon', '0']).s.ok, false, 'P13 horizon<1 报错');
  ok(/R² 下限：0.5/.test(r.md) && /到限关注窗口：5 天/.test(r.md), 'P14 md 头部显示两道闸参数');
});

// ============ Q. SAP/DCS 列名别名（SYSTEM_ALIASES 合并）与测点号 ============
section('B', () => {
  const SAPL = mk('sapl.xlsx', {
    '监测记录': [['功能位置', '设备描述', '测点号', '测点名称', '采样时间', '测量值', '工程单位'],
      ['P-01', '泵1', 'TI-101', '轴承温度', '2026-09-01 08:00', '60℃', '℃'],
      ['P-01', '泵1', 'TI-101', '轴承温度', '2026-09-03 08:00', '62℃', '℃'],
      ['P-01', '泵1', 'TI-101', '轴承温度', '2026-09-05 08:00', '64℃', '℃']],
    '报警设定': [['功能位置', '测点名称', 'PH', 'PHH', 'PL', 'PLL'], ['P-01', '轴承温度', 75, 90, '', '']],
  });
  r = run(SAPL, [], 'sapl');
  eq(r.s.ok, true, 'Q1 SAP/DCS 列名可读（功能位置/设备描述/测点号/采样时间/测量值/工程单位）');
  const q01 = find(r.j, 'P-01', '轴承温度');
  ok(!!q01, 'Q2 功能位置归位号、测点名称归参数名');
  eq(q01.pointTag, 'TI-101', 'Q3 测点号读取');
  eq(q01.name, '泵1', 'Q4 设备描述归设备名称');
  near(q01.slope, 1, 1e-6, 'Q5 带 ℃ 后缀的测量值剥离单位后参与回归');
  ok(r.j.warnings.some((w) => w.includes('已剥离单位「℃」')), 'Q6 剥离单位 warning（每列一次）');
  eq(r.j.warnings.filter((w) => w.includes('已剥离单位')).length, 1, 'Q7 剥离单位只提示一次');
  eq(q01.limitHigh, 75, 'Q8 PH 归高报');
  eq(q01.limitHighHigh, 90, 'Q9 PHH 归高高报');
  eq(r.s.counts.limitsProvided, true, 'Q10 「报警设定」sheet 名可匹配');
  // 设备编号不再作为位号别名（SAP 设备编号是流水号）
  const EQNO = mk('eqno.xlsx', {
    '参数记录': [['设备编号', '参数名', '采集时间', '数值'],
      ['10001234', '振动速度', '2026-09-01 08:00', 4],
      ['10001234', '振动速度', '2026-09-03 08:00', 5],
      ['10001234', '振动速度', '2026-09-05 08:00', 6]],
  });
  eq(raw(['--input', EQNO, '--workshop', 'X', '--date', DATE]).s.ok, false, 'Q11 只有「设备编号」列不当位号（SAP 设备编号不是位号）→ 报错');
  // 只有测点号、无位号、无参数名：测点号兼作序列键与参数名并提示
  const PTONLY = mk('ptonly.xlsx', {
    '参数记录': [['仪表位号', '时间', 'PV'],
      ['TI-101', '2026-09-01 08:00', 60],
      ['TI-101', '2026-09-03 08:00', 62],
      ['TI-101', '2026-09-05 08:00', 64]],
    '报警限值': [['仪表位号', '高报', '高高报'], ['TI-101', 75, 90]],
  });
  r = run(PTONLY, [], 'ptonly');
  eq(r.s.ok, true, 'Q12 仅仪表位号+时间+PV 的 DCS 导出可读');
  eq(r.s.counts.series, 1, 'Q13 测点号兼作序列键');
  ok(r.j.warnings.some((w) => w.includes('已用测点号（仪表位号）作为序列键')), 'Q14 提示测点号与设备位号不是一回事');
  eq(r.j.items[0].limitHigh, 75, 'Q15 限值表按测点号配对');
  r = run(SAPL, ['--equipment', 'TI-101'], 'eqpt');
  eq(r.s.counts.series, 1, 'Q16 --equipment 可按测点号过滤');
  // 「测点」裸列头归测点号而不是参数名
  const DIAN = mk('dian.xlsx', {
    '参数记录': [['设备位号', '测点', '参数名', '采集时间', '数值'],
      ['P-01', 'TI-101', '轴承温度', '2026-09-01 08:00', 60],
      ['P-01', 'TI-101', '轴承温度', '2026-09-03 08:00', 62],
      ['P-01', 'TI-101', '轴承温度', '2026-09-05 08:00', 64]],
  });
  r = run(DIAN, [], 'dian');
  eq(find(r.j, 'P-01', '轴承温度').pointTag, 'TI-101', 'Q17 「测点」裸列头归测点号');
});

// ============ R. 声明行与默认输出目录 ============
section('C', () => {
  r = run(BASE, [], 'decl');
  ok(/本材料由脚本汇总、模型成文，仅供设备员复核参考，不替代审批、定性、验收与签字；厂内制度与系统数据为准。/.test(r.md), 'R1 通用声明行写入 md');
  eq(r.j.meta.disclaimer.includes('厂内制度与系统数据为准'), true, 'R2 JSON 含通用声明');
  ok(!/EAM|机动处|动火/.test(r.md), 'R3 md 不含旧口径词');
  ok(/ISO 10816/.test(r.md), 'R4 分析段占位提示振动按 ISO 10816 / GB/T 6075 分区概念表述');
  {
    const x = spawnSync(process.execPath, [TR, '--input', BASE, '--workshop', 'X', '--date', DATE], { encoding: 'utf8' });
    const l = x.stdout.trim().split('\n'); const sj = JSON.parse(l[l.length - 1]);
    ok(sj.ok && sj.out.startsWith(os.tmpdir()), 'R5 默认输出目录在系统临时目录');
    try { fs.rmSync(sj.out, { recursive: true, force: true }); } catch (e) {}
  }
});

// ============ S. 停运设备：低值不判越低报/低低报、不做劣化判定，高限照常判 ============
// P-11A 运行（电流 60）；P-11B 备用（电流 0、出口压力 0.18、轴承温度 85 越高报）；P-12 电流 0、振动 0→0.6；
// P-13 无电流/转速位号；II-14/PI-14 只有测点号、无设备位号（归属不定）；P-16 09-07 12:00 才停机（最新数据 08:00 时在运行）
const ST_HDR = ['设备位号', '测点号', '设备名称', '参数名', '采集时间', '数值', '单位'];
const ST_T = ['2026-09-01 08:00', '2026-09-03 08:00', '2026-09-05 08:00', '2026-09-07 08:00'];
const stRows = (tag, pt, name, param, vals, unit) => vals.map((v, i) => [tag, pt, name, param, ST_T[i], v, unit]);
const STOP = mk('stop.xlsx', {
  '参数记录': [ST_HDR,
    ...stRows('P-11A', 'II11A', '进料泵', '电机电流', [60, 60.5, 59.8, 60.2], 'A'),
    ...stRows('P-11A', 'PI11A', '进料泵', '出口压力', [0.5, 0.5, 0.5, 0.5], 'MPa'),
    ...stRows('P-11B', 'II11B', '进料泵', '电机电流', [0, 0, 0, 0], 'A'),
    ...stRows('P-11B', 'PI11B', '进料泵', '出口压力', [0.18, 0.18, 0.18, 0.18], 'MPa'),
    ...stRows('P-11B', 'TI11B', '进料泵', '轴承温度', [85, 86, 87, 88], '℃'),
    ...stRows('P-12', 'II12', '回流泵', '电机电流', [0, 0, 0, 0], 'A'),
    ...stRows('P-12', 'PI12', '回流泵', '出口压力', [0.1, 0.1, 0.1, 0.1], 'MPa'),
    ...stRows('P-12', 'VI12', '回流泵', '驱动端振动', [0, 0.2, 0.4, 0.6], 'mm/s'),
    ...stRows('P-13', 'PI13', '注水泵', '出口压力', [0.1, 0.1, 0.1, 0.1], 'MPa'),
    ...stRows('', 'II14', '', '电机电流', [0, 0, 0, 0], 'A'),
    ...stRows('', 'PI14', '', '出口压力', [0.1, 0.1, 0.1, 0.1], 'MPa'),
    ...stRows('P-16', 'II16', '塔底泵', '电机电流', [60, 60, 60, 60], 'A'),
    ...stRows('P-16', 'PI16', '塔底泵', '出口压力', [0.5, 0.5, 0.5, 0.5], 'MPa'),
  ],
  '报警限值': [['设备位号', '测点号', '参数名', '高报', '高高报', '低报', '低低报'],
    ...['P-11A', 'P-11B', 'P-12', 'P-13', 'P-16'].map((t) => [t, '', '出口压力', '', '', 1.0, 0.8]),
    ['', 'PI14', '出口压力', '', '', 1.0, 0.8],
    ['P-11B', '', '轴承温度', 70, 80, '', ''],
    ['P-12', '', '驱动端振动', 7.1, 11.2, '', ''],
  ],
});
const stItem = (j, tag, param) => ((j && j.items) || []).find((x) => x.tag === tag && x.param === param) || {};
section('A', () => {
  // --- 无状态来源：按电流自判疑似停运
  r = run(STOP, [], 'stop-self');
  eq(r.s.ok, true, 'S1 停运样例运行成功');
  eq(stItem(r.j, 'P-12', '出口压力').category, 'stopped', 'S2 电流≈0 的设备出口压力低归「停运中（不判定）」，不判低低报');
  eq(stItem(r.j, 'P-12', '出口压力').limitState, null, 'S3 停运设备低值不给 limitState=overLowLow');
  eq(stItem(r.j, 'P-12', '出口压力').runState, 'suspectedStopped', 'S4 无状态来源时标记疑似停运');
  eq(stItem(r.j, 'P-12', '驱动端振动').category, 'stopped', 'S5 停运设备不做劣化趋势判定（振动 0→0.6 不归恶化）');
  eq(stItem(r.j, 'P-12', '驱动端振动').etaDate, null, 'S6 停运设备不预测到限日期');
  eq(stItem(r.j, 'P-12', '电机电流').category, 'stopped', 'S7 电流位号本身也单列停运');
  eq(stItem(r.j, 'P-11B', '出口压力').category, 'stopped', 'S8 备用泵出口压力低不判低低报');
  eq(stItem(r.j, 'P-11B', '轴承温度').category, 'overLimit', 'S9 停运设备高限照常判（轴承温度 88 越高高报）');
  eq(stItem(r.j, 'P-11B', '轴承温度').limitLevel, 'HH', 'S10 停运设备越高高报等级');
  eq(stItem(r.j, 'P-11A', '出口压力').limitState, 'overLowLow', 'S11 运行设备（电流 60A）低值照常判低低报');
  eq(stItem(r.j, 'P-13', '出口压力').limitState, 'overLowLow', 'S12 无电流/转速位号可判 → 维持原逻辑');
  eq((((r.j && r.j.items) || []).find((x) => x.pointTag === 'PI14') || {}).limitState, 'overLowLow', 'S13 只有测点号、归属设备不能确定 → 不套用停运');
  eq(r.s.counts.stopped, 5, 'S14 停运中（不判定）计数（P-11B×2 + P-12×3；越高限的不计，测点无归属不计）');
  ok(((r.j && r.j.warnings) || []).some((w) => /疑似停运/.test(w) && /P-12/.test(w) && /--status/.test(w) && /台账/.test(w) && /启停记录/.test(w)), 'S15 疑似停运 warning 点名并提示提供台账/启停记录');
  ok(/### 停运中（不判定）/.test(r.md || '') && /P-12/.test(((r.md || '').match(/### 停运中（不判定）[\s\S]*?(\n## |\n### 数据质量)/) || [''])[0]), 'S16 md 单列「停运中（不判定）」');
  ok(/停运中（不判定）\s*\|\s*5/.test(r.md || ''), 'S17 概览含停运中计数');
  eq((r.j || { meta: {} }).meta.statusProvided, false, 'S18 meta 记录未提供状态来源');
  eq(stItem(r.j, 'P-12', '出口压力').lowIgnored, 'LL', 'S18a 记录被忽略的低限等级（lowIgnored）');
  ok(/高高报\(HH\)（疑似停运）/.test(r.md || ''), 'S18b 已越限表标注停运设备');
});
// --- 启停记录 + 台账：启停记录优先
section('B', () => {
  const STOP_RUNS = mk('stop-status.xlsx', {
    '启停记录': [['位号', '设备名称', '开机时间', '停机时间'],
      ['P-11A', '进料泵', '2026-08-01 08:00', ''],
      ['P-11B', '进料泵', '2026-07-01 08:00', '2026-08-01 08:00'],
      ['P-16', '塔底泵', '2026-08-01 08:00', '2026-09-07 12:00']],
    '设备台账': [['位号', '设备编号', '设备名称', '使用状态'],
      ['P-11A', '10000001', '进料泵', '备用'],
      ['P-11B', '10000002', '进料泵', '在用'],
      ['P-12', '10000003', '回流泵', '停用'],
      ['P-13', '10000004', '注水泵', '检修']],
  });
  r = run(STOP, ['--status', STOP_RUNS], 'stop-status');
  eq(r.s.ok, true, 'S19 --status 运行成功');
  eq(stItem(r.j, 'P-11B', '出口压力').runState, 'stopped', 'S20 启停记录最近一条已停机 → 停运');
  eq(stItem(r.j, 'P-11B', '出口压力').runStateSource, '启停记录', 'S21 依据为启停记录');
  eq(stItem(r.j, 'P-11A', '出口压力').limitState, 'overLowLow', 'S22 启停记录（运行）优先于台账（备用）');
  eq(stItem(r.j, 'P-11A', '出口压力').runState, 'running', 'S23 启停记录判运行');
  eq(stItem(r.j, 'P-16', '出口压力').limitState, 'overLowLow', 'S24 停机时间晚于最新数据采集时间 → 按采集时运行判定');
  eq(stItem(r.j, 'P-12', '出口压力').runStateSource, '设备台账', 'S25 无启停记录时用台账（停用）');
  eq(stItem(r.j, 'P-13', '出口压力').category, 'stopped', 'S26 台账「检修」→ 停运，无电流位号也不判低低报');
  eq((r.j || { meta: {} }).meta.statusProvided, true, 'S27 meta 记录提供了状态来源');
  ok(!!r.j && !r.j.warnings.some((w) => /疑似停运/.test(w)), 'S28 状态来源覆盖全部设备时不出疑似停运提示');
  // --- 只给台账：台账「在用」不等于在运行，回落到数据自判
  const STOP_LEDGER = mk('stop-ledger.xlsx', { '设备台账': [['位号', '设备名称', '使用状态'], ['P-11B', '进料泵', '在用'], ['P-11A', '进料泵', '在用']] });
  r = run(STOP, ['--status', STOP_LEDGER], 'stop-ledger');
  eq(stItem(r.j, 'P-11B', '出口压力').runState, 'suspectedStopped', 'S29 台账「在用」不判运行，按电流自判疑似停运');
  eq(stItem(r.j, 'P-11A', '出口压力').limitState, 'overLowLow', 'S30 台账在用且电流正常 → 照常判');
  // --- MCP 形态：目录里放 启停记录.csv / 设备台账.csv
  {
    const sd = path.join(work, 'stop-csvdir'); fs.mkdirSync(sd, { recursive: true });
    fs.writeFileSync(path.join(sd, '启停记录.csv'), '﻿位号,设备名称,开机时间,停机时间\nP-11B,进料泵,2026-07-01 08:00,2026-08-01 08:00\nP-12,回流泵,2026-08-01 08:00,\n', 'utf8');
    fs.writeFileSync(path.join(sd, '设备台账.csv'), '﻿位号,设备编号,设备名称,使用状态,完好状态,状态\nP-13,10000004,注水泵,停用,完好,停用\n', 'utf8');
    r = run(STOP, ['--status', sd], 'stop-csvdir');
    eq(r.s.ok, true, 'S31 --status 可给 csv 目录');
    eq(stItem(r.j, 'P-12', '出口压力').runState, 'running', 'S32 启停记录停机时间为空 → 运行（不再自判）');
    eq(stItem(r.j, 'P-12', '出口压力').limitState, 'overLowLow', 'S33 启停记录判运行时低值照常判');
    eq(stItem(r.j, 'P-13', '出口压力').runStateSource, '设备台账', 'S34 csv 台账可读');
    r = run(STOP, ['--status', path.join(sd, '启停记录.csv')], 'stop-csvfile');
    eq(stItem(r.j, 'P-11B', '出口压力').runStateSource, '启停记录', 'S35 --status 可给单个 csv 文件');
  }
  eq(raw(['--input', STOP, '--workshop', 'X', '--date', DATE, '--status', path.join(work, 'nope.xlsx')]).s.ok, false, 'S36 --status 路径不存在报错');
  eq(raw(['--input', STOP, '--workshop', 'X', '--date', DATE, '--status', BASE]).s.ok, false, 'S37 --status 里没有启停记录/台账 → 报错');
  // --- 阈值：无基准按 ≤0.5 A；有量程按 2%；转速 0
  const STOP2 = mk('stop2.xlsx', {
    '参数记录': [ST_HDR,
      ...stRows('P-21', 'II21', '泵', '电机电流', [0.4, 0.3, 0.4, 0.4], 'A'),
      ...stRows('P-21', 'PI21', '泵', '出口压力', [0.1, 0.1, 0.1, 0.1], 'MPa'),
      ...stRows('P-22', 'II22', '泵', '电机电流', [0.8, 0.8, 0.8, 0.8], 'A'),
      ...stRows('P-22', 'PI22', '泵', '出口压力', [0.1, 0.1, 0.1, 0.1], 'MPa'),
      ...stRows('P-23', 'II23', '泵', '电机电流', [0.8, 0.8, 0.8, 0.8], 'A'),
      ...stRows('P-23', 'PI23', '泵', '出口压力', [0.1, 0.1, 0.1, 0.1], 'MPa'),
      ...stRows('C-24', 'SI24', '压缩机', '转速', [0, 0, 0, 0], 'r/min'),
      ...stRows('C-24', 'PI24', '压缩机', '出口压力', [0.1, 0.1, 0.1, 0.1], 'MPa'),
    ],
    '报警限值': [['设备位号', '参数名', '高报', '低报', '低低报', '量程上限'],
      ...['P-21', 'P-22', 'P-23', 'C-24'].map((t) => [t, '出口压力', '', 1.0, 0.8, '']),
      ['P-23', '电机电流', 120, '', '', 100]],
  });
  r = run(STOP2, [], 'stop2');
  eq(stItem(r.j, 'P-21', '出口压力').category, 'stopped', 'S38 无额定/量程时电流 ≤0.5 A 判疑似停运');
  eq(stItem(r.j, 'P-22', '出口压力').limitState, 'overLowLow', 'S39 电流 0.8 A（>0.5 A，无基准）不判停运');
  eq(stItem(r.j, 'P-23', '出口压力').category, 'stopped', 'S40 量程 100 A 时 0.8 A ≤ 2% 判疑似停运');
  eq(stItem(r.j, 'C-24', '出口压力').category, 'stopped', 'S41 转速 0 判疑似停运');
});
// 原有样例（无停运设备）不受影响
section('C', () => {
  r = run(BASE, [], 'stop-none');
  eq(r.s.counts.stopped, 0, 'S42 无停运设备时停运计数 0');
  ok(!/### 停运中（不判定）/.test(r.md || ''), 'S43 无停运设备时不出停运小节');
});

// ============ T. 刚由备机切为主机：回溯窗口里停机期的点剔出回归 ============
// P-31 前 3 期停机（电流 0），后 4 期运行：振动 0,0,0,2,2,2,2 不得算成上升趋势；P-32 只剩 2 期运行 → 数据不足（含停机期）
// P-35 切泵后只运行 3 期（窗口内有停机期，剩余 <4 期）→ 不判劣化，数据不足（切泵后运行期数偏少），越限照常判
// P-33 无电流位号：无启停记录维持原逻辑；有启停记录（09-06 08:00 开机，此前停机）时剔除停机段
const SW_T = ['2026-09-01 08:00', '2026-09-03 08:00', '2026-09-05 08:00', '2026-09-07 08:00', '2026-09-09 08:00', '2026-09-11 08:00', '2026-09-13 08:00'];
const swRows = (tag, pt, param, vals, unit) => vals.map((v, i) => [tag, pt, '泵', param, SW_T[i], v, unit]);
const SWITCH = mk('switch.xlsx', {
  '参数记录': [ST_HDR,
    ...swRows('P-31', 'II31', '电机电流', [0, 0, 0, 60, 60.2, 60.1, 60], 'A'),
    ...swRows('P-31', 'VI31', '驱动端振动', [0, 0, 0, 2.0, 2.05, 2.0, 2.02], 'mm/s'),
    ...swRows('P-32', 'II32', '电机电流', [0, 0, 0, 0, 0, 60, 60], 'A'),
    ...swRows('P-32', 'VI32', '驱动端振动', [0, 0, 0, 0, 0, 2.0, 2.1], 'mm/s'),
    ...swRows('P-33', 'VI33', '驱动端振动', [0, 0, 0, 2.0, 2.05, 2.0, 2.02], 'mm/s'),
    ...swRows('P-34', 'II34', '电机电流', [60, 60, 60, 60, 60, 60, 60], 'A'),
    ...swRows('P-34', 'VI34', '驱动端振动', [2.0, 2.4, 2.8, 3.2, 3.6, 4.0, 4.4], 'mm/s'),
    ...swRows('P-35', 'II35', '电机电流', [0, 0, 0, 0, 60, 60.5, 61], 'A'),
    ...swRows('P-35', 'VI35', '驱动端振动', [0, 0, 0, 0, 2.0, 2.4, 2.8], 'mm/s'),
    // 轴承温度停机时不记读数：只有切泵后 3 期；P-34 一直运行的温度也只给 3 期作对照
    ...swRows('P-35', 'TI35', '轴承温度', [null, null, null, null, 60, 62, 64], '℃').filter((x) => x[5] !== null),
    ...swRows('P-34', 'TI34', '轴承温度', [null, null, null, null, 60, 62, 64], '℃').filter((x) => x[5] !== null),
  ],
  '报警限值': [['设备位号', '参数名', '高报', '高高报'],
    ...['P-31', 'P-32', 'P-33', 'P-34'].map((t) => [t, '驱动端振动', 7.1, 11.2]),
    ['P-35', '驱动端振动', 2.5, 11.2],
    ['P-35', '轴承温度', 80, 90], ['P-34', '轴承温度', 80, 90],
    ...['P-31', 'P-32', 'P-34', 'P-35'].map((t) => [t, '电机电流', 120, ''])],
});
const exN = (x) => ((x && x.excludedStoppedPeriods) || []).length;
section('B', () => {
  const SWITCH_RUNS = mk('switch-runs.xlsx', {
    '启停记录': [['位号', '开机时间', '停机时间'],
      ['P-33', '2026-08-01 08:00', '2026-09-01 07:00'],
      ['P-33', '2026-09-06 08:00', ''],
      ['P-34', '2026-08-01 08:00', '']],
  });
  r = run(SWITCH, [], 'switch-self');
  eq(r.s.ok, true, 'T1 切泵样例运行成功');
  eq(stItem(r.j, 'P-31', '驱动端振动').category, 'stable', 'T2 停机期 0 值剔出后振动不再判趋势恶化');
  eq(exN(stItem(r.j, 'P-31', '驱动端振动')), 3, 'T3 记录剔除的停机期 3 期（同期电流≈0）');
  eq(stItem(r.j, 'P-31', '驱动端振动').periodsUsed, 4, 'T4 参与回归的期数为剔除后的 4 期');
  eq(((stItem(r.j, 'P-31', '驱动端振动').excludedStoppedPeriods || [])[0] || {}).time, '2026-09-01 08:00', 'T5 剔除期记录采集时间');
  eq(stItem(r.j, 'P-31', '驱动端振动').excludedStoppedSource, '数据自判', 'T6 剔除依据：同期电流≈0');
  eq(stItem(r.j, 'P-31', '电机电流').category, 'stable', 'T7 电流位号自身的停机期 0 值也剔除，不判上升');
  eq(stItem(r.j, 'P-32', '驱动端振动').category, 'insufficientData', 'T8 剔除后不足 3 期 → 数据不足');
  ok(/含停机期/.test(stItem(r.j, 'P-32', '驱动端振动').note || ''), 'T9 数据不足说明写「含停机期」');
  eq(stItem(r.j, 'P-32', '驱动端振动').etaDate, null, 'T10 剔除后数据不足不预测到限日期');
  ok(((r.j && r.j.warnings) || []).some((w) => /P-32/.test(w) && /含停机期/.test(w)), 'T11 剔除后数据不足 warning');
  eq(stItem(r.j, 'P-33', '驱动端振动').category, 'deteriorating', 'T12 无电流/转速位号且无启停记录 → 维持原逻辑');
  eq(exN(stItem(r.j, 'P-33', '驱动端振动')), 0, 'T13 无可判依据时不剔除');
  eq(exN(stItem(r.j, 'P-34', '驱动端振动')), 0, 'T14 一直运行的设备不剔除');
  eq(stItem(r.j, 'P-34', '驱动端振动').category, 'deteriorating', 'T15 真实上升趋势照常判恶化');
  eq((r.s.counts || {}).excludedStoppedPoints, 24, 'T16 剔除点计数（P-31 3×2 + P-32 5×2 + P-35 4×2）');
  ok(/已剔除停机期 24 个点/.test(r.md || ''), 'T17 md 研判处说明已剔除停机期点数');
  ok(((r.j && r.j.warnings) || []).some((w) => /停机期/.test(w) && /P-31/.test(w) && /剔/.test(w)), 'T18 剔除停机期 warning 点名');
  eq(stItem(r.j, 'P-35', '电机电流').category, 'insufficientData', 'T18a 窗口内有停机期、剔除后剩 3 期（<4）→ 不判劣化，归数据不足');
  ok(/切泵后运行期数偏少，剩 3 期/.test(stItem(r.j, 'P-35', '电机电流').note || ''), 'T18b note 写「数据不足（切泵后运行期数偏少，剩 N 期）」');
  eq(stItem(r.j, 'P-35', '电机电流').etaDate, null, 'T18c 切泵后期数偏少不预测到限');
  eq(stItem(r.j, 'P-35', '电机电流').slope, null, 'T18d 切泵后期数偏少不给斜率');
  eq(stItem(r.j, 'P-35', '驱动端振动').limitLevel, 'H', 'T18e 越限判定照常用剩余点（2.8 > 高报 2.5）');
  ok(((r.j && r.j.overLimit) || []).some((x) => x.tag === 'P-35' && x.param === '驱动端振动'), 'T18f 切泵后期数偏少但已越限 → 仍进越限清单');
  ok(((r.j && r.j.warnings) || []).some((w) => /含停机期/.test(w) && /P-32/.test(w) && /P-35/.test(w) && /切泵后运行期数偏少/.test(w)), 'T18g 与「数据不足（含停机期）」并入同一条 warning 点名');
  eq(stItem(r.j, 'P-34', '驱动端振动').periodsUsed, 7, 'T18h 窗口内无停机期的序列不受 4 期门槛影响');
  eq(stItem(r.j, 'P-35', '轴承温度').category, 'insufficientData', 'T18i 停机时无读数的参数（只剩切泵后 3 期）同样不判劣化');
  ok(/切泵后运行期数偏少，剩 3 期/.test(stItem(r.j, 'P-35', '轴承温度').note || ''), 'T18j 停机时无读数的参数 note 写切泵后运行期数偏少');
  eq(stItem(r.j, 'P-34', '轴承温度').category, 'deteriorating', 'T18k 同样 3 期但窗口内无停机期 → 仍按 3 期判趋势');
  r = run(SWITCH, ['--status', SWITCH_RUNS], 'switch-runs');
  eq(exN(stItem(r.j, 'P-33', '驱动端振动')), 3, 'T19 有启停记录时剔除停机段内的 3 期');
  eq(stItem(r.j, 'P-33', '驱动端振动').excludedStoppedSource, '启停记录', 'T20 剔除依据：启停记录');
  eq(stItem(r.j, 'P-33', '驱动端振动').category, 'stable', 'T21 剔除停机段后不再判恶化');
  eq(exN(stItem(r.j, 'P-34', '驱动端振动')), 0, 'T22 启停记录全程运行不剔除');
  eq(exN(stItem(r.j, 'P-31', '驱动端振动')), 3, 'T23 不在启停记录里的设备仍按同期电流剔除');
  // 启停记录只有窗口内的开机记录（之前的运行段早于导出窗口）：开机前的采集点按停机剔除
  const SWITCH_RUNS2 = mk('switch-runs2.xlsx', { '启停记录': [['位号', '开机时间', '停机时间'], ['P-33', '2026-09-06 08:00', '']] });
  r = run(SWITCH, ['--status', SWITCH_RUNS2], 'switch-runs2');
  eq(exN(stItem(r.j, 'P-33', '驱动端振动')), 3, 'T23a 首段开机之前的采集点按停机剔除（开机即说明此前停机）');
});
section('C', () => {
  ok(!/已剔除停机期/.test(run(BASE, [], 'switch-none').md || 'x已剔除停机期'), 'T24 无停机期时 md 不出剔除说明');
});

// ============ WS. 车间范围核对（D007）：参数记录混入其他车间时剔除；空车间保留；全不一致不筛并开头【注意】；无车间列/维护工厂不筛；宽表带车间列 ============
{
  const ws = (x) => ((x.j && x.j.meta && x.j.meta.workshopScope) || []);
  const W = (x) => ((x.s && x.s.warnings) || []);
  let plantBook = null;
  const mkP = (n, b) => { plantBook = b; return mk(n, b); };
  const HW = ['设备位号', '设备名称', '车间', '参数名', '采集时间', '数值', '单位'];
  const pts = (tag, ws0, param, vals) => vals.map((v, i) => [tag, tag, ws0, param, `2026-09-0${1 + 2 * i} 08:00`, v, 'mm/s']);
  section('A', () => {
    const MIX = mk('ws-mix.xlsx', { '参数记录': [HW]
      .concat(pts('P-01', '测试车间', '振动速度', [4, 5, 6, 7, 8]))
      .concat(pts('P-02', '', '振动速度', [3, 3, 3, 3]))
      .concat(pts('P-91', '催化车间', '振动速度', [10, 12, 14]))
      .concat(pts('P-92', '催化车间', '振动速度', [2, 2, 2])),
    '报警限值': [['设备位号', '参数名', '报警上限'], ['P-01', '振动速度', 12], ['P-02', '振动速度', 12], ['P-91', '振动速度', 11], ['P-92', '振动速度', 11]] });
    r = run(MIX, [], 'ws-mix');
    eq(r.s.ok, true, 'WS1 车间混合参数记录运行成功');
    eq((r.s.counts || {}).series, 2, 'WS2 剔除其他车间后序列数 2（P-01/P-02）');
    eq((r.s.counts || {}).overLimit, 0, 'WS3 其他车间 P-91 越限不计入本车间');
    ok(!((r.j && r.j.items) || []).some((x) => /^P-9/.test(x.tag)), 'WS4 结果不含其他车间位号');
    ok(W(r).some((w) => w.includes('工作表「参数记录」按 --workshop「测试车间」剔除其他车间 6 行') && w.includes('催化车间 6 行')), 'WS5 warning 写明剔除行数与车间名');
    const s0 = ws(r)[0] || {};
    eq(s0.status, 'checked', 'WS6 meta.workshopScope 状态 checked');
    eq(s0.droppedRows, 6, 'WS7 meta.workshopScope 记录剔除 6 行');
    eq((s0.dropped || {})['催化车间'], 6, 'WS8 dropped 按车间名记行数');
    eq(s0.blank, 4, 'WS9 车间为空 4 行计入 blank');
    ok(!!find(r.j || { items: [] }, 'P-02', '振动速度'), 'WS10 车间为空的 P-02 按本车间保留');
    ok(W(r).some((w) => w.includes('车间列为空 4 行，按本车间保留')), 'WS11 车间为空 warning 写明行数');
    ok(/车间范围：已按车间列核对「测试车间」，剔除其他车间的行：「参数记录」6 行（催化车间 6 行）/.test(r.md || ''), 'WS12 md 口径处写明剔除情况');

    const MIS = mk('ws-mis.xlsx', { '参数记录': [HW].concat(pts('P-91', '催化车间', '振动速度', [10, 12, 14])) });
    r = run(MIS, [], 'ws-mis');
    eq((r.s.counts || {}).series, 1, 'WS13 车间列全不一致时不筛');
    eq((ws(r)[0] || {}).status, 'mismatch', 'WS14 meta.workshopScope 状态 mismatch');
    ok(W(r).some((w) => w.startsWith('【注意】') && w.includes('催化车间')), 'WS15 全不一致 warning 以【注意】开头');
    ok(/^# [^\n]*\n\n【注意】工作表「参数记录」的车间列取值与 --workshop「测试车间」不一致，未按车间筛选，请核对输入。/.test(r.md || ''), 'WS16 md 标题后紧跟【注意】提示');
    ok(((r.md || '').split('## 一、')[0]).includes('车间列取值与 --workshop'), 'WS17 【注意】在正文第一节之前');
  });

  section('B', () => {
    r = run(BASE, [], 'ws-nocol');
    eq((ws(r)[0] || {}).status, 'noColumn', 'WS18 无车间列 status 为 noColumn');
    ok(/车间范围：输入未含车间列，车间范围以取数条件为准。/.test(r.md || ''), 'WS19 无车间列时 md 口径写明以取数条件为准');
    eq((r.s.counts || {}).series, 3, 'WS20 无车间列不筛');

    const PLANT = mkP('ws-plant.xlsx', { '参数记录': [['设备位号', '维护工厂', '参数名', '采集时间', '数值']]
      .concat([1, 3, 5].map((d) => ['P-01', '1100', '振动速度', `2026-09-0${d} 08:00`, 4])).concat([1, 3, 5].map((d) => ['P-02', '1200', '振动速度', `2026-09-0${d} 08:00`, 4])) });
    r = run(PLANT, [], 'ws-plant');
    eq((ws(r)[0] || {}).status, 'noColumn', 'WS21 「维护工厂」不当车间列（noColumn）');
    ok((ws(r)[0] || {}).column === null && !(ws(r)[0] || {}).ignoredColumn, 'WS22 「维护工厂」不读入车间字段（column 为 null，无 ignoredColumn）');
    eq((r.s.counts || {}).series, 2, 'WS23 「维护工厂」列不参与筛选');
    // 人员列「车间负责人」不当车间列（common.js 只认 车间/所属车间/属地车间/运行部 及其后加「名称」）
    r = run(mk('ws-person.xlsx', JSON.parse(JSON.stringify(plantBook).split('维护工厂').join('车间负责人'))), [], 'ws-person');
    ok((ws(r)[0] || {}).status === 'noColumn' && (ws(r)[0] || {}).ignoredColumn === '车间负责人' && r.s.ok === true, 'WS27 「车间负责人」人员列判 noColumn，ignoredColumn 记下，不筛');

    // 宽表（DCS 一列一期）带车间列：展开为长表后照样核对
    const WIDE = mk('ws-wide.xlsx', { '参数记录': [['设备位号', '车间', '参数名', '2026-09-01', '2026-09-03', '2026-09-05'],
      ['P-01', '测试车间', '振动速度', 4, 5, 6], ['P-91', '催化车间', '振动速度', 10, 12, 14]] });
    r = run(WIDE, [], 'ws-wide');
    eq(r.s.inputShape, 'wide', 'WS24 带车间列的宽表仍识别为宽表');
    eq((r.s.counts || {}).series, 1, 'WS25 宽表按车间列剔除其他车间序列');
    ok((ws(r)[0] || {}).status === 'checked' && (ws(r)[0] || {}).droppedRows === 3, 'WS26 宽表剔除行数按展开后的行计（3 行）');
  });
}

console.log(`\n${'='.repeat(56)}`);
console.log(`parameter-trend-alert 自测：${pass} 通过，${fail} 失败`);
console.log(`用例级别 ${LEVELS[RUN_LEVEL]}：BVT ${byLevel.BVT}，A ${byLevel.A}，B ${byLevel.B}，C ${byLevel.C}`);
if (failures.length) { console.log('\n失败项：'); failures.forEach((f) => console.log('  ✗ ' + f)); }
console.log('='.repeat(56));
try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
