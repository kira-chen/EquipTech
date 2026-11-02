#!/usr/bin/env node
'use strict';
/** 自测：断言 moc.js 与 rules.js 行为。用法：node scripts/selftest.js（全绿退出 0） */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { writeXlsx } = require('./lib/xlsx-lite');
const R = require('./lib/rules');

const MOC = path.join(__dirname, 'moc.js');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'moc-selftest-'));
let pass = 0, fail = 0;
const failures = [];
const ok = (c, n) => { if (c) pass++; else { fail++; failures.push(n); } };
const eq = (a, e, n) => ok(a === e, `${n}（期望 ${JSON.stringify(e)}，实际 ${JSON.stringify(a)}）`);

function run(args, tag) {
  const out = path.join(work, tag + '-out');
  const r = spawnSync(process.execPath, [MOC, ...args, '--out', out], { encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  let s; try { s = JSON.parse(lines[lines.length - 1]); } catch (e) { s = { ok: false, error: 'no-json:' + r.stdout + r.stderr }; }
  let j = null, md = null;
  if (fs.existsSync(path.join(out, 'moc.json'))) j = JSON.parse(fs.readFileSync(path.join(out, 'moc.json'), 'utf8'));
  if (fs.existsSync(path.join(out, 'moc.md'))) md = fs.readFileSync(path.join(out, 'moc.md'), 'utf8');
  return { code: r.status, s, j, md, out };
}
const mk = (n, b) => { const p = path.join(work, n); writeXlsx(p, b); return p; };
/** 规则引擎直调 */
function J(before, after, o = {}) {
  return R.judge({
    category: o.cat === undefined ? R.classifyCategory(`${before} ${after}`) : o.cat,
    before, after,
    beforeQ: R.describeQuality(before), afterQ: R.describeQuality(after),
    sameModelMaterial: o.smm === undefined ? null : o.smm,
    affectsPerf: o.ap === undefined ? null : o.ap,
    exceedsDesign: o.ed === undefined ? null : o.ed,
    temporary: !!o.t, until: o.u || null,
  });
}

// ============ A. 规则引擎：七类变更判定 ============
eq(J('316L 机封 型号 5610', '316L 机封 型号 5610 同型号', { cat: 'substitute', smm: true }).level, 'none', 'A1 同型号同材质备件更换→不属于变更');
eq(J('316L 机封 型号 5610', '316L 机封 型号 5610 同型号', { cat: 'substitute', smm: true }).ruleId, 'RN1', 'A2 命中 RN1');
eq(J('管束材质 316L', '管束材质 碳钢 Q345R', { cat: 'material' }).level, 'major', 'A3 材质降级→重大变更');
eq(J('管束材质 316L', '管束材质 碳钢 Q345R', { cat: 'material' }).ruleId, 'R1', 'A4 命中 R1');
eq(J('材质 碳钢 Q345R', '材质 316L 不锈钢', { cat: 'material' }).ruleId, 'R1', 'A5 改变材质类别（升级也算）→R1 重大');
eq(J('材质 316L 板厚 10mm', '材质 2205 双相钢 板厚 10mm', { cat: 'material' }).level, 'general', 'A6 同类别材质升级→一般变更');
eq(J('叶轮直径 220mm 扬程 65m', '叶轮直径 240mm 扬程 78m', { cat: 'model', ap: true }).level, 'general', 'A7 型号规格影响性能→一般变更');
eq(J('叶轮直径 220mm 扬程 65m', '叶轮直径 240mm 扬程 78m', { cat: 'model', ap: true }).ruleId, 'R2', 'A8 命中 R2');
eq(J('筒体无取样口 DN1600', '筒体下部新增 DN25 取样管口').level, 'major', 'A9 结构改动→重大变更');
eq(J('筒体无取样口 DN1600', '筒体下部新增 DN25 取样管口').ruleId, 'R3', 'A10 命中 R3');
eq(J('操作压力 0.6 MPa', '操作压力 0.95 MPa', { cat: 'process', ed: true }).ruleId, 'R4', 'A11 工艺参数超设计→R4 重大');
eq(J('操作压力 0.6 MPa', '操作压力 0.95 MPa', { cat: 'process', ed: true }).level, 'major', 'A12 R4 为重大变更');
eq(J('操作压力 0.6 MPa', '操作压力 0.75 MPa', { cat: 'process', ed: false }).level, 'general', 'A13 工艺参数未超设计→一般变更');
eq(J('低流量联锁值 12 m3/h', '低流量联锁值 8 m3/h').ruleId, 'R5', 'A14 控制方案改变→R5');
eq(J('低流量联锁值 12 m3/h', '低流量联锁值 8 m3/h').level, 'major', 'A15 R5 为重大变更');
eq(J('机封 316L 型号 5610 A厂', '机封 316L 型号 5610 B厂 同规格', { cat: 'substitute' }).ruleId, 'R6', 'A16 备件代用→R6');
eq(J('机封 316L 型号 5610 A厂', '机封 316L 型号 5610 B厂 同规格', { cat: 'substitute' }).level, 'review', 'A17 R6 同规格不同厂家代用→待厂内评审（材料代用单/同类替换评审），不自动判一般变更');
ok(/材料代用单/.test(J('机封 316L 型号 5610 A厂', '机封 316L 型号 5610 B厂 同规格', { cat: 'substitute' }).basis), 'A17b R6 依据写明走材料代用单');
eq(J('机封 316L 型号 5610 A厂', '机封 316L 型号 5610 B厂 同规格', { cat: 'substitute' }).isChange, null, 'A17c R6 不断言是否属于变更（以厂内制度为准）');
eq(J('冷却水线 DN150 正常投用', '临时加装 DN50 跨线 压力 0.4 MPa', { t: true, u: '2026-10-31' }).level, 'major', 'A18 临时属性不改变级别：临时结构改动仍按 R3 重大');
eq(J('冷却水线 DN150 正常投用', '临时加装 DN50 跨线 压力 0.4 MPa', { t: true, u: '2026-10-31' }).temporary, true, 'A18b temporary 作为布尔属性输出');
eq(J('冷却水线 DN150 正常投用', '临时加装 DN50 跨线 压力 0.4 MPa', { t: true, u: '2026-10-31' }).ruleId, 'R3+R7', 'A19 条款为 R3+R7（类别规则 + 临时属性）');
ok(/2026-10-31/.test(J('冷却水线 DN150 正常投用', '临时加装 DN50 跨线 压力 0.4 MPa', { t: true, u: '2026-10-31' }).temporaryNote || ''), 'A20 临时变更输出期限');
ok(/恢复/.test(J('冷却水线 DN150 正常投用', '临时加装 DN50 跨线 压力 0.4 MPa', { t: true, u: '2026-10-31' }).temporaryNote || ''), 'A21 临时变更输出恢复计划提示');

// ============ B. undetermined：信息不足绝不判「不需要走变更」 ============
let u = J('换个泵', '换个新的');
eq(u.level, 'undetermined', 'B1 笼统描述→未判定');
eq(u.ruleId, 'U1', 'B2 命中 U1');
eq(u.isChange, null, 'B3 未判定时 isChange 为 null，不是 false');
ok(u.missing.some((m) => m.includes('原状态')), 'B4 列出原状态需补充');
ok(u.missing.some((m) => m.includes('变更后状态')), 'B5 列出变更后状态需补充');
ok(/不得认定为「不需要走变更」/.test(u.basis), 'B6 明示不得判为不需走变更');
u = J('这台设备现在的状态，按老办法运行着', '按新办法运行，具体待定', { cat: null });
eq(u.ruleId, 'U1', 'B7 无参数无型号的长描述仍未判定');
u = J('原有 DN100 管线 压力 1.6 MPa', '更换为 DN100 管线 压力 1.6 MPa', { cat: null });
eq(u.level, 'undetermined', 'B8 类别无法识别→未判定');
eq(u.ruleId, 'U2', 'B9 命中 U2');
eq(u.isChange, null, 'B10 类别不明不按不属于变更处理');
u = J('材质 316L 板厚 10mm', '材质 牌号 XRA-8802 复合板 10mm', { cat: 'material' });
eq(u.ruleId, 'U3', 'B11 材质牌号无法识别→U3');
ok(u.missing.includes('变更后材质牌号'), 'B12 U3 列出缺失牌号');
u = J('叶轮直径 220mm', '叶轮直径 240mm', { cat: 'model' });
eq(u.ruleId, 'U4', 'B13 型号规格未确认是否影响性能→U4');
ok(u.missing[0].includes('性能参数'), 'B14 U4 列出需确认性能参数');
u = J('操作压力 0.6 MPa', '操作压力 0.95 MPa', { cat: 'process' });
eq(u.ruleId, 'U4', 'B15 工艺参数未确认是否超设计→U4');
u = J('冷却水线 DN150 正常投用', '临时加装 DN50 跨线 压力 0.4 MPa', { t: true });
eq(u.level, 'undetermined', 'B16 临时变更缺期限→未判定');
eq(u.ruleId, 'U5', 'B17 命中 U5');
ok(u.missing.some((m) => m.includes('期限')), 'B18 U5 列出缺期限');
// 备件代用未确认同型号同材质时，不得命中 RN1
u = J('机封 316L 型号 5610 A厂', '机封 316L 型号 5610 B厂 同规格', { cat: 'substitute', smm: null });
ok(u.level !== 'none', 'B19 未确认同型号同材质时不得判为不属于变更');
eq(u.ruleId, 'R6', 'B20 转按 R6 备件代用处理');

// ============ C. 描述具体性 ============
eq(R.describeQuality('换个泵').concrete, false, 'C1 「换个泵」不具体');
eq(R.describeQuality('').concrete, false, 'C2 空描述不具体');
eq(R.describeQuality('操作压力 0.6 MPa').concrete, true, 'C3 带参数为具体');
eq(R.describeQuality('材质 316L').concrete, true, 'C4 带牌号为具体');
eq(R.describeQuality('管束材质由碳钢改为不锈钢').concrete, true, 'C5 材质名称为具体');
ok(R.describeQuality('换个泵').reason.includes('笼统'), 'C6 笼统描述说明原因');
eq(R.normCategory('材质'), 'material', 'C7 类别别名-材质');
eq(R.normCategory('联锁'), 'control', 'C8 类别别名-控制方案');
eq(R.normCategory('说不清的一类改动'), null, 'C8b 类别别名不匹配返回 null');
eq(R.normCategory(''), null, 'C9 空类别返回 null');
eq(R.parseBool(''), null, 'C10 空布尔返回 null 不是 false');
eq(R.parseBool('否'), false, 'C11 否→false');
eq(R.parseBool('是'), true, 'C12 是→true');
eq(R.classifyCategory('把联锁报警值从 12 改到 8'), 'control', 'C13 文本识别控制方案');
eq(R.classifyCategory('这个改一改'), 'unknown', 'C14 无法识别→unknown');

// ============ D. 脚本：正常路径与产出 ============
let r = run(['--tag', 'E-2201', '--before', '管束材质 316L', '--after', '管束材质 碳钢 Q345R',
  '--reason', '降本', '--category', '材质', '--workshop', '加氢车间'], 'major');
eq(r.s.ok, true, 'D1 正常路径 ok:true');
eq(r.j.level, 'major', 'D2 判定为重大变更');
eq(r.j.isChange, true, 'D3 isChange 为 true');
eq(r.j.ruleId, 'R1', 'D4 依据条款 R1');
ok(r.j.counts.assessItems > 0, 'D5 需评估项非空');
eq(r.j.counts.assessDisciplines, 6, 'D6 需评估项覆盖 6 个专业');
ok(r.j.assessItems.map((x) => x.discipline).join(',') === '安全,工艺,设备,电气仪表,环保,操作规程', 'D7 专业分组顺序固定');
ok(r.j.counts.docUpdates > 0, 'D8 应更新资料清单非空');
ok(r.j.docUpdates.some((d) => /台账/.test(d.doc)), 'D9 资料清单含台账');
ok(r.j.docUpdates.some((d) => /设备档案/.test(d.doc)), 'D10 资料清单含设备档案');
ok(r.j.assessItems.find((x) => x.discipline === '安全').items.some((i) => /会审/.test(i)), 'D11 重大变更附加多专业会审条目');
ok(/规则 R1|R1/.test(r.md), 'D12 md 含依据条款编号');
ok(/## 一、变更概况/.test(r.md) && /## 二、是否属于变更及依据/.test(r.md) && /## 三、归口与提报专业/.test(r.md) && /## 四、需评估项/.test(r.md)
  && /## 五、应更新资料清单/.test(r.md) && /## 六、待确认信息/.test(r.md) && /## 七、与厂内制度的冲突点/.test(r.md)
  && /## 八、特种设备法定手续提示/.test(r.md) && /## 九、临时变更期限与恢复计划/.test(r.md) && /## 十、变更申请要点提示/.test(r.md), 'D13 md 十节结构齐全');
ok(!/[\u2705\u26A0\uFE0F\u274C]/.test(r.md), 'D13b md 不含 emoji');
ok(/<!-- ANALYSIS_START -->/.test(r.md) && /<!-- ANALYSIS_END -->/.test(r.md), 'D14 md 含分析段占位符');
ok(r.md.includes('本判定为辅助参考，变更是否成立、变更类型、级别与审批要求以厂内变更管理部门按《中国石化变更管理规定》及厂内实施细则认定为准；未经批准不得实施变更'), 'D15 md 含固定声明行');
ok(r.j.declaration.includes('未经批准不得实施变更'), 'D16 json 含固定声明行');
ok(fs.existsSync(path.join(r.out, 'moc.json')), 'D17 moc.json 生成');
ok(fs.existsSync(path.join(r.out, 'moc.md')), 'D18 moc.md 生成');
ok(fs.existsSync(path.join(r.out, 'summary.json')), 'D19 summary.json 落盘');

// ============ E. 脚本：不属于变更只能正面命中 ============
r = run(['--tag', 'P-2101A', '--before', '316L 机封 型号 5610', '--after', '316L 机封 型号 5610 同型号',
  '--reason', '到期更换', '--category', '备件代用', '--same-model-material', '是'], 'none');
eq(r.j.isChange, false, 'E1 确认同型号同材质→不属于变更');
eq(r.j.ruleId, 'RN1', 'E2 命中 RN1');
ok(/_无，判定要素齐全。_/.test(r.md), 'E3 无待确认信息');
// 笼统描述绝不判为不需走变更
r = run(['--tag', 'P-2101A', '--before', '换个泵', '--after', '换个新的', '--reason', '坏了'], 'vague');
eq(r.s.ok, true, 'E4 笼统描述不报错但未判定');
eq(r.j.level, 'undetermined', 'E5 笼统描述→未判定');
eq(r.j.isChange, null, 'E6 未判定不落为 false');
eq(r.j.counts.undetermined, 1, 'E7 未判定项计 1');
ok(r.j.undetermined[0].caution.includes('不得判定为「不需要走变更」'), 'E8 未判定项带禁止默认提示');
ok(r.j.warnings.some((w) => w.includes('原状态描述不足')), 'E9 原状态不足 warning');
ok(r.j.warnings.some((w) => w.includes('变更后状态描述不足')), 'E10 变更后状态不足 warning');
ok(/未判定不等于「不需要走变更」/.test(r.md), 'E11 md 明示未判定不等于不需走变更');
eq(r.j.counts.assessItems, 0, 'E12 类别未定时不臆造评估项');
ok(r.j.warnings.some((w) => w.includes('需评估项与应更新资料清单暂无法给出')), 'E13 类别未定 warning');

// ============ F. 厂内制度冲突：以厂内为准 ============
const spec = mk('spec.xlsx', {
  '变更判定': [
    ['某厂设备变更管理实施细则'],
    [],
    ['变更类别', '判定', '变更等级', '条款号'],
    ['备件代用', '属于变更', '重大变更', '第4.2.5条'],
    ['材质变更', '属于变更', '重大变更', '第4.2.1条'],
    ['合计', '', '', ''],
  ],
});
r = run(['--tag', 'P-2101A', '--before', '机封 316L 型号 5610 A厂', '--after', '机封 316L 型号 5610 B厂 同规格',
  '--reason', '国产替代', '--category', '备件代用', '--spec', spec], 'conflict');
eq(r.j.counts.conflicts, 1, 'F1 检出 1 处冲突');
eq(r.j.level, 'major', 'F2 以厂内制度为准（重大变更）');
eq(r.j.defaultVerdict.level, 'review', 'F3 保留默认口径结论备查（待厂内评审）');
eq(r.j.conflicts[0].plantClause, '第4.2.5条', 'F4 冲突项带厂内条款号');
eq(r.j.conflicts[0].resolution, '以厂内制度为准', 'F5 冲突处理为以厂内为准');
eq(r.j.ruleId, '第4.2.5条', 'F6 依据条款改为厂内条款号');
eq(r.j.meta.basisSource, '厂内制度', 'F7 口径来源标注厂内制度');
ok(/第4\.2\.5条/.test(r.md), 'F8 md 列出冲突条款');
ok(r.j.warnings.some((w) => w.includes('冲突')), 'F9 冲突 warning');
ok(r.j.warnings.some((w) => w.includes('合计行')), 'F10 制度表合计行跳过并 warning');
// 一致时不记冲突
r = run(['--tag', 'E-2201', '--before', '管束材质 316L', '--after', '管束材质 碳钢 Q345R',
  '--reason', '降本', '--category', '材质', '--spec', spec], 'noconflict');
eq(r.j.counts.conflicts, 0, 'F11 口径一致不记冲突');
ok(/与厂内制度第4\.2\.1条一致/.test(r.j.basis), 'F12 一致时依据注明与厂内一致');
// 制度条目无法识别 → warning 且不中断
const badSpec = mk('badspec.xlsx', {
  '变更判定': [['变更类别', '变更等级', '条款号'], ['说不清的改动', '重大变更', '第9条'], ['备件代用', '看情况定', '第8条']],
});
r = run(['--tag', 'E-2201', '--before', '管束材质 316L', '--after', '管束材质 碳钢 Q345R',
  '--reason', '降本', '--category', '材质', '--spec', badSpec], 'badspec');
eq(r.s.ok, true, 'F13 制度条目不可识别不中断');
ok(r.j.warnings.some((w) => w.includes('无法识别')), 'F14 不可识别条目 warning');
eq(r.j.level, 'major', 'F15 仍按默认口径判定');
// 制度表缺失 sheet → warning 不中断
const noSheet = mk('nosheet.xlsx', { '别的表': [['a'], [1]] });
r = run(['--tag', 'E-2201', '--before', '管束材质 316L', '--after', '管束材质 碳钢 Q345R',
  '--reason', '降本', '--category', '材质', '--spec', noSheet], 'nosheet');
eq(r.s.ok, true, 'F16 制度缺表不中断');
ok(r.j.warnings.some((w) => w.includes('未找到「变更判定」工作表')), 'F17 制度缺表 warning');

// ============ G. 临时变更 ============
r = run(['--tag', 'T-2501', '--before', '冷却水线 DN150 正常投用', '--after', '临时加装 DN50 跨线 压力 0.4 MPa',
  '--reason', '冷却量不足', '--temporary', '--until', '2026-10-31'], 'temp');
eq(r.j.level, 'major', 'G1 临时结构改动级别仍为重大');
eq(r.j.temporary, true, 'G1b 临时属性为 true');
ok(/（临时）/.test(r.md), 'G1c md 级别后标注（临时）');
eq(r.j.temporaryPlan.until, '2026-10-31', 'G2 输出恢复期限');
ok(r.j.temporaryPlan.required.includes('恢复责任人'), 'G3 恢复计划含恢复责任人');
ok(r.j.temporaryPlan.required.some((x) => x.includes('验收')), 'G4 恢复计划含验收方式');
ok(/## 九、临时变更期限与恢复计划/.test(r.md) && /恢复责任人/.test(r.md), 'G5 md 第九节给出恢复计划');
ok(/2026-10-31/.test(r.md), 'G6 md 写出期限');
// 缺期限 → 未判定
r = run(['--tag', 'T-2501', '--before', '冷却水线 DN150 正常投用', '--after', '临时加装 DN50 跨线 压力 0.4 MPa',
  '--reason', '冷却量不足', '--temporary'], 'tempnodate');
eq(r.j.level, 'undetermined', 'G7 临时变更缺期限→未判定');
eq(r.j.ruleId, 'U5', 'G8 命中 U5');
eq(r.j.temporaryPlan, null, 'G9 未判定时不输出恢复计划');
eq(r.j.isChange, null, 'G10 缺期限不判为不属于变更');
// 临时变更并入临时类评估项与资料
r = run(['--tag', 'T-2501', '--before', '冷却水线 DN150 正常投用', '--after', '临时加装 DN50 跨线 压力 0.4 MPa',
  '--reason', '冷却量不足', '--temporary', '--until', '2026-10-31'], 'tempmerge');
eq(r.j.category, 'structure', 'G11 类别仍识别为结构改动');
ok(r.j.assessItems.find((x) => x.discipline === '设备').items.some((i) => /恢复计划/.test(i)), 'G12 临时变更并入恢复计划评估项');
ok(r.j.assessItems.find((x) => x.discipline === '电气仪表').items.some((i) => /旁路/.test(i)), 'G13 临时变更并入旁路登记评估项');
ok(r.j.docUpdates.some((d) => /临时变更台账/.test(d.doc)), 'G14 资料清单并入临时变更台账');
eq(new Set(r.j.docUpdates.map((d) => d.doc)).size, r.j.docUpdates.length, 'G15 资料清单无重复项');
// 非临时变更不应混入临时类条目
r = run(['--tag', 'V-2301', '--before', '筒体无取样口 DN1600', '--after', '筒体下部新增 DN25 取样管口'], 'nonmerge');
ok(!r.j.docUpdates.some((d) => /临时变更台账/.test(d.doc)), 'G16 非临时变更不混入临时资料');

// ============ H. 设备台账 ============
const led = mk('led.xlsx', {
  '设备台账': [
    ['设备位号', '名称', '材质', '规格型号', '设计压力', '介质'],
    ['E-2201', '进料换热器', '316L', 'BES800-2.5', 2.5, '柴油'],
    ['合计', '', '', '', '', ''],
  ],
});
r = run(['--tag', 'E-2201', '--before', '管束材质 316L', '--after', '管束材质 碳钢 Q345R',
  '--reason', '降本', '--category', '材质', '--ledger', led], 'ledger');
eq(r.j.equip.name, '进料换热器', 'H1 别名列头读出设备名称');
eq(r.j.equip.material, '316L', 'H2 读出台账材质');
ok(/已核对/.test(r.md), 'H3 md 标注已核对台账');
ok(r.j.warnings.some((w) => w.includes('合计行')), 'H4 台账合计行跳过并 warning');
r = run(['--tag', 'ZZ-999', '--before', '管束材质 316L', '--after', '管束材质 碳钢 Q345R',
  '--reason', '降本', '--category', '材质', '--ledger', led], 'ledgermiss');
eq(r.s.ok, true, 'H5 位号不在台账不中断');
ok(r.j.warnings.some((w) => w.includes('不在设备台账')), 'H6 位号不在台账 warning');
eq(r.j.equip, null, 'H7 未命中台账时 equip 为 null 不臆造');
const noLedSheet = mk('noledsheet.xlsx', { '其他': [['x'], [1]] });
r = run(['--tag', 'E-2201', '--before', '管束材质 316L', '--after', '管束材质 碳钢 Q345R',
  '--reason', '降本', '--category', '材质', '--ledger', noLedSheet], 'noledsheet');
eq(r.s.ok, true, 'H8 台账缺表不中断');
ok(r.j.warnings.some((w) => w.includes('未找到「设备台账」工作表')), 'H9 台账缺表 warning');

// ============ I. 参数校验 ============
function raw(args) {
  const x = spawnSync(process.execPath, [MOC, ...args], { encoding: 'utf8' });
  const l = x.stdout.trim().split('\n');
  try { return { code: x.status, s: JSON.parse(l[l.length - 1]) }; } catch (e) { return { code: x.status, s: { ok: false } }; }
}
eq(raw([]).s.ok, false, 'I1 无参数报错');
eq(raw([]).code, 1, 'I2 退出码 1');
eq(raw(['--tag', 'P-1']).s.ok, false, 'I3 缺 --before 报错');
eq(raw(['--tag', 'P-1', '--before', 'x']).s.ok, false, 'I4 缺 --after 报错');
eq(raw(['--tag']).s.ok, false, 'I5 --tag 缺值报错');
ok(/缺少取值/.test(raw(['--tag']).s.error), 'I6 缺值信息正确');
eq(raw(['--tag', 'P-1', '--未知', 'v']).s.ok, false, 'I7 未知参数报错');
eq(raw(['--tag', 'P-1', '--before', '材质 316L', '--after', '材质 碳钢', '--until', '去年底']).s.ok, false, 'I8 非法日期报错');
ok(/YYYY-MM-DD/.test(raw(['--tag', 'P-1', '--before', '材质 316L', '--after', '材质 碳钢', '--until', '去年底']).s.error), 'I9 非法日期提示格式');
eq(raw(['--tag', 'P-1', '--before', '材质 316L', '--after', '材质 碳钢', '--spec', '/不存在.xlsx']).s.ok, false, 'I10 制度文件不存在报错');
eq(raw(['--tag', 'P-1', '--before', '材质 316L', '--after', '材质 碳钢', '--ledger', '/不存在.xlsx']).s.ok, false, 'I11 台账不存在报错');
r = run(['--tag', 'E-2201', '--before', '管束材质 316L', '--after', '管束材质 碳钢 Q345R', '--category', '材质'], 'noreason');
eq(r.s.ok, true, 'I12 缺 --reason 不中断');
ok(r.j.warnings.some((w) => w.includes('变更原因')), 'I13 缺变更原因 warning');


// ============ J. 中石化口径：三大类 × 重大/一般 + 临时属性 ============
let v = J('管束材质 316L', '管束材质 碳钢 Q345R', { cat: 'material' });
eq(v.changeType, 'equipment_facility', 'J1 材质变更归设备设施变更');
eq(v.changeTypeCn, '设备设施变更', 'J2 中文类型');
eq(J('操作压力 0.6 MPa', '操作压力 0.95 MPa', { cat: 'process', ed: true }).changeType, 'process_tech', 'J3 工艺参数归工艺技术变更');
eq(J('低流量联锁值 12 m3/h', '低流量联锁值 8 m3/h').changeType, 'process_tech', 'J4 联锁定值归工艺技术变更');
eq(R.LEVEL_CN.temporary, undefined, 'J5 级别表不再有「临时变更」级别');
ok(['major', 'general', 'review', 'none', 'undetermined'].every((k) => R.LEVEL_CN[k]), 'J6 级别为 重大/一般/待评审/不属于/未判定');
ok(/同类替换/.test(R.RULE_TEXT.RN1) && /同类替换/.test(R.LEVEL_CN.none), 'J7 RN1 命名为同类替换（不属于变更）');
eq(R.normCategory('临时'), null, 'J8 「临时」不再是类别');
eq(R.isTempWord('临时措施'), true, 'J9 「临时」识别为属性');
eq(R.normCategory('管理变更'), 'management', 'J10 新增管理变更类别');
eq(R.classifyCategory('维保单位更换为乙公司'), 'management', 'J11 文本识别管理变更');
r = run(['--tag', 'T-2501', '--before', '冷却水线 DN150 正常投用', '--after', '临时加装 DN50 跨线 压力 0.4 MPa',
  '--reason', '冷却量不足', '--category', '临时', '--until', '2026-10-31', '--special', '否'], 'tempcat');
eq(r.j.temporary, true, 'J12 --category 临时 转为临时属性');
eq(r.j.category, 'structure', 'J13 类别改从描述识别');
ok(r.j.warnings.some((w) => w.includes('临时属性')), 'J14 转换有 warning');
ok(/变更类型（中石化三大类）/.test(r.md) && /设备设施变更/.test(r.md), 'J15 md 写出中石化三大类');
eq(r.j.statutory, null, 'J16 --special 否 时不附法定手续');
ok(/## 八、特种设备法定手续提示[\s\S]*不适用/.test(r.md), 'J17 第八节写不适用');

// ============ K. R6 代用：待厂内评审，厂内制度可定级 ============
r = run(['--tag', 'P-2101A', '--before', '机封 316L 型号 5610 A厂', '--after', '机封 316L 型号 5610 B厂 同规格',
  '--reason', '国产替代', '--category', '备件代用'], 'r6');
eq(r.j.level, 'review', 'K1 脚本层 R6 为待厂内评审');
eq(r.j.isChange, null, 'K2 isChange 为 null');
ok(/材料代用单/.test(r.md) && /以厂内制度为准/.test(r.md), 'K3 md 提示走材料代用单，是否报变更以厂内为准');
ok(/【注意】/.test(r.md), 'K4 md 用【注意】提示');
ok(r.j.docUpdates.some((d) => /材料代用单/.test(d.doc)), 'K5 资料清单含材料代用单');
ok(r.j.assessItems.find((x) => x.discipline === '设备').items.some((i) => /材料代用单|同类替换评审/.test(i)), 'K6 评估项含同类替换评审记录');
const specReview = mk('spec-review.xlsx', {
  '变更判定': [['变更类别', '变更类型', '判定', '变更等级', '条款号'], ['备件代用', '设备设施变更', '走材料代用单', '厂内评审', 'Q/XX-虚构-001 第5条']],
});
r = run(['--tag', 'P-2101A', '--before', '机封 316L 型号 5610 A厂', '--after', '机封 316L 型号 5610 B厂 同规格',
  '--reason', '国产替代', '--category', '备件代用', '--spec', specReview], 'r6spec');
eq(r.j.counts.conflicts, 0, 'K7 厂内制度同为评审口径时无冲突');
ok(/第5条一致/.test(r.j.basis), 'K8 依据注明与厂内一致');
const specGeneral = mk('spec-general.xlsx', {
  '变更判定': [['变更类别', '变更类型', '变更等级', '条款号'], ['备件代用', '设备设施变更', '一般变更', 'Q/XX-虚构-001 第6条']],
});
r = run(['--tag', 'P-2101A', '--before', '机封 316L 型号 5610 A厂', '--after', '机封 316L 型号 5610 B厂 同规格',
  '--reason', '国产替代', '--category', '备件代用', '--spec', specGeneral], 'r6gen');
eq(r.j.level, 'general', 'K9 厂内制度定一般变更时按厂内');
eq(r.j.isChange, true, 'K10 厂内定级后 isChange 为 true');
eq(r.j.counts.conflicts, 1, 'K11 记冲突');
// 厂内制度改归类
const specType = mk('spec-type.xlsx', {
  '变更判定': [['变更类别', '变更类型', '变更等级', '条款号'], ['控制方案变更', '设备设施变更', '重大变更', 'Q/XX-虚构-001 第7条']],
});
r = run(['--tag', 'P-2103A', '--before', '低流量联锁值 12 m3/h', '--after', '低流量联锁值 8 m3/h', '--reason', 'x', '--spec', specType], 'spectype');
eq(r.j.changeType, 'equipment_facility', 'K12 厂内制度可改变三大类归属');
ok(r.j.warnings.some((w) => w.includes('归为「设备设施变更」')), 'K13 改归类有 warning');

// ============ L. 承压设备法定手续三项 ============
const led2 = mk('led2.xlsx', {
  '设备台账': [
    ['功能位置', '设备', '设备描述', '对象类型', '主体材质', '型号编号'],
    ['V-2301', '10000003', '低压分离器', '压力容器', '16MnR', 'φ1600×6000'],
    ['P-2101A', '10000001', '进料泵A', '离心泵', '316L', 'DA65-50×6'],
  ],
});
r = run(['--tag', 'V-2301', '--before', '筒体无取样口 DN1600', '--after', '筒体下部新增 DN25 取样管口', '--reason', '采样', '--ledger', led2], 'stat1');
ok(r.j.statutory && r.j.statutory.applies === true, 'L1 台账对象类型为压力容器→法定手续适用');
eq(r.j.counts.statutoryItems, 3, 'L2 三项法定手续');
ok(r.j.statutory.items.map((x) => x.item).join(',') === '改造告知,监督检验,使用登记变更', 'L3 三项名称正确');
ok(!/\d+\s*(年|个月|MPa)/.test(r.j.statutory.note), 'L4 法定手续只提示名称不写数值');
ok(/改造告知/.test(r.md) && /监督检验/.test(r.md) && /使用登记变更/.test(r.md), 'L5 md 第八节列出三项');
eq(r.j.equip.equipNo, '10000003', 'L6 SAP「设备」列读为设备编号');
eq(r.j.equip.category, '压力容器', 'L7 SAP 对象类型读为设备类别');
r = run(['--tag', '10000003', '--before', '筒体无取样口 DN1600', '--after', '筒体下部新增 DN25 取样管口', '--reason', '采样', '--ledger', led2], 'stat1b');
eq(r.j.equip && r.j.equip.name, '低压分离器', 'L8 台账可按 SAP 设备编号命中');
r = run(['--tag', 'P-2101A', '--before', '泵壳材质 316L', '--after', '泵壳材质 碳钢 Q345R', '--reason', '降本', '--category', '材质', '--ledger', led2], 'stat2');
ok(r.j.statutory && r.j.statutory.applies === null, 'L9 台账为离心泵且描述无承压词→待确认而非免办');
ok(r.j.undetermined.some((u) => /压力容器/.test(u.item)), 'L10 待确认项进入未判定清单');
ok(r.j.warnings.some((w) => w.includes('--special')), 'L11 warning 提示用 --special 确认');
r = run(['--tag', 'P-2101A', '--before', '泵壳材质 316L', '--after', '泵壳材质 碳钢 Q345R', '--reason', '降本', '--category', '材质', '--special', '否'], 'stat3');
eq(r.j.statutory, null, 'L12 --special 否 → 不附');
r = run(['--tag', 'P-2101A', '--before', '泵壳材质 316L', '--after', '泵壳材质 碳钢 Q345R', '--reason', '降本', '--category', '材质', '--special', '是'], 'stat4');
ok(r.j.statutory && r.j.statutory.applies === true && /用户指定/.test(r.j.statutory.source), 'L13 --special 是 → 适用且来源为用户指定');
r = run(['--tag', 'P-2103A', '--before', '低流量联锁值 12 m3/h', '--after', '低流量联锁值 8 m3/h', '--reason', 'x', '--special', '是'], 'stat5');
eq(r.j.statutory, null, 'L14 非结构/材质类不附法定手续');
eq(raw(['--tag', 'P-1', '--before', '材质 316L', '--after', '材质 碳钢', '--special', '也许']).s.ok, false, 'L15 --special 取值非法报错');

// ============ M. 归口与提报专业 ============
r = run(['--tag', 'C-2401', '--before', '操作压力 0.6 MPa', '--after', '操作压力 0.95 MPa', '--reason', '提量', '--exceeds-design', '是'], 'own1');
eq(r.j.ownership.equipmentEngineerCanSubmit, false, 'M1 工艺参数变更设备员不可直接提报');
ok(/工艺专业/.test(r.j.ownership.owner), 'M2 由工艺专业提报');
ok(/由工艺专业提报/.test(r.j.basis), 'M3 依据写明由工艺专业提报');
ok(/不属于车间设备员提报范围/.test(r.md), 'M4 md 提示转交对应专业');
r = run(['--tag', 'P-2103A', '--before', '低流量联锁值 12 m3/h', '--after', '低流量联锁值 8 m3/h', '--reason', 'x'], 'own2');
ok(/仪表专业/.test(r.j.ownership.owner), 'M5 联锁定值由仪表专业提报');
r = run(['--tag', 'V-2301', '--before', '筒体无取样口 DN1600', '--after', '筒体下部新增 DN25 取样管口', '--reason', '采样', '--special', '是'], 'own3');
eq(r.j.ownership.equipmentEngineerCanSubmit, true, 'M6 结构改动设备员可提报');
ok(/## 三、归口与提报专业/.test(r.md), 'M7 md 第三节为归口');

// ============ N. U1 不被单个位号糊弄 ============
eq(R.describeQuality('换成 P-2101B').concrete, false, 'N1 只给位号不算具体');
ok(/只给了位号/.test(R.describeQuality('换成 P-2101B').reason), 'N2 原因写明只给了位号');
eq(R.describeQuality('用备用的 P-2101B 顶上').concrete, false, 'N3 「用备用的 X 顶上」不具体');
eq(R.describeQuality('IH100-65-200 换 IH100-65-250，扬程 50m→80m').concrete, true, 'N4 型号串仍算具体');
eq(R.describeQuality('ZA-100-250 泵').concrete, true, 'N5 三段型号不被当位号剥掉');
eq(R.describeQuality('换成 1000-CDU-P1101B').concrete, false, 'N6 SAP 功能位置也不算具体');
eq(R.describeQuality('这台设备现在的状态，按老办法运行着').concrete, false, 'N7 长句无技术名词不算具体');
eq(R.describeQuality('原泵型号：IH100-65-200，扬程 50 米，碳钢泵壳').concrete, true, 'N8 带技术名词的长句具体');
r = run(['--tag', 'P-2101A', '--before', 'P-2101A 在用', '--after', '换成 P-2101B', '--reason', '坏了'], 'tagonly');
eq(r.j.level, 'undetermined', 'N9 脚本层只给位号→未判定');
eq(r.j.ruleId, 'U1', 'N10 命中 U1');
eq(r.j.isChange, null, 'N11 不判为不属于变更');

// ============ O. 管理变更 ============
r = run(['--tag', 'X-1', '--before', '维保单位甲公司，制度 A 版', '--after', '维保单位乙公司，制度 B 版', '--reason', '合同到期', '--category', '管理'], 'mgmt');
eq(r.j.category, 'management', 'O1 管理变更类别');
eq(r.j.changeType, 'management', 'O2 归管理变更');
eq(r.j.level, 'undetermined', 'O3 无厂内制度时级别未判定');
eq(r.j.ruleId, 'U6', 'O4 命中 U6');
eq(r.j.isChange, null, 'O5 未判定不落为 false');
ok(!r.j.warnings.some((w) => w.includes('描述不足')), 'O6 管理变更不按参数/型号要求具体性');
ok(r.j.counts.assessItems > 0, 'O7 管理变更仍给评估项');
const specMg = mk('spec-mg.xlsx', { '变更判定': [['变更类别', '变更类型', '变更等级', '条款号'], ['管理变更', '管理变更', '一般变更', 'Q/XX-虚构-001 第4.4.1条']] });
r = run(['--tag', 'X-1', '--before', '维保单位甲公司，制度 A 版', '--after', '维保单位乙公司，制度 B 版', '--reason', '合同到期', '--category', '管理', '--spec', specMg], 'mgmt2');
eq(r.j.level, 'general', 'O8 厂内制度给出管理变更级别');
eq(r.j.counts.conflicts, 0, 'O9 U6 由厂内定级不算冲突');
eq(r.j.counts.undetermined, 0, 'O10 定级后无未判定');
r = run(['--tag', 'X-1', '--before', '', '--after', '维保单位乙公司', '--category', '管理'], 'mgmt3');
eq(r.s.ok, false, 'O11 管理变更原状态为空仍报缺 --before');

// ============ P. 厂内制度预填模板（assets） ============
const TPL = path.join(__dirname, '..', 'assets', 'templates', 'plant-spec-template.xlsx');
ok(fs.existsSync(TPL), 'P1 assets 含 --spec 预填模板 xlsx');
r = run(['--tag', 'E-2201', '--before', '管束材质 316L', '--after', '管束材质 碳钢 Q345R', '--reason', '降本', '--category', '材质', '--spec', TPL, '--special', '是'], 'tpl');
eq(r.s.ok, true, 'P2 模板可直接作为 --spec 读入');
ok(!r.j.warnings.some((w) => w.includes('无法识别')), 'P3 模板各行类别与等级均可识别');
eq(r.j.counts.conflicts, 0, 'P4 模板预填级别与默认口径一致（材质降级重大）');
ok(/一致/.test(r.j.basis), 'P5 依据注明与模板条款一致');
r = run(['--tag', 'P-2101A', '--before', '机封 316L 型号 5610 A厂', '--after', '机封 316L 型号 5610 B厂 同规格', '--reason', 'x', '--category', '备件代用', '--spec', TPL], 'tpl2');
eq(r.j.level, 'review', 'P6 模板中备件代用预填为厂内评审');

// ============ Q. 其它口径 ============
{
  const x = spawnSync(process.execPath, [MOC, '--tag', 'E-2201', '--before', '管束材质 316L', '--after', '管束材质 碳钢 Q345R', '--category', '材质', '--special', '否'], { encoding: 'utf8', cwd: work });
  const l = x.stdout.trim().split('\n');
  let sj = {}; try { sj = JSON.parse(l[l.length - 1]); } catch (e) {}
  ok(sj.ok === true && sj.out && sj.out.startsWith(os.tmpdir()), 'Q1 默认输出目录在 os.tmpdir()');
  ok(!fs.existsSync(path.join(work, 'moc-out')), 'Q2 不在当前目录生成 moc-out');
}
r = run(['--tag', 'E-2201', '--before', '管束材质 316L', '--after', '管束材质 碳钢 Q345R', '--reason', '降本', '--category', '材质', '--special', '是'], 'misc');
ok(/车间设备主任 \/ 公司设备管理部门/.test(r.md), 'Q3 md 写明交付对象');
ok(/《中国石化变更管理规定》/.test(r.md), 'Q4 声明行引用中石化变更管理规定');
ok(r.j.docUpdates.some((d) => /EM \/ SAP PM/.test(d.doc)), 'Q5 资料清单台账写 EM / SAP PM');
ok(r.j.assessItems.find((x) => x.discipline === '安全').items.every((i) => !/动火/.test(i)), 'Q6 评估项不用「动火」');
ok(r.j.docUpdates.every((d) => !/交接班/.test(d.doc)), 'Q7 资料清单不用「交接班」');
eq(r.s.changeType, '设备设施变更', 'Q8 末行摘要含变更类型');


// ============ R. references / 模板 / README 与脚本口径一致 ============
{
  const rd = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const rules = rd('references/moc-rules.md'), docmap = rd('references/doc-update-map.md'), chk = rd('references/checklist.md');
  const tpl = rd('assets/templates/moc-template.md'), skill = rd('SKILL.md'), readme = rd('scripts/README.md');
  ok(/R8/.test(rules) && /U6/.test(rules) && /待厂内评审/.test(rules) && /改造告知/.test(rules), 'R1 moc-rules.md 含 R8/U6/待厂内评审/法定手续');
  ok(/工艺技术变更/.test(rules) && /设备设施变更/.test(rules) && /管理变更/.test(rules), 'R2 moc-rules.md 写明三大类');
  ok(!/临时变更 \| 有明确期限的临时措施/.test(rules), 'R3 moc-rules.md 不再把「临时变更」列为级别');
  ok(!/交接班记录/.test(docmap) && /值班与工作交接记录/.test(docmap) && /EM \/ SAP PM/.test(docmap), 'R4 doc-update-map.md 与 DOC_MAP 同源（值班交接、EM/SAP PM）');
  for (const [cat, list] of Object.entries(R.DOC_MAP)) for (const [doc] of list) ok(docmap.includes(doc), `R5 doc-update-map.md 含 DOC_MAP[${cat}]「${doc}」`);
  ok(chk.includes('本判定为辅助参考，变更是否成立、变更类型、级别与审批要求以厂内变更管理部门按《中国石化变更管理规定》及厂内实施细则认定为准'), 'R6 checklist 声明行与脚本一致');
  ok(/## 十、变更申请要点提示/.test(tpl) && /## 八、特种设备法定手续提示/.test(tpl) && /## 三、归口与提报专业/.test(tpl), 'R7 模板为十节且含归口与法定手续');
  ok(/十节/.test(skill) && /--special/.test(skill) && /工艺 \/ 仪表专业提报/.test(skill), 'R8 SKILL.md 预期结果十节、参数含 --special、写明归口');
  ok(/os\.tmpdir\(\)/.test(readme) && /review/.test(readme) && /--special/.test(readme), 'R9 scripts/README.md 默认输出目录、review 态与 --special 已写明');
  ok(/agent_created: true/.test(skill) && /allowed-tools: Read,Write,Bash/.test(skill), 'R10 SKILL.md 保留 agent_created 与 allowed-tools');
}

console.log(`\n${'='.repeat(56)}`);
console.log(`moc-change-assistant 自测：${pass} 通过，${fail} 失败`);
if (failures.length) { console.log('\n失败项：'); failures.forEach((f) => console.log('  ✗ ' + f)); }
console.log('='.repeat(56));
try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
