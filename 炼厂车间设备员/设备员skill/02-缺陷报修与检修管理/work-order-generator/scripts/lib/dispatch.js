'use strict';
/**
 * 维修通知单草稿规则引擎（专业归口建议 / SAP 优先级 / 通知单类型）
 * 口径见 references/dispatch-rules.md 与顶层《中石化口径对照.md》。
 * 核心原则：
 *   1. 车间设备员创建的是 SAP **维修通知单**；工单（订单）、工时定额、备件由计划员/承修单位编制，本引擎不给工时与备件数值。
 *   2. 专业归口只是建议值，需车间与承修单位确认，脚本不代替派工决策。
 *   3. 判定所依赖的字段缺失时一律 undetermined，绝不按最省事或最保守默认。
 *   4. 设备规格型号等台账字段一律从台账读，查不到就留空标「待补充」，绝不由现象或设备名反推。
 */

// ---------------------------------------------------------------- 现象分类（与 defect-intake-grading 同口径）
const PHEN_PATTERNS = [
  ['leak', /泄漏|渗漏|滴漏|漏油|漏气|漏水|漏料|冒油|喷漏|外漏|窜漏|内漏/],
  ['vibration', /振动|震动|抖动|摆动/],
  ['noise', /异响|异音|噪音|响声|杂音|敲击声|摩擦声/],
  ['temperature', /温度高|温升|过热|发烫|高温|超温|温度异常/],
  ['corrosion', /腐蚀|锈蚀|生锈|减薄|点蚀|冲刷/],
  ['deformation', /变形|开裂|裂纹|裂缝|鼓包|凹陷|断裂/],
  ['failure', /失效|损坏|故障|不动作|拒动|卡涩|卡死|不好用|失灵/],
  ['performance', /效率|出力|流量不足|压力不足|打不上量|抽空|汽蚀/],
  ['electrical', /绝缘|接地|短路|跳闸|电流|电压|发热.*电机/],
  ['instrument', /指示不准|示值|偏差|信号|显示异常|无显示|飘移/],
];
const PHEN_CN = {
  leak: '泄漏', vibration: '振动', noise: '异响', temperature: '温升',
  corrosion: '腐蚀', deformation: '变形开裂', failure: '失效', performance: '性能下降',
  electrical: '电气异常', instrument: '仪表异常', other: '其他',
};
/** 现象类型 → SAP 通知单「损坏/故障代码」建议文本（厂内目录代码由设备员对照填写） */
const PHEN_SAP_CODE = {
  leak: '泄漏', vibration: '振动超标', noise: '异响', temperature: '温度异常',
  corrosion: '腐蚀减薄', deformation: '变形开裂', failure: '功能失效', performance: '性能下降',
  electrical: '电气故障', instrument: '仪表故障', other: '',
};
function classifyPhenomenon(desc) {
  const s = String(desc || '');
  for (const [k, re] of PHEN_PATTERNS) if (re.test(s)) return k;
  return 'other';
}

// ---------------------------------------------------------------- 专业归口建议
const DISCIPLINES = ['动设备', '静设备', '电气', '仪表'];
/**
 * 专业归口：优先用台账「专业」列的实际值，其次按位号前缀与设备名判定。
 * 判定顺序先特殊后一般，避免前缀互抢：
 *  1. 电机 / EM- / M- → 电气（先于"泵"，否则"循环水泵电机"被抢成动设备）
 *  2. 安全阀 / 疏水阀 / 爆破片 / 阻火器 → 静设备（安全附件，不归仪表）
 *  3. 仪表 / 调节阀 / 变送器 / I- FT PT TT LT FIC PIC TIC LIC → 仪表
 *  4. 泵 / 压缩机 / 风机 / 机组 / 汽轮机 / P- K- → 动设备
 *  5. 换热器 / 容器 / 塔 / 管道 / 阀门 / E- V- C- T- D- R- F- → 静设备（T- 只归静设备，仪表温度位号是 TT-/TI-）
 * 无法归属时返回 '待定'，由设备员确认，不强塞到动设备。
 */
function disciplineOf(tag, name, ledgerDiscipline) {
  const ld = String(ledgerDiscipline || '').trim();
  if (ld) {
    for (const d of DISCIPLINES) if (ld.includes(d)) return d;
    if (/机械|转动|机泵/.test(ld)) return '动设备';
    if (/容器|管道|静止/.test(ld)) return '静设备';
    return ld;
  }
  const s = `${tag || ''} ${name || ''}`;
  if (/^(EM|M)-|电机|电动机|变频|配电|开关柜|电缆|变压器|电气/.test(s)) return '电气';
  if (/安全阀|疏水阀|爆破片|阻火器|呼吸阀/.test(s)) return '静设备';
  if (/^(I|FT|PT|TT|LT|TI|PI|FI|LI|FIC|PIC|TIC|LIC|AT)-|仪表|变送器|调节阀|流量计|分析仪|报警器|液位计|压力表|热电偶/.test(s)) return '仪表';
  if (/^(P|K|GB|J|B)-|泵|压缩机|风机|机组|汽轮机|搅拌/.test(s)) return '动设备';
  if (/^(E|V|C|T|D|R|F)-|换热器|冷却器|再沸器|空冷|罐|容器|塔|管道|管线|阀门|加热炉|反应器/.test(s)) return '静设备';
  return '待定';
}

// ---------------------------------------------------------------- SAP 优先级
/** SAP PM 通知单优先级：1 非常高 / 2 高 / 3 中 / 4 低；报告同时显示数字与中文 */
const PRIORITY_CN = { 1: '1 非常高', 2: '2 高', 3: '3 中', 4: '4 低' };
const PRIORITY_KEYS = [1, 2, 3, 4];
/** 缺陷等级 → SAP 优先级默认映射（A/B/C 三级为主口径，I~IV 旧四级兼容） */
const LEVEL_TO_PRIORITY = { A: 1, B: 2, C: 3, I: 1, II: 2, III: 3, IV: 4 };

/** 把用户写法归一化为 SAP 优先级 1~4；无法识别返回 null（不默认为 3 中） */
function parsePriority(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  if (/^(1|非常高|紧急|特急|urgent|very\s*high|U|1级|一级)$/i.test(s)) return 1;
  if (/^(2|高|较高|high|H|2级|二级)$/i.test(s)) return 2;
  if (/^(3|中|一般|中等|medium|M|3级|三级)$/i.test(s)) return 3;
  if (/^(4|低|轻微|low|L|4级|四级)$/i.test(s)) return 4;
  return null;
}

/** 缺陷等级文本（'A' / 'A 级（重大）' / 'I 级（紧急）' / 'II'）→ 等级键；识别不了返回 null */
function parseLevel(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  if (/未判定|undetermined/i.test(s)) return null;
  if (/^A\b|^A级|^A\s*级|重大/.test(s)) return 'A';
  if (/^B\b|^B级|^B\s*级/.test(s)) return 'B';
  if (/^C\b|^C级|^C\s*级/.test(s)) return 'C';
  if (/^IV\b|^IV级|^IV\s*级|四级|轻微/.test(s)) return 'IV';
  if (/^III\b|^III级|^III\s*级|三级/.test(s)) return 'III';
  if (/^II\b|^II级|^II\s*级|二级/.test(s)) return 'II';
  if (/^I\b|^I级|^I\s*级|一级|紧急/.test(s)) return 'I';
  if (/严重/.test(s)) return 'B';
  if (/一般/.test(s)) return 'C';
  return null;
}

/**
 * decidePriority({explicit, defectLevel})
 * 返回 {priority(1~4|null), priorityCn, source, ruleId, undetermined, missing}
 * - 用户显式指定 → 以用户为准（source='用户指定'）
 * - 否则按缺陷等级映射（source='按缺陷等级默认口径'）
 * - 两者都没有 → undetermined，绝不默认为「3 中」
 */
function decidePriority({ explicit, defectLevel }) {
  const p = parsePriority(explicit);
  if (p) return { priority: p, priorityCn: PRIORITY_CN[p], source: '用户指定', ruleId: 'P0', undetermined: false, missing: [] };
  if (explicit) {
    return { priority: null, priorityCn: '未判定', source: null, ruleId: 'PU2', undetermined: true, missing: [`优先级「${explicit}」无法识别（可写 1~4 或 非常高/高/中/低）`] };
  }
  const lv = parseLevel(defectLevel);
  if (lv) {
    const k = LEVEL_TO_PRIORITY[lv];
    return { priority: k, priorityCn: PRIORITY_CN[k], source: `按缺陷等级 ${lv} 默认口径`, ruleId: 'P' + lv, undetermined: false, missing: [] };
  }
  return { priority: null, priorityCn: '未判定', source: null, ruleId: 'PU1', undetermined: true, missing: ['优先级或缺陷等级'] };
}

// ---------------------------------------------------------------- 通知单类型
const NOTIF_TYPE_CN = { M1: 'M1 维修申请', M2: 'M2 故障报告', M3: 'M3 活动报告' };
/** 用户写法 → M1/M2/M3；无法识别返回 null */
function parseNotifType(v) {
  const s = String(v || '').trim().toUpperCase();
  if (!s) return null;
  if (/^M[123]$/.test(s)) return s;
  if (/维修申请/.test(s)) return 'M1';
  if (/故障报告|故障/.test(s)) return 'M2';
  if (/活动报告/.test(s)) return 'M3';
  return null;
}
/**
 * decideNotifType({explicit, priority})：
 * - 用户显式指定 → 以用户为准
 * - 否则按优先级：1/2 → M2 故障报告；3/4 → M1 维修申请；优先级未判定 → null（待确认）
 * 厂内可配置（有的厂 M1/M2 定义相反），README 已注明。
 */
function decideNotifType({ explicit, priority }) {
  const t = parseNotifType(explicit);
  if (t) return { type: t, typeCn: NOTIF_TYPE_CN[t], source: '用户指定', undetermined: false };
  if (explicit) return { type: null, typeCn: '未判定', source: null, undetermined: true, reason: `通知单类型「${explicit}」无法识别（可写 M1/M2/M3）` };
  if (priority === 1 || priority === 2) return { type: 'M2', typeCn: NOTIF_TYPE_CN.M2, source: '按优先级默认口径（1/2→M2）', undetermined: false };
  if (priority === 3 || priority === 4) return { type: 'M1', typeCn: NOTIF_TYPE_CN.M1, source: '按优先级默认口径（3/4→M1）', undetermined: false };
  return { type: null, typeCn: '未判定', source: null, undetermined: true, reason: '优先级未判定，无法推通知单类型' };
}

module.exports = {
  classifyPhenomenon, PHEN_CN, PHEN_PATTERNS, PHEN_SAP_CODE,
  disciplineOf, DISCIPLINES,
  parsePriority, parseLevel, decidePriority, PRIORITY_CN, PRIORITY_KEYS, LEVEL_TO_PRIORITY,
  parseNotifType, decideNotifType, NOTIF_TYPE_CN,
};
