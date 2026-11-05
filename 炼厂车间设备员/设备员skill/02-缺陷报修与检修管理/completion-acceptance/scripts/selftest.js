#!/usr/bin/env node
'use strict';
/**
 * 自测：构造输入并断言 acceptance.js 行为。用法：node scripts/selftest.js（全绿退出 0）
 * 重点覆盖 SKILL.md 硬约束：
 *  1. --plan 质量控制点逐条比对，缺口列入 qcGap，不得静默忽略（txt / xlsx / docx 三种格式）
 *  2. 设备类型不覆盖 → 通用框架 + warning，技术指标标「待技术人员补充」，无任何经验数值
 *  3. 验收结论由验收组填写，items[].result 恒为 null（未回填时）
 *  4. 存在不合格项时 md 开头【注意】提示；不存在时不得出现该提示
 *  5. 声明行必须原文出现在 md 中
 *  6. requiredRecords 按检修内容确定（含质量验收记录 H/W 点、备件领用单）
 *  7. 三级验收（班组/车间/公司设备部门）+ 工艺 + 承修单位，无监理；检修分级旧值映射
 *  8. 中石化口径：压缩机/机组、加热炉、空冷器覆盖；EM 验收记录列名；无 emoji
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { writeXlsx } = require('./lib/xlsx-lite');
const R = require('./lib/rules');
const lite = require('./lib/docx-lite');

const SCRIPT = path.join(__dirname, 'acceptance.js');
const ROOT = path.join(__dirname, '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-selftest-'));
const DECL = '本清单为辅助核对工具，验收结论须由验收组现场确认并签字；未完成签字前设备不得投用。';
const EMOJI = /[\u26A0\u2705\u274C\u2714\u2716\u{1F300}-\u{1FAFF}]/u;
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
function run(extra = [], tag) {
  const out = path.join(work, (tag || 'case' + (++n)) + '-out');
  const r = spawnSync(process.execPath, [SCRIPT, ...extra, '--out', out], { encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  let summary;
  try { summary = JSON.parse(lines[lines.length - 1]); } catch (e) { summary = { ok: false, error: 'no-json:' + r.stdout + r.stderr }; }
  let json = null, md = null;
  if (fs.existsSync(path.join(out, 'acceptance.json'))) json = JSON.parse(fs.readFileSync(path.join(out, 'acceptance.json'), 'utf8'));
  if (fs.existsSync(path.join(out, 'acceptance.md'))) md = fs.readFileSync(path.join(out, 'acceptance.md'), 'utf8');
  return { code: r.status, summary, json, md, out };
}
const BASE = ['--tag', 'P-01', '--equip-type', '离心泵', '--scope', '解体检修，更换机械密封', '--contractor', '检修一队'];
function mk(name, book) { const p = path.join(work, name); writeXlsx(p, book); return p; }
function mkTxt(name, text) { const p = path.join(work, name); fs.writeFileSync(p, text, 'utf8'); return p; }
function mkDocx(name, paras, table) {
  const p = path.join(work, name);
  const body = paras.map((t) => lite.pXml(t)).join('') + (table ? lite.tblXml(table, { widths: table[0].map(() => 2000) }) : '');
  fs.writeFileSync(p, lite.buildDocx(body));
  return p;
}

let r;
// ================================================================ 1. 基础生成
section('BVT', () => {
  r = run(BASE, 'base');
  eq(r.summary.ok, true, '1.1 基础运行成功');
  ok(r.json.counts.items > 0, '1.2 生成了验收项');
});
section('A', () => {
  ok(r.json.items.every((x) => x.result === null), '1.3 **每项 result 恒为 null（脚本不预填合格）**');
  ok(r.json.items.every((x) => x.ruleId && x.categoryCn && x.item && x.standard && x.method && x.owner), '1.4 验收项字段齐全（含规则号，可追溯）');
  ok(new Set(R.CAT_ORDER).size === 5, '1.5 验收项分五大类别');
  ok(['外观与清洁', '装配质量', '密封与试压', '资料记录完整性'].every((c) => Object.keys(r.json.counts.byCategory).includes(c)), '1.6 五类中的常驻四类均有验收项');
  eq(r.json.conclusion.result, null, '1.7 验收结论 result 为 null（由验收组填写）');
  eq(r.json.signatures.length, 5, '1.8 签字栏五方（三级验收 + 工艺 + 承修单位）');
  ok(r.json.signatures.map((s) => s.role).join().includes('班组') && r.json.signatures.some((s) => /车间/.test(s.role)) && r.json.signatures.some((s) => /公司设备管理部门/.test(s.role)) && r.json.signatures.some((s) => /工艺（操作）/.test(s.role)) && r.json.signatures.some((s) => s.role === '承修单位'), '1.9 签字方为 班组/车间/公司设备管理部门/工艺（操作）/承修单位');
  ok(!r.json.signatures.some((s) => /监理/.test(s.role)) && !/监理 \|/.test(r.md), '1.10 **签字栏与报告无「监理」**');
  ok(!r.json.items.some((x) => /监理/.test(x.owner)), '1.11 验收项责任方无「监理」');
});
section('B', () => {
  ok(!r.json.items.some((x) => /施工单位/.test(x.owner)) && r.json.items.some((x) => /承修单位/.test(x.owner)), '1.12 责任方用「承修单位」而非「施工单位」');
  ok(/## 九、三级验收签字/.test(r.md) && /日常维修无监理/.test(r.md), '1.13 签字节标题为三级验收并注明无监理');
  ok(/临时编号，以厂内编号为准/.test(r.md), '1.14 未传 --no 时验收单编号标注为临时编号');
  ok(!/临时编号/.test(run([...BASE, '--no', 'YS-2026-001'], 'withno').md), '1.15 传 --no 时不出现临时编号提示');
});

// ================================================================ 2. 声明行（硬约束 5）
section('A', () => {
  ok(r.md.includes(DECL), '2.1 **md 中原文保留声明行**');
  eq(r.json.meta.declaration, DECL, '2.2 JSON meta 中保留声明行原文');
});

// ================================================================ 3. 设备类型不覆盖（硬约束 2）
section('A', () => {
  const unk = run(['--tag', 'X-01', '--equip-type', '离心式除尘器', '--scope', '解体大修，更换滤芯', '--contractor', '检修二队', '--trial-run'], 'unknown');
  eq(unk.summary.ok, true, '3.1 不覆盖类型仍成功出通用框架');
  eq(unk.json.meta.typeCovered, false, '3.2 typeCovered 为 false');
  ok(unk.summary.warnings.some((w) => w.includes('不在规则库覆盖范围内')), '3.3 **类型不覆盖有 warning**');
  ok(unk.json.items.some((x) => x.standard === R.TBD), '3.4 **专用技术指标标注「待技术人员补充」**');
  ok(unk.json.items.filter((x) => x.standard === R.TBD).length >= 3, '3.5 装配/密封/试运三类专用指标均留待补充');
  ok(!unk.json.items.some((x) => /\d+(\.\d+)?\s*(mm|℃|°C|MPa|kPa|A\b|mm\/s|N·m)/.test(x.standard)), '3.6 **不覆盖类型的验收标准中不含任何经验数值**');
  ok(/不在规则库覆盖范围内/.test(unk.md.split('## 一、')[0]), '3.7 md 开头提示类型未覆盖');
  ok(unk.json.items.every((x) => x.result === null), '3.8 不覆盖类型同样不预填结果');

});
// 覆盖的八类设备都能识别（含新增压缩机/机组、加热炉、空冷器；空冷器不得归到换热器）
section('C', () => {
  for (const [input, expectKey] of [['离心泵', 'centrifugalPump'], ['换热器', 'heatExchanger'], ['塔器', 'vesselColumn'], ['容器', 'vesselColumn'], ['阀门', 'valve'], ['电机', 'motor'],
    ['离心压缩机组', 'compressor'], ['循环氢压缩机', 'compressor'], ['K-3101 机组', 'compressor'], ['汽轮机', 'compressor'], ['加热炉', 'furnace'], ['常压炉', 'furnace'], ['裂解炉', 'furnace'], ['空冷器', 'airCooler'], ['A-1401 空冷', 'airCooler'], ['往复泵', 'centrifugalPump']]) {
    eq(R.classifyEquipType(input), expectKey, `3.9 设备类型识别「${input}」`);
  }
  ok(Object.keys(R.TYPE_CN).length === 8, '3.10 规则库覆盖八类设备');
});

// 新增三类的验收要点抽查（标准不含数值）
section('B', () => {
  const cmp = run(['--tag', 'K-9', '--equip-type', '离心压缩机组', '--scope', '解体大修，更换轴承与干气密封，对中', '--contractor', 'X', '--trial-run', '--pressure-test'], 'cmp').json;
  ok(['对中', '干气密封', '联锁', '轴位移', '盘车', '间隙'].every((k) => cmp.items.some((x) => x.item.includes(k))), '3.11 压缩机/机组覆盖对中/干气密封/联锁/轴位移/盘车/间隙');
  ok(cmp.items.some((x) => x.ruleId.startsWith('CMP-')), '3.12 压缩机规则号前缀 CMP-');
  ok(cmp.requiredRecords.some((x) => /联锁保护试验记录/.test(x.name)) && cmp.requiredRecords.some((x) => /对中（找正）记录/.test(x.name)), '3.13 机组试运 → 应附联锁试验记录与对中记录');
  ok(!cmp.items.some((x) => /\d+(\.\d+)?\s*(mm|℃|°C|MPa|kPa|mm\/s|μm|N·m)/.test(x.standard)), '3.14 压缩机验收标准不含经验数值');
  const fur = run(['--tag', 'F-9', '--equip-type', '加热炉', '--scope', '更换炉管、补焊、炉衬修补', '--contractor', 'X', '--trial-run', '--pressure-test'], 'fur').json;
  ok(['炉管', '燃烧器', '烘炉', '点火', '熄火'].every((k) => fur.items.some((x) => x.item.includes(k))), '3.15 加热炉覆盖炉管/燃烧器/烘炉/点火/熄火保护');
  ok(fur.items.some((x) => x.ruleId.startsWith('FUR-')), '3.16 加热炉规则号前缀 FUR-');
  const acc = run(['--tag', 'A-9', '--equip-type', '空冷器', '--scope', '抽管束清洗、更换丝堵垫片', '--contractor', 'X', '--trial-run', '--pressure-test'], 'acc').json;
  eq(acc.meta.equipTypeKey, 'airCooler', '3.17 空冷器归类为 airCooler 而非换热器');
  ok(['翅片', '丝堵', '风机', '水压试验'].every((k) => acc.items.some((x) => x.item.includes(k))), '3.18 空冷器覆盖翅片/丝堵/风机/水压试验');
  ok(!acc.items.some((x) => x.ruleId.startsWith('HEX-')), '3.19 空冷器不混入换热器规则');
});

// ================================================================ 4. 方案质量控制点比对（硬约束 1）
const planTxt = mkTxt('plan.txt', `P-01 检修方案

三、质量控制点
1. 质量控制点：泵与电机对中偏差实测并记录，符合技术文件规定
2. 质量控制点：机械密封安装到位，冲洗方案按原设计恢复
3. 质量控制点：手动盘车灵活无卡涩
4. 质量控制点：联轴器弹性块磨损量检查并记录更换情况
5. 质量控制点：随机附带的专用工具清点入库

四、工期
5 天
`);
section('A', () => {
  r = run([...BASE, '--plan', planTxt, '--trial-run'], 'plan');
  eq(r.summary.ok, true, '4.1 带方案运行成功');
  eq(r.json.counts.qcPoints, 5, '4.2 抽取到 5 个质量控制点');
  ok(r.json.counts.qcMatched + r.json.counts.qcGap === 5, '4.3 **每个控制点都有归宿（已对应或缺口），无一被静默丢弃**');
  ok(r.json.counts.qcGap >= 1, '4.4 无对应验收项的控制点列入 qcGap');
  ok(r.json.qcGap.every((g) => g.qc && g.srcLine && g.note), '4.5 qcGap 含控制点原文、方案出处行号与处理要求');
  ok(r.summary.warnings.some((w) => w.includes('未找到对应验收项')), '4.6 **缺口逐条 warning，不静默忽略**');
  ok(/## 六、与检修方案质量控制点对应情况/.test(r.md), '4.7 md 含质量控制点对应章节');
  ok(/质量控制点未找到对应验收项/.test(r.md.split('## 一、')[0]), '4.8 md 开头提示存在控制点缺口');
  ok(r.json.qcMatched.every((m) => m.seq && m.ruleId), '4.9 已对应项标出对应验收项序号与规则号');
  eq(r.json.meta.planFormat, 'txt', '4.9b meta 记录方案格式');
});

const planNoQc = mkTxt('plan-noqc.txt', 'V-01 检修方案\n\n一、检修内容\n清罐、防腐修补\n\n二、工期\n5 天\n');
// 方案中无控制点关键词 → 不静默成功，须 warning
section('A', () => {
  r = run([...BASE, '--plan', planNoQc], 'plan-noqc');
  eq(r.json.counts.qcPoints, 0, '4.10 无控制点关键词时 qcPoints 为 0');
  ok(r.summary.warnings.some((w) => w.includes('未识别出质量控制点')), '4.11 **未识别出控制点时 warning 提醒人工核对**');
  ok(/未识别出质量控制点/.test(r.md), '4.12 md 说明未识别出控制点');
  eq(r.json.counts.qcGap, null, '4.12b **未识别出控制点时没做比对，qcGap 为 null，不写成 0 缺口**');
  ok(r.json.qcGap === null && r.json.qcMatched === null, '4.12c 未识别出控制点时 json 的 qcGap、qcMatched 为 null（不是空数组 []）');
  eq(r.json.counts.qcMatched, null, '4.12d 未识别出控制点时 counts.qcMatched 为 null');
});

// 未提供方案 → qc* 为 null，不得倒推为 0 缺口
section('A', () => {
  r = run(BASE, 'noplan');
  eq(r.json.counts.qcPoints, null, '4.13 **未提供方案时 qcPoints 为 null（不按 0 计）**');
  eq(r.json.counts.qcGap, null, '4.14 未提供方案时 qcGap 为 null');
  ok(r.summary.warnings.some((w) => w.includes('未提供检修方案')), '4.15 未提供方案有 warning');
  ok(/未提供检修方案/.test(r.md), '4.16 md 写明未做控制点比对');
});

const planXlsx = mk('plan.xlsx', {
  '检修方案': [
    ['E-01 换热器检修方案'], [],
    ['章节', '内容'],
    ['质量控制点', '管束清洗后无结垢无堵管'],
    ['质量控制点', '管程水压试验按设计压力执行，无泄漏'],
  ],
});
// xlsx 形式的方案也能读
section('B', () => {
  r = run(['--tag', 'E-01', '--equip-type', '换热器', '--scope', '抽管束清洗、更换垫片', '--contractor', '检修三队', '--plan', planXlsx, '--pressure-test'], 'planxlsx');
  eq(r.summary.ok, true, '4.17 xlsx 方案可读');
  eq(r.json.counts.qcPoints, 2, '4.18 xlsx 方案抽取到 2 个控制点');
});

const planDocx = mkDocx('plan.docx', [
  'P-01 回流泵检修方案', '一、检修内容', '解体更换机封', '三、质量控制点',
  '1. 质量控制点：泵与电机对中偏差实测并记录，符合技术文件规定',
  '2. 质量控制点：机械密封安装到位，冲洗方案按原设计恢复',
  '3. 质量控制点：手动盘车灵活无卡涩',
  '四、工期', '3 天',
], [['序号', '工序', '见证类别'], ['1', '对中', 'H']]);
// docx 方案（Word）用 docx-lite 读取
section('B', () => {
  r = run([...BASE, '--plan', planDocx, '--trial-run'], 'plandocx');
  eq(r.summary.ok, true, '4.19 **docx 方案可直接读取（docx-lite）**');
  eq(r.json.counts.qcPoints, 3, '4.20 docx 方案抽取到 3 个控制点');
  eq(r.json.counts.qcGap, 0, '4.21 docx 方案控制点全部对应');
  eq(r.json.meta.planFormat, 'docx', '4.22 meta 记录方案格式为 docx');
  ok(!/<w:/.test(JSON.stringify(r.json.qcPoints)), '4.23 docx 文本已去除 XML 标签');
  // 旧版 .doc 与 PDF 明确报错而不是当空方案静默跳过
  r = run([...BASE, '--plan', mkTxt('plan.doc', 'x')], 'plandoc');
  eq(r.summary.ok, false, '4.24 .doc 方案明确报错');
  ok(/只解析 \.docx/.test(r.summary.error), '4.25 .doc 错误信息给出另存建议');
  r = run([...BASE, '--plan', mkTxt('plan.pdf', 'x')], 'planpdf');
  eq(r.summary.ok, false, '4.26 PDF 方案明确报错');
  ok(/先用平台 pdf 技能/.test(r.summary.error), '4.27 PDF 错误信息提示前置转换');
});
section('C', () => {
  r = run([...BASE, '--plan', mkTxt('broken.docx', 'not a zip')], 'brokendocx');
  eq(r.summary.ok, false, '4.28 损坏的 docx 报错而非静默');
});

// ================================================================ 5. 不合格项提示（硬约束 4）
const recBad = mk('rec-bad.xlsx', {
  '验收记录': [
    ['序号', '验收项', '验收结果', '备注'],
    ['', '设备及周边现场清洁、工完料尽场地清', '合格', ''],
    ['', '泵与电机对中（找正）', '不合格', '径向偏差超标'],
    ['', '机械密封（填料）安装与泄漏', '不合格', '试运后滴漏'],
  ],
});
section('A', () => {
  r = run([...BASE, '--records', recBad, '--trial-run'], 'bad');
  eq(r.json.counts.unqualified, 2, '5.1 识别 2 项不合格');
  ok(/【注意】\*\*存在 2 项不合格/.test(r.md.split('## 一、')[0]), '5.2 **md 开头用【注意】醒目提示存在不合格项**');
  ok(/不得投用/.test(r.md.split('## 一、')[0]), '5.3 开头提示含「不得投用」');
  ok(/## 四、不合格项与整改要求/.test(r.md), '5.4 md 含不合格项与整改章节');
  ok(r.json.unqualified.every((x) => x.seq && x.item), '5.5 不合格项含序号与验收内容');
  ok(/\*\*不合格\*\*/.test(r.md), '5.6 验收项表中不合格项加粗');
});
section('C', () => {
  ok(!EMOJI.test(r.md), '5.7 **md 不含 emoji（提示用【注意】）**');
});

const recGood = mk('rec-good.xlsx', {
  '验收记录': [
    ['序号', '验收项', '验收结果', '备注'],
    ['', '设备及周边现场清洁、工完料尽场地清', '合格', ''],
    ['', '泵与电机对中（找正）', '合格', ''],
  ],
});
section('A', () => {
  r = run([...BASE, '--records', recGood], 'good');
  eq(r.json.counts.unqualified, 0, '5.8 全合格时不合格数为 0');
  ok(!/存在 \d+ 项不合格/.test(r.md), '5.9 **无不合格项时不出现该提示**');
  ok(/无不合格项/.test(r.md), '5.10 md 说明本次回填无不合格项');
});

// ================================================================ 6. 未判定与未匹配，不按最宽松默认
const recOdd = mk('rec-odd.xlsx', {
  '验收记录': [
    ['序号', '验收项', '验收结果', '备注'],
    ['', '设备及周边现场清洁、工完料尽场地清', '待复测', '需二次确认'],
    ['', '设备本体外观完好', '', ''],
    ['', '某个根本不在清单里的项目名称', '合格', ''],
  ],
});
section('A', () => {
  r = run([...BASE, '--records', recOdd], 'odd');
  eq(r.json.counts.undeterminedResult, 1, '6.1 「待复测」归为未判定');
  ok(r.json.items.find((x) => x.item.includes('现场清洁')).result === '未判定', '6.2 **未判定不按合格处理**');
  ok(r.json.items.find((x) => x.item === '设备本体外观完好').result === null, '6.3 空结果仍为 null（不猜测）');
  eq(r.json.counts.unmatchedRecord, 1, '6.4 记录中不在清单的项单列 unmatchedRecord');
  ok(r.summary.warnings.some((w) => w.includes('未匹配到本清单')), '6.5 未匹配项有 warning，未被静默丢弃');
  ok(r.summary.warnings.some((w) => w.includes('无法归类')), '6.6 未判定有 warning 并注明原因');
  ok(/## 五、未填写与未判定项/.test(r.md), '6.7 md 含未填写与未判定章节');
  ok(r.json.counts.pending > 0, '6.8 未填写项计入 pending');
});

const recConf = mk('rec-conf.xlsx', {
  '验收记录': [
    ['序号', '验收项', '验收结果', '备注'],
    [1, '泵与电机对中（找正）', '合格', ''],
  ],
});
// 序号与名称冲突 → 以名称为准并 warning
section('B', () => {
  r = run([...BASE, '--records', recConf], 'conf');
  ok(r.summary.warnings.some((w) => w.includes('不一致')), '6.9 序号与名称冲突时 warning');
  ok(r.json.items.find((x) => x.item === '泵与电机对中（找正）').result === '合格', '6.10 冲突时按名称匹配');
});

const recNoSheet = mk('rec-nosheet.xlsx', { '别的表': [['a'], [1]] });
// 缺「验收记录」工作表 → warning 且不中断
section('B', () => {
  r = run([...BASE, '--records', recNoSheet], 'nosheet');
  eq(r.summary.ok, true, '6.11 记录缺表时不中断');
  ok(r.summary.warnings.some((w) => w.includes('未找到「验收记录」工作表')), '6.12 记录缺表有 warning');
  ok(r.json.items.every((x) => x.result === null), '6.13 记录缺表时不回填任何结果');
});

const recLims = mk('rec-lims.xlsx', {
  '验收记录': [
    ['某某炼化厂 完工验收记录导出'], [],
    ['编号', '验收内容', '结论', '说明'],
    ['', '设备及周边现场清洁、工完料尽场地清', '合格', ''],
    ['合计', '', '', ''],
  ],
});
// 合计行跳过 + 别名列头 + 标题行表头识别
section('B', () => {
  r = run([...BASE, '--records', recLims], 'lims');
  eq(r.summary.ok, true, '6.14 标题行 + 别名列头的记录可读');
  eq(r.json.counts.recorded, 1, '6.15 别名列头正确取值');
  ok(r.summary.warnings.some((w) => w.includes('合计行')), '6.16 合计行跳过并 warning');
});

const recEm = mk('rec-em.xlsx', {
  '检修验收记录': [
    ['EM 设备管理信息系统 检修验收记录导出'], [],
    ['序号', '验收项目', '验收结论', '问题描述', '验收人'],
    [1, '设备及周边现场清洁、工完料尽场地清', '合格', '', '张工'],
    [2, '泵与电机对中（找正）', '不合格', '径向偏差超出方案规定值', '李工'],
  ],
});
// EM 检修验收记录导出列名（验收项目 / 验收结论 / 问题描述，工作表「检修验收记录」）
section('A', () => {
  r = run([...BASE, '--records', recEm], 'em');
  eq(r.summary.ok, true, '6.17 **EM 导出列名（验收项目/验收结论/问题描述）可读**');
  eq(r.json.counts.recorded, 2, '6.18 EM 列名正确取值');
  eq(r.json.counts.unqualified, 1, '6.19 EM「验收结论」列识别不合格');
  eq(r.json.unqualified[0].note, '径向偏差超出方案规定值', '6.20 EM「问题描述」列进备注');
});

// ================================================================ 7. 应附资料清单（硬约束 6）
section('A', () => {
  r = run(['--tag', 'V-01', '--equip-type', '容器', '--scope', '解体清罐、焊接补板、防腐修补、更换人孔垫片', '--contractor', '检修四队', '--pressure-test', '--special-equipment'], 'records');
  const names = r.json.requiredRecords.map((x) => x.name).join('｜');
  ok(/检修记录卡/.test(names), '7.1 资料清单含检修记录卡');
  ok(/质量验收记录（H\/W 点见证）/.test(names), '7.2 **所有检修含质量验收记录（H/W 点见证）**');
  ok(/试压（气密）记录/.test(names), '7.3 **需试压 → 资料清单含试压记录**');
  ok(/无损检测报告/.test(names), '7.4 **有焊接 → 含无损检测报告**');
  ok(/材质证明书/.test(names), '7.5 **有焊接/换件 → 含材质证明**');
  ok(/隐蔽工程记录/.test(names), '7.6 **解体作业 → 含隐蔽工程记录**');
  ok(/防腐\/保温施工记录/.test(names), '7.7 有防腐 → 含防腐施工记录');
  ok(/特种设备检验报告/.test(names), '7.8 特种设备 → 含特种设备检验报告');
  ok(/更换部件质量证明/.test(names) && /备件领用单/.test(names), '7.9 **换件 → 含更换部件质量证明与备件领用单**');
  ok(r.json.requiredRecords.every((x) => x.provided === null), '7.10 **资料「是否提供」不预填，恒为 null**');
  ok(r.json.requiredRecords.every((x) => x.basis), '7.11 每条资料标明要求依据');
  const simple = run(['--tag', 'V-02', '--equip-type', '容器', '--scope', '外观检查、紧固螺栓', '--contractor', '检修四队'], 'records-simple');
  const simpleNames = simple.json.requiredRecords.map((x) => x.name).join('｜');
  ok(!/无损检测报告/.test(simpleNames), '7.12 无焊接时不要求无损检测报告');
  ok(!/备件领用单/.test(simpleNames), '7.13 无换件时不要求备件领用单');
  ok(simple.json.counts.requiredRecords < r.json.counts.requiredRecords, '7.14 资料清单随检修内容增减');
  ok(/试运（试车）记录/.test(run([...BASE, '--trial-run'], 'trialrec').json.requiredRecords.map((x) => x.name).join('｜')), '7.15 需试运 → 含试运（试车）记录');
});

// ================================================================ 8. 试压/试运开关控制条件项
section('B', () => {
  r = run(BASE, 'noflags');
  ok(!r.json.items.some((x) => x.category === 'trial'), '8.1 未指定 --trial-run 时不生成试运项');
  ok(r.summary.warnings.some((w) => w.includes('--trial-run')), '8.2 未指定试运有 warning 提示');
  ok(r.summary.warnings.some((w) => w.includes('--pressure-test')), '8.3 未指定试压有 warning 提示');
  r = run([...BASE, '--trial-run', '--pressure-test'], 'flags');
  ok(r.json.items.some((x) => x.category === 'trial'), '8.4 指定 --trial-run 后生成试运项');
  ok(r.json.items.some((x) => x.ruleId === 'GEN-SE-01'), '8.5 指定 --pressure-test 后生成严密性/试压验收项');
  ok(!run(BASE, 'nopt').json.items.some((x) => x.ruleId === 'GEN-SE-01'), '8.5b 未指定 --pressure-test 时不生成试压项');
  ok(r.json.items.some((x) => /振动/.test(x.item)) && r.json.items.some((x) => /温度/.test(x.item)), '8.6 离心泵试运含振动与轴承温度项');
});

// 五类原有设备的验收要点抽查
section('A', () => {
  const pump = run([...BASE, '--trial-run', '--pressure-test'], 'pump').json;
  ok(['对中', '机械密封', '振动', '轴承温度', '盘车'].every((k) => pump.items.some((x) => x.item.includes(k))), '8.7 离心泵覆盖对中/机封/振动/轴承温度/盘车');
});
section('B', () => {
  const hex = run(['--tag', 'E-9', '--equip-type', '换热器', '--scope', '抽管束清洗、更换垫片、保温恢复', '--contractor', 'X', '--pressure-test'], 'hex').json;
  ok(['管束清洗', '水压试验', '保温'].every((k) => hex.items.some((x) => x.item.includes(k))), '8.8 换热器覆盖管束清洗/水压试验/保温恢复');
});
// 通用规则已有「保温、防腐层恢复」，类型规则不得再出一条同义项（重复计数、回填时两项抢同一条记录）
section('C', () => {
  for (const t of ['离心泵', '换热器', '塔器', '阀门', '电机', '压缩机', '加热炉', '空冷器']) {
    const it = run(['--tag', 'D-9', '--equip-type', t, '--scope', '解体检修、更换部件、防腐保温恢复', '--contractor', 'X', '--pressure-test', '--trial-run'], 'dup-' + t).json.items;
    eq(it.filter((x) => /保温|防腐/.test(x.item) && /恢复/.test(x.item)).length, 1, `8.8b ${t}：保温/防腐恢复类验收项只出一条`);
  }
});
section('B', () => {
  const ves = run(['--tag', 'C-9', '--equip-type', '塔器', '--scope', '解体检修、更换塔盘、防腐', '--contractor', 'X', '--pressure-test'], 'ves').json;
  ok(['内件', '人孔', '气密', '防腐'].every((k) => ves.items.some((x) => x.item.includes(k))), '8.9 塔器覆盖内件/人孔封闭/气密试验/防腐层');
  ok(/工艺（操作）/.test(ves.items.find((x) => x.ruleId === 'VES-AS-02').owner), '8.9b 人孔封闭确认含工艺（操作）方');
  const vlv = run(['--tag', 'XV-9', '--equip-type', '阀门', '--scope', '解体检修、更换填料', '--contractor', 'X', '--pressure-test'], 'vlv').json;
  ok(['启闭', '密封', '填料', '限位'].every((k) => vlv.items.some((x) => x.item.includes(k))), '8.10 阀门覆盖启闭/密封试验/填料/限位');
  const mot = run(['--tag', 'M-9', '--equip-type', '电机', '--scope', '解体检修、更换轴承、对中', '--contractor', 'X', '--trial-run'], 'mot').json;
  ok(['绝缘', '接地', '转向', '空载电流', '温升'].every((k) => mot.items.some((x) => x.item.includes(k))), '8.11 电机覆盖绝缘/接地/转向/空载电流/温升');
});

// ================================================================ 9. 检修分级（中石化口径）
section('B', () => {
  r = run([...BASE, '--repair-type', '大检修'], 'rt-major');
  eq(r.json.meta.repairType, '大检修', '9.1 --repair-type 大检修写入 meta');
  ok(/检修分级 \| 大检修/.test(r.md), '9.2 概况表显示检修分级');
  ok(r.json.signatures.find((s) => /公司设备管理部门/.test(s.role)).note === '大检修必签', '9.3 大检修时公司设备部门签字栏标「必签」');
  r = run([...BASE, '--repair-type', '大修'], 'rt-old');
  eq(r.json.meta.repairType, '大检修', '9.4 旧值「大修」映射为「大检修」');
  eq(r.json.meta.repairTypeRaw, '大修', '9.5 旧值原文保留');
  ok(r.summary.warnings.some((w) => w.includes('旧口径') && w.includes('大检修')), '9.6 旧值映射 warning');
  ok(/大检修（原填「大修」）/.test(r.md), '9.7 概况表同时显示原填值');
  eq(run([...BASE, '--repair-type', '小修'], 'rt-minor').json.meta.repairType, '日常维修', '9.8 旧值「小修」映射为「日常维修」');
  eq(run([...BASE, '--repair-type', '中修'], 'rt-mid').json.meta.repairType, '日常维修', '9.9 旧值「中修」映射为「日常维修」');
  r = run([...BASE, '--repair-type', '随便'], 'rt-bad');
  eq(r.summary.ok, false, '9.10 非法检修分级报错');
  ok(/大检修 \/ 日常维修 \/ 抢修 \/ 专项/.test(r.summary.error), '9.11 错误信息列出四个分级');
});
section('A', () => {
  r = run(BASE, 'rt-none');
  eq(r.json.meta.repairType, null, '9.12 **不传分级时为 null，不默认**');
  ok(r.summary.warnings.some((w) => w.includes('未指定 --repair-type')), '9.13 不传分级有 warning');
  ok(/检修分级 \| —（未指定）/.test(r.md), '9.14 概况表显示「—（未指定）」');
  ok(/按厂内规定/.test(r.json.signatures.find((s) => /公司设备管理部门/.test(s.role)).note), '9.15 未指定分级时公司设备部门是否参加写「按厂内规定」');
});
section('B', () => {
  ok(r.json.items.length === run([...BASE, '--repair-type', '大检修'], 'rt-cmp').json.items.length, '9.16 检修分级不改变验收项数量');
});

function runRaw(args) {
  const rr = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  const lines = rr.stdout.trim().split('\n');
  try { return { code: rr.status, s: JSON.parse(lines[lines.length - 1]) }; } catch (e) { return { code: rr.status, s: { ok: false, error: 'no-json' } }; }
}
// ================================================================ 10. 参数校验
section('B', () => {
  let x = runRaw(['--tag']);
  eq(x.s.ok, false, '10.1 --tag 缺值报错');
  ok(/缺少取值/.test(x.s.error), '10.2 缺值错误信息正确');
  eq(x.code, 1, '10.3 退出码为 1');
  x = runRaw(['--tag', 'P-01']);
  eq(x.s.ok, false, '10.4 缺 --equip-type 报错');
  x = runRaw(['--tag', 'P-01', '--equip-type', '离心泵']);
  eq(x.s.ok, false, '10.5 缺 --scope 报错');
  x = runRaw(['--tag', 'P-01', '--equip-type', '离心泵', '--scope', '检修']);
  eq(x.s.ok, false, '10.6 缺 --contractor 报错');
  x = runRaw([...BASE, '--未知参数', 'x']);
  eq(x.s.ok, false, '10.7 未知参数报错');
  x = runRaw([...BASE, '--finished-at', '2026-13-45']);
  eq(x.s.ok, false, '10.8 非法完工时间报错');
  ok(/不是有效时间/.test(x.s.error), '10.9 非法时间错误信息明确');
  x = runRaw([...BASE, '--plan', '/不存在的方案.txt']);
  eq(x.s.ok, false, '10.10 方案不存在报错');
  x = runRaw([...BASE, '--records', '/不存在的记录.xlsx']);
  eq(x.s.ok, false, '10.11 记录不存在报错');
  x = runRaw([...BASE, '--repair-type']);
  eq(x.s.ok, false, '10.12 --repair-type 缺值报错');
});

// ================================================================ 11. 产出结构与落盘
section('BVT', () => {
  r = run([...BASE, '--plan', planTxt, '--records', recBad, '--trial-run', '--pressure-test', '--workshop', '常减压车间', '--name', '回流泵B', '--finished-at', '2026-09-20', '--repair-type', '日常维修'], 'full');
  ok(fs.existsSync(path.join(r.out, 'summary.json')), '11.1 summary.json 已落盘');
  eq(JSON.parse(fs.readFileSync(path.join(r.out, 'summary.json'), 'utf8')).ok, true, '11.2 summary.json 内容正确');
  ok(fs.existsSync(path.join(r.out, 'acceptance.json')) && fs.existsSync(path.join(r.out, 'acceptance.md')), '11.3 acceptance.json 与 acceptance.md 均生成');
  ok(['## 一、设备与检修概况', '## 二、验收项逐项结果', '## 三、应附资料核对', '## 四、不合格项与整改要求',
    '## 五、未填写与未判定项', '## 六、与检修方案质量控制点对应情况', '## 七、遗留问题', '## 八、验收结论', '## 九、三级验收签字']
    .every((h) => r.md.includes(h)), '11.4 md 九节结构齐全');
  ok(/<!-- ANALYSIS_START -->/.test(r.md) && /<!-- ANALYSIS_END -->/.test(r.md), '11.5 遗留问题段含分析占位符');
});
section('A', () => {
  ok(/验收结论（合格／不合格／限期整改后复验）/.test(r.md), '11.6 md 含验收结论栏');
  ok(/\| 班组（一级验收） \| 　 \| 　 \|/.test(r.md), '11.7 签字栏留空');
  ok(!/验收结论.*合格 \|$/m.test(r.md.split('## 八、验收结论')[1].split('## 九、')[0].replace(/合格／不合格／限期整改后复验/g, '')), '11.8 **验收结论栏未被预填**');
});
section('B', () => {
  eq(r.json.meta.workshop, '常减压车间', '11.9 车间写入 meta');
  eq(r.json.meta.finishedAt, '2026-09-20 00:00', '11.10 完工时间归一化');
  ok(/YS-\d{8}-/.test(r.json.meta.no), '11.11 验收单临时编号格式正确');
  ok(r.json.meta.scopeFlagsCn.includes('解体检修'), '11.12 检修内容特征识别写入 meta');
  ok(r.md.includes(DECL), '11.13 完整场景下声明行仍在');
});
section('C', () => {
  ok(/承修单位 \| 检修一队/.test(r.md), '11.14 概况表用「承修单位」');
  ok(!EMOJI.test(r.md), '11.15 完整场景 md 不含 emoji');
});

// 检修内容无可识别特征 → warning，但不减项
section('B', () => {
  r = run(['--tag', 'P-77', '--equip-type', '离心泵', '--scope', '按方案处理', '--contractor', 'X'], 'noflag');
  ok(r.summary.warnings.some((w) => w.includes('未识别出解体')), '11.16 检修内容无特征时 warning');
  ok(r.json.counts.items > 0, '11.17 无特征时仍输出通用与类型必验项');
});

// ================================================================ 12. 文档口径（出现与不出现两个方向）
section('C', () => {
  const skill = fs.readFileSync(path.join(ROOT, 'SKILL.md'), 'utf8');
  ok(/检修验收/.test(skill) && /完工验收/.test(skill), '12.1 SKILL.md 触发词含「检修验收」「完工验收」');
  ok(!/"验收"/.test(skill), '12.2 SKILL.md 不再用裸「验收」抢触发');
  ok(/contractor-performance-log/.test(skill) && /hazard-closure-tracker/.test(skill), '12.3 description 互指承包商表现与隐患整改验收');
  ok(/三级验收/.test(skill) && /工艺（操作）/.test(skill), '12.4 SKILL.md 写明三级验收 + 工艺');
  ok(!/监理/.test(skill.replace(/无监理/g, '')), '12.5 SKILL.md 除「无监理」说明外不出现监理');
  ok(/PDF 先用平台 pdf 技能转为 txt\/docx 再传入，脚本不读 PDF；扫描件需 OCR/.test(skill), '12.6 SKILL.md 含 PDF 前置步骤');
  ok(/docx/.test(skill) && /--repair-type/.test(skill), '12.7 SKILL.md 说明 docx 方案可读与检修分级参数');
  ok(/压缩机/.test(skill) && /加热炉/.test(skill) && /空冷器/.test(skill), '12.8 SKILL.md 覆盖范围含压缩机/加热炉/空冷器');
  ok(/九节/.test(skill) || /九个部分/.test(skill), '12.9 SKILL.md 预期结果章节数与脚本一致（九节）');
  ok(/由其他岗位归口|归口/.test(skill), '12.10 SKILL.md 写明归口');
  ok(/agent_created: true/.test(skill) && /allowed-tools:/.test(skill), '12.11 frontmatter 保留 agent_created 与 allowed-tools');
  const rules = fs.readFileSync(path.join(ROOT, 'references', 'acceptance-rules.md'), 'utf8');
  ok(/三级验收/.test(rules) && /CMP-/.test(rules) && /FUR-/.test(rules) && /ACC-/.test(rules), '12.12 acceptance-rules.md 写三级验收与新增三类规则前缀');
  ok(/炼化企业设备管理技术规定|中国石化设备管理规定/.test(rules), '12.13 acceptance-rules.md 写制度引用');
  const spec = fs.readFileSync(path.join(ROOT, 'references', 'input-spec.md'), 'utf8');
  ok(/验收项目/.test(spec) && /验收结论/.test(spec) && /docx/.test(spec), '12.14 input-spec 含 EM 列名与 docx 支持');
  const readme = fs.readFileSync(path.join(ROOT, 'scripts', 'README.md'), 'utf8');
  ok(/tmpdir/.test(readme) && /--repair-type/.test(readme) && /docx/.test(readme), '12.15 scripts/README 记录默认输出目录、检修分级与 docx');
  ok(fs.existsSync(path.join(ROOT, 'scripts', 'lib', 'docx-lite.js')) && fs.existsSync(path.join(ROOT, 'scripts', 'docx2text.js')), '12.16 docx-lite 与 docx2text 已随技能携带');
});

// ================================================================ 输出
console.log(`\n${'='.repeat(56)}`);
console.log(`completion-acceptance 自测：${pass} 通过，${fail} 失败`);
console.log(`用例级别 ${LEVELS[RUN_LEVEL]}：BVT ${byLevel.BVT}，A ${byLevel.A}，B ${byLevel.B}，C ${byLevel.C}`);
if (failures.length) { console.log('\n失败项：'); failures.forEach((f) => console.log('  ✗ ' + f)); }
console.log('='.repeat(56));
try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
