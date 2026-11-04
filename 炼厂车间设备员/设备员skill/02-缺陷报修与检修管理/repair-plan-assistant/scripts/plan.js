#!/usr/bin/env node
'use strict';
/**
 * 检修方案辅助编制脚本（中石化体系炼化厂车间设备员口径，仅 Node.js 内置模块）
 * 用法：node "<技能目录>/scripts/plan.js" --equip-type "<设备类型>" --tag "<位号>" --scope "<检修内容>" [--out <dir>]
 * 可选：--spec <厂内规程或说明书路径 .md/.txt/.docx> --model <规格型号> --duration <工期天数> --last <上次检修记录>
 *       --name <设备名称> --workshop <车间> --level <大检修|日常维修|抢修|专项>（旧值 大修/中修/小修 作别名） --start <YYYY-MM-DD>
 *       --dismantle <是|否>（不给则由检修内容判定，判不出按未判定）
 * 产出：<out>/plan.json、plan.md、summary.json；末行打印 JSON 摘要
 *
 * 硬约束：
 *   1. 具体数值（力矩、间隙、公差、试压值、对中偏差）只引用 --spec 原文并注明出处；
 *      无出处一律写「待查规程确认」并进 toBeConfirmed，脚本内不存任何凭经验的数值。
 *   2. 设备类型不在覆盖范围 → 只出通用框架 + warning，标「待技术人员补充」。
 *   3. 厂内规程与通用口径冲突 → 以厂内规程为准，冲突点列入 conflicts 供用户确认。
 *   4. 声明行原文写入 md，不得删改。
 *   5. 安全措施章节提示接 overhaul-process-check-bridge 核查。
 */
const fs = require('fs');
const path = require('path');
const C = require('./lib/common');
const R = require('./lib/rules');

const warnings = [];
const VALUE_OPTS = ['equip-type', 'tag', 'scope', 'out', 'spec', 'model', 'duration',
  'last', 'name', 'workshop', 'level', 'start', 'dismantle'];
const FLAG_OPTS = ['help'];

const DECLARATION = '本方案为辅助生成的初稿，须经技术负责人审核批准、并按厂内规定完成安全措施审查与作业许可后方可实施';
const SAFETY_NOTE = '本方案不做安全措施的合规性判定。安全措施是否齐全、是否符合厂内规定，须接 `overhaul-process-check-bridge` 技能逐项核查；作业票办理与预检接 `permit-precheck-bridge`。';
const DISCLAIMER = '本材料由脚本汇总、模型成文，仅供设备员复核参考，不替代审批、定性、验收与签字；厂内制度与系统数据为准。';

/** 读取厂内规程正文 → [{line, text}]；.docx 走 docx-lite，其余按文本 */
function loadSpec(p) {
  if (!fs.existsSync(p)) throw new Error(`厂内规程/说明书不存在: ${p}`);
  const ext = path.extname(p).toLowerCase();
  let text;
  if (ext === '.docx') {
    const lite = require('./lib/docx-lite');
    try { text = lite.docxToText(fs.readFileSync(p)).text; }
    catch (e) { throw new Error(`厂内规程解析失败（${path.basename(p)}）: ${e.message}`); }
  } else if (ext === '.pdf') {
    // 脚本不解析 PDF：宁可缺数值也不猜
    throw new Error('脚本不读 PDF：请先用平台 pdf 技能把规程转为 txt/docx 再传入 --spec（扫描件需先 OCR）');
  } else {
    text = fs.readFileSync(p, 'utf8');
  }
  const lines = [];
  text.split(/\r?\n/).forEach((t, i) => { if (t.trim()) lines.push({ line: i + 1, text: t }); });
  if (!lines.length) throw new Error(`厂内规程「${path.basename(p)}」内容为空，未提取到任何文字`);
  return lines;
}

function main() {
  const a = C.parseArgs(process.argv.slice(2), VALUE_OPTS, FLAG_OPTS);
  if (!a['equip-type']) throw new Error('缺少 --equip-type（设备类型）');
  if (!a.tag) throw new Error('缺少 --tag（设备位号）');
  if (!a.scope) throw new Error('缺少 --scope（检修内容）');
  const outDir = a.out || path.join(require('os').tmpdir(), 'rpa-out');

  let startDate = null;
  if (a.start) {
    startDate = C.normDate(a.start);
    if (!startDate) throw new Error(`--start 「${a.start}」不是有效日期，应为 YYYY-MM-DD`);
  }
  let duration = null;
  if (a.duration !== undefined) {
    const d = Number(String(a.duration).trim());
    if (!Number.isFinite(d) || d <= 0) throw new Error(`--duration 「${a.duration}」不是有效的工期天数`);
    duration = d;
  } else {
    warnings.push('未提供计划工期（--duration），方案中工期一栏留「—」，不按经验估算');
  }
  const endDate = (startDate && duration !== null) ? C.addDays(startDate, Math.ceil(duration) - 1) : null;

  // ---- 厂内规程
  let specLines = null, specName = null;
  if (a.spec) {
    specLines = loadSpec(a.spec);
    specName = path.basename(a.spec);
  } else {
    warnings.push('未提供厂内规程或设备说明书（--spec），方案中全部具体数值一律标「待查规程确认」，不得凭经验填写');
  }

  // ---- 设备类型与覆盖范围
  const equip = R.classifyEquip(a['equip-type'], a.name);
  const covered = R.COVERED.includes(equip);
  if (!covered) {
    warnings.push(`设备类型「${a['equip-type']}」不在本技能覆盖范围（泵类 / 机组类 / 静设备 / 阀门 / 电气 / 加热炉 / 空冷器 / 仪表回路）内，只输出通用检修框架，具体拆装步骤、力矩值与间隙标准须由技术人员补充，模型不得凭通用知识填充`);
  }

  // ---- 是否解体（三态，不默认）
  let dismantle = R.tri(a.dismantle);
  if (dismantle === null && a.dismantle !== undefined && a.dismantle !== '') {
    warnings.push(`--dismantle 「${a.dismantle}」无法识别为是/否，改由检修内容判定`);
  }
  if (dismantle === null) dismantle = R.isDismantle(a.scope);
  if (dismantle === null) {
    warnings.push(`检修内容「${a.scope}」中未出现解体类或非解体类词，是否解体未判定，相关步骤已单列未判定项，不按「不解体」处理`);
  }

  // ---- 检修等级
  const level = R.classifyLevel(a.scope, a.level);
  if (!level) warnings.push('未识别出检修分级（大检修/日常维修/抢修/专项），方案中分级一栏留「—」');
  if (a.level && level && (R.LEVEL_ALIASES[String(a.level).trim()] || (/^(大修|中修|小修)$/.test(String(a.level).trim())))) warnings.push(`--level「${a.level}」为旧口径（大修/中修/小修已废止），已按别名归入「${R.LEVEL_CN[level]}」`);
  else if (level && !R.classifyLevel('', a.level)) {
    // 分级来自检修内容文字：其中的旧口径词同样提示已归并
    const old = (String(a.scope || '').match(/大修|(?<!集)中修|小修/) || [])[0];   // 「集中修复」不算旧口径「中修」
    if (old && R.classifyLevel(old, '') === level) warnings.push(`检修内容中的「${old}」为旧口径（大修/中修/小修已废止），已按别名归入「${R.LEVEL_CN[level]}」`);
  }

  const ctx = { equip, dismantle, level, specLines, specName };
  const built = R.buildPlan(ctx);
  const hse = R.buildHse(ctx);
  const { steps, undetermined, toBeConfirmed, conflicts, tools, spares, qcPoints, acceptance } = built;

  if (conflicts.length) {
    warnings.push(`厂内规程「${specName}」中检出 ${conflicts.length} 处同类数值表述不一致，已列入 conflicts，须由技术人员确认后方可采用；一律以厂内规程为准，不得引入通用口径`);
  }
  if (toBeConfirmed.length) {
    warnings.push(`共 ${toBeConfirmed.length} 处具体数值无规程出处，已全部标「${R.TBC}」并单列，**不得凭经验填写**`);
  }

  // ---- 计数
  const counts = {
    steps: steps.length,
    stepsUndetermined: undetermined.length,
    tools: tools.length,
    spares: spares.length,
    qcPoints: qcPoints.length,
    qcHold: qcPoints.filter((x) => x.hold).length,
    acceptance: acceptance.length,
    toBeConfirmed: toBeConfirmed.length,
    conflicts: conflicts.length,
    valueCited: steps.filter((x) => x.valueSource === 'spec').length
      + qcPoints.filter((x) => x.standardSource === 'spec').length
      + acceptance.filter((x) => x.criterionSource === 'spec').length,
  };

  if (counts.valueCited > 0) {
    warnings.push(`共 ${counts.valueCited} 处数值引用了厂内规程原文（按数值类型关键词定位、逐字摘录，脚本不做换算或归纳）；**引用条款是否对应该步骤的具体部位须由技术人员逐条核对**`);
  }

  // ---- 产出 JSON
  C.ensureDir(outDir);
  const result = {
    meta: {
      tag: a.tag, name: a.name || null, equipType: a['equip-type'],
      equipKey: equip, equipCn: R.EQUIP_CN[equip], covered,
      model: a.model || null, scope: a.scope,
      level, levelCn: level ? R.LEVEL_CN[level] : null,
      dismantle, duration, startDate, endDate,
      workshop: a.workshop || null, lastRepair: a.last || null,
      specFile: specName, specLines: specLines ? specLines.length : 0,
      generatedAt: C.localDateTime(),
      declaration: DECLARATION,
      safetyNote: SAFETY_NOTE,
      disclaimer: DISCLAIMER,
    },
    hse,
    counts, steps, undetermined, tools, spares, qcPoints, acceptance, toBeConfirmed, conflicts, warnings,
  };
  fs.writeFileSync(path.join(outDir, 'plan.json'), JSON.stringify(result, null, 2), 'utf8');

  // ---- Markdown
  const L = [];
  const title = `${a.tag}${a.name ? ' ' + a.name : ''}`;
  L.push(`# 检修方案（初稿）　${title}`);
  L.push('');
  L.push(`> ${DISCLAIMER}`);
  L.push(`> **${DECLARATION}。**`);
  L.push('');
  if (!covered) {
    L.push(`【注意】**设备类型「${a['equip-type']}」不在本技能覆盖范围内**，以下仅为通用检修框架。具体拆装步骤、力矩值、间隙标准与专业质量控制点**须由技术人员按厂内规程补充**，不得凭通用知识填充。`);
    L.push('');
  }
  if (toBeConfirmed.length) {
    L.push(`【注意】**本方案有 ${toBeConfirmed.length} 处具体数值无规程出处，已标「${R.TBC}」**（见第八节）。补齐前不得据此施工。`);
    L.push('');
  }

  // 一、检修概况
  L.push('## 一、检修概况');
  L.push('');
  L.push(C.mdTable(['项目', '内容'], [
    ['位号', a.tag],
    ['设备名称', a.name || '—'],
    ['设备类型', `${a['equip-type']}（归类：${R.EQUIP_CN[equip]}${covered ? '' : '，**覆盖范围外**'}）`],
    ['规格型号', a.model || '—'],
    ['所属车间', a.workshop || '—'],
    ['检修分级', level ? R.LEVEL_CN[level] : '—（未识别）'],
    ['计划开工', startDate || '—'],
    ['计划工期', duration === null ? '—（未提供）' : `${C.fmt(duration)} 天${endDate ? `（至 ${endDate}）` : ''}`],
    ['上次检修情况', a.last || '—'],
    ['引用规程', specName ? `${specName}（有效文字 ${specLines.length} 行）` : '**未提供**，全部数值标「待查规程确认」'],
    ['生成时间', `${C.localDateTime()}（北京时间）`],
  ]));

  // 二、检修范围与内容
  L.push('## 二、检修范围与内容');
  L.push('');
  L.push(C.mdTable(['项目', '内容'], [
    ['检修内容', a.scope],
    ['是否解体', dismantle === null ? '**未判定**（检修内容未说明，相关步骤见第八节）' : (dismantle ? '是' : '否')],
    ['步骤总数', `${counts.steps} 条（其中未判定 ${counts.stepsUndetermined} 条）`],
    ['质量控制点', `${counts.qcPoints} 项（停工待检点 ${counts.qcHold} 项）`],
    ['验收项', `${counts.acceptance} 项`],
  ]));
  L.push('**安全措施**：' + SAFETY_NOTE);
  L.push('');
  L.push('<!-- ANALYSIS_START -->');
  L.push('（此处由设备员结合设备实际状况、上次检修情况与本次缺陷表现，补写 200~400 字的检修必要性与范围说明；数量与判定一律引用 plan.json，不得自行统计。）');
  L.push('<!-- ANALYSIS_END -->');
  L.push('');

  // 三、JSA/风险分析与 HSE 措施（占位）
  L.push('## 三、JSA/风险分析与 HSE 措施（占位）');
  L.push('');
  L.push(C.mdTable(['项目', '内容'], [
    ['JSA/风险分析编号', hse.jsa.no], ['分析日期', hse.jsa.date], ['参加人', hse.jsa.participants],
    ['主要危害因素', hse.jsa.mainRisks], ['风险等级', hse.jsa.riskLevel],
  ]));
  L.push('**作业许可（八大类）**');
  L.push('');
  L.push(C.mdTable(['作业类别', '是否涉及', '级别'], hse.permits.map((p) => [p.type, p.involved, p.level])));
  L.push('**双监护与属地确认**');
  L.push('');
  L.push(C.mdTable(['角色', '姓名'], [['属地监护人', hse.supervision.siteGuardian], ['作业单位监护人', hse.supervision.contractorGuardian], ['属地确认人', hse.supervision.confirmer]]));
  L.push(`【注意】${hse.supervision.note}。`);
  L.push('');
  L.push('**HSE 措施**');
  L.push('');
  L.push(C.mdTable(['措施项', '内容'], hse.measures.map((m) => [m.item, m.content])));
  L.push(`【注意】${hse.note}`);
  L.push('');

  // 四、施工准备
  L.push('## 四、施工准备');
  L.push('');
  L.push('### 4.1 工机具与量具');
  L.push('');
  L.push(C.mdTable(['序号', '工机具 / 量具', '用途', '配置要求'],
    tools.map((t, i) => [i + 1, t.name, t.use, t.spec])));
  L.push('【注意】量具须在检定有效期内；规格与量程按设备实际尺寸由技术人员确定，本表不给具体数值。');
  L.push('');
  L.push('### 4.2 备件与材料');
  L.push('');
  L.push(C.mdTable(['序号', '备件 / 材料', '需用情形', '说明'],
    spares.map((s, i) => [i + 1, s.name, s.when, s.note])));
  L.push('【注意】备件型号、材质与数量按设备型号与图号核对确定，本表不预填规格与数量；库存与到货情况接 `spare-parts-inventory-query`。');
  L.push('');
  L.push('### 4.3 人员与资质');
  L.push('');
  L.push(C.mdTable(['岗位', '职责', '资质要求'], [
    ['检修负责人', '组织实施、过程控制、质量控制点确认', '由技术负责人指定'],
    ['技术负责人', '方案审核批准、技术问题裁定、变更审批', '按厂内规定'],
    ['专业技术人员', '数据判定、修复方案确定、待确认数值查证', '按厂内规定'],
    ['检修作业人员', '按步骤实施', '特种作业人员须持证'],
    ['属地监护人 / 作业单位监护人', '双监护，全程监护、安全措施落实确认', '按厂内规定，两方均须到位'],
  ]));
  L.push('');

  // 五、作业步骤
  L.push('## 五、作业步骤');
  L.push('');
  for (const ph of R.PHASE_ORDER) {
    const list = steps.filter((x) => x.phase === ph);
    if (!list.length) continue;
    L.push(`### ${R.PHASE_CN[ph]}`);
    L.push('');
    L.push(C.mdTable(['序号', '步骤号', '作业步骤', '数值要求与出处', '注意事项'],
      list.map((x) => [x.no, x.stepId,
        x.title + (x.status === 'undetermined' ? '　**【未判定】**' : ''),
        valueCell(x), x.note])));
  }
  L.push('【注意】数值要求一栏：标注出处的为厂内规程/说明书**原文摘录**（按数值类型关键词定位，脚本不做换算、取整或归纳），引用是否对应本步骤的具体部位须由技术人员核对；标「**' + R.TBC + '**」的为无出处项，**不得凭经验填写**，见第八节。');
  L.push('');

  // 六、质量控制点
  L.push('## 六、质量控制点');
  L.push('');
  L.push(C.mdTable(['序号', '控制点号', '阶段', '控制内容', '检查方法', '合格标准与出处', '停工待检'],
    qcPoints.map((q) => [q.no, q.qcId, q.phaseCn, q.item, q.method,
      q.standardSource === 'spec' ? `${q.standard}　（出处：${q.citation}）`
        : (q.standardSource === 'tbc' ? `**${R.TBC}**` : q.standard),
      q.hold ? '**是**' : '否'])));
  L.push('【注意】停工待检点未经确认签字不得转入下道工序。本表供 `completion-acceptance` 三级验收比对。');
  L.push('');

  // 七、验收标准
  L.push('## 七、验收标准');
  L.push('');
  L.push(C.mdTable(['序号', '验收项号', '验收项目', '判据与出处'],
    acceptance.map((x) => [x.no, x.acId, x.item,
      x.criterionSource === 'spec' ? `${x.criterion}　（出处：${x.citation}）`
        : (x.criterionSource === 'tbc' ? `**${R.TBC}**` : x.criterion)])));
  L.push('【注意】验收项与第六节质量控制点配套，供 `completion-acceptance` 三级验收（班组/车间/公司设备管理部门，工艺参与）逐项比对；**带「' + R.TBC + '」的判据补齐前不得判定验收合格**。');
  L.push('');

  // 八、待确认事项
  L.push('## 八、待确认事项');
  L.push('');
  L.push('### 8.1 无出处的具体数值');
  L.push('');
  if (!toBeConfirmed.length) {
    L.push('_无。方案中全部具体数值均有厂内规程或说明书出处。_\n');
  } else {
    L.push(C.mdTable(['序号', '出处位置', '阶段', '数值类型', '所在内容', '未取到的原因', '应采取的措施'],
      toBeConfirmed.map((t, i) => [i + 1, t.stepId, t.phaseCn, t.valueKindCn, t.where, t.reason, t.action])));
    L.push(`【注意】以上各项一律标「**${R.TBC}**」。**绝不填写凭经验的数值** —— 方案里写错一个力矩值，现场就按错的做。`);
    L.push('');
  }

  L.push('### 8.2 厂内规程与通用口径冲突点');
  L.push('');
  if (!conflicts.length) {
    L.push('_无。未检出规程内数值表述不一致。_\n');
  } else {
    L.push(C.mdTable(['序号', '数值类型', '表述一', '表述二', '处理口径'],
      conflicts.map((c, i) => [i + 1, c.valueKindCn,
        `${c.a.quote}（第 ${c.a.line} 行${c.a.general ? '，通用口径表述' : ''}）`,
        `${c.b.quote}（第 ${c.b.line} 行${c.b.general ? '，通用口径表述' : ''}）`,
        '**一律以厂内规程为准**，请技术人员确认采用哪一条'])));
    L.push('【注意】冲突点未经确认前，相关步骤按「待查规程确认」处理，不得任选其一。');
    L.push('');
  }

  L.push('### 8.3 未判定的作业步骤');
  L.push('');
  if (!undetermined.length) {
    L.push('_无。全部步骤的判定依据齐全。_\n');
  } else {
    L.push(C.mdTable(['序号', '步骤号', '阶段', '步骤', '缺失的判定依据'],
      undetermined.map((u) => [u.no, u.stepId, u.phaseCn, u.title, u.missing])));
    L.push('【注意】以上步骤因判定依据缺失暂未确定是否执行，**不得按「不需要」删除**；补齐信息后重新生成方案。');
    L.push('');
  }

  if (!covered) {
    L.push('### 8.4 待技术人员补充的内容');
    L.push('');
    L.push(C.mdTable(['待补充内容', '说明'], [
      ['解体与回装的具体步骤', `设备类型「${a['equip-type']}」不在覆盖范围，本方案未给出专业拆装步骤`],
      ['力矩值、间隙标准、公差与试压值', '须查厂内规程或设备说明书，**不得凭通用知识填充**'],
      ['专业质量控制点与验收判据', '须由技术人员按设备特性补充'],
      ['专用工机具与备件', '须按设备型号与图号确定'],
    ]));
    L.push('');
  }

  L.push('---');
  L.push('');
  L.push(`**${DECLARATION}。**`);
  L.push('');
  L.push(`> ${DISCLAIMER}`);
  L.push('');

  if (warnings.length) {
    L.push('## 附：数据提示');
    L.push('');
    for (const w of warnings) L.push(`- ${w}`);
    L.push('');
  }
  fs.writeFileSync(path.join(outDir, 'plan.md'), L.join('\n'), 'utf8');

  C.emitOk(outDir, {
    ok: true, out: outDir, tag: a.tag, equipType: a['equip-type'], equipCn: R.EQUIP_CN[equip],
    covered, counts, warnings,
  });
}

/** 数值要求单元格：有出处写原文 + 出处；无出处写「待查规程确认」；无数值要求写 — */
function valueCell(x) {
  if (x.valueSource === 'spec') return `${x.valueText}　（出处：${x.valueCitation}）`;
  if (x.valueSource === 'tbc') return x.valueText;
  return '—';
}

try { main(); } catch (e) { C.fail(e, warnings); }
