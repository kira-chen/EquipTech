#!/usr/bin/env node
'use strict';
/**
 * 备用设备切换与盘车提醒脚本（仅 Node.js 内置模块）—— 中石化体系炼化厂车间设备员口径
 * 用法：node "<技能目录>/scripts/rotation.js" --input <xlsx> --workshop "常减压车间" --date 2026-09-21 [--out <dir>]
 *       [--lead-days 3] [--from 2026-06-21] [--equipment "P-1101A,P-1101B"] [--overdue-factor 2] [--long-idle-days <天>]
 * 产出：<out>/rotation.json、<out>/rotation-report.md、<out>/summary.json；末行打印 JSON 摘要
 *
 * 口径要点：
 * - 以机组/泵组为键；台账里的「主用/备用」只是初始角色，当前主用按切换记录（含切换方向列）推导，可变。
 * - 长期未切换阈值 = --overdue-factor × 该机组切换周期（默认 2 倍）；--long-idle-days 为显式绝对天数覆盖。无切换周期 → 不判长期未切换（已在未判定里）。
 * - 备机状态（备用/检修中/停用）：检修中、停用的备机不进到期清单，单列；备机完好台数按「可随时投用」口径，检修中不计入分子。
 * - 周期支持 每班/每N小时（班次级按日粒度判定）、每天/每周/每月/每季/半年/每年；运行小时周期不在本技能范围。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readXlsx, readCsvDir } = require('./lib/xlsx-lite');
const C = require('./lib/common');

const warnings = [];
const VALUE_OPTS = ['input', 'workshop', 'date', 'out', 'lead-days', 'from', 'equipment', 'overdue-factor', 'long-idle-days'];
const FLAG_OPTS = ['help'];

/** 未指定 --from 时执行率的默认统计区间长度（天）—— 仅统计口径，不是周期默认值 */
const DEFAULT_WINDOW_DAYS = 180;
/** 长期未切换默认倍数：距上次切换天数 ≥ 倍数 × 切换周期 */
const DEFAULT_OVERDUE_FACTOR = 2;

/** 必须保留的说明行（SKILL.md 硬性要求，原文写入 md） */
const DECLARATION = '切换实施前需由工艺确认具备切换条件并按操作票执行，本清单仅为周期提醒';
/** 通用声明行（口径对照第九节） */
const GENERAL_DECLARATION = '本材料由脚本汇总、模型成文，仅供设备员复核参考，不替代审批、定性、验收与签字；厂内制度与系统数据为准。';

/**
 * 列名别名：局部优先，再合并中石化常用系统（SAP PM / EM / 智能巡检）共享别名。
 * 注意：局部「位号」不含「设备编号」（SAP 设备编号是流水号，不是位号）；
 *       「设备名称」不含裸「设备」（SAP 导出里「设备」列是设备编号）；
 *       「机组」不含「装置/单元」（装置单独成列，走共享别名）。
 */
const ALIASES = C.mergeAliases({
  '主用位号': ['主用位号', '主用', '主机位号', '主泵位号', '主设备位号', '在用位号', '主用设备位号', '当前主用', '位号A', 'A泵位号', 'A机位号', 'A位号'],
  '备用位号': ['备用位号', '备用', '备机位号', '备泵位号', '备用设备位号', '备用设备', '当前备用', '位号B', 'B泵位号', 'B机位号', 'B位号'],
  '设备名称': ['设备名称', '名称', '设备描述', '技术对象描述', '功能位置描述', '描述'],
  '机组': ['机组', '机组号', '机组编号', '泵组', '泵组号', '泵组编号', '组号', '所属机组', '机泵组', '机组名称'],
  '装置': ['装置', '装置名称', '工厂区段', '单元', '生产单元', '区域'],
  '备机状态': ['备机状态', '备用状态', '备用设备状态', '备机状况', '备用机状态', '备机当前状态', '状态'],
  '切换周期': ['切换周期', '主备切换周期', '倒泵周期', '轮换周期', '定期切换周期', '切换频次'],
  '盘车周期': ['盘车周期', '盘车间隔', '盘车频次'],
  '试运周期': ['试运周期', '试运转周期', '备用设备试运周期', '试车周期'],
  '上次切换日期': ['上次切换日期', '上次切换', '末次切换日期', '最近切换日期', '上次倒泵日期'],
  '上次盘车日期': ['上次盘车日期', '上次盘车', '末次盘车日期', '最近盘车日期'],
  '上次试运日期': ['上次试运日期', '上次试运', '末次试运日期', '最近试运日期'],
  '日期': ['日期', '执行日期', '作业日期', '记录日期', '切换日期', '切换时间', '完成日期', '时间'],
  '位号': ['位号', '设备位号', '位号编码', 'TAG', 'Tag', 'tag'],
  '作业类型': ['作业类型', '工作类型', '类型', '作业内容', '作业项目'],
  '切换后主用': ['切换后主用', '切换后主用位号', '切至位号', '切至', '投用位号', '启用位号', '开泵位号', '切换后运行'],
  '执行人': ['执行人', '操作人', '记录人', '作业人', '实施人'],
  '备注': ['备注', '说明', '情况'],
});

/** 三类周期性工作 */
const KINDS = [
  { key: 'switch', label: '切换', period: '切换周期', last: '上次切换日期' },
  { key: 'turning', label: '盘车', period: '盘车周期', last: '上次盘车日期' },
  { key: 'trial', label: '试运', period: '试运周期', last: '上次试运日期' },
];

/** 记录表作业类型归一；无法归类返回 '' */
function normKind(v) {
  const s = C.str(v);
  if (!s) return '';
  if (s.includes('切换') || s.includes('倒泵') || s.includes('轮换') || s.includes('倒机')) return 'switch';
  if (s.includes('盘车')) return 'turning';
  if (s.includes('试运') || s.includes('试车')) return 'trial';
  return '';
}

/**
 * 备机状态归一：standby（备用/完好/可用/热备/冷备）、repair（检修/维修/在修/待修/消缺）、stopped（停用/封存/停运/退出）
 * 空 → null（列未填，按备用处理但计入「状态未填」）；无法识别 → 'unknown'（按备用处理并 warning）
 */
const STANDBY_STATUS = {
  repair: ['检修中', '检修', '维修中', '维修', '在修', '待修', '消缺中', '消缺', '待验收', '施工中'],
  stopped: ['停用', '封存', '停运', '退出', '报废', '长期停用'],
  standby: ['备用', '完好', '可用', '热备', '冷备', '备用完好', '正常', '良好', '备妥', '随时可投'],
};
const STANDBY_LABEL = { standby: '备用', repair: '检修中', stopped: '停用', unknown: '无法识别', null: '未填' };
function normStandbyStatus(v) {
  const s = C.str(v);
  if (!s) return null;
  for (const [k, list] of Object.entries(STANDBY_STATUS)) if (list.some((x) => s === x)) return k;
  for (const [k, list] of Object.entries(STANDBY_STATUS)) if (list.some((x) => s.includes(x))) return k;
  return 'unknown';
}

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
  let leadDays = 3;
  if (a['lead-days'] !== undefined) {
    const n = Number(a['lead-days']);
    if (!Number.isFinite(n) || n < 0) throw new Error(`--lead-days 「${a['lead-days']}」不是有效的非负天数`);
    leadDays = Math.round(n);
  }
  let overdueFactor = DEFAULT_OVERDUE_FACTOR;
  if (a['overdue-factor'] !== undefined) {
    const n = Number(a['overdue-factor']);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`--overdue-factor 「${a['overdue-factor']}」不是有效的正数倍数`);
    overdueFactor = n;
  }
  let longIdleDays = null;   // 显式绝对天数阈值（覆盖倍数口径）
  if (a['long-idle-days'] !== undefined) {
    const n = Number(a['long-idle-days']);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`--long-idle-days 「${a['long-idle-days']}」不是有效的正整数天数`);
    longIdleDays = Math.round(n);
  }
  let from = null;
  if (a.from !== undefined) {
    from = C.normDate(a.from);
    if (!from) throw new Error(`--from 「${a.from}」不是有效日期，应为 YYYY-MM-DD`);
    if (C.diffDays(from, date) > 0) throw new Error(`--from ${from} 晚于 --date ${date}，统计区间无效`);
  }
  if (!fs.existsSync(a.input)) throw new Error(`输入不存在: ${a.input}`);
  const outDir = a.out || path.join(os.tmpdir(), 'srr-out');

  const scope = a.equipment ? a.equipment.split(',').map((s) => s.trim()).filter(Boolean) : null;
  const inScope = (...tags) => !scope || tags.some((t) => t && scope.includes(t));

  let book;
  try { book = loadBook(a.input); } catch (e) { throw new Error(`读取失败 ${a.input}: ${e.message}`); }

  // ---------------------------------------------------------------- 一、备用设备台账
  const ledgerRows = C.pickSheet(book, '备用设备台账', '备用设备', '主备设备台账', '机泵切换台账', '备机台账', '台账');
  if (!ledgerRows) throw new Error('未在输入中找到「备用设备台账」工作表，无法做到期判定');
  const ledger = C.toRecords(ledgerRows, ['主用位号', '备用位号'], '备用设备台账',
    ['设备名称', '机组', '装置', '备机状态', '切换周期', '盘车周期', '试运周期', '上次切换日期', '上次盘车日期', '上次试运日期'],
    warnings, ALIASES);
  const hasStatusCol = ledger.hasCol('备机状态');
  const hasGroupCol = ledger.hasCol('机组');

  // ---------------------------------------------------------------- 二、切换盘车记录（先读，用于推导当前主用）
  const recRows = C.pickSheet(book, '切换盘车记录', '切换记录', '盘车记录', '执行记录', '机泵切换记录');
  let recs = null, recHasDirection = false, recHasTag = true;
  if (recRows) {
    recs = C.toRecords(recRows, ['日期', '位号', '作业类型'], '切换盘车记录',
      ['切换后主用', '执行人', '备注', '设备名称', '设备编号'], warnings, ALIASES);
    recHasDirection = recs.hasCol('切换后主用');
    recHasTag = recs.hasCol('位号');
    if (!recHasTag && recs.hasCol('设备编号')) warnings.push('工作表「切换盘车记录」无位号列，已用「设备编号」列作位号匹配（SAP 设备编号与位号不同，请核对）');
  }

  const switchOverdue = [], switchDueSoon = [], switchNormal = [];
  const turningOverdue = [], turningDueSoon = [], turningNormal = [];
  const trialOverdue = [], trialDueSoon = [], trialNormal = [];
  const undetermined = [];      // 周期或上次执行日期缺失 → 单列
  const pairingIssues = [];     // 主备位号无法配对 → 单列，绝不猜测
  const longIdle = [];          // 长期未切换
  const standbyUnavailable = []; // 备机检修中/停用 → 不进到期清单，单列
  const pairs = [];             // 已成对的主备组（供执行率与长期未切换用）
  const groupSeen = new Map();
  let scopeSkipped = 0, statusMissing = 0, statusUnknown = 0;

  const bucket = {
    switch: { overdue: switchOverdue, dueSoon: switchDueSoon, normal: switchNormal },
    turning: { overdue: turningOverdue, dueSoon: turningDueSoon, normal: turningNormal },
    trial: { overdue: trialOverdue, dueSoon: trialDueSoon, normal: trialNormal },
  };

  // 切换方向索引：位号 → 该位号所属切换记录（供当前主用推导）
  const switchRecsByTag = new Map();
  if (recs) {
    for (const r of recs) {
      if (normKind(r['作业类型']) !== 'switch') continue;
      const tag = C.str(recHasTag ? r['位号'] : r['设备编号']);
      const d = C.normDate(r['日期']);
      if (!tag || !d) continue;
      const item = { date: d, tag, to: C.str(r['切换后主用']), row: r._row };
      if (!switchRecsByTag.has(tag)) switchRecsByTag.set(tag, []);
      switchRecsByTag.get(tag).push(item);
    }
  }

  for (const r of ledger) {
    const ledgerMain = C.str(r['主用位号']);
    const ledgerStandby = C.str(r['备用位号']);
    const name = C.str(r['设备名称']);
    const group = C.str(r['机组']);
    const unit = C.str(r['装置']);
    if (!ledgerMain && !ledgerStandby) { warnings.push(`工作表「备用设备台账」第${r._row}行 主用位号与备用位号均为空，已跳过`); continue; }
    if (!inScope(ledgerMain, ledgerStandby)) { scopeSkipped++; continue; }

    // 主备配对校验 —— 无法配对的绝不猜测，单列 pairingIssues 且不做到期判定
    if (!ledgerMain || !ledgerStandby) {
      const missField = !ledgerMain ? '主用位号为空' : '备用位号为空';
      pairingIssues.push({
        groupKey: group || null, mainTag: ledgerMain || null, standbyTag: ledgerStandby || null, name, unit,
        reason: `${missField}，无法确定主备配对关系`,
        sheet: '备用设备台账', row: r._row,
      });
      warnings.push(`工作表「备用设备台账」第${r._row}行 ${ledgerMain || ledgerStandby}：${missField}，主备无法配对（未自行猜测配对关系，该行不参与到期判定）`);
      continue;
    }
    if (ledgerMain === ledgerStandby) {
      pairingIssues.push({
        groupKey: group || null, mainTag: ledgerMain, standbyTag: ledgerStandby, name, unit,
        reason: '主用位号与备用位号相同，无法确定主备配对关系',
        sheet: '备用设备台账', row: r._row,
      });
      warnings.push(`工作表「备用设备台账」第${r._row}行 主用位号与备用位号同为「${ledgerMain}」，主备无法配对（未自行猜测配对关系，该行不参与到期判定）`);
      continue;
    }

    // 机组/泵组键：有机组列用机组号，否则用两位号组合；同一机组号重复出现 → warning（不合并，不猜测）
    const pairKey = `${ledgerMain}/${ledgerStandby}`;
    const groupKey = group || pairKey;
    if (group) {
      if (groupSeen.has(group)) warnings.push(`工作表「备用设备台账」第${r._row}行 机组「${group}」与第${groupSeen.get(group)}行重复，两行各自按位号判定，未合并`);
      else groupSeen.set(group, r._row);
    }

    // 当前主用推导：按切换记录中最近一条带「切换后主用」且在机组两位号之内的记录；否则按台账
    const ledgerLastSwitch = C.normDate(r['上次切换日期']);
    let currentMain = ledgerMain, currentStandby = ledgerStandby, roleSource = '台账', roleRecordDate = null;
    const grpRecs = [].concat(switchRecsByTag.get(ledgerMain) || [], switchRecsByTag.get(ledgerStandby) || [])
      .filter((x) => C.diffDays(date, x.date) >= 0)
      .sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : y.row - x.row));
    if (grpRecs.length) {
      const latest = grpRecs[0];
      if (latest.to) {
        if (latest.to === ledgerMain || latest.to === ledgerStandby) {
          currentMain = latest.to; currentStandby = latest.to === ledgerMain ? ledgerStandby : ledgerMain;
          roleSource = '切换记录'; roleRecordDate = latest.date;
        } else {
          warnings.push(`工作表「切换盘车记录」第${latest.row}行 切换后主用「${latest.to}」不在机组 ${pairKey} 两位号之内，当前主用按台账（未猜测）`);
        }
      } else {
        roleSource = recHasDirection ? '台账(该机组记录无方向)' : '台账(记录表无切换方向列)';
      }
      if (ledgerLastSwitch && C.diffDays(latest.date, ledgerLastSwitch) > 0) {
        warnings.push(`机组 ${groupKey}：切换记录最近一次切换 ${latest.date} 晚于台账上次切换日期 ${ledgerLastSwitch}，到期判定仍按台账日期，请核对台账是否未更新`);
      }
    }

    // 备机状态：检修中/停用 → 不进到期清单，单列
    let standbyStatus = null;
    if (hasStatusCol) {
      standbyStatus = normStandbyStatus(r['备机状态']);
      if (standbyStatus === null) statusMissing++;
      else if (standbyStatus === 'unknown') { statusUnknown++; warnings.push(`工作表「备用设备台账」第${r._row}行 ${groupKey} 备机状态「${C.str(r['备机状态'])}」无法识别，按备用处理并提示核对`); }
    } else statusMissing++;

    const pair = {
      groupKey, pairKey, mainTag: currentMain, standbyTag: currentStandby,
      ledgerMainTag: ledgerMain, ledgerStandbyTag: ledgerStandby, roleSource, roleRecordDate,
      name, unit, standbyStatus, standbyStatusLabel: STANDBY_LABEL[standbyStatus], standbyStatusRaw: C.str(r['备机状态']) || null,
      row: r._row,
    };
    pairs.push(pair);

    if (standbyStatus === 'repair' || standbyStatus === 'stopped') {
      standbyUnavailable.push({
        groupKey, pairKey, mainTag: currentMain, standbyTag: currentStandby, name, unit,
        standbyStatus, standbyStatusLabel: STANDBY_LABEL[standbyStatus], standbyStatusRaw: C.str(r['备机状态']),
        switchPeriodRaw: C.str(r['切换周期']) || null, lastSwitchDate: ledgerLastSwitch,
        note: standbyStatus === 'repair' ? '备机检修中，不进切换/盘车/试运到期清单；检修完工验收后恢复提醒' : '备机停用，不进到期清单；恢复备用后请更新台账',
        sheet: '备用设备台账', row: r._row,
      });
      continue;
    }

    for (const k of KINDS) {
      const rawPeriod = C.str(r[k.period]);
      const rawLast = C.str(r[k.last]);
      // 试运为可选项：周期与上次日期都没填视为该机组不做试运，不计入未判定
      if (k.key === 'trial' && !rawPeriod && !rawLast) continue;
      const periodDetail = C.parsePeriodDetail(r[k.period]);
      const periodDays = periodDetail ? periodDetail.days : null;
      const lastDate = C.normDate(r[k.last]);
      const base = {
        groupKey, pairKey, mainTag: currentMain, standbyTag: currentStandby, name, unit, kind: k.key, kindLabel: k.label,
        periodRaw: rawPeriod || null, periodDays, periodText: C.fmtPeriod(periodDays), lastDate,
        sheet: '备用设备台账', row: r._row,
      };

      // 周期或上次执行日期缺失/不可解析 → 未判定，绝不按默认周期（如一月一次）替用户设定
      const miss = [];
      if (!rawPeriod) miss.push(`${k.label}周期为空`);
      else if (periodDays === null) miss.push(C.parseRunHours(r[k.period]) !== null ? `${k.label}周期「${rawPeriod}」是运行小时周期，本技能只按日历周期判定（运行小时用 runtime-hours-tracker）` : `${k.label}周期「${rawPeriod}」无法解析`);
      if (!rawLast) miss.push(`上次${k.label}日期为空`);
      else if (!lastDate) miss.push(`上次${k.label}日期「${rawLast}」无法解析`);
      if (miss.length) {
        undetermined.push({ ...base, dueDate: null, daysDiff: null, reason: miss.join('；') });
        warnings.push(`工作表「备用设备台账」第${r._row}行 ${groupKey} ${k.label}：${miss.join('；')}，无法判定到期（未按默认周期处理）`);
        continue;
      }
      // 上次执行日期晚于基准日期 → 不判定，单列并 warning
      const sinceLast = C.diffDays(date, lastDate);
      if (sinceLast < 0) {
        undetermined.push({ ...base, dueDate: null, daysDiff: null, reason: `上次${k.label}日期 ${lastDate} 晚于基准日期 ${date}，日期越界无法判定` });
        warnings.push(`工作表「备用设备台账」第${r._row}行 ${groupKey} 上次${k.label}日期 ${lastDate} 晚于基准日期 ${date}，该项不作到期判定`);
        continue;
      }

      // 班次级/小时级周期（<1 天）：按日粒度判定——上次执行为当日即「本日内按班次到期」，早于当日即逾期
      const shiftLevel = periodDays < 1;
      const dueDate = shiftLevel ? lastDate : C.addDays(lastDate, periodDays);
      const daysDiff = C.diffDays(dueDate, date);   // >0 还有几天到期；<0 已逾期
      const item = { ...base, dueDate, daysDiff, sinceLastDays: sinceLast, shiftLevel };
      if (daysDiff < 0) {
        const od = -daysDiff, ratio = od / Math.max(periodDays, 1);
        bucket[k.key].overdue.push({ ...item, overdueDays: od, overdueRatio: C.round(ratio, 2), level: ratio > 1 ? '严重逾期' : (ratio > 0.2 ? '明显逾期' : '轻微逾期') });
      } else if (daysDiff <= leadDays) {
        bucket[k.key].dueSoon.push({ ...item, remainDays: daysDiff, note: shiftLevel ? '班次级周期，本日内按班次到期' : null });
      } else {
        bucket[k.key].normal.push({ ...item, remainDays: daysDiff });
      }

      // 长期未切换：阈值 = 倍数 × 切换周期（或 --long-idle-days 显式天数）
      if (k.key === 'switch') {
        const threshold = longIdleDays !== null ? longIdleDays : Math.round(overdueFactor * periodDays);
        if (sinceLast >= threshold) {
          longIdle.push({
            groupKey, pairKey, mainTag: currentMain, standbyTag: currentStandby, name, unit, lastDate,
            idleDays: sinceLast, threshold, thresholdBasis: longIdleDays !== null ? `--long-idle-days ${longIdleDays} 天` : `${overdueFactor} × 切换周期 ${periodDays} 天`,
            periodRaw: rawPeriod, periodDays,
            note: '长期未切换，备用设备存在启动困难风险，需安排试运或盘车确认可用性',
            sheet: '备用设备台账', row: r._row,
          });
        }
      }
    }
  }
  if (scope && scopeSkipped) warnings.push(`已按 --equipment 限定范围，台账中 ${scopeSkipped} 行不在范围内未参与判定`);
  if (!hasStatusCol && pairs.length) warnings.push('工作表「备用设备台账」无「备机状态」列，所有备机按备用处理；检修中备机请在台账填「检修中」以免误提醒，备机完好台数不计算');
  if (!hasGroupCol && pairs.length) warnings.push('工作表「备用设备台账」无「机组/泵组」列，以主用位号/备用位号组合作机组键');
  if (recs && !recHasDirection && switchRecsByTag.size) warnings.push('工作表「切换盘车记录」无「切换后主用」列，当前主用无法从记录推导，按台账主用/备用列展示（未按切换次数奇偶猜测）');

  const byGroup = (x, y) => C.str(x.groupKey).localeCompare(C.str(y.groupKey), 'zh');
  for (const k of KINDS) {
    bucket[k.key].overdue.sort((x, y) => y.overdueDays - x.overdueDays || byGroup(x, y));
    bucket[k.key].dueSoon.sort((x, y) => x.remainDays - y.remainDays || byGroup(x, y));
    bucket[k.key].normal.sort(byGroup);
  }
  undetermined.sort(byGroup);
  pairingIssues.sort((x, y) => C.str(x.mainTag || x.standbyTag).localeCompare(C.str(y.mainTag || y.standbyTag), 'zh'));
  longIdle.sort((x, y) => y.idleDays - x.idleDays || byGroup(x, y));
  standbyUnavailable.sort(byGroup);

  // 备机完好（可随时投用）：检修中/停用不计入分子；状态列缺失或有未填/无法识别时不算比率
  const standbyAvailable = pairs.filter((p) => p.standbyStatus === 'standby').length;
  const standbyAvailability = {
    pairs: pairs.length,
    available: hasStatusCol ? standbyAvailable : null,
    inRepair: standbyUnavailable.filter((x) => x.standbyStatus === 'repair').length,
    stopped: standbyUnavailable.filter((x) => x.standbyStatus === 'stopped').length,
    statusMissing: hasStatusCol ? statusMissing : null,
    statusUnknown: hasStatusCol ? statusUnknown : null,
    rate: hasStatusCol && pairs.length && statusMissing === 0 && statusUnknown === 0 ? C.round((standbyAvailable / pairs.length) * 100, 1) : null,
    note: '备机完好 = 可随时投用的备机台数 / 主备组数；检修中、停用备机不计入分子；状态未填或无法识别时不算比率（显示「—」）',
  };
  if (hasStatusCol && (statusMissing || statusUnknown) && pairs.length) warnings.push(`备机状态有 ${statusMissing} 行未填、${statusUnknown} 行无法识别，备机完好率不计算（未按备用默认计入分子）`);

  // ---------------------------------------------------------------- 三、执行率
  let executionRate = null;
  let records = null;
  if (!recs) {
    warnings.push('输入中未找到「切换盘车记录」工作表，不统计执行率');
  } else {
    // 执行率统计区间：未指定 --from 时用默认区间（基准日前 DEFAULT_WINDOW_DAYS 天），
    // 并在 meta 与 warning 中写明；这是统计口径而非周期默认值，不影响任何到期判定。
    const windowFrom = from || C.addDays(date, -DEFAULT_WINDOW_DAYS);
    const windowDays = C.diffDays(date, windowFrom);
    if (!from) warnings.push(`未提供 --from，执行率按默认统计区间（基准日前 ${DEFAULT_WINDOW_DAYS} 天，即 ${windowFrom} 至 ${date}）计算；该区间仅用于执行率统计，不影响到期判定`);

    const list = [];
    let skipped = 0, unknownKind = 0, outOfRange = 0;
    // 位号 → 机组（主备任一位号都能映射到所属机组）
    const tagToPair = new Map();
    for (const p of pairs) { tagToPair.set(p.ledgerMainTag, p); tagToPair.set(p.ledgerStandbyTag, p); }
    const unmatched = new Map();      // 台账外位号 → 行号（全厂导出混入其他车间时合并成一条 warning）
    for (const r of recs) {
      const tag = C.str(recHasTag ? r['位号'] : r['设备编号']);
      if (!tag) { warnings.push(`工作表「切换盘车记录」第${r._row}行 位号为空，已跳过`); skipped++; continue; }
      if (!inScope(tag)) { skipped++; continue; }
      const d = C.normDate(r['日期']);
      if (C.str(r['日期']) && !d) warnings.push(`工作表「切换盘车记录」第${r._row}行 日期「${C.str(r['日期'])}」无法解析，该条不计入执行率`);
      const kind = normKind(r['作业类型']);
      if (!kind) {
        unknownKind++;
        warnings.push(`工作表「切换盘车记录」第${r._row}行 ${tag} 作业类型「${C.str(r['作业类型']) || '（空）'}」无法归入切换/盘车/试运，该条不计入执行率`);
      }
      const p = tagToPair.get(tag) || null;
      if (!p) { if (!unmatched.has(tag)) unmatched.set(tag, []); unmatched.get(tag).push(r._row); }
      const inWindow = d !== null && C.diffDays(d, windowFrom) >= 0 && C.diffDays(date, d) >= 0;
      if (d !== null && !inWindow) outOfRange++;
      list.push({
        date: d, dateRaw: C.str(r['日期']), tag, groupKey: p ? p.groupKey : null, pairKey: p ? p.pairKey : null,
        kind, kindLabel: kind ? KINDS.find((k) => k.key === kind).label : null,
        kindRaw: C.str(r['作业类型']), switchTo: C.str(r['切换后主用']) || null, by: C.str(r['执行人']), note: C.str(r['备注']),
        counted: !!(p && kind && inWindow),
        sheet: '切换盘车记录', row: r._row,
      });
    }
    if (unmatched.size) {
      const n = [...unmatched.values()].reduce((x, v) => x + v.length, 0);
      const detail = [...unmatched].map(([t, rows]) => `${t}（${rows.length <= 3 ? `第${rows.join('、')}行` : `${rows.length} 条，第${rows[0]}行起`}）`).join('、');
      const [t1, rows1] = [...unmatched][0];
      warnings.push(n === 1 ? `工作表「切换盘车记录」第${rows1[0]}行 位号「${t1}」在备用设备台账中无对应机组，该条不计入执行率（未自行猜测归属）`
        : `工作表「切换盘车记录」中 ${n} 条记录的位号在备用设备台账中无对应机组，不计入执行率（未自行猜测归属；记录表含其他车间设备时属正常）：${detail}`);
    }
    records = { total: list.length, skipped, unknownKind, outOfRange, items: list };

    // ---- 执行率：实际执行次数 / 计划次数；分母为 0 → null（显示「—」，不写 0%）
    const rateRows = [];
    const noPlan = [], zeroPlan = [], unavailable = [], shiftLevelRate = [];
    const totalByKind = {};
    for (const k of KINDS) totalByKind[k.key] = { planned: 0, actual: 0, hasPlan: false };

    for (const p of pairs) {
      const led = ledger.find((x) => x._row === p.row);
      if (p.standbyStatus === 'repair' || p.standbyStatus === 'stopped') { unavailable.push(`${p.groupKey}（${p.standbyStatusLabel}）`); continue; }
      for (const k of KINDS) {
        // 计划次数依赖周期；周期不可用的组不参与执行率（不按默认周期补）
        const periodDays = C.parsePeriod(led[k.period]);
        const rawPeriod = C.str(led[k.period]);
        if (k.key === 'trial' && !rawPeriod && !C.str(led[k.last])) continue;
        const start = windowFrom;
        let planned = null;
        const spanDays = C.diffDays(date, start);
        if (periodDays !== null && periodDays > 0 && periodDays < 1) {
          // 班次级/小时级周期：执行记录在巡检/盘车班记录里按班登记，不按日历区间折算计划次数
          shiftLevelRate.push(`${p.groupKey} ${k.label}（${rawPeriod}）`);
        } else if (periodDays !== null && periodDays > 0 && spanDays !== null && spanDays >= 0) {
          planned = Math.floor(spanDays / periodDays);
        }
        const actual = list.filter((x) => x.counted && x.pairKey === p.pairKey && x.kind === k.key).length;
        const rate = (planned === null || planned === 0) ? null : C.round((actual / planned) * 100, 1);
        if (planned === null) {
          if (!(periodDays !== null && periodDays > 0 && periodDays < 1)) noPlan.push(`${p.groupKey} ${k.label}`);
        } else if (planned === 0) {
          zeroPlan.push(`${p.groupKey} ${k.label}`);
        } else {
          totalByKind[k.key].planned += planned;
          totalByKind[k.key].actual += actual;
          totalByKind[k.key].hasPlan = true;
        }
        rateRows.push({
          groupKey: p.groupKey, pairKey: p.pairKey, mainTag: p.mainTag, standbyTag: p.standbyTag, name: p.name,
          kind: k.key, kindLabel: k.label,
          from: start || null, to: date, spanDays,
          periodRaw: rawPeriod || null, periodDays,
          planned, actual, rate, shiftLevel: periodDays !== null && periodDays > 0 && periodDays < 1,
        });
      }
    }
    if (noPlan.length) warnings.push(`以下项的计划次数无法计算（周期缺失或无法解析），执行率显示「—」（未按 0 计）：${noPlan.join('、')}`);
    if (zeroPlan.length) warnings.push(`以下项在统计区间（${windowFrom} 至 ${date}）内计划次数为 0，执行率分母为 0，显示「—」（未写 0%）：${zeroPlan.join('、')}`);
    if (shiftLevelRate.length) warnings.push(`以下项为班次级/小时级周期，执行率不按日历区间折算计划次数，显示「—」（按班记录请查巡检/盘车班记录）：${shiftLevelRate.join('、')}`);
    if (unavailable.length) warnings.push(`以下机组备机检修中/停用，不参与执行率统计：${unavailable.join('、')}`);
    const overall = {};
    for (const k of KINDS) {
      const t = totalByKind[k.key];
      overall[k.key] = {
        kindLabel: k.label,
        planned: t.hasPlan ? t.planned : null,
        actual: t.hasPlan ? t.actual : null,
        rate: t.hasPlan && t.planned > 0 ? C.round((t.actual / t.planned) * 100, 1) : null,
      };
    }
    executionRate = {
      from: windowFrom, to: date, windowDays,
      byPair: rateRows.sort((x, y) => byGroup(x, y) || KINDS.findIndex((k) => k.key === x.kind) - KINDS.findIndex((k) => k.key === y.kind)),
      overall,
      fromDefaulted: !from,
      note: '执行率 = 实际执行次数 / 计划次数；计划次数为 0 或无法计算时显示「—」，不按 0% 计。',
    };
  }

  // ---------------------------------------------------------------- 计数与产出
  const counts = {
    ledgerRows: ledger.length,
    pairs: pairs.length,
    pairingIssues: pairingIssues.length,
    switchOverdue: switchOverdue.length,
    switchDueSoon: switchDueSoon.length,
    switchNormal: switchNormal.length,
    turningOverdue: turningOverdue.length,
    turningDueSoon: turningDueSoon.length,
    turningNormal: turningNormal.length,
    trialOverdue: trialOverdue.length,
    trialDueSoon: trialDueSoon.length,
    trialNormal: trialNormal.length,
    longIdle: longIdle.length,
    standbyInRepair: standbyAvailability.inRepair,
    standbyStopped: standbyAvailability.stopped,
    standbyAvailable: standbyAvailability.available,
    standbyAvailabilityRate: standbyAvailability.rate,
    rolesFromRecords: pairs.filter((p) => p.roleSource === '切换记录').length,
    undetermined: undetermined.length,
    records: records === null ? null : records.total,
    countedRecords: records === null ? null : records.items.filter((x) => x.counted).length,
    switchRate: executionRate === null ? null : executionRate.overall.switch.rate,
    turningRate: executionRate === null ? null : executionRate.overall.turning.rate,
  };

  C.ensureDir(outDir);
  const result = {
    meta: {
      workshop: a.workshop, date, leadDays, overdueFactor, longIdleDays, from,
      longIdleBasis: longIdleDays !== null ? `≥${longIdleDays} 天（--long-idle-days）` : `≥${overdueFactor} 倍切换周期`,
      source: path.basename(a.input), equipmentScope: scope,
      recordsProvided: records !== null, generatedAt: C.localDateTime(),
      declaration: DECLARATION, generalDeclaration: GENERAL_DECLARATION,
    },
    counts,
    pairs,
    switchOverdue, switchDueSoon, switchNormal,
    turningOverdue, turningDueSoon, turningNormal,
    trialOverdue, trialDueSoon, trialNormal,
    longIdle, standbyUnavailable, standbyAvailability, undetermined, pairingIssues,
    executionRate, records, warnings,
  };
  fs.writeFileSync(path.join(outDir, 'rotation.json'), JSON.stringify(result, null, 2), 'utf8');
  fs.writeFileSync(path.join(outDir, 'rotation-report.md'), renderMd(a, result), 'utf8');

  C.emitOk(outDir, { ok: true, out: outDir, date, workshop: a.workshop, counts, warnings });
}

function renderMd(a, R) {
  const c = R.counts;
  const L = [];
  L.push(`# ${a.workshop} 备用设备切换盘车报告（基准日 ${R.meta.date}）`);
  L.push('');
  L.push(`数据来源：${R.meta.source}${R.meta.equipmentScope ? ` ｜ 设备范围：${R.meta.equipmentScope.join('、')}` : ''} ｜ 提前提醒天数：${R.meta.leadDays} 天 ｜ 长期未切换阈值：${R.meta.longIdleBasis}`);
  L.push(`生成时间：${R.meta.generatedAt}（北京时间） ｜ 编制：车间设备员 ｜ 报送：车间设备主任 / 公司设备管理部门（机动部/设备部）`);
  L.push('');
  L.push(`> **${R.meta.declaration}。**`);
  L.push('');
  L.push('## 一、到期概览');
  L.push('');
  L.push(C.mdTable(['指标', '数量'], [
    ['台账行数', c.ledgerRows],
    ['已配对机组（主备组）', c.pairs],
    ['主备无法配对', c.pairingIssues],
    ['当前主用按切换记录推导的机组', c.rolesFromRecords],
    ['切换逾期', c.switchOverdue],
    [`切换临期（≤${R.meta.leadDays}天）`, c.switchDueSoon],
    ['盘车逾期', c.turningOverdue],
    [`盘车临期（≤${R.meta.leadDays}天）`, c.turningDueSoon],
    ['试运逾期', c.trialOverdue],
    [`长期未切换（${R.meta.longIdleBasis}）`, c.longIdle],
    ['备机检修中（不进到期清单）', c.standbyInRepair],
    ['备机停用（不进到期清单）', c.standbyStopped],
    ['备机可随时投用台数', C.fmt(c.standbyAvailable)],
    ['备机完好率', C.pct(c.standbyAvailabilityRate)],
    ['无法判定', c.undetermined],
    ['切换盘车记录条数', c.records === null ? '—（未提供记录表）' : c.records],
    ['切换执行率', C.pct(c.switchRate)],
    ['盘车执行率', C.pct(c.turningRate)],
  ]));
  L.push('_「当前主用/当前备用」按切换记录中最近一次带切换方向的记录推导；无方向记录时按台账列展示，角色来源见 rotation.json 的 pairs.roleSource。_');
  L.push('');
  L.push('## 二、切换逾期与临期');
  L.push('');
  L.push('**切换逾期**');
  L.push('');
  L.push(C.mdTable(['机组', '当前主用', '当前备用', '设备名称', '装置', '切换周期', '上次切换', '应到期日', '逾期天数', '逾期程度'],
    R.switchOverdue.map((x) => [x.groupKey, x.mainTag, x.standbyTag, x.name || '—', x.unit || '—', x.periodRaw || '—', x.lastDate, x.dueDate, x.overdueDays, x.level])));
  L.push('**切换临期**');
  L.push('');
  L.push(C.mdTable(['机组', '当前主用', '当前备用', '设备名称', '装置', '切换周期', '上次切换', '应到期日', '剩余天数'],
    R.switchDueSoon.map((x) => [x.groupKey, x.mainTag, x.standbyTag, x.name || '—', x.unit || '—', x.periodRaw || '—', x.lastDate, x.dueDate, x.remainDays])));
  L.push('## 三、盘车逾期与临期');
  L.push('');
  L.push('**盘车逾期**');
  L.push('');
  L.push(C.mdTable(['机组', '当前主用', '当前备用', '设备名称', '装置', '盘车周期', '上次盘车', '应到期日', '逾期天数', '逾期程度'],
    R.turningOverdue.map((x) => [x.groupKey, x.mainTag, x.standbyTag, x.name || '—', x.unit || '—', x.periodRaw || '—', x.lastDate, x.dueDate, x.overdueDays, x.level])));
  L.push('**盘车临期**');
  L.push('');
  L.push(C.mdTable(['机组', '当前主用', '当前备用', '设备名称', '装置', '盘车周期', '上次盘车', '应到期日', '剩余天数', '备注'],
    R.turningDueSoon.map((x) => [x.groupKey, x.mainTag, x.standbyTag, x.name || '—', x.unit || '—', x.periodRaw || '—', x.lastDate, x.dueDate, x.remainDays, x.note || '—'])));
  if (R.trialOverdue.length || R.trialDueSoon.length) {
    L.push('**备用设备试运逾期 / 临期**');
    L.push('');
    L.push(C.mdTable(['机组', '当前主用', '当前备用', '设备名称', '试运周期', '上次试运', '应到期日', '状态', '天数'],
      R.trialOverdue.map((x) => [x.groupKey, x.mainTag, x.standbyTag, x.name || '—', x.periodRaw || '—', x.lastDate, x.dueDate, '逾期', x.overdueDays])
        .concat(R.trialDueSoon.map((x) => [x.groupKey, x.mainTag, x.standbyTag, x.name || '—', x.periodRaw || '—', x.lastDate, x.dueDate, '临期', x.remainDays]))));
  }
  L.push('## 四、长期未切换清单');
  L.push('');
  if (!R.longIdle.length) L.push('_无_\n');
  else {
    L.push(`_以下机组距上次切换已达到或超过阈值（${R.meta.longIdleBasis}），备机长期不动存在启动困难风险，建议安排盘车或试运确认可用性。_`);
    L.push('');
    L.push(C.mdTable(['机组', '当前主用', '当前备用', '设备名称', '装置', '上次切换', '未切换天数', '阈值', '阈值依据', '出处'],
      R.longIdle.map((x) => [x.groupKey, x.mainTag, x.standbyTag, x.name || '—', x.unit || '—', x.lastDate, x.idleDays, `${x.threshold} 天`, x.thresholdBasis, `${x.sheet} 第${x.row}行`])));
  }
  L.push('## 五、备机检修中与停用');
  L.push('');
  if (!R.standbyUnavailable.length) L.push('_无_\n');
  else {
    L.push('_以下机组备机处于检修中或停用，不进切换/盘车/试运到期清单，也不计入备机完好台数；检修完工三级验收后请更新台账「备机状态」。_');
    L.push('');
    L.push(C.mdTable(['机组', '当前主用', '备机', '设备名称', '装置', '备机状态', '切换周期', '上次切换', '处理', '出处'],
      R.standbyUnavailable.map((x) => [x.groupKey, x.mainTag, x.standbyTag, x.name || '—', x.unit || '—', x.standbyStatusRaw, x.switchPeriodRaw || '—', x.lastSwitchDate || '—', x.note, `${x.sheet} 第${x.row}行`])));
  }
  L.push(`_${R.standbyAvailability.note}_`);
  L.push('');
  L.push('## 六、执行率统计');
  L.push('');
  if (R.executionRate === null) L.push('_未提供「切换盘车记录」数据，不统计执行率。_\n');
  else {
    L.push(`_${R.executionRate.note}_`);
    L.push('');
    L.push(`统计区间：${R.executionRate.from} 至 ${R.executionRate.to}（共 ${R.executionRate.windowDays} 天）${R.executionRate.fromDefaulted ? '，未指定 `--from`，按默认区间统计' : ''}`);
    L.push('');
    L.push('**合计**');
    L.push('');
    L.push(C.mdTable(['工作类型', '计划次数', '实际执行次数', '执行率'],
      ['switch', 'turning', 'trial'].map((k) => {
        const o = R.executionRate.overall[k];
        return [o.kindLabel, C.fmt(o.planned), C.fmt(o.actual), C.pct(o.rate)];
      })));
    L.push('**按机组**');
    L.push('');
    L.push(C.mdTable(['机组', '当前主用', '当前备用', '工作类型', '统计区间', '周期', '计划次数', '实际执行次数', '执行率'],
      R.executionRate.byPair.map((x) => [x.groupKey, x.mainTag, x.standbyTag, x.kindLabel,
        `${x.from || '—'} ~ ${x.to}`, x.periodRaw || '—', C.fmt(x.planned), C.fmt(x.actual), C.pct(x.rate)])));
  }
  L.push('## 七、无法判定与主备配对异常');
  L.push('');
  L.push('**无法判定清单**');
  L.push('');
  if (!R.undetermined.length) L.push('_无_\n');
  else {
    L.push('_【未判定】以下项因周期或上次执行日期缺失/无法解析（或日期越界），未作到期判定；**未按默认周期（如一月一次）替用户设定**，请补齐台账后重跑。_');
    L.push('');
    L.push(C.mdTable(['机组', '当前主用', '当前备用', '设备名称', '工作类型', '周期原文', '上次执行原文', '缺失原因', '出处'],
      R.undetermined.map((x) => [x.groupKey, x.mainTag, x.standbyTag, x.name || '—', x.kindLabel, x.periodRaw || '（空）', x.lastDate || '（空）', x.reason, `${x.sheet} 第${x.row}行`])));
  }
  L.push('**主备配对异常**');
  L.push('');
  if (!R.pairingIssues.length) L.push('_无_\n');
  else {
    L.push('_【注意】以下台账行的主备位号无法配对，脚本**未自行猜测配对关系**，该行不参与到期判定与执行率统计，请设备员核实台账后重跑。_');
    L.push('');
    L.push(C.mdTable(['机组', '主用位号', '备用位号', '设备名称', '装置', '原因', '出处'],
      R.pairingIssues.map((x) => [x.groupKey || '—', x.mainTag || '（空）', x.standbyTag || '（空）', x.name || '—', x.unit || '—', x.reason, `${x.sheet} 第${x.row}行`])));
  }
  L.push('## 八、备用设备管理说明');
  L.push('');
  L.push('<!-- ANALYSIS_START -->');
  L.push('（由模型依据 references/rotation-rules.md 口径撰写 200~350 字，结构：到期概览 → 逾期项与启动失败风险 → 长期未切换与检修中备机 → 执行率情况 → 下一步安排。数量、天数、执行率一律引用 rotation.json。）');
  L.push('<!-- ANALYSIS_END -->');
  L.push('');
  L.push(`> **${R.meta.declaration}。** 本技能不编制切换操作方案与操作票，不判定工艺是否具备切换条件；切换条件确认由工艺归口，操作票执行由操作班组归口。`);
  L.push('');
  L.push(`> ${R.meta.generalDeclaration}`);
  L.push('');
  if (R.warnings.length) {
    L.push('## 附、数据提示');
    L.push('');
    for (const w of R.warnings) L.push(`- ${w}`);
    L.push('');
  }
  return L.join('\n');
}

try { main(); } catch (e) { C.fail(e, warnings); }
