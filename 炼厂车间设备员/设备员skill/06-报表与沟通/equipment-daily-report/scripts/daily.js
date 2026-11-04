#!/usr/bin/env node
'use strict';
/**
 * 车间设备日报生成脚本（仅 Node.js 内置模块；中石化体系炼化厂车间设备员口径）
 * 用法：node scripts/daily.js --input <路径[,路径2]> --workshop "车间" --date YYYY-MM-DD [--out <dir>]
 * 可选：--prev <上一日 daily.json> --shift "<值班>" --plan "<次日计划文本或文件>"
 * 输入可以是：上游技能产出的 JSON（status.json / orders.json / defects.json / leaks.json / hazard.json），
 *             或 xlsx（含「巡检汇总」「特护设备」「缺陷台账」「工单台账」「作业票」「泄漏点」「隐患台账」「异常事件」「检修进度」任一工作表）
 * 产出：<out>/daily.json、daily.md、summary.json
 *
 * 口径（见《中石化口径对照.md》）：
 *  - 设备状态六档：运行 / 备用 / 检修 / 停用 / 异常 / 未判定（不得只分正常/异常）
 *  - 工单与缺陷状态按 SAP 六态归一；"已完成/完工/TECO" 归待验收，单列，不算闭环
 *  - 隐患等级只认 重大隐患 / 一般隐患；"A/B/C 级隐患"多为管理层级，原样展示不映射
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readXlsx, readCsvDir } = require('./lib/xlsx-lite');
const C = require('./lib/common');

const warnings = [];
const num = C.makeNum(warnings);
const VALUE_OPTS = ['input', 'workshop', 'date', 'out', 'prev', 'shift', 'plan'];
const FLAG_OPTS = ['help'];

// 局部别名优先，再合并中石化常用系统（SAP PM/MM、EM、作业许可、智能巡检）导出列名。
// 注意：局部不把「设备编号」作为位号别名——SAP 设备编号是 8 位流水号，不是功能位置/位号。
const ALIASES = C.mergeAliases({
  '位号': ['位号', '设备位号', 'TAG'],
  '设备名称': ['设备名称', '名称'],
  '缺陷描述': ['缺陷描述', '描述', '现象', '问题描述', '内容', '通知单描述', '通知单短文本', '短文本'],
  '等级': ['等级', '缺陷等级', '级别'],
  '状态': ['状态', '处理状态', '当前状态'],
  '发现时间': ['发现时间', '时间', '发现日期', '通知日期', '通知单日期', '报告日期'],
  '工单号': ['工单号', '单号', '工单编号'],
  '要求完成时间': ['要求完成时间', '计划完成时间', '要求完成', '计划完成', '基本结束日期', '要求结束'],
  '责任人': ['责任人', '负责人', '承办人'],
  '事件描述': ['事件描述', '描述', '事件', '内容'],
  '处置措施': ['处置措施', '措施', '处理措施', '处置'],
  '项目名称': ['项目名称', '项目', '检修项目', '名称'],
  '完成比例': ['完成比例', '进度', '完成率', '完成进度'],
  '运行参数': ['运行参数', '参数', '主要参数', '关键参数', '参数趋势', '运行工况'],
  '密封点编号': ['密封点编号', '漏点编号', '泄漏点编号', '密封点号', '漏点号'],
  '隐患描述': ['隐患描述', '隐患内容', '隐患', '问题描述', '描述'],
  '隐患等级': ['隐患等级', '等级', '级别', '隐患级别'],
  '整改期限': ['整改期限', '期限', '整改完成期限', '要求整改完成日期', '要求整改期限', '计划完成', '截止日期'],
  // 隐患台账专用（HSE 平台导出）：整改状态、隐患编号、验收情况 / 验收人 / 验收日期（三列独立读取，别名与 hazard-closure-tracker 同源）
  '整改状态': ['整改状态', '状态', '处理状态', '当前状态'],
  '隐患编号': ['隐患编号', '隐患编码', '隐患号'],
  '验收情况': ['验收情况', '验收结论', '验收结果', '复查情况', '是否验收'],
  '验收人': ['验收人', '验收负责人', '复查人', '确认人'],
  '验收日期': ['验收日期', '验收时间', '复查日期', '销号日期'],
  '作业地点': ['作业地点', '作业区域', '作业位置', '作业部位', '区域'],
});
// 「描述」在 SAP 技术对象导出里是设备描述，但缺陷/隐患/事件表里的「描述」应归内容列；设备名称只认设备描述/名称。
ALIASES['设备名称'] = ALIASES['设备名称'].filter((x) => x !== '描述');

const SIX_STATES = ['运行', '备用', '检修', '停用', '异常', '未判定'];

/**
 * 设备状态六档归一（巡检汇总「状态」列）：
 *  备用/备机/standby → 备用；检修/在修/维修中/大修 → 检修；停用/停运/封存/闲置 → 停用；
 *  其余按 classifyResult：normal → 运行，abnormal → 异常，unknown/空 → 未判定。
 */
function classifyState(v) {
  const s = C.str(v).replace(/\s/g, '');
  if (!s) return '未判定';
  if (/(备用|备机|standby|热备|冷备)/i.test(s) && !/异常/.test(s)) return '备用';
  if (/(检修|在修|维修中|修理中|大修|停修|检修中)/.test(s) && !/异常/.test(s)) return '检修';
  if (/(停用|停运|封存|闲置|长期停|退役|报废)/.test(s) && !/异常/.test(s)) return '停用';
  if (/^(运行|在用|运行中|运转)$/.test(s)) return '运行';
  const c = C.classifyResult(s);
  if (c === 'normal') return '运行';
  if (c === 'abnormal') return '异常';
  return '未判定';
}

/**
 * 闭环判定（口径见《中石化口径对照.md》第四节）：
 *  - 先判否定前缀：未关闭/待闭环/未消缺 → 未闭环
 *  - 再判闭环词：已闭环/已关闭/关闭/CLSD/NOCO/已验收/已消缺 → 已闭环
 *  - "已完成/完工/技术完成/TECO" 归待验收，不算闭环
 */
function isClosed(status) {
  const s = C.str(status);
  if (!s) return false;
  if (/^(未|待|不|非)/.test(s)) return false;
  return C.normSapStatus(s) === '已闭环';
}
const isPendingAccept = (s) => C.normSapStatus(s) === '待验收';
const isCancelled = (s) => C.normSapStatus(s) === '已取消';

// ---- 隐患台账整改状态 / 验收情况词表：与 hazard-closure-tracker scripts/hazard.js 的 ST_DONE / ST_DOING / ST_NONE / ACC_YES / ACC_NO 同源，
//      两边改词表须同步（技能各自独立打包，不跨技能 require）。
const HZ_ST_DONE = ['已整改', '已完成', '整改完毕', '已闭环', '已销号', '完成', '整改完成', '已处理'];
const HZ_ST_DOING = ['整改中', '进行中', '实施中', '在改', '部分完成', '整改进行', '处理中'];
const HZ_ST_NONE = ['未整改', '未开始', '待整改', '未处理', '未实施'];
const HZ_ACC_YES = ['已验收', '验收合格', '合格', '通过', '验收通过', '符合', '是', '已销号', '已确认'];
const HZ_ACC_NO = ['未验收', '不合格', '未通过', '否', '待验收', '未复查'];
const blankCell = (s) => s === '' || s === '—' || s === '-' || s === '/';
// 判定顺序与 hazard.js classifyStatus 完全一致：完成词开头 → 已整改；否定写法 → 未整改；再认整改中、已整改、未整改
const HZ_ST_DONE_HEAD = /^(已整改|已完成|整改完毕|整改完成|已处理|已闭环|已销号)/;
const HZ_ST_NEG = /(未|没|没有|尚未|暂未|还未|还没)[^，。；、,;已]{0,3}(整改|完成|处理|闭环|销号)|不(整改|完成|处理)/;
function hazardStatus(v) {
  const s = C.str(v).replace(/\s/g, '');
  if (blankCell(s)) return null;
  if (HZ_ST_DONE_HEAD.test(s)) return 'done';
  if (HZ_ST_NEG.test(s)) return 'none';
  if (HZ_ST_DOING.some((k) => s.includes(k))) return 'doing';
  if (HZ_ST_DONE.some((k) => s.includes(k))) return 'done';
  if (HZ_ST_NONE.some((k) => s.includes(k))) return 'none';
  return 'unknown';
}
/** 整改状态是否为完成态（与 hazard.js 同口径） */
const hazardDone = (v) => hazardStatus(v) === 'done';
/** 验收情况：明确否定 → false；明确通过 → true；空或无法归类 → null（按无验收记录，就严） */
function hazardAccept(v) {
  const s = C.str(v).replace(/\s/g, '');
  if (blankCell(s)) return null;
  if (HZ_ACC_NO.some((k) => s.includes(k))) return false;
  if (HZ_ACC_YES.some((k) => s.includes(k))) return true;
  return null;
}

/** 隐患等级：只认 重大/一般；其余原样返回并标未映射 */
function hazardLevel(v) {
  const s = C.str(v);
  if (!s) return { level: null, cn: '（未填）' };
  if (/重大/.test(s)) return { level: 'major', cn: '重大隐患' };
  if (/一般/.test(s)) return { level: 'general', cn: '一般隐患' };
  return { level: null, cn: `${s}（未映射，A/B/C 级多为管理层级）` };
}

function loadAny(p) {
  if (!fs.existsSync(p)) throw new Error(`输入不存在: ${p}`);
  const st = fs.statSync(p);
  if (st.isDirectory()) return { kind: 'book', data: readCsvDir(p), name: path.basename(p) };
  if (/\.json$/i.test(p)) {
    let j; try { j = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { throw new Error(`JSON 解析失败 ${p}: ${e.message}`); }
    return { kind: 'json', data: j, name: path.basename(p) };
  }
  return { kind: 'book', data: readXlsx(p), name: path.basename(p) };
}

/** 识别上游 JSON 的类型（按特征字段） */
function detectJson(j) {
  if (!j || typeof j !== 'object') return null;
  if (j.byEquipment && j.abnormal !== undefined) return 'status';       // inspection-data-digest
  if (j.byStatus !== undefined || (j.overdue && j.metrics && j.metrics.closeRate !== undefined && j.counts && j.counts.closedAll !== undefined)) return 'orders'; // work-order-tracker
  if (j.defects && j.counts && j.counts.byLevel) return 'defects';      // defect-intake-grading
  if (j.majorHazards !== undefined) return 'hazard';                    // hazard-closure-tracker
  if (j.counts && j.counts.leaks !== undefined && j.repaired !== undefined) return 'leaks'; // leak-point-tracker
  return null;
}

const CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];

function main() {
  const a = C.parseArgs(process.argv.slice(2), VALUE_OPTS, FLAG_OPTS);
  if (!a.input) throw new Error('缺少 --input');
  if (!a.workshop) throw new Error('缺少 --workshop');
  if (!a.date) throw new Error('缺少 --date');
  const date = C.normDate(a.date);
  if (!date) throw new Error(`--date 「${a.date}」不是有效日期，应为 YYYY-MM-DD`);

  const inputs = a.input.split(',').map((s) => s.trim()).filter(Boolean);
  const outDir = a.out || path.join(os.tmpdir(), 'edr-out');

  // ---- 各章节数据；未提供的一律保持 null，报告写「本日未提供 XX 数据」
  let status = null, orders = null, defectsData = null, eventsRows = null, maintRows = null;
  let specialRows = null, permitRows = null, leaksData = null, hazardData = null;
  const sources = [];

  for (const p of inputs) {
    const got = loadAny(p);
    if (got.kind === 'json') {
      const t = detectJson(got.data);
      if (t === 'status') { status = got.data; sources.push(`${got.name}→巡检汇总(JSON)`); }
      else if (t === 'orders') { orders = got.data; sources.push(`${got.name}→工单跟踪(JSON)`); }
      else if (t === 'defects') { defectsData = got.data; sources.push(`${got.name}→缺陷登记(JSON)`); }
      else if (t === 'hazard') { hazardData = got.data; sources.push(`${got.name}→隐患跟踪(JSON)`); }
      else if (t === 'leaks') { leaksData = got.data; sources.push(`${got.name}→泄漏点跟踪(JSON)`); }
      else warnings.push(`${got.name} 无法识别为已知的上游 JSON（巡检汇总/工单跟踪/缺陷登记/泄漏点跟踪/隐患跟踪），已忽略`);
      continue;
    }
    const book = got.data;
    const sInsp = C.pickSheet(book, '巡检汇总', '设备状态', '巡检记录');
    if (sInsp && !status) {
      const recs = C.toRecords(sInsp, ['位号'], `${got.name}/巡检汇总`, ['设备名称', '状态', '异常描述', '重要度', '运行参数'], warnings, ALIASES);
      const cls = recs.map((r) => ({ r, st: classifyState(r['状态']) }));
      const byState = {};
      for (const k of SIX_STATES) byState[k] = cls.filter((x) => x.st === k).length;
      const ab = cls.filter((x) => x.st === '异常').map((x) => x.r);
      status = {
        counts: { equipment: recs.length, normal: byState['运行'], abnormal: byState['异常'], unknown: byState['未判定'], missed: null },
        byState,
        abnormal: ab.map((r) => ({ tag: C.str(r['位号']), name: C.str(r['设备名称']), desc: C.str(r['异常描述']) })),
        _special: cls.filter((x) => /特护/.test(C.str(x.r['重要度']))).map((x) => ({
          tag: C.str(x.r['位号']), name: C.str(x.r['设备名称']), state: x.st, params: C.str(x.r['运行参数']), desc: C.str(x.r['异常描述']),
        })),
      };
      sources.push(`${got.name}→巡检汇总`);
    }
    const sSpec = C.pickSheet(book, '特护设备', '特护', '特护日报', '特护机组');
    if (sSpec && !specialRows) {
      specialRows = C.toRecords(sSpec, ['位号'], `${got.name}/特护设备`, ['设备名称', '状态', '运行参数', '异常描述', '备注'], warnings, ALIASES);
      sources.push(`${got.name}→特护设备`);
    }
    const sDef = C.pickSheet(book, '缺陷台账', '缺陷', '通知单');
    if (sDef && !defectsData) {
      const recs = C.toRecords(sDef, ['位号'], `${got.name}/缺陷台账`, ['设备名称', '缺陷描述', '等级', '状态', '发现时间', '通知单号'], warnings, ALIASES);
      defectsData = { _rows: recs.map((r) => ({ no: C.str(r['通知单号']), tag: C.str(r['位号']), name: C.str(r['设备名称']), desc: C.str(r['缺陷描述']), level: C.str(r['等级']), status: C.str(r['状态']), foundAt: C.normDate(r['发现时间']) })) };
      sources.push(`${got.name}→缺陷台账`);
    }
    const sOrd = C.pickSheet(book, '工单台账', '工单', '订单');
    if (sOrd && !orders) {
      const recs = C.toRecords(sOrd, ['工单号'], `${got.name}/工单台账`, ['位号', '状态', '要求完成时间', '责任人', '缺陷描述', '工作中心'], warnings, ALIASES);
      orders = { _rows: recs.map((r) => ({ no: C.str(r['工单号']), tag: C.str(r['位号']), status: C.str(r['状态']), due: C.normDate(r['要求完成时间']), owner: C.str(r['责任人']) || C.str(r['工作中心']), desc: C.str(r['缺陷描述']) })) };
      sources.push(`${got.name}→工单台账`);
    }
    // 「作业清单」只认表名以它开头（作业票系统导出），「检修作业清单」等是检修项目表，不当作业票
    const sPmt = C.pickSheet(book, '作业票', '作业许可', '许可证', '作业许可证')
      || (() => { const k = Object.keys(book).find((x) => /^作业清单/.test(String(x).replace(/[\s表]/g, ''))); return k ? book[k] : null; })();
    if (sPmt && !permitRows) {
      permitRows = C.toRecords(sPmt, ['许可证编号'], `${got.name}/作业票`, ['作业类别', '作业级别', '作业地点', '位号', '作业单位', '状态', '属地监护人'], warnings, ALIASES);
      sources.push(`${got.name}→作业票`);
    }
    const sLeak = C.pickSheet(book, '泄漏点', '漏点', '密封点', 'LDAR');
    if (sLeak && !leaksData) {
      const recs = C.toRecords(sLeak, ['密封点编号'], `${got.name}/泄漏点`, ['位号', '状态', '发现时间', '责任人', '整改期限'], warnings, ALIASES);
      leaksData = { _rows: recs.map((r) => ({ no: C.str(r['密封点编号']), tag: C.str(r['位号']), status: C.str(r['状态']), foundDate: C.normDate(r['发现时间']), owner: C.str(r['责任人']), due: C.normDate(r['整改期限']) })) };
      sources.push(`${got.name}→泄漏点`);
    }
    const sHaz = C.pickSheet(book, '隐患台账', '隐患');
    if (sHaz && !hazardData) {
      const recs = C.toRecords(sHaz, ['隐患描述'], `${got.name}/隐患台账`, ['隐患编号', '隐患等级', '整改状态', '整改期限', '责任人', '位号', '通知单号', '验收情况', '验收人', '验收日期'], warnings, ALIASES);
      hazardData = { _rows: recs.map((r) => {
        const verified = C.str(r['验收情况']);
        const accepted = hazardAccept(verified);
        if (verified && accepted === null) warnings.push(`隐患台账 第${r._row}行 验收情况「${verified}」无法归类，按无验收记录处理`);
        const acceptor = C.str(r['验收人']);
        const acceptDate = C.normDate(r['验收日期']);
        if (r['验收日期'] && !acceptDate) warnings.push(`隐患台账 第${r._row}行 验收日期「${C.str(r['验收日期'])}」无法解析`);
        // 有验收记录 = 验收情况判通过，或填了验收人/验收日期；验收情况明确为否定写法时，填了人/日期也不算通过（与 hazard.js 同）
        const hasAcceptRecord = accepted === true || (accepted !== false && (!!acceptor || !!acceptDate));
        return { no: C.str(r['隐患编号']) || C.str(r['通知单号']), desc: C.str(r['隐患描述']), level: C.str(r['隐患等级']), status: C.str(r['整改状态']), deadline: C.normDate(r['整改期限']), owner: C.str(r['责任人']), tag: C.str(r['位号']), verified, acceptor, acceptDate, hasAcceptRecord };
      }) };
      sources.push(`${got.name}→隐患台账`);
    }
    const sEvt = C.pickSheet(book, '异常事件', '事件');
    if (sEvt && !eventsRows) {
      eventsRows = C.toRecords(sEvt, ['事件描述'], `${got.name}/异常事件`, ['时间', '位号', '影响', '处置措施', '状态'], warnings, ALIASES);
      sources.push(`${got.name}→异常事件`);
    }
    const sMnt = C.pickSheet(book, '检修进度', '检修');
    if (sMnt && !maintRows) {
      maintRows = C.toRecords(sMnt, ['项目名称'], `${got.name}/检修进度`, ['位号', '状态', '完成比例', '责任人', '计划完成'], warnings, ALIASES);
      sources.push(`${got.name}→检修进度`);
    }
  }
  if (!sources.length) throw new Error('未在输入中识别到任何可用数据（巡检汇总 / 特护设备 / 缺陷台账 / 工单台账 / 作业票 / 泄漏点 / 隐患台账 / 异常事件 / 检修进度，或上游技能 JSON）');

  // ---- 一、设备状态章节（六档）
  let statusSec = null;
  if (status) {
    const c = status.counts || {};
    let byState = status.byState || null;
    if (!byState && c.sixTier && typeof c.sixTier === 'object') {
      // 新版 inspection-data-digest：六档计数在 counts.sixTier（按巡检记录与台账使用状态归档）
      byState = {};
      for (const k of SIX_STATES) byState[k] = c.sixTier[k] ?? 0;
    }
    if (!byState) {
      // 旧版上游 status.json 只有 normal/abnormal/unknown 三档：normal → 运行，abnormal → 异常，其余 → 未判定；备用/检修/停用需巡检表「状态」列
      byState = { '运行': c.normal ?? null, '备用': null, '检修': null, '停用': null, '异常': c.abnormal ?? null, '未判定': c.unknown ?? null };
      warnings.push('巡检汇总来自上游 JSON，仅含正常/异常/未判定三档；备用/检修/停用台数需巡检表「状态」列，已置为未提供');
    }
    statusSec = {
      equipment: c.equipment ?? null, normal: c.normal ?? null, abnormal: c.abnormal ?? null,
      unknown: c.unknown ?? null, missed: c.missed ?? null, byState,
      abnormalList: (status.abnormal || []).map((x) => ({ tag: x.tag, name: x.name || '', desc: x.desc || '', area: x.area || '', discipline: x.discipline || '' })),
    };
  }

  // ---- 二、特护设备运行状况（优先「特护设备」表；否则取巡检汇总中重要度含「特护」的行）
  let specialSec = null;
  if (specialRows) {
    const list = specialRows.map((r) => ({ tag: C.str(r['位号']), name: C.str(r['设备名称']), state: classifyState(r['状态']), params: C.str(r['运行参数']), desc: C.str(r['异常描述']) || C.str(r['备注']) }));
    specialSec = { total: list.length, abnormal: list.filter((x) => x.state === '异常').length, source: '特护设备表', list };
  } else if (status && status._special && status._special.length) {
    specialSec = { total: status._special.length, abnormal: status._special.filter((x) => x.state === '异常').length, source: '巡检汇总（重要度含特护）', list: status._special };
  } else if (status && Array.isArray(status.byEquipment) && status.byEquipment.some((x) => x && x.special)) {
    // inspection-data-digest 的 status.json：byEquipment[].special 标特护，stateCn 为六档显示
    const desc = {};
    for (const x of status.abnormal || []) if (x && x.tag) desc[x.tag] = [desc[x.tag], x.desc].filter(Boolean).join('；');
    const list = status.byEquipment.filter((x) => x && x.special).map((x) => ({
      tag: C.str(x.tag), name: C.str(x.name), state: x.stateCn || (x.state === 'abnormal' ? '异常' : x.state === 'normal' ? '运行' : '未判定'), params: '', desc: desc[x.tag] || '',
    }));
    specialSec = { total: list.length, abnormal: list.filter((x) => x.state === '异常').length, source: '巡检汇总 JSON（特护标记）', list };
  }
  if (status) delete status._special;

  // ---- 三、缺陷章节
  let defectSec = null;
  if (defectsData) {
    if (defectsData.defects) {   // 来自 defect-intake-grading
      const ds = defectsData.defects;
      defectSec = {
        newCount: ds.length, byLevel: defectsData.counts?.byLevel || {},
        undetermined: (defectsData.undetermined || []).length,
        newList: ds.map((d) => ({ no: d.no, tag: d.tag, name: d.name, desc: d.desc, level: d.levelCn, due: d.dueDate })),
        openCount: null, pendingAccept: null, openList: [],
      };
    } else {                      // 来自 xlsx 台账
      const rows = defectsData._rows;
      const live = rows.filter((r) => !isCancelled(r.status));
      const newToday = live.filter((r) => r.foundAt === date);
      const open = live.filter((r) => !isClosed(r.status));
      const pending = open.filter((r) => isPendingAccept(r.status));
      const byLevel = {};
      for (const r of newToday) { const k = r.level || '未填等级'; byLevel[k] = (byLevel[k] || 0) + 1; }
      defectSec = {
        newCount: newToday.length, byLevel, undetermined: null,
        newList: newToday.map((r) => ({ no: r.no || '', tag: r.tag, name: r.name, desc: r.desc, level: r.level || '—', due: null })),
        openCount: open.length, pendingAccept: pending.length,
        openList: open.map((r) => ({ no: r.no || '', tag: r.tag, name: r.name, desc: r.desc, level: r.level || '—', foundAt: r.foundAt, status: C.normSapStatus(r.status) || r.status || '—' })),
      };
    }
  }

  // ---- 四、工单章节
  let orderSec = null;
  if (orders) {
    if (orders.counts) {          // 来自 work-order-tracker
      orderSec = {
        total: orders.counts.total ?? null, open: orders.counts.open ?? null,
        pendingAccept: orders.counts.pendingAccept ?? (orders.byStatus && orders.byStatus['待验收'] !== undefined ? orders.byStatus['待验收'] : null),
        overdue: orders.counts.overdue ?? null, stalled: orders.counts.stalled ?? null,
        closedInRange: orders.counts.closedInRange ?? null,
        closeRate: orders.metrics?.closeRate ?? null,
        overdueList: (orders.overdue || []).map((x) => ({ no: x.no || x.orderNo, tag: x.tag, desc: x.desc || x.fault, days: x.overdueDays, owner: x.owner || x.vendor || '' })),
      };
    } else {                      // 来自 xlsx 台账
      const rows = orders._rows;
      const live = rows.filter((r) => !isCancelled(r.status));
      const open = live.filter((r) => !isClosed(r.status));
      const pending = open.filter((r) => isPendingAccept(r.status));
      const overdue = open.filter((r) => r.due && C.diffDays(date, r.due) > 0);
      orderSec = {
        total: rows.length, open: open.length, pendingAccept: pending.length, overdue: overdue.length, stalled: null,
        closedInRange: null, closeRate: null,
        overdueList: overdue.map((r) => ({ no: r.no, tag: r.tag, desc: r.desc, days: C.diffDays(date, r.due), owner: r.owner })),
      };
    }
  }

  // ---- 五、当日检修作业与作业票
  let permitSec = null;
  if (permitRows) {
    const list = permitRows.map((r) => ({
      no: C.str(r['许可证编号']), type: C.str(r['作业类别']).replace(/动火/g, '用火') || '（未填类别）', level: C.str(r['作业级别']),
      place: C.str(r['作业地点']), tag: C.str(r['位号']), unit: C.str(r['作业单位']), status: C.str(r['状态']), guardian: C.str(r['属地监护人']),
    }));
    const byType = {};
    for (const x of list) byType[x.type] = (byType[x.type] || 0) + 1;
    permitSec = { total: list.length, byType, noGuardian: list.filter((x) => !x.guardian).length, list };
  }
  let maintSec = null;
  if (maintRows) {
    const list = maintRows.map((r) => {
      const raw = r['完成比例'];
      let p = num(raw, { sheet: '检修进度', row: r._row, col: '完成比例' });
      if (p !== null && p <= 1 && /%/.test(C.str(raw)) === false && p !== 0) p = p * 100;  // 0.6 视为 60%
      if (p !== null && (p < 0 || p > 100)) { warnings.push(`检修进度 第${r._row}行 完成比例「${C.str(raw)}」超出 0~100 范围，已置为未填`); p = null; }
      return { project: C.str(r['项目名称']), tag: C.str(r['位号']), status: C.str(r['状态']),
        percent: p, owner: C.str(r['责任人']), planEnd: C.normDate(r['计划完成']) };
    });
    maintSec = { total: list.length, list };
  }

  // ---- 六、泄漏点
  let leakSec = null;
  if (leaksData) {
    if (leaksData.counts) {       // 来自 leak-point-tracker leaks.json
      const c = leaksData.counts;
      leakSec = {
        source: 'leaks.json', leaks: c.leaks ?? null, newLeaks: c.newLeaks ?? null, open: c.open ?? null, overdue: c.overdue ?? null,
        repaired: c.repaired ?? null, undetermined: c.undetermined ?? null, repairRate: leaksData.metrics?.repairRate ?? null,
        overdueList: (leaksData.overdue || []).map((x) => ({ no: x.no, tag: x.tag, comp: x.comp || '', owner: x.owner || '', days: x.finalOverdueDays ?? x.firstOverdueDays ?? null, status: x.statusCn || x.status || '' })),
      };
    } else {
      const rows = leaksData._rows;
      const open = rows.filter((r) => !isClosed(r.status) && !/^(已修复|已消除|修复|已整改)/.test(r.status));
      const overdue = open.filter((r) => r.due && C.diffDays(date, r.due) > 0);
      leakSec = {
        source: '泄漏点表', leaks: rows.length, newLeaks: rows.filter((r) => r.foundDate === date).length, open: open.length, overdue: overdue.length,
        repaired: rows.length - open.length, undetermined: null, repairRate: null,
        overdueList: overdue.map((r) => ({ no: r.no, tag: r.tag, comp: '', owner: r.owner, days: C.diffDays(date, r.due), status: r.status })),
      };
    }
  }

  // ---- 七、隐患
  let hazardSec = null;
  if (hazardData) {
    if (hazardData.counts) {      // 来自 hazard-closure-tracker hazard.json
      const c = hazardData.counts;
      hazardSec = {
        source: 'hazard.json', total: c.total ?? null, overdue: c.overdue ?? null, dueSoon: c.dueSoon ?? null, inProgress: c.inProgress ?? null,
        closed: c.closed ?? null, major: c.major ?? null, unverified: c.unverified ?? null, undetermined: c.undetermined ?? null,
        closureRate: hazardData.metrics?.closureRate ?? null,
        overdueList: (hazardData.overdue || []).map((x) => ({ no: x.no, desc: x.desc, level: x.levelCn || x.level || '', owner: x.owner || '', deadline: x.deadline || null, days: x.overdueDays ?? null })),
        majorList: (hazardData.majorHazards || []).map((x) => ({ no: x.no, desc: x.desc, status: x.statusCn || x.status || '', deadline: x.deadline || null })),
      };
    } else {
      const rows = hazardData._rows;
      // 完成态（已整改/已完成/已闭环/已销号/已处理等，判定同 hazard.js）：有验收记录 → 已闭环；无验收记录 → 已整改未验收，单列，不计闭环、不判超期。
      // 不走通用 isClosed：隐患「已闭环」也要有验收记录才计闭环，且「尚未闭环」不能因含「闭环」被当成已闭环
      const rectified = (r) => hazardDone(r.status);
      const verifiedOk = (r) => r.hasAcceptRecord;
      const closedRows = rows.filter((r) => rectified(r) && verifiedOk(r));
      const unverified = rows.filter((r) => !closedRows.includes(r) && rectified(r));
      const open = rows.filter((r) => !closedRows.includes(r) && !rectified(r));
      const overdue = open.filter((r) => r.deadline && C.diffDays(date, r.deadline) > 0);
      const noDeadline = open.filter((r) => !r.deadline).length;
      const lv = rows.map((r) => ({ r, h: hazardLevel(r.level) }));
      const major = lv.filter((x) => x.h.level === 'major').map((x) => x.r);
      const unmapped = lv.filter((x) => x.h.level === null && C.str(x.r.level)).length;
      if (unmapped) warnings.push(`隐患台账 ${unmapped} 条隐患等级不是「重大/一般」，未映射（A/B/C 级在多数厂是管理层级），按原文展示`);
      hazardSec = {
        source: '隐患台账表', total: rows.length, overdue: overdue.length, dueSoon: null, inProgress: open.length - overdue.length - noDeadline,
        closed: closedRows.length, major: major.length, unverified: unverified.length, undetermined: noDeadline, closureRate: null,
        overdueList: overdue.map((r) => ({ no: r.no, desc: r.desc, level: hazardLevel(r.level).cn, owner: r.owner, deadline: r.deadline, days: C.diffDays(date, r.deadline) })),
        majorList: major.map((r) => ({ no: r.no, desc: r.desc, status: r.status, deadline: r.deadline })),
      };
    }
  }

  // ---- 八、异常事件章节
  let eventSec = null;
  if (eventsRows) {
    const list = eventsRows.map((r) => ({
      time: C.normDateTime(r['时间']) || '', tag: C.str(r['位号']), desc: C.str(r['事件描述']),
      impact: C.str(r['影响']), action: C.str(r['处置措施']), status: C.str(r['状态']),
    }));
    eventSec = { total: list.length, unclosed: list.filter((x) => !isClosed(x.status)).length, list };
  }

  // ---- 环比
  let compare = null;
  if (a.prev) {
    if (!fs.existsSync(a.prev)) throw new Error(`上一日 daily.json 不存在: ${a.prev}`);
    let prev; try { prev = JSON.parse(fs.readFileSync(a.prev, 'utf8')); } catch (e) { throw new Error(`上一日 daily.json 解析失败: ${e.message}`); }
    const d = (cur, pre) => (cur === null || cur === undefined || pre === null || pre === undefined ? null : cur - pre);
    compare = {
      prevDate: prev.meta?.date || null,
      abnormal: d(statusSec?.abnormal, prev.status?.abnormal),
      overdueOrders: d(orderSec?.overdue, prev.orders?.overdue),
      openDefects: d(defectSec?.openCount, prev.defects?.openCount),
      openLeaks: d(leakSec?.open, prev.leaks?.open),
      overdueHazards: d(hazardSec?.overdue, prev.hazards?.overdue),
    };
  }

  // ---- 次日计划（用户提供，不编造）
  let plan = null;
  if (a.plan) plan = fs.existsSync(a.plan) ? fs.readFileSync(a.plan, 'utf8').trim() : a.plan;

  const counts = {
    equipment: statusSec?.equipment ?? null, abnormal: statusSec?.abnormal ?? null,
    specialEquipment: specialSec?.total ?? null, specialAbnormal: specialSec?.abnormal ?? null,
    newDefects: defectSec?.newCount ?? null, openDefects: defectSec?.openCount ?? null, pendingAcceptDefects: defectSec?.pendingAccept ?? null,
    overdueOrders: orderSec?.overdue ?? null, openOrders: orderSec?.open ?? null, pendingAcceptOrders: orderSec?.pendingAccept ?? null,
    permits: permitSec?.total ?? null, maintProjects: maintSec?.total ?? null,
    openLeaks: leakSec?.open ?? null, overdueLeaks: leakSec?.overdue ?? null,
    hazards: hazardSec?.total ?? null, overdueHazards: hazardSec?.overdue ?? null,
    events: eventSec?.total ?? null, unclosedEvents: eventSec?.unclosed ?? null,
  };

  // ---- 产出
  C.ensureDir(outDir);
  const daily = {
    meta: { workshop: a.workshop, date, shift: a.shift || null, sources, generatedAt: C.localDateTime(), stateScheme: SIX_STATES },
    counts, status: statusSec, special: specialSec, defects: defectSec, orders: orderSec, permits: permitSec,
    maintenance: maintSec, leaks: leakSec, hazards: hazardSec, events: eventSec, compare, plan, warnings,
  };
  fs.writeFileSync(path.join(outDir, 'daily.json'), JSON.stringify(daily, null, 2), 'utf8');

  const NA = (label) => `_本日未提供${label}数据。_\n`;
  const L = [];
  let n = 0;
  const H = (t) => { L.push(`## ${CN[n++]}、${t}`); L.push(''); };
  L.push(`# ${a.workshop} 设备日报（${date}）`);
  L.push('');
  L.push(`数据来源：${sources.join('、')}${a.shift ? `　｜　值班：${a.shift}` : ''}`);
  L.push(`生成时间：${C.localDateTime()}（北京时间）`);
  L.push('');

  H('设备状态概览');
  if (!statusSec) L.push(NA('巡检汇总'));
  else {
    const rows = [['涉及设备', C.fmt(statusSec.equipment, 0)]];
    for (const k of SIX_STATES) rows.push([k, statusSec.byState[k] === null || statusSec.byState[k] === undefined ? '—（未提供）' : C.fmt(statusSec.byState[k], 0)]);
    if (statusSec.missed !== null) rows.push(['漏检', C.fmt(statusSec.missed, 0)]);
    else rows.push(['漏检', '—（未提供台账，无法识别）']);
    L.push(C.mdTable(['状态（六档）', '台数'], rows));
    if (statusSec.unknown) L.push(`【未判定】${statusSec.unknown} 台设备状态列为空或无法归入六档，按未判定单列，不计入运行。\n`);
  }

  H('特护设备运行状况');
  if (!specialSec) L.push(NA('特护设备'));
  else {
    L.push(`共 ${specialSec.total} 台（来源：${specialSec.source}），异常 ${specialSec.abnormal} 台。逐台列状态与参数，趋势判断由设备员复核。`);
    L.push('');
    L.push(C.mdTable(['位号', '设备名称', '状态', '运行参数', '异常/备注'], specialSec.list.map((x) => [x.tag, x.name || '—', x.state, x.params || '—', x.desc || '—'])));
  }

  H('异常与缺陷');
  if (statusSec && statusSec.abnormalList.length) {
    L.push('**本日巡检异常**');
    L.push('');
    L.push(C.mdTable(['位号', '设备名称', '异常描述'], statusSec.abnormalList.map((x) => [x.tag, x.name || '—', x.desc || '—'])));
  }
  if (!defectSec) L.push(NA('缺陷'));
  else {
    L.push(`**新增缺陷（维修通知单）${C.fmt(defectSec.newCount, 0)} 条**${Object.keys(defectSec.byLevel).length ? `（${Object.entries(defectSec.byLevel).map(([k, v]) => `${k} ${v}`).join('，')}）` : ''}`);
    L.push('');
    L.push(C.mdTable(['通知单号', '位号', '设备名称', '缺陷描述', '等级', '要求完成'],
      defectSec.newList.map((d) => [d.no || '—', d.tag, d.name || '—', d.desc, d.level, d.due || '—'])));
    if (defectSec.openCount !== null) {
      L.push(`**未闭环缺陷 ${defectSec.openCount} 条**，其中待验收 ${C.fmt(defectSec.pendingAccept, 0)} 条（已完工、尚未验收关闭，不计入闭环）`);
      L.push('');
      L.push(C.mdTable(['通知单号', '位号', '设备名称', '缺陷描述', '等级', '状态', '发现日期'],
        defectSec.openList.map((d) => [d.no || '—', d.tag, d.name || '—', d.desc, d.level, d.status, d.foundAt || '—'])));
    }
  }

  H('工单执行');
  if (!orderSec) L.push(NA('工单'));
  else {
    L.push(C.mdTable(['指标', '数量'], [
      ['工单总数', C.fmt(orderSec.total, 0)], ['未闭环', C.fmt(orderSec.open, 0)],
      ['其中待验收（完工未验收）', C.fmt(orderSec.pendingAccept, 0)],
      ['超期', C.fmt(orderSec.overdue, 0)], ['停滞', C.fmt(orderSec.stalled, 0)],
      ['本期闭环', C.fmt(orderSec.closedInRange, 0)],
      ['闭环率', orderSec.closeRate === null ? '—' : `${orderSec.closeRate}%`],
    ]));
    if (orderSec.overdueList.length) {
      L.push('**超期工单**');
      L.push('');
      L.push(C.mdTable(['工单号', '位号', '故障描述', '超期天数', '责任方'],
        orderSec.overdueList.map((x) => [x.no || '—', x.tag || '—', x.desc || '—', C.fmt(x.days, 0), x.owner || '（未填写）'])));
    }
  }

  H('当日检修作业与作业票');
  if (!permitSec) L.push(NA('作业票'));
  else {
    L.push(`本日作业票 ${permitSec.total} 张：${Object.entries(permitSec.byType).map(([k, v]) => `${k} ${v}`).join('，')}。属地监护人未填 ${permitSec.noGuardian} 张（中石化为双监护，级别以作业票为准，本技能不自判）。`);
    L.push('');
    L.push(C.mdTable(['许可证编号', '作业类别', '级别', '作业地点', '位号', '作业单位', '属地监护人', '状态'],
      permitSec.list.map((x) => [x.no, x.type, x.level || '—', x.place || '—', x.tag || '—', x.unit || '—', x.guardian || '（未填）', x.status || '—'])));
  }
  L.push('**检修进度**');
  L.push('');
  if (!maintSec) L.push(NA('检修进度'));
  else L.push(C.mdTable(['项目名称', '位号', '状态', '完成比例', '计划完成', '责任人'],
    maintSec.list.map((m) => [m.project, m.tag || '—', m.status || '—', m.percent === null ? '—' : `${m.percent}%`, m.planEnd || '—', m.owner || '—'])));

  H('泄漏点');
  if (!leakSec) L.push(NA('泄漏点'));
  else {
    L.push(C.mdTable(['指标', '数量'], [
      ['泄漏点总数', C.fmt(leakSec.leaks, 0)], ['本日新增', C.fmt(leakSec.newLeaks, 0)], ['未修复', C.fmt(leakSec.open, 0)],
      ['超期未修', C.fmt(leakSec.overdue, 0)], ['已修复', C.fmt(leakSec.repaired, 0)], ['未判定', C.fmt(leakSec.undetermined, 0)],
      ['修复率', leakSec.repairRate === null ? '—' : `${leakSec.repairRate}%`],
    ]));
    if (leakSec.overdueList.length) {
      L.push('**超期未修泄漏点**');
      L.push('');
      L.push(C.mdTable(['密封点编号', '位号', '组件', '责任人', '超期天数', '状态'],
        leakSec.overdueList.map((x) => [x.no || '—', x.tag || '—', x.comp || '—', x.owner || '（未填写）', C.fmt(x.days, 0), x.status || '—'])));
    }
    L.push('泄漏率（静/动密封点）按月在周报月报核算，日报只列点数。\n');
  }

  H('隐患');
  if (!hazardSec) L.push(NA('隐患'));
  else {
    L.push(C.mdTable(['指标', '数量'], [
      ['隐患总数', C.fmt(hazardSec.total, 0)], ['重大隐患', C.fmt(hazardSec.major, 0)], ['整改中', C.fmt(hazardSec.inProgress, 0)],
      ['超期未整改', C.fmt(hazardSec.overdue, 0)], ['临期', C.fmt(hazardSec.dueSoon, 0)], ['已闭环', C.fmt(hazardSec.closed, 0)],
      ['已整改未验收', C.fmt(hazardSec.unverified, 0)],
      ['未判定（无整改期限等）', C.fmt(hazardSec.undetermined, 0)],
      ['闭环率', hazardSec.closureRate === null ? '—' : `${hazardSec.closureRate}%`],
    ]));
    if (hazardSec.majorList.length) {
      L.push('**重大隐患**');
      L.push('');
      L.push(C.mdTable(['编号', '隐患描述', '状态', '整改期限'], hazardSec.majorList.map((x) => [x.no || '—', x.desc, x.status || '—', x.deadline || '—'])));
    }
    if (hazardSec.overdueList.length) {
      L.push('**超期未整改**');
      L.push('');
      L.push(C.mdTable(['编号', '隐患描述', '等级', '责任人', '整改期限', '超期天数'],
        hazardSec.overdueList.map((x) => [x.no || '—', x.desc, x.level || '—', x.owner || '（未填写）', x.deadline || '—', C.fmt(x.days, 0)])));
    }
    L.push('隐患认定、等级与整改验收以安全部门意见为准；一般隐患期限以整改方案（五定）为准，台账无期限的列未判定。\n');
  }

  H('异常事件');
  if (!eventSec) L.push(NA('异常事件'));
  else {
    L.push(`共 ${eventSec.total} 条，其中未闭环 ${eventSec.unclosed} 条。`);
    L.push('');
    L.push(C.mdTable(['时间', '位号', '事件描述', '影响', '处置措施', '状态'],
      eventSec.list.map((e) => [e.time || '—', e.tag || '—', e.desc, e.impact || '—', e.action || '—', e.status || '—'])));
  }

  if (compare) {
    H('环比');
    const sign = (v) => (v === null ? '—' : v > 0 ? `+${v}` : String(v));
    L.push(C.mdTable(['指标', `较 ${compare.prevDate || '上一日'}`], [
      ['异常设备', sign(compare.abnormal)], ['超期工单', sign(compare.overdueOrders)], ['未闭环缺陷', sign(compare.openDefects)],
      ['未修复泄漏点', sign(compare.openLeaks)], ['超期隐患', sign(compare.overdueHazards)],
    ]));
  }

  H('设备运行情况说明');
  L.push('<!-- ANALYSIS_START -->');
  L.push('（由模型依据 references/report-rules.md 口径撰写 250~400 字，结构：总体状况 → 特护设备 → 异常与缺陷 → 工单与作业 → 泄漏点与隐患 → 需协调或上报事项 → 次日重点。所有数字引用 daily.json，未闭环事项须列责任人与计划完成时间，台账无记录的写「未记录」。）');
  L.push('<!-- ANALYSIS_END -->');
  L.push('');

  H('次日计划');
  if (plan) { L.push(plan); L.push(''); }
  else L.push('_次日计划由车间填写，本技能不代为拟定。_\n');

  L.push('本材料由脚本汇总、模型成文，仅供设备员复核参考，不替代审批、定性、验收与签字；厂内制度与系统数据为准。');
  L.push('');

  if (warnings.length) {
    L.push('## 附：数据提示');
    L.push('');
    for (const w of warnings) L.push(`- ${w}`);
    L.push('');
  }
  fs.writeFileSync(path.join(outDir, 'daily.md'), L.join('\n'), 'utf8');

  C.emitOk(outDir, { ok: true, out: outDir, date, workshop: a.workshop, sources, counts, sections: n, warnings });
}

try { main(); } catch (e) { C.fail(e, warnings); }
