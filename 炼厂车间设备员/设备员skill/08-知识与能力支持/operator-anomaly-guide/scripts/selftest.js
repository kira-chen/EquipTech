#!/usr/bin/env node
'use strict';
/** 自测：断言 guide.js 与 scope.js 行为。用法：node scripts/selftest.js */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { writeXlsx } = require('./lib/xlsx-lite');
const S = require('./lib/scope');

const G = path.join(__dirname, 'guide.js');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'oag-selftest-'));
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
const eq = (a, e, n) => ok(a === e, `${n}（期望 ${JSON.stringify(e)}，实际 ${JSON.stringify(a)}）`);

function run(args, tag) {
  const out = path.join(work, tag + '-out');
  const r = spawnSync(process.execPath, [G, ...args, '--out', out], { encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  let s; try { s = JSON.parse(lines[lines.length - 1]); } catch (e) { s = { ok: false, error: 'no-json:' + r.stdout + r.stderr }; }
  let j = null, md = null;
  if (fs.existsSync(path.join(out, 'guide.json'))) j = JSON.parse(fs.readFileSync(path.join(out, 'guide.json'), 'utf8'));
  if (fs.existsSync(path.join(out, '指引卡.md'))) md = fs.readFileSync(path.join(out, '指引卡.md'), 'utf8');
  return { code: r.status, s, j, md, out };
}
const mk = (n, b) => { const p = path.join(work, n); writeXlsx(p, b); return p; };
const BASE = ['--workshop', '测试车间', '--report-to', '班长'];
let r;

function raw(args) {
  const x = spawnSync(process.execPath, [G, ...args], { encoding: 'utf8' });
  const l = x.stdout.trim().split('\n');
  try { return { code: x.status, s: JSON.parse(l[l.length - 1]) }; } catch (e) { return { code: x.status, s: { ok: false } }; }
}

// ============ A. 职责边界库单元测试（核心） ============
section('A', () => {
  const blocked = ['打开泵盖检查轴承', '拆卸联轴器', '调整对中', '找正', '更换机械密封', '更换机封', '换新的垫片',
    '焊接补漏', '动火切割', '拆接线', '短接联锁', '强行复位联锁', '自行判断是否能继续运行', '带压堵漏',
    '进入受限空间检查', '登高检查'];
  let allBlocked = true;
  for (const b of blocked) { if (S.checkAction(b).ok) { allBlocked = false; failures.push(`[${curLevel}] A-拦截失败: ${b}`); fail++; byLevel[curLevel]++; } }
  if (allBlocked) { pass++; byLevel[curLevel]++; ok(true, 'A1 全部 16 类超范围动作被拦截'); }
  const allowed = ['停止操作并上报', '通知班长', '就地观察并记录现象', '按应急预案撤离并报警',
    '在安全距离外观察，禁止靠近', '设置警戒，禁止无关人员靠近'];
  let allAllowed = true;
  for (const b of allowed) { if (!S.checkAction(b).ok) { allAllowed = false; failures.push(`[${curLevel}] A-误拦截: ${b}`); fail++; byLevel[curLevel]++; } }
  if (allAllowed) { pass++; byLevel[curLevel]++; ok(true, 'A2 职责内动作全部放行'); }
  ok(S.checkAction('打开泵盖').ruleId === 'S1', 'A3 拆检类规则号 S1');
  ok(S.checkAction('更换机械密封').ruleId === 'S3', 'A4 更换类规则号 S3');
  ok(S.checkAction('带压堵漏').ruleId === 'S8', 'A5 堵漏类规则号 S8');
  ok(S.checkAction('打开泵盖').suggestion.includes('停止操作'), 'A6 替代动作为停止上报');
  ok(S.checkAction('更换润滑油').ok, 'A7 加换油属职责内不误拦');
});

// 设备类型识别顺序（曾有 bug）
section('C', () => {
  eq(S.typeOf('鼓风机电机'), '电机', 'A8 电机优先于风机识别');
  eq(S.typeOf('油泵电机'), '电机', 'A9 电机优先于泵识别');
  eq(S.typeOf('空压机'), '压缩机', 'A10 空压机归压缩机');
  eq(S.typeOf('常压塔顶回流泵'), '离心泵', 'A11 泵识别');
  eq(S.typeOf('原油换热器'), '换热器', 'A12 换热器识别');
  eq(S.typeOf('常压塔'), '塔器容器', 'A13 塔识别');
  eq(S.typeOf('完全不认识'), '通用', 'A14 无法识别→通用');
  ok(S.observeOf('离心泵')['看'].length > 0, 'A15 观察要点非空');
  ok(S.EMERGENCY.length >= 5, 'A16 紧急撤离条件齐全');
});

// ============ B. 基础生成 ============
section('BVT', () => {
  r = run([...BASE, '--scope', '离心泵,换热器'], 'base');
  eq(r.s.ok, true, 'B1 基础生成成功');
  eq(r.s.counts.types, 2, 'B2 两类设备');
  eq(r.s.counts.covered, 2, 'B3 均在覆盖范围');
  ok(r.s.counts.observePoints > 0, 'B4 输出观察要点');
  ok(/## 一、什么情况立即撤离并报警/.test(r.md), 'B5 紧急撤离节在最前');
  const iEmerg = r.md.indexOf('立即撤离并报警');
  const iType = r.md.indexOf('## 二、');
  ok(iEmerg > 0 && iEmerg < iType, 'B6 紧急节位于设备类型节之前');
  ok(/看什么、什么算异常、先做什么、找谁报/.test(r.md), 'B7 开头点明四件事');
  ok(/不要求你判断原因/.test(r.md), 'B8 明确不要求判断原因');
});

// ============ C. 超范围动作拦截（核心） ============
section('A', () => {
  r = run([...BASE, '--scope', '离心泵', '--actions', '打开泵盖检查,停止操作并上报,更换机械密封,调整对中,通知班长'], 'actions');
  eq(r.s.counts.blockedActions, 3, 'C1 三条超范围动作被拦截');
  ok(r.j.outOfScope.every((b) => b.suggestion.includes('停止操作')), 'C2 全部替换为停止上报');
  ok(r.j.warnings.filter((w) => w.includes('超出操作工职责范围')).length === 3, 'C3 各有 warning');
  ok(/已拦截的超范围动作/.test(r.md), 'C4 md 单列拦截节');
  // 被拦截的动作不得出现在"发现异常先做什么"里
  // 取「发现异常先做什么」到该节末尾的职责边界提示之间的全部内容
  const doSec = (r.md.match(/\*\*发现异常先做什么\*\*[\s\S]*?不属于操作工职责/) || [''])[0];
  ok(!/打开泵盖|更换机械密封|调整对中/.test(doSec), 'C5 超范围动作未进入处置动作清单');
  ok(/停止操作并上报/.test(doSec), 'C6 处置清单含停止上报');
  ok(/不属于操作工职责/.test(r.md), 'C7 每节带职责边界提示');
  // 未传 actions 时为 null
  r = run([...BASE, '--scope', '离心泵'], 'noact');
  eq(r.s.counts.blockedActions, null, 'C8 未传动作时为 null');
});

// ============ D. 类型不覆盖 ============
section('B', () => {
  r = run([...BASE, '--scope', '加热炉'], 'uncovered');
  eq(r.s.ok, true, 'D1 不覆盖类型不报错');
  eq(r.s.counts.uncovered, 1, 'D2 计入未覆盖');
  ok(r.j.warnings.some((w) => w.includes('不在覆盖范围')), 'D3 warning 提示');
  ok(/待安全专业补充/.test(r.md), 'D4 md 标注待补充');
  ok(r.j.sections[0].covered === false, 'D5 section 标记未覆盖');
  // 仍输出通用框架而非空
  ok(r.j.sections[0].observe['看'].length > 0, 'D6 仍输出通用观察框架');
});

// ============ E. 上报路径必须来自用户（核心） ============
section('A', () => {
  eq(raw(['--workshop', 'X', '--scope', '离心泵']).s.ok, false, 'E1 缺 --report-to 报错');
  ok(/上报路径必须由厂内实际流程提供/.test(raw(['--workshop', 'X', '--scope', '泵']).s.error), 'E2 错误信息说明不自行设定');
  r = run([...BASE, '--scope', '离心泵'], 'noemerg');
  ok(r.j.warnings.some((w) => w.includes('未提供紧急上报方式')), 'E3 缺紧急方式 warning');
  ok(/紧急上报方式待车间补充/.test(r.md), 'E4 md 标注待补充');
  r = run([...BASE, '--scope', '离心泵', '--emergency', '报警 119'], 'emerg');
  ok(/报警 119/.test(r.md), 'E5 提供后写入');
});

const LED = mk('led.xlsx', {
  '设备台账': [['位号', '设备名称', '设备类型', '区域'],
    ['P-01', '进料泵', '离心泵', '一区'],
    ['P-02', '回流泵', '离心泵', '一区'],
    ['M-01', '鼓风机电机', '电机', '二区'],
    ['', '无位号', '离心泵', '一区']],
});
const NOTYPE = mk('notype.xlsx', {
  '设备台账': [['位号', '设备名称', '区域'], ['P-11', '加氢进料泵', '一区'], ['M-11', '循环水泵电机', '二区']],
});
// ============ F. 设备清单 ============
section('B', () => {
  r = run([...BASE, '--ledger', LED], 'ledger');
  eq(r.s.ok, true, 'F1 按清单生成');
  eq(r.s.counts.equipment, 3, 'F2 空位号行被跳过');
  ok(r.j.warnings.some((w) => w.includes('位号为空')), 'F3 空位号 warning');
  ok(r.j.sections.some((s) => s.type === '电机'), 'F4 电机单独成节（类型识别顺序正确）');
  ok(/P-01（进料泵）/.test(r.md), 'F5 md 列出本车间该类设备');

  // 类型列缺失时按名称推断
  r = run([...BASE, '--ledger', NOTYPE], 'notype');
  ok(r.j.sections.some((s) => s.type === '电机'), 'F6 缺类型列时按名称推断电机');
  ok(r.j.sections.some((s) => s.type === '离心泵'), 'F7 缺类型列时按名称推断泵');
});

// ============ G. 定性判据（不用仪器数值） ============
section('A', () => {
  r = run([...BASE, '--scope', '离心泵,压缩机,电机'], 'qualitative');
  const signs = r.j.sections.flatMap((s) => s.abnormalSigns).join(' ');
  ok(!/\d+\s*(mm\/s|℃|MPa|kPa|μmol|ppm|A\b)/.test(signs), 'G1 异常特征不含需仪器测量的数值判据');
  ok(/明显|烫手|变大|增强|可见/.test(signs), 'G2 异常特征用定性描述');
  ok(/手背试温|勿长时间接触|注意触电|勿湿手/.test(r.md), 'G3 摸的动作带安全提示');
});

// ============ H. 声明行与结构 ============
section('B', () => {
  r = run([...BASE, '--scope', '离心泵'], 'statement');
  ok(/仅供参考，不替代操作规程与检修规程/.test(r.md), 'H1 保留培训/指引类声明行');
  ok(/遇紧急情况以应急预案为准/.test(r.md), 'H2 声明含应急优先');
  ok(r.j.meta.statement.includes('由车间工艺/安全审核后纳入岗位操作法或 HSE 作业指导书'), 'H3 JSON 声明含审核与纳入口径');
  ok(/设备专业建议稿/.test(r.md) && /由车间工艺\/安全审核后/.test(r.md), 'H3a md 写明设备专业建议稿与审核方');
  ok(/编制：车间设备员（设备专业建议稿）/.test(r.md), 'H3c 卡头写明编制与审核');
  ok(/报告要说清的信息/.test(r.md), 'H4 含报告要素节');
  ok(/说现象，不用说原因/.test(r.md), 'H5 提示说现象不说原因');
});
section('C', () => {
  ok(!/本指引为辅助材料，须经车间审核/.test(r.md), 'H3b 旧声明行不再出现');
  ok(!/[\u2600-\u27BF\u{1F300}-\u{1FAFF}]/u.test(r.md), 'H3d md 不含 emoji');
  ok(/【注意】/.test(r.md), 'H3e 醒目提示用【注意】');
});

// ============ H2. 白名单限定语写进正文（经值班领导/内操同意） ============
section('A', () => {
  r = run([...BASE, '--scope', '离心泵'], 'whitelist');
  ok(/切换至备用设备（按操作规程，经值班领导\/内操同意后执行）/.test(r.md), 'H6 切换备用设备带「经值班领导/内操同意」限定');
  ok(/降低负荷（按操作规程，经值班领导\/内操同意后执行）/.test(r.md), 'H7 降低负荷带限定');
  ok(/【注意】切换备用设备、降低负荷须经值班领导\/内操同意后按操作规程执行/.test(r.md), 'H8 指引卡正文单独一行写明限定');
  ok(r.j.sections[0].actionNote.includes('经值班领导/内操同意'), 'H9 JSON sections.actionNote 含限定');
});
section('B', () => {
  ok(/通知班长 \/ 内操 \/ 车间设备员 \/ 调度/.test(r.md), 'H10 上报对象用中石化口径（内操/车间设备员）');
  ok(/用火等/.test(r.md) && !/动火等/.test(r.md), 'H11 职责边界提示用「用火」');
  ok(/报告人岗位与姓名/.test(r.md), 'H12 报告要素含岗位与姓名');
});
section('C', () => {
  ok(/anomaly-triage-advisor/.test(r.md) && /training-material-generator/.test(r.md), 'H13 卡尾互指相关技能');
});

// ============ K. 「摸」类观察点：默认限定语 / --no-touch 去掉 ============
section('A', () => {
  r = run([...BASE, '--scope', '离心泵,电机'], 'touch-default');
  eq(r.s.noTouch, false, 'K1 默认不启用 no-touch');
  ok(r.j.sections.every((s) => s.observe['摸'].every((x) => x.startsWith(S.TOUCH_QUALIFIER))), 'K2 默认每条摸类观察点带限定语');
  ok(/仅在操作规程允许且确认安全/.test(r.md), 'K3 md 出现限定语');
  eq(r.j.meta.touchQualifier, S.TOUCH_QUALIFIER, 'K4 meta 记录限定语');
  eq(r.s.counts.touchPointsRemoved, null, 'K5 未启用时去除计数为 null 而非 0');
});
section('B', () => {
  const touchDefault = r.s.counts.observePoints;
  r = run([...BASE, '--scope', '离心泵,电机', '--no-touch'], 'touch-off');
  eq(r.s.ok, true, 'K6 --no-touch 运行成功');
  eq(r.s.noTouch, true, 'K7 summary 记录 noTouch');
  ok(r.j.sections.every((s) => s.observe['摸'].length === 0), 'K8 摸类观察点全部去掉');
  eq(r.s.counts.touchPointsRemoved, 3, 'K9 去掉 3 条摸类观察点（泵 2 + 电机 1）');
  ok(r.s.counts.touchSignsRemoved >= 2, 'K10 依赖手摸的异常特征一并去掉');
  ok(r.j.sections.flatMap((s) => s.abnormalSigns).every((x) => !S.TOUCH_SIGN_RE.test(x)), 'K11 剩余异常特征不含烫手/手感');
  ok(r.j.warnings.some((w) => /--no-touch/.test(w) && /巡检仪|测温枪/.test(w)), 'K12 warning 说明替代判断方式');
  ok(/本卡不含手摸类观察点/.test(r.md), 'K13 md 每节注明不含手摸');
  ok(!/- \*\*摸\*\*/.test(r.md), 'K14 md 无「摸」小节');
  ok(!/摸到\//.test(r.md), 'K15 报告要素不再要求「摸到」');
  ok(!S.TOUCH_SIGN_RE.test(r.md.split('## 附')[0]), 'K15a --no-touch 时卡面（含报告示例句）不出现烫手/手感');
  eq(r.s.counts.observePoints, touchDefault - 3, 'K16 观察要点计数相应减少');
  eq(r.j.meta.noTouch, true, 'K17 meta.noTouch 为 true');
  eq(r.j.meta.touchQualifier, null, 'K18 no-touch 时限定语为 null');
});

// ============ L. S5 接线规则只拦动手动作 ============
section('C', () => {
  ok(S.checkAction('检查接线盒外观').ok, 'L1 「检查接线盒外观」不拦截');
  ok(S.checkAction('接线盒有无烧灼痕迹').ok, 'L2 「接线盒有无烧灼痕迹」不拦截');
  ok(S.checkAction('检查接线是否松动').ok, 'L3 「检查接线是否松动」不拦截');
});
section('B', () => {
  eq(S.checkAction('拆接线').ruleId, 'S5', 'L4 「拆接线」拦截');
  eq(S.checkAction('重新接线').ruleId, 'S5', 'L5 「重新接线」拦截');
  eq(S.checkAction('紧固接线端子').ruleId, 'S5', 'L6 「紧固接线端子」拦截');
  eq(S.checkAction('短接联锁').ruleId, 'S5', 'L7 「短接联锁」拦截');
  eq(S.checkAction('用火作业补焊').ruleId, 'S4', 'L8 「用火」纳入 S4');
  ok(/用火作业许可/.test(S.checkAction('动火').reason), 'L9 S4 原因写「用火作业许可」');
  r = run([...BASE, '--scope', '电机', '--actions', '检查接线盒外观,拆接线'], 'wiring');
  eq(r.s.counts.blockedActions, 1, 'L10 观察类接线描述放行、动手类拦截');
  ok(r.j.outOfScope[0].original === '拆接线', 'L11 拦截的是「拆接线」');
});
section('A', () => {
  ok(S.IN_SCOPE.some((x) => /经值班领导\/内操同意/.test(x)), 'L12 白名单条目自带限定语');
});
section('C', () => {
  ok(Array.isArray(S.TYPE_PATTERNS) && S.TYPE_PATTERNS.length === 7, 'L13 TYPE_PATTERNS 导出（与 tm.js 同源）');
});

const SAP = mk('sap.xlsx', {
  '设备台账': [['功能位置', '设备', '设备描述', '对象类型', '工厂区段'],
    ['P-1101A', '10001234', '常压塔顶回流泵A', '离心泵', '常减压一区'],
    ['M-1501', '10001235', '鼓风机电机', '电机', '四区']],
});
// ============ M. SAP/EM 导出列名（mergeAliases） ============
section('A', () => {
  r = run([...BASE, '--ledger', SAP], 'sap');
  eq(r.s.ok, true, 'M1 SAP 导出列名可读');
  eq(r.s.counts.equipment, 2, 'M2 两台设备（功能位置作位号，不把 SAP 设备编号当位号）');
  ok(/P-1101A（常压塔顶回流泵A）/.test(r.md), 'M3 功能位置+设备描述正确映射');
  ok(!/10001234/.test(r.md), 'M4 SAP 8 位设备编号未被当成位号');
  ok(r.j.sections.some((s) => s.type === '电机') && r.j.sections.some((s) => s.type === '离心泵'), 'M5 对象类型列识别设备类型');
  ok(r.j.sections.find((s) => s.type === '离心泵').equipment[0].area === '常减压一区', 'M6 工厂区段映射为区域');
  ok(!r.j.warnings.some((w) => /缺少列/.test(w)), 'M7 无缺列 warning');
});

// ============ I. 参数校验 ============
section('B', () => {
  eq(raw([]).s.ok, false, 'I1 无参数报错');
  eq(raw(['--workshop']).s.ok, false, 'I2 缺值报错');
  ok(/缺少取值/.test(raw(['--workshop']).s.error), 'I3 缺值信息正确');
  eq(raw(['--workshop', 'X', '--report-to', 'Y']).s.ok, false, 'I4 缺 scope 与 ledger 报错');
  eq(raw([...BASE, '--scope', '泵', '--format', 'xxx']).s.ok, false, 'I5 非法 format 报错');
  eq(raw([...BASE, '--ledger', '/不存在.xlsx']).s.ok, false, 'I6 清单不存在报错');
  eq(raw([...BASE, '--scope', '泵', '--未知', 'x']).s.ok, false, 'I7 未知参数报错');
  eq(raw([...BASE, '--scope', '泵', '--no-touch', 'x']).s.ok, false, 'I7a --no-touch 为开关，后跟多余值报错');
  eq(raw([...BASE, '--ledger', mk('nosheet.xlsx', { '别的': [['a'], [1]] })]).s.ok, false, 'I8 无台账表报错');
});

// ============ J. 产出完整性 ============
section('BVT', () => {
  r = run([...BASE, '--scope', '离心泵,换热器', '--emergency', '119'], 'outputs');
  ok(fs.existsSync(path.join(r.out, 'guide.json')), 'J1 guide.json 生成');
  ok(fs.existsSync(path.join(r.out, '指引卡.md')), 'J2 指引卡.md 生成');
  ok(fs.existsSync(path.join(r.out, 'summary.json')), 'J3 summary.json 生成');
  ok(r.j.scopeRules.length >= 10, 'J4 JSON 含职责边界规则表');
  ok(r.j.reportPath.elements.length >= 5, 'J5 报告要素齐全');
  ok(r.j.emergency.length >= 5, 'J6 紧急条件齐全');
});

// ============ N. 缺陷修复（2026-11-04 核查：拆检、单写堵漏、解除/屏蔽联锁、切除安全阀漏拦）============
section('B', () => {
  eq(S.checkAction('拆检').ruleId, 'S1', 'N1 「拆检」按拆检类拦截');
  eq(S.checkAction('拆保温检查').ruleId, 'S1', 'N2 「拆保温」按拆检类拦截');
  eq(S.checkAction('打卡子堵漏').ruleId, 'S8', 'N3 单写「堵漏」也按堵漏类拦截');
  eq(S.checkAction('解除联锁').ruleId, 'S6', 'N4 「解除联锁」不带强行/手动也拦截');
  eq(S.checkAction('屏蔽报警').ruleId, 'S6', 'N5 「屏蔽报警」拦截');
  eq(S.checkAction('摘除联锁').ruleId, 'S6', 'N6 「摘除联锁」拦截');
  eq(S.checkAction('投用联锁旁路').ruleId, 'S6', 'N7 「联锁旁路」拦截');
  eq(S.checkAction('关闭安全阀根部阀').ruleId, 'S6', 'N8 关闭/切除安全阀根部阀按保护屏蔽类拦截');
});
section('C', () => {
  ok(['更换润滑油', '盘车', '切换备泵', '检查接线盒外观', '处理泄漏前先报告', '确认联锁报警信息后上报', '观察安全阀有无起跳'].every((x) => S.checkAction(x).ok), 'N9 反例：加换油、盘车、切换备泵、观察类与上报类描述不误拦');
  eq(S.typeOf('加氢精制反应器'), '塔器容器', 'N10 「反应器」归塔器容器，不落到通用（与 training-material-generator 同源）');
});
// O. 职责边界复核（2026-11-04 第二轮）：否定 / 疑问写法与「停用后……报警」不误拦；反向语序与口语写法不漏网
section('C', () => {
  ok(S.checkAction('确认联锁未旁路后上报').ok, 'O1 「确认联锁未旁路后上报」不误拦');
  ok(S.checkAction('泵停用后观察报警是否消失').ok, 'O2 「泵停用后观察报警是否消失」不误拦');
  ok(S.checkAction('检查联锁是否旁路').ok && S.checkAction('确认未摘掉联锁').ok && S.checkAction('确认无打旁路').ok, 'O3 「是否旁路」「未摘掉」「无打旁路」等否定或疑问写法不误拦');
});
section('B', () => {
  eq(S.checkAction('对泄漏法兰进行包扎').ruleId, 'S8', 'O4 「对泄漏法兰进行包扎」按堵漏类拦截');
  eq(S.checkAction('漏点用胶带包扎').ruleId, 'S8', 'O5 「漏点用胶带包扎」按堵漏类拦截');
  eq(S.checkAction('把保温拆掉检查').ruleId, 'S1', 'O6 「把保温拆掉检查」按拆检类拦截');
  eq(S.checkAction('摘掉联锁').ruleId, 'S6', 'O7 「摘掉联锁」拦截');
  eq(S.checkAction('打旁路').ruleId, 'S6', 'O8 「打旁路」拦截');
  eq(S.checkAction('先打旁路再处理').ruleId, 'S6', 'O9 「先打旁路再处理」拦截');
});

// ============ Q. --ledger 与 --scope 同时给：按 scope 过滤清单 ============
{
  const LEDQ = mk('ledq.xlsx', {
    '设备台账': [['位号', '设备名称', '设备类型', '区域'],
      ['P-01', '进料泵', '离心泵', '一区'],
      ['P-02', '回流泵', '离心泵', '一区'],
      ['M-01', '鼓风机电机', '电机', '二区'],
      ['E-01', '原油换热器', '换热器', '二区']],
  });
  section('B', () => {
    r = run([...BASE, '--ledger', LEDQ, '--scope', '离心泵'], 'ledq1');
    eq(r.s.ok, true, 'Q1 台账 + scope 可生成');
    eq(r.s.counts.types, 1, 'Q2 按 scope 过滤后只剩离心泵一节');
    eq(r.s.counts.equipment, 2, 'Q3 过滤后只剩 2 台泵');
    ok(/P-01/.test(r.md) && !/M-01|E-01/.test(r.md), 'Q4 指引卡不列 scope 以外的位号');
    ok(r.s.warnings.some((w) => /--scope/.test(w) && /保留 2 台/.test(w) && /剔除 2 台/.test(w)), 'Q5 warning 写明按 scope 过滤的保留 / 剔除台数');
    r = run([...BASE, '--ledger', LEDQ, '--scope', '离心泵,压缩机'], 'ledq2');
    eq(r.s.counts.types, 2, 'Q6 scope 中清单没有的类型仍成一节');
    ok(r.s.warnings.some((w) => /清单中没有「压缩机」类设备/.test(w)), 'Q7 scope 中清单没有的类型 warning');
    r = run([...BASE, '--ledger', LEDQ, '--scope', '二区'], 'ledq3');
    eq(r.s.counts.equipment, 2, 'Q8 scope 写区域时按区域过滤清单');
    ok(!r.s.warnings.some((w) => /不在覆盖范围内/.test(w) && /二区/.test(w)), 'Q9 用于过滤的区域不当成未覆盖设备类型');
    r = run([...BASE, '--ledger', LEDQ, '--scope', '全部'], 'ledq4');
    eq(r.s.counts.equipment, 4, 'Q10 scope「全部」不过滤清单');
    eq(r.s.counts.types, 3, 'Q11 scope「全部」不额外加空的通用节');
  });
}

// ============ W. 车间范围核对（D007）：只核对 --ledger 设备清单 ============
{
  const sc = (i) => ((r.j && r.j.meta.workshopScope) || [])[i] || {};
  const HW = ['位号', '设备名称', '设备类型', '区域', '车间'];
  const WMIX = mk('ws-mix.xlsx', { '设备台账': [HW,
    ['P-01', '进料泵', '离心泵', '一区', '测试车间'], ['P-02', '回流泵', '离心泵', '一区', '测试'],
    ['P-91', '外车间泵', '离心泵', '九区', '催化车间'], ['K-91', '外车间压缩机', '压缩机', '九区', '催化车间'],
    ['M-01', '鼓风机电机', '电机', '二区', ''],
  ] });
  const WBAD = mk('ws-bad.xlsx', { '设备台账': [HW, ['P-01', '进料泵', '离心泵', '一区', '催化车间'], ['M-01', '电机', '电机', '二区', '焦化车间']] });
  section('A', () => {
    r = run([...BASE, '--ledger', WMIX], 'ws-mix');
    eq(r.s.counts.equipment, 3, 'W1 清单只保留本车间与车间为空的设备（剔除催化车间 2 台）');
    ok(!/P-91|K-91/.test(r.md || ''), 'W2 其他车间设备不进指引卡');
    ok(!(r.j.sections || []).some((s) => s.type === '压缩机'), 'W3 只有其他车间才有的设备类型不成节');
    ok(/M-01（鼓风机电机）/.test(r.md || ''), 'W4 车间列为空的设备按本车间保留');
    ok(r.j.warnings.some((w) => /剔除其他车间 2 行/.test(w) && w.includes('催化车间 2 行')), 'W5 warning 写明剔除行数与车间名');
    ok(r.j.warnings.some((w) => /车间列为空 1 行/.test(w)), 'W6 warning 写明车间为空行数');
    eq(sc(0).status, 'checked', 'W7 meta.workshopScope 记录已核对');
    eq(sc(0).droppedRows, 2, 'W8 meta.workshopScope 记录剔除行数');
    eq((sc(0).dropped || {})['催化车间'], 2, 'W9 meta.workshopScope 按车间记录剔除');
    ok(/车间范围：已按车间列核对「测试车间」/.test(r.md || ''), 'W10 md 写明按车间核对与剔除');
    r = run([...BASE, '--ledger', WBAD], 'ws-bad');
    eq(r.s.counts.equipment, 2, 'W11 车间列全不一致时不筛');
    ok(r.j.warnings.some((w) => w.startsWith('【注意】') && /未按车间筛选/.test(w)), 'W12 warning 以【注意】开头');
    eq(sc(0).status, 'mismatch', 'W13 meta.workshopScope 记录不一致');
    const ai = (r.md || '').indexOf('【注意】工作表「设备台账」的车间列取值与 --workshop「测试车间」不一致');
    ok(ai > 0 && ai < r.md.indexOf('## 一、'), 'W14 md 开头（第一节之前）有【注意】提示');
  });
  section('B', () => {
    r = run([...BASE, '--ledger', LED], 'ws-none');
    eq(sc(0).status, 'noColumn', 'W15 无车间列 status 为 noColumn');
    ok((r.md || '').includes('输入未含车间列，车间范围以取数条件为准'), 'W16 md 说明无车间列');
    r = run([...BASE, '--ledger', mk('ws-plant.xlsx', { '设备台账': [['位号', '设备名称', '设备类型', '维护工厂'], ['P-01', '进料泵', '离心泵', '1100'], ['P-02', '回流泵', '离心泵', '1200']] })], 'ws-plant');
    eq(sc(0).status, 'noColumn', 'W17 「维护工厂」列不当车间列（noColumn）');
    eq(r.s.counts.equipment, 2, 'W18 「维护工厂」列不触发筛选');
    r = run([...BASE, '--scope', '离心泵'], 'ws-noledger');
    ok(r.j && Array.isArray(r.j.meta.workshopScope) && r.j.meta.workshopScope.length === 0 && !/车间范围：/.test(r.md || ''), 'W19 未给 --ledger 时不核对、不写车间范围口径');
  });
}

console.log(`\n${'='.repeat(56)}`);
console.log(`operator-anomaly-guide 自测：${pass} 通过，${fail} 失败`);
console.log(`用例级别 ${LEVELS[RUN_LEVEL]}：BVT ${byLevel.BVT}，A ${byLevel.A}，B ${byLevel.B}，C ${byLevel.C}`);
if (failures.length) { console.log('\n失败项：'); failures.forEach((f) => console.log('  ✗ ' + f)); }
console.log('='.repeat(56));
try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
