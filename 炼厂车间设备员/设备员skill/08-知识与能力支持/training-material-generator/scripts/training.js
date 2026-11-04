#!/usr/bin/env node
'use strict';
/**
 * 设备培训材料与考题生成（仅 Node.js 内置模块）
 * 用法：node scripts/training.js --scope "<设备范围或主题>" --audience <新员工|在岗|转岗|复岗|四新|三级安全教育> [--out <dir>]
 * 可选：--docs "<资料路径,可多个,可目录>" --ledger <设备清单xlsx> --duration <学时>
 *       --questions <题数> --types "单选,多选,判断,简答" --difficulty <基础|中等|较难> --no-negative-judge（判断题只出肯定式）
 * 产出：<out>/training.json、培训提纲.md、讲义要点.md、考题与答案.md、summary.json
 *
 * 硬约束：
 *   1. 涉及具体数值（力矩、间隙、限值、周期、压力、温度）的考题，答案必须来自
 *      所提供资料并标注出处；无出处的一律降级为原理概念题，**绝不凭经验出数值题**。
 *   2. 资料不足以支撑要求的题量 → warning 说明可出题数，**绝不用编造的数值题凑数**。
 *   3. 原理类内容标注「通用原理」，与厂内规定分开。
 *   4. 不生成安全操作规程类内容。
 *   5. 判断题分肯定式（答案「正确」）与否定式（原句加否定词、**不改任何数值**，答案「错误」），改写前后数字序列必须一致。
 *   6. 内置通用原理条目 source:'builtin'，声明行点名须经车间技术人员审核。
 */
const fs = require('fs');
const path = require('path');
const { readXlsx, readCsvDir } = require('./lib/xlsx-lite');
const C = require('./lib/common');
const T = require('./lib/tm');
const D = require('./lib/docsrc');

const warnings = [];
const VALUE_OPTS = ['scope', 'audience', 'out', 'docs', 'ledger', 'duration', 'questions', 'types', 'difficulty', 'workshop'];
const FLAG_OPTS = ['help', 'no-negative-judge'];

/**
 * 列名别名：局部别名优先，再合并共享 SYSTEM_ALIASES（SAP PM / EM 导出列名：功能位置、设备描述、对象类型、工厂区段…）。
 * 注意：局部不再把「设备编号」「设备」当位号/名称别名——SAP 的「设备」「设备编号」是 8 位流水号，不是位号，也不是名称。
 */
const ALIASES = C.mergeAliases({
  '位号': ['位号', '设备位号', 'TAG', 'tag'],
  '设备名称': ['设备名称', '名称'],
  '设备类型': ['设备类型', '类型', '设备类别', '对象类型', '设备分类', '专业类别', '设备品种'],
  '区域': ['区域', '装置区', '位置', '装置', '工厂区段', '单元', '装置名称', '生产单元'],
});

function loadBook(p) { return fs.statSync(p).isDirectory() ? readCsvDir(p) : readXlsx(p); }
const CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四', '十五'];

function main() {
  const a = C.parseArgs(process.argv.slice(2), VALUE_OPTS, FLAG_OPTS);

  // ---------------- 参数校验
  if (!a.audience) throw new Error(`缺少 --audience（培训对象），可选：${T.AUDIENCE_KEYS.join(' / ')}`);
  const audKey = T.normAudience(a.audience);
  if (!audKey) throw new Error(`--audience 只能是 ${T.AUDIENCE_KEYS.join(' / ')}，收到「${a.audience}」`);
  const AUD = T.AUDIENCES[audKey];
  if (!a.scope && !a.ledger) throw new Error('缺少 --scope（设备范围或主题）或 --ledger（设备清单）');

  let difficulty = a.difficulty || AUD.defaultDifficulty;
  if (!T.DIFFICULTIES.includes(difficulty)) throw new Error(`--difficulty 只能是 ${T.DIFFICULTIES.join(' / ')}，收到「${difficulty}」`);

  let duration = null;
  if (a.duration !== undefined) {
    const n = Number(a.duration);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`--duration 必须是正数（学时），收到「${a.duration}」`);
    duration = n;
  }
  let wanted = null;
  if (a.questions !== undefined) {
    const n = Number(a.questions);
    if (!Number.isFinite(n) || n <= 0 || n !== Math.round(n)) throw new Error(`--questions 必须是正整数，收到「${a.questions}」`);
    wanted = n;
  }
  const types = T.normTypes(a.types, warnings);
  if (a.types && !types.length) throw new Error(`--types 中没有可识别的题型，可用：${T.QUESTION_TYPES.join('、')}`);

  const outDir = a.out || path.join(require('os').tmpdir(), 'tmg-out');

  // ---------------- 设备范围
  const typeMap = new Map();      // 设备类型 -> [{tag,name,area}]
  const scopeTopics = [];         // --scope 中的自由主题（非设备类型）
  const ledgerRecs = [];          // 台账有效设备 {type, tag, name, area}
  if (a.ledger) {
    if (!fs.existsSync(a.ledger)) throw new Error(`设备清单不存在: ${a.ledger}`);
    const book = loadBook(a.ledger);
    // SAP PM（IH08 技术对象清单 / 功能位置清单）与 EM 导出的 sheet 名也能命中；都不命中时取第一个 sheet 并 warning
    let rows = C.pickSheet(book, '设备台账', '设备清单', '台账', '技术对象', '功能位置', '设备', '清单', 'Sheet1');
    if (!rows) {
      const first = Object.keys(book)[0];
      if (!first) throw new Error('设备清单文件中未找到「设备台账」工作表');
      warnings.push(`设备清单文件中未找到「设备台账 / 技术对象清单」工作表，已按第一个工作表「${first}」读取，请核对`);
      rows = book[first];
    }
    const recs = C.toRecords(rows, ['位号'], '设备台账', ['设备名称', '设备类型', '区域'], warnings, ALIASES);
    for (const r of recs) {
      const tag = C.str(r['位号']);
      if (!tag) { warnings.push(`工作表「设备台账」第${r._row}行 位号为空，已跳过`); continue; }
      const declared = C.str(r['设备类型']);
      const t = declared ? T.typeOf(declared) : T.typeOf(C.str(r['设备名称']));
      ledgerRecs.push({ type: t, tag, name: C.str(r['设备名称']), area: C.str(r['区域']) });
    }
    if (!ledgerRecs.length) throw new Error('设备清单中没有有效设备行');
  }
  const blockedTopics = [];
  const scopePieces = [];         // 通过规程类拦截的 scope 片段 {piece, type, all}
  if (a.scope) {
    for (const piece of a.scope.split(/[,，、]/).map((x) => x.trim()).filter(Boolean)) {
      const chk = T.checkTopic(piece);
      if (!chk.ok) {
        blockedTopics.push(chk);
        warnings.push(`主题「${piece}」属安全操作规程类内容（${chk.ruleId}：${chk.reason}），已剔除，不生成`);
        continue;
      }
      scopePieces.push({ piece, type: T.typeOf(piece), all: /通用|全部|所有|设备管理/.test(piece) });
    }
  }
  // 台账 + scope 同时给：按 scope 过滤台账（设备类型命中，或位号 / 名称 / 区域含该片段）；scope 为「全部 / 所有」或只有自由主题时不过滤
  const recMatch = (rec, p) => (p.type !== '通用' && rec.type === p.type)
    || [rec.tag, rec.name, rec.area].some((v) => v && (v === p.piece || v.includes(p.piece)));
  let keptRecs = ledgerRecs;
  if (ledgerRecs.length && scopePieces.length && !scopePieces.some((p) => p.all)) {
    const filtering = scopePieces.filter((p) => p.type !== '通用' || ledgerRecs.some((rec) => recMatch(rec, p)));
    if (filtering.length) {
      keptRecs = ledgerRecs.filter((rec) => filtering.some((p) => recMatch(rec, p)));
      const dropped = ledgerRecs.filter((rec) => !keptRecs.includes(rec));
      if (dropped.length) {
        const dropTypes = [...new Set(dropped.map((rec) => rec.type))].join('、');
        warnings.push(`已按 --scope「${a.scope}」过滤设备清单：保留 ${keptRecs.length} 台，剔除 ${dropped.length} 台（${dropTypes}）`);
      }
    } else {
      warnings.push(`--scope「${a.scope}」中没有可识别的设备类型或台账位号，设备清单未过滤，按清单全部 ${ledgerRecs.length} 台生成`);
    }
  }
  for (const rec of keptRecs) {
    if (!typeMap.has(rec.type)) typeMap.set(rec.type, []);
    typeMap.get(rec.type).push({ tag: rec.tag, name: rec.name, area: rec.area });
  }
  for (const p of scopePieces) {
    const byText = p.type === '通用' && ledgerRecs.some((rec) => recMatch(rec, p));
    if (byText) continue;                                   // 位号 / 区域类片段只用于过滤台账
    if (p.all && ledgerRecs.length) continue;               // 有台账时「全部」只表示不过滤
    if (p.type === '通用' && !p.all) scopeTopics.push(p.piece);
    if (ledgerRecs.length && p.type !== '通用' && !typeMap.has(p.type)) warnings.push(`设备清单中没有「${p.type}」类设备，该类只按通用原理生成，提纲不列位号`);
    if (!typeMap.has(p.type)) typeMap.set(p.type, []);
  }
  if (!typeMap.size) throw new Error('剔除不生成的主题后没有可用的培训范围');

  // ---------------- 资料
  let clauses = [], docFiles = [];
  const docsProvided = !!a.docs;
  if (docsProvided) {
    const paths = D.expandDocPaths(a.docs, warnings);
    const ex = D.extractClauses(paths, warnings);
    clauses = ex.clauses;
    docFiles = ex.files;
    if (!clauses.length) warnings.push('所提供资料中未抽取到任何条款，本次只能生成原理概念类内容');
  } else {
    warnings.push('未提供 --docs 资料，本次只生成通用原理类内容，不产出任何带数值的考题');
  }
  // 条款也要过规程类拦截：操作步骤类条款不进入讲义与考题
  const usableClauses = [];
  for (const c of clauses) {
    const chk = T.checkTopic(c.text);
    if (!chk.ok) {
      blockedTopics.push({ ...chk, source: c.source, ruleId: chk.ruleId });
      continue;
    }
    usableClauses.push(c);
  }
  const blockedClauseCount = clauses.length - usableClauses.length;
  if (blockedClauseCount) warnings.push(`资料中有 ${blockedClauseCount} 条属安全操作规程/操作步骤类内容，已排除，不生成相关材料（以厂内正式规程为准）`);
  const numericClauses = usableClauses.filter((c) => c.numeric);

  // ---------------- 一、培训提纲
  const totalWeight = AUD.modules.reduce((n, m) => n + m.weight, 0);
  const outline = AUD.modules.map((m, i) => {
    const hours = duration === null ? null : C.round(duration * m.weight / totalWeight, 1);
    // 与本次设备范围相关的主题补充
    const extra = [];
    if (m.name.includes('特有设备') || m.name.includes('设备认识')) {
      for (const [t, list] of typeMap) {
        extra.push(list.length
          ? `${t}：${list.slice(0, 6).map((e) => e.tag).join('、')}${list.length > 6 ? ` 等 ${list.length} 台` : ''}`
          : `${t}（未提供台账位号）`);
      }
    }
    return {
      no: i + 1, name: m.name, aim: m.aim, weight: m.weight, hours,
      topics: m.topics.concat(extra),
    };
  });
  // 自由主题并入最后一个模块
  if (scopeTopics.length) outline[outline.length - 1].topics.push(...scopeTopics.map((s) => `${s}（用户指定主题）`));

  // ---------------- 二、讲义要点
  const keyPoints = [];
  // 2.1 通用原理（标注「通用原理」，不含厂内数值）
  for (const [t] of typeMap) {
    const list = T.PRINCIPLES[t] || T.PRINCIPLES['通用'];
    for (const item of list) {
      keyPoints.push({
        category: '通用原理', equipType: t, point: item.p,
        source: null, origin: item.source || T.PRINCIPLE_SOURCE, cite: '通用原理（非厂内规定）',
      });
    }
  }
  // 2.2 厂内规定（逐条带出处）
  for (const c of usableClauses) {
    keyPoints.push({
      category: '厂内规定', equipType: T.typeOf(c.topicHint || c.text),
      point: c.text, clauseId: c.id,
      source: c.source, cite: D.citeOf(c.source),
      numeric: c.numeric,
    });
  }
  // 自检：通用原理条目中不得混入数值
  const principleWithNum = keyPoints.filter((k) => k.category === '通用原理' && T.hasNumericValue(k.point));
  if (principleWithNum.length) {
    for (const k of principleWithNum) warnings.push(`通用原理要点「${k.point.slice(0, 20)}…」含数值，已剔除（通用原理不得携带厂内数值）`);
  }
  const keyPointsClean = keyPoints.filter((k) => !(k.category === '通用原理' && T.hasNumericValue(k.point)));

  // ---------------- 三、考题
  const questions = [];
  const noSourceTopics = [];
  let qseq = 0;
  const nextNo = () => ++qseq;
  const pickType = (i) => types[i % types.length];

  // 3.1 数值类考题：**只能来自资料条款**
  const numericQs = [];
  for (const c of numericClauses) {
    const answerText = stripClauseNo(c.text);
    const stem = buildNumericStem(c);
    numericQs.push({
      no: null, type: null, kind: '数值类', difficulty,
      stem, options: null, answer: answerText,
      source: c.source, cite: D.citeOf(c.source), clauseId: c.id,
      basis: '厂内规定', point: c.topicHint || '厂内规定条款',
    });
  }
  // 3.2 原理概念类考题：来自通用原理库，**不含任何数值**
  const principleQs = [];
  for (const [t] of typeMap) {
    const list = T.PRINCIPLES[t] || T.PRINCIPLES['通用'];
    for (const item of list) {
      principleQs.push({
        no: null, type: null, kind: '原理概念类', difficulty,
        stem: item.q, options: null, answer: item.p,
        source: null, origin: item.source || T.PRINCIPLE_SOURCE, cite: '通用原理（非厂内规定）', clauseId: null,
        basis: '通用原理', point: t,
      });
    }
  }
  // 3.3 厂内规定中的非数值条款 → 定性题
  const qualitativeQs = [];
  for (const c of usableClauses.filter((x) => !x.numeric)) {
    qualitativeQs.push({
      no: null, type: null, kind: '定性规定类', difficulty,
      stem: `${c.topicHint ? c.topicHint + '：' : ''}厂内规定对此是怎么要求的？`, options: null,
      answer: stripClauseNo(c.text), source: c.source, cite: D.citeOf(c.source), clauseId: c.id,
      basis: '厂内规定', point: c.topicHint || '厂内规定条款',
    });
  }

  // 可出题总数（真实上限，不靠编造补足）
  const pool = numericQs.concat(qualitativeQs, principleQs);
  const available = pool.length;
  let take = wanted === null ? Math.min(available, defaultCount(AUD, duration)) : Math.min(wanted, available);
  if (wanted !== null && wanted > available) {
    warnings.push(`要求 ${wanted} 道题，但按现有资料与原理库只能出 ${available} 道（数值类 ${numericQs.length}、定性规定类 ${qualitativeQs.length}、原理概念类 ${principleQs.length}）；已按 ${available} 道出题，未用编造的数值题凑数`);
  }
  if (!available) warnings.push('没有任何可用的出题素材');

  const negativeJudge = !a['no-negative-judge'];
  let judgeSeq = 0;
  for (let i = 0; i < take; i++) {
    const q = pool[i];
    q.no = nextNo();
    q.type = assignType(q, pickType(i), types);
    // 判断题交替出肯定式 / 否定式（第 2、4、6… 道判断题尝试否定式；无可改写点或改写动了数字则退回肯定式）
    const wantNeg = q.type === '判断' && negativeJudge && (++judgeSeq % 2 === 0);
    materialize(q, wantNeg, warnings);
    questions.push(q);
  }

  // 3.4 无资料支撑的主题（想考但没出处 → 只能出原理题，在此登记）
  if (!numericClauses.length) {
    for (const [t] of typeMap) {
      noSourceTopics.push({
        topic: `${t}的力矩 / 间隙 / 限值 / 周期等具体数值`,
        reason: docsProvided ? '所提供资料中没有该类设备的数值条款' : '未提供厂内资料',
        handled: '已改为原理概念题，未生成任何带数值的答案',
      });
    }
  } else {
    const covered = new Set(numericClauses.map((c) => T.typeOf(c.topicHint || c.text)));
    for (const [t] of typeMap) {
      if (covered.has(t)) continue;
      noSourceTopics.push({
        topic: `${t}的具体数值类考点`,
        reason: '所提供资料中没有该类设备的数值条款',
        handled: '已改为原理概念题，未生成任何带数值的答案',
      });
    }
  }

  // ---------------- 四、出处硬校验（命脉）
  const violations = [];
  for (const q of questions) {
    const answerBlob = [q.answer, ...(q.options || []).map((o) => o.text)].join(' ');
    if (T.hasNumericValue(answerBlob) && !q.source) {
      violations.push({ no: q.no, stem: q.stem, reason: '答案含具体数值但无资料出处' });
    }
    // 否定式判断题：改写前后数字序列必须一致（否则等于编造数值）
    if (q.negated && T.digitsOf(q.stem) !== T.digitsOf(q.answerText)) {
      violations.push({ no: q.no, stem: q.stem, reason: '否定式改写改动了数值' });
    }
  }
  if (violations.length) {
    // 不是「警告后照样输出」，而是直接剔除，绝不留在产出里
    for (const v of violations) warnings.push(`第 ${v.no} 题答案含数值但无出处，已剔除（禁止凭经验生成数值考题）`);
    for (let i = questions.length - 1; i >= 0; i--) {
      if (violations.some((v) => v.no === questions[i].no)) questions.splice(i, 1);
    }
    questions.forEach((q, i) => { q.no = i + 1; });
  }

  // ---------------- 五、实操考核项
  const practicalItems = AUD.practical.map((x, i) => ({ no: i + 1, item: x, audience: audKey }));

  // ---------------- 计数
  const byType = {};
  for (const t of T.QUESTION_TYPES) byType[t] = questions.filter((q) => q.type === t).length;
  const counts = {
    equipTypes: typeMap.size,
    equipment: [...typeMap.values()].reduce((n, v) => n + v.length, 0),
    outlineModules: outline.length,
    outlineTopics: outline.reduce((n, m) => n + m.topics.length, 0),
    keyPoints: keyPointsClean.length,
    keyPointsPrinciple: keyPointsClean.filter((k) => k.category === '通用原理').length,
    keyPointsInternal: keyPointsClean.filter((k) => k.category === '厂内规定').length,
    questions: questions.length,
    questionsWanted: wanted,
    questionsAvailable: available,
    questionsWithSource: questions.filter((q) => q.source).length,
    questionsNoSource: questions.filter((q) => !q.source).length,
    questionsNumeric: questions.filter((q) => q.kind === '数值类').length,
    questionsBuiltinPrinciple: questions.filter((q) => q.origin === 'builtin').length,
    questionsJudgeTrue: questions.filter((q) => q.type === '判断' && !q.negated).length,
    questionsJudgeNegated: questions.filter((q) => q.type === '判断' && q.negated).length,
    questionsByType: byType,
    clausesTotal: clauses.length,
    clausesUsable: usableClauses.length,
    clausesNumeric: numericClauses.length,
    clausesBlocked: blockedClauseCount,
    noSourceTopics: noSourceTopics.length,
    practicalItems: practicalItems.length,
    blockedTopics: blockedTopics.length,
  };

  // ---------------- 产出
  C.ensureDir(outDir);
  const result = {
    meta: {
      audience: audKey, audienceFocus: AUD.focus, scope: a.scope || null,
      workshop: a.workshop || null, duration, difficulty, types,
      docsProvided, docFiles, ledgerProvided: !!a.ledger,
      negativeJudge, principleSource: T.PRINCIPLE_SOURCE,
      generatedAt: C.localDateTime(), statement: T.STATEMENT,
    },
    counts, outline, keyPoints: keyPointsClean, questions, practicalItems,
    noSourceTopics,
    blockedTopics: blockedTopics.map((b) => ({ ruleId: b.ruleId, reason: b.reason, original: b.original, source: b.source || null })),
    forbiddenRules: T.FORBIDDEN_TOPICS.map(([id, , reason]) => ({ ruleId: id, reason })),
    warnings,
  };
  fs.writeFileSync(path.join(outDir, 'training.json'), JSON.stringify(result, null, 2), 'utf8');

  writeOutline(outDir, a, AUD, audKey, outline, duration, typeMap, counts, practicalItems, warnings);
  writeKeyPoints(outDir, a, AUD, audKey, keyPointsClean, docFiles, counts, noSourceTopics, warnings);
  writeQuestions(outDir, a, AUD, audKey, questions, counts, noSourceTopics, types, difficulty, warnings);

  C.emitOk(outDir, {
    ok: true, out: outDir, audience: audKey, difficulty, types, counts, warnings,
  });
}

/* ==================== 题干构造 ==================== */

/** 去掉条款号前缀 */
const stripClauseNo = (s) => String(s).replace(/^(?:第\s*)?\d+(?:\.\d+){0,3}\s*(?:条)?[、.．\s]\s*/, '').trim();

/**
 * 数值类题干：**把条款中的数值遮成「＿＿」做成填空题**，答案保留原文并带出处。
 * 题干里不能留着答案数值，否则不成其为题。
 */
function buildNumericStem(c) {
  const t = stripClauseNo(c.text).replace(/[。；;]$/, '');
  const masked = maskNumbers(t);
  const head = c.topicHint ? `${c.topicHint}：` : '';
  return `${head}按厂内规定，${masked}　请填出规定值。`;
}
/**
 * 遮蔽技术数值（保留条款号、年份已在上一步剥离）：
 *   1. 带单位或周期词的数；2. 区间两端（0.05~0.10 mm、0.05-0.10mm 两端都遮，不带单位的区间右端也遮）；
 *   3. 比较词后不带单位的数与分数（不低于 1/2、不高于 40）。
 * 负号：前面是比较词、空白、句首、标点或区间符时算数的一部分，连同负号一起遮（低于-10℃、-20~-5℃）。
 * 只有字母后的「-」按位号处理（P-2101A 不遮）；日期不当数值遮。
 */
const MASK_NUM = '\\d+(?:\\.\\d+)?(?:\\/\\d+(?:\\.\\d+)?)?';
const MASK_CMP = '(?:不?(?:低于|高于|大于|小于|超过|少于)|≥|≤|＞|＜|>|<)';
const MASK_SIGN = '[-−－]';
// 数的起点：① 负号（前为句首/空白/标点/区间符/比较词/「为」「在」）连同负号；② 不带负号：前不是数字、小数点、斜杠、字母，
// 也不是「字母-」（位号 P-2101A）或「数字-」（编号尾段 E-1201-3 次、M20-8.8级；真区间 3-5 天由左端 + 区间右端两步遮）
const MASK_LEAD = `(?:(?<=^|[\\s，,：:；;（(、~～—至为在]|${MASK_CMP})${MASK_SIGN}|(?<![\\d./A-Za-z])(?<![A-Za-z\\d]${MASK_SIGN}))`;
const MASK_UNIT = '(?:N·m|N\\.m|Nm|kN|MPa|kPa|Pa|bar|kgf|mm\\/s|μm|um|mm|cm|m3\\/h|m³\\/h|t\\/h|kg|℃|°C|°|K\\/h|kW|kV|V|A|Hz|rpm|r\\/min|ppm|mg\\/L|%|倍|级|小时|天|日|周|个?月|季度|年|圈|次|滴)';
const MASK_RANGE = '[~～\\-—至]';
function maskNumbers(s) {
  return String(s)
    .replace(new RegExp(`${MASK_LEAD}${MASK_NUM}(?=\\s*${MASK_UNIT})`, 'gi'), '＿＿')
    .replace(new RegExp(`${MASK_LEAD}${MASK_NUM}(?=\\s*${MASK_RANGE}\\s*${MASK_SIGN}?(?:\\d|＿))`, 'g'), '＿＿')
    // 区间右端（左端已遮的才算区间，避免把「E-1201-3」这类编号的尾段当区间）
    .replace(new RegExp(`(?<=＿＿\\s*${MASK_RANGE}\\s*)${MASK_SIGN}?${MASK_NUM}`, 'g'), '＿＿')
    .replace(new RegExp(`(${MASK_CMP}\\s*)${MASK_SIGN}?${MASK_NUM}`, 'g'), '$1＿＿');
}

/** 按可用题型分配：数值类不做多选（避免拼凑干扰项时编造数值） */
function assignType(q, preferred, types) {
  if (q.kind === '数值类') {
    // 数值类优先简答（答案直接引原文），其次判断
    if (types.includes('简答')) return '简答';
    if (types.includes('判断')) return '判断';
    if (types.includes('单选')) return '单选';
    return types[0];
  }
  return preferred;
}

/** 按题型把 {stem, answer} 实体化为选项/判断表述 */
function materialize(q, wantNeg = false, warnings = []) {
  if (q.type === '判断') {
    // 肯定式：题面直接取原文，答案「正确」。
    // 否定式：在原文上加否定词（不得→可以、应→无需…），**不改任何数值**，答案「错误」，答案表给出正确表述与出处；
    // 无可改写点、或改写后数字序列变化 → 退回肯定式。绝不通过改数值来构造错误项。
    const original = trimPeriod(q.answer);
    q.options = null;
    q.answerText = original;
    q.negated = false;
    if (wantNeg) {
      const neg = T.negateStatement(original);
      if (neg && T.digitsOf(neg.text) === T.digitsOf(original)) {
        q.stem = `（判断）${neg.text}。`;
        q.answer = '错误';
        q.negated = true;
        q.negateRule = neg.rule;
        q.answerNote = `否定式改写自原文（规则 ${neg.rule}，未改数值）；正确表述：${original}${q.source ? '，依据见出处' : '（通用原理）'}`;
        return;
      }
      if (neg) warnings.push(`第 ${q.no} 题否定式改写会改动数值，已退回肯定式`);
    }
    q.stem = `（判断）${original}。`;
    q.answer = '正确';
    q.answerNote = q.source ? '依据见出处条款原文' : '依据通用原理';
    return;
  }
  if (q.type === '简答') {
    q.stem = `（简答）${q.stem}`;
    q.options = null;
    return;
  }
  if (q.type === '单选' || q.type === '多选') {
    // 干扰项一律为定性表述，**绝不生成数值干扰项**（否则等于编造数值）
    const distractors = q.kind === '数值类'
      ? ['以现场经验判断即可，无需查规定', '由操作工自行确定', '参照其他装置的习惯做法']
      : ['与设备状态无关', '只在检修时才需要考虑', '由个人习惯决定'];
    const opts = [{ key: 'A', text: trimPeriod(q.answer), correct: true }]
      .concat(distractors.slice(0, q.type === '多选' ? 3 : 3).map((d, i) => ({ key: 'BCD'[i], text: d, correct: false })));
    q.options = opts;
    q.stem = `（${q.type}）${q.stem}`;
    q.answer = opts.filter((o) => o.correct).map((o) => o.key).join('');
    q.answerText = opts.filter((o) => o.correct).map((o) => o.text).join('；');
    return;
  }
}

const trimPeriod = (s) => String(s).replace(/[。；;]\s*$/, '');

/** 未指定题量时的默认题量：按学时推，无学时按素材量给一个克制的默认值 */
function defaultCount(AUD, duration) {
  if (duration !== null) return Math.max(5, Math.round(duration * 5));
  return 20;
}

/* ==================== md 产出 ==================== */

function head(L, title, a, audKey, AUD) {
  L.push(`# ${title}`);
  L.push('');
  L.push(`培训对象：**${audKey}**　｜　侧重：${AUD.focus}`);
  if (a.workshop) L.push(`车间：${a.workshop}`);
  if (a.scope) L.push(`设备范围 / 主题：${a.scope}`);
  L.push(`生成时间：${C.localDateTime()}（北京时间）`);
  L.push('');
  L.push('> 本材料为设备专业建议稿（车间设备员视角），交付车间设备主任审阅，由车间工艺/安全审核后纳入培训计划；厂级安全教育与技能鉴定由公司安全环保部门 / 人力资源部门归口。');
  L.push(`> ${T.STATEMENT}`);
  L.push('');
}

function tail(L, warnings) {
  L.push('---');
  L.push('');
  L.push(`> ${T.STATEMENT}`);
  L.push('');
  if (warnings.length) {
    L.push('## 附：生成提示');
    L.push('');
    for (const w of warnings) L.push(`- ${w}`);
    L.push('');
  }
}

function writeOutline(outDir, a, AUD, audKey, outline, duration, typeMap, counts, practicalItems, warnings) {
  const L = [];
  head(L, '培训提纲', a, audKey, AUD);
  L.push(`总学时：${duration === null ? '未指定（各模块按权重列出，学时待排）' : duration + ' 学时'}`);
  L.push('');
  L.push('## 一、培训目标');
  L.push('');
  L.push(`本次培训面向**${audKey}**，侧重「${AUD.focus}」。完成后应达到各模块的目标要求。`);
  L.push('');
  L.push('<!-- ANALYSIS_START -->');
  L.push('（此处由模型结合车间实际写 150~250 字：本次培训的背景、要解决的实际问题、与上期培训的衔接。只写资料与设备清单中写明的内容。）');
  L.push('<!-- ANALYSIS_END -->');
  L.push('');
  L.push('## 二、模块与学时分配');
  L.push('');
  L.push(C.mdTable(['序号', '模块', '目标', '权重', '建议学时'],
    outline.map((m) => [m.no, m.name, m.aim, m.weight, C.fmt(m.hours, 1)])));
  L.push('## 三、各模块内容');
  L.push('');
  for (const m of outline) {
    L.push(`### ${m.no}. ${m.name}（建议 ${C.fmt(m.hours, 1)} 学时）`);
    L.push('');
    L.push(`目标：${m.aim}`);
    L.push('');
    for (const t of m.topics) L.push(`- ${t}`);
    L.push('');
  }
  L.push('## 四、实操考核项');
  L.push('');
  for (const p of practicalItems) L.push(`${p.no}. ${p.item}`);
  L.push('');
  L.push('## 五、不在本提纲范围内的内容');
  L.push('');
  L.push('- 安全操作规程、开停车操作步骤、应急预案：**以厂内正式规程与预案为准，本材料不生成**。');
  for (const f of AUD.forbid) L.push(`- ${f}：不在「${audKey}」培训深度范围内。`);
  L.push('');
  tail(L, warnings);
  fs.writeFileSync(path.join(outDir, '培训提纲.md'), L.join('\n'), 'utf8');
}

function writeKeyPoints(outDir, a, AUD, audKey, keyPoints, docFiles, counts, noSourceTopics, warnings) {
  const L = [];
  head(L, '讲义要点', a, audKey, AUD);
  L.push('> **通用原理**与**厂内规定**分两节列。厂内规定逐条标注出处；通用原理不含任何厂内数值。');
  L.push('');
  L.push('## 一、资料来源');
  L.push('');
  if (docFiles.length) {
    L.push(C.mdTable(['资料文件', '抽取到的条目数'], docFiles.map((f) => [f.file, f.lines])));
  } else {
    L.push('未提供厂内资料（`--docs`）。**本讲义只含通用原理内容，不含任何厂内规定值。**');
    L.push('');
  }
  L.push('## 二、通用原理要点');
  L.push('');
  L.push('> 以下内容为**通用原理**，非厂内规定，不得作为现场执行依据。');
  L.push('');
  const pr = keyPoints.filter((k) => k.category === '通用原理');
  if (!pr.length) L.push('_无_\n');
  const byType = new Map();
  for (const k of pr) { if (!byType.has(k.equipType)) byType.set(k.equipType, []); byType.get(k.equipType).push(k); }
  for (const [t, list] of byType) {
    L.push(`### ${t}`);
    L.push('');
    for (const k of list) L.push(`- ${k.point}　*（通用原理${k.origin === 'builtin' ? '·内置条目 builtin，需技术人员审核' : ''}）*`);
    L.push('');
  }
  L.push('## 三、厂内规定要点');
  L.push('');
  const inner = keyPoints.filter((k) => k.category === '厂内规定');
  if (!inner.length) {
    L.push('**未提供厂内资料，本节为空。** 涉及力矩、间隙、限值、周期等具体数值的内容，须由车间提供正式规程后补充，**不得凭经验填写**。');
    L.push('');
  } else {
    L.push(C.mdTable(['编号', '要点', '含数值', '出处'],
      inner.map((k) => [k.clauseId, k.point, k.numeric ? '是' : '否', k.cite])));
  }
  L.push('## 四、无资料支撑的内容');
  L.push('');
  if (!noSourceTopics.length) L.push('_无_\n');
  else {
    L.push(C.mdTable(['主题', '原因', '处理方式'],
      noSourceTopics.map((n) => [n.topic, n.reason, n.handled])));
  }
  L.push('## 五、讲解提示');
  L.push('');
  L.push('<!-- ANALYSIS_START -->');
  L.push('（此处由模型写 200~300 字讲解提示：结合本车间设备与历史异常，说明每个模块的讲解侧重与常见误区。涉及数值一律引用上表出处，**不得自行给出数值**。）');
  L.push('<!-- ANALYSIS_END -->');
  L.push('');
  tail(L, warnings);
  fs.writeFileSync(path.join(outDir, '讲义要点.md'), L.join('\n'), 'utf8');
}

function writeQuestions(outDir, a, AUD, audKey, questions, counts, noSourceTopics, types, difficulty, warnings) {
  const L = [];
  head(L, '考题与答案', a, audKey, AUD);
  L.push(`题型：${types.join('、')}　｜　难度基准：${difficulty}　｜　共 ${questions.length} 题`);
  L.push('');
  L.push('> **数值类题目的答案全部来自所提供资料并标注出处；无出处的一律为原理概念题。** 判断题分肯定式（答案「正确」）与否定式（原句加否定词、未改任何数值，答案「错误」，答案表给出正确表述）。');
  L.push('');
  L.push('## 一、题量构成');
  L.push('');
  L.push(C.mdTable(['口径', '数量'], [
    ['合计', counts.questions],
    ['其中：有资料出处', counts.questionsWithSource],
    ['其中：通用原理（无出处，均为概念题）', counts.questionsNoSource],
    ['其中：数值类（必须有出处）', counts.questionsNumeric],
    ['其中：内置通用原理条目（builtin，需技术人员审核）', counts.questionsBuiltinPrinciple],
    ['其中：判断题肯定式 / 否定式', `${counts.questionsJudgeTrue} / ${counts.questionsJudgeNegated}`],
    ['要求题量', counts.questionsWanted === null ? '未指定' : counts.questionsWanted],
    ['素材可支撑的最大题量', counts.questionsAvailable],
  ]));
  if (counts.questionsWanted !== null && counts.questionsWanted > counts.questionsAvailable) {
    L.push(`> 【注意】要求 ${counts.questionsWanted} 题，现有资料与原理库只能支撑 ${counts.questionsAvailable} 题。**未用编造的数值题凑数**，缺口请补充厂内资料后重新生成。`);
    L.push('');
  }
  L.push('## 二、考题');
  L.push('');
  if (!questions.length) L.push('_无可用素材，未生成考题_\n');
  for (const q of questions) {
    L.push(`**${q.no}.** ${q.stem}`);
    L.push('');
    if (q.options) { for (const o of q.options) L.push(`　${o.key}. ${o.text}`); L.push(''); }
  }
  L.push('## 三、答案与出处');
  L.push('');
  L.push(C.mdTable(['题号', '题型', '类别', '答案', '出处 / 依据'],
    questions.map((q) => [q.no, q.type, q.kind,
      q.options ? `${q.answer}（${q.answerText}）` : (q.type === '判断' && q.negated ? `${q.answer}（正确表述：${q.answerText}）` : trimPeriod(q.answer)),
      q.origin === 'builtin' ? `${q.cite}；内置条目 builtin，需技术人员审核` : q.cite])));
  L.push('## 四、无资料支撑、未出数值题的主题');
  L.push('');
  if (!noSourceTopics.length) L.push('_无_\n');
  else {
    L.push(C.mdTable(['主题', '原因', '处理方式'],
      noSourceTopics.map((n) => [n.topic, n.reason, n.handled])));
    L.push('> 上述主题**未生成任何带数值的考题**。需要考这些内容时，请提供厂内正式规程后重新生成。');
    L.push('');
  }
  L.push('## 五、审核提示');
  L.push('');
  L.push('<!-- ANALYSIS_START -->');
  L.push('（此处由模型写 150~250 字：提醒审核人重点核对哪几题的出处、哪些题需要按本车间实际调整措辞。**不得补充任何无出处的数值。**）');
  L.push('<!-- ANALYSIS_END -->');
  L.push('');
  tail(L, warnings);
  fs.writeFileSync(path.join(outDir, '考题与答案.md'), L.join('\n'), 'utf8');
}

try { main(); } catch (e) { C.fail(e, warnings); }
