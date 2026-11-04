#!/usr/bin/env node
'use strict';
/** 自测：断言 inventory.js 与 substitution.js 行为。用法：node scripts/selftest.js */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { writeXlsx, readXlsx } = require('./lib/xlsx-lite');
const SUB = require('./lib/substitution');

const INV = path.join(__dirname, 'inventory.js');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'spi-selftest-'));
let pass = 0, fail = 0;
const failures = [];
const ok = (c, n) => { if (c) pass++; else { fail++; failures.push(n); } };
const eq = (a, e, n) => ok(a === e, `${n}（期望 ${JSON.stringify(e)}，实际 ${JSON.stringify(a)}）`);

function run(args, tag) {
  const out = path.join(work, tag + '-out');
  const r = spawnSync(process.execPath, [INV, ...args, '--out', out], { encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  let s; try { s = JSON.parse(lines[lines.length - 1]); } catch (e) { s = { ok: false, error: 'no-json:' + r.stdout + r.stderr }; }
  let j = null, md = null;
  if (fs.existsSync(path.join(out, 'inventory.json'))) j = JSON.parse(fs.readFileSync(path.join(out, 'inventory.json'), 'utf8'));
  if (fs.existsSync(path.join(out, 'inventory.md'))) md = fs.readFileSync(path.join(out, 'inventory.md'), 'utf8');
  return { code: r.status, s, j, md, out };
}
const mk = (n, b) => { const p = path.join(work, n); writeXlsx(p, b); return p; };

const STOCK = mk('stock.xlsx', {
  '库存表': [
    ['备件编码', '备件名称', '规格型号', '单位', '库存量', '安全库存', '库位', '状态', '位号', '材质', '压力等级', '温度范围'],
    ['A-01', '机械密封', '104-45 碳化硅', '套', 5, 2, 'A-1', '可用', 'P-01', '碳化硅', 'PN16', '-20~120℃'],
    ['A-02', '机械密封', '104-45 碳化钨', '套', 1, 3, 'A-2', '可用', 'P-02', '碳化钨', 'PN25', '-20~200℃'],
    ['B-01', '轴承', '6310 C3', '套', 8, 4, 'B-1', '可用', 'P-01', '', '', ''],
    ['B-02', '轴承', '6312 C3', '套', '', 4, 'B-2', '可用', 'P-03', '', '', ''],
    ['C-01', '球阀', 'DN100 PN40', '台', -2, 1, 'C-1', '待盘点', '', 'A105', 'PN40', ''],
  ],
});

// ============ A. 代用库单元测试 ============
eq(SUB.categoryOf('104-45机械密封'), '机械密封', 'A1 类别识别-机封');
eq(SUB.categoryOf('6310轴承'), '轴承', 'A2 类别识别-轴承');
eq(SUB.categoryOf('DN100球阀'), '阀门', 'A3 类别识别-阀门');
eq(SUB.categoryOf('完全不认识的东西'), '通用', 'A4 无法识别→通用');
ok(SUB.checkPoints('机械密封').includes('介质相容性'), 'A5 机封确认要点含介质相容性');
ok(SUB.checkPoints('轴承').includes('游隙等级'), 'A6 轴承确认要点含游隙');
ok(SUB.checkPoints('不认识').length > 0, 'A7 通用类别也有确认要点');
ok(SUB.specSimilarity('DN100 PN40', 'DN100 PN16') > 0, 'A8 规格相似度可计算');
eq(SUB.specSimilarity('', 'x'), 0, 'A9 空规格相似度为 0');
const dif = SUB.diffFields({ spec: 'a', material: 'x' }, { spec: 'b', material: 'x' }, ['spec', 'material']);
eq(dif.length, 1, 'A10 只返回有差异的字段');
eq(dif[0].field, 'spec', 'A11 差异字段名正确');

// ============ B. 精确查询 ============
let r = run(['--input', STOCK, '--query', 'A-01'], 'exact');
eq(r.s.ok, true, 'B1 精确查询成功');
eq(r.s.counts.matched, 1, 'B2 命中 1 条');
eq(r.j.matches[0].code, 'A-01', 'B3 编码正确');
eq(r.j.matches[0].qty, 5, 'B4 库存量正确');
ok(/实物数量以仓库实盘为准/.test(r.md), 'B5 保留实盘声明');

// 大小写与空格不敏感
r = run(['--input', STOCK, '--query', 'a-01'], 'exact-lower');
eq(r.s.counts.matched, 1, 'B6 编码大小写不敏感');

// 按名称查
r = run(['--input', STOCK, '--query', '轴承'], 'byname');
ok(r.s.counts.matched >= 1, 'B7 按名称可查');

// ============ C. 查不到不放宽（核心） ============
r = run(['--input', STOCK, '--query', 'ZZZ-999'], 'notfound');
eq(r.s.ok, true, 'C1 查不到仍正常退出');
eq(r.s.counts.matched, 0, 'C2 命中 0 条');
ok(r.j.warnings.some((w) => w.includes('未放宽条件')), 'C3 warning 声明未放宽条件');
ok(/未查到/.test(r.md), 'C4 md 明确未查到');
ok(/未放宽条件返回近似结果/.test(r.md), 'C5 md 声明未放宽');
// 查不到时不得返回任何库存条目：md 的「一、查询结果」节内不应出现任何备件编码
const sec1 = (r.md.match(/## 一、查询结果[\s\S]*?## 二、/) || [''])[0];
ok(!/\b[A-Z]-\d{2}\b/.test(sec1), 'C6 查不到时结果节内无任何备件条目（未返回近似项）');

// fuzzy 需显式开启
r = run(['--input', STOCK, '--query', '机械'], 'nofuzzy');
eq(r.s.counts.matched, 0, 'C7 默认不做包含匹配');
r = run(['--input', STOCK, '--query', '机械', '--fuzzy'], 'fuzzy');
eq(r.s.counts.matched, 2, 'C8 --fuzzy 开启后包含匹配');
ok(r.j.warnings.some((w) => w.includes('请核对是否为所需备件')), 'C9 模糊匹配提示需核对');

// ============ D. 安全库存判定 ============
r = run(['--input', STOCK, '--query', 'A-02'], 'below');
eq(r.s.counts.belowSafety, 1, 'D1 低于安全库存识别');
eq(r.j.belowSafety[0].gap, 2, 'D2 缺口计算正确');

// 库存量为空 → 无法判定，不按满足处理
r = run(['--input', STOCK, '--query', 'B-02'], 'qtynull');
eq(r.j.matches[0].qty, null, 'D3 空库存量为 null 不是 0');
eq(r.s.counts.belowSafety, 0, 'D4 空库存量不计入低于安全库存');
eq(r.s.counts.safetyUndetermined, 1, 'D5 空库存量计入无法判定');
ok(/无法判定是否低于安全库存/.test(r.md), 'D6 md 单列无法判定');
ok(r.j.safetyUndetermined[0].note.includes('未按满足处理'), 'D7 说明未按满足处理');

// 缺安全库存列
const NOSAFE = mk('nosafe.xlsx', {
  '库存表': [['备件编码', '备件名称', '规格型号', '单位', '库存量', '库位'], ['X-01', '机械密封', '104-45', '套', 5, 'A-1']],
});
r = run(['--input', NOSAFE, '--query', 'X-01'], 'nosafecol');
eq(r.s.ok, true, 'D8 缺安全库存列不中断');
eq(r.s.counts.safetyUndetermined, 1, 'D9 未设安全库存计入无法判定');
eq(r.s.counts.belowSafety, 0, 'D10 未设安全库存不判为低于');

// 负库存 warning
r = run(['--input', STOCK, '--query', 'C-01'], 'negative');
ok(r.j.warnings.some((w) => w.includes('库存量为负')), 'D11 负库存 warning');
eq(r.j.matches[0].qty, -2, 'D12 负库存原样保留不清零');

// ============ E. 同名多编码不合并（核心） ============
r = run(['--input', STOCK, '--query', 'A-01'], 'ambig');
eq(r.s.counts.ambiguous, 1, 'E1 命中相关的同名多编码');
eq(r.j.ambiguous[0].codes.length, 2, 'E2 列出 2 个编码');
ok(r.j.ambiguous[0].note.includes('库存未合并'), 'E3 说明未合并');
ok(r.j.warnings.some((w) => w.includes('库存未合并')), 'E4 warning 提示未合并');
// 不相关的同名不报
ok(!r.j.ambiguous.some((x) => x.name === '轴承'), 'E5 与查询无关的同名不报（避免噪声）');
// 但库存确实没合并
const totalQty = r.j.matches.reduce((n, m) => n + (m.qty || 0), 0);
eq(totalQty, 5, 'E6 只返回所查编码的库存，未合并同名的另一编码');

// ============ F. 在途 ============
const TRANSIT = mk('transit.xlsx', {
  '在途采购': [['备件编码', '备件名称', '到货数量', '单位', '预计到货'],
    ['A-02', '机械密封', 3, '套', '2026-09-30'],
    ['A-02', '机械密封', 2, '套', '2026-10-20']],
});
r = run(['--input', STOCK, '--query', 'A-02', '--intransit', TRANSIT], 'transit');
eq(r.s.counts.inTransit, 1, 'F1 在途记录关联');
eq(r.j.inTransit[0].arrivals.length, 2, 'F2 两批到货均列出');
eq(r.j.inTransit[0].arrivals[0].eta, '2026-09-30', 'F3 到货日期解析');
r = run(['--input', STOCK, '--query', 'A-01'], 'notransit');
eq(r.s.counts.inTransit, null, 'F4 未提供在途表时为 null 不是 0');
ok(/未提供在途采购表/.test(r.md), 'F5 md 说明未提供');

// ============ G. 代用候选不下结论（核心） ============
const CAT = mk('cat.xlsx', {
  '备件目录': [['备件编码', '备件名称', '规格型号', '单位', '材质', '压力等级', '温度范围'],
    ['A-99', '机械密封', '104-45 碳化硅', '套', '碳化硅', 'PN40', '-20~250℃']],
});
r = run(['--input', STOCK, '--query', 'A-02', '--catalog', CAT, '--alternatives'], 'alt');
eq(r.s.ok, true, 'G1 代用检索成功');
ok(r.s.counts.alternatives > 0, 'G2 检索到候选');
ok(r.j.alternatives[0].checkPoints.length > 0, 'G3 输出技术确认要点');
ok(r.j.alternatives[0].note.includes('须由设备工程师或技术人员确认'), 'G4 note 要求人工确认');
ok(/代用是否可行须由设备工程师或技术人员确认/.test(r.md), 'G5 md 写明需人工确认');
ok(!/可以代用|建议代用|可代替|能替代/.test(r.md), 'G6 md 未出现任何可代用结论');
ok(r.j.alternatives[0].candidates.every((c) => Array.isArray(c.diffs)), 'G7 每个候选带参数差异');
ok(r.j.alternatives[0].candidates.some((c) => c.diffs.length > 0), 'G8 差异项被识别');
ok(r.j.meta.statement.includes('不给出可否代用的结论'), 'G9 meta 声明不下结论');
// 未开启时为 null
r = run(['--input', STOCK, '--query', 'A-02'], 'noalt');
eq(r.s.counts.alternatives, null, 'G10 未开启代用时为 null');
ok(/未启用代用候选检索/.test(r.md), 'G11 md 说明未启用');
// 同类才做候选
r = run(['--input', STOCK, '--query', 'B-01', '--alternatives'], 'altcat');
ok(r.j.alternatives[0].candidates.every((c) => /轴承/.test(c.name)), 'G12 候选限定同类别');

// ============ H. 按设备位号查 ============
r = run(['--input', STOCK, '--tag', 'P-01'], 'bytag');
eq(r.s.ok, true, 'H1 按位号查成功');
eq(r.s.counts.matched, 2, 'H2 命中该设备的备件');
r = run(['--input', STOCK, '--tag', 'P-99'], 'bytag-none');
eq(r.s.counts.matched, 0, 'H3 位号无备件时为 0');
ok(r.j.warnings.some((w) => w.includes('未查到适用设备')), 'H4 warning 明确');

// ============ I. 参数校验 ============
function raw(args) {
  const x = spawnSync(process.execPath, [INV, ...args], { encoding: 'utf8' });
  const l = x.stdout.trim().split('\n');
  try { return { code: x.status, s: JSON.parse(l[l.length - 1]) }; } catch (e) { return { code: x.status, s: { ok: false } }; }
}
eq(raw([]).s.ok, false, 'I1 无参数报错');
eq(raw(['--input']).s.ok, false, 'I2 --input 缺值报错');
ok(/缺少取值/.test(raw(['--input']).s.error), 'I3 缺值信息正确');
eq(raw(['--input', STOCK]).s.ok, false, 'I4 缺 query 与 tag 报错');
eq(raw(['--input', '/不存在.xlsx', '--query', 'x']).s.ok, false, 'I5 输入不存在报错');
eq(raw(['--input', STOCK, '--query', 'A-01', '--limit', 'abc']).s.ok, false, 'I6 非法 limit 报错');
eq(raw(['--input', STOCK, '--query', 'A-01', '--未知', 'x']).s.ok, false, 'I7 未知参数报错');
eq(raw(['--input', mk('nosheet.xlsx', { '别的': [['a'], [1]] }), '--query', 'x']).s.ok, false, 'I8 无库存表报错');
eq(raw(['--input', STOCK, '--query', 'A-01', '--intransit', '/不存在.xlsx']).s.ok, false, 'I9 在途表不存在报错');
eq(raw(['--input', STOCK, '--query', 'A-01', '--alternatives', '--catalog', '/不存在.xlsx']).s.ok, false, 'I10 目录不存在报错');

// ============ J. 别名列头与合计行 ============
const ALIAS = mk('alias.xlsx', {
  '库存表': [['某厂备件库存导出'], [],
    ['物料编码', '物料名称', '型号', '计量单位', '现有库存', '最低库存', '货位'],
    ['Y-01', '机械密封', '104-45', '套', 5, 2, 'A-1'],
    ['合计', '', '', '', 5, '', '']],
});
r = run(['--input', ALIAS, '--query', 'Y-01'], 'alias');
eq(r.s.ok, true, 'J1 别名列头可读');
eq(r.s.counts.stockTotal, 1, 'J2 合计行被跳过');
ok(r.j.warnings.some((w) => w.includes('合计行')), 'J3 合计行 warning');
eq(r.j.matches[0].qty, 5, 'J4 别名列值读取正确');

// ============ K. 产出完整性 ============
r = run(['--input', STOCK, '--query', '机械', '--fuzzy'], 'outputs');
ok(fs.existsSync(path.join(r.out, 'inventory.json')), 'K1 inventory.json 生成');
ok(fs.existsSync(path.join(r.out, 'inventory.md')), 'K2 inventory.md 生成');
ok(fs.existsSync(path.join(r.out, 'summary.json')), 'K3 summary.json 生成');
ok(fs.existsSync(path.join(r.out, 'inventory.xlsx')), 'K4 多条结果导出 xlsx');
const xb = readXlsx(path.join(r.out, 'inventory.xlsx'));
ok(xb['查询结果'] && xb['查询结果'].length === 3, 'K5 xlsx 含表头+2行');
ok(/## 一、查询结果/.test(r.md) && /## 二、低于安全库存/.test(r.md) && /## 三、在途情况/.test(r.md)
  && /## 四、同规格候选/.test(r.md) && /## 五、同名多编码待确认/.test(r.md), 'K6 五节结构齐全');

// ============ L. 中石化口径：SAP MM 列名、「数量」收窄、按位号查（--mapping）、无库存候选置顶、互指 ============
const SAP = mk('sap.xlsx', {
  '库存': [['MB52 导出'],
    ['物料', '物料描述', '基本计量单位', '库存地点', '非限制使用库存', '数量', '再订货点'],
    ['30012345', '机械密封 104-45 碳化硅', 'ST', 'BJ01', 5, 99, 2],
    ['30020047', '角接触球轴承 7310 AC', 'ST', 'BJ02', 0, 99, 2],
    ['30020045', '深沟球轴承 6310 C3', 'ST', 'BJ02', 8, 99, 4],
    ['30020046', '深沟球轴承 6312 C3', 'ST', 'BJ02', 0, 99, 4],
    ['30020048', '深沟球轴承 6314 C3', 'ST', 'BJ02', 0, 99, 4],
    ['合计', '', '', '', 13, '', '']],
});
r = run(['--input', SAP, '--query', '30012345'], 'sap');
eq(r.s.ok, true, 'L1 SAP MB52 列名可读（工作表名「库存」）');
eq(r.j.matches[0].qty, 5, 'L2 「非限制使用库存」命中库存量');
ok(r.j.matches[0].qty !== 99, 'L3 「数量」列未被当作库存量（收窄）');
eq(r.j.matches[0].unit, 'ST', 'L4 「基本计量单位」命中单位');
eq(r.j.matches[0].loc, 'BJ01', 'L5 「库存地点」命中库位');
eq(r.j.matches[0].safety, 2, 'L6 「再订货点」命中安全库存');
ok(/机械密封/.test(r.j.matches[0].name), 'L7 「物料描述」命中名称');
eq(r.s.counts.stockTotal, 5, 'L8 合计行跳过');
// 在途表的「数量」仍按到货数量读
const TR2 = mk('transit2.xlsx', { '在途采购': [['物料', '数量', '交货日期'], ['30020047', 4, '2026-11-08']] });
r = run(['--input', SAP, '--query', '30020047', '--intransit', TR2], 'sap-transit');
eq(r.j.inTransit[0].arrivals[0].qty, 4, 'L9 在途表「数量」按到货数量读（收窄只针对库存量）');
eq(r.j.inTransit[0].arrivals[0].eta, '2026-11-08', 'L10 「交货日期」命中预计到货');
// 无位号列 + 无 mapping → 未查到并提示提供对应表
r = run(['--input', SAP, '--tag', 'P-1101A'], 'sap-tag-nomap');
eq(r.s.counts.matched, 0, 'L11 SAP 导出无位号列时按位号查为 0');
ok(r.j.warnings.some((w) => /无「位号」列/.test(w) && /--mapping/.test(w)), 'L12 提示提供备件设备对应表');
// --mapping 按位号查
const MAP = mk('map.xlsx', { '备件设备对应': [['功能位置', '物料'], ['P-1101A', '30012345'], ['P-1101A', '30020045'], ['P-1101A', '30099999']] });
r = run(['--input', SAP, '--tag', 'P-1101A', '--mapping', MAP], 'sap-tag-map');
eq(r.s.counts.matched, 2, 'L13 通过对应表按位号命中 2 条');
eq(r.s.tagSource, '备件设备对应表', 'L14 标明匹配依据为对应表');
ok(r.j.warnings.some((w) => /1 个备件编码不在库存表中/.test(w) && /不按 0 处理/.test(w)), 'L15 对应表中无库存记录的物料提示且不按 0');
ok(/匹配依据：备件设备对应表/.test(r.md), 'L16 md 写明匹配依据');
// 位号列 + 对应表合并去重
const BOTH = mk('both.xlsx', { '库存表': [['备件编码', '备件名称', '库存量', '位号'], ['A-1', '机械密封', 2, 'P-9'], ['A-2', '轴承', 3, '']] });
const MAP2 = mk('map2.xlsx', { '备件设备对应': [['位号', '备件编码'], ['P-9', 'A-1'], ['P-9', 'A-2']] });
r = run(['--input', BOTH, '--tag', 'P-9', '--mapping', MAP2], 'both');
eq(r.s.counts.matched, 2, 'L17 位号列与对应表合并命中且去重');
eq(r.s.tagSource, '库存表位号列 + 备件设备对应表', 'L18 匹配依据写明两者');
eq(raw(['--input', BOTH, '--tag', 'P-9', '--mapping', '/不存在.xlsx']).s.ok, false, 'L19 对应表不存在报错');
// 「设备编号」不作位号别名
const EQNO = mk('eqno.xlsx', { '库存表': [['备件编码', '备件名称', '库存量', '设备编号'], ['A-1', '机械密封', 2, '10001234']] });
r = run(['--input', EQNO, '--tag', '10001234'], 'eqno');
eq(r.s.counts.matched, 0, 'L20 「设备编号」列不作位号别名（SAP 设备编号是流水号）');
// 无库存候选置顶
r = run(['--input', SAP, '--query', '30020046', '--alternatives'], 'nostock-alt');
eq(r.j.alternatives[0].queriedNoStock, true, 'L21 所查件无库存标记');
ok(r.j.alternatives[0].candidates.length >= 2, 'L22 有同类候选');
ok(r.j.alternatives[0].candidates[0].qty > 0, 'L23 无库存时有库存候选置顶');
ok(r.j.alternatives[0].candidates[r.j.alternatives[0].candidates.length - 1].qty === 0, 'L24 零库存候选排后');
ok(/所查件当前无库存.*有库存的同类候选置顶/.test(r.md), 'L25 md 说明置顶');
ok(!/可以代用|建议代用/.test(r.md), 'L26 置顶后仍无代用结论');
ok(r.j.alternatives[0].candidates[0].diffs.some((d) => d.field === '名称/物料描述'), 'L26b SAP 无规格列时名称/物料描述纳入差异比对');
r = run(['--input', SAP, '--query', '30012345', '--alternatives'], 'stock-alt');
eq(r.j.alternatives[0].queriedNoStock, false, 'L27 有库存时不置顶（按相似度）');
// 互指与术语
ok(/equipment-ledger-query/.test(r.md) && /spare-parts-demand/.test(r.md), 'L28 md 末尾互指台账查询与需求提报');
ok(!/[\u2600-\u27BF\u{1F300}-\u{1FAFF}]/u.test(r.md), 'L29 md 不含 emoji');
ok(fs.existsSync(path.join(__dirname, '..', 'assets', 'templates', 'inventory-answer-template.md')), 'L30 assets/templates 不再是空目录');
eq(raw(['--input', SAP, '--query', 'x', '--mapping']).s.ok, false, 'L31 --mapping 缺值报错');

// ============ M. 位号按分隔符逐个比对、目录与库存表同编码合并（MCP 导出：适用位号「P-2101A/P-2101B」，备件目录含库存表全部物料） ============
const MULTI = mk('multi.xlsx', {
  '库存表': [['物料编码', '物料描述', '规格型号', '非限制使用库存', '再订货点', '适用位号', '材质'],
    ['M-1', '机械密封 P-101', '104-45', 2, 1, 'P-101A/P-101B', 'SiC'],
    ['M-2', '机械密封 P-1011', '104-50', 3, 1, 'P-1011A/P-1011B', 'SiC'],
    ['M-3', '深沟球轴承 6314', '6314 C3', 1, 2, 'P-101A/P-205A', ''],
    ['M-4', '深沟球轴承 6312', '6312 C3', 4, 1, 'P-301A', '']],
});
r = run(['--input', MULTI, '--tag', 'P-101A'], 'tag-token');
ok(r.j.matches.map((m) => m.code).join(',') === 'M-1,M-3', 'M1 位号按分隔符逐个比对：P-101A 不误中 P-1011A（实际 ' + r.j.matches.map((m) => m.code).join(',') + '）');
r = run(['--input', MULTI, '--tag', 'P-101'], 'tag-family');
ok(r.j.matches.map((m) => m.code).join(',') === 'M-1,M-3', 'M2 查 P-101 命中 P-101A/P-101B，不误中 P-1011A（实际 ' + r.j.matches.map((m) => m.code).join(',') + '）');
const MCAT = mk('mcat.xlsx', { '备件目录': [['物料编码', '物料描述', '规格型号', '材质'],
  ['M-3', '深沟球轴承 6314', '6314 C3', ''], ['M-4', '深沟球轴承 6312', '6312 C3', 'GCr15'], ['M-9', '深沟球轴承 6314', '6314 C3 NSK', '']] });
r = run(['--input', MULTI, '--query', 'M-3', '--catalog', MCAT, '--alternatives'], 'cat-merge');
const mc = r.j.alternatives[0].candidates;
eq(mc.filter((c) => c.code === 'M-4').length, 1, 'M3 目录与库存表同编码的候选只列一次');
eq((mc.find((c) => c.code === 'M-4') || {}).qty, 4, 'M4 同编码候选带库存表库存量，不显示为「—」');
eq((mc.find((c) => c.code === 'M-4') || {}).from, '库存表 + 备件目录', 'M5 同编码候选来源写明两者');
ok((mc.find((c) => c.code === 'M-4') || { diffs: [] }).diffs.some((d) => d.field === '材质' && d.candidate === 'GCr15'), 'M6 库存表缺的参数由目录补齐参与差异比对');
eq((mc.find((c) => c.code === 'M-9') || {}).qty, null, 'M7 只在目录里的候选库存量仍为空（不按 0）');

// ============ N. 位号常见写法：P-101AB、1#P-101A、P-101A/B（2026-11-04 复核补充） ============
const TAGW = mk('tagw.xlsx', {
  '库存表': [['物料编码', '物料描述', '规格型号', '非限制使用库存', '再订货点', '适用位号'],
    ['N-1', '机械密封', '104-45', 2, 1, 'P-101AB'],
    ['N-2', '轴承', '6314', 2, 1, '1#P-101A'],
    ['N-3', '垫片', 'DN100', 2, 1, 'P-101A/B'],
    ['N-4', '叶轮', 'φ250', 2, 1, 'P-1011A'],
    ['N-5', '轴套', 'φ60', 2, 1, 'P-101C'],
    ['N-6', '联轴器', 'LM6', 2, 1, 'P-101A、C'],
    ['N-7', '轴承箱', 'BX', 2, 1, 'P-101泵'],
    ['N-8', '密封环', 'φ200', 2, 1, 'P-101-1'],
    ['N-9', '轴承', '6312', 2, 1, 'SP-101A']],
});
const codesOf = (args, tag) => { const x = run(args, tag); return (x.j && x.j.matches || []).map((m) => m.code).sort().join(','); };
let cs = codesOf(['--input', TAGW, '--tag', 'P-101'], 'tagw-1');
eq(cs, 'N-1,N-2,N-3,N-5,N-6,N-7', 'N1 查 P-101 命中 P-101AB、1#P-101A、P-101A/B、P-101C、P-101泵，不误中 P-1011A / P-101-1 / SP-101A');
cs = codesOf(['--input', TAGW, '--tag', 'P-101A'], 'tagw-2');
eq(cs, 'N-1,N-2,N-3,N-6', 'N2 查 P-101A 命中 P-101AB、1#P-101A、P-101A/B、P-101A、C，不误中 P-1011A / P-101C');
cs = codesOf(['--input', TAGW, '--tag', 'P-101B'], 'tagw-3');
eq(cs, 'N-1,N-3', 'N3 查 P-101B 命中 P-101AB、P-101A/B 的同组字母');
cs = codesOf(['--input', TAGW, '--tag', 'P-101C'], 'tagw-4');
eq(cs, 'N-5,N-6', 'N4 查 P-101C 命中 P-101C 与 P-101A、C，不误中 P-101AB / P-101A/B');
cs = codesOf(['--input', TAGW, '--tag', 'P-1011'], 'tagw-5');
ok(cs.split(',').includes('N-4') && !/N-[1235679]/.test(cs), `N5 查 P-1011 命中 P-1011A，不误中 P-101 组（实际 ${cs}）`);
const MAPW = mk('mapw.xlsx', { '备件设备对应': [['位号', '备件编码'], ['1#P-101A', 'A-01'], ['P-101AB', 'B-01'], ['P-1011A', 'B-02']] });
cs = codesOf(['--input', STOCK, '--tag', 'P-101A', '--mapping', MAPW], 'tagw-map');
eq(cs, 'A-01,B-01', 'N6 对应表位号同样认 1#P-101A、P-101AB，不误中 P-1011A');

// ============ O. 同组字母后紧跟「-数字」是另一个位号（第三轮 R8）；在途带采购订单号（v1-12） ============
const TAGX = mk('tagx.xlsx', {
  '库存表': [['物料编码', '物料描述', '规格型号', '非限制使用库存', '再订货点', '适用位号'],
    ['O-1', '机械密封', '104-45', 2, 1, 'P-2101A、C-101'],
    ['O-2', '轴承', '6314', 2, 1, 'P-2101A, B-202'],
    ['O-3', '垫片', 'DN100', 2, 1, 'P-2101A、B、C-101'],
    ['O-4', '叶轮', 'φ250', 2, 1, 'P-2101A/B 2台'],
    ['O-5', '轴套', 'φ60', 2, 1, 'P-2101A/B-1']],
});
cs = codesOf(['--input', TAGX, '--tag', 'P-2101C'], 'tagx-c');
eq(cs, '', 'O1 「P-2101A、C-101」「P-2101A、B、C-101」查 P-2101C 不命中（C-101 是另一个位号）');
cs = codesOf(['--input', TAGX, '--tag', 'P-2101B'], 'tagx-b');
eq(cs, 'O-3,O-4', 'O2 「P-2101A, B-202」查 P-2101B 不命中；「P-2101A、B、C-101」「P-2101A/B 2台」仍命中 B');
cs = codesOf(['--input', TAGX, '--tag', 'P-2101A'], 'tagx-a');
eq(cs, 'O-1,O-2,O-3,O-4,O-5', 'O3 查 P-2101A 各写法照常命中');
const TRPO = mk('transit-po.xlsx', {
  '在途采购': [['物料编码', '物料描述', '在途数量', '基本计量单位', '预计到货', '采购订单'],
    ['A-02', '机械密封', 3, '套', '2026-09-30', '4500012345'],
    ['A-02', '机械密封', 2, '套', '2026-10-20', '']],
});
r = run(['--input', STOCK, '--query', 'A-02', '--intransit', TRPO], 'transit-po');
eq(((r.j && r.j.inTransit[0]) || { arrivals: [] }).arrivals[0].po, '4500012345', 'O4 在途 arrivals 带采购订单号');
eq(((r.j && r.j.inTransit[0]) || { arrivals: [{}, {}] }).arrivals[1].po, null, 'O5 采购订单为空时为 null');
ok(/采购订单/.test(r.md || '') && /4500012345/.test(r.md || ''), 'O6 md 在途表列出采购订单号');
r = run(['--input', STOCK, '--query', 'A-02', '--intransit', TRANSIT], 'transit-nopo');
ok(!/采购订单/.test(((r.md || '').split('## 三、在途情况')[1] || '').split('## 四')[0]), 'O7 在途表无采购订单列时 md 不出该列');

console.log(`\n${'='.repeat(56)}`);
console.log(`spare-parts-inventory-query 自测：${pass} 通过，${fail} 失败`);
if (failures.length) { console.log('\n失败项：'); failures.forEach((f) => console.log('  ✗ ' + f)); }
console.log('='.repeat(56));
try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
