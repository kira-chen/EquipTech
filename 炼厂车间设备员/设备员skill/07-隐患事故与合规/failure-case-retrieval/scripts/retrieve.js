#!/usr/bin/env node
'use strict';
/**
 * 故障案例检索脚本（仅 Node.js 内置模块）
 * 用法：node "<技能目录>/scripts/retrieve.js" --cases <案例库 xlsx|docx|md|CSV目录> --symptom "<现象描述>" --equip-type "<设备类型>" [--out <dir>]
 *       [--part <故障部位>] [--model <型号>] [--fault-code <SAP 损坏/原因代码>]
 *       [--top <条数,默认5>] [--min-score <相似度下限,默认0.3>] [--weights "text=0.55,type=0.30,part=0.15"] [--all-fields]
 * 产出：<out>/cases.json、<out>/cases.md、<out>/summary.json；末行打印 JSON 摘要
 *       默认输出目录为 <os.tmpdir()>/fcr-out，建议始终传 --out
 *
 * 案例库形态：xlsx / 同结构 CSV 目录 / docx（Word 表格，表头识别同 xlsx）/ md（管道表格）。
 *   PDF 不读：先用平台 pdf 技能转为 txt/docx 再传入；扫描件需 OCR。
 *
 * 硬约束：
 *  1. 无案例库 / 案例库无有效案例 → ok:false + exit 1，绝不降级为通用知识问答；
 *  2. 命中为空 → matches 为空数组并明确写「案例库中未检索到类似案例」，绝不降低标准补位；
 *  3. 相似度低于 --min-score 的结果只进 lowSimilarity 并标注「相似度较低，仅供参考」；
 *  4. 每条案例都带 matchBasis（匹配依据）与 differences（不同点）；
 *  5. 声明行原样写入 cases.md。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readXlsx, readCsvDir } = require('./lib/xlsx-lite');
const lite = require('./lib/docx-lite');
const C = require('./lib/common');

const warnings = [];
const VALUE_OPTS = ['cases', 'symptom', 'equip-type', 'part', 'model', 'fault-code', 'top', 'min-score', 'weights', 'out'];
const FLAG_OPTS = ['all-fields', 'help'];

/** 声明行：必须原样出现在 cases.md 中，不得删改 */
const DISCLAIMER = '案例中的原因是当时该案例的结论，不代表当前故障的原因；是否适用须结合当前设备实际情况判断。';
/** 通用声明行（《中石化口径对照》第九节） */
const DISCLAIMER_GENERAL = '本材料由脚本汇总、模型成文，仅供设备员复核参考，不替代审批、定性、验收与签字；厂内制度与系统数据为准。';
/** 命中为空时的固定表述 */
const EMPTY_TEXT = '案例库中未检索到类似案例。';
/** 低相似度标注 */
const LOW_TEXT = '相似度较低，仅供参考';

// 别名：局部优先，再并入共享 SYSTEM_ALIASES（SAP PM 通知单/工单、EM、特种设备台账导出列名）。
// 「设备编号」不再作为位号别名——SAP 设备编号是 8 位流水号；单独成列，两者都可命中但分别展示。
const ALIASES = C.mergeAliases({
  '案例编号': ['案例编号', '编号', '案例号', '序号', '案例ID', 'ID', '通知单号', '通知单', '通知单编号', '维修通知单号', '工单号', '订单号', '订单'],
  '现象描述': ['现象描述', '故障现象', '现象', '问题描述', '故障描述', '描述', '通知单描述', '短文本', '长文本', '事件描述'],
  '设备类型': ['设备类型', '设备类别', '类型', '设备种类', '对象类型', '设备品种', '专业类别'],
  '设备名称': ['设备名称', '名称', '设备描述', '技术对象描述', '功能位置描述'],
  '位号': ['位号', '设备位号', '功能位置', 'TAG', 'tag'],
  '设备编号': ['设备编号', '设备', '设备号', '设备编码', '技术对象编号', 'EM编码'],
  '型号': ['型号', '规格型号', '规格', '设备型号', '型号编号'],
  '故障部位': ['故障部位', '部位', '失效部位', '损坏部位', '对象部件', '故障部件'],
  '故障代码': ['故障代码', '损坏代码', '损坏', '故障现象代码', '原因代码', '代码'],
  '原因': ['原因', '故障原因', '原因分析', '失效原因', '当时判定原因', '原因文本', '原因说明'],
  '处置方式': ['处置方式', '处理方式', '处置措施', '处理措施', '措施', '处置', '处理过程', '维修措施'],
  '效果': ['效果', '处置效果', '处理效果', '验证效果', '结果', '验收结果'],
  '发生时间': ['发生时间', '发生日期', '日期', '时间', '通知日期', '报告日期', '故障日期', '故障开始'],
  '工况': ['工况', '发生工况', '运行工况', '当时工况'],
  '来源': ['来源', '案例来源', '出处', '资料来源'],
  '装置': ['装置', '所属装置', '车间', '单位', '工厂区段', '装置名称'],
});

const CASE_SHEETS = ['故障案例', '案例库', '案例', '历史故障', '故障记录', '事故案例', '通知单', 'IW28', 'IW29', 'IW39', '设备故障'];

// ---------------------------------------------------------------- 案例库读取（xlsx / CSV 目录 / docx / md）
/** 判断一张二维表是否像案例表：前 3 行中有一行能命中「现象描述」列 */
function isCaseTable(rows) {
  const norm = (r) => (r || []).map((c) => C.str(c).replace(/\s+/g, ''));
  for (let i = 0; i < Math.min(3, rows.length); i++) if (C.findCol(norm(rows[i]), '现象描述', ALIASES) >= 0) return i;
  return -1;
}
/** 多张表合并：第一张保留表头，其余跳过各自表头行 */
function mergeTables(tables, label) {
  const out = [];
  let hdr = null;
  for (const t of tables) {
    const h = isCaseTable(t);
    if (h < 0) continue;
    if (!hdr) { hdr = t[h]; out.push(...t.slice(h)); }
    else {
      out.push(...t.slice(h + 1));
      warnings.push(`${label}：多张案例表已按行合并（表头以第一张为准）`);
    }
  }
  return out;
}
/** docx：取 Word 表格；合并单元格占位「‹›」与纵向续行「〃」按空处理 */
function loadDocx(p) {
  const res = lite.docxToText(fs.readFileSync(p));
  const tables = res.blocks.filter((b) => b.kind === 'table')
    .map((b) => b.rows.map((r) => r.map((c) => String(c).replace(/[‹›〃]/g, '').trim())));
  if (!tables.length) throw new Error(`docx 中没有表格：${path.basename(p)}。案例库 Word 文件须以表格存放案例（一行一案例、首行列名）`);
  const rows = mergeTables(tables, path.basename(p));
  if (!rows.length) throw new Error(`docx 中 ${tables.length} 张表格均无「现象描述」列（可识别写法：${ALIASES['现象描述'].join('、')}）：${path.basename(p)}`);
  return { '故障案例(docx)': rows };
}
/** md / txt：解析管道表格（| a | b |），分隔行跳过 */
function loadMdTables(p) {
  const text = fs.readFileSync(p, 'utf8');
  const tables = [];
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (/^\|.*\|$/.test(t)) {
      if (/^\|\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|$/.test(t)) continue;
      const cells = t.slice(1, -1).split('|').map((c) => c.trim().replace(/\\\|/g, '|'));
      if (!cur) { cur = []; tables.push(cur); }
      cur.push(cells);
    } else cur = null;
  }
  if (!tables.length) throw new Error(`md/txt 中没有管道表格（| 列 | 列 |）：${path.basename(p)}`);
  const rows = mergeTables(tables, path.basename(p));
  if (!rows.length) throw new Error(`md/txt 中 ${tables.length} 张表格均无「现象描述」列：${path.basename(p)}`);
  return { '故障案例(md)': rows };
}
function loadBook(p) {
  if (fs.statSync(p).isDirectory()) return readCsvDir(p);
  const ext = path.extname(p).toLowerCase();
  if (ext === '.pdf') throw new Error('脚本不读 PDF：请先用平台 pdf 技能把案例汇编转为 txt/docx（扫描件需 OCR），整理成表格后再传入');
  if (ext === '.docx') return loadDocx(p);
  if (ext === '.md' || ext === '.txt') return loadMdTables(p);
  return readXlsx(p);
}

// ---------------------------------------------------------------- 文本归一与相似
/** 去空白与标点，统一大小写；用于 bigram 切分 */
function cleanText(v) {
  return C.str(v).replace(/[\s,，。、；;：:（）()【】\[\]"'"'`~!！?？\-—_/\\|]+/g, '').toLowerCase();
}
/** bigram Dice 系数；不足 2 字时退化为整串相等 */
function textSim(a, b) {
  const ta = cleanText(a), tb = cleanText(b);
  if (!ta || !tb) return 0;
  if (ta.length < 2 || tb.length < 2) return ta === tb ? 1 : 0;
  const g = (t) => { const s = new Set(); for (let i = 0; i < t.length - 1; i++) s.add(t.slice(i, i + 2)); return s; };
  const A = g(ta), B = g(tb);
  let inter = 0; for (const x of A) if (B.has(x)) inter++;
  return (2 * inter) / (A.size + B.size);
}

/**
 * 设备类型归一：同义写法归到同一名下，未命中原样返回。
 * 顺序有讲究：细分机型（离心/往复/螺杆压缩机、汽轮机、挤压造粒机）排在泛类（压缩机、机）之前。
 * 「离心压缩机」「往复压缩机」「螺杆压缩机」刻意分开——机型不同，故障机理与处置方式不可互通。
 */
const TYPE_GROUPS = [
  ['离心泵', /离心泵|输送泵|给料泵|进料泵|回流泵|渣油泵|水泵|centrifugalpump/],
  ['往复泵', /往复泵|柱塞泵|计量泵|隔膜泵/],
  ['螺杆泵', /螺杆泵/],
  ['泵', /^泵$|机泵|^pump$/],
  ['挤压造粒机', /挤压造粒机|造粒机|挤压机|切粒机/],
  ['汽轮机', /汽轮机|蒸汽透平|透平机|^透平$|turbine/],
  ['螺杆压缩机', /螺杆压缩机|螺杆机|螺杆式压缩机/],
  ['离心压缩机', /离心压缩机|离心式压缩机|离心压缩机组|离心式压缩机组|气压机|富气压缩机|循环氢压缩机|裂解气压缩机|丙烯压缩机|乙烯压缩机/],
  ['往复压缩机', /往复压缩机|往复式压缩机|往复机|活塞压缩机|氢压机|新氢压缩机/],
  ['压缩机', /^压缩机$|压缩机组|compressor/],
  ['换热器', /换热器|冷却器|冷凝器|再沸器|加热器|管壳|exchanger/],
  ['阀门', /阀门|调节阀|闸阀|球阀|截止阀|安全阀|止回阀|^阀$|valve/],
  ['风机', /风机|鼓风机|引风机|空冷|fan$|blower/],
  ['塔器', /塔器|分馏塔|常压塔|减压塔|^塔$/],
  ['容器', /容器|储罐|缓冲罐|分液罐|^罐$/],
  ['加热炉', /加热炉|炉子|^炉$/],
  ['电机', /电机|电动机|马达|motor/],
];
function normType(v) {
  const t = cleanText(v);
  if (!t) return null;
  for (const [name, re] of TYPE_GROUPS) if (re.test(t)) return name;
  return t;
}

/** 故障部位归一（与 repeat-failure-detector 同口径） */
const PART_GROUPS = [
  ['机械密封', /机封|机械密封|密封面|动环|静环|干气密封/],
  ['填料密封', /填料|盘根/],
  ['轴承', /轴承|轴瓦|止推|推力瓦/],
  ['联轴器', /联轴器|对轮|膜片/],
  ['叶轮', /叶轮|转子|叶片|导叶/],
  ['轴', /^轴$|主轴|轴弯|轴断/],
  ['润滑系统', /润滑|油站|油路|油泵|油箱|油冷/],
  ['冷却系统', /冷却水|冷却器|夹套|水套/],
  ['管束', /管束|列管|换热管|管板/],
  ['阀芯阀座', /阀芯|阀座|阀瓣|阀杆|密封副|气阀|阀片/],
  ['执行机构', /执行机构|气动头|定位器|手轮/],
  ['电气部分', /电机|绕组|接线|电缆|电气|变频/],
  ['筒体壳体', /筒体|壳体|外壳|封头|简体/],
  ['仪表元件', /变送器|热电偶|压力表|传感器|探头|仪表/],
  ['基础地脚', /基础|地脚|底座|台板/],
];
function normPart(v) {
  const t = cleanText(v);
  if (!t) return null;
  for (const [name, re] of PART_GROUPS) if (re.test(t)) return name;
  return t;
}

/** 型号归一：去掉分隔符与大小写差异 */
function normModel(v) {
  const t = C.str(v).replace(/[\s\-_/]+/g, '').toUpperCase();
  return t || null;
}
/** 故障代码归一（SAP 损坏/原因代码）：去空白与分隔符，大写 */
function normCode(v) {
  const t = C.str(v).replace(/[\s\-_/.]+/g, '').toUpperCase();
  return t || null;
}

/**
 * 相似度权重（详见 references/retrieval-rules.md，改动须同步该文件）
 *   默认：相似度 = 0.55 × 现象文本 bigram Dice + 0.30 × 设备类型是否匹配 + 0.15 × 故障部位是否匹配
 *   --weights "text=..,type=..,part=.." 可调；三项之和须为 1，缺省项取默认。
 * 未提供 --part 时，部位项不参与计算，权重按剩余项归一化重新分配。
 * 型号匹配不计入相似度，仅作为 matchBasis 的加注与同分排序的次序依据。
 * 故障代码（SAP 损坏/原因代码）不计入相似度：给了 --fault-code 且代码相同的案例，排序优先于文本相似度。
 */
const DEFAULT_W = { text: 0.55, type: 0.30, part: 0.15 };
function parseWeights(v) {
  if (v === undefined) return { w: Object.assign({}, DEFAULT_W), custom: false };
  const w = Object.assign({}, DEFAULT_W);
  const seen = new Set();
  for (const seg of String(v).split(/[,，;；]/).map((x) => x.trim()).filter(Boolean)) {
    const m = seg.match(/^(text|type|part)\s*[=:：]\s*([0-9.]+)$/i);
    if (!m) throw new Error(`--weights 片段「${seg}」格式错误，应为 text=0.55,type=0.30,part=0.15（键只能是 text/type/part）`);
    const k = m[1].toLowerCase(), n = Number(m[2]);
    if (seen.has(k)) throw new Error(`--weights 中「${k}」重复`);
    if (!Number.isFinite(n) || n < 0 || n > 1) throw new Error(`--weights 中「${k}」取值「${m[2]}」应在 0~1 之间`);
    seen.add(k); w[k] = n;
  }
  const sum = w.text + w.type + w.part;
  if (Math.abs(sum - 1) > 0.001) throw new Error(`--weights 三项之和应为 1（当前 text=${w.text} type=${w.type} part=${w.part}，和为 ${C.round(sum, 3)}）`);
  if (w.text <= 0) throw new Error('--weights 中 text（现象文本）权重必须大于 0，否则检索退化为按设备类型分组');
  return { w, custom: true };
}

function scoreCase(q, c, W) {
  const t = textSim(q.symptom, c.symptom);
  const qType = normType(q.equipType), cType = normType(c.equipType);
  const typeHit = qType !== null && cType !== null && qType === cType;
  const qPart = q.part ? normPart(q.part) : null;
  const cPart = normPart(c.part);
  const partUsed = qPart !== null;
  const partHit = partUsed && cPart !== null && qPart === cPart;

  let score;
  if (partUsed) {
    score = W.text * t + W.type * (typeHit ? 1 : 0) + W.part * (partHit ? 1 : 0);
  } else {
    const denom = W.text + W.type;
    score = (W.text / denom) * t + (W.type / denom) * (typeHit ? 1 : 0);
  }

  const qModel = q.model ? normModel(q.model) : null;
  const cModel = normModel(c.model);
  const modelHit = qModel !== null && cModel !== null && qModel === cModel;
  const qCode = q.faultCode ? normCode(q.faultCode) : null;
  const cCode = normCode(c.code);
  const codeHit = qCode !== null && cCode !== null && qCode === cCode;

  // ---- 匹配依据：说明哪些特征相似
  const matchBasis = [];
  matchBasis.push(`现象文本 bigram 相似度 ${t.toFixed(2)}`);
  if (typeHit) matchBasis.push(`设备类型同为「${qType}」`);
  if (partUsed && partHit) matchBasis.push(`故障部位同为「${qPart}」`);
  if (modelHit) matchBasis.push(`型号同为「${C.str(c.model)}」`);
  if (codeHit) matchBasis.push(`故障代码同为「${C.str(c.code)}」（SAP 损坏/原因代码，排序优先于文本相似度）`);

  // ---- 不同点：说明哪些条件不同，交付时必须一并呈现
  const differences = [];
  if (!typeHit) {
    if (qType === null || cType === null) differences.push('设备类型字段有缺失，未参与比对');
    else differences.push(`设备类型不同（当前 ${qType} / 案例 ${cType}）`);
  }
  if (!partUsed) differences.push('未提供当前故障部位，部位维度未参与比对');
  else if (!partHit) {
    if (cPart === null) differences.push('案例未填故障部位，部位维度未参与比对');
    else differences.push(`故障部位不同（当前 ${qPart} / 案例 ${cPart}）`);
  }
  if (!modelHit) {
    if (qModel === null) differences.push('未提供当前设备型号，型号未比对');
    else if (cModel === null) differences.push('案例未填型号，型号未比对');
    else differences.push(`型号不同（当前 ${C.str(q.model)} / 案例 ${C.str(c.model)}）`);
  }
  if (qCode !== null && !codeHit) {
    if (cCode === null) differences.push('案例未填故障代码，代码未比对');
    else differences.push(`故障代码不同（当前 ${C.str(q.faultCode)} / 案例 ${C.str(c.code)}）`);
  }
  if (!C.str(c.condition)) differences.push('案例未记录发生工况，工况差异无法判断');
  if (t < 0.3) differences.push('现象描述用词重合度低，文本相似主要不成立');

  return { score: C.round(score, 3), textScore: C.round(t, 3), typeHit, partHit, partUsed, modelHit, codeHit, matchBasis, differences };
}

// ---------------------------------------------------------------- 主流程
function main() {
  const a = C.parseArgs(process.argv.slice(2), VALUE_OPTS, FLAG_OPTS);
  if (a.help) { console.log(JSON.stringify({ ok: true, usage: 'node scripts/retrieve.js --cases <案例库> --symptom <现象> --equip-type <设备类型> [--part] [--model] [--fault-code] [--top 5] [--min-score 0.3] [--weights text=0.55,type=0.30,part=0.15] [--out <dir>]' })); return; }

  // 硬约束 1：无案例库本技能不可用
  if (!a.cases) throw new Error('缺少 --cases（案例库路径）。无案例库时本技能不可用，请向用户说明并终止，不得用通用知识列举案例；无案例库的原理问题请改用 equipment-knowledge-qa');
  if (!fs.existsSync(a.cases)) throw new Error(`案例库不存在: ${a.cases}。无案例库时本技能不可用，不得用通用知识替代`);
  if (!a.symptom) throw new Error('缺少 --symptom（当前故障现象描述）');
  if (!a['equip-type']) throw new Error('缺少 --equip-type（设备类型）');
  if (cleanText(a.symptom).length < 2) throw new Error(`--symptom 「${a.symptom}」过短，不足以检索；请补充关键特征（声音、温度、振动方向、发生时机）`);

  const top = a.top === undefined ? 5 : Number(a.top);
  if (!Number.isFinite(top) || top <= 0 || !Number.isInteger(top)) throw new Error(`--top 「${a.top}」应为正整数`);
  const minScore = a['min-score'] === undefined ? 0.3 : Number(a['min-score']);
  if (!Number.isFinite(minScore) || minScore < 0 || minScore > 1) throw new Error(`--min-score 「${a['min-score']}」应为 0~1 之间的数`);
  const { w: W, custom: customWeights } = parseWeights(a.weights);

  const outDir = a.out || path.join(os.tmpdir(), 'fcr-out');

  // ---- 读取案例库
  let book;
  try { book = loadBook(a.cases); } catch (e) { throw new Error(`案例库读取失败 ${a.cases}: ${e.message}。无可用案例库时本技能不可用`); }
  const rows = C.pickSheet(book, ...CASE_SHEETS);
  const sheetName = Object.keys(book).find((k) => book[k] === rows) || '故障案例';
  if (!rows) throw new Error(`案例库中未找到「故障案例」「案例库」「历史故障」「通知单」等工作表（实际工作表：${Object.keys(book).join('、') || '空'}）。无可用案例库时本技能不可用，不得凭通用知识作答`);

  const recs = C.toRecords(rows, ['现象描述'], sheetName,
    ['案例编号', '设备类型', '设备名称', '位号', '设备编号', '型号', '故障部位', '故障代码', '原因', '处置方式', '效果', '发生时间', '工况', '来源', '装置'],
    warnings, ALIASES);

  const cases = [];
  let skippedNoSymptom = 0;
  for (const r of recs) {
    const symptom = C.str(r['现象描述']);
    if (!symptom) {
      skippedNoSymptom++;
      warnings.push(`工作表「${r._sheet}」第${r._row}行 现象描述为空，无法参与相似度检索，已跳过`);
      continue;
    }
    const time = r['发生时间'] ? C.normDate(r['发生时间']) : null;
    if (r['发生时间'] && !time) warnings.push(`工作表「${r._sheet}」第${r._row}行 发生时间「${C.str(r['发生时间'])}」无法解析，显示为 —`);
    cases.push({
      id: C.str(r['案例编号']) || `行${r._row}`,
      symptom,
      equipType: C.str(r['设备类型']),
      equipName: C.str(r['设备名称']),
      tag: C.str(r['位号']),
      equipNo: C.str(r['设备编号']),
      model: C.str(r['型号']),
      part: C.str(r['故障部位']),
      code: C.str(r['故障代码']),
      cause: C.str(r['原因']),
      action: C.str(r['处置方式']),
      effect: C.str(r['效果']),
      time,
      condition: C.str(r['工况']),
      source: C.str(r['来源']),
      plant: C.str(r['装置']),
      row: r._row, sheet: r._sheet,
    });
  }

  // 硬约束 1（续）：案例库有表但无任何可检索案例 → 不可用
  if (!cases.length) {
    throw new Error(`案例库中没有任何含现象描述的可检索案例（共读到 ${recs.length} 行，跳过 ${skippedNoSymptom} 行）。本技能不可用，请向用户说明并终止，不得用通用知识替代案例`);
  }

  // 缺列提示：不中断，但必须告知
  for (const [col, hint] of [['设备类型', '设备类型维度不参与匹配'], ['故障部位', '故障部位维度不参与匹配'],
    ['处置方式', '案例无处置经验可参考'], ['原因', '案例无当时结论可参考'], ['来源', '案例无出处，交付时须说明来源不可核实']]) {
    if (!recs.hasCol(col)) warnings.push(`案例库缺少列「${col}」，${hint}`);
  }
  if (a['fault-code'] && !recs.hasCol('故障代码')) warnings.push('给了 --fault-code 但案例库无「故障代码/损坏代码/原因代码」列，代码维度未比对');

  const query = { symptom: a.symptom, equipType: a['equip-type'], part: a.part || null, model: a.model || null, faultCode: a['fault-code'] || null };

  // ---- 打分排序：故障代码相同（SAP 目录代码）优先于文本相似度，其后按相似度、文本分、型号、编号
  const scored = cases.map((c) => Object.assign({}, c, scoreCase(query, c, W)));
  scored.sort((x, y) => ((y.codeHit ? 1 : 0) - (x.codeHit ? 1 : 0)) || (y.score - x.score) || (y.textScore - x.textScore) || ((y.modelHit ? 1 : 0) - (x.modelHit ? 1 : 0)) || String(x.id).localeCompare(String(y.id), 'zh'));

  // 硬约束 2/3：低于下限的一律进 lowSimilarity，绝不补位进 matches
  const above = scored.filter((x) => x.score >= minScore);
  const below = scored.filter((x) => x.score < minScore);
  const matches = above.slice(0, top);
  const lowSimilarity = below.slice(0, top).map((x) => Object.assign({}, x, { note: LOW_TEXT }));

  const counts = {
    casesTotal: cases.length,
    casesSkipped: skippedNoSymptom,
    scored: scored.length,
    aboveMin: above.length,
    matches: matches.length,
    lowSimilarity: lowSimilarity.length,
    belowMinTotal: below.length,
    codeHits: scored.filter((x) => x.codeHit).length,
    topScore: scored.length ? Math.max(...scored.map((x) => x.score)) : null,
  };

  if (!matches.length) {
    warnings.push(`按相似度下限 ${minScore} 检索，命中为空：${EMPTY_TEXT}最高相似度仅 ${C.fmt(counts.topScore)}，不得降低标准返回不相关案例`);
  } else if (matches.every((m) => m.score < minScore + 0.1)) {
    warnings.push('命中案例相似度普遍贴近下限，参考价值有限，交付时须提示用户');
  }
  if (lowSimilarity.length) {
    warnings.push(`另有 ${below.length} 条案例相似度低于下限 ${minScore}，已单列并标注「${LOW_TEXT}」，不得作为主要参考呈现`);
  }
  if (customWeights) warnings.push(`本次使用了自定义权重 text=${W.text} type=${W.type} part=${W.part}（非默认口径），交付时须说明`);

  // ---- 产出 JSON
  C.ensureDir(outDir);
  const weights = query.part
    ? { text: W.text, type: W.type, part: W.part }
    : { text: C.round(W.text / (W.text + W.type), 3), type: C.round(W.type / (W.text + W.type), 3), part: 0 };
  const slim = (x) => ({
    id: x.id, caseNo: x.id, score: x.score, textScore: x.textScore,
    equipType: x.equipType || null, equipName: x.equipName || null, tag: x.tag || null, equipNo: x.equipNo || null,
    model: x.model || null, part: x.part || null, code: x.code || null,
    symptom: x.symptom, cause: x.cause || null, action: x.action || null, effect: x.effect || null,
    time: x.time, condition: x.condition || null, source: x.source || null, plant: x.plant || null,
    typeHit: x.typeHit, partHit: x.partHit, modelHit: x.modelHit, codeHit: x.codeHit,
    matchBasis: x.matchBasis, differences: x.differences,
    note: x.note || null,
    origin: `${x.sheet} 第${x.row}行`,
  });
  const result = {
    meta: {
      casesFile: path.resolve(a.cases),
      sheet: sheetName,
      casesFormat: fs.statSync(a.cases).isDirectory() ? 'csv-dir' : path.extname(a.cases).replace('.', '').toLowerCase(),
      query,
      top, minScore,
      weights, weightsCustom: customWeights, weightsBase: W,
      generatedAt: C.localDateTime(),
      disclaimer: DISCLAIMER,
      disclaimerGeneral: DISCLAIMER_GENERAL,
      emptyText: EMPTY_TEXT,
    },
    counts,
    matches: matches.map(slim),
    lowSimilarity: lowSimilarity.map(slim),
    warnings,
  };
  fs.writeFileSync(path.join(outDir, 'cases.json'), JSON.stringify(result, null, 2), 'utf8');

  // ---- 产出 md
  const L = [];
  L.push(`# 故障案例检索结果`);
  L.push('');
  L.push(`> **${DISCLAIMER}**`);
  L.push(`> ${DISCLAIMER_GENERAL}`);
  L.push('');
  L.push(`检索条件：现象「${a.symptom}」｜设备类型「${a['equip-type']}」${a.part ? `｜故障部位「${a.part}」` : ''}${a.model ? `｜型号「${a.model}」` : ''}${a['fault-code'] ? `｜故障代码「${a['fault-code']}」` : ''}`);
  L.push(`案例库：${path.basename(a.cases)}（工作表「${sheetName}」，可检索案例 ${counts.casesTotal} 条）｜相似度下限 ${minScore}｜返回上限 ${top} 条｜权重 现象 ${weights.text} / 类型 ${weights.type} / 部位 ${weights.part}${customWeights ? '（自定义）' : '（默认）'}`);
  L.push(`生成时间：${C.localDateTime()}（北京时间）`);
  L.push('');

  L.push('## 一、检索概览');
  L.push('');
  L.push(C.mdTable(['指标', '数量'], [
    ['案例库可检索案例', counts.casesTotal],
    ['现象为空已跳过', counts.casesSkipped],
    [`达到相似度下限（≥${minScore}）`, counts.aboveMin],
    ['本次返回命中', counts.matches],
    [`低于下限（单列，${LOW_TEXT}）`, counts.belowMinTotal],
    ['故障代码相同', a['fault-code'] ? counts.codeHits : '—（未给 --fault-code）'],
    ['最高相似度', C.fmt(counts.topScore)],
  ]));

  L.push('## 二、命中案例');
  L.push('');
  if (!matches.length) {
    L.push(`**${EMPTY_TEXT}**`);
    L.push('');
    L.push(`案例库共 ${counts.casesTotal} 条可检索案例，按相似度下限 ${minScore} 无一条达到标准（最高 ${C.fmt(counts.topScore)}）。**不降低标准返回不相关案例，也不以通用知识补充。** 建议补充现象关键特征（声音、温度、振动方向、发生时机）后重检，或确认案例库是否覆盖该设备类型。`);
    L.push('');
  } else {
    for (const m of matches) {
      L.push(`### ${m.id}　相似度 ${m.score.toFixed(2)}${m.codeHit ? '　【注意】故障代码相同' : ''}`);
      L.push('');
      L.push(C.mdTable(['项目', '内容'], [
        ['设备', [m.equipName, m.tag, m.model].filter(Boolean).join(' / ') || '—'],
        ['设备编号', m.equipNo || '—'],
        ['设备类型', m.equipType || '—'],
        ['故障部位', m.part || '—'],
        ['故障代码', m.code || '—'],
        ['发生时间', m.time || '—'],
        ['工况', m.condition || '—'],
        ['现象描述', m.symptom],
        ['当时判定原因', m.cause || '—'],
        ['处置方式', m.action || '—'],
        ['效果', m.effect || '—'],
        ['案例来源', m.source || '—（案例未注明出处）'],
        ['出处', `${m.sheet} 第${m.row}行`],
      ]));
      L.push(`**匹配依据**：${m.matchBasis.join('；')}`);
      L.push('');
      L.push(`**不同点**：${m.differences.length ? m.differences.join('；') : '所比对字段均一致，但工况与设备实际状态仍须自行核实'}`);
      L.push('');
    }
  }

  L.push('## 三、低相似度案例（仅供参考）');
  L.push('');
  if (!lowSimilarity.length) {
    L.push('_无_\n');
  } else {
    L.push(`以下案例相似度低于下限 ${minScore}，**${LOW_TEXT}，不得作为主要参考**：`);
    L.push('');
    L.push(C.mdTable(['案例编号', '相似度', '设备类型', '故障部位', '现象描述', '匹配依据', '不同点'],
      lowSimilarity.map((x) => [x.id, x.score.toFixed(2), x.equipType || '—', x.part || '—', x.symptom,
        x.matchBasis.join('；'), x.differences.join('；') || '—'])));
  }

  L.push('## 四、检索结果解读');
  L.push('');
  L.push('<!-- ANALYSIS_START -->');
  L.push('（由模型依据 references/retrieval-rules.md 口径撰写 200~400 字，结构：命中情况与相似度水平 → 逐条案例的可参考之处与不同点 → 与当前故障的关键差异 → 下一步建议。数字一律引用 cases.json，不得新增案例库以外的案例。）');
  L.push('<!-- ANALYSIS_END -->');
  L.push('');

  L.push('## 五、使用说明');
  L.push('');
  L.push(`- ${DISCLAIMER}`);
  L.push(`- ${DISCLAIMER_GENERAL}`);
  L.push('- 本结果是现象文本与设备类型、故障部位字段的机械匹配，不是失效机理分析。');
  L.push('- 当前故障的原因初判请接 `01-日常运行监控与巡检/anomaly-triage-advisor`，本技能不做原因判定。');
  L.push('- 同一台设备是否反复出同类故障，用 `02-缺陷报修与检修管理/repeat-failure-detector`；没有案例库的原理性问题，用 `08-知识与能力支持/equipment-knowledge-qa`。');
  L.push('- 案例仅来自所提供的案例库，未引用任何库外经验。');
  L.push('');

  if (warnings.length) {
    L.push('## 附：数据提示');
    L.push('');
    L.push('【注意】以下提示须逐条告知用户：');
    L.push('');
    for (const w of warnings) L.push(`- ${w}`);
    L.push('');
  }
  fs.writeFileSync(path.join(outDir, 'cases.md'), L.join('\n'), 'utf8');

  C.emitOk(outDir, { ok: true, out: outDir, query, minScore, top, weights, counts, warnings });
}

if (require.main === module) {
  try { main(); } catch (e) { C.fail(e, warnings); }
}
module.exports = { normType, normPart, normModel, normCode, textSim, parseWeights, scoreCase, TYPE_GROUPS, PART_GROUPS, DEFAULT_W, DISCLAIMER, DISCLAIMER_GENERAL, EMPTY_TEXT, LOW_TEXT, loadBook };
