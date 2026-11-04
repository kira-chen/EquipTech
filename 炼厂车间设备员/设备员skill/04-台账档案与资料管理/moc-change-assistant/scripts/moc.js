#!/usr/bin/env node
'use strict';
/**
 * 设备变更管理（MOC）辅助脚本（仅 Node.js 内置模块）—— 中石化《变更管理规定》口径
 * 用法：node scripts/moc.js --tag "<位号>" --before "<原状态>" --after "<变更后状态>" --reason "<变更原因>" [--out <dir>]
 * 可选：--category <材质|型号|结构|工艺|控制|备件代用|管理> --temporary --until <YYYY-MM-DD>
 *       --same-model-material <是|否> --affects-perf <是|否> --exceeds-design <是|否> --special <是|否>
 *       --spec <厂内变更制度xlsx> --ledger <设备台账xlsx或CSV目录> --workshop <车间> --applicant <申请人> --name <设备名称>
 * 产出：<out>/moc.json、moc.md、summary.json
 *
 * 口径：变更分 工艺技术变更 / 设备设施变更 / 管理变更，级别 重大 / 一般，「临时」是属性；同类替换不属于变更，
 *       同规格不同厂家代用建议走材料代用单 / 同类替换评审（是否报变更以厂内制度为准）；
 *       压力容器 / 压力管道结构或材质改动附「改造告知、监督检验、使用登记变更」三项提示；
 *       工艺参数与联锁定值变更由工艺 / 仪表专业提报。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readXlsx, readCsvDir } = require('./lib/xlsx-lite');
const C = require('./lib/common');
const R = require('./lib/rules');

const DECLARATION = '本判定为辅助参考，变更是否成立、变更类型、级别与审批要求以厂内变更管理部门按《中国石化变更管理规定》及厂内实施细则认定为准；未经批准不得实施变更';

const warnings = [];
const VALUE_OPTS = ['tag', 'before', 'after', 'reason', 'out', 'category', 'until',
  'same-model-material', 'affects-perf', 'exceeds-design', 'special', 'spec', 'ledger',
  'workshop', 'applicant', 'name'];
const FLAG_OPTS = ['temporary', 'help'];

// 局部别名优先，再并入共享 SYSTEM_ALIASES（SAP PM / EM 列名）。「设备编号」不作位号别名。
const ALIASES = C.mergeAliases({
  '位号': ['位号', '设备位号', 'TAG', 'tag'],
  '设备名称': ['设备名称', '设备描述', '名称'],
  '材质': ['材质', '主体材质', '材料', '主要材质'],
  '型号': ['型号', '规格型号', '型号编号', '规格'],
  '设计压力': ['设计压力', '设计压力(MPa)', '设计压力MPa'],
  '设计温度': ['设计温度', '设计温度(℃)', '设计温度℃'],
  '介质': ['介质', '工艺介质'],
  '变更类别': ['变更类别', '类别', '细分类别'],
  '变更类型': ['变更类型', '变更大类', '三大类', '类型'],
  '判定': ['判定', '结论', '是否变更', '认定'],
  '变更等级': ['变更等级', '变更级别', '等级', '级别'],
  '条款号': ['条款号', '条款', '制度条款', '编号'],
});

function loadBook(p) { return fs.statSync(p).isDirectory() ? readCsvDir(p) : readXlsx(p); }

/** 厂内制度条款归一化为内部级别 key；无法识别返回 null */
function normLevelWord(v) {
  const s = C.str(v);
  if (!s) return null;
  if (/不属于变更|不需要变更|不走变更|无需变更|同类替换/.test(s)) return 'none';
  if (/代用单|评审|厂内.*为准/.test(s)) return 'review';
  if (/重大/.test(s)) return 'major';
  if (/一般|普通/.test(s)) return 'general';
  return null;
}

function main() {
  const a = C.parseArgs(process.argv.slice(2), VALUE_OPTS, FLAG_OPTS);
  if (!a.tag) throw new Error('缺少 --tag（设备位号）');
  if (!a.before) throw new Error('缺少 --before（原状态）');
  if (!a.after) throw new Error('缺少 --after（变更后状态）');
  const outDir = a.out || path.join(os.tmpdir(), 'moc-out');

  if (a.until) {
    const u = C.normDate(a.until);
    if (!u) throw new Error(`--until 「${a.until}」不是有效日期，应为 YYYY-MM-DD`);
    a.until = u;
    const today = C.localDate();
    if (u < today) warnings.push(`--until ${u} 早于今天（${today}）：恢复期限已过，请核实临时变更是否已恢复原状或已转为正式变更；如是笔误，改正后重新评估`);
  }
  if (!a.reason) warnings.push('未提供 --reason（变更原因），变更申请要点中的必要性说明需补充');
  const specialArg = R.parseBool(a.special);
  if (a.special && specialArg === null) throw new Error(`--special 「${a.special}」无法识别，应为 是/否`);

  // ---- 设备台账（补全设备名称、原材质、设备类别等）
  let equip = null;
  if (a.ledger) {
    if (!fs.existsSync(a.ledger)) throw new Error(`设备台账不存在: ${a.ledger}`);
    const rows = C.pickSheet(loadBook(a.ledger), '设备台账', '台账', '设备清单', '技术对象');
    if (!rows) warnings.push('设备台账文件中未找到「设备台账」工作表，跳过台账比对');
    else {
      const recs = C.toRecords(rows, ['位号'], '设备台账',
        ['设备名称', '材质', '型号', '设计压力', '设计温度', '介质', '设备类别', '设备代码', '设备编号'], warnings, ALIASES);
      const key = a.tag.toLowerCase();
      const hit = recs.find((r) => C.str(r['位号']).toLowerCase() === key || C.str(r['设备编号']).toLowerCase() === key);
      if (!hit) warnings.push(`位号「${a.tag}」不在设备台账中，原状态无法与台账核对`);
      else {
        equip = {
          name: C.str(hit['设备名称']), material: C.str(hit['材质']), model: C.str(hit['型号']),
          designP: C.str(hit['设计压力']), designT: C.str(hit['设计温度']), medium: C.str(hit['介质']),
          category: C.str(hit['设备类别']) || null, equipCode: C.str(hit['设备代码']) || null, equipNo: C.str(hit['设备编号']) || null,
        };
      }
    }
  }

  // ---- 厂内变更制度（可选），用于覆盖默认口径并记录冲突
  let specRules = [];
  if (a.spec) {
    if (!fs.existsSync(a.spec)) throw new Error(`厂内变更制度文件不存在: ${a.spec}`);
    const rows = C.pickSheet(loadBook(a.spec), '变更判定', '判定口径', '变更管理', '制度');
    if (!rows) warnings.push('厂内变更制度文件中未找到「变更判定」工作表，本次按默认口径判定');
    else {
      const recs = C.toRecords(rows, ['变更类别'], '变更判定', ['变更类型', '判定', '变更等级', '条款号'], warnings, ALIASES);
      for (const r of recs) {
        const cat = R.normCategory(C.str(r['变更类别']));
        if (!cat) { warnings.push(`工作表「变更判定」第${r._row}行 变更类别「${C.str(r['变更类别'])}」无法识别，该条制度未采用`); continue; }
        const lvl = normLevelWord(r['变更等级']) || normLevelWord(r['判定']);
        if (!lvl) { warnings.push(`工作表「变更判定」第${r._row}行 变更等级「${C.str(r['变更等级'])}」无法识别，该条制度未采用`); continue; }
        const ct = R.normChangeType(r['变更类型']);
        if (C.str(r['变更类型']) && !ct) warnings.push(`工作表「变更判定」第${r._row}行 变更类型「${C.str(r['变更类型'])}」无法识别（应为 工艺技术/设备设施/管理），按默认映射`);
        specRules.push({ category: cat, level: lvl, changeType: ct, clause: C.str(r['条款号']) || `厂内制度第${r._row}行`, raw: C.str(r['变更等级']) || C.str(r['判定']) });
      }
      if (!specRules.length) warnings.push('厂内变更制度中没有可用条款，本次按默认口径判定');
    }
  }

  // ---- 类别识别（「临时」是属性，不是类别）
  let temporary = !!a.temporary;
  if (a.category && R.isTempWord(a.category)) { temporary = true; warnings.push('--category 临时 已按「临时属性」处理，变更类别改从描述识别；中石化口径下临时不是独立类别'); }
  let category = R.normCategory(a.category);
  let categorySource = category ? '用户指定' : null;
  if (!category) {
    const guess = R.classifyCategory(`${a.before} ${a.after} ${a.reason || ''}`, { before: a.before, after: a.after });
    if (guess !== 'unknown') { category = guess; categorySource = '按描述自动识别'; }
  }
  if (!category) warnings.push('变更类别无法从描述中识别，判定结果为未判定，请用 --category 明确类别');

  // ---- 描述具体性
  const beforeQ = R.describeQuality(a.before);
  const afterQ = R.describeQuality(a.after);
  if (category !== 'management') {
    if (!beforeQ.concrete) warnings.push(`原状态描述不足：${beforeQ.reason}`);
    if (!afterQ.concrete) warnings.push(`变更后状态描述不足：${afterQ.reason}`);
  }

  // ---- 判定
  const verdict = R.judge({
    category, before: a.before, after: a.after, beforeQ, afterQ,
    sameModelMaterial: R.parseBool(a['same-model-material']),
    affectsPerf: R.parseBool(a['affects-perf']),
    exceedsDesign: R.parseBool(a['exceeds-design']),
    temporary,
    until: a.until || null,
  });

  // ---- 厂内制度覆盖：与默认口径冲突时以厂内制度为准
  const conflicts = [];
  let finalLevel = verdict.level, finalLevelCn = verdict.levelCn, finalIsChange = verdict.isChange;
  let finalBasis = verdict.basis, finalRuleId = verdict.ruleId, basisSource = '默认口径';
  let changeType = verdict.changeType, changeTypeCn = verdict.changeTypeCn;
  if (category && specRules.length) {
    const hit = specRules.find((x) => x.category === category);
    if (hit) {
      if (hit.changeType && hit.changeType !== R.CAT_TO_TYPE[category]) {
        warnings.push(`厂内制度将「${R.CAT_CN[category]}」归为「${R.CHANGE_TYPE[hit.changeType]}」（默认映射为${R.CHANGE_TYPE[R.CAT_TO_TYPE[category]] || '—'}），已按厂内制度`);
      }
      if (hit.changeType && verdict.ruleId !== 'U1' && verdict.ruleId !== 'U2') { changeType = hit.changeType; changeTypeCn = R.CHANGE_TYPE[hit.changeType]; }
      const canOverride = verdict.level !== 'undetermined' || verdict.ruleId === 'U6';
      if (!canOverride) {
        warnings.push(`厂内制度对「${R.CAT_CN[category]}」有规定（${hit.clause}），但本次判定要素不全仍为未判定，补齐后按厂内制度定级`);
      } else if (hit.level !== verdict.level) {
        if (verdict.ruleId !== 'U6') conflicts.push({
          item: `${R.CAT_CN[category]}的变更级别`,
          defaultLevel: verdict.levelCn, defaultRuleId: verdict.ruleId,
          plantLevel: R.LEVEL_CN[hit.level], plantClause: hit.clause, plantRaw: hit.raw,
          resolution: '以厂内制度为准',
        });
        finalLevel = hit.level;
        finalLevelCn = R.LEVEL_CN[hit.level];
        finalIsChange = hit.level === 'none' ? false : hit.level === 'review' ? null : true;
        finalBasis = `厂内制度${hit.clause}：${R.CAT_CN[category]}按「${hit.raw}」处理（默认口径为${verdict.levelCn}，规则 ${verdict.ruleId}，已按厂内制度覆盖）`;
        finalRuleId = hit.clause;
        basisSource = '厂内制度';
        if (verdict.ruleId === 'U6') warnings.push(`管理变更级别已按厂内制度 ${hit.clause} 定为「${hit.raw}」`);
        else warnings.push(`默认口径判「${verdict.levelCn}」与厂内制度「${hit.raw}」冲突，已以厂内制度为准（${hit.clause}）`);
      } else {
        finalBasis = `${verdict.basis}（默认口径规则 ${verdict.ruleId}；与厂内制度${hit.clause}一致）`;
        basisSource = '默认口径与厂内制度一致';
      }
    }
  }

  // ---- 归口提报专业
  const ownership = category && R.CAT_OWNER[category]
    ? { category: R.CAT_CN[category], owner: R.CAT_OWNER[category].owner, note: R.CAT_OWNER[category].note,
      equipmentEngineerCanSubmit: !['process', 'control', 'management'].includes(category) }
    : null;

  // ---- 承压设备（特种设备）法定手续提示：结构或材质改动时附加
  let statutory = null;
  if (category === 'structure' || category === 'material') {
    let applies = specialArg;
    let source = specialArg === null ? null : '用户指定 --special';
    if (applies === null) {
      const d = R.detectPressure(`${equip ? (equip.category || '') + ' ' + (equip.name || '') : ''} ${a.name || ''} ${a.before} ${a.after}`);
      if (d === true) { applies = true; source = equip && R.detectPressure(`${equip.category || ''} ${equip.name || ''}`) ? '按台账设备类别/名称推断，待确认' : '按描述推断，待确认'; }
    }
    if (applies !== false) {
      statutory = {
        applies, source: source || '未确认是否为压力容器/压力管道',
        items: R.STATUTORY_ITEMS.map((x) => ({ ...x })),
        note: applies === true
          ? '对象为压力容器 / 压力管道（特种设备），结构或材质改动属改造，须办理下列法定手续；具体要求依据 TSG 21 / TSG D7005 与厂内特种设备管理规定，数值与流程以制度文件为准'
          : '未确认对象是否为压力容器 / 压力管道；若是，结构或材质改动须办理下列法定手续（请用 --special 是/否 确认）',
      };
      if (applies === null) warnings.push('未确认变更对象是否为压力容器/压力管道，法定手续提示按「待确认」列出，请用 --special 是/否 明确');
    }
  }

  // ---- 未判定清单
  const undetermined = [];
  if (finalLevel === 'undetermined') {
    undetermined.push({
      item: '是否属于变更及变更级别',
      ruleId: verdict.ruleId,
      missing: verdict.missing,
      note: verdict.basis,
      caution: '信息不足时不得判定为「不需要走变更」，须补齐要素后重新判定',
    });
  }
  if (statutory && statutory.applies === null) {
    undetermined.push({
      item: '是否为压力容器 / 压力管道（特种设备法定手续是否适用）',
      ruleId: 'R3/R1 附注',
      missing: ['--special 是/否（或提供含设备类别的台账）'],
      note: '承压设备的结构或材质改动须办理改造告知、监督检验、使用登记变更',
      caution: '未确认前按「待确认」提示，不默认免办',
    });
  }
  const temporaryPlan = finalLevel !== 'undetermined' && verdict.temporary
    ? { until: a.until, note: verdict.temporaryNote || `临时变更须在 ${a.until} 前恢复原状或转为正式变更`,
      required: ['恢复责任人', '恢复内容（恢复到何种状态）', '恢复验收方式', '到期未恢复的升级处置'] }
    : null;

  // ---- 需评估项与应更新资料（类别未识别时为空并说明）
  const assess = category && category !== 'unknown' ? R.assessItems(category, finalLevel, verdict.temporary) : [];
  const docs = category && category !== 'unknown' ? R.docUpdates(category, verdict.temporary) : [];
  if (!assess.length) warnings.push('变更类别未确定，需评估项与应更新资料清单暂无法给出');

  const counts = {
    assessItems: assess.reduce((s, g) => s + g.items.length, 0),
    assessDisciplines: assess.length,
    docUpdates: docs.length,
    undetermined: undetermined.length,
    conflicts: conflicts.length,
    missingElements: verdict.missing.length,
    statutoryItems: statutory ? statutory.items.length : 0,
  };

  // ---- 产出
  C.ensureDir(outDir);
  const result = {
    meta: {
      workshop: a.workshop || null, tag: a.tag, name: a.name || (equip && equip.name) || null,
      applicant: a.applicant || null, generatedAt: C.localDateTime(),
      before: a.before, after: a.after, reason: a.reason || null,
      temporary: verdict.temporary, until: a.until || null,
      ledgerUsed: !!equip, specUsed: specRules.length > 0, basisSource,
    },
    category, categoryCn: category ? R.CAT_CN[category] : null, categorySource,
    changeType, changeTypeCn,
    isChange: finalIsChange,
    level: finalLevel, levelCn: finalLevelCn,
    temporary: verdict.temporary,
    basis: finalBasis, ruleId: finalRuleId,
    defaultVerdict: { level: verdict.level, levelCn: verdict.levelCn, ruleId: verdict.ruleId, basis: verdict.basis, changeType: verdict.changeType },
    ownership, statutory,
    equip, assessItems: assess, docUpdates: docs,
    undetermined, conflicts, temporaryPlan, counts,
    declaration: DECLARATION, warnings,
  };
  fs.writeFileSync(path.join(outDir, 'moc.json'), JSON.stringify(result, null, 2), 'utf8');

  // ---- Markdown（十节固定）
  const L = [];
  L.push(`# 设备变更（MOC）评估要点${a.workshop ? '（' + a.workshop + '）' : ''}`);
  L.push('');
  L.push(`生成时间：${C.localDateTime()}（北京时间）　位号：${a.tag}${result.meta.name ? '　设备：' + result.meta.name : ''}　提交对象：车间设备主任 / 公司设备管理部门（变更管理归口部门）`);
  L.push('');

  L.push('## 一、变更概况');
  L.push('');
  L.push(C.mdTable(['项目', '内容'], [
    ['设备位号', a.tag],
    ['设备名称', result.meta.name || '—'],
    ['原状态', a.before],
    ['变更后状态', a.after],
    ['变更原因', a.reason || '—（未提供，申请时须补充）'],
    ['变更类别（细分）', category ? `${R.CAT_CN[category]}（${categorySource}）` : '未识别'],
    ['变更类型（中石化三大类）', changeTypeCn || '—（待类别确定后给出）'],
    ['是否临时变更', verdict.temporary ? `是，恢复期限 ${a.until || '未设定'}` : '否'],
    ['申请人', a.applicant || '—'],
    ['台账核对', equip ? `已核对：台账材质「${equip.material || '—'}」、型号「${equip.model || '—'}」、设备类别「${equip.category || '—'}」${equip.equipNo ? '、设备编号「' + equip.equipNo + '」' : ''}` : '未提供台账或位号未命中，未做核对'],
  ]));

  L.push('## 二、是否属于变更及依据');
  L.push('');
  const isChangeCn = finalIsChange === null ? (finalLevel === 'review' ? '待厂内评审（是否报变更以厂内制度为准）' : '未判定') : (finalIsChange ? '属于变更' : '不属于变更（同类替换）');
  L.push(C.mdTable(['项目', '内容'], [
    ['**是否属于变更**', `**${isChangeCn}**`],
    ['**变更类型**', `**${changeTypeCn || '—'}**`],
    ['**建议变更级别**', `**${finalLevelCn}**${verdict.temporary && finalLevel !== 'undetermined' ? '（临时）' : ''}`],
    ['判定依据', finalBasis],
    ['依据条款', finalRuleId],
    ['口径来源', basisSource],
  ]));
  if (finalLevel === 'undetermined') {
    L.push('> 【未判定】判定要素不全。未判定不等于「不需要走变更」，补齐下列要素后须重新判定。');
    L.push('');
  }
  if (finalLevel === 'review') {
    L.push('> 【注意】同规格不同厂家代用不自动判为变更，建议走材料代用单 / 同类替换评审；是否需报变更以厂内制度为准（可用 --spec 传入厂内制度定级）。');
    L.push('');
  }

  L.push('## 三、归口与提报专业');
  L.push('');
  if (!ownership) L.push('_变更类别未确定，暂无法给出归口。_\n');
  else {
    L.push(C.mdTable(['项目', '内容'], [
      ['提报专业', ownership.owner],
      ['车间设备员可否直接提报', ownership.equipmentEngineerCanSubmit ? '可以' : '不可以，由对应专业提报，设备员只做设备相关提示与台账衔接'],
      ['说明', ownership.note],
    ]));
    if (!ownership.equipmentEngineerCanSubmit) { L.push('> 【注意】本项不属于车间设备员提报范围，请转交对应专业；本报告仅供设备专业配合评估。'); L.push(''); }
  }

  L.push('## 四、需评估项（按专业）');
  L.push('');
  if (!assess.length) L.push('_变更类别未确定，暂无法给出需评估项。_\n');
  else {
    for (const g of assess) {
      L.push(`### ${g.discipline}`);
      L.push('');
      for (const it of g.items) L.push(`- [ ] ${it}`);
      L.push('');
    }
  }

  L.push('## 五、应更新资料清单');
  L.push('');
  if (!docs.length) L.push('_变更类别未确定，暂无法给出资料更新清单。_\n');
  else L.push(C.mdTable(['应更新资料', '更新内容'], docs.map((d) => [d.doc, d.what])));

  L.push('## 六、待确认信息');
  L.push('');
  if (!undetermined.length) L.push('_无，判定要素齐全。_\n');
  else {
    L.push(C.mdTable(['未判定项', '缺少的要素', '说明', '条款'],
      undetermined.map((u) => [u.item, u.missing.join('；') || '—', u.note, u.ruleId])));
    L.push('> 信息不足时**不得**判定为「不需要走变更」，须补齐上述要素后重新运行判定。');
    L.push('');
  }

  L.push('## 七、与厂内制度的冲突点');
  L.push('');
  if (!specRules.length) L.push('_未提供厂内变更管理制度，本次按默认口径（《中国石化变更管理规定》分类框架）判定；厂内有实施细则时以厂内为准。_\n');
  else if (!conflicts.length) L.push('_已对照厂内制度，无冲突点。_\n');
  else {
    L.push(C.mdTable(['冲突项', '默认口径', '厂内制度', '厂内条款', '处理'],
      conflicts.map((c) => [c.item, `${c.defaultLevel}（${c.defaultRuleId}）`, c.plantLevel, c.plantClause, c.resolution])));
  }

  L.push('## 八、特种设备法定手续提示（压力容器 / 压力管道）');
  L.push('');
  if (!statutory) L.push('_不适用：本次变更不涉及承压设备结构或材质改动，或已确认对象不是压力容器 / 压力管道。_\n');
  else {
    L.push(`【注意】${statutory.note}（判断依据：${statutory.source}）`);
    L.push('');
    L.push(C.mdTable(['法定手续', '说明'], statutory.items.map((x) => [x.item, x.note])));
  }

  L.push('## 九、临时变更期限与恢复计划');
  L.push('');
  if (!temporaryPlan) L.push(verdict.temporary ? '_临时变更但判定未完成（见第六节），恢复计划待补齐要素后给出。_\n' : '_不适用：非临时变更。_\n');
  else {
    L.push(C.mdTable(['项目', '内容'], [
      ['恢复期限', temporaryPlan.until],
      ['期限要求', temporaryPlan.note],
    ]));
    L.push('恢复计划须明确（由申请人填写）：');
    L.push('');
    for (const x of temporaryPlan.required) L.push(`- [ ] ${x}`);
    L.push('');
  }

  L.push('## 十、变更申请要点提示');
  L.push('');
  L.push('<!-- ANALYSIS_START -->');
  L.push('（由模型依据 references/moc-rules.md 口径撰写 200~400 字，结构：变更必要性 → 判定结论（变更类型、级别、是否临时）与依据条款 → 归口提报专业 → 需重点评估的专业与理由 → 资料更新、特种设备法定手续与审批提示。所有结论与条款号一律引用 moc.json，不得自行放宽或收紧。）');
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
  L.push(`> ${DECLARATION}。`);
  L.push('');
  fs.writeFileSync(path.join(outDir, 'moc.md'), L.join('\n'), 'utf8');

  C.emitOk(outDir, {
    ok: true, out: outDir, tag: a.tag, category: result.categoryCn, changeType: changeTypeCn,
    isChange: finalIsChange, level: finalLevel, levelCn: finalLevelCn, temporary: verdict.temporary, ruleId: finalRuleId,
    counts, warnings,
  });
}

try { main(); } catch (e) { C.fail(e, warnings); }
