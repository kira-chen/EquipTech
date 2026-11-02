#!/usr/bin/env node
'use strict';
/**
 * 承包商资质核验脚本（仅 Node.js 内置模块）
 * 用法：node "<技能目录>/scripts/qualify.js" --input <xlsx> --contractor "<承包商名称>" --work-type "用火作业,高处作业"
 *       --from <YYYY-MM-DD> --to <YYYY-MM-DD> [--out <dir>] [--lead-days 30] [--spec <厂内要求xlsx>] [--history <历史准入记录xlsx>]
 * 产出：<out>/qualify.json、<out>/qualify.md、<out>/summary.json；末行打印 JSON 摘要
 */
const fs = require('fs');
const path = require('path');
const { readXlsx, readCsvDir } = require('./lib/xlsx-lite');
const C = require('./lib/common');

const warnings = [];
const VALUE_OPTS = ['input', 'contractor', 'work-type', 'from', 'to', 'out', 'lead-days', 'spec', 'history', 'contractor-type',
  'edu-valid-days', 'medical-valid-days', 'review-years'];
const FLAG_OPTS = ['help'];

/** 固定声明行 —— SKILL.md 要求原文写入 md，不得删除或弱化 */
const DISCLAIMER = '本核验为辅助审查，承包商准入须经安全部门按厂内制度审批；证书真伪须通过发证机关渠道核实';

/**
 * 列名别名：局部别名 + 共享 SYSTEM_ALIASES（SAP / 承包商管理平台 / 作业许可系统导出列名），局部优先。
 * 合并后注意：共享表的「作业类别」含「作业类型」，本脚本在人员表只读「作业类别」、在准入要求表只读「作业类型」，两者不同表不冲突。
 */
const ALIASES = C.mergeAliases({
  // 单位资质表
  '资质名称': ['资质名称', '证照名称', '资质类型', '证书名称', '名称', '资质'],
  '证书编号': ['证书编号', '证号', '编号', '证件编号', '许可证号', '执照号'],
  '发证机关': ['发证机关', '发证单位', '签发机关', '颁发机关'],
  '发证日期': ['发证日期', '签发日期', '发证时间', '取证日期', '签订日期'],
  '有效期至': ['有效期至', '有效期截止', '到期日期', '截止日期', '有效期限', '有效期', '失效日期'],
  '资质等级': ['资质等级', '等级', '级别'],
  '经营/承包范围': ['经营/承包范围', '经营范围', '承包范围', '资质范围', '业务范围', '范围'],
  // 人员证书表
  '姓名': ['姓名', '人员姓名', '作业人员', '员工姓名', '名字'],
  '身份证号': ['身份证号', '身份证', '证件号码', '身份证件号'],
  '岗位': ['岗位', '工种', '职务', '作业岗位'],
  '证书类型': ['证书类型', '证书名称', '证件类型', '证书种类', '持证类型', '证件名称'],
  '作业类别': ['作业类别', '准操项目', '操作项目', '作业项目', '准操作项目', '项目'],
  '项目代号': ['项目代号', '代号', '持证项目', '项目', '焊接方法'],
  '体检日期': ['体检日期', '体检时间', '健康检查日期', '体检有效期'],
  '培训日期': ['培训日期', '培训时间', '培训合格日期', '考核日期'],
  '入厂教育日期': ['入厂教育日期', '入厂安全教育日期', '三级教育日期', '三级安全教育日期', '入厂教育', '安全教育日期', '厂级教育日期'],
  '复审日期': ['复审日期', '上次复审', '上次复审日期', '复审时间'],
  '下次复审': ['下次复审', '下次复审日期', '复审到期', '复审有效期至', '复审截止'],
  // 厂内要求表
  '作业类型': ['作业类型', '作业种类', '作业'],
  '所需证书': ['所需证书', '必备证书', '要求证书', '证书要求'],
  '说明': ['说明', '备注', '要求说明'],
});

/**
 * 作业类型 → 所需证书（与 references/qualification-rules.md 同源）
 * key: 归一后的作业类型；certs: 所需证书标准名；每项 optional 为 true 时不计入 missing，仅提示
 */
const WORK_TYPE_KEYS = [
  ['用火作业', ['用火', '动火', '焊接作业', '切割', '热工作业']],   // 中石化作业许可规范名为"用火作业"，"动火"为口语别名
  ['高处作业', ['高处', '登高', '高空']],
  ['受限空间作业', ['受限空间', '有限空间', '进塔入罐', '进入设备内']],
  ['吊装作业', ['吊装', '起重', '吊车', '行车作业']],
  ['临时用电作业', ['临时用电', '动电', '用电作业', '电气作业']],
  ['压力容器焊接', ['压力容器焊接', '承压焊接', '特种设备焊接', '压力管道焊接']],
];
function normWorkType(v) {
  const s = C.str(v).replace(/\s/g, '');
  if (!s) return null;
  for (const [name, keys] of WORK_TYPE_KEYS) {
    if (s === name) return name;
    if (keys.some((k) => s.includes(k))) return name;
  }
  return null;
}

/** 证书标准类型表：name 为标准名，keys 为可识别写法 */
const CERT_KEYS = [
  ['焊接与热切割作业证', ['焊接与热切割', '焊接和热切割', '熔化焊接与热切割', '焊工证', '电焊工证', '气焊']],
  ['高处作业证', ['高处作业', '登高架设', '高处安装', '维护拆除', '登高']],
  ['低压电工作业证', ['低压电工']],
  ['高压电工作业证', ['高压电工']],
  ['制冷与空调作业证', ['制冷', '空调作业']],
  ['特种设备焊接作业人员证', ['特种设备焊接', '特种设备作业人员证（焊接', '压力容器焊接作业', '承压类特种设备焊接']],
  // TSG Z6001-2019：Q1 = 起重机指挥，Q2 = 起重机司机。顺序须在泛类"特种设备作业人员证"之前，
  // 否则"特种设备作业人员证（Q2）"会被泛类抢走并被判为不满足任何要求（误报缺证）。
  ['起重机司机证', ['起重机司机', '起重机械司机', '起重司机', 'Q2']],
  ['起重指挥证', ['起重指挥', '起重机指挥', '起重机械指挥', '指挥证', '起重信号', 'Q1']],
  ['特种设备作业人员证', ['特种设备作业', '起重机械作业']],
  ['司索工培训记录', ['司索', '挂钩工', '绑扎', '司索工']],
  ['受限空间培训合格证', ['受限空间培训', '有限空间培训', '受限空间作业培训']],
  ['监护人资质证明', ['监护人', '监护资质', '作业监护']],
  // 《中国石化承包商安全管理规定》：承包商人员入厂前须完成入厂安全教育（厂级/车间级/班组级三级教育）。单独归类，不与一般培训合格证混用
  ['入厂安全教育记录', ['入厂安全教育', '入厂教育', '三级安全教育', '三级教育', '厂级安全教育', '厂级教育', '入厂培训', '入厂三级']],
  ['培训合格证', ['培训合格', '安全培训']],
  ['体检合格证明', ['体检', '健康证', '职业健康']],
];
/** 特种作业操作证（应急管理部门发证）类型：按复审周期管理，复审逾期即无效（《特种作业人员安全技术培训考核管理规定》，周期数值以证书与厂内口径为准） */
const SPECIAL_OP_CERTS = new Set(['焊接与热切割作业证', '高处作业证', '低压电工作业证', '高压电工作业证', '制冷与空调作业证']);
function normCert(v) {
  const s = C.str(v).replace(/\s/g, '');
  if (!s) return null;
  for (const [name, keys] of CERT_KEYS) {
    if (s === name) return name;
    if (keys.some((k) => s.includes(k))) return name;
  }
  return null;
}

/**
 * 作业类型所需证书矩阵。
 * anyOf：满足其中任一即可（如高处作业两个方向的准操项目）
 * projectCode：该证书需核对项目代号（如 SMAW-FeII-6G），代号缺失时进 undetermined 而非判合格
 */
const REQUIREMENTS = {
  '用火作业': [
    { cert: '焊接与热切割作业证', note: '用火实施人（焊工/切割工）须持特种作业操作证（焊接与热切割作业）' },
  ],
  '高处作业': [
    // 特种作业"高处作业"只覆盖登高架设、高处安装维护拆除两个准操项目；一般高处检修人员不需持证，
    // 不得把普通检修人员未持高处作业证判为缺证。脚本无法从清单判断作业内容，故列为 advisory：有则核有效期，无则提示。
    { anyOf: ['高处作业证'], advisory: true, note: '仅搭拆脚手架（登高架设）或高处安装、维护、拆除作业人员须持高处作业操作证；一般高处检修人员核培训与体检即可。清单中无此证时请确认作业内容是否属于前两类' },
  ],
  '受限空间作业': [
    { cert: '受限空间培训合格证', note: '进入受限空间人员须有受限空间作业培训合格记录' },
    { cert: '监护人资质证明', note: '每个受限空间作业点须配备经确认的监护人' },
  ],
  '吊装作业': [
    { cert: '起重机司机证', note: '起重机械司机须持特种设备作业人员证（起重机司机）' },
    { cert: '起重指挥证', note: '起重指挥须持特种设备作业人员证（起重机械指挥）' },
    // TSG Z6001-2019 已取消司索工取证项目，只核厂内/承包商培训记录，不作为缺证判定
    { cert: '司索工培训记录', advisory: true, note: '司索（挂钩绑扎）人员无取证项目（TSG Z6001-2019 已取消），核培训记录或厂内确认即可，缺失不判为缺证' },
  ],
  '临时用电作业': [
    { anyOf: ['低压电工作业证', '高压电工作业证'], note: '按作业电压等级确定低压或高压电工作业证，脚本不替用户判断电压等级' },
  ],
  '压力容器焊接': [
    { cert: '特种设备焊接作业人员证', projectCode: true, note: '须持特种设备焊接作业人员证，并核对项目代号（如 SMAW-FeII-6G）覆盖实际焊接位置与材质' },
  ],
};

/** 单位资质标准类型 */
const COMPANY_KEYS = [
  ['营业执照', ['营业执照', '工商执照', '统一社会信用']],
  ['安全生产许可证', ['安全生产许可', '安许', '安全许可证']],
  ['专业承包资质', ['施工总承包', '专业承包', '资质证书', '石油化工工程', '机电工程', '建筑工程']],
  // 《中国石化承包商安全管理规定》：承包商入厂前须与发包单位签订安全协议（安全生产管理协议/HSE 协议）
  ['安全协议', ['安全协议', '安全生产协议', '安全管理协议', '安全生产管理协议', 'HSE协议', 'HSE管理协议']],
  // 只收 ISO 体系与明确的管理体系认证；泛称"认证证书"不再归入 ISO，避免把其他认证误归类
  ['ISO 管理体系认证', ['ISO', '质量管理体系', '环境管理体系', '职业健康安全管理体系', '管理体系认证', 'GB/T19001', 'GB/T24001', 'GB/T45001']],
];
function normCompanyQual(v) {
  const s = C.str(v).replace(/\s/g, '');
  if (!s) return null;
  for (const [name, keys] of COMPANY_KEYS) {
    if (s === name) return name;
    if (keys.some((k) => s.toUpperCase().includes(k.toUpperCase()))) return name;
  }
  return null;
}
/**
 * 单位必备资质（缺失计入 missing）。
 * 《中国石化承包商安全管理规定》按施工类/维保类/技术服务类区分：安全生产许可证只对施工类承包商必备，
 * 维保与技术服务类（如机封厂家服务、检测公司）不要求。--contractor-type 未给时安许作 advisory 提示而非缺证。
 */
const COMPANY_REQUIRED = ['营业执照'];
const COMPANY_BY_TYPE = {
  '施工类': ['安全生产许可证'],
  '维保类': [],
  '技术服务类': [],
};
function normContractorType(v) {
  const s = C.str(v);
  if (!s) return null;
  if (/施工|工程|建筑|安装/.test(s)) return '施工类';
  if (/维保|维修|检修|保养/.test(s)) return '维保类';
  if (/技术服务|检测|服务|咨询|设计/.test(s)) return '技术服务类';
  return null;
}

function loadBook(p) {
  const st = fs.statSync(p);
  return st.isDirectory() ? readCsvDir(p) : readXlsx(p);
}

/**
 * 有效期判定。expiry 为归一后的日期或 null。
 * 返回 {state:'valid'|'expired'|'expiringSoon'|'undetermined', days, reason}
 * **有效期为空或无法解析一律 undetermined，绝不按有效处理。**
 */
function judgeExpiry(expiry, rawExpiry, baseDate, workTo, leadDays) {
  if (!expiry) {
    return { state: 'undetermined', days: null, reason: C.str(rawExpiry) ? `有效期「${C.str(rawExpiry)}」无法解析为日期` : '有效期字段为空' };
  }
  // 以作业结束日为准：证书须覆盖整个作业期
  const daysToEnd = C.diffDays(expiry, workTo);
  const daysToBase = C.diffDays(expiry, baseDate);
  if (daysToBase !== null && daysToBase < 0) return { state: 'expired', days: daysToBase, reason: `已于 ${expiry} 过期，超期 ${-daysToBase} 天` };
  if (daysToEnd !== null && daysToEnd < 0) return { state: 'expired', days: daysToEnd, reason: `有效期至 ${expiry}，早于作业结束日，作业期内将失效` };
  if (daysToBase !== null && daysToBase <= leadDays) return { state: 'expiringSoon', days: daysToBase, reason: `${daysToBase} 天后（${expiry}）到期，已进入 ${leadDays} 天临期提醒范围` };
  return { state: 'valid', days: daysToBase, reason: `有效期至 ${expiry}` };
}

function main() {
  const a = C.parseArgs(process.argv.slice(2), VALUE_OPTS, FLAG_OPTS);
  if (!a.input) throw new Error('缺少 --input');
  if (!a.contractor) throw new Error('缺少 --contractor');
  if (!a['work-type']) throw new Error('缺少 --work-type（作业类型决定需核验哪些证书，不得省略）');
  if (!a.from) throw new Error('缺少 --from');
  if (!a.to) throw new Error('缺少 --to');
  const from = C.normDate(a.from);
  if (!from) throw new Error(`--from 「${a.from}」不是有效日期，应为 YYYY-MM-DD`);
  const to = C.normDate(a.to);
  if (!to) throw new Error(`--to 「${a.to}」不是有效日期，应为 YYYY-MM-DD`);
  if (C.diffDays(to, from) < 0) throw new Error(`--to ${to} 早于 --from ${from}`);

  let leadDays = 30;
  if (a['lead-days'] !== undefined) {
    const n = Number(a['lead-days']);
    if (!Number.isFinite(n) || n < 0) throw new Error(`--lead-days 「${a['lead-days']}」不是有效的非负天数`);
    leadDays = Math.round(n);
  }
  /** 厂内口径参数：入厂安全教育有效天数 / 体检有效天数 / 特种作业证复审周期（年）。未给时不推算，相关项进未判定 */
  const posInt = (key, label) => {
    if (a[key] === undefined) return null;
    const n = Number(a[key]);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`--${key} 「${a[key]}」不是有效的正数（${label}）`);
    return n;
  };
  const eduValidDays = posInt('edu-valid-days', '入厂安全教育有效天数，厂内口径');
  const medicalValidDays = posInt('medical-valid-days', '体检有效天数，厂内口径');
  const reviewYears = posInt('review-years', '特种作业操作证复审周期年数，以证书与厂内口径为准');
  if (!fs.existsSync(a.input)) throw new Error(`输入不存在: ${a.input}`);
  const outDir = a.out || path.join(path.dirname(a.input), '资质核验');

  // ---- 作业类型归一
  const rawTypes = a['work-type'].split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
  if (!rawTypes.length) throw new Error('--work-type 未解析到任何作业类型');
  const workTypes = [], unknownWorkTypes = [];
  for (const t of rawTypes) {
    const n = normWorkType(t);
    if (n) { if (!workTypes.includes(n)) workTypes.push(n); }
    else { unknownWorkTypes.push(t); warnings.push(`作业类型「${t}」不在已知对应表内（见 references/qualification-rules.md），未生成该类型的证书要求，请人工确认应核验哪些证书`); }
  }
  if (!workTypes.length) throw new Error(`--work-type 「${a['work-type']}」中没有一项能匹配已知作业类型（用火作业/高处作业/受限空间作业/吊装作业/临时用电作业/压力容器焊接）`);

  // ---- 读入资质清单
  let book;
  try { book = loadBook(a.input); } catch (e) { throw new Error(`读取失败 ${a.input}: ${e.message}`); }
  const compRows = C.pickSheet(book, '单位资质', '企业资质', '公司资质', '资质证照');
  const persRows = C.pickSheet(book, '人员证书', '作业人员', '人员资质', '证书清单');
  if (!compRows && !persRows) throw new Error('未在输入中找到「单位资质」或「人员证书」工作表');
  if (!compRows) warnings.push('输入中未找到「单位资质」工作表，单位资质一节写「未提供单位资质数据」，不按合格处理');
  if (!persRows) warnings.push('输入中未找到「人员证书」工作表，人员证书一节写「未提供人员证书数据」，不按合格处理');

  const base = C.localDate();

  // ---- 单位资质
  const companyQual = [];
  let contractorCode = '';
  if (compRows) {
    const recs = C.toRecords(compRows, ['资质名称', '有效期至'], '单位资质',
      ['证书编号', '发证机关', '发证日期', '资质等级', '经营/承包范围', '承包商编码'], warnings, ALIASES);
    for (const r of recs) {
      const rawName = C.str(r['资质名称']);
      if (!rawName) { warnings.push(`工作表「单位资质」第${r._row}行 资质名称为空，已跳过`); continue; }
      if (!contractorCode && C.str(r['承包商编码'])) contractorCode = C.str(r['承包商编码']);
      const type = normCompanyQual(rawName);
      if (!type) warnings.push(`工作表「单位资质」第${r._row}行 资质「${rawName}」无法归类为营业执照/安全生产许可证/专业承包资质/安全协议/ISO 认证，已按原文列出并单列，请人工确认是否适用`);
      const rawExp = C.str(r['有效期至']);
      const exp = C.normDate(r['有效期至']);
      if (rawExp && !exp) warnings.push(`工作表「单位资质」第${r._row}行 有效期至「${rawExp}」无法解析为日期，已列为未判定`);
      if (!rawExp) warnings.push(`工作表「单位资质」第${r._row}行 「${rawName}」有效期为空，已列为未判定，未按有效处理`);
      const j = judgeExpiry(exp, rawExp, base, to, leadDays);
      companyQual.push({
        scope: 'company', name: rawName, type, certNo: C.str(r['证书编号']),
        issuer: C.str(r['发证机关']), issueDate: C.normDate(r['发证日期']),
        level: C.str(r['资质等级']), business: C.str(r['经营/承包范围']),
        expiry: exp, rawExpiry: rawExp, state: j.state, days: j.days, reason: j.reason,
        typeRecognized: !!type, sheet: r._sheet, row: r._row,
      });
    }
  }

  // ---- 人员证书
  const personnelQual = [];
  if (persRows) {
    const recs = C.toRecords(persRows, ['姓名', '证书类型', '有效期至'], '人员证书',
      ['身份证号', '岗位', '证书编号', '作业类别', '项目代号', '发证机关', '发证日期', '体检日期', '培训日期', '入厂教育日期', '复审日期', '下次复审'], warnings, ALIASES);
    personnelQual.hasEduCol = recs.hasCol('入厂教育日期');
    personnelQual.hasMedicalCol = recs.hasCol('体检日期');
    for (const r of recs) {
      const person = C.str(r['姓名']);
      if (!person) { warnings.push(`工作表「人员证书」第${r._row}行 姓名为空，已跳过`); continue; }
      const rawType = C.str(r['证书类型']);
      const rawCat = C.str(r['作业类别']);
      // 证书类型优先按「证书类型」列归一，不中时用「作业类别」列补位
      let type = normCert(rawType);
      if (!type && rawCat) type = normCert(rawCat);
      if (!type) warnings.push(`工作表「人员证书」第${r._row}行 ${person} 的证书「${rawType || rawCat || '（空）'}」无法识别为已知证书类型，已单列待确认，不得自行认定可替代所需证书`);
      const rawExp = C.str(r['有效期至']);
      let exp = C.normDate(r['有效期至']);
      const medicalDate = C.normDate(r['体检日期']);
      const trainDate = C.normDate(r['培训日期']);
      const eduDate = C.normDate(r['入厂教育日期']);
      let derived = null;
      // 入厂安全教育 / 体检记录行本身常无"有效期至"，只有日期：按厂内口径参数推算到期日；未给参数则未判定
      if (!exp && !rawExp && type === '入厂安全教育记录' && (eduDate || trainDate)) {
        if (eduValidDays) { exp = C.addDays(eduDate || trainDate, eduValidDays); derived = `按 --edu-valid-days ${eduValidDays} 天自 ${eduDate || trainDate} 推算`; }
      }
      if (!exp && !rawExp && type === '体检合格证明' && medicalDate) {
        if (medicalValidDays) { exp = C.addDays(medicalDate, medicalValidDays); derived = `按 --medical-valid-days ${medicalValidDays} 天自 ${medicalDate} 推算`; }
      }
      if (rawExp && !exp) warnings.push(`工作表「人员证书」第${r._row}行 ${person} 有效期至「${rawExp}」无法解析为日期，已列为未判定`);
      if (!rawExp && !exp) warnings.push(`工作表「人员证书」第${r._row}行 ${person} 的「${rawType || rawCat || '证书'}」有效期为空${(type === '入厂安全教育记录' || type === '体检合格证明') ? '且未提供厂内有效期参数' : ''}，已列为未判定，未按有效处理`);
      const j = judgeExpiry(exp, rawExp, base, to, leadDays);
      if (derived) j.reason = `${j.reason}（${derived}）`;
      // 特种作业操作证复审：下次复审日期已过 → 按已过期处理（复审逾期即无效）；未填下次复审且给了 --review-years 时自复审/发证日期推算
      const reviewDate = C.normDate(r['复审日期']);
      const rawNext = C.str(r['下次复审']);
      let nextReview = C.normDate(r['下次复审']);
      let reviewDerived = false;
      if (rawNext && !nextReview) {
        warnings.push(`工作表「人员证书」第${r._row}行 ${person} 下次复审「${rawNext}」无法解析为日期，复审状态未判定`);
        if (j.state !== 'expired') { j.state = 'undetermined'; j.days = null; j.reason = `下次复审「${rawNext}」无法解析，复审是否逾期无法判定`; }
      }
      const issueDate = C.normDate(r['发证日期']);
      if (!nextReview && !rawNext && reviewYears && SPECIAL_OP_CERTS.has(type) && (reviewDate || issueDate)) {
        nextReview = C.addMonths(reviewDate || issueDate, Math.round(reviewYears * 12));
        reviewDerived = true;
      }
      if (nextReview && j.state !== 'expired') {
        const dBase = C.diffDays(nextReview, base);
        const dEnd = C.diffDays(nextReview, to);
        const src = reviewDerived ? `（按 --review-years ${reviewYears} 年自${reviewDate ? '复审日期' : '发证日期'}推算）` : '';
        if (dBase < 0) { j.state = 'expired'; j.days = dBase; j.reason = `复审逾期：下次复审日期 ${nextReview} 已过 ${-dBase} 天，复审逾期按已过期处理${src}`; }
        else if (dEnd < 0) { j.state = 'expired'; j.days = dEnd; j.reason = `下次复审日期 ${nextReview} 早于作业结束日，作业期内复审到期，按已过期处理${src}`; }
        else if (dBase <= leadDays && j.state === 'valid') { j.state = 'expiringSoon'; j.days = Math.min(j.days ?? dBase, dBase); j.reason = `${dBase} 天后（${nextReview}）须复审，已进入 ${leadDays} 天临期提醒范围${src}`; }
      }
      personnelQual.push({
        scope: 'personnel', person, idNo: C.str(r['身份证号']), post: C.str(r['岗位']),
        rawType, type, typeRecognized: !!type, category: rawCat,
        projectCode: C.str(r['项目代号']), certNo: C.str(r['证书编号']),
        issuer: C.str(r['发证机关']), issueDate,
        medicalDate, trainDate, eduDate,
        reviewDate, nextReview, reviewDerived,
        expiry: exp, rawExpiry: rawExp, derivedExpiry: !!derived, state: j.state, days: j.days, reason: j.reason,
        sheet: r._sheet, row: r._row,
      });
    }
  }

  const all = [...companyQual, ...personnelQual];

  // ---- 分档
  const expired = all.filter((x) => x.state === 'expired');
  const expiringSoon = all.filter((x) => x.state === 'expiringSoon');
  const undetermined = all.filter((x) => x.state === 'undetermined').map((x) => ({
    scope: x.scope, subject: x.scope === 'company' ? x.name : x.person,
    certType: x.scope === 'company' ? x.name : (x.type || x.rawType || '（未填写）'),
    certNo: x.certNo, rawExpiry: x.rawExpiry, missing: '有效期至',
    reason: x.reason, sheet: x.sheet, row: x.row,
  }));

  // ---- 证书类型无法识别 → 单列待确认（不得自行认定可替代）
  const unrecognized = all.filter((x) => !x.typeRecognized).map((x) => ({
    scope: x.scope, subject: x.scope === 'company' ? x.name : x.person,
    rawType: x.scope === 'company' ? x.name : (x.rawType || x.category), certNo: x.certNo,
    reason: '证书/资质类型无法匹配到已知类型表，需用户确认是否适用于本次作业，脚本不认定其可替代任何所需证书',
    sheet: x.sheet, row: x.row,
  }));

  // ---- 作业范围匹配：逐作业类型核对所需证书
  const requirements = [], missing = [], scopeMismatch = [], advisories = [];
  const validStates = new Set(['valid', 'expiringSoon']); // 临期仍在有效期内，但单列提醒
  for (const wt of workTypes) {
    for (const req of REQUIREMENTS[wt]) {
      const wanted = req.anyOf || [req.cert];
      const hits = personnelQual.filter((p) => p.typeRecognized && wanted.includes(p.type));
      const usable = hits.filter((p) => validStates.has(p.state));
      const item = {
        workType: wt, required: wanted.join(' 或 '), note: req.note,
        holders: hits.map((p) => p.person),
        holderCount: hits.length, usableCount: usable.length,
      };
      item.advisory = !!req.advisory;
      if (!hits.length && req.advisory) {
        item.result = 'advisory';
        advisories.push({ workType: wt, required: wanted.join(' 或 '), note: req.note, reason: '清单中未提供该类材料；该项不构成缺证，请按说明确认作业内容' });
      } else if (!hits.length) {
        item.result = 'missing';
        missing.push({ workType: wt, required: wanted.join(' 或 '), note: req.note, reason: '清单中未提供任何该类型证书' });
      } else if (!usable.length && req.advisory) {
        item.result = 'advisory';
        advisories.push({ workType: wt, required: wanted.join(' 或 '), note: req.note, reason: `已提供但持证人均为过期或未判定（${hits.map((p) => `${p.person}（${p.state === 'expired' ? '已过期' : '未判定'}）`).join('、')}）；该项不构成缺证，过期/未判定已在对应章节单列` });
      } else if (!usable.length) {
        item.result = 'allInvalid';
        missing.push({
          workType: wt, required: wanted.join(' 或 '), note: req.note,
          reason: `持证 ${hits.length} 人，但均为过期或未判定状态，无可用持证人`,
          persons: hits.map((p) => `${p.person}（${p.state === 'expired' ? '已过期' : '未判定'}）`).join('、'),
        });
      } else {
        item.result = 'ok';
      }
      // 项目代号核对（压力容器焊接）
      if (req.projectCode) {
        const noCode = usable.filter((p) => !p.projectCode);
        item.projectCodes = usable.map((p) => ({ person: p.person, projectCode: p.projectCode || null }));
        for (const p of noCode) {
          undetermined.push({
            scope: 'personnel', subject: p.person, certType: p.type, certNo: p.certNo,
            rawExpiry: p.rawExpiry, missing: '项目代号',
            reason: `${wt}须核对项目代号（如 SMAW-FeII-6G）是否覆盖实际焊接方法、材质与位置，清单未填写项目代号，无法判定适用范围`,
            sheet: p.sheet, row: p.row,
          });
          warnings.push(`工作表「${p.sheet}」第${p.row}行 ${p.person} 的特种设备焊接作业人员证未填项目代号，${wt}适用范围无法判定，已列为未判定`);
        }
      }
      requirements.push(item);
    }
  }

  // ---- 范围不匹配：持有的已识别证书未对应任何本次作业类型要求
  const neededCerts = new Set();
  for (const wt of workTypes) for (const req of REQUIREMENTS[wt]) for (const c of (req.anyOf || [req.cert])) neededCerts.add(c);
  const GENERIC = new Set(['培训合格证', '体检合格证明', '特种设备作业人员证', '入厂安全教育记录']); // 通用材料，不算范围不符
  for (const p of personnelQual) {
    if (!p.typeRecognized) continue;
    if (neededCerts.has(p.type) || GENERIC.has(p.type)) continue;
    scopeMismatch.push({
      person: p.person, certType: p.type, certNo: p.certNo, expiry: p.expiry, state: p.state,
      reason: `所持「${p.type}」不对应本次作业类型（${workTypes.join('、')}）所需证书，不得用于替代所需证书；如该人员承担其他作业需补充说明`,
      sheet: p.sheet, row: p.row,
    });
  }
  // 单位必备资质缺失
  const contractorType = normContractorType(a['contractor-type']);
  if (a['contractor-type'] && !contractorType) warnings.push(`--contractor-type 「${a['contractor-type']}」无法归类为施工类/维保类/技术服务类，安全生产许可证按提示项处理`);
  const companyRequired = COMPANY_REQUIRED.concat(contractorType ? COMPANY_BY_TYPE[contractorType] : []);
  if (compRows) {
    if (!contractorType) {
      const hit = companyQual.filter((x) => x.type === '安全生产许可证');
      if (!hit.length) advisories.push({ workType: '单位资质', required: '安全生产许可证', note: '施工类承包商必备；维保类/技术服务类不要求', reason: '未提供 --contractor-type，无法判定是否必备；清单中未见安全生产许可证，若为施工类承包商则属缺证' });
    }
    for (const need of companyRequired) {
      const hit = companyQual.filter((x) => x.type === need);
      if (!hit.length) missing.push({ workType: '单位资质', required: need, note: '承包商单位必备证照', reason: '清单中未提供' });
      else if (!hit.some((x) => validStates.has(x.state))) {
        missing.push({ workType: '单位资质', required: need, note: '承包商单位必备证照', reason: `已提供但状态为${hit.map((x) => x.state === 'expired' ? '已过期' : '未判定').join('、')}，不可用` });
      }
    }
  } else {
    missing.push({ workType: '单位资质', required: companyRequired.join('、'), note: '承包商单位必备证照', reason: '未提供单位资质工作表' });
  }

  // ---- 必备材料（《中国石化承包商安全管理规定》：入厂安全教育/三级教育、安全协议；高处与受限空间作业另须体检）
  // 口径：缺失或无法判定有效期 → undetermined（不判合格，也不计缺证），有效期按厂内口径参数推算；已过期按过期处理。
  const mandatory = [];
  const pushUnd = (scope, subject, certType, missingField, reason, sheet, row) => undetermined.push({ scope, subject, certType, certNo: '', rawExpiry: '', missing: missingField, reason, sheet: sheet || '—', row: row || '—' });
  const bestState = (rows) => rows.some((x) => x.state === 'valid') ? 'valid'
    : rows.some((x) => x.state === 'expiringSoon') ? 'expiringSoon'
      : rows.some((x) => x.state === 'undetermined') ? 'undetermined' : 'expired';
  const STATE_WORD = { valid: '有效', expiringSoon: '临期', undetermined: '未判定', expired: '已过期' };
  // 安全协议（单位级）
  {
    const hits = companyQual.filter((x) => x.type === '安全协议');
    const item = { scope: 'company', subject: a.contractor, item: '安全协议', basis: '《中国石化承包商安全管理规定》（有效期按协议约定）' };
    if (!compRows) { item.state = 'undetermined'; item.reason = '未提供单位资质工作表，无法确认是否已签订安全协议，未按已签订处理'; pushUnd('company', a.contractor, '安全协议', '安全协议', item.reason); }
    else if (!hits.length) { item.state = 'undetermined'; item.reason = '清单中未提供安全协议，未按已签订处理，请向安全环保部门/承包商管理部门确认'; pushUnd('company', a.contractor, '安全协议', '安全协议', item.reason, '单位资质'); }
    else { item.state = bestState(hits); item.reason = hits.map((x) => `${x.name}：${STATE_WORD[x.state]}（${x.reason}）`).join('；'); }
    mandatory.push(item);
  }
  // 入厂安全教育（人员级）与 体检（仅高处/受限空间）
  const needMedical = workTypes.filter((w) => w === '高处作业' || w === '受限空间作业');
  for (const person of [...new Set(personnelQual.map((p) => p.person))]) {
    const rowsOf = personnelQual.filter((p) => p.person === person);
    // 入厂安全教育：优先用归类为"入厂安全教育记录"的行；否则看"入厂教育日期"列
    const eduRows = rowsOf.filter((p) => p.type === '入厂安全教育记录');
    const eduDates = rowsOf.map((p) => p.eduDate).filter(Boolean).sort();
    const edu = { scope: 'personnel', subject: person, item: '入厂安全教育（三级教育）', basis: '《中国石化承包商安全管理规定》（有效期按厂内口径 --edu-valid-days）' };
    if (eduRows.length) { edu.state = bestState(eduRows); edu.reason = eduRows.map((x) => `${x.rawType || x.type}：${STATE_WORD[x.state]}（${x.reason}）`).join('；'); }
    else if (eduDates.length) {
      const last = eduDates[eduDates.length - 1];
      if (eduValidDays) {
        const j = judgeExpiry(C.addDays(last, eduValidDays), '', base, to, leadDays);
        edu.state = j.state; edu.reason = `${j.reason}（按 --edu-valid-days ${eduValidDays} 天自 ${last} 推算）`;
        if (j.state === 'expired') expired.push({ scope: 'personnel', person, name: '入厂安全教育', type: '入厂安全教育记录', rawType: '入厂安全教育', certNo: '', expiry: C.addDays(last, eduValidDays), reason: edu.reason, sheet: rowsOf[0].sheet, row: rowsOf[0].row });
        if (j.state === 'expiringSoon') expiringSoon.push({ scope: 'personnel', person, name: '入厂安全教育', type: '入厂安全教育记录', rawType: '入厂安全教育', certNo: '', expiry: C.addDays(last, eduValidDays), days: j.days, reason: edu.reason });
      } else { edu.state = 'undetermined'; edu.reason = `入厂教育日期 ${last} 已填，但未提供厂内有效期参数 --edu-valid-days，是否仍在有效期内无法判定`; }
    } else { edu.state = 'undetermined'; edu.reason = personnelQual.hasEduCol ? '该人员入厂教育日期为空，且无入厂安全教育记录行，未按已完成处理' : '清单未提供入厂安全教育/三级教育记录（无对应证书行，也无"入厂教育日期"列），未按已完成处理'; }
    if (edu.state === 'undetermined' && !eduRows.length) pushUnd('personnel', person, '入厂安全教育（三级教育）', '入厂教育日期', edu.reason, rowsOf[0].sheet, rowsOf[0].row);
    mandatory.push(edu);
    if (needMedical.length) {
      const medRows = rowsOf.filter((p) => p.type === '体检合格证明');
      const medDates = rowsOf.map((p) => p.medicalDate).filter(Boolean).sort();
      const med = { scope: 'personnel', subject: person, item: `体检（${needMedical.join('、')}必备）`, basis: '《中国石化作业许可管理规定》（无职业禁忌；有效期按厂内口径 --medical-valid-days）' };
      if (medRows.length) { med.state = bestState(medRows); med.reason = medRows.map((x) => `${x.rawType || x.type}：${STATE_WORD[x.state]}（${x.reason}）`).join('；'); }
      else if (medDates.length) {
        const last = medDates[medDates.length - 1];
        if (medicalValidDays) {
          const j = judgeExpiry(C.addDays(last, medicalValidDays), '', base, to, leadDays);
          med.state = j.state; med.reason = `${j.reason}（按 --medical-valid-days ${medicalValidDays} 天自 ${last} 推算）`;
          if (j.state === 'expired') expired.push({ scope: 'personnel', person, name: '体检', type: '体检合格证明', rawType: '体检', certNo: '', expiry: C.addDays(last, medicalValidDays), reason: med.reason, sheet: rowsOf[0].sheet, row: rowsOf[0].row });
          if (j.state === 'expiringSoon') expiringSoon.push({ scope: 'personnel', person, name: '体检', type: '体检合格证明', rawType: '体检', certNo: '', expiry: C.addDays(last, medicalValidDays), days: j.days, reason: med.reason });
        } else { med.state = 'undetermined'; med.reason = `体检日期 ${last} 已填，但未提供厂内有效期参数 --medical-valid-days，是否仍在有效期内无法判定`; }
      } else { med.state = 'undetermined'; med.reason = `${needMedical.join('、')}人员必备体检，${personnelQual.hasMedicalCol ? '该人员体检日期为空' : '清单无体检记录'}，未按合格处理`; }
      if (med.state === 'undetermined' && !medRows.length) pushUnd('personnel', person, '体检', '体检日期', med.reason, rowsOf[0].sheet, rowsOf[0].row);
      mandatory.push(med);
    }
  }
  if (!persRows) warnings.push('未提供人员证书工作表，入厂安全教育与体检必备项无法核验');
  const mandatoryUndetermined = mandatory.filter((x) => x.state === 'undetermined').length;
  if (mandatoryUndetermined) warnings.push(`必备材料（入厂安全教育/安全协议/体检）有 ${mandatoryUndetermined} 项未判定，未按合格处理；可用 --edu-valid-days / --medical-valid-days 提供厂内有效期口径`);

  // ---- 厂内准入要求清单（可选）：只做对照提示，不改变判定
  let specExtra = null;
  if (a.spec) {
    if (!fs.existsSync(a.spec)) throw new Error(`厂内准入要求清单不存在: ${a.spec}`);
    const sb = loadBook(a.spec);
    const srows = C.pickSheet(sb, '准入要求', '厂内要求', '要求清单', '准入清单');
    if (!srows) { warnings.push('厂内要求文件中未找到「准入要求」工作表，未做厂内要求对照'); }
    else {
      const sr = C.toRecords(srows, ['作业类型', '所需证书'], '准入要求', ['说明'], warnings, ALIASES);
      specExtra = [];
      for (const r of sr) {
        const wt = normWorkType(r['作业类型']);
        const rawWt = C.str(r['作业类型']);
        if (!rawWt) continue;
        if (wt && !workTypes.includes(wt)) continue;
        if (!wt && !workTypes.some((x) => rawWt.includes(x))) continue;
        const certRaw = C.str(r['所需证书']);
        const cert = normCert(certRaw);
        // 覆盖判定须按该作业类型逐项比对，不能只看证书是否出现在其他作业类型的要求里
        const wtCerts = wt && REQUIREMENTS[wt]
          ? new Set(REQUIREMENTS[wt].flatMap((q) => q.anyOf || [q.cert]))
          : neededCerts;
        const covered = cert ? wtCerts.has(cert) : false;
        const held = cert ? personnelQual.some((p) => p.type === cert && validStates.has(p.state)) : false;
        specExtra.push({ workType: wt || rawWt, requiredRaw: certRaw, cert, coveredByDefaultRules: covered, heldValid: cert ? held : null, note: C.str(r['说明']), sheet: r._sheet, row: r._row });
        if (cert && !covered) warnings.push(`厂内准入要求中「${rawWt}」要求「${certRaw}」，不在脚本默认对应表内，已在厂内要求对照一节列出，请人工核对`);
        if (!cert) warnings.push(`厂内准入要求第${r._row}行 「${certRaw}」无法归类为已知证书类型，未参与自动判定`);
      }
    }
  } else {
    warnings.push('未提供厂内准入要求清单（--spec），仅按 references/qualification-rules.md 默认对应表核验');
  }

  // ---- 历史准入记录（可选）
  let history = null;
  if (a.history) {
    if (!fs.existsSync(a.history)) throw new Error(`历史准入记录不存在: ${a.history}`);
    const hb = loadBook(a.history);
    const hrows = C.pickSheet(hb, '历史准入', '准入记录', '入厂记录');
    if (!hrows) { warnings.push('历史准入记录文件中未找到「历史准入」工作表，不做历史对照'); }
    else {
      const hr = C.toRecords(hrows, ['姓名'], '历史准入', ['证书类型', '有效期至', '说明'], warnings, ALIASES);
      const known = new Set(personnelQual.map((p) => p.person));
      history = hr.map((r) => ({ person: C.str(r['姓名']), certType: C.str(r['证书类型']), expiry: C.normDate(r['有效期至']), note: C.str(r['说明']), inCurrent: known.has(C.str(r['姓名'])), sheet: r._sheet, row: r._row })).filter((x) => x.person);
    }
  } else {
    warnings.push('未提供历史准入记录（--history），不做历史对照');
  }

  // ---- 结论分档（三档，不得表述为准入决定）
  const persons = [...new Set(personnelQual.map((p) => p.person))];
  const counts = {
    companyQual: companyQual.length,
    personnelCerts: personnelQual.length,
    persons: persons.length,
    workTypes: workTypes.length,
    expired: expired.length,
    expiringSoon: expiringSoon.length,
    scopeMismatch: scopeMismatch.length,
    missing: missing.length,
    advisories: advisories.length,
    undetermined: undetermined.length,
    unrecognized: unrecognized.length,
    mandatory: mandatory.length,
    mandatoryUndetermined,
  };

  let conclusion, conclusionBasis;
  if (expired.length || missing.length) {
    conclusion = '不建议准入';
    const rs = [];
    if (expired.length) rs.push(`${expired.length} 项证书已过期或在作业期内失效`);
    if (missing.length) rs.push(`${missing.length} 项作业类型所需证书缺失或无可用持证人`);
    conclusionBasis = rs.join('；') + '，须先补齐并重新核验';
  } else if (undetermined.length || unrecognized.length || scopeMismatch.length || unknownWorkTypes.length) {
    conclusion = '建议补充材料后再审';
    const rs = [];
    if (undetermined.length) rs.push(`${undetermined.length} 项因有效期或项目代号缺失/无法解析而未判定`);
    if (unrecognized.length) rs.push(`${unrecognized.length} 项证书类型无法识别，需确认是否适用`);
    if (scopeMismatch.length) rs.push(`${scopeMismatch.length} 项证书与本次作业类型不对应`);
    if (unknownWorkTypes.length) rs.push(`作业类型「${unknownWorkTypes.join('、')}」无对应证书要求，需人工明确`);
    conclusionBasis = rs.join('；') + '，补齐后可再次核验';
  } else if (expiringSoon.length) {
    conclusion = '建议准入';
    conclusionBasis = `所需证书齐备且在有效期内，其中 ${expiringSoon.length} 项将在 ${leadDays} 天内到期，作业期间需跟踪换证`;
  } else {
    conclusion = '建议准入';
    conclusionBasis = '本次核验范围内的单位资质与人员证书均在有效期内，且覆盖所申报作业类型所需证书';
  }

  // ---- 产出 JSON
  C.ensureDir(outDir);
  const result = {
    meta: {
      contractor: a.contractor, contractorCode: contractorCode || null, contractorType: contractorType || null,
      workTypes, unknownWorkTypes,
      workFrom: from, workTo: to, leadDays, baseDate: base,
      eduValidDays, medicalValidDays, reviewYears,
      generatedAt: C.localDateTime(), input: path.basename(a.input),
      specProvided: !!a.spec, historyProvided: !!a.history,
      companySheetProvided: !!compRows, personnelSheetProvided: !!persRows,
      disclaimer: DISCLAIMER,
    },
    counts, conclusion, conclusionBasis,
    companyQual, personnelQual, requirements, mandatory,
    expired, expiringSoon, scopeMismatch, missing, advisories, undetermined, unrecognized,
    specExtra, history, warnings,
  };
  fs.writeFileSync(path.join(outDir, 'qualify.json'), JSON.stringify(result, null, 2), 'utf8');

  // ---- 产出 md
  const STATE_CN = { valid: '有效', expired: '已过期', expiringSoon: '临期', undetermined: '未判定' };
  const L = [];
  L.push(`# ${a.contractor} 承包商资质核验（${base}）`);
  L.push('');
  L.push(`作业类型：${workTypes.join('、')}${unknownWorkTypes.length ? `（另有未识别类型：${unknownWorkTypes.join('、')}）` : ''}`);
  L.push(`作业期间：${from} 至 ${to} ｜ 临期提醒：${leadDays} 天 ｜ 承包商类别：${contractorType || '未提供（安全生产许可证按提示项处理）'}${contractorCode ? ` ｜ 承包商编码：${contractorCode}` : ''}`);
  L.push(`厂内口径参数：入厂教育有效期 ${eduValidDays ? eduValidDays + ' 天' : '未提供'} ｜ 体检有效期 ${medicalValidDays ? medicalValidDays + ' 天' : '未提供'} ｜ 特种作业证复审周期 ${reviewYears ? reviewYears + ' 年' : '未提供（只认"下次复审"列）'}`);
  L.push(`资料来源：${path.basename(a.input)}`);
  L.push(`生成时间：${C.localDateTime()}（北京时间）`);
  L.push('');
  L.push('## 一、核验概览');
  L.push('');
  L.push(C.mdTable(['指标', '数量'], [
    ['单位资质条目', counts.companyQual], ['人员证书条目', counts.personnelCerts], ['涉及人员', counts.persons],
    ['已过期', counts.expired], [`临期（${leadDays}天内）`, counts.expiringSoon],
    ['作业范围不符', counts.scopeMismatch], ['应有未提供', counts.missing],
    ['未判定', counts.undetermined], ['类型待确认', counts.unrecognized],
    ['必备材料未判定（入厂教育/安全协议/体检）', counts.mandatoryUndetermined],
  ]));
  L.push('## 二、单位资质核验');
  L.push('');
  if (!compRows) L.push('_未提供单位资质数据（输入中无「单位资质」工作表），本节不出结论，不按合格处理。_\n');
  else L.push(C.mdTable(['资质名称', '归类', '证书编号', '资质等级', '发证机关', '有效期至', '状态', '说明'],
    companyQual.map((x) => [x.name, x.type || '未归类', x.certNo || '—', x.level || '—', x.issuer || '—', x.expiry || (x.rawExpiry || '（空）'), STATE_CN[x.state], x.reason])));
  L.push('## 三、人员证书核验');
  L.push('');
  if (!persRows) L.push('_未提供人员证书数据（输入中无「人员证书」工作表），本节不出结论，不按合格处理。_\n');
  else L.push(C.mdTable(['姓名', '岗位', '证书类型', '归类', '证书编号', '项目代号', '有效期至', '下次复审', '状态', '说明'],
    personnelQual.map((x) => [x.person, x.post || '—', x.rawType || '—', x.type || '未归类', x.certNo || '—', x.projectCode || '—', x.expiry || (x.rawExpiry || '（空）'), x.nextReview ? x.nextReview + (x.reviewDerived ? '（推算）' : '') : '—', STATE_CN[x.state], x.reason])));
  L.push('## 四、作业类型证书要求与必备材料对照');
  L.push('');
  L.push('### 4.1 作业类型证书要求');
  L.push('');
  L.push(C.mdTable(['作业类型', '所需证书', '持证人', '可用人数', '核对结果', '依据说明'],
    requirements.map((x) => [x.workType, x.required, x.holders.length ? x.holders.join('、') : '—', x.usableCount,
      x.result === 'ok' ? '齐备' : x.result === 'missing' ? '未提供' : x.result === 'advisory' ? '提示项（不构成缺证）' : '持证人均不可用', x.note])));
  L.push('### 4.2 必备材料（入厂安全教育 / 安全协议 / 体检）');
  L.push('');
  L.push('> 依据《中国石化承包商安全管理规定》：承包商入厂前须签订安全协议、人员须完成入厂三级安全教育；高处与受限空间作业人员另须体检。有效期按厂内口径（`--edu-valid-days` / `--medical-valid-days`）推算，**缺失或无法判定一律未判定、不按合格处理**。');
  L.push('');
  L.push(C.mdTable(['对象', '必备材料', '状态', '说明', '依据'],
    mandatory.map((x) => [x.scope === 'company' ? '单位' : x.subject, x.item, STATE_CN[x.state], x.reason, x.basis])));
  L.push('## 五、不符合项清单');
  L.push('');
  L.push('### 5.1 已过期');
  L.push('');
  L.push(C.mdTable(['对象', '证书/资质', '证书编号', '有效期至', '说明'],
    expired.map((x) => [x.scope === 'company' ? '单位' : x.person, x.scope === 'company' ? x.name : (x.type || x.rawType), x.certNo || '—', x.expiry || '—', x.reason])));
  L.push(`### 5.2 临期（${leadDays} 天内到期）`);
  L.push('');
  L.push(C.mdTable(['对象', '证书/资质', '证书编号', '有效期至', '剩余天数'],
    expiringSoon.map((x) => [x.scope === 'company' ? '单位' : x.person, x.scope === 'company' ? x.name : (x.type || x.rawType), x.certNo || '—', x.expiry || '—', x.days])));
  L.push('### 5.3 作业范围不符');
  L.push('');
  L.push(C.mdTable(['姓名', '所持证书', '证书编号', '有效期至', '说明'],
    scopeMismatch.map((x) => [x.person, x.certType, x.certNo || '—', x.expiry || '—', x.reason])));
  L.push('### 5.4 应有未提供');
  L.push('');
  L.push(C.mdTable(['作业类型', '所需证书', '缺失原因', '依据说明'],
    missing.map((x) => [x.workType, x.required, x.reason + (x.persons ? `（${x.persons}）` : ''), x.note])));
  L.push('### 5.5 提示项（不构成缺证）');
  L.push('');
  L.push('> 以下材料按《中国石化承包商安全管理规定》与 TSG Z6001-2019 不属于必备证书（司索工无取证项目、一般高处检修不需高处作业证、维保/技术服务类承包商不要求安全生产许可证），**不计入不符合项**，但请按说明确认作业内容或承包商类别。');
  L.push('');
  L.push(C.mdTable(['对象', '材料', '原因', '依据说明'],
    advisories.map((x) => [x.workType, x.required, x.reason, x.note])));
  L.push('## 六、未判定项');
  L.push('');
  L.push('> 以下各项因判定所依赖的字段缺失或无法解析而无法判定，**一律未按有效处理**，须补齐材料后重新核验。');
  L.push('');
  L.push(C.mdTable(['对象', '证书/资质', '证书编号', '缺失字段', '原始取值', '原因', '出处'],
    undetermined.map((x) => [x.scope === 'company' ? '单位' : x.subject, x.certType, x.certNo || '—', x.missing, x.rawExpiry || '（空）', x.reason, `${x.sheet} 第${x.row}行`])));
  L.push('## 七、类型待确认项');
  L.push('');
  L.push('> 以下证书/资质无法匹配到已知类型表，**脚本不认定其可替代任何所需证书**，请核验人确认是否适用于本次作业。');
  L.push('');
  L.push(C.mdTable(['对象', '原始名称', '证书编号', '出处'],
    unrecognized.map((x) => [x.scope === 'company' ? '单位' : x.subject, x.rawType || '（空）', x.certNo || '—', `${x.sheet} 第${x.row}行`])));
  if (specExtra) {
    L.push('## 附一、厂内准入要求对照');
    L.push('');
    L.push(C.mdTable(['作业类型', '厂内要求证书', '归类', '默认规则已覆盖', '现有有效持证', '说明'],
      specExtra.map((x) => [x.workType, x.requiredRaw, x.cert || '未归类', x.coveredByDefaultRules ? '是' : '否', x.heldValid === null ? '—' : (x.heldValid ? '有' : '无'), x.note || '—'])));
  }
  if (history) {
    L.push('## 附二、历史准入记录对照');
    L.push('');
    L.push(C.mdTable(['姓名', '证书类型', '历史有效期至', '本次是否在册', '说明'],
      history.map((x) => [x.person, x.certType || '—', x.expiry || '—', x.inCurrent ? '是' : '否', x.note || '—'])));
  }
  L.push('## 八、核验结论');
  L.push('');
  L.push(`**${conclusion}** —— ${conclusionBasis}`);
  L.push('');
  L.push('结论仅分三档：建议准入 / 建议补充材料后再审 / 不建议准入。本结论为核验意见，不是准入决定。');
  L.push('');
  L.push('<!-- ANALYSIS_START -->');
  L.push('（由模型依据 references/qualification-rules.md 口径撰写 200~400 字，结构：核验范围 → 不符合项与影响 → 未判定与材料缺口 → 建议补充与跟进事项。数量一律引用 qualify.json 的 counts，结论不得超出三档表述。）');
  L.push('<!-- ANALYSIS_END -->');
  L.push('');
  L.push('## 九、声明');
  L.push('');
  L.push(DISCLAIMER + '。');
  L.push('');
  L.push('本次核验仅依据所提供清单的书面记载判断有效期与作业范围匹配性，**不核实证书真伪**；证书真伪、有效状态须通过发证机关或政府主管部门查询渠道逐项核实后方可作为准入依据。');
  L.push('');
  if (warnings.length) {
    L.push('## 附：数据提示');
    L.push('');
    for (const w of warnings) L.push(`- ${w}`);
    L.push('');
  }
  fs.writeFileSync(path.join(outDir, 'qualify.md'), L.join('\n'), 'utf8');

  C.emitOk(outDir, {
    ok: true, out: outDir, contractor: a.contractor, contractorCode: contractorCode || null, contractorType: contractorType || null, workTypes,
    workFrom: from, workTo: to, leadDays, eduValidDays, medicalValidDays, reviewYears, counts, conclusion, warnings,
  });
}

try { main(); } catch (e) { C.fail(e, warnings); }
