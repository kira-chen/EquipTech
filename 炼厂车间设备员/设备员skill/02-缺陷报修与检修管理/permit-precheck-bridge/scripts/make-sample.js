#!/usr/bin/env node
'use strict';
/**
 * 生成本 bridge 的回归样例（可再生）。用法：node scripts/make-sample.js --out <dir> [--seed <n>]
 * 产出（均为虚构，仅示范 work-permit-precheck 的 result.json 结构与车间侧 notes.json 格式）：
 *   sample-permit-result.json                  源技能结果：恒 3 必须整改 / 2 建议完善 / 1 未判定 / 4 通过，type=动火（票面原词）
 *   sample-permit-result-summary-mismatch.json 源技能 summary 与 findings 计数故意不一致（should_improve 写 5）→ 只 warning 不改源数据
 *   sample-permit-result-unknown-type.json     type 写「射线探伤」（不在八大类）→ warning，type 原值照搬
 *   sample-workshop-notes.json                 车间侧提示：已核实 / 未核实 / 不适用 各 1 项
 *   sample-workshop-notes-bad.json             车间侧提示状态写「大概没问题」+ 一条自定义项 → 按未核实处理并 warning
 *   sample-hotwork-permit.docx                 依赖技能 examples 中的用火（动火）票样例副本（找得到依赖技能时才复制）
 * seed 只改变票号尾号、时间与人名，不改变上述计数结论。
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const C = require('./lib/common');

const a = C.parseArgs(process.argv.slice(2), ['out', 'seed'], []);
// 默认输出到演示样例目录：仓库内在 炼厂车间设备员/演示case/<分类>/<技能>/，开发包内在技能目录 examples/
const skillsRoot = path.resolve(__dirname, '../../..');
const caseDir = path.basename(skillsRoot) === '设备员skill' ? path.join(skillsRoot, '..', '演示case', path.relative(skillsRoot, path.resolve(__dirname, '..'))) : path.join(__dirname, '..', 'examples');
const out = a.out || caseDir;
const seed = a.seed ? Number(a.seed) : 1;
let s = seed * 7919 + 13;
const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const no3 = () => String(100 + Math.floor(rnd() * 800));
const NAMES = ['张', '李', '王', '赵', '刘'];
const pick = (arr) => arr[Math.floor(rnd() * arr.length) % arr.length];

fs.mkdirSync(out, { recursive: true });
const warnings = [];

const permitNo = `DH-2026-0826-${no3()}`;
const hours = 9 + Math.floor(rnd() * 3);   // 9~11h，恒超过 8h
const minutes = 40 + Math.floor(rnd() * 30); // 40~69 分钟，恒超过 30 分钟
const DISCLAIMER = '本结果为辅助预检，不替代作业票审批；条款号以 GB 30871-2022 正式文本为准。';

const findings = [
  { rule_id: 'G-011', severity: 'must_fix', message: '监护人未指定/未签字', detail: 'guardian 为空/null', basis: 'GB 30871-2022 第4章 通用要求（特殊作业应设专人监护）', rule_type: 'required', check_name: '监护人已指定' },
  { rule_id: 'HW-012', severity: 'must_fix', message: '特级/一级动火作业票有效期超过 8h', detail: `有效期 ${hours}.0h，超过 8h`, basis: 'GB 30871-2022 第5章 动火作业（特级、一级动火票有效期不超过 8h）', rule_type: 'duration_max', check_name: '特级/一级有效期 ≤8h' },
  { rule_id: 'HW-019', severity: 'must_fix', message: '受限空间内动火，未关联受限空间作业票', detail: 'cross_jobs 中无 受限空间 作业票', basis: 'GB 30871-2022 第4章 通用要求（涉及多种特殊作业应同时办理相应作业票）', rule_type: 'cross_permit', check_name: '受限空间内动火已关联受限空间票' },
  { rule_id: 'G-019', severity: 'should_improve', message: '监护人资质/培训合格证未填写', detail: 'guardian_cert 为空', basis: '通行做法（待核实）：监护人应经培训合格', rule_type: 'required', check_name: '监护人资质已填写' },
  { rule_id: 'HW-006', severity: 'should_improve', message: `气体分析距计划开工超过 30 分钟（${minutes} 分钟）`, detail: `最近一次分析 ${minutes} 分钟前`, basis: 'GB 30871-2022 第5章 动火作业（动火前 30 分钟内取样分析）', rule_type: 'time_window', check_name: '气体分析时效' },
  { rule_id: 'HW-003', severity: 'undetermined', message: '无法判定：动火点是否在受限空间内', detail: '依赖字段 in_confined_space 为空', basis: 'GB 30871-2022 第5章 动火作业', rule_type: 'conditional', check_name: '受限空间内动火判定' },
  { rule_id: 'G-001', severity: 'pass', message: '通过：作业票编号已填写', detail: `已填写：${permitNo}`, basis: '通行做法', rule_type: 'required', check_name: '票号已填写' },
  { rule_id: 'G-002', severity: 'pass', message: '通过：作业类型已填写', detail: '已填写：动火', basis: 'GB 30871-2022 第4章 通用要求', rule_type: 'enum', check_name: '作业类型' },
  { rule_id: 'HW-001', severity: 'pass', message: '通过：动火级别已填写', detail: '已填写：一级', basis: 'GB 30871-2022 第5章 动火作业', rule_type: 'enum', check_name: '动火级别' },
  { rule_id: 'G-021', severity: 'pass', message: '通过：作业负责人已签字', detail: `已填写：${pick(NAMES)}某`, basis: 'GB 30871-2022 第4章 通用要求', rule_type: 'required', check_name: '作业负责人签字' },
];
const summary = { must_fix: 3, should_improve: 2, undetermined: 1, pass: 4 };
const base = {
  permit_no: permitNo, type: '动火', level: '一级', now: '2026-08-26 08:50（北京时间）',
  summary, skipped: 85, findings,
  extraction_notes: ['in_confined_space：票面「动火点是否在受限空间内」栏留白 → 填 null', `guardian：监护人签字栏空白 → 填 null（${pick(NAMES)}某口头告知但未签字）`],
  disclaimer: DISCLAIMER,
};
fs.writeFileSync(path.join(out, 'sample-permit-result.json'), JSON.stringify(base, null, 2), 'utf8');

const mismatch = JSON.parse(JSON.stringify(base));
mismatch.summary = { must_fix: 3, should_improve: 5, undetermined: 1, pass: 4 };
fs.writeFileSync(path.join(out, 'sample-permit-result-summary-mismatch.json'), JSON.stringify(mismatch, null, 2), 'utf8');

const unknownType = JSON.parse(JSON.stringify(base));
unknownType.type = '射线探伤';
unknownType.permit_no = `RT-2026-0826-${no3()}`;
fs.writeFileSync(path.join(out, 'sample-permit-result-unknown-type.json'), JSON.stringify(unknownType, null, 2), 'utf8');

fs.writeFileSync(path.join(out, 'sample-workshop-notes.json'), JSON.stringify([
  { item: '设备交出条件', status: '已核实', note: `设备交出单 ${C.localDate()} 四方已签字，盲板 3 块已挂牌（equipment-handover-check 产出）` },
  { item: '同区域交叉作业', status: '未核实', note: '' },
  { item: '承包商资质', status: '不适用', note: '本厂机修车间自行施工，不涉及承包商' },
], null, 2), 'utf8');

fs.writeFileSync(path.join(out, 'sample-workshop-notes-bad.json'), JSON.stringify([
  { item: '设备交出条件', status: '大概没问题', note: '班长口头说交出了' },
  { item: '同区域交叉作业', status: '已核实', note: '同时段无其他作业票' },
  { item: '脚手架验收牌', status: '已核实', note: '脚手架验收牌已挂（车间自查项）' },
], null, 2), 'utf8');

// 依赖技能的用火（动火）票样例副本：找得到才复制，找不到只提示
const depDocx = 'hotwork-level1-with-issues.docx';
const cands = [];
// 依赖技能位置与 check-dependency.js 同一套查找规则
const dep = spawnSync(process.execPath, [path.join(__dirname, 'check-dependency.js')], { encoding: 'utf8' });
let depRoot = null;
try { const j = JSON.parse(dep.stdout.trim().split('\n').pop()); if (j.available) depRoot = j.root; } catch (e) { /* 找不到依赖时只提示 */ }
if (depRoot) cands.push(path.join(depRoot, 'examples', depDocx));
const hit = cands.find((p) => fs.existsSync(p));
if (hit) fs.copyFileSync(hit, path.join(out, 'sample-hotwork-permit.docx'));
else warnings.push(`未找到依赖技能样例 ${depDocx}，未生成 sample-hotwork-permit.docx（不影响其它样例）`);

console.log(JSON.stringify({
  ok: true, out, seed, permitNo,
  files: fs.readdirSync(out).filter((f) => /\.(json|docx)$/.test(f)),
  warnings,
}));
