#!/usr/bin/env node
'use strict';
/**
 * 自测：生成变体输入并断言 digest.js 行为。用法：node scripts/selftest.js（全绿退出 0）
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { writeXlsx } = require('./lib/xlsx-lite');

const DIGEST = path.join(__dirname, 'digest.js');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'idd-selftest-'));
const DATE = '2026-09-21';
let pass = 0, fail = 0;
const failures = [];

function ok(cond, name) { if (cond) { pass++; } else { fail++; failures.push(name); } }
function eq(actual, expect, name) { ok(actual === expect, `${name}（期望 ${JSON.stringify(expect)}，实际 ${JSON.stringify(actual)}）`); }

function run(file, extra = [], tag) {
  const out = path.join(work, (tag || path.basename(file, '.xlsx')) + '-out');
  const r = spawnSync(process.execPath, [DIGEST, '--input', file, '--workshop', '测试车间', '--date', DATE, '--out', out, ...extra], { encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  let summary;
  try { summary = JSON.parse(lines[lines.length - 1]); } catch (e) { summary = { ok: false, error: 'no-json:' + r.stdout + r.stderr }; }
  let status = null, md = null;
  if (fs.existsSync(path.join(out, 'status.json'))) status = JSON.parse(fs.readFileSync(path.join(out, 'status.json'), 'utf8'));
  if (fs.existsSync(path.join(out, 'digest.md'))) md = fs.readFileSync(path.join(out, 'digest.md'), 'utf8');
  return { code: r.status, summary, status, md, out };
}
function mk(name, book) { const p = path.join(work, name); writeXlsx(p, book); return p; }

// ---- 1. 基础：三来源合并、就严原则
const base = mk('base.xlsx', {
  '巡检记录': [
    ['位号', '设备名称', '检查结果', '异常描述', '检查时间', '检查人'],
    ['P-01', '泵1', '正常', '', `${DATE} 08:00`, '张'],
    ['P-02', '泵2', '异常', '机封漏', `${DATE} 08:10`, '张'],
    ['P-03', '泵3', '正常', '', `${DATE} 08:20`, '张'],
  ],
  '点检记录': [
    ['位号', '设备名称', '检查结果', '异常描述', '检查时间', '检查人'],
    ['P-03', '泵3', '异常', '振动高', `${DATE} 14:00`, '李'],
  ],
});
let r = run(base, [], 'base');
eq(r.summary.ok, true, '1.1 基础运行成功');
eq(r.summary.counts.equipment, 3, '1.2 设备数');
eq(r.summary.counts.abnormal, 2, '1.3 异常数（P-02 + 就严的 P-03）');
eq(r.summary.counts.conflicts, 1, '1.4 冲突数（P-03 正常/异常并存）');
eq(r.status.conflicts[0].resolved, 'abnormal', '1.5 冲突按就严解析为异常');
ok(r.status.conflicts[0].records.length === 2, '1.6 冲突保留两条原始记录');
ok(/第\d+行/.test(r.md), '1.7 冲突表含出处行号');

// ---- 2. 冲突不得静默取其一：正常记录也必须保留
ok(r.status.conflicts[0].records.some((x) => x.result === '正常'), '2.1 冲突中保留了正常记录');

// ---- 3. 未判定：结果为空 / 无法归类
const unk = mk('unknown.xlsx', {
  '巡检记录': [
    ['位号', '设备名称', '检查结果', '检查时间'],
    ['P-01', '泵1', '', `${DATE} 08:00`],
    ['P-02', '泵2', '待查', `${DATE} 08:10`],
    ['P-03', '泵3', '正常', `${DATE} 08:20`],
  ],
});
r = run(unk, [], 'unknown');
eq(r.summary.counts.unknown, 2, '3.1 未判定计入 2 条（空 + 无法归类）');
eq(r.summary.counts.normal, 1, '3.2 未判定不计入正常');
eq(r.summary.counts.abnormal, 0, '3.3 未判定不计入异常');
ok(r.status.unknownState.some((x) => x.reason.includes('为空')), '3.4 空值原因标注正确');

// ---- 4. 漏检：未提供台账时为 null，不得倒推
r = run(base, [], 'noledger');
eq(r.summary.counts.missed, null, '4.1 无台账时漏检为 null');
ok(/未提供设备台账/.test(r.md), '4.2 报告说明未提供台账');
ok(r.status.warnings.some((w) => w.includes('无法识别漏检')), '4.3 warning 提示无法识别漏检');

const led = mk('ledger.xlsx', {
  '设备台账': [
    ['位号', '设备名称', '是否需巡检'],
    ['P-01', '泵1', '是'], ['P-02', '泵2', '是'], ['P-03', '泵3', '是'],
    ['P-04', '泵4', '是'], ['P-05', '泵5', '否'],
  ],
});
r = run(base, ['--ledger', led], 'withledger');
eq(r.summary.counts.missed, 1, '4.4 漏检识别 P-04');
ok(r.status.missed[0].tag === 'P-04', '4.5 漏检位号正确');
ok(!r.status.missed.some((x) => x.tag === 'P-05'), '4.6 标记"否"的设备不计漏检');

// ---- 5. 跨日记录跳过
const cross = mk('cross.xlsx', {
  '巡检记录': [
    ['位号', '设备名称', '检查结果', '检查时间'],
    ['P-01', '泵1', '正常', `${DATE} 08:00`],
    ['P-09', '泵9', '异常', '2026-09-20 08:00'],
  ],
});
r = run(cross, [], 'cross');
eq(r.summary.counts.equipment, 1, '5.1 跨日记录被跳过');
ok(r.status.warnings.some((w) => w.includes('不是汇总日期')), '5.2 跨日 warning');

// ---- 6. 合计行跳过 + 标题行表头识别 + 别名列头
const lims = mk('lims.xlsx', {
  '巡检记录': [
    ['某厂巡检导出'],
    [],
    ['设备位号', '名称', '结论', '问题描述', '巡检时间'],
    ['P-01', '泵1', '正常', '', `${DATE} 08:00`],
    ['P-02', '泵2', '异常', '漏', `${DATE} 08:10`],
    ['合计', '', '', '', ''],
  ],
});
r = run(lims, [], 'lims');
eq(r.summary.ok, true, '6.1 LIMS 风格可读');
eq(r.summary.counts.equipment, 2, '6.2 合计行被跳过');
ok(r.status.warnings.some((w) => w.includes('合计行')), '6.3 合计行 warning');

// ---- 7. 位号为空跳过并 warning
const notag = mk('notag.xlsx', {
  '巡检记录': [
    ['位号', '设备名称', '检查结果', '检查时间'],
    ['', '无位号设备', '异常', `${DATE} 08:00`],
    ['P-01', '泵1', '正常', `${DATE} 08:10`],
  ],
});
r = run(notag, [], 'notag');
eq(r.summary.counts.equipment, 1, '7.1 空位号行被跳过');
ok(r.status.warnings.some((w) => w.includes('位号为空')), '7.2 空位号 warning');

// ---- 8. 无任何已知工作表 → ok:false 且 exit 1
const bad = mk('bad.xlsx', { '随便一张表': [['a', 'b'], [1, 2]] });
r = run(bad, [], 'bad');
eq(r.summary.ok, false, '8.1 无已知工作表时 ok:false');
eq(r.code, 1, '8.2 退出码为 1');
ok(/未在输入中找到/.test(r.summary.error), '8.3 错误信息明确');

// ---- 9. 参数校验
function runRaw(args) {
  const r = spawnSync(process.execPath, [DIGEST, ...args], { encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  try { return { code: r.status, s: JSON.parse(lines[lines.length - 1]) }; } catch (e) { return { code: r.status, s: { ok: false, error: 'no-json' } }; }
}
let x = runRaw(['--input']);
eq(x.s.ok, false, '9.1 --input 缺值报错');
ok(/缺少取值/.test(x.s.error), '9.2 缺值错误信息正确');
x = runRaw(['--input', base, '--workshop', '车间', '--date', '2026-13-45']);
eq(x.s.ok, false, '9.3 非法日期报错');
x = runRaw(['--input', base, '--workshop', '车间', '--date', DATE, '--未知参数', 'x']);
eq(x.s.ok, false, '9.4 未知参数报错');
x = runRaw(['--input', '/不存在的路径.xlsx', '--workshop', '车间', '--date', DATE]);
eq(x.s.ok, false, '9.5 输入不存在报错');

// ---- 10. 状态变化对比
r = run(base, ['--ledger', led], 'prev-src');
const prevPath = path.join(r.out, 'status.json');
const changedSrc = mk('changed.xlsx', {
  '巡检记录': [
    ['位号', '设备名称', '检查结果', '检查时间'],
    ['P-01', '泵1', '异常', `${DATE} 08:00`],
    ['P-02', '泵2', '正常', `${DATE} 08:10`],
    ['P-03', '泵3', '正常', `${DATE} 08:20`],
  ],
});
r = run(changedSrc, ['--prev', prevPath], 'changed');
eq(r.summary.counts.changed, 3, '10.1 三台设备状态变化');
ok(r.status.changed.some((c) => c.tag === 'P-01' && c.from === 'normal' && c.to === 'abnormal'), '10.2 变化方向正确');

// ---- 11. 多文件输入合并
const f2 = mk('second.xlsx', {
  '点检记录': [
    ['位号', '设备名称', '检查结果', '检查时间'],
    ['P-77', '泵77', '异常', `${DATE} 15:00`],
  ],
});
r = run(base + ',' + f2, [], 'multi');
eq(r.summary.counts.equipment, 4, '11.1 多文件合并设备数');
eq(r.summary.counts.abnormal, 3, '11.2 多文件合并异常数');

// ---- 12. summary.json 落盘
r = run(base, [], 'summaryfile');
ok(fs.existsSync(path.join(r.out, 'summary.json')), '12.1 summary.json 已写入');
const sj = JSON.parse(fs.readFileSync(path.join(r.out, 'summary.json'), 'utf8'));
eq(sj.ok, true, '12.2 summary.json 内容正确');

// ---- 13. 产出结构完整性
ok(/## 一、状态概览/.test(r.md) && /## 二、异常项清单/.test(r.md) && /## 三、漏检清单/.test(r.md)
  && /## 四、记录冲突/.test(r.md) && /## 五、未判定项/.test(r.md) && /## 六、状态变化/.test(r.md)
  && /## 七、设备状态分析/.test(r.md), '13.1 六节结构齐全');
ok(/<!-- ANALYSIS_START -->/.test(r.md) && /<!-- ANALYSIS_END -->/.test(r.md), '13.2 分析段占位符存在');

// ---- 8. 结果归类：否定式整词先于异常词（"无异常"是正常，"Running" 不是 NG）
const cls = mk('classify.xlsx', {
  '巡检记录': [
    ['位号', '设备名称', '检查结果', '异常描述', '检查时间', '检查人'],
    ['C-01', '泵', '无异常', '', `${DATE} 08:00`, '张'],
    ['C-02', '泵', '未见异常', '', `${DATE} 08:00`, '张'],
    ['C-03', '泵', '无泄漏', '', `${DATE} 08:00`, '张'],
    ['C-04', '泵', 'Running', '', `${DATE} 08:00`, '张'],
    ['C-05', '泵', '不合格', '机封漏', `${DATE} 08:00`, '张'],
    ['C-06', '泵', 'NG', '异响', `${DATE} 08:00`, '张'],
    ['C-07', '泵', '待查', '', `${DATE} 08:00`, '张'],
  ],
});
r = run(cls, [], 'classify');
eq(r.summary.counts.normal, 4, '8.1 无异常/未见异常/无泄漏/Running 均为正常');
eq(r.summary.counts.abnormal, 2, '8.2 不合格/NG 为异常');
eq(r.summary.counts.unknown, 1, '8.3 待查为未判定');
eq(r.summary.counts.conflicts, 0, '8.4 无异常不再触发就严冲突');


// ---- 14. 智能巡检"一行一检查项"（功能位置/检查项/测值/是否报警）按位号聚合；任一检查项报警则设备异常；不同检查项正常/异常并存不算冲突
const smart = mk('smart.xlsx', {
  '巡检明细': [
    ['功能位置', '功能位置描述', '检查项', '测值', '是否报警', '上传时间', '巡检人'],
    ['P-11', '泵11', '机封泄漏', '', '否', `${DATE} 08:00`, '张'],
    ['P-11', '泵11', '轴承温度', '78℃', '是', `${DATE} 08:00`, '张'],
    ['P-11', '泵11', '振动', '2.1mm/s', '否', `${DATE} 08:00`, '张'],
    ['P-12', '泵12', '机封泄漏', '', '否', `${DATE} 08:05`, '张'],
    ['P-12', '泵12', '轴承温度', '55℃', '否', `${DATE} 08:05`, '张'],
    ['P-13', '泵13', '机封泄漏', '', 'Y', `${DATE} 08:10`, '张'],
    ['P-13', '泵13', '机封泄漏', '', 'N', `${DATE} 16:10`, '王'],
  ],
});
r = run(smart, [], 'smart');
eq(r.summary.ok, true, '14.1 巡检明细 sheet 名 + 功能位置列可读');
eq(r.summary.counts.records, 7, '14.2 一行一检查项全部读入');
eq(r.summary.counts.equipment, 3, '14.3 按位号聚合为 3 台');
eq(r.summary.counts.abnormal, 2, '14.4 任一检查项报警即设备异常（P-11、P-13）');
eq(r.summary.counts.normal, 1, '14.5 全部检查项未报警为正常');
const p11 = r.status.byEquipment.find((x) => x.tag === 'P-11');
eq(p11.itemCount, 3, '14.6 设备保留检查项数');
eq(p11.abnormalItemCount, 1, '14.7 异常检查项数');
ok(p11.results.every((x) => x.basis === '是否报警'), '14.8 判定依据记为「是否报警」');
eq(r.summary.counts.conflicts, 1, '14.9 同一检查项 Y/N 并存才算冲突（P-13）；P-11 不同检查项正常/异常并存不算冲突');
ok(r.status.conflicts[0].tag === 'P-13' && r.status.conflicts[0].items[0].param === '机封泄漏', '14.10 冲突定位到检查项');
const ab11 = r.status.abnormal.find((x) => x.tag === 'P-11');
ok(/轴承温度/.test(ab11.desc) && /78/.test(ab11.desc), '14.11 无异常描述列时用异常检查项+测值作描述');
eq(p11.results.find((x) => x.param === '轴承温度').value, 78, '14.12 带单位测值 78℃ 解析为 78');
eq(p11.results.find((x) => x.param === '振动').value, 2.1, '14.13 带单位测值 2.1mm/s 解析为 2.1');
ok(r.status.warnings.some((w) => /剥离单位/.test(w)), '14.14 剥离单位有 warning');
ok(/判定依据：.*是否报警/.test(r.md), '14.15 报告头写明判定依据');

// ---- 15. 状态监测无"检查结果"列：测值对限值判异常；缺限值且无报警列 → 未判定不默认
const mon = mk('monitor.xlsx', {
  '状态监测': [
    ['测点', '设备位号', '监测项目', '测量值', '上限', '下限', '检测时间'],
    ['P-21-V1', 'P-21', '振动', '7.3mm/s', 7.1, '', `${DATE} 10:00`],
    ['P-22-V1', 'P-22', '振动', '3.0mm/s', 7.1, '', `${DATE} 10:00`],
    ['P-23-T1', 'P-23', '轴温', 40, '', 45, `${DATE} 10:00`],
    ['P-24-T1', 'P-24', '轴温', 60, '', '', `${DATE} 10:00`],
  ],
});
r = run(mon, [], 'monitor');
eq(r.summary.ok, true, '15.1 状态监测无检查结果列仍可运行');
eq(r.summary.counts.abnormal, 2, '15.2 超上限 P-21、低于下限 P-23 判异常');
eq(r.summary.counts.normal, 1, '15.3 限值内 P-22 判正常');
eq(r.summary.counts.unknown, 1, '15.4 无限值无报警 P-24 进未判定，不默认正常');
ok(r.status.unknownState[0].reason.includes('为空'), '15.5 未判定原因说明缺判定依据');
ok(r.status.byEquipment.find((x) => x.tag === 'P-21').results[0].basis === '测值对限值', '15.6 判定依据记为「测值对限值」');
ok(!r.status.warnings.some((w) => /缺少列: 检查结果/.test(w)), '15.7 不再因缺「检查结果」列报 warning');

// ---- 16. 判定依据优先级：检查结果 > 是否报警；"备注"不再作异常描述
const prio = mk('prio.xlsx', {
  '点检数据': [
    ['设备位号', '点检项目', '实测值', '报警标志', '点检结果', '备注', '点检时间'],
    ['P-31', '振动', 2.0, '是', '正常', '备注里写了异常二字', `${DATE} 10:00`],
    ['P-32', '振动', 9.0, '否', '异常', '', `${DATE} 10:00`],
  ],
});
r = run(prio, [], 'prio');
eq(r.status.byEquipment.find((x) => x.tag === 'P-31').state, 'normal', '16.1 有检查结果时以检查结果为准（正常）');
eq(r.status.byEquipment.find((x) => x.tag === 'P-32').state, 'abnormal', '16.2 有检查结果时以检查结果为准（异常）');
eq(r.status.byEquipment.find((x) => x.tag === 'P-31').results[0].desc, '', '16.3 「备注」列不再被当作异常描述');
ok(r.status.abnormal.find((x) => x.tag === 'P-32').desc === '异常' || /振动/.test(r.status.abnormal.find((x) => x.tag === 'P-32').desc), '16.4 异常描述不取备注');

// ---- 17. 夜班跨 0 点按班次日归属（--shift-window）
const night = mk('night.xlsx', {
  '巡检明细': [
    ['功能位置', '检查项', '是否报警', '上传时间'],
    ['P-41', '机封', '否', `${DATE} 23:30`],
    ['P-42', '机封', '是', `2026-09-22 02:10`],
    ['P-43', '机封', '否', `2026-09-22 09:00`],
    ['P-44', '机封', '否', `${DATE} 07:30`],
    ['P-45', '机封', '否', `2026-09-22`],
  ],
});
r = run(night, ['--shift-window', '08:00'], 'night');
eq(r.summary.counts.equipment, 2, '17.1 班次日 08:00 起算：23:30 与次日 02:10 归本班次日，次日 09:00、当日 07:30、仅日期的次日记录不归');
ok(r.status.byEquipment.some((x) => x.tag === 'P-42'), '17.2 次日 02:10 的记录已归入');
ok(!r.status.byEquipment.some((x) => x.tag === 'P-43'), '17.3 次日 09:00 的记录被跳过');
ok(!r.status.byEquipment.some((x) => x.tag === 'P-44'), '17.4 当日 07:30 归前一班次日被跳过');
ok(!r.status.byEquipment.some((x) => x.tag === 'P-45'), '17.5 只有日期无时刻的次日记录不回拨');
ok(r.status.warnings.some((w) => /班次日 2026-09-22/.test(w)), '17.6 跨班次 warning 标注班次日');
eq(r.status.meta.shiftWindow, '08:00', '17.7 meta 记录 shiftWindow');
ok(/班次日起算 08:00/.test(r.md), '17.8 报告头注明班次日起算');
r = run(night, [], 'night-nowindow');
eq(r.summary.counts.equipment, 2, '17.9 不给 --shift-window 时按自然日（23:30 与 07:30）');
let xw = runRaw(['--input', night, '--workshop', '车间', '--date', DATE, '--shift-window', '25:00']);
eq(xw.s.ok, false, '17.10 非法 --shift-window 报错');

// ---- 18. --source-type：工作表名不认识时指定来源类型；auto 下给出提示
const odd = mk('odd.xlsx', {
  'Sheet1': [
    ['功能位置', '检查项', '是否报警', '上传时间'],
    ['P-51', '机封', '否', `${DATE} 08:00`],
    ['P-52', '机封', '是', `${DATE} 08:00`],
  ],
});
r = run(odd, [], 'odd-auto');
eq(r.summary.ok, false, '18.1 工作表名不认识且未指定 --source-type → 报错');
ok(/--source-type/.test(r.summary.error), '18.2 错误信息提示 --source-type');
r = run(odd, ['--source-type', 'patrol'], 'odd-patrol');
eq(r.summary.ok, true, '18.3 --source-type patrol 后可读');
eq(r.summary.counts.equipment, 2, '18.4 记录读入');
ok(r.status.meta.sources[0].includes('操作工巡检') && r.status.meta.sources[0].includes('--source-type'), '18.5 来源标注为指定类型');
r = run(odd, ['--source-type', 'monitor'], 'odd-monitor');
ok(r.status.byEquipment[0].sources[0] === '状态监测', '18.6 --source-type monitor 归状态监测');
xw = runRaw(['--input', odd, '--workshop', '车间', '--date', DATE, '--source-type', 'xxx']);
eq(xw.s.ok, false, '18.7 非法 --source-type 报错');
ok(/点检数据/.test(fs.readFileSync(DIGEST, 'utf8')) && /巡检明细/.test(fs.readFileSync(DIGEST, 'utf8')), '18.8 sheet 别名含 巡检明细/点检数据');

// ---- 19. 六档设备状态：运行/备用/检修/停用/异常/未判定
const six = mk('six.xlsx', {
  '巡检记录': [
    ['位号', '设备名称', '检查结果', '运行状态', '检查时间'],
    ['P-61', '泵61', '正常', '运行', `${DATE} 08:00`],
    ['P-62', '泵62', '正常', '备用', `${DATE} 08:00`],
    ['P-63', '泵63', '', '检修中', `${DATE} 08:00`],
    ['P-64', '泵64', '正常', '停用', `${DATE} 08:00`],
    ['P-65', '泵65', '异常', '备用', `${DATE} 08:00`],
    ['P-66', '泵66', '待查', '运行', `${DATE} 08:00`],
    ['P-67', '泵67', '正常', '', `${DATE} 08:00`],
  ],
});
r = run(six, [], 'six');
const st = r.summary.counts.sixTier;
eq(st.运行, 1, '19.1 运行计数');
eq(st.备用, 1, '19.2 备用计数（异常的备机不计备用）');
eq(st.检修, 1, '19.3 检修计数（无检查结果但运行状态为检修）');
eq(st.停用, 1, '19.4 停用计数');
eq(st.异常, 1, '19.5 异常计数（异常优先于备用）');
eq(st.未判定, 2, '19.6 未判定计数（待查 + 有运行状态列但为空）');
ok(/\| 备用 \| 1 \|/.test(r.md) && /\| 检修 \| 1 \|/.test(r.md), '19.7 报告概览按六档列出');
eq(r.summary.counts.normal, 5, '19.8 兼容字段 counts.normal 保持（供日报技能读取）');
r = run(base, [], 'six-nocol');
ok(/【注意】记录表无「运行状态」列/.test(r.md), '19.9 无运行状态列时报告提示按运行计');
eq(r.summary.counts.sixTier.运行, 1, '19.10 无运行状态列：正常设备按运行计');

// ---- 20. 特护设备：记录表 ABC标识/台账 ABC标识 为"特护"或 A 时标记，异常清单置顶并提示
const sp = mk('special.xlsx', {
  '点检数据': [
    ['设备位号', '点检结果', 'ABC标识', '点检时间'],
    ['Z-01', '异常', 'C', `${DATE} 08:00`],
    ['K-01', '异常', '特护', `${DATE} 08:00`],
  ],
});
r = run(sp, [], 'special');
eq(r.summary.counts.special, 1, '20.1 特护计数');
eq(r.summary.counts.specialAbnormal, 1, '20.2 特护异常计数');
ok(r.status.abnormal[0].tag === 'K-01', '20.3 特护异常置顶');
ok(/【注意】特护设备异常 1 台/.test(r.md), '20.4 特护异常提示行出现');
r = run(base, [], 'special-none');
ok(!/【注意】特护设备异常/.test(r.md), '20.5 无特护异常时提示行不出现');

// ---- 21. 别名合并：SAP 列名（技术标识/技术对象描述/工厂区段）与 "设备编号" 不再归位号
const sap = mk('sap.xlsx', {
  '巡检记录': [
    ['设备编号', '技术标识', '技术对象描述', '工厂区段', '结论', '巡检时间'],
    ['10001001', 'P-71', '泵71', '一区', '正常', `${DATE} 08:00`],
  ],
});
r = run(sap, [], 'sap');
eq(r.status.byEquipment[0].tag, 'P-71', '21.1 技术标识归位号，设备编号不抢位号');
eq(r.status.byEquipment[0].eqNo, '10001001', '21.2 设备编号单列');
eq(r.status.byEquipment[0].name, '泵71', '21.3 技术对象描述归设备名称');
eq(r.status.byEquipment[0].area, '一区', '21.4 工厂区段归区域');
const sapLed = mk('sap-ledger.xlsx', {
  '设备台账': [
    ['功能位置', '设备', '技术对象描述', 'ABC标识', '是否需巡检'],
    ['P-71', '10001001', '泵71', 'B', '是'],
    ['P-72', '10001002', '泵72', '特护', '是'],
  ],
});
r = run(sap, ['--ledger', sapLed], 'sap-ledger');
eq(r.summary.counts.missed, 1, '21.5 SAP 列名台账识别漏检');
ok(r.status.missed[0].special === true, '21.6 台账特护标记进漏检清单');

// ---- 23. 特护单列：重要度 A/关键 不等于特护；「特护标记」列为准；台账特护补到异常清单
const spRec = mk('special-rec.xlsx', {
  '巡检记录': [
    ['位号', '检查项', '检查结果', '巡检时间'],
    ['P-81', '振动', '异常', `${DATE} 08:00`],
    ['P-82', '振动', '正常', `${DATE} 08:00`],
    ['P-83', '振动', '正常', `${DATE} 08:00`],
  ],
  '点检数据': [
    ['设备位号', '点检结果', 'ABC标识', '点检时间'],
    ['P-84', '正常', 'A', `${DATE} 09:00`],
  ],
});
const spLed = mk('special-led.xlsx', {
  '设备台账': [
    ['位号', '设备名称', '重要度', '特护标记'],
    ['P-81', '泵81', 'B', '是'],
    ['P-82', '泵82', 'A', '否'],
    ['P-83', '泵83', '关键', '否'],
    ['P-84', '泵84', 'A', '否'],
    ['K-85', '机85', 'A', '否'],
    ['K-86', '机86', 'A', '是'],
  ],
});
r = run(spRec, ['--ledger', spLed], 'special-col');
eq(r.summary.counts.special, 1, '23.1 重要度 A/关键 且特护标记为否不计特护，只有 P-81 计特护');
ok(r.status.byEquipment.filter((x) => x.special).map((x) => x.tag).join() === 'P-81', '23.2 特护标记「是」的 B 类设备标特护，A 类与记录表 ABC标识 A 不标');
eq(r.summary.counts.specialAbnormal, 1, '23.3 台账才有的特护标记补到异常清单（specialAbnormal 计入）');
ok(r.status.abnormal[0] && r.status.abnormal[0].tag === 'P-81' && r.status.abnormal[0].special === true, '23.4 异常清单中该特护设备 special=true');
ok(/【注意】特护设备异常 1 台/.test(r.md), '23.5 台账特护设备异常时报告出现【注意】上报提示');
ok(r.status.missed.find((x) => x.tag === 'K-85').special === false && r.status.missed.find((x) => x.tag === 'K-86').special === true, '23.6 漏检清单特护按特护标记列，A 类不算');
eq(r.status.missed[0].tag, 'K-86', '23.7 漏检清单特护置顶');
// 表头恰好是「特护」：不被共享别名「重要度」（含「特护」）抢走
{
  const rec1 = mk('sp-hdr-rec.xlsx', { '巡检记录': [['位号', '检查项', '检查结果', '巡检时间'], ['P-81', '振动', '异常', `${DATE} 08:00`], ['P-82', '振动', '正常', `${DATE} 08:00`]] });
  const led1 = mk('sp-hdr-led.xlsx', { '设备台账': [['位号', '设备名称', '特护', '是否需巡检'], ['P-81', '泵81', '是', '是'], ['P-82', '泵82', '否', '是'], ['K-85', '机85', '是', '是']] });
  r = run(rec1, ['--ledger', led1], 'sp-hdr-led');
  const b81 = ((r.status && r.status.byEquipment) || []).find((x) => x.tag === 'P-81') || {};
  eq(b81.special, true, '23.8 台账表头为「特护」、值「是」→ P-81 标特护');
  eq(((r.status && r.status.missed) || []).find((x) => x.tag === 'K-85') && r.status.missed.find((x) => x.tag === 'K-85').special, true, '23.9 台账表头为「特护」→ 漏检的 K-85 标特护');
  eq(r.summary.counts.specialAbnormal, 1, '23.10 台账「特护」列的特护设备异常计入 specialAbnormal');
  const rec2 = mk('sp-hdr-rec2.xlsx', { '巡检记录': [['位号', '检查项', '检查结果', '巡检时间', '特护'], ['P-81', '振动', '异常', `${DATE} 08:00`, '是']] });
  r = run(rec2, [], 'sp-hdr-rec2');
  eq(r.summary.counts.special, 1, '23.11 记录表表头为「特护」、值「是」→ 计特护');
  ok(/【注意】特护设备异常 1 台/.test(r.md || ''), '23.12 记录表「特护」列的特护设备异常出现【注意】提示');
}

// ---- 22. 声明行、无 emoji、默认输出目录
r = run(base, [], 'decl');
ok(/本材料由脚本汇总、模型成文，仅供设备员复核参考/.test(r.md), '22.1 声明行写入 md');
ok(!/[✅⚠🚨]/.test(r.md), '22.2 md 不含 emoji');
ok(/os\.tmpdir\(\)/.test(fs.readFileSync(DIGEST, 'utf8')), '22.3 默认输出目录为系统临时目录');
ok(!/'备注'/.test(fs.readFileSync(DIGEST, 'utf8').split('ALIASES')[1].split('});')[0]), '22.4 别名表不含「备注」');
ok(/mergeAliases/.test(fs.readFileSync(DIGEST, 'utf8')), '22.5 ALIASES 经 mergeAliases 合并');

// ---- 24. 同一设备一项「待查」、其余正常、无异常项：整机判未判定，不判正常（第三轮 v1-1）
const mixU = mk('mix-unknown.xlsx', {
  '巡检明细': [
    ['位号', '设备名称', '检查项', '检查结果', '是否报警', '检查时间', '检查人'],
    ['E-31', '冷却器', '法兰泄漏', '待查', '否', `${DATE} 08:45`, '冯'],
    ['E-31', '冷却器', '进出口温度', '正常', '否', `${DATE} 08:45`, '冯'],
    ['E-32', '冷却器', '法兰泄漏', '待查', '否', `${DATE} 08:45`, '冯'],
    ['E-32', '冷却器', '进出口温度', '异常', '是', `${DATE} 08:45`, '冯'],
    ['E-33', '冷却器', '法兰泄漏', '正常', '否', `${DATE} 08:45`, '冯'],
  ],
});
r = run(mixU, [], 'mix-unknown');
const e31 = ((r.status && r.status.byEquipment) || []).find((x) => x.tag === 'E-31') || {};
eq(e31.state, 'unknown', '24.1 一项待查 + 一项正常、无异常项 → 整机未判定');
eq(e31.stateCn, '未判定', '24.2 中文状态为未判定');
ok(((r.status && r.status.unknownState) || []).some((x) => x.tag === 'E-31' && x.reason.includes('法兰泄漏') && x.reason.includes('待查')), '24.3 未判定清单写明哪一项待查');
ok(((r.status && r.status.abnormal) || []).some((x) => x.tag === 'E-32'), '24.4 有异常项时仍判异常（异常优先于未判定）');
eq((r.summary.counts || {}).normal, 1, '24.5 正常只计 E-33（E-31 不计正常）');
eq((r.summary.counts || {}).unknown, 1, '24.6 未判定计 E-31');
ok(((r.summary && r.summary.warnings) || []).some((w) => w.includes('E-31') && w.includes('待查')), '24.7 warning 点名部分检查项未判定的设备');
ok(/E-31/.test(((r.md || '').split('## 五、未判定项')[1] || '').split('\n## ')[0]), '24.8 报告「五、未判定项」一节列出 E-31');

// ---- 输出
console.log(`\n${'='.repeat(56)}`);
console.log(`inspection-data-digest 自测：${pass} 通过，${fail} 失败`);
if (failures.length) { console.log('\n失败项：'); failures.forEach((f) => console.log('  ✗ ' + f)); }
console.log('='.repeat(56));
try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
