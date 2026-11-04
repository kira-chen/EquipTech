#!/usr/bin/env node
'use strict';
/**
 * 生成设备事件通报样例输入（可再生）。
 * 用法：node scripts/make-sample.js --out <dir> [--seed <n>] [--date <YYYY-MM-DD>]
 *
 * 本技能主输入是命令行文字，样例以「事件素材表」形式提供，供回归测试按行取参数运行。
 * 恒定预期（与 seed 无关）：
 *   - 4 条素材：EV-01 要素齐全且无禁用表述；EV-02 含归因/责任/厂家质量/定性/夸大五类表述；
 *     EV-03 缺 3 项要素（当前状态、影响、已采取措施）；EV-04 触发上报提示且含个人追责表述。
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
const n2 = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

fs.mkdirSync(out, { recursive: true });

// 发生时间与事件经过里的时刻一致：经过里写的「X时Y分」就是发生时间，处置时刻在其后若干分钟
const p2 = (n) => String(n).padStart(2, '0');
const mkTime = () => { const m = n2(6 * 60, 20 * 60); return { m, iso: `${date}T${p2(Math.floor(m / 60))}:${p2(m % 60)}:00+08:00`, cn: `${p2(Math.floor(m / 60))}时${p2(m % 60)}分` }; };
const later = (t, lo, hi) => { const m = t.m + n2(lo, hi); return `${p2(Math.floor(m / 60))}时${p2(m % 60)}分`; };
const T1 = mkTime(), T2 = mkTime(), T3 = mkTime(), T4 = mkTime();
const t1 = T1.iso, t2 = T2.iso, t3 = T3.iso, t4 = T4.iso;

// 事件素材表：每行一个完整的 notice.js 调用素材
const HEAD = ['素材编号', '位号', '设备名称', '所在区域', '发生时间', '事件类型', '通报范围',
  '事件经过', '当前状态', '影响情况', '已采取措施', '后续安排', '预期验证点'];

const rows = [
  ['EV-01', 'P-2101A', '柴油加氢进料泵A', '一区', t1, '故障', '车间',
    `${T1.cn}巡检发现该泵机械密封处有滴漏，滴速约每分钟${n2(3, 9)}滴，泵出口压力由 ${(1.5 + rnd()).toFixed(2)} MPa 降至 ${(1.0 + rnd() * 0.3).toFixed(2)} MPa，电流由 ${n2(38, 45)} A 降至 ${n2(30, 36)} A。当班人员按操作卡切换至备用泵 P-2101B，A 泵停运隔离。`,
    'P-2101A 已停运并做好隔离，P-2101B 运行正常，装置负荷未变动。',
    '生产：装置负荷未受影响，未降量。安全：泄漏量约 0.5 kg，现场已清理，可燃气体检测仪读数为 0。环保：无物料外排，无异常排放。',
    `${later(T1, 10, 30)}切换备用泵并停运隔离；已通知钳工班组现场确认；已按缺陷登记流程录入缺陷台账。`,
    '拟于 9 月 25 日前拆检机械密封，由设备员张负责跟踪，检修完成后做试运验证。',
    '要素齐全，speculative 为 0，escalationHint 为 false'],

  ['EV-02', 'E-2201', '进料换热器', '一区', t2, '故障', '车间',
    '由于操作不当，换热器管束发生泄漏，造成装置被迫降量。经查系厂家质量问题所致，设备本身缺陷明显，属于严重违反操作规程的事故，现场情况十分严重。',
    '换热器已切出，装置降量运行。',
    '生产影响严重，重大隐患尚未消除。',
    '已切出换热器，已组织人员处理。',
    '待定。',
    '检出归因/责任/厂家质量/定性/夸大五类表述，全部列入 speculative'],

  ['EV-03', 'V-2301', '低压分离器', '二区', t3, '异常', '车间',
    `${T3.cn}中控显示 V-2301 液位指示由 ${n2(40, 55)}% 快速上升至 ${n2(80, 92)}%，现场就地液位计读数与中控不一致。`,
    '', '', '',
    '',
    '缺 4 项要素（当前状态、影响情况、已采取措施、后续安排为非必需），missing 含 3 项必需要素'],

  ['EV-04', 'C-2401', '分馏塔', '三区', t4, '险肇', '分厂',
    `${T4.cn}塔底泵出口管线法兰处发生物料大量泄漏并着火，装置紧急停车。当班操作工${pick(['王', '李', '赵'])}${pick(['建国', '卫东', '明'])}处理不当，火情由消防队扑灭，${n2(1, 2)}名人员轻微烫伤送医。`,
    '装置已紧急停车，火情已扑灭，现场已警戒隔离。',
    '生产：全装置停车。安全：人员烫伤送医。环保：现场有物料残液，已围堰收集。',
    '已启动应急预案，已通知消防与应急部门，已对现场进行警戒隔离。',
    '待调查组进场后确定。',
    'escalationHint 为 true（人员伤害/着火/停车/大量泄漏），并检出个人姓名追责表述 N1'],
];

writeXlsx(path.join(out, `sample-events-${date}.xlsx`), { '事件素材': [HEAD, ...rows] });

// 变体：只有一条最小素材（仅必需要素），用于验证 --impact 缺失时影响一节的写法
writeXlsx(path.join(out, 'sample-minimal-event.xlsx'), {
  '事件素材': [HEAD, [
    'EV-M1', 'P-3101', '原料泵', '一区', `${date}T09:00:00+08:00`, '故障', '车间',
    '巡检发现泵体轴承箱温度较平时偏高，红外测温 ' + n2(75, 88) + '℃。',
    '泵继续运行，已加强监测。', '', '已缩短巡检周期至每小时一次，已通知点检人员跟踪。', '',
    'missing 含「影响情况」，影响一节写明须补充，不得推测',
  ]],
});

console.log(JSON.stringify({ ok: true, out, date, seed, files: fs.readdirSync(out).filter((f) => f.endsWith('.xlsx')) }));
