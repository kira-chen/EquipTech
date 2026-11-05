#!/usr/bin/env node
'use strict';
/**
 * 检修需求汇总上报脚本（中石化体系炼化厂车间设备员口径，仅 Node.js 内置模块）
 * 用法：node "<技能目录>/scripts/rollup.js" --input <xlsx[,xlsx2]> --workshop "常减压车间" --period 2026-10 [--out <dir>]
 *       [--template <上报模板xlsx>] [--spare <备件库存xlsx>] [--window "<停机窗口说明>"] [--include-cyclic] [--due <YYYY-MM-DD>]
 * 产出：<out>/demands.json、需求汇总.md、检修需求表.xlsx、summary.json；末行打印 JSON 摘要
 *
 * 硬口径：
 *  - 四类来源（未闭环缺陷/通知单 / 未闭环工单 / 周期性检修项 / 隐患整改项）合并为逐条需求，不跨来源自动合并
 *  - 同一设备多条相近需求 → possibleDuplicate 待用户确认，绝不自动合并、绝不自动剔除
 *  - 未提供 --spare → 备件是否到位一律写「未核实」，绝不默认「有库存」；需求数量未填 → 到位情况未判定
 *  - 无依据（缺陷编号/通知单号/工单号/周期项编号/隐患编号全缺）的项不进正式清单，只进 noBasis「建议核实区」
 *  - 工单无等级、周期项无等级 → 优先级 undetermined（不按高/中默认）；状态无法判断是否闭环 → undetermined（不按未闭环纳入）
 *  - 产出列头按「月度检修计划申报表」常见口径；申报对象为公司设备管理部门（机动部/设备部）
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readXlsx, readCsvDir, writeXlsx } = require('./lib/xlsx-lite');
const C = require('./lib/common');

const warnings = [];
const num = C.makeNum(warnings);
/**
 * 预计工期 → 天。SAP/设备资产管理系统的工期常以小时记（「72小时」），申报表「工期(天)」按天：
 * 带小时后缀的按 24 小时折天（保留 2 位），带天/日后缀或纯数字按天；其余交给 num（剥离单位并 warning）。
 */
const hoursNoted = new Set();
/**
 * 表头本身带小时单位（如「预计工期(h)」「工期（小时）」）时，纯数字按小时折天。
 * 仿 toRecords 的取列顺序：先找与别名全等的列（全等列不带单位，按天），再按别名顺序找前缀命中的列，看去掉别名后的剩余部分是否含 h/小时。
 * 返回实际列名（按小时计）或 null（按天）。
 */
const DURATION_ALIASES = ['预计工期', '工期', '预计时间', '作业工期', '预计天数', '工期(天)'];
function durationHourHeader(rows) {
  for (let i = 0; i < Math.min(10, (rows || []).length); i++) {
    const hdr = (rows[i] || []).map((c) => C.str(c).replace(/\s+/g, ''));
    if (DURATION_ALIASES.some((al) => hdr.includes(al))) return null;
    for (const al of DURATION_ALIASES) {
      const col = hdr.find((x) => x && x.startsWith(al));
      if (col) return /h|小时/i.test(col.slice(al.length)) ? col : null;
    }
  }
  return null;
}
function durationDays(v, ctx, hourHeader) {
  const s = C.str(v).replace(/\s/g, '');
  if (hourHeader && /^\d+(?:\.\d+)?$/.test(s)) {
    if (ctx && !hoursNoted.has(ctx.sheet)) {
      hoursNoted.add(ctx.sheet);
      warnings.push(`工作表「${ctx.sheet}」列「${hourHeader}」表头以小时计（如「${s}」），已按 24 小时折算为天`);
    }
    return C.round(Number(s) / 24, 2);
  }
  const h = s.match(/^(\d+(?:\.\d+)?)(小时|个小时|h|hr|hrs)$/i);
  if (h) {
    if (ctx && !hoursNoted.has(ctx.sheet)) {
      hoursNoted.add(ctx.sheet);
      warnings.push(`工作表「${ctx.sheet}」列「预计工期」以小时计（如「${s}」），已按 24 小时折算为天`);
    }
    return C.round(Number(h[1]) / 24, 2);
  }
  const d = s.match(/^(\d+(?:\.\d+)?)(天|日|d)$/i);
  if (d) return Number(d[1]);
  return num(v, ctx);
}
const VALUE_OPTS = ['input', 'workshop', 'period', 'out', 'template', 'spare', 'window', 'due'];
const FLAG_OPTS = ['include-cyclic', 'help'];

const DECL = '本清单为车间申报稿，最终计划以公司设备管理部门（机动部/设备部）批复为准';
const DISCLAIMER = '本材料由脚本汇总、模型成文，仅供设备员复核参考，不替代审批、定性、验收与签字；厂内制度与系统数据为准。';

/**
 * 别名：局部优先，再并入共享 SYSTEM_ALIASES（SAP PM 通知单/订单/技术对象、SAP MM 库存列名）。
 * 局部不把「设备编号」当位号、不把「设备」当设备名称（SAP「设备」列是 8 位设备编号）。
 * 注意声明顺序：「缺陷描述/工单内容/隐患描述」要排在「设备名称」之前，避免共享表里「设备名称」的别名「描述」抢走描述列。
 */
const ALIASES = C.mergeAliases({
  '位号': ['位号', '设备位号', 'TAG', 'tag'],
  '设备名称': ['设备名称', '名称'],
  '缺陷编号': ['缺陷编号', '编号', '缺陷号', '缺陷单号', '缺陷登记号', '通知单号', '通知单', '维修通知单号', '通知单编号'],
  '缺陷描述': ['缺陷描述', '描述', '现象', '问题描述', '缺陷现象', '异常描述', '通知单短文本', '短文本'],
  '等级': ['等级', '缺陷等级', '级别', '缺陷级别', '优先级', '紧急程度', '紧急度'],
  '状态': ['状态', '处理状态', '当前状态', '闭环状态'],
  '发现时间': ['发现时间', '时间', '发现日期', '记录时间', '登记时间', '通知日期', '创建日期'],
  '工单号': ['工单号', '工单编号', '单号', '派工单号'],
  '工单内容': ['工单内容', '工作内容', '检修内容', '作业内容', '内容', '订单描述', '订单短文本'],
  '工单类型': ['工单类型', '订单类型', '维修类型', '工单类别'],
  // 工单表里的「通知单号」：SAP 订单由通知单转出，用于把已转工单的通知单与工单配对（不用裸「通知单」，免得前缀抢到「通知单类型」）
  '关联通知单号': ['通知单号', '维修通知单号', '通知单编号'],
  '计划完成': ['计划完成', '计划完成时间', '要求完成', '计划完工', '计划日期', '基本结束日期', '计划结束日期', '要求结束'],
  '周期项编号': ['周期项编号', '项目编号', '计划编号', '周期编号', '维护计划', '维护计划编号', '维护项目'],
  '项目名称': ['项目名称', '检修项目', '项目', '检修项'],
  '检修周期': ['检修周期', '周期', '保养周期', '检修间隔', '维护周期'],
  '上次检修': ['上次检修', '上次检修日期', '上次保养', '最近检修', '上次执行'],
  '隐患编号': ['隐患编号', '隐患号', '隐患台账编号', '隐患登记号'],
  '隐患描述': ['隐患描述', '隐患内容', '隐患情况', '问题描述'],
  '隐患等级': ['隐患等级', '隐患级别', '等级', '级别'],
  '整改措施': ['整改措施', '整改方案', '治理措施', '措施'],
  '整改期限': ['整改期限', '整改时限', '完成期限', '期限', '计划完成日期'],
  '责任人': ['责任人', '整改责任人', '负责人'],
  '是否需停机': ['是否需停机', '需停机', '停机要求', '是否停车', '停车要求', '是否停工', '停工要求'],
  '预计工期': ['预计工期', '工期', '预计时间', '作业工期', '预计天数', '工期(天)'],
  '备件需求': ['备件需求', '备件', '所需备件', '材料需求', '备件名称', '主要备件材料', '物料描述', '备件材料'],
  '备件型号': ['备件型号', '型号', '规格型号', '规格', '物料编码', '物料', '物料号'],
  '需求数量': ['需求数量', '数量', '需用量', '申请数量', '需求数'],
  '专业': ['专业', '所属专业', '类别', '责任专业', '专业类别'],
  '库存数量': ['库存数量', '库存', '现有库存', '结存数量', '可用库存', '非限制使用库存', '非限制库存', '现有量'],
  '备件名称': ['备件名称', '名称', '物料名称', '备件', '物料描述'],
});
// 车间范围核对（D007）：「车间」只认车间 / 所属车间 / 属地车间 / 运行部（或其后加「名称」），
// 不让共享别名里的维护工厂 / 属地单位 / 使用单位占用该字段
ALIASES['车间'] = [...C.WORKSHOP_COLS, ...C.WORKSHOP_COLS.map((c) => c + '名称')];

// -------------------------------------------------------------- 闭环判定（SAP 六态优先，车间台账写法兜底）
const CLOSED = ['已闭环', '已完成', '已关闭', '关闭', '闭环', '已消缺', '已验收', '已结束', '完工', '已整改', '已销号', '销号'];
const OPEN = ['未闭环', '处理中', '待处理', '未处理', '进行中', '已派工', '待检修', '挂账', '未完成', '新建', '整改中', '未整改', '待整改'];
/**
 * 返回 'closed' / 'done'（已完工待验收，不重复申报） / 'open' / null（状态为空或无法归类 → undetermined，不按未闭环纳入）
 */
function rollupState(v) {
  const s = C.str(v);
  if (s === '') return null;
  const sap = C.normSapStatus(s);
  if (sap === '已闭环' || sap === '已取消') return 'closed';
  if (sap === '待验收') return 'done';
  if (sap) return 'open';
  if (CLOSED.some((k) => s.includes(k))) return 'closed';
  if (OPEN.some((k) => s.includes(k))) return 'open';
  return null;
}

// -------------------------------------------------------------- 是/否解析
const YES = ['是', '需', '要', '有', 'Y', 'y', 'yes', 'YES', 'true', '1'];
const NO = ['否', '不', '无', '不需', 'N', 'n', 'no', 'NO', 'false', '0'];
/** true / false / null（未填或无法归类，绝不默认） */
function parseYN(v) {
  const s = C.str(v);
  if (s === '') return null;
  if (NO.some((k) => s.startsWith(k))) return false;
  if (YES.some((k) => s.startsWith(k))) return true;
  return null;
}

// -------------------------------------------------------------- 优先级（申报缓急：1 紧急 / 2 高 / 3 中 / 4 低）
/** 缺陷等级 A/B/C（主口径）或旧 I~IV → 1~4；取不到返回 null（不默认） */
function levelPrio(v) {
  const s = C.str(v).toUpperCase().replace(/\s/g, '');
  if (s === '') return null;
  if (/未判定|UNDETERMINED/.test(s)) return null;
  if (/^[1-4]$/.test(s)) return Number(s);          // SAP 优先级 1 非常高 / 2 高 / 3 中 / 4 低
  if (/^A(级|\(|（|$)|^A级/.test(s) || /重大/.test(s)) return 1;
  if (/^B(级|\(|（|$)|^B级/.test(s)) return 2;
  if (/^C(级|\(|（|$)|^C级/.test(s)) return 3;
  for (const [k, p] of [['IV', 4], ['Ⅳ', 4], ['III', 3], ['Ⅲ', 3], ['II', 2], ['Ⅱ', 2], ['I', 1], ['Ⅰ', 1]]) if (s.includes(k)) return p;
  if (/紧急|特急|非常高/.test(s)) return 1;
  if (/严重|^高/.test(s)) return 2;
  if (/一般|^中/.test(s)) return 3;
  if (/轻微|^低/.test(s)) return 4;
  return null;
}
/** 隐患等级：重大隐患→1、一般隐患→3；「A/B/C 级隐患」多为管理层级而非严重度，不直接映射 → null */
function hazardPrio(v) {
  const s = C.str(v).replace(/\s/g, '');
  if (s === '') return { prio: null, reason: '隐患等级为空' };
  if (/重大/.test(s)) return { prio: 1, reason: null };
  if (/一般/.test(s)) return { prio: 3, reason: null };
  if (/^[ABC]级?/i.test(s) || /公司级|厂级|车间级|分厂级/.test(s)) return { prio: null, reason: `隐患等级「${s}」为管理层级写法，不能直接映射为严重度` };
  return { prio: null, reason: `隐患等级「${s}」无法归入 重大/一般` };
}
const PRIO_CN = { 1: '紧急', 2: '高', 3: '中', 4: '低' };

// -------------------------------------------------------------- 检修类别（建议，按中石化分级：大检修 / 日常维修 / 抢修 / 专项）
function categoryOf(it) {
  if (it.sourceType === 'hazard') return '专项（隐患整改）';
  if (it.sourceType === 'cyclic') return '计划检修';
  if (it.sourceType === 'order') {
    const t = C.str(it.orderType).toUpperCase();
    if (/PM03|抢修|紧急/.test(t)) return '抢修';
    if (/PM02|计划|大检修|停工检修|定期|预防/.test(t)) return '计划检修';
    if (/专项|技改|技措/.test(t)) return '专项（技改技措）';
    return '日常维修';
  }
  return it.prio === 1 ? '抢修' : '日常维修';
}

// -------------------------------------------------------------- 专业归属
function disciplineOf(tag, name) {
  const t = C.str(tag).toUpperCase(), n = C.str(name);
  if (/^(EM|M)-/.test(t) || /电机|电动机|变频|配电|开关柜|电缆|变压器|电气/.test(n)) return '电气';
  if (/安全阀|疏水阀|爆破片|阻火器|呼吸阀/.test(n)) return '静设备';
  if (/^(I|FT|PT|TT|LT|TI|PI|FI|LI|FIC|PIC|TIC|LIC|AT)-/.test(t) || /仪表|变送器|调节阀|流量计|分析仪|报警|液位计|压力表|热电偶/.test(n)) return '仪表';
  if (/^(P|K|GB|J|B)-/.test(t) || /泵|压缩机|风机|机组|汽轮机|搅拌/.test(n)) return '动设备';
  if (/^(E|V|C|D|R|T|F)-/.test(t) || /换热器|冷却器|再沸器|空冷|罐|容器|塔|管道|管线|阀门|反应器|加热炉/.test(n)) return '静设备';
  return '待定';
}

// -------------------------------------------------------------- 查重相似度
/**
 * 相似度 = 0.7 × 文本 bigram Dice + 0.3 × 检修部位/现象关键词是否相同
 * 不用「来源类别是否相同」加分——最该提示的重复恰恰是「缺陷/通知单里挂一条、工单里又开一张」的跨来源重复。
 * 仅用于「疑似重复」提示，最终是否重复由用户确认，脚本不自动合并、不自动剔除。
 */
const KEYWORDS = [
  ['机封', '机械密封', '密封'], ['轴承'], ['联轴器', '对中'], ['法兰', '垫片'],
  ['管束', '抽芯', '清洗'], ['滤芯', '过滤器'], ['安全阀', '校验'], ['保温'],
  ['泄漏', '渗漏', '滴漏', '漏'], ['振动', '异响'], ['温高', '温度高', '过热'],
  ['腐蚀', '锈蚀'], ['裂纹', '变形'], ['解体', '检修'], ['变送器', '仪表', '示值'],
];
function kwSet(s) {
  const t = String(s);
  const out = new Set();
  KEYWORDS.forEach((grp, i) => { if (grp.some((k) => t.includes(k))) out.add(i); });
  return out;
}
function textSim(a, b) {
  const g = (s) => { const t = String(s).replace(/\s/g, ''); const o = new Set(); for (let i = 0; i < t.length - 1; i++) o.add(t.slice(i, i + 2)); return o; };
  const A = g(a), B = g(b);
  if (!A.size || !B.size) return 0;
  let inter = 0; for (const x of A) if (B.has(x)) inter++;
  return (2 * inter) / (A.size + B.size);
}
function kwSim(a, b) {
  const A = kwSet(a), B = kwSet(b);
  if (!A.size || !B.size) return 0;
  let inter = 0; for (const x of A) if (B.has(x)) inter++;
  return (2 * inter) / (A.size + B.size);
}
function similarity(x, y) {
  return 0.7 * textSim(x.desc, y.desc) + 0.3 * kwSim(x.desc, y.desc);
}
const DUP_THRESHOLD = 0.45;

function loadBook(p) { return fs.statSync(p).isDirectory() ? readCsvDir(p) : readXlsx(p); }

// -------------------------------------------------------------- 月度检修计划申报表列头（默认上报格式，厂内模板可用 --template 覆盖）
const STD_COLS = ['序号', '车间', '功能位置', '设备名称', '检修项目名称', '检修内容', '检修类别', '来源', '依据编号', '是否停工',
  '计划开始', '计划结束', '工期(天)', '主要备件材料', '备件到位情况', '建议专业', '优先级', '申报理由', '备注'];
/** 模板列名 → 标准列名 的可识别写法 */
const TPL_ALIAS = {
  '序号': ['序号', '编号', 'NO', 'No', '№'],
  '车间': ['车间', '运行部', '申报单位', '所属车间', '装置', '单位'],
  '功能位置': ['功能位置', '位号', '设备位号', '设备编号', 'TAG', '技术对象', '技术标识'],
  '设备名称': ['设备名称', '名称', '设备', '设备描述'],
  '检修项目名称': ['检修项目名称', '项目名称', '检修项目', '项目', '检修项'],
  '检修内容': ['检修内容', '需求描述', '描述', '工作内容', '需求内容', '主要内容', '检修内容及要求'],
  '检修类别': ['检修类别', '检修类型', '检修分类', '维修类别', '类别', '工单类型', '订单类型'],
  '来源': ['来源', '需求来源', '来源类型', '提出依据'],
  '依据编号': ['依据编号', '依据', '来源单号', '对应编号', '来源编号', '通知单号', '工单号', '缺陷编号', '隐患编号'],
  '是否停工': ['是否停工', '是否需停机', '需停机', '停机要求', '是否停车', '停车要求', '停工要求', '是否停机'],
  '计划开始': ['计划开始', '计划开工', '计划开始日期', '开始日期', '基本开始日期'],
  '计划结束': ['计划结束', '计划完工', '计划完成', '计划结束日期', '完成日期', '基本结束日期', '要求完成'],
  '工期(天)': ['工期(天)', '工期', '预计工期', '预计天数', '作业工期', '工期天数'],
  '主要备件材料': ['主要备件材料', '备件材料', '备件需求', '备件', '所需备件', '材料需求', '主要材料'],
  '备件到位情况': ['备件到位情况', '备件是否到位', '备件到位', '备件情况', '备件状态', '是否到位', '材料到位'],
  '建议专业': ['建议专业', '专业', '责任专业', '所属专业', '专业类别'],
  '优先级': ['优先级', '轻重缓急', '紧急程度', '缓急'],
  '申报理由': ['申报理由', '理由', '申报依据', '说明', '申报说明', '必要性'],
  '备注': ['备注', '其他', '其它', '说明备注'],
};
/**
 * 模板列名 → 标准列名；无法匹配返回 null。
 * 三轮匹配，先精确后前缀：「备件到位」若先走前缀匹配会被「主要备件材料」的别名「备件」抢走，
 * 「来源单号」同理会被「来源」抢走，所以必须让完全相等的别名优先命中。
 */
function matchTplCol(name) {
  const s = C.str(name).replace(/\s/g, '');
  if (!s) return null;
  const entries = Object.entries(TPL_ALIAS);
  for (const [std, list] of entries) if (list.some((al) => s === al)) return std;          // 1. 完全相等
  const flat = [];
  for (const [std, list] of entries) for (const al of list) if (al.length >= 2) flat.push([std, al]);
  flat.sort((x, y) => y[1].length - x[1].length);
  for (const [std, al] of flat) if (s.startsWith(al)) return std;                           // 2. 模板列名以别名开头（长别名优先）
  for (const [std, al] of flat) if (al.startsWith(s) && s.length >= 2) return std;         // 3. 别名以模板列名开头
  return null;
}

function main() {
  const a = C.parseArgs(process.argv.slice(2), VALUE_OPTS, FLAG_OPTS);
  if (!a.input) throw new Error('缺少 --input');
  if (!a.workshop) throw new Error('缺少 --workshop');
  if (!a.period) throw new Error('缺少 --period');
  if (!/^\d{4}-\d{2}$/.test(C.str(a.period))) throw new Error(`--period 「${a.period}」不是有效上报周期，应为 YYYY-MM`);
  const period = C.str(a.period);
  const pm = +period.slice(5, 7);
  if (pm < 1 || pm > 12) throw new Error(`--period 「${a.period}」月份非法，应为 01~12`);
  let due = null;
  if (a.due) {
    due = C.normDate(a.due);
    if (!due) throw new Error(`--due 「${a.due}」不是有效日期，应为 YYYY-MM-DD`);
  }
  // 申报周期起止（周期项按下次到期日筛选用；--due 是上报截止日，不参与筛选）
  const periodStart = C.normDate(`${period}-01`);
  const periodEnd = periodStart ? new Date(Date.UTC(+period.slice(0, 4), pm, 0)).toISOString().slice(0, 10) : null;

  const inputs = C.str(a.input).split(/[,，;；]/).map((s) => s.trim()).filter(Boolean);
  if (!inputs.length) throw new Error('--input 未给出任何有效路径');
  for (const p of inputs) if (!fs.existsSync(p)) throw new Error(`输入不存在: ${p}`);
  const outDir = a.out || path.join(os.tmpdir(), 'mdr-out');

  // ============ 一、四类来源读取 ============
  const raw = [];              // 全部候选需求（含无依据项）
  const statusUndetermined = [];   // 状态无法判断是否闭环 → 未判定，不纳入正式清单
  const foundSources = [];
  const includeCyclic = !!a['include-cyclic'];
  const cyclicOutOfPeriod = [];   // 下次到期日晚于申报周期末的周期项：不进申报清单，单列
  let cyclicPeriodWarned = false;
  let skippedDone = 0;
  const doneOrderNotif = new Map();   // 通知单号（去前导零）→ { orderNo, state: 已完工待验收 / 已闭环 }
  /** 通知单号配对键：SAP 导出常把 12 位通知单号补前导零（000010046656），去掉前导零再比 */
  const notifKey = (v) => C.str(v).replace(/^0+(?=\d)/, '');

  /** 状态门：返回 true 表示继续纳入；closed/done 跳过；null → 记入 statusUndetermined 并跳过 */
  function statusGate(r, base, sheet, basisNo, tag, descText, srcCn) {
    const st = rollupState(r['状态']);
    if (st === 'closed') return false;
    if (st === 'done') { skippedDone++; warnings.push(`工作表「${base}/${sheet}」第${r._row}行（${tag}）状态「${C.str(r['状态'])}」为已完工待验收，本期不重复申报`); return false; }
    if (st === null) {
      statusUndetermined.push({
        tag, name: C.str(r['设备名称']), source: srcCn, basisNo: basisNo || '', desc: descText || '（描述为空）',
        statusRaw: C.str(r['状态']) || '（空）', field: '状态', reason: C.str(r['状态']) ? '状态取值无法判断是否闭环' : '状态为空',
        from: `${base}/${sheet} 第${r._row}行`,
        note: '未按未闭环纳入，也未按已闭环剔除；请核实状态后重新汇总',
      });
      warnings.push(`工作表「${base}/${sheet}」第${r._row}行（${tag}）状态「${C.str(r['状态']) || '（空）'}」无法判断是否闭环，已列入未判定项，未按未闭环纳入`);
      return false;
    }
    return true;
  }

  /** 车间范围核对（D007）：四类来源表各自核对，带车间列时剔除其他车间的行 */
  const scopes = [];
  function scoped(recs, sheet) {
    const ws = C.workshopScope(recs, a.workshop, sheet, warnings);
    scopes.push(ws.scope);
    return ws.records;
  }

  /** 来源表有没有备件列：没有备件列（如 MCP 通知单/工单表）≠ 备件列为空，前者备件需求未知，不能判「无备件需求」 */
  function spareColOf(recs, sheet) {
    const has = recs.hasCol('备件需求') || recs.hasCol('备件型号');
    if (!has && recs.length) warnings.push(`工作表「${sheet}」无备件列（备件需求/备件型号），该表各项备件需求未知，备件到位写「未核实（来源表无备件列）」，请到 SAP 订单组件或 MRO 工单预留核实`);
    return has;
  }

  for (const p of inputs) {
    let book;
    try { book = loadBook(p); } catch (e) { throw new Error(`读取失败 ${p}: ${e.message}`); }
    const base = path.basename(p);

    // ---- 来源 1：缺陷台账 / SAP 通知单清单（未闭环缺陷）
    const defRows = C.pickSheet(book, '缺陷台账', '缺陷记录', '缺陷', '通知单');
    if (defRows) {
      foundSources.push(`${base}→未闭环缺陷`);
      const hourHdr = durationHourHeader(defRows);
      const recs = scoped(C.toRecords(defRows, ['位号'], `${base}/缺陷台账`,
        ['缺陷编号', '缺陷描述', '设备名称', '等级', '状态', '发现时间', '是否需停机', '预计工期', '备件需求', '备件型号', '需求数量', '专业', '车间'],
        warnings, ALIASES), `${base}/缺陷台账`);
      const spareCol = spareColOf(recs, `${base}/缺陷台账`);
      for (const r of recs) {
        const tag = C.str(r['位号']);
        if (!tag) { warnings.push(`工作表「${base}/缺陷台账」第${r._row}行 位号为空，已跳过`); continue; }
        if (!statusGate(r, base, '缺陷台账', C.str(r['缺陷编号']), tag, C.str(r['缺陷描述']), '未闭环缺陷')) continue;
        const prio = levelPrio(r['等级']);
        raw.push({
          sourceType: 'defect', sourceCn: '未闭环缺陷',
          basisNo: C.str(r['缺陷编号']), tag, name: C.str(r['设备名称']),
          project: C.str(r['缺陷描述']) ? `${C.str(r['缺陷描述']).split(/[，,。；;]/)[0].slice(0, 16)}消缺` : '',
          desc: C.str(r['缺陷描述']),
          level: C.str(r['等级']), status: C.str(r['状态']),
          since: C.normDate(r['发现时间']),
          needShutdown: parseYN(r['是否需停机']),
          durationDays: durationDays(r['预计工期'], { sheet: `${base}/缺陷台账`, row: r._row, col: '预计工期' }, hourHdr),
          spareName: C.str(r['备件需求']), spareModel: C.str(r['备件型号']),
          spareQty: num(r['需求数量'], { sheet: `${base}/缺陷台账`, row: r._row, col: '需求数量' }), spareNoCol: !spareCol,
          discipline: C.str(r['专业']), prio,
          prioReason: prio === null ? (C.str(r['等级']) ? `缺陷等级「${C.str(r['等级'])}」无法识别` : '缺陷等级为空') : null,
          sheet: `${base}/缺陷台账`, row: r._row,
        });
      }
    }

    // ---- 来源 2：工单台账 / SAP 订单清单（未闭环工单）
    const ordRows = C.pickSheet(book, '工单台账', '工单记录', '工单', '订单');
    if (ordRows) {
      foundSources.push(`${base}→未闭环工单`);
      const hourHdr = durationHourHeader(ordRows);
      const recs = scoped(C.toRecords(ordRows, ['位号'], `${base}/工单台账`,
        ['工单号', '工单内容', '设备名称', '工单类型', '状态', '计划完成', '是否需停机', '预计工期', '备件需求', '备件型号', '需求数量', '专业', '等级', '关联通知单号', '车间'],
        warnings, ALIASES), `${base}/工单台账`);
      const spareCol = spareColOf(recs, `${base}/工单台账`);
      for (const r of recs) {
        const tag = C.str(r['位号']);
        if (!tag) { warnings.push(`工作表「${base}/工单台账」第${r._row}行 位号为空，已跳过`); continue; }
        const notifNo = C.str(r['关联通知单号']);
        // 已完工待验收或已闭环（CLSD 等）的工单：其通知单也不再按未闭环缺陷重复申报。
        // 已取消/删除标记（DLFL、作废）的工单活没干，不算闭环，通知单照常按未闭环缺陷申报
        const ost = rollupState(r['状态']);
        const cancelled = C.normSapStatus(C.str(r['状态'])) === '已取消';
        if (notifNo && !cancelled && (ost === 'done' || ost === 'closed')) doneOrderNotif.set(notifKey(notifNo), { orderNo: C.str(r['工单号']), state: ost === 'done' ? '已完工待验收' : '已闭环' });
        if (!statusGate(r, base, '工单台账', C.str(r['工单号']), tag, C.str(r['工单内容']), '未闭环工单')) continue;
        const plan = C.normDate(r['计划完成']);
        if (r['计划完成'] && !plan) warnings.push(`工作表「${base}/工单台账」第${r._row}行 计划完成「${C.str(r['计划完成'])}」无法解析`);
        const prio = levelPrio(r['等级']);
        raw.push({
          sourceType: 'order', sourceCn: '未闭环工单',
          basisNo: C.str(r['工单号']), tag, name: C.str(r['设备名称']),
          project: C.str(r['工单内容']).slice(0, 24),
          desc: C.str(r['工单内容']), orderType: C.str(r['工单类型']),
          level: C.str(r['等级']), status: C.str(r['状态']),
          since: plan,
          needShutdown: parseYN(r['是否需停机']),
          durationDays: durationDays(r['预计工期'], { sheet: `${base}/工单台账`, row: r._row, col: '预计工期' }, hourHdr),
          spareName: C.str(r['备件需求']), spareModel: C.str(r['备件型号']),
          spareQty: num(r['需求数量'], { sheet: `${base}/工单台账`, row: r._row, col: '需求数量' }), spareNoCol: !spareCol,
          discipline: C.str(r['专业']), prio,
          prioReason: prio === null ? (C.str(r['等级']) ? `等级「${C.str(r['等级'])}」无法识别` : '工单无等级/优先级，未按「高」默认') : null,
          planDate: plan, notifNo,
          sheet: `${base}/工单台账`, row: r._row,
        });
      }
    }

    // ---- 来源 3：周期性检修项（仅 --include-cyclic）
    const cycRows = C.pickSheet(book, '周期检修项', '周期检修', '预防检修', '保养计划', '维护计划');
    if (cycRows) {
      if (!includeCyclic) {
        warnings.push(`文件「${base}」中存在「周期检修项」工作表，但未加 --include-cyclic，本次未纳入周期性检修项`);
      } else {
        foundSources.push(`${base}→周期性检修项`);
        const hourHdr = durationHourHeader(cycRows);
        const recs = scoped(C.toRecords(cycRows, ['位号'], `${base}/周期检修项`,
          ['周期项编号', '项目名称', '设备名称', '检修周期', '上次检修', '是否需停机', '预计工期', '备件需求', '备件型号', '需求数量', '专业', '车间'],
          warnings, ALIASES), `${base}/周期检修项`);
        const spareCol = spareColOf(recs, `${base}/周期检修项`);
        for (const r of recs) {
          const tag = C.str(r['位号']);
          if (!tag) { warnings.push(`工作表「${base}/周期检修项」第${r._row}行 位号为空，已跳过`); continue; }
          const cycleDays = C.parsePeriod(r['检修周期']);
          if (r['检修周期'] && cycleDays === null) warnings.push(`工作表「${base}/周期检修项」第${r._row}行 检修周期「${C.str(r['检修周期'])}」无法解析`);
          const last = C.normDate(r['上次检修']);
          if (r['上次检修'] && !last) warnings.push(`工作表「${base}/周期检修项」第${r._row}行 上次检修「${C.str(r['上次检修'])}」无法解析`);
          const nextDue = (last && cycleDays !== null) ? C.addDays(last, cycleDays) : null;
          // 按下次到期日对申报周期筛选：晚于周期末 → 本期不申报（单列）；早于周期初 → 已超期照常纳入；算不出 → 纳入并 warning
          let dueStatus, overdue = null;
          if (!periodEnd) {
            dueStatus = '未按周期筛选';
            if (!cyclicPeriodWarned) { cyclicPeriodWarned = true; warnings.push(`上报周期「${period}」无法识别起止日期，周期性检修项未按到期筛选，全部纳入，请人工核对哪些不在本期`); }
          } else if (!nextDue) {
            dueStatus = '到期日未知';
            const why = [!last ? (C.str(r['上次检修']) ? '上次检修日期无法解析' : '缺上次检修日期') : '', cycleDays === null ? (C.str(r['检修周期']) ? '检修周期无法解析' : '检修周期为空') : ''].filter(Boolean).join('、');
            warnings.push(`工作表「${base}/周期检修项」第${r._row}行（${tag}${C.str(r['周期项编号']) ? ' ' + C.str(r['周期项编号']) : ''}）${why}，下次到期日算不出，无法判断是否本期到期，已照常纳入，请核实`);
          } else if (nextDue > periodEnd) {
            cyclicOutOfPeriod.push({
              tag, name: C.str(r['设备名称']), basisNo: C.str(r['周期项编号']), project: C.str(r['项目名称']),
              cycle: C.str(r['检修周期']), cycleDays, lastDate: last, nextDue,
              from: `${base}/周期检修项 第${r._row}行`,
              note: `下次到期日晚于申报周期末（${periodEnd}），本期不申报`,
            });
            continue;
          } else {
            overdue = nextDue < periodStart;
            dueStatus = overdue ? '已超期' : '本期到期';
          }
          raw.push({
            sourceType: 'cyclic', sourceCn: '周期性检修项',
            basisNo: C.str(r['周期项编号']), tag, name: C.str(r['设备名称']),
            project: C.str(r['项目名称']),
            desc: C.str(r['项目名称']) + (cycleDays !== null ? `（周期 ${C.fmtPeriod ? C.fmtPeriod(cycleDays) : cycleDays + ' 天'}）` : ''),
            level: '', status: '',
            since: last, cycleDays, lastDate: last, nextDue, dueStatus, overdue,
            needShutdown: parseYN(r['是否需停机']),
            durationDays: durationDays(r['预计工期'], { sheet: `${base}/周期检修项`, row: r._row, col: '预计工期' }, hourHdr),
            spareName: C.str(r['备件需求']), spareModel: C.str(r['备件型号']),
            spareQty: num(r['需求数量'], { sheet: `${base}/周期检修项`, row: r._row, col: '需求数量' }), spareNoCol: !spareCol,
            discipline: C.str(r['专业']), prio: null,
            prioReason: '周期性检修项无缺陷等级，未按「中」默认；按应完成日期安排',
            sheet: `${base}/周期检修项`, row: r._row,
          });
        }
      }
    }

    // ---- 来源 4：隐患台账（未整改隐患，设备类）
    const hzRows = C.pickSheet(book, '隐患台账', '隐患整改', '隐患');
    if (hzRows) {
      foundSources.push(`${base}→隐患整改项`);
      const hourHdr = durationHourHeader(hzRows);
      const recs = scoped(C.toRecords(hzRows, ['位号'], `${base}/隐患台账`,
        ['隐患编号', '隐患描述', '设备名称', '隐患等级', '整改措施', '整改期限', '状态', '责任人', '是否需停机', '预计工期', '备件需求', '备件型号', '需求数量', '专业', '车间'],
        warnings, ALIASES), `${base}/隐患台账`);
      const spareCol = spareColOf(recs, `${base}/隐患台账`);
      for (const r of recs) {
        const tag = C.str(r['位号']);
        if (!tag) { warnings.push(`工作表「${base}/隐患台账」第${r._row}行 位号为空（非设备类隐患不进检修需求），已跳过`); continue; }
        if (!statusGate(r, base, '隐患台账', C.str(r['隐患编号']), tag, C.str(r['隐患描述']), '隐患整改项')) continue;
        const deadline = C.normDate(r['整改期限']);
        if (r['整改期限'] && !deadline) warnings.push(`工作表「${base}/隐患台账」第${r._row}行 整改期限「${C.str(r['整改期限'])}」无法解析`);
        const hp = hazardPrio(r['隐患等级']);
        if (hp.reason) warnings.push(`工作表「${base}/隐患台账」第${r._row}行（${tag}）${hp.reason}，优先级未判定`);
        raw.push({
          sourceType: 'hazard', sourceCn: '隐患整改项',
          basisNo: C.str(r['隐患编号']), tag, name: C.str(r['设备名称']),
          project: C.str(r['整改措施']) ? C.str(r['整改措施']).slice(0, 24) : (C.str(r['隐患描述']) ? `${C.str(r['隐患描述']).split(/[，,。；;]/)[0].slice(0, 16)}整改` : ''),
          desc: [C.str(r['隐患描述']), C.str(r['整改措施']) ? '整改措施：' + C.str(r['整改措施']) : ''].filter(Boolean).join('；'),
          level: C.str(r['隐患等级']), status: C.str(r['状态']),
          since: deadline, deadline, owner: C.str(r['责任人']),
          needShutdown: parseYN(r['是否需停机']),
          durationDays: durationDays(r['预计工期'], { sheet: `${base}/隐患台账`, row: r._row, col: '预计工期' }, hourHdr),
          spareName: C.str(r['备件需求']), spareModel: C.str(r['备件型号']),
          spareQty: num(r['需求数量'], { sheet: `${base}/隐患台账`, row: r._row, col: '需求数量' }), spareNoCol: !spareCol,
          discipline: C.str(r['专业']), prio: hp.prio, prioReason: hp.reason,
          sheet: `${base}/隐患台账`, row: r._row,
        });
      }
    }
  }
  // ---- 通知单 ↔ 工单配对：工单「通知单号」明确指向的通知单已转工单，按工单申报一次，不再单列（这不是相似度猜测，是系统里的单据关联）
  const linkedNotif = [];
  {
    const orderByNotif = new Map(raw.filter((x) => x.sourceType === 'order' && x.notifNo).map((x) => [notifKey(x.notifNo), x]));
    for (let i = raw.length - 1; i >= 0; i--) {
      const it = raw[i];
      if (it.sourceType !== 'defect' || !it.basisNo) continue;
      const o = orderByNotif.get(notifKey(it.basisNo));
      const done = doneOrderNotif.get(notifKey(it.basisNo));
      if (!o && !done) continue;
      raw.splice(i, 1);
      if (o) {
        // 工单缺的字段沿用通知单：缺陷等级、是否停机、工期
        if (o.prio === null && it.prio !== null) { o.prio = it.prio; o.prioReason = null; o.level = o.level || it.level; o.prioFrom = it.basisNo; }
        if (o.needShutdown === null && it.needShutdown !== null) o.needShutdown = it.needShutdown;
        if (o.durationDays === null && it.durationDays !== null) o.durationDays = it.durationDays;
        // 工单没有备件信息时沿用通知单的备件名称、型号、数量（SAP 订单的组件常不随导出带出，备件需求只在通知单上）
        if (!o.spareName && !o.spareModel && (it.spareName || it.spareModel)) {
          o.spareName = it.spareName; o.spareModel = it.spareModel; o.spareQty = it.spareQty; o.spareFrom = it.basisNo;
        }
        // 工单表无备件列、通知单表有备件列：备件需求以通知单为准（通知单备件列为空即无备件需求）
        if (o.spareNoCol && !it.spareNoCol) o.spareNoCol = false;
        if (!o.desc && it.desc) { o.desc = it.desc; if (!o.project) o.project = it.desc.slice(0, 24); }
        if (!o.discipline && it.discipline) o.discipline = it.discipline;
      }
      linkedNotif.push({ notifNo: it.basisNo, tag: it.tag, orderNo: o ? o.basisNo : done.orderNo, orderState: o ? '未闭环' : done.state, from: `${it.sheet} 第${it.row}行` });
    }
    linkedNotif.reverse();
    if (linkedNotif.length) {
      warnings.push(`${linkedNotif.length} 条通知单已转工单（工单「通知单号」列对应），按工单申报、不再单列：${linkedNotif.map((x) => `${x.notifNo}→${x.orderNo}${x.orderState !== '未闭环' ? `（工单${x.orderState}，本期不申报）` : ''}`).join('、')}`);
    }
  }
  if (cyclicOutOfPeriod.length) {
    warnings.push(`${cyclicOutOfPeriod.length} 条周期项下次到期日晚于申报周期末（${periodEnd}），本期不申报，已单列「周期外周期项（本期不申报）」：${cyclicOutOfPeriod.map((x) => `${x.basisNo || x.tag}（${x.nextDue}）`).join('、')}`);
  }
  if (!foundSources.length) throw new Error('未在输入中找到「缺陷台账/通知单」「工单台账/订单」「周期检修项」「隐患台账」任一工作表（周期检修项需加 --include-cyclic）');
  if (!raw.length && !statusUndetermined.length) {
    throw new Error(`各来源中没有任何未闭环需求项，无需上报${cyclicOutOfPeriod.length ? `（另有 ${cyclicOutOfPeriod.length} 条周期项下次到期日晚于申报周期末 ${periodEnd}，本期不申报：${cyclicOutOfPeriod.map((x) => `${x.basisNo || x.tag}（${x.nextDue}）`).join('、')}）` : ''}`);
  }

  // ============ 二、备件库存（SAP MM 列名可读）============
  let spareStock = null;   // Map: 型号|名称 → 库存数量
  let stockHasModel = false;   // 库存表有型号：需求写了型号时只按型号查，不借用同名其他规格的库存
  if (a.spare) {
    if (!fs.existsSync(a.spare)) throw new Error(`备件库存表不存在: ${a.spare}`);
    const sb = loadBook(a.spare);
    const rows = C.pickSheet(sb, '备件库存', '库存', '备件台账', '备件', '物料');
    if (!rows) warnings.push('备件库存文件中未找到「备件库存」工作表，备件是否到位一律写「未核实」');
    else {
      const recs = C.toRecords(rows, ['备件名称'], '备件库存', ['备件型号', '库存数量'], warnings, ALIASES);
      spareStock = new Map();
      for (const r of recs) {
        const nm = C.str(r['备件名称']), mo = C.str(r['备件型号']);
        if (!nm && !mo) continue;
        const qty = num(r['库存数量'], { sheet: '备件库存', row: r._row, col: '库存数量' });
        // 同型号多行（多个库位/库存地点）与同名多行（不同型号）都合计；任一行数量无法解析则合计也记 null
        const add = (k) => spareStock.set(k, spareStock.has(k) ? (spareStock.get(k) === null || qty === null ? null : spareStock.get(k) + qty) : qty);
        if (mo) { add('M:' + mo); stockHasModel = true; }
        if (nm) add('N:' + nm);
      }
      if (!spareStock.size) { warnings.push('备件库存表未解析出任何记录，备件是否到位一律写「未核实」'); spareStock = null; }
    }
  } else {
    warnings.push('未提供备件库存表（--spare），所有需求的「备件是否到位」一律写「未核实」，不得按有库存处理');
  }

  /** 备件到位判定：来源表无备件列→「未核实（来源表无备件列）」（需求未知）；无库存表→「未核实」；查不到型号→「未核实」+warning；需求数量未填→未判定（不按 1 件）；数量不足→「不足」 */
  function spareStatus(it) {
    if (!it.spareName && !it.spareModel && it.spareNoCol) return { text: '未核实（来源表无备件列）', state: 'unknown', stock: null, undetermined: null };
    if (!it.spareName && !it.spareModel) return { text: '无备件需求', state: 'none', stock: null, undetermined: null };
    if (!spareStock) return { text: '未核实', state: 'unverified', stock: null, undetermined: null };
    let stock = null, hit = null;
    if (it.spareModel && spareStock.has('M:' + it.spareModel)) { stock = spareStock.get('M:' + it.spareModel); hit = it.spareModel; }
    else if (it.spareName && spareStock.has('N:' + it.spareName) && !(it.spareModel && stockHasModel)) {
      // 只在需求没写型号、或库存表没有型号列时按名称匹配；写了型号却查不到的，不借用同名其他规格的库存
      stock = spareStock.get('N:' + it.spareName); hit = it.spareName;
      if (it.spareModel) warnings.push(`备件「${it.spareName} ${it.spareModel}」（${it.tag}）：库存表无型号列，已按名称匹配，未核对型号`);
    }
    if (hit === null) {
      warnings.push(`备件「${it.spareModel || it.spareName}」（${it.tag}）不在备件库存表中，备件是否到位写「未核实」`);
      return { text: '未核实', state: 'unverified', stock: null, undetermined: null };
    }
    if (stock === null) {
      warnings.push(`备件「${hit}」库存数量无法解析，备件是否到位写「未核实」`);
      return { text: '未核实', state: 'unverified', stock: null, undetermined: null };
    }
    if (it.spareQty === null) {
      warnings.push(`备件「${hit}」（${it.tag}）需求数量未填，有库存 ${C.fmt(stock)} 但无法判断是否够用，未按 1 件默认，到位情况未判定`);
      return { text: `未判定（库存 ${C.fmt(stock)}，需求数量未填）`, state: 'unverified', stock, undetermined: '需求数量' };
    }
    if (stock >= it.spareQty) return { text: `到位（库存 ${C.fmt(stock)}）`, state: 'ok', stock, undetermined: null };
    return { text: `不足（库存 ${C.fmt(stock)} / 需 ${C.fmt(it.spareQty)}）`, state: 'short', stock, undetermined: null };
  }

  // ============ 三、依据校验：无依据项不进正式清单 ============
  const MISSING_CN = { defect: '缺陷编号/通知单号', order: '工单号', cyclic: '周期项编号', hazard: '隐患编号' };
  const formal = [], noBasis = [];
  for (const it of raw) {
    if (!it.basisNo) {
      noBasis.push({
        tag: it.tag, name: it.name, source: it.sourceCn, desc: it.desc || '（描述为空）',
        missing: MISSING_CN[it.sourceType],
        from: `${it.sheet} 第${it.row}行`,
        note: '无来源单号，不列入正式上报清单，请核实后补编号重新汇总',
      });
      warnings.push(`工作表「${it.sheet}」第${it.row}行（${it.tag}）缺少${MISSING_CN[it.sourceType]}，已移入建议核实区，不进正式清单`);
      continue;
    }
    formal.push(it);
  }
  if (!formal.length && !statusUndetermined.length) throw new Error(`全部 ${raw.length} 条需求均无来源单号依据，正式上报清单为空；请补齐缺陷编号/通知单号/工单号/周期项编号/隐患编号后重新汇总`);
  if (!formal.length) warnings.push(`正式清单为空：${raw.length} 条无来源单号、${statusUndetermined.length} 条状态无法判断是否闭环，均未纳入，请核实后重新汇总`);

  // ============ 四、排序与编号 ============
  // 优先级：1 紧急 > 2 高 > 3 中 > 4 低 > 未判定；同级按需停机在前、再按应完成日期、再按位号
  formal.sort((x, y) => {
    const px = x.prio === null ? 9 : x.prio, py = y.prio === null ? 9 : y.prio;
    if (px !== py) return px - py;
    const sx = x.needShutdown === true ? 0 : 1, sy = y.needShutdown === true ? 0 : 1;
    if (sx !== sy) return sx - sy;
    const dx = x.nextDue || x.planDate || x.deadline || '9999', dy = y.nextDue || y.planDate || y.deadline || '9999';
    if (dx !== dy) return dx < dy ? -1 : 1;
    return String(x.tag).localeCompare(String(y.tag), 'zh');
  });

  const undetermined = [];
  for (const u of statusUndetermined) undetermined.push(Object.assign({ seq: null, kind: 'status' }, u));

  const demands = formal.map((it, i) => {
    const sp = spareStatus(it);
    const reasonParts = [];
    if (it.sourceType === 'defect') reasonParts.push(`缺陷/通知单 ${it.basisNo}${it.level ? '（' + it.level + '）' : ''}${it.since ? ' 于 ' + it.since + ' 发现' : ''}未闭环`);
    if (it.sourceType === 'order') reasonParts.push(`工单 ${it.basisNo} 未闭环${it.orderType ? '（' + it.orderType + '）' : ''}${it.notifNo ? '，对应通知单 ' + it.notifNo + (it.prioFrom ? '（' + it.level + '）' : '') : ''}${it.spareFrom ? '，备件需求沿用通知单 ' + it.spareFrom : ''}${it.planDate ? '，计划完成 ' + it.planDate : ''}`);
    if (it.sourceType === 'cyclic') reasonParts.push(`周期项 ${it.basisNo}${it.cycleDays !== null ? '，周期 ' + it.cycleDays + ' 天' : ''}${it.lastDate ? '，上次检修 ' + it.lastDate : ''}${it.nextDue ? '，应于 ' + it.nextDue + ' 前完成' : ''}${it.dueStatus === '已超期' ? '（已超期，申报周期开始前已到期未做）' : it.dueStatus === '到期日未知' ? '，下次到期日算不出（未按到期筛选）' : ''}`);
    if (it.sourceType === 'hazard') reasonParts.push(`隐患 ${it.basisNo}${it.level ? '（' + it.level + '）' : ''}未整改${it.deadline ? '，整改期限 ' + it.deadline : ''}${it.owner ? '，责任人 ' + it.owner : ''}`);
    if (it.desc) reasonParts.push(`记录原文：${it.desc}`);
    const seq = i + 1;
    if (it.prio === null) undetermined.push({ seq, kind: 'priority', tag: it.tag, name: it.name, source: it.sourceCn, basisNo: it.basisNo, field: '优先级', reason: it.prioReason || '等级缺失', from: `${it.sheet} 第${it.row}行`, note: '未按高/中/低默认，排在清单末尾，请车间确认缓急后补填' });
    if (sp.undetermined) undetermined.push({ seq, kind: 'spareQty', tag: it.tag, name: it.name, source: it.sourceCn, basisNo: it.basisNo, field: '需求数量', reason: '备件需求数量未填', from: `${it.sheet} 第${it.row}行`, note: '有库存但无法判断是否够用，未按 1 件默认' });
    const planEnd = it.nextDue || it.planDate || it.deadline || null;
    return {
      seq,
      workshop: a.workshop,
      tag: it.tag,
      name: it.name || '',
      project: it.project || (it.desc ? it.desc.slice(0, 24) : ''),
      source: it.sourceCn, sourceType: it.sourceType,
      category: categoryOf(it),
      desc: it.desc || '',
      needShutdown: it.needShutdown,                  // true/false/null（null=未填，不默认）
      needShutdownCn: it.needShutdown === null ? '未填写' : (it.needShutdown ? '是' : '否'),
      planStart: null, planEnd,
      dueStatus: it.dueStatus || null,                // 周期项：本期到期 / 已超期 / 到期日未知；其他来源 null
      overdue: it.sourceType === 'cyclic' ? (it.overdue === undefined ? null : it.overdue) : null,
      durationDays: it.durationDays,
      spareName: it.spareName || '', spareModel: it.spareModel || '', spareQty: it.spareQty,
      spareStatus: sp.text, spareState: sp.state, spareStock: sp.stock,
      discipline: it.discipline || disciplineOf(it.tag, it.name),
      priority: it.prio === null ? null : it.prio,
      priorityCn: it.prio === null ? '未判定' : PRIO_CN[it.prio],
      priorityNote: it.prioReason || null,
      reason: reasonParts.join('；'),
      basisNo: it.basisNo,
      basis: `${it.sourceCn} ${it.basisNo}（${it.sheet} 第${it.row}行）`,
      srcSheet: it.sheet, srcRow: it.row,
      statusRaw: it.status || '',
      orderType: it.orderType || '', owner: it.owner || '',
      notifNo: it.notifNo || null,
    };
  });

  // ============ 五、疑似重复（同一设备多条相近需求）============
  const possibleDuplicate = [];
  const byTag = new Map();
  for (const d of demands) { if (!byTag.has(d.tag)) byTag.set(d.tag, []); byTag.get(d.tag).push(d); }
  for (const [tag, list] of byTag) {
    if (list.length < 2) continue;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const score = C.round(similarity(list[i], list[j]), 2);
        if (score < DUP_THRESHOLD) continue;
        possibleDuplicate.push({
          tag, name: list[i].name,
          items: [
            { seq: list[i].seq, basisNo: list[i].basisNo, source: list[i].source, desc: list[i].desc },
            { seq: list[j].seq, basisNo: list[j].basisNo, source: list[j].source, desc: list[j].desc },
          ],
          score,
          note: '同一设备多条相近需求，疑似重复，请确认是否合并；脚本已全部保留，未自动合并也未自动剔除',
        });
        warnings.push(`位号「${tag}」序号 ${list[i].seq} 与 ${list[j].seq} 疑似重复（相似度 ${score}），已全部保留待确认`);
      }
    }
  }

  // ============ 六、需停机 / 备件缺口 / 停机窗口冲突 ============
  const needShutdown = demands.filter((d) => d.needShutdown === true)
    .map((d) => ({ seq: d.seq, tag: d.tag, name: d.name, project: d.project, category: d.category, durationDays: d.durationDays, discipline: d.discipline, priorityCn: d.priorityCn, basisNo: d.basisNo }));
  const shutdownUnknown = demands.filter((d) => d.needShutdown === null)
    .map((d) => ({ seq: d.seq, tag: d.tag, project: d.project, basisNo: d.basisNo, missing: '是否需停机', note: '「是否需停机」未填，未按需停机或不需停机默认，请补填' }));
  for (const x of shutdownUnknown) undetermined.push({ seq: x.seq, kind: 'shutdown', tag: x.tag, name: '', source: '', basisNo: x.basisNo, field: '是否停工', reason: '「是否需停机」未填', from: '', note: x.note });

  const spareGap = demands.filter((d) => d.spareState === 'short' || d.spareState === 'unverified')
    .map((d) => ({ seq: d.seq, tag: d.tag, spareName: d.spareName, spareModel: d.spareModel, spareQty: d.spareQty, status: d.spareStatus, state: d.spareState }));

  // netDemand：扣除疑似重复后的「净需求条数区间」——不自动去重，只给上下界
  const dupSeqs = new Set();
  for (const p of possibleDuplicate) dupSeqs.add(p.items[1].seq);   // 若确认合并，保留靠前的一条
  const netDemand = {
    total: demands.length,
    possibleDuplicatePairs: possibleDuplicate.length,
    netIfAllMerged: demands.length - dupSeqs.size,
    note: '净需求为「若疑似重复全部确认合并」的下界；脚本未自动合并，实际条数以用户确认为准',
    windowConflict: null,
  };
  if (a.window) {
    const totalShutdownDays = needShutdown.reduce((s, x) => s + (x.durationDays === null ? 0 : x.durationDays), 0);
    const unknownDur = needShutdown.filter((x) => x.durationDays === null).length;
    const wd = C.str(a.window).match(/(\d+(?:\.\d+)?)\s*(?:天|日|d)/i);
    const windowDays = wd ? Number(wd[1]) : null;
    if (windowDays === null) {
      netDemand.windowConflict = { conflict: null, note: `停机窗口说明「${a.window}」未能解析出可用天数，未做窗口冲突判定` };
      warnings.push(`停机窗口说明「${a.window}」未能解析出天数，未做停机窗口冲突判定`);
    } else if (unknownDur > 0) {
      netDemand.windowConflict = { conflict: null, windowDays, shutdownDaysKnown: C.round(totalShutdownDays, 1), unknownDurationItems: unknownDur, note: `有 ${unknownDur} 项需停机需求未填预计工期，窗口是否够用无法判定` };
      warnings.push(`有 ${unknownDur} 项需停机需求未填预计工期，停机窗口冲突无法判定`);
    } else {
      const conflict = totalShutdownDays > windowDays;
      netDemand.windowConflict = { conflict, windowDays, shutdownDaysKnown: C.round(totalShutdownDays, 1), unknownDurationItems: 0, note: conflict ? `需停机项合计工期 ${C.round(totalShutdownDays, 1)} 天，超出停机窗口 ${windowDays} 天，需公司设备管理部门（机动部/设备部）统筹` : `需停机项合计工期 ${C.round(totalShutdownDays, 1)} 天，在停机窗口 ${windowDays} 天内` };
      if (conflict) warnings.push(`需停机项合计工期 ${C.round(totalShutdownDays, 1)} 天，超出停机窗口 ${windowDays} 天`);
    }
  }

  // ============ 七、上报模板列名匹配 ============
  let tplCols = null, tplUnmatched = [], tplMissing = [];
  if (a.template) {
    if (!fs.existsSync(a.template)) throw new Error(`上报模板不存在: ${a.template}`);
    const tb = loadBook(a.template);
    const keys = Object.keys(tb);
    const rows = C.pickSheet(tb, '检修需求表', '需求表', '上报表', '检修需求', '检修计划', '申报表') || (keys.length ? tb[keys[0]] : null);
    if (!rows || !rows.length) warnings.push('上报模板中未读到任何表头，按默认上报格式输出');
    else {
      let h = 0, best = -1;
      for (let i = 0; i < Math.min(10, rows.length); i++) {
        const n = (rows[i] || []).filter((c) => C.str(c)).length;
        if (n > best) { best = n; h = i; }
      }
      const header = (rows[h] || []).map((c) => C.str(c)).filter(Boolean);
      if (!header.length) warnings.push('上报模板中未读到任何表头，按默认上报格式输出');
      else {
        tplCols = header.map((name) => ({ name, std: matchTplCol(name) }));
        tplUnmatched = tplCols.filter((c) => !c.std).map((c) => c.name);
        const matched = new Set(tplCols.map((c) => c.std).filter(Boolean));
        tplMissing = STD_COLS.filter((s) => !matched.has(s) && ['功能位置', '检修项目名称', '来源', '依据编号'].includes(s));
        if (tplUnmatched.length) warnings.push(`上报模板列名无法匹配标准字段：${tplUnmatched.join('、')}（这些列在输出中留空，请人工确认填写口径）`);
        if (tplMissing.length) warnings.push(`上报模板缺少关键列：${tplMissing.join('、')}（模板中无对应列，相关信息仅在 需求汇总.md 中体现）`);
      }
    }
  }

  const counts = {
    sources: foundSources.length,
    raw: raw.length,
    demands: demands.length,
    noBasis: noBasis.length,
    statusUndetermined: statusUndetermined.length,
    skippedDone,
    linkedNotif: linkedNotif.length,
    undetermined: undetermined.length,
    priorityUndetermined: demands.filter((d) => d.priority === null).length,
    needShutdown: needShutdown.length,
    shutdownUnknown: shutdownUnknown.length,
    spareGap: spareGap.length,
    spareUnverified: demands.filter((d) => d.spareState === 'unverified').length,
    spareNeedUnknown: demands.filter((d) => d.spareState === 'unknown').length,   // 来源表无备件列，备件需求未知（不计入 spareGap）
    spareQtyUndetermined: undetermined.filter((u) => u.kind === 'spareQty').length,
    possibleDuplicate: possibleDuplicate.length,
    cyclicOutOfPeriod: cyclicOutOfPeriod.length,     // 下次到期日晚于申报周期末，本期不申报（不计入 demands）
    cyclicOverdue: demands.filter((d) => d.dueStatus === '已超期').length,
    cyclicDueUnknown: demands.filter((d) => d.dueStatus === '到期日未知').length,
    byPriority: { 紧急: 0, 高: 0, 中: 0, 低: 0, 未判定: 0 },
    bySource: { 未闭环缺陷: 0, 未闭环工单: 0, 周期性检修项: 0, 隐患整改项: 0 },
    byCategory: {},
  };
  for (const d of demands) {
    counts.byPriority[d.priorityCn] = (counts.byPriority[d.priorityCn] || 0) + 1;
    counts.bySource[d.source] = (counts.bySource[d.source] || 0) + 1;
    counts.byCategory[d.category] = (counts.byCategory[d.category] || 0) + 1;
  }

  // ============ 八、产出 ============
  C.ensureDir(outDir);

  const result = {
    meta: {
      workshop: a.workshop, period, periodStart, periodEnd, due, window: a.window || null, workshopScope: scopes,
      includeCyclic, sources: foundSources, generatedAt: C.localDateTime(),
      spareProvided: !!a.spare, spareResolved: !!spareStock,
      templateProvided: !!a.template, declaration: DECL, disclaimer: DISCLAIMER,
      reportTo: '车间设备主任 / 公司设备管理部门（机动部/设备部）',
      columns: STD_COLS,
    },
    counts, demands, netDemand, needShutdown, shutdownUnknown, spareGap,
    possibleDuplicate, undetermined, noBasis, linkedNotif, cyclicOutOfPeriod,
    template: tplCols ? { columns: tplCols, unmatched: tplUnmatched, missingKeyColumns: tplMissing } : null,
    warnings,
  };
  fs.writeFileSync(path.join(outDir, 'demands.json'), JSON.stringify(result, null, 2), 'utf8');

  // ---- 检修需求表.xlsx（月度检修计划申报表列头，或按模板列名）
  const spareText = (d) => ([d.spareName, d.spareModel].filter(Boolean).join(' ') + (d.spareQty === null ? '' : ` ×${d.spareQty}`)) || (d.spareState === 'unknown' ? '未知（来源表无备件列）' : '无');
  const cellOf = (d, std) => {
    switch (std) {
      case '序号': return d.seq;
      case '车间': return d.workshop;
      case '功能位置': return d.tag;
      case '设备名称': return d.name || '';
      case '检修项目名称': return d.project || '';
      case '检修内容': return d.desc || '';
      case '检修类别': return d.category;
      case '来源': return d.source;
      case '依据编号': return d.basisNo;
      case '是否停工': return d.needShutdownCn;
      case '计划开始': return d.planStart || '';
      case '计划结束': return d.planEnd || '';
      case '工期(天)': return d.durationDays === null ? '未填' : d.durationDays;
      case '主要备件材料': return spareText(d);
      case '备件到位情况': return d.spareStatus;
      case '建议专业': return d.discipline;
      case '优先级': return d.priorityCn;
      case '申报理由': return d.reason;
      case '备注': return [d.dueStatus === '已超期' ? '已超期' : d.dueStatus === '到期日未知' ? '下次到期日算不出' : '', d.priorityNote, d.orderType ? '工单类型 ' + d.orderType : '', d.owner ? '责任人 ' + d.owner : ''].filter(Boolean).join('；');
      default: return '';
    }
  };
  const xlsxHeader = tplCols ? tplCols.map((c) => c.name) : STD_COLS;
  const xlsxBody = demands.map((d) => (tplCols ? tplCols.map((c) => (c.std ? cellOf(d, c.std) : '')) : STD_COLS.map((s) => cellOf(d, s))));
  const sheets = {
    '检修需求表': [
      [`${a.workshop} ${period} 月度检修计划申报表（车间申报稿）`],
      [DECL],
      [],
      xlsxHeader,
      ...xlsxBody,
    ],
    '需停机项': [['序号', '功能位置', '设备名称', '检修项目名称', '检修类别', '工期(天)', '建议专业', '优先级', '依据编号'],
      ...needShutdown.map((x) => [x.seq, x.tag, x.name || '', x.project || '', x.category, x.durationDays === null ? '未填' : x.durationDays, x.discipline, x.priorityCn, x.basisNo])],
    '备件缺口': [['序号', '功能位置', '备件名称', '备件型号/物料', '需求数量', '到位情况'],
      ...spareGap.map((x) => [x.seq, x.tag, x.spareName || '', x.spareModel || '', x.spareQty === null ? '未填' : x.spareQty, x.status])],
    '疑似重复待确认': [['功能位置', '序号A', '依据A', '序号B', '依据B', '相似度', '说明'],
      ...possibleDuplicate.map((p) => [p.tag, p.items[0].seq, p.items[0].basisNo, p.items[1].seq, p.items[1].basisNo, p.score, p.note])],
    '未判定项': [['序号', '功能位置', '来源', '依据编号', '未判定字段', '原因', '出处', '说明'],
      ...undetermined.map((u) => [u.seq === null ? '' : u.seq, u.tag, u.source || '', u.basisNo || '', u.field, u.reason, u.from || '', u.note])],
    '建议核实区': [['功能位置', '设备名称', '来源', '需求描述', '缺失依据', '出处', '说明'],
      ...noBasis.map((x) => [x.tag, x.name || '', x.source, x.desc, x.missing, x.from, x.note])],
  };
  const OOP_COLS = ['功能位置', '设备名称', '检修项目名称', '周期项编号', '检修周期', '上次检修', '下次到期', '出处', '说明'];
  const oopRow = (x) => [x.tag, x.name || '', x.project || '', x.basisNo || '', x.cycle || '', x.lastDate || '', x.nextDue, x.from, x.note];
  if (includeCyclic) sheets['周期外周期项（本期不申报）'] = [OOP_COLS, ...cyclicOutOfPeriod.map(oopRow)];
  writeXlsx(path.join(outDir, '检修需求表.xlsx'), sheets);

  // ---- 需求汇总.md
  const L = [];
  const wsNote = C.workshopScopeNote(scopes, a.workshop);
  L.push(`# ${a.workshop} ${period} 月度检修计划申报（检修需求汇总）`);
  L.push('');
  if (wsNote.alert) { L.push(`**${wsNote.alert}**`); L.push(''); }
  L.push(`> ${DISCLAIMER}`);
  L.push(`> ${DECL}。`);
  L.push('');
  L.push(`数据来源：${foundSources.join('、')}`);
  if (wsNote.note) L.push(wsNote.note);
  L.push(`上报周期：${period}${due ? ` ｜ 上报截止：${due}` : ''}${a.window ? ` ｜ 停机窗口：${a.window}` : ''} ｜ 申报对象：${result.meta.reportTo}`);
  L.push(`周期性检修项：${includeCyclic ? (periodEnd ? `已纳入（--include-cyclic），只报下次到期日不晚于 ${periodEnd} 的（含已超期），周期外 ${cyclicOutOfPeriod.length} 条本期不申报` : '已纳入（--include-cyclic），上报周期起止无法识别，未按到期筛选') : '未纳入'}　备件库存表：${spareStock ? '已提供' : '未提供（备件到位情况一律为「未核实」）'}`);
  L.push(`生成时间：${C.localDateTime()}（北京时间）`);
  L.push('');
  L.push('## 一、汇总概览');
  L.push('');
  L.push(C.mdTable(['指标', '数量'], [
    ['正式清单需求条数', counts.demands],
    ['　未闭环缺陷/通知单', counts.bySource['未闭环缺陷'] || 0],
    ['　未闭环工单', counts.bySource['未闭环工单'] || 0],
    ['　周期性检修项', includeCyclic ? (counts.bySource['周期性检修项'] || 0) : '—（未纳入）'],
    ['　隐患整改项', counts.bySource['隐患整改项'] || 0],
    ...(includeCyclic ? [
      ['　　其中周期项已超期', counts.cyclicOverdue],
      ['　　其中周期项下次到期日算不出', counts.cyclicDueUnknown],
      ['周期外周期项（本期不申报）', counts.cyclicOutOfPeriod],
    ] : []),
    ['需停机项', counts.needShutdown],
    ['停机与否未填', counts.shutdownUnknown],
    ['备件缺口项', counts.spareGap],
    ['　其中备件未核实/未判定', counts.spareUnverified],
    ['备件需求未知（来源表无备件列）', counts.spareNeedUnknown],
    ['疑似重复（待确认）', counts.possibleDuplicate],
    ['未判定项（优先级/数量/状态/停工）', counts.undetermined],
    ['已完工待验收（本期不重复申报）', counts.skippedDone],
    ['已转工单的通知单（按工单申报，不单列）', counts.linkedNotif],
    ['无依据项（未进正式清单）', counts.noBasis],
  ]));
  L.push(C.mdTable(['优先级', '条数'], Object.entries(counts.byPriority).map(([k, v]) => [k, v])));
  L.push(C.mdTable(['检修类别（建议）', '条数'], Object.entries(counts.byCategory).map(([k, v]) => [k, v])));
  L.push(`净需求：正式清单 ${netDemand.total} 条；若 ${netDemand.possibleDuplicatePairs} 组疑似重复经确认全部合并，则为 ${netDemand.netIfAllMerged} 条。${netDemand.note}。`);
  L.push('');
  L.push('【注意】检修类别按 装置大检修（停工检修）/ 日常维修 / 抢修 / 专项 口径由来源与工单类型推定，为建议值；工单类型编码 PM01/PM02/PM03 为常见口径，厂内可配置。');
  L.push('');
  if (netDemand.windowConflict) {
    const w = netDemand.windowConflict;
    L.push(`停机窗口核对：${w.note}${w.conflict === true ? '　**（与停机窗口冲突）**' : w.conflict === false ? '' : '　（未判定）'}`);
    L.push('');
  }
  L.push('## 二、需求明细');
  L.push('');
  L.push(C.mdTable(['序号', '功能位置', '设备名称', '检修项目名称', '检修类别', '来源', '检修内容', '是否停工', '计划结束', '工期(天)', '主要备件材料', '备件到位情况', '建议专业', '优先级', '依据编号'],
    demands.map((d) => [d.seq, d.tag, d.name || '—', d.project || '—', d.category, d.source, d.desc || '—', d.needShutdownCn,
      (d.planEnd || '—') + (d.dueStatus === '已超期' ? '（已超期）' : d.dueStatus === '到期日未知' ? '（到期日未知）' : ''), d.durationDays === null ? '未填' : d.durationDays,
      spareText(d), d.spareStatus, d.discipline, d.priorityCn, d.basisNo])));
  L.push('### 申报理由');
  L.push('');
  L.push(C.mdTable(['序号', '功能位置', '申报理由（引自来源记录）'], demands.map((d) => [d.seq, d.tag, d.reason])));
  L.push('## 三、需停机项');
  L.push('');
  L.push(C.mdTable(['序号', '功能位置', '设备名称', '检修项目名称', '检修类别', '工期(天)', '建议专业', '优先级', '依据编号'],
    needShutdown.map((x) => [x.seq, x.tag, x.name || '—', x.project || '—', x.category, x.durationDays === null ? '未填' : x.durationDays, x.discipline, x.priorityCn, x.basisNo])));
  if (shutdownUnknown.length) {
    L.push('**「是否需停机」未填项**（未按需停机或不需停机默认）：');
    L.push('');
    L.push(C.mdTable(['序号', '功能位置', '检修项目名称', '依据编号', '缺失字段'],
      shutdownUnknown.map((x) => [x.seq, x.tag, x.project || '—', x.basisNo, x.missing])));
  }
  L.push('## 四、备件缺口');
  L.push('');
  if (!spareStock) L.push('【注意】未提供备件库存表（--spare），下列项目的备件到位情况一律为「未核实」，不得按有库存处理。\n');
  L.push(C.mdTable(['序号', '功能位置', '备件名称', '备件型号/物料', '需求数量', '到位情况'],
    spareGap.map((x) => [x.seq, x.tag, x.spareName || '—', x.spareModel || '—', x.spareQty === null ? '未填' : x.spareQty, x.status])));
  if (counts.spareNeedUnknown) {
    const unk = demands.filter((d) => d.spareState === 'unknown');
    L.push(`【注意】另有 ${unk.length} 项的来源表无备件列（备件需求/备件型号），备件需求未知，未计入上表，也不得写成不需要备件；请到 SAP 订单组件或 MRO 工单预留核实：序号 ${unk.map((d) => `${d.seq}（${d.tag}）`).join('、')}。`);
    L.push('');
  }
  L.push('## 五、疑似重复待确认');
  L.push('');
  if (!possibleDuplicate.length) L.push('_无_\n');
  else {
    for (const p of possibleDuplicate) {
      L.push(`**${p.tag}${p.name ? ' ' + p.name : ''}**（相似度 ${p.score}）`);
      L.push('');
      L.push(C.mdTable(['序号', '依据编号', '来源', '检修内容'], p.items.map((x) => [x.seq, x.basisNo, x.source, x.desc || '—'])));
      L.push(`【注意】${p.note}。`);
      L.push('');
    }
  }
  L.push('## 六、未判定项');
  L.push('');
  if (!undetermined.length) L.push('_无_\n');
  else {
    L.push(C.mdTable(['序号', '功能位置', '来源', '依据编号', '未判定字段', '原因', '出处'],
      undetermined.map((u) => [u.seq === null ? '—' : u.seq, u.tag, u.source || '—', u.basisNo || '—', u.field, u.reason, u.from || '—'])));
    L.push('【未判定】以上字段未按默认值填充：工单/周期项无等级不按「高/中」默认，备件需求数量未填不按 1 件默认，状态无法判断是否闭环的记录未纳入正式清单，「是否需停机」未填不按两端默认。请车间核实后补填重新汇总。');
    L.push('');
  }
  L.push('## 七、建议核实区（无依据，未进正式清单）');
  L.push('');
  L.push(C.mdTable(['功能位置', '设备名称', '来源', '需求描述', '缺失依据', '出处'],
    noBasis.map((x) => [x.tag, x.name || '—', x.source, x.desc, x.missing, x.from])));
  if (tplCols) {
    L.push('## 八、上报模板列名核对');
    L.push('');
    L.push(C.mdTable(['模板列名', '匹配到的标准字段'], tplCols.map((c) => [c.name, c.std || '**无法匹配（输出留空）**'])));
    if (tplUnmatched.length) L.push(`【注意】无法匹配的列：${tplUnmatched.join('、')}。这些列在「检修需求表.xlsx」中留空，请人工确认填写口径后补填。\n`);
    if (tplMissing.length) L.push(`【注意】模板缺少关键列：${tplMissing.join('、')}。相关信息仅在本文件中体现。\n`);
  }
  L.push(`## ${tplCols ? '九' : '八'}、汇总说明`);
  L.push('');
  L.push('<!-- ANALYSIS_START -->');
  L.push('（由模型依据 references/rollup-rules.md 口径撰写 200~400 字，结构：本期需求总数与来源构成 → 需停机项与停机窗口衔接 → 备件缺口与到货跟催 → 与上期遗留项的衔接及需公司设备管理部门协调事项。数量一律引用 demands.json，申报理由须引用来源记录原文要点，不得夸大紧急程度。）');
  L.push('<!-- ANALYSIS_END -->');
  L.push('');
  if (includeCyclic) {
    L.push('## 附：周期外周期项（本期不申报）');
    L.push('');
    if (!periodEnd) L.push('【注意】上报周期起止无法识别，周期性检修项未按到期筛选，全部列入了需求明细，请人工核对。\n');
    else if (!cyclicOutOfPeriod.length) L.push('_无_\n');
    else {
      L.push(C.mdTable(OOP_COLS, cyclicOutOfPeriod.map((x) => oopRow(x).map((c) => (c === '' || c === null ? '—' : c)))));
      L.push(`【注意】以上 ${cyclicOutOfPeriod.length} 条周期项下次到期日晚于申报周期末（${periodEnd}），未列入本期申报清单，到期所在月份再申报。`);
      L.push('');
    }
  }
  if (warnings.length) {
    L.push('## 附：数据提示');
    L.push('');
    for (const w of warnings) L.push(`- ${w}`);
    L.push('');
  }
  L.push(`> ${DECL}。`);
  L.push('');
  fs.writeFileSync(path.join(outDir, '需求汇总.md'), L.join('\n'), 'utf8');

  C.emitOk(outDir, { ok: true, out: outDir, workshop: a.workshop, period, counts, warnings });
}

try { main(); } catch (e) { C.fail(e, warnings); }
