#!/usr/bin/env node
'use strict';
/**
 * 自测：生成变体输入并断言 energy.js 行为。用法：node scripts/selftest.js（全绿退出 0）
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { writeXlsx, readXlsx } = require('./lib/xlsx-lite');

const ENERGY = path.join(__dirname, 'energy.js');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'eea-selftest-'));
const FROM = '2026-09-01', TO = '2026-09-20';
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

function run(file, extra = [], tag, type = '离心泵') {
  const out = path.join(work, (tag || path.basename(file, '.xlsx')) + '-out');
  const r = spawnSync(process.execPath, [ENERGY, '--input', file, '--workshop', '测试车间',
    '--equip-type', type, '--from', FROM, '--to', TO, '--out', out, ...extra], { encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  let summary;
  try { summary = JSON.parse(lines[lines.length - 1]); } catch (e) { summary = { ok: false, error: 'no-json:' + r.stdout + r.stderr }; }
  let data = null, md = null;
  if (fs.existsSync(path.join(out, 'energy.json'))) data = JSON.parse(fs.readFileSync(path.join(out, 'energy.json'), 'utf8'));
  if (fs.existsSync(path.join(out, 'energy.md'))) md = fs.readFileSync(path.join(out, 'energy.md'), 'utf8');
  return { code: r.status, summary, data, md, out };
}
function mk(name, book) { const p = path.join(work, name); writeXlsx(p, book); return p; }

const G = 9.80665;
/** 按目标效率反推轴功率 */
const shaftFor = (rho, q, h, eff) => Number((((rho * G * q * h) / 3600000) / eff).toFixed(4));
const PUMP_HDR = ['设备位号', '设备名称', '设备类型', '分组', '流量', '扬程', '介质密度', '轴功率', '电机功率', '电机效率', '运行时间'];
const pumpRow = (tag, eff, opts = {}) => [tag, tag + '泵', '离心泵', opts.group || 'G1',
  opts.q ?? 300, opts.h ?? 90, opts.rho ?? 850,
  opts.shaft !== undefined ? opts.shaft : shaftFor(opts.rho ?? 850, opts.q ?? 300, opts.h ?? 90, eff),
  opts.mp ?? '', opts.me ?? '', opts.hours ?? 7000];
let r, b, s1, s7;

const base = mk('base.xlsx', {
  '运行数据': [PUMP_HDR,
    pumpRow('P-01', 0.80), pumpRow('P-02', 0.75), pumpRow('P-03', 0.60)],
});
// ---- 1. 基础：泵效率按 ρgQH/轴功率 计算
section('BVT', () => {
  r = run(base, [], 'base');
  eq(r.summary.ok, true, '1.1 基础运行成功');
  eq(r.code, 0, '1.2 退出码 0');
  eq(r.summary.counts.equipment, 3, '1.3 设备数');
  eq(r.summary.counts.calculated, 3, '1.4 完成计算数');
});
section('A', () => {
  eq(r.data.byEquipment[0].efficiencyPct, 80, '1.5 P-01 效率 80%');
  eq(r.data.byEquipment[2].efficiencyPct, 60, '1.6 P-03 效率 60%');
  ok(Math.abs(r.data.byEquipment[0].usefulPower - (850 * G * 300 * 90) / 3600000) < 1e-3, '1.7 有效功率 = ρgQH/3600000');
  eq(r.data.byEquipment[0].shaftPowerSource, '直接读取轴功率', '1.8 轴功率来源标注');
});

// ---- 2. 组内排名与中位数（同类横向对比）
section('A', () => {
  eq(r.data.byEquipment[0].groupRank, 1, '2.1 效率最高的排名第 1');
  eq(r.data.byEquipment[0].groupSize, 3, '2.2 组内台数');
  eq(r.data.groupComparison[0].medianPct, 75, '2.3 组内中位数为 75%');
  eq(r.data.groupComparison[0].maxPct, 80, '2.4 组内最高');
  eq(r.data.groupComparison[0].minPct, 60, '2.5 组内最低');
  eq(r.data.groupComparison[0].comparable, true, '2.6 组内 ≥2 台构成横向对比');
  eq(r.data.byEquipment[2].baselineKind, 'groupMedian', '2.7 无设计值时基准为组内中位数');
  eq(r.summary.counts.lowEfficiency, 1, '2.8 低于中位数 90% 的 1 台判偏低（60% < 75%×0.9）');
  eq(r.data.lowEfficiency[0].tag, 'P-03', '2.9 偏低设备位号正确');
});

const lack = mk('lack.xlsx', {
  '运行数据': [PUMP_HDR,
    pumpRow('P-01', 0.80),
    ['P-11', '缺密度泵', '离心泵', 'G1', 300, 90, '', 78, '', '', 7000],
    ['P-12', '缺扬程泵', '离心泵', 'G1', 300, '', 850, 78, '', '', 7000],
    ['P-13', '缺功率泵', '离心泵', 'G1', 300, 90, 850, '', '', '', 7000],
    ['P-14', '有电机功率无电机效率', '离心泵', 'G1', 300, 90, 850, '', 85, '', 7000]],
});
// ---- 3. 硬约束 1：计算参数不全 → 效率 null + insufficientData，绝不用典型值
section('A', () => {
  r = run(lack, [], 'lack');
  eq(r.summary.counts.insufficientData, 4, '3.1 四台参数不全归入 insufficientData');
  eq(r.summary.counts.calculated, 1, '3.2 参数不全的不计入完成计算');
  ok(r.data.insufficientData.every((x) => x.efficiency === null && x.efficiencyPct === null), '3.3 参数不全的效率为 null');
  ok(r.data.insufficientData.find((x) => x.tag === 'P-11').missing.includes('介质密度'), '3.4 缺介质密度被记录');
  ok(r.data.insufficientData.find((x) => x.tag === 'P-12').missing.includes('扬程'), '3.5 缺扬程被记录');
  ok(r.data.insufficientData.find((x) => x.tag === 'P-13').missing.some((m) => /轴功率与电机功率均缺失/.test(m)), '3.6 缺功率被记录');
  ok(r.data.insufficientData.find((x) => x.tag === 'P-14').missing.some((m) => /电机效率/.test(m)), '3.7 有电机功率无电机效率不折算');
  ok(r.data.warnings.some((w) => /未用典型值代替/.test(w)), '3.8 warning 明确未用典型值代替');
  ok(/未用典型效率值或典型参数代替缺失项/.test(r.md), '3.9 报告写明未用典型值代替');
  ok(!r.data.insufficientData.some((x) => x.efficiency === 0), '3.10 参数不全绝不按 0 处理');
  ok(r.data.lowEfficiency.every((x) => x.category === 'calculated'), '3.11 参数不全的不进能效偏低清单');
  ok(r.data.groupComparison[0].size === 1, '3.12 参数不全的不进组内对比样本');
});

const bad = mk('bad.xlsx', {
  '运行数据': [PUMP_HDR,
    pumpRow('P-01', 0.80),
    pumpRow('P-21', 0, { shaft: 9.5 }),        // 轴功率过小 → 效率远超 100%
    pumpRow('P-22', 0, { shaft: 1e9 })],        // 轴功率过大 → 效率接近 0
});
// ---- 4. 硬约束 2：超出物理合理范围 → implausible 单列，不截断
section('A', () => {
  r = run(bad, [], 'bad');
  eq(r.summary.counts.implausible, 1, '4.1 效率 > 100% 的计入 implausible');
  eq(r.data.implausible[0].tag, 'P-21', '4.2 异常值位号正确');
  ok(r.data.implausible[0].efficiencyPct > 100, '4.3 算得效率原样保留（>100%），未截断到 100');
  eq(r.data.implausible[0].efficiency !== null, true, '4.4 异常值保留原始计算结果');
  ok(r.data.warnings.some((w) => /超出物理合理范围/.test(w) && /未截断/.test(w)), '4.5 warning 提示核实数据且未截断');
  ok(/未截断到合理范围后呈现/.test(r.md), '4.6 报告写明未截断');
  ok(!r.data.lowEfficiency.some((x) => x.tag === 'P-21'), '4.7 异常值不进能效偏低清单');
  ok(!r.data.groupComparison[0].members.some((m) => m.tag === 'P-21'), '4.8 异常值不参与组内对比');
  ok(r.data.byEquipment.find((x) => x.tag === 'P-22').category === 'calculated'
    || r.data.byEquipment.find((x) => x.tag === 'P-22').category === 'implausible', '4.9 极小效率仍有明确归类');
});

// ---- 5. 硬约束 3：无设计参数 → 不做偏差分析、不引用通用典型效率值
section('A', () => {
  r = run(base, [], 'nodesign');
  eq(r.data.meta.designProvided, false, '5.1 未提供设计参数');
  ok(r.data.byEquipment.every((x) => x.designEfficiency === null && x.designDeviationPct === null), '5.2 设计效率与偏差均为 null');
  ok(r.data.warnings.some((w) => /不引用通用典型效率值/.test(w)), '5.3 warning 说明不引用通用典型值');
  ok(/未引用通用典型效率值作为基准/.test(r.md), '5.4 报告写明不引用通用典型效率值');
  ok(/—（未提供设计参数，仅做同类横向对比）/.test(r.md), '5.5 概览显示 — 而不是 0');
  ok(r.data.lowEfficiency.every((x) => x.baselineKind === 'groupMedian'), '5.6 偏低基准只能是组内中位数');
});

const solo = mk('solo.xlsx', {
  '运行数据': [PUMP_HDR, pumpRow('P-31', 0.42, { group: '独立组' })],
});
// ---- 6. 组内无同类可比且无设计值 → 不判偏低（不拿典型值当基准）
section('A', () => {
  r = run(solo, [], 'solo');
  eq(r.summary.counts.lowEfficiency, 0, '6.1 无可比基准时不判偏低');
  eq(r.data.byEquipment[0].lowJudgement, 'notComparable', '6.2 标为无可比基准');
  eq(r.data.byEquipment[0].baselinePct, null, '6.3 基准为 null');
  eq(r.data.groupComparison[0].comparable, false, '6.4 组内 1 台不构成横向对比');
  ok(/不构成横向对比/.test(r.data.groupComparison[0].note), '6.5 说明不构成横向对比');
});

const withDesign = mk('withdesign.xlsx', {
  '运行数据': [PUMP_HDR, pumpRow('P-41', 0.80), pumpRow('P-42', 0.65)],
  '设计参数': [['设备位号', '额定流量', '额定扬程', '额定功率', '设计效率'],
    ['P-41', 300, 90, 80, 82], ['P-42', 300, 90, 80, 82]],
});
// ---- 7. 有设计参数 → 做偏差分析，基准为设计效率
section('A', () => {
  r = run(withDesign, [], 'withdesign');
  eq(r.data.meta.designProvided, true, '7.1 设计参数已识别');
  eq(r.data.byEquipment[0].designEfficiencyPct, 82, '7.2 设计效率按 82 读为 82%');
  eq(r.data.byEquipment[0].designDeviationPct, -2, '7.3 与设计值偏差 -2 百分点');
  eq(r.data.byEquipment.find((x) => x.tag === 'P-42').baselineKind, 'design', '7.4 有设计值时基准为设计效率');
  eq(r.summary.counts.lowEfficiency, 1, '7.5 65% < 82%×0.9 判偏低');
});
const designDec = mk('designdec.xlsx', {
  '运行数据': [PUMP_HDR, pumpRow('P-41', 0.80)],
  '设计参数': [['设备位号', '设计效率'], ['P-41', 0.82]],
});
const designBad = mk('designbad.xlsx', {
  '运行数据': [PUMP_HDR, pumpRow('P-41', 0.80), pumpRow('P-42', 0.60)],
  '设计参数': [['设备位号', '设计效率'], ['P-41', 180]],
});
// 设计效率写成小数
section('B', () => {
  r = run(designDec, [], 'designdec');
  eq(r.data.byEquipment[0].designEfficiencyPct, 82, '7.6 设计效率 0.82 与 82 等价');
});
// 设计效率不合理 → 按缺设计效率处理并 warning
section('C', () => {
  r = run(designBad, [], 'designbad');
  eq(r.data.byEquipment[0].designEfficiencyPct, null, '7.7 设计效率超合理范围按缺失处理');
  ok(r.data.warnings.some((w) => /设计效率/.test(w) && /合理范围/.test(w)), '7.8 warning 提示核实设计参数表');
});

// ---- 8. 硬约束 4：能效偏低只给需核实方向，不断言原因
section('A', () => {
  r = run(base, [], 'lowreason');
  eq(r.data.lowEfficiency[0].lowReason, null, '8.1 不输出原因字段');
  ok(r.data.lowEfficiency[0].checkPoints.length >= 3, '8.2 给出需核实方向');
  ok(r.data.lowEfficiency[0].checkPoints.some((c) => /工况/.test(c)), '8.3 含运行工况偏离方向');
  ok(r.data.lowEfficiency[0].checkPoints.some((c) => /磨损/.test(c)), '8.4 含叶轮磨损方向');
  ok(r.data.lowEfficiency[0].checkPoints.some((c) => /管网阻力/.test(c)), '8.5 含管网阻力变化方向');
  ok(/未判定能效偏低的原因/.test(r.md), '8.6 报告声明未判定原因');
});

const withPrice = mk('withprice.xlsx', {
  '运行数据': [PUMP_HDR, pumpRow('P-51', 0.80), pumpRow('P-52', 0.75), pumpRow('P-53', 0.60)],
  '单价': [['能源介质', '单价', '计价单位'], ['电', 0.62, 'kWh']],
});
const noHours = mk('nohours.xlsx', {
  '运行数据': [PUMP_HDR, pumpRow('P-61', 0.80), pumpRow('P-62', 0.75), pumpRow('P-63', 0.60, { hours: '' })],
  '单价': [['能源介质', '单价', '计价单位'], ['电', 0.62, 'kWh']],
});
// ---- 9. 硬约束 5：费用差额须注明是当前运行条件测算，不等于节能收益
section('B', () => {
  r = run(withPrice, [], 'withprice');
  eq(r.data.meta.priceProvided, true, '9.1 单价已识别');
  ok(r.data.savingPotential.length === 1 && r.data.savingPotential[0].annualCostGap > 0, '9.2 费用差额已测算');
  ok(/不等于可实现的节能收益/.test(r.data.meta.savingStatement), '9.3 声明不等于节能收益');
  ok(/不等于可实现的节能收益/.test(r.md), '9.4 报告含费用差额声明行');
  ok(r.data.savingPotential[0].statement === r.data.meta.savingStatement, '9.5 逐条带声明');
  // 测算参照与偏低基准一致：设计效率或组内中位数（不是组内最优）
  eq(r.data.savingPotential[0].baselineKind, 'groupMedian', '9.12 本例费用差额以组内中位数为参照');
  ok(/组内中位数/.test(r.data.meta.savingStatement) && !/组内最优/.test(r.data.meta.savingStatement) && !/组内最优/.test(r.md), '9.13 声明行写明以设计效率或组内中位数为参照，不写「组内最优」');
  // 无运行时间 → 不测算，不用典型运行小时代替
  r = run(noHours, [], 'nohours');
  // D006 改口径：运行时间为空的设备列为「运行状态未知」，不判偏低，因而不进费用差额测算（原 9.6/9.7 断言缺运行时间的偏低设备不测算，现在该设备不再判偏低）
  ok(!r.data.savingPotential.some((x) => x.tag === 'P-63' && x.annualCostGap !== null), '9.6 缺运行时间不测算费用差额（D006：P-63 不进测算）');
  eq((r.data.byEquipment.find((x) => x.tag === 'P-63') || {}).lowJudgement, 'runUnknown', '9.7 缺运行时间的设备判运行状态未知，未用典型运行小时代替（D006）');
});
// 无单价 → 不测算，不按典型电价
section('A', () => {
  r = run(base, [], 'noprice');
  eq(r.data.meta.priceProvided, false, '9.8 未提供单价');
  eq(r.data.savingPotential.length, 0, '9.9 无单价时不做测算');
  ok(r.data.warnings.some((w) => /不按典型电价代替/.test(w)), '9.10 warning 说明不按典型电价代替');
  ok(/未提供能源单价，不做费用差额测算/.test(r.md), '9.11 报告说明未提供单价');
});

// ---- 10. 硬约束 6：与 energy-weekly-report 的边界写进产出
section('B', () => {
  ok(/energy-weekly-report/.test(r.data.meta.boundary), '10.1 meta 写明与装置能耗周报的边界');
  ok(/单台设备的能效口径/.test(r.data.meta.boundary), '10.2 boundary 说明本技能是单机口径');
  ok(/energy-weekly-report/.test(r.md), '10.3 报告写明边界');
  eq((r.md.match(/energy-weekly-report/g) || []).length >= 2, true, '10.4 报告头尾两处写明边界');
});

const mixed = mk('mixed.xlsx', {
  '运行数据': [['设备位号', '设备名称', '设备类型', '分组', '流量', '全压', '轴功率', '进口压力', '出口压力',
    '输出功率', '输入功率', '燃料量', '低位发热值', '有效热负荷', '换热量', '换热面积', '对数平均温差', '运行时间'],
    ['F-01', '风机', '风机', 'A', 36000, 10000, 138.8889, '', '', '', '', '', '', '', '', '', '', 7000],
    ['K-01', '压缩机', '压缩机', 'B', 6000, '', 500, 0.1, 1.0, '', '', '', '', '', '', '', '', 7000],
    ['M-01', '电机', '电机', 'C', '', '', '', '', '', 950, 1000, '', '', '', '', '', '', 7000],
    ['H-01', '加热炉', '加热炉', 'D', '', '', '', '', '', '', '', 2, 40000, 72000, '', '', '', 7000],
    ['E-01', '换热器', '换热器', 'E', '', '', '', '', '', '', '', '', '', '', 3000, 300, 25, 7000]],
});
const badRatio = mk('badratio.xlsx', {
  '运行数据': [['设备位号', '设备类型', '流量', '进口压力', '出口压力', '轴功率'],
    ['K-02', '压缩机', 6000, 1.0, 0.8, 500]],
});
// ---- 11. 各设备类型的计算口径
section('A', () => {
  r = run(mixed, [], 'mixed', '风机');
  eq(r.summary.ok, true, '11.1 混合类型运行成功');
  eq(r.summary.counts.equipment, 5, '11.2 五台设备');
  ok(Math.abs(r.data.byEquipment.find((x) => x.tag === 'F-01').efficiencyPct - 72) < 0.5, '11.3 风机效率 = 风量×全压/轴功率');
  ok(r.data.byEquipment.find((x) => x.tag === 'K-01').efficiencyPct > 0
    && r.data.byEquipment.find((x) => x.tag === 'K-01').efficiencyPct <= 100, '11.4 压缩机等温效率在合理范围');
  eq(r.data.byEquipment.find((x) => x.tag === 'M-01').efficiencyPct, 95, '11.5 电机效率 = 输出/输入 = 95%');
  eq(r.data.byEquipment.find((x) => x.tag === 'H-01').efficiencyPct, 90, '11.6 加热炉热效率 = 有效热负荷/燃料总热量 = 90%');
  eq(r.data.byEquipment.find((x) => x.tag === 'E-01').metricName, '传热系数K', '11.7 换热器给传热系数 K');
  eq(r.data.byEquipment.find((x) => x.tag === 'E-01').metricValue, 0.4, '11.8 K = Q/(A×ΔTm) = 0.4');
  eq(r.data.byEquipment.find((x) => x.tag === 'E-01').efficiency, null, '11.9 换热器不折算为 0~100% 效率');
  ok(!r.data.implausible.some((x) => x.tag === 'E-01'), '11.10 换热器 K 值不套用 0~100% 的合理范围判定');
});
// 压缩机出口压力 ≤ 进口压力 → 压比无意义，参数不全
section('C', () => {
  r = run(badRatio, [], 'badratio', '压缩机');
  eq(r.summary.counts.insufficientData, 1, '11.11 出口压力不大于进口压力归入数据不足');
  ok(r.data.insufficientData[0].missing.some((m) => /压比无意义/.test(m)), '11.12 说明压比无意义');
});

const viaMotor = mk('viamotor.xlsx', {
  '运行数据': [PUMP_HDR, pumpRow('P-71', 0, { shaft: '', mp: 100, me: 0.95 })],
});
const viaMotorPct = mk('viamotorpct.xlsx', {
  '运行数据': [PUMP_HDR, pumpRow('P-72', 0, { shaft: '', mp: 100, me: 95 })],
});
// ---- 12. 电机功率 × 电机效率 折算轴功率
section('B', () => {
  r = run(viaMotor, [], 'viamotor');
  eq(r.data.byEquipment[0].shaftPower, 95, '12.1 轴功率 = 电机功率 × 电机效率');
  ok(/电机功率/.test(r.data.byEquipment[0].shaftPowerSource), '12.2 折算来源已标注');
  r = run(viaMotorPct, [], 'viamotorpct');
  eq(r.data.byEquipment[0].shaftPower, 95, '12.3 电机效率写 95 与 0.95 等价');
});

const nan = mk('nan.xlsx', {
  '运行数据': [PUMP_HDR,
    pumpRow('P-01', 0.80),
    ['P-81', '流量未记录泵', '离心泵', 'G1', '未记录', 90, 850, 78, '', '', 7000]],
});
// ---- 13. 数值无法解析 → null 不是 0
section('A', () => {
  r = run(nan, [], 'nan');
  ok(r.data.warnings.some((w) => /无法解析为数字/.test(w)), '13.1 无法解析的数值有 warning');
  eq(r.data.byEquipment.find((x) => x.tag === 'P-81').inputs.流量, null, '13.2 无法解析的流量为 null 不是 0');
  eq(r.data.byEquipment.find((x) => x.tag === 'P-81').category, 'insufficientData', '13.3 无法解析导致参数不全');
  eq(r.data.byEquipment.find((x) => x.tag === 'P-81').efficiency, null, '13.4 效率为 null');
});

// ---- 14. 单位能耗
section('B', () => {
  r = run(base, [], 'specific');
  ok(r.data.byEquipment[0].specificEnergy > 0, '14.1 单位能耗已计算');
  eq(r.data.byEquipment[0].specificEnergyUnit, 'kW/(m³/h)', '14.2 单位能耗单位正确');
});

// ---- 15. --threshold 参数
section('B', () => {
  r = run(withDesign, ['--threshold', '0.99'], 'thr99');
  eq(r.summary.counts.lowEfficiency, 2, '15.1 阈值 0.99 时偏低数增加（80% 与 65% 均低于设计 82%×0.99）');
  r = run(base, ['--threshold', '0.5'], 'thr50');
  eq(r.summary.counts.lowEfficiency, 0, '15.2 阈值 0.5 时无偏低');
  eq(r.data.meta.threshold, 0.5, '15.3 阈值写入 meta');
});

function bad2(args) {
  const rr = spawnSync(process.execPath, [ENERGY, ...args], { encoding: 'utf8' });
  const lines = rr.stdout.trim().split('\n');
  let s; try { s = JSON.parse(lines[lines.length - 1]); } catch (e) { s = { ok: null }; }
  return { code: rr.status, s };
}
const OKARGS = ['--input', base, '--workshop', 'W', '--equip-type', '离心泵', '--from', FROM, '--to', TO];
// ---- 16. 参数校验：缺值、未知参数、非法日期、输入不存在
section('B', () => {
  b = bad2(['--input', base, '--workshop', 'W', '--equip-type', '离心泵', '--from', FROM]);
  eq(b.s.ok, false, '16.1 缺 --to 报错'); eq(b.code, 1, '16.2 缺 --to 退出码 1');
  b = bad2(['--workshop', 'W', '--equip-type', '离心泵', '--from', FROM, '--to', TO]);
  eq(b.s.ok, false, '16.3 缺 --input 报错');
  b = bad2(['--input', base, '--equip-type', '离心泵', '--from', FROM, '--to', TO]);
  eq(b.s.ok, false, '16.4 缺 --workshop 报错');
  b = bad2(['--input', base, '--workshop', 'W', '--from', FROM, '--to', TO]);
  eq(b.s.ok, false, '16.5 缺 --equip-type 报错');
  b = bad2([...OKARGS, '--unknown', 'x']);
  eq(b.s.ok, false, '16.6 未知参数报错');
  ok(/未知参数/.test(b.s.error), '16.7 未知参数错误信息明确');
  b = bad2(['--input', base, '--workshop', 'W', '--equip-type', '离心泵', '--from', '2026-13-45', '--to', TO]);
  eq(b.s.ok, false, '16.8 非法 --from 报错');
  b = bad2(['--input', base, '--workshop', 'W', '--equip-type', '离心泵', '--from', TO, '--to', FROM]);
  eq(b.s.ok, false, '16.9 --from 晚于 --to 报错');
  b = bad2(['--input', path.join(work, '不存在.xlsx'), '--workshop', 'W', '--equip-type', '离心泵', '--from', FROM, '--to', TO]);
  eq(b.s.ok, false, '16.10 输入不存在报错');
  b = bad2(['--input', base, '--workshop', 'W', '--equip-type', '飞机', '--from', FROM, '--to', TO]);
  eq(b.s.ok, false, '16.11 无法识别的设备类型报错');
  b = bad2([...OKARGS, '--threshold', '1.5']);
  eq(b.s.ok, false, '16.12 阈值超出 0~1 报错');
  b = bad2([...OKARGS, '--threshold']);
  eq(b.s.ok, false, '16.13 --threshold 缺取值报错');
  b = bad2([...OKARGS, '--design', path.join(work, '不存在设计.xlsx')]);
  eq(b.s.ok, false, '16.14 设计参数表不存在报错');
  b = bad2(['--input', base, '--workshop', 'W', '--equip-type', '离心泵', '--from', FROM, '--to', '--out']);
  eq(b.s.ok, false, '16.15 值参数取值为下一个 --flag 时报错');
});

const noSheet = mk('nosheet.xlsx', { '别的表': [['a'], ['b']] });
const emptyRun = mk('emptyrun.xlsx', { '运行数据': [PUMP_HDR] });
// ---- 17. 缺表 / 空表
section('B', () => {
  b = bad2(['--input', noSheet, '--workshop', 'W', '--equip-type', '离心泵', '--from', FROM, '--to', TO]);
  eq(b.s.ok, false, '17.1 无「运行数据」工作表报错');
  ok(/运行数据/.test(b.s.error), '17.2 错误信息指明缺哪张表');
});
section('C', () => {
  b = bad2(['--input', emptyRun, '--workshop', 'W', '--equip-type', '离心泵', '--from', FROM, '--to', TO]);
  eq(b.s.ok, false, '17.3 运行数据无记录报错');
});

const alias = mk('alias.xlsx', {
  '运行参数': [['位号', '名称', '类型', '对比组', '介质流量', '有效扬程', '密度', '泵轴功率', '运行小时'],
    ['P-91', '泵91', '离心泵', 'G9', 300, 90, 850, shaftFor(850, 300, 90, 0.8), 7000],
    ['', '空位号', '离心泵', 'G9', 300, 90, 850, 80, 7000],
    ['合计', '', '', '', 600, 180, '', 160, '']],
});
// ---- 18. 合计行跳过、别名列头、位号为空跳过
section('B', () => {
  r = run(alias, [], 'alias');
  eq(r.summary.ok, true, '18.1 别名表头与别名 sheet 名可识别');
  eq(r.summary.counts.equipment, 1, '18.2 合计行与空位号行均跳过');
  eq(r.data.byEquipment[0].efficiencyPct, 80, '18.3 别名列头取数正确');
  ok(r.data.warnings.some((w) => /合计行/.test(w)), '18.4 合计行有 warning');
  ok(r.data.warnings.some((w) => /位号为空/.test(w)), '18.5 空位号有 warning');
});

const titled = mk('titled.xlsx', {
  '运行数据': [['某车间设备能效运行数据表'], [''], PUMP_HDR, pumpRow('P-95', 0.80)],
});
// ---- 19. 标题行表头识别（表头不在第一行）
section('B', () => {
  r = run(titled, [], 'titled');
  eq(r.summary.ok, true, '19.1 标题行下的表头可识别');
  eq(r.data.byEquipment[0].efficiencyPct, 80, '19.2 标题行不影响取数');
});

const dup = mk('dup.xlsx', {
  '运行数据': [PUMP_HDR, pumpRow('P-01', 0.80), pumpRow('P-01', 0.70)],
});
// ---- 20. 位号重复不合并
section('C', () => {
  r = run(dup, [], 'dup');
  eq(r.summary.counts.equipment, 2, '20.1 重复位号原样保留不合并');
  ok(r.data.warnings.some((w) => /重复出现/.test(w) && /未合并/.test(w)), '20.2 warning 提示位号重复');
});

const rowType = mk('rowtype.xlsx', {
  '运行数据': [['设备位号', '设备类型', '输出功率', '输入功率'], ['M-99', '电机', 950, 1000]],
});
const unkType = mk('unktype.xlsx', {
  '运行数据': [PUMP_HDR.map((h, i) => (i === 2 ? '设备类型' : h)),
    ['P-98', '泵98', '外星设备', 'G1', 300, 90, 850, shaftFor(850, 300, 90, 0.8), '', '', 7000]],
});
// ---- 21. 行内设备类型覆盖 --equip-type
section('B', () => {
  r = run(rowType, [], 'rowtype', '离心泵');
  eq(r.data.byEquipment[0].typeLabel, '电机', '21.1 行内设备类型优先于 --equip-type');
  eq(r.data.byEquipment[0].efficiencyPct, 95, '21.2 按行内类型口径计算');
});
section('C', () => {
  r = run(unkType, [], 'unktype');
  ok(r.data.warnings.some((w) => /无法识别/.test(w)), '21.3 行内类型无法识别时 warning 并回退 --equip-type');
  eq(r.data.byEquipment[0].typeLabel, '离心泵', '21.4 回退到 --equip-type');
});

const extDesign = mk('extdesign.xlsx', { '设计参数': [['设备位号', '设计效率'], ['P-01', 85], ['P-02', 85], ['P-03', 85]] });
const extPrice = mk('extprice.xlsx', { '单价': [['能源介质', '单价', '计价单位'], ['电', 0.7, 'kWh']] });
const extGroup = mk('extgroup.xlsx', { '分组': [['设备位号', '对比组'], ['P-01', 'X'], ['P-02', 'Y'], ['P-03', 'Y']] });
// ---- 22. 外部设计参数表 / 单价表文件
section('B', () => {
  r = run(base, ['--design', extDesign, '--price', extPrice], 'ext');
  eq(r.data.meta.designProvided, true, '22.1 外部设计参数表已读取');
  eq(r.data.byEquipment[0].designEfficiencyPct, 85, '22.2 外部设计效率取数正确');
  eq(r.data.meta.unitPrice, 0.7, '22.3 外部单价已读取');
  ok(r.data.savingPotential.length > 0, '22.4 外部单价可用于费用差额测算');
  // 外部分组表
  r = run(base, ['--group', extGroup], 'extgroup');
  eq(r.data.groupComparison.length, 2, '22.5 外部分组表生效');
});

// ---- 23. 产出落盘与结构完整性
section('BVT', () => {
  r = run(withPrice, [], 'files');
  ok(fs.existsSync(path.join(r.out, 'energy.json')), '23.1 energy.json 已写入');
  ok(fs.existsSync(path.join(r.out, 'energy.md')), '23.2 energy.md 已写入');
  ok(fs.existsSync(path.join(r.out, 'summary.json')), '23.3 summary.json 已写入');
  ok(fs.existsSync(path.join(r.out, '能效对标表.xlsx')), '23.4 能效对标表.xlsx 已写入');
  const sj = JSON.parse(fs.readFileSync(path.join(r.out, 'summary.json'), 'utf8'));
  eq(sj.ok, true, '23.5 summary.json 内容正确');
  eq(sj.counts.equipment, 3, '23.6 summary.json 含计数');
  const xb = readXlsx(path.join(r.out, '能效对标表.xlsx'));
  ok(['逐台能效', '能效偏低', '同类对比', '数据不足', '异常值', '费用差额测算'].every((n) => xb[n]), '23.7 对标表六个工作表齐全');
  eq(xb['逐台能效'].length, 4, '23.8 逐台能效表含表头 + 3 台');
  ok(/## 一、统计概览/.test(r.md) && /## 二、逐台能效明细/.test(r.md) && /## 三、能效偏低清单/.test(r.md)
    && /## 四、同类设备对比/.test(r.md) && /## 五、数据不足与异常值/.test(r.md) && /## 六、能效分析/.test(r.md), '23.9 六节结构齐全');
  ok(/<!-- ANALYSIS_START -->/.test(r.md) && /<!-- ANALYSIS_END -->/.test(r.md), '23.10 分析段占位符存在');
  ok(/生成时间：\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}（北京时间）/.test(r.md), '23.11 北京时间生成时间');
});

// ---- 24. md 中 null 显示为 — 而非 0
section('A', () => {
  r = run(lack, [], 'mdnull');
  ok(/\| — \|/.test(r.md), '24.1 null 在 md 中显示为 —');
  ok(!/\| 0% \|/.test(r.md), '24.2 参数不全的效率未显示为 0%');
});

const MS = path.join(__dirname, 'make-sample.js');
function sample(seed) {
  const d = path.join(work, 'sample-' + seed);
  const rr = spawnSync(process.execPath, [MS, '--out', d, '--seed', String(seed)], { encoding: 'utf8' });
  const s = JSON.parse(rr.stdout.trim().split('\n').pop());
  return { d, s };
}
// ---- 25. 样例可再生（seed 变数值变、结论不变）
section('B', () => {
  s1 = sample(1), s7 = sample(7);
  eq(s1.s.ok, true, '25.1 样例生成成功（seed 1）');
  eq(s7.s.ok, true, '25.2 样例生成成功（seed 7）');
  const r1 = run(path.join(s1.d, 'sample-pump-energy.xlsx'), [], 'smp1');
  const r7 = run(path.join(s7.d, 'sample-pump-energy.xlsx'), [], 'smp7');
  eq(r1.summary.ok, true, '25.3 样例 1 运行成功');
  eq(r1.summary.counts.equipment, r7.summary.counts.equipment, '25.4 seed 变设备数不变');
  eq(r1.summary.counts.lowEfficiency, r7.summary.counts.lowEfficiency, '25.5 seed 变能效偏低数不变');
  eq(r1.summary.counts.insufficientData, r7.summary.counts.insufficientData, '25.6 seed 变数据不足数不变');
  eq(r1.summary.counts.implausible, r7.summary.counts.implausible, '25.7 seed 变异常值数不变');
  eq(r1.summary.counts.lowEfficiency, 2, '25.8 主样例恒 2 台能效偏低');
  eq(r1.summary.counts.insufficientData, 1, '25.9 主样例恒 1 台数据不足');
  eq(r1.summary.counts.implausible, 1, '25.10 主样例恒 1 台异常值');
  ok(r1.data.byEquipment[0].efficiencyPct !== r7.data.byEquipment[0].efficiencyPct, '25.11 seed 变数值确实变化');
  const rn = run(path.join(s1.d, 'sample-no-design.xlsx'), [], 'smpnd');
  eq(rn.data.meta.designProvided, false, '25.12 无设计参数变体不做偏差分析');
  const rm = run(path.join(s1.d, 'sample-mixed-types.xlsx'), [], 'smpmixed', '风机');
  eq(rm.summary.counts.equipment, 5, '25.13 混合类型变体五台设备');
  eq(rm.summary.counts.calculated, 5, '25.14 混合类型五台全部可算');
});

const CH = ['功能位置', '设备描述', '对象类型', '分组', '流量', '进口压力', '出口压力', '进口温度', '出口温度', '绝热指数', '轴功率', '运行时间'];
const poly = mk('poly.xlsx', {
  '运行数据': [CH,
    ['K-A', '循环氢压缩机A', '压缩机', '氢机组', 5200, 1.6, 2.1, 40, 78, 1.4, 760, 8000],
    ['K-B', '循环氢压缩机B', '压缩机', '氢机组', 5100, 1.6, 2.1, 41, '', 1.4, 790, 7900],
    ['K-C', '富气压缩机', '压缩机', '富气机组', 3600, 0.15, 1.2, 38, 135, '', 640, 7700],
    ['K-D', '出口温度不高于进口', '压缩机', '氢机组', 5000, 1.6, 2.1, 40, 40, 1.4, 700, 8000]],
});
// ---- 26. --polytropic：压缩机多变效率口径（缺温度/绝热指数 → 数据不足，不按典型 k 或等温口径顶替）
section('B', () => {
  r = run(poly, ['--polytropic'], 'poly', '压缩机');
  eq(r.summary.ok, true, '26.1 --polytropic 可运行');
  eq(r.summary.counts.polytropic, true, '26.2 counts.polytropic 标记');
  eq(r.data.meta.polytropic, true, '26.3 meta.polytropic 标记');
  ok(/多变效率/.test(r.data.meta.compressorBasis), '26.4 meta.compressorBasis 为多变效率公式');
  const kA = r.data.byEquipment.find((x) => x.tag === 'K-A');
  const expA = ((1.4 - 1) / 1.4) / (Math.log((78 + 273.15) / (40 + 273.15)) / Math.log(2.1 / 1.6));
  ok(Math.abs(kA.efficiency - expA) < 1e-3, '26.5 多变效率 = [(k−1)/k] ÷ [ln(T2/T1)/ln(p2/p1)]');
  eq(kA.efficiencyKind, 'polytropic', '26.6 efficiencyKind 为 polytropic');
  ok(kA.polytropicExponentTerm > 0, '26.7 记录多变指数项 (n−1)/n');
  eq(r.summary.counts.insufficientData, 3, '26.8 缺出口温度 / 缺绝热指数 / 出口温度不高于进口 三台归数据不足');
  ok(r.data.insufficientData.find((x) => x.tag === 'K-B').missing.includes('出口温度'), '26.9 缺出口温度被记录（不按等温口径顶替）');
  ok(r.data.insufficientData.find((x) => x.tag === 'K-C').missing.includes('绝热指数'), '26.10 缺绝热指数被记录（不按典型 k=1.4 代替）');
  ok(r.data.insufficientData.find((x) => x.tag === 'K-D').missing.some((m) => /多变指数无法求取/.test(m)), '26.11 出口温度不高于进口时说明多变指数无法求取');
  ok(/【注意】压缩机按多变效率口径/.test(r.md), '26.12 md 写明多变效率口径与所需参数');
  ok(/多变效率（--polytropic）/.test(r.md), '26.13 md 抬头标注压缩机口径为多变');
  const iso = run(poly, [], 'iso', '压缩机');
  eq(iso.summary.counts.insufficientData, 0, '26.14 不带 --polytropic 时按等温口径，四台均可算（温度与 k 不是必需参数）');
  eq(iso.data.byEquipment[0].efficiencyKind, 'isothermal', '26.15 默认 efficiencyKind 为 isothermal');
  ok(/等温效率/.test(iso.data.meta.compressorBasis) && !/多变效率（--polytropic）/.test(iso.md), '26.16 默认口径 md 不标多变');
  ok(!/【注意】压缩机按多变效率口径/.test(iso.md), '26.17 默认口径 md 不出现多变口径提示');
  const polyPump = run(base, ['--polytropic'], 'polypump');
  eq(polyPump.summary.counts.calculated, 3, '26.18 --polytropic 对非压缩机设备无影响');
});

const lowRows = [PUMP_HDR, pumpRow('P-S1', 0.80), pumpRow('P-S2', 0.75), pumpRow('P-S3', 0.60)];
const single = mk('single.xlsx', { '运行数据': lowRows, '单价': [['能源介质', '单价', '计价单位'], ['电', 0.62, 'kWh']] });
const tou = mk('tou.xlsx', { '运行数据': lowRows, '单价': [['能源介质', '时段', '单价', '计价单位'], ['电', '峰', 0.98, 'kWh'], ['电', '平', 0.62, 'kWh'], ['电', '谷', 0.31, 'kWh']] });
const touAvg = mk('touavg.xlsx', { '运行数据': lowRows, '单价': [['能源介质', '时段', '单价', '计价单位'], ['电', '峰', 0.98, 'kWh'], ['电', '平', 0.62, 'kWh'], ['电', '谷', 0.31, 'kWh'], ['电', '加权', 0.64, 'kWh']] });
const steam = mk('steam.xlsx', { '运行数据': lowRows, '单价': [['能源介质', '单价', '计价单位'], ['蒸汽', 180, 't']] });
// ---- 27. 分时电价：单一电价提示；峰/平/谷多行无加权 → 不测算且不自行取峰或谷；有加权行只认加权
section('B', () => {
  r = run(single, [], 'single');
  ok(/单一电价/.test(r.data.meta.priceKind), '27.1 单一电价 priceKind');
  ok(r.data.warnings.some((w) => /分时电价/.test(w) && /加权平均电价/.test(w)), '27.2 单一电价时 warning 提示厂内执行分时电价须提供加权平均');
  ok(/【注意】电价说明/.test(r.md) && /分时电价（峰\/平\/谷）/.test(r.md), '27.3 md 含分时电价提示');
  ok(/脚本不内置任何电价数值/.test(r.data.meta.priceNote), '27.4 priceNote 写明不内置电价');
  r = run(tou, [], 'tou');
  eq(r.data.meta.priceProvided, false, '27.5 峰/平/谷三行无加权行 → 不测算费用差额');
  eq(r.data.meta.unitPrice, null, '27.6 未自行取峰、平或谷电价');
  ok(r.data.warnings.some((w) => /未提供加权平均电价/.test(w) && /不自行取峰、平或谷/.test(w)), '27.7 warning 说明不自行取峰平谷');
  eq(r.data.savingPotential.length, 0, '27.8 无加权电价时无费用差额记录');
  ok(/未提供能源单价（或分时电价未提供加权平均值）/.test(r.md), '27.9 md 5.3 节说明分时电价未提供加权平均值');
  r = run(touAvg, [], 'touavg');
  eq(r.data.meta.unitPrice, 0.64, '27.10 有加权行时只认加权平均电价');
  ok(/分时电价加权平均/.test(r.data.meta.priceKind), '27.11 priceKind 标注分时电价加权平均');
  ok(!r.data.warnings.some((w) => /未提供加权平均电价/.test(w)), '27.12 加权行存在时不再提示缺加权');
  ok(r.data.savingPotential.length === 1 && r.data.savingPotential[0].unitPrice === 0.64, '27.13 费用差额按加权电价测算');
  ok(/分时电价加权平均/.test(r.md), '27.14 md 概览标注按分时电价加权平均测算');
  r = run(steam, [], 'steam');
  ok(/非电介质单价/.test(r.data.meta.priceKind) && r.data.meta.unitPrice === 180, '27.15 非电介质单价按介质取用并标注');
});

const sap = mk('sap.xlsx', {
  '运行数据': [['功能位置', '设备编号', '设备描述', '对象类型', '流量', '扬程', '介质密度', '轴功率', '运行时间'],
    ['CDU-P1101A', '10023451', '常压塔顶回流泵A', '离心泵', 300, 90, 850, shaftFor(850, 300, 90, 0.8), 7000],
    ['CDU-P1101B', '10023452', '常压塔顶回流泵B', '离心泵', 300, 90, 850, shaftFor(850, 300, 90, 0.6), 7000]],
});
// ---- 28. 中石化口径：SAP/EM 列名、设备编号不作位号、边界与声明行、【注意】不用 emoji、默认输出目录
section('A', () => {
  r = run(sap, [], 'sap');
  eq(r.summary.ok, true, '28.1 SAP PM 列名（功能位置/设备描述/对象类型）可读');
  eq(r.data.byEquipment[0].tag, 'CDU-P1101A', '28.2 「功能位置」归位号，8 位「设备编号」不被当作位号');
  eq(r.data.byEquipment[0].name, '常压塔顶回流泵A', '28.3 「设备描述」归设备名称');
  eq(r.data.byEquipment[0].typeLabel, '离心泵', '28.4 「对象类型」归设备类型');
  eq(r.data.byEquipment[0].efficiencyPct, 80, '28.5 SAP 列名下取数正确');
});
section('B', () => {
  ok(/不算装置综合能耗、不算单位产品能耗/.test(r.data.meta.boundary), '28.6 边界写明不算装置综合能耗与单位产品能耗（归能源管理部门/工艺）');
  ok(/能耗指标考核归能源管理部门/.test(r.md), '28.7 md 写明能耗指标考核归能源管理部门');
  ok(r.md.includes('本材料由脚本汇总、模型成文，仅供设备员复核参考，不替代审批、定性、验收与签字；厂内制度与系统数据为准。'), '28.8 通用声明行写入 md');
  eq(r.data.meta.statement, '本材料由脚本汇总、模型成文，仅供设备员复核参考，不替代审批、定性、验收与签字；厂内制度与系统数据为准。', '28.9 meta.statement 写入声明行');
  {
    const x = spawnSync(process.execPath, [ENERGY, '--input', base, '--workshop', 'W', '--equip-type', '离心泵', '--from', FROM, '--to', TO], { encoding: 'utf8' });
    const lines = x.stdout.trim().split('\n');
    let sj2; try { sj2 = JSON.parse(lines[lines.length - 1]); } catch (e) { sj2 = { ok: false }; }
    ok(sj2.ok === true && String(sj2.out).startsWith(os.tmpdir()), '28.13 未传 --out 时默认写入系统临时目录');
    try { fs.rmSync(sj2.out, { recursive: true, force: true }); } catch (e) {}
  }
  // 样例：压缩机多变变体恒 1 可算 / 2 数据不足
  const rp = run(path.join(s1.d, 'sample-compressor-polytropic.xlsx'), ['--polytropic'], 'smppoly', '压缩机');
  eq(rp.summary.counts.calculated, 1, '28.14 多变样例恒 1 台可算');
  eq(rp.summary.counts.insufficientData, 2, '28.15 多变样例恒 2 台数据不足');
  eq(rp.data.meta.unitPrice, 0.64, '28.16 多变样例单价取加权行');
  const rp7 = run(path.join(s7.d, 'sample-compressor-polytropic.xlsx'), ['--polytropic'], 'smppoly7', '压缩机');
  eq(rp7.summary.counts.insufficientData, 2, '28.17 seed 变多变样例结论不变');
});
section('C', () => {
  ok(!/[✅⚠❌✔✗]/.test(r.md), '28.10 md 不含 emoji');
  ok(/【注意】/.test(run(base, [], 'notice').md), '28.11 醒目提示用【注意】');
  ok(!/EAM|机动处/.test(r.md), '28.12 md 不含 EAM/机动处 旧称');
});

// ---- 29. 统计期内运行时间为 0 h：效率照算供核对，但不判正常或偏低、不参与同类对比，warning 提示
{
  const DH = ['位号', '设备名称', '设计效率'];
  const zero = mk('zero-hours.xlsx', {
    '运行数据': [PUMP_HDR,
      pumpRow('P-21A', 0.60, { group: 'P-21', hours: 720 }),
      pumpRow('P-21B', 0.50, { group: 'P-21', hours: 0 }),
      pumpRow('P-22A', 0.80, { group: 'P-22', hours: 0 }),
      pumpRow('P-22B', 0.76, { group: 'P-22', hours: 500 }),
      pumpRow('P-22C', 0.74, { group: 'P-22', hours: 400 })],
    '设计参数': [DH, ['P-21A', 'P-21A泵', 78], ['P-21B', 'P-21B泵', 78]],
  });
  section('A', () => {
    r = run(zero, [], 'zerohours');
    const by = (t) => r.data.byEquipment.find((x) => x.tag === t) || {};
    eq(r.summary.ok, true, '29.1 含 0 h 设备可正常运行');
    eq(by('P-21B').lowJudgement, 'notRunning', '29.2 运行 0 h 的泵判定为 notRunning，不判正常或偏低');
    ok(!r.data.lowEfficiency.some((x) => x.tag === 'P-21B'), '29.3 运行 0 h 的泵不进能效偏低清单（即使低于设计值）');
    eq(by('P-21A').lowJudgement, 'low', '29.4 同组正常运行的泵照常按设计值判偏低');
    eq(by('P-21A').groupSize, 1, '29.5 运行 0 h 的泵不参与组内排名');
    eq(by('P-21B').groupRank, null, '29.6 运行 0 h 的泵无组内排名');
    eq(by('P-22A').lowJudgement, 'notRunning', '29.7 效率高的 0 h 泵同样不判正常');
    eq(r.data.groupComparison.find((g) => g.group === 'P-22').size, 2, '29.8 组内中位数只用运行中的泵');
    eq(r.summary.counts.notRunning, 2, '29.9 counts.notRunning 计 2 台');
    eq(r.summary.counts.calculated, 5, '29.10 0 h 泵仍计入完成计算（效率列出供核对）');
    ok(r.summary.warnings.some((w) => /P-21B/.test(w) && /0 h/.test(w) && /不判正常或偏低/.test(w)), '29.11 运行 0 h 给 warning');
    ok(/P-21B[^\n]*统计期内未运行/.test(r.md), '29.12 md 判定列标「统计期内未运行」');
    const wb = readXlsx(path.join(r.out, '能效对标表.xlsx'));
    ok(wb['逐台能效'].some((row) => row[0] === 'P-21B' && /统计期内未运行/.test(String(row[row.length - 1]))), '29.13 xlsx 判定列标「统计期内未运行」');
  });
}

// ---- 30. 运行时间为空：运行状态未知，不判正常或偏低、不参与同类对比（D006）
{
  const DH = ['位号', '设备名称', '设计效率'];
  const blank = mk('blank-hours.xlsx', {
    '运行数据': [PUMP_HDR,
      pumpRow('P-31A', 0.60, { group: 'P-31', hours: 720 }),
      pumpRow('P-31B', 0.50, { group: 'P-31', hours: '' }),
      pumpRow('P-31C', 0.55, { group: 'P-31', hours: 0 }),
      pumpRow('P-32A', 0.80, { group: 'P-32', hours: '' }),
      pumpRow('P-32B', 0.76, { group: 'P-32', hours: 500 }),
      pumpRow('P-32C', 0.74, { group: 'P-32', hours: 400 }),
      pumpRow('P-33A', 0.70, { group: 'P-33', hours: '不详' })],
    '设计参数': [DH, ['P-31A', 'P-31A泵', 78], ['P-31B', 'P-31B泵', 78], ['P-31C', 'P-31C泵', 78]],
    '单价': [['能源介质', '单价', '计价单位'], ['电', 0.62, 'kWh']],
  });
  const noCol = mk('no-hours-col.xlsx', {
    '运行数据': [PUMP_HDR.slice(0, -1), pumpRow('P-41', 0.80).slice(0, -1), pumpRow('P-42', 0.60).slice(0, -1)],
  });
  section('A', () => {
    r = run(blank, [], 'blankhours');
    const by = (t) => r.data.byEquipment.find((x) => x.tag === t) || {};
    eq(r.summary.ok, true, '30.1 含运行时间为空的设备可正常运行');
    eq(by('P-31A').lowJudgement, 'low', '30.2 运行时间为正值：照常按设计值判偏低（行为不变）');
    eq(by('P-31C').lowJudgement, 'notRunning', '30.3 运行时间为 0：仍判统计期内未运行');
    eq(by('P-31B').lowJudgement, 'runUnknown', '30.4 运行时间为空：判运行状态未知，不判正常或偏低');
    eq(by('P-31B').efficiencyPct, 50, '30.5 运行时间为空：效率照列供核对');
    ok(!r.data.lowEfficiency.some((x) => x.tag === 'P-31B'), '30.6 运行时间为空：不进能效偏低清单（即使低于设计值）');
    eq(by('P-31B').groupRank, null, '30.7 运行时间为空：无组内排名');
    eq(by('P-32A').lowJudgement, 'runUnknown', '30.8 效率高的运行时间为空的泵同样不判正常');
    eq(r.data.groupComparison.find((g) => g.group === 'P-32').size, 2, '30.9 组内中位数只用运行时间已知且大于 0 的泵');
    eq(by('P-32B').groupMedianPct, 75, '30.10 组内中位数不含运行时间为空的泵（76、74 → 75）');
    eq(by('P-33A').lowJudgement, 'runUnknown', '30.11 运行时间无法解析的按为空处理');
    eq(r.summary.counts.runUnknown, 3, '30.12 counts.runUnknown 计 3 台');
    eq(r.summary.counts.calculated, 7, '30.13 运行状态未知的仍计入完成计算（效率列出供核对）');
    ok(r.summary.warnings.some((w) => /运行状态未知/.test(w) && /P-31B/.test(w) && /补充/.test(w)), '30.14 warning 提示补充运行时间');
    ok(!r.data.savingPotential.some((x) => ['P-31B', 'P-32A', 'P-33A'].includes(x.tag) && x.annualCostGap !== null), '30.15 运行状态未知的设备不测算费用差额');
    ok(/P-31B[^\n]*运行状态未知/.test(r.md), '30.16 md 判定列标「运行状态未知」');
    const wb = readXlsx(path.join(r.out, '能效对标表.xlsx'));
    ok(wb['逐台能效'].some((row) => row[0] === 'P-31B' && /运行状态未知/.test(String(row[row.length - 1]))), '30.17 xlsx 判定列标「运行状态未知」');
    ok(/运行状态未知（运行时间为空，不判定）/.test(r.md), '30.18 md 概览有运行状态未知计数行');
  });
  // 整张表没有运行时间列：可算设备全部列为运行状态未知，warning 写明缺列
  section('B', () => {
    r = run(noCol, [], 'nohourscol');
    ok(r.data.byEquipment.every((x) => x.lowJudgement === 'runUnknown'), '30.19 无运行时间列时可算设备都判运行状态未知');
    eq(r.data.lowEfficiency.length, 0, '30.20 无运行时间列时不出能效偏低清单');
    ok(r.summary.warnings.some((w) => /没有运行时间列/.test(w)), '30.21 无运行时间列时 warning 写明缺列');
  });
}

// ---- 31. 车间范围核对（D007）：运行数据带车间列时按 --workshop 核对
{
  const sc = (i) => ((r.data && r.data.meta.workshopScope) || [])[i] || {};
  const H = [...PUMP_HDR, '车间'];
  const wsMix = mk('ws-mix.xlsx', { '运行数据': [H,
    [...pumpRow('P-A1', 0.80), '测试车间'], [...pumpRow('P-A2', 0.75), '测试'],
    [...pumpRow('P-B1', 0.30), '催化车间'], [...pumpRow('P-B2', 0.40), '催化车间'], [...pumpRow('P-C1', 0.60), ''],
  ] });
  const wsBad = mk('ws-bad.xlsx', { '运行数据': [H, [...pumpRow('P-D1', 0.80), '催化车间'], [...pumpRow('P-D2', 0.70), '焦化车间']] });
  const wsPlant = mk('ws-plant.xlsx', { '运行数据': [[...PUMP_HDR, '维护工厂'], [...pumpRow('P-E1', 0.80), '1100'], [...pumpRow('P-E2', 0.70), '1200']] });
  section('A', () => {
    r = run(wsMix, [], 'ws-mix');
    eq(r.summary.counts.equipment, 3, '31.1 混合输入只纳入本车间与车间为空的设备（剔除催化车间 2 台）');
    ok(!r.data.byEquipment.some((x) => /^P-B/.test(x.tag)), '31.2 其他车间设备不进逐台能效');
    eq(r.data.groupComparison[0] && r.data.groupComparison[0].medianPct, 75, '31.3 组内中位数只按本车间设备算（80/75/60 → 75%）');
    eq(r.data.lowEfficiency.map((x) => x.tag).join(','), 'P-C1', '31.4 能效偏低只含本车间设备，车间为空的 P-C1 按本车间保留');
    ok(r.summary.warnings.some((w) => /剔除其他车间 2 行/.test(w) && w.includes('催化车间 2 行')), '31.5 warning 写明剔除行数与车间名');
    ok(r.summary.warnings.some((w) => /车间列为空 1 行/.test(w)), '31.6 warning 写明车间为空行数');
    eq(sc(0).status, 'checked', '31.7 meta.workshopScope 记录已核对');
    eq(sc(0).droppedRows, 2, '31.8 meta.workshopScope 记录剔除行数');
    eq((sc(0).dropped || {})['催化车间'], 2, '31.9 meta.workshopScope 按车间记录剔除');
    ok(/车间范围：已按车间列核对「测试车间」/.test(r.md || ''), '31.10 md 口径处写明按车间核对与剔除');
    r = run(wsBad, [], 'ws-bad');
    eq(r.summary.counts.equipment, 2, '31.11 车间列全不一致时不筛');
    ok(r.summary.warnings.some((w) => w.startsWith('【注意】') && /未按车间筛选/.test(w)), '31.12 warning 以【注意】开头');
    eq(sc(0).status, 'mismatch', '31.13 meta.workshopScope 记录不一致');
    const ai = (r.md || '').indexOf('【注意】工作表「运行数据」的车间列取值与 --workshop「测试车间」不一致');
    ok(ai > 0 && ai < r.md.indexOf('## 一、统计概览'), '31.14 md 开头（第一节之前）有【注意】提示');
  });
  section('B', () => {
    r = run(base, [], 'ws-none');
    eq(sc(0).status, 'noColumn', '31.15 无车间列 status 为 noColumn');
    ok((r.md || '').includes('输入未含车间列，车间范围以取数条件为准'), '31.16 md 口径处说明无车间列');
    r = run(wsPlant, [], 'ws-plant');
    eq(sc(0).status, 'noColumn', '31.17 「维护工厂」列不当车间列（noColumn）');
    eq(r.summary.counts.equipment, 2, '31.18 「维护工厂」列不触发筛选');
  });
}

// ---- 输出
console.log(`\n${'='.repeat(56)}`);
console.log(`equipment-energy-analysis 自测：${pass} 通过，${fail} 失败`);
console.log(`用例级别 ${LEVELS[RUN_LEVEL]}：BVT ${byLevel.BVT}，A ${byLevel.A}，B ${byLevel.B}，C ${byLevel.C}`);
if (failures.length) { console.log('\n失败项：'); failures.forEach((f) => console.log('  ✗ ' + f)); }
console.log('='.repeat(56));
try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
