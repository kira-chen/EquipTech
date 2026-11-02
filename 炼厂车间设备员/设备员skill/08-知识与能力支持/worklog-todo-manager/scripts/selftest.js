#!/usr/bin/env node
'use strict';
/**
 * 自测：生成变体输入并断言 todo.js 行为。用法：node scripts/selftest.js（全绿退出 0）
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { writeXlsx } = require('./lib/xlsx-lite');

const TODO = path.join(__dirname, 'todo.js');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wtm-selftest-'));
const DATE = '2026-09-21';
const D = (n) => new Date(Date.parse(DATE + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
let pass = 0, fail = 0;
const failures = [];

function ok(cond, name) { if (cond) { pass++; } else { fail++; failures.push(name); } }
function eq(actual, expect, name) { ok(actual === expect, `${name}（期望 ${JSON.stringify(expect)}，实际 ${JSON.stringify(actual)}）`); }

function run(input, extra = [], tag, date = DATE) {
  const out = path.join(work, (tag || 'out') + '-out');
  const r = spawnSync(process.execPath, [TODO, '--input', input, '--owner', '张设备', '--date', date, '--out', out, ...extra], { encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  let summary;
  try { summary = JSON.parse(lines[lines.length - 1]); } catch (e) { summary = { ok: false, error: 'no-json:' + r.stdout + r.stderr }; }
  const rd = (f) => (fs.existsSync(path.join(out, f)) ? fs.readFileSync(path.join(out, f), 'utf8') : null);
  const todo = fs.existsSync(path.join(out, 'todo.json')) ? JSON.parse(rd('todo.json')) : null;
  return { code: r.status, summary, todo, list: rd('待办清单.md'), log: rd('工作日志.md'), out };
}
function mkj(name, obj) { const p = path.join(work, name); fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8'); return p; }
function mkx(name, book) { const p = path.join(work, name); writeXlsx(p, book); return p; }
function mkt(name, text) { const p = path.join(work, name); fs.writeFileSync(p, text, 'utf8'); return p; }

// ================================ 1. 多源 JSON 合并
const orders = mkj('orders.json', {
  byStatus: [], stalled: [
    { no: 'WO-2', tag: 'K-01', name: '压缩机', status: '维修中', lastNode: '开工时间', lastTime: D(-15) + ' 09:00', idleDays: 15, party: '钳工班' },
  ],
  overdue: [{ no: 'WO-1', tag: 'P-01', name: '泵1', fault: '机封漏', status: '维修中', priority: '高', dueAt: D(-5), overdueDays: 5, party: '钳工班', reason: '备件未到', source: '工单台账 第3行' }],
  dueSoon: [{ no: 'WO-3', tag: 'V-01', name: '罐1', status: '维修中', priority: '中', dueAt: D(3), daysLeft: 3, party: '铆焊班' }],
  counts: {}, closed: [],
});
const hazard = mkj('hazard.json', {
  majorHazards: [], unverified: [{ no: 'YH-3', desc: '照明缺失', level: 'general', levelCn: '一般隐患', owner: '张', deadline: D(-2), measure: '补装灯具', unverifiedReason: '无验收记录', sheet: '隐患台账', row: 11 }],
  overdue: [{ no: 'YH-1', desc: '消防水炮阀门锈死', level: 'major', levelCn: '重大隐患', owner: '张', unit: '车间', deadline: D(-10), overdueDays: 10, measure: '更换阀门', sheet: '隐患台账', row: 3 }],
  dueSoon: [{ no: 'YH-2', desc: '护栏变形', level: 'general', levelCn: '一般隐患', owner: '张', deadline: D(3), daysToDeadline: 3, sheet: '隐患台账', row: 7 }],
  counts: {},
});
const insp = mkj('inspection.json', {
  dateConflict: [], prepMaterials: [], byCategory: [],
  overdue: [{ tag: 'V-02', name: '缓冲罐', category: '压力容器', regCode: 'R001', unit: '车间', nextDate: D(-25), overdueDays: 25, sheet: '特种设备台账', row: 5 }],
  dueSoon: [{ tag: 'V-03', name: '回流罐', category: '压力容器', regCode: 'R002', unit: '车间', nextDate: D(5), remainDays: 5, sheet: '特种设备台账', row: 18 }],
  counts: {},
});
const cal = mkj('calibration.json', {
  unresolvedFail: [{ tag: 'TT-01', category: '温度变送器', name: '炉出口温度', lastDate: D(-60), resultRaw: '不合格', cert: 'C3', sheet: '校验台账', row: 41 }],
  sendList: [],
  overdue: [{ tag: 'PSV-01', category: '安全阀', name: '塔顶安全阀', nextDate: D(-33), overdueDays: 33, safetyCritical: true, cert: 'C1', sheet: '校验台账', row: 9 }],
  dueSoon: [{ tag: 'PT-01', category: '压力变送器', name: '塔顶压力', nextDate: D(6), daysLeft: 6, safetyCritical: false, cert: 'C2', sheet: '校验台账', row: 22 }],
  counts: {},
});
const lube = mkj('lube.json', {
  oilAnalysis: { provided: false }, consumption: null,
  overdue: [{ tag: 'P-02', name: '渣油泵A', part: '轴承箱', oil: 'L-TSA 46', mode: '油浴', dueDate: D(-12), overdueDays: 12, level: '轻微逾期', sheet: '润滑台账', row: 14 }],
  dueSoon: [{ tag: 'P-03', name: '回流泵A', part: '轴承箱', oil: 'L-TSA 46', mode: '油浴', dueDate: D(4), remainDays: 4, sheet: '润滑台账', row: 6 }],
  counts: {},
});
const defects = mkj('defects.json', {
  counts: { byLevel: { 'B（较重）': 1, 未定级: 1 } },
  defects: [
    { no: 'QX-1', tag: 'P-01', name: '泵1', desc: '机封滴漏约5滴/分', level: 'B', levelCn: 'B（较重）', basis: '泄漏', foundAt: D(-6) + ' 08:20', by: '张班', dueDate: D(1), srcRow: 2 },
    { no: 'QX-2', tag: 'M-01', name: '电机', desc: '运行有异响', level: 'undetermined', levelCn: '未定级', basis: '是否影响运行未填写', foundAt: D(-2) + ' 10:20', by: '张班', dueDate: null, srcRow: 3 },
  ],
});
const ALLJ = [orders, hazard, insp, cal, lube, defects].join(',');

let r = run(ALLJ, [], 'multi');
eq(r.summary.ok, true, '1.1 多源 JSON 合并运行成功');
eq(r.summary.counts.sources, 6, '1.2 识别到 6 个来源');
eq(r.summary.counts.total, 15, '1.3 待办总数（工单3+隐患3+定检2+校验3+润滑2+缺陷2=15）');
ok(r.todo.byCategory.length === 6, '1.4 byCategory 覆盖 6 类来源');
ok(r.todo.items.some((x) => x.kind === 'orders' && x.sub === 'stalled'), '1.5 工单 stalled 被纳入待办');
ok(r.todo.items.some((x) => x.kind === 'hazard' && x.sub === 'unverified'), '1.6 隐患 unverified 被纳入待办');
ok(r.todo.items.some((x) => x.kind === 'calibration' && x.sub === 'unresolvedFail'), '1.7 校验 unresolvedFail 被纳入待办');
ok(r.todo.items.some((x) => x.kind === 'defects' && x.refNo === 'QX-1'), '1.8 缺陷按 dueDate 纳入待办');

// ================================ 2. 逾期天数计算
const od = r.todo.overdue.find((x) => x.refNo === 'YH-1');
eq(od.overdueDays, 10, '2.1 隐患逾期天数 = 基准日 − 到期日');
eq(od.dueDate, D(-10), '2.2 逾期项保留原始到期日');
eq(r.summary.counts.maxOverdueDays, 33, '2.3 最长逾期天数取自 PSV-01（33 天）');
eq(r.todo.overdue.every((x) => x.overdueDays > 0), true, '2.4 逾期桶内全部 overdueDays > 0');
eq(r.todo.upcoming.every((x) => x.daysLeft > 0 && x.daysLeft <= 7), true, '2.5 前瞻期内 0 < daysLeft ≤ 7');

// ================================ 3. --horizon
r = run(ALLJ, ['--horizon', '3'], 'h3');
eq(r.summary.counts.upcoming, 3, '3.1 horizon=3 时前瞻期内 3 项');
ok(r.summary.counts.later >= 1, '3.2 超出前瞻期的项进入 later，未被丢弃');
eq(r.summary.counts.total, 15, '3.3 缩小前瞻期不改变待办总数');
r = run(ALLJ, ['--horizon', 'abc'], 'hbad');
eq(r.summary.ok, false, '3.4 --horizon 非数字报错');

// ================================ 4. 无到期日不自设
r = run(ALLJ, [], 'nodue');
const nd = r.todo.noDueDate;
eq(r.summary.counts.noDueDate, 3, '4.1 无到期日 3 项（工单停滞 / 校验不合格未整改 / 缺陷未定级）');
eq(nd.every((x) => x.dueDate === null), true, '4.2 无到期日项 dueDate 恒为 null');
eq(nd.every((x) => !!x.noDueReason), true, '4.3 每项均写明无到期日原因');
ok(r.todo.warnings.some((w) => w.includes('未自行设定到期日')), '4.4 warning 声明未自行设定到期日');
ok(/## 五、无到期日/.test(r.list) && /未自行设定/.test(r.list), '4.5 清单中无到期日单列成节');
ok(!nd.some((x) => x.bucket === 'overdue' || x.bucket === 'today'), '4.6 无到期日项不混入逾期/今日');

// ================================ 5. 疑似重复不自动合并
// P-01 同时出现在工单超期与缺陷跟进
const dup = r.todo.possibleDuplicate.find((x) => x.anchor === 'P-01');
ok(!!dup, '5.1 识别出 P-01 跨来源疑似重复');
eq(dup.items.length, 2, '5.2 疑似重复组保留两条原始待办');
ok(dup.note.includes('不自动合并'), '5.3 注明不自动合并');
eq(r.todo.items.filter((x) => x.tag === 'P-01').length, 2, '5.4 两条待办均保留在 items 中，未被合并删除');
ok(r.todo.warnings.some((w) => w.includes('疑似重复')), '5.5 疑似重复进 warnings');
ok(/## 八、疑似重复/.test(r.list), '5.6 清单中疑似重复单列成节');

// 同文本重复
const t1 = mkt('t1.txt', '- 核对备件台账\n');
const t2 = mkt('t2.txt', '- 核对备件台账\n');
let rr = run(t1 + ',' + t2, [], 'dup-text');
eq(rr.summary.counts.possibleDuplicate, 1, '5.7 文字完全一致的两条待办被标为疑似重复');
eq(rr.summary.counts.total, 2, '5.8 文字重复项未自动合并，总数仍为 2');

// ================================ 6. 结转：不丢、不延期、保留原始来源
const prevRun = run(ALLJ, ['--done', '完成A'], 'prevsrc');
const prevPath = path.join(prevRun.out, 'todo.json');
r = run(orders, ['--prev', prevPath], 'carry', '2026-09-22');
eq(r.summary.ok, true, '6.1 结转运行成功');
eq(r.summary.counts.carriedOver, 15, '6.2 上一日 15 项全部结转，未丢失');
eq(r.summary.counts.total, 15, '6.3 本日仅工单 1 个来源，结转后总数仍为 15（同事项未重复计）');
const ch = r.todo.carriedOver.find((x) => x.refNo === 'YH-1');
eq(ch.dueDate, D(-10), '6.4 结转项到期日原样保留，未自动延期');
eq(ch.originalDueDate, D(-10), '6.5 originalDueDate 记录原始到期日');
eq(ch.carriedFrom, DATE, '6.6 carriedFrom 记录结转自哪一天');
eq(ch.carriedRounds, 1, '6.7 首次结转轮次为 1');
ok(ch.originalSource.includes('隐患整改'), '6.8 结转项保留原始来源类型');
eq(ch.overdueDays, 11, '6.9 结转后逾期天数按新基准日重算（10→11），到期日不变');
ok(/结转自 2026-09-21/.test(r.list), '6.10 清单中标注「结转自 X 月 X 日」');
ok(/## 六、结转项/.test(r.list) && /不自动延期/.test(r.list), '6.11 结转节声明不自动延期');
// 二次结转
const r2 = run(orders, ['--prev', path.join(r.out, 'todo.json')], 'carry2', '2026-09-23');
const ch2 = r2.todo.carriedOver.find((x) => x.refNo === 'YH-1');
eq(ch2.carriedRounds, 2, '6.12 二次结转轮次累加为 2');
eq(ch2.carriedFrom, DATE, '6.13 二次结转仍指向最早结转日期');
eq(ch2.dueDate, D(-10), '6.14 二次结转到期日依旧未被延期');
// 本日来源中再次出现的同一事项：合并结转标记而非重复列
eq(r.todo.items.filter((x) => x.refNo === 'WO-1').length, 1, '6.15 本日再次出现的工单未被重复列入');
ok(r.todo.items.find((x) => x.refNo === 'WO-1').carried === true, '6.16 再次出现的工单被标记为结转项');
// --prev 不存在
r = run(orders, ['--prev', path.join(work, '不存在.json')], 'prevmiss');
eq(r.summary.ok, false, '6.17 --prev 文件不存在时报错');

// ================================ 7. 无法识别的 JSON
const unknown = mkj('unknown.json', { meta: { note: '不相干系统' }, rows: [{ a: 1 }] });
r = run(orders + ',' + unknown, [], 'unknown');
eq(r.summary.ok, true, '7.1 无法识别的 JSON 不中断运行');
eq(r.summary.counts.sources, 1, '7.2 无法识别的 JSON 不计入来源');
ok(r.todo.warnings.some((w) => w.includes('无法识别')), '7.3 warning 提示无法识别');
eq(r.summary.counts.total, 3, '7.4 其余来源的待办正常汇集');
// 全部无法识别 → 报错
r = run(unknown, [], 'allunknown');
eq(r.summary.ok, false, '7.5 全部来源均无法识别时 ok:false');
eq(r.code, 1, '7.6 退出码为 1');

// ================================ 8. xlsx 待办表
const sheet = mkx('todo.xlsx', {
  '待办清单': [
    ['本人待办登记表'],
    [],
    ['事项', '到期日', '来源', '优先级', '位号', '责任人', '状态', '备注'],
    ['整理三季度备件申报表', D(-2), '上级交办', '高', '', '张设备', '进行中', ''],
    ['参加车间安全例会', DATE, '车间例会', '中', '', '张设备', '待办', ''],
    ['联系厂家询价机封备件', '', '自记', '中', 'P-01', '张设备', '待办', ''],
    ['提交上月设备月报', D(-10), '上级交办', '高', '', '张设备', '已完成', ''],
    ['日期写错的一项', '下周三', '自记', '低', '', '张设备', '待办', ''],
    ['合计', '', '', '', '', '', '', ''],
  ],
});
r = run(sheet, [], 'sheet');
eq(r.summary.ok, true, '8.1 xlsx 待办表可读');
eq(r.summary.counts.total, 4, '8.2 已完成项不进待办、合计行跳过');
eq(r.summary.counts.overdue, 1, '8.3 逾期 1 项');
eq(r.summary.counts.today, 1, '8.4 今日到期 1 项');
eq(r.summary.counts.noDueDate, 2, '8.5 无到期日 2 项（空值 + 无法解析）');
ok(r.todo.warnings.some((w) => w.includes('合计行')), '8.6 合计行 warning');
ok(r.todo.warnings.some((w) => w.includes('无法解析') && w.includes('未自行设定到期日')), '8.7 到期日无法解析时按无到期日处理并 warning');
ok(r.todo.items.find((x) => x.title.includes('备件申报')).priority === 'P2', '8.8 表中「高」优先级归为 P2');
// 无「待办」工作表
const nosheet = mkx('nosheet.xlsx', { '随便一张表': [['a', 'b'], [1, 2]] });
r = run(orders + ',' + nosheet, [], 'nosheet');
eq(r.summary.ok, true, '8.9 xlsx 缺「待办」表不中断');
ok(r.todo.warnings.some((w) => w.includes('未找到「待办」类工作表')), '8.10 缺表 warning');

// ================================ 9. 纯文字待办
const txt = mkt('todo.txt', '# 随手记\n- 找电气班确认绝缘测试，截止 ' + D(4) + '\n- 把检修总结补进技术档案\n1. 给实习生讲巡检路线\n');
r = run(txt, [], 'text');
eq(r.summary.ok, true, '9.1 纯文字待办可读');
eq(r.summary.counts.total, 3, '9.2 文字待办 3 条（markdown 标题行跳过）');
eq(r.summary.counts.upcoming, 1, '9.3 行内「截止 日期」被识别');
eq(r.summary.counts.noDueDate, 2, '9.4 未写日期的 2 条进无到期日');

// ================================ 10. --done 提供与不提供
r = run(orders, ['--done', '完成 P-02 加油；参加晨会\n核对备件台账'], 'done');
eq(r.summary.counts.done, 3, '10.1 --done 按换行与分号拆成 3 条');
eq(r.todo.done[0], '完成 P-02 加油', '10.2 已完成事项内容正确');
ok(/## 一、今日完成事项/.test(r.log) && /参加晨会/.test(r.log), '10.3 工作日志写入完成事项');
r = run(orders, [], 'nodone');
eq(r.todo.done, null, '10.4 未提供 --done 时 done 为 null，不推断');
eq(r.summary.counts.done, null, '10.5 counts.done 为 null 不为 0');
ok(r.todo.warnings.some((w) => w.includes('未提供 --done')), '10.6 未提供 --done 有 warning');
ok(/脚本不推断已完成事项/.test(r.log), '10.7 日志说明不推断已完成事项');

// ================================ 11. 参数校验
function runRaw(args) {
  const rr = spawnSync(process.execPath, [TODO, ...args], { encoding: 'utf8' });
  const lines = rr.stdout.trim().split('\n');
  try { return { code: rr.status, s: JSON.parse(lines[lines.length - 1]) }; } catch (e) { return { code: rr.status, s: { ok: false, error: 'no-json' } }; }
}
let x = runRaw([]);
eq(x.s.ok, false, '11.1 空输入报错');
ok(/缺少 --input/.test(x.s.error), '11.2 空输入错误信息明确');
eq(x.code, 1, '11.3 空输入退出码 1');
x = runRaw(['--input']);
eq(x.s.ok, false, '11.4 --input 缺值报错');
ok(/缺少取值/.test(x.s.error), '11.5 缺值错误信息正确');
x = runRaw(['--input', orders, '--owner', '张', '--date', '2026-13-45']);
eq(x.s.ok, false, '11.6 非法日期报错');
x = runRaw(['--input', orders, '--date', DATE]);
eq(x.s.ok, false, '11.7 缺 --owner 报错');
x = runRaw(['--input', orders, '--owner', '张', '--date', DATE, '--未知参数', 'v']);
eq(x.s.ok, false, '11.8 未知参数报错');
x = runRaw(['--input', '/不存在的路径.json', '--owner', '张', '--date', DATE]);
eq(x.s.ok, false, '11.9 输入不存在报错');

// ================================ 12. 优先级排序口径
r = run(ALLJ, [], 'prio');
ok(r.todo.overdue[0].priority === 'P1', '12.1 逾期首项为 P1');
eq(r.todo.items.find((x) => x.refNo === 'YH-1').priority, 'P1', '12.2 重大隐患 → P1');
eq(r.todo.items.find((x) => x.tag === 'PSV-01').priority, 'P1', '12.3 安全联锁类超期校验 → P1');
eq(r.todo.items.find((x) => x.tag === 'V-02').priority, 'P1', '12.4 特种设备定检超期 → P1');
eq(r.todo.items.find((x) => x.tag === 'P-02').priority, 'P3', '12.5 润滑逾期 → P3');
eq(r.todo.items.find((x) => x.tag === 'P-03').priority, 'P4', '12.6 润滑临期 → P4');
// 同优先级内逾期天数多者靠前
const p1 = r.todo.overdue.filter((y) => y.priority === 'P1');
eq(p1.every((y, i) => i === 0 || p1[i - 1].overdueDays >= y.overdueDays), true, '12.7 同优先级内逾期天数递减排列');

// ================================ 13. 产出与声明
ok(fs.existsSync(path.join(r.out, 'summary.json')), '13.1 summary.json 已落盘');
eq(JSON.parse(fs.readFileSync(path.join(r.out, 'summary.json'), 'utf8')).ok, true, '13.2 summary.json 内容正确');
ok(fs.existsSync(path.join(r.out, '待办清单.md')) && fs.existsSync(path.join(r.out, '工作日志.md')), '13.3 两份 md 均已生成');
const STMT = '待办汇集自所提供来源，覆盖范围见清单说明；厂内业务系统（EM/SAP PM）中的待办请以系统为准';
const STMT2 = '本材料由脚本汇总、模型成文，仅供设备员复核参考';
ok(r.list.includes(STMT2) && r.log.includes(STMT2), '13.3b 两份 md 均含通用声明行');
ok(!/EAM/.test(r.list) && !/EAM/.test(r.log), '13.3c 产出不再出现「EAM」');
ok(!/[⚠✅]/.test(r.list) && !/[⚠✅]/.test(r.log), '13.3d 产出不含 emoji');
ok(r.list.includes(STMT), '13.4 待办清单含必备声明行');
ok(r.log.includes(STMT), '13.5 工作日志含必备声明行');
eq(r.todo.meta.statement.includes(STMT), true, '13.6 todo.json meta 含声明');
ok(/## 一、待办概况/.test(r.list) && /## 二、已逾期/.test(r.list) && /## 三、今日到期/.test(r.list)
  && /## 四、近期/.test(r.list) && /## 五、无到期日/.test(r.list) && /## 六、结转项/.test(r.list)
  && /## 七、按来源分类/.test(r.list) && /## 八、疑似重复/.test(r.list), '13.7 待办清单八节齐全');
ok(/## 一、今日完成事项/.test(r.log) && /## 二、待办概况/.test(r.log)
  && /## 三、需协调事项/.test(r.log) && /## 四、明日重点/.test(r.log), '13.8 工作日志四节齐全');
ok(/<!-- ANALYSIS_START -->/.test(r.log) && /<!-- ANALYSIS_END -->/.test(r.log), '13.9 日志分析段占位符存在');
ok(!/## 六、结转项[\s\S]{0,120}未提供上一日/.test(r.list) === false || /未提供上一日/.test(r.list), '13.10 未传 --prev 时结转节说明未做结转');

// ================================ 14. 工作交接 handover.json（shift-handover-record）作为来源
const handover = mkj('handover.json', {
  meta: { skill: 'shift-handover-record', workshop: '常减压车间', shift: '值班交接', handoverAt: D(-1) + ' 17:00', declaration: '交接以双方现场确认签字为准' },
  counts: { pending: 3 },
  pending: [
    { tag: 'P-01', name: '泵1', content: '机封备件到货后安排更换', state: '未完成', owner: '李维修', due: D(-3), dueText: D(-3), source: '常减压车间 值班交接', originShift: '常减压车间 值班交接', carried: false, carryTimes: 0, sheet: '未完成事项', row: 4 },
    { tag: 'E-1201', name: '换热器', content: '法兰复紧后观察 24 小时', state: '未完成', owner: '张设备', due: D(2), dueText: D(2), source: '常减压车间 值班交接', originShift: '常减压车间 值班交接', carried: true, carryTimes: 2, sheet: '未完成事项', row: 5 },
    { tag: '（待补）', name: '', content: '联系仪表车间确认 TT-1308 复校时间', state: '未判定', owner: '（待补）', due: null, dueText: '（待补）', source: '常减压车间 值班交接', originShift: '常减压车间 值班交接', carried: false, carryTimes: 0, sheet: '未完成事项', row: 6 },
  ],
  focusItems: [], carriedOver: [], warnings: [],
});
r = run(handover, [], 'handover');
eq(r.summary.ok, true, '14.1 handover.json 可作为来源');
eq(r.summary.counts.sources, 1, '14.2 识别为 1 个来源');
ok(r.summary.sources[0].includes('工作交接'), '14.3 来源类型标为「工作交接」');
eq(r.summary.counts.total, 3, '14.4 pending 3 条全部纳入待办');
eq(r.summary.counts.overdue, 1, '14.5 期限已过的交接事项按本日基准判逾期');
eq(r.summary.counts.upcoming, 1, '14.6 期限在前瞻期内的进近期');
eq(r.summary.counts.noDueDate, 1, '14.7 未写期限的交接事项进无到期日，不自设');
const hv = r.todo.items.find((x) => x.tag === 'P-01');
eq(hv.priority, 'P1', '14.8 期限已过的交接未完成事项 P1');
eq(r.todo.items.find((x) => x.tag === 'E-1201').priority, 'P2', '14.9 未到期的交接事项 P2');
eq(hv.dueDate, D(-3), '14.10 交接事项期限原样保留，未改写');
ok(/交接记录中已连续结转 2 次/.test(r.todo.items.find((x) => x.tag === 'E-1201').detail), '14.11 交接记录自身的结转次数带入 detail');
ok(/交接未完成｜/.test(hv.title), '14.12 标题带「交接未完成」前缀');
ok(r.todo.noDueDate[0].noDueReason.includes('交接记录未写明期限'), '14.13 无到期日原因写明来自交接记录');
ok(r.todo.byCategory.some((x) => x.kind === 'handover'), '14.14 byCategory 含工作交接类');
ok(!r.todo.warnings.some((w) => w.includes('按结构')), '14.15 带 meta.skill 时不出推断 warning');
// 旧版 handover.json（无 meta.skill）：按结构推断 + warning
const handoverOld = mkj('handover-old.json', {
  meta: { workshop: '常减压车间', shift: '白班', handoverAt: D(-1) + ' 17:00' },
  counts: {}, pending: [{ tag: 'K-1501', content: '压缩机油温偏高跟踪', state: '未完成', owner: '王', due: D(1) }], focusItems: [], carriedOver: null,
});
r = run(handoverOld, [], 'handover-old');
eq(r.summary.ok, true, '14.16 无 meta.skill 的旧版 handover.json 仍可识别');
ok(r.todo.warnings.some((w) => w.includes('按结构') && w.includes('shift-handover-record')), '14.17 旧版按结构推断并 warning');
eq(r.summary.counts.total, 1, '14.18 旧版 pending 纳入');
// 交接 + 工单 同位号 → 疑似重复，不合并
r = run(handover + ',' + orders, [], 'handover-dup');
ok(r.todo.possibleDuplicate.some((d) => d.anchor === 'P-01' && d.items.length === 2), '14.19 交接与工单同位号 P-01 判疑似重复，不合并');
eq(r.summary.counts.total, 6, '14.20 交接 3 + 工单 3，未自动合并');
// 不带 pending 数组的 JSON 不被误识别为交接
const notHandover = mkj('not-handover.json', { meta: { skill: 'shift-handover-record' }, pending: '不是数组' });
r = run(notHandover + ',' + orders, [], 'not-handover');
ok(r.todo.warnings.some((w) => w.includes('无法识别')), '14.21 pending 非数组时不识别为交接记录');

// ================================ 15. 优先级口径：SAP 1~4 / 缺陷 A/B/C / 旧 I~IV 映射 warning
const ordersSap = mkj('orders-sap.json', {
  byStatus: [], stalled: [],
  overdue: [
    { no: 'WO-S1', tag: 'P-S1', priority: '1 非常高', dueAt: D(-2), overdueDays: 2 },
    { no: 'WO-S2', tag: 'P-S2', priority: 2, dueAt: D(-2), overdueDays: 2 },
    { no: 'WO-S3', tag: 'P-S3', priority: '3', dueAt: D(-2), overdueDays: 2 },
    { no: 'WO-S4', tag: 'P-S4', priority: '紧急', dueAt: D(-2), overdueDays: 2 },
  ],
  dueSoon: [{ no: 'WO-S5', tag: 'P-S5', priority: '4 低', dueAt: D(2) }, { no: 'WO-S6', tag: 'P-S6', priority: 1, dueAt: D(2) }],
  counts: {}, closed: [],
});
r = run(ordersSap, [], 'orders-sap');
const pr = (no) => r.todo.items.find((x) => x.refNo === no).priority;
eq(pr('WO-S1'), 'P1', '15.1 SAP「1 非常高」→ P1');
eq(pr('WO-S2'), 'P1', '15.2 SAP 2 高 + 超期 → P1');
eq(pr('WO-S3'), 'P2', '15.3 SAP 3 中 + 超期 → P2');
eq(pr('WO-S4'), 'P1', '15.4 中文「紧急」仍 → P1');
eq(pr('WO-S5'), 'P3', '15.5 SAP「4 低」临期 → P3');
eq(pr('WO-S6'), 'P1', '15.6 SAP 1 临期也 → P1');
const defectsAbc = mkj('defects-abc.json', {
  counts: { byLevel: {} },
  defects: [
    { no: 'QX-A', tag: 'P-A', desc: 'a', level: 'A', levelCn: 'A 级（重大）', dueDate: D(1), srcRow: 2 },
    { no: 'QX-B', tag: 'P-B', desc: 'b', level: 'B', levelCn: 'B 级（严重）', dueDate: D(1), srcRow: 3 },
    { no: 'QX-C', tag: 'P-C', desc: 'c', level: 'C', levelCn: 'C 级（一般）', dueDate: D(1), srcRow: 4 },
    { no: 'QX-I', tag: 'P-I', desc: 'i', level: 'I', levelCn: 'I 级（紧急）', dueDate: D(1), srcRow: 5 },
    { no: 'QX-IV', tag: 'P-IV', desc: 'iv', level: 'IV', levelCn: 'IV 级（轻微）', dueDate: D(1), srcRow: 6 },
    { no: 'QX-U', tag: 'P-U', desc: 'u', level: 'undetermined', levelCn: '未定级', dueDate: null, srcRow: 7 },
  ],
});
r = run(defectsAbc, [], 'defects-abc');
const dp = (no) => r.todo.items.find((x) => x.refNo === no);
eq(dp('QX-A').priority, 'P1', '15.7 缺陷 A 级（重大）→ P1');
eq(dp('QX-B').priority, 'P2', '15.8 缺陷 B 级（严重）→ P2');
eq(dp('QX-C').priority, 'P3', '15.9 缺陷 C 级（一般）→ P3');
eq(dp('QX-I').priority, 'P1', '15.10 旧 I 级映射 A → P1');
eq(dp('QX-IV').priority, 'P3', '15.11 旧 IV 级映射 C → P3');
ok(/A 级（重大）/.test(dp('QX-I').title), '15.12 旧口径标题改写为新口径等级名');
ok(r.todo.warnings.filter((w) => w.includes('旧 I~IV 口径')).length === 2, '15.13 旧口径两条各 warning 一次');
eq(dp('QX-U').priority, 'P3', '15.14 未定级 → P3，不猜测');
ok(!r.todo.warnings.some((w) => w.includes('QX-A') && w.includes('旧')), '15.15 新口径不触发旧口径 warning');
// 待办表优先级写法：SAP 数字 / A 级 / 旧 I 级
const sheetPrio = mkx('todo-prio.xlsx', {
  '待办清单': [
    ['工作事项', '要求完成日期', '紧急程度', '功能位置', '工单号', '责任人', '状态'],
    ['SAP 1 写法', D(1), '1 非常高', 'P-X1', 'WO-X1', '张', '待办'],
    ['A 级写法', D(1), 'A级', 'P-X2', '', '张', '待办'],
    ['旧 II 级写法', D(1), 'II级', 'P-X3', '', '张', '待办'],
    ['三级写法', D(1), '三级', 'P-X4', '', '张', '待办'],
    ['无法归类写法', D(1), '随便', 'P-X5', '', '张', '待办'],
  ],
});
r = run(sheetPrio, [], 'sheet-prio');
eq(r.summary.ok, true, '15.16 系统导出列名（工作事项/要求完成日期/紧急程度/功能位置/工单号）可读');
const sp = (t) => r.todo.items.find((x) => x.title === t);
eq(sp('SAP 1 写法').priority, 'P1', '15.17 待办表「1 非常高」→ P1');
eq(sp('A 级写法').priority, 'P1', '15.18 待办表「A级」→ P1');
eq(sp('旧 II 级写法').priority, 'P2', '15.19 待办表「II级」→ P2');
eq(sp('三级写法').priority, 'P3', '15.20 待办表「三级」→ P3');
eq(sp('无法归类写法').priority, 'P3', '15.21 无法归类按默认 P3，prioFromUser=false');
eq(sp('无法归类写法').prioFromUser, false, '15.22 无法归类不标 prioFromUser');
ok(r.todo.warnings.some((w) => w.includes('II级') && w.includes('旧 I~IV')), '15.23 待办表旧口径 warning 具体到行');
eq(sp('SAP 1 写法').tag, 'P-X1', '15.24 「功能位置」列识别为位号（SYSTEM_ALIASES）');
eq(sp('SAP 1 写法').refNo, 'WO-X1', '15.25 「工单号」列识别为编号');

// ================================ 16. 默认输出目录为系统临时目录；make-sample 的交接与 SAP 风格样例
{
  const xx = spawnSync(process.execPath, [TODO, '--input', orders, '--owner', '张', '--date', DATE], { encoding: 'utf8' });
  const lines = xx.stdout.trim().split('\n');
  let sj; try { sj = JSON.parse(lines[lines.length - 1]); } catch (e) { sj = { ok: false }; }
  ok(sj.ok === true && String(sj.out).startsWith(os.tmpdir()), '16.1 未传 --out 时默认写入系统临时目录');
  ok(!fs.existsSync(path.join(path.dirname(orders), 'wtm-out')), '16.2 未在输入文件同目录生成 wtm-out');
  try { fs.rmSync(sj.out, { recursive: true, force: true }); } catch (e) {}
}
const MS = path.join(__dirname, 'make-sample.js');
const msOut = path.join(work, 'ms');
const ms = spawnSync(process.execPath, [MS, '--out', msOut, '--seed', '5', '--date', DATE], { encoding: 'utf8' });
const msj = JSON.parse(ms.stdout.trim().split('\n').pop());
ok(msj.ok && msj.files.includes('sample-handover.json') && msj.files.includes('sample-todo-sap-style.xlsx'), '16.3 make-sample 生成交接 JSON 与 SAP 风格待办表');
r = run(path.join(msOut, 'sample-handover.json'), [], 'ms-handover');
eq(r.summary.ok, true, '16.4 样例 handover.json 可识别');
ok(r.summary.sources[0].includes('工作交接'), '16.5 样例识别为工作交接来源');
eq(r.summary.counts.total, 3, '16.6 样例 pending 3 条纳入');
eq(r.summary.counts.overdue, 1, '16.7 样例 1 条期限已过');
eq(r.summary.counts.noDueDate, 1, '16.8 样例 1 条无期限不自设');
ok(!r.todo.warnings.some((w) => w.includes('按结构')), '16.9 样例带 meta.skill，不出推断 warning');
r = run(path.join(msOut, 'sample-todo-sap-style.xlsx'), [], 'ms-sap');
eq(r.summary.ok, true, '16.10 SAP 风格待办表可读（跟进事项 工作表）');
eq(r.summary.counts.total, 4, '16.11 已关闭行不进待办，4 条');
const sp2 = (t) => r.todo.items.find((x) => x.title.includes(t));
eq(sp2('催办 K-1501').priority, 'P1', '16.12 「1 非常高」→ P1');
eq(sp2('回流泵 B').priority, 'P1', '16.13 「A级」→ P1');
eq(sp2('旧口径登记').priority, 'P2', '16.14 「II级」→ P2 并 warning');
ok(r.todo.warnings.some((w) => w.includes('II级') && w.includes('旧 I~IV')), '16.15 旧口径 warning');
eq(sp2('催办 K-1501').tag, 'CDU-K1501', '16.16 功能位置归位号');
eq(sp2('催办 K-1501').refNo, '10045871', '16.17 工单号归编号');
eq(r.summary.counts.later, 1, '16.18 10 天后的事项进前瞻期外');
// 全量样例 + 交接：P-1101B 疑似重复组扩大，不合并
const ALLS = ['sample-orders.json', 'sample-hazard.json', 'sample-inspection.json', 'sample-calibration.json', 'sample-lube.json', 'sample-defects.json', 'sample-todo-sheet.xlsx', 'sample-todo-text.txt'].map((f) => path.join(msOut, f)).join(',');
r = run(ALLS, [], 'ms-all');
eq(r.summary.counts.total, 23, '16.19 全量样例恒 23 项（seed 5）');
eq(r.summary.counts.possibleDuplicate, 3, '16.20 全量样例疑似重复恒 3 组');
r = run(ALLS + ',' + path.join(msOut, 'sample-handover.json'), [], 'ms-all-ho');
eq(r.summary.counts.total, 26, '16.21 加交接后 26 项，未自动合并');
const dupP = r.todo.possibleDuplicate.find((d) => d.anchor === 'P-1101B');
ok(dupP && dupP.items.length === 4, '16.22 P-1101B 疑似重复组含工单/缺陷/待办表/交接 4 条，均保留');
ok(/shift-handover-record/.test(r.list) || /工作交接/.test(r.list), '16.23 清单按来源分类出现工作交接');

// ---- 输出
console.log(`\n${'='.repeat(56)}`);
console.log(`worklog-todo-manager 自测：${pass} 通过，${fail} 失败`);
if (failures.length) { console.log('\n失败项：'); failures.forEach((f) => console.log('  ✗ ' + f)); }
console.log('='.repeat(56));
try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
