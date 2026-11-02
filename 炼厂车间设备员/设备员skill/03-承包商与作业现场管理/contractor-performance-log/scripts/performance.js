#!/usr/bin/env node
'use strict';
/**
 * 承包商表现记录脚本（仅 Node.js 内置模块）
 * 用法：node "<技能目录>/scripts/performance.js" --input <检查记录xlsx> --workshop "常减压车间" --from 2026-07-01 --to 2026-09-21 [--out <dir>]
 *       [--rules <厂内评分口径xlsx>] [--contractor <承包商名称>] [--orders <工单台账xlsx>] [--roster <承包商名单xlsx>]
 * 产出：<out>/performance.json、<out>/performance.md、<out>/summary.json；末行打印 JSON 摘要
 *
 * 硬口径（不得放宽）：
 *   - 承包商名称拼写不一致（全称/简称混用）→ nameAmbiguity 列出疑似同一单位的名称组供用户确认，**绝不自动合并统计**
 *   - 严重程度为空或无法归类 → undetermined 不计分并单列，**绝不按最低档计分**
 *   - 未提供厂内口径表时，产出中明确标注「采用默认口径，非厂内正式口径，结果仅供参考」
 *   - 评价说明只陈述记录事实，不得使用「该队伍能力差」「不建议再用」这类定性判断
 *   - 声明行固定写入，不得删除或改写
 */
const fs = require('fs');
const path = require('path');
const { readXlsx, readCsvDir } = require('./lib/xlsx-lite');
const C = require('./lib/common');

const warnings = [];
const VALUE_OPTS = ['input', 'workshop', 'from', 'to', 'out', 'rules', 'contractor', 'orders', 'roster'];
const FLAG_OPTS = ['help'];

const DISCLAIMER = '本数据为车间（属地单位）侧记录汇总，承包商考核由安全环保部门归口、业务主管部门配合，分档定性与处罚按厂内制度决定；评分口径若非厂内正式口径，结果仅供参考';

/** 列名别名：局部 + 共享 SYSTEM_ALIASES（承包商管理平台 / SAP 供应商编码 / 作业许可系统列名），局部优先 */
const ALIASES = C.mergeAliases({
  '记录日期': ['记录日期', '检查日期', '日期', '发生日期', '检查时间', '记录时间', '登记日期'],
  '承包商': ['承包商', '承包商名称', '施工单位', '施工队', '队伍', '作业单位', '外来单位', '单位名称', '乙方', '作业单位名称', '承修单位'],
  '承包商编码': ['承包商编码', '供应商编码', '承包商代码', '供应商代码', '单位编码', '供应商'],
  '项目': ['项目', '项目名称', '作业项目', '工程名称', '施工项目', '作业内容', '工程'],
  '类型': ['类型', '记录类型', '问题类型', '违章类型', '扣分类型', '维度', '分类'],
  '事项描述': ['事项描述', '描述', '问题描述', '事项', '情况描述', '违章内容', '内容', '事实描述'],
  '严重程度': ['严重程度', '程度', '违章等级', '等级', '严重性', '级别', '问题等级'],
  '整改情况': ['整改情况', '整改状态', '整改结果', '处理情况', '整改', '闭环情况'],
  // 「监护人」是作业票的双监护角色（属地监护人/作业单位监护人），不是检查人，不作别名
  '检查人': ['检查人', '检查人员', '记录人', '发现人', '检查者', '属地检查人'],
  '类型名称': ['类型名称', '类型', '维度', '扣分项', '记录类型'],
  '程度名称': ['程度名称', '严重程度', '程度', '等级', '违章等级'],
  '扣分': ['扣分', '扣分值', '分值', '扣分分值', '分数'],
  '基准分': ['基准分', '起评分', '初始分', '满分'],
  '承包商名称': ['承包商名称', '承包商', '施工单位', '单位名称', '队伍名称'],
  '简称': ['简称', '缩写', '别名', '常用简称'],
  '工单号': ['工单号', '工单编号', '编号', '单号'],
  '完成情况': ['完成情况', '履约情况', '进度情况', '完工情况'],
  '分档': ['分档', '分档名称', '档次', '等级名称'],
  '最低分': ['最低分', '下限', '起始分', '分数下限'],
});

// ---------------------------------------------------------------- 四个维度归一
// 安全违章 / 施工质量 / 进度履约 / 现场配合与文明施工。无法归类 → null（进 undetermined，绝不猜）
const DIM_SAFETY = ['安全违章', '安全', '违章', '违规', 'HSE', '安全问题', '三违'];
const DIM_QUALITY = ['施工质量', '质量', '返工', '工程质量', '质量问题'];
const DIM_SCHEDULE = ['进度履约', '进度', '履约', '工期', '延期', '进度问题'];
const DIM_COOP = ['现场配合', '配合', '文明施工', '文明', '现场管理', '协调', '配合度'];
function classifyDim(v) {
  const s = C.str(v).replace(/\s/g, '');
  if (s === '' || s === '—' || s === '-' || s === '/') return null;
  if (DIM_SAFETY.some((k) => s.includes(k))) return 'safety';
  if (DIM_QUALITY.some((k) => s.includes(k))) return 'quality';
  if (DIM_SCHEDULE.some((k) => s.includes(k))) return 'schedule';
  if (DIM_COOP.some((k) => s.includes(k))) return 'cooperation';
  return 'unknown';
}
const DIM_CN = { safety: '安全违章', quality: '施工质量', schedule: '进度履约', cooperation: '现场配合与文明施工', unknown: '类型无法识别', null: '类型缺失' };
const DIM_ORDER = ['safety', 'quality', 'schedule', 'cooperation'];

// ---------------------------------------------------------------- 严重程度归一（按维度分别取值）
// 注意：不同维度的程度枚举不同，统一归一为 severity key，再查该维度的扣分表
const SEV_MAP = {
  // 中石化口径：一般违章 / 严重违章 / 重大违章；"严重违规"归严重违章（不是重大）
  safety: [
    ['major', ['重大违章', '重大', '重大违规', 'A类违章', 'A级']],
    ['serious', ['严重违章', '严重', '严重违规', '较大', 'B类违章', 'B级']],
    ['minor', ['一般违章', '一般', '轻微', '普通', 'C类违章', 'C级']],
  ],
  quality: [
    // "不符合"（不符合项）不自动归质量不合格：可能只是记录用语，由用户明确是返工还是不合格
    ['unqualified', ['质量不合格', '不合格', '质量事故', '验收不合格']],
    ['rework', ['返工', '返修', '整改返工', '重做']],
  ],
  schedule: [
    ['seriousDelay', ['严重延期', '严重滞后', '重大延期', '严重误期']],
    ['delay', ['延期', '滞后', '误期', '未按期', '拖期', '进度滞后']],
  ],
  cooperation: [
    ['uncooperative', ['不配合', '拒不配合', '拒绝配合', '对抗', '不服从']],
    ['poorHousekeeping', ['文明施工差', '文明施工', '现场脏乱', '脏乱', '料具乱堆', '卫生差']],
  ],
};
/** 返回 severity key；空 → null（未填）；有填写但无法归类 → 'unknown'（"不符合"也在此列，不自动归质量不合格） */
function classifySeverity(dim, v) {
  const s = C.str(v).replace(/\s/g, '');
  if (s === '' || s === '—' || s === '-' || s === '/') return null;
  const table = SEV_MAP[dim];
  if (!table) return 'unknown';
  for (const [key, kws] of table) if (kws.some((k) => s.includes(k))) return key;
  return 'unknown';
}
const SEV_CN = {
  major: '重大违章', serious: '严重违章', minor: '一般违章',
  unqualified: '质量不合格', rework: '返工',
  seriousDelay: '严重延期', delay: '延期',
  uncooperative: '不配合', poorHousekeeping: '文明施工差',
};

// ---------------------------------------------------------------- 默认评分口径
// references/evaluation-rules.md，**默认口径，非厂内正式口径**，--rules 可覆盖
const DEFAULT_BASE = 100;
const DEFAULT_DEDUCT = {
  safety: { minor: 2, serious: 5, major: 10 },
  quality: { rework: 3, unqualified: 5 },
  schedule: { delay: 2, seriousDelay: 5 },
  cooperation: { poorHousekeeping: 1, uncooperative: 3 },
};
// 分档：90+ 优、80-89 良、70-79 一般、70 以下 差
const DEFAULT_GRADES = [
  { min: 90, name: '优' },
  { min: 80, name: '良' },
  { min: 70, name: '一般' },
  { min: null, name: '差' },
];
function gradeOf(score, grades) {
  if (score === null) return null;
  for (const g of grades) if (g.min === null || score >= g.min) return g.name;
  return grades[grades.length - 1].name;
}

// ---------------------------------------------------------------- 整改情况归一
const RECT_DONE = ['已整改', '整改完毕', '已完成', '已闭环', '完成', '已处理', '已改正', '已纠正'];
const RECT_NOT = ['未整改', '未完成', '未处理', '整改中', '待整改', '未闭环', '进行中', '未改'];
function classifyRect(v) {
  const s = C.str(v).replace(/\s/g, '');
  if (s === '' || s === '—' || s === '-' || s === '/') return null;
  if (RECT_NOT.some((k) => s.includes(k))) return false;
  if (RECT_DONE.some((k) => s.includes(k))) return true;
  return null;   // 无法归类 → 按未确认处理，并 warning
}

// ---------------------------------------------------------------- 承包商名称疑似重复识别
// 只识别、只提示，**绝不自动合并**
const COMPANY_NOISE = /(有限责任公司|股份有限公司|有限公司|公司|集团|分公司|工程处|工程公司|安装公司|检修公司|建安公司|工程队|施工队|队|部|厂|中心)$/g;
const GEO_PREFIX = /^(中国|中石化|中石油|华东|华北|华南|华中|西北|东北|西南)/;
/** 名称核：去掉常见后缀与地域前缀、去空白与标点 */
function nameCore(name) {
  let s = C.str(name).replace(/[\s()（）·.、,，"'"'—\-]/g, '');
  let prev;
  do { prev = s; s = s.replace(COMPANY_NOISE, ''); } while (s !== prev && s.length > 1);
  const noGeo = s.replace(GEO_PREFIX, '');
  return noGeo.length >= 2 ? noGeo : s;
}
/** 名称对的稳定键：与顺序无关，用于去重与比对 */
function pairKey(a, b) { return [C.str(a), C.str(b)].sort().join(' || '); }
/** 判定两个名称是否疑似同一单位：核相同，或一方的核是另一方的核的子串（长度≥2） */
function suspectSame(a, b) {
  const ca = nameCore(a), cb = nameCore(b);
  if (!ca || !cb) return null;
  if (ca === cb) return '规范化后名称核一致（去公司后缀与地域前缀）';
  if (ca.length >= 2 && cb.length >= 2) {
    if (ca.includes(cb)) return `「${b}」的名称核「${cb}」是「${a}」名称核「${ca}」的子串，疑似简称`;
    if (cb.includes(ca)) return `「${a}」的名称核「${ca}」是「${b}」名称核「${cb}」的子串，疑似简称`;
  }
  return null;
}

function loadBook(p) {
  const st = fs.statSync(p);
  return st.isDirectory() ? readCsvDir(p) : readXlsx(p);
}

function main() {
  const a = C.parseArgs(process.argv.slice(2), VALUE_OPTS, FLAG_OPTS);
  if (!a.input) throw new Error('缺少 --input');
  if (!a.workshop) throw new Error('缺少 --workshop');
  if (!a.from) throw new Error('缺少 --from');
  if (!a.to) throw new Error('缺少 --to');
  const from = C.normDate(a.from);
  if (!from) throw new Error(`--from 「${a.from}」不是有效日期，应为 YYYY-MM-DD`);
  const to = C.normDate(a.to);
  if (!to) throw new Error(`--to 「${a.to}」不是有效日期，应为 YYYY-MM-DD`);
  if (C.diffDays(from, to) > 0) throw new Error(`--from ${from} 晚于 --to ${to}`);
  if (!fs.existsSync(a.input)) throw new Error(`输入不存在: ${a.input}`);
  const outDir = a.out || path.join(path.dirname(a.input), 'cpl-out');

  // ---- 评分口径：默认 + --rules 覆盖
  const base = { value: DEFAULT_BASE };
  const deduct = JSON.parse(JSON.stringify(DEFAULT_DEDUCT));
  const grades = DEFAULT_GRADES.map((g) => ({ ...g }));
  let gradesSource = '默认分档（references/evaluation-rules.md）';
  let rulesSource = '默认口径（references/evaluation-rules.md）';
  let isDefaultRules = true;
  if (a.rules) {
    if (!fs.existsSync(a.rules)) throw new Error(`评分口径文件不存在: ${a.rules}`);
    let rb;
    try { rb = loadBook(a.rules); } catch (e) { throw new Error(`评分口径文件读取失败 ${a.rules}: ${e.message}`); }
    const rr = C.pickSheet(rb, '评分口径', '扣分标准', '评分标准', '口径');
    if (!rr) warnings.push(`评分口径文件「${path.basename(a.rules)}」中未找到「评分口径」工作表，仍按默认口径`);
    else {
      const recs = C.toRecords(rr, ['类型名称', '程度名称', '扣分'], '评分口径', ['基准分'], warnings, ALIASES);
      const num = C.makeNum(warnings);
      let hit = 0;
      for (const r of recs) {
        const bs = num(r['基准分'], { sheet: '评分口径', row: r._row, col: '基准分' });
        if (bs !== null) base.value = bs;
        const dim = classifyDim(r['类型名称']);
        if (dim !== 'safety' && dim !== 'quality' && dim !== 'schedule' && dim !== 'cooperation') {
          warnings.push(`工作表「评分口径」第${r._row}行 类型「${C.str(r['类型名称'])}」无法归入四个维度，已忽略`);
          continue;
        }
        const sev = classifySeverity(dim, r['程度名称']);
        if (sev === null || sev === 'unknown') {
          warnings.push(`工作表「评分口径」第${r._row}行 严重程度「${C.str(r['程度名称'])}」在维度「${DIM_CN[dim]}」下无法归类，已忽略`);
          continue;
        }
        const d = num(r['扣分'], { sheet: '评分口径', row: r._row, col: '扣分' });
        if (d === null) { warnings.push(`工作表「评分口径」第${r._row}行 扣分「${C.str(r['扣分'])}」无法解析为数字，已忽略`); continue; }
        deduct[dim][sev] = Math.abs(d);
        hit++;
      }
      if (hit) { rulesSource = `厂内口径（${path.basename(a.rules)}）`; isDefaultRules = false; }
      else warnings.push(`评分口径文件「${path.basename(a.rules)}」中无可用的扣分行，仍按默认口径`);
    }
    // 分档标准（可选工作表「分档标准」：分档 / 最低分；最低分为空的一行为最低档）
    const gr = C.pickSheet(rb, '分档标准', '分档');
    if (gr) {
      const grecs = C.toRecords(gr, ['分档'], '分档标准', ['最低分'], warnings, ALIASES);
      const num = C.makeNum(warnings);
      const list = [];
      for (const r of grecs) {
        const name = C.str(r['分档']);
        if (!name) continue;
        const mn = num(r['最低分'], { sheet: '分档标准', row: r._row, col: '最低分' });
        list.push({ min: mn, name });
      }
      const bottom = list.filter((x) => x.min === null);
      if (list.length >= 2 && bottom.length <= 1) {
        const sorted = list.filter((x) => x.min !== null).sort((x, y) => y.min - x.min);
        if (bottom.length) sorted.push(bottom[0]);
        else sorted[sorted.length - 1] = { min: null, name: sorted[sorted.length - 1].name };
        grades.length = 0; grades.push(...sorted);
        gradesSource = `厂内分档（${path.basename(a.rules)}）`;
      } else warnings.push(`评分口径文件「${path.basename(a.rules)}」的「分档标准」工作表不足两档或多行最低分为空，仍按默认分档`);
    }
  }
  // 口径提示语：未提供厂内口径时必须出现在产出中
  const rulesNotice = isDefaultRules
    ? '采用默认口径，非厂内正式口径，结果仅供参考'
    : `采用厂内口径（${path.basename(a.rules)}）`;

  // ---- 承包商名单（可选）：仅用于标注「名单外单位」，不做名称合并
  const roster = [];
  if (a.roster) {
    if (!fs.existsSync(a.roster)) throw new Error(`承包商名单文件不存在: ${a.roster}`);
    let rb;
    try { rb = loadBook(a.roster); } catch (e) { throw new Error(`承包商名单读取失败 ${a.roster}: ${e.message}`); }
    const rr = C.pickSheet(rb, '承包商名单', '承包商', '名单', '单位名单');
    if (!rr) warnings.push(`承包商名单「${path.basename(a.roster)}」中未找到「承包商名单」工作表，已忽略`);
    else {
      const recs = C.toRecords(rr, ['承包商名称'], '承包商名单', ['简称', '承包商编码'], warnings, ALIASES);
      for (const r of recs) {
        const full = C.str(r['承包商名称']);
        if (!full) continue;
        roster.push({ full, alias: C.str(r['简称']) || null, code: C.str(r['承包商编码']) || null, row: r._row });
      }
    }
  }

  // ---- 工单台账（可选）：关联质量与进度数据，仅作补充展示，不改变评分
  let orderStats = null;
  if (a.orders) {
    if (!fs.existsSync(a.orders)) throw new Error(`工单台账不存在: ${a.orders}`);
    let ob;
    try { ob = loadBook(a.orders); } catch (e) { throw new Error(`工单台账读取失败 ${a.orders}: ${e.message}`); }
    const or = C.pickSheet(ob, '工单台账', '工单', '施工台账', '作业台账');
    if (!or) warnings.push(`工单台账「${path.basename(a.orders)}」中未找到「工单台账」工作表，已忽略`);
    else {
      const recs = C.toRecords(or, ['工单号', '承包商'], '工单台账', ['项目', '完成情况'], warnings, ALIASES);
      orderStats = {};
      for (const r of recs) {
        const cn = C.str(r['承包商']);
        if (!cn) { warnings.push(`工作表「工单台账」第${r._row}行 承包商为空，已跳过`); continue; }
        if (!orderStats[cn]) orderStats[cn] = { contractor: cn, orders: 0, done: 0, undone: 0, unknown: 0 };
        const st = orderStats[cn];
        st.orders++;
        const rc = classifyRect(r['完成情况']);
        if (rc === true) st.done++;
        else if (rc === false) st.undone++;
        else st.unknown++;
      }
      orderStats = Object.values(orderStats).sort((x, y) => y.orders - x.orders);
    }
  }

  // ---- 读取检查记录 / 违章记录
  let book;
  try { book = loadBook(a.input); } catch (e) { throw new Error(`读取失败 ${a.input}: ${e.message}`); }
  const rows = C.pickSheet(book, '检查记录', '违章记录', '现场检查记录', '承包商检查记录', '记录');
  if (!rows) throw new Error('未在输入中找到「检查记录」或「违章记录」工作表');
  const sheetName = '检查记录';
  const recs = C.toRecords(rows, ['记录日期', '承包商', '类型', '事项描述'], sheetName,
    ['项目', '严重程度', '整改情况', '检查人', '承包商编码'], warnings, ALIASES);
  const hasCodeCol = recs.hasCol('承包商编码');

  // ---- 逐条判定
  const items = [];
  for (const r of recs) {
    const contractor = C.str(r['承包商']);
    const code = C.str(r['承包商编码']);
    const desc = C.str(r['事项描述']);
    if (!contractor && !code && !desc) { warnings.push(`工作表「${sheetName}」第${r._row}行 承包商与事项描述均为空，已跳过`); continue; }
    if (!contractor && !code) { warnings.push(`工作表「${sheetName}」第${r._row}行 承包商为空，该条无法归属到具体单位，已单列为「（未填承包商）」`); }

    const date = C.normDate(r['记录日期']);
    if (r['记录日期'] && !date) warnings.push(`工作表「${sheetName}」第${r._row}行 记录日期「${C.str(r['记录日期'])}」无法解析`);

    const rawDim = C.str(r['类型']);
    const dim = classifyDim(r['类型']);
    if (dim === 'unknown') warnings.push(`工作表「${sheetName}」第${r._row}行 类型「${rawDim}」无法归入安全违章/施工质量/进度履约/现场配合四个维度，按未判定处理`);

    const rawSev = C.str(r['严重程度']);
    const sev = (dim === 'safety' || dim === 'quality' || dim === 'schedule' || dim === 'cooperation')
      ? classifySeverity(dim, r['严重程度']) : null;
    if (dim && dim !== 'unknown' && rawSev && sev === 'unknown') {
      warnings.push(`工作表「${sheetName}」第${r._row}行 严重程度「${rawSev}」在维度「${DIM_CN[dim]}」下无法归类，按未判定处理，未按最低档计分${dim === 'quality' && /不符合/.test(rawSev) ? '；「不符合」不自动归质量不合格，请明确是返工还是质量不合格' : ''}`);
    }
    if (dim && dim !== 'unknown' && sev === null) {
      warnings.push(`工作表「${sheetName}」第${r._row}行 严重程度为空（维度：${DIM_CN[dim]}），按未判定处理，未按最低档计分`);
    }

    const rawRect = C.str(r['整改情况']);
    const rectified = classifyRect(r['整改情况']);
    if (rawRect && rectified === null) warnings.push(`工作表「${sheetName}」第${r._row}行 整改情况「${rawRect}」无法归类，按未确认整改处理`);

    const it = {
      date, contractor: contractor || (code ? `（编码 ${code}）` : '（未填承包商）'), rawContractor: contractor, code: code || null,
      groupKey: code ? `code:${code}` : (contractor || '（未填承包商）'),
      project: C.str(r['项目']), rawDim, dim, dimCn: DIM_CN[String(dim)],
      rawSev, sev, sevCn: sev && sev !== 'unknown' ? SEV_CN[sev] : (sev === 'unknown' ? '程度无法识别' : '程度未填'),
      desc, rawRect, rectified, inspector: C.str(r['检查人']),
      row: r._row, sheet: sheetName,
      deduction: null, undetReason: null, inRange: null,
    };

    // ---- 区间判定：日期缺失时保留并 warning，不臆断
    if (!date) {
      it.inRange = null;
      warnings.push(`工作表「${sheetName}」第${r._row}行 记录日期缺失，无法判断是否在评价区间内，已保留并单列`);
    } else {
      it.inRange = C.diffDays(date, from) >= 0 && C.diffDays(date, to) <= 0;
      if (!it.inRange) warnings.push(`工作表「${sheetName}」第${r._row}行 记录日期 ${date} 不在评价区间 ${from} 至 ${to} 内，未计入本期统计`);
    }

    // ---- 扣分判定：维度与严重程度俱全才计分；否则 undetermined，绝不按最低档
    if (dim === null) it.undetReason = '记录类型缺失，无法归入四个维度，扣分无法确定';
    else if (dim === 'unknown') it.undetReason = `记录类型「${rawDim}」无法归入四个维度，扣分无法确定`;
    else if (sev === null) it.undetReason = `严重程度为空（维度：${DIM_CN[dim]}），扣分无法确定，未按最低档计分`;
    else if (sev === 'unknown') it.undetReason = `严重程度「${rawSev}」在维度「${DIM_CN[dim]}」下无法归类，扣分无法确定，未按最低档计分`;
    else {
      const d = deduct[dim][sev];
      if (d === null || d === undefined) it.undetReason = `维度「${DIM_CN[dim]}」的「${SEV_CN[sev]}」在评分口径中无对应扣分值，扣分无法确定`;
      else it.deduction = d;
    }

    items.push(it);
  }

  if (!items.length) throw new Error(`「${sheetName}」中无有效记录`);

  // ---- 区间过滤：区间外剔除；日期缺失单列 outOfRange 之外的 noDate
  const inRange = items.filter((x) => x.inRange === true);
  const outOfRange = items.filter((x) => x.inRange === false);
  const noDate = items.filter((x) => x.inRange === null);
  // 日期缺失项：不计入评分（区间归属不明），单列
  for (const x of noDate) { if (!x.undetReason) x.undetReason = '记录日期缺失，无法确认是否属于本评价区间，未计入评分'; x.deduction = null; }

  const scored = inRange;   // 仅区间内记录参与评分

  // ---- 承包商名称疑似重复（关键口径：只提示，不合并）
  // 有承包商编码的记录按编码分组，名称仅展示，不参与名称疑似重复比对
  const namesInScope = [...new Set(scored.concat(noDate).filter((x) => !x.code).map((x) => x.contractor).filter((n) => n && n !== '（未填承包商）'))];
  const codedRecords = scored.concat(noDate).filter((x) => x.code).length;
  if (hasCodeCol && codedRecords) warnings.push(`「承包商编码」列已命中：${codedRecords} 条记录按编码分组统计，同一编码下的不同名称写法视为同一单位（名称仅展示）；无编码的记录仍按名称分组`);
  const rosterNames = roster.map((x) => x.full).concat(roster.map((x) => x.alias).filter(Boolean));
  const allNames = [...new Set(namesInScope.concat(rosterNames))];
  // 承包商名单中已声明的「全称 ↔ 简称」是确定的对应关系，本身不构成待确认的歧义；
  // 但只要记录里两种写法都实际出现过，仍要提示（记录混用了写法），脚本依旧不合并统计
  const rosterPairs = new Set();
  for (const x of roster) if (x.alias) rosterPairs.add(pairKey(x.full, x.alias));
  const usedInRecords = new Set(namesInScope);
  const nameAmbiguity = [];
  const pairSeen = new Set();
  for (let i = 0; i < allNames.length; i++) {
    for (let j = i + 1; j < allNames.length; j++) {
      const A = allNames[i], B = allNames[j];
      const reason = suspectSame(A, B);
      if (!reason) continue;
      const key = pairKey(A, B);
      // 名单已声明的「全称 ↔ 简称」对应关系，且记录中只用了其中一种写法 → 无混用，不提示
      if (rosterPairs.has(key) && !(usedInRecords.has(A) && usedInRecords.has(B))) continue;
      if (pairSeen.has(key)) continue;
      pairSeen.add(key);
      const cntA = scored.filter((x) => !x.code && x.contractor === A).length;
      const cntB = scored.filter((x) => !x.code && x.contractor === B).length;
      nameAmbiguity.push({
        names: [A, B], reason,
        records: { [A]: cntA, [B]: cntB },
        rows: {
          [A]: scored.concat(noDate).filter((x) => !x.code && x.contractor === A).map((x) => x.row),
          [B]: scored.concat(noDate).filter((x) => !x.code && x.contractor === B).map((x) => x.row),
        },
        note: '脚本未合并统计，两个名称各自单独成行；请人工确认是否为同一单位（或在源记录补填承包商编码）后，再由安全环保部门汇总',
      });
      warnings.push(`承包商名称「${A}」与「${B}」疑似同一单位（${reason}），脚本未自动合并，两者分别统计，请人工确认`);
    }
  }

  // ---- 逐家统计：按名称字面量分组，**绝不跨名称合并**
  const byName = new Map();
  const rosterCodes = roster.map((x) => x.code).filter(Boolean);
  for (const x of scored) {
    const k = x.groupKey;
    if (!byName.has(k)) {
      byName.set(k, {
        contractor: x.contractor, code: x.code, names: [], groupKey: k,
        inRoster: roster.length ? (x.code ? rosterCodes.includes(x.code) || rosterNames.includes(x.contractor) : rosterNames.includes(x.contractor)) : null,
        dims: { safety: { count: 0, deduction: 0, undetermined: 0 }, quality: { count: 0, deduction: 0, undetermined: 0 },
          schedule: { count: 0, deduction: 0, undetermined: 0 }, cooperation: { count: 0, deduction: 0, undetermined: 0 } },
        undeterminedCount: 0, unrectifiedCount: 0, records: 0,
        baseScore: base.value, deduction: 0, score: null, grade: null,
        nameAmbiguous: false,
      });
    }
    const g = byName.get(k);
    if (x.rawContractor && !g.names.includes(x.rawContractor)) g.names.push(x.rawContractor);
    g.records++;
    if (x.deduction !== null && x.dim && x.dim !== 'unknown') {
      g.dims[x.dim].count++;
      g.dims[x.dim].deduction += x.deduction;
      g.deduction += x.deduction;
    } else {
      g.undeterminedCount++;
      if (x.dim && x.dim !== 'unknown') g.dims[x.dim].undetermined++;
    }
    if (x.rectified === false) g.unrectifiedCount++;
  }
  // 名称疑似重复的单位打标，供 md 提示
  const ambiguousNames = new Set();
  for (const p of nameAmbiguity) for (const n of p.names) ambiguousNames.add(n);
  for (const [k, g] of byName) {
    g.deduction = C.round(g.deduction, 1);
    g.score = C.round(base.value - g.deduction, 1);
    g.grade = gradeOf(g.score, grades);
    g.nameAmbiguous = !g.code && ambiguousNames.has(g.contractor);
    if (g.code) { if (!g.names.length) g.names.push(g.contractor); g.contractor = g.names[0]; if (g.names.length > 1) warnings.push(`承包商编码 ${g.code} 下出现 ${g.names.length} 种名称写法（${g.names.join('、')}），已按编码合并为一行，名称以首次出现为准`); }
    for (const d of DIM_ORDER) g.dims[d].deduction = C.round(g.dims[d].deduction, 1);
  }
  let byContractor = [...byName.values()].sort((x, y) => (x.score === y.score ? x.contractor.localeCompare(y.contractor, 'zh') : x.score - y.score));

  // ---- --contractor 筛选（不影响名称待确认节的完整性）
  let contractorFilter = null;
  if (a.contractor) {
    contractorFilter = a.contractor;
    byContractor = byContractor.filter((g) => g.contractor === a.contractor || g.contractor.includes(a.contractor) || g.names.some((n) => n.includes(a.contractor)) || g.code === a.contractor);
  }
  const nameSet = new Set(byContractor.map((g) => g.groupKey));
  const viewItems = a.contractor ? scored.filter((x) => nameSet.has(x.groupKey)) : scored;

  // ---- 违章明细（安全违章维度，按严重程度分组）
  const violationItems = viewItems.filter((x) => x.dim === 'safety');
  const violations = {};
  for (const key of ['major', 'serious', 'minor', 'undetermined']) violations[key] = [];
  for (const x of violationItems) {
    const k = (x.sev === 'major' || x.sev === 'serious' || x.sev === 'minor') ? x.sev : 'undetermined';
    violations[k].push(slim(x));
  }

  // ---- 未整改项单列
  const unrectified = viewItems.filter((x) => x.rectified === false).map(slim);
  // ---- 未判定项（含日期缺失项）
  const undetermined = viewItems.filter((x) => x.undetReason)
    .concat(a.contractor ? noDate.filter((x) => nameSet.has(x.groupKey)) : noDate)
    .map((x) => ({ ...slim(x), reason: x.undetReason }));

  // ---- 计数
  const dimCounts = {};
  for (const d of DIM_ORDER) dimCounts[d] = viewItems.filter((x) => x.dim === d).length;
  const counts = {
    records: viewItems.length,
    contractors: byContractor.length,
    violations: violationItems.length,
    unrectified: unrectified.length,
    undetermined: undetermined.length,
    nameAmbiguity: nameAmbiguity.length,
    outOfRange: outOfRange.length,
    noDate: noDate.length,
    byDim: dimCounts,
  };

  // ---- 产出
  C.ensureDir(outDir);
  const perf = {
    meta: {
      workshop: a.workshop, from, to, generatedAt: C.localDateTime(),
      input: path.basename(a.input), rulesSource, gradesSource, isDefaultRules, rulesNotice,
      contractorFilter, groupedByCode: hasCodeCol && codedRecords > 0, disclaimer: DISCLAIMER,
      roster: a.roster ? path.basename(a.roster) : null,
      orders: a.orders ? path.basename(a.orders) : null,
    },
    counts,
    rules: { baseScore: base.value, deduct, grades, gradesSource, source: rulesSource, isDefault: isDefaultRules, notice: rulesNotice },
    byContractor, violations, unrectified, nameAmbiguity, undetermined,
    outOfRange: outOfRange.map(slim), orderStats,
    items: viewItems.map(slim), warnings,
  };
  fs.writeFileSync(path.join(outDir, 'performance.json'), JSON.stringify(perf, null, 2), 'utf8');

  // ---- performance.md
  const L = [];
  L.push(`# ${a.workshop} 承包商表现记录（${from} 至 ${to}）`);
  L.push('');
  if (isDefaultRules) {
    L.push('> 【注意】**口径提示**：本次评分**采用默认口径，非厂内正式口径，结果仅供参考**。默认口径见 `references/evaluation-rules.md`；如有厂内正式评分标准，请用 `--rules` 传入后重算（模板见 `assets/templates/rules-template.xlsx`）。');
    L.push('');
  } else {
    L.push(`> **口径提示**：本次评分采用厂内口径（${path.basename(a.rules)}）。`);
    L.push('');
  }
  if (nameAmbiguity.length) {
    L.push(`> 【注意】**名称待确认**：发现 ${nameAmbiguity.length} 组疑似同一单位的承包商名称，**脚本未作合并**，各名称分别统计，详见「五、承包商名称待确认」。合并与否须人工确认（或在源记录补填承包商编码后重跑）。`);
    L.push('');
  }
  L.push(`评价区间：${from} 至 ${to} ｜ 车间：${a.workshop}${contractorFilter ? ` ｜ 承包商筛选：${contractorFilter}` : ''}`);
  L.push(`评分口径：${rulesSource} ｜ 基准分 ${base.value} 分 ｜ 分档：${gradesSource}`);
  L.push(`报送对象：承包商考核由安全环保部门归口、业务主管部门配合；本记录为车间（属地单位）侧记录${hasCodeCol && codedRecords ? ' ｜ 分组方式：有承包商编码的记录按编码分组' : ''}`);
  L.push(`数据来源：${path.basename(a.input)}${a.orders ? ` ｜ 工单台账：${path.basename(a.orders)}` : ''}${a.roster ? ` ｜ 承包商名单：${path.basename(a.roster)}` : ''} ｜ 生成时间：${C.localDateTime()}（北京时间）`);
  L.push('');
  L.push(`**${DISCLAIMER}。**`);
  L.push('');

  L.push('## 一、评价区间与口径说明');
  L.push('');
  L.push(C.mdTable(['项目', '内容'], [
    ['评价区间', `${from} 至 ${to}`],
    ['记录条数（区间内）', counts.records],
    ['涉及承包商名称数', counts.contractors],
    ['口径来源', rulesSource],
    ['口径性质', rulesNotice],
    ['分档来源', gradesSource],
    ['基准分', base.value],
    ['区间外记录（未计入）', counts.outOfRange],
    ['日期缺失记录（未计分）', counts.noDate],
  ]));
  L.push(isDefaultRules ? '**默认扣分口径**（`--rules` 未传入时生效）' : '**扣分口径**（厂内口径覆盖后的生效值）');
  L.push('');
  L.push(C.mdTable(['维度', '情形', '扣分'],
    DIM_ORDER.flatMap((d) => Object.entries(deduct[d]).map(([sev, v]) => [DIM_CN[d], SEV_CN[sev] || sev, v]))));
  L.push('**分档标准**');
  L.push('');
  L.push(C.mdTable(['分档', '得分区间'], grades.map((g, i) => {
    const upper = i === 0 ? '100 及以上' : `${grades[i - 1].min - 1}`;
    return [g.name, g.min === null ? `${grades[i - 1].min} 分以下` : (i === 0 ? `${g.min} 分及以上` : `${g.min} ~ ${grades[i - 1].min - 1} 分`)];
  })));

  L.push('## 二、各承包商得分汇总');
  L.push('');
  if (isDefaultRules) { L.push('_下表得分**采用默认口径，非厂内正式口径，结果仅供参考**；正式考核、分档定性与处罚由安全环保部门归口按厂内制度决定。_'); L.push(''); }
  L.push(C.mdTable(['承包商（按记录填写的名称）', '承包商编码', '记录数', '安全违章扣分', '施工质量扣分', '进度履约扣分', '现场配合扣分', '扣分合计', '得分', '分档', '未判定条数', '未整改条数', '名称待确认'],
    byContractor.map((g) => [g.names.length > 1 ? g.names.join(' / ') : g.contractor, g.code || '—', g.records,
      g.dims.safety.deduction, g.dims.quality.deduction, g.dims.schedule.deduction, g.dims.cooperation.deduction,
      g.deduction, g.score, g.grade, g.undeterminedCount, g.unrectifiedCount, g.nameAmbiguous ? '是（见第五节）' : '—'])));
  L.push('_「未判定条数」为严重程度或类型缺失、未参与扣分的记录条数；这些记录**未按最低档计分**，见「六、未判定记录」。_');
  L.push('');

  L.push('## 三、违章明细');
  L.push('');
  L.push('_按严重程度分组列出安全违章维度的记录。_');
  L.push('');
  for (const [key, title] of [['major', '重大违章'], ['serious', '严重违章'], ['minor', '一般违章'], ['undetermined', '严重程度未判定']]) {
    L.push(`**${title}（${violations[key].length} 条）**`);
    L.push('');
    L.push(C.mdTable(['记录日期', '承包商', '项目', '事项描述', '严重程度（原文）', '扣分', '整改情况', '检查人', '出处'],
      violations[key].map((x) => [x.date || '—', x.contractor, x.project || '—', x.desc || '—', x.rawSev || '（空）',
        x.deduction === null ? '—（未计分）' : x.deduction, x.rawRect || '（空）', x.inspector || '—', `${x.sheet} 第${x.row}行`])));
  }

  L.push('## 四、未整改项');
  L.push('');
  L.push('_整改情况填报为未整改 / 整改中的记录，须继续跟踪至整改闭环。_');
  L.push('');
  L.push(C.mdTable(['记录日期', '承包商', '维度', '严重程度', '事项描述', '整改情况（原文）', '检查人', '出处'],
    unrectified.map((x) => [x.date || '—', x.contractor, x.dimCn, x.sevCn, x.desc || '—', x.rawRect || '（空）', x.inspector || '—', `${x.sheet} 第${x.row}行`])));

  L.push('## 五、承包商名称待确认');
  L.push('');
  L.push('_同一单位可能以全称与简称混用登记。脚本仅列出疑似同一单位的名称组，**未作任何合并统计**；是否为同一单位须人工确认后，由安全环保部门在汇总时处理。有「承包商编码」的记录已按编码分组，不在此列。_');
  L.push('');
  if (!nameAmbiguity.length) {
    L.push('_本期未发现疑似重复的承包商名称。_\n');
  } else {
    L.push(C.mdTable(['疑似同一单位的名称', '各自记录条数', '疑似依据', '处理方式'],
      nameAmbiguity.map((p) => [p.names.map((n) => `「${n}」`).join(' 与 '),
        p.names.map((n) => `${n}：${p.records[n] === undefined ? 0 : p.records[n]} 条`).join('；'),
        p.reason, p.note])));
  }

  L.push('## 六、未判定记录');
  L.push('');
  L.push('_严重程度或记录类型缺失、或日期无法确认归属区间的记录，**不计分、不按最低档处理**，须补齐字段后重新统计。_');
  L.push('');
  L.push(C.mdTable(['记录日期', '承包商', '类型（原文）', '严重程度（原文）', '事项描述', '未判定原因', '出处'],
    undetermined.map((x) => [x.date || '（空）', x.contractor, x.rawDim || '（空）', x.rawSev || '（空）', x.desc || '—', x.reason, `${x.sheet} 第${x.row}行`])));

  if (orderStats) {
    L.push('## 七、工单履约情况（参考）');
    L.push('');
    L.push('_来自工单台账，仅作参考展示，**不参与评分**。_');
    L.push('');
    L.push(C.mdTable(['承包商（工单台账填写的名称）', '工单数', '已完成', '未完成', '完成情况未填'],
      orderStats.map((s) => [s.contractor, s.orders, s.done, s.undone, s.unknown])));
  }

  L.push(`## ${orderStats ? '八' : '七'}、评价说明`);
  L.push('');
  L.push('<!-- ANALYSIS_START -->');
  L.push('（由模型依据 references/evaluation-rules.md 口径撰写 250~400 字，结构：评价区间与口径 → 各承包商记录与得分情况 → 违章记录情况 → 未整改项 → 名称待确认与未判定项 → 提请安全环保部门/业务主管部门核实事项。');
  L.push('**只陈述记录事实，不得使用「该队伍能力差」「不建议再用」这类定性判断**；分值、条数一律引用 performance.json。）');
  L.push('<!-- ANALYSIS_END -->');
  L.push('');
  if (warnings.length) {
    L.push('## 附：数据提示');
    L.push('');
    for (const w of warnings) L.push(`- ${w}`);
    L.push('');
  }
  L.push('---');
  L.push('');
  L.push(`**${DISCLAIMER}。**`);
  L.push('');
  fs.writeFileSync(path.join(outDir, 'performance.md'), L.join('\n'), 'utf8');

  C.emitOk(outDir, {
    ok: true, out: outDir, from, to, workshop: a.workshop,
    counts, rulesSource, gradesSource, isDefaultRules, rulesNotice, groupedByCode: hasCodeCol && codedRecords > 0, warnings,
  });
}

function slim(x) {
  return {
    date: x.date, contractor: x.contractor, rawContractor: x.rawContractor, code: x.code, project: x.project,
    dim: x.dim, dimCn: x.dimCn, rawDim: x.rawDim,
    sev: x.sev, sevCn: x.sevCn, rawSev: x.rawSev,
    desc: x.desc, deduction: x.deduction,
    rectified: x.rectified, rawRect: x.rawRect, inspector: x.inspector,
    undetReason: x.undetReason || null, inRange: x.inRange,
    sheet: x.sheet, row: x.row,
  };
}

try { main(); } catch (e) { C.fail(e, warnings); }
