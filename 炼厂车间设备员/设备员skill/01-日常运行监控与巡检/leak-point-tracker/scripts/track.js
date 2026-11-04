#!/usr/bin/env node
'use strict';
/**
 * 泄漏点登记与修复跟踪脚本（仅 Node.js 内置模块）—— 中石化体系炼化厂车间设备员口径
 * 用法：node "<技能目录>/scripts/track.js" --input <检测记录xlsx> --workshop "常减压车间" --date 2026-09-21 [--out <dir>]
 *       [--ledger <历史漏点台账xlsx>] [--seal-points <密封点台账xlsx | "静:N,动:M">]
 *       [--static-limit <静密封点泄漏率考核线‰>] [--dynamic-limit <动密封点泄漏率考核线‰>]
 *       [--threshold-voc <阈值>] [--threshold-liquid <阈值>] [--repair-days <首次修复时限天数>] [--final-days <最终修复时限天数>]
 * 产出：<out>/leaks.json、<out>/leak-report.md、<out>/ledger.xlsx、<out>/summary.json；末行打印 JSON 摘要
 *
 * 硬口径（不得放宽，环保合规红线）：
 *   - 检测值为空或无法解析 → null + undetermined 单列，**绝不按 0 计为不泄漏**
 *   - 无检测值的可见泄漏（滴漏/渗漏）按定性口径单独判定，**不与仪器检测值混算**
 *   - 密封点编号重复 → warning 并两条均保留，**不自动合并**
 *   - 超期未修单列 overdue 并给出超期天数；「延迟修复」须有批准日期才不计超期，无批准日期 → undetermined
 *   - 静/动密封点泄漏率（‰）必须有密封点总数才算，缺总数 → null；考核线以厂内指标为准，未给考核线不判合格
 *   - 合规提示行由脚本直接写入 md，不得删除或改写
 * 制度出处：GB 31570 与中国石化 LDAR 管理要求（名称引用，不转述数值）；脚本内置阈值与时限为默认参考口径，以厂内制度文件为准。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readXlsx, readCsvDir, writeXlsx } = require('./lib/xlsx-lite');
const C = require('./lib/common');

const warnings = [];
const VALUE_OPTS = ['input', 'workshop', 'date', 'out', 'ledger', 'seal-points', 'static-limit', 'dynamic-limit',
  'threshold-voc', 'threshold-liquid', 'repair-days', 'final-days'];
const FLAG_OPTS = ['help'];

const COMPLIANCE_LINE = '**本报告为车间内部泄漏点跟踪材料，不替代法定 LDAR 检测报告与排污许可执行报告；泄漏认定阈值、修复时限与泄漏率考核线以现行法规与厂内规定为准，达标判定以生态环境主管部门意见为准。**';
// 本底值只登记、不参与判定（不从检测值中扣除）；输入里有本底值时提示按厂内口径复核
const BG_NOTE = '本底值仅登记，未从检测值中扣除；如厂内按扣除本底后的净值判定泄漏，请按厂内口径复核';
const SOURCE_LINE = '制度出处：GB 31570 与中国石化 LDAR 管理要求（名称引用，不转述数值）；脚本内置阈值与时限为默认参考口径，数值以厂内制度文件为准。';

// 局部别名优先，再合并中石化系统共享别名（SAP PM / EM / 智能巡检 / LDAR 系统）。
// 注意：「设备编号」不是位号（SAP 为 8 位流水号），从位号别名中删除，单独成列展示；
//      「序号 / ID」过宽，不再作密封点编号别名（LDAR 系统导出常带「序号」列，会误配）。
const ALIASES = C.mergeAliases({
  '密封点编号': ['密封点编号', '密封点号', '漏点编号', '密封点标签号', '标签号', '点位编号', '密封点ID', '组件编号', '编号'],
  '位号': ['位号', '设备位号', '装置位号', '管线号', '所属设备', '所属位号'],
  '组件类型': ['组件类型', '密封点类型', '部件类型', '组件', '组件类别'],
  '组件子类型': ['组件子类型', '密封点子类型', '部件子类型', '子类型', '组件子类', '子类别'],
  '密封类型': ['密封类型', '密封点类别', '静动密封', '动静密封', '密封点性质', '密封形式', '静/动密封', '动/静密封'],
  '介质': ['介质', '物料', '介质名称', '物料名称', '介质类型'],
  '介质状态': ['介质状态', '物料状态', '相态', '介质相态', '状态分类'],
  '检测方法': ['检测方法', '检测方式', '检测手段', '方法'],
  '检测值': ['检测值', '检测浓度', '净检测值', '净值', '检测净值', '浓度', '读数', 'VOCs浓度', '仪器读数', '泄漏浓度'],
  '本底值': ['本底值', '本底', '背景值', '环境本底', '本底浓度'],
  '检测时间': ['检测时间', '检测日期', '发现时间', '发现日期', '登记日期', '检测时刻'],
  '发现人': ['发现人', '检测人', '巡检人', '登记人', '上报人', '检测人员'],
  '泄漏形态': ['泄漏形态', '可见泄漏', '泄漏情况', '泄漏描述', '现象', '泄漏现象', '目视情况'],
  '不可达点': ['不可达点', '是否不可达', '不可达', '难以检测点', '不可达标识', '是否难以检测'],
  '状态': ['状态', '修复状态', '整改状态', '处理状态', '修复情况', '泄漏状态'],
  '首次修复日期': ['首次修复日期', '首次修复时间', '初次修复日期', '初次修复时间', '临时修复日期', '首次维修日期'],
  '最终修复日期': ['最终修复日期', '最终修复时间', '彻底修复日期', '消漏日期', '复测合格日期', '最终维修日期'],
  '复测日期': ['复测日期', '复测时间', '复检日期', '复检时间', '修复后检测日期'],
  '复测值': ['复测值', '复测浓度', '修后检测值', '修复后检测值', '复查值', '复检值'],
  '延迟修复批准日期': ['延迟修复批准日期', '延迟修复审批日期', '延迟修复批准时间', '延迟批准日期', '延期修复批准日期', '批准日期', '审批日期'],
  '延迟修复批准人': ['延迟修复批准人', '延迟修复审批人', '批准人', '审批人'],
  '责任人': ['责任人', '修复责任人', '负责人', '责任者'],
  '备注': ['备注', '说明', '情况说明'],
});
const OPTIONAL_COLS = ['位号', '设备编号', '装置', '组件类型', '组件子类型', '密封类型', '介质', '介质状态', '检测方法', '检测值', '本底值',
  '检测时间', '发现人', '泄漏形态', '不可达点', '状态', '首次修复日期', '最终修复日期', '复测日期', '复测值',
  '延迟修复批准日期', '延迟修复批准人', '责任人', '备注'];

// ---- 介质状态归一：gas（气体/轻液）/ heavy（重液）；无法归类 → unknown（阈值不确定 → undetermined）
const MED_HEAVY = ['重液', '重油', '渣油', '蜡油', '重质液', '稠油', '沥青', '重组分', 'heavy'];
const MED_GAS = ['气体', '气相', '轻液', '轻油', '气', '汽油', '石脑油', '液化气', '轻质液', '轻组分', 'gas', 'light'];
function classifyMedium(state, medium) {
  const s = (C.str(state) + '|' + C.str(medium)).replace(/\s/g, '');
  if (s === '|') return null;
  if (MED_HEAVY.some((k) => s.includes(k))) return 'heavy';
  if (MED_GAS.some((k) => s.includes(k))) return 'gas';
  return 'unknown';
}
const MED_CN = { gas: '气体/轻液', heavy: '重液', unknown: '介质状态无法识别', null: '介质状态缺失' };

// ---- 静/动密封归一：先看「密封类型」列，再按组件类型推定（泵/压缩机/搅拌器/风机等转动设备轴封 → 动密封；法兰/阀门/连接件/开口管线/取样口/泄压设备 → 静密封）
const SEAL_DYNAMIC_KW = ['动密封', '动态密封', 'dynamic', '转动'];
const SEAL_STATIC_KW = ['静密封', '静态密封', 'static'];
const COMP_DYNAMIC_KW = ['泵密封', '泵轴封', '机械密封', '机封', '压缩机密封', '压缩机轴封', '搅拌器密封', '搅拌密封', '风机密封', '轴封', '填料密封(泵)', '泵', '压缩机', '搅拌', '风机'];
const COMP_STATIC_KW = ['法兰', '阀门', '连接件', '开口管线', '取样口', '取样连接', '泄压', '安全阀', '螺纹', '盲板', '人孔', '手孔', '管件', '活接', '仪表接口', '接头'];
function classifySealType(explicit, comp) {
  const e = C.str(explicit).replace(/\s/g, '');
  if (e) {
    if (SEAL_DYNAMIC_KW.some((k) => e.toLowerCase().includes(k))) return { type: 'dynamic', basis: '密封类型列' };
    if (SEAL_STATIC_KW.some((k) => e.toLowerCase().includes(k))) return { type: 'static', basis: '密封类型列' };
    if (/^动$/.test(e)) return { type: 'dynamic', basis: '密封类型列' };
    if (/^静$/.test(e)) return { type: 'static', basis: '密封类型列' };
    return { type: 'unknown', basis: `密封类型「${e}」无法识别` };
  }
  const c = C.str(comp).replace(/\s/g, '');
  if (!c) return { type: null, basis: '密封类型与组件类型均未填' };
  if (COMP_DYNAMIC_KW.some((k) => c.includes(k))) return { type: 'dynamic', basis: `按组件类型「${c}」推定` };
  if (COMP_STATIC_KW.some((k) => c.includes(k))) return { type: 'static', basis: `按组件类型「${c}」推定` };
  return { type: 'unknown', basis: `组件类型「${c}」无法推定静/动密封` };
}
const SEAL_CN = { static: '静密封', dynamic: '动密封', unknown: '静/动未识别', null: '静/动未填' };

// ---- 不可达点归一
function parseFlag(v) {
  const s = C.str(v).replace(/\s/g, '').toLowerCase();
  if (s === '') return null;
  if (['是', 'y', 'yes', 'true', '√', '✓', '1', '不可达', '难以检测', '不可达点'].includes(s)) return true;
  if (['否', 'n', 'no', 'false', '×', '0', '可达', '可检测'].includes(s)) return false;
  return null;
}

// ---- 泄漏形态归一：滴漏/成股流出 → 认定泄漏；渗漏/油迹 → 观察项（不认定，但单列）；无 → null
const VIS_LEAK = ['滴漏', '滴落', '成股', '流出', '喷溅', '喷出', '漏液', '漏油', '连续滴', '明显泄漏', '大量'];
const VIS_WATCH = ['渗漏', '渗油', '油迹', '油渍', '微渗', '湿润', '挂壁', '轻微渗'];
const VIS_NONE = ['无', '无泄漏', '正常', '未见泄漏', '干燥', '无渗漏'];
function classifyVisible(v) {
  const s = C.str(v).replace(/\s/g, '');
  if (s === '' || s === '—' || s === '-' || s === '/') return null;
  if (VIS_NONE.some((k) => s === k || s === k + '。')) return 'none';
  if (VIS_LEAK.some((k) => s.includes(k))) return 'leak';
  if (VIS_WATCH.some((k) => s.includes(k))) return 'watch';
  if (VIS_NONE.some((k) => s.includes(k))) return 'none';
  return 'unknown';
}
const VIS_CN = { leak: '滴漏/成股流出', watch: '渗漏（观察项）', none: '未见可见泄漏', unknown: '泄漏形态无法识别', null: '未填泄漏形态' };

// ---- 修复状态归一（「延迟修复」单列，不再归入未修复）
const ST_DELAYED = ['延迟修复', '延期修复', '延迟维修', '延期维修', '批准延迟', '已批延迟', '延迟至停工', '延迟到大检修', '延迟'];
const ST_FIXED = ['已修复', '已消漏', '修复完毕', '已完成', '已整改', '已消除', '复测合格', '已闭环', '完成'];
const ST_TEMP = ['已临时修复', '临时修复', '首次修复', '已紧固', '紧固处理', '带压堵漏', '临时处理'];
const ST_OPEN = ['未修复', '未处理', '待修复', '挂牌', '未消漏', '待处理', '计划检修', '停车修复', '已提通知单', '待维修'];
function classifyStatus(v) {
  const s = C.str(v).replace(/\s/g, '');
  if (s === '' || s === '—' || s === '-' || s === '/') return null;
  if (ST_DELAYED.some((k) => s.includes(k))) return 'delayed';
  if (ST_TEMP.some((k) => s.includes(k))) return 'temp';
  if (ST_FIXED.some((k) => s.includes(k))) return 'fixed';
  if (ST_OPEN.some((k) => s.includes(k))) return 'open';
  return 'unknown';
}
const STATUS_CN = { fixed: '已修复', temp: '已首次修复（未最终修复）', open: '未修复', delayed: '延迟修复', unknown: '修复状态无法识别', null: '修复状态未填' };

// ---- 默认口径（references/ldar-rules.md，默认参考口径，非法定值的转述，可被参数覆盖）
const DEFAULT = {
  thresholdVoc: 2000,     // μmol/mol，VOCs 气体 / 轻液
  thresholdLiquid: 500,   // μmol/mol，重液
  repairDays: 5,          // 首次修复时限（天）
  finalDays: 15,          // 最终修复时限（天）
};

function loadBook(p) {
  const st = fs.statSync(p);
  return st.isDirectory() ? readCsvDir(p) : readXlsx(p);
}

function posNum(v, name) {
  const n = Number(String(v).trim());
  if (!Number.isFinite(n) || n < 0) throw new Error(`--${name} 「${v}」不是有效的非负数值`);
  return n;
}

/**
 * 密封点总数：--seal-points 接受两种形式
 *   1) 字符串 "静:12000,动:800"（也认 静密封:/动密封:/static:/dynamic:）
 *   2) 密封点台账 xlsx（工作表「密封点台账 / 密封点清单 / 密封点」，一行一密封点，按「密封类型」列或组件类型推定计数）
 * 返回 { static, dynamic, unclassified, source }；无法得到的项为 null
 */
function loadSealPoints(v) {
  const s = C.str(v);
  const m = s.match(/(静密封|静|static)\s*[:：=]\s*(\d+)/i);
  const n = s.match(/(动密封|动|dynamic)\s*[:：=]\s*(\d+)/i);
  if (m || n) {
    return { static: m ? +m[2] : null, dynamic: n ? +n[2] : null, unclassified: 0, source: `参数给定（${s}）` };
  }
  if (!fs.existsSync(s)) throw new Error(`--seal-points 「${s}」既不是 "静:N,动:M" 形式，也不是存在的密封点台账文件`);
  let book;
  try { book = loadBook(s); } catch (e) { throw new Error(`密封点台账读取失败 ${s}: ${e.message}`); }
  const sheet = pickSheetName(book, '密封点台账', '密封点清单', '密封点统计', '密封点');
  if (!sheet) throw new Error(`密封点台账「${path.basename(s)}」中未找到「密封点台账」工作表`);
  const rows = book[sheet];
  const hdr = (rows[0] || []).map((c) => C.str(c).replace(/\s+/g, ''));
  // 形式 2a：汇总表（含「静密封点数 / 动密封点数」列）
  const si = hdr.findIndex((h) => /^静密封点(总)?数/.test(h));
  const di = hdr.findIndex((h) => /^动密封点(总)?数/.test(h));
  if (si >= 0 || di >= 0) {
    const r = rows[1] || [];
    const num = C.makeNum(warnings);
    const st = si >= 0 ? num(r[si], { sheet, row: 2, col: hdr[si] }) : null;
    const dy = di >= 0 ? num(r[di], { sheet, row: 2, col: hdr[di] }) : null;
    return { static: st, dynamic: dy, unclassified: 0, source: `密封点台账汇总（${path.basename(s)}）` };
  }
  // 形式 2b：一行一密封点
  const recs = C.toRecords(rows, ['密封点编号'], sheet, ['组件类型', '密封类型'], warnings, ALIASES);
  let st = 0, dy = 0, un = 0;
  for (const r of recs) {
    const t = classifySealType(r['密封类型'], r['组件类型']).type;
    if (t === 'static') st++; else if (t === 'dynamic') dy++; else un++;
  }
  if (un) warnings.push(`密封点台账「${sheet}」有 ${un} 行无法识别静/动密封，未计入任一分母（请补「密封类型」列）`);
  return { static: st, dynamic: dy, unclassified: un, source: `密封点台账逐点计数（${path.basename(s)}，共 ${recs.length} 行）` };
}

function main() {
  const a = C.parseArgs(process.argv.slice(2), VALUE_OPTS, FLAG_OPTS);
  if (!a.input) throw new Error('缺少 --input');
  if (!a.workshop) throw new Error('缺少 --workshop');
  if (!a.date) throw new Error('缺少 --date');
  const date = C.normDate(a.date);
  if (!date) throw new Error(`--date 「${a.date}」不是有效日期，应为 YYYY-MM-DD`);
  if (!fs.existsSync(a.input)) throw new Error(`输入不存在: ${a.input}`);
  const outDir = a.out || path.join(os.tmpdir(), 'lpt-out');

  // ---- 口径：默认 + 参数覆盖
  const thVoc = a['threshold-voc'] !== undefined ? posNum(a['threshold-voc'], 'threshold-voc') : DEFAULT.thresholdVoc;
  const thLiquid = a['threshold-liquid'] !== undefined ? posNum(a['threshold-liquid'], 'threshold-liquid') : DEFAULT.thresholdLiquid;
  const repairDays = a['repair-days'] !== undefined ? posNum(a['repair-days'], 'repair-days') : DEFAULT.repairDays;
  const finalDays = a['final-days'] !== undefined ? posNum(a['final-days'], 'final-days') : DEFAULT.finalDays;
  if (finalDays < repairDays) throw new Error(`--final-days ${finalDays} 小于 --repair-days ${repairDays}，最终修复时限不得早于首次修复时限`);
  const staticLimit = a['static-limit'] !== undefined ? posNum(a['static-limit'], 'static-limit') : null;
  const dynamicLimit = a['dynamic-limit'] !== undefined ? posNum(a['dynamic-limit'], 'dynamic-limit') : null;
  const overridden = ['threshold-voc', 'threshold-liquid', 'repair-days', 'final-days'].filter((k) => a[k] !== undefined);
  const rulesSource = overridden.length
    ? `用户指定口径（已覆盖：${overridden.map((k) => '--' + k).join('、')}），其余按默认参考口径`
    : '默认参考口径（references/ldar-rules.md，以现行法规与厂内规定为准）';

  // ---- 密封点总数（泄漏率分母）
  let sealPoints = null;
  if (a['seal-points'] !== undefined) sealPoints = loadSealPoints(a['seal-points']);
  else warnings.push('未提供密封点总数（--seal-points），静/动密封点泄漏率无法计算，已单列「未提供密封点总数」');

  // ---- 读取本期检测/漏点记录
  let book;
  try { book = loadBook(a.input); } catch (e) { throw new Error(`读取失败 ${a.input}: ${e.message}`); }
  const sheetName = pickSheetName(book, '检测记录', '漏点记录', '泄漏点记录', 'LDAR检测记录', '密封点检测', '泄漏', 'LDAR', '检测数据', '检测明细');
  const rows = sheetName ? book[sheetName] : null;
  if (!rows) throw new Error('未在输入中找到「检测记录」或「漏点记录」工作表');
  const recs = C.toRecords(rows, ['密封点编号'], sheetName, OPTIONAL_COLS, warnings, ALIASES);
  const num = C.makeNum(warnings);

  // ---- 历史台账（可选，用于续跟踪）
  const history = new Map();      // key: 密封点编号 → 台账条目（数组，编号重复时全保留）
  let ledgerProvided = false, ledgerSheetName = null;
  if (a.ledger) {
    if (!fs.existsSync(a.ledger)) throw new Error(`历史漏点台账不存在: ${a.ledger}`);
    let lb;
    try { lb = loadBook(a.ledger); } catch (e) { throw new Error(`历史漏点台账读取失败 ${a.ledger}: ${e.message}`); }
    ledgerSheetName = pickSheetName(lb, '漏点台账', '泄漏点台账', '台账', '漏点记录');
    if (!ledgerSheetName) warnings.push(`历史漏点台账「${path.basename(a.ledger)}」中未找到「漏点台账」工作表，本期按全新登记处理`);
    else {
      ledgerProvided = true;
      const lrecs = C.toRecords(lb[ledgerSheetName], ['密封点编号'], ledgerSheetName, OPTIONAL_COLS, warnings, ALIASES);
      for (const r of lrecs) {
        const no = C.str(r['密封点编号']);
        if (!no) { warnings.push(`历史台账「${ledgerSheetName}」第${r._row}行 密封点编号为空，已跳过`); continue; }
        if (!history.has(no)) history.set(no, []);
        history.get(no).push(r);
      }
    }
  } else {
    warnings.push('未提供历史漏点台账（--ledger），本期全部漏点按新增登记，无法判断是否为历史续跟踪项');
  }

  // ---- 逐条判定
  const items = [];
  const seenNo = new Map();
  for (const r of recs) {
    const no = C.str(r['密封点编号']);
    const tag = C.str(r['位号']);
    if (!no && !tag) { warnings.push(`工作表「${sheetName}」第${r._row}行 密封点编号与位号均为空，已跳过`); continue; }
    if (!no) warnings.push(`工作表「${sheetName}」第${r._row}行 密封点编号为空，按位号跟踪`);
    let dupOf = null;
    if (no) {
      if (seenNo.has(no)) {
        dupOf = seenNo.get(no);
        warnings.push(`工作表「${sheetName}」第${r._row}行 密封点编号「${no}」与第${dupOf}行重复，两条均保留并各自判定，未自动合并`);
      } else seenNo.set(no, r._row);
    }

    // 介质状态
    const rawMedium = C.str(r['介质']);
    const rawState = C.str(r['介质状态']);
    const medium = classifyMedium(r['介质状态'], r['介质']);
    if (medium === 'unknown') warnings.push(`工作表「${sheetName}」第${r._row}行 介质「${rawMedium || '—'}」/介质状态「${rawState || '—'}」无法归类为气体轻液或重液，泄漏阈值无法确定`);

    // 静/动密封
    const comp = C.str(r['组件类型']);
    const seal = classifySealType(r['密封类型'], r['组件类型']);
    if (seal.type === 'unknown') warnings.push(`工作表「${sheetName}」第${r._row}行 ${seal.basis}，不计入静/动密封点泄漏率分子`);

    // 不可达点
    const rawUnreach = C.str(r['不可达点']);
    const unreachable = parseFlag(r['不可达点']);
    if (rawUnreach && unreachable === null) warnings.push(`工作表「${sheetName}」第${r._row}行 不可达点「${rawUnreach}」无法识别（应填 是/否）`);

    // 检测值：空 / 不可解析 → null，绝不按 0（带单位如「3200ppm」由 makeNum 剥离单位）
    const rawValue = C.str(r['检测值']);
    const value = num(r['检测值'], { sheet: sheetName, row: r._row, col: '检测值' });
    const bg = num(r['本底值'], { sheet: sheetName, row: r._row, col: '本底值' });
    if (rawValue !== '' && value === null) warnings.push(`工作表「${sheetName}」第${r._row}行 检测值「${rawValue}」无法解析，该点归入未判定，未按 0 计为不泄漏`);

    // 可见泄漏形态
    const rawVis = C.str(r['泄漏形态']);
    const visible = classifyVisible(r['泄漏形态']);
    if (visible === 'unknown') warnings.push(`工作表「${sheetName}」第${r._row}行 泄漏形态「${rawVis}」无法归类，该点按定性口径未判定`);

    // 检测/发现时间
    const foundDate = C.normDate(r['检测时间']);
    if (r['检测时间'] && !foundDate) warnings.push(`工作表「${sheetName}」第${r._row}行 检测时间「${C.str(r['检测时间'])}」无法解析`);
    if (foundDate && C.diffDays(foundDate, date) > 0) warnings.push(`工作表「${sheetName}」第${r._row}行 检测时间 ${foundDate} 晚于统计截止日期 ${date}，仍予保留`);

    // 修复状态与日期
    const rawStatus = C.str(r['状态']);
    const status = classifyStatus(r['状态']);
    if (status === 'unknown') warnings.push(`工作表「${sheetName}」第${r._row}行 修复状态「${rawStatus}」无法归类，该点归入未判定`);
    const firstFix = C.normDate(r['首次修复日期']);
    if (r['首次修复日期'] && !firstFix) warnings.push(`工作表「${sheetName}」第${r._row}行 首次修复日期「${C.str(r['首次修复日期'])}」无法解析`);
    const finalFix = C.normDate(r['最终修复日期']);
    if (r['最终修复日期'] && !finalFix) warnings.push(`工作表「${sheetName}」第${r._row}行 最终修复日期「${C.str(r['最终修复日期'])}」无法解析`);
    const retestDate = C.normDate(r['复测日期']);
    if (r['复测日期'] && !retestDate) warnings.push(`工作表「${sheetName}」第${r._row}行 复测日期「${C.str(r['复测日期'])}」无法解析`);
    const retest = num(r['复测值'], { sheet: sheetName, row: r._row, col: '复测值' });
    const delayApproval = C.normDate(r['延迟修复批准日期']);
    if (r['延迟修复批准日期'] && !delayApproval) warnings.push(`工作表「${sheetName}」第${r._row}行 延迟修复批准日期「${C.str(r['延迟修复批准日期'])}」无法解析`);
    const delayApprover = C.str(r['延迟修复批准人']);

    // ---- 一、泄漏认定（两条互不混算的通道）
    let source = null;          // 'instrument' | 'visible'
    let threshold = null, isLeak = null, leakBasis = null, undetReason = null;
    if (value !== null) {
      source = 'instrument';
      if (medium === 'gas') { threshold = thVoc; }
      else if (medium === 'heavy') { threshold = thLiquid; }
      else {
        undetReason = medium === null
          ? '介质与介质状态均未填写，无法确定适用的泄漏认定阈值（气体/轻液或重液）'
          : `介质「${rawMedium || '—'}」/介质状态「${rawState || '—'}」无法归类，无法确定适用的泄漏认定阈值`;
      }
      if (threshold !== null) {
        isLeak = value >= threshold;
        leakBasis = `仪器检测 ${value} μmol/mol ${isLeak ? '≥' : '<'} ${MED_CN[medium]}阈值 ${threshold} μmol/mol`;
      }
    } else if (visible === 'leak') {
      source = 'visible';
      isLeak = true;
      leakBasis = `现场可见泄漏定性认定（${rawVis}），无仪器检测值，不与检测浓度混算`;
    } else if (visible === 'watch') {
      source = 'visible';
      isLeak = false;
      leakBasis = `现场可见渗漏（${rawVis}），按定性口径列为观察项，未认定为泄漏，无仪器检测值`;
    } else if (visible === 'none') {
      source = 'visible';
      isLeak = false;
      leakBasis = '现场目视未见泄漏，无仪器检测值';
    } else if (unreachable === true) {
      undetReason = '不可达点，本期无检测值亦无可见泄漏记录，泄漏与否无法判定（未按 0 计为不泄漏，须按厂内不可达点管理要求安排检测）';
    } else {
      // 既无检测值、也无可判定的可见泄漏形态 → 未判定，绝不按 0 计为不泄漏
      undetReason = rawValue !== ''
        ? `检测值「${rawValue}」无法解析，且泄漏形态${rawVis ? `「${rawVis}」无法归类` : '未填写'}，泄漏与否无法判定（未按 0 计为不泄漏）`
        : `检测值为空，且泄漏形态${rawVis ? `「${rawVis}」无法归类` : '未填写'}，泄漏与否无法判定（未按 0 计为不泄漏）`;
    }

    // ---- 二、修复时限（仅对认定为泄漏的点计算）
    let firstDue = null, finalDue = null, firstOverdueDays = null, finalOverdueDays = null;
    if (isLeak === true && foundDate) {
      firstDue = C.addDays(foundDate, repairDays);
      finalDue = C.addDays(foundDate, finalDays);
    } else if (isLeak === true && !foundDate) {
      warnings.push(`工作表「${sheetName}」第${r._row}行 密封点「${no || tag}」已认定泄漏但检测时间缺失或无法解析，修复时限无法计算`);
    }

    // ---- 三、归桶
    let bucket = null, overdueOf = null;
    if (undetReason) bucket = 'undetermined';
    else if (status === null || status === 'unknown') {
      if (isLeak === true) { bucket = 'undetermined'; undetReason = status === null ? '已认定泄漏但修复状态未填，无法判定修复进度' : `已认定泄漏但修复状态「${rawStatus}」无法归类`; }
      else bucket = 'noLeak';
    } else if (isLeak !== true) {
      bucket = 'noLeak';
    } else if (status === 'delayed') {
      // 延迟修复：须有批准日期（延迟修复须经批准并登记），有批准 → 单列 delayed，不计超期；无批准日期 → 未判定
      if (delayApproval) bucket = 'delayed';
      else { bucket = 'undetermined'; undetReason = `状态为「${rawStatus}」但未填延迟修复批准日期，无法确认是否经批准延迟，不按已批准延迟处理（亦未按超期处理）`; }
    } else if (status === 'fixed' && finalFix) {
      bucket = 'repaired';
    } else if (status === 'fixed' && !finalFix) {
      bucket = 'open';
      warnings.push(`工作表「${sheetName}」第${r._row}行 密封点「${no || tag}」状态为「${rawStatus}」但未填最终修复日期，未计入本期修复闭环`);
    } else {
      bucket = 'open';
    }

    // 超期判定（仅对 open 且时限可计算的点；delayed 不计超期）
    if (bucket === 'open' && finalDue) {
      const d = C.diffDays(date, finalDue);
      if (d > 0) { finalOverdueDays = d; overdueOf = 'final'; }
    }
    if (bucket === 'open' && firstDue && !firstFix) {
      const d = C.diffDays(date, firstDue);
      if (d > 0) { firstOverdueDays = d; if (!overdueOf) overdueOf = 'first'; }
    }
    if (overdueOf) bucket = 'overdue';

    // 已修复但超出最终修复时限：仍算闭环，但标注延迟天数
    let lateDays = null;
    if (bucket === 'repaired' && finalDue && finalFix) {
      const d = C.diffDays(finalFix, finalDue);
      if (d > 0) lateDays = d;
    }

    // ---- 四、新增 / 续跟踪
    const hist = no && history.has(no) ? history.get(no) : null;
    const isNew = !ledgerProvided ? true : !hist;
    const firstSeen = hist ? (C.normDate(hist[0]['检测时间']) || foundDate) : foundDate;

    items.push({
      no: no || `（无编号·第${r._row}行）`, tag, equipNo: C.str(r['设备编号']), unit: C.str(r['装置']),
      comp, subComp: C.str(r['组件子类型']),
      sealType: seal.type, sealTypeCn: SEAL_CN[String(seal.type)], sealBasis: seal.basis, rawSealType: C.str(r['密封类型']),
      medium, mediumCn: MED_CN[String(medium)], rawMedium, rawState,
      method: C.str(r['检测方法']),
      value, rawValue, bg, rawBg: C.str(r['本底值']), threshold,
      visible, visibleCn: VIS_CN[String(visible)], rawVis,
      unreachable, rawUnreach,
      source, sourceCn: source === 'instrument' ? '仪器检测' : source === 'visible' ? '现场可见泄漏' : '—',
      isLeak, leakBasis,
      foundDate, finder: C.str(r['发现人']), owner: C.str(r['责任人']),
      status, statusCn: STATUS_CN[String(status)], rawStatus,
      firstFix, finalFix, retestDate, retest,
      delayApproval, delayApprover,
      firstDue, finalDue, firstOverdueDays, finalOverdueDays, overdueOf, lateDays,
      isNew, firstSeen, dupOf,
      note: C.str(r['备注']),
      bucket, undetReason: undetReason || null,
      sheet: sheetName, row: r._row,
    });
  }

  if (!items.length) throw new Error(`「${sheetName}」中无有效检测/漏点记录`);
  const backgroundFilled = items.filter((x) => x.rawBg !== '').length;
  if (backgroundFilled) warnings.push(`工作表「${sheetName}」有 ${backgroundFilled} 行填了本底值：${BG_NOTE}`);

  const byBucket = (b) => items.filter((x) => x.bucket === b);
  const undetermined = byBucket('undetermined');
  const repaired = byBucket('repaired');
  const noLeak = byBucket('noLeak');
  const delayed = byBucket('delayed');
  const overdue = byBucket('overdue').sort((x, y) => (y.finalOverdueDays || y.firstOverdueDays || 0) - (x.finalOverdueDays || x.firstOverdueDays || 0));
  const open = byBucket('open');
  const leaks = items.filter((x) => x.isLeak === true);
  const newLeaks = leaks.filter((x) => x.isNew);

  // 两类来源分别计数（不混算）
  const byInstrument = items.filter((x) => x.source === 'instrument');
  const byVisible = items.filter((x) => x.source === 'visible');
  const instrumentLeaks = byInstrument.filter((x) => x.isLeak === true);
  const visibleLeaks = byVisible.filter((x) => x.isLeak === true);
  const unreachablePts = items.filter((x) => x.unreachable === true);

  // ---- 指标：修复率（分母 0 → null，绝不写 0%）
  const trackTotal = leaks.length;
  const repairRate = trackTotal > 0 ? C.round((repaired.length / trackTotal) * 100, 1) : null;
  const durations = repaired.map((x) => (x.foundDate && x.finalFix) ? C.diffDays(x.finalFix, x.foundDate) : null).filter((d) => d !== null && d >= 0);
  const avgRepairDays = durations.length ? C.round(durations.reduce((s, d) => s + d, 0) / durations.length, 1) : null;

  // ---- 指标：静/动密封点泄漏率（‰）= 本期认定泄漏点数 ÷ 密封点总数 × 1000；缺总数 → null；考核线未给 → 不判合格
  const staticLeaks = leaks.filter((x) => x.sealType === 'static').length;
  const dynamicLeaks = leaks.filter((x) => x.sealType === 'dynamic').length;
  const unclassifiedLeaks = leaks.filter((x) => x.sealType !== 'static' && x.sealType !== 'dynamic').length;
  const rate = (n, total) => (total === null || total === undefined || !Number.isFinite(total) || total <= 0) ? null : C.round((n / total) * 1000, 2);
  const staticTotal = sealPoints ? sealPoints.static : null;
  const dynamicTotal = sealPoints ? sealPoints.dynamic : null;
  const staticRate = rate(staticLeaks, staticTotal);
  const dynamicRate = rate(dynamicLeaks, dynamicTotal);
  const judge = (rt, limit) => (rt === null ? null : limit === null ? null : rt <= limit);
  const leakRate = {
    static: { leaks: staticLeaks, total: staticTotal, rate: staticRate, limit: staticLimit, pass: judge(staticRate, staticLimit) },
    dynamic: { leaks: dynamicLeaks, total: dynamicTotal, rate: dynamicRate, limit: dynamicLimit, pass: judge(dynamicRate, dynamicLimit) },
    unclassifiedLeaks,
    sealPointsSource: sealPoints ? sealPoints.source : null,
    sealPointsProvided: !!sealPoints,
    note: !sealPoints ? '未提供密封点总数（--seal-points），泄漏率无法计算'
      : (staticLimit === null && dynamicLimit === null) ? '未提供厂内考核线（--static-limit / --dynamic-limit），仅列泄漏率，不作达标判定；考核线以厂内指标为准'
        : '考核线由用户参数给定（厂内指标），据此判定',
  };
  if (sealPoints && staticTotal === null) warnings.push('密封点总数缺少静密封点数，静密封点泄漏率无法计算');
  if (sealPoints && dynamicTotal === null) warnings.push('密封点总数缺少动密封点数，动密封点泄漏率无法计算');
  if (unclassifiedLeaks) warnings.push(`${unclassifiedLeaks} 处认定泄漏点无法识别静/动密封，未计入任一泄漏率分子（请补「密封类型」列）`);

  const byComp = {};
  for (const x of leaks) { const k = x.comp || '（未填组件类型）'; byComp[k] = (byComp[k] || 0) + 1; }

  const counts = {
    records: items.length,
    leaks: leaks.length, newLeaks: newLeaks.length,
    open: open.length, overdue: overdue.length, delayed: delayed.length, repaired: repaired.length,
    undetermined: undetermined.length, noLeak: noLeak.length,
    instrument: byInstrument.length, instrumentLeaks: instrumentLeaks.length,
    visible: byVisible.length, visibleLeaks: visibleLeaks.length,
    unreachable: unreachablePts.length,
    staticLeaks, dynamicLeaks, unclassifiedLeaks,
    duplicateNo: items.filter((x) => x.dupOf).length,
    carryOver: leaks.filter((x) => !x.isNew).length,
    backgroundFilled,
  };
  const metrics = {
    repairRate, avgRepairDays,
    leakRate,
    thresholds: { voc: thVoc, liquid: thLiquid },
    limits: { repairDays, finalDays },
    rulesSource, byComponent: byComp,
    ledgerProvided,
  };

  // ---- 全量台账（历史 + 本期，本期同编号覆盖历史当期状态，历史其他条目保留）
  const ledgerRows = buildLedger(items, history, date);

  // ---- 产出
  C.ensureDir(outDir);
  const leaksJson = {
    // 供 equipment-weekly-monthly-report 读取的静/动密封点总数与泄漏点数（与 metrics.leakRate 同源）
    sealPoints: sealPoints ? {
      static: { total: leakRate.static.total, leaks: leakRate.static.leaks },
      dynamic: { total: leakRate.dynamic.total, leaks: leakRate.dynamic.leaks },
    } : null,
    meta: {
      workshop: a.workshop, date, generatedAt: C.localDateTime(),
      input: path.basename(a.input), sheet: sheetName,
      ledger: a.ledger ? path.basename(a.ledger) : null, ledgerProvided,
      sealPoints: a['seal-points'] !== undefined ? String(a['seal-points']) : null,
      rulesSource, sourceLine: SOURCE_LINE, thresholds: metrics.thresholds, limits: metrics.limits,
    },
    counts, metrics,
    newLeaks: newLeaks.map(slim),
    open: open.map(slim),
    overdue: overdue.map(slim),
    delayed: delayed.map(slim),
    repaired: repaired.map(slim),
    undetermined: undetermined.map(slimUndet),
    noLeak: noLeak.map(slim),
    unreachable: unreachablePts.map(slim),
    duplicates: items.filter((x) => x.dupOf).map((x) => ({ ...slim(x), dupOfRow: x.dupOf })),
    ledger: ledgerRows,
    items: items.map(slim),
    warnings,
  };
  fs.writeFileSync(path.join(outDir, 'leaks.json'), JSON.stringify(leaksJson, null, 2), 'utf8');

  // ---- ledger.xlsx
  const LH = ['密封点编号', '位号', '设备编号', '装置', '组件类型', '组件子类型', '密封类型', '介质', '介质状态', '检测方法', '检测值', '泄漏形态', '不可达点',
    '认定结果', '认定依据', '检测时间', '发现人', '责任人', '状态', '首次修复日期', '最终修复日期', '复测日期', '复测值',
    '延迟修复批准日期', '延迟修复批准人', '首次修复期限', '最终修复期限', '超期天数', '当前归类', '首次登记日期', '来源', '备注'];
  writeXlsx(path.join(outDir, 'ledger.xlsx'), {
    '漏点台账': [LH].concat(ledgerRows.map((x) => LH.map((h) => (x[h] === null || x[h] === undefined ? '' : x[h])))),
  });

  // ---- leak-report.md
  const L = [];
  L.push(`# ${a.workshop} 泄漏点登记与修复跟踪（截至 ${date}）`);
  L.push('');
  const alerts = [];
  if (overdue.length) {
    const worst = overdue[0];
    alerts.push(`**存在超期未修漏点 ${overdue.length} 处**，最长超期 ${worst.finalOverdueDays || worst.firstOverdueDays} 天，详见「三、超期未修清单」。`);
  }
  if (undetermined.length) {
    alerts.push(`**${undetermined.length} 处记录因检测值缺失或字段不全无法判定是否泄漏或修复进度**，已单列「六、未判定清单」，**未按不泄漏处理**，须补测或补录后重新判定。`);
  }
  if (alerts.length) {
    L.push('> 【注意】**重点提示**');
    L.push('>');
    for (const t of alerts) L.push(`> - ${t}`);
    L.push('');
  } else {
    L.push('> 本期无超期未修漏点，亦无因数据缺失而未判定的记录。');
    L.push('');
  }
  L.push(`统计截止：${date} ｜ 数据来源：${path.basename(a.input)}（工作表「${sheetName}」）${ledgerProvided ? ` ｜ 历史台账：${path.basename(a.ledger)}` : ' ｜ 未提供历史台账'}`);
  L.push(`认定口径：${rulesSource}`);
  L.push(`泄漏认定阈值：气体/轻液 ${thVoc} μmol/mol；重液 ${thLiquid} μmol/mol；现场可见泄漏按滴漏或成股流出定性认定`);
  if (backgroundFilled) L.push(`本底值：${BG_NOTE}（本期 ${backgroundFilled} 行填了本底值）`);
  L.push(`修复时限：首次修复 ${repairDays} 天内，最终修复 ${finalDays} 天内（自检测/发现日期起算）；经批准的延迟修复单列，不计超期`);
  L.push(`密封点总数：${sealPoints ? sealPoints.source : '未提供（--seal-points），泄漏率不计算'}`);
  L.push(SOURCE_LINE);
  L.push(`生成时间：${C.localDateTime()}（北京时间）`);
  L.push('');
  L.push(COMPLIANCE_LINE);
  L.push('');

  L.push('## 一、总体概览');
  L.push('');
  L.push(C.mdTable(['指标', '数量'], [
    ['本期记录数', counts.records],
    ['认定泄漏（合计）', counts.leaks],
    ['　其中：仪器检测认定', counts.instrumentLeaks],
    ['　其中：现场可见泄漏认定', counts.visibleLeaks],
    ['　其中：静密封点', counts.staticLeaks],
    ['　其中：动密封点', counts.dynamicLeaks],
    ['　其中：静/动未识别', counts.unclassifiedLeaks],
    ['本期新增漏点', counts.newLeaks],
    ['历史续跟踪漏点', counts.carryOver],
    ['未修复（期限内）', counts.open],
    ['超期未修', counts.overdue],
    ['延迟修复（经批准）', counts.delayed],
    ['本期修复闭环', counts.repaired],
    ['未判定', counts.undetermined],
    ['未认定泄漏', counts.noLeak],
    ['不可达点', counts.unreachable],
    ['密封点编号重复', counts.duplicateNo],
  ]));
  L.push(`修复率：**${C.pct(repairRate)}**（最终修复 ${counts.repaired} / 认定泄漏 ${counts.leaks}）${repairRate === null ? '，本期无认定泄漏的漏点，不计算修复率' : ''}`);
  L.push('');
  L.push(`平均修复时长：**${avgRepairDays === null ? '—' : avgRepairDays + ' 天'}**${avgRepairDays === null ? '（无可计算时长的闭环漏点）' : `（基于 ${durations.length} 处可计算的闭环漏点）`}`);
  L.push('');
  L.push('**静/动密封点泄漏率（‰）：**');
  L.push('');
  const passCn = (p, rt, limit) => (rt === null ? '—（泄漏率未计算）' : limit === null ? '未判定（未提供厂内考核线）' : p ? `不高于考核线 ${limit}‰` : `**高于考核线 ${limit}‰**`);
  L.push(C.mdTable(['密封类型', '认定泄漏点数', '密封点总数', '泄漏率(‰)', '考核线(‰)', '判定'], [
    ['静密封点', leakRate.static.leaks, C.fmt(leakRate.static.total, 0), C.fmt(leakRate.static.rate), leakRate.static.limit === null ? '—（以厂内指标为准）' : leakRate.static.limit, passCn(leakRate.static.pass, leakRate.static.rate, leakRate.static.limit)],
    ['动密封点', leakRate.dynamic.leaks, C.fmt(leakRate.dynamic.total, 0), C.fmt(leakRate.dynamic.rate), leakRate.dynamic.limit === null ? '—（以厂内指标为准）' : leakRate.dynamic.limit, passCn(leakRate.dynamic.pass, leakRate.dynamic.rate, leakRate.dynamic.limit)],
  ]));
  if (!sealPoints) {
    L.push('【未判定】未提供密封点总数：静/动密封点泄漏率需要密封点总数作分母（`--seal-points <密封点台账xlsx>` 或 `--seal-points "静:N,动:M"`），本期未提供，泄漏率未计算，不得按 0‰ 表述。');
    L.push('');
  } else if (leakRate.note) {
    L.push(`【注意】${leakRate.note}。`);
    L.push('');
  }
  if (unclassifiedLeaks) {
    L.push(`【注意】${unclassifiedLeaks} 处认定泄漏点无法识别静/动密封（密封类型与组件类型均无法推定），未计入任一泄漏率分子，须补「密封类型」列后重算。`);
    L.push('');
  }
  L.push('**两类来源分别统计，不混算：**');
  L.push('');
  L.push(C.mdTable(['来源', '记录数', '认定泄漏', '判定依据'], [
    ['仪器检测（有检测值）', counts.instrument, counts.instrumentLeaks, `检测值 ≥ 介质对应阈值（气体/轻液 ${thVoc}、重液 ${thLiquid} μmol/mol）`],
    ['现场可见泄漏（无检测值）', counts.visible, counts.visibleLeaks, '滴漏或成股流出即认定；渗漏列为观察项，不折算浓度'],
    ['未判定（无有效检测值且形态不明，含不可达点未检测）', counts.undetermined, '—', '**未按 0 计为不泄漏**，须补测'],
  ]));

  L.push('## 二、本期新增漏点');
  L.push('');
  L.push(ledgerProvided ? '_与历史台账比对后本期首次出现的漏点。需安排维修的，由车间设备员在 SAP PM 提维修通知单（工单由计划员/维修单位创建）。_' : '_未提供历史漏点台账（--ledger），本期认定的漏点全部按新增列出。需安排维修的，由车间设备员在 SAP PM 提维修通知单。_');
  L.push('');
  L.push(C.mdTable(['密封点编号', '位号', '组件类型', '静/动', '介质状态', '来源', '检测值(μmol/mol)', '泄漏形态', '认定依据', '检测时间', '首次修复期限', '最终修复期限', '责任人'],
    newLeaks.map((x) => [x.no, x.tag || '—', x.comp || '—', x.sealTypeCn, x.mediumCn, x.sourceCn,
      x.value === null ? '—' : x.value, x.rawVis || '—', x.leakBasis, x.foundDate || '—',
      x.firstDue || '—（检测时间缺失）', x.finalDue || '—（检测时间缺失）', x.owner || '—'])));

  L.push('## 三、超期未修清单');
  L.push('');
  L.push(`_已认定泄漏、截至 ${date} 超出首次修复（${repairDays} 天）或最终修复（${finalDays} 天）时限仍未消漏、且未经批准延迟修复的密封点。_`);
  L.push('');
  L.push(C.mdTable(['密封点编号', '位号', '组件类型', '静/动', '介质状态', '来源', '检测值(μmol/mol)', '检测时间', '超期类型', '超期天数', '状态', '责任人'],
    overdue.map((x) => [x.no, x.tag || '—', x.comp || '—', x.sealTypeCn, x.mediumCn, x.sourceCn,
      x.value === null ? '—' : x.value, x.foundDate || '—',
      x.overdueOf === 'final' ? `最终修复超期（期限 ${x.finalDue}）` : `首次修复超期（期限 ${x.firstDue}）`,
      x.finalOverdueDays !== null ? x.finalOverdueDays : x.firstOverdueDays,
      x.rawStatus || '—', x.owner || '—'])));

  L.push('## 四、未修复（期限内）');
  L.push('');
  L.push(C.mdTable(['密封点编号', '位号', '组件类型', '静/动', '来源', '检测时间', '首次修复期限', '最终修复期限', '首次修复日期', '状态', '责任人'],
    open.map((x) => [x.no, x.tag || '—', x.comp || '—', x.sealTypeCn, x.sourceCn, x.foundDate || '—',
      x.firstDue || '—', x.finalDue || '—', x.firstFix || '—', x.rawStatus || '—', x.owner || '—'])));

  L.push('## 五、延迟修复（经批准）');
  L.push('');
  L.push('_状态为「延迟修复」且填有延迟修复批准日期的漏点，按厂内 LDAR 管理要求登记、不计超期，须在批准的停工或检修窗口内完成修复并复测。状态为延迟修复但**无批准日期**的，列入「六、未判定清单」。_');
  L.push('');
  L.push(C.mdTable(['密封点编号', '位号', '组件类型', '静/动', '来源', '检测时间', '原最终修复期限', '延迟修复批准日期', '批准人', '状态', '责任人', '备注'],
    delayed.map((x) => [x.no, x.tag || '—', x.comp || '—', x.sealTypeCn, x.sourceCn, x.foundDate || '—',
      x.finalDue || '—', x.delayApproval, x.delayApprover || '—', x.rawStatus || '—', x.owner || '—', x.note || '—'])));

  L.push('## 六、未判定清单');
  L.push('');
  L.push('_检测值为空或无法解析、介质状态无法归类、泄漏形态不明、不可达点未检测、修复状态无法识别、延迟修复无批准日期的记录。**一律未按 0 计为不泄漏，也未按泄漏认定或按超期处理**，须补测或补录后重新判定。_');
  L.push('');
  L.push(C.mdTable(['密封点编号', '位号', '组件类型', '原始检测值', '原始介质/状态', '原始泄漏形态', '原始状态', '缺哪个字段 / 未判定原因', '出处'],
    undetermined.map((x) => [x.no, x.tag || '—', x.comp || '—', x.rawValue || '（空）',
      `${x.rawMedium || '（空）'} / ${x.rawState || '（空）'}`, x.rawVis || '（空）', x.rawStatus || '（空）', x.undetReason,
      `${x.sheet} 第${x.row}行`])));

  L.push('## 七、本期修复闭环');
  L.push('');
  L.push('_已完成最终修复并填写最终修复日期的漏点。状态填「已修复」但无最终修复日期的，仍列在「四、未修复」中，不计入闭环。_');
  L.push('');
  L.push(C.mdTable(['密封点编号', '位号', '组件类型', '静/动', '来源', '检测时间', '首次修复日期', '最终修复日期', '复测日期', '复测值(μmol/mol)', '修复用时(天)', '是否超时限修复'],
    repaired.map((x) => [x.no, x.tag || '—', x.comp || '—', x.sealTypeCn, x.sourceCn, x.foundDate || '—',
      x.firstFix || '—', x.finalFix, x.retestDate || '—', x.retest === null ? '—' : x.retest,
      (x.foundDate && x.finalFix) ? C.diffDays(x.finalFix, x.foundDate) : '—',
      x.lateDays ? `是，超出最终修复时限 ${x.lateDays} 天` : '否'])));

  L.push('## 八、编号重复与数据提示');
  L.push('');
  L.push('_密封点编号重复时，脚本**两条均保留并各自判定，未自动合并**，须核实是否为同一密封点。_');
  L.push('');
  L.push(C.mdTable(['密封点编号', '位号', '本行', '与之重复的行', '检测值', '状态', '当前归类'],
    items.filter((x) => x.dupOf).map((x) => [x.no, x.tag || '—', `第${x.row}行`, `第${x.dupOf}行`,
      x.value === null ? '—' : x.value, x.rawStatus || '—', BUCKET_CN[x.bucket]])));

  L.push('## 九、泄漏管理情况说明');
  L.push('');
  L.push('<!-- ANALYSIS_START -->');
  L.push('（由模型依据 references/ldar-rules.md 口径撰写 200~400 字，结构：总体情况 → 新增漏点 → 超期未修与延迟修复 → 修复闭环与泄漏率 → 下一步安排。漏点数量、超期天数、泄漏率一律引用 leaks.json；交付对象为车间设备主任 / 公司设备管理部门。）');
  L.push('<!-- ANALYSIS_END -->');
  L.push('');
  if (warnings.length) {
    L.push('## 附：数据提示');
    L.push('');
    for (const w of warnings) L.push(`- ${w}`);
    L.push('');
  }
  fs.writeFileSync(path.join(outDir, 'leak-report.md'), L.join('\n'), 'utf8');

  C.emitOk(outDir, { ok: true, out: outDir, date, workshop: a.workshop, counts, metrics: { repairRate, avgRepairDays, leakRate, thresholds: metrics.thresholds, limits: metrics.limits, rulesSource }, warnings });
}

/** sheet 名匹配并返回名字（common.pickSheet 只返回内容） */
function pickSheetName(book, ...names) {
  const norm = (s) => String(s).replace(/[\s表]/g, '');
  const keys = Object.keys(book);
  for (const n of names) {
    const target = norm(n);
    let k = keys.find((x) => norm(x) === target);
    if (k) return k;
    k = keys.find((x) => norm(x).includes(target) || target.includes(norm(x)));
    if (k) return k;
  }
  return null;
}

const BUCKET_CN = {
  overdue: '超期未修', open: '未修复', delayed: '延迟修复（经批准）', repaired: '已修复闭环',
  undetermined: '未判定', noLeak: '未认定泄漏',
};

/** 合成全量台账：历史条目 + 本期条目；本期同编号的记录覆盖该编号的历史状态，未在本期出现的历史条目原样保留 */
function buildLedger(items, history, date) {
  const rows = [];
  const currentNos = new Set(items.map((x) => x.no));
  const dstr = (v) => C.normDate(v) || '';
  for (const [no, list] of history) {
    if (currentNos.has(no)) continue;
    for (const h of list) {
      rows.push({
        '密封点编号': no, '位号': C.str(h['位号']), '设备编号': C.str(h['设备编号']), '装置': C.str(h['装置']),
        '组件类型': C.str(h['组件类型']), '组件子类型': C.str(h['组件子类型']), '密封类型': C.str(h['密封类型']),
        '介质': C.str(h['介质']), '介质状态': C.str(h['介质状态']), '检测方法': C.str(h['检测方法']),
        '检测值': C.str(h['检测值']), '泄漏形态': C.str(h['泄漏形态']), '不可达点': C.str(h['不可达点']),
        '认定结果': '历史台账记录（本期未复测）', '认定依据': '沿用历史台账，本期无新检测记录',
        '检测时间': C.normDate(h['检测时间']) || C.str(h['检测时间']), '发现人': C.str(h['发现人']), '责任人': C.str(h['责任人']),
        '状态': C.str(h['状态']), '首次修复日期': dstr(h['首次修复日期']), '最终修复日期': dstr(h['最终修复日期']),
        '复测日期': dstr(h['复测日期']), '复测值': C.str(h['复测值']),
        '延迟修复批准日期': dstr(h['延迟修复批准日期']), '延迟修复批准人': C.str(h['延迟修复批准人']),
        '首次修复期限': '', '最终修复期限': '', '超期天数': '',
        '当前归类': '历史遗留（本期未复测）', '首次登记日期': dstr(h['检测时间']),
        '来源': '历史台账', '备注': C.str(h['备注']),
      });
    }
  }
  for (const x of items) {
    rows.push({
      '密封点编号': x.no, '位号': x.tag, '设备编号': x.equipNo, '装置': x.unit,
      '组件类型': x.comp, '组件子类型': x.subComp, '密封类型': x.sealTypeCn,
      '介质': x.rawMedium, '介质状态': x.rawState, '检测方法': x.method,
      '检测值': x.value === null ? '' : x.value, '泄漏形态': x.rawVis, '不可达点': x.unreachable === null ? x.rawUnreach : (x.unreachable ? '是' : '否'),
      '认定结果': x.isLeak === true ? '认定泄漏' : x.isLeak === false ? '未认定泄漏' : '未判定',
      '认定依据': x.leakBasis || x.undetReason || '',
      '检测时间': x.foundDate || '', '发现人': x.finder, '责任人': x.owner,
      '状态': x.rawStatus, '首次修复日期': x.firstFix || '', '最终修复日期': x.finalFix || '',
      '复测日期': x.retestDate || '', '复测值': x.retest === null ? '' : x.retest,
      '延迟修复批准日期': x.delayApproval || '', '延迟修复批准人': x.delayApprover,
      '首次修复期限': x.firstDue || '', '最终修复期限': x.finalDue || '',
      '超期天数': x.finalOverdueDays !== null ? x.finalOverdueDays : (x.firstOverdueDays !== null ? x.firstOverdueDays : ''),
      '当前归类': BUCKET_CN[x.bucket], '首次登记日期': x.firstSeen || '',
      '来源': x.isNew ? '本期新增' : '历史续跟踪', '备注': x.note,
    });
  }
  return rows;
}

function slim(x) {
  return {
    no: x.no, tag: x.tag, equipNo: x.equipNo, unit: x.unit, comp: x.comp, subComp: x.subComp,
    sealType: x.sealType, sealTypeCn: x.sealTypeCn, sealBasis: x.sealBasis, rawSealType: x.rawSealType,
    medium: x.medium, mediumCn: x.mediumCn, rawMedium: x.rawMedium, rawState: x.rawState,
    method: x.method,
    value: x.value, rawValue: x.rawValue, bg: x.bg, threshold: x.threshold,
    visible: x.visible, visibleCn: x.visibleCn, rawVis: x.rawVis,
    unreachable: x.unreachable,
    source: x.source, sourceCn: x.sourceCn, isLeak: x.isLeak, leakBasis: x.leakBasis,
    foundDate: x.foundDate, finder: x.finder, owner: x.owner,
    status: x.status, statusCn: x.statusCn, rawStatus: x.rawStatus,
    firstFix: x.firstFix, finalFix: x.finalFix, retestDate: x.retestDate, retest: x.retest,
    delayApproval: x.delayApproval, delayApprover: x.delayApprover,
    firstDue: x.firstDue, finalDue: x.finalDue,
    firstOverdueDays: x.firstOverdueDays, finalOverdueDays: x.finalOverdueDays,
    overdueOf: x.overdueOf, lateDays: x.lateDays,
    isNew: x.isNew, firstSeen: x.firstSeen, dupOf: x.dupOf,
    bucket: x.bucket, bucketCn: BUCKET_CN[x.bucket],
    undetReason: x.undetReason || null, note: x.note,
    sheet: x.sheet, row: x.row,
  };
}
function slimUndet(x) { return { ...slim(x), reason: x.undetReason }; }

try { main(); } catch (e) { C.fail(e, warnings); }
