#!/usr/bin/env node
'use strict';
/**
 * 维修工单跟踪与催办脚本（中石化体系炼化厂车间设备员口径，仅 Node.js 内置模块）
 * 用法：node "<技能目录>/scripts/track.js" --input <xlsx|csv目录> --workshop "常减压车间" --date 2026-09-21 [--out <dir>]
 *       [--from <起始日期>] [--sla <时限口径xlsx>] [--vendor <承修单位/工作中心>] [--owner <责任人>] [--stall-days 7] [--due-soon 2]
 * 输入：SAP PM 工单（订单）导出或车间工单台账；状态按 SAP 系统状态归一（CRTD/REL/PCNF/TECO/CLSD/DLFL 与中文同义词）。
 * 产出：<out>/orders.json、<out>/tracking.md、<out>/催办清单.md、<out>/summary.json；末行打印 JSON 摘要
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readXlsx, readCsvDir } = require('./lib/xlsx-lite');
const C = require('./lib/common');

const warnings = [];
const VALUE_OPTS = ['input', 'workshop', 'date', 'out', 'from', 'sla', 'vendor', 'owner', 'stall-days', 'due-soon'];
const FLAG_OPTS = ['help'];

const DISCLAIMER = '本材料由脚本汇总、模型成文，仅供设备员复核参考，不替代审批、定性、验收与签字；厂内制度与系统数据为准。';

/**
 * 别名：局部优先，再并入共享 SYSTEM_ALIASES（SAP PM 订单/通知单导出列名：订单、功能位置、系统状态、基本开始/结束日期、主工作中心、订单类型……）。
 * 局部不把「设备编号」当位号（SAP 设备编号是 8 位流水号），也不把「设备」当设备名称（SAP「设备」列是设备编号）。
 */
const ALIASES = C.mergeAliases({
  '工单号': ['工单号', '工单编号', '单号', '报修单号', '维修单号', 'WO', 'wo'],
  '位号': ['位号', '设备位号', 'TAG', 'tag'],
  '设备名称': ['设备名称', '名称'],
  '故障描述': ['故障描述', '故障现象', '缺陷描述', '问题描述', '报修内容', '描述', '通知单短文本', '短文本', '订单描述'],
  '状态': ['状态', '工单状态', '当前状态', '进度', '流程状态'],
  '优先级': ['优先级', '紧急程度', '紧急度', '等级', '级别'],
  '报修时间': ['报修时间', '报修日期', '提报时间', '登记时间', '创建时间', '创建日期', '通知日期', '报告日期', '故障开始'],
  '要求完成时间': ['要求完成时间', '要求完成日期', '计划完成时间', '计划完成日期', '承诺完成时间', '基本结束日期', '计划结束日期', '要求结束', '要求结束日期', '计划完工'],
  '派工时间': ['派工时间', '派工日期', '派单时间', '指派时间', '下达时间', '下达日期', '释放日期', '基本开始日期', '计划开始日期'],
  '开工时间': ['开工时间', '开工日期', '开始时间', '实际开工时间', '实际开始日期', '实际开工日期'],
  '完工时间': ['完工时间', '完工日期', '完成时间', '实际完工时间', '实际结束日期', '技术完成日期', '实际完工', '技术完成'],
  '验收时间': ['验收时间', '验收日期', '闭环时间', '关闭时间', '关闭日期', '业务完成日期', '闭环日期'],
  '承修单位': ['承修单位', '维修单位', '施工单位', '承接单位', '外委单位', '主工作中心', '工作中心', '维修班组'],
  '责任人': ['责任人', '负责人', '主办人', '维修负责人', '工单负责人'],
  '超期原因': ['超期原因', '延期原因', '滞后原因', '原因说明', '备注'],
  // 时限口径表
  '时限类别': ['时限类别', '类别', '工单类型', '订单类型', '维修类型', '优先级'],
  '时限': ['时限', '时限(天)', '时限天数', '要求时限', '完成时限', '天数'],
});
// 车间范围核对（D007）：「车间」只认车间 / 所属车间 / 属地车间 / 运行部（或其后加「名称」），
// 不让共享别名里的维护工厂 / 属地单位 / 使用单位占用该字段
ALIASES['车间'] = [...C.WORKSHOP_COLS, ...C.WORKSHOP_COLS.map((c) => c + '名称')];

// ---- 状态：按 SAP 系统状态六态归一（C.normSapStatus），认不出的保留旧版车间台账同义词，再认不出一律单列，不得就近映射
const STATUS_ENUM = ['待审核', '已派工', '施工中', '待验收', '已闭环', '已取消'];
const LOCAL_STATUS_SYNONYM = {
  '待审核': ['审核中', '待确认'],
  '已派工': ['已指派', '已分派'],
  '施工中': ['作业中'],
  '待验收': ['待检验', '待确认验收'],
  '已取消': ['已终止'],
};
/** 状态归一：先 SAP 六态映射（TECO/已完成/完工 → 待验收，CLSD/NOCO → 已闭环，否定前缀先判）；否则返回 null */
function normStatus(v) {
  const s = C.str(v).replace(/\s/g, '');
  if (s === '') return null;
  const sap = C.normSapStatus(s);
  if (sap) return sap;
  for (const std of STATUS_ENUM) {
    if ((LOCAL_STATUS_SYNONYM[std] || []).some((k) => s === k)) return std;
  }
  return null;
}
const OPEN_STATUS = ['待审核', '已派工', '施工中', '待验收'];   // 未闭环（在办）
const isOpen = (st) => OPEN_STATUS.includes(st);

// ---- 优先级：SAP 1 非常高 / 2 高 / 3 中 / 4 低（中文"紧急/高/中/低"与旧一~四级按此映射）
const PRIO_KEYS = [1, 2, 3, 4];
const PRIO_CN = { 1: '1 非常高', 2: '2 高', 3: '3 中', 4: '4 低' };
const PRIO_SYNONYM = {
  1: ['1', '非常高', '紧急', '特急', '一级', 'I', '1级', '1非常高', 'U', 'urgent'],
  2: ['2', '高', '较急', '重要', '二级', 'II', '2级', '2高', 'H', 'high'],
  3: ['3', '中', '一般', '普通', '三级', 'III', '3级', '3中', 'M', 'medium'],
  4: ['4', '低', '不急', '四级', 'IV', '4级', '4低', 'L', 'low'],
};
function normPrio(v) {
  const s = C.str(v).replace(/\s/g, '');
  if (s === '') return null;
  for (const k of PRIO_KEYS) if (PRIO_SYNONYM[k].some((x) => s.toUpperCase() === x.toUpperCase())) return k;
  return null;
}

// ---- 时限类别：抢修 / 一般（日常维修） / 计划性（计划检修），默认时限 24h / 7 天 / 30 天，非厂内正式口径，可用 --sla 覆盖
const CAT_ENUM = ['抢修', '一般', '计划性'];
const DEFAULT_SLA = { '抢修': 1, '一般': 7, '计划性': 30 };
const DEFAULT_SLA_NOTE = '默认时限口径（抢修 24 小时、一般 7 天、计划性 30 天）为脚本内置参考值，非厂内正式口径，如有厂内规定请用 --sla 传入覆盖。';
/** 工单类型文本/编码 → 时限类别；认不出返回 null。PM01/PM02/PM03 编码为常见口径，厂内可配置 */
function catFromType(v) {
  const s = C.str(v).replace(/\s/g, '').toUpperCase();
  if (!s) return null;
  if (/^(抢修|紧急维修|紧急抢修|故障抢修|事故抢修|PM03)$|抢修/.test(s)) return '抢修';
  if (/^(计划性|计划检修|计划维修|计划|定期检修|预防性维修|预防性|大检修|停工检修|PM02)$|计划|大检修|预防/.test(s)) return '计划性';
  if (/^(一般|日常维修|日常|一般维修|常规维修|PM01)$|日常|一般/.test(s)) return '一般';
  return null;
}
/** 优先级 → 时限类别推定：1 → 抢修，2/3 → 一般，4 → 计划性 */
function catFromPrio(p) {
  if (p === 1) return '抢修';
  if (p === 2 || p === 3) return '一般';
  if (p === 4) return '计划性';
  return null;
}
/** 时限口径表行键 → 类别：先按类别/工单类型文本，再按优先级写法 */
function normCat(v) {
  const s = C.str(v).replace(/\s/g, '');
  if (!s) return null;
  if (CAT_ENUM.includes(s)) return s;
  const t = catFromType(s);
  if (t) return t;
  return catFromPrio(normPrio(s));
}

// ---- 节点顺序（用于倒序校验与"最后有值节点"）
const NODES = [
  { key: 'reportAt', cn: '报修时间' },
  { key: 'assignAt', cn: '派工时间' },
  { key: 'startAt', cn: '开工时间' },
  { key: 'finishAt', cn: '完工时间' },
  { key: 'acceptAt', cn: '验收时间' },
];

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
  let stallDays = 7;
  if (a['stall-days'] !== undefined) {
    const n = Number(a['stall-days']);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`--stall-days 「${a['stall-days']}」应为正数（天）`);
    stallDays = n;
  }
  let dueSoonDays = 2;
  if (a['due-soon'] !== undefined) {
    const n = Number(a['due-soon']);
    if (!Number.isFinite(n) || n < 0) throw new Error(`--due-soon 「${a['due-soon']}」应为非负数（天）`);
    dueSoonDays = n;
  }
  if (!fs.existsSync(a.input)) throw new Error(`输入不存在: ${a.input}`);
  const outDir = a.out || path.join(os.tmpdir(), 'wot-out');

  // ---- 时限口径表（按时限类别：抢修 / 一般 / 计划性；兼容按优先级写的旧口径表）
  let sla = Object.assign({}, DEFAULT_SLA);
  let slaSource = '脚本默认口径';
  let slaOfficial = false;
  if (a.sla) {
    if (!fs.existsSync(a.sla)) throw new Error(`时限口径表不存在: ${a.sla}`);
    let sb;
    try { sb = loadBook(a.sla); } catch (e) { throw new Error(`时限口径表读取失败 ${a.sla}: ${e.message}`); }
    const rows = C.pickSheet(sb, '时限口径', '时限', '口径', 'SLA');
    if (!rows) warnings.push(`时限口径表「${path.basename(a.sla)}」中未找到「时限口径」工作表，仍按脚本默认口径计算`);
    else {
      const sr = C.toRecords(rows, ['时限类别', '时限'], `${path.basename(a.sla)}/时限口径`, [], warnings, ALIASES);
      const got = {};
      for (const r of sr) {
        const p = normCat(r['时限类别']);
        if (!p) { warnings.push(`时限口径表 第${r._row}行 类别「${C.str(r['时限类别'])}」不在枚举内（抢修/一般/计划性，或 SAP 优先级 1~4 写法），该行已跳过`); continue; }
        const d = C.parsePeriod(r['时限']);
        if (d === null) { warnings.push(`时限口径表 第${r._row}行 时限「${C.str(r['时限'])}」无法解析为天数，该行已跳过`); continue; }
        if (got[p] !== undefined && got[p] !== d) warnings.push(`时限口径表 第${r._row}行 类别「${p}」重复给出不同时限（${got[p]} 与 ${d} 天），以后出现者为准，请核实口径表`);
        got[p] = d;
      }
      if (Object.keys(got).length) {
        sla = Object.assign({}, DEFAULT_SLA, got);
        slaSource = `厂内口径表 ${path.basename(a.sla)}`;
        slaOfficial = true;
        const miss = CAT_ENUM.filter((p) => got[p] === undefined);
        if (miss.length) warnings.push(`时限口径表未给出「${miss.join('、')}」的时限，这些类别仍按脚本默认口径计算`);
      } else warnings.push('时限口径表中未读到任何有效口径行，仍按脚本默认口径计算');
    }
  }

  // ---- 读工单台账（SAP 订单导出 / 车间工单台账）
  let book;
  try { book = loadBook(a.input); } catch (e) { throw new Error(`读取失败 ${a.input}: ${e.message}`); }
  const rows = C.pickSheet(book, '工单台账', '工单', '维修工单', '报修台账', '订单', '维修订单');
  if (!rows) throw new Error('未在输入中找到「工单台账」工作表（SAP 订单导出请将工作表命名为「工单」或「订单」）');
  const sheetName = `${path.basename(a.input)}/工单台账`;
  const allRecs = C.toRecords(rows, ['工单号', '状态'], sheetName,
    ['通知单号', '位号', '设备编号', '设备名称', '故障描述', '工单类型', '优先级', '报修时间', '要求完成时间', '派工时间', '开工时间', '完工时间', '验收时间', '承修单位', '责任人', '超期原因', '车间'],
    warnings, ALIASES);
  // 车间范围核对（D007）：输入带车间列时剔除其他车间的工单
  const ws = C.workshopScope(allRecs, a.workshop, '工单台账', warnings);
  const scopes = [ws.scope];
  const wsNote = C.workshopScopeNote(scopes, a.workshop);
  const recs = ws.records;

  const orders = [];
  const unknownStatus = [];
  const seen = new Map();          // 工单号 → 出现次数（重复保留两条，仅 warning）
  for (const r of recs) {
    const no = C.str(r['工单号']);
    if (!no) { warnings.push(`工作表「${r._sheet}」第${r._row}行 工单号为空，已跳过`); continue; }
    if (seen.has(no)) {
      seen.set(no, seen.get(no) + 1);
      warnings.push(`工作表「${r._sheet}」第${r._row}行 工单号「${no}」重复出现（第 ${seen.get(no)} 次），两条均已保留，请核实台账`);
    } else seen.set(no, 1);

    const o = { no, dupIndex: seen.get(no), row: r._row, sheet: r._sheet };
    o.notifNo = C.str(r['通知单号']);
    o.tag = C.str(r['位号']);
    o.equipNo = C.str(r['设备编号']);
    o.name = C.str(r['设备名称']);
    o.fault = C.str(r['故障描述']);
    o.rawStatus = C.str(r['状态']);
    o.status = normStatus(r['状态']);
    o.rawPriority = C.str(r['优先级']);
    o.priority = normPrio(r['优先级']);
    if (o.rawPriority && !o.priority) warnings.push(`工作表「${r._sheet}」第${r._row}行 工单「${no}」优先级「${o.rawPriority}」不在 SAP 1~4（非常高/高/中/低）写法内，按「无优先级」处理，不据此推算时限`);
    o.rawType = C.str(r['工单类型']);
    o.typeCat = catFromType(o.rawType);
    if (o.rawType && !o.typeCat) warnings.push(`工作表「${r._sheet}」第${r._row}行 工单「${no}」工单类型「${o.rawType}」无法归入 抢修/一般/计划性，改按优先级推定时限类别`);
    // 时限类别：先工单类型，再优先级；两者皆无 → null（不推算）
    if (o.typeCat) { o.category = o.typeCat; o.categoryBasis = `工单类型「${o.rawType}」`; }
    else if (catFromPrio(o.priority)) { o.category = catFromPrio(o.priority); o.categoryBasis = `按优先级 ${PRIO_CN[o.priority]} 推定`; }
    else { o.category = null; o.categoryBasis = null; }
    o.vendor = C.str(r['承修单位']);
    o.owner = C.str(r['责任人']);
    o.reason = C.str(r['超期原因']);

    // 节点时间：无法解析 → warning + null，绝不补齐
    for (const nd of NODES) {
      const raw = r[nd.cn];
      const t = C.normDateTime(raw);
      if (C.str(raw) && !t) warnings.push(`工作表「${r._sheet}」第${r._row}行 工单「${no}」${nd.cn}「${C.str(raw)}」无法解析，该节点按缺失处理`);
      o[nd.key] = t;
    }
    const dueRaw = r['要求完成时间'];
    o.dueAt = C.normDate(dueRaw);
    if (C.str(dueRaw) && !o.dueAt) warnings.push(`工作表「${r._sheet}」第${r._row}行 工单「${no}」要求完成时间「${C.str(dueRaw)}」无法解析，该项按缺失处理`);

    // 节点时间倒序校验：只 warning，不改数据
    o.timeIssues = [];
    const got = NODES.map((n) => ({ cn: n.cn, t: o[n.key] })).filter((x) => x.t);
    for (let i = 1; i < got.length; i++) {
      for (let j = 0; j < i; j++) {
        if (got[i].t < got[j].t) {
          const msg = `${got[i].cn}（${got[i].t}）早于${got[j].cn}（${got[j].t}）`;
          o.timeIssues.push(msg);
          warnings.push(`工作表「${r._sheet}」第${r._row}行 工单「${no}」节点时间倒序：${msg}，已原样保留，请核实台账`);
        }
      }
    }
    if (o.dueAt && o.reportAt && o.dueAt < o.reportAt.slice(0, 10)) {
      const msg = `要求完成时间（${o.dueAt}）早于报修时间（${o.reportAt}）`;
      o.timeIssues.push(msg);
      warnings.push(`工作表「${r._sheet}」第${r._row}行 工单「${no}」${msg}，已原样保留，请核实台账`);
    }

    if (!o.status) {
      warnings.push(`工作表「${r._sheet}」第${r._row}行 工单「${no}」状态「${o.rawStatus || '（空）'}」不在 SAP 系统状态/六态枚举内（${STATUS_ENUM.join('/')}），已单列未知状态，不做就近映射`);
      unknownStatus.push({
        no: o.no, row: r._row, tag: o.tag, name: o.name, rawStatus: o.rawStatus, vendor: o.vendor, owner: o.owner,
        reason: o.rawStatus ? '状态取值不在规定枚举内' : '状态为空',
        source: `${r._sheet} 第${r._row}行`,
      });
    }
    orders.push(o);
  }
  if (!orders.length) throw new Error('工单台账中没有可用的工单记录（工单号全部为空或表中无数据行）');

  // ---- 范围过滤（承修单位/工作中心 / 责任人）
  let scoped = orders;
  if (a.vendor) {
    scoped = scoped.filter((o) => o.vendor.includes(a.vendor));
    if (!scoped.length) warnings.push(`按承修单位「${a.vendor}」过滤后无工单，请核实名称`);
  }
  if (a.owner) {
    scoped = scoped.filter((o) => o.owner.includes(a.owner));
    if (!scoped.length) warnings.push(`按责任人「${a.owner}」过滤后无工单，请核实名称`);
  }
  // 未知状态清单随过滤范围收敛，避免计数与范围不一致
  const scopedNos = new Set(scoped.map((o) => `${o.no}#${o.row}`));
  const unknownScoped = unknownStatus.filter((x) => scopedNos.has(`${x.no}#${x.row}`));

  // ---- 逐单计算：超期、停滞、临期、时长
  const overdue = [], stalled = [], dueSoon = [], closed = [];
  const inRange = (d) => {
    if (!d) return false;
    const day = d.slice(0, 10);
    if (C.diffDays(day, date) > 0) return false;
    if (from && C.diffDays(day, from) < 0) return false;
    return true;
  };
  const partyOf = (o) => [o.vendor, o.owner].filter(Boolean).join(' / ') || '（未填写责任方）';

  for (const o of scoped) {
    if (!o.status) continue;                   // 未知状态不参与任何判定，单列
    const open = isOpen(o.status);

    // 生效的要求完成时间：台账有则用，无则按 报修时间 + 时限类别时限 推算（并注明依据）
    let effDue = o.dueAt, dueBasis = null;
    if (effDue) dueBasis = '台账要求完成时间';
    else if (o.reportAt && o.category) {
      effDue = C.addDays(o.reportAt.slice(0, 10), sla[o.category]);
      dueBasis = `推算：报修时间 ${o.reportAt.slice(0, 10)} + 「${o.category}」时限 ${sla[o.category]} 天（类别来源：${o.categoryBasis}；${slaOfficial ? '厂内口径' : '脚本默认口径'}）`;
    }
    o.effDue = effDue;
    o.dueBasis = dueBasis;

    // 闭环时长：报修 → 验收（无验收时间则取完工时间）；任一节点缺失 → null，绝不按当前时间补齐
    const closeAt = o.acceptAt || o.finishAt;
    o.closeAt = closeAt;
    o.cycleDays = (o.reportAt && closeAt) ? C.diffDays(closeAt.slice(0, 10), o.reportAt.slice(0, 10)) : null;
    o.respondDays = (o.reportAt && o.assignAt) ? C.diffDays(o.assignAt.slice(0, 10), o.reportAt.slice(0, 10)) : null;
    o.repairDays = (o.startAt && o.finishAt) ? C.diffDays(o.finishAt.slice(0, 10), o.startAt.slice(0, 10)) : null;

    // 是否在时限内完成：缺 effDue 或缺闭环时间 → null（未判定），不按达标也不按超标
    if (o.status === '已闭环') {
      o.onTime = (effDue && closeAt) ? (closeAt.slice(0, 10) <= effDue) : null;
    } else o.onTime = null;

    const common = () => ({
      no: o.no, notifNo: o.notifNo || '', tag: o.tag, equipNo: o.equipNo || '', name: o.name, status: o.status,
      priority: o.priority, priorityCn: o.priority ? PRIO_CN[o.priority] : '', rawPriority: o.rawPriority,
      orderType: o.rawType || '', category: o.category, categoryBasis: o.categoryBasis,
      vendor: o.vendor || '', owner: o.owner || '', party: partyOf(o),
      source: `${o.sheet} 第${o.row}行`,
    });

    // 超期：未闭环且当前日期 > 要求完成时间
    if (open) {
      if (effDue && C.diffDays(date, effDue) > 0) {
        overdue.push(Object.assign(common(), {
          fault: o.fault, reportAt: o.reportAt, dueAt: effDue, dueBasis,
          overdueDays: C.diffDays(date, effDue), reason: o.reason || '原因未记录',
        }));
      } else if (effDue && C.diffDays(effDue, date) >= 0 && C.diffDays(effDue, date) <= dueSoonDays) {
        dueSoon.push(Object.assign(common(), { dueAt: effDue, dueBasis, daysLeft: C.diffDays(effDue, date) }));
      }

      // 停滞：最后一个有值的节点时间距截止日期超过阈值
      let lastNode = null, lastCn = null;
      for (const nd of NODES) if (o[nd.key]) { lastNode = o[nd.key]; lastCn = nd.cn; }
      if (lastNode) {
        const idle = C.diffDays(date, lastNode.slice(0, 10));
        if (idle !== null && idle >= stallDays) {
          stalled.push(Object.assign(common(), { lastNode: lastCn, lastTime: lastNode, idleDays: idle, reason: o.reason || '原因未记录' }));
        }
      } else {
        warnings.push(`工单「${o.no}」（${o.sheet} 第${o.row}行）全部节点时间均缺失，无法判定是否停滞，已列入未判定`);
        o.stallUndetermined = true;
      }
    }

    if (o.status === '已闭环' && inRange(closeAt)) {
      closed.push(Object.assign(common(), {
        reportAt: o.reportAt, closeAt, closeField: o.acceptAt ? '验收时间' : '完工时间',
        cycleDays: o.cycleDays, dueAt: effDue, dueBasis, onTime: o.onTime,
      }));
    }
  }

  // ---- 停滞未判定（节点时间全缺）
  const stallUndetermined = scoped
    .filter((o) => o.stallUndetermined)
    .map((o) => ({ no: o.no, tag: o.tag, name: o.name, status: o.status, reason: '全部节点时间缺失，无法计算停滞天数', source: `${o.sheet} 第${o.row}行` }));

  // ---- 状态分布
  const known = scoped.filter((o) => o.status);
  const byStatus = STATUS_ENUM.map((st) => ({ status: st, count: known.filter((o) => o.status === st).length }));
  const openCount = known.filter((o) => isOpen(o.status)).length;

  // ---- 指标
  const closedAll = known.filter((o) => o.status === '已闭环');
  const cancelled = known.filter((o) => o.status === '已取消');
  const denom = known.length - cancelled.length;                       // 完成率分母剔除已取消
  const closeRate = denom > 0 ? C.round((closedAll.length / denom) * 100, 1) : null;
  const cyc = closedAll.map((o) => o.cycleDays).filter((v) => v !== null);
  const avgCycle = cyc.length ? C.round(cyc.reduce((s, v) => s + v, 0) / cyc.length, 1) : null;
  const cycleUnavailable = closedAll.length - cyc.length;
  if (cycleUnavailable > 0) warnings.push(`${cycleUnavailable} 张已闭环工单因报修时间或完工/验收时间缺失，无法计算闭环时长，未计入平均值（不按当前时间补齐）`);

  // 按时限类别达标（抢修 / 一般 / 计划性）
  const byCategory = CAT_ENUM.map((p) => {
    const g = known.filter((o) => o.category === p);
    const gClosed = g.filter((o) => o.status === '已闭环');
    const judged = gClosed.filter((o) => o.onTime !== null);
    const ok = judged.filter((o) => o.onTime === true).length;
    const gCyc = gClosed.map((o) => o.cycleDays).filter((v) => v !== null);
    return {
      category: p, slaDays: sla[p], total: g.length, closed: gClosed.length,
      judged: judged.length, onTime: ok,
      onTimeRate: judged.length ? C.round((ok / judged.length) * 100, 1) : null,
      undetermined: gClosed.length - judged.length,
      avgCycleDays: gCyc.length ? C.round(gCyc.reduce((s, v) => s + v, 0) / gCyc.length, 1) : null,
      overdue: overdue.filter((x) => x.category === p).length,
    };
  });
  const noCategory = known.filter((o) => !o.category);
  const byPriority = PRIO_KEYS.map((k) => ({ priority: k, priorityCn: PRIO_CN[k], total: known.filter((o) => o.priority === k).length, overdue: overdue.filter((x) => x.priority === k).length }));
  const noPriority = known.filter((o) => !o.priority);
  const byType = {};
  for (const o of known) { const k = o.rawType || '（未填写）'; byType[k] = (byType[k] || 0) + 1; }

  const counts = {
    total: scoped.length,
    known: known.length,
    unknownStatus: unknownScoped.length,
    open: openCount,
    overdue: overdue.length,
    stalled: stalled.length,
    stallUndetermined: stallUndetermined.length,
    dueSoon: dueSoon.length,
    closedInRange: closed.length,
    closedAll: closedAll.length,
    cancelled: cancelled.length,
    noPriority: noPriority.length,
    noCategory: noCategory.length,
    duplicated: [...seen.values()].filter((v) => v > 1).length,   // 台账级数据质量计数，不随 --vendor/--owner 过滤收敛
  };

  overdue.sort((x, y) => y.overdueDays - x.overdueDays || x.no.localeCompare(y.no, 'zh'));
  stalled.sort((x, y) => y.idleDays - x.idleDays || x.no.localeCompare(y.no, 'zh'));
  dueSoon.sort((x, y) => x.daysLeft - y.daysLeft || x.no.localeCompare(y.no, 'zh'));
  closed.sort((x, y) => String(x.closeAt).localeCompare(String(y.closeAt)));

  // ---- 催办分组：按 承修单位（工作中心）/责任人
  const groupMap = new Map();
  const pushGroup = (item, kind) => {
    const key = item.party;
    if (!groupMap.has(key)) groupMap.set(key, { party: key, vendor: item.vendor, owner: item.owner, overdue: [], stalled: [] });
    groupMap.get(key)[kind].push(item);
  };
  for (const x of overdue) pushGroup(x, 'overdue');
  for (const x of stalled) pushGroup(x, 'stalled');
  const groups = [...groupMap.values()].sort((x, y) => (y.overdue.length + y.stalled.length) - (x.overdue.length + x.stalled.length) || x.party.localeCompare(y.party, 'zh'));

  const metrics = {
    closeRate, closeRateBasis: '完成率 = 已闭环 ÷（全部已知状态工单 − 已取消）；「已完成/完工/TECO」归待验收，不计入已闭环',
    avgCycleDays: avgCycle, cycleSample: cyc.length, cycleUnavailable,
    byCategory, noCategoryCount: noCategory.length,
    byPriority, noPriorityCount: noPriority.length, byType,
    slaSource, slaDays: sla, slaNote: slaOfficial ? null : DEFAULT_SLA_NOTE,
    stallDays, dueSoonDays,
  };

  // ---- 产出
  C.ensureDir(outDir);
  const result = {
    meta: {
      workshop: a.workshop, date, from: from || null,
      vendorFilter: a.vendor || null, ownerFilter: a.owner || null,
      source: path.basename(a.input), generatedAt: C.localDateTime(),
      slaSource, slaDays: sla, slaOfficial, stallDays, dueSoonDays, workshopScope: scopes,
      statusMapping: 'SAP 系统状态 CRTD/OSNO→待审核，REL/NOPR→已派工，PCNF→施工中，TECO/CNF/已完成/完工→待验收，CLSD/NOCO→已闭环，DLFL/LKD→已取消',
      disclaimer: DISCLAIMER,
    },
    counts, byStatus, overdue, stalled, stallUndetermined, dueSoon, closed,
    metrics, unknownStatus: unknownScoped, groups, warnings,
  };
  fs.writeFileSync(path.join(outDir, 'orders.json'), JSON.stringify(result, null, 2), 'utf8');

  // ---- tracking.md
  const L = [];
  const rangeCn = from ? `${from} 至 ${date}` : `截至 ${date}`;
  const slaLine = CAT_ENUM.map((c) => `${c} ${sla[c]} 天`).join('、');
  L.push(`# ${a.workshop} 维修工单跟踪（${rangeCn}）`);
  L.push('');
  if (wsNote.alert) { L.push(`**${wsNote.alert}**`); L.push(''); }
  L.push(`> ${DISCLAIMER}`);
  L.push('');
  L.push(`数据来源：${path.basename(a.input)}${a.vendor ? ` ｜ 承修单位/工作中心：${a.vendor}` : ''}${a.owner ? ` ｜ 责任人：${a.owner}` : ''}`);
  L.push(`时限口径：${slaSource}（${slaLine}）｜ 停滞阈值：${stallDays} 天 ｜ 临期窗口：${dueSoonDays} 天`);
  if (!slaOfficial) L.push(`【注意】${DEFAULT_SLA_NOTE}`);
  if (wsNote.note) L.push(wsNote.note);
  L.push(`生成时间：${C.localDateTime()}（北京时间）`);
  L.push('');
  L.push('## 一、状态分布');
  L.push('');
  L.push(C.mdTable(['状态', '工单数'], byStatus.map((x) => [x.status, x.count]).concat([
    ['未知状态（单列）', unknownScoped.length],
    ['合计', counts.total],
  ])));
  L.push('【注意】状态按 SAP 系统状态归一：CRTD/OSNO→待审核，REL/NOPR→已派工，PCNF→施工中，TECO/CNF/「已完成」「完工」→待验收，CLSD/NOCO→已闭环，DLFL/LKD→已取消。「已完成」不等于闭环，须验收关闭后才计入已闭环。');
  L.push('');
  L.push('## 二、超期工单');
  L.push('');
  if (!overdue.length) L.push('_无_\n');
  else L.push(C.mdTable(['工单号', '位号', '设备名称', '状态', '优先级', '时限类别', '要求完成', '超期天数', '责任方', '超期原因', '判定依据'],
    overdue.map((x) => [x.no, x.tag || '—', x.name || '—', x.status, x.priorityCn || '—', x.category || '—', x.dueAt, x.overdueDays, x.party, x.reason, x.dueBasis])));
  L.push('## 三、停滞工单');
  L.push('');
  L.push(`_判定口径：未闭环且最后一个有值节点距 ${date} 已 ${stallDays} 天及以上（\`--stall-days\` 可调）。_`);
  L.push('');
  if (!stalled.length) L.push('_无_\n');
  else L.push(C.mdTable(['工单号', '位号', '设备名称', '状态', '最后节点', '节点时间', '停滞天数', '责任方', '原因'],
    stalled.map((x) => [x.no, x.tag || '—', x.name || '—', x.status, x.lastNode, x.lastTime, x.idleDays, x.party, x.reason])));
  if (stallUndetermined.length) {
    L.push('**停滞未判定**（节点时间全缺，不按当前时间补齐）：');
    L.push('');
    L.push(C.mdTable(['工单号', '位号', '状态', '未判定原因', '出处'],
      stallUndetermined.map((x) => [x.no, x.tag || '—', x.status, x.reason, x.source])));
  }
  L.push('## 四、临期工单');
  L.push('');
  L.push(`_判定口径：未闭环且距要求完成时间不超过 ${dueSoonDays} 天（\`--due-soon\` 可调）。_`);
  L.push('');
  if (!dueSoon.length) L.push('_无_\n');
  else L.push(C.mdTable(['工单号', '位号', '设备名称', '状态', '优先级', '要求完成', '剩余天数', '责任方'],
    dueSoon.map((x) => [x.no, x.tag || '—', x.name || '—', x.status, x.priorityCn || '—', x.dueAt, x.daysLeft, x.party])));
  L.push('## 五、区间内闭环工单');
  L.push('');
  if (!closed.length) L.push('_无_\n');
  else L.push(C.mdTable(['工单号', '位号', '设备名称', '优先级', '报修时间', '闭环时间', '取自', '闭环时长(天)', '是否按期'],
    closed.map((x) => [x.no, x.tag || '—', x.name || '—', x.priorityCn || '—', x.reportAt || '—', x.closeAt, x.closeField,
      C.fmt(x.cycleDays), x.onTime === null ? '未判定' : (x.onTime ? '按期' : '超期')])));
  L.push('## 六、指标统计');
  L.push('');
  L.push(C.mdTable(['指标', '数值'], [
    ['工单总数', counts.total],
    ['在办（未闭环）', counts.open],
    ['已闭环', counts.closedAll],
    ['已取消', counts.cancelled],
    ['完成率', C.pct(closeRate)],
    ['平均闭环时长(天)', C.fmt(avgCycle)],
    ['闭环时长可计算样本', `${cyc.length} / ${closedAll.length}`],
    ['超期', counts.overdue],
    ['停滞', counts.stalled],
    ['临期', counts.dueSoon],
    ['未知状态', counts.unknownStatus],
  ]));
  L.push(`完成率口径：${metrics.closeRateBasis}。${cycleUnavailable > 0 ? `另有 ${cycleUnavailable} 张已闭环工单节点时间缺失，闭环时长显示「—」，未计入平均值。` : ''}`);
  L.push('');
  L.push('**按时限类别达标情况**');
  L.push('');
  L.push(C.mdTable(['时限类别', '时限(天)', '工单数', '已闭环', '可判定', '按期', '达标率', '未判定', '平均闭环(天)', '超期在办'],
    byCategory.map((x) => [x.category, x.slaDays, x.total, x.closed, x.judged, x.onTime, C.pct(x.onTimeRate), x.undetermined, C.fmt(x.avgCycleDays), x.overdue])));
  if (noCategory.length) L.push(`_另有 ${noCategory.length} 张工单无工单类型且无优先级（或取值非法），无法归入时限类别，不推算时限、不参与达标率统计。_\n`);
  L.push('**按 SAP 优先级分布**');
  L.push('');
  L.push(C.mdTable(['优先级', '工单数', '超期在办'], byPriority.map((x) => [x.priorityCn, x.total, x.overdue]).concat([['（未填写/非法）', noPriority.length, '—']])));
  L.push('## 七、未知状态工单');
  L.push('');
  L.push('_状态取值不在 SAP 系统状态与「待审核 / 已派工 / 施工中 / 待验收 / 已闭环 / 已取消」六态枚举内，一律单列，不做就近映射。_');
  L.push('');
  L.push(C.mdTable(['工单号', '位号', '设备名称', '台账原文', '责任方', '未判定原因', '出处'],
    unknownScoped.map((x) => [x.no, x.tag || '—', x.name || '—', x.rawStatus || '（空）',
      [x.vendor, x.owner].filter(Boolean).join(' / ') || '—', x.reason, x.source])));
  L.push('## 八、工单执行情况说明');
  L.push('');
  L.push('<!-- ANALYSIS_START -->');
  L.push('（由模型依据 references/tracking-rules.md 口径撰写 200~400 字，结构：总体情况 → 超期工单与原因分布 → 停滞工单 → 完成率与时长指标 → 催办重点。数量、天数、比率一律引用 orders.json；超期原因台账未记录的写「原因未记录」，不得推测。）');
  L.push('<!-- ANALYSIS_END -->');
  L.push('');
  if (warnings.length) {
    L.push('## 附：数据提示');
    L.push('');
    for (const w of warnings) L.push(`- ${w}`);
    L.push('');
  }
  fs.writeFileSync(path.join(outDir, 'tracking.md'), L.join('\n'), 'utf8');

  // ---- 催办清单.md（按责任方分组，可直接转发）
  const U = [];
  U.push(`# ${a.workshop} 维修工单催办清单（${rangeCn}）`);
  U.push('');
  if (wsNote.alert) { U.push(`**${wsNote.alert}**`); U.push(''); }
  U.push(`时限口径：${slaSource} ｜ 停滞阈值：${stallDays} 天 ｜ 生成时间：${C.localDateTime()}（北京时间）`);
  if (!slaOfficial) U.push(`【注意】${DEFAULT_SLA_NOTE}`);
  U.push('');
  U.push(`共 ${groups.length} 个责任方需催办，涉及超期 ${overdue.length} 张、停滞 ${stalled.length} 张。`);
  U.push('');
  if (!groups.length) {
    U.push('_本区间无超期或停滞工单，无需催办。_');
    U.push('');
  } else {
    let i = 0;
    for (const g of groups) {
      i++;
      U.push(`## ${i}. ${g.party}`);
      U.push('');
      U.push(`超期 ${g.overdue.length} 张 ｜ 停滞 ${g.stalled.length} 张`);
      U.push('');
      if (g.overdue.length) {
        U.push('**超期工单**');
        U.push('');
        U.push(C.mdTable(['工单号', '位号', '设备名称', '故障描述', '状态', '要求完成', '超期天数', '超期原因'],
          g.overdue.map((x) => [x.no, x.tag || '—', x.name || '—', x.fault || '—', x.status, x.dueAt, x.overdueDays, x.reason])));
      }
      if (g.stalled.length) {
        U.push('**停滞工单**');
        U.push('');
        U.push(C.mdTable(['工单号', '位号', '设备名称', '状态', '最后节点', '节点时间', '停滞天数', '原因'],
          g.stalled.map((x) => [x.no, x.tag || '—', x.name || '—', x.status, x.lastNode, x.lastTime, x.idleDays, x.reason])));
      }
    }
  }
  U.push('---');
  U.push('');
  U.push('说明：本清单由工单台账（SAP 订单导出）自动生成，超期原因取自台账「超期原因」列，台账未填写的标注为「原因未记录」，未作任何推测。请各承修单位/工作中心核实后反馈计划完成时间；本清单由车间设备员转发，不替代厂内考核与催办流程。');
  U.push('');
  fs.writeFileSync(path.join(outDir, '催办清单.md'), U.join('\n'), 'utf8');

  C.emitOk(outDir, { ok: true, out: outDir, date, from: from || null, workshop: a.workshop, counts, metrics: { closeRate, avgCycleDays: avgCycle }, slaSource, warnings });
}

try { main(); } catch (e) { C.fail(e, warnings); }
