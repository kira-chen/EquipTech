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
  if (fs.existsSync(path.join(out, 'permit-precheck-bridge.md'))) md = fs.readFileSync(path.join(out, 'permit-precheck-bridge.md'), 'utf8');
  return { code: r.status, s, j, md, out };
}
const wj = (name, obj) => { const p = path.join(work, name); fs.writeFileSync(p, typeof obj === 'string' ? obj : JSON.stringify(obj), 'utf8'); return p; };
let r;

// ============ 1. 依赖存在时 ============
const fake = path.join(work, 'dep', 'scripts');
fs.mkdirSync(fake, { recursive: true });
fs.writeFileSync(path.join(fake, 'precheck.js'), '// stub');
section('BVT', () => {
  r = runChk(['--skill-root', path.join(work, 'dep')]);
  eq(r.s.ok, true, '1.1 检查脚本正常退出');
  eq(r.s.available, true, '1.2 依赖存在时 available=true');
  eq(r.s.dependency, 'work-permit-precheck', '1.3 依赖名正确');
  ok(r.s.script && r.s.script.endsWith('precheck.js'), '1.4 返回依赖脚本路径');
  ok(/不得改写任何判定项/.test(r.s.note), '1.5 note 提示不得改写判定');
});
section('B', () => {
  eq(r.s.docx2text, null, '1.6 依赖目录无 docx2text.js 时 docx2text 为 null（不猜路径）');
  fs.writeFileSync(path.join(fake, 'docx2text.js'), '// stub');
  r = runChk(['--skill-root', path.join(work, 'dep')]);
  ok(r.s.docx2text && r.s.docx2text.endsWith('docx2text.js'), '1.7 依赖目录有 docx2text.js 时返回其路径');
});

// ============ 2. 依赖不存在时（核心：必须终止而非降级） ============
section('A', () => {
  r = runChk(['--skill-root', path.join(work, '不存在的目录')]);
  eq(r.s.available, false, '2.1 依赖不存在时 available=false');
  eq(r.s.script, null, '2.2 无脚本路径');
  ok(/必须告知用户/.test(r.s.note), '2.3 note 要求告知用户');
  ok(/终止/.test(r.s.note), '2.4 note 要求终止');
  ok(/不得用本技能自行判定/.test(r.s.note), '2.5 note 禁止自行判定');
  ok(r.s.searched && r.s.searched.length >= 1, '2.6 列出搜索过的路径');
  ok(r.s.searched[0].includes('不存在'), '2.7 显式 --skill-root 时只查指定路径（不回退到默认位置）');
  eq(r.s.searched.length, 1, '2.8 显式 --skill-root 时候选路径只有一个');
});

// ============ 3. 落盘 ============
section('B', () => {
  const outDir = path.join(work, 'out');
  r = runChk(['--skill-root', path.join(work, 'dep'), '--out', outDir]);
  ok(fs.existsSync(path.join(outDir, 'dependency.json')), '3.1 dependency.json 落盘');
  const dj = JSON.parse(fs.readFileSync(path.join(outDir, 'dependency.json'), 'utf8'));
  eq(dj.available, true, '3.2 落盘内容正确');
  ok(/SKILL_PACK_ROOT/.test(dj.platformNote) && /豆包/.test(dj.platformNote), '3.3 平台说明含 SKILL_PACK_ROOT 与豆包');
});

// ============ 4. 参数校验 ============
section('B', () => {
  r = runChk(['--skill-root']);
  eq(r.s.ok, false, '4.1 缺值报错');
  ok(/缺少取值/.test(r.s.error), '4.2 缺值信息正确');
  r = runChk(['--未知', 'x']);
  eq(r.s.ok, false, '4.3 未知参数报错');
});

// ============ 5. 默认搜索路径与 SKILL_PACK_ROOT ============
section('A', () => {
  r = runChk([]);
  eq(r.s.ok, true, '5.1 无参数可运行');
  ok(Array.isArray(r.s.searched) && r.s.searched.length >= 4, '5.2 默认搜索多个候选路径');
  ok(r.s.searched.some((p) => p.includes('.workbuddy')) && r.s.searched.some((p) => p.includes('.claude')) && r.s.searched.some((p) => p.includes('.doubao')), '5.3 默认候选覆盖 WorkBuddy / Claude Code / 豆包三个平台目录');
});
section('B', () => {
  const packRoot = path.join(work, 'pack');
  fs.mkdirSync(path.join(packRoot, 'sub-pack', 'work-permit-precheck', 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(packRoot, 'sub-pack', 'work-permit-precheck', 'scripts', 'precheck.js'), '// stub');
  r = runChk([], { SKILL_PACK_ROOT: packRoot });
  eq(r.s.available, true, '5.4 SKILL_PACK_ROOT 指向技能包根目录时可命中');
  ok(r.s.root && r.s.root.startsWith(packRoot), '5.5 命中的是 SKILL_PACK_ROOT 下的依赖');
  eq(r.s.envSkillPackRoot, packRoot, '5.6 结果回显 SKILL_PACK_ROOT');
  // 目录名被平台改名（无全角括号）时一级子目录扫描兜底
  const packRoot2 = path.join(work, 'pack2');
  fs.mkdirSync(path.join(packRoot2, 'renamed-dir', 'work-permit-precheck', 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(packRoot2, 'renamed-dir', 'work-permit-precheck', 'scripts', 'precheck.js'), '// stub');
  r = runChk([], { SKILL_PACK_ROOT: packRoot2 });
  eq(r.s.available, true, '5.7 技能包子目录被改名时一级扫描仍能命中');
  // 第三方平台：本技能与依赖技能并排装在同一个技能目录下（不是三个默认平台目录，也没设 SKILL_PACK_ROOT）
  const plat = path.join(work, 'plat');
  const platSelf = path.join(plat, 'skills', 'permit-precheck-bridge', 'scripts');
  fs.mkdirSync(path.join(platSelf, 'lib'), { recursive: true });
  fs.copyFileSync(CHK, path.join(platSelf, 'check-dependency.js'));
  fs.copyFileSync(path.join(__dirname, 'lib', 'common.js'), path.join(platSelf, 'lib', 'common.js'));
  fs.mkdirSync(path.join(plat, 'skills', 'work-permit-precheck', 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(plat, 'skills', 'work-permit-precheck', 'scripts', 'precheck.js'), '// stub');
  fs.mkdirSync(path.join(plat, 'home'), { recursive: true });
  const platEnv = { ...process.env, HOME: path.join(plat, 'home'), USERPROFILE: path.join(plat, 'home') };
  delete platEnv.SKILL_PACK_ROOT;
  let pr = spawnSync(process.execPath, [path.join(platSelf, 'check-dependency.js')], { encoding: 'utf8', env: platEnv });
  let ps; try { ps = JSON.parse(pr.stdout.trim().split('\n').pop()); } catch (e) { ps = {}; }
  eq(ps.available, true, '5.8 与依赖技能并排安装在同一技能目录时可命中');
  eq(ps.root && fs.realpathSync(ps.root), fs.realpathSync(path.join(plat, 'skills', 'work-permit-precheck')), '5.9 命中的是同级目录下的依赖技能');
  // 同级目录里只有本技能、没有依赖时仍判不可用
  fs.renameSync(path.join(plat, 'skills', 'work-permit-precheck'), path.join(plat, 'moved-away'));
  pr = spawnSync(process.execPath, [path.join(platSelf, 'check-dependency.js')], { encoding: 'utf8', env: platEnv });
  try { ps = JSON.parse(pr.stdout.trim().split('\n').pop()); } catch (e) { ps = {}; }
  eq(ps.available, false, '5.10 同级目录没有依赖技能时判不可用');
});

// ============ 6. make-sample 可再生 ============
const ex1 = path.join(work, 'ex1');
let m = spawnSync(process.execPath, [MKS, '--out', ex1], { encoding: 'utf8' });
let ms = JSON.parse(m.stdout.trim().split('\n').pop());
const src1 = JSON.parse(fs.readFileSync(path.join(ex1, 'sample-permit-result.json'), 'utf8'));
section('B', () => {
  eq(ms.ok, true, '6.1 make-sample 运行成功');
  ok(['sample-permit-result.json', 'sample-permit-result-summary-mismatch.json', 'sample-permit-result-unknown-type.json', 'sample-workshop-notes.json', 'sample-workshop-notes-bad.json'].every((f) => ms.files.includes(f)), '6.2 五份 JSON 样例齐全');
});
section('C', () => {
  const ex7 = path.join(work, 'ex7');
  m = spawnSync(process.execPath, [MKS, '--out', ex7, '--seed', '7'], { encoding: 'utf8' });
  const ms7 = JSON.parse(m.stdout.trim().split('\n').pop());
  ok(ms7.permitNo !== ms.permitNo, '6.3 seed 改变票号');
  const src7 = JSON.parse(fs.readFileSync(path.join(ex7, 'sample-permit-result.json'), 'utf8'));
  eq(JSON.stringify(src7.summary), JSON.stringify(src1.summary), '6.4 seed 改变数值但四项计数不变');
  ok(Array.isArray(src1.findings) && src1.disclaimer, '6.5 样例结构与源技能 result.json 一致（findings + disclaimer）');
});

// ============ 7. 【核心】源技能 JSON → 合并报告不改写判定 ============
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
  eq(JSON.stringify(r.j.findings), JSON.stringify(src1.findings), '7.6 **findings 逐条深拷贝，与源技能一字不差**');
  ok(r.j.findings !== src1.findings && r.j.findings.every((f, i) => f.rule_id === src1.findings[i].rule_id && f.severity === src1.findings[i].severity), '7.7 顺序与级别均未重排');
  eq(r.j.meta.sourceDisclaimer, src1.disclaimer, '7.8 源技能声明行原文保留在 bridge.json');
  eq(r.j.meta.declaration, DECL, '7.9 本技能声明行固化在 bridge.json');
  ok(r.md.includes(src1.disclaimer), '7.10 **md 含源技能声明行原文**');
  ok(r.md.includes(DECL), '7.11 **md 含本技能声明行原文**');
  ok(r.md.indexOf(src1.disclaimer) < r.md.indexOf(DECL), '7.12 源技能声明行在前，本技能声明行追加在后');
  for (const f of src1.findings.filter((x) => x.severity !== 'pass')) ok(r.md.includes(f.message) && r.md.includes(f.detail), `7.13 ${f.rule_id} 的 message 与 detail 原文出现在 md`);
  ok(/受限空间内动火，未关联受限空间作业票/.test(r.md), '7.14 源技能票面原词「动火」照搬，未被改写为「用火」');
  ok(/## 三、未判定项/.test(r.md) && /HW-003/.test(r.md.split('## 三、未判定项')[1].split('## 四、')[0]), '7.15 未判定项单列一节且含规则号');
  ok(/【未判定】/.test(r.md) && /不改写为符合或不符合/.test(r.md), '7.16 未判定项说明保持未判定、不改写');
  ok(/【注意】未判定项既不代表符合，也不代表不符合/.test(r.md), '7.17 有未判定项时结论段出现【注意】提示');
  ok(/## 二、不符合项/.test(r.md) && /逐条照搬源技能结果，未合并、未归类、未调整级别/.test(r.md), '7.18 不符合项节声明逐条照搬');
  ok(/以下内容原文引自源技能判定结果，本技能未做任何改写/.test(r.md), '7.19 结论段声明未改写');
  eq(r.j.sourceMeta.type, '动火', '7.20 源技能 type 原值保留');
  eq(r.j.sourceMeta.permitCategory, '用火作业', '7.21 **加注作业许可八大类「用火作业」（不改源值）**');
});
section('B', () => {
  ok(/作业许可八大类（本技能加注） \| 用火作业/.test(r.md), '7.22 md 源技能字段表显示八大类名称');
  ok(/作业类型（type，票面原词） \| 动火/.test(r.md), '7.23 md 同时保留票面原词');
  ok(/## 四、通过项/.test(r.md) && /G-001/.test(r.md), '7.24 通过项也逐条列出');
  ok(/## 附：源技能抽取说明（原文）/.test(r.md) && /in_confined_space/.test(r.md), '7.25 源技能抽取说明原文附在报告');
  eq(r.j.extractionNotes.length, 2, '7.26 extraction_notes 转入 bridge.json');
  eq(r.j.sourceSummary.must_fix, 3, '7.27 源 summary 原值保留');
});
section('C', () => {
  ok(!EMOJI.test(r.md), '7.28 md 不含 emoji');
});
section('A', () => {
  ok(/<!-- ANALYSIS_START -->/.test(r.md) && /<!-- ANALYSIS_END -->/.test(r.md), '7.29 分析段占位符存在');
  ok(/不得复述或改写判定结论/.test(r.md.split('<!-- ANALYSIS_START -->')[1]), '7.30 分析段占位提示不得改写结论');
  ok(fs.existsSync(path.join(r.out, 'summary.json')) && JSON.parse(fs.readFileSync(path.join(r.out, 'summary.json'), 'utf8')).ok === true, '7.31 summary.json 落盘');
  ok(['## 一、预检结论（引自 work-permit-precheck）', '## 二、不符合项', '## 三、未判定项', '## 四、通过项', '## 五、车间侧补充提示（非规则判定）', '## 六、整改建议'].every((h) => r.md.includes(h)), '7.32 六节结构齐全');
});
section('B', () => {
  eq(r.j.meta.objectName, '一级用火票', '7.33 --object 写入对象名');
});
section('A', () => {
  ok(/## 六、整改建议/.test(r.md) && /【必须整改】G-011/.test(r.md) && /【未判定】HW-003/.test(r.md), '7.34 整改建议按源级别逐条列出');
});

// ============ 8. 车间侧补充提示（非规则判定） ============
{
  let notesSec;
  section('A', () => {
    notesSec = r.md.split('## 五、车间侧补充提示（非规则判定）')[1].split('## 六、')[0];
    ok(/不参与上述合规判定，不影响源技能结论/.test(notesSec), '8.1 车间侧节声明不参与合规判定');
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

// ============ 9. 源 summary 与 findings 不一致 → 只 warning 不改源数据 ============
section('A', () => {
  r = runMrg(['--result', path.join(ex1, 'sample-permit-result-summary-mismatch.json')], 'mismatch');
  eq(r.s.ok, true, '9.1 summary 不一致不中断');
  ok(r.s.warnings.some((w) => w.includes('summary.should_improve=5') && w.includes('重新计数 2')), '9.2 **计数不一致 warning 指明两边数字**');
  eq(r.s.counts.should_improve, 2, '9.3 报告按 findings 重算（2）');
  eq(r.j.sourceSummary.should_improve, 5, '9.4 源 summary 原值 5 保留在 bridge.json，未被改写');
});

// ============ 10. 源 type 不在八大类 → warning，原值照搬 ============
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
  odd.findings.push({ rule_id: 'X-999', severity: 'critical', message: '源技能新增级别', detail: 'd', basis: 'b' });
  delete odd.disclaimer;
  r = runMrg(['--result', wj('odd.json', odd)], 'odd');
  eq(r.s.ok, true, '11.1 未知级别不中断');
  eq(r.s.counts.other, 1, '11.2 未知级别单独计数');
  ok(r.j.findings.some((f) => f.rule_id === 'X-999' && f.severity === 'critical'), '11.3 **未知级别原样保留，未被归到四级之一**');
  ok(r.s.warnings.some((w) => w.includes('X-999') && w.includes('不在已知四级')), '11.4 未知级别 warning');
  ok(/其它级别 1 项/.test(r.md) && /critical/.test(r.md), '11.5 md 单列其它级别');
  ok(r.s.warnings.some((w) => w.includes('无 disclaimer')), '11.6 源技能无声明行 warning');
  eq(r.j.meta.sourceDisclaimer, null, '11.7 无声明行时不伪造源声明');
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
  ok(/源技能结果中无必须整改与建议完善项/.test(r.md), '12.3 不符合项节写明为空');
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
  ok(/SKILL_PACK_ROOT/.test(skill) && /豆包/.test(skill), '14.4 SKILL.md 说明平台路径与 SKILL_PACK_ROOT');
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
});

console.log('\n' + '='.repeat(56));
console.log('permit-precheck-bridge 自测：' + pass + ' 通过，' + fail + ' 失败');
console.log(`用例级别 ${LEVELS[RUN_LEVEL]}：BVT ${byLevel.BVT}，A ${byLevel.A}，B ${byLevel.B}，C ${byLevel.C}`);
if (failures.length) { console.log('\n失败项：'); failures.forEach((f) => console.log('  ✗ ' + f)); }
console.log('='.repeat(56));
try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
