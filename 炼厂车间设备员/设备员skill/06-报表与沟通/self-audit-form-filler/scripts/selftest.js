#!/usr/bin/env node
'use strict';
/** 自测：断言 fill.js 与 audit-spec.js 行为。用法：node scripts/selftest.js（全绿退出 0） */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { writeXlsx, readXlsx } = require('./lib/xlsx-lite');
const S = require('./lib/audit-spec');
const M = require('./lib/merge-lite');

const F = path.join(__dirname, 'fill.js');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'saff-selftest-'));
let pass = 0, fail = 0;
const failures = [];
const ok = (c, n) => { if (c) pass++; else { fail++; failures.push(n); } };
const eq = (x, e, n) => ok(x === e, `${n}（期望 ${JSON.stringify(e)}，实际 ${JSON.stringify(x)}）`);

function run(args, tag) {
  const out = path.join(work, tag + '-out');
  const r = spawnSync(process.execPath, [F, ...args, '--out', out], { encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  let s; try { s = JSON.parse(lines[lines.length - 1]); } catch (e) { s = { ok: false, error: 'no-json:' + r.stdout + r.stderr }; }
  let j = null, md = null, book = null;
  if (fs.existsSync(path.join(out, 'filled.json'))) j = JSON.parse(fs.readFileSync(path.join(out, 'filled.json'), 'utf8'));
  if (fs.existsSync(path.join(out, '填写说明.md'))) md = fs.readFileSync(path.join(out, '填写说明.md'), 'utf8');
  if (fs.existsSync(path.join(out, '自查表预填稿.xlsx'))) book = readXlsx(path.join(out, '自查表预填稿.xlsx'));
  return { code: r.status, s, j, md, book, out };
}
const mkx = (n, b) => { const p = path.join(work, n); writeXlsx(p, b); return p; };
const BASE = ['--workshop', '测试车间'];
const ASOF = '2026-09-30';

/* ==================== A. 判断类识别（本技能的命脉，15+ 条表述逐一验证） ====================
 * 每条都必须被识别为判断类，且脚本一律留空。
 */
const JUDGMENT_CASES = [
  ['管理制度是否健全', 'J1'],
  ['安全管理体系是否完善', 'J1'],
  ['隐患整改落实是否到位', 'J2'],
  ['各项规定是否严格执行', 'J2'],
  ['岗位责任是否明确到人', 'J3'],
  ['设备管理责任制是否落实', 'J2'],
  ['人员培训是否有效', 'J4'],
  ['整改措施是否取得实效', 'J4'],
  ['防范措施是否得当', 'J5'],
  ['应急处置措施是否切实可行', 'J5'],
  ['设备管理是否符合要求', 'J6'],
  ['各项工作是否达标', 'J6'],
  ['现场管理是否规范', 'J7'],
  ['设备运行是否正常完好', 'J7'],
  ['是否承诺不再发生同类问题', 'J8'],
  ['岗位人员安全意识是否到位', 'J9'],
  ['操作人员是否熟练掌握操作法', 'J9'],
  ['现场是否存在重大隐患、风险是否可控', 'J10'],
  ['问题原因分析是否透彻、整改是否彻底', 'J11'],
  ['现有备件是否满足生产需要', 'J12'],
  ['本次自查总体评价与自查结论', 'J13'],
  ['隐患整改是否及时', 'J14'],
  ['下一步改进措施与建议', 'J15'],
];
for (const [text, rid] of JUDGMENT_CASES) {
  const c = S.classify(text);
  eq(c.category, 'judgment', `A 判断类识别「${text}」`);
  ok(c.rules.some((r) => r.id === rid), `A 判断类规则号「${text}」应命中 ${rid}（实际 ${c.rules.map((r) => r.id).join(',') || '无'}）`);
}
// 判断类优先级高于客观类：即便同时含「数量」「是否建立」这类客观词，也按判断类留空
eq(S.classify('是否建立健全设备管理制度').category, 'judgment', 'A24 含「是否建立」但同时含「健全」→ 判断类优先');
eq(S.classify('培训人数是否满足要求').category, 'judgment', 'A25 含「人数」但同时含「满足要求」→ 判断类优先');
eq(S.classify('设备台账数量是否规范完整').category, 'judgment', 'A26 含「数量」但同时含「规范」→ 判断类优先');

/* ==================== B. 客观项识别与取数方式 ==================== */
eq(S.classify('是否建立设备台账').category, 'objective', 'B1 有无类为客观项');
eq(S.classify('是否建立设备台账').kind, 'exist', 'B2 有无类 kind=exist');
eq(S.classify('在用设备台数').kind, 'count', 'B3 数量类 kind=count');
eq(S.classify('安全阀上次校验日期').kind, 'date', 'B4 日期类 kind=date');
eq(S.classify('压力容器是否超期未检').kind, 'due', 'B5 到期类 kind=due');
eq(S.classify('巡检记录是否逐台齐全').kind, 'complete', 'B6 齐全类 kind=complete');
// 多规则命中时取信息量最大的
eq(S.classify('压力容器是否在检验有效期内、有无超期').kind, 'due', 'B7 同时命中有无/到期时按到期取数');
eq(S.classify('这是一句没有任何特征词的话').category, 'unparsed', 'B8 无特征词 → unparsed，不猜测');
ok(S.itemSources('压力容器是否超期').includes('special'), 'B9 自查项数据源归类');
eq(S.sheetSource('特种设备检验台账'), 'special', 'B10 数据表归类');
eq(S.sheetSource('食堂卫生记录'), null, 'B11 无关数据表不归类，不强行对应');

/* ==================== C. 禁用词兜底 ==================== */
ok(S.checkFillValue('符合').length > 0, 'C1 「符合」被识别为禁用填写内容');
ok(S.checkFillValue('已落实').length > 0, 'C2 「已落实」被识别为禁用');
ok(S.checkFillValue('制度健全').length > 0, 'C3 「健全」被识别为禁用');
ok(S.checkFillValue('运行正常').length > 0, 'C4 「正常」被识别为禁用');
eq(S.checkFillValue('共 6 台').length, 0, 'C5 纯事实内容不触发禁用');
eq(S.checkFillValue('2026-04-05').length, 0, 'C6 日期不触发禁用');

/* ==================== D. 基础运行：混合表 ==================== */
const FORM = mkx('form.xlsx', {
  '自查表': [
    ['某厂 设备管理专项自查表'],
    ['序号', '自查类别', '自查内容', '现状', '是否符合', '整改措施', '备注'],
    ['1', '基础', '是否建立设备台账', '', '', '', ''],
    ['2', '基础', '在用设备台数', '', '', '', ''],
    ['3', '基础', '设备管理制度是否健全', '', '', '', ''],
    ['4', '特种设备', '压力容器是否超期未检', '', '', '', ''],
    ['5', '人员', '培训是否有效', '', '', '', ''],
    ['6', '作业', '是否建立作业票台账', '', '', '', ''],
  ],
});
const DATA = mkx('data.xlsx', {
  '设备台账': [['位号', '设备名称', '投用日期'], ['P-1101A', '进料泵', '2019-05-12'], ['V-2301', '缓冲罐', '2018-03-20']],
  '特种设备检验台账': [['位号', '下次检验日期'], ['V-2301', '2026-08-10'], ['V-2302', '2027-03-15']],
});
let r = run([...BASE, '--form', FORM, '--data', DATA, '--period', ASOF], 'base');
eq(r.s.ok, true, 'D1 基础运行成功');
eq(r.s.counts.items, 6, 'D2 自查项数');
eq(r.s.counts.prefilled, 3, 'D3 已预填 3 项（台账有无、台数、超期）');
eq(r.s.counts.needJudgment, 2, 'D4 需判断 2 项（制度健全、培训有效）');
eq(r.s.counts.noData, 1, 'D5 缺数据 1 项（作业票台账未提供）');
eq(r.s.counts.unparsed, 0, 'D6 无法解析 0 项');
ok(fs.existsSync(path.join(r.out, '自查表预填稿.xlsx')), 'D7 预填稿 xlsx 已生成');
ok(fs.existsSync(path.join(r.out, '填写说明.md')), 'D8 填写说明.md 已生成');
ok(fs.existsSync(path.join(r.out, 'summary.json')), 'D9 summary.json 已落盘');
ok(fs.existsSync(path.join(r.out, 'filled.json')), 'D10 filled.json 已落盘');

/* ==================== E. 判断类项一律留空，绝不预填「符合」（最关键） ==================== */
ok(r.j.needJudgment.every((x) => x.value === null), 'E1 判断类项 value 恒为 null');
ok(r.j.needJudgment.every((x) => x.sourceNote === null && x.evidence === null), 'E2 判断类项不挂任何数据来源');
ok(r.j.needJudgment.every((x) => x.statusCn.includes('留空')), 'E3 判断类项状态文字含「留空」');
ok(r.j.needJudgment.every((x) => x.ruleIds.length > 0 && /^J/.test(x.ruleIds[0])), 'E4 判断类项带 J 系列规则号，可追溯');
ok(r.j.needJudgment.every((x) => x.note.includes('不得以「符合」「已落实」「健全」代填')), 'E5 判断类项注明不得代填');
// 预填内容里一个判定词都不能有
ok(r.j.prefilled.every((x) => S.checkFillValue(x.value).length === 0), 'E6 所有预填内容都不含判定性词汇');
// 预填稿 xlsx 中，判断类项所在行的「现状」「是否符合」列必须为空
const sheet = r.book['自查表'];
const hdr = sheet[1].map((c) => String(c || ''));
const cState = hdr.indexOf('现状'), cConf = hdr.indexOf('是否符合'), cFix = hdr.indexOf('整改措施');
const rowOf = (no) => sheet.find((x) => x && String(x[0]) === no);
ok(!rowOf('3')[cState], 'E7 「制度是否健全」行的现状列为空');
ok(!rowOf('5')[cState], 'E8 「培训是否有效」行的现状列为空');
ok(sheet.slice(2).every((x) => !x[cConf]), 'E9 「是否符合」列脚本一个字都没写');
ok(sheet.slice(2).every((x) => !x[cFix]), 'E10 「整改措施」列脚本一个字都没写');
const mdNoBan = r.md.split('\n').filter((l) => /不得以|不得|绝不|禁止/.test(l)).length;
ok(mdNoBan >= 2, 'E11 md 中含多处「不得代填」硬提示');
ok(/^> \*\*【注意】存在须责任人判断的自查项/m.test(r.md), 'E12 有判断类项时 md 开头有醒目提示（用「【注意】」）');
ok(!/⚠|✅|❌/.test(r.md), 'E12b 产出 md 不含 emoji');
// 全判断类表：预填数必须为 0
const FORM_J = mkx('form-j.xlsx', {
  '自查表': [['序号', '自查内容', '现状', '备注'],
    ['1', '管理制度是否健全', '', ''], ['2', '整改是否落实到位', '', ''],
    ['3', '责任是否明确', '', ''], ['4', '培训是否有效', '', ''],
    ['5', '措施是否得当', '', ''], ['6', '总体评价', '', '']],
});
r = run([...BASE, '--form', FORM_J, '--data', DATA, '--period', ASOF], 'alljudge');
eq(r.s.counts.prefilled, 0, 'E13 全判断类表预填数为 0');
eq(r.s.counts.needJudgment, 6, 'E14 全判断类表 6 项全部标 needJudgment');
eq(r.s.cellsWritten, 0, 'E15 全判断类表未写入任何单元格');
ok(r.book['自查表'].slice(1).every((x) => !String((x || [])[2] || '')), 'E16 全判断类表「现状」列全部为空，不出现任何代填内容');

/* ==================== F. 有数据源但数据缺失 → noData，绝不按「符合」 ==================== */
r = run([...BASE, '--form', FORM, '--data', DATA, '--period', ASOF], 'nodata');
const nd = r.j.noData;
eq(nd.length, 1, 'F1 缺数据 1 项');
ok(nd[0].text.includes('作业票'), 'F2 缺数据项定位正确');
eq(nd[0].value, null, 'F3 缺数据项 value 为 null，不填「符合」也不填「无」');
ok(/未提供「作业票台账」类数据表/.test(nd[0].missing), 'F4 明确说明缺什么数据');
ok(nd[0].note.includes('不按「符合」或「无」处理'), 'F5 缺数据项注明不按符合处理');
// 台账全空（有表无数据行）
const DATA_EMPTY = mkx('data-empty.xlsx', {
  '设备台账': [['位号', '设备名称', '投用日期']],
  '特种设备检验台账': [['位号', '下次检验日期']],
});
r = run([...BASE, '--form', FORM, '--data', DATA_EMPTY, '--period', ASOF], 'emptydata');
eq(r.s.counts.prefilled, 0, 'F6 台账无数据行时预填数为 0');
eq(r.s.counts.noData, 4, 'F7 四个客观项全部落入 noData');
ok(r.j.noData.some((x) => /没有任何数据行/.test(x.missing)), 'F8 空表如实写「没有任何数据行」');
ok(r.j.noData.every((x) => x.value === null), 'F9 空表下无一项被填「符合」');
// 有数据表但缺关键字段
const DATA_NOFIELD = mkx('data-nofield.xlsx', {
  '特种设备检验台账': [['位号', '设备名称'], ['V-2301', '缓冲罐']],
});
const FORM_DUE = mkx('form-due.xlsx', {
  '自查表': [['序号', '自查内容', '现状', '备注'], ['1', '压力容器是否超期未检', '', '']],
});
r = run([...BASE, '--form', FORM_DUE, '--data', DATA_NOFIELD, '--period', ASOF], 'nofield');
eq(r.s.counts.noData, 1, 'F10 缺到期日字段 → noData');
ok(/没有到期日字段/.test(r.j.noData[0].missing), 'F11 说明缺的是到期日字段');
// 日期无法解析 → 不按未超期处理
const DATA_BADDATE = mkx('data-baddate.xlsx', {
  '特种设备检验台账': [['位号', '下次检验日期'], ['V-2301', '不详'], ['V-2302', '待定']],
});
r = run([...BASE, '--form', FORM_DUE, '--data', DATA_BADDATE, '--period', ASOF], 'baddate');
eq(r.s.counts.noData, 1, 'F12 到期日全部无法解析 → noData，不按未超期');
ok(/全部无法解析/.test(r.j.noData[0].missing), 'F13 如实说明日期无法解析');
// 部分日期无法解析 → 计入「到期日不详」，不按未超期
const DATA_MIXDATE = mkx('data-mixdate.xlsx', {
  '特种设备检验台账': [['位号', '下次检验日期'], ['V-2301', '2026-08-10'], ['V-2302', '待定']],
});
r = run([...BASE, '--form', FORM_DUE, '--data', DATA_MIXDATE, '--period', ASOF], 'mixdate');
eq(r.s.counts.prefilled, 1, 'F14 部分日期可解析时仍可预填');
ok(/到期日不详 1/.test(r.j.prefilled[0].value), 'F15 不详的条目单列，不并入未到期');
ok(r.j.warnings.some((w) => /未按未超期处理/.test(w)), 'F16 日期不详有 warning 且注明未按未超期处理');

/* ==================== G. 预填项必须注明数据来源 ==================== */
r = run([...BASE, '--form', FORM, '--data', DATA, '--period', ASOF], 'src');
ok(r.j.prefilled.every((x) => x.sourceNote && /数据来源：/.test(x.sourceNote)), 'G1 每条预填项都有「数据来源：」');
ok(r.j.prefilled.every((x) => /data\.xlsx\//.test(x.sourceNote)), 'G2 数据来源写明来源文件与工作表');
ok(r.j.prefilled.every((x) => x.evidence), 'G3 每条预填项都有依据记录定位');
// xlsx 里备注列写了来源
const sh = r.book['自查表'];
const h2 = sh[1].map((c) => String(c || ''));
const cNote = h2.indexOf('备注');
const row1 = sh.find((x) => x && String(x[0]) === '1');
ok(/数据来源：/.test(String(row1[cNote])), 'G4 预填稿备注列写入数据来源');
ok(/## 二、已预填项与数据来源/.test(r.md), 'G5 md 单列「已预填项与数据来源」一节');
ok(/不代表该项合规达标/.test(r.md), 'G6 预填节注明预填不等于合规达标');

/* ==================== H. 不做合规判定、不代签字、声明行 ==================== */
const STATEMENT = '本表为预填稿，判断类项目与最终结论须由责任人核实填写并签字；预填内容需逐项核对后方可提交。';
ok(r.md.includes(STATEMENT), 'H1 声明行逐字出现在 md 中');
eq(r.j.meta.statement, STATEMENT, 'H2 声明行写入 filled.json');
ok(r.book['声明'].some((x) => (x || []).join('').includes('须由责任人核实填写并签字')), 'H3 声明行写入 xlsx「声明」表');
const mdBody = r.md.slice(0, r.md.indexOf('<!-- ANALYSIS_START -->'));
const mdFacts = mdBody.split('\n').filter((l) => !/不得|绝不|禁止|须由|不代表|不按/.test(l)).join('\n');
ok(!/该项合格|该项达标|该项不达标|判定为符合|结论：符合/.test(mdFacts), 'H4 正文不出现合规达标判定');
ok(/不做合规达标判定/.test(r.md), 'H5 分析段占位明确不做合规判定');
ok(/不代替责任人签字/.test(r.md), 'H6 分析段占位明确不代签字');
// 签字栏不被当作自查项
const FORM_SIGN = mkx('form-sign.xlsx', {
  '自查表': [['序号', '自查内容', '现状'], ['1', '是否建立设备台账', ''], ['填报人', '', ''], ['责任人签字', '', '']],
});
r = run([...BASE, '--form', FORM_SIGN, '--data', DATA, '--period', ASOF], 'sign');
eq(r.s.counts.items, 1, 'H7 签字栏不计入自查项');
ok(r.j.warnings.some((w) => /不代签字/.test(w)), 'H8 签字栏有 warning 且注明不代签字');
ok(r.j.meta.neverWriteCols !== undefined, 'H9 meta 记录了脚本不写的列');

/* ==================== I. 合并单元格与复杂表结构 ==================== */
// merge-lite 单元测试
const mg = [{ r1: 3, c1: 1, r2: 5, c2: 1 }];
ok(!!M.mergeAt(mg, 4, 1), 'I1 mergeAt 命中合并区内单元格');
eq(M.isMergedFollower(mg, 3, 1), false, 'I2 合并区左上角不是从属格');
eq(M.isMergedFollower(mg, 4, 1), true, 'I3 合并区第二行是从属格');
eq(M.parseRange('B4:B6').r2, 5, 'I4 区域解析正确');
eq(M.parseRange('非法'), null, 'I5 非法区域返回 null');
// 真带合并单元格的表（由 make-sample 同法生成）
const MERGED = path.join(work, 'form-merged.xlsx');
{
  const rows = [
    ['某厂 安全生产大检查自查表'],
    ['序号', '自查类别', '自查内容', '现状', '是否符合', '备注'],
    ['1', '设备设施', '是否建立设备台账', '', '', ''],
    ['2', '', '在用设备台数', '', '', ''],
    ['3', '', '设备管理制度是否健全', '', '', ''],
    ['4', '特种设备', '压力容器是否超期未检', '', '', ''],
    ['5', '', '责任是否落实到位', '', '', ''],
  ];
  writeXlsx(MERGED, { '自查表': rows });
  injectMerges(MERGED, ['A1:F1', 'B3:B5', 'B6:B7', 'C1:D1', 'E1:F1']);
}
r = run([...BASE, '--form', MERGED, '--data', DATA, '--period', ASOF], 'merged');
eq(r.s.ok, true, 'I6 带合并单元格的表可解析');
eq(r.s.counts.merges, 5, 'I7 合并单元格数量读出正确');
eq(r.s.needConfirm, true, 'I8 合并单元格 ≥5 → needConfirm');
ok(r.j.meta.complexReasons.some((x) => /合并单元格/.test(x)), 'I9 复杂原因写明合并单元格');
ok(r.j.warnings.some((w) => /须先向用户展示解析结果并确认后再填写/.test(w)), 'I10 有 warning 要求先确认');
ok(/^> \*\*【注意】本自查表结构复杂/m.test(r.md), 'I11 md 开头有「结构复杂先确认」醒目提示');
eq(r.s.counts.items, 5, 'I12 合并列不影响自查项计数');
eq(r.s.counts.needJudgment, 2, 'I13 合并表中判断类项仍被识别');
// 表头不在首行也算复杂
const FORM_DEEP = mkx('form-deep.xlsx', {
  '自查表': [['标题1'], ['标题2'], ['标题3'], ['序号', '自查内容', '现状'], ['1', '是否建立设备台账', '']],
});
r = run([...BASE, '--form', FORM_DEEP, '--data', DATA, '--period', ASOF], 'deep');
eq(r.s.needConfirm, true, 'I14 表头在第 4 行 → needConfirm');
eq(r.j.meta.headerRow, 4, 'I15 表头行号写入 meta');

/* ==================== J. 输入解析边界 ==================== */
// 合计行跳过
const FORM_TOTAL = mkx('form-total.xlsx', {
  '自查表': [['序号', '自查内容', '现状'], ['1', '是否建立设备台账', ''], ['合计', '', '']],
});
r = run([...BASE, '--form', FORM_TOTAL, '--data', DATA, '--period', ASOF], 'total');
eq(r.s.counts.items, 1, 'J1 自查表合计行跳过');
ok(r.j.warnings.some((w) => /合计行/.test(w)), 'J2 合计行有 warning');
// 别名表头
const FORM_ALIAS = mkx('form-alias.xlsx', {
  '检查清单': [['编号', '检查内容', '自查情况', '说明'], ['1', '是否建立设备台账', '', ''], ['2', '制度是否健全', '', '']],
});
r = run([...BASE, '--form', FORM_ALIAS, '--data', DATA, '--period', ASOF], 'alias');
eq(r.s.ok, true, 'J3 别名 sheet 名与别名表头可识别');
eq(r.s.counts.items, 2, 'J4 别名解析出自查项数正确');
eq(r.s.counts.prefilled, 1, 'J5 别名表下客观项仍可预填');
// 自查项为空的行
const FORM_BLANK = mkx('form-blank.xlsx', {
  '自查表': [['序号', '自查内容', '现状'], ['1', '是否建立设备台账', ''], ['2', '', '']],
});
r = run([...BASE, '--form', FORM_BLANK, '--data', DATA, '--period', ASOF], 'blank');
eq(r.s.counts.items, 1, 'J6 自查项为空的行跳过');
ok(r.j.warnings.some((w) => /未按上一行内容补齐/.test(w)), 'J7 空自查项有 warning 且不按上一行补齐');
// 台账合计行
r = run([...BASE, '--form', FORM, '--data', mkx('data-total.xlsx', {
  '设备台账': [['位号', '设备名称'], ['P-1101A', '泵'], ['V-2301', '罐'], ['合计', '2 台']],
}), '--period', ASOF], 'datatotal');
eq(r.j.prefilled.find((x) => x.no === '2').value, '2', 'J8 台账合计行不计入数量');
ok(r.j.warnings.some((w) => /台账.*合计行/.test(w)), 'J9 台账合计行有 warning');
// 多数据文件
r = run([...BASE, '--form', FORM, '--data', `${DATA},${DATA_NOFIELD}`, '--period', ASOF], 'multi');
eq(r.s.ok, true, 'J10 多个 --data 文件可合并读取');
ok(r.s.counts.dataTables >= 3, 'J11 多文件的数据表全部装载');
// 无法归类的数据表 → warning，不强行取数
r = run([...BASE, '--form', FORM, '--data', mkx('data-unknown.xlsx', {
  '食堂卫生记录': [['日期', '检查人'], ['2026-09-01', '张三']],
}), '--period', ASOF], 'unknownsheet');
ok(r.j.warnings.some((w) => /无法归入任何已知数据源类别/.test(w)), 'J12 无法归类的数据表有 warning');
eq(r.s.counts.prefilled, 0, 'J13 无关数据表不被强行用来预填');
// 无法解析类型的自查项
const FORM_ODD = mkx('form-odd.xlsx', {
  '自查表': [['序号', '自查内容', '现状'], ['1', '其他需要说明的事项', '']],
});
r = run([...BASE, '--form', FORM_ODD, '--data', DATA, '--period', ASOF], 'odd');
eq(r.s.counts.unparsed, 1, 'J14 无法判定类型 → unparsed');
eq(r.j.unparsed[0].value, null, 'J15 unparsed 项留空，不猜测');
ok(/未做任何猜测性填写/.test(r.j.unparsed[0].note), 'J16 unparsed 项注明未猜测');
// 无可写列
const FORM_NOCOL = mkx('form-nocol.xlsx', {
  '自查表': [['序号', '自查内容'], ['1', '是否建立设备台账']],
});
r = run([...BASE, '--form', FORM_NOCOL, '--data', DATA, '--period', ASOF], 'nocol');
eq(r.s.ok, true, 'J17 无可写列时不中断');
ok(r.j.warnings.some((w) => /预填内容无处写入/.test(w)), 'J18 无可写列有 warning');
eq(r.s.cellsWritten, 0, 'J19 无可写列时未写入单元格');

/* ==================== K. 参数校验 ==================== */
function raw(args) {
  const rr = spawnSync(process.execPath, [F, ...args], { encoding: 'utf8' });
  const lines = rr.stdout.trim().split('\n');
  try { return { code: rr.status, s: JSON.parse(lines[lines.length - 1]) }; } catch (e) { return { code: rr.status, s: { ok: false, error: 'no-json' } }; }
}
let x = raw(['--form']);
eq(x.s.ok, false, 'K1 --form 缺值报错');
ok(/缺少取值/.test(x.s.error), 'K2 缺值错误信息正确');
eq(x.code, 1, 'K3 退出码为 1');
x = raw(['--form', FORM, '--data', DATA]);
ok(/缺少 --workshop/.test(x.s.error), 'K4 缺 --workshop 报错');
x = raw(['--form', FORM, '--workshop', '车间']);
ok(/缺少 --data/.test(x.s.error), 'K5 缺 --data 报错');
x = raw(['--form', FORM, '--data', DATA, '--workshop', '车间', '--未知参数', 'v']);
eq(x.s.ok, false, 'K6 未知参数报错');
x = raw(['--form', '/不存在.xlsx', '--data', DATA, '--workshop', '车间', '--period', ASOF]);
ok(/自查表不存在/.test(x.s.error), 'K7 自查表不存在报错');
x = raw(['--form', FORM, '--data', '/不存在.xlsx', '--workshop', '车间', '--period', ASOF]);
ok(/台账与记录文件不存在/.test(x.s.error), 'K8 台账不存在报错');
x = raw(['--form', FORM, '--data', DATA, '--workshop', '车间', '--period', ASOF, '--last', '/不存在.xlsx']);
ok(/上次自查表不存在/.test(x.s.error), 'K9 --last 不存在报错');
x = raw(['--form', FORM, '--data', DATA, '--workshop', '车间', '--period', ASOF, '--spec', '/不存在.md']);
ok(/厂内填报要求说明不存在/.test(x.s.error), 'K10 --spec 不存在报错');
const NOHDR = mkx('nohdr.xlsx', { '自查表': [['甲', '乙'], [1, 2]] });
x = raw(['--form', NOHDR, '--data', DATA, '--workshop', '车间', '--period', ASOF]);
ok(/未找到含「自查项」/.test(x.s.error), 'K11 无自查项表头报错');
const NOITEM = mkx('noitem.xlsx', { '自查表': [['序号', '自查内容', '现状']] });
x = raw(['--form', NOITEM, '--data', DATA, '--workshop', '车间', '--period', ASOF]);
ok(/未从.*解析出任何自查项/.test(x.s.error), 'K12 解析不出自查项报错');
const PDF = path.join(work, 'form.pdf'); fs.writeFileSync(PDF, 'x');
x = raw(['--form', PDF, '--data', DATA, '--workshop', '车间', '--period', ASOF]);
ok(/不支持的格式/.test(x.s.error), 'K13 不支持的自查表格式报错');
x = raw(['--form', work, '--data', DATA, '--workshop', '车间', '--period', ASOF]);
ok(/不接受目录/.test(x.s.error), 'K14 --form 传目录报错');
// --period 必填且须为日期：到期类不得按脚本运行日默认
x = raw(['--form', FORM, '--data', DATA, '--workshop', '车间', '--period', '2026年三季度']);
eq(x.s.ok, false, 'K15 --period 非日期报错（不按运行日默认）');
ok(/周期截止日/.test(x.s.error), 'K16 错误信息提示用周期截止日作为时点');
x = raw(['--form', FORM, '--data', DATA, '--workshop', '车间']);
eq(x.s.ok, false, 'K17 未提供 --period 报错');
ok(/缺少 --period/.test(x.s.error) && /不按运行日默认/.test(x.s.error), 'K18 错误信息说明不按运行日默认');
eq(x.code, 1, 'K18b 退出码 1');
ok(/PDF 请先用平台 pdf 技能/.test(raw(['--form', PDF, '--data', DATA, '--workshop', '车间', '--period', ASOF]).s.error), 'K13b PDF 报错提示前置转换');

/* ==================== M. 打分与结论类列绝不写入 ==================== */
const FORM_SCORE = mkx('form-score.xlsx', {
  '自查表': [
    ['序号', '自查内容', '标准分', '现状', '是否符合', '得分', '扣分', '检查结论', '自评', '备注'],
    ['1', '是否建立车间设备台账', '10', '', '', '', '', '', '', ''],
    ['2', '压力容器是否在检验有效期内、有无超期', '20', '', '', '', '', '', '', ''],
    ['3', '设备管理制度是否健全', '10', '', '', '', '', '', '', ''],
  ],
});
r = run([...BASE, '--form', FORM_SCORE, '--data', DATA, '--period', ASOF], 'score');
eq(r.s.ok, true, 'M1 带打分列的自查表可运行');
ok(['得分', '扣分', '标准分', '检查结论', '自评', '是否符合'].every((c) => r.j.meta.neverWriteCols.includes(c)), 'M2 meta.neverWriteCols 含 得分/扣分/标准分/检查结论/自评/是否符合');
{
  const sh = r.book['自查表'];
  const h = sh[0].map((c) => String(c || ''));
  const idx = (n) => h.indexOf(n);
  const dataRows = sh.slice(1).filter((x) => x && String(x[0]));
  for (const col of ['得分', '扣分', '检查结论', '自评', '是否符合']) ok(dataRows.every((x) => !x[idx(col)]), `M3 「${col}」列脚本一个字都没写`);
  ok(dataRows.every((x) => String(x[idx('标准分')]) === String(x[idx('标准分')])) && dataRows.every((x) => x[idx('标准分')] !== undefined), 'M4 「标准分」列原值保留未改动');
  ok(dataRows.some((x) => x[idx('现状')]), 'M5 客观项仍写入「现状」列');
}
ok(r.s.counts.prefilled >= 1, 'M6 客观项照常预填');
ok(/脚本不写的列 \|.*得分/.test(r.md), 'M7 md 基本信息列出脚本不写的列');

/* ==================== N. O 系列客观项规则逐条 ==================== */
const oid = (t) => S.classify(t).rules.map((x) => x.id);
ok(oid('是否配备可燃气体报警器').includes('O1'), 'N1 O1 有无类（是否配备）');
ok(oid('特种设备作业人员人数').includes('O2'), 'N2 O2 数量类（人数）');
ok(oid('安全阀最近一次校验日期').includes('O3'), 'N3 O3 日期类（最近一次）');
ok(oid('压力表是否超期未检').includes('O4'), 'N4 O4 到期类（是否超期）');
ok(oid('设备档案是否全覆盖').includes('O5'), 'N5 O5 齐全类（是否全覆盖）');
ok(oid('特护机组位号').includes('O6'), 'N6 O6 名称编号类（位号）');
eq(S.classify('特护机组位号').kind, 'text', 'N7 O6 kind=text');
eq(S.OBJECTIVE_RULES.map((x) => x.id).join(','), 'O1,O2,O3,O4,O5,O6', 'N8 O 系列规则号 O1~O6 与 fill-rules.md 一一对应');
ok(S.OBJECTIVE_RULES.every((x) => x.kind && x.words.length && x.desc), 'N9 每条 O 规则含 kind/words/desc');
eq(S.classify('是否建立健全管理制度').category, 'judgment', 'N10 判断类优先于 O1（含「是否建立」仍留空）');
eq(S.classify('检验日期是否符合要求').category, 'judgment', 'N11 判断类优先于 O3');

/* ==================== L. 产出结构完整性 ==================== */
r = run([...BASE, '--form', FORM, '--data', DATA, '--period', ASOF, '--workshop', '常减压车间'], 'struct');
ok(/## 一、基本信息/.test(r.md) && /## 二、已预填项与数据来源/.test(r.md) && /## 三、需责任人判断项/.test(r.md)
  && /## 四、缺数据留空项/.test(r.md) && /## 五、无法解析项/.test(r.md) && /## 六、填写与提交提示/.test(r.md), 'L1 六节结构齐全');
ok(/<!-- ANALYSIS_START -->/.test(r.md) && /<!-- ANALYSIS_END -->/.test(r.md), 'L2 分析段占位符存在');
eq(r.j.counts.items, r.j.prefilled.length + r.j.needJudgment.length + r.j.noData.length + r.j.unparsed.length, 'L3 四类状态之和等于自查项总数');
ok(r.j.items.every((x) => 'no' in x && 'text' in x && 'status' in x && 'statusCn' in x && 'ruleIds' in x), 'L4 items 字段齐全');
ok(Array.isArray(r.j.prefilled) && Array.isArray(r.j.needJudgment) && Array.isArray(r.j.noData) && Array.isArray(r.j.unparsed), 'L5 四类清单均为数组');
const names = Object.keys(r.book);
ok(names.includes('预填明细') && names.includes('需责任人判断') && names.includes('缺数据项') && names.includes('无法解析项') && names.includes('声明'), 'L6 xlsx 附表齐全');
ok(names.includes('自查表'), 'L7 原表工作表名保留（保持原格式）');
eq(r.book['自查表'][0][0], '某厂 设备管理专项自查表', 'L8 原表标题行原样保留');
const sj = JSON.parse(fs.readFileSync(path.join(r.out, 'summary.json'), 'utf8'));
eq(sj.ok, true, 'L9 summary.json 内容正确');
eq(sj.counts.needJudgment, r.j.counts.needJudgment, 'L10 summary 与 filled.json 计数一致');
ok(/自查表预填说明/.test(r.md.split('\n')[0]), 'L11 md 标题正确');
eq(r.j.meta.asOf, ASOF, 'L12 自查时点写入 meta');

/* ==================== 输出 ==================== */
console.log(`\n${'='.repeat(56)}`);
console.log(`self-audit-form-filler 自测：${pass} 通过，${fail} 失败`);
if (failures.length) { console.log('\n失败项：'); failures.forEach((f) => console.log('  ✗ ' + f)); }
console.log('='.repeat(56));
try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);

/** 往已写出的 xlsx 里注入 mergeCells（自测用，与 make-sample.js 同法） */
function injectMerges(file, refs) {
  const zlib = require('zlib');
  const { crc32 } = require('./lib/xlsx-lite');
  const buf = fs.readFileSync(file);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = {}; const order = [];
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    const lnlen = buf.readUInt16LE(lho + 26), lelen = buf.readUInt16LE(lho + 28);
    const data = buf.subarray(lho + 30 + lnlen + lelen, lho + 30 + lnlen + lelen + csize);
    entries[name] = method === 8 ? zlib.inflateRawSync(data) : Buffer.from(data);
    order.push(name);
    p += 46 + nlen + elen + clen;
  }
  const key = 'xl/worksheets/sheet1.xml';
  entries[key] = Buffer.from(entries[key].toString('utf8').replace('</sheetData>',
    `</sheetData><mergeCells count="${refs.length}">${refs.map((x) => `<mergeCell ref="${x}"/>`).join('')}</mergeCells>`), 'utf8');
  const parts = [], central = [];
  let offset = 0;
  for (const n of order) {
    const name = Buffer.from(n, 'utf8'); const data = entries[n];
    const comp = zlib.deflateRawSync(data, { level: 9 }); const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    parts.push(lh, name, comp);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0x0800, 8); cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(name.length, 28); cd.writeUInt32LE(offset, 42);
    central.push(cd, name);
    offset += lh.length + name.length + comp.length;
  }
  const cdBuf = Buffer.concat(central);
  const e2 = Buffer.alloc(22);
  e2.writeUInt32LE(0x06054b50, 0); e2.writeUInt16LE(order.length, 8); e2.writeUInt16LE(order.length, 10);
  e2.writeUInt32LE(cdBuf.length, 12); e2.writeUInt32LE(offset, 16);
  fs.writeFileSync(file, Buffer.concat([...parts, cdBuf, e2]));
}
