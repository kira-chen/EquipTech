#!/usr/bin/env node
'use strict';
/**
 * 巡检点检数据汇总脚本（仅 Node.js 内置模块）—— 中石化体系炼化厂车间设备员口径
 * 用法：node "<技能目录>/scripts/digest.js" --input <xlsx[,xlsx2]> --workshop "常减压车间" --date 2026-09-21 [--out <dir>]
 *       [--ledger <设备台账xlsx>] [--prev <上一日 status.json>] [--shift <班次说明>]
 *       [--source-type auto|patrol|spotcheck|monitor] [--shift-window HH:MM]
 * 产出：<out>/status.json、<out>/digest.md、<out>/summary.json；末行打印 JSON 摘要
 *
 * 数据来源三条线（口径对照第八节）：
 *   操作工巡检（智能巡检 APP 导出，一行一检查项）/ 专职点检（点检仪导出，含测值与是否报警）/ 状态监测（测振测温油液，无"结果"列只有测值与限值）
 * 逐行判异常的依据按优先级：检查结果 → 是否报警 → 测值对限值 → 运行状态列；都没有 → 未判定，不默认。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readXlsx, readCsvDir } = require('./lib/xlsx-lite');
const C = require('./lib/common');

const warnings = [];
const num = C.makeNum(warnings);
const VALUE_OPTS = ['input', 'workshop', 'date', 'out', 'ledger', 'prev', 'shift', 'source-type', 'shift-window'];
const FLAG_OPTS = ['help'];

const DECLARATION = '本材料由脚本汇总、模型成文，仅供设备员复核参考，不替代审批、定性、验收与签字；厂内制度与系统数据为准。';

/**
 * 别名：局部优先，再合并共享 SYSTEM_ALIASES（SAP PM / EM / 智能巡检 / 点检仪 导出列名）。
 * 注意：SAP「设备编号」是 8 位流水号不是位号，局部别名里不把「设备编号」归位号；
 *      「备注」不再作异常描述别名（备注多为自由文本，误把"正常"设备的备注当异常描述）。
 */
const ALIASES = C.mergeAliases({
  '位号': ['位号', '设备位号', '位号编码', 'TAG', 'tag'],
  '设备名称': ['设备名称', '设备描述', '名称'],
  '检查结果': ['检查结果', '检查结论', '巡检结果', '点检结果', '结果', '结论', '判定', '检查情况'],
  '运行状态': ['运行状态', '设备状态', '运行情况', '状态'],
  '异常描述': ['异常描述', '问题描述', '异常情况', '异常现象', '缺陷描述', '发现问题'],
  '检查时间': ['检查时间', '巡检时间', '点检时间', '记录时间', '检测时间', '上传时间', '采集时间', '时间'],
  '检查人': ['检查人', '巡检人', '点检人', '记录人', '执行人', '操作人'],
  '区域': ['区域', '装置区', '所在区域', '工厂区段', '装置', '装置名称', '位置'],
  '专业': ['专业', '所属专业'],
  '参数名': ['参数名', '检查项', '检查内容', '点检项目', '检查项目', '巡检项', '检测项', '监测项目', '参数名称', '项目'],
  '参数值': ['参数值', '测值', '测量值', '实测值', '读数', '数值'],
  '上限': ['上限', '上限值', '高报', '高报值', '报警上限', 'H'],
  '下限': ['下限', '下限值', '低报', '低报值', '报警下限', 'L'],
  '是否需巡检': ['是否需巡检', '需巡检', '是否巡检', '巡检范围'],
  '特护': ['特护', '是否特护', '特护设备', '特护标记', '特护机组'],
});
// 车间范围核对（D007）：「车间」只认 车间/所属车间/属地车间/运行部（及其后加「名称」），覆盖共享别名，
// 不让维护工厂/属地单位/使用单位/作业部占用「车间」字段；'车间' 放在各表 optional 列最后，避免抢走别的列
ALIASES['车间'] = [...C.WORKSHOP_COLS, ...C.WORKSHOP_COLS.map((c) => c + '名称')];

/**
 * 特护单列（中石化口径：重要度 A/B/C 与特护标记是两回事，关键设备 A 不等于特护）：
 * 「特护」列为 是/Y/1/特护 → 特护；或重要度/ABC标识的值本身写「特护」→ 特护。A、关键 不判特护。
 */
function isSpecial(r) {
  if (/^(是|Y|yes|true|1|√|✓|特护)/i.test(C.str(r['特护']))) return true;
  return /特护/.test(C.str(r['重要度']));
}

const SOURCE_TYPES = {
  patrol: { key: '巡检记录', label: '操作工巡检' },
  spotcheck: { key: '点检记录', label: '专职点检' },
  monitor: { key: '状态监测', label: '状态监测' },
};
// sheet 名识别（去空白与"表"字后包含匹配）；智能巡检 APP 导出常叫"巡检明细"，点检仪导出常叫"点检数据"
const SOURCES = [
  { type: 'patrol', names: ['巡检记录', '巡检明细', '智能巡检', '巡检数据', '巡检'] },
  { type: 'spotcheck', names: ['点检记录', '点检数据', '点检明细', '点检仪', '点检'] },
  { type: 'monitor', names: ['状态监测', '监测记录', '在线监测', '测振', '测温', '油液'] },
];

const RUN_STATE = [
  ['repair', /检修|维修|在修|修理/],
  ['standby', /备用|备机|停备|冷备|热备/],
  ['idle', /停用|停运|封存|闲置|长期停/],
  ['running', /运行|在用|开车|投用|投运/],
];
const RUN_CN = { running: '运行', standby: '备用', repair: '检修', idle: '停用' };
function parseRunState(v) {
  const s = C.str(v);
  if (!s) return null;
  for (const [k, re] of RUN_STATE) if (re.test(s)) return k;
  return 'unknown';
}
/** 是否报警列："是/Y/1/报警/超限/高报/低报" → true；"否/N/0/正常/无/未" → false；其它 null */
function parseAlarm(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const s = C.str(v).replace(/\s/g, '');
  if (/^(是|Y|YES|TRUE|1|报警|超限|高报|低报|高高报|低低报|HH|LL|H|L|越限|告警|ALARM)$/i.test(s)) return true;
  if (/^(否|N|NO|FALSE|0|正常|无|未报警|无报警|未超限|不报警|OK|—|-)$/i.test(s)) return false;
  return null;
}
function hasTimePart(raw) {
  if (raw === null || raw === undefined || raw === '') return false;
  if (typeof raw === 'number') return raw % 1 !== 0;
  return /\d{1,2}:\d{2}/.test(String(raw));
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
  const sourceType = a['source-type'] || 'auto';
  if (sourceType !== 'auto' && !SOURCE_TYPES[sourceType]) throw new Error(`--source-type 「${sourceType}」无效，可选 auto | patrol | spotcheck | monitor`);
  let shiftWindow = null;
  if (a['shift-window']) {
    const m = String(a['shift-window']).trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m || +m[1] > 23 || +m[2] > 59) throw new Error(`--shift-window 「${a['shift-window']}」无效，应为 HH:MM（班次日起算时刻，如 08:00）`);
    shiftWindow = `${m[1].padStart(2, '0')}:${m[2]}`;
  }

  const inputs = a.input.split(',').map((s) => s.trim()).filter(Boolean);
  for (const p of inputs) if (!fs.existsSync(p)) throw new Error(`输入不存在: ${p}`);
  const outDir = a.out || path.join(os.tmpdir(), 'idd-out');

  // ---- 读取记录
  const all = [];
  const foundSources = [];
  const basisUsed = new Set();
  const unrecognized = [];
  const scopes = [];   // 车间范围核对结果（每张主表一条）
  for (const p of inputs) {
    let book;
    try { book = loadBook(p); } catch (e) { throw new Error(`读取失败 ${p}: ${e.message}`); }
    const matched = new Set();
    const jobs = [];
    for (const s of SOURCES) {
      const rows = C.pickSheet(book, ...s.names);
      if (!rows) continue;
      const sheetName = Object.keys(book).find((k) => book[k] === rows) || s.names[0];
      if (matched.has(sheetName)) continue;
      matched.add(sheetName);
      jobs.push({ type: s.type, sheetName, rows });
    }
    for (const sheetName of Object.keys(book)) {
      if (matched.has(sheetName)) continue;
      if (sourceType !== 'auto') { jobs.push({ type: sourceType, sheetName, rows: book[sheetName], forced: true }); matched.add(sheetName); }
      else unrecognized.push(`${path.basename(p)}/${sheetName}`);
    }
    for (const job of jobs) {
      const label = SOURCE_TYPES[job.type].label;
      foundSources.push(`${path.basename(p)}/${job.sheetName}→${label}${job.forced ? '（--source-type 指定）' : ''}`);
      // 「特护」排在「重要度」前：共享别名「重要度」含「特护」，表头恰好是「特护」时不能被重要度抢走
      const sheetTag = `${path.basename(p)}/${job.sheetName}`;
      const raw = C.toRecords(job.rows, ['位号'], sheetTag,
        ['设备名称', '设备编号', '检查结果', '运行状态', '异常描述', '检查时间', '检查人', '区域', '专业', '参数名', '参数值', '上限', '下限', '是否报警', '特护', '重要度', '车间'], warnings, ALIASES);
      const ws = C.workshopScope(raw, a.workshop, sheetTag, warnings);
      scopes.push(ws.scope);
      const recs = ws.records;
      const has = (c) => recs.hasCol(c);
      if (!has('检查结果') && !has('是否报警') && !(has('参数值') && (has('上限') || has('下限'))) && !has('运行状态')) {
        warnings.push(`工作表「${sheetTag}」无「检查结果」「是否报警」「测值+限值」「运行状态」任一判定列，全部记录将进入未判定`);
      }
      for (const r of recs) {
        const tag = C.str(r['位号']);
        if (!tag) { warnings.push(`${r._sheet} 第${r._row}行 位号为空，已跳过`); continue; }
        const t = C.normDateTime(r['检查时间']);
        if (r['检查时间'] && !t) warnings.push(`${r._sheet} 第${r._row}行 检查时间「${C.str(r['检查时间'])}」无法解析`);
        let shiftDate = t ? t.slice(0, 10) : null;
        if (t && shiftWindow && hasTimePart(r['检查时间']) && t.slice(11, 16) < shiftWindow) shiftDate = C.addDays(t.slice(0, 10), -1);
        if (shiftDate && shiftDate !== date) {
          warnings.push(`${r._sheet} 第${r._row}行 记录时间 ${t}${shiftWindow ? `（班次日 ${shiftDate}）` : ''} 不是汇总日期 ${date}，已跳过`);
          continue;
        }
        const ctx = { sheet: r._sheet, row: r._row };
        const value = num(r['参数值'], { ...ctx, col: '参数值' });
        const hi = num(r['上限'], { ...ctx, col: '上限' });
        const lo = num(r['下限'], { ...ctx, col: '下限' });
        const alarm = parseAlarm(r['是否报警']);
        if (r['是否报警'] !== null && r['是否报警'] !== '' && alarm === null) warnings.push(`${r._sheet} 第${r._row}行 是否报警「${C.str(r['是否报警'])}」无法识别为是/否`);
        // 运行状态列存在但为空/不可识别 → 'unknown'（六档里进未判定，不默认为运行）；值为"正常/良好"类措辞按运行计
        let runState = has('运行状态') ? parseRunState(r['运行状态']) : null;
        if (has('运行状态') && (runState === null || runState === 'unknown')) runState = C.classifyResult(r['运行状态']) === 'normal' ? 'running' : 'unknown';
        // 逐行判定：检查结果 → 是否报警 → 测值对限值 → 运行状态（只在其值本身是正常/异常措辞时）
        let state = null, basis = null;
        const res = C.str(r['检查结果']) ? C.classifyResult(r['检查结果']) : null;
        if (res) { state = res; basis = '检查结果'; }
        else if (alarm !== null) { state = alarm ? 'abnormal' : 'normal'; basis = '是否报警'; }
        else if (value !== null && (hi !== null || lo !== null)) {
          state = (hi !== null && value > hi) || (lo !== null && value < lo) ? 'abnormal' : 'normal';
          basis = '测值对限值';
        } else if (has('运行状态') && C.str(r['运行状态'])) {
          const rs = C.classifyResult(r['运行状态']);
          if (rs === 'normal' || rs === 'abnormal') { state = rs; basis = '运行状态'; }
          else if (runState && runState !== 'unknown') { state = 'normal'; basis = '运行状态'; }
          else state = 'unknown';
        } else if (C.str(r['检查结果'])) state = 'unknown';
        if (basis) basisUsed.add(basis);
        const special = isSpecial(r);
        all.push({
          tag, name: C.str(r['设备名称']), eqNo: C.str(r['设备编号']), source: label, type: job.type,
          state, basis, rawResult: C.str(r['检查结果']) || (basis === '是否报警' ? `报警:${alarm ? '是' : '否'}` : basis === '测值对限值' ? `测值对限值:${state === 'abnormal' ? '超限' : '未超限'}` : basis === '运行状态' ? `运行状态:${C.str(r['运行状态'])}` : ''),
          runState, desc: C.str(r['异常描述']), time: t, by: C.str(r['检查人']),
          area: C.str(r['区域']), discipline: C.str(r['专业']),
          param: C.str(r['参数名']), value, hi, lo, alarm, special,
          row: r._row, sheet: r._sheet,
        });
      }
    }
  }
  if (unrecognized.length) warnings.push(`未识别的工作表（可用 --source-type patrol|spotcheck|monitor 指定来源类型后读取）：${unrecognized.join('、')}`);
  if (!foundSources.length) throw new Error('未在输入中找到「巡检记录/巡检明细」「点检记录/点检数据」「状态监测」任一工作表；工作表名不同时可用 --source-type 指定来源类型');

  // ---- 按位号聚合：一行一检查项按位号合并；任一检查项异常则设备异常；冲突只在同一检查项（或均无检查项）正常/异常并存时成立
  const byTag = new Map();
  for (const r of all) {
    if (!byTag.has(r.tag)) byTag.set(r.tag, []);
    byTag.get(r.tag).push(r);
  }
  const byEquipment = [], abnormal = [], conflicts = [], unknownState = [];
  for (const [tag, recs] of byTag) {
    const states = new Set(recs.map((r) => r.state).filter(Boolean));
    const groups = new Map();
    for (const r of recs) { const k = r.param || ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
    const conflictItems = [];
    for (const [k, g] of groups) {
      const gs = new Set(g.map((r) => r.state));
      if (gs.has('abnormal') && gs.has('normal')) conflictItems.push({ param: k || '（整机结论）', records: g.map((r) => ({ source: r.source, result: r.rawResult, value: r.value, time: r.time, by: r.by, sheet: r.sheet, row: r.row })) });
    }
    if (conflictItems.length) {
      conflicts.push({ tag, name: recs.find((r) => r.name)?.name || '', items: conflictItems,
        records: conflictItems.flatMap((c) => c.records.map((x) => ({ param: c.param, ...x }))),
        resolved: 'abnormal', basis: '就严原则：同一检查项既有正常又有异常记录时整机判为异常' });
    }
    let state;
    // 有未判定检查项（结果无法归类如「待查」，或为空且无其它判定依据）且没有异常项：整机判未判定，不因其余项正常就判正常
    const pendingItems = recs.filter((r) => r.state === 'unknown' || r.state === null);
    if (states.has('abnormal')) state = 'abnormal';
    else if (states.has('normal') && pendingItems.length) state = 'unknown';
    else if (states.has('normal')) state = 'normal';
    else if (states.has('unknown')) state = 'unknown';
    else state = 'unfilled';
    const rep = recs.find((r) => r.name) || recs[0];
    const runStates = recs.map((r) => r.runState).filter((x) => x && x !== 'unknown');
    const hasRunCol = recs.some((r) => r.runState !== null);
    let runState = runStates.length ? runStates[runStates.length - 1] : (hasRunCol ? 'unknown' : null);
    let stateCn;
    if (state === 'abnormal') stateCn = '异常';
    else if (state === 'normal') stateCn = runState && runState !== 'unknown' ? RUN_CN[runState] : (hasRunCol ? '未判定' : '运行');
    else stateCn = '未判定';
    const special = recs.some((r) => r.special);
    const abnormalItems = recs.filter((r) => r.state === 'abnormal').map((r) => ({ source: r.source, param: r.param || null, value: r.value, hi: r.hi, lo: r.lo, alarm: r.alarm, basis: r.basis, desc: r.desc || null }));
    const item = {
      tag, name: rep.name, eqNo: rep.eqNo || null, area: rep.area, discipline: rep.discipline, special, state, stateCn, runState,
      sources: [...new Set(recs.map((r) => r.source))],
      lastTime: recs.map((r) => r.time).filter(Boolean).sort().pop() || null,
      by: rep.by, itemCount: recs.length, abnormalItemCount: abnormalItems.length,
      results: recs.map((r) => ({ source: r.source, result: r.rawResult, basis: r.basis, desc: r.desc, param: r.param, value: r.value, hi: r.hi, lo: r.lo, alarm: r.alarm })),
    };
    byEquipment.push(item);
    if (state === 'abnormal') {
      const itemDesc = abnormalItems.map((x) => {
        const parts = [];
        if (x.param) parts.push(x.param);
        if (x.value !== null) parts.push(`${x.value}${x.hi !== null ? `（上限${x.hi}）` : ''}${x.lo !== null ? `（下限${x.lo}）` : ''}`);
        if (x.alarm === true) parts.push('报警');
        if (x.desc) parts.push(x.desc);
        return parts.join(' ');
      }).filter(Boolean);
      abnormal.push({
        tag, name: rep.name, area: rep.area, discipline: rep.discipline, special,
        desc: recs.map((r) => r.desc).filter(Boolean).join('；') || itemDesc.join('；') || recs.filter((r) => r.state === 'abnormal').map((r) => r.rawResult).filter(Boolean).join('；'),
        items: abnormalItems,
        source: [...new Set(recs.filter((r) => r.state === 'abnormal').map((r) => r.source))].join('、'),
        time: recs.filter((r) => r.state === 'abnormal').map((r) => r.time).filter(Boolean).sort()[0] || null,
        by: recs.find((r) => r.state === 'abnormal')?.by || '',
      });
    }
    if (state === 'unknown' && states.has('normal')) {
      const what = pendingItems.map((r) => `${r.param || '（整机结论）'}「${r.rawResult || '空'}」`).join('、');
      unknownState.push({ tag, name: rep.name, rawResults: recs.map((r) => r.rawResult), partial: true,
        pendingItems: pendingItems.map((r) => ({ param: r.param || null, result: r.rawResult || null, sheet: r.sheet, row: r.row })),
        reason: `部分检查项未判定：${what}；其余检查项正常、无异常项，整机不判正常` });
      warnings.push(`设备「${tag}」检查项 ${what} 未判定（其余正常、无异常项），整机判为未判定、未计入正常，请复核该项`);
    } else if (state === 'unknown' || state === 'unfilled') {
      unknownState.push({ tag, name: rep.name, rawResults: recs.map((r) => r.rawResult), reason: state === 'unfilled' ? '检查结果为空，且无是否报警、测值对限值、运行状态任一判定依据' : '检查结果无法归类为正常/异常' });
    }
  }
  const zh = (x, y) => x.tag.localeCompare(y.tag, 'zh');
  byEquipment.sort((x, y) => (y.special - x.special) || (x.state === 'abnormal' ? -1 : 0) - (y.state === 'abnormal' ? -1 : 0) || zh(x, y));
  abnormal.sort((x, y) => (y.special - x.special) || zh(x, y));

  // ---- 漏检识别（需台账）
  let missed = null;
  if (a.ledger) {
    if (!fs.existsSync(a.ledger)) throw new Error(`台账不存在: ${a.ledger}`);
    const lb = loadBook(a.ledger);
    const rows = C.pickSheet(lb, '设备台账', '台账', '设备清单', '技术对象', '功能位置清单');
    if (!rows) { warnings.push('台账文件中未找到「设备台账」工作表，无法识别漏检'); }
    else {
      const lr0 = C.toRecords(rows, ['位号'], '设备台账', ['设备名称', '区域', '专业', '是否需巡检', '特护', '重要度', '车间'], warnings, ALIASES);   // 「特护」在「重要度」前，理由同上
      // 台账混入其他车间设备会被误报漏检，同样按车间核对
      const lws = C.workshopScope(lr0, a.workshop, '设备台账', warnings);
      scopes.push(lws.scope);
      const lr = lws.records;
      missed = [];
      for (const r of lr) {
        const tag = C.str(r['位号']);
        if (!tag) continue;
        const need = C.str(r['是否需巡检']);
        if (need && /^(否|不|N|no)/i.test(need)) continue;
        const special = isSpecial(r);
        if (!byTag.has(tag)) missed.push({ tag, name: C.str(r['设备名称']), area: C.str(r['区域']), discipline: C.str(r['专业']), special });
        else if (special) {
          // 台账才有的特护标记（巡检记录多不带特护列）补到设备与异常清单，再重新置顶
          const it = byEquipment.find((x) => x.tag === tag); if (it) it.special = true;
          const ab = abnormal.find((x) => x.tag === tag); if (ab) ab.special = true;
        }
      }
      missed.sort((x, y) => (y.special - x.special) || zh(x, y));
      byEquipment.sort((x, y) => (y.special - x.special) || (x.state === 'abnormal' ? -1 : 0) - (y.state === 'abnormal' ? -1 : 0) || zh(x, y));
      abnormal.sort((x, y) => (y.special - x.special) || zh(x, y));
    }
  } else {
    warnings.push('未提供设备台账（--ledger），无法识别漏检设备');
  }

  // ---- 状态变化（需上一日）
  let changed = null;
  if (a.prev) {
    if (!fs.existsSync(a.prev)) throw new Error(`上一日 status.json 不存在: ${a.prev}`);
    let prev;
    try { prev = JSON.parse(fs.readFileSync(a.prev, 'utf8')); } catch (e) { throw new Error(`上一日 status.json 解析失败: ${e.message}`); }
    const pm = new Map((prev.byEquipment || []).map((x) => [x.tag, x.state]));
    changed = [];
    for (const it of byEquipment) {
      const before = pm.get(it.tag);
      if (before && before !== it.state) changed.push({ tag: it.tag, name: it.name, from: before, to: it.state });
    }
  }

  const STATE_CN = { normal: '正常', abnormal: '异常', unknown: '未判定', unfilled: '未填写' };
  const sixTier = { 运行: 0, 备用: 0, 检修: 0, 停用: 0, 异常: 0, 未判定: 0 };
  for (const it of byEquipment) sixTier[it.stateCn] = (sixTier[it.stateCn] || 0) + 1;
  const counts = {
    records: all.length,
    equipment: byEquipment.length,
    normal: byEquipment.filter((x) => x.state === 'normal').length,
    abnormal: abnormal.length,
    unknown: unknownState.length,
    missed: missed === null ? null : missed.length,
    conflicts: conflicts.length,
    changed: changed === null ? null : changed.length,
    special: byEquipment.filter((x) => x.special).length,
    specialAbnormal: abnormal.filter((x) => x.special).length,
    sixTier,
  };

  // ---- 产出
  const wsNote = C.workshopScopeNote(scopes, a.workshop);
  C.ensureDir(outDir);
  const status = {
    meta: { workshop: a.workshop, date, shift: a.shift || null, shiftWindow, sourceType, sources: foundSources, basisUsed: [...basisUsed], generatedAt: C.localDateTime(), ledgerProvided: !!a.ledger, workshopScope: scopes },
    counts, byEquipment, abnormal, missed, conflicts, unknownState, changed, warnings,
  };
  fs.writeFileSync(path.join(outDir, 'status.json'), JSON.stringify(status, null, 2), 'utf8');

  const sp = (x) => (x.special ? '特护 ' : '');
  const L = [];
  L.push(`# ${a.workshop} 设备状态一览（${date}）`);
  L.push('');
  if (wsNote.alert) { L.push(wsNote.alert); L.push(''); }
  L.push(`数据来源：${foundSources.join('、')}${a.shift ? ` ｜ 班次：${a.shift}` : ''}${shiftWindow ? ` ｜ 班次日起算 ${shiftWindow}（夜班跨 0 点记录归前一班次日）` : ''}`);
  L.push(`判定依据：${[...basisUsed].join('、') || '—'} ｜ 生成时间：${C.localDateTime()}（北京时间）`);
  if (wsNote.note) L.push(wsNote.note);
  L.push('');
  L.push('## 一、状态概览');
  L.push('');
  L.push(C.mdTable(['指标', '数量'], [
    ['记录条数', counts.records], ['涉及设备', counts.equipment],
    ['运行', sixTier.运行], ['备用', sixTier.备用], ['检修', sixTier.检修], ['停用', sixTier.停用],
    ['异常', sixTier.异常], ['未判定', sixTier.未判定],
    ['特护设备（其中异常）', `${counts.special}（${counts.specialAbnormal}）`],
    ['漏检', counts.missed === null ? '—（未提供台账）' : counts.missed],
    ['记录冲突', counts.conflicts],
  ]));
  if (!byEquipment.some((x) => x.runState !== null)) L.push('【注意】记录表无「运行状态」列，检查结果正常的设备按「运行」计；备用/检修/停用需台账或记录表提供运行状态列。\n');
  L.push('## 二、异常项清单');
  L.push('');
  L.push(C.mdTable(['位号', '设备名称', '区域', '专业', '异常检查项/描述', '来源', '发现时间', '发现人'],
    abnormal.map((x) => [`${sp(x)}${x.tag}`, x.name || '—', x.area || '—', x.discipline || '—', x.desc || '—', x.source, x.time || '—', x.by || '—'])));
  if (counts.specialAbnormal) L.push(`【注意】特护设备异常 ${counts.specialAbnormal} 台，按厂内特护设备管理要求当日上报车间设备主任并通知专业工程师。\n`);
  L.push('## 三、漏检清单');
  L.push('');
  if (missed === null) L.push('_未提供设备台账，无法识别漏检设备。_\n');
  else L.push(C.mdTable(['位号', '设备名称', '区域', '专业'], missed.map((x) => [`${sp(x)}${x.tag}`, x.name || '—', x.area || '—', x.discipline || '—'])));
  L.push('## 四、记录冲突');
  L.push('');
  if (!conflicts.length) L.push('_无_\n');
  else {
    for (const c of conflicts) {
      L.push(`**${c.tag}${c.name ? ' ' + c.name : ''}** —— ${c.basis}`);
      L.push('');
      L.push(C.mdTable(['检查项', '来源', '记录结果', '测值', '时间', '记录人', '出处'],
        c.records.map((r) => [r.param, r.source, r.result || '—', r.value === null ? '—' : r.value, r.time || '—', r.by || '—', `${r.sheet} 第${r.row}行`])));
    }
  }
  L.push('## 五、未判定项');
  L.push('');
  L.push(C.mdTable(['位号', '设备名称', '原始结果', '原因'],
    unknownState.map((x) => [x.tag, x.name || '—', x.rawResults.filter(Boolean).join('；') || '（空）', x.reason])));
  L.push('## 六、状态变化');
  L.push('');
  if (changed === null) L.push('_未提供上一日 status.json，不做状态变化对比。_\n');
  else L.push(C.mdTable(['位号', '设备名称', '上一日', '本日'], changed.map((x) => [x.tag, x.name || '—', STATE_CN[x.from] || x.from, STATE_CN[x.to] || x.to])));
  L.push('## 七、设备状态分析');
  L.push('');
  L.push('<!-- ANALYSIS_START -->');
  L.push('（由模型依据 references/digest-rules.md 口径撰写 200~400 字，结构：总体状态 → 异常项与影响 → 漏检与数据缺口 → 需上报或跟进事项。数字一律引用 status.json。）');
  L.push('<!-- ANALYSIS_END -->');
  L.push('');
  if (warnings.length) {
    L.push('## 附：数据提示');
    L.push('');
    for (const w of warnings) L.push(`- ${w}`);
    L.push('');
  }
  L.push('---');
  L.push(DECLARATION);
  L.push('');
  fs.writeFileSync(path.join(outDir, 'digest.md'), L.join('\n'), 'utf8');

  C.emitOk(outDir, { ok: true, out: outDir, date, workshop: a.workshop, counts, warnings });
}

try { main(); } catch (e) { C.fail(e, warnings); }
