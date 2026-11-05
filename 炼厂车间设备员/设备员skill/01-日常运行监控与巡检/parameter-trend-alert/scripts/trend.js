#!/usr/bin/env node
'use strict';
/**
 * 参数越限与劣化趋势预警（仅 Node.js 内置模块）—— 中石化体系炼化厂车间设备员口径
 * 用法：node scripts/trend.js --input <xlsx> --workshop "车间" --date <YYYY-MM-DD> [--out <dir>]
 * 可选：--periods <回溯期数> --from <起始日期> --equipment "<位号,位号>" --param "<参数名>"
 *       --threshold <斜率阈值> --r2-min <R²下限,默认0.5> --horizon <到限关注窗口天数,默认365>
 *       --wide（强制按宽表读取）--wide-param "<参数名>"（宽表无参数名列时统一指定）
 *       --status <设备台账/DCS 启停记录 xlsx、csv 文件或 csv 目录>（判定设备是否停运）
 * 产出：<out>/trends.json、alert.md、summary.json
 *
 * 硬约束：
 *   1. 期数 < 3 → insufficientData 单列，不做回归、不预测到限时间（绝不用两点连线当趋势）
 *   2. 数值无法解析 → warning + 该点 null，绝不按 0 计入趋势计算；带单位数值（78℃、4.5mm/s）由 makeNum 剥离单位
 *   3. 未提供限值表 → 只算趋势不判越限，warning 说明；限值表支持 高报(H)/高高报(HH)/低报(L)/低低报(LL) 两级
 *   4. 预计到限时间是线性外推结果，不是故障预测；报告保留说明行
 *   5. 斜率方向与限值方向不一致（如下降 vs 上限）→ 不预测到限时间
 *   6. 采集时间重复 → warning 并保留，不自动去重
 *   7. 宽表（一列一期）自动识别并转为长表；日期列头须含年份或为 Excel 日期
 *   8. 停运设备（备用/停运/停用/检修）：低值不判越低报/低低报、不做劣化趋势判定，单列「停运中（不判定）」+ warning；
 *      越高报/高高报照常判。运行状态：启停记录 > 台账 > 数据自判（同设备电流/转速最新值≈0 → 疑似停运）；
 *      只对有设备位号的序列生效（只有测点号的序列归属不定，不套用）
 *   9. 在运设备回溯窗口里的停机期点（启停记录停机段内，或无启停记录时同期电流/转速≈0）剔出回归与劣化判定；
 *      窗口内有停机期（切泵）的序列，剔除后少于 4 期 → 数据不足（切泵后运行期数偏少），不判劣化、不预测到限；
 *      窗口内无停机期的序列最低仍为 3 期；越限判定照常用剩余点
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readXlsx, readCsvDir } = require('./lib/xlsx-lite');
const C = require('./lib/common');

const warnings = [];
const num = C.makeNum(warnings);
const VALUE_OPTS = ['input', 'workshop', 'date', 'out', 'periods', 'from', 'equipment', 'param', 'threshold', 'r2-min', 'horizon', 'wide-param', 'status'];
const FLAG_OPTS = ['help', 'wide'];

/**
 * 列名别名：局部优先，再合并共享 SYSTEM_ALIASES（SAP PM/EM/DCS/智能巡检导出列名）。
 * 注意：局部不把「设备编号」作为位号别名——SAP 设备编号是 8 位流水号，不是位号。
 *       「测点」归测点号（DCS 仪表位号），参数名只认「测点名称」。
 */
const ALIASES = C.mergeAliases({
  '位号': ['设备位号', '位号', 'TAG', '功能位置'],
  '测点号': ['测点号', '仪表位号', '测点', '点号', 'PI/TI位号', 'DCS位号', '仪表TAG'],
  '设备名称': ['设备名称', '名称', '功能位置描述'],
  '参数名': ['参数名称', '参数名', '测点名称', '测点描述', '监测参数', '参数', '监测项目', '测量参数'],
  '采集时间': ['采集时间', '记录时间', '检测时间', '测量时间', '采样时间', '时间戳', '日期时间', '日期', '时间'],
  '数值': ['数值', '测值', '测量值', '实测值', '读数', '值', '当前值', 'PV'],
  '单位': ['单位', '计量单位', '工程单位'],
  '上限': ['报警上限', '上限值', '上限', '高限', '高报', '高报值', '高报限值', 'H', 'HI', 'PH'],
  '上上限': ['高高报', '高高限', '高高报值', '高高报限值', '上上限', 'HH', 'PHH', '联锁上限'],
  '下限': ['报警下限', '下限值', '下限', '低限', '低报', '低报值', '低报限值', 'L', 'LO', 'PL'],
  '下下限': ['低低报', '低低限', '低低报值', '低低报限值', '下下限', 'LL', 'PLL', '联锁下限'],
  // 停运自判的比较基准（可选列，参数记录或报警限值里给均可）
  '额定值': ['额定值', '额定电流', '额定转速'],
  '量程上限': ['量程上限', '量程高限'],
  // --status：DCS 启停记录（一行一个运行段）与设备台账
  '开机时间': ['开机时间', '启动时间', '开车时间', '投运时间'],
  '停机时间': ['停机时间', '停车时间', '停运时间', '停止时间'],
  '运行状态': ['运行状态', '运转状态', '开停状态', '启停状态'],
  '使用状态': ['使用状态', '设备状态', '状态'],
});
// 车间范围核对（D007）：「车间」只认 车间/所属车间/属地车间/运行部（及其后加「名称」），覆盖共享别名，
// 不让维护工厂/属地单位/使用单位/作业部占用「车间」字段；'车间' 放在各表 optional 列最后，避免抢走别的列
ALIASES['车间'] = [...C.WORKSHOP_COLS, ...C.WORKSHOP_COLS.map((c) => c + '名称')];

/** R² 分档的置信提示 */
const CONF = [
  { min: 0.8, level: 'high', text: '趋势明显' },
  { min: 0.5, level: 'medium', text: '趋势一般' },
  { min: 0, level: 'low', text: '数据离散，趋势不明显' },
];
function confidence(r2, n) {
  const c = CONF.find((x) => r2 >= x.min) || CONF[CONF.length - 1];
  const few = n < 5 ? `（仅 ${n} 期，期数偏少，置信有限）` : '';
  return { level: few ? (c.level === 'high' ? 'medium' : 'low') : c.level, text: c.text + few };
}

function loadBook(p) { return fs.statSync(p).isDirectory() ? readCsvDir(p) : readXlsx(p); }
/** 日期时间 → 毫秒；无法解析返回 null */
function ts(v) {
  const s = C.normDateTime(v);
  return s ? Date.parse(s.replace(' ', 'T') + ':00+08:00') : null;
}
const DAY = 86400000;
/** 恶化判定的两道闸默认值：R² 低于此值视为数据离散、斜率不可靠；到限天数超出此窗口不作为预警。均可用参数覆盖 */
const R2_MIN_DEFAULT = 0.5;
const HORIZON_DEFAULT = 365;
const LEVEL_TEXT = { HH: '高高报(HH)', H: '高报(H)', L: '低报(L)', LL: '低低报(LL)' };

/**
 * 最小二乘线性回归：x 为天（相对首点），y 为数值。
 * 返回 {slope（单位/天）, intercept, r2}；点数 < 3 或 x 无变化时返回 null（不外推）。
 */
function regress(points) {
  const n = points.length;
  if (n < 3) return null;
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (const p of points) {
    sxx += (p.x - mx) * (p.x - mx);
    sxy += (p.x - mx) * (p.y - my);
    syy += (p.y - my) * (p.y - my);
  }
  if (sxx === 0) return null;   // 所有点同一时刻，斜率无定义，不猜
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const r2 = syy === 0 ? 1 : Math.max(0, Math.min(1, (sxy * sxy) / (sxx * syy)));
  return { slope, intercept, r2 };
}

/**
 * 宽表识别：前 10 行里找一行，其中可解析为日期的单元格 ≥ 3 个且该行没有「采集时间」列。
 * 返回 { headerIdx, dateCols:[{j,label}] } 或 null。日期列头须含年份（2026-09-01 / 2026/9/1）或为 Excel 日期。
 */
function detectWide(rows) {
  const norm = (r) => (r || []).map((c) => C.str(c).replace(/\s+/g, ''));
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const hdr = norm(rows[i]);
    if (C.findCol(hdr, '采集时间', ALIASES) >= 0) return null;   // 已有采集时间列 → 长表
    const dateCols = [];
    hdr.forEach((c, j) => {
      const raw = (rows[i] || [])[j];
      const d = C.normDateTime(raw);
      if (d && /\d{4}/.test(C.str(raw)) || (typeof raw === 'number' && d)) dateCols.push({ j, label: d.endsWith(' 00:00') ? d.slice(0, 10) : d });
    });
    if (dateCols.length >= 3 && C.findCol(hdr, '位号', ALIASES) >= 0 || dateCols.length >= 3 && C.findCol(hdr, '测点号', ALIASES) >= 0) {
      return { headerIdx: i, dateCols };
    }
  }
  return null;
}

/**
 * 宽表 → 长表行数组（含表头）。每个日期列展开为一行；返回 { rows, origin:Map(长表行号→"原第N行 列「日期」") }。
 * 宽表无参数名列时用 --wide-param 统一指定，否则报错（不猜参数名）。
 */
function wideToLong(rows, det, wideParam) {
  const norm = (r) => (r || []).map((c) => C.str(c).replace(/\s+/g, ''));
  const hdr = norm(rows[det.headerIdx]);
  const dateSet = new Set(det.dateCols.map((x) => x.j));
  const col = (name) => { const j = C.findCol(hdr, name, ALIASES, dateSet); return j; };
  const jTag = col('位号'), jPt = col('测点号'), jName = col('设备名称'), jParam = col('参数名'), jUnit = col('单位');
  const jWs = col('车间');   // 车间列原样带到长表（保留原表头，供车间范围核对识别「维护工厂」等非车间列）
  if (jParam < 0 && !wideParam) throw new Error('宽表没有「参数名」列，请用 --wide-param "<参数名>" 指定该表记录的是哪个参数（脚本不猜）');
  const out = [['位号', '测点号', '设备名称', '参数名', '单位', '采集时间', '数值'].concat(jWs >= 0 ? [hdr[jWs]] : [])];
  const origin = new Map();
  for (let i = det.headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    if (!r.some((c) => C.str(c))) continue;
    const first = C.str(r[0]);
    if (/^(合计|小计|总计|共计|合计:|总数)/.test(first)) { warnings.push(`工作表「参数记录」第${i + 1}行为合计行，已跳过`); continue; }
    const tag = jTag >= 0 ? r[jTag] : null, pt = jPt >= 0 ? r[jPt] : null, name = jName >= 0 ? r[jName] : null;
    const param = jParam >= 0 ? r[jParam] : wideParam, unit = jUnit >= 0 ? r[jUnit] : null;
    for (const dc of det.dateCols) {
      const v = r[dc.j];
      if (v === undefined || v === null || C.str(v) === '') continue;   // 宽表空格 = 该期未测，不是 0
      out.push([tag, pt, name, param, unit, dc.label, v].concat(jWs >= 0 ? [r[jWs]] : []));
      origin.set(out.length, `第${i + 1}行 列「${dc.label}」`);
    }
  }
  return { rows: out, origin };
}

/** 宽表取数：与 makeNum 同口径（带单位剥离、不可解析 null + warning），只是行号用「原第N行 列「日期」」表述 */
let wideUnitNoted = false;
function numWide(v, label) {
  if (v === null || v === undefined || v === '') return null;
  const s = C.str(v);
  if (s === '' || s === '—' || s === '-' || s === '/' || s === '无') return null;
  const n = typeof v === 'number' ? v : Number(s.replace(/[,，\s%]/g, ''));
  if (Number.isFinite(n)) return n;
  const u = C.stripUnit(s);
  if (u) {
    if (!wideUnitNoted) { wideUnitNoted = true; warnings.push(`工作表「参数记录」数值含单位后缀（如「${s}」），已剥离单位「${u.unit}」取数值，请核对该表单位一致`); }
    return u.n;
  }
  warnings.push(`工作表「参数记录」${label} 值「${s}」无法解析为数字`);
  return null;
}

// ---------------------------------------------------------------- 运行状态（停运设备不判低限）
/** 台账状态值：备用/停运/停用/检修 → 停运；明确「运行」→ 运行；「在用」等只说明在册、不说明在转 → 不下结论 */
const STOPPED_RE = /备用|停运|停用|检修|停机|停车/;
const RUNNING_RE = /^(运行|运行中|运转|在运|在运行|开机)$/;
function ledgerState(v) {
  const t = C.str(v).replace(/\s+/g, '');
  if (!t) return null;
  if (STOPPED_RE.test(t)) return 'stopped';
  if (RUNNING_RE.test(t)) return 'running';
  return null;
}
const eqKey = (t) => C.str(t).replace(/\s+/g, '').toUpperCase();
/** 运行指示位号：电流 / 转速 */
function runIndicator(param, unit) {
  if (/电流/.test(param)) return 'current';
  if (/转速/.test(param) || /^(r\/min|rpm)$/i.test(unit || '')) return 'speed';
  return null;
}

/**
 * 读 --status：xlsx / 单个 csv / csv 目录；按表头识别「启停记录」（位号 + 开机时间/停机时间）与「设备台账」（位号 + 运行状态/使用状态）。
 * 返回 { runs: Map(eqKey→[{start,stop,startText,stopText}]), ledger: Map(eqKey→{state,text}), sheets:[...] }
 */
function loadStatus(p) {
  if (!fs.existsSync(p)) throw new Error(`--status 不存在: ${p}`);
  let book;
  if (fs.statSync(p).isDirectory()) book = readCsvDir(p);
  else if (/\.csv$/i.test(p)) {
    const name = path.basename(p, path.extname(p));
    book = { [name]: readCsvDir(path.dirname(p))[name] };
  } else book = readXlsx(p);
  const norm = (r) => (r || []).map((c) => C.str(c).replace(/\s+/g, ''));
  const has = (rows, name) => rows.slice(0, 10).some((r) => C.findCol(norm(r), name, ALIASES) >= 0 && C.findCol(norm(r), '位号', ALIASES) >= 0);
  const runs = new Map(), ledger = new Map(), sheets = [];
  for (const [sheet, rows] of Object.entries(book)) {
    if (!rows || !rows.length) continue;
    if (has(rows, '开机时间') || has(rows, '停机时间')) {
      sheets.push({ sheet, kind: '启停记录' });
      const recs = C.toRecords(rows, ['位号', '开机时间', '停机时间'], sheet, ['设备名称'], [], ALIASES);
      for (const r of recs) {
        const k = eqKey(r['位号']);
        if (!k) continue;
        const st = C.str(r['开机时间']), sp = C.str(r['停机时间']);
        const start = st ? ts(st) : -Infinity, stop = sp ? ts(sp) : null;
        if (st && start === null) { warnings.push(`--status「${sheet}」第${r._row}行 开机时间「${st}」无法解析，该行不参与运行状态判定`); continue; }
        if (sp && stop === null) { warnings.push(`--status「${sheet}」第${r._row}行 停机时间「${sp}」无法解析，该行不参与运行状态判定`); continue; }
        if (!st && !sp) continue;
        if (stop !== null && stop < start) { warnings.push(`--status「${sheet}」第${r._row}行 停机时间早于开机时间，该行不参与运行状态判定`); continue; }
        if (!runs.has(k)) runs.set(k, []);
        runs.get(k).push({ start, stop, startText: st ? C.normDateTime(st) : null, stopText: sp ? C.normDateTime(sp) : null });
      }
    } else if (has(rows, '运行状态') || has(rows, '使用状态')) {
      sheets.push({ sheet, kind: '设备台账' });
      const recs = C.toRecords(rows, ['位号'], sheet, ['运行状态', '使用状态'], [], ALIASES);
      const col = recs.hasCol('运行状态') ? '运行状态' : '使用状态';
      for (const r of recs) {
        const k = eqKey(r['位号']);
        if (!k) continue;
        ledger.set(k, { state: ledgerState(r[col]), text: C.str(r[col]), col });
      }
    }
  }
  if (!sheets.length) throw new Error('--status 里未识别出 DCS 启停记录（位号 + 开机时间/停机时间）或设备台账（位号 + 使用状态/运行状态），请检查文件');
  return { runs, ledger, sheets };
}
/** 启停记录：取开机时间不晚于 ref 的最近一段；该段停机时间为空或晚于 ref → 运行，否则停运；无此类记录 → null */
function runsState(segs, ref) {
  const before = segs.filter((g) => g.start <= ref).sort((x, y) => x.start - y.start);
  if (!before.length) {
    const next = segs.filter((g) => Number.isFinite(g.start)).sort((x, y) => x.start - y.start)[0];
    return next ? { state: 'stopped', basis: `启停记录：最早一次开机 ${next.startText} 晚于最新数据采集时间` } : null;
  }
  const g = before[before.length - 1];
  if (g.stop === null || g.stop > ref) return { state: 'running', basis: g.startText ? `启停记录：${g.startText} 开机${g.stopText ? `，${g.stopText} 停机（晚于最新数据采集时间）` : '，未停机'}` : '启停记录：未停机' };
  return { state: 'stopped', basis: `启停记录：${g.stopText} 停机后无开机记录` };
}

/**
 * 启停记录：t 时刻落在停机段内 → true。不在任何运行段内，且此前有停机记录、或此后有开机记录（开机即说明开机前处于停机）。
 * 启停记录导出只含与导出窗口有交集的运行段，所以首段开机之前的采集点按停机处理。
 */
function inStopGap(segs, t) {
  if (segs.some((g) => g.start <= t && (g.stop === null || t < g.stop))) return false;
  return segs.some((g) => (g.stop !== null && g.stop <= t) || (Number.isFinite(g.start) && g.start > t));
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
  let periods = 12;
  if (a.periods !== undefined) {
    periods = Number(a.periods);
    if (!Number.isInteger(periods) || periods < 3) throw new Error(`--periods 「${a.periods}」应为不小于 3 的整数`);
  }
  let slopeThreshold = null;
  if (a.threshold !== undefined) {
    slopeThreshold = Number(a.threshold);
    if (!Number.isFinite(slopeThreshold) || slopeThreshold < 0) throw new Error(`--threshold 「${a.threshold}」应为不小于 0 的数字`);
  }
  let R2_MIN = R2_MIN_DEFAULT;
  if (a['r2-min'] !== undefined) {
    R2_MIN = Number(a['r2-min']);
    if (!Number.isFinite(R2_MIN) || R2_MIN < 0 || R2_MIN > 1) throw new Error(`--r2-min 「${a['r2-min']}」应为 0~1 之间的数字`);
  }
  let HORIZON = HORIZON_DEFAULT;
  if (a.horizon !== undefined) {
    HORIZON = Number(a.horizon);
    if (!Number.isInteger(HORIZON) || HORIZON < 1) throw new Error(`--horizon 「${a.horizon}」应为不小于 1 的整数（天）`);
  }
  const only = a.equipment ? new Set(a.equipment.split(/[,，]/).map((x) => x.trim()).filter(Boolean)) : null;
  const onlyParam = a.param ? new Set(a.param.split(/[,，]/).map((x) => x.trim()).filter(Boolean)) : null;
  const outDir = a.out || path.join(os.tmpdir(), 'pta-out');
  const status = a.status ? loadStatus(a.status) : null;

  const book = loadBook(a.input);

  // ---- 参数记录（唯一数据源，缺失即报错）
  let recSheet = C.pickSheet(book, '参数记录', '参数数据', '监测记录', '趋势数据', '测点数据', '参数');
  if (!recSheet) throw new Error('未找到「参数记录」工作表（可识别：参数记录/参数数据/监测记录/趋势数据/测点数据）');
  let origin = null, inputShape = 'long';
  const det = detectWide(recSheet);
  if (a.wide && !det) throw new Error('指定了 --wide，但未识别出 3 个以上日期列头（列头须含年份，如 2026-09-01，或为 Excel 日期）');
  if (det) {
    const conv = wideToLong(recSheet, det, a['wide-param'] || null);
    recSheet = conv.rows; origin = conv.origin; inputShape = 'wide';
    warnings.push(`「参数记录」识别为宽表（一列一期，共 ${det.dateCols.length} 个日期列），已自动转为长表；日期以列头为准，时间按 00:00 计`);
  } else if (a['wide-param']) {
    warnings.push('--wide-param 仅在宽表时生效，本次输入为长表，已忽略');
  }
  const recs0 = C.toRecords(recSheet, ['采集时间', '数值'], '参数记录', ['位号', '测点号', '设备名称', '参数名', '单位', '额定值', '量程上限', '车间'], warnings, ALIASES);
  // 车间范围核对：参数记录是唯一主表（报警限值表、--status 按位号查找，不核对）；宽表按展开后的行计数
  const pws = C.workshopScope(recs0, a.workshop, '参数记录', warnings);
  const scopes = [pws.scope];
  const recs = pws.records;
  if (!recs.hasCol('采集时间')) throw new Error('「参数记录」没有采集时间列（长表须有采集时间列；宽表的日期列头须含年份，如 2026-09-01，脚本不猜年份）');
  if (!recs.hasCol('数值')) throw new Error('「参数记录」没有数值（测值/测量值/PV）列');
  if (!recs.hasCol('位号') && !recs.hasCol('测点号')) throw new Error('「参数记录」既无位号（功能位置/设备位号）列也无测点号（仪表位号）列，无法构成序列');
  if (!recs.hasCol('参数名') && !recs.hasCol('测点号')) throw new Error('「参数记录」既无参数名列也无测点号列，无法区分参数');
  const rowLabel = (r) => (origin && origin.get(r._row)) || `第${r._row}行`;

  // series: tag||param -> {tag, pointTag, name, param, unit, points:[], badPoints:[]}
  const series = new Map();
  const key = (t, p) => `${t}||${p}`;
  let pointTagAsTag = 0, pointTagAsParam = 0;
  for (const r of recs) {
    const pointTag = C.str(r['测点号']);
    let tag = C.str(r['位号']);
    const equipTag = tag;   // 只有设备位号列给出的才算设备归属；测点号兜底的序列不套用停运判定
    let param = C.str(r['参数名']);
    if (!tag && pointTag) { tag = pointTag; pointTagAsTag++; }
    if (!param && pointTag) { param = pointTag; pointTagAsParam++; }
    if (!tag) { warnings.push(`工作表「参数记录」${rowLabel(r)} 位号为空，已跳过`); continue; }
    if (!param) { warnings.push(`工作表「参数记录」${rowLabel(r)} 参数名为空，已跳过`); continue; }
    if (only && !only.has(tag) && !only.has(pointTag)) continue;
    if (onlyParam && !onlyParam.has(param) && !onlyParam.has(pointTag)) continue;
    const k = key(tag, param);
    if (!series.has(k)) series.set(k, { tag, pointTag, equipTag: equipTag || null, name: C.str(r['设备名称']), param, unit: C.str(r['单位']), points: [], badPoints: [], ref: null });
    const s = series.get(k);
    if (!s.equipTag && equipTag) s.equipTag = equipTag;
    if (s.ref === null) {
      for (const col of ['额定值', '量程上限']) {
        if (C.str(r[col]) === '') continue;
        const rv = num(r[col], { sheet: '参数记录', row: r._row, col });
        if (rv !== null && rv > 0) { s.ref = { v: rv, kind: col }; break; }
      }
    }
    if (!s.name && C.str(r['设备名称'])) s.name = C.str(r['设备名称']);
    if (!s.unit && C.str(r['单位'])) s.unit = C.str(r['单位']);
    if (!s.pointTag && pointTag) s.pointTag = pointTag;

    const t = ts(r['采集时间']);
    if (t === null) {
      warnings.push(`工作表「参数记录」${rowLabel(r)} 设备「${tag}」参数「${param}」采集时间「${C.str(r['采集时间'])}」无法解析，该点不参与趋势计算`);
      s.badPoints.push({ row: rowLabel(r), time: null, value: null, reason: '采集时间无法解析' });
      continue;
    }
    const v = origin ? numWide(r['数值'], rowLabel(r)) : num(r['数值'], { sheet: '参数记录', row: r._row, col: '数值' });
    if (v === null) {
      // 硬约束 2：数值无法解析 → 该点 null，绝不按 0 计入趋势计算
      s.badPoints.push({ row: rowLabel(r), time: C.normDateTime(r['采集时间']), value: null, reason: '数值为空或无法解析（已按缺测处理，未按 0 计入）' });
      continue;
    }
    s.points.push({ row: rowLabel(r), t, time: C.normDateTime(r['采集时间']), v });
  }
  if (pointTagAsTag) warnings.push(`${pointTagAsTag} 行无设备位号，已用测点号（仪表位号）作为序列键；测点号与设备位号不是一回事，请在报告中核对所属设备`);
  if (pointTagAsParam) warnings.push(`${pointTagAsParam} 行无参数名，已用测点号作为参数名`);
  if (!series.size) {
    throw new Error(only || onlyParam ? '指定的设备/参数范围内没有可用记录' : '「参数记录」中没有可用记录');
  }

  // ---- 限值表（可选）：高报(H)/高高报(HH)/低报(L)/低低报(LL)
  const limSheet = C.pickSheet(book, '报警限值', '限值', '报警限值表', '报警设定', '限值表');
  const limits = new Map();   // tag||param -> {hi, hh, lo, ll, unit}
  let twoLevel = false;
  if (limSheet) {
    const lrecs = C.toRecords(limSheet, ['参数名'], '报警限值', ['位号', '测点号', '上限', '上上限', '下限', '下下限', '单位', '额定值', '量程上限'], warnings, ALIASES);
    twoLevel = lrecs.hasCol('上上限') || lrecs.hasCol('下下限');
    for (const r of lrecs) {
      const tag = C.str(r['位号']) || C.str(r['测点号']), param = C.str(r['参数名']) || C.str(r['测点号']);
      if (!tag || !param) { warnings.push(`工作表「报警限值」第${r._row}行 位号或参数名为空，已跳过`); continue; }
      const hi = num(r['上限'], { sheet: '报警限值', row: r._row, col: '上限' });
      const hh = num(r['上上限'], { sheet: '报警限值', row: r._row, col: '上上限' });
      const lo = num(r['下限'], { sheet: '报警限值', row: r._row, col: '下限' });
      const ll = num(r['下下限'], { sheet: '报警限值', row: r._row, col: '下下限' });
      let ref = null;
      for (const col of ['额定值', '量程上限']) {
        if (C.str(r[col]) === '') continue;
        const rv = num(r[col], { sheet: '报警限值', row: r._row, col });
        if (rv !== null && rv > 0) { ref = { v: rv, kind: col }; break; }
      }
      if (hi === null && lo === null && hh === null && ll === null) {
        if (ref) { limits.set(key(tag, param), { hi, hh, lo, ll, unit: C.str(r['单位']), ref, refOnly: true }); continue; }
        warnings.push(`工作表「报警限值」第${r._row}行 设备「${tag}」参数「${param}」高报/高高报/低报/低低报均为空或无法解析，该项不判越限`);
        continue;
      }
      if (hi !== null && lo !== null && hi < lo) warnings.push(`工作表「报警限值」第${r._row}行 设备「${tag}」参数「${param}」高报（${hi}）小于低报（${lo}），已原样保留，请核实限值表`);
      if (hi !== null && hh !== null && hh < hi) warnings.push(`工作表「报警限值」第${r._row}行 设备「${tag}」参数「${param}」高高报（${hh}）小于高报（${hi}），已原样保留，请核实限值表`);
      if (lo !== null && ll !== null && ll > lo) warnings.push(`工作表「报警限值」第${r._row}行 设备「${tag}」参数「${param}」低低报（${ll}）大于低报（${lo}），已原样保留，请核实限值表`);
      const k = key(tag, param);
      if (limits.has(k)) warnings.push(`工作表「报警限值」第${r._row}行 设备「${tag}」参数「${param}」限值重复出现，以后一条为准，请核实`);
      limits.set(k, { hi, hh, lo, ll, unit: C.str(r['单位']), ref });
    }
  } else {
    warnings.push('未提供「报警限值」工作表，只计算趋势不判越限，也不预测到限时间');
  }

  const limOf = (s) => {
    const l = limits.get(key(s.tag, s.param)) || (s.pointTag ? limits.get(key(s.pointTag, s.param)) || limits.get(key(s.pointTag, s.pointTag)) : null) || null;
    return l;
  };

  // ---- 运行状态：启停记录 > 台账 > 数据自判（同设备电流/转速最新值≈0）。按设备位号归属，参考时刻 = 该设备最新一期数据的采集时间
  const equipSeries = new Map();   // eqKey -> [series]
  for (const s of series.values()) {
    if (!s.equipTag) continue;
    const k = eqKey(s.equipTag);
    if (!equipSeries.has(k)) equipSeries.set(k, []);
    equipSeries.get(k).push(s);
  }
  /** 电流/转速位号的≈0 阈值：额定值或量程上限的 2%；无基准时电流 ≤0.5 A、转速 =0 */
  const zeroThr = (s, kind) => {
    const lim = limOf(s);
    const base = s.ref || (lim && lim.ref) || null;
    const unit = s.unit || (lim && lim.unit) || '';
    const thr = base ? base.v * 0.02 : kind === 'current' && (!unit || /^A$/i.test(unit)) ? 0.5 : 0;
    const thrText = base ? `≤${base.kind} ${C.fmt(base.v, 3)} 的 2%` : thr ? `≤${thr} A` : '=0';
    return { thr, thrText, unit };
  };
  const runState = new Map();   // eqKey -> { state, source, basis }
  const stopAt = new Map();     // eqKey -> { source, test(t) }：逐期判停机，用于剔除在运设备回溯窗口里的停机期点
  for (const [k, list] of equipSeries) {
    const indAll = list.map((s) => ({ s, kind: runIndicator(s.param, s.unit) })).filter((x) => x.kind && x.s.points.length);
    if (status && status.runs.has(k)) {
      const segs = status.runs.get(k);
      stopAt.set(k, { source: '启停记录', test: (t) => inStopGap(segs, t) });
    } else if (indAll.length) {
      // 同期（同一采集时刻）所有有读数的电流/转速位号都≈0 → 该期停机；该时刻没有电流/转速读数 → 不判
      const zeroByT = new Map();
      for (const { s, kind } of indAll) {
        const { thr } = zeroThr(s, kind);
        for (const p of s.points) zeroByT.set(p.t, (zeroByT.has(p.t) ? zeroByT.get(p.t) : true) && p.v <= thr);
      }
      stopAt.set(k, { source: '数据自判', test: (t) => zeroByT.get(t) === true });
    }
    const pts = list.flatMap((s) => s.points);
    if (!pts.length) continue;
    const ref = Math.max(...pts.map((p) => p.t));
    let rs = null;
    if (status && status.runs.has(k)) {
      const x = runsState(status.runs.get(k), ref);
      if (x) rs = { ...x, source: '启停记录' };
    }
    if (!rs && status && status.ledger.has(k)) {
      const l = status.ledger.get(k);
      if (l.state) rs = { state: l.state, source: '设备台账', basis: `设备台账${l.col}：${l.text}` };
    }
    if (!rs) {
      // 数据自判：该设备全部电流/转速位号的最新值都≈0 → 疑似停运；没有可判位号 → 维持原逻辑
      const ind = indAll;
      if (ind.length) {
        const zero = ind.map(({ s, kind }) => {
          const lastPt = s.points.reduce((m, p) => (p.t >= m.t ? p : m));
          const { thr, thrText, unit } = zeroThr(s, kind);
          return { z: lastPt.v <= thr, text: `${s.param}最新值 ${C.fmt(lastPt.v, 3)}${unit ? ' ' + unit : ''}（${thrText}，${lastPt.time}）`, short: `${s.param} ${C.fmt(lastPt.v, 3)}${unit ? ' ' + unit : ''}` };
        });
        rs = zero.every((x) => x.z)
          ? { state: 'suspectedStopped', source: '数据自判', basis: zero.map((x) => x.text).join('；'), short: zero.map((x) => x.short).join('、') }
          : { state: 'running', source: '数据自判', basis: zero.filter((x) => !x.z).map((x) => x.text).join('；') };
      }
    }
    if (rs) runState.set(k, rs);
  }
  const rsOf = (s) => (s.equipTag ? runState.get(eqKey(s.equipTag)) || null : null);
  const isStoppedState = (rs) => !!rs && (rs.state === 'stopped' || rs.state === 'suspectedStopped');

  // 同设备各序列回溯窗口内的停机期时刻：停机时不记读数的参数（如轴承温度）自身无点可剔，但窗口内同样发生过停机/切泵
  const eqStopTimes = new Map();   // eqKey -> 停机期采集时刻数组
  for (const s of series.values()) {
    if (!s.equipTag) continue;
    const k = eqKey(s.equipTag);
    const sa = stopAt.get(k);
    if (!sa || isStoppedState(runState.get(k))) continue;
    const pts = [...s.points].sort((x, y) => x.t - y.t);
    for (const p of pts.slice(Math.max(0, pts.length - periods))) if (sa.test(p.t)) (eqStopTimes.get(k) || eqStopTimes.set(k, []).get(k)).push(p.t);
  }

  // ---- 逐条序列计算
  const overLimit = [], deteriorating = [], stable = [], insufficientData = [], stopped = [], items = [];
  for (const s of series.values()) {
    let lim = limOf(s);
    if (lim && lim.refOnly) lim = null;
    const rs = rsOf(s);
    const isStopped = isStoppedState(rs);
    if (!lim && limSheet) {
      warnings.push(`设备「${s.tag}」参数「${s.param}」在「报警限值」中查不到限值，只算趋势不判越限`);
    }
    const unit = s.unit || (lim && lim.unit) || '';

    // 采集时间重复：warning 并保留，不自动去重（硬约束 6）
    s.points.sort((x, y) => x.t - y.t || String(x.row).localeCompare(String(y.row)));
    const dupTimes = [];
    for (let i = 1; i < s.points.length; i++) {
      if (s.points[i].t === s.points[i - 1].t) {
        dupTimes.push({ time: s.points[i].time, rows: [s.points[i - 1].row, s.points[i].row] });
        warnings.push(`设备「${s.tag}」参数「${s.param}」${s.points[i - 1].row}与${s.points[i].row}采集时间相同（${s.points[i].time}），已原样保留未去重，请核实台账`);
      }
    }

    // 回溯窗口：取最近 periods 期；在运设备窗口内的停机期点剔出（硬约束 9），停运设备整条单列不在此处理
    const all = s.points;
    const windowPts = all.slice(Math.max(0, all.length - periods));
    const sa = !isStopped && s.equipTag ? stopAt.get(eqKey(s.equipTag)) || null : null;
    const excludedPts = sa ? windowPts.filter((p) => sa.test(p.t)) : [];
    const used = excludedPts.length ? windowPts.filter((p) => !sa.test(p.t)) : windowPts;
    const n = used.length;
    const first = n ? used[0] : null;
    const last = n ? used[n - 1] : null;
    const spanDays = n >= 2 ? C.round((last.t - first.t) / DAY, 2) : null;

    // 越限判定（有限值且有最新有效值时才判）：先判 HH/LL（更高等级），再判 H/L
    // 停运设备：只判高报/高高报；低于低报/低低报属停运低值，不判越限（记 lowIgnored 说明）
    let limitState = null, exceedBy = null, limitLevel = null, limitValue = null, lowIgnored = null;
    if (lim && last) {
      if (lim.hh !== null && last.v > lim.hh) { limitState = 'overHighHigh'; limitLevel = 'HH'; limitValue = lim.hh; exceedBy = C.round(last.v - lim.hh, 3); }
      else if (lim.hi !== null && last.v > lim.hi) { limitState = 'overHigh'; limitLevel = 'H'; limitValue = lim.hi; exceedBy = C.round(last.v - lim.hi, 3); }
      else if (isStopped) {
        if (lim.ll !== null && last.v < lim.ll) lowIgnored = 'LL';
        else if (lim.lo !== null && last.v < lim.lo) lowIgnored = 'L';
        else limitState = 'within';
      } else if (lim.ll !== null && last.v < lim.ll) { limitState = 'overLowLow'; limitLevel = 'LL'; limitValue = lim.ll; exceedBy = C.round(lim.ll - last.v, 3); }
      else if (lim.lo !== null && last.v < lim.lo) { limitState = 'overLow'; limitLevel = 'L'; limitValue = lim.lo; exceedBy = C.round(lim.lo - last.v, 3); }
      else limitState = 'within';
    }
    const isOver = limitState !== null && limitState !== 'within';

    const base = {
      tag: s.tag, pointTag: s.pointTag || null, name: s.name, param: s.param, unit,
      periodsUsed: n, periodsTotal: all.length,
      firstTime: first ? first.time : null, lastTime: last ? last.time : null,
      firstValue: first ? first.v : null, lastValue: last ? last.v : null,
      spanDays,
      limitHigh: lim ? lim.hi : null, limitHighHigh: lim ? lim.hh : null,
      limitLow: lim ? lim.lo : null, limitLowLow: lim ? lim.ll : null,
      limitProvided: !!lim,
      limitState, limitLevel, limitLevelText: limitLevel ? LEVEL_TEXT[limitLevel] : null, limitValue, exceedBy,
      runState: rs ? rs.state : null, runStateSource: rs ? rs.source : null, runStateBasis: rs ? rs.basis : null,
      excludedStoppedPeriods: excludedPts.map((p) => ({ row: p.row, time: p.time, value: p.v })),
      excludedStoppedSource: excludedPts.length ? sa.source : null,
      duplicateTimes: dupTimes,
      invalidPoints: s.badPoints,
      points: used.map((p) => ({ row: p.row, time: p.time, value: p.v })),
    };

    // 硬约束 8：停运设备不做劣化趋势判定、不预测到限；越高报/高高报照常进越限清单
    if (isStopped) {
      const tagText = rs.state === 'stopped' ? '设备停运中' : '设备疑似停运';
      const lowText = lowIgnored ? `最新值低于${LEVEL_TEXT[lowIgnored]}，属停运低值，不判越限；` : '';
      const item = {
        ...base, category: isOver ? 'overLimit' : 'stopped', lowIgnored,
        slope: null, changeRate: null, r2: null, confidence: null, daysToLimit: null, etaDate: null,
        etaNote: `${tagText}，不做劣化趋势判定，也不预测到限时间`,
        note: `${tagText}（${rs.source}）：${lowText}不做劣化趋势判定；越高报/高高报照常判定`,
      };
      items.push(item);
      if (isOver) overLimit.push(item); else stopped.push(item);
      continue;
    }

    // 硬约束 1：期数 < 3 不做回归、不预测；窗口内有停机期（切泵）时门槛为 4 期（硬约束 9）
    // 本序列无点可剔、但同设备在本序列首期之前的窗口内有停机期（停机时该参数不记读数）→ 同样视为切泵后序列
    const sibStops = !excludedPts.length && sa && windowPts.length ? (eqStopTimes.get(eqKey(s.equipTag)) || []).filter((t) => t < windowPts[0].t) : [];
    const stopInWindow = excludedPts.length > 0 || sibStops.length > 0;
    base.stopInWindow = stopInWindow;
    const minPeriods = stopInWindow ? 4 : 3;
    if (n < minPeriods) {
      const item = {
        ...base, category: 'insufficientData',
        slope: null, changeRate: null, r2: null, confidence: null, daysToLimit: null, etaDate: null,
        note: excludedPts.length
          ? `数据不足（切泵后运行期数偏少，剩 ${n} 期）：回溯窗口 ${windowPts.length} 期中 ${excludedPts.length} 期为停机期（含停机期，${sa.source}）已剔除，窗口内发生过停机/切泵时剩余少于 4 期不做劣化判定，不计算趋势斜率，也不预测到限时间`
          : stopInWindow
            ? `数据不足（切泵后运行期数偏少，剩 ${n} 期）：同设备回溯窗口内有停机期（含停机期，${sa.source}），本参数停机时无读数，切换后仅 ${n} 期，少于 4 期不做劣化判定，不计算趋势斜率，也不预测到限时间`
            : `有效期数 ${n} 期，少于 3 期，不计算趋势斜率，也不预测到限时间（两点连线不构成趋势）`,
      };
      items.push(item);
      insufficientData.push(item);
      if (!stopInWindow) warnings.push(`设备「${s.tag}」参数「${s.param}」有效期数仅 ${n} 期，不足 3 期，**未计算趋势，也未预测到限时间**`);
      // 期数不足但已越限，仍应在越限清单中体现（越限是单点事实，不依赖趋势）
      if (isOver) overLimit.push(item);
      continue;
    }

    const reg = regress(used.map((p) => ({ x: (p.t - first.t) / DAY, y: p.v })));
    if (!reg) {
      const item = {
        ...base, category: 'insufficientData',
        slope: null, changeRate: null, r2: null, confidence: null, daysToLimit: null, etaDate: null,
        note: '所有采集时间相同，时间跨度为 0，斜率无定义，不计算趋势也不预测到限时间',
      };
      items.push(item); insufficientData.push(item);
      warnings.push(`设备「${s.tag}」参数「${s.param}」全部采集时间相同，时间跨度为 0，**未计算趋势**`);
      if (isOver) overLimit.push(item);
      continue;
    }

    const slope = C.round(reg.slope, 4);
    const r2 = C.round(reg.r2, 3);
    const conf = confidence(reg.r2, n);
    // 变化率：相对首期值的总变化百分比；首期为 0 时无定义（不按 0 处理）
    const changeRate = first.v === 0 ? null : C.round(((last.v - first.v) / Math.abs(first.v)) * 100, 1);
    const changeAbs = C.round(last.v - first.v, 3);

    // 预计到限时间：线性外推，方向一致才算（硬约束 5）；两级限值时先外推到最近一级（H/L），其次 HH/LL
    let daysToLimit = null, etaDate = null, etaLimitKind = null, etaLimitValue = null, etaNote = null;
    if (lim && limitState === 'within') {
      const upTarget = lim.hi !== null ? { v: lim.hi, k: 'H' } : lim.hh !== null ? { v: lim.hh, k: 'HH' } : null;
      const downTarget = lim.lo !== null ? { v: lim.lo, k: 'L' } : lim.ll !== null ? { v: lim.ll, k: 'LL' } : null;
      if (reg.slope > 0 && upTarget) {
        daysToLimit = C.round((upTarget.v - last.v) / reg.slope, 1);
        etaLimitKind = LEVEL_TEXT[upTarget.k]; etaLimitValue = upTarget.v;
      } else if (reg.slope < 0 && downTarget) {
        daysToLimit = C.round((downTarget.v - last.v) / reg.slope, 1);
        etaLimitKind = LEVEL_TEXT[downTarget.k]; etaLimitValue = downTarget.v;
      } else if (reg.slope > 0 && !upTarget) {
        etaNote = '参数在上升但未设上限，不预测到限时间';
      } else if (reg.slope < 0 && !downTarget) {
        etaNote = '参数在下降但未设下限，不预测到限时间';
      } else {
        etaNote = '斜率方向与限值方向不一致（如参数下降而仅设上限），不预测到限时间';
      }
      if (daysToLimit !== null && daysToLimit < 0) {
        daysToLimit = null;
        etaNote = '按当前斜率外推不会到达限值，不预测到限时间';
      } else if (daysToLimit !== null && reg.r2 < R2_MIN) {
        // R² 过低时斜率本身就是噪声，外推出来的天数没有意义，不给日期
        etaNote = `R²=${C.round(reg.r2, 3)} 低于 ${R2_MIN}（--r2-min），数据离散、斜率不可靠，不预测到限日期`;
        daysToLimit = null;
      } else if (daysToLimit !== null && daysToLimit > HORIZON) {
        etaNote = `按当前斜率外推到限需 ${C.round(daysToLimit, 0)} 天，超出 ${HORIZON} 天关注窗口（--horizon），不作为预警呈现`;
        daysToLimit = null;
      } else if (daysToLimit !== null) {
        etaDate = C.addDays(C.normDate(last.time), Math.ceil(daysToLimit));
      }
    } else if (lim && isOver) {
      etaNote = `已越${LEVEL_TEXT[limitLevel]}，不再预测到限时间`;
    } else if (!lim) {
      etaNote = '未提供该参数的限值，不判越限也不预测到限时间';
    }

    // 恶化判定：斜率方向指向某个限值，或无限值时按 --threshold 判斜率绝对值
    let deteriorate = false, reason = null;
    if (lim && limitState === 'within') {
      if (daysToLimit !== null) { deteriorate = true; reason = `按线性外推 ${daysToLimit} 天后到达${etaLimitKind}`; }
    }
    if (!deteriorate && slopeThreshold !== null && Math.abs(reg.slope) >= slopeThreshold && reg.r2 >= R2_MIN) {
      deteriorate = true;
      reason = `斜率 ${slope}/天，绝对值达到告警阈值 ${slopeThreshold}`;
    }

    let category;
    if (isOver) category = 'overLimit';
    else if (deteriorate) category = 'deteriorating';
    else category = 'stable';

    const item = {
      ...base, category,
      slope, slopePerDay: slope, r2, confidence: conf.level, confidenceText: conf.text,
      changeRate, changeAbs,
      daysToLimit, etaDate, etaLimitKind, etaLimitValue, etaNote,
      deteriorateReason: reason,
    };
    items.push(item);
    if (category === 'overLimit') overLimit.push(item);
    else if (category === 'deteriorating') deteriorating.push(item);
    else stable.push(item);
  }

  const levelRank = { HH: 0, LL: 0, H: 1, L: 1 };
  items.sort((x, y) => x.tag.localeCompare(y.tag, 'zh') || x.param.localeCompare(y.param, 'zh'));
  overLimit.sort((x, y) => (levelRank[x.limitLevel] - levelRank[y.limitLevel]) || ((y.exceedBy ?? 0) - (x.exceedBy ?? 0)));
  deteriorating.sort((x, y) => (x.daysToLimit === null ? 1e9 : x.daysToLimit) - (y.daysToLimit === null ? 1e9 : y.daysToLimit));
  stable.sort((x, y) => x.tag.localeCompare(y.tag, 'zh'));
  insufficientData.sort((x, y) => x.tag.localeCompare(y.tag, 'zh'));
  stopped.sort((x, y) => x.tag.localeCompare(y.tag, 'zh') || x.param.localeCompare(y.param, 'zh'));

  // 停运 warning：按依据汇总点名（只点有序列的设备）
  const stopEq = [...runState.entries()].filter(([, v]) => isStoppedState(v));
  const nameOfEq = (k) => equipSeries.get(k)[0].equipTag;
  const RULE_TEXT = '其参数单列「停运中（不判定）」，不判越低报/低低报、不做劣化趋势判定；越高报/高高报照常判定';
  for (const src of ['启停记录', '设备台账']) {
    const list = stopEq.filter(([, v]) => v.source === src).map(([k]) => nameOfEq(k));
    if (list.length) warnings.push(`以下 ${list.length} 台设备按${src}判为停运中（备用/停运/停用/检修）：${list.join('、')}；${RULE_TEXT}`);
  }
  const exList = items.filter((x) => x.excludedStoppedPeriods.length);
  const exTotal = exList.reduce((n, x) => n + x.excludedStoppedPeriods.length, 0);
  if (exList.length) {
    warnings.push(`以下 ${exList.length} 条在运设备序列的回溯窗口里有停机期采集点（启停记录停机段内，或同期电流/转速≈0），共 ${exTotal} 个点已剔出回归与劣化判定：${exList.map((x) => `${x.tag} ${x.param}（${x.excludedStoppedPeriods.length} 期，${x.excludedStoppedSource}）`).join('、')}`);
  }
  const exShort = items.filter((x) => x.stopInWindow && x.category === 'insufficientData');
  if (exShort.length) {
    warnings.push(`以下 ${exShort.length} 条序列数据不足（含停机期）：回溯窗口内发生过停机/切泵，剔除停机期点后（或停机时本参数无读数）剩余少于 4 期，判「数据不足（切泵后运行期数偏少）」，**未做劣化判定，也未预测到限时间**（越限照常判定）：${exShort.map((x) => `${x.tag} ${x.param}（剩 ${x.periodsUsed} 期）`).join('、')}`);
  }
  const sus = stopEq.filter(([, v]) => v.state === 'suspectedStopped');
  if (sus.length) {
    warnings.push(`以下 ${sus.length} 台设备电流/转速最新值≈0（≤额定或量程的 2%；无基准时电流 ≤0.5 A、转速 =0），**疑似停运**：${sus.map(([k, v]) => `${nameOfEq(k)}（${v.short}）`).join('、')}${status ? '（--status 中没有其启停记录，台账状态也不能说明是否在运行，如「在用」）' : ''}；已按停运处理，${RULE_TEXT}。请提供设备台账（使用状态/运行状态）或 DCS 启停记录（--status）确认`);
  }

  const counts = {
    series: items.length,
    overLimit: overLimit.length,
    overHighHigh: overLimit.filter((x) => x.limitLevel === 'HH' || x.limitLevel === 'LL').length,
    overHigh: overLimit.filter((x) => x.limitLevel === 'H' || x.limitLevel === 'L').length,
    deteriorating: deteriorating.length,
    stable: stable.length,
    insufficientData: insufficientData.length,
    stopped: stopped.length,
    stoppedEquipment: stopEq.length,
    suspectedStoppedEquipment: sus.length,
    excludedStoppedPoints: exTotal,
    seriesWithExcludedStopped: exList.length,
    invalidPoints: items.reduce((n, x) => n + x.invalidPoints.length, 0),
    duplicateTimes: items.reduce((n, x) => n + x.duplicateTimes.length, 0),
    limitsProvided: !!limSheet,
    twoLevelLimits: twoLevel,
  };

  // ---- 产出
  C.ensureDir(outDir);
  const statement = '预计到限时间为按现有数据线性外推的统计结果，仅供安排关注与复测参考，不是设备故障预测，也不代表设备将在该时间损坏。';
  const disclaimer = '本材料由脚本汇总、模型成文，仅供设备员复核参考，不替代审批、定性、验收与签字；厂内制度与系统数据为准。';
  const result = {
    meta: {
      workshop: a.workshop, date, from, periods, slopeThreshold,
      generatedAt: C.localDateTime(), limitsProvided: !!limSheet, twoLevelLimits: twoLevel, inputShape, statement, disclaimer,
      confidenceRule: 'R²≥0.8 趋势明显；0.5≤R²<0.8 趋势一般；R²<0.5 数据离散，趋势不明显；有效期数<5 期再降一档',
      limitRule: '越限先判高高报/低低报（HH/LL），再判高报/低报（H/L）；两级都给时先向最近一级外推到限时间；限值以 DCS 组态或厂内限值表为准，脚本不自定限值',
      r2Min: R2_MIN, horizonDays: HORIZON,
      statusProvided: !!status, statusSheets: status ? status.sheets : [], workshopScope: scopes,
      runStateRule: '停运设备（备用/停运/停用/检修）低值不判越低报/低低报、不做劣化趋势判定，越高报/高高报照常判；运行状态按 启停记录（该设备最新数据采集时刻前最近一段）> 设备台账（使用状态/运行状态，「在用」不说明在运行）> 数据自判（同设备电流/转速最新值≈0：≤额定或量程的 2%，无基准时电流 ≤0.5 A、转速 =0，判疑似停运）；只对有设备位号的序列生效',
    },
    counts, overLimit, deteriorating, stable, insufficientData, stopped, items, warnings,
  };
  fs.writeFileSync(path.join(outDir, 'trends.json'), JSON.stringify(result, null, 2), 'utf8');

  const u = (x) => (x.unit ? x.unit : '—');
  const tagCell = (x) => (x.pointTag && x.pointTag !== x.tag ? `${x.tag}（${x.pointTag}）` : x.tag);
  const L = [];
  L.push(`# ${a.workshop} 参数越限与劣化趋势预警（截至 ${date}）`);
  L.push('');
  const wsNote = C.workshopScopeNote(scopes, a.workshop);
  if (wsNote.alert) { L.push(wsNote.alert); L.push(''); }
  L.push(`回溯窗口：最近 ${periods} 期${from ? `　｜　起始日期：${from}` : ''}${slopeThreshold !== null ? `　｜　斜率告警阈值：${slopeThreshold}/天` : ''}　｜　R² 下限：${R2_MIN}　｜　到限关注窗口：${HORIZON} 天`);
  L.push(`数据形态：${inputShape === 'wide' ? '宽表（已转长表）' : '长表'}　｜　限值：${!limSheet ? '未提供' : twoLevel ? '两级（高报/高高报）' : '单级'}`);
  if (wsNote.note) L.push(wsNote.note);
  L.push(`生成时间：${C.localDateTime()}（北京时间）`);
  L.push('');
  L.push('## 一、预警概览');
  L.push('');
  L.push(C.mdTable(['指标', '数值'], [
    ['参数序列数', counts.series],
    ['已越限', counts.limitsProvided ? counts.overLimit : '—（未提供限值表）'],
    ['　其中越高高报/低低报（HH/LL）', counts.limitsProvided ? counts.overHighHigh : '—'],
    ['　其中越高报/低报（H/L）', counts.limitsProvided ? counts.overHigh : '—'],
    ['趋势恶化', counts.deteriorating],
    ['趋势稳定', counts.stable],
    ['数据不足（<3 期）', counts.insufficientData],
    ['停运中（不判定）', counts.stopped],
    ['数值无法解析的采集点', counts.invalidPoints],
    ['采集时间重复', counts.duplicateTimes],
  ]));
  L.push('## 二、已越限');
  L.push('');
  if (!counts.limitsProvided) L.push('_未提供「报警限值」工作表，不做越限判定。_\n');
  else {
    L.push(C.mdTable(['位号（测点号）', '设备名称', '参数', '单位', '最新值', '采集时间', '越限等级', '限值', '超限幅度'],
      overLimit.map((x) => [tagCell(x), x.name || '—', x.param, u(x), C.fmt(x.lastValue, 3), x.lastTime || '—',
        x.limitLevelText + (isStoppedState(x.runState ? { state: x.runState } : null) ? `（${x.runState === 'stopped' ? '停运中' : '疑似停运'}）` : ''), C.fmt(x.limitValue, 3), C.fmt(x.exceedBy, 3)])));
    if (overLimit.some((x) => x.runState === 'stopped' || x.runState === 'suspectedStopped')) L.push('> 标「停运中/疑似停运」的为停运设备仍越高报/高高报的参数，请核实设备实际状态与测点。\n');
    if (counts.overHighHigh) L.push('【注意】越高高报/低低报（HH/LL）的参数属高一级报警，请立即核对 DCS 报警记录，报车间设备主任并视情况报工程师处置；是否停机由工艺/设备主管按规程决定，本技能不做停机判定。\n');
  }
  L.push('## 三、趋势恶化');
  L.push('');
  L.push(C.mdTable(['位号（测点号）', '设备名称', '参数', '单位', '期数', '最新值', '斜率(/天)', '变化率', 'R²', '预计到限(天)', '到限等级', '预计到限日期', '置信提示'],
    deteriorating.map((x) => [tagCell(x), x.name || '—', x.param, u(x), x.periodsUsed, C.fmt(x.lastValue, 3),
      C.fmt(x.slope, 4), x.changeRate === null ? '—' : `${x.changeRate}%`, C.fmt(x.r2, 3),
      C.fmt(x.daysToLimit, 1), x.etaLimitKind || '—', x.etaDate || '—', x.confidenceText])));
  if (deteriorating.length) {
    L.push(`> ${statement}`);
    L.push('');
  }
  L.push('## 四、趋势稳定');
  L.push('');
  L.push(C.mdTable(['位号（测点号）', '设备名称', '参数', '单位', '期数', '最新值', '斜率(/天)', '变化率', 'R²', '置信提示'],
    stable.map((x) => [tagCell(x), x.name || '—', x.param, u(x), x.periodsUsed, C.fmt(x.lastValue, 3),
      C.fmt(x.slope, 4), x.changeRate === null ? '—' : `${x.changeRate}%`, C.fmt(x.r2, 3), x.confidenceText])));
  L.push('## 五、数据不足说明');
  L.push('');
  if (!insufficientData.length) L.push('_无_\n');
  else {
    L.push(C.mdTable(['位号（测点号）', '设备名称', '参数', '有效期数', '最新值', '采集时间', '说明'],
      insufficientData.map((x) => [tagCell(x), x.name || '—', x.param, x.periodsUsed, C.fmt(x.lastValue, 3), x.lastTime || '—', x.note])));
    L.push('> 以上参数未计算趋势斜率，也未预测到限时间。两点连线不构成趋势，需补齐至少 3 期数据后重算。');
    L.push('');
  }
  if (stopped.length) {
    L.push('### 停运中（不判定）');
    L.push('');
    const rsText = { stopped: '停运中', suspectedStopped: '疑似停运' };
    L.push(C.mdTable(['位号（测点号）', '设备名称', '参数', '单位', '最新值', '采集时间', '运行状态', '依据'],
      stopped.map((x) => [tagCell(x), x.name || '—', x.param, u(x), C.fmt(x.lastValue, 3), x.lastTime || '—', rsText[x.runState], x.runStateBasis || '—'])));
    L.push('> 以上为停运（备用/停运/停用/检修）设备的参数：停运期间的低值不是参数越限，不判越低报/低低报，也不做劣化趋势判定；越高报/高高报照常判定（见「二、已越限」）。「疑似停运」为按电流/转速≈0 自判，请用设备台账或 DCS 启停记录确认。');
    L.push('');
  }
  const badList = items.filter((x) => x.invalidPoints.length);
  if (badList.length || counts.duplicateTimes) {
    L.push('### 数据质量明细');
    L.push('');
    if (badList.length) {
      L.push(C.mdTable(['位号', '参数', '行号', '采集时间', '说明'],
        badList.flatMap((x) => x.invalidPoints.map((p) => [x.tag, x.param, p.row, p.time || '—', p.reason]))));
    }
    const dupList = items.filter((x) => x.duplicateTimes.length);
    if (dupList.length) {
      L.push(C.mdTable(['位号', '参数', '重复行', '采集时间', '说明'],
        dupList.flatMap((x) => x.duplicateTimes.map((d) => [x.tag, x.param, d.rows.join(' 与 '), d.time, '采集时间重复，已原样保留未去重']))));
    }
  }
  L.push('## 六、趋势研判与建议');
  L.push('');
  if (exTotal) {
    L.push(`> 已剔除停机期 ${exTotal} 个点（${exList.length} 条在运设备序列，依据启停记录或同期电流/转速≈0），这些点未参与回归与劣化判定；剔除后少于 4 期的归「数据不足（切泵后运行期数偏少）」。明细见 trends.json 的 excludedStoppedPeriods。`);
    L.push('');
  }
  L.push('<!-- ANALYSIS_START -->');
  L.push('（由模型依据 references/interpretation.md 口径撰写 200~400 字，结构：总体情况 → 已越限设备（先 HH/LL 后 H/L） → 趋势恶化设备与建议动作 → 数据不足说明（停运中的设备只说明停运依据，不写越低报或劣化；有停机期点被剔除的，写明剔除点数并引用研判段上方的说明行）。斜率、变化率、预计到限时间一律引用 trends.json，并注明预测基于线性外推、仅供参考；振动只按 ISO 10816 / GB/T 6075 分区概念表述，不自定数值。）');
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
  fs.writeFileSync(path.join(outDir, 'alert.md'), L.join('\n'), 'utf8');

  C.emitOk(outDir, { ok: true, out: outDir, workshop: a.workshop, date, inputShape, counts, warnings });
}

try { main(); } catch (e) { C.fail(e, warnings); }
