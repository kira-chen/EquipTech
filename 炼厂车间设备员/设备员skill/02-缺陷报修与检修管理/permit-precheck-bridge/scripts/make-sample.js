#!/usr/bin/env node
'use strict';
/**
 * 生成本技能的演示与回归样例（可再生，仅 Node.js 内置模块）。
 * 用法：node scripts/make-sample.js [--out <dir>] [--seed <n>] [--demo <dir>]
 *   --out   输出目录；不传时写到演示样例目录（仓库内 炼厂车间设备员/演示case/<分类>/<技能>/，开发包内技能目录 examples/）
 *   --seed  非负整数，默认 1；只改变合并报告样例的票号尾号、时间与人名，以及 --demo 变体票面的数值，不改变任何预期计数
 *   --demo  另生成 9 份变体 Word 作业票（演示用，只有 docx）到该目录；写文件前先跑规则引擎，四项计数与基线不一致则报错、不写任何变体
 *
 * 产出（均为虚构数据）：
 *   一、合并报告样例（merge-report.js 的输入）
 *     sample-permit-result.json                  规则引擎结果：恒 3 必须整改 / 2 建议完善 / 1 未判定 / 4 通过，type=动火（规则引擎取值）
 *     sample-permit-result-summary-mismatch.json summary 与 findings 计数故意不一致（should_improve 写 5）→ 只 warning 不改原数据
 *     sample-permit-result-unknown-type.json     type 写「射线探伤」（不在八大类）→ warning，type 原值照搬
 *     sample-workshop-notes.json                 车间侧提示：已核实 / 未核实 / 不适用 各 1 项
 *     sample-workshop-notes-bad.json             车间侧提示状态写「大概没问题」+ 一条自定义项 → 按未核实处理并 warning
 *     sample-hotwork-permit.docx                 一级用火票 Word 样例（由 hotwork-level1-with-issues.json 生成，票面与该案例相同）
 *   二、规则引擎回归样例（9 个案例，每个 4 个文件；以 <案例>.json 为基准，不随 seed 变化）
 *     <案例>.json                抽取结果 permit.json（基准数据，手工维护；--out 指向别处时从演示样例目录复制）
 *     <案例>.docx                由 json 生成的 Word 作业票（问题项表现为空白栏）
 *     <案例>.docx2text.txt       docx2text.js 读回结果
 *     <案例>.expected-report.md  precheck.js 对 json 的报告（--now 2026-08-28T08:50:00+08:00）
 *   内容未变的文件不重写（docx 按读回文本比较，期望报告忽略「生成时间」行），避免无意义的改动。
 * 成功末行 {"ok":true,...}；失败末行 {"ok":false,"error":...} 并退出码 1。
 */
const fs = require('fs');
const path = require('path');
const C = require('./lib/common');
const L = require('./lib/docx-lite');

/** 回归基准时间：9 个案例的期望计数与期望报告都按这个时间生成 */
const REGRESS_NOW = '2026-08-28T08:50:00+08:00';
/** 9 个案例的基线四项计数（必须整改 / 建议完善 / 未判定 / 通过），与演示样例目录 README 对照表一致；--demo 变体不得漂移 */
const EXPECTED = {
  'hotwork-level1-with-issues': [3, 2, 1, 39],
  'confined-space-ok': [0, 0, 0, 44],
  'high-place-level2-issues': [6, 2, 0, 26],
  'confined-space-t201': [0, 0, 0, 45],
  'hotwork-t201-inside': [2, 1, 0, 42],
  'hotwork-level2-night': [2, 1, 0, 39],
  'confined-space-n2-tank': [1, 0, 0, 43],
  'lifting-45t': [2, 0, 0, 35],
  'blind-plate-3': [2, 1, 0, 30],
};
const CASE_ORDER = Object.keys(EXPECTED);

/** 演示样例目录：仓库内在 炼厂车间设备员/演示case/<分类>/<技能>/，开发包内在技能目录 examples/ */
function caseDir() {
  const skillsRoot = path.resolve(__dirname, '../../..');
  return path.basename(skillsRoot) === '设备员skill'
    ? path.join(skillsRoot, '..', '演示case', path.relative(skillsRoot, path.resolve(__dirname, '..')))
    : path.join(__dirname, '..', 'examples');
}

/* ======================= 一、Word 作业票生成（版式贴近中石化特殊作业证） ======================= */
const s = v => (v === null || v === undefined) ? '' : String(v);
function fmtDT(iso) { // 2026-08-28T09:00:00+08:00 → 2026年8月28日 09:00
  if (!iso) return '';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  return m ? `${m[1]}年${+m[2]}月${+m[3]}日 ${m[4]}:${m[5]}` : iso;
}
function fmtT(iso) { const m = (iso || '').match(/T(\d{2}:\d{2})/); return m ? m[1] : ''; }
function fmtD(iso) { const m = (iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[1]}年${+m[2]}月${+m[3]}日` : ''; }
const yn = v => v === true ? '是' : v === false ? '否' : null;

/** 三种勾选框写法（用于验证 docx2text 的识别）：sdt=w14:checkbox 内容控件；char=☑/☐ 字符；sym=Wingdings 符号 */
const BOX = {
  sdt: (c) => ({ raw: L.checkboxSdtXml(c) }),
  char: (c) => ({ text: c ? '☑' : '☐', font: 'MS Gothic' }),
  sym: (c) => ({ raw: L.symRunXml(c) }),
};
/** 单选组：☑一级 ☐二级 ☐特级；value 为 null 时全部空框 */
function choice(style, options, value) {
  const runs = [];
  options.forEach((o, i) => { runs.push(BOX[style](value === o)); runs.push({ text: o + (i < options.length - 1 ? '   ' : '') }); });
  return runs;
}
const H = (t) => ({ text: t, bold: true, shade: 'F2F2F2', align: 'center' });
/** 介质性质多选：[x]易燃 [ ]有毒（null 时空框） */
function mediumProps(style, m) { m = m || {}; return [BOX[style](m.flammable === true), { text: '易燃   ' }, BOX[style](m.toxic === true), { text: '有毒' }]; }

/* 措施文字（与 references/permit-schema.md 的 measures 键对应；票面文字按 GB 30871 作业证版式） */
const MEASURE_LABEL = {
  risk_identified: '已进行作业风险辨识，制定控制措施', briefing_done: '已对作业人员进行安全教育与技术交底', emergency_plan: '已制定应急措施，应急通道畅通', warning_zone: '作业区域已设置警戒区和安全警示标志', ppe_confirmed: '作业人员个体防护用品已配备并确认',
  isolation_done: '作业设备/管线已与生产系统可靠隔离', isolation_by_blind: '隔离方式：加盲板（见盲板图）', purge_clean: '设备/管线已清洗、置换、吹扫合格', fire_equipment: '现场配备足够的消防器材（灭火器、消防水带）', drains_sealed: '动火点周围排水井、地漏、地沟已封堵', combustibles_cleared: '动火点周围可燃物已清理', retest_after_interrupt: '作业中断超 30min 复检合格后方可继续', cylinder_distance_ok: '乙炔瓶与氧气瓶间距≥5m，二者距火点≥10m', video_monitoring: '特级动火全程视频监控',
  ten_no_lift_checked: '已执行“十不吊”确认', access_ladder: '深度≥1.5m 设置上下通道/爬梯',
  ventilation: '受限空间已进行通风（自然/强制）', rescue_equipment: '现场配备应急救援器材（呼吸器、安全绳、担架）', entry_register: '进出受限空间人员登记', continuous_monitoring: '作业期间连续/定时监测并记录', energy_locked: '转动设备已停电、上锁、挂牌', guardian_outside: '监护人在受限空间外全程监护',
  night_warning_light: '夜间作业照明充足，设置警示灯/红灯',
  equipment_inspected: '起重机械、吊索具已检查确认完好', ground_bearing: '吊车站位地基承载力已确认（垫板/支腿全伸）', overhead_lines_cleared: '吊臂回转范围内架空线路/管廊安全距离已确认',
  pressure_relieved: '系统已停工、泄压、排净并确认无压', blind_plate_spec_ok: '盲板材质、厚度、压力等级与介质、压力相符', nonsparking_tools: '易燃易爆介质抽堵使用防爆工具',
  safety_belt: '作业人员系挂全身式安全带，高挂低用', fall_protection: '临边、洞口设置防护栏/安全网等防坠落措施', scaffold_checked: '脚手架已验收挂牌', tools_secured: '工具、材料防坠落措施（工具袋、系绳）', health_checked: '作业人员身体状况符合高处作业要求',
};
const MEASURES_BY_TYPE = {
  '动火': ['risk_identified', 'briefing_done', 'emergency_plan', 'warning_zone', 'ppe_confirmed', 'isolation_done', 'isolation_by_blind', 'purge_clean', 'fire_equipment', 'drains_sealed', 'combustibles_cleared', 'cylinder_distance_ok'],
  '受限空间': ['risk_identified', 'briefing_done', 'emergency_plan', 'warning_zone', 'ppe_confirmed', 'isolation_done', 'isolation_by_blind', 'ventilation', 'rescue_equipment', 'entry_register', 'continuous_monitoring', 'energy_locked', 'guardian_outside'],
  '高处': ['risk_identified', 'briefing_done', 'emergency_plan', 'warning_zone', 'ppe_confirmed', 'safety_belt', 'fall_protection', 'tools_secured'],
  '吊装': ['risk_identified', 'briefing_done', 'emergency_plan', 'warning_zone', 'ppe_confirmed', 'equipment_inspected', 'ground_bearing', 'overhead_lines_cleared', 'ten_no_lift_checked'],
  '盲板抽堵': ['risk_identified', 'briefing_done', 'emergency_plan', 'warning_zone', 'ppe_confirmed', 'pressure_relieved', 'blind_plate_spec_ok', 'nonsparking_tools'],
};
/** 措施表中"票面有此栏、JSON 中该键存在"才显示的可选行（如用火票的夜间照明行） */
const OPTIONAL_MEASURES = { '动火': ['night_warning_light'] };
/** 票面标题按 GB 30871 作业证版式（type 枚举「动火」即中石化「用火作业」） */
const TITLE = { '动火': '动火安全作业证', '受限空间': '受限空间安全作业证', '高处': '高处安全作业证', '吊装': '吊装安全作业证', '盲板抽堵': '盲板抽堵安全作业证' };
/** 吊装人员角色 → 票面栏目（按 role 关键词匹配） */
const LIFT_ROLES = [['指挥', '吊装指挥'], ['司索', '司索人员'], ['司机', '起重机司机']];

/* 各案例的票面补充信息（JSON 中没有、票面通常有的栏目） */
const EXTRA = {
  'hotwork-level1-with-issues': { content: '转油线膨胀节内部焊补（电焊、角磨机打磨）', method: '电焊 / 角磨', approveTime: { '属地车间主任': '2026年8月28日 08:20', '安全环保部': '2026年8月28日 08:35' }, boxStyle: 'sdt' },
  'confined-space-ok': { content: '分馏塔 T-201 塔底人孔进入清理结焦、更换塔盘固定件', approveTime: { '属地车间主任': '2026年8月28日 07:55', '安全环保部': '2026年8月28日 08:15' }, boxStyle: 'char' },
  'high-place-level2-issues': { content: 'TK-305 罐顶呼吸阀更换（搭设临时操作平台）', approveTime: { '储运部主任': '2026年8月28日 07:40' }, boxStyle: 'sym' },
  'confined-space-t201': { content: '进入分馏塔 T-201 塔内，对第 12 层塔盘降液板裂纹进行焊补（动火另办 DH-2026-0828-021）', approveTime: { '属地车间主任': '2026年8月28日 08:05', '安全环保部': '2026年8月28日 08:20' }, boxStyle: 'char' },
  'hotwork-t201-inside': { content: 'T-201 塔内第 12 层塔盘降液板裂纹电焊焊补', method: '电焊', approveTime: { '属地车间主任': '2026年8月28日 08:25', '安全环保部': '2026年8月28日 08:40' }, boxStyle: 'sdt' },
  'hotwork-level2-night': { content: '循环水管线 P-302 出口法兰垫片泄漏，更换法兰并补焊（夜班）', method: '电焊 / 角磨', approveTime: { '属地车间主任': '2026年8月28日 20:30' }, boxStyle: 'sym' },
  'confined-space-n2-tank': { content: '柴油储罐 TK-208 清空、氮气置换后进入，进行底板测厚与清淤', approveTime: { '储运部主任': '2026年8月28日 07:30', '安全环保部': '2026年8月28日 07:45' }, boxStyle: 'sdt' },
  'lifting-45t': { content: '换热器 E-305 管束（约 45 t）整体吊出、更换新管束后吊装回位', load: 'E-305 管束', crane: 'QY-80 汽车起重机（80 t）', rigging: '钢丝绳 4 根 + 专用吊梁', approveTime: { '属地车间主任': '2026年8月28日 07:50', '安全环保部': '2026年8月28日 08:10' }, boxStyle: 'char' },
  'blind-plate-3': { content: '初馏塔 T-101 停工检修，塔顶回流线、塔底抽出线、初侧线加盲板隔离', approveTime: { '属地车间主任': '2026年8月28日 08:00', '安全环保部': '2026年8月28日 08:15' }, boxStyle: 'sym' },
};
const DOCX_CREATOR = 'permit-precheck-bridge 样例生成器';

/** 由 permit.json 生成 Word 作业票；JSON 中为 null 的字段在 Word 里表现为空白栏 */
function build(caseName, P, extra) {
  const X = extra || EXTRA[caseName] || {};
  const bs = X.boxStyle || 'char';
  const box = (v) => BOX[bs](v === true);
  const body = [];
  const W = [1400, 2600, 1400, 2600, 1800]; // 5 列网格

  body.push(L.pXml(X.company || '中国石化 ×× 分公司', { align: 'center', size: 11 }));
  body.push(L.pXml(TITLE[P.type] || '特殊作业安全作业证', { align: 'center', bold: true, size: 18 }));
  body.push(L.pXml([{ text: '编号：' + s(P.permit_no) }, { text: '        执行标准：GB 30871-2022' }], { align: 'right', size: 10 }));

  // 表 1：基本信息
  const parts = String(P.unit || '').split(' / ');
  const wk = (P.weather || {});
  const rows1 = [
    [H('申请单位'), s(parts[0]), H('作业单位'), s(parts[1]), { content: [[{ text: '申请人：' + s(P.applicant) }]], vMerge: 'restart' }],
    [H('作业地点'), { text: s(P.location), span: 3 }, { vMerge: 'continue', text: '' }],
    [H('作业内容'), { text: s(X.content), span: 3 }, { vMerge: 'continue', text: '' }],
  ];
  if (P.type === '动火') {
    rows1.push([H('动火方式'), s(X.method), H('动火级别'), { content: choice(bs, ['特级', '一级', '二级'], P.level), span: 2 }]);
    rows1.push([H('设备/管线介质'), s(P.medium && P.medium.name), H('介质爆炸下限'), { text: P.medium && P.medium.lel_pct != null ? `${P.medium.lel_pct}%（体积）` : '', span: 2 }]);
    rows1.push([H('介质性质'), { content: mediumProps(bs, P.medium), span: 4 }]);
    rows1.push([H('是否受限空间内动火'), { content: choice(bs, ['是', '否'], yn(P.in_confined_space)) }, H('是否露天作业'), { content: choice(bs, ['是', '否'], yn(P.outdoor)), span: 2 }]);
    rows1.push([H('动火点高度'), P.height_m != null ? `${P.height_m} m` : '', H('夜间/节假日作业'), { content: choice(bs, ['是', '否'], yn(P.night_or_holiday)), span: 2 }]);
  } else if (P.type === '受限空间') {
    rows1.push([H('受限空间名称'), s(P.location.split(' ').slice(-2).join(' ')), H('空间内介质'), { text: s(P.medium && P.medium.name), span: 2 }]);
    rows1.push([H('介质爆炸下限'), P.medium && P.medium.lel_pct != null ? `${P.medium.lel_pct}%（体积）` : '', H('介质有毒'), { content: choice(bs, ['是', '否'], yn(P.medium && P.medium.toxic)), span: 2 }]);
    rows1.push([H('是否含动火作业'), { content: choice(bs, ['是', '否'], yn(P.hot_work_inside)) }, H('照明电压'), { text: P.lighting_voltage != null ? `${P.lighting_voltage} V` : '', span: 2 }]);
    rows1.push([H('潮湿/狭小金属容器'), { content: choice(bs, ['是', '否'], yn(P.wet_or_metal_container)) }, H('夜间/节假日作业'), { content: choice(bs, ['是', '否'], yn(P.night_or_holiday)), span: 2 }]);
  } else if (P.type === '高处') {
    rows1.push([H('作业高度'), P.height_m != null ? `${P.height_m} m` : '', H('作业级别'), { content: choice(bs, ['一级', '二级', '三级', '特级'], P.level), span: 2 }]);
    rows1.push([H('周边介质'), s(P.medium && P.medium.name), H('是否含动火作业'), { content: choice(bs, ['是', '否'], yn(P.hot_work_inside)), span: 2 }]);
    rows1.push([H('介质性质'), { content: mediumProps(bs, P.medium), span: 4 }]);
    rows1.push([H('是否露天作业'), { content: choice(bs, ['是', '否'], yn(P.outdoor)) }, H('夜间/节假日作业'), { content: choice(bs, ['是', '否'], yn(P.night_or_holiday)), span: 2 }]);
  } else if (P.type === '吊装') {
    rows1.push([H('吊物名称/重量'), P.load_mass_t != null ? `${s(X.load || '吊物')} ${P.load_mass_t} t` : s(X.load), H('吊装级别'), { content: choice(bs, ['一级', '二级', '三级'], P.level), span: 2 }]);
    rows1.push([H('吊车型号/吨位'), s(X.crane), H('吊索具'), { text: s(X.rigging), span: 2 }]);
    rows1.push([H('设备内介质'), s(P.medium && P.medium.name), H('介质性质'), { content: mediumProps(bs, P.medium), span: 2 }]);
    rows1.push([H('是否露天作业'), { content: choice(bs, ['是', '否'], yn(P.outdoor)) }, H('夜间/节假日作业'), { content: choice(bs, ['是', '否'], yn(P.night_or_holiday)), span: 2 }]);
  } else if (P.type === '盲板抽堵') {
    rows1.push([H('管线/设备介质'), s(P.medium && P.medium.name), H('介质爆炸下限'), { text: P.medium && P.medium.lel_pct != null ? `${P.medium.lel_pct}%（体积）` : '', span: 2 }]);
    rows1.push([H('介质性质'), { content: mediumProps(bs, P.medium), span: 4 }]);
    rows1.push([H('盲板数量'), String((P.blind_plates || []).length || ''), H('夜间/节假日作业'), { content: choice(bs, ['是', '否'], yn(P.night_or_holiday)), span: 2 }]);
  }
  rows1.push([H('作业时间'), { text: `自 ${fmtDT(P.start_time)} 起  至 ${fmtDT(P.end_time)} 止`, span: 4 }]);
  rows1.push([H('天气与特殊情形'), { text: [wk.wind_level != null ? `风力 ${wk.wind_level} 级` : '', wk.thunderstorm === true ? '雷雨' : wk.thunderstorm === false ? '无雷雨' : '', wk.rain === true ? '降雨' : ''].filter(Boolean).join('，') + (P.notes ? `；${P.notes}` : ''), span: 4 }]);
  body.push(L.pXml('一、基本信息', { bold: true }));
  body.push(L.tblXml(rows1, { widths: W, size: 10 }));

  // 表 2：作业人员
  const rows2 = [[H('序号'), H('姓名'), H('工种/角色'), H('特种作业证/资质证书编号'), H('安全交底签字')]];
  (P.workers || []).forEach((w, i) => rows2.push([String(i + 1), s(w.name), s(w.role), s(w.cert), w.briefing_signed === true ? s(w.name) : '']));
  rows2.push([String((P.workers || []).length + 1), '', '', '', '']);
  body.push(L.pXml('二、作业人员及资质', { bold: true }));
  body.push(L.tblXml(rows2, { widths: [800, 1600, 1800, 3600, 2000], size: 10 }));

  // 表 3：监护人（吊装票同表列出指挥/司索/司机）
  const sec = (() => { let i = 2; return (t) => `${['一', '二', '三', '四', '五', '六', '七', '八'][i++]}、${t}`; })();
  body.push(L.pXml(sec('监护人' + (P.type === '吊装' ? '及吊装关键岗位' : '')), { bold: true }));
  const rows3 = [[H('监护人（签字）'), s(P.guardian), H('监护人证书编号'), { text: s(P.guardian_cert), span: 2 }]];
  if (P.type === '吊装') {
    LIFT_ROLES.forEach(([kw, label]) => {
      const w = (P.workers || []).find(x => x && String(x.role || '').includes(kw));
      rows3.push([H(label), w ? `${s(w.role)} ${s(w.name)}`.trim() : '', H(label + '证书编号'), { text: w ? s(w.cert) : '', span: 2 }]);
    });
  }
  body.push(L.tblXml(rows3, { widths: W, size: 10 }));

  // 表 4：盲板清单（仅盲板抽堵票）
  if (P.type === '盲板抽堵') {
    const rows = [[H('盲板编号'), H('安装位置（管线/设备/法兰）'), H('材质'), H('厚度'), H('压力等级'), H('抽/堵及顺序'), H('挂牌')]];
    const bp = P.blind_plates || [];
    const specOf = (b) => { const sp = b.spec; if (!sp) return ['', '', '']; if (typeof sp === 'string') return [sp, '', '']; return [s(sp.material), s(sp.thickness), s(sp.pressure_class || sp.rating)]; };
    bp.forEach(b => { const [mat, thk, pn] = specOf(b || {}); rows.push([s(b.no), s(b.location), mat, thk, pn, s(b.action), b.no ? '已挂' : '']); });
    for (let k = rows.length; k < 4; k++) rows.push(['', '', '', '', '', '', '']);
    body.push(L.pXml(sec('盲板清单'), { bold: true }));
    body.push(L.tblXml(rows, { widths: [1200, 3400, 900, 800, 1000, 1300, 1200], size: 9 }));
  }

  // 表 5：气体分析（用火/受限空间/高处票固定有此表；吊装、盲板抽堵等仅在有记录时显示）
  if (['动火', '受限空间', '高处'].includes(P.type) || (P.gas_tests || []).length) {
    const GW = [1500, 1900, 800, 1100, 1000, 1700, 1000, 800];
    const rows4 = [[H('分析时间'), H('分析部位'), H('O₂ %'), H('可燃气 %LEL'), H('可燃气 %(V)'), H('有毒气体 mg/m³'), H('分析人'), H('仪器校验有效')]];
    (P.gas_tests || []).forEach(g => rows4.push([fmtD(g.time) + ' ' + fmtT(g.time), s(g.location), s(g.o2), s(g.lel), s(g.combustible_vol), (g.toxic || []).length ? g.toxic.map(t => `${t.name} ${t.value}`).join('；') : (P.medium && P.medium.toxic === false ? '无' : ''), s(g.analyst), s(yn(g.instrument_ok))]));
    for (let k = rows4.length; k < 3; k++) rows4.push(['', '', '', '', '', '', '', '']);
    body.push(L.pXml(sec('气体分析记录'), { bold: true }));
    body.push(L.tblXml(rows4, { widths: GW, size: 9 }));
  }

  // 表 6：安全措施
  const rows5 = [[H('序号'), { ...H('安全措施'), span: 3 }, H('确认（勾选）')]];
  const M = P.measures || {};
  const keys = (MEASURES_BY_TYPE[P.type] || Object.keys(MEASURE_LABEL)).concat((OPTIONAL_MEASURES[P.type] || []).filter(k => k in M));
  keys.forEach((k, i) => rows5.push([String(i + 1), { text: MEASURE_LABEL[k], span: 3 }, { content: [box(M[k])], align: 'center' }]));
  rows5.push([String(keys.length + 1), { text: '其他：', span: 3 }, { content: [box(false)], align: 'center' }]);
  body.push(L.pXml(sec('安全措施确认'), { bold: true }));
  body.push(L.tblXml(rows5, { widths: [800, 1400, 2600, 3400, 1600], size: 10 }));

  // 表 7：关联作业票与附件
  const rows6 = [[H('关联作业票类型'), H('作业票编号'), H('附件'), { ...H('附件名称/编号'), span: 2 }]];
  const cj = (P.cross_jobs || []).filter(j => j && j.type);
  const at = P.attachments || {};
  const atRows = [['作业方案', at.scheme], ['盲板图', at.blind_plate_map], ['地下管线图', at.underground_map], ['绕行方案', at.detour_plan]].filter(([, v], i) => v != null || i < 2);
  const n = Math.max(cj.length, atRows.length, 1);
  for (let i = 0; i < n; i++) rows6.push([s(cj[i] && cj[i].type), s(cj[i] && cj[i].permit_no), s(atRows[i] && atRows[i][0]), { text: s(atRows[i] && atRows[i][1]), span: 2 }]);
  body.push(L.pXml(sec('关联作业票及附件'), { bold: true }));
  body.push(L.tblXml(rows6, { widths: W, size: 10 }));

  // 表 8：审批签字（属地审批栏按 approvers 中出现的职务命名，默认"属地车间主任"）
  const signed = {};
  signed['申请人'] = P.applicant;
  (P.approvers || []).forEach(a => { const m = a.match(/^(.+?)（(.+)）$/); if (m) signed[m[2]] = m[1]; });
  const local = Object.keys(signed).find(r => /主任/.test(r)) || '属地车间主任';
  const roles = ['申请人', local, '安全环保部', '完工验收人'];
  const rows7 = [[H('审批环节'), H('签字'), H('签字时间'), { ...H('意见'), span: 2 }]];
  roles.forEach(r => {
    const name = signed[r];
    const t = name ? (r === '申请人' ? fmtDT(P.start_time).replace(/ \d\d:\d\d$/, '') + ' 07:30' : (X.approveTime && X.approveTime[r]) || '') : '';
    rows7.push([r, s(name), t, { text: name && r !== '申请人' && r !== '完工验收人' ? '同意' : '', span: 2 }]);
  });
  body.push(L.pXml(sec('审批签字'), { bold: true }));
  body.push(L.tblXml(rows7, { widths: W, size: 10 }));
  body.push(L.pXml('注：本证一式三联，作业前由属地单位、作业单位、安全环保部各存一份；作业结束后完工验收人签字后归档。', { size: 9 }));

  return L.buildDocx(body.join(''), { title: TITLE[P.type], creator: DOCX_CREATOR });
}

/* ======================= 二、演示变体（--demo，决定性伪随机） =======================
 * 规则：装置位号/人名/日期/票号序号可换，数值仅在"判定结论不变"的区间内扰动；
 * 故意埋的缺陷/超限/缺失点全部保留（数量与类型不变），保证示例问题的预期计数不随 seed 漂移。 */
const pad2 = n => String(n).padStart(2, '0');
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const clockMin = iso => { const m = String(iso).match(/T(\d{2}):(\d{2})/); return +m[1] * 60 + +m[2]; };
const clockStr = min => { const m = ((min % 1440) + 1440) % 1440; return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`; };
/** 以 baseIso 的日期为基准，取"当天第 minutes 分钟"的 ISO 时间（可跨天） */
function isoAt(baseIso, minutes) {
  const m = String(baseIso).match(/^(\d{4})-(\d{2})-(\d{2})T/);
  const dayOff = Math.floor(minutes / 1440);
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + dayOff));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}T${clockStr(minutes)}:00+08:00`;
}

/** 各案例的结构化扰动（阈值见 references/rules.json；注释标出保持不变的判定档位）。
 *  rec(旧,新) 登记案例内文本（notes/EXTRA）里需要同步替换的时刻字符串。 */
const PERTURB = {
  'hotwork-level1-with-issues'(P, R) {
    const st = clockMin(P.start_time); // 09:00
    P.gas_tests[0].time = isoAt(P.start_time, st - 5 * R.ri(7, 11)); // 距开工 35~55min：仍 >30 且 ≤60 → HW-005 建议完善档不变
    P.end_time = isoAt(P.start_time, st + 5 * R.ri(109, 140));       // 有效期 9h05~11h40：仍 >8h → HW-012 必改不变
    P.gas_tests[0].o2 = R.rf(20.3, 20.9);                            // 仍在 19.5~21 → HW-009 通过不变
    P.weather.wind_level = R.ri(2, 4);
  },
  'confined-space-ok'(P, R) {
    const st = clockMin(P.start_time); // 08:30
    const t2 = st - 5 * R.ri(2, 5);    // 最近检测距进入 10~25min：仍 ≤30 → CS-005 通过不变
    P.gas_tests[1].time = isoAt(P.start_time, t2);
    P.gas_tests[0].time = isoAt(P.start_time, t2 - 5 * R.ri(4, 8));
    P.gas_tests[0].o2 = R.rf(20.3, 20.9); P.gas_tests[1].o2 = R.rf(20.3, 20.9);
    P.gas_tests[1].toxic[1].value = R.rf(0.2, 0.9);                  // 苯 远低于 6 mg/m3 → CS-004 通过不变
    P.end_time = isoAt(P.start_time, st + 5 * R.ri(240, 280));       // 有效期 20h~23h20：仍 ≤24h → CS-012 通过不变
  },
  'high-place-level2-issues'(P, R) {
    P.end_time = isoAt(P.start_time, clockMin(P.start_time) + R.ri(8, 12) * 1440 + 600); // 8~12 天：仍 >7 天 → HP-005 必改不变；高度 12.5m、风力 6 级保持（示例问题引用了具体数字）
  },
  'confined-space-t201'(P, R, rec, ctx) {
    const st = clockMin(P.start_time); // 08:30
    const t2 = st - 5 * R.ri(2, 5);    // 最近检测距进入 10~25min ≤30
    rec('08:10', clockStr(t2)); ctx.csGas2 = clockStr(t2);
    P.gas_tests[1].time = isoAt(P.start_time, t2);
    P.gas_tests[0].time = isoAt(P.start_time, t2 - 5 * R.ri(3, 6));
    P.gas_tests[0].o2 = R.rf(20.3, 20.9); P.gas_tests[1].o2 = R.rf(20.3, 20.9);
    P.gas_tests[0].toxic[1].value = R.rf(0.1, 0.9); P.gas_tests[1].toxic[1].value = R.rf(0.1, 0.9);
    const end = 5 * R.ri(234, 258);    // 19:30~21:30：有效期 11~13h ≤24h
    rec('20:30', clockStr(end)); ctx.csEnd = end; ctx.csEndClock = clockStr(end);
    P.end_time = isoAt(P.start_time, end);
  },
  'hotwork-t201-inside'(P, R, rec, ctx) {
    rec('20:30', ctx.csEndClock); rec('08:10', ctx.csGas2); // notes 中引用受限票的两处时刻先同步
    const st = clockMin(P.start_time); // 09:00
    const g = st - 5 * R.ri(13, 17);   // 距开工 65~85min：仍 >60 → HW-005 必改档不变；且早于受限票最近一次分析
    rec('07:45', clockStr(g));
    P.gas_tests[0].time = isoAt(P.start_time, g);
    P.gas_tests[0].o2 = R.rf(20.3, 20.9);
    const end = Math.min(ctx.csEnd + 5 * R.ri(12, 28), 1435); // 结束晚于受限票 1~2.3h（跨票提醒保持），有效期仍 >8h → HW-012 必改不变
    rec('22:00', clockStr(end));
    P.end_time = isoAt(P.start_time, end);
  },
  'hotwork-level2-night'(P, R) {
    const st = clockMin(P.start_time); // 22:00（保持，示例问题引用"22 点开始"）
    P.gas_tests[0].time = isoAt(P.start_time, st - 5 * R.ri(2, 5));  // 距开工 10~25min ≤30
    P.gas_tests[0].o2 = R.rf(20.3, 20.9);
    P.end_time = isoAt(P.start_time, 1440 + 5 * R.ri(54, 72));       // 次日 04:30~06:00：二级用火，时长约 6.5~8h
  },
  'confined-space-n2-tank'(P, R, rec) {
    const st = clockMin(P.start_time); // 08:00（保持）
    const t2 = st - 5 * R.ri(2, 5);
    P.gas_tests[1].time = isoAt(P.start_time, t2);
    P.gas_tests[0].time = isoAt(P.start_time, t2 - 5 * R.ri(3, 6));
    P.gas_tests[0].o2 = R.rf(20.3, 20.9); P.gas_tests[1].o2 = R.rf(20.3, 20.9);
    const end = st + 5 * R.ri(300, 358);  // 25h~29h50：仍 >24h → CS-012 必改不变
    rec('10:00', clockStr(end));
    P.end_time = isoAt(P.start_time, end);
  },
  'lifting-45t'(P, R) { P.weather.wind_level = R.ri(2, 4); },  // 45t（二级 40~100t 档）保持，示例问题引用了吨位
  'blind-plate-3'(P, R, rec, ctx) { rec('MB-041-', `MB-${ctx.serNew(41)}-`); }, // 盲板编号跟随票号序号；3 块盲板结构保持
};

/**
 * 计算全部 9 个案例的变体（决定性：同 seed 同结果）。
 * @param {number} seed 非负整数
 * @param {{dataDir?:string}} [opts] dataDir=基准 json 所在目录，默认演示样例目录
 * @returns {{seed:number, dayShift:number, date:string, now:string, cases:Object<string,{permit:Object,extra:Object}>}}
 *          now = 演示日 08:50（+08:00），与基线 --now 2026-08-28T08:50:00+08:00 的相对关系一致
 */
function computeVariants(seed, opts = {}) {
  const exDir = opts.dataDir || caseDir();
  const sd = Number(seed);
  if (!Number.isInteger(sd) || sd < 0) throw new Error(`--seed 需为非负整数，收到 ${seed}`);
  for (const c of CASE_ORDER) if (!fs.existsSync(path.join(exDir, c + '.json'))) throw new Error(`缺少回归基准数据 ${c}.json（应在 ${exDir}）`);
  const rnd = mulberry32(sd + 0x9E3779B9);
  const R = { ri: (a, b) => a + Math.floor(rnd() * (b - a + 1)), rf: (a, b) => Math.round((a + rnd() * (b - a)) * 10) / 10 };
  // 1) 日期整体平移（所有时间戳/审批时间/now 同步移动，相对间隔不变）
  const dayShift = R.ri(-21, 21);
  const shiftYMD = (y, m, d) => { const t = new Date(Date.UTC(y, m - 1, d + dayShift)); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }; };
  // 2) 票号序号整体偏移（跨票关联编号自动保持一致）
  const serialOff = R.ri(3, 60);
  const serNew = n => String((((n - 1 + serialOff) % 999) + 1)).padStart(3, '0');
  // 3) 装置位号（同前缀家族内保证不重复、不与原位号相同）
  const TAGS = ['F-101', 'TK-305', 'TK-208', 'T-201', 'T-101', 'P-302', 'P-103', 'P-105', 'E-305'];
  const tagMap = {}; const usedTags = new Set(TAGS);
  for (const t of TAGS) {
    const m = t.match(/^([A-Z]+-\d)(\d\d)$/);
    let nt, guard = 0;
    do { nt = m[1] + pad2(R.ri(1, 99)); } while (usedTags.has(nt) && ++guard < 60);
    usedTags.add(nt); tagMap[t] = nt;
  }
  // 4) 人名（「王某」为题面占位名，故意不换）
  const OLD_NAMES = ['李强', '张伟', '刘洋', '王建国', '赵敏', '陈芳', '周涛', '吴海', '孙立', '马超', '韩磊', '刘志强', '杨波', '王磊', '赵军', '郑凯', '何军', '林峰', '高飞', '宋健', '李建军', '周明', '胡建平', '陈国栋'];
  const POOL = ['钱学礼', '孙浩然', '李东升', '周子昂', '吴启明', '郑立群', '王思远', '冯建波', '陈冠宇', '魏子安', '蒋文斌', '韦国庆', '姜大海', '崔立新', '谭志远', '陆嘉明', '霍成刚', '龚建华', '邵一鸣', '石永强', '薛志刚', '侯建军', '贾世杰', '邓国斌', '曹永康', '袁天成', '苏正阳', '钟立行', '任大伟', '程亮'];
  for (let i = POOL.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [POOL[i], POOL[j]] = [POOL[j], POOL[i]]; }
  const nameMap = {}; OLD_NAMES.forEach((nm, i) => { nameMap[nm] = POOL[i]; });
  const TAG_RE = new RegExp(TAGS.slice().sort((a, b) => b.length - a.length).join('|'), 'g');
  const NAME_RE = new RegExp(OLD_NAMES.slice().sort((a, b) => b.length - a.length).join('|'), 'g');
  // 5) 字符串修正管道：案例内时刻替换 → ISO 日期平移 → 票号 → 中文日期 → 位号 → 人名
  const makeFix = (repls) => (v) => {
    if (typeof v !== 'string') return v;
    let x = v;
    for (const [a, b] of repls) x = x.split(a).join(b);
    x = x.replace(/(\d{4})-(\d{2})-(\d{2})(?=T\d{2}:)/g, (_, y, mo, d) => { const t = shiftYMD(+y, +mo, +d); return `${t.y}-${pad2(t.m)}-${pad2(t.d)}`; });
    x = x.replace(/\b([A-Z]{2,4})-(\d{4})-(\d{2})(\d{2})-(\d{3})\b/g, (_, p, y, mo, d, ser) => { const t = shiftYMD(+y, +mo, +d); return `${p}-${t.y}-${pad2(t.m)}${pad2(t.d)}-${serNew(+ser)}`; });
    x = x.replace(/\bDZFA-(\d{4})-(\d{3})\b/g, (_, y, ser) => `DZFA-${y}-${serNew(+ser)}`);
    x = x.replace(/(\d{4})年(\d{1,2})月(\d{1,2})日/g, (_, y, mo, d) => { const t = shiftYMD(+y, +mo, +d); return `${t.y}年${t.m}月${t.d}日`; });
    x = x.replace(/(\d{1,2}) 月 (\d{1,2}) 日/g, (_, mo, d) => { const t = shiftYMD(2026, +mo, +d); return `${t.m} 月 ${t.d} 日`; });
    x = x.replace(TAG_RE, m => tagMap[m]);
    x = x.replace(NAME_RE, m => nameMap[m]);
    return x;
  };
  const deepFix = (v, fix) => {
    if (typeof v === 'string') return fix(v);
    if (Array.isArray(v)) return v.map(e => deepFix(e, fix));
    if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = deepFix(v[k], fix); return o; }
    return v;
  };
  // 6) 逐案例：先结构化扰动（在基线日期上改时刻/读数），再统一做字符串修正
  const ctx = { serNew };
  const cases = {};
  for (const c of CASE_ORDER) {
    const P = JSON.parse(fs.readFileSync(path.join(exDir, c + '.json'), 'utf8'));
    const repls = []; const rec = (a, b) => { if (a !== b) repls.push([a, b]); };
    (PERTURB[c] || (() => { }))(P, R, rec, ctx);
    const fix = makeFix(repls);
    const extra = deepFix(JSON.parse(JSON.stringify(EXTRA[c] || {})), fix);
    cases[c] = { permit: deepFix(P, fix), extra };
  }
  const nd = shiftYMD(2026, 8, 28);
  const dateStr = `${nd.y}-${pad2(nd.m)}-${pad2(nd.d)}`;
  return { seed: sd, dayShift, date: dateStr, now: `${dateStr}T08:50:00+08:00`, cases };
}

/* ======================= 三、主流程 ======================= */
/** 内容相同就不重写：docx 按读回文本与生成器名比较；文本文件可忽略指定的易变行 */
function sameDocx(file, buf) {
  if (!fs.existsSync(file)) return false;
  try {
    const old = fs.readFileSync(file);
    if (L.docxToText(old).text !== L.docxToText(buf).text) return false;
    const core = L.readZip(old).get('docProps/core.xml');
    return !!core && String(core).includes(DOCX_CREATOR);
  } catch (e) { return false; }
}
function writeDocx(file, buf) { if (!sameDocx(file, buf)) { fs.writeFileSync(file, buf); return true; } return false; }
function writeText(file, text, volatile) {
  const strip = (x) => (volatile ? x.split('\n').filter((l) => !volatile.test(l)).join('\n') : x);
  if (fs.existsSync(file) && strip(fs.readFileSync(file, 'utf8')) === strip(text)) return false;
  fs.writeFileSync(file, text, 'utf8');
  return true;
}

/** 合并报告样例（5 份 JSON），seed 只改票号尾号、时间与人名 */
function writeBridgeSamples(out, seed) {
  let st = seed * 7919 + 13;
  const rnd = () => ((st = (st * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const no3 = () => String(100 + Math.floor(rnd() * 800));
  const NAMES = ['张', '李', '王', '赵', '刘'];
  const pick = (arr) => arr[Math.floor(rnd() * arr.length) % arr.length];

  const permitNo = `DH-2026-0826-${no3()}`;
  const hours = 9 + Math.floor(rnd() * 3);   // 9~11h，恒超过 8h
  const minutes = 40 + Math.floor(rnd() * 30); // 40~69 分钟，恒超过 30 分钟
  const DISCLAIMER = '本结果为辅助预检，不替代作业票审批；条款号以 GB 30871-2022 正式文本为准。';
  // findings 的 message / basis 是规则库原文，沿用 GB 30871 的「动火」一词（即中石化「用火作业」），这里不改写
  const findings = [
    { rule_id: 'G-011', severity: 'must_fix', message: '监护人未指定/未签字', detail: 'guardian 为空/null', basis: 'GB 30871-2022 第4章 通用要求（特殊作业应设专人监护）', rule_type: 'required', check_name: '监护人已指定' },
    { rule_id: 'HW-012', severity: 'must_fix', message: '特级/一级动火作业票有效期超过 8h', detail: `有效期 ${hours}.0h，超过 8h`, basis: 'GB 30871-2022 第5章 动火作业（特级、一级动火票有效期不超过 8h）', rule_type: 'duration_max', check_name: '特级/一级有效期 ≤8h' },
    { rule_id: 'HW-019', severity: 'must_fix', message: '受限空间内动火，未关联受限空间作业票', detail: 'cross_jobs 中无 受限空间 作业票', basis: 'GB 30871-2022 第4章 通用要求（涉及多种特殊作业应同时办理相应作业票）', rule_type: 'cross_permit', check_name: '受限空间内动火已关联受限空间票' },
    { rule_id: 'G-019', severity: 'should_improve', message: '监护人资质/培训合格证未填写', detail: 'guardian_cert 为空', basis: '通行做法（待核实）：监护人应经培训合格', rule_type: 'required', check_name: '监护人资质已填写' },
    { rule_id: 'HW-006', severity: 'should_improve', message: `气体分析距计划开工超过 30 分钟（${minutes} 分钟）`, detail: `最近一次分析 ${minutes} 分钟前`, basis: 'GB 30871-2022 第5章 动火作业（动火前 30 分钟内取样分析）', rule_type: 'time_window', check_name: '气体分析时效' },
    { rule_id: 'HW-003', severity: 'undetermined', message: '无法判定：动火点是否在受限空间内', detail: '依赖字段 in_confined_space 为空', basis: 'GB 30871-2022 第5章 动火作业', rule_type: 'conditional', check_name: '受限空间内动火判定' },
    { rule_id: 'G-001', severity: 'pass', message: '通过：作业票编号已填写', detail: `已填写：${permitNo}`, basis: '通行做法', rule_type: 'required', check_name: '票号已填写' },
    { rule_id: 'G-002', severity: 'pass', message: '通过：作业类型已填写', detail: '已填写：动火', basis: 'GB 30871-2022 第4章 通用要求', rule_type: 'enum', check_name: '作业类型' },
    { rule_id: 'HW-001', severity: 'pass', message: '通过：动火级别已填写', detail: '已填写：一级', basis: 'GB 30871-2022 第5章 动火作业', rule_type: 'enum', check_name: '动火级别' },
    { rule_id: 'G-021', severity: 'pass', message: '通过：作业负责人已签字', detail: `已填写：${pick(NAMES)}某`, basis: 'GB 30871-2022 第4章 通用要求', rule_type: 'required', check_name: '作业负责人签字' },
  ];
  const base = {
    permit_no: permitNo, type: '动火', level: '一级', now: '2026-08-26 08:50（北京时间）',
    summary: { must_fix: 3, should_improve: 2, undetermined: 1, pass: 4 }, skipped: 85, findings,
    extraction_notes: ['in_confined_space：票面「动火点是否在受限空间内」栏留白 → 填 null', `guardian：监护人签字栏空白 → 填 null（${pick(NAMES)}某口头告知但未签字）`],
    disclaimer: DISCLAIMER,
  };
  const wjson = (name, obj) => fs.writeFileSync(path.join(out, name), JSON.stringify(obj, null, 2), 'utf8');
  wjson('sample-permit-result.json', base);
  const mismatch = JSON.parse(JSON.stringify(base));
  mismatch.summary = { must_fix: 3, should_improve: 5, undetermined: 1, pass: 4 };
  wjson('sample-permit-result-summary-mismatch.json', mismatch);
  const unknownType = JSON.parse(JSON.stringify(base));
  unknownType.type = '射线探伤';
  unknownType.permit_no = `RT-2026-0826-${no3()}`;
  wjson('sample-permit-result-unknown-type.json', unknownType);
  wjson('sample-workshop-notes.json', [
    { item: '设备交出条件', status: '已核实', note: `设备交出单 ${C.localDate()} 四方已签字，盲板 3 块已挂牌（equipment-handover-check 产出）` },
    { item: '同区域交叉作业', status: '未核实', note: '' },
    { item: '承包商资质', status: '不适用', note: '本厂机修车间自行施工，不涉及承包商' },
  ]);
  wjson('sample-workshop-notes-bad.json', [
    { item: '设备交出条件', status: '大概没问题', note: '班长口头说交出了' },
    { item: '同区域交叉作业', status: '已核实', note: '同时段无其他作业票' },
    { item: '脚手架验收牌', status: '已核实', note: '脚手架验收牌已挂（车间自查项）' },
  ]);
  return permitNo;
}

/** 与 docx2text.js 命令行输出的文件头一致（selftest R*.3 用命令行实跑比对，两边不一致会报错） */
const docx2textHeader = (name) => `# docx2text 输出\n来源：${name}\n说明：[x]=已勾选 [ ]=未勾选 [×]=叉选（可能表示选中也可能表示否定，含义需人工判断）；表格行以 | 分隔；「〃」表示与上一行纵向合并；「‹›」为横向合并单元格的占位（不是留白）；空单元格才是票面留白；~~文字~~ 为删除线文本；【文本框】为文本框内容；页眉/页脚在末尾单列\n\n`;

/** 规则引擎回归样例：json → docx → docx2text.txt；json → precheck.js → expected-report.md（进程内调用，与命令行产出相同） */
function writeRegression(out, dataDir, warnings) {
  const pc = require('./precheck');
  const rules = pc.loadRules();
  const now = pc.toDate(REGRESS_NOW);
  const ctx = { now, toxicLimits: rules.toxic_limits || {}, rulesTotal: rules.rules.length, rulesVersion: rules.meta && rules.meta.version };
  const tpl = fs.readFileSync(path.join(__dirname, '..', 'assets', 'templates', 'report-template.md'), 'utf8');
  const counts = {};
  const changed = [];
  for (const c of CASE_ORDER) {
    const src = path.join(dataDir, c + '.json');
    if (!fs.existsSync(src)) throw new Error(`缺少回归基准数据 ${c}.json（应在 ${dataDir}）`);
    const jsonFile = path.join(out, c + '.json');
    if (path.resolve(src) !== path.resolve(jsonFile)) fs.copyFileSync(src, jsonFile);
    let P;
    try { P = JSON.parse(fs.readFileSync(jsonFile, 'utf8')); } catch (e) { throw new Error(`${c}.json 解析失败: ${e.message}`); }
    const docxFile = path.join(out, c + '.docx');
    if (writeDocx(docxFile, build(c, P))) changed.push(c + '.docx');
    // docx → 文本（读的是落盘后的 docx，与 docx2text.js --out 的文件内容一致）
    const text = docx2textHeader(path.basename(docxFile)) + L.docxToText(fs.readFileSync(docxFile)).text;
    if (writeText(path.join(out, c + '.docx2text.txt'), text)) changed.push(c + '.docx2text.txt');
    // 规则引擎 → 期望报告（忽略生成时间行）
    const ev = pc.evaluate(JSON.parse(JSON.stringify(P)), rules, ctx);
    counts[c] = [ev.summary.must_fix, ev.summary.should_improve, ev.summary.undetermined, ev.summary.pass];
    if (counts[c].join('/') !== EXPECTED[c].join('/')) warnings.push(`${c} 计数 ${counts[c].join('/')} 与基线 ${EXPECTED[c].join('/')} 不一致，请核对规则库或基准数据`);
    const md = pc.renderReport(tpl, ev.permit, { findings: ev.findings, skipped: ev.skipped, summary: ev.summary }, ctx);
    if (writeText(path.join(out, c + '.expected-report.md'), md, /生成时间/)) changed.push(c + '.expected-report.md');
  }
  // 合并报告示例问题 1 的附件：一级用火票 Word 样例，与 hotwork-level1-with-issues.docx 票面相同
  const hot = JSON.parse(fs.readFileSync(path.join(out, 'hotwork-level1-with-issues.json'), 'utf8'));
  if (writeDocx(path.join(out, 'sample-hotwork-permit.docx'), build('hotwork-level1-with-issues', hot))) changed.push('sample-hotwork-permit.docx');
  return { counts, changed };
}

/** 演示变体：写文件前先跑规则引擎，四项计数与基线不一致则不写任何文件 */
function writeDemo(demoDir, seed, dataDir) {
  const pc = require('./precheck');
  const V = computeVariants(seed, { dataDir });
  const rules = pc.loadRules();
  const ctx = { now: pc.toDate(V.now), toxicLimits: rules.toxic_limits, rulesTotal: rules.rules.length, rulesVersion: rules.meta.version };
  for (const [c, exp] of Object.entries(EXPECTED)) {
    const r = pc.evaluate(JSON.parse(JSON.stringify(V.cases[c].permit)), rules, ctx);
    const got = [r.summary.must_fix, r.summary.should_improve, r.summary.undetermined, r.summary.pass];
    if (got.join('/') !== exp.join('/')) throw new Error(`seed ${seed} 下 ${c} 计数漂移：期望 ${exp.join('/')}，实际 ${got.join('/')}（变体规则有误，未生成任何变体）`);
  }
  fs.mkdirSync(demoDir, { recursive: true });
  const files = [];
  for (const c of CASE_ORDER) { fs.writeFileSync(path.join(demoDir, c + '.docx'), build(c, V.cases[c].permit, V.cases[c].extra)); files.push(c + '.docx'); }
  return { dir: demoDir, seed: V.seed, date: V.date, now: V.now, files };
}

function main() {
  const warnings = [];
  const a = C.parseArgs(process.argv.slice(2), ['out', 'seed', 'demo'], []);
  const seed = a.seed === undefined ? 1 : Number(a.seed);
  if (!/^\d+$/.test(String(a.seed === undefined ? 1 : a.seed)) || !Number.isSafeInteger(seed)) throw new Error(`--seed 需为非负整数，收到 ${a.seed}`);
  const dataDir = caseDir();
  const out = path.resolve(a.out || dataDir);
  if (a.demo && [out, path.resolve(dataDir)].includes(path.resolve(a.demo))) throw new Error('--demo 生成的是变体票面，不能写到回归样例目录（会破坏回归基准），请另指一个目录');
  fs.mkdirSync(out, { recursive: true });
  const permitNo = writeBridgeSamples(out, seed);
  const reg = writeRegression(out, dataDir, warnings);
  const demo = a.demo ? writeDemo(path.resolve(a.demo), seed, dataDir) : null;
  console.log(JSON.stringify({
    ok: true, out, seed, permitNo, now: REGRESS_NOW,
    counts: Object.fromEntries(Object.entries(reg.counts).map(([k, v]) => [k, v.join('/')])),
    changed: reg.changed,
    files: fs.readdirSync(out).filter((f) => /\.(json|docx|txt|md)$/.test(f) && f !== 'README.md').sort(),
    demo, warnings,
  }));
}

if (require.main === module) { try { main(); } catch (e) { C.fail(e); } }
module.exports = { build, computeVariants, caseDir, CASE_ORDER, EXPECTED, REGRESS_NOW };
