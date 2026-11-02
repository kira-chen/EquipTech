#!/usr/bin/env node
'use strict';
/**
 * 操作工设备异常识别与上报指引卡（仅 Node.js 内置模块）
 * 用法：node scripts/guide.js --scope "<设备类型或范围>" --workshop "车间" --report-to "<上报对象>" [--out <dir>]
 * 可选：--ledger <设备清单xlsx> --spec <操作规程或应急预案> --emergency "<紧急上报方式>" --format <卡片|手册>
 *       --actions "<自拟处置动作,逗号分隔>"（会被职责边界校验拦截超范围项）
 *       --no-touch：去掉全部「摸」类观察点与依赖手摸的异常特征（厂内规程禁止手摸设备时用）
 * 产出：<out>/guide.json、指引卡.md、summary.json
 *
 * 硬约束：指引内容严格限定在操作工职责范围内；超范围动作一律改为「停止操作并上报」。
 * 口径：本材料为设备专业建议稿，由车间工艺/安全审核后纳入岗位操作法或 HSE 作业指导书；不替代操作规程与应急预案。
 */
const fs = require('fs');
const path = require('path');
const { readXlsx, readCsvDir } = require('./lib/xlsx-lite');
const C = require('./lib/common');
const S = require('./lib/scope');

const warnings = [];
const VALUE_OPTS = ['scope', 'workshop', 'report-to', 'out', 'ledger', 'spec', 'emergency', 'format', 'actions'];
const FLAG_OPTS = ['help', 'no-touch'];

// 局部别名在前，再合并共享 SYSTEM_ALIASES（SAP PM / EM 导出列名：功能位置、设备描述、对象类型、工厂区段…）。
// 注意：共享表里「设备编号」是 SAP 8 位流水号，不是位号，局部别名不再把「设备编号」当位号。
const ALIASES = C.mergeAliases({
  '位号': ['位号', '设备位号', 'TAG'],
  '设备名称': ['设备名称', '名称'],
  '设备类型': ['设备类型', '类型', '设备类别', '对象类型', '设备分类', '专业类别'],
  '区域': ['区域', '装置区', '位置', '装置', '工厂区段', '单元', '装置名称', '生产单元'],
});

function loadBook(p) { return fs.statSync(p).isDirectory() ? readCsvDir(p) : readXlsx(p); }

function main() {
  const a = C.parseArgs(process.argv.slice(2), VALUE_OPTS, FLAG_OPTS);
  if (!a.workshop) throw new Error('缺少 --workshop');
  if (!a['report-to']) throw new Error('缺少 --report-to（上报对象）；上报路径必须由厂内实际流程提供，脚本不自行设定');
  if (!a.scope && !a.ledger) throw new Error('缺少 --scope（设备类型或范围）或 --ledger（设备清单）');
  const format = a.format || '卡片';
  if (!['卡片', '手册'].includes(format)) throw new Error(`--format 只能是 卡片 / 手册，收到「${format}」`);
  const outDir = a.out || path.join(require('os').tmpdir(), 'oag-out');
  const noTouch = !!a['no-touch'];

  // ---- 设备范围：从清单或从 --scope 文本
  const types = new Map();   // type -> [{tag,name,area}]
  if (a.ledger) {
    if (!fs.existsSync(a.ledger)) throw new Error(`设备清单不存在: ${a.ledger}`);
    const rows = C.pickSheet(loadBook(a.ledger), '设备台账', '设备清单', '台账', '设备');
    if (!rows) throw new Error('设备清单文件中未找到「设备台账」工作表');
    const recs = C.toRecords(rows, ['位号'], '设备台账', ['设备名称', '设备类型', '区域'], warnings, ALIASES);
    for (const r of recs) {
      const tag = C.str(r['位号']);
      if (!tag) { warnings.push(`工作表「设备台账」第${r._row}行 位号为空，已跳过`); continue; }
      const declared = C.str(r['设备类型']);
      const t = declared ? S.typeOf(declared) : S.typeOf(C.str(r['设备名称']));
      if (!types.has(t)) types.set(t, []);
      types.get(t).push({ tag, name: C.str(r['设备名称']), area: C.str(r['区域']) });
    }
    if (!types.size) throw new Error('设备清单中没有有效设备行');
  }
  if (a.scope) {
    for (const piece of a.scope.split(/[,，、]/).map((x) => x.trim()).filter(Boolean)) {
      const t = S.typeOf(piece);
      if (t === '通用' && !/通用|全部|所有/.test(piece)) {
        warnings.push(`设备类型「${piece}」不在覆盖范围内，已归入通用框架；具体观察要点待安全专业补充`);
      }
      if (!types.has(t)) types.set(t, []);
    }
  }

  // ---- 自拟处置动作的职责边界校验
  let actionCheck = null;
  if (a.actions) {
    const list = a.actions.split(/[,，;；]/).map((x) => x.trim()).filter(Boolean);
    actionCheck = S.checkAll(list);
    for (const b of actionCheck.blocked) {
      warnings.push(`处置动作「${b.original}」超出操作工职责范围（${b.ruleId}：${b.reason}），已替换为「${b.suggestion}」`);
    }
  }

  // ---- 按设备类型生成要点
  const sections = [];
  let touchPointsRemoved = 0, touchSignsRemoved = 0;
  for (const [type, list] of types) {
    const ob = S.OBSERVE[type] || S.OBSERVE['通用'];
    const covered = !!S.OBSERVE[type] && type !== '通用';
    // 职责内动作：白名单 + 通过校验的自拟动作
    const actions = S.IN_SCOPE.slice(0, 6);
    if (actionCheck) for (const k of actionCheck.kept) if (!actions.includes(k)) actions.push(k);
    // 「摸」类观察点：默认逐条加限定语；--no-touch 时整类去掉，连带去掉依赖手摸的异常特征
    const rawTouch = ob['摸'] || [];
    const rawSigns = ob['异常特征'] || [];
    let touch, signs;
    if (noTouch) {
      touch = [];
      signs = rawSigns.filter((x) => !S.TOUCH_SIGN_RE.test(x));
      touchPointsRemoved += rawTouch.length;
      touchSignsRemoved += rawSigns.length - signs.length;
    } else {
      touch = rawTouch.map((x) => `${S.TOUCH_QUALIFIER}：${x}`);
      signs = rawSigns;
    }
    sections.push({
      type, covered,
      equipment: list,
      observe: { 看: ob['看'] || [], 听: ob['听'] || [], 摸: touch, 闻: ob['闻'] || [] },
      abnormalSigns: signs,
      immediateActions: actions,
      actionNote: '切换备用设备、降低负荷须经值班领导/内操同意后按操作规程执行；关闭就地阀门、清理泄漏物仅限操作规程明确授权的情形。',
      note: covered ? null : '该设备类型不在覆盖范围内，仅输出通用框架，具体观察要点待安全专业补充',
    });
  }
  if (noTouch) warnings.push(`已按 --no-touch 去掉 ${touchPointsRemoved} 条「摸」类观察点与 ${touchSignsRemoved} 条依赖手摸的异常特征；温度、振动类异常改由巡检仪/测温枪或车间设备员点检判断`);

  // ---- 上报路径（必须来自用户）
  const reportPath = {
    to: a['report-to'],
    emergency: a.emergency || null,
    elements: ['报告人岗位与姓名', '设备位号与名称', '发现时间', `看到/听到/${noTouch ? '' : '摸到/'}闻到的具体现象`, '当前设备是否还在运行', '是否已采取的动作（如已通知谁）', '现场是否有人员、是否设置警戒'],
    note: a.emergency ? null : '未提供紧急上报方式（--emergency），紧急情况一节按应急预案执行，请补充厂内实际号码与流程',
  };
  if (!a.emergency) warnings.push('未提供紧急上报方式（--emergency），指引卡中该项留待补充');

  const counts = {
    types: sections.length,
    covered: sections.filter((x) => x.covered).length,
    uncovered: sections.filter((x) => !x.covered).length,
    observePoints: sections.reduce((n, s) => n + Object.values(s.observe).reduce((m, v) => m + v.length, 0), 0),
    abnormalSigns: sections.reduce((n, s) => n + s.abnormalSigns.length, 0),
    blockedActions: actionCheck ? actionCheck.blocked.length : null,
    equipment: [...types.values()].reduce((n, v) => n + v.length, 0),
    touchPointsRemoved: noTouch ? touchPointsRemoved : null,
    touchSignsRemoved: noTouch ? touchSignsRemoved : null,
  };

  // ---- 产出
  C.ensureDir(outDir);
  const statement = '本材料仅供参考，不替代操作规程与检修规程；为设备专业建议稿，由车间工艺/安全审核后纳入岗位操作法或 HSE 作业指导书，并与厂内操作规程、应急预案一致后发放；遇紧急情况以应急预案为准。';
  const result = {
    meta: { workshop: a.workshop, scope: a.scope || null, format, generatedAt: C.localDateTime(),
      ledgerProvided: !!a.ledger, specProvided: !!a.spec, noTouch, touchQualifier: noTouch ? null : S.TOUCH_QUALIFIER, statement },
    counts, sections, reportPath, emergency: S.EMERGENCY,
    outOfScope: actionCheck ? actionCheck.blocked : null,
    scopeRules: S.OUT_OF_SCOPE.map(([id, , reason]) => ({ ruleId: id, reason })),
    warnings,
  };
  fs.writeFileSync(path.join(outDir, 'guide.json'), JSON.stringify(result, null, 2), 'utf8');

  const L = [];
  L.push(`# ${a.workshop} 设备异常识别与上报指引`);
  L.push('');
  L.push(`发给：岗位操作工　｜　发现异常报告给：**${reportPath.to}**`);
  L.push(`编制：车间设备员（设备专业建议稿）　｜　审核：车间工艺 / 安全　｜　生成时间：${C.localDateTime()}（北京时间）`);
  L.push('');
  L.push('> **这张卡解决四件事：看什么、什么算异常、先做什么、找谁报。**');
  L.push('> 不要求你判断原因，也不要求你动手修。**看到不对，停下来，报上去。**');
  L.push('');
  L.push(`> 【注意】${statement}`);
  L.push('');

  L.push('## 一、什么情况立即撤离并报警');
  L.push('');
  L.push('**以下任一情况，不要犹豫，先撤离到上风向安全区，再报告：**');
  L.push('');
  for (const e of S.EMERGENCY) L.push(`- ${e}`);
  L.push('');
  if (reportPath.emergency) L.push(`紧急上报方式：**${reportPath.emergency}**`);
  else L.push('> 【注意】紧急上报方式待车间补充（厂内报警电话、调度电话、应急指挥）。');
  L.push('');

  let idx = 2;
  const cn = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四', '十五'];
  for (const sec of sections) {
    L.push(`## ${cn[idx - 1]}、${sec.type}`);
    L.push('');
    if (sec.equipment.length) {
      L.push(`**本车间该类设备**：${sec.equipment.slice(0, 12).map((e) => e.tag + (e.name ? `（${e.name}）` : '')).join('、')}${sec.equipment.length > 12 ? ` 等 ${sec.equipment.length} 台` : ''}`);
      L.push('');
    }
    if (!sec.covered) { L.push(`> ${sec.note}`); L.push(''); }
    L.push('**日常观察要点**');
    L.push('');
    for (const k of ['看', '听', '摸', '闻']) {
      if (!sec.observe[k].length) continue;
      L.push(`- **${k}**：`);
      for (const v of sec.observe[k]) L.push(`  - ${v}`);
    }
    if (noTouch) L.push('- 【注意】本卡不含手摸类观察点；温度、振动是否异常以巡检仪/测温枪读数或车间设备员点检为准。');
    L.push('');
    L.push('**什么情况算异常**');
    L.push('');
    for (const v of sec.abnormalSigns) L.push(`- ${v}`);
    L.push('');
    L.push('**发现异常先做什么**');
    L.push('');
    for (const v of sec.immediateActions) L.push(`- ${v}`);
    L.push('');
    L.push(`> 【注意】${sec.actionNote}`);
    L.push(`> 以上动作之外的处置（拆检、调整、更换、堵漏、用火等）**不属于操作工职责**，请勿自行实施。`);
    L.push('');
    idx++;
  }

  L.push(`## ${cn[idx - 1]}、报告要说清的信息`);
  L.push('');
  L.push(`报告给 **${reportPath.to}** 时，把下面几项说清楚：`);
  L.push('');
  for (const e of reportPath.elements) L.push(`- ${e}`);
  L.push('');
  L.push('> 说现象，不用说原因。「泵响得比平时大很多，轴承那里烫手」比「轴承坏了」更有用。');
  L.push('');
  idx++;

  if (actionCheck && actionCheck.blocked.length) {
    L.push(`## ${cn[idx - 1]}、已拦截的超范围动作`);
    L.push('');
    L.push('以下动作超出操作工职责范围，**未写入指引卡**：');
    L.push('');
    L.push(C.mdTable(['原动作', '规则', '原因', '替代'],
      actionCheck.blocked.map((b) => [b.original, b.ruleId, b.reason, b.suggestion])));
    idx++;
  }

  L.push('---');
  L.push('');
  L.push(`> ${statement}`);
  L.push('');
  L.push('> 相关技能：设备员自己做异常初判用 anomaly-triage-advisor；培训讲义与考题用 training-material-generator。');
  L.push('');
  if (warnings.length) {
    L.push('## 附：生成提示');
    L.push('');
    for (const w of warnings) L.push(`- ${w}`);
    L.push('');
  }
  fs.writeFileSync(path.join(outDir, '指引卡.md'), L.join('\n'), 'utf8');

  C.emitOk(outDir, { ok: true, out: outDir, workshop: a.workshop, noTouch, counts, warnings });
}

try { main(); } catch (e) { C.fail(e, warnings); }
