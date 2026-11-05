#!/usr/bin/env node
'use strict';
/**
 * 自测：生成变体输入并断言 calibration.js 行为。用法：node scripts/selftest.js（全绿退出 0）
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { writeXlsx, readXlsx } = require('./lib/xlsx-lite');
const C = require('./lib/common');

const CAL = path.join(__dirname, 'calibration.js');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'vicl-selftest-'));
const DATE = '2026-09-21';
const ago = (n) => new Date(Date.parse(DATE + 'T00:00:00Z') - n * 86400000).toISOString().slice(0, 10);
const after = (n) => new Date(Date.parse(DATE + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
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

/** 默认统计范围是安全阀（车间设备员归口）；本自测多数用例覆盖六类对象，故未显式给 --category 时按「全部」跑 */
function run(file, extra = [], tag) {
  const out = path.join(work, (tag || path.basename(file, '.xlsx')) + '-out');
  const catArgs = extra.includes('--category') ? [] : ['--category', '全部'];
  const r = spawnSync(process.execPath, [CAL, '--input', file, '--workshop', '测试车间', '--date', DATE, '--out', out, ...catArgs, ...extra], { encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  let summary;
  try { summary = JSON.parse(lines[lines.length - 1]); } catch (e) { summary = { ok: false, error: 'no-json:' + r.stdout + r.stderr }; }
  let data = null, md = null;
  if (fs.existsSync(path.join(out, 'calibration.json'))) data = JSON.parse(fs.readFileSync(path.join(out, 'calibration.json'), 'utf8'));
  if (fs.existsSync(path.join(out, 'calibration.md'))) md = fs.readFileSync(path.join(out, 'calibration.md'), 'utf8');
  return { code: r.status, summary, data, md, out };
}
function mk(name, book) { const p = path.join(work, name); writeXlsx(p, book); return p; }
let r, x;

const HEAD = ['对象类别', '位号', '名称', '型号', '量程', '精度等级', '校验周期', '上次校验日期', '校验结论', '证书编号', '下次校验日期'];

// ---- 1. 基础：超期/临期/正常三分
const base = mk('base.xlsx', {
  '校验台账': [HEAD,
    ['安全阀', 'PSV-01', '塔顶安全阀', 'A46Y', '0~1.6MPa', '—', '1年', ago(400), '合格', 'AQ-001', ''],
    ['计量器具', 'PI-01', '压力表1', 'Y-100', '0~2.5MPa', '1.6级', '6个月', ago(20), '合格', 'JL-001', ''],
    ['报警器', 'GD-01', '可燃气报警器', 'GTYQ', '0~100%LEL', '—', '1年', ago(350), '合格', 'BJ-001', ''],
  ],
});
section('BVT', () => {
  r = run(base, [], 'base');
  eq(r.summary.ok, true, '1.1 基础运行成功');
  eq(r.summary.counts.total, 3, '1.2 台账记录数');
  eq(r.summary.counts.overdue, 1, '1.3 超期 1 项（PSV-01 周期1年、上次400天前）');
  eq(r.summary.counts.dueSoon, 1, '1.4 临期 1 项（GD-01 剩余15天）');
  eq(r.summary.counts.normal, 1, '1.5 正常 1 项');
  eq(r.data.overdue[0].overdueDays, 35, '1.6 超期天数 = 400 - 365');
  eq(r.data.dueSoon[0].daysLeft, 15, '1.7 临期剩余天数');
  ok(/校验结论以有资质检定机构出具的证书为准；超期未校的安全附件与安全仪表不得作为有效安全保护措施。/.test(r.md), '1.8 必保留说明行写入 md');
  eq(r.data.overdue[0].nextDate, C.addMonths(ago(400), 12), '1.9 1 年周期按自然月推算到期日');
});

// ---- 2. lead-days 可调
section('B', () => {
  r = run(base, ['--lead-days', '5'], 'lead5');
  eq(r.summary.counts.dueSoon, 0, '2.1 提醒天数收窄后临期为 0');
  eq(r.summary.counts.normal, 2, '2.2 原临期项转为正常');
  r = run(base, ['--lead-days', '400'], 'lead400');
  eq(r.summary.counts.dueSoon, 2, '2.3 提醒天数放宽后临期 2 项');
});

// ---- 3. 周期缺失 / 上次校验日期缺失 → undetermined，绝不按同类默认周期
const und = mk('undet.xlsx', {
  '校验台账': [HEAD,
    ['安全阀', 'PSV-02', '安全阀2', 'A46Y', '0~1.6MPa', '—', '', ago(400), '合格', 'AQ-002', ''],
    ['安全阀', 'PSV-03', '安全阀3', 'A46Y', '0~1.6MPa', '—', '1年', '', '合格', 'AQ-003', ''],
    ['安全阀', 'PSV-04', '安全阀4', 'A46Y', '0~1.6MPa', '—', '1年', ago(400), '合格', 'AQ-004', ''],
  ],
});
section('A', () => {
  r = run(und, [], 'undet');
  eq(r.summary.counts.undetermined, 2, '3.1 周期缺失与日期缺失各 1 项归入待确认');
  eq(r.summary.counts.overdue, 1, '3.2 待确认项不按同类安全阀 1 年周期算超期');
  ok(r.data.undetermined.some((x) => x.tag === 'PSV-02' && x.missing.includes('校验周期')), '3.3 缺失字段标注为校验周期');
  ok(r.data.undetermined.some((x) => x.tag === 'PSV-03' && x.missing.includes('上次校验日期')), '3.4 缺失字段标注为上次校验日期');
  ok(r.data.undetermined.every((x) => x.calcNext === null && x.overdueDays === null), '3.5 待确认项不产生计算到期日与超期天数');
  ok(/## 五、待确认项/.test(r.md) && /不按同类默认周期推算/.test(r.md), '3.6 待确认单列一节并说明口径');
});

// ---- 4. 不合格未整改：不得按合格参与到期计算（关键判定）
const uf = mk('unresolved.xlsx', {
  '校验台账': [HEAD,
    ['安全阀', 'PSV-10', '安全阀10', 'A46Y', '0~1.6MPa', '—', '1年', ago(30), '不合格', 'AQ-010', ''],
    ['报警器', 'GD-10', '报警器10', 'GTYQ', '0~100%LEL', '—', '1年', ago(30), '不合格，响应超差', 'BJ-010', ''],
    ['计量器具', 'PI-10', '压力表10', 'Y-100', '0~1.6MPa', '1.6级', '6个月', ago(30), '合格', 'JL-010', ''],
  ],
});
section('A', () => {
  r = run(uf, [], 'unresolved');
  eq(r.summary.counts.unresolvedFail, 2, '4.1 不合格未整改 2 项');
  eq(r.summary.counts.normal, 1, '4.2 不合格项不计入正常（上次校验仅30天前也不算正常）');
  eq(r.summary.counts.overdue, 0, '4.3 不合格项不参与到期计算，不计入超期');
  eq(r.summary.counts.dueSoon, 0, '4.4 不合格项不计入临期');
  ok(r.data.unresolvedFail.every((x) => x.daysLeft === null && x.overdueDays === null), '4.5 不合格项不产生剩余/超期天数');
  ok(/## 三、不合格未整改清单/.test(r.md), '4.6 不合格未整改单列一节');
  ok(r.data.unresolvedFail.every((x) => x.result === 'fail'), '4.7 结论归一为 fail');
});

// ---- 5. 整改清单：已闭环的恢复到期计算，整改中的仍为未整改
const issues = mk('issues.xlsx', {
  '整改清单': [
    ['位号', '整改状态', '整改完成日期', '证书编号'],
    ['PSV-10', '已整改', ago(5), 'AQ-011'],
    ['GD-10', '整改中', '', ''],
  ],
});
section('B', () => {
  r = run(uf, ['--issues', issues], 'issues');
  eq(r.summary.counts.unresolvedFail, 1, '5.1 已闭环项移出不合格未整改');
  eq(r.summary.counts.normal, 2, '5.2 已闭环项恢复参与到期计算');
  ok(r.data.unresolvedFail[0].tag === 'GD-10', '5.3 「整改中」不算闭环');
  ok(r.data.normal.some((x) => x.tag === 'PSV-10' && x.remediation), '5.4 闭环项保留整改记录');
});
section('A', () => {
  r = run(uf, [], 'noissues');
  ok(r.data.warnings.some((w) => w.includes('未提供不合格整改清单')), '5.5 未提供整改清单时 warning 且按未整改处理');
  ok(/未提供不合格整改清单/.test(r.md), '5.6 报告写明未提供整改清单');
});

// ---- 6. 证书编号重复 → warning
const dup = mk('dupcert.xlsx', {
  '校验台账': [HEAD,
    ['安全阀', 'PSV-20', '安全阀20', 'A46Y', '0~1.6MPa', '—', '1年', ago(30), '合格', 'AQ-SAME', ''],
    ['安全阀', 'PSV-21', '安全阀21', 'A46Y', '0~1.6MPa', '—', '1年', ago(30), '合格', 'AQ-SAME', ''],
  ],
});
section('B', () => {
  r = run(dup, [], 'dupcert');
  eq(r.summary.counts.dupCerts, 1, '6.1 识别出 1 组重复证书编号');
  ok(r.data.warnings.some((w) => w.includes('重复出现') && w.includes('AQ-SAME')), '6.2 重复证书 warning 含证书号');
  ok(r.data.dupCerts[0].tags.length === 2, '6.3 重复证书列出全部位号');
  ok(/证书编号重复/.test(r.md), '6.4 报告含证书重复附节');
});

// ---- 7. 类别无法识别 → 归入待确认 + warning
const badcat = mk('badcat.xlsx', {
  '校验台账': [HEAD,
    ['某种装置', 'XX-30', '不明对象', 'NA', '—', '—', '1年', ago(30), '合格', 'FX-030', ''],
    ['安全阀', 'PSV-30', '安全阀30', 'A46Y', '0~1.6MPa', '—', '1年', ago(30), '合格', 'AQ-030', ''],
  ],
});
section('A', () => {
  r = run(badcat, [], 'badcat');
  eq(r.summary.counts.undetermined, 1, '7.1 类别无法识别归入待确认');
  ok(r.data.undetermined[0].missing.includes('对象类别'), '7.2 缺失字段含对象类别');
  ok(r.data.warnings.some((w) => w.includes('对象类别') && w.includes('无法识别')), '7.3 类别无法识别 warning');
});
section('C', () => {
  ok(r.data.byCategory.some((x) => x.category === '未识别'), '7.4 分类汇总含「未识别」一档');
});

// ---- 8. 台账下次校验日期与计算值不一致 → 并列 + warning
const mism = mk('mismatch.xlsx', {
  '校验台账': [HEAD,
    ['计量器具', 'PI-40', '压力表40', 'Y-100', '0~1.6MPa', '1.6级', '6个月', ago(30), '合格', 'JL-040', after(300)],
  ],
});
section('A', () => {
  r = run(mism, [], 'mismatch');
  eq(r.summary.counts.nextMismatch, 1, '8.1 识别出 1 处下次校验日期不一致');
  ok(r.data.normal[0].nextMismatch.ledger === after(300), '8.2 保留台账登记值');
  ok(r.data.normal[0].nextMismatch.calc === C.addMonths(ago(30), 6), '8.3 保留按周期计算值（6 个月按自然月推）');
  ok(r.data.warnings.some((w) => w.includes('不一致')), '8.4 不一致 warning');
  ok(/台账下次校验日期与计算值不一致/.test(r.md) && /不擅自采信其一/.test(r.md), '8.5 报告并列展示且不采信其一');
});

// ---- 9. 安全附件与安全仪表超期提示
const sc = mk('safety.xlsx', {
  '校验台账': [HEAD,
    ['安全阀', 'PSV-50', '安全阀50', 'A46Y', '0~1.6MPa', '—', '1年', ago(400), '合格', 'AQ-050', ''],
    ['联锁回路', 'SIS-50', '低压联锁', 'SIS-Ⅱ', '—', 'SIL2', '3年', ago(1200), '合格', 'SIS-050', ''],
    ['计量装置', 'FT-50', '流量计50', 'Promass', '0~300t/h', '0.2级', '1年', ago(400), '合格', 'JL-050', ''],
  ],
});
section('A', () => {
  r = run(sc, [], 'safety');
  eq(r.summary.counts.overdue, 3, '9.1 三项均超期');
  eq(r.summary.counts.safetyCriticalOverdue, 2, '9.2 其中安全附件与安全仪表超期 2 项');
  ok(r.data.overdue.find((x) => x.tag === 'SIS-50').safetyCritical === true, '9.3 联锁回路标记为影响安全保护');
  ok(r.data.overdue.find((x) => x.tag === 'FT-50').safetyCritical === false, '9.4 计量装置不标记为安全附件');
});

// ---- 10. 送检清单：按类别+周期归批，xlsx 落盘
section('B', () => {
  r = run(base, [], 'sendlist');
  const xl = path.join(r.out, '送检清单.xlsx');
  ok(fs.existsSync(xl), '10.1 送检清单.xlsx 已生成');
  const wb = readXlsx(xl);
  ok(!!wb['送检清单'] && !!wb['批次汇总'], '10.2 含送检清单与批次汇总两张表');
  eq(wb['送检清单'][0][0], '送检批次', '10.3 送检清单表头正确');
  eq(wb['送检清单'].length - 1, 2, '10.4 送检明细条数 = 超期 + 临期');
  eq(r.summary.counts.sendBatches, 2, '10.5 安全阀与报警器各一批');
  ok(wb['送检清单'].some((row) => String(row[11]) === '超期'), '10.6 明细标注超期状态');
  const uf2 = run(uf, [], 'sendlist2');
  ok(uf2.summary.counts.sendItems === 2 && uf2.summary.counts.overdue === 0, '10.7 不合格未整改项进送检清单但不计超期');
  const wb2 = readXlsx(path.join(uf2.out, '送检清单.xlsx'));
  ok(wb2['送检清单'].some((row) => String(row[12]).includes('须先整改后复校')), '10.8 不合格项备注要求先整改后复校');
});

// ---- 11. 合计行跳过 + 标题行表头识别 + 别名列头 + 空位号
const exp = mk('export.xlsx', {
  '校验台账': [
    ['某厂检定台账导出'],
    [],
    ['类别', '设备位号', '设备名称', '规格型号', '测量范围', '准确度等级', '检定周期', '检定日期', '检定结论', '证书号'],
    ['压力表', 'PI-60', '压力表60', 'Y-100', '0~2.5MPa', '1.6级', '6个月', ago(20), '合格', 'JL-060'],
    ['安全阀', 'PSV-60', '安全阀60', 'A46Y', '0~1.6MPa', '—', '1年', ago(400), '合格', 'AQ-060'],
    ['', '', '无位号记录', '', '', '', '1年', ago(30), '合格', ''],
    ['合计', '', '', '', '', '', '', '', '', ''],
  ],
});
section('B', () => {
  r = run(exp, [], 'export');
  eq(r.summary.ok, true, '11.1 导出风格表可读');
  eq(r.summary.counts.total, 2, '11.2 合计行与空位号行均被跳过');
});
section('C', () => {
  ok(r.data.warnings.some((w) => w.includes('合计行')), '11.3 合计行 warning');
  ok(r.data.warnings.some((w) => w.includes('位号为空')), '11.4 空位号 warning');
});
section('B', () => {
  ok(r.data.overdue[0].tag === 'PSV-60', '11.5 别名列头下判定正确');
});

// ---- 12. 周期无法解析 → warning + null，绝不按默认周期
const badp = mk('badperiod.xlsx', {
  '校验台账': [HEAD,
    ['安全阀', 'PSV-70', '安全阀70', 'A46Y', '0~1.6MPa', '—', '视情况', ago(400), '合格', 'AQ-070', ''],
  ],
});
section('A', () => {
  r = run(badp, [], 'badperiod');
  eq(r.summary.counts.undetermined, 1, '12.1 周期无法解析归入待确认');
  eq(r.data.undetermined[0].periodDays, null, '12.2 周期为 null 而非默认值');
  eq(r.data.undetermined[0].periodRaw, '视情况', '12.3 保留周期原文供核实');
  ok(r.data.warnings.some((w) => w.includes('校验周期') && w.includes('无法解析')), '12.4 周期无法解析 warning');
});

// ---- 13. 校验结论无法归类 → warning，不按合格处理
const badr = mk('badresult.xlsx', {
  '校验台账': [HEAD,
    ['安全阀', 'PSV-80', '安全阀80', 'A46Y', '0~1.6MPa', '—', '1年', ago(30), '待出报告', 'AQ-080', ''],
  ],
});
section('A', () => {
  r = run(badr, [], 'badresult');
  ok(r.data.warnings.some((w) => w.includes('无法归类')), '13.1 结论无法归类 warning');
  eq(r.data.normal[0].result, null, '13.2 无法归类的结论归一为 null');
});

// ---- 14. 缺列 → warning 且不中断
const lack = mk('lackcol.xlsx', {
  '校验台账': [
    ['位号', '名称', '上次校验日期', '校验结论'],
    ['PI-90', '压力表90', ago(30), '合格'],
  ],
});
section('B', () => {
  r = run(lack, [], 'lackcol');
  eq(r.summary.ok, true, '14.1 缺校验周期列不中断');
  ok(r.data.warnings.some((w) => w.includes('缺少列')), '14.2 缺列 warning');
  eq(r.summary.counts.undetermined, 1, '14.3 缺周期列的记录归入待确认');
});

// ---- 15. 缺唯一数据源工作表 → ok:false + exit 1
const bad = mk('bad.xlsx', { '随便一张表': [['a', 'b'], [1, 2]] });
section('B', () => {
  r = run(bad, [], 'bad');
  eq(r.summary.ok, false, '15.1 无校验台账工作表时 ok:false');
  eq(r.code, 1, '15.2 退出码为 1');
});
section('C', () => {
  ok(/未在输入中找到/.test(r.summary.error), '15.3 错误信息明确');
});

// ---- 16. 参数校验
function runRaw(args) {
  const x = spawnSync(process.execPath, [CAL, ...args], { encoding: 'utf8' });
  const lines = x.stdout.trim().split('\n');
  try { return { code: x.status, s: JSON.parse(lines[lines.length - 1]) }; } catch (e) { return { code: x.status, s: { ok: false, error: 'no-json' } }; }
}
section('B', () => {
  x = runRaw(['--input']);
  eq(x.s.ok, false, '16.1 --input 缺值报错');
});
section('C', () => {
  ok(/缺少取值/.test(x.s.error), '16.2 缺值错误信息正确');
});
section('B', () => {
  x = runRaw(['--input', base, '--workshop', '车间', '--date', '2026-13-45']);
  eq(x.s.ok, false, '16.3 非法日期报错');
  x = runRaw(['--input', base, '--workshop', '车间', '--date', DATE, '--未知参数', 'x']);
  eq(x.s.ok, false, '16.4 未知参数报错');
  x = runRaw(['--input', '/不存在的路径.xlsx', '--workshop', '车间', '--date', DATE]);
  eq(x.s.ok, false, '16.5 输入不存在报错');
  eq(x.code, 1, '16.6 输入不存在退出码 1');
  x = runRaw(['--input', base, '--workshop', '车间', '--date', DATE, '--lead-days', 'abc']);
  eq(x.s.ok, false, '16.7 非法 lead-days 报错');
  x = runRaw(['--input', base, '--workshop', '车间']);
  eq(x.s.ok, false, '16.8 缺 --date 报错');
  x = runRaw(['--input', base, '--workshop', '车间', '--date', DATE, '--issues', '/不存在.xlsx']);
  eq(x.s.ok, false, '16.9 整改清单不存在报错');
});

// ---- 17. --category 过滤与默认范围（中石化口径：车间设备员归口安全阀，计量/仪表类仅台账提醒）
section('B', () => {
  r = run(sc, ['--category', '安全阀'], 'catfilter');
  eq(r.summary.counts.total, 1, '17.1 按类别过滤后仅保留安全阀');
  ok(r.data.overdue[0].tag === 'PSV-50', '17.2 过滤后位号正确');
});
section('A', () => {
  // 不给 --category：默认只统计安全阀
  const out = path.join(work, 'defcat-out');
  const rr = spawnSync(process.execPath, [CAL, '--input', sc, '--workshop', '测试车间', '--date', DATE, '--out', out], { encoding: 'utf8' });
  const lines = rr.stdout.trim().split('\n');
  const s = JSON.parse(lines[lines.length - 1]);
  const j = JSON.parse(fs.readFileSync(path.join(out, 'calibration.json'), 'utf8'));
  const md = fs.readFileSync(path.join(out, 'calibration.md'), 'utf8');
  eq(s.category, '安全阀', '17.3 未给 --category 时默认安全阀');
  eq(s.counts.total, 1, '17.4 默认范围只含安全阀 1 项');
  eq(s.counts.totalInLedger, 3, '17.5 文件总计仍记 3 项');
  eq(j.meta.categoryDefaulted, true, '17.6 meta 标注类别为默认');
  ok(s.warnings.some((w) => /默认只统计安全阀/.test(w) && /计量（仪表）专业归口/.test(w)), '17.7 默认过滤 warning 说明归口与 --category 全部');
  ok(!/【注意】压力表、温度计等计量器具的检定/.test(md), '17.8 仅安全阀时不出现计量/仪表归口提示');
  ok(/统计类别：安全阀（默认，车间设备员归口）/.test(md), '17.9 md 写明默认统计类别');
});
section('B', () => {
  r = run(sc, [], 'allcat');
  eq(r.summary.counts.total, 3, '17.10 --category 全部 含全部类别');
  ok(/【注意】压力表、温度计等计量器具的检定/.test(r.md), '17.11 含计量/仪表类时出现归口提示');
  ok(r.data.overdue.find((x) => x.tag === 'SIS-50').ownership.includes('计量（仪表）专业归口'), '17.12 联锁回路标注计量（仪表）归口');
  ok(r.data.overdue.find((x) => x.tag === 'PSV-50').ownership === '车间设备员归口', '17.13 安全阀标注车间设备员归口');
  eq(r.summary.counts.instrumentItems, 2, '17.14 计量/仪表类计数 2');
  ok(r.data.byCategory.find((x) => x.category === '联锁回路').ownership.includes('仅台账提醒'), '17.15 分类汇总带归口列');
});
section('B', () => {
  x = runRaw(['--input', sc, '--workshop', '车间', '--date', DATE, '--category', '电梯']);
  eq(x.s.ok, false, '17.16 非法 --category 报错');
});
section('C', () => {
  ok(/默认 安全阀/.test(x.s.error), '17.17 错误信息说明默认类别');
});
section('B', () => {
  r = run(sc, ['--category', 'all'], 'allen');
  eq(r.summary.counts.total, 3, '17.18 --category all 等价全部');
});

// ---- 19. 「故障」是设备状态不是校验结论，不归不合格
const fault = mk('fault.xlsx', {
  '校验台账': [HEAD,
    ['安全阀', 'PSV-91', '安全阀91', 'A46Y', '0~1.6MPa', '—', '1年', ago(30), '故障', 'AQ-091', ''],
    ['安全阀', 'PSV-92', '安全阀92', 'A46Y', '0~1.6MPa', '—', '1年', ago(30), '不合格', 'AQ-092', ''],
  ],
});
section('B', () => {
  r = run(fault, [], 'fault');
  eq(r.summary.counts.unresolvedFail, 1, '19.1 「故障」不计入不合格未整改');
  ok(r.data.normal.some((y) => y.tag === 'PSV-91' && y.result === null), '19.2 「故障」结论归一为 null（不是 fail）');
  ok(r.data.warnings.some((w) => w.includes('PSV-91') && w.includes('设备状态不是校验结论')), '19.3 「故障」出 warning 提示补填检定结论');
  ok(r.data.unresolvedFail[0].tag === 'PSV-92', '19.4 「不合格」仍归 fail');
});

// ---- 20. 到期按自然月推算（addMonths），不按 365/180 天
const months = mk('months.xlsx', {
  '校验台账': [HEAD,
    ['安全阀', 'PSV-95', '安全阀95', 'A46Y', '0~1.6MPa', '—', '6个月', '2026-03-31', '合格', 'AQ-095', ''],
    ['安全阀', 'PSV-96', '安全阀96', 'A46Y', '0~1.6MPa', '—', '1年', '2024-02-29', '合格', 'AQ-096', ''],
    ['安全阀', 'PSV-97', '安全阀97', 'A46Y', '0~1.6MPa', '—', '30天', '2026-09-01', '合格', 'AQ-097', ''],
    ['安全阀', 'PSV-98', '安全阀98', 'A46Y', '0~1.6MPa', '—', '半年', '2026-05-15', '合格', 'AQ-098', ''],
  ],
});
section('A', () => {
  r = run(months, [], 'months');
  const byTag = {};
  for (const g of ['overdue', 'dueSoon', 'normal', 'undetermined']) for (const y of r.data[g]) byTag[y.tag] = y;
  eq(byTag['PSV-95'].nextDate, '2026-09-30', '20.1 6 个月按自然月：03-31 → 09-30（不是 +180 天的 09-27）');
  eq(byTag['PSV-96'].nextDate, '2025-02-28', '20.2 1 年按自然月：闰日 02-29 → 次年 02-28');
  eq(byTag['PSV-97'].nextDate, '2026-10-01', '20.3 天周期仍按天推');
  eq(byTag['PSV-98'].nextDate, '2026-11-15', '20.4 「半年」按 6 个自然月');
  eq(byTag['PSV-95'].periodUnit, '月', '20.5 周期单位记录');
  ok(r.data.meta.periodNote.includes('自然月'), '20.6 meta 说明按自然月推算');
});

// ---- 21. --certs 校验证书归档核对
const certDir = path.join(work, 'certs');
fs.mkdirSync(certDir, { recursive: true });
fs.writeFileSync(path.join(certDir, 'AQ-001 安全阀校验报告.pdf'), 'x');
fs.writeFileSync(path.join(certDir, 'GD-01标定证书.pdf'), 'x');
section('B', () => {
  r = run(base, ['--certs', certDir], 'certs');
  eq(r.summary.counts.certsMissing, 1, '21.1 缺证书台件数正确（按证书编号或位号匹配）');
  ok(r.data.certs.missing[0].tag === 'PI-01', '21.2 未匹配到证书的是 PI-01');
  eq(r.data.certs.fileCount, 2, '21.3 记录证书文件数');
  ok(/## 附三、校验证书归档核对/.test(r.md) && /PI-01/.test(r.md), '21.4 md 附三列出缺证书台件');
  ok(r.data.warnings.some((w) => w.includes('未找到对应证书文件') && w.includes('未读取证书内容')), '21.5 缺证书 warning 且声明不读内容');
  r = run(base, [], 'nocerts');
  eq(r.summary.counts.certsMissing, null, '21.6 未提供证书目录时为 null');
  ok(/未提供校验证书目录/.test(r.md), '21.7 md 说明未提供证书目录');
  x = runRaw(['--input', base, '--workshop', '车间', '--date', DATE, '--certs', '/不存在的目录']);
  eq(x.s.ok, false, '21.8 证书目录不存在报错');
});

// ---- 22. SAP PM / EM / 特种设备平台导出列名（共享别名表）
const sap = mk('sap.xlsx', {
  '安全阀台账': [
    ['功能位置', '设备', '设备描述', '设备品种', '型号编号', '整定压力', '检验周期', '检验日期', '检验结论', '校验报告编号', '检验机构', '所属设备'],
    ['1000-CDU-PSV1101', '10012345', '常压塔顶安全阀', '安全阀', 'A46Y-16C', '1.6MPa', '1年', ago(400), '合格', 'AQ-S-001', '某检验院', 'C-1101'],
    ['1000-CDU-PI1201', '10012346', '进料压力表', '压力表', 'Y-100', '0~2.5MPa', '6个月', ago(20), '合格', 'JL-S-002', '某计量所', 'P-1101A'],
  ],
});
section('B', () => {
  r = run(sap, [], 'sap');
  eq(r.summary.ok, true, '22.1 SAP/EM 列名可读（工作表名「安全阀台账」亦可识别）');
  eq(r.summary.counts.total, 2, '22.2 两条记录均解析');
  ok(r.data.overdue.some((y) => y.tag === '1000-CDU-PSV1101'), '22.3 「功能位置」识别为位号');
  ok(!r.data.overdue.some((y) => y.tag === '10012345'), '22.4 SAP「设备」流水号不被当作位号');
  eq(r.data.overdue[0].equipNo, '10012345', '22.5 SAP「设备」列读为设备编号单列');
  eq(r.data.overdue[0].name, '常压塔顶安全阀', '22.6 「设备描述」识别为名称');
  eq(r.data.overdue[0].model, 'A46Y-16C', '22.7 「型号编号」识别为型号');
  eq(r.data.overdue[0].inspector, '某检验院', '22.8 「检验机构」列读出');
  eq(r.data.overdue[0].range, '1.6MPa', '22.9 「整定压力」作量程别名');
  eq(r.data.overdue[0].location, 'C-1101', '22.10 「所属设备」作安装位置别名');
  ok(r.data.normal.some((y) => y.tag === '1000-CDU-PI1201' && y.category === '计量器具'), '22.11 「设备品种」压力表归计量器具');
});

// ---- 23. 产出不含 emoji，用【注意】提示
section('C', () => {
  r = run(sc, [], 'noemoji');
  ok(!/[✅⚠️❌]/.test(r.md), '23.1 md 不含 emoji');
  ok(/【注意】/.test(r.md), '23.2 醒目提示用【注意】');
  ok(/车间设备主任 \/ 公司设备管理部门/.test(r.md), '23.3 md 写明提交对象');
});

// ---- 24. 整改记录与本次不合格配对：整改完成日期早于本次（不合格）校验日期的是旧记录，不得据此闭环
const ufStale = mk('uf-stale.xlsx', {
  '校验台账': [HEAD,
    ['安全阀', 'PSV-50', '安全阀50', 'A46Y', '0~1.6MPa', '—', '1年', ago(30), '不合格', 'AQ-050', ''],
    ['安全阀', 'PSV-51', '安全阀51', 'A46Y', '0~1.6MPa', '—', '1年', ago(30), '不合格', 'AQ-051', ''],
    ['安全阀', 'PSV-52', '安全阀52', 'A46Y', '0~1.6MPa', '—', '1年', ago(30), '不合格', 'AQ-052', ''],
  ],
});
const issStale = mk('iss-stale.xlsx', {
  '整改清单': [
    ['位号', '整改状态', '整改完成日期', '证书编号'],
    ['PSV-50', '已整改', ago(200), 'AQ-040'],
    ['PSV-51', '已整改', ago(10), 'AQ-061'],
    ['PSV-52', '已整改', '', ''],
  ],
});
section('B', () => {
  r = run(ufStale, ['--issues', issStale], 'uf-stale');
  ok(r.data.unresolvedFail.some((x) => x.tag === 'PSV-50'), '24.1 整改完成日期早于本次不合格校验日期 → 仍为不合格未整改');
  ok(r.data.warnings.some((w) => w.includes('PSV-50') && w.includes('早于')), '24.2 旧整改记录不采信并 warning');
  ok(r.data.normal.some((x) => x.tag === 'PSV-51' && x.remediation), '24.3 整改完成日期晚于本次校验日期 → 闭环恢复到期计算');
  ok(r.data.normal.some((x) => x.tag === 'PSV-52'), '24.4 整改状态明确闭环、未填完成日期 → 按闭环处理（保持原口径）');
  eq(r.summary.counts.unresolvedFail, 1, '24.5 不合格未整改仅 PSV-50 一项');
});

// ---- 25. 默认范围（安全阀）外的记录不出「下次校验日期不一致」warning，与报告附一、counts.nextMismatch 一致
const scopeMism = mk('scope-mismatch.xlsx', {
  '校验台账': [HEAD,
    ['安全阀', 'PSV-60', '安全阀60', 'A46Y', '0~1.6MPa', '—', '1年', ago(30), '合格', 'AQ-060', ''],
    ['计量器具', 'PI-60', '压力表60', 'Y-100', '0~1.6MPa', '1.6级', '6个月', ago(30), '合格', 'JL-060', after(300)],
  ],
});
section('C', () => {
  r = run(scopeMism, ['--category', '安全阀'], 'scope-mismatch-default');
  eq(r.summary.counts.nextMismatch, 0, '25.1 默认范围 counts.nextMismatch 为 0');
  ok(!r.data.warnings.some((w) => w.includes('PI-60') && w.includes('不一致')), '25.2 范围外 PI-60 不出下次日期不一致 warning');
  r = run(scopeMism, [], 'scope-mismatch-all');
  ok(r.data.warnings.some((w) => w.includes('PI-60') && w.includes('不一致')), '25.3 --category 全部 时 PI-60 出不一致 warning');
});

// ---- 18. 产出结构完整性
section('BVT', () => {
  r = run(base, [], 'struct');
  ok(fs.existsSync(path.join(r.out, 'summary.json')), '18.1 summary.json 已写入');
  eq(JSON.parse(fs.readFileSync(path.join(r.out, 'summary.json'), 'utf8')).ok, true, '18.2 summary.json 内容正确');
  ok(fs.existsSync(path.join(r.out, 'calibration.json')), '18.3 calibration.json 已写入');
  ok(/## 一、到期概览/.test(r.md) && /## 二、超期清单/.test(r.md) && /## 三、不合格未整改清单/.test(r.md)
    && /## 四、临期清单/.test(r.md) && /## 五、待确认项/.test(r.md) && /## 六、分类汇总/.test(r.md)
    && /## 七、送检批次建议/.test(r.md) && /## 八、校验管理说明/.test(r.md), '18.4 八节结构齐全');
  ok(/<!-- ANALYSIS_START -->/.test(r.md) && /<!-- ANALYSIS_END -->/.test(r.md), '18.5 分析段占位符存在');
  ok(r.data.meta.statement.includes('不得作为有效安全保护措施'), '18.6 JSON 中保留说明行');
});

// ---- 26. 整改清单同一位号多行：在全部闭环记录里找配对本次不合格的那条，不因行序被旧记录覆盖（2026-11-04 复核补充）
const ufMulti = mk('uf-multi.xlsx', {
  '校验台账': [HEAD,
    ['安全阀', 'PSV-60', '安全阀60', 'A46Y', '0~1.6MPa', '—', '1年', ago(30), '不合格', 'AQ-060', ''],
    ['安全阀', 'PSV-61', '安全阀61', 'A46Y', '0~1.6MPa', '—', '1年', ago(30), '不合格', 'AQ-061', ''],
    ['安全阀', 'PSV-62', '安全阀62', 'A46Y', '0~1.6MPa', '—', '1年', ago(30), '不合格', 'AQ-062', ''],
  ],
});
const issMulti = mk('iss-multi.xlsx', {
  '整改清单': [
    ['位号', '整改状态', '整改完成日期', '证书编号'],
    ['PSV-60', '已整改', ago(20), 'AQ-070'],    // 新记录在前
    ['PSV-60', '已整改', ago(500), 'AQ-040'],   // 旧记录在后
    ['PSV-61', '已整改', ago(400), 'AQ-041'],
    ['PSV-61', '已整改', ago(300), 'AQ-051'],   // 两条都是旧记录
    ['PSV-62', '已整改', ago(10), 'AQ-072'],
    ['PSV-62', '已整改', ago(5), 'AQ-073'],     // 两条都晚于本次校验，取最晚的
  ],
});
section('C', () => {
  r = run(ufMulti, ['--issues', issMulti], 'uf-multi');
  ok(r.data.normal.some((x) => x.tag === 'PSV-60' && x.remediation && x.remediation.doneAt === ago(20)), '26.1 同一位号新记录在前、旧记录在后 → 仍按新记录判已整改');
  ok(!r.data.warnings.some((w) => w.includes('PSV-60') && w.includes('早于')), '26.2 有可配对的新记录时不报旧整改记录 warning');
  ok(r.data.unresolvedFail.some((x) => x.tag === 'PSV-61'), '26.3 同一位号全部记录都早于本次不合格校验 → 仍为不合格未整改');
  ok(r.data.warnings.some((w) => w.includes('PSV-61') && w.includes('早于')), '26.4 全部为旧记录时 warning');
  eq((r.data.normal.find((x) => x.tag === 'PSV-62') || { remediation: {} }).remediation.doneAt, ago(5), '26.5 多条可配对记录取整改完成日期最晚的一条');
  eq(r.summary.counts.unresolvedFail, 1, '26.6 不合格未整改仅 PSV-61 一项');
});

// ---- 27. 「旧整改记录」warning 只对统计范围内的设备发出（默认只统计安全阀时，范围外的 PI-9 不报）
const ufScope = mk('uf-scope.xlsx', {
  '校验台账': [HEAD,
    ['安全阀', 'PSV-9', '安全阀9', 'A46Y', '0~1.6MPa', '—', '1年', ago(30), '合格', 'AQ-009', ''],
    ['计量器具', 'PI-9', '压力表9', 'Y-100', '0~1.6MPa', '1.6级', '6个月', ago(30), '不合格', 'JL-009', ''],
  ],
});
const issScope = mk('iss-scope.xlsx', { '整改清单': [['位号', '整改状态', '整改完成日期', '证书编号'], ['PI-9', '已整改', ago(500), 'JL-000']] });
section('C', () => {
  r = run(ufScope, ['--issues', issScope, '--category', '安全阀'], 'uf-scope');
  ok(!r.data.warnings.some((w) => w.includes('PI-9') && w.includes('旧整改记录')), '27.1 范围外的 PI-9 不出旧整改记录 warning');
  r = run(ufScope, ['--issues', issScope], 'uf-scope-all');
  ok(r.data.warnings.some((w) => w.includes('PI-9') && w.includes('旧整改记录')), '27.2 --category 全部时 PI-9 在范围内，仍出 warning');
});

// ---- 28. 类别无法识别的记录在默认范围外时，warning 不写「已归入待确认」
section('C', () => {
  r = run(badcat, ['--category', '安全阀'], 'badcat-scope');
  const bw = r.data.warnings.filter((w) => w.includes('XX-30') && w.includes('无法识别'));
  eq(bw.length, 1, '28.1 默认范围外的 XX-30 类别无法识别仍有一条 warning');
  ok(bw.every((w) => !w.includes('已归入待确认')), '28.2 默认范围外的 XX-30 warning 不写「已归入待确认」');
  ok(bw.every((w) => w.includes('未纳入')), '28.3 默认范围外的 XX-30 warning 说明未纳入报表');
  eq(r.summary.counts.undetermined, 0, '28.4 默认范围外的 XX-30 不计入待确认');
  r = run(badcat, [], 'badcat-all');
  ok(r.data.warnings.some((w) => w.includes('XX-30') && w.includes('已归入待确认')), '28.5 --category 全部时 XX-30 仍写「已归入待确认」');
});

// ---- 29. 车间范围核对（D007）：校验台账带车间列时按 --workshop 核对
{
  const sc = (i) => ((r.data && r.data.meta.workshopScope) || [])[i] || {};
  const row = (tag, last, ws) => ['安全阀', tag, '安全阀' + tag, 'A42Y', '1.0MPa', '—', '1年', last, '合格', 'AQ-' + tag, '', ws];
  const wsMix = mk('ws-mix.xlsx', { '校验台账': [[...HEAD, '车间'],
    row('PSV-A1', ago(400), '测试车间'), row('PSV-A2', ago(100), '测试'), row('PSV-B1', ago(400), '焦化车间'), row('PSV-B2', ago(500), '焦化车间'), row('PSV-C1', ago(100), ''),
  ] });
  section('A', () => {
    r = run(wsMix, [], 'ws-mix');
    eq(r.summary.counts.total, 3, '29.1 混合输入只统计本车间与车间为空的行（剔除焦化车间 2 行）');
    eq(r.summary.counts.overdue, 1, '29.2 超期只含本车间（焦化车间 2 台超期不计）');
    ok(!(r.data.overdue || []).some((x) => /^PSV-B/.test(x.tag)), '29.3 其他车间安全阀不进超期清单');
    ok((r.data.normal || []).some((x) => x.tag === 'PSV-C1'), '29.4 车间列为空的行按本车间保留');
    ok(r.data.warnings.some((w) => /剔除其他车间 2 行/.test(w) && w.includes('焦化车间 2 行')), '29.5 warning 写明剔除行数与车间名');
    ok(r.data.warnings.some((w) => /车间列为空 1 行/.test(w)), '29.6 warning 写明车间为空行数');
    eq(sc(0).status, 'checked', '29.7 meta.workshopScope 记录已核对');
    eq(sc(0).droppedRows, 2, '29.8 meta.workshopScope 记录剔除行数');
    eq((sc(0).dropped || {})['焦化车间'], 2, '29.9 meta.workshopScope 按车间记录剔除');
  });
  section('C', () => {
    ok(/车间范围：已按车间列核对「测试车间」/.test(r.md || ''), '29.10 md 口径处写明按车间核对与剔除');
  });
  const wsBad = mk('ws-bad.xlsx', { '校验台账': [[...HEAD, '车间'], row('PSV-D1', ago(400), '焦化车间'), row('PSV-D2', ago(100), '催化车间')] });
  section('A', () => {
    r = run(wsBad, [], 'ws-bad');
    eq(r.summary.counts.total, 2, '29.11 车间列全不一致时不筛');
    ok(r.data.warnings.some((w) => w.startsWith('【注意】') && /未按车间筛选/.test(w)), '29.12 warning 以【注意】开头');
    eq(sc(0).status, 'mismatch', '29.13 meta.workshopScope 记录不一致');
    const ai = (r.md || '').indexOf('的车间列取值与 --workshop「测试车间」不一致，未按车间筛选');
    ok(ai > 0 && ai < r.md.indexOf('## 一、到期概览') && r.md.slice(0, ai).includes('【注意】'), '29.14 md 开头（第一节之前）有【注意】提示');
  });
  section('B', () => {
    r = run(base, [], 'ws-none');
    eq(sc(0).status, 'noColumn', '29.15 无车间列 status 为 noColumn');
  });
  section('C', () => {
    ok((r.md || '').includes('输入未含车间列，车间范围以取数条件为准'), '29.16 md 口径处说明无车间列');
  });
  const wsPlant = mk('ws-plant.xlsx', { '校验台账': [[...HEAD, '维护工厂'], row('PSV-E1', ago(100), '1100'), row('PSV-E2', ago(100), '1200')] });
  section('B', () => {
    r = run(wsPlant, [], 'ws-plant');
    eq(sc(0).status, 'noColumn', '29.17 「维护工厂」列不当车间列（noColumn）');
    eq(r.summary.counts.total, 2, '29.18 「维护工厂」列不触发筛选');
  });
}

// ---- 输出
console.log(`\n${'='.repeat(56)}`);
console.log(`valve-instrument-calibration-ledger 自测：${pass} 通过，${fail} 失败`);
console.log(`用例级别 ${LEVELS[RUN_LEVEL]}：BVT ${byLevel.BVT}，A ${byLevel.A}，B ${byLevel.B}，C ${byLevel.C}`);
if (failures.length) { console.log('\n失败项：'); failures.forEach((f) => console.log('  ✗ ' + f)); }
console.log('='.repeat(56));
try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
