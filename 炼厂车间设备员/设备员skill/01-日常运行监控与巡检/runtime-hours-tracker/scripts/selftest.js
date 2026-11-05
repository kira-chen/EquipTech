#!/usr/bin/env node
'use strict';
/** 自测：断言 runtime.js 行为。用法：node scripts/selftest.js */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { writeXlsx } = require('./lib/xlsx-lite');

const RT = path.join(__dirname, 'runtime.js');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rht-selftest-'));
const DATE = '2026-09-21';
let pass = 0, fail = 0;
const failures = [];
const ok = (c, n) => { if (c) pass++; else { fail++; failures.push(n); } };
const eq = (a, e, n) => ok(a === e, `${n}（期望 ${JSON.stringify(e)}，实际 ${JSON.stringify(a)}）`);

function run(input, extra = [], tag) {
  const out = path.join(work, tag + '-out');
  const r = spawnSync(process.execPath, [RT, '--input', input, '--workshop', '测试车间', '--date', DATE, '--out', out, ...extra], { encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  let s; try { s = JSON.parse(lines[lines.length - 1]); } catch (e) { s = { ok: false, error: 'no-json:' + r.stdout + r.stderr }; }
  let j = null, md = null;
  if (fs.existsSync(path.join(out, 'runtime.json'))) j = JSON.parse(fs.readFileSync(path.join(out, 'runtime.json'), 'utf8'));
  if (fs.existsSync(path.join(out, 'runtime-report.md'))) md = fs.readFileSync(path.join(out, 'runtime-report.md'), 'utf8');
  return { code: r.status, s, j, md, out };
}
const mk = (n, b) => { const p = path.join(work, n); writeXlsx(p, b); return p; };

// ============ A. 基础累计 ============
const BASE = mk('base.xlsx', {
  '启停记录': [['位号', '设备名称', '开机时间', '停机时间'],
    ['P-01', '泵1', '2026-09-01 08:00', '2026-09-03 08:00'],   // 48h
    ['P-01', '泵1', '2026-09-05 08:00', '2026-09-06 08:00'],   // 24h
    ['P-02', '泵2', '2026-09-01 00:00', '2026-09-11 00:00']],  // 240h
  '阈值表': [['位号', '部件', '阈值类型', '阈值', '上次归零日期'],
    ['P-01', '整机', '运行小时', 100, '2026-09-01'],
    ['P-02', '轴承', '运行小时', 200, '2026-09-01']],
});
let r = run(BASE, [], 'base');
eq(r.s.ok, true, 'A1 基础运行成功');
eq(r.s.counts.equipment, 2, 'A2 设备数');
const p01 = r.j.byEquipment.find((x) => x.tag === 'P-01');
eq(p01.periodHours, 72, 'A3 多段运行累加（48+24）');
eq(p01.periodStarts, 2, 'A4 启停次数');
const p02 = r.j.byEquipment.find((x) => x.tag === 'P-02');
eq(p02.periodHours, 240, 'A5 单段运行时长');
eq(r.s.counts.exceeded, 1, 'A6 P-02 超阈值（240>200）');
eq(r.s.counts.dueSoon, 0, 'A7 P-01 未达预警比例（72/100=72%<90%）');
ok(/## 一、统计概览/.test(r.md) && /## 二、逐台累计明细/.test(r.md) && /## 三、已超阈值/.test(r.md)
  && /## 四、接近阈值/.test(r.md) && /## 五、未判定项/.test(r.md) && /## 六、数据缺口说明/.test(r.md) && /## 七、统计说明/.test(r.md), 'A8 七节齐全');
ok(/<!-- ANALYSIS_START -->/.test(r.md), 'A9 分析段占位符');

// ============ B. 阈值列与阈值类型列不冲突（曾有 bug） ============
ok(p01.thresholds.length === 1, 'B1 阈值项解析');
eq(p01.thresholds[0].type, '运行小时', 'B2 阈值类型列正确（未被阈值列抢占）');
eq(p01.thresholds[0].threshold, 100, 'B3 阈值列正确（未被阈值类型列抢占）');
ok(!r.j.warnings.some((w) => w.includes('阈值为空或无法解析')), 'B4 无误报的阈值解析失败');

// ============ C. 启停不配对不补停机（核心） ============
const UNPAIR = mk('unpair.xlsx', {
  '启停记录': [['位号', '设备名称', '开机时间', '停机时间'],
    ['P-01', '泵1', '2026-09-01 08:00', '2026-09-03 08:00'],
    ['P-01', '泵1', '2026-09-10 08:00', ''],
    ['P-02', '泵2', '', '2026-09-05 08:00']],
});
r = run(UNPAIR, [], 'unpair');
eq(r.s.counts.unpaired, 2, 'C1 两条不配对记录');
const u01 = r.j.byEquipment.find((x) => x.tag === 'P-01');
eq(u01.periodHours, 48, 'C2 不配对段未计入累计（未按截止时间补停机）');
ok(r.j.warnings.some((w) => w.includes('未按截止时间强行补一次停机')), 'C3 warning 明确未补停机');
ok(r.j.incomplete.some((x) => x.unpaired.some((u) => u.reason.includes('未按截止时间补停机'))), 'C4 原因写明');
const u02 = r.j.byEquipment.find((x) => x.tag === 'P-02');
eq(u02.periodHours, null, 'C5 只有停机无开机时累计为 null 不是 0');
ok(/## 六、数据缺口说明/.test(r.md) && /只有开机时间/.test(r.md), 'C6 md 单列不配对');

// ============ D. 停机时间早于开机时间 ============
const REV = mk('rev.xlsx', {
  '启停记录': [['位号', '开机时间', '停机时间'],
    ['P-01', '2026-09-10 08:00', '2026-09-08 08:00']],
});
r = run(REV, [], 'rev');
ok(r.j.warnings.some((w) => w.includes('停机时间早于开机时间')), 'D1 时间倒序 warning');
eq(r.j.byEquipment[0].periodHours, null, 'D2 倒序段不参与累计');
ok(r.j.incomplete[0].unpaired.some((u) => u.reason.includes('早于')), 'D3 倒序单列');

// ============ E. 区间重叠原样保留（核心） ============
const OVL = mk('ovl.xlsx', {
  '启停记录': [['位号', '开机时间', '停机时间'],
    ['P-01', '2026-09-01 00:00', '2026-09-11 00:00'],
    ['P-01', '2026-09-08 00:00', '2026-09-13 00:00']],
});
r = run(OVL, [], 'ovl');
eq(r.s.counts.overlaps, 1, 'E1 检出区间重叠');
ok(r.j.warnings.some((w) => w.includes('重叠')), 'E2 重叠 warning');
eq(r.j.byEquipment[0].periodHours, 360, 'E3 重叠段原样累加（240+120），未去重也未合并');
ok(r.j.incomplete[0].overlaps[0].note.includes('未去重也未合并'), 'E4 说明未去重');

// ============ F. 停机间隔不误报为数据缺口（核心） ============
const IDLE = mk('idle.xlsx', {
  '启停记录': [['位号', '开机时间', '停机时间'],
    ['P-01', '2026-09-01 08:00', '2026-09-03 08:00'],
    ['P-01', '2026-09-08 08:00', '2026-09-10 08:00']],
});
r = run(IDLE, [], 'idle');
eq(r.s.counts.incomplete, 0, 'F1 正常停机间隔不计为数据问题');
eq(r.s.counts.unpaired, 0, 'F2 无不配对');
eq(r.s.counts.overlaps, 0, 'F3 无重叠');
ok(r.j.byEquipment[0].idleIntervals.length === 1, 'F4 停机间隔单独记录供参考');
eq(r.j.byEquipment[0].periodHours, 96, 'F5 停机段不计入运行累计');
ok(/_无_/.test((r.md.match(/## 六、数据缺口说明[\s\S]*?## 七/) || [''])[0]), 'F6 数据缺口节为空');

// ============ G. 阈值缺失不预警（核心） ============
const NOTH = mk('noth.xlsx', {
  '启停记录': [['位号', '开机时间', '停机时间'], ['P-01', '2026-09-01 08:00', '2026-09-20 08:00']],
});
r = run(NOTH, [], 'noth');
eq(r.s.counts.thresholdsProvided, false, 'G1 未提供阈值表');
eq(r.s.counts.exceeded, 0, 'G2 无阈值不预警');
ok(r.j.warnings.some((w) => w.includes('只统计不做阈值预警')), 'G3 warning 说明');
ok(/未提供阈值表，不做阈值预警/.test(r.md), 'G4 md 说明');
ok(/—（未提供阈值表）/.test(r.md), 'G5 概览显示 — 不是 0');

// 阈值值无法解析 → 该项不预警
const BADTH = mk('badth.xlsx', {
  '启停记录': [['位号', '开机时间', '停机时间'], ['P-01', '2026-09-01 08:00', '2026-09-20 08:00']],
  '阈值表': [['位号', '阈值类型', '阈值'], ['P-01', '运行小时', '视情况']],
});
r = run(BADTH, [], 'badth');
eq(r.s.counts.exceeded, 0, 'G6 阈值无法解析时不预警');
ok(r.j.warnings.some((w) => w.includes('该项不预警')), 'G7 warning 说明不预警');

// ============ H. 累计续算 ============
r = run(BASE, [], 'prev-src');
const prevPath = path.join(r.out, 'runtime.json');
r = run(BASE, ['--prev', prevPath], 'cum');
const c01 = r.j.byEquipment.find((x) => x.tag === 'P-01');
eq(c01.cumHours, 144, 'H1 累计续算（72+72）');
eq(c01.cumStarts, 4, 'H2 启停次数续算');
r = run(BASE, [], 'nocum');
eq(r.j.byEquipment.find((x) => x.tag === 'P-01').cumHours, 72, 'H3 无上期时累计等于本期');
// 上期文件不存在 → 报错
function raw(args) {
  const x = spawnSync(process.execPath, [RT, ...args], { encoding: 'utf8' });
  const l = x.stdout.trim().split('\n');
  try { return { code: x.status, s: JSON.parse(l[l.length - 1]) }; } catch (e) { return { code: x.status, s: { ok: false } }; }
}
eq(raw(['--input', BASE, '--workshop', 'X', '--date', DATE, '--prev', '/不存在.json']).s.ok, false, 'H4 上期文件不存在报错');

// ============ I. 运行记录形式与数值不可解析 ============
const RUNH = mk('runh.xlsx', {
  '运行记录': [['位号', '设备名称', '运行时长'], ['P-01', '泵1', 168], ['P-02', '泵2', '未记录']],
  '阈值表': [['位号', '阈值类型', '阈值'], ['P-01', '运行小时', 200], ['P-02', '运行小时', 200]],
});
r = run(RUNH, [], 'runh');
eq(r.s.ok, true, 'I1 运行记录形式可读');
eq(r.j.byEquipment.find((x) => x.tag === 'P-01').periodHours, 168, 'I2 运行时长读取');
eq(r.j.byEquipment.find((x) => x.tag === 'P-02').periodHours, null, 'I3 无法解析为 null 不是 0');
ok(r.j.warnings.some((w) => w.includes('无法解析为数字')), 'I4 解析失败 warning');
const t02 = r.j.byEquipment.find((x) => x.tag === 'P-02').thresholds[0];
eq(t02.state, 'undetermined', 'I5 累计为 null 时阈值判定为未判定');
ok(t02.note.includes('不预警'), 'I6 未判定说明不预警');

// ============ J. 预警比例 ============
const WARN = mk('warn.xlsx', {
  '启停记录': [['位号', '开机时间', '停机时间'], ['P-01', '2026-09-01 00:00', '2026-09-08 20:00']],  // 188h
  '阈值表': [['位号', '阈值类型', '阈值'], ['P-01', '运行小时', 200]],
});
r = run(WARN, [], 'warn');
eq(r.s.counts.dueSoon, 1, 'J1 94% 达到默认预警比例 90%');
r = run(WARN, ['--warn-ratio', '0.99'], 'warn99');
eq(r.s.counts.dueSoon, 0, 'J2 提高预警比例后不报');
eq(raw(['--input', WARN, '--workshop', 'X', '--date', DATE, '--warn-ratio', '1.5']).s.ok, false, 'J3 非法预警比例报错');

// ============ K. 设备范围过滤 ============
r = run(BASE, ['--equipment', 'P-01'], 'filter');
eq(r.s.counts.equipment, 1, 'K1 按位号过滤');
eq(r.j.byEquipment[0].tag, 'P-01', 'K2 过滤结果正确');
eq(raw(['--input', BASE, '--workshop', 'X', '--date', DATE, '--equipment', 'P-99']).s.ok, false, 'K3 范围内无记录报错');

// ============ L. 参数校验 ============
eq(raw([]).s.ok, false, 'L1 无参数报错');
eq(raw(['--input']).s.ok, false, 'L2 缺值报错');
ok(/缺少取值/.test(raw(['--input']).s.error), 'L3 缺值信息正确');
eq(raw(['--input', BASE]).s.ok, false, 'L4 缺 workshop 报错');
eq(raw(['--input', BASE, '--workshop', 'X']).s.ok, false, 'L5 缺 date 报错');
eq(raw(['--input', BASE, '--workshop', 'X', '--date', '2026-13-45']).s.ok, false, 'L6 非法日期报错');
eq(raw(['--input', BASE, '--workshop', 'X', '--date', DATE, '--from', '2026-10-01']).s.ok, false, 'L7 from 晚于 date 报错');
eq(raw(['--input', '/不存在.xlsx', '--workshop', 'X', '--date', DATE]).s.ok, false, 'L8 输入不存在报错');
eq(raw(['--input', BASE, '--workshop', 'X', '--date', DATE, '--未知', 'v']).s.ok, false, 'L9 未知参数报错');
eq(raw(['--input', mk('nosheet.xlsx', { '别的': [['a'], [1]] }), '--workshop', 'X', '--date', DATE]).s.ok, false, 'L10 无记录表报错');

// ============ M. 声明行与产出 ============
r = run(BASE, [], 'outputs');
ok(/阈值到期为计划提示，实际检修时机由设备工程师结合状态评估确定/.test(r.md), 'M1 保留声明行');
ok(r.j.meta.statement.includes('设备工程师'), 'M2 JSON 含声明');
ok(fs.existsSync(path.join(r.out, 'runtime.json')), 'M3 runtime.json 生成');
ok(fs.existsSync(path.join(r.out, 'runtime-report.md')), 'M4 报告生成');
ok(fs.existsSync(path.join(r.out, 'summary.json')), 'M5 summary.json 生成');

// ============ N. 别名与合计行 ============
const ALIAS = mk('alias.xlsx', {
  '启停记录': [['某厂启停导出'], [],
    ['设备位号', '名称', '启动时间', '停止时间'],
    ['P-01', '泵1', '2026-09-01 08:00', '2026-09-03 08:00'],
    ['合计', '', '', '']],
});
r = run(ALIAS, [], 'alias');
eq(r.s.ok, true, 'N1 别名列头可读');
eq(r.s.counts.equipment, 1, 'N2 合计行被跳过');
ok(r.j.warnings.some((w) => w.includes('合计行')), 'N3 合计行 warning');


// ============ O. 期初累计小时：累计 = 期初 + 本期（中石化口径：自上次大检修后累计） ============
const BASEH = mk('baseh.xlsx', {
  '启停记录': [['位号', '设备名称', '开机时间', '停机时间'],
    ['P-01', '泵1', '2026-09-01 08:00', '2026-09-03 08:00'],   // 48h
    ['P-02', '泵2', '2026-09-01 08:00', '2026-09-03 08:00']],  // 48h
  '阈值表': [['位号', '部件', '阈值类型', '阈值', '上次归零日期', '期初累计小时'],
    ['P-01', '机组', '运行小时', 8000, '2024-03-01', 7900],
    ['P-01', '轴承', '运行小时', 1000, '2026-06-01', 200],
    ['P-02', '机组', '运行小时', 8000, '2024-03-01', '']],
});
r = run(BASEH, [], 'baseh');
const b01 = r.j.byEquipment.find((x) => x.tag === 'P-01');
eq(b01.baseHours, 7900, 'O1 设备级期初累计取机组行');
eq(b01.cumHours, 7948, 'O2 累计 = 期初 7900 + 本期 48');
eq(b01.cumBasis, 'base', 'O3 累计口径标 base');
eq(b01.thresholds[0].current, 7948, 'O4 机组阈值按期初+本期比对');
eq(b01.thresholds[0].state, 'dueSoon', 'O5 7948/8000=99.4% 进入临期（未按本期 48h 判正常）');
eq(b01.thresholds[1].current, 248, 'O6 轴承行用该行自己的期初 200 + 48');
eq(b01.thresholds[1].basis, 'rowBase', 'O7 部件行口径标 rowBase');
const b02 = r.j.byEquipment.find((x) => x.tag === 'P-02');
eq(b02.cumBasis, 'periodOnly', 'O8 该台无期初 → 仅本期增量');
eq(b02.cumHours, 48, 'O9 无期初时累计 = 本期，不按 0 期初伪装成累计');
ok(r.j.warnings.some((w) => w.includes('P-02') && w.includes('未提供期初累计小时')), 'O10 无期初 warning 点名设备');
ok(/【注意】1 台设备无期初累计小时/.test(r.md), 'O11 md 注意行');
ok(r.j.items.find((x) => x.tag === 'P-01').cumulativeHours === 7948 && r.j.items.find((x) => x.tag === 'P-01').cumulativeBasis === 'base', 'O12 items[] 给下游 cumulativeHours');
ok(Array.isArray(r.s.items) && r.s.items.length === 2, 'O13 summary.json 也带 items');
// 期初列缺失 → 整表 warning
r = run(BASE, [], 'nobasecol');
ok(r.j.warnings.some((w) => w.includes('未提供「期初累计小时」列')), 'O14 阈值表缺期初列 warning');
// 同时给 --prev 与期初：以上期续算为准且不重复计入
r = run(BASEH, [], 'prevsrc2');
r = run(BASEH, ['--prev', path.join(r.out, 'runtime.json')], 'prevbase');
eq(r.j.byEquipment.find((x) => x.tag === 'P-01').cumHours, 7996, 'O15 --prev 续算 7948+48，期初不重复加');
eq(r.j.byEquipment.find((x) => x.tag === 'P-01').cumBasis, 'prev', 'O16 口径标 prev');
ok(r.j.warnings.some((w) => w.includes('期初值未重复计入')), 'O17 同时给 prev 与期初时 warning');

// ============ P. 日历周期（年）阈值：大机组按年检修周期，按自然月算到期 ============
const CAL = mk('cal.xlsx', {
  '启停记录': [['位号', '设备名称', '开机时间', '停机时间'],
    ['C-01', '主风机', '2026-09-01 08:00', '2026-09-03 08:00'],
    ['C-02', '富气压缩机', '2026-09-01 08:00', '2026-09-03 08:00'],
    ['C-03', '增压机', '2026-09-01 08:00', '2026-09-03 08:00']],
  '阈值表': [['位号', '部件', '阈值类型', '阈值', '上次归零日期'],
    ['C-01', '机组', '日历周期（年）', 3, '2023-08-31'],      // 到期 2026-08-31，已超
    ['C-02', '机组', '大检修周期', '3年', '2023-12-01'],        // 由取值"3年"判为日历，到期 2026-12-01，1025/1096=93.5%
    ['C-03', '机组', '日历周期（年）', 3, '']],                 // 缺归零日期 → 未判定
});
r = run(CAL, [], 'cal');
const c1 = r.j.byEquipment.find((x) => x.tag === 'C-01').thresholds[0];
eq(c1.kind, 'calendar', 'P1 日历周期类型');
eq(c1.dueDate, '2026-08-31', 'P2 按自然月加 36 个月算到期日');
eq(c1.state, 'exceeded', 'P3 到期已过 → 超阈值');
ok(r.j.exceeded.some((x) => x.tag === 'C-01' && x.dueDate === '2026-08-31'), 'P4 超阈值清单带到期日');
const c2 = r.j.byEquipment.find((x) => x.tag === 'C-02').thresholds[0];
eq(c2.kind, 'calendar', 'P5 类型文字无"年"但取值"3年" → 日历周期');
eq(c2.dueDate, '2026-12-01', 'P6 到期日');
eq(c2.state, 'dueSoon', 'P7 93.5% 进入临期');
eq(c2.thresholdText, '3年', 'P8 阈值文本原样');
const c3 = r.j.byEquipment.find((x) => x.tag === 'C-03').thresholds[0];
eq(c3.state, 'undetermined', 'P9 缺上次归零日期 → 未判定');
ok(c3.note.includes('上次归零日期'), 'P10 未判定说明缺哪个字段');
ok(/## 五、未判定项[\s\S]*C-03[\s\S]*上次归零日期/.test(r.md), 'P11 md 未判定节单列');
ok(/到期日/.test(r.md) && /2026-12-01/.test(r.md), 'P12 md 临期表带到期日');
ok(/已运行1,025天/.test(r.md), 'P13 日历行"当前"显示已运行天数');
// 运行小时与日历周期是两个维度：阈值"24000h"按运行小时，不被当日历
const MIX = mk('mix.xlsx', {
  '启停记录': [['位号', '开机时间', '停机时间'], ['C-01', '2026-09-01 00:00', '2026-09-11 00:00']],
  '阈值表': [['位号', '阈值类型', '阈值', '上次归零日期', '期初累计小时'],
    ['C-01', '', '24000h', '2023-08-31', 23900],
    ['C-01', '', '3年', '2023-08-31', '']],
});
r = run(MIX, [], 'mix');
const mx = r.j.byEquipment[0].thresholds;
eq(mx[0].kind, 'hours', 'P14 类型空但取值"24000h" → 运行小时（parseRunHours）');
eq(mx[0].threshold, 24000, 'P15 24000h 解析');
eq(mx[0].current, 24140, 'P16 23900+240');
eq(mx[1].kind, 'calendar', 'P17 类型空但取值"3年" → 日历');
eq(r.s.counts.exceeded, 2, 'P18 两个维度各自判定');

// ============ Q. 阈值类型为空且取值无单位 → 未判定，不默认按运行小时 ============
const NOTYPE = mk('notype.xlsx', {
  '启停记录': [['位号', '开机时间', '停机时间'], ['P-01', '2026-09-01 00:00', '2026-09-11 00:00']],   // 240h
  '阈值表': [['位号', '部件', '阈值', '期初累计小时'], ['P-01', '联轴器', 100, 0]],
});
r = run(NOTYPE, [], 'notype');
eq(r.s.counts.exceeded, 0, 'Q1 类型为空不默认按运行小时判超');
eq(r.s.counts.undetermined, 1, 'Q2 判为未判定');
ok(r.j.undetermined[0].note.includes('不默认按运行小时'), 'Q3 说明不默认');
ok(/【未判定】/.test(r.md) && /不默认按运行小时/.test(r.md), 'Q4 md 单列');
// 类型写了但归不进三类
const BADTYPE = mk('badtype.xlsx', {
  '启停记录': [['位号', '开机时间', '停机时间'], ['P-01', '2026-09-01 00:00', '2026-09-11 00:00']],
  '阈值表': [['位号', '阈值类型', '阈值'], ['P-01', '振动', 100]],
});
r = run(BADTYPE, [], 'badtype');
eq(r.s.counts.undetermined, 1, 'Q5 不认识的阈值类型 → 未判定');
ok(r.j.undetermined[0].note.includes('振动'), 'Q6 说明原文类型');
// 「类型」裸列头不再被当阈值类型（设备类型列不误配）
const DEVTYPE = mk('devtype.xlsx', {
  '启停记录': [['位号', '开机时间', '停机时间'], ['P-01', '2026-09-01 00:00', '2026-09-11 00:00']],
  '阈值表': [['位号', '设备类型', '阈值类型', '阈值'], ['P-01', '离心泵', '启停次数', 10]],
});
r = run(DEVTYPE, [], 'devtype');
eq(r.j.byEquipment[0].thresholds[0].kind, 'starts', 'Q7 「设备类型」列不抢「阈值类型」');
const TYPEONLY = mk('typeonly.xlsx', {
  '启停记录': [['位号', '开机时间', '停机时间'], ['P-01', '2026-09-01 00:00', '2026-09-11 00:00']],
  '阈值表': [['位号', '类型', '阈值'], ['P-01', '启停次数', 10]],
});
r = run(TYPEONLY, [], 'typeonly');
eq(r.j.byEquipment[0].thresholds[0].kind, null, 'Q8 裸「类型」列不再认为阈值类型，取值 10 无单位 → 未判定');
eq(r.s.counts.undetermined, 1, 'Q8b 裸「类型」列 → 未判定计数');

// ============ R. SAP PM / EM 导出列名（mergeAliases） ============
const SAP = mk('sap.xlsx', {
  '开停机记录': [['功能位置', '设备', '设备描述', '启动时间', '停止时间'],
    ['C-2301', '10012345', '催化主风机', '2026-09-01 00:00', '2026-09-11 00:00']],
  '检修周期': [['功能位置', '部件', '周期类型', '检修周期', '上次大检修日期', '上次大检修后累计'],
    ['C-2301', '机组', '运行小时', '24000h', '2023-11-15', 23000],
    ['C-2301', '机组', '日历周期（年）', '3年', '2023-11-15', '']],
});
r = run(SAP, [], 'sap');
eq(r.s.ok, true, 'R1 SAP 列名可读');
const sp = r.j.byEquipment[0];
eq(sp.tag, 'C-2301', 'R2 功能位置 → 位号');
eq(sp.code, '10012345', 'R3 「设备」（SAP 流水号）→ 设备编号，不是位号');
eq(sp.name, '催化主风机', 'R4 设备描述 → 设备名称');
eq(sp.periodHours, 240, 'R5 启动/停止时间');
eq(sp.baseHours, 23000, 'R6 「上次大检修后累计」→ 期初累计小时');
eq(sp.cumHours, 23240, 'R7 累计');
eq(sp.thresholds[0].threshold, 24000, 'R8 「检修周期」列 24000h → 阈值');
eq(sp.thresholds[1].dueDate, '2026-11-15', 'R9 「上次大检修日期」→ 归零日期，按自然月到期');
ok(/10012345/.test(r.md), 'R10 md 展示设备编号列');
// 「设备编号」列头不会被当位号
const DEVNO = mk('devno.xlsx', {
  '启停记录': [['设备编号', '位号', '开机时间', '停机时间'], ['10000001', 'P-01', '2026-09-01 00:00', '2026-09-11 00:00']],
});
r = run(DEVNO, [], 'devno');
eq(r.j.byEquipment[0].tag, 'P-01', 'R11 位号列取「位号」，「设备编号」不是位号');
eq(r.j.byEquipment[0].code, '10000001', 'R12 设备编号单列');

// ============ S. 运行状态记录（时序）折算 ============
const SERIES = mk('series.xlsx', {
  '运行状态记录': [['位号', '设备名称', '时间', '运行状态'],
    ['P-01', '泵1', '2026-09-01 08:00', '运行'],
    ['P-01', '泵1', '2026-09-05 08:00', '运行'],      // 连续运行点，不重复计启动
    ['P-01', '泵1', '2026-09-08 08:00', '停机'],      // 168h
    ['P-01', '泵1', '2026-09-10 08:00', 'RUN'],
    ['P-01', '泵1', '2026-09-12 08:00', '备用'],      // 48h
    ['P-02', '泵2', '2026-09-08 08:00', '运行'],      // 末条运行无停机 → 不配对
    ['P-03', '泵3', '2026-09-08 08:00', '停机'],      // 首条停机 → 不配对
    ['P-04', '泵4', '2026-09-08 08:00', '不知道']],   // 状态不可识别 → 跳过
  '阈值表': [['位号', '阈值类型', '阈值', '期初累计小时'], ['P-01', '运行小时', 240, 0]],
});
r = run(SERIES, [], 'series');
eq(r.s.ok, true, 'S1 时序表可读');
const s1 = r.j.byEquipment.find((x) => x.tag === 'P-01');
eq(s1.periodHours, 216, 'S2 按状态区间折算 168+48');
eq(s1.periodStarts, 2, 'S3 连续"运行"点只计一次启动');
eq(s1.sources.join(), '运行状态记录', 'S4 来源标注，且不被「运行记录」重复命中');
eq(s1.thresholds[0].state, 'dueSoon', 'S5 216/240=90% 临期');
const s2 = r.j.byEquipment.find((x) => x.tag === 'P-02');
eq(s2.periodHours, null, 'S6 末条运行无停机 → 不计入、不按截止时间补');
ok(r.j.warnings.some((w) => w.includes('P-02') && w.includes('未按截止时间强行补一次停机')), 'S7 warning');
ok(r.j.incomplete.some((x) => x.tag === 'P-03' && x.unpaired[0].reason.includes('首条为停机')), 'S8 首条停机单列');
ok(r.j.warnings.some((w) => w.includes('不知道') && w.includes('无法识别为运行/停机')), 'S9 状态不可识别 warning（含行号与原值）');
ok(!r.j.byEquipment.some((x) => x.tag === 'P-04'), 'S10 不可识别行不生成设备');
// 时序与启停记录同一位号：以启停记录为准
const BOTH = mk('both.xlsx', {
  '启停记录': [['位号', '开机时间', '停机时间'], ['P-01', '2026-09-01 00:00', '2026-09-03 00:00']],
  '运行状态记录': [['位号', '时间', '运行状态'], ['P-01', '2026-09-10 00:00', '运行'], ['P-01', '2026-09-12 00:00', '停机']],
});
r = run(BOTH, [], 'both');
eq(r.j.byEquipment[0].periodHours, 48, 'S11 同位号两种来源以启停记录为准');
ok(r.j.warnings.some((w) => w.includes('以启停记录为准')), 'S12 warning');
// 时序表缺必需列
const SERMISS = mk('sermiss.xlsx', { '运行状态记录': [['位号', '时间'], ['P-01', '2026-09-10 00:00']] });
r = run(SERMISS, [], 'sermiss');
ok(r.s.ok === false || r.j.warnings.some((w) => w.includes('缺少列')), 'S13 缺运行状态列 → warning 或报错');

// ============ T. 带单位数值 ============
const UNIT = mk('unit.xlsx', {
  '运行记录': [['位号', '运行时长'], ['P-01', '168h'], ['P-02', '72 小时']],
  '阈值表': [['位号', '阈值类型', '阈值', '期初累计小时'], ['P-01', '运行小时', '200h', '0h'], ['P-02', '运行小时', '200', 0]],
});
r = run(UNIT, [], 'unit');
eq(r.j.byEquipment.find((x) => x.tag === 'P-01').periodHours, 168, 'T1 "168h" 剥离单位');
eq(r.j.byEquipment.find((x) => x.tag === 'P-02').periodHours, 72, 'T2 "72 小时" 剥离单位');
eq(r.j.byEquipment.find((x) => x.tag === 'P-01').thresholds[0].threshold, 200, 'T3 阈值 "200h"');
ok(r.j.warnings.some((w) => w.includes('已剥离单位')), 'T4 剥离单位 warning 提示核对');

// ============ U. 术语与声明 ============
r = run(BASE, [], 'terms');
ok(!/[☀-➿\u{1F300}-\u{1FAFF}]/u.test(r.md), 'U1 md 不含 emoji');
ok(/本材料由脚本汇总、模型成文，仅供设备员复核参考/.test(r.md), 'U2 通用声明行');
ok(r.j.meta.disclaimer.includes('厂内制度与系统数据为准'), 'U3 JSON 含通用声明');
ok(/运行小时与启停次数统计/.test(r.md), 'U4 标题用"运行小时"');
ok(!/机动处/.test(r.md) && !/EAM/.test(r.md), 'U5 不出现旧称');
ok(/公司设备管理部门/.test(r.md), 'U6 分析段提示交付口径');
eq(r.s.counts.undetermined, 0, 'U7 基础样例无未判定');
ok(/## 五、未判定项\n\n_无_/.test(r.md), 'U8 无未判定时该节显示 _无_');
r = run(NOTH, [], 'noth2');
ok(/未判定项 \| —（未提供阈值表）/.test(r.md), 'U9 无阈值表时未判定显示 —');
// 默认输出目录为系统临时目录
{
  const x = spawnSync(process.execPath, [RT, '--input', BASE, '--workshop', 'X', '--date', DATE], { encoding: 'utf8' });
  const l = x.stdout.trim().split('\n'); const sj = JSON.parse(l[l.length - 1]);
  ok(sj.ok && sj.out.startsWith(os.tmpdir()), 'U10 未传 --out 时写系统临时目录');
}

// ============ V. --running-until：停机时间为空表示「仍在运行」（DCS 启停记录口径），显式给截止时刻才计入 ============
const OPEN = mk('open.xlsx', {
  '启停记录': [['位号', '开机时间', '停机时间'],
    ['P-01', '2026-09-10 08:00', '2026-09-12 08:00'],   // 48h 已闭合
    ['P-01', '2026-09-20 08:00', ''],                   // 仍在运行
    ['P-02', '2026-09-22 08:00', '']],                  // 开机晚于截止时刻 → 仍不配对
  '阈值表': [['位号', '阈值类型', '阈值', '期初累计小时'], ['P-01', '运行小时', '100h', 40]],
});
r = run(OPEN, [], 'open-default');
eq(r.j.byEquipment.find((x) => x.tag === 'P-01').periodHours, 48, 'V1 默认不给 --running-until：空停机时间段不计入（原口径不变）');
eq(r.s.counts.unpaired, 2, 'V2 默认两条空停机时间均单列不配对');
r = run(OPEN, ['--running-until', '2026-09-21 08:00'], 'open-until');
const rj = r.j || { byEquipment: [], exceeded: [], warnings: [], meta: {} };
const o1 = rj.byEquipment.find((x) => x.tag === 'P-01') || {};
eq(o1.periodHours, 72, 'V3 给 --running-until 后仍在运行段计到该时刻（48+24）');
eq(o1.cumHours, 112, 'V4 累计 = 期初 40 + 本期 72');
ok(rj.exceeded.some((x) => x.tag === 'P-01'), 'V5 计入仍在运行段后超 100h 阈值（不再漏判）');
eq((r.s.counts || {}).unpaired, 1, 'V6 开机晚于截止时刻的 P-02 仍单列不配对');
ok(rj.warnings.some((w) => w.includes('P-01') && w.includes('仍在运行') && w.includes('2026-09-21 08:00')), 'V7 warning 点名按「截至该时刻仍在运行」计入的设备');
eq(rj.meta.runningUntil, '2026-09-21 08:00', 'V8 meta 记录 runningUntil');
ok(/仍在运行/.test(r.md || ''), 'V9 报告写明仍在运行段的计入口径');
ok(raw(['--input', OPEN, '--workshop', 'X', '--date', DATE, '--running-until', '昨天']).s.ok === false, 'V10 --running-until 无法解析报错');
ok(raw(['--input', OPEN, '--workshop', 'X', '--date', DATE, '--running-until', '2026-09-23 08:00']).s.ok === false, 'V11 --running-until 晚于 --date 当天报错');
// 状态时序末条为运行，同样按 --running-until 计入
const OPENS = mk('open-series.xlsx', {
  '运行状态记录': [['位号', '时间', '运行状态'], ['P-05', '2026-09-20 08:00', '运行'], ['P-05', '2026-09-20 20:00', '运行']],
});
r = run(OPENS, ['--running-until', '2026-09-21 08:00'], 'open-series');
eq(((r.j && r.j.byEquipment.find((x) => x.tag === 'P-05')) || {}).periodHours, 24, 'V12 状态时序末条为运行，按 --running-until 计到该时刻');
// 上期 JSON 截止日不早于本期记录：续算会重复计入，必须提示
r = run(BASE, [], 'prev-overlap-src');
r = run(BASE, ['--prev', path.join(r.out, 'runtime.json')], 'prev-overlap');
ok(r.j.warnings.some((w) => w.includes('上期') && w.includes('重复计入')), 'V13 上期截止日不早于本期最早运行段 → warning 提示重复计入');
// 上期 JSON 中该设备累计小时为空：不得按 0 续算（否则累计只剩本期增量却标「上期续算」）
const prevNull = path.join(work, 'prev-null.json');
fs.writeFileSync(prevNull, JSON.stringify({ meta: { date: '2026-08-31' }, byEquipment: [{ tag: 'P-01', cumHours: null, cumStarts: 3 }] }), 'utf8');
r = run(BASE, ['--prev', prevNull], 'prev-null');
const pn = r.j.byEquipment.find((x) => x.tag === 'P-01');
eq(pn.cumHours, null, 'V14 上期累计小时为空 → 本期累计为 null，不按 0 续算');
ok(r.j.warnings.some((w) => w.includes('P-01') && w.includes('上期') && w.includes('未按 0')), 'V15 warning 写明上期累计为空、未按 0 续算');
ok(!r.j.exceeded.some((x) => x.tag === 'P-01' && x.kind === 'hours') && r.j.undetermined.some((x) => x.tag === 'P-01'), 'V16 运行小时阈值改判未判定，不按本期增量判');
eq(pn.cumStarts, 5, 'V17 启停次数上期有值时照常续算（3+2）');

// ============ W. --running-until 只认每台时间上最后一段；重叠与「当前最大结束时刻」比较；上期启停为空不按 0 续算 ============
const MID = mk('mid-open.xlsx', {
  '启停记录': [['位号', '开机时间', '停机时间'],
    ['P-01', '2026-09-01 08:00', ''],                   // 空停机，但其后还有开停记录 → 不是在运段，仍单列
    ['P-01', '2026-09-05 08:00', '2026-09-07 08:00'],   // 48h
    ['P-01', '2026-09-10 08:00', '2026-09-11 08:00']],  // 24h
});
r = run(MID, ['--running-until', '2026-09-21 08:00'], 'mid-open');
const m1 = ((r.j && r.j.byEquipment) || []).find((x) => x.tag === 'P-01') || {};
eq(m1.periodHours, 72, 'W1 中间的空停机行不计到截止时刻（48+24），只认最后一段');
eq((r.s.counts || {}).unpaired, 1, 'W2 中间的空停机行仍按不配对单列');
eq((r.s.counts || {}).overlaps, 0, 'W3 未把中间空停机行延到截止时刻，不产生虚假重叠');
ok(!((r.j && r.j.warnings) || []).some((w) => w.includes('仍在运行') && w.includes('P-01')), 'W4 中间空停机行不在「仍在运行」warning 里点名');
const LAST2 = mk('last-open2.xlsx', {
  '启停记录': [['位号', '开机时间', '停机时间'],
    ['P-01', '2026-09-10 08:00', ''],                   // 其后有 09-12 的停机记录 → 不是最后
    ['P-01', '2026-09-05 08:00', '2026-09-12 08:00'],
    ['P-03', '2026-09-15 08:00', ''],                   // 同台两条空停机：只认最晚一条
    ['P-03', '2026-09-20 08:00', '']],
});
r = run(LAST2, ['--running-until', '2026-09-21 08:00'], 'last-open2');
const l1 = ((r.j && r.j.byEquipment) || []).find((x) => x.tag === 'P-01') || {};
const l3 = ((r.j && r.j.byEquipment) || []).find((x) => x.tag === 'P-03') || {};
eq(l1.periodHours, 168, 'W5 空停机行其后还有停机记录 → 不计到截止时刻（只算 09-05~09-12）');
eq(l3.periodHours, 24, 'W6 同台两条空停机只把最晚一条计到截止时刻（09-20 08:00~09-21 08:00）');
ok(((r.j && r.j.warnings) || []).some((w) => w.includes('P-03') && w.includes('仍在运行') && w.includes('启停记录') && !w.includes('状态末条')), 'W7 启停记录来源的 warning 不再写「状态末条为运行」');
const OVL3 = mk('ovl3.xlsx', {
  '启停记录': [['位号', '开机时间', '停机时间'],
    ['P-01', '2026-09-01 00:00', '2026-09-15 00:00'],
    ['P-01', '2026-09-02 00:00', '2026-09-03 00:00'],
    ['P-01', '2026-09-05 00:00', '2026-09-06 00:00']],
});
r = run(OVL3, [], 'ovl3');
eq(r.s.counts.overlaps, 2, 'W8 长段同时覆盖后两段：重叠与当前最大结束时刻比较，两处都检出');
ok(r.j.warnings.filter((w) => w.includes('重叠')).length === 2, 'W9 两处重叠各有 warning');
eq(r.j.byEquipment[0].idleIntervals.length, 0, 'W10 被长段覆盖的间隔不记为停机间隔');
const prevSN = path.join(work, 'prev-starts-null.json');
fs.writeFileSync(prevSN, JSON.stringify({ meta: { date: '2026-08-31' }, byEquipment: [{ tag: 'P-01', cumHours: 1000, cumStarts: null }] }), 'utf8');
const STH = mk('starts-th.xlsx', {
  '启停记录': [['位号', '开机时间', '停机时间'], ['P-01', '2026-09-02 08:00', '2026-09-03 08:00'], ['P-01', '2026-09-05 08:00', '2026-09-06 08:00']],
  '阈值表': [['位号', '阈值类型', '阈值'], ['P-01', '启停次数', '50次']],
});
r = run(STH, ['--prev', prevSN], 'prev-starts-null');
const ps = r.j.byEquipment.find((x) => x.tag === 'P-01');
eq(ps.cumStarts, null, 'W11 上期累计启停为空 → 本期累计启停为 null，不按 0 续算');
eq(ps.cumHours, 1048, 'W12 上期累计小时有值照常续算（1000+48）');
ok(r.j.warnings.some((w) => w.includes('P-01') && w.includes('启停') && w.includes('未按 0')), 'W13 warning 写明上期累计启停为空、未按 0 续算');
ok(r.j.undetermined.some((x) => x.tag === 'P-01' && x.kind === 'starts'), 'W14 启停次数阈值判未判定');

// ============ X. 同一时刻停机又开机（第三轮 R4）；重叠与所有未结束段比较（R13）；阈值表有、窗口内无记录的设备照常列出（v1-5） ============
const SAMEPT = mk('same-instant.xlsx', {
  '启停记录': [['位号', '开机时间', '停机时间'],
    ['P-01', '2026-09-01 08:00', '2026-09-10 08:00'],   // 216h
    ['P-01', '2026-09-10 08:00', ''],                   // 同一时刻再开机，停机为空 → 最后一段，计到截止时刻 264h
    ['P-02', '2026-09-01', '2026-09-10'],               // 只有日期：同样是停机=开机
    ['P-02', '2026-09-10', '']],
});
r = run(SAMEPT, ['--running-until', '2026-09-21 08:00'], 'same-instant');
const sp1 = ((r.j && r.j.byEquipment) || []).find((x) => x.tag === 'P-01') || {};
const sp2 = ((r.j && r.j.byEquipment) || []).find((x) => x.tag === 'P-02') || {};
eq(sp1.periodHours, 480, 'X1 停机时刻正好等于下一段开机时刻：后一段仍是最后一段，计到 --running-until（216+264）');
eq(sp2.periodHours, 488, 'X2 只有日期的记录同样处理（216+272）');
eq((r.s.counts || {}).unpaired, 0, 'X3 同一时刻停机又开机不判不配对');
eq((r.s.counts || {}).overlaps, 0, 'X4 首尾相接不算重叠');
const OVLN = mk('ovl-nested.xlsx', {
  '启停记录': [['位号', '开机时间', '停机时间'],
    ['P-01', '2026-09-01 00:00', '2026-09-15 00:00'],
    ['P-01', '2026-09-02 00:00', '2026-09-05 00:00'],
    ['P-01', '2026-09-03 00:00', '2026-09-06 00:00']],
});
r = run(OVLN, [], 'ovl-nested');
eq(r.s.counts.overlaps, 3, 'X5 被同一长段覆盖的两段之间互相重叠也检出（2-3、2-4、3-4）');
ok(r.j.warnings.some((w) => w.includes('第3行与第4行')), 'X6 第 3、4 行之间的重叠有 warning');
const NOREC = mk('no-record.xlsx', {
  '启停记录': [['位号', '开机时间', '停机时间'], ['P-01A', '2026-09-02 08:00', '2026-09-03 08:00']],
  '阈值表': [['位号', '设备名称', '阈值类型', '阈值', '期初累计小时'],
    ['P-01A', '泵A', '运行小时', 8000, 100],
    ['P-01B', '泵B', '运行小时', 8000, 7500],     // 备机：窗口内无启停记录，累计 = 期初，判接近阈值
    ['P-03', '泵3', '运行小时', 8000, 9000]],     // 无记录但期初已超
});
r = run(NOREC, [], 'no-record');
const nb = ((r.j && r.j.byEquipment) || []).find((x) => x.tag === 'P-01B') || {};
const n3 = ((r.j && r.j.byEquipment) || []).find((x) => x.tag === 'P-03') || {};
eq(((r.j && r.j.byEquipment) || []).length, 3, 'X7 阈值表有、窗口内无记录的设备照常列出');
eq((r.s.counts || {}).equipment, 1, 'X7b counts.equipment 仍只计本期有记录的设备');
eq((r.s.counts || {}).noRunRecord, 2, 'X7c counts.noRunRecord 另计本期无运行记录的设备');
eq((r.s.counts || {}).listed, 3, 'X7d counts.listed = 列出的设备总数');
eq(nb.periodHours, 0, 'X8 无运行记录的设备本期 0h');
eq(nb.cumHours, 7500, 'X9 累计 = 期初值');
eq(nb.noRunRecord, true, 'X10 标注本期无运行记录');
ok(r.j.dueSoon.some((x) => x.tag === 'P-01B'), 'X11 无记录设备照常判阈值（7500/8000 接近）');
ok(r.j.exceeded.some((x) => x.tag === 'P-03'), 'X12 无记录设备期初已超阈值 → 已超');
ok(r.j.warnings.some((w) => w.includes('本期无运行记录') && w.includes('P-01B') && w.includes('P-03')), 'X13 warning 点名本期无运行记录的设备');
ok(/本期无运行记录/.test(r.md || ''), 'X14 报告注明本期无运行记录');
ok(((r.j && r.j.items) || []).some((x) => x.tag === 'P-01B' && x.cumulativeHours === 7500), 'X15 下游 items 也带上无记录设备');
r = run(NOREC, ['--equipment', 'P-01A'], 'no-record-only');
eq((r.s.counts || {}).listed, 1, 'X16 --equipment 限定范围时不补范围外的无记录设备');

// ============ WS. 车间范围核对（D007）：启停记录/运行状态记录/运行记录/阈值表混入其他车间时剔除；空车间保留；全不一致不筛并开头【注意】；无车间列/维护工厂不筛 ============
{
  const ws = (x) => ((x.j && x.j.meta && x.j.meta.workshopScope) || []);
  const W = (x) => ((x.s && x.s.warnings) || []);
  let plantBook = null;
  const mkP = (n, b) => { plantBook = b; return mk(n, b); };
  const MIX = mk('ws-mix.xlsx', {
    '启停记录': [['位号', '设备名称', '车间', '开机时间', '停机时间'],
      ['P-01', '泵1', '测试车间', '2026-09-01 08:00', '2026-09-03 08:00'],
      ['P-02', '泵2', '', '2026-09-01 00:00', '2026-09-02 00:00'],
      ['P-91', '外车间泵', '催化车间', '2026-09-01 00:00', '2026-09-11 00:00'],
      ['P-91', '外车间泵', '催化车间', '2026-09-12 00:00', '2026-09-13 00:00']],
    '阈值表': [['位号', '车间', '部件', '阈值类型', '阈值', '上次归零日期'],
      ['P-01', '测试车间', '整机', '运行小时', 100, '2026-09-01'],
      ['P-91', '催化车间', '整机', '运行小时', 200, '2026-09-01'],
      ['P-95', '催化车间', '整机', '运行小时', 200, '2026-09-01']],
  });
  r = run(MIX, [], 'ws-mix');
  eq(r.s.ok, true, 'WS1 车间混合输入运行成功');
  eq((r.s.counts || {}).equipment, 2, 'WS2 剔除其他车间后设备数 2（P-01/P-02）');
  eq((r.s.counts || {}).exceeded, 0, 'WS3 其他车间 P-91 超阈值不计入本车间');
  ok(!((r.j && r.j.byEquipment) || []).some((x) => /^P-9/.test(x.tag)), 'WS4 明细不含其他车间位号（含阈值表里的 P-95）');
  eq((r.s.counts || {}).noRunRecord, 0, 'WS5 阈值表其他车间设备不按「本期无运行记录」列入');
  ok(W(r).some((w) => w.includes('工作表「启停记录」按 --workshop「测试车间」剔除其他车间 2 行') && w.includes('催化车间 2 行')), 'WS6 warning 写明剔除行数与车间名');
  const s0 = ws(r).find((x) => x.sheet === '启停记录') || {};
  eq(s0.status, 'checked', 'WS7 meta.workshopScope 启停记录状态 checked');
  eq(s0.droppedRows, 2, 'WS8 meta.workshopScope 记录剔除 2 行');
  eq((s0.dropped || {})['催化车间'], 2, 'WS9 dropped 按车间名记行数');
  eq(s0.blank, 1, 'WS10 车间为空 1 行计入 blank');
  ok(((r.j && r.j.byEquipment) || []).some((x) => x.tag === 'P-02' && x.periodHours === 24), 'WS11 车间为空的 P-02 按本车间保留并累计');
  ok(W(r).some((w) => w.includes('工作表「启停记录」车间列为空 1 行，按本车间保留')), 'WS12 车间为空 warning 写明行数');
  ok(/车间范围：已按车间列核对「测试车间」，剔除其他车间的行：「启停记录」2 行（催化车间 2 行）；「阈值表」2 行（催化车间 2 行）/.test(r.md || ''), 'WS13 md 口径处写明两张表的剔除情况');
  ok(ws(r).some((x) => x.sheet === '阈值表' && x.status === 'checked' && x.droppedRows === 2), 'WS14 meta.workshopScope 含阈值表核对结果');

  const MIS = mk('ws-mis.xlsx', { '启停记录': [['位号', '车间', '开机时间', '停机时间'], ['P-91', '催化车间', '2026-09-01 00:00', '2026-09-02 00:00']] });
  r = run(MIS, [], 'ws-mis');
  eq((r.s.counts || {}).equipment, 1, 'WS15 车间列全不一致时不筛');
  eq((ws(r)[0] || {}).status, 'mismatch', 'WS16 meta.workshopScope 状态 mismatch');
  ok(W(r).some((w) => w.startsWith('【注意】') && w.includes('催化车间')), 'WS17 全不一致 warning 以【注意】开头');
  ok(/^# [^\n]*\n\n【注意】工作表「启停记录」的车间列取值与 --workshop「测试车间」不一致，未按车间筛选，请核对输入。/.test(r.md || ''), 'WS18 md 标题后紧跟【注意】提示');
  ok(((r.md || '').split('## 一、')[0]).includes('车间列取值与 --workshop'), 'WS19 【注意】在正文第一节之前');

  r = run(BASE, [], 'ws-nocol');
  ok(ws(r).length === 2 && ws(r).every((x) => x.status === 'noColumn'), 'WS20 无车间列：启停记录与阈值表均为 noColumn');
  ok(/车间范围：输入未含车间列，车间范围以取数条件为准。/.test(r.md || ''), 'WS21 无车间列时 md 口径写明以取数条件为准');
  eq((r.s.counts || {}).equipment, 2, 'WS22 无车间列不筛');

  const PLANT = mkP('ws-plant.xlsx', { '启停记录': [['位号', '维护工厂', '开机时间', '停机时间'],
    ['P-01', '1100', '2026-09-01 08:00', '2026-09-03 08:00'], ['P-02', '1200', '2026-09-01 00:00', '2026-09-02 00:00']] });
  r = run(PLANT, [], 'ws-plant');
  eq((ws(r)[0] || {}).status, 'noColumn', 'WS23 「维护工厂」不当车间列（noColumn）');
  ok((ws(r)[0] || {}).column === null && !(ws(r)[0] || {}).ignoredColumn, 'WS24 「维护工厂」不读入车间字段（column 为 null，无 ignoredColumn）');
  eq((r.s.counts || {}).equipment, 2, 'WS25 「维护工厂」列不参与筛选');
  // 人员列「车间负责人」不当车间列（common.js 只认 车间/所属车间/属地车间/运行部 及其后加「名称」）
  r = run(mk('ws-person.xlsx', JSON.parse(JSON.stringify(plantBook).split('维护工厂').join('车间负责人'))), [], 'ws-person');
  ok((ws(r)[0] || {}).status === 'noColumn' && (ws(r)[0] || {}).ignoredColumn === '车间负责人' && r.s.ok === true, 'WS28 「车间负责人」人员列判 noColumn，ignoredColumn 记下，不筛');

  // 运行记录（第三种来源）混入其他车间
  const RUNW = mk('ws-run.xlsx', { '运行记录': [['位号', '车间', '运行时长'], ['P-01', '测试车间', 100], ['P-91', '催化车间', 500]] });
  r = run(RUNW, [], 'ws-run');
  ok(ws(r).some((x) => x.sheet === '运行记录' && x.status === 'checked' && x.droppedRows === 1) && (r.s.counts || {}).equipment === 1, 'WS26 运行记录剔除其他车间行');
  // 运行状态记录（时序）混入其他车间
  const SERW = mk('ws-series.xlsx', { '运行状态记录': [['位号', '车间', '时间', '运行状态'],
    ['P-01', '测试车间', '2026-09-01 00:00', '运行'], ['P-01', '测试车间', '2026-09-02 00:00', '停机'],
    ['P-91', '催化车间', '2026-09-01 00:00', '运行'], ['P-91', '催化车间', '2026-09-05 00:00', '停机']] });
  r = run(SERW, [], 'ws-series');
  ok(ws(r).some((x) => x.sheet === '运行状态记录' && x.status === 'checked' && x.droppedRows === 2) && (r.s.counts || {}).equipment === 1, 'WS27 运行状态记录剔除其他车间行');
}

// ============ Z. 上期 runtime.json 的车间核对（D007 遗留 1）：不一致不续算、开头【注意】；未注明照常续算并说明 ============
{
  const src = JSON.parse(fs.readFileSync(prevPath, 'utf8'));
  const variant = (name, ws) => { const j = JSON.parse(JSON.stringify(src)); if (ws === undefined) delete j.meta.workshop; else j.meta.workshop = ws; const p = path.join(work, name); fs.writeFileSync(p, JSON.stringify(j)); return p; };
  const pw = (x) => ((x.j && x.j.meta && x.j.meta.prevWorkshop) || {}).status;
  const p01 = (x) => (x.j.byEquipment.find((e) => e.tag === 'P-01') || {}).cumHours;
  let z = run(BASE, ['--prev', prevPath], 'z-same');
  eq(pw(z), 'matched', 'Z1 上期车间一致：status matched');
  eq(p01(z), 144, 'Z2 上期车间一致：照常续算（72+72）');
  z = run(BASE, ['--prev', variant('z-other.json', '加氢车间')], 'z-other');
  eq(pw(z), 'excluded', 'Z3 上期车间不一致：status excluded');
  eq(p01(z), 72, 'Z4 上期车间不一致：不用上期累计续算（累计等于本期）');
  ok(z.j.warnings.some((w) => /^【注意】上期 runtime\.json 的车间为「加氢车间」/.test(w)), 'Z5 上期车间不一致：warning 带【注意】');
  ok(/^【注意】上期 runtime\.json/m.test(z.md.split('## ')[0]), 'Z6 上期车间不一致：报告开头【注意】');
  z = run(BASE, ['--prev', variant('z-nows.json')], 'z-nows');
  eq(pw(z), 'unknown', 'Z7 上期未注明车间：status unknown');
  eq(p01(z), 144, 'Z8 上期未注明车间：照常续算');
  ok(/上期 runtime\.json 未注明车间，无法核对/.test(z.md), 'Z9 上期未注明车间：口径处说明无法核对');
}

console.log(`\n${'='.repeat(56)}`);
console.log(`runtime-hours-tracker 自测：${pass} 通过，${fail} 失败`);
if (failures.length) { console.log('\n失败项：'); failures.forEach((f) => console.log('  ✗ ' + f)); }
console.log('='.repeat(56));
try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
