#!/usr/bin/env node
'use strict';
/**
 * 生成样例：设备清单 xlsx + 厂内规程样例（.md，含带数值的条款）
 * 用法：node scripts/make-sample.js --out <dir> [--seed <n>]
 *
 * seed 变化时：位号尾号、区域、规程中的具体数值会变，
 * 但**预期结论不变**（设备类型数、含数值条款数、可出数值题数）。
 */
const fs = require('fs');
const path = require('path');
const { writeXlsx } = require('./lib/xlsx-lite');
const C = require('./lib/common');

const a = C.parseArgs(process.argv.slice(2), ['out', 'seed'], []);
// 默认输出到演示样例目录：仓库内在 炼厂车间设备员/演示case/<分类>/<技能>/，开发包内在技能目录 examples/
const skillsRoot = path.resolve(__dirname, '../../..');
const caseDir = path.basename(skillsRoot) === '设备员skill' ? path.join(skillsRoot, '..', '演示case', path.relative(skillsRoot, path.resolve(__dirname, '..'))) : path.join(__dirname, '..', 'examples');
const out = a.out || caseDir;
const seed = a.seed ? Number(a.seed) : 1;
let s = seed * 7919 + 13;
const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (arr) => arr[Math.floor(rnd() * arr.length) % arr.length];
/** 在基准值上下浮动，保持量级与结论不变 */
const jit = (base, span, d = 0) => Number((base + (rnd() - 0.5) * 2 * span).toFixed(d));

fs.mkdirSync(out, { recursive: true });

/* ---------------- 1. 设备清单（覆盖 6 类设备） ---------------- */
writeXlsx(path.join(out, 'sample-equipment-list.xlsx'), {
  '设备台账': [
    ['位号', '设备名称', '设备类型', '区域'],
    ['P-1101A', '常压塔顶回流泵A', '离心泵', pick(['一区', '二区'])],
    ['P-1101B', '常压塔顶回流泵B', '离心泵', '一区'],
    ['P-1102A', '常压渣油泵A', '离心泵', '一区'],
    ['E-1201', '原油换热器', '换热器', '二区'],
    ['E-1202', '柴油冷却器', '换热器', '二区'],
    ['C-1401', '常压塔', '塔器', '三区'],
    ['V-1301', '原油缓冲罐', '容器', '二区'],
    ['M-1501', '鼓风机电机', '电机', '四区'],
    ['K-1601', '空压机', '压缩机', '四区'],
  ],
});

/* ---------------- 1b. SAP PM 技术对象导出样式（功能位置 / 设备 8 位流水号 / 设备描述 / 对象类型 / 工厂区段，首行为标题） ---------------- */
writeXlsx(path.join(out, 'sample-sap-export.xlsx'), {
  '技术对象清单': [
    ['IH08 技术对象清单（导出）'],
    [],
    ['功能位置', '设备', '设备描述', '对象类型', '工厂区段', 'ABC标识'],
    ['P-1101A', '10000231', '常压塔顶回流泵A', '离心泵', pick(['常减压一区', '常减压二区']), 'A'],
    ['P-1101B', '10000232', '常压塔顶回流泵B', '离心泵', '常减压一区', 'A'],
    ['E-1201', '10000305', '原油换热器', '换热器', '常减压二区', 'B'],
    ['M-1501', '10000418', '鼓风机电机', '电机', '常减压四区', 'B'],
    ['K-1601', '10000520', '空压机', '压缩机', '常减压四区', 'A'],
  ],
});

/* ---------------- 2. 变体：缺设备类型列 ---------------- */
writeXlsx(path.join(out, 'sample-no-type.xlsx'), {
  '设备台账': [
    ['位号', '设备名称', '区域'],
    ['P-2101', '加氢进料泵', '一区'],
    ['M-2201', '循环水泵电机', '二区'],
  ],
});

/* ---------------- 3. 厂内规程样例（含 8 条带数值的条款） ---------------- */
const spec = `# 常减压车间 动设备管理规定（样例）

> 本文件为**虚构样例**，仅用于验证「有出处才出数值题」，不得用于现场。

## 4 离心泵管理要求

4.1 离心泵地脚螺栓紧固力矩为 ${jit(120, 10)} N·m，紧固后应做防松标记。
4.2 联轴器径向对中偏差不大于 ${jit(0.08, 0.02, 2)} mm，轴向偏差不大于 ${jit(0.10, 0.02, 2)} mm。
4.3 运行泵轴承箱温度不得超过 ${jit(75, 5)} ℃，超过时应立即上报设备员。
4.4 泵体振动速度有效值不大于 ${jit(4.5, 0.4, 1)} mm/s，超标按缺陷登记。
4.5 备用泵盘车周期为每 ${pick(['7 天', '10 天'])}一次，盘车不少于 ${jit(3, 1, 0)} 圈并做记录。
4.6 运行泵润滑油更换周期为每 ${pick(['3 个月', '4 个月'])}一次，或按油品化验结论提前更换。
4.7 机械密封泄漏量超过 ${jit(10, 3)} 滴/分钟时应安排停泵处理。
4.8 泵启动前应确认入口阀全开、出口阀微开，并确认无异常声响。

## 5 换热器管理要求

5.1 换热器投用升温速率不大于 ${jit(30, 5)} K/h，避免温差应力损伤管板。
5.2 换热器壳程与管程压差异常增大时应检查是否结垢或堵塞。

## 6 记录要求

6.1 点检记录应如实填写，异常描述写现象不写结论。
6.2 缺陷登记应包含位号、发现时间、现象描述、发现人四项要素。
`;
fs.writeFileSync(path.join(out, 'sample-spec.md'), spec, 'utf8');

/* ---------------- 4. 无数值资料（验证「无出处只出原理题」） ---------------- */
fs.writeFileSync(path.join(out, 'sample-spec-no-number.md'), `# 常减压车间 设备管理要求（样例·无数值）

> 本文件为**虚构样例**。全文不含任何具体数值，用于验证无数值资料时不产出数值题。

## 3 通则

3.1 设备点检应按岗位分工逐台执行，不得漏项。
3.2 发现异常应先停止操作并上报，不得自行拆检。
3.3 备用设备应保持随时可投用状态。
`, 'utf8');

/* ---------------- 5. 含操作规程类内容的资料（验证拦截） ---------------- */
fs.writeFileSync(path.join(out, 'sample-spec-with-procedure.md'), `# 装置资料合集（样例）

## 7 泵管理

7.1 泵出口压力低于设计值 ${jit(80, 5)} % 时应查明原因。

## 8 开车操作步骤

8.1 开车步骤：先引氮气置换，再缓慢升温升压，最后切换进料。
8.2 停车步骤：先降负荷，再退料，最后吹扫置换。
`, 'utf8');

console.log(JSON.stringify({
  ok: true, out, seed,
  files: fs.readdirSync(out).filter((f) => /\.(xlsx|md)$/.test(f) && f.startsWith('sample')),
  constants: { equipTypesInList: 6, numericClausesInSpec: 8, sapExportRows: 5 },
}));
