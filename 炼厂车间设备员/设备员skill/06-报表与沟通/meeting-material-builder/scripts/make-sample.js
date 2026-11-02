#!/usr/bin/env node
'use strict';
/** 生成会议材料样例输入（上游技能 JSON）。用法：node scripts/make-sample.js --out <dir> [--seed <n>]
 * 结论恒定：巡检 7 台 2 异常；工单 3 条超期；隐患 2 条重大；周报 periodic.json 1 项需复算、1 条重点事项；另有无法识别 JSON 与 md 报表各一。 */
const fs = require('fs');
const path = require('path');
const C = require('./lib/common');

const a = C.parseArgs(process.argv.slice(2), ['out', 'seed'], []);
const out = a.out || path.join(__dirname, '..', 'examples');
const seed = a.seed ? Number(a.seed) : 1;
let s = seed * 7919 + 13;
const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const v = (lo, hi) => Math.round(lo + rnd() * (hi - lo));

fs.mkdirSync(out, { recursive: true });

// 巡检汇总 JSON（结论恒定：7 台设备 2 异常）
fs.writeFileSync(path.join(out, 'sample-status.json'), JSON.stringify({
  meta: { workshop: '常减压车间', date: '2026-09-21' },
  counts: { equipment: 7, normal: 4, abnormal: 2, unknown: 1, missed: 2 },
  byEquipment: [{ tag: 'P-1101A', state: 'normal' }],
  abnormal: [
    { tag: 'P-1101B', name: '常压塔顶回流泵B', desc: `机封滴漏约${v(3, 8)}滴/分`, area: '一区', discipline: '动设备' },
    { tag: 'M-1501', name: '鼓风机电机', desc: '运行电流较额定偏高', area: '四区', discipline: '电气' },
  ],
}, null, 2), 'utf8');

// 工单跟踪 JSON（恒 3 条超期）
fs.writeFileSync(path.join(out, 'sample-orders.json'), JSON.stringify({
  counts: { total: 14, open: 9, overdue: 3, stalled: 3, closedInRange: 3, closedAll: 3 },
  metrics: { closeRate: 25, avgCycleDays: C.round(4 + rnd() * 3, 1) },
  byStatus: { 施工中: 5, 已派工: 4 },
  overdue: [
    { no: 'WO-26090101', tag: 'P-1101B', desc: '更换机械密封', overdueDays: v(4, 8), owner: '检修一队' },
    { no: 'WO-26090102', tag: 'K-1201', desc: '压缩机出口温度检查', overdueDays: v(5, 9), owner: '检修二队' },
    { no: 'WO-26090103', tag: 'E-1301', desc: '法兰渗漏处理', overdueDays: v(3, 7), owner: '保运队' },
  ],
}, null, 2), 'utf8');

// 隐患跟踪 JSON（含重大隐患）
fs.writeFileSync(path.join(out, 'sample-hazard.json'), JSON.stringify({
  counts: { total: 12, major: 2, overdue: 3, closed: 3 },
  metrics: { closeRate: 25 },
  majorHazards: [
    { no: 'YH-2026-001', desc: '常压塔平台栏杆多处锈蚀断裂，存在高处坠落风险' },
    { no: 'YH-2026-002', desc: '可燃气体报警器 3 台失效未修复' },
  ],
  overdue: [], dueSoon: [], unverified: [],
}, null, 2), 'utf8');

// 周报 JSON（equipment-weekly-monthly-report 的 periodic.json 裁剪：指标键为英文，由本技能映射为中文标签）
fs.writeFileSync(path.join(out, 'sample-periodic.json'), JSON.stringify({
  meta: { workshop: '常减压车间', period: 'weekly', periodCn: '周报', from: '2026-09-14', to: '2026-09-20', rulesSource: '默认口径（references/metrics-rules.md）' },
  counts: { faults: 8, downtimeCount: 8, maintPlanned: 6, ordersDue: 8 },
  metrics: {
    intactRate: 90, majorRate: 85.7, standbyRate: 50, staticLeakRate: 0.42, dynamicLeakRate: 1.67,
    planRate: 50, planRateOverhaul: 0, planRateRoutine: 100, orderRate: 62.5,
    mttr: C.round(2 + rnd() * 2, 2), downtime: C.round(20 + rnd() * 15, 1), downtimeCount: 8, unplannedShutdowns: 1, faultCount: 8,
    newDefects: v(3, 7), openDefects: v(2, 5), basedOn: '基于 5 天数据（应为 7 天）',
  },
  failures: { total: 8, top: [{ tag: 'P-1101B', name: '常压塔顶回流泵B', count: 3 }] },
  highlights: [{ type: '故障频发设备', text: `P-1101B（常压塔顶回流泵B） 区间内故障 3 次，累计停机 ${C.round(8 + rnd() * 4, 1)} 小时` }],
  dataGaps: { missingDates: ['2026-09-16', '2026-09-19'], recompute: [{ metric: '检修计划完成率', algo: '（按期完成 + 经批准顺延）项数 / 计划项数', reason: '厂内口径表算法与脚本默认算法不一致' }] },
}, null, 2), 'utf8');

// 无法识别的 JSON
fs.writeFileSync(path.join(out, 'sample-unknown.json'), JSON.stringify({ hello: 'world', foo: [1, 2] }, null, 2), 'utf8');

// 已有 Markdown 报表
fs.writeFileSync(path.join(out, 'sample-report.md'), `# 常减压车间设备月报（2026-09）\n\n本月设备运行平稳。\n`, 'utf8');

console.log(JSON.stringify({ ok: true, out, seed, files: fs.readdirSync(out).filter((f) => /\.(json|md)$/.test(f) && f !== 'README.md') }));
