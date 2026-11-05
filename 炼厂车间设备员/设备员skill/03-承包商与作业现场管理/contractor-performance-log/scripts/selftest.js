#!/usr/bin/env node
'use strict';
/**
 * 自测：生成变体输入并断言 performance.js 行为。用法：node scripts/selftest.js（全绿退出 0）
 * 重点覆盖：承包商名称不一致只提示不合并、严重程度为空不按最低档计分、默认口径免责标注、
 *          评价说明不得定性判断（措辞约束写入产出）、声明行、未整改单列。
 * 注：样例中承包商名、人名全部编造。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { writeXlsx } = require('./lib/xlsx-lite');
const C = require('./lib/common');

const PERF = path.join(__dirname, 'performance.js');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cpl-selftest-'));
const TO = '2026-09-21';
const FROM = '2026-07-01';
const D = (n) => C.addDays(TO, n);
let pass = 0, fail = 0;
const failures = [];

function ok(cond, name) { if (cond) { pass++; } else { fail++; failures.push(name); } }
function eq(actual, expect, name) { ok(actual === expect, `${name}（期望 ${JSON.stringify(expect)}，实际 ${JSON.stringify(actual)}）`); }

const H = ['记录日期', '承包商', '项目', '类型', '事项描述', '严重程度', '整改情况', '检查人'];
const DISCLAIMER = '本数据为车间（属地单位）侧记录汇总，承包商考核由安全环保部门归口、业务主管部门配合，分档定性与处罚按厂内制度决定；评分口径若非厂内正式口径，结果仅供参考';

function run(file, extra = [], tag) {
  const out = path.join(work, (tag || path.basename(file, '.xlsx')) + '-out');
  const r = spawnSync(process.execPath, [PERF, '--input', file, '--workshop', '测试车间', '--from', FROM, '--to', TO, '--out', out, ...extra], { encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  let summary;
  try { summary = JSON.parse(lines[lines.length - 1]); } catch (e) { summary = { ok: false, error: 'no-json:' + r.stdout + r.stderr }; }
  let pf = null, md = null;
  if (fs.existsSync(path.join(out, 'performance.json'))) pf = JSON.parse(fs.readFileSync(path.join(out, 'performance.json'), 'utf8'));
  if (fs.existsSync(path.join(out, 'performance.md'))) md = fs.readFileSync(path.join(out, 'performance.md'), 'utf8');
  return { code: r.status, summary, pf, md, out };
}
function mk(name, book) { const p = path.join(work, name); writeXlsx(p, book); return p; }
const g = (pf, name) => pf.byContractor.find((x) => x.contractor === name);

// ================= 1. 基础评分与分档 =================
const base = mk('base.xlsx', {
  '检查记录': [
    H,
    [D(-40), '甲建安工程有限公司', '项目一', '安全违章', '未系安全带', '一般违章', '已整改', '周工'],      // -2
    [D(-35), '甲建安工程有限公司', '项目一', '安全违章', '动火无灭火器材', '严重违章', '已整改', '周工'],  // -5
    [D(-30), '甲建安工程有限公司', '项目一', '安全违章', '未办票入罐', '重大违章', '已整改', '马工'],      // -10
    [D(-25), '乙机电安装有限公司', '项目二', '施工质量', '对中超标返工', '返工', '已整改', '周工'],        // -3
    [D(-20), '乙机电安装有限公司', '项目二', '进度履约', '节点推迟', '延期', '已整改', '周工'],            // -2
    [D(-15), '丙防腐保温工程队', '项目三', '现场配合', '料具乱堆', '文明施工差', '已整改', '周工'],        // -1
  ],
});
let r = run(base, [], 'base');
eq(r.summary.ok, true, '1.1 基础运行成功');
eq(r.summary.counts.records, 6, '1.2 区间内记录数');
eq(r.summary.counts.contractors, 3, '1.3 承包商名称数');
eq(g(r.pf, '甲建安工程有限公司').deduction, 17, '1.4 安全违章扣分合计 2+5+10=17');
eq(g(r.pf, '甲建安工程有限公司').score, 83, '1.5 基准分 100 扣 17 得 83');
eq(g(r.pf, '甲建安工程有限公司').grade, '良', '1.6 83 分归「良」档');
eq(g(r.pf, '乙机电安装有限公司').score, 95, '1.7 质量 3 + 进度 2 → 95');
eq(g(r.pf, '乙机电安装有限公司').grade, '优', '1.8 95 分归「优」档');
eq(g(r.pf, '丙防腐保温工程队').score, 99, '1.9 文明施工差 -1 → 99');
eq(g(r.pf, '甲建安工程有限公司').dims.safety.deduction, 17, '1.10 安全违章维度扣分独立记录');
eq(g(r.pf, '乙机电安装有限公司').dims.quality.deduction, 3, '1.11 施工质量维度扣分');
eq(g(r.pf, '乙机电安装有限公司').dims.schedule.deduction, 2, '1.12 进度履约维度扣分');
eq(g(r.pf, '丙防腐保温工程队').dims.cooperation.deduction, 1, '1.13 现场配合维度扣分');
eq(r.summary.counts.byDim.safety, 3, '1.14 四维度计数：安全违章');
eq(r.summary.counts.byDim.quality, 1, '1.15 四维度计数：施工质量');

// 分档边界
const gradeEdge = mk('grade.xlsx', {
  '检查记录': [
    H,
    [D(-40), '优边界队', '项目', '安全违章', '违章', '严重违章', '已整改', '周工'],       // 100-5=95 优
    [D(-40), '优边界队', '项目', '安全违章', '违章', '严重违章', '已整改', '周工'],       // 90 优（边界）
    [D(-40), '良边界队', '项目', '安全违章', '违章', '重大违章', '已整改', '周工'],
    [D(-40), '良边界队', '项目', '安全违章', '违章', '重大违章', '已整改', '周工'],       // 80 良（边界）
    [D(-40), '一般队', '项目', '安全违章', '违章', '重大违章', '已整改', '周工'],
    [D(-40), '一般队', '项目', '安全违章', '违章', '重大违章', '已整改', '周工'],
    [D(-40), '一般队', '项目', '安全违章', '违章', '重大违章', '已整改', '周工'],         // 70 一般（边界）
    [D(-40), '差队', '项目', '安全违章', '违章', '重大违章', '已整改', '周工'],
    [D(-40), '差队', '项目', '安全违章', '违章', '重大违章', '已整改', '周工'],
    [D(-40), '差队', '项目', '安全违章', '违章', '重大违章', '已整改', '周工'],
    [D(-40), '差队', '项目', '安全违章', '违章', '严重违章', '已整改', '周工'],           // 65 差
  ],
});
r = run(gradeEdge, [], 'grade');
eq(g(r.pf, '优边界队').score, 90, '1.16 优档下边界得分 90');
eq(g(r.pf, '优边界队').grade, '优', '1.17 90 分归「优」');
eq(g(r.pf, '良边界队').grade, '良', '1.18 80 分归「良」');
eq(g(r.pf, '一般队').grade, '一般', '1.19 70 分归「一般」');
eq(g(r.pf, '差队').grade, '差', '1.20 65 分归「差」');

// ================= 2. 承包商名称不一致 → 只提示，绝不自动合并（本技能最关键判定）=================
const amb = mk('ambiguity.xlsx', {
  '检查记录': [
    H,
    [D(-40), '宏远建安工程有限公司', '项目一', '安全违章', '未系安全带', '一般违章', '已整改', '周工'],
    [D(-35), '宏远建安工程有限公司', '项目一', '安全违章', '动火无灭火器材', '严重违章', '已整改', '周工'],
    [D(-30), '宏远建安', '项目一', '施工质量', '试压不合格', '质量不合格', '未整改', '周工'],
    [D(-25), '安泰机电安装有限公司', '项目二', '进度履约', '节点推迟', '延期', '已整改', '周工'],
  ],
});
r = run(amb, [], 'ambiguity');
eq(r.summary.counts.nameAmbiguity, 1, '2.1 识别出 1 组疑似同一单位的名称');
eq(r.summary.counts.contractors, 3, '2.2 名称未被合并，仍按 3 个名称各自统计');
ok(!!g(r.pf, '宏远建安工程有限公司') && !!g(r.pf, '宏远建安'), '2.3 全称与简称各自单独成行');
eq(g(r.pf, '宏远建安工程有限公司').records, 2, '2.4 全称的记录数未被并入简称');
eq(g(r.pf, '宏远建安').records, 1, '2.5 简称的记录数未被并入全称');
eq(g(r.pf, '宏远建安工程有限公司').score, 93, '2.6 全称得分仅按其自身记录计算（100-7）');
eq(g(r.pf, '宏远建安').score, 95, '2.7 简称得分仅按其自身记录计算（100-5）');
ok(r.pf.nameAmbiguity[0].names.includes('宏远建安工程有限公司') && r.pf.nameAmbiguity[0].names.includes('宏远建安'), '2.8 nameAmbiguity 列出名称组');
ok(/未合并统计/.test(r.pf.nameAmbiguity[0].note) && /人工确认/.test(r.pf.nameAmbiguity[0].note), '2.9 nameAmbiguity 注明未合并须人工确认');
ok(typeof r.pf.nameAmbiguity[0].reason === 'string' && r.pf.nameAmbiguity[0].reason.length > 0, '2.10 给出疑似依据');
ok(Array.isArray(r.pf.nameAmbiguity[0].rows['宏远建安']), '2.11 给出各名称对应的行号供核对');
ok(g(r.pf, '宏远建安工程有限公司').nameAmbiguous === true, '2.12 得分表标记名称待确认');
ok(g(r.pf, '安泰机电安装有限公司').nameAmbiguous === false, '2.13 无歧义单位未被误标');
ok(r.pf.warnings.some((w) => w.includes('疑似同一单位') && w.includes('未自动合并')), '2.14 名称疑似重复有 warning');
ok(/## 五、承包商名称待确认/.test(r.md), '2.15 名称待确认单列成节');
ok(/未作任何合并统计/.test(r.md), '2.16 md 明示未作合并');
ok(/名称待确认/.test(r.md.split('## 一、')[0]), '2.17 名称待确认在报告开头提示');
// 不同单位不得被误判为同一单位
const diff = mk('diffnames.xlsx', {
  '检查记录': [
    H,
    [D(-40), '宏远建安工程有限公司', '项目', '安全违章', '违章', '一般违章', '已整改', '周工'],
    [D(-40), '安泰机电安装有限公司', '项目', '安全违章', '违章', '一般违章', '已整改', '周工'],
    [D(-40), '瑞丰防腐保温工程队', '项目', '安全违章', '违章', '一般违章', '已整改', '周工'],
  ],
});
r = run(diff, [], 'diffnames');
eq(r.summary.counts.nameAmbiguity, 0, '2.18 名称完全不同的单位不误报歧义');
ok(/本期未发现疑似重复的承包商名称/.test(r.md), '2.19 无歧义时写明「未发现」');

// ================= 3. 严重程度为空 → undetermined 不计分，绝不按最低档 =================
const nosev = mk('nosev.xlsx', {
  '检查记录': [
    H,
    [D(-40), '甲队', '项目', '安全违章', '脚手架挂牌不全', '', '已整改', '周工'],          // 程度空
    [D(-38), '甲队', '项目', '安全违章', '临时用电不规范', '待定级', '已整改', '周工'],     // 程度无法归类
    [D(-36), '甲队', '项目', '安全违章', '未系安全带', '一般违章', '已整改', '周工'],       // 对照 -2
  ],
});
r = run(nosev, [], 'nosev');
eq(r.summary.counts.undetermined, 2, '3.1 程度为空与无法归类均进 undetermined');
eq(g(r.pf, '甲队').deduction, 2, '3.2 未判定项未计分，扣分仅来自可判定的 1 条');
eq(g(r.pf, '甲队').score, 98, '3.3 未判定项绝不按最低档（若按一般违章 -2 则为 94）');
eq(g(r.pf, '甲队').undeterminedCount, 2, '3.4 逐家统计单列未判定条数');
ok(r.pf.undetermined.every((x) => x.deduction === null), '3.5 未判定项扣分为 null 而非 0 分档值');
ok(r.pf.undetermined.some((x) => /严重程度为空/.test(x.reason) && /未按最低档计分/.test(x.reason)), '3.6 未判定原因写明程度为空且未按最低档');
ok(r.pf.undetermined.some((x) => /待定级/.test(x.reason) && /无法归类/.test(x.reason)), '3.7 程度无法归类的原因正确');
ok(r.pf.warnings.some((w) => w.includes('严重程度为空') && w.includes('未按最低档计分')), '3.8 程度为空有 warning');
ok(r.pf.warnings.some((w) => w.includes('待定级') && w.includes('无法归类')), '3.9 程度无法归类有 warning');
ok(/## 六、未判定记录/.test(r.md) && /不按最低档处理/.test(r.md), '3.10 未判定单列成节并声明不按最低档');
ok(!r.pf.items.some((x) => x.undetReason && x.deduction !== null), '3.11 有未判定原因的记录一律不带扣分');
// 类型缺失也不得计分
const nodim = mk('nodim.xlsx', {
  '检查记录': [
    H,
    [D(-40), '乙队', '项目', '', '某问题', '一般违章', '已整改', '周工'],       // 类型空
    [D(-38), '乙队', '项目', '其他', '未交施工日志', '一般', '未整改', '周工'],  // 类型无法归类
  ],
});
r = run(nodim, [], 'nodim');
eq(r.summary.counts.undetermined, 2, '3.12 类型缺失与无法归类均 undetermined');
eq(g(r.pf, '乙队').deduction, 0, '3.13 类型无法确定时不计分');
eq(g(r.pf, '乙队').score, 100, '3.14 类型未判定不影响基准分');
ok(r.pf.undetermined.some((x) => /类型缺失/.test(x.reason)), '3.15 类型缺失原因正确');

// ================= 4. 默认口径免责标注（必须出现在产出中）=================
r = run(base, [], 'notice');
eq(r.summary.isDefaultRules, true, '4.1 未传 --rules 时标为默认口径');
eq(r.summary.rulesNotice, '采用默认口径，非厂内正式口径，结果仅供参考', '4.2 summary 带默认口径提示语');
eq(r.pf.meta.rulesNotice, '采用默认口径，非厂内正式口径，结果仅供参考', '4.3 performance.json meta 带提示语');
ok(/采用默认口径/.test(r.md) && /非厂内正式口径/.test(r.md) && /结果仅供参考/.test(r.md), '4.4 md 明确标注默认口径非厂内正式口径');
ok(/非厂内正式口径/.test(r.md.split('## 一、')[0]), '4.5 口径提示位于报告开头');
ok(/非厂内正式口径/.test(r.md.split('## 二、')[1].split('## 三、')[0]), '4.6 得分汇总表旁再次标注口径性质');
eq(r.pf.rules.isDefault, true, '4.7 rules 段标明默认口径');
eq(r.pf.rules.baseScore, 100, '4.8 默认基准分 100');
eq(r.pf.rules.deduct.safety.major, 10, '4.9 默认重大违章 -10');
eq(r.pf.rules.deduct.safety.serious, 5, '4.10 默认严重违章 -5');
eq(r.pf.rules.deduct.safety.minor, 2, '4.11 默认一般违章 -2');
eq(r.pf.rules.deduct.quality.rework, 3, '4.12 默认返工 -3');
eq(r.pf.rules.deduct.quality.unqualified, 5, '4.13 默认质量不合格 -5');
eq(r.pf.rules.deduct.schedule.delay, 2, '4.14 默认延期 -2');
eq(r.pf.rules.deduct.schedule.seriousDelay, 5, '4.15 默认严重延期 -5');
eq(r.pf.rules.deduct.cooperation.poorHousekeeping, 1, '4.16 默认文明施工差 -1');
eq(r.pf.rules.deduct.cooperation.uncooperative, 3, '4.17 默认不配合 -3');

// ================= 5. --rules 覆盖厂内口径 =================
const rulesFile = mk('rules.xlsx', {
  '评分口径': [
    ['类型名称', '程度名称', '扣分', '基准分'],
    ['安全违章', '一般违章', 3, 100],
    ['安全违章', '严重违章', 8, ''],
    ['安全违章', '重大违章', 15, ''],
  ],
});
r = run(base, ['--rules', rulesFile], 'rules');
eq(r.summary.isDefaultRules, false, '5.1 传入 --rules 后不再是默认口径');
eq(g(r.pf, '甲建安工程有限公司').deduction, 26, '5.2 厂内口径扣分 3+8+15=26');
eq(g(r.pf, '甲建安工程有限公司').score, 74, '5.3 厂内口径下得分 74');
ok(/厂内口径/.test(r.pf.meta.rulesSource), '5.4 产出标注采用厂内口径');
ok(!/采用默认口径，非厂内正式口径，结果仅供参考/.test(r.md), '5.5 厂内口径时不再标注「采用默认口径」提示语');
ok(r.md.includes(DISCLAIMER), '5.5b 厂内口径时固定声明行仍保留');
ok(/厂内口径/.test(r.md), '5.6 md 写明厂内口径来源');
const badRules = mk('badrules.xlsx', { '评分口径': [['类型名称', '程度名称', '扣分'], ['莫名维度', '莫名程度', 5]] });
r = run(base, ['--rules', badRules], 'badrules');
eq(r.summary.isDefaultRules, true, '5.7 口径文件无可用行时回落默认口径');
ok(r.pf.warnings.some((w) => w.includes('无法归入四个维度')), '5.8 口径行无法归类有 warning');

// ================= 6. 未整改项单列 =================
const unrect = mk('unrect.xlsx', {
  '检查记录': [
    H,
    [D(-40), '甲队', '项目', '安全违章', '违章一', '一般违章', '未整改', '周工'],
    [D(-38), '甲队', '项目', '施工质量', '返工项', '返工', '整改中', '周工'],
    [D(-36), '甲队', '项目', '安全违章', '违章二', '一般违章', '已整改', '周工'],
    [D(-34), '甲队', '项目', '现场配合', '配合项', '文明施工差', '', '周工'],   // 整改情况空 → 不算未整改
  ],
});
r = run(unrect, [], 'unrect');
eq(r.summary.counts.unrectified, 2, '6.1 未整改与整改中均计入未整改');
ok(r.pf.unrectified.every((x) => x.rectified === false), '6.2 unrectified 数组仅含未整改项');
ok(!r.pf.unrectified.some((x) => x.rawRect === ''), '6.3 整改情况为空的项不臆断为未整改');
eq(g(r.pf, '甲队').unrectifiedCount, 2, '6.4 逐家统计未整改条数');
ok(/## 四、未整改项/.test(r.md), '6.5 未整改单列成节');
ok(/违章一/.test(r.md.split('## 四、')[1].split('## 五、')[0]), '6.6 未整改项逐条列出');
eq(g(r.pf, '甲队').deduction, 8, '6.7 未整改不影响扣分口径（仍按程度计分：2+3+2+1）');

// ================= 7. 违章明细按严重程度分组 =================
const vio = mk('vio.xlsx', {
  '检查记录': [
    H,
    [D(-40), '甲队', '项目', '安全违章', '重大一', '重大违章', '已整改', '周工'],
    [D(-38), '甲队', '项目', '安全违章', '严重一', '严重违章', '已整改', '周工'],
    [D(-36), '甲队', '项目', '安全违章', '一般一', '一般违章', '已整改', '周工'],
    [D(-34), '甲队', '项目', '安全违章', '一般二', '一般违章', '已整改', '周工'],
    [D(-32), '甲队', '项目', '安全违章', '程度空', '', '已整改', '周工'],
    [D(-30), '甲队', '项目', '施工质量', '返工项', '返工', '已整改', '周工'],   // 非违章维度
  ],
});
r = run(vio, [], 'vio');
eq(r.summary.counts.violations, 5, '7.1 违章总数仅含安全违章维度');
eq(r.pf.violations.major.length, 1, '7.2 重大违章分组');
eq(r.pf.violations.serious.length, 1, '7.3 严重违章分组');
eq(r.pf.violations.minor.length, 2, '7.4 一般违章分组');
eq(r.pf.violations.undetermined.length, 1, '7.5 程度未判定的违章单独分组');
ok(r.pf.violations.undetermined[0].deduction === null, '7.6 未判定违章不带扣分');
ok(/## 三、违章明细/.test(r.md) && /重大违章（1 条）/.test(r.md) && /严重程度未判定（1 条）/.test(r.md), '7.7 违章明细按程度分组成节');
ok(/—（未计分）/.test(r.md), '7.8 未判定违章在明细中标「未计分」而非 0');

// ================= 8. 区间过滤与日期缺失 =================
const rng = mk('range.xlsx', {
  '检查记录': [
    H,
    [D(-40), '甲队', '项目', '安全违章', '区间内', '一般违章', '已整改', '周工'],
    ['2026-05-01', '甲队', '项目', '安全违章', '区间外', '重大违章', '已整改', '周工'],
    ['', '甲队', '项目', '安全违章', '日期缺失', '重大违章', '已整改', '周工'],
  ],
});
r = run(rng, [], 'range');
eq(r.summary.counts.records, 1, '8.1 仅区间内记录参与统计');
eq(r.summary.counts.outOfRange, 1, '8.2 区间外记录单列计数');
eq(r.summary.counts.noDate, 1, '8.3 日期缺失记录单列计数');
eq(g(r.pf, '甲队').deduction, 2, '8.4 区间外与日期缺失记录均不计分');
ok(r.pf.warnings.some((w) => w.includes('不在评价区间')), '8.5 区间外有 warning');
ok(r.pf.warnings.some((w) => w.includes('记录日期缺失')), '8.6 日期缺失有 warning');
ok(r.pf.undetermined.some((x) => /记录日期缺失/.test(x.reason)), '8.7 日期缺失项进未判定，未臆断归属');

// ================= 9. 承包商为空 =================
const noname = mk('noname.xlsx', {
  '检查记录': [
    H,
    [D(-40), '', '项目', '安全违章', '无归属的违章', '一般违章', '未整改', '周工'],
    [D(-38), '甲队', '项目', '安全违章', '正常记录', '一般违章', '已整改', '周工'],
    ['', '', '', '', '', '', '', ''],
  ],
});
r = run(noname, [], 'noname');
eq(r.summary.counts.records, 2, '9.1 全空行跳过，承包商为空的行保留');
ok(!!g(r.pf, '（未填承包商）'), '9.2 承包商为空单列为「（未填承包商）」');
ok(r.pf.warnings.some((w) => w.includes('承包商为空')), '9.3 承包商为空有 warning');
ok(!r.pf.nameAmbiguity.some((p) => p.names.includes('（未填承包商）')), '9.4 「（未填承包商）」不参与名称歧义判断');

// ================= 10. 别名列头 + 标题行 + 合计行 =================
const messy = mk('messy.xlsx', {
  '违章记录': [
    ['某某炼化厂 承包商现场违章记录（系统导出）'],
    [],
    ['检查日期', '施工单位', '工程名称', '问题类型', '问题描述', '违章等级', '整改状态', '检查人员'],
    [D(-30), '中兴检修工程有限公司', '冷换检修', '安全违章', '气瓶未固定', '一般违章', '已整改', '周工'],
    [D(-28), '中兴检修工程有限公司', '冷换检修', '施工质量', '焊口返修', '返工', '未整改', '周工'],
    ['合计', '2 条', '', '', '', '', '', ''],
  ],
});
r = run(messy, [], 'messy');
eq(r.summary.ok, true, '10.1 别名列头 + 标题行 + 违章记录表名可读');
eq(r.summary.counts.records, 2, '10.2 合计行被跳过');
ok(r.pf.warnings.some((w) => w.includes('合计行')), '10.3 合计行有 warning');
eq(g(r.pf, '中兴检修工程有限公司').deduction, 5, '10.4 别名表判定与计分正确');

// ================= 11. 缺列 → warning 不中断 =================
const nocol = mk('nocol.xlsx', {
  '检查记录': [
    ['记录日期', '承包商', '类型', '事项描述'],
    [D(-40), '甲队', '安全违章', '某违章'],
  ],
});
r = run(nocol, [], 'nocol');
eq(r.summary.ok, true, '11.1 缺可选列不中断');
eq(r.summary.counts.undetermined, 1, '11.2 缺严重程度列 → 该条未判定');
eq(g(r.pf, '甲队').score, 100, '11.3 缺严重程度列绝不按最低档扣分');
eq(r.summary.counts.unrectified, 0, '11.4 缺整改情况列不臆断为未整改');

// ================= 12. 参数校验 =================
function runRaw(args) {
  const rr = spawnSync(process.execPath, [PERF, ...args], { encoding: 'utf8' });
  const lines = rr.stdout.trim().split('\n');
  try { return { code: rr.status, s: JSON.parse(lines[lines.length - 1]) }; } catch (e) { return { code: rr.status, s: { ok: false, error: 'no-json' } }; }
}
let x = runRaw(['--input']);
eq(x.s.ok, false, '12.1 --input 缺值报错');
eq(x.code, 1, '12.2 退出码为 1');
ok(/缺少取值/.test(x.s.error), '12.3 缺值错误信息正确');
x = runRaw(['--input', base, '--workshop', '车间', '--from', FROM, '--to', '2026-13-45']);
eq(x.s.ok, false, '12.4 非法日期报错');
x = runRaw(['--input', base, '--workshop', '车间', '--from', FROM, '--to', TO, '--未知参数', 'x']);
eq(x.s.ok, false, '12.5 未知参数报错');
x = runRaw(['--input', '/不存在的记录.xlsx', '--workshop', '车间', '--from', FROM, '--to', TO]);
eq(x.s.ok, false, '12.6 输入不存在报错');
x = runRaw(['--input', base, '--workshop', '车间', '--from', FROM]);
eq(x.s.ok, false, '12.7 缺 --to 报错');
x = runRaw(['--input', base, '--workshop', '车间', '--to', TO]);
eq(x.s.ok, false, '12.8 缺 --from 报错');
x = runRaw(['--input', base, '--from', FROM, '--to', TO]);
eq(x.s.ok, false, '12.9 缺 --workshop 报错');
x = runRaw(['--input', base, '--workshop', '车间', '--from', TO, '--to', FROM]);
eq(x.s.ok, false, '12.10 --from 晚于 --to 报错');
x = runRaw(['--input', base, '--workshop', '车间', '--from', FROM, '--to', TO, '--rules', '/不存在的口径.xlsx']);
eq(x.s.ok, false, '12.11 口径文件不存在报错');

// ================= 13. 无检查记录工作表 → ok:false =================
const bad = mk('bad.xlsx', { '随便一张表': [['a', 'b'], [1, 2]] });
r = run(bad, [], 'bad');
eq(r.summary.ok, false, '13.1 无检查记录工作表时 ok:false');
eq(r.code, 1, '13.2 退出码为 1');
ok(/未在输入中找到/.test(r.summary.error), '13.3 错误信息明确');

// ================= 14. 声明行、章节、占位符、summary.json =================
r = run(base, [], 'struct');
ok(r.md.includes(DISCLAIMER), '14.1 md 保留声明行');
eq((r.md.match(new RegExp(DISCLAIMER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length, 2, '14.2 声明行在开头与末尾各出现一次');
eq(r.pf.meta.disclaimer, DISCLAIMER, '14.3 performance.json 带声明行原文');
ok(/## 一、评价区间与口径说明/.test(r.md) && /## 二、各承包商得分汇总/.test(r.md) && /## 三、违章明细/.test(r.md)
  && /## 四、未整改项/.test(r.md) && /## 五、承包商名称待确认/.test(r.md) && /## 六、未判定记录/.test(r.md)
  && /## 七、评价说明/.test(r.md), '14.4 七节结构齐全');
ok(/<!-- ANALYSIS_START -->/.test(r.md) && /<!-- ANALYSIS_END -->/.test(r.md), '14.5 分析段占位符存在');
ok(/不得使用「该队伍能力差」「不建议再用」/.test(r.md), '14.6 占位文字写明禁止定性判断');
ok(/只陈述记录事实/.test(r.md), '14.7 占位文字写明只陈述记录事实');
ok(fs.existsSync(path.join(r.out, 'summary.json')), '14.8 summary.json 已写入');
ok(fs.existsSync(path.join(r.out, 'performance.json')), '14.9 performance.json 已写入');
ok(fs.existsSync(path.join(r.out, 'performance.md')), '14.10 performance.md 已写入');
const sj = JSON.parse(fs.readFileSync(path.join(r.out, 'summary.json'), 'utf8'));
eq(sj.ok, true, '14.11 summary.json 内容正确');
ok(typeof sj.counts.records === 'number' && typeof sj.rulesNotice === 'string', '14.12 summary.json 含 counts 与口径提示');
ok(Array.isArray(r.pf.byContractor) && Array.isArray(r.pf.unrectified) && Array.isArray(r.pf.nameAmbiguity)
  && Array.isArray(r.pf.undetermined) && !!r.pf.violations && !!r.pf.counts, '14.13 performance.json 六个约定字段齐全');
// 脚本产出中不得出现定性判断用语
// 定性判断用语只允许出现在「禁止使用」的占位提示中，正文任何一处都不得出现
const bodyNoPlaceholder = r.md.split('<!-- ANALYSIS_START -->')[0] + r.md.split('<!-- ANALYSIS_END -->')[1];
ok(!/能力差|不建议再用|不靠谱|水平低|信誉差|该队伍差/.test(bodyNoPlaceholder), '14.14 脚本产出正文不含定性判断用语');
ok(/不得使用/.test(r.md.split('<!-- ANALYSIS_START -->')[1].split('<!-- ANALYSIS_END -->')[0]), '14.15 定性判断用语仅作为「不得使用」的反例出现在占位提示中');

// ================= 15. --contractor 筛选、--roster、--orders =================
r = run(amb, ['--contractor', '安泰机电安装有限公司'], 'filter');
eq(r.summary.counts.contractors, 1, '15.1 --contractor 筛选生效');
eq(r.summary.counts.records, 1, '15.2 筛选后记录数正确');
eq(r.summary.counts.nameAmbiguity, 1, '15.3 筛选不影响名称待确认节的完整性');
const roster = mk('roster.xlsx', {
  '承包商名单': [['承包商名称', '简称'], ['宏远建安工程有限公司', '宏远建安'], ['安泰机电安装有限公司', '安泰机电']],
});
r = run(amb, ['--roster', roster], 'roster');
eq(r.summary.ok, true, '15.4 --roster 可读');
eq(g(r.pf, '宏远建安工程有限公司').inRoster, true, '15.5 名单内单位被标记');
eq(r.summary.counts.nameAmbiguity, 1, '15.6 记录中实际混用了全称与简称的那一组仍然提示');
ok(r.pf.nameAmbiguity.every((p) => !(p.names.includes('安泰机电') && p.names.includes('安泰机电安装有限公司'))),
  '15.6b 名单已声明、但记录中只用了一种写法的对应关系不误报为待确认');
ok(r.pf.nameAmbiguity.some((p) => p.names.includes('宏远建安') && p.names.includes('宏远建安工程有限公司')),
  '15.6c 记录中混用的名称组仍按待确认提示，脚本仍不合并');
const orders = mk('orders.xlsx', {
  '工单台账': [['工单号', '承包商', '项目', '完成情况'],
    ['GD-001', '宏远建安工程有限公司', '项目一', '已完成'],
    ['GD-002', '宏远建安工程有限公司', '项目一', '未完成']],
});
r = run(amb, ['--orders', orders], 'orders');
ok(Array.isArray(r.pf.orderStats) && r.pf.orderStats[0].orders === 2, '15.7 --orders 统计工单数');
eq(r.pf.orderStats[0].done, 1, '15.8 工单已完成数');
eq(r.pf.orderStats[0].undone, 1, '15.9 工单未完成数');
ok(/工单履约情况（参考）/.test(r.md) && /不参与评分/.test(r.md), '15.10 工单节标明不参与评分');
eq(g(r.pf, '宏远建安工程有限公司').score, 93, '15.11 工单数据未改变评分');

// ================= 16. 无扣分记录 → 满分 =================
const clean = mk('clean.xlsx', {
  '检查记录': [H, [D(-20), '丙队', '项目', '现场配合', '料具码放整齐', '文明施工差', '已整改', '周工']],
});
r = run(clean, [], 'clean');
eq(g(r.pf, '丙队').score, 99, '16.1 单条轻微扣分得 99');
eq(g(r.pf, '丙队').grade, '优', '16.2 99 分归「优」');
eq(r.summary.counts.nameAmbiguity, 0, '16.3 单一单位无名称歧义');
eq(r.summary.counts.unrectified, 0, '16.4 无未整改项');
ok(/_无_/.test(r.md.split('## 四、')[1].split('## 五、')[0]), '16.5 未整改节为空时显示「无」');

// ================= 17. 中石化口径：承包商编码分组、违章三档、「不符合」、监护人列、系统列名、归口术语 =================
const exp = mk('export.xlsx', {
  '承包商检查记录': [
    ['承包商现场检查记录导出（承包商管理平台）'],
    ['检查日期', '供应商编码', '作业单位名称', '许可证编号', '作业内容', '违章类型', '违章内容', '违章等级', '闭环情况', '属地检查人', '监护人'],
    [D(-40), 'V100023', '华鑫机电安装有限公司', 'YH-2026-0912', '空冷器管束更换', '安全违章', '用火作业监护人离开现场', '严重违规', '已闭环', '设备员周建', '监护人甲'],
    [D(-36), 'V100023', '华鑫机电', 'GC-2026-0331', '空冷器管束更换', '安全违章', '高处作业未佩戴安全带', '一般违章', '已闭环', '设备员周建', '监护人乙'],
    [D(-30), 'V100023', '华鑫机电安装有限公司', '', '空冷器管束更换', '施工质量', '泄漏试验不符合要求', '不符合', '未闭环', '设备员周建', ''],
    [D(-24), 'V100087', '恒信防腐工程有限公司', '', '管线防腐翻新', '现场配合', '废料未清运', '文明施工差', '已闭环', '安全员马力', ''],
    [D(-20), '', '无编码施工队', '', '零星维修', '安全违章', '未戴安全帽', '一般违章', '已闭环', '安全员马力', ''],
    ['合计', '', '5 条', '', '', '', '', '', '', '', ''],
  ],
});
r = run(exp, [], 'export');
eq(r.summary.ok, true, '17.1 承包商管理平台 / 作业许可系统列名可读');
eq(r.summary.counts.records, 5, '17.2 标题行与合计行处理正确');
eq(r.summary.groupedByCode, true, '17.3 有供应商编码列时按编码分组');
eq(r.summary.counts.contractors, 3, '17.4 同一编码两种名称合并为一行：2 个编码 + 1 个无编码名称');
const hx = r.pf.byContractor.find((x) => x.code === 'V100023');
ok(!!hx && hx.names.includes('华鑫机电安装有限公司') && hx.names.includes('华鑫机电'), '17.5 同一编码下两种名称写法并列记录');
eq(hx.records, 3, '17.6 编码分组后记录数合并');
eq(hx.dims.safety.deduction, 7, '17.7 「严重违规」归严重违章 -5（不是重大 -10）：5+2=7');
ok(r.pf.items.some((x) => x.rawSev === '严重违规' && x.sev === 'serious'), '17.8 严重违规 → serious');
ok(!r.pf.items.some((x) => x.rawSev === '严重违规' && x.sev === 'major'), '17.9 严重违规不归 major');
const bf = r.pf.items.find((x) => x.rawSev === '不符合');
ok(!!bf && bf.sev === 'unknown' && bf.deduction === null, '17.10 施工质量「不符合」不自动归质量不合格，进未判定不扣分');
ok(r.pf.warnings.some((w) => w.includes('不符合') && w.includes('不自动归质量不合格')), '17.11 「不符合」有专门提示');
eq(hx.dims.quality.deduction, 0, '17.12 「不符合」未按质量不合格 -5 计分');
eq(r.summary.counts.nameAmbiguity, 0, '17.13 按编码分组的名称差异不进名称待确认');
ok(r.pf.warnings.some((w) => w.includes('承包商编码') && w.includes('按编码分组')), '17.14 编码分组有 warning 提示');
ok(r.pf.warnings.some((w) => w.includes('V100023') && w.includes('2 种名称写法')), '17.15 同一编码多名称有 warning');
ok(!!r.pf.byContractor.find((x) => x.contractor === '无编码施工队' && x.code === null), '17.16 无编码记录仍按名称分组');
ok(r.pf.items.every((x) => x.inspector !== '监护人甲' && x.inspector !== '监护人乙'), '17.17 「监护人」列不被当作检查人');
ok(r.pf.items.some((x) => x.inspector === '设备员周建'), '17.18 「属地检查人」列命中检查人');
ok(r.pf.items.some((x) => x.rectified === false && x.rawRect === '未闭环'), '17.19 「闭环情况」列命中整改情况');
ok(/华鑫机电安装有限公司 \/ 华鑫机电/.test(r.md), '17.20 md 得分表中同一编码的名称并列展示');
ok(/分组方式：有承包商编码的记录按编码分组/.test(r.md), '17.21 md 报头注明分组方式');
r = run(exp, ['--contractor', 'V100023'], 'export-code');
eq(r.summary.counts.contractors, 1, '17.22 --contractor 支持按承包商编码筛选');
// 无编码列时按名称分组（反向）
r = run(amb, [], 'ambiguity-nocode');
eq(r.summary.groupedByCode, false, '17.23 无承包商编码列时不按编码分组');
ok(!/分组方式：有承包商编码/.test(r.md), '17.24 无编码列时 md 不写编码分组');
// 归口术语与无 emoji
r = run(base, [], 'terms');
ok(/安全环保部门归口/.test(r.md), '17.25 md 写明承包商考核由安全环保部门归口');
ok(!/由设备部按厂内制度决定/.test(r.md), '17.26 md 不再写「由设备部决定」');
ok(!/[☀-➿\u{1F300}-\u{1FAFF}]/u.test(r.md), '17.27 md 不含 emoji');
ok(/【注意】/.test(r.md), '17.28 醒目提示用「【注意】」');
ok(/rules-template\.xlsx/.test(r.md), '17.29 默认口径提示指向 assets/templates/rules-template.xlsx');
ok(fs.existsSync(path.join(__dirname, '..', 'assets', 'templates', 'rules-template.xlsx')), '17.30 assets/templates/rules-template.xlsx 存在');
// 模板文件可直接作为 --rules 读取（分值留空 → 无可用行回落默认并 warning）
r = run(base, ['--rules', path.join(__dirname, '..', 'assets', 'templates', 'rules-template.xlsx')], 'tpl');
eq(r.summary.ok, true, '17.31 模板文件可被 --rules 读取');
eq(r.summary.isDefaultRules, true, '17.32 模板未填分值时回落默认口径');
ok(r.pf.warnings.some((w) => w.includes('无可用的扣分行')), '17.33 模板未填分值有 warning');
ok(/厂内分档/.test(r.pf.meta.gradesSource), '17.34 模板的「分档标准」工作表被读取');
// 厂内分档标准覆盖
const rulesGrade = mk('rules-grade.xlsx', {
  '评分口径': [['类型名称', '程度名称', '扣分'], ['安全违章', '一般违章', 2]],
  '分档标准': [['分档', '最低分'], ['A 档', 95], ['B 档', 85], ['C 档', '']],
});
r = run(base, ['--rules', rulesGrade], 'rules-grade');
eq(g(r.pf, '甲建安工程有限公司').grade, 'C 档', '17.35 厂内分档标准生效（83 分 → C 档）');
eq(g(r.pf, '乙机电安装有限公司').grade, 'A 档', '17.36 厂内分档标准生效（95 分 → A 档）');
// 作业单位 / 承修单位（共享别名）命中承包商列
const sysAlias = mk('sysalias.xlsx', {
  '检查记录': [
    ['记录日期', '承修单位', '类型', '事项描述', '严重程度'],
    [D(-20), '丁检修公司', '安全违章', '违章', '一般违章'],
  ],
});
r = run(sysAlias, [], 'sysalias');
ok(!!g(r.pf, '丁检修公司'), '17.37 「承修单位」（共享别名）命中承包商列');

// ================= W. 车间范围核对（D007）：检查记录全套（HSE 平台导出带「车间」列），工单台账一条混合剔除 =================
{
  // 与 HSE 管理平台 get_site_inspections 导出列序一致：车间列在记录日期与承包商之间
  const WH = ['记录日期', '车间', '承包商', '承包商编码', '项目', '类型', '事项描述', '严重程度', '整改情况', '检查人'];
  const row = (ws, name, code, sev, n) => [D(-n), ws, name, code, '项目一', '安全违章', '未系安全带', sev, '已整改', '周工'];
  const wsOf = (x, i = 0) => ((x.pf && x.pf.meta && x.pf.meta.workshopScope) || [])[i] || {};
  const byCode = (x, code) => ((x.pf && x.pf.byContractor) || []).find((c) => c.code === code) || {};
  let w = run(mk('ws-mix.xlsx', { '检查记录': [WH,
    row('测试车间', '甲建安工程有限公司', 'C1001', '一般违章', 10),
    row('加氢车间', '甲建安工程有限公司', 'C1001', '重大违章', 11),
    row('加氢车间', '乙检修公司', 'C1002', '严重违章', 12),
    row('', '甲建安工程有限公司', 'C1001', '一般违章', 13),
    row('测试', '丙机电公司', 'C1003', '一般违章', 14)] }), [], 'ws-mix');
  eq(w.pf && w.pf.counts.records, 3, 'W1 两车间混合：只统计本车间与车间为空的检查记录（3 条）');
  ok(w.pf && byCode(w, 'C1001').score === 96 && !w.pf.byContractor.some((c) => c.code === 'C1002'), 'W2 加氢车间的记录不计分：C1001 只扣本车间两条一般违章（96 分），C1002 不出现');
  ok(w.pf && w.pf.warnings.some((x) => /剔除其他车间 2 行/.test(x) && /加氢车间 2 行/.test(x)), 'W3 warning 写明剔除行数与车间名');
  ok(wsOf(w).status === 'checked' && wsOf(w).column === '车间' && wsOf(w).droppedRows === 2 && (wsOf(w).dropped || {})['加氢车间'] === 2, 'W4 meta.workshopScope 记录剔除情况（车间列归「车间」，不被承包商等列抢走）');
  ok(wsOf(w).blank === 1 && w.pf.items.length === 3, 'W5 车间列为空的行按本车间保留');
  ok(w.pf && w.pf.items.every((it) => it.contractor && it.contractor !== '测试车间' && it.contractor !== '加氢车间'), 'W6 加车间列后承包商列仍取「承包商」，不错取车间');
  ok(w.md && /车间范围：已按车间列核对「测试车间」，剔除其他车间的行：「检查记录」2 行（加氢车间 2 行）/.test(w.md), 'W7 md 口径写明按车间核对');
  w = run(mk('ws-mis.xlsx', { '检查记录': [WH, row('加氢车间', '甲建安工程有限公司', 'C1001', '一般违章', 10), row('焦化车间', '乙检修公司', 'C1002', '一般违章', 11)] }), [], 'ws-mis');
  ok(w.pf && w.pf.counts.records === 2 && wsOf(w).status === 'mismatch', 'W8 车间列全不一致：不筛，status=mismatch');
  ok(w.pf && w.pf.warnings.some((x) => /^【注意】/.test(x)), 'W9 车间列全不一致 warning 以【注意】开头');
  const at = w.md ? w.md.indexOf('的车间列取值与 --workshop「测试车间」不一致') : -1;
  ok(at > 0 && at < w.md.indexOf('## 一'), 'W10 md 开头（第一节之前）有【注意】提示');
  const noWs = (r0) => r0.filter((_, i) => i !== 1);
  w = run(mk('ws-nocol.xlsx', { '检查记录': [noWs(WH), noWs(row('', '甲建安工程有限公司', 'C1001', '一般违章', 10)), noWs(row('', '乙检修公司', 'C1002', '一般违章', 11))] }), [], 'ws-nocol');
  ok(wsOf(w).status === 'noColumn' && w.pf.counts.records === 2 && /输入未含车间列，车间范围以取数条件为准/.test(w.md), 'W11 无车间列：不筛，md 口径说明以取数条件为准');
  const plantH = WH.map((h) => (h === '车间' ? '维护工厂' : h));
  w = run(mk('ws-plant.xlsx', { '检查记录': [plantH, row('1100', '甲建安工程有限公司', 'C1001', '一般违章', 10), row('1200', '乙检修公司', 'C1002', '一般违章', 11)] }), [], 'ws-plant');
  ok(wsOf(w).status === 'noColumn' && w.pf.counts.records === 2, 'W12 「维护工厂」列不当车间列（noColumn，不筛）');
  const wsOrders = mk('ws-orders.xlsx', { '工单台账': [['工单号', '承包商', '项目', '完成情况', '车间'],
    ['GD-001', '甲建安工程有限公司', '项目一', '已完成', '测试车间'],
    ['GD-002', '甲建安工程有限公司', '项目一', '未完成', '加氢车间']] });
  w = run(mk('ws-o-in.xlsx', { '检查记录': [WH, row('测试车间', '甲建安工程有限公司', 'C1001', '一般违章', 10)] }), ['--orders', wsOrders], 'ws-orders');
  ok(w.pf && w.pf.orderStats && w.pf.orderStats[0].orders === 1 && w.pf.orderStats[0].done === 1 && wsOf(w, 1).sheet === '工单台账' && wsOf(w, 1).droppedRows === 1, 'W13 工单台账混合：剔除其他车间工单，scopes 记两张表');
  const sscH = WH.map((h) => (h === '车间' ? '所属车间' : h));
  w = run(mk('ws-ssc.xlsx', { '检查记录': [sscH, row('测试车间', '甲建安工程有限公司', 'C1001', '一般违章', 10), row('加氢车间', '乙检修公司', 'C1002', '一般违章', 11)] }), [], 'ws-ssc');
  ok(wsOf(w).status === 'checked' && wsOf(w).column === '所属车间' && w.pf.counts.records === 1, 'W14 「所属车间」列同样核对');
}

// ================= 输出 =================
console.log(`\n${'='.repeat(56)}`);
console.log(`contractor-performance-log 自测：${pass} 通过，${fail} 失败`);
if (failures.length) { console.log('\n失败项：'); failures.forEach((f) => console.log('  ✗ ' + f)); }
console.log('='.repeat(56));
try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
