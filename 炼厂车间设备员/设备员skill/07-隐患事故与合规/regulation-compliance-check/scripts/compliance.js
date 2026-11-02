#!/usr/bin/env node
'use strict';
/**
 * 法规标准符合性自查对照脚本（仅 Node.js 内置模块）
 * 用法：node "<技能目录>/scripts/compliance.js" --rules <条款文本/条款清单> --materials <本车间资料路径或清单>
 *       --workshop "<车间名>" --date <YYYY-MM-DD> [--out <dir>]
 * 可选：--scope "<自查范围>" --internal "<厂内制度路径>" --last "<上次自查结果>"
 * 产出：<out>/compliance.json、compliance.md、对照表.xlsx、summary.json；末行打印 JSON 摘要
 *
 * 硬规则（见 references/compliance-rules.md，改动前务必先读）：
 *  - 状态只有四档：已见对应材料 / 未见对应材料 / 材料不完整 / 需进一步确认。
 *    **任何位置都不得出现「符合」「不符合」作为判定结论**，也不出现达标/合规/合格等结论性用语。
 *  - 条款文本必须由用户通过 --rules 提供；缺失时报错终止，**绝不凭记忆引用条款编号与原文**。
 *  - 条款要求笼统无法直接对照 → needInterpretation 单列，**不自行解释条款含义后判定**。
 *  - 找不到对应资料 → noEvidence「未见对应材料」，既不写「不符合」也不写「符合」。
 *  - 不提供法律意见与法律责任分析。
 */
const fs = require('fs');
const path = require('path');
const { readXlsx, readCsvDir, writeXlsx } = require('./lib/xlsx-lite');
const lite = require('./lib/docx-lite');
const C = require('./lib/common');
const S = require('./lib/compliance-spec');

const warnings = [];
const VALUE_OPTS = ['rules', 'materials', 'workshop', 'date', 'out', 'scope', 'internal', 'last'];
const FLAG_OPTS = ['help'];

/** SKILL.md 要求逐字保留的声明行，不得删除或改写 */
const STATEMENT = '本对照为辅助自查，仅反映所提供材料与条款的对应情况，不构成合规达标结论与法律意见；正式判定以监管部门、内审或法务意见为准';
/** 声明行之后的补充句（中石化口径）：自查表的最终结论由自查责任人填写，本技能不代填 */
const STATEMENT_FILL = '最终符合性结论由自查责任人按厂内审核表口径填写，本技能不代填';
/** 企业制度同样须由用户提供条款原文（写入 md 第一节之后） */
const INTERNAL_NOTICE = '企业制度（《中国石化设备管理规定》《炼化企业设备管理技术规定》及公司/厂内制度）与法规标准同样通过 --rules / --internal 传入，条款原文由用户提供，本技能不凭记忆引用任何制度条款';
/** 状态用语红线提示，写在 md 开头，模型不得删除或弱化 */
const STATUS_NOTICE = '本表状态仅有「已见对应材料 / 未见对应材料 / 材料不完整 / 需进一步确认」四档，不表述为「符合」或「不符合」；材料在不在是事实，达标与否是监管部门、内审或法务的结论，两回事';

const RULE_ALIASES = C.mergeAliases({
  '条款编号': ['条款编号', '条款号', '条文编号', '编号', '款号', '条款', '序号'],
  '条款原文': ['条款原文', '条款内容', '条文原文', '条文内容', '原文', '条款正文', '内容'],
  '应做事项': ['应做事项', '要求事项', '应当做的事', '具体要求', '要求', '管理要求', '应落实事项'],
  '标准名称': ['标准名称', '法规名称', '制度名称', '标准', '法规', '制度', '来源', '出处', '文件名称'],
});
const MAT_ALIASES = C.mergeAliases({
  '资料名称': ['资料名称', '材料名称', '文件名', '名称', '文件', '台账名称', '制度名称'],
  '存放位置': ['存放位置', '位置', '路径', '存放', '存档位置', '归档位置'],
  '资料类型': ['资料类型', '类型', '类别'],
  '完整性说明': ['完整性说明', '完整性', '状态', '材料状态', '说明'],
  '备注': ['备注', '注'],
});

/** 资料清单「完整性说明」列里表示材料不完整的提法（用户自己填报的事实，脚本不自行推断） */
const INCOMPLETE_HINTS = ['不完整', '不齐', '缺页', '缺章', '未签', '未盖章', '待补', '部分', '仅', '只有', '残缺', '未归档', '草稿', '未审批', '未批准'];

function loadBook(p) { return fs.statSync(p).isDirectory() ? readCsvDir(p) : readXlsx(p); }

/* ------------------------------------------------------------------ 条款解析 */

/**
 * 从纯文本抽条款：优先识别「条款编号 + 原文」形式的行。
 * 编号样式：第X条 / 4.1.2 / 一、 / 1. / (1)
 * **只搬运用户给的文本，绝不补全、绝不改写条款编号与原文。**
 */
function rulesFromText(text, srcName) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n').map((x) => x.trim()).filter(Boolean);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (/^#/.test(ln)) continue;                       // md 标题不当条款
    if (/^[-=|＿_]{3,}$/.test(ln)) continue;
    let m = ln.match(/^\s*(第\s*[0-9一二三四五六七八九十百]+\s*条(?:\s*第?\s*[0-9一二三四五六七八九十]+\s*款)?)\s*[：:、.．]?\s*(.+)$/);
    if (!m) m = ln.match(/^\s*(\d+(?:\.\d+){1,4})\s*[：:、.．\s]\s*(.+)$/);
    if (!m) m = ln.match(/^\s*(?:\(|（)?(\d{1,3}|[一二三四五六七八九十]{1,3})(?:\)|）|\.|、|．)\s*(.+)$/);
    if (m && S.norm(m[2]).length >= 3) {
      out.push({ no: m[1].replace(/\s+/g, ''), text: m[2].trim(), requirement: '', source: '', src: `${srcName} 第${i + 1}行` });
    }
  }
  if (!out.length) warnings.push(`条款来源「${srcName}」中未解析出任何条款（未找到「第X条」「4.1.2」「1.」等带编号的条文行）`);
  return out;
}

/** 从 docx 表格抽条款：命中「条款编号/条款原文」表头时按列取，否则退回正文逐行解析 */
function rulesFromDocx(file) {
  const src = path.basename(file);
  let res;
  try { res = lite.docxToText(fs.readFileSync(file)); } catch (e) { throw new Error(`条款文本解析失败 ${src}: ${e.message}`); }
  const out = [];
  for (const b of res.blocks) {
    if (b.kind !== 'table' || !b.rows || b.rows.length < 2) continue;
    const hdr = (b.rows[0] || []).map((c) => C.str(c).replace(/\s+/g, ''));
    const ti = C.findCol(hdr, '条款原文', RULE_ALIASES);
    if (ti < 0) continue;
    const ni = C.findCol(hdr, '条款编号', RULE_ALIASES);
    const ri = C.findCol(hdr, '应做事项', RULE_ALIASES);
    const si = C.findCol(hdr, '标准名称', RULE_ALIASES);
    for (let i = 1; i < b.rows.length; i++) {
      const r = b.rows[i] || [];
      const t = C.str(r[ti]);
      if (!t || t === hdr[ti]) continue;
      if (/^(合计|小计|总计|共计)/.test(C.str(r[0]))) { warnings.push(`条款来源「${src}」表格第${i + 1}行为合计行，已跳过`); continue; }
      out.push({
        no: (ni >= 0 && C.str(r[ni])) || String(out.length + 1),
        text: t, requirement: ri >= 0 ? C.str(r[ri]) : '',
        source: si >= 0 ? C.str(r[si]) : '', src: `${src} 表格第${i + 1}行`,
      });
    }
  }
  if (out.length) return out;
  warnings.push(`条款来源「${src}」中未找到含「条款原文」表头的表格，已按正文逐行解析`);
  return rulesFromText(res.text, src);
}

/** 从 xlsx 条款清单抽条款 */
function rulesFromXlsx(file) {
  const src = path.basename(file);
  const book = loadBook(file);
  const rows = C.pickSheet(book, '条款清单', '条款', '条文', '法规条款', '标准条款', '条款对照');
  if (!rows) throw new Error(`条款清单文件中未找到「条款清单」「条款」「条文」等工作表（实际工作表：${Object.keys(book).join('、') || '空'}）`);
  const recs = C.toRecords(rows, ['条款原文'], `${src}/条款清单`, ['条款编号', '应做事项', '标准名称'], warnings, RULE_ALIASES);
  const out = [];
  for (const r of recs) {
    const t = C.str(r['条款原文']);
    if (!t) { warnings.push(`工作表「${src}/条款清单」第${r._row}行 条款原文为空，已跳过`); continue; }
    out.push({
      no: C.str(r['条款编号']) || String(out.length + 1), text: t,
      requirement: C.str(r['应做事项']), source: C.str(r['标准名称']),
      src: `${src}/条款清单 第${r._row}行`,
    });
  }
  return out;
}

function parseRules(p) {
  if (!fs.existsSync(p)) throw new Error(`条款文本/条款清单不存在: ${p}；条款文本须由用户提供，本技能不从记忆中引用条款编号与原文`);
  const ext = path.extname(p).toLowerCase();
  if (ext === '.docx') return rulesFromDocx(p);
  if (ext === '.xlsx' || ext === '.xlsm') return rulesFromXlsx(p);
  if (ext === '.md' || ext === '.txt' || ext === '') {
    if (fs.statSync(p).isDirectory()) throw new Error(`--rules 不接受目录: ${p}`);
    return rulesFromText(fs.readFileSync(p, 'utf8'), path.basename(p));
  }
  throw new Error(`--rules 不支持的格式「${ext}」，仅支持 .docx / .xlsx / .md / .txt；脚本不读 PDF：请先用平台 pdf 技能把 PDF 转为 txt/docx 再传入（扫描件需先 OCR），不得凭记忆补充条款`);
}

/* ------------------------------------------------------------------ 资料收集 */

/** 目录递归扫描 或 xlsx 资料清单 */
function collectMaterials(p, label) {
  if (!fs.existsSync(p)) throw new Error(`${label}不存在: ${p}`);
  const st = fs.statSync(p);
  const out = [];
  if (st.isDirectory()) {
    const walk = (d, rel, depth) => {
      if (depth > 6) { warnings.push(`目录「${rel || '.'}」层级超过 6 层，未继续深入扫描`); return; }
      for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((x, y) => x.name.localeCompare(y.name, 'zh'))) {
        if (e.name.startsWith('.') || e.name.startsWith('~$')) continue;
        const full = path.join(d, e.name);
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(full, r, depth + 1);
        else out.push({ name: e.name, location: r, declaredType: '', completeness: '', note: '', incomplete: false, src: '目录扫描' });
      }
    };
    walk(p, '', 0);
    if (!out.length) warnings.push(`${label}「${p}」中没有文件`);
    return out;
  }
  const book = loadBook(p);
  const rows = C.pickSheet(book, '资料清单', '材料清单', '制度清单', '台账清单', '记录清单', '资料');
  if (!rows) throw new Error(`${label}文件中未找到「资料清单」「材料清单」「制度清单」等工作表（实际工作表：${Object.keys(book).join('、') || '空'}）`);
  const recs = C.toRecords(rows, ['资料名称'], `${path.basename(p)}/资料清单`, ['存放位置', '资料类型', '完整性说明', '备注'], warnings, MAT_ALIASES);
  for (const r of recs) {
    const n = C.str(r['资料名称']);
    if (!n) { warnings.push(`工作表「${path.basename(p)}/资料清单」第${r._row}行 资料名称为空，已跳过`); continue; }
    const comp = C.str(r['完整性说明']);
    const incomplete = INCOMPLETE_HINTS.some((k) => comp.includes(k));
    if (incomplete) warnings.push(`工作表「${path.basename(p)}/资料清单」第${r._row}行 资料「${n}」自报完整性为「${comp}」，相关条款按「材料不完整」处理，不按已见完整材料对待`);
    out.push({
      name: n, location: C.str(r['存放位置']) || n, declaredType: C.str(r['资料类型']),
      completeness: comp, note: C.str(r['备注']), incomplete, src: `${path.basename(p)}/资料清单 第${r._row}行`,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ 主流程 */

function main() {
  const a = C.parseArgs(process.argv.slice(2), VALUE_OPTS, FLAG_OPTS);
  // --rules 是硬前提：没有用户提供的条款文本就不做对照，绝不凭记忆补条款
  if (!a.rules) throw new Error('缺少 --rules：条款文本须由用户提供，本技能不从记忆中引用条款编号与原文，无条款文本时无法开展对照');
  for (const k of ['materials', 'workshop']) if (!a[k]) throw new Error(`缺少 --${k}`);

  let date = null;
  if (a.date) {
    date = C.normDate(a.date);
    if (!date) throw new Error(`--date 「${a.date}」不是有效日期，应为 YYYY-MM-DD`);
  } else {
    warnings.push('未提供 --date（自查时点），报告中自查时点按「未指定」处理');
  }
  if (a.internal && !fs.existsSync(a.internal)) throw new Error(`厂内制度路径不存在: ${a.internal}`);
  if (a.last && !fs.existsSync(a.last)) throw new Error(`上次自查结果不存在: ${a.last}`);

  const outDir = a.out || path.join(require('os').tmpdir(), 'rcc-out');

  // ---- 解析条款与资料
  const rawRules = parseRules(a.rules);
  if (!rawRules.length) {
    throw new Error(`未从「${path.basename(a.rules)}」解析出任何条款，请确认条款文本内容或改用 .xlsx 条款清单格式；不得凭记忆补充条款编号与原文`);
  }
  let materials = collectMaterials(a.materials, '本车间资料目录/清单');
  if (a.internal) {
    const extra = collectMaterials(a.internal, '厂内制度路径');
    for (const m of extra) { m.src = `厂内制度 · ${m.src}`; m.scopeLabel = '厂内制度'; }
    materials = materials.concat(extra);
  }
  const matCats = materials.map((m) => S.fileCategories(`${m.name} ${m.declaredType}`));

  // ---- 逐条款对照
  const items = [], hasEvidence = [], noEvidence = [], partialEvidence = [], needInterpretation = [];
  const usedIdx = new Set();
  for (const rl of rawRules) {
    // 条款原文与「应做事项」一并参与对照；「标准名称」是来源标签，不参与匹配
    // （拿标准名称匹配会把整个标准范围的资料都算成某一条的材料，缺口反而被掩盖）
    const searchText = [rl.text, rl.requirement].filter(Boolean).join(' ');
    const vg = S.vagueness(searchText);
    const cats = S.ruleCategories(searchText);

    const hits = [];
    for (let i = 0; i < materials.length; i++) {
      const m = materials[i];
      const r = S.matchRule(searchText, `${m.name} ${m.declaredType} ${m.location}`, cats, matCats[i]);
      if (r.matched) { hits.push({ idx: i, basis: r.basis }); usedIdx.add(i); }
    }
    const evidence = hits.map((h) => {
      const m = materials[h.idx];
      return {
        name: m.name, location: m.location, basis: h.basis,
        declaredType: m.declaredType || null,
        completeness: m.completeness || null, incomplete: !!m.incomplete,
        scopeLabel: m.scopeLabel || '本车间资料',
      };
    });

    let status, statusNote;
    if (vg.vague) {
      // 笼统条款一律单列，**不自行解释条款含义后判定**；即使名下挂到了资料也不改判
      status = 'needInterpretation';
      statusNote = `${vg.reason}。已列入「需进一步确认」，由用户、法务或标准归口部门明确条款的具体要求后再行对照；本技能不自行解释条款含义，不据此作出任何判定`;
      if (evidence.length) {
        statusNote += `；名下另有 ${evidence.length} 份名称相关的材料（${evidence.map((e) => e.name).join('、')}），仅供人工核对参考，未据此判定条款的对应情况`;
      }
    } else if (!evidence.length) {
      status = 'noEvidence';
      statusNote = '在所提供材料中未见与本条款对应的材料；此处仅说明材料未见，按「未见对应材料」一档记录，正式判定由监管部门、内审或法务作出';
    } else if (evidence.every((e) => e.incomplete)) {
      status = 'partialEvidence';
      statusNote = `名下材料均自报不完整（${evidence.map((e) => `${e.name}：${e.completeness || '未说明'}`).join('；')}），按「材料不完整」处理，不按已见完整材料对待`;
    } else if (evidence.some((e) => e.incomplete)) {
      status = 'partialEvidence';
      const bad = evidence.filter((e) => e.incomplete);
      statusNote = `名下 ${evidence.length} 份材料中有 ${bad.length} 份自报不完整（${bad.map((e) => `${e.name}：${e.completeness || '未说明'}`).join('；')}），按「材料不完整」处理，不因其余材料齐备而掩盖`;
    } else {
      status = 'hasEvidence';
      statusNote = `已见 ${evidence.length} 份对应材料；仅说明材料已见，材料内容是否满足条款要求需人工核对，本技能不作判定`;
    }

    const item = {
      no: rl.no, text: rl.text, requirement: rl.requirement || '',
      source: rl.source || '', src: rl.src,
      categories: cats, vague: vg.vague, vagueReason: vg.reason,
      evidence, status, statusCn: S.STATUS_CN[status], statusNote,
    };
    items.push(item);
    if (status === 'hasEvidence') hasEvidence.push(item);
    else if (status === 'noEvidence') noEvidence.push(item);
    else if (status === 'partialEvidence') partialEvidence.push(item);
    else needInterpretation.push(item);
  }

  // ---- 有资料但对不上任何条款
  const unmatched = [];
  for (let i = 0; i < materials.length; i++) {
    if (usedIdx.has(i)) continue;
    const m = materials[i];
    unmatched.push({
      name: m.name, location: m.location, declaredType: m.declaredType || null,
      scopeLabel: m.scopeLabel || '本车间资料',
      note: '未对应到本次自查的任何条款，请人工确认是否属于本次自查范围；未按名称猜测强行对应',
    });
  }
  if (needInterpretation.length) warnings.push(`有 ${needInterpretation.length} 条条款要求笼统、无法直接对照到具体资料，已列入「需进一步确认」，须由用户或法务明确条款含义，脚本不自行解释`);
  if (noEvidence.length) warnings.push(`有 ${noEvidence.length} 条条款在所提供材料中未见对应材料，仅说明材料未见，按「未见对应材料」一档记录`);
  if (partialEvidence.length) warnings.push(`有 ${partialEvidence.length} 条条款名下的材料自报不完整，按「材料不完整」处理`);
  if (unmatched.length) warnings.push(`有 ${unmatched.length} 份材料未对应到任何条款，已列入「未对应材料」由人工确认`);

  const counts = {
    rules: items.length,
    hasEvidence: hasEvidence.length,
    noEvidence: noEvidence.length,
    partialEvidence: partialEvidence.length,
    needInterpretation: needInterpretation.length,
    unmatched: unmatched.length,
    materials: materials.length,
  };

  // ---- 产出
  C.ensureDir(outDir);
  const result = {
    meta: {
      workshop: a.workshop, date, scope: a.scope || null,
      rulesSource: path.basename(a.rules), rulesSourcePath: a.rules,
      materialsSource: a.materials, internalSource: a.internal || null, lastCheck: a.last || null,
      generatedAt: C.localDateTime(),
      statement: STATEMENT, statementFill: STATEMENT_FILL, internalNotice: INTERNAL_NOTICE, statusNotice: STATUS_NOTICE,
      statusVocabulary: S.STATUS_KEYS.map((k) => S.STATUS_CN[k]),
      rulesProvidedByUser: true,
    },
    counts, items, hasEvidence, noEvidence, partialEvidence, needInterpretation, unmatched,
    materials: materials.map((m) => ({
      name: m.name, location: m.location, declaredType: m.declaredType || null,
      completeness: m.completeness || null, incomplete: !!m.incomplete,
      scopeLabel: m.scopeLabel || '本车间资料', src: m.src,
    })),
    warnings,
  };
  fs.writeFileSync(path.join(outDir, 'compliance.json'), JSON.stringify(result, null, 2), 'utf8');

  // ---- 对照表.xlsx
  const mainRows = [['条款编号', '条款原文', '应做事项', '标准来源', '对应材料', '存放位置', '状态', '说明']];
  for (const it of items) {
    mainRows.push([
      it.no, it.text, it.requirement || '—', it.source || '—',
      it.evidence.map((e) => e.name).join('；') || '—',
      it.evidence.map((e) => e.location).join('；') || '—',
      it.statusCn, it.statusNote,
    ]);
  }
  const gapRows = [['条款编号', '条款原文', '状态', '说明', '条款出处']];
  for (const it of noEvidence) gapRows.push([it.no, it.text, it.statusCn, it.statusNote, it.src]);
  for (const it of partialEvidence) gapRows.push([it.no, it.text, it.statusCn, it.statusNote, it.src]);
  const needRows = [['条款编号', '条款原文', '笼统之处', '处理方式', '条款出处']];
  for (const it of needInterpretation) needRows.push([it.no, it.text, it.vagueReason || '—', it.statusNote, it.src]);
  const unmRows = [['资料名称', '存放位置', '标注类型', '归属', '说明']];
  for (const u of unmatched) unmRows.push([u.name, u.location, u.declaredType || '—', u.scopeLabel, u.note]);
  writeXlsx(path.join(outDir, '对照表.xlsx'), {
    '条款对照': mainRows,
    '未见材料与材料不完整': gapRows,
    '需进一步确认': needRows,
    '未对应材料': unmRows,
    '状态口径与声明': [
      ['状态'], ['已见对应材料'], ['未见对应材料'], ['材料不完整'], ['需进一步确认'],
      [''], ['口径'], [STATUS_NOTICE], [''], ['声明'], [STATEMENT], [STATEMENT_FILL],
    ],
  });

  // ---- compliance.md
  const L = [];
  L.push(`# ${a.workshop} 法规标准符合性自查对照表`);
  L.push('');
  L.push(`> **${STATUS_NOTICE}**`);
  L.push('');
  L.push(`> 条款原文与编号全部来自用户提供的「${path.basename(a.rules)}」，未从记忆中引用任何条款；本对照不提供法律意见与法律责任分析。`);
  L.push('');
  if (needInterpretation.length) {
    L.push(`> **【注意】有 ${needInterpretation.length} 条条款要求笼统、无法直接对照到具体资料，已列入第四节「需进一步确认」；未自行解释条款含义，也未据此作出任何判定。**`);
    L.push('');
  }
  if (noEvidence.length || partialEvidence.length) {
    L.push(`> **【注意】未见对应材料 ${noEvidence.length} 条，材料不完整 ${partialEvidence.length} 条，明细见第三节；此处仅反映材料的对应情况，正式判定以监管部门、内审或法务意见为准。**`);
    L.push('');
  }

  L.push('## 一、自查范围与条款来源');
  L.push('');
  L.push(C.mdTable(['项目', '内容'], [
    ['车间', a.workshop],
    ['自查时点', date ? `${date}` : '—（未指定）'],
    ['自查范围', a.scope || '—'],
    ['条款来源', `${path.basename(a.rules)}（用户提供）`],
    ['本车间资料来源', a.materials],
    ['厂内制度', a.internal || '—'],
    ['上次自查结果', a.last || '—'],
    ['条款总数', counts.rules],
    ['已见对应材料', counts.hasEvidence],
    ['未见对应材料', counts.noEvidence],
    ['材料不完整', counts.partialEvidence],
    ['需进一步确认', counts.needInterpretation],
    ['未对应材料', counts.unmatched],
    ['资料总份数', counts.materials],
    ['生成时间', `${C.localDateTime()}（北京时间）`],
  ]));
  L.push('> 条款编号与原文逐字取自上述来源文件，脚本不改写、不补全、不据记忆增补。');
  L.push('');
  L.push(`> ${INTERNAL_NOTICE}。`);
  L.push('');

  L.push('## 二、逐条款对照');
  L.push('');
  L.push(C.mdTable(['条款编号', '条款原文', '应做事项', '对应材料', '存放位置', '状态'],
    items.map((x) => [x.no, x.text, x.requirement || '—',
      x.evidence.map((e) => e.name).join('<br>') || '—',
      x.evidence.map((e) => e.location).join('<br>') || '—',
      x.status === 'hasEvidence' ? x.statusCn : `**${x.statusCn}**`])));
  L.push('> 状态四档的含义：**已见对应材料**＝在所提供材料中找到了名称对应的材料；**未见对应材料**＝没找到；**材料不完整**＝找到了但填报为不齐全；**需进一步确认**＝条款要求笼统，无法直接对照。四档都只说明材料的对应情况，均不是达标与否的结论。');
  L.push('');

  L.push('## 三、未见对应材料与材料不完整的条款');
  L.push('');
  if (!noEvidence.length && !partialEvidence.length) {
    L.push('_所提供材料中，各条款均已见对应材料且未填报不完整情形。_\n');
  } else {
    if (noEvidence.length) {
      L.push('### （一）未见对应材料');
      L.push('');
      L.push(C.mdTable(['条款编号', '条款原文', '应做事项', '状态', '说明', '条款出处'],
        noEvidence.map((x) => [x.no, `**${x.text}**`, x.requirement || '—', `**${x.statusCn}**`, x.statusNote, x.src])));
    }
    if (partialEvidence.length) {
      L.push('### （二）材料不完整');
      L.push('');
      L.push(C.mdTable(['条款编号', '条款原文', '现有材料', '状态', '说明', '条款出处'],
        partialEvidence.map((x) => [x.no, `**${x.text}**`,
          x.evidence.map((e) => `${e.name}（${e.completeness || '未说明'}）`).join('<br>'),
          `**${x.statusCn}**`, x.statusNote, x.src])));
    }
    L.push('> 本节只反映材料的对应情况。**不得改写为「不符合」，也不得改写为「符合」**；材料未见的原因与后续处理由车间核实，正式判定以监管部门、内审或法务意见为准。');
    L.push('');
  }

  L.push('## 四、需进一步确认的条款');
  L.push('');
  if (!needInterpretation.length) {
    L.push('_所提供条款均指向了可对照的具体资料，无需进一步确认的条款。_\n');
  } else {
    // 「处理方式」剥掉开头重复的笼统原因，避免与左列一字不差地重复
    L.push(C.mdTable(['条款编号', '条款原文', '笼统之处', '处理方式', '条款出处'],
      needInterpretation.map((x) => [x.no, `**${x.text}**`, x.vagueReason || '—',
        x.statusNote.replace(`${x.vagueReason}。`, ''), x.src])));
    L.push('> 本节条款的具体含义须由用户、标准归口部门或法务明确后再行对照。**脚本与模型均不自行解释条款含义，不猜测其指向哪份资料，也不据此作出任何判定。**');
    L.push('');
  }

  L.push('## 五、跟进事项与未对应材料');
  L.push('');
  L.push('### （一）未对应到条款的材料');
  L.push('');
  L.push(C.mdTable(['资料名称', '存放位置', '标注类型', '归属', '说明'],
    unmatched.map((x) => [x.name, x.location, x.declaredType || '—', x.scopeLabel, x.note])));
  L.push('### （二）建议跟进事项');
  L.push('');
  L.push('<!-- ANALYSIS_START -->');
  L.push('（由模型依据 references/compliance-rules.md 口径撰写 200~400 字，结构：材料对应情况概述 → 未见对应材料的条款及核实方向 → 材料不完整条款的补充核对方向 → 需进一步确认条款的明确途径。数字一律引用 compliance.json 的 counts；**全文不得出现「符合」「不符合」「达标」「合规」「违规」等结论性表述**；不解释条款含义，不提供法律意见与法律责任分析，不替代监管部门、内审与法务的正式判定。）');
  L.push('<!-- ANALYSIS_END -->');
  L.push('');
  L.push('---');
  L.push('');
  L.push(`> ${STATEMENT}`);
  L.push('>');
  L.push(`> ${STATEMENT_FILL}`);
  L.push('');
  if (warnings.length) {
    L.push('## 附：数据提示');
    L.push('');
    for (const w of warnings) L.push(`- ${w}`);
    L.push('');
  }
  fs.writeFileSync(path.join(outDir, 'compliance.md'), L.join('\n'), 'utf8');

  C.emitOk(outDir, {
    ok: true, out: outDir, workshop: a.workshop, date, scope: a.scope || null,
    rulesSource: path.basename(a.rules), counts, warnings,
  });
}

try { main(); } catch (e) { C.fail(e, warnings); }
