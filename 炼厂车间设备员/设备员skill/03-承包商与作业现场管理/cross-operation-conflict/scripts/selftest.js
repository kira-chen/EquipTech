#!/usr/bin/env node
'use strict';
/**
 * 自测：规则引擎单元测试 + 生成变体输入并断言 conflict.js 行为。用法：node scripts/selftest.js（全绿退出 0）
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { writeXlsx } = require('./lib/xlsx-lite');
const R = require('./lib/rules');

const CONFLICT = path.join(__dirname, 'conflict.js');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-selftest-'));
const DATE = '2026-09-21';
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

const HEAD = ['作业编号', '作业类型', '位号', '区域', '标高', '开始时间', '结束时间', '作业单位', '监护人', '涉及介质', '使用设备', '所属系统', '电源回路', '消防覆盖区'];
function mk(name, rows, sheet = '作业清单') { const p = path.join(work, name); writeXlsx(p, { [sheet]: rows }); return p; }
function run(file, extra = [], tag) {
  const out = path.join(work, (tag || path.basename(file, '.xlsx')) + '-out');
  const r = spawnSync(process.execPath, [CONFLICT, '--input', file, '--workshop', '测试车间', '--date', DATE, '--out', out, ...extra], { encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  let summary;
  try { summary = JSON.parse(lines[lines.length - 1]); } catch (e) { summary = { ok: false, error: 'no-json:' + r.stdout + r.stderr }; }
  let json = null, md = null;
  if (fs.existsSync(path.join(out, 'conflicts.json'))) json = JSON.parse(fs.readFileSync(path.join(out, 'conflicts.json'), 'utf8'));
  if (fs.existsSync(path.join(out, 'conflicts.md'))) md = fs.readFileSync(path.join(out, 'conflicts.md'), 'utf8');
  return { code: r.status, summary, json, md, out };
}
const hasRule = (arr, id) => arr.some((x) => x.ruleId === id);

let r;
let f;

// ================================================================ A. 规则引擎单元测试
// A1 作业类型识别
section('A', () => {
  ok(R.classifyTypes('动火作业').includes('hotwork'), 'A1.1 动火识别（别名）');
  ok(R.classifyTypes('用火作业').includes('hotwork'), 'A1.1b 用火识别');
  eq(R.TYPE_CN.hotwork, '用火作业', 'A1.1c hotwork 中文名为「用火作业」');
  ok(R.classifyTypes('进罐清理').includes('confined'), 'A1.2 受限空间识别');
  ok(R.classifyTypes('脚手架搭设').includes('height'), 'A1.3 高处作业识别');
  ok(R.classifyTypes('汽车吊吊装就位').includes('lifting'), 'A1.4 吊装识别');
  ok(R.classifyTypes('盲板抽堵').includes('blind'), 'A1.5 盲板识别');
  ok(R.classifyTypes('开挖电缆沟').includes('excavation'), 'A1.6 动土识别');
  ok(R.classifyTypes('临时用电接引').includes('power'), 'A1.7 临时用电识别');
  ok(R.classifyTypes('氮气置换后排放').includes('purge'), 'A1.8 吹扫置换识别');
  ok(R.classifyTypes('高压水清洗').includes('cleaning'), 'A1.9 清洗识别');
  eq(R.classifyTypes('搬运物料')[0], 'other', 'A1.10 不命中时归为 other');
  ok(R.classifyTypes('进罐动火焊补').includes('hotwork') && R.classifyTypes('进罐动火焊补').includes('confined'), 'A1.11 一项作业可命中多类型');
});

// A2 介质可燃性：空与不在库一律 null，绝不按不可燃
section('A', () => {
  eq(R.mediumFlammable('石脑油'), 'flammable', 'A2.1 石脑油判可燃');
  eq(R.mediumFlammable('氮气'), 'inert', 'A2.2 氮气判惰性');
  eq(R.mediumFlammable(''), null, 'A2.3 介质为空返回 null（不按不可燃）');
  eq(R.mediumFlammable('某不明物料'), null, 'A2.4 介质不在库返回 null（不按不可燃）');
  eq(R.mediumFlammable('渣油'), 'flammable', 'A2.5 渣油判可燃（介质库补齐）');
  eq(R.mediumFlammable('液氨'), 'flammable', 'A2.6 液氨判可燃');
  eq(R.mediumFlammable('瓦斯水'), 'flammable', 'A2.7 瓦斯水不按惰性');
  eq(R.mediumFlammable('含油污水'), 'flammable', 'A2.8 含油污水不按惰性');
  eq(R.mediumFlammable('凝结水'), 'inert', 'A2.9 凝结水判惰性');
  eq(R.mediumFlammable('二氧化碳'), 'inert', 'A2.10 二氧化碳判惰性');
});

// A3 时段重叠：默认严格重叠；--window 生效；缺时间 → null
section('A', () => {
  let ov = R.timeOverlap({ start: `${DATE} 08:00`, end: `${DATE} 10:00` }, { start: `${DATE} 09:00`, end: `${DATE} 11:00` }, 0);
  eq(ov.overlap, true, 'A3.1 重叠判 true');
  eq(ov.minutes, 60, 'A3.2 重叠分钟数正确');
  ov = R.timeOverlap({ start: `${DATE} 08:00`, end: `${DATE} 10:00` }, { start: `${DATE} 10:00`, end: `${DATE} 12:00` }, 0);
  eq(ov.overlap, false, 'A3.3 首尾相接默认不算重叠（--window 0）');
  ov = R.timeOverlap({ start: `${DATE} 08:00`, end: `${DATE} 10:00` }, { start: `${DATE} 10:00`, end: `${DATE} 12:00` }, 30);
  eq(ov.overlap, true, 'A3.4 --window 30 时首尾相接算重叠');
  ov = R.timeOverlap({ start: `${DATE} 08:00`, end: `${DATE} 10:00` }, { start: `${DATE} 10:20`, end: `${DATE} 12:00` }, 30);
  eq(ov.overlap, true, 'A3.5 --window 30 时间隔 20 分钟算重叠');
  ov = R.timeOverlap({ start: `${DATE} 08:00`, end: `${DATE} 10:00` }, { start: `${DATE} 10:40`, end: `${DATE} 12:00` }, 30);
  eq(ov.overlap, false, 'A3.6 --window 30 时间隔 40 分钟不算重叠');
  ov = R.timeOverlap({ start: null, end: `${DATE} 10:00` }, { start: `${DATE} 09:00`, end: `${DATE} 11:00` }, 0);
  eq(ov.overlap, null, 'A3.7 时间缺失时 overlap 为 null（不按不重叠）');
});

// A4 空间关系：区域为空一律未判定
section('A', () => {
  let rel = R.spatialRelation({ id: 'A', area: '', elev: 0 }, { id: 'B', area: '一区', elev: 0 });
  eq(rel.relation, null, 'A4.1 区域为空 → relation 为 null');
  eq(rel.undetermined, true, 'A4.2 区域为空 → undetermined');
  ok(!/different/.test(String(rel.relation)), 'A4.3 区域为空绝不按 different 处理');
  rel = R.spatialRelation({ id: 'A', area: '一区', elev: null }, { id: 'B', area: '一区', elev: 0 });
  eq(rel.undetermined, true, 'A4.4 同区域但标高为空 → undetermined');
  rel = R.spatialRelation({ id: 'A', area: '一区', elev: 0 }, { id: 'B', area: '二区', elev: 0 });
  eq(rel.relation, 'different', 'A4.5 区域均有值且不同 → different');
  rel = R.spatialRelation({ id: 'A', area: '一区', elev: 0 }, { id: 'B', area: '一区', elev: 18.5 });
  eq(rel.relation, 'vertical', 'A4.6 标高差 ≥2 米 → vertical');
  rel = R.spatialRelation({ id: 'A', area: '一区', elev: 0 }, { id: 'B', area: '一区', elev: 1 });
  eq(rel.relation, 'same', 'A4.7 标高差 <2 米 → same');
});

// A5 严重度取高
section('C', () => {
  eq(R.maxSeverity(['低', '高', '中']), '高', 'A5.1 严重度取高者');
});

// ================================================================ B. 主脚本：风险冲突矩阵逐条
// B1 R1 动火 × 可燃介质吹扫 → 高
f = mk('r1.xlsx', [HEAD,
  ['W1', '动火作业', 'E-1', '一区', '0', `${DATE} 09:00`, `${DATE} 12:00`, '甲队', '张', '', '', '', '', ''],
  ['W2', '吹扫置换', 'V-1', '一区', '0', `${DATE} 10:00`, `${DATE} 11:00`, '乙队', '李', '石脑油', '', '', '', ''],
]);
section('BVT', () => {
  r = run(f, [], 'r1');
  eq(r.summary.ok, true, 'B1.1 运行成功');
  ok(hasRule(r.json.riskConflicts, 'R1'), 'B1.2 命中 R1');
  eq(r.json.riskConflicts.find((x) => x.ruleId === 'R1').severity, '高', 'B1.3 R1 严重度为高');
});

// B1b 同条件但介质为空 → undetermined，绝不判为无冲突
f = mk('r1u.xlsx', [HEAD,
  ['W1', '动火作业', 'E-1', '一区', '0', `${DATE} 09:00`, `${DATE} 12:00`, '甲队', '张', '', '', '', '', ''],
  ['W2', '吹扫置换', 'V-1', '一区', '0', `${DATE} 10:00`, `${DATE} 11:00`, '乙队', '李', '', '', '', '', ''],
]);
section('A', () => {
  r = run(f, [], 'r1u');
  ok(!hasRule(r.json.riskConflicts, 'R1'), 'B1.4 介质为空时不计入已确认风险冲突');
  ok(r.json.undetermined.some((u) => u.ruleId === 'R1' && u.kind === 'risk'), 'B1.5 介质为空时 R1 标为未判定');
  ok(r.json.undetermined.some((u) => (u.missing || []).some((m) => m.includes('介质'))), 'B1.6 未判定项注明缺失介质字段');
  ok(/不得因缺数据判定为无冲突/.test(r.md), 'B1.7 报告写明不得因缺数据判无冲突');
  ok(r.json.warnings.some((w) => w.includes('介质') && w.includes('未判定')), 'B1.8 介质缺失 warning');
});

// B1c 介质为惰性 → 不命中 R1（有数据时正常放行）
f = mk('r1n.xlsx', [HEAD,
  ['W1', '动火作业', 'E-1', '一区', '0', `${DATE} 09:00`, `${DATE} 12:00`, '甲队', '张', '', '', '', '', ''],
  ['W2', '吹扫置换', 'V-1', '一区', '0', `${DATE} 10:00`, `${DATE} 11:00`, '乙队', '李', '氮气', '', '', '', ''],
]);
section('A', () => {
  r = run(f, [], 'r1n');
  ok(!hasRule(r.json.riskConflicts, 'R1'), 'B1.9 惰性介质不命中 R1');
  ok(!r.json.undetermined.some((u) => u.ruleId === 'R1'), 'B1.10 惰性介质不标未判定');
});

// B2 R2 用火 × 受限空间（同位号）→ 双票作业提示项，不计冲突；同区域同层不同位号 → 高
f = mk('r2.xlsx', [HEAD,
  ['W1', '受限空间作业', 'V-9', '三区', '0', `${DATE} 13:00`, `${DATE} 17:00`, '甲队', '张', '', '', '', '', ''],
  ['W2', '动火作业', 'V-9', '三区', '0', `${DATE} 14:00`, `${DATE} 16:00`, '甲队', '李', '', '', '', '', ''],
]);
section('A', () => {
  r = run(f, [], 'r2');
  ok(!hasRule(r.json.riskConflicts, 'R2'), 'B2.1 同位号受限空间 + 用火不计为风险冲突');
  eq(r.json.advisories.length, 1, 'B2.2 同位号双票作业列为提示项');
  eq(r.json.advisories[0].ruleId, 'R2', 'B2.3 提示项规则号 R2');
  eq(r.json.advisories[0].severity, '提示', 'B2.4 提示项严重度为「提示」');
  eq(r.json.counts.high, 0, 'B2.5 提示项不计入高严重度');
  eq(r.json.counts.advisory, 1, 'B2.6 counts.advisory 计数');
  ok(/合法常态/.test(r.json.advisories[0].note) && /双监护/.test(r.json.advisories[0].note), 'B2.7 提示项写明合法常态与双监护核对');
  ok(/不构成冲突/.test(r.json.advisories[0].advice), 'B2.8 提示项建议不要求错时');
  ok(/提示项（同位号受限空间 \+ 用火双票作业，合法常态，不计冲突）/.test(r.md), 'B2.9 md 提示项小节');
  ok(!/人员撤出再动火|人员全部撤出并办理相应许可后再动火/.test(r.md), 'B2.10 md 不再出现「人员撤出再动火」');
});
f = mk('r2adj.xlsx', [HEAD,
  ['W1', '受限空间作业', 'V-9', '三区', '0', `${DATE} 13:00`, `${DATE} 17:00`, '甲队', '张', '', '', '', '', ''],
  ['W2', '用火作业', 'E-9', '三区', '0', `${DATE} 14:00`, `${DATE} 16:00`, '甲队', '李', '', '', '', '', ''],
]);
section('A', () => {
  r = run(f, [], 'r2adj');
  ok(hasRule(r.json.riskConflicts, 'R2'), 'B2.11 同区域同层不同位号仍命中 R2');
  eq(r.json.riskConflicts.find((x) => x.ruleId === 'R2').severity, '高', 'B2.12 邻近 R2 严重度为高');
  eq(r.json.advisories.length, 0, 'B2.13 不同位号无提示项');
});

// B3 R3 动火 × 高处（下方动火）→ 中
f = mk('r3.xlsx', [HEAD,
  ['W1', '动火作业', 'C-1', '二区', '0', `${DATE} 09:00`, `${DATE} 12:00`, '甲队', '张', '', '', '', '', ''],
  ['W2', '高处作业', 'C-1', '二区', '12', `${DATE} 09:30`, `${DATE} 11:00`, '乙队', '李', '', '脚手架', '', '', ''],
]);
section('A', () => {
  r = run(f, [], 'r3');
  ok(hasRule(r.json.riskConflicts, 'R3'), 'B3.1 命中 R3（下方动火，上方高处）');
  eq(r.json.riskConflicts.find((x) => x.ruleId === 'R3').severity, '中', 'B3.2 R3 严重度为中');
});
// 动火在上方时不命中 R3
f = mk('r3n.xlsx', [HEAD,
  ['W1', '动火作业', 'C-1', '二区', '15', `${DATE} 09:00`, `${DATE} 12:00`, '甲队', '张', '', '', '', '', ''],
  ['W2', '高处作业', 'C-1', '二区', '5', `${DATE} 09:30`, `${DATE} 11:00`, '乙队', '李', '', '脚手架', '', '', ''],
]);
section('A', () => {
  r = run(f, [], 'r3n');
  ok(!hasRule(r.json.riskConflicts, 'R3'), 'B3.3 用火在上方时不命中 R3');
});

// B4 R4 吊装 × 任何下方作业 → 高
f = mk('r4.xlsx', [HEAD,
  ['W1', '吊装作业', 'C-2', '二区', '18', `${DATE} 08:00`, `${DATE} 11:00`, '甲队', '张', '', '25吨吊车', '', '', ''],
  ['W2', '检修作业', 'P-2', '二区', '0', `${DATE} 08:30`, `${DATE} 12:00`, '乙队', '李', '', '', '', '', ''],
]);
section('A', () => {
  r = run(f, [], 'r4');
  ok(hasRule(r.json.riskConflicts, 'R4'), 'B4.1 命中 R4');
  eq(r.json.riskConflicts.find((x) => x.ruleId === 'R4').severity, '高', 'B4.2 R4 严重度为高');
  ok(hasRule(r.json.spatialConflicts, 'S2'), 'B4.3 同时命中 S2 上下层落物');
});

// B5 R5 受限空间 × 邻近动火（上下层，不同位号）→ 高
f = mk('r5.xlsx', [HEAD,
  ['W1', '受限空间作业', 'V-5', '四区', '0', `${DATE} 13:00`, `${DATE} 17:00`, '甲队', '张', '', '', '', '', ''],
  ['W2', '动火作业', 'E-5', '四区', '8', `${DATE} 14:00`, `${DATE} 16:00`, '乙队', '李', '', '', '', '', ''],
]);
section('A', () => {
  r = run(f, [], 'r5');
  ok(hasRule(r.json.riskConflicts, 'R5'), 'B5.1 命中 R5（邻近动火）');
  eq(r.json.riskConflicts.find((x) => x.ruleId === 'R5').severity, '高', 'B5.2 R5 严重度为高');
});

// B6 R6 临时用电 × 带水清洗 → 中
f = mk('r6.xlsx', [HEAD,
  ['W1', '临时用电', 'M-6', '五区', '0', `${DATE} 09:00`, `${DATE} 15:00`, '甲队', '张', '', '配电箱', '', 'AP-9', ''],
  ['W2', '高压水清洗', 'E-6', '五区', '0', `${DATE} 10:00`, `${DATE} 12:00`, '乙队', '李', '水', '', '', '', ''],
]);
section('A', () => {
  r = run(f, [], 'r6');
  ok(hasRule(r.json.riskConflicts, 'R6'), 'B6.1 命中 R6');
  eq(r.json.riskConflicts.find((x) => x.ruleId === 'R6').severity, '中', 'B6.2 R6 严重度为中');
});

// B7 R7 盲板抽堵 × 同系统其他作业 → 高；系统为空 → 未判定
f = mk('r7.xlsx', [HEAD,
  ['W1', '盲板抽堵', 'V-7', '六区', '0', `${DATE} 09:00`, `${DATE} 12:00`, '甲队', '张', '', '', '常压系统', '', ''],
  ['W2', '检修作业', 'P-7', '六区', '0', `${DATE} 10:00`, `${DATE} 11:00`, '乙队', '李', '', '', '常压系统', '', ''],
]);
section('A', () => {
  r = run(f, [], 'r7');
  ok(hasRule(r.json.riskConflicts, 'R7'), 'B7.1 命中 R7（同系统）');
  eq(r.json.riskConflicts.find((x) => x.ruleId === 'R7').severity, '高', 'B7.2 R7 严重度为高');
});
f = mk('r7u.xlsx', [HEAD,
  ['W1', '盲板抽堵', 'V-7', '六区', '0', `${DATE} 09:00`, `${DATE} 12:00`, '甲队', '张', '', '', '', '', ''],
  ['W2', '检修作业', 'P-7', '六区', '0', `${DATE} 10:00`, `${DATE} 11:00`, '乙队', '李', '', '', '', '', ''],
]);
section('A', () => {
  r = run(f, [], 'r7u');
  ok(!hasRule(r.json.riskConflicts, 'R7'), 'B7.3 系统为空时不判为已确认冲突');
  ok(r.json.undetermined.some((u) => u.ruleId === 'R7'), 'B7.4 系统为空时 R7 标为未判定');
});
// 不同系统 → 不命中
f = mk('r7n.xlsx', [HEAD,
  ['W1', '盲板抽堵', 'V-7', '六区', '0', `${DATE} 09:00`, `${DATE} 12:00`, '甲队', '张', '', '', 'A系统', '', ''],
  ['W2', '检修作业', 'P-7', '六区', '0', `${DATE} 10:00`, `${DATE} 11:00`, '乙队', '李', '', '', 'B系统', '', ''],
]);
section('A', () => {
  r = run(f, [], 'r7n');
  ok(!hasRule(r.json.riskConflicts, 'R7'), 'B7.5 不同系统不命中 R7');
});

// B8 R8 动土 × 管线作业 → 中
f = mk('r8.xlsx', [HEAD,
  ['W1', '动土作业', 'GD-8', '七区', '0', `${DATE} 08:00`, `${DATE} 16:00`, '甲队', '张', '', '挖掘机', '', '', ''],
  ['W2', '管线拆装', 'PL-8', '七区', '0', `${DATE} 09:00`, `${DATE} 12:00`, '乙队', '李', '', '', '', '', ''],
]);
section('A', () => {
  r = run(f, [], 'r8');
  ok(hasRule(r.json.riskConflicts, 'R8'), 'B8.1 命中 R8');
  eq(r.json.riskConflicts.find((x) => x.ruleId === 'R8').severity, '中', 'B8.2 R8 严重度为中');
});

// ================================================================ C. 硬约束 1：区域/标高为空 → undetermined 单列
f = mk('noarea.xlsx', [HEAD,
  ['W1', '吊装作业', 'K-1', '', '', `${DATE} 08:00`, `${DATE} 12:00`, '甲队', '张', '', '吊车', '', '', ''],
  ['W2', '检修作业', 'P-1', '', '', `${DATE} 09:00`, `${DATE} 11:00`, '乙队', '李', '', '', '', '', ''],
]);
section('A', () => {
  r = run(f, [], 'noarea');
  eq(r.summary.ok, true, 'C1.1 区域全空仍正常运行');
  eq(r.json.counts.spatial, 0, 'C1.2 区域为空时不产出已确认空间冲突');
  ok(r.json.undetermined.some((u) => u.kind === 'space'), 'C1.3 空间关系列入 undetermined');
  ok(/不得按不在同一区域处理/.test(r.md), 'C1.4 报告写明不得按不在同一区域处理');
  ok(r.json.warnings.some((w) => w.includes('区域字段为空')), 'C1.5 区域为空 warning');
  ok(r.json.undetermined.some((u) => u.kind === 'risk' && u.ruleId === 'R4'), 'C1.6 区域为空时吊装风险冲突亦标未判定');
});
// 标高为空
f = mk('noelev.xlsx', [HEAD,
  ['W1', '吊装作业', 'K-1', '一区', '', `${DATE} 08:00`, `${DATE} 12:00`, '甲队', '张', '', '吊车', '', '', ''],
  ['W2', '检修作业', 'P-1', '一区', '0', `${DATE} 09:00`, `${DATE} 11:00`, '乙队', '李', '', '', '', '', ''],
]);
section('A', () => {
  r = run(f, [], 'noelev');
  ok(r.json.undetermined.some((u) => u.kind === 'space' && (u.missing || []).some((m) => m.includes('标高'))), 'C1.7 同区域标高为空列入未判定');
  eq(r.json.counts.spatial, 0, 'C1.8 标高为空时不产出已确认空间冲突');
});

// ================================================================ D. 硬约束 3：时段重叠与 --window
f = mk('adj.xlsx', [HEAD,
  ['W1', '动火作业', 'E-1', '一区', '0', `${DATE} 08:00`, `${DATE} 10:00`, '甲队', '张', '', '', '', '', ''],
  ['W2', '吹扫置换', 'V-1', '一区', '0', `${DATE} 10:00`, `${DATE} 12:00`, '乙队', '李', '石脑油', '', '', '', ''],
]);
section('A', () => {
  r = run(f, [], 'adj0');
  eq(r.json.counts.risk, 0, 'D1.1 默认 --window 0 时首尾相接不判冲突');
  eq(r.summary.windowMinutes, 0, 'D1.2 默认 window 为 0');
});
section('B', () => {
  r = run(f, ['--window', '30'], 'adj30');
  ok(hasRule(r.json.riskConflicts, 'R1'), 'D1.3 --window 30 时首尾相接判为重叠并命中 R1');
  eq(r.summary.windowMinutes, 30, 'D1.4 window 参数写入摘要');
  ok(/--window 30/.test(r.md), 'D1.5 报告头部标明 window 取值');
});
// 时间缺失 → 时段未判定
f = mk('notime.xlsx', [HEAD,
  ['W1', '动火作业', 'E-1', '一区', '0', `${DATE} 08:00`, `${DATE} 10:00`, '甲队', '张', '', '', '', '', ''],
  ['W2', '吹扫置换', 'V-1', '一区', '0', '', '', '乙队', '李', '石脑油', '', '', '', ''],
]);
section('A', () => {
  r = run(f, [], 'notime');
  ok(r.json.undetermined.some((u) => u.kind === 'time'), 'D1.6 起止时间缺失列入时段未判定');
  eq(r.json.counts.risk, 0, 'D1.7 时段未判定时不产出已确认风险冲突');
  ok(r.json.warnings.some((w) => w.includes('开始时间缺失')), 'D1.8 时间缺失 warning');
});

// ================================================================ E. 资源冲突
f = mk('res.xlsx', [HEAD,
  ['W1', '动火作业', 'E-1', '一区', '0', `${DATE} 08:00`, `${DATE} 12:00`, '甲队', '刘国强', '', '25吨吊车', 'S1', 'AP-1', '消防栓F-1'],
  ['W2', '检修作业', 'P-1', '二区', '0', `${DATE} 09:00`, `${DATE} 11:00`, '乙队', '刘国强', '', '25吨吊车', 'S2', 'AP-1', '消防栓F-1'],
  ['W3', '检修作业', 'P-2', '三区', '0', `${DATE} 14:00`, `${DATE} 16:00`, '丙队', '刘国强', '', '', '', '', ''],
]);
section('A', () => {
  r = run(f, [], 'res');
  ok(hasRule(r.json.resourceConflicts, 'Z1'), 'E1.1 同一监护人冲突（Z1）');
  ok(hasRule(r.json.resourceConflicts, 'Z2'), 'E1.2 同一起重设备冲突（Z2）');
  ok(hasRule(r.json.resourceConflicts, 'Z3'), 'E1.3 同一电源回路冲突（Z3）');
  ok(hasRule(r.json.resourceConflicts, 'Z4'), 'E1.4 同一消防覆盖区冲突（Z4）');
  const z1 = r.json.resourceConflicts.find((x) => x.ruleId === 'Z1');
  eq(z1.severity, '高', 'E1.5 Z1 严重度为高');
  ok(!z1.works.some((w) => w.id === 'W3'), 'E1.6 不同时段的 W3 不计入监护人冲突');
});
// 资源相同但时间缺失 → 未判定
f = mk('resu.xlsx', [HEAD,
  ['W1', '动火作业', 'E-1', '一区', '0', `${DATE} 08:00`, `${DATE} 12:00`, '甲队', '刘国强', '', '', '', '', ''],
  ['W2', '检修作业', 'P-1', '二区', '0', '', '', '乙队', '刘国强', '', '', '', '', ''],
]);
section('A', () => {
  r = run(f, [], 'resu');
  ok(r.json.undetermined.some((u) => u.kind === 'resource'), 'E1.7 资源占用时间缺失列入未判定');
  eq(r.json.counts.resource, 0, 'E1.8 无法判定时不产出已确认资源冲突');
});
// Z2 只在起重类设备 / 吊装作业之间判：两张票都写「电焊机」不算同一台起重设备
f = mk('resz2.xlsx', [HEAD,
  ['W1', '动火作业', 'E-1', '一区', '0', `${DATE} 08:00`, `${DATE} 12:00`, '甲队', '张', '', '电焊机', '', '', ''],
  ['W2', '动火作业', 'P-1', '二区', '0', `${DATE} 09:00`, `${DATE} 11:00`, '乙队', '李', '', '电焊机', '', '', ''],
  ['W3', '吊装作业', 'C-1', '三区', '0', `${DATE} 08:00`, `${DATE} 10:00`, '丙队', '王', '', '1号设备', '', '', ''],
  ['W4', '吊装作业', 'C-2', '四区', '0', `${DATE} 09:00`, `${DATE} 11:00`, '丁队', '赵', '', '1号设备', '', '', ''],
]);
section('A', () => {
  r = run(f, [], 'resz2');
  ok(!r.json.resourceConflicts.some((x) => x.ruleId === 'Z2' && x.resource === '电焊机'), 'E1.9 两张票都写「电焊机」（非起重设备、非吊装作业）不判 Z2');
  ok(r.json.warnings.some((w) => w.includes('电焊机') && w.includes('Z2')), 'E1.10 普通机具同名给出不判 Z2 的说明');
  ok(r.json.resourceConflicts.some((x) => x.ruleId === 'Z2' && x.resource === '1号设备'), 'E1.11 两项吊装作业共用同一设备仍判 Z2');
});
// R7：结束时间只写日期且就是检测日，按当日 24:00 处理，不得跳过
f = mk('enddate.xlsx', [HEAD,
  ['W1', '动火作业', 'E-1', '一区', '0', `${DATE} 08:00`, DATE, '甲队', '张', '', '', '', '', ''],
  ['W2', '检修作业', 'P-1', '一区', '0', `${DATE} 09:00`, `${DATE} 11:00`, '乙队', '李', '', '', '', '', ''],
]);
section('B', () => {
  r = run(f, [], 'enddate');
  eq(r.summary.ok, true, 'E2.1 结束时间只写检测日日期时检测正常完成');
  ok(r.json && !(r.json.skipped || []).some((s) => s.id === 'W1'), 'E2.2 结束时间只写检测日日期的作业不被跳过');
  ok(r.json && r.json.spatialConflicts.some((c) => (c.pair || []).includes('W1') && (c.pair || []).includes('W2')), 'E2.3 只写日期的结束时间按当日 24:00 参与重叠判定');
  ok(r.json && r.json.warnings.some((w) => w.includes('W1') && w.includes('24:00')), 'E2.4 只写日期的结束时间给出按 24:00 处理的提示');
});
f = mk('enddate2.xlsx', [HEAD,
  ['W1', '动火作业', 'E-1', '一区', '0', `${DATE} 08:00`, DATE, '甲队', '张', '', '', '', '', ''],
]);
section('B', () => {
  r = run(f, [], 'enddate2');
  eq(r.summary.ok, true, 'E2.5 唯一作业结束时间只写检测日日期时不因全部跳过而失败');
});

// ================================================================ F. timeline 时段重叠视图
f = mk('tl.xlsx', [HEAD,
  ['W1', '动火作业', 'E-1', '一区', '0', `${DATE} 08:00`, `${DATE} 12:00`, '甲队', '张', '', '', '', '', ''],
  ['W2', '检修作业', 'P-1', '一区', '0', `${DATE} 09:00`, `${DATE} 10:00`, '乙队', '李', '', '', '', '', ''],
  ['W3', '检修作业', 'P-2', '二区', '0', `${DATE} 14:00`, `${DATE} 16:00`, '丙队', '王', '', '', '', '', ''],
]);
section('A', () => {
  r = run(f, [], 'tl');
  eq(r.json.timeline.length, 3, 'F1.1 timeline 含全部作业');
  eq(r.json.timeline[0].id, 'W1', 'F1.2 timeline 按开始时间排序');
  ok(r.json.timeline.find((t) => t.id === 'W1').concurrent.includes('W2'), 'F1.3 同时段作业互相列出');
  ok(!r.json.timeline.find((t) => t.id === 'W3').concurrent.length, 'F1.4 不重叠作业无同时段项');
  eq(r.json.counts.maxConcurrent, 2, 'F1.5 最大并行作业数正确');
  ok(r.json.segments.length > 0, 'F1.6 并行时段分段已输出');
  ok(/## 六、时段重叠视图/.test(r.md), 'F1.7 报告含时段重叠视图章节');
});

// ================================================================ G. 声明行与建议措辞
section('A', () => {
  ok(r.md.includes('本检测为辅助排查，交叉作业的最终安排与许可由安全环保部门按厂内制度决定；未列出的冲突不代表不存在'), 'G1.1 声明行原文保留在 md（安全环保部门归口）');
  ok(!/由安全部门按厂内制度决定/.test(r.md), 'G1.1b 不再写「安全部门」');
});
section('C', () => {
  ok(!/[\u2600-\u27BF\u{1F300}-\u{1FAFF}]/u.test(r.md), 'G1.1c md 不含 emoji');
});
section('A', () => {
  ok(!/动火作业/.test(r.md), 'G1.1d md 不出现「动火作业」术语');
  ok(r.json.meta.disclaimer.includes('未列出的冲突不代表不存在'), 'G1.2 声明行写入 conflicts.json');
  const allAdvice = Object.values(R.ADVICE);
  ok(allAdvice.every((x) => /^建议/.test(x)), 'G1.3 全部协调建议均以「建议」开头');
  ok(!allAdvice.some((x) => /已批准|已安排|批准|同意|准予/.test(x)), 'G1.4 协调建议不含已批准类表述');
  ok(!allAdvice.some((x) => /动火/.test(x)), 'G1.5 协调建议不含「动火」');
});

// ================================================================ H. 解析边界：别名/标题行/合计行/跨日/空编号
f = mk('alias.xlsx', [
  ['某厂作业许可计划导出'],
  [],
  ['作业票号', '作业内容', '设备位号', '装置区', '作业标高', '计划开始', '计划结束', '施工单位', '安全监护人', '物料'],
  ['XK-1', '动火作业', 'E-1', '一区', '0', `${DATE} 09:00`, `${DATE} 12:00`, '甲队', '张', ''],
  ['XK-2', '吹扫置换', 'V-1', '一区', '0', `${DATE} 10:00`, `${DATE} 11:00`, '乙队', '李', '石脑油'],
  ['XK-3', '脚手架搭设', 'C-1', '一区', '12', '2026-09-20 08:00', '2026-09-20 17:00', '丙队', '王', ''],
  ['合计', '', '', '', '', '', '', '', '', ''],
]);
section('B', () => {
  r = run(f, [], 'alias');
  eq(r.summary.ok, true, 'H1.1 标题行 + 别名列头可读');
  eq(r.json.counts.works, 2, 'H1.2 合计行跳过、跨日作业跳过');
  ok(r.json.warnings.some((w) => w.includes('合计行')), 'H1.3 合计行 warning');
  ok(r.json.warnings.some((w) => w.includes('不在检测日期')), 'H1.4 跨日 warning');
  eq(r.json.skipped.length, 1, 'H1.5 跨日作业列入 skipped');
  ok(hasRule(r.json.riskConflicts, 'R1'), 'H1.6 别名列头下规则仍正常命中');
});
// 跨越检测日的多日作业票（前一天开、后一天结束，检测日全天有效）：不跳过，照常参与冲突判定
f = mk('span.xlsx', [HEAD,
  ['SP-1', '受限空间作业', 'V-1', '一区', '0', '2026-09-20 09:00', '2026-09-22 17:00', '甲队', '张', '石脑油', '', '', '', ''],
  ['SP-2', '动火作业', 'E-1', '一区', '0', `${DATE} 09:00`, `${DATE} 12:00`, '乙队', '李', '石脑油', '', '', '', ''],
  ['SP-3', '脚手架搭设', 'C-1', '一区', '12', '2026-09-22 08:00', '2026-09-23 17:00', '丙队', '王', '', '', '', '', ''],
]);
section('A', () => {
  r = run(f, [], 'span');
  ok(r.json.works.some((w) => w.id === 'SP-1') && !r.json.skipped.some((s) => s.id === 'SP-1'), 'H1.6a 跨越检测日的多日作业票不跳过（检测日在其有效期内）');
  ok([...r.json.spatialConflicts, ...r.json.riskConflicts].some((c) => (c.pair || []).includes('SP-1') && (c.pair || []).includes('SP-2')), 'H1.6b 跨越检测日的作业票与当天作业照常判冲突');
  ok(r.json.skipped.some((s) => s.id === 'SP-3'), 'H1.6c 检测日之后才开始的作业仍跳过');
});
// 检测日 00:00 结束的票不覆盖检测日；并行时段与重叠分钟截到检测日 [D 00:00, D+1 00:00)（2026-11-04 复核补充）
f = mk('clip.xlsx', [HEAD,
  ['SP-1', '受限空间作业', 'V-1', '一区', '0', '2026-09-15 08:00', '2026-09-25 18:00', '甲队', '张', '石脑油', '', '', '', ''],
  ['SP-2', '动火作业', 'E-1', '一区', '0', '2026-09-18 08:00', `${DATE} 10:00`, '乙队', '李', '石脑油', '', '', '', ''],
  ['SP-3', '动火作业', 'E-2', '一区', '0', '2026-09-20 08:00', `${DATE} 00:00`, '丙队', '王', '石脑油', '', '', '', ''],
  ['SP-4', '动火作业', 'E-3', '一区', '0', '2026-09-22 00:00', '2026-09-22 08:00', '丁队', '赵', '石脑油', '', '', '', ''],
]);
section('B', () => {
  r = run(f, [], 'clip');
  ok(r.json.skipped.some((s) => s.id === 'SP-3') && !r.json.works.some((w) => w.id === 'SP-3'), 'H1.6d 检测日 00:00 结束的作业票不覆盖检测日，跳过');
  ok(r.json.skipped.some((s) => s.id === 'SP-4'), 'H1.6e 检测日次日 00:00 开始的作业票跳过');
  ok(r.json.segments.length > 0 && r.json.segments.every((s) => s.start >= `${DATE} 00:00` && s.end <= '2026-09-22 00:00'), `H1.6f 并行时段只在检测日内（实际 ${r.json.segments.map((s) => s.start + '~' + s.end).join('；')}）`);
  eq(r.json.segments.reduce((n, s) => n + s.minutes, 0), 1440, 'H1.6g 并行时段合计不超过检测日 1440 分钟');
  eq(r.json.counts.maxConcurrent, 2, 'H1.6h 最大并行作业数按检测日内计（SP-1 + SP-2）');
  {
    const c = [...r.json.spatialConflicts, ...r.json.riskConflicts].find((x) => (x.pair || []).join('-') === 'SP-1-SP-2');
    eq(c && c.overlapMinutes, 600, 'H1.6i 重叠分钟截到检测日（00:00~10:00 共 600 分钟，不是 09-18 起算）');
  }
  ok(r.json.works.find((w) => w.id === 'SP-1').start === '2026-09-15 08:00', 'H1.6j 作业清单保留作业票原始起止时间');
});
// 空作业编号
f = mk('noid.xlsx', [HEAD,
  ['', '动火作业', 'E-1', '一区', '0', `${DATE} 09:00`, `${DATE} 12:00`, '甲队', '张', '', '', '', '', ''],
  ['W2', '吹扫置换', 'V-1', '一区', '0', `${DATE} 10:00`, `${DATE} 11:00`, '乙队', '李', '石脑油', '', '', '', ''],
]);
section('C', () => {
  r = run(f, [], 'noid');
  eq(r.json.counts.works, 1, 'H1.7 空作业编号行被跳过');
  ok(r.json.warnings.some((w) => w.includes('作业编号为空')), 'H1.8 空编号 warning');
});
// 标高无法解析 → null 不是 0
f = mk('badelev.xlsx', [HEAD,
  ['W1', '吊装作业', 'K-1', '一区', '很高', `${DATE} 08:00`, `${DATE} 12:00`, '甲队', '张', '', '吊车', '', '', ''],
  ['W2', '检修作业', 'P-1', '一区', '0', `${DATE} 09:00`, `${DATE} 11:00`, '乙队', '李', '', '', '', '', ''],
]);
section('C', () => {
  r = run(f, [], 'badelev');
  eq(r.json.works.find((w) => w.id === 'W1').elev, null, 'H1.9 无法解析的标高为 null（不按 0）');
  ok(r.json.warnings.some((w) => w.includes('标高') && w.includes('无法解析')), 'H1.10 标高无法解析 warning');
  ok(r.json.undetermined.some((u) => u.kind === 'space'), 'H1.11 标高无法解析时空间关系未判定');
});
// 重复作业编号
f = mk('dup.xlsx', [HEAD,
  ['W1', '动火作业', 'E-1', '一区', '0', `${DATE} 09:00`, `${DATE} 12:00`, '甲队', '张', '', '', '', '', ''],
  ['W1', '检修作业', 'P-1', '一区', '0', `${DATE} 10:00`, `${DATE} 11:00`, '乙队', '李', '', '', '', '', ''],
]);
section('C', () => {
  r = run(f, [], 'dup');
  ok(r.json.warnings.some((w) => w.includes('重复出现')), 'H1.12 重复作业编号 warning');
});
// 结束早于开始
f = mk('revtime.xlsx', [HEAD,
  ['W1', '动火作业', 'E-1', '一区', '0', `${DATE} 12:00`, `${DATE} 09:00`, '甲队', '张', '', '', '', '', ''],
  ['W2', '检修作业', 'P-1', '一区', '0', `${DATE} 10:00`, `${DATE} 11:00`, '乙队', '李', '', '', '', '', ''],
]);
section('C', () => {
  r = run(f, [], 'revtime');
  ok(r.json.warnings.some((w) => w.includes('结束时间不晚于开始时间')), 'H1.13 时段倒置 warning');
});

// ================================================================ H2. 作业许可系统列名、双监护、通常缺省列、层高折算、--rules 生效
f = mk('permit.xlsx', [
  ['作业许可系统导出'],
  ['许可证编号', '作业类别', '作业级别', '功能位置', '作业地点', '标高', '有效期自', '有效期至', '作业单位名称', '属地监护人', '作业单位监护人', '介质', '施工机具', '所属系统'],
  ['YH-1', '用火作业', '一级', 'E-1', '二区', '0', `${DATE} 09:00`, `${DATE} 12:00`, '甲队', '刘国强', '陈志勇', '', '电焊机', 'S1'],
  ['SX-2', '受限空间作业', '', 'E-1', '二区', '0', `${DATE} 09:30`, `${DATE} 12:00`, '甲队', '刘国强', '周文斌', '', '', 'S1'],
  ['GC-3', '高处作业', '二级', 'C-2', '二区', '3层', `${DATE} 08:30`, `${DATE} 11:30`, '乙队', '赵德海', '孙立新', '', '脚手架', 'S1'],
  ['DZ-4', '吊装作业', '三级', 'C-2', '二区', '0', `${DATE} 10:00`, `${DATE} 11:00`, '乙队', '赵德海', '何建军', '', '25吨汽车吊', 'S1'],
  ['合计', '', '', '', '', '', '', '', '', '', '', '', '', ''],
]);
section('A', () => {
  r = run(f, [], 'permit');
  eq(r.summary.ok, true, 'H2.1 作业许可系统列名可读');
  eq(r.json.counts.works, 4, 'H2.2 标题行与合计行处理正确');
  const yh = r.json.works.find((w) => w.id === 'YH-1');
  eq(yh.area, '二区', 'H2.3 「作业地点」命中区域');
  eq(yh.tag, 'E-1', 'H2.4 「功能位置」命中位号');
  eq(yh.guardSite, '刘国强', 'H2.5 属地监护人单列');
  eq(yh.guardUnit, '陈志勇', 'H2.6 作业单位监护人单列');
  ok(/刘国强/.test(yh.guard) && /陈志勇/.test(yh.guard), 'H2.7 双监护合并参与比对');
  ok(yh.start && yh.end, 'H2.8 「有效期自/至」命中起止时间');
  eq(r.json.meta.dualGuard, true, 'H2.9 meta 标记双监护列');
  const z1p = r.json.resourceConflicts.find((x) => x.ruleId === 'Z1' && x.resource === '刘国强');
  ok(!!z1p, 'H2.10 同一属地监护人两张票同时段 → Z1');
  ok(/合并属地监护人与作业单位监护人/.test(z1p.note), 'H2.11 Z1 说明已合并双监护两列');
  ok(!!r.json.resourceConflicts.find((x) => x.ruleId === 'Z1' && x.resource === '赵德海'), 'H2.12 另一属地监护人同时段 → Z1');
  eq(r.json.advisories.length, 1, 'H2.13 同位号 E-1 用火 + 受限空间 → 提示项');
  ok(r.json.meta.absentColumns.includes('电源回路') && r.json.meta.absentColumns.includes('消防覆盖区'), 'H2.14 电源回路/消防覆盖区缺省被记录');
  eq(r.json.warnings.filter((w) => /通常缺省/.test(w)).length, 1, 'H2.15 通常缺省列只提示一次');
  ok(!r.json.resourceConflicts.some((x) => x.ruleId === 'Z3' || x.ruleId === 'Z4'), 'H2.16 缺省列不判 Z3/Z4');
  const gc = r.json.works.find((w) => w.id === 'GC-3');
  eq(gc.elev, 12, 'H2.17 「3层」按默认层高 4 米折算为 12');
  ok(r.json.warnings.some((w) => /按「层」写法折算/.test(w) && /推断值，待确认/.test(w)), 'H2.18 层高折算有 warning 并标推断');
  ok(/【注意】.*层高 4 米折算（推断，待确认）/.test(r.md), 'H2.19 md 提示层高折算');
  ok(hasRule(r.json.riskConflicts, 'R4') && hasRule(r.json.spatialConflicts, 'S2'), 'H2.20 折算标高后吊装 × 高处判为上下层');
});
section('B', () => {
  r = run(f, ['--floor-height', '6'], 'permit-fh');
  eq(r.json.works.find((w) => w.id === 'GC-3').elev, 18, 'H2.21 --floor-height 6 → 3层 = 18 米');
  eq(r.json.meta.floorHeight, 6, 'H2.22 meta 记录层高');
  eq(runRaw(['--input', f, '--workshop', '车间', '--date', DATE, '--floor-height', '零']).s.ok, false, 'H2.23 非法 --floor-height 报错');
});
// --rules 真实生效
const rulesF = path.join(work, 'rules.xlsx');
writeXlsx(rulesF, { '冲突口径': [['规则号', '严重度', '启用', '建议'],
  ['R4', '中', '', '建议按厂内吊装管理规定错时'],
  ['Z1', '', '否', ''],
  ['S2', '低', '是', ''],
  ['X9', '高', '', ''],
  ['S1', '', '', '已安排错时']] });
section('B', () => {
  r = run(f, ['--rules', rulesF], 'permit-rules');
  eq(r.summary.ok, true, 'H2.24 --rules 可读');
  ok(r.summary.rulesApplied.includes('R4') && r.summary.rulesApplied.includes('Z1') && r.summary.rulesApplied.includes('S2'), 'H2.25 覆盖规则记录在摘要');
  eq(r.json.riskConflicts.find((x) => x.ruleId === 'R4').severity, '中', 'H2.26 R4 严重度被厂内口径改为中');
  eq(r.json.riskConflicts.find((x) => x.ruleId === 'R4').advice, '建议按厂内吊装管理规定错时', 'H2.27 R4 建议措辞被覆盖');
  ok(!r.json.resourceConflicts.some((x) => x.ruleId === 'Z1'), 'H2.28 Z1 被厂内口径停用');
  eq(r.json.spatialConflicts.find((x) => x.ruleId === 'S2').severity, '低', 'H2.29 S2 严重度被改为低');
  ok(r.json.warnings.some((w) => /X9/.test(w) && /不是内置规则号/.test(w)), 'H2.30 未知规则号被忽略并 warning（不新增规则）');
  ok(r.json.warnings.some((w) => /S1/.test(w) && /须以「建议」开头/.test(w)), 'H2.31 非建议语气的措辞被忽略');
  ok(/厂内口径（rules\.xlsx）覆盖规则/.test(r.md), 'H2.32 md 判定口径写明厂内覆盖');
  ok(!r.json.warnings.some((w) => /仅记录来源/.test(w)), 'H2.33 不再出现「仅记录来源」');
});
section('A', () => {
  r = run(f, [], 'permit-norules');
  ok(/默认口径，非厂内正式口径/.test(r.json.meta.rulesSource), 'H2.34 未传 --rules 时标注默认口径');
});
section('C', () => {
  ok(fs.existsSync(path.join(__dirname, '..', 'assets', 'templates', 'rules-template.xlsx')), 'H2.35 assets/templates/rules-template.xlsx 存在');
});
section('B', () => {
  r = run(f, ['--rules', path.join(__dirname, '..', 'assets', 'templates', 'rules-template.xlsx')], 'permit-tpl');
  eq(r.summary.ok, true, 'H2.36 模板文件可被 --rules 读取');
  ok(r.json.warnings.some((w) => /无可用的覆盖行/.test(w)), 'H2.37 模板未填时回落默认并 warning');
});
const badRules = path.join(work, 'badrules.xlsx');
writeXlsx(badRules, { '随便': [['a'], [1]] });
section('B', () => {
  r = run(f, ['--rules', badRules], 'permit-badrules');
  ok(r.json.warnings.some((w) => /未找到「冲突口径」工作表/.test(w)), 'H2.38 口径文件无工作表时 warning 回落');
  eq(runRaw(['--input', f, '--workshop', '车间', '--date', DATE, '--rules', '/不存在.xlsx']).s.ok, false, 'H2.39 口径文件不存在报错');
});

// ================================================================ I. 区域划分表补区域
const amap = path.join(work, 'amap.xlsx');
writeXlsx(amap, { '区域划分': [['位号', '区域', '所属系统'], ['E-1', '一区', 'S1'], ['V-1', '一区', 'S1']] });
f = mk('withmap.xlsx', [HEAD,
  ['W1', '动火作业', 'E-1', '', '0', `${DATE} 09:00`, `${DATE} 12:00`, '甲队', '张', '', '', '', '', ''],
  ['W2', '吹扫置换', 'V-1', '', '0', `${DATE} 10:00`, `${DATE} 11:00`, '乙队', '李', '石脑油', '', '', '', ''],
]);
section('B', () => {
  r = run(f, ['--area-map', amap], 'withmap');
  eq(r.json.works.find((w) => w.id === 'W1').area, '一区', 'I1.1 区域由区域划分表补全');
  ok(hasRule(r.json.riskConflicts, 'R1'), 'I1.2 补全区域后命中 R1');
  ok(r.json.warnings.some((w) => w.includes('区域划分表')), 'I1.3 补区域 warning');
});
// 位号不在区域表中 → 仍未判定
f = mk('mapmiss.xlsx', [HEAD,
  ['W1', '动火作业', 'X-9', '', '0', `${DATE} 09:00`, `${DATE} 12:00`, '甲队', '张', '', '', '', '', ''],
  ['W2', '吹扫置换', 'Y-9', '', '0', `${DATE} 10:00`, `${DATE} 11:00`, '乙队', '李', '石脑油', '', '', '', ''],
]);
section('B', () => {
  r = run(f, ['--area-map', amap], 'mapmiss');
  ok(r.json.undetermined.some((u) => u.kind === 'space'), 'I1.4 位号不在区域表时空间关系仍未判定');
  ok(r.json.warnings.some((w) => w.includes('不在区域划分表中')), 'I1.5 位号不在区域表 warning');
});

// ================================================================ J. 参数校验与产出结构
function runRaw(args) {
  const rr = spawnSync(process.execPath, [CONFLICT, ...args], { encoding: 'utf8' });
  const lines = rr.stdout.trim().split('\n');
  try { return { code: rr.status, s: JSON.parse(lines[lines.length - 1]) }; } catch (e) { return { code: rr.status, s: { ok: false, error: 'no-json' } }; }
}
const base = mk('base.xlsx', [HEAD,
  ['W1', '动火作业', 'E-1', '一区', '0', `${DATE} 09:00`, `${DATE} 12:00`, '甲队', '张', '', '', '', '', ''],
  ['W2', '吹扫置换', 'V-1', '一区', '0', `${DATE} 10:00`, `${DATE} 11:00`, '乙队', '李', '石脑油', '', '', '', ''],
]);
section('B', () => {
  let x = runRaw(['--input']);
  eq(x.s.ok, false, 'J1.1 --input 缺值报错');
  ok(/缺少取值/.test(x.s.error), 'J1.2 缺值错误信息正确');
  eq(x.code, 1, 'J1.3 退出码为 1');
  x = runRaw(['--input', base, '--workshop', '车间']);
  eq(x.s.ok, false, 'J1.4 缺 --date 报错');
  x = runRaw(['--input', base, '--date', DATE]);
  eq(x.s.ok, false, 'J1.5 缺 --workshop 报错');
  x = runRaw(['--input', base, '--workshop', '车间', '--date', '2026-13-45']);
  eq(x.s.ok, false, 'J1.6 非法日期报错');
  x = runRaw(['--input', base, '--workshop', '车间', '--date', DATE, '--未知参数', 'x']);
  eq(x.s.ok, false, 'J1.7 未知参数报错');
  x = runRaw(['--input', '/不存在的路径.xlsx', '--workshop', '车间', '--date', DATE]);
  eq(x.s.ok, false, 'J1.8 输入不存在报错');
  x = runRaw(['--input', base, '--workshop', '车间', '--date', DATE, '--window', 'abc']);
  eq(x.s.ok, false, 'J1.9 非法 --window 报错');
  ok(/非负整数/.test(x.s.error), 'J1.10 --window 错误信息正确');
});
// 无作业清单表
const bad = mk('bad.xlsx', [['a', 'b'], [1, 2]], '随便一张表');
section('B', () => {
  r = run(bad, [], 'bad');
  eq(r.summary.ok, false, 'J1.11 无「作业清单」工作表时 ok:false');
  eq(r.code, 1, 'J1.12 退出码为 1');
  ok(/未找到「作业清单」/.test(r.summary.error), 'J1.13 错误信息明确');
});

// 产出结构
section('BVT', () => {
  r = run(base, [], 'struct');
  ok(fs.existsSync(path.join(r.out, 'summary.json')), 'J2.1 summary.json 已写入');
  eq(JSON.parse(fs.readFileSync(path.join(r.out, 'summary.json'), 'utf8')).ok, true, 'J2.2 summary.json 内容正确');
  ok(fs.existsSync(path.join(r.out, 'conflicts.json')), 'J2.3 conflicts.json 已写入');
  ok(fs.existsSync(path.join(r.out, 'conflicts.md')), 'J2.4 conflicts.md 已写入');
  ok(/## 一、检测概览/.test(r.md) && /## 二、空间冲突/.test(r.md) && /## 三、风险冲突/.test(r.md)
    && /## 四、资源冲突/.test(r.md) && /## 五、无法判定项/.test(r.md) && /## 六、时段重叠视图/.test(r.md)
    && /## 七、冲突分析与协调建议/.test(r.md), 'J2.5 七节结构齐全');
  ok(/<!-- ANALYSIS_START -->/.test(r.md) && /<!-- ANALYSIS_END -->/.test(r.md), 'J2.6 分析段占位符存在');
  ok(['spatialConflicts', 'riskConflicts', 'resourceConflicts', 'undetermined', 'timeline', 'counts']
    .every((k) => r.json[k] !== undefined), 'J2.7 conflicts.json 六个必需键齐全');
  ok(r.json.riskConflicts.every((c) => c.ruleId && c.severity && c.advice), 'J2.8 每条冲突带规则号、严重度与建议');
  ok(typeof r.json.counts.high === 'number' && typeof r.json.counts.undetermined === 'number', 'J2.9 counts 含严重度与未判定计数');
});

// ================================================================ W. 车间范围核对（D007）
{
  // 列序含「属地监护人 / 作业单位名称」，同时核对加「车间」后各列归属不乱
  const WH = ['许可证编号', '作业类别', '功能位置', '作业地点', '标高', '有效期自', '有效期至', '作业单位名称', '属地监护人', '作业单位监护人', '介质'];
  const job = (id, type, unit, guard, ws) => [id, type, 'E-1', '二区', '0', `${DATE} 09:00`, `${DATE} 12:00`, unit, guard, `${guard}乙`, '', ...(ws === undefined ? [] : [ws])];
  const wsOf = (x) => ((x.json && x.json.meta && x.json.meta.workshopScope) || [])[0] || {};
  const ids = (x) => ((x.json && x.json.works) || []).map((w) => w.id);
  const allPairs = (x) => x.json ? [...x.json.spatialConflicts, ...x.json.riskConflicts, ...x.json.resourceConflicts].map((c) => (c.pair || (c.works || []).map((w) => w.id)).join('+')) : [];
  let w;
  section('A', () => {
    w = run(mk('ws-mix.xlsx', [[...WH, '车间'],
      job('YH-W1', '用火作业', '甲队', '刘国强', '测试车间'),
      job('SX-W2', '受限空间作业', '乙队', '刘国强', '加氢车间'),
      job('GC-W3', '高处作业', '丙队', '赵德海', ''),
      job('DZ-W4', '吊装作业', '丁队', '孙立新', '测试')]), [], 'ws-mix');
    eq(w.json && w.json.counts.works, 3, 'W1 两车间混合：只检测本车间与车间为空的作业（3 项）');
    ok(w.json && !ids(w).includes('SX-W2') && !allPairs(w).some((p) => /SX-W2/.test(p)), 'W2 加氢车间的 SX-W2 不参与任何冲突判定');
    ok(w.json && w.json.warnings.some((x) => /剔除其他车间 1 行/.test(x) && /加氢车间 1 行/.test(x)), 'W3 warning 写明剔除行数与车间名');
    ok(wsOf(w).status === 'checked' && wsOf(w).column === '车间' && wsOf(w).droppedRows === 1 && (wsOf(w).dropped || {})['加氢车间'] === 1, 'W4 meta.workshopScope 记录剔除情况');
    ok(wsOf(w).blank === 1 && ids(w).includes('GC-W3'), 'W5 车间列为空的行按本车间保留');
    const y1 = (w.json && w.json.works.find((x) => x.id === 'YH-W1')) || {};
    ok(y1.unit === '甲队' && y1.guardSite === '刘国强' && y1.area === '二区', 'W6 加「车间」后作业单位、属地监护人、区域列归属不变');
    ok(w.md && /车间范围：已按车间列核对「测试车间」，剔除其他车间的行：「作业清单」1 行（加氢车间 1 行）/.test(w.md), 'W7 md 口径写明按车间核对');
    w = run(mk('ws-mis.xlsx', [[...WH, '车间'], job('YH-W1', '用火作业', '甲队', '刘国强', '加氢车间'), job('SX-W2', '受限空间作业', '乙队', '王五', '焦化车间')]), [], 'ws-mis');
    ok(w.json && w.json.counts.works === 2 && wsOf(w).status === 'mismatch', 'W8 车间列全不一致：不筛，status=mismatch');
    ok(w.json && w.json.warnings.some((x) => /^【注意】/.test(x)), 'W9 车间列全不一致 warning 以【注意】开头');
    const at = w.md ? w.md.indexOf('的车间列取值与 --workshop「测试车间」不一致') : -1;
    ok(at > 0 && at < w.md.indexOf('## 一'), 'W10 md 开头（第一节之前）有【注意】提示');
  });
  section('B', () => {
    w = run(mk('ws-nocol.xlsx', [WH, job('YH-W1', '用火作业', '甲队', '刘国强'), job('SX-W2', '受限空间作业', '乙队', '王五')]), [], 'ws-nocol');
    ok(wsOf(w).status === 'noColumn' && w.json.counts.works === 2 && /输入未含车间列，车间范围以取数条件为准/.test(w.md), 'W11 无车间列：不筛，md 口径说明以取数条件为准');
    w = run(mk('ws-plant.xlsx', [[...WH, '维护工厂'], job('YH-W1', '用火作业', '甲队', '刘国强', '1100'), job('SX-W2', '受限空间作业', '乙队', '王五', '1200')]), [], 'ws-plant');
    ok(wsOf(w).status === 'noColumn' && w.json.counts.works === 2, 'W12 「维护工厂」列不当车间列（noColumn，不筛）');
    // 只有「车间监护人」（属地监护人别名）时，它归属地监护人，不当车间列
    const gh = WH.map((h) => (h === '属地监护人' ? '车间监护人' : h));
    w = run(mk('ws-guard.xlsx', [gh, job('YH-W1', '用火作业', '甲队', '刘国强'), job('SX-W2', '受限空间作业', '乙队', '王五')]), [], 'ws-guard');
    ok(wsOf(w).status === 'noColumn' && w.json.counts.works === 2 && (w.json.works.find((x) => x.id === 'YH-W1') || {}).guardSite === '刘国强', 'W13 「车间监护人」归属地监护人，不当车间列');
    w = run(mk('ws-ssc.xlsx', [[...WH, '所属车间'], job('YH-W1', '用火作业', '甲队', '刘国强', '测试车间'), job('SX-W2', '受限空间作业', '乙队', '王五', '加氢车间')]), [], 'ws-ssc');
    ok(wsOf(w).status === 'checked' && wsOf(w).column === '所属车间' && w.json.counts.works === 1, 'W14 「所属车间」列同样核对');
    w = run(mk('ws-both.xlsx', [[...WH, '车间监护人'], job('YH-W1', '用火作业', '甲队', '刘国强', '张三'), job('SX-W2', '受限空间作业', '乙队', '王五', '李四')]), [], 'ws-both');
    ok(wsOf(w).status === 'noColumn' && w.json.counts.works === 2 && !w.json.warnings.some((x) => /^【注意】/.test(x)), 'W15 已有属地监护人列时多出的「车间监护人」人员列不当车间列，不误报【注意】');
  });
}

// ================================================================ K. 样例可再生（seed 变数值，结论不变）
const MS = path.join(__dirname, 'make-sample.js');
function sampleRun(seed) {
  const d = path.join(work, 'ms' + seed);
  const rr = spawnSync(process.execPath, [MS, '--out', d, '--seed', String(seed), '--date', DATE], { encoding: 'utf8' });
  if (rr.status !== 0) return null;
  return run(path.join(d, `sample-operations-${DATE}.xlsx`), [], 'sample' + seed);
}
section('C', () => {
  const s1 = sampleRun(1), s2 = sampleRun(7);
  ok(s1 && s1.summary.ok === true, 'K1.1 make-sample seed=1 产出可跑通');
  ok(s2 && s2.summary.ok === true, 'K1.2 make-sample seed=7 产出可跑通');
  if (s1 && s2) {
    eq(s2.json.counts.works, s1.json.counts.works, 'K1.3 seed 变化不改变作业数');
    eq(s2.json.counts.high, s1.json.counts.high, 'K1.4 seed 变化不改变高严重度冲突数');
    eq(s2.json.counts.undetermined, s1.json.counts.undetermined, 'K1.5 seed 变化不改变未判定数');
    ok(s1.json.counts.high >= 4, 'K1.6 主样例高严重度冲突 ≥4 组');
    ok(s1.json.counts.undetermined >= 3, 'K1.7 主样例未判定项 ≥3 项');
    ok(hasRule(s1.json.riskConflicts, 'R1') && hasRule(s1.json.riskConflicts, 'R4') && s1.json.advisories.some((x) => x.ruleId === 'R2'),
      'K1.8 主样例覆盖 R1/R4 与 R2 提示项');
    eq(s1.json.counts.advisory, 1, 'K1.9 主样例恒为 1 项提示项');
    const pe = run(path.join(work, 'ms1', 'sample-permit-export.xlsx'), [], 'sample-permit');
    ok(pe.summary.ok === true && pe.json.meta.dualGuard === true, 'K1.10 作业许可导出样例可跑通且识别双监护');
  }
});

// ---- 输出
console.log(`\n${'='.repeat(56)}`);
console.log(`cross-operation-conflict 自测：${pass} 通过，${fail} 失败`);
console.log(`用例级别 ${LEVELS[RUN_LEVEL]}：BVT ${byLevel.BVT}，A ${byLevel.A}，B ${byLevel.B}，C ${byLevel.C}`);
if (failures.length) { console.log('\n失败项：'); failures.forEach((x) => console.log('  ✗ ' + x)); }
console.log('='.repeat(56));
try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
