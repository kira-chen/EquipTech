#!/usr/bin/env node
'use strict';
/**
 * 自测：生成变体输入并断言 investigate.js 行为。用法：node scripts/selftest.js（全绿退出 0）
 * 重点覆盖七条硬约束：分析章节留空、因果词逐词拦截、时间戳不一致全保留、
 * 数据缺口不填补、不点名、声明行必留、拒填原因结论的说明。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { writeXlsx } = require('./lib/xlsx-lite');
const R = require('./lib/rules');

const SCRIPT = path.join(__dirname, 'investigate.js');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'fia-selftest-'));
const DATE = '2026-09-21';
const TIME = `${DATE}T10:40:00+08:00`;
let pass = 0, fail = 0;
const failures = [];

// 用例分级（见 文档/规范/自测用例分级规范.md）：SELFTEST_LEVEL=BVT|A|B|C 只跑该级及更高优先级的节，不设时跑全量
const LEVELS = ['BVT', 'A', 'B', 'C'];
const RUN_LEVEL = LEVELS.indexOf(String(process.env.SELFTEST_LEVEL || 'C').toUpperCase());
if (RUN_LEVEL < 0) { console.error(`SELFTEST_LEVEL 只能取 ${LEVELS.join('、')}`); process.exit(2); }
const byLevel = { BVT: 0, A: 0, B: 0, C: 0 };
let curLevel = null;
function section(level, fn) {
  if (!LEVELS.includes(level)) throw new Error(`未知用例级别 ${level}`);
  if (LEVELS.indexOf(level) > RUN_LEVEL) return;
  curLevel = level; fn(); curLevel = null;
}
const ok = (c, n) => {
  if (!curLevel) throw new Error(`断言须写在 section() 内：${n}`);
  byLevel[curLevel]++;
  if (c) pass++; else { fail++; failures.push(`[${curLevel}] ${n}`); }
};
function eq(actual, expect, name) { ok(actual === expect, `${name}（期望 ${JSON.stringify(expect)}，实际 ${JSON.stringify(actual)}）`); }

function run(records, extra = [], tag) {
  const out = path.join(work, (tag || 'run') + '-out');
  const r = spawnSync(process.execPath, [SCRIPT, '--tag', 'P-3201A', '--time', TIME,
    '--symptom', '泵体异响、振动升高', '--records', records, '--out', out, ...extra], { encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  let summary;
  try { summary = JSON.parse(lines[lines.length - 1]); } catch (e) { summary = { ok: false, error: 'no-json:' + r.stdout + r.stderr }; }
  let json = null, md = null;
  if (fs.existsSync(path.join(out, 'investigation.json'))) json = JSON.parse(fs.readFileSync(path.join(out, 'investigation.json'), 'utf8'));
  if (fs.existsSync(path.join(out, 'investigation.md'))) md = fs.readFileSync(path.join(out, 'investigation.md'), 'utf8');
  return { code: r.status, summary, json, md, out };
}
function mk(name, book) { const p = path.join(work, name); writeXlsx(p, book); return p; }
let r, x;
const CAUSAL_WORDS = [
  ['导致', 'C1'], ['因此', 'C2'], ['造成', 'C3'], ['引起', 'C4'],
  ['说明', 'C5'], ['由于', 'C6'], ['致使', 'C7'], ['所致', 'C8'],
];
const base = mk('base.xlsx', {
  '运行参数': [
    ['时间', '位号', '参数名', '参数值', '单位', '来源'],
    [`${DATE} 08:00`, 'P-3201A', '轴承温度', 76, '℃', 'DCS'],
    [`${DATE} 09:00`, 'P-3201A', '振动速度', 5.2, 'mm/s', 'DCS'],
    [`${DATE} 10:00`, 'P-3201A', '振动速度', 8.6, 'mm/s', 'DCS'],
  ],
  '报警记录': [
    ['报警时间', '位号', '报警内容', '报警级别'],
    [`${DATE} 10:12`, 'P-3201A', '轴承温度高报', '高'],
    [`${DATE} 10:33`, 'P-3201A', '振动高报', '高高'],
  ],
  '操作记录': [
    ['操作时间', '位号', '操作内容', '岗位'],
    [`${DATE} 10:47`, 'P-3201A', '切换至备用泵，A 泵停运隔离', '外操'],
  ],
});
const incon = mk('incon.xlsx', {
  '操作记录': [
    ['操作时间', '位号', '操作内容', '来源'],
    [`${DATE} 10:35`, 'P-3201A', '现场确认泵体异响并汇报', 'DCS操作站'],
  ],
  '值班记录': [
    ['时间', '位号', '记录内容', '来源'],
    [`${DATE} 10:42`, 'P-3201A', '现场确认泵体异响并汇报', '手工值班记录'],
  ],
  '巡检记录': [
    ['巡检时间', '位号', '检查结果', '来源'],
    [`${DATE} 10:50`, 'P-3201A', '现场确认泵体异响并汇报', '巡检APP'],
  ],
});
const gapFile = mk('gap.xlsx', {
  '运行参数': [
    ['时间', '位号', '参数名', '参数值', '单位', '来源'],
    [`${DATE} 06:00`, 'P-3201A', '轴承温度', 70, '℃', 'DCS'],
    [`${DATE} 10:00`, 'P-3201A', '轴承温度', 88, '℃', 'DCS'],   // 间隔 240 分钟 > 120
  ],
});
const blame = mk('blame.xlsx', {
  '操作记录': [
    ['操作时间', '位号', '操作内容'],
    [`${DATE} 10:35`, 'P-3201A', '当班操作工王建国操作不当，处理不及时'],
    [`${DATE} 10:50`, 'P-3201A', '已通知钳工班组张师傅到场确认'],
  ],
});
const hist = mk('hist.xlsx', {
  '检修历史': [
    ['检修日期', '位号', '检修类别', '检修内容', '验收结论'],
    ['2026-03-18', 'P-3201A', '大修', '更换机械密封', '合格'],
    ['2026-08-30', 'P-3201A', '消缺', '处理泵体渗漏', '合格'],
    ['', 'P-3201A', '小修', '日期不详', ''],
  ],
});
function runRaw(args) {
  const rr = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  const lines = rr.stdout.trim().split('\n');
  try { return { code: rr.status, s: JSON.parse(lines[lines.length - 1]) }; } catch (e) { return { code: rr.status, s: { ok: false, error: 'no-json' } }; }
}
const OKARGS = ['--tag', 'P-1', '--time', TIME, '--symptom', '异响', '--records', base];

// ================================================================ 1. 规则引擎单元：因果词逐词覆盖
section('C', () => {
  for (const [w, id] of CAUSAL_WORDS) {
    const hits = R.scanCausal(`轴承温度升高${w}振动增大`, '时间线');
    ok(hits.some((h) => h.text === w && h.ruleId === id), `1.x 因果词「${w}」命中规则 ${id}`);
    ok(hits.every((h) => h.severity === 'block'), `1.x 因果词「${w}」判定为必须改写`);
  }
  ok(R.scanCausal('因而振动增大', '时间线').some((h) => h.ruleId === 'C2'), '1.9 因果词「因而」命中 C2');
  ok(R.scanCausal('引发泄漏', '时间线').some((h) => h.ruleId === 'C4'), '1.10 因果词「引发」命中 C4');
  ok(R.scanCausal('表明存在磨损', '时间线').some((h) => h.ruleId === 'C5'), '1.11 推论词「表明」命中 C5');
  // C5 只拦推论句式：名词性/非推论用法不命中
  ok(R.scanCausal('报警序列说明密封已失效', '时间线').some((h) => h.ruleId === 'C5' && h.severity === 'block'), '1.11a 「说明密封已失效」推论句式命中 C5 且为 block');
  ok(R.scanCausal('反映出润滑不足', '时间线').some((h) => h.ruleId === 'C5'), '1.11b 「反映出……」命中 C5');
  eq(R.scanCausal('按设备说明书操作', '时间线').filter((h) => h.ruleId === 'C5').length, 0, '1.11c 「说明书」不命中 C5');
  eq(R.scanCausal('使用说明见附件', '时间线').filter((h) => h.ruleId === 'C5').length, 0, '1.11d 「使用说明」不命中 C5');
  eq(R.scanCausal('情况说明：泵已停运', '时间线').filter((h) => h.ruleId === 'C5').length, 0, '1.11e 「情况说明：」不命中 C5');
  eq(R.scanCausal('已向班长说明', '时间线').filter((h) => h.ruleId === 'C5').length, 0, '1.11f 句尾「向班长说明」不命中 C5');
  eq(R.scanCausal('值班记录说明栏为空', '时间线').filter((h) => h.ruleId === 'C5').length, 0, '1.11g 「说明栏」不命中 C5');
  eq(R.scanCausal('补充说明如下', '时间线').filter((h) => h.ruleId === 'C5').length, 0, '1.11h 「说明如下」不命中 C5');
  ok(R.scanCausal('根本原因是润滑不足', '时间线').some((h) => h.ruleId === 'C8'), '1.12 「根本原因」命中 C8');
  eq(R.scanCausal('10时35分现场确认泵体异响并汇报班长', '时间线').length, 0, '1.13 纯事实时序陈述不误报');
  eq(R.scanCausal('', '时间线').length, 0, '1.14 空文本返回空数组');
  ok(R.scanCausal('导致振动增大导致停泵', '时间线').filter((h) => h.ruleId === 'C1').length === 2, '1.15 同一词多次出现全部命中');
  ok(R.scanCausal('导致振动', '时间线')[0].index === 0, '1.16 命中位置可定位');
});

// ================================================================ 2. 规则引擎单元：定性/责任/推测
section('C', () => {
  ok(R.scanCausal('本次事故的处理', '现象').some((h) => h.ruleId === 'J1'), '2.1 「事故」命中 J1 定性类');
  // J1 负向排除（与 equipment-event-notice 的 S41 同源，词表须一致）
  for (const w of ['事故池液位正常', '事故柜钥匙在位', '事故照明投用', '事故状态下切泵', '事故应急柴油泵试运']) {
    eq(R.scanCausal(w, '现象').filter((h) => h.ruleId === 'J1').length, 0, `2.1x 「${w}」不命中 J1（现场正常名词）`);
  }
  ok(R.scanCausal('事故原因待查', '现象').some((h) => h.ruleId === 'J1'), '2.1y 「事故原因」仍命中 J1');
  // 规则同源：J1 与 event-notice S41 的负向排除词表一致
  try {
    const enRulesPath = path.join(__dirname, '..', '..', '..', '06-报表与沟通', 'equipment-event-notice', 'scripts', 'lib', 'rules.js');
    if (fs.existsSync(enRulesPath)) {
      const EN = require(enRulesPath);
      const s41 = (EN.SPEC_RULES || []).find((x) => x.id === 'S41');
      const j1 = R.JUDGMENT_RULES.find((x) => x.id === 'J1');
      ok(s41 && j1 && s41.re.source === j1.re.source, '2.1z J1 与 equipment-event-notice S41 的「事故」正则同源一致');
    } else ok(true, '2.1z（event-notice 不在同一开发库，跳过同源比对）');
  } catch (e) { ok(true, '2.1z（event-notice 规则无法加载，跳过同源比对：' + e.message + '）'); }
  // 检修分级映射（《中石化口径对照》第五节）
  eq(R.normRepairCategory('大修'), '装置大检修', '2.9 大修→装置大检修');
  eq(R.normRepairCategory('中修'), '日常维修', '2.10 中修→日常维修');
  eq(R.normRepairCategory('小修'), '日常维修', '2.11 小修→日常维修');
  eq(R.normRepairCategory('PM03'), '抢修', '2.12 PM03→抢修');
  eq(R.normRepairCategory('PM02'), null, '2.13 PM02（计划检修，厂内可配置）不猜→null');
  eq(R.normRepairCategory('技改'), '专项（技改技措）', '2.14 技改→专项');
  eq(R.normRepairCategory('随便写'), null, '2.15 无法映射→null 不猜');
  eq(R.normRepairCategory(''), null, '2.16 空→null');
  ok(R.scanCausal('认定为一般设备事故', '现象').some((h) => h.ruleId === 'J2'), '2.2 「认定为」命中 J2');
  ok(R.scanCausal('责任在当班班组', '现象').some((h) => h.ruleId === 'J3'), '2.3 「责任在」命中 J3 责任类');
  ok(R.scanCausal('操作不当', '现象').some((h) => h.ruleId === 'J4'), '2.4 「操作不当」命中 J4');
  ok(R.scanCausal('初步判断为润滑不足', '现象').some((h) => h.ruleId === 'J5'), '2.5 「初步判断」命中 J5 推测类');
  ok(R.scanCausal('可能是密封失效', '现象').some((h) => h.ruleId === 'J5'), '2.6 「可能是」命中 J5');
  ok(R.scanCausal('怀疑轴承磨损', '现象').some((h) => h.ruleId === 'J5'), '2.7 「怀疑」命中 J5');
  ok(R.scanCausal('违章作业', '现象').some((h) => h.ruleId === 'J4'), '2.8 「违章」命中 J4');
});

// ================================================================ 3. 规则引擎单元：个人追责
section('C', () => {
  ok(R.scanBlameNames('当班操作工王建国操作不当', '操作记录').some((h) => h.ruleId === 'N1' && h.text === '王建国'), '3.1 姓名+职务+追责词命中 N1');
  eq(R.scanBlameNames('已通知钳工班组张师傅到场确认', '操作记录').length, 0, '3.2 无追责词的事实陈述不误报');
  eq(R.scanBlameNames('切换至备用泵 P-3201B', '操作记录').length, 0, '3.3 纯设备操作不误报');
  ok(R.scanBlameNames('班长李强违章指挥', '操作记录').some((h) => h.ruleId === 'N1'), '3.4 后置追责词命中');
  ok(R.scanBlameNames('当班操作工王建国操作不当', '操作记录')[0].severity === 'block', '3.5 N1 判定为必须改写');
});

// ================================================================ 4. 待查材料清单
section('C', () => {
  const tiFull = R.buildToInvestigate({ alarms: 3, maintenanceHistory: 2, dutyLogs: 2, dataGaps: 0, timeInconsistency: 0 });
  ok(tiFull.every((x) => x.id !== 'T2' && x.id !== 'T4' && x.id !== 'T6' && x.id !== 'T11' && x.id !== 'T12'), '4.1 条件项在资料齐全时不出现');
  const tiEmpty = R.buildToInvestigate({ alarms: 0, maintenanceHistory: 0, dutyLogs: 0, dataGaps: 2, timeInconsistency: 1 });
  ok(tiEmpty.some((x) => x.id === 'T2') && tiEmpty.some((x) => x.id === 'T4'), '4.2 缺报警/缺检修时补入 T2/T4');
  ok(tiEmpty.some((x) => x.id === 'T11'), '4.3 有数据缺口时补入 T11（缺口时段其他来源记录）');
  ok(tiEmpty.some((x) => x.id === 'T12'), '4.4 时间戳不一致时补入 T12（对时记录）');
  ok(tiFull.every((x) => !/原因|定性|责任/.test(x.item)), '4.5 清单不含原因/定性/责任指向');
});

// ================================================================ 5. 正常路径
section('BVT', () => {
  r = run(base, [], 'base');
  eq(r.summary.ok, true, '5.1 基础运行成功');
  eq(r.summary.counts.timeline, 6, '5.2 时间线条目数');
  eq(r.summary.counts.alarms, 2, '5.3 报警条目数');
  eq(r.summary.counts.paramChanges, 3, '5.4 运行参数条目数');
  eq(r.summary.counts.causalHits, 0, '5.5 无禁用表述');
  ok(r.json.timeline[0].time <= r.json.timeline[1].time, '5.6 时间线按时间升序');
  ok(r.json.timeline.every((x) => x.source && x.dataType && x.content), '5.7 每条含时间/来源/内容/数据类型');
  ok(r.json.timeline.some((x) => x.offsetHours < 0) && r.json.timeline.some((x) => x.offsetHours > 0), '5.8 相对故障时刻有正有负');
  eq(r.json.meta.window.before, 72, '5.9 默认回溯 72 小时');
  eq(r.json.meta.window.after, 24, '5.10 默认后续 24 小时');
  ok(fs.existsSync(path.join(r.out, 'summary.json')), '5.11 summary.json 已写入');
  ok(fs.existsSync(path.join(r.out, 'investigation.json')), '5.12 investigation.json 已写入');
  ok(fs.existsSync(path.join(r.out, 'investigation.md')), '5.13 investigation.md 已写入');
});

// ================================================================ 6. 硬约束一：分析与结论章节必须留空
section('A', () => {
  function section(md, head) {
    const i = md.indexOf(head); if (i < 0) return '';
    const rest = md.slice(i);
    const j = rest.indexOf('\n## '); const k = rest.indexOf('\n---');
    return rest.slice(0, j >= 0 ? j : (k >= 0 ? k : rest.length));
  }
  const body7 = section(r.md, '## 七、原因分析');
  ok(/## 七、原因分析/.test(r.md), '6.1 存在「七、原因分析」章节');
  ok(body7.includes('（由调查组填写）'), '6.2 原因分析章节标注「由调查组填写」');
  const body8 = section(r.md, '## 八、责任分析');
  const body10 = section(r.md, '## 十、防范措施');
  const body9 = section(r.md, '## 九、损失情况');
  ok(body8.includes('（由调查组填写）'), '6.8 责任分析章节标注「由调查组填写」');
  ok(body10.includes('（由调查组填写）'), '6.9 防范措施章节标注「由调查组填写」');
  ok(/四不放过/.test(body10), '6.10 防范措施章节注明「四不放过」');
  ok(/由调查组核定/.test(body9) && /不估算/.test(body9), '6.11 损失情况由调查组核定，脚本不估算');
  ok(!/\d+\s*(元|万元|小时|h)/.test(body9), '6.12 损失情况章节无任何脚本生成的数值');
  ok(!/原因是|根本原因|认定为|定性为|建议.{0,6}(更换|加强|整改)/.test(body8 + body10), '6.13 责任/防范措施章节不含认定与措施建议');
  eq(r.json.analysis.cause, null, '6.14 JSON analysis.cause 为 null');
  eq(r.json.analysis.responsibility, null, '6.15 JSON analysis.responsibility 为 null');
  eq(r.json.analysis.loss, null, '6.16 JSON analysis.loss 为 null');
  eq(r.json.analysis.measures, null, '6.17 JSON analysis.measures 为 null');
  ok(Array.isArray(r.json.meta.reportFramework) && r.json.meta.reportFramework.length === 10, '6.18 meta.reportFramework 十节');
  ok(/原因未查清不放过/.test(r.json.analysis.principle), '6.19 JSON 注明四不放过由调查组落实');
  const between = body7.slice(body7.indexOf('<!-- ANALYSIS_START -->') + '<!-- ANALYSIS_START -->'.length, body7.indexOf('<!-- ANALYSIS_END -->'));
  eq(between.trim(), '', '6.3 ANALYSIS 占位符之间为空（无任何结论文字）');
  ok(!/原因是|根本原因|认定为|定性为/.test(body7), '6.4 分析章节不含原因认定与定性用语');
  eq(r.json.analysis.conclusion, null, '6.5 JSON 中 analysis.conclusion 为 null');
  eq(r.json.analysis.filledBy, '调查组', '6.6 JSON 标明由调查组填写');
  ok(/<!-- ANALYSIS_START -->/.test(r.md) && /<!-- ANALYSIS_END -->/.test(r.md), '6.7 分析段占位符存在');
});

// ================================================================ 7. 硬约束二：时间线因果词拦截（端到端逐词）
section('A', () => {
  for (const [w, id] of CAUSAL_WORDS) {
    const f = mk(`causal-${id}.xlsx`, {
      '操作记录': [
        ['操作时间', '位号', '操作内容'],
        [`${DATE} 10:35`, 'P-3201A', `轴承温度升高${w}振动增大`],
      ],
    });
    const rr = run(f, [], `causal-${id}`);
    ok(rr.summary.counts.causalHits >= 1, `7.x 端到端检出因果词「${w}」`);
    ok(rr.json.causalHits.some((h) => h.ruleId === id && h.text === w), `7.x 因果词「${w}」规则号 ${id} 可追溯`);
    ok(rr.summary.warnings.some((x) => x.includes(w) && x.includes(id)), `7.x 因果词「${w}」产生 warning`);
    ok(/## 附一、检出的禁用表述/.test(rr.md), `7.x 因果词「${w}」列入附一`);
    ok(rr.md.includes(`轴承温度升高${w}振动增大`), `7.x 因果词「${w}」原文未被脚本删改`);
  }
});

// ================================================================ 8. 硬约束三：时间戳不一致全部保留、绝不校准
section('A', () => {
  r = run(incon, [], 'incon');
  eq(r.summary.counts.timeInconsistency, 1, '8.1 检出 1 组时间戳不一致');
  const ti = r.json.timeInconsistency[0];
  eq(ti.records.length, 3, '8.2 三条来源记录全部保留，未取其一');
  eq(ti.maxDiffMinutes, 15, '8.3 最大差异分钟数正确（10:35~10:50）');
  ok(ti.records.some((x) => x.source === 'DCS操作站') && ti.records.some((x) => x.source === '手工值班记录') && ti.records.some((x) => x.source === '巡检APP'), '8.4 每条标注来源');
  ok(new Set(ti.records.map((x) => x.time)).size === 3, '8.5 三个不同时间戳均原样保留，未被校准为同一值');
  eq(r.summary.counts.timeline, 3, '8.6 时间线保留全部三条，未去重合并');
  ok(/不校准时间、不取其一/.test(r.md), '8.7 md 写明不校准不取其一');
  ok(r.summary.warnings.some((w) => w.includes('时间戳不一致') && w.includes('未作校准')), '8.8 时间戳不一致 warning');
  ok(/差异原因须由调查组核实/.test(r.md), '8.9 差异原因交由调查组核实，脚本不判断');
  ok(r.json.toInvestigate.some((x) => x.id === 'T12'), '8.10 自动补入对时记录待查项');

  // 同来源同内容不同时间 → 不算来源不一致
  const sameSrc = mk('samesrc.xlsx', {
    '操作记录': [
      ['操作时间', '位号', '操作内容', '来源'],
      [`${DATE} 10:35`, 'P-3201A', '巡回检查', 'DCS操作站'],
      [`${DATE} 10:50`, 'P-3201A', '巡回检查', 'DCS操作站'],
    ],
  });
  r = run(sameSrc, [], 'samesrc');
  eq(r.summary.counts.timeInconsistency, 0, '8.11 同一来源重复记录不判为来源间不一致');
});

// ================================================================ 9. 硬约束四：数据缺口标注，绝不插值填补
section('A', () => {
  r = run(gapFile, ['--before', '6', '--after', '2'], 'gap');
  ok(r.summary.counts.dataGaps >= 1, '9.1 检出数据缺口');
  const midGap = r.json.dataGaps.find((g) => g.position === '相邻记录之间');
  ok(!!midGap, '9.2 相邻记录缺口被标注');
  eq(midGap.minutes, 240, '9.3 缺口时长正确');
  eq(midGap.from, `${DATE} 06:00`, '9.4 缺口起点为前一条记录时间');
  eq(midGap.to, `${DATE} 10:00`, '9.5 缺口止点为后一条记录时间');
  ok(/未作插值或推测填补/.test(midGap.note), '9.6 缺口注明未插值填补');
  eq(r.summary.counts.paramChanges, 2, '9.7 缺口区间未被插值补出新条目');
  ok(r.json.paramChanges.every((x) => x.time === `${DATE} 06:00` || x.time === `${DATE} 10:00`), '9.8 参数条目仍只有原始两条');
  ok(/不作插值、不作推测填补/.test(r.md), '9.9 md 写明不插值不填补');
  ok(r.json.toInvestigate.some((x) => x.id === 'T11'), '9.10 有缺口时补入 T11 待查项');
  // 窗口内完全无运行参数 → 整窗记为缺口
  r = run(incon, [], 'nogapdata');
  ok(r.json.dataGaps.some((g) => g.position === '整个时间窗口'), '9.11 无连续采样数据时整窗记为缺口');
  ok(r.summary.warnings.some((w) => w.includes('未提供运行参数')), '9.12 无运行参数数据 warning');
  // 事件型记录不按缺口论
  ok(r.json.dataGaps.every((g) => g.dataType === '运行参数'), '9.13 操作/值班等事件型记录不判缺口');
});
// 窗口终点晚于当前时间（平台取数时 --after 常超过当前时刻）：尚未到达的时段没有数据是正常的，不计缺口
section('B', () => {
  {
    const C2 = require('./lib/common');
    const nowMs = Date.now();
    const hm = (ms) => C2.localDateTime(new Date(ms)).slice(0, 16);
    const evIso = new Date(nowMs - 2 * 3600000).toISOString();
    const runAt = (file, name) => {
      const out = path.join(work, name + '-out');
      spawnSync(process.execPath, [SCRIPT, '--tag', 'P-3201A', '--time', evIso, '--symptom', '振动升高', '--records', file,
        '--before', '4', '--after', '24', '--gap', '120', '--out', out], { encoding: 'utf8' });
      return JSON.parse(fs.readFileSync(path.join(out, 'investigation.json'), 'utf8'));
    };
    const hdr = ['时间', '位号', '参数名', '参数值', '单位', '来源'];
    const futA = mk('future-a.xlsx', { '运行参数': [hdr, ...[-5, -4, -3, -2, -1].map((h) => [hm(nowMs + h * 3600000), 'P-3201A', '轴承温度', 70, '℃', 'DCS'])] });
    const jA = runAt(futA, 'future-a');
    eq(jA.dataGaps.length, 0, '9.14 窗口终点晚于当前时间：末条记录之后尚未到达的时段不计数据缺口');
    ok(jA.warnings.some((w) => /晚于当前时间/.test(w)), '9.15 窗口终点晚于当前时间时 warning 说明缺口只判到当前时间');
    ok(!jA.toInvestigate.some((x) => x.id === 'T11'), '9.16 未到时段不触发 T11 缺口待查项');
    const futB = mk('future-b.xlsx', { '运行参数': [hdr, ...[-5, -4].map((h) => [hm(nowMs + h * 3600000), 'P-3201A', '轴承温度', 70, '℃', 'DCS'])] });
    const jB = runAt(futB, 'future-b');
    const tail = jB.dataGaps.find((g) => /末条记录/.test(g.position));
    ok(!!tail && tail.minutes >= 235 && tail.minutes <= 245, '9.17 当前时间之前的尾部空档仍记缺口，止点为当前时间（约 240 分钟）');
  }
});

// ================================================================ 10. 硬约束五：不涉及姓名与追责性内容
section('A', () => {
  r = run(blame, [], 'blame');
  ok(r.json.causalHits.some((h) => h.ruleId === 'N1' && h.text === '王建国'), '10.1 检出姓名追责表述 N1');
  ok(r.json.causalHits.some((h) => h.ruleId === 'J4'), '10.2 同时检出责任认定表述 J4');
  ok(!r.json.causalHits.some((h) => h.ruleId === 'N1' && h.text === '张师傅'), '10.3 无追责词的姓名不误报');
  ok(r.summary.warnings.some((w) => w.includes('N1')), '10.4 N1 产生 warning');
  ok(/改为岗位或班组/.test(r.md), '10.5 md 给出改为岗位表述的建议');
});

// ================================================================ 11. 硬约束六：声明行必须保留
section('A', () => {
  for (const [tag, res, extra] of [['decl-base', base, []], ['decl-blame', blame, []], ['decl-gap', gapFile, ['--before', '6', '--after', '2']]]) {
    const rr = run(res, extra, tag);
    ok(rr.md.includes(R.DISCLAIMER), `11.x ${tag} 保留声明行原文`);
  }
  eq(R.DISCLAIMER, '本材料为调查辅助归集，不含原因认定与事故定性；故障原因、性质与责任须由依规成立的调查组认定', '11.4 声明行文字与 SKILL.md 一致');
  r = run(base, [], 'decl-tail');
  ok(r.md.trim().endsWith(R.DISCLAIMER_GENERAL), '11.5 通用声明行位于 md 末尾');
  ok(r.md.trim().endsWith(R.DISCLAIMER + '。\n\n' + R.DISCLAIMER_GENERAL), '11.5a 专用声明行紧接在通用声明行之前');
  ok(r.json.meta.disclaimer === R.DISCLAIMER, '11.6 JSON meta 含声明行');
  eq(R.DISCLAIMER_GENERAL, '本材料由脚本汇总、模型成文，仅供设备员复核参考，不替代审批、定性、验收与签字；厂内制度与系统数据为准。', '11.7 通用声明行与《中石化口径对照》第九节一致');
  eq(r.json.meta.disclaimerGeneral, R.DISCLAIMER_GENERAL, '11.8 JSON meta 含通用声明行');
  ok((r.md.match(/本材料由脚本汇总、模型成文/g) || []).length >= 2, '11.9 通用声明行开头与末尾各一处');
  // 事故分级与报送衔接：只提示不判定
  ok(/中国石化设备事故管理规定/.test(r.md) && /非计划停工/.test(r.md), '11.10 md 衔接《设备事故管理规定》与非计划停工');
  ok(/报送时限以厂内规定为准，本技能不判定/.test(r.md), '11.11 md 写明报送时限不判定');
  eq(r.json.meta.gradingNote, R.GRADING_NOTE, '11.12 JSON 含分级衔接说明');
  ok(!/事故等级[：:]\s*(一般|较大|重大|特别重大)/.test(r.md), '11.13 md 不给出事故等级');
});
section('C', () => {
  ok(!/[⚠✅❌✓✗]|[\u{1F300}-\u{1FAFF}]/u.test(r.md), '11.14 md 不含 emoji');
  ok(/【注意】/.test(r.md), '11.15 md 醒目提示用【注意】');
});

// ================================================================ 12. 硬约束七：拒填原因结论的说明
section('A', () => {
  ok(r.json.meta.scopeNote === R.REFUSAL_NOTE, '12.1 JSON 含「本技能不提供原因认定」说明');
  ok(/本技能不提供原因认定、事故定性与责任划分内容/.test(r.md), '12.2 md 写明本技能不提供该内容');
  ok(/须由依规成立的调查组填写/.test(r.md), '12.3 md 指明由调查组填写');
  ok(!/^原因[:：]/m.test(r.md), '12.4 md 中没有「原因：」一栏');
});

// ================================================================ 13. 时间戳缺失与超窗记录
section('B', () => {
  const edge = mk('edge.xlsx', {
    '报警记录': [
      ['报警时间', '位号', '报警内容'],
      [`${DATE} 10:12`, 'P-3201A', '轴承温度高报'],
      ['', 'P-3201A', '油位低报'],
      ['不是时间', 'P-3201A', '压力低报'],
    ],
    '值班记录': [
      ['时间', '位号', '记录内容'],
      ['2026-08-15 09:00', 'P-3201A', '例行记录'],
    ],
  });
  r = run(edge, [], 'edge');
  eq(r.summary.counts.missingTime, 2, '13.1 时间戳缺失 2 条（空 + 无法解析）');
  ok(r.json.missingTime.every((x) => /未推测补齐/.test(x.note)), '13.2 缺失时间戳注明未推测补齐');
  eq(r.summary.counts.outOfWindow, 1, '13.3 超窗记录 1 条');
  ok(r.json.outOfWindow[0].note.includes('不在时间窗口'), '13.4 超窗记录注明原因');
  eq(r.summary.counts.alarms, 1, '13.5 超窗与缺时间戳记录不进时间线');
  ok(r.summary.warnings.some((w) => w.includes('超出时间窗口')), '13.6 超窗 warning');
  ok(r.summary.warnings.some((w) => w.includes('不推测补齐')), '13.7 时间戳缺失 warning');
  ok(/### 5.4 超出时间窗口的记录/.test(r.md), '13.8 md 单列超窗记录');
  ok(/### 5.3 时间戳缺失条目/.test(r.md), '13.9 md 单列时间戳缺失条目');
});

// ================================================================ 14. 数值无法解析 → null 不是 0
section('A', () => {
  const badnum = mk('badnum.xlsx', {
    '运行参数': [
      ['时间', '位号', '参数名', '参数值', '单位'],
      [`${DATE} 10:00`, 'P-3201A', '出口压力', '待查', 'MPa'],
      [`${DATE} 10:20`, 'P-3201A', '出口压力', '', 'MPa'],
      [`${DATE} 10:30`, 'P-3201A', '出口压力', 1.6, 'MPa'],
    ],
  });
  r = run(badnum, [], 'badnum');
  eq(r.json.paramChanges[0].value, null, '14.1 无法解析的参数值为 null');
  ok(r.json.paramChanges[0].value !== 0, '14.2 无法解析的参数值不是 0');
  eq(r.json.paramChanges[1].value, null, '14.3 空参数值为 null');
  eq(r.json.paramChanges[2].value, 1.6, '14.4 正常数值正确解析');
  ok(r.summary.warnings.some((w) => w.includes('无法解析为数字')), '14.5 数值无法解析 warning');
  ok(/\| — \|/.test(r.md), '14.6 md 中 null 显示为「—」');
  ok(r.json.paramChanges[0].note.includes('未按 0 计'), '14.7 注明未按 0 计');
});

// ================================================================ 15. 缺表缺列不中断
section('B', () => {
  const partial = mk('partial.xlsx', {
    '报警记录': [
      ['报警时间', '位号', '报警内容'],
      [`${DATE} 10:12`, 'P-3201A', '轴承温度高报'],
    ],
  });
  r = run(partial, [], 'partial');
  eq(r.summary.ok, true, '15.1 仅报警一张表仍成功');
  eq(r.summary.counts.paramChanges, 0, '15.2 无运行参数表时计数为 0');
  eq(r.summary.counts.maintenanceHistory, 0, '15.3 无检修历史时计数为 0');
  ok(/未提供运行参数数据/.test(r.md), '15.4 md 写明未提供运行参数数据');
  ok(/未提供检修历史数据/.test(r.md), '15.5 md 写明未提供检修历史数据');
  ok(r.json.toInvestigate.some((x) => x.id === 'T4'), '15.6 缺检修历史时补入 T4 待查项');
  // 缺必需列 → warning 不中断
  const misscol = mk('misscol.xlsx', {
    '报警记录': [
      ['报警时间', '位号'],
      [`${DATE} 10:12`, 'P-3201A'],
    ],
  });
  r = run(misscol, [], 'misscol');
  eq(r.summary.ok, true, '15.7 缺「内容」列不中断');
  ok(r.summary.warnings.some((w) => w.includes('缺少列')), '15.8 缺列 warning');
  ok(r.json.timeline[0].content === '（记录内容为空）', '15.9 内容为空时标注为空，不推测');

  // 无任何已知工作表 → ok:false + exit 1
  const nosheet = mk('nosheet.xlsx', { '随便一张表': [['a', 'b'], [1, 2]] });
  r = run(nosheet, [], 'nosheet');
  eq(r.summary.ok, false, '15.10 无已知工作表时 ok:false');
  eq(r.code, 1, '15.11 退出码为 1');
  ok(/未在输入中找到/.test(r.summary.error), '15.12 错误信息明确');
});

// ================================================================ 16. 合计行跳过 + 标题行表头识别 + 别名列头
section('B', () => {
  const exp = mk('export.xlsx', {
    '运行参数': [
      ['某某炼化厂 DCS 历史数据导出'],
      [],
      ['时刻', '测点', '数值', '计量单位', '数据来源'],
      [`${DATE} 10:00`, '出口压力', 1.85, 'MPa', 'DCS'],
      [`${DATE} 10:30`, '出口压力', 1.6, 'MPa', 'DCS'],
      ['合计', '', '', '', ''],
    ],
  });
  r = run(exp, [], 'export');
  eq(r.summary.ok, true, '16.1 导出风格可读');
  eq(r.summary.counts.paramChanges, 2, '16.2 合计行被跳过');
  ok(r.summary.warnings.some((w) => w.includes('合计行')), '16.3 合计行 warning');
  eq(r.json.paramChanges[0].param, '出口压力', '16.4 别名列头「测点」识别为参数名');
  eq(r.json.paramChanges[0].value, 1.85, '16.5 别名列头「数值」识别为参数值');
  eq(r.json.paramChanges[0].source, 'DCS', '16.6 别名列头「数据来源」识别为来源');
});

// ================================================================ 17. 时间窗口参数
section('B', () => {
  r = run(base, ['--before', '12', '--after', '6'], 'window');
  eq(r.json.meta.window.before, 12, '17.1 --before 生效');
  eq(r.json.meta.window.after, 6, '17.2 --after 生效');
  ok(/故障前 12 小时至故障后 6 小时/.test(r.md), '17.3 md 写明时间窗口');
  eq(r.json.meta.window.defaulted.before, false, '17.3a 传了 --before 后 defaulted.before=false');
  eq(r.json.meta.window.defaulted.after, false, '17.3b 传了 --after 后 defaulted.after=false');
  eq(r.json.meta.window.defaulted.gap, true, '17.3c 未传 --gap 时 defaulted.gap=true');
  ok(/【注意】本次 缺口阈值 使用了经验默认值/.test(r.md), '17.3d 只有缺口阈值用默认时 md 只提示缺口阈值');
  const rDef = run(base, [], 'window-def');
  ok(rDef.json.meta.window.defaulted.before && rDef.json.meta.window.defaulted.after && rDef.json.meta.window.defaulted.gap, '17.3e 全部未传时 defaulted 三项均 true');
  ok(/【注意】本次 回溯时长、后续时长、缺口阈值 使用了经验默认值/.test(rDef.md), '17.3f md 提示三项经验默认');
  ok(/经验默认，不是制度规定/.test(rDef.md) && /须与用户确认/.test(rDef.md), '17.3g md 写明经验默认须与用户确认');
  eq(rDef.json.meta.defaultsNote, R.DEFAULTS_NOTE, '17.3h JSON 含默认值说明');
  const rAll = run(base, ['--before', '12', '--after', '6', '--gap', '90'], 'window-all');
  ok(!/使用了经验默认值/.test(rAll.md), '17.3i 三项都传时不再提示经验默认');
  const narrow = mk('narrow.xlsx', {
    '报警记录': [
      ['报警时间', '位号', '报警内容'],
      [`${DATE} 10:12`, 'P-3201A', '窗口内'],
      [`${DATE} 06:00`, 'P-3201A', '窗口外'],
    ],
  });
  r = run(narrow, ['--before', '1', '--after', '1'], 'narrow');
  eq(r.summary.counts.timeline, 1, '17.4 窄窗口只保留窗口内记录');
  eq(r.summary.counts.outOfWindow, 1, '17.5 窗口外记录单列不丢弃');
  r = run(gapFile, ['--before', '6', '--after', '2', '--gap', '600'], 'gapthr');
  ok(!r.json.dataGaps.some((g) => g.position === '相邻记录之间'), '17.6 --gap 阈值调大后不再判为缺口');
});

// ================================================================ 18. 参数校验
section('B', () => {
  x = runRaw(['--tag']);
  eq(x.s.ok, false, '18.1 --tag 缺值报错');
  ok(/缺少取值/.test(x.s.error), '18.2 缺值错误信息正确');
  x = runRaw(['--time', TIME, '--symptom', '异响', '--records', base]);
  eq(x.s.ok, false, '18.3 缺 --tag 报错');
  x = runRaw(['--tag', 'P-1', '--symptom', '异响', '--records', base]);
  eq(x.s.ok, false, '18.4 缺 --time 报错');
  x = runRaw(['--tag', 'P-1', '--time', TIME, '--records', base]);
  eq(x.s.ok, false, '18.5 缺 --symptom 报错');
  x = runRaw(['--tag', 'P-1', '--time', TIME, '--symptom', '异响']);
  eq(x.s.ok, false, '18.6 缺 --records 报错');
  x = runRaw(['--tag', 'P-1', '--time', '2026-09-21T10:40:00', '--symptom', '异响', '--records', base]);
  eq(x.s.ok, false, '18.7 时间缺时区报错');
  ok(/缺少时区/.test(x.s.error), '18.8 缺时区错误信息正确');
  x = runRaw(['--tag', 'P-1', '--time', '昨天下午', '--symptom', '异响', '--records', base]);
  eq(x.s.ok, false, '18.9 非法时间报错');
  x = runRaw(OKARGS.concat(['--未知参数', 'x']));
  eq(x.s.ok, false, '18.10 未知参数报错');
  x = runRaw(OKARGS.concat(['--records', '/不存在的路径.xlsx']));
  eq(x.s.ok, false, '18.11 记录不存在报错');
  ok(/记录不存在/.test(x.s.error), '18.12 记录不存在错误信息正确');
  x = runRaw(OKARGS.concat(['--before', '-5']));
  eq(x.s.ok, false, '18.13 --before 负数报错');
  x = runRaw(OKARGS.concat(['--after', 'abc']));
  eq(x.s.ok, false, '18.14 --after 非数字报错');
  x = runRaw(OKARGS.concat(['--gap', '0']));
  eq(x.s.ok, false, '18.15 --gap 为 0 报错');
  x = runRaw(OKARGS.concat(['--history', '/不存在.xlsx']));
  eq(x.s.ok, false, '18.16 检修历史不存在报错');
  eq(x.code, 1, '18.17 参数错误退出码为 1');
  x = runRaw(['--tag', 'P-1', '--time', '2026-09-21T02:40:00Z', '--symptom', '异响', '--records', base, '--out', path.join(work, 'utc-out')]);
  eq(x.s.ok, true, '18.18 UTC 时间可接受');
  eq(x.s.failureTime, '2026-09-21 10:40:00', '18.19 UTC 换算为北京时间');
});

// ================================================================ 19. 检修历史
section('B', () => {
  r = run(base, ['--history', hist], 'hist');
  eq(r.summary.counts.maintenanceHistory, 3, '19.1 检修历史条目数');
  eq(r.json.maintenanceHistory[0].date, '2026-08-30', '19.2 检修历史按日期倒序');
  eq(r.json.maintenanceHistory[0].daysBeforeFailure, 22, '19.3 距故障天数计算正确');
  ok(r.json.maintenanceHistory.some((x) => x.date === null), '19.4 无日期的检修记录保留');
  ok(r.json.missingTime.some((x) => x.dataType === '检修历史'), '19.5 无日期检修记录列入缺失时间戳');
  ok(/与本次故障是否相关由调查组认定/.test(r.md), '19.6 检修历史不作相关性判断');
  ok(r.json.maintenanceHistory.every((x) => x.sheet && x.row), '19.7 检修条目可溯源到行号');
  eq(r.json.maintenanceHistory.find((x) => x.category === '大修').categoryNorm, '装置大检修', '19.8 检修类别「大修」映射为装置大检修');
  eq(r.json.maintenanceHistory.find((x) => x.category === '小修').categoryNorm, '日常维修', '19.9 「小修」映射为日常维修');
  ok(/检修分级/.test(r.md) && /装置大检修/.test(r.md), '19.10 md 显示检修分级列');
  // SAP PM 工单导出（IW38 列名）→ 共享别名
  const sap = mk('sap.xlsx', {
    'IW38': [
      ['订单', '订单类型', '功能位置', '设备', '短文本', '基本开始日期', '实际结束日期', '主工作中心', '系统状态', '通知单'],
      ['400012345', 'PM02', 'A1-CDU-P3201A', '10004567', '更换机械密封', '2026-03-15', '2026-03-18', 'JX-QG', 'TECO', '100223344'],
      ['400013120', 'PM03', 'A1-CDU-P3201A', '10004567', '处理泵体渗漏', '2026-08-30', '2026-08-30', 'JX-QG', 'CLSD', ''],
    ],
  });
  r = run(base, ['--history', sap], 'sap');
  eq(r.summary.ok, true, '19.11 SAP IW38 工单导出可读');
  eq(r.summary.counts.maintenanceHistory, 2, '19.12 工单条目数');
  eq(r.json.maintenanceHistory[0].tag, 'A1-CDU-P3201A', '19.13 功能位置→位号');
  eq(r.json.maintenanceHistory[0].content, '处理泵体渗漏', '19.14 短文本→检修内容');
  eq(r.json.maintenanceHistory[0].category, 'PM03', '19.15 订单类型→检修类别原文');
  eq(r.json.maintenanceHistory[0].categoryNorm, '抢修', '19.16 PM03→抢修');
  eq(r.json.maintenanceHistory[1].categoryNorm, null, '19.17 PM02 不映射→null，md 显示「—」');
  eq(r.json.maintenanceHistory[0].date, '2026-08-30', '19.18 实际结束日期→检修日期');
  eq(r.json.maintenanceHistory[0].orderNo, '400013120', '19.19 订单→工单号（按日期倒序首条）');
  eq(r.json.maintenanceHistory[1].noticeNo, '100223344', '19.20 通知单→通知单号');
  ok(/400013120/.test(r.md), '19.21 md 显示工单号');
  ok(!r.summary.warnings.some((w) => w.includes('缺少列')), '19.22 SAP 列名无缺列 warning');
  ok(r.json.maintenanceHistory.every((x) => !['TECO', 'CLSD'].includes(x.source)), '19.22b SAP「系统状态」列不被别名「系统」当作来源');
});
// 报警记录里有「系统状态」列、没有来源列时，来源不取系统状态的值
section('C', () => {
  const sysStat = mk('sysstat.xlsx', {
    '报警记录': [
      ['报警时间', '位号', '报警内容', '系统状态'],
      [`${DATE} 10:12`, 'P-3201A', '轴承温度高报', '已确认'],
    ],
  });
  r = run(sysStat, [], 'sysstat');
  ok(r.json.timeline.length === 1 && r.json.timeline[0].source !== '已确认', '19.22c 报警记录「系统状态」列不进「来源」');
  const sysSrc = mk('syssrc.xlsx', {
    '报警记录': [
      ['报警时间', '位号', '报警内容', '系统'],
      [`${DATE} 10:12`, 'P-3201A', '轴承温度高报', 'DCS'],
    ],
  });
  r = run(sysSrc, [], 'syssrc');
  eq(r.json.timeline[0].source, 'DCS', '19.22d 列名正好是「系统」时仍作来源');
});
// 「设备编号」不再是位号别名：SAP 8 位设备编号列不会被当作位号
section('B', () => {
  const sapDev = mk('sapdev.xlsx', {
    '报警记录': [
      ['报警时间', '设备编号', '功能位置', '报警内容'],
      [`${DATE} 10:12`, '10004567', 'A1-CDU-P3201A', '轴承温度高报'],
    ],
  });
  r = run(sapDev, [], 'sapdev');
  eq(r.json.timeline[0].tag, 'A1-CDU-P3201A', '19.23 功能位置优先于设备编号作为位号');
  const devOnly = mk('devonly.xlsx', {
    '报警记录': [
      ['报警时间', '设备编号', '报警内容'],
      [`${DATE} 10:12`, '10004567', '轴承温度高报'],
    ],
  });
  r = run(devOnly, [], 'devonly');
  eq(r.json.timeline[0].tag, null, '19.24 只有设备编号时位号为 null（不把 8 位流水号当位号）');
  // DCS/智能巡检列名：测点号/测量值/报警信息
  const dcs = mk('dcs.xlsx', {
    '运行参数': [
      ['时间', '功能位置', '测点号', '测量值', '工程单位'],
      [`${DATE} 10:00`, 'A1-CDU-P3201A', 'TI-3201A', '78℃', '℃'],
    ],
    '报警记录': [
      ['报警发生时间', '功能位置', '报警信息', '报警优先级'],
      [`${DATE} 10:12`, 'A1-CDU-P3201A', '轴承温度高报', '高'],
    ],
  });
  r = run(dcs, [], 'dcs');
  eq(r.json.paramChanges[0].param, 'TI-3201A', '19.25 测点号→参数名');
  eq(r.json.paramChanges[0].value, 78, '19.26 带单位测量值「78℃」剥离单位取数');
  ok(r.summary.warnings.some((w) => w.includes('已剥离单位')), '19.27 剥离单位 warning');
  eq(r.json.alarms[0].content, '轴承温度高报', '19.28 报警信息→内容');
  eq(r.json.alarms[0].level, '高', '19.29 报警优先级→级别');
});

// ================================================================ 20. md 七节结构与产出完整性
section('BVT', () => {
  r = run(base, ['--history', hist], 'struct');
  ok(/## 一、故障概况/.test(r.md), '20.1 第一节 故障概况');
  ok(/## 二、故障经过（时间线）/.test(r.md), '20.2 第二节 故障经过（时间线）');
  ok(/## 三、故障前后参数与报警/.test(r.md), '20.3 第三节 参数与报警');
  ok(/## 四、相关检修与变更历史/.test(r.md), '20.4 第四节 检修历史');
  ok(/## 五、数据缺口与时间戳差异/.test(r.md), '20.5 第五节 数据缺口');
  ok(/## 六、待查材料清单/.test(r.md), '20.6 第六节 待查材料清单');
  ok(/## 七、原因分析/.test(r.md), '20.7 第七节 原因分析');
  ok(/## 八、责任分析/.test(r.md), '20.7a 第八节 责任分析');
  ok(/## 九、损失情况/.test(r.md), '20.7b 第九节 损失情况');
  ok(/## 十、防范措施/.test(r.md), '20.7c 第十节 防范措施');
  ok(r.md.indexOf('## 七、原因分析') < r.md.indexOf('## 八、责任分析') && r.md.indexOf('## 八、责任分析') < r.md.indexOf('## 九、损失情况') && r.md.indexOf('## 九、损失情况') < r.md.indexOf('## 十、防范措施'), '20.7d 七~十节顺序正确');
  ok(!/^## .*事故/m.test(r.md), '20.7e 章节标题不用「事故」字样（未定性）');
  ok(/先后顺序不代表因果关系/.test(r.md), '20.8 时间线注明先后不代表因果');
  ok(/第\d+行/.test(r.md), '20.9 md 含出处行号');
  const sj = JSON.parse(fs.readFileSync(path.join(r.out, 'summary.json'), 'utf8'));
  eq(sj.ok, true, '20.10 summary.json 内容正确');
  ok(typeof sj.counts.timeline === 'number', '20.11 summary.json 含 counts');
  ok(Array.isArray(r.json.toInvestigate) && r.json.toInvestigate.length > 0, '20.12 toInvestigate 非空');
  ok(r.json.toInvestigate.every((x) => x.id && x.item && x.why), '20.13 待查项含编号/材料/用途');
});

// ================================================================ 20b. 默认输出目录为系统临时目录
section('B', () => {
  {
    const os2 = require('os');
    const rr = spawnSync(process.execPath, [SCRIPT, '--tag', 'P-3201A', '--time', TIME, '--symptom', '异响', '--records', base], { encoding: 'utf8' });
    const lines = rr.stdout.trim().split('\n');
    const sj2 = JSON.parse(lines[lines.length - 1]);
    ok(sj2.ok && sj2.out === path.join(os2.tmpdir(), 'fia-out'), '20.14 未传 --out 时默认写系统临时目录 fia-out');
    ok(!fs.existsSync(path.join(path.dirname(base), 'fia-out')), '20.15 不再写入记录同目录');
    try { fs.rmSync(path.join(os2.tmpdir(), 'fia-out'), { recursive: true, force: true }); } catch (e) {}
  }
});

// ================================================================ 21. 多文件输入
section('B', () => {
  const f2 = mk('second.xlsx', {
    '巡检记录': [
      ['巡检时间', '位号', '检查结果'],
      [`${DATE} 08:20`, 'P-3201A', '泵体温度偏高'],
    ],
  });
  r = run(base + ',' + f2, [], 'multi');
  eq(r.summary.counts.timeline, 7, '21.1 多文件合并时间线条目数');
  ok(r.json.timeline.some((x) => x.file === 'second.xlsx'), '21.2 时间线标注所属文件');
  ok(r.json.meta.sources.length >= 4, '21.3 meta 记录各文件的来源表');
});

// ================================================================ 输出
console.log(`\n${'='.repeat(56)}`);
console.log(`failure-investigation-assistant 自测：${pass} 通过，${fail} 失败`);
console.log(`用例级别 ${LEVELS[RUN_LEVEL]}：BVT ${byLevel.BVT}，A ${byLevel.A}，B ${byLevel.B}，C ${byLevel.C}`);
if (failures.length) { console.log('\n失败项：'); failures.forEach((f) => console.log('  ✗ ' + f)); }
console.log('='.repeat(56));
try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
