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
const ok = (c, n) => { if (c) pass++; else { fail++; failures.push(n); } };
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
let r = run(['--input', LED, '--query', 'P-01'], 'detail');
eq(r.s.ok, true, 'A1 简写位号查询成功');
eq(r.s.counts.matched, 1, 'A2 命中 1 条');
eq(r.j.records[0]['设备名称'], '泵1', 'A3 字段返回正确');
ok(/## P-01/.test(r.md), 'A4 md 标题含位号');
ok(/投用年限/.test(r.md), 'A5 输出派生的投用年限');
ok(/以 \d{4}-\d{2}-\d{2} 为基准计算/.test(r.md), 'A6 投用年限注明基准日期');
ok(/权威数据以 EM 设备管理信息系统 \/ ERP（SAP PM）/.test(r.md), 'A7 保留权威数据声明行（EM / SAP PM 口径）');
ok(!/EAM/.test(r.md), 'A7b md 不再出现 EAM');
ok(/spare-parts-inventory-query/.test(r.md), 'A7c md 指引备件查询用 spare-parts-inventory-query');
ok(/## 一、/.test(r.md), 'A7d 章节用中文序号');

// 大小写不敏感
r = run(['--input', LED, '--query', 'p-01'], 'detail-lower');
eq(r.s.counts.matched, 1, 'A8 位号大小写不敏感');

// 查不到 → 明确告知，不放宽
r = run(['--input', LED, '--query', 'P-99'], 'notfound');
eq(r.s.ok, true, 'A9 查不到仍正常退出');
eq(r.s.counts.matched, 0, 'A10 命中 0 条');
ok(r.j.warnings.some((w) => w.includes('未查到位号或设备编号')), 'A11 warning 明确未查到（位号或设备编号）');
ok(/未查到符合条件的设备/.test(r.md), 'A12 md 明确未查到');
ok(/未放宽条件返回近似结果/.test(r.md), 'A13 md 声明未放宽条件');

// ============ B. 空值显示 ============
r = run(['--input', LED, '--query', 'P-02'], 'empty-field');
ok(/—（台账未填）/.test(r.md), 'B1 空字段显示「台账未填」不留白');
eq(r.j.records[0]['规格型号'], null, 'B2 空字段 JSON 中为 null 不是空串');

// ============ C. filter 查询 ============
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

// 排序
r = run(['--input', LED, '--query', '{"type":"filter","where":[["专业","eq","动设备"]],"orderBy":{"field":"投用日期","dir":"asc"}}'], 'filter-order');
eq(r.j.records[0]['位号'], 'P-01', 'C8 升序排序正确');
r = run(['--input', LED, '--query', '{"type":"filter","where":[["专业","eq","动设备"]],"orderBy":{"field":"投用日期","dir":"desc"}}'], 'filter-desc');
eq(r.j.records[0]['位号'], 'P-02', 'C9 降序排序正确');

// limit
r = run(['--input', LED, '--query', '{"type":"filter","where":[]}', '--limit', '2'], 'limit');
eq(r.s.counts.matched, 2, 'C10 limit 生效');
ok(r.j.warnings.some((w) => w.includes('仅返回前')), 'C11 截断时 warning');

// ============ D. 字段不存在：必须报错而不是静默返回全部 ============
r = run(['--input', LED, '--query', '{"type":"filter","where":[["设计压力","gt","1.0"]]}'], 'nofield');
eq(r.s.ok, false, 'D1 字段不存在时报错');
eq(r.code, 1, 'D2 退出码 1');
ok(/无字段/.test(r.s.error), 'D3 错误信息指出无此字段');
ok(/台账实际字段/.test(r.s.error), 'D4 错误信息列出实际字段');

// ============ E. stats 查询 ============
r = run(['--input', LED, '--query', '{"type":"stats","groupBy":"专业"}'], 'stats');
eq(r.s.ok, true, 'E1 统计查询成功');
eq(r.j.stats.total, 6, 'E2 总数正确');
eq(r.j.stats.groups.length, 3, 'E3 分组数正确');
eq(r.j.stats.groups[0].key, '动设备', 'E4 按数量降序');
eq(r.j.stats.groups[0].count, 3, 'E5 分组计数正确');
ok(/占比/.test(r.md), 'E6 md 含占比列');

r = run(['--input', LED, '--query', '{"type":"stats","groupBy":"专业","where":[["区域","eq","二区"]]}'], 'stats-where');
eq(r.j.stats.total, 3, 'E7 统计可带筛选条件');

r = run(['--input', LED, '--query', '{"type":"stats","groupBy":"不存在字段"}'], 'stats-nofield');
eq(r.s.ok, false, 'E8 统计字段不存在时报错');

// ============ F. 关联表 ============
const HIS = mk('his.xlsx', {
  '检修历史': [
    ['位号', '检修日期', '检修内容', '承修单位'],
    ['P-01', '2026-03-12', '更换机封', '一队'],
    ['P-01', '2025-08-20', '更换轴承', '一队'],
    ['P-01', '2024-01-05', '大修', '二队'],
  ],
});
r = run(['--input', LED, '--query', 'P-01', '--history', HIS], 'history');
eq(r.j.records[0]['_检修历史'].length, 3, 'F1 关联检修历史');
eq(r.j.records[0]['_检修历史'][0].date, '2026-03-12', 'F2 检修历史按时间倒序');
ok(/### 检修历史/.test(r.md), 'F3 md 含检修历史节');

r = run(['--input', LED, '--query', 'P-02', '--history', HIS], 'history-none');
eq(r.j.records[0]['_检修历史'].length, 0, 'F4 无历史记录返回空数组');

const SP = mk('sp.xlsx', {
  '备件对应': [['位号', '备件名称', '备件编码', '规格型号'], ['P-01', '机械密封', 'BJ-001', '104-45']],
});
r = run(['--input', LED, '--query', 'P-01', '--spare', SP], 'spare');
eq(r.s.ok, false, 'F5 --spare 已停用，报错终止');
ok(/spare-parts-inventory-query/.test(r.s.error), 'F6 错误信息指向 spare-parts-inventory-query');
ok(!/对应备件/.test(r.md || ''), 'F7 不再产出备件节');
// 检修历史按 SAP 工单导出列名（功能位置/订单号/实际结束日期/主工作中心）
const HIS2 = mk('his2.xlsx', {
  '工单': [
    ['功能位置', '订单号', '订单类型', '实际结束日期', '检修内容', '主工作中心'],
    ['P-01', '40000001', 'PM01', '2026-03-12', '更换机封', '一队'],
  ],
});
r = run(['--input', LED, '--query', 'P-01', '--history', HIS2], 'history-sap');
eq((r.j.records[0]['_检修历史'] || []).length, 1, 'F8 SAP 工单导出列名可关联检修历史');
eq(r.j.records[0]['_检修历史'][0].order, '40000001', 'F9 工单号取自订单号列');
eq(r.j.records[0]['_检修历史'][0].vendor, '一队', 'F10 承修单位取自主工作中心列');

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
r = run(['--input', ALIAS, '--query', 'P-77'], 'alias');
eq(r.s.ok, true, 'G1 别名列头可读');
eq(r.s.counts.matched, 1, 'G2 命中');
eq(r.s.counts.ledgerTotal, 1, 'G3 合计行被跳过');
ok(r.j.warnings.some((w) => w.includes('合计行')), 'G4 合计行 warning');
eq(r.j.records[0]._matchedBy, '设备编号', 'G5 只有「设备编号」列的旧台账按设备编号命中，不再把设备编号当位号');
eq(r.j.meta.hasTagCol, false, 'G6 记录台账无位号列');
ok(r.j.warnings.some((w) => w.includes('仅按「设备编号」定位')), 'G7 无位号列时 warning');

// ============ J. SAP PM / EM 导出列名 ============
const SAP = mk('sap.xlsx', {
  '技术对象清单': [
    ['功能位置', '设备', '设备描述', '对象类型', 'ABC标识', '制造商', '型号编号', '建造年份', '开始日期', '工厂区段', '维护工厂', '成本中心'],
    ['1000-CDU-P1101A', '10001234', '回流泵A', '离心泵', 'A', '某泵厂', 'ZA-100-250', '2012', '2012-06-15', 'CDU', '1000', 'CC-01'],
    ['1000-CDU-V1301', '10005678', '缓冲罐', '压力容器', 'B', '某容器厂', 'φ3000', '2012', '', 'CDU', '1000', 'CC-02'],
  ],
});
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
ok(/设备编号 10001234/.test(r.md), 'J16 md 标题位号与设备编号分别展示');
ok(/按「位号」匹配/.test(r.md), 'J17 md 写明命中依据');

r = run(['--input', SAP, '--query', '10005678'], 'sap-eqno');
eq(r.s.counts.matched, 1, 'J18 按 8 位设备编号也能命中');
eq(r.j.records[0]._matchedBy, '设备编号', 'J19 命中依据记为设备编号');
eq(r.j.records[0]['位号'], '1000-CDU-V1301', 'J20 命中后同时展示位号');
eq(r.j.records[0]['_投用年限'], null, 'J21 只有建造年份无开始日期 → 投用年限 null 不按年份推算');
ok(/只有建造年份/.test(r.j.records[0]['_投用年限说明'] || ''), 'J22 说明只有建造年份');
ok(r.j.warnings.some((w) => w.includes('投用年限未推算')), 'J23 warning 提示未推算');
ok(/建造年份「2012」/.test(r.md), 'J24 md 展示建造年份而非留白');

r = run(['--input', SAP, '--query', '{"type":"stats","groupBy":"重要度"}'], 'sap-stats');
eq(r.j.stats.groups.length, 2, 'J25 按 ABC 标识统计');

// 位号别名「设备位号」+ 「设备型号」不被「设备」前缀抢走
const EM = mk('em.xlsx', {
  '设备台账': [
    ['设备位号', 'EM编码', '设备名称', '设备型号', '设备分级'],
    ['P-88', 'EM00088', '泵88', 'ZA-80', 'B'],
  ],
});
r = run(['--input', EM, '--query', 'P-88'], 'em');
eq(r.j.records[0]['设备编号'], 'EM00088', 'J26 EM编码归设备编号');
eq(r.j.records[0]['规格型号'], 'ZA-80', 'J27 「设备型号」归规格型号，不被设备编号前缀抢走');
eq(r.j.records[0]['重要度'], 'B', 'J28 设备分级归重要度');

// 既无位号也无设备编号 → 报错
const NOID = mk('noid.xlsx', { '设备台账': [['设备名称', '型号'], ['泵', 'ZA']] });
r = run(['--input', NOID, '--query', 'P-01'], 'noid');
eq(r.s.ok, false, 'J29 既无位号也无设备编号时报错');

// ============ K. --describe ============
r = run(['--input', SAP, '--describe'], 'describe');
eq(r.s.ok, true, 'K1 --describe 成功');
eq(r.s.queryType, 'describe', 'K2 queryType 为 describe');
ok(r.j.describe.some((d) => d.column === '位号' && d.samples.includes('1000-CDU-P1101A')), 'K3 列出位号样例值');
ok(r.j.describe.some((d) => d.column === '投用日期' && d.filled === 1 && d.empty === 1), 'K4 统计已填/空行数');
ok(r.j.describe.every((d) => d.samples.length <= 3), 'K5 样例值最多 3 个');
ok(/## 一、列名与样例值/.test(r.md), 'K6 md 含列结构节');
ok(!/查询结果/.test(r.md), 'K7 --describe 不做查询');
eq(r.j.records, undefined, 'K8 --describe 不输出 records');
r = run(['--input', LED, '--describe', '--query', 'P-01'], 'describe-q');
eq(r.s.queryType, 'describe', 'K9 --describe 优先于 --query');
ok(/--describe/.test(raw(['--input', LED, '--query', '{"type":"filter","where":[["设计压力","gt","1.0"]]}']).s.error), 'K10 字段不存在的错误信息提示 --describe');

// ============ H. 参数校验 ============
function raw(args) {
  const x = spawnSync(process.execPath, [Q, ...args], { encoding: 'utf8' });
  const l = x.stdout.trim().split('\n');
  try { return { code: x.status, s: JSON.parse(l[l.length - 1]) }; } catch (e) { return { code: x.status, s: { ok: false } }; }
}
eq(raw([]).s.ok, false, 'H1 无参数报错');
eq(raw(['--input']).s.ok, false, 'H2 --input 缺值报错');
ok(/缺少取值/.test(raw(['--input']).s.error), 'H3 缺值信息正确');
eq(raw(['--input', LED]).s.ok, false, 'H4 缺 --query 报错');
eq(raw(['--input', '/不存在.xlsx', '--query', 'P-01']).s.ok, false, 'H5 输入不存在报错');
eq(raw(['--input', LED, '--query', '{坏JSON']).s.ok, false, 'H6 非法 JSON 报错');
ok(/不是合法 JSON/.test(raw(['--input', LED, '--query', '{坏JSON']).s.error), 'H7 JSON 错误信息明确');
eq(raw(['--input', LED, '--query', '{"type":"unknown"}']).s.ok, false, 'H8 非法 type 报错');
eq(raw(['--input', LED, '--query', '{"type":"filter","where":[["专业","badop","x"]]}']).s.ok, false, 'H9 非法操作符报错');
ok(/不支持的操作符/.test(raw(['--input', LED, '--query', '{"type":"filter","where":[["专业","badop","x"]]}']).s.error), 'H10 操作符错误列出可用值');
eq(raw(['--input', LED, '--query', 'P-01', '--limit', 'abc']).s.ok, false, 'H11 非法 limit 报错');
eq(raw(['--input', LED, '--query', 'P-01', '--未知', 'x']).s.ok, false, 'H12 未知参数报错');
eq(raw(['--input', mk('nosheet.xlsx', { '别的': [['a'], [1]] }), '--query', 'P-01']).s.ok, false, 'H13 无台账工作表报错');

// ============ I. 产出完整性 ============
r = run(['--input', LED, '--query', '{"type":"filter","where":[["专业","eq","动设备"]]}'], 'outputs');
ok(fs.existsSync(path.join(r.out, 'result.json')), 'I1 result.json 生成');
ok(fs.existsSync(path.join(r.out, 'result.md')), 'I2 result.md 生成');
ok(fs.existsSync(path.join(r.out, 'summary.json')), 'I3 summary.json 生成');
ok(fs.existsSync(path.join(r.out, 'result.xlsx')), 'I4 多条结果导出 xlsx');
const xb = readXlsx(path.join(r.out, 'result.xlsx'));
ok(xb['查询结果'] && xb['查询结果'].length === 4, 'I5 xlsx 含表头+3行');
ok(r.j.meta.presentColumns.includes('位号'), 'I6 记录台账实际列');
ok(r.j.meta.baseDate, 'I7 记录计算基准日期');
// 默认输出目录：系统临时目录而非 cwd
{
  const x = spawnSync(process.execPath, [Q, '--input', LED, '--query', 'P-01'], { encoding: 'utf8', cwd: work });
  const l = x.stdout.trim().split('\n');
  let sj = {}; try { sj = JSON.parse(l[l.length - 1]); } catch (e) {}
  ok(sj.ok === true && sj.out && sj.out.startsWith(os.tmpdir()), 'I8 默认输出目录在 os.tmpdir()');
  ok(!fs.existsSync(path.join(work, 'elq-out')), 'I9 不在当前目录生成 elq-out');
}

console.log(`\n${'='.repeat(56)}`);
console.log(`equipment-ledger-query 自测：${pass} 通过，${fail} 失败`);
if (failures.length) { console.log('\n失败项：'); failures.forEach((f) => console.log('  ✗ ' + f)); }
console.log('='.repeat(56));
try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
