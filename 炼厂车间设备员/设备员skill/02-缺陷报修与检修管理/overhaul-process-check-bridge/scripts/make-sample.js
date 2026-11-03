#!/usr/bin/env node
'use strict';
/**
 * 生成本 bridge 的回归样例（可再生）。用法：node scripts/make-sample.js --out <dir> [--seed <n>]
 * 产出（均为虚构）：
 *   sample-overhaul-plan.json                    源技能输入 plan.json（E-1201 换热器检修方案，按 overhaul-safety-check 的 plan-schema 填写）
 *   sample-overhaul-result.json                  **依赖技能 check.js 对上面 plan.json 的真实输出**（不手写，规则号与规则库同源）：
 *                                                恒 3 缺失 / 5 建议完善 / 9 未判定（未标注作业按作业类型聚合）/ 36 已有
 *   sample-overhaul-result-summary-mismatch.json 源技能 summary 与 findings 计数故意不一致（must_fix 写 5）→ 只 warning 不改源数据
 *   sample-workshop-notes.json                   车间侧提示：已核实 / 未核实 / 不适用 / 已核实
 *   sample-workshop-notes-bad.json               状态写「应该够了」+ 一条自定义项 → 按未核实处理并 warning
 *   sample-overhaul-plan.docx                    依赖技能 examples 中的泵检修方案样例副本（演示 docx2text 一步）
 * seed 只改变方案编号尾号、工期、承修单位与人名，不改变上述计数结论。
 * 依赖技能找不到时无法生成真实 result.json，末行 ok:false 并退出 1（不手写替代品）。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const C = require('./lib/common');

const warnings = [];

function main() {
  const a = C.parseArgs(process.argv.slice(2), ['out', 'seed'], []);
  const out = a.out || path.join(__dirname, '..', 'examples');
  const seed = a.seed ? Number(a.seed) : 1;
  let s = seed * 7919 + 13;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const no2 = () => String(10 + Math.floor(rnd() * 80));
  const pick = (arr) => arr[Math.floor(rnd() * arr.length) % arr.length];
  const NAMES = ['张', '李', '王', '赵', '刘'];

  // ---- 依赖技能（用 check-dependency.js 的同一套查找路径）
  const dep = spawnSync(process.execPath, [path.join(__dirname, 'check-dependency.js')], { encoding: 'utf8' });
  let depInfo = null;
  try { depInfo = JSON.parse(dep.stdout.trim().split('\n').pop()); } catch (e) { depInfo = null; }
  if (!depInfo || !depInfo.available) {
    throw new Error('未找到依赖技能 overhaul-safety-check，无法按其真实输出生成 sample-overhaul-result.json（不手写替代品）；请用 SKILL_PACK_ROOT 指向技能包根目录后重试');
  }

  fs.mkdirSync(out, { recursive: true });

  // ---- 源技能输入 plan.json：E-1201 抽管束清洗及法兰补焊
  // 教学缺失点（不随 seed 变）：无风险辨识/JSA、动火点可燃物清理未写、无盲板图 → 3 缺失；
  // 无应急演练、无应急联系方式、有作业未标注类型、无风险评估报告附件、无施工平面图 → 5 建议完善；
  // 「空冷器管束顶部检查」未标注作业类型 → 未触发的专项规则按作业类型聚合为 9 条未判定
  const planNo = `JX-E1201-2026-${no2()}`;
  const duration = 4 + Math.floor(rnd() * 4); // 4~7 天，不触及工期 >30 天的规则
  const plan = {
    plan_no: planNo,
    unit: '常减压装置（原油换热器 E-1201）',
    project: 'E-1201 抽管束清洗及法兰补焊检修方案',
    contractor: `检修公司第${pick(['一', '二', '三'])}工程部`,
    duration_days: duration,
    jobs: [
      { name: 'E-1201 抽管束清洗', job_types: [], medium: '原油', location: '换热器框架' },
      { name: 'E-1201 法兰补焊', job_types: ['动火'], medium: '原油', location: 'E-1201 管程进口法兰' },
      { name: 'E-1201 进出口加盲板', job_types: ['盲板抽堵'], medium: '原油', location: 'E-1201 进出口' },
      { name: '检修临时电源接引', job_types: ['临时用电'], medium: '无', location: '换热器框架' },
      { name: '空冷器管束顶部检查', job_types: null, medium: '原油', location: '空冷平台' },
    ],
    measures: {
      risk_identification: null,
      safety_briefing: '开工前班长安全交底并签字确认',
      emergency_plan: '执行现行《生产区域检维修应急处置预案》',
      emergency_drill: null,
      contractor_qualification: '承修单位资质证书、特种作业人员证件已报车间备案',
      contractor_agreement: '已与承修单位签订检修安全协议',
      contractor_training: '参检人员检修前进行专项安全教育',
      tool_inspection: '电焊机、捯链、行灯变压器使用前检查合格',
      cross_work_coordination: '补焊、盲板抽堵、临时用电由检修班长统一协调时序',
      safety_acceptance: '完工验收：盲板复位、现场清理，车间与属地共同签字',
      process_handover: 'E-1201 切出、存油退净、蒸汽吹扫置换合格，办理设备交出确认',
      energy_isolation: '相关电机停电上锁挂牌「有人检修，禁止合闸」',
      waste_disposal: '废垫片、含油棉纱收集至危废桶交危废暂存间',
      fire_access: '现场不占用消防通道，框架消火栓畅通',
      phased_safety_check: null,
      toxic_protection: '拆法兰时佩戴防护面罩、耐油手套，现场配便携式硫化氢检测报警仪',
      restart_safety: '回装后配合工艺试压、确认法兰无泄漏后交付',
      hotwork_permit: '动火前办理用火作业许可证',
      combustible_cleanup: null,
      cylinder_distance: '氧气乙炔瓶间距不小于 5 米，距动火点不小于 10 米',
      fire_watch_equipment: '现场配干粉灭火器 2 具、蒸汽胶带 1 根',
      hotwork_gas_test: '每次动火前 30min 内做动火分析，合格方可动火',
      fire_watcher: '设专职监火人，动火全过程不离开现场',
      confined_permit: null, isolation_purge: null, ventilation: null, gas_test_plan: null, rescue_equipment: null, confined_guardian: null,
      scaffold_acceptance: null, fall_protection: null, weather_stop: null, highplace_permit: null,
      lifting_plan: null, lifting_permit: null, lifting_warning_zone: null, lifting_ground_check: null,
      power_distribution: '从框架检修电源箱接引，行灯 36V 安全电压',
      leakage_protector: '装设漏电保护器并试验合格',
      electrician_cert: '接拆线由持低压电工证的维修电工负责',
      temp_power_permit: '作业前办理临时用电安全作业票',
      blind_plate_map: null,
      blind_plate_list: '建立盲板台账逐块销号',
      blind_plate_permit: '办理盲板抽堵安全作业票',
      excavation_permit: null, underground_check: null, pressure_seal_approval: null, pressure_seal_qualified: null,
      radiation_protection: null, radiation_schedule: null, chemical_disposal: null, chemical_ppe: null, chemical_emergency_flush: null,
      spark_containment: null,
    },
    org: {
      site_manager: `${pick(NAMES)}某（检修公司项目负责人）`,
      safety_officer: `${pick(NAMES)}某（车间安全员）`,
      emergency_contact: null,
    },
    attachments: {
      risk_assessment_doc: null,
      site_layout: null,
      emergency_plan_doc: '附件：《生产区域检维修应急处置预案》（引用现行版本）',
    },
    extraction_notes: [
      'jobs[4].job_types：方案「空冷器管束顶部检查」未写作业类型 → 填 null',
      'measures.risk_identification：方案无风险分析章节 → 填 null',
    ],
  };
  const planPath = path.join(out, 'sample-overhaul-plan.json');
  fs.writeFileSync(planPath, JSON.stringify(plan, null, 2), 'utf8');

  // ---- 跑依赖技能 check.js 得到真实 result.json（输出写系统临时目录，只取 result.json）
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opcb-sample-'));
  try {
    const r = spawnSync(process.execPath, [depInfo.script, '--input', planPath, '--out', tmp], { encoding: 'utf8' });
    const rp = path.join(tmp, 'result.json');
    if (r.status !== 0 || !fs.existsSync(rp)) throw new Error(`依赖技能 check.js 运行失败：${(r.stdout || '').trim().split('\n').pop() || r.stderr}`);
    const result = JSON.parse(fs.readFileSync(rp, 'utf8'));
    fs.writeFileSync(path.join(out, 'sample-overhaul-result.json'), JSON.stringify(result, null, 2), 'utf8');

    const mismatch = JSON.parse(JSON.stringify(result));
    mismatch.summary = { ...mismatch.summary, must_fix: 5 };
    fs.writeFileSync(path.join(out, 'sample-overhaul-result-summary-mismatch.json'), JSON.stringify(mismatch, null, 2), 'utf8');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

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

  // 依赖技能的检修方案 docx 样例副本（演示 docx2text 一步；与 sample-overhaul-plan.json 不是同一份方案）
  const depDocx = path.join(depInfo.root, 'examples', 'pump-repair.docx');
  if (fs.existsSync(depDocx)) fs.copyFileSync(depDocx, path.join(out, 'sample-overhaul-plan.docx'));
  else warnings.push('依赖技能 examples 中无 pump-repair.docx，未生成 sample-overhaul-plan.docx（不影响其它样例）');

  console.log(JSON.stringify({
    ok: true, out, seed, planNo, dependency: depInfo.root,
    files: fs.readdirSync(out).filter((f) => /\.(json|docx)$/.test(f)).sort(),
    warnings,
  }));
}

try { main(); } catch (e) { C.fail(e, warnings); }
