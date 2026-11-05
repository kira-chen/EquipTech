#!/usr/bin/env node
'use strict';
/** 自测：断言 training.js / tm.js / docsrc.js 行为。用法：node scripts/selftest.js */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { writeXlsx } = require('./lib/xlsx-lite');
const T = require('./lib/tm');
const D = require('./lib/docsrc');

const G = path.join(__dirname, 'training.js');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tmg-selftest-'));
let pass = 0, fail = 0;
const failures = [];
const ok = (c, n) => { if (c) pass++; else { fail++; failures.push(n); } };
const eq = (a, e, n) => ok(a === e, `${n}（期望 ${JSON.stringify(e)}，实际 ${JSON.stringify(a)}）`);

function run(args, tag) {
  const out = path.join(work, tag + '-out');
  const r = spawnSync(process.execPath, [G, ...args, '--out', out], { encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  let s; try { s = JSON.parse(lines[lines.length - 1]); } catch (e) { s = { ok: false, error: 'no-json:' + r.stdout + r.stderr }; }
  const rd = (f) => (fs.existsSync(path.join(out, f)) ? fs.readFileSync(path.join(out, f), 'utf8') : null);
  const jt = rd('training.json');
  return {
    code: r.status, s, out,
    j: jt ? JSON.parse(jt) : null,
    outline: rd('培训提纲.md'), key: rd('讲义要点.md'), qs: rd('考题与答案.md'),
  };
}
function raw(args) {
  const x = spawnSync(process.execPath, [G, ...args], { encoding: 'utf8' });
  const l = x.stdout.trim().split('\n');
  try { return { code: x.status, s: JSON.parse(l[l.length - 1]) }; } catch (e) { return { code: x.status, s: { ok: false } }; }
}
const mkXlsx = (n, b) => { const p = path.join(work, n); writeXlsx(p, b); return p; };
const mkMd = (n, t) => { const p = path.join(work, n); fs.writeFileSync(p, t, 'utf8'); return p; };

/** 带数值的厂内规程样例 */
const SPEC = mkMd('spec.md', `# 车间动设备管理规定（测试）

## 4 离心泵

4.1 地脚螺栓紧固力矩为 120 N·m。
4.2 联轴器径向对中偏差不大于 0.08 mm。
4.3 轴承箱温度不得超过 75 ℃。
4.4 备用泵盘车周期为每 7 天一次。
4.5 泵启动前应确认入口阀全开、出口阀微开。

## 5 记录

5.1 异常描述写现象不写结论。
`);
const SPEC_NONUM = mkMd('spec-nonum.md', `# 管理要求（测试·无数值）

3.1 点检应逐台执行，不得漏项。
3.2 发现异常应先停止操作并上报。
`);
const SPEC_PROC = mkMd('spec-proc.md', `# 合集（测试）

7.1 泵出口压力低于设计值 80 % 时应查明原因。

## 8 开车操作步骤

8.1 开车步骤：先引氮气置换，再缓慢升温升压。
`);

/* ============ A. 数值识别与口径库（核心） ============ */
ok(T.hasNumericValue('紧固力矩为 120 N·m'), 'A1 力矩数值被识别');
ok(T.hasNumericValue('间隙不大于 0.08 mm'), 'A2 间隙数值被识别');
ok(T.hasNumericValue('温度不得超过 75 ℃'), 'A3 温度数值被识别');
ok(T.hasNumericValue('压力不低于 0.3 MPa'), 'A4 压力数值被识别');
ok(T.hasNumericValue('周期为每 3 个月一次'), 'A5 周期数值被识别');
ok(T.hasNumericValue('振动速度不大于 4.5 mm/s'), 'A6 限值数值被识别');
ok(T.hasNumericValue('间隙 0.05~0.10'), 'A7 区间型数值被识别');
ok(!T.hasNumericValue('第3.2条 异常描述写现象不写结论'), 'A8 条款号不误判为技术数值');
ok(!T.hasNumericValue('离心泵靠叶轮旋转产生的离心力把液体甩出'), 'A9 纯定性原理不误判');
ok(!T.hasNumericValue('2026 年修订'), 'A10 年份不误判为技术数值');

eq(T.normAudience('新员工'), '新员工', 'A11 培训对象归一·新员工');
eq(T.normAudience('新人'), '新员工', 'A12 培训对象别名·新人');
eq(T.normAudience('在职'), '在岗', 'A13 培训对象别名·在职');
eq(T.normAudience('调岗'), '转岗', 'A14 培训对象别名·调岗');
eq(T.normAudience('班组长'), null, 'A15 未知培训对象不猜测');
eq(T.typeOf('鼓风机电机'), '电机', 'A16 电机优先于风机识别');
eq(T.typeOf('循环水泵电机'), '电机', 'A17 电机优先于泵识别');
eq(T.typeOf('完全不认识'), '通用', 'A18 无法识别→通用');

// 三类培训对象的深度口径都定义了
for (const k of ['新员工', '在岗', '转岗']) {
  const A = T.AUDIENCES[k];
  ok(A && A.modules.length >= 4 && A.practical.length >= 3, `A19-${k} 深度口径与实操项齐全`);
}
ok(/设备认识/.test(T.AUDIENCES['新员工'].focus) && /异常识别与上报/.test(T.AUDIENCES['新员工'].focus), 'A20 新员工侧重设备认识与异常上报');
ok(/故障处理/.test(T.AUDIENCES['在岗'].focus) && /典型案例/.test(T.AUDIENCES['在岗'].focus), 'A21 在岗侧重故障处理与案例');
ok(/差异点/.test(T.AUDIENCES['转岗'].focus) && /特有设备/.test(T.AUDIENCES['转岗'].focus), 'A22 转岗侧重差异点与特有设备');

// 通用原理库不得含任何厂内数值
let dirty = [];
for (const [t, list] of Object.entries(T.PRINCIPLES)) {
  for (const it of list) if (T.hasNumericValue(it.p) || T.hasNumericValue(it.q)) dirty.push(`${t}:${it.q}`);
}
ok(dirty.length === 0, `A23 通用原理库不含任何数值（脏项：${dirty.join(' / ')}）`);

/* ============ B. 规程类内容拦截 ============ */
ok(!T.checkTopic('编写泵的安全操作规程').ok, 'B1 规程编制类被拦截');
ok(!T.checkTopic('开车步骤').ok, 'B2 开车步骤类被拦截');
ok(!T.checkTopic('应急预案的编写').ok, 'B3 应急预案类被拦截');
ok(!T.checkTopic('动火作业票的办理流程').ok, 'B4 作业票流程类被拦截');
ok(T.checkTopic('离心泵').ok, 'B5 普通设备主题放行');
ok(T.checkTopic('点检记录填写要求').ok, 'B6 记录要求类放行');
eq(T.checkTopic('编写操作规程').ruleId, 'F1', 'B7 规则号 F1');

/* ============ C. 无资料 → 绝不出数值题（命脉） ============ */
let r = run(['--scope', '离心泵,换热器,电机', '--audience', '新员工'], 'nodocs');
eq(r.s.ok, true, 'C1 无资料仍可生成');
eq(r.s.counts.questionsNumeric, 0, 'C2 无资料时数值类题数为 0');
eq(r.s.counts.questionsWithSource, 0, 'C3 无资料时无出处题目');
ok(r.j.warnings.some((w) => w.includes('不产出任何带数值的考题')), 'C4 warning 说明只出原理题');
// 正则扫描产出：答案区不得出现带数值的答案
const ansTable = (r.qs.match(/## 三、答案与出处[\s\S]*?(?=\n## )/) || [''])[0];
ok(!/\d+(?:\.\d+)?\s*(N·m|Nm|MPa|kPa|℃|°C|mm\/s|mm|K\/h|kW|kV|rpm|r\/min|ppm|mg\/L)/i.test(ansTable),
  'C5 无资料时答案表不含任何带单位的数值（命脉）');
ok(!/答案[：:]\s*\d/.test(r.qs), 'C6 无资料时不出现「答案：数字」');
ok(!/每\s*\d+\s*(个?月|天|小时)/.test(ansTable), 'C7 无资料时答案不含周期数值');
// 全部题目都是原理概念类
ok(r.j.questions.every((q) => q.kind === '原理概念类'), 'C8 无资料时全部为原理概念题');
ok(r.j.questions.every((q) => q.cite === '通用原理（非厂内规定）'), 'C9 无资料题目均标注通用原理');
ok(r.j.noSourceTopics.length >= 3, 'C10 无资料主题全部登记 noSourceTopics');
ok(r.j.noSourceTopics.every((n) => /未生成任何带数值的答案/.test(n.handled)), 'C11 登记说明处理方式');
ok(/无资料支撑、未出数值题的主题/.test(r.qs), 'C12 md 单列无资料主题节');
// 讲义要点：厂内规定节为空且明确说明不得凭经验填写
ok(/不得凭经验填写/.test(r.key), 'C13 讲义提示不得凭经验填数值');
eq(r.s.counts.keyPointsInternal, 0, 'C14 无资料时厂内规定要点为 0');

/* ============ D. 有资料 → 数值题必须带出处 ============ */
r = run(['--scope', '离心泵', '--audience', '在岗', '--docs', SPEC, '--questions', '8'], 'docs');
eq(r.s.ok, true, 'D1 有资料生成成功');
eq(r.s.counts.clausesNumeric, 4, 'D2 识别出 4 条含数值条款');
ok(r.s.counts.questionsNumeric > 0, 'D3 产出数值类题目');
ok(r.j.questions.filter((q) => q.kind === '数值类').every((q) => q.source && q.source.file && q.source.loc),
  'D4 每道数值题都带出处（文件+位置）');
ok(r.j.questions.filter((q) => q.kind === '数值类').every((q) => /spec\.md/.test(q.cite)),
  'D5 出处标注到文件名');
ok(r.j.questions.filter((q) => q.kind === '数值类').some((q) => q.source.clause === '4.1'), 'D6 出处标注到条款号');
// 答案表中每一条带数值的答案都有出处列
const rows = (r.qs.match(/^\|\s*\d+\s*\|.*\|$/gm) || []);
ok(rows.length > 0, 'D7 答案表有数据行');
const numRowsNoCite = rows.filter((x) => /\d+(?:\.\d+)?\s*(N·m|MPa|℃|mm)/i.test(x) && !/spec\.md/.test(x));
eq(numRowsNoCite.length, 0, 'D8 答案表中带数值的行全部带出处（命脉）');
// 题干把数值遮住，不能直接抄
ok(r.j.questions.filter((q) => q.kind === '数值类').every((q) => /＿＿/.test(q.stem)), 'D9 数值题干已遮蔽规定值');
// 原理题与厂内规定题分开标注
ok(r.j.questions.some((q) => q.basis === '通用原理') || r.s.counts.questionsAvailable === r.s.counts.questions, 'D10 basis 字段区分依据来源');
ok(r.j.keyPoints.some((k) => k.category === '通用原理' && k.cite === '通用原理（非厂内规定）'), 'D11 讲义原理条目标注通用原理');
ok(r.j.keyPoints.some((k) => k.category === '厂内规定' && k.source), 'D12 讲义厂内条目带出处');
ok(/通用原理要点/.test(r.key) && /厂内规定要点/.test(r.key), 'D13 讲义中原理与厂内规定分节');

/* ============ E. 资料不足以支撑题量 → warning 不凑数（命脉） ============ */
r = run(['--scope', '离心泵', '--audience', '在岗', '--docs', SPEC, '--questions', '200'], 'short');
eq(r.s.ok, true, 'E1 题量不足不报错');
ok(r.s.counts.questions < 200, 'E2 未凑够 200 题');
eq(r.s.counts.questions, r.s.counts.questionsAvailable, 'E3 按可支撑上限出题');
ok(r.j.warnings.some((w) => /只能出\s*\d+\s*道/.test(w)), 'E4 warning 说明可出题数');
ok(r.j.warnings.some((w) => w.includes('未用编造的数值题凑数')), 'E5 warning 明示不凑数');
ok(/未用编造的数值题凑数/.test(r.qs), 'E6 md 中提示未凑数');
eq(r.s.counts.questionsWanted, 200, 'E7 JSON 记录要求题量');
// 无资料时要 40 题只能出原理题数量
r = run(['--scope', '离心泵', '--audience', '新员工', '--questions', '40'], 'short2');
ok(r.s.counts.questions <= r.s.counts.questionsAvailable, 'E8 无资料时同样按上限');
eq(r.s.counts.questionsNumeric, 0, 'E9 题量不足也不靠数值题补（命脉）');

/* ============ F. 资料中的规程类内容被排除 ============ */
r = run(['--scope', '离心泵', '--audience', '在岗', '--docs', SPEC_PROC], 'proc');
eq(r.s.ok, true, 'F1 含规程内容的资料不报错');
ok(r.s.counts.clausesBlocked > 0, 'F2 规程类条款被排除');
ok(r.j.warnings.some((w) => w.includes('安全操作规程')), 'F3 warning 说明排除原因');
ok(r.j.questions.every((q) => !/开车步骤|停车步骤/.test(q.stem + q.answer)), 'F4 产出中无开停车步骤');
ok(r.j.blockedTopics.length > 0, 'F5 被排除内容单列 blockedTopics');
// --scope 中的规程类主题也被拦
r = run(['--scope', '离心泵,编写安全操作规程', '--audience', '在岗'], 'proctopic');
ok(r.j.warnings.some((w) => w.includes('已剔除，不生成')), 'F6 规程类主题被剔除');
ok(r.j.blockedTopics.some((b) => b.ruleId === 'F1'), 'F7 带规则号可追溯');
eq(raw(['--scope', '编写安全操作规程', '--audience', '在岗']).s.ok, false, 'F8 全部主题被剔除时报错而非空转');
// 无数值资料
r = run(['--scope', '离心泵', '--audience', '在岗', '--docs', SPEC_NONUM], 'nonum');
eq(r.s.counts.clausesNumeric, 0, 'F9 无数值资料识别为 0 条数值条款');
eq(r.s.counts.questionsNumeric, 0, 'F10 无数值资料不产出数值题');
ok(r.j.noSourceTopics.length > 0, 'F11 登记为无资料支撑主题');

/* ============ G. 培训对象决定深度 ============ */
const rx = run(['--scope', '离心泵', '--audience', '新员工'], 'aud-x');
const ry = run(['--scope', '离心泵', '--audience', '在岗'], 'aud-y');
const rz = run(['--scope', '离心泵', '--audience', '转岗'], 'aud-z');
ok(/本车间设备认识/.test(rx.outline) && /异常识别与上报/.test(rx.outline), 'G1 新员工提纲含设备认识与异常上报');
ok(/安全注意事项/.test(rx.outline), 'G2 新员工提纲含安全注意事项');
ok(/常见故障现象与处理流程/.test(ry.outline) && /典型案例复盘/.test(ry.outline), 'G3 在岗提纲含故障处理与案例');
ok(/标准与规程要求/.test(ry.outline), 'G4 在岗提纲含标准与规程');
ok(/与原岗位的差异点/.test(rz.outline) && /本车间特有设备/.test(rz.outline), 'G5 转岗提纲含差异点与特有设备');
ok(!/与原岗位的差异点/.test(rx.outline), 'G6 新员工提纲不含转岗差异模块');
eq(rx.s.difficulty, '基础', 'G7 新员工默认难度基础');
eq(ry.s.difficulty, '中等', 'G8 在岗默认难度中等');
ok(rx.j.practicalItems.length >= 3 && rx.j.practicalItems[0].audience === '新员工', 'G9 实操项按对象生成');
ok(/不在本提纲范围内的内容/.test(rx.outline), 'G10 提纲单列不生成的内容');

/* ============ H. 题型 ============ */
r = run(['--scope', '离心泵', '--audience', '在岗', '--types', '单选,判断'], 'types');
ok(r.j.questions.every((q) => ['单选', '判断'].includes(q.type)), 'H1 --types 限定题型生效');
r = run(['--scope', '离心泵', '--audience', '在岗', '--types', '简答'], 'types2');
ok(r.j.questions.every((q) => q.type === '简答'), 'H2 单一题型');
r = run(['--scope', '离心泵', '--audience', '在岗', '--types', '单选,连线'], 'types3');
ok(r.j.warnings.some((w) => w.includes('无法识别')), 'H3 未知题型 warning 并忽略');
ok(r.j.questions.every((q) => q.type === '单选'), 'H4 未知题型不影响其余');
eq(raw(['--scope', '泵', '--audience', '在岗', '--types', '连线,填图']).s.ok, false, 'H5 全部题型不可识别时报错');
r = run(['--scope', '离心泵', '--audience', '在岗'], 'types4');
ok(T.QUESTION_TYPES.every((t) => T.QUESTION_TYPES.includes(t)) && r.s.types.length === 4, 'H6 默认四种题型');
// 选项不得出现编造的数值干扰项
r = run(['--scope', '离心泵', '--audience', '在岗', '--docs', SPEC, '--types', '单选'], 'opts');
const distract = r.j.questions.flatMap((q) => (q.options || []).filter((o) => !o.correct).map((o) => o.text));
ok(distract.length > 0, 'H7 单选题有干扰项');
ok(!distract.some((d) => T.hasNumericValue(d)), 'H8 干扰项不含任何数值（不得编造数值干扰项）');

/* ============ I. 设备清单 ============ */
const LED = mkXlsx('led.xlsx', {
  '设备台账': [['位号', '设备名称', '设备类型', '区域'],
    ['P-01', '进料泵', '离心泵', '一区'],
    ['P-02', '回流泵', '离心泵', '一区'],
    ['M-01', '鼓风机电机', '电机', '二区'],
    ['', '无位号', '离心泵', '一区'],
    ['合计', 3, '', '']],
});
r = run(['--ledger', LED, '--audience', '新员工'], 'ledger');
eq(r.s.ok, true, 'I1 仅给台账可生成');
eq(r.s.counts.equipment, 3, 'I2 空位号行被跳过');
ok(r.j.warnings.some((w) => w.includes('位号为空')), 'I3 空位号 warning 含行号');
ok(r.j.warnings.some((w) => w.includes('合计行')), 'I4 合计行被跳过并 warning');
ok(/P-01/.test(r.outline), 'I5 提纲列出本车间位号');
ok(r.j.counts.equipTypes === 2, 'I6 按类型归组');
// 别名列头 + 标题行在前
const LED2 = mkXlsx('led2.xlsx', {
  '设备清单': [['某装置设备一览'], [], ['设备位号', '名称', '类别'], ['P-11', '加氢进料泵', ''], ['M-11', '循环水泵电机', '']],
});
r = run(['--ledger', LED2, '--audience', '新员工'], 'alias');
eq(r.s.ok, true, 'I7 别名列头 + 标题行表头识别');
eq(r.s.counts.equipment, 2, 'I8 读到 2 台设备');
ok(r.j.outline.some((m) => m.topics.some((t) => /电机/.test(t))), 'I9 缺类型列时按名称推断电机');

/* ============ J. 学时分配 ============ */
r = run(['--scope', '离心泵', '--audience', '新员工', '--duration', '8'], 'dur');
eq(r.s.ok, true, 'J1 指定学时成功');
const hours = r.j.outline.map((m) => m.hours);
ok(hours.every((h) => h !== null), 'J2 各模块有学时');
ok(Math.abs(hours.reduce((x, y) => x + y, 0) - 8) < 0.5, 'J3 学时合计约等于总学时');
r = run(['--scope', '离心泵', '--audience', '新员工'], 'nodur');
ok(r.j.outline.every((m) => m.hours === null), 'J4 未指定学时时为 null 不臆造');
ok(/未指定/.test(r.outline), 'J5 md 标注学时待排');
ok(/—/.test(r.outline), 'J6 学时 null 显示为「—」不是 0');

/* ============ K. 参数校验 ============ */
eq(raw([]).s.ok, false, 'K1 无参数报错');
eq(raw(['--audience']).s.ok, false, 'K2 缺值报错');
ok(/缺少取值/.test(raw(['--audience']).s.error), 'K3 缺值信息正确');
eq(raw(['--scope', '泵']).s.ok, false, 'K4 缺 --audience 报错');
eq(raw(['--audience', '班组长', '--scope', '泵']).s.ok, false, 'K5 非法培训对象报错');
ok(/只能是/.test(raw(['--audience', '班组长', '--scope', '泵']).s.error), 'K6 报错列出可选值');
eq(raw(['--audience', '在岗']).s.ok, false, 'K7 缺 scope 与 ledger 报错');
eq(raw(['--audience', '在岗', '--scope', '泵', '--difficulty', '地狱']).s.ok, false, 'K8 非法难度报错');
eq(raw(['--audience', '在岗', '--scope', '泵', '--questions', '零']).s.ok, false, 'K9 非法题量报错');
eq(raw(['--audience', '在岗', '--scope', '泵', '--questions', '-3']).s.ok, false, 'K10 负题量报错');
eq(raw(['--audience', '在岗', '--scope', '泵', '--duration', 'abc']).s.ok, false, 'K11 非法学时报错');
eq(raw(['--audience', '在岗', '--ledger', '/不存在.xlsx']).s.ok, false, 'K12 清单不存在报错');
eq(raw(['--audience', '在岗', '--scope', '泵', '--docs', '/不存在.md']).s.ok, false, 'K13 资料不存在报错');
eq(raw(['--audience', '在岗', '--scope', '泵', '--未知', 'x']).s.ok, false, 'K14 未知参数报错');
eq(raw(['--audience', '在岗', '--ledger', mkXlsx('nosheet.xlsx', { '别的': [['a'], [1]] })]).s.ok, false, 'K15 无台账表报错');
ok(raw(['--audience', '在岗', '--scope', '泵', '--questions', '零']).code === 1, 'K16 失败退出码为 1');

/* ============ L. 资料格式与出处 ============ */
const TXT = mkMd('plain.txt', '1.1 轴承温度不得超过 70 ℃。\n1.2 记录应如实填写。\n');
r = run(['--scope', '离心泵', '--audience', '在岗', '--docs', TXT], 'txt');
eq(r.s.ok, true, 'L1 支持 .txt 资料');
eq(r.s.counts.clausesNumeric, 1, 'L2 txt 中识别 1 条数值条款');
// 不支持的扩展名 → warning 不中断
const BAD = mkMd('x.rtf', 'anything');
r = run(['--scope', '离心泵', '--audience', '在岗', '--docs', BAD], 'badext');
eq(r.s.ok, true, 'L3 不支持的资料格式不中断');
ok(r.j.warnings.some((w) => w.includes('不支持')), 'L4 格式不支持 warning');
ok(r.j.warnings.some((w) => w.includes('未抽取到任何条款')), 'L5 抽不到条款时 warning');
eq(r.s.counts.questionsNumeric, 0, 'L6 抽不到条款时不出数值题');
// 多个资料 + 目录
const DIR = path.join(work, 'docsdir');
fs.mkdirSync(DIR, { recursive: true });
fs.copyFileSync(SPEC, path.join(DIR, 'a.md'));
fs.copyFileSync(SPEC_NONUM, path.join(DIR, 'b.md'));
r = run(['--scope', '离心泵', '--audience', '在岗', '--docs', DIR], 'dir');
eq(r.s.ok, true, 'L7 支持资料目录');
eq(r.j.meta.docFiles.length, 2, 'L8 目录中两个文件都读到');
r = run(['--scope', '离心泵', '--audience', '在岗', '--docs', `${SPEC},${SPEC_NONUM}`], 'multi');
eq(r.j.meta.docFiles.length, 2, 'L9 逗号分隔多资料');
// 说明性引用块不被当成条款
ok(!r.j.keyPoints.some((k) => k.category === '厂内规定' && /^>/.test(k.point)), 'L10 引用块不入条款');
// citeOf 格式
eq(D.citeOf({ file: 'a.md', loc: '第5行', clause: '4.1' }), 'a.md 第4.1条（第5行）', 'L11 出处写法含文件、条款号与位置');
eq(D.citeOf({ file: 'a.md', loc: '第5行', clause: null }), 'a.md（第5行）', 'L12 无条款号时仍带文件与位置');
// docx 资料：docx 是 zip 包，须先解压取 word/document.xml 再解析（缺陷复现：旧版把压缩包字节直接交给 extractBlocks，报「s.replace is not a function」后跳过）
const X = require('./lib/docx-lite');
const DOCX = path.join(work, '静设备管理规定.docx');
fs.writeFileSync(DOCX, X.buildDocx([
  X.pXml('静设备管理规定（测试）'),
  X.pXml('4.1 离心泵轴承箱温度不得超过 75 ℃。'),
  X.pXml('4.2 联轴器径向对中偏差不大于 0.08 mm。'),
  X.pXml('4.3 巡检发现异常应先上报。'),
  X.tblXml([['项目', '规定值'], ['地脚螺栓紧固力矩', '120 N·m']]),
].join('')));
const dw = [];
const dItems = D.readDocFile(DOCX, dw);
eq(dw.length, 0, 'L13 docx 资料读取无 warning（不再报 s.replace is not a function）');
ok(dItems.some((x) => x.text === '4.1 离心泵轴承箱温度不得超过 75 ℃。' && x.loc === '第2段'), 'L14 docx 段落按「第N段」带位置');
ok(dItems.some((x) => x.text === '地脚螺栓紧固力矩 120 N·m' && x.loc === '表1第2行'), 'L15 docx 表格行按「表N第M行」带位置');
r = run(['--scope', '离心泵', '--audience', '在岗', '--docs', DOCX], 'docx');
eq(r.s.ok, true, 'L16 docx 资料生成成功');
ok(!r.j.warnings.some((w) => /无法解析/.test(w)), 'L17 docx 资料不再被跳过');
ok(r.j.meta.docFiles.some((d) => d.file === '静设备管理规定.docx' && d.lines > 0), 'L18 meta.docFiles 中 docx 行数大于 0');
eq(r.s.counts.clausesNumeric, 3, 'L19 docx 中识别 3 条数值条款（含表格行）');
ok(r.j.questions.filter((q) => q.kind === '数值类').length > 0
  && r.j.questions.filter((q) => q.kind === '数值类').every((q) => /静设备管理规定\.docx/.test(q.cite) && /第\d+段|表\d+第\d+行/.test(q.cite)), 'L20 docx 数值题出处带文件名与段落/表格位置');
// 损坏的 docx（非 zip）→ warning 跳过，不中断
const BADDOCX = mkMd('坏文件.docx', '这不是 zip');
const bw = [];
eq(D.readDocFile(BADDOCX, bw).length, 0, 'L21 损坏 docx 返回空');
ok(bw.some((w) => /坏文件\.docx.*无法解析/.test(w)), 'L22 损坏 docx 给出无法解析 warning');

/* ============ M. 声明行与产出完整性 ============ */
r = run(['--scope', '离心泵', '--audience', '新员工', '--docs', SPEC, '--duration', '6'], 'final');
const ST = '仅供参考，不替代操作规程与检修规程；设备专业建议稿，由车间工艺/安全审核后使用。本材料由脚本汇总、模型成文，其中内置通用原理条目（source: builtin）须经车间技术人员审核后方可使用；技能鉴定请以国家或企业正式题库为准';
ok(r.outline.includes(ST), 'M1 培训提纲保留声明行');
ok(r.key.includes(ST), 'M2 讲义要点保留声明行');
ok(r.qs.includes(ST), 'M3 考题与答案保留声明行');
ok(r.j.meta.statement.includes('技能鉴定请以国家或企业正式题库为准'), 'M4 JSON 中含声明');
ok(fs.existsSync(path.join(r.out, 'training.json')), 'M5 training.json 生成');
ok(fs.existsSync(path.join(r.out, '培训提纲.md')), 'M6 培训提纲.md 生成');
ok(fs.existsSync(path.join(r.out, '讲义要点.md')), 'M7 讲义要点.md 生成');
ok(fs.existsSync(path.join(r.out, '考题与答案.md')), 'M8 考题与答案.md 生成');
ok(fs.existsSync(path.join(r.out, 'summary.json')), 'M9 summary.json 落盘');
for (const k of ['outline', 'keyPoints', 'questions', 'practicalItems', 'noSourceTopics', 'counts']) {
  ok(r.j[k] !== undefined, `M10-${k} training.json 含 ${k}`);
}
// 分析段占位符
for (const [n, md] of [['培训提纲', r.outline], ['讲义要点', r.key], ['考题与答案', r.qs]]) {
  ok(md.includes('<!-- ANALYSIS_START -->') && md.includes('<!-- ANALYSIS_END -->'), `M11-${n} 含分析段占位符`);
}
// 章节齐全
ok(/## 一、培训目标/.test(r.outline) && /## 二、模块与学时分配/.test(r.outline) && /## 四、实操考核项/.test(r.outline), 'M12 提纲章节齐全');
ok(/## 二、通用原理要点/.test(r.key) && /## 三、厂内规定要点/.test(r.key) && /## 四、无资料支撑的内容/.test(r.key), 'M13 讲义章节齐全');
ok(/## 一、题量构成/.test(r.qs) && /## 二、考题/.test(r.qs) && /## 三、答案与出处/.test(r.qs), 'M14 考题章节齐全');
ok(/不生成/.test(r.outline) && /厂内正式规程/.test(r.outline), 'M15 提纲声明不生成规程类内容');
ok(r.j.forbiddenRules.length >= 5, 'M16 JSON 含规程类拦截规则表');
ok(/北京时间/.test(r.outline), 'M17 时间标注北京时间');

/* ============ N. 中石化口径改造（2026-10-26） ============ */
// N1~N9 培训对象补 复岗 / 四新 / 三级安全教育
ok(['复岗', '四新', '三级安全教育'].every((k) => T.AUDIENCE_KEYS.includes(k)), 'N1 培训对象含复岗、四新、三级安全教育');
eq(T.normAudience('复岗'), '复岗', 'N2 复岗识别');
eq(T.normAudience('返岗人员'), '复岗', 'N3 返岗别名→复岗');
eq(T.normAudience('新设备投用培训'), '四新', 'N4 「新设备」归四新而不是新员工');
eq(T.normAudience('四新'), '四新', 'N5 四新识别');
eq(T.normAudience('班组级安全教育'), '三级安全教育', 'N6 班组级→三级安全教育');
eq(T.normAudience('新上岗'), '新员工', 'N7 新上岗仍归新员工');
for (const k of ['复岗', '四新', '三级安全教育']) {
  const A = T.AUDIENCES[k];
  ok(A && A.modules.length >= 4 && A.practical.length >= 3 && A.forbid.length >= 1, `N8-${k} 深度口径、实操项与不讲内容齐全`);
}
r = run(['--scope', '离心泵', '--audience', '四新'], 'aud-4new');
eq(r.s.ok, true, 'N9 四新可生成');
ok(/新设备 \/ 新材料的结构与特点/.test(r.outline) && /投用前条件确认/.test(r.outline), 'N10 四新提纲含新设备差异与投用前条件确认');
r = run(['--scope', '离心泵', '--audience', '三级安全教育'], 'aud-3lvl');
ok(/厂级安全教育内容由公司安全环保部门归口，本材料不生成/.test(r.outline), 'N11 三级安全教育声明厂级由公司安全环保部门归口');
ok(/班组级：岗位设备安全操作/.test(r.outline), 'N12 三级安全教育含班组级模块');
r = run(['--scope', '离心泵', '--audience', '复岗'], 'aud-back');
ok(/离岗期间的变化点/.test(r.outline) && /未闭环的缺陷与隐患/.test(r.outline), 'N13 复岗提纲含变化点与未闭环缺陷隐患');
// N14~N19 内置原理条目 source:'builtin' 与声明行
ok(Object.values(T.PRINCIPLES).every((list) => list.every((it) => it.source === 'builtin')), 'N14 PRINCIPLES 全部条目 source=builtin');
ok(r.j.questions.filter((q) => q.kind === '原理概念类').every((q) => q.origin === 'builtin'), 'N15 原理概念题 origin=builtin');
ok(r.j.keyPoints.filter((k) => k.category === '通用原理').every((k) => k.origin === 'builtin'), 'N16 讲义原理要点 origin=builtin');
ok(r.s.counts.questionsBuiltinPrinciple > 0, 'N17 counts 统计内置原理题数');
ok(/内置条目 builtin，需技术人员审核/.test(r.key) && /内置条目 builtin，需技术人员审核/.test(r.qs), 'N18 讲义与答案表点名内置条目需审核');
ok(/内置通用原理条目（source: builtin）须经车间技术人员审核/.test(T.STATEMENT) && /仅供参考，不替代操作规程与检修规程；设备专业建议稿，由车间工艺\/安全审核后使用/.test(T.STATEMENT), 'N19 声明行用培训类模板并点名内置条目');
ok(/设备专业建议稿（车间设备员视角）/.test(r.outline) && /由车间工艺\/安全审核后纳入培训计划/.test(r.outline), 'N20 抬头写明建议稿与审核路径');
ok(!/本材料为辅助生成，须经车间技术人员审核后使用；技能鉴定/.test(r.outline), 'N21 旧声明行不再出现');
// N22~N31 判断题否定式（不改数值）
r = run(['--scope', '离心泵', '--audience', '在岗', '--docs', SPEC, '--types', '判断'], 'negjudge');
const negs = r.j.questions.filter((q) => q.negated);
const poss = r.j.questions.filter((q) => q.type === '判断' && !q.negated);
ok(negs.length > 0, 'N22 判断题生成了否定式');
ok(poss.length > 0, 'N23 判断题仍有肯定式');
ok(negs.every((q) => q.answer === '错误'), 'N24 否定式答案为「错误」');
ok(poss.every((q) => q.answer === '正确'), 'N25 肯定式答案为「正确」');
ok(negs.every((q) => T.digitsOf(q.stem) === T.digitsOf(q.answerText)), 'N26 否定式改写前后数字序列一致（未改数值）');
ok(negs.every((q) => /正确表述：/.test(q.answerNote) && q.negateRule), 'N27 否定式答案注明正确表述与改写规则');
ok(negs.filter((q) => q.kind === '数值类').every((q) => q.source && q.source.file), 'N28 数值类否定式判断题仍带出处');
ok(/判断题肯定式 \/ 否定式/.test(r.qs) && /正确表述：/.test(r.qs), 'N29 md 题量表与答案表体现否定式');
eq(r.s.counts.questionsJudgeNegated, negs.length, 'N30 counts.questionsJudgeNegated 与实际一致');
r = run(['--scope', '离心泵', '--audience', '在岗', '--docs', SPEC, '--types', '判断', '--no-negative-judge'], 'nonegjudge');
eq(r.s.counts.questionsJudgeNegated, 0, 'N31 --no-negative-judge 时无否定式');
ok(r.j.questions.every((q) => q.answer === '正确'), 'N32 关闭否定式后判断题全为正确');
// negateStatement 单测：不碰数值、避开复合词
const ng1 = T.negateStatement('泵体振动速度有效值不大于 4.5 mm/s');
ok(ng1 && /可以大于 4.5 mm\/s/.test(ng1.text) && !/没有效/.test(ng1.text), 'N33 「有效值」不被误改为「没有效值」，比较词改为可以大于');
const ng2 = T.negateStatement('换热器投用升温速率不大于 30 K/h，避免温差应力损伤管板');
ok(ng2 && !/无需力/.test(ng2.text) && T.digitsOf(ng2.text) === '30', 'N34 「应力」不被误改，数值不变');
eq(T.negateStatement('完全没有可改写点的句子'), null, 'N35 无可改写点返回 null（退回肯定式）');
ok(T.negateStatement('轴承箱温度不得超过 75 ℃').text === '轴承箱温度可以超过 75 ℃', 'N36 不得→可以，数值原样');
// N37~N40 ALIASES 合并 SYSTEM_ALIASES：SAP PM 导出列名
const SAP = mkXlsx('sap.xlsx', {
  '技术对象清单': [['IH08 导出'], [], ['功能位置', '设备', '设备描述', '对象类型', '工厂区段'],
    ['P-31', '10000231', '进料泵', '离心泵', '一区'],
    ['M-31', '10000418', '鼓风机电机', '电机', '二区']],
});
r = run(['--ledger', SAP, '--audience', '新员工'], 'sap');
eq(r.s.ok, true, 'N37 SAP 导出列名（功能位置/设备描述/对象类型/工厂区段）可读');
eq(r.s.counts.equipment, 2, 'N38 读到 2 台设备');
ok(/P-31/.test(r.outline) && !/10000231/.test(r.outline), 'N39 位号取功能位置，SAP「设备」8 位流水号不当位号');
ok(r.j.outline.some((m) => m.topics.some((t) => /电机/.test(t))) && r.s.counts.equipTypes === 2, 'N40 对象类型列按设备类型归组');
// N41 作业许可术语：用火
ok(!T.checkTopic('用火作业许可证的办理流程').ok && T.checkTopic('用火作业许可证的办理流程').ruleId === 'F5', 'N41 「用火作业许可证办理流程」被 F5 拦截');
// N42 产出 md 不含 emoji
r = run(['--scope', '离心泵', '--audience', '在岗', '--docs', SPEC, '--questions', '200'], 'noemoji');
ok(/【注意】要求 200 题/.test(r.qs) && !/[\u26A0\u2705\u274C\u{1F600}-\u{1F6FF}]/u.test(r.qs + r.key + r.outline), 'N42 题量不足提示用【注意】且三份 md 无 emoji');
// N43 TYPE_PATTERNS 与 operator-anomaly-guide/scope.js 同源
const SCOPE = path.join(__dirname, '..', '..', 'operator-anomaly-guide', 'scripts', 'lib', 'scope.js');
if (fs.existsSync(SCOPE)) {
  const S = require(SCOPE);
  ok(JSON.stringify(S.TYPE_PATTERNS.map(([t, re]) => [t, re.source])) === JSON.stringify(T.TYPE_PATTERNS.map(([t, re]) => [t, re.source])), 'N43 TYPE_PATTERNS 与 operator-anomaly-guide scope.js 逐字一致（同源）');
} else ok(true, 'N43 operator-anomaly-guide 不在同一目录，跳过同源比对');
// N44~N46 文档同步
const SK = fs.readFileSync(path.join(__dirname, '..', 'SKILL.md'), 'utf8');
ok(/复岗/.test(SK) && /四新/.test(SK) && /三级安全教育/.test(SK), 'N44 SKILL.md 培训对象含复岗/四新/三级安全教育');
ok(/明确告知用户并终止/.test(SK) && !/手工成文/.test(SK.replace(/不得基于文字手工成文/g, '')), 'N45 SKILL.md node 不可用为终止');
const TR = fs.readFileSync(path.join(__dirname, '..', 'references', 'training-rules.md'), 'utf8');
ok(/scope\.js/.test(TR) && /同源/.test(TR) && /否定式/.test(TR), 'N46 training-rules 注明 TYPE_PATTERNS 同源与判断题否定式');
// N47 make-sample 产出 SAP 样例
const MS = path.join(__dirname, 'make-sample.js');
const msOut = path.join(work, 'ms');
const ms = spawnSync(process.execPath, [MS, '--out', msOut, '--seed', '3'], { encoding: 'utf8' });
const msj = JSON.parse(ms.stdout.trim().split('\n').pop());
ok(msj.ok && msj.files.includes('sample-sap-export.xlsx'), 'N47 make-sample 生成 SAP 导出样式样例');
const { readXlsx } = require('./lib/xlsx-lite');
ok(readXlsx(path.join(msOut, 'sample-sap-export.xlsx'))['技术对象清单'][2].map(String).includes('功能位置'), 'N48 SAP 样例表头含功能位置');
r = run(['--ledger', path.join(msOut, 'sample-sap-export.xlsx'), '--audience', '新员工'], 'ms-sap');
eq(r.s.counts.equipment, 5, 'N49 SAP 样例读到 5 台设备（seed 变化不变）');

// ============ P. 缺陷修复（2026-11-04 核查）============
// 数值题干遮蔽：区间两端、比较词后不带单位的数、分数都要遮，题干不得留答案数值
{
  const RS = mkMd('spec-range.md', '# 离心泵\n4.1 联轴器对中径向偏差控制在 0.05~0.10 mm。\n4.2 轴承箱油位不低于 1/2 视镜。\n4.3 冷却水回水温度不高于 40。\n4.4 备用泵盘车角度 180°。\n4.5 润滑油每 3 个月更换一次。\n');
  r = run(['--scope', '离心泵', '--audience', '在岗', '--docs', RS, '--types', '简答'], 'mask');
  const nq = r.j.questions.filter((q) => q.kind === '数值类');
  const stemOf = (k) => (nq.find((q) => q.answer.includes(k)) || {}).stem || '';
  ok(!/0\.05|0\.10/.test(stemOf('0.05~0.10')), `P1 区间两端都遮蔽（实际题干：${stemOf('0.05~0.10')}）`);
  ok(!/1\/2/.test(stemOf('1/2')), `P2 「不低于 1/2」比较词后的分数遮蔽（实际题干：${stemOf('1/2')}）`);
  ok(!/40/.test(stemOf('不高于 40')), `P3 比较词后不带单位的数遮蔽（实际题干：${stemOf('不高于 40')}）`);
  ok(T.hasNumericValue('备用泵盘车角度 180°') && nq.some((q) => q.answer.includes('180°')) && !/180/.test(stemOf('180°')), 'P4 「180°」识别为数值条款并遮蔽');
  ok(nq.every((q) => T.digitsOf(q.stem) === ''), 'P5 数值题干中不留任何技术数值');
  eq(r.s.counts.clausesNumeric, 5, 'P6 五条均识别为数值条款');
}
// 数值题干遮蔽：连字符区间两端、负数（负号前为比较词/空白/句首时算数的一部分）都要遮；字母后的「-」按位号不遮
{
  const RS2 = mkMd('spec-neg.md', '# 离心泵\n5.1 轴承间隙应为0.05-0.10mm。\n5.2 环境温度低于-10℃时应停机。\n5.3 冷却水温度控制在 -20~-5℃。\n5.4 P-2101A 出口压力不低于 1.2 MPa。\n5.5 密封冲洗压差 0.1-0.2。\n');
  r = run(['--scope', '离心泵', '--audience', '在岗', '--docs', RS2, '--types', '简答'], 'mask-neg');
  const nq = r.j.questions.filter((q) => q.kind === '数值类');
  const stemOf = (k) => (nq.find((q) => q.answer.includes(k)) || {}).stem || '';
  ok(!!stemOf('0.05-0.10') && !/0\.05|0\.10/.test(stemOf('0.05-0.10')), `P5a 连字符区间两端都遮蔽（实际题干：${stemOf('0.05-0.10')}）`);
  ok(!!stemOf('-10℃') && !/10/.test(stemOf('-10℃')) && !/低于\s*-/.test(stemOf('-10℃')), `P5b 「低于-10℃」负数连同负号遮蔽（实际题干：${stemOf('-10℃')}）`);
  ok(!!stemOf('-20~-5') && !/20|5℃|-\s*＿/.test(stemOf('-20~-5')), `P5c 负数区间两端连同负号遮蔽（实际题干：${stemOf('-20~-5')}）`);
  ok(/P-2101A/.test(stemOf('P-2101A')) && !/1\.2/.test(stemOf('P-2101A')), `P5d 字母后的「-」按位号保留，规定值遮蔽（实际题干：${stemOf('P-2101A')}）`);
  ok(!!stemOf('0.1-0.2') && !/0\.1|0\.2/.test(stemOf('0.1-0.2')), `P5e 不带单位的连字符区间右端也遮（实际题干：${stemOf('0.1-0.2')}）`);
}
// 反应器归塔器容器（与 operator-anomaly-guide 同源）
eq(T.typeOf('加氢精制反应器'), '塔器容器', 'P7 「反应器」归塔器容器，不落到通用');
// 资料目录里的 PDF 与不支持格式不得静默丢弃：逐个 warning，PDF 提示先转 txt/docx
{
  const dd = path.join(work, 'docs-pdf');
  fs.mkdirSync(dd, { recursive: true });
  fs.writeFileSync(path.join(dd, '规定.md'), '# 离心泵\n4.1 备用泵每 7 天盘车一次。\n', 'utf8');
  fs.writeFileSync(path.join(dd, '压缩机说明书.pdf'), '%PDF-1.4', 'utf8');
  fs.writeFileSync(path.join(dd, '课件.pptx'), 'x', 'utf8');
  r = run(['--scope', '离心泵', '--audience', '在岗', '--docs', dd], 'pdfdir');
  ok(r.s.warnings.some((w) => /压缩机说明书\.pdf/.test(w) && /pdf 技能/.test(w)), 'P8 目录中的 PDF 逐个 warning 并提示先用平台 pdf 技能转 txt/docx');
  ok(r.s.warnings.some((w) => /课件\.pptx/.test(w) && /已跳过/.test(w)), 'P9 目录中不支持的格式逐个 warning');
  eq(r.s.counts.clausesNumeric, 1, 'P10 受支持的资料照常抽取');
  const one = run(['--scope', '离心泵', '--audience', '在岗', '--docs', path.join(dd, '压缩机说明书.pdf')], 'pdfone');
  ok(one.s.warnings.some((w) => /pdf 技能/.test(w)), 'P11 单独传 PDF 同样提示前置转换');
}

// 「数字-数字」编号（E-1201-3、M20-8.8 级）不是区间，尾段不遮；真区间与带单位规定值照常遮
{
  const RS3 = mkMd('spec-code.md', '# 换热器\n6.1 E-1201-3 次试压记录应存档。\n6.2 法兰螺栓采用 M20-8.8级。\n6.3 管程试验压力为 1.6 MPa。\n6.4 每 3-5 天检查一次。\n');
  r = run(['--scope', '换热器', '--audience', '在岗', '--docs', RS3, '--types', '简答'], 'mask-code');
  const nq = r.j.questions.filter((q) => q.kind === '数值类');
  const stemOf = (k) => (nq.find((q) => q.answer.includes(k)) || {}).stem || '';
  ok(/E-1201-3\s*次/.test(stemOf('E-1201-3')), `P12 「E-1201-3 次」编号尾段不遮（实际题干：${stemOf('E-1201-3')}）`);
  ok(/M20-8\.8级/.test(stemOf('M20-8.8')), `P13 「M20-8.8级」编号尾段不遮（实际题干：${stemOf('M20-8.8')}）`);
  ok(!!stemOf('1.6 MPa') && !/1\.6/.test(stemOf('1.6 MPa')), `P14 带单位规定值照常遮（实际题干：${stemOf('1.6 MPa')}）`);
  ok(!!stemOf('3-5 天') && !/3|5/.test(stemOf('3-5 天')), `P15 「3-5 天」真区间两端照常遮（实际题干：${stemOf('3-5 天')}）`);
}
// 同时给 --ledger 与 --scope：按 scope 过滤台账，不再把台账全部设备类型都带进来
{
  const LED3 = mkXlsx('led3.xlsx', {
    '设备台账': [['位号', '设备名称', '设备类型', '区域'],
      ['P-01', '进料泵', '离心泵', '一区'],
      ['P-02', '回流泵', '离心泵', '一区'],
      ['M-01', '鼓风机电机', '电机', '二区'],
      ['E-01', '原油换热器', '换热器', '二区']],
  });
  r = run(['--ledger', LED3, '--scope', '离心泵', '--audience', '新员工'], 'ledger-scope');
  eq(r.s.ok, true, 'I10 台账 + scope 可生成');
  eq(r.s.counts.equipTypes, 1, 'I11 台账按 scope 过滤后只剩离心泵一类');
  eq(r.s.counts.equipment, 2, 'I12 过滤后只剩 2 台泵');
  ok(!/M-01|E-01/.test(r.outline) && /P-01/.test(r.outline), 'I13 提纲不列 scope 以外的设备位号');
  ok(r.s.warnings.some((w) => /--scope/.test(w) && /保留 2 台/.test(w) && /2 台/.test(w)), 'I14 warning 写明按 scope 过滤的保留 / 剔除台数');
  r = run(['--ledger', LED3, '--scope', '离心泵,压缩机', '--audience', '新员工'], 'ledger-scope2');
  eq(r.s.counts.equipTypes, 2, 'I15 scope 中台账没有的类型仍保留一节');
  ok(r.s.warnings.some((w) => /清单中没有「压缩机」类设备/.test(w)), 'I16 scope 中台账没有的类型 warning');
  r = run(['--ledger', LED3, '--scope', 'E-01', '--audience', '新员工'], 'ledger-scope3');
  eq(r.s.counts.equipment, 1, 'I17 scope 写位号时按位号过滤台账');
  r = run(['--ledger', LED3, '--scope', '全部', '--audience', '新员工'], 'ledger-scope4');
  eq(r.s.counts.equipment, 4, 'I18 scope「全部」不过滤台账');
}

/* ============ W. 车间范围核对（D007）：只核对 --ledger 台账 ============ */
{
  const sc = (i) => ((r.j && r.j.meta.workshopScope) || [])[i] || {};
  const WB = ['--audience', '新员工', '--workshop', '测试车间'];
  const HW = ['位号', '设备名称', '设备类型', '区域', '车间'];
  const WMIX = mkXlsx('ws-mix.xlsx', { '设备台账': [HW,
    ['P-01', '进料泵', '离心泵', '一区', '测试车间'], ['P-02', '回流泵', '离心泵', '一区', '测试'],
    ['P-91', '外车间泵', '离心泵', '九区', '催化车间'], ['K-91', '外车间压缩机', '压缩机', '九区', '催化车间'],
    ['M-01', '鼓风机电机', '电机', '二区', ''],
  ] });
  r = run(['--ledger', WMIX, ...WB], 'ws-mix');
  eq(r.s.counts.equipment, 3, 'W1 台账只保留本车间与车间为空的设备（剔除催化车间 2 台）');
  ok(!/P-91|K-91/.test(r.outline || ''), 'W2 其他车间设备不进培训提纲');
  eq(r.j && r.j.counts.equipTypes, 2, 'W3 只有其他车间才有的设备类型（压缩机）不归组');
  ok(/M-01/.test(r.outline || ''), 'W4 车间列为空的设备按本车间保留');
  ok(r.j.warnings.some((w) => /剔除其他车间 2 行/.test(w) && w.includes('催化车间 2 行')), 'W5 warning 写明剔除行数与车间名');
  ok(r.j.warnings.some((w) => /车间列为空 1 行/.test(w)), 'W6 warning 写明车间为空行数');
  eq(sc(0).status, 'checked', 'W7 meta.workshopScope 记录已核对');
  eq(sc(0).droppedRows, 2, 'W8 meta.workshopScope 记录剔除行数');
  eq((sc(0).dropped || {})['催化车间'], 2, 'W9 meta.workshopScope 按车间记录剔除');
  ok(/车间范围：已按车间列核对「测试车间」/.test(r.outline || '') && /车间范围：/.test(r.key || '') && /车间范围：/.test(r.qs || ''), 'W10 三份 md 开头写明按车间核对与剔除');
  const WBAD = mkXlsx('ws-bad.xlsx', { '设备台账': [HW, ['P-01', '进料泵', '离心泵', '一区', '催化车间'], ['M-01', '电机', '电机', '二区', '焦化车间']] });
  r = run(['--ledger', WBAD, ...WB], 'ws-bad');
  eq(r.s.counts.equipment, 2, 'W11 车间列全不一致时不筛');
  ok(r.j.warnings.some((w) => w.startsWith('【注意】') && /未按车间筛选/.test(w)), 'W12 warning 以【注意】开头');
  eq(sc(0).status, 'mismatch', 'W13 meta.workshopScope 记录不一致');
  const ai = (r.outline || '').indexOf('【注意】工作表「设备台账」的车间列取值与 --workshop「测试车间」不一致');
  ok(ai > 0 && ai < r.outline.indexOf('## '), 'W14 培训提纲开头（第一节之前）有【注意】提示');
  r = run(['--ledger', LED, ...WB], 'ws-none');
  eq(sc(0).status, 'noColumn', 'W15 无车间列 status 为 noColumn');
  ok((r.outline || '').includes('输入未含车间列，车间范围以取数条件为准'), 'W16 md 说明无车间列');
  r = run(['--ledger', mkXlsx('ws-plant.xlsx', { '设备台账': [['位号', '设备名称', '设备类型', '维护工厂'], ['P-01', '进料泵', '离心泵', '1100'], ['P-02', '回流泵', '离心泵', '1200']] }), ...WB], 'ws-plant');
  eq(sc(0).status, 'noColumn', 'W17 「维护工厂」列不当车间列（noColumn）');
  eq(r.s.counts.equipment, 2, 'W18 「维护工厂」列不触发筛选');
  r = run(['--ledger', WMIX, '--audience', '新员工'], 'ws-noworkshop');
  ok(sc(0).status === 'noWorkshop' && r.s.counts.equipment === 5 && !/车间范围：/.test(r.outline || ''), 'W19 未给 --workshop 时不核对、不写车间范围口径');
}

console.log(`\n${'='.repeat(56)}`);
console.log(`training-material-generator 自测：${pass} 通过，${fail} 失败`);
if (failures.length) { console.log('\n失败项：'); failures.forEach((f) => console.log('  ✗ ' + f)); }
console.log('='.repeat(56));
try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
