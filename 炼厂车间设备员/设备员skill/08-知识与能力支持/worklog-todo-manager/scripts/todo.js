#!/usr/bin/env node
'use strict';
/**
 * 工作日志与待办汇集脚本（仅 Node.js 内置模块）
 * 用法：node "<技能目录>/scripts/todo.js" --input <路径[,路径2]> --owner "张三" --date 2026-09-21 [--out <dir>]
 *       [--prev <上一日 todo.json>] [--done "已完成事项"] [--priority-rules "<口径>"] [--horizon <前瞻天数，默认7>]
 * 输入可以是：上游技能 JSON（orders.json / hazard.json / inspection.json / calibration.json / lube.json / defects.json / handover.json）、
 *             待办表 xlsx / CSV 目录、纯文字待办（每行一条）
 * 口径：缺陷 A 级（重大）/B 级（严重）/C 级（一般）（旧 I~IV 口径废止，别名保留映射并 warning）；
 *       工单优先级 SAP 1 非常高 / 2 高 / 3 中 / 4 低（中文 紧急/高/中/低 同义）；
 *       厂内业务系统（EM/SAP PM）中的待办不在本清单内，以系统为准。
 * 产出：<out>/todo.json、待办清单.md、工作日志.md、summary.json；末行打印 JSON 摘要
 *       默认输出目录为 <os.tmpdir()>/wtm-out，建议始终传 --out
 */
const fs = require('fs');
const path = require('path');
const { readXlsx, readCsvDir } = require('./lib/xlsx-lite');
const C = require('./lib/common');

const warnings = [];
const VALUE_OPTS = ['input', 'owner', 'date', 'out', 'prev', 'done', 'priority-rules', 'horizon'];
const FLAG_OPTS = ['help'];

const STATEMENT = '待办汇集自所提供来源，覆盖范围见清单说明；厂内业务系统（EM/SAP PM）中的待办请以系统为准。';
const STATEMENT_GENERIC = '本材料由脚本汇总、模型成文，仅供设备员复核参考，不替代审批、定性、验收与签字；厂内制度与系统数据为准。';

// 局部别名优先，再合并中石化常用系统导出列名（C.SYSTEM_ALIASES：功能位置/技术对象/设备描述/紧急程度 等）。
// 本技能把「设备编号」也当作位号锚点（只用于疑似重复判定），故局部「位号」别名保留「设备编号」；共享表的「设备编号」键未被读取，不冲突。
const ALIASES = C.mergeAliases({
  '事项': ['事项', '待办', '待办事项', '内容', '工作内容', '任务', '事项内容', '描述', '工作事项'],
  '到期日': ['到期日', '到期日期', '截止日期', '计划完成', '要求完成时间', '计划完成时间', '完成期限', '期限', '截止', '要求完成日期', '基本结束日期'],
  '来源': ['来源', '事项来源', '出处', '任务来源', '交办人', '交办单位'],
  '优先级': ['优先级', '紧急程度', '紧急度', '级别', '等级'],
  '位号': ['位号', '设备位号', '设备编号', 'TAG', '功能位置', '技术对象'],
  '编号': ['编号', '单号', '工单号', '通知单号', '隐患编号', '缺陷编号', '订单号'],
  '责任人': ['责任人', '负责人', '承办人', '执行人'],
  '状态': ['状态', '完成情况', '处理状态', '当前状态'],
  '备注': ['备注', '说明', '补充'],
});

// ---------------------------------------------------------------- 来源类型识别
/** 识别上游 JSON 的类型（按特征字段）；无法识别返回 null */
function detectJson(j) {
  if (!j || typeof j !== 'object') return null;
  if (j.items && j.categories && j.meta && j.meta.skill === 'worklog-todo-manager') return 'todo';  // 本技能产出
  if (j.meta && j.meta.skill === 'worklog-todo-manager') return 'todo';
  // shift-handover-record（值班/工作交接）：约定特征 = 含 pending 数组 且 meta.skill === 'shift-handover-record'
  if (Array.isArray(j.pending) && j.meta && j.meta.skill === 'shift-handover-record') return 'handover';
  // 兼容未带 meta.skill 的旧版 handover.json：pending 数组 + 交接时间/班次字段 → 按结构推断（调用方 warning）
  if (Array.isArray(j.pending) && j.meta && (j.meta.handoverAt !== undefined || j.meta.shift !== undefined) && j.focusItems !== undefined) return 'handover-inferred';
  if (j.byStatus !== undefined && j.stalled !== undefined) return 'orders';                          // work-order-tracker
  if (j.majorHazards !== undefined || j.unverified !== undefined) return 'hazard';                   // hazard-closure-tracker
  if (j.dateConflict !== undefined || (j.byCategory && j.prepMaterials !== undefined)) return 'inspection'; // special-equipment-inspection-due
  if (j.unresolvedFail !== undefined || j.sendList !== undefined) return 'calibration';              // valve-instrument-calibration-ledger
  if (j.oilAnalysis !== undefined || j.consumption !== undefined) return 'lube';                     // lubrication-manager
  if (j.defects !== undefined && j.counts && j.counts.byLevel !== undefined) return 'defects';       // defect-intake-grading
  return null;
}

const SRC_CN = {
  orders: '工单跟踪', hazard: '隐患整改', inspection: '特种设备定检',
  calibration: '阀门仪表校验', lube: '润滑管理', defects: '缺陷跟进', handover: '工作交接',
  sheet: '待办表', text: '自记待办', prev: '上一日结转',
};

/** 工单优先级归一：SAP 1 非常高 / 2 高 / 3 中 / 4 低；中文 紧急/高/中/低；返回 1~4 或 null */
function sapPrio(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return [1, 2, 3, 4].includes(v) ? v : null;
  const s = String(v).trim();
  const m = s.match(/^([1-4])(\s|$|[^\d])/);
  if (m) return Number(m[1]);
  if (/紧急|特急|非常高|抢修/.test(s)) return 1;
  if (/^高|较急|重要/.test(s)) return 2;
  if (/^中|一般|普通/.test(s)) return 3;
  if (/^低|不急|计划性/.test(s)) return 4;
  return null;
}
/** 缺陷等级归一：A/B/C（旧 I~IV → A/B/C/C，调用方 warning）；返回 'A'|'B'|'C'|null 与是否旧口径 */
function defectLevel(level, levelCn) {
  const s = String(level === null || level === undefined ? '' : level).trim().toUpperCase();
  const cn = String(levelCn || '').trim();
  if (/^[ABC]$/.test(s)) return { level: s, legacy: false };
  if (/^[ABC]\s*(级|类|（)/.test(cn)) return { level: cn[0], legacy: false };
  const iv = { I: 'A', II: 'B', III: 'C', IV: 'C', 'Ⅰ': 'A', 'Ⅱ': 'B', 'Ⅲ': 'C', 'Ⅳ': 'C' };
  const key = s || cn.replace(/\s*级.*$/, '').trim();
  if (iv[key]) return { level: iv[key], legacy: true };
  if (/紧急/.test(cn)) return { level: 'A', legacy: true };
  return { level: null, legacy: false };
}

// ---------------------------------------------------------------- 优先级
// 数值越小越靠前；排序口径详见 references/todo-rules.md
const PRIO = { P1: 1, P2: 2, P3: 3, P4: 4 };
const PRIO_CN = { P1: 'P1 最高', P2: 'P2 高', P3: 'P3 中', P4: 'P4 低' };

/** 依据来源类别与事项性质给出优先级（不依赖到期日，到期日单独参与排序） */
function priorityOf(kind, sub, extra = {}) {
  if (kind === 'hazard') {
    if (extra.level === 'major') return 'P1';                 // 重大隐患
    return sub === 'overdue' ? 'P1' : 'P2';
  }
  if (kind === 'inspection') return sub === 'overdue' ? 'P1' : 'P2';   // 特种设备法定检验
  if (kind === 'calibration') {
    if (extra.safetyCritical) return 'P1';                    // 安全联锁类
    if (sub === 'unresolvedFail') return 'P1';
    return sub === 'overdue' ? 'P2' : 'P3';
  }
  if (kind === 'orders') {
    const p = sapPrio(extra.priority);                         // SAP 1 非常高 / 2 高 / 3 中 / 4 低
    if (p === 1) return 'P1';
    if (sub === 'overdue') return p === 2 ? 'P1' : 'P2';
    if (sub === 'stalled') return 'P2';
    return 'P3';
  }
  if (kind === 'defects') {
    if (extra.level === 'A') return 'P1';                      // A 级（重大）
    if (extra.level === 'B') return 'P2';                      // B 级（严重）
    return 'P3';                                               // C 级（一般）/ 未定级
  }
  if (kind === 'handover') return sub === 'overdue' ? 'P1' : 'P2';   // 交接未完成事项：期限已过 P1，其余 P2
  if (kind === 'lube') return sub === 'overdue' ? 'P3' : 'P4';
  return 'P3';                                                 // 待办表 / 文字待办默认中
}

/**
 * 用户表里写明的优先级文字 → P1~P4；无法归类返回 null（不猜测）。
 * 认：P1~P4、SAP 1 非常高/2 高/3 中/4 低、紧急/高/中/低、缺陷 A/B/C 级；旧 I~IV 级按 I→A/II→B/III,IV→C 映射并 warning（ctx 给出出处）。
 */
function parsePriority(v, ctx) {
  const s = C.str(v).replace(/\s+/g, '');
  if (!s) return null;
  if (/^P?1$|^1[^\d]|最高|紧急|特急|非常高/i.test(s)) return 'P1';
  if (/^P?2$|^2[^\d]|^高$|较急|重要/i.test(s)) return 'P2';
  if (/^P?3$|^3[^\d]|^中$|一般|普通/i.test(s)) return 'P3';
  if (/^P?4$|^4[^\d]|^低$|不急|次要/i.test(s)) return 'P4';
  if (/^A(级|类)?$/i.test(s)) return 'P1';
  if (/^B(级|类)?$/i.test(s)) return 'P2';
  if (/^C(级|类)?$/i.test(s)) return 'P3';
  const iv = { 'I': 'P1', 'II': 'P2', 'III': 'P3', 'IV': 'P3', 'Ⅰ': 'P1', 'Ⅱ': 'P2', 'Ⅲ': 'P3', 'Ⅳ': 'P3', '一级': 'P1', '二级': 'P2', '三级': 'P3', '四级': 'P3' };
  const k = s.toUpperCase().replace(/级$/, '');
  const hit = iv[k] || iv[s] || null;
  if (hit && ctx) warnings.push(`${ctx} 优先级「${C.str(v)}」为旧 I~IV 四级口径（已废止），已按 I→A 级(P1)/II→B 级(P2)/III、IV→C 级(P3) 映射，请核对`);
  return hit;
}

// ---------------------------------------------------------------- 输入加载
function loadAny(p) {
  if (!fs.existsSync(p)) throw new Error(`输入不存在: ${p}`);
  const st = fs.statSync(p);
  if (st.isDirectory()) return { kind: 'book', data: readCsvDir(p), name: path.basename(p) };
  if (/\.json$/i.test(p)) {
    let j;
    try { j = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { throw new Error(`JSON 解析失败 ${p}: ${e.message}`); }
    return { kind: 'json', data: j, name: path.basename(p) };
  }
  if (/\.(txt|md)$/i.test(p)) return { kind: 'text', data: fs.readFileSync(p, 'utf8'), name: path.basename(p) };
  return { kind: 'book', data: readXlsx(p), name: path.basename(p) };
}

/** 生成待办项的稳定 key：来源类型 + 业务编号/位号 + 事项摘要 */
function itemKey(it) {
  return [it.kind, it.sub || '', it.refNo || it.tag || '', (it.title || '').slice(0, 24)].join('|');
}

/** 归一化为查重用的文本指纹：去标点与空白 */
function fingerprint(s) {
  return C.str(s).replace(/[\s，,。.、；;：:（）()【】\[\]「」""''/\\-]/g, '');
}

// ---------------------------------------------------------------- 各上游 JSON 的待办抽取
function fromOrders(j, srcName, push) {
  for (const x of j.overdue || []) {
    push({
      kind: 'orders', sub: 'overdue', refNo: x.no || '', tag: x.tag || '', name: x.name || '',
      title: `工单 ${x.no || '（无单号）'} 超期未闭环：${x.fault || x.name || x.tag || ''}`.trim(),
      dueDate: C.normDate(x.dueAt), owner: x.party || x.owner || '', srcName,
      detail: x.reason || '', srcRef: x.source || '',
      prio: priorityOf('orders', 'overdue', { priority: x.priority }),
    });
  }
  for (const x of j.stalled || []) {
    push({
      kind: 'orders', sub: 'stalled', refNo: x.no || '', tag: x.tag || '', name: x.name || '',
      title: `工单 ${x.no || '（无单号）'} 停滞 ${x.idleDays} 天（最后节点：${x.lastNode || '—'}）`,
      dueDate: null, owner: x.party || x.owner || '', srcName,
      detail: x.reason || '', srcRef: x.source || '', noDueReason: '停滞工单无要求完成时间',
      prio: priorityOf('orders', 'stalled', { priority: x.priority }),
    });
  }
  for (const x of j.dueSoon || []) {
    push({
      kind: 'orders', sub: 'dueSoon', refNo: x.no || '', tag: x.tag || '', name: x.name || '',
      title: `工单 ${x.no || '（无单号）'} 临期待闭环：${x.name || x.tag || ''}`.trim(),
      dueDate: C.normDate(x.dueAt), owner: x.party || x.owner || '', srcName,
      detail: '', srcRef: x.source || '',
      prio: priorityOf('orders', 'dueSoon', { priority: x.priority }),
    });
  }
}

function fromHazard(j, srcName, push) {
  const mk = (x, sub, titlePrefix) => ({
    kind: 'hazard', sub, refNo: x.no || '', tag: '', name: '',
    title: `${titlePrefix}${x.no ? `隐患 ${x.no}` : '隐患'}：${x.desc || '（无描述）'}`,
    dueDate: C.normDate(x.deadline), owner: x.owner || x.unit || '', srcName,
    detail: x.measure || '', srcRef: x.sheet ? `${x.sheet} 第${x.row}行` : '',
    prio: priorityOf('hazard', sub, { level: x.level }),
  });
  for (const x of j.overdue || []) push(mk(x, 'overdue', '超期未整改｜'));
  for (const x of j.dueSoon || []) push(mk(x, 'dueSoon', '临期｜'));
  for (const x of j.unverified || []) {
    const it = mk(x, 'unverified', '待验收销号｜');
    it.detail = x.unverifiedReason || it.detail;
    push(it);
  }
}

function fromInspection(j, srcName, push) {
  for (const x of j.overdue || []) {
    push({
      kind: 'inspection', sub: 'overdue', refNo: x.regCode || '', tag: x.tag || '', name: x.name || '',
      title: `${x.category || '特种设备'} ${x.tag} 定期检验已超期（应检 ${x.nextDate}）`,
      dueDate: C.normDate(x.nextDate), owner: x.unit || '', srcName,
      detail: x.name || '', srcRef: x.sheet ? `${x.sheet} 第${x.row}行` : '',
      prio: priorityOf('inspection', 'overdue'),
    });
  }
  for (const x of j.dueSoon || []) {
    push({
      kind: 'inspection', sub: 'dueSoon', refNo: x.regCode || '', tag: x.tag || '', name: x.name || '',
      title: `${x.category || '特种设备'} ${x.tag} 定期检验临期（应检 ${x.nextDate}）`,
      dueDate: C.normDate(x.nextDate), owner: x.unit || '', srcName,
      detail: x.name || '', srcRef: x.sheet ? `${x.sheet} 第${x.row}行` : '',
      prio: priorityOf('inspection', 'dueSoon'),
    });
  }
}

function fromCalibration(j, srcName, push) {
  for (const x of j.overdue || []) {
    push({
      kind: 'calibration', sub: 'overdue', refNo: x.cert || '', tag: x.tag || '', name: x.name || '',
      title: `${x.category || '仪表'} ${x.tag} 校验已超期（应校 ${x.nextDate || '—'}）`,
      dueDate: C.normDate(x.nextDate), owner: '', srcName,
      detail: x.name || '', srcRef: x.sheet ? `${x.sheet} 第${x.row}行` : '',
      prio: priorityOf('calibration', 'overdue', { safetyCritical: x.safetyCritical }),
    });
  }
  for (const x of j.dueSoon || []) {
    push({
      kind: 'calibration', sub: 'dueSoon', refNo: x.cert || '', tag: x.tag || '', name: x.name || '',
      title: `${x.category || '仪表'} ${x.tag} 校验临期（应校 ${x.nextDate || '—'}）`,
      dueDate: C.normDate(x.nextDate), owner: '', srcName,
      detail: x.name || '', srcRef: x.sheet ? `${x.sheet} 第${x.row}行` : '',
      prio: priorityOf('calibration', 'dueSoon', { safetyCritical: x.safetyCritical }),
    });
  }
  for (const x of j.unresolvedFail || []) {
    push({
      kind: 'calibration', sub: 'unresolvedFail', refNo: x.cert || '', tag: x.tag || '', name: x.name || '',
      title: `${x.category || '仪表'} ${x.tag} 上次校验不合格且无整改记录，须先整改后复校`,
      dueDate: null, owner: '', srcName,
      detail: x.resultRaw || '', srcRef: x.sheet ? `${x.sheet} 第${x.row}行` : '',
      noDueReason: '不合格未整改项无到期日，须另行确定整改期限',
      prio: priorityOf('calibration', 'unresolvedFail', { safetyCritical: x.safetyCritical }),
    });
  }
}

function fromLube(j, srcName, push) {
  for (const x of j.overdue || []) {
    push({
      kind: 'lube', sub: 'overdue', refNo: '', tag: x.tag || '', name: x.name || '',
      title: `${x.tag} ${x.part || ''} 润滑已逾期（${x.level || ''}，应加换油 ${x.dueDate}）`.replace(/\s+/g, ' ').trim(),
      dueDate: C.normDate(x.dueDate), owner: '', srcName,
      detail: [x.oil, x.mode].filter(Boolean).join(' / '), srcRef: x.sheet ? `${x.sheet} 第${x.row}行` : '',
      prio: priorityOf('lube', 'overdue'),
    });
  }
  for (const x of j.dueSoon || []) {
    push({
      kind: 'lube', sub: 'dueSoon', refNo: '', tag: x.tag || '', name: x.name || '',
      title: `${x.tag} ${x.part || ''} 润滑临期（应加换油 ${x.dueDate}）`.replace(/\s+/g, ' ').trim(),
      dueDate: C.normDate(x.dueDate), owner: '', srcName,
      detail: [x.oil, x.mode].filter(Boolean).join(' / '), srcRef: x.sheet ? `${x.sheet} 第${x.row}行` : '',
      prio: priorityOf('lube', 'dueSoon'),
    });
  }
}

function fromDefects(j, srcName, push) {
  for (const x of j.defects || []) {
    const due = C.normDate(x.dueDate);
    const dl = defectLevel(x.level, x.levelCn);
    if (dl.legacy) warnings.push(`${srcName} 缺陷 ${x.no || '（无编号）'} 等级「${x.levelCn || x.level}」为旧 I~IV 口径（已废止），已按 I→A/II→B/III、IV→C 映射为 ${dl.level} 级，请核对`);
    const levelCn = dl.level ? { A: 'A 级（重大）', B: 'B 级（严重）', C: 'C 级（一般）' }[dl.level] : (x.levelCn || '未定级');
    push({
      kind: 'defects', sub: 'followup', refNo: x.no || '', tag: x.tag || '', name: x.name || '',
      title: `缺陷 ${x.no || '（无编号）'}（${levelCn}）${x.tag}：${x.desc || ''}`,
      dueDate: due, owner: x.by || '', srcName,
      detail: [x.basis, x.notificationNo ? `通知单 ${x.notificationNo}` : ''].filter(Boolean).join('；'), srcRef: x.srcRow ? `第${x.srcRow}行` : '',
      noDueReason: due ? null : '缺陷未定级或缺发现时间，脚本未生成处理时限',
      prio: priorityOf('defects', 'followup', { level: dl.level }),
    });
  }
}

/** shift-handover-record 的 handover.json：pending[] 为交接未完成事项（含其自身结转项），原样纳入待办，期限不改写 */
function fromHandover(j, srcName, push, date) {
  const meta = j.meta || {};
  const shiftLabel = [meta.workshop, meta.shift].filter(Boolean).join(' ') || '上一班/上一值';
  for (const x of j.pending || []) {
    const due = C.normDate(x.due);
    const rawDue = C.str(x.due || x.dueText);
    if (rawDue && !due && !/待定|未填|TBD|—/.test(rawDue)) warnings.push(`${srcName} 交接事项「${C.str(x.content).slice(0, 20)}」期限「${rawDue}」无法解析，按无到期日处理（未自行设定到期日）`);
    const overdue = due ? C.diffDays(due, date) < 0 : false;
    push({
      kind: 'handover', sub: overdue ? 'overdue' : 'pending', refNo: '', tag: C.str(x.tag).replace(/^（待补）$|^待定$/, ''), name: C.str(x.name),
      title: `交接未完成｜${C.str(x.tag) || '（无位号）'} ${C.str(x.content) || '（无内容）'}${x.state && x.state !== '未完成' ? `（${x.state}）` : ''}`.trim(),
      dueDate: due, owner: C.str(x.owner).replace(/^（待补）$/, ''), srcName,
      detail: [x.handling, x.originShift && x.originShift !== shiftLabel ? `最初来自 ${x.originShift}` : '', x.carryTimes ? `交接记录中已连续结转 ${x.carryTimes} 次` : ''].filter(Boolean).join('；'),
      srcRef: x.sheet ? `${x.sheet} 第${x.row}行` : `交接记录（${shiftLabel}）`,
      noDueReason: due ? null : '交接记录未写明期限，脚本未自行设定',
      prio: priorityOf('handover', overdue ? 'overdue' : 'pending'),
    });
  }
}

// ---------------------------------------------------------------- 待办表 / 文字
function fromSheet(rows, sheetName, srcName, push) {
  const recs = C.toRecords(rows, ['事项'], sheetName, ['到期日', '来源', '优先级', '位号', '编号', '责任人', '状态', '备注'], warnings, ALIASES);
  for (const r of recs) {
    const title = C.str(r['事项']);
    if (!title) { warnings.push(`工作表「${sheetName}」第${r._row}行 事项为空，已跳过`); continue; }
    const st = C.str(r['状态']);
    if (st && /已完成|已闭环|已关闭|完成$/.test(st)) continue;   // 表中已标完成的不再进待办
    const rawDue = C.str(r['到期日']);
    const due = C.normDate(r['到期日']);
    if (rawDue && !due) warnings.push(`工作表「${sheetName}」第${r._row}行 到期日「${rawDue}」无法解析，该项按无到期日处理（未自行设定到期日）`);
    push({
      kind: 'sheet', sub: 'manual', refNo: C.str(r['编号']), tag: C.str(r['位号']), name: '',
      title, dueDate: due, owner: C.str(r['责任人']), srcName,
      detail: C.str(r['备注']), srcRef: `${sheetName} 第${r._row}行`,
      srcLabel: C.str(r['来源']) || null,
      noDueReason: due ? null : (rawDue ? `到期日「${rawDue}」无法解析` : '待办表未填写到期日'),
      prio: parsePriority(r['优先级'], `工作表「${sheetName}」第${r._row}行`) || priorityOf('sheet', 'manual'),
      prioFromUser: !!parsePriority(r['优先级']),
    });
  }
}

/** 纯文字待办：每行一条，支持行内写「截止 2026-09-25」「到期：2026/9/25」 */
function fromText(text, srcName, push) {
  const lines = String(text).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  let n = 0;
  for (const line of lines) {
    if (/^#/.test(line)) continue;                                  // markdown 标题行跳过
    const body = line.replace(/^[-*•]\s*|^\d+[.、)]\s*/, '').trim();
    if (!body) continue;
    n++;
    const m = body.match(/(?:截止|到期|前完成|完成期限)[：:\s]*((?:\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2})|(?:\d{8}))/);
    const due = m ? C.normDate(m[1]) : null;
    push({
      kind: 'text', sub: 'manual', refNo: '', tag: '', name: '',
      title: body, dueDate: due, owner: '', srcName,
      detail: '', srcRef: `${srcName} 第${n}条`,
      noDueReason: due ? null : '文字待办未写明到期日',
      prio: priorityOf('text', 'manual'),
    });
  }
  return n;
}

// ---------------------------------------------------------------- 主流程
function main() {
  const a = C.parseArgs(process.argv.slice(2), VALUE_OPTS, FLAG_OPTS);
  if (!a.input) throw new Error('缺少 --input');
  if (!a.owner) throw new Error('缺少 --owner');
  if (!a.date) throw new Error('缺少 --date');
  const date = C.normDate(a.date);
  if (!date) throw new Error(`--date 「${a.date}」不是有效日期，应为 YYYY-MM-DD`);
  let horizon = 7;
  if (a.horizon !== undefined) {
    const n = Number(a.horizon);
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) throw new Error(`--horizon 「${a.horizon}」应为不小于 0 的整数天数`);
    horizon = n;
  }

  const inputs = a.input.split(',').map((s) => s.trim()).filter(Boolean);
  if (!inputs.length) throw new Error('--input 未给出有效路径');
  const outDir = a.out || path.join(require('os').tmpdir(), 'wtm-out');   // 默认写系统临时目录，不污染输入目录；建议始终传 --out

  const items = [];
  const sources = [];
  const push = (it) => { items.push(it); };

  for (const p of inputs) {
    const got = loadAny(p);
    if (got.kind === 'json') {
      const t = detectJson(got.data);
      if (t === 'orders') { fromOrders(got.data, got.name, push); sources.push(`${got.name}→${SRC_CN.orders}(JSON)`); }
      else if (t === 'hazard') { fromHazard(got.data, got.name, push); sources.push(`${got.name}→${SRC_CN.hazard}(JSON)`); }
      else if (t === 'inspection') { fromInspection(got.data, got.name, push); sources.push(`${got.name}→${SRC_CN.inspection}(JSON)`); }
      else if (t === 'calibration') { fromCalibration(got.data, got.name, push); sources.push(`${got.name}→${SRC_CN.calibration}(JSON)`); }
      else if (t === 'lube') { fromLube(got.data, got.name, push); sources.push(`${got.name}→${SRC_CN.lube}(JSON)`); }
      else if (t === 'defects') { fromDefects(got.data, got.name, push); sources.push(`${got.name}→${SRC_CN.defects}(JSON)`); }
      else if (t === 'handover' || t === 'handover-inferred') {
        if (t === 'handover-inferred') warnings.push(`${got.name} 未带 meta.skill，按结构（pending 数组 + 交接时间/班次）推断为 shift-handover-record 的交接记录，请核对`);
        fromHandover(got.data, got.name, push, date); sources.push(`${got.name}→${SRC_CN.handover}(JSON)`);
      }
      else if (t === 'todo') { warnings.push(`${got.name} 是本技能的产出 todo.json，结转请用 --prev 传入，已忽略`); }
      else warnings.push(`${got.name} 无法识别为已知的上游 JSON（工单跟踪/隐患整改/特种设备定检/阀门仪表校验/润滑管理/缺陷登记/工作交接），已忽略，不影响其余来源汇集`);
      continue;
    }
    if (got.kind === 'text') {
      const n = fromText(got.data, got.name, push);
      if (n) sources.push(`${got.name}→${SRC_CN.text}(文字)`);
      else warnings.push(`${got.name} 未解析出任何待办条目`);
      continue;
    }
    // xlsx / CSV 目录
    const rows = C.pickSheet(got.data, '待办', '待办清单', '工作待办', '跟进事项', '任务清单');
    if (!rows) {
      warnings.push(`${got.name} 中未找到「待办」类工作表（待办/待办清单/工作待办/跟进事项/任务清单），已忽略`);
      continue;
    }
    fromSheet(rows, `${got.name}/待办`, got.name, push);
    sources.push(`${got.name}→${SRC_CN.sheet}`);
  }

  // ---- 上一日结转：原样保留原始到期日与来源，绝不自动延期、绝不静默丢弃
  let carriedOver = [];
  if (a.prev) {
    if (!fs.existsSync(a.prev)) throw new Error(`上一日 todo.json 不存在: ${a.prev}`);
    let prev;
    try { prev = JSON.parse(fs.readFileSync(a.prev, 'utf8')); } catch (e) { throw new Error(`上一日 todo.json 解析失败: ${e.message}`); }
    const prevDate = (prev.meta && prev.meta.date) || null;
    const prevItems = prev.items || [];
    if (!prevItems.length) warnings.push(`上一日 todo.json（${path.basename(a.prev)}）中没有 items，无可结转项`);
    const present = new Set(items.map(itemKey));
    const doneSet = new Set((prev.doneKeys || []));
    for (const x of prevItems) {
      if (x.status === 'done') continue;                 // 上一日已标完成的不再结转
      if (doneSet.has(x.key)) continue;
      const key = x.key || itemKey(x);
      const carried = {
        kind: x.kind, sub: x.sub, refNo: x.refNo || '', tag: x.tag || '', name: x.name || '',
        title: x.title, dueDate: x.dueDate || null,      // 原始到期日原样保留
        owner: x.owner || '', srcName: x.srcName || '',
        detail: x.detail || '', srcRef: x.srcRef || '',
        noDueReason: x.noDueReason || null,
        prio: x.priority || 'P3', prioFromUser: !!x.prioFromUser,
        carried: true,
        carriedFrom: x.carriedFrom || prevDate,          // 首次结转记当日，再次结转保留最早日期
        carriedRounds: (x.carriedRounds || 0) + 1,
        originalDueDate: x.originalDueDate || x.dueDate || null,
        originalSource: x.originalSource || `${SRC_CN[x.kind] || x.kind}｜${x.srcName || '—'}`,
      };
      if (present.has(key)) {
        // 本日来源中已再次出现同一事项：不重复列，但把结转标记合并到本日项上
        const cur = items.find((y) => itemKey(y) === key);
        cur.carried = true;
        cur.carriedFrom = carried.carriedFrom;
        cur.carriedRounds = carried.carriedRounds;
        cur.originalDueDate = carried.originalDueDate;
        cur.originalSource = carried.originalSource;
        continue;
      }
      items.push(carried);
    }
    carriedOver = items.filter((x) => x.carried);
  }

  if (!sources.length && !carriedOver.length) {
    throw new Error('未在输入中识别到任何可用待办来源（上游技能 JSON / 待办表 / 文字待办），也无结转项');
  }

  // ---- 计算到期分桶与逾期天数
  for (const it of items) {
    it.key = itemKey(it);
    it.priority = it.prio;
    delete it.prio;
    it.priorityCn = PRIO_CN[it.priority] || it.priority;
    it.kindCn = SRC_CN[it.kind] || it.kind;
    it.srcLabel = it.srcLabel || it.kindCn;
    if (!it.dueDate) {
      it.bucket = 'noDueDate';
      it.overdueDays = null;
      it.daysLeft = null;
      if (!it.noDueReason) it.noDueReason = '来源数据未提供到期日';
      continue;
    }
    const d = C.diffDays(it.dueDate, date);   // >0 还剩几天，=0 今日，<0 已逾期
    it.daysLeft = d;
    it.overdueDays = d < 0 ? -d : null;
    if (d < 0) it.bucket = 'overdue';
    else if (d === 0) it.bucket = 'today';
    else if (d <= horizon) it.bucket = 'upcoming';
    else it.bucket = 'later';
  }

  // ---- 疑似重复：同一位号/编号的事项出现在多个来源，列出供确认，绝不自动合并
  const possibleDuplicate = [];
  const dupSeen = new Set();
  const byAnchor = new Map();
  for (const it of items) {
    const anchor = it.tag || it.refNo;
    if (!anchor) continue;
    if (!byAnchor.has(anchor)) byAnchor.set(anchor, []);
    byAnchor.get(anchor).push(it);
  }
  for (const [anchor, list] of byAnchor) {
    const kinds = new Set(list.map((x) => x.kind));
    if (list.length < 2 || kinds.size < 2) continue;
    const g = `dup:${anchor}`;
    if (dupSeen.has(g)) continue;
    dupSeen.add(g);
    possibleDuplicate.push({
      anchor,
      reason: `同一对象「${anchor}」在 ${[...kinds].map((k) => SRC_CN[k] || k).join('、')} ${kinds.size} 个来源中均有待办，可能是同一事项的不同记录`,
      note: '脚本不自动合并，请设备员确认是否为同一事项',
      items: list.map((x) => ({ key: x.key, title: x.title, source: x.kindCn, srcName: x.srcName, dueDate: x.dueDate, priority: x.priority, srcRef: x.srcRef })),
    });
    for (const x of list) x.possibleDuplicate = anchor;
  }
  // 同一来源内文本高度一致的条目也提示（不合并）
  const fpMap = new Map();
  for (const it of items) {
    const fp = fingerprint(it.title);
    if (!fp) continue;
    if (!fpMap.has(fp)) fpMap.set(fp, []);
    fpMap.get(fp).push(it);
  }
  for (const [fp, list] of fpMap) {
    if (list.length < 2) continue;
    const anchor = list[0].tag || list[0].refNo || list[0].title.slice(0, 16);
    if (dupSeen.has(`dup:${anchor}`)) continue;
    dupSeen.add(`dup:${anchor}`);
    possibleDuplicate.push({
      anchor,
      reason: `${list.length} 条待办的事项文字完全一致（来自 ${[...new Set(list.map((x) => x.srcName))].join('、')}）`,
      note: '脚本不自动合并，请设备员确认是否为同一事项',
      items: list.map((x) => ({ key: x.key, title: x.title, source: x.kindCn, srcName: x.srcName, dueDate: x.dueDate, priority: x.priority, srcRef: x.srcRef })),
    });
    for (const x of list) x.possibleDuplicate = anchor;
  }
  if (possibleDuplicate.length) {
    for (const d of possibleDuplicate) warnings.push(`疑似重复待办：${d.reason}（共 ${d.items.length} 条），已单列供确认，未自动合并`);
  }

  // ---- 无到期日的告警
  const noDue = items.filter((x) => x.bucket === 'noDueDate');
  if (noDue.length) warnings.push(`有 ${noDue.length} 项待办无到期日，已单列「无到期日」一节，脚本未自行设定到期日`);

  // ---- 排序：优先级 → 逾期天数多者优先 → 到期日早者优先 → 来源
  const order = { overdue: 0, today: 1, upcoming: 2, later: 3, noDueDate: 4 };
  const cmp = (x, y) => (PRIO[x.priority] || 9) - (PRIO[y.priority] || 9)
    || (y.overdueDays || 0) - (x.overdueDays || 0)
    || String(x.dueDate || '9999-12-31').localeCompare(String(y.dueDate || '9999-12-31'))
    || String(x.kind).localeCompare(String(y.kind))
    || String(x.title).localeCompare(String(y.title), 'zh');
  items.sort((x, y) => (order[x.bucket] - order[y.bucket]) || cmp(x, y));

  const pick = (b) => items.filter((x) => x.bucket === b).sort(cmp);
  const overdue = pick('overdue'), today = pick('today'), upcoming = pick('upcoming');
  const later = pick('later'), noDueDate = pick('noDueDate');
  carriedOver = items.filter((x) => x.carried).sort(cmp);

  // ---- 按来源分类
  const kindOrder = ['hazard', 'inspection', 'calibration', 'orders', 'defects', 'handover', 'lube', 'sheet', 'text'];
  const byCategory = [];
  for (const k of kindOrder) {
    const g = items.filter((x) => x.kind === k);
    if (!g.length) continue;
    byCategory.push({
      kind: k, kindCn: SRC_CN[k] || k, total: g.length,
      overdue: g.filter((x) => x.bucket === 'overdue').length,
      today: g.filter((x) => x.bucket === 'today').length,
      upcoming: g.filter((x) => x.bucket === 'upcoming').length,
      noDueDate: g.filter((x) => x.bucket === 'noDueDate').length,
      keys: g.map((x) => x.key),
    });
  }

  // ---- 今日完成事项（由 --done 提供，脚本不推断）
  let done = null;
  if (a.done !== undefined) {
    let raw = a.done;
    if (fs.existsSync(raw) && fs.statSync(raw).isFile()) raw = fs.readFileSync(raw, 'utf8');
    done = String(raw).split(/[\r\n;；]/).map((s) => s.replace(/^[-*•]\s*|^\d+[.、)]\s*/, '').trim()).filter(Boolean);
    if (!done.length) { warnings.push('--done 未解析出任何已完成事项，工作日志「今日完成事项」一节为空'); done = []; }
  } else {
    warnings.push('未提供 --done，工作日志「今日完成事项」一节留空，脚本不推断已完成事项');
  }

  const counts = {
    total: items.length,
    overdue: overdue.length,
    today: today.length,
    upcoming: upcoming.length,
    later: later.length,
    noDueDate: noDueDate.length,
    carriedOver: carriedOver.length,
    possibleDuplicate: possibleDuplicate.length,
    sources: sources.length,
    done: done === null ? null : done.length,
    byPriority: { P1: items.filter((x) => x.priority === 'P1').length, P2: items.filter((x) => x.priority === 'P2').length, P3: items.filter((x) => x.priority === 'P3').length, P4: items.filter((x) => x.priority === 'P4').length },
    maxOverdueDays: overdue.length ? Math.max(...overdue.map((x) => x.overdueDays)) : null,
  };

  // ---- 产出
  C.ensureDir(outDir);
  const result = {
    meta: {
      skill: 'worklog-todo-manager', owner: a.owner, date, horizon,
      sources, prevProvided: !!a.prev, prev: a.prev ? path.basename(a.prev) : null,
      doneProvided: done !== null, priorityRules: a['priority-rules'] || null,
      generatedAt: C.localDateTime(), statement: STATEMENT, statementGeneric: STATEMENT_GENERIC,
    },
    counts, overdue, today, upcoming, later, noDueDate, carriedOver,
    byCategory, possibleDuplicate, done, items, warnings,
  };
  fs.writeFileSync(path.join(outDir, 'todo.json'), JSON.stringify(result, null, 2), 'utf8');
  fs.writeFileSync(path.join(outDir, '待办清单.md'), renderTodo(a, result), 'utf8');
  fs.writeFileSync(path.join(outDir, '工作日志.md'), renderLog(a, result), 'utf8');

  C.emitOk(outDir, { ok: true, out: outDir, date, owner: a.owner, horizon, counts, sources, warnings });
}

// ---------------------------------------------------------------- 渲染
function row(x) {
  return [
    x.title,
    `${x.kindCn}｜${x.srcName || '—'}`,
    x.dueDate || '—',
    x.overdueDays !== null && x.overdueDays !== undefined ? `已逾期 ${x.overdueDays} 天` : (x.daysLeft === 0 ? '今日' : (x.daysLeft === null ? '—' : `剩 ${x.daysLeft} 天`)),
    x.priorityCn,
    x.carried ? `结转自 ${x.carriedFrom || '—'}` : '—',
    x.owner || '—',
  ];
}
const HEAD = ['事项', '来源', '到期日', '时限', '优先级', '结转', '责任人'];

function renderTodo(a, R) {
  const c = R.counts;
  const L = [];
  L.push(`# ${R.meta.owner} 待办清单（${R.meta.date}）`);
  L.push('');
  L.push(`前瞻期：${R.meta.horizon} 天 ｜ 生成时间：${R.meta.generatedAt}（北京时间）`);
  L.push('');
  L.push(`汇集来源（共 ${c.sources} 项）：${R.meta.sources.length ? R.meta.sources.join('、') : '—'}`);
  L.push('');
  L.push(`> ${R.meta.statement}`);
  L.push(`> ${R.meta.statementGeneric}`);
  L.push('');
  L.push('## 一、待办概况');
  L.push('');
  L.push(C.mdTable(['指标', '数量'], [
    ['待办合计', c.total], ['已逾期', c.overdue], ['今日到期', c.today],
    [`前瞻期内（${R.meta.horizon} 天）`, c.upcoming], ['前瞻期外', c.later],
    ['无到期日', c.noDueDate], ['结转项', c.carriedOver], ['疑似重复', c.possibleDuplicate],
    ['P1 最高', c.byPriority.P1], ['P2 高', c.byPriority.P2], ['P3 中', c.byPriority.P3], ['P4 低', c.byPriority.P4],
  ]));
  L.push('## 二、已逾期');
  L.push('');
  if (!R.overdue.length) L.push('_无_\n');
  else {
    L.push(`最长逾期 ${c.maxOverdueDays} 天。`);
    L.push('');
    L.push(C.mdTable(HEAD, R.overdue.map(row)));
  }
  L.push('## 三、今日到期');
  L.push('');
  L.push(C.mdTable(HEAD, R.today.map(row)));
  L.push(`## 四、近期（${R.meta.horizon} 天内）`);
  L.push('');
  L.push(C.mdTable(HEAD, R.upcoming.map(row)));
  L.push('## 五、无到期日');
  L.push('');
  L.push('_以下事项来源数据未提供到期日，脚本未自行设定，请设备员确认期限后补填。_');
  L.push('');
  L.push(C.mdTable(['事项', '来源', '无到期日原因', '优先级', '责任人'],
    R.noDueDate.map((x) => [x.title, `${x.kindCn}｜${x.srcName || '—'}`, x.noDueReason || '—', x.priorityCn, x.owner || '—'])));
  L.push('## 六、结转项');
  L.push('');
  if (!R.meta.prevProvided) L.push('_未提供上一日 todo.json（--prev），不做结转。_\n');
  else if (!R.carriedOver.length) L.push('_上一日无未完成事项需结转。_\n');
  else {
    L.push('_结转项保留原始到期日与原始来源，脚本不自动延期。_');
    L.push('');
    L.push(C.mdTable(['事项', '原始来源', '原始到期日', '当前到期日', '结转自', '已结转次数', '优先级'],
      R.carriedOver.map((x) => [x.title, x.originalSource || '—', x.originalDueDate || '—', x.dueDate || '—',
        x.carriedFrom || '—', x.carriedRounds || 1, x.priorityCn])));
  }
  L.push('## 七、按来源分类');
  L.push('');
  L.push(C.mdTable(['来源', '合计', '已逾期', '今日到期', '近期', '无到期日'],
    R.byCategory.map((x) => [x.kindCn, x.total, x.overdue, x.today, x.upcoming, x.noDueDate])));
  L.push('## 八、疑似重复（需确认，未自动合并）');
  L.push('');
  if (!R.possibleDuplicate.length) L.push('_无_\n');
  else {
    for (const d of R.possibleDuplicate) {
      L.push(`**${d.anchor}** —— ${d.reason}。${d.note}`);
      L.push('');
      L.push(C.mdTable(['事项', '来源', '来源文件', '到期日', '优先级', '出处'],
        d.items.map((x) => [x.title, x.source, x.srcName || '—', x.dueDate || '—', PRIO_CN[x.priority] || x.priority, x.srcRef || '—'])));
    }
  }
  if (R.later.length) {
    L.push(`## 九、前瞻期外（${R.meta.horizon} 天以后）`);
    L.push('');
    L.push(C.mdTable(HEAD, R.later.map(row)));
  }
  if (R.warnings.length) {
    L.push('## 附：数据提示');
    L.push('');
    for (const w of R.warnings) L.push(`- ${w}`);
    L.push('');
  }
  return L.join('\n');
}

function renderLog(a, R) {
  const c = R.counts;
  const L = [];
  L.push(`# ${R.meta.owner} 工作日志（${R.meta.date}）`);
  L.push('');
  L.push(`生成时间：${R.meta.generatedAt}（北京时间）`);
  L.push('');
  L.push(`> ${R.meta.statement}`);
  L.push(`> ${R.meta.statementGeneric}`);
  L.push('');
  L.push('## 一、今日完成事项');
  L.push('');
  if (R.done === null) L.push('_未提供 --done，本节留空，请设备员补填；脚本不推断已完成事项。_\n');
  else if (!R.done.length) L.push('_本日未登记完成事项。_\n');
  else { for (const d of R.done) L.push(`- ${d}`); L.push(''); }
  L.push('## 二、待办概况');
  L.push('');
  L.push(C.mdTable(['指标', '数量'], [
    ['待办合计', c.total], ['已逾期', c.overdue], ['今日到期', c.today],
    [`近期（${R.meta.horizon} 天内）`, c.upcoming], ['无到期日', c.noDueDate], ['结转项', c.carriedOver],
  ]));
  L.push('逾期与今日到期事项：');
  L.push('');
  L.push(C.mdTable(['事项', '来源', '到期日', '时限', '优先级'],
    [...R.overdue, ...R.today].map((x) => [x.title, `${x.kindCn}｜${x.srcName || '—'}`, x.dueDate || '—',
      x.overdueDays ? `已逾期 ${x.overdueDays} 天` : '今日', x.priorityCn])));
  L.push('## 三、需协调事项');
  L.push('');
  L.push('<!-- ANALYSIS_START -->');
  L.push('（由模型依据 references/todo-rules.md 口径撰写：需其他班组/外委/上级协调的事项，逐条写明事项、卡在哪个环节、需要谁配合。数字一律引用 todo.json，不得自行统计；不得判定某项待办可以不做。）');
  L.push('<!-- ANALYSIS_END -->');
  L.push('');
  L.push('## 四、明日重点');
  L.push('');
  L.push('按脚本排序，明日应优先处理的前若干项：');
  L.push('');
  const tomorrow = [...R.overdue, ...R.today, ...R.upcoming].slice(0, 10);
  L.push(C.mdTable(['序号', '事项', '来源', '到期日', '优先级'],
    tomorrow.map((x, i) => [i + 1, x.title, `${x.kindCn}｜${x.srcName || '—'}`, x.dueDate || '—', x.priorityCn])));
  L.push('<!-- ANALYSIS_START -->');
  L.push('（由模型补充说明：明日重点的安排思路、需提前准备的资料或备件、与生产计划的冲突点。不得自动延期或关闭任何事项。）');
  L.push('<!-- ANALYSIS_END -->');
  L.push('');
  if (R.warnings.length) {
    L.push('## 附：数据提示');
    L.push('');
    for (const w of R.warnings) L.push(`- ${w}`);
    L.push('');
  }
  return L.join('\n');
}

try { main(); } catch (e) { C.fail(e, warnings); }
