#!/usr/bin/env node
'use strict';
/**
 * 生成本技能的演示与回归样例（可再生）。用法：node scripts/make-sample.js [--out <dir>] [--seed <n>]
 * 不传 --out 时写到演示样例目录（仓库内 炼厂车间设备员/演示case/<分类>/<技能>/，开发包内技能目录 examples/）。
 *
 * 产出（均为虚构）：
 *   一、合并报告样例（merge-report.js 回归）
 *   sample-overhaul-plan.json                    抽取结果 plan.json（E-1201 换热器检修方案，按 references/plan-schema.md 填写）
 *   sample-overhaul-result.json                  **本技能规则引擎 check.js 对上面 plan.json 的真实输出**（不手写，规则号与规则库同源）：
 *                                                恒 3 缺失 / 5 建议完善 / 9 未判定（未标注作业按作业类型聚合）/ 36 已有
 *   sample-overhaul-result-summary-mismatch.json result.json 的 summary 与 findings 计数故意不一致（must_fix 写 5）→ 只 warning 不改源数据
 *   sample-workshop-notes.json                   车间侧提示：已核实 / 未核实 / 不适用 / 已核实
 *   sample-workshop-notes-bad.json               状态写「应该够了」+ 一条自定义项 → 按未核实处理并 warning
 *   sample-overhaul-plan.docx                    机泵检修方案 Word（与 pump-repair.docx 同一份方案，供 docx2text 一步演示）
 *   二、规则引擎端到端回归样例（docx → docx2text → plan.json → check.js）
 *   cdu-overhaul.{docx,docx2text.txt,json,expected-report.md}  常减压装置停工大检修方案：恒 4 缺失 / 3 建议完善 / 0 未判定 / 56 已有
 *   pump-repair.{docx,docx2text.txt,json,expected-report.md}   机泵单体检修方案：恒 0 缺失 / 1 建议完善 / 0 未判定 / 37 已有
 *
 * seed：合并报告样例默认 seed=1，seed 只改方案编号尾号、工期、承修单位与人名。
 *       回归样例不传 --seed 时为基准版本（演示case 入库的就是基准版本）；传 --seed 时生成决定性变体——装置名、方案编号、
 *       承修单位、人名、日期、工期数值与作业清单顺序随 seed 变化，**教学缺失点的数量与类型不变**，上述计数不变。
 * 出错时末行 {"ok":false,"error":...} 并退出码 1。仅 Node.js 内置模块。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const C = require('./lib/common');
const L = require('./lib/docx-lite');

const CHECK = path.join(__dirname, 'check.js');
const DOCX2TEXT = path.join(__dirname, 'docx2text.js');
const warnings = [];

/* ================= 一、回归样例方案 Word（docx-lite 写入端） ================= */
const H1 = (t) => L.pXml(t, { bold: true, size: 14, spacing: 120 });
const H2 = (t) => L.pXml(t, { bold: true, size: 12, spacing: 80 });
const P = (t, o) => L.pXml(t, Object.assign({ size: 10.5, spacing: 40 }, o));
const COVER = (t) => L.pXml(t, { bold: true, size: 22, align: 'center', spacing: 400 });
const SUB = (t) => L.pXml(t, { size: 12, align: 'center', spacing: 120 });

/* ---------------- 变体（决定性伪随机） ---------------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pickR = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];
const rint = (rnd, min, max) => min + Math.floor(rnd() * (max - min + 1)); // 闭区间
const pad2 = (n) => String(n).padStart(2, '0');
function addDaysYmd(d, n) { const t = new Date(Date.UTC(d.y, d.m - 1, d.d + n)); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }; }
function shuffle(rnd, n) { const a = Array.from({ length: n }, (_, i) => i); for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// 单位名、人名、电话均为明显的虚构写法（某甲公司、王某某、内线号）
const CONTRACTORS = ['某甲石化检修工程有限公司', '某乙石化安装工程有限公司', '某丙炼化检修工程有限公司', '某丁石化机电工程有限公司'];
const DEPTS = ['联合装置一部', '联合装置二部', '炼油一部', '炼油二部'];
const MANAGERS = ['王某某', '刘某某', '张某某', '陈某某', '马某某'];
const SAFETY = ['李某某', '赵某某', '周某某', '孙某某', '杨某某', '徐某某'];
const PUMP_MANAGERS = ['陈某某', '孙某某', '吕某某', '郑某某'];
const PUMP_SAFETY = ['刘某某', '王某某', '韩某某', '宋某某'];
const SHOP_NOS = ['一', '二', '三', '四'];

/** 基准变体：与演示case 入库的回归样例完全一致（不传 --seed 时使用） */
function baselineVariant() {
  return {
    seed: null,
    cdu: {
      unitCover: '常减压装置', unitFull: '常减压装置（CDU-1）',
      planNo: 'CDU-DX-2026-01', dept: '联合装置一部',
      contractor: '某甲石化检修工程有限公司', contractorShort: '某甲',
      duration: 45, start: { y: 2026, m: 9, d: 20 },
      manager: '王某某', safety1: '李某某', safety2: '赵某某',
      phone: '内线 0001', duty: '内线 0002',
      jobOrder: [0, 1, 2, 3, 4, 5, 6, 7, 8],
    },
    pump: {
      planNo: 'JX-P102-2026-07', shopNo: '二', duration: 5, drillDay: 2,
      manager: '陈某某', safety: '刘某某', phone: '内线 0001', duty: '内线 0003',
    },
  };
}

/**
 * 变体描述：makeVariant(seed[, overrides]) → 与 baselineVariant() 同构的对象
 *  - seed 为 null/undefined → 基准；同一 seed 结果完全一致
 *  - overrides.unit 覆盖大检修装置名；overrides.date（{y,m,d}）覆盖大检修开工日期
 *  - 教学缺失点不在变体范围内（由 docx 正文固定文本保证），因此数量与类型恒定
 */
function makeVariant(seed, overrides = {}) {
  const v = baselineVariant();
  if (seed !== null && seed !== undefined) {
    const rnd = mulberry32(seed);
    const n = rint(rnd, 1, 9);
    const c = v.cdu;
    c.unitCover = `${n}号常减压装置`;
    c.unitFull = `${n}号常减压装置（CDU-${n}）`;
    c.planNo = `CDU-DX-2026-${pad2(rint(rnd, 1, 30))}`;
    c.dept = pickR(rnd, DEPTS);
    c.contractor = pickR(rnd, CONTRACTORS);
    c.contractorShort = c.contractor.slice(0, 2);
    c.duration = rint(rnd, 41, 50); // 45 天 ±10% 内，保持 >30 天（阶段性检查规则的定性结论不变）
    c.start = addDaysYmd({ y: 2026, m: 9, d: 1 }, rint(rnd, 0, 45));
    c.manager = pickR(rnd, MANAGERS);
    c.safety1 = pickR(rnd, SAFETY);
    c.safety2 = pickR(rnd, SAFETY.filter((x) => x !== c.safety1));
    c.phone = `内线 ${rint(rnd, 1000, 9999)}`;
    c.duty = `内线 ${rint(rnd, 1000, 9999)}`;
    c.jobOrder = shuffle(rnd, 9);
    const p = v.pump;
    p.planNo = `JX-P102-2026-${pad2(rint(rnd, 1, 30))}`;
    p.shopNo = pickR(rnd, SHOP_NOS);
    p.duration = rint(rnd, 4, 7); // 保持 ≤30 天（不触发长周期规则）
    p.drillDay = rint(rnd, 1, 9);
    p.manager = pickR(rnd, PUMP_MANAGERS);
    p.safety = pickR(rnd, PUMP_SAFETY);
    p.phone = `内线 ${rint(rnd, 1000, 9999)}`;
    p.duty = `内线 ${rint(rnd, 1000, 9999)}`;
    v.seed = seed;
  }
  if (overrides.unit) { v.cdu.unitCover = String(overrides.unit); v.cdu.unitFull = String(overrides.unit); }
  if (overrides.date) v.cdu.start = overrides.date;
  return v;
}

/* ---------------- 样例一：常减压装置停工大检修方案 ---------------- */
/** 故意缺失（教学点，任何 seed 下不变）：受限空间气体检测安排、动火分析安排、动火监护人（监火人）、吊装方案、应急演练安排 */
function cduOverhaul(v = baselineVariant()) {
  const c = v.cdu;
  const end = addDaysYmd(c.start, c.duration - 1);
  // 9 项作业（与基准一致的内容），顺序按 jobOrder 变化后重新编号
  const rows = [
    ['常压塔 T-101 内件更换（塔内焊接）', 'T-101', '常压渣油/油气', '受限空间、高处、动火'],
    ['减压塔 T-201 规整填料更换', 'T-201', '减压渣油', '受限空间、高处'],
    ['常压加热炉 F-101 炉管更换', 'F-101 炉膛', '常压渣油', '动火、受限空间'],
    ['原油换热器 E-102 管束抽芯清洗及回装', 'E-102', '原油', '吊装'],
    ['塔顶空冷器 A-101 整体更换', 'A-101 平台', '塔顶油气', '吊装、高处'],
    ['装置界区工艺管线加/拆盲板', '装置界区', '油品、瓦斯', '盲板抽堵'],
    ['电脱盐罐 D-101 内部防腐检修', 'D-101', '原油', '受限空间'],
    ['临时施工用电接引及现场照明', '装置区', '—', '临时用电'],
    ['常压炉出口转油线焊缝射线探伤', 'F-101 出口', '油气', '射线探伤'],
  ];
  const jobs = c.jobOrder.map((idx, i) => [String(i + 1), ...rows[idx]]);
  const body = [
    COVER(`${c.unitCover} ${c.start.y} 年停工大修\n检修方案`),
    SUB(`方案编号：${c.planNo}`),
    SUB(`编制单位：${c.dept}　　施工单位：${c.contractor}`),
    SUB(`${c.start.y} 年 ${c.start.m} 月`),
    P(''),
    H1('一、工程概况'),
    P(`1. 检修装置：${c.unitFull}。`),
    P(`2. 检修项目：${c.start.y} 年停工大修，主要包括塔器内件更换、加热炉炉管更换、换热器抽芯清洗、空冷器更换及配套管线检修。`),
    P(`3. 计划工期：${c.duration} 天（${c.start.y} 年 ${c.start.m} 月 ${c.start.d} 日至 ${end.y} 年 ${end.m} 月 ${end.d} 日）。`),
    P(`4. 施工单位：${c.contractor}（总承包）。`),
    H1('二、检修作业内容'),
    L.tblXml([
      [{ text: '序号', bold: true, align: 'center', shade: 'EEEEEE' }, { text: '作业名称', bold: true, align: 'center', shade: 'EEEEEE' }, { text: '位置', bold: true, align: 'center', shade: 'EEEEEE' }, { text: '涉及介质', bold: true, align: 'center', shade: 'EEEEEE' }, { text: '作业类型', bold: true, align: 'center', shade: 'EEEEEE' }],
      ...jobs,
    ], { widths: [700, 3400, 1500, 1800, 2400], size: 10 }),
    H1('三、安全措施'),
    H2('3.1 通用安全措施'),
    P('（1）开工前由装置技术员组织对每项作业开展作业安全分析（JSA），风险辨识结果及控制措施形成 JSA 记录表（附件 1）。'),
    P('（2）每日开工前由施工单位班组长对作业人员进行安全交底，交底记录签字保存。'),
    P('（3）编制检修专项应急预案（附件 4），明确着火、中毒窒息、高处坠落等场景的应急处置程序及报警电话。'),
    P(`（4）承包商资质审查：已核验${c.contractorShort}公司营业执照、安全生产许可证及特种作业人员操作证，开工前签订安全管理协议。`),
    P('（5）承包商作业人员入厂前完成厂、车间、班组三级安全教育并考核合格。'),
    P('（6）电动工具、吊索具、安全带等工机具进场检验合格并登记挂牌后方可使用。'),
    P('（7）检修现场作业点多、交叉作业多，由检修指挥部设总协调人统一安排作业时序，同一垂直面上下不得同时作业。'),
    P('（8）装置停工后按吹扫置换方案退料、蒸汽吹扫、水洗置换，采样分析合格并办理装置交出手续后方可开工检修。'),
    P('（9）检修用电动机停电、上锁挂牌，隔离阀门挂"禁止操作"警示牌，钥匙由属地班长保管。'),
    P('（10）检修产生的废油、残渣统一收集至危废暂存区，由环保部门联系有资质单位处置。'),
    P('（11）施工材料、机具摆放不得占用消防通道，消火栓周围 2 米内不得堆放物品。'),
    P('（12）检修期间每周五由指挥部组织一次现场安全大检查，检查问题限期整改闭环。'),
    P('（13）检修完工后组织安全验收：确认盲板全部复位销号、现场清理完毕、平台护栏等防护设施恢复，验收单签字后交工。'),
    P('（14）涉及瓦斯、硫化氢等有毒介质的检修作业，作业人员佩戴便携式硫化氢检测报警仪，必要时佩戴空气呼吸器，作业前进行职业危害告知。'),
    P('（15）检修完工后开车前进行安全条件确认：联锁、报警逐项投用，安全阀等安全附件复位，试车阶段设专人监护。'),
    H2('3.2 动火作业'),
    P('（1）每次动火前按级别办理动火安全作业票，动火票由属地单位审批。'),
    P('（2）动火点周围 10 米内清除可燃物，无法清除的用防火毯覆盖；下水井、地漏用湿麻袋封盖。'),
    P('（3）氧气瓶与乙炔瓶间距不小于 5 米，二者距动火点不小于 10 米，气瓶直立固定并配防震圈。'),
    P('（4）每个动火点配备不少于 2 具 8kg 干粉灭火器并定期检查压力。'),
    P('（5）塔内动火作业下方铺设接火盆与防火毯，火花不得溅落至下层脚手架及地面。'),
    H2('3.3 受限空间作业'),
    P('（1）进入塔、罐、炉膛等受限空间前办理受限空间安全作业票。'),
    P('（2）受限空间与外系统连接管线全部加盲板隔离，经蒸汽吹扫、空气置换。'),
    P('（3）作业期间采用防爆轴流风机持续强制通风，严禁向内通氧气。'),
    P('（4）每个受限空间入口设专人监护，实行进出人员登记，监护人不得离岗。'),
    P('（5）现场配备正压式空气呼吸器 2 套、救援绳及安全梯等应急救援器材。'),
    H2('3.4 高处作业'),
    P('（1）脚手架由持证架子工按方案搭设，经使用单位与搭设单位联合验收合格挂绿牌后使用。'),
    P('（2）高处作业人员系双钩安全带，高挂低用；塔区框架临边设安全网，孔洞加盖板。'),
    P('（3）遇 5 级以上大风、雷雨、大雾等恶劣天气，停止露天高处作业与吊装作业。'),
    P('（4）2 米及以上高处作业前按规定办理高处安全作业票。'),
    H2('3.5 吊装作业'),
    P('（1）吊装作业前办理吊装安全作业票，由具备资质的起重指挥统一指挥。'),
    P('（2）吊装区域设警戒绳与警示标志，专人警戒，吊臂及吊物下方严禁站人。'),
    H2('3.6 盲板抽堵作业'),
    P('（1）盲板抽堵前办理盲板抽堵安全作业票；涉及瓦斯、油品管线的佩戴空气呼吸器作业。'),
    P('（2）绘制盲板图（附件 3），盲板统一编号；建立盲板台账，逐块记录加装/拆除时间与确认人，实行挂牌销号。'),
    H2('3.7 临时用电'),
    P('（1）临时用电从检修电源箱接引，电缆架空敷设或穿管保护，接拆线由持低压电工证人员操作。'),
    P('（2）临时用电回路均装设漏电保护器，每日使用前试验一次。'),
    P('（3）临时用电前办理临时用电安全作业票，明确用电时限，完工后由电工确认拆除。'),
    H2('3.8 射线探伤'),
    P('（1）射线探伤安排在 22:00 后进行，探伤前 2 小时通知交叉作业单位撤离；探伤时划定控制区并拉警戒线、设电离辐射警告标志，专人警戒清场。'),
    H1('四、安全组织'),
    P(`成立检修指挥部：现场总负责人（总指挥）：${c.manager}（${c.dept}经理）；专职安全员：${c.safety1}（HSE 部）、${c.safety2}（${c.contractorShort}公司）；应急联系：生产调度 ${c.phone}（24 小时），指挥部值班电话 ${c.duty}。`),
    H1('五、附件'),
    P('附件 1：JSA 记录表（风险评估）'),
    P('附件 2：施工平面布置图'),
    P('附件 3：盲板图及盲板台账'),
    P('附件 4：检修专项应急预案'),
  ].join('');
  return L.buildDocx(body, { title: `${c.unitCover} ${c.start.y} 年停工大修检修方案`, creator: 'make-sample' });
}

/* ---------------- 样例二：机泵单体检修方案（基本合规，仅缺施工平面布置图附件） ---------------- */
function pumpRepair(v = baselineVariant()) {
  const p = v.pump;
  const body = [
    COVER('减压渣油泵 P-102 单体检修方案'),
    SUB(`方案编号：${p.planNo}`),
    SUB(`编制：第${p.shopNo}机修车间　　2026 年 9 月`),
    P(''),
    H1('一、工程概况'),
    P('1. 检修装置：常减压装置 减压渣油泵 P-102。'),
    P('2. 检修项目：P-102 泵解体检修（更换机械密封及轴承）。'),
    P(`3. 计划工期：${p.duration} 天。`),
    P(`4. 施工单位：本项目由本厂第${p.shopNo}机修车间自行实施，不涉及外委施工（方案第 3.1 条已说明资质与协议不适用情形）。`),
    H1('二、检修作业内容'),
    L.tblXml([
      [{ text: '序号', bold: true, align: 'center', shade: 'EEEEEE' }, { text: '作业名称', bold: true, align: 'center', shade: 'EEEEEE' }, { text: '位置', bold: true, align: 'center', shade: 'EEEEEE' }, { text: '涉及介质', bold: true, align: 'center', shade: 'EEEEEE' }, { text: '作业类型', bold: true, align: 'center', shade: 'EEEEEE' }],
      ['1', 'P-102 泵解体检修、更换机械密封及轴承', '泵区', '减压渣油', '无特殊作业'],
      ['2', '泵进出口管线加/拆盲板', 'P-102 进出口', '减压渣油', '盲板抽堵'],
      ['3', '检修临时电源接引（电动扳手、行灯）', '泵区', '—', '临时用电'],
    ], { widths: [700, 3800, 1700, 1600, 2000], size: 10 }),
    H1('三、安全措施'),
    P('（1）检修前由车间技术员组织 JSA 分析，辨识渣油烫伤、盘车伤手等风险并落实控制措施，JSA 记录表见附件 1。'),
    P('（2）开工前班长对参检人员进行安全交底并签字确认。'),
    P(`（3）执行装置区现行《生产区域检维修应急处置预案》，检修人员参加装置区月度应急演练（本季度已于 9 月 ${p.drillDay} 日演练一次）。`),
    P('（4）本项目由本厂机修车间自行实施，不涉及外部承包商，承包商资质审查与安全协议不适用；参检人员均为在册职工并持有效培训记录，检修前进行专项安全教育。'),
    P('（5）电动扳手、捯链、行灯变压器等工机具使用前检查合格。'),
    P('（6）泵检修与盲板抽堵、临时用电接引由机修班长统一协调时序，避免同点交叉作业。'),
    P('（7）工艺处理：P-102 切出、进出口阀关闭，泵内渣油退净、蒸汽吹扫置换合格，办理设备交出确认后开工。'),
    P('（8）电机停电、上锁挂牌"有人检修，禁止合闸"，钥匙由属地班长保管。'),
    P('（9）更换下的废机械密封、含油棉纱统一收集至危废桶，交危废暂存间。'),
    P('（10）检修现场不占用消防通道，泵区消火栓保持畅通。'),
    P('（11）盲板抽堵：办理盲板抽堵安全作业票；按附件 2 盲板图统一编号，建立盲板台账逐块销号；作业人员佩戴防护面罩及耐油手套。'),
    P('（12）临时用电：作业前办理临时用电安全作业票；从泵区检修电源箱接引，装设漏电保护器并试验合格，接拆线由持低压电工证的维修电工负责；行灯采用 36V 安全电压。'),
    P('（13）职业卫生防护：拆开泵体及进出口管线法兰时佩戴防护面罩、耐油手套，现场配便携式硫化氢检测报警仪，防范渣油余温烫伤与硫化氢气体。'),
    P('（14）检修后试车：盘车确认灵活，联轴器防护罩等安全设施恢复后，配合工艺单机试车，确认机械密封无泄漏方可交付使用。'),
    P('（15）完工安全验收：确认盲板全部拆除复位、现场清理干净、联轴器防护罩复位，验收单经车间与属地共同签字。'),
    H1('四、安全组织'),
    P(`现场负责人：机修车间主任 ${p.manager}；安全员：车间安全员 ${p.safety}；应急联系：生产调度 ${p.phone}，车间值班 ${p.duty}。`),
    H1('五、附件'),
    P('附件 1：JSA 记录表'),
    P('附件 2：盲板图及盲板台账'),
    P('附件 3：《生产区域检维修应急处置预案》（引用现行版本 Q/XX-虚构-001）'),
  ].join('');
  return L.buildDocx(body, { title: '减压渣油泵 P-102 单体检修方案', creator: 'make-sample' });
}

/* ================= 二、回归样例抽取结果 plan.json（按 references/extraction-guide.md 从上面两份 Word 抽取） ================= */
function cduPlanBase() {
  return {
    plan_no: 'CDU-DX-2026-01',
    unit: '常减压装置（CDU-1）',
    project: '2026 年停工大修',
    contractor: '某甲石化检修工程有限公司（总承包）',
    duration_days: 45,
    jobs: [
      { name: '常压塔 T-101 内件更换（塔内焊接）', job_types: ['受限空间', '高处', '动火'], medium: '常压渣油/油气', location: 'T-101' },
      { name: '减压塔 T-201 规整填料更换', job_types: ['受限空间', '高处'], medium: '减压渣油', location: 'T-201' },
      { name: '常压加热炉 F-101 炉管更换', job_types: ['动火', '受限空间'], medium: '常压渣油', location: 'F-101 炉膛' },
      { name: '原油换热器 E-102 管束抽芯清洗及回装', job_types: ['吊装'], medium: '原油', location: 'E-102' },
      { name: '塔顶空冷器 A-101 整体更换', job_types: ['吊装', '高处'], medium: '塔顶油气', location: 'A-101 平台' },
      { name: '装置界区工艺管线加/拆盲板', job_types: ['盲板抽堵'], medium: '油品、瓦斯', location: '装置界区' },
      { name: '电脱盐罐 D-101 内部防腐检修', job_types: ['受限空间'], medium: '原油', location: 'D-101' },
      { name: '临时施工用电接引及现场照明', job_types: ['临时用电'], medium: '无（方案标注「—」）', location: '装置区' },
      { name: '常压炉出口转油线焊缝射线探伤', job_types: ['射线探伤'], medium: '油气', location: 'F-101 出口' },
    ],
    measures: {
      risk_identification: '开工前逐项作业开展 JSA，形成 JSA 记录表（附件 1）',
      safety_briefing: '每日开工前班组长对作业人员安全交底，记录签字保存',
      emergency_plan: '编制检修专项应急预案（附件 4），明确着火/中毒窒息/高处坠落处置程序',
      emergency_drill: null,
      contractor_qualification: '已核验营业执照、安全生产许可证及特种作业人员操作证',
      contractor_agreement: '开工前签订安全管理协议',
      contractor_training: '入厂前完成厂、车间、班组三级安全教育并考核合格',
      tool_inspection: '电动工具、吊索具、安全带进场检验合格登记挂牌',
      cross_work_coordination: '指挥部设总协调人统一安排作业时序，同一垂直面上下不同时作业',
      safety_acceptance: '完工组织安全验收：盲板复位销号、现场清理、防护设施恢复，验收单签字',
      process_handover: '停工后退料、蒸汽吹扫、水洗置换，采样分析合格并办理装置交出手续',
      energy_isolation: '检修用电动机停电上锁挂牌，隔离阀门挂禁止操作警示牌',
      waste_disposal: '废油残渣收集至危废暂存区，有资质单位处置',
      fire_access: '材料机具不占用消防通道，消火栓周围 2 米内不堆放物品',
      phased_safety_check: '检修期间每周五指挥部组织现场安全大检查，问题限期整改闭环',
      toxic_protection: '佩戴便携式硫化氢检测报警仪，必要时佩戴空气呼吸器，作业前职业危害告知',
      restart_safety: '开车前联锁、报警逐项投用，安全附件复位，试车阶段专人监护',
      hotwork_permit: '每次动火前按级别办理动火安全作业票',
      combustible_cleanup: '动火点周围 10 米内清除可燃物，无法清除的防火毯覆盖',
      cylinder_distance: '氧气瓶与乙炔瓶间距≥5 米，距动火点≥10 米，直立固定',
      fire_watch_equipment: '每个动火点配 2 具 8kg 干粉灭火器并定期检查压力',
      hotwork_gas_test: null,
      fire_watcher: null,
      confined_permit: '进入塔、罐、炉膛前办理受限空间安全作业票',
      isolation_purge: '连接管线全部加盲板隔离，蒸汽吹扫、空气置换',
      ventilation: '防爆轴流风机持续强制通风，严禁通氧气',
      gas_test_plan: null,
      rescue_equipment: '正压式空气呼吸器 2 套、救援绳及安全梯',
      confined_guardian: '每个受限空间入口专人监护，进出人员登记',
      scaffold_acceptance: '持证架子工按方案搭设，联合验收合格挂绿牌',
      fall_protection: '双钩安全带高挂低用，临边安全网，孔洞加盖板',
      weather_stop: '5 级以上大风、雷雨、大雾停止露天高处与吊装作业',
      highplace_permit: '2 米及以上高处作业前按规定办理高处安全作业票',
      lifting_plan: null,
      lifting_permit: '吊装前办理吊装安全作业票，持证起重指挥统一指挥',
      lifting_warning_zone: '吊装区域设警戒绳与警示标志，专人警戒，吊物下方禁止站人',
      lifting_ground_check: null,
      power_distribution: '检修电源箱接引，电缆架空敷设或穿管保护',
      leakage_protector: '临时用电回路装漏电保护器，每日试验',
      electrician_cert: '接拆线由持低压电工证人员操作',
      temp_power_permit: '临时用电前办理临时用电安全作业票，明确用电时限',
      blind_plate_map: '绘制盲板图（附件 3），盲板统一编号',
      blind_plate_list: '建立盲板台账，逐块记录加装/拆除时间与确认人，挂牌销号',
      blind_plate_permit: '盲板抽堵前办理盲板抽堵安全作业票',
      excavation_permit: null,
      underground_check: null,
      pressure_seal_approval: null,
      pressure_seal_qualified: null,
      radiation_protection: '探伤时划定控制区、拉警戒线、设电离辐射警告标志，专人警戒清场',
      radiation_schedule: '安排 22:00 后进行，提前 2 小时通知交叉作业单位撤离',
      chemical_disposal: null,
      chemical_ppe: null,
      chemical_emergency_flush: null,
      spark_containment: '塔内动火下方铺设接火盆与防火毯，防止火花溅落',
    },
    org: {
      site_manager: '王某某（联合装置一部经理，总指挥）',
      safety_officer: '李某某（HSE 部）、赵某某（某甲公司）',
      emergency_contact: '生产调度 内线 0001（24 小时）；指挥部值班 内线 0002',
    },
    attachments: {
      risk_assessment_doc: '附件 1：JSA 记录表（风险评估）',
      site_layout: '附件 2：施工平面布置图',
      emergency_plan_doc: '附件 4：检修专项应急预案',
    },
    extraction_notes: [
      'measures.emergency_drill：方案通用措施与应急章节均未提及应急演练安排 → 填 null',
      'measures.hotwork_gas_test：3.2 动火措施只写了办票、清可燃物、气瓶与灭火器，未提及动火分析/可燃气体检测安排 → 填 null',
      'measures.fire_watcher：3.2 动火措施未提及动火监护人（监火人）安排 → 填 null',
      'measures.gas_test_plan：3.3 受限空间措施只写了置换、通风、监护，未提及气体检测/分析安排 → 填 null',
      'measures.lifting_plan：3.5 吊装只写了办票与警戒，附件清单亦无吊装方案 → 填 null',
      'measures.lifting_ground_check：方案未提及吊车站位场地承载力确认 → 填 null',
      'duration_days：方案写「45 天（9 月 20 日至 11 月 3 日）」→ 填 45',
      'jobs[7].medium：方案介质栏为「—」（明确无介质）→ 填「无（方案标注「—」）」而非 null',
    ],
  };
}

function pumpPlanBase() {
  const nul = (keys) => Object.fromEntries(keys.map((k) => [k, null]));
  return {
    plan_no: 'JX-P102-2026-07',
    unit: '常减压装置（减压渣油泵 P-102）',
    project: 'P-102 泵解体检修（更换机械密封及轴承）',
    contractor: '本厂第二机修车间（自行检修，不涉及外委）',
    duration_days: 5,
    jobs: [
      { name: 'P-102 泵解体检修、更换机械密封及轴承', job_types: [], medium: '减压渣油', location: '泵区' },
      { name: '泵进出口管线加/拆盲板', job_types: ['盲板抽堵'], medium: '减压渣油', location: 'P-102 进出口' },
      { name: '检修临时电源接引（电动扳手、行灯）', job_types: ['临时用电'], medium: '无（方案标注「—」）', location: '泵区' },
    ],
    measures: {
      risk_identification: '检修前车间技术员组织 JSA 分析，记录表见附件 1',
      safety_briefing: '开工前班长安全交底并签字确认',
      emergency_plan: '执行现行《生产区域检维修应急处置预案》（附件 3 引用）',
      emergency_drill: '参加装置区月度应急演练，本季度 9 月 2 日已演练一次',
      contractor_qualification: '自行检修不涉及外委，方案已说明不适用情形；人员为在册职工持培训记录',
      contractor_agreement: '自行检修不涉及外部承包商，方案已说明安全协议不适用情形',
      contractor_training: '参检人员检修前进行专项安全教育',
      tool_inspection: '电动扳手、捯链、行灯变压器使用前检查合格',
      cross_work_coordination: '泵检修与盲板抽堵、临时用电由机修班长统一协调时序',
      safety_acceptance: '完工验收：盲板复位、现场清理、防护罩复位，车间与属地共同签字',
      process_handover: 'P-102 切出、渣油退净、蒸汽吹扫置换合格，办理设备交出确认',
      energy_isolation: '电机停电上锁挂牌「有人检修，禁止合闸」',
      waste_disposal: '废机械密封、含油棉纱收集至危废桶交危废暂存间',
      fire_access: '现场不占用消防通道，泵区消火栓畅通',
      phased_safety_check: null,
      toxic_protection: '拆法兰时佩戴防护面罩、耐油手套，现场配便携式硫化氢检测报警仪',
      restart_safety: '盘车确认灵活、防护罩恢复后配合工艺单机试车，确认机械密封无泄漏后交付',
      ...nul(['hotwork_permit', 'combustible_cleanup', 'cylinder_distance', 'fire_watch_equipment', 'hotwork_gas_test', 'fire_watcher',
        'confined_permit', 'isolation_purge', 'ventilation', 'gas_test_plan', 'rescue_equipment', 'confined_guardian',
        'scaffold_acceptance', 'fall_protection', 'weather_stop', 'highplace_permit',
        'lifting_plan', 'lifting_permit', 'lifting_warning_zone', 'lifting_ground_check']),
      power_distribution: '从泵区检修电源箱接引，行灯 36V 安全电压',
      leakage_protector: '装设漏电保护器并试验合格',
      electrician_cert: '接拆线由持低压电工证的维修电工负责',
      temp_power_permit: '作业前办理临时用电安全作业票',
      blind_plate_map: '按附件 2 盲板图统一编号',
      blind_plate_list: '建立盲板台账逐块销号',
      blind_plate_permit: '办理盲板抽堵安全作业票',
      ...nul(['excavation_permit', 'underground_check', 'pressure_seal_approval', 'pressure_seal_qualified',
        'radiation_protection', 'radiation_schedule', 'chemical_disposal', 'chemical_ppe', 'chemical_emergency_flush', 'spark_containment']),
    },
    org: {
      site_manager: '陈某某（机修车间主任）',
      safety_officer: '刘某某（车间安全员）',
      emergency_contact: '生产调度 内线 0001；车间值班 内线 0003',
    },
    attachments: {
      risk_assessment_doc: '附件 1：JSA 记录表',
      site_layout: null,
      emergency_plan_doc: '附件 3：《生产区域检维修应急处置预案》（引用现行版本 Q/XX-虚构-001）',
    },
    extraction_notes: [
      'jobs[0].job_types：方案作业类型栏明确写「无特殊作业」→ 填空数组 []（不算未标注）',
      'attachments.site_layout：附件清单无施工平面布置图 → 填 null',
      'contractor：方案写「本厂第二机修车间自行实施，不涉及外委」→ 填车间名称并在资质/协议措施中摘录说明',
      'jobs[2].medium：方案介质栏为「—」（明确无介质）→ 填「无（方案标注「—」）」而非 null',
    ],
  };
}

/**
 * 把基准抽取结果改写为与 makeVariant(seed) 生成的变体 docx 对应的 plan
 * which: 'cdu' | 'pump'；返回深拷贝，不修改入参。措施结构（含教学缺失点的 null）保持不变。
 */
function applyVariantToPlan(basePlan, v, which) {
  const plan = JSON.parse(JSON.stringify(basePlan));
  if (which === 'cdu') {
    const c = v.cdu; const end = addDaysYmd(c.start, c.duration - 1);
    plan.plan_no = c.planNo;
    plan.unit = c.unitFull;
    plan.contractor = `${c.contractor}（总承包）`;
    plan.duration_days = c.duration;
    plan.jobs = c.jobOrder.map((i) => basePlan.jobs[i]);
    plan.org = {
      site_manager: `${c.manager}（${c.dept}经理，总指挥）`,
      safety_officer: `${c.safety1}（HSE 部）、${c.safety2}（${c.contractorShort}公司）`,
      emergency_contact: `生产调度 ${c.phone}（24 小时）；指挥部值班 ${c.duty}`,
    };
    const te = plan.jobs.findIndex((j) => Array.isArray(j.job_types) && j.job_types.includes('临时用电'));
    plan.extraction_notes = (plan.extraction_notes || []).map((nn) => {
      if (nn.startsWith('duration_days')) return `duration_days：方案写「${c.duration} 天（${c.start.m} 月 ${c.start.d} 日至 ${end.m} 月 ${end.d} 日）」→ 填 ${c.duration}`;
      if (nn.startsWith('jobs[7].medium')) return `jobs[${te}].medium：方案介质栏为「—」（明确无介质）→ 填「无（方案标注「—」）」而非 null`;
      return nn;
    });
  } else if (which === 'pump') {
    const p = v.pump;
    plan.plan_no = p.planNo;
    plan.contractor = `本厂第${p.shopNo}机修车间（自行检修，不涉及外委）`;
    plan.duration_days = p.duration;
    plan.measures.emergency_drill = `参加装置区月度应急演练，本季度 9 月 ${p.drillDay} 日已演练一次`;
    plan.org = {
      site_manager: `${p.manager}（机修车间主任）`,
      safety_officer: `${p.safety}（车间安全员）`,
      emergency_contact: `生产调度 ${p.phone}；车间值班 ${p.duty}`,
    };
  } else {
    throw new Error(`applyVariantToPlan：未知 which=${which}`);
  }
  return plan;
}

/** 回归样例的期望计数（与演示case README 一致；任何 seed 下不变） */
const REGRESSION_CASES = {
  'cdu-overhaul': { build: cduOverhaul, plan: cduPlanBase, which: 'cdu', expected: { must_fix: 4, should_improve: 3, undetermined: 0, pass: 56 }, skipped: 7 },
  'pump-repair': { build: pumpRepair, plan: pumpPlanBase, which: 'pump', expected: { must_fix: 0, should_improve: 1, undetermined: 0, pass: 37 }, skipped: 32 },
};

/* ================= 三、合并报告样例：E-1201 换热器检修方案 ================= */
function bridgePlan(seed) {
  let s = seed * 7919 + 13;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const no2 = () => String(10 + Math.floor(rnd() * 80));
  const pick = (arr) => arr[Math.floor(rnd() * arr.length) % arr.length];
  const NAMES = ['张', '李', '王', '赵', '刘'];
  // 教学缺失点（不随 seed 变）：无风险辨识/JSA、动火点可燃物清理未写、无盲板图 → 3 缺失；
  // 无应急演练、无应急联系方式、有作业未标注类型、无风险评估报告附件、无施工平面图 → 5 建议完善；
  // 「空冷器管束顶部检查」未标注作业类型 → 未触发的专项规则按作业类型聚合为 9 条未判定
  const planNo = `JX-E1201-2026-${no2()}`;
  const duration = 4 + Math.floor(rnd() * 4); // 4~7 天，不触及工期 >30 天的规则
  return {
    plan_no: planNo,
    unit: '常减压装置（原油换热器 E-1201）',
    project: 'E-1201 抽管束清洗及法兰补焊检修方案',
    contractor: `检修公司第${pick(['一', '二', '三'])}工程部`,
    duration_days: duration,
    jobs: [
      { name: 'E-1201 抽管束清洗', job_types: [], medium: '原油', location: '换热器框架' },
      { name: 'E-1201 法兰补焊', job_types: ['动火'], medium: '原油', location: 'E-1201 管程进口法兰' },
      { name: 'E-1201 进出口加盲板', job_types: ['盲板抽堵'], medium: '原油', location: 'E-1201 进出口' },
      { name: '检修临时电源接引', job_types: ['临时用电'], medium: '无', location: '换热器框架' },
      { name: '空冷器管束顶部检查', job_types: null, medium: '原油', location: '空冷平台' },
    ],
    measures: {
      risk_identification: null,
      safety_briefing: '开工前班长安全交底并签字确认',
      emergency_plan: '执行现行《生产区域检维修应急处置预案》',
      emergency_drill: null,
      contractor_qualification: '承修单位资质证书、特种作业人员证件已报车间备案',
      contractor_agreement: '已与承修单位签订检修安全协议',
      contractor_training: '参检人员检修前进行专项安全教育',
      tool_inspection: '电焊机、捯链、行灯变压器使用前检查合格',
      cross_work_coordination: '补焊、盲板抽堵、临时用电由检修班长统一协调时序',
      safety_acceptance: '完工验收：盲板复位、现场清理，车间与属地共同签字',
      process_handover: 'E-1201 切出、存油退净、蒸汽吹扫置换合格，办理设备交出确认',
      energy_isolation: '相关电机停电上锁挂牌「有人检修，禁止合闸」',
      waste_disposal: '废垫片、含油棉纱收集至危废桶交危废暂存间',
      fire_access: '现场不占用消防通道，框架消火栓畅通',
      phased_safety_check: null,
      toxic_protection: '拆法兰时佩戴防护面罩、耐油手套，现场配便携式硫化氢检测报警仪',
      restart_safety: '回装后配合工艺试压、确认法兰无泄漏后交付',
      hotwork_permit: '动火前办理用火作业许可证',
      combustible_cleanup: null,
      cylinder_distance: '氧气乙炔瓶间距不小于 5 米，距动火点不小于 10 米',
      fire_watch_equipment: '现场配干粉灭火器 2 具、蒸汽胶带 1 根',
      hotwork_gas_test: '每次动火前 30min 内做动火分析，合格方可动火',
      fire_watcher: '设专职监火人，动火全过程不离开现场',
      confined_permit: null, isolation_purge: null, ventilation: null, gas_test_plan: null, rescue_equipment: null, confined_guardian: null,
      scaffold_acceptance: null, fall_protection: null, weather_stop: null, highplace_permit: null,
      lifting_plan: null, lifting_permit: null, lifting_warning_zone: null, lifting_ground_check: null,
      power_distribution: '从框架检修电源箱接引，行灯 36V 安全电压',
      leakage_protector: '装设漏电保护器并试验合格',
      electrician_cert: '接拆线由持低压电工证的维修电工负责',
      temp_power_permit: '作业前办理临时用电安全作业票',
      blind_plate_map: null,
      blind_plate_list: '建立盲板台账逐块销号',
      blind_plate_permit: '办理盲板抽堵安全作业票',
      excavation_permit: null, underground_check: null, pressure_seal_approval: null, pressure_seal_qualified: null,
      radiation_protection: null, radiation_schedule: null, chemical_disposal: null, chemical_ppe: null, chemical_emergency_flush: null,
      spark_containment: null,
    },
    org: {
      site_manager: `${pick(NAMES)}某（检修公司项目负责人）`,
      safety_officer: `${pick(NAMES)}某（车间安全员）`,
      emergency_contact: null,
    },
    attachments: {
      risk_assessment_doc: null,
      site_layout: null,
      emergency_plan_doc: '附件：《生产区域检维修应急处置预案》（引用现行版本）',
    },
    extraction_notes: [
      'jobs[4].job_types：方案「空冷器管束顶部检查」未写作业类型 → 填 null',
      'measures.risk_identification：方案无风险分析章节 → 填 null',
    ],
  };
}

/* ================= 运行工具 ================= */
const lastJson = (s) => { try { return JSON.parse(String(s || '').trim().split('\n').pop()); } catch (e) { return null; } };
/** 跑本技能规则引擎 check.js，返回 {summary, result, report}；输出写系统临时目录 */
function runCheck(planPath, tmpRoot) {
  const outDir = fs.mkdtempSync(path.join(tmpRoot, 'chk-'));
  const r = spawnSync(process.execPath, [CHECK, '--input', planPath, '--out', outDir], { encoding: 'utf8' });
  const rp = path.join(outDir, 'result.json');
  if (r.status !== 0 || !fs.existsSync(rp)) throw new Error(`规则引擎 check.js 运行失败：${(r.stdout || '').trim().split('\n').pop() || r.stderr}`);
  return { summary: lastJson(r.stdout), result: JSON.parse(fs.readFileSync(rp, 'utf8')), report: fs.readFileSync(path.join(outDir, 'report.md'), 'utf8') };
}

function main() {
  const a = C.parseArgs(process.argv.slice(2), ['out', 'seed'], []);
  if (a.seed !== undefined && !/^-?\d+$/.test(String(a.seed))) throw new Error(`--seed 必须是整数，收到「${a.seed}」`);
  // 默认输出到演示样例目录：仓库内在 炼厂车间设备员/演示case/<分类>/<技能>/，开发包内在技能目录 examples/
  const skillsRoot = path.resolve(__dirname, '../../..');
  const caseDir = path.basename(skillsRoot) === '设备员skill' ? path.join(skillsRoot, '..', '演示case', path.relative(skillsRoot, path.resolve(__dirname, '..'))) : path.join(__dirname, '..', 'examples');
  const out = a.out || caseDir;
  const seed = a.seed !== undefined ? parseInt(a.seed, 10) : 1;
  const variant = makeVariant(a.seed !== undefined ? seed : null);
  fs.mkdirSync(out, { recursive: true });
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'opcb-sample-'));
  const counts = {};
  try {
    // ---- 一、合并报告样例：plan.json → 本技能 check.js 真实 result.json
    const plan = bridgePlan(seed);
    const planPath = path.join(out, 'sample-overhaul-plan.json');
    fs.writeFileSync(planPath, JSON.stringify(plan, null, 2), 'utf8');
    const chk = runCheck(planPath, tmpRoot);
    fs.writeFileSync(path.join(out, 'sample-overhaul-result.json'), JSON.stringify(chk.result, null, 2), 'utf8');
    const mismatch = JSON.parse(JSON.stringify(chk.result));
    mismatch.summary = { ...mismatch.summary, must_fix: 5 };
    fs.writeFileSync(path.join(out, 'sample-overhaul-result-summary-mismatch.json'), JSON.stringify(mismatch, null, 2), 'utf8');
    counts['sample-overhaul'] = chk.result.summary;

    fs.writeFileSync(path.join(out, 'sample-workshop-notes.json'), JSON.stringify([
      { item: '设备交出条件', status: '已核实', note: `交出清单已按 equipment-handover-check 生成，${C.localDate()} 工艺、设备、安全三方已确认` },
      { item: '同期交叉作业', status: '未核实', note: '' },
      { item: '承包商资质', status: '不适用', note: '本厂机修车间自行检修，不涉及外委' },
      { item: '备件与工机具到位', status: '已核实', note: '法兰垫片、螺栓已领用，试压泵已到位' },
    ], null, 2), 'utf8');
    fs.writeFileSync(path.join(out, 'sample-workshop-notes-bad.json'), JSON.stringify([
      { item: '设备交出条件', status: '应该够了', note: '班长说明天能交' },
      { item: '同期交叉作业', status: '已核实', note: '同期无其他方案施工' },
      { item: '脚手架方案', status: '已核实', note: '脚手架方案已另行审批（车间自查项）' },
    ], null, 2), 'utf8');

    // ---- 二、规则引擎端到端回归样例：docx → docx2text.txt；plan.json → check.js → expected-report.md
    for (const [name, c] of Object.entries(REGRESSION_CASES)) {
      const docxPath = path.join(out, `${name}.docx`);
      fs.writeFileSync(docxPath, c.build(variant));
      const t = spawnSync(process.execPath, [DOCX2TEXT, '--input', docxPath, '--out', path.join(out, `${name}.docx2text.txt`)], { encoding: 'utf8' });
      if (t.status !== 0) throw new Error(`docx2text.js 读取 ${name}.docx 失败：${(t.stdout || '').trim().split('\n').pop() || t.stderr}`);
      const p = variant.seed === null ? c.plan() : applyVariantToPlan(c.plan(), variant, c.which);
      const pp = path.join(out, `${name}.json`);
      fs.writeFileSync(pp, JSON.stringify(p, null, 2) + '\n', 'utf8');
      const rc = runCheck(pp, tmpRoot);
      if (JSON.stringify(rc.summary) !== JSON.stringify(c.expected)) throw new Error(`${name} 计数 ${JSON.stringify(rc.summary)} 与期望 ${JSON.stringify(c.expected)} 不一致，样例被改坏`);
      fs.writeFileSync(path.join(out, `${name}.expected-report.md`), rc.report, 'utf8');
      counts[name] = rc.summary;
    }
    // 机泵检修方案 Word 另存一份 sample-overhaul-plan.docx（上架信息示例问题 1 的附件）
    fs.copyFileSync(path.join(out, 'pump-repair.docx'), path.join(out, 'sample-overhaul-plan.docx'));
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  console.log(JSON.stringify({
    ok: true, out, seed, variantSeed: variant.seed, planNo: JSON.parse(fs.readFileSync(path.join(out, 'sample-overhaul-plan.json'), 'utf8')).plan_no,
    counts,
    files: fs.readdirSync(out).filter((f) => /\.(json|docx|txt|md)$/.test(f) && f !== 'README.md').sort(),
    warnings,
  }));
}

if (require.main === module) {
  try { main(); } catch (e) { C.fail(e, warnings); }
}
module.exports = { cduOverhaul, pumpRepair, makeVariant, baselineVariant, applyVariantToPlan, cduPlanBase, pumpPlanBase, REGRESSION_CASES };
