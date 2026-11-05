#!/usr/bin/env node
/**
 * 特殊作业票预检规则引擎（Node.js ≥18，仅内置模块）
 * 用法：node scripts/precheck.js --input <permit.json> [--out <dir>] [--now <ISO 带时区>] [--rules <rules.json>]
 * 输出：<dir>/result.json、<dir>/report.md、<dir>/summary.json；末行打印 JSON 摘要 {must_fix, should_improve, undetermined, pass}
 *  - 严重度四级：must_fix 必须整改 / should_improve 建议完善 / undetermined 未判定（when 依赖字段为空）/ pass 通过
 *  - 时间一律要求 ISO 8601 带时区（如 2026-08-28T09:00:00+08:00）；不合规的时间视为缺失并由 G-000 提示
 *  - gas_tests 加载后按 time 升序排序（不可解析的放最前），[last] 即时间最新一次
 *  - 输入文件不存在 / JSON 非法 / permit 不是对象 → 末行 {"ok":false,"error":...}，退出码 1
 * permit.json 可选字段 extraction_notes: string[]（字符串会包成数组）—— 报告中单列「抽取备注（需人工确认）」一节
 * 说明：本脚本仅做辅助预检，不替代作业票审批。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const fmtT = (d) => { const p = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(d).reduce((o, x) => (o[x.type] = x.value, o), {}); return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}（北京时间）`; };

const SKILL_ROOT = path.resolve(__dirname, '..');
const SEVERITY_ORDER = { must_fix: 0, should_improve: 1, undetermined: 2, pass: 3 };
const ISO_TZ_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z)$/;
const PERMIT_TYPES = ['动火', '受限空间', '高处', '吊装', '临时用电', '盲板抽堵', '动土', '断路'];

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
/**
 * 路径支持：a.b.c、arr[].x（返回数组，逐项取 x）、arr[last].x（取最后一项，gas_tests 已按时间排序即最新）、arr[0].x
 */
function getPath(obj, p) {
  if (!p) return obj;
  const segs = p.split('.');
  let cur = [obj];
  let isArrayResult = false;
  for (const seg of segs) {
    const m = seg.match(/^([^\[]+)(?:\[(last|\d*)\])?$/);
    if (!m) return undefined;
    const key = m[1];
    const idx = m[2];
    const next = [];
    for (const c of cur) {
      if (c === null || c === undefined) continue;
      let v = c[key];
      if (idx === undefined) { next.push(v); continue; }
      if (!Array.isArray(v)) { continue; }
      if (idx === '') { isArrayResult = true; next.push(...v); }
      else if (idx === 'last') { next.push(v[v.length - 1]); }
      else { next.push(v[Number(idx)]); }
    }
    cur = next;
  }
  if (isArrayResult) return cur;
  return cur.length ? cur[0] : undefined;
}
function toNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}
/** 是否"填了但不是数值"（如 "合格"、"正常"） */
function isQualitative(v) {
  return typeof v === 'string' && v.trim() !== '' && toNum(v) === null;
}
/** 严格 ISO 8601 带时区；不合规一律 null（避免无时区字符串随机器时区漂移） */
function toDate(v) {
  if (isEmpty(v)) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v !== 'string' || !ISO_TZ_RE.test(v.trim())) return null;
  const d = new Date(v.trim());
  return isNaN(d.getTime()) ? null : d;
}

/* ---------- 输入归一化 ---------- */
function normalizePermit(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('permit.json 顶层必须是对象（不能是数组/字符串/null）');
  const permit = Object.assign({}, input);
  // cross_jobs：非数组包成数组
  if (permit.cross_jobs !== undefined && permit.cross_jobs !== null && !Array.isArray(permit.cross_jobs)) permit.cross_jobs = [permit.cross_jobs];
  permit.cross_jobs = (permit.cross_jobs || []).filter(j => j && typeof j === 'object' && !isEmpty(j.type));
  // extraction_notes：字符串包成数组
  if (typeof permit.extraction_notes === 'string') permit.extraction_notes = [permit.extraction_notes];
  permit.extraction_notes = Array.isArray(permit.extraction_notes) ? permit.extraction_notes.filter(n => typeof n === 'string' && n.trim()) : [];
  // workers / gas_tests / approvers / blind_plates：非数组视为空
  for (const k of ['workers', 'gas_tests', 'approvers', 'blind_plates']) {
    if (permit[k] === undefined || permit[k] === null) permit[k] = [];
    else if (!Array.isArray(permit[k])) permit[k] = [permit[k]];
  }
  // gas_tests 按时间升序（稳定排序；不可解析放最前），[last] 即时间最新
  permit.gas_tests = permit.gas_tests
    .map((g, i) => ({ g, i, t: g && toDate(g.time) ? toDate(g.time).getTime() : -Infinity }))
    .sort((a, b) => (a.t - b.t) || (a.i - b.i))
    .map(x => x.g);
  if (!permit.measures || typeof permit.measures !== 'object') permit.measures = permit.measures == null ? {} : permit.measures;
  return permit;
}

/* ---------- 条件判断 ---------- */
/** 返回 true / false / 'undetermined'（依赖字段为空） */
function evalCond(permit, c) {
  if (c.op === 'duration_gt' || c.op === 'duration_lte') {
    const s = toDate(getPath(permit, c.start || 'start_time')), e = toDate(getPath(permit, c.end || 'end_time'));
    if (!s || !e) return 'undetermined';
    const h = (e - s) / 3600000;
    return c.op === 'duration_gt' ? h > c.value : h <= c.value;
  }
  const v = getPath(permit, c.field);
  if (c.op === 'missing') return isEmpty(v);
  if (isEmpty(v)) return 'undetermined';
  switch (c.op) {
    case 'eq': return v === c.value;
    case 'ne': return v !== c.value;
    case 'in': return Array.isArray(c.value) && c.value.includes(v);
    case 'not_in': return Array.isArray(c.value) && !c.value.includes(v);
    case 'exists': return true;
    case 'truthy': return !!v;
    case 'gt': { const n = toNum(v); return n === null ? 'undetermined' : n > c.value; }
    case 'gte': { const n = toNum(v); return n === null ? 'undetermined' : n >= c.value; }
    case 'lt': { const n = toNum(v); return n === null ? 'undetermined' : n < c.value; }
    case 'lte': { const n = toNum(v); return n === null ? 'undetermined' : n <= c.value; }
    default: return false;
  }
}
/** 返回 {match:boolean, undetermined:string[]}：任一条件为 false → 不适用；否则若有空依赖 → 未判定 */
function whenMatches(permit, when) {
  if (!when || !when.length) return { match: true, undetermined: [] };
  const und = [];
  for (const c of when) {
    const r = evalCond(permit, c);
    if (r === false) return { match: false, undetermined: [] };
    if (r === 'undetermined') und.push(c.field || `${c.start || 'start_time'}/${c.end || 'end_time'}`);
  }
  return { match: und.length === 0, undetermined: und };
}

/* ---------- 规则检查器：返回 {ok:boolean, detail:string, soft?:boolean} ---------- */
const checkers = {
  required(permit, r) {
    const v = getPath(permit, r.field);
    if (r.field.includes('[]')) {
      const arr = Array.isArray(v) ? v : [];
      if (!arr.length) return { ok: false, detail: `${r.field} 无数据` };
      const bad = arr.map((x, i) => (isEmpty(x) || (r.truthy && !x)) ? i + 1 : null).filter(Boolean);
      return bad.length ? { ok: false, detail: `第 ${bad.join('、')} 项缺失` } : { ok: true, detail: '已填写' };
    }
    if (isEmpty(v)) return { ok: false, detail: `${r.field} 为空/null` };
    if (r.truthy && !v) return { ok: false, detail: `${r.field} 未勾选` };
    if (r.min_count && (!Array.isArray(v) || v.length < r.min_count)) return { ok: false, detail: `${r.field} 数量不足 ${r.min_count}` };
    return { ok: true, detail: Array.isArray(v) ? `共 ${v.length} 项` : `已填写：${typeof v === 'object' ? JSON.stringify(v) : v}` };
  },
  count_max(permit, r) {
    const v = getPath(permit, r.field);
    const n = Array.isArray(v) ? v.length : 0;
    return n > r.max ? { ok: false, detail: `${r.field} 共 ${n} 项，超过 ${r.max}` } : { ok: true, detail: `${r.field} 共 ${n} 项` };
  },
  enum(permit, r) {
    let v = getPath(permit, r.field);
    if (isEmpty(v)) return { ok: false, detail: `${r.field} 为空` };
    const numeric = Array.isArray(r.values) && r.values.length && r.values.every(x => typeof x === 'number');
    if (numeric) { const n = toNum(v); if (n !== null) v = n; }
    return r.values.includes(v) ? { ok: true, detail: `值为 ${v}` } : { ok: false, detail: `当前值 ${v}，允许值 ${r.values.join('/')}` };
  },
  range(permit, r) {
    let raw = getPath(permit, r.field);
    let n = toNum(raw);
    let note = '';
    if (n === null && isQualitative(raw)) return { ok: false, soft: true, detail: `${r.field} 票面为定性描述「${raw}」，需数值` };
    if (n === null && r.derive === 'combustible_from_lel') {
      // 体积分数缺失时由 %LEL × 介质爆炸下限 / 100 派生
      const lel = getPath(permit, 'gas_tests[last].lel'), lp = getPath(permit, 'medium.lel_pct');
      const lelN = toNum(lel), lpN = toNum(lp);
      if (lelN === null && isQualitative(lel)) return { ok: false, soft: true, detail: `gas_tests[last].lel 票面为定性描述「${lel}」，需数值` };
      if (lelN !== null && lpN !== null) { n = Math.round(lelN * lpN / 100 * 10000) / 10000; note = `（由 ${lelN}%LEL × 爆炸下限 ${lpN}% 换算）`; }
      else if (lelN === null) return { ok: false, detail: 'gas_tests[last].combustible_vol 与 lel 均未填写，无法判定' };
    }
    if (n === null) return { ok: false, detail: `${r.field} 未填写或非数值（${raw}）` };
    if (r.min !== undefined && r.min !== null && n < r.min) return { ok: false, detail: `实测 ${n}${note}，低于下限 ${r.min}` };
    if (r.max !== undefined && r.max !== null && n > r.max) return { ok: false, detail: `实测 ${n}${note}，高于上限 ${r.max}` };
    return { ok: true, detail: `实测 ${n}${note}，范围 [${r.min ?? '-'}, ${r.max ?? '-'}]` };
  },
  /**
   * 最近一次检测与"参考点"的间隔：
   *  - 参考点 = start_time；若当前时间已晚于开工（now > start），开工后的复检也纳入，复检与 now 比较（不误报）
   *  - soft_minutes（可选）：间隔 > soft_minutes 且 ≤ max_minutes → should_improve；> max_minutes → 规则严重度
   */
  time_window(permit, r, ctx) {
    const start = toDate(getPath(permit, r.ref));
    if (!start) return { ok: false, detail: `${r.ref} 缺失或格式不合规，无法计算间隔` };
    const now = ctx && ctx.now ? ctx.now : new Date();
    const cutoff = now > start ? now : start;
    let times = getPath(permit, r.field);
    if (!Array.isArray(times)) times = [times];
    const all = times.map(toDate).filter(Boolean);
    const ds = all.filter(d => d <= cutoff);
    if (!ds.length) return { ok: false, detail: all.length ? '所有检测时间均晚于开工/当前时间，请核对' : '无有效检测时间记录（缺失或格式不合规）' };
    const latest = new Date(Math.max(...ds.map(d => d.getTime())));
    const retest = latest > start;
    const ref = retest ? now : start;
    const mins = Math.round((ref - latest) / 60000);
    const who = retest ? '开工后复检，距当前' : '距开工';
    if (mins <= (r.soft_minutes ?? r.max_minutes)) return { ok: true, detail: `最近检测 ${fmtT(latest)}，${who} ${mins} 分钟` };
    if (mins <= r.max_minutes) return { ok: false, soft: true, detail: `最近检测 ${fmtT(latest)}，${who} ${mins} 分钟，超过 ${r.soft_minutes} 分钟（≤${r.max_minutes} 分钟按建议完善）` };
    return { ok: false, detail: `最近检测 ${fmtT(latest)}，${who} ${mins} 分钟，超过 ${r.max_minutes} 分钟` };
  },
  duration_max(permit, r) {
    const s = toDate(getPath(permit, r.start)), e = toDate(getPath(permit, r.end));
    if (!s || !e) return { ok: false, detail: '开始/结束时间缺失或格式不合规，无法计算有效期' };
    const hours = (e - s) / 3600000;
    return hours <= r.max_hours
      ? { ok: true, detail: `有效期 ${hours.toFixed(1)}h ≤ ${r.max_hours}h` }
      : { ok: false, detail: `有效期 ${hours.toFixed(1)}h，超过 ${r.max_hours}h` };
  },
  time_order(permit, r) {
    const s = toDate(getPath(permit, r.start)), e = toDate(getPath(permit, r.end));
    if (!s || !e) return { ok: false, detail: '开始/结束时间缺失或格式不合规' };
    return e > s ? { ok: true, detail: `${fmtT(s)} → ${fmtT(e)}` } : { ok: false, detail: '结束时间不晚于开始时间' };
  },
  now_in_window(permit, r, ctx) {
    const s = toDate(getPath(permit, r.start)), e = toDate(getPath(permit, r.end));
    if (!s || !e) return { ok: false, detail: '开始/结束时间缺失或格式不合规' };
    if (ctx.now > e) return { ok: false, detail: `当前 ${fmtT(ctx.now)} 已晚于结束时间 ${fmtT(e)}` };
    const hoursSinceStart = (ctx.now - s) / 3600000;
    if (hoursSinceStart > 24) return { ok: false, soft: true, detail: `当前 ${fmtT(ctx.now)} 距开工已 ${hoursSinceStart.toFixed(1)}h，开工时间已过去较久，请核对票面日期` };
    return { ok: true, detail: `当前 ${fmtT(ctx.now)} 未超过有效期` };
  },
  /** 时间字段格式检查（G-000）：非空但不符合 ISO 8601 带时区 → should_improve */
  time_format(permit, r) {
    const bad = [];
    for (const f of r.fields || ['start_time', 'end_time', 'gas_tests[].time']) {
      let v = getPath(permit, f);
      const list = Array.isArray(v) ? v : [v];
      list.forEach((x, i) => { if (!isEmpty(x) && !toDate(x)) bad.push(`${f.replace('[]', `[${i}]`)}=「${x}」`); });
    }
    return bad.length ? { ok: false, soft: true, detail: `不合规：${bad.join('；')}（需 ISO 8601 带时区，如 2026-08-28T09:00:00+08:00）` } : { ok: true, detail: '时间格式均合规' };
  },
  cross_permit(permit, r) {
    const jobs = permit.cross_jobs || [];
    const hit = jobs.find(j => { const t = String(j.type); return t.includes(r.required_type) || r.required_type.includes(t); });
    return hit ? { ok: true, detail: `已关联 ${r.required_type} 票 ${hit.permit_no || '（票号空白）'}` } : { ok: false, detail: `cross_jobs 中无 ${r.required_type} 作业票` };
  },
  cross_jobs_valid(permit) {
    const jobs = permit.cross_jobs || [];
    if (!jobs.length) return { ok: true, detail: '无关联作业票' };
    const bad = jobs.filter(j => !PERMIT_TYPES.some(t => String(j.type).includes(t) || t.includes(String(j.type))));
    return bad.length ? { ok: false, soft: true, detail: `关联票类型不在八类之内：${bad.map(j => `「${j.type}」`).join('、')}` } : { ok: true, detail: `关联票类型均有效（${jobs.map(j => j.type).join('、')}）` };
  },
  derived_level(permit, r) {
    const n = toNum(getPath(permit, r.field));
    const lv = getPath(permit, r.level_field);
    if (n === null) return { ok: false, detail: `${r.field} 未填写，无法校核级别` };
    const band = r.bands.find(b => n >= b.min && (b.max === null || b.max === undefined || n < b.max));
    if (!band) {
      const lowest = Math.min(...r.bands.map(b => b.min));
      if (n < lowest) return { ok: false, soft: true, detail: `${r.field}=${n} 低于最低分级下限 ${lowest}，可能不属于本类特殊作业，请核实是否需办票` };
      return { ok: false, detail: `${r.field}=${n} 不在任何分级区间` };
    }
    if (isEmpty(lv)) return { ok: false, detail: `级别未填写，按 ${r.field}=${n} 应为 ${band.level}` };
    return lv === band.level ? { ok: true, detail: `${r.field}=${n}，级别 ${lv} 正确` } : { ok: false, detail: `${r.field}=${n} 应为 ${band.level}，票面为 ${lv}` };
  },
  /** roles: 关键词数组（兼容 role 字符串）；cert 以 N/A 开头视为未持证 */
  role_cert(permit, r) {
    const ws = Array.isArray(permit.workers) ? permit.workers : [];
    const roles = Array.isArray(r.roles) ? r.roles : [r.role];
    const hit = ws.filter(w => w && typeof w.role === 'string' && roles.some(k => w.role.includes(k)));
    if (!hit.length) return { ok: false, detail: `作业人员中无 ${roles[0]} 角色（关键词：${roles.join('/')}）` };
    const noCert = w => isEmpty(w.cert) || /^\s*N\/?A/i.test(String(w.cert));
    const nocert = hit.filter(noCert);
    return nocert.length ? { ok: false, detail: `${nocert.map(w => w.name || '（无名）').join('、')} 未填写有效证书编号（空白或 N/A）` } : { ok: true, detail: `${hit.map(w => w.name).join('、')} 持证` };
  },
  toxic(permit, r, ctx) {
    const list = getPath(permit, r.field);
    if (!Array.isArray(list) || !list.length) {
      const mt = getPath(permit, 'medium.toxic');
      if (mt === false) return { ok: true, detail: '未检测有毒气体，介质标注无毒' };
      return { ok: false, soft: true, detail: '未检测有毒气体且介质毒性未知，请人工确认' };
    }
    const limits = {};
    for (const k of Object.keys(ctx.toxicLimits || {})) if (k !== 'note') limits[k.toUpperCase()] = ctx.toxicLimits[k];
    const over = [], unknown = [];
    for (const t of list) {
      const name = String(t && t.name || '').trim();
      const lim = limits[name.toUpperCase()];
      const v = toNum(t && t.value);
      if (!name) { unknown.push('（无名称）'); continue; }
      if (!lim) { unknown.push(name); continue; }
      if (v === null) { over.push(`${name} 无数值`); continue; }
      if (t.unit && lim.unit && String(t.unit).toLowerCase() !== lim.unit.toLowerCase()) { unknown.push(`${name}(单位 ${t.unit} 与限值单位 ${lim.unit} 不一致)`); continue; }
      if (v > lim.limit) over.push(`${name} ${v}${t.unit || ''} > ${lim.limit}${lim.unit}`);
    }
    const unk = unknown.length ? `无法自动比对，请人工核对 GBZ 2.1：${unknown.join('、')}` : '';
    if (over.length) return { ok: false, detail: `超限：${over.join('；')}` + (unk ? `；${unk}` : '') };
    if (unknown.length) return { ok: false, soft: true, detail: unk };
    return { ok: true, detail: list.map(t => `${t.name} ${t.value}${t.unit || ''}`).join('；') + ' 均在限值内' };
  },
  /** 大容积空间上/中/下多点取样：gas_tests ≥ min_count 或 location 含 上/中/下 */
  multi_point_sampling(permit, r) {
    const gs = permit.gas_tests || [];
    if (gs.length >= (r.min_count || 3)) return { ok: true, detail: `共 ${gs.length} 次检测` };
    const locs = gs.map(g => String(g && g.location || ''));
    if (locs.some(l => /[上中下]/.test(l))) return { ok: true, detail: `取样点含上/中/下：${locs.filter(Boolean).join('、')}` };
    return { ok: false, detail: `仅 ${gs.length} 次检测，取样点（${locs.filter(Boolean).join('、') || '未注明'}）未体现上/中/下多点` };
  },
  /** 监护人不得兼任作业人员/申请人 */
  guardian_independent(permit) {
    const g = String(permit.guardian || '').trim();
    if (!g) return { ok: false, detail: '监护人为空' };
    const dup = [];
    if (String(permit.applicant || '').trim() === g) dup.push('申请人');
    if ((permit.workers || []).some(w => w && String(w.name || '').trim() === g)) dup.push('作业人员');
    return dup.length ? { ok: false, detail: `监护人「${g}」同时是${dup.join('、')}` } : { ok: true, detail: `监护人「${g}」未兼任申请人/作业人员` };
  },
  /** 安全交底签字：整体 briefing_signed 或每名作业人员 workers[].briefing_signed */
  briefing_signed(permit) {
    if (permit.briefing_signed === true) return { ok: true, detail: '安全交底已整体签字确认' };
    const ws = permit.workers || [];
    if (!ws.length) return { ok: false, detail: 'briefing_signed 未勾选/签字，且无作业人员逐人签字' };
    const unsigned = ws.filter(w => !(w && w.briefing_signed === true));
    if (!unsigned.length) return { ok: true, detail: `${ws.length} 名作业人员均已签字` };
    if (unsigned.length === ws.length) return { ok: false, detail: permit.briefing_signed === false ? '安全交底签字栏未签（整体与逐人均无）' : '安全交底签字栏空白/无此栏（整体与逐人均无）' };
    return { ok: false, detail: `未签字：${unsigned.map(w => w.name || '（无名）').join('、')}` };
  },
  /** 审批层级：approvers ≥ min_count 且至少一名含关键字（如 公司/厂） */
  approver_level(permit, r) {
    const ap = (permit.approvers || []).map(String);
    const kws = r.keywords || ['公司', '厂'];
    const hit = ap.filter(a => kws.some(k => a.includes(k)));
    if (ap.length < (r.min_count || 2)) return { ok: false, detail: `审批人仅 ${ap.length} 人，少于 ${r.min_count || 2}` };
    if (!hit.length) return { ok: false, detail: `审批人中无含「${kws.join('/')}」的层级：${ap.join('、')}` };
    return { ok: true, detail: `审批 ${ap.length} 人，含 ${hit.join('、')}` };
  },
  fail() { return { ok: false, detail: '触发条件成立' }; },
  conditional(permit, r, ctx) {
    const then = Object.assign({ severity: r.severity, message: r.message, basis: r.basis }, r.then);
    const fn = checkers[then.type];
    if (!fn) return { ok: false, detail: `未知子规则类型 ${then.type}` };
    return fn(permit, then, ctx);
  },
};

/* ---------- 主流程 ---------- */
function run(permit, rules, ctx) {
  const findings = [];
  let skipped = 0;
  for (const r of rules.rules) {
    const applies = r.applies_to === '*' || (Array.isArray(r.applies_to) && r.applies_to.includes(permit.type));
    if (!applies) { skipped++; continue; }
    const w = whenMatches(permit, r.when);
    if (!w.match) {
      if (w.undetermined.length && r.on_when_empty !== 'skip') {
        findings.push({ rule_id: r.id, severity: 'undetermined', message: `无法判定：${r.message}`, detail: `依赖字段 ${w.undetermined.join('、')} 为空`, basis: r.basis, rule_type: r.type, check_name: r.check_name || null });
      } else skipped++;
      continue;
    }
    const fn = checkers[r.type];
    let res;
    try { res = fn ? fn(permit, r, ctx) : { ok: false, detail: `未知规则类型 ${r.type}` }; }
    catch (e) { res = { ok: false, detail: `规则执行异常：${e.message}` }; }
    let severity = res.ok ? 'pass' : (res.soft ? 'should_improve' : r.severity);
    findings.push({ rule_id: r.id, severity, message: res.ok ? `通过：${r.message}` : r.message, detail: res.detail, basis: r.basis, rule_type: r.type, check_name: r.check_name || null });
  }
  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.rule_id.localeCompare(b.rule_id));
  return { findings, skipped };
}

/** 一步完成：归一化 → 规则 → 摘要（供 CLI 与 selftest 调用） */
function evaluate(rawPermit, rules, ctx) {
  const permit = normalizePermit(rawPermit);
  const { findings, skipped } = run(permit, rules, ctx);
  const summary = { must_fix: 0, should_improve: 0, undetermined: 0, pass: 0 };
  findings.forEach(f => summary[f.severity]++);
  return { permit, findings, skipped, summary };
}

function renderReport(tpl, permit, result, ctx) {
  const sect = sev => {
    const list = result.findings.filter(f => f.severity === sev);
    if (!list.length) return '（无）';
    return list.map((f, i) => {
      if (sev === 'pass') return `- [${f.rule_id}] ${f.check_name || `检查「${f.message.replace(/^通过：/, '')}」`} 通过 —— ${f.detail}`;
      if (sev === 'undetermined') return `${i + 1}. **[${f.rule_id}] ${f.message}**\n   - 原因：${f.detail}，请补充票面信息后复检\n   - 依据：${f.basis}`;
      return `${i + 1}. **[${f.rule_id}] ${f.message}**\n   - 现状：${f.detail}\n   - 依据：${f.basis}`;
    }).join('\n');
  };
  const notes = permit.extraction_notes || [];
  const extraction_notes_section = notes.length
    ? `## 抽取备注（需人工确认）\n> 以下内容由抽取阶段记录：票面空白、看不清、由其他信息推断、单位不一致等。这些字段对应的检查结果可能不准确，请核对原件。\n\n${notes.map((n, i) => `${i + 1}. ${n.trim()}`).join('\n')}\n`
    : '';
  const s = result.summary;
  const und = s.undetermined > 0 ? `另有 ${s.undetermined} 条规则因票面信息不足未判定` : '无未判定项';
  const verdict = s.must_fix > 0 ? `存在必须整改项，不建议进入审批（${und}）`
    : s.should_improve > 0 ? `无必须整改项，建议完善后提交审批（${und}）`
      : `预检未发现可机检问题（不构成审批意见，${s.undetermined > 0 ? `仍有 ${s.undetermined} 条规则因票面信息不足未判定` : '无未判定项'}）`;
  const vars = {
    extraction_notes_section,
    permit_no: permit.permit_no ?? '（缺失）', type: permit.type ?? '（缺失）', level: permit.level ?? '（缺失）',
    location: permit.location ?? '（缺失）', unit: permit.unit ?? '（缺失）', medium: (permit.medium && permit.medium.name) ?? '（缺失）',
    start_time: permit.start_time ?? '（缺失）', end_time: permit.end_time ?? '（缺失）',
    applicant: permit.applicant ?? '（缺失）', guardian: permit.guardian ?? '（缺失）',
    now: fmtT(ctx.now), generated_at: fmtT(new Date()),
    must_fix_count: s.must_fix, should_improve_count: s.should_improve, undetermined_count: s.undetermined, pass_count: s.pass,
    skipped_count: result.skipped, rules_total: ctx.rulesTotal, rules_version: ctx.rulesVersion,
    verdict,
    must_fix_list: sect('must_fix'), should_improve_list: sect('should_improve'), undetermined_list: sect('undetermined'), pass_list: sect('pass'),
  };
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in vars ? String(vars[k]) : `{{${k}}}`)).replace(/\n{3,}/g, '\n\n');
}

function loadRules(rulesPath) {
  return JSON.parse(fs.readFileSync(rulesPath || path.join(SKILL_ROOT, 'references', 'rules.json'), 'utf8'));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) {
    console.error('用法: node scripts/precheck.js --input <permit.json> [--out <dir>] [--now <ISO 带时区>] [--rules <rules.json>]');
    process.exit(1);
  }
  try {
    const rulesPath = args.rules || path.join(SKILL_ROOT, 'references', 'rules.json');
    const tplPath = path.join(SKILL_ROOT, 'assets', 'templates', 'report-template.md');
    if (!fs.existsSync(args.input)) throw new Error(`输入文件不存在：${args.input}`);
    let raw;
    try { raw = JSON.parse(fs.readFileSync(args.input, 'utf8')); } catch (e) { throw new Error(`permit.json 不是合法 JSON：${e.message}`); }
    const rules = loadRules(rulesPath);
    let now;
    if (args.now) {
      now = toDate(String(args.now));
      if (!now) throw new Error(`--now 不合规：「${args.now}」，需 ISO 8601 带时区，如 2026-08-28T08:50:00+08:00`);
    } else now = new Date();
    const ctx = { now, toxicLimits: rules.toxic_limits || {}, rulesTotal: rules.rules.length, rulesVersion: rules.meta && rules.meta.version };

    const { permit, findings, skipped, summary } = evaluate(raw, rules, ctx);
    const result = { permit_no: permit.permit_no ?? null, type: permit.type ?? null, level: permit.level ?? null, now: fmtT(now), summary, skipped, findings, extraction_notes: permit.extraction_notes,
      disclaimer: '本结果为辅助预检，不替代作业票审批；条款号以 GB 30871-2022 正式文本为准。' };

    const outDir = args.out || path.join(process.cwd(), 'output');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(result, null, 2));
    fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
    const tpl = fs.existsSync(tplPath) ? fs.readFileSync(tplPath, 'utf8') : '# 预检报告\n{{must_fix_list}}\n{{should_improve_list}}\n{{undetermined_list}}\n{{pass_list}}\n';
    fs.writeFileSync(path.join(outDir, 'report.md'), renderReport(tpl, permit, result, ctx));
    console.log(JSON.stringify(summary));
  } catch (e) {
    console.log(JSON.stringify({ ok: false, error: e.message }));
    process.exit(1);
  }
}

if (require.main === module) main();
module.exports = { run, evaluate, normalizePermit, getPath, checkers, toDate, toNum, whenMatches, loadRules, renderReport, ISO_TZ_RE };
