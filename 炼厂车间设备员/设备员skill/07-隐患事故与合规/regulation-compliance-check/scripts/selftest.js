#!/usr/bin/env node
'use strict';
/** 自测：断言 compliance.js 与 compliance-spec.js 行为。用法：node scripts/selftest.js（全绿退出 0） */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { writeXlsx, readXlsx } = require("./lib/xlsx-lite");
const S = require('./lib/compliance-spec');

const E = path.join(__dirname, 'compliance.js');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rcc-selftest-'));
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
const eq = (x, e, n) => ok(x === e, `${n}（期望 ${JSON.stringify(e)}，实际 ${JSON.stringify(x)}）`);

function run(args, tag) {
  const out = path.join(work, tag + '-out');
  const r = spawnSync(process.execPath, [E, ...args, '--out', out], { encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  let s; try { s = JSON.parse(lines[lines.length - 1]); } catch (e) { s = { ok: false, error: 'no-json:' + r.stdout + r.stderr }; }
  let j = null, md = null;
  if (fs.existsSync(path.join(out, 'compliance.json'))) j = JSON.parse(fs.readFileSync(path.join(out, 'compliance.json'), 'utf8'));
  if (fs.existsSync(path.join(out, 'compliance.md'))) md = fs.readFileSync(path.join(out, 'compliance.md'), 'utf8');
  return { code: r.status, s, j, md, out };
}
const mkx = (n, b) => { const p = path.join(work, n); writeXlsx(p, b); return p; };
const mkt = (n, t) => { const p = path.join(work, n); fs.writeFileSync(p, t, 'utf8'); return p; };
const BASE = ['--workshop', '测试车间', '--date', '2026-09-21'];

/* =========================================================================
 * 「符合 / 不符合」禁用词扫描器
 * 产出中允许出现这些字眼的位置**只有三种**，除此之外一律算违规：
 *   W1 技能自身标题「法规标准符合性自查对照表」（业务名称，不是判定）
 *   W2 明确的禁用/免责语句（「不表述为」「不得改写为」「不得出现」「不构成」「不提供」「均不是…结论」）
 *   W3 用户提供的条款原文被逐字搬运的那一行（条款文本不许脚本改写）
 * =======================================================================*/
const BAN_WORDS = ['符合', '不符合', '达标', '合规', '违规', '违法', '合格', '不合格', '法律责任'];
/** 免责/禁用语句的标记词：整行含其一，说明这行是在「禁止」而不是在「判定」 */
const DISCLAIMER_MARKS = [
  '不表述为', '不得改写为', '不得出现', '不构成', '不提供', '均不是', '不是达标',
  '状态仅有', '正式判定以', '正式判定由', '四档', '禁用', '不得用',
  '由自查责任人', '不代填',   // 声明补充句「最终符合性结论由自查责任人……填写，本技能不代填」是免责语句，不是判定
];
/** 返回违规行（行号从 1 起） */
function scanForbidden(md, ruleTexts) {
  const bad = [];
  md.split('\n').forEach((ln, i) => {
    if (!BAN_WORDS.some((w) => ln.includes(w))) return;
    if (/^#\s.*法规标准符合性自查对照表\s*$/.test(ln)) return;                 // W1
    if (DISCLAIMER_MARKS.some((m) => ln.includes(m))) return;                  // W2
    if ((ruleTexts || []).some((t) => t && ln.includes(t))) return;            // W3
    bad.push(`第${i + 1}行: ${ln.slice(0, 80)}`);
  });
  return bad;
}
let r, x, bad, RULE_TEXTS;
const RULES = mkx('rules.xlsx', {
  '条款清单': [
    ['条款编号', '条款原文', '应做事项', '标准名称'],
    ['第一条', '使用单位应当建立设备管理制度，明确岗位职责。', '建立设备管理制度', 'XX/T 9001（虚构）'],
    ['第二条', '使用单位应当建立设备台账。', '建立设备台账', 'XX/T 9001（虚构）'],
    ['第三条', '压力容器应当按规定周期申报定期检验并保存检验报告。', '申报定期检验', 'XXG 001（虚构）'],
    ['第四条', '使用单位应当为设备建立技术档案。', '建立技术档案', 'XX/T 9001（虚构）'],
    ['第五条', '使用单位的设备管理工作应当健全有效。', '', 'XX/T 9001（虚构）'],
  ],
});
const MATS = mkx('mats.xlsx', {
  '资料清单': [
    ['资料名称', '资料类型', '存放位置', '完整性说明'],
    ['车间设备管理制度.docx', '制度', '柜A-1', ''],
    ['车间设备台账2026.xlsx', '台账', '柜A-2', ''],
    ['设备技术档案.pdf', '档案', '柜A-3', '缺页，附图未归档'],
    ['班组考勤表.xlsx', '', '柜D-1', ''],
  ],
});
const RULES_ONE = mkx('rules-one.xlsx', { '条款清单': [['条款编号', '条款原文'], ['第二条', '使用单位应当建立设备台账。']] });
const RULES_SMALL = mkx('rules-small.xlsx', {
  '条款清单': [['条款编号', '条款原文'],
    ['第一条', '使用单位应当建立设备管理制度。'],
    ['第二条', '使用单位应当建立设备台账。']],
});
const MATS_OK = mkx('mats-ok.xlsx', {
  '资料清单': [['资料名称', '资料类型', '存放位置'],
    ['车间设备管理制度.docx', '制度', '柜A-1'],
    ['车间设备台账.xlsx', '台账', '柜A-2']],
});
const FILL = '最终符合性结论由自查责任人按厂内审核表口径填写，本技能不代填';
function raw(args) {
  const x = spawnSync(process.execPath, [E, ...args], { encoding: 'utf8' });
  const lines = x.stdout.trim().split('\n');
  try { return { code: x.status, s: JSON.parse(lines[lines.length - 1]) }; } catch (e) { return { code: x.status, s: { ok: false, error: 'no-json' } }; }
}

/* ==================== A. 规则表单元测试 ==================== */
section('C', () => {
  ok(S.ruleCategories('使用单位应当建立设备台账').includes('ledger'), 'A1 条款归类-设备台账');
  ok(S.ruleCategories('应当组织开展日常巡检并如实记录').includes('patrol'), 'A2 条款归类-巡检');
  ok(S.fileCategories('2026年三季度巡检记录汇总.xlsx').includes('patrol'), 'A3 资料归类-巡检');
  eq(S.matchRule('使用单位应当建立设备台账', '常减压车间设备台账2026.xlsx').matched, true, 'A4 同类对应成立');
  eq(S.matchRule('人员应当持证上岗', '设备台账2026.xlsx').matched, false, 'A5 不同类不对应（台账不充人员持证记录）');
  eq(S.matchRule('应当组织应急演练', '巡检记录.xlsx').matched, false, 'A6 泛词「记录」不构成对应依据');
  eq(S.matchRule('应当建立隐患登记与治理台账', '设备台账2026.xlsx').matched, false, 'A7 裸「台账」二字不构成对应（隐患台账不等于设备台账）');
  eq(S.matchRule('设备操作与维修人员应当持证上岗', '设备检修记录台账.xlsx').matched, false, 'A8 「维修人员」不对应检修记录');
  eq(S.matchRule('压力容器应当按期申报定期检验', '压力容器定期检验报告.pdf').basis, 'category:periodicInspection', 'A9 定期检验类别对应');
  eq(S.matchRule('P-1101A 应当按期更换润滑油', 'P-1101A润滑油更换台账.xlsx').basis, 'feature:P1101A', 'A10 位号特征词对应（归一后去连字符）');
  ok(S.STATUS_KEYS.length === 4, 'A11 状态恰为四档');
  eq(Object.values(S.STATUS_CN).join('/'), '已见对应材料/未见对应材料/材料不完整/需进一步确认', 'A12 四档状态文字与 SKILL.md 一致');
  ok(!Object.values(S.STATUS_CN).some((v) => /符合/.test(v)), 'A13 四档状态中不含「符合/不符合」');
  ok(S.FORBIDDEN_TERMS.includes('符合') && S.FORBIDDEN_TERMS.includes('不符合'), 'A14 禁用词表含「符合/不符合」');
});

/* ---- 笼统性判定 ---- */
section('C', () => {
  ok(S.vagueness('使用单位应当加强管理，确保工作有效开展。').vague, 'A15 原则性表述判为笼统');
  ok(S.vagueness('必要时应当采取适当措施。').vague, 'A16 「必要时/适当」判为笼统');
  ok(!S.vagueness('使用单位应当建立设备台账。').vague, 'A17 指向具体资料的条款不判笼统');
  ok(!S.vagueness('安全阀应当按规定周期校验并保存校验记录。').vague, 'A18 校验记录条款不判笼统');
  ok(S.vagueness('').vague, 'A19 空条款判为笼统');
  ok(/未指向任何/.test(S.vagueness('应当持续改进。').reason || ''), 'A20 笼统原因写明未指向具体资料');
});

/* ==================== B. 基础路径：四档齐现 ==================== */
section('BVT', () => {
  r = run([...BASE, '--rules', RULES, '--materials', MATS], 'base');
  eq(r.s.ok, true, 'B1 基础运行成功');
  eq(r.s.counts.rules, 5, 'B2 条款总数');
  eq(r.s.counts.hasEvidence, 2, 'B3 已见对应材料数（制度、台账）');
  eq(r.s.counts.noEvidence, 1, 'B4 未见对应材料数（定期检验报告）');
  eq(r.s.counts.partialEvidence, 1, 'B5 材料不完整数（技术档案缺页）');
  eq(r.s.counts.needInterpretation, 1, 'B6 需进一步确认数（第五条笼统）');
  eq(r.s.counts.unmatched, 1, 'B7 未对应材料数（班组考勤表）');
  ok(fs.existsSync(path.join(r.out, '对照表.xlsx')), 'B8 对照表.xlsx 已生成');
  ok(fs.existsSync(path.join(r.out, 'summary.json')), 'B9 summary.json 已落盘');
  eq(r.j.counts.rules, r.j.hasEvidence.length + r.j.noEvidence.length + r.j.partialEvidence.length + r.j.needInterpretation.length, 'B10 四档之和等于条款总数');
});

/* ==================== C. 禁用「符合 / 不符合」（本技能最硬的一条） ==================== */
section('A', () => {
  RULE_TEXTS = r.j.items.map((x) => x.text).concat(r.j.items.map((x) => x.requirement)).filter(Boolean);
  bad = scanForbidden(r.md, RULE_TEXTS);
  ok(bad.length === 0, `C1 md 全文不出现「符合/不符合/达标/合规」等结论性表述（违规：${bad.join(' ｜ ')}）`);
  ok(r.j.items.every((x) => S.STATUS_KEYS.map((k) => S.STATUS_CN[k]).includes(x.statusCn)), 'C2 每条条款的状态都落在四档之内');
  ok(!r.j.items.some((x) => /符合|达标|合格|违规/.test(x.statusCn)), 'C3 状态文字本身不含禁用词');
  ok(!r.j.items.some((x) => BAN_WORDS.some((w) => (x.statusNote || '').includes(w) && !DISCLAIMER_MARKS.some((m) => x.statusNote.includes(m)))), 'C4 状态说明中不出现结论性表述');
  // 状态列逐格检查：第二节表格里每一行的状态单元格只能是四档之一
  const statusCells = (r.md.match(/\|\s\*{0,2}(已见对应材料|未见对应材料|材料不完整|需进一步确认)\*{0,2}\s\|/g) || []);
  ok(statusCells.length >= 5, 'C5 对照表状态列逐格为四档之一');
  ok(!/状态[^\n]*符合/.test(r.md.replace(/不表述为[^\n]*/g, '')), 'C6 不存在「状态：符合」式表述');
  ok(/不表述为「符合」或「不符合」/.test(r.md), 'C7 md 开头写明四档口径与禁用「符合/不符合」');
  eq(r.j.meta.statusVocabulary.join('/'), '已见对应材料/未见对应材料/材料不完整/需进一步确认', 'C8 四档词表写入 compliance.json');
  ok(!/本项符合|该项符合|判定为符合|结论[:：]\s*符合/.test(r.md), 'C9 无任何「判定为符合」式结论');
});

/* ==================== D. 条款文本必须由用户提供，不得凭记忆引用 ==================== */
section('A', () => {
  x = raw(['--materials', MATS, '--workshop', '车间', '--date', '2026-09-21']);
  eq(x.s.ok, false, 'D1 未提供 --rules 时报错终止');
  eq(x.code, 1, 'D2 未提供 --rules 时退出码为 1');
  ok(/不从记忆中引用条款编号与原文/.test(x.s.error), 'D3 错误信息说明不得凭记忆引用条款');
  x = raw(['--rules', '/不存在条款.xlsx', '--materials', MATS, '--workshop', '车间']);
  ok(/条款文本\/条款清单不存在/.test(x.s.error), 'D4 条款文件不存在时报错');
  ok(/不从记忆中引用/.test(x.s.error), 'D5 条款文件不存在的错误同样重申不得凭记忆引用');
  const EMPTY_RULES = mkx('rules-none.xlsx', { '条款清单': [['条款编号', '条款原文']] });
  x = raw(['--rules', EMPTY_RULES, '--materials', MATS, '--workshop', '车间']);
  ok(/未从.*解析出任何条款/.test(x.s.error), 'D6 解析不出条款时报错终止');
  ok(/不得凭记忆补充条款编号与原文/.test(x.s.error), 'D7 解析不出条款时重申不得补全');
  // 条款编号与原文逐字搬运，不被改写
  ok(r.j.items[0].no === '第一条' && r.j.items[0].text.startsWith('使用单位应当建立设备管理制度'), 'D8 条款编号与原文逐字保留');
  eq(r.j.meta.rulesProvidedByUser, true, 'D9 meta 标明条款由用户提供');
  eq(r.j.meta.rulesSource, 'rules.xlsx', 'D10 条款来源文件名写入 meta');
  ok(/条款来源[^\n]*用户提供/.test(r.md), 'D11 md 写明条款来源为用户提供');
  ok(/未从记忆中引用任何条款/.test(r.md), 'D12 md 写明未从记忆引用条款');
  ok(/不改写、不补全、不据记忆增补/.test(r.md), 'D13 md 写明不改写不补全条款');
});

/* ==================== E. 笼统条款单列，绝不自行解释后判定 ==================== */
section('A', () => {
  const RULES_VAGUE = mkx('rules-vague.xlsx', {
    '条款清单': [
      ['条款编号', '条款原文'],
      ['4.1', '使用单位应当加强管理，确保工作有效开展。'],
      ['4.2', '必要时应当采取适当措施。'],
      ['4.3', '相关工作应当健全完善。'],
    ],
  });
  r = run([...BASE, '--rules', RULES_VAGUE, '--materials', MATS], 'vague');
  eq(r.s.counts.needInterpretation, 3, 'E1 三条笼统条款全部进入 needInterpretation');
  eq(r.s.counts.hasEvidence, 0, 'E2 笼统条款不判为已见对应材料');
  eq(r.s.counts.noEvidence, 0, 'E3 笼统条款不被塞进未见对应材料');
  ok(r.j.needInterpretation.every((x) => x.statusCn === '需进一步确认'), 'E4 笼统条款状态为「需进一步确认」');
  ok(r.j.needInterpretation.every((x) => x.vague === true && x.vagueReason), 'E5 笼统条款记录了笼统原因');
  ok(r.j.needInterpretation.every((x) => /本技能不自行解释条款含义/.test(x.statusNote)), 'E6 笼统条款注明不自行解释条款含义');
  ok(r.j.needInterpretation.every((x) => /不据此作出任何判定/.test(x.statusNote)), 'E7 笼统条款注明不据此作判定');
  ok(/## 四、需进一步确认的条款/.test(r.md), 'E8 需进一步确认单列一节');
  ok(/均不自行解释条款含义，不猜测其指向哪份资料/.test(r.md), 'E9 该节写明不解释不猜测');
  ok(r.j.warnings.some((w) => w.includes('脚本不自行解释')), 'E10 笼统条款有 warning');
  bad = scanForbidden(r.md, r.j.items.map((x) => x.text));
  ok(bad.length === 0, `E11 笼统场景下 md 仍无禁用结论性表述（违规：${bad.join(' ｜ ')}）`);
});

// 笼统条款即使名下挂到了资料，也不改判
section('A', () => {
  const RULES_VAGUE2 = mkx('rules-vague2.xlsx', {
    '条款清单': [['条款编号', '条款原文'], ['5.1', '设备台账应当健全有效、持续完善、及时更新、妥善保管、加强管理。']],
  });
  r = run([...BASE, '--rules', RULES_VAGUE2, '--materials', MATS], 'vague2');
  // 该条虽含「设备台账」（具体指向），故不判笼统 —— 验证具体指向优先于笼统词
  eq(r.s.counts.needInterpretation, 0, 'E12 含具体资料指向的条款不因笼统词被误判为需确认');
  eq(r.s.counts.hasEvidence, 1, 'E13 含具体指向的条款正常对照');
});

/* ==================== F. 未见对应材料：既不写「不符合」也不写「符合」 ==================== */
section('A', () => {
  const MATS_SPARSE = mkx('mats-sparse.xlsx', {
    '资料清单': [['资料名称', '资料类型', '存放位置'], ['车间设备台账.xlsx', '台账', '柜A-1']],
  });
  r = run([...BASE, '--rules', RULES, '--materials', MATS_SPARSE], 'sparse');
  eq(r.s.counts.noEvidence, 3, 'F1 资料极少时未见对应材料 3 条');
  eq(r.s.counts.hasEvidence, 1, 'F2 仅台账一条已见对应材料');
  ok(r.j.noEvidence.every((x) => x.evidence.length === 0), 'F3 未见对应材料的条款名下不挂任何材料');
  ok(r.j.noEvidence.every((x) => x.statusCn === '未见对应材料'), 'F4 状态文字为「未见对应材料」');
  ok(r.j.noEvidence.every((x) => /按「未见对应材料」一档记录/.test(x.statusNote)), 'F5 说明中明确按四档之一记录');
  ok(r.j.noEvidence.every((x) => /正式判定由监管部门、内审或法务作出/.test(x.statusNote)), 'F6 说明中把判定权交回监管/内审/法务');
  ok(!r.j.noEvidence.some((x) => /不符合|不达标|违规/.test(x.statusNote.replace(/不表述为[^；]*/g, ''))), 'F7 未见材料的说明里没有「不符合」式判定');
  ok(/## 三、未见对应材料与材料不完整的条款/.test(r.md), 'F8 未见材料单列一节');
  ok(/不得改写为「不符合」，也不得改写为「符合」/.test(r.md), 'F9 该节带禁止改写的硬提示');
  bad = scanForbidden(r.md, r.j.items.map((x) => x.text));
  ok(bad.length === 0, `F10 大量缺口场景下 md 无禁用结论性表述（违规：${bad.join(' ｜ ')}）`);
  ok(r.j.warnings.some((w) => w.includes('未见对应材料')), 'F11 未见材料有 warning');
});

/* ==================== G. 材料不完整：不按已见完整材料对待 ==================== */
section('A', () => {
  r = run([...BASE, '--rules', RULES, '--materials', MATS], 'partial');
  const pe = r.j.partialEvidence;
  eq(pe.length, 1, 'G1 材料不完整 1 条');
  ok(pe[0].text.includes('技术档案'), 'G2 材料不完整项定位正确');
  eq(pe[0].statusCn, '材料不完整', 'G3 状态为「材料不完整」，未判为已见对应材料');
  ok(/缺页/.test(pe[0].statusNote), 'G4 说明中如实写出用户填报的不完整情形');
  ok(/不按已见完整材料对待/.test(pe[0].statusNote), 'G5 说明中写明不按已见完整材料对待');
  ok(pe[0].evidence.some((e) => e.incomplete === true), 'G6 材料条目上带 incomplete 标记');
  ok(r.j.warnings.some((w) => w.includes('自报完整性为')), 'G7 不完整材料有 warning 且指到行号');
  ok(/工作表「mats\.xlsx\/资料清单」第4行/.test(r.j.warnings.find((w) => w.includes('自报完整性为')) || ''), 'G8 warning 具体到工作表名与行号');
});

// 一条条款名下有齐备材料、也有不完整材料 → 仍判材料不完整，不被齐备的那份掩盖
section('A', () => {
  const MATS_MIX = mkx('mats-mix.xlsx', {
    '资料清单': [
      ['资料名称', '资料类型', '存放位置', '完整性说明'],
      ['车间设备台账2026.xlsx', '台账', '柜A-1', ''],
      ['车间设备台账补充册.xlsx', '台账', '柜A-2', '缺章，未经审批'],
    ],
  });
  r = run([...BASE, '--rules', RULES_ONE, '--materials', MATS_MIX], 'mix');
  eq(r.s.counts.partialEvidence, 1, 'G9 混合情形仍判「材料不完整」');
  eq(r.s.counts.hasEvidence, 0, 'G10 不因有一份齐备就判为已见对应材料');
  ok(/不因其余材料齐备而掩盖/.test(r.j.partialEvidence[0].statusNote), 'G11 说明写明不被齐备材料掩盖');
});

/* ==================== H. 不提供法律意见与法律责任分析 ==================== */
section('A', () => {
  r = run([...BASE, '--rules', RULES, '--materials', MATS], 'legal');
  ok(/不提供法律意见与法律责任分析/.test(r.md), 'H1 md 写明不提供法律意见与法律责任分析');
  ok(!/依据.{0,12}法.{0,8}(可能|将)(被|受到)/.test(r.md), 'H2 md 不出现法律后果推演');
  ok(!/处罚|罚款|责令停产|追究责任|行政处罚|刑事/.test(r.md), 'H3 md 不出现处罚与责任追究表述');
  ok(!/律师|法律建议|法律意见书/.test(r.md.replace(/不提供法律意见[^\n]*/g, '')), 'H4 md 不给出法律建议');
  ok(/不替代监管部门、内审与法务的正式判定/.test(r.md), 'H5 分析段占位写明不替代正式判定');
});

/* ==================== I. 声明行逐字保留 ==================== */
section('A', () => {
  const STATEMENT = '本对照为辅助自查，仅反映所提供材料与条款的对应情况，不构成合规达标结论与法律意见；正式判定以监管部门、内审或法务意见为准';
  ok(r.md.includes(STATEMENT), 'I1 声明行逐字出现在 md 中');
  eq(r.j.meta.statement, STATEMENT, 'I2 声明行写入 compliance.json 的 meta');
  ok(r.md.trimEnd().split('\n').slice(-12).join('\n').includes(STATEMENT) || r.md.includes(`> ${STATEMENT}`), 'I3 声明行以引用行形式写在正文末尾');
  const STATUS_NOTICE = '本表状态仅有「已见对应材料 / 未见对应材料 / 材料不完整 / 需进一步确认」四档';
  ok(r.md.includes(STATUS_NOTICE), 'I4 四档口径提示写在 md 开头');
  ok(r.md.indexOf(STATUS_NOTICE) < r.md.indexOf('## 一、'), 'I5 四档口径提示位置在第一节之前');
  eq(r.j.meta.statusNotice.startsWith(STATUS_NOTICE), true, 'I6 四档口径提示写入 meta');
});

/* ==================== J. 输入解析：md / 目录 / 合计行 / 别名 / 空行 ==================== */
section('B', () => {
  const RULES_MD = mkt('rules.md', [
    '# XX/T 9001（虚构）条款摘录', '',
    '第一条 使用单位应当建立设备管理制度，明确岗位职责。',
    '第二条 使用单位应当建立设备台账。',
    '第三条 使用单位应当开展设备隐患排查治理，建立隐患登记台账。', '',
  ].join('\n'));
  r = run([...BASE, '--rules', RULES_MD, '--materials', MATS], 'md');
  eq(r.s.ok, true, 'J1 Markdown 条款文本可解析');
  eq(r.s.counts.rules, 3, 'J2 按「第X条」解析出 3 条');
  ok(!r.j.items.some((x) => x.text.startsWith('#')), 'J3 md 标题行不被当作条款');
  eq(r.j.items[0].no, '第一条', 'J4 条款编号按原文保留');
  eq(r.s.counts.noEvidence, 1, 'J5 隐患排查条款仍为未见对应材料（不拿设备台账充数）');

  const RULES_NUM = mkt('rules-num.md', ['4.1 使用单位应当建立设备台账。', '4.2 应当开展日常巡检并保留巡检记录。'].join('\n'));
  r = run([...BASE, '--rules', RULES_NUM, '--materials', MATS], 'num');
  eq(r.s.counts.rules, 2, 'J6 「4.1」式条款编号可解析');
  eq(r.j.items[0].no, '4.1', 'J7 小数点条款编号保留原样');

  const MATDIR = path.join(work, 'matdir');
  fs.mkdirSync(path.join(MATDIR, '二级'), { recursive: true });
  fs.writeFileSync(path.join(MATDIR, '车间设备台账.xlsx'), 'x');
  fs.writeFileSync(path.join(MATDIR, '.隐藏台账.xlsx'), 'x');
  fs.writeFileSync(path.join(MATDIR, '二级', '巡检记录2026.xlsx'), 'x');
  r = run([...BASE, '--rules', RULES_NUM, '--materials', MATDIR], 'dir');
  eq(r.s.ok, true, 'J8 资料目录可递归扫描');
  eq(r.s.counts.materials, 2, 'J9 隐藏文件被跳过');
  ok(r.j.materials.some((m) => m.location === '二级/巡检记录2026.xlsx'), 'J10 子目录资料保留相对路径');

  const RULES_TOTAL = mkx('rules-total.xlsx', {
    '条款清单': [['某厂条款清单（虚构）'], [], ['条款编号', '条款原文'],
      ['第一条', '使用单位应当建立设备管理制度。'], ['第二条', '使用单位应当建立设备台账。'], ['合计', '']],
  });
  r = run([...BASE, '--rules', RULES_TOTAL, '--materials', MATS], 'total');
  eq(r.s.counts.rules, 2, 'J11 标题行表头识别 + 合计行跳过');
  ok(r.j.warnings.some((w) => w.includes('合计行')), 'J12 合计行有 warning');

  const RULES_ALIAS = mkx('rules-alias.xlsx', {
    '标准条款': [['条文编号', '条文内容', '管理要求'],
      ['第一条', '使用单位应当建立设备管理制度。', '建立制度'],
      ['第二条', '使用单位应当建立设备台账。', '建立台账']],
  });
  r = run([...BASE, '--rules', RULES_ALIAS, '--materials', MATS], 'alias');
  eq(r.s.ok, true, 'J13 别名表头与别名 sheet 名可识别');
  eq(r.s.counts.rules, 2, 'J14 别名解析出条款数正确');
});

section('C', () => {
  const RULES_EMPTY = mkx('rules-empty.xlsx', {
    '条款清单': [['条款编号', '条款原文'], ['第一条', '使用单位应当建立设备管理制度。'], ['第二条', '']],
  });
  r = run([...BASE, '--rules', RULES_EMPTY, '--materials', MATS], 'emptyrule');
  eq(r.s.counts.rules, 1, 'J15 条款原文为空的行被跳过');
  ok(r.j.warnings.some((w) => w.includes('条款原文为空')), 'J16 空条款有 warning');

  const MATS_EMPTY = mkx('mats-empty.xlsx', {
    '资料清单': [['资料名称', '资料类型'], ['车间设备台账.xlsx', '台账'], ['', '记录']],
  });
  r = run([...BASE, '--rules', RULES_ONE, '--materials', MATS_EMPTY], 'emptymat');
  eq(r.s.counts.materials, 1, 'J17 资料名称为空的行被跳过');
  ok(r.j.warnings.some((w) => w.includes('资料名称为空')), 'J18 空资料名有 warning');
});

/* ==================== K. 未对应材料不强行对应 ==================== */
section('A', () => {
  r = run([...BASE, '--rules', RULES, '--materials', MATS], 'unmatched');
  ok(r.j.unmatched.length >= 1, 'K1 未对应材料单列');
  ok(r.j.unmatched.every((x) => /未按名称猜测强行对应/.test(x.note)), 'K2 未对应材料注明不强行对应');
  ok(/未对应到条款的材料/.test(r.md), 'K3 未对应材料单列小节');
  ok(r.j.warnings.some((w) => w.includes('未对应到任何条款')), 'K4 未对应材料有 warning');
});

/* ==================== L. 参数校验 ==================== */
section('B', () => {
  x = raw(['--rules']);
  eq(x.s.ok, false, 'L1 --rules 缺值报错');
  ok(/缺少取值/.test(x.s.error), 'L2 缺值错误信息正确');
  eq(x.code, 1, 'L3 退出码为 1');
  x = raw(['--rules', RULES, '--workshop', '车间']);
  ok(/缺少 --materials/.test(x.s.error), 'L4 缺 --materials 报错');
  x = raw(['--rules', RULES, '--materials', MATS]);
  ok(/缺少 --workshop/.test(x.s.error), 'L5 缺 --workshop 报错');
  x = raw(['--rules', RULES, '--materials', MATS, '--workshop', '车间', '--未知参数', 'v']);
  eq(x.s.ok, false, 'L6 未知参数报错');
  x = raw(['--rules', RULES, '--materials', '/不存在目录', '--workshop', '车间']);
  ok(/本车间资料目录\/清单不存在/.test(x.s.error), 'L7 资料路径不存在报错');
  x = raw(['--rules', RULES, '--materials', MATS, '--workshop', '车间', '--date', '2026-13-45']);
  ok(/不是有效日期/.test(x.s.error), 'L8 非法日期报错');
  x = raw(['--rules', RULES, '--materials', MATS, '--workshop', '车间', '--internal', '/不存在制度.md']);
  ok(/厂内制度路径不存在/.test(x.s.error), 'L9 --internal 不存在报错');
  x = raw(['--rules', RULES, '--materials', MATS, '--workshop', '车间', '--last', '/不存在目录']);
  ok(/上次自查结果不存在/.test(x.s.error), 'L10 --last 不存在报错');
  const NO_SHEET = mkx('nosheet.xlsx', { '别的表': [['a', 'b'], [1, 2]] });
  x = raw(['--rules', NO_SHEET, '--materials', MATS, '--workshop', '车间']);
  ok(/未找到「条款清单」/.test(x.s.error), 'L11 条款清单无可识别工作表报错');
  x = raw(['--rules', RULES, '--materials', NO_SHEET, '--workshop', '车间']);
  ok(/未找到「资料清单」/.test(x.s.error), 'L12 资料清单无可识别工作表报错');
  x = raw(['--rules', mkt('rules.pdf', 'x'), '--materials', MATS, '--workshop', '车间']);
  ok(/不支持的格式/.test(x.s.error), 'L13 不支持的条款格式报错');
  ok(/平台 pdf 技能/.test(x.s.error) && /txt\/docx/.test(x.s.error) && /OCR/.test(x.s.error), 'L14 传入 .pdf 时提示统一前置步骤（平台 pdf 技能转 txt/docx，扫描件 OCR）');
  ok(/不得凭记忆补充条款/.test(x.s.error), 'L14b pdf 报错同时重申不得凭记忆补条款');
});

// 未提供 --date 不中断，按未指定处理
section('B', () => {
  r = run(['--rules', RULES, '--materials', MATS, '--workshop', '车间'], 'nodate');
  eq(r.s.ok, true, 'L15 未提供 --date 仍可运行');
  eq(r.s.date, null, 'L16 未提供 --date 时 date 为 null，不填当天');
  ok(r.j.warnings.some((w) => w.includes('自查时点')), 'L17 未提供 --date 有 warning');
  ok(/—（未指定）/.test(r.md), 'L18 md 自查时点写「未指定」而非默认日期');
});

/* ==================== M. --internal 厂内制度并入对照 ==================== */
section('B', () => {
  const INTERNAL = mkx('internal.xlsx', {
    '制度清单': [['资料名称', '资料类型', '存放位置'],
      ['厂压力容器定期检验管理规定.docx', '制度', '厂办-1']],
  });
  r = run([...BASE, '--rules', RULES, '--materials', MATS, '--internal', INTERNAL], 'internal');
  eq(r.s.ok, true, 'M1 --internal 可用');
  eq(r.s.counts.materials, 5, 'M2 厂内制度并入资料总数');
  ok(r.j.materials.some((m) => m.scopeLabel === '厂内制度'), 'M3 厂内制度带归属标记');
  eq(r.s.counts.noEvidence, 0, 'M4 厂内制度补上了定期检验条款的对应材料');
  ok(r.j.items.find((i) => i.no === '第三条').evidence.some((e) => e.scopeLabel === '厂内制度'), 'M5 对应材料标明来自厂内制度');
});

/* ==================== N. 正反对照：条款全部已见材料时的表述 ==================== */
section('A', () => {
  r = run([...BASE, '--rules', RULES_SMALL, '--materials', MATS_OK], 'clean');
  eq(r.s.counts.hasEvidence, 2, 'N1 两条均已见对应材料');
  eq(r.s.counts.noEvidence, 0, 'N2 无未见对应材料');
  eq(r.s.counts.needInterpretation, 0, 'N3 无需进一步确认');
  ok(/_所提供材料中，各条款均已见对应材料且未填报不完整情形。_/.test(r.md), 'N4 第三节写明「无」');
  ok(r.j.hasEvidence.every((x) => /材料内容是否满足条款要求需人工核对，本技能不作判定/.test(x.statusNote)), 'N5 已见材料也不代表判定内容达到要求');
  bad = scanForbidden(r.md, r.j.items.map((x) => x.text));
  ok(bad.length === 0, `N6 全部已见材料时 md 仍无「符合」式结论（违规：${bad.join(' ｜ ')}）`);
  ok(!/全部符合|均符合|整体符合/.test(r.md), 'N7 不出现「全部符合」式总结');
});

/* ==================== O. 产出结构完整性 ==================== */
section('BVT', () => {
  r = run([...BASE, '--rules', RULES, '--materials', MATS, '--scope', '设备管理专业'], 'struct');
  ok(/## 一、自查范围与条款来源/.test(r.md) && /## 二、逐条款对照/.test(r.md)
    && /## 三、未见对应材料与材料不完整的条款/.test(r.md) && /## 四、需进一步确认的条款/.test(r.md)
    && /## 五、跟进事项与未对应材料/.test(r.md), 'O1 五节结构齐全');
  ok(/<!-- ANALYSIS_START -->/.test(r.md) && /<!-- ANALYSIS_END -->/.test(r.md), 'O2 分析段占位符存在');
  ok(r.j.items.every((x) => 'no' in x && 'text' in x && 'requirement' in x && 'evidence' in x && 'status' in x && 'statusCn' in x), 'O3 items 字段齐全（条款编号、原文、应做事项、对应资料、状态）');
  ok(Array.isArray(r.j.hasEvidence) && Array.isArray(r.j.noEvidence) && Array.isArray(r.j.partialEvidence) && Array.isArray(r.j.needInterpretation), 'O4 四类清单均为数组');
  eq(r.j.meta.scope, '设备管理专业', 'O5 自查范围写入 meta');
  eq(r.j.meta.workshop, '测试车间', 'O6 车间名写入 meta');
  const sj = JSON.parse(fs.readFileSync(path.join(r.out, 'summary.json'), 'utf8'));
  eq(sj.ok, true, 'O7 summary.json 内容正确');
  eq(sj.counts.noEvidence, r.j.counts.noEvidence, 'O8 summary 与 compliance.json 计数一致');
  ok(/法规标准符合性自查对照表/.test(r.md.split('\n')[0]), 'O9 md 标题正确');
  ok(r.j.items.every((x) => x.src), 'O10 每条条款都带出处，可追溯到来源行');
});

/* ==================== P. 中石化口径：声明补充句 / 企业制度说明 / 无 emoji / 别名合并 ==================== */
section('A', () => {
  r = run([...BASE, '--rules', RULES, '--materials', MATS], 'p-base');
  ok(r.md.includes(FILL), 'P1 md 末尾含声明补充句（最终结论由自查责任人填写）');
  ok(r.md.indexOf(FILL) > r.md.indexOf(r.j.meta.statement), 'P2 补充句位于原声明行之后');
  eq(r.j.meta.statementFill, FILL, 'P3 compliance.json meta.statementFill 写入补充句');
});
section('C', () => {
  ok(/企业制度/.test(r.md) && /--rules \/ --internal/.test(r.md) && /条款原文由用户提供/.test(r.md), 'P4 md 写明企业制度同样走 --rules/--internal、条款原文由用户提供');
  ok(typeof r.j.meta.internalNotice === 'string' && /中国石化设备管理规定/.test(r.j.meta.internalNotice), 'P5 meta.internalNotice 点名集团制度同一口径');
  ok(!/[⚠✅❌✔✗]/.test(r.md), 'P6 产出 md 不含 emoji');
  ok(/【注意】有 1 条条款要求笼统/.test(r.md), 'P7 笼统条款提示用「【注意】」');
  ok(/【注意】未见对应材料 1 条/.test(r.md), 'P8 未见材料提示用「【注意】」');
  ok(!/厂设备处|机动处|厂部/.test(r.md), 'P9 md 不出现旧称「厂设备处/机动处/厂部」');
});
section('A', () => {
  bad = scanForbidden(r.md, RULE_TEXTS);
  ok(bad.length === 0, `P10 加入补充句后 md 仍无结论性表述违规（违规：${bad.join(' ｜ ')}）`);
});
section('B', () => {
  const wbP = readXlsx(path.join(r.out, '对照表.xlsx'));
  ok(wbP['状态口径与声明'].some((row) => String(row[0]) === FILL), 'P11 对照表.xlsx 声明页含补充句');
});
section('C', () => {
  // 全部已见材料时不出现【注意】（不出现方向）
  r = run([...BASE, '--rules', RULES_SMALL, '--materials', MATS_OK], 'p-clean');
  ok(!/【注意】/.test(r.md), 'P12 无笼统条款且无缺口时 md 不出现「【注意】」');
  ok(r.md.includes(FILL), 'P13 无缺口时声明补充句仍保留');
});
section('B', () => {
  // 别名合并：「制度名称」「制度」识别为标准名称列；mergeAliases 后局部别名仍优先
  const RULES_INST = mkx('rules-inst.xlsx', {
    '条款清单': [
      ['编号', '条款内容', '制度名称'],
      ['5.1', '使用单位应当建立设备台账。', 'Q/XX-虚构-001 设备管理规定（虚构）'],
      ['5.2', '使用单位应当建立设备管理制度。', 'Q/XX-虚构-001 设备管理规定（虚构）'],
    ],
  });
  r = run([...BASE, '--rules', RULES_INST, '--materials', MATS], 'p-inst');
  eq(r.s.ok, true, 'P14 企业制度条款清单（制度名称列）可读');
  eq(r.j.items[0].source, 'Q/XX-虚构-001 设备管理规定（虚构）', 'P15 「制度名称」列归入标准名称（来源标签）');
  eq(r.j.items[0].no, '5.1', 'P16 「编号」列仍归条款编号（局部别名优先）');
  eq(r.s.counts.hasEvidence, 2, 'P17 企业制度条款与法规条款同一对照口径（台账、制度均已见）');
  const MATS_SYS = mkx('mats-sys.xlsx', {
    '资料清单': [
      ['文件名称', '存放位置', '类别', '说明'],
      ['车间设备台账2026.xlsx', '柜A-2', '台账', ''],
    ],
  });
  r = run([...BASE, '--rules', RULES_INST, '--materials', MATS_SYS], 'p-sys');
  eq(r.s.counts.materials, 1, 'P18 资料清单「文件名称/类别/说明」别名列头可读');
  eq(r.s.counts.hasEvidence, 1, 'P19 别名列头下对照结果正确（台账已见、制度未见）');
});

/* ==================== Q. 缺陷修复（2026-11-03 全量核验 #8）：系统导出文件名别名 + 资料类型列 ==================== */
section('C', () => {
  // Q1~Q9 文件名别名：只认正面命中的说法，名称里没有的类别不推断
  ok(S.fileCategories('故障记录.csv').includes('maintenance'), 'Q1 「故障记录」（EAM 导出，含处理措施）归入检修与维护保养记录');
  ok(S.fileCategories('故障记录.csv').includes('defect'), 'Q2 「故障记录」仍归入缺陷与故障类');
  ok(S.fileCategories('通知单.csv').includes('defect'), 'Q3 「通知单」（SAP PM 维修通知单）归入缺陷与故障类');
  ok(S.fileCategories('作业清单.csv').includes('permit'), 'Q4 「作业清单」（作业票系统导出）归入作业票与作业许可');
  ok(!S.fileCategories('停电通知单.docx').includes('defect'), 'Q5 反例：「停电通知单」不归缺陷与故障类');
  ok(!S.fileCategories('检修作业清单.xlsx').includes('permit'), 'Q6 反例：「检修作业清单」不归作业许可');
  eq(S.fileCategories('班组考勤统计表.xlsx').length, 0, 'Q7 反例：无关资料仍归不进任何类别');
  ok(!S.fileCategories('设备故障率统计.xlsx').includes('maintenance'), 'Q8 反例：只带「故障」二字不算检修记录');
  ok(!S.fileCategories('通知单.csv').includes('maintenance'), 'Q9 反例：「通知单」是报修，不算检修记录');
  // Q10~Q12 资料类型列：先读资料类型，命中具体类别即记来源「资料类型」；泛称（台账/记录）不推断
  const mc = (n, t) => (typeof S.materialCategories === 'function' ? S.materialCategories(n, t) : { keys: [], from: {} });
  ok(mc('PM导出01.csv', '检修记录').keys.includes('maintenance') && mc('PM导出01.csv', '检修记录').from.maintenance === '资料类型', 'Q10 资料类型「检修记录」归入检修类，来源记「资料类型」');
  ok(mc('故障记录.csv', '记录').from.maintenance === '资料名称', 'Q11 资料类型为泛称「记录」时按资料名称归类，来源记「资料名称」');
  eq(mc('导出01.csv', '台账').keys.length, 0, 'Q12 资料名称与资料类型都只有泛称时归不进任何类别');
});
section('B', () => {
  // Q13~Q20 端到端：MCP 导出目录（只有文件名）与资料清单（带资料类型列）
  const RULES_MCP = mkx('rules-mcp.xlsx', {
    '条款清单': [['条款编号', '条款原文', '应做事项'],
      ['第七条', '应当按计划组织设备检修，并保留检修记录。', '保留检修记录'],
      ['第八条', '应当开展隐患排查治理，建立隐患登记与治理台账。', '建立隐患台账'],
      ['第九条', '用火、受限空间等特殊作业应当办理作业许可。', '办理作业许可'],
      ['第十条', '设备缺陷应当及时登记报修，跟踪处理至消缺。', '缺陷登记报修']],
  });
  const MCP_DIR = path.join(work, 'mcp-export');
  fs.mkdirSync(MCP_DIR, { recursive: true });
  for (const n of ['故障记录', '通知单', '作业清单', '隐患台账']) fs.writeFileSync(path.join(MCP_DIR, `${n}.csv`), '﻿"位号"\r\n"P-01"\r\n', 'utf8');
  r = run([...BASE, '--rules', RULES_MCP, '--materials', MCP_DIR], 'q-mcp');
  const qi = (no) => r.j.items.find((i) => i.no === no) || { evidence: [] };
  eq(qi('第七条').status, 'hasEvidence', 'Q13 MCP 导出「故障记录.csv」作为检修记录，第七条已见对应材料');
  ok(qi('第七条').evidence.some((e) => e.name === '故障记录.csv' && e.basis === 'category:maintenance'), 'Q14 第七条对应依据为检修类别');
  ok(qi('第八条').evidence.some((e) => e.name === '隐患台账.csv') && !qi('第八条').evidence.some((e) => /通知单|故障记录/.test(e.name)), 'Q15 隐患排查治理条款只认隐患台账，通知单、故障记录不充数');
  ok(qi('第十条').evidence.some((e) => e.name === '通知单.csv' && e.basis === 'category:defect'), 'Q15b 「通知单.csv」对应到设备缺陷条款');
  ok(!S.fileCategories('隐患台账.csv').includes('defect') && !S.fileCategories('故障记录.csv').includes('hazard'), 'Q15c 隐患台账与故障记录分属两类');
  ok(qi('第九条').evidence.some((e) => e.name === '作业清单.csv' && e.basis === 'category:permit'), 'Q16 「作业清单.csv」对应到作业许可条款');
  eq(r.s.counts.unmatched, 0, 'Q17 通知单、作业清单不再落入未对应材料');
  ok(r.j.materials.every((m) => Array.isArray(m.categories) && m.categoryFrom && typeof m.categoryFrom === 'object'), 'Q18 materials 逐份带归类结果与来源');
  const MATS_TYPE = mkx('mats-type.xlsx', {
    '资料清单': [['资料名称', '资料类型', '存放位置'],
      ['PM导出01.csv', '检修记录', 'EAM导出'],
      ['导出02.csv', '台账', 'EAM导出']],
  });
  r = run([...BASE, '--rules', RULES_MCP, '--materials', MATS_TYPE], 'q-type');
  eq((r.j.items.find((i) => i.no === '第七条') || {}).status, 'hasEvidence', 'Q19 资料名称认不出、资料类型填「检修记录」时第七条已见对应材料');
  ok(r.j.unmatched.some((u) => u.name === '导出02.csv'), 'Q20 资料类型只填泛称「台账」时不推断，列入未对应材料');
});

/* ==================== R. 中石化口径「用火作业」：permit 类与「动火」并列识别 ==================== */
section('C', () => {
  ok(S.ruleCategories('用火作业前应进行气体分析，用火监护人全程在场。').includes('permit'), 'R1 条款只写「用火」（未写作业票/作业许可）也归作业票与作业许可');
  ok(S.fileCategories('2026年用火监护记录.xlsx').includes('permit'), 'R2 资料名称「用火监护记录」归作业票与作业许可');
  ok(S.ruleCategories('动火作业应当办理动火作业票。').includes('permit'), 'R3 旧写法「动火」仍可识别');
  // 「用火」子串不误伤「备用火炬 / 备用火嘴 / 使用火炬」
  ok(!S.fileCategories('备用火炬运行记录.xlsx').includes('permit'), 'R4 「备用火炬运行记录」不归作业票与作业许可');
  ok(!S.ruleCategories('企业应当使用火炬系统处理事故排放气。').includes('permit'), 'R5 「使用火炬」条款不归作业票与作业许可');
  ok(!S.fileCategories('加热炉备用火嘴更换记录.xlsx').includes('permit'), 'R6 「备用火嘴」不归作业票与作业许可');
  ok(S.fileCategories('用火作业票台账.xlsx').includes('permit') && S.ruleCategories('用火票须经属地单位审批。').includes('permit'), 'R7 「用火作业票」「用火票」仍归作业票与作业许可');
});

/* ==================== 输出 ==================== */
console.log(`\n${'='.repeat(60)}`);
console.log(`regulation-compliance-check 自测：${pass} 通过，${fail} 失败`);
console.log(`用例级别 ${LEVELS[RUN_LEVEL]}：BVT ${byLevel.BVT}，A ${byLevel.A}，B ${byLevel.B}，C ${byLevel.C}`);
if (failures.length) { console.log('\n失败项：'); failures.forEach((f) => console.log('  ✗ ' + f)); }
console.log('='.repeat(60));
try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
