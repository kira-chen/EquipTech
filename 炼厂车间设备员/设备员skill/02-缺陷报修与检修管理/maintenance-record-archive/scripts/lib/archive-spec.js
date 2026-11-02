'use strict';
/**
 * 检修归档资料规范表（中石化炼化厂口径）
 * 口径见 references/archive-spec.md
 * mandatory: true 表示必备（缺失即不满足归档要求），false 为一般应归档
 * 检修分级：大检修 / 日常维修 / 抢修 / 专项；旧值 大修→大检修、中修/小修→日常维修（normRepairType 映射并由调用方 warning）
 */

const TYPES = ['大检修', '日常维修', '抢修', '专项'];
const TYPE_ALIAS = {
  '大修': '大检修', '装置大检修': '大检修', '停工检修': '大检修', '停工大修': '大检修',
  '中修': '日常维修', '小修': '日常维修', '日常检修': '日常维修', '维修': '日常维修',
  '抢修': '抢修', '紧急抢修': '抢修',
  '技改': '专项', '技改技措': '专项', '专项检修': '专项', '专项检修（技改技措）': '专项',
};
/** 返回 {type, raw, mapped}；type 为 null 表示无法识别（调用方报错） */
function normRepairType(v) {
  const raw = String(v || '').trim();
  if (!raw) return { type: null, raw, mapped: false };
  if (TYPES.includes(raw)) return { type: raw, raw, mapped: false };
  if (TYPE_ALIAS[raw]) return { type: TYPE_ALIAS[raw], raw, mapped: TYPE_ALIAS[raw] !== raw };
  return { type: null, raw, mapped: false };
}

// 通用资料（所有检修类型）：检修方案、作业票、检修记录、验收单为必备
const COMMON = [
  { key: 'plan', name: '检修方案', patterns: /方案|施工方案|检修方案|作业指导书|抢修方案/, mandatory: true },
  { key: 'permit', name: '作业许可（作业票）', patterns: /作业票|作业证|作业许可|用火|动火票|受限空间|高处作业|吊装作业|临时用电|盲板|动土|断路/, mandatory: true },
  { key: 'handover', name: '设备交出单', patterns: /交出单|交出|设备交出/, mandatory: false },
  { key: 'record', name: '检修记录卡', patterns: /检修记录|施工记录|作业记录|检修日志|记录卡/, mandatory: true },
  { key: 'acceptance', name: '验收单', patterns: /验收|验收单|竣工验收|完工验收/, mandatory: true },
  { key: 'photo', name: '检修照片', patterns: /照片|图片|影像|现场记录|\.(jpe?g|png)$/i, mandatory: false },
];

// 按检修分级追加
const BY_TYPE = {
  '大检修': [
    { key: 'riskAssess', name: '风险分析（JSA）记录', patterns: /风险分析|JSA|危害分析|风险评估|风险辨识/, mandatory: false },
    { key: 'qcRecord', name: '质量验收记录（H/W 点见证）', patterns: /质量验收|H点|W点|见证|停止点|质量记录/, mandatory: false },
    { key: 'trialRecord', name: '试车记录', patterns: /试车|试运|运转记录|空负荷|负荷试运/, mandatory: false },
    { key: 'spareIssue', name: '备件领用单', patterns: /领用单|领料单|备件领用|物料领用|出库单/, mandatory: false },
    { key: 'partCert', name: '更换部件质量证明', patterns: /质量证明|合格证|质保书|材质证明/, mandatory: false },
    { key: 'tcfdRecord', name: '三查四定问题整改记录', patterns: /三查四定|问题整改|整改记录|整改台账/, mandatory: false },
    { key: 'midHandover', name: '中交（中间交接）记录', patterns: /中交|中间交接|交接记录/, mandatory: false },
    { key: 'progress', name: '进度记录', patterns: /进度|日报|周报/, mandatory: false },
    { key: 'summary', name: '检修总结', patterns: /总结|小结|检修总结/, mandatory: true },
  ],
  '日常维修': [],
  '抢修': [
    { key: 'failureRecord', name: '故障（事件）记录或分析报告', patterns: /故障|事件|分析报告|原因分析|抢修记录/, mandatory: false },
  ],
  '专项': [
    { key: 'techDoc', name: '技术方案或变更资料（MOC）', patterns: /技术方案|变更|MOC|改造|技改/, mandatory: false },
  ],
};

// 涉及解体、更换承压件、焊接时追加
const BY_SCOPE = [
  { key: 'material', name: '材质证明书', patterns: /材质|质保书|合格证|材质证明|质量证明/, mandatory: false, when: 'material' },
  { key: 'weld', name: '焊接记录与焊工资质', patterns: /焊接|焊工|焊缝|WPS|PQR/, mandatory: false, when: 'weld' },
  { key: 'ndt', name: '无损检测报告', patterns: /无损|探伤|NDT|RT|UT|MT|PT|射线|超声/, mandatory: false, when: 'ndt' },
  { key: 'pressure', name: '试压记录', patterns: /试压|压力试验|水压|气密|强度试验/, mandatory: false, when: 'pressure' },
  { key: 'trial', name: '试运记录', patterns: /试运|试车|运转|空负荷|负荷试运/, mandatory: false, when: 'trial' },
];

// 特种设备必备（--special-equipment 时生效，全部 mandatory；依据 TSG 21 / TSG D7005 与厂内特种设备管理制度，不转述数值）
const SPECIAL_EQUIPMENT = [
  { key: 'seInspect', name: '特种设备检验报告', patterns: /检验报告|定期检验|检验结论/, mandatory: true },
  { key: 'seMaterial', name: '承压件材质证明书', patterns: /材质|质保书|材质证明|质量证明书/, mandatory: true },
  { key: 'seWeld', name: '焊工资质证明与焊接记录', patterns: /焊工|焊接记录|焊工资质|持证/, mandatory: true },
  { key: 'seNdt', name: '无损检测报告', patterns: /无损|探伤|NDT|RT|UT|MT|PT/, mandatory: true },
  { key: 'sePressure', name: '耐压试验记录', patterns: /试压|耐压|压力试验|水压试验/, mandatory: true },
];

/**
 * 按检修分级与范围返回应归档资料清单
 * @param {string} type 大检修/日常维修/抢修/专项（已归一）
 * @param {object} scope {material, weld, ndt, pressure, trial}
 * @param {boolean} special 是否特种设备
 */
function requiredMaterials(type, scope = {}, special = false) {
  const out = COMMON.slice();
  for (const it of (BY_TYPE[type] || [])) out.push(it);
  for (const it of BY_SCOPE) if (scope[it.when]) out.push(it);
  if (special) {
    for (const it of SPECIAL_EQUIPMENT) {
      // 与已有项去重：特种设备版覆盖一般版（mandatory 更严）
      const i = out.findIndex((x) => x.name.includes(it.name.replace(/^承压件|^特种设备/, '').slice(0, 4)));
      if (i >= 0 && !out[i].mandatory) out.splice(i, 1);
      out.push(it);
    }
  }
  // 按 key 去重，保留 mandatory 更严的
  const map = new Map();
  for (const it of out) {
    const prev = map.get(it.key);
    if (!prev || (it.mandatory && !prev.mandatory)) map.set(it.key, it);
  }
  return [...map.values()];
}

/** 文件名归类：返回匹配到的 key 数组（可能多个），无匹配返回 [] */
function classify(filename, required) {
  const s = String(filename || '');
  const hit = [];
  for (const it of required) if (it.patterns.test(s)) hit.push(it.key);
  return hit;
}

module.exports = { TYPES, TYPE_ALIAS, normRepairType, requiredMaterials, classify, COMMON, BY_TYPE, BY_SCOPE, SPECIAL_EQUIPMENT };
