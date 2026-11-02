#!/usr/bin/env node
'use strict';
/**
 * 现场作业监督要点脚本（仅 Node.js 内置模块）
 * 用法：node scripts/supervise.js --work-type "<作业类型,类型>" --scope "<作业内容>" --location "<位号或区域>" [--out <dir>]
 * 可选：--medium "<介质>" --duration <小时> --permit "<作业票路径>" --headcount <人数> --env "<环境条件>"
 *       --unit "<作业单位>" --start <ISO8601带时区> --end <ISO8601带时区> --level "<作业票级别，如 一级用火 / 高处二级 / 吊装三级>"
 * 产出：<out>/supervision.json、supervision.md、summary.json
 *
 * 硬约束：
 *   1. 作业类型不在覆盖范围 → 只输出通用监督框架 + warning，标注「待安全专业补充」，脚本不补具体安全要点
 *   2. 多类型组合 → 合并各类型要点并标注来源类型，冲突或加严项在 escalated 中单列
 *   3. 检查记录表留空，脚本不预填任何检查结果
 *   4. 介质不在危险特性库 → 按最严口径 + warning
 *   5. md 中保留固定声明行，不得删改
 *   6. 不输出超出厂内制度与作业票规定的安全措施
 *   7. 作业票级别由 --level 传入（以作业票为准，脚本不自判），只映射检查频次口径；频次为默认口径，厂内规定为准
 *   8. 术语按《中国石化作业许可管理规定》八大类（用火作业）；八大类共有的双监护/JSA 交底/属地确认人要点为 S 系列
 */
const fs = require('fs');
const path = require('path');
const C = require('./lib/common');
const R = require('./lib/rules');

const warnings = [];
const VALUE_OPTS = ['work-type', 'scope', 'location', 'out', 'medium', 'duration', 'permit',
  'headcount', 'env', 'unit', 'start', 'end', 'level'];
const FLAG_OPTS = ['help'];

/** 固定声明行，任何产出都必须原样保留 */
const DISCLAIMER = '本要点为辅助提示，不替代作业票规定的安全措施与监护人现场职责；发现异常应立即停止作业并按应急程序处置';
/** 边界声明：不给出超出厂内制度与作业票规定的措施 */
const SCOPE_NOTE = '本要点仅覆盖厂内制度与作业票通常规定的监督事项，不含超出作业票规定的额外安全措施；需要额外措施时由安全专业评估后写入作业票。';

function main() {
  const a = C.parseArgs(process.argv.slice(2), VALUE_OPTS, FLAG_OPTS);
  if (!a['work-type']) throw new Error('缺少 --work-type（作业类型，多类型用逗号分隔）');
  if (!a.scope) throw new Error('缺少 --scope（作业内容）');
  if (!a.location) throw new Error('缺少 --location（位号或区域）');
  const outDir = a.out || path.join(require('os').tmpdir(), 'supervision-out');

  // ---- 时长
  let duration = null;
  if (a.duration !== undefined) {
    const d = Number(String(a.duration).trim());
    if (!Number.isFinite(d) || d <= 0) throw new Error(`--duration 「${a.duration}」不是有效小时数`);
    duration = d;
  }
  // ---- 人数
  let headcount = null;
  if (a.headcount !== undefined) {
    const h = Number(String(a.headcount).trim());
    if (!Number.isInteger(h) || h <= 0) throw new Error(`--headcount 「${a.headcount}」不是有效人数`);
    headcount = h;
  }
  // ---- 起止时间（ISO 8601 带时区强校验）
  const parseIso = (v, name) => {
    if (v === undefined) return null;
    if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?([+-]\d{2}:?\d{2}|Z)$/.test(String(v).trim())) {
      throw new Error(`--${name} 「${v}」不是有效时间，应为 ISO 8601 带时区（如 2026-09-21T08:00:00+08:00）`);
    }
    const t = Date.parse(String(v).trim().replace(' ', 'T'));
    if (!Number.isFinite(t)) throw new Error(`--${name} 「${v}」无法解析为时间`);
    return C.localDateTime(new Date(t));
  };
  const startAt = parseIso(a.start, 'start');
  const endAt = parseIso(a.end, 'end');
  if (startAt && endAt && endAt <= startAt) throw new Error(`--end「${a.end}」不晚于 --start「${a.start}」`);

  // ---- 作业票（存在性提示，不解析内容）
  let permitNote = null;
  if (a.permit) {
    if (!fs.existsSync(a.permit)) {
      warnings.push(`作业票文件不存在：${a.permit}，本次未对照作业票，要点仅按作业类型规则生成`);
      permitNote = null;
    } else {
      permitNote = a.permit;
    }
  }

  // ---- 作业类型识别
  const { types, unknown } = R.classifyTypes(a['work-type']);
  const generic = types.length === 0;
  if (unknown.length) {
    warnings.push(`作业类型「${unknown.join('、')}」不在覆盖范围（覆盖：${R.COVERED_TYPES.map((t) => R.TYPE_CN[t]).join('、')}），该部分要点标注「${R.GENERIC_NOTE}」，脚本不凭通用安全知识补充具体要点`);
  }
  if (generic) {
    warnings.push(`未识别出任何覆盖范围内的作业类型，本次只输出通用监督框架，具体安全要点「${R.GENERIC_NOTE}」`);
  }
  if (types.length >= 2) {
    warnings.push(`识别为 ${types.length} 类组合作业（${types.map((t) => R.TYPE_CN[t]).join(' + ')}），已合并各类型要点并标注来源类型，冲突与加严项见 escalated`);
  }

  // ---- 作业票级别（以作业票为准，脚本不自判）
  let level = null;
  if (a.level !== undefined) {
    level = R.parseLevel(a.level, types);
    if (!level) warnings.push(`作业票级别「${a.level}」无法识别（可识别：特级/一级/二级用火、高处一~四级、吊装一~三级），本次按作业类型默认口径，未按级别映射频次`);
    else if (!types.includes(level.type)) warnings.push(`作业票级别「${a.level}」对应${R.TYPE_CN[level.type]}，但本次识别的作业类型中没有该类，级别仅作记录，频次仍按作业类型默认口径`);
  }
  const levelEffective = level && types.includes(level.type) ? level : null;

  // ---- 介质危险特性
  const mh = R.mediumHazard(a.medium);
  let hazards = mh.hazards;
  if (!mh.known) {
    hazards = R.STRICTEST_HAZARDS.slice();
    warnings.push(a.medium
      ? `介质「${a.medium}」不在危险特性库，已按最严口径（${R.STRICTEST_HAZARDS.map((h) => R.HAZ_CN[h]).join('、')}）处理，请核实 MSDS 后复核`
      : `未提供介质信息，已按最严口径（${R.STRICTEST_HAZARDS.map((h) => R.HAZ_CN[h]).join('、')}）处理，请补充介质后复核`);
  }

  // ---- 要点
  const points = R.pointsFor(types, { generic });
  const escalated = generic ? [] : R.escalationsFor(types);

  // ---- 风险等级与频次
  const risk = R.riskLevel({ types, hazards, mediumKnown: mh.known, comboCount: types.length, level: levelEffective });
  const km = R.keyMomentsFor(risk.level, duration, levelEffective);

  // ---- 计数
  const byMoment = {};
  for (const m of R.MOMENTS) byMoment[R.MOMENT_CN[m]] = points.filter((p) => p.moment === m).length;
  const byType = {};
  for (const p of points) { const k = p.typeCn; byType[k] = (byType[k] || 0) + 1; }
  const byMethod = {};
  for (const p of points) { const k = p.methodCn; byMethod[k] = (byMethod[k] || 0) + 1; }
  const counts = {
    points: points.length,
    byMoment, byType, byMethod,
    types: types.length,
    unknownTypes: unknown.length,
    escalated: escalated.length,
    generic,
  };

  // ---- JSON
  C.ensureDir(outDir);
  const result = {
    meta: {
      generatedAt: C.localDateTime(),
      workTypeInput: a['work-type'],
      types, typesCn: types.map((t) => R.TYPE_CN[t]),
      unknownTypes: unknown,
      genericOnly: generic,
      genericNote: generic || unknown.length ? R.GENERIC_NOTE : null,
      scope: a.scope, location: a.location,
      unit: a.unit || null,
      medium: a.medium || null,
      mediumKnown: mh.known,
      hazards, hazardsCn: hazards.map((h) => R.HAZ_CN[h]),
      permitLevelInput: a.level === undefined ? null : a.level,
      permitLevel: level ? { ...level, applied: !!levelEffective } : null,
      durationHours: duration, headcount, env: a.env || null,
      startAt, endAt, permit: permitNote,
      disclaimer: DISCLAIMER,
      scopeNote: SCOPE_NOTE,
    },
    counts,
    risk: { level: risk.level, levelCn: risk.levelCn, reasons: risk.reasons },
    points,
    frequency: {
      level: risk.level, levelCn: risk.levelCn,
      intervalMin: km.intervalMin,
      patrol: km.freq.patrol,
      standby: km.freq.standby,
      record: km.freq.record,
      gasTest: km.freq.gasTest,
      levelNote: km.freq.levelNote,
      source: km.freq.source,
      estimatedRounds: km.rounds,
    },
    keyMoments: km.moments,
    escalated,
    // 检查记录表：只给表头与空行，脚本不预填任何检查结果
    checkSheet: {
      headers: ['序号', '检查时点', '监督要点', '来源作业类型', '检查方式', '责任岗位', '检查时间', '检查结果', '检查人签字'],
      rows: points.map((p) => [p.seq, p.momentCn, p.text, p.typeCn, p.methodCn, p.owner, '', '', '']),
      note: '检查结果、检查时间与签字栏由现场检查人填写，脚本不预填',
    },
    warnings,
  };
  fs.writeFileSync(path.join(outDir, 'supervision.json'), JSON.stringify(result, null, 2), 'utf8');

  // ---- Markdown
  const L = [];
  L.push(`# 现场作业监督要点与检查表`);
  L.push('');
  L.push(`生成时间：${C.localDateTime()}（北京时间）`);
  L.push('');
  L.push(`> ${DISCLAIMER}`);
  L.push('');
  L.push('## 一、作业信息');
  L.push('');
  L.push(C.mdTable(['项目', '内容'], [
    ['作业类型（填报）', a['work-type']],
    ['识别作业类型', types.length ? types.map((t) => R.TYPE_CN[t]).join('、') : `未识别（${R.GENERIC_NOTE}）`],
    ['未覆盖类型', unknown.length ? `${unknown.join('、')}（${R.GENERIC_NOTE}）` : '—'],
    ['作业内容', a.scope],
    ['位号/区域', a.location],
    ['作业单位', a.unit || '—'],
    ['介质', a.medium || '—'],
    ['介质危险特性', mh.known ? hazards.map((h) => R.HAZ_CN[h]).join('、') : `不在危险特性库，按最严口径（${hazards.map((h) => R.HAZ_CN[h]).join('、')}）`],
    ['环境条件', a.env || '—'],
    ['作业人数', headcount === null ? '—' : `${headcount} 人`],
    ['预计时长', duration === null ? '—' : `${C.fmt(duration)} 小时`],
    ['作业起止', startAt && endAt ? `${startAt} ～ ${endAt}` : (startAt || endAt || '—')],
    ['作业票', permitNote || '—'],
    ['作业票级别（填报）', a.level === undefined ? '—（未提供，频次按作业类型默认口径）' : (level ? `${level.cn}${levelEffective ? '' : '（与识别类型不符，仅记录）'}` : `${a.level}（无法识别）`)],
    ['**风险等级（频次口径）**', `**${risk.levelCn}**`],
  ]));
  L.push('判定依据：');
  L.push('');
  for (const r of risk.reasons) L.push(`- ${r}`);
  L.push('');

  L.push('## 二、监督要点清单');
  L.push('');
  if (generic) {
    L.push(`> 填报的作业类型不在本技能覆盖范围，以下**仅为通用监督框架**，具体安全技术要点「${R.GENERIC_NOTE}」，不得凭通用安全知识自行补充。`);
    L.push('');
  }
  for (const m of R.MOMENTS) {
    const list = points.filter((p) => p.moment === m);
    L.push(`### ${R.MOMENT_CN[m]}（${list.length} 项）`);
    L.push('');
    L.push(C.mdTable(['序号', '监督要点', '来源作业类型', '检查方式', '责任岗位', '规则号'],
      list.map((p) => [p.seq, p.text, p.typeCn, p.methodCn, p.owner, p.id])));
  }

  L.push('## 三、检查频次建议');
  L.push('');
  L.push(C.mdTable(['项目', '建议'], [
    ['风险等级', risk.levelCn],
    ['现场巡查', km.freq.patrol],
    ['旁站要求', km.freq.standby],
    ['气体检测', km.freq.gasTest],
    ['记录要求', km.freq.record],
    ['作业票级别口径', km.freq.levelNote || '—（未提供作业票级别或级别不适用）'],
    ['预计巡查轮次', km.rounds === null ? '—（未提供预计时长）' : `约 ${km.rounds} 轮`],
  ]));
  L.push(`> 【注意】${km.freq.source}。`);
  L.push('');

  L.push('## 四、关键时点提示');
  L.push('');
  L.push(C.mdTable(['检查时点', '要点数', '提示'],
    km.moments.map((x) => [x.momentCn, byMoment[x.momentCn], x.note])));

  L.push('## 五、组合加严项');
  L.push('');
  if (!escalated.length) {
    L.push(types.length >= 2 ? '_本组合未命中加严规则，各类型要点按各自口径执行_\n' : '_单一作业类型，无组合加严项_\n');
  } else {
    L.push(C.mdTable(['规则号', '涉及类型', '加严事项', '冲突说明', '执行口径', '责任岗位'],
      escalated.map((e) => [e.id, e.typesCn.join(' + '), e.item, e.conflict, e.action, e.owner])));
  }

  L.push('## 六、现场检查记录表（空白，现场填写）');
  L.push('');
  L.push('> 以下记录表由现场检查人填写，脚本不预填任何检查结果。');
  L.push('');
  L.push(C.mdTable(result.checkSheet.headers,
    result.checkSheet.rows.map((r) => r.map((c) => (c === '' ? ' ' : c)))));

  L.push('## 七、异常处置提示');
  L.push('');
  L.push(`1. 发现任一要点不符合，立即要求作业单位停止作业，整改合格后方可复工。`);
  L.push('2. 涉及气体分析不合格、人员不适、设备泄漏、火情的，按厂应急程序处置并上报值班领导。');
  L.push('3. 作业票有效期届满或作业条件发生变化，须重新办票，不得口头延续。');
  L.push('4. 处置过程与结果记入检查记录表，作为承包商表现记录（contractor-performance-log）的原始依据。');
  L.push('');
  L.push(`> ${SCOPE_NOTE}`);
  L.push('');

  L.push('## 八、现场情况说明');
  L.push('');
  L.push('<!-- ANALYSIS_START -->');
  L.push('（此处由模型结合现场实际补充说明：本次作业的监督重点、需要特别关注的部位与时段、与同区域其他作业的协调安排。不得在此新增安全技术要点。）');
  L.push('<!-- ANALYSIS_END -->');
  L.push('');

  if (warnings.length) {
    L.push('## 附：数据提示');
    L.push('');
    for (const w of warnings) L.push(`- ${w}`);
    L.push('');
  }
  L.push('---');
  L.push('');
  L.push(DISCLAIMER);
  L.push('');
  fs.writeFileSync(path.join(outDir, 'supervision.md'), L.join('\n'), 'utf8');

  C.emitOk(outDir, {
    ok: true, out: outDir, counts,
    risk: { level: risk.level, levelCn: risk.levelCn },
    permitLevel: levelEffective ? levelEffective.cn : null,
    warnings,
  });
}

try { main(); } catch (e) { C.fail(e, warnings); }
