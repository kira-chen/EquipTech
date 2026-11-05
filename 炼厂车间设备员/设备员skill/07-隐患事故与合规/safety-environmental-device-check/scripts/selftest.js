#!/usr/bin/env node
'use strict';
/**
 * 自测：生成变体输入并断言 facility.js 行为。用法：node scripts/selftest.js（全绿退出 0）
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { writeXlsx, readXlsx } = require('./lib/xlsx-lite');

const FAC = path.join(__dirname, 'facility.js');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sedc-selftest-'));
const DATE = '2026-09-21';
const ago = (n) => new Date(Date.parse(DATE + 'T00:00:00Z') - n * 86400000).toISOString().slice(0, 10);
const after = (n) => new Date(Date.parse(DATE + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const ALERT = '【注意】存在失效或超期未检的安全环保设施，可能影响安全保护功能有效性，应立即整改并评估风险';
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
  const r = spawnSync(process.execPath, [FAC, '--input', file, '--workshop', '测试车间', '--date', DATE, '--out', out, ...extra], { encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  let summary;
  try { summary = JSON.parse(lines[lines.length - 1]); } catch (e) { summary = { ok: false, error: 'no-json:' + r.stdout + r.stderr }; }
  let data = null, md = null;
  if (fs.existsSync(path.join(out, 'facility.json'))) data = JSON.parse(fs.readFileSync(path.join(out, 'facility.json'), 'utf8'));
  if (fs.existsSync(path.join(out, 'facility.md'))) md = fs.readFileSync(path.join(out, 'facility.md'), 'utf8');
  return { code: r.status, summary, data, md, out };
}
function mk(name, book) { const p = path.join(work, name); writeXlsx(p, book); return p; }

const HEAD = ['设施类别', '设施编号', '设施名称', '安装位置', '检测项目', '检测周期', '上次检测日期', '检测结果', '当前状态', '责任人', '下次检测日期'];
let r, x;
const base = mk('base.xlsx', {
  '安全环保设施台账': [HEAD,
    ['报警器', 'GD-01', '可燃气体报警器', '机泵房', '检定', '1年', ago(400), '合格', '在用', '王工', ''],
    ['消防', 'XF-01', '手提式灭火器', '常压区', '月检', '1月', ago(25), '合格', '在用', '李工', ''],
    ['接地', 'JD-01', '塔防雷接地', '常压区', '接地电阻测试', '1年', ago(100), '合格', '在用', '赵工', ''],
  ],
});
const clean = mk('clean.xlsx', {
  '安全环保设施台账': [HEAD,
    ['消防', 'XF-10', '室外消火栓', '罐区', '季检', '1季度', ago(10), '合格', '在用', '王工', ''],
    ['接地', 'JD-10', '防静电跨接', '装车栈台', '接地电阻测试', '1年', ago(30), '合格', '在用', '李工', ''],
  ],
});
const oos = mk('oos.xlsx', {
  '安全环保设施台账': [HEAD,
    ['报警器', 'GD-20', '报警器20', '机泵房', '检定', '1年', ago(5), '合格', '故障', '王工', ''],
    ['应急器材', 'YJ-20', '洗眼器20', '加氢区', '功能检查', '1周', ago(1), '合格', '停用', '李工', ''],
    ['消防', 'XF-20', '泡沫系统20', '罐区', '年检', '1年', ago(400), '不合格', '失效', '赵工', ''],
    ['接地', 'JD-20', '接地20', '常压区', '接地电阻测试', '1年', ago(30), '合格', '在用', '孙工', ''],
  ],
});
const uf = mk('unresolved.xlsx', {
  '安全环保设施台账': [HEAD,
    ['报警器', 'GD-50', '报警器50', '机泵房', '日常功能检查', '1月', ago(3), '不合格', '在用', '王工', ''],
    ['接地', 'JD-50', '接地50', '球罐区', '接地电阻测试', '1年', ago(30), '不合格，电阻超标', '在用', '李工', ''],
    ['消防', 'XF-50', '灭火器50', '常压区', '月检', '1月', ago(3), '合格', '在用', '赵工', ''],
  ],
});
const five = mk('five.xlsx', {
  '安全环保设施台账': [HEAD,
    ['可燃气体检测报警器', 'A-1', '报警器', '机泵房', '检定', '1年', ago(10), '合格', '在用', '王', ''],
    ['消防设施', 'B-1', '消火栓', '罐区', '季检', '1季度', ago(10), '合格', '在用', '王', ''],
    ['防雷防静电接地', 'C-1', '接地', '常压区', '接地电阻测试', '1年', ago(10), '合格', '在用', '王', ''],
    ['应急器材', 'D-1', '空气呼吸器', '值班室', '月检', '1月', ago(3), '合格', '在用', '王', ''],
    ['环保设施', 'E-1', '在线监测仪', '污水场', '比对', '1季度', ago(10), '合格', '在用', '王', ''],
  ],
});
const seven = mk('seven.xlsx', {
  '安全环保设施台账': [HEAD,
    ['安全附件', 'AQ-1', '塔顶安全阀', '常压一区', '校验', '1年', ago(100), '合格', '在用', '王', ''],
    ['', 'AQ-2', '储罐爆破片', '罐区', '更换检查', '1年', ago(100), '合格', '在用', '王', ''],
    ['', 'AQ-3', '火炬线阻火器', '火炬区', '检查', '1季度', ago(10), '合格', '在用', '王', ''],
    ['', 'AQ-4', '内浮顶罐呼吸阀', '罐区', '检查', '1季度', ago(10), '合格', '在用', '王', ''],
    ['联锁', 'LS-1', '加热炉熄火联锁', '加热炉区', '功能测试记录', '半年', ago(30), '合格', '在用', '李', ''],
    ['', 'LS-2', 'SIS 紧急停车回路', '控制室', '功能测试记录', '1年', ago(30), '合格', '在用', '李', ''],
    ['', 'LS-3', '原料泵出口紧急切断阀', '泵区', '动作试验', '1季度', ago(10), '合格', '在用', '李', ''],
    ['', 'LS-4', '装置区防爆电气接线箱', '常压一区', '防爆检查', '1年', ago(30), '合格', '在用', '李', ''],
    ['', 'XF-W1', '消防水泵组', '消防泵房', '月检', '1月', ago(3), '合格', '在用', '赵', ''],
    ['', 'XF-W2', '消防稳压泵', '消防泵房', '月检', '1月', ago(3), '合格', '在用', '赵', ''],
    ['安全附件', 'AQ-5', '反应器安全阀', '加氢区', '校验', '', ago(100), '合格', '在用', '王', ''],
  ],
});
function runRaw(args) {
  const x = spawnSync(process.execPath, [FAC, ...args], { encoding: 'utf8' });
  const lines = x.stdout.trim().split('\n');
  try { return { code: x.status, s: JSON.parse(lines[lines.length - 1]) }; } catch (e) { return { code: x.status, s: { ok: false, error: 'no-json' } }; }
}

// ---- 1. 基础：超期/临期/完好三分
section('BVT', () => {
  r = run(base, [], 'base');
  eq(r.summary.ok, true, '1.1 基础运行成功');
  eq(r.summary.counts.total, 3, '1.2 设施总台数');
  eq(r.summary.counts.overdue, 1, '1.3 超期 1 台（GD-01 周期1年、上次400天前）');
  eq(r.summary.counts.dueSoon, 1, '1.4 临期 1 台（XF-01 剩余5天）');
  eq(r.summary.counts.normal, 1, '1.5 完好 1 台');
  eq(r.data.overdue[0].overdueDays, 35, '1.6 超期天数 = 400 - 365');
  eq(r.data.dueSoon[0].daysLeft, 6, '1.7 临期剩余天数（1 月按自然月：08-27 + 1 个月 = 09-27，而非 +30 天的 09-26）');
  eq(r.summary.metrics.intactRate, 66.7, '1.8 完好率 = (完好 1 + 临期 1)/3 = 66.7%（临期仍计完好，超期不计）');
  eq(r.summary.metrics.intact, 2, '1.8b 完好台数含临期');
});

// ---- 2. 醒目提示：存在失效或超期时必须写入 md 开头（出现方向）
section('A', () => {
  ok(r.md.includes(ALERT), '2.1 存在超期未检时 md 写入醒目提示');
  ok(r.md.indexOf(ALERT) < r.md.indexOf('## 一、总体概览'), '2.2 醒目提示位于第一节之前（报告开头）');
  eq(r.summary.alertNeeded, true, '2.3 summary 标记 alertNeeded');
  eq(r.data.meta.alert, ALERT, '2.4 JSON meta 保留提示原文');
});

// ---- 3. 醒目提示：无失效无超期时不出现（不出现方向）
section('A', () => {
  r = run(clean, [], 'clean');
  eq(r.summary.counts.outOfService, 0, '3.1 无失效设施');
  eq(r.summary.counts.overdue, 0, '3.2 无超期设施');
  eq(r.summary.alertNeeded, false, '3.3 alertNeeded 为 false');
  ok(!r.md.includes(ALERT), '3.4 无失效无超期时 md 不出现醒目提示');
  eq(r.summary.metrics.intactRate, 100, '3.5 完好率 100%');
});

// ---- 4. 失效/故障/停用 → outOfService 单列，无论是否在检测周期内（最关键）
section('A', () => {
  r = run(oos, [], 'oos');
  eq(r.summary.counts.outOfService, 3, '4.1 失效/故障/停用三台均归入 outOfService');
  ok(r.data.outOfService.some((x) => x.id === 'GD-20' && x.dueState === 'normal'), '4.2 在检测周期内的故障设施同样列入失效清单');
  ok(r.data.outOfService.some((x) => x.id === 'YJ-20' && x.dueState === 'dueSoon'), '4.3 尚在周期内（临期）的停用设施同样列入失效清单');
  eq(r.summary.counts.normal, 1, '4.4 失效设施不计入完好');
  eq(r.summary.counts.overdue, 0, '4.5 失效设施不重复计入超期档');
  eq(r.summary.counts.outOfServiceOverdue, 1, '4.6 失效设施中已超期 1 台单独计数');
  ok(r.data.outOfService.every((x) => x.state === 'outOfService'), '4.7 归档状态统一为 outOfService');
  ok(/## 二、失效停用设施（醒目）/.test(r.md), '4.8 失效设施单列一节且标注醒目');
  ok(/无论是否在检测周期内一律列出/.test(r.md), '4.9 报告写明失效设施一律列出的口径');
  ok(r.md.includes(ALERT), '4.10 存在失效设施时醒目提示出现');
  eq(r.summary.metrics.intactRate, 25, '4.11 完好率 = 1/4 = 25%，失效设施计入分母');
  ok(r.data.outOfService.find((x) => x.id === 'XF-20').overdueDays === 35, '4.12 失效设施仍保留超期天数供整改排期');
  // 失效优先于不合格未整改
  eq(r.summary.counts.unresolvedFail, 0, '4.13 失效且不合格的设施归入失效停用（优先级最高），不重复计入不合格未整改');
});

// ---- 5. 周期或上次检测日期缺失 → undetermined，绝不按同类设施默认周期
section('A', () => {
  const und = mk('undet.xlsx', {
    '安全环保设施台账': [HEAD,
      ['报警器', 'GD-30', '报警器30', '机泵房', '检定', '', ago(400), '合格', '在用', '王工', ''],
      ['报警器', 'GD-31', '报警器31', '机泵房', '检定', '1年', '', '合格', '在用', '李工', ''],
      ['报警器', 'GD-32', '报警器32', '机泵房', '检定', '1年', ago(400), '合格', '在用', '赵工', ''],
    ],
  });
  r = run(und, [], 'undet');
  eq(r.summary.counts.undetermined, 2, '5.1 周期缺失与日期缺失各 1 台归入待确认');
  eq(r.summary.counts.overdue, 1, '5.2 待确认项不按同类报警器 1 年周期算超期');
  ok(r.data.undetermined.some((x) => x.id === 'GD-30' && x.missing.includes('检测周期')), '5.3 缺失字段标注为检测周期');
  ok(r.data.undetermined.some((x) => x.id === 'GD-31' && x.missing.includes('上次检测日期')), '5.4 缺失字段标注为上次检测日期');
  ok(r.data.undetermined.every((x) => x.calcNext === null && x.overdueDays === null && x.daysLeft === null), '5.5 待确认项不产生计算到期日与天数');
  ok(r.data.undetermined.every((x) => x.periodDays === null || x.lastDate === null), '5.6 待确认项未被代入默认周期天数');
  ok(/## 六、待确认项/.test(r.md) && /不按同类设施默认周期推算/.test(r.md), '5.7 待确认单列一节并说明口径');
  eq(r.summary.counts.normal, 0, '5.8 待确认项不计入完好');
});

// ---- 6. 周期无法解析 → undetermined + warning，保留原文
section('C', () => {
  const badp = mk('badperiod.xlsx', {
    '安全环保设施台账': [HEAD,
      ['报警器', 'GD-40', '报警器40', '机泵房', '检定', '按厂内规定', ago(400), '合格', '在用', '王工', ''],
    ],
  });
  r = run(badp, [], 'badperiod');
  eq(r.summary.counts.undetermined, 1, '6.1 周期无法解析归入待确认');
  eq(r.data.undetermined[0].periodDays, null, '6.2 周期为 null 而非默认值');
  eq(r.data.undetermined[0].periodRaw, '按厂内规定', '6.3 保留周期原文供核实');
  ok(r.data.warnings.some((w) => w.includes('检测周期') && w.includes('无法解析')), '6.4 周期无法解析 warning');
});

// ---- 7. 检测结果不合格但无整改记录 → unresolvedFail 醒目，不计入完好
section('A', () => {
  r = run(uf, [], 'unresolved');
  eq(r.summary.counts.unresolvedFail, 2, '7.1 不合格未整改 2 台');
  eq(r.summary.counts.normal, 1, '7.2 不合格项不计入完好设施（刚检测过也不算）');
  eq(r.summary.counts.overdue, 0, '7.3 不合格项不计入超期档');
  eq(r.summary.counts.dueSoon, 0, '7.4 不合格项不计入临期档');
  ok(r.data.unresolvedFail.every((x) => x.result === 'fail'), '7.5 结果归一为 fail');
  ok(/## 四、不合格未整改清单/.test(r.md), '7.6 不合格未整改单列一节');
  eq(r.summary.metrics.intactRate, 33.3, '7.7 完好率 = 1/3，不合格项计入分母不计入分子');
  ok(r.data.warnings.some((w) => w.includes('未提供失效整改记录')), '7.8 未提供整改记录 warning');
  ok(/未提供失效整改记录/.test(r.md), '7.9 报告写明未提供整改记录');
});

// ---- 8. 整改记录：已闭环恢复到期计算，「整改中」仍算未整改
section('B', () => {
  const issues = mk('issues.xlsx', {
    '整改记录': [
      ['设施编号', '整改状态', '整改完成日期', '整改措施'],
      ['GD-50', '已整改', ago(1), '更换传感器并复检合格'],
      ['JD-50', '整改中', '', '补打接地极'],
    ],
  });
  r = run(uf, ['--issues', issues], 'issues');
  eq(r.summary.counts.unresolvedFail, 1, '8.1 已闭环项移出不合格未整改');
  eq(r.summary.counts.normal, 2, '8.2 已闭环项恢复参与到期计算并计入完好');
  eq(r.data.unresolvedFail[0].id, 'JD-50', '8.3 「整改中」不算闭环');
  ok(r.data.normal.some((x) => x.id === 'GD-50' && x.remediation), '8.4 闭环项保留整改记录');
  eq(r.data.meta.issuesProvided, true, '8.5 meta 标记已提供整改记录');
});

// ---- 9. 完好率：分母为 0 → null，显示「—」，不得写 0%
section('A', () => {
  const empty = mk('emptycat.xlsx', {
    '安全环保设施台账': [HEAD,
      ['消防', 'XF-60', '灭火器60', '常压区', '月检', '1月', ago(3), '合格', '在用', '王工', ''],
    ],
  });
  r = run(empty, ['--category', '报警器'], 'emptyfilter');
  eq(r.summary.counts.total, 0, '9.1 过滤后设施总台数为 0');
  eq(r.summary.metrics.intactRate, null, '9.2 分母为 0 时完好率为 null，不是 0');
  ok(/总体完好率：—/.test(r.md), '9.3 完好率在 md 中显示为「—」');
  ok(!/总体完好率：0\.0%/.test(r.md), '9.4 完好率未被写成 0%');
  ok(r.data.metrics.rateNote.includes('无法计算'), '9.5 注明完好率无法计算的原因');
});

// ---- 10. 完好率：存在状态无法判定的设施 → null，不得写 0%
section('A', () => {
  const noStatus = mk('nostatus.xlsx', {
    '安全环保设施台账': [HEAD,
      ['消防', 'XF-70', '灭火器70', '常压区', '月检', '1月', ago(3), '合格', '', '王工', ''],
      ['消防', 'XF-71', '灭火器71', '常压区', '月检', '1月', ago(3), '合格', '在用', '李工', ''],
    ],
  });
  r = run(noStatus, [], 'nostatus');
  eq(r.summary.metrics.intactRate, null, '10.1 存在状态无法判定的设施时完好率为 null');
  eq(r.summary.metrics.statusUnknown, 1, '10.2 状态无法判定台数计为 1');
  eq(r.summary.counts.undetermined, 1, '10.3 状态缺失的设施归入待确认');
  ok(r.data.undetermined[0].missing.includes('当前状态'), '10.4 缺失字段标注为当前状态');
  ok(/总体完好率：—/.test(r.md), '10.5 完好率显示为「—」');
  ok(/不按 0% 处理/.test(r.md), '10.6 报告写明不按 0% 处理的口径');
});

// ---- 11. 状态无法归类 → warning，不按在用处理
section('C', () => {
  const badst = mk('badstatus.xlsx', {
    '安全环保设施台账': [HEAD,
      ['消防', 'XF-80', '灭火器80', '常压区', '月检', '1月', ago(3), '合格', '待复核', '王工', ''],
    ],
  });
  r = run(badst, [], 'badstatus');
  ok(r.data.warnings.some((w) => w.includes('无法归类为在用/失效')), '11.1 状态无法归类 warning');
  eq(r.data.undetermined[0].status, null, '11.2 无法归类的状态归一为 null');
  eq(r.summary.counts.normal, 0, '11.3 状态无法归类的设施不计入完好');
});

// ---- 12. 状态与检测结果矛盾 → warning + 附节并列
section('B', () => {
  const contra = mk('contra.xlsx', {
    '安全环保设施台账': [HEAD,
      ['报警器', 'GD-90', '报警器90', '机泵房', '检定', '1年', ago(30), '不合格', '在用', '王工', ''],
      ['消防', 'XF-90', '灭火器90', '常压区', '月检', '1月', ago(3), '合格', '停用', '李工', ''],
    ],
  });
  r = run(contra, [], 'contra');
  eq(r.summary.counts.contradiction, 2, '12.1 识别出 2 处状态与结果矛盾');
  ok(r.data.warnings.some((w) => w.includes('在用但检测结果为不合格')), '12.2 在用/不合格矛盾 warning');
  ok(r.data.warnings.some((w) => w.includes('失效停用但检测结果为合格')), '12.3 失效/合格矛盾 warning');
  ok(/状态与检测结果矛盾/.test(r.md) && /不擅自采信其一/.test(r.md), '12.4 附节并列且不采信其一');
});

// ---- 13. 类别无法识别 → 归入待确认 + 分类汇总单列「未识别」
section('B', () => {
  const badcat = mk('badcat.xlsx', {
    '安全环保设施台账': [HEAD,
      ['某种装置', 'XX-01', '不明设施', '未知区', '检查', '1月', ago(3), '合格', '在用', '王工', ''],
      ['消防', 'XF-95', '灭火器95', '常压区', '月检', '1月', ago(3), '合格', '在用', '李工', ''],
    ],
  });
  r = run(badcat, [], 'badcat');
  eq(r.summary.counts.undetermined, 1, '13.1 类别无法识别归入待确认');
  ok(r.data.undetermined[0].missing.includes('设施类别'), '13.2 缺失字段含设施类别');
  ok(r.data.warnings.some((w) => w.includes('设施类别') && w.includes('无法识别')), '13.3 类别无法识别 warning');
  ok(r.data.byCategory.some((x) => x.category === '未识别'), '13.4 分类汇总含「未识别」一档');
});

// ---- 14. 五类设施识别
section('B', () => {
  r = run(five, [], 'five');
  eq(r.summary.counts.total, 5, '14.1 五类设施全部读入');
  eq(r.data.byCategory.length, 5, '14.2 分类汇总出现五个类别');
  ok(['报警器', '消防', '接地', '应急器材', '环保设施'].every((k) => r.data.byCategory.some((x) => x.category === k)), '14.3 五类归一键齐全');
  eq(r.summary.counts.undetermined, 0, '14.4 五类设施均可识别，无待确认');
  eq(r.summary.metrics.intactRate, 100, '14.5 五类均完好时完好率 100%');
  ok(r.data.byCategory.every((x) => x.intactRate === 100), '14.6 各类别完好率均为 100%');
});

// ---- 15. 分类完好率：类别内状态无法判定 → 该类 null
section('B', () => {
  const catNull = mk('catnull.xlsx', {
    '安全环保设施台账': [HEAD,
      ['消防', 'XF-A1', '灭火器', '常压区', '月检', '1月', ago(3), '合格', '', '王', ''],
      ['接地', 'JD-A1', '接地', '常压区', '接地电阻测试', '1年', ago(30), '合格', '在用', '李', ''],
    ],
  });
  r = run(catNull, [], 'catnull');
  ok(r.data.byCategory.find((x) => x.category === '消防').intactRate === null, '15.1 状态不明类别的完好率为 null');
  eq(r.data.byCategory.find((x) => x.category === '接地').intactRate, 100, '15.2 其他类别完好率正常计算');
  ok(/\| 消防 \|.*\| — \|/.test(r.md), '15.3 md 分类表中该类完好率显示「—」');
});

// ---- 16. lead-days 可调
section('B', () => {
  r = run(base, ['--lead-days', '2'], 'lead2');
  eq(r.summary.counts.dueSoon, 0, '16.1 提醒天数收窄后临期为 0');
  eq(r.summary.counts.normal, 2, '16.2 原临期项转为完好');
  r = run(base, ['--lead-days', '300'], 'lead300');
  eq(r.summary.counts.dueSoon, 2, '16.3 提醒天数放宽后临期 2 台');
});

// ---- 17. 检测计划.xlsx：按类别与时间排布
section('B', () => {
  r = run(oos, [], 'plan');
  const xl = path.join(r.out, '检测计划.xlsx');
  ok(fs.existsSync(xl), '17.1 检测计划.xlsx 已生成');
  const wb = readXlsx(xl);
  ok(!!wb['检测计划'] && !!wb['类别汇总'], '17.2 含检测计划与类别汇总两张表');
  eq(wb['检测计划'][0][0], '设施类别', '17.3 检测计划表头正确');
  eq(wb['检测计划'].length - 1, 3, '17.4 计划明细 = 失效 3 台（其余为完好）');
  ok(wb['检测计划'].some((row) => String(row[8]) === '失效停用'), '17.5 明细标注失效停用归档');
  ok(wb['检测计划'].some((row) => String(row[12]).includes('须立即整改或更换后复检')), '17.6 失效设施处置要求为立即整改');
  ok(wb['类别汇总'].some((row) => String(row[0]) === '报警器'), '17.7 类别汇总含各类别');
  const p2 = run(uf, [], 'plan2');
  const wb2 = readXlsx(path.join(p2.out, '检测计划.xlsx'));
  ok(wb2['检测计划'].some((row) => String(row[12]).includes('须先整改后复检')), '17.8 不合格未整改项要求先整改后复检');
  const p3 = run(clean, [], 'plan3');
  const wb3 = readXlsx(path.join(p3.out, '检测计划.xlsx'));
  ok(String(wb3['检测计划'][1][0]).includes('无需安排'), '17.9 无待安排项时给出占位行');
  // 同类别内按应检测日期排序
  const p4 = run(base, [], 'plan4');
  const wb4 = readXlsx(path.join(p4.out, '检测计划.xlsx'));
  eq(wb4['检测计划'].length - 1, 2, '17.10 计划明细 = 超期 1 + 临期 1');
});

// ---- 18. 台账下次检测日期与计算值不一致 → 并列 + warning
section('B', () => {
  const mism = mk('mismatch.xlsx', {
    '安全环保设施台账': [HEAD,
      ['接地', 'JD-B1', '接地B1', '火炬区', '接地电阻测试', '1年', ago(30), '合格', '在用', '王', after(500)],
    ],
  });
  r = run(mism, [], 'mismatch');
  eq(r.summary.counts.nextMismatch, 1, '18.1 识别出 1 处下次检测日期不一致');
  eq(r.data.normal[0].nextMismatch.ledger, after(500), '18.2 保留台账登记值');
  eq(r.data.normal[0].nextMismatch.calc, after(335), '18.3 保留按周期计算值');
  ok(r.data.warnings.some((w) => w.includes('不一致')), '18.4 不一致 warning');
  ok(/台账下次检测日期与计算值不一致/.test(r.md), '18.5 报告并列展示');
});

// ---- 19. 设施编号重复 → warning + 附节
section('B', () => {
  const dup = mk('dup.xlsx', {
    '安全环保设施台账': [HEAD,
      ['消防', 'XF-SAME', '灭火器1', '常压区', '月检', '1月', ago(3), '合格', '在用', '王', ''],
      ['消防', 'XF-SAME', '灭火器2', '常压区', '月检', '1月', ago(3), '合格', '在用', '李', ''],
    ],
  });
  r = run(dup, [], 'dup');
  eq(r.summary.counts.dupIds, 1, '19.1 识别出 1 组重复设施编号');
  ok(r.data.warnings.some((w) => w.includes('重复出现') && w.includes('XF-SAME')), '19.2 重复编号 warning');
  ok(/设施编号重复/.test(r.md), '19.3 报告含编号重复附节');
});

// ---- 20. 合计行跳过 + 标题行表头识别 + 别名列头 + 空编号
section('B', () => {
  const exp = mk('export.xlsx', {
    '安全环保设施台账': [
      ['某厂安全环保设施台账导出'],
      [],
      ['类别', '位号', '名称', '区域', '检测内容', '维护周期', '检查日期', '检查结果', '设施状态', '负责人'],
      ['可燃气体报警器', 'GD-C1', '报警器C1', '加氢区', '检定', '1年', ago(400), '合格', '在用', '王'],
      ['灭火器', 'XF-C1', '灭火器C1', '加氢区', '月检', '1月', ago(3), '合格', '在用', '李'],
      ['', '', '无编号记录', '加氢区', '月检', '1月', ago(3), '合格', '在用', ''],
      ['合计', '', '', '', '', '', '', '', '', ''],
    ],
  });
  r = run(exp, [], 'export');
  eq(r.summary.ok, true, '20.1 导出风格表可读');
  eq(r.summary.counts.total, 2, '20.2 合计行与空编号行均被跳过');
  ok(r.data.warnings.some((w) => w.includes('合计行')), '20.3 合计行 warning');
  ok(r.data.warnings.some((w) => w.includes('设施编号为空')), '20.4 空编号 warning');
  eq(r.data.overdue[0].id, 'GD-C1', '20.5 别名列头下判定正确');
  eq(r.data.overdue[0].category, '报警器', '20.6 别名类别名仍可归类');
});

// ---- 21. 检测结果无法归类 → warning，不按合格处理
section('C', () => {
  const badr = mk('badresult.xlsx', {
    '安全环保设施台账': [HEAD,
      ['消防', 'XF-D1', '灭火器D1', '常压区', '月检', '1月', ago(3), '待出报告', '在用', '王', ''],
    ],
  });
  r = run(badr, [], 'badresult');
  ok(r.data.warnings.some((w) => w.includes('无法归类为合格/不合格')), '21.1 结果无法归类 warning');
  eq(r.data.normal[0].result, null, '21.2 无法归类的结果归一为 null');
});

// ---- 22. 缺列 → warning 且不中断
section('B', () => {
  const lack = mk('lackcol.xlsx', {
    '安全环保设施台账': [
      ['设施编号', '设施名称', '上次检测日期', '当前状态'],
      ['XF-E1', '灭火器E1', ago(3), '在用'],
    ],
  });
  r = run(lack, [], 'lackcol');
  eq(r.summary.ok, true, '22.1 缺检测周期列不中断');
  ok(r.data.warnings.some((w) => w.includes('缺少列')), '22.2 缺列 warning');
  eq(r.summary.counts.undetermined, 1, '22.3 缺周期列的记录归入待确认');
  eq(r.summary.metrics.intactRate, 0, '22.4 状态可判定但无完好设施时完好率为 0%（有效计算结果，非缺数据）');
});

// ---- 23. 缺唯一数据源工作表 → ok:false + exit 1
section('B', () => {
  const bad = mk('bad.xlsx', { '随便一张表': [['a', 'b'], [1, 2]] });
  r = run(bad, [], 'bad');
  eq(r.summary.ok, false, '23.1 无设施台账工作表时 ok:false');
  eq(r.code, 1, '23.2 退出码为 1');
  ok(/未在输入中找到/.test(r.summary.error), '23.3 错误信息明确');
});

// ---- 24. 参数校验
section('B', () => {
  x = runRaw(['--input']);
  eq(x.s.ok, false, '24.1 --input 缺值报错');
  ok(/缺少取值/.test(x.s.error), '24.2 缺值错误信息正确');
  x = runRaw(['--input', base, '--workshop', '车间', '--date', '2026-13-45']);
  eq(x.s.ok, false, '24.3 非法日期报错');
  x = runRaw(['--input', base, '--workshop', '车间', '--date', DATE, '--未知参数', 'x']);
  eq(x.s.ok, false, '24.4 未知参数报错');
  x = runRaw(['--input', '/不存在的路径.xlsx', '--workshop', '车间', '--date', DATE]);
  eq(x.s.ok, false, '24.5 输入不存在报错');
  eq(x.code, 1, '24.6 输入不存在退出码 1');
  x = runRaw(['--input', base, '--workshop', '车间', '--date', DATE, '--lead-days', 'abc']);
  eq(x.s.ok, false, '24.7 非法 lead-days 报错');
  x = runRaw(['--input', base, '--workshop', '车间']);
  eq(x.s.ok, false, '24.8 缺 --date 报错');
  x = runRaw(['--input', base, '--date', DATE]);
  eq(x.s.ok, false, '24.9 缺 --workshop 报错');
  x = runRaw(['--input', base, '--workshop', '车间', '--date', DATE, '--issues', '/不存在.xlsx']);
  eq(x.s.ok, false, '24.10 整改记录不存在报错');
  x = runRaw(['--input', base, '--workshop', '车间', '--date', DATE, '--reports', '/不存在的目录']);
  eq(x.s.ok, false, '24.11 检测报告目录不存在报错');
});

// ---- 25. --category 过滤
section('B', () => {
  r = run(five, ['--category', '消防'], 'catfilter');
  eq(r.summary.counts.total, 1, '25.1 按类别过滤后仅保留消防设施');
  eq(r.data.normal[0].id, 'B-1', '25.2 过滤后编号正确');
  eq(r.data.meta.category, '消防', '25.3 meta 记录筛选类别');
});

// ---- 26. 产出结构完整性与分析段占位
section('BVT', () => {
  r = run(oos, [], 'struct');
  ok(fs.existsSync(path.join(r.out, 'summary.json')), '26.1 summary.json 已写入');
  eq(JSON.parse(fs.readFileSync(path.join(r.out, 'summary.json'), 'utf8')).ok, true, '26.2 summary.json 内容正确');
  ok(fs.existsSync(path.join(r.out, 'facility.json')), '26.3 facility.json 已写入');
  ok(fs.existsSync(path.join(r.out, 'facility.md')), '26.4 facility.md 已写入');
  ok(/## 一、总体概览与完好率/.test(r.md) && /## 二、失效停用设施（醒目）/.test(r.md) && /## 三、超期未检清单/.test(r.md)
    && /## 四、不合格未整改清单/.test(r.md) && /## 五、临期清单/.test(r.md) && /## 六、待确认项/.test(r.md)
    && /## 七、分类完好率/.test(r.md) && /## 八、检测计划安排/.test(r.md) && /## 九、安全环保设施状态说明/.test(r.md), '26.5 九节结构齐全');
  ok(/<!-- ANALYSIS_START -->/.test(r.md) && /<!-- ANALYSIS_END -->/.test(r.md), '26.6 分析段占位符存在');
  ok(['outOfService', 'unresolvedFail', 'overdue', 'dueSoon', 'normal', 'undetermined', 'byCategory', 'metrics', 'counts', 'plan']
    .every((k) => k in r.data), '26.7 facility.json 键齐全');
  ok(/不得给出「暂不影响使用」的意见/.test(r.md), '26.8 分析段占位写明禁止「暂不影响使用」的表述');
  ok(!/暂不影响使用/.test(r.md.replace(/<!-- ANALYSIS_START -->[\s\S]*?<!-- ANALYSIS_END -->/, '')), '26.10 占位段之外不出现「暂不影响使用」');
  ok(r.data.meta.generatedAt && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(r.data.meta.generatedAt), '26.9 生成时间为北京时间格式');
});

// ---- 27. 中石化口径：自然月折算 / 新增两类设施 / SAP-EM 列名 / 声明行与归口说明 / 无 emoji
section('A', () => {
  const nm = mk('natmonth.xlsx', {
    '安全环保设施台账': [HEAD,
      ['消防', 'XF-M1', '灭火器M1', '常压区', '月检', '1月', '2026-08-31', '合格', '在用', '王', ''],          // 08-31 + 1 个月 = 09-30（月末钳制），+30 天 = 09-30 也相同 → 用下一行区分
      ['消防', 'XF-M2', '灭火器M2', '常压区', '月检', '1月', '2026-01-31', '合格', '在用', '王', ''],          // 01-31 + 1 个月 = 02-28；+30 天 = 03-02
      ['消防', 'XF-Q1', '消火栓Q1', '罐区', '季检', '1季度', '2026-06-30', '合格', '在用', '王', ''],          // 06-30 + 3 个月 = 09-30（剩 9 天）；+90 天 = 09-28
      ['接地', 'JD-H1', '接地H1', '常压区', '接地电阻测试', '半年', '2026-03-31', '合格', '在用', '王', ''],    // 03-31 + 6 个月 = 09-30（剩 9 天）；+182 天 = 09-29
      ['报警器', 'GD-Y1', '报警器Y1', '机泵房', '检定', '1年', '2025-02-28', '合格', '在用', '王', ''],        // 2025-02-28 + 12 个月 = 2026-02-28
      ['应急器材', 'YJ-W1', '洗眼器W1', '加氢区', '功能检查', '2周', ago(10), '合格', '在用', '王', ''],       // 周 → 按天
    ],
  });
  r = run(nm, [], 'natmonth');
  const byIdNm = Object.fromEntries([...r.data.overdue, ...r.data.dueSoon, ...r.data.normal].map((x) => [x.id, x]));
  eq(byIdNm['XF-M2'].calcNext, '2026-02-28', '27.1 月检按自然月：01-31 + 1 个月 = 02-28（非 +30 天的 03-02）');
  eq(byIdNm['XF-M2'].calcMode, 'months', '27.2 月周期 calcMode 记为 months');
  eq(byIdNm['XF-Q1'].calcNext, '2026-09-30', '27.3 季检按自然月：06-30 + 3 个月 = 09-30（非 +90 天的 09-28）');
  eq(byIdNm['XF-Q1'].daysLeft, 9, '27.4 季检剩余天数按自然月计算');
  eq(byIdNm['JD-H1'].calcNext, '2026-09-30', '27.5 半年按 6 个自然月：03-31 → 09-30（非 +182 天的 09-29）');
  eq(byIdNm['GD-Y1'].calcNext, '2026-02-28', '27.6 年检按 12 个自然月');
  eq(byIdNm['GD-Y1'].periodMonths, 12, '27.7 年检 periodMonths = 12');
  eq(byIdNm['YJ-W1'].calcMode, 'days', '27.8 周周期按天折算（calcMode = days）');
  eq(byIdNm['YJ-W1'].calcNext, after(4), '27.9 2 周 = 14 天：10 天前 + 14 天');
  ok(/按自然月折算/.test(r.md) && /不代入任何默认周期/.test(r.md), '27.10 md 写明自然月折算与不代入默认周期');
  eq(r.data.meta.periodRule, '月/季/年/半年按自然月折算（C.addMonths），天/周/小时按天折算', '27.11 meta.periodRule 记录折算规则');
});

// 新增两类：安全附件 / 联锁与防爆；消防水系统归消防
section('B', () => {
  r = run(seven, [], 'seven');
  eq(r.summary.ok, true, '27.12 新增两类设施台账可读');
  const catOf = (id) => [...r.data.normal, ...r.data.dueSoon, ...r.data.overdue, ...r.data.undetermined].find((x) => x.id === id).category;
  ok(['AQ-1', 'AQ-2', 'AQ-3', 'AQ-4'].every((id) => catOf(id) === '安全附件'), '27.13 安全阀/爆破片/阻火器/呼吸阀归入「安全附件」');
  ok(['LS-1', 'LS-2', 'LS-3', 'LS-4'].every((id) => catOf(id) === '联锁与防爆'), '27.14 联锁/SIS/紧急切断阀/防爆电气归入「联锁与防爆」');
  ok(['XF-W1', 'XF-W2'].every((id) => catOf(id) === '消防'), '27.15 消防水泵/稳压泵归入「消防」');
  ok(r.data.byCategory.some((x) => x.category === '安全附件') && r.data.byCategory.some((x) => x.category === '联锁与防爆'), '27.16 分类汇总出现两个新类别');
  eq(r.summary.counts.undetermined, 1, '27.17 安全附件周期为空 → 待确认（不代入安全阀校验默认周期）');
  ok(r.data.undetermined[0].id === 'AQ-5' && r.data.undetermined[0].periodDays === null, '27.18 安全阀无周期时 periodDays 为 null，安全阀校验用 valve-instrument-calibration-ledger');
  r = run(seven, ['--category', '安全附件'], 'seven-aq');
  eq(r.summary.counts.total, 5, '27.19 --category 安全附件 过滤生效');
  r = run(seven, ['--category', '联锁与防爆'], 'seven-ls');
  eq(r.summary.counts.total, 4, '27.20 --category 联锁与防爆 过滤生效');
});

// SAP / EM / 特种设备台账导出列名（经 C.mergeAliases 合并）
section('A', () => {
  const em = mk('em-export.xlsx', {
    '安全环保设施台账': [
      ['功能位置', '设备描述', '装置', '设备类型', '检验类型', '检验周期', '检验日期', '检验结论', '用户状态', '属地专责', '下次检验日期'],
      ['E101-PSV-001', '塔顶安全阀', '常减压', '安全附件', '校验', '1年', ago(100), '合格', '在用', '王', ''],
      ['E101-GD-001', '机泵房可燃气体报警器', '常减压', '报警器', '检定', '1年', ago(400), '合格', '在用', '李', ''],
      ['E101-XF-001', '罐区泡沫系统', '常减压', '消防', '年检', '1年', ago(30), '合格', '停用', '赵', ''],
    ],
  });
  r = run(em, [], 'em');
  eq(r.summary.ok, true, '27.21 SAP/EM 风格列名（功能位置/设备描述/装置/检验类型…）可读');
  eq(r.summary.counts.total, 3, '27.22 三条记录全部读入');
  ok(r.data.overdue.some((x) => x.id === 'E101-GD-001' && x.location === '常减压' && x.name === '机泵房可燃气体报警器'), '27.23 功能位置→设施编号、设备描述→名称、装置→安装位置');
  ok(r.data.normal.some((x) => x.id === 'E101-PSV-001' && x.checkItem === '校验' && x.category === '安全附件'), '27.24 检验类型→检测项目，设备类型→设施类别');
  ok(r.data.outOfService.some((x) => x.id === 'E101-XF-001'), '27.25 用户状态「停用」→ 失效停用');
  ok(!r.data.warnings.some((w) => w.includes('缺少列')), '27.26 系统导出列名下无缺列 warning');
});

// 声明行、归口说明、标题、无 emoji
section('A', () => {
  r = run(oos, [], 'statement');
  ok(r.md.includes('本材料由脚本汇总、模型成文，仅供设备员复核参考，不替代审批、定性、验收与签字；厂内制度与系统数据为准。'), '27.27 md 末尾含通用声明行');
  eq(r.data.meta.statement, '本材料由脚本汇总、模型成文，仅供设备员复核参考，不替代审批、定性、验收与签字；厂内制度与系统数据为准。', '27.28 meta.statement 写入声明行');
});
section('C', () => {
  ok(/special-equipment-inspection-due/.test(r.md) && /仪表专业/.test(r.md), '27.29 md 写明特种设备本体定检归 special-equipment-inspection-due、SIS 功能测试归仪表');
  ok(/安全阀校验[^。；]{0,12}valve-instrument-calibration-ledger/.test(r.md), '27.29b md 写明安全阀校验用 valve-instrument-calibration-ledger');
  ok(!/安全阀[^。；]{0,20}归 special-equipment-inspection-due/.test(r.md), '27.29c md 不再写安全阀校验归 special-equipment-inspection-due');
  ok(/压力表、温度计检定归计量（仪表）专业/.test(r.md), '27.29d md 写明压力表、温度计检定归计量（仪表）专业');
  ok(/valve-instrument-calibration-ledger/.test(r.data.meta.scopeNote) && /计量（仪表）/.test(r.data.meta.scopeNote), '27.29e meta.scopeNote 归口与 md 一致');
  ok(/安全环保设施状态检查（基准日/.test(r.md.split('\n')[0]), '27.30 md 标题为「安全环保设施状态检查」');
  ok(!/[⚠✅❌✔✗]/.test(r.md), '27.31 产出 md 不含 emoji');
  ok(/【注意】存在失效或超期未检/.test(r.md), '27.32 醒目提示以「【注意】」开头');
  ok(/未超期（含临期）/.test(r.md), '27.33 完好口径写明「未超期（含临期）」');
  r = run(clean, [], 'statement-clean');
  ok(!/【注意】/.test(r.md), '27.34 无失效无超期时 md 不出现「【注意】」');
  ok(r.md.includes('本材料由脚本汇总、模型成文'), '27.35 无告警时声明行仍保留');
});
// 默认输出目录为系统临时目录（不写入输入文件同目录）
section('B', () => {
  {
    const x = spawnSync(process.execPath, [FAC, '--input', clean, '--workshop', '车间', '--date', DATE], { encoding: 'utf8' });
    const lines = x.stdout.trim().split('\n');
    let s; try { s = JSON.parse(lines[lines.length - 1]); } catch (e) { s = { ok: false }; }
    ok(s.ok === true && String(s.out).startsWith(os.tmpdir()), '27.36 未传 --out 时默认写入系统临时目录');
    ok(!fs.existsSync(path.join(path.dirname(clean), 'sedc-out')), '27.37 未在输入文件同目录生成 sedc-out');
  }
});

// ---- 28. SKILL.md 同步项：标题术语、七类齐全、旧术语不出现、SAP 设备编号与功能位置并存时优先功能位置
section('C', () => {
  ok(!/专项管理/.test(r.md), '28.1 md 不再出现旧名「安全环保设施专项管理」');
  ok(!/EAM|机动处/.test(r.md), '28.2 md 不含 EAM/机动处 旧称');
  const sevenRun = run(seven, [], 'seven-all');
  const allCats = ['报警器', '安全附件', '联锁与防爆', '消防', '接地', '应急器材', '环保设施'];
  const fiveRun = run(five, [], 'five-again');
  ok(allCats.filter((k) => fiveRun.data.byCategory.some((x) => x.category === k)).length === 5, '28.4 five 样例命中五个经典类别');
  ok(allCats.filter((k) => sevenRun.data.byCategory.some((x) => x.category === k)).length === 3, '28.5 seven 样例命中安全附件、联锁与防爆、消防三类，七类合计可覆盖');
});
section('B', () => {
  const both = mk('both.xlsx', {
    '安全环保设施台账': [
      ['功能位置', '设备编号', '设备描述', '设备类型', '检验周期', '检验日期', '检验结论', '用户状态'],
      ['E301-GD-001', '10034567', '报警器', '报警器', '1年', ago(30), '合格', '在用'],
    ],
  });
  r = run(both, [], 'both');
  eq(r.data.normal[0].id, 'E301-GD-001', '28.6 功能位置与 SAP 设备编号并存时，设施编号取功能位置（局部别名靠前）');
});

// ---- 29. 整改记录跨表配对：整改完成日期早于本次检测日期的旧记录，不能闭环本次不合格
section('B', () => {
  const uf29 = mk('uf29.xlsx', {
    '安全环保设施台账': [HEAD,
      ['报警器', 'GD-60', '可燃气体报警器', '机泵房', '检定', '1年', ago(10), '不合格', '在用', '王工', ''],   // 10 天前检测不合格
      ['报警器', 'GD-61', '可燃气体报警器', '机泵房', '检定', '1年', ago(30), '不合格', '在用', '王工', ''],   // 30 天前检测不合格
      ['接地', 'JD-60', '塔防雷接地', '常压区', '接地电阻测试', '1年', ago(40), '不合格', '在用', '赵工', ''],
    ],
  });
  const iss29 = mk('iss29.xlsx', {
    '整改记录': [
      ['设施编号', '整改状态', '整改完成日期', '整改措施'],
      ['GD-60', '已整改', ago(200), '上一轮不合格的整改（早于本次检测）'],
      ['GD-61', '已整改', ago(5), '更换传感器后复检合格'],
      ['JD-60', '已整改', ago(100), '旧记录'],
      ['JD-60', '已整改', ago(20), '补打接地极后复测合格'],
    ],
  });
  r = run(uf29, ['--issues', iss29], 'pair29');
  ok(r.data.unresolvedFail.some((x) => x.id === 'GD-60'), '29.1 整改完成日期早于本次检测日期 → 不能闭环本次不合格，仍为不合格未整改');
  ok(r.data.warnings.some((w) => w.includes('GD-60') && /早于/.test(w)), '29.2 旧整改记录不配对时 warning 说明原因');
  ok(!r.data.unresolvedFail.some((x) => x.id === 'GD-61'), '29.3 整改完成日期晚于检测日期的记录正常闭环');
  ok(!r.data.unresolvedFail.some((x) => x.id === 'JD-60'), '29.4 同一设施多条整改记录时取最近一条（晚于检测日期）闭环');
  eq(r.summary.counts.unresolvedFail, 1, '29.5 不合格未整改只剩 GD-60');
});

// ---- 30. 车间范围核对（D007）：设施台账带车间列时按 --workshop 核对
{
  const sc = (i) => ((r.data && r.data.meta.workshopScope) || [])[i] || {};
  const row = (id, last, ws) => ['报警器', id, '可燃气体报警器' + id, '机泵房', '检定', '1年', last, '合格', '在用', '王工', '', ws];
  section('A', () => {
    const wsMix = mk('ws-mix.xlsx', { '安全环保设施台账': [[...HEAD, '车间'],
      row('GD-A1', ago(400), '测试车间'), row('GD-A2', ago(100), '测试'), row('GD-B1', ago(400), '焦化车间'), row('GD-B2', ago(500), '焦化车间'), row('GD-C1', ago(100), ''),
    ] });
    r = run(wsMix, [], 'ws-mix');
    eq(r.summary.counts.total, 3, '30.1 混合输入只统计本车间与车间为空的行（剔除焦化车间 2 行）');
    eq(r.summary.counts.overdue, 1, '30.2 超期只含本车间设施（焦化车间 2 台超期不计）');
    ok(!(r.data.overdue || []).some((x) => /^GD-B/.test(x.id)), '30.3 其他车间设施不进超期清单');
    ok((r.data.normal || []).some((x) => x.id === 'GD-C1'), '30.4 车间列为空的行按本车间保留');
    ok(r.data.warnings.some((w) => /剔除其他车间 2 行/.test(w) && w.includes('焦化车间 2 行')), '30.5 warning 写明剔除行数与车间名');
    ok(r.data.warnings.some((w) => /车间列为空 1 行/.test(w)), '30.6 warning 写明车间为空行数');
    eq(sc(0).status, 'checked', '30.7 meta.workshopScope 记录已核对');
    eq(sc(0).droppedRows, 2, '30.8 meta.workshopScope 记录剔除行数');
    eq((sc(0).dropped || {})['焦化车间'], 2, '30.9 meta.workshopScope 按车间记录剔除');
    ok(/车间范围：已按车间列核对「测试车间」/.test(r.md || ''), '30.10 md 口径处写明按车间核对与剔除');
    const wsBad = mk('ws-bad.xlsx', { '安全环保设施台账': [[...HEAD, '车间'], row('GD-D1', ago(400), '焦化车间'), row('GD-D2', ago(100), '催化车间')] });
    r = run(wsBad, [], 'ws-bad');
    eq(r.summary.counts.total, 2, '30.11 车间列全不一致时不筛');
    ok(r.data.warnings.some((w) => w.startsWith('【注意】') && /未按车间筛选/.test(w)), '30.12 warning 以【注意】开头');
    eq(sc(0).status, 'mismatch', '30.13 meta.workshopScope 记录不一致');
    const ai = (r.md || '').indexOf('的车间列取值与 --workshop「测试车间」不一致，未按车间筛选');
    ok(ai > 0 && ai < r.md.indexOf('## 一、总体概览') && r.md.slice(0, ai).includes('【注意】'), '30.14 md 开头（第一节之前）有【注意】提示');
  });
  section('B', () => {
    r = run(base, [], 'ws-none');
    eq(sc(0).status, 'noColumn', '30.15 无车间列 status 为 noColumn');
    ok((r.md || '').includes('输入未含车间列，车间范围以取数条件为准'), '30.16 md 口径处说明无车间列');
    const wsPlant = mk('ws-plant.xlsx', { '安全环保设施台账': [[...HEAD, '维护工厂'], row('GD-E1', ago(100), '1100'), row('GD-E2', ago(100), '1200')] });
    r = run(wsPlant, [], 'ws-plant');
    eq(sc(0).status, 'noColumn', '30.17 「维护工厂」列不当车间列（noColumn）');
    eq(r.summary.counts.total, 2, '30.18 「维护工厂」列不触发筛选');
  });
}

// ---- 输出
console.log(`\n${'='.repeat(56)}`);
console.log(`safety-environmental-device-check 自测：${pass} 通过，${fail} 失败`);
console.log(`用例级别 ${LEVELS[RUN_LEVEL]}：BVT ${byLevel.BVT}，A ${byLevel.A}，B ${byLevel.B}，C ${byLevel.C}`);
if (failures.length) { console.log('\n失败项：'); failures.forEach((f) => console.log('  ✗ ' + f)); }
console.log('='.repeat(56));
try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
