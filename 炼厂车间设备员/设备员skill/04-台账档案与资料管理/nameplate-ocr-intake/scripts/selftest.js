#!/usr/bin/env node
'use strict';
/**
 * 自测：生成变体输入并断言 intake.js 行为。用法：node scripts/selftest.js（全绿退出 0）
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { writeXlsx } = require('./lib/xlsx-lite');

const INTAKE = path.join(__dirname, 'intake.js');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'noi-selftest-'));
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

let n = 0;
function mkFields(obj) { const p = path.join(work, `f${++n}.json`); fs.writeFileSync(p, JSON.stringify(obj), 'utf8'); return p; }
function mkXlsx(name, book) { const p = path.join(work, name); writeXlsx(p, book); return p; }

function run(args, tag) {
  const out = path.join(work, (tag || 'out') + '-out');
  const r = spawnSync(process.execPath, [INTAKE, ...args, '--out', out], { encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  let summary;
  try { summary = JSON.parse(lines[lines.length - 1]); } catch (e) { summary = { ok: false, error: 'no-json:' + r.stdout + r.stderr }; }
  let json = null, md = null, csv = null;
  if (fs.existsSync(path.join(out, 'intake.json'))) json = JSON.parse(fs.readFileSync(path.join(out, 'intake.json'), 'utf8'));
  if (fs.existsSync(path.join(out, 'intake.md'))) md = fs.readFileSync(path.join(out, 'intake.md'), 'utf8');
  if (fs.existsSync(path.join(out, 'intake.csv'))) csv = fs.readFileSync(path.join(out, 'intake.csv'), 'utf8');
  return { code: r.status, summary, json, md, csv, out };
}
const F = (name, value, confidence, extra = {}) => Object.assign({ name, value, confidence }, extra);
let r, x;

// 标准台账：P-01 已存在，V-01 已存在且一致
const LEDGER = mkXlsx('ledger.xlsx', {
  '设备台账': [
    ['位号', '设备名称', '规格型号', '制造厂', '出厂编号', '制造日期', '投用日期', '功率(kW)', '流量(m³/h)', '转速(r/min)', '材质', '重量(kg)'],
    ['P-01', '进料泵A', 'ZA-100-250', '沈阳水泵厂', 'SY-2012-0876', '2012-03', '2012-06-15', 110, 100, 2950, 'ZG1Cr18Ni9Ti', 820],
    ['P-02', '进料泵B', 'ZA-100-250', '沈阳水泵厂', 'SY-2012-0877', '2012-03', '2012-06-15', 110, 100, 2950, 'ZG1Cr18Ni9Ti', 820],
    ['合计', '', '', '', '', '', '', '', '', '', '', ''],
  ],
});

// ================================================================ 1. 正常路径
const basicFields = mkFields({
  photo: 'P-01.jpg',
  fields: [
    F('制造厂', '沈阳水泵厂', 'clear'),
    F('型号', 'ZA-100-250', 'clear'),
    F('出厂编号', 'SY-2012-0876', 'clear'),
    F('制造日期', '2012-03', 'clear'),
    F('配用功率', '110', 'clear', { unit: 'kW' }),
    F('流量', '100', 'clear', { unit: 'm³/h' }),
    F('转速', '2950', 'clear', { unit: 'r/min' }),
    F('泵壳材质', 'ZG1Cr18Ni9Ti', 'clear'),
    F('重量', '820', 'clear', { unit: 'kg' }),
  ],
});
section('BVT', () => {
  r = run(['--fields', basicFields, '--tag', 'P-01', '--equip-type', '泵', '--ledger', LEDGER], 'basic');
  eq(r.summary.ok, true, '1.1 正常路径运行成功');
  eq(r.code, 0, '1.2 退出码 0');
  eq(r.summary.counts.fields, 9, '1.3 字段计数');
  eq(r.summary.counts.clear, 9, '1.4 clear 计数');
  eq(r.summary.counts.conflicts, 0, '1.5 参数一致时无冲突');
  eq(r.summary.tagExistsInLedger, true, '1.6 位号在台账中已存在');
  ok(r.json.warnings.some((w) => w.includes('无须重复录入')), '1.7 一致时提示无须重复录入');
  ok(r.json.fields.every((f) => f.match === 'same' || f.match === null), '1.8 各字段比对为一致');
});

// ================================================================ 2. 三档置信度（硬约束 1）
const confFields = mkFields({
  fields: [
    F('制造厂', '沈阳水泵厂', 'clear'),
    F('型号', 'ZA-1▢0-250', 'blurry', { reason: '油污遮挡一位' }),
    F('转速', null, 'unreadable', { reason: '锈蚀无法辨认' }),
  ],
});
section('A', () => {
  r = run(['--fields', confFields, '--tag', 'P-09', '--equip-type', '泵'], 'conf');
  eq(r.summary.ok, true, '2.1 三档置信度正常处理');
  eq(r.summary.counts.clear, 1, '2.2 clear 计数');
  eq(r.summary.counts.blurry, 1, '2.3 blurry 计数');
  eq(r.summary.counts.unreadable, 1, '2.4 unreadable 计数');
  eq(r.json.needVerify.length, 1, '2.5 blurry 字段进 needVerify 单列');
  eq(r.json.unreadable.length, 1, '2.6 unreadable 字段进 unreadable 单列');
  eq(r.json.needVerify[0].name, '型号', '2.7 needVerify 字段名正确');
  ok(r.json.needVerify[0].value.includes('▢'), '2.8 模糊位 ▢ 原样保留，未补全');
  ok(/## 三、需人工核对项/.test(r.md) && /## 四、无法辨认项/.test(r.md), '2.9 md 中模糊与无法辨认分节单列');
  const blurryProp = r.json.proposed.find((p) => p.name === '型号');
  eq(blurryProp.value, null, '2.10 blurry 字段建议录入值留空，绝不猜测');
  const unreadProp = r.json.proposed.find((p) => p.name === '转速');
  eq(unreadProp.value, null, '2.11 unreadable 字段建议录入值留空');
});

// 2.12~2.16 置信度非法输入一律报错，不得默认 clear
section('A', () => {
  r = run(['--fields', mkFields({ fields: [F('制造厂', 'X', 'high')] }), '--tag', 'P-09', '--equip-type', '泵'], 'badconf');
  eq(r.summary.ok, false, '2.12 非法置信度报错');
  ok(/只能是 clear/.test(r.summary.error), '2.13 非法置信度错误信息明确');
  r = run(['--fields', mkFields({ fields: [{ name: '制造厂', value: 'X' }] }), '--tag', 'P-09', '--equip-type', '泵'], 'noconf');
  eq(r.summary.ok, false, '2.14 缺置信度报错（不默认为 clear）');
  ok(/不得默认为清晰可读/.test(r.summary.error), '2.15 缺置信度错误信息说明不默认');
  r = run(['--fields', mkFields({ fields: [F('制造厂', '沈阳水泵厂', 'unreadable')] }), '--tag', 'P-09', '--equip-type', '泵'], 'contradict');
  eq(r.summary.ok, false, '2.16 unreadable 但 value 非空 → 矛盾报错，不替用户选一个');
});

// 2.17~2.19 自相矛盾的轻量情形改判并 warning
section('B', () => {
  r = run(['--fields', mkFields({ fields: [F('制造厂', null, 'clear'), F('型号', 'ZA-1▢0', 'clear')] }), '--tag', 'P-09', '--equip-type', '泵'], 'fixconf');
  eq(r.summary.counts.unreadable, 1, '2.17 clear 但值为空 → 改判 unreadable');
  eq(r.summary.counts.blurry, 1, '2.18 clear 但含 ▢ → 改判 blurry');
  ok(r.json.warnings.some((w) => w.includes('改判')), '2.19 改判有 warning');
});

// 2.20 blurry 缺 reason → warning 不中断
section('C', () => {
  r = run(['--fields', mkFields({ fields: [F('型号', 'ZA-1▢0', 'blurry')] }), '--tag', 'P-09', '--equip-type', '泵'], 'noreason');
  eq(r.summary.ok, true, '2.20 blurry 缺 reason 不中断');
  ok(r.json.warnings.some((w) => w.includes('未说明原因')), '2.21 blurry 缺 reason 有 warning');
});

// 2.22 简写形式（无置信度）被拒
section('B', () => {
  r = run(['--fields', mkFields({ '制造厂': '沈阳水泵厂' }), '--tag', 'P-09', '--equip-type', '泵'], 'shorthand');
  eq(r.summary.ok, false, '2.22 无置信度的简写形式被拒绝');
  ok(/置信度/.test(r.summary.error), '2.23 简写被拒的错误信息提到置信度');
});

// ================================================================ 3. 位号必须由用户提供（硬约束 2）
section('B', () => {
  r = run(['--fields', basicFields, '--equip-type', '泵'], 'notag');
  eq(r.summary.ok, false, '3.1 缺 --tag 报错');
  eq(r.code, 1, '3.2 缺 --tag 退出码 1');
  ok(/位号须由用户提供/.test(r.summary.error), '3.3 错误信息说明位号须用户提供');
  ok(/不得从照片、设备喷漆字或文件名推断/.test(r.summary.error), '3.4 错误信息禁止从照片或文件名推断');
});
// 出厂编号不得被当作位号回填
const snOnly = mkFields({ photo: 'P-77铭牌.jpg', fields: [F('出厂编号', 'SY-9999-0001', 'clear')] });
section('A', () => {
  r = run(['--fields', snOnly, '--tag', 'P-88', '--equip-type', '泵'], 'sn');
  eq(r.summary.tag, 'P-88', '3.5 位号以 --tag 为准，未被出厂编号覆盖');
  ok(r.json.meta.tag === 'P-88', '3.6 intake.json 中位号为用户提供值');
  ok(r.json.warnings.some((w) => w.includes('不是位号')), '3.7 warning 说明出厂编号不是位号');
  ok(!/P-77/.test(JSON.stringify(r.json.meta.tag)), '3.8 未从照片文件名 P-77 推断位号');
});

// ================================================================ 4. 台账冲突不自动覆盖（硬约束 3，关键）
const conflictFields = mkFields({
  fields: [
    F('制造厂', '大连耐酸泵厂', 'clear'),
    F('型号', 'ZA-100-315', 'clear'),
    F('出厂编号', 'DL-2019-0123', 'clear'),
    F('制造日期', '2019-06', 'clear'),
    F('配用功率', '132', 'clear', { unit: 'kW' }),
  ],
});
const ledgerBefore = fs.readFileSync(LEDGER);
section('A', () => {
  r = run(['--fields', conflictFields, '--tag', 'P-01', '--equip-type', '泵', '--ledger', LEDGER], 'conflict');
  eq(r.summary.ok, true, '4.1 冲突情况下正常出结果');
  eq(r.summary.counts.conflicts, 5, '4.2 五项字段与台账不一致');
  ok(r.json.conflicts.every((c) => c.recognized !== null && c.ledger !== null), '4.3 冲突项同时保留识别值与台账现值');
  ok(r.json.conflicts.every((c) => Array.isArray(c.possibilities) && c.possibilities.length === 2), '4.4 每项冲突给出两种可能供用户判断');
  ok(r.json.conflicts.some((c) => /识别错误/.test(c.possibilities[0])), '4.5 可能一：识别错误');
  ok(r.json.conflicts.some((c) => /设备已更换/.test(c.possibilities[1])), '4.6 可能二：设备已更换');
  ok(r.json.conflicts.find((c) => c.name === '出厂编号').hint.includes('设备已更换'), '4.7 出厂编号不一致时提示可能已更换');
  ok(r.json.warnings.some((w) => w.includes('不自动覆盖台账')), '4.8 warning 声明不自动覆盖台账');
  ok(/请逐项判断是「识别错误」还是「设备已更换」/.test(r.md), '4.9 md 要求用户逐项判断');
  // 冲突字段绝不进建议录入值
  const confProps = r.json.proposed.filter((p) => ['型号', '出厂编号', '制造厂'].includes(p.name));
  ok(confProps.every((p) => p.value === null), '4.10 冲突字段建议录入值一律留空');
  ok(confProps.every((p) => p.status === '与台账冲突待判断'), '4.11 冲突字段状态标注正确');
  // 硬约束 5：不修改用户台账文件
  ok(Buffer.compare(ledgerBefore, fs.readFileSync(LEDGER)) === 0, '4.12 台账文件字节未被修改');
});

// 4.13 blurry 字段冲突时提示优先核对识别
const blurryConflict = mkFields({ fields: [F('型号', 'ZA-100-2▢0', 'blurry', { reason: '末位模糊' })] });
section('C', () => {
  r = run(['--fields', blurryConflict, '--tag', 'P-01', '--equip-type', '泵', '--ledger', LEDGER], 'blurconf');
  eq(r.summary.counts.conflicts, 1, '4.13 模糊字段与台账不一致也计入冲突');
  ok(r.json.conflicts[0].hint.includes('部分模糊'), '4.14 模糊字段冲突优先提示核对识别');
});

// 4.15 易混字符差异的提示
const confuseFields = mkFields({ fields: [F('出厂编号', 'SY-2O12-O876', 'clear')] });
section('C', () => {
  r = run(['--fields', confuseFields, '--tag', 'P-01', '--equip-type', '泵', '--ledger', LEDGER], 'confuse');
  eq(r.summary.counts.conflicts, 1, '4.15 易混字符差异计入冲突');
  ok(/易混字符|设备已更换/.test(r.json.conflicts[0].hint), '4.16 易混字符差异给出提示');
});

// 4.17 位号不在台账中 → 新增建档，无冲突
section('B', () => {
  r = run(['--fields', conflictFields, '--tag', 'P-99', '--equip-type', '泵', '--ledger', LEDGER], 'newtag');
  eq(r.summary.tagExistsInLedger, false, '4.17 位号不在台账中');
  eq(r.summary.counts.conflicts, 0, '4.18 新增建档无冲突');
  ok(/新增建档/.test(r.md), '4.19 md 说明按新增建档处理');
});

// 4.20 归一化后一致不算冲突（空白/全角/大小写/×/φ）
const normFields = mkFields({ fields: [F('型号', ' ｚａ-100-250 ', 'clear'), F('制造厂', '沈阳水泵厂 ', 'clear')] });
section('B', () => {
  r = run(['--fields', normFields, '--tag', 'P-01', '--equip-type', '泵', '--ledger', LEDGER], 'norm');
  eq(r.summary.counts.conflicts, 0, '4.20 归一化后一致不报冲突');
});

// ================================================================ 5. 未提供台账不臆断
section('A', () => {
  r = run(['--fields', basicFields, '--tag', 'P-01', '--equip-type', '泵'], 'noledger');
  eq(r.summary.counts.conflicts, null, '5.1 无台账时 conflicts 为 null 不是 0');
  eq(r.summary.tagExistsInLedger, null, '5.2 无台账时不判断位号是否存在');
  ok(/未提供台账文件/.test(r.md), '5.3 md 说明未提供台账');
  ok(/这不代表台账中没有该位号/.test(r.md), '5.4 md 明确未比对不等于台账无此位号');
  ok(r.json.warnings.some((w) => w.includes('不代表台账中没有该位号')), '5.5 warning 同样声明');
});

// ================================================================ 6. 单位换算校验（硬约束 7）
const unitFields = mkFields({
  fields: [
    F('额定功率', '180', 'clear', { unit: '马力' }),
    F('额定电压', '6', 'clear', { unit: 'kV' }),
    F('额定电流', '15.8', 'clear', { unit: 'A' }),
    F('重量', '1.35', 'clear', { unit: 't' }),
    F('额定转速', '2980', 'clear', {}),
  ],
});
section('A', () => {
  r = run(['--fields', unitFields, '--tag', 'M-01', '--equip-type', '电机'], 'unit');
  eq(r.summary.ok, true, '6.1 单位校验不中断');
  const pf = r.json.fields.find((f) => f.name === '额定功率');
  eq(pf.unitCheck.status, 'mismatch', '6.2 马力与 kW 判为不一致');
  eq(pf.value, '180', '6.3 不自动换算，value 保持铭牌原值');
  ok(pf.unitCheck.reference && pf.unitCheck.reference.includes('kW'), '6.4 给出换算参考值');
  ok(/不自动换算/.test(pf.unitCheck.message), '6.5 提示脚本不自动换算');
  const cf = r.json.fields.find((f) => f.name === '额定电流');
  eq(cf.unitCheck.status, 'ok', '6.6 单位一致时判 ok');
  const sf = r.json.fields.find((f) => f.name === '额定转速');
  eq(sf.unitCheck.status, 'missing', '6.7 未标注单位时判 missing');
  ok(r.json.warnings.some((w) => w.includes('不假设铭牌单位即为台账口径')), '6.8 未标注单位不做假设');
  ok(r.json.unitIssues.length >= 3, '6.9 单位问题汇总进 unitIssues');
});
section('C', () => {
  ok(/### 3.2 单位需核对（脚本只校验不换算）/.test(r.md), '6.10 md 单位核对分节');
});

// ================================================================ 7. 不补充铭牌上没有的参数（硬约束 4）
section('A', () => {
  r = run(['--fields', basicFields, '--tag', 'P-01', '--equip-type', '泵', '--ledger', LEDGER], 'noextra');
  const names = r.json.fields.map((f) => f.name);
  ok(!names.includes('投用日期'), '7.1 未补充投用日期');
  ok(!names.includes('检修历史'), '7.2 未补充检修历史');
  ok(!names.includes('区域') && !names.includes('专业'), '7.3 未补充区域与专业');
  ok(r.json.proposed.every((p) => p.ledgerColumn !== '投用日期'), '7.4 制造日期未对齐到投用日期');
  ok(r.json.fields.find((f) => f.name === '制造日期').ledgerColumn === '制造日期', '7.5 制造日期只对齐制造日期列');
  ok(r.json.proposed.length === r.json.fields.length, '7.6 建议录入行不多于识别字段，未凭空新增');
});

// ================================================================ 8. 声明行（硬约束 6）
const DECL = '识别值由模型读图产生，未经脚本验证，须与铭牌原件或出厂资料核对后方可录入台账；本技能不直接修改台账文件';
const OLD_DECL = '识别结果须与铭牌原件或出厂资料核对后方可录入台账；本技能不直接修改台账文件';
section('B', () => {
  ok(r.md.includes(DECL), '8.1 md 含固定声明行');
  ok(r.csv.includes(DECL), '8.2 csv 含固定声明行');
  eq(r.json.meta.declaration, DECL, '8.3 intake.json 记录声明行原文');
  ok(r.md.trim().endsWith(DECL + '。'), '8.4 md 末尾保留声明行');
});
section('C', () => {
  ok(!r.md.includes(OLD_DECL), '8.5 旧声明行（无「模型读图产生、未经脚本验证」）不再出现');
  ok(/未经脚本验证/.test(r.md) && /模型读图产生/.test(r.md), '8.6 声明行明示识别值由模型读图产生、未经脚本验证');
  ok(r.json.meta.recognitionNote && /不读图片/.test(r.json.meta.recognitionNote), '8.7 meta 记录脚本不读图片的分工说明');
});

// ================================================================ 9. intake.csv
section('C', () => {
  ok(r.csv.charCodeAt(0) === 0xfeff, '9.1 csv 带 UTF-8 BOM');
  const head = r.csv.replace(/^﻿/, '').split('\r\n')[0];
  ok(head.startsWith('位号,设备类型,铭牌字段'), '9.2 csv 表头正确');
  ok(head.includes('置信度') && head.includes('建议录入值'), '9.3 csv 含置信度与建议录入值列');
  ok(r.csv.split('\r\n').length >= r.json.fields.length + 1, '9.4 csv 行数覆盖全部字段');
});
// csv 中冲突字段建议录入值留空
section('B', () => {
  r = run(['--fields', conflictFields, '--tag', 'P-01', '--equip-type', '泵', '--ledger', LEDGER], 'csvconf');
  const modelLine = r.csv.split('\r\n').find((l) => l.includes('型号') && !l.includes('铭牌字段'));
  ok(modelLine.includes('与台账冲突待判断'), '9.5 csv 冲突行标注状态');
  ok(r.csv.includes(',,与台账冲突待判断'), '9.6 csv 冲突行建议录入值为空');
});

// ================================================================ 10. 设备类型
section('B', () => {
  r = run(['--fields', basicFields, '--tag', 'P-01', '--equip-type', 'pump'], 'entype');
  eq(r.summary.equipType, '泵', '10.1 英文设备类型可识别');
  r = run(['--fields', basicFields, '--tag', 'P-01', '--equip-type', '离心泵'], 'cntype');
  eq(r.summary.equipType, '泵', '10.2 离心泵归入泵');
  r = run(['--fields', basicFields, '--tag', 'P-01', '--equip-type', '起重机'], 'badtype');
  eq(r.summary.ok, false, '10.3 不支持的设备类型报错');
  ok(/不按通用类型兜底/.test(r.summary.error), '10.4 不按通用类型兜底');
  // 字段模板缺项提示
  r = run(['--fields', mkFields({ fields: [F('制造厂', 'X', 'clear')] }), '--tag', 'P-01', '--equip-type', '泵'], 'tplmiss');
  ok(r.summary.counts.templateMissing > 0, '10.5 模板缺项计数');
  ok(r.json.warnings.some((w) => w.includes('未提交识别结果')), '10.6 模板缺项 warning');
  // 模板外字段保留并提示
  r = run(['--fields', mkFields({ fields: [F('制造厂', 'X', 'clear'), F('换热面积', '100', 'clear', { unit: 'm²' })] }), '--tag', 'P-01', '--equip-type', '泵'], 'offtpl');
  ok(r.json.offTemplate.includes('换热面积'), '10.7 模板外字段单列');
  ok(r.json.warnings.some((w) => w.includes('核对设备类型是否选对')), '10.8 模板外字段提示核对类型');
});

// ================================================================ 11. 台账变体：别名列头 + 标题行 + 合计行 + 缺列
const aliasLedger = mkXlsx('alias.xlsx', {
  '设备清单': [
    ['某厂动设备台账导出'],
    [],
    ['设备位号', '名称', '型号', '生产厂家', '投用时间', '功率(kW)'],
    ['P-01', '进料泵A', 'ZA-100-250', '沈阳水泵厂', '2012-06-15', 110],
    ['合计', '', '', '', '', ''],
  ],
});
section('B', () => {
  r = run(['--fields', basicFields, '--tag', 'P-01', '--equip-type', '泵', '--ledger', aliasLedger], 'alias');
  eq(r.summary.ok, true, '11.1 别名列头台账可读');
  eq(r.summary.tagExistsInLedger, true, '11.2 标题行下的位号可查到');
  ok(r.json.warnings.some((w) => w.includes('合计行')), '11.3 合计行跳过并 warning');
  ok(r.json.unmapped.some((x) => x.name === '出厂编号'), '11.4 台账缺「出厂编号」列时单列 unmapped');
  ok(r.json.unmapped.every((x) => x.reason), '11.5 unmapped 项注明原因');
  ok(!r.json.conflicts.some((c) => c.name === '出厂编号'), '11.6 台账无此列时不硬塞进相近列报冲突');
  ok(/台账无对应列的字段/.test(r.md), '11.7 md 列出台账无对应列的字段');
  // 别名列（「生产厂家」→制造厂、「型号」→规格型号）须能定位到台账现值，而不是误报「台账无此列」
  const makerF = r.json.fields.find((f) => f.name === '制造厂');
  eq(makerF.ledgerValue, '沈阳水泵厂', '11.7a 别名列「生产厂家」可定位到台账现值');
  eq(makerF.match, 'same', '11.7b 别名列比对结果正确');
  const modelF = r.json.fields.find((f) => f.name === '型号');
  eq(modelF.ledgerValue, 'ZA-100-250', '11.7c 别名列「型号」可定位到规格型号');
  ok(!r.json.unmapped.some((x) => x.name === '制造厂'), '11.7d 别名列存在时不误判为台账无对应列');
});
// 带单位后缀的台账列也可按别名定位（「功率(kW)」↔「功率」）
const unitColLedger = mkXlsx('unitcol.xlsx', {
  '设备台账': [['位号', '功率', '转速'], ['P-01', 110, 2950]],
});
const powerFields = mkFields({ fields: [F('配用功率', '110', 'clear', { unit: 'kW' }), F('转速', '2950', 'clear', { unit: 'r/min' })] });
section('B', () => {
  const r11 = run(['--fields', powerFields, '--tag', 'P-01', '--equip-type', '泵', '--ledger', unitColLedger], 'unitcol');
  eq(r11.json.fields.find((f) => f.name === '配用功率').match, 'same', '11.7e 台账列「功率」可对齐「功率(kW)」');
  eq(r11.summary.counts.conflicts, 0, '11.7f 带单位后缀的列名差异不误报冲突');
});

// 11.8 台账中无位号列
const noTagCol = mkXlsx('notagcol.xlsx', { '设备台账': [['设备名称', '型号'], ['进料泵A', 'ZA-100-250']] });
section('B', () => {
  r = run(['--fields', basicFields, '--tag', 'P-01', '--equip-type', '泵', '--ledger', noTagCol], 'notagcol');
  eq(r.summary.ok, true, '11.8 台账缺位号列不中断');
  eq(r.summary.counts.conflicts, null, '11.9 无位号列时不做比对，conflicts 为 null');
  ok(r.json.warnings.some((w) => w.includes('无法查重')), '11.10 无位号列 warning');
});

// 11.11 台账文件中无设备台账工作表
const noSheet = mkXlsx('nosheet.xlsx', { '随便一张表': [['a', 'b'], [1, 2]] });
section('B', () => {
  r = run(['--fields', basicFields, '--tag', 'P-01', '--equip-type', '泵', '--ledger', noSheet], 'nosheet');
  eq(r.summary.ok, true, '11.11 台账无对应工作表不中断');
  ok(r.json.warnings.some((w) => w.includes('未找到「设备台账」工作表')), '11.12 无工作表 warning');
});

// 11.13 台账某字段为空 → ledgerEmpty，不判冲突
const emptyLedger = mkXlsx('emptycell.xlsx', {
  '设备台账': [['位号', '规格型号', '制造厂'], ['P-01', '', '沈阳水泵厂']],
});
section('B', () => {
  r = run(['--fields', basicFields, '--tag', 'P-01', '--equip-type', '泵', '--ledger', emptyLedger], 'emptycell');
  const mf = r.json.fields.find((f) => f.name === '型号');
  eq(mf.match, 'ledgerEmpty', '11.13 台账该字段为空判 ledgerEmpty');
  ok(!r.json.conflicts.some((c) => c.name === '型号'), '11.14 台账为空不算冲突');
  ok(/台账未填/.test(r.md), '11.15 md 显示「台账未填」而非留白');
});

// ================================================================ 12. 参数校验
function runRaw(args) {
  const rr = spawnSync(process.execPath, [INTAKE, ...args], { encoding: 'utf8' });
  const lines = rr.stdout.trim().split('\n');
  try { return { code: rr.status, s: JSON.parse(lines[lines.length - 1]) }; } catch (e) { return { code: rr.status, s: { ok: false, error: 'no-json' } }; }
}
section('B', () => {
  x = runRaw(['--fields']);
  eq(x.s.ok, false, '12.1 --fields 缺值报错');
});
section('C', () => {
  ok(/缺少取值/.test(x.s.error), '12.2 缺值错误信息正确');
});
section('B', () => {
  x = runRaw(['--fields', basicFields, '--tag', 'P-01']);
  eq(x.s.ok, false, '12.3 缺 --equip-type 报错');
  x = runRaw(['--fields', basicFields, '--tag', 'P-01', '--equip-type', '泵', '--未知参数', 'x']);
  eq(x.s.ok, false, '12.4 未知参数报错');
  eq(x.code, 1, '12.5 未知参数退出码 1');
  x = runRaw(['--fields', '/不存在的文件.json', '--tag', 'P-01', '--equip-type', '泵']);
  eq(x.s.ok, false, '12.6 --fields 文件不存在报错');
  x = runRaw(['--fields', '{不是JSON', '--tag', 'P-01', '--equip-type', '泵']);
  eq(x.s.ok, false, '12.7 --fields 非法 JSON 报错');
  x = runRaw(['--fields', mkFields({ fields: [] }), '--tag', 'P-01', '--equip-type', '泵']);
  eq(x.s.ok, false, '12.8 fields 数组为空报错');
  x = runRaw(['--fields', mkFields({ fields: [{ value: 'X', confidence: 'clear' }] }), '--tag', 'P-01', '--equip-type', '泵']);
  eq(x.s.ok, false, '12.9 字段缺 name 报错');
  x = runRaw(['--fields', basicFields, '--tag', 'P-01', '--equip-type', '泵', '--ledger', '/不存在.xlsx']);
  eq(x.s.ok, false, '12.10 台账不存在报错');
});
section('C', () => {
  ok(/台账不存在/.test(x.s.error), '12.11 台账不存在错误信息明确');
});
section('B', () => {
  x = runRaw(['--fields', basicFields, '--tag', ' ', '--equip-type', '泵']);
  eq(x.s.ok, false, '12.12 --tag 为空白时报错');
});

// ================================================================ 13. 产出完整性
section('BVT', () => {
  r = run(['--fields', basicFields, '--tag', 'P-01', '--equip-type', '泵', '--ledger', LEDGER], 'final');
  ok(fs.existsSync(path.join(r.out, 'intake.json')), '13.1 intake.json 已生成');
  ok(fs.existsSync(path.join(r.out, 'intake.md')), '13.2 intake.md 已生成');
  ok(fs.existsSync(path.join(r.out, 'intake.csv')), '13.3 intake.csv 已生成');
  ok(fs.existsSync(path.join(r.out, 'summary.json')), '13.4 summary.json 已落盘');
  eq(JSON.parse(fs.readFileSync(path.join(r.out, 'summary.json'), 'utf8')).ok, true, '13.5 summary.json 内容正确');
  ok(/## 一、识别概览/.test(r.md) && /## 二、逐字段识别结果/.test(r.md) && /## 三、需人工核对项/.test(r.md)
    && /## 四、无法辨认项/.test(r.md) && /## 五、与台账的差异项/.test(r.md)
    && /## 六、建议录入内容（待确认稿）/.test(r.md) && /## 七、录入建议说明/.test(r.md), '13.6 md 七节结构齐全');
  ok(/<!-- ANALYSIS_START -->/.test(r.md) && /<!-- ANALYSIS_END -->/.test(r.md), '13.7 分析段占位符存在');
  ok(/待确认稿/.test(r.md), '13.8 建议录入标注为待确认稿');
  ok(r.json.counts && typeof r.json.counts.fields === 'number', '13.9 counts 齐全');
  ok(Array.isArray(r.json.warnings), '13.10 warnings 为数组');
});
section('C', () => {
  ok(r.json.meta.generatedAt && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(r.json.meta.generatedAt), '13.11 生成时间为北京时间格式');
});

// 13.12 字段重复只取第一条
section('C', () => {
  r = run(['--fields', mkFields({ fields: [F('制造厂', 'A', 'clear'), F('制造厂', 'B', 'clear')] }), '--tag', 'P-01', '--equip-type', '泵'], 'dup');
  eq(r.summary.counts.fields, 1, '13.12 重复字段只保留一条');
  ok(r.json.warnings.some((w) => w.includes('重复出现')), '13.13 重复字段 warning');
});

// 13.14 --fields 也接受内联 JSON 字符串
section('B', () => {
  x = runRaw(['--fields', JSON.stringify({ fields: [F('制造厂', '沈阳水泵厂', 'clear')] }), '--tag', 'P-01', '--equip-type', '泵', '--out', path.join(work, 'inline-out')]);
  eq(x.s.ok, true, '13.14 --fields 支持内联 JSON 字符串');
});


// ================================================================ 14. 中石化口径：raw 必填与量级校验
const rawFields = mkFields({
  fields: [
    F('制造厂', '沈阳水泵厂', 'clear', { raw: '沈阳水泵厂' }),
    F('配用功率', '110', 'clear', { unit: 'kW', raw: '110kW' }),                 // 一致
    F('设计压力', '40', 'clear', { unit: 'MPa', raw: '4.0MPa' }),               // 量级错位 → 改判 blurry
    F('流量', '120', 'clear', { unit: 'm³/h', raw: '100 m3/h' }),               // 数字不一致 → warning
    F('转速', '2950', 'clear', { unit: 'r/min' }),                               // 缺 raw → warning + rawMissing
    F('效率', '72.5', 'clear', { unit: '%', raw: '效率 η' }),                    // raw 无数字
    F('汽蚀余量', null, 'unreadable', { reason: '锈蚀' }),                       // unreadable 不要求 raw
  ],
});
section('A', () => {
  r = run(['--fields', rawFields, '--tag', 'P-01', '--equip-type', '泵'], 'raw');
  eq(r.summary.ok, true, '14.1 raw 校验不中断');
  const dp = r.json.fields.find((f) => f.name === '设计压力');
  eq(dp.confidence, 'blurry', '14.2 识别值与 raw 相差 10 倍 → 改判 blurry（疑似小数点错位）');
  eq(dp.rawCheck.status, 'magnitude', '14.3 rawCheck 标 magnitude');
  ok(r.json.warnings.some((w) => w.includes('设计压力') && w.includes('疑似小数点错位')), '14.4 量级错位 warning');
  ok(r.json.proposed.find((p) => p.name === '设计压力').value === null, '14.5 改判 blurry 后建议录入值留空');
  const fl = r.json.fields.find((f) => f.name === '流量');
  eq(fl.confidence, 'clear', '14.6 数字不一致但非倍数关系不改判');
  eq(fl.rawCheck.status, 'mismatch', '14.7 rawCheck 标 mismatch');
  ok(r.json.warnings.some((w) => w.includes('流量') && w.includes('未出现在铭牌原文')), '14.8 不一致 warning');
  const sp = r.json.fields.find((f) => f.name === '转速');
  eq(sp.rawMissing, true, '14.9 缺 raw 标 rawMissing');
  ok(r.json.warnings.some((w) => w.includes('转速') && w.includes('未提供铭牌原文 raw')), '14.10 缺 raw warning');
  ok(r.json.proposed.find((p) => p.name === '转速').note.includes('未做量级校验'), '14.11 缺 raw 的建议录入行注明未做量级校验');
  eq(r.json.fields.find((f) => f.name === '配用功率').rawCheck.status, 'ok', '14.12 raw 一致判 ok');
  eq(r.json.fields.find((f) => f.name === '效率').rawCheck.status, 'noNumberInRaw', '14.13 raw 无数字单独标注');
  eq(r.json.fields.find((f) => f.name === '汽蚀余量').rawMissing, false, '14.14 unreadable 字段不要求 raw');
  eq(r.summary.counts.rawMissing, 1, '14.15 counts.rawMissing');
  eq(r.summary.counts.rawIssues, 4, '14.16 counts.rawIssues（缺失+错位+不一致+无数字）');
});
section('C', () => {
  ok(/### 3.3 铭牌原文（raw）量级校验/.test(r.md), '14.17 md 单列 raw 量级校验小节');
  ok(/铭牌原文缺失 \/ 量级需核对 \| 1 \/ 3/.test(r.md), '14.18 概览给出原文缺失与量级需核对数');
});
section('A', () => {
  ok(r.json.rawIssues.length === 4, '14.19 rawIssues 数组齐全');
});

// ================================================================ 15. SAP PM / EM 台账列名：功能位置为位号、「设备」流水号单列、设备描述、制造商、型号编号、制造商序列号、设备代码
const sapLedger = mkXlsx('sap.xlsx', {
  '技术对象清单': [
    ['功能位置', '设备', '设备描述', '对象类型', '制造商', '型号编号', '制造商序列号', '建造年份', '设备代码'],
    ['P-01', '10012345', '进料泵A', '离心泵', '沈阳水泵厂', 'ZA-100-250', 'SY-2012-0876', '2012', ''],
    ['V-01', '10012346', '缓冲罐', '压力容器', '某容器厂', 'φ3000×8000', 'JD-2011-1102', '2011', '31010900012026'],
  ],
});
section('A', () => {
  r = run(['--fields', basicFields, '--tag', 'P-01', '--equip-type', '泵', '--ledger', sapLedger], 'sap');
  eq(r.summary.ok, true, '15.1 SAP 列名台账可读（工作表「技术对象清单」）');
  eq(r.summary.tagExistsInLedger, true, '15.2 「功能位置」识别为位号');
  eq(r.json.meta.ledgerMatchedBy, '位号', '15.3 按位号命中');
  eq(r.json.meta.ledgerEquipNo, '10012345', '15.4 SAP「设备」流水号单列为设备编号');
  eq(r.json.fields.find((f) => f.name === '制造厂').ledgerValue, '沈阳水泵厂', '15.5 「制造商」对齐制造厂');
  eq(r.json.fields.find((f) => f.name === '型号').ledgerValue, 'ZA-100-250', '15.6 「型号编号」对齐规格型号');
  eq(r.json.fields.find((f) => f.name === '出厂编号').ledgerValue, 'SY-2012-0876', '15.7 「制造商序列号」对齐出厂编号');
  eq(r.summary.counts.conflicts, 0, '15.8 SAP 台账各字段一致无冲突');
  ok(!r.json.proposed.some((p) => p.ledgerColumn === '投用日期'), '15.9 「建造年份」不被当作投用日期对齐制造日期');
});
section('B', () => {
  // 用 SAP 设备编号查台账：命中但标注按设备编号，位号不被替换
  r = run(['--fields', basicFields, '--tag', '10012345', '--equip-type', '泵', '--ledger', sapLedger], 'sapno');
  eq(r.summary.tagExistsInLedger, true, '15.10 按 SAP 设备编号可命中台账');
  eq(r.json.meta.ledgerMatchedBy, '设备编号', '15.11 标注按设备编号命中');
  eq(r.json.meta.ledgerTag, 'P-01', '15.12 带出台账功能位置');
  eq(r.json.meta.tag, '10012345', '15.13 用户给的标识原样保留，不被改写');
  ok(r.json.warnings.some((w) => w.includes('按台账「设备编号」列命中')), '15.14 按设备编号命中出 warning');
  ok(/按 SAP 设备编号命中/.test(r.md), '15.15 md 说明按设备编号命中');
  // 设备编号不作位号：位号 P-01 与设备编号 10012345 不混淆
  r = run(['--fields', basicFields, '--tag', 'P-02', '--equip-type', '泵', '--ledger', sapLedger], 'sapmiss');
  eq(r.summary.tagExistsInLedger, false, '15.16 位号与设备编号均未命中 → 新增建档');
});

// ================================================================ 16. 设备代码字段（特种设备铭牌 ↔ 台账设备代码）
const vesselFields = mkFields({
  fields: [
    F('制造厂', '某容器厂', 'clear', { raw: '某容器厂' }),
    F('型号', 'φ3000×8000', 'clear', { raw: 'φ3000×8000' }),
    F('出厂编号', 'JD-2011-1102', 'clear', { raw: 'JD-2011-1102' }),
    F('设备代码', '31010900012026', 'clear', { raw: '设备代码 31010900012026' }),
    F('设计压力', '1.6', 'clear', { unit: 'MPa', raw: '1.6MPa' }),
  ],
});
section('B', () => {
  r = run(['--fields', vesselFields, '--tag', 'V-01', '--equip-type', '容器', '--ledger', sapLedger], 'vcode');
  const dc = r.json.fields.find((f) => f.name === '设备代码');
  eq(dc.ledgerColumn, '设备代码', '16.1 「设备代码」字段对齐台账设备代码列');
  eq(dc.match, 'same', '16.2 设备代码与台账一致');
  ok(!r.json.warnings.some((w) => w.includes('「设备代码」不在')), '16.3 设备代码在容器字段模板内');
  ok(r.json.templateMissing.length > 0 && !r.json.templateMissing.includes('设备代码'), '16.4 模板缺项提示不含已提交的设备代码');
  r = run(['--fields', vesselFields, '--tag', 'V-01', '--equip-type', '泵'], 'vcodepump');
  ok(r.json.offTemplate.includes('设备代码'), '16.5 泵模板不含设备代码，按模板外字段提示');
});

// ================================================================ 17. 口径与产出
section('B', () => {
  r = run(['--fields', basicFields, '--tag', 'P-01', '--equip-type', '泵', '--ledger', LEDGER], 'misc');
});
section('C', () => {
  ok(!/[✅⚠️❌]/.test(r.md), '17.1 md 不含 emoji');
  ok(r.csv.charCodeAt(0) === 0xfeff && r.csv.includes(DECL), '17.2 csv 带 BOM 且含新声明行');
});
section('B', () => {
  ok(r.summary.counts.rawMissing === 9, '17.3 旧格式（无 raw）全部字段标 rawMissing 并 warning（不中断）');
});

// ================================================================ 18. 平台 MCP 台账口径（CSV 目录；制造日期为完整日期、数值去尾零、材质按部位合写）
// 设备资产管理 get_equipment_ledger 导出：制造日期「2015-02-01」、设计压力「2.5」、材质「泵体 ZG230-450 / 叶轮 ZG1Cr13」
const mcpDir = path.join(work, 'mcp-ledger');
fs.mkdirSync(mcpDir, { recursive: true });
fs.writeFileSync(path.join(mcpDir, '设备台账.csv'), '﻿' + [
  '位号,设备编号,设备名称,设备类型,规格型号,制造厂,出厂编号,制造日期,投用日期,材质,执行标准,设备代码,功率(kW),扬程(m),设计压力(MPa),设计温度(℃)',
  'P-01,10002100,进料泵,离心泵,OH2 150-400,北方石化泵业,176750,2015-02-01,2016-02-24,泵体 ZG230-450 / 叶轮 ZG1Cr13,API 610,,132,138,2.5,220',
  'V-01,10002275,电脱盐罐,压力容器,DN3600×18000,江北压力容器厂,166751,2013-04-01,2014-04-03,Q345R,GB/T 150,2110-3701-2015-1259,,,2,150',
].join('\r\n') + '\r\n', 'utf8');
const mcpPump = (date, press, mat) => mkFields({ fields: [
  F('型号', 'OH2 150-400', 'clear', { raw: 'OH2 150-400' }),
  F('出厂编号', '176750', 'clear', { raw: '176750' }),
  F('制造日期', date, 'clear', { raw: date }),
  F('设计压力', press, 'clear', { unit: 'MPa', raw: `${press}MPa` }),
  F('泵壳材质', mat, 'clear', { raw: mat }),
] });
const fm = (res, name) => (res.json.fields.find((f) => f.name === name) || {}).match;
section('B', () => {
  r = run(['--fields', mcpPump('2015.02', '2.50', 'ZG230-450'), '--tag', 'P-01', '--equip-type', '离心泵', '--ledger', mcpDir], 'mcp1');
  eq(r.summary.ok, true, '18.1 CSV 目录台账可读');
  eq(fm(r, '制造日期'), 'same', '18.2 铭牌制造日期「2015.02」与台账「2015-02-01」按铭牌精度（年月）比对为一致');
  eq(fm(r, '设计压力'), 'same', '18.3 铭牌「2.50」与台账「2.5」数值相等，不报冲突');
  eq(fm(r, '泵壳材质'), 'same', '18.4 泵壳材质与台账「泵体 ZG230-450 / 叶轮 ZG1Cr13」中泵体一段一致');
  eq(r.summary.counts.conflicts, 0, '18.5 格式差异不算冲突，0 冲突');
  ok(r.json.warnings.some((w) => w.includes('无须重复录入')), '18.6 全部一致时提示无须重复录入');
  r = run(['--fields', mcpPump('2015年2月', '2.5', 'ZG230-450'), '--tag', 'P-01', '--equip-type', '泵', '--ledger', mcpDir], 'mcp2');
  eq(fm(r, '制造日期'), 'same', '18.7 「2015年2月」与「2015-02-01」一致');
  r = run(['--fields', mcpPump('2015.03', '25', 'ZG1Cr13'), '--tag', 'P-01', '--equip-type', '泵', '--ledger', mcpDir], 'mcp3');
  eq(fm(r, '制造日期'), 'diff', '18.8 年月不同仍判不一致（不因放宽漏判）');
  eq(fm(r, '设计压力'), 'diff', '18.9 数值不等仍判不一致');
  eq((r.json.conflicts.find((c) => c.name === '设计压力') || {}).hint, '识别值与台账值相差 10 的整数倍，疑似小数点错位或漏位，优先核对识别是否有误', '18.10 设计压力 25 vs 2.5 提示疑似小数点错位');
  eq(fm(r, '泵壳材质'), 'diff', '18.11 泵壳材质与台账「叶轮」一段相同不算一致（不跨部位配对）');
  r = run(['--fields', mkFields({ fields: [F('制造日期', '2015-02-15', 'clear', { raw: '2015-02-15' })] }), '--tag', 'P-01', '--equip-type', '泵', '--ledger', mcpDir], 'mcp4');
  eq(fm(r, '制造日期'), 'diff', '18.12 铭牌精确到日且与台账日不同 → 不一致');
  r = run(['--fields', mkFields({ fields: [F('设计压力', '2.0', 'clear', { unit: 'MPa', raw: '2.0MPa' }), F('主体材质', 'Q345R', 'clear', { raw: 'Q345R' })] }), '--tag', 'V-01', '--equip-type', '压力容器', '--ledger', mcpDir], 'mcp5');
  eq(fm(r, '设计压力'), 'same', '18.13 容器铭牌「2.0」与台账「2」一致');
  eq(r.summary.equipType, '容器', '18.14 台账设备类型「压力容器」归入容器');
  // 新增建档（位号不在台账）：台账无对应列的字段同样进 unmapped，不因未命中而漏报
  r = run(['--fields', mkFields({ fields: [F('额定电压', '6000', 'clear', { unit: 'V', raw: '6000V' }), F('防爆标志', 'Ex db IIB T4 Gb', 'clear', { raw: 'Ex db IIB T4 Gb' }), F('额定功率', '250', 'clear', { unit: 'kW', raw: '250kW' })] }), '--tag', 'M-99', '--equip-type', '电机', '--ledger', mcpDir], 'mcpnew');
  eq(r.summary.tagExistsInLedger, false, '18.15 位号不在台账 → 新增建档');
  ok(r.json.unmapped.some((u) => u.name === '额定电压' && u.ledgerColumn === '电压(V)'), '18.16 新增建档时台账无「电压(V)」列 → 额定电压进 unmapped');
  ok(r.json.unmapped.some((u) => u.name === '防爆标志'), '18.17 新增建档时无对应台账列的字段进 unmapped');
  ok(!r.json.unmapped.some((u) => u.name === '额定功率'), '18.18 台账有对应列（功率(kW)）的字段不进 unmapped');
  eq(r.summary.counts.unmapped, 2, '18.19 新增建档 unmapped 计数');
});
section('C', () => {
  r = run(['--fields', basicFields, '--tag', 'A-01', '--equip-type', '空冷器'], 'aircool');
  eq(r.summary.equipType, '换热器', '18.20 台账设备类型「空冷器」归入换热器');
  r = run(['--fields', mkFields({ fields: [F('出厂编号', '0176750', 'clear', { raw: '0176750' })] }), '--tag', 'P-01', '--equip-type', '泵', '--ledger', mcpDir], 'mcpsn');
  eq(fm(r, '出厂编号'), 'diff', '18.21 编号列不按数值比：「0176750」与「176750」不一致');
});

// ================================================================ 19. 台账制造日期带时分秒、材质部位名与材质紧挨着写（2026-11-04 复核补充）
const mcpDir2 = path.join(work, 'mcp-ledger2');
fs.mkdirSync(mcpDir2, { recursive: true });
fs.writeFileSync(path.join(mcpDir2, '设备台账.csv'), '\ufeff' + [
  '位号,设备名称,制造日期,材质,设计压力(MPa)',
  'P-01,进料泵,2015-02-01 00:00:00,泵体铸铁 / 叶轮 ZG1Cr13,2.5',
  'P-02,回流泵,2015-02-01T08:30,泵壳：HT250 / 叶轮 ZG1Cr13,2.5',
].join('\r\n') + '\r\n', 'utf8');
const pump19 = (date, mat) => mkFields({ fields: [F('制造日期', date, 'clear', { raw: date }), F('泵壳材质', mat, 'clear', { raw: mat })] });
section('C', () => {
  r = run(['--fields', pump19('2015.02', '铸铁'), '--tag', 'P-01', '--equip-type', '泵', '--ledger', mcpDir2], 'mcp19a');
  eq(fm(r, '制造日期'), 'same', '19.1 台账「2015-02-01 00:00:00」与铭牌「2015.02」一致（先去掉时分秒）');
  eq(fm(r, '泵壳材质'), 'same', '19.2 台账「泵体铸铁」（部位名与材质紧挨）与铭牌「铸铁」一致');
  eq(r.summary.counts.conflicts, 0, '19.3 两项格式差异不算冲突');
  r = run(['--fields', pump19('2015.03', 'ZG1Cr13'), '--tag', 'P-01', '--equip-type', '泵', '--ledger', mcpDir2], 'mcp19b');
  eq(fm(r, '制造日期'), 'diff', '19.4 去掉时分秒后年月不同仍判不一致');
  eq(fm(r, '泵壳材质'), 'diff', '19.5 部位前缀匹配仍不跨部位配对（叶轮一段相同不算一致）');
  r = run(['--fields', pump19('2015-02', 'HT250'), '--tag', 'P-02', '--equip-type', '泵', '--ledger', mcpDir2], 'mcp19c');
  eq(fm(r, '制造日期'), 'same', '19.6 台账「2015-02-01T08:30」去掉时刻后与「2015-02」一致');
  eq(fm(r, '泵壳材质'), 'same', '19.7 「泵壳：HT250」带冒号仍按部位前缀匹配');
});

// ================================================================ 输出
console.log(`\n${'='.repeat(56)}`);
console.log(`nameplate-ocr-intake 自测：${pass} 通过，${fail} 失败`);
console.log(`用例级别 ${LEVELS[RUN_LEVEL]}：BVT ${byLevel.BVT}，A ${byLevel.A}，B ${byLevel.B}，C ${byLevel.C}`);
if (failures.length) { console.log('\n失败项：'); failures.forEach((f) => console.log('  ✗ ' + f)); }
console.log('='.repeat(56));
try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
