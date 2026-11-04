#!/usr/bin/env node
'use strict';
/**
 * 自测：生成变体台账并断言 inspection.js 行为。用法：node scripts/selftest.js（全绿退出 0）
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { writeXlsx } = require('./lib/xlsx-lite');

const SCRIPT = path.join(__dirname, 'inspection.js');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'seid-selftest-'));
const DATE = '2026-09-21';
const BANNER = '【注意】存在超期未检特种设备，超期使用违反《特种设备安全法》，应立即停用并报检';
const C = require('./lib/common');
const HDR = ['设备类别', '位号', '设备名称', '注册代码', '使用证号', '上次检验日期', '检验结论', '下次检验日期', '安全状况等级', '装置', '规格型号', '使用状态'];
let pass = 0, fail = 0;
const failures = [];

function ok(cond, name) { if (cond) { pass++; } else { fail++; failures.push(name); } }
function eq(actual, expect, name) { ok(actual === expect, `${name}（期望 ${JSON.stringify(expect)}，实际 ${JSON.stringify(actual)}）`); }

function run(file, extra = [], tag) {
  const out = path.join(work, (tag || path.basename(file, '.xlsx')) + '-out');
  const r = spawnSync(process.execPath, [SCRIPT, '--input', file, '--workshop', '测试车间', '--date', DATE, '--out', out, ...extra], { encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  let summary;
  try { summary = JSON.parse(lines[lines.length - 1]); } catch (e) { summary = { ok: false, error: 'no-json:' + r.stdout + r.stderr }; }
  const rd = (f) => (fs.existsSync(path.join(out, f)) ? fs.readFileSync(path.join(out, f), 'utf8') : null);
  const js = rd('inspection.json');
  return { code: r.status, summary, json: js ? JSON.parse(js) : null, md: rd('inspection.md'), prep: rd('报检准备清单.md'), out };
}
function mk(name, rows, sheet = '特种设备台账') { const p = path.join(work, name); writeXlsx(p, { [sheet]: [HDR, ...rows] }); return p; }
/** 相对基准日偏移的日期 */
function d(n) { return new Date(Date.parse(DATE + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10); }

// ---- 1. 基础分组：超期 / 临期 / 正常
const base = mk('base.xlsx', [
  ['压力容器', 'V-01', '缓冲罐1', '11001', '容001', '2023-01-10', '符合要求', d(-100), '3级', '一装置', 'φ2000', '在用'],
  ['压力容器', 'V-02', '缓冲罐2', '11002', '容002', '2024-05-10', '符合要求', d(30), '2级', '一装置', 'φ2000', '在用'],
  ['压力容器', 'V-03', '缓冲罐3', '11003', '容003', '2025-05-10', '符合要求', d(400), '1级', '一装置', 'φ2000', '在用'],
]);
let r = run(base, [], 'base');
eq(r.summary.ok, true, '1.1 基础运行成功');
eq(r.summary.counts.total, 3, '1.2 设备总数');
eq(r.summary.counts.overdue, 1, '1.3 超期 1 台');
eq(r.summary.counts.dueSoon, 1, '1.4 临期 1 台（默认提前 90 天）');
eq(r.summary.counts.normal, 1, '1.5 周期内正常 1 台');
eq(r.json.overdue[0].overdueDays, 100, '1.6 超期天数计算正确');
eq(r.json.dueSoon[0].remainDays, 30, '1.7 剩余天数计算正确');

// ---- 2. 超期醒目声明行：有超期必须出现，无超期必须不出现
ok(r.md.includes(BANNER), '2.1 存在超期时 md 出现醒目提示原文');
ok(r.md.indexOf(BANNER) < r.md.indexOf('## 一、到期概览'), '2.2 醒目提示位于报告开头（概览之前）');
ok((r.md.match(/存在超期未检特种设备/g) || []).length >= 2, '2.3 报告开头与超期清单节各出现一次');
ok(r.prep.includes(BANNER), '2.4 报检准备清单同样带醒目提示');

const noOver = mk('noover.xlsx', [
  ['压力容器', 'V-11', '罐11', '11011', '容011', '2025-05-10', '符合要求', d(400), '1级', '一装置', 'φ2000', '在用'],
  ['起重机械', 'QZ-11', '行车11', 'QZ011', '起011', '2026-01-10', '合格', d(300), '', '一装置', 'LD-5t', '在用'],
]);
r = run(noOver, [], 'noover');
eq(r.summary.counts.overdue, 0, '2.5 无超期设备');
ok(!r.md.includes(BANNER), '2.6 无超期时 md 不出现醒目提示');
ok(!r.prep.includes(BANNER), '2.7 无超期时报检清单不出现醒目提示');

// ---- 3. 安全状况等级缺失 → undetermined，绝不按最长周期
const noGrade = mk('nograde.xlsx', [
  ['压力容器', 'V-21', '污油罐', '11021', '容021', '2020-01-10', '', '', '', '罐区', 'φ3000', '在用'],
]);
r = run(noGrade, [], 'nograde');
eq(r.summary.counts.undetermined, 1, '3.1 等级缺失计入待核实');
eq(r.summary.counts.normal, 0, '3.2 等级缺失不计入正常');
eq(r.summary.counts.overdue, 0, '3.3 等级缺失不计入超期');
eq(r.summary.counts.dueSoon, 0, '3.4 等级缺失不计入临期');
ok(r.json.undetermined[0].missing.includes('安全状况等级'), '3.5 待核实标注缺失字段为安全状况等级');
ok(/安全状况等级缺失/.test(r.json.undetermined[0].reason), '3.6 待核实原因说明清楚');
ok(!/2026-01-10|六年|6 年一次到期/.test(r.json.undetermined[0].nextDate || ''), '3.7 未按最长周期推算到期日');
ok(/## 五、待核实项/.test(r.md) && /未按任何默认周期处理/.test(r.md), '3.8 md 待核实节明确不按默认周期');

// ---- 4. 日期不一致：并列显示 + warning + 以台账为准
const conflict = mk('conflict.xlsx', [
  // 压力容器 2 级 → 6 年，2020-03-10 + 72 月 = 2026-03-10，台账写 2028-03-10
  ['压力容器', 'V-31', '回流罐', '11031', '容031', '2020-03-10', '符合要求', '2028-03-10', '2级', '一装置', 'φ2200', '在用'],
]);
r = run(conflict, [], 'conflict');
eq(r.summary.counts.dateConflict, 1, '4.1 日期不一致计 1 项');
const dc = r.json.dateConflict[0];
eq(dc.ledgerNext, '2028-03-10', '4.2 保留台账日期');
eq(dc.calcNext, '2026-03-10', '4.3 保留规则计算值');
eq(dc.resolved, '2028-03-10', '4.4 以台账（检验报告载明）为准');
ok(dc.basis.includes('以台账中检验报告载明的下次检验日期为准'), '4.5 判定依据表述正确');
ok(r.json.warnings.some((w) => w.includes('不一致') && w.includes('V-31')), '4.6 warning 提示核实并含位号');
ok(r.json.warnings.some((w) => /第\d+行/.test(w)), '4.7 warning 具体到行号');
eq(r.json.normal[0].nextDate, '2028-03-10', '4.8 分组按台账日期（未超期）');
ok(r.md.includes('2028-03-10') && r.md.includes('2026-03-10'), '4.9 md 两者并列显示');

// ---- 5. 各类别周期查表
const periods = mk('periods.xlsx', [
  ['压力容器', 'V-41', '罐41', '11041', '', '2020-01-15', '符合要求', '', '1级', '一装置', 'φ2000', '在用'],       // 6年
  ['压力容器', 'V-42', '罐42', '11042', '', '2020-01-15', '符合要求', '', '3级', '一装置', 'φ2000', '在用'],       // 3年
  ['压力管道', 'GL-41', '管道41', 'PP041', '', '2020-01-15', '符合要求', '', '2级', '一装置', 'GC1 DN600', '在用'], // 6年
  ['安全阀', 'SV-41', '安全阀41', 'SV041', '', '2025-01-15', '合格', '', '', '一装置', 'A48Y', '在用'],            // 1年
  ['起重机械', 'QZ-41', '行车41', 'QZ041', '', '2025-01-15', '合格', '', '', '一装置', 'LD-5t', '在用'],           // 2年
  ['场内机动车辆', 'CC-41', '叉车41', 'CC041', '', '2025-01-15', '合格', '', '', '一装置', '3t', '在用'],          // 1年
  ['锅炉', 'BL-41', '锅炉41', 'BL041', '', '2025-01-15', '合格', '', '', '一装置', '外部检验 4t/h', '在用'],       // 1年
  ['锅炉', 'BL-42', '锅炉42', 'BL042', '', '2025-01-15', '合格', '', '', '一装置', '内部检验 4t/h', '在用'],       // 2年
]);
r = run(periods, [], 'periods');
const byTag = {};
for (const g of ['overdue', 'dueSoon', 'normal', 'undetermined']) for (const x of r.json[g]) byTag[x.tag] = x;
eq(byTag['V-41'].nextDate, '2026-01-15', '5.1 压力容器 1 级按 6 年');
eq(byTag['V-42'].nextDate, '2023-01-15', '5.2 压力容器 3 级按 3 年');
eq(byTag['GL-41'].nextDate, '2026-01-15', '5.3 压力管道安全状况 2 级按 6 年（GC1 只是管道级别，不决定周期）');
ok(byTag['SV-41'] && byTag['SV-41'].reason && /厂内规定与校验报告为准/.test(byTag['SV-41'].reason), '5.4 安全阀不代入默认周期：台账无下次检验日期时进待核实，提示以厂内规定为准');
ok(byTag['SV-41'].referTo === 'valve-instrument-calibration-ledger', '5.4b 安全阀待核实项指向 valve-instrument-calibration-ledger');
eq(byTag['QZ-41'].nextDate, '2027-01-15', '5.5 起重机械按 2 年');
eq(byTag['CC-41'].nextDate, '2026-01-15', '5.6 场内机动车辆按 1 年');
eq(byTag['BL-41'].nextDate, '2026-01-15', '5.7 锅炉外部检验按 1 年');
eq(byTag['BL-42'].nextDate, '2027-01-15', '5.8 锅炉内部检验按 2 年');

// ---- 6. 锅炉未注明检验类型 → undetermined，不取三者中任一
const boiler = mk('boiler.xlsx', [
  ['锅炉', 'BL-51', '锅炉51', 'BL051', '', '2025-01-15', '合格', '', '', '一装置', '4t/h', '在用'],
]);
r = run(boiler, [], 'boiler');
eq(r.summary.counts.undetermined, 1, '6.1 锅炉未注明检验类型计入待核实');
ok(/外部检验\/内部检验\/水压试验/.test(r.json.undetermined[0].reason), '6.2 说明三者周期不同');

// ---- 7. 安全状况等级 4 级监控使用 / 5 级应停用，不按常规周期
const grade45 = mk('grade45.xlsx', [
  ['压力容器', 'V-61', '老罐', '11061', '', '2024-01-15', '监控使用', '', '4级', '罐区', 'φ2000', '在用'],
  ['压力容器', 'V-62', '待报废罐', '11062', '', '2024-01-15', '不符合要求', '', '5级', '罐区', 'φ1600', '在用'],
]);
r = run(grade45, [], 'grade45');
eq(r.summary.counts.monitored, 1, '7.1 4 级归入监控使用');
eq(r.summary.counts.stopped, 1, '7.2 5 级归入应停用');
eq(r.summary.counts.normal, 0, '7.3 4/5 级不计入正常');
eq(r.summary.counts.undetermined, 2, '7.4 4/5 级均进入待核实（周期不按常规推算）');
ok(r.json.stopped[0].reason.includes('立即停止使用'), '7.5 5 级表述为应立即停用');
ok(/## 八、监控使用与应停用设备/.test(r.md), '7.6 md 单列监控使用与应停用节');

// ---- 8. 设备类别无法识别 → undetermined
const badCat = mk('badcat.xlsx', [
  ['电梯附属装置', 'X-71', '不明设备', 'XX071', '', '2024-01-15', '合格', '', '', '一装置', '—', '在用'],
]);
r = run(badCat, [], 'badcat');
eq(r.summary.counts.undetermined, 1, '8.1 类别不识别计入待核实');
ok(r.json.warnings.some((w) => w.includes('无法识别为六类特种设备')), '8.2 类别不识别 warning');
ok(r.json.undetermined[0].missing.includes('设备类别'), '8.3 待核实标注缺设备类别');

// ---- 9. 上次检验日期缺失/无法解析 → undetermined 且不按 0 处理
const noDate = mk('nodate.xlsx', [
  ['起重机械', 'QZ-81', '行车81', 'QZ081', '', '', '合格', '', '', '一装置', 'LD-5t', '在用'],
  ['起重机械', 'QZ-82', '行车82', 'QZ082', '', '去年检的', '合格', '', '', '一装置', 'LD-5t', '在用'],
]);
r = run(noDate, [], 'nodate');
eq(r.summary.counts.undetermined, 2, '9.1 日期缺失与无法解析均计入待核实');
ok(r.json.warnings.some((w) => w.includes('上次检验日期') && w.includes('无法解析')), '9.2 日期无法解析 warning');
ok(r.json.undetermined.every((x) => x.nextDate === undefined || x.nextDate === null), '9.3 无到期日不编造数值');

// ---- 10. --lead-days 改变临期窗口
r = run(base, ['--lead-days', '10'], 'lead10');
eq(r.summary.counts.dueSoon, 0, '10.1 提前 10 天时 30 天后到期不计临期');
eq(r.summary.counts.normal, 2, '10.2 相应计入正常');
r = run(base, ['--lead-days', '500'], 'lead500');
eq(r.summary.counts.dueSoon, 2, '10.3 提前 500 天时两台均计临期');
eq(r.summary.leadDays, 500, '10.4 summary 回显 leadDays');

// ---- 11. --category 过滤
const mixed = mk('mixed.xlsx', [
  ['压力容器', 'V-91', '罐91', '11091', '', '2024-01-15', '符合要求', d(30), '2级', '一装置', 'φ2000', '在用'],
  ['起重机械', 'QZ-91', '行车91', 'QZ091', '', '2025-01-15', '合格', d(40), '', '一装置', 'LD-5t', '在用'],
]);
r = run(mixed, ['--category', '压力容器'], 'cat');
eq(r.summary.counts.total, 1, '11.1 仅统计指定类别');
ok(r.json.warnings.some((w) => w.includes('已按 --category')), '11.2 过滤 warning 说明被排除台数');
eq(r.json.meta.categoryFilter, '压力容器', '11.3 meta 回显过滤类别');

// ---- 12. 遗留整改项
r = run(mixed, [], 'noissues');
eq(r.summary.counts.openIssues, null, '12.1 未提供整改项清单时为 null');
ok(/未提供整改项清单/.test(r.md), '12.2 md 说明未提供整改项清单');
const issues = path.join(work, 'issues.xlsx');
writeXlsx(issues, {
  '整改项': [
    ['位号', '设备名称', '整改项', '要求完成日期', '整改状态', '责任人'],
    ['V-91', '罐91', '筒体腐蚀减薄需补焊', d(-30), '整改中', '张工'],
    ['QZ-91', '行车91', '限位装置失灵需更换', d(20), '未开始', '李工'],
    ['V-91', '罐91', '保温破损已修复', d(-60), '已完成', '王工'],
    ['ZZ-99', '不在台账的设备', '未知问题', d(-5), '整改中', '赵工'],
  ],
});
r = run(mixed, ['--issues', issues], 'issues');
eq(r.summary.counts.openIssues, 3, '12.3 已完成项不计入遗留整改');
eq(r.summary.counts.openIssuesOverdue, 2, '12.4 超过整改期限的 2 项');
ok(r.json.openIssues.some((x) => x.tag === 'ZZ-99' && x.inLedger === false), '12.5 不在台账的整改项仍保留并标注');
ok(r.json.warnings.some((w) => w.includes('不在特种设备台账中')), '12.6 台账外整改项 warning');

// ---- 13. 报检准备清单产出
r = run(mixed, [], 'prep');
ok(r.prep && /报检准备清单/.test(r.prep), '13.1 报检准备清单已生成');
ok(/## 一、压力容器/.test(r.prep) && /## 二、起重机械/.test(r.prep), '13.2 按类别分节且用中文序号');
ok(/使用登记证/.test(r.prep) && /- \[ \] /.test(r.prep), '13.3 应备资料为可勾选清单');
eq(r.json.prepMaterials.length, 2, '13.4 prepMaterials 仅覆盖台账出现的类别');
ok(r.json.prepMaterials.every((x) => x.materials.length >= 5), '13.5 每类资料条目齐全');
ok(/以检验机构受理要求与厂内特种设备管理制度为准/.test(r.prep), '13.6 报检清单带口径声明');

// ---- 14. ERP 导出风格：标题行 + 别名列头 + 合计行 + 中文等级 + 斜杠日期
const erp = path.join(work, 'erp.xlsx');
writeXlsx(erp, {
  '特种设备台账': [
    ['某厂特种设备台账导出'],
    [],
    ['设备种类', '设备位号', '名称', '注册号', '使用登记证号', '末次检验日期', '检验结果', '到期日期', '安全状况', '所属装置', '型号', '运行状态'],
    ['压力容器', 'V-A1', '罐A1', '11A01', '容A01', '2024/3/15', '符合要求', '2030/3/15', '二级', '加氢装置', 'φ2600', '在用'],
    ['压力容器', 'V-A2', '罐A2', '11A02', '容A02', '2021年6月10日', '符合要求', '2024年6月10日', '三级', '加氢装置', 'φ1800', '在用'],
    ['合计', '', '', '', '', '', '', '', '', '', '', ''],
  ],
});
r = run(erp, [], 'erp');
eq(r.summary.ok, true, '14.1 ERP 风格可读');
eq(r.summary.counts.total, 2, '14.2 合计行被跳过');
ok(r.json.warnings.some((w) => w.includes('合计行')), '14.3 合计行 warning');
ok(byOf(r, 'V-A1').grade === 2, '14.4 中文「二级」识别为 2 级');
eq(byOf(r, 'V-A2').nextDate, '2024-06-10', '14.5 中文日期写法解析正确');
eq(r.summary.counts.overdue, 1, '14.6 V-A2 判为超期');
function byOf(res, tag) {
  for (const g of ['overdue', 'dueSoon', 'normal', 'undetermined']) { const x = res.json[g].find((y) => y.tag === tag); if (x) return x; }
  return {};
}

// ---- 15. 位号为空跳过
const noTag = mk('notag.xlsx', [
  ['压力容器', '', '无位号罐', '11B01', '', '2024-01-15', '符合要求', d(30), '2级', '一装置', 'φ2000', '在用'],
  ['压力容器', 'V-B2', '罐B2', '11B02', '', '2024-01-15', '符合要求', d(30), '2级', '一装置', 'φ2000', '在用'],
]);
r = run(noTag, [], 'notag');
eq(r.summary.counts.total, 1, '15.1 空位号行被跳过');
ok(r.json.warnings.some((w) => w.includes('位号为空')), '15.2 空位号 warning');

// ---- 16. 缺表 / 缺列
const badSheet = path.join(work, 'badsheet.xlsx');
writeXlsx(badSheet, { '随便一张表': [['a', 'b'], [1, 2]] });
r = run(badSheet, [], 'badsheet');
eq(r.summary.ok, false, '16.1 无台账工作表时 ok:false');
eq(r.code, 1, '16.2 退出码为 1');
ok(/未在输入中找到/.test(r.summary.error), '16.3 错误信息明确');

const missCol = path.join(work, 'misscol.xlsx');
writeXlsx(missCol, {
  '特种设备台账': [
    ['位号', '设备名称', '上次检验日期'],
    ['V-C1', '罐C1', '2024-01-15'],
  ],
});
r = run(missCol, [], 'misscol');
eq(r.summary.ok, true, '16.4 缺非致命列不中断');
ok(r.json.warnings.some((w) => w.includes('缺少列') && w.includes('设备类别')), '16.5 缺列 warning');
eq(r.summary.counts.undetermined, 1, '16.6 缺设备类别的设备归入待核实');

// ---- 17. 参数校验
function runRaw(args) {
  const rr = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  const lines = rr.stdout.trim().split('\n');
  try { return { code: rr.status, s: JSON.parse(lines[lines.length - 1]) }; } catch (e) { return { code: rr.status, s: { ok: false, error: 'no-json' } }; }
}
let x = runRaw(['--input']);
eq(x.s.ok, false, '17.1 --input 缺值报错');
ok(/缺少取值/.test(x.s.error), '17.2 缺值错误信息正确');
eq(x.code, 1, '17.3 退出码为 1');
x = runRaw(['--input', base, '--workshop', '车间', '--date', '2026-13-45']);
eq(x.s.ok, false, '17.4 非法日期报错');
x = runRaw(['--input', base, '--workshop', '车间', '--date', DATE, '--未知参数', 'x']);
eq(x.s.ok, false, '17.5 未知参数报错');
x = runRaw(['--input', '/不存在的台账.xlsx', '--workshop', '车间', '--date', DATE]);
eq(x.s.ok, false, '17.6 输入不存在报错');
x = runRaw(['--input', base, '--workshop', '车间', '--date', DATE, '--lead-days', '不是数字']);
eq(x.s.ok, false, '17.7 非法 --lead-days 报错');
x = runRaw(['--input', base, '--workshop', '车间', '--date', DATE, '--category', '电梯']);
eq(x.s.ok, false, '17.8 非六类的 --category 报错');
ok(/不在六类特种设备范围内/.test(x.s.error), '17.9 类别错误信息明确');
x = runRaw(['--input', base, '--date', DATE]);
eq(x.s.ok, false, '17.10 缺 --workshop 报错');

// ---- 18. 产出完整性
r = run(base, ['--issues', issues], 'full');
ok(fs.existsSync(path.join(r.out, 'summary.json')), '18.1 summary.json 已写入');
eq(JSON.parse(fs.readFileSync(path.join(r.out, 'summary.json'), 'utf8')).ok, true, '18.2 summary.json 内容正确');
ok(fs.existsSync(path.join(r.out, 'inspection.json')) && fs.existsSync(path.join(r.out, 'inspection.md'))
  && fs.existsSync(path.join(r.out, '报检准备清单.md')), '18.3 四份产出齐全');
ok(/## 一、到期概览/.test(r.md) && /## 二、超期清单/.test(r.md) && /## 三、临期清单/.test(r.md)
  && /## 四、检验日期不一致项/.test(r.md) && /## 五、待核实项/.test(r.md) && /## 六、遗留整改项/.test(r.md)
  && /## 七、年度检查到期/.test(r.md) && /## 八、监控使用与应停用设备/.test(r.md) && /## 九、检验报告归档核对/.test(r.md)
  && /## 十、定检管理说明/.test(r.md), '18.4 十节结构齐全');
ok(/<!-- ANALYSIS_START -->/.test(r.md) && /<!-- ANALYSIS_END -->/.test(r.md), '18.5 分析段占位符存在');
ok(/以现行有效法规与检验机构报告载明为准/.test(r.md), '18.6 md 带法规口径声明');
ok(/不认可任何形式的超期使用/.test(r.md), '18.7 md 声明不认可超期使用');
ok(r.json.meta.basisNote.includes('以检验报告为准'), '18.8 JSON meta 记录判定口径');

// ---- 19. 检验报告归档核对
const repDir = path.join(work, 'reports');
fs.mkdirSync(repDir, { recursive: true });
fs.writeFileSync(path.join(repDir, 'V-01 检验报告2023.pdf'), 'x');
r = run(base, ['--reports', repDir], 'reports');
eq(r.summary.counts.reportsMissing, 2, '19.1 缺报告设备数正确');
ok(r.json.reports.missing.every((m) => m.tag !== 'V-01'), '19.2 已匹配到报告的设备不列缺失');
r = run(base, [], 'noreports');
eq(r.summary.counts.reportsMissing, null, '19.3 未提供报告目录时为 null');
ok(/未提供检验报告目录/.test(r.md), '19.4 md 说明未提供报告目录');

// ---- 20. 按类别统计
r = run(mixed, [], 'bycat');
eq(r.json.byCategory.length, 2, '20.1 byCategory 覆盖两类');
ok(r.json.byCategory.every((c) => c.total === c.overdue + c.dueSoon + c.normal + c.undetermined
  || c.total >= c.overdue + c.dueSoon + c.normal), '20.2 按类别计数自洽');

// ---- 8. 压力管道：GC 级别不决定周期，安全状况等级 3 级按 3 年；等级缺失 → undetermined 而非按 GC 给 6 年
const gc = mk('gc.xlsx', [
  ['压力管道', 'GL-81', '管道81', 'PP081', '', '2020-01-15', '符合要求', '', '3级', '一装置', 'GC1 DN300', '在用'],
  ['压力管道', 'GL-82', '管道82', 'PP082', '', '2020-01-15', '符合要求', '', '', '一装置', 'GC2 DN300', '在用'],
]);
r = run(gc, [], 'gc');
{
  const bt = {};
  for (const g of ['overdue', 'dueSoon', 'normal', 'undetermined']) for (const x of r.json[g]) bt[x.tag] = x;
  eq(bt['GL-81'].nextDate, '2023-01-15', '8.1 GC1 但安全状况 3 级 → 按 3 年，不按 GC 给 6 年');
  ok(r.json.undetermined.some((x) => x.tag === 'GL-82'), '8.2 GC2 但等级缺失 → undetermined，不按最长周期');
  ok(r.json.undetermined.find((x) => x.tag === 'GL-82').reason.includes('不决定检验周期'), '8.3 未判定原因说明 GC 级别不决定周期');
}


// ---- 21. 中石化口径：安全阀归口互指、储罐待核实、设备品种中文写法、不用自造字母码
const sv = mk('sv.xlsx', [
  ['安全阀', 'SV-91', '塔顶安全阀', 'SV091', '', '2025-01-15', '合格', d(20), '', '一装置', 'A48Y', '在用'],
  ['储罐', 'TK-91', '柴油储罐', 'TK091', '', '2024-01-15', '合格', '', '', '罐区', 'φ12000', '在用'],
  ['压力容器（储罐）', 'V-92', '液化气储罐', '11092', '', '2024-01-15', '符合要求', d(40), '2级', '罐区', 'φ3000', '在用'],
  ['PV', 'V-93', '字母码类别', '11093', '', '2024-01-15', '符合要求', '', '2级', '罐区', 'φ3000', '在用'],
]);
r = run(sv, [], 'sv');
eq(r.summary.counts.dueSoon, 2, '21.1 安全阀按台账下次检验日期提示（临期），不按 1 年代算');
ok(r.json.warnings.some((w) => /安全阀校验周期以厂内规定与校验报告为准/.test(w) && /valve-instrument-calibration-ledger/.test(w)), '21.2 含安全阀时 warning 互指 valve-instrument-calibration-ledger');
ok(r.json.undetermined.some((x) => x.tag === 'TK-91' && /常压储罐不是特种设备/.test(x.reason)), '21.3 「储罐」进待核实并说明常压储罐不是特种设备');
ok(r.json.undetermined.find((x) => x.tag === 'TK-91').missing.includes('储罐待核实'), '21.4 待核实缺失字段标「储罐待核实」');
eq(r.summary.counts.tankSuspect, 1, '21.5 储罐待核实计数');
ok(r.json.warnings.some((w) => /TK-91|储罐/.test(w) && /待核实/.test(w)), '21.6 储罐 warning');
ok(r.json.dueSoon.some((x) => x.tag === 'V-92' && x.category === '压力容器'), '21.7 写明「压力容器」的储罐正常识别');
ok(r.json.undetermined.some((x) => x.tag === 'V-93'), '21.8 自造字母码「PV」不再识别为压力容器');
ok(r.json.warnings.some((w) => /V-93|「PV」/.test(w) && /设备品种中文写法/.test(w)), '21.9 字母码 warning 提示按设备品种中文写法');
ok(!/[✅⚠️❌]/.test(r.md) && !/[✅⚠️❌]/.test(r.prep), '21.10 md 与报检清单不含 emoji');
ok(/【注意】/.test(r.md) || r.summary.counts.overdue === 0, '21.11 醒目提示用【注意】');

// ---- 22. 特种设备平台 / SAP 列名：设备品种、设备代码、使用登记证编号、检验机构、检验类型；「设备」流水号不作位号
const plat = path.join(work, 'plat.xlsx');
writeXlsx(plat, {
  '特种设备台账': [
    ['功能位置', '设备', '设备描述', '设备品种', '设备代码', '使用登记证编号', '检验机构', '检验类型', '上次检验日期', '检验结论', '下次检验日期', '安全状况等级', '年度检查日期', '工厂区段'],
    ['1000-CDU-V1301', '10001301', '原油缓冲罐', '压力容器', '31010900012026', '容20260012', '某检验院', '全面检验', '2023-01-10', '符合要求', d(-100), '3级', d(-400), '常减压装置'],
    ['1000-CDU-BL3101', '10003101', '余热锅炉', '锅炉', '11010900022026', '锅20260002', '某检验院', '外部检验', '2026-05-15', '合格', '', '', '', '常减压装置'],
    ['1000-CDU-BL3102', '10003102', '导热油炉', '锅炉', '11010900032026', '锅20260003', '某检验院', '', '2025-01-15', '合格', '', '', '', '常减压装置'],
  ],
});
r = run(plat, [], 'plat');
eq(r.summary.ok, true, '22.1 特种设备平台列名可读');
eq(r.summary.counts.total, 3, '22.2 三台均解析');
ok(r.json.overdue.some((x) => x.tag === '1000-CDU-V1301'), '22.3 「功能位置」识别为位号');
ok(!r.json.overdue.some((x) => x.tag === '10001301'), '22.4 SAP「设备」流水号不被当作位号');
eq(r.json.overdue[0].equipNo, '10001301', '22.5 SAP「设备」列读为设备编号单列');
eq(r.json.overdue[0].regCode, '31010900012026', '22.6 「设备代码」列读出');
eq(r.json.overdue[0].licence, '容20260012', '22.7 「使用登记证编号」列读出');
eq(r.json.overdue[0].inspector, '某检验院', '22.8 「检验机构」列读出');
ok(/某检验院/.test(r.md), '22.9 md 超期表带检验机构');
ok(r.json.overdue[0].unit === '常减压装置', '22.10 「工厂区段」识别为装置');
ok(r.json.normal.some((x) => x.tag === '1000-CDU-BL3101' && x.inspType === '外部检验' && x.nextDate === '2027-05-15'), '22.11 锅炉检验类型取自独立「检验类型」列（外部检验按 12 个自然月）');
ok(r.json.undetermined.some((x) => x.tag === '1000-CDU-BL3102' && x.missing.includes('检验类型')), '22.12 锅炉「检验类型」列为空且型号无线索 → 待核实并标缺检验类型');

// ---- 23. 年度检查到期（使用单位年度检查，车间设备员主责）：按 addMonths 12 个月
eq(r.summary.counts.annualOverdue, 1, '23.1 年度检查超期 1 台（V1301 上次年检 400 天前）');
ok(r.json.annualCheck.overdue[0].tag === '1000-CDU-V1301', '23.2 超期对象正确');
eq(r.json.annualCheck.overdue[0].nextAnnual, C.addMonths(d(-400), 12), '23.3 下次年度检查 = 上次 + 12 个自然月');
ok(/## 七、年度检查到期（使用单位年度检查，车间设备员主责）/.test(r.md), '23.4 md 第七节为年度检查');
ok(r.json.warnings.some((w) => /年度检查已超期/.test(w)), '23.5 年度检查超期 warning');
ok(r.json.annualCheck.undetermined.length === 0, '23.6 锅炉不进年度检查节（仅压力容器/压力管道）');
r = run(base, [], 'noannual');
eq(r.summary.counts.annualOverdue, null, '23.7 台账无年度检查列时为 null');
ok(r.json.warnings.some((w) => /无「上次年度检查日期」列/.test(w)), '23.8 缺年度检查列 warning');
ok(/台账无「上次年度检查日期」列，本节不出数/.test(r.md), '23.9 md 第七节说明不出数');
const annualMix = mk('annual.xlsx', [
  ['压力容器', 'V-95', '罐95', '11095', '', '2025-05-10', '符合要求', d(400), '1级', '一装置', 'φ2000', '在用'],
  ['压力管道', 'GL-95', '管道95', 'PP095', '', '2025-05-10', '符合要求', d(400), '2级', '一装置', 'DN300', '在用'],
].map((row) => row));
{
  // 手工加一列「上次年度检查日期」
  const book = { '特种设备台账': [HDR.concat(['上次年度检查日期']),
    ['压力容器', 'V-95', '罐95', '11095', '', '2025-05-10', '符合要求', d(400), '1级', '一装置', 'φ2000', '在用', d(-300)],
    ['压力管道', 'GL-95', '管道95', 'PP095', '', '2025-05-10', '符合要求', d(400), '2级', '一装置', 'DN300', '在用', ''],
    ['压力容器', 'V-96', '罐96', '11096', '', '2025-05-10', '符合要求', d(400), '1级', '一装置', 'φ2000', '在用', d(-380)],
  ] };
  const p = path.join(work, 'annual2.xlsx'); writeXlsx(p, book);
  r = run(p, [], 'annual2');
  eq(r.summary.counts.annualDueSoon, 1, '23.10 上次年检 300 天前 → 年度检查临期（90 天窗）');
  eq(r.summary.counts.annualUndetermined, 1, '23.11 年检日期缺失 → 年度检查待核实，不按定检日期代算');
  eq(r.summary.counts.annualOverdue, 1, '23.12 上次年检 380 天前 → 年度检查超期');
  eq(r.summary.counts.normal, 3, '23.13 年度检查状态不影响定期检验分组');
}

// ---- 24. 口径声明与默认输出
r = run(base, [], 'decl');
ok(/车间设备主任 \/ 公司设备管理部门（特种设备管理员）/.test(r.md), '24.1 md 写明提交对象');
ok(/仅供车间设备员复核参考/.test(r.md), '24.2 md 声明行含复核参考');
ok(r.json.meta.ownership.includes('年度检查'), '24.3 meta 写明设备员可做范围');
ok(/不由 GC 级别决定/.test(r.json.meta.basisNote), '24.4 meta 口径说明 GC 不决定周期');
ok(r.json.meta.basisNote.includes('安全阀校验周期以厂内规定为准'), '24.5 meta 口径说明安全阀不代入');

// ---- 25. 2026-11-04 核查补充
// 25.1~25.4 --category 与 --issues 同用：被类别过滤掉的设备在台账中，其整改项不计入本次统计，也不误报「不在台账」
r = run(mixed, ['--category', '压力容器', '--issues', issues], 'cat-issues');
eq(r.summary.counts.openIssues, 2, '25.1 --category 压力容器时起重机械 QZ-91 的整改项不计入（V-91 1 项 + 台账外 ZZ-99 1 项）');
ok(!r.json.openIssues.some((x) => x.tag === 'QZ-91'), '25.2 被类别过滤的设备整改项不进 openIssues');
ok(!r.json.warnings.some((w) => w.includes('QZ-91') && w.includes('不在特种设备台账中')), '25.3 不误报 QZ-91「不在特种设备台账中」');
ok(r.json.warnings.some((w) => /--category/.test(w) && /整改项/.test(w) && /1 项/.test(w)), '25.4 warning 说明按类别排除的整改项数');
// 25.5~25.6 --date 不存在的日历日期（2 月 30 日）报错，不静默顺延到 3 月
x = runRaw(['--input', base, '--workshop', '车间', '--date', '2026-02-30']);
eq(x.s.ok, false, '25.5 --date 2026-02-30 报错');
ok(/不是有效日期/.test(x.s.error || ''), '25.6 非法日历日期错误信息明确');
// 25.7~25.10 4 级监控使用且台账载明下次检验日期（检验机构确定的监控期限）：单列 monitored，按台账日期参与超期/临期/正常分组，不按常规周期推算
{
  const g4 = mk('grade4-dated.xlsx', [
    ['压力容器', 'V-63', '监控罐', '11063', '', '2024-01-15', '监控使用', d(-10), '4级', '罐区', 'φ2000', '在用'],
  ]);
  r = run(g4, [], 'grade4-dated');
  eq(r.summary.counts.monitored, 1, '25.7 4 级有台账日期仍单列监控使用');
  eq(r.summary.counts.overdue, 1, '25.8 监控期限已过按台账日期计超期（不因 4 级漏报超期）');
  eq(r.summary.counts.undetermined, 0, '25.9 有台账日期时不进待核实');
  eq(r.json.overdue[0].calcNext, null, '25.10 4 级不按常规周期推算计算值');
}

// ---- 输出
console.log(`\n${'='.repeat(56)}`);
console.log(`special-equipment-inspection-due 自测：${pass} 通过，${fail} 失败`);
if (failures.length) { console.log('\n失败项：'); failures.forEach((f) => console.log('  ✗ ' + f)); }
console.log('='.repeat(56));
try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
