#!/usr/bin/env node
'use strict';
/**
 * 维修通知单草稿生成脚本（中石化体系炼化厂车间设备员口径，仅 Node.js 内置模块）
 * 定位：车间设备员在 SAP PM 创建的是**维修通知单**；维修工单（订单）、工时定额与备件由计划员/承修单位编制。
 *       本脚本只生成通知单草稿（CSV + md），通知单号由 SAP 生成，脚本只给草稿序号。
 * 用法（单张）：node scripts/workorder.js --defect "<缺陷描述或defects.json路径>" --tag "<位号>" --applicant "<报告单位>" --due <YYYY-MM-DD> [--out <dir>]
 * 用法（批量）：node scripts/workorder.js --input "<缺陷xlsx>" --applicant "<报告单位>" --due <YYYY-MM-DD> [--out <dir>]
 * 用法（接上游）：node scripts/workorder.js --defect "<defect-intake-grading 产出的 defects.json>" --applicant "<报告单位>" --due <YYYY-MM-DD>
 * 可选：--ledger <设备台账xlsx> --history <历史维修记录/SAP订单历史xlsx> --priority <1~4|非常高|高|中|低> --notif-type <M1|M2|M3>
 *       --vendor <建议承修单位> --history-n <近N次,默认3> --workshop <车间> --reporter <报告人> --name --part --medium
 * 产出：<out>/notifications.json、notifications.md、notifications.csv、summary.json
 */
const fs = require('fs');
const path = require('path');
const { readXlsx, readCsvDir } = require('./lib/xlsx-lite');
const C = require('./lib/common');
const D = require('./lib/dispatch');

const warnings = [];
const VALUE_OPTS = ['defect', 'tag', 'applicant', 'due', 'input', 'out', 'ledger', 'history',
  'priority', 'notif-type', 'vendor', 'history-n', 'workshop', 'name', 'part', 'medium', 'reporter'];
const FLAG_OPTS = ['help'];

const NOTICE = '本通知单草稿由车间设备员核对后在 SAP 中创建，通知单号由系统生成；维修工单（订单）、工时与备件由计划员或承修单位编制，本草稿不替代审核派发。';
const DISCLAIMER = '本材料由脚本汇总、模型成文，仅供设备员复核参考，不替代审批、定性、验收与签字；厂内制度与系统数据为准。';

/**
 * 别名：局部优先，再并入共享 SYSTEM_ALIASES（SAP PM 技术对象/通知单/订单列名）。
 * 局部不再把「设备编号」当位号——SAP 设备编号是 8 位流水号，单独成列。
 */
const ALIASES = C.mergeAliases({
  '位号': ['位号', '设备位号', 'TAG', 'tag'],
  '设备名称': ['设备名称', '名称', '设备描述'],
  '缺陷描述': ['缺陷描述', '描述', '现象', '问题描述', '缺陷现象', '异常描述', '故障现象', '通知单短文本', '短文本', '故障描述'],
  '缺陷部位': ['缺陷部位', '部位', '位置', '对象部件'],
  '缺陷编号': ['缺陷编号', '缺陷号', '缺陷登记号'],
  '等级': ['等级', '缺陷等级', '级别'],
  '介质': ['介质', '物料', '工艺介质'],
  '发现时间': ['发现时间', '时间', '发现日期', '记录时间', '通知日期', '故障开始'],
  '发现人': ['发现人', '记录人', '上报人', '巡检人', '报告人', '通知人'],
  '规格型号': ['规格型号', '型号', '规格', '设备型号', '型号编号'],
  '安装位置': ['安装位置', '位置', '区域', '装置区域', '所在区域', '工厂区段'],
  '专业': ['专业', '所属专业', '归口专业', '责任专业', '专业类别'],
  '投用日期': ['投用日期', '投用时间', '投运日期', '启用日期', '投产日期', '开始日期', '建造年份'],
  '维修日期': ['维修日期', '检修日期', '日期', '完成日期', '施工日期', '时间', '基本开始日期', '实际结束日期', '技术完成日期'],
  '维修内容': ['维修内容', '检修内容', '工作内容', '处理内容', '施工内容', '订单描述', '短文本'],
  '承修单位': ['承修单位', '施工单位', '维修单位', '检修单位', '承包商', '主工作中心', '工作中心'],
  '工单号': ['工单号', '工单编号', '单号', '派工单号', '订单', '订单号', '工单', 'PM订单', '维修订单号'],
});

function loadBook(p) { return fs.statSync(p).isDirectory() ? readCsvDir(p) : readXlsx(p); }
const csvLine = (r) => r.map((c) => `"${String(c === null || c === undefined ? '' : c).replace(/"/g, '""')}"`).join(',');

// ---------------------------------------------------------------- 缺陷输入解析
/**
 * --defect 支持两条路径：
 *   1) 指向 defect-intake-grading 产出的 defects.json（或其 defects 数组）→ 直接吃结构化字段
 *   2) 一段文字描述 → 现场识别现象类型，其余字段留空，绝不反推介质与等级
 */
function parseDefectArg(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  let raw = null;
  if (s.length < 4096 && !/[\n]/.test(s) && fs.existsSync(s) && fs.statSync(s).isFile()) {
    let txt;
    try { txt = fs.readFileSync(s, 'utf8'); } catch (e) { throw new Error(`缺陷文件无法读取: ${s}`); }
    try { raw = JSON.parse(txt.replace(/^﻿/, '')); } catch (e) {
      throw new Error(`缺陷文件「${s}」不是有效 JSON；若要传文字描述请直接写描述文本，不要传文件路径`);
    }
  } else if (/^\s*[[{]/.test(s)) {
    try { raw = JSON.parse(s); } catch (e) { raw = null; }
  }
  if (raw === null) return { kind: 'text', items: [{ desc: s, _src: '文字描述' }] };

  let arr = null;
  if (Array.isArray(raw)) arr = raw;
  else if (raw && Array.isArray(raw.defects)) arr = raw.defects;
  else if (raw && typeof raw === 'object' && (raw.desc || raw.tag)) arr = [raw];
  if (!arr) throw new Error('缺陷 JSON 中未找到 defects 数组（应为 defect-intake-grading 产出的 defects.json）');
  if (!arr.length) throw new Error('缺陷 JSON 中 defects 数组为空');
  return { kind: 'json', items: arr.map((d) => ({
    defectNo: C.str(d.no), tag: C.str(d.tag), name: C.str(d.name), part: C.str(d.part),
    desc: C.str(d.desc), medium: C.str(d.medium), equipNo: C.str(d.equipNo), funcLoc: C.str(d.funcLoc),
    phenomenon: C.str(d.phenomenon) || null, phenomenonCn: C.str(d.phenomenonCn),
    level: C.str(d.level), levelCn: C.str(d.levelCn), basis: C.str(d.basis), ruleId: C.str(d.ruleId),
    dueDays: typeof d.dueDays === 'number' ? d.dueDays : null, dueDate: C.str(d.dueDate) || null,
    foundAt: C.str(d.foundAt) || null, by: C.str(d.by) || null,
    discipline: C.str(d.discipline), _src: 'defects.json',
  })) };
}

function main() {
  const a = C.parseArgs(process.argv.slice(2), VALUE_OPTS, FLAG_OPTS);

  if (!a.defect && !a.input) throw new Error('缺少 --defect（单张/接上游）或 --input（批量缺陷表）');
  if (!a.applicant) throw new Error('缺少 --applicant（报告单位/车间），通知单必须写明报告单位');
  if (!a.due) throw new Error('缺少 --due（要求结束日期，YYYY-MM-DD）');
  const due = C.normDate(a.due);
  if (!due) throw new Error(`--due 「${a.due}」不是有效日期，应为 YYYY-MM-DD`);
  if (a['notif-type'] && !D.parseNotifType(a['notif-type'])) throw new Error(`--notif-type 「${a['notif-type']}」无法识别，可写 M1/M2/M3`);

  const historyN = a['history-n'] ? Number(a['history-n']) : 3;
  if (!Number.isFinite(historyN) || historyN <= 0) throw new Error(`--history-n 「${a['history-n']}」应为正整数`);

  const outDir = a.out || path.join(require('os').tmpdir(), 'wo-out');

  // ---- 要求结束早于当前 → warning（不阻断，草稿仍生成，由用户决定是否改期）
  const today = C.localDate();
  const dueDelta = C.diffDays(due, today);
  if (dueDelta !== null && dueDelta < 0) {
    warnings.push(`要求结束日期 ${due} 早于当前日期 ${today}（已过期 ${-dueDelta} 天），请与报告单位确认是否改期`);
  }

  // ---- 设备台账（带出设备编号、规格型号、位置、专业、投用日期）
  let equipMap = null;
  if (a.ledger) {
    if (!fs.existsSync(a.ledger)) throw new Error(`设备台账不存在: ${a.ledger}`);
    const rows = C.pickSheet(loadBook(a.ledger), '设备台账', '台账', '设备清单', '技术对象');
    if (!rows) warnings.push('设备台账文件中未找到「设备台账」工作表，设备信息无法带出');
    else {
      const recs = C.toRecords(rows, ['位号'], '设备台账',
        ['设备编号', '设备名称', '规格型号', '安装位置', '专业', '投用日期', '介质'], warnings, ALIASES);
      equipMap = new Map();
      for (const r of recs) {
        const t = C.str(r['位号']);
        if (!t) continue;
        const commissioned = r['投用日期'] ? C.normDate(r['投用日期']) : null;
        if (r['投用日期'] && !commissioned) warnings.push(`工作表「设备台账」第${r._row}行 投用日期「${C.str(r['投用日期'])}」无法解析`);
        equipMap.set(t, {
          equipNo: C.str(r['设备编号']), name: C.str(r['设备名称']), model: C.str(r['规格型号']), location: C.str(r['安装位置']),
          discipline: C.str(r['专业']), commissioned, medium: C.str(r['介质']),
        });
      }
    }
  } else {
    warnings.push('未提供设备台账（--ledger），SAP 设备编号、规格型号、安装位置、投用日期等设备信息无法带出，草稿中标「待补充」');
  }

  // ---- 历史维修记录（SAP 订单历史：订单/基本开始日期/订单描述/主工作中心 可直读）
  let historyMap = null;
  if (a.history) {
    if (!fs.existsSync(a.history)) throw new Error(`历史维修记录不存在: ${a.history}`);
    const rows = C.pickSheet(loadBook(a.history), '维修记录', '检修记录', '历史维修', '订单', '记录');
    if (!rows) warnings.push('历史维修记录文件中未找到「维修记录」工作表，历史背景无法附带');
    else {
      const recs = C.toRecords(rows, ['位号'], '维修记录',
        ['维修日期', '维修内容', '承修单位', '工单号'], warnings, ALIASES);
      historyMap = new Map();
      for (const r of recs) {
        const t = C.str(r['位号']);
        if (!t) { warnings.push(`工作表「维修记录」第${r._row}行 位号为空，已跳过`); continue; }
        const d = r['维修日期'] ? C.normDate(r['维修日期']) : null;
        if (r['维修日期'] && !d) warnings.push(`工作表「维修记录」第${r._row}行 维修日期「${C.str(r['维修日期'])}」无法解析`);
        if (!historyMap.has(t)) historyMap.set(t, []);
        historyMap.get(t).push({
          date: d, content: C.str(r['维修内容']) || null, vendor: C.str(r['承修单位']) || null,
          orderNo: C.str(r['工单号']) || null, srcRow: r._row,
        });
      }
      for (const [, list] of historyMap) {
        list.sort((x, y) => {
          if (x.date && y.date) return x.date < y.date ? 1 : x.date > y.date ? -1 : 0;
          if (x.date) return -1;
          if (y.date) return 1;
          return 0;
        });
      }
    }
  }

  // ---- 收集待转单的缺陷
  const items = [];
  let mode = 'single';
  if (a.input) {
    mode = 'batch';
    if (!fs.existsSync(a.input)) throw new Error(`输入不存在: ${a.input}`);
    const rows = C.pickSheet(loadBook(a.input), '缺陷记录', '缺陷', '记录', '通知单');
    if (!rows) throw new Error('输入文件中未找到「缺陷记录」工作表');
    const recs = C.toRecords(rows, ['位号', '缺陷描述'], '缺陷记录',
      ['设备编号', '设备名称', '缺陷部位', '缺陷编号', '等级', '介质', '发现时间', '发现人'], warnings, ALIASES);
    for (const r of recs) {
      const tag = C.str(r['位号']);
      if (!tag) { warnings.push(`工作表「缺陷记录」第${r._row}行 位号为空，已跳过`); continue; }
      const desc = C.str(r['缺陷描述']);
      if (!desc) { warnings.push(`工作表「缺陷记录」第${r._row}行 缺陷描述为空，已跳过（不得凭位号编造故障现象）`); continue; }
      items.push({
        tag, equipNo: C.str(r['设备编号']), name: C.str(r['设备名称']), part: C.str(r['缺陷部位']), desc,
        defectNo: C.str(r['缺陷编号']), levelCn: C.str(r['等级']), medium: C.str(r['介质']),
        foundAt: C.normDateTime(r['发现时间']), by: C.str(r['发现人']),
        _row: r._row, _src: '缺陷记录表',
      });
    }
  } else {
    const parsed = parseDefectArg(a.defect);
    if (parsed.kind === 'json') {
      mode = parsed.items.length > 1 ? 'batch' : 'single';
      for (const d of parsed.items) items.push(Object.assign({}, d));
    } else {
      items.push({ tag: '', name: a.name || '', part: a.part || '', desc: parsed.items[0].desc, medium: a.medium || '', _src: '文字描述' });
    }
    for (const it of items) if (!it.tag && a.tag) it.tag = a.tag;
    if (a.tag && parsed.kind === 'json' && parsed.items.length > 1) {
      warnings.push(`--tag「${a.tag}」在多条缺陷的 JSON 输入下被忽略，位号以 JSON 中各条为准`);
    }
  }
  if (!items.length) throw new Error('没有可转通知单的缺陷记录');
  for (const it of items) {
    if (!it.tag) throw new Error('缺少设备位号（功能位置）：文字描述方式须用 --tag 指定位号，通知单不能挂空功能位置');
  }

  // ---- 逐条生成通知单草稿（草稿序号 1..N；通知单号由 SAP 生成）
  const orders = [], missingInfo = [], undetermined = [];
  let seq = 0;
  for (const it of items) {
    const eq = equipMap ? equipMap.get(it.tag) : undefined;
    const inLedger = !!eq;
    if (equipMap && !inLedger) {
      warnings.push(`位号「${it.tag}」不在设备台账中，设备编号/规格型号/安装位置/投用日期留空标「待补充」，未按设备名推测`);
    }

    const equipment = {
      tag: it.tag, funcLoc: it.funcLoc || it.tag,
      equipNo: (eq && eq.equipNo) || it.equipNo || null,
      name: (eq && eq.name) || it.name || null,
      model: (eq && eq.model) || null,
      location: (eq && eq.location) || null,
      discipline: (eq && eq.discipline) || null,
      commissioned: (eq && eq.commissioned) || null,
      medium: it.medium || (eq && eq.medium) || null,
      inLedger,
      source: inLedger ? '设备台账' : (equipMap ? '台账中未查到' : '未提供设备台账'),
    };

    const phenomenon = it.phenomenon || D.classifyPhenomenon(it.desc);
    const phenomenonCn = it.phenomenonCn || D.PHEN_CN[phenomenon] || '其他';
    const discipline = D.disciplineOf(it.tag, equipment.name, equipment.discipline || it.discipline);

    const pr = D.decidePriority({ explicit: a.priority, defectLevel: it.levelCn || it.level });
    const nt = D.decideNotifType({ explicit: a['notif-type'], priority: pr.priority });

    let history = null, historyNote = null;
    if (!historyMap) {
      historyNote = '未提供历史维修记录';
    } else {
      const list = historyMap.get(it.tag) || [];
      if (!list.length) {
        historyNote = `历史维修记录中无位号「${it.tag}」的记录`;
        warnings.push(`位号「${it.tag}」在历史维修记录中无记录，草稿历史章节留空说明`);
      } else {
        history = list.slice(0, historyN).map((h) => ({ date: h.date, content: h.content, vendor: h.vendor, orderNo: h.orderNo }));
        historyNote = `取自历史维修记录，共 ${list.length} 条，展示近 ${history.length} 次`;
      }
    }

    seq++;
    const miss = [];
    if (!equipment.equipNo) miss.push('SAP 设备编号');
    if (!equipment.model) miss.push('规格型号');
    if (!equipment.location) miss.push('安装位置');
    if (!equipment.commissioned) miss.push('投用日期');
    if (!equipment.name) miss.push('设备名称');
    if (discipline === '待定') miss.push('专业归口');
    if (pr.undetermined) miss.push('优先级');
    if (nt.undetermined) miss.push('通知单类型');
    if (!a.vendor) miss.push('建议承修单位');

    const requiredStart = it.foundAt ? it.foundAt.slice(0, 10) : today;
    const shortText = `${it.tag} ${it.part ? it.part + ' ' : ''}${phenomenonCn}`.slice(0, 40);
    const longText = `${it.desc}${it.part ? '；部位：' + it.part : ''}${equipment.medium ? '；介质：' + equipment.medium : ''}${it.levelCn ? '；缺陷等级 ' + it.levelCn : ''}${it.basis ? '（' + it.basis + '）' : ''}`;

    const order = {
      draftNo: seq, defectNo: it.defectNo || null,
      equipment,
      fault: {
        part: it.part || null, desc: it.desc, phenomenon, phenomenonCn, faultCode: D.PHEN_SAP_CODE[phenomenon] || '',
        defectLevel: it.levelCn || null, defectBasis: it.basis || null, defectRuleId: it.ruleId || null,
      },
      notification: {
        type: nt.type, typeCn: nt.typeCn, typeSource: nt.source, typeUndetermined: nt.undetermined,
        shortText, longText, requiredStart, requiredEnd: due,
        reporter: a.reporter || it.by || null, reportUnit: a.applicant,
      },
      dispatch: {
        discipline, disciplineNote: '专业归口建议值，需车间与承修单位确认',
        vendor: a.vendor || null, vendorNote: a.vendor ? '用户建议' : '待计划员/车间确定',
        laborHours: null, laborNote: '工时由承修单位在工单（订单）中填写，车间不填',
        spare: null, spareNote: '备件由承修单位按台账与备件库确定，草稿不给方向',
      },
      priority: { key: pr.priority, cn: pr.priorityCn, source: pr.source, ruleId: pr.ruleId, undetermined: pr.undetermined },
      schedule: { applicant: a.applicant, dueDate: due, overdue: dueDelta !== null && dueDelta < 0, daysToDue: dueDelta, defectDueDate: it.dueDate || null },
      history, historyNote,
      missing: miss,
      srcRow: it._row || null, srcType: it._src || null,
    };
    orders.push(order);
    if (miss.length) missingInfo.push({ draftNo: seq, tag: it.tag, missing: miss });
    if (pr.undetermined) undetermined.push({ draftNo: seq, tag: it.tag, field: '优先级', reason: pr.missing.join('、'), ruleId: pr.ruleId, note: '未指定 --priority 且缺陷等级缺失或无法识别，未按「3 中」默认' });
    if (nt.undetermined) undetermined.push({ draftNo: seq, tag: it.tag, field: '通知单类型', reason: nt.reason, ruleId: 'NU1', note: '未指定 --notif-type 且优先级未判定，未按 M1 默认' });
  }

  const byPriority = {};
  for (const k of D.PRIORITY_KEYS) { const n = orders.filter((o) => o.priority.key === k).length; if (n) byPriority[D.PRIORITY_CN[k]] = n; }
  const nU = orders.filter((o) => o.priority.undetermined).length; if (nU) byPriority['未判定'] = nU;
  const byDiscipline = {};
  for (const o of orders) byDiscipline[o.dispatch.discipline] = (byDiscipline[o.dispatch.discipline] || 0) + 1;
  const byType = {};
  for (const o of orders) byType[o.notification.typeCn] = (byType[o.notification.typeCn] || 0) + 1;
  const counts = {
    total: orders.length, byPriority, byDiscipline, byType,
    notInLedger: orders.filter((o) => !o.equipment.inLedger).length,
    withoutHistory: orders.filter((o) => !o.history).length,
    undeterminedPriority: nU,
    undeterminedType: orders.filter((o) => o.notification.typeUndetermined).length,
    withMissingInfo: missingInfo.length,
  };

  // ---- 产出
  C.ensureDir(outDir);
  const result = {
    meta: {
      workshop: a.workshop || null, generatedAt: C.localDateTime(), mode,
      applicant: a.applicant, dueDate: due, vendor: a.vendor || null,
      equipLedger: !!equipMap, historyProvided: !!historyMap, historyN,
      notice: NOTICE, disclaimer: DISCLAIMER,
    },
    counts, orders, missingInfo, undetermined, warnings,
  };
  fs.writeFileSync(path.join(outDir, 'notifications.json'), JSON.stringify(result, null, 2), 'utf8');

  // ---- 通知单草稿 CSV（SAP PM 通知单列，带 BOM；通知单号留空由系统生成）
  const csvHead = ['草稿序号', '通知单号(SAP生成)', '通知单类型', '功能位置', '设备编号', '设备描述', '通知单短文本', '长文本',
    '优先级', '故障代码', '对象部件', '要求开始', '要求结束', '报告单位', '报告人', '缺陷登记号', '建议专业归口', '建议承修单位', '信息待补充项'];
  const csvRows = orders.map((o) => [
    o.draftNo, '', o.notification.type || '待确认', o.equipment.funcLoc, o.equipment.equipNo || '待补充', o.equipment.name || '待补充',
    o.notification.shortText, o.notification.longText,
    o.priority.key === null ? '待确认' : o.priority.key, o.fault.faultCode, o.fault.part || '',
    o.notification.requiredStart, o.notification.requiredEnd, o.notification.reportUnit, o.notification.reporter || '',
    o.defectNo || '', o.dispatch.discipline, o.dispatch.vendor || '', o.missing.join('、'),
  ]);
  fs.writeFileSync(path.join(outDir, 'notifications.csv'), '﻿' + [csvHead, ...csvRows].map(csvLine).join('\r\n'), 'utf8');

  // ---- Markdown
  const L = [];
  const V = (v) => (v === null || v === undefined || v === '' ? '待补充' : v);
  L.push(`# 维修通知单草稿${a.workshop ? '（' + a.workshop + '）' : ''}`);
  L.push('');
  L.push(`生成时间：${C.localDateTime()}（北京时间）　报告单位：${a.applicant}　要求结束：${due}　草稿数：${counts.total}`);
  L.push('');
  L.push(`> ${DISCLAIMER}`);
  L.push(`> ${NOTICE}`);
  L.push('');

  L.push('## 一、通知单草稿清单概览');
  L.push('');
  L.push(C.mdTable(['草稿序号', '功能位置', '设备描述', '通知单短文本', '通知单类型', '优先级', '建议专业归口', '要求结束'],
    orders.map((o) => [o.draftNo, o.equipment.funcLoc, V(o.equipment.name), o.notification.shortText,
      o.notification.typeCn, o.priority.undetermined ? '未判定' : o.priority.cn, o.dispatch.discipline, o.notification.requiredEnd])));
  L.push(C.mdTable(['统计项', '数值'], [
    ['草稿总数', counts.total],
    ...Object.entries(byType).map(([k, v]) => [`　通知单类型 ${k}`, v]),
    ...Object.entries(byPriority).map(([k, v]) => [`　优先级 ${k}`, v]),
    ...Object.entries(byDiscipline).map(([k, v]) => [`　专业归口 ${k}`, v]),
    ['位号不在台账', counts.notInLedger],
    ['无历史维修记录', counts.withoutHistory],
    ['信息待补充草稿', counts.withMissingInfo],
  ]));
  L.push('【注意】专业归口为建议值，需车间与承修单位确认；工时与备件由承修单位在工单（订单）中填写，草稿不给数值。优先级按 SAP 1 非常高 / 2 高 / 3 中 / 4 低；通知单类型 M1 维修申请 / M2 故障报告 为常见口径，厂内可配置。');
  L.push('');

  L.push('## 二、通知单草稿正文');
  L.push('');
  for (const o of orders) {
    L.push(`### 草稿 ${o.draftNo}　${o.equipment.funcLoc}${o.equipment.name ? ' ' + o.equipment.name : ''}`);
    L.push('');
    L.push('**通知单抬头**');
    L.push('');
    L.push(C.mdTable(['项目', '内容'], [
      ['通知单号', '由 SAP 生成'],
      ['通知单类型', `${o.notification.typeCn}${o.notification.typeSource ? '（' + o.notification.typeSource + '）' : ''}`],
      ['功能位置', o.equipment.funcLoc],
      ['设备编号', V(o.equipment.equipNo)],
      ['通知单短文本', o.notification.shortText],
      ['优先级', o.priority.undetermined ? '**未判定**' : `**${o.priority.cn}**`],
      ['判定来源', V(o.priority.source)],
      ['要求开始', o.notification.requiredStart],
      ['要求结束', `${o.notification.requiredEnd}${o.schedule.overdue ? '　**（早于当前日期，请确认是否改期）**' : ''}`],
      ['报告单位', o.notification.reportUnit],
      ['报告人', V(o.notification.reporter)],
    ]));
    L.push('**设备信息**');
    L.push('');
    L.push(C.mdTable(['项目', '内容'], [
      ['设备描述', V(o.equipment.name)],
      ['规格型号', V(o.equipment.model)],
      ['安装位置', V(o.equipment.location)],
      ['所属专业', V(o.equipment.discipline)],
      ['投用日期', V(o.equipment.commissioned)],
      ['介质', V(o.equipment.medium)],
      ['信息来源', o.equipment.source],
    ]));
    if (!o.equipment.inLedger) {
      L.push(`【注意】位号「${o.equipment.tag}」${equipMap ? '未在设备台账中查到' : '未提供设备台账'}，设备信息字段留空标「待补充」，需从 SAP 技术对象或现场铭牌核实后补填，未按设备名推测规格型号。`);
      L.push('');
    }
    L.push('**故障描述（长文本）**');
    L.push('');
    L.push(C.mdTable(['项目', '内容'], [
      ['缺陷登记号', V(o.defectNo)],
      ['对象部件', V(o.fault.part)],
      ['故障现象', o.fault.desc],
      ['现象类型 / 故障代码建议', `${o.fault.phenomenonCn}${o.fault.faultCode ? ' / ' + o.fault.faultCode : ''}（代码按厂内目录核对）`],
      ['缺陷等级', V(o.fault.defectLevel)],
      ['定级依据', o.fault.defectBasis ? `${o.fault.defectBasis}${o.fault.defectRuleId ? '（规则 ' + o.fault.defectRuleId + '）' : ''}` : '—'],
      ['长文本', o.notification.longText],
    ]));
    L.push('**归口建议**');
    L.push('');
    L.push(C.mdTable(['项目', '内容', '说明'], [
      ['专业归口', o.dispatch.discipline, o.dispatch.disciplineNote],
      ['建议承修单位', o.dispatch.vendor || '待定', o.dispatch.vendorNote],
      ['工时', '—', o.dispatch.laborNote],
      ['备件', '—', o.dispatch.spareNote],
    ]));
    L.push('**历史维修记录**');
    L.push('');
    if (!o.history) {
      L.push(`${o.historyNote}。`);
      L.push('');
      L.push('【注意】本节内容一律来自历史维修记录或 SAP 订单历史，无记录即留空，不编造检修履历。');
      L.push('');
    } else {
      L.push(C.mdTable(['维修日期', '维修内容', '承修单位/工作中心', '原订单号'],
        o.history.map((h) => [h.date || '—', h.content || '—', h.vendor || '—', h.orderNo || '—'])));
      L.push(`${o.historyNote}。`);
      L.push('');
    }
    if (o.missing.length) {
      L.push(`**本草稿信息待补充**：${o.missing.join('、')}`);
      L.push('');
    }
  }

  L.push('## 三、信息缺口清单');
  L.push('');
  if (!missingInfo.length) L.push('_无_\n');
  else L.push(C.mdTable(['草稿序号', '功能位置', '待补充项'], missingInfo.map((m) => [m.draftNo, m.tag, m.missing.join('、')])));
  if (undetermined.length) {
    L.push('### 未判定项');
    L.push('');
    L.push(C.mdTable(['草稿序号', '功能位置', '字段', '缺失', '说明'], undetermined.map((u) => [u.draftNo, u.tag, u.field, u.reason, u.note])));
    L.push('【未判定】以上字段未按默认值填充，请车间确认后补填再在 SAP 创建通知单。');
  }
  L.push('');
  L.push('<!-- ANALYSIS_START -->');
  L.push('（此处由模型补写：本批通知单的停机与作业许可需求、与在途通知单/工单的衔接、需车间决策的事项）');
  L.push('<!-- ANALYSIS_END -->');
  L.push('');
  if (warnings.length) {
    L.push('## 附：数据提示');
    L.push('');
    for (const w of warnings) L.push(`- ${w}`);
    L.push('');
  }
  L.push(`> ${NOTICE}`);
  L.push('');
  fs.writeFileSync(path.join(outDir, 'notifications.md'), L.join('\n'), 'utf8');

  C.emitOk(outDir, { ok: true, out: outDir, counts, warnings });
}

try { main(); } catch (e) { C.fail(e, warnings); }
