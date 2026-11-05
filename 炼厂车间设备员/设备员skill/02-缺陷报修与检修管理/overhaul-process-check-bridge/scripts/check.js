#!/usr/bin/env node
/**
 * 检修方案安全措施核查规则引擎（Node.js ≥18，仅内置模块）
 * 用法：node scripts/check.js --input <plan.json> [--out <dir>] [--rules <checklist.json>]
 * 输出：<dir>/result.json、<dir>/report.md、<dir>/summary.json；末行打印 JSON 摘要 {must_fix, should_improve, undetermined, pass}
 *  - 输出状态四级：must_fix 缺失（必须补充）/ should_improve 建议完善 / undetermined 未判定 / pass 已有
 *  - 专项规则由 jobs[].job_types 触发；有作业未标注类型时，未被触发的专项规则输出 undetermined（不静默跳过），
 *    且按作业类型聚合为一条（说明中列出涉及规则号），summary.undetermined 按聚合后条数计
 *  - 不在 rules.meta.job_types 合法表中的类型标签被剔除并记 extraction_notes；剔除后为空 → 视为未标注
 *  - 措施字段：null/空串/false/数字 0/否定词（无、不涉及、不适用、没有、N/A、待定、暂无、仅符号）视为方案未写明；true 或实质文字视为已写明
 *  - duration_days 等数值：数字或「纯数字（可带 天/日）」字符串才参与比较，其余字符串（如日期区间）→ undetermined
 *  - 输入文件不存在 / JSON 非法 / plan 不是对象 → 末行 {"ok":false,"error":...}，退出码 1
 * plan.json 可选字段 extraction_notes: string[]（字符串会包成数组）—— 报告中单列「抽取备注（需人工确认）」一节
 * 说明：本脚本仅做辅助核查，不替代检修方案审批。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SKILL_ROOT = path.resolve(__dirname, '..');
const SEVERITY_ORDER = { must_fix: 0, should_improve: 1, undetermined: 2, pass: 3 };
const STATUS_LABEL = { must_fix: '缺失（必须补充）', should_improve: '建议完善', undetermined: '未判定', pass: '已有' };
const fmtT = (d) => { const p = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(d).reduce((o, x) => (o[x.type] = x.value, o), {}); return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}（北京时间）`; };

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const k = argv[i].slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      args[k] = v;
    }
  }
  return args;
}

/* ---------- 取值工具 ---------- */
function isEmpty(v) {
  return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
}
/** 否定词表：字符串值整体等于这些词（或仅由符号组成）时视为「方案未写明」，不算已写明 */
const NEGATION_WORDS = new Set(['无', '不涉及', '不适用', '没有', 'N/A', 'NA', '待定', '暂无']);
/** 字符串措施值若为否定词/仅符号，返回其去空白形式；否则返回 null。长句（如「不适用+理由说明」）不算否定词 */
function measureNegation(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (s === '') return null; // 空串按「未写明（空）」处理，不算否定词
  if (/^[\/—\-–~～\s]+$/.test(s)) return s; // 仅符号：/ — - – ~ ～
  const norm = s.replace(/\s+/g, '').toUpperCase();
  return NEGATION_WORDS.has(norm) ? s : null;
}
/** 措施字段是否「方案已写明」：true 或实质文字/非空数组/非 0 数字为已写；null/''/false/[]/0/否定词 为未写 */
function measurePresent(v) {
  if (v === true) return true;
  if (typeof v === 'string') return v.trim() !== '' && !measureNegation(v);
  if (typeof v === 'number') return v !== 0;
  if (Array.isArray(v)) return v.length > 0;
  return false;
}
function getPath(obj, p) {
  if (!p) return obj;
  let cur = obj;
  for (const seg of p.split('.')) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[seg];
  }
  return cur;
}
/** 数值严格解析：数字直接用；字符串仅接受「纯数字（可带小数），可跟“天/日”」，其余（如日期区间「9.20-11.3」）返回 null → 未判定 */
function toNum(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const m = v.match(/^\s*(\d+(?:\.\d+)?)\s*(?:天|日)?\s*$/);
    return m ? parseFloat(m[1]) : null;
  }
  return null;
}
function jobLabel(j, i) { return (j && !isEmpty(j.name)) ? String(j.name) : `第${i + 1}项作业`; }

/* ---------- 输入归一化 ---------- */
function normalizePlan(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('plan.json 顶层必须是对象（不能是数组/字符串/null）');
  const plan = Object.assign({}, input);
  if (typeof plan.extraction_notes === 'string') plan.extraction_notes = [plan.extraction_notes];
  plan.extraction_notes = Array.isArray(plan.extraction_notes) ? plan.extraction_notes.filter(n => typeof n === 'string' && n.trim()) : [];
  if (plan.jobs === undefined || plan.jobs === null) plan.jobs = [];
  else if (!Array.isArray(plan.jobs)) plan.jobs = [plan.jobs];
  plan.jobs = plan.jobs.filter((j, i) => {
    if (j && typeof j === 'object' && !Array.isArray(j)) return true;
    plan.extraction_notes.push(`jobs 第 ${i + 1} 个元素不是对象，已忽略`);
    return false;
  });
  plan.jobs = plan.jobs.map(j => {
    const job = Object.assign({}, j);
    if (job.job_types !== undefined && job.job_types !== null && !Array.isArray(job.job_types)) job.job_types = [job.job_types];
    if (Array.isArray(job.job_types)) job.job_types = job.job_types.filter(t => !isEmpty(t)).map(String);
    return job;
  });
  if (!plan.measures || typeof plan.measures !== 'object' || Array.isArray(plan.measures)) plan.measures = {};
  if (!plan.org || typeof plan.org !== 'object' || Array.isArray(plan.org)) plan.org = {};
  if (!plan.attachments || typeof plan.attachments !== 'object' || Array.isArray(plan.attachments)) plan.attachments = {};
  return plan;
}

/* ---------- 触发判断 ---------- */
/**
 * 返回 {state:'apply'|'skip'|'undetermined', jobs:[名称], untagged:[名称]}
 *  - job_type：任一作业标注该类型 → apply（jobs 列出触发作业）；无匹配但存在未标注类型的作业 → undetermined；否则 skip
 *  - job_types_all：同一作业同时标注全部类型 → apply；无匹配但存在未标注类型的作业 → undetermined；否则 skip
 *  - job_types 为 null/缺失 = 未标注（unknown）；显式空数组 [] = 方案标注为「无特殊作业」，不算未标注
 */
function evalTrigger(plan, trigger) {
  if (!trigger) return { state: 'apply', jobs: [], untagged: [] };
  const jobs = plan.jobs || [];
  const untagged = jobs.map((j, i) => !Array.isArray(j.job_types) ? jobLabel(j, i) : null).filter(Boolean);
  let matched = [];
  if (trigger.job_type) {
    matched = jobs.map((j, i) => (Array.isArray(j.job_types) && j.job_types.includes(trigger.job_type)) ? jobLabel(j, i) : null).filter(Boolean);
  } else if (Array.isArray(trigger.job_types_all)) {
    matched = jobs.map((j, i) => (Array.isArray(j.job_types) && trigger.job_types_all.every(t => j.job_types.includes(t))) ? jobLabel(j, i) : null).filter(Boolean);
  }
  if (matched.length) return { state: 'apply', jobs: matched, untagged: [] };
  if (untagged.length) return { state: 'undetermined', jobs: [], untagged };
  return { state: 'skip', jobs: [], untagged: [] };
}

/* ---------- when 条件 ---------- */
/** 返回 true / false / 'undetermined'（依赖字段为空） */
function evalCond(plan, c) {
  const v = getPath(plan, c.field);
  if (c.op === 'missing') return isEmpty(v);
  if (c.op === 'count_gte') return (Array.isArray(v) ? v.length : 0) >= c.value; // 数组为空是确定事实，不算 undetermined
  if (isEmpty(v)) return 'undetermined';
  switch (c.op) {
    case 'eq': return v === c.value;
    case 'ne': return v !== c.value;
    case 'exists': return true;
    case 'truthy': return !!v;
    case 'gt': { const n = toNum(v); return n === null ? 'undetermined' : n > c.value; }
    case 'gte': { const n = toNum(v); return n === null ? 'undetermined' : n >= c.value; }
    case 'lt': { const n = toNum(v); return n === null ? 'undetermined' : n < c.value; }
    case 'lte': { const n = toNum(v); return n === null ? 'undetermined' : n <= c.value; }
    default: return false;
  }
}
function whenMatches(plan, when) {
  if (!when || !when.length) return { match: true, undetermined: [] };
  const und = [];
  for (const c of when) {
    const r = evalCond(plan, c);
    if (r === false) return { match: false, undetermined: [] };
    if (r === 'undetermined') und.push(c.field);
  }
  return { match: und.length === 0, undetermined: und };
}

/* ---------- 规则检查器：返回 {ok:boolean, detail:string} ---------- */
const checkers = {
  required(plan, r) {
    const v = getPath(plan, r.field);
    if (isEmpty(v)) return { ok: false, detail: `${r.field} 为空/null（方案未写明）` };
    if (r.min_count && (!Array.isArray(v) || v.length < r.min_count)) return { ok: false, detail: `${r.field} 数量不足 ${r.min_count}` };
    return { ok: true, detail: Array.isArray(v) ? `共 ${v.length} 项` : (typeof v === 'object' ? '已写明（对象值，需人工核对）' : `已写明：${v}`) };
  },
  measure(plan, r) {
    const v = getPath(plan, r.field);
    if (measurePresent(v)) {
      const quote = typeof v === 'string' ? `：「${v.length > 60 ? v.slice(0, 60) + '…' : v}」` : '（已确认/勾选）';
      return { ok: true, detail: `方案已写明${quote}` };
    }
    const neg = measureNegation(v);
    const how = neg !== null ? `该项值为否定词「${neg}」，视为未写明`
      : v === false ? '标注为未落实/未勾选'
        : v === 0 ? '该项值为数字 0，视为未写明'
          : '未提及（抽取为 null/空）';
    return { ok: false, detail: `方案中${how}` };
  },
  each_job(plan, r) {
    const jobs = plan.jobs || [];
    if (!jobs.length) return { ok: true, detail: '无作业项（jobs 为空由 G-001 单独判定）' };
    // 空数组视为已标注（如 job_types: [] = 方案写明「无特殊作业」）；null/undefined/'' 才算缺
    const miss = v => v === null || v === undefined || v === '';
    const bad = jobs.map((j, i) => miss(j[r.field]) ? jobLabel(j, i) : null).filter(Boolean);
    return bad.length
      ? { ok: false, detail: `缺 ${r.field} 的作业：${bad.join('、')}` }
      : { ok: true, detail: `全部 ${jobs.length} 项作业均已标注 ${r.field}` };
  },
  reminder(plan, r) {
    return { ok: false, detail: '触发条件成立，方案中需明确相应安排' };
  },
};

/* ---------- 主流程 ---------- */
function run(plan, rules) {
  const findings = [];
  let skipped = 0;
  const undTrig = new Map(); // 作业类型（或组合）→ {ids, untagged}：未标注类型导致的未判定按类型聚合为一条
  for (const r of rules.rules) {
    const trig = evalTrigger(plan, r.trigger);
    if (trig.state === 'skip') { skipped++; continue; }
    if (trig.state === 'undetermined') {
      if (r.on_trigger_unknown === 'skip') { skipped++; continue; }
      const key = r.trigger.job_type || (Array.isArray(r.trigger.job_types_all) ? r.trigger.job_types_all.join('+') : '(未知触发)');
      if (!undTrig.has(key)) undTrig.set(key, { ids: [], untagged: trig.untagged });
      undTrig.get(key).ids.push(r.id);
      continue;
    }
    const w = whenMatches(plan, r.when);
    if (!w.match) {
      if (w.undetermined.length && r.on_when_empty !== 'skip') {
        findings.push({ rule_id: r.id, severity: 'undetermined', name: r.name, message: `无法判定：${r.message}`, detail: `依赖字段 ${w.undetermined.join('、')} 为空`, advice: '补充相关信息后重新核查', basis: r.basis, jobs: trig.jobs });
      } else skipped++;
      continue;
    }
    const fn = checkers[r.type];
    let res;
    try { res = fn ? fn(plan, r) : { ok: false, detail: `未知规则类型 ${r.type}` }; }
    catch (e) { res = { ok: false, detail: `规则执行异常：${e.message}` }; }
    const severity = res.ok ? 'pass' : r.severity;
    const detail = res.detail + (trig.jobs.length ? `（触发作业：${trig.jobs.join('、')}）` : '');
    findings.push({ rule_id: r.id, severity, name: r.name, message: res.ok ? `通过：${r.message}` : r.message, detail, advice: res.ok ? null : (r.advice || null), basis: r.basis, jobs: trig.jobs });
  }
  for (const [key, g] of undTrig) {
    findings.push({ rule_id: `UND-${key}`, severity: 'undetermined', name: `「${key}」专项规则未判定`, message: `无法判定：存在未标注作业类型的作业，无法确认是否触发「${key}」专项核查`, detail: `作业 ${g.untagged.join('、')} 未标注作业类型；涉及规则：${g.ids.join('、')}（同一作业类型的未判定聚合为一条计数）`, advice: '为上述作业补标作业类型后重新核查', basis: '见涉及规则各自的依据（checklist.json）', jobs: [] });
  }
  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.rule_id.localeCompare(b.rule_id));
  return { findings, skipped };
}

/** 一步完成：归一化 → 作业类型标签合法性校验 → 规则 → 摘要（供 CLI 与 selftest 调用） */
function evaluate(rawPlan, rules) {
  const plan = normalizePlan(rawPlan);
  const legal = rules && rules.meta && Array.isArray(rules.meta.job_types) ? new Set(rules.meta.job_types) : null;
  if (legal) {
    plan.jobs.forEach((job, i) => {
      if (!Array.isArray(job.job_types)) return;
      const bad = job.job_types.filter(t => !legal.has(t));
      if (!bad.length) return;
      job.job_types = job.job_types.filter(t => legal.has(t));
      if (job.job_types.length) {
        plan.extraction_notes.push(`作业「${jobLabel(job, i)}」类型标签「${bad.join('、')}」不在合法作业类型表，已剔除`);
      } else {
        job.job_types = null;
        plan.extraction_notes.push(`作业「${jobLabel(job, i)}」类型标签「${bad.join('、')}」不在合法作业类型表，按未标注处理`);
      }
    });
  }
  const { findings, skipped } = run(plan, rules);
  const summary = { must_fix: 0, should_improve: 0, undetermined: 0, pass: 0 };
  findings.forEach(f => summary[f.severity]++);
  return { plan, findings, skipped, summary };
}

/* ---------- 报告渲染 ---------- */
function renderReport(tpl, plan, result, ctx) {
  const esc = s => String(s ?? '').replace(/\|/g, '｜').replace(/\n/g, ' ');
  const table = result.findings.map(f =>
    `| ${f.rule_id} | ${esc(f.name)} | **${STATUS_LABEL[f.severity]}** | ${esc(f.detail)} | ${esc(f.basis)} |`).join('\n');
  const sect = sev => {
    const list = result.findings.filter(f => f.severity === sev);
    if (!list.length) return '（无）';
    return list.map((f, i) => {
      if (sev === 'pass') return `- [${f.rule_id}] ${f.name} —— ${f.detail}`;
      if (sev === 'undetermined') return `${i + 1}. **[${f.rule_id}] ${f.message}**\n   - 原因：${f.detail}\n   - 依据：${f.basis}`;
      return `${i + 1}. **[${f.rule_id}] ${f.message}**\n   - 现状：${f.detail}\n   - 方案里怎么补：${f.advice || '（见依据）'}\n   - 依据：${f.basis}`;
    }).join('\n');
  };
  const notes = plan.extraction_notes || [];
  const extraction_notes_section = notes.length
    ? `## 抽取备注（需人工确认）\n> 以下内容由抽取阶段记录：方案未写明、看不清、由其他信息推断等。这些字段对应的核查结果可能不准确，请核对方案原件。\n\n${notes.map((n, i) => `${i + 1}. ${n.trim()}`).join('\n')}\n`
    : '';
  const s = result.summary;
  const und = s.undetermined > 0 ? `另有 ${s.undetermined} 条规则因方案信息不足未判定` : '无未判定项';
  const verdict = s.must_fix > 0 ? `存在必须补充的安全措施缺失项，建议补充完善后再提交审批（${und}）`
    : s.should_improve > 0 ? `无必须补充项，建议完善后提交审批（${und}）`
      : `核查未发现可机检的措施缺失（不构成审批意见，${s.undetermined > 0 ? `仍有 ${s.undetermined} 条规则因方案信息不足未判定` : '无未判定项'}）`;
  const jobs = plan.jobs || [];
  const typeSet = new Set();
  jobs.forEach(j => (j.job_types || []).forEach(t => typeSet.add(t)));
  const vars = {
    extraction_notes_section,
    unit: plan.unit ?? '（缺失）', project: plan.project ?? '（缺失）',
    contractor: plan.contractor ?? '（缺失）',
    duration_days: plan.duration_days ?? '（缺失）',
    jobs_count: jobs.length,
    job_types_summary: typeSet.size ? [...typeSet].join('、') : '（未标注）',
    site_manager: (plan.org && plan.org.site_manager) ?? '（缺失）',
    safety_officer: (plan.org && plan.org.safety_officer) ?? '（缺失）',
    generated_at: fmtT(new Date()),
    must_fix_count: s.must_fix, should_improve_count: s.should_improve, undetermined_count: s.undetermined, pass_count: s.pass,
    skipped_count: result.skipped, rules_total: ctx.rulesTotal, rules_version: ctx.rulesVersion,
    verdict, checklist_table: table,
    must_fix_list: sect('must_fix'), should_improve_list: sect('should_improve'), undetermined_list: sect('undetermined'), pass_list: sect('pass'),
  };
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in vars ? String(vars[k]) : `{{${k}}}`)).replace(/\n{3,}/g, '\n\n');
}

function loadRules(rulesPath) {
  return JSON.parse(fs.readFileSync(rulesPath || path.join(SKILL_ROOT, 'references', 'checklist.json'), 'utf8'));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input || args.input === true) {
    console.log(JSON.stringify({ ok: false, error: '用法: node scripts/check.js --input <plan.json> [--out <dir>] [--rules <checklist.json>]' }));
    process.exit(1);
  }
  try {
    const rulesPath = (args.rules && args.rules !== true) ? args.rules : path.join(SKILL_ROOT, 'references', 'checklist.json');
    const tplPath = path.join(SKILL_ROOT, 'assets', 'templates', 'report-template.md');
    if (!fs.existsSync(args.input)) throw new Error(`输入文件不存在：${args.input}`);
    let raw;
    try { raw = JSON.parse(fs.readFileSync(args.input, 'utf8')); } catch (e) { throw new Error(`plan.json 不是合法 JSON：${e.message}`); }
    const rules = loadRules(rulesPath);
    const ctx = { rulesTotal: rules.rules.length, rulesVersion: rules.meta && rules.meta.version };

    const { plan, findings, skipped, summary } = evaluate(raw, rules);
    const result = { unit: plan.unit ?? null, project: plan.project ?? null, contractor: plan.contractor ?? null, duration_days: plan.duration_days ?? null, jobs_count: (plan.jobs || []).length, summary, skipped, findings, extraction_notes: plan.extraction_notes,
      disclaimer: '本结果为辅助核查，不替代检修方案审批；依据条款按记忆整理，以 GB 30871-2022 正式文本与企业制度为准。' };

    const outDir = (args.out && args.out !== true) ? args.out : path.join(process.cwd(), 'check');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(result, null, 2));
    fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
    const tpl = fs.existsSync(tplPath) ? fs.readFileSync(tplPath, 'utf8') : '# 检修方案安全措施核查报告\n{{checklist_table}}\n{{must_fix_list}}\n{{should_improve_list}}\n{{undetermined_list}}\n{{pass_list}}\n';
    fs.writeFileSync(path.join(outDir, 'report.md'), renderReport(tpl, plan, result, ctx));
    console.log(JSON.stringify(summary));
  } catch (e) {
    console.log(JSON.stringify({ ok: false, error: e.message }));
    process.exit(1);
  }
}

if (require.main === module) main();
module.exports = { run, evaluate, normalizePlan, getPath, checkers, evalTrigger, whenMatches, loadRules, renderReport, measurePresent, measureNegation, toNum };
