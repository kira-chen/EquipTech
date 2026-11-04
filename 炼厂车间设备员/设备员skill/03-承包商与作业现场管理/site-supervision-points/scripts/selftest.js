#!/usr/bin/env node
'use strict';
/** 自测：断言 supervise.js 与 rules.js 行为。用法：node scripts/selftest.js（全绿退出 0） */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const R = require('./lib/rules');

const SUP = path.join(__dirname, 'supervise.js');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-selftest-'));
const DISCLAIMER = '本要点为辅助提示，不替代作业票规定的安全措施与监护人现场职责；发现异常应立即停止作业并按应急程序处置';
let pass = 0, fail = 0;
const failures = [];
const ok = (c, n) => { if (c) pass++; else { fail++; failures.push(n); } };
const eq = (a, e, n) => ok(a === e, `${n}（期望 ${JSON.stringify(e)}，实际 ${JSON.stringify(a)}）`);

function run(args, tag) {
  const out = path.join(work, tag + '-out');
  const r = spawnSync(process.execPath, [SUP, ...args, '--out', out], { encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  let s; try { s = JSON.parse(lines[lines.length - 1]); } catch (e) { s = { ok: false, error: 'no-json:' + r.stdout + r.stderr }; }
  let j = null, md = null;
  if (fs.existsSync(path.join(out, 'supervision.json'))) j = JSON.parse(fs.readFileSync(path.join(out, 'supervision.json'), 'utf8'));
  if (fs.existsSync(path.join(out, 'supervision.md'))) md = fs.readFileSync(path.join(out, 'supervision.md'), 'utf8');
  return { code: r.status, s, j, md, out };
}
const base = (type, extra = []) => ['--work-type', type, '--scope', '测试作业内容', '--location', 'V-1301'].concat(extra);
/** 单类型要点数（不含 S 系列通用许可要点），用于组合求和 */
const own = (t) => R.POINTS.filter((p) => p.type === t).length;
const S_COUNT = R.POINTS.filter((p) => p.type === 'permit').length;

// ============ A. 规则引擎：作业类型识别 ============
eq(R.classifyTypes('动火作业').types.join(','), 'hotwork', 'A1 识别动火作业');
eq(R.classifyTypes('进罐作业').types.join(','), 'confined', 'A2 进罐识别为受限空间');
eq(R.classifyTypes('登高更换照明').types.join(','), 'height', 'A3 登高识别为高处作业');
eq(R.classifyTypes('汽车吊吊装').types.join(','), 'lifting', 'A4 识别吊装作业');
eq(R.classifyTypes('临时用电接引').types.join(','), 'power', 'A5 识别临时用电');
eq(R.classifyTypes('开挖管沟').types.join(','), 'excavation', 'A6 识别动土作业');
eq(R.classifyTypes('道路占用').types.join(','), 'blockade', 'A7 识别断路作业');
eq(R.classifyTypes('加盲板').types.join(','), 'blind', 'A8 识别盲板抽堵');
eq(R.classifyTypes('常规检修作业').types.join(','), 'overhaul', 'A9 识别常规检修');
eq(R.classifyTypes('动火作业,受限空间作业').types.join(','), 'hotwork,confined', 'A10 多类型组合全部识别');
eq(R.classifyTypes('动火作业、受限空间、高处作业').types.length, 3, 'A11 顿号分隔三类型');
eq(R.classifyTypes('放射性探伤作业').types.length, 0, 'A12 未覆盖类型不猜测归类');
eq(R.classifyTypes('放射性探伤作业').unknown[0], '放射性探伤作业', 'A13 未覆盖类型原样列入 unknown');
eq(R.classifyTypes('动火作业,放射性探伤').unknown.length, 1, 'A14 部分未覆盖时只列未覆盖项');
eq(R.SPECIAL_TYPES.length, 8, 'A15 覆盖八类特殊作业');
eq(R.COVERED_TYPES.length, 9, 'A16 八类特殊作业 + 常规检修');
eq(R.classifyTypes('用火作业').types.join(','), 'hotwork', 'A17 「用火作业」识别为 hotwork');
eq(R.TYPE_CN.hotwork, '用火作业', 'A18 hotwork 中文名为「用火作业」（中石化八大类命名）');

// ============ B. 规则引擎：要点表完整性 ============
for (const t of R.COVERED_TYPES) {
  const pts = R.pointsFor([t]);
  ok(pts.length > 0, `B-${t} 「${R.TYPE_CN[t]}」有监督要点`);
  const ms = new Set(pts.map((p) => p.moment));
  ok(ms.has('before') && ms.has('during') && ms.has('resume') && ms.has('shift') && ms.has('closing'),
    `B-${t}-moments 「${R.TYPE_CN[t]}」五个检查时点齐全`);
  ok(pts.every((p) => p.text && p.method && p.owner && p.id), `B-${t}-fields 「${R.TYPE_CN[t]}」每条带内容/方式/岗位/规则号`);
}
ok(new Set(R.POINTS.map((p) => p.id)).size === R.POINTS.length, 'B1 规则号不重复');
ok(R.POINTS.every((p) => R.METHOD_CN[p.method]), 'B2 检查方式均在四类之内');
ok(R.pointsFor(['hotwork']).some((p) => /30\s*分钟/.test(p.text) && p.moment === 'before'), 'B3 动火分析 30 分钟有效期在作业前');
ok(R.pointsFor(['hotwork']).some((p) => /30\s*分钟/.test(p.text) && p.moment === 'closing'), 'B4 动火收尾留人监护 30 分钟');
ok(R.pointsFor(['confined']).some((p) => /19\.5%/.test(p.text) && /23\.5%/.test(p.text)), 'B5 受限空间氧含量区间');
ok(R.pointsFor(['confined']).some((p) => /进出.*登记|登记.*进出/.test(p.text)), 'B6 受限空间进出登记');
ok(R.pointsFor(['height']).some((p) => /高挂低用/.test(p.text)), 'B7 高处安全带高挂低用');
ok(R.pointsFor(['lifting']).some((p) => /斜拉|斜吊/.test(p.text)), 'B8 吊装禁止斜拉');
ok(R.pointsFor(['lifting']).some((p) => /吊物下方|吊物下/.test(p.text)), 'B9 人员不得在吊物下');
ok(R.pointsFor(['power']).some((p) => /漏电保护/.test(p.text)), 'B10 临时用电漏电保护');
ok(R.pointsFor(['power']).some((p) => /防爆/.test(p.text)), 'B11 临时用电防爆要求');
ok(R.pointsFor(['blind']).some((p) => /泄压/.test(p.text)), 'B12 盲板泄压确认');
ok(R.pointsFor(['blind']).some((p) => /编号.*登记|登记.*编号/.test(p.text)), 'B13 盲板编号登记');
ok(R.pointsFor(['blind']).some((p) => /顺序/.test(p.text)), 'B14 盲板拆装顺序');
// 序号连续
const seqOk = R.pointsFor(['hotwork', 'confined']).every((p, i) => p.seq === i + 1);
ok(seqOk, 'B15 合并后序号连续重排');
// 按时点排序
const moms = R.pointsFor(['hotwork', 'confined']).map((p) => R.MOMENTS.indexOf(p.moment));
ok(moms.every((v, i) => i === 0 || v >= moms[i - 1]), 'B16 要点按检查时点顺序排列');

// ============ C. 未覆盖类型只给通用框架 ============
let r = run(base('放射性探伤作业'), 'generic');
eq(r.s.ok, true, 'C1 未覆盖类型仍成功产出');
eq(r.j.counts.generic, true, 'C2 标记为通用框架模式');
eq(r.j.counts.points, R.GENERIC_POINTS.length, 'C3 只输出通用框架要点');
ok(r.j.points.every((p) => p.typeCn === '通用框架'), 'C4 要点来源全部标为通用框架');
ok(r.j.warnings.some((w) => w.includes('待安全专业补充')), 'C5 warning 标注待安全专业补充');
ok(/待安全专业补充/.test(r.md), 'C6 md 中标注待安全专业补充');
eq(r.j.meta.genericNote, '待安全专业补充', 'C7 meta 记录待补充标记');
// 不得混入任何具体作业类型的安全技术要点
const specialTexts = new Set(R.POINTS.map((p) => p.text));
ok(r.j.points.every((p) => !specialTexts.has(p.text)), 'C8 未混入任何具体作业类型要点');
ok(!/氧含量|动火分析|高挂低用|斜拉|漏电保护|盲板/.test(r.md.split('## 二')[1].split('## 三')[0]), 'C9 通用框架不含具体安全技术措辞');
eq(r.j.escalated.length, 0, 'C10 通用框架不产出加严项');
// 部分未覆盖：覆盖部分正常出要点，未覆盖部分只标注
r = run(base('动火作业,放射性探伤作业'), 'partial');
eq(r.j.counts.points, R.pointsFor(['hotwork']).length, 'C11 部分未覆盖时只出已覆盖类型要点');
eq(R.pointsFor(['hotwork']).length, own('hotwork') + S_COUNT, 'C11b 单一用火 = 18 条 H + S 系列通用许可要点');
eq(r.j.counts.unknownTypes, 1, 'C12 未覆盖类型计数');
ok(r.j.warnings.some((w) => w.includes('放射性探伤作业') && w.includes('待安全专业补充')), 'C13 未覆盖部分单独 warning');
ok(/放射性探伤作业（待安全专业补充）/.test(r.md), 'C14 md 作业信息表标注未覆盖类型');

// ============ D. 多类型组合 ============
r = run(base('动火作业,受限空间作业', ['--medium', '硫化氢']), 'combo');
eq(r.s.ok, true, 'D1 组合作业成功');
eq(r.j.counts.points, own('hotwork') + own('confined') + S_COUNT, 'D2 要点为两类之和 + S 系列一份（不丢弃任一类型、通用要点不重复）');
eq(Object.keys(r.j.counts.byType).length, 3, 'D3 按来源类型分别计数（含作业许可通用）');
ok(r.j.points.some((p) => p.typeCn === '用火作业') && r.j.points.some((p) => p.typeCn === '受限空间作业'), 'D4 每条要点标注来源类型');
eq(r.j.counts.escalated, 3, 'D5 动火+受限空间命中 3 条加严规则');
ok(r.j.escalated.every((e) => e.conflict && e.action && e.owner && e.id), 'D6 加严项含冲突说明与执行口径');
ok(r.j.escalated.some((e) => /分析频次|气体分析频次/.test(e.item)), 'D7 加严项含分析频次');
ok(r.j.escalated.every((e) => !/动火/.test(e.conflict + e.action + e.typesCn.join())), 'D7b 加严项不含「动火」字样');
ok(r.j.escalated.some((e) => /监护/.test(e.item)), 'D8 加严项含监护要求');
ok(/## 五、组合加严项/.test(r.md), 'D9 加严项在 md 中单列一节');
ok(r.j.warnings.some((w) => w.includes('组合作业')), 'D10 组合作业 warning');
eq(r.j.risk.level, 'high', 'D11 组合作业风险上调为高');
// 单一类型无加严
r = run(base('动火作业', ['--medium', '石脑油']), 'single');
eq(r.j.counts.escalated, 0, 'D12 单一类型无组合加严项');
ok(/单一作业类型，无组合加严项/.test(r.md), 'D13 md 说明无加严项');
// 三类型组合命中多组规则
r = run(base('动火作业,受限空间作业,临时用电', ['--medium', '石脑油']), 'combo3');
ok(r.j.counts.escalated >= 4, 'D14 三类组合命中更多加严规则');
ok(r.j.escalated.some((e) => e.types.includes('power')), 'D15 加严项覆盖第三类型');

// ============ E. 介质危险特性 ============
eq(R.mediumHazard('').known, false, 'E1 空介质 known=false');
eq(R.mediumHazard('XK-7 特种助剂').known, false, 'E2 不在库介质 known=false');
eq(R.mediumHazard('硫化氢').hazards.includes('toxic'), true, 'E3 硫化氢判为有毒有害');
eq(R.mediumHazard('液化气').hazards.includes('flammable'), true, 'E4 液化气判为易燃易爆');
eq(R.mediumHazard('循环水').hazards.includes('low'), true, 'E5 循环水判为低危');
r = run(base('盲板抽堵作业', ['--medium', 'XK-7 特种助剂']), 'unknownmed');
eq(r.j.meta.mediumKnown, false, 'E6 介质不在库标记');
eq(r.j.meta.hazards.join(','), 'flammable,toxic', 'E7 未知介质按最严口径（易燃易爆+有毒有害）');
ok(r.j.warnings.some((w) => w.includes('不在危险特性库') && w.includes('最严口径')), 'E8 未知介质 warning');
ok(/不在危险特性库，按最严口径/.test(r.md), 'E9 md 标注最严口径');
ok(r.j.risk.reasons.some((x) => x.includes('最严口径')), 'E10 风险判定依据说明最严口径');
// 未提供介质同样按最严，不按无危险
r = run(base('盲板抽堵作业'), 'nomed');
eq(r.j.meta.mediumKnown, false, 'E11 未提供介质 known=false');
eq(r.j.meta.hazards.join(','), 'flammable,toxic', 'E12 未提供介质不按无危险，按最严口径');
ok(r.j.warnings.some((w) => w.includes('未提供介质')), 'E13 未提供介质 warning');
// 低危介质不上调
r = run(base('常规检修作业', ['--medium', '循环水']), 'lowmed');
eq(r.j.risk.level, 'low', 'E14 低危介质 + 常规检修为低风险');

// ============ F. 频次与关键时点 ============
r = run(base('动火作业', ['--medium', '石脑油', '--duration', '4']), 'freq');
eq(r.j.frequency.level, 'high', 'F1 高风险频次口径');
eq(r.j.frequency.intervalMin, 30, 'F2 高风险 30 分钟巡查');
eq(r.j.frequency.estimatedRounds, 8, 'F3 4 小时按 30 分钟推算 8 轮');
ok(r.j.frequency.patrol && r.j.frequency.standby && r.j.frequency.gasTest && r.j.frequency.record, 'F4 频次四项齐全');
eq(r.j.keyMoments.length, 5, 'F5 关键时点五个');
eq(r.j.keyMoments.map((x) => x.momentCn).join(','), '作业前,作业中,中断后复工,交接班,收尾', 'F6 关键时点顺序正确');
// 未提供时长不臆测轮次
r = run(base('动火作业', ['--medium', '石脑油']), 'noduration');
eq(r.j.frequency.estimatedRounds, null, 'F7 未提供时长时轮次为 null 不按 0');
ok(/—（未提供预计时长）/.test(r.md), 'F8 md 显示「—」不显示 0');
// 中风险
r = run(base('高处作业', ['--medium', '循环水', '--duration', '2']), 'mid');
eq(r.j.frequency.intervalMin, 60, 'F9 中风险 60 分钟巡查');
eq(r.j.risk.level, 'medium', 'F10 高处作业 + 低危介质为中风险');

// ============ G. 检查记录表留空 ============
r = run(base('动火作业', ['--medium', '石脑油']), 'sheet');
eq(r.j.checkSheet.rows.length, r.j.counts.points, 'G1 记录表行数 = 要点数');
ok(r.j.checkSheet.rows.every((row) => row[6] === '' && row[7] === '' && row[8] === ''), 'G2 检查时间/结果/签字三列全为空');
ok(r.j.checkSheet.headers.includes('检查结果') && r.j.checkSheet.headers.includes('检查人签字'), 'G3 记录表表头含结果与签字列');
const sheetMd = r.md.split('## 六、现场检查记录表')[1].split('## 七')[0];
// 记录表数据行的后三列（检查时间/检查结果/检查人签字）必须是空白
const sheetDataRows = sheetMd.split('\n').filter((x) => /^\| \d+ \| /.test(x));
eq(sheetDataRows.length, r.j.counts.points, 'G4 md 记录表行数 = 要点数');
ok(sheetDataRows.every((row) => {
  const cells = row.split('|').slice(1, -1).map((c) => c.trim());
  return cells.length === 9 && cells[6] === '' && cells[7] === '' && cells[8] === '';
}), 'G4b md 记录表后三列（时间/结果/签字）全空白，未预填任何检查结果');
ok(/脚本不预填/.test(sheetMd), 'G5 md 说明记录表由现场填写');

// ============ H. 声明行与边界 ============
ok(r.md.includes(DISCLAIMER), 'H1 md 含固定声明行');
ok(r.md.trim().endsWith(DISCLAIMER), 'H2 声明行出现在末尾');
eq((r.md.match(new RegExp(DISCLAIMER, 'g')) || []).length, 2, 'H3 声明行开头与结尾各一处');
eq(r.j.meta.disclaimer, DISCLAIMER, 'H4 json 保存声明行原文');
ok(/不含超出作业票规定的额外安全措施/.test(r.md), 'H5 md 写明不超出作业票的边界');
ok(r.j.meta.scopeNote.includes('不含超出作业票规定'), 'H6 json 记录边界声明');

// ============ I. 产出完整性 ============
ok(fs.existsSync(path.join(r.out, 'supervision.json')), 'I1 supervision.json 生成');
ok(fs.existsSync(path.join(r.out, 'supervision.md')), 'I2 supervision.md 生成');
ok(fs.existsSync(path.join(r.out, 'summary.json')), 'I3 summary.json 生成');
ok(/## 一、作业信息/.test(r.md) && /## 二、监督要点清单/.test(r.md) && /## 三、检查频次建议/.test(r.md)
  && /## 四、关键时点提示/.test(r.md) && /## 五、组合加严项/.test(r.md)
  && /## 六、现场检查记录表/.test(r.md) && /## 七、异常处置提示/.test(r.md), 'I4 七节结构齐全');
ok(/<!-- ANALYSIS_START -->/.test(r.md) && /<!-- ANALYSIS_END -->/.test(r.md), 'I5 分析段占位符存在');
ok(/### 作业前/.test(r.md) && /### 中断后复工/.test(r.md) && /### 收尾/.test(r.md), 'I6 要点按检查时点分组');
ok(r.j.counts.byMoment && r.j.counts.byType && r.j.counts.byMethod, 'I7 counts 含三个维度分布');
const sum = JSON.parse(fs.readFileSync(path.join(r.out, 'summary.json'), 'utf8'));
eq(sum.counts.points, r.j.counts.points, 'I8 summary.json 与 json 计数一致');

// ============ J. 参数校验 ============
function raw(args) {
  const x = spawnSync(process.execPath, [SUP, ...args], { encoding: 'utf8' });
  const l = x.stdout.trim().split('\n');
  try { return { code: x.status, s: JSON.parse(l[l.length - 1]) }; } catch (e) { return { code: x.status, s: { ok: false } }; }
}
eq(raw([]).s.ok, false, 'J1 无参数报错');
eq(raw([]).code, 1, 'J2 退出码 1');
eq(raw(['--work-type']).s.ok, false, 'J3 --work-type 缺值报错');
ok(/缺少取值/.test(raw(['--work-type']).s.error), 'J4 缺值信息正确');
eq(raw(['--work-type', '动火作业']).s.ok, false, 'J5 缺 --scope 报错');
eq(raw(['--work-type', '动火作业', '--scope', 'x']).s.ok, false, 'J6 缺 --location 报错');
eq(raw(base('动火作业').concat(['--未知', 'v'])).s.ok, false, 'J7 未知参数报错');
eq(raw(base('动火作业', ['--duration', '很久'])).s.ok, false, 'J8 非法时长报错');
eq(raw(base('动火作业', ['--headcount', '三人'])).s.ok, false, 'J9 非法人数报错');
eq(raw(base('动火作业', ['--start', '今天早上'])).s.ok, false, 'J10 非法开始时间报错');
ok(/ISO 8601/.test(raw(base('动火作业', ['--start', '2026-09-21 09:00'])).s.error), 'J11 时间缺时区报错并提示格式');
eq(raw(base('动火作业', ['--start', '2026-09-21T09:00:00+08:00', '--end', '2026-09-21T08:00:00+08:00'])).s.ok, false, 'J12 结束早于开始报错');
// 作业票不存在只 warning 不中断
r = run(base('动火作业', ['--permit', '/不存在的作业票.pdf']), 'permit');
eq(r.s.ok, true, 'J13 作业票不存在不中断');
ok(r.j.warnings.some((w) => w.includes('作业票文件不存在')), 'J14 作业票不存在 warning');
eq(r.j.meta.permit, null, 'J15 作业票不存在时 permit 为 null');

// ============ K. 时间与显示 ============
r = run(base('动火作业', ['--start', '2026-09-21T09:00:00+08:00', '--end', '2026-09-21T13:00:00+08:00']), 'time');
eq(r.j.meta.startAt, '2026-09-21 09:00:00', 'K1 ISO 时间转北京时间显示');
eq(r.j.meta.endAt, '2026-09-21 13:00:00', 'K2 结束时间转换正确');
ok(/2026-09-21 09:00:00 ～ 2026-09-21 13:00:00/.test(r.md), 'K3 md 显示作业起止');
r = run(base('动火作业'), 'dash');
ok(/\| 作业单位 \| — \|/.test(r.md), 'K4 未提供字段显示「—」不显示空或 0');
ok(/\| 作业人数 \| — \|/.test(r.md), 'K5 人数未提供显示「—」');

// ============ L. 中石化口径：用火术语、S 系列双监护/JSA/属地确认人、--level 作业票级别映射频次 ============
r = run(base('动火作业', ['--medium', '石脑油']), 'term');
ok(!/动火作业票|动火等级|动火监护人/.test(r.md), 'L1 md 不再出现「动火作业票/动火等级/动火监护人」');
ok(/用火作业票/.test(r.md) && /用火作业/.test(r.md), 'L2 md 使用「用火作业」术语');
ok(r.j.points.some((p) => p.id === 'S01' && /属地监护人/.test(p.text) && /作业单位监护人/.test(p.text)), 'L3 S01 双监护要点');
ok(r.j.points.some((p) => p.id === 'S02' && /JSA/.test(p.text)), 'L4 S02 JSA/风险分析交底要点');
ok(r.j.points.some((p) => p.id === 'S03' && /属地确认人/.test(p.text)), 'L5 S03 属地确认人要点');
ok(r.j.points.some((p) => p.id === 'S04' && p.moment === 'during'), 'L6 S04 双监护全程在岗（作业中）');
ok(r.j.points.filter((p) => p.type === 'permit').length === S_COUNT, 'L7 单一特殊作业纳入全部 S 系列');
eq(r.j.counts.byType['作业许可通用（八大类共有）'], S_COUNT, 'L8 S 系列按「作业许可通用」计数');
// 常规检修单独作业不纳入 S 系列；通用框架也不纳入
r = run(base('常规检修作业', ['--medium', '循环水']), 'overhaul-only');
eq(r.j.points.filter((p) => p.type === 'permit').length, 0, 'L9 常规检修单独作业不纳入 S 系列');
eq(r.j.counts.points, own('overhaul'), 'L10 常规检修要点数不变');
r = run(base('放射性探伤作业'), 'generic-noS');
eq(r.j.points.filter((p) => p.type === 'permit').length, 0, 'L11 通用框架模式不纳入 S 系列');
r = run(base('常规检修作业,盲板抽堵作业', ['--medium', '循环水']), 'overhaul-blind');
eq(r.j.points.filter((p) => p.type === 'permit').length, S_COUNT, 'L12 检修 + 盲板抽堵（特殊作业）纳入 S 系列一份');
// --level
eq(R.parseLevel('特级用火').cn, '特级用火', 'L13 解析特级用火');
eq(R.parseLevel('一级用火').risk, 'high', 'L14 一级用火 → 高风险口径');
eq(R.parseLevel('二级动火').cn, '二级用火', 'L15 「二级动火」识别为二级用火');
eq(R.parseLevel('二级动火').risk, 'medium', 'L16 二级用火 → 中风险口径');
eq(R.parseLevel('高处作业二级').cn, '高处作业二级', 'L17 解析高处二级');
eq(R.parseLevel('高处四级').risk, 'high', 'L18 高处四级 → 高风险口径');
eq(R.parseLevel('吊装三级').risk, 'medium', 'L19 吊装三级 → 中风险口径');
eq(R.parseLevel('吊装一级').risk, 'high', 'L20 吊装一级 → 高风险口径');
eq(R.parseLevel('一级', ['hotwork']).cn, '一级用火', 'L21 只写级别时按识别类型推断（用火）');
eq(R.parseLevel('二级', ['height']).cn, '高处作业二级', 'L22 只写级别时按识别类型推断（高处）');
eq(R.parseLevel('五级', ['height']), null, 'L23 不存在的级别 → null 不猜');
eq(R.parseLevel('特级', ['overhaul']), null, 'L24 常规检修无级别 → null');
r = run(base('高处作业', ['--medium', '循环水', '--level', '高处四级']), 'lvl-height4');
eq(r.j.risk.level, 'high', 'L25 高处四级把频次口径从中风险抬到高风险');
eq(r.j.frequency.intervalMin, 30, 'L26 高风险口径 30 分钟巡查');
ok(r.j.risk.reasons.some((x) => /作业票级别：高处作业四级/.test(x) && /以作业票为准/.test(x)), 'L27 判定依据写明级别来自作业票');
ok(/高处四级：全程旁站/.test(r.j.frequency.levelNote), 'L28 级别口径提示');
eq(r.s.permitLevel, '高处作业四级', 'L29 summary 记录生效的作业票级别');
r = run(base('高处作业', ['--medium', '循环水', '--level', '高处一级']), 'lvl-height1');
eq(r.j.risk.level, 'medium', 'L30 高处一级不抬高（取基础风险与级别口径的较严者）');
r = run(base('动火作业', ['--medium', '循环水', '--level', '二级用火']), 'lvl-hot2');
eq(r.j.risk.level, 'high', 'L31 二级用火不把用火作业基础高风险降级（级别只能加严不减）');
r = run(base('高处作业', ['--medium', '循环水']), 'lvl-none');
ok(r.j.risk.reasons.some((x) => /未提供作业票级别/.test(x)), 'L32 未提供级别时判定依据写明按默认口径');
eq(r.j.meta.permitLevel, null, 'L33 未提供级别 meta 为 null');
ok(/—（未提供，频次按作业类型默认口径）/.test(r.md), 'L34 md 作业票级别显示未提供');
r = run(base('高处作业', ['--medium', '循环水', '--level', '随便写']), 'lvl-bad');
eq(r.s.ok, true, 'L35 级别无法识别不中断');
ok(r.j.warnings.some((w) => /无法识别/.test(w) && /默认口径/.test(w)), 'L36 级别无法识别 warning');
eq(r.j.meta.permitLevel, null, 'L37 级别无法识别 meta 为 null');
r = run(base('高处作业', ['--medium', '循环水', '--level', '一级用火']), 'lvl-mismatch');
ok(r.j.warnings.some((w) => /没有该类/.test(w)), 'L38 级别与识别类型不符 warning');
eq(r.j.meta.permitLevel.applied, false, 'L39 不符的级别仅记录不生效');
eq(r.j.risk.level, 'medium', 'L40 不符的级别不改变频次口径');
ok(/与识别类型不符，仅记录/.test(r.md), 'L41 md 标注仅记录');
// 频次口径来源标注
ok(/检查频次为本技能默认口径（非厂内正式口径）/.test(r.md) && /以作业票为准/.test(r.md), 'L42 md 频次节标注默认口径来源与作业票为准');
eq(typeof r.j.frequency.source, 'string', 'L43 json 频次带口径来源');
ok(!/[\u2600-\u27BF\u{1F300}-\u{1FAFF}]/u.test(r.md), 'L44 md 不含 emoji');
ok(/【注意】/.test(r.md), 'L45 醒目提示用「【注意】」');
ok(/contractor-performance-log/.test(r.md), 'L46 异常处置提示指向承包商表现记录技能');
eq(raw(base('动火作业', ['--level'])).s.ok, false, 'L47 --level 缺值报错');
// 不分级的作业类别（盲板抽堵、受限空间、临时用电等，票面作业级别为空）：不提示「请按票面级别传入」
r = run(base('盲板抽堵作业,临时用电作业', ['--medium', '柴油']), 'lvl-ungraded');
ok(r.j.risk.reasons.some((x) => /不分级/.test(x)) && !r.j.risk.reasons.some((x) => /请按票面级别传入/.test(x)), 'L48 不分级作业类别判定依据写明不分级，不要求传 --level');
ok(/作业票级别（填报） \| —（[^|]*盲板抽堵作业[^|]*不分级/.test(r.md) && /作业票级别（填报） \| —（[^|]*临时用电作业[^|]*不分级/.test(r.md),'L49 md 作业票级别栏写明该类作业不分级');
r = run(base('盲板抽堵作业,高处作业', ['--medium', '柴油']), 'lvl-mixed');
ok(r.j.risk.reasons.some((x) => /未提供作业票级别/.test(x) && /高处作业/.test(x)), 'L50 含分级作业类别时仍提示按票面级别传入（点明是哪类）');

console.log(`\n${'='.repeat(56)}`);
console.log(`site-supervision-points 自测：${pass} 通过，${fail} 失败`);
if (failures.length) { console.log('\n失败项：'); failures.forEach((f) => console.log('  ✗ ' + f)); }
console.log('='.repeat(56));
try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
