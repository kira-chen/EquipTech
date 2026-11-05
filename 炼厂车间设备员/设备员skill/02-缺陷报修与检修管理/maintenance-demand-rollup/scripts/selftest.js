#!/usr/bin/env node
'use strict';
/** 自测：断言 rollup.js 行为。用法：node scripts/selftest.js（全绿退出 0） */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { writeXlsx, readXlsx } = require('./lib/xlsx-lite');

const ROLLUP = path.join(__dirname, 'rollup.js');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mdr-selftest-'));
const PERIOD = '2026-10';
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

function run(args, tag) {
  const out = path.join(work, tag + '-out');
  const r = spawnSync(process.execPath, [ROLLUP, ...args, '--out', out], { encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  let s; try { s = JSON.parse(lines[lines.length - 1]); } catch (e) { s = { ok: false, error: 'no-json:' + r.stdout + r.stderr }; }
  let j = null, md = null, xlsx = null;
  if (fs.existsSync(path.join(out, 'demands.json'))) j = JSON.parse(fs.readFileSync(path.join(out, 'demands.json'), 'utf8'));
  if (fs.existsSync(path.join(out, '需求汇总.md'))) md = fs.readFileSync(path.join(out, '需求汇总.md'), 'utf8');
  if (fs.existsSync(path.join(out, '检修需求表.xlsx'))) xlsx = readXlsx(path.join(out, '检修需求表.xlsx'));
  return { code: r.status, s, j, md, xlsx, out };
}
const mk = (n, b) => { const p = path.join(work, n); writeXlsx(p, b); return p; };
const BASE = ['--workshop', '加氢车间', '--period', PERIOD];
let r;

// 三类来源齐全的标准输入
const full = mk('full.xlsx', {
  '缺陷台账': [
    ['缺陷编号', '位号', '设备名称', '缺陷描述', '等级', '状态', '发现时间', '是否需停机', '预计工期', '备件需求', '备件型号', '需求数量'],
    ['QX-001', 'P-01', '进料泵A', '机封处持续滴漏', 'I 级（紧急）', '处理中', '2026-09-03', '是', 2, '机械密封', 'JM-50A', 1],
    ['QX-002', 'E-01', '换热器', '管束封头法兰渗漏', 'III 级（一般）', '待处理', '2026-09-08', '否', 1, '缠绕垫片', 'DN300', 2],
    ['QX-003', 'V-01', '分离器', '外壁锈蚀', 'IV 级（轻微）', '已闭环', '2026-08-05', '否', 1, '', '', ''],
    ['QX-004', 'C-01', '分馏塔', '支架松动', 'III 级（一般）', '待处理', '2026-09-15', '', 1, '', '', ''],
    ['', 'P-09', '污油泵', '盘车沉重', 'III 级（一般）', '待处理', '2026-09-18', '否', 1, '', '', ''],
  ],
  '工单台账': [
    ['工单号', '位号', '设备名称', '工单内容', '状态', '计划完成', '是否需停机', '预计工期', '等级'],
    ['GD-101', 'P-01', '进料泵A', '机械密封处滴漏，更换机封', '已派工', '2026-09-30', '是', 2, 'II 级（严重）'],
    ['GD-102', 'K-01', '压缩机', '入口过滤器压差高需清洗', '处理中', '2026-10-10', '是', 3, 'II 级（严重）'],
    ['GD-088', 'E-02', '产品换热器', '抽芯清洗', '已完成', '2026-08-28', '是', 3, 'III 级（一般）'],
  ],
  '周期检修项': [
    ['周期项编号', '位号', '设备名称', '项目名称', '检修周期', '上次检修', '是否需停机', '预计工期'],
    ['ZQ-001', 'P-02', '进料泵B', '泵体解体检查', '6个月', '2026-04-20', '是', 3],
    ['ZQ-002', 'V-02', '缓冲罐', '安全阀校验', '1年', '2025-10-25', '否', 1],
  ],
});

// ============ A. 多源合并 ============
section('BVT', () => {
  r = run(['--input', full, ...BASE], 'multi');
  eq(r.s.ok, true, 'A1 多源合并成功');
  eq(r.j.counts.bySource['未闭环缺陷'], 3, 'A2 未闭环缺陷 3 条（已闭环与无编号已排除）');
  eq(r.j.counts.bySource['未闭环工单'], 2, 'A3 未闭环工单 2 条（已完成已排除）');
  eq(r.j.counts.bySource['周期性检修项'], 0, 'A4 未加 --include-cyclic 时周期项不纳入');
  eq(r.j.counts.demands, 5, 'A5 正式清单 5 条');
  ok(r.j.warnings.some((w) => w.includes('周期检修项') && w.includes('--include-cyclic')), 'A6 存在周期表但未启用时 warning');
  ok(!r.j.demands.some((d) => d.basisNo === 'QX-003'), 'A7 已闭环缺陷不纳入');
  ok(!r.j.demands.some((d) => d.basisNo === 'GD-088'), 'A8 已完成工单不纳入');
  eq(r.j.meta.sources.length, 2, 'A9 识别到 2 类来源');
});

// --include-cyclic 后周期项纳入
section('B', () => {
  r = run(['--input', full, ...BASE, '--include-cyclic'], 'cyclic');
  eq(r.j.counts.bySource['周期性检修项'], 2, 'A10 --include-cyclic 后周期项 2 条');
  eq(r.j.counts.demands, 7, 'A11 含周期项后正式清单 7 条');
  const zq = r.j.demands.find((d) => d.basisNo === 'ZQ-001');
  ok(/周期 180 天/.test(zq.reason) && /上次检修 2026-04-20/.test(zq.reason), 'A12 周期项申报理由含周期与上次检修');
  ok(/应于 2026-10-17 前完成/.test(zq.reason), 'A13 周期项按周期算出应完成日期');
});

// ============ B. 疑似重复不自动合并 ============
section('A', () => {
  r = run(['--input', full, ...BASE], 'dup');
  eq(r.j.counts.possibleDuplicate, 1, 'B1 检出 1 组疑似重复');
  eq(r.j.possibleDuplicate[0].tag, 'P-01', 'B2 疑似重复位号为 P-01');
  ok(r.j.possibleDuplicate[0].score >= 0.45, 'B3 相似度达阈值');
  // 关键：跨来源（缺陷 vs 工单）的重复必须能检出
  const pair = r.j.possibleDuplicate[0].items.map((x) => x.source);
  ok(pair.includes('未闭环缺陷') && pair.includes('未闭环工单'), 'B4 跨来源重复可检出');
  ok(r.j.demands.filter((d) => d.tag === 'P-01').length === 2, 'B5 疑似重复两条均保留，未自动合并');
  ok(r.j.demands.some((d) => d.basisNo === 'QX-001') && r.j.demands.some((d) => d.basisNo === 'GD-101'), 'B6 两条依据都在正式清单，未自动剔除');
  ok(/未自动合并也未自动剔除/.test(r.md), 'B7 md 写明未自动合并/剔除');
  ok(/## 五、疑似重复待确认/.test(r.md), 'B8 疑似重复单列一节');
  eq(r.j.netDemand.total, 5, 'B9 netDemand.total 为实际条数');
  eq(r.j.netDemand.netIfAllMerged, 4, 'B10 netDemand 给出合并后下界但不自动合并');
  ok(r.j.warnings.some((w) => w.includes('疑似重复') && w.includes('保留')), 'B11 疑似重复 warning');
  // 不同设备的相近描述不算重复
});
const diffTag = mk('difftag.xlsx', {
  '缺陷台账': [['缺陷编号', '位号', '缺陷描述', '状态'],
    ['QX-A', 'P-77', '机封处持续滴漏', '待处理'], ['QX-B', 'P-88', '机封处持续滴漏', '待处理']],
});
section('A', () => {
  r = run(['--input', diffTag, ...BASE], 'difftag');
  eq(r.j.counts.possibleDuplicate, 0, 'B12 不同位号的相近描述不判重复');
});

// ============ C. 备件：未提供库存表不得写「有库存」 ============
section('A', () => {
  r = run(['--input', full, ...BASE], 'nospare');
  eq(r.j.meta.spareProvided, false, 'C1 未提供备件表');
  const withSpare = r.j.demands.filter((d) => d.spareName || d.spareModel);
  ok(withSpare.length > 0, 'C2 存在有备件需求的项');
  ok(withSpare.every((d) => d.spareStatus === '未核实'), 'C3 无备件表时一律写「未核实」');
  ok(withSpare.every((d) => d.spareState === 'unverified'), 'C4 备件状态为 unverified');
  // 「有库存」只允许出现在「不得按有库存处理」这句禁令里，不得作为任何一项的到位结论
  ok(!r.md.replace(/不得按有库存处理/g, '').includes('有库存'), 'C5 md 中除禁令外绝不出现「有库存」');
  ok(!/到位（库存/.test(r.md), 'C6 md 中不出现任何到位判定');
  ok(r.j.warnings.some((w) => w.includes('未提供备件库存表') && w.includes('未核实')), 'C7 未提供备件表 warning');
  ok(/不得按有库存处理/.test(r.md), 'C8 md 明示不得按有库存处理');
  eq(r.j.counts.spareUnverified, withSpare.length, 'C9 未核实计数正确');

});
const spare = mk('spare.xlsx', {
  '备件库存': [['备件名称', '备件型号', '库存数量'],
    ['机械密封', 'JM-50A', 2],       // 需 1 → 到位
    ['缠绕垫片', 'DN300', 1]],       // 需 2 → 不足
});
// 提供备件表：到位 / 不足 / 查不到→未核实
section('B', () => {
  r = run(['--input', full, ...BASE, '--spare', spare], 'spare');
  eq(r.j.demands.find((d) => d.basisNo === 'QX-001').spareState, 'ok', 'C10 库存充足判为到位');
  eq(r.j.demands.find((d) => d.basisNo === 'QX-002').spareState, 'short', 'C11 库存不足判为不足');
  ok(/不足（库存 1 \/ 需 2）/.test(r.md), 'C12 不足项标出库存与需求量');
  eq(r.j.counts.spareUnverified, 0, 'C13 有表且型号齐全时无未核实项');
});
const spare2 = mk('spare2.xlsx', { '备件库存': [['备件名称', '备件型号', '库存数量'], ['别的备件', 'XX-1', 99]] });
// 备件表中查不到的型号 → 未核实，不按有库存
section('A', () => {
  r = run(['--input', full, ...BASE, '--spare', spare2], 'spare2');
  ok(r.j.demands.find((d) => d.basisNo === 'QX-001').spareStatus === '未核实', 'C14 型号不在库存表→未核实');
  ok(r.j.warnings.some((w) => w.includes('不在备件库存表中')), 'C15 型号查不到 warning');
});
const spare3 = mk('spare3.xlsx', { '备件库存': [['备件名称', '备件型号', '库存数量'], ['机械密封', 'JM-80B', 5]] });
// 需求写了型号、库存表里同名备件只有别的型号 → 不能借用别的规格的库存，按未核实
section('A', () => {
  r = run(['--input', full, ...BASE, '--spare', spare3], 'spare3');
  eq(r.j.demands.find((d) => d.basisNo === 'QX-001').spareState, 'unverified', 'C15b 型号 JM-50A 不在库存表、同名备件只有 JM-80B → 未核实，不借用别的型号库存');
});
const spare4 = mk('spare4.xlsx', { '备件库存': [['备件名称', '库存数量'], ['机械密封', 5]] });
// 库存表没有型号列时才按名称匹配，并 warning 未核对型号
section('B', () => {
  r = run(['--input', full, ...BASE, '--spare', spare4], 'spare4');
  eq(r.j.demands.find((d) => d.basisNo === 'QX-001').spareState, 'ok', 'C15c 库存表无型号列时按名称匹配');
  ok(r.j.warnings.some((w) => /按名称匹配/.test(w) && /型号/.test(w)), 'C15d 按名称匹配时 warning 未核对型号');
});

// ============ D. 无依据项不进正式清单 ============
section('A', () => {
  r = run(['--input', full, ...BASE], 'nobasis');
  eq(r.j.counts.noBasis, 1, 'D1 无依据项 1 条');
  eq(r.j.noBasis[0].tag, 'P-09', 'D2 无依据项为 P-09');
  eq(r.j.noBasis[0].missing, '缺陷编号/通知单号', 'D3 注明缺失的是缺陷编号/通知单号');
  ok(!r.j.demands.some((d) => d.tag === 'P-09'), 'D4 无依据项不在正式清单中');
  ok(/## 七、建议核实区/.test(r.md), 'D5 建议核实区单列一节');
  ok(r.j.warnings.some((w) => w.includes('不进正式清单')), 'D6 无依据 warning');
  ok(r.j.demands.every((d) => d.basisNo), 'D7 正式清单每条都有依据单号');
  ok(r.j.demands.every((d) => d.basis && /第\d+行/.test(d.basis)), 'D8 每条依据可追溯到出处行号');
  ok(/出处/.test(r.md), 'D9 核实区给出出处');
});
const allNoBasis = mk('allnobasis.xlsx', {
  '缺陷台账': [['缺陷编号', '位号', '缺陷描述', '状态'], ['', 'P-1', '渗漏', '待处理'], ['', 'P-2', '异响', '待处理']],
});
// 全部无依据 → 报错
section('B', () => {
  r = run(['--input', allNoBasis, ...BASE], 'allnobasis');
  eq(r.s.ok, false, 'D10 全部无依据时报错');
  eq(r.code, 1, 'D11 退出码 1');
  ok(/无来源单号依据/.test(r.s.error), 'D12 错误信息说明原因');
});

const tpl = mk('tpl.xlsx', {
  '检修需求表': [['序号', '设备位号', '检修项目', '需求来源', '停车要求', '备件到位', '来源单号', '费用估算', '承包商意向']],
});
// ============ E. 模板列名匹配 ============
section('B', () => {
  r = run(['--input', full, ...BASE, '--template', tpl], 'tpl');
  eq(r.s.ok, true, 'E1 带模板运行成功');
  eq(r.j.template.unmatched.length, 2, 'E2 2 个列名无法匹配');
  ok(r.j.template.unmatched.includes('费用估算') && r.j.template.unmatched.includes('承包商意向'), 'E3 无法匹配的列名列出');
  ok(r.j.warnings.some((w) => w.includes('模板列名无法匹配') && w.includes('费用估算')), 'E4 模板列名不匹配 warning');
  // 易混列名必须匹配到正确字段（不能被短别名抢走）
  const colMap = Object.fromEntries(r.j.template.columns.map((c) => [c.name, c.std]));
  eq(colMap['备件到位'], '备件到位情况', 'E5「备件到位」不被「主要备件材料」的别名「备件」抢走');
  eq(colMap['来源单号'], '依据编号', 'E6「来源单号」不被「来源」抢走');
  eq(colMap['设备位号'], '功能位置', 'E7 位号别名匹配到功能位置');
  eq(colMap['停车要求'], '是否停工', 'E8 停车要求→是否停工');
});
section('C', () => {
  ok(/## 八、上报模板列名核对/.test(r.md), 'E9 模板核对单列一节');
  ok(/无法匹配（输出留空）/.test(r.md), 'E10 md 标注无法匹配的列留空');
});
section('B', () => {
  // xlsx 按模板列名输出
  ok(r.xlsx['检修需求表'][3].join('|') === ['序号', '设备位号', '检修项目', '需求来源', '停车要求', '备件到位', '来源单号', '费用估算', '承包商意向'].join('|'), 'E11 xlsx 表头按模板列名');
});
// 不带模板时按默认格式
section('A', () => {
  r = run(['--input', full, ...BASE], 'notpl');
  eq(r.j.template, null, 'E12 未提供模板时 template 为 null');
  ok(r.xlsx['检修需求表'][3].includes('备件到位情况') && r.xlsx['检修需求表'][3].includes('功能位置') && r.xlsx['检修需求表'][3].includes('检修类别'), 'E13 默认格式为月度检修计划申报表列头（功能位置/检修类别/备件到位情况）');
});

// ============ F. 需停机项单列与「未填」不默认 ============
section('A', () => {
  r = run(['--input', full, ...BASE], 'shut');
  eq(r.j.counts.needShutdown, 3, 'F1 需停机项 3 条');
  ok(r.j.needShutdown.every((x) => x.basisNo), 'F2 需停机项均带依据');
  ok(/## 三、需停机项/.test(r.md), 'F3 需停机项单列一节');
  // 「是否需停机」为空 → 未填，不按是也不按否
  eq(r.j.counts.shutdownUnknown, 1, 'F4 停机与否未填 1 条');
  eq(r.j.shutdownUnknown[0].basisNo, 'QX-004', 'F5 未填项为 QX-004');
  const c04 = r.j.demands.find((d) => d.basisNo === 'QX-004');
  eq(c04.needShutdown, null, 'F6 未填时 needShutdown 为 null 不是 false');
  eq(c04.needShutdownCn, '未填写', 'F7 显示为「未填写」');
  ok(!r.j.needShutdown.some((x) => x.basisNo === 'QX-004'), 'F8 未填项不计入需停机汇总');
  ok(/未按需停机或不需停机默认/.test(r.md), 'F9 md 明示未按两端默认');

});
// 停机窗口冲突
section('B', () => {
  r = run(['--input', full, ...BASE, '--window', '国庆检修窗口共 3 天'], 'win');
  eq(r.j.netDemand.windowConflict.conflict, true, 'F10 合计工期超窗口判冲突');
  eq(r.j.netDemand.windowConflict.windowDays, 3, 'F11 解析出窗口天数');
  ok(/与停机窗口冲突/.test(r.md), 'F12 md 标注窗口冲突');
  r = run(['--input', full, ...BASE, '--window', '窗口共 30 天'], 'win2');
  eq(r.j.netDemand.windowConflict.conflict, false, 'F13 窗口充足不判冲突');
  r = run(['--input', full, ...BASE, '--window', '视装置停工安排而定'], 'win3');
  eq(r.j.netDemand.windowConflict.conflict, null, 'F14 窗口说明无天数→不判定，不默认冲突');
  ok(r.j.warnings.some((w) => w.includes('未能解析出天数')), 'F15 窗口无法解析 warning');
});

// ============ G. 优先级排序 ============
section('A', () => {
  r = run(['--input', full, ...BASE], 'prio');
  const prios = r.j.demands.map((d) => (d.priority === null ? 9 : d.priority));
  ok(prios.every((p, i) => i === 0 || prios[i - 1] <= p), 'G1 按优先级升序排列');
  eq(r.j.demands[0].priorityCn, '紧急', 'G2 I 级缺陷排首位且优先级为紧急');
  eq(r.j.demands[0].basisNo, 'QX-001', 'G3 首条为 I 级缺陷 QX-001');
  eq(r.j.demands.map((d) => d.seq).join(','), '1,2,3,4,5', 'G4 序号按排序后连续编号');
  eq(r.j.counts.byPriority['紧急'], 1, 'G5 紧急 1 条');
  ok(r.j.demands.find((d) => d.basisNo === 'QX-002').priorityCn === '中', 'G6 III 级映射为中');
});

function raw(args) {
  const x = spawnSync(process.execPath, [ROLLUP, ...args], { encoding: 'utf8' });
  const l = x.stdout.trim().split('\n');
  try { return { code: x.status, s: JSON.parse(l[l.length - 1]) }; } catch (e) { return { code: x.status, s: { ok: false } }; }
}
const emptyBook = mk('empty.xlsx', { '别的表': [['a'], [1]] });
const allClosed = mk('allclosed.xlsx', {
  '缺陷台账': [['缺陷编号', '位号', '缺陷描述', '状态'], ['QX-1', 'P-1', '渗漏', '已闭环']],
});
// ============ H. 参数校验与空输入 ============
section('B', () => {
  eq(raw([]).s.ok, false, 'H1 无参数报错');
  eq(raw(['--input']).s.ok, false, 'H2 --input 缺值报错');
  ok(/缺少取值/.test(raw(['--input']).s.error), 'H3 缺值信息正确');
  eq(raw(['--input', full, '--workshop', 'X']).s.ok, false, 'H4 缺 --period 报错');
  eq(raw(['--input', full, ...BASE, '--未知', 'v']).s.ok, false, 'H5 未知参数报错');
  eq(raw(['--input', '/不存在.xlsx', ...BASE]).s.ok, false, 'H6 输入不存在报错');
  ok(/输入不存在/.test(raw(['--input', '/不存在.xlsx', ...BASE]).s.error), 'H7 输入不存在信息正确');
  eq(raw(['--input', full, '--workshop', 'X', '--period', '2026-13']).s.ok, false, 'H8 非法月份报错');
  eq(raw(['--input', full, '--workshop', 'X', '--period', '2026年10月']).s.ok, false, 'H9 period 格式错误报错');
  eq(raw(['--input', full, ...BASE, '--due', '下周五']).s.ok, false, 'H10 非法 --due 报错');
  eq(raw(['--input', full, ...BASE, '--spare', '/不存在.xlsx']).s.ok, false, 'H11 备件表不存在报错');
  eq(raw(['--input', full, ...BASE, '--template', '/不存在.xlsx']).s.ok, false, 'H12 模板不存在报错');
});
section('C', () => {
  // 空输入：无任一来源表
  let e1 = raw(['--input', emptyBook, ...BASE]);
  eq(e1.s.ok, false, 'H13 无任一来源工作表报错');
  ok(/未在输入中找到/.test(e1.s.error), 'H14 错误信息列出应有的表名');
  eq(e1.code, 1, 'H15 退出码 1');
  // 有来源表但全部已闭环 → 无需上报
  e1 = raw(['--input', allClosed, ...BASE]);
  eq(e1.s.ok, false, 'H16 全部已闭环时报错');
  ok(/没有任何未闭环需求项/.test(e1.s.error), 'H17 无未闭环项错误信息');
});

// ============ I. 产出完整性 ============
section('BVT', () => {
  r = run(['--input', full, ...BASE, '--include-cyclic', '--spare', spare, '--template', tpl, '--window', '共 3 天'], 'outputs');
  ok(fs.existsSync(path.join(r.out, 'demands.json')), 'I1 demands.json 生成');
  ok(fs.existsSync(path.join(r.out, '需求汇总.md')), 'I2 需求汇总.md 生成');
  ok(fs.existsSync(path.join(r.out, '检修需求表.xlsx')), 'I3 检修需求表.xlsx 生成');
  ok(fs.existsSync(path.join(r.out, 'summary.json')), 'I4 summary.json 生成');
  ok(/## 一、汇总概览/.test(r.md) && /## 二、需求明细/.test(r.md) && /## 三、需停机项/.test(r.md)
    && /## 四、备件缺口/.test(r.md) && /## 五、疑似重复待确认/.test(r.md) && /## 六、未判定项/.test(r.md) && /## 七、建议核实区/.test(r.md), 'I5 七节结构齐全（含未判定项）');
  ok(/<!-- ANALYSIS_START -->/.test(r.md) && /<!-- ANALYSIS_END -->/.test(r.md), 'I6 分析段占位符存在');
});
section('A', () => {
  // 必须保留的说明行
  const DECL = '本清单为车间申报稿，最终计划以公司设备管理部门（机动部/设备部）批复为准';
  ok(r.md.includes(DECL), 'I7 md 含必须保留的说明行');
  eq(r.j.meta.declaration, DECL, 'I8 JSON 中记录说明行');
  ok(r.xlsx['检修需求表'].some((row) => (row || []).some((c) => c === DECL)), 'I9 xlsx 中含说明行');
});
section('B', () => {
  // xlsx 多表齐全
  ok(['检修需求表', '需停机项', '备件缺口', '疑似重复待确认', '未判定项', '建议核实区'].every((n) => r.xlsx[n]), 'I10 xlsx 六张表齐全');
  // summary.json 与末行摘要一致
  const sj = JSON.parse(fs.readFileSync(path.join(r.out, 'summary.json'), 'utf8'));
  eq(sj.counts.demands, r.s.counts.demands, 'I11 summary.json 与末行摘要一致');
  eq(r.s.ok, true, 'I12 末行 ok:true');
  eq(r.code, 0, 'I13 成功退出码 0');
});
section('A', () => {
  // md 中的数字来自 JSON
  ok(r.md.includes(`| 正式清单需求条数 | ${r.j.counts.demands} |`), 'I14 md 条数引用 JSON');
  ok(r.md.includes(`| 需停机项 | ${r.j.counts.needShutdown} |`), 'I15 md 需停机数引用 JSON');
});

const badNum = mk('badnum.xlsx', {
  '缺陷台账': [['缺陷编号', '位号', '缺陷描述', '状态', '预计工期'], ['QX-N', 'P-1', '渗漏', '待处理', '待定']],
});
// ============ J. 数值解析与表头识别 ============
// 工期无法解析 → null（显示「未填」），绝不按 0
section('A', () => {
  r = run(['--input', badNum, ...BASE], 'badnum');
  eq(r.j.demands[0].durationDays, null, 'J1 工期无法解析为 null 不是 0');
  ok(r.j.warnings.some((w) => w.includes('无法解析为数字')), 'J2 数值无法解析 warning');
  ok(/未填/.test(r.md) && !/\| 0 天 \|/.test(r.md), 'J3 md 显示未填不显示 0 天');
});
const alias = mk('alias.xlsx', {
  '缺陷台账': [
    ['某厂缺陷台账导出'],
    [],
    ['缺陷号', '设备位号', '名称', '现象', '处理状态', '发现日期'],
    ['QX-A1', 'P-01', '进料泵', '机封渗漏', '待处理', '2026-09-10'],
    ['合计', '', '', '', '', ''],
  ],
});
// 别名列头 + 标题行 + 合计行
section('B', () => {
  r = run(['--input', alias, ...BASE], 'alias');
  eq(r.s.ok, true, 'J4 别名列头可读');
  eq(r.j.counts.demands, 1, 'J5 合计行被跳过');
  ok(r.j.warnings.some((w) => w.includes('合计行')), 'J6 合计行 warning');
  eq(r.j.demands[0].tag, 'P-01', 'J7 标题行下的表头正确识别');
});
const oddStatus = mk('odd.xlsx', {
  '缺陷台账': [['缺陷编号', '位号', '缺陷描述', '状态'], ['QX-S', 'P-5', '渗漏', '张工看过了']],
});
// 状态无法归类 → 按未闭环纳入并 warning，不静默丢弃
section('A', () => {
  r = run(['--input', oddStatus, ...BASE], 'oddstatus');
  eq(r.j.counts.demands, 0, 'J8 状态无法归类时不按未闭环纳入正式清单');
  eq(r.j.counts.statusUndetermined, 1, 'J8b 状态无法归类列入未判定');
  ok(r.j.undetermined.some((u) => u.kind === 'status' && u.tag === 'P-5'), 'J8c undetermined 含 status 项');
  ok(r.j.warnings.some((w) => w.includes('无法判断是否闭环') && w.includes('未按未闭环纳入')), 'J9 状态无法归类 warning 写明未按未闭环纳入');
});
const noTag = mk('notag.xlsx', {
  '缺陷台账': [['缺陷编号', '位号', '缺陷描述', '状态'], ['QX-T', '', '渗漏', '待处理'], ['QX-U', 'P-6', '异响', '待处理']],
});
// 位号为空跳过
section('B', () => {
  r = run(['--input', noTag, ...BASE], 'notag');
  eq(r.j.counts.demands, 1, 'J10 位号为空的行被跳过');
  ok(r.j.warnings.some((w) => w.includes('位号为空')), 'J11 位号为空 warning');
});

const f2 = mk('second.xlsx', {
  '工单台账': [['工单号', '位号', '设备名称', '工单内容', '状态', '是否需停机'],
    ['GD-901', 'I-01', '温度变送器', '示值偏差大需校验', '待处理', '否']],
});
// ============ K. 多文件输入与专业归属 ============
section('B', () => {
  r = run(['--input', `${full},${f2}`, ...BASE], 'multifile');
  eq(r.s.ok, true, 'K1 多文件输入成功');
  ok(r.j.demands.some((d) => d.basisNo === 'GD-901'), 'K2 第二个文件的工单已合并');
  eq(r.j.meta.sources.length, 3, 'K3 来源计为 3（含第二文件）');
  eq(r.j.demands.find((d) => d.basisNo === 'GD-901').discipline, '仪表', 'K4 未填专业时按位号/名称推断');
  eq(r.j.demands.find((d) => d.basisNo === 'QX-001').discipline, '动设备', 'K5 泵归动设备');
  eq(r.j.demands.find((d) => d.basisNo === 'QX-002').discipline, '静设备', 'K6 换热器归静设备');
});


const ordNoLevel = mk('ordnolevel.xlsx', { '工单台账': [['工单号', '位号', '工单内容', '状态'], ['GD-N1', 'P-N1', '机封更换', '待处理']] });
const qtyNull = mk('qtynull.xlsx', { '缺陷台账': [['缺陷编号', '位号', '缺陷描述', '状态', '备件需求', '备件型号', '需求数量'], ['QX-Q', 'P-Q', '机封漏', '待处理', '机械密封', 'JM-50A', '']] });
const stMix = mk('stmix.xlsx', { '工单台账': [['工单号', '位号', '工单内容', '状态', '等级'],
  ['GD-S1', 'P-S1', '机封更换', 'TECO', 'B 级'], ['GD-S2', 'P-S2', '轴承更换', 'REL', 'B 级'], ['GD-S3', 'P-S3', '法兰处理', 'CLSD', 'B 级'], ['GD-S4', 'P-S4', '清洗', '张工看过', 'B 级'], ['GD-S5', 'P-S5', '校验', '已完成', 'C 级']] });
// ============ L. 四处默认填补改未判定 ============
section('A', () => {
  r = run(['--input', full, ...BASE, '--include-cyclic', '--spare', spare], 'undet');
  const g102 = r.j.demands.find((d) => d.basisNo === 'GD-102');
  eq(g102.priority, 2, 'L1 工单有等级 II 级→高');
  r = run(['--input', ordNoLevel, ...BASE], 'ordnolevel');
  eq(r.j.demands[0].priority, null, 'L2 工单无等级→优先级 null，不按「高」默认');
  eq(r.j.demands[0].priorityCn, '未判定', 'L3 显示为未判定');
  ok(r.j.undetermined.some((u) => u.kind === 'priority' && u.basisNo === 'GD-N1' && /未按「高」默认/.test(u.reason)), 'L4 undetermined 记录工单无等级原因');
  ok(/## 六、未判定项/.test(r.md) && /【未判定】/.test(r.md), 'L5 md 未判定项单列一节并用【未判定】');
  r = run(['--input', full, ...BASE, '--include-cyclic'], 'cycprio');
  const zq1 = r.j.demands.find((d) => d.basisNo === 'ZQ-001');
  eq(zq1.priority, null, 'L6 周期项优先级 null，不按「中」默认');
  ok(/应完成日期/.test(zq1.priorityNote), 'L7 周期项说明按应完成日期安排');
  ok(r.j.demands.indexOf(zq1) > r.j.demands.findIndex((d) => d.basisNo === 'QX-002'), 'L8 未判定优先级排在有等级项之后');
  // 需求数量未填 + 有库存 → 未判定，不按 1 件
  r = run(['--input', qtyNull, ...BASE, '--spare', spare], 'qtynull');
  eq(r.j.demands[0].spareState, 'unverified', 'L9 需求数量未填→到位情况未判定（unverified）');
  ok(/未判定（库存 2，需求数量未填）/.test(r.j.demands[0].spareStatus), 'L10 到位情况写明库存与数量未填');
  ok(r.j.undetermined.some((u) => u.kind === 'spareQty'), 'L11 undetermined 含 spareQty 项');
  ok(r.j.warnings.some((w) => w.includes('未按 1 件默认')), 'L12 warning 说明未按 1 件默认');
  ok(!/到位（库存/.test(r.md), 'L13 md 不出现到位判定');
  // 状态无法判断 → 不纳入；待验收/已完成 → 本期不重复申报
  r = run(['--input', stMix, ...BASE], 'stmix');
  eq(r.j.counts.demands, 1, 'L14 只有 REL（已派工）纳入');
  eq(r.j.demands[0].basisNo, 'GD-S2', 'L15 纳入的是 REL 工单');
  eq(r.j.counts.skippedDone, 2, 'L16 TECO 与「已完成」为待验收，本期不重复申报');
  eq(r.j.counts.statusUndetermined, 1, 'L17 无法判断的状态列入未判定');
  ok(r.j.warnings.some((w) => w.includes('已完工待验收') && w.includes('不重复申报')), 'L18 待验收 warning');
  eq(r.j.demands[0].priority, 2, 'L19 B 级→高（A/B/C 口径）');
});

const hz = mk('hazard.xlsx', { '隐患台账': [['隐患编号', '位号', '设备名称', '隐患描述', '隐患等级', '整改措施', '整改期限', '状态', '责任人', '是否需停机', '预计工期'],
  ['YH-001', 'V-H1', '液化气球罐', '安全阀出口管线支架腐蚀', '重大隐患', '更换支架并防腐', '2026-10-20', '整改中', '王工', '否', 2],
  ['YH-002', 'E-H2', '换热器', '保温破损', 'B级', '恢复保温', '2026-10-30', '未整改', '李工', '否', 1],
  ['YH-003', 'P-H3', '泵', '地脚螺栓松动', '一般隐患', '紧固', '2026-10-15', '已销号', '张工', '否', 1],
  ['', 'P-H4', '泵', '护罩缺失', '一般隐患', '补装', '2026-10-15', '未整改', '张工', '否', 1],
  ['YH-005', '', '', '消防通道堆放杂物', '一般隐患', '清理', '2026-10-15', '未整改', '赵工', '否', 1]] });
// ============ M. 隐患台账来源 ============
section('B', () => {
  r = run(['--input', hz, ...BASE], 'hazard');
  eq(r.s.ok, true, 'M1 隐患台账可作为来源');
  eq(r.j.counts.bySource['隐患整改项'], 2, 'M2 未整改且有位号有编号的隐患 2 条纳入');
  ok(r.j.meta.sources.some((x) => /隐患整改项/.test(x)), 'M3 来源记为隐患整改项');
  const y1 = r.j.demands.find((d) => d.basisNo === 'YH-001');
  eq(y1.priority, 1, 'M4 重大隐患→紧急');
  eq(y1.category, '专项（隐患整改）', 'M5 检修类别为专项（隐患整改）');
  ok(/隐患 YH-001（重大隐患）未整改，整改期限 2026-10-20，责任人 王工/.test(y1.reason), 'M6 申报理由含隐患编号、等级、期限、责任人');
  eq(y1.planEnd, '2026-10-20', 'M7 整改期限作计划结束');
  const y2 = r.j.demands.find((d) => d.basisNo === 'YH-002');
  eq(y2.priority, null, 'M8 「B级」隐患为管理层级写法，不直接映射，优先级未判定');
  ok(r.j.warnings.some((w) => w.includes('YH-002') || (w.includes('E-H2') && w.includes('管理层级'))), 'M9 管理层级写法 warning');
  ok(!r.j.demands.some((d) => d.basisNo === 'YH-003'), 'M10 已销号隐患不纳入');
  eq(r.j.counts.noBasis, 1, 'M11 无隐患编号的进建议核实区');
  eq(r.j.noBasis[0].missing, '隐患编号', 'M12 缺失依据标注隐患编号');
  ok(r.j.warnings.some((w) => w.includes('非设备类隐患')), 'M13 无位号隐患跳过并说明非设备类');
  ok(/整改措施：更换支架并防腐/.test(y1.desc), 'M14 需求描述含整改措施');
});

const sapSrc = mk('sap.xlsx', {
  '通知单': [['通知单', '功能位置', '设备', '设备描述', '通知单短文本', '优先级', '系统状态', '通知日期'],
    ['10020001', 'P-SAP1', '10000001', '进料泵A', '机封泄漏', 'A 级', 'OSNO', '2026-09-20']],
  '订单': [['订单', '订单类型', '功能位置', '设备描述', '订单描述', '系统状态', '基本结束日期', '优先级'],
    ['40010001', 'PM03', 'K-SAP1', '压缩机', '入口过滤器清洗', 'REL', '2026-10-05', '1'],
    ['40010002', 'PM02', 'E-SAP2', '换热器', '管束清洗', 'CRTD', '2026-10-20', '4']],
});
// ============ N. SAP 列名与检修类别、申报表列头、口径用语 ============
section('A', () => {
  r = run(['--input', sapSrc, ...BASE], 'sapsrc');
  eq(r.s.ok, true, 'N1 SAP 通知单/订单工作表可读');
  eq(r.j.counts.demands, 3, 'N2 通知单 1 + 订单 2 纳入');
  const n1 = r.j.demands.find((d) => d.basisNo === '10020001');
  ok(n1 && n1.tag === 'P-SAP1' && n1.name === '进料泵A' && n1.desc === '机封泄漏', 'N3 功能位置→位号、设备描述→名称、短文本→描述，「设备」列不当位号');
  eq(n1.priority, 1, 'N4 A 级→紧急');
  eq(n1.category, '抢修', 'N5 A 级缺陷检修类别建议为抢修');
  const n2 = r.j.demands.find((d) => d.basisNo === '40010001');
  eq(n2.category, '抢修', 'N6 订单类型 PM03→抢修');
  eq(n2.planEnd, '2026-10-05', 'N7 基本结束日期作计划结束');
  eq(r.j.demands.find((d) => d.basisNo === '40010002').category, '计划检修', 'N8 PM02→计划检修');
  eq(r.j.demands.find((d) => d.basisNo === '40010002').priority, 4, 'N9 SAP 订单优先级 4→低（有系统优先级时不判未判定）');
  eq(n2.priority, 1, 'N9b SAP 优先级 1→紧急');
  eq(r.xlsx['检修需求表'][3].join('|'), ['序号', '车间', '功能位置', '设备名称', '检修项目名称', '检修内容', '检修类别', '来源', '依据编号', '是否停工', '计划开始', '计划结束', '工期(天)', '主要备件材料', '备件到位情况', '建议专业', '优先级', '申报理由', '备注'].join('|'), 'N10 默认列头为月度检修计划申报表口径');
  ok(r.xlsx['检修需求表'][0][0].includes('月度检修计划申报表'), 'N11 xlsx 标题为月度检修计划申报表');
});
section('B', () => {
  ok(!/机动处/.test(r.md) && !/EAM/.test(r.md) && /公司设备管理部门（机动部\/设备部）/.test(r.md), 'N12 md 不出现机动处，写公司设备管理部门（机动部/设备部）');
});
section('A', () => {
  ok(r.md.includes('本材料由脚本汇总、模型成文，仅供设备员复核参考'), 'N13 md 含通用声明行');
});
section('C', () => {
  ok(/【注意】/.test(r.md) && !/[✅⚠️❌]/.test(r.md), 'N14 md 用【注意】且不含 emoji');
  ok(/大检修（停工检修）\/ 日常维修 \/ 抢修 \/ 专项/.test(r.md), 'N15 md 注明检修分级口径');
});
section('B', () => {
  {
    const rr = spawnSync(process.execPath, [ROLLUP, '--input', full, ...BASE], { encoding: 'utf8' });
    const sj2 = JSON.parse(rr.stdout.trim().split('\n').pop());
    ok(sj2.ok && sj2.out.startsWith(os.tmpdir()) && !fs.existsSync(path.join(path.dirname(full), 'mdr-out')), 'N16 默认输出目录为 os.tmpdir()/mdr-out');
  }
});

const mcpSrc = mk('mcp.xlsx', {
  '通知单': [['通知单号', '位号', '设备名称', '描述', '缺陷等级', '优先级', '状态', '发现时间', '是否需停机', '预计工期'],
    ['10046656', 'E-1201', '柴油-原油换热器', 'E-1201 管束内漏，需抽芯试压', 'B', '2', 'NOPR', '2026-10-31 09:36', '是', '72小时'],
    ['10046668', 'V-1101', '原油电脱盐罐', 'V-1101 排凝阀关不严，还在漏', 'A', '1', 'NOPR', '2026-11-02 10:16', '否', '4小时'],
    ['10046700', 'P-2104A', '常顶回流泵', 'P-2104A 机封渗漏', 'C', '3', 'NOPR', '2026-10-20 08:00', '是', '8小时'],
    ['10046701', 'P-2106A', '侧线泵', 'P-2106A 轴承温度高', 'C', '3', 'OSNO', '2026-11-03 08:00', '否', '2天']],
  '工单': [['工单号', '通知单号', '位号', '设备编号', '设备名称', '订单描述', '工单类型', '优先级', '状态', '基本结束日期', '是否需停机', '预计工期'],
    ['20033053', '10046656', 'E-1201', '10002212', '柴油-原油换热器', 'E-1201 管束内漏，需抽芯试压', 'PM01', '', 'PCNF', '2026-11-07', '是', '72小时'],
    ['20033064', '10046668', 'V-1101', '10002275', '原油电脱盐罐', 'V-1101 排凝阀关不严，还在漏', 'PM03', '1', 'CRTD', '2026-11-03', '否', '4小时'],
    ['20033010', '10046700', 'P-2104A', '10002140', '常顶回流泵', 'P-2104A 机封渗漏', 'PM01', '3', 'TECO', '2026-10-25', '是', '8小时'],
    ['20033099', '', 'P-2105A', '10002156', '常压塔底泵', 'P-2105A 联轴器对中检查', 'PM02', '4', 'PCNF', '2026-11-30', '', '4小时']],
});
// ============ P. 设备资产管理系统（MCP）导出形态：工期以小时计、工单带通知单号 ============
section('A', () => {
  r = run(['--input', mcpSrc, ...BASE], 'mcp');
  eq(r.s.ok, true, 'P1 设备资产管理导出形态可读');
  const pE = r.j.demands.find((d) => d.basisNo === '20033053');
  eq(pE && pE.durationDays, 3, 'P2 预计工期「72小时」按 24 小时折为 3 天，不当 72 天');
  eq(r.j.demands.find((d) => d.basisNo === '20033064').durationDays, 0.17, 'P3 「4小时」折为 0.17 天');
  eq(r.j.demands.find((d) => d.basisNo === '10046701').durationDays, 2, 'P4 「2天」按天');
  ok(!r.j.demands.some((d) => d.basisNo === '10046656' || d.basisNo === '10046668'), 'P5 已转工单的通知单不再单列（工单「通知单号」明确对应）');
  eq(r.j.counts.demands, 4, 'P6 正式清单 4 条：未闭环工单 3 + 未转工单的通知单 1（TECO 工单及其通知单不重复申报）');
  eq(r.j.counts.linkedNotif, 3, 'P7 counts.linkedNotif 记 3 条已转工单的通知单（含 TECO 工单对应的 1 条）');
  eq(pE.notifNo, '10046656', 'P8 工单需求带对应通知单号');
  ok(/通知单 10046656/.test(pE.reason), 'P9 申报理由写明对应通知单');
  eq(pE.priority, 2, 'P10 工单无优先级时沿用对应通知单的缺陷等级（B→高），不判未判定');
  ok(!r.j.possibleDuplicate.some((p) => p.tag === 'E-1201' || p.tag === 'V-1101'), 'P11 通知单与其工单不再报疑似重复');
  eq(r.j.counts.needShutdown, 1, 'P12 需停机只按工单计 1 项（E-1201），不因通知单再计一次');
  ok(r.s.warnings.some((w) => /已转工单/.test(w)), 'P13 已转工单的通知单有 warning 说明');
});

// ============ W. 通知单↔工单配对的字段沿用、CLSD 工单、前导零；库存合计；表头单位 ============
{
  const link = mk('w-link.xlsx', {
    '通知单': [['通知单号', '位号', '设备名称', '描述', '缺陷等级', '状态', '发现时间', '是否需停机', '预计工期', '备件需求', '备件型号', '需求数量', '专业'],
      ['10046656', 'P-01', '进料泵A', 'P-01 机封泄漏', 'B', 'NOPR', '2026-10-31', '是', '2天', '机械密封', 'JM-50A', 1, '动设备（机泵）']],
    '工单': [['工单号', '通知单号', '位号', '设备名称', '订单描述', '工单类型', '优先级', '状态', '基本结束日期', '是否需停机', '预计工期'],
      ['20033053', '10046656', 'P-01', '进料泵A', '', 'PM01', '2', 'CRTD', '2026-11-07', '是', '2天']],
  });
  const sp0 = mk('w-spare0.xlsx', { '备件库存': [['备件名称', '备件型号', '库存数量'], ['机械密封', 'JM-50A', 0]] });
  section('B', () => {
    r = run(['--input', link, ...BASE, '--spare', sp0], 'w-link');
    const d = ((r.j && r.j.demands) || []).find((x) => x.basisNo === '20033053') || {};
    ok(d.spareName === '机械密封' && d.spareModel === 'JM-50A' && d.spareQty === 1, 'W1 工单无备件信息时沿用通知单的备件名称、型号、数量');
    eq(d.spareState, 'short', 'W2 沿用后按库存判不足（不再判「无备件需求」）');
    eq(d.desc, 'P-01 机封泄漏', 'W3 工单内容为空时沿用通知单描述');
    eq(d.discipline, '动设备（机泵）', 'W4 工单专业为空时沿用通知单专业');
  });

  const clsd = mk('w-clsd.xlsx', {
    '通知单': [['通知单号', '位号', '设备名称', '描述', '缺陷等级', '状态', '发现时间'],
      ['10046656', 'P-01', '进料泵A', 'P-01 机封泄漏', 'B', 'OSNO', '2026-10-31']],
    '工单': [['工单号', '通知单号', '位号', '设备名称', '订单描述', '工单类型', '优先级', '状态', '基本结束日期'],
      ['20033053', '10046656', 'P-01', '进料泵A', 'P-01 机封泄漏', 'PM01', '2', 'CLSD', '2026-11-07'],
      ['20033099', '', 'P-02', '泵B', 'P-02 检查', 'PM02', '3', 'CRTD', '2026-11-30']],
  });
  section('A', () => {
    r = run(['--input', clsd, ...BASE], 'w-clsd');
    ok(r.j && !r.j.demands.some((x) => x.basisNo === '10046656'), 'W5 工单已 CLSD、通知单仍 OSNO：通知单不再申报');
    eq(r.j && r.j.counts.linkedNotif, 1, 'W6 CLSD 工单对应的通知单记入 linkedNotif');
    ok(r.j && r.j.warnings.some((w) => w.includes('10046656→20033053') && w.includes('已闭环')), 'W7 warning 写明工单已闭环、本期不申报');
  });
  const dlfl = mk('w-dlfl.xlsx', {
    '通知单': [['通知单号', '位号', '设备名称', '描述', '缺陷等级', '状态', '发现时间'],
      ['10046656', 'P-01', '进料泵A', 'P-01 机封泄漏', 'B', 'OSNO', '2026-10-31']],
    '工单': [['工单号', '通知单号', '位号', '设备名称', '订单描述', '工单类型', '优先级', '状态', '基本结束日期'],
      ['20033053', '10046656', 'P-01', '进料泵A', 'P-01 机封泄漏', 'PM01', '2', 'DLFL', '2026-11-07']],
  });
  section('A', () => {
    r = run(['--input', dlfl, ...BASE], 'w-dlfl');
    ok(r.j && r.j.demands.some((x) => x.basisNo === '10046656'), 'W7b 工单已取消（DLFL），通知单仍未闭环 → 通知单照常申报');
  });

  const zero = mk('w-zero.xlsx', {
    '通知单': [['通知单号', '位号', '设备名称', '描述', '缺陷等级', '状态', '发现时间'],
      ['000010046656', 'P-01', '进料泵A', 'P-01 机封泄漏', 'B', 'NOPR', '2026-10-31']],
    '工单': [['工单号', '通知单号', '位号', '设备名称', '订单描述', '工单类型', '优先级', '状态', '基本结束日期'],
      ['20033053', '10046656', 'P-01', '进料泵A', 'P-01 机封泄漏', 'PM01', '2', 'CRTD', '2026-11-07']],
  });
  section('B', () => {
    r = run(['--input', zero, ...BASE], 'w-zero');
    ok(r.j && !r.j.demands.some((x) => x.basisNo === '000010046656') && r.j.counts.linkedNotif === 1, 'W8 通知单号带前导零（000010046656 与 10046656）仍配对');
  });

  const need = mk('w-need.xlsx', {
    '缺陷台账': [['缺陷编号', '位号', '设备名称', '缺陷描述', '等级', '状态', '发现时间', '是否需停机', '预计工期', '备件需求', '备件型号', '需求数量'],
      ['QX-001', 'P-01', '进料泵A', '机封处持续滴漏', 'B', '处理中', '2026-09-03', '是', 2, '机械密封', 'JM-50A', 1]] });
  const sp2 = mk('w-spare2.xlsx', { '备件库存': [['备件名称', '备件型号', '库存地点', '库存数量'], ['机械密封', 'JM-50A', '0001', 1], ['机械密封', 'JM-50A', '0002', 0]] });
  section('B', () => {
    r = run(['--input', need, ...BASE, '--spare', sp2], 'w-need');
    const dn = ((r.j && r.j.demands) || [])[0] || {};
    ok(dn.spareState === 'ok' && dn.spareStock === 1, 'W9 同一型号多个库位的库存合计（1+0=1），不被后一行覆盖成 0');
  });

  const hdr = mk('w-hdr.xlsx', {
    '缺陷台账': [['缺陷编号', '位号', '设备名称', '缺陷描述', '等级', '状态', '发现时间', '是否需停机', '预计工期(h)'],
      ['QX-001', 'P-01', '进料泵A', '机封处持续滴漏', 'B', '处理中', '2026-09-03', '是', 72],
      ['QX-002', 'P-02', '进料泵B', '轴承异响', 'B', '处理中', '2026-09-03', '是', '2天']] });
  section('B', () => {
    r = run(['--input', hdr, ...BASE], 'w-hdr');
    eq(((r.j && r.j.demands) || []).find((x) => x.basisNo === 'QX-001') && r.j.demands.find((x) => x.basisNo === 'QX-001').durationDays, 3, 'W10 表头「预计工期(h)」、值 72 → 按小时折 3 天');
    eq(((r.j && r.j.demands) || []).find((x) => x.basisNo === 'QX-002') && r.j.demands.find((x) => x.basisNo === 'QX-002').durationDays, 2, 'W11 同列值自带「天」后缀仍按天');
    ok(r.j && r.j.warnings.some((w) => w.includes('预计工期(h)') && w.includes('24 小时')), 'W12 表头带小时单位有 warning');
  });

  const nocol = mk('w-nocol.xlsx', {
    '通知单': [['通知单号', '位号', '设备名称', '描述', '缺陷等级', '状态', '发现时间'],
      ['10046700', 'P-03', '回流泵', 'P-03 轴承温度高', 'B', 'OSNO', '2026-10-31']],
    '工单': [['工单号', '通知单号', '位号', '设备名称', '订单描述', '工单类型', '优先级', '状态', '基本结束日期'],
      ['20033090', '', 'P-04', '进料泵', 'P-04 联轴器对中检查', 'PM02', '4', 'CRTD', '2026-11-07']],
  });
  // 来源表根本没有备件列（MCP 通知单/工单表即如此）≠ 有备件列但为空：前者备件需求未知，不能写「无备件需求」
  section('A', () => {
    r = run(['--input', nocol, ...BASE], 'w-nocol');
    const dsN = (r.j && r.j.demands) || [];
    ok(dsN.length === 2 && dsN.every((x) => x.spareState === 'unknown'), 'W13 来源表无备件列 → 备件需求未知（state=unknown），不判「无备件需求」');
    ok(dsN.every((x) => x.spareStatus !== '无备件需求' && /未核实/.test(x.spareStatus)), 'W14 来源表无备件列 → 备件到位写「未核实」');
    ok(r.j && r.j.warnings.some((w) => /缺陷台账/.test(w) && /无备件列/.test(w)) && r.j.warnings.some((w) => /工单台账/.test(w) && /无备件列/.test(w)), 'W15 每张无备件列的来源表各给一条 warning');
    eq(r.j && r.j.counts.spareNeedUnknown, 2, 'W16 counts.spareNeedUnknown 计 2');
    ok(r.md && /无备件列/.test(r.md) && !/无备件需求/.test(r.md), 'W17 md 写明来源表无备件列，不出现「无备件需求」');
  });
  const emptycol = mk('w-emptycol.xlsx', {
    '通知单': [['通知单号', '位号', '设备名称', '描述', '缺陷等级', '状态', '发现时间', '备件需求', '备件型号', '需求数量'],
      ['10046701', 'P-05', '回流泵', 'P-05 地脚螺栓松动', 'C', 'OSNO', '2026-10-31', '', '', '']],
    '工单': [['工单号', '通知单号', '位号', '设备名称', '订单描述', '工单类型', '优先级', '状态', '基本结束日期'],
      ['20033091', '10046701', 'P-05', '回流泵', 'P-05 地脚螺栓紧固', 'PM01', '3', 'CRTD', '2026-11-07']],
  });
  // 有备件列但该行为空 → 仍为「无备件需求」
  section('B', () => {
    r = run(['--input', emptycol, ...BASE], 'w-emptycol');
    const dE = ((r.j && r.j.demands) || [])[0] || {};
    eq(dE.spareState, 'none', 'W18 工单表无备件列、对应通知单有备件列且为空 → 沿用通知单，判「无备件需求」');
    eq(r.j && r.j.counts.spareNeedUnknown, 0, 'W19 有备件列的来源不计入 spareNeedUnknown');
  });
}

// ============ X. 周期项按申报周期筛到期（--include-cyclic） ============
{
  const cycWin = mk('cycwin.xlsx', {
    '周期检修项': [
      ['周期项编号', '位号', '设备名称', '项目名称', '检修周期', '上次检修', '是否需停机', '预计工期'],
      ['ZQ-A', 'P-A', '进料泵A', '轴承加脂', '6个月', '2026-04-20', '否', 1],      // 2026-10-17 本期到期
      ['ZQ-B', 'P-B', '进料泵B', '机封检查', '6个月', '2026-01-10', '是', 2],      // 2026-07-09 已超期
      ['ZQ-C', 'E-C', '换热器C', '管束清洗', '6个月', '2026-06-01', '是', 3],      // 2026-11-28 周期外
      ['ZQ-D', 'V-D', '缓冲罐D', '安全阀校验', '1年', '', '否', 1],                 // 缺上次日期 → 到期日未知
      ['ZQ-E', 'V-E', '缓冲罐E', '安全阀校验', '1年', '2025-11-01', '否', 1],       // 2026-11-01 周期外（边界次日）
      ['ZQ-F', 'V-F', '缓冲罐F', '安全阀校验', '1年', '2025-10-31', '否', 1],       // 2026-10-31 等于周期末 → 纳入
      ['ZQ-G', 'P-G', '回流泵G', '联轴器对中', '看情况', '2026-01-01', '否', 1],   // 周期无法解析 → 到期日未知
    ],
  });
  const cycAllOut = mk('cycallout.xlsx', { '周期检修项': [['周期项编号', '位号', '项目名称', '检修周期', '上次检修'], ['ZQ-Z', 'P-Z', '轴承加脂', '3个月', '2026-09-15']] });
  section('B', () => {
    r = run(['--input', cycWin, ...BASE, '--include-cyclic'], 'x-cycwin');
    const ids = (r.j && r.j.demands || []).map((d) => d.basisNo);
    eq(r.j && r.j.counts.bySource['周期性检修项'], 5, 'X1 到期日不晚于周期末的 5 条纳入（本期到期 2 + 已超期 1 + 到期日未知 2）');
    ok(!ids.includes('ZQ-C') && !ids.includes('ZQ-E'), 'X2 下次到期日晚于周期末的不进申报清单');
    eq(r.j && r.j.counts.cyclicOutOfPeriod, 2, 'X3 counts.cyclicOutOfPeriod 单独计数 2');
    eq(((r.j && r.j.cyclicOutOfPeriod) || []).map((x) => x.basisNo).join(','), 'ZQ-C,ZQ-E', 'X4 cyclicOutOfPeriod 列出 ZQ-C、ZQ-E');
    eq(((r.j && r.j.cyclicOutOfPeriod) || []).map((x) => x.nextDue).join(','), '2026-11-28,2026-11-01', 'X5 周期外项带下次到期日');
    ok(ids.includes('ZQ-F'), 'X6 下次到期日等于周期末（2026-10-31）的纳入');
    const dB = (r.j && r.j.demands || []).find((d) => d.basisNo === 'ZQ-B') || {};
    ok(dB.overdue === true && dB.dueStatus === '已超期' && /已超期/.test(dB.reason || ''), 'X7 已过期未做的照常纳入并标注已超期');
    const dA = (r.j && r.j.demands || []).find((d) => d.basisNo === 'ZQ-A') || {};
    ok(dA.overdue === false && dA.dueStatus === '本期到期', 'X8 本期内到期的标「本期到期」，不标超期');
    const dD = (r.j && r.j.demands || []).find((d) => d.basisNo === 'ZQ-D') || {};
    const dG = (r.j && r.j.demands || []).find((d) => d.basisNo === 'ZQ-G') || {};
    ok(dD.dueStatus === '到期日未知' && dG.dueStatus === '到期日未知' && dD.priority === null && dG.priority === null, 'X9 到期日算不出的照常纳入、优先级未判定');
    ok((r.j && r.j.warnings || []).some((w) => /ZQ-D|V-D/.test(w) && /下次到期日算不出/.test(w)) && (r.j && r.j.warnings || []).some((w) => /P-G/.test(w) && /下次到期日算不出/.test(w)), 'X10 到期日算不出的逐条 warning');
    ok((r.j && r.j.warnings || []).some((w) => /2 条/.test(w) && /晚于申报周期末/.test(w) && /本期不申报/.test(w)), 'X11 warning 写明剔除条数');
    eq(r.j && r.j.counts.cyclicOverdue, 1, 'X12 counts.cyclicOverdue 1');
    eq(r.j && r.j.counts.cyclicDueUnknown, 2, 'X13 counts.cyclicDueUnknown 2');
    eq(r.j && r.j.meta.periodEnd, '2026-10-31', 'X14 meta.periodEnd 为 --period 月末');
  });
  section('C', () => {
    ok(/## 附：周期外周期项（本期不申报）/.test(r.md || '') && /\| ZQ-C \|/.test(r.md || '') && /2026-11-28/.test(r.md || ''), 'X15 md 单列周期外周期项');
    ok(/\| 周期外周期项（本期不申报） \| 2 \|/.test(r.md || ''), 'X16 md 汇总概览单列周期外计数');
  });
  section('B', () => {
    const xs = r.xlsx && r.xlsx['周期外周期项（本期不申报）'];
    ok(!!xs && xs.some((row) => (row || []).includes('ZQ-C')) && xs.some((row) => (row || []).includes('ZQ-E')), 'X17 xlsx 有「周期外周期项」表并列出 ZQ-C、ZQ-E');
    ok(!(r.xlsx && r.xlsx['检修需求表'] || []).some((row) => (row || []).includes('ZQ-C')), 'X18 xlsx 检修需求表不含周期外项');
    // 给了 --due 仍按周期末筛
    r = run(['--input', cycWin, ...BASE, '--include-cyclic', '--due', '2026-09-25'], 'x-cycdue');
    const ids2 = (r.j && r.j.demands || []).map((d) => d.basisNo);
    ok(ids2.includes('ZQ-A') && ids2.includes('ZQ-F') && !ids2.includes('ZQ-C') && r.j.counts.cyclicOutOfPeriod === 2, 'X19 给了 --due 也以周期末为准（不按截止日筛）');
    // 不加 --include-cyclic：不产生周期外列表，md/xlsx 不出现该节
    r = run(['--input', full, ...BASE], 'x-nocyc');
    ok(r.j.counts.cyclicOutOfPeriod === 0 && !/周期外周期项/.test(r.md) && !(r.xlsx && r.xlsx['周期外周期项（本期不申报）']), 'X20 未加 --include-cyclic 时无周期外一节');
    // 全部周期项都在本期之后 → 无需上报，错误信息说明周期外条数
    const eZ = run(['--input', cycAllOut, ...BASE, '--include-cyclic'], 'x-allout');
    ok(eZ.s.ok === false && /1 条周期项下次到期日晚于申报周期末/.test(eZ.s.error || ''), 'X21 全部周期项都在周期外时报错并说明条数');
  });
}

// ============ WS. 车间范围核对（D007）：四张来源表各自核对 ============
{
  const DH = ['缺陷编号', '位号', '设备名称', '缺陷描述', '等级', '状态', '是否需停机', '备件需求'];
  const defRows = (col, list) => [col ? [...DH, col] : DH,
    ...list.map(([no, ws], i) => (col ? [no, `P-W${i}`, '泵', '机封滴漏', 'B', '待处理', '否', '', ws] : [no, `P-W${i}`, '泵', '机封滴漏', 'B', '待处理', '否', '']))];
  const wsOf = (x, i = 0) => ((x.j && x.j.meta && x.j.meta.workshopScope) || [])[i] || {};
  const nos = (x) => ((x.j && x.j.demands) || []).map((d) => d.basisNo);
  const MIX = [['QW-1', '加氢车间'], ['QW-2', '常减压车间'], ['QW-3', ''], ['QW-4', '加氢']];
  const other = mk('ws-other.xlsx', {
    '工单台账': [['工单号', '位号', '设备名称', '工单内容', '状态', '计划完成', '是否需停机', '等级', '车间'],
      ['GW-1', 'K-W1', '压缩机', '入口过滤器清洗', '已派工', '2026-10-10', '是', 'B', '加氢车间'],
      ['GW-2', 'K-W2', '压缩机', '入口过滤器清洗', '已派工', '2026-10-10', '是', 'B', '常减压车间']],
    '周期检修项': [['周期项编号', '位号', '设备名称', '项目名称', '检修周期', '上次检修', '是否需停机', '车间'],
      ['ZW-1', 'P-Z1', '泵', '轴承加脂', '6个月', '2026-04-20', '否', '加氢车间'],
      ['ZW-2', 'P-Z2', '泵', '轴承加脂', '6个月', '2026-04-20', '否', '常减压车间'],
      ['ZW-3', 'P-Z3', '泵', '轴承加脂', '6个月', '2026-04-20', '否', '常减压车间']],
    '隐患台账': [['隐患编号', '位号', '设备名称', '隐患描述', '隐患等级', '整改措施', '整改期限', '状态', '车间'],
      ['YW-1', 'V-Y1', '罐', '支架腐蚀', '一般隐患', '更换支架', '2026-10-20', '整改中', '加氢车间'],
      ['YW-2', 'V-Y2', '罐', '支架腐蚀', '一般隐患', '更换支架', '2026-10-20', '整改中', '催化车间']],
  });
  let w;
  section('A', () => {
    w = run(['--input', mk('ws-mix.xlsx', { '缺陷台账': defRows('车间', MIX) }), ...BASE], 'ws-mix');
    eq(w.j && w.j.counts.bySource['未闭环缺陷'], 3, 'WS1 两车间混合：只汇总本车间与车间为空的缺陷（3 条）');
    ok(w.j && !nos(w).includes('QW-2') && nos(w).includes('QW-1') && nos(w).includes('QW-4'), 'WS2 常减压车间的 QW-2 不进申报清单');
    ok(w.j && w.j.warnings.some((x) => /剔除其他车间 1 行/.test(x) && /常减压车间 1 行/.test(x)), 'WS3 warning 写明剔除行数与车间名');
    ok(wsOf(w).status === 'checked' && wsOf(w).droppedRows === 1 && (wsOf(w).dropped || {})['常减压车间'] === 1, 'WS4 meta.workshopScope 记录剔除情况');
    ok(wsOf(w).blank === 1 && nos(w).includes('QW-3'), 'WS5 车间列为空的行按本车间保留');
    ok(w.md && /车间范围：已按车间列核对「加氢车间」，剔除其他车间的行：「ws-mix\.xlsx\/缺陷台账」1 行/.test(w.md), 'WS6 md 口径写明按车间核对');
    ok(w.xlsx && !JSON.stringify(w.xlsx).includes('QW-2'), 'WS7 检修需求表.xlsx 不含其他车间的需求');
    w = run(['--input', mk('ws-mis.xlsx', { '缺陷台账': defRows('车间', [['QW-1', '常减压车间'], ['QW-2', '焦化车间']]) }), ...BASE], 'ws-mis');
    ok(w.j && w.j.counts.bySource['未闭环缺陷'] === 2 && wsOf(w).status === 'mismatch', 'WS8 车间列全不一致：不筛，status=mismatch');
    ok(w.j && w.j.warnings.some((x) => /^【注意】/.test(x)), 'WS9 车间列全不一致 warning 以【注意】开头');
    const at = w.md ? w.md.indexOf('的车间列取值与 --workshop「加氢车间」不一致') : -1;
    ok(at > 0 && at < w.md.indexOf('## 一'), 'WS10 md 开头（第一节之前）有【注意】提示');
  });
  section('B', () => {
    w = run(['--input', mk('ws-nocol.xlsx', { '缺陷台账': defRows(null, MIX) }), ...BASE], 'ws-nocol');
    ok(wsOf(w).status === 'noColumn' && w.j.counts.bySource['未闭环缺陷'] === 4 && /输入未含车间列，车间范围以取数条件为准/.test(w.md), 'WS11 无车间列：不筛，md 口径说明以取数条件为准');
    w = run(['--input', mk('ws-plant.xlsx', { '缺陷台账': defRows('维护工厂', [['QW-1', '1100'], ['QW-2', '1200']]) }), ...BASE], 'ws-plant');
    ok(wsOf(w).status === 'noColumn' && w.j.counts.bySource['未闭环缺陷'] === 2, 'WS12 「维护工厂」列不当车间列（noColumn，不筛）');
  });
  // 其余三张来源表：各至少一条混合剔除
  section('A', () => {
    w = run(['--input', other, ...BASE, '--include-cyclic'], 'ws-other');
    ok(w.j && nos(w).includes('GW-1') && !nos(w).includes('GW-2') && wsOf(w, 0).sheet === 'ws-other.xlsx/工单台账' && wsOf(w, 0).droppedRows === 1, 'WS13 工单台账混合：剔除其他车间工单');
    ok(w.j && nos(w).includes('ZW-1') && !nos(w).includes('ZW-2') && !nos(w).includes('ZW-3') && wsOf(w, 1).droppedRows === 2, 'WS14 周期检修项混合：剔除其他车间周期项');
    ok(w.j && nos(w).includes('YW-1') && !nos(w).includes('YW-2') && wsOf(w, 2).droppedRows === 1 && (wsOf(w, 2).dropped || {})['催化车间'] === 1, 'WS15 隐患台账混合：剔除其他车间隐患');
  });
  section('B', () => {
    w = run(['--input', mk('ws-ssc.xlsx', { '缺陷台账': defRows('所属车间', [['QW-1', '加氢车间'], ['QW-2', '常减压车间']]) }), ...BASE], 'ws-ssc');
    ok(wsOf(w).status === 'checked' && wsOf(w).column === '所属车间' && w.j.counts.bySource['未闭环缺陷'] === 1, 'WS16 「所属车间」列同样核对');
  });
}

// ============ O. 演示case 预期计数（目录不存在则跳过） ============
// 演示样例：仓库内在 炼厂车间设备员/演示case/<分类>/<技能>/，开发包内在技能目录 examples/
const skillsRoot = path.resolve(__dirname, '../../..');
const EX = path.basename(skillsRoot) === '设备员skill' ? path.join(skillsRoot, '..', '演示case', path.relative(skillsRoot, path.resolve(__dirname, '..'))) : path.join(__dirname, '..', 'examples');
section('A', () => {
  if (fs.existsSync(path.join(EX, 'sample-demand-sources-2026-10.xlsx'))) {
    r = run(['--input', path.join(EX, 'sample-demand-sources-2026-10.xlsx'), ...BASE], 'ex-main');
    ok(r.j.counts.demands === 10 && r.j.counts.noBasis === 1 && r.j.counts.possibleDuplicate === 1 && r.j.counts.needShutdown === 4 && r.j.counts.shutdownUnknown === 1 && r.j.counts.bySource['隐患整改项'] === 2, 'O1 演示case 主样例：正式 10（缺陷 4+工单 4+隐患 2）、无依据 1、疑似重复 1、需停机 4、停机未填 1');
    eq(r.j.counts.priorityUndetermined, 2, 'O2 演示case 主样例优先级未判定 2（无等级工单 + B级隐患）');
    eq(r.j.counts.skippedDone, 1, 'O3 演示case 已完成工单本期不重复申报');
    r = run(['--input', path.join(EX, 'sample-demand-sources-2026-10.xlsx'), ...BASE, '--include-cyclic', '--spare', path.join(EX, 'sample-spare-stock.xlsx')], 'ex-cyc');
    // 周期项按申报周期筛到期：ZQ-002（1年，上次 2025-11-10 → 2026-11-10）晚于 2026-10-31，本期不申报
    ok(r.j.counts.demands === 12 && r.j.counts.needShutdown === 5 && r.j.counts.bySource['周期性检修项'] === 2, 'O4 演示case 含周期项：正式 12（周期项 2 条本期到期）、需停机 5');
    eq(r.j.counts.priorityUndetermined, 4, 'O5 演示case 本期到期的 2 条周期项优先级未判定（不按中默认）');
    ok(r.j.counts.cyclicOutOfPeriod === 1 && r.j.cyclicOutOfPeriod[0].basisNo === 'ZQ-002' && r.j.cyclicOutOfPeriod[0].nextDue === '2026-11-10', 'O5b 演示case ZQ-002 下次到期 2026-11-10 晚于周期末，单列周期外');
    ok(r.j.demands.find((d) => d.basisNo === 'QX-20260908-002').spareState === 'short' && r.j.demands.find((d) => d.basisNo === 'QX-20260903-001').spareState === 'ok', 'O6 演示case 备件到位/不足判定');
    eq(r.j.demands.find((d) => d.basisNo === 'GD-2609-104').spareState, 'unverified', 'O6b 演示case DN150-PN16 不在库存表 → 未核实（不借用 DN300-PN40 的库存）');
    eq(r.j.demands.find((d) => d.basisNo === 'ZQ-001').spareState, 'short', 'O6c 演示case LT-8 库存 0 → 不足');
    r = run(['--input', path.join(EX, 'sample-sap-export.xlsx'), ...BASE], 'ex-sap');
    ok(r.s.ok && r.j.counts.demands === 4 && r.j.counts.skippedDone === 1 && r.j.counts.statusUndetermined === 0 && r.j.demands.some((d) => d.basisNo === '40023001' && d.category === '抢修'), 'O7 演示case SAP 导出：通知单 2 + 订单 2 纳入、TECO 1 条不重复申报、PM03→抢修');
    r = run(['--input', path.join(EX, 'sample-no-basis.xlsx'), ...BASE], 'ex-nobasis');
    eq(r.s.ok, false, 'O8 演示case 全无依据报错');
  }
});

console.log(`\n${'='.repeat(56)}`);
console.log(`maintenance-demand-rollup 自测：${pass} 通过，${fail} 失败`);
console.log(`用例级别 ${LEVELS[RUN_LEVEL]}：BVT ${byLevel.BVT}，A ${byLevel.A}，B ${byLevel.B}，C ${byLevel.C}`);
if (failures.length) { console.log('\n失败项：'); failures.forEach((f) => console.log('  ✗ ' + f)); }
console.log('='.repeat(56));
try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
