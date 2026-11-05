'use strict';
/**
 * common.js —— 设备员技能包共用工具（仅 Node.js 内置模块）
 * 由各技能 scripts/lib/ 直接复制使用，保持口径一致。
 */
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------- 参数解析
/**
 * parseArgs(argv, VALUE_OPTS, FLAG_OPTS)
 * 值参数缺失、或取值为下一个 --flag 时抛参数错误（规范要求）
 */
function parseArgs(argv, VALUE_OPTS, FLAG_OPTS = []) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) throw new Error(`无法识别的参数「${k}」`);
    const name = k.slice(2);
    if (FLAG_OPTS.includes(name)) { a[name] = true; continue; }
    if (!VALUE_OPTS.includes(name)) throw new Error(`未知参数 --${name}`);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new Error(`参数 --${name} 缺少取值`);
    a[name] = argv[++i];
  }
  return a;
}

// ---------------------------------------------------------------- 北京时间
function bjParts(d = new Date()) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(d).reduce((o, x) => (o[x.type] = x.value, o), {});
}
function localDate(d = new Date()) { const p = bjParts(d); return `${p.year}-${p.month}-${p.day}`; }
function localDateTime(d = new Date()) { const p = bjParts(d); return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`; }

// ---------------------------------------------------------------- 取值与格式
const str = (v) => (v === null || v === undefined ? '' : typeof v === 'boolean' ? (v ? '是' : '否') : String(v).trim());
const round = (v, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? null : Number(v.toFixed(d)));
/** null → "—"，绝不显示为 0 */
const fmt = (v, d = 2) => (v === null || v === undefined ? '—' : typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: d }) : String(v));
const pct = (v, d = 1) => (v === null || v === undefined ? '—' : `${v.toFixed(d)}%`);

/** 带单位数值：剥离常见单位后缀（℃、MPa、mm/s、kW、%、‰、r/min、ppm、μm 等）；返回 {n, unit} 或 null */
const UNIT_RE = /^([+-]?\d+(?:[.,]\d+)?)\s*([a-zA-Zμµ°℃‰%²³/·\u4e00-\u9fa5][\w μµ°℃‰%²³/·\u4e00-\u9fa5-]{0,12})$/;
function stripUnit(s) {
  const m = String(s).trim().match(UNIT_RE);
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  return { n, unit: m[2].trim() };
}
/**
 * 数字解析：空 → null；不可解析且非空 → warning 并返回 null（绝不按 0 计）。
 * 带单位（"78℃" "4.5mm/s" "0.35MPa"）剥离单位取数值，并对每个 sheet/列 只提示一次"已剥离单位，请核对单位一致"。
 * ">0.1" "<5" "≤3" 等带比较符的值不猜测 → null + warning。
 */
function makeNum(warnings) {
  const unitNoted = new Set();
  return function num(v, ctx) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'boolean') {
      if (ctx) warnings.push(`工作表「${ctx.sheet}」第${ctx.row}行 列「${ctx.col}」值「${v ? 'TRUE' : 'FALSE'}」无法解析为数字`);
      return null;
    }
    const s = String(v).trim();
    if (s === '' || s === '—' || s === '-' || s === '/' || s === '无') return null;
    const n = typeof v === 'number' ? v : Number(s.replace(/[,，\s%]/g, ''));
    if (Number.isFinite(n)) return n;
    const u = stripUnit(s);
    if (u) {
      const key = ctx ? `${ctx.sheet}|${ctx.col}` : '';
      if (ctx && !unitNoted.has(key)) {
        unitNoted.add(key);
        warnings.push(`工作表「${ctx.sheet}」列「${ctx.col}」含单位后缀（如「${s}」），已剥离单位「${u.unit}」取数值，请核对该列单位一致`);
      }
      return u.n;
    }
    if (ctx) warnings.push(`工作表「${ctx.sheet}」第${ctx.row}行 列「${ctx.col}」值「${s}」无法解析为数字`);
    return null;
  };
}

// ---------------------------------------------------------------- 日期
/** Excel 日期序列号兜底：20000~80000（1954~2119 年）按墙钟处理 */
function serialToDate(n) {
  const ms = Math.round((n - 25569) * 86400 * 1000);
  const d = new Date(ms);
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d).reduce((o, x) => (o[x.type] = x.value, o), {});
  return `${p.year}-${p.month}-${p.day}`;
}
/** 归一化为 YYYY-MM-DD，无法解析返回 null（不猜测） */
function normDate(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number' && v >= 20000 && v < 80000) return serialToDate(v);
  const s = str(v);
  let m = s.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (!m) m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  // 按日历校验：2 月 30 日、4 月 31 日这类不存在的日期不接受
  if (new Date(Date.UTC(y, mo - 1, d)).getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
/** 归一化日期时间为 YYYY-MM-DD HH:mm，仅日期时返回 YYYY-MM-DD 00:00 */
function normDateTime(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number' && v >= 20000 && v < 80000) {
    const d = serialToDate(v);
    const frac = v % 1;
    const mins = Math.round(frac * 1440);
    return `${d} ${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  }
  const s = str(v);
  const d = normDate(s);
  if (!d) return null;
  const t = s.match(/(\d{1,2}):(\d{2})/);
  return t ? `${d} ${t[1].padStart(2, '0')}:${t[2]}` : `${d} 00:00`;
}
const dayMs = 86400000;
/** 日期差（天），a - b；任一无法解析返回 null */
function diffDays(a, b) {
  const da = normDate(a), db = normDate(b);
  if (!da || !db) return null;
  return Math.round((Date.parse(da + 'T00:00:00Z') - Date.parse(db + 'T00:00:00Z')) / dayMs);
}
/** 日期加天数 */
function addDays(d, n) {
  const dd = normDate(d);
  if (dd === null || !Number.isFinite(n)) return null;
  return new Date(Date.parse(dd + 'T00:00:00Z') + n * dayMs).toISOString().slice(0, 10);
}
/** 中文数字 → 阿拉伯数字（一~十、半），其余返回原串 */
const CN_NUM = { '一': 1, '两': 2, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10, '半': 0.5 };
function cnNum(t) {
  if (/^\d+(\.\d+)?$/.test(t)) return +t;
  if (t in CN_NUM) return CN_NUM[t];
  const m = t.match(/^十([一二三四五六七八九])$/);
  if (m) return 10 + CN_NUM[m[1]];
  return null;
}
/** 每班按 8 小时计（三班两运转的 12 小时班取较严的 8 小时，与"不按最宽松默认"一致） */
const SHIFT_HOURS = 8;
/**
 * 解析周期表达式（日历周期）→ 天数（可为小数，<1 天表示班次/小时级周期）；无法解析 null。
 * 支持：30d / 3m / 1y / 30天 / 3个月 / 1年 / 半年 / 半月 / 每天 / 每周 / 每月 / 每季 / 每年 /
 *       每班 / 每2小时 / 2h / 一周 / 两年 / 纯数字(按天)。
 * 不解析运行小时（"2000h"、"运行2000小时"）：小时数 >168 视为运行小时，交给 parseRunHours → 返回 null。
 */
function parsePeriod(v) {
  const d = parsePeriodDetail(v);
  return d ? d.days : null;
}
/** 周期解析明细：{ days, hours, unit, raw }；运行小时 → null */
function parsePeriodDetail(v) {
  if (v === null || v === undefined || v === '') return null;
  const raw = str(v);
  let s = raw.replace(/\s/g, '').replace(/^每/, '').replace(/一次$/, '').replace(/^隔/, '');
  if (s === '') return null;
  if (/^(班|班次|每班)$/.test(s)) return { days: SHIFT_HOURS / 24, hours: SHIFT_HOURS, unit: '班', raw };
  if (/^(天|日|每日|每天)$/.test(s)) return { days: 1, hours: 24, unit: '天', raw };
  if (/^(周|星期|每周)$/.test(s)) return { days: 7, hours: 168, unit: '周', raw };
  if (/^(月|个月|每月)$/.test(s)) return { days: 30, hours: 720, unit: '月', raw };
  if (/^(季|季度|每季)$/.test(s)) return { days: 90, hours: 2160, unit: '季', raw };
  if (/^(年|每年)$/.test(s)) return { days: 365, hours: 8760, unit: '年', raw };
  if (/^半年$/.test(s)) return { days: 182, hours: 182 * 24, unit: '半年', raw };
  if (/^半月$/.test(s)) return { days: 15, hours: 360, unit: '半月', raw };
  const m = s.match(/^(\d+(?:\.\d+)?|[一两二三四五六七八九十]+|半)(个)?(h|H|小时|时|hr|班|d|天|日|w|W|周|星期|m|M|月|q|Q|季|季度|y|Y|年)$/);
  if (m) {
    const n = cnNum(m[1]);
    if (n === null) return null;
    const u = m[3];
    if (/^(h|H|小时|时|hr)$/.test(u)) {
      if (n > 168) return null;                       // 运行小时，不是日历周期
      return { days: n / 24, hours: n, unit: '小时', raw };
    }
    if (u === '班') return { days: n * SHIFT_HOURS / 24, hours: n * SHIFT_HOURS, unit: '班', raw };
    if (/^(d|天|日)$/.test(u)) return { days: n, hours: n * 24, unit: '天', raw };
    if (/^(w|W|周|星期)$/.test(u)) return { days: n * 7, hours: n * 168, unit: '周', raw };
    if (/^(m|M|月)$/.test(u)) return { days: Math.round(n * 30), hours: Math.round(n * 30) * 24, unit: '月', raw };
    if (/^(q|Q|季|季度)$/.test(u)) return { days: Math.round(n * 90), hours: Math.round(n * 90) * 24, unit: '季', raw };
    if (/^(y|Y|年)$/.test(u)) return { days: Math.round(n * 365), hours: Math.round(n * 365) * 24, unit: '年', raw };
  }
  if (/^\d+(\.\d+)?$/.test(s)) return { days: Math.round(+s), hours: Math.round(+s) * 24, unit: '天', raw };
  return null;
}
/** 运行小时周期："2000h" / "运行2000小时" / "2000小时" / "2000H" → 小时数；日历周期或无法解析 → null */
function parseRunHours(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = str(v).replace(/\s/g, '').replace(/^(运行|累计|每运行|每累计)/, '');
  const m = s.match(/^(\d+(?:\.\d+)?)(h|H|hr|小时|时|运行小时)$/);
  if (!m) return null;
  const n = +m[1];
  return n > 168 ? n : null;
}
/** 周期（天）→ 人读文本："每班(8小时)" / "每2小时" / "每30天" */
function fmtPeriod(days) {
  if (days === null || days === undefined || !Number.isFinite(days)) return '—';
  if (days >= 1) return `每${Math.round(days)}天`;
  const h = Math.round(days * 24 * 10) / 10;
  return h === SHIFT_HOURS ? `每班(${SHIFT_HOURS}小时)` : `每${h}小时`;
}
/** 日期加自然月（用于定检/校验到期：1 年 = 12 个月而非 365 天）；月末溢出取该月最后一天 */
function addMonths(d, n) {
  const dd = normDate(d);
  if (dd === null || !Number.isFinite(n)) return null;
  const [y, m, day] = dd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(day, last));
  return t.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- 中石化体系系统列名（共享别名表）
/**
 * SYSTEM_ALIASES —— 中石化炼化厂常用系统（SAP PM/MM、EM 设备管理信息系统、作业许可系统、特种设备台账、智能巡检/点检仪）导出列名。
 * 口径见顶层《中石化口径对照.md》第二节。各技能用 mergeAliases(局部别名) 合并，局部优先。
 * 注意：「设备编号」在 SAP 中是流水号，不是位号；「数量」过宽不作共享别名。
 */
const SYSTEM_ALIASES = {
  '位号': ['位号', '设备位号', '位号编码', '功能位置', '功能位置编号', '技术标识', '技术对象', '技术对象标识', 'TAG', 'Tag', 'tag'],
  '设备编号': ['设备编号', '设备', '设备号', '设备编码', '技术对象编号', 'EM编码'],
  '设备名称': ['设备名称', '设备描述', '技术对象描述', '功能位置描述', '名称', '描述'],
  '设备类别': ['设备类别', '设备类型', '对象类型', '设备分类', '专业类别', '设备品种'],
  // 「特护」是单独的标记（是/否），不是重要度 A/B/C 的别名；需要特护的技能在局部别名里单独声明
  '重要度': ['重要度', '设备分级', '设备等级', 'ABC标识', 'ABC', '关键等级', '重要程度'],
  '制造厂': ['制造厂', '制造商', '生产厂家', '厂家', '制造单位'],
  '规格型号': ['规格型号', '型号', '型号编号', '规格', '技术参数'],
  '出厂编号': ['出厂编号', '制造商序列号', '序列号', '出厂编码', '产品编号'],
  '投用日期': ['投用日期', '开始日期', '启用日期', '投运日期', '建造年份'],
  '装置': ['装置', '工厂区段', '单元', '装置名称', '生产单元'],
  '车间': ['车间', '维护工厂', '属地单位', '使用单位', '运行部', '作业部'],
  '成本中心': ['成本中心', '成本中心编码'],
  '工作中心': ['工作中心', '主工作中心', '维修班组', '承修单位'],
  '通知单号': ['通知单号', '通知单', '维修通知单号', '通知单编号', '通知'],
  '通知单类型': ['通知单类型', '通知类型', '通知单类别'],
  '工单号': ['工单号', '工单编号', '订单', '订单号', '工单', 'PM订单', '维修订单号'],
  '工单类型': ['工单类型', '订单类型', '维修类型', '工单类别'],
  '优先级': ['优先级', '紧急程度', '紧急度'],
  '状态': ['状态', '系统状态', '用户状态', '工单状态', '通知单状态', '处理状态', '当前状态'],
  '计划开始': ['计划开始', '基本开始日期', '计划开始日期', '要求开始', '计划开工'],
  '计划完成': ['计划完成', '基本结束日期', '计划结束日期', '要求结束', '计划完工', '要求完成日期'],
  '实际完成': ['实际完成', '实际结束日期', '实际完工', '技术完成日期', '完工日期'],
  '故障代码': ['故障代码', '损坏代码', '损坏', '故障现象代码', '原因代码'],
  '故障部位': ['故障部位', '损坏部位', '对象部件', '对象部件文本', '缺陷部位'],
  '物料编码': ['物料编码', '物料', '物料号', '物料编号', '物资编码', '备件编码'],
  '物料描述': ['物料描述', '物料名称', '备件名称', '物资名称'],
  '计量单位': ['计量单位', '基本计量单位', '单位'],
  '库存数量': ['库存数量', '非限制使用库存', '非限制库存', '可用库存', '现有量', '库存'],
  '库存地点': ['库存地点', '库位', '仓库', '存放地点'],
  '安全库存': ['安全库存', '再订货点', '储备定额', '最低库存'],
  '过账日期': ['过账日期', '凭证日期', '出库日期', '领用日期'],
  '移动类型': ['移动类型', '业务类型'],
  '金额': ['金额', '本位币金额', '本币金额'],
  '许可证编号': ['许可证编号', '作业票编号', '作业许可证编号', '票号', '许可证号'],
  '作业类别': ['作业类别', '作业类型', '许可类别', '作业种类'],
  '作业级别': ['作业级别', '作业等级', '动火级别', '用火级别', '高处等级', '吊装等级'],
  '作业地点': ['作业地点', '作业区域', '作业位置', '作业部位'],
  '属地监护人': ['属地监护人', '属地监护', '车间监护人'],
  '作业单位监护人': ['作业单位监护人', '作业监护人', '施工监护人', '承包商监护人'],
  '作业负责人': ['作业负责人', '施工负责人', '现场负责人'],
  '作业单位': ['作业单位', '施工单位', '承包商', '承修单位', '作业单位名称'],
  '承包商编码': ['承包商编码', '供应商编码', '供应商', '承包商代码'],
  '设备代码': ['设备代码', '特种设备代码', '注册代码', '注册编号'],
  '使用登记证编号': ['使用登记证编号', '使用登记证', '登记证编号', '使用证号'],
  '检验机构': ['检验机构', '检验单位', '检测机构', '检验检测机构'],
  '检验类型': ['检验类型', '检验类别', '检验种类', '检验项目'],
  '安全状况等级': ['安全状况等级', '安全等级', '安全状况'],
  '检查项': ['检查项', '检查内容', '点检项目', '检查项目', '巡检项'],
  '测值': ['测值', '测量值', '实测值', '读数'],
  '是否报警': ['是否报警', '报警标志', '报警', '超限', '是否超限', '告警'],
  '测点号': ['测点号', '仪表位号', '测点', '点号'],
};
/** 合并别名：局部别名在前（优先），再追加共享别名中未出现的项 */
function mergeAliases(local = {}, system = SYSTEM_ALIASES) {
  const out = {};
  const keys = new Set([...Object.keys(local), ...Object.keys(system)]);
  for (const k of keys) {
    const seen = new Set();
    out[k] = [].concat(local[k] || [], system[k] || []).filter((x) => (seen.has(x) ? false : (seen.add(x), true)));
  }
  return out;
}
/**
 * SAP PM 工单/通知单状态 → 技能内六态（口径见《中石化口径对照.md》第四节）。
 * 返回 null 表示无法映射（调用方按 unknownStatus 单列，不得默认）。
 * 判定顺序：先否定前缀（未/待/不/非）→ 再闭环词；"已完成/完工/技术完成"归 待验收 而非闭环。
 */
const SAP_STATUS = {
  '待审核': ['CRTD', 'OSNO', '已创建', '未处理', '待审核', '待审批', '待批', '待审', '新建', '已登记'],
  '已派工': ['REL', 'NOPR', '已下达', '处理中', '已派工', '已派单', '待施工', '已下发', '已接单'],
  '施工中': ['PCNF', '部分确认', '施工中', '在修', '检修中', '维修中', '处理中(施工)', '进行中'],
  '待验收': ['TECO', 'CNF', '技术完成', '已确认', '待验收', '已完工', '完工', '已完成', '完工待验'],
  '已闭环': ['CLSD', 'NOCO', '业务完成', '已关闭', '关闭', '已闭环', '闭环', '已验收', '已消缺', '已完成(关闭)'],
  '已取消': ['DLFL', 'LKD', '删除标记', '已锁定', '已取消', '取消', '作废', '已作废'],
};
function normSapStatus(v) {
  const s = str(v);
  if (!s) return null;
  const up = s.toUpperCase();
  for (const [k, list] of Object.entries(SAP_STATUS)) {
    if (list.some((x) => up === x.toUpperCase())) return k;
  }
  if (/^(未|待|不|非)/.test(s)) {
    if (/验收/.test(s)) return '待验收';
    if (/审/.test(s)) return '待审核';
    if (/派|下达|施工|处理|开工/.test(s)) return '已派工';
    return null;
  }
  for (const [k, list] of Object.entries(SAP_STATUS)) {
    if (list.some((x) => /[\u4e00-\u9fa5]/.test(x) && s.includes(x))) return k;
  }
  return null;
}
/**
 * 结果/状态归一（巡检点检口径）：先整词匹配否定/正常集合，再匹配异常集合；"无异常/未见异常/无泄漏/Running/OK" 为正常。
 * 返回 'normal' | 'abnormal' | 'unknown' | null(空)
 */
const RESULT_NORMAL = ['正常', '良好', '合格', '完好', '无异常', '未见异常', '无泄漏', '未发现异常', '无问题', '未见漏', '无漏', 'OK', 'ok', 'Ok', '√', '✓', '运行正常', 'running', 'Running', 'RUNNING', '正常运行'];
const RESULT_ABNORMAL = ['异常', '不正常', '故障', '缺陷', '不合格', '超标', '报警', '泄漏', '泄露', '有问题', '偏高', '偏低', '异响', '振动大', '漏', 'NG'];
function classifyResult(v) {
  const s = str(v);
  if (s === '') return null;
  const norm = s.replace(/\s/g, '');
  if (RESULT_NORMAL.some((k) => norm === k)) return 'normal';
  if (/^(无|未见|未发现|没有|不)[^。；;]*(异常|泄漏|泄露|问题|报警|超标|故障|缺陷|漏)$/.test(norm)) return 'normal';
  if (RESULT_ABNORMAL.some((k) => (k === 'NG' ? /(^|[^a-zA-Z])NG([^a-zA-Z]|$)/i.test(norm) : norm.includes(k)))) return 'abnormal';
  if (RESULT_NORMAL.some((k) => norm.includes(k))) return 'normal';
  return 'unknown';
}

// ---------------------------------------------------------------- 表头与记录
/**
 * 列名匹配。两轮：先全等，再前缀。
 * `taken` 传入已被其他列占用的下标集合，避免「阈值」抢走「阈值类型」这类前缀冲突。
 */
function findCol(header, name, aliases = {}, taken = null) {
  const list = aliases[name] || [name];
  const free = (j) => j >= 0 && (!taken || !taken.has(j));
  // 第一轮：全等优先（最精确）
  for (const al of list) {
    const j = header.findIndex((x, i) => x === al && free(i));
    if (free(j)) return j;
  }
  // 第二轮：前缀匹配
  for (const al of list) {
    const j = header.findIndex((x, i) => x && x.startsWith(al) && free(i));
    if (free(j)) return j;
  }
  return -1;
}
/**
 * toRecords(rows, required, sheetName, optional, warnings, aliases)
 * 表头行 = 前 10 行中命中必需列最多的一行；跳过 合计/小计/总计 行并 warning
 */
function toRecords(rows, required, sheetName, optional = [], warnings = [], aliases = {}) {
  if (!rows || !rows.length) { warnings.push(`缺少工作表「${sheetName}」`); const e = []; e.hasCol = () => false; return e; }
  const norm = (r) => (r || []).map((c) => str(c).replace(/\s+/g, ''));
  let h = -1, best = 0;
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const hdr = norm(rows[i]);
    const hits = required.filter((r) => findCol(hdr, r, aliases) >= 0).length;
    if (hits > best) { best = hits; h = i; }
  }
  if (h < 0) { h = 0; while (h < rows.length && !(rows[h] || []).some((c) => str(c))) h++; }
  const header = norm(rows[h]);
  const cols = {};
  // 两轮分配，避免前缀冲突：
  //   轮1 所有列名先做「全等」匹配（最精确，谁都抢不走）
  //   轮2 剩余列名再做「前缀」匹配，且不得占用轮1已认领的下标
  // 若只按声明顺序单轮分配，先声明的「作业类别」（别名含「类别」）会用前缀
  // 抢走本该属于「项目代号」的列，后者反而落空。
  const names = required.concat(optional);
  const taken = new Set();
  for (const name of names) cols[name] = -1;
  for (const name of names) {
    const list = aliases[name] || [name];
    for (const al of list) {
      const j = header.findIndex((x, i) => x === al && !taken.has(i));
      if (j >= 0) { cols[name] = j; taken.add(j); break; }
    }
  }
  for (const name of names) {
    if (cols[name] >= 0) continue;
    const list = aliases[name] || [name];
    for (const al of list) {
      const j = header.findIndex((x, i) => x && x.startsWith(al) && !taken.has(i));
      if (j >= 0) { cols[name] = j; taken.add(j); break; }
    }
  }
  const missing = required.filter((r) => cols[r] < 0);
  if (missing.length) warnings.push(`工作表「${sheetName}」缺少列: ${missing.join('、')}（实际表头: ${header.filter(Boolean).join(' | ') || '空'}）`);
  const recs = [];
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    if (!r.some((c) => str(c))) continue;
    const first = str(r[0]);
    if (/^(合计|小计|总计|共计|合计:|总数)/.test(first)) { warnings.push(`工作表「${sheetName}」第${i + 1}行为合计行，已跳过`); continue; }
    const o = { _row: i + 1, _sheet: sheetName };
    for (const name of required.concat(optional)) { const j = cols[name]; o[name] = j >= 0 ? (r[j] === undefined ? null : r[j]) : null; }
    recs.push(o);
  }
  recs.hasCol = (name) => cols[name] >= 0;
  recs.colName = (name) => (cols[name] >= 0 ? header[cols[name]] : null);   // 实际命中的表头（别名）
  return recs;
}

// ---------------------------------------------------------------- 车间范围核对（D007）
/** 认作车间的列名（表头以这些开头）；维护工厂/计划工厂是 SAP 工厂代码，责任单位/作业单位可能是部门或承包商，都不认 */
const WORKSHOP_COLS = ['车间', '所属车间', '属地车间', '运行部'];
const normWorkshop = (v) => str(v).replace(/\s+/g, '').replace(/(车间|运行部)$/, '');
/** 两个车间名是否同一车间（去空白，忽略末尾「车间/运行部」）；任一为空返回 false */
function sameWorkshop(a, b) {
  const x = normWorkshop(a), y = normWorkshop(b);
  return !!x && !!y && x === y;
}
/**
 * 按 --workshop 核对一张表的车间列。recs 为 toRecords 结果，optional 里须含「车间」。
 * - 未给 workshop：不核对（noWorkshop）
 * - 没有车间列（或命中的是维护工厂等非车间列）：不筛（noColumn）
 * - 有车间列且至少一行是本车间：剔除其他车间的行（checked）；车间为空的行按本车间保留
 * - 有车间列但没有一行是本车间：不筛，warning 带【注意】（mismatch），多半是传错了文件
 * 返回 { records, scope }；records 保留 hasCol / colName
 */
function workshopScope(recs, workshop, sheetName, warnings = []) {
  const scope = { sheet: sheetName, status: 'noColumn', column: null, total: recs.length, kept: recs.length, dropped: {}, droppedRows: 0, blank: 0 };
  const keep = (list) => { list.hasCol = recs.hasCol; list.colName = recs.colName; return list; };
  if (!str(workshop)) { scope.status = 'noWorkshop'; return { records: recs, scope }; }
  const col = recs.hasCol && recs.hasCol('车间') && recs.colName ? recs.colName('车间') : null;
  if (!col || !WORKSHOP_COLS.some((c) => col.startsWith(c))) {
    if (col) scope.ignoredColumn = col;
    return { records: recs, scope };
  }
  scope.column = col;
  const mine = [], blank = [], other = new Map();
  for (const r of recs) {
    const v = str(r['车间']);
    if (!v) blank.push(r);
    else if (sameWorkshop(v, workshop)) mine.push(r);
    else other.set(v, (other.get(v) || 0) + 1);
  }
  scope.blank = blank.length;
  if (!mine.length && other.size) {
    scope.status = 'mismatch';
    scope.values = [...other.keys()].slice(0, 5);
    warnings.push(`【注意】工作表「${sheetName}」车间列「${col}」的取值（${scope.values.join('、')}${other.size > 5 ? ' 等' : ''}）与 --workshop「${workshop}」都不一致，未按车间筛选，请核对输入（多半是传错了文件）`);
    return { records: recs, scope };
  }
  scope.status = 'checked';
  const out = recs.filter((r) => !str(r['车间']) || sameWorkshop(r['车间'], workshop));
  scope.kept = out.length;
  scope.dropped = Object.fromEntries(other);
  scope.droppedRows = recs.length - out.length;
  if (scope.droppedRows) warnings.push(`工作表「${sheetName}」按 --workshop「${workshop}」剔除其他车间 ${scope.droppedRows} 行（${[...other].map(([k, n]) => `${k} ${n} 行`).join('、')}），不计入本车间`);
  if (blank.length) warnings.push(`工作表「${sheetName}」车间列为空 ${blank.length} 行，按本车间保留`);
  return { records: keep(out), scope };
}
/**
 * 多张表的核对结果合成报告口径行与开头提示：{ note, alert }
 * note 写在报告口径处；alert 非空时写在报告开头（【注意】）
 */
function workshopScopeNote(scopes, workshop) {
  const list = (scopes || []).filter((s) => s && s.status !== 'noWorkshop');
  if (!str(workshop) || !list.length) return { note: null, alert: null };
  const mis = list.filter((s) => s.status === 'mismatch');
  const chk = list.filter((s) => s.status === 'checked');
  const none = list.filter((s) => s.status === 'noColumn');
  const parts = [];
  if (chk.length) {
    const dropped = chk.filter((s) => s.droppedRows);
    parts.push(dropped.length
      ? `已按车间列核对「${workshop}」，剔除其他车间的行：${dropped.map((s) => `「${s.sheet}」${s.droppedRows} 行（${Object.entries(s.dropped).map(([k, n]) => `${k} ${n} 行`).join('、')}）`).join('；')}`
      : `已按车间列核对「${workshop}」（${chk.map((s) => `「${s.sheet}」`).join('、')}），未发现其他车间的行`);
  }
  if (mis.length) parts.push(`${mis.map((s) => `「${s.sheet}」`).join('、')}的车间列取值与 --workshop 不一致，未按车间筛选`);
  if (none.length) parts.push(`${chk.length || mis.length ? `${none.map((s) => `「${s.sheet}」`).join('、')}` : '输入'}未含车间列，车间范围以取数条件为准`);
  return {
    note: `车间范围：${parts.join('；')}。`,
    alert: mis.length ? `【注意】${mis.map((s) => `工作表「${s.sheet}」`).join('、')}的车间列取值与 --workshop「${workshop}」不一致，未按车间筛选，请核对输入。` : null,
  };
}
/** sheet 名匹配：去空白与"表"字后包含匹配 */
function pickSheet(book, ...names) {
  const norm = (s) => String(s).replace(/[\s表]/g, '');
  const keys = Object.keys(book);
  for (const n of names) {
    const target = norm(n);
    let k = keys.find((x) => norm(x) === target);
    if (k) return book[k];
    k = keys.find((x) => norm(x).includes(target) || target.includes(norm(x)));
    if (k) return book[k];
  }
  return null;
}

// ---------------------------------------------------------------- 输出
function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); }
/** 成功：末行打印 JSON 摘要，同时写 <out>/summary.json */
function emitOk(outDir, summary) {
  ensureDir(outDir);
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  console.log(JSON.stringify(summary));
}
/** 失败：末行输出 {ok:false,error,warnings} 并 exit 1 */
function fail(error, warnings = []) {
  console.log(JSON.stringify({ ok: false, error: String(error && error.message || error), warnings }));
  process.exit(1);
}
/** Markdown 表格 */
function mdTable(headers, rows) {
  if (!rows.length) return '_无_\n';
  const esc = (v) => String(v === null || v === undefined ? '—' : v).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  return `| ${headers.join(' | ')} |\n|${headers.map(() => '---').join('|')}|\n`
    + rows.map((r) => `| ${r.map(esc).join(' | ')} |`).join('\n') + '\n';
}

module.exports = {
  parseArgs, bjParts, localDate, localDateTime,
  str, round, fmt, pct, makeNum,
  serialToDate, normDate, normDateTime, diffDays, addDays, addMonths,
  parsePeriod, parsePeriodDetail, parseRunHours, fmtPeriod, stripUnit,
  SYSTEM_ALIASES, mergeAliases, SAP_STATUS, normSapStatus,
  RESULT_NORMAL, RESULT_ABNORMAL, classifyResult,
  findCol, toRecords, pickSheet,
  WORKSHOP_COLS, sameWorkshop, workshopScope, workshopScopeNote,
  ensureDir, emitOk, fail, mdTable,
};
