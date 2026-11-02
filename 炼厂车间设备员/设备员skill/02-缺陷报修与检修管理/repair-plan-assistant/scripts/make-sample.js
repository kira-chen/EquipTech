#!/usr/bin/env node
'use strict';
/**
 * 生成检修方案样例输入（可再生）。用法：node scripts/make-sample.js --out <dir> [--seed <n>] [--date <YYYY-MM-DD>]
 *
 * seed 改变规程中的数值与编制人，但不改变结论：
 *   - sample-procedure-pump.md      恒含 力矩/间隙/对中/试压 四类可引用数值，恒含 1 处对中数值冲突
 *   - sample-procedure-partial.md   恒只含 力矩 一类数值（其余类型恒为「待查规程确认」）
 *   - sample-procedure-pump.docx    与 md 同内容，用于验证 .docx 规程可解析
 *   - sample-procedure-furnace.md   恒含 炉管壁厚/胀粗、力矩、试压 三类数值（加热炉样例）
 *   - sample-plan-cases.xlsx        7 个场景：有规程 / 无规程 / 覆盖范围外 / 未说明是否解体 / 加热炉 / 空冷器 / 仪表回路
 *
 * 注意：样例规程中的数值均为**虚构演示值**，不得用于任何真实设备。
 */
const fs = require('fs');
const path = require('path');
const { writeXlsx } = require('./lib/xlsx-lite');
const lite = require('./lib/docx-lite');
const C = require('./lib/common');

const a = C.parseArgs(process.argv.slice(2), ['out', 'seed', 'date'], []);
const out = a.out || path.join(__dirname, '..', 'examples');
const date = a.date || '2026-09-21';
const seed = a.seed ? Number(a.seed) : 1;
let s = seed * 7919 + 13;
const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const jitter = (v, p = 0.1) => Number((v * (1 + (rnd() - 0.5) * 2 * p)).toFixed(2));
const pick = (arr) => arr[Math.floor(rnd() * arr.length) % arr.length];

fs.mkdirSync(out, { recursive: true });

const editor = pick(['王工', '李工', '赵工', '孙工']);
const t1 = jitter(180), t2 = jitter(0.35), t3 = jitter(0.05), t4 = jitter(0.08), t5 = jitter(1.5), t6 = jitter(4.5), t7 = jitter(75);

// ---------------------------------------------------------------- 完整版样例规程
const pumpSpec = [
  '# 某厂《离心泵检修规程》（样例·虚构）',
  '',
  `编制：${editor}　　版本：样例版　　日期：${date}`,
  '',
  '> 本文件为技能样例，全部数值为虚构演示值，不得用于任何真实设备。',
  '',
  '## 第三章 解体与检查',
  '',
  `3.1 泵体与泵盖连接螺栓紧固力矩按 ${t1} N·m 执行，分三次对称紧固。`,
  `3.2 叶轮口环配合间隙允许值 ${t2} mm，超过该值应更换口环。`,
  `3.3 泵轴径向跳动公差不大于 ${t3} mm。`,
  '',
  '## 第四章 装配与对中',
  '',
  `4.1 联轴器对中径向偏差不大于 ${t4} mm，轴向偏差不大于 ${jitter(0.06)} mm。`,
  `4.2 一般情况下对中径向偏差按 ${jitter(0.10)} mm 控制（通用口径，与 4.1 不一致，以本规程 4.1 为准）。`,
  '',
  '## 第五章 试验与试运',
  '',
  `5.1 泵体严密性试验压力为设计压力的 1.25 倍，本型号取 ${t5} MPa，保压 30 分钟。`,
  `5.2 试运时轴承振动烈度不大于 ${t6} mm/s，轴承温度不高于 ${t7} ℃。`,
  '',
].join('\n');
fs.writeFileSync(path.join(out, 'sample-procedure-pump.md'), pumpSpec, 'utf8');

// docx 版本（验证 --spec 支持 .docx）
const paras = pumpSpec.split('\n').filter((x) => x.trim()).map((x) => lite.pXml(lite.runXml(x.replace(/^#+\s*/, ''))));
fs.writeFileSync(path.join(out, 'sample-procedure-pump.docx'), lite.buildDocx(paras.join('')));

// ---------------------------------------------------------------- 只含部分数值的规程
const partialSpec = [
  '# 某厂《检修通用紧固规定》（样例·虚构）',
  '',
  `编制：${editor}　　日期：${date}`,
  '',
  '> 本文件为技能样例，数值为虚构演示值。',
  '',
  `2.1 各类法兰与人孔螺栓紧固力矩统一按 ${jitter(220)} N·m 控制，对角分次紧固。`,
  '2.2 其余项目的技术要求见各专业检修规程，本规定不另行规定。',
  '',
].join('\n');
fs.writeFileSync(path.join(out, 'sample-procedure-partial.md'), partialSpec, 'utf8');

// ---------------------------------------------------------------- 加热炉规程（样例·虚构）：含炉管壁厚/胀粗、试压、力矩三类数值
const furnaceSpec = [
  '# 某厂《管式加热炉检修规程》（样例·虚构）',
  '',
  `编制：${editor}　　日期：${date}`,
  '',
  '> 本文件为技能样例，全部数值为虚构演示值，不得用于任何真实设备。',
  '',
  `6.1 炉管壁厚测定：壁厚减薄至 ${jitter(5.2)} mm 以下或胀粗率超过 ${jitter(3)}% 的炉管段应判废更换。`,
  `6.2 看火门与人孔法兰螺栓紧固力矩按 ${jitter(120)} N·m 执行。`,
  `6.3 炉管系统水压试验压力取 ${jitter(2.4)} MPa，保压 30 分钟。`,
  '6.4 烘炉与升温曲线按制造厂文件执行，本规程不另行规定。',
  '',
].join('\n');
fs.writeFileSync(path.join(out, 'sample-procedure-furnace.md'), furnaceSpec, 'utf8');

// ---------------------------------------------------------------- 场景对照表
writeXlsx(path.join(out, 'sample-plan-cases.xlsx'), {
  '方案场景': [
    ['序号', '位号', '设备类型', '检修内容', '规程文件', '工期(天)', '编制人', '预期要点'],
    [1, 'P-3101A', '离心泵', '机械密封解体更换（小修）', 'sample-procedure-pump.md', 3, editor, '力矩/间隙/对中/试压/振动 有出处；对中存在 1 处冲突点'],
    [2, 'C-3201', '往复式压缩机', '气缸解体检修（大修）', '（不提供）', 15, editor, '全部数值「待查规程确认」，toBeConfirmed 非空'],
    [3, 'X-3301', '离心机', '转鼓更换', '（不提供）', 2, editor, '覆盖范围外 → 只出通用框架 + warning + 待技术人员补充'],
    [4, 'E-3401', '管壳式换热器', '例行处理', 'sample-procedure-partial.md', 5, editor, '检修内容未说明是否解体 → 未判定；仅力矩有出处'],
    [5, 'F-3501', '管式加热炉', '炉管更换与烧嘴检修（大检修）', 'sample-procedure-furnace.md', 20, editor, '新增覆盖：FU 系列步骤；炉管壁厚/试压/力矩有出处，升温曲线「待查规程确认」；受限空间/高处作业提示待确认'],
    [6, 'A-3601', '空冷器', '管束抽芯检查与风机轴承更换', '（不提供）', 4, editor, '新增覆盖：AC 系列步骤；全部数值「待查规程确认」；高处/吊装作业提示待确认'],
    [7, 'PT-3701', '压力变送器回路', '变送器校验与联锁回路联校', '（不提供）', 1, editor, '新增覆盖：IN 系列步骤；联锁摘除审批为停工待检点；校验精度「待查规程确认」'],
  ],
});

console.log(JSON.stringify({
  ok: true, out, date, seed, editor,
  files: fs.readdirSync(out).filter((f) => /\.(md|docx|xlsx)$/.test(f)).sort(),
}));
