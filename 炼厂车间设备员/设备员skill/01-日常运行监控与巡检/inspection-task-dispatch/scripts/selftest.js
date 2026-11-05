#!/usr/bin/env node
'use strict';
/**
 * 自测：生成变体输入并断言 dispatch.js 行为。用法：node scripts/selftest.js（全绿退出 0）
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { writeXlsx } = require('./lib/xlsx-lite');

const DISPATCH = path.join(__dirname, 'dispatch.js');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'itd-selftest-'));
const DATE = '2026-09-21';
const back = (n) => new Date(Date.parse(DATE + 'T00:00:00Z') - n * 86400000).toISOString().slice(0, 10);
let pass = 0, fail = 0;
const failures = [];

function ok(cond, name) { if (cond) { pass++; } else { fail++; failures.push(name); } }
function eq(actual, expect, name) { ok(actual === expect, `${name}（期望 ${JSON.stringify(expect)}，实际 ${JSON.stringify(actual)}）`); }

function run(file, extra = [], tag, opts = {}) {
  const out = path.join(work, (tag || path.basename(file, '.xlsx')) + '-out');
  const args = [DISPATCH, '--input', file, '--workshop', '测试车间', '--date', DATE, '--out', out];
  if (!opts.noShift) args.push('--shift', '白班');
  const r = spawnSync(process.execPath, [...args, ...extra], { encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  let summary;
  try { summary = JSON.parse(lines[lines.length - 1]); } catch (e) { summary = { ok: false, error: 'no-json:' + r.stdout + r.stderr }; }
  let tasks = null, md = null;
  if (fs.existsSync(path.join(out, 'tasks.json'))) tasks = JSON.parse(fs.readFileSync(path.join(out, 'tasks.json'), 'utf8'));
  if (fs.existsSync(path.join(out, 'tasklist.md'))) md = fs.readFileSync(path.join(out, 'tasklist.md'), 'utf8');
  return { code: r.status, summary, tasks, md, out };
}
function mk(name, book) { const p = path.join(work, name); writeXlsx(p, book); return p; }

const LEDGER = [
  ['位号', '设备名称', '区域', '专业', '重要度', '设备类型', '是否需巡检'],
  ['P-01', '泵1', '一区', '动设备', 'A', '离心泵', '是'],
  ['P-02', '泵2', '一区', '动设备', 'B', '离心泵', '是'],
  ['E-01', '换热器1', '二区', '静设备', 'C', '换热器', '是'],
  ['V-99', '备用罐', '二区', '静设备', 'C', '容器', '否'],
];
const STD = [
  ['位号', '设备类型', '检查项', '判定标准', '所需工具', '巡检周期'],
  ['P-01', '', '机封泄漏检查', '无可见滴漏', '手电筒', '1天'],
  ['P-02', '', '轴承温度测量', '温度 ≤75℃', '红外测温仪', '7天'],
  ['', '换热器', '法兰泄漏检查', '无渗漏', '手电筒', '30天'],
];
const LAST = [
  ['位号', '上次巡检日期', '结果'],
  ['P-01', back(5), '正常'],     // 1天周期 → 逾期 4 天
  ['P-02', back(8), '异常'],     // 7天周期 → 逾期 1 天
  ['E-01', back(3), '正常'],     // 30天周期 → 未到期
];

// ---- 1. 基础：任务生成、排除、计数
const base = mk('base.xlsx', { '设备台账': LEDGER, '巡检标准': STD, '上次巡检记录': LAST });
let r = run(base, [], 'base');
eq(r.summary.ok, true, '1.1 基础运行成功');
eq(r.summary.counts.ledgerEquipment, 4, '1.2 台账设备数');
eq(r.summary.counts.excluded, 1, '1.3 标「否」的 V-99 排除在巡检范围外');
eq(r.summary.counts.inScopeEquipment, 3, '1.4 范围内设备数');
ok(r.tasks.excluded[0].tag === 'V-99', '1.5 排除清单含 V-99');
ok(!r.tasks.tasks.some((t) => t.tag === 'V-99'), '1.6 不需巡检设备不生成任务项');
eq(r.summary.counts.tasks, 2, '1.7 任务项数（P-01、P-02 到期，E-01 未到期）');
ok(!r.tasks.tasks.some((t) => t.tag === 'E-01'), '1.8 未到期设备不进本班清单');

// ---- 2. 逾期判定与优先级排序
eq(r.summary.counts.overdue, 2, '2.1 逾期 2 项');
eq(r.tasks.overdue[0].tag, 'P-01', '2.2 逾期按天数降序，P-01（4天）在前');
eq(r.tasks.overdue[0].overdueDays, 4, '2.3 逾期天数计算正确');
eq(r.tasks.overdue[1].overdueDays, 1, '2.4 P-02 逾期 1 天');
eq(r.tasks.tasks[0].priority, 'P2', '2.5 逾期项优先级为 P2（P1 留给特护）');
ok(r.tasks.tasks.every((t) => t.priority === 'P2'), '2.6 两项均为逾期 P2');
ok(/已逾期 4 天/.test(r.tasks.tasks[0].priorityReason), '2.7 优先级理由含逾期天数');

// ---- 2b. 优先级口径：特护 > 逾期 > 关键(A) > 上次异常 > 临期 > 常规
const prio = mk('prio.xlsx', {
  '设备台账': [
    ['位号', '设备名称', '区域', '专业', '重要度', '特护', '是否需巡检'],
    ['X-SP', '特护项', '一区', '动设备', 'C', '是', '是'],
    ['X-OVER', '逾期项', '一区', '动设备', 'C', '否', '是'],
    ['X-A', 'A类到期项', '一区', '动设备', 'A', '否', '是'],
    ['X-ABN', '上次异常项', '一区', '动设备', 'C', '否', '是'],
    ['X-SOON', '临期项', '一区', '动设备', 'C', '否', '是'],
    ['X-NORM', '常规到期项', '一区', '动设备', 'C', '', '是'],
  ],
  '巡检标准': [
    ['位号', '检查项', '判定标准', '所需工具', '巡检周期'],
    ['X-SP', '检查', '标准', '手电筒', '7天'],
    ['X-OVER', '检查', '标准', '手电筒', '7天'],
    ['X-A', '检查', '标准', '手电筒', '7天'],
    ['X-ABN', '检查', '标准', '手电筒', '7天'],
    ['X-SOON', '检查', '标准', '手电筒', '30天'],
    ['X-NORM', '检查', '标准', '手电筒', '7天'],
  ],
  '上次巡检记录': [
    ['位号', '上次巡检日期', '结果'],
    ['X-SP', back(7), '正常'],
    ['X-OVER', back(10), '正常'],
    ['X-A', back(7), '正常'],
    ['X-ABN', back(7), '异常'],
    ['X-SOON', back(28), '正常'],   // 30 天周期，距到期 2 天 ≤ 3（10%）
    ['X-NORM', back(7), '正常'],
  ],
});
r = run(prio, [], 'prio');
eq(r.tasks.tasks.map((t) => t.tag).join(','), 'X-SP,X-OVER,X-A,X-ABN,X-SOON,X-NORM', '2b.1 优先级排序：特护>逾期>关键A>上次异常>临期>常规');
eq(r.tasks.tasks[0].priority, 'P1', '2b.2 特护设备强制 P1');
ok(/特护设备/.test(r.tasks.tasks[0].priorityReason), '2b.3 特护理由写明');
eq(r.tasks.tasks[1].priority, 'P2', '2b.4 逾期为 P2');
eq(r.tasks.tasks[2].priority, 'P3', '2b.5 关键设备（A）为 P3');
ok(/关键设备（A 类）/.test(r.tasks.tasks[2].priorityReason), '2b.6 A 类理由用「关键设备」口径');
eq(r.tasks.tasks[3].priority, 'P4', '2b.7 上次结果异常为 P4');
eq(r.tasks.tasks[4].priority, 'P5', '2b.8 临期为 P5');
eq(r.tasks.tasks[5].priority, 'P6', '2b.9 常规到期为 P6');
eq(r.summary.counts.dueSoon, 1, '2b.10 临期计数为 1');
eq(r.summary.counts.special, 1, '2b.11 特护任务项计数 1');
eq(r.tasks.special[0].tag, 'X-SP', '2b.12 special 数组含特护项');
ok(/【注意】本班含特护设备任务项/.test(r.md) && /X-SP/.test(r.md), '2b.13 md 用【注意】提示特护，不用 emoji');
ok(!/[✅⚠️]/.test(r.md), '2b.14 md 无 emoji');
ok(/A（特护）|C（特护）/.test(r.md), '2b.15 明细表重要度列标注（特护）');

// ---- 2c. 特护也可由「重要度」列值「特护」识别；特护 + 逾期理由同时写明
const spRaw = mk('spraw.xlsx', {
  '设备台账': [['位号', '设备名称', '区域', '专业', '设备分级', '是否需巡检'], ['K-01', '大机组', '一区', '动设备', '特护', '是'], ['P-09', '泵', '一区', '动设备', 'A', '是']],
  '巡检标准': [['位号', '检查项', '判定标准', '所需工具', '巡检周期'], ['K-01', '检查', '标准', '手电筒', '7天'], ['P-09', '检查', '标准', '手电筒', '7天']],
  '上次巡检记录': [['位号', '上次巡检日期', '结果'], ['K-01', back(9), '正常'], ['P-09', back(9), '正常']],
});
r = run(spRaw, [], 'spraw');
{
  const k = r.tasks.tasks.find((t) => t.tag === 'K-01');
  ok(k && k.special === true && k.criticality === 'A', '2c.1 重要度列「特护」→ special=true 且归关键设备 A');
  ok(k && k.priority === 'P1' && /且已逾期 2 天/.test(k.priorityReason), '2c.2 特护且逾期：P1 并写明逾期天数');
  eq(r.tasks.tasks[0].tag, 'K-01', '2c.3 特护排在同样逾期的 A 类之前');
  ok(!r.tasks.warnings.some((w) => /「特护」无法归类/.test(w)), '2c.4 「特护」不报无法归类');
}

// ---- 3. 周期缺失/无法解析 → unscheduled，绝不默认按日检
const noPeriod = mk('noperiod.xlsx', {
  '设备台账': LEDGER,
  '巡检标准': [
    ['位号', '检查项', '判定标准', '所需工具', '巡检周期'],
    ['P-01', '周期为空项', '标准', '手电筒', ''],
    ['P-02', '周期乱填项', '标准', '手电筒', '视情况'],
    ['E-01', '正常周期项', '标准', '手电筒', '1天'],
    ['E-01', '运行小时项', '标准', '手电筒', '运行2000小时'],
  ],
  '上次巡检记录': LAST,
});
r = run(noPeriod, [], 'noperiod');
eq(r.summary.counts.unscheduled, 3, '3.1 周期为空、无法解析、运行小时各计 1，合计 3');
ok(!r.tasks.tasks.some((t) => t.item === '周期为空项'), '3.2 周期为空项未进任务清单（未按日检默认）');
ok(!r.tasks.tasks.some((t) => t.item === '周期乱填项'), '3.3 周期无法解析项未进任务清单');
ok(r.tasks.unscheduled.some((t) => t.item === '周期为空项' && /未填写巡检周期/.test(t.reason)), '3.4 周期为空原因标注正确');
ok(r.tasks.unscheduled.some((t) => t.item === '周期乱填项' && /「视情况」无法解析/.test(t.reason)), '3.5 周期无法解析原因标注正确');
ok(r.tasks.unscheduled.every((t) => t.dueStatus === 'unscheduled'), '3.6 unscheduled 项 dueStatus 正确');
ok(r.tasks.warnings.some((w) => /未按日检默认处理/.test(w)), '3.7 warning 明确未按日检默认');
ok(r.tasks.warnings.some((w) => /工作表「巡检标准」第\d+行/.test(w)), '3.8 warning 具体到 sheet 与行号');
ok(/## 四、周期待确认/.test(r.md) && /周期待确认/.test(r.md), '3.9 md 中周期待确认单列一节');
ok(/未按日检默认处理，也未丢弃/.test(r.md), '3.10 md 说明既未默认也未丢弃');
ok(r.tasks.warnings.some((w) => /「运行2000小时」是运行小时周期/.test(w)), '3.11 运行小时周期不按日历周期排期，warning 说明');

// ---- 4. 无巡检标准的设备 → noStandard 单列，不生成空任务项
const noStd = mk('nostd.xlsx', {
  '设备台账': [
    ['位号', '设备名称', '区域', '专业', '重要度', '设备类型', '是否需巡检'],
    ['P-01', '泵1', '一区', '动设备', 'A', '离心泵', '是'],
    ['K-77', '压缩机', '二区', '动设备', 'A', '压缩机', '是'],
  ],
  '巡检标准': [
    ['位号', '设备类型', '检查项', '判定标准', '所需工具', '巡检周期'],
    ['P-01', '', '机封泄漏检查', '无可见滴漏', '手电筒', '1天'],
  ],
  '上次巡检记录': [['位号', '上次巡检日期', '结果'], ['P-01', back(5), '正常']],
});
r = run(noStd, [], 'nostd');
eq(r.summary.counts.noStandard, 1, '4.1 无巡检标准设备计 1');
eq(r.tasks.noStandard[0].tag, 'K-77', '4.2 无标准设备为 K-77');
ok(!r.tasks.tasks.some((t) => t.tag === 'K-77'), '4.3 无标准设备不生成空任务项');
ok(/未匹配到巡检标准/.test(r.tasks.noStandard[0].reason), '4.4 无标准原因说明');
ok(/无巡检标准的设备/.test(r.md), '4.5 md 中无标准设备单列');

// ---- 4b. 巡检标准表整体缺失 → warning 且不中断
const noStdSheet = mk('nostdsheet.xlsx', { '设备台账': LEDGER, '上次巡检记录': LAST });
r = run(noStdSheet, [], 'nostdsheet');
eq(r.summary.ok, true, '4b.1 缺巡检标准表不中断');
eq(r.summary.counts.tasks, 0, '4b.2 无标准时不生成任何任务项');
eq(r.summary.counts.noStandard, 3, '4b.3 范围内 3 台设备全部归入无标准');
ok(r.tasks.warnings.some((w) => /未找到工作表「巡检标准」/.test(w)), '4b.4 缺标准表 warning');

// ---- 5. 上次巡检记录缺失 → 全部视为未检并说明
const noHist = mk('nohist.xlsx', { '设备台账': LEDGER, '巡检标准': STD });
r = run(noHist, [], 'nohist');
eq(r.summary.ok, true, '5.1 缺上次巡检记录不中断');
eq(r.summary.counts.never, 3, '5.2 全部 3 台按未检纳入');
eq(r.summary.counts.tasks, 3, '5.3 未检项全部进任务清单');
ok(r.tasks.tasks.every((t) => t.dueStatus === 'never' && t.lastDate === null), '5.4 未检项 lastDate 为 null');
ok(r.tasks.warnings.some((w) => /未找到工作表「上次巡检记录」/.test(w) && /按「从未巡检」处理/.test(w)), '5.5 warning 说明按未检处理');
eq(r.tasks.meta.lastRecordProvided, false, '5.6 meta 标记未提供上次记录');
ok(r.tasks.tasks.some((t) => /未提供上次巡检记录/.test(t.priorityReason)), '5.7 优先级理由说明未提供记录');

// ---- 5b. 上次巡检日期无法解析 → 按未检，不猜测
const badDate = mk('baddate.xlsx', {
  '设备台账': LEDGER, '巡检标准': STD,
  '上次巡检记录': [['位号', '上次巡检日期', '结果'], ['P-01', '上周', '正常']],
});
r = run(badDate, [], 'baddate');
ok(r.tasks.warnings.some((w) => /「上周」无法解析/.test(w)), '5b.1 日期无法解析 warning');
ok(r.tasks.tasks.some((t) => t.tag === 'P-01' && t.dueStatus === 'never'), '5b.2 日期无法解析时按未检，未猜测日期');

// ---- 6. 过滤器 --area / --discipline / --criticality
r = run(base, ['--area', '一区'], 'farea');
eq(r.summary.counts.inScopeEquipment, 2, '6.1 --area 一区 保留 2 台');
eq(r.summary.counts.filteredOut, 1, '6.2 --area 排除 1 台');
ok(r.tasks.tasks.every((t) => t.area === '一区'), '6.3 --area 结果全为一区');
ok(/筛选条件：区域=一区/.test(r.md), '6.4 md 写明筛选条件');

r = run(base, ['--discipline', '静设备'], 'fdisc');
eq(r.summary.counts.inScopeEquipment, 1, '6.5 --discipline 静设备 保留 1 台');
ok(r.tasks.filteredOut.every((e) => /不匹配 --discipline/.test(e.reason)), '6.6 筛选排除原因说明');

r = run(base, ['--criticality', 'A'], 'fcrit');
eq(r.summary.counts.inScopeEquipment, 1, '6.7 --criticality A 保留 1 台');
eq(r.summary.counts.tasks, 1, '6.8 A 类任务项 1 条');
ok(r.tasks.tasks.every((t) => t.criticality === 'A'), '6.9 结果全为 A 类');

r = run(base, ['--area', '一区', '--criticality', 'B'], 'fboth');
eq(r.summary.counts.inScopeEquipment, 1, '6.10 多条件叠加筛选');
eq(r.tasks.tasks[0].tag, 'P-02', '6.11 叠加筛选结果正确');

r = run(base, ['--area', '九区'], 'fnone');
eq(r.summary.ok, true, '6.12 过滤后为空不报错');
eq(r.summary.counts.tasks, 0, '6.13 过滤后任务为 0');
ok(r.tasks.warnings.some((w) => /筛选后无任何设备/.test(w)), '6.14 过滤后为空 warning');

// ---- 7. 路线编排：按区域聚类再按位号排序
const route = mk('route.xlsx', {
  '设备台账': [
    ['位号', '设备名称', '区域', '专业', '重要度', '是否需巡检'],
    ['P-09', '泵9', '二区', '动设备', 'C', '是'],
    ['P-01', '泵1', '二区', '动设备', 'C', '是'],
    ['P-05', '泵5', '一区', '动设备', 'C', '是'],
  ],
  '巡检标准': [
    ['位号', '检查项', '判定标准', '所需工具', '巡检周期'],
    ['P-09', '检查', '标准', '手电筒', '1天'],
    ['P-01', '检查', '标准', '手电筒', '1天'],
    ['P-05', '检查', '标准', '手电筒', '1天'],
  ],
});
r = run(route, [], 'route');
eq(r.tasks.route.map((x) => x.area).join(','), '一区,二区', '7.1 区域聚类且按中文数字顺序');
const seqByTag = Object.fromEntries(r.tasks.tasks.map((t) => [t.tag, t.routeSeq]));
eq(seqByTag['P-05'], 1, '7.2 一区先走');
ok(seqByTag['P-01'] === 2 && seqByTag['P-09'] === 3, '7.3 区内按位号升序编号');
ok(/实际巡检路线由车间确定/.test(r.md), '7.4 md 声明路线仅为建议');
eq(r.tasks.meta.routeNote.includes('实际巡检路线由车间确定'), true, '7.5 tasks.json 保留路线声明');

// ---- 8. 别名列头 + 标题行表头识别 + 合计行跳过（EM 风格）
const eam = mk('eam.xlsx', {
  '设备台账': [
    ['某厂设备台账导出'],
    [],
    ['设备位号', '名称', '所在区域', '所属专业', '设备等级', '类型', '是否需巡检'],
    ['P-21', '进料泵', '一区', '动设备', '一级', '离心泵', '是'],
    ['P-22', '回流泵', '一区', '动设备', '二级', '离心泵', '是'],
    ['合计', '', '', '', '', '', ''],
  ],
  '巡检标准': [
    ['设备位号', '设备类别', '检查内容', '合格标准', '检测工具', '频次'],
    ['P-21', '', '机封泄漏检查', '无可见滴漏', '手电筒', '1日'],
    ['', '离心泵', '润滑油位检查', '油位 1/2~2/3', '手电筒', '1日'],
  ],
  '上次巡检记录': [
    ['设备位号', '上次检查日期', '上次结果'],
    ['P-21', back(3), '异常'],
  ],
});
r = run(eam, [], 'eam');
eq(r.summary.ok, true, '8.1 EM 风格别名表头可读');
eq(r.summary.counts.ledgerEquipment, 2, '8.2 合计行被跳过');
ok(r.tasks.warnings.some((w) => /合计行/.test(w)), '8.3 合计行 warning');
eq(r.tasks.tasks.find((t) => t.tag === 'P-21').criticality, 'A', '8.4 「一级」归一为 A');
ok(r.tasks.tasks.some((t) => t.tag === 'P-22' && t.matchBy === '设备类型'), '8.5 按设备类型匹配标准');
ok(r.tasks.tasks.some((t) => t.tag === 'P-21' && t.matchBy === '位号'), '8.6 位号匹配优先于类型');

// ---- 8b. SAP PM 列名（mergeAliases 共享别名）+ 智能巡检一行一检查项 + 是否报警
const sap = mk('sap.xlsx', {
  '设备台账': [
    ['IH08 技术对象列表导出'],
    [],
    ['功能位置', '设备', '设备描述', '工厂区段', '专业类别', 'ABC标识', '特护', '对象类型', '是否需巡检'],
    ['P-31', '10001111', '进料泵', '一区', '动设备', 'A', '否', '离心泵', '是'],
    ['K-31', '10001222', '压缩机', '二区', '动设备', 'A', '是', '压缩机', '是'],
  ],
  '巡检标准': [
    ['功能位置', '对象类型', '检查内容', '合格标准', '检测工具', '巡检频次'],
    ['P-31', '', '机封泄漏检查', '无可见滴漏', '手电筒', '1日'],
    ['K-31', '', '振动检查', '≤4.5mm/s', '测振仪', '1日'],
  ],
  '巡检明细': [
    ['功能位置', '检查内容', '巡检时间', '测值', '是否报警'],
    ['P-31', '机封泄漏检查', `${back(2)} 08:10`, '无', '否'],
    ['P-31', '轴承温度', `${back(2)} 08:12`, '78℃', '是'],
    ['K-31', '振动检查', `${back(2)} 09:00`, '3.1mm/s', '否'],
  ],
});
r = run(sap, [], 'sap');
eq(r.summary.ok, true, '8b.1 SAP PM 列名可读');
{
  const p = r.tasks.tasks.find((t) => t.tag === 'P-31'), k = r.tasks.tasks.find((t) => t.tag === 'K-31');
  ok(p && k, '8b.2 「功能位置」识别为位号');
  eq(p && p.equipNo, '10001111', '8b.3 SAP「设备」列归设备编号，不当位号');
  eq(p && p.name, '进料泵', '8b.4 「设备描述」识别为设备名称');
  eq(p && p.area, '一区', '8b.5 「工厂区段」识别为区域');
  eq(p && p.discipline, '动设备', '8b.6 「专业类别」识别为专业');
  eq(p && p.criticality, 'A', '8b.7 「ABC标识」识别为重要度');
  ok(k && k.special === true && p.special === false, '8b.8 「特护」列识别，K-31 特护、P-31 非特护');
  eq(p && p.lastResult, 'abnormal', '8b.9 一行一检查项：同一位号任一检查项报警即上次异常');
  ok(p && /是否报警=是/.test(p.lastResultRaw), '8b.10 无「结果」列时用「是否报警」判异常');
  eq(k && k.lastResult, 'normal', '8b.11 是否报警=否 → 正常');
  ok(p && p.lastDateTime === `${back(2)} 08:12`, '8b.12 「巡检时间」识别为上次巡检日期并保留时间');
  ok(r.tasks.meta.hasEquipNo === true && /\| 设备编号 \|/.test(r.md), '8b.13 台账有设备编号列时明细表增列设备编号');
  ok(r.tasks.noStandard.length === 0, '8b.14 「巡检频次」识别为巡检周期，未因缺周期而落入无标准');
}
ok(r.tasks.meta.hasEquipNo === true, '8b.15 meta.hasEquipNo');
{
  // 无设备编号列时明细表不增列
  const r0 = run(base, [], 'noeqno');
  ok(r0.tasks.meta.hasEquipNo === false && !/\| 设备编号 \|/.test(r0.md), '8b.16 无设备编号列时明细表不增列');
}

// ---- 9. 缺表 / 空位号 / 重复位号
const noLedger = mk('noledger.xlsx', { '巡检标准': STD });
r = run(noLedger, [], 'noledger');
eq(r.summary.ok, false, '9.1 缺设备台账（唯一必需数据源）时 ok:false');
eq(r.code, 1, '9.2 退出码为 1');
ok(/未在输入中找到「设备台账」/.test(r.summary.error), '9.3 缺台账错误信息明确');

const dirty = mk('dirty.xlsx', {
  '设备台账': [
    ['位号', '设备名称', '区域', '专业', '重要度', '是否需巡检'],
    ['', '无位号设备', '一区', '动设备', 'A', '是'],
    ['P-01', '泵1', '一区', '动设备', 'A', '是'],
    ['P-01', '泵1重复行', '一区', '动设备', 'A', '是'],
    ['P-03', '泵3', '一区', '动设备', '特级', '是'],
    ['P-04', '泵4', '一区', '动设备', '2', '是'],
  ],
  '巡检标准': [
    ['位号', '检查项', '判定标准', '所需工具', '巡检周期'],
    ['P-01', '检查', '标准', '手电筒', '1天'],
    ['P-03', '检查', '标准', '手电筒', '1天'],
    ['P-04', '检查', '标准', '手电筒', '1天'],
  ],
});
r = run(dirty, [], 'dirty');
eq(r.summary.counts.ledgerEquipment, 3, '9.4 空位号与重复位号行被跳过');
ok(r.tasks.warnings.some((w) => /位号为空/.test(w)), '9.5 空位号 warning');
ok(r.tasks.warnings.some((w) => /位号「P-01」重复/.test(w)), '9.6 重复位号 warning');
ok(r.tasks.warnings.some((w) => /重要度「特级」无法归类/.test(w)), '9.7 重要度无法归类 warning');
eq(r.tasks.tasks.find((t) => t.tag === 'P-03').criticality, null, '9.8 无法归类的重要度为 null，不猜测');
eq(r.tasks.tasks.find((t) => t.tag === 'P-04').criticality, null, '9.9 纯数字级别「2」不默认映射（厂内可配置）');
ok(r.tasks.warnings.some((w) => /「2」无法归类/.test(w) && /厂内可配置/.test(w)), '9.10 数字级别 warning 说明厂内可配置');
ok(/\| — \|/.test(r.md) || r.md.includes('—'), '9.11 缺失字段显示「—」');

// ---- 10. 参数校验
function runRaw(args) {
  const rr = spawnSync(process.execPath, [DISPATCH, ...args], { encoding: 'utf8' });
  const lines = rr.stdout.trim().split('\n');
  try { return { code: rr.status, s: JSON.parse(lines[lines.length - 1]) }; } catch (e) { return { code: rr.status, s: { ok: false, error: 'no-json' } }; }
}
let x = runRaw(['--input']);
eq(x.s.ok, false, '10.1 --input 缺值报错');
ok(/缺少取值/.test(x.s.error), '10.2 缺值错误信息正确');
eq(x.code, 1, '10.3 参数错误退出码为 1');
x = runRaw(['--input', base, '--workshop', '车间', '--date', DATE, '--out', path.join(work, 'noshift-out')]);
eq(x.s.ok, true, '10.4 --shift 改为可选，不给也能跑');
eq(x.s.shift, null, '10.5 未给 --shift 时摘要 shift 为 null');
x = runRaw(['--input', base, '--workshop', '车间', '--date', '2026-13-45', '--shift', '白班']);
eq(x.s.ok, false, '10.6 非法日期报错');
x = runRaw(['--input', base, '--workshop', '车间', '--date', DATE, '--shift', '白班', '--未知参数', 'x']);
eq(x.s.ok, false, '10.7 未知参数报错');
x = runRaw(['--input', '/不存在的路径.xlsx', '--workshop', '车间', '--date', DATE, '--shift', '白班']);
eq(x.s.ok, false, '10.8 输入不存在报错');
x = runRaw(['--input', base, '--workshop', '车间', '--date', DATE, '--shift', '白班', '--criticality', 'X']);
eq(x.s.ok, false, '10.9 非法重要度报错');
ok(/不是有效重要度/.test(x.s.error), '10.10 非法重要度错误信息明确');
x = runRaw(['--input', base, '--workshop', '车间', '--date', DATE, '--time', '25:00']);
eq(x.s.ok, false, '10.11 非法 --time 报错');
x = runRaw(['--input', base, '--workshop', '车间', '--date', DATE, '--due-soon', '两天']);
eq(x.s.ok, false, '10.12 非法 --due-soon 报错');
ok(/--due-soon/.test(x.s.error), '10.13 --due-soon 错误信息明确');
x = runRaw(['--input', base, '--workshop', '车间', '--date', DATE]);
ok(x.s.ok === true && x.s.out.startsWith(os.tmpdir()), '10.14 未给 --out 时默认写系统临时目录');

// ---- 11. 产出结构与落盘
r = run(base, ['--group', '甲班组'], 'struct');
ok(fs.existsSync(path.join(r.out, 'tasks.json')), '11.1 tasks.json 已写入');
ok(fs.existsSync(path.join(r.out, 'tasklist.md')), '11.2 tasklist.md 已写入');
ok(fs.existsSync(path.join(r.out, 'summary.json')), '11.3 summary.json 已写入');
const sj = JSON.parse(fs.readFileSync(path.join(r.out, 'summary.json'), 'utf8'));
eq(sj.ok, true, '11.4 summary.json 内容正确');
ok(/## 一、任务概览/.test(r.md) && /## 二、任务明细/.test(r.md) && /## 三、逾期与临期专项/.test(r.md)
  && /## 四、周期待确认/.test(r.md) && /## 五、执行提示与交接事项/.test(r.md), '11.5 五节结构齐全');
ok(/<!-- NOTES_START -->/.test(r.md) && /<!-- NOTES_END -->/.test(r.md), '11.6 分析段占位符存在');
ok(/人员分组：甲班组/.test(r.md), '11.7 --group 写入报告头部');
ok(/白班/.test(r.md) && /2026-09-21/.test(r.md), '11.8 班次与日期写入标题');
ok(/本清单由脚本按台账、巡检标准与上次记录生成，模型只成文说明/.test(r.md), '11.9 声明行写入 md');
ok(r.tasks.meta.disclaimer && /厂内制度与系统数据为准/.test(r.tasks.meta.disclaimer), '11.10 声明行写入 tasks.json meta');
ok(!/班次交接提示/.test(r.md), '11.11 旧节名「班次交接提示」不再出现');
ok(!/今日到期/.test(r.md) && /本班到期/.test(r.md), '11.12 到期状态改「本班到期」');
{
  const r0 = run(base, [], 'noshiftmd', { noShift: true });
  ok(/巡检任务清单（2026-09-21 全天）/.test(r0.md) && /未指定（按全天排/.test(r0.md), '11.13 未给 --shift 时标题写「全天」并说明不过滤');
  eq(r0.tasks.meta.shiftText, '全天', '11.14 meta.shiftText 全天');
}

// ---- 12. 下游衔接：位号字段口径与 inspection-data-digest 一致
ok(r.tasks.tasks.every((t) => typeof t.tag === 'string' && t.tag), '12.1 每条任务均有 tag（位号）字段');
ok(r.tasks.tasks.every((t) => 'name' in t && 'area' in t && 'discipline' in t && 'equipNo' in t), '12.2 任务含 name/area/discipline/equipNo，与下游汇总口径一致');
ok(r.tasks.tasks.every((t) => 'item' in t && 'criterion' in t && 'tool' in t && 'routeSeq' in t && 'priority' in t && 'dueStatus' in t && 'special' in t && 'periodText' in t), '12.3 任务含检查项/判定标准/工具/建议顺序/优先级/到期状态/特护/周期文本');
ok(Array.isArray(r.tasks.tools), '12.4 tools 汇总为数组，供备料使用');

// ---- 12b. 上次结果归类：「无异常」是正常，不得按子串"异常"抬到上次异常优先级
const lastOk = mk('lastok.xlsx', {
  '设备台账': [['位号', '设备名称', '区域', '专业', '重要度', '是否需巡检'], ['Y-01', '泵', '一区', '动设备', 'C', '是'], ['Y-02', '泵', '一区', '动设备', 'C', '是']],
  '巡检标准': [['位号', '检查项', '判定标准', '所需工具', '巡检周期'], ['Y-01', '检查', '标准', '手电筒', '7天'], ['Y-02', '检查', '标准', '手电筒', '7天']],
  '上次巡检记录': [['位号', '上次巡检日期', '结果'], ['Y-01', back(7), '无异常'], ['Y-02', back(7), '异常']],
});
r = run(lastOk, [], 'lastok');
{
  const t1 = r.tasks.tasks.find((t) => t.tag === 'Y-01'), t2 = r.tasks.tasks.find((t) => t.tag === 'Y-02');
  ok(t1 && t2, '12b.1 两台均生成任务');
  ok(t1 && t2 && t1.priority !== t2.priority, '12b.2 「无异常」与「异常」优先级不同');
  ok(t1 && !/上次异常|为异常/.test(t1.priorityReason || ''), '12b.3 「无异常」不按上次异常抬级');
}

// ---- 13. 周期解析：每班/每2小时/半年/8小时 可解析；班次级周期按小时粒度判定
const perShift = mk('pershift.xlsx', {
  '设备台账': [['位号', '设备名称', '区域', '专业', '重要度', '是否需巡检'], ['Z-01', '泵', '一区', '动设备', 'C', '是'], ['Z-02', '泵', '一区', '动设备', 'C', '是'], ['Z-03', '泵', '一区', '动设备', 'C', '是'], ['Z-04', '泵', '一区', '动设备', 'C', '是']],
  '巡检标准': [['位号', '检查项', '判定标准', '所需工具', '巡检周期'], ['Z-01', '检查', '标准', '手电筒', '每班'], ['Z-02', '检查', '标准', '手电筒', '每2小时'], ['Z-03', '检查', '标准', '手电筒', '半年'], ['Z-04', '检查', '标准', '手电筒', '8小时']],
  '上次巡检记录': [['位号', '上次巡检日期', '结果'], ['Z-01', back(1), '正常'], ['Z-02', back(1), '正常'], ['Z-03', back(10), '正常'], ['Z-04', back(0), '正常']],
});
r = run(perShift, [], 'pershift');
eq(r.tasks.unscheduled.length, 0, '13.1 每班/每2小时/半年/8小时 均能解析，周期待确认为空');
ok(r.tasks.tasks.some((t) => t.tag === 'Z-01') && r.tasks.tasks.some((t) => t.tag === 'Z-02'), '13.2 班次级周期上次昨天巡检本班到期');
ok(!r.tasks.tasks.some((t) => t.tag === 'Z-03'), '13.3 半年周期 10 天前巡检过不到期');
{
  const z1 = r.tasks.tasks.find((t) => t.tag === 'Z-01'), z4 = r.tasks.tasks.find((t) => t.tag === 'Z-04');
  ok(z1 && z1.granularity === 'hour' && z1.periodHours === 8 && z1.periodText === '每班(8小时)', '13.4 每班 → 小时粒度 8h，周期文本「每班(8小时)」');
  ok(z4 && z4.dueStatus === 'due' && /上次记录无时间/.test(z4.dueNote), '13.5 班次级周期当天已检但无时间 → 本班到期并说明未按小时判逾期');
  ok(z1 && z1.overdueHours === null && z1.dueStatus === 'due', '13.6 上次记录无时间不按小时判逾期，不捏造逾期小时');
  eq(r.summary.counts.hourly, 3, '13.7 班次级周期项计数 3');
  ok(r.tasks.warnings.some((w) => /上次巡检记录不带时间/.test(w) && /未按小时判定逾期/.test(w)), '13.8 warning 说明未按小时判定');
}

// ---- 13b. 班次级周期：上次记录带时间 + --time 时按小时判逾期 / 班内已检不到期
const hourly = mk('hourly.xlsx', {
  '设备台账': [['位号', '设备名称', '区域', '专业', '重要度', '是否需巡检'], ['H-01', '泵', '一区', '动设备', 'C', '是'], ['H-02', '泵', '一区', '动设备', 'C', '是'], ['H-03', '泵', '一区', '动设备', 'C', '是']],
  '巡检标准': [['位号', '检查项', '判定标准', '所需工具', '巡检周期'], ['H-01', '检查', '标准', '手电筒', '每班'], ['H-02', '检查', '标准', '手电筒', '每2小时'], ['H-03', '检查', '标准', '手电筒', '每班']],
  '上次巡检记录': [['位号', '巡检时间', '结果'], ['H-01', `${back(1)} 22:00`, '正常'], ['H-02', `${DATE} 07:30`, '正常'], ['H-03', `${DATE} 06:00`, '正常']],
});
r = run(hourly, ['--time', '08:00'], 'hourly');
{
  const h1 = r.tasks.tasks.find((t) => t.tag === 'H-01'), h2 = r.tasks.tasks.find((t) => t.tag === 'H-02'), h3 = r.tasks.tasks.find((t) => t.tag === 'H-03');
  ok(h1 && h1.dueStatus === 'overdue' && h1.overdueHours === 2 && h1.dueDate === `${DATE} 06:00`, '13b.1 每班 22:00 检 → 到期 06:00，08:00 逾期 2 小时');
  ok(h1 && /已逾期 2 小时/.test(h1.priorityReason), '13b.2 逾期理由按小时写');
  ok(!h2, '13b.3 每2小时 07:30 已检，08:00 未到期，不进清单');
  ok(!h3, '13b.4 每班 06:00 已检（班内），08:00 未到期');
  ok(/逾期2小时|2 小时/.test(r.md), '13b.5 md 逾期列按小时显示');
  ok(/班次开始时间：08:00/.test(r.md), '13b.6 md 写明班次开始时间');
  ok(!r.tasks.warnings.some((w) => /未按小时判定逾期/.test(w)), '13b.7 都带时间时不再提示未按小时判定');
}
r = run(hourly, [], 'hourly-notime');
ok(r.tasks.tasks.length === 3 && r.tasks.tasks.every((t) => t.dueStatus === 'due' && /未给 --time/.test(t.dueNote)), '13b.8 记录带时间但未给 --time → 全部本班到期并说明');

// ---- 14. 临期阈值：默认周期 10%，--due-soon 可按天或百分比
const soon = mk('soon.xlsx', {
  '设备台账': [['位号', '设备名称', '区域', '专业', '重要度', '是否需巡检'], ['S-07', '泵', '一区', '动设备', 'C', '是'], ['S-30', '泵', '一区', '动设备', 'C', '是'], ['S-01', '泵', '一区', '动设备', 'C', '是']],
  '巡检标准': [['位号', '检查项', '判定标准', '所需工具', '巡检周期'], ['S-07', '检查', '标准', '手电筒', '7天'], ['S-30', '检查', '标准', '手电筒', '30天'], ['S-01', '检查', '标准', '手电筒', '1天']],
  '上次巡检记录': [['位号', '上次巡检日期', '结果'], ['S-07', back(6), '正常'], ['S-30', back(27), '正常'], ['S-01', back(0), '正常']],
});
r = run(soon, [], 'soon');
ok(!r.tasks.tasks.some((t) => t.tag === 'S-07'), '14.1 7 天周期距到期 1 天 > 0.7 天，不算临期（旧版固定 1 天会误纳）');
ok(!r.tasks.tasks.some((t) => t.tag === 'S-01'), '14.2 1 天周期今天刚检过，不再按「临期」纳入');
ok(r.tasks.tasks.some((t) => t.tag === 'S-30' && t.dueStatus === 'dueSoon' && t.dueSoonThreshold === 3), '14.3 30 天周期距到期 3 天 ≤ 3 天（10%）算临期');
eq(r.tasks.meta.dueSoonRule, '周期的 10%', '14.4 meta 记录临期规则');
ok(/临期阈值：距到期 ≤ 周期的 10%/.test(r.md), '14.5 md 写明临期阈值');
r = run(soon, ['--due-soon', '1'], 'soon1');
ok(r.tasks.tasks.some((t) => t.tag === 'S-07' && t.dueStatus === 'dueSoon'), '14.6 --due-soon 1 按天：7 天周期距到期 1 天算临期');
ok(!r.tasks.tasks.some((t) => t.tag === 'S-30'), '14.7 --due-soon 1：30 天周期距到期 3 天不算临期');
eq(r.tasks.meta.dueSoonRule, '1 天', '14.8 meta 记录按天规则');
r = run(soon, ['--due-soon', '20%'], 'soon20');
ok(r.tasks.tasks.some((t) => t.tag === 'S-07' && t.dueStatus === 'dueSoon' && t.dueSoonThreshold === 1.4), '14.9 --due-soon 20%：7 天周期阈值 1.4 天，距到期 1 天算临期');

// ---- 15. 适用班次过滤：--shift 给定时只排适用本班的标准；标准仅适用其他班次的设备不算无标准
const shiftBook = mk('shift.xlsx', {
  '设备台账': [['位号', '设备名称', '区域', '专业', '重要度', '是否需巡检'], ['W-01', '泵', '一区', '动设备', 'C', '是'], ['W-02', '泵', '一区', '动设备', 'C', '是'], ['W-03', '泵', '一区', '动设备', 'C', '是'], ['W-04', '泵', '一区', '动设备', 'C', '是']],
  '巡检标准': [['位号', '检查项', '判定标准', '所需工具', '巡检周期', '适用班次'],
    ['W-01', '检查', '标准', '手电筒', '1天', '夜班'],
    ['W-02', '检查', '标准', '手电筒', '1天', '白班/中班'],
    ['W-03', '检查', '标准', '手电筒', '1天', '每班'],
    ['W-04', '检查', '标准', '手电筒', '1天', '']],
});
r = run(shiftBook, [], 'shift');
ok(!r.tasks.tasks.some((t) => t.tag === 'W-01'), '15.1 适用班次「夜班」的检查项白班不排');
ok(r.tasks.tasks.some((t) => t.tag === 'W-02'), '15.2 适用班次「白班/中班」含白班 → 排');
ok(r.tasks.tasks.some((t) => t.tag === 'W-03') && r.tasks.tasks.some((t) => t.tag === 'W-04'), '15.3 「每班」与空白 → 任何班次都排');
eq(r.summary.counts.otherShift, 1, '15.4 不属本班检查项计数 1');
eq(r.summary.counts.otherShiftOnlyEquipment, 1, '15.5 标准仅适用其他班次的设备计 1');
eq(r.summary.counts.noStandard, 0, '15.6 仅适用其他班次的设备不算无标准');
ok(r.tasks.otherShiftOnly[0].tag === 'W-01' && /不含本班「白班」/.test(r.tasks.otherShiftOnly[0].reason), '15.7 otherShiftOnly 原因写明');
ok(/不属本班的检查项/.test(r.md) && /巡检标准仅适用其他班次的设备/.test(r.md), '15.8 md 两处单列');
ok(/已剔除 1 项/.test(r.md), '15.9 md 头部写明剔除数');
r = run(shiftBook, [], 'shift-none', { noShift: true });
eq(r.summary.counts.tasks, 4, '15.10 未给 --shift 时不按适用班次过滤，4 项全排');
eq(r.summary.counts.otherShift, 0, '15.11 未给 --shift 时 otherShift 为 0');
r = run(shiftBook, ['--shift', '夜班'], 'shift-night');
ok(r.tasks.tasks.some((t) => t.tag === 'W-01') && !r.tasks.tasks.some((t) => t.tag === 'W-02'), '15.12 --shift 夜班：排夜班项，白班/中班项剔除');

// ---- 16. 带单位数值：判定标准「≤75℃」保留原文（本技能不解析数值），周期「8h」「2班」可解析
const units = mk('units.xlsx', {
  '设备台账': [['位号', '设备名称', '区域', '专业', '重要度', '是否需巡检'], ['U-01', '泵', '一区', '动设备', 'C', '是'], ['U-02', '泵', '一区', '动设备', 'C', '是']],
  '巡检标准': [['位号', '检查项', '判定标准', '所需工具', '巡检周期'], ['U-01', '温度', '≤75℃', '测温仪', '8h'], ['U-02', '振动', '≤4.5mm/s', '测振仪', '2班']],
});
r = run(units, [], 'units');
{
  const u1 = r.tasks.tasks.find((t) => t.tag === 'U-01'), u2 = r.tasks.tasks.find((t) => t.tag === 'U-02');
  ok(u1 && u1.criterion === '≤75℃' && u1.periodHours === 8, '16.1 「8h」解析为 8 小时周期，判定标准原文保留');
  ok(u2 && u2.periodHours === 16 && u2.periodText === '每16小时', '16.2 「2班」解析为 16 小时');
  eq(r.tasks.unscheduled.length, 0, '16.3 单位写法周期不落入周期待确认');
}

// ---- 17. 模板占位符与 tasks.json 键一致
{
  const tpl = fs.readFileSync(path.join(__dirname, '..', 'assets', 'templates', 'tasklist-template.md'), 'utf8');
  const keys = [...tpl.matchAll(/\{\{((?:meta|counts)\.[a-zA-Z]+)\}\}/g)].map((m) => m[1]);
  const sections = [...tpl.matchAll(/\{\{#([a-zA-Z]+)\}\}/g)].map((m) => m[1]);
  const get = (o, p) => p.split('.').reduce((x, k) => (x === undefined || x === null ? undefined : x[k]), o);
  const j = run(base, [], 'tpl').tasks;
  const missing = keys.filter((k) => get(j, k) === undefined);
  const missingSec = sections.filter((k) => !Array.isArray(j[k]));
  ok(keys.length > 10 && sections.length >= 5, '17.1 模板含 meta/counts 占位符与数组节');
  ok(missing.length === 0, `17.2 模板 meta/counts 占位符均能在 tasks.json 中取到（缺：${missing.join(',')}）`);
  ok(missingSec.length === 0, `17.3 模板数组节均为 tasks.json 数组（缺：${missingSec.join(',')}）`);
}

// ============ 18. 文档、上架信息与口径一致性 ============
{
  const ROOT = path.join(__dirname, '..');
  const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
  const exists = (p) => fs.existsSync(path.join(ROOT, p));
  // 演示样例：仓库内在 炼厂车间设备员/演示case/<分类>/<技能>/，开发包内在技能目录 examples/
  const skillsRoot = path.resolve(__dirname, '../../..');
  const EX = path.basename(skillsRoot) === '设备员skill' ? path.join(skillsRoot, '..', '演示case', path.relative(skillsRoot, path.resolve(__dirname, '..'))) : path.join(__dirname, '..', 'examples');
  const skill = rd('SKILL.md');
  const listing = (exists('上架信息.md') ? rd('上架信息.md') : '') + (exists('样例问题.md') ? rd('样例问题.md') : '');
  const attach = [...listing.matchAll(/(sample-[\w.-]+\.xlsx)/g)].map((m) => m[1]);
  const descText = ((exists('上架信息.md') ? rd('上架信息.md') : '').split('**技能描述**')[1] || '').split('**示例问题**')[0].replace(/\s/g, '');

  ok(/^agent_created: true$/m.test(skill) && /^allowed-tools: /m.test(skill), '18.1 SKILL.md 保留 agent_created 与 allowed-tools');
  ok(!/巡检排班/.test(skill), '18.2 description 不含互抢词「巡检排班」');
  ok(/inspection-data-digest/.test(skill) && /special-equipment-inspection-due/.test(skill) && /runtime-hours-tracker/.test(skill), '18.3 description 含同类技能互指');
  ok(/特护/.test(skill) && /os\.tmpdir\(\)/.test(skill) && /--due-soon/.test(skill) && /--time/.test(skill), '18.4 SKILL.md 含特护、默认临时目录、--due-soon 与 --time');
  ok(/五节/.test(skill) && /由 XX 归口/.test(skill), '18.5 SKILL.md 预期结果写五节且有归口声明');
  const r18 = run(base, [], 'doc18');
  eq((r18.md.match(/^## [一二三四五六七八九]、/gm) || []).length, 5, '18.6 产出 md 正文恰为五节，与 SKILL.md 预期结果一致');
  const spec = rd('references/input-spec.md');
  ok(/功能位置/.test(spec) && /是否报警/.test(spec) && /每班/.test(spec) && /mergeAliases/.test(spec), '18.7 input-spec 含系统列名、是否报警、每班与 mergeAliases 说明');
  ok(/^\| 位号 \| /m.test(spec) && !/^\| 位号 \| [^|\n]*设备编号[^|\n]*\|/m.test(spec), '18.8 input-spec 别名表「位号」局部别名不含设备编号');
  const rules = rd('references/dispatch-rules.md');
  ok(/《中国石化设备管理规定》/.test(rules) && /特护/.test(rules) && /归口/.test(rules), '18.9 dispatch-rules 含制度引用、特护与归口说明');
  ok(!/动火/.test(rules) && !/机动处/.test(rules + spec + skill) && !/EAM/.test(rules + spec + skill), '18.10 references/SKILL 不含「动火」「机动处」「EAM」旧术语');
  const readme = rd('scripts/README.md');
  ok(/--due-soon/.test(readme) && /os\.tmpdir\(\)/.test(readme) && /--time/.test(readme), '18.11 scripts/README 参数表含 --due-soon/--time 与默认临时目录');
  const ex = fs.readFileSync(path.join(EX, 'README.md'), 'utf8');
  ok(/sample-sap-export\.xlsx/.test(ex) && !/sample-eam-export/.test(ex) && /P1/.test(ex), '18.12 演示case/README 引用 SAP 样例、无失效文件名、含特护 P1');
  ok(fs.existsSync(path.join(EX, 'sample-sap-export.xlsx')) && fs.existsSync(path.join(EX, 'sample-no-history.xlsx')), '18.13 演示case 含 SAP 列名样例与无记录样例');
  ok(exists('上架信息.md') && exists('样例问题.md'), '18.14 上架信息.md 与 样例问题.md 存在');
  ok(attach.length >= 5 && attach.every((f) => fs.existsSync(path.join(EX, f))), `18.15 上架信息/样例问题引用的附件均存在于 演示case（${[...new Set(attach)].join(',')}）`);
  ok(/\*\*技能名称\*\*/.test(listing) && /\*\*技能简介\*\*/.test(listing) && /\*\*技能描述\*\*/.test(listing) && /\*\*示例问题\*\*/.test(listing), '18.16 上架信息格式四要素齐全');
  ok(descText.length >= 240 && descText.length <= 330, `18.17 技能描述约 250~300 字（实际 ${descText.length}）`);
  ok((listing.match(/^\d+\. /gm) || []).length >= 15, '18.18 上架信息 5 题 + 样例问题 10 题');
  ok(!/巡检排班|动火|EAM/.test(listing), '18.19 上架信息不含互抢词与旧术语');
}

// ---- 19. 车间范围核对（D007）：台账/上次巡检记录混入其他车间时剔除；空车间保留；全不一致不筛并开头【注意】；无车间列/维护工厂不筛
{
  const ws = (x) => ((x.tasks && x.tasks.meta && x.tasks.meta.workshopScope) || []);
  const W = (x) => ((x.summary && x.summary.warnings) || []);
  let plantBook = null;
  const mkP = (n, b) => { plantBook = b; return mk(n, b); };
  const tags = (x) => ((x.tasks && x.tasks.tasks) || []).map((t) => t.tag);
  const LED_WS = [
    ['位号', '设备名称', '车间', '区域', '专业', '重要度', '设备类型', '是否需巡检'],
    ['P-01', '泵1', '测试车间', '一区', '动设备', 'A', '离心泵', '是'],
    ['P-02', '泵2', '测试车间', '一区', '动设备', 'B', '离心泵', '是'],
    ['E-01', '换热器1', '', '二区', '静设备', 'C', '换热器', '是'],
    ['P-91', '外车间泵', '催化车间', '九区', '动设备', 'A', '离心泵', '是'],
    ['P-92', '外车间泵', '催化车间', '九区', '动设备', 'B', '离心泵', '是'],
  ];
  const STD_WS = STD.concat([['P-91', '', '机封泄漏检查', '无可见滴漏', '手电筒', '1天'], ['P-92', '', '机封泄漏检查', '无可见滴漏', '手电筒', '1天']]);
  r = run(mk('ws-mix.xlsx', { '设备台账': LED_WS, '巡检标准': STD_WS, '上次巡检记录': LAST }), [], 'ws-mix');
  eq(r.summary.ok, true, '19.1 车间混合台账运行成功');
  eq((r.summary.counts || {}).ledgerEquipment, 3, '19.2 剔除其他车间后台账设备数 3');
  ok(!tags(r).some((t) => /^P-9/.test(t)), '19.3 任务清单不含其他车间位号');
  eq((r.summary.counts || {}).tasks, 2, '19.4 任务项只含本车间（P-01、P-02）');
  ok(W(r).some((w) => w.includes('工作表「设备台账」按 --workshop「测试车间」剔除其他车间 2 行') && w.includes('催化车间 2 行')), '19.5 warning 写明剔除行数与车间名');
  const s0 = ws(r).find((x) => x.sheet === '设备台账') || {};
  eq(s0.status, 'checked', '19.6 meta.workshopScope 台账状态 checked');
  eq(s0.droppedRows, 2, '19.7 meta.workshopScope 记录剔除 2 行');
  eq((s0.dropped || {})['催化车间'], 2, '19.8 dropped 按车间名记行数');
  eq(s0.blank, 1, '19.9 车间为空 1 行计入 blank');
  eq((r.summary.counts || {}).inScopeEquipment, 3, '19.10 车间为空的 E-01 按本车间保留在范围内（范围内 3 台）');
  ok(W(r).some((w) => w.includes('车间列为空 1 行，按本车间保留')), '19.11 车间为空 warning 写明行数');
  ok(/车间范围：已按车间列核对「测试车间」，剔除其他车间的行：「设备台账」2 行（催化车间 2 行）/.test(r.md || ''), '19.12 md 口径处写明剔除情况');
  ok(!/【注意】.*车间列取值/.test(r.md || ''), '19.13 有本车间行时无车间不一致【注意】');

  const LED_MIS = [['位号', '设备名称', '车间', '设备类型'], ['P-91', '外车间泵', '催化车间', '离心泵'], ['P-92', '外车间泵', '催化车间', '离心泵']];
  r = run(mk('ws-mis.xlsx', { '设备台账': LED_MIS, '巡检标准': STD_WS }), [], 'ws-mis');
  eq((r.summary.counts || {}).ledgerEquipment, 2, '19.14 车间列全不一致时不筛');
  eq((ws(r)[0] || {}).status, 'mismatch', '19.15 meta.workshopScope 状态 mismatch');
  ok(W(r).some((w) => w.startsWith('【注意】') && w.includes('催化车间')), '19.16 全不一致 warning 以【注意】开头');
  ok(/^# [^\n]*\n\n【注意】工作表「设备台账」的车间列取值与 --workshop「测试车间」不一致，未按车间筛选，请核对输入。/.test(r.md || ''), '19.17 md 标题后紧跟【注意】提示');
  ok(((r.md || '').split('## 一、')[0]).includes('【注意】'), '19.18 【注意】在正文第一节之前');

  r = run(base, [], 'ws-nocol');
  ok(ws(r).length === 2 && ws(r).every((x) => x.status === 'noColumn'), '19.19 无车间列：台账与上次巡检记录均为 noColumn');
  ok(/车间范围：输入未含车间列，车间范围以取数条件为准。/.test(r.md || ''), '19.20 无车间列时 md 口径写明以取数条件为准');
  eq((r.summary.counts || {}).ledgerEquipment, 4, '19.21 无车间列不筛');

  const LED_PLANT = [['位号', '设备名称', '维护工厂', '设备类型'], ['P-01', '泵1', '1100', '离心泵'], ['P-02', '泵2', '1200', '离心泵']];
  r = run(mkP('ws-plant.xlsx', { '设备台账': LED_PLANT, '巡检标准': STD }), [], 'ws-plant');
  eq((ws(r)[0] || {}).status, 'noColumn', '19.22 「维护工厂」不当车间列（noColumn）');
  ok((ws(r)[0] || {}).column === null && !(ws(r)[0] || {}).ignoredColumn, '19.23 「维护工厂」不读入车间字段（column 为 null，无 ignoredColumn）');
  eq((r.summary.counts || {}).ledgerEquipment, 2, '19.24 「维护工厂」列不参与筛选');
  // 人员列「车间负责人」不当车间列（common.js 只认 车间/所属车间/属地车间/运行部 及其后加「名称」）
  r = run(mk('ws-person.xlsx', JSON.parse(JSON.stringify(plantBook).split('维护工厂').join('车间负责人'))), [], 'ws-person');
  ok((ws(r)[0] || {}).status === 'noColumn' && (ws(r)[0] || {}).ignoredColumn === '车间负责人' && r.summary.ok === true, '19.27 「车间负责人」人员列判 noColumn，ignoredColumn 记下，不筛');

  // 上次巡检记录（第二张主表）混入其他车间同位号记录：不得冲掉本车间的逾期判定
  const LAST_WS = [['位号', '车间', '上次巡检日期', '结果'], ['P-01', '测试车间', back(5), '正常'], ['P-01', '催化车间', DATE, '正常'], ['P-02', '测试车间', back(8), '异常'], ['E-01', '测试车间', back(3), '正常']];
  r = run(mk('ws-last.xlsx', { '设备台账': LEDGER, '巡检标准': STD, '上次巡检记录': LAST_WS }), [], 'ws-last');
  eq((((r.tasks && r.tasks.overdue) || []).find((t) => t.tag === 'P-01') || {}).overdueDays, 4, '19.25 上次巡检记录剔除其他车间行后 P-01 仍逾期 4 天');
  ok(ws(r).some((x) => x.sheet === '上次巡检记录' && x.status === 'checked' && x.droppedRows === 1), '19.26 meta.workshopScope 含上次巡检记录核对结果');
}

// ---- 输出
console.log(`\n${'='.repeat(56)}`);
console.log(`inspection-task-dispatch 自测：${pass} 通过，${fail} 失败`);
if (failures.length) { console.log('\n失败项：'); failures.forEach((f) => console.log('  x ' + f)); }
console.log('='.repeat(56));
try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
