#!/usr/bin/env node
'use strict';
/** 自测：断言 plan.js 与 rules.js 行为。用法：node scripts/selftest.js（全绿退出 0） */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const lite = require('./lib/docx-lite');
const R = require('./lib/rules');

const PLAN = path.join(__dirname, 'plan.js');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rpa-selftest-'));
let pass = 0, fail = 0;
const failures = [];
const ok = (c, n) => { if (c) pass++; else { fail++; failures.push(n); } };
const eq = (a, e, n) => ok(a === e, `${n}（期望 ${JSON.stringify(e)}，实际 ${JSON.stringify(a)}）`);

function run(args, tag) {
  const out = path.join(work, tag + '-out');
  const r = spawnSync(process.execPath, [PLAN, ...args, '--out', out], { encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  let s; try { s = JSON.parse(lines[lines.length - 1]); } catch (e) { s = { ok: false, error: 'no-json:' + r.stdout + r.stderr }; }
  let j = null, md = null;
  if (fs.existsSync(path.join(out, 'plan.json'))) j = JSON.parse(fs.readFileSync(path.join(out, 'plan.json'), 'utf8'));
  if (fs.existsSync(path.join(out, 'plan.md'))) md = fs.readFileSync(path.join(out, 'plan.md'), 'utf8');
  return { code: r.status, s, j, md, out };
}
const wr = (n, text) => { const p = path.join(work, n); fs.writeFileSync(p, text, 'utf8'); return p; };
const stepOf = (j, id) => j.steps.find((x) => x.stepId === id) || {};
const hasStep = (j, id) => j.steps.some((x) => x.stepId === id);
const qcOf = (j, id) => j.qcPoints.find((x) => x.qcId === id) || {};
const acOf = (j, id) => j.acceptance.find((x) => x.acId === id) || {};
/** 方案全文中除脚注/规程引用外不得出现裸数值单位（力矩/间隙等） */
const NUMERIC_UNIT = /\d+(\.\d+)?\s*(N·m|N\.m|Nm|MPa|mm\/s|mm(?![a-zA-Z])|μm)/;

// 样例规程（含四类数值 + 1 处对中冲突）
const SPEC_FULL = wr('spec-full.md', [
  '某厂离心泵检修规程（样例）',
  '3.1 泵盖螺栓紧固力矩按 180 N·m 执行。',
  '3.2 叶轮口环配合间隙允许值 0.35 mm。',
  '3.3 泵轴径向跳动公差不大于 0.05 mm。',
  '4.1 联轴器对中径向偏差不大于 0.08 mm。',
  '4.2 一般情况下对中径向偏差按 0.12 mm 控制。',
  '5.1 严密性试验压力 1.5 MPa，保压 30 分钟。',
  '5.2 振动烈度不大于 4.5 mm/s，轴承温度不高于 75 ℃。',
].join('\n'));
// 只含力矩一类数值
const SPEC_PART = wr('spec-part.md', ['某厂紧固规定（样例）', '2.1 法兰螺栓紧固力矩按 220 N·m 控制。', '2.2 其余要求见各专业规程。'].join('\n'));
// 无任何数值的规程
const SPEC_NONUM = wr('spec-nonum.md', ['某厂检修管理规定', '第一条 检修须按方案实施。', '第二条 数据须如实记录。'].join('\n'));
// docx 规程
const SPEC_DOCX = path.join(work, 'spec.docx');
fs.writeFileSync(SPEC_DOCX, lite.buildDocx(fs.readFileSync(SPEC_FULL, 'utf8').split('\n')
  .map((t) => lite.pXml(lite.runXml(t))).join('')));

// ============ A. 规则引擎：设备类型归类与覆盖范围 ============
eq(R.classifyEquip('离心泵', ''), 'pump', 'A1 离心泵→pump');
eq(R.classifyEquip('往复泵', ''), 'pump', 'A2 往复泵→pump');
eq(R.classifyEquip('往复式压缩机', ''), 'rotating', 'A3 压缩机→rotating');
eq(R.classifyEquip('离心式压缩机组', ''), 'rotating', 'A4 机组→rotating');
eq(R.classifyEquip('管壳式换热器', ''), 'static', 'A5 换热器→static');
eq(R.classifyEquip('填料塔', ''), 'static', 'A6 塔器→static');
eq(R.classifyEquip('卧式储罐', ''), 'static', 'A7 容器→static');
eq(R.classifyEquip('闸阀', ''), 'valve', 'A8 阀门→valve');
eq(R.classifyEquip('弹簧式安全阀', ''), 'valve', 'A9 安全阀→valve');
eq(R.classifyEquip('高压电机', ''), 'electrical', 'A10 电机→electrical');
eq(R.classifyEquip('变频器', ''), 'electrical', 'A11 变频器→electrical');
eq(R.classifyEquip('离心机', ''), 'generic', 'A12 覆盖范围外（离心机）→generic');
eq(R.classifyEquip('工业炉燃烧器', ''), 'furnace', 'A12b 加热炉/燃烧器→furnace（新增覆盖）');
eq(R.classifyEquip('空冷器', ''), 'aircooler', 'A12c 空冷器→aircooler（先于静设备）');
eq(R.classifyEquip('压力变送器', ''), 'instrument', 'A12d 变送器→instrument');
eq(R.classifyEquip('气动调节阀', ''), 'instrument', 'A12e 调节阀归仪表回路，不归阀门');
eq(R.classifyEquip('弹簧式安全阀', ''), 'valve', 'A12f 安全阀仍归阀门');
eq(R.classifyEquip('起重机械', '机泵区检修单梁起重机'), 'generic', 'A12g 起重机械不因名称里的「机泵区」误归泵类');
eq(R.classifyEquip('起重机械', '压缩机厂房桥式起重机'), 'generic', 'A12h 起重机械不因名称里的「压缩机厂房」误归机组类');
eq(R.classifyEquip('电机', '循环水泵电机'), 'electrical', 'A13 类型字段优先于名称');
eq(R.classifyEquip('', '循环水泵电机'), 'pump', 'A14 仅名称时按命中顺序');
ok(R.COVERED.length === 8 && !R.COVERED.includes('generic') && ['furnace', 'aircooler', 'instrument'].every((k) => R.COVERED.includes(k)), 'A15 覆盖范围为八类（含加热炉/空冷器/仪表回路）且不含 generic');

// ============ B. 规则引擎：三态与解体判定 ============
eq(R.tri(''), null, 'B1 空→null，不默认 false');
eq(R.tri('是'), true, 'B2 是→true');
eq(R.tri('否'), false, 'B3 否→false');
eq(R.tri('说不好'), null, 'B4 无法识别→null');
eq(R.isDismantle('机械密封解体更换'), true, 'B5 解体识别');
eq(R.isDismantle('管束抽芯清洗'), true, 'B6 抽芯按解体');
eq(R.isDismantle('外观检查'), false, 'B7 非解体识别');
eq(R.isDismantle('例行处理'), null, 'B8 说不清→null，不默认不解体');
eq(R.isDismantle(''), null, 'B9 空检修内容→null');
eq(R.classifyLevel('机械密封更换（小修）', ''), 'routine', 'B10 旧口径「小修」归日常维修');
eq(R.classifyLevel('气缸解体检修（大修）', ''), 'overhaul', 'B11 旧口径「大修」归大检修');
eq(R.classifyLevel('', '大检修'), 'overhaul', 'B11a 大检修识别');
eq(R.classifyLevel('', '日常维修'), 'routine', 'B11b 日常维修识别');
eq(R.classifyLevel('机封泄漏抢修', ''), 'emergency', 'B11c 抢修识别');
eq(R.classifyLevel('', '专项'), 'special', 'B11d 专项识别');
eq(R.classifyLevel('', 'minor'), 'routine', 'B11e 旧键 minor 作别名归日常维修');
eq(R.LEVEL_CN.overhaul, '大检修（停工检修）', 'B11f 分级中文为中石化口径');
eq(R.classifyLevel('例行处理', ''), null, 'B12 等级识别不出→null');

// ============ C. 硬约束 1（核心）：数值只引用规程原文，无出处一律「待查规程确认」 ============
const PUMP = ['--equip-type', '离心泵', '--tag', 'P-9101A', '--scope', '机械密封解体更换（小修）'];
let r = run([...PUMP, '--spec', SPEC_FULL, '--duration', '3', '--start', '2026-09-25'], 'c-spec');
eq(r.s.ok, true, 'C1 有规程时运行成功');
eq(stepOf(r.j, 'G8').valueSource, 'spec', 'C2 力矩步骤取到规程出处');
ok(String(stepOf(r.j, 'G8').valueText).includes('180'), 'C3 力矩值为规程原文摘录');
ok(String(stepOf(r.j, 'G8').valueCitation).includes('spec-full.md'), 'C4 力矩值注明出处文件');
ok(/第 \d+ 行/.test(String(stepOf(r.j, 'G8').valueCitation)), 'C5 出处精确到行号');
eq(stepOf(r.j, 'PU5').valueSource, 'spec', 'C6 间隙步骤取到规程出处');
eq(stepOf(r.j, 'PU11').valueSource, 'spec', 'C7 对中步骤取到规程出处');
eq(stepOf(r.j, 'PU12').valueSource, 'spec', 'C8 试压步骤取到规程出处');
// 未在规程中出现的数值类型（动平衡）→ 必须 TBC
eq(stepOf(r.j, 'PU9').valueSource, 'tbc', 'C9 规程未提供动平衡等级→待查规程确认');
eq(stepOf(r.j, 'PU9').valueText.includes(R.TBC), true, 'C10 TBC 步骤写明「待查规程确认」');
eq(stepOf(r.j, 'PU9').valueCitation, null, 'C11 TBC 步骤无出处');
ok(r.j.toBeConfirmed.some((t) => t.stepId === 'PU9'), 'C12 无出处数值进 toBeConfirmed');
ok(r.j.toBeConfirmed.every((t) => t.reason && t.action && t.valueKindCn), 'C13 每条待确认注明原因、措施与数值类型');
ok(r.j.warnings.some((w) => w.includes('须由技术人员逐条核对')), 'C13a 有引用时 warning 提示核对引用条款是否对应该步骤部位');
ok(/原文摘录/.test(r.md) && /不做换算/.test(r.md), 'C13b md 说明引用为原文摘录且不做换算');
// 完全无规程 → 全部数值 TBC，一个都不得有出处
r = run(['--equip-type', '往复式压缩机', '--tag', 'C-9201', '--scope', '气缸解体检修（大修）', '--duration', '15'], 'c-nospec');
eq(r.s.ok, true, 'C14 无规程时仍可运行');
eq(r.j.counts.valueCited, 0, 'C15 无规程时无任何数值有出处');
ok(r.j.steps.filter((x) => x.valueKind).every((x) => x.valueSource === 'tbc'), 'C16 无规程时全部数值步骤标 TBC');
ok(r.j.qcPoints.filter((x) => x.valueKind).every((x) => x.standard === R.TBC), 'C17 无规程时质控点标准全为 TBC');
ok(r.j.acceptance.filter((x) => x.valueKind).every((x) => x.criterion === R.TBC), 'C18 无规程时验收判据全为 TBC');
ok(r.j.counts.toBeConfirmed > 0, 'C19 无规程时 toBeConfirmed 非空');
ok(r.j.warnings.some((w) => w.includes('待查规程确认')), 'C20 无规程时 warning 点明待查规程确认');
ok(r.j.warnings.some((w) => w.includes('不得凭经验')), 'C21 warning 点明不得凭经验填写');
// 全文不得出现脚本自造的数值单位
const bodyNoSpec = r.md.replace(/^\|\s*\d+\s*\|.*量程.*$/gm, '');
ok(!NUMERIC_UNIT.test(bodyNoSpec), 'C22 无规程时方案全文不出现任何力矩/间隙/压力数值');
ok(!/\d+\s*N·m/.test(r.md), 'C23 无规程时不出现任何力矩数值');
ok(!/\d+(\.\d+)?\s*MPa/.test(r.md), 'C24 无规程时不出现任何压力数值');
// 规程内无数字的说明性文字不得被当作数值出处
r = run([...PUMP, '--spec', SPEC_NONUM], 'c-nonum');
eq(r.j.counts.valueCited, 0, 'C25 规程无数字时不误引为数值出处');
ok(r.j.toBeConfirmed.some((t) => t.reason.includes('未找到')), 'C26 有规程但未命中时原因写明未找到');
// 部分命中：只有力矩有出处，其余仍 TBC
r = run(['--equip-type', '管壳式换热器', '--tag', 'E-9301', '--scope', '管束抽芯清洗', '--spec', SPEC_PART], 'c-part');
eq(stepOf(r.j, 'ST11').valueSource, 'spec', 'C27 部分规程命中力矩');
eq(stepOf(r.j, 'ST12').valueSource, 'tbc', 'C28 部分规程未给试压值→TBC');
eq(stepOf(r.j, 'ST6').valueSource, 'tbc', 'C29 部分规程未给壁厚公差→TBC');

// ============ D. 硬约束 2：覆盖范围外 → 只出通用框架 + warning + 待技术人员补充 ============
r = run(['--equip-type', '离心机', '--tag', 'X-9401', '--scope', '转鼓更换', '--duration', '2'], 'd-uncov');
eq(r.s.ok, true, 'D1 覆盖范围外仍可运行');
eq(r.j.meta.covered, false, 'D2 covered=false');
eq(r.j.meta.equipKey, 'generic', 'D3 归类为 generic');
ok(r.j.steps.every((x) => /^G\d+$/.test(x.stepId)), 'D4 只输出通用框架 G 系列步骤');
ok(!r.j.steps.some((x) => /^(PU|RO|ST|VA|EL|FU|AC|IN)/.test(x.stepId)), 'D5 不含任何专业拆装步骤');
ok(r.j.warnings.some((w) => w.includes('不在本技能覆盖范围')), 'D6 warning 点明不在覆盖范围');
ok(r.j.warnings.some((w) => w.includes('不得凭通用知识填充')), 'D7 warning 点明不得凭通用知识填充');
ok(/待技术人员补充/.test(r.md), 'D8 md 标注待技术人员补充');
ok(/【注意】\*\*设备类型.*不在本技能覆盖范围/.test(r.md), 'D9 md 开头有覆盖范围外醒目提示（【注意】，不用 emoji）');
ok(/### 8.4 待技术人员补充的内容/.test(r.md), 'D10 md 单列待补充章节');
ok(r.j.steps.every((x) => x.note.includes('待技术人员补充')), 'D11 每条步骤注明待技术人员补充');
ok(r.j.qcPoints.every((x) => x.item.includes('待技术人员补充')), 'D12 质控点注明待技术人员补充');
eq(acOf(r.j, 'AC-GEN1').acId, 'AC-GEN1', 'D13 验收项退化为通用待补充项');
ok(!NUMERIC_UNIT.test(r.md), 'D14 覆盖范围外方案全文不出现任何具体数值');
ok(r.j.counts.toBeConfirmed > 0, 'D15 覆盖范围外的通用数值项仍列入待确认');
ok(r.j.warnings.some((w) => w.includes('不在本技能覆盖范围') && ['泵类', '机组类', '静设备', '阀门', '电气', '加热炉', '空冷器', '仪表回路'].every((k) => w.includes(k))), 'D16 覆盖范围外 warning 列全八类覆盖范围（含加热炉/空冷器/仪表回路）');

// ============ E. 硬约束 3：规程与通用口径冲突 → 以厂内规程为准 + conflicts 单列 ============
r = run([...PUMP, '--spec', SPEC_FULL], 'e-conf');
ok(r.j.conflicts.length >= 1, 'E1 检出规程内数值表述冲突');
const cf = r.j.conflicts.find((c) => c.valueKind === 'alignment') || {};
eq(cf.valueKindCn, '对中偏差', 'E2 冲突点标明数值类型');
ok(cf.a && cf.b && cf.a.quote && cf.b.quote, 'E3 冲突两侧均给出原文');
ok(cf.a.line && cf.b.line && cf.a.line !== cf.b.line, 'E4 冲突两侧均给出行号且不同');
eq(cf.b.general, true, 'E5 「一般情况下」识别为通用口径表述');
eq(cf.a.general, false, 'E6 厂内规程条款未误判为通用口径');
ok(r.j.warnings.some((w) => w.includes('一律以厂内规程为准')), 'E7 warning 点明以厂内规程为准');
ok(/\*\*一律以厂内规程为准\*\*/.test(r.md), 'E8 md 冲突表处理口径写明以厂内规程为准');
ok(/### 8.2 厂内规程与通用口径冲突点/.test(r.md), 'E9 md 冲突点单列一节');
ok(/不得任选其一/.test(r.md), 'E10 md 说明冲突未确认前不得任选其一');
// 无冲突时不虚报
r = run([...PUMP, '--spec', SPEC_PART], 'e-noconf');
eq(r.j.counts.conflicts, 0, 'E11 规程内无矛盾时冲突数为 0');
ok(/未检出规程内数值表述不一致/.test(r.md), 'E12 无冲突时 md 明确写无');
// 缺陷复现：行首条款编号被当数字，「1.1 口环间隙 0.30」与「1.2 轴承游隙 0.30」分两行写即误报冲突
const SL = (...ts) => ts.map((text, i) => ({ line: i + 1, text }));
eq(R.detectConflicts(SL('1.1 口环间隙 0.30 mm。', '1.2 轴承游隙 0.30 mm。'), 'clearance').length, 0, 'E13 条款编号不参与比数：同值分两行不报冲突');
eq(R.detectConflicts(SL('4.1 联轴器对中径向偏差不大于 0.05 mm。', '6.2 复查时对中径向偏差不大于 0.05 mm。'), 'alignment').length, 0, 'E14 同一参数同值、条款号不同不报冲突');
r = run([...PUMP, '--spec', wr('spec-two-lines.md', '# P-2101A 检修规程\n\n1.1 口环间隙 0.30~0.45 mm。\n1.2 轴承游隙 0.30 mm。\n')], 'e-twolines');
eq(r.j.counts.conflicts, 0, 'E15 口环间隙与轴承游隙是不同参数，分两行写不报冲突');
ok(/未检出规程内数值表述不一致/.test(r.md), 'E16 该规程 md 冲突节写无');
// 不同参数不比：关键词不同且名称互不包含；同关键词但前缀无共同二字词
eq(R.detectConflicts(SL('1.1 轴承间隙 0.10 mm。', '1.2 口环间隙 0.30 mm。'), 'clearance').length, 0, 'E17 轴承间隙与口环间隙不同参数不报冲突');
// 同一参数不同值仍报（不因去条款号而漏报）
const c18 = R.detectConflicts(SL('2.1 叶轮口环间隙 0.30~0.45 mm。', '5.3 口环间隙按 0.40~0.60 mm 控制。'), 'clearance');
ok(c18.length === 1 && /^2\.1 /.test(c18[0].a.quote) && /^5\.3 /.test(c18[0].b.quote), 'E18 同一参数不同值仍报冲突，原文保留条款号');
eq(R.detectConflicts(SL('1.2 叶轮口环配合间隙 0.35 mm。', '3.4 口环间隙 0.40 mm。'), 'clearance').length, 1, 'E19 名称不完全相同但共享「口环」的同类间隙仍报冲突');
eq(R.detectConflicts(SL('3.1 试运轴承振动烈度不大于 2.8 mm/s。', '3.2 一般情况下振动烈度按 4.5 mm/s 控制。'), 'vibration').length, 1, 'E20 厂内值与「一般情况下」通用值仍报冲突');
eq(R.detectConflicts(SL('5.2 振动烈度不大于 4.5 mm/s，轴承温度不高于 75 ℃。', '6.1 轴承温度不高于 80 ℃。'), 'vibration').length, 1, 'E21 一行多参数时按其中任一同名参数比对');
// matchSpec：只有条款编号这一个数字的说明性条款不作为数值出处
const m22 = R.matchSpec(SL('3.1 联轴器对中应在冷态下进行。', '3.2 对中径向偏差不大于 0.05 mm。'), 'alignment');
ok(m22 && m22.line === 2 && m22.quote === '3.2 对中径向偏差不大于 0.05 mm。', 'E22 条款号不算数值：说明性条款不作数值出处，取下一条含数值的原文');
eq(R.matchSpec(SL('3.1 联轴器对中应在冷态下进行。'), 'alignment'), null, 'E23 只有条款号无数值时不引用，按待查规程确认');
// stripClauseNo：只去行首条款编号，不动数值
const SCN = typeof R.stripClauseNo === 'function' ? R.stripClauseNo : () => null;
eq(SCN('1.1 口环间隙 0.30 mm'), '口环间隙 0.30 mm', 'E24 去「1.1 」');
eq(SCN('第4.2条 对中偏差 0.05 mm'), '对中偏差 0.05 mm', 'E25 去「第4.2条」');
eq(SCN('（3）轴承温度 75 ℃'), '轴承温度 75 ℃', 'E26 去「（3）」');
eq(SCN('180 N·m 为泵盖螺栓力矩'), '180 N·m 为泵盖螺栓力矩', 'E27 行首是数值+单位时不当条款号去掉');
eq(SCN('2.1联轴器对中 0.05 mm'), '联轴器对中 0.05 mm', 'E28 条款号后无空格也能去');
eq(SCN('| 1.1 | 口环间隙 | 0.30 mm |'), '口环间隙 | 0.30 mm |', 'E29 表格行首单元格条款号也去掉');
// 行首「数值 + 中文单位」是数值不是条款号，不能删掉（否则厂内数值被判缺失）
eq(SCN('0.30 毫米为口环间隙上限'), '0.30 毫米为口环间隙上限', 'E30 「0.30 毫米」不当条款号');
eq(SCN('3 个月更换一次'), '3 个月更换一次', 'E31 「3 个月」不当条款号');
eq(SCN('2.5 级精度'), '2.5 级精度', 'E32 「2.5 级」不当条款号');
eq(SCN('4.2 级别要求'), '级别要求', 'E33 以单位字开头的普通词（级别）前仍按条款号去掉');
ok(!!R.matchSpec(SL('0.30 毫米为口环间隙上限'), 'clearance'), 'E34 「0.30 毫米为口环间隙上限」仍能作为间隙数值出处');

// ============ F. 未判定：是否解体缺失不得默认 ============
r = run(['--equip-type', '管壳式换热器', '--tag', 'E-9302', '--scope', '例行处理'], 'f-undet');
eq(r.s.ok, true, 'F1 是否解体不明仍可运行');
eq(r.j.meta.dismantle, null, 'F2 是否解体为 null，不默认 false');
ok(r.j.counts.stepsUndetermined > 0, 'F3 存在未判定步骤');
eq(stepOf(r.j, 'G5').status, 'undetermined', 'F4 解体前记录步骤标未判定');
eq(stepOf(r.j, 'ST3').status, 'undetermined', 'F5 开盖步骤标未判定');
ok(String(stepOf(r.j, 'G5').missing).includes('解体'), 'F6 未判定注明缺失依据');
ok(r.j.undetermined.length === r.j.steps.filter((x) => x.status === 'undetermined').length, 'F7 未判定项全部单列');
ok(/### 8.3 未判定的作业步骤/.test(r.md), 'F8 md 未判定步骤单列一节');
ok(/不得按「不需要」删除/.test(r.md), 'F9 md 写明不得按不需要删除');
ok(r.j.warnings.some((w) => w.includes('不按「不解体」处理')), 'F10 warning 点明不按不解体处理');
eq(/\*\*未判定\*\*/.test(r.md), true, 'F11 md 概况中是否解体标未判定');
// 明确非解体 → 相关步骤不生成，也不进未判定
r = run(['--equip-type', '管壳式换热器', '--tag', 'E-9303', '--scope', '外观检查', '--dismantle', '否'], 'f-nodis');
eq(r.j.meta.dismantle, false, 'F12 显式指定不解体');
ok(!hasStep(r.j, 'ST3'), 'F13 不解体时不生成开盖步骤');
eq(r.j.counts.stepsUndetermined, 0, 'F14 依据明确时无未判定');
// 显式解体覆盖文本判定
r = run(['--equip-type', '管壳式换热器', '--tag', 'E-9304', '--scope', '例行处理', '--dismantle', '是'], 'f-dis');
eq(r.j.meta.dismantle, true, 'F15 --dismantle 是 覆盖文本判定');
ok(hasStep(r.j, 'ST4'), 'F16 解体时生成抽芯步骤');
// 无法识别的 --dismantle → warning 并回落文本判定
r = run(['--equip-type', '离心泵', '--tag', 'P-9102', '--scope', '机械密封解体更换', '--dismantle', '说不清'], 'f-bad');
ok(r.j.warnings.some((w) => w.includes('无法识别')), 'F17 无法识别的 --dismantle 有 warning');
eq(r.j.meta.dismantle, true, 'F18 回落到检修内容判定');

// ============ G. 硬约束 4：声明行原文保留 ============
const DECL = '本方案为辅助生成的初稿，须经技术负责人审核批准、并按厂内规定完成安全措施审查与作业许可后方可实施';
r = run([...PUMP, '--spec', SPEC_FULL, '--duration', '3'], 'g-decl');
ok(r.md.includes(DECL), 'G1 md 含声明行原文');
eq((r.md.match(new RegExp(DECL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length, 2, 'G2 声明行在开头与结尾各出现一次');
eq(r.j.meta.declaration, DECL, 'G3 plan.json 写入声明行原文');
r = run(['--equip-type', '离心机', '--tag', 'X-9402', '--scope', '转鼓更换'], 'g-decl2');
ok(r.md.includes(DECL), 'G4 覆盖范围外场景同样保留声明行');

// ============ H. 硬约束 5：安全措施提示接 overhaul-process-check-bridge ============
r = run([...PUMP, '--spec', SPEC_FULL], 'h-safety');
ok(/overhaul-process-check-bridge/.test(r.md), 'H1 md 提示接 overhaul-process-check-bridge');
ok(/\*\*安全措施\*\*/.test(r.md), 'H2 md 有安全措施段');
ok(r.j.meta.safetyNote.includes('overhaul-process-check-bridge'), 'H3 plan.json 写入安全措施提示');
ok(/permit-precheck-bridge/.test(r.md), 'H4 md 提示作业票接 permit-precheck-bridge');
ok(r.j.steps.some((x) => x.note.includes('overhaul-process-check-bridge')), 'H5 隔离交出步骤注明接核查技能');

// ============ I. 硬约束 6：质控点与验收标准供下游 completion-acceptance 比对 ============
r = run([...PUMP, '--spec', SPEC_FULL], 'i-qc');
ok(r.j.qcPoints.length >= 10, 'I1 质控点输出充分');
ok(r.j.qcPoints.every((q) => q.qcId && q.item && q.method && q.standard !== undefined), 'I2 每个质控点含编号/内容/方法/标准');
ok(r.j.qcPoints.some((q) => q.hold === true), 'I3 标出停工待检点');
eq(r.j.counts.qcHold, r.j.qcPoints.filter((q) => q.hold).length, 'I4 停工待检计数一致');
ok(r.j.acceptance.length >= 10, 'I5 验收项输出充分');
ok(r.j.acceptance.every((x) => x.acId && x.item && x.criterion), 'I6 每个验收项含编号/内容/判据');
ok(/completion-acceptance/.test(r.md), 'I7 md 提示供 completion-acceptance 比对');
eq(qcOf(r.j, 'QC-PU5').standardSource, 'spec', 'I8 对中质控点引用规程标准');
eq(qcOf(r.j, 'QC-PU5').valueKindCn, '对中偏差', 'I9 质控点标明数值类型');
eq(acOf(r.j, 'AC-PU2').criterionSource, 'spec', 'I10 对中验收项引用规程判据');
ok(String(acOf(r.j, 'AC-PU2').citation).includes('第'), 'I11 验收判据注明出处行号');
eq(qcOf(r.j, 'QC-G1').standardSource, 'none', 'I12 定性质控点不标 TBC');
ok(!qcOf(r.j, 'QC-G1').standard.includes(R.TBC), 'I13 定性质控点标准不写待查规程确认');

// ============ J. 分类型覆盖：五类设备各有专业步骤与质控点 ============
const TYPES = [
  ['离心泵', 'PU', 'QC-PU1', 'AC-PU1'],
  ['离心式压缩机组', 'RO', 'QC-RO1', 'AC-RO1'],
  ['填料塔', 'ST', 'QC-ST1', 'AC-ST1'],
  ['弹簧式安全阀', 'VA', 'QC-VA1', 'AC-VA1'],
  ['高压电机', 'EL', 'QC-EL1', 'AC-EL1'],
  ['管式加热炉', 'FU', 'QC-FU1', 'AC-FU1'],
  ['空冷器', 'AC', 'QC-AC1', 'AC-AC1'],
  ['压力变送器回路', 'IN', 'QC-IN1', 'AC-IN1'],
];
TYPES.forEach(([t, prefix, qc, ac], i) => {
  const rr = run(['--equip-type', t, '--tag', `T-${900 + i}`, '--scope', '解体检修（大修）'], 'j-' + i);
  eq(rr.s.ok, true, `J${i * 5 + 1} ${t} 运行成功`);
  eq(rr.j.meta.covered, true, `J${i * 5 + 2} ${t} 在覆盖范围内`);
  ok(rr.j.steps.some((x) => x.stepId.startsWith(prefix)), `J${i * 5 + 3} ${t} 生成 ${prefix} 系列专业步骤`);
  eq(qcOf(rr.j, qc).qcId, qc, `J${i * 5 + 4} ${t} 生成专业质控点 ${qc}`);
  eq(acOf(rr.j, ac).acId, ac, `J${i * 5 + 5} ${t} 生成专业验收项 ${ac}`);
});

// ============ K. 步骤结构与阶段顺序 ============
r = run([...PUMP, '--spec', SPEC_FULL], 'k-struct');
ok(r.j.steps.every((x, i) => x.no === i + 1), 'K1 步骤序号连续');
ok(r.j.steps.every((x) => /^(G|PU|RO|ST|VA|EL|FU|AC|IN)\d+$/.test(x.stepId)), 'K2 每条步骤带可追溯步骤号');
ok(r.j.steps.every((x) => x.title && x.note && x.phaseCn), 'K3 每条步骤含内容、注意事项、阶段');
const idx = r.j.steps.map((x) => R.PHASE_ORDER.indexOf(x.phase));
ok(idx.every((v, i) => i === 0 || v >= idx[i - 1]), 'K4 步骤按阶段顺序排列');
ok(r.j.steps.some((x) => x.phase === 'prepare') && r.j.steps.some((x) => x.phase === 'close'), 'K5 含施工准备与收尾阶段');
eq(r.j.counts.steps, r.j.steps.length, 'K6 counts.steps 与步骤数一致');
ok(r.j.tools.length >= 6 && r.j.tools.every((t) => t.name && t.use && t.spec), 'K7 工机具清单齐全');
ok(r.j.spares.length >= 1 && r.j.spares.every((x) => x.name && x.when && x.note), 'K8 备件清单齐全');
ok(!r.j.spares.some((x) => x.qty !== undefined), 'K9 备件不预填数量');

// ============ L. 参数校验 ============
const bad = (args, n) => { const rr = run(args, 'l-' + n.replace(/\W/g, '')); eq(rr.s.ok, false, n + '（ok:false）'); eq(rr.code, 1, n + '（exit 1）'); ok(!!rr.s.error, n + '（有 error）'); };
bad(['--tag', 'P-1', '--scope', '检修'], 'L1 缺 --equip-type');
bad(['--equip-type', '离心泵', '--scope', '检修'], 'L2 缺 --tag');
bad(['--equip-type', '离心泵', '--tag', 'P-1'], 'L3 缺 --scope');
bad(['--equip-type', '离心泵', '--tag', 'P-1', '--scope', '检修', '--unknown', 'x'], 'L4 未知参数');
bad(['--equip-type', '离心泵', '--tag', 'P-1', '--scope'], 'L5 值参数缺取值');
bad([...PUMP, '--start', '2026-13-45'], 'L6 非法开工日期');
bad([...PUMP, '--duration', '不知道'], 'L7 非法工期');
bad([...PUMP, '--duration', '-3'], 'L8 负数工期');
bad([...PUMP, '--spec', path.join(work, 'not-exist.md')], 'L9 规程文件不存在');
bad([...PUMP, '--spec', wr('empty.md', '   \n\n  ')], 'L10 规程内容为空');
bad([...PUMP, '--spec', wr('x.pdf', 'pdf')], 'L11 PDF 规程明确拒绝而非猜测');
{ const rp = run([...PUMP, '--spec', wr('y.pdf', 'pdf')], 'l-pdfmsg'); ok(/pdf 技能/.test(rp.s.error) && /txt\/docx/.test(rp.s.error), 'L11b PDF 报错写明先用平台 pdf 技能转 txt/docx'); }
// 缺工期 → warning 不中断
r = run([...PUMP, '--spec', SPEC_FULL], 'l-nodur');
eq(r.s.ok, true, 'L12 缺工期不中断');
eq(r.j.meta.duration, null, 'L13 缺工期为 null 不按 0');
ok(r.j.warnings.some((w) => w.includes('不按经验估算')), 'L14 缺工期 warning 点明不估算');
ok(/计划工期 \| —/.test(r.md), 'L15 缺工期显示「—」不显示 0');

// ============ M. docx 规程解析 ============
r = run([...PUMP, '--spec', SPEC_DOCX], 'm-docx');
eq(r.s.ok, true, 'M1 docx 规程可解析');
ok(r.j.counts.valueCited > 0, 'M2 docx 规程取到数值出处');
ok(String(r.j.meta.specFile).endsWith('.docx'), 'M3 出处文件名为 docx');
eq(stepOf(r.j, 'G8').valueSource, 'spec', 'M4 docx 规程命中力矩');

// ============ N. 产出结构完整性 ============
r = run([...PUMP, '--spec', SPEC_FULL, '--duration', '3', '--start', '2026-09-25',
  '--workshop', '加氢车间', '--model', 'ZA50-250', '--name', '进料泵A', '--last', '2024年更换机封'], 'n-out');
ok(fs.existsSync(path.join(r.out, 'plan.json')), 'N1 plan.json 已写入');
ok(fs.existsSync(path.join(r.out, 'plan.md')), 'N2 plan.md 已写入');
ok(fs.existsSync(path.join(r.out, 'summary.json')), 'N3 summary.json 已写入');
eq(JSON.parse(fs.readFileSync(path.join(r.out, 'summary.json'), 'utf8')).ok, true, 'N4 summary.json 内容正确');
ok(/## 一、检修概况/.test(r.md) && /## 二、检修范围与内容/.test(r.md) && /## 三、JSA\/风险分析与 HSE 措施（占位）/.test(r.md) && /## 四、施工准备/.test(r.md)
  && /## 五、作业步骤/.test(r.md) && /## 六、质量控制点/.test(r.md) && /## 七、验收标准/.test(r.md)
  && /## 八、待确认事项/.test(r.md), 'N5 八节结构齐全（含 JSA/HSE 占位）');
ok(/<!-- ANALYSIS_START -->/.test(r.md) && /<!-- ANALYSIS_END -->/.test(r.md), 'N6 分析段占位符存在');
ok(r.md.includes('北京时间'), 'N7 生成时间标注北京时间');
eq(r.j.meta.workshop, '加氢车间', 'N8 车间写入 meta');
eq(r.j.meta.model, 'ZA50-250', 'N9 规格型号写入 meta');
eq(r.j.meta.startDate, '2026-09-25', 'N10 开工日期归一化');
eq(r.j.meta.endDate, '2026-09-27', 'N11 完工日期按工期推算');
eq(r.j.meta.lastRepair, '2024年更换机封', 'N12 上次检修写入 meta');
ok(['steps', 'tools', 'spares', 'qcPoints', 'acceptance', 'toBeConfirmed', 'conflicts', 'counts']
  .every((k) => r.j[k] !== undefined), 'N13 plan.json 含全部约定字段');
eq(r.j.counts.toBeConfirmed, r.j.toBeConfirmed.length, 'N14 待确认计数一致');
eq(r.j.counts.conflicts, r.j.conflicts.length, 'N15 冲突计数一致');
eq(r.j.counts.acceptance, r.j.acceptance.length, 'N16 验收计数一致');
eq(r.s.counts.steps, r.j.counts.steps, 'N17 末行摘要与 plan.json 计数一致');


// ============ O. 中石化口径：JSA/HSE 占位、八大类用火、双监护、分级别名、声明行、无 emoji ============
r = run([...PUMP, '--spec', SPEC_FULL, '--level', '小修'], 'o-hse');
ok(r.j.hse && r.j.hse.jsa && r.j.hse.permits && r.j.hse.measures && r.j.hse.supervision, 'O1 plan.json 含 hse 占位块');
eq(r.j.hse.permits.length, 8, 'O2 作业许可八大类齐全');
ok(r.j.hse.permits.some((p) => p.type === '用火作业') && !r.j.hse.permits.some((p) => /动火/.test(p.type)), 'O3 写「用火作业」不写「动火」');
ok(r.j.hse.permits.some((p) => p.type === '盲板抽堵作业' && /待确认/.test(p.involved)), 'O4 解体时盲板抽堵作业标「可能涉及（待确认）」');
ok(r.j.hse.permits.every((p) => /不自判级别/.test(p.level)), 'O5 作业级别不自判');
ok(/待填/.test(r.j.hse.jsa.riskLevel), 'O6 风险等级为待填占位，不自判');
ok(/## 三、JSA\/风险分析与 HSE 措施（占位）/.test(r.md) && /属地监护人/.test(r.md) && /作业单位监护人/.test(r.md) && /双监护/.test(r.md), 'O7 md 第三节含 JSA/HSE 占位与双监护');
ok(hasStep(r.j, 'G11') && /JSA/.test(stepOf(r.j, 'G11').title) && /双监护/.test(stepOf(r.j, 'G11').title), 'O8 通用步骤含 JSA/风险分析与双监护');
ok(/盲板抽堵/.test(stepOf(r.j, 'G4').title) && /用火/.test(stepOf(r.j, 'G4').title) && !/动火/.test(stepOf(r.j, 'G4').title), 'O9 G4 作业许可按八大类命名');
eq(r.j.meta.level, 'routine', 'O10 --level 小修 作别名归日常维修');
eq(r.j.meta.levelCn, '日常维修', 'O11 分级中文为日常维修');
ok(r.j.warnings.some((w) => w.includes('旧口径') && w.includes('日常维修')), 'O12 旧口径别名 warning');
ok(/检修分级 \| 日常维修/.test(r.md), 'O13 md 概况写检修分级');
ok(r.md.includes('本材料由脚本汇总、模型成文，仅供设备员复核参考'), 'O14 md 含通用声明行');
ok(!/[⚠✅❌]/.test(r.md) && /【注意】/.test(r.md), 'O15 md 不含 emoji，提示用【注意】');
ok(/三级验收/.test(r.md), 'O16 验收说明按三级验收口径');
ok(!/机动处/.test(r.md), 'O17 不出现机动处');
r = run(['--equip-type', '离心泵', '--tag', 'P-9103', '--scope', '机封泄漏抢修，解体更换机封'], 'o-emerg');
eq(r.j.meta.level, 'emergency', 'O18 抢修识别');
r = run(['--equip-type', '离心泵', '--tag', 'P-9104', '--scope', '机封更换', '--level', '大检修'], 'o-ovh');
eq(r.j.meta.levelCn, '大检修（停工检修）', 'O19 大检修识别');
ok(!r.j.warnings.some((w) => w.includes('旧口径')), 'O20 新口径不报旧口径 warning');
r = run(['--equip-type', '离心泵', '--tag', 'P-9105', '--scope', '机械密封解体更换（小修）'], 'o-scope-old');
ok(r.j.meta.levelCn === '日常维修' && r.j.warnings.some((w) => w.includes('旧口径') && w.includes('小修') && w.includes('日常维修')), 'O21 检修内容里写旧口径「小修」也归日常维修并 warning');
// 「集中修复」里的「中修」、「运行车间」里的「行车」不是关键词
r = run(['--equip-type', '离心泵', '--tag', 'P-101', '--scope', '机封泄漏集中修复（日常维修）'], 'o-jizhong');
ok(r.j && r.j.meta.levelCn === '日常维修' && !r.j.warnings.some((w) => w.includes('旧口径')), 'O21a 检修内容「集中修复」不误报旧口径「中修」');
eq(R.classifyLevel('机封泄漏集中修复', ''), null, 'O21b 「集中修复」不按旧口径「中修」归日常维修');
eq(R.classifyLevel('中修', ''), 'routine', 'O21c 单独写「中修」仍按旧口径归日常维修');
eq(R.classifyEquip('', '常减压运行车间进料泵'), 'pump', 'O21d 名称含「运行车间」不被「行车」判为起重机械');
eq(R.classifyEquip('行车', ''), 'generic', 'O21e 「行车」仍判范围外');
r = run(['--equip-type', '离心泵', '--tag', 'P-9106', '--scope', '机械密封解体更换（小修）', '--level', '大检修'], 'o-scope-old-level');
ok(r.j.meta.levelCn === '大检修（停工检修）' && !r.j.warnings.some((w) => w.includes('旧口径')), 'O22 --level 用新口径时以参数为准，检修内容里的旧口径词不报 warning');

// ============ P. 新增覆盖：加热炉 / 空冷器 / 仪表回路 ============
r = run(['--equip-type', '管式加热炉', '--tag', 'F-9501', '--scope', '炉管更换与烧嘴检修（大检修）', '--duration', '20'], 'p-furnace');
eq(r.j.meta.covered, true, 'P1 加热炉在覆盖范围');
eq(r.j.meta.equipKey, 'furnace', 'P2 归类 furnace');
ok(hasStep(r.j, 'FU4') && stepOf(r.j, 'FU4').valueKind === 'thermal', 'P3 炉管壁厚/胀粗步骤带炉管限值数值类型');
eq(stepOf(r.j, 'FU4').valueSource, 'tbc', 'P4 无规程时炉管判据 TBC');
ok(r.j.hse.permits.find((p) => p.type === '受限空间作业').involved.includes('可能涉及'), 'P5 加热炉提示受限空间作业可能涉及');
ok(r.j.tools.some((t) => /炉管/.test(t.name)) && r.j.spares.some((x) => /炉管/.test(x.name)), 'P6 加热炉工机具与备件');
ok(!NUMERIC_UNIT.test(r.md), 'P7 加热炉方案无规程时全文无具体数值');
r = run(['--equip-type', '空冷器', '--tag', 'A-9601', '--scope', '管束抽芯检查与风机轴承更换'], 'p-aircooler');
eq(r.j.meta.equipKey, 'aircooler', 'P8 空冷器归类 aircooler（不被静设备抢走）');
ok(hasStep(r.j, 'AC5') && stepOf(r.j, 'AC5').valueKind === 'clearance', 'P9 风机叶尖间隙步骤');
ok(r.j.hse.permits.find((p) => p.type === '高处作业').involved.includes('可能涉及'), 'P10 空冷器提示高处作业可能涉及');
r = run(['--equip-type', '压力变送器回路', '--tag', 'PT-9701', '--scope', '变送器校验与联锁回路联校', '--dismantle', '是'], 'p-instr');
eq(r.j.meta.equipKey, 'instrument', 'P11 仪表回路归类 instrument');
ok(hasStep(r.j, 'IN4') && stepOf(r.j, 'IN4').valueKind === 'calibration', 'P12 校验步骤带校验精度数值类型');
ok(/联锁/.test(stepOf(r.j, 'IN1').note) && /归口/.test(stepOf(r.j, 'IN1').note), 'P13 联锁定值变更注明归口，不在方案内');
ok(r.j.qcPoints.some((q) => q.qcId === 'QC-IN1' && q.hold), 'P14 联锁摘除审批为停工待检点');
const SPEC_INSTR = wr('spec-instr.md', ['某厂仪表校验规程（样例）', '4.1 压力变送器示值误差不大于 0.2%，回差不大于 0.1%。'].join('\n'));
r = run(['--equip-type', '压力变送器', '--tag', 'PT-9702', '--scope', '校验', '--spec', SPEC_INSTR, '--dismantle', '否'], 'p-instr-spec');
eq(stepOf(r.j, 'IN4').valueSource, 'spec', 'P15 仪表规程命中校验精度原文');
ok(String(stepOf(r.j, 'IN4').valueText).includes('0.2%'), 'P16 校验精度为原文摘录');

// ============ R. 引用须命中该项本身：壁厚、水平度、机封压缩量不得借用别的条款 ============
// 换热器规程只有力矩、管板平面度公差、试压三条（同知识库 E-1201 规程）
const SPEC_HX = wr('spec-hx.md', ['某厂换热器检修规程（样例）',
  '4.1 管箱与浮头法兰螺栓紧固力矩按 420 N·m 执行，对角分四次紧固。',
  '4.2 管板密封面平面度公差不大于 0.3 mm。',
  '4.3 管程水压试验压力 2.5 MPa，壳程水压试验压力 1.8 MPa，保压 30 分钟。'].join('\n'));
r = run(['--equip-type', '换热器', '--tag', 'E-9801', '--scope', '管束抽芯检修', '--spec', SPEC_HX, '--dismantle', '是'], 'r-hx');
eq(stepOf(r.j, 'ST6').valueSource, 'tbc', 'R1 规程只有管板平面度公差 → 壁厚测定（ST6）不引用该条，标待查规程确认');
eq(stepOf(r.j, 'ST6').valueKind, 'thickness', 'R2 ST6 数值类型为壁厚类（thickness），不归公差');
eq(qcOf(r.j, 'QC-ST1').standardSource, 'tbc', 'R3 质控点壁厚测定（QC-ST1）不引用平面度公差条款');
eq(acOf(r.j, 'AC-ST1').criterionSource, 'tbc', 'R4 验收「壁厚满足最小允许壁厚」不引用平面度公差条款');
eq(acOf(r.j, 'AC-ST3').criterionSource, 'tbc', 'R5 验收「内件水平度」不引用平面度公差条款');
eq(acOf(r.j, 'AC-ST3').valueKind, 'level', 'R6 AC-ST3 数值类型为水平度类（level）');
ok(r.j.counts.toBeConfirmed >= 4 && ['ST6', 'QC-ST1', 'AC-ST1', 'AC-ST3'].every((id) => r.j.toBeConfirmed.some((t) => t.stepId === id)), 'R7 壁厚与水平度 4 处进 toBeConfirmed');
eq(stepOf(r.j, 'ST11').valueSource, 'spec', 'R8 力矩照常引用规程原文');
const SPEC_HX2 = wr('spec-hx2.md', ['某厂换热器检修规程（样例二）',
  '5.1 壳体最小允许壁厚 10.5 mm，腐蚀裕量 3 mm。',
  '5.2 塔盘安装水平度偏差不大于 3 mm。'].join('\n'));
r = run(['--equip-type', '换热器', '--tag', 'E-9802', '--scope', '管束抽芯检修', '--spec', SPEC_HX2, '--dismantle', '是'], 'r-hx2');
ok(stepOf(r.j, 'ST6').valueSource === 'spec' && /10\.5 mm/.test(stepOf(r.j, 'ST6').valueText), 'R9 规程写了最小允许壁厚 → ST6 引用该条原文');
ok(acOf(r.j, 'AC-ST3').criterionSource === 'spec' && /水平度/.test(acOf(r.j, 'AC-ST3').criterion), 'R10 规程写了水平度 → AC-ST3 引用该条原文');
// 空冷器翅片管壁厚同样不借用公差条款
r = run(['--equip-type', '空冷器', '--tag', 'A-9801', '--scope', '管束检修', '--spec', SPEC_HX, '--dismantle', '是'], 'r-ac');
ok(stepOf(r.j, 'AC4').valueSource === 'tbc' && qcOf(r.j, 'QC-AC1').standardSource === 'tbc', 'R11 空冷器翅片管壁厚（AC4、QC-AC1）不引用平面度公差条款');
// 泵：规程有轴向窜量、没有机封压缩量 → 转子窜量与机封压缩量项不能算已有出处
const SPEC_PU = wr('spec-pu.md', ['某厂离心泵检修规程（样例）',
  '1.2 配合间隙：叶轮口环间隙 0.30~0.45 mm，滚动轴承游隙 0.02~0.04 mm，转子轴向窜量 0.08~0.12 mm。'].join('\n'));
r = run(['--equip-type', '离心泵', '--tag', 'P-9801', '--scope', '机封解体更换', '--spec', SPEC_PU], 'r-pu');
eq(qcOf(r.j, 'QC-PU4').standardSource, 'tbc', 'R12 规程无机封压缩量 → QC-PU4 标待查规程确认');
eq(stepOf(r.j, 'PU10').valueSource, 'tbc', 'R13 规程无机封压缩量 → PU10 标待查规程确认');
const tPu4 = r.j.toBeConfirmed.find((t) => t.stepId === 'QC-PU4') || {};
ok(/机封压缩量/.test(tPu4.reason || '') && /转子轴向窜量/.test(tPu4.reason || '') && /第 2 行/.test(tPu4.reason || ''), 'R14 待确认原因写明缺「机封压缩量」，并注明已找到的轴向窜量条款行号');
ok(/补齐转子轴向窜量、机封压缩量/.test(tPu4.action || ''), 'R14b 待确认措施写明要补齐的分项名称，不笼统写「配合间隙」');
eq(stepOf(r.j, 'PU5').valueSource, 'spec', 'R15 口环间隙照常引用');
const SPEC_PU2 = wr('spec-pu2.md', ['某厂离心泵检修规程（样例二）',
  '1.2 转子轴向窜量 0.08~0.12 mm。',
  '2.3 机械密封压缩量 3~4 mm。'].join('\n'));
r = run(['--equip-type', '离心泵', '--tag', 'P-9802', '--scope', '机封解体更换', '--spec', SPEC_PU2], 'r-pu2');
const q4 = qcOf(r.j, 'QC-PU4');
ok(q4.standardSource === 'spec' && /0\.08~0\.12/.test(q4.standard) && /3~4 mm/.test(q4.standard) && /第 2、3 行/.test(q4.citation), 'R16 两项都有出处 → 合并引用两条原文并列出两处行号');

// ============ Q. 演示case 样例（目录不存在则跳过） ============
// 演示样例：仓库内在 炼厂车间设备员/演示case/<分类>/<技能>/，开发包内在技能目录 examples/
const skillsRoot = path.resolve(__dirname, '../../..');
const EX = path.basename(skillsRoot) === '设备员skill' ? path.join(skillsRoot, '..', '演示case', path.relative(skillsRoot, path.resolve(__dirname, '..'))) : path.join(__dirname, '..', 'examples');
if (fs.existsSync(path.join(EX, 'sample-procedure-furnace.md'))) {
  r = run(['--equip-type', '管式加热炉', '--tag', 'F-3501', '--scope', '炉管更换与烧嘴检修（大检修）', '--spec', path.join(EX, 'sample-procedure-furnace.md'), '--duration', '20'], 'q-furnace');
  ok(r.s.ok && r.j.meta.equipKey === 'furnace' && r.j.meta.dismantle === true && r.j.meta.level === 'overhaul', 'Q1 演示case 加热炉样例：归类/解体/大检修识别');
  eq(stepOf(r.j, 'FU4').valueSource, 'spec', 'Q2 演示case 加热炉规程命中炉管壁厚/胀粗');
  eq(stepOf(r.j, 'FU9').valueSource, 'spec', 'Q3 演示case 加热炉规程命中试压');
  eq(stepOf(r.j, 'FU10').valueSource, 'spec', 'Q4 演示case 升温曲线行含数字时按原文引用（6.1 行命中 thermal 关键词）');
  r = run(['--equip-type', '离心泵', '--tag', 'P-3101A', '--scope', '机械密封解体更换（小修）', '--spec', path.join(EX, 'sample-procedure-pump.md'), '--duration', '3'], 'q-pump');
  ok(r.s.ok && r.j.counts.conflicts === 1 && r.j.meta.levelCn === '日常维修', 'Q5 演示case 泵样例：1 处冲突，小修归日常维修');
}

// ---- 输出
console.log(`\n${'='.repeat(56)}`);
console.log(`repair-plan-assistant 自测：${pass} 通过，${fail} 失败`);
if (failures.length) { console.log('\n失败项：'); failures.forEach((f) => console.log('  ✗ ' + f)); }
console.log('='.repeat(56));
try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
