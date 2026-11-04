#!/usr/bin/env node
'use strict';
/** 自测：断言 archive.js 与 archive-spec.js 行为（中石化检修分级、必备资料、EM 列头、SAP 台账别名）。用法：node scripts/selftest.js */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { writeXlsx } = require('./lib/xlsx-lite');
const S = require('./lib/archive-spec');

const A = path.join(__dirname, 'archive.js');
const ROOT = path.join(__dirname, '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mra-selftest-'));
const EMOJI = /[⚠✅❌✔✖\u{1F300}-\u{1FAFF}]/u;
let pass = 0, fail = 0;
const failures = [];
const ok = (c, n) => { if (c) pass++; else { fail++; failures.push(n); } };
const eq = (x, e, n) => ok(x === e, `${n}（期望 ${JSON.stringify(e)}，实际 ${JSON.stringify(x)}）`);

function run(args, tag) {
  const out = path.join(work, tag + '-out');
  const r = spawnSync(process.execPath, [A, ...args, '--out', out], { encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  let s; try { s = JSON.parse(lines[lines.length - 1]); } catch (e) { s = { ok: false, error: 'no-json:' + r.stdout + r.stderr }; }
  let j = null, md = null, csv = null;
  if (fs.existsSync(path.join(out, 'archive.json'))) j = JSON.parse(fs.readFileSync(path.join(out, 'archive.json'), 'utf8'));
  if (fs.existsSync(path.join(out, 'archive.md'))) md = fs.readFileSync(path.join(out, 'archive.md'), 'utf8');
  if (fs.existsSync(path.join(out, 'ledger-update.csv'))) csv = fs.readFileSync(path.join(out, 'ledger-update.csv'), 'utf8');
  return { code: r.status, s, j, md, csv, out };
}
const mk = (n, b) => { const p = path.join(work, n); writeXlsx(p, b); return p; };
const BASE = ['--tag', 'V-01', '--project', '测试项目', '--from', '2026-09-10', '--to', '2026-09-18'];

// ============ A. 规范表单元测试 ============
const minor = S.requiredMaterials('日常维修');
const major = S.requiredMaterials('大检修');
ok(major.length > minor.length, 'A1 大检修应归档项多于日常维修');
ok(minor.some((x) => x.key === 'record' && x.mandatory), 'A2 检修记录卡为必备');
ok(minor.some((x) => x.key === 'acceptance' && x.mandatory), 'A3 验收单为必备');
ok(minor.some((x) => x.key === 'plan' && x.mandatory), 'A4 **检修方案为必备**');
ok(minor.some((x) => x.key === 'permit' && x.mandatory), 'A5 **作业许可（作业票）为必备**');
ok(!minor.some((x) => x.key === 'ndt'), 'A6 日常维修无损检测非默认项');
const withNdt = S.requiredMaterials('日常维修', { ndt: true });
ok(withNdt.some((x) => x.key === 'ndt'), 'A7 涉及无损检测时追加该项');
const se = S.requiredMaterials('日常维修', {}, true);
const seMand = se.filter((x) => x.mandatory);
ok(seMand.length >= 9, 'A8 特种设备必备项显著增加');
ok(se.some((x) => x.key === 'seInspect' && x.mandatory), 'A9 特种设备检验报告为必备');
ok(se.some((x) => x.key === 'sePressure' && x.mandatory), 'A10 耐压试验记录为必备');
eq(S.classify('检修方案.docx', minor).includes('plan'), true, 'A11 文件名归类-方案');
eq(S.classify('用火作业许可证.pdf', minor).includes('permit'), true, 'A12 文件名归类-用火作业许可证');
eq(S.classify('动火作业票.pdf', minor).includes('permit'), true, 'A13 文件名归类-旧称动火票仍可归作业票');
eq(S.classify('随便.txt', minor).length, 0, 'A14 无法归类返回空数组');
// 作业票系统下载的 Word 原件以许可证编号命名（如 YH-20261104-003.docx），须认作作业票
eq(S.classify('YH-20261104-003.docx', minor).includes('permit'), true, 'A14a 许可证编号命名的作业票原件（YH-）归作业票');
eq(S.classify('MB-20261104-001.docx', minor).includes('permit'), true, 'A14b 盲板抽堵许可证编号（MB-）归作业票');
// 不是作业票的单据不能顶作业票（作业票为必备，误归会掩盖缺失）
eq(S.classify('盲板台账.xlsx', minor).includes('permit'), false, 'A14c 盲板台账不是作业票');
eq(S.classify('用火分析单.pdf', minor).includes('permit'), false, 'A14d 用火分析单不是作业票');
// 质量验收记录（H/W 点见证）不是完工验收单
eq(S.classify('质量验收记录（H点见证）.pdf', minor).includes('acceptance'), false, 'A14e 质量验收记录不顶完工验收单');
eq(S.classify('完工验收单.pdf', minor).includes('acceptance'), true, 'A14f 完工验收单归验收单');
eq(S.classify('检修质量验收单.pdf', minor).includes('acceptance'), true, 'A14g 「检修质量验收单」带「验收单」字样，归验收单（不被「质量」排除）');
eq(S.classify('P-101机封更换质量验收单.docx', minor).includes('acceptance'), true, 'A14h 「…质量验收单」归验收单');
eq(S.classify('质量竣工验收报告.pdf', minor).includes('acceptance'), true, 'A14i 「竣工验收」归验收单');
// 无损检测的 RT/UT/MT/PT 只认独立缩写，PTA、MTBE、PPT 不是无损检测报告
const seReq = S.requiredMaterials('大检修', { ndt: true }, true);
eq(S.classify('PTA装置检修方案.docx', seReq).some((k) => k === 'ndt' || k === 'seNdt'), false, 'A14g PTA 不当 PT 检测');
eq(S.classify('MTBE单元检修总结.docx', seReq).some((k) => k === 'ndt' || k === 'seNdt'), false, 'A14h MTBE 不当 MT 检测');
eq(S.classify('焊缝RT检测报告.pdf', seReq).includes('seNdt'), true, 'A14i 「RT检测报告」归无损检测报告');
ok(major.some((x) => x.key === 'summary' && x.mandatory), 'A15 **大检修的检修总结为必备**');
ok(['qcRecord', 'trialRecord', 'spareIssue', 'partCert', 'tcfdRecord', 'midHandover'].every((k) => major.some((x) => x.key === k)), 'A16 大检修追加质量验收记录/试车记录/备件领用单/更换部件质量证明/三查四定/中交记录');
ok(S.requiredMaterials('抢修').some((x) => x.key === 'failureRecord'), 'A17 抢修追加故障（事件）记录');
ok(S.requiredMaterials('专项').some((x) => x.key === 'techDoc'), 'A18 专项追加技术方案或变更资料');
eq(S.TYPES.join('/'), '大检修/日常维修/抢修/专项', 'A19 检修分级四档为中石化口径');
eq(S.normRepairType('大修').type, '大检修', 'A20 旧值「大修」映射为大检修');
eq(S.normRepairType('中修').type, '日常维修', 'A21 旧值「中修」映射为日常维修');
eq(S.normRepairType('小修').type, '日常维修', 'A22 旧值「小修」映射为日常维修');
eq(S.normRepairType('大修').mapped, true, 'A23 映射标记');
eq(S.normRepairType('日常维修').mapped, false, 'A24 标准值不标映射');
eq(S.normRepairType('随便').type, null, 'A25 无法识别返回 null');

// ============ B. 基础归档 ============
const FULL = mk('full.xlsx', {
  '材料清单': [['文件名', '资料类型'],
    ['检修方案.docx', '方案'], ['用火作业许可证.pdf', '作业票'], ['设备交出单.pdf', '交出单'],
    ['检修记录卡.xlsx', '记录'], ['验收单.pdf', '验收'], ['完工照片.jpg', '照片']],
});
let r = run([...BASE, '--type', '日常维修', '--materials', FULL], 'full');
eq(r.s.ok, true, 'B1 基础归档成功');
eq(r.s.counts.missing, 0, 'B2 日常维修材料齐全无缺失');
eq(r.s.counts.mandatoryMissing, 0, 'B3 无必备缺失');
eq(r.s.counts.unclassified, 0, 'B4 无待认领');
ok(!/【注意】\*\*必备资料缺失/.test(r.md), 'B5 无必备缺失时不出现醒目提示');
ok(/## 一、项目概况/.test(r.md) && /## 二、已归档资料/.test(r.md) && /## 三、缺失资料/.test(r.md)
  && /## 四、待认领材料/.test(r.md) && /## 五、台账履历更新建议/.test(r.md), 'B6 五节结构齐全');
eq(r.s.type, '日常维修', 'B7 摘要回显检修分级');
ok(/检修分级 \| 日常维修/.test(r.md), 'B8 概况表显示检修分级');
ok(!EMOJI.test(r.md), 'B9 md 不含 emoji');
ok(/仅供设备员复核参考，不替代档案室的正式归档手续/.test(r.md), 'B10 md 末尾含声明行');

// ============ C. 必备缺失（核心） ============
const SPARSE = mk('sparse.xlsx', { '材料清单': [['文件名'], ['检修记录卡.xlsx']] });
r = run([...BASE, '--type', '大检修', '--materials', SPARSE, '--special-equipment'], 'se-missing');
ok(r.s.counts.mandatoryMissing > 0, 'C1 特种设备缺材料时有必备缺失');
ok(/【注意】\*\*必备资料缺失/.test(r.md), 'C2 md 开头【注意】醒目提示');
const idxAlert = r.md.indexOf('【注意】**必备资料缺失');
const idxSec1 = r.md.indexOf('## 一、项目概况');
ok(idxAlert >= 0 && idxAlert < idxSec1, 'C3 醒目提示位于第一节之前');
ok(r.j.mandatoryMissing.every((x) => x.mandatory), 'C4 mandatoryMissing 全为必备项');
ok(r.j.mandatoryMissing.some((x) => x.name.includes('检验报告')), 'C5 含特种设备检验报告');
ok(r.j.mandatoryMissing.some((x) => x.key === 'plan') && r.j.mandatoryMissing.some((x) => x.key === 'permit'), 'C6 **方案与作业票缺失列为必备缺失**');
ok(r.j.mandatoryMissing.some((x) => x.key === 'summary'), 'C7 大检修缺检修总结列为必备缺失');
ok(/不得用其他材料替代，不得事后补编记录/.test(r.md), 'C8 缺失节含禁止替代声明');
const r2 = run([...BASE, '--type', '大检修', '--materials', SPARSE], 'nonse-missing');
ok(r2.s.counts.mandatoryMissing < r.s.counts.mandatoryMissing, 'C9 非特种设备必备缺失更少（证明特种设备口径确实加严）');
const r3 = run([...BASE, '--type', '日常维修', '--materials', SPARSE], 'minor-missing');
ok(r3.s.counts.mandatoryMissing < r2.s.counts.mandatoryMissing, 'C10 日常维修必备缺失少于大检修');
ok(!r3.j.missing.some((x) => x.key === 'summary'), 'C11 日常维修不要求检修总结');

// ============ D. 检修分级旧值映射与非法值 ============
r = run([...BASE, '--type', '大修', '--materials', FULL], 'old-major');
eq(r.s.ok, true, 'D1 旧值「大修」可运行');
eq(r.j.meta.type, '大检修', 'D2 映射为大检修');
eq(r.j.meta.typeRaw, '大修', 'D3 原填值保留');
eq(r.j.meta.typeMapped, true, 'D4 映射标记');
ok(r.s.warnings.some((w) => w.includes('旧口径') && w.includes('大检修')), 'D5 **旧值映射 warning**');
ok(/大检修（原填「大修」）/.test(r.md), 'D6 概况表同时显示原填值');
eq(run([...BASE, '--type', '小修', '--materials', FULL], 'old-minor').j.meta.type, '日常维修', 'D7 「小修」映射为日常维修');
eq(run([...BASE, '--type', '中修', '--materials', FULL], 'old-mid').j.meta.type, '日常维修', 'D8 「中修」映射为日常维修');
eq(run([...BASE, '--type', '日常维修', '--materials', FULL], 'std').j.meta.typeMapped, false, 'D9 标准值不标映射且无 warning');
ok(!run([...BASE, '--type', '日常维修', '--materials', FULL], 'std2').s.warnings.some((w) => w.includes('旧口径')), 'D10 标准值无旧口径 warning');

// ============ E. 待认领材料不强行归类 ============
const UNC = mk('unc.xlsx', {
  '材料清单': [['文件名', '资料类型'],
    ['检修记录卡.xlsx', '记录'], ['验收单.pdf', '验收'],
    ['会议纪要.docx', ''], ['某某通知.pdf', '']],
});
r = run([...BASE, '--type', '日常维修', '--materials', UNC], 'unclassified');
eq(r.s.counts.unclassified, 2, 'E1 两份无法归类');
ok(r.j.unclassified.every((x) => /未按文件名猜测强行归类/.test(x.note)), 'E2 说明未强行归类');
ok(r.j.warnings.filter((w) => w.includes('无法识别归属类型')).length === 2, 'E3 各有 warning');
ok(/## 四、待认领材料/.test(r.md) && /会议纪要/.test(r.md), 'E4 待认领单列一节');
// 认得出类型、只是本次范围没要求的材料：仍进待认领、不计入已归档，但说明对应类型并提示核对范围开关（不说成「无法识别」）
const UNC2 = mk('unc2.xlsx', { '材料清单': [['文件名'], ['检修记录卡.xlsx'], ['焊工资质证明及焊接记录.pdf']] });
r = run([...BASE, '--type', '日常维修', '--materials', UNC2], 'unclassified2');
const wq = r.j.unclassified.find((x) => /焊工资质/.test(x.name));
ok(wq && /焊接记录与焊工资质|焊工资质证明与焊接记录/.test(wq.note) && /范围开关|--scope/.test(wq.note), 'E5 范围外的已知类型材料说明对应类型并提示核对范围开关');
ok(!r.j.archived.some((x) => x.files.some((f) => /焊工资质/.test(f.name))), 'E6 范围外材料不计入已归档');

// ============ F. 目录扫描 ============
const dir = path.join(work, 'mdir');
fs.mkdirSync(path.join(dir, '子目录'), { recursive: true });
fs.writeFileSync(path.join(dir, '检修方案.docx'), 'x');
fs.writeFileSync(path.join(dir, '检修记录卡.xlsx'), 'x');
fs.writeFileSync(path.join(dir, '子目录', '验收单.pdf'), 'x');
fs.writeFileSync(path.join(dir, '.DS_Store'), 'x');
r = run([...BASE, '--type', '日常维修', '--materials', dir], 'dir');
eq(r.s.ok, true, 'F1 目录模式可运行');
eq(r.s.counts.materials, 3, 'F2 递归扫描且跳过隐藏文件');
ok(r.j.archived.some((x) => x.files.some((f) => f.rel.includes('子目录/'))), 'F3 子目录文件带相对路径');
const empty = path.join(work, 'emptydir');
fs.mkdirSync(empty, { recursive: true });
r = run([...BASE, '--type', '日常维修', '--materials', empty], 'emptydir');
eq(r.s.ok, true, 'F4 空目录不报错');
ok(r.j.warnings.some((w) => w.includes('没有文件')), 'F5 空目录 warning');
ok(r.s.counts.mandatoryMissing > 0, 'F6 空目录必备全缺');
ok(/## 二、已归档资料\n\n_无_/.test(r.md), 'F7 已归档为空时写「无」');

// ============ G. 台账履历更新（厂内台账 + SAP/EM 导出） ============
const LED = mk('led.xlsx', { '设备台账': [['位号', '设备名称'], ['V-01', '分离器'], ['P-01', '泵1']] });
r = run([...BASE, '--type', '日常维修', '--materials', FULL, '--ledger', LED, '--contractor', '二队', '--content', '内件更换'], 'ledger');
ok(r.j.ledgerUpdate !== null, 'G1 生成履历更新建议');
eq(r.j.ledgerUpdate.contractor, '二队', 'G2 承修单位写入');
eq(r.j.ledgerUpdate.content, '内件更换', 'G3 检修内容写入');
eq(r.j.meta.ledgerHasTag, true, 'G4 位号在台账中');
eq(r.j.ledgerUpdate.equipName, '分离器', 'G5 设备名称从台账带出');
ok(/本技能不直接改写台账文件/.test(r.md), 'G6 声明不直接改写台账');
ok(r.csv && r.csv.charCodeAt(0) === 0xFEFF, 'G7 CSV 带 BOM');
const head = r.csv.split('\r\n')[0].replace(/^﻿/, '');
ok(/^"功能位置","设备编号","设备描述","检修类型","检修项目","检修内容","实际开始日期","实际结束日期","承修单位"/.test(head), 'G8 **ledger-update.csv 按 EM 检修记录列头**');
ok(/"必备缺失数"/.test(head), 'G9 CSV 含必备缺失数列');
ok(/## 五、台账履历更新建议（EM 检修记录列头）/.test(r.md) && /功能位置（位号）/.test(r.md), 'G10 md 第五节按 EM 列头');

r = run(['--tag', 'X-99', '--project', 'p', '--type', '日常维修', '--materials', FULL, '--ledger', LED], 'ledger-notag');
eq(r.j.meta.ledgerHasTag, false, 'G11 位号不在台账时标记');
ok(r.j.warnings.some((w) => w.includes('不在设备台账')), 'G12 位号不在台账 warning');
ok(/【注意】位号「X-99」不在所提供台账中/.test(r.md), 'G13 md 用【注意】提示确认位号');

r = run([...BASE, '--type', '日常维修', '--materials', FULL], 'noledger');
eq(r.j.ledgerUpdate, null, 'G14 未提供台账时不生成建议');
ok(/未提供设备台账/.test(r.md), 'G15 md 说明未提供台账');
ok(!fs.existsSync(path.join(r.out, 'ledger-update.csv')), 'G16 未提供台账时不产 CSV');

// SAP PM 技术对象导出：功能位置 / 设备 / 设备描述 / 对象类型，标题行在前
const SAP = mk('sap.xlsx', {
  '技术对象清单': [['SAP PM 技术对象清单'], [],
    ['功能位置', '设备', '设备描述', '对象类型', '维护工厂'],
    ['V-01', '10023001', '低压分离器', '压力容器', '常减压车间'],
    ['P-01', '10023002', '回流泵A', '离心泵', '常减压车间']],
});
r = run([...BASE, '--type', '日常维修', '--materials', FULL, '--ledger', SAP], 'sap');
eq(r.s.ok, true, 'G17 **SAP 技术对象导出可读（工作表「技术对象清单」）**');
eq(r.j.meta.ledgerHasTag, true, 'G18 「功能位置」列作为位号命中');
eq(r.j.ledgerUpdate.equipNo, '10023001', 'G19 SAP「设备」列作为设备编号单独带出');
eq(r.j.ledgerUpdate.equipName, '低压分离器', 'G20 「设备描述」列作为设备名称');
ok(/"V-01","10023001","低压分离器"/.test(r.csv), 'G21 CSV 首三列为功能位置/设备编号/设备描述');
// 用 SAP 设备编号查
r = run(['--tag', '10023002', '--project', 'p', '--type', '日常维修', '--materials', FULL, '--ledger', SAP], 'sap-by-no');
eq(r.j.meta.ledgerHasTag, true, 'G22 按 SAP 设备编号也能命中台账');
eq(r.j.ledgerUpdate.tag, 'P-01', 'G23 命中后履历按功能位置写出');
ok(r.s.warnings.some((w) => w.includes('按设备编号') && w.includes('P-01')), 'G24 按设备编号命中时 warning 提示核实');

// ============ H. 范围开关 ============
r = run([...BASE, '--type', '日常维修', '--materials', FULL], 'noscope');
const n1 = r.s.counts.required;
r = run([...BASE, '--type', '日常维修', '--materials', FULL, '--scope-weld', '--scope-ndt', '--scope-pressure'], 'scope');
ok(r.s.counts.required > n1, 'H1 范围开关增加应归档项');
ok(r.j.required.some((x) => x.key === 'weld'), 'H2 焊接记录被纳入');
ok(/焊接/.test(r.md), 'H3 md 显示涉及范围');

// ============ I. 参数校验 ============
function raw(args) {
  const x = spawnSync(process.execPath, [A, ...args], { encoding: 'utf8' });
  const l = x.stdout.trim().split('\n');
  try { return { code: x.status, s: JSON.parse(l[l.length - 1]) }; } catch (e) { return { code: x.status, s: { ok: false } }; }
}
eq(raw([]).s.ok, false, 'I1 无参数报错');
eq(raw(['--tag']).s.ok, false, 'I2 --tag 缺值报错');
ok(/缺少取值/.test(raw(['--tag']).s.error), 'I3 缺值信息正确');
eq(raw(['--tag', 'V-01', '--project', 'p', '--type', '日常维修']).s.ok, false, 'I4 缺 --materials 报错');
eq(raw(['--tag', 'V-01', '--project', 'p', '--type', '中大修', '--materials', FULL]).s.ok, false, 'I5 非法 type 报错');
ok(/只能是 大检修 \/ 日常维修 \/ 抢修 \/ 专项/.test(raw(['--tag', 'V-01', '--project', 'p', '--type', 'X', '--materials', FULL]).s.error), 'I6 type 错误列出四个分级');
eq(raw(['--tag', 'V-01', '--project', 'p', '--type', '日常维修', '--materials', '/不存在']).s.ok, false, 'I7 材料不存在报错');
eq(raw([...BASE, '--type', '日常维修', '--materials', FULL, '--from', '2026-13-45']).s.ok, false, 'I8 非法日期报错');
eq(raw(['--tag', 'V-01', '--project', 'p', '--type', '日常维修', '--materials', FULL, '--from', '2026-09-20', '--to', '2026-09-10']).s.ok, false, 'I9 to 早于 from 报错');
eq(raw([...BASE, '--type', '日常维修', '--materials', FULL, '--未知', 'x']).s.ok, false, 'I10 未知参数报错');
eq(raw([...BASE, '--type', '日常维修', '--materials', mk('nosheet.xlsx', { '别的': [['a'], [1]] })]).s.ok, false, 'I11 无材料清单表报错');
eq(raw([...BASE, '--type', '日常维修', '--materials', FULL, '--special-equipment']).s.ok, true, 'I12 flag 参数无需取值');
eq(raw([...BASE, '--type', '抢修', '--materials', FULL]).s.ok, true, 'I13 抢修可运行');
eq(raw([...BASE, '--type', '专项', '--materials', FULL]).s.ok, true, 'I14 专项可运行');

// ============ J. 合计行与空文件名 ============
const MESSY = mk('messy.xlsx', {
  '材料清单': [['某厂归档清单'], [],
    ['资料名称', '类型'],
    ['检修记录卡.xlsx', '记录'], ['', '空行'], ['验收单.pdf', '验收'], ['合计', '']],
});
r = run([...BASE, '--type', '日常维修', '--materials', MESSY], 'messy');
eq(r.s.ok, true, 'J1 别名列头+标题行可读');
eq(r.s.counts.materials, 2, 'J2 空文件名与合计行被跳过');
ok(r.j.warnings.some((w) => w.includes('文件名为空')), 'J3 空文件名 warning');
ok(r.j.warnings.some((w) => w.includes('合计行')), 'J4 合计行 warning');

// ============ K. 产出完整性 ============
r = run([...BASE, '--type', '日常维修', '--materials', FULL, '--ledger', LED], 'outputs');
ok(fs.existsSync(path.join(r.out, 'archive.json')), 'K1 archive.json 生成');
ok(fs.existsSync(path.join(r.out, 'archive.md')), 'K2 archive.md 生成');
ok(fs.existsSync(path.join(r.out, 'summary.json')), 'K3 summary.json 生成');
ok(fs.existsSync(path.join(r.out, 'ledger-update.csv')), 'K4 ledger-update.csv 生成');
ok(r.j.meta.generatedAt && /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(r.j.meta.generatedAt), 'K5 生成时间格式正确');
ok('mandatoryMissing' in r.j && Array.isArray(r.j.mandatoryMissing), 'K6 JSON 字段名为 mandatoryMissing（与文档一致）');

// ============ L. 文档口径（出现与不出现两个方向） ============
const skill = fs.readFileSync(path.join(ROOT, 'SKILL.md'), 'utf8');
ok(/大检修\|日常维修\|抢修\|专项/.test(skill), 'L1 SKILL.md 参数用中石化检修分级');
ok(!/大修\|中修\|小修/.test(skill), 'L2 SKILL.md 不再用旧分级作参数');
ok(/mandatoryMissing/.test(skill) && !/mandatory-missing/.test(skill), 'L3 **SKILL.md 字段名与 JSON 对齐为 mandatoryMissing**');
ok(/EM/.test(skill) && /功能位置/.test(skill), 'L4 SKILL.md 说明 EM 检修记录列头与 SAP 列名');
ok(/PDF 先用平台 pdf 技能转为 txt\/docx 再传入，脚本不读 PDF；扫描件需 OCR/.test(skill) || /脚本不读文件内容/.test(skill), 'L5 SKILL.md 说明 PDF 与文件内容处理口径');
ok(/completion-acceptance/.test(skill) && /technical-document-finder/.test(skill) && /inspection-evidence-package/.test(skill), 'L6 description 互指排除语齐全');
ok(/归口/.test(skill) && /档案/.test(skill), 'L7 SKILL.md 写明归口');
ok(/agent_created: true/.test(skill) && /allowed-tools:/.test(skill), 'L8 frontmatter 保留 agent_created 与 allowed-tools');
ok(/用火/.test(skill) || /作业许可/.test(skill), 'L9 SKILL.md 用作业许可口径');
const spec = fs.readFileSync(path.join(ROOT, 'references', 'archive-spec.md'), 'utf8');
ok(/大检修/.test(spec) && /检修总结/.test(spec) && /三查四定/.test(spec) && /中交/.test(spec), 'L10 archive-spec.md 写大检修追加资料');
ok(/中国石化设备管理规定|炼化企业设备管理技术规定/.test(spec) && /TSG 21/.test(spec), 'L11 archive-spec.md 写制度引用');
ok(!/大修 \|/.test(spec), 'L12 archive-spec.md 分级表不再用「大修」作标准值');
const inspec = fs.readFileSync(path.join(ROOT, 'references', 'input-spec.md'), 'utf8');
ok(/功能位置/.test(inspec) && /设备编号/.test(inspec) && /mergeAliases|共享/.test(inspec), 'L13 input-spec 含 SAP 列名与共享别名说明');
const readme = fs.readFileSync(path.join(ROOT, 'scripts', 'README.md'), 'utf8');
ok(/tmpdir/.test(readme) && /--content/.test(readme) && /功能位置/.test(readme), 'L14 scripts/README 记录默认输出目录、--content 与 EM 列头');

console.log(`\n${'='.repeat(56)}`);
console.log(`maintenance-record-archive 自测：${pass} 通过，${fail} 失败`);
if (failures.length) { console.log('\n失败项：'); failures.forEach((f) => console.log('  ✗ ' + f)); }
console.log('='.repeat(56));
try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
