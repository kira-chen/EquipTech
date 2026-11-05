#!/usr/bin/env node
'use strict';
/**
 * 隐患整改闭环跟踪脚本（仅 Node.js 内置模块）
 * 用法：node "<技能目录>/scripts/hazard.js" --input <隐患台账xlsx> --workshop "常减压车间" --date 2026-09-21 [--out <dir>]
 *       [--from <起始日期>] [--rules <厂内口径xlsx：整改时限 + 等级映射>] [--level <重大|一般>] [--owner <责任人>] [--prev <上期 hazard.json>]
 * 产出：<out>/hazard.json、<out>/hazard.md、<out>/督办清单.md、<out>/summary.json；末行打印 JSON 摘要
 *
 * 硬口径（不得放宽）：
 *   - 整改状态「已整改」但无验收记录 → unverified，绝不计入已闭环
 *   - 等级缺失 / 无法归类导致时限无法确定 → undetermined，绝不按最宽松时限处理
 *   - 等级只认「重大 / 一般」字样；「一级/二级/A 级/B 级/C 级」在多数厂是管理层级（公司级/厂级/车间级）而非严重度，
 *     不直接映射，→ undetermined；厂内确有映射时用 --rules 的「等级映射」表声明
 *   - 一般隐患无统一整改天数（《中国石化安全隐患管理规定》），期限以整改方案/台账为准；台账无期限 → undetermined
 *   - 隐患「五定」（定整改方案、定资金、定责任人、定期限、定应急措施）不全的未闭环项单列一节
 *   - 重大隐患无论状态如何，都在报告开头醒目提示并单独成节
 *   - 闭环率分母为 0 时输出 null（显示「—」），绝不写 0%
 */
const fs = require('fs');
const path = require('path');
const { readXlsx, readCsvDir } = require('./lib/xlsx-lite');
const C = require('./lib/common');

const warnings = [];
const VALUE_OPTS = ['input', 'workshop', 'date', 'out', 'from', 'rules', 'level', 'owner', 'prev'];
const FLAG_OPTS = ['help'];

// 局部别名优先，再合并中石化常用系统导出列名（C.SYSTEM_ALIASES）。
// 注意：本技能的「隐患编号」不是设备编号；共享表的「设备编号」键未被本技能读取，不会误配。
const ALIASES = C.mergeAliases({
  '隐患编号': ['隐患编号', '编号', '序号', '隐患号', '隐患ID', 'ID', 'id'],
  '隐患描述': ['隐患描述', '描述', '隐患内容', '隐患情况', '问题描述', '内容'],
  '等级': ['等级', '隐患等级', '级别', '隐患级别', '分级'],
  '来源': ['来源', '隐患来源', '发现方式', '来源方式', '排查方式', '检查类型', '检查来源'],
  '发现日期': ['发现日期', '发现时间', '排查日期', '登记日期', '上报日期', '检查日期'],
  '责任人': ['责任人', '整改责任人', '负责人', '责任者'],
  // 「车间」不再作责任单位别名：真正的车间列归「车间」做车间范围核对；台账没有责任单位列时，责任单位取车间列的值（见读取处）
  '责任单位': ['责任单位', '责任部门', '整改单位', '单位', '部门', '属地单位'],
  '要求整改期限': ['要求整改期限', '整改期限', '要求完成时间', '计划完成时间', '整改完成期限', '期限', '整改时限'],
  '整改措施': ['整改措施', '措施', '整改方案', '整改内容'],
  '整改资金': ['整改资金', '资金', '整改费用', '资金落实', '经费', '预算', '资金来源'],
  '应急措施': ['应急措施', '应急管控措施', '应急预案', '临时措施', '管控措施', '临时管控措施'],
  '整改状态': ['整改状态', '状态', '整改情况', '完成情况', '进度'],
  '验收情况': ['验收情况', '验收结论', '验收结果', '复查情况', '是否验收'],
  '验收人': ['验收人', '验收负责人', '复查人', '确认人'],
  '验收日期': ['验收日期', '验收时间', '复查日期', '销号日期'],
  '整改完成日期': ['整改完成日期', '整改完成时间', '实际完成时间', '实际完成日期', '完成日期'],
  // --rules「整改时限」表
  '等级名称': ['等级名称', '等级', '隐患等级', '级别'],
  '时限天数': ['时限天数', '整改时限', '时限', '天数', '整改天数', '要求天数'],
  // --rules「等级映射」表
  '原始等级': ['原始等级', '厂内等级', '台账等级', '等级写法', '原等级'],
  '归类': ['归类', '对应等级', '映射为', '严重度', '统一等级'],
});
// 车间范围核对（D007）：「车间」只认真正的车间列（车间/所属车间/属地车间/运行部及其后加「名称」），共享别名里的维护工厂、属地单位、使用单位、作业部不占用车间字段；属地单位仍归责任单位
ALIASES['车间'] = [...C.WORKSHOP_COLS, ...C.WORKSHOP_COLS.map((c) => c + '名称')];

// ---- 等级归一：只认「重大 / 一般」字样。「一级/二级/三级/A 级/B 级/C 级」在多数厂是管理层级
//      （公司级/厂级/车间级），不是严重度，不直接映射 → unknown（进 undetermined）；
//      厂内确有映射时由 --rules「等级映射」表声明（levelMap），脚本绝不猜。
const LEVEL_MAJOR = ['重大', '重大隐患', '重大级', 'major'];
const LEVEL_GENERAL = ['一般', '一般隐患', '普通', 'general'];
const LEVEL_TIER_HINT = /^((一|二|三|四|[1-4]|[ⅠⅡⅢⅣ]|[ABCDＡＢＣＤ])(级|类)?|(公司|集团|分厂|厂|车间|班组|部门)级)$/i;   // 疑似管理层级写法
let levelMap = {};          // 原始等级（去空白）→ 'major' | 'general'，由 --rules 填充
function classifyLevel(v) {
  const s = C.str(v).replace(/\s/g, '');
  if (s === '' || s === '—' || s === '-' || s === '/') return null;
  if (levelMap[s]) return levelMap[s];
  const up = s.toUpperCase();
  if (LEVEL_MAJOR.some((k) => up.includes(k.toUpperCase()))) return 'major';
  if (LEVEL_GENERAL.some((k) => up.includes(k.toUpperCase()))) return 'general';
  return 'unknown';   // 有填写但无法归类（含 一级/A 级 等层级写法），进 undetermined，不按一般处理
}
/** 五定字段是否未落实：空、或「—」「/」「无」「待定」「未落实」等占位写法 */
const FIX_BLANK = /^(—+|-+|\/|／|无|暂无|待定|未定|未落实|待落实)$/;
function isBlankFix(v) { const s = C.str(v).replace(/\s/g, ''); return s === '' || FIX_BLANK.test(s); }
function isTierLike(v) { return LEVEL_TIER_HINT.test(C.str(v).replace(/\s/g, '')); }
const LEVEL_CN = { major: '重大隐患', general: '一般隐患', unknown: '等级无法识别', null: '等级缺失' };

// ---- 整改状态归一
const ST_DONE = ['已整改', '已完成', '整改完毕', '已闭环', '已销号', '完成', '整改完成', '已处理'];
const ST_DOING = ['整改中', '进行中', '实施中', '在改', '部分完成', '整改进行', '处理中'];
const ST_NONE = ['未整改', '未开始', '待整改', '未处理', '未实施'];
// 以完成词开头的（已整改未销号 / 已完成整改，未闭环）按已整改，未销号、未验收交给验收判定
const ST_DONE_HEAD = /^(已整改|已完成|整改完毕|整改完成|已处理|已闭环|已销号)/;
// 否定写法（整改未完成 / 尚未整改完 / 没处理）先于完成态判定，否则会因含「完成」「整改」被当成已整改；
// 「不」只认紧贴动词（不整改），「不符合项整改完成」「不需整改」不算否定
const ST_NEG = /(未|没|没有|尚未|暂未|还未|还没)[^，。；、,;已]{0,3}(整改|完成|处理|闭环|销号)|不(整改|完成|处理)/;
function classifyStatus(v) {
  const s = C.str(v).replace(/\s/g, '');
  if (s === '' || s === '—' || s === '-' || s === '/') return null;
  if (ST_DONE_HEAD.test(s)) return 'done';
  if (ST_NEG.test(s)) return 'none';
  if (ST_DOING.some((k) => s.includes(k))) return 'doing';
  if (ST_DONE.some((k) => s.includes(k))) return 'done';
  if (ST_NONE.some((k) => s.includes(k))) return 'none';
  return 'unknown';
}
const STATUS_CN = { done: '已整改', doing: '整改中', none: '未整改', unknown: '状态无法识别', null: '状态未填' };

// ---- 验收归一：明确「未验收/不合格」→ false；明确「已验收/合格」→ true；空 → null
const ACC_YES = ['已验收', '验收合格', '合格', '通过', '验收通过', '符合', '是', '已销号', '已确认'];
const ACC_NO = ['未验收', '不合格', '未通过', '否', '待验收', '未复查'];
function classifyAccept(v) {
  const s = C.str(v).replace(/\s/g, '');
  if (s === '' || s === '—' || s === '-' || s === '/') return null;
  if (ACC_NO.some((k) => s.includes(k))) return false;
  if (ACC_YES.some((k) => s.includes(k))) return true;
  return null;   // 无法归类：按无验收记录处理（就严），并 warning
}

// ---- 默认整改时限口径（references/hazard-rules.md，非厂内正式口径，--rules 可覆盖）
const DEFAULT_RULES = {
  major: null,       // 重大隐患按整改方案期限；台账无期限时标 undetermined
  general: null,     // 一般隐患：《中国石化安全隐患管理规定》无统一天数，期限以整改方案/台账为准；台账无期限时标 undetermined，--rules 可给厂内天数
};
const DUE_SOON_DAYS = 7;   // 距期限 ≤7 天且未整改 → 临期

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
  let from = null;
  if (a.from) {
    from = C.normDate(a.from);
    if (!from) throw new Error(`--from 「${a.from}」不是有效日期，应为 YYYY-MM-DD`);
    if (C.diffDays(from, date) > 0) throw new Error(`--from ${from} 晚于 --date ${date}`);
  }
  if (!fs.existsSync(a.input)) throw new Error(`输入不存在: ${a.input}`);
  const outDir = a.out || path.join(path.dirname(a.input), 'hct-out');

  // ---- 时限口径：默认 + --rules 覆盖
  const rules = { major: DEFAULT_RULES.major, general: DEFAULT_RULES.general };
  let rulesSource = '默认口径（references/hazard-rules.md，非厂内正式口径：无统一天数，期限以整改方案/台账为准）';
  if (a.rules) {
    if (!fs.existsSync(a.rules)) throw new Error(`时限口径文件不存在: ${a.rules}`);
    let rb;
    try { rb = loadBook(a.rules); } catch (e) { throw new Error(`时限口径文件读取失败 ${a.rules}: ${e.message}`); }
    const rr = C.pickSheet(rb, '整改时限', '时限口径', '时限');
    const rm = C.pickSheet(rb, '等级映射', '等级对照', '隐患等级映射');
    if (!rr && !rm) warnings.push(`厂内口径文件「${path.basename(a.rules)}」中未找到「整改时限」或「等级映射」工作表，仍按默认口径`);
    let hit = 0;
    if (rm) {
      const recs = C.toRecords(rm, ['原始等级', '归类'], '等级映射', [], warnings, ALIASES);
      for (const r of recs) {
        const raw = C.str(r['原始等级']).replace(/\s/g, '');
        const to = C.str(r['归类']).replace(/\s/g, '');
        if (!raw) continue;
        const lv = /重大/.test(to) ? 'major' : /一般/.test(to) ? 'general' : null;
        if (!lv) { warnings.push(`工作表「等级映射」第${r._row}行 归类「${to}」不是 重大/一般，已忽略`); continue; }
        levelMap[raw] = lv; hit++;
      }
      if (Object.keys(levelMap).length) rulesSource = `厂内口径（${path.basename(a.rules)}）`;
    }
    if (rr) {
      const recs = C.toRecords(rr, ['等级名称', '时限天数'], '整改时限', [], warnings, ALIASES);
      for (const r of recs) {
        const lv = classifyLevel(r['等级名称']);
        const d = C.parsePeriod(r['时限天数']);
        if (lv !== 'major' && lv !== 'general') { warnings.push(`工作表「整改时限」第${r._row}行 等级「${C.str(r['等级名称'])}」无法归类为重大/一般，已忽略`); continue; }
        if (d === null) { warnings.push(`工作表「整改时限」第${r._row}行 时限「${C.str(r['时限天数'])}」无法解析，已忽略`); continue; }
        rules[lv] = d; hit++;
      }
      if (hit) rulesSource = `厂内口径（${path.basename(a.rules)}）`;
    }
  }

  // ---- 读取隐患台账
  let book;
  try { book = loadBook(a.input); } catch (e) { throw new Error(`读取失败 ${a.input}: ${e.message}`); }
  const rows = C.pickSheet(book, '隐患台账', '隐患排查治理台账', '隐患清单', '隐患');
  if (!rows) throw new Error('未在输入中找到「隐患台账」工作表');
  const allRecs = C.toRecords(rows, ['隐患编号', '隐患描述', '整改状态'], '隐患台账',
    ['等级', '来源', '发现日期', '责任人', '责任单位', '要求整改期限', '整改措施', '整改资金', '应急措施', '验收情况', '验收人', '验收日期', '整改完成日期', '车间'],
    warnings, ALIASES);
  // 台账只有车间列、没有责任单位类列时，责任单位沿用车间列的值（与改动前「车间」作责任单位别名的结果一致）
  const unitFromWorkshop = !allRecs.hasCol('责任单位') && allRecs.hasCol('车间');
  if (unitFromWorkshop) for (const r of allRecs) r['责任单位'] = r['车间'];
  // 车间范围核对（D007）：按「车间」列核对，责任单位/属地单位不核对；有本车间行时剔除其他车间的行，列全不一致时不筛并【注意】提示
  const wsLedger = C.workshopScope(allRecs, a.workshop, '隐患台账', warnings);
  const scopes = [wsLedger.scope];
  const wsNote = C.workshopScopeNote(scopes, a.workshop);
  const recs = wsLedger.records;
  const FIVE_COLS = { '整改措施': '整改方案', '整改资金': '资金', '责任人': '责任人', '要求整改期限': '期限', '应急措施': '应急措施' };
  for (const c of Object.keys(FIVE_COLS)) if (!recs.hasCol(c)) warnings.push(`工作表「隐患台账」无「${c}」列，五定核对中「定${FIVE_COLS[c]}」按未落实处理，请补列或在台账中补填`);

  // ---- 逐条判定
  const items = [];
  const seenNo = new Map();
  let duplicateNo = 0;
  for (const r of recs) {
    const no = C.str(r['隐患编号']);
    const desc = C.str(r['隐患描述']);
    if (!no && !desc) { warnings.push(`工作表「隐患台账」第${r._row}行 隐患编号与描述均为空，已跳过`); continue; }
    if (!no) warnings.push(`工作表「隐患台账」第${r._row}行 隐患编号为空，按描述跟踪`);
    if (no) {
      if (seenNo.has(no)) {
        duplicateNo++;
        warnings.push(`工作表「隐患台账」第${r._row}行 隐患编号「${no}」与第${seenNo.get(no)}行重复，两条均保留并单独跟踪`);
      } else seenNo.set(no, r._row);
    }

    const rawLevel = C.str(r['等级']);
    const level = classifyLevel(r['等级']);
    if (level === 'unknown') {
      if (isTierLike(rawLevel)) warnings.push(`工作表「隐患台账」第${r._row}行 隐患等级「${rawLevel}」疑似管理层级（公司级/厂级/车间级）写法而非严重度，未直接映射为重大/一般，按未判定处理；厂内确有映射请用 --rules「等级映射」表声明`);
      else warnings.push(`工作表「隐患台账」第${r._row}行 隐患等级「${rawLevel}」无法归类为重大/一般，按未判定处理`);
    }

    const found = C.normDate(r['发现日期']);
    if (r['发现日期'] && !found) warnings.push(`工作表「隐患台账」第${r._row}行 发现日期「${C.str(r['发现日期'])}」无法解析`);
    const deadlineRaw = C.normDate(r['要求整改期限']);
    if (r['要求整改期限'] && !deadlineRaw) warnings.push(`工作表「隐患台账」第${r._row}行 要求整改期限「${C.str(r['要求整改期限'])}」无法解析`);

    const rawStatus = C.str(r['整改状态']);
    const status = classifyStatus(r['整改状态']);
    if (status === 'unknown') warnings.push(`工作表「隐患台账」第${r._row}行 整改状态「${rawStatus}」无法归类，按未判定处理`);

    const rawAccept = C.str(r['验收情况']);
    const accepted = classifyAccept(r['验收情况']);
    if (rawAccept && accepted === null) warnings.push(`工作表「隐患台账」第${r._row}行 验收情况「${rawAccept}」无法归类，按无验收记录处理`);
    const acceptor = C.str(r['验收人']);
    const acceptDate = C.normDate(r['验收日期']);
    if (r['验收日期'] && !acceptDate) warnings.push(`工作表「隐患台账」第${r._row}行 验收日期「${C.str(r['验收日期'])}」无法解析`);
    const doneDate = C.normDate(r['整改完成日期']);
    // 有验收记录 = 验收情况判为合格、或填了验收人/验收日期；
    // 但验收情况明确为「不合格/未通过/待验收」等否定写法时，即使填了验收人/日期也不算验收通过（就严）
    const hasAcceptRecord = accepted === true || (accepted !== false && (!!acceptor || !!acceptDate));

    // ---- 期限推定：台账期限优先；无期限时按等级 + 发现日期推
    let deadline = deadlineRaw, deadlineBasis = null, undetReason = null;
    if (deadline) deadlineBasis = '台账「要求整改期限」';
    else if (level === 'major') {
      // 重大隐患按整改方案期限；台账无期限 → 无法确定
      undetReason = '重大隐患未填写要求整改期限，整改方案期限未知';
    } else if (level === 'general') {
      if (rules.general === null) undetReason = '一般隐患无统一整改天数，台账未填要求整改期限，整改方案期限未知';
      else if (!found) undetReason = '缺少发现日期，无法按时限口径推算期限';
      else { deadline = C.addDays(found, rules.general); deadlineBasis = `发现日期 + ${rules.general} 天（${rulesSource}）`; }
    } else {
      undetReason = level === null ? '隐患等级缺失，整改时限无法确定' : `隐患等级「${rawLevel}」无法归类，整改时限无法确定`;
    }

    const overdueDays = deadline ? C.diffDays(date, deadline) : null;

    const it = {
      no: no || `（无编号·第${r._row}行）`, desc, rawLevel, level, levelCn: LEVEL_CN[String(level)],
      source: C.str(r['来源']), foundDate: found,
      owner: C.str(r['责任人']), unit: C.str(r['责任单位']),
      deadline, deadlineBasis, measure: C.str(r['整改措施']),
      fund: C.str(r['整改资金']), emergency: C.str(r['应急措施']),
      rawStatus, status, statusCn: STATUS_CN[String(status)],
      rawAccept, accepted, acceptor, acceptDate, doneDate, hasAcceptRecord,
      overdueDays: overdueDays !== null && overdueDays > 0 ? overdueDays : null,
      daysToDeadline: overdueDays !== null ? -overdueDays : null,
      row: r._row, sheet: '隐患台账',
      bucket: null, undetReason,
    };

    // ---- 状态与验收矛盾：状态非「已整改」但有验收记录 → warning 单列
    it.conflict = null;
    if (it.hasAcceptRecord && (status === 'none' || status === 'doing')) {
      it.conflict = `整改状态为「${rawStatus}」，但已填写验收记录（${[rawAccept && `验收情况:${rawAccept}`, acceptor && `验收人:${acceptor}`, acceptDate && `验收日期:${acceptDate}`].filter(Boolean).join('，')}）`;
      warnings.push(`工作表「隐患台账」第${r._row}行 隐患「${it.no}」状态与验收矛盾：${it.conflict}`);
    }

    // ---- 归桶：闭环判定最严
    if (status === 'done' && hasAcceptRecord) it.bucket = 'closed';
    else if (status === 'done') {
      it.bucket = 'unverified';
      it.unverifiedReason = accepted === false
        ? `整改状态为「已整改」但验收情况为「${rawAccept}」，无验收记录（验收未通过或尚未验收）`
        : '整改状态为「已整改」但无验收记录（验收情况、验收人、验收日期均为空或未通过）';
    }
    else if (status === null || status === 'unknown') { it.bucket = 'undetermined'; it.undetReason = it.undetReason || (status === null ? '整改状态未填，无法判定闭环情况' : `整改状态「${rawStatus}」无法归类`); }
    else if (undetReason) { it.bucket = 'undetermined'; }                        // 未整改但期限无法确定
    else if (it.overdueDays !== null) it.bucket = 'overdue';
    else if (it.daysToDeadline !== null && it.daysToDeadline <= DUE_SOON_DAYS) it.bucket = 'dueSoon';
    else it.bucket = 'inProgress';

    // 已整改未验收/已闭环的项，若其等级缺失仍需在 undetermined 之外保留判定（闭环判定不依赖等级）
    if (it.bucket === 'undetermined' && !it.undetReason) it.undetReason = undetReason || '判定依据不足';

    // ---- 五定核对（未闭环项）：定整改方案、定资金、定责任人、定期限、定应急措施；缺哪项列哪项，脚本不补
    //      「—」「/」「无」「待定」「未落实」等占位写法按未落实处理（「不需要」是明确结论，算已落实）
    it.fiveFixedMissing = [];
    if (it.bucket !== 'closed') {
      if (isBlankFix(it.measure)) it.fiveFixedMissing.push('整改方案');
      if (isBlankFix(it.fund)) it.fiveFixedMissing.push('资金');
      if (isBlankFix(it.owner)) it.fiveFixedMissing.push('责任人');
      if (!it.deadline) it.fiveFixedMissing.push('期限');
      if (isBlankFix(it.emergency)) it.fiveFixedMissing.push('应急措施');
    }

    items.push(it);
  }

  if (!items.length) throw new Error('「隐患台账」中无有效隐患记录');

  // ---- 统计范围过滤（--from：按发现日期）
  let filtered = items;
  if (from) {
    filtered = items.filter((x) => {
      if (!x.foundDate) { warnings.push(`隐患「${x.no}」（第${x.row}行）发现日期缺失，指定 --from 时仍予保留`); return true; }
      return C.diffDays(x.foundDate, from) >= 0 && C.diffDays(x.foundDate, date) <= 0;
    });
  }
  // ---- 视图过滤（--level / --owner）：仅影响清单展示，不影响重大隐患提示的完整性
  let view = filtered;
  if (a.level) {
    const want = classifyLevel(a.level);
    if (want !== 'major' && want !== 'general') throw new Error(`--level 「${a.level}」无法识别，应为 重大 或 一般`);
    view = view.filter((x) => x.level === want);
  }
  if (a.owner) view = view.filter((x) => x.owner === a.owner || x.owner.includes(a.owner));

  const byBucket = (b) => view.filter((x) => x.bucket === b);
  const overdue = byBucket('overdue').sort((x, y) => (y.overdueDays || 0) - (x.overdueDays || 0));
  const dueSoon = byBucket('dueSoon').sort((x, y) => (x.daysToDeadline || 0) - (y.daysToDeadline || 0));
  const inProgress = byBucket('inProgress');
  const closed = byBucket('closed');
  const unverified = byBucket('unverified');
  const undetermined = byBucket('undetermined');
  const majorHazards = view.filter((x) => x.level === 'major');
  const conflicts = view.filter((x) => x.conflict);
  const fiveFixedIncomplete = view.filter((x) => x.fiveFixedMissing.length)
    .sort((x, y) => (y.level === 'major') - (x.level === 'major') || y.fiveFixedMissing.length - x.fiveFixedMissing.length);

  // ---- 指标
  const total = view.length;
  const closureRate = total > 0 ? C.round((closed.length / total) * 100, 1) : null;   // 分母 0 → null，绝不写 0%
  const durations = closed.map((x) => (x.foundDate && (x.acceptDate || x.doneDate)) ? C.diffDays(x.acceptDate || x.doneDate, x.foundDate) : null)
    .filter((d) => d !== null && d >= 0);
  const avgClosureDays = durations.length ? C.round(durations.reduce((s, d) => s + d, 0) / durations.length, 1) : null;
  const byLevel = {};
  for (const k of ['major', 'general', 'unknown', 'missing']) byLevel[k] = { total: 0, closed: 0, overdue: 0, unverified: 0, undetermined: 0 };
  for (const x of view) {
    const k = x.level === null ? 'missing' : x.level;
    byLevel[k].total++;
    if (x.bucket === 'closed') byLevel[k].closed++;
    if (x.bucket === 'overdue') byLevel[k].overdue++;
    if (x.bucket === 'unverified') byLevel[k].unverified++;
    if (x.bucket === 'undetermined') byLevel[k].undetermined++;
  }
  const byUnit = {};
  for (const x of view) { const u = x.unit || '（未填责任单位）'; byUnit[u] = (byUnit[u] || 0) + 1; }
  const bySource = {};
  for (const x of view) { const u = x.source || '（未填来源）'; bySource[u] = (bySource[u] || 0) + 1; }

  // ---- 上期对比
  let trend = null;
  if (a.prev) {
    if (!fs.existsSync(a.prev)) throw new Error(`上期 hazard.json 不存在: ${a.prev}`);
    let prev;
    try { prev = JSON.parse(fs.readFileSync(a.prev, 'utf8')); } catch (e) { throw new Error(`上期 hazard.json 解析失败: ${e.message}`); }
    const pc = (prev.counts || {});
    const pr = prev.metrics ? prev.metrics.closureRate : null;
    trend = {
      prevDate: prev.meta ? prev.meta.date : null,
      totalDelta: typeof pc.total === 'number' ? total - pc.total : null,
      overdueDelta: typeof pc.overdue === 'number' ? overdue.length - pc.overdue : null,
      closureRateDelta: (typeof pr === 'number' && closureRate !== null) ? C.round(closureRate - pr, 1) : null,
      newItems: (() => {
        const prevNos = new Set((prev.items || []).map((x) => x.no));
        return prevNos.size ? view.filter((x) => !prevNos.has(x.no)).map((x) => x.no) : null;
      })(),
    };
  }

  const counts = {
    total, overdue: overdue.length, dueSoon: dueSoon.length, inProgress: inProgress.length,
    closed: closed.length, unverified: unverified.length, undetermined: undetermined.length,
    major: majorHazards.length, conflicts: conflicts.length, fiveFixedIncomplete: fiveFixedIncomplete.length, duplicateNo,
  };
  const metrics = { closureRate, avgClosureDays, byLevel, byUnit, bySource, dueSoonDays: DUE_SOON_DAYS, rules: { major: rules.major, general: rules.general }, rulesSource };

  // ---- 产出
  C.ensureDir(outDir);
  const hazard = {
    meta: {
      workshop: a.workshop, date, from: from || null, generatedAt: C.localDateTime(),
      input: path.basename(a.input), rulesSource, levelFilter: a.level || null, ownerFilter: a.owner || null,
      workshopScope: scopes,
    },
    counts, metrics,
    overdue: overdue.map(slim), dueSoon: dueSoon.map(slim), inProgress: inProgress.map(slim),
    closed: closed.map(slim), unverified: unverified.map(slim), majorHazards: majorHazards.map(slim),
    undetermined: undetermined.map(slimUndet), conflicts: conflicts.map((x) => ({ ...slim(x), conflict: x.conflict })),
    fiveFixedIncomplete: fiveFixedIncomplete.map((x) => ({ ...slim(x), missing: x.fiveFixedMissing })),
    trend, items: view.map(slim), warnings,
  };
  fs.writeFileSync(path.join(outDir, 'hazard.json'), JSON.stringify(hazard, null, 2), 'utf8');

  // ---- hazard.md
  const L = [];
  L.push(`# ${a.workshop} 隐患整改闭环跟踪（截至 ${date}）`);
  L.push('');
  if (wsNote.alert) { L.push(`> **${wsNote.alert}**`); L.push(''); }
  // 开头醒目提示：脚本直接写入，非占位符
  const alerts = [];
  if (majorHazards.length) {
    const un = majorHazards.filter((x) => x.bucket !== 'closed').length;
    alerts.push(`**存在重大隐患 ${majorHazards.length} 项**（其中未闭环 ${un} 项），详见「二、重大隐患专列」，须按重大隐患管理程序上报分厂/公司安全部门并挂牌督办。`);
  }
  if (overdue.length) {
    alerts.push(`**存在超期未整改隐患 ${overdue.length} 项**，最长超期 ${overdue[0].overdueDays} 天，详见「三、超期未整改清单」。`);
  }
  if (alerts.length) {
    L.push('> 【注意】**重点提示**');
    L.push('>');
    for (const t of alerts) L.push(`> - ${t}`);
    L.push('');
  } else {
    L.push('> 本期无重大隐患，亦无超期未整改项。');
    L.push('');
  }
  L.push(`统计范围：${from ? `${from} 至 ${date}（按发现日期）` : `截至 ${date} 的全部在册隐患`}${a.level ? ` ｜ 等级筛选：${a.level}` : ''}${a.owner ? ` ｜ 责任人筛选：${a.owner}` : ''}`);
  L.push(`时限口径：${rulesSource}（重大隐患：${rules.major === null ? '按整改方案期限' : rules.major + ' 天'}；一般隐患：${rules.general === null ? '无统一天数，以整改方案/台账期限为准' : rules.general + ' 天'}）`);
  L.push(`数据来源：${path.basename(a.input)} ｜ 生成时间：${C.localDateTime()}（北京时间）`);
  if (wsNote.note) L.push(wsNote.note);
  L.push('');
  L.push('**隐患认定、等级与整改验收以安全部门意见为准。** 本材料由脚本汇总、模型成文，仅供设备员复核参考，不替代审批、定性、验收与签字；厂内制度与系统数据为准。');
  L.push('');

  L.push('## 一、总体概览');
  L.push('');
  L.push(C.mdTable(['指标', '数量'], [
    ['隐患总数', counts.total],
    ['重大隐患', counts.major],
    ['超期未整改', counts.overdue],
    ['临期（≤' + DUE_SOON_DAYS + '天）', counts.dueSoon],
    ['整改中（期限内）', counts.inProgress],
    ['已整改已验收（闭环）', counts.closed],
    ['已整改未验收', counts.unverified],
    ['未判定', counts.undetermined],
    ['状态与验收矛盾', counts.conflicts],
    ['五定不全（未闭环项）', counts.fiveFixedIncomplete],
  ]));
  L.push(`闭环率：**${C.pct(closureRate)}**（已整改且已验收 ${counts.closed} / 总数 ${counts.total}）${closureRate === null ? '，统计范围内无隐患，不计算闭环率' : ''}`);
  L.push('');
  L.push(`平均闭环时长：**${avgClosureDays === null ? '—' : avgClosureDays + ' 天'}**${avgClosureDays === null ? '（无可计算时长的闭环项）' : `（基于 ${durations.length} 项可计算的闭环隐患）`}`);
  L.push('');

  L.push('## 二、重大隐患专列');
  L.push('');
  if (!majorHazards.length) {
    L.push('_本期统计范围内无重大隐患。_\n');
  } else {
    L.push(`【注意】**本期重大隐患 ${majorHazards.length} 项，无论整改状态如何均须逐项跟踪到验收销号；未闭环的须上报分厂/公司安全部门并挂牌督办。**`);
    L.push('');
    L.push(C.mdTable(['隐患编号', '隐患描述', '来源', '发现日期', '责任人', '责任单位', '要求整改期限', '整改状态', '当前归类', '超期天数'],
      majorHazards.map((x) => [x.no, x.desc || '—', x.source || '—', x.foundDate || '—', x.owner || '—', x.unit || '—',
        x.deadline || '—（未填方案期限）', x.rawStatus || '—', BUCKET_CN[x.bucket],
        x.bucket === 'overdue' && x.overdueDays !== null ? x.overdueDays : '—'])));
  }

  L.push('## 三、超期未整改清单');
  L.push('');
  L.push(C.mdTable(['隐患编号', '等级', '隐患描述', '责任人', '责任单位', '要求整改期限', '超期天数', '整改状态', '期限依据'],
    overdue.map((x) => [x.no, x.levelCn, x.desc || '—', x.owner || '—', x.unit || '—', x.deadline, x.overdueDays, x.rawStatus || '—', x.deadlineBasis || '—'])));

  L.push('## 四、临期清单');
  L.push('');
  L.push(`_距要求整改期限 ${DUE_SOON_DAYS} 天以内且尚未整改完成的项。_`);
  L.push('');
  L.push(C.mdTable(['隐患编号', '等级', '隐患描述', '责任人', '责任单位', '要求整改期限', '剩余天数', '整改状态'],
    dueSoon.map((x) => [x.no, x.levelCn, x.desc || '—', x.owner || '—', x.unit || '—', x.deadline, x.daysToDeadline, x.rawStatus || '—'])));

  L.push('## 五、已整改未验收');
  L.push('');
  L.push('_整改状态填报为「已整改」但台账无验收记录，**不计入已闭环**，须安排验收销号。_');
  L.push('');
  L.push(C.mdTable(['隐患编号', '等级', '隐患描述', '责任人', '责任单位', '整改措施', '不计闭环的原因'],
    unverified.map((x) => [x.no, x.levelCn, x.desc || '—', x.owner || '—', x.unit || '—', x.measure || '—', x.unverifiedReason])));

  L.push('## 六、未判定项');
  L.push('');
  L.push('_判定所依赖的字段缺失，**未按最宽松时限处理**，须补齐后重新跟踪。_');
  L.push('');
  L.push(C.mdTable(['隐患编号', '原始等级', '隐患描述', '责任人', '整改状态', '缺哪个字段 / 未判定原因', '出处'],
    undetermined.map((x) => [x.no, x.rawLevel || '（空）', x.desc || '—', x.owner || '—', x.rawStatus || '（空）', x.undetReason, `隐患台账 第${x.row}行`])));

  L.push('## 七、状态与验收矛盾');
  L.push('');
  L.push('_整改状态未填报为「已整改」却已有验收记录，须核实以哪一项为准，**脚本未作任何取舍**。_');
  L.push('');
  L.push(C.mdTable(['隐患编号', '等级', '隐患描述', '责任人', '矛盾情况', '出处'],
    conflicts.map((x) => [x.no, x.levelCn, x.desc || '—', x.owner || '—', x.conflict, `隐患台账 第${x.row}行`])));

  L.push('## 八、五定不全');
  L.push('');
  L.push('_未闭环项按「五定」（定整改方案、定资金、定责任人、定期限、定应急措施）逐项核对，缺哪项列哪项；**脚本不补填任何一项**，须由责任单位补齐后更新台账。_');
  L.push('');
  L.push(C.mdTable(['隐患编号', '等级', '隐患描述', '责任人', '当前归类', '五定缺项', '出处'],
    fiveFixedIncomplete.map((x) => [x.no, x.levelCn, x.desc || '—', x.owner || '—', BUCKET_CN[x.bucket], x.fiveFixedMissing.join('、'), `隐患台账 第${x.row}行`])));

  L.push('## 九、闭环指标');
  L.push('');
  L.push('**按等级分布**');
  L.push('');
  L.push(C.mdTable(['等级', '总数', '已闭环', '超期', '已整改未验收', '未判定', '闭环率'],
    ['major', 'general', 'unknown', 'missing'].filter((k) => byLevel[k].total > 0).map((k) => {
      const b = byLevel[k];
      return [{ major: '重大隐患', general: '一般隐患', unknown: '等级无法识别', missing: '等级缺失' }[k],
        b.total, b.closed, b.overdue, b.unverified, b.undetermined,
        b.total > 0 ? C.pct(C.round((b.closed / b.total) * 100, 1)) : '—'];
    })));
  L.push('**按责任单位分布**');
  L.push('');
  L.push(C.mdTable(['责任单位', '隐患数'], Object.entries(byUnit).sort((x, y) => y[1] - x[1]).map(([u, n]) => [u, n])));
  L.push('**按来源分布**');
  L.push('');
  L.push(C.mdTable(['隐患来源', '隐患数'], Object.entries(bySource).sort((x, y) => y[1] - x[1]).map(([u, n]) => [u, n])));
  L.push('**与上期对比**');
  L.push('');
  if (trend === null) L.push('_未提供上期 hazard.json，不做趋势对比。_\n');
  else {
    L.push(C.mdTable(['对比项', '本期', '较上期'], [
      ['隐患总数', counts.total, trend.totalDelta === null ? '—' : (trend.totalDelta >= 0 ? '+' : '') + trend.totalDelta],
      ['超期未整改', counts.overdue, trend.overdueDelta === null ? '—' : (trend.overdueDelta >= 0 ? '+' : '') + trend.overdueDelta],
      ['闭环率', C.pct(closureRate), trend.closureRateDelta === null ? '—' : (trend.closureRateDelta >= 0 ? '+' : '') + trend.closureRateDelta + '个百分点'],
    ]));
  }

  L.push('## 十、隐患整改情况说明');
  L.push('');
  L.push('<!-- ANALYSIS_START -->');
  L.push('（由模型依据 references/hazard-rules.md 口径撰写 250~400 字，结构：总体情况 → 重大隐患（如有）→ 超期未整改项与责任 → 已整改未验收项 → 五定不全项 → 闭环率与趋势 → 督办重点。数量、天数、比率一律引用 hazard.json。）');
  L.push('<!-- ANALYSIS_END -->');
  L.push('');
  if (warnings.length) {
    L.push('## 附：数据提示');
    L.push('');
    for (const w of warnings) L.push(`- ${w}`);
    L.push('');
  }
  fs.writeFileSync(path.join(outDir, 'hazard.md'), L.join('\n'), 'utf8');

  // ---- 督办清单.md（按责任人分组）
  const S = [];
  S.push(`# ${a.workshop} 隐患整改督办清单（截至 ${date}）`);
  S.push('');
  if (wsNote.alert) { S.push(`> **${wsNote.alert}**`); S.push(''); }
  S.push('**隐患认定、等级与整改验收以安全部门意见为准。** 本材料由脚本汇总、模型成文，仅供设备员复核参考，不替代审批、定性、验收与签字；厂内制度与系统数据为准。');
  S.push('');
  if (alerts.length) {
    S.push('> 【注意】**重点提示**');
    S.push('>');
    for (const t of alerts) S.push(`> - ${t}`);
    S.push('');
  }
  // 督办范围：超期 + 临期 + 已整改未验收 + 未判定 + 重大隐患未闭环
  const needPush = [];
  const pushed = new Set();
  const addPush = (x, why) => {
    const k = `${x.no}#${x.row}`;
    if (pushed.has(k)) { const e = needPush.find((y) => `${y.no}#${y.row}` === k); if (e && !e.why.includes(why)) e.why += `；${why}`; return; }
    pushed.add(k); needPush.push({ ...x, why });
  };
  for (const x of overdue) addPush(x, `超期 ${x.overdueDays} 天`);
  for (const x of majorHazards) if (x.bucket !== 'closed') addPush(x, `重大隐患（${BUCKET_CN[x.bucket]}）`);
  for (const x of dueSoon) addPush(x, `临期，剩余 ${x.daysToDeadline} 天`);
  for (const x of unverified) addPush(x, '已整改未验收，须安排验收销号');
  for (const x of undetermined) addPush(x, `未判定：${x.undetReason}`);
  for (const x of conflicts) addPush(x, `状态与验收矛盾，须核实`);
  for (const x of fiveFixedIncomplete) if (x.level === 'major') addPush(x, `重大隐患五定不全（缺：${x.fiveFixedMissing.join('、')}）`);

  S.push(`督办事项合计 **${needPush.length}** 项，按责任人分组如下。未填责任人的条目已单列，须先明确责任人。`);
  S.push('');
  const groups = new Map();
  for (const x of needPush) {
    const k = isBlankFix(x.owner) ? '（未填责任人）' : x.owner;   // 「待定 / 无 / —」等占位写法与空白同组，不当人名
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(x);
  }
  const ordered = [...groups.entries()].sort((x, y) => {
    if (x[0] === '（未填责任人）') return 1;
    if (y[0] === '（未填责任人）') return -1;
    return y[1].length - x[1].length;
  });
  if (!ordered.length) S.push('_本期无需督办事项。_\n');
  for (const [owner, list] of ordered) {
    const majorN = list.filter((x) => x.level === 'major').length;
    S.push(`## ${owner}（${list.length} 项${majorN ? `，含重大隐患 ${majorN} 项` : ''}）`);
    S.push('');
    S.push(C.mdTable(['隐患编号', '等级', '隐患描述', '责任单位', '要求整改期限', '整改状态', '督办事由'],
      list.map((x) => [x.no, x.levelCn, x.desc || '—', x.unit || '—', x.deadline || '—', x.rawStatus || '—', x.why])));
  }
  S.push('---');
  S.push('');
  S.push(`生成时间：${C.localDateTime()}（北京时间） ｜ 时限口径：${rulesSource}`);
  S.push('');
  fs.writeFileSync(path.join(outDir, '督办清单.md'), S.join('\n'), 'utf8');

  C.emitOk(outDir, { ok: true, out: outDir, date, workshop: a.workshop, counts, metrics: { closureRate, avgClosureDays }, warnings });
}

const BUCKET_CN = {
  overdue: '超期未整改', dueSoon: '临期', inProgress: '整改中', closed: '已闭环',
  unverified: '已整改未验收', undetermined: '未判定',
};

function slim(x) {
  return {
    no: x.no, desc: x.desc, level: x.level, levelCn: x.levelCn, rawLevel: x.rawLevel,
    source: x.source, foundDate: x.foundDate, owner: x.owner, unit: x.unit,
    deadline: x.deadline, deadlineBasis: x.deadlineBasis, measure: x.measure,
    fund: x.fund, emergency: x.emergency, fiveFixedMissing: x.fiveFixedMissing,
    status: x.status, statusCn: x.statusCn, rawStatus: x.rawStatus,
    accepted: x.accepted, acceptor: x.acceptor, acceptDate: x.acceptDate, hasAcceptRecord: x.hasAcceptRecord,
    overdueDays: x.overdueDays, daysToDeadline: x.daysToDeadline,
    bucket: x.bucket, bucketCn: BUCKET_CN[x.bucket],
    unverifiedReason: x.unverifiedReason || null, undetReason: x.undetReason || null,
    conflict: x.conflict || null, sheet: x.sheet, row: x.row,
  };
}
function slimUndet(x) { return { ...slim(x), reason: x.undetReason }; }

try { main(); } catch (e) { C.fail(e, warnings); }
