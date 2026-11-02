#!/usr/bin/env node
'use strict';
/**
 * 自测：生成变体输入并断言 track.js 行为。用法：node scripts/selftest.js（全绿退出 0）
 * 重点覆盖：检测值为空/无法解析 → undetermined 且绝不按 0 计为不泄漏、
 *          可见泄漏按定性口径单独处理不与检测值混算、密封点编号重复不合并、
 *          超期未修含超期天数、合规提示行保留、--ledger 续跟踪与全量台账产出。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { writeXlsx, readXlsx } = require('./lib/xlsx-lite');
const C = require('./lib/common');

const TRACK = path.join(__dirname, 'track.js');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'lpt-selftest-'));
const DATE = '2026-09-21';
const D = (n) => C.addDays(DATE, n);
let pass = 0, fail = 0;
const failures = [];

function ok(cond, name) { if (cond) { pass++; } else { fail++; failures.push(name); } }
function eq(actual, expect, name) { ok(actual === expect, `${name}（期望 ${JSON.stringify(expect)}，实际 ${JSON.stringify(actual)}）`); }

const H = ['密封点编号', '位号', '组件类型', '介质', '介质状态', '检测值', '检测时间', '发现人',
  '泄漏形态', '状态', '首次修复日期', '最终修复日期', '复测值', '责任人', '备注'];

function run(file, extra = [], tag) {
  const out = path.join(work, (tag || path.basename(file, '.xlsx')) + '-out');
  const r = spawnSync(process.execPath, [TRACK, '--input', file, '--workshop', '测试车间', '--date', DATE, '--out', out, ...extra], { encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  let summary;
  try { summary = JSON.parse(lines[lines.length - 1]); } catch (e) { summary = { ok: false, error: 'no-json:' + r.stdout + r.stderr }; }
  let lk = null, md = null;
  if (fs.existsSync(path.join(out, 'leaks.json'))) lk = JSON.parse(fs.readFileSync(path.join(out, 'leaks.json'), 'utf8'));
  if (fs.existsSync(path.join(out, 'leak-report.md'))) md = fs.readFileSync(path.join(out, 'leak-report.md'), 'utf8');
  return { code: r.status, summary, lk, md, out };
}
function mk(name, book) { const p = path.join(work, name); writeXlsx(p, book); return p; }
const find = (arr, no) => arr.find((x) => x.no === no);

// ================= 1. 基础归桶与阈值 =================
const base = mk('base.xlsx', {
  '检测记录': [
    H,
    ['MFD-001', 'P-1', '泵密封', '汽油', '气体', 5200, D(-30), '李', '', '未修复', '', '', '', '王', ''],                      // overdue(final)
    ['MFD-002', 'V-2', '阀门', '瓦斯', '气体', 2600, D(-2), '李', '', '未修复', '', '', '', '王', ''],                        // open
    ['MFD-003', 'P-3', '泵密封', '渣油', '重液', 900, D(-2), '李', '', '未修复', '', '', '', '王', ''],                        // 重液阈值 500 → 泄漏 open
    ['MFD-004', 'P-4', '法兰', '蜡油', '重液', 300, D(-2), '李', '', '', '', '', '', '', ''],                                  // 重液 <500 → noLeak
    ['MFD-005', 'C-5', '连接件', '瓦斯', '气体', 900, D(-2), '李', '', '', '', '', '', '', ''],                                // 气体 <2000 → noLeak
    ['MFD-006', 'P-6', '泵密封', '汽油', '轻液', 4000, D(-14), '李', '', '已修复', D(-10), D(-4), 200, '王', ''],              // repaired
  ],
});
let r = run(base, [], 'base');
eq(r.summary.ok, true, '1.1 基础运行成功');
eq(r.summary.counts.records, 6, '1.2 记录数');
eq(r.summary.counts.leaks, 4, '1.3 认定泄漏数（含重液超 500 的一条）');
eq(r.summary.counts.overdue, 1, '1.4 超期未修数');
eq(r.summary.counts.open, 2, '1.5 期限内未修数');
eq(r.summary.counts.repaired, 1, '1.6 修复闭环数');
eq(r.summary.counts.noLeak, 2, '1.7 未认定泄漏数');
eq(r.summary.metrics.repairRate, 25, '1.8 修复率 1/4 = 25%');
eq(find(r.lk.items, 'MFD-003').threshold, 500, '1.9 重液按 500 阈值判定');
eq(find(r.lk.items, 'MFD-002').threshold, 2000, '1.10 气体按 2000 阈值判定');
eq(find(r.lk.items, 'MFD-004').isLeak, false, '1.11 重液 300 < 500 未认定泄漏');
eq(find(r.lk.items, 'MFD-005').isLeak, false, '1.12 气体 900 < 2000 未认定泄漏');
eq(r.lk.metrics.thresholds.voc, 2000, '1.13 默认 VOCs 阈值 2000');
eq(r.lk.metrics.thresholds.liquid, 500, '1.14 默认重液阈值 500');
eq(r.lk.metrics.limits.repairDays, 5, '1.15 默认首次修复时限 5 天');
eq(r.lk.metrics.limits.finalDays, 15, '1.16 默认最终修复时限 15 天');

// ================= 2. 检测值为空/无法解析 → undetermined，绝不按 0 计为不泄漏（环保合规红线）=================
const undet = mk('undet.xlsx', {
  '检测记录': [
    H,
    ['MFD-101', 'P-1', '泵密封', '汽油', '轻液', '', D(-4), '孙', '', '', '', '', '', '', '仪器故障未测'],        // 检测值空 + 形态空
    ['MFD-102', 'V-2', '阀门', '瓦斯', '气体', '超量程', D(-4), '孙', '', '', '', '', '', '', ''],                // 检测值无法解析
    ['MFD-103', 'X-3', '取样口', '', '', 3000, D(-4), '孙', '', '未修复', '', '', '', '孙', ''],                  // 有值但介质状态缺失 → 阈值不定
    ['MFD-104', 'Y-4', '法兰', '瓦斯', '未知相', 3000, D(-4), '孙', '', '未修复', '', '', '', '孙', ''],          // 介质状态无法归类
    ['MFD-105', 'P-5', '泵密封', '瓦斯', '气体', 300, D(-4), '孙', '', '', '', '', '', '', ''],                   // 对照：真正的不泄漏
  ],
});
r = run(undet, [], 'undet');
eq(r.summary.counts.undetermined, 4, '2.1 四类缺数据情形均归入 undetermined');
eq(r.summary.counts.noLeak, 1, '2.2 仅真正低于阈值的一条计为未认定泄漏');
ok(!r.lk.noLeak.some((x) => ['MFD-101', 'MFD-102', 'MFD-103', 'MFD-104'].includes(x.no)), '2.3 未判定项绝不混入未认定泄漏');
eq(find(r.lk.items, 'MFD-101').value, null, '2.4 检测值为空输出 null 而非 0');
eq(find(r.lk.items, 'MFD-102').value, null, '2.5 检测值无法解析输出 null 而非 0');
eq(find(r.lk.items, 'MFD-101').isLeak, null, '2.6 未判定项 isLeak 为 null，既不判泄漏也不判不泄漏');
ok(/未按 0 计为不泄漏/.test(find(r.lk.undetermined, 'MFD-101').reason), '2.7 未判定原因写明未按 0 计');
ok(/无法解析/.test(find(r.lk.undetermined, 'MFD-102').reason), '2.8 无法解析的检测值原因正确');
ok(/阈值/.test(find(r.lk.undetermined, 'MFD-103').reason), '2.9 介质状态缺失时说明阈值无法确定');
ok(r.lk.warnings.some((w) => /超量程/.test(w) && /未按 0 计为不泄漏/.test(w)), '2.10 检测值无法解析有专项 warning');
ok(r.lk.warnings.some((w) => /第\d+行/.test(w) && /超量程/.test(w)), '2.11 warning 具体到行号');
ok(/## 六、未判定清单/.test(r.md), '2.12 未判定单列成节');
ok(/未按 0 计为不泄漏/.test(r.md), '2.13 md 明示未按 0 计为不泄漏');
eq(r.summary.metrics.repairRate, null, '2.14 无认定泄漏时修复率为 null');
ok(/修复率：\*\*—\*\*/.test(r.md), '2.15 修复率显示「—」');
ok(!/修复率：\*\*0\.0%\*\*/.test(r.md), '2.16 分母为 0 时绝不写 0%');

// ================= 3. 可见泄漏定性口径，不与仪器检测值混算 =================
const vis = mk('visible.xlsx', {
  '检测记录': [
    H,
    ['MFD-201', 'V-1', '阀门', '柴油', '轻液', '', D(-20), '赵', '阀杆处连续滴漏', '未修复', '', '', '', '赵', ''],     // 滴漏 → 认定泄漏 overdue
    ['MFD-202', 'T-2', '法兰', '污油', '重液', '', D(-3), '赵', '法兰成股流出', '未修复', '', '', '', '赵', ''],         // 成股流出 → 认定泄漏 open
    ['MFD-203', 'T-3', '法兰', '污油', '重液', '', D(-3), '赵', '法兰面渗油有油迹', '', '', '', '', '赵', ''],           // 渗漏 → 观察项，不认定
    ['MFD-204', 'P-4', '泵密封', '汽油', '气体', 4000, D(-3), '李', '', '未修复', '', '', '', '王', ''],                 // 仪器检测泄漏（对照）
  ],
});
r = run(vis, [], 'visible');
eq(r.summary.counts.visible, 3, '3.1 可见泄漏来源记录数');
eq(r.summary.counts.visibleLeaks, 2, '3.2 滴漏与成股流出认定为泄漏');
eq(r.summary.counts.instrument, 1, '3.3 仪器检测来源记录数单独统计');
eq(r.summary.counts.instrumentLeaks, 1, '3.4 仪器检测认定泄漏数单独统计');
eq(find(r.lk.items, 'MFD-201').value, null, '3.5 可见泄漏无检测值，不折算浓度');
eq(find(r.lk.items, 'MFD-201').threshold, null, '3.6 可见泄漏不套用浓度阈值');
eq(find(r.lk.items, 'MFD-201').source, 'visible', '3.7 来源标记为现场可见泄漏');
ok(/不与检测浓度混算/.test(find(r.lk.items, 'MFD-201').leakBasis), '3.8 认定依据写明不与检测浓度混算');
eq(find(r.lk.items, 'MFD-203').isLeak, false, '3.9 渗漏列为观察项，未认定泄漏');
ok(/观察项/.test(find(r.lk.items, 'MFD-203').leakBasis), '3.10 渗漏依据写明观察项');
eq(find(r.lk.items, 'MFD-203').bucket, 'noLeak', '3.11 渗漏不进超期或未判定');
ok(/两类来源分别统计，不混算/.test(r.md), '3.12 md 声明两类来源不混算');
ok(r.summary.counts.instrument + r.summary.counts.visible + r.summary.counts.undetermined === r.summary.counts.records, '3.13 两类来源与未判定之和等于记录数');

// ================= 4. 密封点编号重复 → warning 并保留两条，不自动合并 =================
const dup = mk('dup.xlsx', {
  '检测记录': [
    H,
    ['MFD-301', 'P-1A', '泵密封', '汽油', '气体', 4200, D(-20), '周', '', '未修复', '', '', '', '周', ''],
    ['MFD-301', 'P-1B', '泵密封', '汽油', '气体', 3100, D(-20), '周', '', '未修复', '', '', '', '周', '编号填重'],
  ],
});
r = run(dup, [], 'dup');
eq(r.summary.counts.records, 2, '4.1 编号重复的两条均保留');
eq(r.summary.counts.duplicateNo, 1, '4.2 重复条目计数');
eq(r.summary.counts.overdue, 2, '4.3 两条各自判定，均为超期');
ok(r.lk.warnings.some((w) => w.includes('MFD-301') && w.includes('重复') && w.includes('未自动合并')), '4.4 重复编号 warning 写明未自动合并');
ok(r.lk.warnings.some((w) => /第\d+行.*第\d+行/.test(w)), '4.5 重复 warning 标出两处行号');
ok(r.lk.duplicates.length === 1 && r.lk.duplicates[0].dupOfRow === 2, '4.6 duplicates 记录与之重复的行号');
ok(/## 八、编号重复与数据提示/.test(r.md) && /未自动合并/.test(r.md), '4.7 编号重复单列成节且声明不合并');
ok(r.lk.items[0].tag === 'P-1A' && r.lk.items[1].tag === 'P-1B', '4.8 两条位号各自保留，未被覆盖');

// ================= 5. 超期未修含超期天数（首次 / 最终两类）=================
const ovd = mk('overdue.xlsx', {
  '检测记录': [
    H,
    ['MFD-401', 'P-1', '泵密封', '汽油', '气体', 4000, D(-21), '李', '', '未修复', '', '', '', '王', ''],              // 最终超期 6 天
    ['MFD-402', 'V-2', '阀门', '瓦斯', '气体', 4000, D(-9), '李', '', '未修复', '', '', '', '王', ''],                 // 首次超期 4 天，最终未到期
    ['MFD-403', 'P-3', '泵密封', '汽油', '气体', 4000, D(-3), '李', '', '未修复', '', '', '', '王', ''],               // 期限内
    ['MFD-404', 'P-4', '泵密封', '汽油', '气体', 4000, D(-9), '李', '', '已临时修复', D(-7), '', '', '王', ''],        // 已首次修复，最终未到期 → open
  ],
});
r = run(ovd, [], 'overdue');
eq(r.summary.counts.overdue, 2, '5.1 超期未修数');
eq(find(r.lk.overdue, 'MFD-401').finalOverdueDays, 6, '5.2 最终修复超期天数');
eq(find(r.lk.overdue, 'MFD-401').overdueOf, 'final', '5.3 超期类型为最终修复');
eq(find(r.lk.overdue, 'MFD-402').firstOverdueDays, 4, '5.4 首次修复超期天数');
eq(find(r.lk.overdue, 'MFD-402').overdueOf, 'first', '5.5 超期类型为首次修复');
eq(find(r.lk.overdue, 'MFD-402').finalOverdueDays, null, '5.6 最终修复未到期时不虚报最终超期');
eq(find(r.lk.items, 'MFD-403').bucket, 'open', '5.7 期限内未修归 open 不进超期');
eq(find(r.lk.items, 'MFD-404').bucket, 'open', '5.8 已首次修复且最终未到期归 open');
ok(/## 三、超期未修清单/.test(r.md) && /超期天数/.test(r.md), '5.9 超期清单单列成节且含超期天数列');
ok(/最长超期 6 天/.test(r.md), '5.10 开头提示写明最长超期天数');
ok(r.lk.overdue[0].no === 'MFD-401', '5.11 超期清单按超期天数降序');
// 已认定泄漏但检测时间缺失 → 时限无法计算，不虚报超期
const noDate = mk('nodate.xlsx', {
  '检测记录': [H, ['MFD-411', 'P-1', '泵密封', '汽油', '气体', 4000, '', '李', '', '未修复', '', '', '', '王', '']],
});
r = run(noDate, [], 'nodate');
eq(r.summary.counts.overdue, 0, '5.12 检测时间缺失时不按超期处理');
eq(r.summary.counts.open, 1, '5.13 时限无法计算的泄漏点仍在未修复清单中跟踪');
eq(find(r.lk.items, 'MFD-411').finalDue, null, '5.14 时限为 null 未被推定');
ok(r.lk.warnings.some((w) => /检测时间缺失/.test(w) && /修复时限无法计算/.test(w)), '5.15 时限无法计算有 warning');

// ================= 6. 合规提示行必须保留 =================
r = run(base, [], 'compliance');
ok(/不替代法定 LDAR 检测报告/.test(r.md), '6.1 合规提示行含「不替代法定 LDAR 检测报告」');
ok(/以现行法规与厂内规定为准/.test(r.md), '6.2 合规提示行含法规口径声明');
ok(/生态环境主管部门/.test(r.md), '6.3 合规提示行含达标判定归属');
ok(r.md.indexOf('不替代法定 LDAR 检测报告') < r.md.indexOf('## 一、总体概览'), '6.4 合规提示行位于第一节之前');
ok(/默认参考口径（references\/ldar-rules\.md/.test(r.md), '6.5 默认口径在报告中标注出处');

// ================= 7. --ledger 续跟踪与全量台账 =================
const ledgerFile = mk('ledger.xlsx', {
  '漏点台账': [
    ['密封点编号', '位号', '组件类型', '介质', '介质状态', '检测值', '检测时间', '发现人', '泄漏形态', '状态', '首次修复日期', '最终修复日期', '复测值', '责任人', '备注'],
    ['MFD-001', 'P-1', '泵密封', '汽油', '气体', 6800, D(-60), '李', '', '未修复', '', '', '', '王', '上期已登记'],
    ['MFD-900', 'P-9', '泵密封', '瓦斯', '气体', 2800, D(-45), '李', '', '已修复', D(-42), D(-35), 180, '王', '本期未复测'],
  ],
});
r = run(base, [], 'noledger');
eq(r.summary.counts.newLeaks, 4, '7.1 未提供台账时认定泄漏全部按新增');
ok(r.lk.warnings.some((w) => /未提供历史漏点台账/.test(w)), '7.2 未提供台账有 warning');
ok(/未提供历史漏点台账/.test(r.md), '7.3 md 说明未提供历史台账');
r = run(base, ['--ledger', ledgerFile], 'withledger');
eq(r.summary.ok, true, '7.4 提供历史台账运行成功');
eq(r.summary.counts.newLeaks, 3, '7.5 历史已登记的漏点不再计为新增');
eq(r.summary.counts.carryOver, 1, '7.6 历史续跟踪漏点计数');
eq(find(r.lk.items, 'MFD-001').isNew, false, '7.7 历史台账中的编号标记为续跟踪');
eq(r.lk.meta.ledgerProvided, true, '7.8 meta 记录已提供台账');
eq(r.lk.ledger.length, 7, '7.9 全量台账 = 本期 6 条 + 历史未复测 1 条');
ok(r.lk.ledger.some((x) => x['密封点编号'] === 'MFD-900' && /历史台账/.test(x['来源'])), '7.10 本期未复测的历史条目保留在台账中');
ok(r.lk.ledger.some((x) => x['密封点编号'] === 'MFD-001' && x['来源'] === '历史续跟踪'), '7.11 本期复测的历史条目标为续跟踪');
ok(fs.existsSync(path.join(r.out, 'ledger.xlsx')), '7.12 ledger.xlsx 已落盘');
const lb = readXlsx(path.join(r.out, 'ledger.xlsx'));
ok(lb['漏点台账'] && lb['漏点台账'].length === 8, '7.13 ledger.xlsx 含表头 + 7 条记录');
ok(lb['漏点台账'][0].includes('超期天数') && lb['漏点台账'][0].includes('认定依据'), '7.14 ledger.xlsx 含超期天数与认定依据列');
// 台账文件缺「漏点台账」工作表 → warning 不中断
const badLedger = mk('badledger.xlsx', { '随便一张表': [['a'], [1]] });
r = run(base, ['--ledger', badLedger], 'badledger');
eq(r.summary.ok, true, '7.15 台账工作表缺失不中断');
ok(r.lk.warnings.some((w) => /未找到「漏点台账」工作表/.test(w)), '7.16 台账工作表缺失有 warning');

// ================= 8. 阈值与时限参数覆盖 =================
const thr = mk('thr.xlsx', {
  '检测记录': [
    H,
    ['MFD-501', 'P-1', '泵密封', '汽油', '气体', 1200, D(-2), '李', '', '未修复', '', '', '', '王', ''],
    ['MFD-502', 'P-2', '泵密封', '渣油', '重液', 300, D(-2), '李', '', '未修复', '', '', '', '王', ''],
  ],
});
r = run(thr, [], 'thr-default');
eq(r.summary.counts.leaks, 0, '8.1 默认阈值下两条均不认定泄漏');
r = run(thr, ['--threshold-voc', '1000'], 'thr-voc');
eq(r.summary.counts.leaks, 1, '8.2 --threshold-voc 覆盖后气体条认定泄漏');
eq(r.lk.metrics.thresholds.voc, 1000, '8.3 覆盖后阈值写入 JSON');
r = run(thr, ['--threshold-liquid', '200'], 'thr-liq');
eq(r.summary.counts.leaks, 1, '8.4 --threshold-liquid 覆盖后重液条认定泄漏');
ok(/用户指定口径/.test(r.lk.meta.rulesSource) && /--threshold-liquid/.test(r.lk.meta.rulesSource), '8.5 报告标注用户指定口径与覆盖项');
ok(/用户指定口径/.test(r.md), '8.6 md 标注用户指定口径');
const lim = mk('lim.xlsx', {
  '检测记录': [H, ['MFD-601', 'P-1', '泵密封', '汽油', '气体', 4000, D(-8), '李', '', '未修复', '', '', '', '王', '']],
});
r = run(lim, [], 'lim-default');
eq(r.summary.counts.overdue, 1, '8.7 默认 5 天首次修复时限下已超期');
r = run(lim, ['--repair-days', '10', '--final-days', '30'], 'lim-override');
eq(r.summary.counts.overdue, 0, '8.8 放宽时限后不再超期');
eq(r.lk.metrics.limits.repairDays, 10, '8.9 覆盖后首次修复时限写入 JSON');
eq(r.lk.metrics.limits.finalDays, 30, '8.10 覆盖后最终修复时限写入 JSON');
ok(/首次修复 10 天内，最终修复 30 天内/.test(r.md), '8.11 md 写明采用的时限');

// ================= 9. 修复闭环判定 =================
const rep = mk('repair.xlsx', {
  '检测记录': [
    H,
    ['MFD-701', 'P-1', '泵密封', '汽油', '气体', 4000, D(-14), '李', '', '已修复', D(-10), D(-4), 200, '王', ''],       // repaired
    ['MFD-702', 'P-2', '泵密封', '汽油', '气体', 4000, D(-14), '李', '', '已修复', D(-10), '', '', '王', ''],           // 状态已修复但无最终修复日期 → 不计闭环
    ['MFD-703', 'P-3', '泵密封', '汽油', '气体', 4000, D(-30), '李', '', '已修复', D(-25), D(-3), 200, '王', ''],       // 超时限后修复
  ],
});
r = run(rep, [], 'repair');
eq(r.summary.counts.repaired, 2, '9.1 仅填写最终修复日期的两条计入闭环');
ok(!find(r.lk.repaired, 'MFD-702'), '9.2 无最终修复日期的「已修复」不计闭环');
eq(find(r.lk.items, 'MFD-702').bucket, 'open', '9.3 无最终修复日期的项仍在未修复中跟踪');
ok(r.lk.warnings.some((w) => /MFD-702/.test(w) && /未填最终修复日期/.test(w)), '9.4 无最终修复日期有 warning');
eq(find(r.lk.repaired, 'MFD-703').lateDays, 12, '9.5 超时限修复标注延迟天数');
eq(find(r.lk.repaired, 'MFD-701').lateDays, null, '9.6 时限内修复不标延迟');
eq(r.summary.metrics.repairRate, 66.7, '9.7 修复率 2/3');
eq(r.summary.metrics.avgRepairDays, 18.5, '9.8 平均修复时长基于可计算项');
ok(/## 七、本期修复闭环/.test(r.md) && /不计入闭环/.test(r.md), '9.9 闭环节声明无最终修复日期不计闭环');

// ================= 10. 修复状态缺失 / 无法识别 =================
const stt = mk('status.xlsx', {
  '检测记录': [
    H,
    ['MFD-801', 'P-1', '泵密封', '汽油', '气体', 4000, D(-3), '李', '', '', '', '', '', '王', ''],          // 已认定泄漏但状态空
    ['MFD-802', 'P-2', '泵密封', '汽油', '气体', 4000, D(-3), '李', '', '待定', '', '', '', '王', ''],      // 状态无法归类
    ['MFD-803', 'P-3', '泵密封', '汽油', '气体', 300, D(-3), '李', '', '', '', '', '', '', ''],             // 未认定泄漏，状态空不影响
  ],
});
r = run(stt, [], 'status');
eq(r.summary.counts.undetermined, 2, '10.1 已认定泄漏但状态缺失/无法识别 → undetermined');
eq(r.summary.counts.noLeak, 1, '10.2 未认定泄漏的记录不因状态空而未判定');
ok(/修复状态未填/.test(find(r.lk.undetermined, 'MFD-801').reason), '10.3 状态未填原因正确');
ok(/无法归类/.test(find(r.lk.undetermined, 'MFD-802').reason), '10.4 状态无法归类原因正确');
ok(r.lk.warnings.some((w) => /待定/.test(w) && /无法归类/.test(w)), '10.5 状态无法归类有 warning');
ok(!r.lk.overdue.length, '10.6 状态未判定的项不进超期清单');

// ================= 11. 别名列头 + 标题行 + 合计行 + 缺列 =================
const messy = mk('messy.xlsx', {
  '漏点记录': [
    ['某某炼化厂 LDAR 密封点检测记录（导出）'],
    [],
    ['密封点号', '设备位号', '密封点类型', '物料', '相态', '检测浓度', '检测日期', '检测人', '泄漏现象', '修复状态', '首次修复时间', '最终修复时间', '复测浓度', '修复责任人', '说明'],
    ['MFD-A01', 'P-1', '泵密封', '汽油', '气体', 4200, D(-20), '周', '', '未修复', '', '', '', '周', ''],
    ['MFD-A02', 'P-2', '泵密封', '汽油', '气体', 900, D(-3), '周', '', '', '', '', '', '', ''],
    ['合计', '2 条', '', '', '', '', '', '', '', '', '', '', '', '', ''],
  ],
});
r = run(messy, [], 'messy');
eq(r.summary.ok, true, '11.1 别名列头 + 标题行可读');
eq(r.summary.counts.records, 2, '11.2 合计行被跳过');
ok(r.lk.warnings.some((w) => w.includes('合计行')), '11.3 合计行 warning');
eq(r.summary.counts.overdue, 1, '11.4 别名表判定正确');
eq(r.lk.meta.sheet, '漏点记录', '11.5 「漏点记录」工作表名可识别');
const nocol = mk('nocol.xlsx', {
  '检测记录': [
    ['密封点编号', '位号', '检测值'],
    ['MFD-B01', 'P-1', 4000],
    ['MFD-B02', 'P-2', ''],
  ],
});
r = run(nocol, [], 'nocol');
eq(r.summary.ok, true, '11.6 缺可选列不中断');
eq(r.summary.counts.undetermined, 2, '11.7 缺介质与形态列时两条均未判定');
eq(r.summary.counts.noLeak, 0, '11.8 缺列时绝不默认判为不泄漏');

// ================= 12. 空行、空编号、Excel 日期序列号 =================
const blank = mk('blank.xlsx', {
  '检测记录': [
    H,
    ['', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['', 'P-9', '泵密封', '汽油', '气体', 4000, D(-20), '李', '', '未修复', '', '', '', '王', ''],   // 无编号有位号
    ['MFD-C01', 'P-8', '泵密封', '汽油', '气体', 300, D(-3), '李', '', '', '', '', '', '', ''],
  ],
});
r = run(blank, [], 'blank');
eq(r.summary.counts.records, 2, '12.1 全空行跳过，无编号但有位号的行保留');
ok(r.lk.warnings.some((w) => /密封点编号为空/.test(w)), '12.2 空编号有 warning');
ok(r.lk.items.some((x) => /无编号/.test(x.no)), '12.3 空编号项以行号标识');
const serial = mk('serial.xlsx', {
  '检测记录': [H, ['MFD-D01', 'P-1', '泵密封', '汽油', '气体', 4000, 46280, '李', '', '未修复', '', '', '', '王', '']],
});
r = run(serial, [], 'serial');
eq(r.summary.ok, true, '12.4 Excel 日期序列号可解析');
eq(find(r.lk.items, 'MFD-D01').foundDate, '2026-09-15', '12.5 序列号按墙钟转为日期');

// ================= 13. 参数校验 =================
function runRaw(args) {
  const rr = spawnSync(process.execPath, [TRACK, ...args], { encoding: 'utf8' });
  const lines = rr.stdout.trim().split('\n');
  try { return { code: rr.status, s: JSON.parse(lines[lines.length - 1]) }; } catch (e) { return { code: rr.status, s: { ok: false, error: 'no-json' } }; }
}
let x = runRaw(['--input']);
eq(x.s.ok, false, '13.1 --input 缺值报错');
eq(x.code, 1, '13.2 退出码为 1');
ok(/缺少取值/.test(x.s.error), '13.3 缺值错误信息正确');
x = runRaw(['--input', base, '--workshop', '车间', '--date', '2026-13-45']);
eq(x.s.ok, false, '13.4 非法日期报错');
x = runRaw(['--input', base, '--workshop', '车间', '--date', DATE, '--未知参数', 'x']);
eq(x.s.ok, false, '13.5 未知参数报错');
x = runRaw(['--input', '/不存在的检测记录.xlsx', '--workshop', '车间', '--date', DATE]);
eq(x.s.ok, false, '13.6 输入不存在报错');
x = runRaw(['--input', base, '--workshop', '车间']);
eq(x.s.ok, false, '13.7 缺 --date 报错');
x = runRaw(['--input', base, '--workshop', '车间', '--date', DATE, '--ledger', '/不存在的台账.xlsx']);
eq(x.s.ok, false, '13.8 --ledger 文件不存在报错');
x = runRaw(['--input', base, '--workshop', '车间', '--date', DATE, '--threshold-voc', '负数']);
eq(x.s.ok, false, '13.9 阈值非数值报错');
x = runRaw(['--input', base, '--workshop', '车间', '--date', DATE, '--threshold-voc', '-1']);
eq(x.s.ok, false, '13.10 阈值为负数报错');
x = runRaw(['--input', base, '--workshop', '车间', '--date', DATE, '--repair-days', '20', '--final-days', '10']);
eq(x.s.ok, false, '13.11 最终修复时限早于首次修复时限报错');
x = runRaw(['--input', base, '--date', DATE]);
eq(x.s.ok, false, '13.12 缺 --workshop 报错');

// ================= 14. 无检测记录工作表 → ok:false =================
const bad = mk('bad.xlsx', { '随便一张表': [['a', 'b'], [1, 2]] });
r = run(bad, [], 'bad');
eq(r.summary.ok, false, '14.1 无检测记录工作表时 ok:false');
eq(r.code, 1, '14.2 退出码为 1');
ok(/未在输入中找到/.test(r.summary.error), '14.3 错误信息明确');

// ================= 15. 声明行、章节、占位符、产出落盘 =================
r = run(base, [], 'struct');
ok(/## 一、总体概览/.test(r.md) && /## 二、本期新增漏点/.test(r.md) && /## 三、超期未修清单/.test(r.md)
  && /## 四、未修复（期限内）/.test(r.md) && /## 五、延迟修复（经批准）/.test(r.md) && /## 六、未判定清单/.test(r.md)
  && /## 七、本期修复闭环/.test(r.md) && /## 八、编号重复与数据提示/.test(r.md) && /## 九、泄漏管理情况说明/.test(r.md), '15.1 九节结构齐全');
ok(/<!-- ANALYSIS_START -->/.test(r.md) && /<!-- ANALYSIS_END -->/.test(r.md), '15.2 分析段占位符存在');
ok(!/[\u2600-\u27BF\u{1F300}-\u{1FAFF}]/u.test(r.md), '15.2a md 不含 emoji');
ok(/【注意】/.test(r.md), '15.2b 醒目提示用「【注意】」');
ok(/制度出处：GB 31570 与中国石化 LDAR 管理要求/.test(r.md), '15.2c md 写明制度出处（名称引用）');
ok(!/GB 31570[^\n]*(2000|500|5 天|15 天)/.test(r.md), '15.2d 出处行不转述法规数值');
ok(/维修通知单/.test(r.md), '15.2e 术语用「维修通知单」（通知单由车间设备员提，工单由计划员建）');
ok(/车间设备主任 \/ 公司设备管理部门/.test(r.md), '15.2f 交付对象为车间设备主任 / 公司设备管理部门');
ok(Array.isArray(r.lk.delayed) && Array.isArray(r.lk.unreachable), '15.2g leaks.json 含 delayed/unreachable 数组');
ok(/【未判定】未提供密封点总数/.test(r.md), '15.2h 未提供密封点总数时单列未判定说明');
eq(r.lk.metrics.leakRate.static.rate, null, '15.2i 未提供密封点总数时静密封泄漏率为 null');
eq(r.lk.metrics.leakRate.dynamic.rate, null, '15.2j 未提供密封点总数时动密封泄漏率为 null');
ok(/\| 静密封点 \| \d+ \| — \| — \|/.test(r.md) && /\| 动密封点 \| \d+ \| — \| — \|/.test(r.md), '15.2k 泄漏率未计算时表中显示「—」而非 0‰');
ok(r.lk.warnings.some((w) => /未提供密封点总数/.test(w)), '15.2l 未提供密封点总数有 warning');
ok(r.lk.meta.sourceLine && /GB 31570/.test(r.lk.meta.sourceLine), '15.2m meta 含制度出处行');
ok(/泄漏率考核线以现行法规与厂内规定为准/.test(r.md), '15.2n 合规提示行含泄漏率考核线口径');
ok(fs.existsSync(path.join(r.out, 'leaks.json')), '15.3 leaks.json 已写入');
ok(fs.existsSync(path.join(r.out, 'leak-report.md')), '15.4 leak-report.md 已写入');
ok(fs.existsSync(path.join(r.out, 'ledger.xlsx')), '15.5 ledger.xlsx 已写入');
ok(fs.existsSync(path.join(r.out, 'summary.json')), '15.6 summary.json 已写入');
const sj = JSON.parse(fs.readFileSync(path.join(r.out, 'summary.json'), 'utf8'));
eq(sj.ok, true, '15.7 summary.json 内容正确');
ok(typeof sj.counts.leaks === 'number' && sj.metrics.thresholds && sj.metrics.limits, '15.8 summary.json 含 counts 与口径');
ok(Array.isArray(r.lk.newLeaks) && Array.isArray(r.lk.open) && Array.isArray(r.lk.overdue)
  && Array.isArray(r.lk.repaired) && Array.isArray(r.lk.undetermined) && Array.isArray(r.lk.ledger),
  '15.9 leaks.json 含 newLeaks/open/overdue/repaired/undetermined/ledger 六个数组');
// 无超期、无未判定 → 不生成告警
const clean = mk('clean.xlsx', {
  '检测记录': [
    H,
    ['MFD-E01', 'P-1', '泵密封', '汽油', '气体', 4000, D(-14), '李', '', '已修复', D(-10), D(-4), 200, '王', ''],
    ['MFD-E02', 'P-2', '泵密封', '汽油', '气体', 300, D(-3), '李', '', '', '', '', '', '', ''],
  ],
});
r = run(clean, [], 'clean');
ok(!/重点提示/.test(r.md), '15.10 无超期无未判定时不出现告警提示');
ok(!/✅|⚠️/.test(r.md), '15.10a 无告警场景亦不含 emoji');
ok(/本期无超期未修漏点，亦无因数据缺失而未判定的记录/.test(r.md), '15.11 改为无告警说明');
eq(r.summary.metrics.repairRate, 100, '15.12 全部修复时修复率 100%');
ok(/不替代法定 LDAR 检测报告/.test(r.md), '15.13 无告警时合规提示行依然保留');


// ================= 16. 中石化系统别名（mergeAliases）与过宽别名剔除 =================
const sapcol = mk('sapcol.xlsx', {
  'LDAR检测数据': [
    ['序号', '密封点标签号', '功能位置', '设备', '工厂区段', '组件类型', '组件子类型', '密封类型', '介质名称', '相态', '检测方法', '检测净值', '检测日期', '检测人员', '是否不可达', '修复状态', '首次修复日期', '最终修复日期', '复测日期', '复测浓度', '延迟修复批准日期', '延迟修复批准人', '修复责任人'],
    [1, 'LD-0001', 'P-1101A', '10001234', '常减压一单元', '泵密封', '机械密封', '动密封', '汽油', '轻液', 'HJ 733', 4200, D(-20), '周', '否', '未修复', '', '', '', '', '', '', '周'],
    [2, 'LD-0002', 'V-1102', '10001235', '常减压一单元', '阀门', '闸阀', '静密封', '瓦斯', '气体', 'HJ 733', 2600, D(-30), '周', '否', '延迟修复', '', '', '', '', D(-16), '车间主任', '周'],
    [3, 'LD-0003', 'V-1103', '10001236', '常减压一单元', '阀门', '截止阀', '静密封', '瓦斯', '气体', 'HJ 733', 2600, D(-30), '周', '否', '延迟修复', '', '', '', '', '', '', '周'],
    [4, 'LD-0004', 'E-1104', '10001237', '常减压一单元', '法兰', '', '静密封', '柴油', '轻液', '', '', D(-3), '周', '是', '', '', '', '', '', '', '', ''],
    [5, 'LD-0005', 'P-1105', '10001238', '常减压一单元', '泵密封', '', '', '汽油', '轻液', 'OGI', 3000, D(-14), '周', '否', '已修复', D(-10), D(-4), D(-3), 150, '', '', '周'],
  ],
});
r = run(sapcol, [], 'sapcol');
eq(r.summary.ok, true, '16.1 LDAR 系统 / SAP 列名可读（LDAR检测数据 sheet）');
eq(r.summary.counts.records, 5, '16.2 「序号」列不再被当作密封点编号（记录数按标签号计）');
eq(find(r.lk.items, 'LD-0001').no, 'LD-0001', '16.3 「密封点标签号」命中密封点编号');
eq(find(r.lk.items, 'LD-0001').tag, 'P-1101A', '16.4 SAP「功能位置」命中位号');
eq(find(r.lk.items, 'LD-0001').equipNo, '10001234', '16.5 SAP「设备」8 位流水号归设备编号而非位号');
eq(find(r.lk.items, 'LD-0001').unit, '常减压一单元', '16.6 SAP「工厂区段」命中装置');
eq(find(r.lk.items, 'LD-0001').subComp, '机械密封', '16.7 组件子类型可读');
eq(find(r.lk.items, 'LD-0001').method, 'HJ 733', '16.8 检测方法可读');
eq(find(r.lk.items, 'LD-0001').sealType, 'dynamic', '16.9 密封类型列「动密封」命中');
eq(find(r.lk.items, 'LD-0002').sealType, 'static', '16.10 密封类型列「静密封」命中');
eq(find(r.lk.items, 'LD-0005').sealType, 'dynamic', '16.11 密封类型缺失时按组件类型「泵密封」推定动密封');
ok(/推定/.test(find(r.lk.items, 'LD-0005').sealBasis), '16.12 推定来源写明');
eq(find(r.lk.items, 'LD-0005').retestDate, D(-3), '16.13 复测日期可读');
eq(find(r.lk.items, 'LD-0001').value, 4200, '16.14 「检测净值」命中检测值');
ok(r.lk.ledger[0]['设备编号'] !== undefined && r.lk.ledger[0]['检测方法'] !== undefined && r.lk.ledger[0]['复测日期'] !== undefined, '16.15 台账含设备编号/检测方法/复测日期列');
const lbx = readXlsx(path.join(r.out, 'ledger.xlsx'));
ok(lbx['漏点台账'][0].includes('密封类型') && lbx['漏点台账'][0].includes('延迟修复批准日期') && lbx['漏点台账'][0].includes('不可达点'), '16.16 ledger.xlsx 含密封类型/延迟修复批准日期/不可达点列');

// ================= 17. 延迟修复：有批准日期单列不计超期；无批准日期 → 未判定（不按已批准也不按超期）=================
eq(r.summary.counts.delayed, 1, '17.1 有批准日期的延迟修复计 1');
eq(find(r.lk.items, 'LD-0002').bucket, 'delayed', '17.2 LD-0002 归 delayed');
eq(find(r.lk.items, 'LD-0002').finalOverdueDays, null, '17.3 延迟修复不计最终超期天数');
ok(!find(r.lk.overdue, 'LD-0002'), '17.4 延迟修复不进超期清单');
eq(find(r.lk.items, 'LD-0002').delayApproval, D(-16), '17.5 批准日期可读');
eq(find(r.lk.items, 'LD-0002').delayApprover, '车间主任', '17.6 批准人可读');
eq(find(r.lk.items, 'LD-0003').bucket, 'undetermined', '17.7 延迟修复无批准日期 → undetermined');
ok(/未填延迟修复批准日期/.test(find(r.lk.undetermined, 'LD-0003').reason), '17.8 未判定原因写明缺批准日期');
ok(!find(r.lk.overdue, 'LD-0003') && !find(r.lk.delayed, 'LD-0003'), '17.9 无批准日期的延迟修复既不进超期也不进延迟修复清单');
ok(/## 五、延迟修复（经批准）/.test(r.md) && /LD-0002/.test(r.md.split('## 五、延迟修复')[1].split('## 六')[0]), '17.10 延迟修复单列成节且列出 LD-0002');
ok(/无批准日期/.test(r.md), '17.11 md 说明无批准日期的延迟修复进未判定');
ok(r.lk.delayed.length === 1 && r.lk.delayed[0].bucketCn === '延迟修复（经批准）', '17.12 delayed 数组与中文归类');

// ================= 18. 不可达点 =================
eq(r.summary.counts.unreachable, 1, '18.1 不可达点计数');
eq(find(r.lk.items, 'LD-0004').unreachable, true, '18.2 「是否不可达」=是 → unreachable');
eq(find(r.lk.items, 'LD-0004').bucket, 'undetermined', '18.3 不可达点无检测值 → 未判定而非不泄漏');
ok(/不可达点/.test(find(r.lk.undetermined, 'LD-0004').reason), '18.4 未判定原因写明不可达点');
eq(find(r.lk.items, 'LD-0004').isLeak, null, '18.5 不可达点 isLeak 为 null');
ok(!r.lk.noLeak.some((x) => x.no === 'LD-0004'), '18.6 不可达点不进未认定泄漏');
ok(r.lk.unreachable.length === 1 && r.lk.unreachable[0].no === 'LD-0004', '18.7 unreachable 数组');

// ================= 19. 静/动密封点泄漏率（‰）：参数形式、台账形式、考核线 =================
const rateFile = mk('rate.xlsx', {
  '检测记录': [
    H.concat(['密封类型']),
    ['MFD-R01', 'P-1', '泵密封', '汽油', '气体', 4000, D(-3), '李', '', '未修复', '', '', '', '王', '', '动密封'],
    ['MFD-R02', 'P-2', '泵密封', '汽油', '气体', 4000, D(-3), '李', '', '未修复', '', '', '', '王', '', '动密封'],
    ['MFD-R03', 'V-3', '阀门', '瓦斯', '气体', 4000, D(-3), '李', '', '未修复', '', '', '', '王', '', '静密封'],
    ['MFD-R04', 'V-4', '阀门', '瓦斯', '气体', 900, D(-3), '李', '', '', '', '', '', '', '', '静密封'],
    ['MFD-R05', 'X-5', '其他', '瓦斯', '气体', 4000, D(-3), '李', '', '未修复', '', '', '', '王', '', ''],
  ],
});
r = run(rateFile, ['--seal-points', '静:4000,动:400'], 'rate-param');
eq(r.summary.ok, true, '19.1 --seal-points 参数形式可用');
ok(r.lk && r.lk.sealPoints && r.lk.sealPoints.static.total === 4000 && r.lk.sealPoints.dynamic.total === 400, '19.1b leaks.json 顶层 sealPoints.{static,dynamic}.total 供周报读取');
ok(r.lk && r.lk.sealPoints.static.leaks === r.lk.metrics.leakRate.static.leaks, '19.1c sealPoints.static.leaks 与 metrics.leakRate 同源');
eq(r.lk.metrics.leakRate.static.total, 4000, '19.2 静密封点总数');
eq(r.lk.metrics.leakRate.dynamic.total, 400, '19.3 动密封点总数');
eq(r.lk.metrics.leakRate.static.leaks, 1, '19.4 静密封泄漏点数');
eq(r.lk.metrics.leakRate.dynamic.leaks, 2, '19.5 动密封泄漏点数');
eq(r.lk.metrics.leakRate.static.rate, 0.25, '19.6 静密封泄漏率 1/4000 = 0.25‰');
eq(r.lk.metrics.leakRate.dynamic.rate, 5, '19.7 动密封泄漏率 2/400 = 5‰');
eq(r.lk.metrics.leakRate.static.pass, null, '19.8 未给考核线时不判合格（null）');
eq(r.lk.metrics.leakRate.dynamic.pass, null, '19.9 未给考核线时动密封亦不判');
ok(/未判定（未提供厂内考核线）/.test(r.md), '19.10 md 写明未提供考核线不判');
ok(/以厂内指标为准/.test(r.md), '19.11 md 写明考核线以厂内指标为准');
ok(!/合格/.test(r.md.split('静/动密封点泄漏率')[1].split('两类来源')[0]), '19.12 未给考核线时泄漏率表不出现「合格」字样');
eq(r.lk.metrics.leakRate.unclassifiedLeaks, 1, '19.13 静/动未识别的泄漏点单独计数');
ok(r.lk.warnings.some((w) => /无法识别静\/动密封/.test(w)), '19.14 未识别静/动有 warning');
ok(/未计入任一泄漏率分子/.test(r.md), '19.15 md 注明未识别项未计入分子');
r = run(rateFile, ['--seal-points', '静:4000,动:400', '--static-limit', '0.5', '--dynamic-limit', '2'], 'rate-limit');
eq(r.lk.metrics.leakRate.static.pass, true, '19.16 给定考核线：静密封 0.25‰ ≤ 0.5‰ 判通过');
eq(r.lk.metrics.leakRate.dynamic.pass, false, '19.17 给定考核线：动密封 5‰ > 2‰ 判未达标');
ok(/高于考核线 2‰/.test(r.md), '19.18 md 标注高于考核线');
ok(/不高于考核线 0\.5‰/.test(r.md), '19.19 md 标注不高于考核线');
eq(r.lk.metrics.leakRate.static.limit, 0.5, '19.20 考核线写入 JSON');
// 台账形式（一行一密封点，按密封类型/组件类型计数）
const spFile = mk('sealpoints.xlsx', {
  '密封点台账': [
    ['密封点编号', '位号', '组件类型', '密封类型'],
    ['MFD-R01', 'P-1', '泵密封', '动密封'],
    ['MFD-R02', 'P-2', '泵密封', ''],
    ['MFD-R03', 'V-3', '阀门', '静密封'],
    ['MFD-R04', 'V-4', '阀门', ''],
    ['MFD-R05', 'X-5', '其他', ''],
    ['MFD-R06', 'F-6', '法兰', ''],
  ],
});
r = run(rateFile, ['--seal-points', spFile], 'rate-file');
eq(r.summary.ok, true, '19.21 --seal-points 台账形式可用');
eq(r.lk.metrics.leakRate.dynamic.total, 2, '19.22 台账逐点计数：动密封 2（含按组件类型推定）');
eq(r.lk.metrics.leakRate.static.total, 3, '19.23 台账逐点计数：静密封 3');
ok(r.lk.warnings.some((w) => /密封点台账.*1 行无法识别静\/动密封/.test(w)), '19.24 台账中无法识别的行有 warning 且不计入分母');
eq(r.lk.metrics.leakRate.dynamic.rate, 1000, '19.25 动密封 2/2 = 1000‰（分母来自台账）');
// 仅静没动 → 动密封率 null
r = run(rateFile, ['--seal-points', '静:4000'], 'rate-static-only');
eq(r.lk.metrics.leakRate.dynamic.total, null, '19.26 只给静密封总数时动密封总数 null');
eq(r.lk.metrics.leakRate.dynamic.rate, null, '19.27 动密封泄漏率 null 不按 0');
ok(r.lk.warnings.some((w) => /缺少动密封点数/.test(w)), '19.28 缺动密封点数有 warning');
// 非法 --seal-points
x = runRaw(['--input', rateFile, '--workshop', '车间', '--date', DATE, '--seal-points', '/不存在/台账.xlsx']);
eq(x.s.ok, false, '19.29 --seal-points 既非 N 形式又非文件 → 报错');
x = runRaw(['--input', rateFile, '--workshop', '车间', '--date', DATE, '--static-limit', '-1']);
eq(x.s.ok, false, '19.30 --static-limit 负数报错');

// ================= 20. 带单位检测值（makeNum 剥离单位）=================
const unitFile = mk('unit.xlsx', {
  '检测记录': [
    H,
    ['MFD-U01', 'P-1', '泵密封', '汽油', '气体', '3200ppm', D(-3), '李', '', '未修复', '', '', '', '王', ''],
    ['MFD-U02', 'P-2', '泵密封', '汽油', '气体', '4.5 μmol/mol', D(-3), '李', '', '', '', '', '', '', ''],
    ['MFD-U03', 'P-3', '泵密封', '汽油', '气体', '>10000', D(-3), '李', '', '未修复', '', '', '', '王', ''],
  ],
});
r = run(unitFile, [], 'unit');
eq(find(r.lk.items, 'MFD-U01').value, 3200, '20.1 「3200ppm」剥离单位取 3200');
eq(find(r.lk.items, 'MFD-U01').isLeak, true, '20.2 带单位值参与阈值判定');
eq(find(r.lk.items, 'MFD-U02').value, 4.5, '20.3 「4.5 μmol/mol」剥离单位取 4.5');
eq(find(r.lk.items, 'MFD-U02').isLeak, false, '20.4 4.5 < 2000 未认定泄漏');
eq(find(r.lk.items, 'MFD-U03').value, null, '20.5 「>10000」带比较符不猜测 → null');
eq(find(r.lk.items, 'MFD-U03').bucket, 'undetermined', '20.6 带比较符值进未判定');
ok(r.lk.warnings.some((w) => /已剥离单位/.test(w)), '20.7 剥离单位有一次性 warning');

// ================= 21. 状态词：延迟修复不再归未修复；「已提通知单」归未修复 =================
const stw = mk('statusword.xlsx', {
  '检测记录': [
    H,
    ['MFD-S01', 'P-1', '泵密封', '汽油', '气体', 4000, D(-30), '李', '', '已提通知单', '', '', '', '王', ''],
    ['MFD-S02', 'P-2', '泵密封', '汽油', '气体', 4000, D(-30), '李', '', '延迟至停工', '', '', '', '王', ''],
  ],
});
r = run(stw, [], 'statusword');
eq(find(r.lk.items, 'MFD-S01').status, 'open', '21.1 「已提通知单」归未修复');
eq(find(r.lk.items, 'MFD-S01').bucket, 'overdue', '21.2 已提通知单但超期仍计超期');
eq(find(r.lk.items, 'MFD-S02').status, 'delayed', '21.3 「延迟至停工」归延迟修复');
eq(find(r.lk.items, 'MFD-S02').bucket, 'undetermined', '21.4 延迟修复无批准日期不按超期、不按已批准');
eq(r.summary.counts.overdue, 1, '21.5 超期数只含真正未修的一条');

// ================= 22. 默认输出目录为系统临时目录 =================
{
  const rr = spawnSync(process.execPath, [TRACK, '--input', base, '--workshop', '测试车间', '--date', DATE], { encoding: 'utf8' });
  const lines = rr.stdout.trim().split('\n');
  let sm; try { sm = JSON.parse(lines[lines.length - 1]); } catch (e) { sm = { ok: false }; }
  eq(sm.ok, true, '22.1 不传 --out 可运行');
  ok(sm.out && sm.out.startsWith(os.tmpdir()), '22.2 默认输出目录在 os.tmpdir() 下');
  ok(!fs.existsSync(path.join(path.dirname(base), 'lpt-out')), '22.3 不再写入输入同目录 lpt-out/');
}

// ================= 输出 =================
console.log(`\n${'='.repeat(56)}`);
console.log(`leak-point-tracker 自测：${pass} 通过，${fail} 失败`);
if (failures.length) { console.log('\n失败项：'); failures.forEach((f) => console.log('  ✗ ' + f)); }
console.log('='.repeat(56));
try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
