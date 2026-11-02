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
const ok = (c, n) => { if (c) pass++; else { fail++; failures.push(n); } };
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

// ============ A. 职责边界库单元测试（核心） ============
const blocked = ['打开泵盖检查轴承', '拆卸联轴器', '调整对中', '找正', '更换机械密封', '更换机封', '换新的垫片',
  '焊接补漏', '动火切割', '拆接线', '短接联锁', '强行复位联锁', '自行判断是否能继续运行', '带压堵漏',
  '进入受限空间检查', '登高检查'];
let allBlocked = true;
for (const b of blocked) { if (S.checkAction(b).ok) { allBlocked = false; failures.push(`A-拦截失败: ${b}`); fail++; } }
if (allBlocked) { pass++; ok(true, 'A1 全部 16 类超范围动作被拦截'); }
const allowed = ['停止操作并上报', '通知班长', '就地观察并记录现象', '按应急预案撤离并报警',
  '在安全距离外观察，禁止靠近', '设置警戒，禁止无关人员靠近'];
let allAllowed = true;
for (const b of allowed) { if (!S.checkAction(b).ok) { allAllowed = false; failures.push(`A-误拦截: ${b}`); fail++; } }
if (allAllowed) { pass++; ok(true, 'A2 职责内动作全部放行'); }
ok(S.checkAction('打开泵盖').ruleId === 'S1', 'A3 拆检类规则号 S1');
ok(S.checkAction('更换机械密封').ruleId === 'S3', 'A4 更换类规则号 S3');
ok(S.checkAction('带压堵漏').ruleId === 'S8', 'A5 堵漏类规则号 S8');
ok(S.checkAction('打开泵盖').suggestion.includes('停止操作'), 'A6 替代动作为停止上报');
ok(S.checkAction('更换润滑油').ok, 'A7 加换油属职责内不误拦');

// 设备类型识别顺序（曾有 bug）
eq(S.typeOf('鼓风机电机'), '电机', 'A8 电机优先于风机识别');
eq(S.typeOf('油泵电机'), '电机', 'A9 电机优先于泵识别');
eq(S.typeOf('空压机'), '压缩机', 'A10 空压机归压缩机');
eq(S.typeOf('常压塔顶回流泵'), '离心泵', 'A11 泵识别');
eq(S.typeOf('原油换热器'), '换热器', 'A12 换热器识别');
eq(S.typeOf('常压塔'), '塔器容器', 'A13 塔识别');
eq(S.typeOf('完全不认识'), '通用', 'A14 无法识别→通用');
ok(S.observeOf('离心泵')['看'].length > 0, 'A15 观察要点非空');
ok(S.EMERGENCY.length >= 5, 'A16 紧急撤离条件齐全');

// ============ B. 基础生成 ============
let r = run([...BASE, '--scope', '离心泵,换热器'], 'base');
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

// ============ C. 超范围动作拦截（核心） ============
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

// ============ D. 类型不覆盖 ============
r = run([...BASE, '--scope', '加热炉'], 'uncovered');
eq(r.s.ok, true, 'D1 不覆盖类型不报错');
eq(r.s.counts.uncovered, 1, 'D2 计入未覆盖');
ok(r.j.warnings.some((w) => w.includes('不在覆盖范围')), 'D3 warning 提示');
ok(/待安全专业补充/.test(r.md), 'D4 md 标注待补充');
ok(r.j.sections[0].covered === false, 'D5 section 标记未覆盖');
// 仍输出通用框架而非空
ok(r.j.sections[0].observe['看'].length > 0, 'D6 仍输出通用观察框架');

// ============ E. 上报路径必须来自用户（核心） ============
function raw(args) {
  const x = spawnSync(process.execPath, [G, ...args], { encoding: 'utf8' });
  const l = x.stdout.trim().split('\n');
  try { return { code: x.status, s: JSON.parse(l[l.length - 1]) }; } catch (e) { return { code: x.status, s: { ok: false } }; }
}
eq(raw(['--workshop', 'X', '--scope', '离心泵']).s.ok, false, 'E1 缺 --report-to 报错');
ok(/上报路径必须由厂内实际流程提供/.test(raw(['--workshop', 'X', '--scope', '泵']).s.error), 'E2 错误信息说明不自行设定');
r = run([...BASE, '--scope', '离心泵'], 'noemerg');
ok(r.j.warnings.some((w) => w.includes('未提供紧急上报方式')), 'E3 缺紧急方式 warning');
ok(/紧急上报方式待车间补充/.test(r.md), 'E4 md 标注待补充');
r = run([...BASE, '--scope', '离心泵', '--emergency', '报警 119'], 'emerg');
ok(/报警 119/.test(r.md), 'E5 提供后写入');

// ============ F. 设备清单 ============
const LED = mk('led.xlsx', {
  '设备台账': [['位号', '设备名称', '设备类型', '区域'],
    ['P-01', '进料泵', '离心泵', '一区'],
    ['P-02', '回流泵', '离心泵', '一区'],
    ['M-01', '鼓风机电机', '电机', '二区'],
    ['', '无位号', '离心泵', '一区']],
});
r = run([...BASE, '--ledger', LED], 'ledger');
eq(r.s.ok, true, 'F1 按清单生成');
eq(r.s.counts.equipment, 3, 'F2 空位号行被跳过');
ok(r.j.warnings.some((w) => w.includes('位号为空')), 'F3 空位号 warning');
ok(r.j.sections.some((s) => s.type === '电机'), 'F4 电机单独成节（类型识别顺序正确）');
ok(/P-01（进料泵）/.test(r.md), 'F5 md 列出本车间该类设备');

// 类型列缺失时按名称推断
const NOTYPE = mk('notype.xlsx', {
  '设备台账': [['位号', '设备名称', '区域'], ['P-11', '加氢进料泵', '一区'], ['M-11', '循环水泵电机', '二区']],
});
r = run([...BASE, '--ledger', NOTYPE], 'notype');
ok(r.j.sections.some((s) => s.type === '电机'), 'F6 缺类型列时按名称推断电机');
ok(r.j.sections.some((s) => s.type === '离心泵'), 'F7 缺类型列时按名称推断泵');

// ============ G. 定性判据（不用仪器数值） ============
r = run([...BASE, '--scope', '离心泵,压缩机,电机'], 'qualitative');
const signs = r.j.sections.flatMap((s) => s.abnormalSigns).join(' ');
ok(!/\d+\s*(mm\/s|℃|MPa|kPa|μmol|ppm|A\b)/.test(signs), 'G1 异常特征不含需仪器测量的数值判据');
ok(/明显|烫手|变大|增强|可见/.test(signs), 'G2 异常特征用定性描述');
ok(/手背试温|勿长时间接触|注意触电|勿湿手/.test(r.md), 'G3 摸的动作带安全提示');

// ============ H. 声明行与结构 ============
r = run([...BASE, '--scope', '离心泵'], 'statement');
ok(/仅供参考，不替代操作规程与检修规程/.test(r.md), 'H1 保留培训/指引类声明行');
ok(/遇紧急情况以应急预案为准/.test(r.md), 'H2 声明含应急优先');
ok(r.j.meta.statement.includes('由车间工艺/安全审核后纳入岗位操作法或 HSE 作业指导书'), 'H3 JSON 声明含审核与纳入口径');
ok(/设备专业建议稿/.test(r.md) && /由车间工艺\/安全审核后/.test(r.md), 'H3a md 写明设备专业建议稿与审核方');
ok(!/本指引为辅助材料，须经车间审核/.test(r.md), 'H3b 旧声明行不再出现');
ok(/编制：车间设备员（设备专业建议稿）/.test(r.md), 'H3c 卡头写明编制与审核');
ok(!/[\u2600-\u27BF\u{1F300}-\u{1FAFF}]/u.test(r.md), 'H3d md 不含 emoji');
ok(/【注意】/.test(r.md), 'H3e 醒目提示用【注意】');
ok(/报告要说清的信息/.test(r.md), 'H4 含报告要素节');
ok(/说现象，不用说原因/.test(r.md), 'H5 提示说现象不说原因');

// ============ H2. 白名单限定语写进正文（经值班领导/内操同意） ============
r = run([...BASE, '--scope', '离心泵'], 'whitelist');
ok(/切换至备用设备（按操作规程，经值班领导\/内操同意后执行）/.test(r.md), 'H6 切换备用设备带「经值班领导/内操同意」限定');
ok(/降低负荷（按操作规程，经值班领导\/内操同意后执行）/.test(r.md), 'H7 降低负荷带限定');
ok(/【注意】切换备用设备、降低负荷须经值班领导\/内操同意后按操作规程执行/.test(r.md), 'H8 指引卡正文单独一行写明限定');
ok(r.j.sections[0].actionNote.includes('经值班领导/内操同意'), 'H9 JSON sections.actionNote 含限定');
ok(/通知班长 \/ 内操 \/ 车间设备员 \/ 调度/.test(r.md), 'H10 上报对象用中石化口径（内操/车间设备员）');
ok(/用火等/.test(r.md) && !/动火等/.test(r.md), 'H11 职责边界提示用「用火」');
ok(/报告人岗位与姓名/.test(r.md), 'H12 报告要素含岗位与姓名');
ok(/anomaly-triage-advisor/.test(r.md) && /training-material-generator/.test(r.md), 'H13 卡尾互指相关技能');

// ============ K. 「摸」类观察点：默认限定语 / --no-touch 去掉 ============
r = run([...BASE, '--scope', '离心泵,电机'], 'touch-default');
eq(r.s.noTouch, false, 'K1 默认不启用 no-touch');
ok(r.j.sections.every((s) => s.observe['摸'].every((x) => x.startsWith(S.TOUCH_QUALIFIER))), 'K2 默认每条摸类观察点带限定语');
ok(/仅在操作规程允许且确认安全/.test(r.md), 'K3 md 出现限定语');
eq(r.j.meta.touchQualifier, S.TOUCH_QUALIFIER, 'K4 meta 记录限定语');
eq(r.s.counts.touchPointsRemoved, null, 'K5 未启用时去除计数为 null 而非 0');
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
eq(r.s.counts.observePoints, touchDefault - 3, 'K16 观察要点计数相应减少');
eq(r.j.meta.noTouch, true, 'K17 meta.noTouch 为 true');
eq(r.j.meta.touchQualifier, null, 'K18 no-touch 时限定语为 null');

// ============ L. S5 接线规则只拦动手动作 ============
ok(S.checkAction('检查接线盒外观').ok, 'L1 「检查接线盒外观」不拦截');
ok(S.checkAction('接线盒有无烧灼痕迹').ok, 'L2 「接线盒有无烧灼痕迹」不拦截');
ok(S.checkAction('检查接线是否松动').ok, 'L3 「检查接线是否松动」不拦截');
eq(S.checkAction('拆接线').ruleId, 'S5', 'L4 「拆接线」拦截');
eq(S.checkAction('重新接线').ruleId, 'S5', 'L5 「重新接线」拦截');
eq(S.checkAction('紧固接线端子').ruleId, 'S5', 'L6 「紧固接线端子」拦截');
eq(S.checkAction('短接联锁').ruleId, 'S5', 'L7 「短接联锁」拦截');
eq(S.checkAction('用火作业补焊').ruleId, 'S4', 'L8 「用火」纳入 S4');
ok(/用火作业许可/.test(S.checkAction('动火').reason), 'L9 S4 原因写「用火作业许可」');
r = run([...BASE, '--scope', '电机', '--actions', '检查接线盒外观,拆接线'], 'wiring');
eq(r.s.counts.blockedActions, 1, 'L10 观察类接线描述放行、动手类拦截');
ok(r.j.outOfScope[0].original === '拆接线', 'L11 拦截的是「拆接线」');
ok(S.IN_SCOPE.some((x) => /经值班领导\/内操同意/.test(x)), 'L12 白名单条目自带限定语');
ok(Array.isArray(S.TYPE_PATTERNS) && S.TYPE_PATTERNS.length === 7, 'L13 TYPE_PATTERNS 导出（与 tm.js 同源）');

// ============ M. SAP/EM 导出列名（mergeAliases） ============
const SAP = mk('sap.xlsx', {
  '设备台账': [['功能位置', '设备', '设备描述', '对象类型', '工厂区段'],
    ['P-1101A', '10001234', '常压塔顶回流泵A', '离心泵', '常减压一区'],
    ['M-1501', '10001235', '鼓风机电机', '电机', '四区']],
});
r = run([...BASE, '--ledger', SAP], 'sap');
eq(r.s.ok, true, 'M1 SAP 导出列名可读');
eq(r.s.counts.equipment, 2, 'M2 两台设备（功能位置作位号，不把 SAP 设备编号当位号）');
ok(/P-1101A（常压塔顶回流泵A）/.test(r.md), 'M3 功能位置+设备描述正确映射');
ok(!/10001234/.test(r.md), 'M4 SAP 8 位设备编号未被当成位号');
ok(r.j.sections.some((s) => s.type === '电机') && r.j.sections.some((s) => s.type === '离心泵'), 'M5 对象类型列识别设备类型');
ok(r.j.sections.find((s) => s.type === '离心泵').equipment[0].area === '常减压一区', 'M6 工厂区段映射为区域');
ok(!r.j.warnings.some((w) => /缺少列/.test(w)), 'M7 无缺列 warning');

// ============ I. 参数校验 ============
eq(raw([]).s.ok, false, 'I1 无参数报错');
eq(raw(['--workshop']).s.ok, false, 'I2 缺值报错');
ok(/缺少取值/.test(raw(['--workshop']).s.error), 'I3 缺值信息正确');
eq(raw(['--workshop', 'X', '--report-to', 'Y']).s.ok, false, 'I4 缺 scope 与 ledger 报错');
eq(raw([...BASE, '--scope', '泵', '--format', 'xxx']).s.ok, false, 'I5 非法 format 报错');
eq(raw([...BASE, '--ledger', '/不存在.xlsx']).s.ok, false, 'I6 清单不存在报错');
eq(raw([...BASE, '--scope', '泵', '--未知', 'x']).s.ok, false, 'I7 未知参数报错');
eq(raw([...BASE, '--scope', '泵', '--no-touch', 'x']).s.ok, false, 'I7a --no-touch 为开关，后跟多余值报错');
eq(raw([...BASE, '--ledger', mk('nosheet.xlsx', { '别的': [['a'], [1]] })]).s.ok, false, 'I8 无台账表报错');

// ============ J. 产出完整性 ============
r = run([...BASE, '--scope', '离心泵,换热器', '--emergency', '119'], 'outputs');
ok(fs.existsSync(path.join(r.out, 'guide.json')), 'J1 guide.json 生成');
ok(fs.existsSync(path.join(r.out, '指引卡.md')), 'J2 指引卡.md 生成');
ok(fs.existsSync(path.join(r.out, 'summary.json')), 'J3 summary.json 生成');
ok(r.j.scopeRules.length >= 10, 'J4 JSON 含职责边界规则表');
ok(r.j.reportPath.elements.length >= 5, 'J5 报告要素齐全');
ok(r.j.emergency.length >= 5, 'J6 紧急条件齐全');

console.log(`\n${'='.repeat(56)}`);
console.log(`operator-anomaly-guide 自测：${pass} 通过，${fail} 失败`);
if (failures.length) { console.log('\n失败项：'); failures.forEach((f) => console.log('  ✗ ' + f)); }
console.log('='.repeat(56));
try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
