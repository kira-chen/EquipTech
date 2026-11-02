#!/usr/bin/env node
'use strict';
/**
 * 设备会议材料与汇报稿生成（仅 Node.js 内置模块）
 * 用法：node scripts/build.js --input <路径[,路径2]> --meeting "<会议类型>" --duration <分钟> --audience <车间|分厂|公司> [--out <dir>]
 * 可选：--audience-spec "<厂内层级名称>[:high|medium|low]" --weights "开场:0.05,关键指标:0.3,主要工作:0.1,存在问题:0.2,需决策:0.3,下步打算:0.05"
 *       --hide-tags（任何层级都去位号/工单号）--topics "<议题1,议题2>" --pending "<上次遗留事项>" --need-decision "<需决策事项>" --workshop "<车间>"
 * 产出：<out>/汇报稿.md、要点提纲.md、outline.json（含 slides 提纲数组，供 pptx 技能/工具转换）、summary.json
 *
 * 口径：听众层级按中石化组织层级三档 车间 | 分厂（作业部）| 公司（设备管理部门/公司领导），厂内名称用 --audience-spec 给出。
 * 硬约束：所有数字来自输入数据，不新增不修改不美化；议题无数据支撑写"需补充"，绝不编造；本技能不做周报月报指标统计
 *         （用 equipment-weekly-monthly-report 产出 periodic.json 后再汇报）。产出 md 不用 emoji，醒目提示用「【注意】」。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readXlsx, readCsvDir } = require('./lib/xlsx-lite');
const C = require('./lib/common');

const warnings = [];
const VALUE_OPTS = ['input', 'meeting', 'duration', 'audience', 'audience-spec', 'weights', 'out', 'topics', 'pending', 'need-decision', 'workshop'];
const FLAG_OPTS = ['help', 'hide-tags'];
const AUDIENCES = ['车间', '分厂', '公司'];

/** 听众层级 → 详略口径（中石化组织层级三档；旧称 设备部→分厂、厂领导→公司） */
const AUDIENCE_SPEC = {
  '车间': { detail: 'high', tagLevel: true, desc: '可含具体位号与细节' },
  '分厂': { detail: 'medium', tagLevel: true, desc: '含关键位号，弱化过程细节' },
  '公司': { detail: 'low', tagLevel: false, desc: '只讲结论、指标与需决策事项，不列具体位号' },
};
const DETAIL_SPEC = {
  high: { tagLevel: true, desc: '可含具体位号与细节' },
  medium: { tagLevel: true, desc: '含关键位号，弱化过程细节' },
  low: { tagLevel: false, desc: '只讲结论、指标与需决策事项，不列具体位号' },
};
/** 默认时间权重（按层级） */
const DEFAULT_WEIGHTS = {
  '公司': { 开场: 0.05, 关键指标: 0.3, 主要工作: 0.1, 存在问题: 0.2, 需决策: 0.3, 下步打算: 0.05 },
  '分厂': { 开场: 0.05, 关键指标: 0.25, 主要工作: 0.2, 存在问题: 0.25, 需决策: 0.15, 下步打算: 0.1 },
  '车间': { 开场: 0.05, 关键指标: 0.2, 主要工作: 0.3, 存在问题: 0.25, 需决策: 0.1, 下步打算: 0.1 },
};
const SECTIONS = ['开场', '关键指标', '主要工作', '存在问题', '需决策', '下步打算'];
/** periodic.json / daily.json 的指标键 → 中文标签与单位（只做展示映射，不改数值） */
const METRIC_CN = {
  intactRate: ['设备完好率', '%'], majorRate: ['主要设备完好率', '%'], standbyRate: ['备机完好率', '%'],
  staticLeakRate: ['静密封点泄漏率', '‰'], dynamicLeakRate: ['动密封点泄漏率', '‰'],
  planRate: ['检修计划完成率', '%'], planRateOverhaul: ['大检修计划完成率', '%'], planRateRoutine: ['日常维修计划完成率', '%'],
  orderRate: ['工单及时率', '%'], mttr: ['平均修复时间', '小时'], downtime: ['故障停机时长', '小时'],
  downtimeCount: ['故障停机次数', '次'], unplannedShutdowns: ['非计划停工次数', '次'], faultCount: ['故障次数', '次'],
  newDefects: ['新增缺陷（维修通知单）', '条'], openDefects: ['未闭环缺陷', '条'],
  equipment: ['涉及设备', '台'], abnormal: ['异常设备', '台'], specialEquipment: ['特护设备', '台'], specialAbnormal: ['特护设备异常', '台'],
  pendingAcceptDefects: ['待验收缺陷', '条'], overdueOrders: ['超期工单', '张'], openOrders: ['未闭环工单', '张'], pendingAcceptOrders: ['待验收工单', '张'],
  permits: ['当日作业票', '张'], maintProjects: ['检修项目', '项'], openLeaks: ['未修复泄漏点', '个'], overdueLeaks: ['超期泄漏点', '个'],
  hazards: ['隐患', '条'], overdueHazards: ['超期隐患', '条'], events: ['异常事件', '起'], unclosedEvents: ['未闭环事件', '起'],
};
const cnLabel = (k) => (METRIC_CN[k] ? METRIC_CN[k][0] : k);
const cnUnit = (k) => (METRIC_CN[k] ? METRIC_CN[k][1] : null);

function loadAny(p) {
  if (!fs.existsSync(p)) throw new Error(`输入不存在: ${p}`);
  const st = fs.statSync(p);
  if (st.isDirectory()) {
    const files = fs.readdirSync(p).filter((f) => /\.(json|xlsx|md)$/i.test(f));
    if (!files.length) throw new Error(`目录 ${p} 中没有 .json/.xlsx/.md 文件`);
    return files.map((f) => loadAny(path.join(p, f))).flat();
  }
  if (/\.json$/i.test(p)) {
    let j; try { j = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { throw new Error(`JSON 解析失败 ${p}: ${e.message}`); }
    return [{ kind: 'json', name: path.basename(p), data: j }];
  }
  if (/\.md$/i.test(p)) return [{ kind: 'md', name: path.basename(p), data: fs.readFileSync(p, 'utf8') }];
  return [{ kind: 'book', name: path.basename(p), data: readXlsx(p) }];
}

/** 从上游 JSON 抽取要点（只取已有字段，不推算） */
function extractFromJson(name, j) {
  const out = { source: name, type: null, metrics: [], issues: [], items: [] };
  const push = (label, value, unit) => { if (value !== null && value !== undefined) out.metrics.push({ label, value, unit: unit || null, source: name }); };

  // 判定顺序按「特征字段独占性」从强到弱：
  // hazard.json 也带 metrics.closeRate，若放在 orders 之后会被 orders 分支抢走，故先判 majorHazards。
  if (j.majorHazards !== undefined) {                                    // hazard.json
    out.type = '隐患跟踪';
    push('隐患总数', j.counts && j.counts.total); push('重大隐患', j.counts && j.counts.major);
    push('超期未整改', j.counts && j.counts.overdue);
    if (j.metrics) push('闭环率', j.metrics.closeRate, '%');
    for (const h of (j.majorHazards || []).slice(0, 5)) out.issues.push({ text: `重大隐患：${h.desc || h.description || h.no || ''}`, source: name });
  } else if (j.counts && j.byEquipment && j.abnormal !== undefined) {     // status.json
    out.type = '巡检汇总';
    push('涉及设备', j.counts.equipment); push('异常设备', j.counts.abnormal);
    push('未判定', j.counts.unknown); push('漏检', j.counts.missed);
    for (const a of (j.abnormal || []).slice(0, 10)) out.issues.push({ text: `${a.tag}${a.name ? ' ' + a.name : ''}：${a.desc || '异常'}`, tag: a.tag, source: name });
  } else if (j.counts && (j.byStatus !== undefined || (j.metrics && j.metrics.closeRate !== undefined))) {   // orders.json
    out.type = '工单跟踪';
    push('工单总数', j.counts.total); push('未闭环', j.counts.open);
    push('超期', j.counts.overdue); push('停滞', j.counts.stalled);
    if (j.metrics) push('完成率', j.metrics.closeRate, '%');
    if (j.metrics) push('平均闭环时长', j.metrics.avgCycleDays, '天');
    for (const o of (j.overdue || []).slice(0, 10)) {
      out.issues.push({ text: `${o.no || o.orderNo || ''} ${o.tag || ''} 超期 ${o.overdueDays ?? '—'} 天，责任方 ${o.owner || o.vendor || '未填写'}`, tag: o.tag, source: name });
    }
  } else if (j.counts && j.counts.byLevel && j.defects) {                 // defects.json
    out.type = '缺陷登记';
    push('新增缺陷', j.counts.total); push('未判定', j.counts.undetermined);
    for (const [k, v] of Object.entries(j.counts.byLevel || {})) push(`　${k}`, v);
  } else if (j.metrics && j.failures !== undefined && j.dataGaps !== undefined) {   // periodic.json（equipment-weekly-monthly-report）
    out.type = '周报月报';
    for (const k of Object.keys(METRIC_CN)) if (k in j.metrics && (typeof j.metrics[k] === 'number' || j.metrics[k] === null)) push(cnLabel(k), j.metrics[k], cnUnit(k));
    if (j.metrics.basedOn) out.items.push({ text: `数据覆盖：${j.metrics.basedOn}`, source: name });
    if (j.dataGaps && Array.isArray(j.dataGaps.recompute)) for (const x of j.dataGaps.recompute) out.issues.push({ text: `${x.metric} 需按厂内口径复算，本期未出数`, source: name });
    for (const h of (j.highlights || []).slice(0, 10)) out.issues.push({ text: `${h.type}：${h.text}`, source: name });
  } else if (j.counts && j.status !== undefined && j.orders !== undefined) {  // daily.json（equipment-daily-report）
    out.type = '设备日报';
    for (const [k, v] of Object.entries(j.counts)) if (typeof v === 'number') push(cnLabel(k), v, cnUnit(k));
    if (j.special && Array.isArray(j.special.list)) for (const x of j.special.list.filter((y) => y.state === '异常')) out.issues.push({ text: `特护设备 ${x.tag}${x.name ? ' ' + x.name : ''}：${x.desc || '异常'}`, tag: x.tag, source: name });
  } else {
    return null;
  }
  return out;
}

function main() {
  const a = C.parseArgs(process.argv.slice(2), VALUE_OPTS, FLAG_OPTS);
  if (!a.input) throw new Error('缺少 --input');
  if (!a.meeting) throw new Error('缺少 --meeting（会议类型）');
  if (!a.audience) throw new Error('缺少 --audience（听众层级：车间 / 分厂 / 公司），决定详略程度，不得默认');
  if (!AUDIENCES.includes(a.audience)) throw new Error(`--audience 只能是 ${AUDIENCES.join(' / ')}（中石化组织层级三档，厂内名称用 --audience-spec 给出），收到「${a.audience}」`);
  const duration = a.duration ? Number(a.duration) : null;
  if (a.duration && (!Number.isFinite(duration) || duration <= 0)) throw new Error(`--duration 「${a.duration}」应为正数（分钟）`);
  if (!duration) throw new Error('缺少 --duration（汇报时长，分钟）');
  // 听众层级：三档 + 厂内自定义名称（可带详略档位 high/medium/low）
  let audienceName = null, detail = AUDIENCE_SPEC[a.audience].detail;
  if (a['audience-spec']) {
    const m = String(a['audience-spec']).trim().match(/^(.*?)(?::(high|medium|low))?$/i);
    audienceName = (m && m[1].trim()) || null;
    if (m && m[2]) detail = m[2].toLowerCase();
  }
  const spec = { detail, tagLevel: a['hide-tags'] ? false : DETAIL_SPEC[detail].tagLevel, desc: DETAIL_SPEC[detail].desc + (a['hide-tags'] ? '；已按 --hide-tags 去位号' : '') };
  const audienceCn = audienceName ? `${a.audience}（${audienceName}）` : a.audience;
  // 时间权重：默认按层级，--weights 可覆盖（六个环节齐全、和为 1）
  let weights = DEFAULT_WEIGHTS[a.audience], weightsSource = '默认（按听众层级）';
  if (a.weights) {
    const w = {};
    for (const part of String(a.weights).split(/[,，]/).map((x) => x.trim()).filter(Boolean)) {
      const kv = part.split(/[:：=]/);
      if (kv.length !== 2) throw new Error(`--weights 片段「${part}」格式应为 环节:权重`);
      const k = kv[0].trim(), v = Number(kv[1]);
      if (!SECTIONS.includes(k)) throw new Error(`--weights 环节「${k}」无效，应为 ${SECTIONS.join(' / ')}`);
      if (!Number.isFinite(v) || v < 0) throw new Error(`--weights 环节「${k}」的权重「${kv[1]}」应为非负数`);
      w[k] = v;
    }
    const missing = SECTIONS.filter((k) => !(k in w));
    if (missing.length) throw new Error(`--weights 缺少环节：${missing.join('、')}`);
    const sum = SECTIONS.reduce((t, k) => t + w[k], 0);
    if (Math.abs(sum - 1) > 0.01) throw new Error(`--weights 六个环节权重之和应为 1，实际 ${C.round(sum, 3)}`);
    weights = w; weightsSource = '用户指定（--weights）';
  }
  const inputs = a.input.split(',').map((s) => s.trim()).filter(Boolean);
  const outDir = a.out || path.join(os.tmpdir(), 'mmb-out');

  // ---- 读入并抽取
  const sources = [], extracted = [];
  for (const p of inputs) {
    for (const got of loadAny(p)) {
      if (got.kind === 'json') {
        const e = extractFromJson(got.name, got.data);
        if (e) { extracted.push(e); sources.push(`${got.name}→${e.type}`); }
        else { warnings.push(`${got.name} 无法识别为已知的上游 JSON，已忽略`); }
      } else if (got.kind === 'md') {
        sources.push(`${got.name}→已有报表(Markdown)`);
        extracted.push({ source: got.name, type: '已有报表', metrics: [], issues: [], raw: got.data });
      } else {
        sources.push(`${got.name}→表格`);
        warnings.push(`${got.name} 为表格文件，本技能不做二次统计；建议先用对应报表技能生成 JSON 后再汇报`);
      }
    }
  }
  if (!extracted.length) throw new Error('未能从输入中抽取到任何可用要点（支持上游技能 JSON 与 .md 报表）');

  // ---- 议题与要点
  const topics = a.topics ? a.topics.split(/[,，]/).map((x) => x.trim()).filter(Boolean) : null;
  const allMetrics = extracted.flatMap((e) => e.metrics);
  const allIssues = extracted.flatMap((e) => e.issues);

  const keyPoints = [], noData = [];
  if (topics) {
    for (const t of topics) {
      const m = allMetrics.filter((x) => String(x.label).includes(t) || t.includes(String(x.label)));
      const i = allIssues.filter((x) => x.text.includes(t));
      if (!m.length && !i.length) {
        noData.push({ topic: t, note: '该议题暂无数据支撑，需补充' });
        warnings.push(`议题「${t}」在所提供数据中无对应内容，稿中写「需补充」，未编造内容`);
      } else {
        keyPoints.push({ topic: t, metrics: m, issues: i });
      }
    }
  } else {
    for (const e of extracted) {
      if (e.metrics.length || e.issues.length) keyPoints.push({ topic: e.type, metrics: e.metrics, issues: e.issues });
    }
  }

  // ---- 需决策与遗留
  const needDecision = a['need-decision']
    ? a['need-decision'].split(/[;；\n]/).map((x) => x.trim()).filter(Boolean)
      .map((x) => ({ text: x, note: '须写清请求决策的具体内容与可选方案' }))
    : [];
  const pending = a.pending ? a.pending.split(/[;；\n]/).map((x) => x.trim()).filter(Boolean) : [];
  if (!needDecision.length) warnings.push('未提供需决策事项（--need-decision），该节留空由汇报人填写');

  // ---- 时间分配（按听众层级默认权重，或 --weights）
  const timeAllocation = SECTIONS.map((k) => ({ section: k, weight: weights[k], minutes: C.round(duration * weights[k], 1) }));

  // 内容量与时长匹配性提示
  const itemCount = allMetrics.length + allIssues.length;
  const perMin = duration ? C.round(itemCount / duration, 2) : null;
  if (perMin !== null && perMin > 3) warnings.push(`内容量偏大（${itemCount} 项 / ${duration} 分钟），建议精简或延长时长`);
  if (perMin !== null && perMin < 0.5 && itemCount > 0) warnings.push(`内容量偏少（${itemCount} 项 / ${duration} 分钟），可适当补充`);

  const counts = {
    sources: sources.length, metrics: allMetrics.length, issues: allIssues.length,
    topics: topics ? topics.length : null, noData: noData.length,
    needDecision: needDecision.length, pending: pending.length,
  };

  // ---- 去位号（公司层级或 --hide-tags）：去工单号与位号，保留设备名称
  const strip = (t) => t
    .replace(/^(WO|GD)-[\w-]+\s*/i, '')              // 开头的工单号
    .replace(/\b[A-Z]{1,3}-\d{3,}[A-Z]?\s*/g, '')    // 位号
    .replace(/\b\d{7,8}\b\s*/g, '')                 // SAP 订单/通知单号
    .replace(/\s{2,}/g, ' ')
    .trim();
  const issueText = (it) => (spec.tagLevel ? it.text : (strip(it.text) || '（该条目去除位号后无剩余信息，详见附表）'));
  const issueLimit = spec.detail === 'low' ? 5 : 20;

  // ---- 提纲 slides（供 pptx 技能/工具转换；只含已有数据与占位，不代拟）
  const slides = [
    { title: a.meeting, bullets: [`${a.workshop ? a.workshop + '　' : ''}听众：${audienceCn}`, `时长：${duration} 分钟`, `数据来源：${sources.join('、')}`], notes: '封面' },
    { title: '一、开场（一句话结论）', bullets: ['（由模型撰写一句话结论，须与关键指标一致，不得拔高或淡化）'], notes: '分析段占位' },
    { title: '二、关键指标', bullets: allMetrics.map((m) => `${m.label}：${C.fmt(m.value)}${m.unit || ''}（${m.source}）`), notes: '数字原样引自来源，未做新增修改美化' },
    { title: '三、主要工作', bullets: ['（由汇报人补充，本技能不代拟）'], notes: '占位' },
    { title: '四、存在问题', bullets: allIssues.slice(0, issueLimit).map((it) => `${issueText(it)}（${it.source}）`), notes: '只陈述事实与影响，不做责任归因' },
    { title: '五、需协调决策事项', bullets: needDecision.length ? needDecision.map((d) => `${d.text}——请求决策的具体内容与可选方案由汇报人补充`) : ['（由汇报人填写）'], notes: pending.length ? `上次遗留：${pending.join('；')}` : '' },
    { title: '六、下步打算', bullets: ['（由汇报人填写，本技能不代拟）'], notes: '占位' },
  ];
  if (noData.length) slides.push({ title: '附：无数据支撑的议题', bullets: noData.map((x) => `${x.topic}：${x.note}`), notes: '不编造' });

  // ---- 产出
  C.ensureDir(outDir);
  const outline = {
    meta: { meeting: a.meeting, audience: a.audience, audienceName, audienceCn, audienceSpec: spec.desc, detail: spec.detail, hideTags: !!a['hide-tags'], duration,
      weights, weightsSource, workshop: a.workshop || null, sources, generatedAt: C.localDateTime() },
    counts, keyPoints, metrics: allMetrics, issues: allIssues,
    needDecision, pending, noData, timeAllocation, slides, warnings,
  };
  fs.writeFileSync(path.join(outDir, 'outline.json'), JSON.stringify(outline, null, 2), 'utf8');
  // ---- 汇报稿
  const L = [];
  L.push(`# ${a.meeting}　汇报稿`);
  L.push('');
  L.push(`${a.workshop ? a.workshop + '　｜　' : ''}听众：${audienceCn}（${spec.desc}）　｜　时长：${duration} 分钟`);
  L.push(`数据来源：${sources.join('、')}`);
  L.push(`生成时间：${C.localDateTime()}（北京时间）`);
  L.push('');
  L.push('## 一、开场（一句话结论）');
  L.push('');
  L.push('<!-- ANALYSIS_START -->');
  L.push('（由模型依据 references/meeting-rules.md 口径撰写一句话总体结论，须与下方指标一致，不得自行拔高或淡化。）');
  L.push('<!-- ANALYSIS_END -->');
  L.push('');
  L.push('## 二、关键指标');
  L.push('');
  if (!allMetrics.length) L.push('_所提供数据中无可用指标。_\n');
  else L.push(C.mdTable(['指标', '数值', '来源'], allMetrics.map((m) => [m.label, `${C.fmt(m.value)}${m.unit || ''}`, m.source])));
  L.push('## 三、主要工作');
  L.push('');
  L.push('<!-- WORK_START -->');
  L.push('（由汇报人补充本期主要完成的工作。本技能不代拟，避免编造未发生的工作内容。）');
  L.push('<!-- WORK_END -->');
  L.push('');
  L.push('## 四、存在问题');
  L.push('');
  if (!allIssues.length) L.push('_所提供数据中无异常或超期项。_\n');
  else {
    // 公司层级（或 --hide-tags）去掉位号与工单号，但保留设备名称——「回流泵B 机封滴漏」比「相关设备」有信息量
    for (const it of allIssues.slice(0, issueLimit)) L.push(`- ${issueText(it)}　_（${it.source}）_`);
    if (spec.detail === 'low' && allIssues.length > 5) L.push(`- _另有 ${allIssues.length - 5} 项，详见附表_`);
    L.push('');
    L.push('> 只陈述事实与影响，不做责任归因。');
    L.push('');
  }
  L.push('## 五、需协调决策事项');
  L.push('');
  if (!needDecision.length) L.push('_未提供需决策事项，由汇报人填写。每项须写清请求决策的具体内容与可选方案。_\n');
  else {
    for (const d of needDecision) { L.push(`- **${d.text}**`); L.push(`  - 请求决策的具体内容：_待汇报人补充_`); L.push(`  - 可选方案：_待汇报人补充_`); }
    L.push('');
  }
  if (pending.length) {
    L.push('**上次会议遗留事项进展**');
    L.push('');
    for (const p of pending) L.push(`- ${p}　→ 进展：_待汇报人补充_`);
    L.push('');
  }
  L.push('## 六、下步打算');
  L.push('');
  L.push('<!-- PLAN_START -->');
  L.push('（由汇报人填写，本技能不代拟。）');
  L.push('<!-- PLAN_END -->');
  L.push('');
  if (noData.length) {
    L.push('## 附：无数据支撑的议题');
    L.push('');
    L.push(C.mdTable(['议题', '说明'], noData.map((x) => [x.topic, x.note])));
  }
  L.push('---');
  L.push('');
  L.push('> 本稿数字均引自所列数据来源，未做任何新增、修改或美化。汇报内容的真实性由汇报人负责。');
  L.push('');
  if (warnings.length) {
    L.push('## 附：生成提示');
    L.push('');
    for (const w of warnings) L.push(`- ${w}`);
    L.push('');
  }
  fs.writeFileSync(path.join(outDir, '汇报稿.md'), L.join('\n'), 'utf8');

  // ---- 要点提纲（口头汇报时看）
  const O = [];
  O.push(`# ${a.meeting}　要点提纲`);
  O.push('');
  O.push(`听众：${audienceCn}　｜　时长：${duration} 分钟　｜　时间权重：${weightsSource}`);
  O.push('');
  O.push('## 时间分配建议');
  O.push('');
  O.push(C.mdTable(['环节', '权重', '建议时长(分钟)'], timeAllocation.map((t) => [t.section, t.weight, t.minutes])));
  O.push('## 要点速览');
  O.push('');
  for (const kp of keyPoints) {
    O.push(`**${kp.topic}**`);
    for (const m of kp.metrics.slice(0, 6)) O.push(`- ${m.label}：${C.fmt(m.value)}${m.unit || ''}`);
    for (const i of kp.issues.slice(0, 3)) O.push(`- 【注意】${issueText(i)}`);
    O.push('');
  }
  if (needDecision.length) {
    O.push('## 必须提到的决策事项');
    O.push('');
    for (const d of needDecision) O.push(`- ${d.text}`);
    O.push('');
  }
  O.push('## 口头汇报提示');
  O.push('');
  O.push('- 数字念准，不确定的宁可说「具体数字见材料」');
  O.push('- 存在问题只讲事实与影响，不归因到人');
  O.push('- 需决策事项要说清「请领导定什么」「有哪几个选项」');
  O.push(spec.detail === 'low' ? '- 公司层级：只讲结论与需决策事项，细节等问到再说' : '- 可按需展开细节');
  O.push('- 本提纲的结构化版本在 outline.json 的 slides 数组中，可交 pptx 技能/工具转换，不得手写 pptx XML');
  O.push('');
  fs.writeFileSync(path.join(outDir, '要点提纲.md'), O.join('\n'), 'utf8');

  C.emitOk(outDir, { ok: true, out: outDir, meeting: a.meeting, audience: a.audience, audienceCn, detail: spec.detail, duration, weightsSource, slides: slides.length, sources, counts, warnings });
}

try { main(); } catch (e) { C.fail(e, warnings); }
