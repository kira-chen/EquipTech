#!/usr/bin/env node
'use strict';
/**
 * 生成铭牌录入样例（可再生）。用法：node scripts/make-sample.js --out <dir> [--seed <n>]
 *
 * seed 改变数值，但结论不变：
 *   - 泵主样例（P-1101A）：恒 2 项 blurry、2 项 unreadable，配台账恒 3 项冲突（含出厂编号）；全部字段带铭牌原文 raw
 *   - 电机样例（M-1501）：恒 1 项 blurry、1 项 unreadable、2 项单位需核对（马力、吨），台账中位号不存在（新增建档）
 *   - 容器样例（V-1301）：全 clear，含「设备代码」字段，配台账恒 0 冲突（参数一致）；1 项 raw 缺失（腐蚀裕量）
 *   - SAP PM 技术对象清单（sample-sap-pm-ledger.xlsx）：功能位置 / 设备 / 设备描述 / 制造商 / 型号编号 / 制造商序列号 / 建造年份 / 设备代码，
 *     P-1101A 按功能位置命中、设备编号单列；容器样例按设备代码一致
 */
const fs = require('fs');
const path = require('path');
const { writeXlsx } = require('./lib/xlsx-lite');
const C = require('./lib/common');

const a = C.parseArgs(process.argv.slice(2), ['out', 'seed'], []);
const out = a.out || path.join(__dirname, '..', 'examples');
const seed = a.seed ? Number(a.seed) : 1;
let s = seed * 7919 + 13;
const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const jitter = (v, p = 0.05, d = 1) => Number((v * (1 + (rnd() - 0.5) * 2 * p)).toFixed(d));
const pick = (arr) => arr[Math.floor(rnd() * arr.length) % arr.length];

fs.mkdirSync(out, { recursive: true });

const MAKER_PUMP = '沈阳水泵股份有限公司';   // 与台账同值：冲突项恒为 3（型号/出厂编号/制造日期）
const MAKER_MOTOR = pick(['上海电气集团上海电机厂', '南阳防爆电机集团', '佳木斯电机股份有限公司']);
const flow = jitter(100, 0.08, 1);
const head = jitter(250, 0.06, 1);
const power = jitter(110, 0.05, 1);
const speed = 2950;
const weightPump = jitter(820, 0.03, 0);   // 与台账同值，保证冲突项恒为 3（型号/出厂编号/制造日期）

// ---------------------------------------------------------------- 台账
// P-1101A 已在台账中（型号/出厂编号/制造日期与铭牌不一致 → 恒 3 项冲突）
// V-1301 已在台账中且参数一致（0 冲突）
// M-1501 不在台账中（新增建档）
writeXlsx(path.join(out, 'sample-equipment-ledger.xlsx'), {
  '设备台账': [
    ['位号', '设备名称', '规格型号', '制造厂', '出厂编号', '制造日期', '投用日期', '功率(kW)', '流量(m³/h)', '扬程(m)', '转速(r/min)', '设计压力(MPa)', '设计温度(℃)', '容积(m³)', '材质', '执行标准', '重量(kg)', '专业', '区域'],
    ['P-1101A', '常压塔顶回流泵A', 'ZA-100-250', '沈阳水泵股份有限公司', 'SY-2012-0876', '2012-03', '2012-06-15', power, flow, head, speed, '', '', '', 'ZG1Cr18Ni9Ti', 'GB/T 3215', weightPump, '动设备', '一区'],
    ['P-1101B', '常压塔顶回流泵B', 'ZA-100-250', '沈阳水泵股份有限公司', 'SY-2012-0877', '2012-03', '2012-06-15', power, flow, head, speed, '', '', '', 'ZG1Cr18Ni9Ti', 'GB/T 3215', weightPump, '动设备', '一区'],
    ['E-1201', '原油换热器', 'BES-800-2.5', '兰州石油化工机器厂', 'LZ-2012-0231', '2012-01', '2012-06-15', '', '', '', '', 2.5, 350, '', '16MnR', 'GB/T 151', 6400, '静设备', '二区'],
    ['V-1301', '原油缓冲罐', 'φ3000×8000', '张家口冀东容器厂', 'JD-2011-1102', '2011-11', '2012-06-15', '', '', '', '', 1.6, 200, 56.5, 'Q345R', 'NB/T 47041', 12800, '静设备', '二区'],
    ['C-1401', '常压塔', 'φ4800×42000', '兰州石油化工机器厂', 'LZ-2011-0088', '2011-09', '2012-06-15', '', '', '', '', 0.35, 380, '', 'Q345R+0Cr13', 'GB/T 150', 96000, '静设备', '三区'],
    ['合计', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
  ],
});

// 变体：别名列头 + 标题行 + 缺「出厂编号」列（用于验证 unmapped 与表头识别）
writeXlsx(path.join(out, 'sample-alias-ledger.xlsx'), {
  '设备清单': [
    ['某某炼化厂 动设备台账导出'],
    [],
    ['设备位号', '名称', '型号', '生产厂家', '投用时间', '功率(kW)', '流量(m³/h)', '扬程(m)'],
    ['P-1101A', '常压塔顶回流泵A', 'ZA-100-250', '沈阳水泵股份有限公司', '2012-06-15', power, flow, head],
    ['P-1102A', '常压渣油泵A', 'ZE-150-400', '大连耐酸泵厂', '2014-03-20', 160, 200, 320],
  ],
});

// SAP PM 技术对象清单：功能位置 = 位号，「设备」= 8 位流水号（不是位号），建造年份不作投用日期
const eq8 = (i) => String(10001000 + seed * 17 + i);
writeXlsx(path.join(out, 'sample-sap-pm-ledger.xlsx'), {
  '技术对象清单': [
    ['功能位置', '设备', '设备描述', '对象类型', '制造商', '型号编号', '制造商序列号', '建造年份', '设备代码', '工厂区段', 'ABC标识'],
    ['P-1101A', eq8(1), '常压塔顶回流泵A', '离心泵', '沈阳水泵股份有限公司', 'ZA-100-250', 'SY-2012-0876', '2012', '', '常减压装置', 'A'],
    ['P-1101B', eq8(2), '常压塔顶回流泵B', '离心泵', '沈阳水泵股份有限公司', 'ZA-100-250', 'SY-2012-0877', '2012', '', '常减压装置', 'A'],
    ['V-1301', eq8(3), '原油缓冲罐', '压力容器', '张家口冀东容器厂', 'φ3000×8000', 'JD-2011-1102', '2011', `3101090001${String(2000 + seed * 3).slice(0, 4)}`, '常减压装置', 'B'],
  ],
});

// ---------------------------------------------------------------- 识别结果 JSON
/** F(name, value, confidence, extra)：clear/blurry 字段默认带铭牌原文 raw（= value + unit），模拟模型同时抄录原文 */
const F = (name, value, confidence, extra = {}) => {
  const o = Object.assign({ name, value, confidence }, extra);
  if (confidence !== 'unreadable' && o.raw === undefined && value !== null) o.raw = `${value}${o.unit || ''}`;
  return o;
};

// 泵主样例：2 blurry、2 unreadable；型号/出厂编号/制造日期与台账不一致 → 恒 3 冲突
const pump = {
  photo: 'P-1101A铭牌-20260921.jpg',
  fields: [
    F('制造厂', MAKER_PUMP, 'clear', { raw: MAKER_PUMP }),
    F('型号', 'ZA-100-315', 'clear', { raw: '型号 ZA-100-315' }),
    F('规格', '100-315', 'clear'),
    F('出厂编号', `DL-2019-${String(1000 + Math.floor(rnd() * 900)).slice(0, 4)}`, 'clear'),
    F('制造日期', '2019.06', 'clear', { note: '铭牌写法为 2019.06', raw: '2019.06' }),
    F('执行标准', 'GB/T 3215', 'clear'),
    F('重量', String(weightPump), 'clear', { unit: 'kg' }),
    F('流量', String(flow), 'clear', { unit: 'm³/h' }),
    F('扬程', String(head), 'clear', { unit: 'm' }),
    F('转速', String(speed), 'clear', { unit: 'r/min' }),
    F('配用功率', String(power), 'clear', { unit: 'kW' }),
    F('效率', String(jitter(72, 0.04, 1)), 'blurry', { unit: '%', reason: '铭牌该处有油污，小数位看不清', raw: '7▢.▢%' }),
    F('汽蚀余量', null, 'unreadable', { reason: '铭牌该行锈蚀脱漆，整行无法辨认' }),
    F('泵壳材质', 'ZG1Cr18Ni9Ti', 'clear'),
    F('叶轮材质', '2Cr1▢', 'blurry', { reason: '末位字符被托架遮挡，未做猜测', raw: '2Cr1▢' }),
    F('密封形式', '机械密封 双端面', 'clear'),
    F('设计压力', String(jitter(4.0, 0.05, 1)), 'clear', { unit: 'MPa' }),
    F('设计温度', null, 'unreadable', { reason: '铭牌上无此项' }),
  ],
};
fs.writeFileSync(path.join(out, 'sample-pump-fields.json'), JSON.stringify(pump, null, 2), 'utf8');

// 电机样例：1 blurry、1 unreadable、功率单位为马力（单位不一致）；台账中无 M-1501 → 新增建档
const motor = {
  photo: 'M-1501铭牌-20260921.jpg',
  fields: [
    F('制造厂', MAKER_MOTOR, 'clear'),
    F('型号', 'YB3-315M-2', 'clear'),
    F('规格', '315M-2', 'clear'),
    F('出厂编号', `SH-2020-${String(2000 + Math.floor(rnd() * 900)).slice(0, 4)}`, 'clear'),
    F('制造日期', '2020-05', 'clear'),
    F('执行标准', 'GB/T 1971', 'clear'),
    F('重量', String(jitter(1.35, 0.05, 2)), 'clear', { unit: 't', note: '铭牌单位为吨' }),
    F('额定功率', String(jitter(180, 0.03, 0)), 'clear', { unit: '马力', note: '铭牌印的是马力' }),
    F('额定电压', '6000', 'clear', { unit: 'V' }),
    F('额定电流', String(jitter(15.8, 0.05, 1)), 'clear', { unit: 'A' }),
    F('额定转速', '2９８０', 'clear', { unit: 'r/min', note: '铭牌为全角数字', raw: '2９８０ r/min' }),
    F('频率', '50', 'clear', { unit: 'Hz' }),
    F('接法', 'Y', 'clear'),
    F('功率因数', '0.8▢', 'blurry', { reason: '末位数字被铭牌螺钉遮挡', raw: 'cosφ 0.8▢' }),
    F('效率', '95.5', 'clear', { unit: '%' }),
    F('防护等级', 'IP55', 'clear'),
    F('绝缘等级', 'F', 'clear'),
    F('防爆标志', null, 'unreadable', { reason: '防爆标志区反光严重，整段无法辨认' }),
    F('工作制', 'S1', 'clear'),
  ],
};
fs.writeFileSync(path.join(out, 'sample-motor-fields.json'), JSON.stringify(motor, null, 2), 'utf8');

// 容器样例：全 clear，含「设备代码」，与台账 V-1301 完全一致 → 0 冲突
const VESSEL_CODE = `3101090001${String(2000 + seed * 3).slice(0, 4)}`;
const vessel = {
  photo: 'V-1301铭牌-20260921.jpg',
  fields: [
    F('制造厂', '张家口冀东容器厂', 'clear'),
    F('型号', 'φ3000×8000', 'clear'),
    F('出厂编号', 'JD-2011-1102', 'clear'),
    F('制造日期', '2011-11', 'clear'),
    F('执行标准', 'NB/T 47041', 'clear'),
    F('重量', '12800', 'clear', { unit: 'kg' }),
    F('设计压力', '1.6', 'clear', { unit: 'MPa' }),
    F('最高工作压力', '1.35', 'clear', { unit: 'MPa' }),
    F('设计温度', '200', 'clear', { unit: '℃' }),
    F('工作温度', '150', 'clear', { unit: '℃' }),
    F('容积', '56.5', 'clear', { unit: 'm³' }),
    F('介质', '原油', 'clear'),
    F('主体材质', 'Q345R', 'clear'),
    F('腐蚀裕量', '3', 'clear', { unit: 'mm', raw: null, note: '模型漏抄原文，验证 raw 缺失提示' }),
    F('焊缝系数', '1.0', 'clear'),
    F('容器类别', 'Ⅱ类', 'clear'),
    F('设计使用年限', '20', 'clear', { unit: '年' }),
    F('制造许可证号', 'TS2210166-2023', 'clear'),
    F('监检机构', '某省特种设备监督检验院', 'clear'),
    F('设备代码', VESSEL_CODE, 'clear', { raw: `设备代码 ${VESSEL_CODE}` }),
  ],
};
fs.writeFileSync(path.join(out, 'sample-vessel-fields.json'), JSON.stringify(vessel, null, 2), 'utf8');

console.log(JSON.stringify({
  ok: true, out, seed,
  files: fs.readdirSync(out).filter((f) => /\.(xlsx|json)$/.test(f)).sort(),
}));
