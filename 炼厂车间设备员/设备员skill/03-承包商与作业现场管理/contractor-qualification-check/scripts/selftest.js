#!/usr/bin/env node
'use strict';
/**
 * 自测：生成变体输入并断言 qualify.js 行为。用法：node scripts/selftest.js（全绿退出 0）
 * 全部人名、单位名、证号均为编造。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { writeXlsx } = require('./lib/xlsx-lite');
const C = require('./lib/common');

const QUALIFY = path.join(__dirname, 'qualify.js');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cqc-selftest-'));
const TODAY = C.localDate();                 // 脚本以运行当日为基准日，样例日期一律相对今天生成
const FROM = C.addDays(TODAY, 3);
const TO = C.addDays(TODAY, 10);
const D = (n) => C.addDays(TODAY, n);
let pass = 0, fail = 0;
const failures = [];

function ok(cond, name) { if (cond) { pass++; } else { fail++; failures.push(name); } }
function eq(actual, expect, name) { ok(actual === expect, `${name}（期望 ${JSON.stringify(expect)}，实际 ${JSON.stringify(actual)}）`); }

function run(file, extra = [], tag) {
  const out = path.join(work, (tag || path.basename(file, '.xlsx')) + '-out');
  const args = [QUALIFY, '--input', file, '--contractor', '××建安公司', '--from', FROM, '--to', TO, '--out', out];
  if (!extra.includes('--work-type')) args.push('--work-type', '用火作业');
  if (!extra.includes('--edu-valid-days') && !extra.includes('--no-edu')) args.push('--edu-valid-days', '365');
  args.push(...extra.filter((x) => x !== '--no-edu'));
  const r = spawnSync(process.execPath, args, { encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  let summary;
  try { summary = JSON.parse(lines[lines.length - 1]); } catch (e) { summary = { ok: false, error: 'no-json:' + r.stdout + r.stderr }; }
  let json = null, md = null;
  if (fs.existsSync(path.join(out, 'qualify.json'))) json = JSON.parse(fs.readFileSync(path.join(out, 'qualify.json'), 'utf8'));
  if (fs.existsSync(path.join(out, 'qualify.md'))) md = fs.readFileSync(path.join(out, 'qualify.md'), 'utf8');
  return { code: r.status, summary, json, md, out };
}
function mk(name, book) { const p = path.join(work, name); writeXlsx(p, book); return p; }

const COMP_OK = [
  ['资质名称', '证书编号', '发证机关', '有效期至'],
  ['营业执照', '91370XXX0000000001', '××市市场监督管理局', D(900)],
  ['安全生产许可证', '（鲁）JZ安许证字000001', '××省住房和城乡建设厅', D(500)],
  ['安全生产管理协议', 'AQXY-虚构-0001', '××炼化公司', D(300)],
];
/** 人员证书通用表头：含入厂教育日期列（入厂三级教育为必备项） */
const PH = ['姓名', '岗位', '证书类型', '证书编号', '有效期至', '入厂教育日期'];
const EDU = D(-40);

// ---- 1. 基础：单位资质 + 动火作业持证齐备 → 建议准入
const base = mk('base.xlsx', {
  '单位资质': COMP_OK,
  '人员证书': [
    PH,
    ['赵德全', '焊工', '特种作业操作证（熔化焊接与热切割）', 'T37010000000001', D(400), EDU],
  ],
});
let r = run(base, [], 'base');
eq(r.summary.ok, true, '1.1 基础运行成功');
eq(r.summary.counts.personnelCerts, 1, '1.2 人员证书条目数');
eq(r.summary.counts.expired, 0, '1.3 无过期项');
eq(r.summary.counts.missing, 0, '1.4 动火作业所需证书齐备');
eq(r.summary.conclusion, '建议准入', '1.5 齐备时结论为建议准入');
ok(fs.existsSync(path.join(r.out, 'summary.json')), '1.6 summary.json 已写入');
eq(r.json.requirements[0].result, 'ok', '1.7 要求对照结果为齐备');

// ---- 2. 硬约束一：有效期为空 / 无法解析 → undetermined，绝不按有效
const noExp = mk('noexp.xlsx', {
  '单位资质': COMP_OK,
  '人员证书': [
    PH,
    ['赵德全', '焊工', '特种作业操作证（熔化焊接与热切割）', 'T37010000000001', '', EDU],
    ['孙立民', '焊工', '特种作业操作证（熔化焊接与热切割）', 'T37010000000002', '长期有效', EDU],
  ],
});
r = run(noExp, [], 'noexp');
eq(r.summary.counts.undetermined, 2, '2.1 空有效期与无法解析的有效期各计未判定 1 项');
eq(r.summary.counts.expired, 0, '2.2 未判定不计入过期');
eq(r.json.personnelQual.filter((x) => x.state === 'valid').length, 0, '2.3 未判定项绝不按有效处理');
ok(r.json.undetermined.some((x) => x.reason.includes('为空')), '2.4 空值原因标注为「有效期字段为空」');
ok(r.json.undetermined.some((x) => x.reason.includes('无法解析')), '2.5 无法解析原因标注正确');
ok(r.json.undetermined.every((x) => x.missing === '有效期至'), '2.6 未判定项标注缺失字段');
ok(/未判定/.test(r.md) && /一律未按有效处理/.test(r.md), '2.7 md 未判定节写明不按有效处理');
eq(r.summary.counts.missing, 1, '2.8 持证人全部未判定时计入应有未提供（无可用持证人）');
eq(r.summary.conclusion, '不建议准入', '2.9 无可用持证人时不建议准入');
ok(r.json.warnings.some((w) => w.includes('未按有效处理')), '2.10 warning 明示未按有效处理');

// ---- 3. 硬约束二：证书类型无法匹配 → warning 且单列，不得认定可替代
const unrec = mk('unrec.xlsx', {
  '单位资质': COMP_OK,
  '人员证书': [
    PH,
    ['王延青', '安全员', '某某省新型作业人员上岗资格证', 'XX0000000001', D(300), EDU],
  ],
});
r = run(unrec, [], 'unrec');
eq(r.summary.counts.unrecognized, 1, '3.1 无法识别的证书类型单列 1 项');
eq(r.summary.counts.missing, 1, '3.2 无法识别的证书不得顶替动火作业所需证书');
ok(r.json.unrecognized[0].reason.includes('不认定其可替代'), '3.3 明示脚本不认定可替代');
ok(r.json.warnings.some((w) => w.includes('不得自行认定可替代')), '3.4 warning 明示不得自行认定可替代');
ok(/类型待确认/.test(r.md), '3.5 md 含类型待确认一节');
eq(r.json.personnelQual[0].typeRecognized, false, '3.6 该证书标记为未归类');

// ---- 4. 硬约束三：结论仅三档，且不表述为准入决定
const CONCLUSIONS = ['建议准入', '建议补充材料后再审', '不建议准入'];
ok(CONCLUSIONS.includes(r.summary.conclusion), '4.1 结论落在三档之内');
r = run(base, [], 'concl');
ok(CONCLUSIONS.includes(r.summary.conclusion), '4.2 合规样例结论也落在三档之内');
ok(/本结论为核验意见，不是准入决定/.test(r.md), '4.3 md 写明结论不是准入决定');
ok(!/准予准入|批准准入|允许入厂|同意准入/.test(r.md), '4.4 md 未出现准入决定式表述');

// ---- 5. 硬约束四 & 五：不核实真伪 + 固定声明行
const DISCLAIMER = '本核验为辅助审查，承包商准入须经安全部门按厂内制度审批；证书真伪须通过发证机关渠道核实';
ok(r.md.includes(DISCLAIMER), '5.1 md 含固定声明行原文');
eq(r.json.meta.disclaimer, DISCLAIMER, '5.2 qualify.json 记录声明行原文');
ok(/不核实证书真伪/.test(r.md) && /发证机关/.test(r.md), '5.3 md 写明不核实真伪须经发证机关渠道核实');

// ---- 6. 硬约束六：临期默认 30 天，--lead-days 可调
const soon = mk('soon.xlsx', {
  '单位资质': COMP_OK,
  '人员证书': [
    PH,
    ['赵德全', '焊工', '特种作业操作证（熔化焊接与热切割）', 'T37010000000001', D(25), EDU],
    ['孙立民', '焊工', '特种作业操作证（熔化焊接与热切割）', 'T37010000000002', D(45), EDU],
  ],
});
r = run(soon, [], 'soon');
eq(r.json.meta.leadDays, 30, '6.1 临期默认 30 天');
eq(r.summary.counts.expiringSoon, 1, '6.2 25 天后到期计入临期，45 天后到期不计');
r = run(soon, ['--lead-days', '60'], 'soon60');
eq(r.summary.counts.expiringSoon, 2, '6.3 --lead-days 60 时两项均计入临期');
eq(r.summary.counts.expired, 0, '6.4 临期不计入过期');
eq(r.summary.conclusion, '建议准入', '6.5 仅临期时结论仍为建议准入并提示跟踪换证');

// ---- 7. 过期判定：已过期 + 作业期内失效
const exp = mk('expired.xlsx', {
  '单位资质': COMP_OK,
  '人员证书': [
    PH,
    ['赵德全', '焊工', '特种作业操作证（熔化焊接与热切割）', 'T37010000000001', D(-30), EDU],
    ['孙立民', '焊工', '特种作业操作证（熔化焊接与热切割）', 'T37010000000002', D(5), EDU],
  ],
});
r = run(exp, [], 'expired');
eq(r.summary.counts.expired, 2, '7.1 已过期与作业期内失效均计入过期');
ok(r.json.expired.some((x) => x.reason.includes('超期')), '7.2 已过期标注超期天数');
ok(r.json.expired.some((x) => x.reason.includes('作业期内将失效')), '7.3 作业期内失效单独说明');
eq(r.summary.conclusion, '不建议准入', '7.4 存在过期项时不建议准入');

// ---- 8. 作业范围匹配：缺证 / 不对应 / 多类型
const scope = mk('scope.xlsx', {
  '单位资质': COMP_OK,
  '人员证书': [
    PH,
    ['赵德全', '焊工', '特种作业操作证（熔化焊接与热切割）', 'T37010000000001', D(400), EDU],
    ['吴长海', '电工', '特种作业操作证（低压电工）', 'T37030000000001', D(400), EDU],
  ],
});
r = run(scope, [], 'scope-fire');
eq(r.summary.counts.scopeMismatch, 1, '8.1 低压电工证不对应动火作业，计入范围不符');
ok(r.json.scopeMismatch[0].reason.includes('不得用于替代'), '8.2 范围不符项明示不得替代');
eq(r.summary.conclusion, '建议补充材料后再审', '8.3 仅范围不符时结论为补充后再审');
r = run(scope, ['--work-type', '动火作业,临时用电作业'], 'scope-both');
eq(r.summary.counts.scopeMismatch, 0, '8.4 申报临时用电后电工证不再算范围不符');
eq(r.summary.counts.missing, 0, '8.5 两类作业所需证书均齐备');
r = run(scope, ['--work-type', '吊装作业'], 'scope-hoist');
eq(r.summary.counts.missing, 2, '8.6 吊装作业需司机证+指挥证，均缺失；司索工无取证项目不计缺证');
ok(r.json.missing.every((x) => x.workType === '吊装作业'), '8.7 缺失项标注所属作业类型');
ok(r.json.advisories.some((x) => x.required === '司索工培训记录'), '8.8 司索工列为提示项');
ok(/5\.5 提示项/.test(r.md) && /TSG Z6001/.test(r.md), '8.9 md 有提示项一节并注明依据');
// Q1/Q2 代号按 TSG Z6001 归类：Q2=司机、Q1=指挥，不得被泛类"特种设备作业人员证"抢走
const q12 = mk('q12.xlsx', {
  '单位资质': COMP_OK,
  '人员证书': [
    PH,
    ['钱司机', '司机', '特种设备作业人员证（Q2）', 'TS0001', D(400), EDU],
    ['孙指挥', '指挥', '特种设备作业人员证 Q1', 'TS0002', D(400), EDU],
  ],
});
r = run(q12, ['--work-type', '吊装作业'], 'q12');
eq(r.summary.counts.missing, 0, '8.10 Q2 识别为起重机司机证、Q1 识别为起重指挥证，吊装无缺证');
eq(r.summary.counts.scopeMismatch, 0, '8.11 Q1/Q2 不被判为范围不符');
// "用火作业"为规范名，"动火"仍可触发
r = run(scope, ['--work-type', '用火作业'], 'fire-name');
eq(r.summary.counts.scopeMismatch, 1, '8.12 用火作业与动火作业等价');

// ---- 9. 高处作业 anyOf：登高架设或高处安装维护拆除任一即可
const high = mk('high.xlsx', {
  '单位资质': COMP_OK,
  '人员证书': [
    ['姓名', '岗位', '证书类型', '作业类别', '证书编号', '有效期至', '入厂教育日期'],
    ['周敬和', '架子工', '特种作业操作证（高处作业）', '高处安装、维护、拆除作业', 'T37020000000001', D(400), EDU],
  ],
});
r = run(high, ['--work-type', '高处作业'], 'high');
eq(r.summary.counts.missing, 0, '9.1 高处安装维护拆除方向满足高处作业要求');
eq(r.json.personnelQual[0].type, '高处作业证', '9.2 归类为高处作业证');

// 9.3 高处作业证为提示项：已提供但未判定/过期时仍不计缺证
const highUnd = mk('high-und.xlsx', {
  '单位资质': COMP_OK,
  '人员证书': [
    ['姓名', '岗位', '证书类型', '作业类别', '证书编号', '有效期至', '入厂教育日期'],
    ['谭书文', '架子工', '高处作业证', '高处安装、维护、拆除作业', 'T37020000000002', '待补', EDU],
  ],
});
r = run(highUnd, ['--work-type', '高处作业'], 'high-und');
eq(r.summary.counts.missing, 0, '9.3 高处作业证已提供但未判定，不计缺证（提示项）');
ok(r.json.advisories.some((x) => x.required === '高处作业证' && /已提供但持证人均/.test(x.reason)), '9.4 提示项说明已提供但不可用');
eq(r.summary.counts.undetermined >= 1, true, '9.5 未判定仍单列');

// ---- 10. 压力容器焊接：项目代号缺失 → undetermined，不判合格
const weld = mk('weld.xlsx', {
  '单位资质': COMP_OK,
  '人员证书': [
    ['姓名', '岗位', '证书类型', '项目代号', '证书编号', '有效期至', '入厂教育日期'],
    ['梁世昌', '焊工', '特种设备焊接作业人员证', 'SMAW-FeII-6G', '370SH00000001', D(400), EDU],
    ['薛茂林', '焊工', '特种设备焊接作业人员证', '', '370SH00000002', D(400), EDU],
  ],
});
r = run(weld, ['--work-type', '压力容器焊接'], 'weld');
eq(r.summary.counts.undetermined, 1, '10.1 项目代号缺失计入未判定');
ok(r.json.undetermined[0].missing === '项目代号', '10.2 未判定项标注缺失项目代号');
ok(r.json.undetermined[0].reason.includes('SMAW-FeII-6G'), '10.3 未判定原因给出项目代号示例');
eq(r.summary.counts.missing, 0, '10.4 有一名代号完整的焊工，不算缺证');
eq(r.summary.conclusion, '建议补充材料后再审', '10.5 项目代号缺失时结论为补充后再审');

// ---- 11. 单位必备资质缺失与过期
const noLic = mk('nolic.xlsx', {
  '单位资质': [
    ['资质名称', '证书编号', '发证机关', '有效期至'],
    ['营业执照', '91370XXX0000000001', '××市市场监督管理局', D(900)],
  ],
  '人员证书': [
    PH,
    ['赵德全', '焊工', '特种作业操作证（熔化焊接与热切割）', 'T37010000000001', D(400), EDU],
  ],
});
r = run(noLic, [], 'nolic');
ok(!r.json.missing.some((x) => x.required === '安全生产许可证'), '11.1 未给承包商类别时缺安许不计缺证，作提示项');
ok(r.json.advisories.some((x) => x.required === '安全生产许可证'), '11.1b 安许进提示项并说明按承包商类别');
r = run(noLic, ['--contractor-type', '施工类'], 'nolic-construct');
ok(r.json.missing.some((x) => x.required === '安全生产许可证'), '11.1c 施工类承包商缺安许计入应有未提供');
eq(r.summary.conclusion, '不建议准入', '11.2 施工类单位必备资质缺失时不建议准入');
r = run(noLic, ['--contractor-type', '技术服务类'], 'nolic-service');
ok(!r.json.missing.some((x) => x.required === '安全生产许可证'), '11.2b 技术服务类不要求安许');

// ---- 12. 缺表：只有人员证书表 → warning 且不中断，单位资质不按合格
const persOnly = mk('personly.xlsx', {
  '人员证书': [
    PH,
    ['赵德全', '焊工', '特种作业操作证（熔化焊接与热切割）', 'T37010000000001', D(400), EDU],
  ],
});
r = run(persOnly, [], 'personly');
eq(r.summary.ok, true, '12.1 缺单位资质表不中断');
ok(r.json.warnings.some((w) => w.includes('不按合格处理')), '12.2 缺表 warning 明示不按合格处理');
ok(/未提供单位资质数据/.test(r.md), '12.3 md 写明未提供单位资质数据');
ok(r.json.missing.some((x) => x.reason.includes('未提供单位资质工作表')), '12.4 缺表时单位必备资质计入缺失');

// ---- 13. 缺表：只有单位资质表
const compOnly = mk('componly.xlsx', { '单位资质': COMP_OK });
r = run(compOnly, [], 'componly');
eq(r.summary.ok, true, '13.1 缺人员证书表不中断');
ok(/未提供人员证书数据/.test(r.md), '13.2 md 写明未提供人员证书数据');
eq(r.summary.counts.personnelCerts, 0, '13.3 人员证书条目为 0');

// ---- 14. 两张表都没有 → ok:false 且 exit 1
const bad = mk('bad.xlsx', { '随便一张表': [['a', 'b'], [1, 2]] });
r = run(bad, [], 'bad');
eq(r.summary.ok, false, '14.1 无已知工作表时 ok:false');
eq(r.code, 1, '14.2 退出码为 1');
ok(/未在输入中找到/.test(r.summary.error), '14.3 错误信息明确');

// ---- 15. 合计行跳过 + 标题行表头识别 + 别名列头
const erp = mk('erp.xlsx', {
  '单位资质': [
    ['××炼化 承包商资质台账导出'],
    [],
    ['证照名称', '证号', '颁发机关', '有效期限'],
    ['营业执照', '91370XXX0000000001', '××市市场监督管理局', D(900)],
    ['安全生产许可证', '（鲁）JZ安许证字000001', '××省住房和城乡建设厅', D(500)],
    ['合计', '', '', ''],
  ],
  '人员证书': [
    ['××炼化 承包商人员持证清单'],
    [],
    ['人员姓名', '工种', '证件类型', '准操项目', '证件编号', '有效期限', '三级教育日期'],
    ['蒋汝成', '焊工', '特种作业操作证（熔化焊接与热切割）', '焊接与热切割作业', 'T37010000000001', D(300), EDU],
    ['合计', '', '', '', '', '', ''],
  ],
});
r = run(erp, [], 'erp');
eq(r.summary.ok, true, '15.1 ERP 导出风格可读');
eq(r.summary.counts.companyQual, 2, '15.2 单位资质合计行被跳过');
ok(r.json.mandatory.find((m) => m.item === '安全协议').state === 'undetermined', '15.6 ERP 样例无安全协议行时安全协议为未判定');
eq(r.summary.counts.personnelCerts, 1, '15.3 人员证书合计行被跳过');
ok(r.json.warnings.some((w) => w.includes('合计行')), '15.4 合计行 warning');
eq(r.summary.counts.missing, 0, '15.5 别名列头下仍能完成范围匹配');

// ---- 16. 姓名/资质名称为空的行跳过并 warning
const blank = mk('blank.xlsx', {
  '单位资质': [
    ['资质名称', '证书编号', '发证机关', '有效期至'],
    ['', 'XX0000000001', '××局', D(400)],
    ['营业执照', '91370XXX0000000001', '××市市场监督管理局', D(900)],
    ['安全生产许可证', '（鲁）JZ安许证字000001', '××省住房和城乡建设厅', D(500)],
  ],
  '人员证书': [
    PH,
    ['', '焊工', '特种作业操作证（熔化焊接与热切割）', 'T37010000000001', D(400), EDU],
    ['赵德全', '焊工', '特种作业操作证（熔化焊接与热切割）', 'T37010000000002', D(400), EDU],
  ],
});
r = run(blank, [], 'blank');
eq(r.summary.counts.companyQual, 2, '16.1 资质名称为空的行被跳过');
eq(r.summary.counts.personnelCerts, 1, '16.2 姓名为空的行被跳过');
ok(r.json.warnings.some((w) => w.includes('姓名为空')), '16.3 空姓名 warning');
ok(r.json.warnings.some((w) => w.includes('资质名称为空')), '16.4 空资质名称 warning');

// ---- 17. 参数校验
function runRaw(args) {
  const r = spawnSync(process.execPath, [QUALIFY, ...args], { encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  try { return { code: r.status, s: JSON.parse(lines[lines.length - 1]) }; } catch (e) { return { code: r.status, s: { ok: false, error: 'no-json' } }; }
}
const OKARGS = ['--input', base, '--contractor', '××建安公司', '--work-type', '动火作业', '--from', FROM, '--to', TO];
let x = runRaw(['--input']);
eq(x.s.ok, false, '17.1 --input 缺值报错');
ok(/缺少取值/.test(x.s.error), '17.2 缺值错误信息正确');
x = runRaw(['--input', base, '--contractor', '××建安公司', '--from', FROM, '--to', TO]);
eq(x.s.ok, false, '17.3 缺 --work-type 报错（不得按最小集合核验）');
ok(/作业类型决定需核验哪些证书/.test(x.s.error), '17.4 缺 --work-type 错误信息说明原因');
x = runRaw([...OKARGS.slice(0, 6), '--from', '2026-13-45', '--to', TO]);
eq(x.s.ok, false, '17.5 非法日期报错');
x = runRaw([...OKARGS.slice(0, 6), '--from', D(20), '--to', D(5)]);
eq(x.s.ok, false, '17.6 结束日早于开始日报错');
x = runRaw([...OKARGS, '--未知参数', 'x']);
eq(x.s.ok, false, '17.7 未知参数报错');
x = runRaw([...OKARGS, '--lead-days', '-5']);
eq(x.s.ok, false, '17.8 负数 --lead-days 报错');
x = runRaw(['--input', '/不存在的路径.xlsx', '--contractor', 'A', '--work-type', '动火作业', '--from', FROM, '--to', TO]);
eq(x.s.ok, false, '17.9 输入不存在报错');
eq(x.code, 1, '17.10 参数错误退出码为 1');
x = runRaw([...OKARGS.slice(0, 4), '--work-type', '打酱油作业', '--from', FROM, '--to', TO]);
eq(x.s.ok, false, '17.11 作业类型全部无法识别时报错，不静默按空集核验');

// ---- 18. 部分作业类型无法识别 → warning + 结论降档
r = run(base, ['--work-type', '动火作业,某种新型作业'], 'mixedwt');
eq(r.summary.ok, true, '18.1 部分作业类型无法识别时不中断');
eq(r.json.meta.unknownWorkTypes.length, 1, '18.2 未识别作业类型单列');
ok(r.json.warnings.some((w) => w.includes('请人工确认应核验哪些证书')), '18.3 未识别作业类型 warning 要求人工确认');
eq(r.summary.conclusion, '建议补充材料后再审', '18.4 存在未识别作业类型时结论降为补充后再审');

// ---- 19. 厂内准入要求清单对照：不在默认表内的要求要列出且不改变判定
const spec = mk('spec.xlsx', {
  '准入要求': [
    ['作业类型', '所需证书', '说明'],
    ['动火作业', '焊接与热切割作业证', '进厂前查验原件'],
    ['动火作业', '厂内动火监护人培训合格证', '厂内附加要求'],
  ],
});
r = run(base, ['--spec', spec], 'spec');
eq(r.summary.ok, true, '19.1 带 --spec 运行成功');
eq(r.json.specExtra.length, 2, '19.2 厂内要求逐条列出');
ok(r.json.warnings.some((w) => w.includes('不在脚本默认对应表内') || w.includes('无法归类')), '19.3 厂内附加要求给出 warning');
ok(/厂内准入要求对照/.test(r.md), '19.4 md 含厂内要求对照一节');
eq(r.summary.conclusion, '建议准入', '19.5 厂内要求对照不改变脚本自动判定');
r = run(base, [], 'nospec');
ok(r.json.warnings.some((w) => w.includes('未提供厂内准入要求清单')), '19.6 未提供 --spec 时 warning 提示');
eq(r.json.specExtra, null, '19.7 未提供 --spec 时 specExtra 为 null');

// ---- 20. 历史准入记录对照
const hist = mk('hist.xlsx', {
  '历史准入': [
    ['姓名', '证书类型', '有效期至', '说明'],
    ['赵德全', '特种作业操作证（熔化焊接与热切割）', D(400), '上次入厂无违章'],
    ['宋兆麟', '特种作业操作证（高处作业）', D(100), '本次未在册'],
  ],
});
r = run(base, ['--history', hist], 'hist');
eq(r.json.history.length, 2, '20.1 历史准入记录读入');
ok(r.json.history.find((h) => h.person === '宋兆麟').inCurrent === false, '20.2 标注本次是否在册');
ok(/历史准入记录对照/.test(r.md), '20.3 md 含历史对照一节');
eq(r.json.history === null, false, '20.4 提供 --history 时 history 非 null');

// ---- 21. 产出结构完整性
r = run(base, [], 'struct');
ok(/## 一、核验概览/.test(r.md) && /## 二、单位资质核验/.test(r.md) && /## 三、人员证书核验/.test(r.md)
  && /## 四、作业类型证书要求与必备材料对照/.test(r.md) && /### 4\.2 必备材料/.test(r.md) && /## 五、不符合项清单/.test(r.md) && /## 六、未判定项/.test(r.md)
  && /## 七、类型待确认项/.test(r.md) && /## 八、核验结论/.test(r.md) && /## 九、声明/.test(r.md), '21.1 九节结构齐全');
ok(/### 5.1 已过期/.test(r.md) && /### 5.3 作业范围不符/.test(r.md) && /### 5.4 应有未提供/.test(r.md), '21.2 不符合项四个子节齐全');
ok(/<!-- ANALYSIS_START -->/.test(r.md) && /<!-- ANALYSIS_END -->/.test(r.md), '21.3 分析段占位符存在');
const sj = JSON.parse(fs.readFileSync(path.join(r.out, 'summary.json'), 'utf8'));
eq(sj.ok, true, '21.4 summary.json 内容正确');
ok(['companyQual', 'personnelQual', 'expired', 'expiringSoon', 'scopeMismatch', 'missing', 'undetermined', 'counts']
  .every((k) => k in r.json), '21.5 qualify.json 含规定的全部键');
ok(r.json.meta.baseDate && r.json.meta.workFrom === FROM && r.json.meta.workTo === TO, '21.6 meta 记录基准日与作业期');

// ---- 22. 空值显示为「—」或「（空）」，绝不按 0 或空白顶替
r = run(noExp, [], 'dash');
ok(/（空）/.test(r.md), '22.1 有效期为空在 md 中显示「（空）」');
eq(r.json.personnelQual[0].expiry, null, '22.2 无法解析的有效期在 JSON 中为 null');
eq(r.json.personnelQual[0].days, null, '22.3 未判定项剩余天数为 null，不按 0');
const emptyCell = mk('emptycell.xlsx', {
  '单位资质': COMP_OK,
  '人员证书': [
    PH,
    ['赵德全', '', '特种作业操作证（熔化焊接与热切割）', '', D(400), EDU],
  ],
});
r = run(emptyCell, [], 'emptycell');
ok(/\| 赵德全 \| — \|/.test(r.md), '22.4 岗位为空在 md 中显示「—」');
eq(r.json.personnelQual[0].certNo, '', '22.5 证书编号为空在 JSON 中为空串，不补默认值');


// ---- 23. 必备材料：入厂安全教育 / 安全协议 / 体检（《中国石化承包商安全管理规定》）
// 23.1 安全协议缺失 → 未判定，不计缺证，结论降为补充后再审
const noAgree = mk('noagree.xlsx', {
  '单位资质': COMP_OK.slice(0, 3),
  '人员证书': [PH, ['赵德全', '焊工', '特种作业操作证（熔化焊接与热切割）', 'T37010000000001', D(400), EDU]],
});
r = run(noAgree, [], 'noagree');
const agree = r.json.mandatory.find((m) => m.item === '安全协议');
eq(agree.state, 'undetermined', '23.1 安全协议缺失 → 未判定');
ok(!r.json.missing.some((x) => /安全协议/.test(x.required)), '23.2 安全协议缺失不计入应有未提供（不判合格也不判缺证）');
ok(r.json.undetermined.some((x) => x.missing === '安全协议'), '23.3 安全协议进未判定一节并标注缺失字段');
eq(r.summary.conclusion, '建议补充材料后再审', '23.4 必备材料未判定时结论为补充后再审');
ok(r.json.warnings.some((w) => /必备材料/.test(w) && /未按合格处理/.test(w)), '23.5 warning 明示必备材料未按合格处理');
// 23.6 安全协议别名 HSE 协议可识别；有效期过期 → 已过期 → 不建议准入
const hse = mk('hse.xlsx', {
  '单位资质': COMP_OK.slice(0, 3).concat([['HSE协议', 'HSE-虚构-01', '××炼化公司', D(-10)]]),
  '人员证书': [PH, ['赵德全', '焊工', '特种作业操作证（熔化焊接与热切割）', 'T37010000000001', D(400), EDU]],
});
r = run(hse, [], 'hse');
eq(r.json.companyQual.find((x) => x.name === 'HSE协议').type, '安全协议', '23.6 HSE协议归类为安全协议');
eq(r.json.mandatory.find((m) => m.item === '安全协议').state, 'expired', '23.7 安全协议过期按已过期');
eq(r.summary.conclusion, '不建议准入', '23.8 安全协议过期时不建议准入');
// 23.9 入厂教育：无记录 → 未判定；有日期无参数 → 未判定；有参数 → 有效；参数下过期 → 已过期
const noEdu = mk('noedu.xlsx', {
  '单位资质': COMP_OK,
  '人员证书': [['姓名', '岗位', '证书类型', '证书编号', '有效期至'], ['赵德全', '焊工', '特种作业操作证（熔化焊接与热切割）', 'T37010000000001', D(400)]],
});
r = run(noEdu, ['--no-edu'], 'noedu');
let eduItem = r.json.mandatory.find((m) => /入厂安全教育/.test(m.item));
eq(eduItem.state, 'undetermined', '23.9 无入厂教育记录 → 未判定，不按已完成处理');
ok(/未按已完成处理/.test(eduItem.reason), '23.10 原因写明未按已完成处理');
eq(r.summary.counts.missing, 0, '23.11 入厂教育缺失不计缺证');
eq(r.summary.conclusion, '建议补充材料后再审', '23.12 结论为补充后再审');
r = run(base, ['--no-edu'], 'edu-noparam');
eduItem = r.json.mandatory.find((m) => /入厂安全教育/.test(m.item));
eq(eduItem.state, 'undetermined', '23.13 有入厂教育日期但未给 --edu-valid-days → 未判定（有效期按厂内口径）');
ok(/--edu-valid-days/.test(eduItem.reason), '23.14 原因提示厂内口径参数');
r = run(base, ['--edu-valid-days', '365'], 'edu-param');
eduItem = r.json.mandatory.find((m) => /入厂安全教育/.test(m.item));
eq(eduItem.state, 'valid', '23.15 给定厂内有效期后入厂教育判有效');
eq(r.summary.conclusion, '建议准入', '23.16 必备材料齐备时结论建议准入');
r = run(base, ['--edu-valid-days', '30'], 'edu-expired');
eduItem = r.json.mandatory.find((m) => /入厂安全教育/.test(m.item));
eq(eduItem.state, 'expired', '23.17 按厂内有效期推算已过期');
ok(r.json.expired.some((x) => x.type === '入厂安全教育记录'), '23.18 入厂教育过期计入已过期清单');
eq(r.summary.conclusion, '不建议准入', '23.19 入厂教育过期时不建议准入');
x = runRaw([...OKARGS, '--edu-valid-days', '0']);
eq(x.s.ok, false, '23.20 --edu-valid-days 非正数报错');
// 23.21 "入厂三级安全教育卡"归类为入厂安全教育记录，不再是类型待确认
const eduRow = mk('edurow.xlsx', {
  '单位资质': COMP_OK,
  '人员证书': [
    ['姓名', '岗位', '证书类型', '证书编号', '有效期至'],
    ['赵德全', '焊工', '特种作业操作证（熔化焊接与热切割）', 'T37010000000001', D(400)],
    ['赵德全', '焊工', '厂级三级安全教育卡', 'SJ0001', D(200)],
  ],
});
r = run(eduRow, ['--no-edu'], 'edurow');
eq(r.json.personnelQual[1].type, '入厂安全教育记录', '23.21 三级安全教育卡归类为入厂安全教育记录');
eq(r.summary.counts.unrecognized, 0, '23.22 不再计入类型待确认');
eq(r.json.mandatory.find((m) => /入厂安全教育/.test(m.item)).state, 'valid', '23.23 有有效期的教育记录行按其有效期判有效');
eq(r.summary.counts.scopeMismatch, 0, '23.24 入厂教育记录属通用材料，不算范围不符');
// 23.25 体检：仅高处/受限空间必备
r = run(base, [], 'med-fire');
ok(!r.json.mandatory.some((m) => /体检/.test(m.item)), '23.25 用火作业不要求体检项');
r = run(base, ['--work-type', '高处作业'], 'med-high');
let med = r.json.mandatory.find((m) => /体检/.test(m.item));
ok(med && med.state === 'undetermined', '23.26 高处作业无体检记录 → 未判定');
ok(r.json.undetermined.some((x) => x.missing === '体检日期'), '23.27 体检缺失进未判定并标注缺失字段');
const medOk = mk('medok.xlsx', {
  '单位资质': COMP_OK,
  '人员证书': [
    ['姓名', '岗位', '证书类型', '证书编号', '有效期至', '入厂教育日期', '体检日期'],
    ['郑守业', '保运工', '受限空间作业培训合格证', 'PX0001', D(300), EDU, D(-100)],
    ['郑守业', '保运工', '监护人培训记录', 'JH0001', D(300), EDU, D(-100)],
  ],
});
r = run(medOk, ['--work-type', '受限空间作业'], 'med-noparam');
med = r.json.mandatory.find((m) => /体检/.test(m.item));
eq(med.state, 'undetermined', '23.28 有体检日期但未给 --medical-valid-days → 未判定');
r = run(medOk, ['--work-type', '受限空间作业', '--medical-valid-days', '365'], 'med-param');
med = r.json.mandatory.find((m) => /体检/.test(m.item));
eq(med.state, 'valid', '23.29 给定体检有效期后判有效');
eq(r.summary.conclusion, '建议准入', '23.30 受限空间所需证书与必备材料齐备时建议准入');
r = run(medOk, ['--work-type', '受限空间作业', '--medical-valid-days', '60'], 'med-expired');
eq(r.json.mandatory.find((m) => /体检/.test(m.item)).state, 'expired', '23.31 体检超过厂内有效期按已过期');
eq(r.summary.conclusion, '不建议准入', '23.32 体检过期时不建议准入');

// ---- 24. 特种作业操作证复审：下次复审逾期按已过期
const review = mk('review.xlsx', {
  '单位资质': COMP_OK,
  '人员证书': [
    ['姓名', '岗位', '证书类型', '证书编号', '发证日期', '复审日期', '下次复审', '有效期至', '入厂教育日期'],
    ['赵德全', '焊工', '特种作业操作证（熔化焊接与热切割）', 'T0001', D(-1500), D(-1200), D(-20), D(400), EDU],
    ['孙立民', '焊工', '特种作业操作证（熔化焊接与热切割）', 'T0002', D(-1500), D(-1000), D(20), D(400), EDU],
    ['周敬和', '焊工', '特种作业操作证（熔化焊接与热切割）', 'T0003', D(-1500), D(-1000), D(5), D(400), EDU],
    ['吴长海', '焊工', '特种作业操作证（熔化焊接与热切割）', 'T0004', D(-1500), '', '见证书', D(400), EDU],
  ],
});
r = run(review, [], 'review');
const byName = (n) => r.json.personnelQual.find((p) => p.person === n);
eq(byName('赵德全').state, 'expired', '24.1 下次复审已过 → 已过期');
ok(/复审逾期/.test(byName('赵德全').reason), '24.2 原因写明复审逾期');
eq(byName('孙立民').state, 'expiringSoon', '24.3 下次复审在临期窗内 → 临期');
eq(byName('周敬和').state, 'expired', '24.4 下次复审早于作业结束日 → 作业期内复审到期按已过期');
eq(byName('吴长海').state, 'undetermined', '24.5 下次复审无法解析 → 未判定，不按有效');
eq(byName('赵德全').nextReview, D(-20), '24.6 JSON 记录下次复审日期');
ok(/下次复审/.test(r.md), '24.7 md 人员表含下次复审列');
eq(r.summary.conclusion, '不建议准入', '24.8 复审逾期时不建议准入');
// 24.9 --review-years 自复审日期推算（仅特种作业操作证）
const review2 = mk('review2.xlsx', {
  '单位资质': COMP_OK,
  '人员证书': [
    ['姓名', '岗位', '证书类型', '证书编号', '发证日期', '复审日期', '有效期至', '入厂教育日期'],
    ['赵德全', '焊工', '特种作业操作证（熔化焊接与热切割）', 'T0001', D(-2000), D(-1200), D(400), EDU],
    ['冯广顺', '起重工', '特种设备作业人员证（Q2）', 'Q0001', D(-2000), D(-1200), D(400), EDU],
  ],
});
r = run(review2, [], 'review2-noparam');
eq(r.json.personnelQual[0].state, 'valid', '24.9 未给 --review-years 时不推算复审，按有效期至判定');
eq(r.json.personnelQual[0].nextReview, null, '24.10 未推算时 nextReview 为 null');
r = run(review2, ['--review-years', '3'], 'review2');
eq(r.json.personnelQual[0].state, 'expired', '24.11 --review-years 3 自复审日期推算已逾期 → 已过期');
eq(r.json.personnelQual[0].reviewDerived, true, '24.12 标注推算');
eq(r.json.personnelQual[1].nextReview, null, '24.13 特种设备作业人员证不按特种作业操作证周期推算');
ok(/（推算）/.test(r.md), '24.14 md 中推算的复审日期带"（推算）"标记');

// ---- 25. 单位资质归类收窄：泛称"认证证书"不再归 ISO
const cert = mk('cert.xlsx', {
  '单位资质': COMP_OK.concat([
    ['质量管理体系认证证书（ISO 9001）', 'Q0001', '××认证中心', D(300)],
    ['某行业产品认证证书', 'C0001', '××认证中心', D(300)],
  ]),
  '人员证书': [PH, ['赵德全', '焊工', '特种作业操作证（熔化焊接与热切割）', 'T37010000000001', D(400), EDU]],
});
r = run(cert, [], 'cert');
eq(r.json.companyQual.find((x) => /ISO 9001/.test(x.name)).type, 'ISO 管理体系认证', '25.1 ISO 9001 仍归 ISO 管理体系认证');
eq(r.json.companyQual.find((x) => /产品认证/.test(x.name)).type, null, '25.2 泛称"认证证书"不再归 ISO，列为类型待确认');
eq(r.summary.counts.unrecognized, 1, '25.3 类型待确认计数');

// ---- 26. 共享别名：承包商管理平台/SAP 导出列名
const sap = mk('sap.xlsx', {
  '单位资质': [
    ['供应商编码', '证照名称', '证号', '颁发机关', '有效期限'],
    ['100234', '营业执照', '91370XXX0000000001', '××市市场监督管理局', D(900)],
    ['100234', '安全生产许可证', '（鲁）JZ安许证字000001', '××省住房和城乡建设厅', D(500)],
    ['100234', '安全生产管理协议', 'AQXY-虚构-0002', '××炼化公司', D(300)],
  ],
  '人员证书': [
    ['人员姓名', '工种', '证件类型', '证件编号', '有效期限', '三级安全教育日期', '下次复审日期'],
    ['蒋汝成', '焊工', '特种作业操作证（熔化焊接与热切割）', 'T0001', D(300), EDU, D(300)],
  ],
});
r = run(sap, [], 'sap');
eq(r.summary.contractorCode, '100234', '26.1 供应商编码 → 承包商编码读入');
eq(r.json.personnelQual[0].eduDate, EDU, '26.2 三级安全教育日期别名命中');
eq(r.json.personnelQual[0].nextReview, D(300), '26.3 下次复审日期别名命中');
eq(r.summary.conclusion, '建议准入', '26.4 全部齐备建议准入');
ok(/承包商编码：100234/.test(r.md), '26.5 md 显示承包商编码');

// ---- 27. 术语与声明：md 用"用火作业"，不出现 emoji
r = run(base, ['--work-type', '动火作业'], 'term');
ok(/用火作业/.test(r.md), '27.1 "动火"入参在 md 中显示为规范名"用火作业"');
ok(!/[☀-➿\u{1F300}-\u{1FAFF}]/u.test(r.md), '27.2 md 不含 emoji');
ok(/--contractor-type|承包商类别/.test(r.md), '27.3 md 显示承包商类别');
ok(/安全环保部门|安全部门/.test(r.md), '27.4 md 写明准入审批归口');

// ---- 28. 与本次作业无关的作业类证书过期：不阻断，单列提示；相关证书、单位资质、通用项过期仍阻断；作业类型不完整时保持严格
const PH28 = ['姓名', '岗位', '证书类型', '证书编号', '有效期至', '入厂教育日期', '体检日期'];
const MED = D(-60);
const irr = mk('irrelevant.xlsx', {
  '单位资质': COMP_OK,
  '人员证书': [
    PH28,
    ['周敬和', '架子工', '特种作业操作证（登高架设作业）', 'T0281', D(400), EDU, MED],
    ['周敬和', '架子工', '特种作业操作证（熔化焊接与热切割）', 'T0282', D(-30), EDU, MED],
    ['吴长海', '电工', '特种作业操作证（低压电工）', 'T0283', D(5), EDU, MED],
  ],
});
r = run(irr, ['--work-type', '高处作业', '--medical-valid-days', '365'], 'irr-high');
eq(r.summary.counts.expired, 0, '28.1 只做高处作业时焊工证过期、电工证作业期内失效均不计入已过期');
eq(r.summary.counts.irrelevantExpired, 2, '28.2 与本次作业无关的过期证书单独计数');
ok(r.summary.conclusion !== '不建议准入', '28.3 无关证书过期不判不建议准入');
eq(r.summary.conclusion, '建议补充材料后再审', '28.4 无关证书仍按范围不符落到补充材料后再审');
const irrW = (r.json.irrelevantExpired || []).find((x) => x.person === '周敬和');
ok(irrW && irrW.certType === '焊接与热切割作业证' && /不得从事用火作业/.test(irrW.hint), '28.5 提示该人员不得从事对应的用火作业');
ok((r.json.irrelevantExpired || []).some((x) => x.person === '吴长海' && /作业期内将失效/.test(x.reason) && /临时用电作业/.test(x.hint)), '28.6 作业期内失效的无关证书同样单列并提示对应作业');
eq(r.json.personnelQual.find((p) => p.certNo === 'T0282').state, 'expired', '28.7 证书逐条状态仍如实记为已过期');
ok(/5\.6 与本次作业无关的过期证书/.test(r.md) && /不得从事对应作业/.test(r.md), '28.8 md 单列无关过期证书一节并提示不得从事对应作业');
ok(r.json.warnings.some((w) => /不计入阻断项/.test(w) && /周敬和/.test(w)), '28.9 warning 提示无关过期证书');
ok(/与本次作业无关的过期证书/.test(r.json.conclusionBasis), '28.10 结论依据写明另有无关过期证书');
r = run(irr, ['--work-type', '用火作业', '--medical-valid-days', '365'], 'irr-fire');
eq(r.summary.counts.expired, 1, '28.11 做用火作业时焊工证过期计入已过期（电工证仍无关）');
eq(r.summary.counts.irrelevantExpired, 1, '28.12 电工证仍单列为无关过期');
eq(r.summary.conclusion, '不建议准入', '28.13 本次作业需要的证书过期仍不建议准入');
r = run(irr, ['--work-type', '高处作业,脚手架搭设', '--medical-valid-days', '365'], 'irr-unknown');
eq(r.summary.counts.expired, 2, '28.14 作业类型有未识别项时无法判断相关性，全部过期证书按阻断');
eq(r.summary.counts.irrelevantExpired, 0, '28.15 严格口径下不单列无关过期');
eq(r.summary.conclusion, '不建议准入', '28.16 严格口径下不建议准入');
ok(r.json.warnings.some((w) => /无法区分过期证书是否与本次作业相关/.test(w)), '28.17 warning 说明无法区分是否与本次作业相关');
// 单位资质、入厂教育记录、体检记录、未识别类型过期不受相关性影响
const irr2 = mk('irrelevant2.xlsx', {
  '单位资质': COMP_OK.concat([['质量管理体系认证证书（ISO 9001）', 'Q0281', '××认证中心', D(-10)]]),
  '人员证书': [
    PH28,
    ['周敬和', '架子工', '特种作业操作证（登高架设作业）', 'T0284', D(400), EDU, MED],
    ['周敬和', '架子工', '入厂三级安全教育记录', 'E0281', D(-3), EDU, MED],
    ['冯广顺', '焊工', '特种作业操作证（熔化焊接与热切割）', 'T0285', D(400), EDU, MED],
    ['冯广顺', '焊工', '职业健康体检合格证明', 'M0281', D(-3), EDU, MED],
    ['王延青', '安全员', '某某省新型作业人员上岗资格证', 'X0281', D(-3), EDU, MED],
  ],
});
r = run(irr2, ['--work-type', '用火作业', '--medical-valid-days', '365'], 'irr-generic');
ok(r.json.expired.some((x) => x.scope === 'company' && /ISO 9001/.test(x.name)), '28.18 单位资质过期仍计入已过期');
ok(r.json.expired.some((x) => x.type === '入厂安全教育记录'), '28.19 入厂安全教育记录过期仍计入已过期');
ok(r.json.expired.some((x) => x.type === '体检合格证明'), '28.20 体检记录过期仍计入已过期');
ok(r.json.expired.some((x) => x.certNo === 'X0281'), '28.21 未识别类型证书过期无法判断相关性，仍计入已过期');
eq(r.summary.counts.irrelevantExpired, 0, '28.22 通用项与单位资质不进无关过期');
eq(r.summary.conclusion, '不建议准入', '28.23 通用项/单位资质过期仍不建议准入');
// 笼统的特种设备作业人员证：本次有吊装/压力容器焊接才视为相关
const irr3 = mk('irrelevant3.xlsx', {
  '单位资质': COMP_OK,
  '人员证书': [
    PH28,
    ['钱司机', '司机', '特种设备作业人员证（Q2）', 'TS0281', D(400), EDU, MED],
    ['孙指挥', '指挥', '特种设备作业人员证 Q1', 'TS0282', D(400), EDU, MED],
    ['孙指挥', '指挥', '特种设备作业人员证', 'TS0283', D(-5), EDU, MED],
    ['周敬和', '架子工', '特种作业操作证（登高架设作业）', 'T0286', D(400), EDU, MED],
  ],
});
r = run(irr3, ['--work-type', '高处作业', '--medical-valid-days', '365'], 'irr-se-high');
ok((r.json.irrelevantExpired || []).some((x) => x.certNo === 'TS0283') && !r.json.expired.some((x) => x.certNo === 'TS0283'), '28.24 只做高处作业时笼统特种设备作业人员证过期不阻断');
r = run(irr3, ['--work-type', '吊装作业'], 'irr-se-hoist');
ok(r.json.expired.some((x) => x.certNo === 'TS0283'), '28.25 吊装作业时笼统特种设备作业人员证过期计入已过期');

// ---- 输出
console.log(`\n${'='.repeat(56)}`);
console.log(`contractor-qualification-check 自测：${pass} 通过，${fail} 失败`);
if (failures.length) { console.log('\n失败项：'); failures.forEach((f) => console.log('  ✗ ' + f)); }
console.log('='.repeat(56));
try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
