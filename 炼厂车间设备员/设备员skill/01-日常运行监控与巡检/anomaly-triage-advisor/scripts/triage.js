#!/usr/bin/env node
'use strict';
/**
 * 设备异常初判脚本（仅 Node.js 内置模块）
 * 用法：node "<技能目录>/scripts/triage.js" --symptom "<现象描述>" --equip-type "<设备类型>" --tag "<位号>" [--out <dir>]
 * 可选：--params <参数xlsx> --history <历史故障记录xlsx> --limits <限值表xlsx> --dev-pct <偏差阈值> --time <ISO8601带时区>
 *       --sudden <是|否> --affects-run <是|否> --recent-repair <是|否> --load <负荷变化> --name <设备名称> --special <是|否>
 * 产出：<out>/triage.json、triage.md、summary.json；末行打印 JSON 摘要
 *
 * 硬约束：候选原因只排序不定论；判定依赖字段为空 → undetermined 单列且**不从候选中剔除**；
 *         不判读频谱/油液/无损检测的专业结论；不给停机、降负荷、抢修意见。
 *         偏差阈值不写死：无 --dev-pct 且无限值 → 参数不判升高/偏低（未判定），不按 15% 默认。
 * 口径：中石化体系炼化厂车间设备员；关注度 红/橙/黄；列名合并 SYSTEM_ALIASES（SAP PM/EM/DCS/点检仪 导出）。
 */
const fs = require('fs');
const path = require('path');
const { readXlsx, readCsvDir } = require('./lib/xlsx-lite');
const C = require('./lib/common');
const R = require('./lib/rules');

const warnings = [];
const num = C.makeNum(warnings);
const VALUE_OPTS = ['symptom', 'equip-type', 'tag', 'name', 'out', 'params', 'history', 'limits', 'dev-pct', 'time',
  'sudden', 'affects-run', 'recent-repair', 'load', 'workshop', 'special'];
const FLAG_OPTS = ['help'];

/**
 * 列名别名：局部优先，再合并共享 SYSTEM_ALIASES（功能位置/技术对象/设备描述/检查项/测值/测点号/通知单号 等）。
 * 注意：「设备编号」在 SAP 中是 8 位流水号，不是位号，已从位号别名中移除，单独成列只展示。
 */
const ALIASES = C.mergeAliases({
  '位号': ['位号', '设备位号', 'TAG', 'tag'],
  '设备名称': ['设备名称', '名称'],
  '参数名': ['参数名', '参数', '监测项目', '检测项', '检查项', '检查内容', '点检项目', '检查项目', '巡检项', '项目', '测点描述', '点描述', '位号描述'],
  '参数值': ['参数值', '测值', '测量值', '实测值', '数值', '读数', '当前值', '本次值'],
  '基准值': ['基准值', '参考值', '正常值', '历史均值', '平时值', '上次值', '基线'],
  '上限': ['上限', '上限值', '高报', '高报值', '报警上限', '高限', 'H', 'HI'],
  '下限': ['下限', '下限值', '低报', '低报值', '报警下限', '低限', 'L', 'LO'],
  '偏差阈值': ['偏差阈值', '偏差阈值%', '偏差%', '允许偏差', '允许偏差%', '阈值%'],
  '参数类型': ['参数类型', '参数类别', '类型'],
  '单位': ['单位', '计量单位', '工程单位'],
  '记录时间': ['记录时间', '时间', '采集时间', '检测时间', '时间戳', '点检时间', '巡检时间'],
  '备注': ['备注', '说明', '结论', '判断', '检查结果'],
  '故障日期': ['故障日期', '日期', '发生时间', '故障时间', '通知日期', '报告日期', '发生日期'],
  '故障现象': ['故障现象', '现象', '故障描述', '异常描述', '问题描述', '通知单描述', '描述', '短文本'],
  '故障原因': ['故障原因', '原因', '确认原因', '分析原因', '原因描述', '原因文本'],
  '处理措施': ['处理措施', '措施', '处理方式', '处理情况', '处理结果', '维修措施', '措施描述'],
});

/** 参数名 → evidence 字段。命中后把「参数值 vs 基准值」的比较结论写进 evidence。 */
const PARAM_TO_FIELD = [
  [/频谱|倍频|包络|频率成分/, 'spectrum'],
  [/流量|出口压力|排量/, 'flowPressure'],
  [/入口压力|吸入压力|罐位|液位/, 'suction'],
  [/轴承温度|轴瓦温度|瓦温/, 'bearingTemp'],
  [/电流|负荷率|功率/, 'current'],
  [/油位|油质|油压|油温/, 'oil'],
  [/压差|压降/, 'pressureDiff'],
  [/端差|换热量|热负荷/, 'heatDuty'],
  [/绝缘/, 'insulation'],
  [/冷却|通风|风温/, 'cooling'],
  [/地脚|基础|紧固/, 'foundation'],
  [/机封|冲洗/, 'sealFlush'],
];
function paramField(name) {
  const s = String(name || '');
  for (const [re, f] of PARAM_TO_FIELD) if (re.test(s)) return f;
  return null;
}

function loadBook(p) { return fs.statSync(p).isDirectory() ? readCsvDir(p) : readXlsx(p); }
const yes = (v) => /^(是|有|Y|yes|true|1)$/i.test(C.str(v));

function main() {
  const a = C.parseArgs(process.argv.slice(2), VALUE_OPTS, FLAG_OPTS);
  if (!a.symptom) throw new Error('缺少 --symptom（异常现象描述）');
  if (!a.tag) throw new Error('缺少 --tag（设备位号）');

  let time = null;
  if (a.time) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?([+-]\d{2}:?\d{2}|Z)$/.test(a.time)) {
      throw new Error(`--time 「${a.time}」不是有效时间，应为 ISO 8601 带时区（如 2026-09-21T08:15:00+08:00）`);
    }
    time = C.normDateTime(a.time.replace('T', ' '));
    if (!time) throw new Error(`--time 「${a.time}」无法解析为有效时间`);
  }

  const outDir = a.out || path.join(require('os').tmpdir(), 'ata-out');
  const special = a.special === undefined ? null : (yes(a.special) ? true : /^(否|无|N|no|false|0)$/i.test(a.special) ? false : null);
  if (a.special !== undefined && special === null) throw new Error(`--special 「${a.special}」无法识别，应为 是/否`);
  const devPct = R.parseDevPct(a['dev-pct']);          // 空对象 = 未给阈值
  const devFor = (kind) => (kind in devPct ? devPct[kind] : ('*' in devPct ? devPct['*'] : ('其他' in devPct && kind === '其他' ? devPct['其他'] : null)));

  // ---- 限值表（可选）：按 位号+参数名 或 仅参数名 匹配，给上限/下限/偏差阈值%
  const limitRows = [];
  if (a.limits) {
    if (!fs.existsSync(a.limits)) throw new Error(`限值表不存在: ${a.limits}`);
    let book; try { book = loadBook(a.limits); } catch (e) { throw new Error(`读取失败 ${a.limits}: ${e.message}`); }
    const rows = C.pickSheet(book, '限值', '限值表', '报警限值', '参数限值', '报警值', '阈值');
    if (!rows) warnings.push(`限值表「${path.basename(a.limits)}」中未找到「限值」工作表，按未提供限值处理`);
    else {
      const recs = C.toRecords(rows, ['参数名'], `${path.basename(a.limits)}/限值`,
        ['位号', '参数类型', '偏差阈值', '上限', '下限', '单位'], warnings, ALIASES);
      for (const r of recs) {
        const pname = C.str(r['参数名']);
        if (!pname) { warnings.push(`${r._sheet} 第${r._row}行 参数名为空，已跳过`); continue; }
        limitRows.push({
          tag: C.str(r['位号']) || null, name: pname, kind: C.str(r['参数类型']) || null,
          devPct: num(r['偏差阈值'], { sheet: r._sheet, row: r._row, col: '偏差阈值' }),
          upper: num(r['上限'], { sheet: r._sheet, row: r._row, col: '上限' }),
          lower: num(r['下限'], { sheet: r._sheet, row: r._row, col: '下限' }),
          sheet: r._sheet, row: r._row,
        });
      }
      if (!limitRows.length) warnings.push(`限值表「${path.basename(a.limits)}」无有效行`);
    }
  }
  const findLimit = (pname) => limitRows.find((l) => l.tag === a.tag && l.name === pname)
    || limitRows.find((l) => !l.tag && l.name === pname) || null;

  // ---- 现象与设备类型
  const symptoms = R.classifySymptoms(a.symptom);
  const typeKey = R.classifyEquipType(a['equip-type']);
  if (!a['equip-type']) warnings.push('未提供 --equip-type（设备类型），无法套用分类型故障口径，仅给出通用排查框架');
  else if (typeKey === 'generic') warnings.push(`设备类型「${a['equip-type']}」不在知识库覆盖范围（泵类/机组类/静设备类/电仪类），仅给出通用排查框架，未凭通用知识编造具体原因`);
  if (symptoms.length === 1 && symptoms[0] === 'other') {
    warnings.push(`现象描述「${a.symptom}」未匹配到已知现象类型（振动/异响/温度/泄漏/性能/电流/仪表/润滑），请补充更具体的描述`);
  }

  // ---- 证据收集：命令行给的直接字段
  const evidence = {
    symptomText: a.symptom,
    sudden: a.sudden || '',
    recentRepair: a['recent-repair'] || '',
    load: a.load || '',
  };
  const evidenceSources = {};   // 字段 → 来源说明（用于 md 里标注依据来源）
  for (const [k, v] of Object.entries(evidence)) if (C.str(v)) evidenceSources[k] = '用户提供';

  // ---- 参数表
  const paramRows = [];
  if (a.params) {
    if (!fs.existsSync(a.params)) throw new Error(`参数文件不存在: ${a.params}`);
    let book; try { book = loadBook(a.params); } catch (e) { throw new Error(`读取失败 ${a.params}: ${e.message}`); }
    const rows = C.pickSheet(book, '运行参数', '参数记录', '参数', '点检数据', '点检记录', '巡检记录', '监测数据', '运行记录', 'DCS', '趋势', '点检仪');
    if (!rows) warnings.push(`参数文件「${path.basename(a.params)}」中未找到「运行参数」工作表，参数依据缺失`);
    else {
      const recs = C.toRecords(rows, ['参数名', '参数值'], `${path.basename(a.params)}/运行参数`,
        ['位号', '设备编号', '设备名称', '测点号', '基准值', '上限', '下限', '偏差阈值', '单位', '记录时间', '备注'], warnings, ALIASES);
      const noThresholdNoted = new Set();
      for (const r of recs) {
        const pname = C.str(r['参数名']);
        if (!pname) { warnings.push(`${r._sheet} 第${r._row}行 参数名为空，已跳过`); continue; }
        const rowTag = C.str(r['位号']);
        if (rowTag && rowTag !== a.tag) continue;          // 只取本机位号的行
        const ctx = (col) => ({ sheet: r._sheet, row: r._row, col });
        const v = num(r['参数值'], ctx('参数值'));
        const base = num(r['基准值'], ctx('基准值'));
        const unit = C.str(r['单位']);
        const t = C.normDateTime(r['记录时间']);
        if (r['记录时间'] && !t) warnings.push(`${r._sheet} 第${r._row}行 记录时间「${C.str(r['记录时间'])}」无法解析`);
        // 阈值来源优先级：参数表行内 上限/下限/偏差阈值 → 限值表 → --dev-pct（按参数类型）
        const lim = findLimit(pname);
        const kind = (lim && lim.kind) || R.classifyParamKind(pname, unit);
        let upper = num(r['上限'], ctx('上限')), lower = num(r['下限'], ctx('下限'));
        let rowDev = num(r['偏差阈值'], ctx('偏差阈值'));
        let thresholdSource = null;
        if (upper !== null || lower !== null) thresholdSource = '参数表行内上下限';
        else if (lim && (lim.upper !== null || lim.lower !== null)) { upper = lim.upper; lower = lim.lower; thresholdSource = `限值表（${lim.sheet} 第${lim.row}行）上下限`; }
        else if (rowDev !== null) thresholdSource = `参数表行内偏差阈值 ±${rowDev}%`;
        else if (lim && lim.devPct !== null) { rowDev = lim.devPct; thresholdSource = `限值表（${lim.sheet} 第${lim.row}行）偏差阈值 ±${rowDev}%`; }
        else if (devFor(kind) !== null) { rowDev = devFor(kind); thresholdSource = `--dev-pct ${kind}=${rowDev}%`; }
        const cmp = R.compareToBase({ value: v, base, upper, lower, devPct: rowDev });
        if (cmp.trend === null && v !== null && base !== null && thresholdSource === null && !noThresholdNoted.has(pname)) {
          noThresholdNoted.add(pname);
          warnings.push(`参数「${pname}」（${kind}）有实测与基准但未提供偏差阈值（--dev-pct 或限值表上下限），不判升高/偏低，依赖它的原因按未判定处理，未按固定百分比默认`);
        }
        const note = C.str(r['备注']);
        paramRows.push({
          name: pname, kind, value: v, base, upper, lower, devPct: rowDev, thresholdSource, unit, time: t, note,
          trend: cmp.trend, trendBasis: cmp.basis,
          tagNo: C.str(r['测点号']) || null, equipNo: C.str(r['设备编号']) || null,
          field: paramField(pname), sheet: r._sheet, row: r._row,
        });
      }
      if (!paramRows.length) warnings.push(`参数文件中没有位号「${a.tag}」的参数行，参数依据缺失`);
    }
  } else {
    warnings.push('未提供 --params（运行参数），参数类依据缺失，相关原因项将标未判定');
  }

  // 参数写入 evidence：备注优先（文字结论更准），否则用与基准的比较结论
  for (const p of paramRows) {
    if (!p.field) continue;
    const val = p.note || p.trend;
    if (!val) continue;
    if (!C.str(evidence[p.field])) {
      evidence[p.field] = val;
      evidenceSources[p.field] = `参数表「${p.name}」（${p.sheet} 第${p.row}行）${p.note ? '备注' : p.trendBasis}`;
    }
  }

  // ---- 历史故障记录
  const historyRows = [];
  if (a.history) {
    if (!fs.existsSync(a.history)) throw new Error(`历史故障记录不存在: ${a.history}`);
    let book; try { book = loadBook(a.history); } catch (e) { throw new Error(`读取失败 ${a.history}: ${e.message}`); }
    const rows = C.pickSheet(book, '故障记录', '历史故障', '检修记录', '通知单', '维修通知单', '故障通知单', '历史记录', '故障');
    if (!rows) warnings.push(`历史记录文件「${path.basename(a.history)}」中未找到「故障记录」工作表，历史依据缺失`);
    else {
      const recs = C.toRecords(rows, ['位号', '故障现象'], `${path.basename(a.history)}/故障记录`,
        ['设备编号', '设备名称', '通知单号', '故障日期', '故障代码', '故障原因', '处理措施'], warnings, ALIASES);
      for (const r of recs) {
        const tg = C.str(r['位号']);
        if (!tg) { warnings.push(`${r._sheet} 第${r._row}行 位号为空，已跳过`); continue; }
        if (tg !== a.tag) continue;
        const d = C.normDate(r['故障日期']);
        if (r['故障日期'] && !d) warnings.push(`${r._sheet} 第${r._row}行 故障日期「${C.str(r['故障日期'])}」无法解析`);
        historyRows.push({
          date: d, phenomenon: C.str(r['故障现象']), cause: C.str(r['故障原因']),
          action: C.str(r['处理措施']), noticeNo: C.str(r['通知单号']) || null, faultCode: C.str(r['故障代码']) || null,
          sheet: r._sheet, row: r._row,
        });
      }
      if (!historyRows.length) warnings.push(`历史记录中没有位号「${a.tag}」的故障条目，历史依据缺失`);
    }
  } else {
    warnings.push('未提供 --history（历史故障记录），历史依据缺失，无法比对同类故障复发');
  }
  if (historyRows.length) {
    evidence.history = historyRows.map((h) => `${h.date || '—'} ${h.phenomenon}${h.cause ? '（' + h.cause + '）' : ''}`).join('；');
    evidenceSources.history = `历史故障记录 ${historyRows.length} 条`;
  }

  // ---- 规则引擎
  const t = R.triage({ equipType: a['equip-type'], symptoms, evidence });
  for (const n of t.notes) warnings.push(n);

  // 历史同类故障提示（只提示，不改排序，避免用历史"锁死"结论）
  const historyHints = [];
  for (const h of historyRows) {
    for (const c of t.candidates) {
      if (h.cause && (h.cause.includes(c.cause) || c.cause.includes(h.cause))) {
        historyHints.push({ candidateId: c.id, cause: c.cause, date: h.date, phenomenon: h.phenomenon, historyCause: h.cause, action: h.action });
      }
    }
  }

  // ---- 风险提示与上报建议
  const sudden = R.parseSudden(a.sudden);
  const affectsRun = R.parseAffects(a['affects-run']);
  const specTail = special === true ? '（特护设备仍按最高档「红」提示，不受缺项影响）' : '';
  if (sudden === null) warnings.push('「是否突发」未提供或无法解析，关注度判为未判定，未按最轻或最重默认' + specTail);
  if (affectsRun === null) warnings.push('「是否影响运行」未提供或无法解析，关注度判为未判定，未按最轻或最重默认' + specTail);
  const risk = R.riskLevel({ symptoms, sudden, affectsRun, special });
  if (special === true) warnings.push('【注意】已标记为特护设备，关注度按最高档「红」强制提示，上报建议含公司设备管理部门');
  const esc = R.escalation(risk, t.candidates.length, t.undetermined.length);

  // ---- 建议核实项：按候选原因合并去重，保留来源
  const checkItems = [];
  const seenCheck = new Set();
  for (const c of t.candidates) {
    for (const ck of c.checks) {
      const key = ck;
      if (seenCheck.has(key)) {
        const ex = checkItems.find((x) => x.item === key);
        if (ex && !ex.forCauses.includes(c.cause)) ex.forCauses.push(c.cause);
        continue;
      }
      seenCheck.add(key);
      checkItems.push({
        item: ck, forCauses: [c.cause], ruleId: c.ruleId,
        // 未判定项的核实项优先级更高：先补数据才能排除
        priority: c.undetermined ? '高（补齐后可判定）' : c.likelihood === 'high' ? '高' : c.likelihood === 'medium' ? '中' : '低',
      });
    }
  }
  const PRI_ORDER = { '高（补齐后可判定）': 0, '高': 1, '中': 2, '低': 3 };
  checkItems.sort((x, y) => (PRI_ORDER[x.priority] - PRI_ORDER[y.priority]) || x.ruleId.localeCompare(y.ruleId));

  // ---- 缺失字段汇总（供"建议补充什么数据"用）
  // symptomText 取自 --symptom，本就存在，只是没命中特征词，不属于「可补充的数据」
  const missingFields = [...new Set(t.candidates.flatMap((c) => c.unknowns.map((u) => u.field)))]
    .filter((f) => f !== 'symptomText');

  const counts = {
    symptoms: symptoms.length,
    candidates: t.candidates.length,
    evidenced: t.candidates.filter((c) => c.evidenceLevel === 'evidenced').length,
    speculative: t.candidates.filter((c) => c.evidenceLevel === 'speculative').length,
    undetermined: t.undetermined.length,
    checkItems: checkItems.length,
    params: paramRows.length,
    paramsTrended: paramRows.filter((p) => p.trend !== null).length,
    paramsNoThreshold: paramRows.filter((p) => p.trend === null && p.value !== null && p.base !== null && !p.thresholdSource).length,
    limits: limitRows.length,
    history: historyRows.length,
    missingFields: missingFields.length,
  };

  // ---- 产出
  C.ensureDir(outDir);
  const result = {
    meta: {
      tag: a.tag, name: a.name || '', workshop: a.workshop || null, special,
      devPct: Object.keys(devPct).length ? devPct : null, limitsProvided: !!a.limits,
      attentionScheme: '红/橙/黄（旧 A/B/C 对应 红/橙/黄）',
      equipTypeRaw: a['equip-type'] || null, equipType: t.typeKey, equipTypeCn: t.typeCn,
      covered: t.covered, usedGenericFrame: t.usedGeneric,
      symptomText: a.symptom, symptoms, symptomsCn: symptoms.map((s) => R.SYMPTOM_CN[s] || s),
      occurredAt: time, generatedAt: C.localDateTime(),
      paramsProvided: !!a.params, historyProvided: !!a.history,
      disclaimer: R.DISCLAIMER,
    },
    counts,
    riskLevel: risk,
    escalation: esc,
    candidates: t.candidates,
    checkItems,
    undetermined: t.undetermined,
    missingFields: missingFields.map((f) => ({ field: f, label: R.FIELD_CN[f] || f })),
    evidence: Object.entries(evidence).filter(([, v]) => C.str(v)).map(([k, v]) => ({
      field: k, label: R.FIELD_CN[k] || k, value: C.str(v), source: evidenceSources[k] || '用户提供',
    })),
    params: paramRows,
    limits: limitRows,
    history: historyRows,
    historyHints,
    warnings,
  };
  fs.writeFileSync(path.join(outDir, 'triage.json'), JSON.stringify(result, null, 2), 'utf8');

  // ---- Markdown（六节）
  const L = [];
  L.push(`# 设备异常初判报告　${a.tag}${a.name ? ' ' + a.name : ''}`);
  L.push('');
  L.push(`设备类型：${t.typeCn}${a['equip-type'] ? `（原填「${a['equip-type']}」）` : ''}　｜　发现时间：${time || '—'}`);
  L.push(`生成时间：${C.localDateTime()}（北京时间）`);
  L.push('');
  L.push(`> **${R.DISCLAIMER}。**`);
  L.push('');

  L.push('## 一、现象复述');
  L.push('');
  L.push(C.mdTable(['项目', '内容'], [
    ['位号', a.tag], ['设备名称', a.name || '—'],
    ['设备类型', t.typeCn], ['识别到的现象', symptoms.map((s) => R.SYMPTOM_CN[s] || s).join('、')],
    ['现象描述（原文）', a.symptom],
    ['发现时间', time || '—'],
    ['是否突发', sudden === null ? '未提供（未判定）' : (sudden ? '是' : '否')],
    ['是否影响运行', affectsRun === null ? '未提供（未判定）' : (affectsRun ? '是' : '否')],
    ['是否特护设备', special === null ? '未提供' : (special ? '是（关注度按最高档）' : '否')],
    ['参数数据', a.params ? `已提供，本机相关 ${paramRows.length} 项（可判趋势 ${counts.paramsTrended} 项${counts.paramsNoThreshold ? `，缺偏差阈值 ${counts.paramsNoThreshold} 项` : ''}）` : '未提供'],
    ['偏差阈值来源', a.limits || Object.keys(devPct).length ? [a.limits ? `限值表 ${limitRows.length} 行` : '', Object.keys(devPct).length ? `--dev-pct ${a['dev-pct']}` : ''].filter(Boolean).join('；') : '未提供（不按固定百分比默认）'],
    ['历史故障记录', a.history ? `已提供，本机相关 ${historyRows.length} 条` : '未提供'],
  ]));
  if (result.evidence.length) {
    L.push('已采信的依据：');
    L.push('');
    L.push(C.mdTable(['依据项', '取值', '来源'], result.evidence.map((e) => [e.label, e.value, e.source])));
  } else {
    L.push('_除现象描述外未采信到其他依据，全部候选原因均需补充数据后才能评估。_');
    L.push('');
  }

  L.push('## 二、可能原因排序');
  L.push('');
  if (!t.covered || t.usedGeneric) {
    L.push(`> 【注意】${t.notes.join('；')}。以下仅为通用排查框架，**不构成针对该设备类型的具体原因判断**。`);
    L.push('');
  }
  L.push(C.mdTable(['序', '候选原因', '可能性', '依据充分度', '支持依据', '反证', '规则号'],
    t.candidates.map((c, i) => [
      i + 1, c.cause, c.likelihoodCn,
      c.evidenceLevel === 'evidenced' ? '有依据' : '推测，待核实',
      c.supports.length ? c.supports.map((s) => `${s.label}（${s.value}）`).join('；') : '—',
      c.againsts.length ? c.againsts.map((s) => `${s.label}（${s.value}）`).join('；') : '—',
      c.ruleId,
    ])));
  L.push('各候选原因的机理与缺失依据：');
  L.push('');
  for (const c of t.candidates) {
    L.push(`- **${c.cause}**（${c.ruleId}，${c.likelihoodCn}${c.evidenceLevel === 'speculative' ? '，**推测，待核实**' : ''}）：${c.mechanism}。`
      + (c.unknowns.length ? `尚缺依据：${[...new Set(c.unknowns.map((u) => R.FIELD_CN[u.field] || u.field))].join('、')}。` : ''));
  }
  L.push('');
  if (historyHints.length) {
    L.push('历史记录提示（仅供参考，不据此锁定结论）：');
    L.push('');
    L.push(C.mdTable(['候选原因', '历史日期', '历史现象', '历史确认原因', '当时处理'],
      historyHints.map((h) => [h.cause, h.date || '—', h.phenomenon, h.historyCause, h.action || '—'])));
  }

  L.push('## 三、建议核实项');
  L.push('');
  L.push(C.mdTable(['优先级', '核实项', '对应候选原因', '规则号'],
    checkItems.map((x) => [x.priority, x.item, x.forCauses.join('、'), x.ruleId])));
  L.push('> 以上核实项由设备员或对应专业人员现场执行。**频谱、油液分析、无损检测的结论一律由诊断或检测人员出具，本报告不代为判读。**');
  L.push('');

  L.push('## 四、建议动作');
  L.push('');
  L.push(C.mdTable(['项目', '内容'], [
    ['关注度提示', risk.levelCn],
    ['提示依据', `${risk.basis}（规则 ${risk.ruleId}）`],
    ['建议动作', risk.level === 'undetermined'
      ? '先按第五节补齐信息后重新初判；期间按现有监控频次跟踪，发现劣化立即按厂内流程上报'
      : risk.level === '红' ? '按第三节高优先级项立即现场核实，同时通知设备工程师与车间设备主任；加密监控该设备的振动、温度与泄漏情况'
        : risk.level === '橙' ? '按第三节逐项核实，提高该设备的巡检与参数记录频次，记录趋势变化'
          : '按第三节逐项核实，纳入日常巡检重点关注，保留参数记录以便对比'],
  ]));
  L.push('> 关注度用 红/橙/黄 三档（与设备重要度 A/B/C 分级无关），只表示建议的关注强度，不是处置指令。');
  L.push('> **本报告不给出是否停机、是否降负荷、是否抢修的意见**，该类决策由设备工程师会同生产调度按厂内规定作出。');
  L.push('');

  L.push('## 五、未判定项');
  L.push('');
  if (!t.undetermined.length) L.push('_无：全部候选原因均已取到至少一项可用于区分的依据。_\n');
  else {
    L.push(C.mdTable(['候选原因', '缺失依据', '说明', '规则号'],
      t.undetermined.map((u) => [u.cause, u.missing.map((f) => R.FIELD_CN[f] || f).join('、'), u.note, u.ruleId])));
    L.push('> 以上原因**仍保留在候选清单内**，只是因缺数据暂无法评估可能性，不得视为已排除。');
    L.push('');
  }
  if (risk.level === 'undetermined') {
    L.push(`关注度提示同样未判定：${risk.basis}（规则 ${risk.ruleId}）。`);
    L.push('');
  }
  if (result.missingFields.length) {
    L.push('建议补充以下数据后重新初判：');
    L.push('');
    for (const m of result.missingFields) L.push(`- ${m.label}`);
    L.push('');
  }

  L.push('## 六、上报建议');
  L.push('');
  L.push(esc.text);
  L.push('');
  L.push('<!-- ANALYSIS_START -->');
  L.push('（由模型依据 references/fault-patterns-*.md 口径补充 150~300 字的初判说明，结构：现象与依据的对应关系 → 为什么这几项排在前面 → 哪些项因缺数据未判定 → 建议的核实顺序。候选原因、可能性、计数一律引用 triage.json，不得自行调整排序或新增原因。）');
  L.push('<!-- ANALYSIS_END -->');
  L.push('');
  L.push(`核实后确认为缺陷的，由车间设备员按厂内流程在 SAP PM 创建维修通知单（缺陷分级可接 \`02-缺陷报修与检修管理/defect-intake-grading\`）；工单由计划员/维修单位创建，本技能不生成工单。需要查同类设备的历史案例时，可接 \`07-隐患事故与合规/failure-case-retrieval\` 技能检索类似故障案例。`);
  L.push('');
  L.push(`**${R.DISCLAIMER}。**`);
  L.push('');

  if (warnings.length) {
    L.push('## 附：数据提示');
    L.push('');
    for (const w of warnings) L.push(`- ${w}`);
    L.push('');
  }
  fs.writeFileSync(path.join(outDir, 'triage.md'), L.join('\n'), 'utf8');

  C.emitOk(outDir, { ok: true, out: outDir, tag: a.tag, equipType: t.typeKey, covered: t.covered, counts, riskLevel: risk.level, warnings });
}

try { main(); } catch (e) { C.fail(e, warnings); }
