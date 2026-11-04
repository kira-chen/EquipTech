#!/usr/bin/env node
'use strict';
/**
 * 故障调查资料归集脚本（仅 Node.js 内置模块）
 * 用法：node "<技能目录>/scripts/investigate.js" --tag "<位号>" --time <ISO8601带时区> \
 *         --symptom "<故障现象>" --records "<记录路径>[,<路径2>...]" [--out <dir>]
 * 可选：--before <回溯小时数，经验默认72> --after <后续小时数，经验默认24>
 *       --history "<检修历史xlsx，可为 SAP PM 工单导出>" --params "<运行参数xlsx>"
 *       --name "<设备名称>" --workshop "<车间>" --gap <数据缺口判定阈值分钟，经验默认120>
 *       （72/24/120 均为经验默认而非制度数值，须与用户确认后再定）
 * 产出：<out>/investigation.json、investigation.md、summary.json；末行打印 JSON 摘要
 *       默认输出目录为 <os.tmpdir()>/fia-out，建议始终传 --out
 * 报告框架对齐中石化设备事故调查报告常规章节：概况、经过、原因分析、责任分析、损失情况、防范措施（四不放过），
 *       其中原因/责任/防范措施三节恒为空，标「由调查组填写」；损失由调查组核定。
 *
 * 硬约束：
 *  1. 绝不做原因认定、事故定性与责任划分；md「分析与结论」章节恒为空，只写「（由调查组填写）」。
 *  2. 时间线只陈述记录中的事实；因果连接词与定性/责任表述一律扫描拦截（causalHits）。
 *  3. 各来源时间戳不一致 → 全部保留并标注来源与差异，绝不校准、绝不取其一。
 *  4. 时间窗口内数据缺口 → 标注缺口区间，绝不插值、绝不推测填补。
 *  5. 不涉及人员姓名与追责性内容（N1 检出即 warning）。
 *  6. md 必须含固定声明行，不得删改。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readXlsx, readCsvDir } = require('./lib/xlsx-lite');
const C = require('./lib/common');
const R = require('./lib/rules');

const warnings = [];
const num = C.makeNum(warnings);
const VALUE_OPTS = ['tag', 'time', 'symptom', 'records', 'out', 'before', 'after',
  'history', 'params', 'name', 'workshop', 'gap'];
const FLAG_OPTS = ['help'];

// 别名：局部优先，再并入共享 SYSTEM_ALIASES（SAP PM / EM / 智能巡检 / DCS 导出列名）。
// 「设备编号」不再作为位号别名——SAP 设备编号是 8 位流水号，不是功能位置/位号。
const ALIASES = C.mergeAliases({
  '时间': ['时间', '记录时间', '发生时间', '采集时间', '检查时间', '操作时间', '报警时间', '巡检时间', '时刻', '时间戳', '报警发生时间', '事件时间'],
  '内容': ['内容', '记录内容', '事件', '事件描述', '描述', '操作内容', '报警内容', '现象', '情况', '备注', '检查结果', '报警信息', '消息文本', '检查项'],
  '位号': ['位号', '设备位号', '功能位置', 'TAG', 'tag'],
  '参数名': ['参数名', '参数', '测点', '测点名称', '监测项目', '项目', '检测项', '测点号', '仪表位号', '点号', '点检项目'],
  '参数值': ['参数值', '数值', '测值', '测量值', '实测值', '读数', '值'],
  '单位': ['单位', '计量单位', '工程单位'],
  '来源': ['来源', '数据来源', '系统', '记录来源'], // 「系统」只应命中名为「系统」的列；「系统状态」由下面单列认领
  '系统状态': ['系统状态'],
  '级别': ['级别', '报警级别', '等级', '优先级', '报警优先级'],
  '岗位': ['岗位', '记录岗位', '班组', '专业', '执行岗位', '操作员'],
  '检修日期': ['检修日期', '日期', '完工日期', '施工日期', '开始日期', '实际结束日期', '技术完成日期', '实际完工', '基本结束日期', '基本开始日期'],
  '检修内容': ['检修内容', '作业内容', '工作内容', '内容', '项目内容', '短文本', '订单描述', '工单描述', '通知单描述', '描述'],
  '检修类别': ['检修类别', '类别', '检修类型', '工单类型', '订单类型', '维修类型', '工单类别'],
  '结论': ['结论', '验收结论', '验收结果', '结果'],
  '工单号': ['工单号', '工单编号', '订单', '订单号', '工单', 'PM订单', '维修订单号'],
  '通知单号': ['通知单号', '通知单', '维修通知单号', '通知单编号', '通知'],
});

// 记录来源类型定义：sheet 名 → 时间线 dataType
const RECORD_SHEETS = [
  { key: '运行参数', names: ['运行参数', '参数记录', 'DCS', '趋势'], dataType: '运行参数', kind: 'param' },
  { key: '报警记录', names: ['报警记录', '报警', 'SOE', '事件记录'], dataType: '报警', kind: 'alarm' },
  { key: '操作记录', names: ['操作记录', '操作'], dataType: '操作记录', kind: 'event' },
  { key: '巡检记录', names: ['巡检记录', '巡检', '点检记录'], dataType: '巡检记录', kind: 'event' },
  { key: '值班记录', names: ['值班记录', '值班', '交接班记录', '交接班'], dataType: '值班记录', kind: 'event' },
  { key: '检修历史', names: ['检修历史', '检修记录', '检修', '维修记录', '工单', '维修订单', 'IW38', 'IW39', 'IW47'], dataType: '检修历史', kind: 'maint' },
];

function loadBook(p) {
  const st = fs.statSync(p);
  return st.isDirectory() ? readCsvDir(p) : readXlsx(p);
}

/** 解析 ISO 8601 带时区时间，返回 {ms, cn}；格式不合规直接抛错 */
function parseIsoTz(v, argName) {
  const s = String(v).trim();
  if (!/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) {
    throw new Error(`${argName} 「${v}」缺少时区，应为 ISO 8601 带时区（如 2026-09-21T08:20:00+08:00）`);
  }
  const t = Date.parse(s);
  if (!Number.isFinite(t)) throw new Error(`${argName} 「${v}」不是有效时间，应为 ISO 8601 带时区（如 2026-09-21T08:20:00+08:00）`);
  return { ms: t, cn: C.localDateTime(new Date(t)) };
}

/** 「YYYY-MM-DD HH:mm」按北京时间转毫秒 */
function cnToMs(s) {
  if (!s) return null;
  const t = Date.parse(s.replace(' ', 'T') + ':00+08:00');
  return Number.isFinite(t) ? t : null;
}
/** 毫秒 → 「YYYY-MM-DD HH:mm」北京时间 */
function msToCn(ms) {
  if (ms === null || ms === undefined) return null;
  return C.localDateTime(new Date(ms)).slice(0, 16);
}

function main() {
  const a = C.parseArgs(process.argv.slice(2), VALUE_OPTS, FLAG_OPTS);
  if (a.help) { console.log(JSON.stringify({ ok: true, usage: 'node scripts/investigate.js --tag <位号> --time <ISO8601> --symptom <故障现象> --records <路径[,路径2]> [--out <dir>] [--before 72] [--after 24]' })); return; }

  if (!a.tag) throw new Error('缺少 --tag（设备位号），调查材料必须挂到具体设备');
  if (!a.time) throw new Error('缺少 --time（故障发生时间，ISO 8601 带时区）');
  if (!a.symptom) throw new Error('缺少 --symptom（故障现象）');
  if (!a.records) throw new Error('缺少 --records（故障相关记录路径）');

  const evt = parseIsoTz(a.time, '--time');

  // 72 / 24 / 120 为经验默认，不是制度数值；是否使用了默认值记入 meta.window.defaulted 并在 md 提示
  const defaulted = { before: a.before === undefined, after: a.after === undefined, gap: a.gap === undefined };
  const before = a.before === undefined ? 72 : Number(a.before);
  const after = a.after === undefined ? 24 : Number(a.after);
  if (!Number.isFinite(before) || before <= 0) throw new Error(`--before 「${a.before}」应为正数小时`);
  if (!Number.isFinite(after) || after <= 0) throw new Error(`--after 「${a.after}」应为正数小时`);
  const gapMin = a.gap === undefined ? 120 : Number(a.gap);
  if (!Number.isFinite(gapMin) || gapMin <= 0) throw new Error(`--gap 「${a.gap}」应为正数分钟`);

  const winStart = evt.ms - before * 3600000;
  const winEnd = evt.ms + after * 3600000;

  const inputs = a.records.split(',').map((s) => s.trim()).filter(Boolean);
  for (const p of inputs) if (!fs.existsSync(p)) throw new Error(`记录不存在: ${p}`);
  if (a.history && !fs.existsSync(a.history)) throw new Error(`检修历史不存在: ${a.history}`);
  if (a.params && !fs.existsSync(a.params)) throw new Error(`运行参数文件不存在: ${a.params}`);
  const outDir = a.out || path.join(os.tmpdir(), 'fia-out');

  // ---- 一、读取各来源记录
  const entries = [];        // 窗口内的全部条目
  const outOfWindow = [];    // 窗口外条目（不丢弃，单列）
  const foundSheets = [];
  const files = inputs.slice();
  if (a.params) files.push(a.params);
  if (a.history) files.push(a.history);

  for (const p of files) {
    let book;
    try { book = loadBook(p); } catch (e) { throw new Error(`读取失败 ${p}: ${e.message}`); }
    const base = path.basename(p);
    for (const def of RECORD_SHEETS) {
      const rows = C.pickSheet(book, ...def.names);
      if (!rows) continue;
      foundSheets.push(`${base}→${def.key}`);
      const sheetName = `${base}/${def.key}`;
      if (def.kind === 'maint') {
        const recs = C.toRecords(rows, ['检修日期', '检修内容'], sheetName,
          ['位号', '检修类别', '结论', '岗位', '来源', '工单号', '通知单号', '系统状态'], warnings, ALIASES);
        for (const r of recs) {
          const d = C.normDate(r['检修日期']);
          if (r['检修日期'] && !d) warnings.push(`工作表「${sheetName}」第${r._row}行 检修日期「${C.str(r['检修日期'])}」无法解析，条目保留但无时间`);
          entries.push({
            kind: 'maint', dataType: def.dataType, sheet: sheetName, row: r._row,
            source: C.str(r['来源']) || def.key, file: base,
            timeCn: d ? `${d} 00:00` : null, timeRaw: C.str(r['检修日期']),
            tag: C.str(r['位号']) || null,
            content: C.str(r['检修内容']),
            category: C.str(r['检修类别']), categoryNorm: R.normRepairCategory(r['检修类别']),
            conclusion: C.str(r['结论']),
            post: C.str(r['岗位']),
            orderNo: C.str(r['工单号']) || null, noticeNo: C.str(r['通知单号']) || null,
          });
        }
        continue;
      }
      const required = def.kind === 'param' ? ['时间', '参数名'] : ['时间', '内容'];
      // 「系统状态」单列认领（全等匹配优先），免得「来源」的别名「系统」按前缀把 SAP 系统状态列当成来源
      const optional = def.kind === 'param'
        ? ['位号', '参数值', '单位', '来源', '内容', '系统状态']
        : ['位号', '来源', '级别', '岗位', '参数名', '参数值', '单位', '系统状态'];
      const recs = C.toRecords(rows, required, sheetName, optional, warnings, ALIASES);
      for (const r of recs) {
        const t = C.normDateTime(r['时间']);
        if (!t) {
          warnings.push(`工作表「${sheetName}」第${r._row}行 时间「${C.str(r['时间'])}」缺失或无法解析，已列入「时间戳缺失」，不推测补齐`);
        }
        const ms = t ? cnToMs(t) : null;
        const item = {
          kind: def.kind, dataType: def.dataType, sheet: sheetName, row: r._row,
          source: C.str(r['来源']) || def.key, file: base,
          timeCn: t, ms, timeRaw: C.str(r['时间']),
          tag: C.str(r['位号']) || null,
          content: C.str(r['内容']),
          param: C.str(r['参数名']), unit: C.str(r['单位']),
          value: num(r['参数值'], { sheet: sheetName, row: r._row, col: '参数值' }),
          rawValue: C.str(r['参数值']),
          level: C.str(r['级别']), post: C.str(r['岗位']),
        };
        if (ms !== null && (ms < winStart || ms > winEnd)) {
          outOfWindow.push({ ...item, note: `记录时间 ${t} 不在时间窗口 ${msToCn(winStart)} ~ ${msToCn(winEnd)} 内` });
          warnings.push(`工作表「${sheetName}」第${r._row}行 记录时间 ${t} 超出时间窗口，已单列于 outOfWindow，未计入时间线`);
          continue;
        }
        entries.push(item);
      }
    }
  }
  if (!foundSheets.length) {
    throw new Error(`未在输入中找到「${RECORD_SHEETS.map((x) => x.key).join('」「')}」任一工作表`);
  }

  // ---- 二、时间戳缺失（不推测补齐，单列）
  const missingTime = entries.filter((e) => e.kind !== 'maint' && !e.timeCn)
    .map((e) => ({ sheet: e.sheet, row: e.row, source: e.source, dataType: e.dataType, content: e.content || e.param, timeRaw: e.timeRaw, note: '时间戳缺失或无法解析，未推测补齐，不参与时间线排序' }));
  const maintNoTime = entries.filter((e) => e.kind === 'maint' && !e.timeCn)
    .map((e) => ({ sheet: e.sheet, row: e.row, source: e.source, dataType: e.dataType, content: e.content, timeRaw: e.timeRaw, note: '检修日期缺失或无法解析，未推测补齐' }));

  // ---- 三、时间线（只含有时间的非检修条目，按时间升序）
  const timeline = entries
    .filter((e) => e.kind !== 'maint' && e.ms !== null)
    .sort((x, y) => (x.ms - y.ms) || x.sheet.localeCompare(y.sheet) || (x.row - y.row))
    .map((e) => {
      let content = e.content;
      if (!content && e.param) {
        content = `${e.param}${e.rawValue !== '' ? ' ' + e.rawValue : ''}${e.unit ? ' ' + e.unit : ''}`.trim();
      }
      return {
        time: e.timeCn, source: e.source, file: e.file, sheet: e.sheet, row: e.row,
        dataType: e.dataType, content: content || '（记录内容为空）',
        tag: e.tag, param: e.param || null, value: e.value, unit: e.unit || null,
        level: e.level || null, post: e.post || null,
        offsetHours: C.round((e.ms - evt.ms) / 3600000, 2),
      };
    });

  // ---- 四、参数条目与报警序列
  const paramChanges = entries
    .filter((e) => e.kind === 'param' && e.ms !== null)
    .sort((x, y) => (x.ms - y.ms) || (x.row - y.row))
    .map((e) => ({
      time: e.timeCn, source: e.source, sheet: e.sheet, row: e.row,
      tag: e.tag, param: e.param || '（未填参数名）', value: e.value, unit: e.unit || null,
      rawValue: e.rawValue, offsetHours: C.round((e.ms - evt.ms) / 3600000, 2),
      note: e.value === null && e.rawValue !== '' ? '参数值无法解析为数字，按空值处理，未按 0 计' : null,
    }));
  const alarms = entries
    .filter((e) => e.kind === 'alarm' && e.ms !== null)
    .sort((x, y) => (x.ms - y.ms) || (x.row - y.row))
    .map((e, i) => ({
      seq: i + 1, time: e.timeCn, source: e.source, sheet: e.sheet, row: e.row,
      tag: e.tag, content: e.content || e.param || '（记录内容为空）',
      level: e.level || null, offsetHours: C.round((e.ms - evt.ms) / 3600000, 2),
    }));
  const maintenanceHistory = entries
    .filter((e) => e.kind === 'maint')
    .sort((x, y) => String(y.timeCn || '').localeCompare(String(x.timeCn || '')))
    .map((e) => ({
      date: e.timeCn ? e.timeCn.slice(0, 10) : null, sheet: e.sheet, row: e.row,
      tag: e.tag, category: e.category || null, categoryNorm: e.categoryNorm || null,
      orderNo: e.orderNo, noticeNo: e.noticeNo,
      content: e.content || '（记录内容为空）',
      conclusion: e.conclusion || null, post: e.post || null, source: e.source,
      daysBeforeFailure: e.timeCn ? C.diffDays(evt.cn.slice(0, 10), e.timeCn.slice(0, 10)) : null,
    }));

  // ---- 五、数据缺口（只标注，绝不插值填补）
  // 口径：仅对**连续采样类**数据（运行参数）判缺口——操作/巡检/值班/报警属事件触发型，
  //       本就疏密不均，不按缺口论。同一来源相邻两条记录间隔 > gapMin 分钟即记为缺口；
  //       窗口起止与首末条之间的空档同样记为缺口。
  //       窗口终点晚于当前时间（平台取数时 --after 常超过当前时刻）时，缺口只判到当前时间：
  //       尚未到达的时段没有记录是正常的，不算缺口。
  const nowMs = Date.now();
  const gapEnd = Math.max(winStart, Math.min(winEnd, nowMs));
  const gapEndCapped = gapEnd < winEnd;
  if (gapEndCapped) {
    warnings.push(`时间窗口终点 ${msToCn(winEnd)} 晚于当前时间 ${msToCn(nowMs)}，数据缺口只判到当前时间，尚未到达的时段不计缺口`);
  }
  const dataGaps = [];
  const bySource = new Map();
  for (const e of timeline) {
    if (e.dataType !== '运行参数') continue;
    const key = `${e.source}｜${e.dataType}`;
    if (!bySource.has(key)) bySource.set(key, []);
    bySource.get(key).push(e);
  }
  // 窗口内完全没有运行参数数据 → 整窗记为缺口，且明确写明未提供
  if (!bySource.size) {
    dataGaps.push({
      source: '（无连续采样数据）', dataType: '运行参数',
      from: msToCn(winStart), to: msToCn(gapEnd),
      minutes: Math.round((gapEnd - winStart) / 60000), position: gapEndCapped ? '整个时间窗口（判至当前时间）' : '整个时间窗口',
      note: '时间窗口内未提供运行参数数据，整窗记为缺口，未作插值或推测填补',
    });
    warnings.push('时间窗口内未提供运行参数（连续采样）数据，整窗记为数据缺口，不作任何推测填补');
  }
  const gapMs = gapMin * 60000;
  for (const [key, list] of bySource) {
    const [source, dataType] = key.split('｜');
    const times = list.map((x) => cnToMs(x.time)).sort((p, q) => p - q);
    if (times[0] - winStart > gapMs) {
      dataGaps.push({ source, dataType, from: msToCn(winStart), to: msToCn(times[0]),
        minutes: Math.round((times[0] - winStart) / 60000), position: '窗口起点至首条记录',
        note: '该区间无记录，缺口原样标注，未作插值或推测填补' });
    }
    for (let i = 1; i < times.length; i++) {
      if (times[i] - times[i - 1] > gapMs) {
        dataGaps.push({ source, dataType, from: msToCn(times[i - 1]), to: msToCn(times[i]),
          minutes: Math.round((times[i] - times[i - 1]) / 60000), position: '相邻记录之间',
          note: '该区间无记录，缺口原样标注，未作插值或推测填补' });
      }
    }
    if (gapEnd - times[times.length - 1] > gapMs) {
      dataGaps.push({ source, dataType, from: msToCn(times[times.length - 1]), to: msToCn(gapEnd),
        minutes: Math.round((gapEnd - times[times.length - 1]) / 60000), position: gapEndCapped ? '末条记录至当前时间（窗口终点尚未到达）' : '末条记录至窗口终点',
        note: '该区间无记录，缺口原样标注，未作插值或推测填补' });
    }
  }
  dataGaps.sort((x, y) => String(x.from).localeCompare(String(y.from)));

  // ---- 六、时间戳不一致（全部保留，绝不校准、绝不取其一）
  // 口径：内容高度相似（归一后相同）的条目来自不同来源且时间不同 → 全部保留并标注差异。
  const normContent = (s) => String(s || '').replace(/[\s，,。.、；;：:（）()【】\[\]「」“”"']/g, '');
  const byContent = new Map();
  for (const e of timeline) {
    const k = normContent(e.content);
    if (!k) continue;
    if (!byContent.has(k)) byContent.set(k, []);
    byContent.get(k).push(e);
  }
  const timeInconsistency = [];
  for (const [k, list] of byContent) {
    if (list.length < 2) continue;
    const srcs = new Set(list.map((x) => x.source));
    const tms = new Set(list.map((x) => x.time));
    if (srcs.size < 2 || tms.size < 2) continue;
    const ms = list.map((x) => cnToMs(x.time));
    const diffMin = Math.round((Math.max(...ms) - Math.min(...ms)) / 60000);
    timeInconsistency.push({
      content: list[0].content,
      records: list.map((x) => ({ source: x.source, time: x.time, sheet: x.sheet, row: x.row, dataType: x.dataType })),
      maxDiffMinutes: diffMin,
      resolution: '全部保留，按来源分别标注；脚本不校准时间、不取其一',
      note: '各来源时间戳存在差异，差异原因须由调查组核实系统对时情况后认定',
    });
    warnings.push(`时间戳不一致：「${list[0].content}」在 ${list.map((x) => `${x.source} ${x.time}`).join('、')} 分别有记录，最大差异 ${diffMin} 分钟，已全部保留，未作校准`);
  }
  timeInconsistency.sort((x, y) => y.maxDiffMinutes - x.maxDiffMinutes);

  // ---- 七、禁止表述扫描（时间线内容 + 故障现象）
  let causalHits = [];
  const scanTargets = [{ field: '故障现象', text: a.symptom, loc: '--symptom' }];
  for (const e of timeline) scanTargets.push({ field: `时间线 ${e.time}`, text: e.content, loc: `${e.sheet} 第${e.row}行` });
  for (const m of maintenanceHistory) scanTargets.push({ field: `检修历史 ${m.date || '无日期'}`, text: m.content, loc: `${m.sheet} 第${m.row}行` });
  for (const t of scanTargets) {
    if (!t.text) continue;
    causalHits = causalHits.concat(R.scanCausal(t.text, t.field).map((h) => ({ ...h, loc: t.loc })));
    causalHits = causalHits.concat(R.scanBlameNames(t.text, t.field).map((h) => ({ ...h, loc: t.loc })));
  }
  for (const h of causalHits) {
    warnings.push(`检出禁用表述「${h.text}」（${h.categoryCn}，规则 ${h.ruleId}，位于${h.field}第${h.index + 1}字，出处 ${h.loc}）：${h.why}；建议：${h.suggest}`);
  }
  const causalByCategory = {};
  for (const h of causalHits) causalByCategory[h.categoryCn] = (causalByCategory[h.categoryCn] || 0) + 1;

  // ---- 八、待查材料清单
  const dutyLogs = timeline.filter((x) => x.dataType === '值班记录').length;
  const toInvestigate = R.buildToInvestigate({
    alarms: alarms.length, maintenanceHistory: maintenanceHistory.length,
    dutyLogs, dataGaps: dataGaps.length, timeInconsistency: timeInconsistency.length,
  });

  const counts = {
    timeline: timeline.length,
    paramChanges: paramChanges.length,
    alarms: alarms.length,
    maintenanceHistory: maintenanceHistory.length,
    dataGaps: dataGaps.length,
    timeInconsistency: timeInconsistency.length,
    missingTime: missingTime.length + maintNoTime.length,
    outOfWindow: outOfWindow.length,
    causalHits: causalHits.length,
    causalByCategory,
    toInvestigate: toInvestigate.length,
    sources: [...new Set(timeline.map((x) => x.source))].length,
  };

  // ---- 产出 JSON
  C.ensureDir(outDir);
  const result = {
    meta: {
      tag: a.tag, name: a.name || null, workshop: a.workshop || null,
      symptom: a.symptom, failureTime: evt.cn,
      window: { before, after, start: msToCn(winStart), end: msToCn(winEnd), gapThresholdMinutes: gapMin, gapCheckedUntil: msToCn(gapEnd), defaulted },
      defaultsNote: R.DEFAULTS_NOTE,
      sources: foundSheets, generatedAt: C.localDateTime(),
      disclaimer: R.DISCLAIMER,
      disclaimerGeneral: R.DISCLAIMER_GENERAL,
      gradingNote: R.GRADING_NOTE,
      scopeNote: R.REFUSAL_NOTE,
      reportFramework: ['一、故障概况', '二、故障经过（时间线）', '三、故障前后参数与报警', '四、相关检修与变更历史', '五、数据缺口与时间戳差异', '六、待查材料清单', '七、原因分析', '八、责任分析', '九、损失情况', '十、防范措施'],
    },
    counts,
    timeline, paramChanges, alarms, maintenanceHistory,
    dataGaps, timeInconsistency,
    missingTime: missingTime.concat(maintNoTime), outOfWindow,
    causalHits, toInvestigate,
    analysis: {
      conclusion: null, cause: null, responsibility: null, loss: null, measures: null,
      filledBy: '调查组', note: R.ANALYSIS_PLACEHOLDER, lossNote: R.LOSS_PLACEHOLDER,
      principle: '四不放过：事故原因未查清不放过、责任人员未处理不放过、整改措施未落实不放过、有关人员未受到教育不放过（由调查组落实，本材料不填写）',
    },
    warnings,
  };
  fs.writeFileSync(path.join(outDir, 'investigation.json'), JSON.stringify(result, null, 2), 'utf8');

  // ---- 产出 Markdown（十节：对齐中石化设备事故调查报告常规章节；七/八/十恒为空，九由调查组核定）
  const title = `${a.workshop ? a.workshop + ' ' : ''}${a.tag}${a.name ? ' ' + a.name : ''} 故障调查资料归集`;
  const L = [];
  L.push(`# ${title}`);
  L.push('');
  L.push(`故障发生时间：${evt.cn}（北京时间）　时间窗口：故障前 ${before} 小时至故障后 ${after} 小时（${msToCn(winStart)} ~ ${msToCn(winEnd)}）`);
  L.push(`数据来源：${foundSheets.join('、')}`);
  L.push(`生成时间：${C.localDateTime()}（北京时间）`);
  L.push('');
  L.push('> ' + R.DISCLAIMER + '。');
  L.push('> ' + R.DISCLAIMER_GENERAL);
  L.push('');
  const usedDefaults = Object.keys(defaulted).filter((k) => defaulted[k]);
  if (usedDefaults.length) {
    L.push(`【注意】本次 ${usedDefaults.map((k) => ({ before: '回溯时长', after: '后续时长', gap: '缺口阈值' })[k]).join('、')} 使用了经验默认值（${R.DEFAULTS_NOTE}）`);
    L.push('');
  }
  L.push(`【注意】${R.GRADING_NOTE}`);
  L.push('');
  L.push('> 章节框架对应中石化设备事故调查报告常规章节（概况、经过、原因分析、责任分析、损失情况、防范措施）；本材料未作定性，标题统一用「故障」，定性后由调查组改写。');
  L.push('');

  L.push('## 一、故障概况');
  L.push('');
  L.push(C.mdTable(['项目', '内容'], [
    ['设备位号', a.tag],
    ['设备名称', a.name || '—'],
    ['所属车间', a.workshop || '—'],
    ['发生时间', evt.cn],
    ['故障现象', a.symptom],
    ['归集时间窗口', `${msToCn(winStart)} ~ ${msToCn(winEnd)}（前 ${before} h / 后 ${after} h）`],
    ['时间线条目', counts.timeline],
    ['涉及来源数', counts.sources],
  ]));
  L.push('> 以上为记录中的事实陈述，不含原因判断。');
  L.push('');

  L.push('## 二、故障经过（时间线）');
  L.push('');
  L.push(C.mdTable(['时间', '来源', '数据类型', '记录内容', '相对故障(h)', '出处'],
    timeline.map((x) => [x.time, x.source, x.dataType, x.content,
      x.offsetHours === null ? '—' : (x.offsetHours > 0 ? '+' : '') + x.offsetHours,
      `${x.sheet} 第${x.row}行`])));
  L.push('> 时间线按各来源记录原文陈述，条目之间不作因果关联；先后顺序不代表因果关系。');
  L.push('');

  L.push('## 三、故障前后参数与报警');
  L.push('');
  L.push('### 3.1 运行参数');
  L.push('');
  if (!paramChanges.length) L.push('_未提供运行参数数据。_\n');
  else L.push(C.mdTable(['时间', '来源', '位号', '参数名', '数值', '单位', '相对故障(h)', '出处'],
    paramChanges.map((x) => [x.time, x.source, x.tag || '—', x.param, C.fmt(x.value), x.unit || '—',
      (x.offsetHours > 0 ? '+' : '') + x.offsetHours, `${x.sheet} 第${x.row}行`])));
  L.push('### 3.2 报警序列');
  L.push('');
  if (!alarms.length) L.push('_未提供报警记录数据。_\n');
  else L.push(C.mdTable(['序', '时间', '来源', '报警内容', '级别', '相对故障(h)', '出处'],
    alarms.map((x) => [x.seq, x.time, x.source, x.content, x.level || '—',
      (x.offsetHours > 0 ? '+' : '') + x.offsetHours, `${x.sheet} 第${x.row}行`])));
  L.push('> 参数与报警均为记录原值；数值无法解析的按空值显示为「—」，未按 0 计，未作任何插值。');
  L.push('');

  L.push('## 四、相关检修与变更历史');
  L.push('');
  if (!maintenanceHistory.length) L.push('_未提供检修历史数据，建议按第六节清单调取。_\n');
  else L.push(C.mdTable(['检修日期', '距故障(天)', '类别（原文）', '检修分级', '工单/通知单', '检修内容', '验收结论', '出处'],
    maintenanceHistory.map((x) => [x.date || '—', x.daysBeforeFailure === null ? '—' : x.daysBeforeFailure,
      x.category || '—', x.categoryNorm || '—', [x.orderNo, x.noticeNo].filter(Boolean).join(' / ') || '—',
      x.content, x.conclusion || '—', `${x.sheet} 第${x.row}行`])));
  L.push('> 检修历史仅作材料罗列，与本次故障是否相关由调查组认定。检修分级按《中石化口径对照》映射（大修→装置大检修，中修/小修→日常维修；SAP 订单类型只映射 PM01 日常维修 / PM03 抢修，PM02 等厂内可配置项不猜），原文保留；无法映射的显示「—」。');
  L.push('');

  L.push('## 五、数据缺口与时间戳差异');
  L.push('');
  L.push('### 5.1 数据缺口');
  L.push('');
  if (!dataGaps.length) L.push(`_时间窗口内连续采样数据（运行参数）记录间隔均未超过 ${gapMin} 分钟，未发现缺口。_\n`);
  else L.push(C.mdTable(['来源', '数据类型', '缺口起', '缺口止', '时长(分钟)', '位置', '处理'],
    dataGaps.map((x) => [x.source, x.dataType, x.from, x.to, x.minutes, x.position, '原样标注，未插值填补'])));
  L.push(`> 缺口判定仅针对连续采样类数据（运行参数），阈值 ${gapMin} 分钟${gapEndCapped ? `，窗口终点晚于当前时间，缺口只判到 ${msToCn(gapEnd)}` : ''}；操作、巡检、值班、报警属事件触发型记录，疏密不均不按缺口论。缺口区间一律原样标注，**不作插值、不作推测填补**。`);
  L.push('');
  L.push('### 5.2 各来源时间戳差异');
  L.push('');
  if (!timeInconsistency.length) L.push('_未发现同一内容在不同来源之间的时间戳差异。_\n');
  else {
    for (const t of timeInconsistency) {
      L.push(`**「${t.content}」** —— 最大差异 ${t.maxDiffMinutes} 分钟`);
      L.push('');
      L.push(C.mdTable(['来源', '记录时间', '数据类型', '出处'],
        t.records.map((r) => [r.source, r.time, r.dataType, `${r.sheet} 第${r.row}行`])));
      L.push(`> ${t.resolution}。${t.note}。`);
      L.push('');
    }
  }
  L.push('### 5.3 时间戳缺失条目');
  L.push('');
  if (!result.missingTime.length) L.push('_无。_\n');
  else L.push(C.mdTable(['来源', '数据类型', '记录内容', '原始时间值', '处理', '出处'],
    result.missingTime.map((x) => [x.source, x.dataType, x.content || '—', x.timeRaw || '（空）',
      '未推测补齐', `${x.sheet} 第${x.row}行`])));
  if (outOfWindow.length) {
    L.push('### 5.4 超出时间窗口的记录');
    L.push('');
    L.push(C.mdTable(['时间', '来源', '数据类型', '记录内容', '出处'],
      outOfWindow.map((x) => [x.timeCn, x.source, x.dataType, x.content || x.param || '—', `${x.sheet} 第${x.row}行`])));
    L.push('> 以上记录不在本次归集窗口内，单列备查；如需纳入请调整 --before / --after 后重新归集。');
    L.push('');
  }

  L.push('## 六、待查材料清单');
  L.push('');
  L.push(C.mdTable(['编号', '建议调取的材料', '用途', '调取方式'],
    toInvestigate.map((x) => [x.id, x.item, x.why, x.source])));
  L.push('> 以上为建议进一步收集的材料，供调查组参考；清单不构成对原因的任何指向。');
  L.push('');

  L.push('## 七、原因分析');
  L.push('');
  L.push(`**${R.ANALYSIS_PLACEHOLDER}**`);
  L.push('');
  L.push('<!-- ANALYSIS_START -->');
  L.push('<!-- ANALYSIS_END -->');
  L.push('');
  L.push(`> 本节留空。${R.REFUSAL_NOTE}。`);
  L.push('');

  L.push('## 八、责任分析');
  L.push('');
  L.push(`**${R.ANALYSIS_PLACEHOLDER}**`);
  L.push('');
  L.push('> 本节留空。责任分析由调查组按《中国石化设备事故管理规定》进行；本材料不涉及人员姓名与追责性内容。');
  L.push('');

  L.push('## 九、损失情况');
  L.push('');
  L.push(`**${R.LOSS_PLACEHOLDER}**`);
  L.push('');
  L.push(C.mdTable(['项目', '内容'], [
    ['直接经济损失', '（由调查组核定）'],
    ['停工 / 降量时间', '（由调查组核定）'],
    ['是否属非计划停工事件', '（按《炼化企业非计划停工管理规定》由公司设备管理部门认定）'],
    ['事故等级', '（按《中国石化设备事故管理规定》由调查组认定，本材料不判定）'],
  ]));
  L.push('');

  L.push('## 十、防范措施');
  L.push('');
  L.push(`**${R.ANALYSIS_PLACEHOLDER}**`);
  L.push('');
  L.push('> 本节留空。防范措施由调查组按「四不放过」原则（原因未查清不放过、责任人员未处理不放过、整改措施未落实不放过、有关人员未受到教育不放过）制定；本材料不提出措施，避免以措施暗示原因。');
  L.push('');

  if (causalHits.length) {
    L.push('## 附一、检出的禁用表述（须改写后成文）');
    L.push('');
    L.push(C.mdTable(['规则号', '类别', '所在位置', '原文', '字位', '出处', '建议改法'],
      causalHits.map((h) => [h.ruleId, h.categoryCn, h.field, h.text, `第${h.index + 1}字`, h.loc, h.suggest])));
    L.push('> 时间线只陈述记录中的事实；以上表述一律改写为客观时序陈述，脚本不自动删改记录原文。');
    L.push('');
  }
  if (warnings.length) {
    L.push('## 附：数据提示');
    L.push('');
    for (const w of warnings) L.push(`- ${w}`);
    L.push('');
  }
  L.push('---');
  L.push('');
  L.push(R.DISCLAIMER + '。');
  L.push('');
  L.push(R.DISCLAIMER_GENERAL);
  L.push('');
  fs.writeFileSync(path.join(outDir, 'investigation.md'), L.join('\n'), 'utf8');

  C.emitOk(outDir, { ok: true, out: outDir, tag: a.tag, failureTime: evt.cn, counts, warnings });
}

try { main(); } catch (e) { C.fail(e, warnings); }
