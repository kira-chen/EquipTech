#!/usr/bin/env node
'use strict';
/** 生成设备清单样例。用法：node scripts/make-sample.js --out <dir> [--seed <n>] */
const fs = require('fs');
const path = require('path');
const { writeXlsx } = require('./lib/xlsx-lite');
const C = require('./lib/common');

const a = C.parseArgs(process.argv.slice(2), ['out', 'seed'], []);
const out = a.out || path.join(__dirname, '..', 'examples');
const seed = a.seed ? Number(a.seed) : 1;
let s = seed * 7919 + 13;
const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (arr) => arr[Math.floor(rnd() * arr.length) % arr.length];

fs.mkdirSync(out, { recursive: true });

// 主样例：覆盖 6 类设备，含 1 类不在覆盖范围（"加热炉"）
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
    ['F-1701', '常压加热炉', '加热炉', '三区'],
  ],
});

// 变体：设备类型列缺失（靠名称推断）
writeXlsx(path.join(out, 'sample-no-type.xlsx'), {
  '设备台账': [
    ['位号', '设备名称', '区域'],
    ['P-2101', '加氢进料泵', '一区'],
    ['M-2201', '循环水泵电机', '二区'],
  ],
});

// 变体：SAP PM / EM 导出列名（功能位置 / 设备（8 位流水号）/ 设备描述 / 对象类型 / 工厂区段）
// 「设备」列是 SAP 设备编号，不是位号；脚本按「功能位置」取位号
writeXlsx(path.join(out, 'sample-sap-export.xlsx'), {
  '设备台账': [
    ['功能位置', '设备', '设备描述', '对象类型', '工厂区段', '维护工厂'],
    ['P-3101A', '10002101', '加氢进料泵A', '离心泵', '加氢一区', '加氢车间'],
    ['P-3101B', '10002102', '加氢进料泵B', '离心泵', '加氢一区', '加氢车间'],
    ['K-3201', '10002103', '循环氢压缩机', '压缩机', '压缩机厂房', '加氢车间'],
    ['M-3201', '10002104', '循环氢压缩机电机', '电机', '压缩机厂房', '加氢车间'],
    ['E-3301', '10002105', '反应进料换热器', '换热器', '加氢二区', '加氢车间'],
    ['D-3401', '10002106', '高压分离器', '容器', '加氢二区', '加氢车间'],
  ],
});

console.log(JSON.stringify({ ok: true, out, seed, files: fs.readdirSync(out).filter((f) => f.endsWith('.xlsx')) }));
