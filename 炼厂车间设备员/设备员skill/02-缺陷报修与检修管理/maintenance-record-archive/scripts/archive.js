#!/usr/bin/env node
'use strict';
/**
 * 检修记录归档核对脚本（仅 Node.js 内置模块）
 * 用法：node scripts/archive.js --tag <位号> --project "<项目名称>" --type <大检修|日常维修|抢修|专项>
 *       --from <YYYY-MM-DD> --to <YYYY-MM-DD> --materials <材料清单xlsx或目录> [--out <dir>]
 * 可选：--ledger <设备台账xlsx（厂内台账或 SAP PM / EM 导出）> --contractor "<承修单位>" --content "<检修内容>" --special-equipment
 *       --scope-material --scope-weld --scope-ndt --scope-pressure --scope-trial
 * 产出：<out>/archive.json、archive.md、ledger-update.csv（EM 检修记录列头）、summary.json
 *
 * 硬约束：必备资料缺失 → mandatoryMissing 单列 + md 开头【注意】提示；文件名无法归类 → unclassified 单列，不按文件名猜测；
 *        台账只出更新建议，不改写用户文件；检修分级旧值映射并 warning，不默认。
 */
const fs = require('fs');
const path = require('path');
const { readXlsx, readCsvDir } = require('./lib/xlsx-lite');
const C = require('./lib/common');
const S = require('./lib/archive-spec');

const warnings = [];
const VALUE_OPTS = ['tag', 'project', 'type', 'from', 'to', 'materials', 'out', 'ledger', 'contractor', 'content'];
const FLAG_OPTS = ['special-equipment', 'scope-material', 'scope-weld', 'scope-ndt', 'scope-pressure', 'scope-trial', 'help'];

// 局部别名优先，再并入共享系统别名（SAP PM / EM：功能位置 → 位号，设备/设备编号 单独成列，设备描述 → 设备名称）
// 注意：局部不再把「设备编号」作为位号别名——SAP 的设备编号是 8 位流水号，与位号分列
const ALIASES = C.mergeAliases({
  '文件名': ['文件名', '资料名称', '名称', '材料名称', '文件', '附件名称'],
  '资料类型': ['资料类型', '类型', '类别', '资料类别'],
  '位号': ['位号', '设备位号', '功能位置'],
});

function loadBook(p) { return fs.statSync(p).isDirectory() ? readCsvDir(p) : readXlsx(p); }

/** 收集材料：目录 → 扫文件名；xlsx → 读「材料清单」表 */
function collectMaterials(p) {
  if (!fs.existsSync(p)) throw new Error(`材料清单/目录不存在: ${p}`);
  const st = fs.statSync(p);
  if (st.isDirectory()) {
    const files = [];
    const walk = (d, rel = '') => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.name.startsWith('.')) continue;
        const full = path.join(d, e.name);
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(full, r);
        else files.push({ name: e.name, rel: r, size: fs.statSync(full).size });
      }
    };
    walk(p);
    if (!files.length) warnings.push(`材料目录「${p}」中没有文件`);
    return files;
  }
  // xlsx 清单
  const rows = C.pickSheet(loadBook(p), '材料清单', '资料清单', '归档清单', '材料');
  if (!rows) throw new Error('材料清单文件中未找到「材料清单」工作表');
  const recs = C.toRecords(rows, ['文件名'], '材料清单', ['资料类型', '位号', '备注'], warnings, ALIASES);
  const out = [];
  for (const r of recs) {
    const n = C.str(r['文件名']);
    if (!n) { warnings.push(`工作表「材料清单」第${r._row}行 文件名为空，已跳过`); continue; }
    out.push({ name: n, rel: n, declaredType: C.str(r['资料类型']), size: null, _row: r._row });
  }
  return out;
}

function main() {
  const a = C.parseArgs(process.argv.slice(2), VALUE_OPTS, FLAG_OPTS);
  for (const k of ['tag', 'project', 'type', 'materials']) if (!a[k]) throw new Error(`缺少 --${k}`);
  const rt = S.normRepairType(a.type);
  if (!rt.type) throw new Error(`--type 只能是 ${S.TYPES.join(' / ')}（旧值 大修/中修/小修 可自动映射），收到「${rt.raw}」`);
  if (rt.mapped) warnings.push(`--type「${rt.raw}」为旧口径，已按中石化检修分级映射为「${rt.type}」（大修→大检修，中修/小修→日常维修）`);
  const repairType = rt.type;
  const from = a.from ? C.normDate(a.from) : null;
  const to = a.to ? C.normDate(a.to) : null;
  if (a.from && !from) throw new Error(`--from 「${a.from}」不是有效日期，应为 YYYY-MM-DD`);
  if (a.to && !to) throw new Error(`--to 「${a.to}」不是有效日期，应为 YYYY-MM-DD`);
  if (from && to && C.diffDays(to, from) < 0) throw new Error(`--to（${to}）早于 --from（${from}）`);

  const outDir = a.out || path.join(require('os').tmpdir(), 'mra-out');
  const special = !!a['special-equipment'];
  const scope = {
    material: !!a['scope-material'], weld: !!a['scope-weld'], ndt: !!a['scope-ndt'],
    pressure: !!a['scope-pressure'], trial: !!a['scope-trial'],
  };

  // ---- 应归档资料清单
  const required = S.requiredMaterials(repairType, scope, special);

  // ---- 实际材料
  const materials = collectMaterials(a.materials);

  // ---- 归类比对
  const hitMap = new Map();          // key → [文件]
  const unclassified = [];
  for (const m of materials) {
    const keys = S.classify(m.name, required);
    if (!keys.length) {
      unclassified.push({ name: m.name, rel: m.rel, declaredType: m.declaredType || null,
        note: '文件名无法识别归属类型，请人工认领；未按文件名猜测强行归类' });
      warnings.push(`材料「${m.name}」文件名无法识别归属类型，已列入待认领`);
      continue;
    }
    for (const k of keys) {
      if (!hitMap.has(k)) hitMap.set(k, []);
      hitMap.get(k).push(m);
    }
  }

  const archived = [], missing = [], mandatoryMissing = [];
  for (const req of required) {
    const files = hitMap.get(req.key) || [];
    if (files.length) {
      archived.push({ key: req.key, name: req.name, mandatory: req.mandatory,
        files: files.map((f) => ({ name: f.name, rel: f.rel })) });
    } else {
      const item = { key: req.key, name: req.name, mandatory: req.mandatory,
        note: req.mandatory ? '必备资料缺失，不满足归档要求' : '应归档资料缺失' };
      missing.push(item);
      if (req.mandatory) mandatoryMissing.push(item);
    }
  }

  // ---- 设备台账检修履历更新建议（台账可为厂内台账或 SAP PM / EM 导出）
  let ledgerUpdate = null, ledgerHasTag = null, ledgerRow = null;
  if (a.ledger) {
    if (!fs.existsSync(a.ledger)) throw new Error(`设备台账不存在: ${a.ledger}`);
    const rows = C.pickSheet(loadBook(a.ledger), '设备台账', '台账', '设备清单', '技术对象', '设备主数据');
    if (!rows) warnings.push('设备台账文件中未找到「设备台账」工作表，不生成履历更新建议');
    else {
      const recs = C.toRecords(rows, ['位号'], '设备台账', ['设备编号', '设备名称', '设备类别', '装置', '车间'], warnings, ALIASES);
      const key = C.str(a.tag).replace(/\s/g, '');
      ledgerRow = recs.find((r) => C.str(r['位号']).replace(/\s/g, '') === key)
        || recs.find((r) => C.str(r['设备编号']).replace(/\s/g, '') === key) || null;
      ledgerHasTag = !!ledgerRow;
      if (ledgerRow && C.str(ledgerRow['位号']).replace(/\s/g, '') !== key) {
        warnings.push(`「${a.tag}」按设备编号（SAP/EM）命中台账，对应功能位置/位号为「${C.str(ledgerRow['位号'])}」，履历更新建议按位号写出，请核实`);
      }
      if (!ledgerHasTag) warnings.push(`位号「${a.tag}」不在设备台账中（按位号与设备编号均未命中），履历更新建议仍生成，但需先确认位号`);
      ledgerUpdate = {
        tag: ledgerRow ? C.str(ledgerRow['位号']) : a.tag,
        equipNo: ledgerRow ? (C.str(ledgerRow['设备编号']) || null) : null,
        equipName: ledgerRow ? (C.str(ledgerRow['设备名称']) || null) : null,
        project: a.project, type: repairType, content: a.content || null,
        start: from, end: to, contractor: a.contractor || null,
        archivedCount: archived.length, missingCount: missing.length, mandatoryMissingCount: mandatoryMissing.length,
        note: '本行为更新建议，需用户确认后再写入 EM/台账；本技能不直接改写台账文件',
      };
    }
  }

  const counts = {
    required: required.length, archived: archived.length,
    missing: missing.length, mandatoryMissing: mandatoryMissing.length,
    unclassified: unclassified.length, materials: materials.length,
  };

  // ---- 产出
  C.ensureDir(outDir);
  const result = {
    meta: { tag: a.tag, project: a.project, type: repairType, typeRaw: rt.raw, typeMapped: rt.mapped, from, to,
      contractor: a.contractor || null, content: a.content || null, specialEquipment: special, scope,
      materialsSource: a.materials, generatedAt: C.localDateTime(),
      ledgerProvided: !!a.ledger, ledgerHasTag },
    counts, required: required.map((r) => ({ key: r.key, name: r.name, mandatory: r.mandatory })),
    archived, missing, mandatoryMissing, unclassified, ledgerUpdate, warnings,
  };
  fs.writeFileSync(path.join(outDir, 'archive.json'), JSON.stringify(result, null, 2), 'utf8');

  const SCOPE_CN = { material: '更换承压件', weld: '焊接', ndt: '无损检测', pressure: '试压', trial: '试运' };
  const L = [];
  L.push(`# 检修记录归档清单　${a.project}`);
  L.push('');
  if (mandatoryMissing.length) {
    L.push(`> 【注意】**必备资料缺失 ${mandatoryMissing.length} 项，不满足归档要求：${mandatoryMissing.map((x) => x.name).join('、')}**`);
    L.push('');
  }
  L.push('## 一、项目概况');
  L.push('');
  L.push(C.mdTable(['项目', '内容'], [
    ['设备位号', a.tag], ['项目名称', a.project],
    ['检修分级', rt.mapped ? `${repairType}（原填「${rt.raw}」）` : repairType],
    ['检修内容', a.content || '—'],
    ['检修起止', from && to ? `${from} ~ ${to}` : (from || to || '—')],
    ['承修单位', a.contractor || '—'],
    ['特种设备', special ? '是（适用特种设备必备资料要求）' : '否'],
    ['涉及范围', Object.entries(scope).filter(([, v]) => v).map(([k]) => SCOPE_CN[k]).join('、') || '—'],
    ['材料来源', a.materials],
  ]));
  L.push('## 二、已归档资料');
  L.push('');
  if (!archived.length) L.push('_无_\n');
  else L.push(C.mdTable(['应归档资料', '必备', '对应文件'],
    archived.map((x) => [x.name, x.mandatory ? '**是**' : '否', x.files.map((f) => f.rel).join('<br>')])));
  L.push('## 三、缺失资料');
  L.push('');
  if (!missing.length) L.push('_无_\n');
  else {
    L.push(C.mdTable(['缺失资料', '必备', '说明'],
      missing.map((x) => [x.mandatory ? `**${x.name}**` : x.name, x.mandatory ? '**是**' : '否', x.note])));
    L.push('> 缺失资料应如实说明，**不得用其他材料替代，不得事后补编记录**。');
    L.push('');
  }
  L.push('## 四、待认领材料');
  L.push('');
  if (!unclassified.length) L.push('_无_\n');
  else L.push(C.mdTable(['文件', '清单中标注的类型', '说明'],
    unclassified.map((x) => [x.rel, x.declaredType || '—', x.note])));
  L.push('## 五、台账履历更新建议（EM 检修记录列头）');
  L.push('');
  if (!ledgerUpdate) L.push('_未提供设备台账（--ledger），不生成履历更新建议。_\n');
  else {
    L.push(C.mdTable(['字段', '建议值'], [
      ['功能位置（位号）', ledgerUpdate.tag], ['设备编号', ledgerUpdate.equipNo || '—'], ['设备描述', ledgerUpdate.equipName || '—'],
      ['检修类型', ledgerUpdate.type], ['检修项目', ledgerUpdate.project], ['检修内容', ledgerUpdate.content || '—'],
      ['实际开始日期', ledgerUpdate.start || '—'], ['实际结束日期', ledgerUpdate.end || '—'],
      ['承修单位', ledgerUpdate.contractor || '—'],
      ['归档资料数', ledgerUpdate.archivedCount], ['缺失资料数', ledgerUpdate.missingCount], ['必备缺失数', ledgerUpdate.mandatoryMissingCount],
    ]));
    L.push(`> ${ledgerUpdate.note}`);
    L.push('');
    if (ledgerHasTag === false) { L.push(`> 【注意】位号「${a.tag}」不在所提供台账中（按位号与设备编号均未命中），请先确认位号是否正确。`); L.push(''); }
  }
  if (warnings.length) {
    L.push('## 附：数据提示');
    L.push('');
    for (const w of warnings) L.push(`- ${w}`);
    L.push('');
  }
  L.push('---');
  L.push('');
  L.push('本清单由脚本按归档规范核对、模型成文，仅供设备员复核参考，不替代档案室的正式归档手续；厂内档案管理制度与系统数据为准。');
  L.push('');
  fs.writeFileSync(path.join(outDir, 'archive.md'), L.join('\n'), 'utf8');

  // 台账更新建议 CSV（EM 检修记录列头，带 BOM）
  if (ledgerUpdate) {
    const head = ['功能位置', '设备编号', '设备描述', '检修类型', '检修项目', '检修内容', '实际开始日期', '实际结束日期', '承修单位', '归档资料数', '缺失资料数', '必备缺失数', '备注'];
    const row = [ledgerUpdate.tag, ledgerUpdate.equipNo || '', ledgerUpdate.equipName || '', ledgerUpdate.type, ledgerUpdate.project, ledgerUpdate.content || '',
      ledgerUpdate.start || '', ledgerUpdate.end || '', ledgerUpdate.contractor || '',
      ledgerUpdate.archivedCount, ledgerUpdate.missingCount, ledgerUpdate.mandatoryMissingCount, ledgerUpdate.note];
    fs.writeFileSync(path.join(outDir, 'ledger-update.csv'),
      '﻿' + [head, row].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n'), 'utf8');
  }

  C.emitOk(outDir, { ok: true, out: outDir, tag: a.tag, project: a.project, type: repairType, counts, warnings });
}

try { main(); } catch (e) { C.fail(e, warnings); }
