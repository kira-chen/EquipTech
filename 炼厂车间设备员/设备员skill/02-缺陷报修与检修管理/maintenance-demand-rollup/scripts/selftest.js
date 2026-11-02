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
const ok = (c, n) => { if (c) pass++; else { fail++; failures.push(n); } };
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
let r = run(['--input', full, ...BASE], 'multi');
eq(r.s.ok, true, 'A1 多源合并成功');
eq(r.j.counts.bySource['未闭环缺陷'], 3, 'A2 未闭环缺陷 3 条（已闭环与无编号已排除）');
eq(r.j.counts.bySource['未闭环工单'], 2, 'A3 未闭环工单 2 条（已完成已排除）');
eq(r.j.counts.bySource['周期性检修项'], 0, 'A4 未加 --include-cyclic 时周期项不纳入');
eq(r.j.counts.demands, 5, 'A5 正式清单 5 条');
ok(r.j.warnings.some((w) => w.includes('周期检修项') && w.includes('--include-cyclic')), 'A6 存在周期表但未启用时 warning');
ok(!r.j.demands.some((d) => d.basisNo === 'QX-003'), 'A7 已闭环缺陷不纳入');
ok(!r.j.demands.some((d) => d.basisNo === 'GD-088'), 'A8 已完成工单不纳入');
eq(r.j.meta.sources.length, 2, 'A9 识别到 2 类来源');

// --include-cyclic 后周期项纳入
r = run(['--input', full, ...BASE, '--include-cyclic'], 'cyclic');
eq(r.j.counts.bySource['周期性检修项'], 2, 'A10 --include-cyclic 后周期项 2 条');
eq(r.j.counts.demands, 7, 'A11 含周期项后正式清单 7 条');
const zq = r.j.demands.find((d) => d.basisNo === 'ZQ-001');
ok(/周期 180 天/.test(zq.reason) && /上次检修 2026-04-20/.test(zq.reason), 'A12 周期项申报理由含周期与上次检修');
ok(/应于 2026-10-17 前完成/.test(zq.reason), 'A13 周期项按周期算出应完成日期');

// ============ B. 疑似重复不自动合并 ============
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
const diffTag = mk('difftag.xlsx', {
  '缺陷台账': [['缺陷编号', '位号', '缺陷描述', '状态'],
    ['QX-A', 'P-77', '机封处持续滴漏', '待处理'], ['QX-B', 'P-88', '机封处持续滴漏', '待处理']],
});
r = run(['--input', diffTag, ...BASE], 'difftag');
eq(r.j.counts.possibleDuplicate, 0, 'B12 不同位号的相近描述不判重复');

// ============ C. 备件：未提供库存表不得写「有库存」 ============
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

// 提供备件表：到位 / 不足 / 查不到→未核实
const spare = mk('spare.xlsx', {
  '备件库存': [['备件名称', '备件型号', '库存数量'],
    ['机械密封', 'JM-50A', 2],       // 需 1 → 到位
    ['缠绕垫片', 'DN300', 1]],       // 需 2 → 不足
});
r = run(['--input', full, ...BASE, '--spare', spare], 'spare');
eq(r.j.demands.find((d) => d.basisNo === 'QX-001').spareState, 'ok', 'C10 库存充足判为到位');
eq(r.j.demands.find((d) => d.basisNo === 'QX-002').spareState, 'short', 'C11 库存不足判为不足');
ok(/不足（库存 1 \/ 需 2）/.test(r.md), 'C12 不足项标出库存与需求量');
eq(r.j.counts.spareUnverified, 0, 'C13 有表且型号齐全时无未核实项');
// 备件表中查不到的型号 → 未核实，不按有库存
const spare2 = mk('spare2.xlsx', { '备件库存': [['备件名称', '备件型号', '库存数量'], ['别的备件', 'XX-1', 99]] });
r = run(['--input', full, ...BASE, '--spare', spare2], 'spare2');
ok(r.j.demands.find((d) => d.basisNo === 'QX-001').spareStatus === '未核实', 'C14 型号不在库存表→未核实');
ok(r.j.warnings.some((w) => w.includes('不在备件库存表中')), 'C15 型号查不到 warning');

// ============ D. 无依据项不进正式清单 ============
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
// 全部无依据 → 报错
const allNoBasis = mk('allnobasis.xlsx', {
  '缺陷台账': [['缺陷编号', '位号', '缺陷描述', '状态'], ['', 'P-1', '渗漏', '待处理'], ['', 'P-2', '异响', '待处理']],
});
r = run(['--input', allNoBasis, ...BASE], 'allnobasis');
eq(r.s.ok, false, 'D10 全部无依据时报错');
eq(r.code, 1, 'D11 退出码 1');
ok(/无来源单号依据/.test(r.s.error), 'D12 错误信息说明原因');

// ============ E. 模板列名匹配 ============
const tpl = mk('tpl.xlsx', {
  '检修需求表': [['序号', '设备位号', '检修项目', '需求来源', '停车要求', '备件到位', '来源单号', '费用估算', '承包商意向']],
});
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
ok(/## 八、上报模板列名核对/.test(r.md), 'E9 模板核对单列一节');
ok(/无法匹配（输出留空）/.test(r.md), 'E10 md 标注无法匹配的列留空');
// xlsx 按模板列名输出
ok(r.xlsx['检修需求表'][3].join('|') === ['序号', '设备位号', '检修项目', '需求来源', '停车要求', '备件到位', '来源单号', '费用估算', '承包商意向'].join('|'), 'E11 xlsx 表头按模板列名');
// 不带模板时按默认格式
r = run(['--input', full, ...BASE], 'notpl');
eq(r.j.template, null, 'E12 未提供模板时 template 为 null');
ok(r.xlsx['检修需求表'][3].includes('备件到位情况') && r.xlsx['检修需求表'][3].includes('功能位置') && r.xlsx['检修需求表'][3].includes('检修类别'), 'E13 默认格式为月度检修计划申报表列头（功能位置/检修类别/备件到位情况）');

// ============ F. 需停机项单列与「未填」不默认 ============
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

// 停机窗口冲突
r = run(['--input', full, ...BASE, '--window', '国庆检修窗口共 3 天'], 'win');
eq(r.j.netDemand.windowConflict.conflict, true, 'F10 合计工期超窗口判冲突');
eq(r.j.netDemand.windowConflict.windowDays, 3, 'F11 解析出窗口天数');
ok(/与停机窗口冲突/.test(r.md), 'F12 md 标注窗口冲突');
r = run(['--input', full, ...BASE, '--window', '窗口共 30 天'], 'win2');
eq(r.j.netDemand.windowConflict.conflict, false, 'F13 窗口充足不判冲突');
r = run(['--input', full, ...BASE, '--window', '视装置停工安排而定'], 'win3');
eq(r.j.netDemand.windowConflict.conflict, null, 'F14 窗口说明无天数→不判定，不默认冲突');
ok(r.j.warnings.some((w) => w.includes('未能解析出天数')), 'F15 窗口无法解析 warning');

// ============ G. 优先级排序 ============
r = run(['--input', full, ...BASE], 'prio');
const prios = r.j.demands.map((d) => (d.priority === null ? 9 : d.priority));
ok(prios.every((p, i) => i === 0 || prios[i - 1] <= p), 'G1 按优先级升序排列');
eq(r.j.demands[0].priorityCn, '紧急', 'G2 I 级缺陷排首位且优先级为紧急');
eq(r.j.demands[0].basisNo, 'QX-001', 'G3 首条为 I 级缺陷 QX-001');
eq(r.j.demands.map((d) => d.seq).join(','), '1,2,3,4,5', 'G4 序号按排序后连续编号');
eq(r.j.counts.byPriority['紧急'], 1, 'G5 紧急 1 条');
ok(r.j.demands.find((d) => d.basisNo === 'QX-002').priorityCn === '中', 'G6 III 级映射为中');

// ============ H. 参数校验与空输入 ============
function raw(args) {
  const x = spawnSync(process.execPath, [ROLLUP, ...args], { encoding: 'utf8' });
  const l = x.stdout.trim().split('\n');
  try { return { code: x.status, s: JSON.parse(l[l.length - 1]) }; } catch (e) { return { code: x.status, s: { ok: false } }; }
}
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
// 空输入：无任一来源表
const emptyBook = mk('empty.xlsx', { '别的表': [['a'], [1]] });
let e1 = raw(['--input', emptyBook, ...BASE]);
eq(e1.s.ok, false, 'H13 无任一来源工作表报错');
ok(/未在输入中找到/.test(e1.s.error), 'H14 错误信息列出应有的表名');
eq(e1.code, 1, 'H15 退出码 1');
// 有来源表但全部已闭环 → 无需上报
const allClosed = mk('allclosed.xlsx', {
  '缺陷台账': [['缺陷编号', '位号', '缺陷描述', '状态'], ['QX-1', 'P-1', '渗漏', '已闭环']],
});
e1 = raw(['--input', allClosed, ...BASE]);
eq(e1.s.ok, false, 'H16 全部已闭环时报错');
ok(/没有任何未闭环需求项/.test(e1.s.error), 'H17 无未闭环项错误信息');

// ============ I. 产出完整性 ============
r = run(['--input', full, ...BASE, '--include-cyclic', '--spare', spare, '--template', tpl, '--window', '共 3 天'], 'outputs');
ok(fs.existsSync(path.join(r.out, 'demands.json')), 'I1 demands.json 生成');
ok(fs.existsSync(path.join(r.out, '需求汇总.md')), 'I2 需求汇总.md 生成');
ok(fs.existsSync(path.join(r.out, '检修需求表.xlsx')), 'I3 检修需求表.xlsx 生成');
ok(fs.existsSync(path.join(r.out, 'summary.json')), 'I4 summary.json 生成');
ok(/## 一、汇总概览/.test(r.md) && /## 二、需求明细/.test(r.md) && /## 三、需停机项/.test(r.md)
  && /## 四、备件缺口/.test(r.md) && /## 五、疑似重复待确认/.test(r.md) && /## 六、未判定项/.test(r.md) && /## 七、建议核实区/.test(r.md), 'I5 七节结构齐全（含未判定项）');
ok(/<!-- ANALYSIS_START -->/.test(r.md) && /<!-- ANALYSIS_END -->/.test(r.md), 'I6 分析段占位符存在');
// 必须保留的说明行
const DECL = '本清单为车间申报稿，最终计划以公司设备管理部门（机动部/设备部）批复为准';
ok(r.md.includes(DECL), 'I7 md 含必须保留的说明行');
eq(r.j.meta.declaration, DECL, 'I8 JSON 中记录说明行');
ok(r.xlsx['检修需求表'].some((row) => (row || []).some((c) => c === DECL)), 'I9 xlsx 中含说明行');
// xlsx 多表齐全
ok(['检修需求表', '需停机项', '备件缺口', '疑似重复待确认', '未判定项', '建议核实区'].every((n) => r.xlsx[n]), 'I10 xlsx 六张表齐全');
// summary.json 与末行摘要一致
const sj = JSON.parse(fs.readFileSync(path.join(r.out, 'summary.json'), 'utf8'));
eq(sj.counts.demands, r.s.counts.demands, 'I11 summary.json 与末行摘要一致');
eq(r.s.ok, true, 'I12 末行 ok:true');
eq(r.code, 0, 'I13 成功退出码 0');
// md 中的数字来自 JSON
ok(r.md.includes(`| 正式清单需求条数 | ${r.j.counts.demands} |`), 'I14 md 条数引用 JSON');
ok(r.md.includes(`| 需停机项 | ${r.j.counts.needShutdown} |`), 'I15 md 需停机数引用 JSON');

// ============ J. 数值解析与表头识别 ============
// 工期无法解析 → null（显示「未填」），绝不按 0
const badNum = mk('badnum.xlsx', {
  '缺陷台账': [['缺陷编号', '位号', '缺陷描述', '状态', '预计工期'], ['QX-N', 'P-1', '渗漏', '待处理', '待定']],
});
r = run(['--input', badNum, ...BASE], 'badnum');
eq(r.j.demands[0].durationDays, null, 'J1 工期无法解析为 null 不是 0');
ok(r.j.warnings.some((w) => w.includes('无法解析为数字')), 'J2 数值无法解析 warning');
ok(/未填/.test(r.md) && !/\| 0 天 \|/.test(r.md), 'J3 md 显示未填不显示 0 天');
// 别名列头 + 标题行 + 合计行
const alias = mk('alias.xlsx', {
  '缺陷台账': [
    ['某厂缺陷台账导出'],
    [],
    ['缺陷号', '设备位号', '名称', '现象', '处理状态', '发现日期'],
    ['QX-A1', 'P-01', '进料泵', '机封渗漏', '待处理', '2026-09-10'],
    ['合计', '', '', '', '', ''],
  ],
});
r = run(['--input', alias, ...BASE], 'alias');
eq(r.s.ok, true, 'J4 别名列头可读');
eq(r.j.counts.demands, 1, 'J5 合计行被跳过');
ok(r.j.warnings.some((w) => w.includes('合计行')), 'J6 合计行 warning');
eq(r.j.demands[0].tag, 'P-01', 'J7 标题行下的表头正确识别');
// 状态无法归类 → 按未闭环纳入并 warning，不静默丢弃
const oddStatus = mk('odd.xlsx', {
  '缺陷台账': [['缺陷编号', '位号', '缺陷描述', '状态'], ['QX-S', 'P-5', '渗漏', '张工看过了']],
});
r = run(['--input', oddStatus, ...BASE], 'oddstatus');
eq(r.j.counts.demands, 0, 'J8 状态无法归类时不按未闭环纳入正式清单');
eq(r.j.counts.statusUndetermined, 1, 'J8b 状态无法归类列入未判定');
ok(r.j.undetermined.some((u) => u.kind === 'status' && u.tag === 'P-5'), 'J8c undetermined 含 status 项');
ok(r.j.warnings.some((w) => w.includes('无法判断是否闭环') && w.includes('未按未闭环纳入')), 'J9 状态无法归类 warning 写明未按未闭环纳入');
// 位号为空跳过
const noTag = mk('notag.xlsx', {
  '缺陷台账': [['缺陷编号', '位号', '缺陷描述', '状态'], ['QX-T', '', '渗漏', '待处理'], ['QX-U', 'P-6', '异响', '待处理']],
});
r = run(['--input', noTag, ...BASE], 'notag');
eq(r.j.counts.demands, 1, 'J10 位号为空的行被跳过');
ok(r.j.warnings.some((w) => w.includes('位号为空')), 'J11 位号为空 warning');

// ============ K. 多文件输入与专业归属 ============
const f2 = mk('second.xlsx', {
  '工单台账': [['工单号', '位号', '设备名称', '工单内容', '状态', '是否需停机'],
    ['GD-901', 'I-01', '温度变送器', '示值偏差大需校验', '待处理', '否']],
});
r = run(['--input', `${full},${f2}`, ...BASE], 'multifile');
eq(r.s.ok, true, 'K1 多文件输入成功');
ok(r.j.demands.some((d) => d.basisNo === 'GD-901'), 'K2 第二个文件的工单已合并');
eq(r.j.meta.sources.length, 3, 'K3 来源计为 3（含第二文件）');
eq(r.j.demands.find((d) => d.basisNo === 'GD-901').discipline, '仪表', 'K4 未填专业时按位号/名称推断');
eq(r.j.demands.find((d) => d.basisNo === 'QX-001').discipline, '动设备', 'K5 泵归动设备');
eq(r.j.demands.find((d) => d.basisNo === 'QX-002').discipline, '静设备', 'K6 换热器归静设备');


// ============ L. 四处默认填补改未判定 ============
r = run(['--input', full, ...BASE, '--include-cyclic', '--spare', spare], 'undet');
const g102 = r.j.demands.find((d) => d.basisNo === 'GD-102');
eq(g102.priority, 2, 'L1 工单有等级 II 级→高');
const ordNoLevel = mk('ordnolevel.xlsx', { '工单台账': [['工单号', '位号', '工单内容', '状态'], ['GD-N1', 'P-N1', '机封更换', '待处理']] });
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
const qtyNull = mk('qtynull.xlsx', { '缺陷台账': [['缺陷编号', '位号', '缺陷描述', '状态', '备件需求', '备件型号', '需求数量'], ['QX-Q', 'P-Q', '机封漏', '待处理', '机械密封', 'JM-50A', '']] });
r = run(['--input', qtyNull, ...BASE, '--spare', spare], 'qtynull');
eq(r.j.demands[0].spareState, 'unverified', 'L9 需求数量未填→到位情况未判定（unverified）');
ok(/未判定（库存 2，需求数量未填）/.test(r.j.demands[0].spareStatus), 'L10 到位情况写明库存与数量未填');
ok(r.j.undetermined.some((u) => u.kind === 'spareQty'), 'L11 undetermined 含 spareQty 项');
ok(r.j.warnings.some((w) => w.includes('未按 1 件默认')), 'L12 warning 说明未按 1 件默认');
ok(!/到位（库存/.test(r.md), 'L13 md 不出现到位判定');
// 状态无法判断 → 不纳入；待验收/已完成 → 本期不重复申报
const stMix = mk('stmix.xlsx', { '工单台账': [['工单号', '位号', '工单内容', '状态', '等级'],
  ['GD-S1', 'P-S1', '机封更换', 'TECO', 'B 级'], ['GD-S2', 'P-S2', '轴承更换', 'REL', 'B 级'], ['GD-S3', 'P-S3', '法兰处理', 'CLSD', 'B 级'], ['GD-S4', 'P-S4', '清洗', '张工看过', 'B 级'], ['GD-S5', 'P-S5', '校验', '已完成', 'C 级']] });
r = run(['--input', stMix, ...BASE], 'stmix');
eq(r.j.counts.demands, 1, 'L14 只有 REL（已派工）纳入');
eq(r.j.demands[0].basisNo, 'GD-S2', 'L15 纳入的是 REL 工单');
eq(r.j.counts.skippedDone, 2, 'L16 TECO 与「已完成」为待验收，本期不重复申报');
eq(r.j.counts.statusUndetermined, 1, 'L17 无法判断的状态列入未判定');
ok(r.j.warnings.some((w) => w.includes('已完工待验收') && w.includes('不重复申报')), 'L18 待验收 warning');
eq(r.j.demands[0].priority, 2, 'L19 B 级→高（A/B/C 口径）');

// ============ M. 隐患台账来源 ============
const hz = mk('hazard.xlsx', { '隐患台账': [['隐患编号', '位号', '设备名称', '隐患描述', '隐患等级', '整改措施', '整改期限', '状态', '责任人', '是否需停机', '预计工期'],
  ['YH-001', 'V-H1', '液化气球罐', '安全阀出口管线支架腐蚀', '重大隐患', '更换支架并防腐', '2026-10-20', '整改中', '王工', '否', 2],
  ['YH-002', 'E-H2', '换热器', '保温破损', 'B级', '恢复保温', '2026-10-30', '未整改', '李工', '否', 1],
  ['YH-003', 'P-H3', '泵', '地脚螺栓松动', '一般隐患', '紧固', '2026-10-15', '已销号', '张工', '否', 1],
  ['', 'P-H4', '泵', '护罩缺失', '一般隐患', '补装', '2026-10-15', '未整改', '张工', '否', 1],
  ['YH-005', '', '', '消防通道堆放杂物', '一般隐患', '清理', '2026-10-15', '未整改', '赵工', '否', 1]] });
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

// ============ N. SAP 列名与检修类别、申报表列头、口径用语 ============
const sapSrc = mk('sap.xlsx', {
  '通知单': [['通知单', '功能位置', '设备', '设备描述', '通知单短文本', '优先级', '系统状态', '通知日期'],
    ['10020001', 'P-SAP1', '10000001', '进料泵A', '机封泄漏', 'A 级', 'OSNO', '2026-09-20']],
  '订单': [['订单', '订单类型', '功能位置', '设备描述', '订单描述', '系统状态', '基本结束日期', '优先级'],
    ['40010001', 'PM03', 'K-SAP1', '压缩机', '入口过滤器清洗', 'REL', '2026-10-05', '1'],
    ['40010002', 'PM02', 'E-SAP2', '换热器', '管束清洗', 'CRTD', '2026-10-20', '4']],
});
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
ok(!/机动处/.test(r.md) && !/EAM/.test(r.md) && /公司设备管理部门（机动部\/设备部）/.test(r.md), 'N12 md 不出现机动处，写公司设备管理部门（机动部/设备部）');
ok(r.md.includes('本材料由脚本汇总、模型成文，仅供设备员复核参考'), 'N13 md 含通用声明行');
ok(/【注意】/.test(r.md) && !/[✅⚠️❌]/.test(r.md), 'N14 md 用【注意】且不含 emoji');
ok(/大检修（停工检修）\/ 日常维修 \/ 抢修 \/ 专项/.test(r.md), 'N15 md 注明检修分级口径');
{
  const rr = spawnSync(process.execPath, [ROLLUP, '--input', full, ...BASE], { encoding: 'utf8' });
  const sj2 = JSON.parse(rr.stdout.trim().split('\n').pop());
  ok(sj2.ok && sj2.out.startsWith(os.tmpdir()) && !fs.existsSync(path.join(path.dirname(full), 'mdr-out')), 'N16 默认输出目录为 os.tmpdir()/mdr-out');
}

// ============ O. examples 预期计数（目录不存在则跳过） ============
const EX = path.join(__dirname, '..', 'examples');
if (fs.existsSync(path.join(EX, 'sample-demand-sources-2026-10.xlsx'))) {
  r = run(['--input', path.join(EX, 'sample-demand-sources-2026-10.xlsx'), ...BASE], 'ex-main');
  ok(r.j.counts.demands === 10 && r.j.counts.noBasis === 1 && r.j.counts.possibleDuplicate === 1 && r.j.counts.needShutdown === 4 && r.j.counts.shutdownUnknown === 1 && r.j.counts.bySource['隐患整改项'] === 2, 'O1 examples 主样例：正式 10（缺陷 4+工单 4+隐患 2）、无依据 1、疑似重复 1、需停机 4、停机未填 1');
  eq(r.j.counts.priorityUndetermined, 2, 'O2 examples 主样例优先级未判定 2（无等级工单 + B级隐患）');
  eq(r.j.counts.skippedDone, 1, 'O3 examples 已完成工单本期不重复申报');
  r = run(['--input', path.join(EX, 'sample-demand-sources-2026-10.xlsx'), ...BASE, '--include-cyclic', '--spare', path.join(EX, 'sample-spare-stock.xlsx')], 'ex-cyc');
  ok(r.j.counts.demands === 13 && r.j.counts.needShutdown === 6, 'O4 examples 含周期项：正式 13、需停机 6');
  eq(r.j.counts.priorityUndetermined, 5, 'O5 examples 周期项 3 条优先级未判定（不按中默认）');
  ok(r.j.demands.find((d) => d.basisNo === 'QX-20260908-002').spareState === 'short' && r.j.demands.find((d) => d.basisNo === 'QX-20260903-001').spareState === 'ok', 'O6 examples 备件到位/不足判定');
  r = run(['--input', path.join(EX, 'sample-sap-export.xlsx'), ...BASE], 'ex-sap');
  ok(r.s.ok && r.j.counts.demands === 4 && r.j.counts.skippedDone === 1 && r.j.counts.statusUndetermined === 0 && r.j.demands.some((d) => d.basisNo === '40023001' && d.category === '抢修'), 'O7 examples SAP 导出：通知单 2 + 订单 2 纳入、TECO 1 条不重复申报、PM03→抢修');
  r = run(['--input', path.join(EX, 'sample-no-basis.xlsx'), ...BASE], 'ex-nobasis');
  eq(r.s.ok, false, 'O8 examples 全无依据报错');
}

console.log(`\n${'='.repeat(56)}`);
console.log(`maintenance-demand-rollup 自测：${pass} 通过，${fail} 失败`);
if (failures.length) { console.log('\n失败项：'); failures.forEach((f) => console.log('  ✗ ' + f)); }
console.log('='.repeat(56));
try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
