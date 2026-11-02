#!/usr/bin/env node
'use strict';
/**
 * 自测：断言 check-dependency.js（依赖探测）与 merge-report.js（源技能 JSON → 合并报告不改写判定）。
 * 用法：node scripts/selftest.js（全绿退出 0）
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CHK = path.join(__dirname, 'check-dependency.js');
const MRG = path.join(__dirname, 'merge-report.js');
const MKS = path.join(__dirname, 'make-sample.js');
const ROOT = path.join(__dirname, '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'opcb-selftest-'));
let pass = 0, fail = 0;
const failures = [];
const ok = (c, n) => { if (c) pass++; else { fail++; failures.push(n); } };
const eq = (a, e, n) => ok(a === e, n + '（期望 ' + JSON.stringify(e) + '，实际 ' + JSON.stringify(a) + '）');
const DECL = '核查为辅助自查，不替代技术负责人审核与安全部门审批；方案是否批准以审批人意见为准。';
const EMOJI = /[⚠✅❌✔✖\u{1F300}-\u{1FAFF}]/u;

function runChk(args = [], env = {}) {
  const r = spawnSync(process.execPath, [CHK, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
  const lines = r.stdout.trim().split('\n');
  let s; try { s = JSON.parse(lines[lines.length - 1]); } catch (e) { s = { ok: false, error: 'no-json:' + r.stdout + r.stderr }; }
  return { code: r.status, s };
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

// ============ 1. 依赖存在时 ============
const fake = path.join(work, 'dep', 'scripts');
fs.mkdirSync(fake, { recursive: true });
fs.writeFileSync(path.join(fake, 'check.js'), '// stub');
let r = runChk(['--skill-root', path.join(work, 'dep')]);
eq(r.s.ok, true, '1.1 检查脚本正常退出');
eq(r.s.available, true, '1.2 依赖存在时 available=true');
eq(r.s.dependency, 'overhaul-safety-check', '1.3 依赖名正确');
ok(r.s.script && r.s.script.endsWith('check.js'), '1.4 返回依赖脚本路径');
ok(/不得改写任何判定项/.test(r.s.note), '1.5 note 提示不得改写判定');
eq(r.s.docx2text, null, '1.6 依赖目录无 docx2text.js 时为 null');
fs.writeFileSync(path.join(fake, 'docx2text.js'), '// stub');
r = runChk(['--skill-root', path.join(work, 'dep')]);
ok(r.s.docx2text && r.s.docx2text.endsWith('docx2text.js'), '1.7 依赖目录有 docx2text.js 时返回其路径');

// ============ 2. 依赖不存在时（核心：必须终止而非降级） ============
r = runChk(['--skill-root', path.join(work, '不存在的目录')]);
eq(r.s.available, false, '2.1 依赖不存在时 available=false');
eq(r.s.script, null, '2.2 无脚本路径');
ok(/必须告知用户/.test(r.s.note), '2.3 note 要求告知用户');
ok(/终止/.test(r.s.note), '2.4 note 要求终止');
ok(/不得用本技能自行判定/.test(r.s.note), '2.5 note 禁止自行判定');
ok(r.s.searched && r.s.searched.length >= 1, '2.6 列出搜索过的路径');
ok(r.s.searched[0].includes('不存在'), '2.7 显式 --skill-root 时只查指定路径');
eq(r.s.searched.length, 1, '2.8 显式 --skill-root 时候选路径只有一个');

// ============ 3. 落盘 ============
const outDir = path.join(work, 'out');
r = runChk(['--skill-root', path.join(work, 'dep'), '--out', outDir]);
ok(fs.existsSync(path.join(outDir, 'dependency.json')), '3.1 dependency.json 落盘');
const dj = JSON.parse(fs.readFileSync(path.join(outDir, 'dependency.json'), 'utf8'));
eq(dj.available, true, '3.2 落盘内容正确');
ok(/SKILL_PACK_ROOT/.test(dj.platformNote) && /豆包/.test(dj.platformNote), '3.3 平台说明含 SKILL_PACK_ROOT 与豆包');

// ============ 4. 参数校验 ============
r = runChk(['--skill-root']);
eq(r.s.ok, false, '4.1 缺值报错');
ok(/缺少取值/.test(r.s.error), '4.2 缺值信息正确');
r = runChk(['--未知', 'x']);
eq(r.s.ok, false, '4.3 未知参数报错');

// ============ 5. 默认搜索路径与 SKILL_PACK_ROOT ============
r = runChk([]);
eq(r.s.ok, true, '5.1 无参数可运行');
ok(Array.isArray(r.s.searched) && r.s.searched.length >= 4, '5.2 默认搜索多个候选路径');
ok(r.s.searched.some((p) => p.includes('.workbuddy')) && r.s.searched.some((p) => p.includes('.claude')) && r.s.searched.some((p) => p.includes('.doubao')), '5.3 默认候选覆盖三个平台目录');
const packRoot = path.join(work, 'pack');
fs.mkdirSync(path.join(packRoot, '【炼化】检修方案安全措施核查', 'overhaul-safety-check', 'scripts'), { recursive: true });
fs.writeFileSync(path.join(packRoot, '【炼化】检修方案安全措施核查', 'overhaul-safety-check', 'scripts', 'check.js'), '// stub');
r = runChk([], { SKILL_PACK_ROOT: packRoot });
eq(r.s.available, true, '5.4 SKILL_PACK_ROOT 指向技能包根目录时可命中');
ok(r.s.root && r.s.root.startsWith(packRoot), '5.5 命中的是 SKILL_PACK_ROOT 下的依赖');
eq(r.s.envSkillPackRoot, packRoot, '5.6 结果回显 SKILL_PACK_ROOT');
const packRoot2 = path.join(work, 'pack2');
fs.mkdirSync(path.join(packRoot2, 'renamed', 'overhaul-safety-check', 'scripts'), { recursive: true });
fs.writeFileSync(path.join(packRoot2, 'renamed', 'overhaul-safety-check', 'scripts', 'check.js'), '// stub');
r = runChk([], { SKILL_PACK_ROOT: packRoot2 });
eq(r.s.available, true, '5.7 技能包子目录被改名时一级扫描仍能命中');

// ============ 6. make-sample 可再生 ============
const ex1 = path.join(work, 'ex1');
let m = spawnSync(process.execPath, [MKS, '--out', ex1], { encoding: 'utf8' });
const ms = JSON.parse(m.stdout.trim().split('\n').pop());
eq(ms.ok, true, '6.1 make-sample 运行成功');
ok(['sample-overhaul-result.json', 'sample-overhaul-result-summary-mismatch.json', 'sample-workshop-notes.json', 'sample-workshop-notes-bad.json'].every((f) => ms.files.includes(f)), '6.2 四份 JSON 样例齐全');
const ex7 = path.join(work, 'ex7');
m = spawnSync(process.execPath, [MKS, '--out', ex7, '--seed', '7'], { encoding: 'utf8' });
const ms7 = JSON.parse(m.stdout.trim().split('\n').pop());
ok(ms7.planNo !== ms.planNo, '6.3 seed 改变方案编号');
const src1 = JSON.parse(fs.readFileSync(path.join(ex1, 'sample-overhaul-result.json'), 'utf8'));
const src7 = JSON.parse(fs.readFileSync(path.join(ex7, 'sample-overhaul-result.json'), 'utf8'));
eq(JSON.stringify(src7.summary), JSON.stringify(src1.summary), '6.4 seed 改变数值但四项计数不变');
ok(Array.isArray(src1.findings) && src1.disclaimer && src1.findings.every((f) => 'name' in f && 'advice' in f && 'jobs' in f), '6.5 样例结构与源技能 result.json 一致（name / advice / jobs）');

// ============ 7. 【核心】源技能 JSON → 合并报告不改写判定 ============
const RES = path.join(ex1, 'sample-overhaul-result.json');
const NOTES = path.join(ex1, 'sample-workshop-notes.json');
r = runMrg(['--result', RES, '--notes', NOTES, '--object', 'E-1201 检修方案'], 'main');
eq(r.s.ok, true, '7.1 合并转达成功');
eq(r.s.counts.must_fix, 3, '7.2 缺失计数按 findings 重算');
eq(r.s.counts.should_improve, 2, '7.3 建议完善计数');
eq(r.s.counts.undetermined, 1, '7.4 未判定计数');
eq(r.s.counts.pass, 4, '7.5 已有计数');
eq(JSON.stringify(r.j.findings), JSON.stringify(src1.findings), '7.6 **findings 逐条深拷贝，与源技能一字不差（含 name/advice/jobs）**');
ok(r.j.findings.every((f, i) => f.rule_id === src1.findings[i].rule_id && f.severity === src1.findings[i].severity), '7.7 顺序与级别均未重排');
eq(r.j.meta.sourceDisclaimer, src1.disclaimer, '7.8 源技能声明行原文保留在 bridge.json');
eq(r.j.meta.declaration, DECL, '7.9 本技能声明行固化在 bridge.json');
ok(r.md.includes(src1.disclaimer), '7.10 **md 含源技能声明行原文**');
ok(r.md.includes(DECL), '7.11 **md 含本技能声明行原文**');
ok(r.md.indexOf(src1.disclaimer) < r.md.indexOf(DECL), '7.12 源技能声明行在前，本技能声明行追加在后');
for (const f of src1.findings.filter((x) => x.severity !== 'pass')) ok(r.md.includes(f.message) && r.md.includes(f.detail), `7.13 ${f.rule_id} 的 message 与 detail 原文出现在 md`);
ok(r.md.includes('补一节「作业风险分析（JSA）」'), '7.14 源技能 advice（方案里怎么补）原文转达');
ok(/动火点周围可燃物清理与隔离/.test(r.md), '7.15 源技能标签原词「动火」照搬，未被改写为「用火」');
ok(/动火（用火作业）/.test(r.md) && /盲板抽堵（盲板抽堵作业）/.test(r.md), '7.16 **作业类型标签加注作业许可八大类名称（不改源值）**');
eq(r.j.sourceMeta.jobTypes.join(','), '动火,盲板抽堵,临时用电', '7.17 源 job_types 原值保留');
ok(/## 三、未判定项/.test(r.md) && /UND-高处/.test(r.md.split('## 三、未判定项')[1].split('## 四、')[0]), '7.18 未判定项单列一节且含聚合规则号');
ok(/【未判定】/.test(r.md) && /不改写为已有或缺失/.test(r.md), '7.19 未判定项说明保持未判定、不改写');
ok(/【注意】未判定项既不代表措施已有，也不代表缺失/.test(r.md), '7.20 有未判定项时结论段出现【注意】提示');
ok(/逐条照搬源技能结果，未合并、未归类、未调整级别/.test(r.md), '7.21 缺失项节声明逐条照搬');
ok(/以下内容原文引自源技能判定结果，本技能未做任何改写/.test(r.md), '7.22 结论段声明未改写');
ok(/缺失（必须补充）3 项/.test(r.md) && /已有 4 项/.test(r.md), '7.23 结论行用源技能四级中文（缺失 / 已有）');
ok(/## 四、已有措施/.test(r.md) && /TE-001/.test(r.md), '7.24 已有措施也逐条列出');
ok(/## 附：源技能抽取说明（原文）/.test(r.md) && /jobs\[2\]\.job_types/.test(r.md), '7.25 源技能抽取说明原文附在报告');
eq(r.j.sourceSummary.must_fix, 3, '7.26 源 summary 原值保留');
ok(!EMOJI.test(r.md), '7.27 md 不含 emoji');
ok(/<!-- ANALYSIS_START -->/.test(r.md) && /<!-- ANALYSIS_END -->/.test(r.md), '7.28 分析段占位符存在');
ok(/不得审查方案技术内容/.test(r.md.split('<!-- ANALYSIS_START -->')[1]), '7.29 分析段占位提示不审查技术内容');
ok(fs.existsSync(path.join(r.out, 'summary.json')) && JSON.parse(fs.readFileSync(path.join(r.out, 'summary.json'), 'utf8')).ok === true, '7.30 summary.json 落盘');
ok(['## 一、核查结论（引自 overhaul-safety-check）', '## 二、措施缺失项（缺失 / 建议完善）', '## 三、未判定项', '## 四、已有措施', '## 五、车间侧补充提示（非规则判定）', '## 六、整改建议'].every((h) => r.md.includes(h)), '7.31 六节结构齐全');
eq(r.j.meta.objectName, 'E-1201 检修方案', '7.32 --object 写入对象名');
ok(/【缺失（必须补充）】G-003 风险辨识与 JSA/.test(r.md) && /【未判定】UND-高处/.test(r.md), '7.33 整改建议按源级别逐条列出');
ok(/各专项措施最终仍以开工时逐票办理的作业票为准/.test(r.md) && /permit-precheck-bridge/.test(r.md), '7.34 整改建议末尾提示作业票为准并互指作业票预检');
ok(/承修单位（contractor）/.test(r.md) && /工期天数（duration_days）/.test(r.md), '7.35 源技能字段表含承修单位与工期');

// ============ 8. 检修分级口径 ============
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
r = runMrg(['--result', RES], 'rt-none');
eq(r.j.meta.repairType, null, '8.9 不传分级时为 null，不默认');
eq(r.s.counts.must_fix, 3, '8.10 分级参数不影响判定计数');

// ============ 9. 车间侧补充提示（非规则判定） ============
r = runMrg(['--result', RES, '--notes', NOTES], 'notes');
const notesSec = r.md.split('## 五、车间侧补充提示（非规则判定）')[1].split('## 六、')[0];
ok(/不参与上述合规判定，不影响源技能结论/.test(notesSec), '9.1 车间侧节声明不参与合规判定');
eq(r.j.workshopNotes.length, 4, '9.2 四个固定车间侧项');
eq(r.j.workshopNotes.find((x) => x.item === '设备交出条件').status, '已核实', '9.3 已核实状态原样');
eq(r.j.workshopNotes.find((x) => x.item === '同期交叉作业').status, '未核实', '9.4 未核实状态原样');
eq(r.j.workshopNotes.find((x) => x.item === '承包商资质').status, '不适用', '9.5 不适用状态原样');
eq(r.j.workshopNotes.find((x) => x.item === '备件与工机具到位').skill, '车间自查', '9.6 备件与工机具为车间自查项');
ok(/\*\*未核实\*\*/.test(notesSec) && /建议用 cross-operation-conflict 核对/.test(notesSec), '9.7 未核实项加粗并提示可接技能');
r = runMrg(['--result', RES], 'nonotes');
ok(r.j.workshopNotes.every((x) => x.status === '未核实'), '9.8 **不传 notes 时全部「未核实」，不替用户推测**');
ok(/待车间自查/.test(r.md), '9.9 车间自查项未核实时提示待自查');
r = runMrg(['--result', RES, '--notes', path.join(ex1, 'sample-workshop-notes-bad.json')], 'badnotes');
eq(r.s.ok, true, '9.10 状态不合法不中断');
eq(r.j.workshopNotes.find((x) => x.item === '设备交出条件').status, '未核实', '9.11 「应该够了」按未核实处理');
ok(r.s.warnings.some((w) => w.includes('应该够了') && w.includes('按「未核实」处理')), '9.12 状态不合法 warning');
const custom = r.j.workshopNotes.find((x) => x.item === '脚手架方案');
ok(custom && custom.status === '已核实' && custom.skill === '车间自查', '9.13 自定义车间项追加并标「车间自查」');
eq(r.j.workshopNotes.length, 5, '9.14 自定义项不覆盖固定四项');
r = runMrg(['--result', RES, '--notes', wj('notes-obj.json', { item: 'x' })], 'notesobj');
eq(r.s.ok, false, '9.15 notes 非数组报错');

// ============ 10. 源 summary 与 findings 不一致 → 只 warning 不改源数据 ============
r = runMrg(['--result', path.join(ex1, 'sample-overhaul-result-summary-mismatch.json')], 'mismatch');
eq(r.s.ok, true, '10.1 summary 不一致不中断');
ok(r.s.warnings.some((w) => w.includes('summary.must_fix=5') && w.includes('重新计数 3')), '10.2 **计数不一致 warning 指明两边数字**');
eq(r.s.counts.must_fix, 3, '10.3 报告按 findings 重算（3）');
eq(r.j.sourceSummary.must_fix, 5, '10.4 源 summary 原值 5 保留，未被改写');

// ============ 11. 未知级别、缺声明行、无 job_types ============
const odd = JSON.parse(JSON.stringify(src1));
odd.findings.push({ rule_id: 'X-999', severity: 'critical', name: '新级别', message: '源技能新增级别', detail: 'd', advice: null, basis: 'b', jobs: [] });
delete odd.disclaimer;
delete odd.job_types;
r = runMrg(['--result', wj('odd.json', odd)], 'odd');
eq(r.s.ok, true, '11.1 未知级别不中断');
eq(r.s.counts.other, 1, '11.2 未知级别单独计数');
ok(r.j.findings.some((f) => f.rule_id === 'X-999' && f.severity === 'critical'), '11.3 **未知级别原样保留，未被归到四级之一**');
ok(r.s.warnings.some((w) => w.includes('X-999') && w.includes('不在已知四级')), '11.4 未知级别 warning');
ok(/其它级别 1 项/.test(r.md) && /critical/.test(r.md), '11.5 md 单列其它级别');
ok(r.s.warnings.some((w) => w.includes('无 disclaimer')), '11.6 源技能无声明行 warning');
eq(r.j.meta.sourceDisclaimer, null, '11.7 无声明行时不伪造源声明');
ok(r.md.includes(DECL), '11.8 本技能声明行仍在');
eq(r.j.sourceMeta.jobTypes.length, 0, '11.9 源 result 无 job_types 时为空数组，不猜测');
ok(!/作业类型标签/.test(r.md), '11.10 无 job_types 时 md 不出现标签行');

// ============ 12. 无未判定 / 无缺失 ============
const clean = JSON.parse(JSON.stringify(src1));
clean.findings = clean.findings.filter((f) => f.severity === 'pass');
clean.summary = { must_fix: 0, should_improve: 0, undetermined: 0, pass: 4 };
r = runMrg(['--result', wj('clean.json', clean)], 'clean');
ok(!/【注意】未判定项/.test(r.md), '12.1 无未判定项时不出现【注意】提示');
ok(/无需补充项；方案仍须按程序经技术负责人审核与安全部门审批/.test(r.md), '12.2 无缺失项时仍提示须审批');
ok(/源技能结果中无缺失与建议完善项/.test(r.md), '12.3 缺失项节写明为空');

// ============ 13. 参数与输入校验 ============
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

// ============ 14. 文档口径（出现与不出现两个方向） ============
const skill = fs.readFileSync(path.join(ROOT, 'SKILL.md'), 'utf8');
ok(/安全措施核查/.test(skill) && /大检修/.test(skill) && /日常维修/.test(skill), '14.1 SKILL.md 用中石化检修分级与「安全措施核查」限定');
ok(!/检修方案审一下/.test(skill) && !/方案能不能报/.test(skill), '14.2 SKILL.md 触发词不再抢「检修方案审一下 / 方案能不能报」');
ok(/PDF 先用平台 pdf 技能转为 txt\/docx 再传入，脚本不读 PDF；扫描件需 OCR/.test(skill), '14.3 SKILL.md 含 PDF 前置步骤');
ok(/SKILL_PACK_ROOT/.test(skill) && /豆包/.test(skill), '14.4 SKILL.md 说明平台路径与 SKILL_PACK_ROOT');
ok(/merge-report\.js/.test(skill), '14.5 SKILL.md 操作步骤含 merge-report.js');
ok(/permit-precheck-bridge/.test(skill) && /repair-plan-assistant/.test(skill) && /completion-acceptance/.test(skill), '14.6 description 互指排除语齐全');
ok(/由其他岗位归口/.test(skill) && /方案批准/.test(skill), '14.7 SKILL.md 写明车间设备员可做与归口');
ok(/agent_created: true/.test(skill) && /allowed-tools:/.test(skill), '14.8 frontmatter 保留 agent_created 与 allowed-tools');
ok(skill.includes(DECL), '14.9 SKILL.md 声明行与脚本一致');
ok(/用火作业/.test(skill), '14.10 SKILL.md 用「用火作业」命名');
const rules = fs.readFileSync(path.join(ROOT, 'references', 'bridge-rules.md'), 'utf8');
ok(/检修方案/.test(rules) && /大检修/.test(rules) && /三查四定/.test(rules), '14.11 bridge-rules.md 写检修方案口径与大检修节点');
const other = path.join(ROOT, '..', 'permit-precheck-bridge', 'references', 'bridge-rules.md');
ok(!fs.existsSync(other) || fs.readFileSync(other, 'utf8') !== rules, '14.12 references 不再与 permit bridge 逐字重复');
const readme = fs.readFileSync(path.join(ROOT, 'scripts', 'README.md'), 'utf8');
ok(/merge-report\.js/.test(readme) && /tmpdir/.test(readme) && /--repair-type/.test(readme), '14.13 scripts/README 记录 merge-report、默认输出目录与 --repair-type');
ok(fs.existsSync(path.join(ROOT, 'references', 'input-spec.md')), '14.14 references/input-spec.md 存在');

console.log('\n' + '='.repeat(56));
console.log('overhaul-process-check-bridge 自测：' + pass + ' 通过，' + fail + ' 失败');
if (failures.length) { console.log('\n失败项：'); failures.forEach((f) => console.log('  ✗ ' + f)); }
console.log('='.repeat(56));
try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
