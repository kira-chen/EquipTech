#!/usr/bin/env node
'use strict';
/**
 * 生成维修通知单草稿样例输入（可再生）。用法：node scripts/make-sample.js --out <dir> [--seed <n>] [--date <YYYY-MM-DD>]
 * 主样例恒为：4 条待转通知单的缺陷（动设备 2、静设备 1、仪表 1；A 1 / B 1 / C 2），其中 1 条位号不在设备台账、1 条无历史维修记录。
 * seed 只影响滴数、工时、承修班组等数值，不影响草稿数、专业分布与边界命中。
 */
const fs = require('fs');
const path = require('path');
const { writeXlsx } = require('./lib/xlsx-lite');
const C = require('./lib/common');

const a = C.parseArgs(process.argv.slice(2), ['out', 'seed', 'date'], []);
// 默认输出到演示样例目录：仓库内在 炼厂车间设备员/演示case/<分类>/<技能>/，开发包内在技能目录 examples/
const skillsRoot = path.resolve(__dirname, '../../..');
const caseDir = path.basename(skillsRoot) === '设备员skill' ? path.join(skillsRoot, '..', '演示case', path.relative(skillsRoot, path.resolve(__dirname, '..'))) : path.join(__dirname, '..', 'examples');
const out = a.out || caseDir;
const date = a.date || '2026-09-21';
const seed = a.seed ? Number(a.seed) : 1;
let s = seed * 7919 + 13;
const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (arr) => arr[Math.floor(rnd() * arr.length) % arr.length];
const drops = () => (2 + Math.floor(rnd() * 8));

fs.mkdirSync(out, { recursive: true });
for (const f of ['sample-order-ledger.xlsx']) { try { fs.unlinkSync(path.join(out, f)); } catch (e) {} }

// 主样例：4 条待转通知单缺陷（A/B/C 口径）。P-2103A 不在设备台账（触发待补充），I-2501 无历史维修记录
writeXlsx(path.join(out, `sample-defects-${date}.xlsx`), {
  '缺陷记录': [
    ['缺陷编号', '位号', '设备名称', '缺陷部位', '缺陷描述', '介质', '等级', '发现时间', '发现人'],
    ['QX-20260921-001', 'P-2101A', '柴油加氢进料泵A', '机械密封', `机封处持续滴漏，约${drops()}滴/分`, '石脑油', 'A 级（重大）', `${date} 08:20`, '设备员王'],
    ['QX-20260921-002', 'E-2201', '进料换热器', '管束封头法兰', '法兰面渗漏，有油迹', '柴油', 'B 级（严重）', `${date} 09:05`, '设备员王'],
    ['QX-20260921-003', 'P-2103A', '急冷油泵A', '轴承箱', '运行中有异响，轴承温度较平时偏高', '', 'C 级（一般）', `${date} 10:15`, '点检员李'],
    ['QX-20260921-004', 'I-2501', '塔顶压力变送器', '取压管', '指示不准，与现场表偏差较大', '汽油', 'C 级（一般）', `${date} 14:30`, '设备员张'],
  ],
});

// 设备台账（SAP 技术对象导出列名）：故意不含 P-2103A，用于验证「位号查不到台账 → 待补充，不猜规格型号」
writeXlsx(path.join(out, 'sample-equip-ledger.xlsx'), {
  '设备台账': [
    ['功能位置', '设备', '设备描述', '型号编号', '工厂区段', '专业类别', '开始日期', '介质'],
    ['P-2101A', '10002101', '柴油加氢进料泵A', 'ZA50-250', '一区泵房北侧', '动设备', '2019-06-15', '石脑油'],
    ['E-2201', '10002201', '进料换热器', 'BES800-2.5-120', '一区框架二层', '静设备', '2018-11-20', '柴油'],
    ['I-2501', '10002501', '塔顶压力变送器', 'EJA430E', '三区分馏塔顶平台', '仪表', '2020-03-08', '汽油'],
    ['V-2301', '10002301', '低压分离器', 'DN1600×6000', '二区罐区', '静设备', '2017-09-01', '除盐水'],
  ],
});

// 历史维修记录（SAP 订单历史导出列名）：P-2101A 有 4 次（验证近 3 次截断），E-2201 有 1 次，I-2501 无记录
writeXlsx(path.join(out, 'sample-repair-history.xlsx'), {
  '维修记录': [
    ['订单', '功能位置', '基本开始日期', '订单描述', '主工作中心', '订单类型'],
    ['40012345', 'P-2101A', '2025-03-12', '更换机械密封，处理冲洗管线堵塞', pick(['JX-DSB1', 'JX-DSB2', 'JX-DSB3']), 'PM01'],
    ['40012890', 'P-2101A', '2025-08-20', '更换驱动端轴承，联轴器重新找中', 'JX-DSB1', 'PM01'],
    ['40013456', 'P-2101A', '2026-01-15', '机封冲洗液泄漏，更换O形圈', 'JX-DSB2', 'PM01'],
    ['40014012', 'P-2101A', '2026-06-05', '解体检查，更换叶轮口环', 'JX-DSB1', 'PM02'],
    ['40013778', 'E-2201', '2025-11-10', '封头法兰更换缠绕垫，紧固螺栓', 'JX-JSB2', 'PM01'],
  ],
});

// 变体：无等级列 + 未提供优先级 → 优先级与通知单类型未判定（验证不按「3 中」/M1 默认）
writeXlsx(path.join(out, 'sample-no-level.xlsx'), {
  '缺陷记录': [
    ['位号', '设备名称', '缺陷描述'],
    ['P-2102B', '循环油泵B', '振动偏高'],
    ['XYZ-9999', '不明设备', '有异响'],
  ],
});

console.log(JSON.stringify({ ok: true, out, date, seed, files: fs.readdirSync(out).filter((f) => f.endsWith('.xlsx')) }));
