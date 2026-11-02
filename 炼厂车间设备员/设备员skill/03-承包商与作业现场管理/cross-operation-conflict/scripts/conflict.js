#!/usr/bin/env node
'use strict';
/**
 * 交叉作业冲突检测脚本（仅 Node.js 内置模块）
 * 用法：node "<技能目录>/scripts/conflict.js" --input <作业清单xlsx> --workshop "常减压车间" --date 2026-09-21 [--out <dir>]
 *       [--area-map <区域划分表xlsx>] [--rules <厂内冲突口径xlsx>] [--window <重叠判定分钟数>] [--radius <相邻区域判定说明>]
 *       [--floor-height <层高米数，默认 4，仅用于「3层」这类标高写法的折算>]
 * 产出：<out>/conflicts.json、<out>/conflicts.md、<out>/summary.json；末行打印 JSON 摘要
 *
 * 中石化口径（见顶层《中石化口径对照.md》）：
 *   - 列名接作业许可（电子作业票）系统导出：许可证编号 / 作业类别 / 作业地点 / 属地监护人 / 作业单位监护人（双监护，两列都参与 Z1）
 *   - 术语「用火作业」；同位号受限空间 + 用火的双票作业是合法常态 → 提示项，不计冲突
 *   - 电源回路 / 消防覆盖区两列在作业许可系统导出中通常缺省，缺列时 Z3/Z4 不判、只提示一次，不算数据问题
 *   - --rules 厂内口径真实生效：可覆盖规则严重度 / 启用 / 建议措辞，不新增规则；模板见 assets/templates/rules-template.xlsx
 *   - 归口：交叉作业的最终安排与许可由安全环保部门按厂内制度决定
 */
const fs = require('fs');
const path = require('path');
const { readXlsx, readCsvDir } = require('./lib/xlsx-lite');
const C = require('./lib/common');
const R = require('./lib/rules');

const warnings = [];
const num = C.makeNum(warnings);
const VALUE_OPTS = ['input', 'workshop', 'date', 'out', 'area-map', 'rules', 'window', 'radius', 'floor-height'];
const FLAG_OPTS = ['help'];

const DISCLAIMER = '本检测为辅助排查，交叉作业的最终安排与许可由安全环保部门按厂内制度决定；未列出的冲突不代表不存在。';

/** 列名别名：局部 + 共享 SYSTEM_ALIASES（作业许可系统 / SAP PM 列名），局部优先。
 *  注意：局部「位号」保留「设备编号」作别名（作业票上常把位号写在"设备编号"栏），本技能不区分 SAP 8 位设备编号与位号。*/
const ALIASES = C.mergeAliases({
  '作业编号': ['作业编号', '作业票号', '票号', '编号', '许可证编号', '作业许可证编号', '许可证号', '作业证号'],
  '作业类型': ['作业类型', '作业类别', '许可类别', '作业种类', '作业内容', '类型', '作业项目', '作业名称', '工作内容'],
  '位号': ['位号', '设备位号', '设备编号', '作业位号', '功能位置', 'TAG', 'tag'],
  '区域': ['区域', '装置区', '作业区域', '作业地点', '作业位置', '作业部位', '位置', '所在区域', '框架'],
  '标高': ['标高', '高度', '层级', '楼层', '作业标高', '标高(m)'],
  '开始时间': ['开始时间', '起始时间', '计划开始', '作业开始', '开工时间', '有效期自', '许可开始'],
  '结束时间': ['结束时间', '终止时间', '计划结束', '作业结束', '完工时间', '有效期至', '许可结束'],
  '作业单位': ['作业单位', '施工单位', '承包商', '承修单位', '作业单位名称', '单位', '队伍'],
  '监护人': ['监护人', '监护', '安全监护人', '看火人', '监火人', '用火监护人'],
  '属地监护人': ['属地监护人', '属地监护', '车间监护人', '监护人（属地）'],
  '作业单位监护人': ['作业单位监护人', '作业监护人', '施工监护人', '承包商监护人'],
  '涉及介质': ['涉及介质', '介质', '物料', '工艺介质', '残余介质'],
  '使用设备': ['使用设备', '起重设备', '机具', '施工机具', '设备'],
  '所属系统': ['所属系统', '系统', '工艺系统', '单元'],
  '电源回路': ['电源回路', '回路', '配电箱', '电源', '供电回路'],
  '消防覆盖区': ['消防覆盖区', '消防区域', '消防设施', '消防覆盖'],
  '作业内容描述': ['作业内容描述', '作业描述', '备注', '说明'],
});
/** 作业许可系统导出中通常缺省的列：缺列不算数据问题，只提示一次 */
const USUALLY_ABSENT = ['电源回路', '消防覆盖区'];

function loadBook(p) { return fs.statSync(p).isDirectory() ? readCsvDir(p) : readXlsx(p); }

/** 标高解析：支持 "12.5"、"12.5m"、"+8.0"；"3层/三层" 按 --floor-height（默认 4 米）折算并标「推断，待确认」；无法解析时 warning 且返回 null，绝不按 0 */
let FLOOR_HEIGHT = 4;
const floorDerived = [];
function parseElev(v, ctx) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = C.str(v);
  if (s === '' || s === '—' || s === '-' || s === '/' || s === '无') return null;
  const m = s.match(/^([+-]?\d+(?:\.\d+)?)\s*(m|M|米|米标高)?$/);
  if (m) return Number(m[1]);
  const fl = s.match(/^(\d+)\s*(层|F|f)$/);
  if (fl) { if (ctx) floorDerived.push({ id: ctx.id, raw: s, elev: Number(fl[1]) * FLOOR_HEIGHT }); return Number(fl[1]) * FLOOR_HEIGHT; }
  const cnFloor = { 一层: 1, 二层: 2, 三层: 3, 四层: 4, 五层: 5, 六层: 6 };
  if (cnFloor[s] !== undefined) { if (ctx) floorDerived.push({ id: ctx.id, raw: s, elev: cnFloor[s] * FLOOR_HEIGHT }); return cnFloor[s] * FLOOR_HEIGHT; }
  const cn = { 地面: 0, 地坪: 0, 零米: 0, 地下: -3 };
  if (cn[s] !== undefined) return cn[s];
  if (ctx) warnings.push(`工作表「${ctx.sheet}」第${ctx.row}行 标高「${s}」无法解析为数值，该作业的上下层关系将标为未判定`);
  return null;
}

function main() {
  const a = C.parseArgs(process.argv.slice(2), VALUE_OPTS, FLAG_OPTS);
  if (!a.input) throw new Error('缺少 --input');
  if (!a.workshop) throw new Error('缺少 --workshop');
  if (!a.date) throw new Error('缺少 --date');
  const date = C.normDate(a.date);
  if (!date) throw new Error(`--date 「${a.date}」不是有效日期，应为 YYYY-MM-DD`);
  if (!fs.existsSync(a.input)) throw new Error(`输入不存在: ${a.input}`);

  let windowMin = 0;
  if (a.window !== undefined) {
    if (!/^\d+$/.test(String(a.window).trim())) throw new Error(`--window 「${a.window}」应为非负整数（重叠判定分钟数）`);
    windowMin = Number(a.window);
  }

  if (a['floor-height'] !== undefined) {
    const fh = Number(String(a['floor-height']).trim());
    if (!Number.isFinite(fh) || fh <= 0) throw new Error(`--floor-height 「${a['floor-height']}」应为正数（层高米数）`);
    FLOOR_HEIGHT = fh;
  }
  const outDir = a.out || path.join(path.dirname(a.input), 'coc-out');

  // ---- 区域划分表（可选）：位号 → 区域
  let areaMap = null;
  if (a['area-map']) {
    if (!fs.existsSync(a['area-map'])) throw new Error(`区域划分表不存在: ${a['area-map']}`);
    const rows = C.pickSheet(loadBook(a['area-map']), '区域划分', '区域', '区域表');
    if (!rows) warnings.push('区域划分表文件中未找到「区域划分」工作表，跳过位号补区域');
    else {
      const recs = C.toRecords(rows, ['位号', '区域'], '区域划分', ['所属系统'], warnings, ALIASES);
      areaMap = new Map();
      for (const r of recs) {
        const t = C.str(r['位号']);
        if (t) areaMap.set(t, { area: C.str(r['区域']), system: C.str(r['所属系统']) });
      }
    }
  }

  // ---- 厂内冲突口径（可选，--rules）：覆盖内置规则的 严重度 / 启用 / 建议措辞，不新增规则；模板 assets/templates/rules-template.xlsx
  let rulesSource = '内置默认冲突矩阵（references/conflict-rules.md，默认口径，非厂内正式口径）';
  let overrides = null;
  let rulesApplied = [];
  if (a.rules) {
    if (!fs.existsSync(a.rules)) throw new Error(`厂内冲突口径文件不存在: ${a.rules}`);
    let rb;
    try { rb = loadBook(a.rules); } catch (e) { throw new Error(`厂内冲突口径文件读取失败 ${a.rules}: ${e.message}`); }
    const rr = C.pickSheet(rb, '冲突口径', '口径', '冲突规则', '规则');
    if (!rr) warnings.push(`厂内冲突口径文件「${path.basename(a.rules)}」中未找到「冲突口径」工作表，仍按内置默认矩阵`);
    else {
      const RULE_ALIASES = C.mergeAliases({
        '规则号': ['规则号', '规则', '规则编号', '编号'],
        '严重度': ['严重度', '严重程度', '等级', '级别'],
        '启用': ['启用', '是否启用', '生效', '是否生效'],
        '建议': ['建议', '协调建议', '建议措辞', '措施'],
      });
      const recs = C.toRecords(rr, ['规则号'], '冲突口径', ['严重度', '启用', '建议'], warnings, RULE_ALIASES);
      const res = R.applyRuleOverrides(recs.map((r) => ({ ruleId: C.str(r['规则号']), severity: C.str(r['严重度']), enabled: C.str(r['启用']), advice: C.str(r['建议']) })));
      for (const ig of res.ignored) warnings.push(`冲突口径「${path.basename(a.rules)}」：${ig}`);
      if (res.applied.length) {
        overrides = res.overrides;
        rulesApplied = res.applied;
        rulesSource = `厂内口径（${path.basename(a.rules)}）覆盖规则 ${res.applied.join('、')} 的严重度/启用/建议；其余按内置默认矩阵`;
      } else {
        warnings.push(`厂内冲突口径文件「${path.basename(a.rules)}」中无可用的覆盖行，仍按内置默认矩阵`);
      }
    }
  }
  const ruleEnabled = (id) => !(overrides && overrides[id] && overrides[id].enabled === false);
  const sevOf = (id, dft) => (overrides && overrides[id] && overrides[id].severity) || dft;

  // ---- 读取作业清单
  const rows = C.pickSheet(loadBook(a.input), '作业清单', '作业', '作业票', '作业计划');
  if (!rows) throw new Error('输入文件中未找到「作业清单」工作表');
  const recs = C.toRecords(rows, ['作业编号', '作业类型'], '作业清单',
    ['位号', '区域', '标高', '开始时间', '结束时间', '作业单位', '监护人', '属地监护人', '作业单位监护人', '涉及介质', '使用设备',
      '所属系统', '电源回路', '消防覆盖区', '作业内容描述'], warnings, ALIASES);
  // 电源回路 / 消防覆盖区在作业许可系统导出中通常缺省：缺列不算数据问题，把 toRecords 的缺列提示改为一次性说明
  const absent = USUALLY_ABSENT.filter((c) => !recs.hasCol(c));
  if (absent.length) {
    for (let i = warnings.length - 1; i >= 0; i--) if (absent.some((c) => warnings[i].includes(`「${c}」`) && /缺|未找到|没有/.test(warnings[i]))) warnings.splice(i, 1);
    warnings.push(`作业清单无「${absent.join('」「')}」列（作业许可系统导出通常缺省，属正常），对应的 ${absent.map((c) => (c === '电源回路' ? 'Z3' : 'Z4')).join('/')} 资源冲突本次不判`);
  }
  const dualGuard = recs.hasCol('属地监护人') || recs.hasCol('作业单位监护人');

  const works = [];
  const skipped = [];
  for (const r of recs) {
    const id = C.str(r['作业编号']);
    if (!id) { warnings.push(`工作表「作业清单」第${r._row}行 作业编号为空，已跳过`); continue; }
    const typeText = `${C.str(r['作业类型'])} ${C.str(r['作业内容描述'])}`;
    const types = R.classifyTypes(typeText);
    const start = C.normDateTime(r['开始时间']);
    const end = C.normDateTime(r['结束时间']);
    if (r['开始时间'] && !start) warnings.push(`工作表「作业清单」第${r._row}行 开始时间「${C.str(r['开始时间'])}」无法解析`);
    if (r['结束时间'] && !end) warnings.push(`工作表「作业清单」第${r._row}行 结束时间「${C.str(r['结束时间'])}」无法解析`);
    if (!start) warnings.push(`作业「${id}」开始时间缺失或无法解析，与其他作业的时段关系将标为未判定`);
    if (!end) warnings.push(`作业「${id}」结束时间缺失或无法解析，与其他作业的时段关系将标为未判定`);
    if (start && end && R.toMinutes(end) <= R.toMinutes(start)) {
      warnings.push(`作业「${id}」结束时间不晚于开始时间（${start} → ${end}），请核实作业票时段`);
    }
    if (start && start.slice(0, 10) !== date && end && end.slice(0, 10) !== date) {
      warnings.push(`作业「${id}」起止时间（${start} → ${end}）均不在检测日期 ${date}，已跳过`);
      skipped.push({ id, start, end, reason: `起止时间均不在检测日期 ${date}` });
      continue;
    }

    const tag = C.str(r['位号']);
    let area = C.str(r['区域']);
    let system = C.str(r['所属系统']);
    if (!area && areaMap && tag && areaMap.has(tag)) {
      area = areaMap.get(tag).area;
      warnings.push(`作业「${id}」区域字段为空，已按区域划分表由位号 ${tag} 补为「${area}」`);
    } else if (!area && areaMap && tag && !areaMap.has(tag)) {
      warnings.push(`作业「${id}」区域字段为空，且位号 ${tag} 不在区域划分表中，空间关系标为未判定`);
    } else if (!area) {
      warnings.push(`作业「${id}」区域字段为空，与其他作业的空间关系一律标为未判定，不得按不在同一区域处理`);
    }
    if (!system && areaMap && tag && areaMap.has(tag)) system = areaMap.get(tag).system;

    const elev = parseElev(r['标高'], { sheet: '作业清单', row: r._row, id });
    if (elev === null && C.str(r['标高']) === '') {
      warnings.push(`作业「${id}」标高字段为空，同区域内的上下层关系标为未判定`);
    }

    const medium = C.str(r['涉及介质']);
    const flammable = R.mediumFlammable(medium);
    if (types.includes('purge') && flammable === null) {
      warnings.push(`作业「${id}」为吹扫置换/排放类但涉及介质为空或不在可燃性库中，相关风险冲突标为未判定`);
    }

    works.push({
      id, tag, area, system, elev, start, end,
      rawType: C.str(r['作业类型']), desc: C.str(r['作业内容描述']),
      types, typeCn: types.map((t) => R.TYPE_CN[t]).join('＋'),
      unit: C.str(r['作业单位']),
      // 双监护：属地监护人 + 作业单位监护人 + 通用监护人列，合并后全部参与 Z1 同一监护人判定
      guard: [C.str(r['监护人']), C.str(r['属地监护人']), C.str(r['作业单位监护人'])].filter(Boolean).join('、'),
      guardSite: C.str(r['属地监护人']) || null, guardUnit: C.str(r['作业单位监护人']) || null,
      medium, flammable,
      craneId: C.str(r['使用设备']), circuit: C.str(r['电源回路']), fireCover: C.str(r['消防覆盖区']),
      row: r._row,
    });
  }
  if (!works.length) throw new Error('作业清单中没有可检测的作业记录（作业编号均为空，或起止时间均不在检测日期）');

  if (floorDerived.length) warnings.push(`${floorDerived.length} 项作业的标高按「层」写法折算（层高按 ${FLOOR_HEIGHT} 米，--floor-height 可调）：${floorDerived.map((x) => `${x.id}「${x.raw}」→ ${x.elev} 米`).join('；')}，为推断值，待确认`);
  const dupIds = works.map((w) => w.id).filter((x, i, arr) => arr.indexOf(x) !== i);
  for (const d of [...new Set(dupIds)]) warnings.push(`作业编号「${d}」在清单中重复出现，请核实是否为同一张作业票`);

  // ---- 两两比对
  const spatialConflicts = [], riskConflicts = [], undetermined = [], advisories = [];
  for (let i = 0; i < works.length; i++) {
    for (let j = i + 1; j < works.length; j++) {
      const A = works[i], B = works[j];
      const ov = R.timeOverlap(A, B, windowMin);
      const rel = R.spatialRelation(A, B);
      const pairLabel = `${A.id} × ${B.id}`;

      // 时段未判定：无论空间关系如何都单列，不得按不重叠跳过
      if (ov.overlap === null) {
        undetermined.push({
          kind: 'time', pair: [A.id, B.id], pairLabel,
          works: [briefOf(A), briefOf(B)],
          missing: [!A.start || !A.end ? `${A.id} 起止时间` : null, !B.start || !B.end ? `${B.id} 起止时间` : null].filter(Boolean),
          reason: ov.reason,
          note: '时段关系无法判定，本组是否构成交叉作业需补充起止时间后重新检测；不得按不重叠处理',
        });
        continue;
      }
      if (!ov.overlap) continue;

      // 空间关系未判定：单列，不得按「不在同一区域」处理
      if (rel.undetermined) {
        undetermined.push({
          kind: 'space', pair: [A.id, B.id], pairLabel,
          works: [briefOf(A), briefOf(B)],
          missing: rel.missing, overlapMinutes: ov.minutes, overlapReason: ov.reason,
          reason: rel.note,
          note: rel.missing.some((m) => m.includes('区域'))
            ? '空间关系无法判定，不得按不在同一区域处理；请补充区域字段后重新检测'
            : '上下层关系无法判定，不得按同层或无落物风险处理；请补充标高字段后重新检测',
        });
      }

      // 空间冲突
      for (const s of R.spatialRules(A, B, rel)) {
        if (!ruleEnabled(s.ruleId)) continue;
        spatialConflicts.push({
          ruleId: s.ruleId, severity: sevOf(s.ruleId, s.severity), title: s.title,
          pair: [A.id, B.id], pairLabel, works: [briefOf(A), briefOf(B)],
          relation: rel.relation, relationCn: rel.relationCn,
          overlapMinutes: ov.minutes, overlapReason: ov.reason,
          note: s.note, advice: R.adviceFor(s.ruleId, overrides),
        });
      }

      // 风险冲突（含同位号双票作业提示项）
      const rc = R.riskConflicts(A, B, rel, overrides);
      for (const h of rc.hits) {
        riskConflicts.push({
          ruleId: h.ruleId, severity: h.severity, title: h.title,
          pair: [A.id, B.id], pairLabel, works: [briefOf(A), briefOf(B)],
          relationCn: rel.relationCn, overlapMinutes: ov.minutes, overlapReason: ov.reason,
          note: h.note, advice: R.adviceFor(h.ruleId, overrides),
        });
      }
      for (const adv of rc.advisories) {
        advisories.push({
          ruleId: adv.ruleId, severity: '提示', title: adv.title,
          pair: [A.id, B.id], pairLabel, works: [briefOf(A), briefOf(B)],
          relationCn: rel.relationCn, overlapMinutes: ov.minutes, overlapReason: ov.reason,
          note: adv.note, advice: R.adviceFor('R2-ADV'),
          notConflict: true,
        });
      }
      for (const u of rc.undetermined) {
        undetermined.push({
          kind: 'risk', ruleId: u.ruleId, title: u.title,
          pair: [A.id, B.id], pairLabel, works: [briefOf(A), briefOf(B)],
          missing: u.missing, overlapMinutes: ov.minutes, overlapReason: ov.reason,
          reason: u.note,
          note: '风险冲突判定所需字段缺失，该冲突项标为未判定；不得因缺数据判定为无冲突',
        });
      }
    }
  }

  // ---- 资源冲突：同一资源被多项同时段作业占用
  const resourceConflicts = [];
  for (const f of R.RESOURCE_FIELDS) {
    if (!ruleEnabled(f.ruleId)) continue;
    const byVal = new Map();
    for (const w of works) {
      const v = w[f.key];
      if (!v) continue;
      for (const one of v.split(/[、，,;；\/]/).map((x) => x.trim()).filter(Boolean)) {
        if (!byVal.has(one)) byVal.set(one, []);
        byVal.get(one).push(w);
      }
    }
    for (const [val, list] of byVal) {
      if (list.length < 2) continue;
      const pairs = [];
      let anyUndet = false;
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const ov = R.timeOverlap(list[i], list[j], windowMin);
          if (ov.overlap === null) { anyUndet = true; continue; }
          if (ov.overlap) pairs.push({ pair: [list[i].id, list[j].id], overlapMinutes: ov.minutes, overlapReason: ov.reason });
        }
      }
      if (pairs.length) {
        resourceConflicts.push({
          ruleId: f.ruleId, severity: sevOf(f.ruleId, f.severity), title: `${f.label}资源冲突`,
          resourceType: f.label, resource: val,
          works: list.filter((w) => pairs.some((p) => p.pair.includes(w.id))).map(briefOf),
          overlapPairs: pairs, note: f.key === 'guard' && dualGuard ? `${f.note}（已合并属地监护人与作业单位监护人两列比对）` : f.note, advice: R.adviceFor(f.ruleId, overrides),
        });
      }
      if (anyUndet) {
        undetermined.push({
          kind: 'resource', ruleId: f.ruleId, title: `${f.label}资源冲突`,
          pair: list.map((w) => w.id), pairLabel: list.map((w) => w.id).join(' × '),
          works: list.map(briefOf),
          missing: list.filter((w) => !w.start || !w.end).map((w) => `${w.id} 起止时间`),
          reason: `${f.label}「${val}」被多项作业占用，但其中作业起止时间缺失，无法判定是否同时段`,
          note: '资源占用是否冲突无法判定，不得按无冲突处理',
        });
      }
    }
  }

  // ---- 排序：严重度高者在前
  const bySev = (x, y) => (R.SEV_ORDER[y.severity] || 0) - (R.SEV_ORDER[x.severity] || 0) || String(x.pairLabel || x.resource).localeCompare(String(y.pairLabel || y.resource), 'zh');
  spatialConflicts.sort(bySev);
  riskConflicts.sort(bySev);
  resourceConflicts.sort(bySev);

  // ---- 时段重叠视图（timeline）
  const timeline = works
    .map((w) => ({
      id: w.id, typeCn: w.typeCn, area: w.area || null, elev: w.elev,
      start: w.start, end: w.end, unit: w.unit || null, guard: w.guard || null,
      startMin: R.toMinutes(w.start), endMin: R.toMinutes(w.end),
      concurrent: [],
      timeUndetermined: !w.start || !w.end,
    }))
    .sort((x, y) => (x.startMin === null ? 1 : y.startMin === null ? -1 : x.startMin - y.startMin) || String(x.id).localeCompare(String(y.id), 'zh'));
  for (const t of timeline) {
    for (const o of timeline) {
      if (o.id === t.id) continue;
      const ov = R.timeOverlap(
        { start: t.start, end: t.end }, { start: o.start, end: o.end }, windowMin);
      if (ov.overlap === true) t.concurrent.push(o.id);
    }
  }
  // 重叠时段分段：按所有端点切分，统计每段并行作业数
  const marks = [...new Set(timeline.filter((t) => t.startMin !== null && t.endMin !== null).flatMap((t) => [t.startMin, t.endMin]))].sort((x, y) => x - y);
  const segments = [];
  for (let i = 0; i < marks.length - 1; i++) {
    const s = marks[i], e = marks[i + 1];
    const inSeg = timeline.filter((t) => t.startMin !== null && t.startMin < e && t.endMin > s);
    if (!inSeg.length) continue;
    segments.push({
      start: minToText(s), end: minToText(e), minutes: e - s,
      count: inSeg.length, works: inSeg.map((t) => t.id),
    });
  }

  const sevCount = (arr, s) => arr.filter((x) => x.severity === s).length;
  const allConf = [...spatialConflicts, ...riskConflicts, ...resourceConflicts];
  const counts = {
    works: works.length,
    skipped: skipped.length,
    spatial: spatialConflicts.length,
    risk: riskConflicts.length,
    resource: resourceConflicts.length,
    total: allConf.length,
    high: sevCount(allConf, '高'),
    medium: sevCount(allConf, '中'),
    low: sevCount(allConf, '低'),
    undetermined: undetermined.length,
    advisory: advisories.length,
    maxConcurrent: segments.length ? Math.max(...segments.map((s) => s.count)) : (timeline.length ? 1 : 0),
  };

  // ---- 产出
  C.ensureDir(outDir);
  const result = {
    meta: {
      workshop: a.workshop, date, generatedAt: C.localDateTime(),
      windowMinutes: windowMin, radius: a.radius || null, floorHeight: FLOOR_HEIGHT,
      rulesSource, rulesApplied, rulesFile: a.rules ? path.basename(a.rules) : null, areaMapProvided: !!a['area-map'],
      dualGuard, absentColumns: absent,
      disclaimer: DISCLAIMER,
    },
    counts, works: works.map(briefOf),
    spatialConflicts, riskConflicts, resourceConflicts, advisories, undetermined,
    timeline, segments, skipped, warnings,
  };
  fs.writeFileSync(path.join(outDir, 'conflicts.json'), JSON.stringify(result, null, 2), 'utf8');

  const L = [];
  L.push(`# ${a.workshop} 交叉作业冲突检测（${date}）`);
  L.push('');
  L.push(`作业清单：${path.basename(a.input)}　｜　时段重叠判定：${windowMin === 0 ? '严格重叠（--window 0）' : `间隔 ${windowMin} 分钟内视为重叠（--window ${windowMin}）`}`);
  L.push(`判定口径：${rulesSource}${a.radius ? `　｜　相邻区域口径：${a.radius}` : ''}`);
  L.push(`生成时间：${C.localDateTime()}（北京时间）`);
  L.push('');
  L.push(`> ${DISCLAIMER}`);
  L.push('');
  L.push('## 一、检测概览');
  L.push('');
  L.push(C.mdTable(['指标', '数量'], [
    ['检测作业数', counts.works],
    ['空间冲突组', counts.spatial],
    ['风险冲突组', counts.risk],
    ['资源冲突组', counts.resource],
    ['　其中高严重度', counts.high],
    ['　其中中严重度', counts.medium],
    ['　其中低严重度', counts.low],
    ['无法判定项', counts.undetermined],
    ['提示项（同位号双票作业，不计冲突）', counts.advisory],
    ['同时段最大并行作业数', counts.maxConcurrent],
  ]));
  if (floorDerived.length) { L.push(`> 【注意】${floorDerived.length} 项作业的标高由「层」写法按层高 ${FLOOR_HEIGHT} 米折算（推断，待确认），见附二。`); L.push(''); }
  L.push('作业清单：');
  L.push('');
  L.push(C.mdTable(['作业编号', '作业类型', '位号', '区域', '标高', '起止时间', '作业单位', '监护人', '涉及介质'],
    works.map((w) => [w.id, w.typeCn, w.tag || '—', w.area || '—（空）', w.elev === null ? '—（空）' : w.elev,
      `${w.start || '—'} ~ ${w.end || '—'}`, w.unit || '—', w.guard || '—', w.medium || '—'])));

  L.push('## 二、空间冲突');
  L.push('');
  L.push(renderConflicts(spatialConflicts));
  L.push('## 三、风险冲突');
  L.push('');
  L.push(renderConflicts(riskConflicts));
  L.push('**提示项（同位号受限空间 + 用火双票作业，合法常态，不计冲突）**');
  L.push('');
  if (!advisories.length) L.push('_无_\n');
  else {
    L.push(C.mdTable(['规则', '性质', '涉及作业', '位号', '时段重叠', '核对要点', '建议'],
      advisories.map((c) => [c.ruleId, '提示（不计冲突）', c.pairLabel, c.works[0].tag || '—', c.overlapReason || '—', c.note, c.advice])));
  }
  L.push('## 四、资源冲突');
  L.push('');
  if (!resourceConflicts.length) L.push('_无_\n');
  else {
    L.push(C.mdTable(['规则', '严重度', '资源类型', '资源', '涉及作业', '说明', '协调建议'],
      resourceConflicts.map((c) => [c.ruleId, c.severity, c.resourceType, c.resource,
        c.works.map((w) => w.id).join('、'), c.note, c.advice])));
  }
  L.push('## 五、无法判定项');
  L.push('');
  if (!undetermined.length) L.push('_无_\n');
  else {
    const KIND_CN = { space: '空间关系无法判定', time: '时段关系无法判定', risk: '风险冲突无法判定', resource: '资源冲突无法判定' };
    L.push(C.mdTable(['类别', '涉及作业', '命中规则', '缺失字段', '原因', '处理要求'],
      undetermined.map((u) => [KIND_CN[u.kind] || u.kind, u.pairLabel, u.ruleId || '—',
        (u.missing || []).join('、') || '—', u.reason, u.note])));
  }
  L.push('## 六、时段重叠视图');
  L.push('');
  L.push(C.mdTable(['作业编号', '作业类型', '区域', '标高', '开始', '结束', '同时段作业'],
    timeline.map((t) => [t.id, t.typeCn, t.area || '—（空）', t.elev === null ? '—（空）' : t.elev,
      t.start || '—（未判定）', t.end || '—（未判定）', t.concurrent.join('、') || '—'])));
  if (segments.length) {
    L.push('并行时段分布：');
    L.push('');
    L.push(C.mdTable(['时段', '时长(分钟)', '并行作业数', '作业编号'],
      segments.map((s) => [`${s.start} ~ ${s.end}`, s.minutes, s.count, s.works.join('、')])));
  }
  if (timeline.some((t) => t.timeUndetermined)) {
    L.push('> 起止时间缺失的作业未纳入并行时段分布，其时段关系见「五、无法判定项」。');
    L.push('');
  }

  L.push('## 七、冲突分析与协调建议');
  L.push('');
  L.push('<!-- ANALYSIS_START -->');
  L.push('（由模型依据 references/conflict-rules.md 口径撰写 200~400 字，结构：总体情况 → 高严重度冲突与建议措施 → 一般冲突 → 提示项与无法判定项、需补充信息 → 建议协调安排（提交安全环保部门统筹）。冲突组数与命中规则一律引用 conflicts.json；建议只提「建议错时 / 建议增加监护 / 建议先后作业」，不得表述为已批准的安排；同位号双票作业的提示项不得写成冲突。）');
  L.push('<!-- ANALYSIS_END -->');
  L.push('');
  if (skipped.length) {
    L.push('## 附一、已跳过的作业');
    L.push('');
    L.push(C.mdTable(['作业编号', '起止时间', '跳过原因'], skipped.map((s) => [s.id, `${s.start || '—'} ~ ${s.end || '—'}`, s.reason])));
  }
  if (warnings.length) {
    L.push('## 附二、数据提示');
    L.push('');
    for (const w of warnings) L.push(`- ${w}`);
    L.push('');
  }
  L.push('---');
  L.push('');
  L.push(`> ${DISCLAIMER}`);
  L.push('');
  fs.writeFileSync(path.join(outDir, 'conflicts.md'), L.join('\n'), 'utf8');

  C.emitOk(outDir, { ok: true, out: outDir, date, workshop: a.workshop, windowMinutes: windowMin, rulesApplied, counts, warnings });

  // ---- helpers（闭包内，便于访问 works）
  function renderConflicts(list) {
    if (!list.length) return '_无_\n';
    return C.mdTable(['规则', '严重度', '冲突类型', '涉及作业', '空间关系', '时段重叠', '说明', '协调建议'],
      list.map((c) => [c.ruleId, c.severity, c.title, c.pairLabel, c.relationCn || '—',
        c.overlapReason || '—', c.note, c.advice]));
  }
}

function briefOf(w) {
  return {
    id: w.id, tag: w.tag || null, typeCn: w.typeCn, types: w.types,
    area: w.area || null, elev: w.elev, start: w.start, end: w.end,
    unit: w.unit || null, guard: w.guard || null, guardSite: w.guardSite || null, guardUnit: w.guardUnit || null, medium: w.medium || null,
    flammable: w.flammable, system: w.system || null,
    craneId: w.craneId || null, circuit: w.circuit || null, fireCover: w.fireCover || null,
    row: w.row,
  };
}
function minToText(m) {
  const d = new Date(m * 60000);
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).reduce((o, x) => (o[x.type] = x.value, o), {});
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

try { main(); } catch (e) { C.fail(e, warnings); }
