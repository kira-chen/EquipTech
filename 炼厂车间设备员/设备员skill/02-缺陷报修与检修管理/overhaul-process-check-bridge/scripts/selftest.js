#!/usr/bin/env node
'use strict';
/**
 * 自测：规则引擎 check.js（plan.json → result.json 判定）、docx2text.js（方案读取）、make-sample.js（样例再生），
 * 端到端回归（docx → docx2text → plan.json → check.js 与期望一致），以及 merge-report.js（result.json → 合并报告不改写判定）。
 * 用法：node scripts/selftest.js（全绿退出 0）；SELFTEST_LEVEL=BVT|A|B|C 只跑该级及更高优先级的节
 * 演示与回归样例从演示case 读取（仓库内 炼厂车间设备员/演示case/<分类>/<技能>/，开发包内技能目录 examples/）。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const ck = require('./check');
const samples = require('./make-sample');
const L = require('./lib/docx-lite');

const CHECK = path.join(__dirname, 'check.js');
const D2T = path.join(__dirname, 'docx2text.js');
const MRG = path.join(__dirname, 'merge-report.js');
const MKS = path.join(__dirname, 'make-sample.js');
const ROOT = path.join(__dirname, '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'opcb-selftest-'));
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
const deq = (a, e, n) => eq(JSON.stringify(a), JSON.stringify(e), n);
const throwsRe = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };
const DECL = '核查为辅助自查，不替代技术负责人审核与安全部门审批；方案是否批准以审批人意见为准。';
const ENGINE_DECL = '本结果为辅助核查，不替代检修方案审批；依据条款按记忆整理，以 GB 30871-2022 正式文本与企业制度为准。';
const EMOJI = /[⚠✅❌✔✖\u{1F300}-\u{1FAFF}]/u;

/** 跑 node 脚本：返回 {code, stdout, last}（last 为末行 JSON，解析失败为 null） */
function runNode(script, args = []) {
  const p = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  let last = null; try { last = JSON.parse(p.stdout.trim().split('\n').pop()); } catch (e) { last = null; }
  return { code: p.status, stdout: p.stdout, last };
}
let n = 0;
function runMrg(args = [], tag) {
  const out = path.join(work, (tag || 'm' + (++n)) + '-out');
  const r = spawnSync(process.execPath, [MRG, ...args, '--out', out], { encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  let s; try { s = JSON.parse(lines[lines.length - 1]); } catch (e) { s = { ok: false, error: 'no-json:' + r.stdout + r.stderr }; }
  let j = null, md = null;
  if (fs.existsSync(path.join(out, 'bridge.json'))) j = JSON.parse(fs.readFileSync(path.join(out, 'bridge.json'), 'utf8'));
  if (fs.existsSync(path.join(out, 'overhaul-check-bridge.md'))) md = fs.readFileSync(path.join(out, 'overhaul-check-bridge.md'), 'utf8');
  return { code: r.status, s, j, md, out };
}
const wj = (name, obj) => { const p = path.join(work, name); fs.writeFileSync(p, typeof obj === 'string' ? obj : JSON.stringify(obj), 'utf8'); return p; };
let r;

// 演示样例：仓库内在 炼厂车间设备员/演示case/<分类>/<技能>/，开发包内在技能目录 examples/
const skillsRoot = path.resolve(__dirname, '../../..');
const EX = path.basename(skillsRoot) === '设备员skill' ? path.join(skillsRoot, '..', '演示case', path.relative(skillsRoot, path.resolve(__dirname, '..'))) : path.join(__dirname, '..', 'examples');
const rules = ck.loadRules();
const cdu = () => JSON.parse(fs.readFileSync(path.join(EX, 'cdu-overhaul.json'), 'utf8'));
const pump = () => JSON.parse(fs.readFileSync(path.join(EX, 'pump-repair.json'), 'utf8'));
const find = (res, id) => res.findings.find((f) => f.rule_id === id);
const sev = (res, id) => (find(res, id) || {}).severity || 'absent';
const tplReport = () => fs.readFileSync(path.join(ROOT, 'assets', 'templates', 'report-template.md'), 'utf8');

// ============ 6. make-sample 可再生（直接调本技能 check.js 生成真实 result.json） ============
const ex1 = path.join(work, 'ex1');
let ms = {};
section('BVT', () => {
  let m = spawnSync(process.execPath, [MKS, '--out', ex1], { encoding: 'utf8' });
  ms = JSON.parse(m.stdout.trim().split('\n').pop());
  eq(ms.ok, true, '6.1 make-sample 运行成功');
  ok(['sample-overhaul-plan.json', 'sample-overhaul-result.json', 'sample-overhaul-result-summary-mismatch.json', 'sample-workshop-notes.json', 'sample-workshop-notes-bad.json'].every((f) => (ms.files || []).includes(f)), '6.2 五份 JSON 样例齐全（含抽取结果 plan.json）');
  const ex7 = path.join(work, 'ex7');
  m = spawnSync(process.execPath, [MKS, '--out', ex7, '--seed', '7'], { encoding: 'utf8' });
  const ms7 = JSON.parse(m.stdout.trim().split('\n').pop());
  ok(ms7.planNo !== ms.planNo, '6.3 seed 改变方案编号');
  const s1 = JSON.parse(fs.readFileSync(path.join(ex1, 'sample-overhaul-result.json'), 'utf8'));
  const s7 = JSON.parse(fs.readFileSync(path.join(ex7, 'sample-overhaul-result.json'), 'utf8'));
  eq(JSON.stringify(s7.summary), JSON.stringify(s1.summary), '6.4 seed 改变数值但四项计数不变');
});
const src1 = fs.existsSync(path.join(ex1, 'sample-overhaul-result.json')) ? JSON.parse(fs.readFileSync(path.join(ex1, 'sample-overhaul-result.json'), 'utf8')) : { findings: [] };
const REAL_KEYS = ['unit', 'project', 'contractor', 'duration_days', 'jobs_count', 'summary', 'skipped', 'findings', 'extraction_notes', 'disclaimer'];
const PLAN1 = path.join(ex1, 'sample-overhaul-plan.json');
const plan1 = fs.existsSync(PLAN1) ? JSON.parse(fs.readFileSync(PLAN1, 'utf8')) : {};
section('B', () => {
  ok(Array.isArray(src1.findings) && src1.disclaimer && src1.findings.every((f) => 'name' in f && 'advice' in f && 'jobs' in f), '6.5 样例结构与 check.js 的 result.json 一致（name / advice / jobs）');
  // 2026-11-03 #15：样例 result.json 须是规则引擎的真实输出——顶层字段、规则号、规则名都要对得上真实规则库
  ok(fs.existsSync(CHECK) && fs.existsSync(path.join(ROOT, 'references', 'checklist.json')), '6.6 规则引擎 check.js 与规则库 checklist.json 在本技能目录内（样例按其真实输出生成）');
  eq(Object.keys(src1).join(','), REAL_KEYS.join(','), '6.7 样例 result.json 顶层字段与 check.js 输出一致（不含 plan_no / job_types）');
  const ruleName = new Map(rules.rules.map((x) => [x.id, x.name]));
  ok(rules.rules.length > 0 && src1.findings.filter((f) => !/^UND-/.test(f.rule_id)).every((f) => ruleName.get(f.rule_id) === f.name), '6.8 样例 findings 的规则号与规则名都在真实规则库 checklist.json 中');
  let realRes = null;
  if (fs.existsSync(PLAN1)) {
    const rd = path.join(work, 'real-check');
    spawnSync(process.execPath, [CHECK, '--input', PLAN1, '--out', rd], { encoding: 'utf8' });
    if (fs.existsSync(path.join(rd, 'result.json'))) realRes = JSON.parse(fs.readFileSync(path.join(rd, 'result.json'), 'utf8'));
  }
  ok(!!realRes && JSON.stringify(realRes) === JSON.stringify(src1), '6.9 样例 result.json 与 check.js 对样例 plan.json 的真实输出逐字一致');
  ok(!!plan1.plan_no && plan1.plan_no === ms.planNo, '6.10 样例 plan.json 带方案编号（plan_no）');
});

const RES = path.join(ex1, 'sample-overhaul-result.json');
const NOTES = path.join(ex1, 'sample-workshop-notes.json');
// ============ 7. 【核心】result.json → 合并报告不改写判定 ============
section('BVT', () => {
  r = runMrg(['--result', RES, '--plan', PLAN1, '--notes', NOTES, '--object', 'E-1201 检修方案'], 'main');
  eq(r.s.ok, true, '7.1 合并转达成功');
  eq(r.s.counts.must_fix, 3, '7.2 缺失计数按 findings 重算');
  eq(r.s.counts.should_improve, 5, '7.3 建议完善计数');
  eq(r.s.counts.undetermined, 9, '7.4 未判定计数（按作业类型聚合后的条数）');
  eq(r.s.counts.pass, 36, '7.5 已有计数');
  ok(fs.existsSync(path.join(r.out, 'summary.json')) && JSON.parse(fs.readFileSync(path.join(r.out, 'summary.json'), 'utf8')).ok === true, '7.30 summary.json 落盘');
  ok(['## 一、核查结论（引自规则引擎 check.js）', '## 二、措施缺失项（缺失 / 建议完善）', '## 三、未判定项', '## 四、已有措施', '## 五、车间侧补充提示（非规则判定）', '## 六、整改建议'].every((h) => r.md.includes(h)), '7.31 六节结构齐全');
});
section('A', () => {
  eq(JSON.stringify(r.j.findings), JSON.stringify(src1.findings), '7.6 **findings 逐条深拷贝，与规则引擎输出一字不差（含 name/advice/jobs）**');
  ok(r.j.findings.every((f, i) => f.rule_id === src1.findings[i].rule_id && f.severity === src1.findings[i].severity), '7.7 顺序与级别均未重排');
  eq(r.j.meta.sourceDisclaimer, src1.disclaimer, '7.8 规则引擎声明行原文保留在 bridge.json');
  eq(r.j.meta.declaration, DECL, '7.9 本技能声明行固化在 bridge.json');
  ok(r.md.includes(src1.disclaimer), '7.10 **md 含规则引擎声明行原文**');
  ok(r.md.includes(DECL), '7.11 **md 含本技能声明行原文**');
  ok(r.md.indexOf(src1.disclaimer) < r.md.indexOf(DECL), '7.12 规则引擎声明行在前，本技能声明行追加在后');
  for (const f of src1.findings.filter((x) => x.severity !== 'pass')) ok(r.md.includes(f.message) && r.md.includes(f.detail), `7.13 ${f.rule_id} 的 message 与 detail 原文出现在 md`);
  ok(r.md.includes('补充风险辨识章节：逐项作业开展 JSA'), '7.14 advice（方案里怎么补）原文转达');
  ok(/动火点可燃物清理/.test(r.md) && /含动火作业但方案未写明动火点周边可燃物清理措施/.test(r.md), '7.15 规则库原文「动火」照搬，未被改写为「用火」');
  ok(/动火（用火作业）/.test(r.md) && /盲板抽堵（盲板抽堵作业）/.test(r.md), '7.16 **作业类型标签加注作业许可八大类名称（不改标签原值）**');
  eq(r.j.sourceMeta.jobTypes.join(','), '动火,盲板抽堵,临时用电', '7.17 作业类型标签取 plan.json 各作业 job_types 原值（去重、按出现顺序）');
  ok(/## 三、未判定项/.test(r.md) && /UND-高处/.test(r.md.split('## 三、未判定项')[1].split('## 四、')[0]), '7.18 未判定项单列一节且含聚合规则号');
  ok(/【未判定】/.test(r.md) && /不改写为已有或缺失/.test(r.md), '7.19 未判定项说明保持未判定、不改写');
  ok(/【注意】未判定项既不代表措施已有，也不代表缺失/.test(r.md), '7.20 有未判定项时结论段出现【注意】提示');
  ok(/逐条照搬规则引擎结果，未合并、未归类、未调整级别/.test(r.md), '7.21 缺失项节声明逐条照搬');
  ok(/以下内容原文引自规则引擎（check\.js）的判定结果，合并时未做任何改写/.test(r.md), '7.22 结论段声明未改写');
  ok(/缺失（必须补充）3 项/.test(r.md) && /已有 36 项/.test(r.md), '7.23 结论行用规则引擎四级中文（缺失 / 已有）');
  ok(/## 四、已有措施/.test(r.md) && /TE-001/.test(r.md), '7.24 已有措施也逐条列出');
  ok(/## 附：抽取说明（原文）/.test(r.md) && /jobs\[4\]\.job_types/.test(r.md), '7.25 抽取说明原文附在报告');
  eq(r.j.sourceSummary.must_fix, 3, '7.26 summary 原值保留');
});
section('C', () => {
  ok(!EMOJI.test(r.md), '7.27 md 不含 emoji');
});
section('B', () => {
  ok(/<!-- ANALYSIS_START -->/.test(r.md) && /<!-- ANALYSIS_END -->/.test(r.md), '7.28 分析段占位符存在');
  ok(/不得审查方案技术内容/.test(r.md.split('<!-- ANALYSIS_START -->')[1]), '7.29 分析段占位提示不审查技术内容');
});
section('B', () => {
  eq(r.j.meta.objectName, 'E-1201 检修方案', '7.32 --object 写入对象名');
});
section('A', () => {
  ok(/【缺失（必须补充）】G-006 风险辨识与 JSA/.test(r.md) && /【未判定】UND-高处/.test(r.md), '7.33 整改建议按规则引擎级别逐条列出');
});
section('B', () => {
  ok(/各专项措施最终仍以开工时逐票办理的作业票为准/.test(r.md) && /permit-precheck-bridge/.test(r.md), '7.34 整改建议末尾提示作业票为准并互指作业票预检');
  ok(/承修单位（contractor）/.test(r.md) && /工期天数（duration_days）/.test(r.md), '7.35 result.json 字段表含承修单位与工期');
  eq(r.j.sourceMeta.plan_no, plan1.plan_no, '7.36 **方案编号取自 plan.json（check.js 的 result.json 不含 plan_no）**');
  eq(r.j.meta.planFile, PLAN1, '7.37 bridge.json 记录 plan.json 路径');
  ok(r.md.includes(`方案编号（plan_no）| ${plan1.plan_no}`) || r.md.includes(`方案编号（plan_no） | ${plan1.plan_no}`), '7.38 md 字段表出现方案编号');
  ok(/取自 plan\.json/.test(r.md), '7.39 md 注明方案编号与作业类型取自 plan.json');

});
// ============ 8. 检修分级口径 ============
section('B', () => {
  r = runMrg(['--result', RES, '--repair-type', '日常维修'], 'rt');
  eq(r.j.meta.repairType, '日常维修', '8.1 --repair-type 写入 meta');
  ok(/检修分级：日常维修/.test(r.md), '8.2 md 抬头显示检修分级');
  r = runMrg(['--result', RES, '--repair-type', '大修'], 'rt-old');
  eq(r.j.meta.repairType, '大检修', '8.3 旧值「大修」映射为「大检修」');
  eq(r.j.meta.repairTypeRaw, '大修', '8.4 旧值原文保留');
  ok(r.s.warnings.some((w) => w.includes('旧口径') && w.includes('大检修')), '8.5 旧值映射 warning');
  r = runMrg(['--result', RES, '--repair-type', '中修'], 'rt-mid');
  eq(r.j.meta.repairType, '日常维修', '8.6 旧值「中修」映射为「日常维修」');
  r = runMrg(['--result', RES, '--repair-type', '随便'], 'rt-bad');
  eq(r.s.ok, false, '8.7 非法检修分级报错');
  ok(/大检修 \/ 日常维修 \/ 抢修 \/ 专项/.test(r.s.error), '8.8 错误信息列出四个分级');
});
section('A', () => {
  r = runMrg(['--result', RES], 'rt-none');
  eq(r.j.meta.repairType, null, '8.9 不传分级时为 null，不默认');
  eq(r.s.counts.must_fix, 3, '8.10 分级参数不影响判定计数');
});

// ============ 9. 车间侧补充提示（非规则判定） ============
section('B', () => {
  r = runMrg(['--result', RES, '--notes', NOTES], 'notes');
  const notesSec = r.md.split('## 五、车间侧补充提示（非规则判定）')[1].split('## 六、')[0];
  ok(/不参与上述合规判定，不影响规则引擎结论/.test(notesSec), '9.1 车间侧节声明不参与合规判定');
  eq(r.j.workshopNotes.length, 4, '9.2 四个固定车间侧项');
  eq(r.j.workshopNotes.find((x) => x.item === '设备交出条件').status, '已核实', '9.3 已核实状态原样');
  eq(r.j.workshopNotes.find((x) => x.item === '同期交叉作业').status, '未核实', '9.4 未核实状态原样');
  eq(r.j.workshopNotes.find((x) => x.item === '承包商资质').status, '不适用', '9.5 不适用状态原样');
  eq(r.j.workshopNotes.find((x) => x.item === '备件与工机具到位').skill, '车间自查', '9.6 备件与工机具为车间自查项');
  ok(/\*\*未核实\*\*/.test(notesSec) && /建议用 cross-operation-conflict 核对/.test(notesSec), '9.7 未核实项加粗并提示可接技能');
});
section('A', () => {
  r = runMrg(['--result', RES], 'nonotes');
  ok(r.j.workshopNotes.every((x) => x.status === '未核实'), '9.8 **不传 notes 时全部「未核实」，不替用户推测**');
  ok(/待车间自查/.test(r.md), '9.9 车间自查项未核实时提示待自查');
});
section('B', () => {
  r = runMrg(['--result', RES, '--notes', path.join(ex1, 'sample-workshop-notes-bad.json')], 'badnotes');
  eq(r.s.ok, true, '9.10 状态不合法不中断');
  eq(r.j.workshopNotes.find((x) => x.item === '设备交出条件').status, '未核实', '9.11 「应该够了」按未核实处理');
  ok(r.s.warnings.some((w) => w.includes('应该够了') && w.includes('按「未核实」处理')), '9.12 状态不合法 warning');
  const custom = r.j.workshopNotes.find((x) => x.item === '脚手架方案');
  ok(custom && custom.status === '已核实' && custom.skill === '车间自查', '9.13 自定义车间项追加并标「车间自查」');
  eq(r.j.workshopNotes.length, 5, '9.14 自定义项不覆盖固定四项');
  r = runMrg(['--result', RES, '--notes', wj('notes-obj.json', { item: 'x' })], 'notesobj');
  eq(r.s.ok, false, '9.15 notes 非数组报错');
});

// ============ 10. summary 与 findings 不一致 → 只 warning 不改原数据 ============
section('A', () => {
  r = runMrg(['--result', path.join(ex1, 'sample-overhaul-result-summary-mismatch.json')], 'mismatch');
  eq(r.s.ok, true, '10.1 summary 不一致不中断');
  ok(r.s.warnings.some((w) => w.includes('summary.must_fix=5') && w.includes('重新计数 3')), '10.2 **计数不一致 warning 指明两边数字**');
  eq(r.s.counts.must_fix, 3, '10.3 报告按 findings 重算（3）');
  eq(r.j.sourceSummary.must_fix, 5, '10.4 summary 原值 5 保留，未被改写');
});

const odd = JSON.parse(JSON.stringify(src1));
odd.findings.push({ rule_id: 'X-999', severity: 'critical', name: '新级别', message: '规则引擎新增级别', detail: 'd', advice: null, basis: 'b', jobs: [] });
delete odd.disclaimer;
delete odd.job_types;
// ============ 11. 未知级别、缺声明行、无 job_types ============
section('A', () => {
  r = runMrg(['--result', wj('odd.json', odd)], 'odd');
  eq(r.s.ok, true, '11.1 未知级别不中断');
  eq(r.s.counts.other, 1, '11.2 未知级别单独计数');
  ok(r.j.findings.some((f) => f.rule_id === 'X-999' && f.severity === 'critical'), '11.3 **未知级别原样保留，未被归到四级之一**');
  ok(r.s.warnings.some((w) => w.includes('X-999') && w.includes('不在已知四级')), '11.4 未知级别 warning');
  ok(/其它级别 1 项/.test(r.md) && /critical/.test(r.md), '11.5 md 单列其它级别');
  ok(r.s.warnings.some((w) => w.includes('无 disclaimer')), '11.6 结果无声明行 warning');
  eq(r.j.meta.sourceDisclaimer, null, '11.7 无声明行时不伪造');
  ok(r.md.includes(DECL), '11.8 本技能声明行仍在');
  eq(r.j.sourceMeta.jobTypes.length, 0, '11.9 result 无 job_types 时为空数组，不猜测');
});
section('C', () => {
  ok(!/\| 作业类型标签（/.test(r.md), '11.10 无 job_types 时 md 字段表不出现作业类型标签行');
});
section('B', () => {
  ok(r.s.warnings.some((w) => /--plan/.test(w) && /plan_no/.test(w)), '11.11 未传 --plan 且结果无 plan_no/job_types 时 warning 提示传 --plan');
});
section('A', () => {
  eq(r.j.sourceMeta.plan_no, null, '11.12 不传 --plan 时方案编号为 null，不猜测');
});
const legacy = JSON.parse(JSON.stringify(src1));
legacy.plan_no = 'JX-旧样例-01'; legacy.job_types = ['动火'];
section('B', () => {
  r = runMrg(['--result', wj('legacy.json', legacy)], 'legacy');
  ok(r.j.sourceMeta.plan_no === 'JX-旧样例-01' && r.j.sourceMeta.jobTypes.join(',') === '动火', '11.13 结果自带 plan_no / job_types 时（旧格式）仍照搬');
  ok(!r.s.warnings.some((w) => /--plan/.test(w)), '11.14 结果自带两项时不提示 --plan');
});

const clean = JSON.parse(JSON.stringify(src1));
clean.findings = clean.findings.filter((f) => f.severity === 'pass');
clean.summary = { must_fix: 0, should_improve: 0, undetermined: 0, pass: 4 };
// ============ 12. 无未判定 / 无缺失 ============
section('A', () => {
  r = runMrg(['--result', wj('clean.json', clean)], 'clean');
  ok(!/【注意】未判定项/.test(r.md), '12.1 无未判定项时不出现【注意】提示');
  ok(/无需补充项；方案仍须按程序经技术负责人审核与安全部门审批/.test(r.md), '12.2 无缺失项时仍提示须审批');
  ok(/规则引擎结果中无缺失与建议完善项/.test(r.md), '12.3 缺失项节写明为空');
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
  r = runMrg(['--result', wj('summary-only.json', { must_fix: 1, should_improve: 0, undetermined: 0, pass: 3 })], 'summaryonly');
  eq(r.s.ok, false, '13.5 传入 summary.json（无 findings）报错');
  ok(/summary\.json/.test(r.s.error), '13.6 错误信息提示应传 result.json');
  r = runMrg(['--result', RES, '--notes', '/不存在/notes.json'], 'nonotesfile');
  eq(r.s.ok, false, '13.7 notes 文件不存在报错');
  r = runMrg(['--result', RES, '--未知', 'x'], 'unknownarg');
  eq(r.s.ok, false, '13.8 未知参数报错');
  r = runMrg(['--result'], 'novalue');
  eq(r.s.ok, false, '13.9 --result 缺值报错');
});

// ============ 15. 真实链路：check.js → result.json → merge-report（2026-11-03 #15） ============
section('A', () => {
  const rd = path.join(work, 'chain');
  spawnSync(process.execPath, [CHECK, '--input', PLAN1, '--out', rd], { encoding: 'utf8' });
  const RR = path.join(rd, 'result.json');
  const real = fs.existsSync(RR) ? JSON.parse(fs.readFileSync(RR, 'utf8')) : {};
  ok(!('plan_no' in real) && !('job_types' in real), '15.1 check.js 真实 result.json 不含 plan_no / job_types（缺陷前提）');
  r = runMrg(['--result', RR], 'chain-noplan');
  ok(r.j && r.j.sourceMeta.plan_no === null && r.j.sourceMeta.jobTypes.length === 0, '15.2 不传 --plan：plan_no 为 null、jobTypes 为空，不猜测');
  r = runMrg(['--result', RR, '--plan', PLAN1], 'chain-plan');
  eq(r.s.ok, true, '15.3 传 --plan 运行成功');
  eq(r.j && r.j.sourceMeta.plan_no, plan1.plan_no, '15.4 **真实链路下 sourceMeta.plan_no 取自 plan.json，不为 null**');
  eq(r.j && r.j.sourceMeta.jobTypes.join(','), '动火,盲板抽堵,临时用电', '15.5 **真实链路下 jobTypes 取自 plan.json，不为空**');
  ok(r.j && r.j.sourceMeta.jobTypesCn.includes('动火（用火作业）'), '15.6 plan.json 取到的标签同样加注八大类名称');
  eq(r.j && JSON.stringify(r.j.findings), JSON.stringify(real.findings), '15.7 传 --plan 不影响 findings 逐条照搬');
  ok(r.s.warnings && !r.s.warnings.some((w) => /不一致/.test(w)), '15.8 plan.json 与 result.json 一致时无不一致 warning');
  const other = JSON.parse(JSON.stringify(plan1)); other.project = '另一份方案'; other.jobs = other.jobs.slice(0, 2);
  r = runMrg(['--result', RR, '--plan', wj('other-plan.json', other)], 'chain-other');
  ok(r.s.ok && r.s.warnings.some((w) => /project/.test(w) && /不一致/.test(w)), '15.9 plan.json 与 result.json 项目名不一致时 warning');
  ok(r.s.warnings.some((w) => /作业项数/.test(w) && /不一致/.test(w)), '15.10 作业项数不一致时 warning');
});
section('B', () => {
  r = runMrg(['--result', RES, '--plan', '/不存在/plan.json'], 'noplanfile');
  ok(r.s.ok === false && /plan\.json|方案数据/.test(r.s.error), '15.11 --plan 文件不存在报错');
  r = runMrg(['--result', RES, '--plan', wj('bad-plan.json', '{坏')], 'badplan');
  eq(r.s.ok, false, '15.12 --plan JSON 非法报错');
  r = runMrg(['--result', RES, '--plan', wj('arr-plan.json', [1, 2])], 'arrplan');
  eq(r.s.ok, false, '15.13 --plan 不是对象报错');
});
const pl2 = JSON.parse(JSON.stringify(plan1)); pl2.plan_no = null;
section('B', () => {
  r = runMrg(['--result', RES, '--plan', wj('plan-noid.json', pl2)], 'plannoid');
  ok(r.s.ok && r.j.sourceMeta.plan_no === null && r.s.warnings.some((w) => /plan_no/.test(w) && /为空/.test(w)), '15.14 plan.json 无方案编号时为 null 并 warning，不猜测');
});

// ============ E. 规则引擎 check.js（原检修方案安全措施核查自测 26 组，每个断言拆成一条） ============
// E1 规则库规模与结构（G-020 must_fix、G-030/G-031 存在、severity_levels 只两级）
section('A', () => {
  eq(rules.rules.length, 70, 'E1.1 规则库共 70 条');
  const ids = rules.rules.map((x) => x.id);
  eq(new Set(ids).size, ids.length, 'E1.2 规则 id 唯一');
  const byId = Object.fromEntries(rules.rules.map((x) => [x.id, x]));
  eq(byId['G-020'].severity, 'must_fix', 'E1.3 G-020 能量隔离为 must_fix');
  eq(byId['G-030'].field, 'measures.toxic_protection', 'E1.4 G-030 字段为 measures.toxic_protection');
  eq(byId['G-031'].field, 'measures.restart_safety', 'E1.5 G-031 字段为 measures.restart_safety');
  deq(rules.meta.severity_levels, ['must_fix', 'should_improve'], 'E1.6 severity_levels 只有 must_fix / should_improve 两级');
});
// E2 H1 新增四条专项规则存在且为 must_fix，字段正确
section('A', () => {
  const byId = Object.fromEntries(rules.rules.map((x) => [x.id, x]));
  for (const [id, field] of [['HW-005', 'measures.hotwork_gas_test'], ['HW-006', 'measures.fire_watcher'], ['HP-004', 'measures.highplace_permit'], ['TE-004', 'measures.temp_power_permit']]) {
    eq(byId[id].severity, 'must_fix', `E2.${id} 严重度为 must_fix`);
    eq(byId[id].field, field, `E2.${id} 字段为 ${field}`);
    ok(!/第\d+章/.test(byId[id].basis), `E2.${id} basis 不带章号`);
  }
});
// E3 H3 章节号：HP/LF/TE/BP 全部不带章号；动火第5章/受限第6章/通用第4章保留
section('C', () => {
  for (const x of rules.rules) {
    if (/^(HP|LF|TE|BP)-/.test(x.id)) ok(!/第\d+章/.test(x.basis), `E3.${x.id} basis 不带「第N章」`);
  }
  const byId = Object.fromEntries(rules.rules.map((x) => [x.id, x]));
  ok(byId['HW-001'].basis.includes('第5章'), 'E3.HW-001 basis 保留第5章');
  ok(byId['CS-001'].basis.includes('第6章'), 'E3.CS-001 basis 保留第6章');
  ok(byId['G-006'].basis.includes('第4章'), 'E3.G-006 basis 保留第4章');
});
// E4 作业类型触发专项：受限空间作业缺气体检测安排 → CS-004 must_fix；无受限空间作业 → CS-004 不出现
section('A', () => {
  const r1 = ck.evaluate(cdu(), rules);
  eq(sev(r1, 'CS-004'), 'must_fix', 'E4.1 大检修方案受限空间缺气体检测安排 → CS-004 缺失');
  ok(find(r1, 'CS-004') && find(r1, 'CS-004').detail.includes('T-101'), 'E4.2 CS-004 说明列出触发作业 T-101');
  eq(sev(ck.evaluate(pump(), rules), 'CS-004'), 'absent', 'E4.3 无受限空间作业时 CS-004 跳过');
});
// E5 组合规则 C-001：同一作业含受限空间+动火 → should_improve；类型分散在不同作业 → 不触发
section('A', () => {
  eq(sev(ck.evaluate(cdu(), rules), 'C-001'), 'should_improve', 'E5.1 同一作业含受限空间+动火 → C-001 双票联办提示');
  const q = pump();
  q.jobs.push({ name: 'A', job_types: ['受限空间'], medium: 'x', location: 'y' });
  q.jobs.push({ name: 'B', job_types: ['动火'], medium: 'x', location: 'y' });
  q.measures.confined_permit = true; q.measures.isolation_purge = true; q.measures.ventilation = true;
  eq(sev(ck.evaluate(q, rules), 'C-001'), 'absent', 'E5.2 受限空间与动火分在不同作业 → C-001 不触发');
});
// E6 组合规则 C-003：工期>30 且已写阶段检查 → pass；未写 → should_improve；工期 null → undetermined
section('A', () => {
  const p = cdu();
  eq(sev(ck.evaluate(p, rules), 'C-003'), 'pass', 'E6.1 工期 45 天且写了阶段检查 → C-003 已有');
  p.measures.phased_safety_check = null;
  eq(sev(ck.evaluate(p, rules), 'C-003'), 'should_improve', 'E6.2 工期 >30 天未写阶段检查 → 建议完善');
  p.duration_days = null;
  const rr = ck.evaluate(p, rules);
  eq(sev(rr, 'C-003'), 'undetermined', 'E6.3 **工期为 null → C-003 未判定，不按默认处理**');
  ok(find(rr, 'C-003') && find(rr, 'C-003').detail.includes('duration_days'), 'E6.4 未判定说明指出缺 duration_days');
  p.duration_days = 5;
  eq(sev(ck.evaluate(p, rules), 'C-003'), 'absent', 'E6.5 工期 ≤30 天 → C-003 跳过');
});
// E7 M2 工期严格解析：日期区间字符串 → C-003 未判定；"45 天" 正常解析
section('A', () => {
  for (const bad of ['2026年9月20日至11月3日', '9.20-11.3']) {
    const p = cdu();
    p.duration_days = bad;
    eq(sev(ck.evaluate(p, rules), 'C-003'), 'undetermined', `E7.1 工期写成日期区间「${bad}」→ C-003 未判定`);
  }
  const p = cdu();
  p.duration_days = '45 天';
  eq(sev(ck.evaluate(p, rules), 'C-003'), 'pass', 'E7.2 工期「45 天」可解析，C-003 已有');
});
section('C', () => {
  eq(ck.toNum('9.20-11.3'), null, 'E7.3 toNum 日期区间返回 null');
  eq(ck.toNum('45 天'), 45, 'E7.4 toNum「45 天」返回 45');
});
// E8 M4 未标注类型 → 未判定按作业类型聚合为一条（列出规则号），不静默跳过
section('A', () => {
  const p = pump();
  p.jobs[0].job_types = null;
  const rr = ck.evaluate(p, rules);
  eq(rr.summary.undetermined, 10, 'E8.1 **未标注类型时未判定按类型聚合为 10 条（8 类 + 2 个组合），不静默跳过**');
  const hw = find(rr, 'UND-动火');
  ok(!!hw, 'E8.2 有 UND-动火 聚合项');
  ok(hw && hw.detail.includes('HW-001') && hw.detail.includes('HW-006'), 'E8.3 聚合项说明列出涉及规则号 HW-001~HW-006');
  ok(hw && hw.detail.includes('未标注作业类型'), 'E8.4 聚合项说明写明原因「未标注作业类型」');
  ok(!!find(rr, 'UND-受限空间') && !!find(rr, 'UND-受限空间+动火'), 'E8.5 单类型与组合各有聚合项');
  eq(sev(rr, 'CS-004'), 'absent', 'E8.6 聚合后不再逐条输出 CS-004');
  eq(ck.evaluate(pump(), rules).summary.undetermined, 0, 'E8.7 job_types 显式 [] = 无特殊作业，不产生未判定');
});
// E9 M1 未知作业类型标签：剔除 + 记备注；剔除后为空按未标注走未判定
section('A', () => {
  const p = pump();
  p.jobs[0].job_types = ['动焊'];
  const rr = ck.evaluate(p, rules);
  ok(rr.plan.extraction_notes.some((x) => x.includes('动焊') && x.includes('按未标注处理')), 'E9.1 未知标签「动焊」剔除并记备注「按未标注处理」');
  ok(rr.summary.undetermined > 0, 'E9.2 剔除后为空按未标注，产生未判定');
  const q = pump();
  q.jobs[0].job_types = ['动焊', '盲板抽堵'];
  const r2 = ck.evaluate(q, rules);
  ok(r2.plan.extraction_notes.some((x) => x.includes('动焊') && x.includes('已剔除')), 'E9.3 有合法标签时未知标签剔除并记「已剔除」');
  eq(r2.summary.undetermined, 0, 'E9.4 剩余合法标签时作业仍算已标注，无未判定');
  const u = pump();
  u.jobs[0].job_types = ['用火'];
  ok(ck.evaluate(u, rules).plan.extraction_notes.some((x) => x.includes('用火') && x.includes('按未标注处理')), 'E9.5 标签写成「用火」不在合法表，按未标注处理（抽取须填「动火」）');
});
// E10 jobs 为空：G-001 must_fix，专项规则全部跳过，引擎不崩
section('C', () => {
  const p = pump(); p.jobs = [];
  const rr = ck.evaluate(p, rules);
  eq(sev(rr, 'G-001'), 'must_fix', 'E10.1 jobs 为空 → G-001 缺失');
  eq(sev(rr, 'BP-001'), 'absent', 'E10.2 jobs 为空 → 专项规则 BP-001 跳过');
  eq(sev(rr, 'G-017'), 'absent', 'E10.3 jobs 为空 → 交叉作业协调 G-017（作业 ≥2 项时）跳过');
  ok(rr.summary.must_fix >= 1, 'E10.4 jobs 为空时缺失计数 ≥1');
});
// E11 措施值语义：文字→pass（引用摘录）、false→缺失、true→pass
section('A', () => {
  const p = pump();
  const r1 = ck.evaluate(p, rules);
  eq(sev(r1, 'G-006'), 'pass', 'E11.1 措施为实质文字 → 已有');
  ok(find(r1, 'G-006').detail.includes('JSA'), 'E11.2 已有措施说明摘录方案原文');
  p.measures.risk_identification = false;
  const r2 = ck.evaluate(p, rules);
  eq(sev(r2, 'G-006'), 'must_fix', 'E11.3 措施为 false → 缺失');
  ok(find(r2, 'G-006').detail.includes('未落实/未勾选'), 'E11.4 false 的说明写「未落实/未勾选」');
  p.measures.risk_identification = true;
  eq(sev(ck.evaluate(p, rules), 'G-006'), 'pass', 'E11.5 措施为 true → 已有');
});
// E12 H2 否定词：「无 / 不适用 / — / NA」整词 → 缺失并注明；含理由长句仍算已写明
section('A', () => {
  for (const bad of ['无', '不涉及', '不适用', '没有', 'N/A', 'NA', 'N A', '待定', '暂无', '/', '—', '-', '~']) {
    const p = pump();
    p.measures.risk_identification = bad;
    const rr = ck.evaluate(p, rules);
    eq(sev(rr, 'G-006'), 'must_fix', `E12.1 否定词「${bad}」→ 缺失`);
    ok(find(rr, 'G-006').detail.includes('否定词'), `E12.2 否定词「${bad}」说明注明否定词`);
  }
  eq(sev(ck.evaluate(pump(), rules), 'G-013'), 'pass', 'E12.3 「不涉及外委+理由」长句 → 已有');
  eq(ck.measureNegation('不适用：自行检修，人员为在册职工'), null, 'E12.4 含理由的「不适用」长句不算否定词');
  eq(ck.measurePresent('无'), false, 'E12.5 「无」不算已写明');
});
// E13 L3 措施值数字 0 → 未写明并注明；非 0 数字仍算已写明
section('A', () => {
  const p = pump();
  p.measures.risk_identification = 0;
  const rr = ck.evaluate(p, rules);
  eq(sev(rr, 'G-006'), 'must_fix', 'E13.1 措施值 0 → 缺失');
  ok(find(rr, 'G-006').detail.includes('数字 0'), 'E13.2 说明注明「数字 0」');
  p.measures.risk_identification = 3;
  eq(sev(ck.evaluate(p, rules), 'G-006'), 'pass', 'E13.3 非 0 数字 → 已有');
});
// E14 L5 required 对象值：不 JSON 序列化进报告，写「对象值，需人工核对」
section('C', () => {
  const p = pump();
  p.org.site_manager = { name: '陈某某', title: '车间主任' };
  const rr = ck.evaluate(p, rules);
  eq(sev(rr, 'G-010'), 'pass', 'E14.1 现场负责人为对象值 → 已有');
  ok(find(rr, 'G-010').detail.includes('对象值，需人工核对'), 'E14.2 对象值说明写「对象值，需人工核对」');
  ok(!find(rr, 'G-010').detail.includes('{'), 'E14.3 对象值不原样序列化');
});
// E15 M7 jobs 非对象元素：丢弃并记 extraction_notes
section('C', () => {
  const p = pump();
  p.jobs = [p.jobs[0], '盲板抽堵作业', p.jobs[1], null];
  const rr = ck.evaluate(p, rules);
  eq(rr.plan.jobs.length, 2, 'E15.1 jobs 中非对象元素被忽略');
  ok(rr.plan.extraction_notes.some((x) => x.includes('jobs 第 2 个元素不是对象，已忽略')), 'E15.2 记备注「jobs 第 2 个元素不是对象」');
  ok(rr.plan.extraction_notes.some((x) => x.includes('jobs 第 4 个元素不是对象，已忽略')), 'E15.3 记备注「jobs 第 4 个元素不是对象」');
});
// E16 extraction_notes：进入报告并单列一节；字符串自动包成数组
section('B', () => {
  const { plan, findings, skipped, summary } = ck.evaluate(pump(), rules);
  const md = ck.renderReport(tplReport(), plan, { findings, skipped, summary }, { rulesTotal: rules.rules.length, rulesVersion: rules.meta.version });
  ok(md.includes('抽取备注（需人工确认）'), 'E16.1 报告有「抽取备注（需人工确认）」一节');
  ok(md.includes('site_layout'), 'E16.2 抽取备注原文进入报告');
  ok(md.includes('不替代检修方案审批'), 'E16.3 报告首部声明「不替代检修方案审批」');
  const q = pump(); q.extraction_notes = '单条备注';
  deq(ck.normalizePlan(q).extraction_notes, ['单条备注'], 'E16.4 extraction_notes 为字符串时包成数组');
});
// E17 两份回归样例的期望计数（含 H1/M5 新规则）
section('A', () => {
  const rr = ck.evaluate(cdu(), rules);
  deq(rr.summary, { must_fix: 4, should_improve: 3, undetermined: 0, pass: 56 }, 'E17.1 大检修方案计数 4/3/0/56');
  deq(ck.evaluate(pump(), rules).summary, { must_fix: 0, should_improve: 1, undetermined: 0, pass: 37 }, 'E17.2 机泵方案计数 0/1/0/37');
  eq(sev(rr, 'LF-001'), 'must_fix', 'E17.3 故意缺吊装方案 → LF-001 缺失');
  eq(sev(rr, 'HW-005'), 'must_fix', 'E17.4 故意缺动火分析安排 → HW-005 缺失');
  eq(sev(rr, 'HW-006'), 'must_fix', 'E17.5 故意缺监火人 → HW-006 缺失');
  eq(sev(rr, 'G-009'), 'should_improve', 'E17.6 故意缺应急演练 → G-009 建议完善');
  eq(sev(rr, 'HP-004'), 'pass', 'E17.7 高处作业票已写 → HP-004 已有');
  eq(sev(rr, 'TE-004'), 'pass', 'E17.8 临时用电票已写 → TE-004 已有');
  eq(sev(rr, 'G-030'), 'pass', 'E17.9 有毒介质防护已写 → G-030 已有');
  eq(sev(rr, 'G-031'), 'pass', 'E17.10 检修后试车已写 → G-031 已有');
  const r2 = ck.evaluate(pump(), rules);
  eq(sev(r2, 'TE-004'), 'pass', 'E17.11 机泵方案临时用电票已写 → TE-004 已有');
  eq(sev(r2, 'HW-005'), 'absent', 'E17.12 机泵方案无动火作业 → HW-005 跳过');
});
// E18 CLI：输入文件不存在 / 非法 JSON → 退出码 1 且末行 ok:false
section('B', () => {
  const tmp = fs.mkdtempSync(path.join(work, 'e18-'));
  const badf = path.join(tmp, 'bad.json'); fs.writeFileSync(badf, '{oops');
  for (const [tag, input] of [['文件不存在', path.join(tmp, 'nope.json')], ['JSON 非法', badf]]) {
    const x = runNode(CHECK, ['--input', input, '--out', tmp]);
    eq(x.code, 1, `E18.1 check.js 输入${tag} → 退出码 1`);
    eq(x.last && x.last.ok, false, `E18.2 check.js 输入${tag} → 末行 ok:false`);
  }
  const y = runNode(CHECK, []);
  ok(y.code === 1 && y.last && y.last.ok === false, 'E18.3 check.js 缺 --input → 退出码 1 且 ok:false');
});
// E19 CLI 正常运行：末行摘要 + 三个输出文件
section('A', () => {
  const tmp = fs.mkdtempSync(path.join(work, 'e19-'));
  const x = runNode(CHECK, ['--input', path.join(EX, 'pump-repair.json'), '--out', tmp]);
  deq(x.last, { must_fix: 0, should_improve: 1, undetermined: 0, pass: 37 }, 'E19.1 check.js 末行四项计数摘要');
  for (const f of ['result.json', 'report.md', 'summary.json']) ok(fs.existsSync(path.join(tmp, f)), `E19.2 生成 ${f}`);
  ok(fs.existsSync(path.join(tmp, 'summary.json')) && JSON.stringify(JSON.parse(fs.readFileSync(path.join(tmp, 'summary.json'), 'utf8'))) === JSON.stringify(x.last), 'E19.3 summary.json 与末行摘要一致');
  const res = fs.existsSync(path.join(tmp, 'result.json')) ? JSON.parse(fs.readFileSync(path.join(tmp, 'result.json'), 'utf8')) : {};
  eq(res.disclaimer, ENGINE_DECL, 'E19.4 result.json 的 disclaimer 为规则引擎声明行原文');
});
// E20 L1 docx2text CLI：缺 --input / 文件不存在 / 不是 docx → 退出码 1 且末行 {"ok":false,...}
section('B', () => {
  const tmp = fs.mkdtempSync(path.join(work, 'e20-'));
  fs.writeFileSync(path.join(tmp, 'bad.docx'), 'not a docx');
  for (const [tag, extra] of [['缺 --input', []], ['文件不存在', ['--input', path.join(tmp, 'nope.docx')]], ['不是 docx', ['--input', path.join(tmp, 'bad.docx')]]]) {
    const x = runNode(D2T, extra);
    eq(x.code, 1, `E20.1 docx2text ${tag} → 退出码 1`);
    eq(x.last && x.last.ok, false, `E20.2 docx2text ${tag} → 末行 ok:false`);
    ok(!!(x.last && x.last.error), `E20.3 docx2text ${tag} → 末行带 error`);
  }
});
// E21 顶层不是对象 → 归一化报错（CLI 会转为 ok:false）
section('B', () => {
  ok(throwsRe(() => ck.normalizePlan([1, 2]), /顶层必须是对象/), 'E21.1 plan 顶层为数组 → 报错');
  ok(throwsRe(() => ck.normalizePlan(null), /顶层必须是对象/), 'E21.2 plan 顶层为 null → 报错');
});
// E22 docx 写入→读回：样例方案含作业内容表与故意缺失的措施痕迹
section('B', () => {
  const res = L.docxToText(samples.cduOverhaul());
  ok(res.summary.tables >= 1, 'E22.1 大检修方案读回有表格');
  ok(res.text.includes('检修作业内容'), 'E22.2 读回含「检修作业内容」');
  ok(res.text.includes('常压塔 T-101 内件更换'), 'E22.3 读回含作业名称');
  ok(res.text.includes('受限空间、高处、动火'), 'E22.4 读回含作业类型栏');
  ok(res.text.includes('安全措施'), 'E22.5 读回含安全措施章节');
  ok(!res.text.includes('气体检测'), 'E22.6 大检修样例不写受限空间气体检测（故意缺失项）');
  ok(!res.text.includes('动火分析'), 'E22.7 大检修样例不写动火分析（故意缺失项）');
  ok(!res.text.includes('监火人') && !res.text.includes('动火监护人'), 'E22.8 大检修样例不写监火人 / 动火监护人（故意缺失项）');
  ok(res.text.includes('高处安全作业票'), 'E22.9 读回含高处安全作业票');
  ok(res.text.includes('临时用电安全作业票'), 'E22.10 读回含临时用电安全作业票');
  const res2 = L.docxToText(samples.pumpRepair());
  ok(res2.text.includes('无特殊作业'), 'E22.11 机泵方案读回含「无特殊作业」');
  ok(res2.text.includes('盲板抽堵'), 'E22.12 机泵方案读回含盲板抽堵');
  ok(res2.text.includes('临时用电安全作业票'), 'E22.13 机泵方案读回含临时用电安全作业票');
  ok(res2.text.includes('硫化氢'), 'E22.14 机泵方案读回含硫化氢防护');
  ok(res2.text.includes('试车'), 'E22.15 机泵方案读回含试车');
});
// E23 未标注类型作业的报告：undetermined 单列一节（聚合口径已在模板注明）
section('A', () => {
  const p = pump(); p.jobs[0].job_types = null;
  const { plan, findings, skipped, summary } = ck.evaluate(p, rules);
  const md = ck.renderReport(tplReport(), plan, { findings, skipped, summary }, { rulesTotal: rules.rules.length, rulesVersion: rules.meta.version });
  ok(md.includes('## 六、未判定'), 'E23.1 report.md 有「六、未判定」一节');
  ok(md.includes('无法判定'), 'E23.2 未判定项写「无法判定」');
  ok(md.includes('聚合'), 'E23.3 模板注明按作业类型聚合的计数口径');
  ok(summary.undetermined > 0, 'E23.4 未判定计数 >0');
});
// E24 变体决定性与教学缺失点：同一 seed 结果一致；变体 docx 中故意缺失点仍不出现，机泵变体仍缺平面图
section('B', () => {
  const v = samples.makeVariant(20260908);
  deq(v, samples.makeVariant(20260908), 'E24.1 同一 seed 两次生成完全一致');
  eq(samples.makeVariant(null).seed, null, 'E24.2 不传 seed 为基准');
  deq(samples.makeVariant(undefined), samples.baselineVariant(), 'E24.3 seed 为 undefined 时等于基准变体');
  const txt = L.docxToText(samples.cduOverhaul(v)).text;
  for (const kw of ['气体检测', '动火分析', '监火人', '动火监护人', '吊装方案']) ok(!txt.includes(kw), `E24.4 变体大检修方案不出现「${kw}」（故意缺失项）`);
  ok(!/应急演练/.test(txt), 'E24.5 变体大检修方案不出现应急演练（故意缺失项）');
  ok(txt.includes(v.cdu.unitFull) && txt.includes(v.cdu.contractor) && txt.includes(`${v.cdu.duration} 天`), 'E24.6 变体字段写入 docx');
  const ptxt = L.docxToText(samples.pumpRepair(v)).text;
  ok(!ptxt.includes('平面布置图'), 'E24.7 机泵变体仍缺施工平面布置图');
  ok(ptxt.includes('试车') && ptxt.includes('临时用电安全作业票'), 'E24.8 机泵变体保持基本合规');
});
// E25 变体 plan.json 直接跑规则引擎：计数与基准一致
section('B', () => {
  for (const seed of [20260908, 7, 12345]) {
    const v = samples.makeVariant(seed);
    const r1 = ck.evaluate(samples.applyVariantToPlan(cdu(), v, 'cdu'), rules);
    deq(r1.summary, { must_fix: 4, should_improve: 3, undetermined: 0, pass: 56 }, `E25.1 seed=${seed} 大检修变体计数 4/3/0/56`);
    for (const id of ['CS-004', 'HW-005', 'HW-006', 'LF-001']) eq(sev(r1, id), 'must_fix', `E25.2 seed=${seed} ${id} 仍为缺失`);
    eq(sev(r1, 'G-009'), 'should_improve', `E25.3 seed=${seed} G-009 仍为建议完善`);
    const r2 = ck.evaluate(samples.applyVariantToPlan(pump(), v, 'pump'), rules);
    deq(r2.summary, { must_fix: 0, should_improve: 1, undetermined: 0, pass: 37 }, `E25.4 seed=${seed} 机泵变体计数 0/1/0/37`);
    eq(sev(r2, 'G-028'), 'should_improve', `E25.5 seed=${seed} 机泵变体 G-028 仍为建议完善`);
  }
});
// E26 make-sample --seed 生成变体 docx：可被 docx2text 读取且缺失点保留；参数错误按约定报错（原 make-demo 断言）
section('B', () => {
  const tmp = fs.mkdtempSync(path.join(work, 'e26-'));
  const x = runNode(MKS, ['--out', tmp, '--seed', '20260908']);
  eq(x.last && x.last.ok, true, 'E26.1 make-sample --seed 运行成功');
  eq(x.last && x.last.variantSeed, 20260908, 'E26.2 回传变体 seed');
  ok(x.last && ['cdu-overhaul.docx', 'pump-repair.docx'].every((f) => x.last.files.includes(f)), 'E26.3 生成两份方案 docx');
  deq(x.last && x.last.counts['cdu-overhaul'], { must_fix: 4, should_improve: 3, undetermined: 0, pass: 56 }, 'E26.4 变体大检修方案计数不变');
  const t = runNode(D2T, ['--input', path.join(tmp, 'cdu-overhaul.docx'), '--out', path.join(tmp, 'cdu.txt')]);
  ok(t.last && t.last.tables >= 1 && t.last.paragraphs > 20, 'E26.5 docx2text 可读变体 docx（表格 ≥1、段落 >20）');
  const text = fs.existsSync(path.join(tmp, 'cdu.txt')) ? fs.readFileSync(path.join(tmp, 'cdu.txt'), 'utf8') : '';
  for (const kw of ['气体检测', '动火分析', '监火人']) ok(text && !text.includes(kw), `E26.6 变体 docx 不出现「${kw}」`);
  for (const [tag, args] of [['--seed 非整数', ['--out', tmp, '--seed', 'abc']], ['--seed 缺值', ['--seed', '--out', tmp]], ['未知参数', ['--out', tmp, '--未知', 'x']]]) {
    const y = runNode(MKS, args);
    eq(y.code, 1, `E26.7 make-sample ${tag} → 退出码 1`);
    eq(y.last && y.last.ok, false, `E26.8 make-sample ${tag} → 末行 ok:false`);
  }
});

// ============ R. 端到端回归：演示case 的 docx → docx2text 与入库文本一致 → plan.json → check.js 计数与报告与期望一致 ============
const stripLines = (s, re) => s.split('\n').filter((l) => !re.test(l)).join('\n');
const CDU_MUST_NOT_CONTAIN = ['气体检测', '动火分析', '监火人', '动火监护人', '吊装方案'];
function regression(name, tag) {
  const c = samples.REGRESSION_CASES[name];
  const docx = path.join(EX, `${name}.docx`), json = path.join(EX, `${name}.json`);
  ok(fs.existsSync(docx) && fs.existsSync(json), `${tag}.1 ${name} 的 docx 与 json 在演示case`);
  const txt = path.join(work, `${name}.txt`);
  const t = runNode(D2T, ['--input', docx, '--out', txt]);
  ok(t.code === 0 && t.last && t.last.tables >= 1 && t.last.paragraphs > 20, `${tag}.2 ${name} docx2text 摘要正常（表格 ≥1、段落 >20）`);
  const text = fs.existsSync(txt) ? fs.readFileSync(txt, 'utf8') : '';
  if (name === 'cdu-overhaul') ok(CDU_MUST_NOT_CONTAIN.every((kw) => !text.includes(kw)), `${tag}.3 ${name} 教学缺失点未被破坏（文本不含气体检测 / 动火分析 / 监火人 / 动火监护人 / 吊装方案）`);
  const ref = path.join(EX, `${name}.docx2text.txt`);
  ok(fs.existsSync(ref) && stripLines(fs.readFileSync(ref, 'utf8'), /^来源：/) === stripLines(text, /^来源：/), `${tag}.4 ${name} docx2text 输出与入库 ${name}.docx2text.txt 一致（忽略来源行）`);
  const outDir = path.join(work, `reg-${name}`);
  const k = runNode(CHECK, ['--input', json, '--out', outDir]);
  deq(k.last, c.expected, `${tag}.5 ${name} check.js 计数与期望一致`);
  const res = fs.existsSync(path.join(outDir, 'result.json')) ? JSON.parse(fs.readFileSync(path.join(outDir, 'result.json'), 'utf8')) : {};
  eq(res.skipped, c.skipped, `${tag}.6 ${name} 未适用（跳过）规则数与期望一致`);
  ok(fs.existsSync(path.join(outDir, 'summary.json')), `${tag}.7 ${name} 生成 summary.json`);
  const expr = path.join(EX, `${name}.expected-report.md`);
  const rep = fs.existsSync(path.join(outDir, 'report.md')) ? fs.readFileSync(path.join(outDir, 'report.md'), 'utf8') : '';
  ok(fs.existsSync(expr) && stripLines(fs.readFileSync(expr, 'utf8'), /生成时间/) === stripLines(rep, /生成时间/), `${tag}.8 ${name} report.md 与 ${name}.expected-report.md 一致（忽略生成时间行）`);
}
section('A', () => { regression('cdu-overhaul', 'R1'); });
section('B', () => { regression('pump-repair', 'R2'); });
section('B', () => {
  const x = runNode(CHECK, ['--input', path.join(work, 'not-exist.json'), '--out', path.join(work, 'r3')]);
  ok(x.code === 1 && x.last && x.last.ok === false, 'R3.1 回归链路非法输入 → 退出码 1 且 ok:false');
  const pp = path.join(EX, 'sample-overhaul-plan.json'), rp = path.join(EX, 'sample-overhaul-result.json');
  const rd = path.join(work, 'r3-case');
  runNode(CHECK, ['--input', pp, '--out', rd]);
  ok(fs.existsSync(path.join(rd, 'result.json')) && fs.existsSync(rp) && fs.readFileSync(path.join(rd, 'result.json'), 'utf8') === JSON.stringify(JSON.parse(fs.readFileSync(rp, 'utf8')), null, 2), 'R3.2 演示case 的 sample-overhaul-result.json 与 check.js 对 sample-overhaul-plan.json 的真实输出一致');
  const pumpDocx = path.join(EX, 'pump-repair.docx'), planDocx = path.join(EX, 'sample-overhaul-plan.docx');
  ok(fs.existsSync(planDocx) && stripLines(L.docxToText(fs.readFileSync(planDocx)).text, /^$/) === stripLines(L.docxToText(fs.readFileSync(pumpDocx)).text, /^$/), 'R3.3 sample-overhaul-plan.docx 与 pump-repair.docx 是同一份方案');
});

// ============ 14. 文档口径（出现与不出现两个方向） ============
section('C', () => {
  const skill = fs.readFileSync(path.join(ROOT, 'SKILL.md'), 'utf8');
  ok(/安全措施核查/.test(skill) && /大检修/.test(skill) && /日常维修/.test(skill), '14.1 SKILL.md 用中石化检修分级与「安全措施核查」限定');
  ok(!/检修方案审一下/.test(skill) && !/方案能不能报/.test(skill), '14.2 SKILL.md 触发词不再抢「检修方案审一下 / 方案能不能报」');
  ok(/PDF 先用平台 pdf 技能转为 txt\/docx 再传入，脚本不读 PDF；扫描件需 OCR/.test(skill), '14.3 SKILL.md 含 PDF 前置步骤');
  ok(!/check-dependency|SKILL_PACK_ROOT|依赖技能|源技能|overhaul-safety-check/.test(skill), '14.4 SKILL.md 不再要求安装或探测依赖技能');
  ok(/merge-report\.js/.test(skill), '14.5 SKILL.md 操作步骤含 merge-report.js');
  ok(/permit-precheck-bridge/.test(skill) && /repair-plan-assistant/.test(skill) && /completion-acceptance/.test(skill), '14.6 description 互指排除语齐全');
  ok(/由其他岗位归口/.test(skill) && /方案批准/.test(skill), '14.7 SKILL.md 写明车间设备员可做与归口');
  ok(/agent_created: true/.test(skill) && /allowed-tools:/.test(skill), '14.8 frontmatter 保留 agent_created 与 allowed-tools');
  ok(skill.includes(DECL), '14.9 SKILL.md 声明行与脚本一致');
  ok(/用火作业/.test(skill), '14.10 SKILL.md 用「用火作业」命名');
  const rulesMd = fs.readFileSync(path.join(ROOT, 'references', 'bridge-rules.md'), 'utf8');
  ok(/检修方案/.test(rulesMd) && /大检修/.test(rulesMd) && /三查四定/.test(rulesMd), '14.11 bridge-rules.md 写检修方案口径与大检修节点');
  const other = path.join(ROOT, '..', 'permit-precheck-bridge', 'references', 'bridge-rules.md');
  ok(!fs.existsSync(other) || fs.readFileSync(other, 'utf8') !== rulesMd, '14.12 references 不与 permit bridge 逐字重复');
  const readme = fs.readFileSync(path.join(ROOT, 'scripts', 'README.md'), 'utf8');
  ok(/--plan/.test(skill) && /--plan/.test(readme), '14.15 SKILL.md 与 scripts/README 记录 --plan');
  ok(/merge-report\.js/.test(readme) && /tmpdir/.test(readme) && /--repair-type/.test(readme), '14.13 scripts/README 记录 merge-report、默认输出目录与 --repair-type');
  ok(fs.existsSync(path.join(ROOT, 'references', 'input-spec.md')), '14.14 references/input-spec.md 存在');
  ok(/docx2text\.js/.test(skill) && /check\.js/.test(skill) && skill.indexOf('docx2text.js') < skill.indexOf('scripts/check.js') && skill.indexOf('scripts/check.js') < skill.indexOf('scripts/merge-report.js'), '14.16 SKILL.md 操作步骤按 docx2text → check.js → merge-report 一条流程');
  ok(skill.includes(ENGINE_DECL), '14.17 SKILL.md 保留规则引擎声明行');
  ok(['另行编制', '夜间施工', '雨季', '消防道路', '临时设施', 'checklist-ref.md'].every((k) => skill.includes(k)), '14.18 SKILL.md 保留人工提醒清单');
  ok(/--notes/.test(skill) && /跳过/.test(skill), '14.19 SKILL.md 写明车间侧信息可选、没有就跳过');
  const listing = fs.readFileSync(path.join(ROOT, '上架信息.md'), 'utf8');
  const sampleQ = fs.readFileSync(path.join(ROOT, '样例问题.md'), 'utf8');
  ok(/\*\*技能名称\*\*：车间检修方案安全措施核查\n/.test(listing) && !/入口/.test(listing) && !/入口/.test(sampleQ) && /\n# 车间检修方案安全措施核查（overhaul-process-check-bridge）\n/.test(skill), '14.20 中文名去掉「入口」（SKILL.md 标题、上架信息、样例问题）');
  ok(!/依赖技能|源技能|需先安装|动火|大修方案|中修|小修/.test(listing), '14.21 上架信息不提依赖技能，作业类别写「用火」、分级不用旧称');
  ok((listing.match(/\*\*附件：\*\* `[^`/]+`/g) || []).length === 5, '14.22 上架信息 5 个示例问题的附件只写文件名');
  const guide = fs.readFileSync(path.join(ROOT, 'references', 'extraction-guide.md'), 'utf8');
  ok(/用火作业许可证/.test(guide) && /用火票/.test(guide) && /沿用 GB 30871 的「动火」，即中石化的「用火作业」/.test(guide), '14.23 抽取手册说明标签沿用「动火」并补「用火作业许可证 / 用火票」映射');
  const visible = [skill, listing, sampleQ, readme, rulesMd, ...['checklist.md', 'input-spec.md', 'intake-questions.md', 'sample-output.md'].map((f) => fs.readFileSync(path.join(ROOT, 'references', f), 'utf8'))].join('\n');
  ok(!/check-dependency|SKILL_PACK_ROOT|依赖技能|源技能|外部技能|overhaul-safety-check/.test(visible), '14.24 说明文件不再出现依赖探测与旧技能名');
  ok(/原文来自规则库/.test(skill) && /不替换/.test(skill) && /不替换/.test(rulesMd), '14.25 SKILL.md 与 bridge-rules.md 说明规则库原文照搬不替换');
});

console.log('\n' + '='.repeat(56));
console.log('overhaul-process-check-bridge 自测：' + pass + ' 通过，' + fail + ' 失败');
console.log(`用例级别 ${LEVELS[RUN_LEVEL]}：BVT ${byLevel.BVT}，A ${byLevel.A}，B ${byLevel.B}，C ${byLevel.C}`);
if (failures.length) { console.log('\n失败项：'); failures.forEach((f) => console.log('  ✗ ' + f)); }
console.log('='.repeat(56));
try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
