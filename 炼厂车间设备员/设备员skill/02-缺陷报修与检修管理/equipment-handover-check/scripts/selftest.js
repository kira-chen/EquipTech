#!/usr/bin/env node
'use strict';
/** 自测：断言 handover.js 与 rules.js 行为。用法：node scripts/selftest.js（全绿退出 0） */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { writeXlsx } = require('./lib/xlsx-lite');
const R = require('./lib/rules');

const HANDOVER = path.join(__dirname, 'handover.js');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ehc-selftest-'));
let pass = 0, fail = 0;
const failures = [];
const ok = (c, n) => { if (c) pass++; else { fail++; failures.push(n); } };
const eq = (a, e, n) => ok(a === e, `${n}（期望 ${JSON.stringify(e)}，实际 ${JSON.stringify(a)}）`);

function run(args, tag) {
  const out = path.join(work, tag + '-out');
  const r = spawnSync(process.execPath, [HANDOVER, ...args, '--out', out], { encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  let s; try { s = JSON.parse(lines[lines.length - 1]); } catch (e) { s = { ok: false, error: 'no-json:' + r.stdout + r.stderr }; }
  let j = null, md = null;
  if (fs.existsSync(path.join(out, 'handover.json'))) j = JSON.parse(fs.readFileSync(path.join(out, 'handover.json'), 'utf8'));
  if (fs.existsSync(path.join(out, 'handover.md'))) md = fs.readFileSync(path.join(out, 'handover.md'), 'utf8');
  return { code: r.status, s, j, md, out };
}
const mk = (n, b) => { const p = path.join(work, n); writeXlsx(p, b); return p; };
const has = (j, id) => j.items.some((x) => x.ruleId === id);
const itemOf = (j, id) => j.items.find((x) => x.ruleId === id) || {};

// ============ A. 规则引擎单元测试：介质危险特性 ============
eq(R.classifyMedium('液化气').level, 'high', 'A1 液化气→高危');
eq(R.classifyMedium('硫化氢').level, 'high', 'A2 硫化氢→高危');
eq(R.classifyMedium('循环氢').level, 'high', 'A3 氢气→高危');
eq(R.classifyMedium('苯').level, 'high', 'A4 苯→高危');
eq(R.classifyMedium('液氨').level, 'high', 'A5 氨→高危');
eq(R.classifyMedium('氮气').level, 'high', 'A6 氮气按窒息性→高危');
eq(R.classifyMedium('蜡油').level, 'medium', 'A7 蜡油→中危');
eq(R.classifyMedium('胺液').level, 'medium', 'A8 胺液→中危');
eq(R.classifyMedium('循环水').level, 'low', 'A9 循环水→低危');
eq(R.classifyMedium('仪表风').level, 'low', 'A10 仪表风→低危');
// 硬约束 1：不在库绝不按无危险处理
eq(R.classifyMedium('再生剂RX-7').level, 'unknown', 'A11 介质不在库→unknown');
eq(R.classifyMedium('再生剂RX-7').effective, 'high', 'A12 不在库按最严（高危）口径，绝不按低危');
eq(R.classifyMedium('再生剂RX-7').inLibrary, false, 'A13 不在库标记 inLibrary=false');
eq(R.classifyMedium('').effective, 'high', 'A14 介质为空同样按最严口径');
eq(R.classifyMedium('').inLibrary, false, 'A15 介质为空不视为在库');
ok(R.hazText(R.classifyMedium('未知介质X')).includes('最严'), 'A16 不在库的依据文案点明最严口径');

// ============ B. 规则引擎：设备类型与三态 ============
eq(R.classifyEquip('离心泵', ''), 'pump', 'B1 离心泵→pump');
eq(R.classifyEquip('往复式压缩机', ''), 'compressor', 'B2 压缩机→compressor');
eq(R.classifyEquip('管壳式换热器', ''), 'exchanger', 'B3 换热器→exchanger');
eq(R.classifyEquip('', '脱硫塔'), 'column', 'B4 塔器→column');
eq(R.classifyEquip('电机', ''), 'electrical', 'B5 电机→electrical');
eq(R.classifyEquip('说不清的东西', ''), 'other', 'B6 无法识别→other');
eq(R.classifyEquip('电机', '循环水泵电机'), 'electrical', 'B6a 类型字段优先于名称（泵电机按电气判）');
eq(R.classifyEquip('', '循环水泵电机'), 'pump', 'B6b 仅有名称时按名称命中顺序判');
eq(R.tri(''), null, 'B7 空→null，不默认 false');
eq(R.tri('是'), true, 'B8 是→true');
eq(R.tri('否'), false, 'B9 否→false');
eq(R.tri('说不好'), null, 'B10 无法识别→null');
eq(R.isDismantle('机械密封解体更换'), true, 'B11 解体识别');
eq(R.isDismantle('外观检查'), false, 'B12 非解体');

// ============ C. 高危介质泵解体：核心条目齐全 ============
const BASE = ['--tag', 'P-9101A', '--equip-type', '离心泵', '--medium', '液化气', '--scope', '机械密封解体更换'];
let r = run([...BASE, '--pressured', '是', '--hot', '否', '--no-entry', '--no-hotwork'], 'c-high');
eq(r.s.ok, true, 'C1 基础运行成功');
ok(has(r.j, 'H1'), 'C2 生成停车条目');
ok(has(r.j, 'H2'), 'C3 生成关阀条目');
ok(has(r.j, 'H3'), 'C4 高危介质生成加盲板条目');
ok(has(r.j, 'H4'), 'C5 高危介质生成双阀隔离条目');
ok(has(r.j, 'H5'), 'C6 解体作业生成拆管线条目');
ok(has(r.j, 'P1'), 'C7 带压生成泄压条目');
ok(!has(r.j, 'P2'), 'C8 明确非高温时不生成降温条目');
ok(has(r.j, 'Q1'), 'C9 生成排净条目');
ok(has(r.j, 'Q2'), 'C10 生成吹扫置换条目');
ok(has(r.j, 'Q3'), 'C11 高危介质生成取样分析条目');
ok(has(r.j, 'E1'), 'C12 机泵生成断电挂牌上锁条目');
ok(has(r.j, 'M1'), 'C13 转动设备生成盘车防转条目');
ok(has(r.j, 'M2'), 'C14 解体生成联轴器拆除条目');
ok(has(r.j, 'S1'), 'C15 生成现场清理条目');
ok(has(r.j, 'S3'), 'C16 生成围栏警示条目');
ok(has(r.j, 'S4'), 'C17 高危介质生成气体检测报警条目');
ok(!has(r.j, 'Q4'), 'C18 明确不进受限空间时不生成氧含量分析条目');
ok(!has(r.j, 'Q6'), 'C19 明确不动火时不生成可燃气分析条目');
eq(r.j.counts.undetermined, 0, 'C20 依据齐全时无未判定项');
ok(r.j.items.every((x) => /^[A-Z]\d$/.test(x.ruleId)), 'C21 每条都带可追溯规则号');
ok(r.j.items.every((x) => x.basis && x.verify && x.owner), 'C22 每条都有依据、确认方式、责任岗位');

// ============ D. 硬约束 1：介质不在库 → 最严口径 + warning ============
r = run(['--tag', 'V-9401', '--equip-type', '立式容器', '--medium', '再生剂RX-7', '--scope', '内部涂层修补', '--entry', '--no-hotwork'], 'd-unknown');
eq(r.s.ok, true, 'D1 未知介质仍可运行');
eq(r.j.meta.mediumHazard, 'unknown', 'D2 介质标记为 unknown');
eq(r.j.meta.mediumEffective, 'high', 'D3 按最严口径（high）生成');
ok(has(r.j, 'H3') && has(r.j, 'H4'), 'D4 未知介质生成盲板与双阀隔离（最严）');
ok(has(r.j, 'Q3'), 'D5 未知介质生成取样分析条目');
ok(has(r.j, 'S4'), 'D6 未知介质生成气体检测报警条目');
ok(r.j.warnings.some((w) => w.includes('MSDS')), 'D7 warning 提示核实 MSDS');
ok(r.j.warnings.some((w) => w.includes('最严')), 'D8 warning 说明按最严口径');
ok(/不在危险特性库/.test(r.md), 'D9 md 中标注介质不在库');
// 未提供介质同样按最严，不得按无危险
let r2 = run(['--tag', 'V-9402', '--equip-type', '立式容器', '--scope', '内部检查', '--entry', '--no-hotwork'], 'd-nomedium');
eq(r2.j.meta.mediumEffective, 'high', 'D10 介质未填同样按最严口径');
ok(has(r2.j, 'H3'), 'D11 介质未填仍生成盲板条目');
ok(r2.j.warnings.some((w) => w.includes('MSDS')), 'D12 介质未填 warning 提示核实 MSDS');

// ============ E. 硬约束 2：判定依据缺失 → undetermined 单列，不按「不需要」 ============
r = run(['--tag', 'E-9201', '--equip-type', '管壳式换热器', '--medium', '蜡油', '--scope', '管束抽芯清洗'], 'e-undet');
eq(r.s.ok, true, 'E1 依据缺失仍可运行');
ok(r.j.counts.undetermined >= 2, 'E2 存在多项未判定');
eq(itemOf(r.j, 'P1').status, 'undetermined', 'E3 未说明是否带压→泄压条目未判定');
ok(String(itemOf(r.j, 'P1').missing).includes('带压'), 'E4 未判定注明缺失的依据字段');
eq(itemOf(r.j, 'P1').required, null, 'E5 未判定项 required 为 null，不是 false');
eq(itemOf(r.j, 'P2').status, 'undetermined', 'E6 未说明是否高温→降温条目未判定');
eq(itemOf(r.j, 'Q4').ruleId, undefined, 'E7 换热器非进人类，不强行生成受限空间条目');
ok(r.j.undetermined.length === r.j.items.filter((x) => x.status === 'undetermined').length, 'E8 未判定项已全部单列');
ok(/## 四、未判定项/.test(r.md) && /不得按「不需要」处理/.test(r.md), 'E9 md 未判定节写明不得按不需要处理');
ok(r.j.undetermined.every((x) => x.missing && x.ruleId), 'E10 未判定项含规则号与缺失说明');
// 容器类未说明是否进人 → Q4/Q5 未判定，绝不当作不进人
r2 = run(['--tag', 'V-9403', '--equip-type', '立式容器', '--medium', '柴油', '--scope', '内壁检查'], 'e-entry');
eq(itemOf(r2.j, 'Q4').status, 'undetermined', 'E11 容器未说明是否进人→氧含量分析未判定');
eq(itemOf(r2.j, 'Q5').status, 'undetermined', 'E12 容器未说明是否进人→通风监护未判定');
ok(!has(r2.j, 'Q6'), 'E13 未说明动火时不凭空生成动火条目（动火为显式声明项）');

// ============ F. 硬约束 3：关键条目单列 ============
r = run([...BASE, '--pressured', '是', '--hot', '否', '--no-entry', '--no-hotwork'], 'f-crit');
eq(r.j.counts.critical, 3, 'F1 关键条目 3 项');
const critIds = r.j.criticalItems.map((x) => x.ruleId).sort();
eq(critIds.join(','), 'E1,H3,Q3', 'F2 关键条目为盲板(H3)、置换分析(Q3)、断电挂牌(E1)');
ok(/## 二、关键条目/.test(r.md), 'F3 md 关键条目单列一节');
ok(r.j.criticalItems.every((x) => x.title && x.status), 'F4 关键条目含内容与状态');
ok(r.j.items.filter((x) => x.critical).length === r.j.criticalItems.length, 'F5 criticalItems 与 items 标记一致');
// 低危介质的水泵仍有 E1 关键条目
r2 = run(['--tag', 'P-9102B', '--equip-type', '离心泵', '--medium', '循环水', '--scope', '更换轴承', '--pressured', '否', '--hot', '否', '--no-entry', '--no-hotwork'], 'f-low');
eq(r2.j.counts.critical, 1, 'F6 低危介质水泵仅断电挂牌为关键条目');
eq(r2.j.criticalItems[0].ruleId, 'E1', 'F7 该关键条目为 E1 断电挂牌');
ok(!has(r2.j, 'H3'), 'F8 低危介质不强制加盲板');
ok(!has(r2.j, 'Q3'), 'F9 低危介质且不进人不动火时不强制取样分析');

// ============ G. 硬约束 4：脚本不得预填「已完成」 ============
r = run([...BASE, '--pressured', '是', '--hot', '否', '--no-entry', '--no-hotwork'], 'g-noprefill');
ok(r.j.items.every((x) => x.confirmed === null), 'G1 所有条目 confirmed 一律 null');
ok(r.j.items.every((x) => x.confirmedBy === null && x.confirmedAt === null), 'G2 确认人与确认时间均为 null');
eq(r.j.counts.confirmed, 0, 'G3 已确认数为 0');
ok(r.j.criticalItems.every((x) => x.confirmed === null), 'G4 关键条目 confirmed 也是 null');
ok(!/\|\s*已完成\s*\|/.test(r.md), 'G5 md 未出现单独填写为「已完成」的单元格');
ok(/☐ 已完成/.test(r.md), 'G6 md 以勾选框形式留白待现场填写');
ok(/不得预填/.test(r.md), 'G7 md 明示脚本不得预填');

// ============ H. 硬约束 5：未完成/未判定时 md 开头醒目提示（两个方向） ============
// 方向一：存在未完成或未判定 → 出现
ok(/【注意】尚不具备交出条件/.test(r.md), 'H1 待确认项存在时 md 开头出现「【注意】尚不具备交出条件」');
ok(r.md.indexOf('【注意】尚不具备交出条件') < 200, 'H2 提示位于 md 开头');
eq(r.j.ready, false, 'H3 ready 为 false');
r2 = run(['--tag', 'E-9202', '--equip-type', '管壳式换热器', '--medium', '蜡油', '--scope', '管束抽芯'], 'h-undet');
ok(/【注意】尚不具备交出条件/.test(r2.md), 'H4 存在未判定项时同样出现提示');
// 方向二：现场确认全部完成且无未判定 → 不出现
const lowArgs = ['--tag', 'P-9102B', '--equip-type', '离心泵', '--medium', '循环水', '--scope', '更换轴承',
  '--pressured', '否', '--hot', '否', '--no-entry', '--no-hotwork'];
r2 = run(lowArgs, 'h-src');
const confAll = path.join(work, 'conf-all.json');
fs.writeFileSync(confAll, JSON.stringify(r2.j.items.map((x) => ({ ruleId: x.ruleId, confirmed: '是', by: '张工', at: '2026-09-21 10:00' }))), 'utf8');
let rr = run([...lowArgs, '--confirm', confAll], 'h-done');
eq(rr.j.ready, true, 'H5 全部确认完成后 ready 为 true');
ok(!/【注意】尚不具备交出条件/.test(rr.md), 'H6 全部完成时 md 不出现「尚不具备交出条件」');
eq(rr.j.counts.pending, 0, 'H7 待确认数归零');
eq(rr.j.counts.confirmed, rr.j.counts.total, 'H8 已确认数等于总数');
// 有一项填「否」→ 重新出现提示
const confOne = path.join(work, 'conf-one.json');
fs.writeFileSync(confOne, JSON.stringify(r2.j.items.map((x, i) => ({ ruleId: x.ruleId, confirmed: i === 0 ? '否' : '是', by: '张工' }))), 'utf8');
rr = run([...lowArgs, '--confirm', confOne], 'h-partial');
eq(rr.j.ready, false, 'H9 存在未完成项时 ready 为 false');
ok(/【注意】尚不具备交出条件/.test(rr.md), 'H10 存在未完成项时重新出现提示');
ok(/\*\*未完成\*\*/.test(rr.md), 'H11 未完成项在表中醒目标注');
ok(/## 五、未完成项/.test(rr.md), 'H12 未完成项单列一节');

// ============ I. 硬约束 6：声明行必须保留 ============
const DECL = '本清单为辅助核对工具，设备交出须由工艺、设备、安全人员现场确认并签字，签字前不得开始检修作业。';
ok(r.md.includes(DECL), 'I1 md 包含声明行');
eq(r.j.meta.declaration, DECL, 'I2 json 中记录声明行原文');
ok(rr.md.includes(DECL), 'I3 全部完成场景下声明行仍保留');
ok(r.md.split(DECL).length - 1 >= 2, 'I4 声明行在开头与签字栏各出现一次');

// ============ J. 作业类型专项条目 ============
r = run(['--tag', 'C-9501', '--equip-type', '填料塔', '--medium', '胺液', '--scope', '塔内件更换，需进人', '--entry', '--no-hotwork', '--pressured', '是', '--hot', '是'], 'j-entry');
ok(has(r.j, 'Q4'), 'J1 进受限空间生成氧含量与毒性气体分析条目');
ok(has(r.j, 'Q5'), 'J2 进受限空间生成通风与监护人条目');
ok(/19\.5%/.test(r.md) && /GB 30871/.test(itemOf(r.j, 'Q4').title), 'J3 氧含量条目写明合格区间并注明出处');
ok(has(r.j, 'P2'), 'J4 高温设备生成降温条目');
ok(has(r.j, 'E3'), 'J5 进人作业生成联锁摘除条目');
r2 = run(['--tag', 'E-9203', '--equip-type', '换热器', '--medium', '蜡油', '--scope', '法兰焊接', '--hotwork', '--no-entry', '--pressured', '是', '--hot', '是'], 'j-hot');
ok(has(r2.j, 'Q6'), 'J6 动火作业生成可燃气体分析条目');
ok(has(r2.j, 'S2'), 'J7 动火作业生成周边清理与消防措施条目');
ok(has(r2.j, 'H3'), 'J8 动火作业强制加盲板');
r2 = run(['--tag', 'V-9404', '--equip-type', '立式容器', '--medium', '轻烃', '--scope', '人孔开盖检查动火补焊', '--entry', '--hotwork', '--pressured', '是', '--hot', '否'], 'j-both');
ok(r2.j.warnings.some((w) => w.includes('高风险作业组合')), 'J9 进人+动火组合触发高风险提示');
// 电气设备
r = run(['--tag', 'M-9301', '--equip-type', '电机', '--scope', '轴承更换', '--no-entry', '--no-hotwork', '--pressured', '否', '--hot', '否'], 'j-elec');
ok(has(r.j, 'E1'), 'J10 电气设备生成断电挂牌上锁条目');
ok(has(r.j, 'E2'), 'J11 电气设备生成验电与接地线条目');
ok(!has(r.j, 'M1'), 'J12 电机本体非机泵，不生成盘车防转条目');
r2 = run(['--tag', 'M-9302', '--equip-type', '电机', '--name', '循环水泵电机', '--scope', '轴承更换', '--no-entry', '--no-hotwork', '--pressured', '否', '--hot', '否'], 'j-motorname');
eq(r2.j.meta.equipKey, 'electrical', 'J13 名称含「泵」的电机仍按电气设备判');
ok(has(r2.j, 'E2'), 'J14 该电机生成验电接地线条目');
ok(r2.j.meta.mediumEffective === 'high' && r2.j.warnings.some((w) => w.includes('MSDS')), 'J15 电气设备介质未填同样按最严口径并提示 MSDS');

// ============ K. 设备台账补全 ============
const led = mk('ledger.xlsx', {
  '设备台账': [
    ['位号', '设备名称', '设备类型', '介质', '操作温度', '操作压力'],
    ['P-9101A', '液化气进料泵A', '离心泵', '液化气', 45, 1.6],
    ['E-9201', '蜡油换热器', '管壳式换热器', '蜡油', 230, 0.9],
  ],
});
r = run(['--tag', 'P-9101A', '--scope', '机封更换', '--ledger', led, '--no-entry', '--no-hotwork'], 'k-ledger');
eq(r.j.meta.name, '液化气进料泵A', 'K1 台账补全设备名称');
eq(r.j.meta.medium, '液化气', 'K2 台账补全介质');
eq(r.j.meta.equipKey, 'pump', 'K3 台账补全设备类型');
eq(r.j.meta.pressured, null, 'K4 台账压力 1.6MPa 不再推断为带压，仍为未说明');
eq(r.j.meta.pressureHint, '可能带压', 'K4a 压力数值只形成「推断值」提示');
ok(r.j.warnings.some((w) => /推断值.*待确认.*不进入判定/.test(w)), 'K4b warning 写明推断值待确认且不进入判定');
eq(itemOf(r.j, 'P1').status, 'undetermined', 'K4c 泄压条目按未判定处理，不按推断值生成为必做');
ok(/推断值「可能带压」待确认，不进入判定/.test(r.md), 'K4d md 设备信息表标注推断值待确认');
ok(/【未判定】带压\/高温推断值仅供参考/.test(r.md), 'K4e md 未判定节提示推断值仅供参考');
r = run(['--tag', 'E-9201', '--scope', '管束抽芯', '--ledger', led, '--no-entry', '--no-hotwork'], 'k-hot');
eq(r.j.meta.hot, null, 'K5 台账温度 230℃ 不再推断为高温，仍为未说明');
eq(r.j.meta.hotHint, '可能高温', 'K5a 温度数值只形成「推断值」提示');
eq(itemOf(r.j, 'P2').status, 'undetermined', 'K6 未说明高温时降温条目为未判定，不按推断值生成');
r = run(['--tag', 'E-9201', '--scope', '管束抽芯', '--ledger', led, '--no-entry', '--no-hotwork', '--hot', '是', '--pressured', '是'], 'k-hot2');
eq(r.j.meta.hotHint, null, 'K6a 显式给 --hot 后不再出现推断值提示');
ok(has(r.j, 'P2') && itemOf(r.j, 'P2').status === 'pending', 'K6b 显式高温后降温条目为必做');
ok(!r.j.warnings.some((w) => /推断值/.test(w)), 'K6c 显式确认后无推断值 warning');
r = run(['--tag', 'X-0000', '--scope', '检查', '--ledger', led, '--no-entry', '--no-hotwork'], 'k-miss');
ok(r.j.warnings.some((w) => w.includes('不在设备台账')), 'K7 位号不在台账时 warning');
eq(r.j.meta.mediumEffective, 'high', 'K8 台账未命中时介质仍按最严口径');

// ============ L. 参数校验 ============
function runRaw(args) {
  const x = spawnSync(process.execPath, [HANDOVER, ...args], { encoding: 'utf8' });
  const lines = x.stdout.trim().split('\n');
  try { return { code: x.status, s: JSON.parse(lines[lines.length - 1]) }; } catch (e) { return { code: x.status, s: { ok: false, error: 'no-json' } }; }
}
let x = runRaw(['--tag']);
eq(x.s.ok, false, 'L1 --tag 缺值报错');
ok(/缺少取值/.test(x.s.error), 'L2 缺值错误信息正确');
eq(x.code, 1, 'L3 退出码为 1');
x = runRaw(['--scope', '检修']);
eq(x.s.ok, false, 'L4 缺 --tag 报错');
x = runRaw(['--tag', 'P-01']);
eq(x.s.ok, false, 'L5 缺 --scope 报错');
x = runRaw(['--tag', 'P-01', '--scope', '检修', '--未知参数', 'x']);
eq(x.s.ok, false, 'L6 未知参数报错');
x = runRaw(['--tag', 'P-01', '--scope', '检修', '--plan-date', '2026-13-45']);
eq(x.s.ok, false, 'L7 非法日期报错');
x = runRaw(['--tag', 'P-01', '--scope', '检修', '--ledger', '/不存在的台账.xlsx']);
eq(x.s.ok, false, 'L8 台账不存在报错');
x = runRaw(['--tag', 'P-01', '--scope', '检修', '--entry', '--no-entry']);
eq(x.s.ok, false, 'L9 --entry 与 --no-entry 互斥报错');
x = runRaw(['--tag', 'P-01', '--scope', '检修', '--confirm', '/不存在的确认.json']);
eq(x.s.ok, false, 'L10 确认结果文件不存在报错');
// 无法解析的数值 → null 不是 0
r = run(['--tag', 'P-9103', '--equip-type', '离心泵', '--medium', '柴油', '--scope', '检查', '--temp', '偏高', '--no-entry', '--no-hotwork'], 'l-badnum');
eq(r.j.meta.temp, null, 'L11 无法解析的温度为 null 不是 0');
ok(r.j.warnings.some((w) => w.includes('无法解析为数字')), 'L12 数值无法解析有 warning');
eq(r.j.meta.hot, null, 'L13 温度不可解析时是否高温仍为未说明');
r = run(['--tag', 'P-9104', '--equip-type', '离心泵', '--medium', '柴油', '--scope', '检查', '--pressured', '说不清', '--no-entry', '--no-hotwork'], 'l-badtri');
eq(r.j.meta.pressured, null, 'L14 无法识别的是否带压按未说明处理');
ok(r.j.warnings.some((w) => w.includes('无法识别')), 'L15 是否带压无法识别有 warning');

// ============ M. 确认结果回填校验 ============
r2 = run(lowArgs, 'm-src');
const confBad = path.join(work, 'conf-bad.json');
fs.writeFileSync(confBad, JSON.stringify([{ ruleId: 'ZZ9', confirmed: '是', by: '张' }, { ruleId: 'H1', confirmed: '说不好', by: '张' }]), 'utf8');
rr = run([...lowArgs, '--confirm', confBad], 'm-bad');
eq(rr.s.ok, true, 'M1 确认结果异常不中断');
ok(rr.j.warnings.some((w) => w.includes('不在本次清单中')), 'M2 未知规则号 warning');
ok(rr.j.warnings.some((w) => w.includes('无法识别')), 'M3 无法识别的确认结果 warning');
eq(itemOf(rr.j, 'H1').confirmed, null, 'M4 无法识别的确认结果不写入，仍为 null');
const confNoBy = path.join(work, 'conf-noby.json');
fs.writeFileSync(confNoBy, JSON.stringify([{ ruleId: 'H1', confirmed: '是' }]), 'utf8');
rr = run([...lowArgs, '--confirm', confNoBy], 'm-noby');
ok(rr.j.warnings.some((w) => w.includes('未填确认人')), 'M5 缺确认人 warning');

// ============ N. 产出结构完整性 ============
r = run([...BASE, '--pressured', '是', '--hot', '否', '--no-entry', '--no-hotwork', '--workshop', '加氢车间', '--plan-date', '2026-09-25'], 'n-out');
ok(fs.existsSync(path.join(r.out, 'handover.json')), 'N1 handover.json 已写入');
ok(fs.existsSync(path.join(r.out, 'handover.md')), 'N2 handover.md 已写入');
ok(fs.existsSync(path.join(r.out, 'summary.json')), 'N3 summary.json 已写入');
eq(JSON.parse(fs.readFileSync(path.join(r.out, 'summary.json'), 'utf8')).ok, true, 'N4 summary.json 内容正确');
ok(/## 一、设备与作业信息/.test(r.md) && /## 二、关键条目/.test(r.md) && /## 三、交出条件逐项确认/.test(r.md)
  && /## 四、未判定项/.test(r.md) && /## 五、未完成项/.test(r.md) && /## 六、交出确认签字/.test(r.md), 'N5 六节结构齐全');
ok(/\| 工艺（操作） \|/.test(r.md) && /\| 设备（车间设备员） \|/.test(r.md) && /\| 安全 \|/.test(r.md) && /\| 检修（承修单位） \|/.test(r.md), 'N6 签字栏含工艺（操作）/设备（车间设备员）/安全/检修（承修单位）四方');
eq(r.j.meta.workshop, '加氢车间', 'N7 车间写入 meta');
eq(r.j.meta.planDate, '2026-09-25', 'N8 计划检修日期写入 meta');
eq(r.j.counts.total, r.j.items.length, 'N9 counts.total 与条目数一致');
ok(r.j.items.every((x, i) => x.no === i + 1), 'N10 条目序号连续');
ok(r.md.includes('北京时间'), 'N11 生成时间标注北京时间');

// ============ O. 中石化口径：介质库扩充、SAP 列名、用火/盲板抽堵术语、无 emoji ============
eq(R.classifyMedium('乙二醇').level, 'medium', 'O1 乙二醇→中危');
eq(R.classifyMedium('EO/EG').level, 'high', 'O2 EO/EG 按环氧乙烷→高危');
eq(R.classifyMedium('环氧乙烷').key, '环氧乙烷（EO）', 'O3 环氧乙烷专名先于低碳烃命中');
eq(R.classifyMedium('苯乙烯').key, '苯乙烯', 'O4 苯乙烯专名先于芳烃命中');
eq(R.classifyMedium('氯气').level, 'high', 'O5 氯气→高危');
eq(R.classifyMedium('混合碳四').level, 'high', 'O6 混合碳四→高危');
eq(R.classifyMedium('裂解汽油').level, 'high', 'O7 裂解汽油→高危');
eq(R.classifyMedium('乙醇胺').level, 'medium', 'O8 乙醇胺归胺液（中危），不被醇类误判');
eq(R.classifyMedium('对二甲苯').level, 'high', 'O9 对二甲苯→高危');
// SAP PM 导出列名台账（功能位置 / 设备 / 设备描述 / 对象类型）
const sap = mk('sap-ledger.xlsx', {
  '设备台账': [
    ['功能位置', '设备', '设备描述', '对象类型', '操作介质', '操作温度', '操作压力'],
    ['P-9105A', '10012345', '碳四进料泵A', '离心泵', '混合碳四', 40, 1.2],
    ['V-9405', '10012346', '乙二醇中间罐', '立式容器', '乙二醇', 80, 0.3],
  ],
});
r = run(['--tag', 'P-9105A', '--scope', '机封更换', '--ledger', sap, '--no-entry', '--no-hotwork', '--pressured', '是', '--hot', '否'], 'o-sap');
eq(r.j.meta.name, '碳四进料泵A', 'O10 SAP「设备描述」列补全设备名称');
eq(r.j.meta.equipKey, 'pump', 'O11 SAP「对象类型」列补全设备类型');
eq(r.j.meta.medium, '混合碳四', 'O12 「操作介质」列补全介质');
eq(r.j.meta.mediumHazard, 'high', 'O13 碳四按高危生成');
r = run(['--tag', '10012346', '--scope', '内壁检查', '--ledger', sap, '--no-entry', '--no-hotwork', '--pressured', '否', '--hot', '否'], 'o-sapno');
eq(r.j.meta.name, '乙二醇中间罐', 'O14 用 SAP 8 位设备编号也能命中台账行');
ok(!r.j.warnings.some((w) => w.includes('不在设备台账')), 'O15 设备编号命中时无「不在台账」warning');
// 用火 / 盲板抽堵 / 双监护术语
r = run(['--tag', 'E-9204', '--equip-type', '换热器', '--medium', '蜡油', '--scope', '法兰焊接', '--hotwork', '--entry', '--pressured', '是', '--hot', '是'], 'o-fire');
ok(/用火作业/.test(r.md), 'O16 md 使用「用火作业」');
ok(!/动火/.test(r.md), 'O17 md 不再出现「动火」');
ok(/盲板抽堵作业许可/.test(itemOf(r.j, 'H3').title), 'O18 H3 提示办理盲板抽堵作业许可');
ok(/中国石化作业许可管理规定/.test(itemOf(r.j, 'S2').title), 'O19 S2 的 15 米做法注明出处为中石化用火作业规定');
ok(/双监护/.test(itemOf(r.j, 'Q5').title), 'O20 Q5 写明双监护');
eq(r.j.meta.permits.join(','), '用火作业,受限空间作业,盲板抽堵作业', 'O21 作业许可提示按八大类命名');
ok(/涉及作业许可 \| 用火作业、受限空间作业、盲板抽堵作业/.test(r.md), 'O22 md 设备信息表列出涉及的作业许可');
ok(r.j.warnings.some((w) => w.includes('受限空间与用火作业')), 'O23 高风险组合 warning 用「用火作业」');
ok(!/40 ℃|35 ℃/.test(itemOf(r.j, 'P2').title), 'O24 降温条目不写具体温度数值，以厂内制度为准');
r2 = run(lowArgs, 'o-low');
eq(r2.j.meta.permits.length, 0, 'O25 低危水泵不进人不用火不加盲板时无作业许可提示');
ok(!/[\u26A0\u2705\u274C\u2714\u2716\u{1F300}-\u{1FAFF}]/u.test(r.md) && !/[\u26A0\u2705\u274C\u2714\u2716\u{1F300}-\u{1FAFF}]/u.test(r2.md), 'O26 md 不含 ⚠/✅/❌ 等 emoji 符号（勾选框 ☐ 除外）');
ok(/【注意】尚不具备交出条件/.test(r.md), 'O27 醒目提示用「【注意】」');

// ---- 输出
console.log(`\n${'='.repeat(56)}`);
console.log(`equipment-handover-check 自测：${pass} 通过，${fail} 失败`);
if (failures.length) { console.log('\n失败项：'); failures.forEach((f) => console.log('  ✗ ' + f)); }
console.log('='.repeat(56));
try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
