#!/usr/bin/env node
'use strict';
/**
 * 生成设备周报月报样例输入（可再生；中石化体系炼化厂车间设备员口径）。
 * 用法：node scripts/make-sample.js --out <dir> [--seed <n>] [--from YYYY-MM-DD] [--to YYYY-MM-DD]
 *
 * 恒定的预期结论（换 seed 只变数值，不变计数与比率）：
 *   - 周报样例：7 天区间，daily 目录内 5 份 daily.json → 缺 2 天（--from+2、--from+5）；K-1601 特护 1 天异常
 *   - 设备台账 20 台（含「在用」「重要度」列），在用 20、完好 18 → 完好率 90.0%；A/B 类 14 台、完好 12 → 主要设备完好率 85.7%
 *   - 故障记录 8 条（动设备 5、静设备 2、电气 1），停机时长均 >0 → 故障停机 8 次；P-1101B 故障 3 次
 *   - 检修计划 6 项落在区间内、按期 3 项 → 合计 50.0%；分列 大检修 0/2、日常维修 3/3、专项 0/1
 *   - 工单 8 张应闭环、按期 5 张 → 及时率 62.5%
 *   - 特护设备 2 台；备机 4 台、可投用 2 → 备机完好率 50.0%
 *   - 密封点统计：静 12000 点漏 5 → 0.42‰；动 600 点漏 1 → 1.67‰
 *   - 停工记录 2 条，非计划 1 次
 *   - 备件消耗 6 行，其中 1 行金额为空
 *   - 变体：sample-no-ledger.xlsx（完好率分母缺失 → null）、sample-metrics-rules.xlsx（厂内口径表，
 *     完好率带结构化分母列可算、检修计划完成率算法不一致且无结构化参数 → 需按厂内口径复算）、
 *     sample-sap-export.xlsx（SAP PM 导出列名：功能位置 / 设备描述 / ABC标识 / 订单 / 系统状态 / 基本结束日期 / 通知单）
 */
const fs = require('fs');
const path = require('path');
const { writeXlsx } = require('./lib/xlsx-lite');
const C = require('./lib/common');

const a = C.parseArgs(process.argv.slice(2), ['out', 'seed', 'from', 'to'], []);
const out = a.out || path.join(__dirname, '..', 'examples');
const from = a.from || '2026-09-14';
const to = a.to || '2026-09-20';
const seed = a.seed ? Number(a.seed) : 1;
let s = seed * 7919 + 13;
const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const rint = (lo, hi) => Math.round(lo + rnd() * (hi - lo));
const rflt = (lo, hi, d = 1) => Number((lo + rnd() * (hi - lo)).toFixed(d));
const D = (n) => C.addDays(from, n);

fs.mkdirSync(out, { recursive: true });

// ---------------------------------------------------------------- 1) 日报 JSON 目录（缺 2 天；字段与 equipment-daily-report 的 daily.json 对齐）
const dailyDir = path.join(out, 'daily');
fs.mkdirSync(dailyDir, { recursive: true });
for (const f of fs.readdirSync(dailyDir)) if (/\.json$/i.test(f)) fs.unlinkSync(path.join(dailyDir, f));

const PRESENT = [0, 1, 3, 4, 6];     // 缺第 2 天与第 5 天
let openDefects = 5;
for (const i of PRESENT) {
  const date = D(i);
  const newDefects = rint(0, 3);
  openDefects = Math.max(0, openDefects + newDefects - rint(0, 2));
  const specialAbnormal = i === 3 ? 1 : 0;   // K-1601 第 4 天异常
  const daily = {
    meta: { workshop: '常减压车间', date, shift: null, sources: ['sample→巡检汇总', 'sample→特护设备'], generatedAt: `${date} 18:00:00`, stateScheme: ['运行', '备用', '检修', '停用', '异常', '未判定'] },
    counts: {
      equipment: 20, abnormal: rint(0, 3), specialEquipment: 1, specialAbnormal,
      newDefects, openDefects, pendingAcceptDefects: rint(0, 1),
      overdueOrders: rint(0, 4), openOrders: rint(4, 9), pendingAcceptOrders: rint(0, 2),
      permits: rint(2, 6), maintProjects: 6, openLeaks: 2, overdueLeaks: 1, hazards: 3, overdueHazards: 1,
      events: rint(0, 2), unclosedEvents: rint(0, 1),
    },
    status: { equipment: 20, byState: { '运行': 15, '备用': 2, '检修': 1, '停用': 1, '异常': 1, '未判定': 0 }, abnormalList: [] },
    special: {
      total: 1, abnormal: specialAbnormal, source: '特护设备表',
      list: [{ tag: 'K-1601', name: '富气压缩机', state: specialAbnormal ? '异常' : '运行', params: `一级出口振动 ${rflt(3.5, 4.8)} mm/s`, desc: specialAbnormal ? '振动升高，已降负荷观察' : '' }],
    },
    defects: null, orders: null, permits: null, maintenance: null, leaks: null, hazards: null, events: null, compare: null, plan: null, warnings: [],
  };
  fs.writeFileSync(path.join(dailyDir, `daily-${date}.json`), JSON.stringify(daily, null, 2), 'utf8');
}

// ---------------------------------------------------------------- 2) 区间原始台账（厂内常见列名）
const DISC = ['动设备', '动设备', '动设备', '动设备', '动设备', '静设备', '静设备', '电气'];
const TYPE = ['离心泵', '离心泵', '离心泵', '电机', '离心泵', '换热器', '塔器', '电机'];
const FAULT_TAGS = ['P-1101B', 'P-1101B', 'P-1101B', 'M-1501', 'P-1102A', 'E-1201', 'C-1401', 'M-1502'];
const FAULT_NAMES = ['常压塔顶回流泵B', '常压塔顶回流泵B', '常压塔顶回流泵B', '鼓风机电机', '常压渣油泵A', '原油换热器', '常压塔', '引风机电机'];

// 20 台：重要度按 i%3 → A / B / C（C 共 6 台，A/B 共 14 台）；非完好 2 台（EQ-1119 A、EQ-1120 B）→ A/B 完好 12
const ledger = [['位号', '设备名称', '设备类型', '专业', '在用', '完好', '重要度']];
for (let i = 1; i <= 20; i++) {
  const tag = `EQ-${String(1100 + i)}`;
  const imp = i % 3 === 1 ? 'A' : i % 3 === 2 ? 'B' : 'C';
  ledger.push([tag, `设备${i}`, TYPE[i % TYPE.length], DISC[i % DISC.length], '是', i <= 18 ? '完好' : '非完好', imp]);
}

writeXlsx(path.join(out, `sample-period-source-${from}_${to}.xlsx`), {
  '设备台账': ledger,
  '故障记录': [
    ['位号', '设备名称', '设备类型', '专业', '故障描述', '故障时间', '停机时长', '修复时长', '是否停机'],
    ...FAULT_TAGS.map((tag, i) => [
      tag, FAULT_NAMES[i], TYPE[i], DISC[i],
      ['机封泄漏', '轴承温高', '电流冲高', '振动超标', '联轴器对中偏差', '法兰渗漏', '内件积垢', '绝缘下降'][i],
      D(i % 7), rflt(0.5, 8, 1), rflt(0.5, 6, 1), '是',
    ]),
  ],
  '检修计划': [
    ['项目名称', '位号', '检修类别', '状态', '计划完成', '实际完成', '责任人'],
    ['回流泵B机封更换', 'P-1101B', '日常维修', '已完成', D(1), D(1), '检修一队'],
    ['渣油泵A对中', 'P-1102A', '日常维修', '已完成', D(2), D(2), '检修一队'],
    ['换热器法兰紧固', 'E-1201', '小修', '已完成', D(3), D(3), '检修二队'],
    ['鼓风机电机检测', 'M-1501', '大修', '已完成', D(4), D(6), '电气班'],
    ['缓冲罐保温修复', 'V-1301', '装置大检修', '施工中', D(5), '', '保运队'],
    ['常压塔内件清理', 'C-1401', '技改', '未开工', D(6), '', '检修二队'],
    ['下期项目（区间外）', 'P-1103', '日常维修', '未开工', C.addDays(to, 10), '', '检修一队'],
  ],
  '工单台账': [
    ['工单号', '位号', '缺陷描述', '状态', '要求完成时间', '闭环时间', '责任人'],
    ['WO-2609101', 'P-1101B', '更换机械密封', '已闭环', D(1), D(1), '检修一队'],
    ['WO-2609102', 'P-1102A', '联轴器对中', '已闭环', D(2), D(2), '检修一队'],
    ['WO-2609103', 'E-1201', '法兰紧固', '已闭环', D(3), D(3), '检修二队'],
    ['WO-2609104', 'M-1501', '电机电流检测', '已闭环', D(4), D(6), '电气班'],
    ['WO-2609105', 'V-1301', '保温修复', '施工中', D(4), '', '保运队'],
    ['WO-2609106', 'C-1401', '栏杆除锈', '已闭环', D(5), D(5), '保运队'],
    ['WO-2609107', 'M-1502', '引风机电机绝缘处理', '已派工', D(5), '', '电气班'],
    ['WO-2609108', 'P-1103', '泵体检查', '已闭环', D(6), D(6), '检修一队'],
    ['WO-2609109', 'P-1104', '下期工单（区间外）', '已派工', C.addDays(to, 8), '', '检修一队'],
  ],
  '缺陷台账': [
    ['位号', '设备名称', '缺陷描述', '等级', '状态', '发现时间', '闭环时间'],
    ['P-1101B', '常压塔顶回流泵B', '机封滴漏', 'B 级（严重）', '已闭环', D(0), D(1)],
    ['P-1102A', '常压渣油泵A', '轴承温度偏高', 'C 级（一般）', '已闭环', D(1), D(2)],
    ['E-1201', '原油换热器', '封头法兰渗漏', 'C 级（一般）', '已闭环', D(2), D(3)],
    ['M-1501', '鼓风机电机', '运行电流偏高', 'C 级（一般）', '已完成', D(3), ''],
    ['V-1301', '原油缓冲罐', '保温层破损', 'C 级（一般）', '处理中', D(4), ''],
    ['C-1401', '常压塔', '平台栏杆锈蚀', 'C 级（一般）', '待处理', D(6), ''],
  ],
  '特护设备': [
    ['位号', '设备名称', '状态', '运行参数', '备注'],
    ['K-1601', '富气压缩机', '运行', `一级出口振动 ${rflt(3.5, 4.8)} mm/s，轴位移 ${rflt(0.2, 0.4, 2)} mm`, '区间内曾振动升高一次，已恢复'],
    ['K-1602', '制氢压缩机', '运行', `排气温度 ${rint(118, 132)} ℃`, ''],
  ],
  '备机': [
    ['位号', '设备名称', '状态', '是否可投用', '备注'],
    ['P-1101A', '常压塔顶回流泵A', '备用', '是', '每班盘车'],
    ['P-1102B', '常压渣油泵B', '备用', '是', ''],
    ['P-1103B', '常压塔底泵B', '检修', '是', '机封更换中，检修期间不计可投用'],
    ['P-1105B', '轻柴油泵B', '备用', '否', '电机待返修'],
  ],
  '密封点统计': [
    ['密封点类型', '密封点总数', '泄漏点数'],
    ['静密封点', 12000, 5],
    ['动密封点', 600, 1],
  ],
  '停工记录': [
    ['停工时间', '装置', '停工类别', '原因'],
    [D(2), '常减压装置', '非计划', `原料泵 P-1102A 对中偏差振动高，降量 ${rint(2, 5)} 小时`],
    [D(5), '常减压装置', '计划', '消缺停工（计划内）'],
  ],
  '备件消耗': [
    ['备件名称', '位号', '数量', '单位', '金额', '时间'],
    ['机械密封', 'P-1101B', 2, '套', rint(3000, 6000), D(1)],
    ['滚动轴承', 'P-1102A', 4, '套', rint(800, 1600), D(2)],
    ['法兰垫片', 'E-1201', 6, '件', rint(200, 500), D(3)],
    ['电机碳刷', 'M-1501', 8, '支', rint(300, 700), D(4)],
    ['保温棉', 'V-1301', 20, '平方米', '', D(5)],
    ['绝缘漆', 'M-1502', 3, '桶', rint(400, 900), D(6)],
  ],
});

// ---------------------------------------------------------------- 3) 变体：无设备台账（完好率分母缺失）
writeXlsx(path.join(out, 'sample-no-ledger.xlsx'), {
  '故障记录': [
    ['位号', '设备名称', '设备类型', '专业', '故障描述', '故障时间', '停机时长', '修复时长'],
    ['P-2101', '加氢进料泵', '离心泵', '动设备', '机封泄漏', D(1), 2.5, 1.5],
    ['P-2102', '循环油泵', '离心泵', '动设备', '异响', D(3), 1.0, 0.8],
  ],
});

// ---------------------------------------------------------------- 4) 变体：厂内指标口径表（标准号为虚构写法）
writeXlsx(path.join(out, 'sample-metrics-rules.xlsx'), {
  '指标口径': [
    ['指标', '算法', '分母', '剔除封存'],
    ['设备完好率', '完好台数 / 在册设备台数（含封存），厂标 Q/XX-虚构-001', '在册', '否'],
    ['检修计划完成率', '（按期完成 + 经批准顺延）项数 / 计划项数，厂标 Q/XX-虚构-002', '', ''],
    ['工单及时率', '按期闭环工单数 / 应闭环工单数', '', ''],
  ],
});

// ---------------------------------------------------------------- 5) 变体：SAP PM 导出列名（技术对象清单 + 订单清单 + 通知单清单）
const sapLedger = [['功能位置', '设备', '设备描述', '对象类型', 'ABC标识', '使用状态', '完好']];
const SAPTAGS = ['P-2101A', 'P-2101B', 'K-2201', 'E-2301', 'V-2401', 'M-2501', 'P-2102A', 'C-2601'];
const SAPNAMES = ['加氢进料泵A', '加氢进料泵B', '循环氢压缩机', '高压换热器', '高压分离器', '进料泵电机', '循环油泵A', '汽提塔'];
const SAPTYPE = ['离心泵', '离心泵', '往复压缩机', '换热器', '压力容器', '电机', '离心泵', '塔器'];
const SAPABC = ['A', 'A', 'A', 'B', 'B', 'C', 'B', 'C'];
for (let i = 0; i < SAPTAGS.length; i++) {
  sapLedger.push([SAPTAGS[i], String(10000100 + i), SAPNAMES[i], SAPTYPE[i], SAPABC[i], i === 7 ? '封存' : '在用', i === 5 ? '非完好' : '完好']);
}
writeXlsx(path.join(out, 'sample-sap-export.xlsx'), {
  '技术对象清单': sapLedger,
  '订单清单': [
    ['订单', '功能位置', '描述', '订单类型', '系统状态', '基本开始日期', '基本结束日期', '实际结束日期', '主工作中心'],
    ['4000101', 'P-2101A', '更换机械密封', 'PM01', 'CLSD', D(0), D(1), D(1), '机泵班'],
    ['4000102', 'K-2201', '一级气阀检查', 'PM01', 'TECO', D(1), D(2), D(2), '机泵班'],
    ['4000103', 'E-2301', '管箱法兰紧固', 'PM01', 'REL', D(2), D(3), '', '静设备班'],
    ['4000104', 'V-2401', '液位计校核', 'PM01', 'CLSD', D(3), D(4), D(6), '仪表班'],
    ['4000105', 'M-2501', '绝缘处理', 'PM03', 'CRTD', D(4), D(5), '', '电气班'],
    ['4000106', 'C-2601', '作废单', 'PM01', 'DLFL', D(5), D(6), '', '静设备班'],
  ],
  '通知单清单': [
    ['通知单', '功能位置', '通知单描述', '通知类型', '通知单状态', '通知日期', '业务完成日期'],
    ['10000201', 'P-2101A', '机封滴漏', 'M2', 'NOCO', D(0), D(1)],
    ['10000202', 'E-2301', '法兰渗漏', 'M2', 'OSNO', D(2), ''],
    ['10000203', 'K-2201', '气阀异响已修复待验', 'M2', '已完成', D(3), ''],
    ['10000204', 'M-2501', '电机绝缘低', 'M1', 'NOPR', D(4), ''],
  ],
});

console.log(JSON.stringify({
  ok: true, out, from, to, seed,
  dailyFiles: fs.readdirSync(dailyDir).filter((f) => f.endsWith('.json')).length,
  missingDates: [D(2), D(5)],
  files: fs.readdirSync(out).filter((f) => f.endsWith('.xlsx')),
}));
