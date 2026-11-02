#!/usr/bin/env node
'use strict';
/** 自测：断言 evidence.js 与 evidence-spec.js 行为。用法：node scripts/selftest.js（全绿退出 0） */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { writeXlsx } = require('./lib/xlsx-lite');
const S = require('./lib/evidence-spec');

const E = path.join(__dirname, 'evidence.js');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'iep-selftest-'));
let pass = 0, fail = 0;
const failures = [];
const ok = (c, n) => { if (c) pass++; else { fail++; failures.push(n); } };
const eq = (x, e, n) => ok(x === e, `${n}（期望 ${JSON.stringify(e)}，实际 ${JSON.stringify(x)}）`);

function run(args, tag) {
  const out = path.join(work, tag + '-out');
  const r = spawnSync(process.execPath, [E, ...args, '--out', out], { encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  let s; try { s = JSON.parse(lines[lines.length - 1]); } catch (e) { s = { ok: false, error: 'no-json:' + r.stdout + r.stderr }; }
  let j = null, md = null;
  if (fs.existsSync(path.join(out, 'evidence.json'))) j = JSON.parse(fs.readFileSync(path.join(out, 'evidence.json'), 'utf8'));
  if (fs.existsSync(path.join(out, 'evidence.md'))) md = fs.readFileSync(path.join(out, 'evidence.md'), 'utf8');
  return { code: r.status, s, j, md, out };
}
const mkx = (n, b) => { const p = path.join(work, n); writeXlsx(p, b); return p; };
const mkt = (n, t) => { const p = path.join(work, n); fs.writeFileSync(p, t, 'utf8'); return p; };
const PERIOD = '2026-07-01~2026-09-30';
const BASE = ['--workshop', '测试车间', '--inspection', '季度设备专业检查'];

/* ==================== A. 规则表单元测试 ==================== */
ok(S.itemCategories('设备台账是否建立健全').includes('ledger'), 'A1 检查项归类-台账');
ok(S.itemCategories('日常巡检点检是否有记录').includes('inspection'), 'A2 检查项归类-巡检');
ok(S.fileCategories('2026年三季度巡检记录.xlsx').includes('inspection'), 'A3 材料归类-巡检');
eq(S.matchItem('设备台账是否建立健全', '设备台账2026.xlsx').matched, true, 'A4 同类匹配成立');
eq(S.matchItem('特种作业人员是否持证上岗', '设备台账2026.xlsx').matched, false, 'A5 不同类不匹配（不拿台账充人员资质）');
eq(S.matchItem('是否开展应急演练', '巡检记录.xlsx').matched, false, 'A6 泛词「记录」不构成匹配依据');
eq(S.matchItem('设备缺陷是否闭环整改', '设备检修记录.xlsx').matched, false, 'A7 检修记录不冒充缺陷台账');
eq(S.matchItem('P-1101A润滑油更换是否有记录', 'P-1101A润滑油更换台账.xlsx').basis, 'category:lubrication', 'A8 润滑类检查项与换油台账按类别匹配（类别先于特征词）');
eq(S.matchItem('P-1101A对中数据是否有记录', 'P-1101A对中记录.xlsx').basis, 'feature:P1101A', 'A8b 无类别命中时按位号特征词匹配（位号归一后去连字符）');
eq(S.coverage({ from: '2026-07-01', to: '2026-09-30' }, '2026-01-01', '2026-12-31'), 'full', 'A9 完整覆盖');
eq(S.coverage({ from: '2026-07-01', to: '2026-09-30' }, '2026-07-01', '2026-08-31'), 'partial', 'A10 部分覆盖');
eq(S.coverage({ from: '2026-07-01', to: '2026-09-30' }, '2025-01-01', '2025-12-31'), 'none', 'A11 无交集');
eq(S.coverage({ from: '2026-07-01', to: '2026-09-30' }, null, null), 'unknown', 'A12 时间不详不按完整覆盖');
eq(S.coverage(null, '2026-01-01', '2026-12-31'), 'noPeriod', 'A13 未指定检查期不做覆盖判定');
// 中石化炼化厂补充类别：MOC / 联锁 SIS / 特护 / 五定三过滤 / LDAR / 一机一档；用火作业
ok(S.itemCategories('设备设施变更是否履行变更管理（MOC）审批').includes('moc'), 'A14 变更管理归 moc');
eq(S.matchItem('设备设施变更是否履行变更管理审批', '2026年设备变更台账.xlsx').matched, true, 'A15 变更台账与 MOC 检查项匹配');
ok(S.itemCategories('安全联锁投用与摘除是否履行审批、SIS 功能测试是否按期').includes('interlock'), 'A16 联锁/SIS 归 interlock');
eq(S.matchItem('联锁摘除是否履行审批', '联锁旁路审批单2026.xlsx').matched, true, 'A17 联锁旁路审批单匹配');
ok(S.itemCategories('特护设备是否逐台建立特护方案并按日巡检').includes('specialCare'), 'A18 特护归 specialCare');
eq(S.matchItem('特护机组运行是否有记录', '大机组特护日报2026-09.xlsx').matched, true, 'A19 特护日报匹配');
ok(S.itemCategories('润滑管理是否落实五定三过滤').includes('lubrication'), 'A20 润滑五定三过滤归 lubrication');
eq(S.matchItem('润滑管理是否落实五定三过滤', '润滑油换油台账2026.xlsx').matched, true, 'A21 换油台账匹配');
ok(S.itemCategories('密封点泄漏检测（LDAR）是否按周期开展').includes('ldar'), 'A22 LDAR 归 ldar');
eq(S.matchItem('密封点泄漏率是否统计', 'LDAR检测报告2026Q3.pdf.txt').matched, true, 'A23 LDAR 报告匹配');
ok(S.itemCategories('是否建立一机一档').includes('equipmentFile'), 'A24 一机一档归 equipmentFile');
eq(S.matchItem('是否建立一机一档', '设备台账2026.xlsx').matched, false, 'A25 设备台账不冒充一机一档（不同类不充数）');
ok(S.itemCategories('用火作业是否办理作业许可').includes('permit'), 'A26 「用火作业」归作业票类（中石化正式名称）');
eq(S.matchItem('用火作业是否办票', '动火作业票汇总2026-09.xlsx').matched, true, 'A27 旧写法「动火」材料仍可与「用火」检查项匹配');
eq(S.CATEGORIES.length, 25, 'A28 资料类别共 25 类');

/* ==================== B. 基础：齐全 / 缺失 / 覆盖不全 ==================== */
const CHK = mkx('chk.xlsx', {
  '检查表': [
    ['序号', '检查项', '应提供资料'],
    ['1', '设备台账是否建立健全', '设备台账'],
    ['2', '巡检记录是否完整规范', '巡检记录'],
    ['3', '压力容器定期检验是否在有效期内', '检验报告'],
    ['4', '特种作业人员是否持证上岗', '人员资质证书'],
    ['5', '是否按计划开展应急演练', '演练记录'],
  ],
});
const MAT = mkx('mat.xlsx', {
  '资料清单': [
    ['文件名', '资料类型', '存放位置', '起始日期', '截止日期'],
    ['车间设备台账.xlsx', '台账', '柜A-1', '2026-01-01', '2026-12-31'],
    ['巡检记录2026年三季度.xlsx', '记录', '柜A-2', '2026-07-01', '2026-09-30'],
    ['压力容器定期检验报告.pdf', '报告', '柜B-1', '2025-07-01', '2026-08-15'],
    ['班组考勤表.xlsx', '', '柜D-1', '2026-07-01', '2026-09-30'],
  ],
});
let r = run([...BASE, '--notice', CHK, '--materials', MAT, '--date-range', PERIOD], 'base');
eq(r.s.ok, true, 'B1 基础运行成功');
eq(r.s.counts.items, 5, 'B2 检查项数');
eq(r.s.counts.ready, 2, 'B3 资料齐全项数');
eq(r.s.counts.partialCoverage, 1, 'B4 覆盖不全项数（检验报告只到 08-15）');
eq(r.s.counts.missing, 2, 'B5 缺口项数（人员资质、应急演练）');
eq(r.s.counts.unmatched, 1, 'B6 未对应材料数（班组考勤表）');
ok(fs.existsSync(path.join(r.out, '资料清单.xlsx')), 'B7 资料清单.xlsx 已生成');
ok(fs.existsSync(path.join(r.out, 'summary.json')), 'B8 summary.json 已落盘');

/* ==================== C. 缺失绝不用相近材料充数（最关键） ==================== */
const mi = r.j.missing.map((x) => x.text);
ok(mi.some((t) => t.includes('持证上岗')), 'C1 人员资质项列入 missing');
ok(mi.some((t) => t.includes('应急演练')), 'C2 应急演练项列入 missing');
ok(r.j.missing.every((x) => x.evidence.length === 0), 'C3 缺口项不挂任何「相近材料」');
ok(r.j.missing.every((x) => x.statusCn === '未找到对应材料'), 'C4 状态文字为「未找到对应材料」');
ok(r.j.missing.every((x) => x.note.includes('不得用相近材料充数')), 'C5 缺口项注明不得充数');
ok(r.j.missing.every((x) => x.note.includes('不得事后补编记录')), 'C6 缺口项注明不得补编');
// 剔除「禁止替代」的硬提示句本身后，正文不得出现任何替代性表述
const mdNoBan = r.md.split('\n').filter((l) => !/不得用相近材料充数|不得标注为/.test(l)).join('\n');
ok(!/可用.{1,12}替代|可以用.{1,12}替代|替代方案|建议以.{1,12}替代/.test(mdNoBan), 'C7 报告中不出现「可用 XX 替代」的表述');
ok(!/暂以.{1,10}代替|以.{1,8}顶替/.test(r.md), 'C8 报告中不出现顶替性表述');
ok(/未找到对应材料/.test(r.md), 'C9 报告正文出现「未找到对应材料」');

/* ==================== D. 缺口醒目且不被淡化 ==================== */
ok(/^> \*\*【注意】/m.test(r.md), 'D1 存在缺口时 md 开头有醒目提示（用「【注意】」）');
const head = r.md.slice(0, r.md.indexOf('## 一、'));
ok(/未找到对应材料 2 项/.test(head), 'D2 醒目提示写明缺口数量');
ok(head.indexOf('【注意】') < r.md.indexOf('## 一、'), 'D3 提示位置在第一节之前');
ok(!/⚠|✅|❌/.test(r.md), 'D3b 产出 md 不含 emoji');
ok(/## 三、资料缺口清单/.test(r.md), 'D4 缺口清单单列一节');
ok(/构成资料缺口/.test(r.md), 'D5 缺口项说明了影响');
ok(/不得用相近材料充数，不得标注为「可用 XX 替代」，不得事后补编记录/.test(r.md), 'D6 缺口节带禁止替代/补编的硬提示');
ok(/不得建空目录后补放材料/.test(r.md), 'D7 归集目录节不为缺口项建空目录');

/* ==================== E. 覆盖不全不按完整覆盖处理 ==================== */
const pc = r.j.partialCoverage;
eq(pc.length, 1, 'E1 覆盖不全项 1 条');
ok(pc[0].text.includes('压力容器'), 'E2 覆盖不全项定位正确');
ok(pc[0].statusCn === '覆盖不全', 'E3 状态为覆盖不全，未判为齐全');
ok(/2026-08-15/.test(pc[0].coverageNote), 'E4 覆盖区间如实写出截止日');
ok(/未完整覆盖检查期 2026-07-01 ~ 2026-09-30/.test(pc[0].coverageNote), 'E5 说明未覆盖的检查期');
ok(/## 四、覆盖不全项/.test(r.md), 'E6 覆盖不全单列一节');
ok(/不得按完整覆盖报送/.test(r.md), 'E7 覆盖不全节注明不得按完整覆盖报送');

// 时间完全无交集
const MAT_OLD = mkx('mat-old.xlsx', {
  '资料清单': [['文件名', '起始日期', '截止日期'], ['巡检记录.xlsx', '2024-01-01', '2024-12-31']],
});
r = run([...BASE, '--notice', CHK, '--materials', MAT_OLD, '--date-range', PERIOD], 'nocross');
eq(r.s.counts.partialCoverage, 1, 'E8 时间无交集的材料判为覆盖不全，不判齐全');
ok(/无交集/.test(r.j.partialCoverage[0].coverageNote), 'E9 无交集情形如实说明');
eq(r.s.counts.ready, 0, 'E10 无交集不计入资料齐全');

// 材料时间不详
const MAT_NOTIME = mkx('mat-notime.xlsx', {
  '资料清单': [['文件名', '资料类型'], ['巡检登记本.xlsx', '记录']],
});
r = run([...BASE, '--notice', CHK, '--materials', MAT_NOTIME, '--date-range', PERIOD], 'notime');
eq(r.s.counts.partialCoverage, 1, 'E11 时间不详的材料判为覆盖不全，不按完整覆盖');
ok(/无法确定时间范围/.test(r.j.partialCoverage[0].coverageNote), 'E12 时间不详如实说明');

// 日期无法解析 → warning + 按时间不详处理，不猜
const MAT_BADDATE = mkx('mat-baddate.xlsx', {
  '资料清单': [['文件名', '起始日期', '截止日期'], ['巡检记录本.xlsx', '不详', '待补']],
});
r = run([...BASE, '--notice', CHK, '--materials', MAT_BADDATE, '--date-range', PERIOD], 'baddate');
ok(r.j.warnings.some((w) => w.includes('无法解析')), 'E13 日期无法解析有 warning');
eq(r.s.counts.partialCoverage, 1, 'E14 日期无法解析不按完整覆盖');
ok(r.j.materials.every((m) => m.periodFrom === null && m.periodTo === null), 'E15 无法解析的日期为 null，不填默认值');

/* ==================== F. 未指定检查期 ==================== */
r = run([...BASE, '--notice', CHK, '--materials', MAT], 'noperiod');
eq(r.s.ok, true, 'F1 未指定检查期仍可运行');
eq(r.s.period, null, 'F2 period 为 null');
ok(r.j.warnings.some((w) => w.includes('不做时间覆盖判定')), 'F3 未指定检查期有 warning');
eq(r.s.counts.partialCoverage, 0, 'F4 未指定检查期时不产生覆盖不全项');
ok(r.j.items.filter((x) => x.status === 'ready').every((x) => x.coverageNote.includes('未指定检查期')), 'F5 覆盖列注明未指定检查期');

/* ==================== G. 全部齐全时不出现缺口提示（正反对照） ==================== */
const CHK2 = mkx('chk2.xlsx', {
  '检查表': [['序号', '检查项'], ['1', '设备台账是否建立健全'], ['2', '巡检记录是否完整']],
});
const MAT2 = mkx('mat2.xlsx', {
  '资料清单': [['文件名', '起始日期', '截止日期'],
    ['车间设备台账.xlsx', '2026-01-01', '2026-12-31'],
    ['巡检记录汇总.xlsx', '2026-01-01', '2026-12-31']],
});
r = run([...BASE, '--notice', CHK2, '--materials', MAT2, '--date-range', PERIOD], 'clean');
eq(r.s.counts.missing, 0, 'G1 无缺口');
eq(r.s.counts.ready, 2, 'G2 两项齐全');
ok(!/^> \*\*【注意】/m.test(r.md), 'G3 无缺口时不出现醒目提示');
ok(/_无未找到对应材料的检查项。_/.test(r.md), 'G4 缺口节写明「无」');

/* ==================== H. 不编制、不补录、不判合规（声明与口径） ==================== */
const STATEMENT = '本清单基于所提供材料比对生成，资料的真实性、完整性由车间负责；缺失资料应如实说明，不得事后补编记录。';
ok(r.md.includes(STATEMENT), 'H1 声明行逐字出现在 md 中');
eq(r.j.meta.statement, STATEMENT, 'H2 声明行写入 evidence.json');
r = run([...BASE, '--notice', CHK, '--materials', MAT, '--date-range', PERIOD], 'stmt');
ok(r.md.includes(STATEMENT), 'H3 有缺口时声明行同样保留');
ok(!/建议补做|补录一份|补编一份|可事后补/.test(r.md), 'H4 报告不出现补做/补录建议');
ok(!/合格|不合格|达标|不达标|符合要求|违规/.test(r.md.slice(0, r.md.indexOf('<!-- ANALYSIS_START -->'))), 'H5 正文不对检查项作合规达标判定');
ok(/不判定检查项是否达标合规/.test(r.md), 'H6 分析段占位明确不判定合规');
ok(/不建议用其他材料替代缺失资料，不建议补编记录/.test(r.md), 'H7 分析段占位明确禁止替代与补编');

/* ==================== I. 未对应材料不强行对应 ==================== */
ok(r.j.unmatched.length >= 1, 'I1 未对应材料单列');
ok(r.j.unmatched.every((x) => x.note.includes('未按名称猜测强行对应')), 'I2 未对应材料注明不强行对应');
ok(/## 五、未对应材料/.test(r.md), 'I3 未对应材料单列一节');
ok(r.j.warnings.some((w) => w.includes('未对应到任何检查项')), 'I4 未对应材料有 warning');

/* ==================== J. 输入解析：md / 目录 / 合计行 / 空行 ==================== */
const NOTICE_MD = mkt('notice.md', [
  '# 关于开展季度检查的通知', '', '各车间：检查内容如下。', '',
  '1. 设备台账是否建立健全', '2. 巡检记录是否完整', '3. 是否按计划开展应急演练', '',
].join('\n'));
r = run([...BASE, '--notice', NOTICE_MD, '--materials', MAT2, '--date-range', PERIOD], 'md');
eq(r.s.ok, true, 'J1 Markdown 通知可解析');
eq(r.s.counts.items, 3, 'J2 按带序号条目解析出 3 项');
eq(r.s.counts.missing, 1, 'J3 md 通知下应急演练仍为缺口');
ok(!r.j.items.some((x) => x.text.startsWith('#')), 'J4 md 标题行不被当作检查项');

const MATDIR = path.join(work, 'matdir');
fs.mkdirSync(path.join(MATDIR, '二级'), { recursive: true });
fs.writeFileSync(path.join(MATDIR, '设备台账.xlsx'), 'x');
fs.writeFileSync(path.join(MATDIR, '.隐藏台账.xlsx'), 'x');
fs.writeFileSync(path.join(MATDIR, '二级', '巡检记录2026年三季度.xlsx'), 'x');
r = run([...BASE, '--notice', CHK2, '--materials', MATDIR, '--date-range', PERIOD], 'dir');
eq(r.s.ok, true, 'J5 材料目录可递归扫描');
eq(r.s.counts.materials, 2, 'J6 隐藏文件被跳过');
ok(r.j.materials.some((m) => m.location === '二级/巡检记录2026年三季度.xlsx'), 'J7 子目录材料保留相对路径');
ok(r.j.materials.some((m) => m.periodFrom === '2026-07-01' && m.periodTo === '2026-09-30'), 'J8 文件名「三季度」推出时间区间');
// xlsx 清单只填一端日期：另一端按文件名推断，basis 标明来源；推不出时按已填一端处理
const MAT_HALF = mkx('mathalf.xlsx', {
  '资料清单': [['文件名', '起始日期', '截止日期'],
    ['巡检记录2026年三季度.xlsx', '2026-07-01', ''],
    ['设备台账.xlsx', '', '2026-09-30']],
});
r = run([...BASE, '--notice', CHK2, '--materials', MAT_HALF, '--date-range', PERIOD], 'half');
const mh1 = r.j.materials.find((m) => /巡检记录/.test(m.name));
eq(mh1.periodTo, '2026-09-30', 'J9 只填起始时截止按文件名「三季度」推断');
eq(mh1.periodBasis, '清单填报+文件名推断', 'J10 basis 标明清单填报+文件名推断');
ok(r.j.warnings.some((w) => /只填了起始日期/.test(w) && /按文件名推断/.test(w)), 'J11 推断有 warning 请核对');
const mh2 = r.j.materials.find((m) => /设备台账/.test(m.name));
eq(mh2.periodFrom, null, 'J12 文件名推不出时另一端保持 null 不猜');
eq(mh2.periodBasis, '清单填报（仅一端）', 'J13 basis 标明仅一端');
ok(r.j.items.find((x) => /巡检/.test(x.text)).status === 'ready', 'J14 推断后区间完整覆盖检查期 → 齐全');
ok(r.j.items.find((x) => /设备台账/.test(x.text)).status === 'partial', 'J15 仅截止日期一端 → 覆盖不全，不按完整覆盖');

const CHK_TOTAL = mkx('chk-total.xlsx', {
  '检查表': [['某厂检查表'], [], ['序号', '检查项'], ['1', '设备台账是否建立健全'], ['2', '巡检记录是否完整'], ['合计', '']],
});
r = run([...BASE, '--notice', CHK_TOTAL, '--materials', MAT2, '--date-range', PERIOD], 'total');
eq(r.s.counts.items, 2, 'J9 标题行表头识别 + 合计行跳过');
ok(r.j.warnings.some((w) => w.includes('合计行')), 'J10 合计行有 warning');

const CHK_ALIAS = mkx('chk-alias.xlsx', {
  '检查项目': [['编号', '检查内容', '需提供资料'], ['1', '设备台账是否建立健全', '设备台账'], ['2', '巡检记录是否完整', '巡检记录']],
});
r = run([...BASE, '--notice', CHK_ALIAS, '--materials', MAT2, '--date-range', PERIOD], 'alias');
eq(r.s.ok, true, 'J11 别名表头与别名 sheet 名可识别');
eq(r.s.counts.items, 2, 'J12 别名解析出检查项数正确');

const CHK_EMPTY = mkx('chk-empty.xlsx', {
  '检查表': [['序号', '检查项'], ['1', '设备台账是否建立健全'], ['2', '']],
});
r = run([...BASE, '--notice', CHK_EMPTY, '--materials', MAT2, '--date-range', PERIOD], 'emptyitem');
eq(r.s.counts.items, 1, 'J13 检查项为空的行被跳过');
ok(r.j.warnings.some((w) => w.includes('检查项为空')), 'J14 空检查项有 warning');

const MAT_EMPTY = mkx('mat-empty.xlsx', {
  '资料清单': [['文件名', '资料类型'], ['设备台账.xlsx', '台账'], ['', '记录']],
});
r = run([...BASE, '--notice', CHK2, '--materials', MAT_EMPTY, '--date-range', PERIOD], 'emptymat');
eq(r.s.counts.materials, 1, 'J15 文件名为空的材料行被跳过');
ok(r.j.warnings.some((w) => w.includes('文件名为空')), 'J16 空文件名有 warning');

/* ==================== K. 参数校验 ==================== */
function raw(args) {
  const r = spawnSync(process.execPath, [E, ...args], { encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  try { return { code: r.status, s: JSON.parse(lines[lines.length - 1]) }; } catch (e) { return { code: r.status, s: { ok: false, error: 'no-json' } }; }
}
let x = raw(['--notice']);
eq(x.s.ok, false, 'K1 --notice 缺值报错');
ok(/缺少取值/.test(x.s.error), 'K2 缺值错误信息正确');
eq(x.code, 1, 'K3 退出码为 1');
x = raw(['--notice', CHK, '--materials', MAT]);
ok(/缺少 --workshop/.test(x.s.error), 'K4 缺 --workshop 报错');
x = raw(['--notice', CHK, '--workshop', '车间']);
ok(/缺少 --materials/.test(x.s.error), 'K5 缺 --materials 报错');
x = raw(['--notice', CHK, '--materials', MAT, '--workshop', '车间', '--未知参数', 'v']);
eq(x.s.ok, false, 'K6 未知参数报错');
x = raw(['--notice', '/不存在.xlsx', '--materials', MAT, '--workshop', '车间']);
ok(/检查通知\/检查表不存在/.test(x.s.error), 'K7 通知不存在报错');
x = raw(['--notice', CHK, '--materials', '/不存在目录', '--workshop', '车间']);
ok(/台账与记录目录\/清单不存在/.test(x.s.error), 'K8 材料不存在报错');
x = raw(['--notice', CHK, '--materials', MAT, '--workshop', '车间', '--date-range', '2026-07-01']);
ok(/格式应为/.test(x.s.error), 'K9 检查期格式非法报错');
x = raw(['--notice', CHK, '--materials', MAT, '--workshop', '车间', '--date-range', '2026-13-45~2026-09-30']);
ok(/不是有效日期/.test(x.s.error), 'K10 检查期非法日期报错');
x = raw(['--notice', CHK, '--materials', MAT, '--workshop', '车间', '--date-range', '2026-09-30~2026-07-01']);
ok(/早于起始日期/.test(x.s.error), 'K11 检查期倒置报错');
x = raw(['--notice', CHK, '--materials', MAT, '--workshop', '车间', '--spec', '/不存在规范.md']);
ok(/厂内归档规范不存在/.test(x.s.error), 'K12 --spec 不存在报错');
x = raw(['--notice', CHK, '--materials', MAT, '--workshop', '车间', '--last', '/不存在目录']);
ok(/上次资料包目录不存在/.test(x.s.error), 'K13 --last 不存在报错');
const NO_SHEET = mkx('nosheet.xlsx', { '别的表': [['a', 'b'], [1, 2]] });
x = raw(['--notice', NO_SHEET, '--materials', MAT, '--workshop', '车间']);
ok(/未找到「检查表」/.test(x.s.error), 'K14 检查表无可识别工作表报错');
x = raw(['--notice', CHK, '--materials', NO_SHEET, '--workshop', '车间']);
ok(/未找到「资料清单」/.test(x.s.error), 'K15 资料清单无可识别工作表报错');
const EMPTY_CHK = mkx('chk-none.xlsx', { '检查表': [['序号', '检查项']] });
x = raw(['--notice', EMPTY_CHK, '--materials', MAT, '--workshop', '车间']);
ok(/未从.*解析出任何检查项/.test(x.s.error), 'K16 解析不出检查项报错');
x = raw(['--notice', mkt('notice.pdf', 'x'), '--materials', MAT, '--workshop', '车间']);
ok(/不支持的格式/.test(x.s.error), 'K17 不支持的通知格式报错');

/* ==================== L. 产出结构完整性 ==================== */
r = run([...BASE, '--notice', CHK, '--materials', MAT, '--date-range', PERIOD, '--scope', '全车间'], 'struct');
ok(/## 一、检查基本信息/.test(r.md) && /## 二、逐检查项资料对照/.test(r.md) && /## 三、资料缺口清单/.test(r.md)
  && /## 四、覆盖不全项/.test(r.md) && /## 五、未对应材料/.test(r.md) && /## 六、归集包目录建议/.test(r.md)
  && /## 七、准备工作提示/.test(r.md), 'L1 七节结构齐全');
ok(/<!-- ANALYSIS_START -->/.test(r.md) && /<!-- ANALYSIS_END -->/.test(r.md), 'L2 分析段占位符存在');
ok(r.j.items.every((x) => 'no' in x && 'text' in x && 'evidence' in x && 'coverageNote' in x && 'statusCn' in x), 'L3 items 字段齐全');
ok(Array.isArray(r.j.ready) && Array.isArray(r.j.missing) && Array.isArray(r.j.partialCoverage) && Array.isArray(r.j.unmatched), 'L4 四类清单均为数组');
eq(r.j.counts.items, r.j.ready.length + r.j.missing.length + r.j.partialCoverage.length, 'L5 三类状态之和等于检查项总数');
eq(r.j.meta.scope, '全车间', 'L6 检查范围写入 meta');
eq(r.j.meta.inspection, '季度设备专业检查', 'L7 检查名称写入 meta');
const sj = JSON.parse(fs.readFileSync(path.join(r.out, 'summary.json'), 'utf8'));
eq(sj.ok, true, 'L8 summary.json 内容正确');
eq(sj.counts.missing, r.j.counts.missing, 'L9 summary 与 evidence.json 计数一致');
ok(/迎检资料清单/.test(r.md.split('\n')[0]), 'L10 md 标题正确');

/* ==================== 输出 ==================== */
console.log(`\n${'='.repeat(56)}`);
console.log(`inspection-evidence-package 自测：${pass} 通过，${fail} 失败`);
if (failures.length) { console.log('\n失败项：'); failures.forEach((f) => console.log('  ✗ ' + f)); }
console.log('='.repeat(56));
try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
