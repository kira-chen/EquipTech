#!/usr/bin/env node
'use strict';
/**
 * 设备专业知识问答脚本（仅 Node.js 内置模块）
 * 用法：node scripts/qa.js --question <问题> [--docs <厂内资料路径>] [--out <dir>]
 * 可选：--equip-type <设备类型> --context <上下文字数> --all-matches
 * 产出：<out>/qa.json、qa.md、summary.json
 *
 * 硬口径：
 *  - 数值标准类问题一律拦截：questionType=numeric，只指路不给数，绝不输出记忆中的数值
 *  - 本厂规定类无厂内资料 → 明确写「无法回答」，不得用通用原理搪塞
 *  - 有资料时优先基于资料回答并标出处；资料中未找到时明确说明，再判断是否可用通用原理
 *  - 通用原理与厂内资料两类内容在 JSON 与 md 中分节标注，绝不混在一起
 *  - .pdf / 图片一律不解析内容，只做文件定位；PDF 统一前置步骤：先用平台 pdf 技能转为 txt/docx 再传入，扫描件需 OCR
 *  - 引用只能来自 --docs 范围内的文件；通用原理段 ≤ R.PRINCIPLE_MAX_CHARS 字且不得出现数字/单位
 */
const fs = require('fs');
const path = require('path');
const C = require('./lib/common');
const R = require('./lib/rules');
const lite = require('./lib/docx-lite');

const warnings = [];
const VALUE_OPTS = ['question', 'docs', 'out', 'equip-type', 'context'];
const FLAG_OPTS = ['all-matches', 'help'];

const TEXT_EXT = ['.md', '.txt', '.docx'];
const NO_TEXT_EXT = ['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tif', '.tiff', '.dwg', '.dxf'];
const SKIP_EXT = ['.xlsx', '.xls', '.csv'];

const EQUIP_TYPES = ['泵', '压缩机', '风机', '换热器', '容器', '塔', '管道', '阀门', '电机', '仪表', '机组', '加热炉'];

/** 声明行：SKILL.md 要求必须保留，脚本直接写进 md 产出 */
const DISCLAIMER = '本回答区分「厂内资料原文」与「通用原理」两类内容；通用原理非本厂规定，具体执行以厂内规程为准。涉及数值、限值、周期的问题一律以厂内规程/设备说明书为准，本技能不提供记忆中的数值。仅供参考，不替代操作规程与检修规程。';
/** PDF 统一前置步骤（SKILL.md 与 warning 口径一致） */
const PDF_NOTE = '本脚本不读 PDF：请先用平台 pdf 技能转为 txt/docx 再传入（扫描件需 OCR），本次仅做文件定位';

const norm = (v) => C.str(v).toLowerCase();

function collectFiles(root) {
  const st = fs.statSync(root);
  if (!st.isDirectory()) return [root];
  const out = [];
  const walk = (d, depth) => {
    if (depth > 6) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name.startsWith('~$')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else out.push(p);
    }
  };
  walk(root, 0);
  return out.sort();
}

function splitParagraphs(text) {
  const out = [];
  for (const ln of String(text).replace(/\r\n?/g, '\n').split('\n')) {
    const t = ln.trim();
    if (!t) continue;
    out.push({ no: out.length + 1, text: t });
  }
  return out;
}

function readPassages(file, ext) {
  if (ext === '.docx') return splitParagraphs(lite.docxToText(fs.readFileSync(file)).text);
  return splitParagraphs(fs.readFileSync(file, 'utf8'));
}

/**
 * 命中词去重：中文检索词是 2~4 字滑窗切出来的，同一处会同时命中「机泵备用件」「机泵备用」「备用件」
 * 等多个重叠片段。展示与计分只保留最长的那些，被其他命中词包含的短片段一律丢掉。
 */
function dedupeKeywords(hits) {
  const sorted = [...hits].sort((a, b) => b.length - a.length);
  const kept = [];
  for (const k of sorted) {
    if (kept.some((x) => x.includes(k))) continue;
    kept.push(k);
  }
  return kept;
}

function excerpt(text, kw, ctx) {
  const i = norm(text).indexOf(norm(kw));
  if (i < 0 || text.length <= ctx * 2) return text;
  const from = Math.max(0, i - ctx);
  const to = Math.min(text.length, i + kw.length + ctx);
  return (from > 0 ? '…' : '') + text.slice(from, to) + (to < text.length ? '…' : '');
}

function main() {
  const a = C.parseArgs(process.argv.slice(2), VALUE_OPTS, FLAG_OPTS);
  if (a.question === undefined) throw new Error('缺少 --question（要回答的设备专业问题）');
  const question = C.str(a.question);
  if (!question) throw new Error('--question 不能为空白');
  const equipType = a['equip-type'] ? C.str(a['equip-type']) : null;
  if (equipType && !EQUIP_TYPES.includes(equipType)) {
    throw new Error(`--equip-type 只能是 ${EQUIP_TYPES.join(' / ')}，收到「${equipType}」`);
  }
  const ctx = a.context ? Number(a.context) : 60;
  if (a.context && (!Number.isFinite(ctx) || ctx < 0)) throw new Error(`--context 「${a.context}」不是非负数字`);
  if (a.docs !== undefined && !fs.existsSync(a.docs)) throw new Error(`资料路径不存在: ${a.docs}`);
  const outDir = a.out || path.join(require('os').tmpdir(), 'ekqa-out');
  const maxPassages = a['all-matches'] ? Infinity : 20;

  // ---------------- 一、问题分类（本技能的核心）----------------
  const cls = R.classify(question);
  const keywords = R.splitQuery(question);
  if (!keywords.length) warnings.push(`问题「${question}」中没有长度 ≥2 的有效检索词，无法在资料中检索，仅做问题分类`);

  // ---------------- 二、资料检索（提供资料时）----------------
  const docsProvided = a.docs !== undefined;
  const documents = [];
  const unreadable = [];
  const passages = [];
  let filesScanned = 0;

  if (docsProvided) {
    const files = collectFiles(a.docs);
    filesScanned = files.length;
    if (!files.length) throw new Error(`资料路径下没有文件: ${a.docs}`);
    for (const f of files) {
      const base = path.basename(f);
      const ext = path.extname(f).toLowerCase();
      if (SKIP_EXT.includes(ext)) {
        warnings.push(`文件「${base}」为表格文件，本技能不作为资料原文检索（资料定位请用 technical-document-finder）`);
        unreadable.push({ file: base, path: f, ext, reason: '表格文件，本技能不作为资料原文检索', contentSearched: false });
        continue;
      }
      if (NO_TEXT_EXT.includes(ext)) {
        const reason = ext === '.pdf'
          ? `无文字层可供本脚本检索。${PDF_NOTE}`
          : (['.dwg', '.dxf'].includes(ext) ? 'CAD 图纸文件：无文字层可供本脚本检索，仅做文件定位'
            : '图片格式文件：无文字层，无法检索内容，仅做文件定位');
        warnings.push(`文件「${base}」${reason}`);
        unreadable.push({ file: base, path: f, ext, reason, contentSearched: false });
        documents.push({ file: base, path: f, ext, contentSearchable: false, paragraphs: null, hitParagraphs: null });
        continue;
      }
      if (!TEXT_EXT.includes(ext)) {
        warnings.push(`文件「${base}」格式 ${ext || '（无扩展名）'} 本脚本不解析，仅做文件定位`);
        unreadable.push({ file: base, path: f, ext, reason: `格式 ${ext || '（无扩展名）'} 本脚本不解析`, contentSearched: false });
        documents.push({ file: base, path: f, ext, contentSearchable: false, paragraphs: null, hitParagraphs: null });
        continue;
      }
      let paras = null;
      try { paras = readPassages(f, ext); }
      catch (e) {
        warnings.push(`文件「${base}」解析失败：${e.message}`);
        unreadable.push({ file: base, path: f, ext, reason: `解析失败：${e.message}`, contentSearched: false });
        continue;
      }
      if (!paras.length) {
        warnings.push(`文件「${base}」没有可检索的文字内容`);
        unreadable.push({ file: base, path: f, ext, reason: '文件内无文字内容', contentSearched: false });
        continue;
      }
      let hit = 0;
      for (const p of paras) {
        const hits = dedupeKeywords(keywords.filter((k) => norm(p.text).includes(norm(k))));
        if (!hits.length) continue;
        hit++;
        passages.push({
          file: base, location: `第${p.no}段`, paragraphNo: p.no,
          keywords: hits, hitCount: hits.length,
          text: p.text,
          excerpt: excerpt(p.text, hits[0], ctx),
          sourceKind: '厂内资料原文',
        });
      }
      documents.push({ file: base, path: f, ext, contentSearchable: true, paragraphs: paras.length, hitParagraphs: hit });
    }
  }

  passages.sort((x, y) => (y.hitCount - x.hitCount) || x.file.localeCompare(y.file) || (x.paragraphNo - y.paragraphNo));
  const passagesTotal = passages.length;
  const passagesOut = passagesTotal > maxPassages ? passages.slice(0, maxPassages) : passages;
  if (passagesTotal > maxPassages) warnings.push(`命中 ${passagesTotal} 段，仅返回前 ${maxPassages} 段（加 --all-matches 返回全部）`);

  const searchable = documents.filter((d) => d.contentSearchable);
  if (docsProvided && !searchable.length) warnings.push('所提供资料中没有可检索文字内容的文件，无法基于资料回答');
  if (docsProvided && searchable.length && keywords.length && !passagesTotal) {
    warnings.push(`所提供资料中未检索到与「${question}」相关的内容，未用通用知识补充到资料结论里`);
  }

  const sources = [...new Set(passagesOut.map((p) => p.file))].map((f) => {
    const d = documents.find((x) => x.file === f) || {};
    return { file: f, locations: passagesOut.filter((p) => p.file === f).map((p) => p.location), paragraphs: d.paragraphs === undefined ? null : d.paragraphs };
  });

  // ---------------- 三、作答指引（按类别分流，绝不越界）----------------
  const hasEvidence = passagesOut.length > 0;
  const guidance = buildGuidance(cls, { docsProvided, hasEvidence, searchableCount: searchable.length, question, equipType });

  const counts = {
    filesScanned,
    documentsContentSearchable: searchable.length,
    documentsNoTextLayer: documents.filter((d) => !d.contentSearchable).length,
    passages: passagesOut.length,
    passagesTotal,
    sources: sources.length,
    unreadable: unreadable.length,
    numericRulesMatched: cls.matched.numeric.length,
    plantRulesMatched: cls.matched.plant.length,
    principleRulesMatched: cls.matched.principle.length,
    whereToLook: guidance.whereToLook.length,
  };

  // ---------------- 四、产出 ----------------
  C.ensureDir(outDir);
  const result = {
    meta: {
      question, equipType,
      docsProvided, docsRoot: docsProvided ? path.resolve(a.docs) : null,
      keywords, contextChars: ctx, allMatches: !!a['all-matches'],
      citeScope: docsProvided ? 'docs-only' : 'none',           // 引用只能来自 --docs 范围内的文件
      principleMaxChars: R.PRINCIPLE_MAX_CHARS,                 // 通用原理段长度上限（字）
      pdfNote: PDF_NOTE,
      generatedAt: C.localDateTime(), disclaimer: DISCLAIMER,
    },
    questionType: cls.questionType,
    classification: {
      questionType: cls.questionType, typeCn: cls.typeCn,
      ruleId: cls.ruleId, basis: cls.basis, notice: cls.notice,
      matched: cls.matched,
      mixedPrinciple: cls.mixedPrinciple,
      requiresPlantDocs: cls.requiresPlantDocs,
      blockedFromAnswer: cls.blockedFromAnswer,
    },
    counts, guidance, passages: passagesOut, sources, documents, unreadable, warnings,
  };
  fs.writeFileSync(path.join(outDir, 'qa.json'), JSON.stringify(result, null, 2), 'utf8');
  fs.writeFileSync(path.join(outDir, 'qa.md'), renderMd(result), 'utf8');

  C.emitOk(outDir, {
    ok: true, out: outDir,
    question, questionType: cls.questionType, typeCn: cls.typeCn, ruleId: cls.ruleId,
    notice: cls.notice,
    canAnswer: guidance.canAnswer, answerBasis: guidance.answerBasis,
    counts, warnings,
  });
}

// ---------------------------------------------------------------- 作答指引
function buildGuidance(cls, { docsProvided, hasEvidence, searchableCount, question, equipType }) {
  const g = {
    questionType: cls.questionType,
    typeCn: cls.typeCn,
    notice: cls.notice,
    canAnswer: false,                 // 是否可以给出实质回答
    answerBasis: null,                // 'plant-docs' | 'general-principle' | 'none'
    mustSay: [],                      // 必须原样说给用户的句子
    mustNotSay: [],                   // 明令禁止的表述
    whereToLook: [],                  // 数值类指路（只指路不给数）
    nextSkills: [],
    generalPrincipleAllowed: false,
    plantRuleAnswerable: false,
  };

  if (cls.questionType === 'numeric') {
    g.whereToLook = R.whereToLook(question);
    g.blocked = true;
    g.canAnswer = hasEvidence;
    g.answerBasis = hasEvidence ? 'plant-docs' : 'none';
    g.generalPrincipleAllowed = false;
    g.mustSay.push(R.NOTICE.numeric);
    if (hasEvidence) {
      g.mustSay.push('以下数值来自所提供厂内资料原文，已标注出处；采用前请核实资料版本是否现行有效。');
    } else if (docsProvided) {
      g.mustSay.push('所提供资料中未检索到该数值，未用通用知识或行业惯例补一个数。');
      g.mustSay.push(`该数值通常记在：${g.whereToLook.map((w) => `${w.kind}见${w.where}`).join('；')}。`);
    } else {
      g.mustSay.push('未提供厂内资料，本技能无法给出该数值。');
      g.mustSay.push(`该数值通常记在：${g.whereToLook.map((w) => `${w.kind}见${w.where}`).join('；')}。`);
    }
    g.mustNotSay.push('凭记忆或行业惯例给出数值、区间、限值（如「一般取 40~50N·m」「通常 3 个月换一次」）');
    g.mustNotSay.push('用「大致」「差不多」「经验上」等措辞把记忆中的数值软化后给出');
    g.mustNotSay.push('把国标、行标、API 条文里的数值当作本厂执行值给出');
    if (cls.mixedPrinciple) {
      g.generalPrincipleAllowed = true;
      g.mustSay.push('问句中的原理部分可按通用原理解释，但须与数值部分分节，并标注「通用原理，非本厂规定」；数值部分仍不作答。');
    }
    g.nextSkills.push({ skill: 'technical-document-finder', why: '按位号检索厂内说明书、规程与技术协议中的该数值原文' });
    return g;
  }

  if (cls.questionType === 'plant') {
    g.plantRuleAnswerable = hasEvidence;
    g.canAnswer = hasEvidence;
    g.answerBasis = hasEvidence ? 'plant-docs' : 'none';
    g.generalPrincipleAllowed = false;
    g.mustSay.push(R.NOTICE.plant);
    if (hasEvidence) {
      g.mustSay.push('以下内容照录所提供厂内资料原文并标注出处，解释另起一段，不引入原文没有的结论。');
    } else if (docsProvided && searchableCount > 0) {
      g.mustSay.push('所提供资料中未涉及该问题，本技能无法回答本厂是怎么规定的。');
      g.mustSay.push('未用通用原理代替本厂规定作答。');
    } else if (docsProvided) {
      g.mustSay.push('所提供资料均无可检索的文字内容，本技能无法回答本厂是怎么规定的。');
      g.mustSay.push('未用通用原理代替本厂规定作答。');
    } else {
      g.mustSay.push('未提供厂内资料，本技能无法回答本厂是怎么规定的。');
      g.mustSay.push('未用通用原理代替本厂规定作答。');
    }
    g.mustNotSay.push('用通用原理、行业惯例或其他厂的做法回答「我们厂怎么规定」');
    g.mustNotSay.push('用「一般来说厂里都是……」把通用做法说成本厂规定');
    g.mustNotSay.push('用同类设备、邻位号设备的资料代替本设备的规定');
    g.nextSkills.push({ skill: 'technical-document-finder', why: '按位号定位本厂规程、说明书与技术协议原文' });
    return g;
  }

  if (cls.questionType === 'principle') {
    g.generalPrincipleAllowed = true;
    g.canAnswer = true;
    g.answerBasis = hasEvidence ? 'plant-docs' : 'general-principle';
    g.mustSay.push(hasEvidence
      ? '优先照录所提供厂内资料原文并标注出处；资料未覆盖的部分再按通用原理补充，并分节标注「通用原理，非本厂规定」。'
      : R.NOTICE.principle);
    if (docsProvided && !hasEvidence) {
      g.mustSay.push('所提供资料中未涉及该问题，以下为通用原理说明，非本厂规定。');
    }
    g.mustNotSay.push('在原理解释里夹带具体数值、限值、周期（如「间隙一般 0.05mm」）');
    g.mustNotSay.push('把通用原理写成本厂规定，或省略「通用原理」标注');
    g.nextSkills.push({ skill: 'technical-document-finder', why: '需要本厂具体规定与数值时，按位号检索厂内资料' });
    g.nextSkills.push({ skill: 'anomaly-triage-advisor', why: '问题实际指向当前正在发生的异常时转该技能' });
    return g;
  }

  // undetermined：不按任一类默认处理
  g.canAnswer = false;
  g.answerBasis = 'none';
  g.generalPrincipleAllowed = false;
  g.mustSay.push(R.NOTICE.undetermined);
  g.mustSay.push('未按原理概念类默认放行，也未按数值类直接拦截，请补充问题意图后重问。');
  g.mustNotSay.push('猜测用户意图后直接作答');
  g.mustNotSay.push('默认按原理概念类给出通用解释');
  return g;
}

// ---------------------------------------------------------------- md 渲染
function renderMd(r) {
  const { meta, classification: cls, counts, guidance: g } = r;
  const L = [];
  L.push('# 设备专业知识问答');
  L.push('');
  L.push(`问题：${meta.question}`);
  L.push(`问题类型：**${cls.typeCn}**（规则 ${cls.ruleId}）　${meta.equipType ? `设备类型：${meta.equipType}　` : ''}生成时间：${meta.generatedAt}（北京时间）`);
  L.push(`厂内资料：${meta.docsProvided ? `${meta.docsRoot}（扫描 ${counts.filesScanned} 个文件，可检索 ${counts.documentsContentSearchable} 份）` : '**未提供**'}`);
  L.push('');

  L.push('## 一、问题分类');
  L.push('');
  L.push(C.mdTable(['问题类型', '命中规则', '判定依据'], [[cls.typeCn, cls.ruleId, cls.basis]]));
  L.push(`> **${cls.notice}**`);
  L.push('');
  if (cls.questionType === 'numeric') {
    L.push('**本问题属数值标准类，已拦截：本技能不输出任何记忆中的数值、限值、周期。**');
    L.push('');
  }
  if (cls.questionType === 'undetermined') {
    L.push('**本问题未能归入三类中的任一类，未按任一类默认处理。**');
    L.push('');
  }
  if (cls.mixedPrinciple) {
    L.push('> 问句中同时含原理成分：原理部分可按通用原理解释，但须与本节类型对应的限制分节呈现。');
    L.push('');
  }
  const allMatched = [
    ...cls.matched.numeric.map((m) => ['数值标准类', m.ruleId, m.note]),
    ...cls.matched.plant.map((m) => ['本厂规定类', m.ruleId, m.note]),
    ...cls.matched.principle.map((m) => ['原理概念类', m.ruleId, m.note]),
  ];
  L.push('命中的全部规则（可追溯到 `scripts/lib/rules.js`）：');
  L.push('');
  L.push(C.mdTable(['规则组', '规则号', '说明'], allMatched));

  L.push('## 二、厂内资料原文');
  L.push('');
  L.push(`> 引用只能来自 \`--docs\` 范围内的文件（${meta.docsProvided ? meta.docsRoot : '本次未提供'}），引用必须带文件名与段号；不得引用范围外的任何文件或记忆中的"规程原文"。`);
  L.push('');
  if (!meta.docsProvided) {
    L.push('**未提供厂内资料，本节无内容。**');
    L.push('');
    L.push('> 本节只放厂内资料原文。未提供资料时不以通用原理填充本节。');
    L.push('');
  } else if (!r.passages.length) {
    L.push(`**所提供资料中未涉及该问题**（扫描 ${counts.filesScanned} 个文件，可检索 ${counts.documentsContentSearchable} 份，命中 0 段）。`);
    L.push('');
    L.push('> 未用通用知识补充到本节，也未用其他设备的资料代替。');
    L.push('');
  } else {
    L.push(`命中 **${counts.passagesTotal}** 段${counts.passagesTotal > r.passages.length ? `，以下列出前 ${r.passages.length} 段` : ''}。原文照录，解释另列：`);
    L.push('');
    for (const p of r.passages) {
      L.push(`**出处：${p.file}　${p.location}**（命中词：${p.keywords.join('、')}）`);
      L.push('');
      L.push(`> ${p.text}`);
      L.push('');
    }
    L.push('来源清单：');
    L.push('');
    L.push(C.mdTable(['文件', '命中位置', '总段数'], r.sources.map((s) => [s.file, s.locations.join('、'), C.fmt(s.paragraphs)])));
  }

  L.push('## 三、通用原理适用性');
  L.push('');
  if (g.generalPrincipleAllowed) {
    L.push('**可用通用原理作答**，但必须整段标注：');
    L.push('');
    L.push('> 以下为通用原理说明，**非本厂规定**，具体以厂内规程为准。');
    L.push('');
    L.push('通用原理段落中**不得出现任何具体数值、限值、周期**；涉及数值一律转「四、数值类处理」。');
    L.push('');
    L.push(`【注意】通用原理段 **不超过 ${R.PRINCIPLE_MAX_CHARS} 字**，且**不得出现任何数字或单位**（出现即视为夹带数值）。该约束由 \`references/checklist.md\` 在交付前核对。`);
    L.push('');
  } else {
    L.push('**不可用通用原理作答本问题。**');
    L.push('');
    if (cls.questionType === 'plant') {
      L.push('> 本厂规定类问题必须有厂内资料才能回答；无资料时明确说明无法回答，**不得用通用原理搪塞**。');
    } else if (cls.questionType === 'numeric') {
      L.push('> 数值标准类问题不得用通用原理推出一个数值；只说明该数值在哪类文件中规定。');
    } else {
      L.push('> 问题类型未判定，不按原理概念类默认放行。');
    }
    L.push('');
  }

  L.push('## 四、数值类处理');
  L.push('');
  if (cls.questionType !== 'numeric') {
    L.push('本问题不属数值标准类。若回答过程中出现具体数值、限值、周期，同样适用：**该数值须以厂内规程/设备说明书为准，本技能不提供记忆中的数值。**');
    L.push('');
  } else {
    L.push(`**${R.NOTICE.numeric}**`);
    L.push('');
    L.push('该类数值通常在以下厂内文件中规定（**只指路，不给数**）：');
    L.push('');
    L.push(C.mdTable(['规则号', '数值类别', '通常规定在', '中石化体系炼化厂常见文件示例（只引名称）'], g.whereToLook.map((w) => [w.ruleId, w.kind, w.where, w.example || '—'])));
    L.push('> 文件名为常见示例，各厂受控文件名可能不同；本技能不转述上述文件中的任何数值。');
    L.push('');
  }

  L.push('## 五、必须说明的话');
  L.push('');
  for (const s of g.mustSay) L.push(`- ${s}`);
  L.push('');
  L.push('**禁止的表述：**');
  L.push('');
  for (const s of g.mustNotSay) L.push(`- ${s}`);
  L.push('');
  L.push(C.mdTable(['能否作答', '作答依据', '可用通用原理', '需厂内资料'],
    [[g.canAnswer ? '可以' : '**不可以**',
      { 'plant-docs': '厂内资料原文', 'general-principle': '通用原理', none: '—（无依据，不作答）' }[g.answerBasis] || '—',
      g.generalPrincipleAllowed ? '是' : '否',
      cls.requiresPlantDocs ? '是' : '否']]));

  L.push('## 六、无法检索内容的文件');
  L.push('');
  if (!r.unreadable.length) {
    L.push(meta.docsProvided ? '无。所提供资料均可检索文字内容。' : '未提供资料。');
    L.push('');
  } else {
    L.push(C.mdTable(['文件名', '格式', '原因'], r.unreadable.map((u) => [u.file, u.ext || '—', u.reason])));
    L.push('> 以上文件**只做了文件定位，未读取其中任何内容**；其中的数值、材质、编号一律不得据此作答。');
    if (r.unreadable.some((u) => u.ext === '.pdf')) L.push(`> 【注意】${PDF_NOTE}。`);
    L.push('');
  }

  L.push('## 七、回答组织');
  L.push('');
  L.push('<!-- ANALYSIS_START -->');
  L.push('（由模型依据 references/qa-rules.md 口径撰写：结论或定义 → 展开解释 → 来源标注 → 适用提示。'
    + '厂内资料原文与通用原理必须分节，各自带标注；引用只能来自上述 --docs 范围内的文件并带文件名与段号；'
    + '通用原理段长度不得超过第三节给出的上限，且不得出现任何数字或单位；数值标准类只说明去哪查，不给数值；'
    + '本厂规定类无资料时直接说无法回答，不用通用原理搪塞。）');
  L.push('<!-- ANALYSIS_END -->');
  L.push('');

  if (g.nextSkills.length) {
    L.push('## 八、相关技能');
    L.push('');
    L.push(C.mdTable(['技能', '何时接上'], g.nextSkills.map((s) => [s.skill, s.why])));
  }

  L.push('---');
  L.push('');
  L.push(`> ${DISCLAIMER}`);
  L.push('');
  if (r.warnings.length) {
    L.push('## 附：数据提示');
    L.push('');
    for (const w of r.warnings) L.push(`- ${w}`);
    L.push('');
  }
  return L.join('\n');
}

try { main(); } catch (e) { C.fail(e, warnings); }
