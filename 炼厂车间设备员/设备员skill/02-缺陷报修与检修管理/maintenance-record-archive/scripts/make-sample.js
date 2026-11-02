#!/usr/bin/env node
'use strict';
/**
 * 生成检修归档样例（可再生）。用法：node scripts/make-sample.js --out <dir> [--seed <n>]
 * 主样例（材料清单）恒为：10 份材料，其中 1 份无法归类；配 大检修 + 特种设备 + 焊接/承压件/无损/试压 口径时恒缺 3 项必备（检验报告、无损检测、耐压试验）+ 检修总结。
 * seed 只改变文件编号与照片阶段，不改变上述结论。
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
const pick = (arr) => arr[Math.floor(rnd() * arr.length) % arr.length];
const no = () => String(100 + Math.floor(rnd() * 800));

fs.mkdirSync(out, { recursive: true });

// 主样例：材料清单（缺「无损检测报告」与「耐压试验记录」→ 特种设备口径下为必备缺失；大检修口径下另缺「检修总结」）
writeXlsx(path.join(out, 'sample-materials.xlsx'), {
  '材料清单': [
    ['文件名', '资料类型', '位号', '备注'],
    [`V-2301检修方案-${no()}.docx`, '方案', 'V-2301', ''],
    [`用火作业许可证-${no()}.pdf`, '作业票', 'V-2301', '作业许可系统导出'],
    [`受限空间作业证-${no()}.pdf`, '作业票', 'V-2301', ''],
    ['设备交出单.pdf', '交出单', 'V-2301', ''],
    ['检修记录卡（内件更换）.xlsx', '记录', 'V-2301', ''],
    ['完工验收单.pdf', '验收', 'V-2301', ''],
    ['焊工资质证明及焊接记录.pdf', '资质', 'V-2301', ''],
    ['塔盘材质证明书.pdf', '材质', 'V-2301', ''],
    ['质量验收记录（H点见证）.pdf', '质量记录', 'V-2301', ''],
    [`现场照片-${pick(['开工前', '施工中', '完工后'])}.jpg`, '照片', 'V-2301', ''],
    [`会议纪要-${no()}.docx`, '', 'V-2301', '无法归入应归档类型'],
  ],
});

// 变体：日常维修，材料齐全（方案 / 作业票 / 记录 / 验收 / 交出单 / 照片）
writeXlsx(path.join(out, 'sample-minor-complete.xlsx'), {
  '材料清单': [
    ['文件名', '资料类型', '位号'],
    ['P-1101A日常维修方案.docx', '方案', 'P-1101A'],
    ['检修记录卡.xlsx', '记录', 'P-1101A'],
    ['验收单.pdf', '验收', 'P-1101A'],
    ['设备交出单.pdf', '交出单', 'P-1101A'],
    ['临时用电作业票.pdf', '作业票', 'P-1101A'],
    ['完工照片.jpg', '照片', 'P-1101A'],
  ],
});

// 变体：材料极少，触发大量缺失
writeXlsx(path.join(out, 'sample-sparse.xlsx'), {
  '材料清单': [['文件名', '资料类型'], ['检修记录卡.xlsx', '记录']],
});

// 设备台账（厂内台账列名）
writeXlsx(path.join(out, 'sample-equipment-ledger.xlsx'), {
  '设备台账': [
    ['位号', '设备名称', '专业'],
    ['V-2301', '低压分离器', '静设备'],
    ['P-1101A', '常压塔顶回流泵A', '动设备'],
  ],
});

// 设备台账（SAP PM 技术对象导出列名：功能位置 / 设备 / 设备描述 / 对象类型 / 维护工厂）
writeXlsx(path.join(out, 'sample-equipment-ledger-sap.xlsx'), {
  '技术对象清单': [
    ['SAP PM 技术对象清单导出'],
    [],
    ['功能位置', '设备', '设备描述', '对象类型', '维护工厂', 'ABC标识'],
    ['V-2301', '10023001', '低压分离器', '压力容器', '常减压车间', 'B'],
    ['P-1101A', '10023002', '常压塔顶回流泵A', '离心泵', '常减压车间', 'A'],
    ['E-1201', '10023003', '原油换热器', '换热器', '常减压车间', 'C'],
  ],
});

console.log(JSON.stringify({ ok: true, out, seed, files: fs.readdirSync(out).filter((f) => f.endsWith('.xlsx')) }));
