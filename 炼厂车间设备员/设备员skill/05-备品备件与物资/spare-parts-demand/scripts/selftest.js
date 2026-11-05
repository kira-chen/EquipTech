#!/usr/bin/env node
'use strict';
/** 自测：断言 demand.js 行为。用法：node scripts/selftest.js */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { writeXlsx, readXlsx } = require('./lib/xlsx-lite');
const C = require('./lib/common');

const DEM = path.join(__dirname, 'demand.js');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'spd-selftest-'));
let pass = 0, fail = 0;
const failures = [];
const ok = (c, n) => { if (c) pass++; else { fail++; failures.push(n); } };
const eq = (a, e, n) => ok(a === e, `${n}（期望 ${JSON.stringify(e)}，实际 ${JSON.stringify(a)}）`);

const BASE = ['--workshop', '炼油一车间', '--period', '2026-Q4'];
function run(args, tag) {
  const out = path.join(work, tag + '-out');
  const r = spawnSync(process.execPath, [DEM, ...args, '--out', out], { encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  let s; try { s = JSON.parse(lines[lines.length - 1]); } catch (e) { s = { ok: false, error: 'no-json:' + r.stdout + r.stderr }; }
  let j = null, md = null;
  if (fs.existsSync(path.join(out, 'demand.json'))) j = JSON.parse(fs.readFileSync(path.join(out, 'demand.json'), 'utf8'));
  if (fs.existsSync(path.join(out, 'demand.md'))) md = fs.readFileSync(path.join(out, 'demand.md'), 'utf8');
  return { code: r.status, s, j, md, out };
}
const mk = (n, b) => { const p = path.join(work, n); writeXlsx(p, b); return p; };
const mon = (from, n) => { const [y, m] = from.split('-').map(Number); const a = []; for (let i = 0; i < n; i++) { const t = m - 1 + i; a.push(`${y + Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, '0')}`); } return a; };
const hist = (code, name, unit, from, n, q) => mon(from, n).map((m) => [code, name, 'SPEC', unit, m, q]);

// 主样例：计划 + 历史
const MAIN = mk('main.xlsx', {
  '检修计划': [
    ['项目编号', '项目名称', '计划开工', '备件编码', '备件名称', '规格型号', '单位', '需求数量'],
    ['JX-001', 'P-01 泵检修', '2026-10-12', 'A-01', '机械密封', '104-45', '套', 2],
    ['JX-002', 'E-01 抽芯', '2026-11-03', 'B-01', '缠绕垫片', 'DN800', '片', 10],
    ['', '临时增项', '2026-11-20', 'C-01', '球阀', 'DN100', '台', 1],        // 缺项目编号
    ['JX-003', 'M-01 大修', '2026-12-08', 'D-01', '电机', 'Y2-315', '台', ''], // 数量为空
  ],
  '历史消耗': [
    ['备件编码', '备件名称', '规格型号', '单位', '消耗月份', '消耗数量'],
    ...hist('A-01', '机械密封', '套', '2025-10', 12, 3),   // 满 12 期
    ...hist('E-01', '联轴器膜片', '组', '2026-07', 3, 2),  // 仅 3 期 → lowConfidence
    ...hist('F-01', '轴承', '个', '2026-01', 12, 2),       // 单位「个」
    ...hist('F-01', '轴承', '套', '2026-01', 8, 1),        // 同编码单位「套」→ 单位不一致
  ],
});
const STOCK = mk('stock.xlsx', {
  '库存表': [
    ['备件编码', '备件名称', '规格型号', '单位', '库存量', '安全库存', '库位'],
    ['A-01', '机械密封', '104-45', '套', 4, 2, 'A-1'],
    ['B-01', '缠绕垫片', 'DN800', '片', 100, 8, 'C-1'],   // 库存充足 → 净需求 0
    ['G-01', '叶轮', 'ZA-100', '个', '', 1, 'E-1'],
  ],
});
const TRANSIT = mk('transit.xlsx', {
  '在途采购': [['备件编码', '备件名称', '到货数量', '单位', '预计到货'],
    ['A-01', '机械密封', 3, '套', '2026-10-08']],
});
const SAFETY = mk('safety.xlsx', {
  '安全库存': [['备件编码', '备件名称', '单位', '安全库存'], ['A-01', '机械密封', '套', 2]],
});

// ============ A. 正常路径（both） ============
let r = run(['--input', MAIN, ...BASE, '--stock', STOCK, '--intransit', TRANSIT, '--safety', SAFETY], 'main');
eq(r.s.ok, true, 'A1 正常路径成功');
eq(r.code, 0, 'A2 退出码 0');
eq(r.s.method, 'both', 'A3 默认口径为 both');
eq(r.s.months, 3, 'A4 2026-Q4 解析为 3 个月');
eq(r.j.meta.workshop, '炼油一车间', 'A5 车间写入 meta');
eq(r.s.counts.itemsFromPlan, 2, 'A6 计划驱动 2 项（另 2 行无依据）');
eq(r.s.counts.itemsFromHistory, 3, 'A7 历史驱动 3 项（E-01 期数不足不计）');
ok(/本清单为车间申报稿，采购数量与定额以物资部门审定为准/.test(r.md), 'A8 md 保留申报说明行');
ok(r.j.meta.statement.includes('以物资部门审定为准'), 'A9 meta 含说明行');
ok(/<!-- ANALYSIS_START -->/.test(r.md) && /<!-- ANALYSIS_END -->/.test(r.md), 'A10 分析段占位符存在');

// 推算式：月均 3 × 3 个月 + 安全库存 2 = 11
const a01h = r.j.items.find((x) => x.code === 'A-01' && x.source === '历史消耗') || {};
eq(a01h.monthlyAvg, 3, 'A11 月均消耗计算正确');
eq(a01h.grossQty, 11, 'A12 毛需求 = 月均×月数+安全库存');
eq(a01h.periodsUsed, 12, 'A13 采用期数正确');

// ============ B. 期数不足单列（核心硬约束 1） ============
eq(r.s.counts.lowConfidence, 1, 'B1 期数不足项单列');
const lc0 = r.j.lowConfidence[0] || {};
eq(lc0.code, 'E-01', 'B2 低置信度项识别正确');
eq(lc0.periodsUsed, 3, 'B3 期数记录为 3');
ok(/少于 6 期/.test(lc0.reason || ''), 'B4 原因写明少于 6 期');
ok(/未按不足的数据外推/.test(lc0.note || ''), 'B5 说明未按不足数据外推');
ok(!r.j.items.some((x) => x.code === 'E-01'), 'B6 低置信度项不进正式清单');
ok(!r.j.netDemand.some((x) => x.code === 'E-01'), 'B7 低置信度项不进净需求');
ok(r.j.warnings.some((w) => w.includes('置信度低')), 'B8 warning 提示置信度低');
ok(/## 四、低置信度项/.test(r.md), 'B9 md 单列低置信度节');

// 刚好 6 期 → 进正式清单（边界）
const SIX = mk('six.xlsx', { '历史消耗': [['备件编码', '备件名称', '规格型号', '单位', '消耗月份', '消耗数量'], ...hist('S-01', '轴承', '套', '2026-04', 6, 2)] });
let r6 = run(['--input', SIX, ...BASE, '--method', 'history'], 'six');
eq(r6.s.counts.lowConfidence, 0, 'B10 满 6 期不判低置信度');
eq(r6.s.counts.items, 1, 'B11 满 6 期进正式清单');
const FIVE = mk('five.xlsx', { '历史消耗': [['备件编码', '备件名称', '规格型号', '单位', '消耗月份', '消耗数量'], ...hist('S-01', '轴承', '套', '2026-05', 5, 2)] });
let r5 = run(['--input', FIVE, ...BASE, '--method', 'history'], 'five');
eq(r5.s.counts.lowConfidence, 1, 'B12 5 期判低置信度（边界）');
eq(r5.s.counts.items, 0, 'B13 5 期不进正式清单');

// ============ C. 编码不一致不合并（核心硬约束 2） ============
const AMB = mk('amb.xlsx', {
  '检修计划': [['项目编号', '计划开工', '备件编码', '备件名称', '规格型号', '单位', '需求数量'],
    ['JX-101', '2026-10-01', 'P-01', '机械密封', '104-45', '套', 2],
    ['JX-102', '2026-10-02', 'P-01B', '机械密封', '104-45', '套', 3]],
});
let ra = run(['--input', AMB, ...BASE, '--method', 'plan'], 'amb');
eq(ra.s.counts.codeAmbiguity, 1, 'C1 同名同规格多编码列入待确认');
eq(((ra.j.codeAmbiguity[0]||{}).codes||[]).length, 2, 'C2 列出两个编码');
ok(/未自动合并/.test((ra.j.codeAmbiguity[0]||{}).note || ''), 'C3 说明未自动合并');
eq(ra.s.counts.netDemand, 2, 'C4 两个编码分别成行，未合并为 1 行');
eq((ra.j.netDemand.find((x) => x.code === 'P-01') || {}).gross, 2, 'C5 P-01 毛需求未被合并放大');
eq((ra.j.netDemand.find((x) => x.code === 'P-01B') || {}).gross, 3, 'C6 P-01B 毛需求独立');
ok(ra.j.warnings.some((w) => w.includes('未自动合并')), 'C7 warning 提示未合并');
ok(/## 五、编码待确认项/.test(ra.md), 'C8 md 单列编码待确认节');
// 同编码多名称
const AMB2 = mk('amb2.xlsx', {
  '检修计划': [['项目编号', '计划开工', '备件编码', '备件名称', '规格型号', '单位', '需求数量'],
    ['JX-201', '2026-10-01', 'Q-01', '机械密封', '104-45', '套', 2]],
  '历史消耗': [['备件编码', '备件名称', '规格型号', '单位', '消耗月份', '消耗数量'],
    ...hist('Q-01', '机封组件', '套', '2025-10', 12, 1)],
});
let ra2 = run(['--input', AMB2, ...BASE], 'amb2');
ok(ra2.j.codeAmbiguity.some((x) => x.type === '同编码多名称'), 'C9 同编码多名称列入待确认');
ok(ra2.j.warnings.some((w) => w.includes('名称不一致')), 'C10 warning 提示名称不一致');

// ============ D. 未提供库存表 → 毛需求（核心硬约束 3） ============
let rg = run(['--input', MAIN, ...BASE], 'gross');
eq(rg.s.ok, true, 'D1 无库存表仍可出稿');
eq(rg.s.grossOnly, true, 'D2 标记为毛需求');
eq(rg.j.meta.demandKind, '毛需求（未扣减在库量）', 'D3 meta 注明毛需求');
ok(rg.j.netDemand.every((x) => x.net === null), 'D4 无库存表时净需求为 null 不是毛需求值');
ok(rg.j.netDemand.every((x) => x.onHand === null), 'D5 在库量为 null，未默认为 0');
ok(rg.j.netDemand.every((x) => /未扣减在库量/.test(x.netNote || '')), 'D6 每项注明未扣减在库量');
ok(rg.j.warnings.some((w) => w.includes('未扣减在库量')), 'D7 warning 提示未扣减');
ok(/未扣减在库量/.test(rg.md), 'D8 md 标注未扣减在库量');
ok(/不得直接作为采购量/.test(rg.md), 'D9 md 声明不得直接作为采购量');
ok(/毛需求汇总（未扣减在库量）/.test(rg.md), 'D10 md 第三节标题改为毛需求汇总');
eq(rg.s.counts.needPurchase, null, 'D11 无库存表时需采购项数为 null 不是 0');

// 库存量为空 → 不按 0 扣减
ok(rg.j.netDemand.every((x) => x.net !== x.gross), 'D12 毛需求未被当作净需求直接输出');
const NOQ = mk('noq.xlsx', { '检修计划': [['项目编号', '计划开工', '备件编码', '备件名称', '单位', '需求数量'], ['JX-301', '2026-10-01', 'G-01', '叶轮', '个', 5]] });
let rq = run(['--input', NOQ, ...BASE, '--method', 'plan', '--stock', STOCK], 'nullqty');
eq((rq.j.netDemand[0]||{}).onHand, null, 'D13 库存量为空 → onHand 为 null');
eq((rq.j.netDemand[0]||{}).net, null, 'D14 库存量为空 → 净需求 null，未按库存 0 算');
ok(/未按库存为 0 处理/.test((rq.j.netDemand[0]||{}).netNote || ''), 'D15 说明未按库存 0 处理');

// ============ E. 每项需求必须注明依据（硬约束 4） ============
ok(r.j.items.every((x) => x.basis && x.basis.length > 0), 'E1 正式清单每项均有依据');
ok(r.j.items.filter((x) => x.source === '检修计划').every((x) => /检修项目 JX-/.test(x.basis)), 'E2 计划项依据含项目编号');
ok(r.j.items.filter((x) => x.source === '历史消耗').every((x) => /历史消耗 \d+ 期/.test(x.basis)), 'E3 历史项依据含期数');
eq(r.s.counts.noHistory, 2, 'E4 无依据项 2 条');
ok(r.j.noHistory.some((x) => x.code === 'C-01' && x.reason.includes('缺项目编号')), 'E5 缺项目编号列入无依据');
ok(r.j.noHistory.some((x) => x.code === 'D-01' && x.reason.includes('需求数量为空')), 'E6 数量为空列入无依据');
ok(!r.j.items.some((x) => x.code === 'C-01' || x.code === 'D-01'), 'E7 无依据项不进正式清单');
ok(!r.j.netDemand.some((x) => x.code === 'C-01' || x.code === 'D-01'), 'E8 无依据项不进净需求');
ok(/## 六、无依据项/.test(r.md), 'E9 md 单列无依据节');
eq((r.j.noHistory.find((x) => x.code === 'D-01') || {}).qty, null, 'E10 数量为空记为 null 不是 0');

// ============ F. 单位不一致分别统计（硬约束 5） ============
eq(r.s.counts.unitConflicts, 1, 'F1 单位不一致识别');
eq((r.j.unitConflicts[0]||{}).code, 'F-01', 'F2 单位冲突编码正确');
eq(((r.j.unitConflicts[0]||{}).units||[]).length, 2, 'F3 两种单位均列出');
ok(/未做任何换算/.test((r.j.unitConflicts[0]||{}).note || ''), 'F4 说明未换算');
ok(r.j.warnings.some((w) => w.includes('未强行换算')), 'F5 warning 提示未强行换算');
eq(r.j.netDemand.filter((x) => x.code === 'F-01').length, 2, 'F6 按单位分成两行统计');
ok(/未做任何换算/.test(r.md), 'F7 md 声明未换算');
// 需求单位与库存单位不一致 → 不扣减
const UM = mk('um.xlsx', { '检修计划': [['项目编号', '计划开工', '备件编码', '备件名称', '单位', '需求数量'], ['JX-401', '2026-10-01', 'A-01', '机械密封', '个', 5]] });
let ru = run(['--input', UM, ...BASE, '--method', 'plan', '--stock', STOCK], 'unitmis');
eq((ru.j.netDemand[0]||{}).net, null, 'F8 需求与库存单位不一致时不扣减');
ok(/未做换算/.test((ru.j.netDemand[0]||{}).netNote || ''), 'F9 说明未做换算');

// ============ G. 净需求公式与负值置 0（硬约束 6） ============
// A-01：计划 2 + 历史 11 = 13 毛需求；在库 4、在途 3 → 6
const a01 = r.j.netDemand.find((x) => x.code === 'A-01') || {};
eq(a01.gross, 13, 'G1 毛需求为计划与历史之和');
eq(a01.onHand, 4, 'G2 在库量读取正确');
eq(a01.inTransit, 3, 'G3 在途量读取正确');
eq(a01.net, 6, 'G4 净需求 = 毛 − 在库 − 在途');
ok(/− 在库/.test(a01.formula || ''), 'G5 净需求带公式');
// B-01：毛 10、在库 100 → 置 0
const b01 = r.j.netDemand.find((x) => x.code === 'B-01') || {};
eq(b01.net, 0, 'G6 负净需求置 0');
eq(b01.sufficient, true, 'G7 标记库存充足');
eq(b01.netNote, '库存充足，本期无需采购', 'G8 注明库存充足无需采购');
ok(/库存充足，本期无需采购/.test(r.md), 'G9 md 写明库存充足');
eq(r.s.counts.sufficient, 1, 'G10 库存充足项计数');
// 库存表中无此编码 → warning
ok(r.j.warnings.some((w) => w.includes('漏登')), 'G11 库存表无记录时 warning 提示核实漏登');

// ============ H. --method 三态 ============
let rp = run(['--input', MAIN, ...BASE, '--method', 'plan'], 'plan');
eq(rp.s.counts.itemsFromHistory, 0, 'H1 plan 口径不含历史项');
eq(rp.s.counts.itemsFromPlan, 2, 'H2 plan 口径计划项正确');
eq(rp.s.counts.lowConfidence, 0, 'H3 plan 口径无低置信度项');
let rh = run(['--input', MAIN, ...BASE, '--method', 'history'], 'hist');
eq(rh.s.counts.itemsFromPlan, 0, 'H4 history 口径不含计划项');
eq(rh.s.counts.itemsFromHistory, 3, 'H5 history 口径历史项正确');
ok(/仅按检修计划/.test(rp.md), 'H6 md 写明 plan 口径');
ok(/仅按历史消耗/.test(rh.md), 'H7 md 写明 history 口径');

// ============ I. 缺表缺列不中断 ============
const PLANONLY = mk('planonly.xlsx', {
  '检修计划': [['项目编号', '计划开工', '备件编码', '备件名称', '单位', '需求数量'], ['JX-501', '2026-10-01', 'Z-01', '轴承', '套', 2]],
});
let ri = run(['--input', PLANONLY, ...BASE], 'planonly');
eq(ri.s.ok, true, 'I1 缺历史消耗表不中断（both 口径）');
ok(ri.j.warnings.some((w) => w.includes('未找到「历史消耗」')), 'I2 缺历史表 warning');
eq(ri.s.counts.items, 1, 'I3 仅计划项产出');
// 缺可选文件的工作表
const BADSTOCK = mk('badstock.xlsx', { '别的表': [['a'], [1]] });
let rb = run(['--input', PLANONLY, ...BASE, '--stock', BADSTOCK], 'badstock');
eq(rb.s.ok, true, 'I4 库存文件无库存表不中断');
eq(rb.s.grossOnly, true, 'I5 库存表不可用时退回毛需求');
ok(rb.j.warnings.some((w) => w.includes('未扣减在库量')), 'I6 提示未扣减在库量');
// 缺必需列
const NOCODE = mk('nocode.xlsx', { '检修计划': [['项目编号', '计划开工', '备件名称', '单位', '需求数量'], ['JX-601', '2026-10-01', '轴承', '套', 2]] });
let rn = run(['--input', NOCODE, ...BASE, '--method', 'plan'], 'nocode');
ok(rn.j && rn.j.warnings.some((w) => w.includes('缺少列')), 'I7 缺备件编码列 warning');
eq(rn.s.counts.items, 0, 'I8 缺编码的行不进清单');

// ============ J. 数值无法解析 → null 不是 0 ============
const BADNUM = mk('badnum.xlsx', {
  '历史消耗': [['备件编码', '备件名称', '规格型号', '单位', '消耗月份', '消耗数量'],
    ...mon('2025-10', 12).map((m, i) => ['N-01', '轴承', 'SPEC', '套', m, i === 0 ? '约莫三个' : 2])],
});
let rj = run(['--input', BADNUM, ...BASE, '--method', 'history'], 'badnum');
ok(rj.j.warnings.some((w) => w.includes('无法解析')), 'J1 无法解析的数量 warning');
ok(rj.j.warnings.some((w) => w.includes('未按 0 计')), 'J2 明确未按 0 计');
eq((rj.j.items[0]||{}).periodsUsed, 11, 'J3 无法解析的期不计入期数（不按 0 摊薄）');
eq((rj.j.items[0]||{}).monthlyAvg, 2, 'J4 月均由有效期计算');

// ============ K. 参数校验 ============
function raw(args) {
  const x = spawnSync(process.execPath, [DEM, ...args], { encoding: 'utf8' });
  const l = x.stdout.trim().split('\n');
  try { return { code: x.status, s: JSON.parse(l[l.length - 1]) }; } catch (e) { return { code: x.status, s: { ok: false } }; }
}
eq(raw([]).s.ok, false, 'K1 无参数报错');
eq(raw([]).code, 1, 'K2 出错退出码 1');
eq(raw(['--input']).s.ok, false, 'K3 --input 缺值报错');
ok(/缺少取值/.test(raw(['--input']).s.error), 'K4 缺值信息正确');
eq(raw(['--input', MAIN]).s.ok, false, 'K5 缺 --workshop 报错');
eq(raw(['--input', MAIN, '--workshop', '一车间']).s.ok, false, 'K6 缺 --period 报错');
eq(raw(['--input', '/不存在.xlsx', ...BASE]).s.ok, false, 'K7 输入不存在报错');
eq(raw(['--input', MAIN, ...BASE, '--method', 'xxx']).s.ok, false, 'K8 非法 method 报错');
eq(raw(['--input', MAIN, ...BASE, '--lookback', 'abc']).s.ok, false, 'K9 非法 lookback 报错');
eq(raw(['--input', MAIN, ...BASE, '--months', '-1']).s.ok, false, 'K10 非法 months 报错');
eq(raw(['--input', MAIN, ...BASE, '--未知', 'x']).s.ok, false, 'K11 未知参数报错');
eq(raw(['--input', MAIN, ...BASE, '--stock', '/不存在.xlsx']).s.ok, false, 'K12 库存表不存在报错');
eq(raw(['--input', MAIN, ...BASE, '--intransit', '/不存在.xlsx']).s.ok, false, 'K13 在途表不存在报错');
eq(raw(['--input', MAIN, ...BASE, '--safety', '/不存在.xlsx']).s.ok, false, 'K14 安全库存表不存在报错');
eq(raw(['--input', mk('none.xlsx', { '别的': [['a'], [1]] }), ...BASE]).s.ok, false, 'K15 既无计划也无历史表报错');
eq(raw(['--input', PLANONLY, ...BASE, '--method', 'history']).s.ok, false, 'K16 指定 history 但无历史表报错');
eq(raw(['--input', BADNUM, ...BASE, '--method', 'plan']).s.ok, false, 'K17 指定 plan 但无计划表报错');

// ============ L. 周期解析 ============
eq(run(['--input', PLANONLY, '--workshop', 'X', '--period', '2026-10'], 'p1').s.months, 1, 'L1 2026-10 → 1 个月');
eq(run(['--input', PLANONLY, '--workshop', 'X', '--period', '2026-Q4'], 'p2').s.months, 3, 'L2 2026-Q4 → 3 个月');
eq(run(['--input', PLANONLY, '--workshop', 'X', '--period', '2026-10~2026-12'], 'p3').s.months, 3, 'L3 区间 → 3 个月');
eq(run(['--input', PLANONLY, '--workshop', 'X', '--period', '2026'], 'p4').s.months, 12, 'L4 年度 → 12 个月');
let rp5 = run(['--input', PLANONLY, '--workshop', 'X', '--period', '下个月'], 'p5');
eq(rp5.s.months, 1, 'L5 无法识别的周期按 1 个月');
ok(rp5.j.warnings.some((w) => w.includes('无法识别月数')), 'L6 无法识别周期时 warning');
eq(run(['--input', PLANONLY, '--workshop', 'X', '--period', '下个月', '--months', '6'], 'p6').s.months, 6, 'L7 --months 覆盖周期解析');

// ============ M. 别名列头、标题行、合计行 ============
const ALIAS = mk('alias.xlsx', {
  '检修计划': [['某装置 2026 年四季度检修计划'], [],
    ['计划编号', '检修内容', '开工日期', '物料编码', '物料名称', '型号', '计量单位', '计划用量'],
    ['JX-701', 'P-02 泵检修', '2026-10-05', 'W-01', '机械密封', '104-45', '套', 3],
    ['合计', '', '', '', '', '', '', 3]],
});
let rm = run(['--input', ALIAS, ...BASE, '--method', 'plan'], 'alias');
eq(rm.s.ok, true, 'M1 别名列头可读');
eq(rm.s.counts.items, 1, 'M2 合计行被跳过');
ok(rm.j.warnings.some((w) => w.includes('合计行')), 'M3 合计行 warning');
eq((rm.j.items[0]||{}).grossQty, 3, 'M4 别名列值读取正确');
eq((rm.j.items[0]||{}).project, 'JX-701', 'M5 标题行下方表头正确识别');

// ============ N. 多输入文件 ============
const H2 = mk('h2.xlsx', { '历史消耗': [['备件编码', '备件名称', '规格型号', '单位', '消耗月份', '消耗数量'], ...hist('Z-02', '轴承', '套', '2025-10', 12, 2)] });
let rmm = run(['--input', `${PLANONLY},${H2}`, ...BASE], 'multi');
eq(rmm.s.ok, true, 'N1 多输入文件可读');
eq(rmm.s.counts.itemsFromPlan, 1, 'N2 计划表来自文件一');
eq(rmm.s.counts.itemsFromHistory, 1, 'N3 历史表来自文件二');
eq(rmm.j.meta.sources.length, 2, 'N4 meta 记录两个来源');

// ============ P. 中石化口径：SAP PM/MM 列名、多文件合并、毛需求分列、--lead-days / --min-periods ============
const SAPPLAN = mk('sapplan.xlsx', {
  '预留': [['PM 工单组件预留清单'],
    ['订单号', '订单描述', '基本开始日期', '功能位置', '物料', '物料描述', '基本计量单位', '预留数量'],
    ['000401123456', 'P-01 泵检修', '2026-10-12', 'P-01', '30012345', '机械密封 104-45', 'ST', 2],
    ['合计', '', '', '', '', '', '', '']],
});
const SAPMB51 = mk('sapmb51.xlsx', {
  '物料凭证': [['物料', '物料描述', '基本计量单位', '过账日期', '数量', '移动类型'],
    ...mon('2025-10', 12).map((m) => ['30012345', '机械密封 104-45', 'ST', `${m}-15`, 3, '261']),
    ['30012345', '机械密封 104-45', 'ST', '2026-03-16', 1, '262'],   // 冲销 → 当月 3-1=2
    ['30012345', '机械密封 104-45', 'ST', '2026-05-02', 20, '101'],  // 收货 → 不计
  ],
});
let rs = run(['--input', `${SAPPLAN},${SAPMB51}`, ...BASE], 'sap');
eq(rs.s.ok, true, 'P1 SAP 预留 + MB51 两文件可读');
eq(rs.s.counts.itemsFromPlan, 1, 'P2 「订单号/物料/预留数量」命中检修计划');
const sp = rs.j.items.find((x) => x.source === '检修计划') || {};
eq(sp.project, '000401123456', 'P3 订单号作项目编号');
ok(/P-01 泵检修/.test(sp.basis), 'P4 订单描述进依据');
eq(sp.planStart, '2026-10-12', 'P5 基本开始日期作计划开工');
eq(sp.unit, 'ST', 'P6 基本计量单位命中');
eq(sp.tag, 'P-01', 'P7 功能位置作位号');
eq(rs.s.counts.itemsFromHistory, 1, 'P8 MB51「过账日期/数量/移动类型」命中历史消耗');
const sh = rs.j.items.find((x) => x.source === '历史消耗') || {};
eq(sh.periodsUsed, 12, 'P9 过账日期按月归并为 12 期');
eq(sh.monthlyAvg, C.round((3 * 12 - 1) / 12, 2), 'P10 262 冲销按负数抵减（35/12）');
ok(rs.j.warnings.some((w) => /冲销/.test(w) && /负数抵减/.test(w)), 'P11 冲销 warning');
ok(rs.j.warnings.some((w) => /非发料\/非冲销移动类型/.test(w)), 'P12 101 收货不计入并 warning');
eq(rs.j.meta.mergedSources.plan[0], 'sapplan.xlsx', 'P13 meta 记录检修计划来源文件');
// 毛需求分列
const nd = rs.j.netDemand.find((x) => x.code === '30012345') || {};
eq(nd.grossPlan, 2, 'P14 计划毛需求分列');
ok(nd.grossHistory > 0 && nd.gross === C.round(nd.grossPlan + nd.grossHistory, 2), 'P15 历史毛需求分列且合计一致');
ok(/计划毛需求 \| 历史毛需求 \| 毛需求合计/.test(rs.md), 'P16 md 净需求表分列');
// 多文件同名表合并 + warning
const H3 = mk('h3.xlsx', { '历史消耗': [['备件编码', '备件名称', '规格型号', '单位', '消耗月份', '消耗数量'], ...hist('A-01', '机械密封', '套', '2025-10', 12, 1)] });
let rmg = run(['--input', `${MAIN},${H3}`, ...BASE, '--method', 'history'], 'merge');
ok(rmg.j.warnings.some((w) => /2 个输入文件均含「历史消耗」/.test(w) && /已合并读取/.test(w)), 'P17 两文件同名表合并并 warning');
eq((rmg.j.items.find((x) => x.code === 'A-01') || {}).monthlyAvg, 4, 'P18 合并后同编码同月数量累加（3+1）');
eq(rmg.j.meta.mergedSources.history.length, 2, 'P19 meta 记录两个历史消耗来源');
ok(/已合并读取：检修计划来自/.test(rmg.md), 'P20 md 口径说明写明合并来源');
let rmg1 = run(['--input', MAIN, ...BASE, '--method', 'history'], 'nomerge');
ok(!rmg1.j.warnings.some((w) => /已合并读取/.test(w)), 'P21 单文件不出合并 warning');
// --lead-days
let rld = run(['--input', MAIN, ...BASE, '--method', 'plan'], 'lead-default');
eq((rld.j.items.find((x) => x.code === 'A-01') || {}).suggestArrival, '2026-09-27', 'P22 默认建议到货 = 开工 − 15 天');
eq(rld.s.leadDays, 15, 'P23 摘要记录默认提前天数');
ok(/默认值，厂内采购周期不同时用 --lead-days 调整/.test(rld.md), 'P24 md 标注默认值');
rld = run(['--input', MAIN, ...BASE, '--method', 'plan', '--lead-days', '30'], 'lead-30');
eq((rld.j.items.find((x) => x.code === 'A-01') || {}).suggestArrival, '2026-09-12', 'P25 --lead-days 30 生效');
eq(rld.s.leadDays, 30, 'P26 摘要记录提前天数');
ok(!/默认值，厂内采购周期不同时用 --lead-days/.test(rld.md), 'P27 显式给定时不再标默认值');
eq(raw(['--input', MAIN, ...BASE, '--lead-days', '-3']).s.ok, false, 'P28 非法 --lead-days 报错');
// --min-periods
let rmp = run(['--input', MAIN, ...BASE, '--method', 'history', '--min-periods', '3'], 'minp-3');
eq(rmp.s.counts.lowConfidence, 0, 'P29 --min-periods 3 时 3 期不再判低置信度');
eq(rmp.s.minPeriods, 3, 'P30 摘要记录期数下限');
rmp = run(['--input', MAIN, ...BASE, '--method', 'history', '--min-periods', '12'], 'minp-12');
ok(rmp.s.counts.lowConfidence >= 2, 'P31 --min-periods 12 时 8 期的 F-01（套）也判低置信度');
ok(rmp.j.lowConfidence.some((x) => /少于 12 期/.test(x.reason)), 'P32 原因按参数写期数');
eq(raw(['--input', MAIN, ...BASE, '--min-periods', '0']).s.ok, false, 'P33 非法 --min-periods 报错');
ok(/期数下限为默认值，可用 --min-periods 调整/.test(r.md), 'P34 默认期数下限在 md 标注');
// 「数量」不作库存量别名；「设备编号」不作位号别名
const SAPSTOCK = mk('sapstock.xlsx', { '库存': [['物料', '物料描述', '基本计量单位', '非限制使用库存', '数量', '再订货点', '库存地点'], ['A-01', '机械密封', '套', 4, 99, 2, 'BJ01']] });
let rss = run(['--input', MAIN, ...BASE, '--method', 'plan', '--stock', SAPSTOCK], 'sapstock');
eq((rss.j.netDemand.find((x) => x.code === 'A-01') || {}).onHand, 4, 'P35 SAP 库存「非限制使用库存」作在库量，「数量」不作库存量');
ok(!/[\u2600-\u27BF\u{1F300}-\u{1FAFF}]/u.test(r.md), 'P36 md 不含 emoji');
const xb2 = readXlsx(path.join(rs.out, '备件需求表.xlsx'));
ok(xb2['备件需求表'][4].includes('计划毛需求') && xb2['备件需求表'][4].includes('物料编码'), 'P37 xlsx 申报表按物料编码/计划毛需求分列');

// ============ Q. MB51 物料凭证：导出窗口内无领用的月份按 0 期计（凭证表只记发生的业务，没凭证就是当月没领） ============
// 窗口 2025-10~2026-09 共 12 个月（由全表过账日期确定，含 101 收货行）；Q-01 只在 3 个月有领用、Q-02 只在 8 个月有领用
const SPARSE = mk('sparse-mb51.xlsx', {
  '物料凭证': [['物料', '物料描述', '基本计量单位', '过账日期', '数量', '移动类型'],
    ['Q-00', '收货占位', 'ST', '2025-10-03', 5, '101'],
    ...['2025-12', '2026-04', '2026-08'].map((m) => ['Q-01', '机械密封 Q', 'ST', `${m}-10`, -1, '261']),
    ...mon('2025-11', 8).map((m) => ['Q-02', '深沟球轴承 Q', 'ST', `${m}-12`, -2, '261']),
    ['Q-00', '收货占位', 'ST', '2026-09-28', 5, '101']],
});
const rqs = run(['--input', SPARSE, ...BASE], 'sparse');
const q1 = [...rqs.j.items, ...rqs.j.lowConfidence].find((x) => x.code === 'Q-01') || {};
const q2 = [...rqs.j.items, ...rqs.j.lowConfidence].find((x) => x.code === 'Q-02') || {};
eq(q1.periodsUsed, 12, 'Q1 MB51 窗口内无领用的月份计入期数（3 个月有领用 → 12 期）');
eq(q1.monthlyAvg, C.round(3 / 12, 2), 'Q2 MB51 月均按窗口月数摊（3/12），不按有领用的 3 个月摊');
ok(rqs.j.items.some((x) => x.code === 'Q-01'), 'Q3 窗口满 6 期的 MB51 物料不因领用稀疏判低置信度');
eq(q2.monthlyAvg, C.round(16 / 12, 2), 'Q4 8 个月有领用的物料月均 16/12，不是 16/8');
ok(/无领用月按 0 计/.test(q1.basis || ''), 'Q5 依据写明无领用月按 0 计');
ok(rqs.j.warnings.some((w) => /物料凭证/.test(w) && /按 0 计/.test(w)), 'Q6 warning 说明 MB51 无领用月按 0 计');
// 汇总式历史消耗表（一行一个月）不补 0：没列的月份可能是没统计，口径不变
const rsum = run(['--input', mk('sum-gap.xlsx', { '历史消耗': [['备件编码', '备件名称', '单位', '消耗月份', '消耗数量'],
  ['S-01', '轴承', '套', '2026-01', 2], ['S-01', '轴承', '套', '2026-05', 2], ['S-02', '垫片', '片', '2026-01', 1], ['S-02', '垫片', '片', '2026-09', 1]] }), ...BASE], 'sum-gap');
eq(([...rsum.j.items, ...rsum.j.lowConfidence].find((x) => x.code === 'S-01') || {}).periodsUsed, 2, 'Q7 汇总式消耗表不补 0 期（口径不变）');
// 当月未满月：MB51 最后一个月是运行当月时不计入期数和月均
const curMon = C.localDate().slice(0, 7);
const prev = (k) => { const [y, m] = curMon.split('-').map(Number); const t = y * 12 + (m - 1) - k; return `${Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, '0')}`; };
const rcur = run(['--input', mk('cur-mb51.xlsx', { '物料凭证': [['物料', '物料描述', '基本计量单位', '过账日期', '数量', '移动类型'],
  ...[6, 5, 4, 3, 2, 1].map((k) => ['R-01', '机械密封 R', 'ST', `${prev(k)}-10`, -2, '261']),
  ['R-01', '机械密封 R', 'ST', `${curMon}-01`, -6, '261']] }), ...BASE], 'cur-mon');
const rc = [...rcur.j.items, ...rcur.j.lowConfidence].find((x) => x.code === 'R-01') || {};
eq(rc.periodsUsed, 6, 'Q8 MB51 当月未满月不计入期数');
eq(rc.monthlyAvg, 2, 'Q9 当月未满月的领用不计入月均（不按整月摊）');
ok(rcur.j.warnings.some((w) => /未满月/.test(w)), 'Q10 当月未满月 warning');
// 只有当月的 MB51：当月同样不计入，按历史不足处理（ET-001：原来窗口只有一个月时没有排除当月）
const ronly = run(['--input', mk('cur-only-mb51.xlsx', { '物料凭证': [['物料', '物料描述', '基本计量单位', '过账日期', '数量', '移动类型'],
  ['R-02', '机械密封 R2', 'ST', `${curMon}-01`, -3, '261'], ['R-02', '机械密封 R2', 'ST', `${curMon}-02`, -1, '261']] }), ...BASE], 'cur-only');
const ro = [...ronly.j.items, ...ronly.j.lowConfidence].find((x) => x.code === 'R-02') || {};
ok(!ronly.j.items.some((x) => x.code === 'R-02'), 'Q10a 只有当月 MB51 数据时不进正式清单');
eq(ro.periodsUsed, 0, 'Q10b 只有当月时当月不计入期数');
eq(ro.monthlyAvg, null, 'Q10c 只有当月时不算月均');
eq(ro.grossQty, null, 'Q10d 只有当月时不给出按月均推算的需求量');
ok(ronly.j.warnings.some((w) => /只有当月/.test(w) && /补充/.test(w)), 'Q10e 只有当月时 warning 提示补充历史数据');
ok(!/0 个月/.test(ronly.md || '') && !ronly.j.warnings.some((w) => /共 0 个月/.test(w)), 'Q10f 不写出「0 个月」的导出窗口');
// 只有完整历史月（不含当月）：不出当月未满月的提示，行为不变
ok(!rqs.j.warnings.some((w) => /未满月|只有当月/.test(w)), 'Q10g 只有完整历史月时不出当月相关提示');
// 数量无法解析的月份：不按 0 计入分母，补 0 时跳过（2026-11-04 复核补充）
const rbad = run(['--input', mk('bad-mb51.xlsx', { '物料凭证': [['物料', '物料描述', '基本计量单位', '过账日期', '数量', '移动类型'],
  ...mon('2025-01', 8).map((m) => ['W-01', '机械密封 W', 'ST', `${m}-10`, m === '2025-04' ? '两件' : -2, '261'])] }), ...BASE], 'bad-mb51');
const rw = [...rbad.j.items, ...rbad.j.lowConfidence].find((x) => x.code === 'W-01') || {};
eq(rw.periodsUsed, 7, 'Q11 数量无法解析的月份不补 0、不计入期数（8 个月剔除 1 期 → 7 期）');
eq(rw.monthlyAvg, 2, 'Q12 月均按 7 期摊（14/7 = 2），不是 14/8');
ok(/数量无法解析剔除 1 期/.test(rw.basis || ''), `Q13 依据写明剔除了几期（实际 ${rw.basis}）`);
ok(!/无领用月按 0 计/.test(rw.basis || ''), 'Q14 剔除的月份不写成无领用按 0 计');
ok(rbad.j.warnings.some((w) => /消耗数量无法解析/.test(w) && /未按 0 计/.test(w)), 'Q15 数量无法解析的行 warning 仍保留');

// ============ O. 产出完整性 ============
ok(fs.existsSync(path.join(r.out, 'demand.json')), 'O1 demand.json 生成');
ok(fs.existsSync(path.join(r.out, 'demand.md')), 'O2 demand.md 生成');
ok(fs.existsSync(path.join(r.out, 'summary.json')), 'O3 summary.json 生成');
ok(fs.existsSync(path.join(r.out, '备件需求表.xlsx')), 'O4 备件需求表.xlsx 生成');
const sm = JSON.parse(fs.readFileSync(path.join(r.out, 'summary.json'), 'utf8'));
eq(sm.ok, true, 'O5 summary.json 内容为成功摘要');
eq(sm.counts.items, r.s.counts.items, 'O6 summary 计数与末行一致');
const xb = readXlsx(path.join(r.out, '备件需求表.xlsx'));
ok(xb['备件需求表'] && xb['备件需求表'].length > 5, 'O7 xlsx 含申报表');
ok(String(xb['备件需求表'][1][0]).includes('以物资部门审定为准'), 'O8 xlsx 保留说明行');
ok(!!xb['需求明细'] && !!xb['低置信度项'] && !!xb['编码待确认'] && !!xb['无依据待核实'], 'O9 xlsx 五个工作表齐全');
ok(/## 一、需求概况与口径说明/.test(r.md) && /## 二、需求明细/.test(r.md) && /## 三、净需求/.test(r.md)
  && /## 四、低置信度项/.test(r.md) && /## 五、编码待确认项/.test(r.md) && /## 六、无依据项/.test(r.md)
  && /## 七、申报说明/.test(r.md), 'O10 md 七节结构齐全');
ok(/## 附：数据提示/.test(r.md), 'O11 md 附数据提示节');

// ============ R. 计划需求按 --period 过滤（第三轮 v1-10）；建议到货日已过提示（疑点） ============
const PER = mk('period.xlsx', {
  '检修计划': [['订单号', '订单描述', '基本开始日期', '物料', '物料描述', '基本计量单位', '预留数量', '位号'],
    ['PM-01', 'P-01 换油', '2099-11-17', 'R-01', '汽轮机油', 'L', 20, 'P-01'],     // 周期内
    ['PM-02', 'P-02 换油', '2099-12-07', 'R-02', '汽轮机油', 'L', 20, 'P-02'],     // 晚于周期 → 单列不计入
    ['PM-03', 'P-03 换机封', '2099-10-20', 'R-03', '机械密封', 'ST', 1, 'P-03'],    // 早于周期、预留未领 → 仍计入并提示
    ['PM-04', 'P-04 换轴承', '', 'R-04', '轴承', 'ST', 2, 'P-04']],                 // 无基本开始日期 → 计入并提示
});
const rper = run(['--input', PER, '--workshop', 'X', '--period', '2099-11'], 'period');
const perCodes = ((rper.j && rper.j.items) || []).map((x) => x.code).sort().join(',');
eq(perCodes, 'R-01,R-03,R-04', 'R1 计划需求只计基本开始日期不晚于周期末的项（R-02 在 2099-12，不计入）');
eq((rper.s.counts || {}).itemsFromPlan, 3, 'R2 itemsFromPlan 不含周期外项');
ok(((rper.j && rper.j.planOutOfPeriod) || []).some((x) => x.code === 'R-02' && x.planStart === '2099-12-07'), 'R3 周期外项单列 planOutOfPeriod');
eq((rper.s.counts || {}).planOutOfPeriod, 1, 'R4 counts.planOutOfPeriod');
ok(!((rper.j && rper.j.netDemand) || []).some((x) => x.code === 'R-02'), 'R5 周期外项不进净需求汇总');
ok(((rper.j && rper.j.warnings) || []).some((w) => w.includes('R-02') && w.includes('需求周期')), 'R6 warning 点名周期外的计划需求');
ok(/周期外/.test(rper.md || '') && /PM-02/.test(rper.md || ''), 'R7 md 单列周期外的计划需求');
ok(((rper.j && rper.j.items) || []).some((x) => x.code === 'R-03' && x.startBeforePeriod === true), 'R8 基本开始日期早于周期、预留仍在的项计入并标记');
ok(((rper.j && rper.j.warnings) || []).some((w) => w.includes('R-03') && w.includes('早于需求周期')), 'R9 早于周期的预留 warning 提示核实');
ok(((rper.j && rper.j.warnings) || []).some((w) => w.includes('R-04') && w.includes('基本开始日期')), 'R10 无基本开始日期的计划需求 warning');
const rpq = run(['--input', PER, '--workshop', 'X', '--period', '2099-Q4'], 'period-q');
eq((rpq.s.counts || {}).itemsFromPlan, 4, 'R11 季度周期 2099-Q4 覆盖 10~12 月，四项都计入');
const rpx = run(['--input', PER, '--workshop', 'X', '--period', '下个月', '--months', '1'], 'period-x');
eq((rpx.s.counts || {}).itemsFromPlan, 4, 'R12 周期无法识别起止日期时不过滤');
ok(((rpx.j && rpx.j.warnings) || []).some((w) => w.includes('未按周期过滤')), 'R13 周期无法识别起止日期时 warning 写明未按周期过滤');
const OLD = mk('old-plan.xlsx', { '检修计划': [['项目编号', '计划开工', '备件编码', '备件名称', '单位', '需求数量'], ['JX-901', '2020-03-20', 'T-01', '轴承', '套', 2], ['JX-902', '2099-03-20', 'T-02', '轴承', '套', 2]] });
const rold = run(['--input', OLD, '--workshop', 'X', '--period', '2020-03~2099-03'], 'old-plan');
const t01 = ((rold.j && rold.j.items) || []).find((x) => x.code === 'T-01') || {};
const t02 = ((rold.j && rold.j.items) || []).find((x) => x.code === 'T-02') || {};
eq(t01.arrivalPassed, true, 'R14 建议到货日早于今天 → arrivalPassed');
eq(t02.arrivalPassed, false, 'R15 建议到货日未到 → arrivalPassed false');
ok(((rold.j && rold.j.warnings) || []).some((w) => w.includes('T-01') && w.includes('已过')), 'R16 warning 提示建议到货日已过');
ok(/已过/.test(((rold.md || '').split('## 二、需求明细')[1] || '').split('## 三')[0]), 'R17 md 需求明细标注建议到货日已过');

console.log(`\n${'='.repeat(56)}`);
console.log(`spare-parts-demand 自测：${pass} 通过，${fail} 失败`);
if (failures.length) { console.log('\n失败项：'); failures.forEach((f) => console.log('  ✗ ' + f)); }
console.log('='.repeat(56));
try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
