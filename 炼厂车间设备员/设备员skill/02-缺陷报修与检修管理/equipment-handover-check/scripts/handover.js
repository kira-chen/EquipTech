#!/usr/bin/env node
'use strict';
/**
 * 检修前设备交出确认脚本（仅 Node.js 内置模块）
 * 用法：node "<技能目录>/scripts/handover.js" --tag "<位号>" --equip-type "<设备类型>" --medium "<介质>" --scope "<检修内容>" [--out <dir>]
 * 可选：--entry --hotwork --no-entry --no-hotwork --pressured <是|否> --hot <是|否> --temp <温度> --pressure <压力>
 *       --name <设备名称> --workshop <车间> --ledger <设备台账xlsx> --plan-date <YYYY-MM-DD>
 * 产出：<out>/handover.json、handover.md、summary.json；末行打印 JSON 摘要
 *
 * 硬约束：
 *   - 逐项确认结果由现场人员填写，脚本 confirmed 一律 null，不得预填「已完成」
 *   - 介质不在危险特性库 → 按最严口径生成 + warning 提示核实 MSDS
 *   - 判定依据缺失 → 条目 undetermined 单列，不按「不需要」处理
 *   - 存在未完成或未判定项 → md 开头写「【注意】尚不具备交出条件」
 *   - 未给 --pressured/--hot 时不按压力/温度数值推断，只记录「推断值，待确认」并进未判定
 */
const fs = require('fs');
const path = require('path');
const { readXlsx, readCsvDir } = require('./lib/xlsx-lite');
const C = require('./lib/common');
const R = require('./lib/rules');

const warnings = [];
const num = C.makeNum(warnings);
const VALUE_OPTS = ['tag', 'equip-type', 'medium', 'scope', 'out', 'name', 'workshop',
  'ledger', 'temp', 'pressure', 'pressured', 'hot', 'plan-date', 'requester', 'confirm'];
const FLAG_OPTS = ['entry', 'hotwork', 'no-entry', 'no-hotwork', 'help'];

const DECLARATION = '本清单为辅助核对工具，设备交出须由工艺、设备、安全人员现场确认并签字，签字前不得开始检修作业。';

// 共享别名（SAP PM / EM 导出列名：功能位置、设备描述、对象类型……）+ 局部别名；局部优先。
// 「设备编号」在 SAP 中是 8 位流水号，不是位号，故不放进位号别名，单独成列，--tag 对两列都可命中。
const ALIASES = C.mergeAliases({
  '位号': ['位号', '设备位号', 'TAG', 'tag'],
  '设备名称': ['设备名称', '名称'],
  '设备类型': ['设备类型', '类型', '设备类别', '类别', '对象类型', '设备分类', '专业类别', '设备品种'],
  '介质': ['介质', '物料', '工艺介质', '输送介质', '操作介质', '流体'],
  '操作温度': ['操作温度', '温度', '工作温度', '设计温度'],
  '操作压力': ['操作压力', '压力', '工作压力', '设计压力'],
});

function loadBook(p) { return fs.statSync(p).isDirectory() ? readCsvDir(p) : readXlsx(p); }

/** --flag 与 --no-flag 组合成三态：true / false / null（都没给 → null） */
function triFlag(a, name) {
  const yes = a[name] === true;
  const no = a['no-' + name] === true;
  if (yes && no) throw new Error(`--${name} 与 --no-${name} 不能同时使用`);
  if (yes) return true;
  if (no) return false;
  return null;
}

function main() {
  const a = C.parseArgs(process.argv.slice(2), VALUE_OPTS, FLAG_OPTS);
  if (!a.tag) throw new Error('缺少 --tag（设备位号）');
  if (!a.scope) throw new Error('缺少 --scope（检修内容）');
  const outDir = a.out || path.join(require('os').tmpdir(), 'ehc-out');

  let planDate = null;
  if (a['plan-date']) {
    planDate = C.normDate(a['plan-date']);
    if (!planDate) throw new Error(`--plan-date 「${a['plan-date']}」不是有效日期，应为 YYYY-MM-DD`);
  }

  // ---- 设备台账（补全设备类型、介质、温度压力）
  let equipType = a['equip-type'] || '';
  let equipName = a.name || '';
  let medium = a.medium || '';
  let tempRaw = a.temp, pressRaw = a.pressure;
  if (a.ledger) {
    if (!fs.existsSync(a.ledger)) throw new Error(`设备台账不存在: ${a.ledger}`);
    const book = loadBook(a.ledger);
    // 工作表名：厂内台账「设备台账/台账/设备清单」，SAP PM 导出「技术对象/功能位置/设备主数据」；都没命中则取第一个工作表
    let rows = C.pickSheet(book, '设备台账', '台账', '设备清单', '技术对象', '功能位置', '设备主数据', '设备列表');
    if (!rows) { const first = Object.keys(book)[0]; if (first) { rows = book[first]; warnings.push(`设备台账文件中未找到「设备台账/技术对象」工作表，已取第一个工作表「${first}」`); } }
    if (!rows) warnings.push('设备台账文件中无可用工作表，未补全设备信息');
    else {
      const recs = C.toRecords(rows, ['位号'], '设备台账', ['设备编号', '设备名称', '设备类型', '介质', '操作温度', '操作压力', '车间'], warnings, ALIASES);
      const hit = recs.find((r) => C.str(r['位号']) === a.tag || (C.str(r['设备编号']) && C.str(r['设备编号']) === a.tag));
      if (!hit) warnings.push(`位号「${a.tag}」不在设备台账中，设备信息未补全`);
      else {
        if (!equipName) equipName = C.str(hit['设备名称']);
        if (!equipType) equipType = C.str(hit['设备类型']);
        if (!medium) medium = C.str(hit['介质']);
        if (!a.workshop && C.str(hit['车间'])) a.workshop = C.str(hit['车间']);
        if (tempRaw === undefined && hit['操作温度'] !== null) tempRaw = hit['操作温度'];
        if (pressRaw === undefined && hit['操作压力'] !== null) pressRaw = hit['操作压力'];
      }
    }
  }
  if (!equipType && !equipName) warnings.push('未提供设备类型（--equip-type），仅生成通用交出条目，专项条目可能不全');

  // ---- 介质危险特性：不在库 → 最严口径 + warning
  const haz = R.classifyMedium(medium);
  if (!medium) {
    warnings.push('未提供介质（--medium），已按最严（高危）口径生成交出条目，请核实介质 MSDS 后复核清单');
  } else if (!haz.inLibrary) {
    warnings.push(`介质「${medium}」不在危险特性库中，已按最严（高危）口径生成交出条目，请查阅该介质 MSDS 核实后复核清单`);
  }

  // ---- 作业类型与工况三态
  const entry = triFlag(a, 'entry');
  const hotwork = triFlag(a, 'hotwork');
  const temp = tempRaw === undefined ? null : num(tempRaw, { sheet: '入参', row: 0, col: '操作温度' });
  const pressure = pressRaw === undefined ? null : num(pressRaw, { sheet: '入参', row: 0, col: '操作压力' });

  // 带压/高温：只认显式 --pressured/--hot；未给则 null → 规则判未判定。
  // 口径：带压/高温与否由用户确认，脚本不按压力/温度阈值推断（口径对照第五节）。数值仅作「推断值，待确认」提示。
  let pressured = R.tri(a.pressured);
  if (pressured === null && a.pressured !== undefined && a.pressured !== '') {
    warnings.push(`--pressured 「${a.pressured}」无法识别为是/否，按未说明处理`);
  }
  let hot = R.tri(a.hot);
  if (hot === null && a.hot !== undefined && a.hot !== '') {
    warnings.push(`--hot 「${a.hot}」无法识别为是/否，按未说明处理`);
  }
  const pressureHint = pressured === null && pressure !== null ? (pressure > 0 ? '可能带压' : '可能常压') : null;
  const hotHint = hot === null && temp !== null ? (temp > 40 ? '可能高温' : '可能常温') : null;
  if (pressureHint) warnings.push(`已记录操作压力 ${C.fmt(pressure)} MPa，推断值「${pressureHint}」仅供参考、待确认，不进入判定；请用 --pressured 是/否 明确是否带压`);
  if (hotHint) warnings.push(`已记录操作温度 ${C.fmt(temp)} ℃，推断值「${hotHint}」仅供参考、待确认，不进入判定；请用 --hot 是/否 明确是否高温`);

  const equip = R.classifyEquip(equipType, equipName);
  const dismantle = R.isDismantle(a.scope);
  if (entry === true && hotwork === true) {
    warnings.push('本次检修同时涉及进受限空间与用火作业，属高风险作业组合，交出条件须由安全部门专项确认');
  }

  const ctx = { haz, equip, entry, hotwork, pressured, hot, dismantle, temp, pressure };
  const { items, undetermined, criticalItems } = R.buildItems(ctx);
  const permits = R.requiredPermits(ctx, items);

  // ---- 回填现场确认结果（由现场人员填写的 JSON，脚本从不自行产生 true）
  if (a.confirm) {
    if (!fs.existsSync(a.confirm)) throw new Error(`确认结果文件不存在: ${a.confirm}`);
    let conf;
    try { conf = JSON.parse(fs.readFileSync(a.confirm, 'utf8')); } catch (e) { throw new Error(`确认结果文件解析失败: ${e.message}`); }
    const list = Array.isArray(conf) ? conf : (conf.items || []);
    if (!Array.isArray(list)) throw new Error('确认结果文件格式错误：应为数组或含 items 数组的对象');
    const byRule = new Map(items.map((x) => [x.ruleId, x]));
    for (const c of list) {
      const rid = C.str(c.ruleId);
      const it = byRule.get(rid);
      if (!it) { warnings.push(`确认结果中规则号「${rid || '（空）'}」不在本次清单中，已忽略`); continue; }
      const v = R.tri(c.confirmed);
      if (v === null) { warnings.push(`规则 ${rid} 的确认结果「${C.str(c.confirmed)}」无法识别为是/否，仍按未确认处理`); continue; }
      it.confirmed = v;
      it.confirmedBy = C.str(c.by) || null;
      it.confirmedAt = C.str(c.at) || null;
      it.status = v ? 'done' : 'notDone';
      if (!it.confirmedBy) warnings.push(`规则 ${rid} 的确认结果未填确认人`);
    }
    // 关键条目状态同步
    for (const ci of criticalItems) {
      const it = byRule.get(ci.ruleId);
      if (it) { ci.status = it.status; ci.confirmed = it.confirmed; }
    }
  }

  // ---- 计数：无 --confirm 时 confirmed 一律 null（脚本不预填），confirmed 数恒为 0
  const counts = {
    total: items.length,
    required: items.filter((x) => x.required === true).length,
    undetermined: undetermined.length,
    critical: criticalItems.length,
    confirmed: items.filter((x) => x.confirmed === true).length,
    pending: items.filter((x) => x.confirmed !== true).length,
  };
  // 待确认或未判定项存在 → 尚不具备交出条件
  const notDone = items.filter((x) => x.confirmed === false);
  const ready = counts.pending === 0 && counts.undetermined === 0;
  const readyNote = ready ? '全部条目已由现场确认完成，未见未完成或未判定项'
    : `尚有 ${counts.pending} 项未完成或待确认、${counts.undetermined} 项未判定`;

  // ---- 产出
  C.ensureDir(outDir);
  const result = {
    meta: {
      tag: a.tag, name: equipName || null, equipType: equipType || null,
      equipKey: equip, equipCn: R.EQUIP_CN[equip],
      medium: medium || null,
      mediumHazard: haz.level, mediumHazardCn: R.HAZ_CN[haz.level],
      mediumEffective: haz.effective, mediumInLibrary: haz.inLibrary, mediumTraits: haz.traits,
      scope: a.scope, dismantle,
      entry, hotwork, pressured, hot, temp, pressure,
      pressureHint, hotHint, permits,
      workshop: a.workshop || null, requester: a.requester || null, planDate,
      generatedAt: C.localDateTime(),
      declaration: DECLARATION,
    },
    ready, readyNote, counts, criticalItems, items, undetermined, warnings,
  };
  fs.writeFileSync(path.join(outDir, 'handover.json'), JSON.stringify(result, null, 2), 'utf8');

  // ---- Markdown
  const L = [];
  L.push(`# 检修前设备交出单　${a.tag}${equipName ? ' ' + equipName : ''}`);
  L.push('');
  if (!ready) {
    L.push(`> **【注意】尚不具备交出条件**：${readyNote}，逐项确认完成并四方签字前不得开始检修作业。`);
    L.push('');
  } else {
    L.push(`> 清单内 ${counts.total} 项交出条目现场确认结果均为已完成，无未判定项；仍须四方签字后方可开始检修作业。`);
    L.push('');
  }
  L.push(`> ${DECLARATION}`);
  L.push('');
  L.push('## 一、设备与作业信息');
  L.push('');
  L.push(C.mdTable(['项目', '内容'], [
    ['位号', a.tag],
    ['设备名称', equipName || '—'],
    ['设备类型', `${equipType || '—'}${equipType ? `（归类：${R.EQUIP_CN[equip]}）` : ''}`],
    ['介质', medium || '—（未提供）'],
    ['介质危险特性', R.HAZ_CN[haz.level] + (haz.traits.length ? `　${haz.traits.join('、')}` : '')],
    ['取用口径', haz.inLibrary ? '按危险特性库判定' : '**介质不在库，按最严（高危）口径生成，须核实 MSDS**'],
    ['检修内容', a.scope],
    ['是否解体拆卸', dismantle ? '是' : '否（按检修内容判定）'],
    ['是否进受限空间', triCn(entry)],
    ['是否用火作业', triCn(hotwork)],
    ['是否带压', triCn(pressured) + (pressure === null ? '' : `（操作压力 ${C.fmt(pressure)} MPa${pressureHint ? '，推断值「' + pressureHint + '」待确认，不进入判定' : ''}）`)],
    ['是否高温', triCn(hot) + (temp === null ? '' : `（操作温度 ${C.fmt(temp)} ℃${hotHint ? '，推断值「' + hotHint + '」待确认，不进入判定' : ''}）`)],
    ['涉及作业许可', permits.length ? permits.join('、') + '（办票预检用 permit-precheck-bridge，级别以作业票为准）' : '按本次确认的作业类型暂未命中需单独办票的作业'],
    ['所属车间', a.workshop || '—'],
    ['计划检修日期', planDate || '—'],
    ['生成时间', `${C.localDateTime()}（北京时间）`],
  ]));

  L.push('## 二、关键条目（必须逐项落实并留痕）');
  L.push('');
  if (!criticalItems.length) L.push('_本次交出未命中关键条目。_\n');
  else {
    L.push(C.mdTable(['序号', '规则号', '分类', '关键条目', '完成情况（现场填写）'],
      criticalItems.map((x) => [x.no, x.ruleId, x.categoryCn, x.title, statusCell(x)])));
    L.push('> 关键条目未落实的，一律视为不具备交出条件，不得以「口头确认」代替书面记录。');
    L.push('');
  }

  L.push('## 三、交出条件逐项确认');
  L.push('');
  L.push(C.mdTable(['序号', '规则号', '分类', '交出条目', '生成依据', '确认方式', '责任岗位', '完成情况', '确认人', '确认时间'],
    items.map((x) => [x.no, x.ruleId, x.categoryCn, x.title + (x.critical ? '　**【关键】**' : ''), x.basis, x.verify, x.owner,
      statusCell(x), x.confirmedBy || '', x.confirmedAt || ''])));
  L.push('> 「完成情况 / 确认人 / 确认时间」三栏由现场确认人填写，脚本不得预填。涉及用火、受限空间、盲板抽堵等作业的，须先办理相应作业许可并实行双监护（属地监护人 + 作业单位监护人）。');
  L.push('');

  L.push('## 四、未判定项');
  L.push('');
  if (!undetermined.length) L.push('_无。全部条目的判定依据齐全。_\n');
  else {
    L.push(C.mdTable(['序号', '规则号', '分类', '条目', '缺失的判定依据'],
      undetermined.map((x) => [x.no, x.ruleId, x.categoryCn, x.title, x.missing])));
    L.push('> 以上条目因判定依据缺失暂未确定是否必需，**不得按「不需要」处理**；补齐信息后重新生成清单。');
    if (pressureHint || hotHint) L.push(`> 【未判定】带压/高温推断值仅供参考（${[pressureHint, hotHint].filter(Boolean).join('、')}），须由工艺或车间设备员现场确认后以 --pressured / --hot 回填。`);
    L.push('');
  }

  L.push('## 五、未完成项');
  L.push('');
  if (!a.confirm) {
    L.push(`截至生成时刻，共 ${counts.total} 项交出条目全部处于待确认状态（脚本只生成清单，不代填任何一项完成情况）。现场逐项确认后，请把未完成的条目誊写到下表：`);
    L.push('');
    L.push(C.mdTable(['序号', '条目', '未完成原因', '计划完成时间', '责任人'], [['', '', '', '', '']]));
  } else if (!notDone.length && counts.pending === 0) {
    L.push('_无。现场确认结果显示全部条目均已完成。_\n');
  } else {
    const rows = items.filter((x) => x.confirmed !== true)
      .map((x) => [x.no, x.title, x.confirmed === false ? '现场确认为未完成' : (x.status === 'undetermined' ? '判定依据缺失，未判定' : '尚未确认'), '', x.owner]);
    L.push(C.mdTable(['序号', '条目', '未完成原因', '计划完成时间', '责任岗位'], rows));
  }
  L.push('> 存在任何一项未完成时，本设备不具备交出条件。');
  L.push('');

  L.push('## 六、交出确认签字');
  L.push('');
  L.push(C.mdTable(['确认方', '确认内容', '签字', '日期时间'], [
    ['工艺（操作）', '停车、隔离、泄压、降温、吹扫置换及盲板加装均已完成', '', ''],
    ['设备（车间设备员）', '机械隔离、盘车防转、联轴器拆除及设备状态确认', '', ''],
    ['安全', '取样分析结果合格、受限空间与用火条件、作业许可与双监护、现场消防与警戒措施', '', ''],
    ['检修（承修单位）', '已接收设备并确认交出条件，具备开工条件', '', ''],
  ]));
  L.push(`> ${DECLARATION}`);
  L.push('');

  if (warnings.length) {
    L.push('## 附：数据提示');
    L.push('');
    for (const w of warnings) L.push(`- ${w}`);
    L.push('');
  }
  fs.writeFileSync(path.join(outDir, 'handover.md'), L.join('\n'), 'utf8');

  C.emitOk(outDir, { ok: true, out: outDir, tag: a.tag, ready, readyNote, counts, warnings });
}

function triCn(v) { return v === null ? '**未说明**' : (v ? '是' : '否'); }
/** 完成情况单元格：脚本从不写「已完成」，只有回填了现场确认结果才显示 */
function statusCell(x) {
  if (x.confirmed === true) return '已完成';
  if (x.confirmed === false) return '**未完成**';
  if (x.status === 'undetermined') return '**未判定**';
  return '☐ 已完成　☐ 未完成';
}

try { main(); } catch (e) { C.fail(e, warnings); }
