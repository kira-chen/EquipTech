#!/usr/bin/env node
'use strict';
/**
 * 生成设备交出样例输入（可再生）。用法：node scripts/make-sample.js --out <dir> [--seed <n>] [--date <YYYY-MM-DD>]
 * seed 改变温度压力数值与检修负责人，但不改变结论：
 *   - sample-equip-ledger.xlsx：厂内自编列名台账，P-3101A 高危（液化气）、E-3201 中危（蜡油）、M-3301 电气、V-3401 介质不在库
 *   - sample-equip-ledger-sap.xlsx：SAP PM 技术对象导出列名（功能位置/设备/设备描述/对象类型/操作介质），含碳四、乙二醇
 *   - sample-handover-cases.xlsx：5 个场景，其中 1 个介质不在库、1 个未说明带压/进人（未判定）、1 个 SAP 列名台账
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
const jitter = (v, p = 0.08) => Number((v * (1 + (rnd() - 0.5) * 2 * p)).toFixed(2));
const pick = (arr) => arr[Math.floor(rnd() * arr.length) % arr.length];

fs.mkdirSync(out, { recursive: true });

// 设备台账：覆盖高危 / 中危 / 电气 / 介质不在库四类
writeXlsx(path.join(out, 'sample-equip-ledger.xlsx'), {
  '设备台账': [
    ['位号', '设备名称', '设备类型', '介质', '操作温度', '操作压力'],
    ['P-3101A', '液化气进料泵A', '离心泵', '液化气', jitter(45), jitter(1.6)],
    ['E-3201', '蜡油换热器', '管壳式换热器', '蜡油', jitter(230), jitter(0.9)],
    ['V-3401', '中间缓冲罐', '立式容器', '再生剂RX-7', jitter(65), jitter(0.35)],
    ['M-3301', '循环水泵电机', '电机', '', '', ''],
    ['C-3501', '脱硫塔', '填料塔', '胺液', jitter(48), jitter(0.6)],
    ['P-3102B', '循环水泵B', '离心泵', '循环水', jitter(35), jitter(0.4)],
  ],
});

// SAP PM 技术对象导出列名：功能位置 = 位号；「设备」是 8 位流水号不是位号；设备描述 = 名称；对象类型 = 设备类型
writeXlsx(path.join(out, 'sample-equip-ledger-sap.xlsx'), {
  '技术对象清单': [
    ['功能位置', '设备', '设备描述', '对象类型', 'ABC标识', '操作介质', '操作温度', '操作压力', '维护工厂'],
    ['P-3601A', '10023001', '碳四进料泵A', '离心泵', 'A', '混合碳四', jitter(40), jitter(1.2), '烯烃车间'],
    ['V-3602', '10023002', '乙二醇中间罐', '立式容器', 'B', '乙二醇', jitter(80), jitter(0.3), '乙二醇车间'],
    ['E-3603', '10023003', 'EO 冷凝器', '管壳式换热器', 'A', 'EO/EG', jitter(45), jitter(0.5), '乙二醇车间'],
  ],
});

// 场景表：供人工对照运行参数（本技能主脚本按参数驱动，不读此表）
const leader = pick(['王工', '李工', '赵工', '孙工']);
writeXlsx(path.join(out, 'sample-handover-cases.xlsx'), {
  '交出场景': [
    ['序号', '位号', '设备类型', '介质', '检修内容', '进受限空间', '用火作业', '带压', '高温', '检修负责人', '预期要点'],
    [1, 'P-3101A', '离心泵', '液化气', '机械密封解体更换', '否', '否', '是', '否', leader, '高危介质：双阀隔离 + 盲板 + 取样分析；解体：拆联轴器'],
    [2, 'E-3201', '管壳式换热器', '蜡油', '管束抽芯清洗', '否', '是', '是', '是', leader, '用火：可燃气分析 + 周边清理消防 + 用火作业许可；高温：降温条目'],
    [3, 'V-3401', '立式容器', '再生剂RX-7', '内部防腐涂层修补，需进人', '是', '否', '', '', leader, '介质不在库→最严口径 + warning；未说明带压/高温→未判定'],
    [4, 'M-3301', '电机', '', '轴承更换', '否', '否', '否', '否', leader, '电气：断电挂牌上锁 + 验电接地线；介质未填→最严口径'],
    [5, 'P-3601A', '离心泵', '混合碳四', '机械密封解体更换', '否', '否', '', '', leader, 'SAP 列名台账补全；碳四高危；未给 --pressured/--hot → 不按压力温度推断，泄压/降温未判定并标推断值待确认'],
  ],
});

console.log(JSON.stringify({ ok: true, out, date, seed, leader, files: fs.readdirSync(out).filter((f) => f.endsWith('.xlsx')) }));
