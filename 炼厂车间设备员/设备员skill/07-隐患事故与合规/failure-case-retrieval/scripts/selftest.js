#!/usr/bin/env node
'use strict';
/**
 * 自测：生成变体案例库并断言 retrieve.js 行为。用法：node scripts/selftest.js（全绿退出 0）
 * 重点覆盖六条硬约束：无案例库不可用、命中为空不补位、低相似度单列标注、
 * 匹配依据与不同点齐全、免责说明写入 md、声明行保留。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { writeXlsx } = require('./lib/xlsx-lite');
const lite = require('./lib/docx-lite');
const R = require('./retrieve.js');

const RET = path.join(__dirname, 'retrieve.js');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'fcr-selftest-'));
let pass = 0, fail = 0;
const failures = [];

function ok(cond, name) { if (cond) { pass++; } else { fail++; failures.push(name); } }
function eq(actual, expect, name) { ok(actual === expect, `${name}（期望 ${JSON.stringify(expect)}，实际 ${JSON.stringify(actual)}）`); }

function runRaw(args) {
  const r = spawnSync(process.execPath, [RET, ...args], { encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  let s;
  try { s = JSON.parse(lines[lines.length - 1]); } catch (e) { s = { ok: false, error: 'no-json:' + r.stdout + r.stderr }; }
  return { code: r.status, s };
}
function run(file, extra, tag) {
  const out = path.join(work, tag + '-out');
  const base = ['--cases', file, '--out', out];
  const r = runRaw(base.concat(extra));
  let json = null, md = null;
  if (fs.existsSync(path.join(out, 'cases.json'))) json = JSON.parse(fs.readFileSync(path.join(out, 'cases.json'), 'utf8'));
  if (fs.existsSync(path.join(out, 'cases.md'))) md = fs.readFileSync(path.join(out, 'cases.md'), 'utf8');
  return { code: r.code, summary: r.s, json, md, out };
}
function mk(name, book) { const p = path.join(work, name); writeXlsx(p, book); return p; }

const HEAD = ['案例编号', '设备类型', '设备名称', '位号', '型号', '故障部位', '现象描述', '原因', '处置方式', '效果', '发生时间', '工况', '来源'];
const lib = mk('lib.xlsx', {
  '故障案例': [HEAD,
    ['C-01', '离心泵', '回流泵A', 'P-01', 'IH100', '机械密封', '机封处持续滴漏，约6滴/分，泵体下方有油渍', '动环端面划伤', '更换机封', '无渗漏', '2026-03-12', '正常输送', '本厂检修记录'],
    ['C-02', '离心泵', '渣油泵B', 'P-02', 'IH150', '轴承', '驱动端轴承温度升至82℃，运行中伴有低频异响', '润滑脂过量', '重新加脂', '温度回落', '2026-01-20', '连续运行', '本厂检修记录'],
    ['C-03', '离心泵', '进料泵A', 'P-03', 'ZA80', '机械密封', '机封处滴漏，约5滴/分，泵体下方可见油渍', '弹簧疲劳', '更换机封组件', '渗漏消除', '2025-11-08', '', '本厂检修记录'],
    ['C-04', '离心压缩机', '富气压缩机', 'K-01', 'MCL705', '轴承', '径向轴承金属温度升高，轴振缓慢上升', '油中带水', '油箱脱水', '恢复正常', '2026-02-18', '负荷85%', '本厂检修记录'],
    ['C-05', '换热器', '原油换热器', 'E-01', 'BES800', '管束', '壳程出口介质含水，冷侧压力异常上升', '管口内漏', '堵管6根', '内漏消除', '2026-04-06', '运行18个月', '本厂检修记录'],
    ['C-06', '阀门', '压力调节阀', 'PV-01', 'ZJHP16', '阀芯阀座', '调节阀内漏，全关位仍有流量通过，塔压控不住', '阀芯冲蚀', '更换阀芯阀座', '恢复可控', '2026-01-05', '长期节流', '本厂检修记录'],
  ],
});

const Q = ['--symptom', '机封处滴漏，约5滴/分，泵体下方有油渍', '--equip-type', '离心泵'];

// ---- 1. 正常路径：命中、计数、排序
let r = run(lib, Q.concat(['--part', '机械密封']), 'base');
eq(r.summary.ok, true, '1.1 基础运行成功');
eq(r.summary.counts.casesTotal, 6, '1.2 可检索案例总数');
ok(r.summary.counts.matches >= 2, '1.3 至少命中 2 条机封案例');
eq(r.json.matches[0].id, 'C-03', '1.4 最相似案例排首位');
ok(r.json.matches[0].score >= r.json.matches[1].score, '1.5 命中按相似度降序');
ok(r.json.matches.every((m) => m.score >= r.json.meta.minScore), '1.6 命中均不低于下限');
eq(r.summary.counts.matches + r.summary.counts.belowMinTotal, 6, '1.7 命中数+低分数=案例总数');

// ---- 2. 硬约束一：无案例库 → 本技能不可用，绝不降级
let x = runRaw(['--symptom', '机封滴漏', '--equip-type', '离心泵']);
eq(x.s.ok, false, '2.1 未给 --cases 时 ok:false');
eq(x.code, 1, '2.2 未给 --cases 时退出码 1');
ok(/无案例库时本技能不可用/.test(x.s.error), '2.3 错误信息写明本技能不可用');
ok(/不得用通用知识/.test(x.s.error), '2.4 错误信息明令禁止通用知识作答');
x = runRaw(['--cases', path.join(work, '不存在.xlsx'), '--symptom', '机封滴漏', '--equip-type', '离心泵']);
eq(x.s.ok, false, '2.5 案例库路径不存在时 ok:false');
ok(/不得用通用知识替代/.test(x.s.error), '2.6 路径不存在时同样禁止降级');
const nosheet = mk('nosheet.xlsx', { '随便一张表': [['a', 'b'], [1, 2]] });
r = run(nosheet, Q, 'nosheet');
eq(r.summary.ok, false, '2.7 无案例工作表时 ok:false');
eq(r.code, 1, '2.8 无案例工作表退出码 1');
ok(/本技能不可用/.test(r.summary.error), '2.9 无案例工作表错误信息写明不可用');
const empty = mk('empty.xlsx', { '故障案例': [['案例编号', '设备类型', '现象描述'], ['E-01', '离心泵', ''], ['E-02', '换热器', '']] });
r = run(empty, Q, 'empty');
eq(r.summary.ok, false, '2.10 案例库全部现象为空 → ok:false');
eq(r.code, 1, '2.11 无可检索案例退出码 1');
ok(/没有任何含现象描述的可检索案例/.test(r.summary.error), '2.12 无可检索案例错误信息明确');
ok(r.summary.warnings.some((w) => w.includes('现象描述为空')), '2.13 逐行说明为何跳过');

// ---- 3. 硬约束二：命中为空 → 明确回答，绝不补位
r = run(lib, ['--symptom', '干气密封泄漏报警，密封气压差下降明显', '--equip-type', '往复压缩机', '--part', '干气密封'], 'nohit');
eq(r.summary.ok, true, '3.1 命中为空仍属正常产出（非报错）');
eq(r.summary.counts.matches, 0, '3.2 命中为空时 matches 为 0');
eq(r.json.matches.length, 0, '3.3 cases.json 的 matches 为空数组，未补位');
ok(/案例库中未检索到类似案例/.test(r.md), '3.4 md 明确写「案例库中未检索到类似案例」');
ok(/不降低标准返回不相关案例/.test(r.md), '3.5 md 写明不降低标准');
ok(/不以通用知识补充/.test(r.md), '3.6 md 写明不以通用知识补充');
ok(r.summary.warnings.some((w) => w.includes('命中为空')), '3.7 warning 提示命中为空');
ok(r.json.lowSimilarity.length > 0, '3.8 未达标案例进入 lowSimilarity 而非 matches');

// ---- 4. 硬约束三：低于 --min-score 的一律单列并标注
r = run(lib, Q.concat(['--min-score', '0.9']), 'strict');
eq(r.summary.counts.matches, 0, '4.1 下限提到 0.9 后无案例达标');
ok(r.json.lowSimilarity.every((x) => x.note === '相似度较低，仅供参考'), '4.2 低分案例逐条带「相似度较低，仅供参考」标注');
ok(/相似度较低，仅供参考/.test(r.md), '4.3 md 中出现低相似度标注');
ok(/不得作为主要参考/.test(r.md), '4.4 md 写明不得作为主要参考');
ok(r.json.lowSimilarity.every((x) => x.score < 0.9), '4.5 lowSimilarity 中确无达标案例');
r = run(lib, Q.concat(['--min-score', '0']), 'loose');
eq(r.json.lowSimilarity.length, 0, '4.6 下限为 0 时无低分单列');
eq(r.json.meta.minScore, 0, '4.7 min-score 写入 meta');

// ---- 5. 硬约束四：每条案例必须带匹配依据与不同点
r = run(lib, Q.concat(['--part', '机械密封', '--model', 'IH100']), 'basis');
ok(r.json.matches.every((m) => Array.isArray(m.matchBasis) && m.matchBasis.length > 0), '5.1 每条命中都有 matchBasis');
ok(r.json.matches.every((m) => Array.isArray(m.differences)), '5.2 每条命中都有 differences 字段');
ok(r.json.matches.every((m) => m.matchBasis.some((b) => b.includes('bigram'))), '5.3 matchBasis 含现象文本 bigram 依据');
ok(r.json.matches.some((m) => m.matchBasis.some((b) => b.includes('设备类型同为'))), '5.4 matchBasis 写明设备类型匹配');
ok(r.json.matches.some((m) => m.matchBasis.some((b) => b.includes('故障部位同为'))), '5.5 matchBasis 写明故障部位匹配');
ok(r.json.matches.some((m) => m.matchBasis.some((b) => b.includes('型号同为'))), '5.6 matchBasis 写明型号匹配');
ok(r.json.lowSimilarity.every((m) => m.matchBasis.length && Array.isArray(m.differences)), '5.7 低相似度案例同样带依据与不同点');
ok(/\*\*匹配依据\*\*/.test(r.md) && /\*\*不同点\*\*/.test(r.md), '5.8 md 中逐条呈现匹配依据与不同点');
ok(r.json.matches.some((m) => m.differences.some((d) => d.includes('故障部位不同') || d.includes('设备类型不同') || d.includes('型号不同') || d.includes('未参与比对'))), '5.9 不同点写明具体差异项');

// ---- 6. 硬约束五、六：声明行与免责说明原样保留
ok(r.md.includes('案例中的原因是当时该案例的结论，不代表当前故障的原因；是否适用须结合当前设备实际情况判断。'), '6.1 声明行原样写入 md');
eq(r.json.meta.disclaimer, '案例中的原因是当时该案例的结论，不代表当前故障的原因；是否适用须结合当前设备实际情况判断。', '6.2 声明行同时写入 cases.json');
ok(/不是失效机理分析/.test(r.md), '6.3 md 说明是机械匹配而非机理分析');
ok(/anomaly-triage-advisor/.test(r.md), '6.4 md 提示下游接 anomaly-triage-advisor 做原因初判');
ok(/未引用任何库外经验/.test(r.md), '6.5 md 说明案例仅来自所提供案例库');
// 命中为空的报告同样保留声明行
const rEmpty = run(lib, ['--symptom', '干气密封泄漏报警，密封气压差下降明显', '--equip-type', '往复压缩机'], 'nohit2');
ok(rEmpty.md.includes('案例中的原因是当时该案例的结论'), '6.6 命中为空时声明行仍保留');

// ---- 7. 权重口径：部位缺失时归一化重分配，不按最宽松默认
r = run(lib, Q, 'nopart');
eq(r.json.meta.weights.part, 0, '7.1 未提供部位时部位权重为 0');
ok(Math.abs(r.json.meta.weights.text + r.json.meta.weights.type - 1) < 0.01, '7.2 剩余权重归一化到 1');
ok(r.json.matches.every((m) => m.differences.some((d) => d.includes('未提供当前故障部位'))), '7.3 未提供部位时逐条注明该维度未比对');
const withPart = run(lib, Q.concat(['--part', '机械密封']), 'withpart');
eq(withPart.json.meta.weights.part, 0.15, '7.4 提供部位时部位权重为 0.15');
eq(withPart.json.meta.weights.text, 0.55, '7.5 现象文本权重为 0.55');
eq(withPart.json.meta.weights.type, 0.3, '7.6 设备类型权重为 0.30');

// ---- 8. 缺列、跳过行与别名/标题行识别
const exportStyle = mk('export.xlsx', {
  '案例库': [
    ['某厂案例库导出'],
    [],
    ['编号', '设备类别', '名称', '部位', '故障现象', '故障原因', '处理措施', '发生日期'],
    ['X-01', '离心泵', '污水泵', '机封', '机封处滴漏，泵体下方有油渍', '机封磨损', '更换机封', '2025-12-01'],
    ['X-02', '换热器', '加热器', '管束', '', '未查明', '待检修', '2026-02-11'],
    ['合计', '', '', '', '', '', '', ''],
  ],
});
r = run(exportStyle, Q, 'export');
eq(r.summary.ok, true, '8.1 标题行+别名列头的导出表可读');
eq(r.summary.counts.casesTotal, 1, '8.2 现象为空的行被跳过，合计行不计入');
eq(r.summary.counts.casesSkipped, 1, '8.3 跳过条数单独计数');
ok(r.summary.warnings.some((w) => w.includes('合计行')), '8.4 合计行 warning');
ok(r.summary.warnings.some((w) => w.includes('现象描述为空')), '8.5 现象为空 warning');
ok(r.summary.warnings.some((w) => w.includes('缺少列「效果」') || w.includes('缺少列「来源」')), '8.6 缺列 warning（效果/来源）');
ok(r.json.matches.every((m) => m.effect === null), '8.7 缺失字段为 null 不臆造');
ok(/—/.test(r.md), '8.8 缺失字段在 md 中显示为 —');

// ---- 9. 日期无法解析 → null 并 warning，不猜测
const baddate = mk('baddate.xlsx', {
  '故障案例': [['案例编号', '设备类型', '故障部位', '现象描述', '发生时间'],
    ['D-01', '离心泵', '机械密封', '机封处滴漏，泵体下方有油渍', '去年冬天'],
  ],
});
r = run(baddate, Q, 'baddate');
eq(r.json.matches[0].time, null, '9.1 无法解析的日期为 null');
ok(r.summary.warnings.some((w) => w.includes('无法解析')), '9.2 日期无法解析 warning');

// ---- 10. 参数校验
x = runRaw(['--cases']);
eq(x.s.ok, false, '10.1 --cases 缺值报错');
ok(/缺少取值/.test(x.s.error), '10.2 缺值错误信息正确');
x = runRaw(['--cases', lib, '--equip-type', '离心泵']);
eq(x.s.ok, false, '10.3 缺 --symptom 报错');
x = runRaw(['--cases', lib, '--symptom', '机封滴漏']);
eq(x.s.ok, false, '10.4 缺 --equip-type 报错');
x = runRaw(['--cases', lib].concat(Q, ['--未知参数', 'x']));
eq(x.s.ok, false, '10.5 未知参数报错');
x = runRaw(['--cases', lib].concat(Q, ['--top', '0']));
eq(x.s.ok, false, '10.6 --top 为 0 报错');
x = runRaw(['--cases', lib].concat(Q, ['--min-score', '1.8']));
eq(x.s.ok, false, '10.7 --min-score 越界报错');
ok(/0~1/.test(x.s.error), '10.8 越界错误信息说明取值范围');
x = runRaw(['--cases', lib, '--symptom', '漏', '--equip-type', '离心泵']);
eq(x.s.ok, false, '10.9 现象描述过短报错');
ok(/补充关键特征/.test(x.s.error), '10.10 过短时提示补充关键特征');

// ---- 11. --top 截断只限制条数，不改变达标判定
r = run(lib, Q.concat(['--part', '机械密封', '--top', '1']), 'top1');
eq(r.json.matches.length, 1, '11.1 --top 1 只返回 1 条');
ok(r.summary.counts.aboveMin >= 2, '11.2 达标总数不受 --top 影响');

// ---- 12. 产出结构完整性
r = run(lib, Q.concat(['--part', '机械密封']), 'struct');
ok(fs.existsSync(path.join(r.out, 'summary.json')), '12.1 summary.json 已写入');
eq(JSON.parse(fs.readFileSync(path.join(r.out, 'summary.json'), 'utf8')).ok, true, '12.2 summary.json 内容正确');
ok(fs.existsSync(path.join(r.out, 'cases.json')) && fs.existsSync(path.join(r.out, 'cases.md')), '12.3 cases.json 与 cases.md 均已生成');
ok(/## 一、检索概览/.test(r.md) && /## 二、命中案例/.test(r.md) && /## 三、低相似度案例/.test(r.md)
  && /## 四、检索结果解读/.test(r.md) && /## 五、使用说明/.test(r.md), '12.4 五节结构齐全');
ok(/<!-- ANALYSIS_START -->/.test(r.md) && /<!-- ANALYSIS_END -->/.test(r.md), '12.5 分析段占位符存在');
ok(r.json.matches.every((m) => /第\d+行/.test(m.origin)), '12.6 每条案例可追溯到 sheet 与行号');
ok(typeof r.json.counts.topScore === 'number', '12.7 counts 含最高相似度');
ok(r.json.meta.casesFile && r.json.meta.query.symptom, '12.8 meta 记录案例库与检索条件');

// ---- 13. 中石化口径：SAP PM 通知单导出列名（IW28）直接可读，位号与设备编号分列
const sap = mk('sap.xlsx', {
  'IW28': [
    ['通知单', '通知类型', '功能位置', '设备', '设备描述', '对象类型', '描述', '损坏代码', '对象部件', '原因代码', '原因文本', '处理措施', '通知日期', '工厂区段'],
    ['10045871', 'M2', 'CDU-P1101A', '10023451', '常压塔顶回流泵A', '离心泵', '机封处滴漏约6滴/分，泵底有油渍', 'LEAK01', '机械密封', 'C-SEAL', '动环端面划伤', '更换机封', '2026-03-12', '常减压装置'],
    ['10045902', 'M2', 'CDU-P1102B', '10023463', '常压渣油泵B', '离心泵', '驱动端轴承温度 82℃ 伴低频异响', 'TEMP02', '轴承', 'C-LUBE', '润滑脂过量', '重新加脂', '2026-01-20', '常减压装置'],
    ['10046118', 'M2', 'FCC-K2201', '10031207', '富气压缩机', '离心压缩机', '径向轴承金属温度升高，轴振缓慢上升', 'TEMP02', '轴承', 'C-OIL', '润滑油带水', '油箱脱水', '2026-02-18', '催化裂化装置'],
  ],
});
r = run(sap, ['--symptom', '机封处滴漏，泵底有油渍', '--equip-type', '离心泵'], 'sap');
eq(r.summary.ok, true, '13.1 SAP IW28 导出表可读');
eq(r.summary.counts.casesTotal, 3, '13.2 「IW28」工作表名可识别，3 条可检索');
eq(r.json.matches[0].id, '10045871', '13.3 「通知单」列作为案例编号（不再显示为 行N）');
eq(r.json.matches[0].tag, 'CDU-P1101A', '13.4 「功能位置」归位号');
eq(r.json.matches[0].equipNo, '10023451', '13.5 「设备」8 位流水号归设备编号，与位号分列');
eq(r.json.matches[0].equipName, '常压塔顶回流泵A', '13.6 「设备描述」归设备名称');
eq(r.json.matches[0].symptom, '机封处滴漏约6滴/分，泵底有油渍', '13.7 「描述」短文本归现象描述（不被设备名称抢走）');
eq(r.json.matches[0].code, 'LEAK01', '13.8 「损坏代码」归故障代码');
eq(r.json.matches[0].part, '机械密封', '13.9 「对象部件」归故障部位');
eq(r.json.matches[0].cause, '动环端面划伤', '13.10 「原因文本」归原因');
eq(r.json.matches[0].equipType, '离心泵', '13.11 「对象类型」归设备类型');
eq(r.json.matches[0].time, '2026-03-12', '13.12 「通知日期」归发生时间');
eq(r.json.matches[0].plant, '常减压装置', '13.13 「工厂区段」归装置');
ok(/IW28 第2行/.test(r.json.matches[0].origin), '13.14 出处写实际工作表名 IW28 而非写死「故障案例」');
eq(r.json.meta.sheet, 'IW28', '13.15 meta.sheet 记录实际工作表');
ok(/设备编号 \| 10023451/.test(r.md), '13.16 md 单列设备编号行');
ok(r.summary.warnings.some((w) => w.includes('缺少列「来源」')), '13.17 SAP 导出无「来源」列仍提示来源不可核实');

// ---- 14. --fault-code：SAP 损坏/原因代码相同者排序优先，不计入相似度
r = run(sap, ['--symptom', '轴承温度高', '--equip-type', '离心泵', '--fault-code', 'TEMP02'], 'code');
eq(r.summary.counts.codeHits, 2, '14.1 故障代码相同计数为 2');
ok(r.json.matches.concat(r.json.lowSimilarity).every((m) => (m.codeHit ? 1 : 0) >= 0), '14.2 每条案例带 codeHit 字段');
const ordered = r.json.matches.concat(r.json.lowSimilarity);
ok(r.json.matches[0].codeHit && r.json.matches[0].id === '10045902' && !r.json.matches[1].codeHit, '14.3 命中内代码相同者排在代码不同者之前（相似度下限仍先分层，代码不计入相似度）');
ok(ordered.filter((m) => m.codeHit).some((m) => m.matchBasis.some((b) => b.includes('故障代码同为「TEMP02」'))), '14.4 matchBasis 注明故障代码相同');
ok(ordered.filter((m) => !m.codeHit).every((m) => m.differences.some((d) => d.includes('故障代码不同'))), '14.5 代码不同者在不同点中注明');
ok(r.json.lowSimilarity.some((m) => m.codeHit && m.id === '10046118'), '14.6a 代码相同但设备类型不同、相似度低于下限者仍留在低相似度节，不被代码抬进命中');
ok(/【注意】故障代码相同/.test(r.md) || r.json.matches.length === 0, '14.6 md 命中标题带【注意】故障代码相同');
const noCodeRun = run(sap, ['--symptom', '轴承温度高', '--equip-type', '离心泵'], 'nocode');
const cmp = noCodeRun.json.matches.concat(noCodeRun.json.lowSimilarity).find((m) => m.id === '10045902');
const cmp2 = ordered.find((m) => m.id === '10045902');
eq(cmp.score, cmp2.score, '14.7 故障代码不改变相似度数值（只影响排序）');
r = run(lib, Q.concat(['--fault-code', 'LEAK01']), 'codenocol');
ok(r.summary.warnings.some((w) => w.includes('--fault-code') && w.includes('无「故障代码')), '14.8 案例库无代码列时 warning 提示代码维度未比对');
eq(r.summary.counts.codeHits, 0, '14.9 无代码列时代码命中为 0');
ok(/故障代码相同 \| —（未给 --fault-code）/.test(noCodeRun.md), '14.10 未给 --fault-code 时概览显示 — 而非 0');

// ---- 15. --weights 参数化（默认 text=0.55,type=0.30,part=0.15）
r = run(lib, Q.concat(['--part', '机械密封', '--weights', 'text=0.7,type=0.2,part=0.1']), 'w1');
eq(r.summary.ok, true, '15.1 合法 --weights 可运行');
eq(r.json.meta.weights.text, 0.7, '15.2 text 权重生效');
eq(r.json.meta.weights.part, 0.1, '15.3 part 权重生效');
eq(r.json.meta.weightsCustom, true, '15.4 meta 标记自定义权重');
ok(r.summary.warnings.some((w) => w.includes('自定义权重')), '15.5 自定义权重 warning 提示交付时须说明');
ok(/（自定义）/.test(r.md), '15.6 md 抬头标注（自定义）');
const d0 = run(lib, Q.concat(['--part', '机械密封']), 'w0');
ok(!/（自定义）/.test(d0.md) && /（默认）/.test(d0.md), '15.7 默认权重 md 标注（默认）且无（自定义）');
eq(d0.json.meta.weightsCustom, false, '15.8 默认时 weightsCustom 为 false');
ok(!d0.summary.warnings.some((w) => w.includes('自定义权重')), '15.9 默认权重不产生自定义 warning');
r = run(lib, Q.concat(['--weights', 'text=0.5,type=0.5']), 'w2');
eq(r.summary.ok, false, '15.10 三项之和不为 1 报错（缺省 part 取默认 0.15）');
ok(/之和应为 1/.test(r.summary.error), '15.11 和不为 1 的错误信息');
r = run(lib, Q.concat(['--weights', 'text=0,type=0.85,part=0.15']), 'w3');
eq(r.summary.ok, false, '15.12 text=0 报错');
ok(/text（现象文本）权重必须大于 0/.test(r.summary.error), '15.13 text=0 错误信息说明退化为按类型分组');
r = run(lib, Q.concat(['--weights', 'model=0.5']), 'w4');
eq(r.summary.ok, false, '15.14 未知键报错');
r = run(lib, Q.concat(['--weights', 'text=0.5,text=0.5']), 'w5');
eq(r.summary.ok, false, '15.15 重复键报错');
r = run(lib, Q.concat(['--weights', 'text=0.8,type=0.2,part=0']), 'w6');
eq(r.summary.ok, true, '15.16 part=0 合法');
r = run(lib, Q.concat(['--weights', 'text=0.6,type=0.4,part=0']), 'w7');
eq(r.json.meta.weights.text, 0.6, '15.17 未给 --part 时按 text/type 归一化（0.6/0.4 和为 1 保持）');
const pw = R.parseWeights('text=0.55,type=0.30,part=0.15');
eq(pw.w.part, 0.15, '15.18 parseWeights 导出可用');

// ---- 16. docx / md 案例库与 PDF 拒读
const HEADD = ['案例编号', '设备类型', '设备名称', '位号', '故障部位', '现象描述', '原因', '处置方式', '来源'];
const docxPath = path.join(work, 'cases.docx');
fs.writeFileSync(docxPath, lite.buildDocx([
  lite.pXml('故障案例汇编（虚构）', { bold: true }),
  lite.tblXml([HEADD.map((h) => ({ text: h, bold: true })),
    ['W-01', '离心泵', '回流泵A', 'P-01', '机械密封', '机封处滴漏，约5滴/分，泵体下方有油渍', '动环划伤', '更换机封', '本厂'],
    ['W-02', '汽轮机', '驱动汽轮机', 'GT-01', '轴承', '推力轴承温度升高，轴位移报警', '推力瓦脱落', '更换推力瓦', '本厂'],
  ]),
  lite.tblXml([HEADD.map((h) => ({ text: h, bold: true })),
    ['W-03', '挤压造粒机', '造粒机', 'EX-01', '联轴器', '主电机电流波动，减速箱侧有敲击声', '联轴器磨损', '更换联轴器', '本厂'],
  ]),
]));
r = run(docxPath, Q.concat(['--part', '机械密封']), 'docx');
eq(r.summary.ok, true, '16.1 docx 表格案例库可读');
eq(r.summary.counts.casesTotal, 3, '16.2 docx 两张表格按行合并为 3 条');
eq(r.json.matches[0].id, 'W-01', '16.3 docx 案例命中正确');
eq(r.json.meta.casesFormat, 'docx', '16.4 meta.casesFormat 为 docx');
ok(r.summary.warnings.some((w) => w.includes('多张案例表已按行合并')), '16.5 多表合并 warning');
const docxNoTbl = path.join(work, 'notable.docx');
fs.writeFileSync(docxNoTbl, lite.buildDocx([lite.pXml('只有段落没有表格')]));
r = run(docxNoTbl, Q, 'docxnotbl');
eq(r.summary.ok, false, '16.6 docx 无表格 → ok:false（本技能不可用）');
ok(/docx 中没有表格/.test(r.summary.error), '16.7 docx 无表格错误信息');
const mdPath = path.join(work, 'cases.md');
fs.writeFileSync(mdPath, ['# 案例', '', '| 案例编号 | 设备类型 | 故障部位 | 现象描述 | 处置方式 |', '|---|---|---|---|---|',
  '| M-01 | 离心泵 | 机械密封 | 机封处滴漏，泵体下方有油渍 | 更换机封 |', '| M-02 | 换热器 | 管束 | 壳程出口带水 | 堵管 |', ''].join('\n'));
r = run(mdPath, Q.concat(['--part', '机械密封']), 'md');
eq(r.summary.ok, true, '16.8 md 管道表格案例库可读');
eq(r.summary.counts.casesTotal, 2, '16.9 md 分隔行跳过，2 条可检索');
eq(r.json.matches[0].id, 'M-01', '16.10 md 案例命中正确');
const pdfPath = path.join(work, 'cases.pdf');
fs.writeFileSync(pdfPath, '%PDF-1.4 fake');
r = run(pdfPath, Q, 'pdf');
eq(r.summary.ok, false, '16.11 PDF 一律拒读 ok:false');
ok(/先用平台 pdf 技能/.test(r.summary.error), '16.12 PDF 错误信息写明前置转换');
ok(/扫描件需 OCR/.test(r.summary.error), '16.13 PDF 错误信息提示扫描件需 OCR');

// ---- 17. 设备类型归一：大机组细分，不与泛类混淆
eq(R.normType('裂解气压缩机'), '离心压缩机', '17.1 裂解气压缩机归离心压缩机');
eq(R.normType('汽轮机'), '汽轮机', '17.2 汽轮机独立归类');
eq(R.normType('蒸汽透平'), '汽轮机', '17.3 蒸汽透平归汽轮机');
eq(R.normType('挤压造粒机'), '挤压造粒机', '17.4 挤压造粒机独立归类');
eq(R.normType('螺杆压缩机'), '螺杆压缩机', '17.5 螺杆压缩机独立归类，不归泛压缩机');
eq(R.normType('往复式压缩机'), '往复压缩机', '17.6 往复式压缩机归往复压缩机');
eq(R.normType('氢压机'), '往复压缩机', '17.7 氢压机归往复压缩机');
ok(R.normType('汽轮机') !== R.normType('离心压缩机'), '17.8 汽轮机与离心压缩机不同类');
eq(R.normType('主风机'), '风机', '17.9 主风机归风机');
eq(R.normPart('干气密封'), '机械密封', '17.10 干气密封归机械密封');
r = run(lib, ['--symptom', '推力轴承温度升高，轴位移报警', '--equip-type', '蒸汽透平'], 'turbine');
eq(r.summary.counts.matches, 0, '17.11 案例库无汽轮机案例时检索蒸汽透平命中为空（不拿离心泵轴承案例充数）');
ok(r.json.lowSimilarity.every((x) => !x.typeHit), '17.12 低分案例均未命中设备类型');

// ---- 18. 术语与声明：通用声明行、【注意】不用 emoji、PDF 与下游互指
ok(r.md.includes('本材料由脚本汇总、模型成文，仅供设备员复核参考，不替代审批、定性、验收与签字；厂内制度与系统数据为准。'), '18.1 通用声明行写入 md');
eq(r.json.meta.disclaimerGeneral, R.DISCLAIMER_GENERAL, '18.2 通用声明行写入 cases.json');
ok(!/[✅⚠️❌]/.test(d0.md), '18.3 md 不含 emoji');
ok(!/EAM|机动处|动火/.test(d0.md), '18.4 md 不含 EAM/机动处/动火 旧术语');
ok(/repeat-failure-detector/.test(d0.md) && /equipment-knowledge-qa/.test(d0.md), '18.5 md 互指 repeat-failure-detector 与 equipment-knowledge-qa');
r = run(exportStyle, Q, 'notice');
ok(/【注意】以下提示须逐条告知用户/.test(r.md), '18.6 warnings 用【注意】提示');
x = runRaw(['--cases', lib].concat(Q));
eq(x.s.ok, true, '18.7 不给 --out 可运行');
ok(x.s.out.startsWith(os.tmpdir()), '18.8 默认输出目录在系统临时目录');
try { fs.rmSync(x.s.out, { recursive: true, force: true }); } catch (e) {}
x = runRaw(['--help']);
ok(x.s.ok === true && /--weights/.test(x.s.usage) && /--fault-code/.test(x.s.usage), '18.9 --help 列出 --weights 与 --fault-code');

// ---- 输出
console.log(`\n${'='.repeat(56)}`);
console.log(`failure-case-retrieval 自测：${pass} 通过，${fail} 失败`);
if (failures.length) { console.log('\n失败项：'); failures.forEach((f) => console.log('  ✗ ' + f)); }
console.log('='.repeat(56));
try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
