#!/usr/bin/env node
'use strict';
/**
 * 生成特种设备定检样例输入（可再生）。用法：node scripts/make-sample.js --out <dir> [--seed <n>] [--date <YYYY-MM-DD>]
 * 主样例恒为 18 台：3 台超期、3 台临期、7 台正常、5 台待核实（含 1 台「储罐」待核实）、2 项日期不一致、1 台监控使用、1 台应停用；
 *   年度检查（压力容器/压力管道）：2 台超期、1 台临期、1 台日期缺失。
 * 特种设备平台/SAP 导出变体恒为 5 台：1 超期、1 临期（安全阀按台账载明日期）、2 正常（含锅炉按「检验类型」列）、1 待核实（储罐）。
 * seed 只改变设备代码尾号与日期在组内的抖动，不改变上述结论。
 */
const fs = require('fs');
const path = require('path');
const { writeXlsx } = require('./lib/xlsx-lite');
const C = require('./lib/common');

const a = C.parseArgs(process.argv.slice(2), ['out', 'seed', 'date'], []);
const out = a.out || path.join(__dirname, '..', 'examples');
const date = a.date || '2026-09-21';
const seed = a.seed ? Number(a.seed) : 1;
let s = seed * 7919 + 13;
const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
/** 在 [lo,hi] 天内取一个相对基准日的偏移（保证落在目标分组内） */
const off = (lo, hi) => C.addDays(date, lo + Math.floor(rnd() * (hi - lo + 1)));
const code = (p) => `${p}${String(1000 + Math.floor(rnd() * 8999))}`;

fs.mkdirSync(out, { recursive: true });

/** 由下次检验日期反推上次检验日期，使规则计算值与台账一致 */
function backMonths(next, months) {
  const [y, m, d] = next.split('-').map(Number);
  const t = y * 12 + (m - 1) - months;
  const ny = Math.floor(t / 12), nm = t % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

const rows = [];
function add(cat, tag, name, reg, lic, gradeText, nextDate, months, unit, model, conclusion, opt = {}) {
  rows.push([cat, tag, name, reg, lic,
    opt.lastDate !== undefined ? opt.lastDate : (nextDate ? backMonths(nextDate, months) : ''),
    conclusion, opt.ledgerNext !== undefined ? opt.ledgerNext : (nextDate || ''), gradeText, unit, model, '在用',
    opt.annual !== undefined ? opt.annual : '']);
}
const annual = (n) => C.addDays(date, -n);

// ---- 超期 3 台
const o1 = off(-420, -300);  // 压力容器 3 级
add('压力容器', 'V-1301', '原油缓冲罐', code('11'), `容11${Math.floor(rnd() * 900 + 100)}`, '3级', o1, 36, '常减压装置', 'φ3000×12000', '符合要求', { annual: annual(400) });
const o2 = off(-200, -120);  // 安全阀：按台账载明的下次校验日期提示（周期以厂内规定为准，脚本不代入）
add('安全阀', 'SV-1401A', '常压塔顶安全阀A', code('SV'), '', '', o2, 12, '常减压装置', 'A48Y-16C DN80', '合格', { lastDate: C.addDays(o2, -365) });
const o3 = off(-90, -40);    // 起重机械 2 年
add('起重机械', 'QZ-0101', '泵房检修行车', code('QZ'), `起01${Math.floor(rnd() * 90 + 10)}`, '', o3, 24, '常减压装置', 'LD-5t-16.5m', '合格');

// ---- 临期 3 台（90 天内）
add('压力容器', 'V-1302', '初馏塔回流罐', code('11'), `容12${Math.floor(rnd() * 900 + 100)}`, '2级', off(5, 35), 72, '常减压装置', 'φ2400×8000', '符合要求', { annual: annual(300) });
add('压力管道', 'GL-2101', '常压塔顶油气管道', code('PP'), `管21${Math.floor(rnd() * 900 + 100)}`, '2级', off(40, 70), 72, '常减压装置', 'GC1 DN600', '符合要求', { annual: annual(380) });
add('锅炉', 'BL-3101', '余热锅炉（外部检验）', code('BL'), `锅31${Math.floor(rnd() * 900 + 100)}`, '', off(72, 88), 12, '常减压装置', '外部检验 4t/h', '合格');

// ---- 周期内正常 4 台
add('压力容器', 'V-1303', '脱盐水罐', code('11'), `容13${Math.floor(rnd() * 900 + 100)}`, '1级', off(400, 900), 72, '常减压装置', 'φ3600×10000', '符合要求', { annual: annual(120) });
add('压力管道', 'GL-2102', '减压塔进料管道', code('PP'), `管21${Math.floor(rnd() * 900 + 100)}`, '2级', off(300, 800), 72, '常减压装置', 'GC1 DN800', '符合要求', { annual: annual(100) });
add('场内机动车辆', 'CC-0201', '厂区叉车1号', code('CC'), `车02${Math.floor(rnd() * 90 + 10)}`, '', off(150, 300), 12, '公用工程', '3t 内燃叉车', '合格');
add('锅炉', 'BL-3102', '导热油炉（内部检验）', code('BL'), `锅31${Math.floor(rnd() * 900 + 100)}`, '', off(200, 600), 24, '公用工程', '内部检验 2t/h', '合格');

// ---- 日期不一致 2 台：台账下次检验日期被人为改写，与规则计算不符
{
  const calcNext = off(150, 250);                     // 压力容器 2 级 → 6 年
  const ledgerNext = C.addDays(calcNext, 180);        // 台账多写了半年
  add('压力容器', 'V-1304', '常压塔顶回流罐', code('11'), `容14${Math.floor(rnd() * 900 + 100)}`, '2级', calcNext, 72, '常减压装置', 'φ2200×7000', '符合要求', { ledgerNext, annual: annual(150) });
}
{
  const calcNext = off(20, 60);                       // 压力管道 2 级 → 6 年，台账多写了一年
  const ledgerNext = C.addDays(calcNext, 365);
  add('压力管道', 'GL-2103', '减压塔顶油气管道', code('PP'), `管21${Math.floor(rnd() * 900 + 100)}`, '2级', calcNext, 72, '减压装置', 'GC1 DN500', '符合要求', { ledgerNext, annual: annual(90) });
}

// ---- 待核实 4 台（加上 5 级停用的 V-1307 共 5 项）
// 1) 压力容器安全状况等级缺失 → 周期无法确定，绝不按 6 年；年度检查日期也缺失
rows.push(['压力容器', 'V-1305', '污油罐', code('11'), `容15${Math.floor(rnd() * 900 + 100)}`, C.addDays(date, -500), '', '', '', '罐区', 'φ3000×9000', '在用', '']);
// 2) 设备类别无法识别
rows.push(['电梯附属装置', 'X-0301', '不明类别附属设备', code('XX'), '', C.addDays(date, -200), '合格', '', '', '公用工程', '—', '在用', '']);
// 3) 上次检验日期与下次检验日期同时缺失
rows.push(['起重机械', 'QZ-0102', '罐区检修行车', code('QZ'), `起01${Math.floor(rnd() * 90 + 10)}`, '', '', '', '', '罐区', 'LD-3t-10.5m', '在用', '']);
// 4) 「储罐」待核实：常压储罐不是特种设备
rows.push(['储罐', 'TK-0401', '柴油储罐', '', '', C.addDays(date, -300), '', '', '', '罐区', 'φ12000×14000', '在用', '']);

// ---- 监控使用 / 应停用各 1 台
add('压力容器', 'V-1306', '老旧缓冲罐', code('11'), `容16${Math.floor(rnd() * 900 + 100)}`, '4级', '', 0, '罐区', 'φ2000×6000', '监控使用', { lastDate: C.addDays(date, -300), ledgerNext: C.addDays(date, 120), annual: annual(200) });
add('压力容器', 'V-1307', '待报废储罐', code('11'), `容17${Math.floor(rnd() * 900 + 100)}`, '5级', '', 0, '罐区', 'φ1600×5000', '不符合要求', { lastDate: C.addDays(date, -60), ledgerNext: '' });

writeXlsx(path.join(out, `sample-special-equipment-${date}.xlsx`), {
  '特种设备台账': [
    ['设备类别', '位号', '设备名称', '设备代码', '使用登记证编号', '上次检验日期', '检验结论', '下次检验日期', '安全状况等级', '装置', '规格型号', '使用状态', '上次年度检查日期'],
    ...rows,
  ],
});

// ---- 整改项清单：3 项未闭环（其中 2 项已过整改期限）
writeXlsx(path.join(out, 'sample-issues.xlsx'), {
  '整改项': [
    ['位号', '设备名称', '整改项', '要求完成日期', '整改状态', '责任人'],
    ['V-1301', '原油缓冲罐', '筒体局部腐蚀减薄，需补焊并复测壁厚', C.addDays(date, -120), '整改中', '张工'],
    ['GL-2101', '常压塔顶油气管道', '支吊架变形，需调整并复检', C.addDays(date, -30), '未开始', '李工'],
    ['V-1302', '初馏塔回流罐', '安全阀铅封缺失，需重新铅封', C.addDays(date, 45), '整改中', '王工'],
    ['V-1303', '脱盐水罐', '保温层破损，已修复', C.addDays(date, -200), '已完成', '赵工'],
  ],
});

// ---- 变体：特种设备平台 / SAP PM 导出风格（标题行 + 系统列名 + 合计行 + 中文等级 + Excel 日期写法）
// 功能位置 = 位号；「设备」是 SAP 8 位流水号（不作位号）；锅炉检验类型独立列；「储罐」待核实
const eq8 = (i) => String(10090000 + seed * 13 + i);
writeXlsx(path.join(out, 'sample-erp-export.xlsx'), {
  '特种设备台账': [
    ['某某炼化厂 特种设备台账（特种设备平台 / SAP PM 导出）'],
    [],
    ['功能位置', '设备', '设备描述', '设备品种', '设备代码', '使用登记证编号', '检验机构', '检验类型', '末次检验日期', '检验结果', '到期日期', '安全状况', '年度检查日期', '工厂区段', '型号编号', '状态'],
    ['2000-HDS-V9001', eq8(1), '加氢进料缓冲罐', '压力容器', '31010900019001', '容900101', '某检验院', '全面检验', '2024/3/15', '符合要求', '2030/3/15', '二级', C.addDays(date, -200), '加氢装置', 'φ2600×8000', '在用'],
    ['2000-HDS-V9002', eq8(2), '循环氢分液罐', '压力容器', '31010900019002', '容900102', '某检验院', '全面检验', '2021年6月10日', '符合要求', '2024年6月10日', '三级', C.addDays(date, -370), '加氢装置', 'φ1800×6000', '在用'],
    ['2000-HDS-SV9001', eq8(3), '反应器出口安全阀', '安全阀', '', '', '某检验院', '校验', '2025/10/1', '合格', '2026/10/1', '', '', '加氢装置', 'A48Y-64 DN100', '在用'],
    ['2000-HDS-BL9001', eq8(4), '加氢余热锅炉', '锅炉', '11010900019004', '锅900104', '某检验院', '外部检验', '2026/3/1', '合格', '', '', '', '加氢装置', '4t/h', '在用'],
    ['2000-HDS-TK9001', eq8(5), '柴油储罐', '储罐', '', '', '', '', '2025/6/1', '', '', '', '', '罐区', 'φ12000×14000', '在用'],
    ['合计', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
  ],
});

// ---- 变体：全部在周期内，无超期（用于验证醒目提示不出现）
writeXlsx(path.join(out, 'sample-all-normal.xlsx'), {
  '特种设备台账': [
    ['设备类别', '位号', '设备名称', '设备代码', '使用登记证编号', '上次检验日期', '检验结论', '下次检验日期', '安全状况等级', '装置', '规格型号', '使用状态', '上次年度检查日期'],
    ['压力容器', 'V-8001', '低压瓦斯罐', '11800101', '容800101', backMonths(off(500, 900), 72), '符合要求', '', '1级', '公用工程', 'φ3000×9000', '在用', C.addDays(date, -100)],
    ['起重机械', 'QZ-8001', '机修车间行车', 'QZ8001', '起8001', backMonths(off(300, 600), 24), '合格', '', '', '机修车间', 'LD-5t', '在用', ''],
    ['场内机动车辆', 'CC-8001', '厂区叉车2号', 'CC8001', '车8001', backMonths(off(200, 350), 12), '合格', '', '', '公用工程', '3t 内燃叉车', '在用', ''],
  ],
});

console.log(JSON.stringify({ ok: true, out, date, seed, files: fs.readdirSync(out).filter((f) => f.endsWith('.xlsx')) }));
