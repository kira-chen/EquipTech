#!/usr/bin/env node
'use strict';
/** 自测：断言 intake.js 与 rules.js 行为。用法：node scripts/selftest.js（全绿退出 0） */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { writeXlsx } = require('./lib/xlsx-lite');
const R = require('./lib/rules');

const INTAKE = path.join(__dirname, 'intake.js');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-selftest-'));
const DATE = '2026-09-21';
let pass = 0, fail = 0;
const failures = [];
const ok = (c, n) => { if (c) pass++; else { fail++; failures.push(n); } };
const eq = (a, e, n) => ok(a === e, `${n}（期望 ${JSON.stringify(e)}，实际 ${JSON.stringify(a)}）`);

function run(args, tag) {
  const out = path.join(work, tag + '-out');
  const r = spawnSync(process.execPath, [INTAKE, ...args, '--out', out], { encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  let s; try { s = JSON.parse(lines[lines.length - 1]); } catch (e) { s = { ok: false, error: 'no-json:' + r.stdout + r.stderr }; }
  let j = null, md = null, csv = null;
  if (fs.existsSync(path.join(out, 'defects.json'))) j = JSON.parse(fs.readFileSync(path.join(out, 'defects.json'), 'utf8'));
  if (fs.existsSync(path.join(out, 'defects.md'))) md = fs.readFileSync(path.join(out, 'defects.md'), 'utf8');
  if (fs.existsSync(path.join(out, 'ledger.csv'))) csv = fs.readFileSync(path.join(out, 'ledger.csv'), 'utf8');
  return { code: r.status, s, j, md, csv, out };
}
const mk = (n, b) => { const p = path.join(work, n); writeXlsx(p, b); return p; };

// ============ A. 规则引擎单元测试 ============
function g(desc, medium, affects) {
  return R.grade({ phenomenon: R.classifyPhenomenon(desc), mediumHazard: R.mediumHazard(medium), affectsRun: R.parseAffects(affects), desc });
}
eq(g('机封泄漏', '液化气', '否').level, 'A', 'A1 高危介质泄漏→A级（默认 abc 方案）');
eq(g('机封泄漏', '液化气', '否').ruleId, 'R2', 'A2 命中规则R2');
eq(g('塔壁有裂纹', '汽油', '否').level, 'A', 'A3 高危介质结构失效→A级');
eq(g('泵抽空打不上量', '柴油', '是').level, 'B', 'A4 影响运行+中危→B级');
eq(g('换热器泄漏', '柴油', '否').level, 'B', 'A5 中危介质泄漏→B级');
eq(g('筒体变形', '循环水', '否').level, 'B', 'A6 结构失效（低危）→B级');
eq(g('泵振动偏高', '柴油', '否').level, 'C', 'A7 振动不影响运行→C级');
eq(g('法兰渗漏', '循环水', '否').level, 'C', 'A8 低危介质泄漏→C级');
eq(g('外壁锈蚀', '除盐水', '否').level, 'C', 'A9 腐蚀不影响运行→C级（旧 IV 并入 C）');
eq(g('机封泄漏', '液化气', '否').levelCn, 'A 级（重大）', 'A9a 中文等级名 A 级（重大）');
eq(g('机封泄漏', '液化气', '否').sapPriority, 1, 'A9b A 级→SAP 优先级 1');
eq(g('换热器泄漏', '柴油', '否').sapPriority, 2, 'A9c B 级→SAP 优先级 2');
eq(g('泵振动偏高', '柴油', '否').sapPriority, 3, 'A9d C 级→SAP 优先级 3');
// 旧四级方案仍可用
const giv = (d, m, af) => R.grade({ phenomenon: R.classifyPhenomenon(d), mediumHazard: R.mediumHazard(m), affectsRun: R.parseAffects(af), desc: d }, { scheme: 'iv' });
eq(giv('机封泄漏', '液化气', '否').level, 'I', 'A9e iv 方案高危泄漏→I级');
eq(giv('外壁锈蚀', '除盐水', '否').level, 'IV', 'A9f iv 方案腐蚀→IV级');
eq(giv('外壁锈蚀', '除盐水', '否').dueDays, 30, 'A9g iv 方案 IV 级 30 天');
eq(giv('外壁锈蚀', '除盐水', '否').sapPriority, 4, 'A9h iv 方案 IV 级→SAP 优先级 4');
// 介质：含硫污水/酸性水/含油污水 为中危，不按"水"归低危
eq(R.mediumHazard('含硫污水'), 'medium', 'A9i 含硫污水→中危');
eq(R.mediumHazard('酸性水'), 'medium', 'A9j 酸性水→中危');
eq(R.mediumHazard('含油污水'), 'medium', 'A9k 含油污水→中危');
eq(R.mediumHazard('循环水'), 'low', 'A9l 循环水仍为低危');
// --due 覆盖解析
eq(R.parseDueOverride('A=0.5,B=2,C=10').due.C, 10, 'A9m --due 覆盖 C 级时限');
eq(R.parseDueOverride('A=0.5,B=2,C=10').due.A, 0.5, 'A9n --due 支持小数天');
ok(R.parseDueOverride('X=1').errors.length === 1, 'A9o --due 未知等级报错');
ok(R.parseDueOverride('A=1', 'iv').errors.length === 1, 'A9p --due 等级须属于所选方案');
eq(R.grade({ phenomenon: 'leak', mediumHazard: 'high', affectsRun: false, desc: '' }, { due: { A: 2, B: 3, C: 7 } }).dueDays, 2, 'A9q grade 使用覆盖后的时限');
// 通知单类型建议
eq(R.notificationType('A', false), 'M2', 'A9r A 级→M2 故障报告');
eq(R.notificationType('C', false), 'M1', 'A9s C 级不影响运行→M1 维修申请');
eq(R.notificationType('C', true), 'M2', 'A9t C 级但影响运行→M2');
eq(R.notificationType('undetermined', null), null, 'A9u 未判定不给通知单类型');
// undetermined 是核心：缺字段绝不默认
eq(g('机封泄漏', '液化气', '').level, 'undetermined', 'A10 影响运行未填→未判定');
eq(g('机封泄漏', '液化气', '').ruleId, 'U1', 'A11 未判定规则U1');
eq(g('机封泄漏', '', '否').level, 'undetermined', 'A12 泄漏但介质未填→未判定');
eq(g('机封泄漏', '未知介质XYZ', '否').level, 'undetermined', 'A13 介质不在库→未判定');
eq(g('泵振动偏高', '', '否').level, 'C', 'A14 振动类不需介质→可定级');
eq(g('机封泄漏', '液化气', '').dueDays, null, 'A15 未判定无处理时限');
ok(g('机封泄漏', '液化气', '').missing.includes('是否影响运行'), 'A16 未判定列出缺失字段');
eq(R.mediumHazard(''), null, 'A17 空介质返回null不是low');
eq(R.parseAffects(''), null, 'A18 空影响返回null不是false');
eq(R.parseAffects('否'), false, 'A19 否解析为false');
eq(R.parseAffects('是'), true, 'A20 是解析为true');
eq(R.disciplineOf('P-101A', '进料泵'), '动设备', 'A21 专业归属-动设备');
eq(R.disciplineOf('E-201', '换热器'), '静设备', 'A22 专业归属-静设备');
eq(R.disciplineOf('XYZ-999', '不明设备'), '待定', 'A23 无法归属→待定');
eq(R.disciplineOf('EM-2502', '循环水泵B电机'), '电气', 'A24 EM- 电机不被"泵"抢成动设备');
eq(R.disciplineOf('M-301', '进料泵电机'), '电气', 'A25 M- 位号归电气');
eq(R.disciplineOf('P-301', '进料泵（电机拖动）'), '电气', 'A26 名称含电机→电气（由设备员确认）');
eq(R.disciplineOf('PSV-2503', '液化气球罐安全阀'), '静设备', 'A27 安全阀归静设备不归仪表');
eq(R.disciplineOf('', '塔顶疏水阀'), '静设备', 'A28 疏水阀归静设备');
eq(R.disciplineOf('FV-101', '进料调节阀'), '仪表', 'A29 调节阀仍归仪表');
eq(R.disciplineOf('K-101', '富气压缩机'), '动设备', 'A30 K- 压缩机归动设备');

// ============ B. 单条登记 ============
let r = run(['--desc', '机封处持续滴漏约5滴/分', '--tag', 'P-101A', '--medium', '液化气',
  '--affects-run', '否', '--found-at', '2026-09-21T08:20:00+08:00', '--by', '甲班王'], 'single');
eq(r.s.ok, true, 'B1 单条登记成功');
eq(r.s.counts.total, 1, 'B2 登记 1 条');
eq(r.j.defects[0].level, 'A', 'B3 定级为 A 级');
ok(/^QX-\d{8}-001$/.test(r.j.defects[0].no), 'B4 缺陷编号格式');
eq(r.j.defects[0].dueDays, 1, 'B5 A级时限1天');
ok(r.j.defects[0].dueDate === '2026-09-22', 'B6 处理期限日期正确');
ok(/规则 R2/.test(r.md), 'B7 md 标注命中规则号');
ok(/\*\*A 级（重大）\*\*/.test(r.md), 'B8 等级加粗显示（A 级）');
ok(!/I 级（紧急）/.test(r.md), 'B8a 默认不出现旧四级名称');
ok(/分级方案：A\/B\/C 三级/.test(r.md), 'B8b md 标注分级方案');
ok(r.md.includes('本材料由脚本汇总、模型成文，仅供设备员复核参考'), 'B8c 声明行写入 md');
ok(/【注意】建议处理时限为经验默认值/.test(r.md), 'B8d 时限默认值提示');
ok(/## 五、维修通知单草稿/.test(r.md), 'B8e 通知单草稿一节');
ok(/通知单号由 SAP 系统生成/.test(r.md), 'B8f 声明通知单号由 SAP 生成');
ok(!/[\u2705\u26a0\ufe0f]/.test(r.md), 'B8g md 不含 emoji');
ok(fs.existsSync(path.join(r.out, 'notification.csv')), 'B8h notification.csv 生成');
const ncsv = fs.readFileSync(path.join(r.out, 'notification.csv'), 'utf8');
ok(ncsv.charCodeAt(0) === 0xFEFF, 'B8i notification.csv 带 BOM');
ok(/功能位置.*设备编号.*通知单类型.*优先级.*故障代码.*长文本.*要求开始.*要求结束/.test(ncsv.split('\n')[0]), 'B8j 通知单草稿 SAP 列头');
ok(/"M2","1"/.test(ncsv), 'B8k A 级→M2、优先级 1');
eq(r.j.defects[0].notification.requiredEnd, '2026-09-22', 'B8l 要求结束=处理期限');
eq(r.j.meta.gradingScheme, 'abc', 'B8m meta 记录分级方案');
// --found-at 接受本地时间
r = run(['--desc', '机封泄漏', '--tag', 'P-101A', '--medium', '液化气', '--affects-run', '否', '--found-at', '2026-09-21 08:20'], 'localtime');
eq(r.s.ok, true, 'B8n --found-at 接受北京时间写法');
eq(r.j.defects[0].foundAt, '2026-09-21 08:20', 'B8o 本地时间解析正确');
// --grading-scheme iv
r = run(['--desc', '外壁锈蚀', '--tag', 'V-1', '--medium', '除盐水', '--affects-run', '否', '--grading-scheme', 'iv'], 'iv');
eq(r.j.defects[0].level, 'IV', 'B8p --grading-scheme iv 仍可用');
ok(/IV 级（轻微）/.test(r.md), 'B8q iv 方案 md 显示旧等级');
r = run(['--desc', '外壁锈蚀', '--tag', 'V-1', '--medium', '除盐水', '--affects-run', '否', '--grading-scheme', 'xyz'], 'badscheme');
eq(r.s.ok, false, 'B8r 未知分级方案报错');
// --due 覆盖生效
r = run(['--desc', '外壁锈蚀', '--tag', 'V-1', '--medium', '除盐水', '--affects-run', '否', '--found-at', '2026-09-21 08:00', '--due', 'C=15'], 'due');
eq(r.j.defects[0].dueDays, 15, 'B8s --due 覆盖 C 级时限');
eq(r.j.defects[0].dueDate, '2026-10-06', 'B8t 覆盖后期限日期随之变化');
r = run(['--desc', 'x', '--tag', 'V-1', '--due', 'Z=1'], 'baddue');
eq(r.s.ok, false, 'B8u --due 非法报错');
// 单条可带功能位置与设备编号
r = run(['--desc', '机封泄漏', '--tag', 'P-101A', '--medium', '液化气', '--affects-run', '否', '--func-loc', 'A1-U100-P101A', '--equip-no', '10001234'], 'funcloc');
ok(/"A1-U100-P101A","10001234"/.test(fs.readFileSync(path.join(r.out, 'notification.csv'), 'utf8')), 'B8v 通知单草稿带功能位置与设备编号');

// found-at 非法 → 报错
r = run(['--desc', 'x', '--tag', 'P-1', '--found-at', '昨天下午'], 'badtime');
eq(r.s.ok, false, 'B9 非法时间报错');
eq(r.code, 1, 'B10 退出码1');
ok(/ISO 8601/.test(r.s.error), 'B11 错误信息提示格式');

// ============ C. 批量登记 ============
const batch = mk('batch.xlsx', {
  '缺陷记录': [
    ['位号', '设备名称', '缺陷描述', '介质', '是否影响运行', '发现时间', '发现人'],
    ['P-01', '泵1', '机封泄漏', '液化气', '否', `${DATE} 08:00`, '王'],
    ['P-02', '泵2', '振动偏高', '柴油', '否', `${DATE} 08:10`, '王'],
    ['P-03', '泵3', '出口法兰渗漏', '', '', `${DATE} 08:20`, '王'],
    ['', '无位号', '异响', '柴油', '否', `${DATE} 08:30`, '王'],
  ],
});
r = run(['--input', batch], 'batch');
eq(r.s.ok, true, 'C1 批量登记成功');
eq(r.s.counts.total, 3, 'C2 空位号行被跳过');
ok(r.j.warnings.some((w) => w.includes('位号为空')), 'C3 空位号 warning');
eq(r.s.counts.undetermined, 1, 'C4 未判定 1 条');
ok(r.j.undetermined[0].tag === 'P-03', 'C5 未判定为 P-03');
ok(/## 三、未判定清单/.test(r.md), 'C6 未判定单列一节');
ok(r.j.defects.every((d) => d.no), 'C7 每条都有编号');
ok(new Set(r.j.defects.map((d) => d.no)).size === 3, 'C8 编号不重复');
eq(r.s.counts.notificationDrafts, 2, 'C9 未判定不进入通知单草稿');
ok(/【未判定】/.test(r.md), 'C10 未判定节带【未判定】提示');
eq(r.j.defects.find((d) => d.tag === 'P-03').notification.type, null, 'C11 未判定缺陷无通知单类型');

// ============ D. 查重 ============
const led = mk('led.xlsx', {
  '缺陷台账': [
    ['缺陷编号', '位号', '缺陷描述', '状态'],
    ['QX-001', 'P-01', '机封处有滴漏', '处理中'],
    ['QX-002', 'P-02', '机封处有滴漏', '已闭环'],
  ],
});
// SAP 通知单列名台账：NOPR 未闭环参与查重，NOCO 已完成不参与，"未关闭"不按闭环
const ledSap = mk('led-sap.xlsx', {
  '通知单': [
    ['通知单', '功能位置', '通知单短文本', '系统状态'],
    ['10000001', 'P-01', '机封处有滴漏', 'NOPR'],
    ['10000002', 'P-02', '振动偏高', 'NOCO'],
    ['10000003', 'P-03', '出口法兰渗漏', '未关闭'],
  ],
});
r = run(['--input', batch, '--ledger', led], 'dup');
eq(r.s.counts.possibleDuplicate, 1, 'D1 检出 1 条疑似重复');
eq(r.j.possibleDuplicate[0].tag, 'P-01', 'D2 疑似重复位号正确');
ok(r.j.possibleDuplicate[0].similar[0].no === 'QX-001', 'D3 匹配到台账编号');
ok(r.j.possibleDuplicate[0].similar[0].score >= 0.45, 'D4 相似度达阈值');
ok(/疑似与台账中未闭环缺陷（或通知单）重复/.test(r.md), 'D5 md 提示需确认');
ok(r.j.defects.length === 3, 'D6 疑似重复不自动剔除（仍登记）');
// 已闭环的不参与查重
ok(!r.j.possibleDuplicate.some((p) => p.similar.some((s) => s.no === 'QX-002')), 'D7 已闭环缺陷不参与查重');
r = run(['--input', batch, '--ledger', ledSap], 'dupsap');
eq(r.s.ok, true, 'D8 SAP 通知单列名台账可读（通知单/功能位置/短文本/系统状态）');
ok(r.j.possibleDuplicate.some((p) => p.tag === 'P-01' && p.similar[0].no === '10000001'), 'D9 NOPR 通知单参与查重');
ok(r.j.possibleDuplicate.find((p) => p.tag === 'P-01').similar[0].statusNorm === '已派工', 'D10 状态按 normSapStatus 归一');
ok(!r.j.possibleDuplicate.some((p) => p.tag === 'P-02'), 'D11 NOCO 已完成不参与查重');
ok(r.j.possibleDuplicate.some((p) => p.tag === 'P-03'), 'D12 "未关闭"按未闭环参与查重（否定前缀先判）');

// ============ E. 设备台账校验 ============
const eq_led = mk('eqled.xlsx', {
  '设备台账': [['功能位置', '设备', '设备描述', '介质'], ['P-01', '10000101', '进料泵1', '液化气'], ['P-02', '10000102', '回流泵2', '柴油']],
});
const noMedium = mk('nomedium.xlsx', {
  '缺陷记录': [
    ['位号', '缺陷描述', '介质', '是否影响运行', '发现时间'],
    ['P-01', '机封泄漏', '', '否', `${DATE} 08:00`],
    ['P-99', '机封泄漏', '', '否', `${DATE} 08:10`],
  ],
});
r = run(['--input', noMedium, '--equip-ledger', eq_led], 'eqled');
eq(r.j.defects[0].medium, '液化气', 'E1 从台账补全介质');
eq(r.j.defects[0].level, 'A', 'E2 补全后可定级');
ok(r.j.warnings.some((w) => w.includes('P-99') && w.includes('不在设备台账')), 'E3 位号不在台账 warning');
eq(r.j.defects[1].level, 'undetermined', 'E4 台账查不到且介质空→未判定');
eq(r.j.defects[0].equipNo, '10000101', 'E5 SAP 台账"设备"列补出设备编号（不当位号）');
eq(r.j.defects[0].name, '进料泵1', 'E6 SAP"设备描述"补出设备名称');

// ============ F. 产出完整性 ============
r = run(['--input', batch], 'outputs');
ok(fs.existsSync(path.join(r.out, 'defects.json')), 'F1 defects.json 生成');
ok(fs.existsSync(path.join(r.out, 'defects.md')), 'F2 defects.md 生成');
ok(fs.existsSync(path.join(r.out, 'ledger.csv')), 'F3 ledger.csv 生成');
ok(fs.existsSync(path.join(r.out, 'summary.json')), 'F4 summary.json 生成');
ok(/## 一、登记概览/.test(r.md) && /## 二、缺陷单/.test(r.md) && /## 三、未判定清单/.test(r.md) && /## 四、疑似重复清单/.test(r.md) && /## 五、维修通知单草稿/.test(r.md), 'F5 五节结构齐全');
ok(r.csv.split('\n')[0].includes('设备编号'), 'F5a ledger.csv 含设备编号列');
ok(r.csv.charCodeAt(0) === 0xFEFF, 'F6 CSV 带 BOM（Excel 中文不乱码）');
ok(r.csv.includes('定级依据'), 'F7 CSV 含定级依据列');
const mdUnd = r.md.match(/## 一、登记概览[\s\S]*?## 二/)[0];
eq((mdUnd.match(/未判定/g) || []).length, 1, 'F8 概览表未判定不重复出现');

// ============ G. 参数校验 ============
function raw(args) {
  const x = spawnSync(process.execPath, [INTAKE, ...args], { encoding: 'utf8' });
  const l = x.stdout.trim().split('\n');
  try { return { code: x.status, s: JSON.parse(l[l.length - 1]) }; } catch (e) { return { code: x.status, s: { ok: false } }; }
}
eq(raw([]).s.ok, false, 'G1 无参数报错');
eq(raw(['--desc']).s.ok, false, 'G2 --desc 缺值报错');
ok(/缺少取值/.test(raw(['--desc']).s.error), 'G3 缺值信息正确');
eq(raw(['--desc', 'x']).s.ok, false, 'G4 单条缺 --tag 报错');
eq(raw(['--input', '/不存在.xlsx']).s.ok, false, 'G5 输入不存在报错');
eq(raw(['--desc', 'x', '--tag', 'P', '--未知', 'v']).s.ok, false, 'G6 未知参数报错');
eq(raw(['--input', mk('empty.xlsx', { '别的表': [['a'], [1]] })]).s.ok, false, 'G7 无缺陷记录表报错');

// ============ H. 合计行与别名列头 ============
const alias = mk('alias.xlsx', {
  '缺陷记录': [
    ['某厂缺陷登记导出'],
    [],
    ['设备位号', '名称', '现象', '物料', '影响生产', '发现日期'],
    ['P-01', '泵1', '机封泄漏', '液化气', '否', `${DATE} 08:00`],
    ['合计', '', '', '', '', ''],
  ],
});
r = run(['--input', alias], 'alias');
eq(r.s.ok, true, 'H1 别名列头可读');
eq(r.s.counts.total, 1, 'H2 合计行被跳过');
ok(r.j.warnings.some((w) => w.includes('合计行')), 'H3 合计行 warning');
const sap = mk('sap.xlsx', {
  '通知单': [
    ['功能位置', '设备', '设备描述', '对象部件', '通知单短文本', '介质', '故障停机', '通知日期', '报告人'],
    ['P-11', '10000011', '酸性水泵', '机械密封', '机封泄漏', '含硫污水', '否', `${DATE} 07:50`, '刘'],
    ['EM-12', '10000012', '泵电机', '轴承', '轴承异响', '', '否', `${DATE} 08:00`, '刘'],
  ],
});
r = run(['--input', sap], 'sap');
eq(r.s.ok, true, 'H4 SAP 通知单导出列名可读');
eq(r.s.counts.total, 2, 'H5 SAP 样式 2 条全部登记');
eq(r.j.defects[0].equipNo, '10000011', 'H6 "设备"列作设备编号');
eq(r.j.defects[0].part, '机械密封', 'H7 "对象部件"作缺陷部位');
eq(r.j.defects[0].level, 'B', 'H8 含硫污水泄漏→B 级（中危）');
eq(r.j.defects[0].foundAt, `${DATE} 07:50`, 'H9 "通知日期"作发现时间');
eq(r.j.defects[0].by, '刘', 'H10 "报告人"作发现人');
eq(r.j.defects[1].discipline, '电气', 'H11 EM- 位号归电气');
// examples 样例预期计数
const EX = path.join(__dirname, '..', 'examples');
if (fs.existsSync(path.join(EX, 'sample-sap-notification-export.xlsx'))) {
  r = run(['--input', path.join(EX, 'sample-sap-notification-export.xlsx')], 'ex-sap');
  eq(r.s.counts.total, 4, 'H12 examples SAP 样例 4 条');
  eq(r.s.counts.undetermined, 1, 'H13 examples SAP 样例未判定 1');
  eq(r.s.counts.byLevel['A 级（重大）'], 1, 'H14 examples SAP 样例 A 级 1（安全阀液化气内漏）');
  r = run(['--input', path.join(EX, 'sample-defects-2026-09-21.xlsx'), '--ledger', path.join(EX, 'sample-defect-ledger.xlsx')], 'ex-main');
  eq(r.s.counts.byLevel['A 级（重大）'], 2, 'H15 examples 主样例 A 级 2');
  eq(r.s.counts.byLevel['C 级（一般）'], 2, 'H16 examples 主样例 C 级 2');
  eq(r.s.counts.possibleDuplicate, 1, 'H17 examples 主样例配 SAP 台账查重 1 条');
}

console.log(`\n${'='.repeat(56)}`);
console.log(`defect-intake-grading 自测：${pass} 通过，${fail} 失败`);
if (failures.length) { console.log('\n失败项：'); failures.forEach((f) => console.log('  ✗ ' + f)); }
console.log('='.repeat(56));
try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
