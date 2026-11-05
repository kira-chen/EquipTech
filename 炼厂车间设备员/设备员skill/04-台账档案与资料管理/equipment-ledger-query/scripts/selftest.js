#!/usr/bin/env node
'use strict';
/** 自测：断言 query.js 行为。用法：node scripts/selftest.js（全绿退出 0） */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { writeXlsx, readXlsx } = require('./lib/xlsx-lite');

const Q = path.join(__dirname, 'query.js');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'elq-selftest-'));
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
const eq = (a, e, n) => ok(a === e, `${n}（期望 ${JSON.stringify(e)}，实际 ${JSON.stringify(a)}）`);

function run(args, tag) {
  const out = path.join(work, tag + '-out');
  const r = spawnSync(process.execPath, [Q, ...args, '--out', out], { encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  let s; try { s = JSON.parse(lines[lines.length - 1]); } catch (e) { s = { ok: false, error: 'no-json:' + r.stdout + r.stderr }; }
  let j = null, md = null;
  if (fs.existsSync(path.join(out, 'result.json'))) j = JSON.parse(fs.readFileSync(path.join(out, 'result.json'), 'utf8'));
  if (fs.existsSync(path.join(out, 'result.md'))) md = fs.readFileSync(path.join(out, 'result.md'), 'utf8');
  return { code: r.status, s, j, md, out };
}
const mk = (n, b) => { const p = path.join(work, n); writeXlsx(p, b); return p; };
let r;

const LED = mk('led.xlsx', {
  '设备台账': [
    ['位号', '设备名称', '规格型号', '制造厂', '投用日期', '专业', '区域', '重要度'],
    ['P-01', '泵1', 'ZA-100', '甲厂', '2012-06-15', '动设备', '一区', 'A'],
    ['P-02', '泵2', '', '乙厂', '2018-03-20', '动设备', '一区', 'B'],
    ['P-03', '泵3', 'ZE-150', '甲厂', '2014-01-10', '动设备', '二区', 'A'],
    ['E-01', '换热器1', 'BES-800', '丙厂', '2012-06-15', '静设备', '二区', 'B'],
    ['E-02', '换热器2', 'BEM-600', '丙厂', '2020-09-01', '静设备', '二区', 'C'],
    ['M-01', '电机1', 'Y2-315', '丁厂', '2017-07-22', '电气', '三区', 'B'],
  ],
});

// ============ A. detail 查询 ============
section('BVT', () => {
  r = run(['--input', LED, '--query', 'P-01'], 'detail');
  eq(r.s.ok, true, 'A1 简写位号查询成功');
  eq(r.s.counts.matched, 1, 'A2 命中 1 条');
  eq(r.j.records[0]['设备名称'], '泵1', 'A3 字段返回正确');
  ok(/## P-01/.test(r.md), 'A4 md 标题含位号');
  ok(/投用年限/.test(r.md), 'A5 输出派生的投用年限');
  ok(/以 \d{4}-\d{2}-\d{2} 为基准计算/.test(r.md), 'A6 投用年限注明基准日期');
  ok(/权威数据以 EM 设备管理信息系统 \/ ERP（SAP PM）/.test(r.md), 'A7 保留权威数据声明行（EM / SAP PM 口径）');
});
section('C', () => {
  ok(!/EAM/.test(r.md), 'A7b md 不再出现 EAM');
  ok(/spare-parts-inventory-query/.test(r.md), 'A7c md 指引备件查询用 spare-parts-inventory-query');
  ok(/## 一、/.test(r.md), 'A7d 章节用中文序号');
});

section('B', () => {
  // 大小写不敏感
  r = run(['--input', LED, '--query', 'p-01'], 'detail-lower');
  eq(r.s.counts.matched, 1, 'A8 位号大小写不敏感');
});

section('A', () => {
  // 查不到 → 明确告知，不放宽
  r = run(['--input', LED, '--query', 'P-99'], 'notfound');
  eq(r.s.ok, true, 'A9 查不到仍正常退出');
  eq(r.s.counts.matched, 0, 'A10 命中 0 条');
  ok(r.j.warnings.some((w) => w.includes('未查到位号或设备编号')), 'A11 warning 明确未查到（位号或设备编号）');
  ok(/未查到符合条件的设备/.test(r.md), 'A12 md 明确未查到');
  ok(/未放宽条件返回近似结果/.test(r.md), 'A13 md 声明未放宽条件');
});

// ============ B. 空值显示 ============
section('A', () => {
  r = run(['--input', LED, '--query', 'P-02'], 'empty-field');
  ok(/—（台账未填）/.test(r.md), 'B1 空字段显示「台账未填」不留白');
  eq(r.j.records[0]['规格型号'], null, 'B2 空字段 JSON 中为 null 不是空串');
});

// ============ C. filter 查询 ============
section('A', () => {
  r = run(['--input', LED, '--query', '{"type":"filter","where":[["专业","eq","动设备"]]}'], 'filter');
  eq(r.s.counts.matched, 3, 'C1 按专业筛选');
  ok(r.s.appliedFilters.length === 1, 'C2 记录生效条件');
  ok(/生效条件/.test(r.md), 'C3 md 显示生效条件');

  r = run(['--input', LED, '--query', '{"type":"filter","where":[["投用日期","lt","2015-01-01"]]}'], 'filter-date');
  eq(r.s.counts.matched, 3, 'C4 日期比较筛选');

  r = run(['--input', LED, '--query', '{"type":"filter","where":[["制造厂","contains","甲"]]}'], 'filter-contains');
  eq(r.s.counts.matched, 2, 'C5 contains 操作符');

  r = run(['--input', LED, '--query', '{"type":"filter","where":[["规格型号","empty"]]}'], 'filter-empty');
  eq(r.s.counts.matched, 1, 'C6 empty 操作符');

  r = run(['--input', LED, '--query', '{"type":"filter","where":[["重要度","in",["A"]]]}'], 'filter-in');
  eq(r.s.counts.matched, 2, 'C7 in 操作符');
});

section('B', () => {
  // 排序
  r = run(['--input', LED, '--query', '{"type":"filter","where":[["专业","eq","动设备"]],"orderBy":{"field":"投用日期","dir":"asc"}}'], 'filter-order');
  eq(r.j.records[0]['位号'], 'P-01', 'C8 升序排序正确');
  r = run(['--input', LED, '--query', '{"type":"filter","where":[["专业","eq","动设备"]],"orderBy":{"field":"投用日期","dir":"desc"}}'], 'filter-desc');
  eq(r.j.records[0]['位号'], 'P-02', 'C9 降序排序正确');

  // limit
  r = run(['--input', LED, '--query', '{"type":"filter","where":[]}', '--limit', '2'], 'limit');
  eq(r.s.counts.matched, 2, 'C10 limit 生效');
  ok(r.j.warnings.some((w) => w.includes('仅返回前')), 'C11 截断时 warning');
});

// ============ D. 字段不存在：必须报错而不是静默返回全部 ============
section('A', () => {
  r = run(['--input', LED, '--query', '{"type":"filter","where":[["设计压力","gt","1.0"]]}'], 'nofield');
  eq(r.s.ok, false, 'D1 字段不存在时报错');
  eq(r.code, 1, 'D2 退出码 1');
  ok(/无字段/.test(r.s.error), 'D3 错误信息指出无此字段');
  ok(/台账实际字段/.test(r.s.error), 'D4 错误信息列出实际字段');
});

// ============ E. stats 查询 ============
section('A', () => {
  r = run(['--input', LED, '--query', '{"type":"stats","groupBy":"专业"}'], 'stats');
  eq(r.s.ok, true, 'E1 统计查询成功');
  eq(r.j.stats.total, 6, 'E2 总数正确');
  eq(r.j.stats.groups.length, 3, 'E3 分组数正确');
  eq(r.j.stats.groups[0].key, '动设备', 'E4 按数量降序');
  eq(r.j.stats.groups[0].count, 3, 'E5 分组计数正确');
});
section('C', () => {
  ok(/占比/.test(r.md), 'E6 md 含占比列');
});

section('B', () => {
  r = run(['--input', LED, '--query', '{"type":"stats","groupBy":"专业","where":[["区域","eq","二区"]]}'], 'stats-where');
  eq(r.j.stats.total, 3, 'E7 统计可带筛选条件');

  r = run(['--input', LED, '--query', '{"type":"stats","groupBy":"不存在字段"}'], 'stats-nofield');
  eq(r.s.ok, false, 'E8 统计字段不存在时报错');
});

// ============ F. 关联表 ============
const HIS = mk('his.xlsx', {
  '检修历史': [
    ['位号', '检修日期', '检修内容', '承修单位'],
    ['P-01', '2026-03-12', '更换机封', '一队'],
    ['P-01', '2025-08-20', '更换轴承', '一队'],
    ['P-01', '2024-01-05', '大修', '二队'],
  ],
});
section('B', () => {
  r = run(['--input', LED, '--query', 'P-01', '--history', HIS], 'history');
  eq(r.j.records[0]['_检修历史'].length, 3, 'F1 关联检修历史');
  eq(r.j.records[0]['_检修历史'][0].date, '2026-03-12', 'F2 检修历史按时间倒序');
  ok(/### 检修历史/.test(r.md), 'F3 md 含检修历史节');

  r = run(['--input', LED, '--query', 'P-02', '--history', HIS], 'history-none');
  eq(r.j.records[0]['_检修历史'].length, 0, 'F4 无历史记录返回空数组');
});

const SP = mk('sp.xlsx', {
  '备件对应': [['位号', '备件名称', '备件编码', '规格型号'], ['P-01', '机械密封', 'BJ-001', '104-45']],
});
section('C', () => {
  r = run(['--input', LED, '--query', 'P-01', '--spare', SP], 'spare');
  eq(r.s.ok, false, 'F5 --spare 已停用，报错终止');
  ok(/spare-parts-inventory-query/.test(r.s.error), 'F6 错误信息指向 spare-parts-inventory-query');
  ok(!/对应备件/.test(r.md || ''), 'F7 不再产出备件节');
});
// 检修历史按 SAP 工单导出列名（功能位置/订单号/实际结束日期/主工作中心）
const HIS2 = mk('his2.xlsx', {
  '工单': [
    ['功能位置', '订单号', '订单类型', '实际结束日期', '检修内容', '主工作中心'],
    ['P-01', '40000001', 'PM01', '2026-03-12', '更换机封', '一队'],
  ],
});
section('B', () => {
  r = run(['--input', LED, '--query', 'P-01', '--history', HIS2], 'history-sap');
  eq((r.j.records[0]['_检修历史'] || []).length, 1, 'F8 SAP 工单导出列名可关联检修历史');
  eq(r.j.records[0]['_检修历史'][0].order, '40000001', 'F9 工单号取自订单号列');
  eq(r.j.records[0]['_检修历史'][0].vendor, '一队', 'F10 承修单位取自主工作中心列');
});
// 业务系统故障/检修历史导出：未完工的记录没有实际结束日期和检修内容，要按发生时间排序并带出故障现象，不能显示成空行排在最后
const HIS3 = mk('his3.xlsx', {
  '检修历史': [
    ['通知单号', '工单号', '位号', '故障现象', '发生时间', '检修内容', '工单类型', '实际结束日期', '承修单位'],
    ['10000001', '20000001', 'E-01', '端差增大', '2025-12-18 12:28', '抽芯化学清洗', 'PM01', '2025-12-21', '静设备班'],
    ['10000002', '20000002', 'E-01', '管束内漏，需抽芯试压', '2026-10-31 09:36', '', 'PM01', '', '静设备班'],
  ],
});
section('C', () => {
  r = run(['--input', LED, '--query', 'E-01', '--history', HIS3], 'history-open');
  const h3 = (r.j && r.j.records[0]['_检修历史']) || [];
  eq(h3.length, 2, 'F11 未完工记录也关联');
  eq(h3[0] && h3[0].order, '20000002', 'F12 无完工日期的记录按发生时间排序（最新的在前）');
  eq(h3[0] && h3[0].date, null, 'F13 检修日期不用发生时间冒充');
  ok(/管束内漏，需抽芯试压/.test(r.md || ''), 'F14 未填检修内容时 md 带出故障现象');
  ok(/无完工日期/.test(r.md || ''), 'F15 md 写明无完工日期而不是只显示「—」');
});

// ============ G. 别名列头 + 标题行 + 合计行 ============
const ALIAS = mk('alias.xlsx', {
  '设备台账': [
    ['某厂台账导出'],
    [],
    ['设备编号', '名称', '型号', '厂家', '投用时间', '所属专业'],
    ['P-77', '泵77', 'ZA-80', '甲厂', '2015-08-01', '动设备'],
    ['合计', '', '', '', '', ''],
  ],
});
section('B', () => {
  r = run(['--input', ALIAS, '--query', 'P-77'], 'alias');
  eq(r.s.ok, true, 'G1 别名列头可读');
  eq(r.s.counts.matched, 1, 'G2 命中');
  eq(r.s.counts.ledgerTotal, 1, 'G3 合计行被跳过');
  ok(r.j.warnings.some((w) => w.includes('合计行')), 'G4 合计行 warning');
  eq(r.j.records[0]._matchedBy, '设备编号', 'G5 只有「设备编号」列的旧台账按设备编号命中，不再把设备编号当位号');
  eq(r.j.meta.hasTagCol, false, 'G6 记录台账无位号列');
  ok(r.j.warnings.some((w) => w.includes('仅按「设备编号」定位')), 'G7 无位号列时 warning');
});

// ============ J. SAP PM / EM 导出列名 ============
const SAP = mk('sap.xlsx', {
  '技术对象清单': [
    ['功能位置', '设备', '设备描述', '对象类型', 'ABC标识', '制造商', '型号编号', '建造年份', '开始日期', '工厂区段', '维护工厂', '成本中心'],
    ['1000-CDU-P1101A', '10001234', '回流泵A', '离心泵', 'A', '某泵厂', 'ZA-100-250', '2012', '2012-06-15', 'CDU', '1000', 'CC-01'],
    ['1000-CDU-V1301', '10005678', '缓冲罐', '压力容器', 'B', '某容器厂', 'φ3000', '2012', '', 'CDU', '1000', 'CC-02'],
  ],
});
section('A', () => {
  r = run(['--input', SAP, '--query', '1000-CDU-P1101A'], 'sap-tag');
  eq(r.s.ok, true, 'J1 SAP 技术对象清单可读（sheet 名「技术对象清单」）');
  eq(r.s.counts.matched, 1, 'J2 功能位置作位号命中');
  eq(r.j.records[0]._matchedBy, '位号', 'J3 命中依据记为位号');
  eq(r.j.records[0]['设备编号'], '10001234', 'J4 SAP「设备」列归设备编号');
  eq(r.j.records[0]['设备名称'], '回流泵A', 'J5 设备描述归设备名称');
  eq(r.j.records[0]['重要度'], 'A', 'J6 ABC标识归重要度');
  eq(r.j.records[0]['制造厂'], '某泵厂', 'J7 制造商归制造厂');
  eq(r.j.records[0]['规格型号'], 'ZA-100-250', 'J8 型号编号归规格型号');
  eq(r.j.records[0]['投用日期'], '2012-06-15', 'J9 开始日期归投用日期');
  eq(r.j.records[0]['建造年份'], '2012', 'J10 建造年份单独成列');
  eq(r.j.records[0]['专业'], '离心泵', 'J11 对象类型归专业/类别');
  eq(r.j.records[0]['装置'], 'CDU', 'J12 工厂区段归装置');
  eq(r.j.records[0]['车间'], '1000', 'J13 维护工厂归车间');
  eq(r.j.records[0]['成本中心'], 'CC-01', 'J14 成本中心列保留');
  ok(r.j.records[0]['_投用年限'] !== null, 'J15 有开始日期时推算投用年限');
});
section('C', () => {
  ok(/设备编号 10001234/.test(r.md), 'J16 md 标题位号与设备编号分别展示');
  ok(/按「位号」匹配/.test(r.md), 'J17 md 写明命中依据');
});

section('A', () => {
  r = run(['--input', SAP, '--query', '10005678'], 'sap-eqno');
  eq(r.s.counts.matched, 1, 'J18 按 8 位设备编号也能命中');
  eq(r.j.records[0]._matchedBy, '设备编号', 'J19 命中依据记为设备编号');
  eq(r.j.records[0]['位号'], '1000-CDU-V1301', 'J20 命中后同时展示位号');
  eq(r.j.records[0]['_投用年限'], null, 'J21 只有建造年份无开始日期 → 投用年限 null 不按年份推算');
  ok(/只有建造年份/.test(r.j.records[0]['_投用年限说明'] || ''), 'J22 说明只有建造年份');
  ok(r.j.warnings.some((w) => w.includes('投用年限未推算')), 'J23 warning 提示未推算');
  ok(/建造年份「2012」/.test(r.md), 'J24 md 展示建造年份而非留白');
});

section('B', () => {
  r = run(['--input', SAP, '--query', '{"type":"stats","groupBy":"重要度"}'], 'sap-stats');
  eq(r.j.stats.groups.length, 2, 'J25 按 ABC 标识统计');
});

// 位号别名「设备位号」+ 「设备型号」不被「设备」前缀抢走
const EM = mk('em.xlsx', {
  '设备台账': [
    ['设备位号', 'EM编码', '设备名称', '设备型号', '设备分级'],
    ['P-88', 'EM00088', '泵88', 'ZA-80', 'B'],
  ],
});
section('A', () => {
  r = run(['--input', EM, '--query', 'P-88'], 'em');
  eq(r.j.records[0]['设备编号'], 'EM00088', 'J26 EM编码归设备编号');
  eq(r.j.records[0]['规格型号'], 'ZA-80', 'J27 「设备型号」归规格型号，不被设备编号前缀抢走');
  eq(r.j.records[0]['重要度'], 'B', 'J28 设备分级归重要度');
});

// 既无位号也无设备编号 → 报错
const NOID = mk('noid.xlsx', { '设备台账': [['设备名称', '型号'], ['泵', 'ZA']] });
section('B', () => {
  r = run(['--input', NOID, '--query', 'P-01'], 'noid');
  eq(r.s.ok, false, 'J29 既无位号也无设备编号时报错');
});

// ============ K. --describe ============
section('B', () => {
  r = run(['--input', SAP, '--describe'], 'describe');
  eq(r.s.ok, true, 'K1 --describe 成功');
  eq(r.s.queryType, 'describe', 'K2 queryType 为 describe');
  ok(r.j.describe.some((d) => d.column === '位号' && d.samples.includes('1000-CDU-P1101A')), 'K3 列出位号样例值');
  ok(r.j.describe.some((d) => d.column === '投用日期' && d.filled === 1 && d.empty === 1), 'K4 统计已填/空行数');
});
section('C', () => {
  ok(r.j.describe.every((d) => d.samples.length <= 3), 'K5 样例值最多 3 个');
  ok(/## 一、列名与样例值/.test(r.md), 'K6 md 含列结构节');
  ok(!/查询结果/.test(r.md), 'K7 --describe 不做查询');
  eq(r.j.records, undefined, 'K8 --describe 不输出 records');
});
section('B', () => {
  r = run(['--input', LED, '--describe', '--query', 'P-01'], 'describe-q');
  eq(r.s.queryType, 'describe', 'K9 --describe 优先于 --query');
  ok(/--describe/.test(raw(['--input', LED, '--query', '{"type":"filter","where":[["设计压力","gt","1.0"]]}']).s.error), 'K10 字段不存在的错误信息提示 --describe');
});

// ============ L. 台账原有的其它列（业务系统导出常带设备类型、功率、设计压力等） ============
const EXT = mk('ext.xlsx', {
  '设备台账': [
    ['位号', '设备编号', '设备名称', '设备类型', '专业', '重要度', '特护标记', '功率(kW)', '设计压力(MPa)', '设备描述(备注)'],
    ['P-01', '10000001', '进料泵', '离心泵', '动设备', 'A', '是', 132, 2.5, '驱动端轴承'],
    ['P-02', '10000002', '回流泵', '离心泵', '动设备', 'B', '否', 75, 1.6, ''],
    ['E-01', '10000003', '换热器', '换热器', '静设备', 'B', '否', '', 0.8, ''],
  ],
});
section('B', () => {
  r = run(['--input', EXT, '--query', '{"type":"filter","where":[["设备类型","eq","离心泵"]]}'], 'ext-filter');
  eq(r.s.ok, true, 'L1 台账原有的其它列（设备类型）可作筛选条件');
  eq(r.s.counts && r.s.counts.matched, 2, 'L2 按设备类型筛出 2 台');
  r = run(['--input', EXT, '--query', '{"type":"stats","groupBy":"设备类型"}'], 'ext-stats');
  eq(r.j && r.j.stats && r.j.stats.groups.length, 2, 'L3 可按设备类型分组统计');
  r = run(['--input', EXT, '--query', '{"type":"filter","where":[["设计压力(MPa)","gt","1.0"]]}'], 'ext-unit');
  eq(r.s.counts && r.s.counts.matched, 2, 'L4 带单位的原列名「设计压力(MPa)」可做数值比较');
  r = run(['--input', EXT, '--query', '{"type":"filter","where":[["设计压力","gt","1.0"]]}'], 'ext-unit2');
  eq(r.s.counts && r.s.counts.matched, 2, 'L5 「设计压力」解析到唯一同名带单位列「设计压力(MPa)」');
  ok((r.s.appliedFilters || []).some((f) => f.startsWith('设计压力(MPa)')), 'L6 生效条件写实际列名（含单位）');
  r = run(['--input', EXT, '--query', '{"type":"filter","where":[["压力","gt","1.0"]]}'], 'ext-unit3');
  eq(r.s.ok, false, 'L7 「压力」不按包含关系匹配到「设计压力(MPa)」，仍报字段不存在');
  r = run(['--input', EXT, '--query', 'P-01'], 'ext-detail');
  eq(r.j && r.j.records[0]['功率(kW)'], '132', 'L8 单台详情返回台账原有的功率列');
  ok(/\| 功率\(kW\) \| 132 \|/.test(r.md || ''), 'L9 md 详情表含功率列');
  eq(r.j && r.j.records[0]['设备名称'], '进料泵', 'L10 「设备名称」仍取标准列，不被「设备描述(备注)」抢走');
  eq(r.j && r.j.records[0]['设备描述(备注)'], '驱动端轴承', 'L11 「设备描述(备注)」作为其它列原样保留');
  r = run(['--input', EXT, '--describe'], 'ext-describe');
  ok(r.j && r.j.describe.some((d) => d.column === '设计压力(MPa)' && d.filled === 3), 'L12 --describe 列出其它列');
  ok(r.j && r.j.describe.some((d) => d.column === '功率(kW)' && d.filled === 2 && d.empty === 1), 'L13 --describe 其它列统计已填/空行数');
});
// 「特护标记」不是重要度（ABC）：关键设备按 A 类还是特护要向用户确认，不能混成一列
const TH = mk('th.xlsx', { '设备台账': [['位号', '设备名称', '特护标记'], ['P-01', '泵1', '是']] });
section('A', () => {
  r = run(['--input', TH, '--query', 'P-01'], 'th');
  eq(r.j && r.j.records[0]['重要度'], undefined, 'L14 无重要度列时「特护标记」不归入重要度');
  eq(r.j && r.j.records[0]['特护标记'], '是', 'L15 「特护标记」作为其它列原样保留');
});
// --fields 中不存在的字段要进 result.json
section('B', () => {
  r = run(['--input', EXT, '--query', '{"type":"filter","where":[["专业","eq","动设备"]]}', '--fields', '位号,转速'], 'ext-fields');
  ok(r.j && r.j.fieldsNotFound.includes('转速'), 'L16 --fields 不存在的字段写入 result.json 的 fieldsNotFound');
  eq(r.j && r.j.counts.fieldsNotFound, 1, 'L17 counts.fieldsNotFound 计入 --fields 缺失字段');
  ok(r.j && r.j.warnings.some((w) => w.includes('转速')), 'L18 --fields 缺失字段 warning 写入 result.json');
});

// ============ H. 参数校验 ============
function raw(args) {
  const x = spawnSync(process.execPath, [Q, ...args], { encoding: 'utf8' });
  const l = x.stdout.trim().split('\n');
  try { return { code: x.status, s: JSON.parse(l[l.length - 1]) }; } catch (e) { return { code: x.status, s: { ok: false } }; }
}
section('B', () => {
  eq(raw([]).s.ok, false, 'H1 无参数报错');
  eq(raw(['--input']).s.ok, false, 'H2 --input 缺值报错');
});
section('C', () => {
  ok(/缺少取值/.test(raw(['--input']).s.error), 'H3 缺值信息正确');
});
section('B', () => {
  eq(raw(['--input', LED]).s.ok, false, 'H4 缺 --query 报错');
  eq(raw(['--input', '/不存在.xlsx', '--query', 'P-01']).s.ok, false, 'H5 输入不存在报错');
  eq(raw(['--input', LED, '--query', '{坏JSON']).s.ok, false, 'H6 非法 JSON 报错');
});
section('C', () => {
  ok(/不是合法 JSON/.test(raw(['--input', LED, '--query', '{坏JSON']).s.error), 'H7 JSON 错误信息明确');
});
section('B', () => {
  eq(raw(['--input', LED, '--query', '{"type":"unknown"}']).s.ok, false, 'H8 非法 type 报错');
  eq(raw(['--input', LED, '--query', '{"type":"filter","where":[["专业","badop","x"]]}']).s.ok, false, 'H9 非法操作符报错');
});
section('C', () => {
  ok(/不支持的操作符/.test(raw(['--input', LED, '--query', '{"type":"filter","where":[["专业","badop","x"]]}']).s.error), 'H10 操作符错误列出可用值');
});
section('B', () => {
  eq(raw(['--input', LED, '--query', 'P-01', '--limit', 'abc']).s.ok, false, 'H11 非法 limit 报错');
  eq(raw(['--input', LED, '--query', 'P-01', '--未知', 'x']).s.ok, false, 'H12 未知参数报错');
  eq(raw(['--input', mk('nosheet.xlsx', { '别的': [['a'], [1]] }), '--query', 'P-01']).s.ok, false, 'H13 无台账工作表报错');
});

// ============ I. 产出完整性 ============
section('BVT', () => {
  r = run(['--input', LED, '--query', '{"type":"filter","where":[["专业","eq","动设备"]]}'], 'outputs');
  ok(fs.existsSync(path.join(r.out, 'result.json')), 'I1 result.json 生成');
  ok(fs.existsSync(path.join(r.out, 'result.md')), 'I2 result.md 生成');
  ok(fs.existsSync(path.join(r.out, 'summary.json')), 'I3 summary.json 生成');
  ok(fs.existsSync(path.join(r.out, 'result.xlsx')), 'I4 多条结果导出 xlsx');
  const xb = readXlsx(path.join(r.out, 'result.xlsx'));
  ok(xb['查询结果'] && xb['查询结果'].length === 4, 'I5 xlsx 含表头+3行');
  ok(r.j.meta.presentColumns.includes('位号'), 'I6 记录台账实际列');
  ok(r.j.meta.baseDate, 'I7 记录计算基准日期');
});
// 默认输出目录：系统临时目录而非 cwd
section('B', () => {
  const x = spawnSync(process.execPath, [Q, '--input', LED, '--query', 'P-01'], { encoding: 'utf8', cwd: work });
  const l = x.stdout.trim().split('\n');
  let sj = {}; try { sj = JSON.parse(l[l.length - 1]); } catch (e) {}
  ok(sj.ok === true && sj.out && sj.out.startsWith(os.tmpdir()), 'I8 默认输出目录在 os.tmpdir()');
  ok(!fs.existsSync(path.join(work, 'elq-out')), 'I9 不在当前目录生成 elq-out');
});

// ============ M. 列名不被别名抢走：设备类型不进设备编号、不改名为专业（2026-11-04 复核补充） ============
const NOEQ = mk('noeq.xlsx', { '设备台账': [['位号', '设备名称', '设备类型', '专业', '设计压力(MPa)'], ['P-1', '泵', '离心泵', '动设备', 1.6], ['P-2', '泵2', '往复泵', '动设备', 2.5]] });
section('B', () => {
  r = run(['--input', NOEQ, '--query', '{"type":"filter","where":[["设备类型","eq","离心泵"]]}'], 'noeq');
  eq(r.s.ok, true, 'M1 无设备编号列时「设备类型」不被前缀匹配进设备编号，可作筛选条件');
  eq(r.s.counts && r.s.counts.matched, 1, 'M2 按设备类型筛出 1 台');
  r = run(['--input', NOEQ, '--query', 'P-1'], 'noeq-detail');
  ok(r.j && r.j.records[0] && r.j.records[0]['设备编号'] == null, `M3 无设备编号列时设备编号为空，不取设备类型的值（实际 ${r.j && r.j.records[0] && r.j.records[0]['设备编号']}）`);
  eq(r.j && r.j.records[0]['设备类型'], '离心泵', 'M4 设备类型按原列名保留');
});
const ONLYT = mk('onlytype.xlsx', { '设备台账': [['位号', '设备名称', '设备类型'], ['P-1', '泵', '离心泵']] });
section('B', () => {
  r = run(['--input', ONLYT, '--query', '{"type":"filter","where":[["设备类型","eq","离心泵"]]}'], 'onlytype');
  eq(r.s.ok, true, 'M5 无专业列时「设备类型」不被改名为「专业」，仍可按原列名筛选');
  r = run(['--input', ONLYT, '--describe'], 'onlytype-describe');
  ok(r.j && r.j.describe.some((d) => d.column === '设备类型') && !r.j.describe.some((d) => d.column === '专业' && d.filled > 0), 'M6 --describe 列出「设备类型」，不出现有值的「专业」');
});
const NOEQ2 = mk('noeq2.xlsx', { '设备台账': [['位号', '设备类别', '设备等级', '设备名称'], ['P-1', '动设备', 'A', '泵']] });
section('B', () => {
  r = run(['--input', NOEQ2, '--query', 'P-1'], 'noeq2');
  ok(r.j && r.j.records[0] && r.j.records[0]['设备编号'] == null, 'M7 设备类别 / 设备等级也不被前缀匹配进设备编号');
  eq(r.j && r.j.records[0]['专业'], '动设备', 'M8 「设备类别」仍归专业（别名不变）');
});
section('C', () => {
  r = run(['--input', SAP, '--query', '1000-CDU-P1101A'], 'sap-tag2');
  eq(r.j && r.j.records[0]['设备编号'], '10001234', 'M9 SAP 表头恰为「设备」时仍归设备编号');
});

console.log(`\n${'='.repeat(56)}`);
console.log(`equipment-ledger-query 自测：${pass} 通过，${fail} 失败`);
console.log(`用例级别 ${LEVELS[RUN_LEVEL]}：BVT ${byLevel.BVT}，A ${byLevel.A}，B ${byLevel.B}，C ${byLevel.C}`);
if (failures.length) { console.log('\n失败项：'); failures.forEach((f) => console.log('  ✗ ' + f)); }
console.log('='.repeat(56));
try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
