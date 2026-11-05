#!/usr/bin/env node
'use strict';
/**
 * 结果转达脚本（仅 Node.js 内置模块）：把本技能规则引擎 check.js 的 result.json 原样转达为车间自查合并报告。
 * 用法：node scripts/merge-report.js --result <check.js 输出的 result.json> [--plan <交给 check.js 的 plan.json>] [--notes <车间侧提示 json>]
 *       [--object <方案名称>] [--repair-type <大检修|日常维修|抢修|专项>] [--out <dir>]
 * 产出：<out>/overhaul-check-bridge.md、bridge.json、summary.json；末行 JSON 摘要
 *
 * 硬约束（references/bridge-rules.md）：
 *   - findings 逐条深拷贝，severity / name / message / detail / advice / basis / rule_id / jobs 一字不改，不合并、不归类、不简化
 *   - 本脚本按 findings 重新计数，与源 summary 不一致时只 warning，不改源数据
 *   - 规则引擎 disclaimer 原文保留；本技能声明行追加在其后
 *   - 车间侧提示单独成节「车间侧补充提示（非规则判定）」，状态只认 已核实 / 未核实 / 不适用，其它一律按「未核实」并 warning
 *   - --repair-type 只写入报告抬头（检修分级口径：装置大检修 / 日常维修 / 抢修 / 专项），不进入判定；旧值 大修→大检修、中修/小修→日常维修 并 warning
 *   - check.js 的 result.json 不含 plan_no、job_types：方案编号与作业类型标签从 --plan（交给 check.js 的 plan.json）读取，
 *     只进抬头与字段表，不进入判定；不传 --plan 时为 null / 空数组并 warning，不猜测
 */
const fs = require('fs');
const path = require('path');
const C = require('./lib/common');

const warnings = [];
const VALUE_OPTS = ['result', 'plan', 'notes', 'object', 'repair-type', 'out'];
const FLAG_OPTS = ['help'];

const SOURCE = 'check.js';
const OUT_MD = 'overhaul-check-bridge.md';
const TITLE = '检修方案安全措施核查结果（车间自查）';
const OBJECT_LABEL = '检修方案';
const ACTION = '核查';
const DECLARATION = '核查为辅助自查，不替代技术负责人审核与安全部门审批；方案是否批准以审批人意见为准。';
const SEV_CN = { must_fix: '缺失（必须补充）', should_improve: '建议完善', undetermined: '未判定', pass: '已有' };
const NOTE_ITEMS = [
  { item: '设备交出条件', skill: 'equipment-handover-check' },
  { item: '同期交叉作业', skill: 'cross-operation-conflict' },
  { item: '承包商资质', skill: 'contractor-qualification-check' },
  { item: '备件与工机具到位', skill: '车间自查' },
];
const NOTE_STATUS = ['已核实', '未核实', '不适用'];
const REPAIR_TYPES = ['大检修', '日常维修', '抢修', '专项'];
const REPAIR_TYPE_ALIAS = { '大修': '大检修', '装置大检修': '大检修', '停工检修': '大检修', '中修': '日常维修', '小修': '日常维修', '技改': '专项', '技改技措': '专项', '专项检修': '专项' };
/** 作业类型标签 → 作业许可八大类名称（只作加注；plan.json / 规则库的标签原值照搬，「动火」即中石化的「用火作业」） */
const JOB_TYPE_CN = {
  '动火': '用火作业', '受限空间': '受限空间作业', '高处': '高处作业', '吊装': '吊装作业', '临时用电': '临时用电作业',
  '盲板抽堵': '盲板抽堵作业', '动土': '动土作业', '断路': '断路作业',
};

const esc = (v) => C.str(v).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

function main() {
  const a = C.parseArgs(process.argv.slice(2), VALUE_OPTS, FLAG_OPTS);
  if (!a.result) throw new Error('缺少 --result（规则引擎 check.js 输出的 result.json）');
  if (!fs.existsSync(a.result)) throw new Error(`规则引擎结果文件不存在: ${a.result}`);
  const outDir = a.out || path.join(require('os').tmpdir(), 'opcb-out');
  let src;
  try { src = JSON.parse(fs.readFileSync(a.result, 'utf8')); } catch (e) { throw new Error(`规则引擎结果文件解析失败: ${e.message}`); }
  if (!src || typeof src !== 'object' || !Array.isArray(src.findings)) throw new Error('规则引擎结果格式错误：缺少 findings 数组，请确认传入的是 check.js 输出的 result.json 而不是 summary.json');
  if (!src.disclaimer) warnings.push('规则引擎结果无 disclaimer 字段，合并报告只能保留本技能声明行');

  // 交给 check.js 的 plan.json：check.js 的 result.json 不含 plan_no / job_types，这两项从这里取（只进抬头与字段表，不进入判定）
  let plan = null;
  if (a.plan) {
    if (!fs.existsSync(a.plan)) throw new Error(`检修方案数据 plan.json 不存在: ${a.plan}`);
    try { plan = JSON.parse(fs.readFileSync(a.plan, 'utf8')); } catch (e) { throw new Error(`检修方案数据 plan.json 解析失败: ${e.message}`); }
    if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw new Error('检修方案数据 plan.json 格式错误：应为对象（即交给 check.js --input 的文件）');
  }

  // 检修分级（只进抬头，不进判定）
  let repairType = null, repairTypeRaw = null;
  if (a['repair-type'] !== undefined) {
    repairTypeRaw = C.str(a['repair-type']);
    if (REPAIR_TYPES.includes(repairTypeRaw)) repairType = repairTypeRaw;
    else if (REPAIR_TYPE_ALIAS[repairTypeRaw]) {
      repairType = REPAIR_TYPE_ALIAS[repairTypeRaw];
      warnings.push(`--repair-type「${repairTypeRaw}」为旧口径，已按中石化检修分级映射为「${repairType}」（大修→大检修，中修/小修→日常维修）`);
    } else throw new Error(`--repair-type 只能是 ${REPAIR_TYPES.join(' / ')}（旧值 大修/中修/小修 可自动映射），收到「${repairTypeRaw}」`);
  }

  // 逐条深拷贝，一字不改
  const findings = src.findings.map((f) => JSON.parse(JSON.stringify(f)));
  const counts = { must_fix: 0, should_improve: 0, undetermined: 0, pass: 0, other: 0 };
  for (const f of findings) {
    if (counts[f.severity] === undefined) { counts.other++; warnings.push(`规则 ${f.rule_id || '（无规则号）'} 的 severity「${C.str(f.severity)}」不在已知四级中，已原样保留并单列`); }
    else counts[f.severity]++;
  }
  if (src.summary && typeof src.summary === 'object') {
    for (const k of ['must_fix', 'should_improve', 'undetermined', 'pass']) {
      if (src.summary[k] !== undefined && Number(src.summary[k]) !== counts[k]) {
        warnings.push(`规则引擎 summary.${k}=${src.summary[k]} 与 findings 重新计数 ${counts[k]} 不一致，报告按 findings 逐条照搬，summary 原值保留在 bridge.json`);
      }
    }
  }

  // 车间侧提示
  let notesIn = null;
  if (a.notes) {
    if (!fs.existsSync(a.notes)) throw new Error(`车间侧提示文件不存在: ${a.notes}`);
    try { notesIn = JSON.parse(fs.readFileSync(a.notes, 'utf8')); } catch (e) { throw new Error(`车间侧提示文件解析失败: ${e.message}`); }
    if (!Array.isArray(notesIn)) throw new Error('车间侧提示文件格式错误：应为数组 [{item,status,note}]');
  }
  const workshopNotes = NOTE_ITEMS.map((d) => {
    const hit = (notesIn || []).find((n) => C.str(n.item) === d.item);
    let status = hit ? C.str(hit.status) : '未核实';
    if (!NOTE_STATUS.includes(status)) { warnings.push(`车间侧提示「${d.item}」状态「${status || '（空）'}」不是 已核实/未核实/不适用，按「未核实」处理`); status = '未核实'; }
    return { item: d.item, status, note: hit ? C.str(hit.note) : '', skill: d.skill };
  });
  for (const n of (notesIn || [])) {
    if (!NOTE_ITEMS.some((d) => d.item === C.str(n.item))) {
      let status = C.str(n.status);
      if (!NOTE_STATUS.includes(status)) { warnings.push(`车间侧提示「${C.str(n.item)}」状态不合法，按「未核实」处理`); status = '未核实'; }
      workshopNotes.push({ item: C.str(n.item) || '（未命名）', status, note: C.str(n.note), skill: '车间自查' });
    }
  }

  // 方案编号与涉及的作业类型：优先取 plan.json（check.js 的 result.json 不含这两项）；
  // 未传 --plan 时兼容结果顶层自带的 plan_no / job_types（旧格式）；都没有则留空并 warning，不从 findings 反推
  let planNo = null, planNoSource = null, jobTypes = [], jobTypesSource = null;
  if (plan) {
    planNo = C.str(plan.plan_no) || null;
    if (planNo) planNoSource = 'plan.json';
    else warnings.push('plan.json 的 plan_no（方案编号）为空，报告不写方案编号；方案有文件号的请补进 plan.json');
    for (const j of (Array.isArray(plan.jobs) ? plan.jobs : [])) {
      let t = j ? j.job_types : null;
      if (t === null || t === undefined) continue;
      if (!Array.isArray(t)) t = [t];
      for (const x of t) { const v = C.str(x); if (v && !jobTypes.includes(v)) jobTypes.push(v); }
    }
    jobTypesSource = 'plan.json';
    for (const k of ['unit', 'project']) {
      const pv = C.str(plan[k]), sv = C.str(src[k]);
      if (pv && sv && pv !== sv) warnings.push(`plan.json 的 ${k}「${pv}」与 result.json 的 ${k}「${sv}」不一致，请确认 --plan 是生成该 result.json 的同一份方案`);
    }
    if (Array.isArray(plan.jobs) && src.jobs_count !== undefined && src.jobs_count !== null && plan.jobs.length !== Number(src.jobs_count)) {
      warnings.push(`plan.json 作业项数 ${plan.jobs.length} 与 result.json 的 jobs_count ${src.jobs_count} 不一致，请确认 --plan 是生成该 result.json 的同一份方案`);
    }
  }
  if (!planNo && C.str(src.plan_no)) { planNo = C.str(src.plan_no); planNoSource = 'result.json'; }
  if (!plan && Array.isArray(src.job_types)) {
    jobTypes = src.job_types.map((x) => C.str(x)).filter(Boolean);
    jobTypesSource = 'result.json';
  }
  if (!plan && (!planNo || !jobTypesSource)) {
    warnings.push('未提供 --plan：规则引擎 result.json 不含 plan_no（方案编号）与 job_types（作业类型），报告中这两项留空；传入交给 check.js 的 plan.json（--plan）即可补上');
  }
  const objectName = a.object || src.project || planNo || '（未提供）';
  const jobTypesCn = jobTypes.map((t) => (JOB_TYPE_CN[t] ? `${t}（${JOB_TYPE_CN[t]}）` : t));

  const nonConform = findings.filter((f) => f.severity === 'must_fix' || f.severity === 'should_improve');
  const undetermined = findings.filter((f) => f.severity === 'undetermined');
  const passed = findings.filter((f) => f.severity === 'pass');
  const others = findings.filter((f) => counts[f.severity] === undefined);

  C.ensureDir(outDir);
  const result = {
    meta: {
      source: SOURCE, resultFile: a.result, planFile: a.plan || null, objectName, repairType, repairTypeRaw,
      generatedAt: C.localDateTime(), declaration: DECLARATION, sourceDisclaimer: src.disclaimer || null,
    },
    sourceSummary: src.summary || null,
    sourceMeta: {
      plan_no: planNo, unit: src.unit ?? null, project: src.project ?? null, contractor: src.contractor ?? null,
      duration_days: src.duration_days ?? null, jobs_count: src.jobs_count ?? null, jobTypes, jobTypesCn,
      planNoSource, jobTypesSource,
    },
    counts, findings, workshopNotes, skipped: src.skipped || [], extractionNotes: src.extraction_notes || [], warnings,
  };
  fs.writeFileSync(path.join(outDir, 'bridge.json'), JSON.stringify(result, null, 2), 'utf8');

  const L = [];
  L.push(`# ${TITLE}`);
  L.push('');
  L.push(`规则引擎：\`${SOURCE}\`　｜　${OBJECT_LABEL}：${objectName}${repairType ? `　｜　检修分级：${repairType}` : ''}`);
  L.push(`自查时间：${C.localDateTime()}（北京时间）　｜　结果文件：${path.basename(a.result)}`);
  L.push('');
  L.push(`## 一、${ACTION}结论（引自规则引擎 ${SOURCE}）`);
  L.push('');
  L.push(`> 以下内容原文引自规则引擎（${SOURCE}）的判定结果，合并时未做任何改写。`);
  L.push('');
  L.push(`共核查 ${findings.length} 项：缺失（必须补充）${counts.must_fix} 项，建议完善 ${counts.should_improve} 项，未判定 ${counts.undetermined} 项，已有 ${counts.pass} 项${counts.other ? `，其它级别 ${counts.other} 项` : ''}。`);
  const META_CN = { plan_no: '方案编号（plan_no）', unit: '装置/单位（unit）', project: '检修项目（project）', contractor: '承修单位（contractor）', duration_days: '工期天数（duration_days）', jobs_count: '作业项数（jobs_count）' };
  const metaRows = Object.entries(result.sourceMeta)
    .filter(([k, v]) => META_CN[k] && v !== null && v !== undefined && v !== '')
    .map(([k, v]) => [META_CN[k], esc(v)]);
  if (jobTypesCn.length) metaRows.push([`作业类型标签（${jobTypesSource === 'plan.json' ? 'plan.json 各作业 job_types 原值' : 'result.json 原值'}，括号内为作业许可八大类加注）`, esc(jobTypesCn.join('、'))]);
  if (metaRows.length) { L.push(''); L.push(C.mdTable(['result.json 字段', '值'], metaRows)); }
  const fromPlan = [planNoSource === 'plan.json' ? '方案编号' : null, jobTypesSource === 'plan.json' && jobTypes.length ? '作业类型标签' : null].filter(Boolean);
  if (fromPlan.length) L.push(`> ${fromPlan.join('、')}取自 plan.json（规则引擎 result.json 不含这${fromPlan.length > 1 ? '两' : '一'}项），只作抬头信息，不进入判定。\n`);
  if (counts.undetermined) L.push('【注意】未判定项既不代表措施已有，也不代表缺失，需补齐方案信息（作业类型标注、工期等）后重新' + ACTION + '。');
  L.push('');

  L.push('## 二、措施缺失项（缺失 / 建议完善）');
  L.push('');
  if (!nonConform.length) L.push('_规则引擎结果中无缺失与建议完善项。_\n');
  else {
    L.push(C.mdTable(['序号', '规则编号', '级别', '措施名称（原文）', '问题（原文）', '现状（原文）', '方案里怎么补（原文）', '依据（原文）', '触发作业（原文）'],
      nonConform.map((f, i) => [i + 1, esc(f.rule_id), SEV_CN[f.severity], esc(f.name), esc(f.message), esc(f.detail), esc(f.advice), esc(f.basis), esc(Array.isArray(f.jobs) ? f.jobs.join('、') : f.jobs)])));
    L.push('> 逐条照搬规则引擎结果，未合并、未归类、未调整级别。');
    L.push('');
  }

  L.push('## 三、未判定项');
  L.push('');
  if (!undetermined.length) L.push('_无。_\n');
  else {
    L.push(C.mdTable(['序号', '规则编号', '未判定内容（原文）', '缺失信息（原文）', '补齐建议（原文）', '依据（原文）'],
      undetermined.map((f, i) => [i + 1, esc(f.rule_id), esc(f.message), esc(f.detail), esc(f.advice), esc(f.basis)])));
    L.push(`> 【未判定】以上各项保持规则引擎的「未判定」状态，合并时不改写为已有或缺失；补齐方案信息后重新运行 ${SOURCE}。`);
    L.push('');
  }
  if (others.length) {
    L.push(C.mdTable(['规则编号', '级别（原文）', '内容（原文）'], others.map((f) => [esc(f.rule_id), esc(f.severity), esc(f.message)])));
    L.push('');
  }

  L.push('## 四、已有措施');
  L.push('');
  if (!passed.length) L.push('_无。_\n');
  else {
    L.push(C.mdTable(['规则编号', '措施名称（原文）', '方案摘录（原文）'], passed.map((f) => [esc(f.rule_id), esc(f.name), esc(f.detail)])));
    L.push('');
  }

  L.push('## 五、车间侧补充提示（非规则判定）');
  L.push('');
  L.push('> **以下为车间设备员关注项，不参与上述合规判定，不影响规则引擎结论。**');
  L.push('');
  L.push(C.mdTable(['检查项', '状态', '说明', '可接技能'],
    workshopNotes.map((n) => [n.item, n.status === '未核实' ? '**未核实**' : n.status, esc(n.note) || (n.status === '未核实' ? (n.skill === '车间自查' ? '待车间自查' : `建议用 ${n.skill} 核对`) : ''), n.skill])));
  L.push('');

  L.push('## 六、整改建议');
  L.push('');
  if (!nonConform.length && !undetermined.length) L.push('_无需补充项；方案仍须按程序经技术负责人审核与安全部门审批，各专项措施以开工时逐票办理的作业票为准。_\n');
  else {
    let k = 0;
    for (const f of nonConform) L.push(`${++k}. 【${SEV_CN[f.severity]}】${f.rule_id} ${C.str(f.name)}：${C.str(f.message)}${f.advice ? '；方案里怎么补：' + C.str(f.advice) : ''}`);
    for (const f of undetermined) L.push(`${++k}. 【未判定】${f.rule_id}：${C.str(f.detail) || C.str(f.message)}${f.advice ? '；' + C.str(f.advice) : ''}，补齐后重新${ACTION}`);
    L.push('');
    L.push('各专项措施最终仍以开工时逐票办理的作业票为准（作业票预检用 permit-precheck-bridge）。');
    L.push('');
  }

  if (result.extractionNotes.length) {
    L.push('## 附：抽取说明（原文）');
    L.push('');
    for (const n of result.extractionNotes) L.push(`- ${C.str(n)}`);
    L.push('');
  }
  if (warnings.length) {
    L.push('## 附：数据提示');
    L.push('');
    for (const w of warnings) L.push(`- ${w}`);
    L.push('');
  }
  L.push('---');
  L.push('');
  if (src.disclaimer) L.push(`> ${C.str(src.disclaimer)}`);
  L.push(`> ${DECLARATION}`);
  L.push('');
  L.push('<!-- ANALYSIS_START -->');
  L.push('（模型在此补充车间侧说明：缺失 / 建议完善 / 未判定项数量、车间提示项、下一步整改重点；不得复述或改写判定结论，不得审查方案技术内容。）');
  L.push('<!-- ANALYSIS_END -->');
  fs.writeFileSync(path.join(outDir, OUT_MD), L.join('\n'), 'utf8');

  C.emitOk(outDir, { ok: true, out: outDir, source: SOURCE, objectName, repairType, counts, warnings });
}

try { main(); } catch (e) { C.fail(e, warnings); }
