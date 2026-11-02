#!/usr/bin/env node
'use strict';
/**
 * 设备事件通报起草脚本（仅 Node.js 内置模块）
 * 用法：node scripts/notice.js --tag "<位号>" --time <ISO8601带时区> --desc "<事件经过>" \
 *         --status "<当前状态>" --measures "<已采取措施>" [--out <dir>]
 * 可选：--impact "<影响>" --followup "<后续安排>" --scope <车间|分厂|公司> --scope-name "<层级自定义名称，如 烯烃厂设备科>"
 *       --type <故障|险肇|异常> --name "<设备名称>" --workshop "<车间>" --area "<区域>" --cause "<原因（仅已确认时填）>"
 *       --cause-confirmed（旗标，仅当原因已由正式调查确认时使用）
 *       --hazard-level-confirmed（旗标，仅当「重大隐患」已按厂内隐患分级标准确认时使用，S43/S52 的隐患等级用语不再列为禁用）
 * 产出：<out>/notice.json、notice.md、summary.json
 *
 * 口径（《中石化口径对照.md》）：组织层级 车间 | 分厂 | 公司；内部通报须衔接《中国石化设备事故管理规定》分级与
 *       《炼化企业非计划停工管理规定》的非计划停工事件（与事故快报分开报送）；报送时限以厂内规定为准，脚本不判定。
 * 禁用词规则（lib/rules.js S1x~S4x）与 failure-investigation-assistant 的 C1~C8/J1~J5 同源，S41 的「事故」负向排除词表须两边一致。
 *
 * 硬约束：
 *  1. 原因未经 --cause-confirmed 确认 → 一律写「原因正在分析中」，--cause 内容不进入正文。
 *  2. 推测性/定性表述必检，命中列入 speculative（原文、位置、规则号、建议改法）并 warning。
 *  3. 可能需上报时只给 escalationHint / unplannedShutdownHint 提示，脚本不判定事件性质与等级。
 *  4. 检出个人姓名追责性表述 → 列入 speculative（规则 N1）并 warning。
 *  5. md 必须含固定声明行，不得删改；不用 emoji，醒目提示用「【注意】」。
 *  6. 要素缺失 → missing 单列，绝不用推测填补。
 */
const fs = require('fs');
const path = require('path');
const C = require('./lib/common');
const R = require('./lib/rules');

const warnings = [];
const VALUE_OPTS = ['tag', 'time', 'desc', 'status', 'measures', 'impact', 'followup',
  'scope', 'scope-name', 'type', 'name', 'workshop', 'area', 'cause', 'out'];
const FLAG_OPTS = ['help', 'cause-confirmed', 'hazard-level-confirmed'];

/** 通报范围按中石化组织层级三档：车间（运行部）/ 分厂（作业部）/ 公司；旧写法「设备部」「全厂」不再接受 */
const SCOPE_OK = ['车间', '分厂', '公司'];
/** 非计划停工事件提示：E4（停车/停工）命中时另行提示，与事故快报分开 */
const UNPLANNED_TEXT = '描述中提到装置停车/停工，可能构成非计划停工事件，请按《炼化企业非计划停工管理规定》与厂内规定判断并另行报送（与事故快报分开），本技能不判定';
/** 隐患等级用语相关规则：--hazard-level-confirmed 时不再列为禁用 */
const HAZARD_LEVEL_RULES = ['S43', 'S52'];
const TYPE_OK = ['故障', '险肇', '异常'];

function main() {
  const a = C.parseArgs(process.argv.slice(2), VALUE_OPTS, FLAG_OPTS);
  if (a.help) { console.log(JSON.stringify({ ok: true, usage: 'node scripts/notice.js --tag <位号> --time <ISO8601> --desc <经过> --status <当前状态> --measures <已采取措施> [--out <dir>]' })); return; }

  if (!a.tag) throw new Error('缺少 --tag（设备位号），通报必须挂到具体设备');
  if (!a.desc) throw new Error('缺少 --desc（事件经过）');

  // ---- 时间强校验：ISO 8601 带时区
  let timeCn = null;
  if (a.time) {
    if (!/[zZ]$|[+-]\d{2}:?\d{2}$/.test(String(a.time).trim())) {
      throw new Error(`--time 「${a.time}」缺少时区，应为 ISO 8601 带时区（如 2026-09-21T08:20:00+08:00）`);
    }
    const t = Date.parse(a.time);
    if (!Number.isFinite(t)) throw new Error(`--time 「${a.time}」不是有效时间，应为 ISO 8601 带时区（如 2026-09-21T08:20:00+08:00）`);
    timeCn = C.localDateTime(new Date(t));
  }

  const scope = a.scope || '车间';
  if (!SCOPE_OK.includes(scope)) throw new Error(`--scope 取值应为 ${SCOPE_OK.join('/')} 之一（中石化组织层级三档，可用 --scope-name 给出厂内名称），实际「${scope}」`);
  const scopeName = a['scope-name'] ? String(a['scope-name']).trim() : null;
  const scopeCn = scopeName ? `${scope}（${scopeName}）` : scope;
  const type = a.type || '故障';
  if (!TYPE_OK.includes(type)) throw new Error(`--type 取值应为 ${TYPE_OK.join('/')} 之一，实际「${type}」`);

  const outDir = a.out || path.join(require('os').tmpdir(), 'notice-out');

  // ---- 一、要素校验
  const vals = {
    tag: a.tag, time: timeCn, desc: a.desc, status: a.status,
    impact: a.impact, measures: a.measures, followup: a.followup,
  };
  const { elements, missing } = R.checkElements(vals);
  for (const m of missing) warnings.push(`通报要素缺失：${m.cn}（${m.arg}），须向用户补充，不得用推测填补`);

  // ---- 二、推测性/定性表述检测（逐字段扫描，位置可定位）
  const FIELDS = [
    ['desc', '事件经过', a.desc], ['status', '当前状态', a.status],
    ['impact', '影响情况', a.impact], ['measures', '已采取措施', a.measures],
    ['followup', '后续安排', a.followup], ['cause', '原因说明', a.cause],
  ];
  let speculative = [];
  for (const [key, cn, text] of FIELDS) {
    if (!text) continue;
    speculative = speculative.concat(R.scanSpeculative(text, cn).map((h) => ({ ...h, fieldKey: key })));
    speculative = speculative.concat(R.scanBlameNames(text, cn).map((h) => ({ ...h, fieldKey: key })));
  }
  // 隐患等级已按厂内分级标准确认（用户显式声明）→ S43/S52 的「重大隐患/重大」不再列为禁用，但记录声明
  const hazardLevelConfirmed = !!a['hazard-level-confirmed'];
  let hazardLevelKept = [];
  if (hazardLevelConfirmed) {
    hazardLevelKept = speculative.filter((h) => HAZARD_LEVEL_RULES.includes(h.ruleId));
    speculative = speculative.filter((h) => !HAZARD_LEVEL_RULES.includes(h.ruleId));
    if (hazardLevelKept.length) warnings.push(`用户以 --hazard-level-confirmed 声明隐患等级已按厂内分级标准确认，${hazardLevelKept.map((h) => `「${h.text}」（${h.ruleId}）`).join('、')} 未列为禁用表述；须在通报中注明分级依据（分级文号或台账编号）`);
    else warnings.push('传入 --hazard-level-confirmed 但描述中未出现隐患等级用语，该旗标未产生作用');
  }
  for (const h of speculative) {
    warnings.push(`检出${h.severity === 'block' ? '禁用' : '需核实'}表述「${h.text}」（${h.categoryCn}，规则 ${h.ruleId}，位于${h.field}第${h.index + 1}字）：${h.why}；建议：${h.suggest}`);
  }
  const specByCategory = {};
  for (const h of speculative) specByCategory[h.categoryCn] = (specByCategory[h.categoryCn] || 0) + 1;

  // ---- 三、原因：未经确认一律「原因正在分析中」
  const causeConfirmed = !!a['cause-confirmed'];
  let cause, causeNote;
  if (causeConfirmed && a.cause) {
    cause = String(a.cause).trim();
    causeNote = '原因已由正式调查确认（用户以 --cause-confirmed 声明），如与调查结论不一致以结论为准';
  } else {
    cause = R.CAUSE_UNDER_ANALYSIS;
    if (a.cause && !causeConfirmed) {
      warnings.push(`--cause 内容未经 --cause-confirmed 确认，已不写入通报正文，原因一栏固定为「${R.CAUSE_UNDER_ANALYSIS}」`);
      causeNote = '用户提供的原因说明未标记为已确认，未写入正文；原因以正式调查结论为准';
    } else {
      causeNote = '原因未经调查确认，按规定写「原因正在分析中」，不填入任何推测';
    }
  }

  // ---- 四、上报提示（只提示，不判定）
  const escalation = R.scanEscalation([a.desc, a.impact, a.status]);
  const escalationHint = {
    hint: escalation.hint,
    text: escalation.text,
    triggers: escalation.triggers,
    note: escalation.note,
  };
  if (escalation.hint) warnings.push(`${R.ESCALATION_TEXT}；是否构成设备事故及其等级按《中国石化设备事故管理规定》与厂内规定判定，报送时限以厂内规定为准（触发：${escalation.triggers.map((t) => `${t.note}「${t.keyword}」/${t.ruleId}`).join('；')}）`);
  // 非计划停工事件提示（与事故快报分开）：E4 停车/停工 命中时触发
  const e4 = escalation.triggers.filter((t) => t.ruleId === 'E4');
  const unplannedShutdownHint = {
    hint: e4.length > 0,
    text: e4.length ? UNPLANNED_TEXT : null,
    triggers: e4,
    note: '非计划停工事件按《炼化企业非计划停工管理规定》报送，与事故快报分开；是否构成及等级由用户按厂内规定判断，脚本只提示',
  };
  if (unplannedShutdownHint.hint) warnings.push(UNPLANNED_TEXT);

  const counts = {
    elementsTotal: elements.length,
    elementsPresent: elements.filter((e) => e.present).length,
    missing: missing.length,
    speculative: speculative.length,
    speculativeBlock: speculative.filter((h) => h.severity === 'block').length,
    speculativeReview: speculative.filter((h) => h.severity === 'review').length,
    speculativeByCategory: specByCategory,
    escalationTriggers: escalation.triggers.length,
    unplannedShutdownTriggers: e4.length,
    hazardLevelKept: hazardLevelKept.length,
  };

  // ---- 产出 JSON
  C.ensureDir(outDir);
  const result = {
    meta: {
      generatedAt: C.localDateTime(), workshop: a.workshop || null, area: a.area || null,
      scope, scopeName, scopeCn, type, tag: a.tag, name: a.name || null, eventTime: timeCn,
      causeConfirmed, hazardLevelConfirmed,
      disclaimer: R.DISCLAIMER,
    },
    counts, elements, missing, speculative, hazardLevelKept, escalationHint, unplannedShutdownHint,
    cause: { text: cause, confirmed: causeConfirmed, note: causeNote },
    warnings,
  };
  fs.writeFileSync(path.join(outDir, 'notice.json'), JSON.stringify(result, null, 2), 'utf8');

  // ---- 产出 Markdown
  const V = (k) => { const e = elements.find((x) => x.key === k); return e && e.present ? e.value : null; };
  const na = (k) => {
    const v = V(k);
    if (v) return v;
    const d = R.ELEMENT_DEFS.find((x) => x.key === k);
    return `（未提供${d ? d.cn : ''}，须补充后成文，不得推测填补）`;
  };
  const title = `${a.workshop ? a.workshop + ' ' : ''}${a.tag}${a.name ? ' ' + a.name : ''} 设备${type}情况通报`;

  const L = [];
  L.push(`# ${title}`);
  L.push('');
  L.push(`通报范围：${scopeCn}　事件类型：${type}　生成时间：${C.localDateTime()}（北京时间）`);
  L.push('');
  L.push('## 一、事件概况');
  L.push('');
  L.push(C.mdTable(['项目', '内容'], [
    ['设备位号', a.tag],
    ['设备名称', a.name || '—'],
    ['所在区域', a.area || '—'],
    ['发生时间', timeCn || '（未提供发生时间，须补充）'],
    ['事件类型', type],
    ['当前状态', na('status')],
  ]));
  L.push('## 二、事件经过');
  L.push('');
  L.push(na('desc'));
  L.push('');
  L.push('## 三、影响情况');
  L.push('');
  if (V('impact')) {
    L.push(V('impact'));
  } else {
    L.push('（未提供影响情况，须按生产、安全、环保三方面逐项补充；无影响也应明确写明，不得留空或推测）');
  }
  L.push('');
  L.push('## 四、已采取措施');
  L.push('');
  L.push(na('measures'));
  L.push('');
  L.push('## 五、原因分析情况');
  L.push('');
  L.push(cause + '。');
  L.push('');
  L.push(`> ${causeNote}`);
  L.push('');
  L.push('## 六、后续安排');
  L.push('');
  L.push(V('followup') || '（后续安排待明确：需写明责任人、完成时限与验证方式）');
  L.push('');
  L.push('## 七、举一反三提示');
  L.push('');
  L.push('<!-- ANALYSIS_START -->');
  L.push('（由模型依据 references/notice-rules.md 口径撰写 150~300 字：同类设备排查范围、需关注的运行参数与巡检要点、需提醒的操作注意事项。只写可执行的检查动作，不作原因推断、不作责任评价。）');
  L.push('<!-- ANALYSIS_END -->');
  L.push('');

  if (missing.length) {
    L.push('## 附一、缺失要素（须补充，不得推测填补）');
    L.push('');
    L.push(C.mdTable(['要素', '对应参数', '补充追问'], missing.map((m) => [m.cn, m.arg, m.ask])));
  }
  if (speculative.length) {
    L.push('## 附二、检出的推测性/定性表述（须改写后成文）');
    L.push('');
    L.push(C.mdTable(['规则号', '类别', '所在要素', '原文', '位置', '处理要求', '建议改法'],
      speculative.map((h) => [h.ruleId, h.categoryCn, h.field, h.text, `第${h.index + 1}字`,
        h.severity === 'block' ? '必须改写' : '需有依据，否则改写', h.suggest])));
    L.push('> 以上表述一律改写为客观事实陈述，或标注「待核实」；脚本不自动删改用户原文。');
    L.push('');
  }
  if (hazardLevelKept.length) {
    L.push('## 附二之一、按厂内分级确认保留的隐患等级用语');
    L.push('');
    L.push(C.mdTable(['规则号', '所在要素', '原文', '说明'], hazardLevelKept.map((h) => [h.ruleId, h.field, h.text, '用户声明已按厂内隐患分级标准确认，须在通报中注明分级依据（文号或台账编号）'])));
  }
  if (escalationHint.hint) {
    L.push('## 附三、上报流程提示');
    L.push('');
    L.push(`> 【注意】${R.ESCALATION_TEXT}。是否构成设备事故及其等级按《中国石化设备事故管理规定》与厂内规定判定，报送时限以厂内规定为准。`);
    L.push('');
    L.push(C.mdTable(['规则号', '触发情形', '命中关键词'], escalationHint.triggers.map((t) => [t.ruleId, t.note, t.keyword])));
    L.push(`> ${escalationHint.note}。`);
    L.push('');
  }
  if (unplannedShutdownHint.hint) {
    L.push('## 附四、非计划停工事件提示');
    L.push('');
    L.push(`> 【注意】${UNPLANNED_TEXT}。`);
    L.push('');
    L.push(C.mdTable(['规则号', '触发情形', '命中关键词'], unplannedShutdownHint.triggers.map((t) => [t.ruleId, t.note, t.keyword])));
    L.push(`> ${unplannedShutdownHint.note}。`);
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
  L.push(R.DISCLAIMER + '。');
  L.push('');
  fs.writeFileSync(path.join(outDir, 'notice.md'), L.join('\n'), 'utf8');

  C.emitOk(outDir, { ok: true, out: outDir, tag: a.tag, scope, counts, escalationHint: escalationHint.hint, unplannedShutdownHint: unplannedShutdownHint.hint, hazardLevelConfirmed, warnings });
}

try { main(); } catch (e) { C.fail(e, warnings); }
