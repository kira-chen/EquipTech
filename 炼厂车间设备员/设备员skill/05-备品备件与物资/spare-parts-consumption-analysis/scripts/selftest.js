#!/usr/bin/env node
'use strict';
/** 自测：断言 consumption.js 行为。用法：node scripts/selftest.js */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { writeXlsx, readXlsx } = require('./lib/xlsx-lite');

const CS = path.join(__dirname, 'consumption.js');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'spc-selftest-'));
let pass = 0, fail = 0;
const failures = [];
const ok = (c, n) => { if (c) pass++; else { fail++; failures.push(n); } };
const eq = (a, e, n) => ok(a === e, `${n}（期望 ${JSON.stringify(e)}，实际 ${JSON.stringify(a)}）`);

function run(args, tag) {
  const out = path.join(work, tag + '-out');
  const r = spawnSync(process.execPath, [CS, ...args, '--out', out], { encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  let s; try { s = JSON.parse(lines[lines.length - 1]); } catch (e) { s = { ok: false, error: 'no-json:' + r.stdout + r.stderr }; }
  let j = null, md = null;
  if (fs.existsSync(path.join(out, 'consumption.json'))) j = JSON.parse(fs.readFileSync(path.join(out, 'consumption.json'), 'utf8'));
  if (fs.existsSync(path.join(out, 'consumption.md'))) md = fs.readFileSync(path.join(out, 'consumption.md'), 'utf8');
  return { code: r.status, s, j, md, out };
}
const mk = (n, b) => { const p = path.join(work, n); writeXlsx(p, b); return p; };
const BASE = ['--workshop', '测试车间', '--from', '2026-07-01', '--to', '2026-09-30'];

const OUT = mk('out.xlsx', {
  '出库记录': [
    ['出库日期', '备件编码', '备件名称', '数量', '单位', '位号', '领用单位', '用途'],
    ['2026-07-10', 'A-01', '机械密封', 1, '套', 'P-01', '设备组', '更换'],
    ['2026-08-10', 'A-01', '机械密封', 2, '套', 'P-01', '设备组', '更换'],
    ['2026-09-10', 'A-01', '机械密封', 3, '套', 'P-02', '设备组', '更换'],
    ['2026-08-15', 'B-01', '轴承', 4, '套', 'P-01', '设备组', '更换'],
    ['2026-09-15', 'C-01', '润滑油', 20, 'L', 'P-02', '设备组', '换油'],
    ['2026-09-16', 'D-01', '螺栓', 50, '个', '', '设备组', '库存补充'],
    ['2026-09-17', 'B-01', '轴承', '', '套', 'P-03', '设备组', '数量待核'],
    ['2026-06-01', 'A-01', '机械密封', 9, '套', 'P-09', '设备组', '区间外'],
  ],
});

// ============ A. 基础统计 ============
let r = run(['--input', OUT, ...BASE], 'base');
eq(r.s.ok, true, 'A1 基础运行成功');
eq(r.s.counts.records, 7, 'A2 区间外记录被排除');
ok(r.j.warnings.some((w) => w.includes('不在统计区间')), 'A3 区间外 warning');
eq(r.s.counts.codes, 4, 'A4 备件种类数');
eq(r.s.counts.equipment, 3, 'A5 涉及设备数（不含未归属）');
eq(r.s.counts.months, 3, 'A6 月份数');
ok(/## 一、统计概览/.test(r.md) && /## 二、按设备分布/.test(r.md) && /## 三、按备件分布/.test(r.md) && /## 四、时间分布/.test(r.md), 'A7 章节齐全');
ok(/<!-- ANALYSIS_START -->/.test(r.md) && /<!-- ANALYSIS_END -->/.test(r.md), 'A8 分析段占位符');

// ============ B. 未归属不平摊（核心） ============
eq(r.s.counts.unattributed, 1, 'B1 未归属 1 条');
ok(r.j.warnings.some((w) => w.includes('未平摊到其他设备')), 'B2 warning 声明未平摊');
ok(/未平摊到其他设备，也未排除后当作完整统计/.test(r.md), 'B3 md 声明未平摊未排除');
const d01 = r.j.byEquipment.find((g) => g.key === 'D-01');
ok(!d01, 'B4 未归属项不出现在按设备分布中');
// 未归属的量仍计入按备件分布（总量不丢）
const partD = r.j.byPart.find((g) => g.key === 'D-01');
ok(partD && partD.byUnit.some((u) => u.qty === 50), 'B5 未归属量仍计入按备件统计（总量不丢失）');
ok(/## 八、未归属消耗|## 七、未归属消耗/.test(r.md), 'B6 未归属单列一节');

// ============ C. 单位不换算（核心） ============
eq(r.s.counts.units, 3, 'C1 识别 3 种单位');
ok(r.j.warnings.some((w) => w.includes('未做换算')), 'C2 warning 声明未换算');
// P-02 同时领用「套」与「L」，应分两行而非相加
const p02 = r.j.byEquipment.find((g) => g.key === 'P-02');
eq(p02.byUnit.length, 2, 'C3 同设备多单位分别统计（不相加）');
ok(p02.byUnit.every((u) => ['套', 'L', '个'].includes(u.unit)), 'C4 单位原样保留');
// 3套 + 20L 绝不能合成 23
ok(!p02.byUnit.some((u) => u.qty === 23), 'C5 未把不同单位的数量相加');

// ============ D. 数量未填不按 0 ============
eq(r.s.counts.unknownQty, 1, 'D1 数量未填 1 条');
const b01 = r.j.byPart.find((g) => g.key === 'B-01');
eq(b01.unknownQty, 1, 'D2 unknownQty 记录在组内');
eq(b01.byUnit.find((u) => u.unit === '套').qty, 4, 'D3 未填数量不计入合计（不按 0 也不按均值）');
ok(/数量未填/.test(r.md), 'D4 md 显示数量未填计数');

// ============ E. 无单价不折算（核心） ============
eq(r.s.counts.amount, null, 'E1 未提供单价表时金额为 null');
ok(r.j.warnings.some((w) => w.includes('未使用任何估计单价')), 'E2 warning 声明未用估计单价');
ok(/未提供单价表且无本位币金额列，未折算/.test(r.md), 'E3 md 说明未折算（无单价表亦无本位币金额列）');
ok(!/金额.*\d{3,}/.test(r.md.split('## 二')[0]), 'E4 概览中无金额数字');

const PRICE = mk('price.xlsx', { '单价表': [['备件编码', '单价', '单位'], ['A-01', 1000, '套'], ['B-01', 500, '套']] });
r = run(['--input', OUT, ...BASE, '--price', PRICE], 'price');
ok(r.s.counts.amount > 0, 'E5 提供单价后折算金额');
ok(r.s.counts.unpriced > 0, 'E6 无单价的记录计入 unpriced');
const c01 = r.j.byPart.find((g) => g.key === 'C-01');
eq(c01.amount, null, 'E7 无单价的备件金额为 null 不是 0');

// ============ F. 异常增长按区间归一（核心） ============
const PREV_SRC = mk('prev.xlsx', {
  '出库记录': [['出库日期', '备件编码', '备件名称', '数量', '单位', '位号'],
    ['2026-04-10', 'A-01', '机械密封', 1, '套', 'P-01'],
    ['2026-05-10', 'B-01', '轴承', 4, '套', 'P-01']],
});
// 上期 3 个月
let pr = run(['--input', PREV_SRC, '--workshop', '测试车间', '--from', '2026-04-01', '--to', '2026-06-30'], 'prev3m');
r = run(['--input', OUT, ...BASE, '--prev', path.join(pr.out, 'consumption.json')], 'anom3m');
eq(r.s.ok, true, 'F1 带上期对比运行成功');
ok(r.s.counts.anomalies >= 1, 'F2 检出异常增长');
const a01 = r.j.anomalies.find((x) => x.code === 'A-01');
ok(a01, 'F3 机封检出异常（本期6套 vs 上期1套）');
ok(a01.ratio >= 2, 'F4 倍数达阈值');
ok(a01.note.includes('不断言原因'), 'F5 note 声明不断言原因');
ok(/本技能不断言原因/.test(r.md), 'F6 md 声明不断言原因');
ok(!/因为|由于|说明.*故障|表明/.test((r.md.match(/## [六七]、异常增长项[\s\S]*?##/) || [''])[0]), 'F7 异常节无归因表述');
// B-01 本期4套 上期4套，不应异常
ok(!r.j.anomalies.some((x) => x.code === 'B-01'), 'F8 持平的备件不报异常');
// 基期没有消耗、本期新出现的备件（C-01 润滑油、D-01 螺栓）：无倍数可算，单列提示，不静默漏掉、也不计入异常
const newCodes = ((r.j && r.j.newInPeriod) || []).map((x) => x.code).sort().join(',');
eq(newCodes, 'C-01,D-01', 'F16 基期无消耗、本期新出现的备件单列 newInPeriod');
ok(((r.j && r.j.newInPeriod) || []).some((x) => x.code === 'C-01' && x.unit === 'L' && x.current === 20), 'F17 newInPeriod 带单位与本期数量');
ok(!r.j.anomalies.some((x) => x.code === 'C-01'), 'F18 本期新出现的备件不计入异常增长（无倍数）');
ok(/基期无消耗、本期新出现/.test(r.md || ''), 'F19 md 异常节列出基期无消耗、本期新出现的备件');
eq(r.s.counts.newInPeriod, 2, 'F20 counts.newInPeriod 计数');

// 上期只有 1 个月 → 归一后倍数应下降
pr = run(['--input', PREV_SRC, '--workshop', '测试车间', '--from', '2026-04-01', '--to', '2026-04-30'], 'prev1m');
const r1m = run(['--input', OUT, ...BASE, '--prev', path.join(pr.out, 'consumption.json')], 'anom1m');
ok(r1m.j.warnings.some((w) => w.includes('日均归一')), 'F9 区间长度不同时提示已归一');
ok(r1m.j.compare.normalized === true, 'F10 compare 标记已归一');
const a01n = r1m.j.anomalies.find((x) => x.code === 'A-01');
ok(!a01n || a01n.ratio < a01.ratio, 'F11 归一后倍数低于未归一（避免区间长度造成虚高）');
ok(!a01n || a01n.currentPerDay !== null, 'F12 归一时输出日均值');

// 未提供上期 → null 不是 0
r = run(['--input', OUT, ...BASE], 'noprev');
eq(r.s.counts.anomalies, null, 'F13 未提供上期时异常为 null 不是 0');
eq(r.s.counts.newInPeriod, null, 'F13b 未提供上期时 newInPeriod 为 null 不是 0');
ok(/不做异常增长识别/.test(r.md), 'F14 md 说明未做异常识别');
// 阈值可调
r = run(['--input', OUT, ...BASE, '--prev', path.join(run(['--input', PREV_SRC, '--workshop', 'X', '--from', '2026-04-01', '--to', '2026-06-30'], 'prevb').out, 'consumption.json'), '--anomaly-ratio', '10'], 'highratio');
eq(r.s.counts.anomalies, 0, 'F15 提高阈值后无异常');

// ============ G. 设备台账归类 ============
const LED = mk('led.xlsx', {
  '设备台账': [['位号', '设备名称', '设备类型', '专业'],
    ['P-01', '泵1', '离心泵', '动设备'], ['P-02', '泵2', '离心泵', '动设备'], ['P-03', '泵3', '离心泵', '动设备']],
});
r = run(['--input', OUT, ...BASE, '--ledger', LED], 'ledger');
ok(r.j.byType !== null, 'G1 提供台账后按类型归类');
ok(r.j.byEquipment[0].label.includes('泵'), 'G2 设备标签带名称');
r = run(['--input', OUT, ...BASE], 'noledger');
eq(r.j.byType, null, 'G3 未提供台账时 byType 为 null');

// ============ H. 参数校验 ============
function raw(args) {
  const x = spawnSync(process.execPath, [CS, ...args], { encoding: 'utf8' });
  const l = x.stdout.trim().split('\n');
  try { return { code: x.status, s: JSON.parse(l[l.length - 1]) }; } catch (e) { return { code: x.status, s: { ok: false } }; }
}
eq(raw([]).s.ok, false, 'H1 无参数报错');
eq(raw(['--input']).s.ok, false, 'H2 --input 缺值报错');
ok(/缺少取值/.test(raw(['--input']).s.error), 'H3 缺值信息正确');
eq(raw(['--input', OUT]).s.ok, false, 'H4 缺 workshop 报错');
eq(raw(['--input', OUT, '--workshop', 'X']).s.ok, false, 'H5 缺 from 报错');
eq(raw(['--input', OUT, '--workshop', 'X', '--from', '2026-07-01']).s.ok, false, 'H6 缺 to 报错');
eq(raw(['--input', OUT, '--workshop', 'X', '--from', '2026-13-45', '--to', '2026-09-30']).s.ok, false, 'H7 非法日期报错');
eq(raw(['--input', OUT, '--workshop', 'X', '--from', '2026-09-30', '--to', '2026-07-01']).s.ok, false, 'H8 to 早于 from 报错');
eq(raw(['--input', OUT, ...BASE, '--by', 'xxx']).s.ok, false, 'H9 非法 by 报错');
eq(raw(['--input', OUT, ...BASE, '--top', 'abc']).s.ok, false, 'H10 非法 top 报错');
eq(raw(['--input', OUT, ...BASE, '--anomaly-ratio', '0.5']).s.ok, false, 'H11 异常倍数需大于1');
eq(raw(['--input', '/不存在.xlsx', ...BASE]).s.ok, false, 'H12 输入不存在报错');
eq(raw(['--input', OUT, ...BASE, '--未知', 'x']).s.ok, false, 'H13 未知参数报错');
eq(raw(['--input', mk('nosheet.xlsx', { '别的': [['a'], [1]] }), ...BASE]).s.ok, false, 'H14 无出库记录表报错');
eq(raw(['--input', OUT, '--workshop', 'X', '--from', '2020-01-01', '--to', '2020-12-31']).s.ok, false, 'H15 区间内无记录报错');
eq(raw(['--input', OUT, ...BASE, '--prev', '/不存在.json']).s.ok, false, 'H16 上期文件不存在报错');

// ============ K. 中石化口径：MB51 列名、移动类型冲销、本位币金额列、基期切换 ============
const MB51 = mk('mb51.xlsx', {
  '物料凭证': [['MB51 物料凭证清单'],
    ['物料', '物料描述', '基本计量单位', '过账日期', '数量', '移动类型', '本位币金额', '订单', '成本中心', '功能位置'],
    ['30012345', '机械密封 104-45', 'ST', '2026-07-10', 1, '261', 3200, '000401120001', 'CC1001', 'P-01'],
    ['30012345', '机械密封 104-45', 'ST', '2026-08-10', 2, '261', 6400, '000401120002', 'CC1001', 'P-01'],
    ['30012345', '机械密封 104-45', 'ST', '2026-08-12', 1, '262', 3200, '000401120002', 'CC1001', 'P-01'],   // 冲销 → -1
    ['30012345', '机械密封 104-45', 'ST', '2026-09-10', 3, '261', 9600, '000401120003', 'CC1001', 'P-02'],
    ['30020045', '深沟球轴承 6310 C3', 'ST', '2026-08-15', 4, '261', 1920, '000401120004', 'CC1001', 'P-01'],
    ['30020045', '深沟球轴承 6310 C3', 'ST', '2026-09-01', 20, '101', 9600, '', 'CC1001', ''],              // 收货 → 不计
    ['30050601', '螺栓 M20', 'ST', '2026-09-16', 50, '261', '', '', 'CC1001', ''],                        // 无金额、无位号
    ['30012345', '机械密封 104-45', 'ST', '2026-05-10', 1, '261', 3200, '000401110001', 'CC1001', 'P-01'],   // 基期
    ['30020045', '深沟球轴承 6310 C3', 'ST', '2026-05-12', 4, '261', 1920, '000401110002', 'CC1001', 'P-01'], // 基期
    ['合计', '', '', '', '', '', '', '', '', '']],
});
r = run(['--input', MB51, ...BASE], 'mb51');
eq(r.s.ok, true, 'K1 MB51 物料凭证表可读（工作表名「物料凭证」）');
eq(r.s.counts.records, 6, 'K2 区间内 7 行中 101 收货不计入 → 6 条');
ok(r.j.warnings.some((w) => /101 收货/.test(w) && /不计入消耗/.test(w)), 'K3 收货行不计入并 warning');
ok(r.j.warnings.some((w) => /冲销/.test(w) && /负数抵减/.test(w)), 'K4 262 冲销 warning');
eq(r.s.counts.reversals, 1, 'K5 counts 记录冲销条数');
const ms = r.j.byPart.find((g) => g.key === '30012345');
eq(ms.byUnit.find((u) => u.unit === 'ST').qty, 5, 'K6 机封合计 1+2-1+3 = 5（冲销按负数）');
eq(ms.amount, 16000, 'K7 金额直接取本位币金额列并抵减冲销：3200+6400-3200+9600');
eq(r.s.amountSource, '本位币金额列', 'K8 金额来源为本位币金额列');
ok(r.j.warnings.some((w) => /金额直接取该列/.test(w) && /未再乘单价/.test(w)), 'K9 提示金额未再乘单价');
ok(!r.j.warnings.some((w) => /未提供单价表/.test(w)), 'K10 有金额列时不再提示未提供单价表');
const bolt = r.j.byPart.find((g) => g.key === '30050601');
eq(bolt.amount, null, 'K11 金额列为空的备件金额为 null 不是 0');
eq(r.s.counts.unpriced, 1, 'K12 无金额记录计入 unpriced');
ok(/本位币金额列/.test(r.md), 'K13 md 概览写明金额来源');
eq(r.j.byEquipment.find((g) => g.key === 'P-01').records, 4, 'K14 「功能位置」命中位号');
eq(r.s.counts.unattributed, 1, 'K15 无功能位置的螺栓进未归属');
ok(r.j.unattributed[0].dept === 'CC1001', 'K16 「成本中心」命中领用单位');
// 金额列 + 单价表：金额列优先，空值用单价表
const PRICE2 = mk('price2.xlsx', { '单价表': [['物料', '单价'], ['30050601', 2], ['30012345', 9999]] });
r = run(['--input', MB51, ...BASE, '--price', PRICE2], 'mb51-price');
eq(r.j.byPart.find((g) => g.key === '30012345').amount, 16000, 'K17 有金额列时单价表不覆盖（不按 9999 重算）');
eq(r.j.byPart.find((g) => g.key === '30050601').amount, 100, 'K18 金额列为空的记录按单价表折算 50×2');
eq(r.s.amountSource, '本位币金额列（空值按单价表折算）', 'K19 金额来源写明两者');
// --prev-from/--prev-to 同一导出切基期
r = run(['--input', MB51, ...BASE, '--prev-from', '2026-04-01', '--prev-to', '2026-06-30'], 'prev-cut');
eq(r.s.ok, true, 'K20 同一导出切基期成功');
ok(/同一导出切基期/.test(r.s.prevSource), 'K21 prevSource 写明同一导出');
ok(r.j.compare && r.j.compare.prevPeriod === '2026-04-01 ~ 2026-06-30', 'K22 compare 记录基期区间');
const an = r.j.anomalies.find((x) => x.code === '30012345');
ok(!!an && an.previous === 1 && an.current === 5, 'K23 机封本期 5 vs 基期 1 → 异常');
ok(!r.j.anomalies.some((x) => x.code === '30020045'), 'K24 轴承 4 vs 4 不异常（101 收货未混入）');
ok(/基期来源：同一导出切基期/.test(r.md), 'K25 md 异常节写明基期来源');
// --prev 接上期出库 xlsx
const PREVX = mk('prevx.xlsx', { '出库记录': [['出库日期', '备件编码', '备件名称', '数量', '单位', '位号'], ['2026-05-10', 'A-01', '机械密封', 1, '套', 'P-01']] });
r = run(['--input', OUT, ...BASE, '--prev', PREVX, '--prev-from', '2026-04-01', '--prev-to', '2026-06-30'], 'prev-xlsx');
eq(r.s.ok, true, 'K26 --prev 接上期出库 xlsx 成功');
ok(/上期出库表/.test(r.s.prevSource), 'K27 prevSource 写明上期出库表');
ok(r.j.anomalies.some((x) => x.code === 'A-01' && x.previous === 1), 'K28 基期从 xlsx 读出并比对');
// 参数校验
eq(raw(['--input', OUT, ...BASE, '--prev', PREVX]).s.ok, false, 'K29 --prev 为 xlsx 但缺 --prev-from/--prev-to 报错');
eq(raw(['--input', OUT, ...BASE, '--prev-from', '2026-04-01']).s.ok, false, 'K30 只给 --prev-from 报错');
eq(raw(['--input', OUT, ...BASE, '--prev-from', '2026-04-01', '--prev-to', '2026-03-01']).s.ok, false, 'K31 基期倒置报错');
eq(raw(['--input', OUT, ...BASE, '--prev-from', '2026-08-01', '--prev-to', '2026-08-31']).s.ok, false, 'K32 基期与本期重叠报错');
eq(raw(['--input', OUT, ...BASE, '--prev-from', '2026/13/01', '--prev-to', '2026-06-30']).s.ok, false, 'K33 非法基期日期报错');
eq(raw(['--input', OUT, ...BASE, '--prev-from']).s.ok, false, 'K34 --prev-from 缺值报错');
// 基期无记录只 warning
r = run(['--input', OUT, ...BASE, '--prev-from', '2020-01-01', '--prev-to', '2020-01-31'], 'prev-empty');
eq(r.s.ok, true, 'K35 基期无记录不中断');
ok(r.j.warnings.some((w) => /基期.*没有出库记录/.test(w)), 'K36 基期无记录 warning');
eq(r.s.counts.anomalies, 0, 'K37 基期无记录时异常为 0（有基期但无可比项）');
eq(r.s.counts.newInPeriod, 0, 'K37b 基期整段无记录时不把本期全部备件列为新出现（无可比基期）');
// 「设备编号」不作位号别名
const EQNO = mk('eqno.xlsx', { '出库记录': [['出库日期', '备件编码', '数量', '设备编号'], ['2026-08-01', 'A-01', 1, '10001234']] });
r = run(['--input', EQNO, ...BASE], 'eqno');
eq(r.s.counts.unattributed, 1, 'K38 「设备编号」列不作位号（进未归属）');
ok(!/[\u2600-\u27BF\u{1F300}-\u{1FAFF}]/u.test(r.md), 'K39 md 不含 emoji');

// ============ I. 别名与合计行 ============
const ALIAS = mk('alias.xlsx', {
  '出库记录': [['某厂出库导出'], [],
    ['日期', '物料编码', '物料名称', '出库数量', '计量单位', '领用设备'],
    ['2026-08-01', 'X-01', '机封', 1, '套', 'P-01'],
    ['合计', '', '', 1, '', '']],
});
r = run(['--input', ALIAS, ...BASE], 'alias');
eq(r.s.ok, true, 'I1 别名列头可读');
eq(r.s.counts.records, 1, 'I2 合计行被跳过');
ok(r.j.warnings.some((w) => w.includes('合计行')), 'I3 合计行 warning');

// ============ J. 产出完整性 ============
r = run(['--input', OUT, ...BASE, '--price', PRICE, '--ledger', LED], 'outputs');
ok(fs.existsSync(path.join(r.out, 'consumption.json')), 'J1 consumption.json 生成');
ok(fs.existsSync(path.join(r.out, 'consumption.md')), 'J2 consumption.md 生成');
ok(fs.existsSync(path.join(r.out, 'summary.json')), 'J3 summary.json 生成');
ok(fs.existsSync(path.join(r.out, '消耗统计表.xlsx')), 'J4 消耗统计表.xlsx 生成');
const xb = readXlsx(path.join(r.out, '消耗统计表.xlsx'));
ok(xb['按设备'] && xb['按备件'] && xb['按月份'] && xb['未归属'], 'J5 xlsx 含四张表');
ok(xb['未归属'].length >= 2, 'J6 未归属表含数据');

// ============ U. 两期单位不同：单列 unitMismatch，不算本期新出现（2026-11-04 复核补充） ============
const UNIT2 = mk('unit2.xlsx', {
  '出库记录': [['出库日期', '备件编码', '备件名称', '数量', '单位', '位号'],
    ['2026-04-10', 'U-01', '垫片', 10, '片', 'E-01'],      // 基期按「片」
    ['2026-04-12', 'U-02', '螺栓', 0, '个', 'E-01'],       // 基期有编码但数量为 0
    ['2026-07-10', 'U-01', '垫片', 2, '包', 'E-01'],       // 本期按「包」
    ['2026-07-12', 'U-02', '螺栓', 8, '个', 'E-01'],
    ['2026-07-15', 'U-03', '填料', 3, '盘', 'P-01'],       // 基期完全没有
    ['2026-07-16', 'A-01', '机械密封', 1, '套', 'P-01'],
    ['2026-04-16', 'A-01', '机械密封', 1, '套', 'P-01']],
});
r = run(['--input', UNIT2, ...BASE, '--prev-from', '2026-04-01', '--prev-to', '2026-06-30'], 'unit2');
eq(((r.j && r.j.newInPeriod) || []).map((x) => x.code).sort().join(','), 'U-02,U-03', 'U1 基期没有该编码、或该编码基期全部单位数量为 0 才算本期新出现');
ok(!((r.j && r.j.newInPeriod) || []).some((x) => x.code === 'U-01'), 'U2 基期有消耗只是单位不同的不列为新出现');
{
  const um = ((r.j && r.j.unitMismatch) || []).find((x) => x.code === 'U-01');
  ok(um && um.unit === '包' && um.current === 2 && /片/.test(JSON.stringify(um.prevUnits || [])), 'U3 单位不同单列 unitMismatch，带本期单位与基期单位');
  ok(um && /两期单位不同、不可比/.test(um.note), 'U4 unitMismatch 写明两期单位不同、不可比');
}
eq(r.s.counts.unitMismatch, 1, 'U5 counts.unitMismatch 计数');
ok(/两期单位不同、不可比/.test(r.md || ''), 'U6 md 异常节列出两期单位不同项');
ok(!r.j.anomalies.some((x) => x.code === 'U-01'), 'U7 单位不同项不计入异常增长');
r = run(['--input', OUT, ...BASE], 'unit-noprev');
eq(r.s.counts.unitMismatch, null, 'U8 未提供基期时 unitMismatch 为 null 不是 0');

console.log(`\n${'='.repeat(56)}`);
console.log(`spare-parts-consumption-analysis 自测：${pass} 通过，${fail} 失败`);
if (failures.length) { console.log('\n失败项：'); failures.forEach((f) => console.log('  ✗ ' + f)); }
console.log('='.repeat(56));
try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
