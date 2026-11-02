#!/usr/bin/env node
'use strict';
/**
 * 铭牌识别结果后处理脚本（仅 Node.js 内置模块）—— 中石化炼化厂车间设备员口径
 *
 * 分工：读图识别由「模型」完成（识别值由模型读图产生，未经脚本验证），本脚本只做识别结果的后处理——
 *   字段对齐台账（SAP PM / EM 列名）、raw 铭牌原文量级校验、单位换算校验、与台账现值比对查重、置信度校验、生成待确认录入行。
 * 本脚本不读取图片，也不修改用户台账文件。位号与设备编号分列：SAP「功能位置」是位号，「设备」是 8 位流水号。
 *
 * 用法：node "<技能目录>/scripts/intake.js" --fields <识别结果JSON或json文件路径>
 *         --tag "P-1101A" --equip-type "泵" [--ledger <台账xlsx>] [--out <dir>] [--photo <照片文件名>]
 * 产出：<out>/intake.json、intake.md、intake.csv、summary.json；末行打印 JSON 摘要
 */
const fs = require('fs');
const path = require('path');
const { readXlsx, readCsvDir } = require('./lib/xlsx-lite');
const C = require('./lib/common');

const warnings = [];
const VALUE_OPTS = ['fields', 'tag', 'equip-type', 'ledger', 'out', 'photo'];
const FLAG_OPTS = ['help'];

/** 必须保留的声明行（SKILL.md 硬要求，不得删改） */
const DECLARATION = '识别值由模型读图产生，未经脚本验证，须与铭牌原件或出厂资料核对后方可录入台账；本技能不直接修改台账文件';

const CONF = ['clear', 'blurry', 'unreadable'];
const CONF_CN = { clear: '清晰可读', blurry: '部分模糊需核对', unreadable: '无法辨认' };

// ---------------------------------------------------------------- 设备类型
const EQUIP_TYPES = {
  '泵': ['泵', 'pump', '离心泵', '往复泵', '屏蔽泵'],
  '电机': ['电机', '马达', 'motor', '电动机'],
  '压缩机': ['压缩机', 'compressor', '风机', '鼓风机'],
  '换热器': ['换热器', '热交换器', '冷却器', '再沸器', '冷凝器', 'exchanger'],
  '容器': ['容器', '塔器', '塔', '储罐', '罐', '反应器', '分离器', 'vessel'],
  '阀门': ['阀门', '安全阀', '调节阀', '阀', 'valve'],
  '仪表': ['仪表', '变送器', '流量计', '压力表', '表', 'instrument'],
};
function normEquipType(v) {
  const s = C.str(v).toLowerCase().replace(/\s/g, '');
  if (!s) return null;
  for (const [std, list] of Object.entries(EQUIP_TYPES)) {
    if (list.some((k) => s === k.toLowerCase())) return std;
  }
  for (const [std, list] of Object.entries(EQUIP_TYPES)) {
    if (list.some((k) => s.includes(k.toLowerCase()))) return std;
  }
  return null;
}

// ---------------------------------------------------------------- 字段模板
// 各设备类型的铭牌字段模板（references/nameplate-fields.md）
const COMMON_FIELDS = ['制造厂', '型号', '规格', '出厂编号', '制造日期', '执行标准', '重量'];
const TYPE_FIELDS = {
  '泵': ['流量', '扬程', '转速', '配用功率', '效率', '汽蚀余量', '泵壳材质', '叶轮材质', '密封形式', '设计压力', '设计温度'],
  '电机': ['额定功率', '额定电压', '额定电流', '额定转速', '频率', '接法', '功率因数', '效率', '防护等级', '绝缘等级', '防爆标志', '工作制'],
  '压缩机': ['排气量', '进气压力', '排气压力', '进气温度', '排气温度', '转速', '轴功率', '级数', '介质', '润滑方式'],
  '换热器': ['型式', '换热面积', '管程设计压力', '壳程设计压力', '管程设计温度', '壳程设计温度', '管程介质', '壳程介质', '管板材质', '换热管材质', '容器类别', '制造许可证号', '设备代码'],
  '容器': ['设计压力', '最高工作压力', '设计温度', '工作温度', '容积', '介质', '主体材质', '腐蚀裕量', '焊缝系数', '容器类别', '设计使用年限', '制造许可证号', '监检机构', '设备代码'],
  '阀门': ['公称通径', '公称压力', '阀体材质', '阀门型号', '适用介质', '适用温度', '驱动方式', '泄漏等级'],
  '仪表': ['量程', '精度等级', '输出信号', '供电电压', '防爆标志', '防护等级', '膜片材质', '过程连接'],
};

// ---------------------------------------------------------------- 台账对齐
// 铭牌字段 → 台账列名；null 表示不与台账比对（如制造日期不得对到投用日期）
const LEDGER_MAP = {
  '制造厂': '制造厂',
  '型号': '规格型号',
  '规格': '规格型号',      // 仅在「型号」缺失时启用，见 buildAlignment
  '出厂编号': '出厂编号',
  '设备代码': '设备代码',
  '制造日期': '制造日期',
  '执行标准': '执行标准',
  '重量': '重量(kg)',
  '额定功率': '功率(kW)', '配用功率': '功率(kW)', '轴功率': '功率(kW)',
  '流量': '流量(m³/h)', '排气量': '流量(m³/h)',
  '扬程': '扬程(m)',
  '转速': '转速(r/min)', '额定转速': '转速(r/min)',
  '额定电压': '电压(V)', '供电电压': '电压(V)',
  '额定电流': '电流(A)',
  '设计压力': '设计压力(MPa)',
  '设计温度': '设计温度(℃)',
  '换热面积': '换热面积(m²)',
  '容积': '容积(m³)',
  '公称通径': '公称通径(mm)',
  '公称压力': '公称压力(MPa)',
  '主体材质': '材质', '泵壳材质': '材质', '阀体材质': '材质',
};

// 台账列 → 台账口径单位
const LEDGER_UNIT = {
  '功率(kW)': 'kW', '流量(m³/h)': 'm³/h', '扬程(m)': 'm', '转速(r/min)': 'r/min',
  '电压(V)': 'V', '电流(A)': 'A', '设计压力(MPa)': 'MPa', '设计温度(℃)': '℃',
  '换热面积(m²)': 'm²', '容积(m³)': 'm³', '公称通径(mm)': 'mm', '公称压力(MPa)': 'MPa',
  '重量(kg)': 'kg',
};

// 单位换算校验表：等价单位不告警；其他单位给换算参考值（仅提示，不改写 value）
const UNIT_RULES = {
  'kW': { same: ['kw', '千瓦'], conv: { 'hp': 0.7457, '马力': 0.7457, 'ps': 0.7355, 'w': 0.001 } },
  'MPa': { same: ['mpa', '兆帕'], conv: { 'bar': 0.1, 'kgf/cm²': 0.098, 'kgf/cm2': 0.098, 'kg/cm²': 0.098, 'kg/cm2': 0.098, '公斤': 0.098, 'psi': 0.006895, 'kpa': 0.001 } },
  '℃': { same: ['°c', 'c', '度', '摄氏度'], conv: { '℉': null, '°f': null } },
  'm³/h': { same: ['m3/h', 'm³/h', '立方米/小时'], conv: { 'l/s': 3.6, 'l/min': 0.06, 'm³/min': 60, 'm3/min': 60, 'gpm': 0.2271 } },
  'r/min': { same: ['rpm', '转/分', '转/分钟', 'r/m'], conv: {} },
  'kg': { same: ['千克', '公斤'], conv: { 't': 1000, '吨': 1000, 'g': 0.001 } },
  'mm': { same: ['毫米'], conv: { 'm': 1000, 'cm': 10, 'inch': 25.4, 'in': 25.4, '"': 25.4 } },
  'm²': { same: ['m2', '平方米'], conv: { 'ft²': 0.0929, 'ft2': 0.0929 } },
  'm³': { same: ['m3', '立方米'], conv: { 'l': 0.001, '升': 0.001 } },
  'V': { same: ['v', '伏'], conv: { 'kv': 1000 } },
  'A': { same: ['a', '安'], conv: { 'ma': 0.001 } },
  'm': { same: ['米'], conv: { 'mm': 0.001, 'ft': 0.3048 } },
};

// 局部别名优先，再并入共享 SYSTEM_ALIASES（SAP PM / EM / 特种设备台账列名）。「设备编号」是 SAP 流水号，不作位号别名。
const LEDGER_ALIASES = C.mergeAliases({
  '位号': ['位号', '设备位号', 'TAG', 'tag'],
  '设备名称': ['设备名称', '名称', '设备描述'],
  '规格型号': ['规格型号', '型号', '规格', '型号编号'],
  '制造厂': ['制造厂', '厂家', '制造商', '生产厂家', '供应商'],
  '投用日期': ['投用日期', '投用时间', '投产日期', '启用日期', '安装日期'],
  '出厂编号': ['出厂编号', '产品编号', '机号', '序列号', '出厂序号', '制造商序列号'],
  '设备代码': ['设备代码', '特种设备代码', '注册代码', '注册编号'],
  '制造日期': ['制造日期', '出厂日期', '生产日期'],
  '执行标准': ['执行标准', '标准号', '产品标准'],
  '材质': ['材质', '材料', '主体材质'],
  '功率(kW)': ['功率(kW)', '功率', '额定功率', '配用功率', '电机功率'],
  '流量(m³/h)': ['流量(m³/h)', '流量', '额定流量', '排量'],
  '扬程(m)': ['扬程(m)', '扬程', '额定扬程'],
  '转速(r/min)': ['转速(r/min)', '转速', '额定转速'],
  '电压(V)': ['电压(V)', '电压', '额定电压'],
  '电流(A)': ['电流(A)', '电流', '额定电流'],
  '设计压力(MPa)': ['设计压力(MPa)', '设计压力'],
  '设计温度(℃)': ['设计温度(℃)', '设计温度'],
  '换热面积(m²)': ['换热面积(m²)', '换热面积'],
  '容积(m³)': ['容积(m³)', '容积', '公称容积'],
  '公称通径(mm)': ['公称通径(mm)', '公称通径', 'DN'],
  '公称压力(MPa)': ['公称压力(MPa)', '公称压力', 'PN'],
  '重量(kg)': ['重量(kg)', '重量', '净重', '总重'],
});

// ---------------------------------------------------------------- 工具
/** 值归一化后比较：去空白、全半角、大小写、×/x、φ 系列 */
function normVal(v) {
  let s = C.str(v);
  if (s === '') return '';
  s = s.replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  s = s.replace(/[\s　]/g, '');
  s = s.replace(/[×xX*]/g, '×');
  s = s.replace(/[φΦФϕ]/g, 'φ');
  s = s.replace(/[－—–]/g, '-');
  return s.toLowerCase();
}
/** 单位归一化：去空白、小写、全角转半角 */
function normUnit(u) {
  let s = C.str(u);
  if (s === '') return '';
  s = s.replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  return s.replace(/[\s　]/g, '').toLowerCase();
}
/** 抽出文本中全部数字（用于 raw 量级校验） */
function allNums(v) {
  const s = C.str(v).replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0)).replace(/[,，\s]/g, '');
  return (s.match(/-?\d+(?:\.\d+)?/g) || []).map(Number).filter(Number.isFinite);
}
/** 两数之比是否为 10 的整数次幂（10/100/1000 或 0.1/0.01…），用于判「疑似小数点错位」 */
function powerOfTenRatio(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0 || b === 0) return false;
  const r = Math.abs(a / b);
  const lg = Math.log10(r);
  return Math.abs(lg - Math.round(lg)) < 1e-6 && Math.round(lg) !== 0;
}
/**
 * raw 量级校验：识别值里的数字必须能在铭牌原文 raw 中找到；
 * 找不到且与 raw 中某个数相差 10 的整数倍 → 疑似小数点错位（改判 blurry）；找不到且无倍数关系 → warning 不一致
 */
function checkRaw(f) {
  if (f.value === null || !f.raw) return null;
  if (f.raw.includes('\u25a2')) return { status: 'ok', note: '原文含模糊占位符，不做数字比对' };
  const vn = allNums(f.value);
  if (!vn.length) return { status: 'ok' };
  const rn = allNums(f.raw);
  if (!rn.length) return { status: 'noNumberInRaw', message: `识别值「${f.value}」含数字但铭牌原文「${f.raw}」中无数字，请核对原文是否录全` };
  const missing = vn.filter((n) => !rn.some((m) => Math.abs(m - n) < 1e-9));
  if (!missing.length) return { status: 'ok' };
  const shifted = missing.find((n) => rn.some((m) => powerOfTenRatio(n, m)));
  if (shifted !== undefined) {
    const m = rn.find((x) => powerOfTenRatio(shifted, x));
    return { status: 'magnitude', message: `识别值「${f.value}」与铭牌原文「${f.raw}」数值相差 10 的整数倍（${shifted} vs ${m}），疑似小数点错位或漏位，已改判为部分模糊需核对` };
  }
  return { status: 'mismatch', message: `识别值「${f.value}」中的数字 ${missing.join('/')} 未出现在铭牌原文「${f.raw}」中，请核对识别是否有误` };
}
/** 从值里抽数字（用于换算参考值）；抽不到返回 null，绝不按 0 */
function pickNum(v) {
  const s = C.str(v).replace(/[,，\s]/g, '');
  const m = s.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}
/** 易混字符对，用于冲突提示 */
const CONFUSE_PAIRS = [['0', 'o'], ['0', 'd'], ['1', 'i'], ['1', 'l'], ['1', '7'], ['5', 's'], ['6', '8'], ['8', 'b'], ['2', 'z'], ['m', 'n']];
/** 两个值是否只差易混字符 */
function onlyConfusableDiff(a, b) {
  const x = normVal(a), y = normVal(b);
  if (x.length !== y.length || x === y) return false;
  for (let i = 0; i < x.length; i++) {
    if (x[i] === y[i]) continue;
    const hit = CONFUSE_PAIRS.some(([p, q]) => (x[i] === p && y[i] === q) || (x[i] === q && y[i] === p));
    if (!hit) return false;
  }
  return true;
}

function loadBook(p) {
  const st = fs.statSync(p);
  return st.isDirectory() ? readCsvDir(p) : readXlsx(p);
}

/** --fields 取值：优先当文件路径读，否则当 JSON 字符串解析 */
function loadFields(v) {
  let text = v;
  if (!/^\s*[{[]/.test(v)) {
    if (!fs.existsSync(v)) throw new Error(`--fields 既不是合法 JSON，也不是存在的文件: ${v}`);
    try { text = fs.readFileSync(v, 'utf8'); } catch (e) { throw new Error(`--fields 文件读取失败: ${e.message}`); }
  }
  let obj;
  try { obj = JSON.parse(text.replace(/^﻿/, '')); } catch (e) { throw new Error(`--fields 不是合法 JSON: ${e.message}`); }
  if (obj === null || typeof obj !== 'object') throw new Error('--fields 必须是 JSON 对象');
  if (Array.isArray(obj)) obj = { fields: obj };
  if (!Array.isArray(obj.fields)) {
    throw new Error('--fields 缺少 fields 数组。简写形式（{"制造厂":"XX"}）不被接受：硬约束要求每个字段逐项标注 clear/blurry/unreadable 三档置信度，格式见 references/input-spec.md');
  }
  return obj;
}

// ---------------------------------------------------------------- 主流程
function main() {
  const a = C.parseArgs(process.argv.slice(2), VALUE_OPTS, FLAG_OPTS);
  if (!a.fields) throw new Error('缺少 --fields（模型识别出的铭牌字段 JSON 或 json 文件路径）');
  if (!a.tag || !C.str(a.tag)) {
    throw new Error('缺少 --tag：位号须由用户提供，铭牌上通常没有位号，不得从照片、设备喷漆字或文件名推断');
  }
  if (!a['equip-type']) throw new Error('缺少 --equip-type（设备类型）');
  const tag = C.str(a.tag);
  const equipType = normEquipType(a['equip-type']);
  if (!equipType) {
    throw new Error(`--equip-type 「${a['equip-type']}」无法识别，支持：${Object.keys(EQUIP_TYPES).join('、')}（不按通用类型兜底，字段模板对不上会产生错误的对齐结果）`);
  }

  const src = loadFields(a.fields);
  const photo = C.str(a.photo) || C.str(src.photo) || null;
  const outDir = a.out || path.join(require('os').tmpdir(), 'noi-out');

  // ---- 1. 置信度校验与规范化
  const fields = [];
  const seen = new Set();
  src.fields.forEach((f, i) => {
    if (f === null || typeof f !== 'object' || Array.isArray(f)) {
      throw new Error(`fields[${i}] 不是对象`);
    }
    const name = C.str(f.name);
    if (!name) throw new Error(`fields[${i}] 缺少 name（字段名）`);
    if (seen.has(name)) { warnings.push(`字段「${name}」重复出现，后一条已跳过`); return; }
    seen.add(name);

    const rawConf = C.str(f.confidence);
    if (!rawConf) {
      throw new Error(`字段「${name}」缺少 confidence：每个字段必须标注 clear / blurry / unreadable 三档之一，不得默认为清晰可读`);
    }
    if (!CONF.includes(rawConf)) {
      throw new Error(`字段「${name}」的 confidence「${rawConf}」非法，只能是 clear / blurry / unreadable`);
    }
    let conf = rawConf;
    const value = (f.value === null || f.value === undefined || C.str(f.value) === '') ? null : C.str(f.value);

    if (conf === 'unreadable' && value !== null) {
      throw new Error(`字段「${name}」标注为 unreadable 但 value 非空（「${value}」）：输入自相矛盾，请确认是无法辨认还是已识别出值，脚本不替你选一个`);
    }
    if (conf === 'clear' && value === null) {
      warnings.push(`字段「${name}」标注为 clear 但值为空，已改判为 unreadable（空值不可能是清晰可读）`);
      conf = 'unreadable';
    }
    if (conf === 'clear' && value !== null && value.includes('▢')) {
      warnings.push(`字段「${name}」标注为 clear 但值中含模糊占位符 ▢，已改判为 blurry`);
      conf = 'blurry';
    }
    let reason = C.str(f.reason) || null;
    if ((conf === 'blurry' || conf === 'unreadable') && !reason) {
      warnings.push(`字段「${name}」置信度为 ${CONF_CN[conf]} 但未说明原因（reason）`);
      reason = '未说明';
    }
    const raw = C.str(f.raw) || null;
    const rec = {
      name, value, confidence: conf,
      unit: C.str(f.unit) || null,
      raw,
      rawMissing: conf !== 'unreadable' && !raw,
      rawCheck: null,
      note: C.str(f.note) || null,
      reason,
      ledgerColumn: null, ledgerValue: null, match: null, unitCheck: null,
    };
    // raw 必填：clear / blurry 字段须给铭牌原文，否则无法做量级校验（不中断，但标记并提示）
    if (rec.rawMissing) warnings.push(`字段「${name}」未提供铭牌原文 raw，无法做量级校验；识别值由模型读图产生、未经脚本验证，录入前须核对原件`);
    // 量级校验：识别值与 raw 中的数字对不上 → 疑似小数点错位改判 blurry / 不一致 warning
    const rc = checkRaw(rec);
    if (rc && rc.status !== 'ok') {
      rec.rawCheck = rc;
      warnings.push(`字段「${name}」${rc.message}`);
      if (rc.status === 'magnitude' && rec.confidence === 'clear') {
        rec.confidence = 'blurry';
        rec.reason = rec.reason || '识别值与铭牌原文量级不一致（疑似小数点错位）';
      }
    } else if (rc) rec.rawCheck = rc;
    fields.push(rec);
  });
  if (!fields.length) throw new Error('--fields 的 fields 数组为空，没有可处理的识别字段');

  // 位号不得从识别字段回填
  const snField = fields.find((f) => /出厂编号|产品编号|机号|序列号/.test(f.name));
  if (snField && snField.value) {
    warnings.push(`铭牌「${snField.name}」为「${snField.value}」，这是制造厂产品序号，不是位号；本次位号以用户提供的「${tag}」为准`);
  }

  // ---- 2. 字段模板覆盖检查
  const template = COMMON_FIELDS.concat(TYPE_FIELDS[equipType] || []);
  const provided = new Set(fields.map((f) => f.name));
  const templateMissing = template.filter((t) => !provided.has(t));
  const offTemplate = fields.map((f) => f.name).filter((n) => !template.includes(n));
  if (templateMissing.length) {
    warnings.push(`「${equipType}」字段模板中以下字段未提交识别结果：${templateMissing.join('、')}（若铭牌上确无此项，请以 unreadable + reason「铭牌上无此项」提交）`);
  }
  for (const n of offTemplate) warnings.push(`字段「${n}」不在「${equipType}」的铭牌字段模板内，已按原样保留，请核对设备类型是否选对`);

  // ---- 3. 台账对齐与单位校验
  const hasModel = fields.some((f) => f.name === '型号' && f.value !== null);
  const unmapped = [];
  for (const f of fields) {
    let col = LEDGER_MAP[f.name] || null;
    // 「规格」仅在「型号」缺失时才对齐到规格型号，避免两者抢同一列
    if (f.name === '规格' && hasModel) col = null;
    f.ledgerColumn = col;
    // 单位校验（台账口径来自 LEDGER_UNIT）
    const std = col ? LEDGER_UNIT[col] : null;
    if (std && f.confidence !== 'unreadable') {
      const rule = UNIT_RULES[std];
      const u = normUnit(f.unit);
      if (!u) {
        f.unitCheck = { status: 'missing', std, message: `铭牌未标注单位，台账口径为 ${std}，请核对` };
        warnings.push(`字段「${f.name}」未标注单位，台账口径为 ${std}，请核对（不假设铭牌单位即为台账口径）`);
      } else if (u === normUnit(std) || (rule && rule.same.includes(u))) {
        f.unitCheck = { status: 'ok', std, message: null };
      } else if (rule && Object.prototype.hasOwnProperty.call(rule.conv, u)) {
        const k = rule.conv[u];
        const n = pickNum(f.value);
        const ref = (k !== null && n !== null) ? `${C.round(n * k, 4)} ${std}` : null;
        f.unitCheck = {
          status: 'mismatch', std, from: f.unit, factor: k, reference: ref,
          message: `铭牌单位「${f.unit}」与台账口径「${std}」不一致${ref ? `，换算参考值 ${ref}` : ''}，请人工核对（脚本不自动换算）`,
        };
        warnings.push(`字段「${f.name}」铭牌单位「${f.unit}」与台账口径「${std}」不一致${ref ? `，换算参考值约 ${ref}` : ''}，请人工核对——脚本不自动换算，以免把铭牌印错的单位固化进台账`);
      } else {
        f.unitCheck = { status: 'unknown', std, from: f.unit, message: `铭牌单位「${f.unit}」不在换算表内，台账口径为 ${std}，请人工核对` };
        warnings.push(`字段「${f.name}」铭牌单位「${f.unit}」不在换算表内，台账口径为 ${std}，请人工核对`);
      }
    }
  }

  // ---- 4. 读台账、查重、比对
  let ledgerRow = null, ledgerCols = [], conflicts = null, tagExists = null, matchedBy = null, ledgerTag = null, ledgerEquipNo = null;
  if (a.ledger) {
    if (!fs.existsSync(a.ledger)) throw new Error(`台账不存在: ${a.ledger}`);
    let book;
    try { book = loadBook(a.ledger); } catch (e) { throw new Error(`台账读取失败 ${a.ledger}: ${e.message}`); }
    const rows = C.pickSheet(book, '设备台账', '台账', '设备清单', '技术对象', '功能位置', '设备');
    if (!rows) {
      warnings.push('台账文件中未找到「设备台账」工作表，未做查重与比对');
    } else {
      // 台账实际列名（原样保留，用于对齐 LEDGER_MAP 的目标列）
      const norm = (r) => (r || []).map((c) => C.str(c).replace(/\s+/g, ''));
      let h = 0, best = -1;
      for (let i = 0; i < Math.min(10, rows.length); i++) {
        const hits = norm(rows[i]).filter(Boolean).length;
        const hasTag = norm(rows[i]).some((x) => LEDGER_ALIASES['位号'].includes(x));
        const score = hits + (hasTag ? 100 : 0);
        if (score > best) { best = score; h = i; }
      }
      ledgerCols = norm(rows[h]).filter(Boolean);
      const recs = C.toRecords(rows, ['位号'], '设备台账',
        ['设备名称', '规格型号', '制造厂', '投用日期', '出厂编号', '制造日期', '设备编号', '设备代码'], warnings, LEDGER_ALIASES);
      // 按原始列名取值，覆盖 LEDGER_MAP 里的所有目标列
      const header = norm(rows[h]);
      // 台账列定位：先按标准列名全等，再按别名表（导出表常写「型号」「生产厂家」）
      const idxOf = (colName) => {
        const want = C.str(colName).replace(/\s+/g, '');
        let j = header.findIndex((x) => x === want);
        if (j >= 0) return j;
        const list = LEDGER_ALIASES[want];
        if (!list) return -1;
        for (const al of list) {
          j = header.findIndex((x) => x === al);
          if (j >= 0) return j;
        }
        return -1;
      };
      const tagIdx = header.findIndex((x) => LEDGER_ALIASES['位号'].includes(x));
      const equipIdx = idxOf('设备编号');
      let hit = null;
      if (tagIdx >= 0) {
        for (let i = h + 1; i < rows.length; i++) {
          const r = rows[i] || [];
          if (!r.some((c) => C.str(c))) continue;
          if (/^(合计|小计|总计|共计|总数)/.test(C.str(r[0]))) continue;
          if (normVal(r[tagIdx]) === normVal(tag)) { hit = r; matchedBy = '位号'; break; }
        }
        // 位号未命中时再按 SAP 设备编号（8 位流水号）查，命中则单独标注，不把设备编号当位号
        if (!hit && equipIdx >= 0 && equipIdx !== tagIdx) {
          for (let i = h + 1; i < rows.length; i++) {
            const r = rows[i] || [];
            if (!r.some((c) => C.str(c))) continue;
            if (/^(合计|小计|总计|共计|总数)/.test(C.str(r[0]))) continue;
            if (C.str(r[equipIdx]) && normVal(r[equipIdx]) === normVal(tag)) { hit = r; matchedBy = '设备编号'; break; }
          }
          if (hit) warnings.push(`「${tag}」按台账「设备编号」列命中（SAP 设备流水号），其功能位置/位号为「${C.str(hit[tagIdx]) || '—'}」，台账记录以该位号展示`);
        }
      } else {
        warnings.push('台账中未找到「位号」列（位号/设备位号/功能位置/TAG），无法查重与比对');
      }
      tagExists = tagIdx >= 0 ? !!hit : null;
      if (hit) { ledgerTag = C.str(hit[tagIdx]) || null; if (equipIdx >= 0) ledgerEquipNo = C.str(hit[equipIdx]) || null; }
      if (tagIdx >= 0) {
        conflicts = [];
        if (!hit) {
          // 情况 A：新增建档
        } else {
          ledgerRow = {};
          header.forEach((c, j) => { if (c) ledgerRow[c] = C.str(hit[j]); });
          for (const f of fields) {
            if (!f.ledgerColumn) { if (f.confidence !== 'unreadable') unmapped.push({ name: f.name, reason: '铭牌字段在台账中无对应列' }); continue; }
            const j = idxOf(f.ledgerColumn);
            if (j < 0) { unmapped.push({ name: f.name, ledgerColumn: f.ledgerColumn, reason: `台账中无「${f.ledgerColumn}」列` }); continue; }
            const lv = C.str(hit[j]) || null;
            f.ledgerValue = lv;
            if (f.confidence === 'unreadable') { f.match = 'unreadable'; continue; }
            if (lv === null) { f.match = 'ledgerEmpty'; continue; }
            if (normVal(f.value) === normVal(lv)) { f.match = 'same'; continue; }
            f.match = 'diff';
          }
          const diffs = fields.filter((f) => f.match === 'diff');
          const snDiff = diffs.some((f) => /出厂编号|产品编号|机号|序列号/.test(f.name));
          for (const f of diffs) {
            let hint;
            const vn = allNums(f.value), ln = allNums(f.ledgerValue);
            if (f.confidence === 'blurry') hint = '该字段识别置信度为部分模糊，优先核对识别是否有误';
            else if (vn.length === 1 && ln.length === 1 && powerOfTenRatio(vn[0], ln[0])) hint = '识别值与台账值相差 10 的整数倍，疑似小数点错位或漏位，优先核对识别是否有误';
            else if (/出厂编号|产品编号|机号|序列号/.test(f.name)) hint = '出厂编号不一致，可能是设备已更换，建议核对是否走过变更流程';
            else if (diffs.length >= 3) hint = '多个字段同时不一致，建议整体核对是否为同一台设备';
            else if (onlyConfusableDiff(f.value, f.ledgerValue)) hint = '识别值与台账值仅差易混字符，优先核对识别是否有误';
            else hint = '需人工核对铭牌原件或出厂资料';
            conflicts.push({
              name: f.name, ledgerColumn: f.ledgerColumn,
              recognized: f.value, ledger: f.ledgerValue,
              confidence: f.confidence, hint,
              possibilities: ['识别错误——重拍铭牌或核对出厂资料后再定', '设备已更换——需走变更流程（moc-change-assistant）并做台账变更记录，而非直接改写'],
            });
          }
          if (snDiff && diffs.length >= 3) {
            warnings.push(`位号 ${tag} 已在台账中，出厂编号与多个参数同时不一致，请重点核对是否为设备已更换；脚本不自动覆盖台账`);
          }
          if (!diffs.length) {
            warnings.push(`位号 ${tag} 已在台账中且各对齐字段与台账现值一致，无须重复录入`);
          } else {
            warnings.push(`位号 ${tag} 已在台账中，有 ${diffs.length} 个字段与台账现值不一致，需用户判断是识别错误还是设备已更换；脚本不自动覆盖台账`);
          }
        }
      }
    }
  } else {
    warnings.push('未提供台账文件（--ledger），未做查重与字段比对——不代表台账中没有该位号');
  }
  // 无台账时，标记台账无对应列的字段（仅按映射表判断）
  if (!a.ledger) {
    for (const f of fields) {
      if (!f.ledgerColumn && f.confidence !== 'unreadable') unmapped.push({ name: f.name, reason: '铭牌字段在标准台账字段中无对应列' });
    }
  }

  // ---- 5. 分类
  const needVerify = fields.filter((f) => f.confidence === 'blurry').map((f) => ({
    name: f.name, value: f.value, reason: f.reason,
    ledgerColumn: f.ledgerColumn, ledgerValue: f.ledgerValue,
    unitCheck: f.unitCheck && f.unitCheck.status !== 'ok' ? f.unitCheck.message : null,
  }));
  const unreadable = fields.filter((f) => f.confidence === 'unreadable').map((f) => ({
    name: f.name, reason: f.reason, ledgerColumn: f.ledgerColumn,
  }));
  const unitIssues = fields.filter((f) => f.unitCheck && f.unitCheck.status !== 'ok').map((f) => ({
    name: f.name, status: f.unitCheck.status, message: f.unitCheck.message,
  }));

  const rawIssues = fields.filter((f) => f.rawMissing || (f.rawCheck && f.rawCheck.status !== 'ok')).map((f) => ({
    name: f.name, status: f.rawMissing ? 'missing' : f.rawCheck.status, message: f.rawMissing ? '未提供铭牌原文 raw，未做量级校验' : f.rawCheck.message,
  }));
  const counts = {
    fields: fields.length,
    clear: fields.filter((f) => f.confidence === 'clear').length,
    blurry: needVerify.length,
    unreadable: unreadable.length,
    conflicts: conflicts === null ? null : conflicts.length,
    unmapped: unmapped.length,
    unitIssues: unitIssues.length,
    rawMissing: fields.filter((f) => f.rawMissing).length,
    rawIssues: rawIssues.length,
    templateMissing: templateMissing.length,
  };

  // ---- 6. 建议录入行：clear 且无冲突的字段才带值
  const conflictNames = new Set((conflicts || []).map((c) => c.name));
  const proposed = fields.map((f) => {
    let v = null, status, note = '';
    if (f.confidence === 'unreadable') { status = '无法辨认'; note = f.reason || '未说明'; }
    else if (conflictNames.has(f.name)) { status = '与台账冲突待判断'; note = `台账现值「${f.ledgerValue}」，识别值「${f.value}」，需用户判断`; }
    else if (f.confidence === 'blurry') { status = '模糊待核对'; note = `识别值「${f.value}」含模糊位，需核对铭牌原件后填写`; }
    else if (f.match === 'same') { v = f.value; status = '与台账一致'; note = '台账已有相同值，无须重复录入'; }
    else {
      v = f.value; status = '建议录入';
      const notes = [];
      if (f.unitCheck && f.unitCheck.status !== 'ok') notes.push(f.unitCheck.message);
      if (f.rawMissing) notes.push('未提供铭牌原文，未做量级校验，录入前须核对原件');
      else if (f.rawCheck && f.rawCheck.status !== 'ok') notes.push(f.rawCheck.message);
      note = notes.join('；');
    }
    return { name: f.name, ledgerColumn: f.ledgerColumn, value: v, status, note };
  });

  // ---- 7. 产出
  C.ensureDir(outDir);
  const result = {
    meta: {
      tag, equipType, photo, ledgerProvided: !!a.ledger, tagExistsInLedger: tagExists,
      ledgerMatchedBy: matchedBy, ledgerTag, ledgerEquipNo,
      ledgerColumns: ledgerCols, generatedAt: C.localDateTime(), declaration: DECLARATION,
      recognitionNote: '识别值由模型读图产生，脚本只做字段对齐、raw 量级校验、单位校验与台账比对，不读图片、不验证识别是否正确',
    },
    counts, fields, needVerify, unreadable, conflicts, unmapped, unitIssues, rawIssues,
    templateMissing, offTemplate, proposed, ledgerRow, warnings,
  };
  fs.writeFileSync(path.join(outDir, 'intake.json'), JSON.stringify(result, null, 2), 'utf8');

  // ---- intake.csv（带 UTF-8 BOM）
  const csvCell = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csvLines = [
    ['位号', '设备类型', '铭牌字段', '台账列名', '识别值', '置信度', '台账现值', '建议录入值', '状态', '冲突/核对说明'].map(csvCell).join(','),
  ];
  for (const p of proposed) {
    const f = fields.find((x) => x.name === p.name);
    csvLines.push([
      tag, equipType, p.name, p.ledgerColumn || '',
      f.value === null ? '' : f.value, CONF_CN[f.confidence],
      f.ledgerValue === null || f.ledgerValue === undefined ? '' : f.ledgerValue,
      p.value === null ? '' : p.value, p.status, p.note,
    ].map(csvCell).join(','));
  }
  csvLines.push('');
  csvLines.push(csvCell(`# ${DECLARATION}`));
  fs.writeFileSync(path.join(outDir, 'intake.csv'), '﻿' + csvLines.join('\r\n'), 'utf8');

  // ---- intake.md
  const L = [];
  L.push(`# ${tag} 铭牌录入建议（${equipType}）`);
  L.push('');
  L.push(`位号：${tag}（由用户提供）　设备类型：${equipType}`);
  L.push(`铭牌照片：${photo || '—（未提供文件名）'}`);
  L.push(`台账文件：${a.ledger ? path.basename(a.ledger) : '—（未提供）'}`);
  L.push(`生成时间：${C.localDateTime()}（北京时间）`);
  L.push('');
  L.push(`> ${DECLARATION}`);
  L.push('');
  L.push('## 一、识别概览');
  L.push('');
  L.push(C.mdTable(['指标', '数量'], [
    ['识别字段数', counts.fields],
    ['清晰可读', counts.clear],
    ['部分模糊需核对', counts.blurry],
    ['无法辨认', counts.unreadable],
    ['与台账差异项', counts.conflicts === null ? '—（未提供台账）' : counts.conflicts],
    ['台账无对应列', counts.unmapped],
    ['单位需核对', counts.unitIssues],
    ['铭牌原文缺失 / 量级需核对', `${counts.rawMissing} / ${counts.rawIssues - counts.rawMissing}`],
  ]));
  if (tagExists === true) L.push(`位号 **${tag}** 已存在于台账中${matchedBy === '设备编号' ? `（按 SAP 设备编号命中，台账位号「${ledgerTag || '—'}」）` : ''}${ledgerEquipNo ? `，台账设备编号「${ledgerEquipNo}」` : ''}，以下比对针对台账现有记录。**脚本不修改台账文件。**\n`);
  else if (tagExists === false) L.push(`位号 **${tag}** 在台账中不存在，按**新增建档**处理。\n`);
  else L.push('未提供台账文件，未做查重与比对——**这不代表台账中没有该位号**。\n');

  L.push('## 二、逐字段识别结果');
  L.push('');
  L.push(C.mdTable(['铭牌字段', '识别值', '置信度', '铭牌单位', '台账列名', '台账现值', '是否一致'],
    fields.map((f) => [
      f.name,
      f.value === null ? '—' : f.value,
      CONF_CN[f.confidence],
      f.unit || '—',
      f.ledgerColumn || '—（台账无对应列）',
      !f.ledgerColumn ? '—' : (f.ledgerValue === null || f.ledgerValue === undefined ? (tagExists ? '—（台账未填）' : '—（台账无此位号）') : f.ledgerValue),
      f.match === 'same' ? '一致' : f.match === 'diff' ? '**不一致**' : f.match === 'ledgerEmpty' ? '台账未填' : f.match === 'unreadable' ? '无法辨认' : '—',
    ])));

  L.push('## 三、需人工核对项');
  L.push('');
  if (!needVerify.length && !unitIssues.length && !rawIssues.length) L.push('_无_\n');
  else {
    if (needVerify.length) {
      L.push('### 3.1 识别模糊（模糊位以 ▢ 占位，未做任何猜测）');
      L.push('');
      L.push(C.mdTable(['铭牌字段', '识别值', '模糊原因', '台账现值'],
        needVerify.map((x) => [x.name, x.value || '—', x.reason || '未说明', x.ledgerValue || '—'])));
    }
    if (unitIssues.length) {
      L.push('### 3.2 单位需核对（脚本只校验不换算）');
      L.push('');
      L.push(C.mdTable(['铭牌字段', '情况', '说明'],
        unitIssues.map((x) => [x.name, x.status === 'missing' ? '未标注单位' : x.status === 'mismatch' ? '与台账口径不一致' : '单位不在换算表内', x.message])));
    }
    if (rawIssues.length) {
      L.push('### 3.3 铭牌原文（raw）量级校验');
      L.push('');
      L.push('识别值由模型读图产生，脚本只能用模型同时抄录的铭牌原文 raw 做量级核对；未提供 raw 的字段未做校验。');
      L.push('');
      L.push(C.mdTable(['铭牌字段', '情况', '说明'],
        rawIssues.map((x) => [x.name, x.status === 'missing' ? '未提供原文' : x.status === 'magnitude' ? '疑似小数点错位' : x.status === 'mismatch' ? '与原文数字不一致' : '原文无数字', x.message])));
    }
  }

  L.push('## 四、无法辨认项');
  L.push('');
  if (!unreadable.length) L.push('_无_\n');
  else {
    L.push('以下字段无法从照片辨认，**未做任何猜测**，需核对铭牌原件或出厂资料后补录：');
    L.push('');
    L.push(C.mdTable(['铭牌字段', '原因', '台账列名'],
      unreadable.map((x) => [x.name, x.reason || '未说明', x.ledgerColumn || '—'])));
  }

  L.push('## 五、与台账的差异项');
  L.push('');
  if (conflicts === null) L.push('_未提供台账文件，未做比对。_\n');
  else if (!conflicts.length) L.push(tagExists ? '_各对齐字段与台账现值一致。_\n' : '_位号在台账中不存在，无差异项。_\n');
  else {
    L.push('**以下字段与台账现值不一致。请逐项判断是「识别错误」还是「设备已更换」——脚本不自动覆盖台账。**');
    L.push('');
    L.push(C.mdTable(['铭牌字段', '台账列名', '识别值', '台账现值', '置信度', '提示'],
      conflicts.map((c) => [c.name, c.ledgerColumn, c.recognized || '—', c.ledger || '—', CONF_CN[c.confidence], c.hint])));
    L.push('两种可能：');
    L.push('');
    L.push('- **识别错误** —— 重拍铭牌或核对出厂资料后再定，台账保持不动。');
    L.push('- **设备已更换** —— 需走变更流程（可接 `moc-change-assistant`）并做台账变更记录，而非直接改写原行。');
    L.push('');
  }

  if (unmapped.length) {
    L.push('### 附：台账无对应列的字段');
    L.push('');
    L.push(C.mdTable(['铭牌字段', '说明'], unmapped.map((x) => [x.name, x.reason])));
  }

  L.push('## 六、建议录入内容（待确认稿）');
  L.push('');
  L.push('**以下仅为待确认稿，须用户逐项确认后方可录入台账。模糊项与冲突项的建议录入值一律留空。**');
  L.push('');
  L.push(C.mdTable(['铭牌字段', '台账列名', '建议录入值', '状态', '说明'],
    proposed.map((p) => [p.name, p.ledgerColumn || '—', p.value === null ? '（留空待确认）' : p.value, p.status, p.note || '—'])));
  L.push('可导入文件：`intake.csv`（UTF-8 带 BOM，Excel 可直接打开）。');
  L.push('');

  L.push('## 七、录入建议说明');
  L.push('');
  L.push('<!-- ANALYSIS_START -->');
  L.push('（由模型依据 references/input-spec.md 口径撰写 150~300 字，结构：识别完整度 → 需核对项与原因 → 与台账差异的判断建议 → 下一步动作。字段数与计数一律引用 intake.json，不得自行统计，不得补充铭牌上没有的参数。）');
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
  L.push(DECLARATION + '。');
  fs.writeFileSync(path.join(outDir, 'intake.md'), L.join('\n'), 'utf8');

  C.emitOk(outDir, { ok: true, out: outDir, tag, equipType, counts, tagExistsInLedger: tagExists, warnings });
}

try { main(); } catch (e) { C.fail(e, warnings); }
