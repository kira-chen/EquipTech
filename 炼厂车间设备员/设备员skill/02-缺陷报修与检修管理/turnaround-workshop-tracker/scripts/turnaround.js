#!/usr/bin/env node
'use strict';
/**
 * 大检修车间侧项目跟踪脚本（仅 Node.js 内置模块，中石化炼化厂口径）
 * 用法：node "<技能目录>/scripts/turnaround.js" --input <xlsx|csv目录> --workshop "常减压车间" \
 *       --project "2026年装置大检修" --date 2026-09-21 --start 2026-09-10 --end 2026-10-10 [--out <dir>]
 *       [--prev <上一日 progress.json>] [--critical "T-01,T-05"] [--lag-days 1] [--linear-check]
 * 产出：<out>/progress.json、progress.md、进度表.xlsx、summary.json；末行打印 JSON 摘要
 *
 * 硬约束：
 *  - 完成比例与状态矛盾 → inconsistent 单列 + warning，**绝不自行修正任一字段**
 *  - 完成比例为空 → null（显示 —），按状态给定性进度，**绝不按 0 或按工期线性推算填补**
 *  - 完成比例超出 0~100 → warning + 置 null，**不截断到合理范围**
 *  - 项目状态七态：未开工 / 施工中 / 已完工 / 已中交 / 已开工 / 已中止 / 取消；「已中交」「已开工」是大检修独立节点，≠ 已完工
 *  - 滞后类型③（完成比例落后应有进度，按计划节点线性推算）只在 --linear-check 启用时判定，默认只判①②
 *  - 三查四定问题（可选表）单独成节：四定不全、超期未关闭、关闭状态未判定均单列，不按已关闭默认
 *  - 滞后影响工期的判断一律附「基于计划节点测算，最终以指挥部判定为准」
 */
const fs = require('fs');
const path = require('path');
const { readXlsx, readCsvDir, writeXlsx } = require('./lib/xlsx-lite');
const C = require('./lib/common');

const warnings = [];
const num = C.makeNum(warnings);
const VALUE_OPTS = ['input', 'workshop', 'project', 'date', 'start', 'end', 'out', 'prev', 'critical', 'lag-days'];
const FLAG_OPTS = ['linear-check', 'help'];

/** 免责声明：滞后影响工期的判断必须原样带出，不得删改 */
const DISCLAIMER = '滞后天数与工期影响均基于计划节点测算，最终以指挥部判定为准。';

// 局部别名优先，再并入共享系统别名（SAP PM 工单导出：订单号 / 订单描述 / 功能位置 / 基本开始日期 / 基本结束日期 / 主工作中心 / 用户状态）
// 注意：局部不再把「设备编号」作为位号别名——SAP 设备编号与功能位置分列
const ALIASES = C.mergeAliases({
  // 项目清单
  '项目编号': ['项目编号', '编号', '项目号', '检修项目编号', '序号编码', '订单号', '订单', '工单号', '工单编号', 'ID', 'id'],
  '项目名称': ['项目名称', '名称', '检修项目', '项目', '作业项目', '订单描述', '工单描述', '订单短文本'],
  '位号': ['位号', '设备位号', '装置位号', '功能位置', 'TAG', 'tag'],
  '专业': ['专业', '专业类别', '所属专业', '工种'],
  '计划开工': ['计划开工', '计划开工日期', '计划开始', '计划开始日期', '计划开工时间', '基本开始日期', '要求开始'],
  '计划完工': ['计划完工', '计划完工日期', '计划完成', '计划完成日期', '计划完工时间', '基本结束日期', '要求结束'],
  '实际开工': ['实际开工', '实际开工日期', '实际开始', '开工日期', '实际开工时间', '实际开始日期'],
  '实际完工': ['实际完工', '实际完工日期', '实际完成', '完工日期', '实际完工时间', '实际结束日期', '技术完成日期'],
  '工期': ['工期', '工期(天)', '计划工期', '计划工期(天)', '天数', '作业天数'],
  '施工单位': ['施工单位', '承修单位', '承包商', '施工队伍', '外委单位', '承建单位', '主工作中心', '工作中心', '作业单位'],
  '责任人': ['责任人', '负责人', '项目负责人', '主管', '监护人', '项目经理'],
  '状态': ['状态', '项目状态', '进度状态', '当前状态', '施工状态', '用户状态'],
  '完成比例': ['完成比例', '完成率', '进度', '进度比例', '形象进度', '完成百分比', '完成%'],
  '备注': ['备注', '说明', '滞后原因', '情况说明', '原因'],
  // 材料到货
  '材料名称': ['材料名称', '材料', '物资名称', '备件名称', '物料描述', '名称'],
  '需求数量': ['需求数量', '需求量', '计划数量', '需用量'],
  '到货数量': ['到货数量', '到货量', '已到数量', '实到数量'],
  '需求日期': ['需求日期', '需用日期', '要求到货日期', '计划到货'],
  '到货状态': ['到货状态', '状态', '物资状态', '到货情况'],
  // 人员到位
  '计划人数': ['计划人数', '计划人员', '需求人数', '计划投入'],
  '到位人数': ['到位人数', '实到人数', '在场人数', '实际人数'],
  // 开工条件
  '条件项': ['条件项', '条件', '开工条件', '检查项', '条件名称'],
  '是否具备': ['是否具备', '具备情况', '条件状态', '是否满足', '结论'],
  '责任单位': ['责任单位', '负责单位', '归口单位', '落实单位'],
  // 三查四定问题
  '问题编号': ['问题编号', '问题号', '序号', '编号'],
  '问题描述': ['问题描述', '问题', '问题内容', '检查发现', '存在问题'],
  '问题类别': ['问题类别', '类别', '问题类型', '查项', '检查类别'],
  '整改措施': ['整改措施', '措施', '定措施', '整改任务', '定任务', '处理措施'],
  '整改期限': ['整改期限', '定时间', '完成期限', '期限', '要求完成时间', '计划完成日期'],
  '整改状态': ['整改状态', '状态', '是否关闭', '关闭状态', '整改情况', '完成情况'],
});

// ---- 项目状态枚举（七态；取值不在枚举内一律单列，不得就近映射）
// 已中交 = 中间交接（检修完工后交付工艺，≠ 已完工）；已开工 = 中交后装置/设备开工（开车投用）
const STATUS_ENUM = ['未开工', '施工中', '已完工', '已中交', '已开工', '已中止', '取消'];
const STATUS_SYNONYM = {
  '未开工': ['未开工', '未开始', '待开工', '未启动', '计划中', '未施工', '待施工'],
  '施工中': ['施工中', '在施工', '进行中', '检修中', '作业中', '在建', '实施中', '已开始施工'],
  '已完工': ['已完工', '完工', '已完成', '完成', '已交付', '施工完工', '检修完工'],
  '已中交': ['已中交', '中交', '中间交接', '已中间交接', '已交工艺'],
  '已开工': ['已开工', '已开车', '已投用', '已投料', '开车', '已复产', '已投运'],
  '已中止': ['已中止', '中止', '暂停', '已暂停', '停工', '搁置'],
  '取消': ['取消', '已取消', '作废', '已作废', '取消实施'],
};
/** 状态归一：命中同义词返回标准态；否则返回 null（单列 unknownStatus，绝不就近映射） */
function normStatus(v) {
  const s = C.str(v).replace(/\s/g, '');
  if (s === '') return null;
  for (const std of STATUS_ENUM) if (STATUS_SYNONYM[std].some((k) => s === k)) return std;
  return null;
}
/** 各状态对应的定性进度表述（完成比例为空时使用，绝不按 0 或线性推算填数） */
const QUALITATIVE = {
  '未开工': '按状态为「未开工」，未填报完成比例',
  '施工中': '按状态为「施工中」，已开工但未填报完成比例',
  '已完工': '按状态为「已完工」，未填报完成比例',
  '已中交': '按状态为「已中交」（中间交接），未填报完成比例',
  '已开工': '按状态为「已开工」（中交后开车投用），未填报完成比例',
  '已中止': '按状态为「已中止」，未填报完成比例',
  '取消': '按状态为「取消」，不参与进度统计',
};
/** 状态与完成比例的相容区间（闭区间）；越界即为矛盾，只单列不修正 */
const STATUS_PCT_RULE = {
  '未开工': { min: 0, max: 0, cn: '未开工时完成比例应为 0' },
  '施工中': { min: 0, max: 99.99, cn: '施工中时完成比例应小于 100' },
  '已完工': { min: 100, max: 100, cn: '已完工时完成比例应为 100' },
  '已中交': { min: 100, max: 100, cn: '已中交时完成比例应为 100' },
  '已开工': { min: 100, max: 100, cn: '已开工时完成比例应为 100' },
};
const ACTIVE_STATUS = ['未开工', '施工中', '已完工', '已中交', '已开工', '已中止'];   // 取消项不参与进度统计
const FINISHED_STATUS = ['已完工', '已中交', '已开工'];                              // 施工已完成（含中交/开工节点）
const OPEN_STATUS = ['未开工', '施工中', '已中止'];                                   // 未完工

function loadBook(p) {
  const st = fs.statSync(p);
  return st.isDirectory() ? readCsvDir(p) : readXlsx(p);
}
/** 「是/否」判定：命中即返回布尔，否则 null（未判定，绝不按否或按是默认） */
function normBool(v) {
  const s = C.str(v).replace(/\s/g, '');
  if (s === '') return null;
  if (/^(是|具备|满足|已具备|已满足|已到|已到货|齐备|Y|y|YES|yes|TRUE|true|√|1)$/.test(s)) return true;
  if (/^(否|不具备|未具备|不满足|未满足|未到|未到货|缺|N|n|NO|no|FALSE|false|×|0)$/.test(s)) return false;
  return null;
}
/** 三查四定问题关闭状态：已关闭 true / 未关闭 false / 其它 null（未判定，不按已关闭默认） */
function normClosed(v) {
  const s = C.str(v).replace(/\s/g, '');
  if (s === '') return null;
  if (/^(未|待|不)/.test(s)) return false;
  if (/^(已关闭|关闭|已整改|已完成|完成|已销项|销项|已闭环|闭环|是|Y|y|YES|TRUE|√)$/.test(s)) return true;
  if (/^(整改中|在整改|处理中|进行中|否|N|n|NO|FALSE|×)$/.test(s)) return false;
  return null;
}

function main() {
  const a = C.parseArgs(process.argv.slice(2), VALUE_OPTS, FLAG_OPTS);
  if (!a.input) throw new Error('缺少 --input');
  if (!a.workshop) throw new Error('缺少 --workshop');
  if (!a.project) throw new Error('缺少 --project');
  if (!a.date) throw new Error('缺少 --date');
  if (!a.start) throw new Error('缺少 --start（大检修计划开始日期）');
  if (!a.end) throw new Error('缺少 --end（大检修计划结束日期）');
  const date = C.normDate(a.date);
  if (!date) throw new Error(`--date 「${a.date}」不是有效日期，应为 YYYY-MM-DD`);
  const taStart = C.normDate(a.start);
  if (!taStart) throw new Error(`--start 「${a.start}」不是有效日期，应为 YYYY-MM-DD`);
  const taEnd = C.normDate(a.end);
  if (!taEnd) throw new Error(`--end 「${a.end}」不是有效日期，应为 YYYY-MM-DD`);
  if (C.diffDays(taEnd, taStart) < 0) throw new Error(`--end ${taEnd} 早于 --start ${taStart}`);
  let lagDays = 1;
  if (a['lag-days'] !== undefined) {
    const n = Number(a['lag-days']);
    if (!Number.isFinite(n) || n < 0) throw new Error(`--lag-days 「${a['lag-days']}」应为非负数（天）`);
    lagDays = n;
  }
  const linear = !!a['linear-check'];
  if (!fs.existsSync(a.input)) throw new Error(`输入不存在: ${a.input}`);
  const outDir = a.out || path.join(require('os').tmpdir(), 'ta-out');

  // 统计日期落在大检修计划区间外只提示，不改口径
  if (C.diffDays(date, taStart) < 0) warnings.push(`统计日期 ${date} 早于大检修计划开始日期 ${taStart}，日历进度按 0% 提示，请核实参数`);
  if (C.diffDays(date, taEnd) > 0) warnings.push(`统计日期 ${date} 晚于大检修计划结束日期 ${taEnd}，大检修计划期已过，请核实参数`);
  if (!linear) warnings.push('未启用 --linear-check，滞后只按 ①已过计划完工日未完工 ②超计划开工日未开工 判定；③完成比例落后应有进度（按计划节点线性推算）未判定，应有进度列显示「—」');

  // 关键路径项目编号集合
  const criticalSet = new Set();
  if (a.critical) {
    for (const x of String(a.critical).split(/[,，、;；\s]+/)) { const v = C.str(x); if (v) criticalSet.add(v); }
    if (!criticalSet.size) warnings.push(`--critical 「${a.critical}」未解析出任何项目编号，本次不做关键路径标注`);
  }

  // ---- 上一日 progress.json
  let prev = null;
  if (a.prev) {
    if (!fs.existsSync(a.prev)) throw new Error(`上一日进度文件不存在: ${a.prev}`);
    let raw;
    try { raw = JSON.parse(fs.readFileSync(a.prev, 'utf8')); } catch (e) { throw new Error(`上一日进度文件解析失败 ${a.prev}: ${e.message}`); }
    if (!raw || !Array.isArray(raw.byProject)) throw new Error(`上一日进度文件格式不符（缺少 byProject 数组）: ${a.prev}`);
    prev = raw;
    if (prev.meta && prev.meta.date && C.diffDays(date, prev.meta.date) <= 0) {
      warnings.push(`--prev 的统计日期（${prev.meta.date}）不早于本次统计日期（${date}），日进度对比可能无意义，已照常输出`);
    }
  }

  // ---- 读项目清单
  let book;
  try { book = loadBook(a.input); } catch (e) { throw new Error(`读取失败 ${a.input}: ${e.message}`); }
  const rows = C.pickSheet(book, '项目清单', '检修项目', '项目', '大修项目', '大检修项目', '工单清单', '订单清单');
  if (!rows) throw new Error('未在输入中找到「项目清单」工作表');
  const sheetName = `${path.basename(a.input)}/项目清单`;
  const recs = C.toRecords(rows, ['项目编号', '项目名称', '状态'], sheetName,
    ['位号', '专业', '计划开工', '计划完工', '实际开工', '实际完工', '工期', '施工单位', '责任人', '完成比例', '备注'],
    warnings, ALIASES);

  const projects = [];
  const inconsistent = [];
  const unknownStatus = [];
  const seen = new Map();
  let startedUpSeen = 0;
  for (const r of recs) {
    const no = C.str(r['项目编号']);
    if (!no) { warnings.push(`工作表「${r._sheet}」第${r._row}行 项目编号为空，已跳过`); continue; }
    if (seen.has(no)) {
      seen.set(no, seen.get(no) + 1);
      warnings.push(`工作表「${r._sheet}」第${r._row}行 项目编号「${no}」重复出现（第 ${seen.get(no)} 次），两条均已保留，请核实项目清单`);
    } else seen.set(no, 1);

    const p = { no, row: r._row, sheet: r._sheet, source: `${r._sheet} 第${r._row}行` };
    p.name = C.str(r['项目名称']);
    p.tag = C.str(r['位号']);
    p.discipline = C.str(r['专业']);
    p.contractor = C.str(r['施工单位']);
    p.owner = C.str(r['责任人']);
    p.note = C.str(r['备注']);
    p.critical = criticalSet.has(no);
    p.rawStatus = C.str(r['状态']);
    p.status = normStatus(r['状态']);
    if (p.status === '已开工') startedUpSeen++;

    // 计划与实际节点：无法解析 → warning + null，绝不猜测
    for (const [key, cn] of [['planStart', '计划开工'], ['planEnd', '计划完工'], ['actStart', '实际开工'], ['actEnd', '实际完工']]) {
      const raw = r[cn];
      const d = C.normDate(raw);
      if (C.str(raw) && !d) warnings.push(`工作表「${r._sheet}」第${r._row}行 项目「${no}」${cn}「${C.str(raw)}」无法解析，该节点按缺失处理`);
      p[key] = d;
    }

    // 工期：不可解析 → null（不参与加权），绝不按 0 也不按计划节点反推
    const durRaw = r['工期'];
    p.duration = C.parsePeriod(durRaw);
    if (C.str(durRaw) && p.duration === null) warnings.push(`工作表「${r._sheet}」第${r._row}行 项目「${no}」工期「${C.str(durRaw)}」无法解析为天数，该项不参与加权`);
    if (p.duration !== null && p.duration <= 0) {
      warnings.push(`工作表「${r._sheet}」第${r._row}行 项目「${no}」工期「${C.str(durRaw)}」不是正数天数，已置空，该项不参与加权`);
      p.duration = null;
    }

    // 完成比例：空 → null；超出 0~100 → warning + null（不截断）
    const pctRaw = r['完成比例'];
    p.rawPercent = C.str(pctRaw);
    let pv = num(pctRaw, { sheet: r._sheet, row: r._row, col: '完成比例' });
    if (pv !== null && (pv < 0 || pv > 100)) {
      warnings.push(`工作表「${r._sheet}」第${r._row}行 项目「${no}」完成比例「${p.rawPercent}」超出 0~100 范围，已置空按未填报处理，未截断到边界值`);
      p.pctOutOfRange = true;
      pv = null;
    }
    p.percent = pv === null ? null : C.round(pv, 1);
    p.percentQualitative = null;

    if (!p.status) {
      warnings.push(`工作表「${r._sheet}」第${r._row}行 项目「${no}」状态「${p.rawStatus || '（空）'}」不在规定枚举内（${STATUS_ENUM.join('/')}），已单列未知状态，不做就近映射`);
      unknownStatus.push({
        no, row: r._row, name: p.name, tag: p.tag, rawStatus: p.rawStatus,
        contractor: p.contractor, owner: p.owner, percent: p.percent,
        reason: p.rawStatus ? '状态取值不在规定枚举内' : '状态为空',
        source: p.source,
      });
    } else if (p.percent === null) {
      p.percentQualitative = QUALITATIVE[p.status];
    }

    // 计划完工早于计划开工 → warning 单列，数据原样保留
    p.planIssue = null;
    if (p.planStart && p.planEnd && C.diffDays(p.planEnd, p.planStart) < 0) {
      p.planIssue = `计划完工（${p.planEnd}）早于计划开工（${p.planStart}）`;
      warnings.push(`工作表「${r._sheet}」第${r._row}行 项目「${no}」${p.planIssue}，已原样保留，该项不做日历应有进度测算，请核实计划`);
    }
    if (p.actStart && p.actEnd && C.diffDays(p.actEnd, p.actStart) < 0) {
      const msg = `实际完工（${p.actEnd}）早于实际开工（${p.actStart}）`;
      p.actIssue = msg;
      warnings.push(`工作表「${r._sheet}」第${r._row}行 项目「${no}」${msg}，已原样保留，请核实台账`);
    } else p.actIssue = null;

    // ---- 完成比例与状态矛盾：单列 + warning，绝不修正任一字段
    if (p.status && p.percent !== null && STATUS_PCT_RULE[p.status]) {
      const rule = STATUS_PCT_RULE[p.status];
      if (p.percent < rule.min || p.percent > rule.max) {
        const conflict = `状态「${p.status}」与完成比例 ${p.percent}% 矛盾（${rule.cn}）`;
        p.inconsistent = conflict;
        warnings.push(`工作表「${r._sheet}」第${r._row}行 项目「${no}」${conflict}，两个字段均按原值保留，未作任何修正，该项不参与总体加权与滞后判定`);
        inconsistent.push({
          no, row: r._row, name: p.name, tag: p.tag,
          status: p.status, rawStatus: p.rawStatus, percent: p.percent, rawPercent: p.rawPercent,
          conflict, expectation: rule.cn,
          contractor: p.contractor, owner: p.owner, critical: p.critical,
          handling: '状态与完成比例均按原值保留，脚本未修正任一字段，该项不参与总体加权与滞后判定，请回项目清单核实后重跑',
          source: p.source,
        });
      } else p.inconsistent = null;
    } else p.inconsistent = null;

    projects.push(p);
  }
  if (!projects.length) throw new Error('项目清单中没有可用的项目记录（项目编号全部为空或表中无数据行）');
  if (startedUpSeen) warnings.push(`${startedUpSeen} 个项目状态为「已开工」，按中石化大检修节点理解为中交后开工（开车投用），不是"已开始施工"；若台账用「已开工」表示已开始施工，请改填「施工中」后重跑`);

  // ---- 可选表：材料到货
  const materialGap = [];
  let materialProvided = false;
  {
    const mrows = C.pickSheet(book, '材料到货', '材料', '物资到货', '到货');
    if (!mrows) warnings.push('输入中未找到「材料到货」工作表，本次不做材料到货核对，报告该节写「未提供材料到货数据」');
    else {
      materialProvided = true;
      const msheet = `${path.basename(a.input)}/材料到货`;
      const mrecs = C.toRecords(mrows, ['项目编号', '材料名称'], msheet,
        ['需求数量', '到货数量', '需求日期', '到货状态', '备注'], warnings, ALIASES);
      for (const r of mrecs) {
        const no = C.str(r['项目编号']);
        const mat = C.str(r['材料名称']);
        if (!no && !mat) continue;
        const need = num(r['需求数量'], { sheet: r._sheet, row: r._row, col: '需求数量' });
        const got = num(r['到货数量'], { sheet: r._sheet, row: r._row, col: '到货数量' });
        const stRaw = C.str(r['到货状态']);
        const stBool = normBool(stRaw);
        let arrived = null, basis = null;
        if (stBool !== null) { arrived = stBool; basis = `到货状态「${stRaw}」`; }
        else if (need !== null && got !== null) { arrived = got >= need; basis = `到货 ${got} / 需求 ${need}`; }
        else if (stRaw) { basis = `到货状态「${stRaw}」无法判定`; }
        const proj = projects.find((x) => x.no === no);
        if (no && !proj) warnings.push(`工作表「${msheet}」第${r._row}行 材料「${mat}」所属项目编号「${no}」在项目清单中不存在，已单列材料缺口但无法关联项目`);
        if (arrived === false || arrived === null) {
          if (arrived === null) warnings.push(`工作表「${msheet}」第${r._row}行 项目「${no || '（未填）'}」材料「${mat}」到货状态与数量均无法判定，已列入材料缺口并标注未判定，未按已到货处理`);
          materialGap.push({
            no: no || '（未填写项目编号）', name: proj ? proj.name : '', material: mat,
            need, arrived: got, status: stRaw || '', judged: arrived, basis: basis || '到货状态与数量均缺失',
            needDate: C.normDate(r['需求日期']),
            critical: proj ? proj.critical : false,
            reason: arrived === false ? '未到货或到货不足' : '到货情况未判定（状态与数量均缺失或无法识别）',
            source: `${msheet} 第${r._row}行`,
          });
        }
      }
    }
  }

  // ---- 可选表：人员到位
  const manpower = [];
  let manpowerProvided = false;
  {
    const prows = C.pickSheet(book, '人员到位', '人员', '人力到位', '队伍到位');
    if (!prows) warnings.push('输入中未找到「人员到位」工作表，本次不做人员到位核对，报告该节写「未提供人员到位数据」');
    else {
      manpowerProvided = true;
      const psheet = `${path.basename(a.input)}/人员到位`;
      const precs = C.toRecords(prows, ['项目编号'], psheet, ['施工单位', '计划人数', '到位人数', '备注'], warnings, ALIASES);
      for (const r of precs) {
        const no = C.str(r['项目编号']);
        if (!no) continue;
        const plan = num(r['计划人数'], { sheet: r._sheet, row: r._row, col: '计划人数' });
        const real = num(r['到位人数'], { sheet: r._sheet, row: r._row, col: '到位人数' });
        const proj = projects.find((x) => x.no === no);
        if (!proj) warnings.push(`工作表「${psheet}」第${r._row}行 项目编号「${no}」在项目清单中不存在，人员到位数据已保留但无法关联项目`);
        let gap = null;
        if (plan !== null && real !== null) gap = C.round(real - plan, 1);
        else warnings.push(`工作表「${psheet}」第${r._row}行 项目「${no}」计划人数或到位人数缺失，人员缺口显示「—」，未按 0 计`);
        manpower.push({
          no, name: proj ? proj.name : '', contractor: C.str(r['施工单位']) || (proj ? proj.contractor : ''),
          plan, arrived: real, gap,
          shortage: gap === null ? null : gap < 0,
          critical: proj ? proj.critical : false,
          note: C.str(r['备注']),
          source: `${psheet} 第${r._row}行`,
        });
      }
    }
  }

  // ---- 可选表：开工条件
  const readyGap = [];
  let readyProvided = false;
  {
    const crows = C.pickSheet(book, '开工条件', '开工', '条件确认', '条件');
    if (!crows) warnings.push('输入中未找到「开工条件」工作表，本次不做开工条件核对，报告该节写「未提供开工条件数据」');
    else {
      readyProvided = true;
      const csheet = `${path.basename(a.input)}/开工条件`;
      const crecs = C.toRecords(crows, ['项目编号', '条件项'], csheet, ['是否具备', '责任单位', '责任人', '备注'], warnings, ALIASES);
      for (const r of crecs) {
        const no = C.str(r['项目编号']);
        const item = C.str(r['条件项']);
        if (!no && !item) continue;
        const raw = C.str(r['是否具备']);
        const okv = normBool(raw);
        const proj = projects.find((x) => x.no === no);
        if (no && !proj) warnings.push(`工作表「${csheet}」第${r._row}行 条件项「${item}」所属项目编号「${no}」在项目清单中不存在，已单列条件缺口但无法关联项目`);
        if (okv === false || okv === null) {
          if (okv === null) warnings.push(`工作表「${csheet}」第${r._row}行 项目「${no || '（未填）'}」条件项「${item}」是否具备「${raw || '（空）'}」无法判定，已列入条件缺口并标注未判定，未按已具备处理`);
          readyGap.push({
            no: no || '（未填写项目编号）', name: proj ? proj.name : '', item,
            raw: raw || '', judged: okv,
            reason: okv === false ? '条件未具备' : '是否具备未判定（取值缺失或无法识别）',
            unit: C.str(r['责任单位']) || (proj ? proj.contractor : ''),
            owner: C.str(r['责任人']) || (proj ? proj.owner : ''),
            critical: proj ? proj.critical : false,
            note: C.str(r['备注']),
            source: `${csheet} 第${r._row}行`,
          });
        }
      }
    }
  }
  const readySet = new Set(readyGap.map((x) => x.no));
  const materialSet = new Set(materialGap.map((x) => x.no));

  // ---- 可选表：三查四定问题（查设计漏项、查未完工程、查工程质量 → 定任务、定人员、定时间、定措施）
  const tcfd = { provided: false, items: [], counts: { total: 0, closed: 0, open: 0, undetermined: 0, incompleteSiDing: 0, overdue: 0 } };
  {
    const trows = C.pickSheet(book, '三查四定', '三查四定问题', '问题台账', '问题清单', '三查');
    if (!trows) warnings.push('输入中未找到「三查四定」工作表，本次不做三查四定问题核对，报告该节写「未提供三查四定问题数据」');
    else {
      tcfd.provided = true;
      const tsheet = `${path.basename(a.input)}/三查四定`;
      const trecs = C.toRecords(trows, ['问题描述'], tsheet,
        ['问题编号', '项目编号', '位号', '问题类别', '整改措施', '责任单位', '责任人', '整改期限', '整改状态', '备注'], warnings, ALIASES);
      for (const r of trecs) {
        const desc = C.str(r['问题描述']);
        if (!desc) { warnings.push(`工作表「${tsheet}」第${r._row}行 问题描述为空，已跳过`); continue; }
        const no = C.str(r['项目编号']);
        const proj = no ? projects.find((x) => x.no === no) : null;
        if (no && !proj) warnings.push(`工作表「${tsheet}」第${r._row}行 问题「${desc}」所属项目编号「${no}」在项目清单中不存在，已保留但无法关联项目`);
        const measure = C.str(r['整改措施']);
        const owner = C.str(r['责任人']);
        const deadlineRaw = r['整改期限'];
        const deadline = C.normDate(deadlineRaw);
        if (C.str(deadlineRaw) && !deadline) warnings.push(`工作表「${tsheet}」第${r._row}行 问题「${desc}」整改期限「${C.str(deadlineRaw)}」无法解析，按未定时间处理`);
        const missingSiDing = [];
        if (!measure) missingSiDing.push('定任务/定措施');
        if (!owner) missingSiDing.push('定人员');
        if (!deadline) missingSiDing.push('定时间');
        const stRaw = C.str(r['整改状态']);
        const closed = normClosed(stRaw);
        if (closed === null) warnings.push(`工作表「${tsheet}」第${r._row}行 问题「${desc}」整改状态「${stRaw || '（空）'}」无法判定是否关闭，已标注未判定，未按已关闭处理`);
        const overdue = closed === false && deadline && C.diffDays(date, deadline) > 0;
        const item = {
          id: C.str(r['问题编号']) || `#${r._row}`, no: no || '', name: proj ? proj.name : '', tag: C.str(r['位号']) || (proj ? proj.tag : ''),
          category: C.str(r['问题类别']), desc, measure, unit: C.str(r['责任单位']) || (proj ? proj.contractor : ''), owner,
          deadline, deadlineRaw: C.str(deadlineRaw), status: stRaw, closed,
          siDingComplete: missingSiDing.length === 0, missingSiDing,
          overdue: !!overdue, overdueDays: overdue ? C.diffDays(date, deadline) : null,
          critical: proj ? proj.critical : false,
          note: C.str(r['备注']), source: `${tsheet} 第${r._row}行`,
        };
        tcfd.items.push(item);
        tcfd.counts.total++;
        if (closed === true) tcfd.counts.closed++;
        else if (closed === false) tcfd.counts.open++;
        else tcfd.counts.undetermined++;
        if (!item.siDingComplete) tcfd.counts.incompleteSiDing++;
        if (item.overdue) tcfd.counts.overdue++;
      }
      tcfd.items.sort((x, y) => (y.critical ? 1 : 0) - (x.critical ? 1 : 0) || (y.overdue ? 1 : 0) - (x.overdue ? 1 : 0) || (x.closed === true ? 1 : 0) - (y.closed === true ? 1 : 0));
    }
  }
  const tcfdOpenByProject = new Map();
  for (const t of tcfd.items) if (t.no && t.closed !== true) tcfdOpenByProject.set(t.no, (tcfdOpenByProject.get(t.no) || 0) + 1);

  // ---- 逐项目测算：应有进度（仅 --linear-check）、偏差、滞后
  const lagging = [], notStarted = [];
  const totalCalDays = C.diffDays(taEnd, taStart);
  const elapsed = C.diffDays(date, taStart);
  const calendarPct = (totalCalDays !== null && totalCalDays > 0)
    ? C.round(Math.max(0, Math.min(100, (elapsed / totalCalDays) * 100)), 1) : null;

  for (const p of projects) {
    p.expectedPercent = null;
    p.deviationPct = null;
    p.startLagDays = null;
    p.endLagDays = null;
    p.lagDays = null;
    p.lagReasonType = null;
    p.judged = true;

    if (!p.status) { p.judged = false; p.undeterminedReason = '状态不在规定枚举内，未做滞后判定'; continue; }
    if (p.inconsistent) { p.judged = false; p.undeterminedReason = '状态与完成比例矛盾，未做滞后判定'; continue; }
    if (p.status === '取消') { p.judged = false; p.undeterminedReason = '项目已取消，不参与进度统计'; continue; }
    if (p.planIssue) { p.judged = false; p.undeterminedReason = '计划完工早于计划开工，计划节点异常，未做滞后判定（计划节点原样保留，未作修正）'; continue; }

    // 应有进度：只在 --linear-check 时按计划开工→计划完工的日历推算
    if (linear && p.planStart && p.planEnd && !p.planIssue) {
      const span = C.diffDays(p.planEnd, p.planStart);
      if (span !== null && span > 0) {
        const used = C.diffDays(date, p.planStart);
        p.expectedPercent = C.round(Math.max(0, Math.min(100, (used / span) * 100)), 1);
      } else if (span === 0) {
        p.expectedPercent = C.diffDays(date, p.planStart) >= 0 ? 100 : 0;
      }
    }

    // 超计划开工日未开工
    if (p.status === '未开工') {
      if (p.planStart && C.diffDays(date, p.planStart) > 0) {
        p.startLagDays = C.diffDays(date, p.planStart);
        notStarted.push({
          no: p.no, name: p.name, tag: p.tag, planStart: p.planStart, planEnd: p.planEnd,
          overdueStartDays: p.startLagDays, duration: p.duration,
          contractor: p.contractor || '', owner: p.owner || '',
          party: [p.contractor, p.owner].filter(Boolean).join(' / ') || '（未填写责任方）',
          critical: p.critical,
          readyGap: readySet.has(p.no), materialGap: materialSet.has(p.no),
          note: p.note || '原因未记录',
          source: p.source,
        });
      } else if (!p.planStart) {
        warnings.push(`项目「${p.no}」（${p.source}）状态为未开工但计划开工日期缺失，无法判定是否超期未开工，已列入未判定`);
        p.judged = false;
        p.undeterminedReason = '状态未开工但计划开工日期缺失，无法判定是否超期未开工';
        continue;
      }
    }

    if (p.actStart && p.planStart) {
      const d = C.diffDays(p.actStart, p.planStart);
      if (d !== null && d > 0) p.startLagDays = d;
    }

    // 滞后判定：① 已过计划完工日仍未完工；② 超计划开工日未开工；③（--linear-check）完成比例落后应有进度
    let lagType = null, lagValue = null, basis = null;
    if (OPEN_STATUS.includes(p.status) && p.planEnd && C.diffDays(date, p.planEnd) > 0) {
      lagType = '已过计划完工日未完工';
      lagValue = C.diffDays(date, p.planEnd);
      basis = `计划完工 ${p.planEnd}，统计日 ${date}`;
    } else if (p.status === '未开工' && p.startLagDays !== null && p.startLagDays >= lagDays) {
      lagType = '超计划开工日未开工';
      lagValue = p.startLagDays;
      basis = `计划开工 ${p.planStart}，统计日 ${date} 仍未开工`;
    } else if (linear && p.percent !== null && p.expectedPercent !== null && !FINISHED_STATUS.includes(p.status)) {
      const dev = C.round(p.percent - p.expectedPercent, 1);
      p.deviationPct = dev;
      const span = C.diffDays(p.planEnd, p.planStart);
      const baseDays = p.duration !== null ? p.duration : span;
      const devDays = (baseDays !== null && baseDays > 0) ? C.round((-dev / 100) * baseDays, 1) : null;
      if (dev < 0 && devDays !== null && devDays >= lagDays) {
        lagType = '完成比例落后应有进度';
        lagValue = devDays;
        basis = `应有进度 ${p.expectedPercent}%（按计划 ${p.planStart}~${p.planEnd} 日历推算，--linear-check），实际 ${p.percent}%，按工期 ${baseDays} 天折算`;
      }
    } else if (linear && p.percent === null && OPEN_STATUS.includes(p.status) && p.expectedPercent !== null && p.expectedPercent > 0) {
      p.judged = false;
      p.undeterminedReason = '完成比例未填报，不按 0 也不按工期线性推算，未做进度滞后判定';
    }
    if (p.percent !== null && p.expectedPercent !== null && p.deviationPct === null) {
      p.deviationPct = C.round(p.percent - p.expectedPercent, 1);
    }

    if (lagType) {
      p.lagDays = lagValue;
      p.lagReasonType = lagType;
      p.endLagDays = (p.planEnd && OPEN_STATUS.includes(p.status) && C.diffDays(date, p.planEnd) > 0) ? C.diffDays(date, p.planEnd) : null;
      lagging.push({
        no: p.no, name: p.name, tag: p.tag, discipline: p.discipline,
        status: p.status, percent: p.percent, percentQualitative: p.percentQualitative,
        expectedPercent: p.expectedPercent, deviationPct: p.deviationPct,
        planStart: p.planStart, planEnd: p.planEnd, actStart: p.actStart,
        duration: p.duration, lagDays: lagValue, lagType, basis,
        contractor: p.contractor || '', owner: p.owner || '',
        party: [p.contractor, p.owner].filter(Boolean).join(' / ') || '（未填写责任方）',
        critical: p.critical,
        readyGap: readySet.has(p.no), materialGap: materialSet.has(p.no),
        tcfdOpen: tcfdOpenByProject.get(p.no) || 0,
        note: p.note || '原因未记录',
        disclaimer: DISCLAIMER,
        source: p.source,
      });
    }
  }

  // ---- 总体完成比例：按工期加权（工期缺失项单列，不参与加权）
  const active = projects.filter((p) => p.status && ACTIVE_STATUS.includes(p.status) && !p.inconsistent);
  const weighted = active.filter((p) => p.duration !== null && p.percent !== null);
  const noDuration = active.filter((p) => p.duration === null);
  const noPercent = active.filter((p) => p.percent === null);
  const weightSum = weighted.reduce((s, p) => s + p.duration, 0);
  const overallPct = weightSum > 0
    ? C.round(weighted.reduce((s, p) => s + p.duration * p.percent, 0) / weightSum, 1) : null;
  if (!weighted.length) warnings.push('没有任何项目同时具备有效工期与完成比例，总体完成比例为 —（不按 0，也不按项目数简单平均）');
  if (noDuration.length) warnings.push(`${noDuration.length} 个项目工期缺失或无法解析，不参与总体加权，已在报告中单列说明`);
  if (noPercent.length) warnings.push(`${noPercent.length} 个项目完成比例未填报，不参与总体加权，报告显示「—」并按状态给定性进度，未按 0 计`);

  // 按专业分布
  const discSet = [...new Set(active.map((p) => p.discipline || '（未填写专业）'))].sort((x, y) => x.localeCompare(y, 'zh'));
  const byDiscipline = discSet.map((d) => {
    const g = active.filter((p) => (p.discipline || '（未填写专业）') === d);
    const gw = g.filter((p) => p.duration !== null && p.percent !== null);
    const ws = gw.reduce((s, p) => s + p.duration, 0);
    return {
      discipline: d, total: g.length,
      done: g.filter((p) => FINISHED_STATUS.includes(p.status)).length,
      running: g.filter((p) => p.status === '施工中').length,
      notStarted: g.filter((p) => p.status === '未开工').length,
      weightedSample: gw.length,
      percent: ws > 0 ? C.round(gw.reduce((s, p) => s + p.duration * p.percent, 0) / ws, 1) : null,
      lagging: lagging.filter((x) => (projects.find((p) => p.no === x.no) || {}).discipline === (d === '（未填写专业）' ? '' : d)).length,
    };
  });

  // 按状态分布
  const byStatus = STATUS_ENUM.map((st) => ({ status: st, count: projects.filter((p) => p.status === st).length }));

  // ---- 未判定清单
  const undetermined = projects.filter((p) => !p.judged && p.status !== '取消').map((p) => ({
    no: p.no, name: p.name, tag: p.tag, status: p.status, rawStatus: p.rawStatus,
    percent: p.percent, percentQualitative: p.percentQualitative,
    reason: p.undeterminedReason || '判定依据字段缺失',
    contractor: p.contractor || '', owner: p.owner || '', critical: p.critical, source: p.source,
  }));

  // ---- 计划节点异常
  const planIssues = projects.filter((p) => p.planIssue).map((p) => ({
    no: p.no, name: p.name, planStart: p.planStart, planEnd: p.planEnd,
    issue: p.planIssue, handling: '计划节点原样保留，脚本未修正，该项不做日历应有进度测算',
    source: p.source,
  }));
  const missingPlan = projects.filter((p) => p.status !== '取消' && (!p.planStart || !p.planEnd)).map((p) => ({
    no: p.no, name: p.name, status: p.status,
    missing: [!p.planStart ? '计划开工' : null, !p.planEnd ? '计划完工' : null].filter(Boolean).join('、'),
    source: p.source,
  }));
  if (missingPlan.length) warnings.push(`${missingPlan.length} 个项目计划开工或计划完工日期缺失，无法测算应有进度，相关判定已列入未判定或按其他依据处理`);

  // ---- byProject 明细
  const byProject = projects.map((p) => ({
    no: p.no, name: p.name, tag: p.tag, discipline: p.discipline,
    status: p.status, rawStatus: p.rawStatus,
    percent: p.percent, rawPercent: p.rawPercent, percentQualitative: p.percentQualitative,
    percentOutOfRange: !!p.pctOutOfRange,
    planStart: p.planStart, planEnd: p.planEnd, actStart: p.actStart, actEnd: p.actEnd,
    duration: p.duration, inWeighting: !!(p.status && ACTIVE_STATUS.includes(p.status) && !p.inconsistent && p.duration !== null && p.percent !== null),
    expectedPercent: p.expectedPercent, deviationPct: p.deviationPct,
    startLagDays: p.startLagDays, endLagDays: p.endLagDays,
    lagDays: p.lagDays, lagType: p.lagReasonType,
    lagging: p.lagDays !== null, judged: p.judged,
    undeterminedReason: p.judged ? null : (p.undeterminedReason || null),
    inconsistent: p.inconsistent || null,
    planIssue: p.planIssue || null, actIssue: p.actIssue || null,
    contractor: p.contractor, owner: p.owner, critical: p.critical,
    readyGap: readySet.has(p.no), materialGap: materialSet.has(p.no),
    tcfdOpen: tcfdOpenByProject.get(p.no) || 0,
    note: p.note, source: p.source,
  }));

  // ---- dayChange（有 --prev 时）
  let dayChange = null;
  if (prev) {
    const prevMap = new Map(prev.byProject.map((x) => [x.no, x]));
    const items = [], newProjects = [], dropped = [];
    for (const cur of byProject) {
      const old = prevMap.get(cur.no);
      if (!old) { newProjects.push({ no: cur.no, name: cur.name, status: cur.status, percent: cur.percent }); continue; }
      const delta = (cur.percent !== null && old.percent !== null) ? C.round(cur.percent - old.percent, 1) : null;
      const statusChanged = C.str(old.status) !== C.str(cur.status);
      if (delta === null && !statusChanged) {
        if (cur.percent === null || old.percent === null) {
          items.push({
            no: cur.no, name: cur.name, prevPercent: old.percent, percent: cur.percent, delta: null,
            prevStatus: old.status, status: cur.status, statusChanged: false,
            remark: '本日或上一日完成比例未填报，进度增量无法计算，显示「—」，未按 0 增量处理',
          });
        }
        continue;
      }
      items.push({
        no: cur.no, name: cur.name, prevPercent: old.percent, percent: cur.percent, delta,
        prevStatus: old.status, status: cur.status, statusChanged,
        remark: delta === null ? '本日或上一日完成比例未填报，进度增量显示「—」，未按 0 增量处理' : '',
      });
    }
    for (const old of prev.byProject) if (!byProject.some((c) => c.no === old.no)) dropped.push({ no: old.no, name: old.name, status: old.status });
    if (dropped.length) warnings.push(`${dropped.length} 个上一日存在的项目在本日清单中缺失，已单列，未按完工或取消处理`);
    const advanced = items.filter((x) => x.delta !== null && x.delta > 0);
    const stagnant = byProject.filter((p) => {
      const old = prevMap.get(p.no);
      return old && p.percent !== null && old.percent !== null && p.percent === old.percent
        && p.status && OPEN_STATUS.includes(p.status) && p.status !== '未开工';
    }).map((p) => ({ no: p.no, name: p.name, percent: p.percent, status: p.status, critical: p.critical, party: [p.contractor, p.owner].filter(Boolean).join(' / ') || '（未填写责任方）' }));
    const nodeChanged = items.filter((x) => x.statusChanged && ['已中交', '已开工'].includes(x.status)).map((x) => ({ no: x.no, name: x.name, from: x.prevStatus, to: x.status }));
    dayChange = {
      prevDate: (prev.meta && prev.meta.date) || null,
      prevOverall: (prev.overall && prev.overall.percent !== undefined) ? prev.overall.percent : null,
      overall: overallPct,
      overallDelta: (overallPct !== null && prev.overall && prev.overall.percent !== null && prev.overall.percent !== undefined)
        ? C.round(overallPct - prev.overall.percent, 1) : null,
      items: items.sort((x, y) => (y.delta === null ? -1 : y.delta) - (x.delta === null ? -1 : x.delta) || x.no.localeCompare(y.no, 'zh')),
      advancedCount: advanced.length,
      stagnant, newProjects, dropped, nodeChanged,
      note: '进度增量 = 本日完成比例 − 上一日完成比例；任一日未填报完成比例时增量为「—」，不按 0 增量。',
    };
  }

  // ---- 排序
  lagging.sort((x, y) => (y.critical ? 1 : 0) - (x.critical ? 1 : 0) || (y.lagDays || 0) - (x.lagDays || 0) || x.no.localeCompare(y.no, 'zh'));
  notStarted.sort((x, y) => (y.critical ? 1 : 0) - (x.critical ? 1 : 0) || y.overdueStartDays - x.overdueStartDays || x.no.localeCompare(y.no, 'zh'));
  readyGap.sort((x, y) => (y.critical ? 1 : 0) - (x.critical ? 1 : 0) || String(x.no).localeCompare(String(y.no), 'zh'));
  materialGap.sort((x, y) => (y.critical ? 1 : 0) - (x.critical ? 1 : 0) || String(x.no).localeCompare(String(y.no), 'zh'));

  const criticalLagging = lagging.filter((x) => x.critical);
  const criticalMissing = [...criticalSet].filter((no) => !projects.some((p) => p.no === no));
  if (criticalMissing.length) warnings.push(`--critical 指定的项目编号「${criticalMissing.join('、')}」在项目清单中不存在，请核实`);

  const counts = {
    total: projects.length,
    active: active.length,
    done: projects.filter((p) => p.status === '已完工').length,
    handedOver: projects.filter((p) => p.status === '已中交').length,
    startedUp: projects.filter((p) => p.status === '已开工').length,
    finished: projects.filter((p) => FINISHED_STATUS.includes(p.status)).length,
    running: projects.filter((p) => p.status === '施工中').length,
    notStartedStatus: projects.filter((p) => p.status === '未开工').length,
    suspended: projects.filter((p) => p.status === '已中止').length,
    cancelled: projects.filter((p) => p.status === '取消').length,
    unknownStatus: unknownStatus.length,
    lagging: lagging.length,
    criticalLagging: criticalLagging.length,
    notStarted: notStarted.length,
    readyGap: readyGap.length,
    materialGap: materialGap.length,
    manpowerShortage: manpower.filter((x) => x.shortage === true).length,
    tcfdTotal: tcfd.counts.total,
    tcfdOpen: tcfd.counts.open,
    tcfdUndetermined: tcfd.counts.undetermined,
    tcfdIncompleteSiDing: tcfd.counts.incompleteSiDing,
    tcfdOverdue: tcfd.counts.overdue,
    inconsistent: inconsistent.length,
    undetermined: undetermined.length,
    noDuration: noDuration.length,
    noPercent: noPercent.length,
    planIssue: planIssues.length,
    duplicated: [...seen.values()].filter((v) => v > 1).length,
    weightedSample: weighted.length,
  };

  const overall = {
    percent: overallPct,
    basis: '总体完成比例 = Σ(工期 × 完成比例) ÷ Σ(工期)，仅统计状态有效（未开工/施工中/已完工/已中交/已开工/已中止）、无状态-比例矛盾、且工期与完成比例均有值的项目',
    weightedSample: weighted.length,
    weightedTotal: active.length,
    weightSumDays: weightSum || null,
    excludedNoDuration: noDuration.map((p) => ({ no: p.no, name: p.name, percent: p.percent, reason: '工期缺失或无法解析，不参与加权' })),
    excludedNoPercent: noPercent.map((p) => ({ no: p.no, name: p.name, status: p.status, qualitative: p.percentQualitative, reason: '完成比例未填报，不参与加权，不按 0 计' })),
    excludedInconsistent: inconsistent.map((x) => ({ no: x.no, name: x.name, reason: '状态与完成比例矛盾，不参与加权' })),
    calendarPercent: calendarPct,
    calendarBasis: totalCalDays !== null && totalCalDays > 0
      ? `大检修计划 ${taStart} ~ ${taEnd} 共 ${totalCalDays} 天，截至 ${date} 已过 ${Math.max(0, elapsed)} 天`
      : `大检修计划 ${taStart} ~ ${taEnd} 跨度为 0 天，日历进度不测算`,
    linearCheck: linear,
    byDiscipline, byStatus,
    disclaimer: DISCLAIMER,
  };

  // ---- 产出
  C.ensureDir(outDir);
  const result = {
    meta: {
      workshop: a.workshop, project: a.project, date,
      planStart: taStart, planEnd: taEnd, lagDays, linearCheck: linear,
      critical: [...criticalSet], criticalMissing,
      prevFile: a.prev ? path.basename(a.prev) : null,
      source: path.basename(a.input), generatedAt: C.localDateTime(),
      materialProvided, manpowerProvided, readyProvided, tcfdProvided: tcfd.provided,
      statusEnum: STATUS_ENUM,
      disclaimer: DISCLAIMER,
    },
    counts, overall, byProject, lagging, criticalLagging, notStarted,
    readyGap, materialGap, manpower, tcfd, inconsistent, unknownStatus,
    undetermined, planIssues, missingPlan, dayChange, warnings,
  };
  fs.writeFileSync(path.join(outDir, 'progress.json'), JSON.stringify(result, null, 2), 'utf8');

  // ---- progress.md
  const pctCell = (p) => (p.percent === null ? '—' : `${p.percent}%`);
  const star = (x) => (x ? '★' : '');
  const L = [];
  L.push(`# ${a.workshop} ${a.project} 检修进度（截至 ${date}）`);
  L.push('');
  L.push(`数据来源：${path.basename(a.input)} ｜ 大检修计划：${taStart} ~ ${taEnd} ｜ 滞后判定阈值：${lagDays} 天 ｜ 线性进度核对：${linear ? '已启用（--linear-check）' : '未启用'}`);
  if (criticalSet.size) L.push(`关键路径项目：${[...criticalSet].join('、')}`);
  L.push(`生成时间：${C.localDateTime()}（北京时间）`);
  L.push('');
  L.push(`> ${DISCLAIMER}`);
  L.push('');
  L.push('## 一、总体进度');
  L.push('');
  L.push(C.mdTable(['指标', '数值'], [
    ['项目总数', counts.total],
    ['已完工（施工完工）', counts.done],
    ['已中交（中间交接）', counts.handedOver],
    ['已开工（中交后开车）', counts.startedUp],
    ['施工中', counts.running],
    ['未开工', counts.notStartedStatus],
    ['已中止', counts.suspended],
    ['取消', counts.cancelled],
    ['状态未知（单列）', counts.unknownStatus],
    ['总体完成比例（按工期加权）', C.pct(overallPct)],
    ['加权样本', `${weighted.length} / ${active.length}`],
    ['日历进度（计划期已过）', C.pct(calendarPct)],
    ['滞后项目', counts.lagging],
    ['其中关键路径', counts.criticalLagging],
    ['超计划开工日未开工', counts.notStarted],
    ['开工条件缺口', readyProvided ? counts.readyGap : '未提供'],
    ['材料到货缺口', materialProvided ? counts.materialGap : '未提供'],
    ['三查四定问题（未关闭 / 未判定 / 总数）', tcfd.provided ? `${counts.tcfdOpen} / ${counts.tcfdUndetermined} / ${counts.tcfdTotal}` : '未提供'],
    ['状态与完成比例矛盾', counts.inconsistent],
    ['未判定', counts.undetermined],
  ]));
  L.push(`加权口径：${overall.basis}。`);
  L.push('');
  L.push(`日历进度口径：${overall.calendarBasis}。日历进度仅作参照，**不得据此回填任何项目的完成比例**。`);
  L.push('');
  L.push('状态口径：「已中交」为中间交接（检修完工后交付工艺），「已开工」为中交后装置/设备开工（开车投用），两者都是大检修独立节点，不等于「已完工」。');
  L.push('');
  if (noDuration.length) {
    L.push(`**未参与加权（工期缺失）**：共 ${noDuration.length} 个项目工期缺失或无法解析，已排除在总体加权之外，单列如下，不按任何默认工期补齐。`);
    L.push('');
    L.push(C.mdTable(['项目编号', '项目名称', '状态', '完成比例', '说明'],
      noDuration.map((p) => [p.no, p.name || '—', p.status, pctCell(p), '工期缺失或无法解析，不参与加权'])));
  }
  if (noPercent.length) {
    L.push(`**未参与加权（完成比例未填报）**：共 ${noPercent.length} 个项目完成比例为空，按状态给定性进度，**未按 0 计，也未按工期线性推算**。`);
    L.push('');
    L.push(C.mdTable(['项目编号', '项目名称', '状态', '完成比例', '定性进度'],
      noPercent.map((p) => [p.no, p.name || '—', p.status, '—', p.percentQualitative || '—'])));
  }
  L.push('**按专业分布**');
  L.push('');
  L.push(C.mdTable(['专业', '项目数', '已完工/中交/开工', '施工中', '未开工', '加权样本', '完成比例'],
    byDiscipline.map((x) => [x.discipline, x.total, x.done, x.running, x.notStarted, `${x.weightedSample} / ${x.total}`, C.pct(x.percent)])));

  L.push('## 二、项目进度表');
  L.push('');
  L.push(C.mdTable(['项目编号', '项目名称', '位号', '专业', '状态', '完成比例', '应有进度', '偏差', '计划开工', '计划完工', '实际开工', '工期(天)', '承修单位', '责任人', '关键路径', '三查四定未关闭', '判定'],
    byProject.map((x) => [
      x.no, x.name || '—', x.tag || '—', x.discipline || '—',
      x.status || `${x.rawStatus || '（空）'}（未知）`,
      x.percent === null ? '—' : `${x.percent}%`,
      x.expectedPercent === null ? '—' : `${x.expectedPercent}%`,
      x.deviationPct === null ? '—' : `${x.deviationPct > 0 ? '+' : ''}${x.deviationPct}%`,
      x.planStart || '—', x.planEnd || '—', x.actStart || '—',
      C.fmt(x.duration), x.contractor || '—', x.owner || '—',
      star(x.critical), x.tcfdOpen || '',
      x.inconsistent ? '数据矛盾·单列' : (!x.judged ? '未判定' : (x.lagging ? `滞后 ${C.fmt(x.lagDays)} 天` : '正常')),
    ])));
  L.push(linear
    ? '_「应有进度」按计划开工~计划完工的日历推算（--linear-check），仅用于滞后判定，**不回填完成比例**；完成比例为空的项目显示「—」。_'
    : '_未启用 --linear-check，「应有进度」与「偏差」列显示「—」；完成比例为空的项目显示「—」，按状态给定性进度。_');
  L.push('');

  L.push('## 三、滞后项目');
  L.push('');
  L.push(linear
    ? `_判定口径：① 已过计划完工日仍未完工；② 超计划开工日 ${lagDays} 天及以上未开工；③ 完成比例落后应有进度且折算滞后 ${lagDays} 天及以上（--linear-check 已启用）。_`
    : `_判定口径：① 已过计划完工日仍未完工；② 超计划开工日 ${lagDays} 天及以上未开工。③ 完成比例落后应有进度未启用（需 --linear-check）。_`);
  L.push('');
  if (criticalLagging.length) {
    L.push(`### 【注意】关键路径滞后（${criticalLagging.length} 项，需优先处置）`);
    L.push('');
    L.push(C.mdTable(['项目编号', '项目名称', '状态', '完成比例', '应有进度', '滞后天数', '滞后类型', '测算依据', '承修单位/责任人', '条件缺口', '材料缺口', '三查四定未关闭', '备注'],
      criticalLagging.map((x) => [x.no, x.name || '—', x.status,
        x.percent === null ? '—' : `${x.percent}%`, x.expectedPercent === null ? '—' : `${x.expectedPercent}%`,
        C.fmt(x.lagDays), x.lagType, x.basis, x.party,
        x.readyGap ? '有' : '无', x.materialGap ? '有' : '无', x.tcfdOpen || '无', x.note])));
    L.push(`> 关键路径项目滞后直接影响大检修总工期。${DISCLAIMER}`);
    L.push('');
  } else if (criticalSet.size) {
    L.push('_关键路径项目本日无滞后。_');
    L.push('');
  }
  const otherLag = lagging.filter((x) => !x.critical);
  L.push(`### 其余滞后项目（${otherLag.length} 项）`);
  L.push('');
  if (!otherLag.length) L.push('_无_\n');
  else L.push(C.mdTable(['项目编号', '项目名称', '位号', '状态', '完成比例', '应有进度', '滞后天数', '滞后类型', '测算依据', '承修单位/责任人', '备注'],
    otherLag.map((x) => [x.no, x.name || '—', x.tag || '—', x.status,
      x.percent === null ? '—' : `${x.percent}%`, x.expectedPercent === null ? '—' : `${x.expectedPercent}%`,
      C.fmt(x.lagDays), x.lagType, x.basis, x.party, x.note])));
  L.push(`滞后天数与工期影响一律为测算值。${DISCLAIMER}`);
  L.push('');

  L.push('## 四、超计划开工日未开工');
  L.push('');
  if (!notStarted.length) L.push('_无_\n');
  else L.push(C.mdTable(['项目编号', '项目名称', '位号', '计划开工', '计划完工', '超期未开工(天)', '工期(天)', '承修单位/责任人', '条件缺口', '材料缺口', '关键路径', '备注'],
    notStarted.map((x) => [x.no, x.name || '—', x.tag || '—', x.planStart, x.planEnd || '—',
      x.overdueStartDays, C.fmt(x.duration), x.party, x.readyGap ? '有' : '无', x.materialGap ? '有' : '无',
      star(x.critical), x.note])));

  L.push('## 五、开工条件与材料缺口');
  L.push('');
  L.push('**开工条件缺口**');
  L.push('');
  if (!readyProvided) L.push('_未提供开工条件数据。_\n');
  else if (!readyGap.length) L.push('_无_\n');
  else L.push(C.mdTable(['项目编号', '项目名称', '条件项', '台账原文', '缺口原因', '责任单位', '责任人', '关键路径', '出处'],
    readyGap.map((x) => [x.no, x.name || '—', x.item, x.raw || '（空）', x.reason, x.unit || '—', x.owner || '—', star(x.critical), x.source])));
  L.push('**材料到货缺口**');
  L.push('');
  if (!materialProvided) L.push('_未提供材料到货数据。_\n');
  else if (!materialGap.length) L.push('_无_\n');
  else L.push(C.mdTable(['项目编号', '项目名称', '材料名称', '需求数量', '到货数量', '需求日期', '缺口原因', '判定依据', '关键路径', '出处'],
    materialGap.map((x) => [x.no, x.name || '—', x.material, C.fmt(x.need), C.fmt(x.arrived), x.needDate || '—', x.reason, x.basis, star(x.critical), x.source])));
  L.push('**人员到位情况**');
  L.push('');
  if (!manpowerProvided) L.push('_未提供人员到位数据。_\n');
  else if (!manpower.length) L.push('_无_\n');
  else L.push(C.mdTable(['项目编号', '项目名称', '承修单位', '计划人数', '到位人数', '缺口', '是否缺员'],
    manpower.map((x) => [x.no, x.name || '—', x.contractor || '—', C.fmt(x.plan), C.fmt(x.arrived), C.fmt(x.gap),
      x.shortage === null ? '未判定' : (x.shortage ? '是' : '否')])));

  L.push('## 六、三查四定问题');
  L.push('');
  L.push('_三查：查设计漏项、查未完工程、查工程质量；四定：定任务、定人员、定时间、定措施。四定不全、超期未关闭、关闭状态无法判定的问题均单列，**不按已关闭默认**；中交前三查四定问题应关闭或经指挥部确认留项。_');
  L.push('');
  if (!tcfd.provided) L.push('_未提供三查四定问题数据。_\n');
  else if (!tcfd.items.length) L.push('_三查四定问题表无记录。_\n');
  else {
    L.push(`共 ${counts.tcfdTotal} 项：未关闭 ${counts.tcfdOpen} 项（其中超期 ${counts.tcfdOverdue} 项）、已关闭 ${tcfd.counts.closed} 项、关闭状态未判定 ${counts.tcfdUndetermined} 项；四定不全 ${counts.tcfdIncompleteSiDing} 项。`);
    L.push('');
    L.push(C.mdTable(['问题编号', '项目编号', '位号', '类别', '问题描述', '整改措施', '责任单位/责任人', '整改期限', '整改状态（原文）', '判定', '四定', '关键路径', '出处'],
      tcfd.items.map((t) => [t.id, t.no || '—', t.tag || '—', t.category || '—', t.desc, t.measure || '（未定）',
        [t.unit, t.owner].filter(Boolean).join(' / ') || '（未定人员）', t.deadline || (t.deadlineRaw ? `${t.deadlineRaw}（无法解析）` : '（未定时间）'),
        t.status || '（空）',
        t.closed === true ? '已关闭' : (t.closed === false ? (t.overdue ? `**未关闭·超期 ${t.overdueDays} 天**` : '未关闭') : '**未判定**'),
        t.siDingComplete ? '齐全' : `**不全：缺${t.missingSiDing.join('、')}**`,
        star(t.critical), t.source])));
    if (counts.tcfdUndetermined) L.push('【未判定】关闭状态无法识别的问题既不代表已关闭，也不代表未关闭，需回问题台账核实后重跑。');
    L.push('');
  }

  L.push('## 七、数据矛盾与未判定项');
  L.push('');
  L.push('**完成比例与状态矛盾**');
  L.push('');
  L.push('_状态与完成比例相互冲突时，两个字段均按原值保留，**脚本不修正任一字段**，该项不参与总体加权与滞后判定，需回项目清单核实后重跑。_');
  L.push('');
  if (!inconsistent.length) L.push('_无_\n');
  else L.push(C.mdTable(['项目编号', '项目名称', '台账状态', '台账完成比例', '矛盾说明', '应有关系', '承修单位/责任人', '关键路径', '出处'],
    inconsistent.map((x) => [x.no, x.name || '—', `${x.status}（原文：${x.rawStatus || '（空）'}）`, `${x.percent}%（原文：${x.rawPercent || '（空）'}）`,
      x.conflict, x.expectation, [x.contractor, x.owner].filter(Boolean).join(' / ') || '—', star(x.critical), x.source])));
  L.push('**状态未知项目**');
  L.push('');
  L.push(`_状态取值不在「${STATUS_ENUM.join(' / ')}」枚举内，一律单列，不做就近映射。_`);
  L.push('');
  if (!unknownStatus.length) L.push('_无_\n');
  else L.push(C.mdTable(['项目编号', '项目名称', '台账原文', '完成比例', '未判定原因', '承修单位/责任人', '出处'],
    unknownStatus.map((x) => [x.no, x.name || '—', x.rawStatus || '（空）', x.percent === null ? '—' : `${x.percent}%`,
      x.reason, [x.contractor, x.owner].filter(Boolean).join(' / ') || '—', x.source])));
  L.push('**进度未判定项目**');
  L.push('');
  if (!undetermined.length) L.push('_无_\n');
  else L.push(C.mdTable(['项目编号', '项目名称', '状态', '完成比例', '定性进度', '未判定原因', '出处'],
    undetermined.map((x) => [x.no, x.name || '—', x.status || `${x.rawStatus || '（空）'}（未知）`,
      x.percent === null ? '—' : `${x.percent}%`, x.percentQualitative || '—', x.reason, x.source])));
  if (planIssues.length) {
    L.push('**计划节点异常**');
    L.push('');
    L.push(C.mdTable(['项目编号', '项目名称', '计划开工', '计划完工', '异常说明', '处理方式', '出处'],
      planIssues.map((x) => [x.no, x.name || '—', x.planStart || '—', x.planEnd || '—', x.issue, x.handling, x.source])));
  }

  L.push('## 八、本日进度变化');
  L.push('');
  if (!dayChange) L.push('_未提供上一日 progress.json（`--prev`），本次不做日进度对比。_\n');
  else {
    L.push(`对比基准：${dayChange.prevDate || '（上一日文件未记录日期）'} ｜ 总体完成比例 ${C.pct(dayChange.prevOverall)} → ${C.pct(dayChange.overall)}（增量 ${dayChange.overallDelta === null ? '—' : `${dayChange.overallDelta > 0 ? '+' : ''}${dayChange.overallDelta}%`}）`);
    L.push('');
    L.push(`${dayChange.note}`);
    L.push('');
    const chg = dayChange.items.filter((x) => x.delta !== null || x.statusChanged || x.remark);
    if (!chg.length) L.push('_本日各项目完成比例与状态均无变化。_\n');
    else L.push(C.mdTable(['项目编号', '项目名称', '上一日', '本日', '增量', '上一日状态', '本日状态', '说明'],
      chg.map((x) => [x.no, x.name || '—',
        x.prevPercent === null ? '—' : `${x.prevPercent}%`, x.percent === null ? '—' : `${x.percent}%`,
        x.delta === null ? '—' : `${x.delta > 0 ? '+' : ''}${x.delta}%`,
        x.prevStatus || '—', x.status || '—', x.statusChanged ? '状态变更' : (x.remark || '')])));
    if (dayChange.nodeChanged.length) {
      L.push(`**本日到达中交/开工节点**：${dayChange.nodeChanged.map((x) => `${x.no} ${x.name}（${x.from || '—'} → ${x.to}）`).join('；')}`);
      L.push('');
    }
    if (dayChange.stagnant.length) {
      L.push(`**本日零进度（施工中/已中止但完成比例未变）**：共 ${dayChange.stagnant.length} 项`);
      L.push('');
      L.push(C.mdTable(['项目编号', '项目名称', '状态', '完成比例', '责任方', '关键路径'],
        dayChange.stagnant.map((x) => [x.no, x.name || '—', x.status, `${x.percent}%`, x.party, star(x.critical)])));
    }
    if (dayChange.newProjects.length) {
      L.push(`**本日新增项目**：${dayChange.newProjects.map((x) => `${x.no} ${x.name}`).join('；')}`);
      L.push('');
    }
    if (dayChange.dropped.length) {
      L.push(`**上一日存在、本日清单缺失**（未按完工或取消处理，请核实）：${dayChange.dropped.map((x) => `${x.no} ${x.name}`).join('；')}`);
      L.push('');
    }
  }

  L.push('## 九、进度说明');
  L.push('');
  L.push('<!-- ANALYSIS_START -->');
  L.push('（由模型依据 references/turnaround-rules.md 口径撰写 250~400 字，结构：总体进度（含中交/开工节点）→ 滞后项目与影响（关键路径优先）→ 资源与条件缺口 → 三查四定问题 → 本日完成情况 → 明日重点。比例、天数一律引用 progress.json；滞后影响工期的判断须注明「基于计划节点测算，最终以指挥部判定为准」；状态与完成比例矛盾的项目只陈述矛盾、不自行取舍；完成比例为空的项目写「未填报」并给定性进度，不得按 0 或按工期推算；三查四定关闭状态未判定的不得写成已关闭。）');
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
  L.push('本材料由脚本汇总、模型成文，仅供设备员复核参考，不替代审批、定性、验收与签字；厂内制度与系统数据为准。');
  L.push('');
  fs.writeFileSync(path.join(outDir, 'progress.md'), L.join('\n'), 'utf8');

  // ---- 进度表.xlsx（一张表，可直接上早晚会）
  const xrows = [
    [`${a.workshop} ${a.project} 检修进度表（截至 ${date}）`],
    [`大检修计划 ${taStart} ~ ${taEnd} ｜ 总体完成比例（按工期加权）${C.pct(overallPct)}（加权样本 ${weighted.length}/${active.length}）｜ 已中交 ${counts.handedOver} 项 ｜ 已开工 ${counts.startedUp} 项 ｜ 滞后 ${counts.lagging} 项（关键路径 ${counts.criticalLagging} 项）｜ 条件缺口 ${readyProvided ? counts.readyGap : '未提供'} ｜ 材料缺口 ${materialProvided ? counts.materialGap : '未提供'} ｜ 三查四定未关闭 ${tcfd.provided ? counts.tcfdOpen : '未提供'} ｜ 数据矛盾 ${counts.inconsistent} 项`],
    [DISCLAIMER],
    [],
    ['项目编号', '项目名称', '位号', '专业', '状态', '完成比例', '应有进度', '偏差', '计划开工', '计划完工', '实际开工', '实际完工', '工期(天)', '承修单位', '责任人', '关键路径', '滞后天数', '滞后类型', '条件缺口', '材料缺口', '三查四定未关闭', '判定/说明', '备注'],
  ];
  for (const x of byProject) {
    xrows.push([
      x.no, x.name || '', x.tag || '', x.discipline || '',
      x.status || `${x.rawStatus || '（空）'}（未知状态·单列）`,
      x.percent === null ? '—' : `${x.percent}%`,
      x.expectedPercent === null ? '—' : `${x.expectedPercent}%`,
      x.deviationPct === null ? '—' : `${x.deviationPct > 0 ? '+' : ''}${x.deviationPct}%`,
      x.planStart || '—', x.planEnd || '—', x.actStart || '—', x.actEnd || '—',
      x.duration === null ? '—' : x.duration,
      x.contractor || '', x.owner || '', x.critical ? '★关键路径' : '',
      x.lagDays === null ? '—' : x.lagDays, x.lagType || '',
      x.readyGap ? '有' : '', x.materialGap ? '有' : '', x.tcfdOpen || '',
      x.inconsistent ? `数据矛盾·单列：${x.inconsistent}` : (!x.judged ? `未判定：${x.undeterminedReason || ''}` : (x.lagging ? '滞后' : '正常')),
      x.note || (x.percentQualitative || ''),
    ]);
  }
  xrows.push([]);
  xrows.push(['说明：完成比例为空显示「—」，按状态给定性进度，未按 0 也未按工期线性推算；状态与完成比例矛盾的项目两字段均按原值保留，脚本未作修正；应有进度仅在 --linear-check 启用时按计划节点日历推算，只用于滞后判定，不回填完成比例；「已中交」「已开工」为大检修独立节点，不等于已完工。']);
  const sheets = { '进度表': xrows };
  if (tcfd.provided && tcfd.items.length) {
    sheets['三查四定问题'] = [
      ['问题编号', '项目编号', '位号', '类别', '问题描述', '整改措施', '责任单位', '责任人', '整改期限', '整改状态（原文）', '判定', '四定', '关键路径', '出处'],
      ...tcfd.items.map((t) => [t.id, t.no, t.tag, t.category, t.desc, t.measure, t.unit, t.owner, t.deadline || t.deadlineRaw, t.status,
        t.closed === true ? '已关闭' : (t.closed === false ? (t.overdue ? `未关闭·超期 ${t.overdueDays} 天` : '未关闭') : '未判定'),
        t.siDingComplete ? '齐全' : `不全：缺${t.missingSiDing.join('、')}`, t.critical ? '★' : '', t.source]),
    ];
  }
  writeXlsx(path.join(outDir, '进度表.xlsx'), sheets);

  C.emitOk(outDir, {
    ok: true, out: outDir, date, workshop: a.workshop, project: a.project,
    planStart: taStart, planEnd: taEnd, linearCheck: linear,
    overall: { percent: overallPct, weightedSample: weighted.length, weightedTotal: active.length, calendarPercent: calendarPct },
    counts,
    dayChange: dayChange ? { prevDate: dayChange.prevDate, overallDelta: dayChange.overallDelta, advancedCount: dayChange.advancedCount, stagnantCount: dayChange.stagnant.length, nodeChangedCount: dayChange.nodeChanged.length } : null,
    disclaimer: DISCLAIMER,
    warnings,
  });
}

try { main(); } catch (e) { C.fail(e, warnings); }
