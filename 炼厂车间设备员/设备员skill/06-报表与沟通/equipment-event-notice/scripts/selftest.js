#!/usr/bin/env node
'use strict';
/** 自测：断言 notice.js 与 rules.js 行为。用法：node scripts/selftest.js（全绿退出 0） */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const R = require('./lib/rules');

const NOTICE = path.join(__dirname, 'notice.js');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'notice-selftest-'));
const TIME = '2026-09-21T08:20:00+08:00';
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

let tagSeq = 0;
function run(args, tag) {
  const out = path.join(work, (tag || 'r' + (++tagSeq)) + '-out');
  const r = spawnSync(process.execPath, [NOTICE, ...args, '--out', out], { encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  let s; try { s = JSON.parse(lines[lines.length - 1]); } catch (e) { s = { ok: false, error: 'no-json:' + r.stdout + r.stderr }; }
  let j = null, md = null;
  if (fs.existsSync(path.join(out, 'notice.json'))) j = JSON.parse(fs.readFileSync(path.join(out, 'notice.json'), 'utf8'));
  if (fs.existsSync(path.join(out, 'notice.md'))) md = fs.readFileSync(path.join(out, 'notice.md'), 'utf8');
  return { code: r.status, s, j, md, out };
}
const FULL = ['--tag', 'P-2101A', '--name', '柴油加氢进料泵A', '--time', TIME,
  '--desc', '08时20分巡检发现机械密封处滴漏，滴速约每分钟5滴，泵出口压力由1.8MPa降至1.2MPa。当班人员按操作卡切换至备用泵P-2101B。',
  '--status', 'P-2101A已停运并隔离，备用泵运行正常。',
  '--impact', '生产：装置负荷未受影响。安全：泄漏量约0.5kg，可燃气体检测读数为0。环保：无物料外排。',
  '--measures', '已切换备用泵并停运隔离；已通知钳工班组现场确认；已录入缺陷台账。',
  '--followup', '拟于9月25日前拆检机械密封，由设备员跟踪验证。'];
function raw(args) {
  const x = spawnSync(process.execPath, [NOTICE, ...args], { encoding: 'utf8' });
  const l = x.stdout.trim().split('\n');
  try { return { code: x.status, s: JSON.parse(l[l.length - 1]) }; } catch (e) { return { code: x.status, s: { ok: false, error: '' } }; }
}
let r;

// ============ A. 规则引擎单元测试：推测性表述逐类覆盖 ============
const sc = (t) => R.scanSpeculative(t, '事件经过');
const ids = (t) => sc(t).map((h) => h.ruleId);
section('C', () => {
  // 归因类
  ok(ids('由于泵轴断裂').includes('S11'), 'A1 归因「由于」命中 S11');
  ok(ids('因为密封失效').includes('S12'), 'A2 归因「因为」命中 S12');
  ok(ids('导致装置降量').includes('S13'), 'A3 归因「导致」命中 S13');
  ok(ids('造成物料外泄').includes('S14'), 'A4 归因「造成」命中 S14');
  ok(ids('原因是轴承磨损').includes('S15'), 'A5 归因「原因是」命中 S15');
  ok(ids('系密封失效所致').includes('S16'), 'A6 归因「所致」命中 S16');
  // 责任类
  ok(ids('操作不当引发').includes('S21'), 'A7 责任「操作不当」命中 S21');
  ok(ids('存在违章行为').includes('S22'), 'A8 责任「违章」命中 S22');
  ok(ids('属于失职').includes('S23'), 'A9 责任「失职」命中 S23');
  ok(ids('未按规程执行').includes('S24'), 'A10 责任「未按规程」命中 S24');
  ok(ids('人员疏忽').includes('S25'), 'A11 责任「疏忽」命中 S25');
  ok(ids('把关不严').includes('S26'), 'A12 责任「把关不严」命中 S26');
  // 厂家质量类
  ok(ids('系厂家质量问题').includes('S31'), 'A13 厂家「厂家质量问题」命中 S31');
  ok(ids('属于设备本身缺陷').includes('S32'), 'A14 厂家「设备本身缺陷」命中 S32');
  ok(ids('材质质量不合格').includes('S33'), 'A15 厂家「质量不合格」命中 S33');
  // 定性类
  ok(ids('本次事故').includes('S41'), 'A16 定性「事故」命中 S41');
  ok(ids('严重违反操作规程').includes('S42'), 'A17 定性「严重违反」命中 S42');
  ok(ids('属于重大隐患').includes('S43'), 'A18 定性「重大隐患」命中 S43');
  // 程度夸大类
  ok(ids('情况严重').includes('S51'), 'A19 夸大「严重」命中 S51');
  ok(ids('重大影响').includes('S52'), 'A20 夸大「重大」命中 S52');
  ok(ids('后果恶劣').includes('S53'), 'A21 夸大「恶劣」命中 S53');
  // severity 分层
  eq(sc('导致停车')[0].severity, 'block', 'A22 归因类为 block 必须改写');
  eq(sc('情况严重').find((h) => h.ruleId === 'S51').severity, 'review', 'A23 程度夸大为 review 需有依据');
  // 位置与原文可定位
  const h0 = sc('巡检发现由于密封失效')[0];
  eq(h0.text, '由于', 'A24 speculative 记录原文');
  eq(h0.index, 4, 'A25 speculative 记录位置');
  ok(h0.suggest && h0.suggest.length > 5, 'A26 speculative 含建议改法');
  ok(h0.categoryCn.includes('归因'), 'A27 speculative 含类别中文');
  eq(sc('设备正常运行，参数平稳').length, 0, 'A28 客观陈述不误报');
  eq(sc('').length, 0, 'A29 空文本不报错');
  // 同一文本多规则命中全部保留
  ok(sc('由于操作不当导致严重后果').length >= 4, 'A30 多类表述全部命中');
});

// ============ B. 个人姓名追责表述 ============
const bn = (t) => R.scanBlameNames(t, '事件经过');
section('C', () => {
  ok(bn('当班操作工王建国操作不当').length >= 1, 'B1 姓名+职务+追责词命中 N1');
  eq(bn('当班操作工王建国操作不当')[0].ruleId, 'N1', 'B2 规则号为 N1');
  eq(bn('当班操作工王建国操作不当')[0].text, '王建国', 'B3 记录到的是姓名原文');
  eq(bn('当班人员按操作卡切换至备用泵，王师傅到场确认').length, 0, 'B4 姓名无追责词不误报');
  eq(bn('已通知钳工班组现场确认').length, 0, 'B5 无姓名不报');
  ok(bn('班长李卫东未按规程操作')[0].suggest.includes('删去姓名'), 'B6 建议删去姓名改岗位表述');
  ok(bn('主操赵明师傅处理不当').length >= 1, 'B7 后置称谓「师傅」可识别');
  eq(bn('由于操作不当，换热器管束泄漏，造成装置降量').length, 0, 'B8 普通词不被误判为姓名（无身份标记）');
  eq(bn('装置紧急停车，现场处理不当').length, 0, 'B9 无人员身份标记不误报');
  eq(bn('当班操作工王建国按操作卡完成切换').length, 0, 'B10 有姓名有职务但无追责词不报');
});

// ============ C. 上报提示（只提示不判定） ============
const es = (t) => R.scanEscalation([t]);
section('C', () => {
  eq(es('现场有人员受伤送医').hint, true, 'C1 人员伤害触发提示 E1');
  eq(es('法兰处着火').hint, true, 'C2 着火触发提示 E2');
  eq(es('现场出现明火').hint, true, 'C2b 明火触发提示 E2');
  eq(es('物料排入下水管网').hint, true, 'C3 环境影响触发提示 E3');
  eq(es('装置紧急停车').hint, true, 'C4 停车触发提示 E4');
  eq(es('管线爆管大量泄漏').hint, true, 'C5 大量泄漏触发提示 E5');
  eq(es('机封处滴漏约5滴每分钟，已切换备用泵').hint, false, 'C6 一般故障不触发提示');
  ok(es('装置紧急停车').text.includes('incident-flash-report'), 'C7 提示文案指向 incident-flash-report 技能');
  ok(es('装置紧急停车').text.includes('请按厂内规定判断是否需走事故快报流程'), 'C8 提示文案为规定措辞');
  ok(es('装置紧急停车').note.includes('脚本不判定'), 'C9 明示脚本不判定事件性质');
  eq(es('装置紧急停车').triggers[0].ruleId, 'E4', 'C10 触发项带规则号');
});

// ============ D. 要素校验 ============
section('C', () => {
  let ce = R.checkElements({ tag: 'P-1', time: '2026-09-21 08:20', desc: 'x', status: 'y', impact: 'z', measures: 'm', followup: 'f' });
  eq(ce.missing.length, 0, 'D1 七要素齐全无缺失');
  eq(ce.elements.length, 7, 'D2 要素定义为 7 项');
  ce = R.checkElements({ tag: 'P-1', desc: 'x' });
  eq(ce.missing.length, 4, 'D3 缺 4 项必需要素（时间/状态/影响/措施）');
  ok(ce.missing.every((m) => m.note.includes('不得用推测填补')), 'D4 缺失项注明不得推测填补');
  ok(ce.missing.every((m) => m.ask && m.arg), 'D5 缺失项带追问话术与参数名');
  eq(ce.elements.find((e) => e.key === 'followup').required, false, 'D6 后续安排为非必需要素');
  eq(ce.elements.find((e) => e.key === 'impact').required, true, 'D7 影响情况为必需要素');
});

// ============ E. 正常路径 ============
section('BVT', () => {
  r = run(FULL, 'full');
  eq(r.s.ok, true, 'E1 正常路径成功');
  eq(r.s.counts.missing, 0, 'E2 无缺失要素');
  eq(r.s.counts.speculative, 0, 'E3 客观描述无推测性表述');
  eq(r.s.counts.elementsPresent, 7, 'E4 七要素齐备');
  eq(r.s.escalationHint, false, 'E5 一般故障不提示上报');
  ok(/## 一、事件概况/.test(r.md) && /## 二、事件经过/.test(r.md) && /## 三、影响情况/.test(r.md)
    && /## 四、已采取措施/.test(r.md) && /## 五、原因分析情况/.test(r.md) && /## 六、后续安排/.test(r.md)
    && /## 七、举一反三提示/.test(r.md), 'E6 七节结构齐全');
  ok(r.md.includes('<!-- ANALYSIS_START -->') && r.md.includes('<!-- ANALYSIS_END -->'), 'E7 分析段占位符存在');
  ok(r.md.includes(R.DISCLAIMER), 'E8 md 含固定声明行');
  ok(fs.existsSync(path.join(r.out, 'notice.json')), 'E9 notice.json 生成');
  ok(fs.existsSync(path.join(r.out, 'notice.md')), 'E10 notice.md 生成');
  ok(fs.existsSync(path.join(r.out, 'summary.json')), 'E11 summary.json 落盘');
  eq(r.j.meta.disclaimer, R.DISCLAIMER, 'E12 json 含声明行原文');
  ok(/生成时间：\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}（北京时间）/.test(r.md), 'E13 时间显示为北京时间');
});

// ============ F. 硬约束 1：原因未确认一律「原因正在分析中」 ============
section('A', () => {
  eq(r.j.cause.text, '原因正在分析中', 'F1 默认原因为「原因正在分析中」');
  eq(r.j.cause.confirmed, false, 'F2 默认未确认');
  ok(/## 五、原因分析情况\s*\n\s*\n原因正在分析中。/.test(r.md), 'F3 md 原因一节写「原因正在分析中」');
  // 用户给了 --cause 但未确认 → 不进正文
  r = run([...FULL, '--cause', '机械密封动环磨损'], 'cause-unconfirmed');
  eq(r.j.cause.text, '原因正在分析中', 'F4 未确认的 --cause 不写入正文');
  ok(!r.md.includes('机械密封动环磨损'), 'F5 未确认原因不出现在 md 中');
  ok(r.j.warnings.some((w) => w.includes('未经 --cause-confirmed 确认')), 'F6 未确认原因给出 warning');
  // 显式声明已确认 → 才写入
  r = run([...FULL, '--cause', '经调查组确认为机械密封动环磨损', '--cause-confirmed'], 'cause-confirmed');
  eq(r.j.cause.confirmed, true, 'F7 --cause-confirmed 后标记为已确认');
  ok(r.md.includes('经调查组确认为机械密封动环磨损'), 'F8 已确认原因写入正文');
  ok(r.md.includes(R.DISCLAIMER), 'F9 已确认原因时仍保留声明行');
});

// ============ G. 硬约束 2：推测性表述必须被检出 ============
const SPEC_DESC = '由于操作不当，换热器管束泄漏，造成装置降量。经查系厂家质量问题所致，属于严重违反规程的事故，情况十分严重，构成重大隐患。';
section('A', () => {
  r = run(['--tag', 'E-2201', '--time', TIME, '--desc', SPEC_DESC,
    '--status', '换热器已切出', '--impact', '装置降量运行', '--measures', '已切出换热器'], 'spec');
  eq(r.s.ok, true, 'G1 含推测表述仍正常产出（不中断）');
  ok(r.s.counts.speculative >= 8, 'G2 检出多条推测性表述');
  const cats = new Set(r.j.speculative.map((h) => h.category));
  ok(cats.has('attribution'), 'G3 检出归因类');
  ok(cats.has('responsibility'), 'G4 检出责任类');
  ok(cats.has('vendor'), 'G5 检出厂家质量类');
  ok(cats.has('characterization'), 'G6 检出定性类');
  ok(cats.has('exaggeration'), 'G7 检出程度夸大类');
  ok(r.j.speculative.every((h) => h.text && h.ruleId && typeof h.index === 'number' && h.suggest), 'G8 每条含原文/规则号/位置/建议改法');
  ok(r.j.warnings.some((w) => w.includes('规则 S')), 'G9 warning 带规则号');
  ok(/## 附二、检出的推测性\/定性表述/.test(r.md), 'G10 md 单列检出清单一节');
  ok(/必须改写/.test(r.md), 'G11 md 标注必须改写');
  ok(r.j.speculative.some((h) => h.ruleId === 'S41'), 'G12 「事故」被检出（未定性不得用）');
  ok(r.md.includes('脚本不自动删改用户原文'), 'G13 md 明示不自动删改原文');
  ok(r.s.counts.speculativeBlock > 0 && r.s.counts.speculativeReview > 0, 'G14 block 与 review 分别计数');
  ok(Object.keys(r.j.counts.speculativeByCategory).length >= 5, 'G15 按类别计数齐全');
});

// ============ H. 硬约束 3：上报提示只提示不判定 ============
section('A', () => {
  r = run(['--tag', 'C-2401', '--time', TIME,
    '--desc', '塔底泵出口法兰处物料大量泄漏并着火，装置紧急停车，1名人员轻微烫伤送医。',
    '--status', '装置已紧急停车，火情已扑灭', '--impact', '全装置停车，人员送医',
    '--measures', '已启动应急预案，已通知消防与应急部门'], 'escal');
  eq(r.s.escalationHint, true, 'H1 escalationHint 为 true');
  ok(r.j.escalationHint.text.includes('请按厂内规定判断是否需走事故快报流程'), 'H2 提示文案为规定措辞');
  ok(r.j.escalationHint.text.includes('incident-flash-report'), 'H3 提示指向 incident-flash-report');
  ok(r.j.escalationHint.triggers.length >= 3, 'H4 列出多个触发情形');
  ok(r.j.escalationHint.note.includes('脚本不判定'), 'H5 明示脚本不判定事件性质');
  ok(/## 附三、上报流程提示/.test(r.md), 'H6 md 单列上报提示一节');
  ok(r.j.warnings.some((w) => w.includes('incident-flash-report')), 'H7 warning 提示上报流程');
  ok(!/本事件构成事故|认定为事故|属于.{0,4}事故等级/.test(r.md), 'H8 md 不对事件性质下结论');
});

// ============ I. 硬约束 4：个人姓名追责性表述 ============
section('A', () => {
  r = run(['--tag', 'C-2401', '--time', TIME,
    '--desc', '当班操作工王建国处理不当，未按规程进行切换。',
    '--status', '设备已停运', '--impact', '装置降量', '--measures', '已组织处理'], 'blame');
  ok(r.j.speculative.some((h) => h.ruleId === 'N1'), 'I1 检出个人姓名追责表述 N1');
  ok(r.j.speculative.find((h) => h.ruleId === 'N1').suggest.includes('岗位'), 'I2 建议改为岗位表述');
  ok(r.j.warnings.some((w) => w.includes('N1')), 'I3 warning 含 N1 规则号');
  eq(r.j.speculative.find((h) => h.ruleId === 'N1').severity, 'block', 'I4 个人追责表述必须改写');
});

// ============ J. 硬约束 5+6：声明行与要素缺失 ============
section('A', () => {
  r = run(['--tag', 'V-2301', '--time', TIME, '--desc', '中控显示液位由45%快速上升至88%，就地液位计读数与中控不一致。'], 'missing');
  eq(r.s.ok, true, 'J1 要素缺失不中断');
  eq(r.s.counts.missing, 3, 'J2 缺 3 项必需要素');
  const mk = r.j.missing.map((m) => m.key).sort().join(',');
  eq(mk, 'impact,measures,status', 'J3 缺失项为当前状态/影响/措施');
  ok(r.j.warnings.length >= 3, 'J4 每项缺失各一条 warning');
  ok(/## 附一、缺失要素（须补充，不得推测填补）/.test(r.md), 'J5 md 单列缺失要素一节');
  ok(/须补充后成文，不得推测填补/.test(r.md), 'J6 正文缺失处提示不得推测填补');
  ok(r.md.includes(R.DISCLAIMER), 'J7 缺失场景仍保留声明行');
  ok(r.md.trim().endsWith(R.DISCLAIMER + '。'), 'J8 声明行位于末尾');
  ok(r.j.missing.every((m) => m.ask), 'J9 缺失项带追问话术');
  eq(r.j.elements.find((e) => e.key === 'impact').value, null, 'J10 缺影响时 value 为 null，不按「无影响」默认');
  ok(r.md.split('## 三、影响情况')[1].includes('不得留空或推测'), 'J11 影响缺失时明示不得推测');
});

// ============ K. 参数校验 ============
section('B', () => {
  eq(raw([]).s.ok, false, 'K1 无参数报错');
  eq(raw([]).code, 1, 'K2 退出码 1');
  eq(raw(['--tag']).s.ok, false, 'K3 --tag 缺值报错');
  ok(/缺少取值/.test(raw(['--tag']).s.error), 'K4 缺值信息正确');
  eq(raw(['--tag', 'P-1']).s.ok, false, 'K5 缺 --desc 报错');
  eq(raw(['--desc', 'x']).s.ok, false, 'K6 缺 --tag 报错');
  eq(raw(['--tag', 'P-1', '--desc', 'x', '--未知', 'v']).s.ok, false, 'K7 未知参数报错');
  eq(raw(['--tag', 'P-1', '--desc', 'x', '--time', '昨天下午']).s.ok, false, 'K8 非法时间报错');
  eq(raw(['--tag', 'P-1', '--desc', 'x', '--time', '2026-09-21T08:20:00']).s.ok, false, 'K9 时间缺时区报错');
  ok(/ISO 8601/.test(raw(['--tag', 'P-1', '--desc', 'x', '--time', '2026-09-21T08:20:00']).s.error), 'K10 错误提示 ISO 8601 格式');
  eq(raw(['--tag', 'P-1', '--desc', 'x', '--scope', '全国']).s.ok, false, 'K11 非法 --scope 报错');
  eq(raw(['--tag', 'P-1', '--desc', 'x', '--scope', '设备部']).s.ok, false, 'K11b 旧写法「设备部」不再接受');
  eq(raw(['--tag', 'P-1', '--desc', 'x', '--scope', '全厂']).s.ok, false, 'K11c 旧写法「全厂」不再接受');
  ok(/车间\/分厂\/公司/.test(raw(['--tag', 'P-1', '--desc', 'x', '--scope', '全厂']).s.error), 'K11d 错误信息列出三档层级');
  eq(raw(['--tag', 'P-1', '--desc', 'x', '--type', '灾难']).s.ok, false, 'K12 非法 --type 报错');
  r = run(['--tag', 'P-1', '--desc', 'x', '--time', '2026-09-21T00:20:00Z'], 'utc');
  eq(r.s.ok, true, 'K13 Z 结尾时区可接受');
  eq(r.j.meta.eventTime, '2026-09-21 08:20:00', 'K14 UTC 时间换算为北京时间');
});

// ============ L. 可选项与标题 ============
section('B', () => {
  r = run([...FULL, '--workshop', '加氢车间', '--scope', '分厂', '--type', '险肇', '--area', '一区'], 'opts');
  ok(/^# 加氢车间 P-2101A 柴油加氢进料泵A 设备险肇情况通报/m.test(r.md), 'L1 标题含车间/位号/名称/类型');
  ok(/通报范围：分厂/.test(r.md), 'L2 通报范围写入正文');
  eq(r.j.meta.scope, '分厂', 'L3 json 记录通报范围');
  eq(r.j.meta.type, '险肇', 'L4 json 记录事件类型');
  ok(/所在区域 \| 一区/.test(r.md), 'L5 区域写入概况表');
});

// ============ M. 组织层级三档与自定义名称 ============
section('B', () => {
  r = run([...FULL, '--scope', '公司', '--scope-name', '公司设备管理部门（机动部）'], 'scope-co');
  eq(r.s.ok, true, 'M1 --scope 公司 可用');
  eq(r.j.meta.scopeCn, '公司（公司设备管理部门（机动部））', 'M2 --scope-name 作为层级自定义名称');
  ok(/通报范围：公司（公司设备管理部门（机动部））/.test(r.md), 'M3 md 显示层级与自定义名称');
  r = run([...FULL, '--scope', '分厂', '--scope-name', '烯烃厂设备科'], 'scope-sub');
  eq(r.j.meta.scope, '分厂', 'M4 分厂档位');
  eq(r.s.scope, '分厂', 'M5 summary 记录 scope');
  r = run(FULL, 'scope-default');
  eq(r.j.meta.scope, '车间', 'M6 默认车间');
  eq(r.j.meta.scopeName, null, 'M7 未传 --scope-name 时为 null');
});

// ============ N. 非计划停工事件提示（与事故快报分开，只提示不判定） ============
section('A', () => {
  r = run(['--tag', 'K-2201', '--time', TIME, '--desc', '循环氢压缩机振动高联锁停车，装置紧急停车处理。', '--status', '装置停工中', '--impact', '生产：装置停工。安全：无。环保：无。', '--measures', '已按应急预案处置'], 'unplanned');
  eq(r.j.unplannedShutdownHint.hint, true, 'N1 E4 停车/停工 命中时给出非计划停工事件提示');
  ok(/炼化企业非计划停工管理规定/.test(r.j.unplannedShutdownHint.text), 'N2 提示引用《炼化企业非计划停工管理规定》');
  ok(/与事故快报分开/.test(r.j.unplannedShutdownHint.text), 'N3 提示说明与事故快报分开报送');
  ok(/本技能不判定/.test(r.j.unplannedShutdownHint.text), 'N4 提示声明不判定');
  ok(/## 附四、非计划停工事件提示/.test(r.md), 'N5 md 单列非计划停工提示一节');
  ok(/【注意】/.test(r.md), 'N6 md 醒目提示用「【注意】」');
  ok(!/⚠|✅|❌/.test(r.md), 'N7 md 不含 emoji');
  ok(r.j.warnings.some((w) => w.includes('非计划停工事件')), 'N8 warning 提示非计划停工');
  eq(r.s.unplannedShutdownHint, true, 'N9 summary 含 unplannedShutdownHint');
  eq(r.j.counts.unplannedShutdownTriggers, 1, 'N10 触发计数');
  ok(!/构成非计划停工事件|非计划停工事件等级/.test(r.md.replace(/可能构成非计划停工事件/g, '').replace(/是否构成及等级/g, '')), 'N11 md 不对事件是否构成及等级下结论');
  ok(/中国石化设备事故管理规定/.test(r.md) && /报送时限以厂内规定为准/.test(r.md), 'N12 上报提示衔接《中国石化设备事故管理规定》且时限以厂内规定为准');
  r = run(['--tag', 'P-1', '--time', TIME, '--desc', '机封滴漏，已切备用泵。', '--status', '备用', '--impact', '无', '--measures', '已切换'], 'noshut');
  eq(r.j.unplannedShutdownHint.hint, false, 'N13 无停车/停工描述时不提示');
  ok(!/附四、非计划停工事件提示/.test(r.md), 'N14 无触发时 md 无该节');
  eq(r.j.escalationHint.hint, false, 'N15 普通故障不触发上报提示');
});

// ============ O. --hazard-level-confirmed：隐患等级已按厂内分级确认 ============
const HZ = ['--tag', 'C-2401', '--time', TIME, '--desc', '平台栏杆多处锈蚀断裂，已按厂内标准登记为重大隐患（隐患台账 YH-2026-001）。', '--status', '已隔离', '--impact', '安全：高处坠落风险区域已隔离。生产：无。环保：无。', '--measures', '已设警戒'];
section('B', () => {
  r = run(HZ, 'hz-default');
  ok(r.j.speculative.some((h) => h.ruleId === 'S43'), 'O1 未声明时「重大隐患」命中 S43');
  r = run([...HZ, '--hazard-level-confirmed'], 'hz-confirmed');
  ok(!r.j.speculative.some((h) => h.ruleId === 'S43' || h.ruleId === 'S52'), 'O2 声明后 S43/S52 不再列为禁用');
  ok(r.j.hazardLevelKept.some((h) => h.ruleId === 'S43'), 'O3 保留项记录在 hazardLevelKept');
  eq(r.j.meta.hazardLevelConfirmed, true, 'O4 meta 记录声明');
  ok(r.j.warnings.some((w) => w.includes('须在通报中注明分级依据')), 'O5 warning 提示注明分级依据');
  ok(/按厂内分级确认保留的隐患等级用语/.test(r.md), 'O6 md 单列保留项');
  ok(r.j.speculative.every((h) => h.ruleId !== 'S43'), 'O7 其余规则不受影响仍检出（如有）');
  r = run([...FULL, '--hazard-level-confirmed'], 'hz-noop');
  ok(r.j.warnings.some((w) => w.includes('未产生作用')), 'O8 描述中无隐患等级用语时提示旗标未起作用');
  ok(r.j.speculative.every((h) => h.ruleId !== 'S41'), 'O9 旗标不影响 S41「事故」等其它定性词（本例无命中）');
  r = run(['--tag', 'C-1', '--time', TIME, '--desc', '本次事故已登记为重大隐患。', '--hazard-level-confirmed'], 'hz-s41');
  ok(r.j.speculative.some((h) => h.ruleId === 'S41'), 'O10 声明隐患分级不放行「事故」定性词');
});

console.log(`\n${'='.repeat(56)}`);
console.log(`equipment-event-notice 自测：${pass} 通过，${fail} 失败`);
console.log(`用例级别 ${LEVELS[RUN_LEVEL]}：BVT ${byLevel.BVT}，A ${byLevel.A}，B ${byLevel.B}，C ${byLevel.C}`);
if (failures.length) { console.log('\n失败项：'); failures.forEach((f) => console.log('  ✗ ' + f)); }
console.log('='.repeat(56));
try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
