#!/usr/bin/env node
'use strict';
/**
 * 自测：生成变体输入并断言 hazard.js 行为。用法：node scripts/selftest.js（全绿退出 0）
 * 重点覆盖：已整改无验收不计闭环、等级缺失 undetermined、重大隐患提示的出现与不出现、
 *          闭环率分母为 0、编号重复、状态与验收矛盾。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { writeXlsx } = require('./lib/xlsx-lite');
const C = require('./lib/common');

const HAZARD = path.join(__dirname, 'hazard.js');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'hct-selftest-'));
const DATE = '2026-09-21';
const D = (n) => C.addDays(DATE, n);
let pass = 0, fail = 0;
const failures = [];

function ok(cond, name) { if (cond) { pass++; } else { fail++; failures.push(name); } }
function eq(actual, expect, name) { ok(actual === expect, `${name}（期望 ${JSON.stringify(expect)}，实际 ${JSON.stringify(actual)}）`); }

const H = ['隐患编号', '隐患描述', '等级', '来源', '发现日期', '责任人', '责任单位', '要求整改期限', '整改措施', '整改状态', '验收情况', '验收人', '验收日期'];

function run(file, extra = [], tag) {
  const out = path.join(work, (tag || path.basename(file, '.xlsx')) + '-out');
  const r = spawnSync(process.execPath, [HAZARD, '--input', file, '--workshop', '测试车间', '--date', DATE, '--out', out, ...extra], { encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  let summary;
  try { summary = JSON.parse(lines[lines.length - 1]); } catch (e) { summary = { ok: false, error: 'no-json:' + r.stdout + r.stderr }; }
  let hz = null, md = null, push = null;
  if (fs.existsSync(path.join(out, 'hazard.json'))) hz = JSON.parse(fs.readFileSync(path.join(out, 'hazard.json'), 'utf8'));
  if (fs.existsSync(path.join(out, 'hazard.md'))) md = fs.readFileSync(path.join(out, 'hazard.md'), 'utf8');
  if (fs.existsSync(path.join(out, '督办清单.md'))) push = fs.readFileSync(path.join(out, '督办清单.md'), 'utf8');
  return { code: r.status, summary, hz, md, push, out };
}
function mk(name, book) { const p = path.join(work, name); writeXlsx(p, book); return p; }

// ================= 1. 基础归桶 =================
const base = mk('base.xlsx', {
  '隐患台账': [
    H,
    ['YH-001', '法兰渗漏', '一般隐患', '日常巡检', D(-60), '王', '一车间', D(-10), '换垫片', '未整改', '', '', ''],          // overdue
    ['YH-002', '护栏锈蚀', '一般隐患', '自查', D(-20), '王', '一车间', D(3), '补焊', '整改中', '', '', ''],                  // dueSoon
    ['YH-003', '洗眼器压力低', '一般隐患', '自查', D(-5), '李', '一车间', D(25), '调阀', '整改中', '', '', ''],              // inProgress
    ['YH-004', '照明缺失', '一般隐患', '日常巡检', D(-50), '李', '一车间', D(-30), '补灯', '已整改', '验收合格', '刘工', D(-28)], // closed
  ],
});
let r = run(base, [], 'base');
eq(r.summary.ok, true, '1.1 基础运行成功');
eq(r.summary.counts.total, 4, '1.2 隐患总数');
eq(r.summary.counts.overdue, 1, '1.3 超期未整改数');
eq(r.summary.counts.dueSoon, 1, '1.4 临期数');
eq(r.summary.counts.inProgress, 1, '1.5 整改中数');
eq(r.summary.counts.closed, 1, '1.6 闭环数');
eq(r.hz.overdue[0].overdueDays, 10, '1.7 超期天数计算正确');
ok(r.hz.overdue[0].owner === '王', '1.8 超期项带责任人');
eq(r.summary.metrics.closureRate, 25, '1.9 闭环率 1/4 = 25%');

// ================= 2. 已整改无验收 → unverified，绝不计闭环（本技能最关键判定）=================
const unv = mk('unverified.xlsx', {
  '隐患台账': [
    H,
    ['YH-101', '通道占用', '一般隐患', '自查', D(-30), '王', '一车间', D(-10), '清空', '已整改', '', '', ''],            // 验收全空
    ['YH-102', '盖板缺失', '一般隐患', '日常巡检', D(-30), '王', '一车间', D(-8), '补盖板', '已整改', '待验收', '', ''],  // 明确未验收
    ['YH-103', '接地断开', '一般隐患', '各级检查', D(-40), '李', '一车间', D(-20), '压接', '已整改', '合格', '陈工', D(-18)], // 真闭环
  ],
});
r = run(unv, [], 'unverified');
eq(r.summary.counts.unverified, 2, '2.1 已整改无验收记为 unverified 2 项');
eq(r.summary.counts.closed, 1, '2.2 仅 1 项计入已闭环');
eq(r.summary.counts.overdue, 0, '2.3 已整改未验收不重复计入超期');
eq(r.summary.metrics.closureRate, 33.3, '2.4 闭环率分母含未验收项（1/3）');
ok(!r.hz.closed.some((x) => x.no === 'YH-101' || x.no === 'YH-102'), '2.5 未验收项未混入 closed 数组');
ok(r.hz.unverified.every((x) => /无验收记录/.test(x.unverifiedReason || '')), '2.6 unverified 注明不计闭环的原因');
ok(/不计入已闭环/.test(r.md), '2.7 md 明示「不计入已闭环」');
ok(/## 五、已整改未验收/.test(r.md), '2.8 已整改未验收单列成节');
ok(/YH-101/.test(r.push) && /安排验收销号/.test(r.push), '2.9 未验收项进入督办清单');
// 仅填验收人（无验收情况文字）也算有验收记录
const unv2 = mk('unverified2.xlsx', {
  '隐患台账': [H, ['YH-111', '某项', '一般隐患', '自查', D(-30), '王', '一车间', D(-5), '措施', '已整改', '', '刘工', '']],
});
r = run(unv2, [], 'unverified2');
eq(r.summary.counts.closed, 1, '2.10 仅填验收人也构成验收记录');

// ================= 3. 等级缺失 → undetermined，绝不按最宽松时限 =================
const nolv = mk('nolevel.xlsx', {
  '隐患台账': [
    H,
    ['YH-201', '仪表风微漏', '', '日常巡检', D(-90), '孙', '一车间', '', '紧固', '未整改', '', '', ''],        // 等级空 + 无期限
    ['YH-202', '某隐患', '特急级', '自查', D(-90), '孙', '一车间', '', '措施', '未整改', '', '', ''],          // 等级无法归类
    ['YH-203', '正常一般隐患', '一般隐患', '自查', D(-90), '孙', '一车间', D(-10), '措施', '未整改', '', '', ''],   // 对照：台账有期限 → overdue
    ['YH-204', '无期限一般隐患', '一般隐患', '自查', D(-90), '孙', '一车间', '', '措施', '未整改', '', '', ''],     // 一般隐患无期限：无统一天数 → undetermined
  ],
});
r = run(nolv, [], 'nolevel');
eq(r.summary.counts.undetermined, 3, '3.1 等级缺失、无法归类、一般隐患无期限均 undetermined（无 30 天默认）');
eq(r.summary.counts.overdue, 1, '3.2 只有台账给了期限的项按期限判超期');
ok(!r.hz.overdue.some((x) => x.no === 'YH-204'), '3.2b 一般隐患无期限不按任何默认天数推成超期');
ok(!r.hz.overdue.some((x) => x.no === 'YH-201' || x.no === 'YH-202'), '3.3 未判定项不在超期清单中');
ok(r.hz.undetermined.some((x) => x.no === 'YH-201' && /等级缺失/.test(x.reason)), '3.4 未判定原因指明缺等级字段');
ok(r.hz.undetermined.some((x) => x.no === 'YH-202' && /无法归类/.test(x.reason)), '3.5 等级无法归类原因正确');
ok(r.hz.undetermined.every((x) => x.deadline === null), '3.6 未判定项未被推定期限');
ok(r.hz.warnings.some((w) => w.includes('特急级') && w.includes('无法归类')), '3.7 等级无法归类有 warning');
ok(/## 六、未判定项/.test(r.md) && /未按最宽松时限处理/.test(r.md), '3.8 未判定单列成节并声明不放宽');
// 重大隐患无方案期限 → undetermined，不按一般隐患 30 天处理
const majNoDl = mk('major-nodl.xlsx', {
  '隐患台账': [H, ['YH-211', '消防系统失效', '重大隐患', '各级检查', D(-90), '张', '一车间', '', '改造', '未整改', '', '', '']],
});
r = run(majNoDl, [], 'major-nodl');
eq(r.summary.counts.undetermined, 1, '3.9 重大隐患无方案期限 → undetermined');
eq(r.summary.counts.overdue, 0, '3.10 重大隐患未按一般时限推成超期');
ok(/方案期限未知/.test(r.hz.undetermined[0].reason), '3.11 重大隐患未判定原因正确');

// ================= 4. 重大隐患提示：出现与不出现 =================
const maj = mk('major.xlsx', {
  '隐患台账': [
    H,
    ['YH-301', '联锁被旁路', '重大隐患', '各级检查', D(-60), '张', '一车间', D(-40), '恢复联锁', '已整改', '验收通过', '刘工', D(-36)], // 重大且已闭环
    ['YH-302', '照明缺失', '一般隐患', '自查', D(-50), '李', '一车间', D(-30), '补灯', '已整改', '合格', '刘工', D(-28)],
  ],
});
r = run(maj, [], 'major');
eq(r.summary.counts.major, 1, '4.1 重大隐患计数');
eq(r.summary.counts.overdue, 0, '4.2 本例无超期项');
ok(/【注意】\*\*重点提示\*\*/.test(r.md), '4.3 重大隐患时开头出现醒目提示（【注意】，不用 emoji）');
ok(/上报分厂\/公司安全部门并挂牌督办/.test(r.md), '4.3b 重大隐患提示含「上报分厂/公司安全部门并挂牌督办」');
ok(!/[⚠✅]/.test(r.md) && !/[⚠✅]/.test(r.push), '4.3c 两份 md 均不含 emoji');
ok(/存在重大隐患 1 项/.test(r.md), '4.4 提示写明重大隐患数量');
ok(r.md.indexOf('重点提示') < r.md.indexOf('## 一、总体概览'), '4.5 提示位于报告开头（第一节之前）');
ok(/## 二、重大隐患专列/.test(r.md) && /YH-301/.test(r.md.split('## 三')[0]), '4.6 重大隐患即便已闭环仍单独成节列出');
ok(/重点提示/.test(r.push), '4.7 督办清单同样带重大隐患提示');
// 不出现：无重大隐患、无超期
const clean = mk('clean.xlsx', {
  '隐患台账': [
    H,
    ['YH-401', '踏步防滑条脱落', '一般隐患', '日常巡检', D(-50), '赵', '一车间', D(-30), '重铺', '已整改', '验收合格', '刘工', D(-27)],
    ['YH-402', '应急照明失效', '一般隐患', '自查', D(-10), '赵', '一车间', D(20), '换电池', '整改中', '', '', ''],
  ],
});
r = run(clean, [], 'clean');
eq(r.summary.counts.major, 0, '4.8 无重大隐患');
eq(r.summary.counts.overdue, 0, '4.9 无超期项');
ok(!/重点提示/.test(r.md), '4.10 无重大隐患无超期时不出现告警提示');
ok(/本期无重大隐患，亦无超期未整改项/.test(r.md), '4.11 改为无告警说明');
ok(/本期统计范围内无重大隐患/.test(r.md), '4.12 重大隐患节写明「无」');
// 仅超期无重大 → 也要提示
const onlyOverdue = mk('only-overdue.xlsx', {
  '隐患台账': [H, ['YH-501', '某项', '一般隐患', '自查', D(-60), '赵', '一车间', D(-7), '措施', '未整改', '', '', '']],
});
r = run(onlyOverdue, [], 'only-overdue');
ok(/重点提示/.test(r.md) && /超期未整改隐患 1 项/.test(r.md), '4.13 仅有超期项时同样开头提示');
ok(!/存在重大隐患/.test(r.md), '4.14 无重大隐患时不虚报重大隐患提示');

// ================= 5. 闭环率分母为 0 → null，显示「—」，不得写 0% =================
const zero = mk('zero.xlsx', {
  '隐患台账': [H, ['YH-601', '某项', '一般隐患', '自查', D(-10), '赵', '一车间', D(20), '措施', '整改中', '', '', '']],
});
r = run(zero, ['--level', '重大'], 'zero');
eq(r.summary.ok, true, '5.1 筛选后无记录仍正常产出');
eq(r.summary.counts.total, 0, '5.2 筛选后总数为 0');
eq(r.summary.metrics.closureRate, null, '5.3 分母为 0 时闭环率为 null');
ok(/闭环率：\*\*—\*\*/.test(r.md), '5.4 md 中闭环率显示「—」');
ok(!/闭环率：\*\*0\.0%\*\*/.test(r.md), '5.5 分母为 0 时绝不写 0%');
ok(/不计算闭环率/.test(r.md), '5.6 md 说明无隐患不计算闭环率');
eq(r.summary.metrics.avgClosureDays, null, '5.7 无闭环项时平均闭环时长为 null');
ok(/平均闭环时长：\*\*—\*\*/.test(r.md), '5.8 平均闭环时长显示「—」而非 0');

// ================= 6. 编号重复 =================
const dup = mk('dup.xlsx', {
  '隐患台账': [
    H,
    ['YH-701', '电缆桥架封堵不严', '一般隐患', '各级检查', D(-40), '周', '二车间', D(-3), '封堵', '整改中', '', '', ''],
    ['YH-701', '另一处电缆沟封堵不严', '一般隐患', '各级检查', D(-40), '周', '二车间', D(-3), '封堵', '整改中', '', '', ''],
  ],
});
r = run(dup, [], 'dup');
eq(r.summary.counts.total, 2, '6.1 编号重复的两条均保留');
ok(r.hz.warnings.some((w) => w.includes('YH-701') && w.includes('重复')), '6.2 编号重复有 warning');
ok(r.hz.warnings.some((w) => /第\d+行/.test(w) && w.includes('重复')), '6.3 重复 warning 具体到行号');
eq(r.summary.counts.overdue, 2, '6.4 重复编号两条各自判定');

// ================= 7. 状态与验收矛盾 → warning 单列 =================
const cft = mk('conflict.xlsx', {
  '隐患台账': [
    H,
    ['YH-801', '盖板破损', '一般隐患', '自查', D(-20), '周', '二车间', D(10), '换盖板', '未整改', '', '刘工', D(-2)],   // 未整改却有验收
    ['YH-802', '某项', '一般隐患', '自查', D(-20), '周', '二车间', D(10), '措施', '整改中', '验收合格', '', ''],        // 整改中却已验收
    ['YH-803', '正常项', '一般隐患', '自查', D(-10), '周', '二车间', D(20), '措施', '整改中', '', '', ''],
  ],
});
r = run(cft, [], 'conflict');
eq(r.summary.counts.conflicts, 2, '7.1 状态与验收矛盾计 2 项');
ok(r.hz.conflicts.every((x) => x.conflict && /矛盾|但已填写验收记录/.test(x.conflict)), '7.2 矛盾说明写明具体情况');
ok(r.hz.warnings.some((w) => w.includes('状态与验收矛盾')), '7.3 矛盾产生 warning');
ok(/## 七、状态与验收矛盾/.test(r.md) && /脚本未作任何取舍/.test(r.md), '7.4 矛盾单列成节且声明不取舍');
eq(r.summary.counts.closed, 0, '7.5 状态非「已整改」的矛盾项不计入闭环');
ok(/YH-801/.test(r.push), '7.6 矛盾项进入督办清单');

// ================= 8. 等级别名：一级/A 级等是管理层级，不直接映射 → undetermined；--rules「等级映射」可声明 =================
const alias = mk('alias.xlsx', {
  '隐患台账': [
    H,
    ['YH-901', '危废间未设围堰', 'A级', '各级检查', D(-30), '周', '二车间', D(-1), '砌围堰', '整改中', '', '', ''],
    ['YH-902', '封堵不严', 'B级', '各级检查', D(-30), '周', '二车间', D(-1), '封堵', '整改中', '', '', ''],
    ['YH-903', '标识脱落', '一级', '自查', D(-30), '周', '二车间', D(-1), '补标识', '整改中', '', '', ''],
    ['YH-904', '围堰破损', '重大隐患', '集团督查', D(-30), '周', '二车间', D(-1), '修补', '整改中', '', '', ''],
  ],
});
r = run(alias, [], 'alias');
eq(r.summary.counts.major, 1, '8.1 只有「重大」字样识别为重大隐患，A 级不直接映射');
eq(r.hz.metrics.byLevel.unknown.total, 3, '8.2 A 级 / B 级 / 一级 均记为「等级无法识别」，不映射为重大或一般');
eq(r.hz.metrics.byLevel.general.total, 0, '8.3 B 级未被当作一般隐患统计');
ok(r.hz.items.filter((x) => x.level === 'unknown').every((x) => x.levelCn === '等级无法识别'), '8.3b 层级写法项等级栏显示「等级无法识别」');
ok(r.hz.warnings.some((w) => w.includes('A级') && w.includes('管理层级')), '8.4 层级写法 warning 指明疑似管理层级并提示 --rules 等级映射');
ok(!r.hz.majorHazards.some((x) => x.no === 'YH-901'), '8.5 A 级项未进重大隐患专列（不触发重大隐患提示）');
ok(r.hz.overdue.some((x) => x.no === 'YH-901' && x.deadlineBasis === '台账「要求整改期限」'), '8.5b 等级无法识别但台账有期限时，仍按台账期限判超期（期限判定不依赖等级）');
// 无台账期限 + 层级写法 → undetermined（不按一般隐患推）
const aliasNoDl = mk('alias-nodl.xlsx', { '隐患台账': [H, ['YH-905', '某项', 'A级', '自查', D(-30), '周', '二车间', '', '措施', '整改中', '', '', '']] });
r = run(aliasNoDl, [], 'alias-nodl');
eq(r.summary.counts.undetermined, 1, '8.5c 层级写法且无台账期限 → undetermined');
ok(/无法归类，整改时限无法确定/.test(r.hz.undetermined[0].reason), '8.5d 未判定原因写明等级无法归类');
// --rules 等级映射：厂内声明 A 级=重大、B 级/一级=一般 后才映射
const lvMap = mk('levelmap.xlsx', {
  '等级映射': [['原始等级', '归类'], ['A级', '重大隐患'], ['B级', '一般隐患'], ['一级', '一般'], ['C级', '不明']],
});
r = run(alias, ['--rules', lvMap], 'alias-map');
eq(r.summary.counts.major, 2, '8.6 等级映射后 A 级识别为重大隐患');
eq(r.summary.counts.undetermined, 0, '8.7 等级映射后 B 级/一级归一般，无未判定');
eq(r.summary.counts.overdue, 4, '8.8 映射后四项按台账期限判超期');
ok(r.hz.warnings.some((w) => w.includes('等级映射') && w.includes('不明')), '8.9 映射表归类非重大/一般的行被忽略并 warning');
ok(/厂内口径/.test(r.hz.meta.rulesSource), '8.10 仅给等级映射也标注厂内口径');
eq(r.hz.metrics.bySource['集团督查'], 1, '8.11 metrics.bySource 按来源分布（集团督查）');
ok(/\*\*按来源分布\*\*/.test(r.md) && /集团督查/.test(r.md), '8.12 md 含按来源分布表');

// ================= 9. 别名列头 + 标题行 + 合计行 =================
const messy = mk('messy.xlsx', {
  '隐患排查治理台账': [
    ['某某炼化厂 隐患排查治理台账（导出）'],
    [],
    ['编号', '隐患内容', '隐患等级', '隐患来源', '发现时间', '整改责任人', '责任部门', '整改期限', '措施', '整改情况', '验收结论', '验收人', '验收时间'],
    ['YH-A01', '某隐患', '一般', '自查', D(-20), '周', '二车间', D(-5), '措施', '未整改', '', '', ''],
    ['YH-A02', '另一隐患', '一般', '自查', D(-20), '周', '二车间', D(15), '措施', '整改中', '', '', ''],
    ['合计', '2 条', '', '', '', '', '', '', '', '', '', '', ''],
  ],
});
r = run(messy, [], 'messy');
eq(r.summary.ok, true, '9.1 别名列头 + 标题行可读');
eq(r.summary.counts.total, 2, '9.2 合计行被跳过');
ok(r.hz.warnings.some((w) => w.includes('合计行')), '9.3 合计行 warning');
eq(r.summary.counts.overdue, 1, '9.4 别名表判定正确');

// ================= 10. 缺列 → warning 不中断 =================
const nocol = mk('nocol.xlsx', {
  '隐患台账': [
    ['隐患编号', '隐患描述', '整改状态'],
    ['YH-B01', '某隐患', '未整改'],
    ['YH-B02', '另一隐患', '已整改'],
  ],
});
r = run(nocol, [], 'nocol');
eq(r.summary.ok, true, '10.1 缺可选列不中断');
eq(r.summary.counts.undetermined, 1, '10.2 无等级无期限 → 未判定');
eq(r.summary.counts.unverified, 1, '10.3 无验收列的「已整改」仍判 unverified');
eq(r.summary.counts.closed, 0, '10.4 缺验收列绝不默认闭环');

// ================= 11. --rules 覆盖默认时限口径 =================
const rulesFile = mk('rules.xlsx', {
  '整改时限': [['等级名称', '整改时限'], ['重大隐患', '60天'], ['一般隐患', '15天']],
});
const rulesFile2 = mk('rules2.xlsx', {
  '整改时限': [['等级名称', '时限天数'], ['一般隐患', '2周']],
});
const ruleSrc = mk('rulesrc.xlsx', {
  '隐患台账': [H, ['YH-C01', '某隐患', '一般隐患', '自查', D(-20), '周', '二车间', '', '措施', '未整改', '', '', '']],
});
r = run(ruleSrc, [], 'rules-default');
eq(r.summary.counts.undetermined, 1, '11.1 无厂内口径且台账无期限时该项 undetermined（一般隐患无统一天数）');
ok(/无统一整改天数/.test(run(ruleSrc, [], 'rules-reason').hz.undetermined[0].reason), '11.1b 未判定原因写明一般隐患无统一整改天数');
r = run(ruleSrc, ['--rules', rulesFile], 'rules-override');
eq(r.summary.counts.overdue, 1, '11.2 厂内口径 15 天后该项超期');
ok(/厂内口径/.test(r.hz.meta.rulesSource), '11.3 产出标注采用厂内口径');
ok(/非厂内正式口径/.test(run(ruleSrc, [], 'rules-note').md), '11.4 默认口径在报告中注明非厂内正式口径');
r = run(ruleSrc, ['--rules', rulesFile2], 'rules-week');
eq(r.summary.counts.overdue, 1, '11.5 「时限天数」列名 + 「2周」写法可解析（parsePeriod）并判超期');
eq(r.hz.metrics.rules.general, 14, '11.6 2 周折算 14 天');

// ================= 12. 参数校验 =================
function runRaw(args) {
  const rr = spawnSync(process.execPath, [HAZARD, ...args], { encoding: 'utf8' });
  const lines = rr.stdout.trim().split('\n');
  try { return { code: rr.status, s: JSON.parse(lines[lines.length - 1]) }; } catch (e) { return { code: rr.status, s: { ok: false, error: 'no-json' } }; }
}
let x = runRaw(['--input']);
eq(x.s.ok, false, '12.1 --input 缺值报错');
eq(x.code, 1, '12.2 退出码为 1');
ok(/缺少取值/.test(x.s.error), '12.3 缺值错误信息正确');
x = runRaw(['--input', base, '--workshop', '车间', '--date', '2026-13-45']);
eq(x.s.ok, false, '12.4 非法日期报错');
x = runRaw(['--input', base, '--workshop', '车间', '--date', DATE, '--未知参数', 'x']);
eq(x.s.ok, false, '12.5 未知参数报错');
x = runRaw(['--input', '/不存在的台账.xlsx', '--workshop', '车间', '--date', DATE]);
eq(x.s.ok, false, '12.6 输入不存在报错');
x = runRaw(['--input', base, '--workshop', '车间']);
eq(x.s.ok, false, '12.7 缺 --date 报错');
x = runRaw(['--input', base, '--workshop', '车间', '--date', DATE, '--from', D(10)]);
eq(x.s.ok, false, '12.8 --from 晚于 --date 报错');
x = runRaw(['--input', base, '--workshop', '车间', '--date', DATE, '--level', '中等']);
eq(x.s.ok, false, '12.9 --level 取值非法报错');

// ================= 13. 无隐患台账工作表 → ok:false =================
const bad = mk('bad.xlsx', { '随便一张表': [['a', 'b'], [1, 2]] });
r = run(bad, [], 'bad');
eq(r.summary.ok, false, '13.1 无隐患台账工作表时 ok:false');
eq(r.code, 1, '13.2 退出码为 1');
ok(/未在输入中找到/.test(r.summary.error), '13.3 错误信息明确');

// ================= 14. 督办清单按责任人分组 =================
const grp = mk('group.xlsx', {
  '隐患台账': [
    H,
    ['YH-D01', '甲的隐患一', '一般隐患', '自查', D(-60), '甲', '一车间', D(-10), '措施', '未整改', '', '', ''],
    ['YH-D02', '甲的隐患二', '一般隐患', '自查', D(-60), '甲', '一车间', D(-5), '措施', '未整改', '', '', ''],
    ['YH-D03', '乙的隐患', '重大隐患', '各级检查', D(-60), '乙', '一车间', D(-3), '措施', '整改中', '', '', ''],
    ['YH-D04', '无责任人的隐患', '一般隐患', '自查', D(-60), '', '一车间', D(-2), '措施', '未整改', '', '', ''],
  ],
});
r = run(grp, [], 'group');
ok(/## 甲（2 项）/.test(r.push), '14.1 按责任人分组且标注项数');
ok(/## 乙（1 项，含重大隐患 1 项）/.test(r.push), '14.2 分组标题标注重大隐患数');
ok(/## （未填责任人）/.test(r.push), '14.3 未填责任人单独成组');
ok(r.push.indexOf('## 甲') < r.push.indexOf('## （未填责任人）'), '14.4 未填责任人组排在最后');
ok(/督办事项合计 \*\*4\*\* 项/.test(r.push), '14.5 督办事项合计数正确');
ok(/隐患认定、等级与整改验收以安全部门意见为准/.test(r.push), '14.6 督办清单保留声明行');

// ================= 15. 声明行、章节、占位符、summary.json =================
r = run(base, [], 'struct');
ok(/隐患认定、等级与整改验收以安全部门意见为准/.test(r.md), '15.1 md 保留声明行');
ok(/## 一、总体概览/.test(r.md) && /## 二、重大隐患专列/.test(r.md) && /## 三、超期未整改清单/.test(r.md)
  && /## 四、临期清单/.test(r.md) && /## 五、已整改未验收/.test(r.md) && /## 六、未判定项/.test(r.md)
  && /## 七、状态与验收矛盾/.test(r.md) && /## 八、五定不全/.test(r.md) && /## 九、闭环指标/.test(r.md) && /## 十、隐患整改情况说明/.test(r.md),
  '15.2 十节结构齐全');
ok(/本材料由脚本汇总、模型成文，仅供设备员复核参考/.test(r.md) && /本材料由脚本汇总、模型成文/.test(r.push), '15.2b 两份 md 含通用声明行');
ok(/无统一天数，以整改方案\/台账期限为准/.test(r.md), '15.2c 时限口径行写明一般隐患无统一天数');
ok(!/30 天/.test(r.md) && !/一般隐患：未定义/.test(r.md), '15.2d md 不再出现一般隐患 30 天或「未定义」');
ok(/<!-- ANALYSIS_START -->/.test(r.md) && /<!-- ANALYSIS_END -->/.test(r.md), '15.3 分析段占位符存在');
ok(fs.existsSync(path.join(r.out, 'summary.json')), '15.4 summary.json 已写入');
ok(fs.existsSync(path.join(r.out, 'hazard.json')), '15.5 hazard.json 已写入');
ok(fs.existsSync(path.join(r.out, '督办清单.md')), '15.6 督办清单.md 已写入');
const sj = JSON.parse(fs.readFileSync(path.join(r.out, 'summary.json'), 'utf8'));
eq(sj.ok, true, '15.7 summary.json 内容正确');
ok(typeof sj.counts.total === 'number' && typeof sj.metrics.closureRate !== 'undefined', '15.8 summary.json 含 counts 与 metrics');

// ================= 16. --from / --owner 过滤与上期对比 =================
r = run(base, ['--from', D(-30)], 'from');
eq(r.summary.counts.total, 2, '16.1 --from 按发现日期过滤');
r = run(base, ['--owner', '王'], 'owner');
eq(r.summary.counts.total, 2, '16.2 --owner 过滤');
const prevPath = path.join(run(base, [], 'prev-src').out, 'hazard.json');
r = run(unv, ['--prev', prevPath], 'trend');
ok(r.hz.trend && typeof r.hz.trend.totalDelta === 'number', '16.3 上期对比输出 totalDelta');
ok(/与上期对比/.test(r.md) && !/未提供上期/.test(r.md.split('## 九')[0].split('**与上期对比**')[1]), '16.4 有上期时输出对比表');
r = run(base, [], 'notrend');
ok(/未提供上期 hazard.json/.test(r.md), '16.5 无上期时说明不做对比');

// ================= 17. 空编号与空行 =================
const blank = mk('blank.xlsx', {
  '隐患台账': [
    H,
    ['', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['', '无编号的隐患', '一般隐患', '自查', D(-60), '甲', '一车间', D(-5), '措施', '未整改', '', '', ''],
    ['YH-E01', '正常隐患', '一般隐患', '自查', D(-10), '甲', '一车间', D(20), '措施', '整改中', '', '', ''],
  ],
});
r = run(blank, [], 'blank');
eq(r.summary.counts.total, 2, '17.1 全空行跳过，无编号但有描述的行保留');
ok(r.hz.warnings.some((w) => w.includes('隐患编号为空')), '17.2 空编号有 warning');
ok(r.hz.items.some((x) => /无编号/.test(x.no)), '17.3 空编号项以行号标识');

// ================= 18. 五定核对：整改资金 / 应急措施 列、五定不全单列、重大隐患五定不全进督办 =================
const H5 = ['隐患编号', '隐患描述', '隐患等级', '检查类型', '检查日期', '整改责任人', '属地单位', '整改期限', '整改方案', '整改资金', '应急管控措施', '整改情况', '验收结论', '验收人', '验收日期'];
const five = mk('five.xlsx', {
  '隐患台账': [
    H5,
    ['YH-F01', '五定齐全', '一般隐患', 'HSE 审核', D(-20), '甲', '一车间', D(10), '更换', '5000 元', '加强巡检', '整改中', '', '', ''],
    ['YH-F02', '缺资金与应急', '重大隐患', '政府督查', D(-20), '甲', '一车间', D(10), '改造', '', '', '整改中', '', '', ''],
    ['YH-F03', '缺责任人与期限', '一般隐患', '第三方诊断', D(-20), '', '一车间', '', '修补', '1 万', '隔离', '未整改', '', '', ''],
    ['YH-F04', '已闭环不核五定', '一般隐患', '集团督查', D(-40), '乙', '一车间', D(-20), '', '', '', '已整改', '合格', '刘工', D(-18)],
  ],
});
r = run(five, [], 'five');
eq(r.summary.ok, true, '18.1 含整改资金/应急措施的系统导出列名可读（检查类型/属地单位/整改方案/应急管控措施）');
eq(r.summary.counts.fiveFixedIncomplete, 2, '18.2 五定不全 2 项（已闭环项不核对，五定齐全项不列）');
ok(r.hz.fiveFixedIncomplete.find((x) => x.no === 'YH-F02').missing.join('、') === '资金、应急措施', '18.3 缺项准确列出：资金、应急措施');
ok(r.hz.fiveFixedIncomplete.find((x) => x.no === 'YH-F03').missing.includes('责任人') && r.hz.fiveFixedIncomplete.find((x) => x.no === 'YH-F03').missing.includes('期限'), '18.4 缺责任人与期限被列出');
ok(!r.hz.fiveFixedIncomplete.some((x) => x.no === 'YH-F01' || x.no === 'YH-F04'), '18.5 五定齐全项与已闭环项不进五定不全');
ok(r.hz.fiveFixedIncomplete[0].no === 'YH-F02', '18.6 重大隐患排在五定不全首位');
ok(/## 八、五定不全/.test(r.md) && /脚本不补填任何一项/.test(r.md) && /资金、应急措施/.test(r.md), '18.7 五定不全单列成节并声明不补填');
ok(/重大隐患五定不全（缺：资金、应急措施）/.test(r.push), '18.8 重大隐患五定不全进督办清单');
ok(!/YH-F03[^\n]*五定不全/.test(r.push), '18.9 一般隐患五定不全不单独进督办（避免噪声）');
eq(r.hz.items.find((x) => x.no === 'YH-F01').fund, '5000 元', '18.10 整改资金原文保留');
eq(r.hz.items.find((x) => x.no === 'YH-F01').emergency, '加强巡检', '18.11 应急措施原文保留');
eq(r.hz.metrics.bySource['政府督查'], 1, '18.12 来源「政府督查」计入分布');
ok(!r.hz.warnings.some((w) => w.includes('无「整改资金」列')), '18.13 有资金列时不报缺列');
// 无资金/应急列 → warning 一次、全部未闭环项按缺项处理
r = run(base, [], 'five-nocol');
ok(r.hz.warnings.some((w) => w.includes('无「整改资金」列')) && r.hz.warnings.some((w) => w.includes('无「应急措施」列')), '18.14 台账无资金/应急措施列时 warning 提示补列');
eq(r.summary.counts.fiveFixedIncomplete, 3, '18.15 无该两列时未闭环 3 项均列五定不全，已闭环 1 项不列');
ok(r.hz.fiveFixedIncomplete.every((x) => x.missing.includes('资金') && x.missing.includes('应急措施')), '18.16 缺列按未落实处理，不按已落实默认');
ok(/五定不全（未闭环项）/.test(r.md), '18.17 总览表含五定不全计数');
ok(/<!-- ANALYSIS_START -->[\s\S]*五定不全项[\s\S]*<!-- ANALYSIS_END -->/.test(r.md), '18.18 说明段结构提示含五定不全项');

// ================= 19. 验收未通过不计闭环；五定占位符按未落实；编号重复计数 =================
const neg = mk('neg.xlsx', {
  '隐患台账': [
    H5,
    // 已整改，验收不合格但填了验收人/日期 → 验收未通过，不得计闭环
    ['YH-N01', '验收不合格', '一般隐患', '自查', D(-30), '甲', '一车间', D(-5), '更换', '车间费用', '加强巡检', '已整改', '不合格', '刘工', D(-2)],
    // 已整改，待验收但已指定验收人 → 不得计闭环
    ['YH-N02', '待验收已指定验收人', '一般隐患', '自查', D(-30), '甲', '一车间', D(-5), '更换', '车间费用', '加强巡检', '已整改', '待验收', '刘工', ''],
    // 整改中，资金/应急措施填「—」「无」占位 → 五定按未落实
    ['YH-N03', '五定占位符', '一般隐患', '自查', D(-10), '乙', '一车间', D(20), '修补', '—', '无', '整改中', '', '', ''],
    // 编号为空但有描述：不是编号重复
    ['', '无编号有描述', '一般隐患', '自查', D(-10), '乙', '一车间', D(20), '修补', '车间费用', '隔离', '整改中', '', '', ''],
    ['YH-N04', '正常已闭环', '一般隐患', '自查', D(-30), '甲', '一车间', D(-5), '更换', '车间费用', '加强巡检', '已整改', '合格', '刘工', D(-3)],
  ],
});
r = run(neg, [], 'neg');
eq(r.hz.items.find((x) => x.no === 'YH-N01').bucket, 'unverified', '19.1 验收情况「不合格」即使填了验收人/日期也不计闭环（归已整改未验收）');
eq(r.hz.items.find((x) => x.no === 'YH-N02').bucket, 'unverified', '19.2 验收情况「待验收」仅指定了验收人不计闭环');
eq(r.summary.counts.closed, 1, '19.3 闭环只有验收合格的 1 项');
ok(r.hz.items.find((x) => x.no === 'YH-N03').fiveFixedMissing.join('、') === '资金、应急措施', '19.4 资金「—」、应急措施「无」按未落实列入五定缺项');
eq(r.summary.counts.duplicateNo, 0, '19.5 编号为空的条目不计入编号重复');

// ================= 20. 督办清单分组：责任人「待定 / 无 / —」等占位写法归入未填责任人组 =================
const grpPh = mk('group-placeholder.xlsx', {
  '隐患台账': [
    H,
    ['YH-G01', '栏杆缺失', '一般隐患', '自查', D(-60), '待定', '一车间', D(-10), '措施', '整改中', '', '', ''],
    ['YH-G02', '盖板缺失', '一般隐患', '自查', D(-60), '', '一车间', D(-10), '措施', '整改中', '', '', ''],
    ['YH-G03', '标识缺失', '一般隐患', '自查', D(-60), '—', '一车间', D(-10), '措施', '整改中', '', '', ''],
    ['YH-G04', '照明缺失', '一般隐患', '自查', D(-60), '丙', '一车间', D(-10), '措施', '整改中', '', '', ''],
  ],
});
r = run(grpPh, [], 'group-placeholder');
ok(!/## 待定（/.test(r.push) && !/## —（/.test(r.push), '20.1 「待定」「—」不被当成人名单独成组');
ok(/## （未填责任人）（3 项）/.test(r.push), '20.2 「待定」「—」与空白一起归入未填责任人组');
ok(/## 丙（1 项）/.test(r.push), '20.3 真实责任人照常分组');

// ================= 21. 整改状态否定写法：「未完成 / 部分完成 / 尚未整改完」不算已整改 =================
const negSt = mk('status-negation.xlsx', {
  '隐患台账': [
    H,
    ['YH-N01', '栏杆缺失', '一般隐患', '自查', D(-60), '甲', '一车间', D(-10), '措施', '未完成', '', '', ''],
    ['YH-N02', '盖板缺失', '一般隐患', '自查', D(-60), '乙', '一车间', D(-10), '措施', '部分完成', '', '', ''],
    ['YH-N03', '标识缺失', '一般隐患', '自查', D(-60), '丙', '一车间', D(-10), '措施', '尚未整改完', '', '', ''],
    ['YH-N04', '照明缺失', '一般隐患', '自查', D(-60), '丁', '一车间', D(-10), '措施', '已完成', '合格', '丁', D(-12)],
  ],
});
r = run(negSt, [], 'status-negation');
eq(r.summary.counts.overdue, 3, '21.1 「未完成」「部分完成」「尚未整改完」过期后计入超期');
ok(!r.hz.overdue.some((x) => x.no === 'YH-N04'), '21.2 「已完成」且验收合格的不进超期');
ok(r.hz.overdue.some((x) => x.no === 'YH-N02'), '21.3 「部分完成」按整改中，不按已整改');
const negSt2 = mk('status-negation2.xlsx', {
  '隐患台账': [
    H,
    ['YH-M01', '栏杆缺失', '一般隐患', '自查', D(-60), '甲', '一车间', D(-10), '措施', '已整改未销号', '', '', ''],
    ['YH-M02', '盖板缺失', '一般隐患', '自查', D(-60), '乙', '一车间', D(-10), '措施', '已完成整改，未闭环', '', '', ''],
    ['YH-M03', '标识缺失', '一般隐患', '自查', D(-60), '丙', '一车间', D(-10), '措施', '不符合项整改完成', '', '', ''],
    ['YH-M04', '照明缺失', '一般隐患', '自查', D(-60), '丁', '一车间', D(-10), '措施', '整改未完成', '', '', ''],
    ['YH-M05', '护栏缺失', '一般隐患', '自查', D(-60), '戊', '一车间', D(-10), '措施', '暂未完成', '', '', ''],
  ],
});
r = run(negSt2, [], 'status-negation2');
ok(['YH-M01', 'YH-M02', 'YH-M03'].every((n) => !r.hz.overdue.some((x) => x.no === n)), '21.4 「已整改未销号」「已完成整改，未闭环」「不符合项整改完成」按已整改（交验收判定），不计超期');
eq(r.hz.overdue.map((x) => x.no).sort().join(','), 'YH-M04,YH-M05', '21.5 「整改未完成」「暂未完成」计超期');

// ================= 22. 车间范围核对（D007）：按「车间」列核对，责任单位不核对 =================
{
  const sc = (i) => ((r.hz && r.hz.meta.workshopScope) || [])[i] || {};
  const row = (no, unit, deadline, st, ws) => [no, '隐患' + no, '一般隐患', '自查', D(-40), '王', unit, deadline, '整改', st, '', '', '', ws];
  // 22.1~22.12 责任单位 + 车间两列：车间列归车间，责任单位照常取值、不参与核对
  const wsMix = mk('ws-mix.xlsx', { '隐患台账': [[...H, '车间'],
    row('YH-W1', '储运车间', D(-10), '未整改', '测试车间'),
    row('YH-W2', '维修班', D(20), '整改中', '测试'),
    row('YH-W3', '测试车间', D(-15), '未整改', '催化车间'),
    row('YH-W4', '测试车间', D(-20), '未整改', '催化车间'),
    row('YH-W5', '电气班', D(20), '整改中', ''),
  ] });
  r = run(wsMix, [], 'ws-mix');
  eq(r.summary.counts.total, 3, '22.1 混合输入只统计本车间与车间为空的行（剔除催化车间 2 行）');
  eq(r.summary.counts.overdue, 1, '22.2 超期只含本车间隐患（催化车间 2 项超期不计）');
  ok(!r.hz.items.some((x) => x.no === 'YH-W3' || x.no === 'YH-W4'), '22.3 其他车间隐患不进清单（责任单位写本车间也不保留）');
  ok(r.hz.items.some((x) => x.no === 'YH-W5'), '22.4 车间列为空的行按本车间保留');
  const w1 = r.hz.items.find((x) => x.no === 'YH-W1');
  eq(w1 && w1.unit, '储运车间', '22.5 责任单位列照常取值、不被车间列顶替，也不参与核对（责任单位写储运车间仍保留）');
  eq(sc(0).column, '车间', '22.6 真正的「车间」列归车间字段');
  ok(r.hz.warnings.some((w) => /剔除其他车间 2 行/.test(w) && w.includes('催化车间 2 行')), '22.7 warning 写明剔除行数与车间名');
  ok(r.hz.warnings.some((w) => /车间列为空 1 行/.test(w)), '22.8 warning 写明车间为空行数');
  eq(sc(0).status, 'checked', '22.9 meta.workshopScope 记录已核对');
  eq(sc(0).droppedRows, 2, '22.10 meta.workshopScope 记录剔除行数');
  eq((sc(0).dropped || {})['催化车间'], 2, '22.11 meta.workshopScope 按车间记录剔除');
  ok(/车间范围：已按车间列核对「测试车间」/.test(r.md || ''), '22.12 md 口径处写明按车间核对与剔除');
  // 22.13~22.17 车间列全不一致：不筛，warning 与 md、督办清单开头【注意】
  const wsBad = mk('ws-bad.xlsx', { '隐患台账': [[...H, '车间'], row('YH-B1', '测试车间', D(-10), '未整改', '催化车间'), row('YH-B2', '测试车间', D(20), '整改中', '焦化车间')] });
  r = run(wsBad, [], 'ws-bad');
  eq(r.summary.counts.total, 2, '22.13 车间列全不一致时不筛');
  ok(r.hz.warnings.some((w) => w.startsWith('【注意】') && /未按车间筛选/.test(w)), '22.14 warning 以【注意】开头');
  eq(sc(0).status, 'mismatch', '22.15 meta.workshopScope 记录不一致');
  const ai = (r.md || '').indexOf('【注意】工作表「隐患台账」的车间列取值与 --workshop「测试车间」不一致');
  ok(ai > 0 && ai < r.md.indexOf('## 一、总体概览'), '22.16 md 开头（第一节之前）有【注意】提示');
  ok((r.push || '').includes('【注意】工作表「隐患台账」的车间列取值'), '22.17 督办清单开头同样提示');
  // 22.18~22.19 无车间列（只有责任单位，且写的是别的车间）：不筛、不当车间列
  const unitOnly = mk('ws-unit-only.xlsx', { '隐患台账': [H,
    ['YH-U1', '法兰渗漏', '一般隐患', '自查', D(-40), '王', '催化车间', D(-10), '换垫片', '未整改', '', '', ''],
    ['YH-U2', '护栏锈蚀', '一般隐患', '自查', D(-40), '王', '焦化车间', D(20), '补焊', '整改中', '', '', ''],
  ] });
  r = run(unitOnly, [], 'ws-unit-only');
  eq(sc(0).status, 'noColumn', '22.18 只有责任单位列时不核对（status 为 noColumn）');
  ok(r.summary.counts.total === 2 && (r.md || '').includes('输入未含车间列，车间范围以取数条件为准'), '22.19 责任单位不当车间列，不筛，md 口径说明无车间列');
  // 22.20~22.21 「维护工厂」列不当车间列
  const wsPlant = mk('ws-plant.xlsx', { '隐患台账': [[...H, '维护工厂'], row('YH-P1', '测试车间', D(20), '整改中', '1100'), row('YH-P2', '测试车间', D(20), '整改中', '1200')] });
  r = run(wsPlant, [], 'ws-plant');
  eq(sc(0).status, 'noColumn', '22.20 「维护工厂」列不当车间列（noColumn）');
  eq(r.summary.counts.total, 2, '22.21 「维护工厂」列不触发筛选');
  // 22.22~22.24 只有车间列、没有责任单位列：按车间核对，责任单位沿用车间列的值（与改动前一致）
  const H3 = H.map((h) => (h === '责任单位' ? '车间' : h));
  const wsOnly = mk('ws-only.xlsx', { '隐患台账': [H3,
    ['YH-O1', '法兰渗漏', '一般隐患', '自查', D(-40), '王', '测试车间', D(-10), '换垫片', '未整改', '', '', ''],
    ['YH-O2', '护栏锈蚀', '一般隐患', '自查', D(-40), '王', '催化车间', D(20), '补焊', '整改中', '', '', ''],
  ] });
  r = run(wsOnly, [], 'ws-only');
  eq(sc(0).status, 'checked', '22.22 只有车间列时按车间列核对');
  eq(r.summary.counts.total, 1, '22.23 只有车间列时剔除其他车间 1 行');
  eq(r.hz.items[0] && r.hz.items[0].unit, '测试车间', '22.24 无责任单位列时责任单位沿用车间列的值，不丢列');
  // 22.25~22.26 只有属地单位列：属地单位仍归责任单位，不当车间列
  const H4 = H.map((h) => (h === '责任单位' ? '属地单位' : h));
  const wsLocal = mk('ws-local.xlsx', { '隐患台账': [H4,
    ['YH-L1', '法兰渗漏', '一般隐患', '自查', D(-40), '王', '催化车间', D(-10), '换垫片', '未整改', '', '', ''],
  ] });
  r = run(wsLocal, [], 'ws-local');
  eq(sc(0).status, 'noColumn', '22.25 属地单位不当车间列（noColumn）');
  eq(r.hz.items[0] && r.hz.items[0].unit, '催化车间', '22.26 属地单位仍归责任单位，不被车间抢走');
  // 22.27~22.29 属地单位 + 车间名称两列：属地单位归责任单位，车间名称归车间并参与核对
  const wsBoth = mk('ws-both.xlsx', { '隐患台账': [[...H4, '车间名称'],
    ['YH-N1', '法兰渗漏', '一般隐患', '自查', D(-40), '王', '维修班', D(-10), '换垫片', '未整改', '', '', '', '测试车间'],
    ['YH-N2', '护栏锈蚀', '一般隐患', '自查', D(-40), '王', '测试车间', D(20), '补焊', '整改中', '', '', '', '催化车间'],
  ] });
  r = run(wsBoth, [], 'ws-both');
  eq(sc(0).column, '车间名称', '22.27 「车间名称」列归车间字段');
  eq(r.summary.counts.total, 1, '22.28 按车间名称剔除其他车间 1 行（属地单位写本车间也不保留）');
  eq(r.hz.items[0] && r.hz.items[0].unit, '维修班', '22.29 属地单位仍归责任单位');
}

// ================= 输出 =================
// ================= Y. 上期 hazard.json 的车间核对（D007 遗留 1）：不一致不对比、开头【注意】；未注明照常对比并说明 =================
{
  const src = JSON.parse(fs.readFileSync(prevPath, 'utf8'));
  const variant = (name, ws) => { const j = JSON.parse(JSON.stringify(src)); if (ws === undefined) delete j.meta.workshop; else j.meta.workshop = ws; const p = path.join(work, name); fs.writeFileSync(p, JSON.stringify(j)); return p; };
  const pw = (x) => ((x.hz && x.hz.meta && x.hz.meta.prevWorkshop) || {}).status;
  let y = run(unv, ['--prev', prevPath], 'y-same');
  eq(pw(y), 'matched', 'Y1 上期车间一致：status matched');
  ok(y.hz.trend && typeof y.hz.trend.totalDelta === 'number', 'Y2 上期车间一致：照常输出上期对比');
  const sameDelta = y.hz.trend && y.hz.trend.totalDelta;
  y = run(unv, ['--prev', variant('y-other.json', '加氢车间')], 'y-other');
  eq(pw(y), 'excluded', 'Y3 上期车间不一致：status excluded');
  eq(y.hz.trend, null, 'Y4 上期车间不一致：不做上期对比（trend 为 null）');
  ok(y.summary.warnings.some((w) => /^【注意】上期 hazard\.json 的车间为「加氢车间」/.test(w)), 'Y5 上期车间不一致：warning 带【注意】');
  ok(/^> \*\*【注意】上期 hazard\.json/m.test(y.md.split('## ')[0]), 'Y6 上期车间不一致：报告开头【注意】');
  ok(/【注意】上期 hazard\.json/.test(y.push || ''), 'Y7 上期车间不一致：督办清单开头同样提示');
  y = run(unv, ['--prev', variant('y-nows.json')], 'y-nows');
  eq(pw(y), 'unknown', 'Y8 上期未注明车间：status unknown');
  eq(y.hz.trend && y.hz.trend.totalDelta, sameDelta, 'Y9 上期未注明车间：照常对比，结果与一致时相同');
  ok(/上期 hazard\.json 未注明车间，无法核对/.test(y.md), 'Y10 上期未注明车间：口径处说明无法核对');
}

console.log(`\n${'='.repeat(56)}`);
console.log(`hazard-closure-tracker 自测：${pass} 通过，${fail} 失败`);
if (failures.length) { console.log('\n失败项：'); failures.forEach((f) => console.log('  ✗ ' + f)); }
console.log('='.repeat(56));
try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
