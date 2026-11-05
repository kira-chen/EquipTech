#!/usr/bin/env node
'use strict';
/**
 * 自测：merge-report.js（规则引擎 result.json → 合并报告，只转达不改写判定）、precheck.js（规则引擎）、
 * docx2text.js（Word 作业票读取）、make-sample.js（样例与演示变体再生），以及 docx → 文本 → 判定 → 合并报告的端到端回归。
 * 用法：node scripts/selftest.js（全绿退出 0）；SELFTEST_LEVEL=BVT|A|B|C 只跑该级及更高优先级的节
 * 回归数据从演示样例目录读：仓库内在 炼厂车间设备员/演示case/<分类>/<技能>/，开发包内在技能目录 examples/
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const MRG = path.join(__dirname, 'merge-report.js');
const MKS = path.join(__dirname, 'make-sample.js');
const PRE = path.join(__dirname, 'precheck.js');
const D2T = path.join(__dirname, 'docx2text.js');
const ROOT = path.join(__dirname, '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ppb-selftest-'));
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
const eq = (a, e, n) => ok(a === e, n + '（期望 ' + JSON.stringify(e) + '，实际 ' + JSON.stringify(a) + '）');
const DECL = '预检为辅助自查，不替代安全部门审批；票据是否签发以审批人意见为准。';
const EMOJI = /[⚠✅❌✔✖\u{1F300}-\u{1FAFF}]/u;

const lastJson = (stdout) => { try { return JSON.parse(String(stdout).trim().split('\n').pop()); } catch (e) { return { ok: false, error: 'no-json:' + stdout }; } };
const node = (args) => spawnSync(process.execPath, args, { encoding: 'utf8' });
let n = 0;
function runMrg(args = [], tag) {
  const out = path.join(work, (tag || 'm' + (++n)) + '-out');
  const r = spawnSync(process.execPath, [MRG, ...args, '--out', out], { encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  let s; try { s = JSON.parse(lines[lines.length - 1]); } catch (e) { s = { ok: false, error: 'no-json:' + r.stdout + r.stderr }; }
  let j = null, md = null;
  if (fs.existsSync(path.join(out, 'bridge.json'))) j = JSON.parse(fs.readFileSync(path.join(out, 'bridge.json'), 'utf8'));
  if (fs.existsSync(path.join(out, 'permit-precheck-bridge.md'))) md = fs.readFileSync(path.join(out, 'permit-precheck-bridge.md'), 'utf8');
  return { code: r.status, s, j, md, out };
}
const wj = (name, obj) => { const p = path.join(work, name); fs.writeFileSync(p, typeof obj === 'string' ? obj : JSON.stringify(obj), 'utf8'); return p; };
let r;

// 演示样例：仓库内在 炼厂车间设备员/演示case/<分类>/<技能>/，开发包内在技能目录 examples/
const skillsRoot = path.resolve(__dirname, '../../..');
const EX = path.basename(skillsRoot) === '设备员skill' ? path.join(skillsRoot, '..', '演示case', path.relative(skillsRoot, path.resolve(__dirname, '..'))) : path.join(__dirname, '..', 'examples');
const pc = require('./precheck');
const L = require('./lib/docx-lite');
const MS = require('./make-sample');
const NOW_ISO = MS.REGRESS_NOW;

// ============ 6. make-sample 可再生 ============
const ex1 = path.join(work, 'ex1');
let m = spawnSync(process.execPath, [MKS, '--out', ex1], { encoding: 'utf8' });
let ms = lastJson(m.stdout);
const src1 = fs.existsSync(path.join(ex1, 'sample-permit-result.json')) ? JSON.parse(fs.readFileSync(path.join(ex1, 'sample-permit-result.json'), 'utf8')) : { findings: [] };
section('B', () => {
  eq(ms.ok, true, '6.1 make-sample 运行成功');
  ok(['sample-permit-result.json', 'sample-permit-result-summary-mismatch.json', 'sample-permit-result-unknown-type.json', 'sample-workshop-notes.json', 'sample-workshop-notes-bad.json'].every((f) => (ms.files || []).includes(f)), '6.2 五份 JSON 样例齐全');
});
section('C', () => {
  const ex7 = path.join(work, 'ex7');
  m = spawnSync(process.execPath, [MKS, '--out', ex7, '--seed', '7'], { encoding: 'utf8' });
  const ms7 = lastJson(m.stdout);
  ok(ms7.permitNo !== ms.permitNo, '6.3 seed 改变票号');
  const src7 = JSON.parse(fs.readFileSync(path.join(ex7, 'sample-permit-result.json'), 'utf8'));
  eq(JSON.stringify(src7.summary), JSON.stringify(src1.summary), '6.4 seed 改变数值但四项计数不变');
  ok(Array.isArray(src1.findings) && src1.disclaimer, '6.5 样例结构与规则引擎 result.json 一致（findings + disclaimer）');
});
section('B', () => {
  ok(MS.CASE_ORDER.every((c) => ['.json', '.docx', '.docx2text.txt', '.expected-report.md'].every((x) => (ms.files || []).includes(c + x))), '6.6 规则引擎回归样例 9 个案例 × 4 个文件齐全');
  ok(MS.CASE_ORDER.every((c) => ms.counts && ms.counts[c] === MS.EXPECTED[c].join('/')), '6.7 make-sample 再生时 9 个案例计数与基线一致');
  ok((ms.files || []).includes('sample-hotwork-permit.docx') && (ms.warnings || []).length === 0, '6.8 用火票 Word 样例生成且无 warning');
  let b = node([MKS, '--out', path.join(work, 'ex-bad'), '--seed', '-3']);
  ok(b.status === 1 && lastJson(b.stdout).ok === false && /非负整数/.test(lastJson(b.stdout).error), '6.9 --seed 非法时 ok:false 且退出码 1');
  b = node([MKS, '--out', path.join(work, 'ex-same'), '--demo', path.join(work, 'ex-same')]);
  ok(b.status === 1 && /不能写到回归样例目录/.test(lastJson(b.stdout).error), '6.10 --demo 指向回归样例目录时拒绝写入');
});

// ============ 7. 【核心】规则引擎 result.json → 合并报告不改写判定 ============
const RES = path.join(ex1, 'sample-permit-result.json');
const NOTES = path.join(ex1, 'sample-workshop-notes.json');
section('BVT', () => {
  r = runMrg(['--result', RES, '--notes', NOTES, '--object', '一级用火票'], 'main');
  eq(r.s.ok, true, '7.1 合并转达成功');
  eq(r.s.counts.must_fix, 3, '7.2 必须整改计数按 findings 重算');
  eq(r.s.counts.should_improve, 2, '7.3 建议完善计数');
  eq(r.s.counts.undetermined, 1, '7.4 未判定计数');
  eq(r.s.counts.pass, 4, '7.5 通过计数');
});
section('A', () => {
  eq(JSON.stringify(r.j.findings), JSON.stringify(src1.findings), '7.6 **findings 逐条深拷贝，与规则引擎结果一字不差**');
  ok(r.j.findings !== src1.findings && r.j.findings.every((f, i) => f.rule_id === src1.findings[i].rule_id && f.severity === src1.findings[i].severity), '7.7 顺序与级别均未重排');
  eq(r.j.meta.sourceDisclaimer, src1.disclaimer, '7.8 规则引擎声明行原文保留在 bridge.json');
  eq(r.j.meta.declaration, DECL, '7.9 本技能声明行固化在 bridge.json');
  ok(r.md.includes(src1.disclaimer), '7.10 **md 含规则引擎声明行原文**');
  ok(r.md.includes(DECL), '7.11 **md 含本技能声明行原文**');
  ok(r.md.indexOf(src1.disclaimer) < r.md.indexOf(DECL), '7.12 规则引擎声明行在前，本技能声明行追加在后');
  for (const f of src1.findings.filter((x) => x.severity !== 'pass')) ok(r.md.includes(f.message) && r.md.includes(f.detail), `7.13 ${f.rule_id} 的 message 与 detail 原文出现在 md`);
  ok(/受限空间内动火，未关联受限空间作业票/.test(r.md), '7.14 规则原文「动火」照搬，未被改写为「用火」');
  ok(/## 三、未判定项/.test(r.md) && /HW-003/.test(r.md.split('## 三、未判定项')[1].split('## 四、')[0]), '7.15 未判定项单列一节且含规则号');
  ok(/【未判定】/.test(r.md) && /不改写为符合或不符合/.test(r.md), '7.16 未判定项说明保持未判定、不改写');
  ok(/【注意】未判定项既不代表符合，也不代表不符合/.test(r.md), '7.17 有未判定项时结论段出现【注意】提示');
  ok(/## 二、不符合项/.test(r.md) && /逐条照搬规则引擎结果，未合并、未归类、未调整级别/.test(r.md), '7.18 不符合项节声明逐条照搬');
  ok(/以下内容原文引自规则引擎判定结果，本报告未做任何改写/.test(r.md), '7.19 结论段声明未改写');
  eq(r.j.sourceMeta.type, '动火', '7.20 规则引擎 type 原值保留');
  eq(r.j.sourceMeta.permitCategory, '用火作业', '7.21 **加注作业许可八大类「用火作业」（不改原值）**');
});
section('B', () => {
  ok(/作业许可八大类（本技能加注） \| 用火作业/.test(r.md), '7.22 md 规则引擎字段表显示八大类名称');
  ok(/作业类型（type，规则引擎取值） \| 动火/.test(r.md), '7.23 md 同时保留 type 原值');
  ok(/## 四、通过项/.test(r.md) && /\| G-001 \| 票号已填写 \| 通过：作业票编号已填写 \|/.test(r.md), '7.24 通过项也逐条列出（检查项名称与原文并列）');
  ok(/## 附：抽取备注（原文，需人工确认）/.test(r.md) && /in_confined_space/.test(r.md), '7.25 抽取备注原文附在报告');
  eq(r.j.extractionNotes.length, 2, '7.26 extraction_notes 转入 bridge.json');
  eq(r.j.sourceSummary.must_fix, 3, '7.27 result.json 的 summary 原值保留');
});
section('C', () => {
  ok(!EMOJI.test(r.md), '7.28 md 不含 emoji');
});
section('A', () => {
  ok(/<!-- ANALYSIS_START -->/.test(r.md) && /<!-- ANALYSIS_END -->/.test(r.md), '7.29 分析段占位符存在');
  ok(/不得复述或改写判定结论/.test(r.md.split('<!-- ANALYSIS_START -->')[1]), '7.30 分析段占位提示不得改写结论');
  ok(fs.existsSync(path.join(r.out, 'summary.json')) && JSON.parse(fs.readFileSync(path.join(r.out, 'summary.json'), 'utf8')).ok === true, '7.31 summary.json 落盘');
  ok(['## 一、预检结论（引自规则引擎 precheck.js）', '## 二、不符合项', '## 三、未判定项', '## 四、通过项', '## 五、车间侧补充提示（非规则判定）', '## 六、整改建议'].every((h) => r.md.includes(h)), '7.32 六节结构齐全');
});
section('B', () => {
  eq(r.j.meta.objectName, '一级用火票', '7.33 --object 写入对象名');
});
section('A', () => {
  ok(/## 六、整改建议/.test(r.md) && /【必须整改】G-011/.test(r.md) && /【未判定】HW-003/.test(r.md), '7.34 整改建议按原级别逐条列出');
});
section('B', () => {
  eq(r.j.meta.source, 'precheck.js', '7.35 bridge.json 的 meta.source 为规则引擎脚本名');
  ok(/即《中国石化作业许可管理规定》的「用火作业」/.test(r.md) && /规则原文照搬不替换/.test(r.md), '7.36 type=动火 时报告注明「动火」即中石化「用火作业」、原文照搬');
});
section('C', () => {
  ok(!/源技能|依赖技能|外部技能|work-permit-precheck/.test(r.md + JSON.stringify(r.s)), '7.37 报告与末行摘要不出现旧技能名和「源技能/依赖技能/外部技能」说法');
});

// ============ 8. 车间侧补充提示（非规则判定） ============
{
  let notesSec;
  section('A', () => {
    notesSec = r.md.split('## 五、车间侧补充提示（非规则判定）')[1].split('## 六、')[0];
    ok(/不参与上述合规判定，不影响规则引擎结论/.test(notesSec), '8.1 车间侧节声明不参与合规判定');
    eq(r.j.workshopNotes.length, 3, '8.2 三个固定车间侧项');
    eq(r.j.workshopNotes.find((x) => x.item === '设备交出条件').status, '已核实', '8.3 已核实状态原样');
    eq(r.j.workshopNotes.find((x) => x.item === '同区域交叉作业').status, '未核实', '8.4 未核实状态原样');
    eq(r.j.workshopNotes.find((x) => x.item === '承包商资质').status, '不适用', '8.5 不适用状态原样');
  });
  section('B', () => {
    ok(/\*\*未核实\*\*/.test(notesSec) && /建议用 cross-operation-conflict 核对/.test(notesSec), '8.6 未核实项加粗并提示可接技能');
    ok(r.j.workshopNotes.every((x) => ['equipment-handover-check', 'cross-operation-conflict', 'contractor-qualification-check'].includes(x.skill)), '8.7 固定项标明可接技能');
  });
  section('A', () => {
    // 不传 notes → 全部未核实，不替用户推测
    r = runMrg(['--result', RES], 'nonotes');
    ok(r.j.workshopNotes.every((x) => x.status === '未核实'), '8.8 **不传 notes 时全部「未核实」，不替用户推测为已核实**');
    eq(r.s.counts.must_fix, 3, '8.9 不传 notes 不影响规则判定计数');
    // 非法状态与自定义项
    r = runMrg(['--result', RES, '--notes', path.join(ex1, 'sample-workshop-notes-bad.json')], 'badnotes');
    eq(r.s.ok, true, '8.10 状态不合法不中断');
    eq(r.j.workshopNotes.find((x) => x.item === '设备交出条件').status, '未核实', '8.11 「大概没问题」按未核实处理');
    ok(r.s.warnings.some((w) => w.includes('大概没问题') && w.includes('按「未核实」处理')), '8.12 状态不合法 warning');
  });
  section('B', () => {
    const custom = r.j.workshopNotes.find((x) => x.item === '脚手架验收牌');
    ok(custom && custom.status === '已核实' && custom.skill === '车间自查', '8.13 自定义车间项追加并标「车间自查」');
    eq(r.j.workshopNotes.length, 4, '8.14 自定义项不覆盖固定三项');
    // notes 不是数组
    r = runMrg(['--result', RES, '--notes', wj('notes-obj.json', { item: 'x' })], 'notesobj');
    eq(r.s.ok, false, '8.15 notes 非数组报错');
    ok(/应为数组/.test(r.s.error), '8.16 notes 非数组错误信息明确');
  });
}

// ============ 9. result.json 的 summary 与 findings 不一致 → 只 warning 不改原数据 ============
section('A', () => {
  r = runMrg(['--result', path.join(ex1, 'sample-permit-result-summary-mismatch.json')], 'mismatch');
  eq(r.s.ok, true, '9.1 summary 不一致不中断');
  ok(r.s.warnings.some((w) => w.includes('summary.should_improve=5') && w.includes('重新计数 2')), '9.2 **计数不一致 warning 指明两边数字**');
  eq(r.s.counts.should_improve, 2, '9.3 报告按 findings 重算（2）');
  eq(r.j.sourceSummary.should_improve, 5, '9.4 summary 原值 5 保留在 bridge.json，未被改写');
});

// ============ 10. type 不在八大类 → warning，原值照搬 ============
section('B', () => {
  r = runMrg(['--result', path.join(ex1, 'sample-permit-result-unknown-type.json')], 'unknowntype');
  eq(r.j.sourceMeta.type, '射线探伤', '10.1 type 原值照搬');
  eq(r.j.sourceMeta.permitCategory, null, '10.2 不在八大类时 permitCategory 为 null，不强行归类');
  ok(r.s.warnings.some((w) => w.includes('射线探伤') && w.includes('不在作业许可八大类')), '10.3 不在八大类 warning');
  ok(!/作业许可八大类（本技能加注）/.test(r.md), '10.4 md 不出现加注行');
});

// ============ 11. 未知级别与缺声明行 ============
section('A', () => {
  const odd = JSON.parse(JSON.stringify(src1));
  odd.findings.push({ rule_id: 'X-999', severity: 'critical', message: '规则库新增级别', detail: 'd', basis: 'b' });
  delete odd.disclaimer;
  r = runMrg(['--result', wj('odd.json', odd)], 'odd');
  eq(r.s.ok, true, '11.1 未知级别不中断');
  eq(r.s.counts.other, 1, '11.2 未知级别单独计数');
  ok(r.j.findings.some((f) => f.rule_id === 'X-999' && f.severity === 'critical'), '11.3 **未知级别原样保留，未被归到四级之一**');
  ok(r.s.warnings.some((w) => w.includes('X-999') && w.includes('不在已知四级')), '11.4 未知级别 warning');
  ok(/其它级别 1 项/.test(r.md) && /critical/.test(r.md), '11.5 md 单列其它级别');
  ok(r.s.warnings.some((w) => w.includes('无 disclaimer')), '11.6 规则引擎结果无声明行 warning');
  eq(r.j.meta.sourceDisclaimer, null, '11.7 无声明行时不伪造规则引擎声明');
  ok(r.md.includes(DECL), '11.8 本技能声明行仍在');
});

// ============ 12. 无未判定项时不出现【注意】；无不符合项时整改建议写无 ============
section('B', () => {
  const clean = JSON.parse(JSON.stringify(src1));
  clean.findings = clean.findings.filter((f) => f.severity === 'pass');
  clean.summary = { must_fix: 0, should_improve: 0, undetermined: 0, pass: 4 };
  r = runMrg(['--result', wj('clean.json', clean)], 'clean');
  ok(!/【注意】未判定项/.test(r.md), '12.1 无未判定项时不出现【注意】提示');
  ok(/无需整改项；仍须由审批人按程序审批/.test(r.md), '12.2 无不符合项时整改建议仍提示须审批');
  ok(/规则引擎结果中无必须整改与建议完善项/.test(r.md), '12.3 不符合项节写明为空');
});

// ============ 13. 参数与输入校验 ============
section('B', () => {
  r = runMrg([], 'noargs');
  eq(r.s.ok, false, '13.1 缺 --result 报错');
  eq(r.code, 1, '13.2 退出码 1');
  r = runMrg(['--result', '/不存在/result.json'], 'nofile');
  eq(r.s.ok, false, '13.3 结果文件不存在报错');
  r = runMrg(['--result', wj('bad.json', '{不是json')], 'badjson');
  eq(r.s.ok, false, '13.4 JSON 非法报错');
  ok(/解析失败/.test(r.s.error), '13.5 解析失败信息明确');
  r = runMrg(['--result', wj('summary-only.json', { must_fix: 1, should_improve: 0, undetermined: 0, pass: 3 })], 'summaryonly');
  eq(r.s.ok, false, '13.6 传入 summary.json（无 findings）报错');
  ok(/summary\.json/.test(r.s.error), '13.7 错误信息提示应传 result.json 而不是 summary.json');
  r = runMrg(['--result', RES, '--notes', '/不存在/notes.json'], 'nonotesfile');
  eq(r.s.ok, false, '13.8 notes 文件不存在报错');
  r = runMrg(['--result', RES, '--未知', 'x'], 'unknownarg');
  eq(r.s.ok, false, '13.9 未知参数报错');
  r = runMrg(['--result'], 'novalue');
  eq(r.s.ok, false, '13.10 --result 缺值报错');
});

// ============ 14. 文档口径（出现与不出现两个方向） ============
section('C', () => {
  const skill = fs.readFileSync(path.join(ROOT, 'SKILL.md'), 'utf8');
  ok(/用火作业/.test(skill) && /盲板抽堵/.test(skill), '14.1 SKILL.md 用作业许可八大类命名（用火作业、盲板抽堵）');
  ok(!/动火票预检/.test(skill), '14.2 SKILL.md 触发词不再用「动火票预检」');
  ok(/PDF 先用平台 pdf 技能转为 txt\/docx 再传入，脚本不读 PDF；扫描件需 OCR/.test(skill), '14.3 SKILL.md 含 PDF 前置步骤');
  ok(!/check-dependency|SKILL_PACK_ROOT|依赖技能|源技能/.test(skill), '14.4 SKILL.md 不再有依赖检查（无 check-dependency、SKILL_PACK_ROOT、依赖技能/源技能说法）');
  ok(/merge-report\.js/.test(skill), '14.5 SKILL.md 操作步骤含 merge-report.js');
  ok(/overhaul-process-check-bridge/.test(skill) && /equipment-handover-check/.test(skill) && /cross-operation-conflict/.test(skill), '14.6 description 互指排除语齐全');
  ok(/由其他岗位归口/.test(skill) && /审批签发/.test(skill), '14.7 SKILL.md 写明车间设备员可做与归口');
  ok(/agent_created: true/.test(skill) && /allowed-tools:/.test(skill), '14.8 frontmatter 保留 agent_created 与 allowed-tools');
  ok(skill.includes(DECL), '14.9 SKILL.md 声明行与脚本一致');
  const rules = fs.readFileSync(path.join(ROOT, 'references', 'bridge-rules.md'), 'utf8');
  ok(/八大类/.test(rules) && /用火作业/.test(rules) && /作业票/.test(rules), '14.10 bridge-rules.md 写作业票口径与八大类');
  const other = path.join(ROOT, '..', 'overhaul-process-check-bridge', 'references', 'bridge-rules.md');
  ok(!fs.existsSync(other) || fs.readFileSync(other, 'utf8') !== rules, '14.11 references 不再与 overhaul bridge 逐字重复');
  const readme = fs.readFileSync(path.join(ROOT, 'scripts', 'README.md'), 'utf8');
  ok(/merge-report\.js/.test(readme) && /tmpdir/.test(readme), '14.12 scripts/README 记录 merge-report 与默认输出目录');
  ok(fs.existsSync(path.join(ROOT, 'references', 'input-spec.md')), '14.13 references/input-spec.md 存在');
  ok([0, 1].every((i) => { const at = ['/scripts/docx2text.js" --input', '/scripts/precheck.js" --input', '/scripts/merge-report.js" --result'].map((x) => skill.indexOf(x)); return at[i] >= 0 && at[i] < at[i + 1]; }), '14.14 SKILL.md 一条流程：docx2text → precheck → merge-report');
  ok(/本结果为辅助预检，不替代作业票审批/.test(skill), '14.15 SKILL.md 保留规则引擎声明行');
  ok(/一处一票、一次一票/.test(skill) && /保存期限/.test(skill), '14.16 SKILL.md 保留人工提醒清单');
  const guide = fs.readFileSync(path.join(ROOT, 'references', 'extraction-guide.md'), 'utf8');
  ok(/用火作业许可证/.test(guide) && /type 枚举沿用 GB 30871 的「动火」，即中石化的「用火作业」/.test(guide), '14.17 抽取手册含「用火作业许可证」→ type 填「动火」的映射与开头说明');
  ok(!/动火票|动火作业/.test(skill), '14.18 SKILL.md 作业类别写「用火」，不出现「动火票 / 动火作业」');
  const listing = fs.readFileSync(path.join(ROOT, '上架信息.md'), 'utf8');
  ok(/\*\*技能名称\*\*：车间作业票预检\n/.test(listing) && !/入口|依赖技能|需先安装|源技能/.test(listing), '14.19 上架信息技能名去掉「入口」且不提依赖技能');
  ok(!/T\d{18}|\b1[3-9]\d{9}\b/.test(guide), '14.20 抽取手册示例无类身份证号、类手机号');
});

// ============ 15. 完整链路：docx → docx2text → 抽取结果 → 规则引擎 → 合并报告 ============
section('BVT', () => {
  const docx = path.join(EX, 'hotwork-level1-with-issues.docx');
  const permit = JSON.parse(fs.readFileSync(path.join(EX, 'hotwork-level1-with-issues.json'), 'utf8'));
  const txt = path.join(work, 'chain', 'permit.txt');
  const d = node([D2T, '--input', docx, '--out', txt]);
  eq(d.status, 0, '15.1 docx2text 读取用火票 docx 退出码 0');
  ok(fs.existsSync(txt) && fs.readFileSync(txt, 'utf8').includes('编号：' + permit.permit_no), '15.2 读回文本含票号');
  const cout = path.join(work, 'chain', 'precheck');
  const p = node([PRE, '--input', path.join(EX, 'hotwork-level1-with-issues.json'), '--out', cout, '--now', NOW_ISO]);
  eq(p.status, 0, '15.3 precheck.js 退出码 0');
  const res = JSON.parse(fs.readFileSync(path.join(cout, 'result.json'), 'utf8'));
  eq([res.summary.must_fix, res.summary.should_improve, res.summary.undetermined, res.summary.pass].join('/'), '3/2/1/39', '15.4 规则引擎四项计数');
  ok(['result.json', 'report.md', 'summary.json'].every((f) => fs.existsSync(path.join(cout, f))), '15.5 result.json、report.md、summary.json 落盘');
  r = runMrg(['--result', path.join(cout, 'result.json'), '--notes', path.join(EX, 'sample-workshop-notes.json'), '--object', permit.permit_no], 'chain-notes');
  eq(r.s.ok, true, '15.6 带车间侧信息合并成功');
  eq(JSON.stringify(r.j.findings), JSON.stringify(res.findings), '15.7 合并报告 findings 与规则引擎 result.json 全等');
  eq(r.j.workshopNotes.find((x) => x.item === '设备交出条件').status, '已核实', '15.8 车间侧信息进入第五节');
  r = runMrg(['--result', path.join(cout, 'result.json')], 'chain-nonotes');
  eq(r.s.ok, true, '15.9 不带车间侧信息也能出报告');
  ok(r.j.workshopNotes.every((x) => x.status === '未核实') && r.s.counts.must_fix === 3, '15.10 不带车间侧信息时三项未核实、判定计数不变');
});

// ============ E. 规则引擎与 docx 读取的边界用例（E1~E24） ============
const rules = pc.loadRules();
const NOW = pc.toDate(NOW_ISO);
const ctx = (now = NOW) => ({ now, toxicLimits: rules.toxic_limits, rulesTotal: rules.rules.length, rulesVersion: rules.meta.version });
const base = () => JSON.parse(fs.readFileSync(path.join(EX, 'hotwork-level1-with-issues.json'), 'utf8'));
const cs = () => JSON.parse(fs.readFileSync(path.join(EX, 'confined-space-ok.json'), 'utf8'));
const find = (res, id) => res.findings.find((f) => f.rule_id === id);
const sev = (res, id) => (find(res, id) || {}).severity || 'absent';
let e;

// E1. CO 介质（LEL 12.5% ≥4%）：检测仪 9%LEL → 体积分数 1.125% > 0.5% → HW-007 必须整改；HW-006（10%LEL）通过
section('A', () => {
  const p = base(); p.medium = { name: '一氧化碳', lel_pct: 12.5, flammable: true, toxic: true };
  p.gas_tests[0].lel = 9; p.gas_tests[0].combustible_vol = null;
  e = pc.evaluate(p, rules, ctx());
  eq(sev(e, 'HW-007'), 'must_fix', 'E1.1 CO 介质 9%LEL：HW-007 按体积分数判必须整改');
  eq(sev(e, 'HW-006'), 'pass', 'E1.2 同一读数 HW-006（10%LEL）仍通过');
  eq(sev(e, 'HW-008'), 'absent', 'E1.3 介质 LEL ≥4% 时不套 HW-008');
});
// E2. lel_pct 缺失 → HW-007/008 跳过，G-024 建议完善
section('A', () => {
  const p = base(); p.medium.lel_pct = null;
  e = pc.evaluate(p, rules, ctx());
  eq(sev(e, 'G-024'), 'should_improve', 'E2.1 lel_pct 缺失：G-024 建议完善');
  eq(sev(e, 'HW-007'), 'absent', 'E2.2 lel_pct 缺失：HW-007 不判');
  eq(sev(e, 'HW-008'), 'absent', 'E2.3 lel_pct 缺失：HW-008 不判');
});
// E3. in_confined_space=null → HW-009/HW-019 未判定
section('A', () => {
  const p = base(); p.in_confined_space = null;
  e = pc.evaluate(p, rules, ctx());
  eq(sev(e, 'HW-009'), 'undetermined', 'E3.1 **in_confined_space=null：HW-009 未判定，不按默认处理**');
  eq(sev(e, 'HW-019'), 'undetermined', 'E3.2 **in_confined_space=null：HW-019 未判定**');
  ok(find(e, 'HW-019').message.startsWith('无法判定：'), 'E3.3 未判定项 message 以「无法判定：」开头');
  ok(e.summary.undetermined >= 2, 'E3.4 未判定计入摘要');
  eq(JSON.stringify(Object.keys(e.summary)), JSON.stringify(['must_fix', 'should_improve', 'undetermined', 'pass']), 'E3.5 摘要四项键名与顺序');
});
// E4. 无时区时间 → 视为缺失，G-000 建议完善
section('A', () => {
  eq(pc.toDate('2026-08-28T09:00:00'), null, 'E4.1 无时区 ISO 时间视为缺失');
  eq(pc.toDate('2026-08-28 09:00'), null, 'E4.2 空格分隔无时区时间视为缺失');
  ok(pc.toDate('2026-08-28T09:00+08:00') instanceof Date, 'E4.3 带 +08:00 时区可解析');
  ok(pc.toDate('2026-08-28T01:00:00Z') instanceof Date, 'E4.4 带 Z 时区可解析');
  const p = base(); p.start_time = '2026-08-28T09:00:00';
  e = pc.evaluate(p, rules, ctx());
  eq(sev(e, 'G-000'), 'should_improve', 'E4.5 无时区时间：G-000 建议完善');
  ok(find(e, 'G-000').detail.includes('start_time'), 'E4.6 G-000 指明不合规字段 start_time');
});
// E5. --now 不合规 → 退出码 1
section('B', () => {
  const x = node([PRE, '--input', path.join(EX, 'confined-space-ok.json'), '--out', path.join(work, 'e5'), '--now', '2026-08-28T08:50:00']);
  eq(x.status, 1, 'E5.1 --now 无时区：CLI 退出码 1');
  eq(lastJson(x.stdout).ok, false, 'E5.2 --now 无时区：末行 ok:false');
});
// E6. toxic=[] 且 medium.toxic=false → 通过；medium.toxic=null → 建议完善
section('A', () => {
  const p = cs(); p.gas_tests.forEach((g) => { g.toxic = []; }); p.medium.toxic = false;
  eq(sev(pc.evaluate(p, rules, ctx()), 'CS-004'), 'pass', 'E6.1 CS-004：toxic=[] 且介质无毒 → 通过');
  p.medium.toxic = null;
  eq(sev(pc.evaluate(p, rules, ctx()), 'CS-004'), 'should_improve', 'E6.2 CS-004：未检测且毒性未知 → 建议完善');
});
// E7. toxic 超限与未知同时输出；名称大小写归一
section('A', () => {
  const p = cs(); p.gas_tests[1].toxic = [{ name: 'h2s', value: 15, unit: 'mg/m3' }, { name: '甲烷', value: 1, unit: 'mg/m3' }];
  const f = find(pc.evaluate(p, rules, ctx()), 'CS-004');
  eq(f.severity, 'must_fix', 'E7.1 CS-004：h2s 15 mg/m3 超限 → 必须整改');
  ok(f.detail.includes('h2s 15') && f.detail.includes('甲烷'), 'E7.2 CS-004：超限项与无法比对项同时列出，h2s 小写可比对');
});
// E8. gas_tests 乱序 → [last] 取时间最新
section('A', () => {
  const p = cs();
  p.gas_tests = [
    { time: '2026-08-28T08:10:00+08:00', location: 'T-201 塔底人孔', o2: 20.9, lel: 0, toxic: [], analyst: '陈芳', instrument_ok: true },
    { time: '2026-08-28T07:40:00+08:00', location: 'T-201 上人孔', o2: 17, lel: 0, toxic: [], analyst: '陈芳', instrument_ok: true },
  ];
  p.medium.toxic = false;
  e = pc.evaluate(p, rules, ctx());
  eq(e.permit.gas_tests[e.permit.gas_tests.length - 1].o2, 20.9, 'E8.1 gas_tests 乱序：[last] 取时间最新一次');
  eq(sev(e, 'CS-002'), 'pass', 'E8.2 按最新一次判氧含量 → CS-002 通过');
});
// E9. 开工后复检不误报
section('A', () => {
  const p = cs();
  p.gas_tests.push({ time: '2026-08-28T10:40:00+08:00', location: 'T-201 塔底人孔', o2: 20.9, lel: 0, toxic: [{ name: 'H2S', value: 0, unit: 'mg/m3' }], analyst: '陈芳', instrument_ok: true });
  e = pc.evaluate(p, rules, ctx(pc.toDate('2026-08-28T10:50:00+08:00')));
  eq(sev(e, 'CS-005'), 'pass', 'E9.1 开工后复检：复检时间在开工后 → CS-005 通过');
  ok(find(e, 'CS-005').detail.includes('复检'), 'E9.2 CS-005 详情注明按复检计');
});
// E10. HW-005 分档：55 min → 建议完善；70 min → 必须整改
section('A', () => {
  eq(sev(pc.evaluate(base(), rules, ctx()), 'HW-005'), 'should_improve', 'E10.1 HW-005：>30 且 ≤60 分钟 → 建议完善');
  const p = base(); p.gas_tests[0].time = '2026-08-28T07:50:00+08:00';
  eq(sev(pc.evaluate(p, rules, ctx()), 'HW-005'), 'must_fix', 'E10.2 HW-005：>60 分钟 → 必须整改');
});
// E11. 空 gas_tests 不级联
section('A', () => {
  const p = base(); p.gas_tests = [];
  e = pc.evaluate(p, rules, ctx());
  eq(sev(e, 'HW-004'), 'must_fix', 'E11.1 空 gas_tests：HW-004 必须整改');
  const mf = e.findings.filter((f) => f.severity === 'must_fix' && /^HW-00[5-9]|HW-010|HW-023|HW-026/.test(f.rule_id));
  eq(mf.length, 0, 'E11.2 空 gas_tests：其余气体规则不级联报必须整改');
  eq(sev(e, 'HW-006'), 'undetermined', 'E11.3 空 gas_tests：HW-006 未判定');
});
// E12. 焊工 N/A 证书 → HW-024 必须整改
section('A', () => {
  const p = base(); p.workers[0].cert = 'N/A-非特种作业';
  eq(sev(pc.evaluate(p, rules, ctx()), 'HW-024'), 'must_fix', 'E12.1 焊工证书 N/A：HW-024 必须整改');
  eq(sev(pc.evaluate(base(), rules, ctx()), 'HW-024'), 'pass', 'E12.2 焊工有证书号：HW-024 通过');
});
// E13. cross_jobs 为对象 → 包成数组并命中；非法类型 → G-025 建议完善
section('B', () => {
  const p = base(); p.cross_jobs = { type: '盲板抽堵作业', permit_no: 'MB-1' };
  e = pc.evaluate(p, rules, ctx());
  ok(Array.isArray(e.permit.cross_jobs) && e.permit.cross_jobs.length === 1, 'E13.1 cross_jobs 为对象时包成数组');
  eq(sev(e, 'HW-021'), 'pass', 'E13.2 「盲板抽堵作业」按包含匹配命中 HW-021');
  p.cross_jobs = [{ type: '巡检', permit_no: 'X-1' }];
  eq(sev(pc.evaluate(p, rules, ctx()), 'G-025'), 'should_improve', 'E13.3 关联票类型不在八类：G-025 建议完善');
});
// E14. 吊车司机命中 LF-007
section('B', () => {
  const p = { type: '吊装', permit_no: 'DZ-1', level: '三级', load_mass_t: 8, location: 'x', workers: [{ name: '甲', role: '吊车司机', cert: 'Q2-001', briefing_signed: true }] };
  e = pc.evaluate(p, rules, ctx());
  eq(sev(e, 'LF-007'), 'pass', 'E14.1 role_cert 关键词数组：「吊车司机」命中 LF-007');
  eq(sev(e, 'LF-013'), 'should_improve', 'E14.2 未确认「十不吊」：LF-013 建议完善');
});
// E15. voltage "380" → TE-001 通过
section('B', () => {
  const p = { type: '临时用电', permit_no: 'LD-1', voltage: '380', workers: [] };
  eq(sev(pc.evaluate(p, rules, ctx()), 'TE-001'), 'pass', 'E15.1 enum 数值归一：voltage "380" 通过 TE-001');
  p.voltage = '110';
  eq(sev(pc.evaluate(p, rules, ctx()), 'TE-001'), 'should_improve', 'E15.2 voltage "110" 不在允许值：TE-001 建议完善');
});
// E16. permit 为数组 → ok:false
section('B', () => {
  let threw = false; try { pc.normalizePermit([]); } catch (x) { threw = true; }
  ok(threw, 'E16.1 permit 为数组：normalizePermit 抛错');
  const f = wj('arr-permit.json', '[]');
  const x = node([PRE, '--input', f, '--out', path.join(work, 'e16')]);
  eq(x.status, 1, 'E16.2 permit 为数组：CLI 退出码 1');
  eq(lastJson(x.stdout).ok, false, 'E16.3 permit 为数组：末行 ok:false');
});
// E17. extraction_notes 字符串 → 数组
section('B', () => {
  const p = base(); p.extraction_notes = 'guardian：空白';
  eq(JSON.stringify(pc.evaluate(p, rules, ctx()).permit.extraction_notes), JSON.stringify(['guardian：空白']), 'E17.1 extraction_notes 为字符串：包成数组');
});
// E18. lel "合格" → 建议完善而非必须整改
section('A', () => {
  const p = base(); p.gas_tests[0].lel = '合格';
  const f = find(pc.evaluate(p, rules, ctx()), 'HW-006');
  eq(f.severity, 'should_improve', 'E18.1 **lel:"合格" 定性值不当数值：HW-006 建议完善**');
  ok(f.detail.includes('定性'), 'E18.2 HW-006 详情注明定性描述');
});
// E19. now - start > 24h → G-009 建议完善；高度 <2m → HP-002 建议完善
section('C', () => {
  const b = base(); b.end_time = '2026-08-30T19:00:00+08:00';
  eq(sev(pc.evaluate(b, rules, ctx(pc.toDate('2026-08-29T10:00:00+08:00'))), 'G-009'), 'should_improve', 'E19.1 G-009：开工已过去 24h 以上 → 建议完善');
  const p = { type: '高处', permit_no: 'GC-1', level: '一级', height_m: 1.5, workers: [] };
  eq(sev(pc.evaluate(p, rules, ctx()), 'HP-002'), 'should_improve', 'E19.2 HP-002：高度 1.5m → 建议完善（核实是否需办票）');
});
// E20. briefing_signed / guardian_independent / 一票一板
section('A', () => {
  const p = base(); p.workers[1].briefing_signed = false;
  e = pc.evaluate(p, rules, ctx());
  eq(sev(e, 'G-023'), 'must_fix', 'E20.1 G-023：缺一人交底签字 → 必须整改');
  ok(find(e, 'G-023').detail.includes('刘洋'), 'E20.2 G-023 详情列出未签字人员');
  const q = base(); q.guardian = '张伟';
  eq(sev(pc.evaluate(q, rules, ctx()), 'G-022'), 'should_improve', 'E20.3 G-022：监护人兼任作业人员 → 建议完善');
  const bp = { type: '盲板抽堵', permit_no: 'MB-1', blind_plates: [{ no: '1', action: '堵-1' }, { no: '2', action: '堵-2' }], workers: [] };
  eq(sev(pc.evaluate(bp, rules, ctx()), 'BP-009'), 'should_improve', 'E20.4 BP-009：一票多板 → 建议完善');
});
// E21. 文本框 docx 能读出；页眉；删除线；叉选；gridSpan 占位
section('B', () => {
  const body = L.pXml('正文段落')
    + '<w:p><w:r><w:pict><v:shape><v:textbox><w:txbxContent><w:p><w:r><w:t>文本框里的编号 TB-001</w:t></w:r></w:p></w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>'
    + '<w:p><w:r><w:rPr><w:strike/></w:rPr><w:t>作废</w:t></w:r><w:r><w:t> ✘不同意 ☑同意</w:t></w:r></w:p>'
    + L.tblXml([[{ text: '跨列', span: 2 }, '']]);
  const files = L.readZip(L.buildDocx(body));
  const entries = [...files.entries()].map(([name, data]) => ({ name, data }));
  entries.push({ name: 'word/header1.xml', data: '<?xml version="1.0" encoding="UTF-8"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>页眉：编号 HD-2026-001</w:t></w:r></w:p></w:hdr>' });
  const res = L.docxToText(L.writeZip(entries));
  ok(res.text.includes('【文本框】文本框里的编号 TB-001'), 'E21.1 docx2text：文本框内容内联输出');
  ok(res.text.includes('### 页眉') && res.text.includes('HD-2026-001'), 'E21.2 docx2text：页眉单列');
  ok(res.text.includes('~~作废~~'), 'E21.3 docx2text：删除线文本');
  ok(res.text.includes('[×]不同意 [x]同意'), 'E21.4 docx2text：叉选与勾选');
  ok(res.text.includes('| 跨列 | ‹› |  |'), 'E21.5 docx2text：横向合并占位与留白区分');
  eq(res.summary.textboxes, 1, 'E21.6 摘要 textboxes=1');
  eq(res.summary.crossed, 1, 'E21.7 摘要 crossed=1');
  eq(res.summary.header_footer, 1, 'E21.8 摘要 header_footer=1');
  const x = node([D2T]);
  ok(x.status === 1 && lastJson(x.stdout).ok === false, 'E21.9 docx2text 缺 --input：末行 ok:false 且退出码 1');
});
// E22. 报告含未判定一节与结论文案
section('A', () => {
  const p = base(); p.in_confined_space = null;
  e = pc.evaluate(p, rules, ctx());
  const tpl = fs.readFileSync(path.join(ROOT, 'assets', 'templates', 'report-template.md'), 'utf8');
  const md = pc.renderReport(tpl, e.permit, e, ctx());
  ok(md.includes('## 五、未判定（票面信息不足）'), 'E22.1 report.md 含「未判定（票面信息不足）」节');
  ok(/未判定/.test(md.split('## 二、预检结论')[1].split('\n')[1]), 'E22.2 预检结论行提及未判定条数');
  ok(md.includes('[G-001] 作业票编号已填写 通过'), 'E22.3 通过项按正向名称列出');
});
// E23. 演示变体：多 seed 下九案例四项计数与基线一致（seed 扰动只动数值，不动缺陷结构）
section('B', () => {
  for (const seed of [1, 20260908, 424242]) {
    const V = MS.computeVariants(seed, { dataDir: EX });
    eq(Object.keys(V.cases).length, 9, `E23.1 seed ${seed}：生成 9 个案例变体`);
    ok(/T08:50:00\+08:00$/.test(V.now), `E23.2 seed ${seed}：预检基准时间为演示日 08:50（${V.now}）`);
    for (const [c, exp] of Object.entries(MS.EXPECTED)) {
      e = pc.evaluate(JSON.parse(JSON.stringify(V.cases[c].permit)), rules, ctx(pc.toDate(V.now)));
      eq([e.summary.must_fix, e.summary.should_improve, e.summary.undetermined, e.summary.pass].join('/'), exp.join('/'), `E23.3 seed ${seed} ${c}：四项计数不漂移`);
    }
    eq(JSON.stringify(MS.computeVariants(seed, { dataDir: EX })), JSON.stringify(V), `E23.4 seed ${seed}：同 seed 结果完全一致`);
  }
});
// E24. make-sample --demo：产出 9 份 docx（无 json/expected），docx 可被 docx2text 读出，关键缺陷规则仍命中
section('B', () => {
  const demo = path.join(work, 'demo7');
  const x = node([MKS, '--out', path.join(work, 'ex-demo'), '--seed', '7', '--demo', demo]);
  const res = lastJson(x.stdout);
  eq(res.ok, true, 'E24.1 make-sample --demo 运行成功');
  eq(res.demo && res.demo.files.length, 9, 'E24.2 末行 JSON 列出 9 份变体 docx');
  const listed = fs.existsSync(demo) ? fs.readdirSync(demo) : [];
  eq(listed.filter((f) => f.endsWith('.docx')).length, 9, 'E24.3 演示目录有 9 份 docx');
  eq(listed.filter((f) => /\.(json|md|txt)$/i.test(f)).length, 0, 'E24.4 演示目录不含 json / 期望报告 / 文本');
  const V = MS.computeVariants(7, { dataDir: EX });
  e = pc.evaluate(JSON.parse(JSON.stringify(V.cases['hotwork-level1-with-issues'].permit)), rules, ctx(pc.toDate(V.now)));
  ok(e.summary.must_fix > 0, 'E24.5 变体用火票仍有必须整改项');
  for (const id of ['HW-019', 'G-011', 'HW-012']) eq(sev(e, id), 'must_fix', `E24.6 变体用火票 ${id} 仍为必须整改`);
  const txt = fs.existsSync(path.join(demo, 'hotwork-level1-with-issues.docx')) ? L.docxToText(fs.readFileSync(path.join(demo, 'hotwork-level1-with-issues.docx'))) : { text: '', summary: {} };
  ok(txt.text.includes('编号：' + V.cases['hotwork-level1-with-issues'].permit.permit_no), 'E24.7 变体票号写入 docx');
  ok(txt.summary.tables >= 5, 'E24.8 变体 docx 表格数 ≥5');
  eq(res.demo && res.demo.now, V.now, 'E24.9 末行 JSON 的 now 为该批演示的预检基准时间');
});

// ============ R. 端到端回归：docx → docx2text → 抽取结果（演示样例 json）→ precheck → 比对计数与期望报告 ============
const KEYWORDS = ['监护人（签字）', '确认（勾选）', '审批环节', '安全交底签字'];
/** 类型特有栏目：用火/受限空间/高处有气体分析表；吊装有关键岗位栏；盲板抽堵有盲板清单表 */
const KEYWORDS_BY_TYPE = {
  '动火': ['分析时间', '仪器校验有效', '动火级别'], '受限空间': ['分析时间', '仪器校验有效', '照明电压'], '高处': ['分析时间', '仪器校验有效', '作业高度'],
  '吊装': ['吊装安全作业证', '吊物名称/重量', '吊车型号/吨位', '吊装指挥', '司索人员', '起重机司机'],
  '盲板抽堵': ['盲板抽堵安全作业证', '盲板编号', '材质', '厚度', '压力等级', '抽/堵及顺序', '挂牌', '盲板图'],
};
const strip = (sx, re) => sx.split('\n').filter((l) => !re.test(l)).join('\n');
MS.CASE_ORDER.forEach((c, i) => {
  // 主链路（一级用火票，示例问题 1/2/8 的附件）定 A，其余案例定 B
  section(c === 'hotwork-level1-with-issues' ? 'A' : 'B', () => {
    const k = `R${i + 1}`;
    const docx = path.join(EX, `${c}.docx`), json = path.join(EX, `${c}.json`);
    const txt = path.join(work, 'regress', `${c}.txt`);
    const d = node([D2T, '--input', docx, '--out', txt]);
    const sm = lastJson(d.stdout);
    ok(d.status === 0 && sm.tables >= 5 && sm.checked + sm.unchecked >= 5, `${k}.1 ${c}：docx2text 读取成功，表格 ≥5、勾选框 ≥5`);
    const text = fs.existsSync(txt) ? fs.readFileSync(txt, 'utf8') : '';
    const permit = JSON.parse(fs.readFileSync(json, 'utf8'));
    const miss = [`编号：${permit.permit_no}`, ...KEYWORDS, ...(KEYWORDS_BY_TYPE[permit.type] || [])].filter((kw) => !text.includes(kw));
    ok(miss.length === 0, `${k}.2 ${c}：docx2text 输出含票号与关键栏目${miss.length ? '（缺 ' + miss.join('、') + '）' : ''}`);
    const ref = path.join(EX, `${c}.docx2text.txt`);
    ok(fs.existsSync(ref) && strip(fs.readFileSync(ref, 'utf8'), /^来源：/) === strip(text, /^来源：/), `${k}.3 ${c}：docx2text 输出与演示样例 ${c}.docx2text.txt 一致`);
    const outDir = path.join(work, 'regress', c);
    const p = node([PRE, '--input', json, '--out', outDir, '--now', NOW_ISO]);
    const ps = lastJson(p.stdout);
    eq([ps.must_fix, ps.should_improve, ps.undetermined, ps.pass].join('/'), MS.EXPECTED[c].join('/'), `${k}.4 ${c}：规则引擎四项计数与期望一致`);
    ok(fs.existsSync(path.join(outDir, 'summary.json')), `${k}.5 ${c}：summary.json 落盘`);
    const expr = path.join(EX, `${c}.expected-report.md`);
    ok(fs.existsSync(expr) && fs.existsSync(path.join(outDir, 'report.md')) && strip(fs.readFileSync(expr, 'utf8'), /生成时间/) === strip(fs.readFileSync(path.join(outDir, 'report.md'), 'utf8'), /生成时间/), `${k}.6 ${c}：report.md 与期望报告一致（忽略生成时间行）`);
  });
});
// R10. extraction_notes 显示/隐藏
section('B', () => {
  const p = base(); p.extraction_notes = ['guardian：监护人签字栏空白，填 null'];
  node([PRE, '--input', wj('notes-permit.json', p), '--out', path.join(work, 'r10-with'), '--now', NOW_ISO]);
  node([PRE, '--input', path.join(EX, 'hotwork-level1-with-issues.json'), '--out', path.join(work, 'r10-without'), '--now', NOW_ISO]);
  ok(fs.readFileSync(path.join(work, 'r10-with', 'report.md'), 'utf8').includes('抽取备注（需人工确认）'), 'R10.1 有 extraction_notes 时报告单列「抽取备注（需人工确认）」');
  ok(!fs.readFileSync(path.join(work, 'r10-without', 'report.md'), 'utf8').includes('抽取备注'), 'R10.2 无 extraction_notes 时不出现抽取备注节');
});
// R11. 非法输入 → {ok:false} 且退出码 1
section('B', () => {
  const x = node([PRE, '--input', path.join(work, 'not-exist.json'), '--out', path.join(work, 'r11')]);
  eq(x.status, 1, 'R11.1 输入文件不存在：退出码 1');
  eq(lastJson(x.stdout).ok, false, 'R11.2 输入文件不存在：末行 ok:false');
});

console.log('\n' + '='.repeat(56));
console.log('permit-precheck-bridge 自测：' + pass + ' 通过，' + fail + ' 失败');
console.log(`用例级别 ${LEVELS[RUN_LEVEL]}：BVT ${byLevel.BVT}，A ${byLevel.A}，B ${byLevel.B}，C ${byLevel.C}`);
if (failures.length) { console.log('\n失败项：'); failures.forEach((f) => console.log('  ✗ ' + f)); }
console.log('='.repeat(56));
try { fs.rmSync(work, { recursive: true, force: true }); } catch (x) {}
process.exit(fail ? 1 : 0);
