#!/usr/bin/env node
'use strict';
/**
 * 运行小时与启停次数统计（仅 Node.js 内置模块）—— 中石化体系炼化厂车间设备员口径
 * 用法：node scripts/runtime.js --input <xlsx> --workshop "车间" --date <YYYY-MM-DD> [--out <dir>]
 * 可选：--from <起始日期> --prev <上期runtime.json> --equipment "<位号,位号>" --warn-ratio <0.9>
 * 产出：<out>/runtime.json、runtime-report.md、summary.json
 *
 * 数据来源（三选一或并存，优先级 启停记录 > 运行状态记录（时序）> 运行记录）：
 *   启停记录：一行一段（开机时间、停机时间）
 *   运行状态记录：一行一个状态点（时间、运行状态=运行/停机），脚本按状态区间折算运行小时
 *   运行记录：直接给本期运行时长
 * 阈值表：阈值类型 运行小时 / 启停次数 / 日历周期（年、月）；可带「期初累计小时」（上次大检修后累计），
 *   累计 = 期初累计 + 本期增量；无期初、无上期 JSON 时累计仅为本期增量并 warning。
 *
 * 硬约束：启停不配对不强行补停机；区间重叠/缺口不按满负荷补齐；阈值缺失不预警不臆测；
 *         阈值类型为空不默认按运行小时，判 undetermined 单列。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readXlsx, readCsvDir } = require('./lib/xlsx-lite');
const C = require('./lib/common');

const warnings = [];
const num = C.makeNum(warnings);
const VALUE_OPTS = ['input', 'workshop', 'date', 'out', 'from', 'prev', 'equipment', 'warn-ratio', 'running-until'];
const FLAG_OPTS = ['help'];

/**
 * 局部别名在前，再合并共享 SYSTEM_ALIASES（SAP PM / EM 列名：功能位置、技术对象、设备描述…）。
 * 注意：
 *  - 「设备编号」是 SAP 流水号，不是位号，局部不把它列为位号别名；合并后单独成列展示。
 *  - 「阈值类型」不再认裸「类型」，避免把「设备类型」「对象类型」列误认为阈值类型。
 *  - 「阈值」不能裸用 startsWith，否则会先命中「阈值类型」列；别名按精确度排序，裸「阈值」放最后。
 */
const ALIASES = C.mergeAliases({
  '位号': ['位号', '设备位号', 'TAG'],
  '设备名称': ['设备名称', '名称'],
  '开机时间': ['开机时间', '启动时间', '开始时间', '启机时间', '开车时间', '启动日期时间'],
  '停机时间': ['停机时间', '停止时间', '结束时间', '停车时间', '停止日期时间'],
  '运行时长': ['运行时长', '运行小时', '时长', '运行时间', '本期运行小时', '运行台时'],
  '时间': ['时间', '记录时间', '时间戳', '采集时间', '日期时间', '状态时间', '时刻'],
  '运行状态': ['运行状态', '开停状态', '开停机状态', '机组状态', '设备状态', '状态'],
  '阈值类型': ['阈值类型', '指标类型', '周期类型', '阈值种类', '周期种类'],
  '阈值': ['阈值值', '限值', '阈值上限', '周期值', '检修周期', '大修周期', '更换周期', '阈值'],
  '上次归零日期': ['上次归零日期', '归零日期', '上次大检修日期', '上次大修日期', '上次检修日期', '上次更换日期', '起算日期'],
  '部件': ['部件', '部位', '对象'],
  '期初累计小时': ['期初累计小时', '期初累计', '上次大修后累计', '上次大检修后累计', '基数小时', '累计基数', '期初小时', '累计运行小时基数'],
  '期初累计启停': ['期初累计启停', '期初启停次数', '启停基数', '累计启停基数'],
});
// 车间范围核对（D007）：「车间」只认 车间/所属车间/属地车间/运行部（及其后加「名称」），覆盖共享别名，
// 不让维护工厂/属地单位/使用单位/作业部占用「车间」字段；'车间' 放在各表 optional 列最后，避免抢走别的列
ALIASES['车间'] = [...C.WORKSHOP_COLS, ...C.WORKSHOP_COLS.map((c) => c + '名称')];

function loadBook(p) { return fs.statSync(p).isDirectory() ? readCsvDir(p) : readXlsx(p); }
/** 时间戳 → 毫秒；无法解析返回 null */
function ts(v) {
  const s = C.normDateTime(v);
  return s ? Date.parse(s.replace(' ', 'T') + ':00+08:00') : null;
}
const H = 3600000;

/** 运行状态归一：'run' | 'stop' | null */
const RUN_WORDS = ['运行', '开机', '启动', '开车', '启机', '在运', '运转', 'RUN', 'RUNNING', 'ON', 'START', '1'];
const STOP_WORDS = ['停机', '停车', '停止', '停运', '停', '备用', '检修', '停用', '待机', 'STOP', 'STOPPED', 'OFF', '0'];
function normRunState(v) {
  const s = C.str(v).replace(/\s/g, '');
  if (!s) return null;
  const up = s.toUpperCase();
  if (STOP_WORDS.some((w) => up === w.toUpperCase())) return 'stop';
  if (RUN_WORDS.some((w) => up === w.toUpperCase())) return 'run';
  if (/停|备用|检修|OFF/i.test(up)) return 'stop';
  if (/运行|开|启|RUN|ON/i.test(up)) return 'run';
  return null;
}

/**
 * 阈值类型归类：'hours' 运行小时 | 'starts' 启停次数 | 'calendar' 日历周期 | null 无法判定
 * 先看阈值类型文字，再看阈值取值写法（"8000h" → 运行小时；"3年" → 日历）；都判不出 → null（不默认按运行小时）。
 */
function thresholdKind(typeText, rawValue) {
  const t = C.str(typeText);
  if (/启停|次数|启动/.test(t)) return 'starts';
  if (/日历|年|月|季|天|日/.test(t)) return 'calendar';
  if (/小时|运行|台时|hour|^h$/i.test(t)) return 'hours';
  const rv = C.str(rawValue);
  if (C.parseRunHours(rv) !== null) return 'hours';
  const pd = C.parsePeriodDetail(rv);
  if (pd && /^(年|月|季|天|半年)$/.test(pd.unit) && /[年月季天日]/.test(rv)) return 'calendar';
  return null;
}
/** 日历周期取值 → 自然月数（优先）或天数；返回 {months, days} 或 null */
function calendarSpan(typeText, rawValue) {
  const rv = C.str(rawValue);
  const pd = C.parsePeriodDetail(rv);
  if (pd && /[年月季天日周]/.test(rv)) {
    if (pd.unit === '年') return { months: Math.round(pd.days / 365 * 12), days: null, text: rv };
    if (pd.unit === '半年') return { months: 6, days: null, text: rv };
    if (pd.unit === '月') return { months: Math.round(pd.days / 30), days: null, text: rv };
    if (pd.unit === '季') return { months: Math.round(pd.days / 90) * 3, days: null, text: rv };
    return { months: null, days: pd.days, text: rv };
  }
  // 纯数字：单位取阈值类型文字里的（年/月/天）
  const n = Number(rv.replace(/[,，\s]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return null;
  const t = C.str(typeText);
  if (/年/.test(t)) return { months: Math.round(n * 12), days: null, text: `${n}年` };
  if (/月/.test(t)) return { months: Math.round(n), days: null, text: `${n}个月` };
  if (/季/.test(t)) return { months: Math.round(n * 3), days: null, text: `${n}季` };
  if (/天|日/.test(t)) return { months: null, days: Math.round(n), text: `${n}天` };
  return null;
}

function main() {
  const a = C.parseArgs(process.argv.slice(2), VALUE_OPTS, FLAG_OPTS);
  if (!a.input) throw new Error('缺少 --input');
  if (!fs.existsSync(a.input)) throw new Error(`输入不存在: ${a.input}`);
  if (!a.workshop) throw new Error('缺少 --workshop');
  if (!a.date) throw new Error('缺少 --date');
  const date = C.normDate(a.date);
  if (!date) throw new Error(`--date 「${a.date}」不是有效日期，应为 YYYY-MM-DD`);
  const from = a.from ? C.normDate(a.from) : null;
  if (a.from && !from) throw new Error(`--from 「${a.from}」不是有效日期`);
  if (from && C.diffDays(date, from) < 0) throw new Error(`--from（${from}）晚于 --date（${date}）`);
  const warnRatio = a['warn-ratio'] ? Number(a['warn-ratio']) : 0.9;
  if (a['warn-ratio'] && (!Number.isFinite(warnRatio) || warnRatio <= 0 || warnRatio > 1)) {
    throw new Error(`--warn-ratio 「${a['warn-ratio']}」应为 0~1 之间的数字`);
  }
  // --running-until：数据源以「停机时间为空」表示仍在运行（如 DCS 启停记录）时，显式给截止时刻才把该段计到此刻；不给则按不配对单列
  const runningUntil = a['running-until'] ? C.normDateTime(a['running-until']) : null;
  if (a['running-until'] && !runningUntil) throw new Error(`--running-until 「${a['running-until']}」不是有效时间，应为 YYYY-MM-DD HH:mm`);
  if (runningUntil && C.diffDays(date, runningUntil.slice(0, 10)) < 0) throw new Error(`--running-until（${runningUntil}）晚于 --date（${date}）当天`);
  const runUntilMs = runningUntil ? ts(runningUntil) : null;
  const openRunning = [];
  const only = a.equipment ? new Set(a.equipment.split(/[,，]/).map((x) => x.trim()).filter(Boolean)) : null;
  const outDir = a.out || path.join(os.tmpdir(), 'rht-out');

  const book = loadBook(a.input);

  // ---- 三种来源：启停记录 > 运行状态记录（时序）> 运行记录
  const startEnd = C.pickSheet(book, '启停记录', '开停机记录', '开停车记录', '启停');
  const seriesRows = C.pickSheet(book, '运行状态记录', '状态时序', '状态记录', '运行状态', '开停状态');
  let runRows = C.pickSheet(book, '运行记录', '运行时长记录', '运行台时', '运行');
  // 「运行」包含匹配会命中「运行状态记录」，同一张表不能同时当两种来源
  if (runRows && (runRows === seriesRows || runRows === startEnd)) runRows = null;
  if (!startEnd && !seriesRows && !runRows) throw new Error('未找到「启停记录」「运行状态记录」或「运行记录」工作表');

  const scopes = [];   // 车间范围核对结果：启停记录/运行状态记录/运行记录/阈值表各一条（有该表时）
  const scoped = (recs, sheet) => { const w = C.workshopScope(recs, a.workshop, sheet, warnings); scopes.push(w.scope); return w.records; };
  const perEquip = new Map();   // tag -> {name, code, segments:[], starts:0, incomplete:[]}
  const ensure = (tag, name, code) => {
    if (!perEquip.has(tag)) perEquip.set(tag, { tag, name: name || '', code: code || '', segments: [], starts: 0, incomplete: [], rawHours: null, sources: new Set() });
    const e = perEquip.get(tag);
    if (!e.name && name) e.name = name;
    if (!e.code && code) e.code = code;
    return e;
  };

  if (startEnd) {
    const recs = scoped(C.toRecords(startEnd, ['位号'], '启停记录', ['设备名称', '设备编号', '开机时间', '停机时间', '车间'], warnings, ALIASES), '启停记录');
    // --running-until 只认每台设备时间上最后一段：开机时间最晚、且其后该台再无任何开机记录（含同一时刻）或停机记录（不含同一时刻）的那一条空停机行
    // 上一段停机时刻正好等于本段开机时刻（同一时刻停机又开机、或只写日期）是首尾相接，本段仍是最后一段
    const lastOpenRow = new Map();   // tag -> _row
    if (runUntilMs !== null) {
      const byTag = new Map();
      for (const r of recs) {
        const tag = C.str(r['位号']);
        if (!tag || (only && !only.has(tag))) continue;
        if (!byTag.has(tag)) byTag.set(tag, []);
        byTag.get(tag).push({ row: r._row, s: ts(r['开机时间']), t: ts(r['停机时间']), hasT: C.str(r['停机时间']) !== '' });
      }
      for (const [tag, list] of byTag) {
        const opens = list.filter((x) => x.s !== null && !x.hasT);
        if (!opens.length) continue;
        const cand = opens.reduce((m, x) => (x.s > m.s ? x : m));
        const later = list.some((x) => x !== cand && ((x.s !== null && x.s >= cand.s) || (x.t !== null && x.t > cand.s)));
        if (!later) lastOpenRow.set(tag, cand.row);
      }
    }
    for (const r of recs) {
      const tag = C.str(r['位号']);
      if (!tag) { warnings.push(`工作表「启停记录」第${r._row}行 位号为空，已跳过`); continue; }
      if (only && !only.has(tag)) continue;
      const e = ensure(tag, C.str(r['设备名称']), C.str(r['设备编号']));
      e.sources.add('启停记录');
      const s = ts(r['开机时间']), t = ts(r['停机时间']);
      const hasS = C.str(r['开机时间']) !== '', hasT = C.str(r['停机时间']) !== '';
      if (hasS && s === null) warnings.push(`工作表「启停记录」第${r._row}行 开机时间「${C.str(r['开机时间'])}」无法解析`);
      if (hasT && t === null) warnings.push(`工作表「启停记录」第${r._row}行 停机时间「${C.str(r['停机时间'])}」无法解析`);
      if (s !== null) e.starts++;
      if (s !== null && t !== null) {
        if (t < s) {
          warnings.push(`工作表「启停记录」第${r._row}行 设备「${tag}」停机时间早于开机时间，已原样保留并单列，未参与累计`);
          e.incomplete.push({ row: r._row, start: C.normDateTime(r['开机时间']), end: C.normDateTime(r['停机时间']), reason: '停机时间早于开机时间' });
        } else {
          e.segments.push({ s, t, row: r._row });
        }
      } else if (s !== null && !hasT && runUntilMs !== null && s < runUntilMs && lastOpenRow.get(tag) === r._row) {
        // 停机时间为空 = 截至 --running-until 仍在运行（用户显式声明的数据口径），计到该时刻，不补停机记录；只认该台时间上最后一段
        e.segments.push({ s, t: runUntilMs, row: r._row, open: true });
        openRunning.push({ tag, src: '启停记录' });
      } else if (s !== null || t !== null) {
        // 只有启或只有停 → 不配对，绝不按截止时间补
        const notLast = s !== null && !hasT && runUntilMs !== null && s < runUntilMs;
        e.incomplete.push({ row: r._row, start: s !== null ? C.normDateTime(r['开机时间']) : null,
          end: t !== null ? C.normDateTime(r['停机时间']) : null,
          reason: s === null ? '只有停机时间，无开机时间'
            : notLast ? '只有开机时间，无停机时间；其后该台还有开停记录，不是最后一段运行，未按 --running-until 计入（未按截止时间补停机）'
              : '只有开机时间，无停机时间（未按截止时间补停机）' });
        warnings.push(`工作表「启停记录」第${r._row}行 设备「${tag}」启停记录不配对，已单列，**未按截止时间强行补一次停机**`);
      }
    }
  }

  // ---- 运行状态记录（时序）：按状态变化折算区间
  if (seriesRows) {
    const recs = scoped(C.toRecords(seriesRows, ['位号', '时间', '运行状态'], '运行状态记录', ['设备名称', '设备编号', '车间'], warnings, ALIASES), '运行状态记录');
    const byTag = new Map();
    for (const r of recs) {
      const tag = C.str(r['位号']);
      if (!tag) { warnings.push(`工作表「运行状态记录」第${r._row}行 位号为空，已跳过`); continue; }
      if (only && !only.has(tag)) continue;
      const t = ts(r['时间']);
      if (t === null) { warnings.push(`工作表「运行状态记录」第${r._row}行 时间「${C.str(r['时间'])}」无法解析，已跳过`); continue; }
      const st = normRunState(r['运行状态']);
      if (st === null) { warnings.push(`工作表「运行状态记录」第${r._row}行 运行状态「${C.str(r['运行状态'])}」无法识别为运行/停机，已跳过`); continue; }
      if (!byTag.has(tag)) byTag.set(tag, { name: C.str(r['设备名称']), code: C.str(r['设备编号']), pts: [] });
      byTag.get(tag).pts.push({ t, st, row: r._row, text: C.normDateTime(r['时间']) });
    }
    for (const [tag, g] of byTag) {
      if (perEquip.has(tag) && perEquip.get(tag).sources.has('启停记录')) {
        warnings.push(`设备「${tag}」同时存在启停记录与运行状态记录，以启停记录为准，运行状态记录未参与累计`);
        continue;
      }
      const e = ensure(tag, g.name, g.code);
      e.sources.add('运行状态记录');
      g.pts.sort((x, y) => x.t - y.t);
      let open = null;
      for (const p of g.pts) {
        if (p.st === 'run') {
          if (open) continue;                         // 连续两条"运行"：视为同一段，不重复计启动
          open = p; e.starts++;
        } else {
          if (!open) {
            e.incomplete.push({ row: p.row, start: null, end: p.text, reason: '状态记录首条为停机，无对应开机记录' });
            continue;
          }
          e.segments.push({ s: open.t, t: p.t, row: open.row });
          open = null;
        }
      }
      if (open && runUntilMs !== null && open.t < runUntilMs) {
        e.segments.push({ s: open.t, t: runUntilMs, row: open.row, open: true });
        openRunning.push({ tag, src: '运行状态记录' });
      } else if (open) {
        e.incomplete.push({ row: open.row, start: open.text, end: null, reason: '状态记录末条为运行，无后续停机记录（未按截止时间补停机）' });
        warnings.push(`工作表「运行状态记录」设备「${tag}」第${open.row}行之后无停机记录，该段已单列，**未按截止时间强行补一次停机**`);
      }
    }
  }

  if (runRows) {
    const recs = scoped(C.toRecords(runRows, ['位号'], '运行记录', ['设备名称', '设备编号', '运行时长', '车间'], warnings, ALIASES), '运行记录');
    for (const r of recs) {
      const tag = C.str(r['位号']);
      if (!tag) { warnings.push(`工作表「运行记录」第${r._row}行 位号为空，已跳过`); continue; }
      if (only && !only.has(tag)) continue;
      const e = ensure(tag, C.str(r['设备名称']), C.str(r['设备编号']));
      e.sources.add('运行记录');
      const h = num(r['运行时长'], { sheet: '运行记录', row: r._row, col: '运行时长' });
      if (h !== null) e.rawHours = C.round((e.rawHours || 0) + h, 2);
    }
  }
  if (openRunning.length) {
    const tagsOf = (src) => [...new Set(openRunning.filter((x) => x.src === src).map((x) => x.tag))];
    const parts = [];
    if (tagsOf('启停记录').length) parts.push(`启停记录中该台时间上最后一段、停机时间为空：${tagsOf('启停记录').join('、')}`);
    if (tagsOf('运行状态记录').length) parts.push(`运行状态记录末条为运行：${tagsOf('运行状态记录').join('、')}`);
    warnings.push(`以下设备的当前运行段按「截至 ${runningUntil} 仍在运行」计入（--running-until）——${parts.join('；')}；未补停机记录，请核实这些设备确在运行`);
  }
  if (!perEquip.size) throw new Error(only ? `指定的设备范围内没有记录` : '没有可统计的设备记录');

  // ---- 区间重叠与缺口检测（不补齐）
  for (const e of perEquip.values()) {
    e.segments.sort((x, y) => x.s - y.s);
    e.overlaps = []; e.idleIntervals = [];
    // 与所有尚未结束的段逐一比较（不只比相邻两段或结束最晚的一段）：长段覆盖其后多段、被覆盖的段之间又互相重叠时，每一对都检出
    let maxSeg = e.segments[0];
    for (let i = 1; i < e.segments.length; i++) {
      const prev = maxSeg, cur = e.segments[i];
      const active = e.segments.slice(0, i).filter((x) => cur.s < x.t);
      if (cur.t > maxSeg.t) maxSeg = cur;
      if (active.length) {
        for (const p of active) {
          e.overlaps.push({ rows: [p.row, cur.row], note: '时间区间重叠，两段均按原样累计，未去重也未合并' });
          warnings.push(`设备「${e.tag}」第${p.row}行与第${cur.row}行运行区间重叠，已原样保留，请核实台账`);
        }
      }
      // 两段运行之间的间隔是正常停机，不是数据缺口；只记录供参考，不作为数据质量问题呈现。
      else if (cur.s > prev.t) {
        e.idleIntervals.push({ from: new Date(prev.t).toISOString(), to: new Date(cur.s).toISOString(),
          hours: C.round((cur.s - prev.t) / H, 2) });
      }
    }
    const segH = e.segments.reduce((n, x) => n + (x.t - x.s) / H, 0);
    e.hoursFromSegments = e.segments.length ? C.round(segH, 2) : null;
    if (e.hoursFromSegments !== null && e.rawHours !== null) {
      warnings.push(`设备「${e.tag}」同时存在启停/状态记录与运行记录，累计以启停/状态记录为准（${e.hoursFromSegments}h），运行记录值（${e.rawHours}h）仅作参考`);
    }
    e.hours = e.hoursFromSegments !== null ? e.hoursFromSegments : e.rawHours;
  }

  // ---- 阈值表
  const thRows = C.pickSheet(book, '阈值表', '阈值', '周期阈值', '检修周期');
  const thresholds = new Map();   // tag -> [{kind, type, value, base, part, baseHours, baseStarts, ...}]
  const thNames = new Map();      // tag -> 阈值表里的设备名称（给本期无运行记录的设备用）
  if (thRows) {
    // 阈值表不只是查找表：表里有、本期无运行记录的设备也会列入明细，所以同样按车间核对
    const recs = scoped(C.toRecords(thRows, ['位号'], '阈值表', ['设备名称', '阈值类型', '阈值', '上次归零日期', '部件', '期初累计小时', '期初累计启停', '车间'], warnings, ALIASES), '阈值表');
    for (const r of recs) {
      const tag = C.str(r['位号']); if (!tag) continue;
      if (only && !only.has(tag)) continue;
      if (!thNames.has(tag) && C.str(r['设备名称'])) thNames.set(tag, C.str(r['设备名称']));
      const type = C.str(r['阈值类型']);
      const raw = r['阈值'];
      const part = C.str(r['部件']);
      const base = C.normDate(r['上次归零日期']);
      const baseHours = recs.hasCol('期初累计小时') ? num(r['期初累计小时'], { sheet: '阈值表', row: r._row, col: '期初累计小时' }) : null;
      const baseStarts = recs.hasCol('期初累计启停') ? num(r['期初累计启停'], { sheet: '阈值表', row: r._row, col: '期初累计启停' }) : null;
      const item = { row: r._row, type: type || '（空）', part, base, baseHours, baseStarts, kind: null, value: null, span: null, undeterminedReason: null };
      if (C.str(raw) === '') {
        item.undeterminedReason = '阈值为空';
        warnings.push(`工作表「阈值表」第${r._row}行 设备「${tag}」阈值为空，该项不预警`);
      } else {
        const kind = thresholdKind(type, raw);
        if (kind === null) {
          item.undeterminedReason = type ? `阈值类型「${type}」无法归入 运行小时/启停次数/日历周期` : '阈值类型为空且阈值取值无单位，无法判断按运行小时、启停次数还是日历周期比对（不默认按运行小时）';
          warnings.push(`工作表「阈值表」第${r._row}行 设备「${tag}」${item.undeterminedReason}，该项判为未判定，不预警`);
        } else if (kind === 'calendar') {
          item.kind = 'calendar';
          item.span = calendarSpan(type, raw);
          if (!item.span) {
            item.undeterminedReason = `日历周期「${C.str(raw)}」无法解析`;
            warnings.push(`工作表「阈值表」第${r._row}行 设备「${tag}」${item.undeterminedReason}，该项不预警`);
          } else if (!base) {
            item.undeterminedReason = '日历周期阈值缺「上次归零日期」（上次大检修/更换日期），无法计算到期日';
            warnings.push(`工作表「阈值表」第${r._row}行 设备「${tag}」${item.undeterminedReason}，该项判为未判定`);
          }
        } else {
          item.kind = kind;
          let v = kind === 'hours' ? C.parseRunHours(raw) : null;
          if (v === null) v = num(raw, { sheet: '阈值表', row: r._row, col: '阈值' });
          if (v === null) {
            item.undeterminedReason = `阈值「${C.str(raw)}」无法解析`;
            warnings.push(`工作表「阈值表」第${r._row}行 设备「${tag}」阈值无法解析，该项不预警`);
          } else item.value = v;
        }
      }
      if (!thresholds.has(tag)) thresholds.set(tag, []);
      thresholds.get(tag).push(item);
    }
    if (!recs.hasCol('期初累计小时')) warnings.push('「阈值表」未提供「期初累计小时」列，累计运行小时仅为本期增量（或上期 JSON 续算），不代表自上次大检修以来的累计');
  } else {
    warnings.push('未提供「阈值表」，只统计不做阈值预警');
  }
  // 阈值表里有、但本期启停/状态/运行记录里没有的设备（如备机）：照常列出，本期 0h、0 次，累计 = 期初（或上期）值，照常判阈值，注明本期无运行记录
  const noRunTags = [...thresholds.keys()].filter((tag) => !perEquip.has(tag));
  for (const tag of noRunTags) {
    const e = ensure(tag, thNames.get(tag) || '', '');
    Object.assign(e, { hours: 0, hoursFromSegments: null, overlaps: [], idleIntervals: [], noRunRecord: true });
  }
  if (noRunTags.length) warnings.push(`以下设备在阈值表中，但本期记录里没有任何开停或运行数据，按本期无运行记录（本期 0h、0 次）列出，累计取期初/上期值照常判阈值：${noRunTags.join('、')}；如实际有运行，请补导该台的启停记录`);

  // ---- 上期累计续算
  let prevMap = null;
  if (a.prev) {
    if (!fs.existsSync(a.prev)) throw new Error(`上期 runtime.json 不存在: ${a.prev}`);
    let prev; try { prev = JSON.parse(fs.readFileSync(a.prev, 'utf8')); } catch (e) { throw new Error(`上期 runtime.json 解析失败: ${e.message}`); }
    prevMap = new Map((prev.byEquipment || []).map((x) => [x.tag, x]));
    // 上期截止日不早于本期最早运行段：续算会把重叠时段重复计入（脚本不自动裁剪，提示用户只导出上期之后的记录）
    const prevDate = prev.meta && C.normDate(prev.meta.date);
    const starts = [...perEquip.values()].flatMap((e) => e.segments.map((x) => x.s));
    if (prevDate && starts.length) {
      const earliest = new Date(Math.min(...starts) + 8 * H).toISOString().slice(0, 10);
      if (C.diffDays(prevDate, earliest) >= 0) warnings.push(`上期 runtime.json 截止 ${prevDate}，本期记录含 ${earliest} 起的运行段（不晚于上期截止日），续算会把重叠时段重复计入；请只导出上期截止日之后的启停记录再续算`);
    }
  }

  // ---- 汇总
  const byEquipment = [], dueSoon = [], exceeded = [], undetermined = [], incomplete = [];
  const dateMs = Date.parse(date + 'T00:00:00+08:00');
  for (const e of perEquip.values()) {
    const prev = prevMap ? prevMap.get(e.tag) : null;
    const ths = thresholds.get(e.tag) || [];
    // 设备级期初累计：优先取部件为空/整机/机组的行，否则第一条有期初值的行
    const baseRow = ths.find((t) => t.baseHours !== null && (!t.part || /整机|机组|本体/.test(t.part))) || ths.find((t) => t.baseHours !== null);
    const equipBaseHours = baseRow ? baseRow.baseHours : null;
    const baseStartRow = ths.find((t) => t.baseStarts !== null);
    const equipBaseStarts = baseStartRow ? baseStartRow.baseStarts : null;
    let cumBasis, cumHours, cumStarts;
    if (prev) {
      if (equipBaseHours !== null) warnings.push(`设备「${e.tag}」同时提供了上期 JSON 与「期初累计小时」，累计以上期 JSON 续算为准，期初值未重复计入`);
      cumBasis = 'prev';
      const prevH = typeof prev.cumHours === 'number' && Number.isFinite(prev.cumHours) ? prev.cumHours : null;
      // 上期累计小时为空：无法续算，累计记 null 判未判定，不按 0 续算（否则只剩本期增量却标「上期续算」）
      if (prevH === null) warnings.push(`设备「${e.tag}」上期 runtime.json 中累计运行小时为空，无法续算，本期累计记为未判定（未按 0 续算）`);
      cumHours = prevH === null ? null : (e.hours === null ? prevH : C.round(prevH + e.hours, 2));
      // 上期累计启停为空：同样不按 0 续算，记 null（未判定）
      const prevS = typeof prev.cumStarts === 'number' && Number.isFinite(prev.cumStarts) ? prev.cumStarts : null;
      if (prevS === null) warnings.push(`设备「${e.tag}」上期 runtime.json 中累计启停次数为空，无法续算，本期累计启停记为未判定（未按 0 续算）`);
      cumStarts = prevS === null ? null : prevS + e.starts;
    } else if (equipBaseHours !== null) {
      cumBasis = 'base';
      cumHours = e.hours === null ? equipBaseHours : C.round(equipBaseHours + e.hours, 2);
      cumStarts = (equipBaseStarts !== null ? equipBaseStarts : 0) + e.starts;
    } else {
      cumBasis = 'periodOnly';
      cumHours = e.hours;
      cumStarts = (equipBaseStarts !== null ? equipBaseStarts : 0) + e.starts;
      if (ths.some((t) => t.kind === 'hours')) warnings.push(`设备「${e.tag}」未提供期初累计小时，运行小时阈值按本期增量比对，可能低估累计（请在阈值表补「期初累计小时」或传 --prev）`);
    }
    const checks = ths.map((t) => {
      const out = { type: t.type, kind: t.kind, part: t.part, base: t.base, baseHours: t.baseHours, row: t.row,
        threshold: null, thresholdText: null, current: null, remain: null, used: null, dueDate: null, basis: null, state: 'undetermined', note: null };
      if (t.undeterminedReason) { out.note = t.undeterminedReason; return out; }
      if (t.kind === 'calendar') {
        const due = t.span.months !== null ? C.addMonths(t.base, t.span.months) : C.addDays(t.base, t.span.days);
        const total = C.diffDays(due, t.base);
        const elapsed = C.diffDays(date, t.base);
        out.thresholdText = t.span.text; out.threshold = total; out.dueDate = due; out.current = elapsed;
        out.remain = C.diffDays(due, date); out.basis = 'calendar';
        if (elapsed < 0) { out.note = '上次归零日期晚于统计截止日期，无法比对'; return out; }
        out.used = total ? C.round(elapsed / total, 3) : null;
      } else {
        const cur = t.kind === 'starts'
          ? (t.baseStarts !== null ? t.baseStarts + e.starts : cumStarts)
          : (t.baseHours !== null && cumBasis !== 'prev' ? C.round(t.baseHours + (e.hours === null ? 0 : e.hours), 2) : cumHours);
        out.basis = t.kind === 'starts' ? (t.baseStarts !== null ? 'rowBase' : cumBasis)
          : (t.baseHours !== null && cumBasis !== 'prev' ? 'rowBase' : cumBasis);
        if (cur === null || (t.kind === 'hours' && e.hours === null && t.baseHours === null && !prev)) {
          out.note = '累计值无法计算（记录缺失或不可解析），不预警'; return out;
        }
        if (t.kind === 'hours' && e.hours === null) { out.note = '本期运行小时无法计算（记录缺失或不可解析），累计仅为期初/上期值，不预警'; out.current = cur; return out; }
        out.threshold = t.value; out.thresholdText = t.kind === 'starts' ? `${t.value}次` : `${t.value}h`;
        out.current = cur; out.remain = C.round(t.value - cur, 2);
        out.used = t.value ? C.round(cur / t.value, 3) : null;
      }
      out.state = out.used === null ? 'undetermined' : out.used >= 1 ? 'exceeded' : out.used >= warnRatio ? 'dueSoon' : 'normal';
      if (out.state === 'undetermined') out.note = '阈值为 0 或无法计算已用比例';
      return out;
    });
    const item = {
      tag: e.tag, name: e.name, code: e.code || null, sources: [...e.sources], noRunRecord: !!e.noRunRecord,
      periodHours: e.hours, periodStarts: e.starts,
      baseHours: equipBaseHours, cumBasis, cumHours, cumStarts, thresholds: checks,
      overlaps: e.overlaps, idleIntervals: e.idleIntervals, incompleteCount: e.incomplete.length,
    };
    byEquipment.push(item);
    for (const c of checks) {
      const row = { tag: e.tag, name: e.name, type: c.type, kind: c.kind, part: c.part, threshold: c.threshold, thresholdText: c.thresholdText,
        current: c.current, remain: c.remain, dueDate: c.dueDate, used: c.used === null ? null : C.round(c.used * 100, 1), basis: c.basis };
      if (c.state === 'exceeded') exceeded.push(row);
      else if (c.state === 'dueSoon') dueSoon.push(row);
      else if (c.state === 'undetermined') undetermined.push({ ...row, note: c.note, row: c.row });
    }
    if (e.incomplete.length || e.overlaps.length) {
      incomplete.push({ tag: e.tag, name: e.name, unpaired: e.incomplete, overlaps: e.overlaps });
    }
  }
  byEquipment.sort((x, y) => x.tag.localeCompare(y.tag, 'zh'));
  exceeded.sort((x, y) => (y.used ?? 0) - (x.used ?? 0));
  dueSoon.sort((x, y) => (y.used ?? 0) - (x.used ?? 0));

  // 供 lubrication-manager 等下游按位号取累计运行小时
  const items = byEquipment.map((x) => ({ tag: x.tag, name: x.name, code: x.code, cumulativeHours: x.cumHours, cumulativeBasis: x.cumBasis,
    periodHours: x.periodHours, cumulativeStarts: x.cumStarts, noRunRecord: x.noRunRecord, asOf: date }));

  const counts = {
    // equipment = 本期有开停/运行记录的设备数；阈值表里有、本期无记录的设备另计 noRunRecord，两者之和 = byEquipment 行数
    equipment: byEquipment.filter((x) => !x.noRunRecord).length,
    listed: byEquipment.length,
    exceeded: exceeded.length, dueSoon: dueSoon.length, undetermined: undetermined.length,
    incomplete: incomplete.length,
    unpaired: incomplete.reduce((n, x) => n + x.unpaired.length, 0),
    overlaps: incomplete.reduce((n, x) => n + x.overlaps.length, 0),
    thresholdsProvided: !!thRows,
    baseProvided: byEquipment.filter((x) => x.cumBasis === 'base').length,
    periodOnly: byEquipment.filter((x) => x.cumBasis === 'periodOnly').length,
    noRunRecord: byEquipment.filter((x) => x.noRunRecord).length,
  };

  // ---- 产出
  C.ensureDir(outDir);
  const statement = '阈值到期为计划提示，实际检修时机由设备工程师结合状态评估确定。';
  const disclaimer = '本材料由脚本汇总、模型成文，仅供设备员复核参考，不替代审批、定性、验收与签字；厂内制度与系统数据为准。';
  const result = {
    meta: { workshop: a.workshop, date, from, warnRatio, runningUntil, generatedAt: C.localDateTime(),
      prevProvided: !!prevMap, thresholdsProvided: !!thRows, statement, disclaimer, workshopScope: scopes },
    counts, items, byEquipment, exceeded, dueSoon, undetermined, incomplete, warnings,
  };
  fs.writeFileSync(path.join(outDir, 'runtime.json'), JSON.stringify(result, null, 2), 'utf8');

  const basisText = { prev: '上期续算', base: '期初累计+本期', periodOnly: '仅本期增量', rowBase: '该行期初+本期', calendar: '日历' };
  const curText = (x) => x.kind === 'calendar' ? `已运行${C.fmt(x.current)}天` : C.fmt(x.current);
  const L = [];
  L.push(`# ${a.workshop} 运行小时与启停次数统计（截至 ${date}）`);
  L.push('');
  const wsNote = C.workshopScopeNote(scopes, a.workshop);
  if (wsNote.alert) { L.push(wsNote.alert); L.push(''); }
  L.push(`统计区间：${from ? `${from} ~ ${date}` : `截至 ${date}`}　｜　预警比例：${(warnRatio * 100).toFixed(0)}%${runningUntil ? `　｜　停机时间为空的运行段按截至 ${runningUntil} 仍在运行计入` : ''}`);
  if (wsNote.note) L.push(wsNote.note);
  L.push(`生成时间：${C.localDateTime()}（北京时间）`);
  L.push('');
  L.push('## 一、统计概览');
  L.push('');
  L.push(C.mdTable(['指标', '数值'], [
    ['统计设备数（本期有记录）', counts.equipment],
    ['已超阈值', counts.thresholdsProvided ? counts.exceeded : '—（未提供阈值表）'],
    ['接近阈值', counts.thresholdsProvided ? counts.dueSoon : '—（未提供阈值表）'],
    ['未判定项', counts.thresholdsProvided ? counts.undetermined : '—（未提供阈值表）'],
    ['有期初累计的设备', counts.thresholdsProvided ? counts.baseProvided : '—'],
    ['仅本期增量的设备', counts.periodOnly],
    ['本期无运行记录的设备', counts.noRunRecord],
    ['数据不完整设备', counts.incomplete],
    ['启停不配对', counts.unpaired], ['区间重叠', counts.overlaps],
  ]));
  if (counts.noRunRecord) L.push(`【注意】${counts.noRunRecord} 台设备在阈值表中但本期无运行记录（${byEquipment.filter((x) => x.noRunRecord).map((x) => x.tag).join('、')}），本期按 0h 列出，累计取期初/上期值。\n`);
  if (counts.periodOnly) L.push(`【注意】${counts.periodOnly} 台设备无期初累计小时、无上期 JSON，"累计运行"仅为本期增量，不代表自上次大检修以来的累计。\n`);
  L.push('## 二、逐台累计明细');
  L.push('');
  L.push(C.mdTable(['位号', '设备编号', '设备名称', '数据来源', '本期运行(h)', '本期启停(次)', '期初累计(h)', '累计运行(h)', '累计启停(次)', '累计口径'],
    byEquipment.map((x) => [x.tag, x.code || '—', x.name || '—', x.noRunRecord ? '本期无运行记录' : x.sources.join('+'), C.fmt(x.periodHours), x.periodStarts,
      C.fmt(x.baseHours), C.fmt(x.cumHours), C.fmt(x.cumStarts), basisText[x.cumBasis] || x.cumBasis])));
  L.push('## 三、已超阈值');
  L.push('');
  if (!counts.thresholdsProvided) L.push('_未提供阈值表，不做阈值预警。_\n');
  else L.push(C.mdTable(['位号', '设备名称', '阈值类型', '部件', '阈值', '当前', '超出', '已用', '到期日'],
    exceeded.map((x) => [x.tag, x.name || '—', x.type, x.part || '—', x.thresholdText || C.fmt(x.threshold),
      curText(x), x.kind === 'calendar' ? `${C.fmt(x.remain === null ? null : -x.remain)}天` : C.fmt(x.remain === null ? null : -x.remain),
      x.used === null ? '—' : `${x.used}%`, x.dueDate || '—'])));
  L.push('## 四、接近阈值');
  L.push('');
  if (!counts.thresholdsProvided) L.push('_未提供阈值表，不做阈值预警。_\n');
  else L.push(C.mdTable(['位号', '设备名称', '阈值类型', '部件', '阈值', '当前', '余量', '已用', '到期日'],
    dueSoon.map((x) => [x.tag, x.name || '—', x.type, x.part || '—', x.thresholdText || C.fmt(x.threshold),
      curText(x), x.kind === 'calendar' ? `${C.fmt(x.remain)}天` : C.fmt(x.remain), x.used === null ? '—' : `${x.used}%`, x.dueDate || '—'])));
  L.push('## 五、未判定项');
  L.push('');
  if (!counts.thresholdsProvided) L.push('_未提供阈值表。_\n');
  else if (!undetermined.length) L.push('_无_\n');
  else {
    L.push('【未判定】以下阈值项因缺字段或无法解析未做比对，未按任何默认口径处理：\n');
    L.push(C.mdTable(['位号', '设备名称', '阈值类型', '部件', '阈值表行', '缺什么 / 原因'],
      undetermined.map((x) => [x.tag, x.name || '—', x.type, x.part || '—', x.row, x.note])));
  }
  L.push('## 六、数据缺口说明');
  L.push('');
  if (!incomplete.length) L.push('_无_\n');
  else {
    for (const it of incomplete) {
      L.push(`**${it.tag}${it.name ? ' ' + it.name : ''}**`);
      L.push('');
      if (it.unpaired.length) {
        L.push(C.mdTable(['行号', '开机时间', '停机时间', '说明'],
          it.unpaired.map((u) => [u.row, u.start || '—', u.end || '—', u.reason])));
      }
      if (it.overlaps.length) L.push(C.mdTable(['重叠行', '说明'], it.overlaps.map((o) => [o.rows.join(' 与 '), o.note])));
    }
  }
  L.push('## 七、统计说明');
  L.push('');
  L.push('<!-- ANALYSIS_START -->');
  L.push('（由模型依据 references/runtime-rules.md 口径撰写 200~350 字，结构：总体情况 → 已超阈值设备 → 接近阈值设备与建议 → 未判定与数据缺口说明。小时数、次数、余量一律引用 runtime.json；超阈值不等于必须立即安排检修，大检修时机由公司设备管理部门按检修计划确定。）');
  L.push('<!-- ANALYSIS_END -->');
  L.push('');
  L.push('---');
  L.push('');
  L.push(`> ${statement}`);
  L.push(`> ${disclaimer}`);
  L.push('');
  if (warnings.length) {
    L.push('## 附：数据提示');
    L.push('');
    for (const w of warnings) L.push(`- ${w}`);
    L.push('');
  }
  fs.writeFileSync(path.join(outDir, 'runtime-report.md'), L.join('\n'), 'utf8');

  C.emitOk(outDir, { ok: true, out: outDir, workshop: a.workshop, date, counts, items, warnings });
}

try { main(); } catch (e) { C.fail(e, warnings); }
