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

// 工单跟踪 JSON（work-order-tracker 的 orders.json 裁剪；恒 3 条超期。vendor=承修单位，owner=责任人）
const wo = (no, tag, name, fault, days, vendor, owner) => ({ no, tag, name, status: '施工中', vendor, owner, party: `${vendor} / ${owner}`, fault, overdueDays: days });
const avgCycleDays = C.round(4 + rnd() * 3, 1);   // 先取，保持随机序列与旧版一致（同 seed 数值不变）
fs.writeFileSync(path.join(out, 'sample-orders.json'), JSON.stringify({
  meta: { workshop: '常减压车间', date: '2026-09-21', slaSource: '脚本默认口径' },
  counts: { total: 14, known: 13, unknownStatus: 1, open: 9, overdue: 3, stalled: 3, dueSoon: 4, closedInRange: 3, closedAll: 3, cancelled: 1 },
  byStatus: [{ status: '施工中', count: 5 }, { status: '已派工', count: 4 }],
  overdue: [
    wo('WO-26090101', 'P-1101B', '常压塔顶回流泵B', '更换机械密封', v(4, 8), '检修一队', '班长孙'),
    wo('WO-26090102', 'K-1201', '循环氢压缩机', '压缩机出口温度检查', v(5, 9), '检修二队', '项目经理李'),
    wo('WO-26090103', 'E-1301', '常压塔顶冷却器', '法兰渗漏处理', v(3, 7), '保运队', '工长赵'),
  ],
  metrics: { closeRate: 25, avgCycleDays, cycleSample: 2 },
}, null, 2), 'utf8');

// 隐患跟踪 JSON（hazard-closure-tracker 的 hazard.json 裁剪；闭环率字段为 metrics.closureRate；含 2 条重大隐患）
const hz = (no, desc, level, bucket, bucketCn, deadline) => ({ no, desc, level, levelCn: level === 'major' ? '重大隐患' : '一般隐患', owner: '张工', unit: '常减压车间', deadline, status: 'doing', statusCn: '整改中', bucket, bucketCn });
const H1 = hz('YH-2026-001', '常压塔平台栏杆多处锈蚀断裂，存在高处坠落风险', 'major', 'overdue', '超期未整改', '2026-09-09');
const H2 = hz('YH-2026-002', '可燃气体报警器 3 台失效未修复', 'major', 'inProgress', '整改中', '2026-10-15');
const H3 = hz('YH-2026-005', '换热器保温层破损，裸露管壁烫伤风险', 'general', 'overdue', '超期未整改', '2026-09-15');
fs.writeFileSync(path.join(out, 'sample-hazard.json'), JSON.stringify({
  meta: { workshop: '常减压车间', date: '2026-09-21', from: null, rulesSource: '默认口径（references/hazard-rules.md）' },
  counts: { total: 12, overdue: 3, dueSoon: 1, inProgress: 2, closed: 3, unverified: 2, undetermined: 1, major: 2, conflicts: 0, fiveFixedIncomplete: 4, duplicateNo: 0 },
  metrics: { closureRate: 25, avgClosureDays: 36.7, byLevel: { major: { total: 2, closed: 0, overdue: 1 }, general: { total: 10, closed: 3, overdue: 2 } } },
  overdue: [H1, H3], dueSoon: [], inProgress: [H2], closed: [], unverified: [],
  majorHazards: [H1, H2],
  undetermined: [], conflicts: [], fiveFixedIncomplete: [], trend: null, items: [H1, H2, H3], warnings: [],
}, null, 2), 'utf8');

// 周报 JSON（equipment-weekly-monthly-report 的 periodic.json 裁剪：指标键为英文，由本技能映射为中文标签）
fs.writeFileSync(path.join(out, 'sample-periodic.json'), JSON.stringify({
  meta: { workshop: '常减压车间', period: 'weekly', periodCn: '周报', from: '2026-09-14', to: '2026-09-20', rulesSource: '默认口径（references/metrics-rules.md）' },
  counts: { faults: 8, downtimeCount: 8, maintPlanned: 6, ordersDue: 8 },
  metrics: {
    intactRate: 90, majorRate: 85.7, standbyRate: 50, staticLeakRate: 0.42, dynamicLeakRate: 1.67,
    planRate: null, planRateOverhaul: null, planRateRoutine: null, orderRate: 62.5,   // 检修计划完成率需按厂内口径复算：上游不出数（与 periodic.js 一致）
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
