#!/usr/bin/env node
'use strict';
/**
 * 生成现场监督要点样例（可再生）。用法：node scripts/make-sample.js --out <dir> [--seed <n>] [--date <YYYY-MM-DD>]
 *
 * 本技能入参来自命令行而非附件，因此样例为「场景参数表」：
 *   - sample-scenarios.json  五个场景的参数，可直接喂给 supervise.js
 *   - sample-work-plan.xlsx  作业计划表（设备员手上常见的那张表），供人工对照抽参数
 * seed 只改变作业单位、监护人、位号尾号，**不改变结论**：
 *   场景1 单一用火（一级用火）：23 项要点（18 H + 5 S）、无加严、高风险
 *   场景2 用火+受限空间：42 项要点（18 + 19 + 5 S）、3 项加严、高风险
 *   场景3 未覆盖类型：10 项通用框架要点、generic=true
 *   场景4 介质不在库：按最严口径 + warning
 *   场景5 常规检修（低风险基础）
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
const pick = (arr) => arr[Math.floor(rnd() * arr.length) % arr.length];

const UNIT = ['一建安装三队', '中化建检修二队', '宏达防腐工程队'];
const GUARD = ['刘国强', '王建平', '赵德海', '孙立新'];

fs.mkdirSync(out, { recursive: true });

const scenarios = [
  {
    name: '单一用火作业（一级用火）',
    expect: '23 项要点：18 项来源「用火作业」+ 5 项「作业许可通用」（双监护/JSA/属地确认人）；作业票级别一级用火 → 高风险口径；无组合加严项',
    args: {
      '--work-type': '用火作业',
      '--level': '一级用火',
      '--scope': '换热器封头法兰焊缝补焊',
      '--location': 'E-1201（常压一区）',
      '--medium': '石脑油',
      '--duration': '4',
      '--headcount': '3',
      '--env': '露天、邻近运行装置',
      '--unit': pick(UNIT),
      '--start': `${date}T09:00:00+08:00`,
      '--end': `${date}T13:00:00+08:00`,
    },
  },
  {
    name: '用火 + 受限空间组合作业',
    expect: '42 项要点（18 + 19 + 5 S 系列一份）并标注来源；escalated 含 X-HC-1/2/3；高风险',
    args: {
      '--work-type': '动火作业,受限空间作业',
      '--scope': '缓冲罐内部腐蚀部位补焊',
      '--location': 'V-1301（常压一区）',
      '--medium': '硫化氢',
      '--duration': '6',
      '--headcount': '5',
      '--env': '密闭容器内、通风受限',
      '--unit': pick(UNIT),
    },
  },
  {
    name: '未覆盖作业类型',
    expect: 'generic=true，只输出 10 项通用监督框架，warning 标注「待安全专业补充」',
    args: {
      '--work-type': '放射性探伤作业',
      '--scope': '管线焊口射线探伤',
      '--location': '管廊三层（常压二区）',
      '--medium': '柴油',
      '--duration': '3',
      '--unit': pick(UNIT),
    },
  },
  {
    name: '介质不在危险特性库',
    expect: '18 项要点（13 B + 5 S）；mediumKnown=false，按最严口径（易燃易爆、有毒有害）并 warning；风险上调',
    args: {
      '--work-type': '盲板抽堵作业',
      '--scope': '进料管线加装盲板',
      '--location': `P-210${Math.floor(rnd() * 9) + 1}A 出口管线`,
      '--medium': 'XK-7 特种助剂',
      '--duration': '2',
      '--headcount': '2',
      '--unit': pick(UNIT),
    },
  },
  {
    name: '常规检修作业',
    expect: '14 项要点，来源「常规检修作业」；不纳入 S 系列；介质为低危时风险等级不上调',
    args: {
      '--work-type': '常规检修作业',
      '--scope': '循环水泵抽芯检修、更换机封',
      '--location': 'P-3101B（循环水站）',
      '--medium': '循环水',
      '--duration': '8',
      '--headcount': '4',
      '--env': '室内泵房、邻机运行',
      '--unit': pick(UNIT),
    },
  },
];

fs.writeFileSync(path.join(out, 'sample-scenarios.json'),
  JSON.stringify({ date, seed, scenarios }, null, 2), 'utf8');

// 作业计划表（作业许可系统导出列名风格）：设备员手上那张表，供人工抽取参数；**脚本不读取本文件**，参数从中人工抄到命令行
const yd = date.replace(/-/g, '').slice(2);
writeXlsx(path.join(out, 'sample-work-plan.xlsx'), {
  '作业许可台账': [
    ['许可证编号', '作业类别', '作业级别', '作业内容', '作业地点', '介质', '作业单位', '属地监护人', '作业单位监护人', '属地确认人', '计划开始', '计划结束', '作业人数', '环境条件'],
    [`YH-${yd}-001`, '用火作业', '一级', '换热器封头法兰焊缝补焊', 'E-1201（常压一区）', '石脑油', UNIT[0], pick(GUARD), pick(GUARD), '设备员周建', `${date} 09:00`, `${date} 13:00`, 3, '露天、邻近运行装置'],
    [`YH-${yd}-002 / SX-${yd}-002`, '用火作业、受限空间作业', '一级用火', '缓冲罐内部腐蚀部位补焊', 'V-1301（常压一区）', '硫化氢', UNIT[1], pick(GUARD), pick(GUARD), '设备员周建', `${date} 08:30`, `${date} 14:30`, 5, '密闭容器内、通风受限'],
    [`QT-${yd}-003`, '放射性探伤作业', '', '管线焊口射线探伤', '管廊三层（常压二区）', '柴油', UNIT[2], pick(GUARD), pick(GUARD), '设备员周建', `${date} 20:00`, `${date} 23:00`, 2, '夜间、管廊高处'],
    [`MB-${yd}-004`, '盲板抽堵作业', '', '进料管线加装盲板', 'P-2101A 出口管线', 'XK-7 特种助剂', UNIT[0], pick(GUARD), pick(GUARD), '设备员周建', `${date} 10:00`, `${date} 12:00`, 2, '地面、装置区内'],
    [`JX-${yd}-005`, '日常维修', '', '循环水泵抽芯检修、更换机封', 'P-3101B（循环水站）', '循环水', UNIT[1], pick(GUARD), pick(GUARD), '设备员周建', `${date} 08:00`, `${date} 16:00`, 4, '室内泵房、邻机运行'],
  ],
});

console.log(JSON.stringify({
  ok: true, out, date, seed,
  files: fs.readdirSync(out).filter((f) => /\.(xlsx|json)$/.test(f)).sort(),
  scenarios: scenarios.length,
}));
