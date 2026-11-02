#!/usr/bin/env node
'use strict';
/**
 * 生成完工验收样例输入（可再生）。用法：node scripts/make-sample.js --out <dir> [--seed <n>]
 * seed 改变的是实测数值与人名，不改变结论：
 *   - sample-plan-pump.txt              恒 6 个质量控制点，其中 1 个（联轴器护罩）故意无对应验收项 → qcGap 恒为 1
 *   - sample-acceptance-record.xlsx     恒 2 项不合格、1 项未判定、1 项无法匹配
 *   - sample-acceptance-record-em.xlsx  EM 检修验收记录导出列名（验收项目 / 验收结论 / 问题描述，工作表「检修验收记录」）；恒 1 项不合格
 *   - sample-plan-hex.xlsx              恒 4 个质量控制点，全部可对应 → qcGap 恒为 0
 *   - sample-plan-compressor.docx       Word 检修方案（docx-lite 生成），恒 5 个质量控制点，全部可对应（压缩机/机组）
 *   - sample-plan-no-qc.txt             无质量控制点（验证「未识别出控制点」分支）
 */
const fs = require('fs');
const path = require('path');
const { writeXlsx } = require('./lib/xlsx-lite');
const C = require('./lib/common');
const lite = require('./lib/docx-lite');

const a = C.parseArgs(process.argv.slice(2), ['out', 'seed'], []);
const out = a.out || path.join(__dirname, '..', 'examples');
const seed = a.seed ? Number(a.seed) : 1;
let s = seed * 7919 + 13;
const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const jitter = (v, p = 0.05) => Number((v * (1 + (rnd() - 0.5) * 2 * p)).toFixed(2));
const NAMES = ['张工', '李工', '王工', '赵工', '刘工'];
const pick = (arr) => arr[Math.floor(rnd() * arr.length) % arr.length];

fs.mkdirSync(out, { recursive: true });

// ---- 1. 离心泵检修方案（文本，含质量控制点小节）
const planPump = `P-1101B 常压塔顶回流泵B 解体检修方案（日常维修）

一、检修内容
1. 泵解体检查，更换机械密封、轴承
2. 泵与电机重新对中找正
3. 壳体清洗、防腐层恢复

二、施工步骤
1. 办理作业票，设备交出、隔离、置换分析合格
2. 拆联轴器、抽芯解体
3. 清洗检查各零部件，测量磨损间隙
4. 回装、对中、复位管线

三、质量控制点
1. 质量控制点：泵与电机对中偏差实测并记录，径向、轴向偏差符合制造厂技术文件规定
2. 质量控制点：机械密封安装到位，冲洗方案按原设计恢复
3. 质量控制点：轴承间隙实测值符合技术文件要求，润滑脂牌号与加注量按规定执行
4. 质量控制点：地脚螺栓紧固力矩按技术文件执行，垫铁接触良好
5. 质量控制点：手动盘车灵活无卡涩，无异常摩擦声
6. 质量控制点：联轴器弹性块磨损量检查并记录更换情况

四、试运要求
空负荷点动确认转向，负荷试运连续 ${Math.round(jitter(4, 0.2))} 小时，记录振动值与轴承温度

五、安全措施
1. 严格执行用火作业、受限空间作业许可制度
2. 电机在检修期间挂牌上锁
`;
fs.writeFileSync(path.join(out, 'sample-plan-pump.txt'), planPump, 'utf8');

// ---- 2. 验收记录（回填用）：恒 2 不合格、1 未判定、1 无法匹配
writeXlsx(path.join(out, 'sample-acceptance-record.xlsx'), {
  '验收记录': [
    ['序号', '验收项', '验收结果', '备注'],
    [1, '设备及周边现场清洁、工完料尽场地清', '合格', ''],
    [2, '设备本体外观完好', '合格', ''],
    ['', '螺栓紧固', '合格', `力矩抽查 ${Math.round(jitter(6, 0.15))} 处`],
    ['', '泵与电机对中（找正）', '不合格', `径向偏差实测 ${jitter(0.12, 0.2)} mm，超出方案规定值，需重新找正`],
    ['', '转子盘车', '合格', ''],
    // 序号 3 与名称不一致（清单重排导致），用于验证「按名称为准并 warning」
    [3, '轴承间隙与润滑', '待复测', `${pick(NAMES)}提出需二次复测`],
    ['', '机械密封（填料）安装与泄漏', '不合格', '试运 30 分钟后机封处出现滴漏'],
    ['', '联轴器弹性块磨损量检查', '合格', '本项不在清单内，用于验证未匹配提示'],
  ],
});

// ---- 2b. EM 检修验收记录导出风格（标题行 + 系统列名 + 合计行）：恒 1 不合格
writeXlsx(path.join(out, 'sample-acceptance-record-em.xlsx'), {
  '检修验收记录': [
    ['EM 设备管理信息系统 检修验收记录导出'],
    [],
    ['序号', '验收项目', '验收结论', '问题描述', '验收人'],
    [1, '设备及周边现场清洁、工完料尽场地清', '合格', '', pick(NAMES)],
    [2, '泵与电机对中（找正）', '不合格', `径向偏差实测 ${jitter(0.10, 0.2)} mm，超出方案规定值`, pick(NAMES)],
    [3, '转子盘车', '合格', '', pick(NAMES)],
    ['合计', '', '', '', ''],
  ],
});

// ---- 3. 换热器检修方案（xlsx 形式，质量控制点全部可对应）
writeXlsx(path.join(out, 'sample-plan-hex.xlsx'), {
  '检修方案': [
    ['E-1201 原油换热器 检修方案'],
    [],
    ['章节', '内容'],
    ['检修内容', '抽管束、管程壳程化学清洗、法兰垫片更换、保温恢复'],
    ['质量控制点', '管束清洗后无结垢无堵管，清洗方式与方案一致'],
    ['质量控制点', '管程水压试验按设计压力执行，保压时间符合规定，无泄漏'],
    ['质量控制点', '壳程水压试验按设计压力执行，保压时间符合规定，无泄漏'],
    ['质量控制点', '法兰螺栓按对角顺序分次紧固，力矩按技术文件执行'],
    ['试运要求', `投用升温速率不超过 ${Math.round(jitter(50, 0.1))} ℃/h`],
  ],
});

// ---- 4. 压缩机机组检修方案（Word docx，用 docx-lite 生成；质量控制点全部可对应）
const compParas = [
  'K-3101 循环氢压缩机 大检修 检修方案',
  '一、检修内容',
  '1. 机组解体检查，更换轴承、干气密封',
  '2. 转子动平衡，机组对中找正',
  '3. 联锁保护试验、负荷试运',
  '二、施工步骤',
  '1. 办理作业票，设备交出、氮气置换合格',
  '2. 拆缸解体、测量间隙',
  '3. 回装、对中、复位管线',
  '三、质量控制点',
  '1. 质量控制点：轴承间隙、轴向窜量实测值符合制造厂技术文件规定，有记录（H 点）',
  '2. 质量控制点：各联轴器对中偏差符合技术文件规定值，冷态对中记录齐全',
  '3. 质量控制点：干气密封一级、二级泄漏量在技术文件规定范围内',
  '4. 质量控制点：联锁保护按逻辑图逐项试验合格并记录',
  '5. 质量控制点：盘车灵活无卡涩，转子动平衡记录合格',
  '四、试运要求',
  `负荷试运连续 ${Math.round(jitter(8, 0.2))} 小时，记录各测点振动、轴位移与轴承温度`,
];
const compTable = lite.tblXml([
  ['序号', '工序', '见证类别', '责任方'],
  ['1', '轴承间隙测量', 'H', '承修单位 / 公司设备部门'],
  ['2', '机组对中', 'W', '承修单位'],
  ['3', '联锁试验', 'H', '仪表 / 车间'],
], { widths: [800, 3000, 1200, 3000] });
const compBody = compParas.map((t) => lite.pXml(t)).join('') + compTable;
fs.writeFileSync(path.join(out, 'sample-plan-compressor.docx'), lite.buildDocx(compBody));

// ---- 5. 无质量控制点的方案（验证「未识别出控制点」分支）
fs.writeFileSync(path.join(out, 'sample-plan-no-qc.txt'),
  `V-1301 原油缓冲罐 检修方案\n\n一、检修内容\n清罐、内部防腐层修补、人孔垫片更换\n\n二、施工步骤\n1. 置换清罐\n2. 打磨除锈\n3. 涂刷防腐涂层\n\n三、工期\n计划 ${Math.round(jitter(5, 0.2))} 天\n`, 'utf8');

console.log(JSON.stringify({
  ok: true, out, seed,
  files: fs.readdirSync(out).filter((f) => /\.(xlsx|txt|docx)$/.test(f)),
}));
