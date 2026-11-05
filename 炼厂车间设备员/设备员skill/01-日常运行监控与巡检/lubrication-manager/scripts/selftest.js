#!/usr/bin/env node
'use strict';
/**
 * 自测：生成变体输入并断言 lube.js 行为。用法：node scripts/selftest.js（全绿退出 0）
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { writeXlsx } = require('./lib/xlsx-lite');
const C = require('./lib/common');

const LUBE = path.join(__dirname, 'lube.js');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'lube-selftest-'));
const DATE = '2026-09-21';
const back = (n) => C.addDays(DATE, -n);
let pass = 0, fail = 0;
const failures = [];

function ok(cond, name) { if (cond) { pass++; } else { fail++; failures.push(name); } }
function eq(actual, expect, name) { ok(actual === expect, `${name}（期望 ${JSON.stringify(expect)}，实际 ${JSON.stringify(actual)}）`); }

function run(file, extra = [], tag) {
  const out = path.join(work, (tag || path.basename(file, '.xlsx')) + '-out');
  const r = spawnSync(process.execPath, [LUBE, '--input', file, '--workshop', '测试车间', '--date', DATE, '--out', out, ...extra], { encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  let summary;
  try { summary = JSON.parse(lines[lines.length - 1]); } catch (e) { summary = { ok: false, error: 'no-json:' + r.stdout + r.stderr }; }
  let lube = null, md = null;
  if (fs.existsSync(path.join(out, 'lube.json'))) lube = JSON.parse(fs.readFileSync(path.join(out, 'lube.json'), 'utf8'));
  if (fs.existsSync(path.join(out, 'lube-report.md'))) md = fs.readFileSync(path.join(out, 'lube-report.md'), 'utf8');
  return { code: r.status, summary, lube, md, out };
}
function mk(name, book) { const p = path.join(work, name); writeXlsx(p, book); return p; }

const LED_HDR = ['位号', '设备名称', '润滑部位', '油品名称', '润滑方式', '润滑周期', '上次加换油日期', '加油量', '油品规格'];
const REC_HDR = ['日期', '位号', '油品名称', '类型', '数量', '单位', '执行人'];
const OA_HDR = ['位号', '取样日期', '检测项', '检测值', '限值', '结论'];

// ---- 1. 基础：到期分档（逾期/临期/周期内）
const base = mk('base.xlsx', {
  '润滑台账': [LED_HDR,
    ['P-01', '泵1', '轴承箱', 'L-TSA46 透平油', '换油', '3个月', back(120), 8, 'VG46'],   // 逾期 30 天
    ['P-02', '泵2', '轴承箱', 'L-TSA46 透平油', '换油', '90天', back(87), 8, 'VG46'],     // 剩 3 天 → 临期
    ['P-03', '泵3', '轴承箱', 'L-CKD220 齿轮油', '换油', '1年', back(30), 12, 'VG220'],   // 周期内
  ],
});
let r = run(base, [], 'base');
eq(r.summary.ok, true, '1.1 基础运行成功');
eq(r.summary.counts.ledgerItems, 3, '1.2 台账润滑项数');
eq(r.summary.counts.overdue, 1, '1.3 逾期数');
eq(r.summary.counts.dueSoon, 1, '1.4 临期数');
eq(r.summary.counts.normal, 1, '1.5 周期内正常数');
eq(r.summary.counts.undetermined, 0, '1.6 无未判定项');
eq(r.lube.overdue[0].overdueDays, 30, '1.7 逾期天数计算正确');
eq(r.lube.overdue[0].dueDate, back(30), '1.8 应到期日 = 上次日期 + 周期');
eq(r.lube.dueSoon[0].remainDays, 3, '1.9 临期剩余天数正确');

// ---- 2. --lead-days 改变临期窗口
r = run(base, ['--lead-days', '1'], 'lead1');
eq(r.summary.counts.dueSoon, 0, '2.1 lead-days=1 时 P-02 不算临期');
eq(r.summary.counts.normal, 2, '2.2 P-02 转入周期内');
r = run(base, ['--lead-days', '400'], 'lead400');
eq(r.summary.counts.dueSoon, 2, '2.3 lead-days 放大后临期数增加');

// ---- 3. 未判定：周期缺失 / 上次日期缺失 / 周期无法解析 —— 绝不按常见周期默认
const und = mk('undetermined.xlsx', {
  '润滑台账': [LED_HDR,
    ['P-01', '泵1', '轴承箱', 'L-TSA46 透平油', '换油', '', back(400), 8, 'VG46'],        // 周期空
    ['P-02', '泵2', '轴承箱', 'L-TSA46 透平油', '换油', '3个月', '', 8, 'VG46'],          // 上次日期空
    ['P-03', '泵3', '轴承箱', 'L-TSA46 透平油', '换油', '视情况', back(400), 8, 'VG46'],    // 周期无法解析
    ['P-04', '泵4', '轴承箱', 'L-TSA46 透平油', '换油', '3个月', '去年冬天', 8, 'VG46'],  // 日期无法解析
    ['P-05', '泵5', '轴承箱', 'L-TSA46 透平油', '换油', '3个月', back(10), 8, 'VG46'],
  ],
});
r = run(und, [], 'und');
eq(r.summary.counts.undetermined, 4, '3.1 四类缺失全部计入未判定');
eq(r.summary.counts.overdue, 0, '3.2 未判定项不计入逾期（未按最严默认）');
eq(r.summary.counts.dueSoon, 0, '3.3 未判定项不计入临期');
eq(r.summary.counts.normal, 1, '3.4 未判定项不计入正常（未按最宽松默认）');
ok(r.lube.undetermined.every((x) => x.dueDate === null && x.daysDiff === null), '3.5 未判定项不生成应到期日');
ok(r.lube.undetermined.some((x) => x.reason.includes('润滑周期为空')), '3.6 周期为空原因标注');
ok(r.lube.undetermined.some((x) => x.reason.includes('上次加换油日期为空')), '3.7 上次日期为空原因标注');
ok(r.lube.undetermined.some((x) => x.reason.includes('无法解析')), '3.8 无法解析原因标注');
ok(r.lube.warnings.filter((w) => w.includes('未按默认周期处理')).length === 4, '3.9 每条未判定均有 warning');
ok(/未按常见周期默认处理/.test(r.md), '3.10 报告明示未按常见周期默认');

// ---- 4. 油液分析无限值：只列数值不判异常，不得引用通用限值
const oa = mk('oa.xlsx', {
  '润滑台账': [LED_HDR, ['P-01', '泵1', '轴承箱', 'L-TSA46 透平油', '换油', '3个月', back(10), 8, 'VG46']],
  '油液分析': [OA_HDR,
    ['P-01', back(5), '水分(ppm)', 520, '≤300', '不合格'],       // 异常
    ['P-01', back(5), '铜含量(ppm)', 12, '≤30', '合格'],         // 正常
    ['P-01', back(5), '铁含量(ppm)', 9999, '', '见报告'],        // 无限值 → 不判异常
    ['P-01', back(5), '闪点(℃)', 180, '   ', '见报告'],          // 空白限值 → 不判异常
    ['P-01', back(5), '酸值(mgKOH/g)', 0.2, '参照标准', '见报告'], // 限值无法解析 → 不判异常
  ],
});
r = run(oa, [], 'oa');
eq(r.summary.counts.oaAbnormal, 1, '4.1 有限值且超限的才算异常');
eq(r.summary.counts.oaNormal, 1, '4.2 正常项计数');
eq(r.summary.counts.oaNoLimit, 3, '4.3 无限值/限值不可解析项单列 3 条');
ok(!r.lube.oilAnalysis.abnormal.some((x) => x.item.includes('铁含量')), '4.4 无限值的极端数值未被判为异常');
ok(r.lube.oilAnalysis.noLimit.every((x) => x.exceeded === undefined), '4.5 无限值项不带超限判定字段');
ok(r.lube.warnings.some((w) => w.includes('未引用通用限值')), '4.6 warning 明示未引用通用限值');
ok(/未引用任何通用限值替代厂内标准/.test(r.md), '4.7 报告明示不引用通用限值');
ok(r.lube.oilAnalysis.noLimit.some((x) => /第\d+行/.test(`${x.row}`) || x.row > 0), '4.8 无限值项保留出处行号');
ok(!r.lube.warnings.some((w) => w.includes('不在本次润滑台账内')), '4.9 油液分析位号都在台账内时不提示');
// 油液分析含台账外位号（如全厂导出混入其他车间）：照常列示，但 warning 点名，提示确认是否属本车间
const oaOut = mk('oa-out.xlsx', {
  '润滑台账': [LED_HDR, ['P-01', '泵1', '轴承箱', 'L-TSA46 透平油', '换油', '3个月', back(10), 8, 'VG46']],
  '油液分析': [OA_HDR,
    ['P-01', back(5), '水分(ppm)', 100, '≤300', '合格'],
    ['Z-99', back(5), '水分(ppm)', 520, '≤300', '不合格'],
    ['Z-99', back(5), '铁含量(ppm)', 10, '≤30', '合格'],
  ],
});
r = run(oaOut, [], 'oa-out');
ok(r.lube.warnings.some((w) => w.includes('Z-99') && w.includes('不在本次润滑台账内')), '4.10 油液分析位号 Z-99 不在润滑台账 → warning 点名');
eq(r.lube.warnings.filter((w) => w.includes('不在本次润滑台账内')).length, 1, '4.11 台账外位号合并为一条 warning');
// 第三轮 v1-3 改口径：台账外位号（如全厂导出混入其他车间）不计入本车间异常/正常计数，单列「台账外油样」，仍不静默丢弃
eq(r.summary.counts.oaAbnormal, 0, '4.12 台账外位号的超限结果不计入本车间异常数（单列，不静默丢弃）');
eq(r.summary.counts.oaOutOfLedger, 2, '4.13 台账外位号的油样单列计数（Z-99 两项）');
ok(((r.lube.oilAnalysis || {}).outOfLedger || []).filter((x) => x.tag === 'Z-99').length === 2, '4.14 oilAnalysis.outOfLedger 列出 Z-99 两项');
ok(((r.lube.oilAnalysis || {}).outOfLedger || []).some((x) => x.tag === 'Z-99' && x.exceeded === true && x.limit === '≤300'), '4.15 台账外油样照常标出是否超厂内限值，供核实');
eq(r.summary.counts.oaNormal, 1, '4.16 正常项只计台账内位号');
ok(/台账外油样/.test(r.md || '') && /不计入/.test(r.md || ''), '4.17 报告单列台账外油样并写明不计入');
ok(!(r.lube.oilAnalysis.abnormal || []).some((x) => x.tag === 'Z-99'), '4.18 异常清单不含台账外位号');

// ---- 5. 油液分析：检测值无法解析 → 不判异常且不按 0
const oaBad = mk('oabad.xlsx', {
  '润滑台账': [LED_HDR, ['P-01', '泵1', '轴承箱', 'L-TSA46 透平油', '换油', '3个月', back(10), 8, 'VG46']],
  '油液分析': [OA_HDR, ['P-01', back(5), '水分(ppm)', '未检出', '≤300', '']],
});
r = run(oaBad, [], 'oabad');
eq(r.summary.counts.oaAbnormal, 0, '5.1 检测值不可解析不判异常');
eq(r.summary.counts.oaNoLimit, 1, '5.2 检测值不可解析归入不判定一列');
ok(r.lube.oilAnalysis.noLimit[0].value === null, '5.3 不可解析检测值为 null 而非 0');

// ---- 6. 无油液分析表 → 该节写「未提供」
r = run(base, ['--oil-analysis'], 'nooa');
eq(r.summary.ok, true, '6.1 无油液分析表不中断');
eq(r.lube.oilAnalysis.provided, false, '6.2 oilAnalysis.provided 为 false');
eq(r.summary.counts.oaAbnormal, null, '6.3 无油液分析时异常计数为 null 而非 0');
ok(/未提供油液分析数据/.test(r.md), '6.4 报告写「未提供油液分析数据」');
ok(r.lube.warnings.some((w) => w.includes('未找到「油液分析」工作表')), '6.5 指定 --oil-analysis 但缺表时 warning');

// ---- 7. 消耗统计：单位混用按单位分别统计，绝不换算
const mix = mk('mix.xlsx', {
  '润滑台账': [LED_HDR, ['K-01', '压缩机', '主油箱', 'L-TSA46 透平油', '补油', '30天', back(10), 30, 'VG46']],
  '加换油记录': [REC_HDR,
    [back(30), 'K-01', 'L-TSA46 透平油', '补油', 30, 'L', '张'],
    [back(20), 'K-01', 'L-TSA46 透平油', '补油', 1, '桶', '张'],
    [back(10), 'K-01', 'L-TSA46 透平油', '补油', 5, 'kg', '张'],
  ],
});
r = run(mix, [], 'mix');
eq(r.summary.counts.mixedUnits, 2, '7.1 单位混用在按油品与按设备各记一处');
const byOil = r.lube.consumption.byOil[0];
eq(byOil.units.length, 3, '7.2 三种单位分别统计');
ok(byOil.units.every((u) => ['L', '桶', 'kg'].includes(u.unit)), '7.3 单位保留原量纲未换算');
ok(!byOil.units.some((u) => u.qty === 36), '7.4 未把桶/kg 强行折成 L 合并');
ok(r.lube.warnings.some((w) => w.includes('未做换算')), '7.5 单位混用 warning 明示未换算');
ok(/未做任何换算/.test(r.md), '7.6 报告明示未做任何换算');

// ---- 8. 消耗统计：数量缺失不按 0
const noqty = mk('noqty.xlsx', {
  '润滑台账': [LED_HDR, ['P-01', '泵1', '轴承箱', 'L-TSA46 透平油', '换油', '3个月', back(10), 8, 'VG46']],
  '加换油记录': [REC_HDR,
    [back(10), 'P-01', 'L-TSA46 透平油', '换油', '', 'L', '张'],
    [back(5), 'P-01', 'L-TSA46 透平油', '补油', '若干', 'L', '张'],
  ],
});
r = run(noqty, [], 'noqty');
eq(r.lube.consumption.byOil[0].unknownQty, 2, '8.1 数量缺失条数单独计');
eq(r.lube.consumption.byOil[0].units.length, 0, '8.2 数量缺失不产生 0 的汇总项');
ok(r.lube.warnings.some((w) => w.includes('不按 0 计')), '8.3 warning 明示不按 0 计');

// ---- 9. 油品名称不一致 → warning 列出疑似同一油品，不自动合并
const oilname = mk('oilname.xlsx', {
  '润滑台账': [LED_HDR,
    ['P-01', '泵1', '轴承箱', 'L-TSA46 透平油', '换油', '3个月', back(10), 8, 'VG46'],
    ['P-02', '泵2', '轴承箱', 'L-TSA46透平油', '换油', '3个月', back(10), 8, 'VG46'],
    ['P-03', '泵3', '轴承箱', 'L-CKD220 齿轮油', '换油', '3个月', back(10), 12, 'VG220'],
  ],
});
r = run(oilname, [], 'oilname');
eq(r.summary.counts.oilNameConflicts, 1, '9.1 识别 1 组疑似同一油品');
eq(r.lube.oilNameConflicts[0].names.length, 2, '9.2 两种写法均列出');
ok(r.lube.warnings.some((w) => w.includes('疑似同一油品')), '9.3 油品名不一致 warning');
ok(/未自动合并/.test(r.md), '9.4 报告明示未自动合并');
// 9.5 跨表比对：写法只出现在加换油记录中时也能识别
const oilname2 = mk('oilname2.xlsx', {
  '润滑台账': [LED_HDR, ['P-01', '泵1', '轴承箱', 'L-TSA46 透平油', '换油', '3个月', back(10), 8, 'VG46']],
  '加换油记录': [REC_HDR, [back(10), 'P-01', 'L-TSA46透平油', '换油', 8, 'L', '张'], [back(5), 'P-01', '昆仑 L-TSA 46 透平油', '补油', 2, 'L', '张'], [back(3), 'P-01', 'L-TSA32 透平油', '补油', 2, 'L', '张']],
});
r = run(oilname2, [], 'oilname2');
eq(r.summary.counts.oilNameConflicts, 1, '9.5 台账与记录表跨表写法不一致可识别');
eq(r.lube.consumption.byOil.length, 3, '9.6 消耗统计仍按记录表原写法分列，未合并到台账写法');
eq(r.lube.oilNameConflicts[0].names.length, 3, '9.7 品牌词「昆仑」与空格写法归入同一疑似组');
ok(r.lube.oilNameConflicts[0].names.includes('昆仑 L-TSA 46 透平油'), '9.8 带品牌词原写法保留未改写');
ok(!r.lube.oilNameConflicts[0].names.includes('L-TSA32 透平油'), '9.9 不同牌号 L-TSA32 不混入');
const priceB = mk('priceB.xlsx', { '油品单价': [['油品牌号', '单位', '单价'], ['长城L-TSA46透平油', 'L', 10]] });
r = run(oilname2, ['--price', priceB], 'priceB');
ok(r.lube.consumption.amount.items.filter((x) => x.price === 10).length === 2, '9.10 单价表品牌词写法与记录去品牌后匹配（2 条匹配，L-TSA32 不匹配）');

// ---- 10. 无加换油记录表 → 不输出消耗统计，计数为 null
r = run(base, [], 'norec');
eq(r.lube.consumption, null, '10.1 无加换油记录时 consumption 为 null');
eq(r.summary.counts.consumptionRecords, null, '10.2 记录条数为 null 而非 0');
ok(/未提供「加换油记录」数据/.test(r.md), '10.3 报告写未提供加换油记录');

// ---- 11. 单价折算：未提供 --price 不折算；提供后仅折算有匹配单价的
const price = mk('price.xlsx', { '油品单价': [['油品名称', '单位', '单价'], ['L-TSA46 透平油', 'L', 20]] });
r = run(mix, [], 'noprice');
eq(r.lube.consumption.amount, null, '11.1 未提供单价表时不折算金额');
ok(r.lube.warnings.some((w) => w.includes('未使用估计单价')), '11.2 warning 明示未使用估计单价');
ok(/未使用任何估计单价/.test(r.md), '11.3 报告明示未使用估计单价');
r = run(mix, ['--price', price], 'withprice');
const amt = r.lube.consumption.amount;
eq(amt.total, 600, '11.4 有匹配单价的按量折算（30L×20）');
ok(amt.items.some((x) => x.unit === '桶' && x.amount === null && x.note === '单价表无匹配项'), '11.5 无匹配单价项不折算');
ok(r.lube.warnings.some((w) => w.includes('未找到匹配单价')), '11.6 无匹配单价 warning');

// ---- 12. 合计行跳过 + 标题行表头识别 + 别名列头 + 数字周期
const exp = mk('export.xlsx', {
  '润滑台账': [
    ['某厂 润滑计划导出表'],
    [],
    ['设备位号', '名称', '加油部位', '油品', '作业方式', '周期', '上次加换油', '定额油量', '规格'],
    ['P-01', '泵1', '轴承箱', 'L-TSA32 透平油', '换油', '180', back(200), 6, 'VG32'],
    ['P-02', '泵2', '轴承箱', 'L-TSA32 透平油', '换油', '1年', back(100), 6, 'VG32'],
    ['P-03', '泵3', '轴承箱', 'L-TSA32 透平油', '换油', '半年', back(50), 6, 'VG32'],
    ['P-04', '注油器', '油杯', 'L-TSA32 透平油', '补油', '每班', back(0), '0.2L', 'VG32'],
    ['合计', '', '', '', '', '', '', '', ''],
  ],
});
r = run(exp, [], 'export');
eq(r.summary.ok, true, '12.1 导出风格表可读（标题行+别名列头）');
eq(r.summary.counts.ledgerItems, 4, '12.2 合计行被跳过');
eq(r.summary.counts.undetermined, 0, '12.5 「半年」「每班」现可解析，不再进未判定');
ok(r.lube.normal.some((x) => x.tag === 'P-03' && x.periodDays === 182), '12.6 「半年」按 182 天解析进周期内');
ok(r.lube.dueSoon.some((x) => x.tag === 'P-04' && x.periodDays < 1), '12.7 「每班」班次级周期解析为小数天并按临期提醒');
ok(r.lube.dueSoon.find((x) => x.tag === 'P-04').qty === 0.2, '12.8 带单位加油量「0.2L」剥离单位取数值');
ok(r.lube.warnings.some((w) => w.includes('已剥离单位')), '12.9 带单位数值 warning 提示核对单位');
ok(r.lube.warnings.some((w) => w.includes('合计行')), '12.3 合计行 warning');
eq(r.lube.overdue[0].overdueDays, 20, '12.4 纯数字周期按天解析（180天）');

// ---- 13. 位号为空跳过并 warning
const notag = mk('notag.xlsx', {
  '润滑台账': [LED_HDR,
    ['', '无位号', '轴承箱', 'L-TSA46 透平油', '换油', '3个月', back(10), 8, 'VG46'],
    ['P-01', '泵1', '轴承箱', 'L-TSA46 透平油', '换油', '3个月', back(10), 8, 'VG46'],
  ],
});
r = run(notag, [], 'notag');
eq(r.summary.counts.ledgerItems, 1, '13.1 空位号行被跳过');
ok(r.lube.warnings.some((w) => w.includes('位号为空')), '13.2 空位号 warning');

// ---- 14. --equipment 限定范围
r = run(und, ['--equipment', 'P-05'], 'scope');
eq(r.summary.counts.ledgerItems, 1, '14.1 仅统计范围内设备');
eq(r.summary.counts.undetermined, 0, '14.2 范围外未判定项不计入');
ok(r.lube.warnings.some((w) => w.includes('不在范围内')), '14.3 范围过滤 warning');

// ---- 15. 缺少润滑台账（唯一数据源）→ ok:false 且 exit 1
const bad = mk('bad.xlsx', { '随便一张表': [['a', 'b'], [1, 2]] });
r = run(bad, [], 'bad');
eq(r.summary.ok, false, '15.1 无润滑台账时 ok:false');
eq(r.code, 1, '15.2 退出码为 1');
ok(/未在输入中找到「润滑台账」/.test(r.summary.error), '15.3 错误信息明确');

// ---- 16. 参数校验
function runRaw(args) {
  const x = spawnSync(process.execPath, [LUBE, ...args], { encoding: 'utf8' });
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
x = runRaw(['--input', base, '--date', DATE]);
eq(x.s.ok, false, '16.8 缺 --workshop 报错');
x = runRaw(['--input', base, '--workshop', '车间', '--date', DATE, '--price', '/不存在的单价.xlsx']);
eq(x.s.ok, false, '16.9 单价表不存在报错');

// ---- 17. summary.json 落盘与产出结构
r = run(mix, ['--price', price], 'struct');
ok(fs.existsSync(path.join(r.out, 'summary.json')), '17.1 summary.json 已写入');
const sj = JSON.parse(fs.readFileSync(path.join(r.out, 'summary.json'), 'utf8'));
eq(sj.ok, true, '17.2 summary.json 内容正确');
ok(fs.existsSync(path.join(r.out, 'lube.json')), '17.3 lube.json 已写入');
ok(/## 一、到期概览/.test(r.md) && /## 二、五定齐备率/.test(r.md) && /## 三、逾期清单/.test(r.md) && /## 四、临期清单/.test(r.md)
  && /## 五、无法判定清单/.test(r.md) && /## 六、油品消耗统计/.test(r.md) && /## 七、油液分析/.test(r.md)
  && /## 八、润滑管理情况说明/.test(r.md), '17.4 八节结构齐全');
ok(r.md.includes('本材料由脚本汇总、模型成文，仅供设备员复核参考，不替代审批、定性、验收与签字；厂内制度与系统数据为准。'), '17.7 声明行写入报告');
ok(!/[\u2705\u26a0\u274c\u{1F6A8}]/u.test(r.md), '17.8 报告不含 emoji');
ok(/【注意】单位混用/.test(r.md), '17.9 醒目提示用【注意】');
ok(r.lube.meta.declaration && Array.isArray(r.lube.wuding), '17.10 JSON 含声明行与五定节');
ok(/<!-- ANALYSIS_START -->/.test(r.md) && /<!-- ANALYSIS_END -->/.test(r.md), '17.5 分析段占位符存在');
ok(/（北京时间）/.test(r.md), '17.6 报告标注北京时间');

// ---- 18. 样例可再生：seed 改变数值但结论不变
const MS = path.join(__dirname, 'make-sample.js');
function sample(seed) {
  const dir = path.join(work, 'sample-' + seed);
  spawnSync(process.execPath, [MS, '--out', dir, '--seed', String(seed), '--date', DATE], { encoding: 'utf8' });
  return run(path.join(dir, `sample-lube-${DATE}.xlsx`), ['--price', path.join(dir, 'sample-oil-price.xlsx')], 'sample' + seed);
}
const s1 = sample(1), s7 = sample(7);
eq(s1.summary.ok, true, '18.1 样例可运行');
eq(s1.summary.counts.overdue, s7.summary.counts.overdue, '18.2 seed 变化逾期数不变');
eq(s1.summary.counts.undetermined, s7.summary.counts.undetermined, '18.3 seed 变化未判定数不变');
eq(s1.summary.counts.oaAbnormal, s7.summary.counts.oaAbnormal, '18.4 seed 变化油液异常数不变');
eq(s1.summary.counts.oaNoLimit, s7.summary.counts.oaNoLimit, '18.5 seed 变化无限值项数不变');
eq(s1.summary.counts.overdue, 4, '18.6 样例逾期恒为 4（含 1 项运行小时周期）');
eq(s1.summary.counts.dueSoon, 3, '18.7 样例临期恒为 3（含 1 项运行小时周期）');
eq(s1.summary.counts.undetermined, 3, '18.8 样例未判定恒为 3（含 1 项运行小时周期缺累计小时）');
eq(s1.summary.counts.runHoursItems, 3, '18.11 样例运行小时周期项恒为 3');
eq(s1.summary.counts.oaNoLimit, 2, '18.12 不给 --ref-standard 时样例无限值项恒为 2');
eq(s1.lube.oilNameConflicts[0].names.length, 3, '18.13 样例油品名不一致组含品牌词写法共 3 种');
eq(s1.summary.counts.oaAbnormal, 2, '18.9 样例油液异常恒为 2');
eq(s1.summary.counts.oilNameConflicts, 1, '18.10 样例油品名不一致恒为 1 组');

// ---- 19. 共享别名（SAP PM / EM 导出列名）：功能位置→位号、设备描述→设备名称；设备编号流水号不当位号
const sap = mk('sap.xlsx', {
  '润滑台账': [
    ['功能位置', '设备编号', '设备描述', '润滑点名称', '油品牌号', '加注方式', '换油周期', '最近加换油日期', '定额油量', '黏度等级', '润滑责任人'],
    ['P-01', '10012345', '泵1', '轴承箱', 'L-TSA46 透平油', '换油', '3个月', back(120), 8, 'VG46', '赵工'],
    ['P-02', '10012346', '泵2', '轴承箱', 'L-TSA46 透平油', '换油', '3个月', back(10), 8, 'VG46', ''],
  ],
  '加换油记录': [['作业日期', '功能位置', '油品牌号', '作业类型', '用量', '计量单位', '操作人'], [back(10), 'P-02', 'L-TSA46 透平油', '换油', 8, 'L', '王']],
});
r = run(sap, [], 'sap');
eq(r.summary.ok, true, '19.1 SAP/EM 列名可读');
eq(r.summary.counts.ledgerItems, 2, '19.2 功能位置列作位号');
eq(r.lube.overdue[0].tag, 'P-01', '19.3 位号取自功能位置而非设备编号');
eq(r.lube.overdue[0].equipNo, '10012345', '19.4 设备编号单独成列展示');
eq(r.lube.overdue[0].name, '泵1', '19.5 设备描述→设备名称');
eq(r.lube.overdue[0].owner, '赵工', '19.6 润滑责任人→责任人');
eq(r.lube.overdue[0].periodRaw, '3个月', '19.7 换油周期→润滑周期');
eq(r.lube.consumption.byEquipment[0].key, 'P-02', '19.8 记录表功能位置列作位号');
const sapNo = mk('sapno.xlsx', { '润滑台账': [['设备编号', '设备描述', '油品牌号', '换油周期', '最近加换油日期'], ['10012345', '泵1', 'L-TSA46', '3个月', back(10)]] });
r = run(sapNo, [], 'sapno');
eq(r.summary.ok, true, '19.9 仅有设备编号无位号时不中断');
eq(r.summary.counts.ledgerItems, 0, '19.10 设备编号不被当作位号（缺位号列 warning，行按位号空跳过）');
ok(r.lube.warnings.some((w) => w.includes('缺少列: 位号')), '19.11 缺位号列 warning');

// ---- 20. 五定齐备率：按列统计；缺列不按齐备
const LED5 = ['位号', '设备名称', '润滑部位', '油品名称', '润滑方式', '润滑周期', '上次加换油日期', '加油量', '油品规格', '责任人'];
const wd = mk('wuding.xlsx', {
  '润滑台账': [LED5,
    ['P-01', '泵1', '轴承箱', 'L-TSA46 透平油', '换油', '3个月', back(10), 8, 'VG46', '张工'],
    ['P-02', '泵2', '', 'L-TSA46 透平油', '换油', '3个月', back(10), '', 'VG46', ''],
    ['P-03', '泵3', '轴承箱', 'L-TSA46 透平油', '换油', '', back(10), 8, 'VG46', '张工'],
    ['P-04', '泵4', '轴承箱', 'L-TSA46 透平油', '换油', '3个月', back(10), 8, 'VG46', ''],
  ],
});
r = run(wd, [], 'wuding');
const W = Object.fromEntries(r.lube.wuding.map((x) => [x.key, x]));
eq(W['定点'].rate, 75, '20.1 定点齐备率 3/4');
eq(W['定质'].rate, 100, '20.2 定质齐备率 4/4');
eq(W['定量'].rate, 75, '20.3 定量齐备率 3/4');
eq(W['定期'].rate, 75, '20.4 定期齐备率 3/4');
eq(W['定人'].rate, 50, '20.5 定人齐备率 2/4');
eq(W['定人'].missing, 2, '20.6 定人未填 2 项');
ok(/\| 定人 \| 责任人 \| 2\/4 \| 50\.0% \| 2 项未填 \|/.test(r.md), '20.7 报告五定表写出定人齐备率');
ok(/三过滤/.test(r.md), '20.8 报告提及三过滤属现场作业要求');
r = run(base, [], 'wuding-nocol');
const W2 = Object.fromEntries(r.lube.wuding.map((x) => [x.key, x]));
eq(W2['定人'].rate, null, '20.9 台账无责任人列时定人齐备率为 null 而非 100');
eq(W2['定人'].hasCol, false, '20.10 hasCol 标记缺列');
ok(r.lube.warnings.some((w) => w.includes('缺「责任人」列')), '20.11 缺责任人列 warning 提示补齐定人');
ok(/台账无此列，无法统计（不按齐备处理）/.test(r.md), '20.12 报告写明缺列不按齐备');

// ---- 21. 运行小时周期：parseRunHours 识别，按累计小时判定，不折算日历天
const LEDH = ['位号', '设备名称', '润滑部位', '油品名称', '润滑方式', '润滑周期', '上次加换油日期', '加油量', '油品规格', '责任人', '累计运行小时', '上次加换油时累计小时', '自上次加换油运行小时'];
const rh = mk('runhours.xlsx', {
  '润滑台账': [LEDH,
    ['K-01', '机1', '油箱', 'L-TSA46 透平油', '换油', '运行2000小时', back(400), 30, 'VG46', '李', 18650, 16400, ''],   // 用 2250h → 逾期 250h
    ['K-02', '机2', '油箱', 'L-TSA46 透平油', '换油', '2000h', back(400), 30, 'VG46', '李', '', '', 1900],            // 剩 100h → 临期（≤168h）
    ['K-03', '机3', '油箱', 'L-TSA46 透平油', '换油', '2000H', back(400), 30, 'VG46', '李', '', '', 500],             // 剩 1500h → 正常
    ['K-04', '机4', '油箱', 'L-TSA46 透平油', '换油', '运行4000小时', back(400), 30, 'VG46', '李', '', 30000, ''],       // 缺累计小时 → 未判定
    ['K-05', '机5', '油箱', 'L-TSA46 透平油', '换油', '运行4000小时', back(400), 30, 'VG46', '李', 33500, '', ''],       // 缺上次小时 → 未判定
    ['K-06', '机6', '油箱', 'L-TSA46 透平油', '换油', '运行2000小时', back(400), 30, 'VG46', '李', 16000, 16400, ''],    // 累计 < 上次 → 矛盾未判定
    ['K-07', '机7', '油箱', 'L-TSA46 透平油', '换油', '48h', back(400), 30, 'VG46', '李', '', '', ''],                 // 48h ≤168 是日历周期 → 逾期 398 天
  ],
});
r = run(rh, [], 'runhours');
eq(r.summary.counts.runHoursItems, 6, '21.1 6 项识别为运行小时周期（48h 为日历周期）');
eq(r.summary.counts.overdue, 2, '21.2 逾期：K-01（运行小时）+ K-07（日历 48h）');
const k01 = r.lube.overdue.find((x) => x.tag === 'K-01');
eq(k01.periodType, 'runHours', '21.3 周期类型 runHours');
eq(k01.periodHours, 2000, '21.4 周期小时 2000');
eq(k01.usedHours, 2250, '21.5 已运行 = 累计 − 上次加换油时累计');
eq(k01.overdueHours, 250, '21.6 逾期 250h');
eq(k01.overdueDays, null, '21.7 运行小时周期不折算逾期天数');
eq(k01.dueDate, null, '21.8 运行小时周期不生成应到期日');
eq(k01.level, '轻微逾期', '21.9 逾期程度按小时比例分档');
const k02 = r.lube.dueSoon.find((x) => x.tag === 'K-02');
ok(k02 && k02.remainHours === 100 && k02.remainDays === null, '21.10 直接给「自上次加换油运行小时」时按剩余小时临期');
ok(r.lube.normal.some((x) => x.tag === 'K-03' && x.remainHours === 1500), '21.11 2000H 大写识别并归周期内');
eq(r.summary.counts.undetermined, 3, '21.12 缺累计/缺上次/矛盾 三项未判定');
ok(r.lube.undetermined.some((x) => x.tag === 'K-04' && /缺累计运行小时/.test(x.reason)), '21.13 缺累计运行小时原因');
ok(r.lube.undetermined.some((x) => x.tag === 'K-05' && /上次加换油时累计小时/.test(x.reason)), '21.14 缺上次加换油时累计小时原因');
ok(r.lube.undetermined.some((x) => x.tag === 'K-06' && /矛盾/.test(x.reason)), '21.15 累计小于上次小时数 → 矛盾未判定');
ok(!r.lube.overdue.some((x) => x.tag === 'K-04' || x.tag === 'K-05'), '21.16 缺数据的运行小时项未按日历天折算成逾期');
const k07 = r.lube.overdue.find((x) => x.tag === 'K-07');
ok(k07 && k07.periodType === 'calendar' && k07.periodDays === 2, '21.17 48h 按日历周期 2 天处理');
ok(/运行2,000h/.test(r.md) && /250h/.test(r.md), '21.18 报告按小时列示运行小时周期');
ok(r.lube.warnings.some((w) => w.includes('未按日历天折算')), '21.19 warning 明示未折算日历天');
// --lead-hours 参数化
r = run(rh, ['--lead-hours', '50'], 'leadh50');
ok(!r.lube.dueSoon.some((x) => x.tag === 'K-02'), '21.20 --lead-hours 50 时剩 100h 不算临期');
r = run(rh, ['--lead-hours', '1600'], 'leadh1600');
ok(r.lube.dueSoon.some((x) => x.tag === 'K-03'), '21.21 --lead-hours 放大后 K-03 进临期');
eq(r.lube.meta.leadHours, 1600, '21.22 meta 记录 leadHours');
r = run(rh, ['--lead-days', '10'], 'leadd10');
eq(r.lube.meta.leadHours, 240, '21.23 未给 --lead-hours 时默认 lead-days×24');
x = runRaw(['--input', rh, '--workshop', '车间', '--date', DATE, '--lead-hours', '-5']);
eq(x.s.ok, false, '21.24 非法 --lead-hours 报错');
// --run-hours 衔接 runtime-hours-tracker
const rtJson = path.join(work, 'runtime.json');
fs.writeFileSync(rtJson, JSON.stringify({ byEquipment: [{ tag: 'K-04', cumHours: 33500 }, { tag: 'K-05', cumHours: 40000 }, { tag: 'K-09', cumHours: null }] }), 'utf8');
r = run(rh, ['--run-hours', rtJson], 'rt');
eq(r.summary.counts.undetermined, 2, '21.25 --run-hours 补齐 K-04 累计小时后未判定减 1');
ok(r.lube.normal.some((x) => x.tag === 'K-04' && x.usedHours === 3500 && /--run-hours/.test(x.usedSource)), '21.26 K-04 用 runtime.json 的 cumHours 判定并记来源');
ok(r.lube.undetermined.some((x) => x.tag === 'K-05'), '21.27 K-05 仍缺上次加换油时小时数，--run-hours 不能替代');
ok(r.lube.warnings.some((w) => w.includes('K-09') && w.includes('无法解析')), '21.28 runtime.json 中 cumHours 为空 warning');
eq(r.lube.meta.runHoursProvided, true, '21.29 meta 记录 runHoursProvided');
// runtime.json 中本期运行小时不可算（periodHours 为 null）：cumHours 只剩期初/上期值，偏小 → 用到该台时 warning
const rtPart = path.join(work, 'runtime-partial.json');
fs.writeFileSync(rtPart, JSON.stringify({ byEquipment: [{ tag: 'K-04', cumHours: 33500, periodHours: null, cumBasis: 'base' }, { tag: 'K-05', cumHours: 40000, periodHours: null }] }), 'utf8');
r = run(rh, ['--run-hours', rtPart], 'rt-partial');
ok(r.lube.warnings.some((w) => w.includes('K-04') && w.includes('本期运行小时') && w.includes('偏小')), '21.29a runtime.json 本期运行小时为空时 warning：累计偏小');
ok(!r.lube.warnings.some((w) => w.includes('K-05') && w.includes('偏小')), '21.29b 未用到 --run-hours 累计的设备不提示');
ok(r.lube.normal.some((x) => x.tag === 'K-04' && x.usedHours === 3500), '21.29c 仍按给出的累计判定，不臆测补齐');
r = run(rh, ['--run-hours', rtJson], 'rt-full');
ok(!r.lube.warnings.some((w) => w.includes('偏小')), '21.29d 本期运行小时可算时不提示偏小');
const rtX = mk('rt.xlsx', { '累计运行小时': [['位号', '累计运行小时'], ['K-04', '33500h']] });
r = run(rh, ['--run-hours', rtX], 'rtx');
ok(r.lube.normal.some((x) => x.tag === 'K-04' && x.usedHours === 3500), '21.30 --run-hours 也接含「累计运行小时」的表（带单位可解析）');
x = runRaw(['--input', rh, '--workshop', '车间', '--date', DATE, '--run-hours', '/不存在.json']);
eq(x.s.ok, false, '21.31 --run-hours 不存在报错');
const rtBad = path.join(work, 'bad.json'); fs.writeFileSync(rtBad, '{"foo":1}', 'utf8');
x = runRaw(['--input', rh, '--workshop', '车间', '--date', DATE, '--run-hours', rtBad]);
eq(x.s.ok, false, '21.32 --run-hours JSON 无 byEquipment 报错');
// 台账与 --run-hours 都有累计小时：以台账为准，不一致时 warning 提示核对（不静默取其一）
const rtCmp = path.join(work, 'runtime-cmp.json');
fs.writeFileSync(rtCmp, JSON.stringify({ byEquipment: [{ tag: 'K-01', cumHours: 19000 }, { tag: 'K-05', cumHours: 33500 }] }), 'utf8');
r = run(rh, ['--run-hours', rtCmp], 'rtcmp');
ok(r.lube.warnings.some((w) => w.includes('K-01') && w.includes('18650') && w.includes('19000') && w.includes('以台账为准')), '21.33 台账累计 18650 与 --run-hours 19000 不一致 → warning 写明两值、以台账为准');
ok(r.lube.overdue.some((x) => x.tag === 'K-01' && x.usedHours === 2250), '21.34 不一致时仍按台账累计小时判定（2250h）');
ok(!r.lube.warnings.some((w) => w.includes('K-05') && w.includes('不一致')), '21.35 两处累计小时一致时不提示');

// ---- 22. --ref-standard：仅显式提供时作参考比对，单列、标注非厂内标准、不计入 oaAbnormal
const refT = mk('ref.xlsx', { '参考限值': [['油品类型', '检测项', '限值', '标准号'], ['', '铁含量(ppm)', '≤20', 'Q/XX-虚构-002'], ['透平油', '闪点(℃)', '≥190', 'Q/XX-虚构-001'], ['齿轮油', '闪点(℃)', '≥150', 'Q/XX-虚构-001'], ['', '酸值', '随便', '']] });
r = run(oa, ['--ref-standard', refT], 'ref');
eq(r.summary.counts.oaAbnormal, 1, '22.1 参考比对不计入厂内异常数');
eq(r.summary.counts.oaRefChecked, 2, '22.2 铁含量、闪点两项进参考比对');
eq(r.summary.counts.oaRefExceeded, 2, '22.3 铁 9999>20、闪点 180<190（透平油）均超参考限值');
eq(r.summary.counts.oaNoLimit, 1, '22.4 参考表无对应项的酸值仍为无限值项');
const refFe = r.lube.oilAnalysis.refChecked.find((x) => /铁/.test(x.item));
eq(refFe.refStandard, 'Q/XX-虚构-002', '22.5 参考出处写标准号');
eq(refFe.exceeded, undefined, '22.6 参考比对项不带厂内 exceeded 字段');
ok(/非厂内标准，仅供参考/.test(refFe.note), '22.7 参考项 note 标注非厂内标准');
const refFp = r.lube.oilAnalysis.refChecked.find((x) => /闪点/.test(x.item));
eq(refFp.refLimit, '≥190', '22.8 油品类型按台账油品（透平油）匹配而非齿轮油行');
ok(/非厂内标准、仅供参考，不作为换油或异常判定依据/.test(r.md), '22.9 报告参考比对节标注非厂内标准');
ok(/超参考限值（非厂内标准）/.test(r.md), '22.10 报告逐项标注');
ok(r.lube.warnings.some((w) => w.includes('限值「随便」无法解析，该参考项不启用')), '22.11 参考表限值不可解析 warning');
r = run(oa, [], 'noref');
eq(r.summary.counts.oaRefChecked, 0, '22.12 未给 --ref-standard 时不作任何参考比对');
eq(r.summary.counts.oaNoLimit, 3, '22.13 未给 --ref-standard 时无限值项全部只列数值');
ok(/未提供 `--ref-standard` 参考限值表，不作参考比对/.test(r.md), '22.14 报告写明未作参考比对');
eq(r.lube.oilAnalysis.refStandardProvided, false, '22.15 refStandardProvided=false');
x = runRaw(['--input', oa, '--workshop', '车间', '--date', DATE, '--ref-standard', '/不存在.xlsx']);
eq(x.s.ok, false, '22.16 --ref-standard 不存在报错');
const refNoSheet = mk('refnosheet.xlsx', { '别的': [['a'], [1]] });
x = runRaw(['--input', oa, '--workshop', '车间', '--date', DATE, '--ref-standard', refNoSheet]);
eq(x.s.ok, false, '22.17 参考表缺「参考限值」工作表报错');

// ---- 23. 样例配套文件：--run-hours 与 --ref-standard 对样例的预期
const sdir = path.join(work, 'sample-1');
const sRun = run(path.join(sdir, `sample-lube-${DATE}.xlsx`), ['--run-hours', path.join(sdir, 'sample-runtime.json'), '--ref-standard', path.join(sdir, 'sample-ref-limits.xlsx')], 'sample-rh');
eq(sRun.summary.counts.undetermined, 2, '23.1 样例配 --run-hours 后未判定 3→2');
eq(sRun.summary.counts.normal, 5, '23.2 P-1105 进周期内');
eq(sRun.summary.counts.oaRefChecked, 2, '23.3 样例配 --ref-standard 后 2 项参考比对');
eq(sRun.summary.counts.oaRefExceeded, 1, '23.4 其中 1 项超参考限值');
eq(sRun.summary.counts.oaNoLimit, 0, '23.5 无限值项清零');
eq(sRun.summary.counts.oaAbnormal, 2, '23.6 厂内异常仍为 2');
ok(fs.existsSync(path.join(sdir, 'sample-run-hours.xlsx')) && fs.existsSync(path.join(sdir, 'sample-lube-export.xlsx')), '23.7 样例文件齐全');
const sExp = run(path.join(sdir, 'sample-lube-export.xlsx'), [], 'sample-exp');
eq(sExp.summary.counts.undetermined, 0, '23.8 导出样例「半年」「每班」均可解析');
eq(sExp.summary.counts.ledgerItems, 4, '23.9 导出样例 4 项（设备编号列不当位号）');
ok(sExp.lube.normal.concat(sExp.lube.overdue, sExp.lube.dueSoon).every((x) => /^[PX]-21/.test(x.tag) && /^1001/.test(x.equipNo)), '23.10 位号取功能位置、设备编号单列');

// ---- 24. 默认输出目录为系统临时目录
{
  const xx = spawnSync(process.execPath, [LUBE, '--input', base, '--workshop', '车间', '--date', DATE], { encoding: 'utf8' });
  const lines = xx.stdout.trim().split('\n');
  const sj2 = JSON.parse(lines[lines.length - 1]);
  ok(sj2.ok === true && sj2.out.startsWith(os.tmpdir()), '24.1 未给 --out 时默认写系统临时目录');
}

// ---- 车间范围核对（D007）：润滑台账/加换油记录/油液分析混入其他车间时剔除；空车间保留；全不一致不筛并开头【注意】；无车间列/维护工厂不筛；台账外油样检测保留
{
  const ws = (x) => ((x.lube && x.lube.meta && x.lube.meta.workshopScope) || []);
  const W = (x) => ((x.summary && x.summary.warnings) || []);
  let plantBook = null;
  const mkP = (n, b) => { plantBook = b; return mk(n, b); };
  const LW = ['位号', '设备名称', '车间', '润滑部位', '油品名称', '润滑方式', '润滑周期', '上次加换油日期', '加油量', '油品规格'];
  const mixF = mk('ws-mix.xlsx', {
    '润滑台账': [LW,
      ['P-01', '泵1', '测试车间', '轴承箱', 'L-TSA46 透平油', '换油', '3个月', back(120), 8, 'VG46'],
      ['P-02', '泵2', '测试车间', '轴承箱', 'L-TSA46 透平油', '换油', '90天', back(87), 8, 'VG46'],
      ['P-03', '泵3', '', '轴承箱', 'L-CKD220 齿轮油', '换油', '1年', back(30), 12, 'VG220'],
      ['P-91', '外车间泵', '催化车间', '轴承箱', 'L-TSA46 透平油', '换油', '3个月', back(200), 8, 'VG46'],
      ['P-92', '外车间泵', '催化车间', '轴承箱', 'L-TSA46 透平油', '换油', '3个月', back(200), 8, 'VG46'],
    ],
    '加换油记录': [['日期', '位号', '车间', '油品名称', '类型', '数量', '单位', '执行人'],
      [back(3), 'P-01', '测试车间', 'L-TSA46 透平油', '补油', 2, 'L', '张'],
      [back(3), 'P-91', '催化车间', 'L-TSA46 透平油', '换油', 50, 'L', '王']],
    '油液分析': [['位号', '车间', '取样日期', '检测项', '检测值', '限值', '结论'],
      ['P-01', '测试车间', back(5), '水分(mg/kg)', 120, '≤300', ''],
      ['P-91', '催化车间', back(5), '水分(mg/kg)', 900, '≤300', ''],
      ['Z-99', '', back(5), '水分(mg/kg)', 800, '≤300', '']],
  });
  r = run(mixF, [], 'ws-mix');
  eq(r.summary.ok, true, 'WS.1 车间混合输入运行成功');
  eq((r.summary.counts || {}).ledgerItems, 3, 'WS.2 剔除其他车间后台账润滑项 3');
  eq((r.summary.counts || {}).overdue, 1, 'WS.3 逾期只计本车间 P-01（不含催化车间 P-91/P-92）');
  ok(!((r.lube && r.lube.overdue) || []).some((x) => /^P-9/.test(x.tag)), 'WS.4 逾期清单不含其他车间位号');
  ok(W(r).some((w) => w.includes('工作表「润滑台账」按 --workshop「测试车间」剔除其他车间 2 行') && w.includes('催化车间 2 行')), 'WS.5 warning 写明剔除行数与车间名');
  const s0 = ws(r).find((x) => x.sheet === '润滑台账') || {};
  eq(s0.status, 'checked', 'WS.6 meta.workshopScope 台账状态 checked');
  eq(s0.droppedRows, 2, 'WS.7 meta.workshopScope 记录剔除 2 行');
  eq((s0.dropped || {})['催化车间'], 2, 'WS.8 dropped 按车间名记行数');
  eq(s0.blank, 1, 'WS.9 车间为空 1 行计入 blank');
  eq((r.summary.counts || {}).normal, 1, 'WS.10 车间为空的 P-03 按本车间保留（周期内 1 项）');
  ok(W(r).some((w) => w.includes('工作表「润滑台账」车间列为空 1 行，按本车间保留')), 'WS.11 车间为空 warning 写明行数');
  ok(/车间范围：已按车间列核对「测试车间」，剔除其他车间的行：「润滑台账」2 行（催化车间 2 行）/.test(r.md || ''), 'WS.12 md 口径处写明剔除情况');
  eq((r.summary.counts || {}).consumptionRecords, 1, 'WS.13 加换油记录剔除其他车间后消耗只计 1 条');
  ok(ws(r).some((x) => x.sheet === '加换油记录' && x.status === 'checked' && x.droppedRows === 1), 'WS.14 meta.workshopScope 含加换油记录核对结果');
  ok(ws(r).some((x) => x.sheet === '油液分析' && x.status === 'checked' && x.droppedRows === 1), 'WS.15 meta.workshopScope 含油液分析核对结果');
  const ool = ((r.lube && r.lube.oilAnalysis && r.lube.oilAnalysis.outOfLedger) || []).map((x) => x.tag);
  ok(ool.includes('Z-99') && !ool.includes('P-91'), 'WS.16 其他车间油样按车间列剔除，车间为空的台账外位号仍单列为台账外油样');
  eq((r.summary.counts || {}).oaAbnormal, 0, 'WS.17 其他车间超限油样不计入本车间异常');

  const misF = mk('ws-mis.xlsx', { '润滑台账': [LW,
    ['P-91', '外车间泵', '催化车间', '轴承箱', 'L-TSA46 透平油', '换油', '3个月', back(200), 8, 'VG46'],
    ['P-92', '外车间泵', '催化车间', '轴承箱', 'L-TSA46 透平油', '换油', '3个月', back(200), 8, 'VG46']] });
  r = run(misF, [], 'ws-mis');
  eq((r.summary.counts || {}).ledgerItems, 2, 'WS.18 车间列全不一致时不筛');
  eq((ws(r)[0] || {}).status, 'mismatch', 'WS.19 meta.workshopScope 状态 mismatch');
  ok(W(r).some((w) => w.startsWith('【注意】') && w.includes('催化车间')), 'WS.20 全不一致 warning 以【注意】开头');
  ok(/^# [^\n]*\n\n【注意】工作表「润滑台账」的车间列取值与 --workshop「测试车间」不一致，未按车间筛选，请核对输入。/.test(r.md || ''), 'WS.21 md 标题后紧跟【注意】提示');
  ok(((r.md || '').split('## 一、')[0]).includes('车间列取值与 --workshop'), 'WS.22 【注意】在正文第一节之前');

  r = run(base, [], 'ws-nocol');
  eq((ws(r)[0] || {}).status, 'noColumn', 'WS.23 无车间列 status 为 noColumn');
  ok(/车间范围：输入未含车间列，车间范围以取数条件为准。/.test(r.md || ''), 'WS.24 无车间列时 md 口径写明以取数条件为准');
  eq((r.summary.counts || {}).ledgerItems, 3, 'WS.25 无车间列不筛');

  const plantF = mkP('ws-plant.xlsx', { '润滑台账': [['位号', '维护工厂', '润滑部位', '油品名称', '润滑周期', '上次加换油日期'],
    ['P-01', '1100', '轴承箱', 'L-TSA46 透平油', '3个月', back(120)], ['P-02', '1200', '轴承箱', 'L-TSA46 透平油', '90天', back(87)]] });
  r = run(plantF, [], 'ws-plant');
  eq((ws(r)[0] || {}).status, 'noColumn', 'WS.26 「维护工厂」不当车间列（noColumn）');
  ok((ws(r)[0] || {}).column === null && !(ws(r)[0] || {}).ignoredColumn, 'WS.27 「维护工厂」不读入车间字段（column 为 null，无 ignoredColumn）');
  eq((r.summary.counts || {}).ledgerItems, 2, 'WS.28 「维护工厂」列不参与筛选');
  // 人员列「车间负责人」不当车间列（common.js 只认 车间/所属车间/属地车间/运行部 及其后加「名称」）
  r = run(mk('ws-person.xlsx', JSON.parse(JSON.stringify(plantBook).split('维护工厂').join('车间负责人'))), [], 'ws-person');
  ok((ws(r)[0] || {}).status === 'noColumn' && (ws(r)[0] || {}).ignoredColumn === '车间负责人' && r.summary.ok === true, 'WS.29 「车间负责人」人员列判 noColumn，ignoredColumn 记下，不筛');
}

// ---- 输出
console.log(`\n${'='.repeat(56)}`);
console.log(`lubrication-manager 自测：${pass} 通过，${fail} 失败`);
if (failures.length) { console.log('\n失败项：'); failures.forEach((f) => console.log('  ✗ ' + f)); }
console.log('='.repeat(56));
try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
