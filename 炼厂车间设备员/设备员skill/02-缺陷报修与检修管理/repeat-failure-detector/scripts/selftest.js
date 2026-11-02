#!/usr/bin/env node
'use strict';
/**
 * 自测：生成变体输入并断言 detect.js 与 lib/detect-rules.js 行为。用法：node scripts/selftest.js（全绿退出 0）
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { writeXlsx } = require('./lib/xlsx-lite');
const C = require('./lib/common');
const R = require('./lib/detect-rules');

const DETECT = path.join(__dirname, 'detect.js');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rfd-selftest-'));
const TO = '2026-09-21';
const FROM = '2025-09-22';
const d = (n) => C.addDays(TO, -n);
let pass = 0, fail = 0;
const failures = [];

function ok(cond, name) { if (cond) { pass++; } else { fail++; failures.push(name); } }
function eq(actual, expect, name) { ok(actual === expect, `${name}（期望 ${JSON.stringify(expect)}，实际 ${JSON.stringify(actual)}）`); }

function run(file, extra = [], tag) {
  const out = path.join(work, (tag || path.basename(file, '.xlsx')) + '-out');
  const r = spawnSync(process.execPath, [DETECT, '--input', file, '--workshop', '测试车间',
    '--from', FROM, '--to', TO, '--out', out, ...extra], { encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  let summary;
  try { summary = JSON.parse(lines[lines.length - 1]); } catch (e) { summary = { ok: false, error: 'no-json:' + r.stdout + r.stderr }; }
  let json = null, md = null;
  if (fs.existsSync(path.join(out, 'repeats.json'))) json = JSON.parse(fs.readFileSync(path.join(out, 'repeats.json'), 'utf8'));
  if (fs.existsSync(path.join(out, 'repeats.md'))) md = fs.readFileSync(path.join(out, 'repeats.md'), 'utf8');
  return { code: r.status, summary, json, md, out };
}
function runRaw(args) {
  const r = spawnSync(process.execPath, [DETECT, ...args], { encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  try { return { code: r.status, s: JSON.parse(lines[lines.length - 1]) }; } catch (e) { return { code: r.status, s: { ok: false, error: 'no-json' } }; }
}
function mk(name, book) { const p = path.join(work, name); writeXlsx(p, book); return p; }

const HEAD = ['工单号', '位号', '设备名称', '型号', '设备类型', '故障部位', '故障现象', '故障时间', '处理方式'];

// ================================================================ 1. 规则引擎单元测试：无信息描述
const U = (s) => R.checkInformative(s);
eq(U('').uninformative, true, '1.1 空描述判为无信息');
eq(U('   ').uninformative, true, '1.2 纯空白判为无信息');
eq(U('故障').uninformative, true, '1.3 只写「故障」判为无信息');
eq(U('坏了').uninformative, true, '1.4 只写「坏了」判为无信息');
eq(U('设备故障').uninformative, true, '1.5 「设备故障」去泛指词后无信息');
eq(U('有问题').uninformative, true, '1.6 「有问题」判为无信息');
eq(U('待查').uninformative, true, '1.7 「待查」判为无信息');
eq(U('/').uninformative, true, '1.8 占位符「/」判为无信息');
eq(U('机封泄漏').uninformative, false, '1.9 「机封泄漏」有信息量');
eq(U('机封故障').uninformative, false, '1.10 「机封故障」含具体部位，有信息量');
eq(U('振动偏高并伴有异响').uninformative, false, '1.11 完整描述有信息量');
ok(U('').reason.includes('为空'), '1.12 空描述原因标注为空');
ok(U('故障').reason.includes('故障'), '1.13 泛指描述原因写明原文');

// ================================================================ 2. 规则引擎：现象分类与部位归一
eq(R.classifyPhenomenon('机封处滴漏'), 'leak', '2.1 滴漏归为泄漏');
eq(R.classifyPhenomenon('管束内漏，串油'), 'leak', '2.2 内漏串油归为泄漏');
eq(R.classifyPhenomenon('振动偏高'), 'vibration', '2.3 振动归类');
eq(R.classifyPhenomenon('轴承温度偏高'), 'temperature', '2.4 温度偏高归为温升');
eq(R.classifyPhenomenon('盘车沉重'), 'seize', '2.5 盘车沉重归为卡涩');
eq(R.classifyPhenomenon('说不清楚'), 'other', '2.6 无法归类返回 other');
eq(R.normPart('机封'), '机械密封', '2.7 机封归一为机械密封');
eq(R.normPart('轴瓦'), '轴承', '2.8 轴瓦归一为轴承');
eq(R.normPart('换热管'), '管束', '2.9 换热管归一为管束');
eq(R.normPart(''), null, '2.10 空部位返回 null，不参与同部位判定');
eq(R.normPart('某个稀奇部位'), '某个稀奇部位', '2.11 不在归一表内按原文');

// ================================================================ 3. 规则引擎：相似度与 matchBasis
const simA = { desc: '机封处滴漏，约5滴/分', part: '机封', phenomenon: 'leak' };
const simB = { desc: '机封泄漏，滴漏约3滴/分', part: '机械密封', phenomenon: 'leak' };
const simC = { desc: '轴承温度偏高', part: '轴承', phenomenon: 'temperature' };
const s1 = R.similarity(simA, simB);
const s2 = R.similarity(simA, simC);
ok(s1.score > s2.score, '3.1 相似记录得分高于不相似记录');
ok(s1.matchBasis.some((x) => x.includes('bigram')), '3.2 matchBasis 含文本 bigram 依据');
ok(s1.matchBasis.some((x) => x.includes('故障部位同为「机械密封」')), '3.3 matchBasis 写明同部位依据');
ok(s1.matchBasis.some((x) => x.includes('现象类型同为「泄漏」')), '3.4 matchBasis 写明同现象类型依据');
ok(R.similarity({ desc: 'x漏', part: '', phenomenon: 'leak' }, simB).matchBasis.some((x) => x.includes('故障部位字段有缺失')), '3.5 部位缺失时 matchBasis 明示未参与比对');
ok(s2.matchBasis.some((x) => x.includes('现象类型不同')), '3.6 现象类型不同时 matchBasis 明示');

// ================================================================ 4. 基础：同设备同部位 D1 与同现象 D2
const base = mk('base.xlsx', {
  '工单台账': [HEAD,
    ['G1', 'P-01', '泵1', 'M-A', '离心泵', '机械密封', '机封处滴漏，约5滴/分', d(300), '更换机封'],
    ['G2', 'P-01', '泵1', 'M-A', '离心泵', '机封', '机封泄漏，滴漏约3滴/分', d(200), '更换机封'],
    ['G3', 'P-01', '泵1', 'M-A', '离心泵', '填料密封', '机封处渗漏，有油迹', d(120), '更换机封'],
    ['G4', 'P-02', '泵2', 'M-B', '离心泵', '轴承', '振动偏高并有异响', d(150), '现场处理'],
    ['G5', 'P-02', '泵2', 'M-B', '离心泵', '轴瓦', '振动大有异响', d(60), '更换轴承'],
    ['G6', 'P-03', '泵3', 'M-C', '离心泵', '联轴器', '对轮胶块磨损', d(90), '更换胶块'],
  ],
});
let r = run(base, [], 'base');
eq(r.summary.ok, true, '4.1 基础运行成功');
eq(r.summary.counts.valid, 6, '4.2 参与判定记录数');
eq(r.summary.counts.equipment, 3, '4.3 涉及设备台数');
eq(r.summary.counts.repeatEquipment, 2, '4.4 命中重复故障设备数（P-01、P-02）');
const eq01 = r.json.byEquipment.find((x) => x.tag === 'P-01');
ok(!!eq01, '4.5 P-01 命中重复故障');
ok(eq01.hits.some((h) => h.ruleId === 'D1' && h.key === '机械密封' && h.count === 3), '4.6 D1 同部位 3 次（机封/填料密封归一）');
ok(eq01.hits.some((h) => h.ruleId === 'D2'), '4.7 D2 同现象命中');
const eq02 = r.json.byEquipment.find((x) => x.tag === 'P-02');
ok(eq02.hits.some((h) => h.ruleId === 'D1' && h.count === 2), '4.8 P-02 同部位（轴承/轴瓦归一）2 次，按默认口径「一年内 ≥2 次」命中 D1');
ok(eq02.hits.some((h) => h.ruleId === 'D2' && h.count === 2), '4.9 P-02 命中 D2 同现象 2 次');
ok(!r.json.byEquipment.some((x) => x.tag === 'P-03'), '4.10 单次故障设备不进重复清单');

// ================================================================ 5. matchBasis 必须写进 JSON 与 md
ok(eq01.hits.every((h) => Array.isArray(h.matchBasis) && h.matchBasis.length > 0), '5.1 每条命中都有 matchBasis');
ok(/判定依据（matchBasis）/.test(r.md), '5.2 md 中输出 matchBasis 一节');
ok(/bigram/.test(r.md), '5.3 md 中写明文本 bigram 依据');
ok(/不代表各次故障同因/.test(r.md), '5.4 md 声明相似不等于同因');

// ================================================================ 6. 硬约束：声明行与免责表述
ok(r.md.includes(R.DISCLAIMER), '6.1 md 保留声明行原文');
eq(r.json.meta.ruleDisclaimer, R.DISCLAIMER, '6.2 JSON meta 含规则声明行');
ok(r.md.includes('本材料由脚本汇总、模型成文，仅供设备员复核参考'), '6.2b md 含通用声明行');
ok(!/根本原因(是|为)/.test(r.md), '6.3 md 未给出根本原因结论');
ok(/需组织根因分析/.test(r.md), '6.4 md 只提示需要分析');

// ================================================================ 7. 无信息描述：单列且绝不据此判定重复
const vague = mk('vague.xlsx', {
  '故障记录': [
    ['位号', '设备名称', '故障部位', '故障现象', '故障时间'],
    ['P-11', '泵11', '', '故障', d(280)],
    ['P-11', '泵11', '', '坏了', d(200)],
    ['P-11', '泵11', '', '设备故障', d(120)],
    ['P-11', '泵11', '', '有问题', d(40)],
    ['P-12', '泵12', '', '', d(100)],
  ],
});
r = run(vague, [], 'vague');
eq(r.summary.ok, true, '7.1 全部描述无信息时仍正常出数');
eq(r.summary.counts.uninformative, 5, '7.2 5 条全部列入 uninformative');
eq(r.summary.counts.valid, 0, '7.3 无任何记录参与判定');
eq(r.summary.counts.repeatEquipment, 0, '7.4 **不得据无信息描述判定重复故障**');
eq(r.json.byEquipment.length, 0, '7.5 byEquipment 为空');
eq(r.json.byModel.length, 0, '7.6 byModel 为空');
eq(r.json.shorteningInterval.length, 0, '7.7 shorteningInterval 为空');
ok(r.json.uninformative.every((x) => x.ruleId === 'U1'), '7.8 无信息项规则号为 U1');
ok(r.json.uninformative.every((x) => x.reason && x.reason.length > 0), '7.9 每条注明无信息原因');
ok(r.json.uninformative.every((x) => x.note.includes('未参与')), '7.10 每条注明未参与判定');
ok(/六、故障现象无信息量清单/.test(r.md), '7.11 md 单列一节');
ok(/未据此判定为任何一类重复故障/.test(r.md), '7.12 md 明确不据此判定');
ok(r.json.warnings.some((w) => w.includes('无具体现象信息') || w.includes('为空')), '7.13 warning 具体到行');
ok(r.json.warnings.some((w) => /第\d+行/.test(w)), '7.14 warning 含行号');

// 混合场景：有信息的参与判定，无信息的被排除
const mixed = mk('mixed.xlsx', {
  '工单台账': [HEAD,
    ['G1', 'P-21', '泵21', 'M-A', '离心泵', '机械密封', '机封处滴漏', d(300), '更换'],
    ['G2', 'P-21', '泵21', 'M-A', '离心泵', '机封', '机封泄漏滴漏', d(200), '更换'],
    ['G3', 'P-21', '泵21', 'M-A', '离心泵', '机械密封', '故障', d(100), '更换'],
  ],
});
r = run(mixed, [], 'mixed');
eq(r.summary.counts.uninformative, 1, '7.15 混合场景无信息 1 条');
eq(r.summary.counts.valid, 2, '7.16 混合场景参与判定 2 条');
const mx = r.json.byEquipment.find((x) => x.tag === 'P-21');
const d1 = mx && mx.hits.find((h) => h.ruleId === 'D1');
ok(d1 && d1.count === 2, '7.17 同部位只剩 2 条有效记录计入 D1（无信息那条不补数，不是 3）');

// ================================================================ 8. 同型号共性故障 D3
const model = mk('model.xlsx', {
  '工单台账': [HEAD,
    ['G1', 'E-01', '换热器1', 'BES800', '换热器', '管束', '管束内漏，壳程串油', d(300), '堵管'],
    ['G2', 'E-02', '换热器2', 'BES800', '换热器', '换热管', '管束内漏，壳程发现油品', d(200), '堵管'],
    ['G3', 'E-01', '换热器1', 'BES800', '换热器', '列管', '管束内漏，串油', d(100), '堵管'],
    ['G4', 'V-01', '罐1', 'V-3000', '容器', '筒体', '外壁锈蚀', d(150), '除锈防腐'],
  ],
});
r = run(model, [], 'model');
eq(r.json.byModel.length, 1, '8.1 识别 1 组同型号共性故障');
const m1 = r.json.byModel[0];
eq(m1.ruleId, 'D3', '8.2 共性故障规则号 D3');
eq(m1.key, 'BES800', '8.3 共性故障型号键');
eq(m1.equipmentCount, 2, '8.4 涉及 2 台设备');
eq(m1.count, 3, '8.5 累计 3 次');
ok(m1.matchBasis.length > 0, '8.6 共性故障也给出 matchBasis');
ok(m1.note.includes('专项分析'), '8.7 共性故障注明须专项分析');
ok(/三、同型号\/同类设备共性故障/.test(r.md), '8.8 md 共性故障章节存在');

// 单台设备多次不算共性
const single = mk('single-model.xlsx', {
  '工单台账': [HEAD,
    ['G1', 'E-09', '换热器9', 'BES900', '换热器', '管束', '管束内漏串油', d(300), '堵管'],
    ['G2', 'E-09', '换热器9', 'BES900', '换热器', '管束', '管束内漏串油', d(200), '堵管'],
    ['G3', 'E-09', '换热器9', 'BES900', '换热器', '管束', '管束内漏串油', d(100), '堵管'],
  ],
});
r = run(single, [], 'single-model');
eq(r.json.byModel.length, 0, '8.9 仅 1 台设备时不判为共性故障');
eq(r.json.byEquipment.length, 1, '8.10 但仍计入同设备重复故障');

// ================================================================ 9. 故障频次排行与故障间隔
r = run(base, [], 'freq');
eq(r.json.topFrequency[0].tag, 'P-01', '9.1 频次排行按次数降序');
eq(r.json.topFrequency[0].count, 3, '9.2 排行首位次数正确');
ok(Array.isArray(r.json.byEquipment.find((x) => x.tag === 'P-01').intervals), '9.3 输出故障间隔序列');
eq(r.json.byEquipment.find((x) => x.tag === 'P-01').intervals.join(','), '100,80', '9.4 相邻故障间隔天数正确');
eq(r.json.byEquipment.find((x) => x.tag === 'P-01').avgInterval, 90, '9.5 平均间隔正确');
eq(r.json.byEquipment.find((x) => x.tag === 'P-01').minInterval, 80, '9.6 最短间隔正确');
eq(r.json.topFrequency.find((x) => x.tag === 'P-03').avgInterval, null, '9.7 只有 1 次故障时平均间隔为 null 不是 0');
ok(/四、故障频次排行/.test(r.md), '9.8 md 频次排行章节存在');
ok(/\| — \|/.test(r.md), '9.9 md 中 null 显示为「—」不是 0');

// ================================================================ 10. 故障间隔缩短 D4
const shrink = mk('shrink.xlsx', {
  '工单台账': [HEAD,
    ['G1', 'P-31', '泵31', 'M-A', '离心泵', '机械密封', '机封处滴漏', d(300), '更换'],
    ['G2', 'P-31', '泵31', 'M-A', '离心泵', '机械密封', '机封处滴漏', d(210), '更换'],
    ['G3', 'P-31', '泵31', 'M-A', '离心泵', '机械密封', '机封处滴漏', d(150), '更换'],
    ['G4', 'P-31', '泵31', 'M-A', '离心泵', '机械密封', '机封处滴漏', d(120), '更换'],
    ['G5', 'P-32', '泵32', 'M-A', '离心泵', '轴承', '振动偏高有异响', d(300), '更换'],
    ['G6', 'P-32', '泵32', 'M-A', '离心泵', '轴承', '振动偏高有异响', d(250), '更换'],
    ['G7', 'P-32', '泵32', 'M-A', '离心泵', '轴承', '振动偏高有异响', d(40), '更换'],
  ],
});
r = run(shrink, [], 'shrink');
eq(r.summary.counts.shortening, 1, '10.1 仅 P-31 判为间隔缩短');
const sh = r.json.shorteningInterval[0];
eq(sh.tag, 'P-31', '10.2 间隔缩短设备位号正确');
eq(sh.ruleId, 'D4', '10.3 间隔缩短规则号 D4');
eq(sh.intervals.join(','), '90,60,30', '10.4 间隔序列递减');
eq(sh.firstInterval, 90, '10.5 首次间隔');
eq(sh.lastInterval, 30, '10.6 末次间隔');
eq(sh.shrinkPct, 66.7, '10.7 缩短幅度计算正确');
ok(sh.note.includes('须结合设备状态数据'), '10.8 间隔缩短注明须工程师判断');
ok(!r.json.shorteningInterval.some((x) => x.tag === 'P-32'), '10.9 间隔先缩后扩的设备不判为缩短');
ok(/五、故障间隔缩短设备/.test(r.md), '10.10 md 间隔缩短章节存在');

// ================================================================ 11. --by 三个维度
r = run(model, ['--by', 'model'], 'by-model');
eq(r.summary.ok, true, '11.1 --by model 可运行');
eq(r.summary.by, 'model', '11.2 by 写入摘要');
r = run(model, ['--by', 'part'], 'by-part');
eq(r.summary.ok, true, '11.3 --by part 可运行');
eq(r.json.byModel.length ? r.json.byModel[0].dimension : null, '故障部位', '11.4 --by part 时按故障部位维度归类');
eq(r.json.byModel.length ? r.json.byModel[0].key : null, '管束', '11.5 --by part 归类键为归一后的部位');
r = run(model, ['--by', 'equipment'], 'by-equip');
eq(r.summary.by, 'equipment', '11.6 --by equipment 为默认维度');
let x = runRaw(['--input', base, '--workshop', '车间', '--from', FROM, '--to', TO, '--by', 'xxx']);
eq(x.s.ok, false, '11.7 --by 非法值报错');
ok(/equipment/.test(x.s.error), '11.8 --by 错误信息列出合法取值');

// ================================================================ 12. --min-count 可调
r = run(base, ['--min-count', '3'], 'minc3');
eq(r.summary.minCount, 3, '12.1 --min-count 写入摘要');
ok(!r.json.byEquipment.find((x) => x.tag === 'P-02').hits.some((h) => h.ruleId === 'D1'), '12.2 阈值升至 3 后 P-02（2 次）不再命中 D1');
ok(r.json.byEquipment.find((x) => x.tag === 'P-01').hits.some((h) => h.ruleId === 'D1' && h.count === 3), '12.2b 阈值 3 时 P-01（3 次）仍命中 D1');
r = run(base, ['--min-count', '5'], 'minc5');
ok(!r.json.byEquipment.some((x) => x.hits.some((h) => h.ruleId === 'D1')), '12.3 阈值升至 5 后无 D1 命中');
ok(/同设备同部位 ≥5 次/.test(r.md), '12.4 md 写明实际使用的阈值');

// ================================================================ 13. 统计区间：注明实际区间 + 过短过长提示
r = run(base, [], 'period-ok');
ok(/2025-09-22 ~ 2026-09-21/.test(r.md), '13.1 md 注明实际统计区间');
eq(r.json.meta.periodDays, 365, '13.2 区间天数计算正确');
ok(r.json.meta.periodAdvice.includes('6~12 个月'), '13.3 meta 给出区间建议');
ok(!r.json.warnings.some((w) => w.includes('短于建议下限')), '13.4 12 个月区间不触发过短提示');
const rShort = spawnSync(process.execPath, [DETECT, '--input', base, '--workshop', '测试车间',
  '--from', '2026-09-01', '--to', TO, '--out', path.join(work, 'short-out')], { encoding: 'utf8' });
let sj = JSON.parse(rShort.stdout.trim().split('\n').pop());
ok(sj.warnings.some((w) => w.includes('短于建议下限') && w.includes('漏判')), '13.5 区间过短时 warning 提示会漏判');
const rLong = spawnSync(process.execPath, [DETECT, '--input', base, '--workshop', '测试车间',
  '--from', '2023-01-01', '--to', TO, '--out', path.join(work, 'long-out')], { encoding: 'utf8' });
sj = JSON.parse(rLong.stdout.trim().split('\n').pop());
ok(sj.warnings.some((w) => w.includes('长于建议上限') && w.includes('已整改')), '13.6 区间过长时 warning 提示掺入历史问题');

// 区间外记录跳过
const outrange = mk('outrange.xlsx', {
  '工单台账': [HEAD,
    ['G1', 'P-41', '泵41', 'M-A', '离心泵', '机械密封', '机封处滴漏', d(100), '更换'],
    ['G2', 'P-41', '泵41', 'M-A', '离心泵', '机械密封', '机封处滴漏', C.addDays(TO, -800), '更换'],
    ['G3', 'P-41', '泵41', 'M-A', '离心泵', '机械密封', '机封处滴漏', C.addDays(TO, 30), '更换'],
  ],
});
r = run(outrange, [], 'outrange');
eq(r.summary.counts.valid, 1, '13.7 区间外记录被跳过');
eq(r.summary.counts.outOfRange, 2, '13.8 区间外计数正确（早于与晚于各 1）');
ok(r.json.warnings.some((w) => w.includes('不在统计区间')), '13.9 区间外 warning');

// ================================================================ 14. 缺字段与数据质量
const nopart = mk('nopart.xlsx', {
  '工单台账': [HEAD,
    ['G1', 'P-51', '泵51', 'M-A', '离心泵', '', '机封处滴漏', d(300), '更换'],
    ['G2', 'P-51', '泵51', 'M-A', '离心泵', '', '机封处滴漏', d(200), '更换'],
    ['G3', 'P-51', '泵51', 'M-A', '离心泵', '', '机封处滴漏', d(100), '更换'],
  ],
});
r = run(nopart, [], 'nopart');
ok(r.json.warnings.some((w) => w.includes('故障部位（对象部件）为空')), '14.1 部位为空 warning');
ok(!r.json.byEquipment[0].hits.some((h) => h.ruleId === 'D1'), '14.2 部位全空时不命中 D1（不按同部位默认）');
ok(r.json.byEquipment[0].hits.some((h) => h.ruleId === 'D2'), '14.3 部位空时仍可按现象文本命中 D2');

const badtime = mk('badtime.xlsx', {
  '工单台账': [HEAD,
    ['G1', 'P-61', '泵61', 'M-A', '离心泵', '机械密封', '机封处滴漏', '不详', '更换'],
    ['G2', 'P-61', '泵61', 'M-A', '离心泵', '机械密封', '机封处滴漏', d(100), '更换'],
  ],
});
r = run(badtime, [], 'badtime');
eq(r.summary.counts.valid, 1, '14.4 故障时间无法解析的行不参与统计');
ok(r.json.warnings.some((w) => w.includes('无法解析')), '14.5 时间无法解析 warning');

const notag = mk('notag.xlsx', {
  '工单台账': [HEAD,
    ['G1', '', '无位号', 'M-A', '离心泵', '机械密封', '机封处滴漏', d(100), '更换'],
    ['G2', 'P-71', '泵71', 'M-A', '离心泵', '机械密封', '机封处滴漏', d(50), '更换'],
  ],
});
r = run(notag, [], 'notag');
eq(r.summary.counts.equipment, 1, '14.6 空位号行被跳过');
ok(r.json.warnings.some((w) => w.includes('位号为空')), '14.7 空位号 warning');

// ================================================================ 15. 设备台账补型号
const noModelCol = mk('nomodel.xlsx', {
  '工单台账': [
    ['工单号', '位号', '设备名称', '故障部位', '故障现象', '故障时间'],
    ['G1', 'E-81', '换热器81', '管束', '管束内漏串油', d(300)],
    ['G2', 'E-82', '换热器82', '换热管', '管束内漏，壳程发现油品', d(200)],
    ['G3', 'E-81', '换热器81', '列管', '管束内漏，串油', d(100)],
  ],
});
r = run(noModelCol, [], 'nomodel');
eq(r.json.byModel.length, 0, '15.1 无型号且无台账时不做共性归类');
ok(r.json.warnings.some((w) => w.includes('未提供设备台账')), '15.2 未提供台账 warning');
const led = mk('ledger.xlsx', {
  '设备台账': [
    ['位号', '设备名称', '型号', '设备类型'],
    ['E-81', '换热器81', 'BES700', '换热器'],
    ['E-82', '换热器82', 'BES700', '换热器'],
  ],
});
r = run(noModelCol, ['--ledger', led], 'withledger');
eq(r.json.meta.ledgerUsed, true, '15.3 台账已使用');
eq(r.json.byModel.length, 1, '15.4 台账补型号后识别出共性故障');
eq(r.json.byModel[0].key, 'BES700', '15.5 共性故障型号来自台账');
const led2 = mk('ledger-miss.xlsx', { '设备台账': [['位号', '型号'], ['E-99', 'X']] });
r = run(noModelCol, ['--ledger', led2], 'ledgermiss');
ok(r.json.warnings.some((w) => w.includes('不在设备台账中')), '15.6 位号不在台账 warning');
const led3 = mk('ledger-nosheet.xlsx', { '别的表': [['a'], [1]] });
r = run(noModelCol, ['--ledger', led3], 'ledgernosheet');
eq(r.summary.ok, true, '15.7 台账缺工作表不中断');
ok(r.json.warnings.some((w) => w.includes('无法按型号归类')), '15.8 台账缺工作表 warning');

// ================================================================ 16. 别名列头 / 标题行 / 合计行
const mes = mk('mes.xlsx', {
  '维修记录': [
    ['某厂设备维修工单导出'],
    [],
    ['单号', '设备位号', '名称', '规格型号', '损坏部位', '故障描述', '报修时间', '处理措施'],
    ['W1', 'P-91', '泵91', 'A-200', '轴承', '轴承温度偏高', d(200), '更换轴承'],
    ['W2', 'P-91', '泵91', 'A-200', '轴瓦', '轴承温度高报警', d(80), '更换轴瓦'],
    ['合计', '', '', '', '', '', '', ''],
  ],
});
r = run(mes, [], 'mes');
eq(r.summary.ok, true, '16.1 MES 风格导出可读（标题行 + 别名列头）');
eq(r.summary.counts.valid, 2, '16.2 合计行被跳过');
ok(r.json.warnings.some((w) => w.includes('合计行')), '16.3 合计行 warning');
eq(r.json.byEquipment.length, 1, '16.4 别名列头下仍正确识别重复');

// ================================================================ 17. 参数校验
x = runRaw([]);
eq(x.s.ok, false, '17.1 无参数报错');
eq(x.code, 1, '17.2 退出码为 1');
x = runRaw(['--input']);
eq(x.s.ok, false, '17.3 --input 缺值报错');
ok(/缺少取值/.test(x.s.error), '17.4 缺值错误信息正确');
x = runRaw(['--input', base, '--workshop', '车间', '--from', FROM, '--out', path.join(work, 'noto-out')]);
eq(x.s.ok, true, '17.5 缺 --to 时默认当日，不报错');
eq(x.s.to, C.localDate(), '17.5b --to 默认为当日');
x = runRaw(['--input', base, '--workshop', '车间', '--from', '2026-13-45', '--to', TO]);
eq(x.s.ok, false, '17.6 非法起始日期报错');
x = runRaw(['--input', base, '--workshop', '车间', '--from', TO, '--to', FROM]);
eq(x.s.ok, false, '17.7 起始晚于截止报错');
x = runRaw(['--input', base, '--workshop', '车间', '--from', FROM, '--to', TO, '--未知参数', 'v']);
eq(x.s.ok, false, '17.8 未知参数报错');
x = runRaw(['--input', '/不存在的路径.xlsx', '--workshop', '车间', '--from', FROM, '--to', TO]);
eq(x.s.ok, false, '17.9 输入不存在报错');
x = runRaw(['--input', base, '--workshop', '车间', '--from', FROM, '--to', TO, '--min-count', '1']);
eq(x.s.ok, false, '17.10 --min-count 小于 2 报错');
x = runRaw(['--input', base, '--workshop', '车间', '--from', FROM, '--to', TO, '--min-count', 'abc']);
eq(x.s.ok, false, '17.11 --min-count 非数字报错');
x = runRaw(['--input', base, '--workshop', '车间', '--from', FROM, '--to', TO, '--similarity', '2']);
eq(x.s.ok, false, '17.12 --similarity 超出 0~1 报错');
const nosheet = mk('nosheet.xlsx', { '随便一张表': [['a', 'b'], [1, 2]] });
x = runRaw(['--input', nosheet, '--workshop', '车间', '--from', FROM, '--to', TO]);
eq(x.s.ok, false, '17.13 无已知工作表时 ok:false');
ok(/未在输入中找到/.test(x.s.error), '17.14 无工作表错误信息明确');
const empty = mk('empty.xlsx', { '工单台账': [HEAD] });
x = runRaw(['--input', empty, '--workshop', '车间', '--from', FROM, '--to', TO]);
eq(x.s.ok, false, '17.15 区间内无记录时 ok:false');

// ================================================================ 18. --similarity 可调
r = run(base, ['--similarity', '0.95'], 'sim-high');
eq(r.summary.similarity, 0.95, '18.1 --similarity 写入摘要');
ok(!r.json.byEquipment.some((x) => x.hits.some((h) => h.ruleId === 'D2' && h.count >= 3)), '18.2 相似度阈值提高后 D2 分组变小');
r = run(base, ['--similarity', '0.3'], 'sim-low');
eq(r.summary.ok, true, '18.3 相似度阈值降低可运行');

// ================================================================ 19. 产出结构与 summary.json
r = run(base, [], 'struct');
ok(fs.existsSync(path.join(r.out, 'repeats.json')), '19.1 repeats.json 已写入');
ok(fs.existsSync(path.join(r.out, 'repeats.md')), '19.2 repeats.md 已写入');
ok(fs.existsSync(path.join(r.out, 'summary.json')), '19.3 summary.json 已写入');
const sfile = JSON.parse(fs.readFileSync(path.join(r.out, 'summary.json'), 'utf8'));
eq(sfile.ok, true, '19.4 summary.json 内容正确');
ok(['byEquipment', 'byModel', 'topFrequency', 'shorteningInterval', 'uninformative', 'counts']
  .every((k) => k in r.json), '19.5 repeats.json 六个必需键齐全');
ok(/## 一、统计概览/.test(r.md) && /## 二、同设备重复故障/.test(r.md)
  && /## 三、同型号\/同类设备共性故障/.test(r.md) && /## 四、故障频次排行/.test(r.md)
  && /## 五、故障间隔缩短设备/.test(r.md) && /## 六、故障现象无信息量清单/.test(r.md)
  && /## 七、重复故障分析/.test(r.md), '19.6 md 七节结构齐全');
ok(/<!-- ANALYSIS_START -->/.test(r.md) && /<!-- ANALYSIS_END -->/.test(r.md), '19.7 分析段占位符存在');
ok(/第\d+行/.test(r.md), '19.8 md 记录带出处行号');
ok(/生成时间：\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}（北京时间）/.test(r.md), '19.9 生成时间为北京时间');

// 空结果时各节有兜底文案
r = run(mk('onlyone.xlsx', {
  '工单台账': [HEAD, ['G1', 'P-99', '泵99', 'M-Z', '离心泵', '机械密封', '机封处滴漏', d(100), '更换']],
}), [], 'onlyone');
eq(r.summary.ok, true, '19.10 单条记录可正常出数');
ok(/未发现达到阈值的同设备重复故障/.test(r.md), '19.11 无重复时二节有兜底文案');
ok(/未发现达到阈值的共性故障组/.test(r.md), '19.12 无共性时三节有兜底文案');
ok(/未发现故障间隔呈递减趋势/.test(r.md), '19.13 无间隔缩短时五节有兜底文案');


// ================================================================ 20. SAP 通知单导出：代码优先归类、SAP 列名
const sap = mk('sap.xlsx', {
  '通知单': [
    ['通知单', '通知单类型', '功能位置', '设备', '设备描述', '对象部件', '损坏代码', '原因代码', '通知单短文本', '通知日期', '报告人'],
    ['10020001', 'M2', 'P-01', '10000001', '进料泵A', '机械密封', 'LEAK01', 'C-WEAR', '机封滴漏', d(300), '王'],
    ['10020002', 'M2', 'P-01', '10000001', '进料泵A', '机封', 'LEAK01', 'C-INST', '密封处有渗出', d(200), '王'],
    ['10020003', 'M2', 'P-01', '10000001', '进料泵A', '轴承箱', 'VIB02', 'C-ALIGN', '振动偏高', d(100), '李'],
    ['10020004', 'M2', 'P-02', '10000002', '进料泵B', '轴承箱', 'VIB02', '', '', d(150), '李'],
    ['10020005', 'M2', 'P-02', '10000002', '进料泵B', '轴承', 'VIB02', '', '故障', d(50), '李'],
  ],
});
r = run(sap, [], 'sap');
eq(r.summary.ok, true, '20.1 SAP 通知单导出可读（工作表「通知单」）');
eq(r.summary.counts.valid, 5, '20.2 带损坏代码的记录即使短文本为空/笼统也参与判定');
eq(r.summary.counts.uninformative, 0, '20.3 有代码时不列入无信息量');
eq(r.summary.counts.withCode, 5, '20.4 带代码记录计数');
const sp1 = r.json.byEquipment.find((x) => x.tag === 'P-01');
ok(sp1 && sp1.equipNo === '10000001', '20.5 「设备」列作 SAP 设备编号，「功能位置」作位号');
const d2c = sp1 && sp1.hits.find((h) => h.ruleId === 'D2' && h.byCode);
ok(!!d2c && d2c.count === 2 && d2c.key === '损坏代码 LEAK01', '20.6 D2 按损坏代码 LEAK01 归为一组（2 次），文本不同也归组');
ok(d2c.matchBasis.some((b) => b.includes('代码同为「LEAK01」') && b.includes('代码优先')), '20.7 matchBasis 写明按 SAP 代码归类');
ok(!sp1.hits.some((h) => h.ruleId === 'D2' && h.seqs.length === 3), '20.8 VIB02 与 LEAK01 代码不同不混入同组');
ok(sp1.hits.some((h) => h.ruleId === 'D1' && h.key === '机械密封' && h.count === 2), '20.9 「对象部件」作故障部位参与 D1');
ok(sp1.records.every((x) => x.notifNo && /^1002/.test(x.notifNo)), '20.10 通知单号带出');
ok(sp1.records[0].causeCode === 'C-WEAR', '20.11 原因代码带出且不被当作故障代码');
const sp2 = r.json.byEquipment.find((x) => x.tag === 'P-02');
ok(sp2 && sp2.hits.some((h) => h.ruleId === 'D2' && h.key === '损坏代码 VIB02'), '20.12 P-02 短文本为空/「故障」仍按代码 VIB02 命中 D2');
ok(/损坏代码/.test(r.md) && /代码优先/.test(r.md), '20.13 md 展示损坏代码列与代码优先说明');
ok(r.json.topFrequency.find((x) => x.tag === 'P-01').phenomena.includes('代码 LEAK01'), '20.14 频次排行现象列显示代码');
// 规则引擎：代码不同 → 0 分；一方有代码 → 退回文本
const sc1 = R.similarity({ desc: '机封滴漏', part: '机封', phenomenon: 'leak', faultCode: 'LEAK01' }, { desc: '机封滴漏', part: '机封', phenomenon: 'leak', faultCode: 'VIB02' });
eq(sc1.score, 0, '20.15 代码不同时相似度为 0（不靠文本硬凑）');
const sc2 = R.similarity({ desc: '机封滴漏', part: '机封', phenomenon: 'leak', faultCode: 'LEAK01' }, { desc: '机封泄漏滴漏', part: '机封', phenomenon: 'leak', faultCode: '' });
ok(sc2.score > 0.5 && sc2.matchBasis.some((b) => b.includes('仅一方有')), '20.16 仅一方有代码时退回文本比对并写明');
eq(R.checkInformative('故障', 'LEAK01').uninformative, false, '20.17 有代码时「故障」不算无信息');
eq(R.checkInformative('故障', '').uninformative, true, '20.18 无代码时「故障」仍无信息');
// 混合：带代码与不带代码的记录共存 → warning
const mixcode = mk('mixcode.xlsx', {
  '工单台账': [['工单号', '位号', '故障部位', '损坏代码', '故障现象', '故障时间'],
    ['G1', 'P-05', '机封', 'LEAK01', '机封滴漏', d(200)],
    ['G2', 'P-05', '机封', '', '机封泄漏滴漏', d(100)],
  ],
});
r = run(mixcode, [], 'mixcode');
ok(r.json.warnings.some((w) => w.includes('带 SAP 损坏/故障代码') && w.includes('不带')), '20.19 代码部分缺失 warning');
ok(r.json.byEquipment.find((x) => x.tag === 'P-05').hits.some((h) => h.ruleId === 'D2'), '20.20 一方无代码时仍可按文本归组');

// ================================================================ 21. 多文件合并（按装置分文件）
const f1 = mk('unit1.xlsx', { '工单台账': [HEAD,
  ['G1', 'E-01', '换热器1', 'BES800', '换热器', '管束', '管束内漏，壳程串油', d(300), '堵管'],
  ['G2', 'E-01', '换热器1', 'BES800', '换热器', '列管', '管束内漏，串油', d(100), '堵管'],
] });
const f2 = mk('unit2.xlsx', { '故障记录': [HEAD,
  ['G3', 'E-02', '换热器2', 'BES800', '换热器', '换热管', '管束内漏，壳程发现油品', d(200), '堵管'],
  ['G4', 'E-02', '换热器2', 'BES800', '换热器', '换热管', '管束内漏', d(50), '堵管'],
] });
r = run(`${f1},${f2}`, [], 'multi');
eq(r.summary.ok, true, '21.1 逗号分隔多文件可读');
eq(r.summary.counts.files, 2, '21.2 文件数计入 counts');
eq(r.summary.counts.valid, 4, '21.3 两文件记录合并');
eq(r.summary.counts.repeatEquipment, 2, '21.4 合并后各自命中同设备重复');
eq(r.json.byModel.length, 1, '21.5 合并后跨文件识别同型号共性故障');
eq(r.json.byModel[0].equipmentCount, 2, '21.6 共性故障涉及两个文件的两台设备');
ok(r.json.byEquipment.every((g) => g.records.every((x) => /unit[12]\.xlsx 第\d+行/.test(x.src))), '21.7 多文件时出处带文件名');
ok(/unit1\.xlsx、unit2\.xlsx/.test(r.md), '21.8 md 抬头列出数据文件');
ok(r.json.meta.fileStats.length === 2 && r.json.meta.fileStats.every((f) => f.rows === 2), '21.9 逐文件行数统计');
const f3 = mk('unit3.xlsx', { '别的表': [['a'], [1]] });
r = run(`${f1},${f3}`, [], 'multi-skip');
eq(r.summary.ok, true, '21.10 某文件无故障表时跳过不中断');
ok(r.json.warnings.some((w) => w.includes('unit3.xlsx') && w.includes('已跳过该文件')), '21.11 跳过文件 warning');
x = runRaw(['--input', `${f1},/不存在.xlsx`, '--workshop', '车间', '--from', FROM, '--to', TO]);
eq(x.s.ok, false, '21.12 多文件中任一不存在报错');

// ================================================================ 22. 默认区间「一年内」与默认输出目录
{
  const rr = spawnSync(process.execPath, [DETECT, '--input', base, '--workshop', '测试车间', '--to', TO, '--out', path.join(work, 'defrange-out')], { encoding: 'utf8' });
  const sj2 = JSON.parse(rr.stdout.trim().split('\n').pop());
  eq(sj2.ok, true, '22.1 未指定 --from 可运行');
  eq(sj2.from, '2025-09-22', '22.2 --from 默认为 --to 往前 12 个自然月的次日');
  eq(sj2.periodDays, 365, '22.3 默认区间 365 天');
  ok(sj2.warnings.some((w) => w.includes('未指定 --from') && w.includes('一年内')), '22.4 默认起始日 warning 说明口径');
  ok(!sj2.warnings.some((w) => w.includes('长于建议上限')), '22.5 默认一年不触发过长提示');
  const md2 = fs.readFileSync(path.join(work, 'defrange-out', 'repeats.md'), 'utf8');
  ok(/起始日按默认「一年内」口径推算/.test(md2), '22.6 md 注明起始日为默认推算');
  ok(/同一设备同一部位一年内 ≥2 次即重复故障/.test(md2), '22.7 md 写明默认重复口径');
  const rr2 = spawnSync(process.execPath, [DETECT, '--input', base, '--workshop', '测试车间', '--from', FROM, '--to', TO], { encoding: 'utf8' });
  const sj3 = JSON.parse(rr2.stdout.trim().split('\n').pop());
  ok(sj3.ok && sj3.out.startsWith(os.tmpdir()) && !fs.existsSync(path.join(path.dirname(base), 'rfd-out')), '22.8 默认输出目录为 os.tmpdir()/rfd-out，不写入输入同目录');
}

// ================================================================ 23. 别名收窄：裸「编号」不当工单号，「设备」不当设备名称
const alias = mk('alias.xlsx', { '工单台账': [
  ['编号', '功能位置', '设备', '设备描述', '对象部件', '通知单短文本', '通知日期'],
  ['1', 'P-07', '10000007', '回流泵A', '机封', '机封滴漏', d(200)],
  ['2', 'P-07', '10000007', '回流泵A', '机封', '机封泄漏滴漏', d(100)],
] });
r = run(alias, [], 'alias');
eq(r.summary.ok, true, '23.1 SAP 技术对象列名可读');
const al = r.json.byEquipment.find((x) => x.tag === 'P-07');
ok(al && al.name === '回流泵A' && al.equipNo === '10000007', '23.2 「设备描述」作设备名称、「设备」作设备编号');
ok(al.records.every((x) => x.orderNo === ''), '23.3 裸「编号」列不再被当作工单号');
ok(/【注意】/.test(r.md) && !/[✅⚠️❌]/.test(r.md), '23.4 md 用【注意】提示且不含 emoji');


// ================================================================ 24. examples 样例预期计数（目录不存在则跳过）
const EX = path.join(__dirname, '..', 'examples');
if (fs.existsSync(path.join(EX, 'sample-failures-2026-09-21.xlsx'))) {
  r = run(path.join(EX, 'sample-failures-2026-09-21.xlsx'), [], 'ex-main');
  ok(r.summary.counts.records === 14 && r.summary.counts.valid === 12 && r.summary.counts.repeatEquipment === 3 && r.summary.counts.modelGroups === 1 && r.summary.counts.shortening === 1 && r.summary.counts.uninformative === 2, '24.1 examples 主样例：14 条/12 条参与/重复 3 台/共性 1 组/缩短 1 台/无信息 2 条');
  r = run(`${path.join(EX, 'sample-failures-2026-09-21.xlsx')},${path.join(EX, 'sample-failures-unit2-2026-09-21.xlsx')}`, ['--ledger', path.join(EX, 'sample-equip-ledger.xlsx')], 'ex-multi');
  ok(r.summary.counts.files === 2 && r.summary.counts.valid === 14 && r.json.byModel.length === 1 && r.json.byModel[0].equipmentCount === 3 && r.json.byModel[0].count === 4, '24.2 examples 两装置文件合并：共性故障 3 台 4 次');
  r = run(path.join(EX, 'sample-sap-notifications.xlsx'), [], 'ex-sap');
  ok(r.summary.counts.valid === 6 && r.summary.counts.withCode === 6 && r.summary.counts.uninformative === 0 && r.summary.counts.repeatEquipment === 2, '24.3 examples SAP 通知单：6 条带代码、无信息 0、重复 2 台');
  ok(r.json.byEquipment.find((x) => x.tag === 'P-2201A').hits.some((h) => h.ruleId === 'D2' && h.byCode && h.count === 3), '24.4 examples P-2201A 按 LEAK01 代码归为 3 次');
  r = run(path.join(EX, 'sample-vague-desc.xlsx'), [], 'ex-vague');
  ok(r.summary.counts.uninformative === 4 && r.summary.counts.repeatEquipment === 0, '24.5 examples 全无信息样例不判重复');
  r = run(path.join(EX, 'sample-mes-export.xlsx'), [], 'ex-mes');
  ok(r.summary.counts.valid === 2 && r.summary.counts.outOfRange === 1 && r.summary.counts.repeatEquipment === 1, '24.6 examples MES 导出：2 条有效、1 条区间外、1 台重复');
}

// ================================================================ 输出
console.log(`\n${'='.repeat(56)}`);
console.log(`repeat-failure-detector 自测：${pass} 通过，${fail} 失败`);
if (failures.length) { console.log('\n失败项：'); failures.forEach((f) => console.log('  ✗ ' + f)); }
console.log('='.repeat(56));
try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
