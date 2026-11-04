#!/usr/bin/env node
'use strict';
/**
 * 设备能效分析与对标（单机口径，仅 Node.js 内置模块）
 * 用法：node scripts/energy.js --input <xlsx> --workshop "车间" --equip-type "离心泵" --from <YYYY-MM-DD> --to <YYYY-MM-DD> [--out <dir>]
 * 可选：--design <设计参数xlsx> --group <分组表xlsx> --price <单价表xlsx> --threshold <偏低判定比例>
 *       --polytropic：压缩机按多变效率口径（需 进口压力/出口压力/进口温度/出口温度/绝热指数，缺任一 → null 并列入数据不足，不估算）
 * 产出：<out>/energy.json、energy.md、能效对标表.xlsx、summary.json
 *
 * 硬约束：
 *   1. 计算所需参数不全 → 效率 null 并归入 insufficientData，绝不用典型值代替缺失参数
 *   2. 计算结果超出物理合理范围（效率 > 100% 或 ≤ 0）→ implausible 单列 + warning 提示核实数据，不截断
 *   3. 无设计参数 → 只做同类设备横向对比，不做与设计值的偏差分析，不引用通用典型效率值作为基准
 *   4. 能效偏低只提示需核实的方向，不断言原因（脚本不写原因字段，只给 checkPoints）
 *   5. 费用差额是基于当前运行条件的测算，不等于节能收益；报告保留声明行
 *   6. 本技能是单机能效口径，不算装置综合能耗、不算单位产品能耗（归能源管理部门/工艺）；装置综合能耗用 energy-weekly-report
 *   7. 电价：单一电价直接用；厂内执行分时电价（峰/平/谷）时须提供加权平均电价，脚本不自行取峰或谷
 */
const fs = require('fs');
const path = require('path');
const { readXlsx, readCsvDir, writeXlsx } = require('./lib/xlsx-lite');
const C = require('./lib/common');

const warnings = [];
const num = C.makeNum(warnings);
const VALUE_OPTS = ['input', 'workshop', 'equip-type', 'from', 'to', 'out', 'design', 'group', 'price', 'threshold'];
const FLAG_OPTS = ['help', 'polytropic'];

// 局部别名在前，再合并共享 SYSTEM_ALIASES（SAP PM / EM 导出列名：功能位置、设备描述、对象类型…）。
// 「设备编号」是 SAP 8 位流水号，不是位号，局部别名不再把它当位号；「设备」列同理不当设备名称。
const ALIASES = C.mergeAliases({
  '位号': ['设备位号', '位号', 'TAG'],
  '设备名称': ['设备名称', '名称'],
  '设备类型': ['设备类型', '类型', '设备类别', '机型', '对象类型', '设备分类'],
  '分组': ['分组', '对比组', '同类分组', '机组', '组别'],
  '流量': ['流量', '介质流量', '输送量', '处理量', '风量', '入口流量'],
  '扬程': ['扬程', '有效扬程', '泵扬程'],
  '全压': ['全压', '风机全压', '升压'],
  '轴功率': ['轴功率', '机械功率', '泵轴功率'],
  '电机功率': ['电机功率', '电功率', '有功功率', '耗电功率'],
  '电机效率': ['电机效率', '电动机效率'],
  '介质密度': ['介质密度', '密度', '流体密度'],
  '进口压力': ['进口压力', '入口压力', '吸入压力'],
  '出口压力': ['出口压力', '排出压力', '排气压力'],
  '进口温度': ['进口温度', '入口温度', '吸入温度'],
  '出口温度': ['出口温度', '排出温度', '排气温度'],
  '绝热指数': ['绝热指数', '等熵指数', '比热比', 'k值'],
  '输出功率': ['输出功率', '轴端输出功率', '机械输出功率'],
  '输入功率': ['输入功率', '电输入功率', '有功输入'],
  '燃料量': ['燃料量', '燃料消耗量', '燃料流量', '瓦斯量'],
  '低位发热值': ['低位发热值', '低热值', '燃料低位发热值', 'LHV'],
  '有效热负荷': ['有效热负荷', '热负荷', '有效热量', '工艺吸热量'],
  '换热量': ['换热量', '传热量', '换热负荷'],
  '换热面积': ['换热面积', '传热面积', '面积'],
  '对数平均温差': ['对数平均温差', '平均温差', 'LMTD', '对数温差'],
  '运行时间': ['运行时间', '运行小时', '累计运行时间', '运行时数'],
  '额定流量': ['额定流量', '设计流量'],
  '额定扬程': ['额定扬程', '设计扬程'],
  '额定功率': ['额定功率', '设计功率'],
  '设计效率': ['设计效率', '额定效率', '设计能效'],
  '单价': ['单价', '价格', '单位价格'],
  '能源介质': ['能源介质', '介质', '能源种类', '能源类型'],
  '介质单位': ['介质单位', '计价单位', '单位'],
  '时段': ['时段', '电价时段', '峰谷', '峰平谷', '时段类型'],
});

/** 设备类型归一化：把用户写法映射到内部类型键 */
const TYPE_KEYS = [
  { key: 'pump', label: '离心泵', words: ['离心泵', '泵', 'pump'] },
  { key: 'fan', label: '风机', words: ['风机', '鼓风机', '引风机', 'fan', '通风机'] },
  { key: 'compressor', label: '压缩机', words: ['压缩机', '空压机', 'compressor', '机组'] },
  { key: 'motor', label: '电机', words: ['电机', '电动机', 'motor'] },
  { key: 'furnace', label: '加热炉', words: ['加热炉', '炉', 'furnace', '锅炉'] },
  { key: 'exchanger', label: '换热器', words: ['换热器', '冷却器', '换热', 'exchanger'] },
];
function normType(v) {
  const s = C.str(v);
  if (!s) return null;
  const low = s.toLowerCase();
  // 长词优先，避免「空压机」被「泵」之外的短词误命中
  let best = null;
  for (const t of TYPE_KEYS) {
    for (const w of t.words) {
      if (low.includes(w.toLowerCase()) && (!best || w.length > best.len)) best = { key: t.key, label: t.label, len: w.length };
    }
  }
  return best ? { key: best.key, label: best.label } : null;
}
const TYPE_LABEL = TYPE_KEYS.reduce((o, t) => (o[t.key] = t.label, o), {});

/** 各设备类型的必需参数（缺任一 → insufficientData，绝不用典型值补） */
const REQUIRED = {
  pump: { formula: '有效功率 Pe = ρgQH/3600000 (kW)；效率 η = Pe / 轴功率', fields: ['流量', '扬程', '介质密度', '轴功率或（电机功率×电机效率）'] },
  fan: { formula: '有效功率 Pe = Q×p/3600000 (kW，Q m³/h、p Pa)；效率 η = Pe / 轴功率', fields: ['流量（风量）', '全压', '轴功率或（电机功率×电机效率）'] },
  compressor: { formula: '等温效率 η = Q×p1×ln(p2/p1)/3600000 / 轴功率（入口体积流量口径）', fields: ['流量', '进口压力', '出口压力', '轴功率或（电机功率×电机效率）'] },
  compressorPolytropic: { formula: '多变效率 η_p = [(k−1)/k] ÷ [(n−1)/n]，其中 (n−1)/n = ln(T2/T1) / ln(p2/p1)（T 取绝对温度，p 取绝压）', fields: ['进口压力', '出口压力', '进口温度', '出口温度', '绝热指数'] },
  motor: { formula: '效率 η = 输出功率 / 输入功率', fields: ['输出功率', '输入功率'] },
  furnace: { formula: '热效率 η = 有效热负荷 / （燃料量 × 低位发热值）', fields: ['有效热负荷', '燃料量', '低位发热值'] },
  exchanger: { formula: '传热系数 K = 换热量 / (换热面积 × 对数平均温差)', fields: ['换热量', '换热面积', '对数平均温差'] },
};

const G = 9.80665;
/** 效率的物理合理区间：(0, 1]；超出即 implausible，不截断 */
const EFF_MIN = 0, EFF_MAX = 1;
/** 能效偏低默认判定比例：低于基准（设计值或组内中位数）的该比例即偏低 */
const DEFAULT_THRESHOLD = 0.9;

function loadBook(p) { return fs.statSync(p).isDirectory() ? readCsvDir(p) : readXlsx(p); }

/** 轴功率：优先直接给的轴功率；否则电机功率 × 电机效率（电机效率缺失时不假设，返回 null） */
function shaftPower(r, missing) {
  if (r.轴功率 !== null) {
    if (r.轴功率 <= 0) { missing.push('轴功率应大于 0'); return null; }
    return { value: r.轴功率, source: '直接读取轴功率' };
  }
  if (r.电机功率 === null) { missing.push('轴功率与电机功率均缺失'); return null; }
  if (r.电机功率 <= 0) { missing.push('电机功率应大于 0'); return null; }
  if (r.电机效率 === null) { missing.push('仅有电机功率而无电机效率，无法折算轴功率（不按典型电机效率代替）'); return null; }
  const me = r.电机效率 > 1 ? r.电机效率 / 100 : r.电机效率;   // 支持 0.95 与 95 两种写法
  if (!(me > 0 && me <= 1)) { missing.push(`电机效率「${r.电机效率}」不在合理范围（0~1 或 0~100%）`); return null; }
  return { value: r.电机功率 * me, source: `电机功率 ${C.round(r.电机功率, 3)} kW × 电机效率 ${C.round(me, 4)}` };
}

/**
 * 按类型计算效率。
 * 返回 {efficiency（0~1 的小数，或 K 值时为 null）, metricName, metricValue, metricUnit, basis, missing[]}
 * missing 非空即参数不全，效率必须为 null。
 */
function calcEfficiency(typeKey, r, opts = {}) {
  const missing = [];
  const out = { efficiency: null, usefulPower: null, shaftPower: null, shaftSource: null, metricName: null, metricValue: null, metricUnit: null, basis: REQUIRED[typeKey].formula, missing };

  if (typeKey === 'compressor' && opts.polytropic) {
    // --polytropic：多变效率口径。缺任一参数 → 不估算（不按 k=1.4、不按等温口径顶替）
    out.basis = REQUIRED.compressorPolytropic.formula;
    for (const f of ['进口压力', '出口压力', '进口温度', '出口温度', '绝热指数']) if (r[f] === null) missing.push(f);
    if (missing.length) return out;
    if (r.进口压力 <= 0) { missing.push('进口压力应大于 0（绝压口径）'); return out; }
    if (r.出口压力 <= r.进口压力) { missing.push(`出口压力（${r.出口压力}）不大于进口压力（${r.进口压力}），压比无意义`); return out; }
    const T1 = r.进口温度 + 273.15, T2 = r.出口温度 + 273.15;
    if (T1 <= 0 || T2 <= T1) { missing.push(`出口温度（${r.出口温度}℃）不高于进口温度（${r.进口温度}℃），多变指数无法求取`); return out; }
    if (!(r.绝热指数 > 1)) { missing.push(`绝热指数「${r.绝热指数}」应大于 1`); return out; }
    const nTerm = Math.log(T2 / T1) / Math.log(r.出口压力 / r.进口压力);   // (n-1)/n
    const kTerm = (r.绝热指数 - 1) / r.绝热指数;                            // (k-1)/k
    out.efficiency = kTerm / nTerm;
    out.polytropicExponentTerm = C.round(nTerm, 4);
    out.metricName = '多变指数项(n−1)/n'; out.metricValue = C.round(nTerm, 4); out.metricUnit = '—';
    out.shaftSource = '多变效率由压力与温度求取，不依赖轴功率';
    return out;
  }

  if (typeKey === 'pump') {
    if (r.流量 === null) missing.push('流量');
    if (r.扬程 === null) missing.push('扬程');
    if (r.介质密度 === null) missing.push('介质密度');
    const sp = shaftPower(r, missing);
    if (missing.length || !sp) return out;
    const pe = (r.介质密度 * G * r.流量 * r.扬程) / 3600000;   // kW
    out.usefulPower = C.round(pe, 4); out.shaftPower = C.round(sp.value, 4); out.shaftSource = sp.source;
    out.efficiency = pe / sp.value;
    out.metricName = '有效功率'; out.metricValue = C.round(pe, 4); out.metricUnit = 'kW';
    return out;
  }
  if (typeKey === 'fan') {
    if (r.流量 === null) missing.push('风量');
    if (r.全压 === null) missing.push('全压');
    const sp = shaftPower(r, missing);
    if (missing.length || !sp) return out;
    const pe = (r.流量 * r.全压) / 3600000;   // m³/h × Pa → kW
    out.usefulPower = C.round(pe, 4); out.shaftPower = C.round(sp.value, 4); out.shaftSource = sp.source;
    out.efficiency = pe / sp.value;
    out.metricName = '有效功率'; out.metricValue = C.round(pe, 4); out.metricUnit = 'kW';
    return out;
  }
  if (typeKey === 'compressor') {
    if (r.流量 === null) missing.push('入口体积流量');
    if (r.进口压力 === null) missing.push('进口压力');
    if (r.出口压力 === null) missing.push('出口压力');
    const sp = shaftPower(r, missing);
    if (missing.length || !sp) return out;
    if (r.进口压力 <= 0) { missing.push('进口压力应大于 0（绝压口径）'); return out; }
    if (r.出口压力 <= r.进口压力) { missing.push(`出口压力（${r.出口压力}）不大于进口压力（${r.进口压力}），压比无意义`); return out; }
    // 等温功率：Pis = Q(m³/h) × p1(MPa→Pa) × ln(p2/p1) / 3600000 (kW)
    const pe = (r.流量 * r.进口压力 * 1e6 * Math.log(r.出口压力 / r.进口压力)) / 3600000;
    out.usefulPower = C.round(pe, 4); out.shaftPower = C.round(sp.value, 4); out.shaftSource = sp.source;
    out.efficiency = pe / sp.value;
    out.metricName = '等温功率'; out.metricValue = C.round(pe, 4); out.metricUnit = 'kW';
    return out;
  }
  if (typeKey === 'motor') {
    if (r.输出功率 === null) missing.push('输出功率');
    if (r.输入功率 === null) missing.push('输入功率');
    if (missing.length) return out;
    if (r.输入功率 <= 0) { missing.push('输入功率应大于 0'); return out; }
    out.usefulPower = C.round(r.输出功率, 4); out.shaftPower = C.round(r.输入功率, 4); out.shaftSource = '直接读取输入功率';
    out.efficiency = r.输出功率 / r.输入功率;
    out.metricName = '输出功率'; out.metricValue = C.round(r.输出功率, 4); out.metricUnit = 'kW';
    return out;
  }
  if (typeKey === 'furnace') {
    if (r.有效热负荷 === null) missing.push('有效热负荷');
    if (r.燃料量 === null) missing.push('燃料量');
    if (r.低位发热值 === null) missing.push('低位发热值');
    if (missing.length) return out;
    const heatIn = r.燃料量 * r.低位发热值;   // 单位随输入，口径见 references/input-spec.md
    if (heatIn <= 0) { missing.push('燃料总热量（燃料量 × 低位发热值）应大于 0'); return out; }
    out.usefulPower = C.round(r.有效热负荷, 4); out.shaftPower = C.round(heatIn, 4); out.shaftSource = `燃料量 ${C.round(r.燃料量, 3)} × 低位发热值 ${C.round(r.低位发热值, 3)}`;
    out.efficiency = r.有效热负荷 / heatIn;
    out.metricName = '燃料总热量'; out.metricValue = C.round(heatIn, 4); out.metricUnit = 'MJ/h（随输入口径）';
    return out;
  }
  if (typeKey === 'exchanger') {
    if (r.换热量 === null) missing.push('换热量');
    if (r.换热面积 === null) missing.push('换热面积');
    if (r.对数平均温差 === null) missing.push('对数平均温差');
    if (missing.length) return out;
    if (r.换热面积 <= 0) { missing.push('换热面积应大于 0'); return out; }
    if (r.对数平均温差 <= 0) { missing.push('对数平均温差应大于 0'); return out; }
    // 换热器不给「效率」，给传热系数 K；K 无 0~1 合理区间，不参与 implausible 的 0~100% 判定
    out.metricName = '传热系数K'; out.metricValue = C.round(r.换热量 / (r.换热面积 * r.对数平均温差), 4); out.metricUnit = 'kW/(m²·K)（随输入口径）';
    out.efficiency = null;
    out.kValue = out.metricValue;
    return out;
  }
  missing.push(`不支持的设备类型「${typeKey}」`);
  return out;
}

function median(arr) {
  if (!arr.length) return null;
  const s = arr.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function main() {
  const a = C.parseArgs(process.argv.slice(2), VALUE_OPTS, FLAG_OPTS);
  if (!a.input) throw new Error('缺少 --input');
  if (!fs.existsSync(a.input)) throw new Error(`输入不存在: ${a.input}`);
  if (!a.workshop) throw new Error('缺少 --workshop');
  if (!a['equip-type']) throw new Error('缺少 --equip-type（离心泵/风机/压缩机/电机/加热炉/换热器）');
  const defType = normType(a['equip-type']);
  if (!defType) throw new Error(`--equip-type 「${a['equip-type']}」无法识别，应为 离心泵/风机/压缩机/电机/加热炉/换热器 之一`);
  if (!a.from) throw new Error('缺少 --from');
  if (!a.to) throw new Error('缺少 --to');
  const from = C.normDate(a.from);
  if (!from) throw new Error(`--from 「${a.from}」不是有效日期，应为 YYYY-MM-DD`);
  const to = C.normDate(a.to);
  if (!to) throw new Error(`--to 「${a.to}」不是有效日期，应为 YYYY-MM-DD`);
  if (C.diffDays(to, from) < 0) throw new Error(`--from（${from}）晚于 --to（${to}）`);
  let threshold = DEFAULT_THRESHOLD;
  if (a.threshold !== undefined) {
    threshold = Number(a.threshold);
    if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) throw new Error(`--threshold 「${a.threshold}」应为 0~1 之间的比例（如 0.9 表示低于基准 90%）`);
  }
  if (a.design && !fs.existsSync(a.design)) throw new Error(`设计参数表不存在: ${a.design}`);
  if (a.group && !fs.existsSync(a.group)) throw new Error(`分组表不存在: ${a.group}`);
  if (a.price && !fs.existsSync(a.price)) throw new Error(`单价表不存在: ${a.price}`);
  const outDir = a.out || path.join(require('os').tmpdir(), 'eea-out');
  const polytropic = !!a.polytropic;

  const book = loadBook(a.input);

  // ---- 运行数据（唯一数据源，缺失即报错）
  const runSheet = C.pickSheet(book, '运行数据', '运行参数', '能效数据', '运行记录');
  if (!runSheet) throw new Error('未找到「运行数据」工作表');
  const OPT_COLS = ['设备名称', '设备类型', '分组', '流量', '扬程', '全压', '轴功率', '电机功率', '电机效率', '介质密度',
    '进口压力', '出口压力', '进口温度', '出口温度', '绝热指数', '输出功率', '输入功率',
    '燃料量', '低位发热值', '有效热负荷', '换热量', '换热面积', '对数平均温差', '运行时间'];
  const runs = C.toRecords(runSheet, ['位号'], '运行数据', OPT_COLS, warnings, ALIASES);

  // ---- 设计参数（可选；无设计参数时只做横向对比，不做偏差分析）
  const designMap = new Map();
  let designProvided = false;
  const dBook = a.design ? loadBook(a.design) : book;
  const dSheet = C.pickSheet(dBook, '设计参数', '铭牌参数', '设计值');
  if (dSheet) {
    designProvided = true;
    const drecs = C.toRecords(dSheet, ['位号'], '设计参数', ['设备名称', '额定流量', '额定扬程', '额定功率', '设计效率'], warnings, ALIASES);
    for (const r of drecs) {
      const tag = C.str(r['位号']);
      if (!tag) { warnings.push(`工作表「设计参数」第${r._row}行 位号为空，已跳过`); continue; }
      let de = num(r['设计效率'], { sheet: '设计参数', row: r._row, col: '设计效率' });
      if (de !== null && de > 1) de = de / 100;   // 支持 85 与 0.85 两种写法
      if (de !== null && (de <= 0 || de > 1)) {
        warnings.push(`工作表「设计参数」第${r._row}行 设备「${tag}」设计效率「${C.str(r['设计效率'])}」不在 0~100% 的合理范围，已按缺设计效率处理，请核实设计参数表`);
        de = null;
      }
      designMap.set(tag, {
        ratedFlow: num(r['额定流量'], { sheet: '设计参数', row: r._row, col: '额定流量' }),
        ratedHead: num(r['额定扬程'], { sheet: '设计参数', row: r._row, col: '额定扬程' }),
        ratedPower: num(r['额定功率'], { sheet: '设计参数', row: r._row, col: '额定功率' }),
        designEff: de, _row: r._row,
      });
    }
  } else {
    warnings.push('未提供「设计参数」工作表，只做同类设备横向对比，不做与设计值的偏差分析（不引用通用典型效率值作为基准）');
  }

  // ---- 分组表（可选）
  const groupMap = new Map();
  const gBook = a.group ? loadBook(a.group) : book;
  const gSheet = C.pickSheet(gBook, '分组', '对比组', '同类分组');
  if (gSheet) {
    const grecs = C.toRecords(gSheet, ['位号'], '分组', ['分组', '设备类型'], warnings, ALIASES);
    for (const r of grecs) {
      const tag = C.str(r['位号']);
      if (!tag) continue;
      const g = C.str(r['分组']);
      if (g) groupMap.set(tag, g);
    }
  }

  // ---- 单价表（可选；仅用于费用差额测算，不等于节能收益）
  // 分时电价：多行「电」且带时段（峰/平/谷）时，只认「加权/平均/综合」行；没有则不测算，脚本不自行取峰或谷
  let unitPrice = null, priceUnit = null, priceMedium = null, priceKind = null;
  const pBook = a.price ? loadBook(a.price) : book;
  const pSheet = C.pickSheet(pBook, '单价', '价格', '能源单价');
  if (pSheet) {
    const precs = C.toRecords(pSheet, ['单价'], '单价', ['能源介质', '介质单位', '时段'], warnings, ALIASES);
    const elec = [], other = [];
    for (const r of precs) {
      const med = C.str(r['能源介质']) || '电';
      const v = num(r['单价'], { sheet: '单价', row: r._row, col: '单价' });
      if (v === null) { warnings.push(`工作表「单价」第${r._row}行 单价为空或无法解析，已跳过`); continue; }
      const rec = { v, unit: C.str(r['介质单位']) || 'kWh', med, period: C.str(r['时段']), row: r._row };
      (/电/.test(med) ? elec : other).push(rec);
    }
    const pickRec = (rec, kind) => { unitPrice = rec.v; priceUnit = rec.unit; priceMedium = rec.med; priceKind = kind; };
    if (elec.length === 1) {
      pickRec(elec[0], elec[0].period ? `单一电价（${elec[0].period}）` : '单一电价');
      warnings.push('费用差额按单一电价测算；厂内执行分时电价（峰/平/谷）时，差额随运行时段分布变化，请改提供加权平均电价（时段列填「加权」）或按时段分列运行小时');
    } else if (elec.length > 1) {
      const avg = elec.find((x) => /加权|平均|综合/.test(x.period));
      if (avg) pickRec(avg, `分时电价加权平均（第${avg.row}行）`);
      else warnings.push(`「单价」工作表有 ${elec.length} 行电价（${elec.map((x) => x.period || '无时段').join('/')}），未提供加权平均电价，不做费用差额测算（脚本不自行取峰、平或谷电价）`);
    } else if (other.length) {
      pickRec(other[0], `非电介质单价（${other[0].med}）`);
    }
    if (unitPrice === null) warnings.push('「单价」工作表中没有可用的单价，不做费用差额测算');
  }

  // ---- 逐台计算
  const byEquipment = [], insufficientData = [], implausible = [];
  const seen = new Set();
  for (const r of runs) {
    const tag = C.str(r['位号']);
    if (!tag) { warnings.push(`工作表「运行数据」第${r._row}行 位号为空，已跳过`); continue; }
    if (seen.has(tag)) warnings.push(`工作表「运行数据」第${r._row}行 位号「${tag}」重复出现，已原样保留未合并，请核实运行数据表`);
    seen.add(tag);

    const rowType = normType(r['设备类型']);
    if (r['设备类型'] && !rowType) warnings.push(`工作表「运行数据」第${r._row}行 设备「${tag}」设备类型「${C.str(r['设备类型'])}」无法识别，已按 --equip-type（${defType.label}）处理`);
    const t = rowType || defType;

    const v = {};
    for (const col of ['流量', '扬程', '全压', '轴功率', '电机功率', '电机效率', '介质密度', '进口压力', '出口压力',
      '进口温度', '出口温度', '绝热指数', '输出功率', '输入功率', '燃料量', '低位发热值', '有效热负荷',
      '换热量', '换热面积', '对数平均温差', '运行时间']) {
      v[col] = num(r[col], { sheet: '运行数据', row: r._row, col });
    }

    const calc = calcEfficiency(t.key, v, { polytropic });
    const design = designMap.get(tag) || null;

    // 单位能耗：单位输送量（或单位有效热量）的耗功；缺任一项为 null，不估
    let specific = null, specificUnit = null;
    const powerIn = v.轴功率 !== null ? v.轴功率 : (v.输入功率 !== null ? v.输入功率 : v.电机功率);
    if (t.key === 'pump' || t.key === 'fan' || t.key === 'compressor') {
      if (powerIn !== null && v.流量 !== null && v.流量 > 0) { specific = C.round(powerIn / v.流量, 4); specificUnit = 'kW/(m³/h)'; }
    } else if (t.key === 'furnace') {
      if (v.燃料量 !== null && v.有效热负荷 !== null && v.有效热负荷 > 0) { specific = C.round(v.燃料量 / v.有效热负荷, 4); specificUnit = '燃料量/有效热负荷'; }
    } else if (t.key === 'motor') {
      if (v.输入功率 !== null && v.输出功率 !== null && v.输出功率 > 0) { specific = C.round(v.输入功率 / v.输出功率, 4); specificUnit = 'kW/kW'; }
    }

    const item = {
      tag, name: C.str(r['设备名称']), type: t.key, typeLabel: t.label,
      group: groupMap.get(tag) || C.str(r['分组']) || t.label,
      row: r._row,
      inputs: {
        流量: v.流量, 扬程: v.扬程, 全压: v.全压, 轴功率: v.轴功率, 电机功率: v.电机功率, 电机效率: v.电机效率,
        介质密度: v.介质密度, 进口压力: v.进口压力, 出口压力: v.出口压力, 输出功率: v.输出功率, 输入功率: v.输入功率,
        燃料量: v.燃料量, 低位发热值: v.低位发热值, 有效热负荷: v.有效热负荷,
        换热量: v.换热量, 换热面积: v.换热面积, 对数平均温差: v.对数平均温差, 运行时间: v.运行时间,
      },
      basis: calc.basis,
      efficiencyKind: t.key === 'compressor' ? (polytropic ? 'polytropic' : 'isothermal') : null,
      polytropicExponentTerm: calc.polytropicExponentTerm ?? null,
      usefulPower: calc.usefulPower, shaftPower: calc.shaftPower, shaftPowerSource: calc.shaftSource,
      metricName: calc.metricName, metricValue: calc.metricValue, metricUnit: calc.metricUnit,
      efficiency: null, efficiencyPct: null,
      specificEnergy: specific, specificEnergyUnit: specificUnit,
      runHours: v.运行时间,
      designEfficiency: design ? design.designEff : null,
      designEfficiencyPct: design && design.designEff !== null ? C.round(design.designEff * 100, 2) : null,
      designDeviation: null, designDeviationPct: null,
      groupRank: null, groupSize: null, groupMedianPct: null, groupDeviationPct: null,
      category: null, lowReason: null, missing: calc.missing.slice(),
    };

    // 硬约束 1：参数不全 → 效率 null + insufficientData，绝不用典型值代替
    if (calc.missing.length) {
      item.category = 'insufficientData';
      item.note = `计算${t.label}效率所需参数不全，缺少：${calc.missing.join('、')}；已输出 null，未用典型值代替`;
      warnings.push(`工作表「运行数据」第${r._row}行 设备「${tag}」（${t.label}）计算参数不全（缺 ${calc.missing.join('、')}），**效率未计算，也未用典型值代替**`);
      byEquipment.push(item); insufficientData.push(item);
      continue;
    }

    if (t.key === 'exchanger') {
      // 换热器给 K 值，不给 0~1 效率；K ≤ 0 已在 calc 里拦掉
      item.category = 'calculated';
      item.note = '换热器按传热系数 K 呈现，不折算为 0~100% 的效率';
      byEquipment.push(item);
      continue;
    }

    const eff = calc.efficiency;
    // 硬约束 2：超出物理合理范围 → implausible 单列 + warning，不截断
    if (!Number.isFinite(eff) || eff <= EFF_MIN || eff > EFF_MAX) {
      item.efficiency = Number.isFinite(eff) ? C.round(eff, 4) : null;
      item.efficiencyPct = Number.isFinite(eff) ? C.round(eff * 100, 2) : null;
      item.category = 'implausible';
      item.note = `按${t.label}口径算得效率 ${Number.isFinite(eff) ? C.round(eff * 100, 2) + '%' : '无法计算'}，超出 0~100% 的物理合理范围，已原样保留未截断，需核实原始数据（单位、量程、取数时点是否一致）`;
      warnings.push(`工作表「运行数据」第${r._row}行 设备「${tag}」算得效率 ${Number.isFinite(eff) ? C.round(eff * 100, 2) + '%' : '非有限值'}，**超出物理合理范围，已单列未截断**，请核实流量/功率/密度等原始数据的单位与量程`);
      byEquipment.push(item); implausible.push(item);
      continue;
    }

    item.efficiency = C.round(eff, 4);
    item.efficiencyPct = C.round(eff * 100, 2);
    item.category = 'calculated';
    if (item.designEfficiency !== null) {
      item.designDeviation = C.round(eff - item.designEfficiency, 4);
      item.designDeviationPct = C.round((eff - item.designEfficiency) * 100, 2);
    }
    byEquipment.push(item);
  }

  if (!byEquipment.length) throw new Error('「运行数据」中没有可用记录');

  // ---- 统计期内运行时间 ≤ 0 h：参数均值不代表运行工况，效率照列供核对，但不判正常或偏低、不参与同类对比
  for (const it of byEquipment) {
    if (it.category !== 'calculated' || it.efficiency === null || it.runHours === null || it.runHours > 0) continue;
    it.lowJudgement = 'notRunning';
    it.note = `统计期内运行时间为 ${it.runHours} h，参数均值不代表运行工况；效率仅列出供核对，未判正常或偏低，也未参与同类对比`;
    warnings.push(`工作表「运行数据」第${it.row}行 设备「${it.tag}」统计期内运行时间为 ${it.runHours} h，参数均值不代表运行工况，**不判正常或偏低**，也不参与同类对比；请核实该台是否为备用或停运设备`);
  }

  // ---- 同类设备横向对比（只在组内 ≥2 台可算设备时成立）
  const groups = new Map();
  for (const it of byEquipment) {
    if (it.category !== 'calculated' || it.efficiency === null || it.lowJudgement === 'notRunning') continue;
    if (!groups.has(it.group)) groups.set(it.group, []);
    groups.get(it.group).push(it);
  }
  const groupComparison = [];
  for (const [gname, list] of groups) {
    list.sort((x, y) => y.efficiency - x.efficiency);
    const effs = list.map((x) => x.efficiency);
    const med = median(effs);
    list.forEach((x, i) => {
      x.groupRank = i + 1; x.groupSize = list.length;
      x.groupMedianPct = C.round(med * 100, 2);
      x.groupDeviationPct = C.round((x.efficiency - med) * 100, 2);
    });
    groupComparison.push({
      group: gname, size: list.length,
      comparable: list.length >= 2,
      maxPct: C.round(Math.max(...effs) * 100, 2),
      minPct: C.round(Math.min(...effs) * 100, 2),
      medianPct: C.round(med * 100, 2),
      spreadPct: C.round((Math.max(...effs) - Math.min(...effs)) * 100, 2),
      best: list[0].tag, worst: list[list.length - 1].tag,
      members: list.map((x) => ({ tag: x.tag, name: x.name, efficiencyPct: x.efficiencyPct, rank: x.groupRank })),
      note: list.length >= 2 ? null : '组内仅 1 台可算设备（统计期内运行 0 h 的不计），不构成横向对比（不与通用典型效率值比较）',
    });
  }
  groupComparison.sort((x, y) => y.size - x.size || String(x.group).localeCompare(String(y.group), 'zh'));

  // ---- 能效偏低判定：有设计效率的按设计值，否则按组内中位数（组内 ≥2 台才成立）
  const lowEfficiency = [];
  for (const it of byEquipment) {
    if (it.category !== 'calculated' || it.efficiency === null || it.lowJudgement === 'notRunning') continue;
    let baseline = null, baselineKind = null;
    if (it.designEfficiency !== null) { baseline = it.designEfficiency; baselineKind = 'design'; }
    else if (it.groupSize >= 2) { baseline = it.groupMedianPct / 100; baselineKind = 'groupMedian'; }
    it.baselineKind = baselineKind;
    it.baselinePct = baseline === null ? null : C.round(baseline * 100, 2);
    if (baseline === null) {
      // 硬约束 3：既无设计值又无同类可比 → 不判偏低，绝不拿通用典型效率值当基准
      it.lowJudgement = 'notComparable';
      it.note = it.note || '无设计效率且组内无同类设备可比，未做能效偏低判定（不引用通用典型效率值作为基准）';
      continue;
    }
    it.lowJudgement = it.efficiency < baseline * threshold ? 'low' : 'normal';
    if (it.lowJudgement === 'low') {
      it.checkPoints = ['运行工况是否偏离设计点（流量/扬程/负荷率）', '叶轮、密封等过流部件是否磨损或间隙增大', '管网阻力或系统配置是否变化（阀门开度、过滤器堵塞）', '仪表取数是否准确（流量计、功率表校验状态）'];
      it.lowReason = null;   // 硬约束 4：不断言原因，只给需核实方向
      lowEfficiency.push(it);
    }
  }
  lowEfficiency.sort((x, y) => (x.efficiencyPct ?? 0) - (y.efficiencyPct ?? 0));

  // ---- 费用差额测算（仅在有单价时；不等于节能收益）
  const savingStatement = '费用差额为按当前运行条件、以设计效率或组内中位数为参照的静态测算，未考虑工况变化、负荷率、检修投入与工艺约束，不等于可实现的节能收益。';
  const savingPotential = [];
  let savingTotal = null;
  if (unitPrice !== null) {
    for (const it of lowEfficiency) {
      if (it.baselinePct === null || it.shaftPower === null || it.runHours === null) {
        savingPotential.push({ tag: it.tag, name: it.name, annualCostGap: null, note: `缺少${it.runHours === null ? '运行时间' : '基准或轴功率'}，不做费用差额测算（未用典型运行小时代替）` });
        continue;
      }
      const baseEff = it.baselinePct / 100;
      // 达到基准效率时所需轴功率 = 有效功率 / 基准效率
      const needed = it.usefulPower / baseEff;
      const gapKw = it.shaftPower - needed;
      if (!(gapKw > 0)) { savingPotential.push({ tag: it.tag, name: it.name, annualCostGap: null, note: '按基准效率测算无功率差额' }); continue; }
      const cost = C.round(gapKw * it.runHours * unitPrice, 2);
      savingTotal = C.round((savingTotal || 0) + cost, 2);
      savingPotential.push({
        tag: it.tag, name: it.name, efficiencyPct: it.efficiencyPct, baselinePct: it.baselinePct,
        baselineKind: it.baselineKind, powerGapKw: C.round(gapKw, 3), runHours: it.runHours,
        unitPrice, priceUnit, annualCostGap: cost, statement: savingStatement,
      });
    }
  } else if (lowEfficiency.length) {
    warnings.push('未提供能源单价，不做费用差额测算（不按典型电价代替）');
  }

  const counts = {
    equipment: byEquipment.length,
    calculated: byEquipment.filter((x) => x.category === 'calculated').length,
    lowEfficiency: lowEfficiency.length,
    insufficientData: insufficientData.length,
    implausible: implausible.length,
    groups: groupComparison.length,
    comparableGroups: groupComparison.filter((x) => x.comparable).length,
    notComparable: byEquipment.filter((x) => x.lowJudgement === 'notComparable').length,
    notRunning: byEquipment.filter((x) => x.lowJudgement === 'notRunning').length,
    designProvided,
    priceProvided: unitPrice !== null,
    polytropic,
  };

  // ---- 产出
  C.ensureDir(outDir);
  const boundary = '本报告为单台设备的能效口径分析，不算装置综合能耗、不算单位产品能耗（两者归能源管理部门/工艺口径）；车间设备员只做单机能效对标与异常提示，能耗指标考核归能源管理部门；装置级能耗与对标请使用 energy-weekly-report 技能。';
  const statement = '本材料由脚本汇总、模型成文，仅供设备员复核参考，不替代审批、定性、验收与签字；厂内制度与系统数据为准。';
  const priceNote = '电价说明：厂内多执行分时电价（峰/平/谷），单一电价测算的费用差额只是量级参考；电价单价由用户提供，脚本不内置任何电价数值。';
  const result = {
    meta: {
      workshop: a.workshop, equipType: defType.label, from, to, threshold, polytropic,
      compressorBasis: polytropic ? REQUIRED.compressorPolytropic.formula : REQUIRED.compressor.formula,
      generatedAt: C.localDateTime(), designProvided, priceProvided: unitPrice !== null,
      unitPrice, priceUnit, priceMedium, priceKind, priceNote,
      boundary, statement, savingStatement,
      baselineRule: '有设计效率的以设计效率为基准；无设计效率但组内同类设备 ≥2 台的以组内中位数为基准；两者皆无则不判偏低（不引用通用典型效率值）',
      efficiencyRange: '效率的物理合理范围为 0~100%（不含 0），超出即单列 implausible 且不截断',
      formulas: Object.fromEntries(Object.entries(REQUIRED).map(([k, v]) => [TYPE_LABEL[k] || '压缩机（多变）', v.formula])),
    },
    counts, byEquipment, lowEfficiency, groupComparison, insufficientData, implausible, savingPotential,
    savingTotal, warnings,
  };
  fs.writeFileSync(path.join(outDir, 'energy.json'), JSON.stringify(result, null, 2), 'utf8');

  // ---- 能效对标表 xlsx
  writeXlsx(path.join(outDir, '能效对标表.xlsx'), {
    '逐台能效': [['位号', '设备名称', '设备类型', '分组', '效率(%)', '有效功率(kW)', '轴功率(kW)', '单位能耗', '单位能耗单位',
      '设计效率(%)', '与设计值偏差(百分点)', '组内排名', '组内中位数(%)', '与组内中位数偏差(百分点)', '运行时间(h)', '判定'],
    ...byEquipment.map((x) => [x.tag, x.name || '—', x.typeLabel, x.group, x.efficiencyPct, x.usefulPower, x.shaftPower,
      x.specificEnergy, x.specificEnergyUnit || '—', x.designEfficiencyPct, x.designDeviationPct,
      x.groupRank, x.groupMedianPct, x.groupDeviationPct, x.runHours,
      x.category === 'insufficientData' ? '数据不足' : x.category === 'implausible' ? '超出合理范围' : x.lowJudgement === 'low' ? '能效偏低' : x.lowJudgement === 'notComparable' ? '无可比基准' : x.lowJudgement === 'notRunning' ? '统计期内未运行（不判定）' : '正常'])],
    '能效偏低': [['位号', '设备名称', '效率(%)', '基准(%)', '基准来源', '差距(百分点)', '需核实方向'],
      ...lowEfficiency.map((x) => [x.tag, x.name || '—', x.efficiencyPct, x.baselinePct,
        x.baselineKind === 'design' ? '设计效率' : '组内中位数', C.round(x.efficiencyPct - x.baselinePct, 2),
        (x.checkPoints || []).join('；')])],
    '同类对比': [['分组', '台数', '最高(%)', '中位数(%)', '最低(%)', '极差(百分点)', '最优位号', '最差位号', '说明'],
      ...groupComparison.map((x) => [x.group, x.size, x.maxPct, x.medianPct, x.minPct, x.spreadPct, x.best, x.worst, x.note || '—'])],
    '数据不足': [['位号', '设备名称', '设备类型', '行号', '缺失参数', '说明'],
      ...insufficientData.map((x) => [x.tag, x.name || '—', x.typeLabel, x.row, x.missing.join('、'), x.note])],
    '异常值': [['位号', '设备名称', '设备类型', '行号', '算得效率(%)', '说明'],
      ...implausible.map((x) => [x.tag, x.name || '—', x.typeLabel, x.row, x.efficiencyPct, x.note])],
    '费用差额测算': [['位号', '设备名称', '效率(%)', '基准(%)', '功率差额(kW)', '运行时间(h)', '单价', '费用差额', '说明'],
      ...savingPotential.map((x) => [x.tag, x.name || '—', x.efficiencyPct ?? null, x.baselinePct ?? null,
        x.powerGapKw ?? null, x.runHours ?? null, x.unitPrice ?? null, x.annualCostGap, x.note || savingStatement])],
  });

  // ---- energy.md
  const L = [];
  L.push(`# ${a.workshop} 设备能效分析与对标（${from} 至 ${to}）`);
  L.push('');
  L.push(`设备类型：${defType.label}　｜　偏低判定：低于基准的 ${C.round(threshold * 100, 0)}%　｜　设计参数：${designProvided ? '已提供' : '未提供'}　｜　压缩机口径：${polytropic ? '多变效率（--polytropic）' : '等温效率'}`);
  L.push(`生成时间：${C.localDateTime()}（北京时间）`);
  L.push('');
  L.push(`> ${boundary}`);
  L.push('');
  L.push('## 一、统计概览');
  L.push('');
  L.push(C.mdTable(['指标', '数值'], [
    ['纳入设备数', counts.equipment],
    ['完成计算', counts.calculated],
    ['能效偏低', counts.lowEfficiency],
    ['数据不足（参数不全）', counts.insufficientData],
    ['超出物理合理范围', counts.implausible],
    ['同类对比组', `${counts.groups}（其中可横向对比 ${counts.comparableGroups} 组）`],
    ['无可比基准', counts.notComparable],
    ['统计期内未运行（运行时间 0 h，不判定）', counts.notRunning],
    ['与设计值偏差分析', designProvided ? '已开展' : '—（未提供设计参数，仅做同类横向对比）'],
    ['费用差额测算', counts.priceProvided ? `已测算（单价 ${unitPrice} 元/${priceUnit}，${priceKind}）` : '—（未提供能源单价或未提供分时电价的加权平均值）'],
  ]));
  if (polytropic) {
    L.push(`> 【注意】压缩机按多变效率口径：${REQUIRED.compressorPolytropic.formula}。所需参数：进口压力、出口压力（绝压）、进口温度、出口温度（℃）、绝热指数 k；缺任一项该台记入「数据不足」，不按典型 k 值或等温口径顶替。`);
    L.push('');
  }
  L.push('## 二、逐台能效明细');
  L.push('');
  L.push(C.mdTable(['位号', '设备名称', '类型', '分组', '效率', '有效功率(kW)', '轴功率(kW)', '单位能耗', '设计效率', '与设计值偏差', '组内排名', '判定'],
    byEquipment.map((x) => [x.tag, x.name || '—', x.typeLabel, x.group,
      x.efficiencyPct === null ? (x.metricName === '传热系数K' ? `K=${C.fmt(x.metricValue, 4)}` : '—') : `${x.efficiencyPct}%`,
      C.fmt(x.usefulPower, 3), C.fmt(x.shaftPower, 3),
      x.specificEnergy === null ? '—' : `${x.specificEnergy} ${x.specificEnergyUnit}`,
      x.designEfficiencyPct === null ? '—' : `${x.designEfficiencyPct}%`,
      x.designDeviationPct === null ? '—' : `${x.designDeviationPct > 0 ? '+' : ''}${x.designDeviationPct} 百分点`,
      x.groupRank === null ? '—' : `${x.groupRank}/${x.groupSize}`,
      x.category === 'insufficientData' ? '数据不足' : x.category === 'implausible' ? '超出合理范围' : x.lowJudgement === 'low' ? '能效偏低' : x.lowJudgement === 'notComparable' ? '无可比基准' : x.lowJudgement === 'notRunning' ? '统计期内未运行（不判定）' : '正常'])));
  if (!designProvided) {
    L.push('> 【注意】未提供设计参数表，「设计效率」「与设计值偏差」两列为 —，本报告只做同类设备横向对比，未引用通用典型效率值作为基准。');
    L.push('');
  }
  L.push('## 三、能效偏低清单');
  L.push('');
  if (!lowEfficiency.length) L.push('_无_\n');
  else {
    L.push(C.mdTable(['位号', '设备名称', '效率', '基准', '基准来源', '差距', '需核实方向'],
      lowEfficiency.map((x) => [x.tag, x.name || '—', `${x.efficiencyPct}%`, `${x.baselinePct}%`,
        x.baselineKind === 'design' ? '设计效率' : '组内中位数',
        `${C.round(x.efficiencyPct - x.baselinePct, 2)} 百分点`, (x.checkPoints || []).join('；')])));
    L.push('> 以上仅列出需核实的方向，未判定能效偏低的原因；确认原因需结合现场检查、工况核对与仪表校验。');
    L.push('');
  }
  L.push('## 四、同类设备对比');
  L.push('');
  L.push(C.mdTable(['分组', '台数', '最高', '中位数', '最低', '极差', '最优位号', '最差位号', '说明'],
    groupComparison.map((x) => [x.group, x.size, `${x.maxPct}%`, `${x.medianPct}%`, `${x.minPct}%`,
      `${x.spreadPct} 百分点`, x.best, x.worst, x.note || '—'])));
  L.push('## 五、数据不足与异常值');
  L.push('');
  L.push('### 5.1 计算参数不全');
  L.push('');
  if (!insufficientData.length) L.push('_无_\n');
  else {
    L.push(C.mdTable(['位号', '设备名称', '类型', '行号', '缺失参数', '说明'],
      insufficientData.map((x) => [x.tag, x.name || '—', x.typeLabel, x.row, x.missing.join('、'), x.note])));
    L.push('> 以上设备效率均为 —，**未用典型效率值或典型参数代替缺失项**，需补齐参数后重算。');
    L.push('');
  }
  L.push('### 5.2 超出物理合理范围');
  L.push('');
  if (!implausible.length) L.push('_无_\n');
  else {
    L.push(C.mdTable(['位号', '设备名称', '类型', '行号', '算得效率', '说明'],
      implausible.map((x) => [x.tag, x.name || '—', x.typeLabel, x.row,
        x.efficiencyPct === null ? '—' : `${x.efficiencyPct}%`, x.note])));
    L.push('> 以上结果已原样保留、**未截断到合理范围后呈现**，属数据问题而非设备结论，请先核实原始数据的单位、量程与取数时点。');
    L.push('');
  }
  L.push('### 5.3 费用差额测算');
  L.push('');
  if (!counts.priceProvided) L.push('_未提供能源单价（或分时电价未提供加权平均值），不做费用差额测算。_\n');
  else if (!savingPotential.length) L.push('_无能效偏低设备，不涉及费用差额测算。_\n');
  else {
    L.push(C.mdTable(['位号', '设备名称', '效率', '基准', '功率差额(kW)', '运行时间(h)', '费用差额(元)', '说明'],
      savingPotential.map((x) => [x.tag, x.name || '—', x.efficiencyPct === undefined || x.efficiencyPct === null ? '—' : `${x.efficiencyPct}%`,
        x.baselinePct === undefined || x.baselinePct === null ? '—' : `${x.baselinePct}%`,
        C.fmt(x.powerGapKw, 3), C.fmt(x.runHours, 1), C.fmt(x.annualCostGap, 2), x.note || '按当前运行条件测算'])));
    L.push(`> 合计费用差额：${C.fmt(savingTotal, 2)} 元。${savingStatement}`);
    L.push('');
  }
  if (counts.priceProvided) { L.push(`> 【注意】${priceNote}（本次按 ${priceKind} 测算）`); L.push(''); }
  L.push('## 六、能效分析');
  L.push('');
  L.push('<!-- ANALYSIS_START -->');
  L.push('（由模型依据 references/energy-rules.md 口径撰写 250~400 字，结构：总体情况 → 能效偏低设备与可能方向 → 同类设备差异 → 数据不足与异常值 → 建议核实事项。效率数值一律引用 energy.json；能效偏低只提示需核实的方向，不断言原因；费用差额须注明是基于当前运行条件的测算，不等于节能收益。）');
  L.push('<!-- ANALYSIS_END -->');
  L.push('');
  L.push('---');
  L.push('');
  L.push(`> ${savingStatement}`);
  L.push('');
  L.push(`> ${boundary}`);
  L.push('');
  L.push(`> ${statement}`);
  L.push('');
  if (warnings.length) {
    L.push('## 附：数据提示');
    L.push('');
    for (const w of warnings) L.push(`- ${w}`);
    L.push('');
  }
  fs.writeFileSync(path.join(outDir, 'energy.md'), L.join('\n'), 'utf8');

  C.emitOk(outDir, { ok: true, out: outDir, workshop: a.workshop, equipType: defType.label, from, to, polytropic, counts, savingTotal, warnings });
}

try { main(); } catch (e) { C.fail(e, warnings); }
