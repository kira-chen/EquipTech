#!/usr/bin/env node
'use strict';
/**
 * 结果转达脚本（仅 Node.js 内置模块）：把规则引擎 precheck.js 的 result.json 原样转达为车间自查合并报告。
 * 用法：node scripts/merge-report.js --result <precheck.js 产出的 result.json> [--notes <车间侧提示 json>] [--object <作业票名称>] [--out <dir>]
 * 产出：<out>/permit-precheck-bridge.md、bridge.json、summary.json；末行 JSON 摘要
 *
 * 硬约束（references/bridge-rules.md）：
 *   - 只转达，不改写判定：findings 逐条深拷贝，severity / message / detail / basis / rule_id 一字不改，不合并、不归类、不简化
 *   - findings 原文来自规则库，沿用 GB 30871 的「动火」一词（即中石化「用火作业」），照搬不替换
 *   - 本脚本按 findings 重新计数，与 result.json 的 summary 不一致时只 warning，不改原数据
 *   - 规则引擎的 disclaimer 原文保留；本技能声明行追加在其后
 *   - 车间侧提示单独成节「车间侧补充提示（非规则判定）」，状态只认 已核实 / 未核实 / 不适用，其它一律按「未核实」并 warning
 */
const fs = require('fs');
const path = require('path');
const C = require('./lib/common');

const warnings = [];
const VALUE_OPTS = ['result', 'notes', 'object', 'out'];
const FLAG_OPTS = ['help'];

/** 判定来源：本技能的规则引擎脚本（bridge.json 的 meta.source） */
const SOURCE = 'precheck.js';
const SOURCE_CN = '规则引擎 precheck.js';
const OUT_MD = 'permit-precheck-bridge.md';
const TITLE = '作业票预检结果（车间自查）';
const OBJECT_LABEL = '作业票';
const ACTION = '预检';
const DECLARATION = '预检为辅助自查，不替代安全部门审批；票据是否签发以审批人意见为准。';
const SEV_CN = { must_fix: '必须整改', should_improve: '建议完善', undetermined: '未判定', pass: '通过' };
const NOTE_ITEMS = [
  { item: '设备交出条件', skill: 'equipment-handover-check' },
  { item: '同区域交叉作业', skill: 'cross-operation-conflict' },
  { item: '承包商资质', skill: 'contractor-qualification-check' },
];
const NOTE_STATUS = ['已核实', '未核实', '不适用'];
/**
 * 规则引擎 type 取值 → 《中国石化作业许可管理规定》八大类名称。
 * type 枚举沿用 GB 30871 的「动火」，即中石化的「用火作业」。只用于在报告里加注作业许可类别，type 原值照搬保留，不改写。
 */
const PERMIT_TYPE_CN = {
  '动火': '用火作业', '用火': '用火作业', '受限空间': '受限空间作业', '高处': '高处作业', '吊装': '吊装作业',
  '临时用电': '临时用电作业', '动土': '动土作业', '断路': '断路作业', '盲板抽堵': '盲板抽堵作业',
};

const esc = (v) => C.str(v).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

function main() {
  const a = C.parseArgs(process.argv.slice(2), VALUE_OPTS, FLAG_OPTS);
  if (!a.result) throw new Error('缺少 --result（规则引擎 precheck.js 产出的 result.json）');
  if (!fs.existsSync(a.result)) throw new Error(`规则引擎结果文件不存在: ${a.result}`);
  const outDir = a.out || path.join(require('os').tmpdir(), 'ppb-out');
  let src;
  try { src = JSON.parse(fs.readFileSync(a.result, 'utf8')); } catch (e) { throw new Error(`规则引擎结果文件解析失败: ${e.message}`); }
  if (!src || typeof src !== 'object' || !Array.isArray(src.findings)) throw new Error('规则引擎结果格式错误：缺少 findings 数组，请确认传入的是 result.json 而不是 summary.json');
  if (!src.disclaimer) warnings.push('规则引擎结果无 disclaimer 字段，合并报告只能保留本技能声明行');

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

  const objectName = a.object || src.permit_no || src.project || '（未提供）';
  if (src.type && !PERMIT_TYPE_CN[C.str(src.type)]) warnings.push(`规则引擎作业类型「${C.str(src.type)}」不在作业许可八大类对照表中，报告未加注类别，type 原值照搬`);
  const nonConform = findings.filter((f) => f.severity === 'must_fix' || f.severity === 'should_improve');
  const undetermined = findings.filter((f) => f.severity === 'undetermined');
  const passed = findings.filter((f) => f.severity === 'pass');
  const others = findings.filter((f) => counts[f.severity] === undefined);

  C.ensureDir(outDir);
  const result = {
    meta: { source: SOURCE, resultFile: a.result, objectName, generatedAt: C.localDateTime(), declaration: DECLARATION, sourceDisclaimer: src.disclaimer || null },
    sourceSummary: src.summary || null,
    sourceMeta: {
      permit_no: src.permit_no ?? null, type: src.type ?? null,
      permitCategory: src.type ? (PERMIT_TYPE_CN[C.str(src.type)] || null) : null,
      level: src.level ?? null, now: src.now ?? null, project: src.project ?? null, unit: src.unit ?? null,
    },
    counts, findings, workshopNotes, skipped: src.skipped || [], extractionNotes: src.extraction_notes || [], warnings,
  };
  fs.writeFileSync(path.join(outDir, 'bridge.json'), JSON.stringify(result, null, 2), 'utf8');

  const L = [];
  L.push(`# ${TITLE}`);
  L.push('');
  L.push(`判定来源：${SOURCE_CN}　｜　${OBJECT_LABEL}：${objectName}`);
  L.push(`自查时间：${C.localDateTime()}（北京时间）　｜　判定结果文件：${path.basename(a.result)}`);
  L.push('');
  L.push(`## 一、${ACTION}结论（引自${SOURCE_CN}）`);
  L.push('');
  L.push('> 以下内容原文引自规则引擎判定结果，本报告未做任何改写。');
  L.push('');
  L.push(`共检查 ${findings.length} 项：必须整改 ${counts.must_fix} 项，建议完善 ${counts.should_improve} 项，未判定 ${counts.undetermined} 项，通过 ${counts.pass} 项${counts.other ? `，其它级别 ${counts.other} 项` : ''}。`);
  const META_CN = { permit_no: '票号（permit_no）', type: '作业类型（type，规则引擎取值）', permitCategory: '作业许可八大类（本技能加注）', level: '作业级别（level，以票面为准）', now: '预检基准时间（now）', project: '项目（project）', unit: '单位（unit）' };
  const metaRows = Object.entries(result.sourceMeta).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => [META_CN[k] || k, esc(v)]);
  if (metaRows.length) { L.push(''); L.push(C.mdTable(['规则引擎字段', '值'], metaRows)); }
  if (result.sourceMeta.permitCategory === '用火作业') L.push('注：作业类型与规则原文沿用 GB 30871-2022 的「动火」一词，即《中国石化作业许可管理规定》的「用火作业」；为保证可追溯，规则原文照搬不替换。');
  if (counts.undetermined) L.push('【注意】未判定项既不代表符合，也不代表不符合，需补齐信息后重新' + ACTION + '。');
  L.push('');

  L.push('## 二、不符合项（必须整改 / 建议完善）');
  L.push('');
  if (!nonConform.length) L.push('_规则引擎结果中无必须整改与建议完善项。_\n');
  else {
    L.push(C.mdTable(['序号', '规则编号', '级别', '不符合内容（原文）', '详情（原文）', '依据（原文）'],
      nonConform.map((f, i) => [i + 1, esc(f.rule_id), SEV_CN[f.severity], esc(f.message), esc(f.detail), esc(f.basis)])));
    L.push('> 逐条照搬规则引擎结果，未合并、未归类、未调整级别。');
    L.push('');
  }

  L.push('## 三、未判定项');
  L.push('');
  if (!undetermined.length) L.push('_无。_\n');
  else {
    L.push(C.mdTable(['序号', '规则编号', '未判定内容（原文）', '缺失字段（原文）', '依据（原文）'],
      undetermined.map((f, i) => [i + 1, esc(f.rule_id), esc(f.message), esc(f.detail), esc(f.basis)])));
    L.push('> 【未判定】以上各项保持规则引擎的「未判定」状态，本报告不改写为符合或不符合；补齐字段后重新运行 precheck.js。');
    L.push('');
  }
  if (others.length) {
    L.push(C.mdTable(['规则编号', '级别（原文）', '内容（原文）'], others.map((f) => [esc(f.rule_id), esc(f.severity), esc(f.message)])));
    L.push('');
  }

  L.push('## 四、通过项');
  L.push('');
  if (!passed.length) L.push('_无。_\n');
  else {
    // 检查项取规则库的正向名称 check_name（与 precheck.js 的 report.md 一致）；message 原文照列，不改写
    L.push(C.mdTable(['规则编号', '检查项（原文）', '内容（原文）'], passed.map((f) => [esc(f.rule_id), esc(f.check_name) || '—', esc(f.message)])));
    L.push('');
  }

  L.push('## 五、车间侧补充提示（非规则判定）');
  L.push('');
  L.push('> **以下为车间设备员关注项，不参与上述合规判定，不影响规则引擎结论。**');
  L.push('');
  L.push(C.mdTable(['检查项', '状态', '说明', '可接技能'],
    workshopNotes.map((n) => [n.item, n.status === '未核实' ? '**未核实**' : n.status, esc(n.note) || (n.status === '未核实' ? `建议用 ${n.skill} 核对` : ''), n.skill])));
  L.push('');

  L.push('## 六、整改建议');
  L.push('');
  if (!nonConform.length && !undetermined.length) L.push('_无需整改项；仍须由审批人按程序审批。_\n');
  else {
    let k = 0;
    for (const f of nonConform) L.push(`${++k}. 【${SEV_CN[f.severity]}】${f.rule_id}：${C.str(f.message)}${f.advice ? '；建议：' + C.str(f.advice) : ''}`);
    for (const f of undetermined) L.push(`${++k}. 【未判定】${f.rule_id}：${C.str(f.detail) || C.str(f.message)}，补齐后重新${ACTION}`);
    L.push('');
  }

  if (result.extractionNotes.length) {
    L.push('## 附：抽取备注（原文，需人工确认）');
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
  L.push('（模型在此补充车间侧说明：必须整改、建议完善与未判定项数量，车间提示项，下一步整改重点；不得复述或改写判定结论。）');
  L.push('<!-- ANALYSIS_END -->');
  fs.writeFileSync(path.join(outDir, OUT_MD), L.join('\n'), 'utf8');

  C.emitOk(outDir, { ok: true, out: outDir, source: SOURCE, objectName, counts, warnings });
}

try { main(); } catch (e) { C.fail(e, warnings); }
