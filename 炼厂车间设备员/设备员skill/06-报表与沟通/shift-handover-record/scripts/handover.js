#!/usr/bin/env node
'use strict';
/**
 * 设备员值班与工作交接记录生成脚本（仅 Node.js 内置模块；中石化体系炼化厂车间设备员口径）
 * 用法：node "<技能目录>/scripts/handover.js" --input <本次记录xlsx> --workshop "常减压车间" --type <值班交接|休假交接|调岗交接>
 *       --time 2026-09-21T17:00:00+08:00 --by "交接人" [--out <dir>] [--prev <上次 handover.json|xlsx>]
 *       [--to "接手人"] [--shift "<值次说明，如 10月26日值班>"] [--inrepair <在修设备xlsx>]
 * 产出：<out>/handover.json、<out>/handover.md、<out>/summary.json；末行打印 JSON 摘要
 *
 * 口径：车间设备员常白班不倒班，交接的是 值班 / 休假 / 调岗 的工作交接，不是操作班组的 DCS 交接班。
 * 核心规则：上次交接遗留的未完成事项，若在本次记录中找不到对应处理/闭环记录，
 *           必须原样结转（carriedOver），标注「上次交接遗留，本次未处理」，
 *           保留原始来源交接与原始要求完成时间，绝不静默丢弃、绝不自动延期。
 * handover.json 约定：meta.skill === 'shift-handover-record' 且含 pending 数组，worklog-todo-manager 按此识别并纳入待办。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readXlsx, readCsvDir } = require('./lib/xlsx-lite');
const C = require('./lib/common');

const warnings = [];
const VALUE_OPTS = ['input', 'workshop', 'type', 'shift', 'time', 'by', 'to', 'out', 'prev', 'inrepair'];
const TYPES = ['值班交接', '休假交接', '调岗交接'];
const FLAG_OPTS = ['help'];

/** 信息缺失统一占位：绝不省略条目，只把缺的字段写成「待明确」 */
const TBD = '待明确';
const orTBD = (v) => { const s = C.str(v); return s === '' ? TBD : s; };

// 局部别名优先，再合并中石化常用系统（SAP PM/EM、作业许可、智能巡检）导出列名；
// 「设备编号」是 SAP 8 位流水号，不作位号别名；「设备」归设备编号而非设备名称。
const ALIASES = C.mergeAliases({
  '位号': ['位号', '设备位号', 'TAG', 'tag'],
  '设备名称': ['设备名称', '名称'],
  '事项类型': ['事项类型', '类型', '事项', '记录类型', '分类'],
  '内容': ['内容', '事项内容', '情况', '描述', '问题描述', '事件', '通知单描述'],
  '处理情况': ['处理情况', '处理', '处理结果', '措施', '处置情况', '处理措施'],
  '状态': ['状态', '完成情况', '是否完成', '进展', '当前状态'],
  '责任人': ['责任人', '负责人', '处理人', '跟进人', '执行人'],
  '要求完成时间': ['要求完成时间', '完成时限', '计划完成时间', '要求完成', '期限', '计划完成', '基本结束日期'],
  '时间': ['时间', '发生时间', '记录时间', '发现时间', '通知日期'],
  '当前状态': ['当前状态', '状态', '检修状态', '进度', '进展', '系统状态'],
  '工单号': ['工单号', '工单', '检修单号', '单号', '通知单号', '维修通知单号', '通知单', '订单号', '订单'],
  '预计完工': ['预计完工', '预计完成', '计划完工', '计划回装', '预计恢复', '基本结束日期'],
});
ALIASES['设备名称'] = ALIASES['设备名称'].filter((x) => x !== '描述');

// ---- 车间范围核对（D007）：本次记录、在修设备、上次交接未完成事项表带车间列时，按 --workshop 剔除其他车间的行
// 车间列只认 车间 / 所属车间 / 属地车间 / 运行部（共享别名里的维护工厂、属地单位、使用单位不当车间列）；
// 「车间」放在各表 optional 末尾，前缀匹配时不抢「车间监护人」等别的字段的列
ALIASES['车间'] = C.WORKSHOP_COLS.slice();
/** 核对上下文：main() 里填入 --workshop；各表核对结果收进 scopes → meta.workshopScope */
const WS = { workshop: null, scopes: [] };
/** 「车间负责人」「车间监护人」这类人员列不当车间列 */
const NOT_WORKSHOP_COL = /(人|员|长|签字|签名|电话|意见)$/;
function scopeRows(recs, sheet, workshop = WS.workshop, scopes = WS.scopes) {
  const col = recs.hasCol && recs.hasCol('车间') ? recs.colName('车间') : null;
  let input = recs;
  if (col && NOT_WORKSHOP_COL.test(col)) {
    input = recs.slice();
    input.hasCol = (n) => n !== '车间' && recs.hasCol(n);
    input.colName = (n) => (n === '车间' ? null : recs.colName(n));
  }
  const { records, scope } = C.workshopScope(input, workshop, sheet, warnings);
  if (input !== recs) scope.ignoredColumn = col;
  scopes.push(scope);
  return records;
}

// ---------------------------------------------------------------- 取值归一
const TYPE_MAP = [
  { key: 'statusChange', words: ['状态变化', '状态变更', '开停', '切换', '投用', '停运', '状态'] },
  { key: 'abnormal', words: ['异常处理', '异常', '故障处理', '故障', '缺陷', '处理'] },
  { key: 'inRepair', words: ['在修', '检修', '维修', '抢修', '施工'] },
];
/** 事项类型归一；无法归类返回 null（单列 undetermined，绝不默认归到某一类） */
function classifyType(v) {
  const s = C.str(v).replace(/\s/g, '');
  if (s === '') return null;
  for (const t of TYPE_MAP) if (t.words.some((w) => s.includes(w))) return t.key;
  return null;
}

const DONE_WORDS = ['已完成', '完成', '已闭环', '闭环', '已处理', '处理完毕', '已消除', '已恢复', '已回装', '已投用'];
const OPEN_WORDS = ['未完成', '未处理', '未闭环', '进行中', '处理中', '跟进中', '待处理', '待跟进', '在修', '未结束', '部分完成', '未全部'];
// 否定词与完成类动词之间允许隔 0~3 个字（未全部完成、还没有都完成），但中间不能有「已」或标点（「不再振动，已处理」「不漏了已处理」仍按已完成）
//「未见异常处理完毕」「没发现问题处理完毕」里的否定是「未见 / 没发现」，不是否定完成，排除
//「不」只认紧贴动词（不完成、不能投用）：「不对中 / 不平衡 / 不合格品 处理完毕」里的「不」修饰名词，不是否定完成
const NEG_DONE = /(未|待|没|没有|尚未|暂未|还没|还未)(?!有?(?:见|发现))(?:(?!已)[^，。；,;、]){0,3}(完成|处理|闭环|恢复|消除|回装|投用|结束)|不(?:能|会|可|可能|得)?(完成|处理|闭环|恢复|消除|回装|投用|结束)/;
// 「技术完成 / 完工待验 / 待验收」按口径对照归待验收，不是闭环；须在 DONE_WORDS（含「完成」）之前判
const ACCEPT_WORDS = ['技术完成', '完工待验', '待验收', '已完工'];
// SAP 六态（common.js normSapStatus）→ 完成状态；已取消（DLFL/LKD）不默认销账，单列未判定由交接双方确认
const SAP_DONE = { '待审核': 'open', '已派工': 'open', '施工中': 'open', '待验收': 'open', '已闭环': 'done', '已取消': null };
// 多码组合（如「REL CNF」「TECO NMAT」）取最靠后的状态
const SAP_RANK = ['待审核', '已派工', '施工中', '待验收', '已闭环', '已取消'];
/**
 * 完成状态归一：{ done: 'done' | 'open' | null, sap: SAP 六态 | null }。
 * done 为 null 表示无法判定，绝不按最宽松或最严格默认。
 * 口径（中石化口径对照第四节）：CLSD / NOCO 已闭环；TECO / CNF / 技术完成 待验收，不算闭环；
 * CRTD / OSNO / REL / NOPR / PCNF 未完成；DLFL / LKD 已取消，判未判定由交接双方确认。
 */
function classifyStatus(v) {
  const s = C.str(v).replace(/\s+/g, ' ').trim();
  if (s === '') return { done: null, sap: null };
  // 1. SAP 系统状态码（可多码组合，码以外的英文标记如 NMAT/PRC 忽略）
  if (/^[A-Za-z]+([\s,，;；/]+[A-Za-z]+)*$/.test(s)) {
    const ks = s.split(/[\s,，;；/]+/).map((t) => C.normSapStatus(t)).filter(Boolean);
    if (ks.length) {
      const k = ks.reduce((x, y) => (SAP_RANK.indexOf(y) > SAP_RANK.indexOf(x) ? y : x));
      return { done: SAP_DONE[k], sap: k };
    }
    return { done: null, sap: null };
  }
  const z = s.replace(/\s/g, '');
  // 2. 先判「未」字前缀类，避免「未完成」被「完成」命中
  if (OPEN_WORDS.some((w) => z.includes(w))) return { done: 'open', sap: null };
  // 「待完成 / 没完成 / 尚未恢复 / 还没处理 / 未全部完成」等否定写法：否定词与完成类动词相隔 0~3 字，判未完成，不被 DONE_WORDS 的「完成」命中
  if (NEG_DONE.test(z)) return { done: 'open', sap: null };
  if (ACCEPT_WORDS.some((w) => z.includes(w))) return { done: 'open', sap: '待验收' };
  if (DONE_WORDS.some((w) => z.includes(w))) return { done: 'done', sap: null };
  // 3. 「已删除 / 删除」是 EAM 导出 DLFL 的中文写法，common.js 的已取消词表未收，这里按已取消处理
  if (/删除/.test(z)) return { done: null, sap: '已取消' };
  // 4. 其余中文状态词（已下达、已派工、施工中、已关闭、已验收、已消缺、已取消 …）按 SAP 六态归一
  const k = C.normSapStatus(z);
  if (k) return { done: SAP_DONE[k], sap: k };
  return { done: null, sap: null };
}

/** 北京时间墙钟「YYYY-MM-DD HH:mm」→ 毫秒时间戳（按 +08:00 解析，不受主机时区影响）；无法解析返回 NaN */
function bjMs(s) {
  const m = C.str(s).match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
  return m ? Date.parse(`${m[1]}T${m[2]}:00+08:00`) : NaN;
}

// ---------------------------------------------------------------- 结转匹配
/** 归一化文本用于相似度：去标点空白，转小写 */
function normText(s) {
  return C.str(s).toLowerCase().replace(/[\s，,。.；;：:、（）()【】\[\]「」"'`~!！?？-]/g, '');
}
/** bigram 相似度（Dice 系数），单字串退化为字符集合比较 */
function similarity(a, b) {
  const x = normText(a), y = normText(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const gram = (s) => { const g = []; if (s.length < 2) return [s]; for (let i = 0; i < s.length - 1; i++) g.push(s.slice(i, i + 2)); return g; };
  const ga = gram(x), gb = gram(y);
  const pool = gb.slice();
  let hit = 0;
  for (const g of ga) { const j = pool.indexOf(g); if (j >= 0) { hit++; pool.splice(j, 1); } }
  return (2 * hit) / (ga.length + gb.length);
}
/**
 * 匹配阈值：位号完全相同时，位号本身已是强证据，内容只需弱相似即可认为是同一事项；
 * 位号缺失（待明确）只能靠内容匹配，阈值从严，避免把不相干的事项误判为已跟进而漏掉结转。
 */
const SIM_TAG_EQ = 0.2;
const SIM_TAG_LOOSE = 0.6;

// ---------------------------------------------------------------- 输入读取
function loadBook(p) {
  const st = fs.statSync(p);
  return st.isDirectory() ? readCsvDir(p) : readXlsx(p);
}

/** 读取本次记录（可多文件，逗号分隔） */
function readCurrent(inputs) {
  const items = [];
  let found = false;
  const srcs = [];
  for (const p of inputs) {
    let book;
    try { book = loadBook(p); } catch (e) { throw new Error(`读取失败 ${p}: ${e.message}`); }
    const rows = C.pickSheet(book, '本次记录', '值班记录', '工作记录', '本班记录', '交接记录', '设备记录', '记录');
    if (!rows) { warnings.push(`文件「${path.basename(p)}」中未找到「本次记录」（值班记录 / 工作记录）工作表，已跳过`); continue; }
    found = true;
    srcs.push(path.basename(p));
    const sheetName = `${path.basename(p)}/本次记录`;
    const recs = scopeRows(C.toRecords(rows, ['位号', '内容'], sheetName,
      ['设备名称', '事项类型', '处理情况', '状态', '责任人', '要求完成时间', '时间', '车间'], warnings, ALIASES), sheetName);
    for (const r of recs) {
      const tag = C.str(r['位号']);
      const content = C.str(r['内容']);
      if (!tag && !content) { warnings.push(`${sheetName} 第${r._row}行 位号与内容均为空，已跳过`); continue; }
      if (!tag) warnings.push(`${sheetName} 第${r._row}行 位号为空，该事项仍予保留，位号记为「${TBD}」`);
      const t = C.normDateTime(r['时间']);
      if (C.str(r['时间']) && !t) warnings.push(`${sheetName} 第${r._row}行 时间「${C.str(r['时间'])}」无法解析`);
      const due = C.normDateTime(r['要求完成时间']);
      if (C.str(r['要求完成时间']) && !due) warnings.push(`${sheetName} 第${r._row}行 要求完成时间「${C.str(r['要求完成时间'])}」无法解析，按缺失处理`);
      const type = classifyType(r['事项类型']);
      if (type === null && C.str(r['事项类型'])) warnings.push(`${sheetName} 第${r._row}行 事项类型「${C.str(r['事项类型'])}」无法归类，已列入未归类事项`);
      if (type === null && !C.str(r['事项类型'])) warnings.push(`${sheetName} 第${r._row}行 事项类型为空，已列入未归类事项`);
      const { done, sap } = classifyStatus(r['状态']);
      if (done === null && sap === '已取消') warnings.push(`${sheetName} 第${r._row}行 状态「${C.str(r['状态'])}」为已取消/删除标记，未按已完成销账，已列入状态未判定事项，需交接双方确认是否仍需跟进`);
      else if (done === null && C.str(r['状态'])) warnings.push(`${sheetName} 第${r._row}行 状态「${C.str(r['状态'])}」无法判定为已完成/未完成，已列入状态未判定事项`);
      if (done === null && !C.str(r['状态'])) warnings.push(`${sheetName} 第${r._row}行 状态为空，已列入状态未判定事项`);
      items.push({
        tag: tag || TBD, rawTag: tag, name: C.str(r['设备名称']),
        type, rawType: C.str(r['事项类型']),
        content, handling: C.str(r['处理情况']),
        done, sap, rawStatus: C.str(r['状态']),
        owner: C.str(r['责任人']), due,
        time: t, sheet: sheetName, row: r._row,
      });
    }
  }
  if (!found) throw new Error('未在输入中找到「本次记录」（值班记录 / 工作记录 / 本班记录）工作表');
  return { items, sources: srcs };
}

/** 读取在修设备清单（可选表或独立文件） */
function readInRepair(book, label) {
  const rows = C.pickSheet(book, '在修设备', '在修', '检修设备');
  if (!rows) return null;
  const sheetName = `${label}/在修设备`;
  const recs = scopeRows(C.toRecords(rows, ['位号'], sheetName, ['设备名称', '当前状态', '工单号', '责任人', '预计完工', '车间'], warnings, ALIASES), sheetName);
  const list = [];
  for (const r of recs) {
    const tag = C.str(r['位号']);
    if (!tag) { warnings.push(`${sheetName} 第${r._row}行 位号为空，已跳过`); continue; }
    const state = C.str(r['当前状态']);
    if (!state) warnings.push(`${sheetName} 第${r._row}行 在修设备「${tag}」无当前状态说明，交接时需当面确认`);
    const eta = C.normDateTime(r['预计完工']);
    if (C.str(r['预计完工']) && !eta) warnings.push(`${sheetName} 第${r._row}行 预计完工「${C.str(r['预计完工'])}」无法解析，按缺失处理`);
    list.push({
      tag, name: C.str(r['设备名称']), state: state || null,
      order: C.str(r['工单号']), owner: C.str(r['责任人']), eta,
      stateMissing: !state, sheet: sheetName, row: r._row,
    });
  }
  return list;
}

/**
 * 读取上次交接记录：JSON（本脚本产出的 handover.json）或 xlsx（含「未完成事项」表）
 * 返回 [{tag,name,content,owner,due,source,originShift,originDue,originHandoverAt}]
 */
function readPrev(p) {
  if (!fs.existsSync(p)) throw new Error(`上次交接记录不存在: ${p}`);
  const ext = path.extname(p).toLowerCase();
  const out = [];
  if (ext === '.json') {
    let j;
    try { j = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { throw new Error(`上次交接记录解析失败: ${e.message}`); }
    const meta = j.meta || {};
    // 上次交接 JSON 的车间与本次不一致：只提示不剔除（整份不纳入会漏掉结转，结转「绝不静默丢弃」优先）
    if (C.str(meta.workshop) && WS.workshop && !C.sameWorkshop(meta.workshop, WS.workshop)) {
      warnings.push(`【注意】上次交接记录「${path.basename(p)}」的车间为「${C.str(meta.workshop)}」，与 --workshop「${WS.workshop}」不一致，仍按上次交接核对结转，请确认是否传错了文件`);
    }
    const shiftLabel = [meta.workshop, meta.type || meta.shift, meta.type && meta.shift ? meta.shift : ''].filter(Boolean).join(' ') || '上次交接';
    // pending 为该班全部未完成事项（含其自身结转项，见下）
    const list = Array.isArray(j.pending) ? j.pending : [];
    for (const x of list) {
      out.push({
        tag: C.str(x.tag) || TBD,
        name: C.str(x.name),
        content: C.str(x.content),
        owner: C.str(x.owner),
        due: x.due || null,
        // source：该条最初来自哪次交接。已是结转项的，保留它最早的来源，实现连续多次结转
        originShift: C.str(x.originShift) || C.str(x.source) || shiftLabel,
        originDue: x.originDue || x.due || null,
        originHandoverAt: x.originHandoverAt || meta.handoverAt || null,
        prevShift: shiftLabel,
        carryTimes: Number.isFinite(x.carryTimes) ? x.carryTimes : 0,
      });
    }
    return out;
  }
  // xlsx：读「未完成事项」表
  let book;
  try { book = loadBook(p); } catch (e) { throw new Error(`上次交接记录读取失败: ${e.message}`); }
  const rows = C.pickSheet(book, '未完成事项', '遗留事项', '待办事项', '交接事项');
  if (!rows) { warnings.push(`上次交接记录「${path.basename(p)}」中未找到「未完成事项」工作表，无法核对遗留项`); return out; }
  const sheetName = `${path.basename(p)}/未完成事项`;
  const recs = scopeRows(C.toRecords(rows, ['位号', '内容'], sheetName, ['设备名称', '责任人', '要求完成时间', '班次', '车间'], warnings, { ...ALIASES, '班次': ['来源交接', '来源', '班次', '来源班次', '原班次', '交接来源'] }), sheetName);
  for (const r of recs) {
    const content = C.str(r['内容']);
    const tag = C.str(r['位号']);
    if (!tag && !content) continue;
    const due = C.normDateTime(r['要求完成时间']);
    if (C.str(r['要求完成时间']) && !due) warnings.push(`${sheetName} 第${r._row}行 要求完成时间「${C.str(r['要求完成时间'])}」无法解析，按缺失处理`);
    out.push({
      tag: tag || TBD, name: C.str(r['设备名称']), content,
      owner: C.str(r['责任人']), due,
      originShift: C.str(r['班次']) || `${path.basename(p)} 上次交接`,
      originDue: due, originHandoverAt: null,
      prevShift: `${path.basename(p)} 上次交接`,
      carryTimes: 0,
    });
  }
  return out;
}

// ---------------------------------------------------------------- 主流程
function main() {
  const a = C.parseArgs(process.argv.slice(2), VALUE_OPTS, FLAG_OPTS);
  if (!a.input) throw new Error('缺少 --input');
  if (!a.workshop) throw new Error('缺少 --workshop');
  if (!a.type) throw new Error('缺少 --type（交接类型：值班交接 / 休假交接 / 调岗交接）。本技能不处理操作班组交接班');
  if (!TYPES.includes(a.type)) throw new Error(`--type「${a.type}」无效，应为 ${TYPES.join(' / ')}（操作班组的交接班不在本技能范围）`);
  if (!a.time) throw new Error('缺少 --time');
  if (!a.by) throw new Error('缺少 --by');

  // 交接时间必须明确到时点：ISO 8601 带时区强校验
  const ISO = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;
  if (!ISO.test(String(a.time).trim())) {
    throw new Error(`--time 「${a.time}」不是带时区的 ISO 8601 时点，应形如 2026-09-21T08:00:00+08:00（交接时间必须明确到时点）`);
  }
  const tms = Date.parse(String(a.time).trim().replace(' ', 'T'));
  if (!Number.isFinite(tms)) throw new Error(`--time 「${a.time}」无法解析为有效时刻`);
  const handoverAt = C.localDateTime(new Date(tms));   // 北京时间显示
  const handoverIso = String(a.time).trim();

  const inputs = a.input.split(',').map((s) => s.trim()).filter(Boolean);
  for (const p of inputs) if (!fs.existsSync(p)) throw new Error(`输入不存在: ${p}`);
  const outDir = a.out || path.join(os.tmpdir(), 'shr-out');
  WS.workshop = a.workshop;

  // ---- 本次记录
  const { items, sources } = readCurrent(inputs);

  // ---- 在修设备：优先独立文件，其次本次记录文件中的「在修设备」表
  let inRepair = null;
  if (a.inrepair) {
    if (!fs.existsSync(a.inrepair)) throw new Error(`在修设备清单不存在: ${a.inrepair}`);
    let b;
    try { b = loadBook(a.inrepair); } catch (e) { throw new Error(`在修设备清单读取失败: ${e.message}`); }
    inRepair = readInRepair(b, path.basename(a.inrepair));
    if (inRepair === null) warnings.push(`在修设备清单「${path.basename(a.inrepair)}」中未找到「在修设备」工作表`);
  } else {
    for (const p of inputs) {
      let b; try { b = loadBook(p); } catch (e) { continue; }
      const l = readInRepair(b, path.basename(p));
      if (l) { inRepair = (inRepair || []).concat(l); }
    }
  }
  // 本次记录中事项类型为「在修」的，补入在修设备清单
  for (const it of items) {
    if (it.type !== 'inRepair') continue;
    inRepair = inRepair || [];
    if (inRepair.some((x) => x.tag === it.tag)) continue;
    const state = it.handling || it.content;
    if (!state) warnings.push(`${it.sheet} 第${it.row}行 在修设备「${it.tag}」无状态说明，交接时需当面确认`);
    inRepair.push({
      tag: it.tag, name: it.name, state: state || null, order: '', owner: it.owner,
      eta: it.due, stateMissing: !state, sheet: it.sheet, row: it.row,
    });
  }
  if (inRepair === null) warnings.push('未提供在修设备清单（--inrepair），且本次记录中无在修事项，在修设备一节按「无」交接');

  // ---- 分类
  const statusChanges = items.filter((x) => x.type === 'statusChange').map((x) => ({
    tag: x.tag, name: x.name || null, content: x.content, handling: x.handling || null,
    time: x.time, by: x.owner || null, sheet: x.sheet, row: x.row,
  }));
  const abnormalHandled = items.filter((x) => x.type === 'abnormal').map((x) => ({
    tag: x.tag, name: x.name || null, content: x.content,
    handling: x.handling || null, done: x.done, rawStatus: x.rawStatus || null,
    owner: x.owner || null, due: x.due, time: x.time, sheet: x.sheet, row: x.row,
  }));
  // 事项类型无法归类：单列，绝不默认塞进某一类
  const undetermined = items.filter((x) => x.type === null).map((x) => ({
    tag: x.tag, name: x.name || null, content: x.content, rawType: x.rawType || null,
    reason: x.rawType ? `事项类型「${x.rawType}」无法归类为状态变化/异常处理/在修` : '事项类型为空',
    sheet: x.sheet, row: x.row,
  }));
  // 完成状态无法判定：单列
  const statusUndetermined = items.filter((x) => x.done === null).map((x) => ({
    tag: x.tag, name: x.name || null, content: x.content, rawStatus: x.rawStatus || null,
    reason: x.sap === '已取消' ? `状态「${x.rawStatus}」为已取消/删除标记，需交接双方确认是否仍需跟进`
      : x.rawStatus ? `状态「${x.rawStatus}」无法判定为已完成/未完成` : '状态为空',
    sheet: x.sheet, row: x.row,
  }));

  const thisShift = [a.workshop, a.type, a.shift || ''].filter(Boolean).join(' ');

  // ---- 本次未完成事项（done !== 'done' 一律进入 pending：未判定的也交接，就严）
  const pending = [];
  for (const x of items) {
    if (x.done === 'done') continue;
    if (x.type === 'inRepair' && x.done === null) {
      // 在修设备本身在「在修设备」一节交接，但若标了未完成也要进 pending
    }
    pending.push({
      tag: x.tag, name: x.name || null, content: x.content,
      // SAP 状态码 / 待验收类状态写明归一后的状态，如「未完成（待验收）」，便于接手人识别 TECO 仍需验收
      state: x.done === 'open' ? (x.sap ? `未完成（${x.sap}）` : '未完成') : (x.rawStatus || TBD),
      stateDetermined: x.done !== null,
      handling: x.handling || null,
      owner: x.owner || TBD, ownerMissing: !x.owner,
      due: x.due, dueText: x.due || TBD, dueMissing: !x.due,
      source: thisShift, originShift: thisShift,
      originDue: x.due, originHandoverAt: handoverIso,
      carried: false, carryTimes: 0,
      sheet: x.sheet, row: x.row,
    });
  }

  // ---- 上次交接遗留事项核对与结转（本技能的灵魂）
  let carriedOver = null, prevClosed = null;
  if (a.prev) {
    const prevItems = readPrev(a.prev);
    carriedOver = []; prevClosed = [];
    for (const p of prevItems) {
      // 匹配：位号相同（或任一方为待明确时放宽）且内容相似度达阈值
      let best = null, bestSim = 0, bestThr = 1;
      for (const cur of items) {
        const tagEq = p.tag !== TBD && cur.tag !== TBD && p.tag === cur.tag;
        const tagLoose = p.tag === TBD || cur.tag === TBD;
        if (!tagEq && !tagLoose) continue;
        const thr = tagEq ? SIM_TAG_EQ : SIM_TAG_LOOSE;
        const s = Math.max(
          similarity(p.content, [cur.content, cur.handling].filter(Boolean).join(' ')),
          similarity(p.content, cur.content),
        );
        // 达阈值的优先于不达阈值的；同为达阈值时取相似度更高者
        const better = (s >= thr && bestSim < bestThr) || (s >= thr === bestSim >= bestThr && s > bestSim);
        if (best === null || better) { bestSim = s; best = cur; bestThr = thr; }
      }
      if (best && bestSim >= bestThr) {
        // 本次有对应记录：闭环与否按本次记录的状态走
        prevClosed.push({
          tag: p.tag, name: p.name || best.name || null, content: p.content,
          matchedRow: `${best.sheet} 第${best.row}行`, similarity: C.round(bestSim, 2),
          matchedContent: best.content, handling: best.handling || null,
          done: best.done, closed: best.done === 'done',
          originShift: p.originShift, originDue: p.originDue,
        });
        if (best.done !== 'done') {
          // 本次有记录但仍未闭环：pending 中把该条标回原始来源交接，保留原始期限
          const t = pending.find((q) => q.sheet === best.sheet && q.row === best.row);
          if (t) {
            t.source = p.originShift;
            t.originShift = p.originShift;
            t.originDue = p.originDue;
            t.originHandoverAt = p.originHandoverAt;
            t.carried = true;
            t.carryTimes = (p.carryTimes || 0) + 1;
            t.note = '上次交接遗留，本次已跟进但未闭环';
            if (!t.due && p.originDue) { t.due = p.originDue; t.dueText = p.originDue; t.dueMissing = false; }
          }
          warnings.push(`上次交接遗留事项「${p.tag} ${p.content}」本次有处理记录但未闭环，已按原始来源「${p.originShift}」结转`);
        }
        continue;
      }
      // 本次找不到对应处理记录 —— 原样结转，绝不静默丢弃、绝不自动延期
      const item = {
        tag: p.tag, name: p.name || null, content: p.content,
        state: '上次交接遗留，本次未处理', stateDetermined: true,
        handling: null,
        owner: p.owner || TBD, ownerMissing: !p.owner,
        due: p.originDue, dueText: p.originDue || TBD, dueMissing: !p.originDue,
        source: p.originShift, originShift: p.originShift,
        originDue: p.originDue, originHandoverAt: p.originHandoverAt,
        carried: true, carryTimes: (p.carryTimes || 0) + 1,
        note: '上次交接遗留，本次未处理',
        sheet: null, row: null,
      };
      carriedOver.push(item);
      pending.push(item);
      warnings.push(`上次交接遗留事项「${p.tag} ${p.content}」在本次记录中未见处理，已原样结转并标注「上次交接遗留，本次未处理」`);
    }
  } else {
    warnings.push('未提供上次交接记录（--prev），无法核对上次交接遗留事项是否闭环');
  }

  // 结转项里，本次有跟进但未闭环的也应在 carriedOver 中体现（保留原始来源与期限）
  if (carriedOver !== null) {
    for (const t of pending) {
      if (t.carried && !carriedOver.includes(t)) carriedOver.push(t);
    }
  }

  // ---- 需重点关注事项：结转项 + 已超期 + 在修无状态说明 + 状态未判定
  const focusItems = [];
  for (const t of pending) {
    if (t.carried) focusItems.push({ tag: t.tag, content: t.content, reason: `${t.note || '上次交接结转'}（原始来源 ${t.originShift}，原始要求完成时间 ${t.originDue || TBD}）`, owner: t.owner });
  }
  for (const t of pending) {
    if (t.carried || !t.due) continue;
    // 要求完成时间是北京时间墙钟（YYYY-MM-DD HH:mm），统一按 +08:00 解析，与主机时区无关
    if (bjMs(t.due) < tms) {
      focusItems.push({ tag: t.tag, content: t.content, reason: `要求完成时间 ${t.due} 已超过交接时点`, owner: t.owner });
    }
  }
  for (const r of (inRepair || [])) {
    if (r.stateMissing) focusItems.push({ tag: r.tag, content: r.name || '在修设备', reason: '在修设备无当前状态说明，需当面确认', owner: r.owner || TBD });
  }
  for (const u of statusUndetermined) {
    focusItems.push({ tag: u.tag, content: u.content, reason: `完成状态未判定：${u.reason}`, owner: TBD });
  }

  const counts = {
    records: items.length,
    statusChanges: statusChanges.length,
    abnormalHandled: abnormalHandled.length,
    abnormalClosed: abnormalHandled.filter((x) => x.done === 'done').length,
    inRepair: inRepair === null ? null : inRepair.length,
    pending: pending.length,
    carriedOver: carriedOver === null ? null : carriedOver.length,
    focusItems: focusItems.length,
    undetermined: undetermined.length,
    statusUndetermined: statusUndetermined.length,
    prevChecked: prevClosed === null ? null : prevClosed.length,
    prevClosedOk: prevClosed === null ? null : prevClosed.filter((x) => x.closed).length,
  };

  // ---- 产出
  C.ensureDir(outDir);
  const DECL = '交接以双方现场确认签字为准，本记录为辅助整理';
  const handover = {
    meta: {
      skill: 'shift-handover-record', workshop: a.workshop, type: a.type, shift: a.shift || a.type,
      handoverAt, handoverIso, by: a.by, to: a.to || null,
      sources, prevProvided: !!a.prev, generatedAt: C.localDateTime(),
      declaration: DECL, verified: true, workshopScope: WS.scopes,
    },
    counts, statusChanges, abnormalHandled, inRepair,
    pending, carriedOver, prevClosed, focusItems,
    undetermined, statusUndetermined, warnings,
  };
  fs.writeFileSync(path.join(outDir, 'handover.json'), JSON.stringify(handover, null, 2), 'utf8');

  const L = [];
  L.push(`# ${a.workshop} 设备员${a.type}记录${a.shift ? `（${a.shift}）` : ''}`);
  L.push('');
  const wsNote = C.workshopScopeNote(WS.scopes, a.workshop);
  if (wsNote.alert) { L.push(`> **${wsNote.alert}**`); L.push(''); }
  L.push(`> ${DECL}。本记录为车间设备员的工作交接（${a.type}），不是操作班组交接班。`);
  L.push('');
  L.push('## 一、交接信息');
  L.push('');
  L.push(C.mdTable(['项目', '内容'], [
    ['车间', a.workshop], ['交接类型', a.type], ['值次 / 说明', a.shift || '—'],
    ['交接时间', `${handoverAt}（北京时间，原始入参 ${handoverIso}）`],
    ['交接人', a.by], ['接手人', a.to || TBD],
    ['数据来源', sources.join('、') || '—'],
    ...(wsNote.note ? [['车间范围', wsNote.note.replace(/^车间范围：/, '')]] : []),
    ['生成时间', `${C.localDateTime()}（北京时间）`],
  ]));
  L.push('## 二、设备状态变化');
  L.push('');
  L.push(C.mdTable(['位号', '设备名称', '状态变化内容', '处理情况', '时间', '经办人'],
    statusChanges.map((x) => [x.tag, x.name || '—', x.content || '—', x.handling || '—', x.time || '—', x.by || '—'])));
  L.push('## 三、异常与处理');
  L.push('');
  L.push(C.mdTable(['位号', '设备名称', '异常内容', '处理情况', '是否闭环', '责任人', '要求完成时间'],
    abnormalHandled.map((x) => [x.tag, x.name || '—', x.content || '—', x.handling || '—',
      x.done === 'done' ? '已闭环' : x.done === 'open' ? '未闭环' : `未判定（原值：${x.rawStatus || '空'}）`,
      x.owner || TBD, x.due || TBD])));
  L.push('## 四、在修设备状态');
  L.push('');
  if (inRepair === null) L.push('_未提供在修设备数据，本次无在修设备需交接。_\n');
  else L.push(C.mdTable(['位号', '设备名称', '当前状态', '工单号', '责任人', '预计完工'],
    inRepair.map((x) => [x.tag, x.name || '—', x.state || `${TBD}（无状态说明，需当面确认）`, x.order || '—', x.owner || TBD, x.eta || TBD])));
  L.push('## 五、未完成事项（逐条交接，不得省略）');
  L.push('');
  L.push(C.mdTable(['序号', '位号', '事项内容', '当前状态', '责任人', '要求完成时间', '来源交接'],
    pending.map((x, i) => [i + 1, x.tag, x.content || TBD, x.state, x.owner, x.dueText, x.source])));
  if (carriedOver !== null) {
    L.push('### 其中：上次交接结转项');
    L.push('');
    if (!carriedOver.length) L.push('_上次交接的未完成事项，本次均已见闭环记录。_\n');
    else {
      L.push(C.mdTable(['位号', '事项内容', '结转说明', '原始来源交接', '原始要求完成时间', '累计结转次数', '责任人'],
        carriedOver.map((x) => [x.tag, x.content || TBD, x.note || '上次交接遗留，本次未处理', x.originShift, x.originDue || TBD, x.carryTimes, x.owner])));
      L.push('> 【注意】结转项保留原始来源交接与原始要求完成时间，未作延期处理；是否调整期限由交接双方现场确认。');
      L.push('');
    }
  } else {
    L.push('### 其中：上次交接结转项');
    L.push('');
    L.push('_未提供上次交接记录（--prev），本次无法核对上次交接遗留事项，接手人需人工核对上次交接记录。_\n');
  }
  L.push('## 六、需重点关注事项');
  L.push('');
  L.push(C.mdTable(['位号', '事项', '关注原因', '责任人'],
    focusItems.map((x) => [x.tag, x.content || '—', x.reason, x.owner || TBD])));
  if (undetermined.length || statusUndetermined.length) {
    L.push('## 七、未判定事项（需交接双方明确）');
    L.push('');
    if (undetermined.length) {
      L.push('**事项类型未判定**');
      L.push('');
      L.push(C.mdTable(['位号', '事项内容', '原因', '出处'],
        undetermined.map((x) => [x.tag, x.content || TBD, x.reason, `${x.sheet} 第${x.row}行`])));
    }
    if (statusUndetermined.length) {
      L.push('**完成状态未判定**');
      L.push('');
      L.push(C.mdTable(['位号', '事项内容', '原因', '出处'],
        statusUndetermined.map((x) => [x.tag, x.content || TBD, x.reason, `${x.sheet} 第${x.row}行`])));
    }
    L.push('> 以上事项既未按已完成处理，也未按未完成处理，一律随本次交接，由交接双方现场明确。');
    L.push('');
  }
  L.push('## 八、交接说明');
  L.push('');
  L.push('<!-- ANALYSIS_START -->');
  L.push('（由模型依据 references/handover-rules.md 口径撰写 150~300 字，结构：本次交接期间设备总体情况 → 异常与处理要点 → 未完成事项与结转项交代 → 接手人需重点关注。数字一律引用 handover.json 的 counts，不得省略任何一条未完成事项。）');
  L.push('<!-- ANALYSIS_END -->');
  L.push('');
  L.push('## 九、交接签字');
  L.push('');
  L.push(C.mdTable(['角色', '姓名', '签字', '时间'], [
    ['交接人', a.by, '', handoverAt],
    ['接手人', a.to || TBD, '', handoverAt],
  ]));
  L.push(`**${DECL}。**`);
  L.push('');
  if (warnings.length) {
    L.push('## 附：数据提示');
    L.push('');
    for (const w of warnings) L.push(`- ${w}`);
    L.push('');
  }
  fs.writeFileSync(path.join(outDir, 'handover.md'), L.join('\n'), 'utf8');

  C.emitOk(outDir, { ok: true, out: outDir, workshop: a.workshop, type: a.type, shift: a.shift || null, handoverAt, handoverIso, counts, warnings });
}

try { main(); } catch (e) { C.fail(e, warnings); }
