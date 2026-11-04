#!/usr/bin/env node
'use strict';
/** 自测：断言 triage.js 与 rules.js 行为。用法：node scripts/selftest.js（全绿退出 0） */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { writeXlsx } = require('./lib/xlsx-lite');
const R = require('./lib/rules');

const TRIAGE = path.join(__dirname, 'triage.js');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ata-selftest-'));
const DATE = '2026-09-21';
let pass = 0, fail = 0;
const failures = [];
const ok = (c, n) => { if (c) pass++; else { fail++; failures.push(n); } };
const eq = (a, e, n) => ok(a === e, `${n}（期望 ${JSON.stringify(e)}，实际 ${JSON.stringify(a)}）`);

function run(args, tag) {
  const out = path.join(work, tag + '-out');
  const r = spawnSync(process.execPath, [TRIAGE, ...args, '--out', out], { encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  let s; try { s = JSON.parse(lines[lines.length - 1]); } catch (e) { s = { ok: false, error: 'no-json:' + r.stdout + r.stderr }; }
  let j = null, md = null;
  if (fs.existsSync(path.join(out, 'triage.json'))) j = JSON.parse(fs.readFileSync(path.join(out, 'triage.json'), 'utf8'));
  if (fs.existsSync(path.join(out, 'triage.md'))) md = fs.readFileSync(path.join(out, 'triage.md'), 'utf8');
  return { code: r.status, s, j, md, out };
}
const mk = (n, b) => { const p = path.join(work, n); writeXlsx(p, b); return p; };
const cand = (j, cause) => j.candidates.find((c) => c.cause === cause);
const TRIAGE_SRC = fs.readFileSync(TRIAGE, 'utf8');
ok(/C\.mergeAliases\(/.test(TRIAGE_SRC), 'Z0 ALIASES 使用 C.mergeAliases 合并共享别名');
const ALIASES_HAS = (() => {
  // 从 triage.js 源码抽取局部别名并合并，避免 require 主脚本触发 main()
  const m = TRIAGE_SRC.match(/const ALIASES = C\.mergeAliases\((\{[\s\S]*?\n\})\);/);
  const local = m ? eval('(' + m[1] + ')') : {};
  const merged = require('./lib/common').mergeAliases(local);
  return (k, al) => (merged[k] || []).includes(al);
})();

// ============ A. 规则引擎单元测试：分类与解析 ============
eq(R.classifyEquipType('离心泵'), 'pump', 'A1 离心泵→泵类');
eq(R.classifyEquipType('往复压缩机'), 'compressor', 'A2 往复压缩机→机组类');
eq(R.classifyEquipType('管壳式换热器'), 'static', 'A3 换热器→静设备类');
eq(R.classifyEquipType('高压电机'), 'electrical', 'A4 电机→电仪类');
eq(R.classifyEquipType('胶带输送机'), 'generic', 'A5 未覆盖类型→generic（不硬套）');
eq(R.classifyEquipType(''), 'generic', 'A6 类型为空→generic');
// 最长匹配 / 末尾词优先 / 安全阀单列
eq(R.classifyEquipType('离心压缩机'), 'compressor', 'A16 「离心压缩机」不被「泵/机」误抢→机组类');
eq(R.classifyEquipType('循环氢压缩机电机'), 'electrical', 'A17 末尾词「电机」优先→电仪类');
eq(R.classifyEquipType('泵用电机'), 'electrical', 'A18 「泵用电机」末尾词电机→电仪类');
eq(R.classifyEquipType('电机驱动离心泵'), 'pump', 'A19 末尾词「泵」→泵类');
eq(R.classifyEquipType('柴油加氢进料泵A'), 'pump', 'A20 带后缀 A 时取最长命中→泵类');
eq(R.classifyEquipType('塔顶空冷器'), 'static', 'A21 空冷器→静设备');
eq(R.classifyEquipType('安全阀'), 'safetyValve', 'A22 安全阀单列类型，不并入静设备');
eq(R.classifyEquipType('弹簧式安全阀'), 'safetyValve', 'A23 弹簧式安全阀→安全阀');
eq(R.classifyEquipType('调节阀'), 'static', 'A24 调节阀仍归静设备');
ok(!!R.PATTERNS.safetyValve && R.PATTERNS.safetyValve.leak.length >= 3, 'A25 安全阀有独立口径表');
ok(/校验报告/.test(R.TYPE_CN.safetyValve), 'A26 安全阀类型名注明校验以厂内规定与校验报告为准');
ok(R.classifySymptoms('泵振动大还有异响').includes('vibration'), 'A7 识别振动');
ok(R.classifySymptoms('泵振动大还有异响').includes('noise'), 'A8 同时识别异响');
eq(R.classifySymptoms('说不上来哪里不对').join(''), 'other', 'A9 无法识别→other');
eq(R.parseSudden(''), null, 'A10 是否突发为空→null不是false');
eq(R.parseSudden('是'), true, 'A11 是→true');
eq(R.parseSudden('渐变'), false, 'A12 渐变→false');
eq(R.parseAffects(''), null, 'A13 是否影响运行为空→null不是false');
eq(R.parseAffects('不影响'), false, 'A14 不影响→false');
eq(R.parseAffects('是'), true, 'A15 影响→true');

// ============ B. 规则引擎：证据探针不做默认 ============
eq(R.runProbe('freq2x', {}).verdict, 'unknown', 'B1 字段缺失→unknown');
eq(R.runProbe('freq2x', { spectrum: '' }).verdict, 'unknown', 'B2 字段空串→unknown');
eq(R.runProbe('freq2x', { spectrum: '以2倍频为主' }).verdict, 'support', 'B3 命中→support');
eq(R.runProbe('freq2x', { spectrum: '工频为主' }).verdict, 'against', 'B4 反向→against');
eq(R.runProbe('freq2x', { spectrum: '看不清楚' }).verdict, 'unknown', 'B5 无法归类→unknown不是against');
eq(R.runProbe('hasHistory', {}).verdict, 'unknown', 'B6 无历史记录→unknown（不当作反证）');

// ============ C. 规则引擎：undetermined 绝不剔除候选（最关键约束） ============
const tEmpty = R.triage({ equipType: '离心泵', symptoms: ['vibration'], evidence: {} });
eq(tEmpty.covered, true, 'C1 泵类被覆盖');
ok(tEmpty.candidates.length >= 7, `C2 泵振动候选原因不少于7项（实际 ${tEmpty.candidates.length}）`);
ok(tEmpty.candidates.every((c) => c.undetermined), 'C3 无任何证据时全部候选判未判定');
eq(tEmpty.undetermined.length, tEmpty.candidates.length, 'C4 未判定数=候选数（一个都没被删）');
ok(tEmpty.candidates.some((c) => c.cause === '汽蚀'), 'C5 缺数据时汽蚀仍在候选中，未被排除');
ok(tEmpty.candidates.some((c) => c.cause === '联轴器不对中'), 'C6 缺数据时不对中仍在候选中');
ok(tEmpty.candidates.some((c) => c.cause === '转子弯曲'), 'C7 缺数据时转子弯曲仍在候选中');
ok(tEmpty.undetermined.every((u) => /仍保留在候选中|不予排除/.test(u.note)), 'C8 未判定说明写明不予排除');
ok(tEmpty.undetermined.every((u) => u.missing.length > 0), 'C9 未判定列出具体缺失字段');

// 给一部分证据：被证据覆盖的原因不再未判定，未覆盖的仍未判定且仍在候选里
const tPartial = R.triage({ equipType: '离心泵', symptoms: ['vibration'], evidence: { spectrum: '高频冲击明显', bearingTemp: '升高' } });
ok(cand(tPartial, '滚动轴承损伤').likelihood === 'high', 'C10 高频+轴承温升→轴承损伤可能性较高');
ok(!cand(tPartial, '滚动轴承损伤').undetermined, 'C11 有依据的原因不判未判定');
ok(cand(tPartial, '基础或地脚松动').undetermined, 'C12 无相关依据的原因判未判定');
ok(tPartial.candidates.length === tEmpty.candidates.length, 'C13 给部分证据后候选总数不变（不删不增）');
ok(cand(tPartial, '联轴器不对中').againsts.length > 0, 'C14 高频频谱构成不对中的反证');
ok(!cand(tPartial, '联轴器不对中').undetermined, 'C15 被反证的原因不算未判定');
ok(cand(tPartial, '联轴器不对中').likelihood !== 'undetermined', 'C16 被反证的原因仍给出可能性，未被剔除');

// ============ D. 规则引擎：不给确定性结论 ============
ok(tPartial.candidates.every((c) => c.needVerify === true), 'D1 每条候选都带 needVerify');
ok(tPartial.candidates.every((c) => /需核实|未判定/.test(c.likelihoodCn)), 'D2 可能性文案一律含「需核实」或「未判定」');
ok(!Object.values(R.LIKELIHOOD_CN).some((v) => /确认|确定|就是|断定/.test(v)), 'D3 可能性文案无定论措辞');
ok(cand(tPartial, '基础或地脚松动').evidenceLevel === 'speculative', 'D4 无支持依据的原因标 speculative');
ok(cand(tPartial, '滚动轴承损伤').evidenceLevel === 'evidenced', 'D5 有支持依据的原因标 evidenced');

// ============ E. 规则引擎：类型未覆盖只给通用框架 ============
const tGen = R.triage({ equipType: '胶带输送机', symptoms: ['vibration'], evidence: {} });
eq(tGen.covered, false, 'E1 未覆盖类型 covered=false');
eq(tGen.candidates.length, R.GENERIC_FRAME.length, 'E2 只给通用框架条目');
ok(tGen.candidates.every((c) => c.cause.startsWith('通用框架')), 'E3 通用框架项名称带前缀，不冒充具体原因');
ok(!tGen.candidates.some((c) => /汽蚀|不对中|动平衡/.test(c.cause)), 'E4 未把泵类具体原因套到未覆盖类型上');
ok(tGen.notes.some((n) => /不在知识库覆盖范围/.test(n)), 'E5 给出类型不覆盖的提示');
// 类型覆盖但现象无对应条目 → 同样落通用框架
const tNoSym = R.triage({ equipType: '离心泵', symptoms: ['instrument'], evidence: {} });
eq(tNoSym.covered, true, 'E6 泵类仍算覆盖');
eq(tNoSym.usedGeneric, true, 'E7 现象无对应条目→落通用框架');
ok(tNoSym.notes.some((n) => /无对应条目/.test(n)), 'E8 提示该现象无对应条目');

// ============ F. 规则引擎：风险等级与上报建议不做默认 ============
eq(R.riskLevel({ symptoms: ['vibration'], sudden: null, affectsRun: false }).level, 'undetermined', 'F1 是否突发缺失→风险未判定');
eq(R.riskLevel({ symptoms: ['vibration'], sudden: false, affectsRun: null }).level, 'undetermined', 'F2 是否影响运行缺失→风险未判定');
ok(R.riskLevel({ symptoms: ['vibration'], sudden: null, affectsRun: null }).missing.length === 2, 'F3 列出两项缺失字段');
eq(R.riskLevel({ symptoms: ['vibration'], sudden: true, affectsRun: true }).level, '红', 'F4 突发+影响运行→红');
eq(R.riskLevel({ symptoms: ['leak'], sudden: false, affectsRun: false }).level, '橙', 'F5 泄漏渐变不影响→橙');
eq(R.riskLevel({ symptoms: ['vibration'], sudden: false, affectsRun: false }).level, '黄', 'F6 渐变不影响→黄');
ok(!/停机|降负荷|抢修/.test(Object.values(R.RISK_CN).join('')), 'F7 风险等级文案不含停机/降负荷/抢修');
ok(!Object.keys(R.RISK_CN).some((k) => /^[ABC]$/.test(k)), 'F11 关注度键不再用 A/B/C（避免与设备重要度撞名）');
eq(R.normRiskLevel('A'), '红', 'F12 旧口径 A→红');
eq(R.normRiskLevel('B级'), '橙', 'F13 旧口径 B级→橙');
eq(R.normRiskLevel('c'), '黄', 'F14 旧口径 c→黄');
eq(R.normRiskLevel('红色'), '红', 'F15 红色→红');
eq(R.normRiskLevel('紫'), null, 'F16 无法识别→null 不默认');
ok(/车间设备主任/.test(R.escalation({ level: '红' }, 5, 0).text), 'F17 红级上报对象含车间设备主任');
const rSp = R.riskLevel({ symptoms: ['vibration'], sudden: null, affectsRun: null, special: true });
eq(rSp.level, '红', 'F18 特护设备缺项仍按最高档红');
eq(rSp.ruleId, 'RK0', 'F19 特护规则号 RK0');
ok(/公司设备管理部门/.test(R.escalation(rSp, 5, 0).text), 'F20 特护上报含公司设备管理部门');
ok(/【注意】/.test(R.escalation(rSp, 5, 0).text), 'F21 特护上报用【注意】不用 emoji');
eq(R.riskLevel({ symptoms: ['vibration'], sudden: false, affectsRun: false, special: false }).level, '黄', 'F22 special=false 不抬档');
const escU = R.escalation(R.riskLevel({ symptoms: ['vibration'], sudden: null, affectsRun: null }), 5, 2);
eq(escU.escalate, null, 'F8 风险未判定时不给上报结论');
ok(/不给出上报建议|补齐/.test(escU.text), 'F9 说明需补齐信息');
ok(/不包含是否停机/.test(R.escalation({ level: '红' }, 5, 0).text), 'F10 红级上报文案声明不含停机意见');

// ============ G. 正常路径：脚本产出与计数 ============
const params = mk('params.xlsx', {
  '运行参数': [
    ['位号', '设备名称', '参数名', '参数值', '基准值', '单位', '记录时间', '备注'],
    ['P-101A', '进料泵A', '驱动端轴承温度', 78, 62, '℃', `${DATE} 08:30`, ''],
    ['P-101A', '进料泵A', '振动频谱特征', '', '', '', `${DATE} 08:30`, '高频冲击成分明显'],
    ['P-101A', '进料泵A', '出口流量', 120, 120, 't/h', `${DATE} 08:30`, '流量平稳'],
    ['P-999', '别的泵', '驱动端轴承温度', 90, 60, '℃', `${DATE} 08:30`, ''],
  ],
});
let r = run(['--symptom', '泵振动比平时大', '--equip-type', '离心泵', '--tag', 'P-101A',
  '--name', '进料泵A', '--params', params, '--sudden', '否', '--affects-run', '否', '--dev-pct', '温度=10,流量=5'], 'normal');
eq(r.s.ok, true, 'G1 正常路径 ok:true');
eq(r.code, 0, 'G2 退出码0');
eq(r.j.meta.equipType, 'pump', 'G3 设备类型归为泵类');
eq(r.j.counts.params, 3, 'G4 只取本机位号的参数行（P-999 被排除）');
ok(r.j.counts.candidates >= 7, 'G5 候选原因数不少于7');
eq(r.j.riskLevel.level, '黄', 'G6 渐变不影响运行→黄');
ok(cand(r.j, '滚动轴承损伤').likelihood === 'high', 'G7 轴承损伤排在可能性较高');
eq(r.j.candidates[0].cause, '滚动轴承损伤', 'G8 可能性最高的排第一');
ok(r.j.candidates.every((c) => c.needVerify), 'G9 每条候选都标需核实');
ok(r.j.counts.checkItems > 0, 'G10 生成建议核实项');
ok(r.j.evidence.some((e) => /参数表/.test(e.source)), 'G11 参数依据标注了来源到行');

// ============ H. 六节结构与声明行 ============
ok(/## 一、现象复述/.test(r.md), 'H1 第一节 现象复述');
ok(/## 二、可能原因排序/.test(r.md), 'H2 第二节 可能原因排序');
ok(/## 三、建议核实项/.test(r.md), 'H3 第三节 建议核实项');
ok(/## 四、建议动作/.test(r.md), 'H4 第四节 建议动作');
ok(/## 五、未判定项/.test(r.md), 'H5 第五节 未判定项');
ok(/## 六、上报建议/.test(r.md), 'H6 第六节 上报建议');
eq((r.md.match(/本结论为初判辅助，由脚本汇总、模型成文，不替代专业诊断与停机决策，须由设备工程师或车间设备主任复核；厂内制度与系统数据为准/g) || []).length, 2, 'H7 声明行开头结尾各一处');
eq(r.j.meta.disclaimer, R.DISCLAIMER, 'H8 JSON 中保留声明行原文');
ok(/<!-- ANALYSIS_START -->/.test(r.md) && /<!-- ANALYSIS_END -->/.test(r.md), 'H9 分析段占位符存在');
ok(/failure-case-retrieval/.test(r.md), 'H10 提示可接案例检索技能');
ok(/不给出是否停机、是否降负荷、是否抢修的意见/.test(r.md), 'H11 md 明示不给停机意见');
ok(/由诊断或检测人员出具/.test(r.md), 'H12 md 明示不代判频谱/油液/无损结论');
ok(fs.existsSync(path.join(r.out, 'summary.json')), 'H13 summary.json 落盘');
ok(fs.existsSync(path.join(r.out, 'triage.json')), 'H14 triage.json 生成');
ok(!/[⚠✅❌]/.test(r.md), 'H15 md 不含 emoji');
ok(/红\/橙\/黄 三档/.test(r.md), 'H16 md 说明关注度为红/橙/黄三档');
ok(!/[ABC] 级（建议/.test(r.md), 'H17 md 不再出现 A/B/C 级关注度');
ok(/维修通知单/.test(r.md), 'H18 md 衔接 SAP 维修通知单');
ok(/本技能不生成工单/.test(r.md), 'H19 md 声明不生成工单（工单由计划员/维修单位创建）');
ok(/defect-intake-grading/.test(r.md), 'H20 md 提示可接缺陷分级技能');
eq(r.j.meta.attentionScheme, '红/橙/黄（旧 A/B/C 对应 红/橙/黄）', 'H21 JSON 标注关注度口径');

// ============ I. undetermined 在脚本层单列且不被剔除 ============
r = run(['--symptom', '泵振动比平时大', '--equip-type', '离心泵', '--tag', 'P-101A'], 'noevidence');
eq(r.s.ok, true, 'I1 无任何附件仍能出报告');
ok(r.j.counts.undetermined > 0, 'I2 缺数据时有未判定项');
eq(r.j.riskLevel.level, 'undetermined', 'I3 未给突发与影响运行→风险未判定');
ok(r.j.warnings.some((w) => /未按最轻或最重默认/.test(w)), 'I4 warning 说明未按最宽松或最严格默认');
ok(!r.j.warnings.some((w) => /特护/.test(w)), 'I4b 未标特护时 warning 不提特护');
// 未判定项仍在 candidates 里
for (const u of r.j.undetermined) ok(!!cand(r.j, u.cause), `I5-${u.ruleId} 未判定项「${u.cause}」仍在候选清单中`);
ok(/仍保留在候选清单内/.test(r.md), 'I6 md 写明未判定项不算排除');
ok(r.j.undetermined.every((u) => u.missing.length), 'I7 每条未判定列出缺失字段');
ok(r.j.missingFields.length > 0, 'I8 汇总建议补充的数据项');
ok(/建议补充以下数据后重新初判/.test(r.md), 'I9 md 给出补数据建议');
// 未判定项的核实项优先级最高
ok(r.j.checkItems[0].priority === '高（补齐后可判定）', 'I10 未判定项的核实项排最前');

// ============ J. 类型未覆盖 → 只给通用框架 + warning ============
r = run(['--symptom', '运行时振动比平时大', '--equip-type', '胶带输送机', '--tag', 'BC-01'], 'uncovered');
eq(r.s.ok, true, 'J1 未覆盖类型不报错');
eq(r.s.covered, false, 'J2 摘要标 covered=false');
ok(r.j.warnings.some((w) => /不在知识库覆盖范围/.test(w)), 'J3 warning 提示类型不覆盖');
ok(r.j.candidates.every((c) => /^通用框架/.test(c.cause)), 'J4 只给通用框架项');
ok(!r.j.candidates.some((c) => /汽蚀|不对中|轴承损伤/.test(c.cause)), 'J5 未编造具体原因');
ok(/不构成针对该设备类型的具体原因判断/.test(r.md), 'J6 md 明示只是通用框架');
ok(/> 【注意】/.test(r.md), 'J6b 通用框架提示用【注意】而非 emoji');
// 类型完全不填
r = run(['--symptom', '有异响', '--tag', 'X-01'], 'notype');
ok(r.j.warnings.some((w) => /未提供 --equip-type/.test(w)), 'J7 未填类型时 warning');
eq(r.s.covered, false, 'J8 未填类型 covered=false');

// ============ K. 缺列/缺表/数值不可解析 ============
const badSheet = mk('badsheet.xlsx', { '别的表': [['a', 'b'], [1, 2]] });
r = run(['--symptom', '振动大', '--equip-type', '离心泵', '--tag', 'P-101A', '--params', badSheet], 'badsheet');
eq(r.s.ok, true, 'K1 参数表缺失不中断（非唯一数据源）');
ok(r.j.warnings.some((w) => /未找到「运行参数」工作表/.test(w)), 'K2 缺表 warning');
const badNum = mk('badnum.xlsx', {
  '运行参数': [
    ['位号', '参数名', '参数值', '基准值', '单位'],
    ['P-101A', '驱动端轴承温度', '偏高', 62, '℃'],
    ['P-101A', '出口流量', 120, 120, 't/h'],
  ],
});
r = run(['--symptom', '振动大', '--equip-type', '离心泵', '--tag', 'P-101A', '--params', badNum], 'badnum');
ok(r.j.warnings.some((w) => /无法解析为数字/.test(w)), 'K3 数值不可解析 warning');
eq(r.j.params[0].value, null, 'K4 不可解析的数值为 null 不是 0');
eq(r.j.params[0].trend, null, 'K5 值为 null 时不做趋势比较');
const noBase = mk('nobase.xlsx', {
  '运行参数': [['位号', '参数名', '参数值', '基准值'], ['P-101A', '驱动端轴承温度', 78, '']],
});
r = run(['--symptom', '振动大', '--equip-type', '离心泵', '--tag', 'P-101A', '--params', noBase], 'nobase');
eq(r.j.params[0].base, null, 'K6 基准值空为 null');
eq(r.j.params[0].trend, null, 'K7 无基准时不判「升高」，保持未判定');
ok(cand(r.j, '滚动轴承损伤').undetermined, 'K8 无基准→依赖轴承温度的原因仍判未判定');
// 参数表里没有本机位号
r = run(['--symptom', '振动大', '--equip-type', '离心泵', '--tag', 'P-777', '--params', params], 'notag');
ok(r.j.warnings.some((w) => /没有位号「P-777」的参数行/.test(w)), 'K9 无本机参数行 warning');
eq(r.j.counts.params, 0, 'K10 无本机参数行计数为0');

// ============ L. 历史记录：提示但不改排序 ============
const hist = mk('hist.xlsx', {
  '故障记录': [
    ['位号', '故障日期', '故障现象', '故障原因', '处理措施'],
    ['P-101A', '2025-11-12', '振动偏大', '联轴器不对中', '重新找正'],
    ['P-202B', '2026-01-05', '振动偏大', '滚动轴承损伤', '更换轴承'],
  ],
});
const withHist = run(['--symptom', '泵振动比平时大', '--equip-type', '离心泵', '--tag', 'P-101A',
  '--params', params, '--sudden', '否', '--affects-run', '否', '--history', hist], 'hist');
eq(withHist.j.counts.history, 1, 'L1 只取本机历史记录');
ok(withHist.j.historyHints.some((h) => h.cause === '联轴器不对中'), 'L2 生成历史提示');
// 同一组参数下，加不加历史记录，候选排序必须完全一致
eq(withHist.j.candidates.map((c) => c.cause).join('>'),
   run(['--symptom', '泵振动比平时大', '--equip-type', '离心泵', '--tag', 'P-101A',
     '--params', params, '--sudden', '否', '--affects-run', '否'], 'nohist').j.candidates.map((c) => c.cause).join('>'),
   'L3 历史提示不改变候选排序');
ok(/仅供参考，不据此锁定结论/.test(withHist.md), 'L4 md 声明历史提示不锁结论');
r = run(['--symptom', '振动大', '--equip-type', '离心泵', '--tag', 'P-101A', '--history', hist], 'histonly');
ok(r.j.warnings.some((w) => /未提供 --params/.test(w)), 'L5 未提供参数时 warning');

// ============ M. 参数解析细节：合计行、别名列头、标题行 ============
const alias = mk('alias.xlsx', {
  '运行参数': [
    ['某装置参数导出'],
    [],
    ['设备位号', '监测项目', '测值', '参考值', '单位', '采集时间'],
    ['P-101A', '驱动端轴承温度', 78, 62, '℃', `${DATE} 08:30`],
    ['合计', '', '', '', '', ''],
  ],
});
r = run(['--symptom', '振动大', '--equip-type', '离心泵', '--tag', 'P-101A', '--params', alias, '--dev-pct', '15'], 'alias');
eq(r.s.ok, true, 'M1 别名列头可读');
eq(r.j.counts.params, 1, 'M2 合计行被跳过');
ok(r.j.warnings.some((w) => /合计行/.test(w)), 'M3 合计行 warning');
eq(r.j.params[0].trend, '升高', 'M4 标题行下的表头识别正确并完成比较');

// ============ Q. 偏差阈值参数化：无阈值不判、--dev-pct 按类型、限值表、行内高报/低报 ============
r = run(['--symptom', '振动大', '--equip-type', '离心泵', '--tag', 'P-101A', '--params', params], 'nothr');
eq(r.s.ok, true, 'Q1 无阈值不报错');
eq(r.j.params[0].trend, null, 'Q2 有实测有基准但无阈值→trend null（不按 15% 默认）');
eq(r.j.params[0].thresholdSource, null, 'Q3 阈值来源为空');
ok(r.j.warnings.some((w) => /未提供偏差阈值/.test(w) && /未按固定百分比默认/.test(w)), 'Q4 warning 说明未按固定百分比默认');
ok(cand(r.j, '滚动轴承损伤').supports.every((x) => x.field !== 'bearingTemp'), 'Q5 无阈值时轴承温度不构成支持依据');
eq(r.j.counts.paramsNoThreshold, 2, 'Q6 计数缺阈值参数项（轴承温度、出口流量）');
ok(/未提供（不按固定百分比默认）/.test(r.md), 'Q7 md 写明阈值来源未提供');
r = run(['--symptom', '振动大', '--equip-type', '离心泵', '--tag', 'P-101A', '--params', params, '--dev-pct', '温度=30'], 'devhi');
eq(r.j.params[0].trend, '正常', 'Q8 温度阈值 30% 时 78 vs 62（+25.8%）判正常（阈值生效）');
eq(r.j.params[2].trend, null, 'Q9 只给温度阈值时流量仍不判');
r = run(['--symptom', '振动大', '--equip-type', '离心泵', '--tag', 'P-101A', '--params', params, '--dev-pct', '温度=10'], 'devlo');
eq(r.j.params[0].trend, '升高', 'Q10 温度阈值 10% 时判升高');
eq(r.j.params[0].kind, '温度', 'Q11 参数类型识别为温度');
ok(/--dev-pct 温度=10%/.test(r.j.params[0].thresholdSource), 'Q12 阈值来源写明 --dev-pct');
ok(/阈值 ±10%/.test(r.j.evidence.find((e) => e.field === 'bearingTemp').source), 'Q13 依据来源写明阈值');
r = run(['--symptom', '振动大', '--equip-type', '离心泵', '--tag', 'P-101A', '--params', params, '--dev-pct', '8'], 'devall');
eq(r.j.params[0].trend, '升高', 'Q14 单一数字阈值对所有类型生效');
eq(r.j.params[2].trend, '正常', 'Q15 流量 120 vs 120 判正常');
eq(raw(['--symptom', 'x', '--tag', 'P', '--dev-pct', '温度十']).s.ok, false, 'Q16 非法 --dev-pct 报错');
const limits = mk('limits.xlsx', {
  '限值': [
    ['位号', '参数名', '参数类型', '偏差阈值%', '上限', '下限'],
    ['P-101A', '驱动端轴承温度', '温度', '', 70, ''],
    ['', '出口流量', '流量', 5, '', ''],
  ],
});
r = run(['--symptom', '振动大', '--equip-type', '离心泵', '--tag', 'P-101A', '--params', params, '--limits', limits], 'limits');
eq(r.s.ok, true, 'Q17 限值表可读');
eq(r.j.counts.limits, 2, 'Q18 限值行计数');
eq(r.j.params[0].trend, '升高', 'Q19 按限值表上限 70 判升高（78>70）');
ok(/限值表/.test(r.j.params[0].thresholdSource), 'Q20 阈值来源写明限值表');
eq(r.j.params[2].trend, '正常', 'Q21 无位号的限值行按参数名匹配，偏差阈值 5% 判正常');
eq(r.j.params[0].upper, 70, 'Q22 上限写入 params');
const rowLim = mk('rowlim.xlsx', {
  '运行参数': [
    ['位号', '参数名', '参数值', '基准值', '高报', '低报'],
    ['P-101A', '驱动端轴承温度', 78, 62, 75, ''],
    ['P-101A', '入口压力', 0.25, 0.4, '', 0.3],
    ['P-101A', '出口流量', 120, 120, '', 90],
  ],
});
r = run(['--symptom', '振动大', '--equip-type', '离心泵', '--tag', 'P-101A', '--params', rowLim], 'rowlim');
eq(r.j.params[0].trend, '升高', 'Q23 参数表行内「高报」列作上限→升高');
eq(r.j.params[1].trend, '偏低', 'Q24 行内「低报」列作下限→偏低');
eq(r.j.params[2].trend, '正常', 'Q25 在限值内→正常');
eq(r.j.params[0].thresholdSource, '参数表行内上下限', 'Q26 来源写明行内上下限');
eq(r.j.counts.paramsNoThreshold, 0, 'Q27 行内有限值时不计缺阈值');
eq(raw(['--symptom', 'x', '--tag', 'P', '--limits', '/不存在.xlsx']).s.ok, false, 'Q28 限值表不存在报错');
eq(R.compareToBase({ value: 10, base: 0, devPct: 10 }).trend, null, 'Q29 基准为 0 不判');
eq(R.compareToBase({ value: 10, base: 8 }).trend, null, 'Q30 无 devPct 无上下限 → null');
eq(R.classifyParamKind('驱动端振动', 'mm/s'), '振动', 'Q31 振动类型识别');
eq(R.classifyParamKind('电机电流', 'A'), '电流', 'Q32 电流类型识别');
eq(R.classifyParamKind('出口压力', 'MPa'), '压力', 'Q33 压力类型识别');
eq(R.classifyParamKind('某指标', ''), '其他', 'Q34 无法识别→其他');

// ============ R. 中石化系统列名（SYSTEM_ALIASES 合并）与带单位数值 ============
const dcs = mk('dcs.xlsx', {
  'DCS趋势': [
    ['功能位置', '设备', '技术对象描述', '测点号', '检查项', '测量值', '基准值', '高报', '采集时间', '备注'],
    ['P-101A', '10045678', '进料泵A', 'TI-1011', '驱动端轴承温度', '78℃', '62℃', '70', `${DATE} 08:30`, ''],
    ['P-101A', '10045678', '进料泵A', 'VI-1011', '驱动端振动', '6.2mm/s', '3.5mm/s', '7.1', `${DATE} 08:30`, ''],
    ['10045678', '10045678', '进料泵A', 'FI-1010', '出口流量', '120t/h', '120t/h', '', `${DATE} 08:30`, '流量平稳'],
  ],
});
r = run(['--symptom', '振动大', '--equip-type', '离心泵', '--tag', 'P-101A', '--params', dcs], 'dcs');
eq(r.s.ok, true, 'R1 DCS/EM 列名可读');
eq(r.j.counts.params, 2, 'R2 功能位置作位号；「设备」8 位流水号不作位号（第 3 行被排除）');
eq(r.j.params[0].value, 78, 'R3 带单位「78℃」解析为 78');
eq(r.j.params[0].base, 62, 'R4 基准「62℃」解析为 62');
eq(r.j.params[1].value, 6.2, 'R5 「6.2mm/s」解析为 6.2');
eq(r.j.params[0].trend, '升高', 'R6 高报列作上限判升高');
eq(r.j.params[0].tagNo, 'TI-1011', 'R7 测点号列读入');
eq(r.j.params[0].equipNo, '10045678', 'R8 设备编号单列展示');
ok(r.j.warnings.some((w) => /已剥离单位/.test(w)), 'R9 带单位数值 warning 提示核对单位');
eq(r.j.warnings.filter((w) => /已剥离单位/.test(w) && /参数值/.test(w)).length, 1, 'R10 每列只提示一次');
ok(!Object.values(require('./lib/common').mergeAliases({ '位号': ['位号'] })['位号']).includes('设备编号'), 'R11 合并后位号别名不含设备编号');
ok(ALIASES_HAS('位号', '功能位置'), 'R12 位号别名含功能位置');
ok(ALIASES_HAS('参数名', '检查项'), 'R13 参数名别名含检查项（智能巡检/点检仪）');
ok(ALIASES_HAS('参数值', '测量值'), 'R14 参数值别名含测量值');
ok(!ALIASES_HAS('位号', '设备编号'), 'R15 位号别名不含设备编号');
const sapHist = mk('saphist.xlsx', {
  '通知单': [
    ['通知单', '通知类型', '功能位置', '设备', '技术对象描述', '通知日期', '描述', '损坏代码', '原因文本', '处理结果'],
    ['10234561', 'M2', 'P-101A', '10045678', '进料泵A', '2025-11-12', '振动偏大伴异响', 'VIB-01', '联轴器不对中', '重新找正'],
    ['10234890', 'M2', 'P-202B', '10045700', '别的泵', '2026-03-08', '机封处渗漏', 'LEAK-02', '机械密封磨损', '更换机封'],
  ],
});
r = run(['--symptom', '振动大', '--equip-type', '离心泵', '--tag', 'P-101A', '--history', sapHist], 'saphist');
eq(r.s.ok, true, 'R16 SAP 通知单导出可读');
eq(r.j.counts.history, 1, 'R17 功能位置作位号过滤本机');
eq(r.j.history[0].phenomenon, '振动偏大伴异响', 'R18 「描述」列作故障现象');
eq(r.j.history[0].cause, '联轴器不对中', 'R19 「原因文本」作故障原因');
eq(r.j.history[0].noticeNo, '10234561', 'R20 通知单号读入');
eq(r.j.history[0].faultCode, 'VIB-01', 'R21 损坏代码读入');
eq(r.j.history[0].date, '2025-11-12', 'R22 通知日期作故障日期');
ok(r.j.historyHints.some((h) => h.cause === '联轴器不对中'), 'R23 SAP 导出同样生成历史提示');

// ============ S. 安全阀单列与特护设备 ============
const psv = mk('psv.xlsx', {
  '运行参数': [['位号', '参数名', '参数值', '基准值', '上限', '单位'], ['PSV-1', '系统压力', 1.52, 1.4, 1.6, 'MPa']],
});
r = run(['--symptom', '安全阀出口侧有介质泄漏', '--equip-type', '安全阀', '--tag', 'PSV-1', '--params', psv, '--sudden', '是', '--affects-run', '否'], 'psv');
eq(r.s.ok, true, 'S1 安全阀路径 ok');
eq(r.j.meta.equipType, 'safetyValve', 'S2 类型为安全阀');
eq(r.s.covered, true, 'S3 安全阀被覆盖');
ok(r.j.candidates.some((c) => /整定/.test(c.cause)), 'S4 候选含整定相关原因');
ok(!r.j.candidates.some((c) => /汽蚀|不对中/.test(c.cause)), 'S5 不套泵类原因');
ok(r.j.checkItems.some((x) => /校验/.test(x.item)), 'S6 核实项含校验台账');
ok(!/整定压力应为|整定值 [0-9]/.test(r.md), 'S7 不给整定数值结论');
r = run(['--symptom', '压缩机振动大', '--equip-type', '离心压缩机', '--tag', 'K-1', '--special', '是'], 'special');
eq(r.j.riskLevel.level, '红', 'S8 特护设备关注度强制红');
eq(r.j.meta.special, true, 'S9 meta 记录特护');
ok(/是（关注度按最高档）/.test(r.md), 'S10 md 现象复述写明特护');
ok(/公司设备管理部门/.test(r.md), 'S11 md 上报建议含公司设备管理部门');
ok(r.j.warnings.some((w) => /特护设备仍按最高档/.test(w)), 'S12 缺项 warning 注明特护不降档');
r = run(['--symptom', '压缩机振动大', '--equip-type', '离心压缩机', '--tag', 'K-1', '--special', '否', '--sudden', '否', '--affects-run', '否'], 'nospecial');
eq(r.j.riskLevel.level, '黄', 'S13 --special 否 不抬档');
eq(raw(['--symptom', 'x', '--tag', 'P', '--special', '可能']).s.ok, false, 'S14 --special 非法取值报错');

// ============ N. 参数校验 ============
function raw(args) {
  const x = spawnSync(process.execPath, [TRIAGE, ...args], { encoding: 'utf8' });
  const l = x.stdout.trim().split('\n');
  try { return { code: x.status, s: JSON.parse(l[l.length - 1]) }; } catch (e) { return { code: x.status, s: { ok: false } }; }
}
eq(raw([]).s.ok, false, 'N1 无参数报错');
eq(raw([]).code, 1, 'N2 退出码1');
eq(raw(['--symptom']).s.ok, false, 'N3 --symptom 缺值报错');
ok(/缺少取值/.test(raw(['--symptom']).s.error), 'N4 缺值信息正确');
eq(raw(['--symptom', 'x']).s.ok, false, 'N5 缺 --tag 报错');
eq(raw(['--symptom', 'x', '--tag', 'P', '--未知', 'v']).s.ok, false, 'N6 未知参数报错');
eq(raw(['--symptom', 'x', '--tag', 'P', '--time', '昨天下午']).s.ok, false, 'N7 非法时间报错');
ok(/ISO 8601/.test(raw(['--symptom', 'x', '--tag', 'P', '--time', '昨天下午']).s.error), 'N8 时间错误信息提示格式');
eq(raw(['--symptom', 'x', '--tag', 'P', '--time', '2026-09-21 08:15']).s.ok, false, 'N9 无时区的时间报错');
eq(raw(['--symptom', 'x', '--tag', 'P', '--params', '/不存在.xlsx']).s.ok, false, 'N10 参数文件不存在报错');
eq(raw(['--symptom', 'x', '--tag', 'P', '--history', '/不存在.xlsx']).s.ok, false, 'N11 历史文件不存在报错');
ok(raw(['--symptom', 'x', '--tag', 'P', '--time', '2026-09-21T08:15:00+08:00']).s.ok === true, 'N12 合法 ISO 时间通过');

// ============ O. 现象无法识别 ============
r = run(['--symptom', '感觉不太对劲', '--equip-type', '离心泵', '--tag', 'P-101A'], 'vague');
eq(r.s.ok, true, 'O1 现象模糊不报错');
ok(r.j.warnings.some((w) => /未匹配到已知现象类型/.test(w)), 'O2 提示补充更具体描述');
ok(r.j.candidates.every((c) => /^通用框架/.test(c.cause)), 'O3 现象不明时只给通用框架');

// ============ P. 跨现象合并与核实项去重 ============
const tMerge = R.triage({ equipType: '离心泵', symptoms: ['vibration', 'noise'], evidence: {} });
eq(new Set(tMerge.candidates.map((c) => c.cause)).size, tMerge.candidates.length, 'P1 候选原因不重名（跨现象已合并）');
ok(!tMerge.candidates.some((c) => c.cause === '轴承损伤'), 'P2 异响表的轴承条目已并入「滚动轴承损伤」');
eq(tMerge.candidates.filter((c) => c.cause === '汽蚀').length, 1, 'P3 汽蚀在振动与异响表各有一条，合并为一条');
ok(cand(tMerge, '滚动轴承损伤').symptomCn.includes('振动') && cand(tMerge, '滚动轴承损伤').symptomCn.includes('异响'),
  'P4 合并后并列两个现象');
ok(cand(tMerge, '滚动轴承损伤').alsoRuleIds.length > 0, 'P5 合并保留另一条规则号');
r = run(['--symptom', '泵振动比平时大，还有异响', '--equip-type', '离心泵', '--tag', 'P-101A',
  '--params', params, '--sudden', '否', '--affects-run', '否'], 'merge');
eq(new Set(r.j.checkItems.map((x) => x.item)).size, r.j.checkItems.length, 'P6 建议核实项无重复条目');
ok(!r.j.missingFields.some((m) => m.field === 'symptomText'), 'P7 现象描述本身不列入「建议补充的数据」');
ok(!/^- 现象描述$/m.test(r.md), 'P8 md 补充数据清单不含「现象描述」');
// 同一探针不因重复声明而被重复计分
eq(R.scoreCandidate({ supports: ['gradual'], againsts: ['gradual'] }, { sudden: '否' }).supports.length, 1,
  'P9 同一探针只计一次');

// ============ T. 现象口语：温度偏高、换热器内漏 ============
ok(R.classifySymptoms('电机温度偏高').includes('temperature'), 'T1 「温度偏高」识别为温度异常（不落到其他现象）');
ok(R.classifySymptoms('轴承温度升高了').includes('temperature'), 'T2 「温度升高」识别为温度异常');
ok(R.classifySymptoms('换热器管束内漏').includes('performance'), 'T3 「内漏」同时进性能类（换热器内漏口径 SF2 在性能表）');
ok(R.triage({ equipType: '换热器', symptoms: R.classifySymptoms('怀疑管束内漏'), evidence: {} }).candidates.some((c) => c.ruleId === 'SF2'),
  'T4 换热器「内漏」候选含 SF2 内漏（管束穿孔或内件损坏）');
ok(!R.classifySymptoms('出口温度偏低').includes('temperature'), 'T5 「温度偏低」不按温升口径套过热原因');
// 「内漏」只按设备类型补对应性能条目，不把整张性能表并进来压过泄漏表
{
  const tri = (equipType, text) => R.triage({ equipType, symptoms: R.classifySymptoms(text), evidence: {}, symptomText: text }).candidates.map((c) => c.ruleId);
  const gate = tri('闸阀', '闸阀关不严，内漏');
  eq(gate[0], 'SL1', 'T6 闸阀「关不严，内漏」首位候选回到泄漏表 SL1（不被换热器结垢 SF1 压过）');
  ok(!gate.some((x) => /^SF/.test(x)), 'T7 闸阀内漏不并入换热器/塔器性能条目');
  const psv = tri('安全阀', '安全阀内漏');
  eq(psv[0], 'VL1', 'T8 安全阀内漏首位候选回到 VL1 阀座密封面损伤（不被 VF1 频跳压过）');
  const seal = tri('离心泵', '机封内漏');
  eq(seal[0], 'PL1', 'T9 离心泵「机封内漏」首位候选回到 PL1 机械密封失效（不被 PF1 汽蚀压过）');
  ok(!seal.some((x) => /^PF/.test(x)), 'T10 机封内漏不补泵性能条目');
  const hx = tri('换热器', 'E-1201 换热器管束内漏');
  ok(hx.includes('SF2') && !hx.includes('SF1') && !hx.includes('SF3'), 'T11 换热器管束内漏仍列 SF2，只补 SF2 不并整张性能表');
  const ring = tri('离心泵', '口环间隙大，泵内漏');
  ok(ring.includes('PF2') && !ring.includes('PF1'), 'T12 泵在口环/叶轮内漏语境下只补 PF2');
  const cmp = tri('往复压缩机', '气阀内漏');
  ok(cmp.includes('CF2') && cmp.includes('CF3') && !cmp.includes('CF1') && !cmp.some((x) => /^G/.test(x)), 'T13 压缩机内漏补 CF2/CF3，不落通用框架');
  const flow = tri('离心泵', '口环磨损内漏，打不上量');
  ok(flow.includes('PF1') && flow.includes('PF3'), 'T14 同时有「打不上量」等性能现象时整张性能表照常进入');
  const rc = run(['--symptom', '闸阀关不严，内漏', '--equip-type', '闸阀', '--tag', 'XV-101'], 'gate-internal');
  eq(((rc.j && rc.j.candidates) || [])[0] && rc.j.candidates[0].ruleId, 'SL1', 'T15 脚本端到端：闸阀内漏首位候选 SL1');
  ok(['温度较高', '温度稍高', '温度很高', '温度越来越高'].every((t) => R.classifySymptoms('轴承' + t).includes('temperature')), 'T16 温度口语「较高、稍高、很高、越来越高」识别为温度异常');
  ok(!R.classifySymptoms('温度较低').includes('temperature'), 'T17 「温度较低」仍不进温升口径');
}

// ============ Q. 文档、上架信息与口径一致性 ============
{
  const ROOT = path.join(__dirname, '..');
  const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
  const exists = (p) => fs.existsSync(path.join(ROOT, p));
  // 演示样例：仓库内在 炼厂车间设备员/演示case/<分类>/<技能>/，开发包内在技能目录 examples/
  const skillsRoot = path.resolve(__dirname, '../../..');
  const EX = path.basename(skillsRoot) === '设备员skill' ? path.join(skillsRoot, '..', '演示case', path.relative(skillsRoot, path.resolve(__dirname, '..'))) : path.join(__dirname, '..', 'examples');
  const skill = rd('SKILL.md');
  const listing = (exists('上架信息.md') ? rd('上架信息.md') : '') + (exists('样例问题.md') ? rd('样例问题.md') : '');
  const attach = [...listing.matchAll(/(sample-[\w.-]+\.xlsx)/g)].map((m) => m[1]);
  const descText = ((exists('上架信息.md') ? rd('上架信息.md') : '').split('**技能描述**')[1] || '').split('**示例问题**')[0].replace(/\s/g, '');

  ok(/^agent_created: true$/m.test(skill) && /^allowed-tools: /m.test(skill), 'Q1 SKILL.md 保留 agent_created 与 allowed-tools');
  ok(/要不要报工程师/.test(skill) && !/该不该停机/.test(skill), 'Q2 触发词改为「要不要报工程师」，去掉「该不该停机」');
  ok(/parameter-trend-alert/.test(skill) && /inspection-data-digest/.test(skill) && /defect-intake-grading/.test(skill), 'Q3 description 含同类技能互指');
  ok(/红\/橙\/黄/.test(skill) && !/关注度 A\/B\/C/.test(skill), 'Q4 SKILL.md 关注度用红/橙/黄');
  ok(/PDF 不读/.test(skill) && /pdf 技能/.test(skill) && /os\.tmpdir|--out/.test(skill), 'Q5 SKILL.md 写 PDF 前置转换步骤');
  ok(/维修通知单/.test(skill) && /六节/.test(skill), 'Q6 SKILL.md 含维修通知单口径与六节预期结果');
  const rq = run(['--symptom', '泵振动大', '--equip-type', '离心泵', '--tag', 'P-Q1', '--sudden', '否', '--affects-run', '否'], 'docq');
  eq((rq.md.match(/^## [一二三四五六七八九]、/gm) || []).length, 6, 'Q7 产出 md 正文恰为六节，与 SKILL.md 预期结果一致');
  const fp = ['pump', 'compressor', 'electrical', 'static'].map((k) => rd(`references/fault-patterns-${k}.md`)).join('\n');
  ok(!/15% 以上/.test(fp) && !/±15%/.test(fp) && /偏差阈值/.test(fp) && /--dev-pct/.test(fp), 'Q8 口径表不再写死 ±15%，改为限值表/--dev-pct 偏差阈值');
  const spec = rd('references/input-spec.md');
  ok(/功能位置/.test(spec) && /测点号/.test(spec) && /通知单/.test(spec) && /损坏代码/.test(spec) && /安全阀/.test(spec), 'Q9 input-spec 含 SAP PM/DCS 列名与安全阀单列类型');
  ok(!/EAM/.test(spec + skill) && !/机动处/.test(spec + skill), 'Q10 不含「EAM」「机动处」旧术语');
  const readme = rd('scripts/README.md');
  ok(/--dev-pct/.test(readme) && /--limits/.test(readme) && /--special/.test(readme) && /os\.tmpdir\(\)/.test(readme), 'Q11 scripts/README 参数表含 --dev-pct/--limits/--special 与默认临时目录');
  const ex = fs.readFileSync(path.join(EX, 'README.md'), 'utf8');
  ok(!/[ABC] 级/.test(ex) && /sample-params-dcs\.xlsx/.test(ex) && /sample-history-sap\.xlsx/.test(ex) && /sample-params-psv\.xlsx/.test(ex), 'Q12 演示case/README 不含 A/B/C 级关注度，引用 DCS/SAP/安全阀样例');
  ok(!fs.existsSync(path.join(EX, '异常初判')) && fs.existsSync(path.join(EX, 'sample-params-dcs.xlsx')) && fs.existsSync(path.join(EX, 'sample-history-sap.xlsx')), 'Q13 演示case 无遗留运行产物，且含系统列名样例');
  ok(exists('上架信息.md') && exists('样例问题.md'), 'Q14 上架信息.md 与 样例问题.md 存在');
  ok(attach.length >= 5 && attach.every((f) => fs.existsSync(path.join(EX, f))), `Q15 上架信息/样例问题引用的附件均存在于 演示case（${[...new Set(attach)].join(',')}）`);
  ok(/\*\*技能名称\*\*/.test(listing) && /\*\*技能简介\*\*/.test(listing) && /\*\*技能描述\*\*/.test(listing) && /\*\*示例问题\*\*/.test(listing), 'Q16 上架信息格式四要素齐全');
  ok(descText.length >= 240 && descText.length <= 330, `Q17 技能描述约 250~300 字（实际 ${descText.length}）`);
  ok((listing.match(/^\d+\. /gm) || []).length >= 15, 'Q18 上架信息 5 题 + 样例问题 10 题');
  ok(/红\/橙\/黄/.test(listing) && !/[ABC] 级/.test(listing) && !/该不该停机/.test(listing), 'Q19 上架信息用红/橙/黄，不含 A/B/C 级与旧触发词');
}

console.log(`\n${'='.repeat(56)}`);
console.log(`anomaly-triage-advisor 自测：${pass} 通过，${fail} 失败`);
if (failures.length) { console.log('\n失败项：'); failures.forEach((f) => console.log('  ✗ ' + f)); }
console.log('='.repeat(56));
try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
