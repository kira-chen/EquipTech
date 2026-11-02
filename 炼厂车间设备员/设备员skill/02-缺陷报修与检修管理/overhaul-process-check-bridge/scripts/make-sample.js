#!/usr/bin/env node
'use strict';
/**
 * 生成本 bridge 的回归样例（可再生）。用法：node scripts/make-sample.js --out <dir> [--seed <n>]
 * 产出（均为虚构，仅示范 overhaul-safety-check 的 result.json 结构与车间侧 notes.json 格式）：
 *   sample-overhaul-result.json                  源技能结果：恒 3 缺失 / 2 建议完善 / 1 未判定（UND-动火 聚合）/ 4 已有
 *   sample-overhaul-result-summary-mismatch.json 源技能 summary 与 findings 计数故意不一致（must_fix 写 5）→ 只 warning 不改源数据
 *   sample-workshop-notes.json                   车间侧提示：已核实 / 未核实 / 不适用 / 已核实
 *   sample-workshop-notes-bad.json               状态写「应该够了」+ 一条自定义项 → 按未核实处理并 warning
 *   sample-overhaul-plan.docx                    依赖技能 examples 中的泵检修方案样例副本（找得到依赖技能时才复制）
 * seed 只改变方案编号尾号、工期与人名，不改变上述计数结论。
 */
const fs = require('fs');
const path = require('path');
const C = require('./lib/common');

const a = C.parseArgs(process.argv.slice(2), ['out', 'seed'], []);
const out = a.out || path.join(__dirname, '..', 'examples');
const seed = a.seed ? Number(a.seed) : 1;
let s = seed * 7919 + 13;
const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const no2 = () => String(10 + Math.floor(rnd() * 80));
const NAMES = ['张', '李', '王', '赵', '刘'];
const pick = (arr) => arr[Math.floor(rnd() * arr.length) % arr.length];

fs.mkdirSync(out, { recursive: true });
const warnings = [];

const planNo = `JX-E1201-2026-${no2()}`;
const duration = 4 + Math.floor(rnd() * 4); // 4~7 天
const DISCLAIMER = '本结果为辅助核查，不替代检修方案审批；依据条款按记忆整理，以 GB 30871-2022 正式文本与企业制度为准。';

const findings = [
  { rule_id: 'G-003', severity: 'must_fix', name: '风险辨识与 JSA', message: '方案未写明作业前风险辨识 / JSA 分析', detail: 'measures.risk_assessment 为空（方案未写明）', advice: '补一节「作业风险分析（JSA）」，列出各作业步骤的危害与控制措施，并写明交底人与交底时间', basis: '企业检修管理制度（通行做法，待核实）', jobs: [] },
  { rule_id: 'HW-002', severity: 'must_fix', name: '动火点周围可燃物清理与隔离', message: '方案未写明动火点周围可燃物清理、隔离及动火分析要求', detail: 'measures.hot_work_isolation 为空', advice: '写明动火前清理可燃物范围、隔离措施、动火分析时机与合格标准（具体数值按制度）', basis: 'GB 30871-2022 动火作业章节', jobs: ['E-1201 法兰补焊'] },
  { rule_id: 'BP-001', severity: 'must_fix', name: '盲板抽堵清单与盲板图', message: '方案涉及加/拆盲板但未附盲板清单或盲板图', detail: 'attachments.blind_plate_list 为空', advice: '附盲板清单（编号、位置、规格、材质）与盲板图，并写明抽堵作业票办理要求', basis: 'GB 30871-2022 盲板抽堵作业章节', jobs: ['E-1201 进出口加盲板'] },
  { rule_id: 'G-012', severity: 'should_improve', name: '应急处置', message: '应急措施只写「按预案执行」，未写明本项目应急联系人与集合点', detail: `measures.emergency：「按装置应急预案执行」（${pick(NAMES)}某为应急联系人未写入）`, advice: '补充本项目应急联系人、电话、集合点与撤离路线', basis: '企业检修管理制度（通行做法，待核实）', jobs: [] },
  { rule_id: 'CO-002', severity: 'should_improve', name: '承包商安全协议', message: '方案未写明与承修单位签订安全协议', detail: 'measures.contractor_agreement 为空', advice: '写明安全协议签订情况或说明自行检修不适用', basis: '《中国石化承包商安全管理规定》（条款号待核实）', jobs: [] },
  { rule_id: 'UND-高处', severity: 'undetermined', name: '「高处」专项规则未判定', message: '无法判定：存在未标注作业类型的作业，无法确认是否触发「高处」专项核查', detail: '作业 空冷器管束顶部检查 未标注作业类型；涉及规则：HP-001、HP-002、HP-003（同一作业类型的未判定聚合为一条计数）', advice: '为上述作业补标作业类型后重新核查', basis: '见涉及规则各自的依据（checklist.json）', jobs: [] },
  { rule_id: 'G-001', severity: 'pass', name: '方案基本信息', message: '通过：装置、项目、工期已填写', detail: `已填写：工期 ${duration} 天`, advice: null, basis: '本技能约定', jobs: [] },
  { rule_id: 'G-005', severity: 'pass', name: '安全交底', message: '通过：方案写明开工前安全技术交底', detail: '已写明：开工前由项目负责人组织全员交底并签字', advice: null, basis: '企业检修管理制度', jobs: [] },
  { rule_id: 'G-008', severity: 'pass', name: '现场负责人与安全员', message: '通过：现场负责人与安全员已指定', detail: `已填写：${pick(NAMES)}某 / ${pick(NAMES)}某`, advice: null, basis: '本技能约定', jobs: [] },
  { rule_id: 'TE-001', severity: 'pass', name: '临时用电接线与漏电保护', message: '通过：临时用电措施已写明', detail: '已写明：由持证电工接线，配漏电保护，一机一闸', advice: null, basis: 'GB 30871-2022 临时用电作业章节', jobs: ['检修临时电源接引'] },
];
const summary = { must_fix: 3, should_improve: 2, undetermined: 1, pass: 4 };
const base = {
  plan_no: planNo, unit: '常减压装置（原油换热器 E-1201）', project: 'E-1201 抽管束清洗及法兰补焊检修方案',
  contractor: `检修公司第${pick(['一', '二', '三'])}工程部`, duration_days: duration, jobs_count: 4,
  job_types: ['动火', '盲板抽堵', '临时用电'],
  summary, skipped: 41, findings,
  extraction_notes: ['jobs[2].job_types：方案「空冷器管束顶部检查」未写作业类型 → 填 null', 'measures.risk_assessment：方案无风险分析章节 → 填 null'],
  disclaimer: DISCLAIMER,
};
fs.writeFileSync(path.join(out, 'sample-overhaul-result.json'), JSON.stringify(base, null, 2), 'utf8');

const mismatch = JSON.parse(JSON.stringify(base));
mismatch.summary = { must_fix: 5, should_improve: 2, undetermined: 1, pass: 4 };
fs.writeFileSync(path.join(out, 'sample-overhaul-result-summary-mismatch.json'), JSON.stringify(mismatch, null, 2), 'utf8');

fs.writeFileSync(path.join(out, 'sample-workshop-notes.json'), JSON.stringify([
  { item: '设备交出条件', status: '已核实', note: `交出清单已按 equipment-handover-check 生成，${C.localDate()} 工艺、设备、安全三方已确认` },
  { item: '同期交叉作业', status: '未核实', note: '' },
  { item: '承包商资质', status: '不适用', note: '本厂机修车间自行检修，不涉及外委' },
  { item: '备件与工机具到位', status: '已核实', note: '法兰垫片、螺栓已领用，试压泵已到位' },
], null, 2), 'utf8');

fs.writeFileSync(path.join(out, 'sample-workshop-notes-bad.json'), JSON.stringify([
  { item: '设备交出条件', status: '应该够了', note: '班长说明天能交' },
  { item: '同期交叉作业', status: '已核实', note: '同期无其他方案施工' },
  { item: '脚手架方案', status: '已核实', note: '脚手架方案已另行审批（车间自查项）' },
], null, 2), 'utf8');

// 依赖技能的检修方案 docx 样例副本：找得到才复制，找不到只提示
const depDocx = 'pump-repair.docx';
const cands = [];
if (process.env.SKILL_PACK_ROOT) cands.push(path.join(process.env.SKILL_PACK_ROOT, '【炼化】检修方案安全措施核查', 'overhaul-safety-check', 'examples', depDocx));
cands.push(path.resolve(__dirname, '..', '..', '..', '..', '..', 'skill-pack-local', '【炼化】检修方案安全措施核查', 'overhaul-safety-check', 'examples', depDocx));
const hit = cands.find((p) => fs.existsSync(p));
if (hit) fs.copyFileSync(hit, path.join(out, 'sample-overhaul-plan.docx'));
else warnings.push(`未找到依赖技能样例 ${depDocx}，未生成 sample-overhaul-plan.docx（不影响其它样例）`);

console.log(JSON.stringify({
  ok: true, out, seed, planNo,
  files: fs.readdirSync(out).filter((f) => /\.(json|docx)$/.test(f)),
  warnings,
}));
