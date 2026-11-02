#!/usr/bin/env node
'use strict';
/**
 * 特种设备定检到期管理脚本（仅 Node.js 内置模块）—— 中石化炼化厂车间设备员口径
 * 用法：node "<技能目录>/scripts/inspection.js" --input <xlsx> --workshop "常减压车间" --date 2026-09-21 [--out <dir>]
 *       [--lead-days 90] [--category 压力容器] [--reports <检验报告目录>] [--issues <整改项xlsx>]
 * 产出：<out>/inspection.json、<out>/inspection.md、<out>/报检准备清单.md、<out>/summary.json；末行打印 JSON 摘要
 *
 * 口径（见顶层《中石化口径对照.md》第七节）：
 *  - 压力容器 / 压力管道定期检验周期由「安全状况等级」决定，不由 GC 级别决定；等级缺失 → 未判定，绝不按最长周期；
 *  - 使用单位每年一次「年度检查」是车间设备员主责，按「上次年度检查日期」+ 12 个自然月判到期；
 *  - 设备类别按「设备品种」中文写法识别，不用自造字母码；「储罐」待核实（常压储罐不是特种设备）；
 *  - 安全阀校验周期以厂内规定与校验报告为准，脚本不代入；安全阀校验台账归 valve-instrument-calibration-ledger；
 *  - 到期日按自然月推（C.addMonths）；台账「下次检验日期」有值时以其为准，计算值仅作校验。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readXlsx, readCsvDir } = require('./lib/xlsx-lite');
const C = require('./lib/common');

const warnings = [];
const VALUE_OPTS = ['input', 'workshop', 'date', 'out', 'lead-days', 'category', 'reports', 'issues'];
const FLAG_OPTS = ['help'];

/** 超期醒目声明行 —— SKILL.md 要求原文写入 md，不得删除或弱化（不用 emoji，用【注意】） */
const OVERDUE_BANNER = '【注意】存在超期未检特种设备，超期使用违反《特种设备安全法》，应立即停用并报检';
/** 年度检查说明 */
const ANNUAL_NOTE = '压力容器 / 压力管道的年度检查由使用单位组织、车间设备员主责，按上次年度检查日期加 12 个自然月判到期；检查内容与记录格式按 TSG 21 / TSG D7005 与厂内特种设备管理制度，数值以制度文件为准';

// 局部别名优先，再并入共享 SYSTEM_ALIASES（SAP PM / EM / 特种设备台账列名）。「设备编号」是 SAP 流水号，不作位号别名。
const ALIASES = C.mergeAliases({
  '设备类别': ['设备类别', '类别', '设备种类', '种类', '特种设备类别', '设备品种', '设备类型'],
  '位号': ['位号', '设备位号', '内部编号', 'TAG', 'tag'],
  '设备名称': ['设备名称', '名称', '设备描述'],
  '设备代码': ['设备代码', '特种设备代码', '注册代码', '注册号', '登记代码', '注册编号'],
  '使用登记证编号': ['使用登记证编号', '使用证号', '使用登记证号', '登记证号', '使用登记证'],
  '检验机构': ['检验机构', '检验单位', '检测机构', '检验检测机构'],
  '检验类型': ['检验类型', '检验类别', '检验种类', '检验项目', '锅炉检验类型'],
  '上次检验日期': ['上次检验日期', '上次检验', '本次检验日期', '检验日期', '上次定检日期', '末次检验日期'],
  '检验结论': ['检验结论', '结论', '检验结果'],
  '下次检验日期': ['下次检验日期', '下次检验', '下次定检日期', '到期日期', '下次检验时间'],
  '安全状况等级': ['安全状况等级', '安全状况', '等级', '安全等级'],
  '上次年度检查日期': ['上次年度检查日期', '年度检查日期', '上次年检日期', '年检日期', '上次年度检查', '年度检查'],
  '使用状态': ['使用状态', '状态', '运行状态', '在用状态'],
  '装置': ['装置', '所属装置', '装置名称', '区域', '所在区域'],
  '规格型号': ['规格型号', '型号', '规格'],
  // 整改项清单
  '整改项': ['整改项', '问题描述', '遗留问题', '整改内容', '缺陷描述', '问题'],
  '要求完成日期': ['要求完成日期', '整改期限', '完成期限', '要求整改日期', '期限'],
  '整改状态': ['整改状态', '完成情况', '状态', '是否完成'],
  '责任人': ['责任人', '负责人', '整改责任人'],
});

/** 设备类别归一：按设备品种中文写法（不用自造字母码）；无法归类返回 null（不猜测） */
const CATEGORY_KEYS = [
  ['压力容器', ['压力容器', '容器', '球罐', '换热器容器', '气瓶']],
  ['压力管道', ['压力管道', '管道', '工业管道', '管线']],
  ['锅炉', ['锅炉', '蒸汽发生器', '余热锅炉', '导热油炉']],
  ['安全阀', ['安全阀', '安全泄放装置', '泄放阀', '爆破片']],
  ['起重机械', ['起重机械', '起重机', '行车', '天车', '桥式起重', '葫芦', '门式起重']],
  ['场内机动车辆', ['场内机动车辆', '场内车辆', '厂内机动车', '厂内车辆', '叉车', '牵引车', '场（厂）内专用机动车辆']],
];
function normCategory(v) {
  const s = C.str(v).replace(/\s/g, '');
  if (s === '') return null;
  if (isTankSuspect(s)) return null;
  for (const [std, keys] of CATEGORY_KEYS) if (keys.some((k) => s.includes(k))) return std;
  return null;
}
/** 「储罐」待核实：常压储罐不是特种设备；写明「压力容器」或「球罐」的除外 */
function isTankSuspect(s) {
  const t = C.str(s).replace(/\s/g, '');
  if (!t) return false;
  if (/压力容器|球罐/.test(t)) return false;
  return /储罐|常压罐|常压储罐|油罐|罐区储罐/.test(t);
}

/** 安全状况等级归一：1~5 级；「—」「不定级」「/」等视为不适用（notApplicable） */
function normGrade(v) {
  const s = C.str(v).replace(/\s/g, '');
  if (s === '') return null;
  if (/^(不定级|不分级|无等级|不适用|NA|N\/A)$/i.test(s)) return 'NA';
  if (s === '—' || s === '-' || s === '/' || s === '无') return null;
  const map = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5 };
  let m = s.match(/([一二三四五])级/);
  if (m) return map[m[1]];
  m = s.match(/([1-5])\s*级?/);
  if (m) return Number(m[1]);
  return null;
}

/** 锅炉检验类型归一：先看「检验类型」列，再从规格型号/名称文本找 */
function boilerKind(inspTypeCol, subType) {
  const pick = (s) => (/水压/.test(s) ? '水压试验' : /内部/.test(s) ? '内部检验' : /外部/.test(s) ? '外部检验' : null);
  return pick(C.str(inspTypeCol)) || pick(C.str(subType));
}

/**
 * 定期检验周期查表（默认参考口径，详见 references/inspection-rules.md）
 * 返回 {months, basis} 或 {undetermined:'原因'}；厂内有明确规定以厂内为准。
 */
function periodOf(category, grade, inspTypeCol, subType) {
  const st = C.str(subType).replace(/\s/g, '');
  switch (category) {
    case '压力容器':
      if (grade === null) return { undetermined: '安全状况等级缺失，压力容器定期检验周期按安全状况等级确定（TSG 21）' };
      if (grade === 'NA') return { undetermined: '安全状况等级标注为不定级，无法按等级查定检周期' };
      if (grade === 1 || grade === 2) return { months: 72, basis: '安全状况等级 1~2 级，按 TSG 21 常规周期（默认参考口径，以检验报告为准）' };
      if (grade === 3) return { months: 36, basis: '安全状况等级 3 级，按 TSG 21 常规周期（默认参考口径，以检验报告为准）' };
      if (grade === 4) return { months: null, basis: '安全状况等级 4 级属监控使用，检验周期由检验机构在报告中确定', monitored: true };
      if (grade === 5) return { months: null, basis: '安全状况等级 5 级应立即停止使用，不得继续运行', stopped: true };
      return { undetermined: `安全状况等级「${grade}」不在 1~5 级范围内` };
    case '压力管道':
      // 压力管道定期检验周期由「安全状况等级」决定（TSG D7005），GC1/GC2 只是管道分级，不决定周期
      if (grade === null) return { undetermined: `压力管道安全状况等级缺失${/GC\d/i.test(st) ? `（管道级别「${st.match(/GC\d/i)[0]}」不决定检验周期）` : ''}，无法确定检验周期（TSG D7005）` };
      if (grade === 'NA') return { undetermined: '安全状况等级标注为不定级，无法按等级查定检周期' };
      if (grade === 1 || grade === 2) return { months: 72, basis: '压力管道安全状况等级 1~2 级，按 TSG D7005 常规周期（默认参考口径，以检验报告为准）' };
      if (grade === 3) return { months: 36, basis: '压力管道安全状况等级 3 级，按 TSG D7005 常规周期（默认参考口径，以检验报告为准）' };
      if (grade === 4 || grade === 5) return { months: null, basis: `压力管道安全状况等级 ${grade} 级，应停止使用或由检验机构确定处置`, stopped: true };
      return { undetermined: `压力管道安全状况等级「${grade}」不在 1~5 级范围内` };
    case '锅炉': {
      const kind = boilerKind(inspTypeCol, st);
      if (kind === '外部检验') return { months: 12, basis: '锅炉外部检验（默认参考口径，以检验报告为准）', inspType: kind };
      if (kind === '内部检验') return { months: 24, basis: '锅炉内部检验（默认参考口径，以检验报告为准）', inspType: kind };
      if (kind === '水压试验') return { months: 72, basis: '锅炉水压试验（默认参考口径，以检验报告为准）', inspType: kind };
      return { undetermined: '锅炉未注明检验类型（外部检验/内部检验/水压试验），三者周期不同，无法确定；请在「检验类型」列填写' };
    }
    case '安全阀':
      return { undetermined: '安全阀校验周期以厂内规定与校验报告为准，脚本不代入默认周期；安全阀校验台账请用 valve-instrument-calibration-ledger，本技能只按台账载明的下次检验日期提示', referTo: 'valve-instrument-calibration-ledger' };
    case '起重机械':
      return { months: 24, basis: '起重机械定期检验常规周期（默认参考口径，以检验报告为准）' };
    case '场内机动车辆':
      return { months: 12, basis: '场（厂）内专用机动车辆定期检验常规周期（默认参考口径，以检验报告为准）' };
    default:
      return { undetermined: `设备类别「${C.str(category) || '空'}」无法识别，不在六类特种设备范围内` };
  }
}

/** 报检应备资料清单（与 references/prep-materials.md 同源） */
const PREP_MATERIALS = {
  '压力容器': [
    '使用登记证（正本/复印件）与设备代码',
    '上一周期检验报告及结论页',
    '设计图样、竣工图与产品质量证明文件（含材质、焊接、热处理记录）',
    '安全附件校验记录（安全阀、压力表、液位计、测温仪表）',
    '运行记录与操作规程、使用单位年度检查报告',
    '停用、置换、清洗与隔离方案（内外部检验需停用时），相关作业许可（受限空间、用火、盲板抽堵）',
    '上周期遗留整改项的整改完成证明',
  ],
  '压力管道': [
    '压力管道使用登记证与管道元件/管段编号台账',
    '上一周期检验报告、管道单线图（ISO 图）',
    '安装竣工资料、焊缝无损检测报告与合格证明',
    '测厚记录与腐蚀减薄趋势数据、年度检查记录',
    '支吊架检查记录、防腐保温状况说明',
    '停车吹扫置换方案与用火/受限空间作业许可配合计划',
    '上周期遗留整改项的整改完成证明',
  ],
  '锅炉': [
    '锅炉使用登记证与设备代码',
    '上一周期外部检验、内部检验、水压试验报告',
    '水（介）质处理记录与化验报告',
    '安全附件（安全阀、压力表、水位计、超温超压保护）校验与联锁试验记录',
    '司炉工、水处理作业人员特种作业证件（看复审有效期）',
    '运行记录、启停记录与年度维护保养记录',
    '上周期遗留整改项的整改完成证明',
  ],
  '安全阀': [
    '安全阀台账（位号、整定压力、口径、型号、所属设备）',
    '上一周期校验报告与铅封记录',
    '整定压力依据（设备设计压力、工艺卡片）',
    '拆装与备用阀替换计划（在线校验需说明方式）',
    '延长校验周期的厂内审批文件（如已办理）',
    '上周期遗留整改项的整改完成证明',
  ],
  '起重机械': [
    '起重机械使用登记证与设备铭牌信息',
    '上一周期定期检验报告',
    '日常维护保养记录、月度与年度自行检查记录',
    '钢丝绳、吊钩、制动器、限位装置检查与更换记录',
    '起重机司机（Q2）、起重机指挥（Q1）特种作业证件（看复审有效期）',
    '试验载荷与场地、配合吊装作业许可的准备说明',
    '上周期遗留整改项的整改完成证明',
  ],
  '场内机动车辆': [
    '场（厂）内专用机动车辆使用登记证与牌证',
    '上一周期定期检验报告',
    '日常维护保养与检查记录',
    '制动、转向、灯光、警示装置检查记录',
    '驾驶人员特种作业证件（看复审有效期）',
    '上周期遗留整改项的整改完成证明',
  ],
};

function loadBook(p) {
  const st = fs.statSync(p);
  return st.isDirectory() ? readCsvDir(p) : readXlsx(p);
}

function main() {
  const a = C.parseArgs(process.argv.slice(2), VALUE_OPTS, FLAG_OPTS);
  if (!a.input) throw new Error('缺少 --input');
  if (!a.workshop) throw new Error('缺少 --workshop');
  if (!a.date) throw new Error('缺少 --date');
  const date = C.normDate(a.date);
  if (!date) throw new Error(`--date 「${a.date}」不是有效日期，应为 YYYY-MM-DD`);
  let leadDays = 90;
  if (a['lead-days'] !== undefined) {
    const n = Number(a['lead-days']);
    if (!Number.isFinite(n) || n < 0) throw new Error(`--lead-days 「${a['lead-days']}」不是有效的非负天数`);
    leadDays = Math.round(n);
  }
  let filterCat = null;
  if (a.category) {
    filterCat = normCategory(a.category);
    if (!filterCat) throw new Error(`--category 「${a.category}」不在六类特种设备范围内（压力容器/压力管道/锅炉/安全阀/起重机械/场内机动车辆）`);
  }
  if (!fs.existsSync(a.input)) throw new Error(`输入不存在: ${a.input}`);
  const outDir = a.out || path.join(os.tmpdir(), 'seid-out');

  // ---- 读台账
  let book;
  try { book = loadBook(a.input); } catch (e) { throw new Error(`读取失败 ${a.input}: ${e.message}`); }
  const rows = C.pickSheet(book, '特种设备台账', '特种设备', '设备台账', '台账');
  if (!rows) throw new Error('未在输入中找到「特种设备台账」工作表');
  const recs = C.toRecords(rows, ['设备类别', '位号', '上次检验日期'], '特种设备台账',
    ['设备名称', '设备编号', '设备代码', '使用登记证编号', '检验机构', '检验类型', '检验结论', '下次检验日期', '安全状况等级',
      '上次年度检查日期', '使用状态', '装置', '规格型号'],
    warnings, ALIASES);
  const hasAnnualCol = recs.hasCol('上次年度检查日期');
  if (!hasAnnualCol) warnings.push('台账无「上次年度检查日期」列，年度检查到期一节不出数（使用单位年度检查是车间设备员主责，建议在台账补此列）');

  const items = [];
  let filteredOut = 0;
  for (const r of recs) {
    const tag = C.str(r['位号']);
    if (!tag) { warnings.push(`${r._sheet} 第${r._row}行 位号为空，已跳过`); continue; }
    const rawCat = C.str(r['设备类别']);
    const category = normCategory(rawCat);
    const tankSuspect = !category && isTankSuspect(rawCat);
    if (tankSuspect) warnings.push(`${r._sheet} 第${r._row}行 设备类别「${rawCat}」待核实：常压储罐不是特种设备，若为压力储罐请在台账写明「压力容器」`);
    else if (!category && rawCat) warnings.push(`${r._sheet} 第${r._row}行 设备类别「${rawCat}」无法识别为六类特种设备之一（按设备品种中文写法：压力容器/压力管道/锅炉/安全阀/起重机械/场内机动车辆）`);
    if (!category && !rawCat) warnings.push(`${r._sheet} 第${r._row}行 设备类别为空`);
    if (filterCat && category !== filterCat) { filteredOut++; continue; }

    const rawGrade = C.str(r['安全状况等级']);
    const grade = normGrade(r['安全状况等级']);
    if (rawGrade && grade === null) warnings.push(`${r._sheet} 第${r._row}行 安全状况等级「${rawGrade}」无法识别`);

    const lastDate = C.normDate(r['上次检验日期']);
    if (C.str(r['上次检验日期']) && !lastDate) warnings.push(`${r._sheet} 第${r._row}行 上次检验日期「${C.str(r['上次检验日期'])}」无法解析`);
    const ledgerNext = C.normDate(r['下次检验日期']);
    if (C.str(r['下次检验日期']) && !ledgerNext) warnings.push(`${r._sheet} 第${r._row}行 下次检验日期「${C.str(r['下次检验日期'])}」无法解析`);
    const lastAnnual = hasAnnualCol ? C.normDate(r['上次年度检查日期']) : null;
    if (hasAnnualCol && C.str(r['上次年度检查日期']) && !lastAnnual) warnings.push(`${r._sheet} 第${r._row}行 上次年度检查日期「${C.str(r['上次年度检查日期'])}」无法解析`);

    // 规格型号里常带管道级别 / 锅炉检验类型，与设备名称一并作为 subType 线索；锅炉优先看「检验类型」列
    const subType = [C.str(r['规格型号']), C.str(r['设备名称']), rawCat].join(' ');
    const inspTypeCol = C.str(r['检验类型']);
    const p = category
      ? periodOf(category, grade, inspTypeCol, subType)
      : { undetermined: tankSuspect
        ? `设备类别「${rawCat}」待核实：常压储罐不是特种设备，压力储罐请在台账改为「压力容器」并填安全状况等级`
        : (rawCat ? `设备类别「${rawCat}」无法识别，不在六类特种设备范围内` : '设备类别为空，无法确定检验周期') };

    let calcNext = null, period = null, basis = null, undeterminedReason = null, special = null;
    if (p.undetermined) {
      undeterminedReason = p.undetermined;
    } else if (p.stopped) {
      special = 'stopped'; basis = p.basis;
    } else if (p.monitored) {
      special = 'monitored'; basis = p.basis;
    } else {
      period = p.months; basis = p.basis;
      if (!lastDate) undeterminedReason = '上次检验日期缺失或无法解析，无法计算下次检验到期日';
      else calcNext = C.addMonths(lastDate, p.months);
    }

    items.push({
      tag, equipNo: C.str(r['设备编号']) || null, category, rawCategory: rawCat, tankSuspect, name: C.str(r['设备名称']),
      regCode: C.str(r['设备代码']), licence: C.str(r['使用登记证编号']), inspector: C.str(r['检验机构']) || null,
      inspType: inspTypeCol || (p.inspType || null),
      unit: C.str(r['装置']), model: C.str(r['规格型号']),
      conclusion: C.str(r['检验结论']), status: C.str(r['使用状态']),
      grade, rawGrade, lastDate, ledgerNext, calcNext, lastAnnual,
      periodMonths: period, periodBasis: basis, special, undeterminedReason, referTo: p.referTo || null,
      sheet: r._sheet, row: r._row,
    });
  }
  if (filterCat && filteredOut) warnings.push(`已按 --category ${filterCat} 过滤，${filteredOut} 台其他类别设备未纳入本次统计`);
  if (!items.length) throw new Error('台账中未解析到任何有效设备行（位号全空或已被 --category 过滤）');
  if (items.some((x) => x.category === '安全阀')) {
    warnings.push(`台账含 ${items.filter((x) => x.category === '安全阀').length} 台安全阀：安全阀校验周期以厂内规定与校验报告为准，本技能只按台账载明的下次检验日期提示；安全阀校验台账、送检批次与不合格整改请用 valve-instrument-calibration-ledger`);
  }

  // ---- 分组：以台账「下次检验日期」为准，脚本计算值仅作校验
  const overdue = [], dueSoon = [], normal = [], undetermined = [], dateConflict = [], monitored = [], stopped = [];
  for (const it of items) {
    // 冲突校验：两者都有且不一致
    if (it.ledgerNext && it.calcNext && it.ledgerNext !== it.calcNext) {
      const gap = C.diffDays(it.ledgerNext, it.calcNext);
      dateConflict.push({
        tag: it.tag, name: it.name, category: it.category, regCode: it.regCode,
        ledgerNext: it.ledgerNext, calcNext: it.calcNext, gapDays: gap,
        periodBasis: it.periodBasis, grade: it.grade,
        resolved: it.ledgerNext, basis: '以台账中检验报告载明的下次检验日期为准，脚本计算值仅作校验参考',
        sheet: it.sheet, row: it.row,
      });
      warnings.push(`${it.sheet} 第${it.row}行 ${it.tag} 台账下次检验日期 ${it.ledgerNext} 与按规则计算值 ${it.calcNext} 不一致（相差 ${gap} 天），请核实检验报告`);
    }

    // 生效到期日：台账优先
    const effective = it.ledgerNext || it.calcNext;
    const source = it.ledgerNext ? '台账（检验报告载明）' : (it.calcNext ? '规则计算' : null);

    if (it.special === 'stopped') {
      stopped.push({ ...pick(it), reason: it.periodBasis, effective });
      undetermined.push({ tag: it.tag, name: it.name, category: it.category, regCode: it.regCode,
        reason: it.periodBasis + '，检验周期不按常规推算，须依检验机构意见处置', missing: '（周期依据不适用常规推算）', sheet: it.sheet, row: it.row });
      continue;
    }
    if (it.special === 'monitored') {
      monitored.push({ ...pick(it), reason: it.periodBasis, effective });
      if (!effective) {
        undetermined.push({ tag: it.tag, name: it.name, category: it.category, regCode: it.regCode,
          reason: it.periodBasis + '，台账未载明下次检验日期', missing: '下次检验日期', sheet: it.sheet, row: it.row });
        continue;
      }
    }
    if (!effective) {
      undetermined.push({
        tag: it.tag, name: it.name, category: it.category, rawCategory: it.rawCategory, regCode: it.regCode,
        reason: it.undeterminedReason || '台账未载明下次检验日期且无法按规则计算',
        missing: missingOf(it), referTo: it.referTo, sheet: it.sheet, row: it.row,
      });
      continue;
    }

    const days = C.diffDays(effective, date); // >0 还剩几天，<0 已超期
    const base = { tag: it.tag, equipNo: it.equipNo, name: it.name, category: it.category, regCode: it.regCode, licence: it.licence,
      inspector: it.inspector, inspType: it.inspType,
      unit: it.unit, grade: it.grade, lastDate: it.lastDate, nextDate: effective, nextSource: source,
      calcNext: it.calcNext, ledgerNext: it.ledgerNext, periodBasis: it.periodBasis || (it.referTo ? `周期以厂内规定为准（${it.referTo}）` : null),
      conclusion: it.conclusion, status: it.status, sheet: it.sheet, row: it.row };
    if (days === null) { undetermined.push({ ...base, reason: '下次检验日期无法与基准日期比较', missing: '下次检验日期' }); continue; }
    if (days < 0) overdue.push({ ...base, overdueDays: -days });
    else if (days <= leadDays) dueSoon.push({ ...base, remainDays: days });
    else normal.push({ ...base, remainDays: days });
  }
  function pick(it) {
    return { tag: it.tag, name: it.name, category: it.category, regCode: it.regCode, grade: it.grade,
      lastDate: it.lastDate, ledgerNext: it.ledgerNext, sheet: it.sheet, row: it.row };
  }
  function missingOf(it) {
    const m = [];
    if (!it.category) m.push(it.tankSuspect ? '设备类别（储罐待核实）' : '设备类别');
    if (it.grade === null && (it.category === '压力容器' || it.category === '压力管道')) m.push('安全状况等级');
    if (it.category === '锅炉' && !it.inspType) m.push('检验类型');
    if (!it.lastDate) m.push('上次检验日期');
    if (!it.ledgerNext) m.push('下次检验日期');
    return m.length ? m.join('、') : '检验周期依据';
  }

  const CAT_IDX = (c) => { const i = CATEGORY_KEYS.findIndex(([n]) => n === c); return i < 0 ? 99 : i; };
  const bySort = (x, y) => CAT_IDX(x.category) - CAT_IDX(y.category) || x.tag.localeCompare(y.tag, 'zh');
  overdue.sort((x, y) => y.overdueDays - x.overdueDays || bySort(x, y));
  dueSoon.sort((x, y) => x.remainDays - y.remainDays || bySort(x, y));
  normal.sort((x, y) => x.remainDays - y.remainDays || bySort(x, y));
  undetermined.sort(bySort);
  dateConflict.sort(bySort);

  // ---- 年度检查到期（压力容器 / 压力管道，使用单位年度检查，车间设备员主责）
  let annualCheck = null;
  if (hasAnnualCol) {
    annualCheck = { overdue: [], dueSoon: [], normal: [], undetermined: [], note: ANNUAL_NOTE };
    for (const it of items) {
      if (it.category !== '压力容器' && it.category !== '压力管道') continue;
      if (it.special === 'stopped') continue;
      const rec = { tag: it.tag, name: it.name, category: it.category, regCode: it.regCode, unit: it.unit, lastAnnual: it.lastAnnual, sheet: it.sheet, row: it.row };
      if (!it.lastAnnual) { annualCheck.undetermined.push({ ...rec, nextAnnual: null, reason: '上次年度检查日期缺失或无法解析' }); continue; }
      const nextAnnual = C.addMonths(it.lastAnnual, 12);
      const d = C.diffDays(nextAnnual, date);
      if (d < 0) annualCheck.overdue.push({ ...rec, nextAnnual, overdueDays: -d });
      else if (d <= leadDays) annualCheck.dueSoon.push({ ...rec, nextAnnual, remainDays: d });
      else annualCheck.normal.push({ ...rec, nextAnnual, remainDays: d });
    }
    annualCheck.overdue.sort((x, y) => y.overdueDays - x.overdueDays || bySort(x, y));
    annualCheck.dueSoon.sort((x, y) => x.remainDays - y.remainDays || bySort(x, y));
    annualCheck.normal.sort((x, y) => x.remainDays - y.remainDays || bySort(x, y));
    annualCheck.undetermined.sort(bySort);
    if (annualCheck.overdue.length) warnings.push(`${annualCheck.overdue.length} 台压力容器/压力管道年度检查已超期（按上次年度检查日期 + 12 个月），请车间组织年度检查并记录`);
  }

  // ---- 遗留整改项（可选）
  let openIssues = null;
  if (a.issues) {
    if (!fs.existsSync(a.issues)) throw new Error(`整改项清单不存在: ${a.issues}`);
    const ib = loadBook(a.issues);
    const irows = C.pickSheet(ib, '整改项', '遗留整改项', '整改清单', '问题清单');
    if (!irows) { warnings.push('整改项文件中未找到「整改项」工作表，无法统计遗留整改项'); }
    else {
      const ir = C.toRecords(irows, ['位号', '整改项'], '整改项', ['设备名称', '要求完成日期', '整改状态', '责任人', '设备类别'], warnings, ALIASES);
      openIssues = [];
      const known = new Set(items.map((x) => x.tag));
      for (const r of ir) {
        const tag = C.str(r['位号']);
        if (!tag) { warnings.push(`${r._sheet} 第${r._row}行 位号为空，已跳过`); continue; }
        const st = C.str(r['整改状态']);
        if (st && /^(已完成|完成|已整改|已闭环|闭环|关闭|是)$/.test(st)) continue;
        const due = C.normDate(r['要求完成日期']);
        if (C.str(r['要求完成日期']) && !due) warnings.push(`${r._sheet} 第${r._row}行 要求完成日期「${C.str(r['要求完成日期'])}」无法解析`);
        const od = due ? C.diffDays(date, due) : null;
        if (!known.has(tag)) warnings.push(`${r._sheet} 第${r._row}行 位号 ${tag} 不在特种设备台账中，仍计入遗留整改项`);
        openIssues.push({
          tag, name: C.str(r['设备名称']), issue: C.str(r['整改项']),
          dueDate: due, status: st || '未填写', owner: C.str(r['责任人']),
          overdueDays: od !== null && od > 0 ? od : null,
          inLedger: known.has(tag), sheet: r._sheet, row: r._row,
        });
      }
      openIssues.sort((x, y) => (y.overdueDays || 0) - (x.overdueDays || 0) || x.tag.localeCompare(y.tag, 'zh'));
    }
  } else {
    warnings.push('未提供整改项清单（--issues），遗留整改项一节不出数');
  }

  // ---- 检验报告归档核对（可选）
  let reports = null;
  if (a.reports) {
    if (!fs.existsSync(a.reports)) throw new Error(`检验报告目录不存在: ${a.reports}`);
    let files = [];
    try { files = fs.readdirSync(a.reports).filter((f) => !f.startsWith('.')); } catch (e) { throw new Error(`检验报告目录读取失败: ${e.message}`); }
    reports = { dir: a.reports, fileCount: files.length, missing: [] };
    for (const it of items) {
      const key = [it.tag, it.regCode].filter(Boolean);
      const hit = files.some((f) => key.some((k) => f.includes(k)));
      if (!hit) reports.missing.push({ tag: it.tag, name: it.name, category: it.category, regCode: it.regCode });
    }
    if (reports.missing.length) warnings.push(`检验报告目录中有 ${reports.missing.length} 台设备未找到对应报告文件（按位号或设备代码匹配文件名，不读取报告内容）`);
  } else {
    warnings.push('未提供检验报告目录（--reports），不做报告归档核对');
  }

  // ---- 报检应备资料（仅覆盖本次出现的类别）
  const CAT_ORDER = CATEGORY_KEYS.map(([c]) => c);
  const presentCats = [...new Set(items.map((x) => x.category).filter(Boolean))].sort((x, y) => CAT_ORDER.indexOf(x) - CAT_ORDER.indexOf(y));
  const prepMaterials = presentCats.map((c) => ({
    category: c,
    equipmentCount: items.filter((x) => x.category === c).length,
    actionCount: [...overdue, ...dueSoon].filter((x) => x.category === c).length,
    materials: PREP_MATERIALS[c] || [],
  }));

  const counts = {
    total: items.length,
    overdue: overdue.length,
    dueSoon: dueSoon.length,
    normal: normal.length,
    undetermined: undetermined.length,
    tankSuspect: items.filter((x) => x.tankSuspect).length,
    dateConflict: dateConflict.length,
    monitored: monitored.length,
    stopped: stopped.length,
    annualOverdue: annualCheck === null ? null : annualCheck.overdue.length,
    annualDueSoon: annualCheck === null ? null : annualCheck.dueSoon.length,
    annualUndetermined: annualCheck === null ? null : annualCheck.undetermined.length,
    openIssues: openIssues === null ? null : openIssues.length,
    openIssuesOverdue: openIssues === null ? null : openIssues.filter((x) => x.overdueDays !== null).length,
    reportsMissing: reports === null ? null : reports.missing.length,
  };
  const byCategory = presentCats.map((c) => ({
    category: c,
    total: items.filter((x) => x.category === c).length,
    overdue: overdue.filter((x) => x.category === c).length,
    dueSoon: dueSoon.filter((x) => x.category === c).length,
    normal: normal.filter((x) => x.category === c).length,
    undetermined: undetermined.filter((x) => x.category === c).length,
  }));

  // ---- 产出
  C.ensureDir(outDir);
  const result = {
    meta: {
      workshop: a.workshop, date, leadDays, categoryFilter: filterCat,
      input: path.basename(a.input), generatedAt: C.localDateTime(),
      issuesProvided: !!a.issues, reportsProvided: !!a.reports, annualColPresent: hasAnnualCol,
      basisNote: '定期检验周期为默认参考口径（依据 TSG 21 / TSG D7005 及相应安全技术规范的常规周期），以现行有效法规、检验机构报告载明与厂内特种设备管理制度为准；台账与计算不一致时以检验报告为准；压力容器/压力管道周期由安全状况等级决定，不由 GC 级别决定；安全阀校验周期以厂内规定为准，脚本不代入',
      ownership: '车间设备员可做：台账到期提醒、年度检查组织与记录、报检资料准备、整改项跟踪；报检手续、检验结论与安全状况等级认定由特种设备管理员与检验机构归口',
    },
    counts, byCategory,
    overdue, dueSoon, normal, undetermined, dateConflict, monitored, stopped,
    annualCheck, prepMaterials, openIssues, reports, warnings,
  };
  fs.writeFileSync(path.join(outDir, 'inspection.json'), JSON.stringify(result, null, 2), 'utf8');

  const G = (g) => (g === null ? '—' : g === 'NA' ? '不定级' : `${g}级`);
  const L = [];
  L.push(`# ${a.workshop} 特种设备定检到期管理（基准日 ${date}）`);
  L.push('');
  if (overdue.length) {
    L.push(`> **${OVERDUE_BANNER}**`);
    L.push('');
  }
  L.push(`台账文件：${path.basename(a.input)} ｜ 提前提醒：${leadDays} 天${filterCat ? ` ｜ 仅统计：${filterCat}` : ''}`);
  L.push(`生成时间：${C.localDateTime()}（北京时间）　提交对象：车间设备主任 / 公司设备管理部门（特种设备管理员）`);
  L.push('');
  L.push('## 一、到期概览');
  L.push('');
  L.push(C.mdTable(['指标', '数量'], [
    ['台账设备总数', counts.total],
    ['已超期', counts.overdue],
    [`临期（${leadDays} 天内）`, counts.dueSoon],
    ['周期内正常', counts.normal],
    ['待核实（未判定）', counts.undetermined],
    ['其中：储罐待核实', counts.tankSuspect],
    ['日期不一致', counts.dateConflict],
    ['监控使用', counts.monitored],
    ['应停用', counts.stopped],
    ['年度检查超期', counts.annualOverdue === null ? '—（台账无年度检查列）' : counts.annualOverdue],
    ['遗留整改项', counts.openIssues === null ? '—（未提供整改项清单）' : counts.openIssues],
  ]));
  L.push('按设备类别：');
  L.push('');
  L.push(C.mdTable(['设备类别', '台数', '超期', '临期', '正常', '待核实'],
    byCategory.map((x) => [x.category, x.total, x.overdue, x.dueSoon, x.normal, x.undetermined])));

  L.push('## 二、超期清单');
  L.push('');
  if (overdue.length) {
    L.push(`**${OVERDUE_BANNER}**`);
    L.push('');
  }
  L.push(C.mdTable(['设备类别', '位号', '设备名称', '设备代码', '使用登记证编号', '安全状况等级', '上次检验日期', '下次检验日期', '超期天数', '检验机构'],
    overdue.map((x) => [x.category || '—', x.tag, x.name || '—', x.regCode || '—', x.licence || '—', G(x.grade), x.lastDate || '—', x.nextDate, x.overdueDays, x.inspector || '—'])));

  L.push(`## 三、临期清单（${leadDays} 天内到期）`);
  L.push('');
  L.push(C.mdTable(['设备类别', '位号', '设备名称', '设备代码', '安全状况等级', '上次检验日期', '下次检验日期', '剩余天数', '到期日依据'],
    dueSoon.map((x) => [x.category || '—', x.tag, x.name || '—', x.regCode || '—', G(x.grade), x.lastDate || '—', x.nextDate, x.remainDays, x.nextSource])));

  L.push('## 四、检验日期不一致项');
  L.push('');
  if (!dateConflict.length) L.push('_无_\n');
  else {
    L.push('台账载明与按规则计算不一致，**以台账中检验报告载明的日期为准，计算值仅作校验参考**，请核对检验报告后更新台账。');
    L.push('');
    L.push(C.mdTable(['位号', '设备名称', '设备类别', '安全状况等级', '台账下次检验日期', '规则计算值', '相差天数', '计算依据', '出处'],
      dateConflict.map((x) => [x.tag, x.name || '—', x.category || '—', G(x.grade), x.ledgerNext, x.calcNext, x.gapDays, x.periodBasis || '—', `${x.sheet} 第${x.row}行`])));
  }

  L.push('## 五、待核实项（周期或到期日无法确定）');
  L.push('');
  if (!undetermined.length) L.push('_无_\n');
  else {
    L.push('以下设备**未按任何默认周期处理**，需补齐字段后重新计算。「储罐」类别须先核实是否为压力容器（常压储罐不是特种设备）；安全阀校验周期以厂内规定为准，请用 valve-instrument-calibration-ledger。');
    L.push('');
    L.push(C.mdTable(['位号', '设备名称', '设备类别', '缺失字段', '原因', '出处'],
      undetermined.map((x) => [x.tag, x.name || '—', x.category || x.rawCategory || '—', x.missing || '—', x.reason, `${x.sheet} 第${x.row}行`])));
  }

  L.push('## 六、遗留整改项');
  L.push('');
  if (openIssues === null) L.push('_未提供整改项清单（--issues），本节不出数。_\n');
  else L.push(C.mdTable(['位号', '设备名称', '整改项', '要求完成日期', '超期天数', '整改状态', '责任人'],
    openIssues.map((x) => [x.tag, x.name || '—', x.issue || '—', x.dueDate || '—', x.overdueDays === null ? '—' : x.overdueDays, x.status, x.owner || '—'])));

  L.push('## 七、年度检查到期（使用单位年度检查，车间设备员主责）');
  L.push('');
  if (annualCheck === null) L.push('_台账无「上次年度检查日期」列，本节不出数；建议在台账补此列（压力容器 / 压力管道每年一次年度检查由使用单位组织）。_\n');
  else {
    L.push(`${ANNUAL_NOTE}。`);
    L.push('');
    L.push(C.mdTable(['指标', '数量'], [
      ['年度检查超期', counts.annualOverdue],
      [`年度检查临期（${leadDays} 天内）`, counts.annualDueSoon],
      ['年度检查周期内', annualCheck.normal.length],
      ['年度检查日期缺失', counts.annualUndetermined],
    ]));
    const annualRows = [...annualCheck.overdue, ...annualCheck.dueSoon, ...annualCheck.undetermined];
    if (!annualRows.length) L.push('_无超期、临期或缺失项。_\n');
    else L.push(C.mdTable(['位号', '设备名称', '设备类别', '上次年度检查', '下次年度检查', '状态', '出处'],
      annualRows.map((x) => [x.tag, x.name || '—', x.category, x.lastAnnual || '—（缺失）', x.nextAnnual || '—',
        x.overdueDays !== undefined ? `已超期 ${x.overdueDays} 天` : (x.remainDays !== undefined ? `剩余 ${x.remainDays} 天` : '待核实：' + x.reason), `${x.sheet} 第${x.row}行`])));
  }

  L.push('## 八、监控使用与应停用设备');
  L.push('');
  if (!monitored.length && !stopped.length) L.push('_无_\n');
  else L.push(C.mdTable(['位号', '设备名称', '设备类别', '安全状况等级', '说明'],
    [...stopped, ...monitored].map((x) => [x.tag, x.name || '—', x.category || '—', G(x.grade), x.reason])));

  L.push('## 九、检验报告归档核对');
  L.push('');
  if (reports === null) L.push('_未提供检验报告目录（--reports），不做归档核对。_\n');
  else if (!reports.missing.length) L.push(`_已核对 ${reports.fileCount} 个报告文件，台账设备均可匹配到报告（按位号或设备代码匹配文件名，不读取报告内容）。_\n`);
  else L.push(C.mdTable(['位号', '设备名称', '设备类别', '设备代码'],
    reports.missing.map((x) => [x.tag, x.name || '—', x.category || '—', x.regCode || '—'])));

  L.push('## 十、定检管理说明');
  L.push('');
  L.push('<!-- ANALYSIS_START -->');
  L.push('（由模型依据 references/inspection-rules.md 口径撰写 200~400 字，结构：到期概览 → 超期设备与法律风险 → 临期设备与报检安排 → 年度检查与遗留整改项 → 数据待核实项。数量与天数一律引用 inspection.json；不判定检验结论与安全状况等级，不认可任何形式的超期使用。）');
  L.push('<!-- ANALYSIS_END -->');
  L.push('');
  L.push('---');
  L.push('');
  L.push('> 检验周期为默认参考口径，**以现行有效法规与检验机构报告载明为准**；本报告由脚本汇总、模型成文，仅供车间设备员复核参考，不判定检验结论与安全状况等级，不认可任何形式的超期使用；报检手续由特种设备管理员办理。');
  L.push('');
  if (warnings.length) {
    L.push('## 附：数据提示');
    L.push('');
    for (const w of warnings) L.push(`- ${w}`);
    L.push('');
  }
  fs.writeFileSync(path.join(outDir, 'inspection.md'), L.join('\n'), 'utf8');

  // ---- 报检准备清单
  const P = [];
  P.push(`# ${a.workshop} 特种设备报检准备清单（基准日 ${date}）`);
  P.push('');
  if (overdue.length) {
    P.push(`> **${OVERDUE_BANNER}**`);
    P.push('');
  }
  P.push(`覆盖类别 ${presentCats.length} 类、设备 ${counts.total} 台；其中需近期报检（超期 + ${leadDays} 天内临期）${counts.overdue + counts.dueSoon} 台。`);
  P.push(`生成时间：${C.localDateTime()}（北京时间）`);
  P.push('');
  let idx = 0;
  const CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  for (const pm of prepMaterials) {
    P.push(`## ${CN[idx++] || idx}、${pm.category}（台账 ${pm.equipmentCount} 台，需近期报检 ${pm.actionCount} 台）`);
    P.push('');
    const list = [...overdue, ...dueSoon].filter((x) => x.category === pm.category);
    if (list.length) {
      P.push(C.mdTable(['位号', '设备名称', '设备代码', '下次检验日期', '状态'],
        list.map((x) => [x.tag, x.name || '—', x.regCode || '—', x.nextDate,
          x.overdueDays !== undefined ? `已超期 ${x.overdueDays} 天` : `剩余 ${x.remainDays} 天`])));
    } else {
      P.push('_本类别当前无超期或临期设备，资料按下表预备即可。_');
      P.push('');
    }
    P.push('应备资料：');
    P.push('');
    for (const m of pm.materials) P.push(`- [ ] ${m}`);
    P.push('');
  }
  if (!prepMaterials.length) { P.push('_台账中未识别到任何一类特种设备，无法生成应备资料清单。_'); P.push(''); }
  P.push('---');
  P.push('');
  P.push('> 资料清单为默认参考口径，**以检验机构受理要求与厂内特种设备管理制度为准**；报检手续由特种设备管理员办理，本清单不替代其法定职责。');
  P.push('');
  fs.writeFileSync(path.join(outDir, '报检准备清单.md'), P.join('\n'), 'utf8');

  C.emitOk(outDir, { ok: true, out: outDir, date, workshop: a.workshop, leadDays, counts, warnings });
}

try { main(); } catch (e) { C.fail(e, warnings); }
