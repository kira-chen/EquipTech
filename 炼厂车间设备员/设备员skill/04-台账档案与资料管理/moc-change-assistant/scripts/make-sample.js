#!/usr/bin/env node
'use strict';
/**
 * 生成 MOC 判定样例输入（可再生）。用法：node scripts/make-sample.js --out <dir> [--seed <n>] [--date <YYYY-MM-DD>]
 *       node scripts/make-sample.js --spec-template <xlsx路径>     # 只生成厂内制度 --spec 预填模板（assets 用）
 * 样例恒定结论：设备台账 6 台（SAP PM 列名，含设备类别）；厂内制度 5 条，其中「备件代用」与默认口径（待厂内评审）冲突 1 处。
 * seed 只改变设备编号、设计参数数值，判定结论（级别、冲突数、未判定数）不变。
 */
const fs = require('fs');
const path = require('path');
const { writeXlsx } = require('./lib/xlsx-lite');
const C = require('./lib/common');

const a = C.parseArgs(process.argv.slice(2), ['out', 'seed', 'date', 'spec-template'], []);
const date = a.date || '2026-11-30';
const seed = a.seed ? Number(a.seed) : 1;
let s = seed * 7919 + 13;
const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const jitter = (base, span) => C.round(base + (rnd() - 0.5) * span, 1);
const eqno = (i) => String(10000000 + ((seed * 131 + i * 977) % 8999999));

// 厂内制度预填模板：按《中国石化变更管理规定》分类框架预填变更类型与默认级别，条款号与级别由厂内按实施细则改填
const SPEC_TEMPLATE = {
  '变更判定': [
    ['厂内变更管理实施细则 · 判定口径（预填模板，请按厂内制度改填「变更等级」与「条款号」）'],
    [],
    ['变更类别', '变更类型', '判定', '变更等级', '条款号', '说明'],
    ['材质变更', '设备设施变更', '属于变更', '重大变更', '《中国石化变更管理规定》+ 厂内实施细则第__条', '材质降级或改变材质类别；同类别升级可按一般'],
    ['型号规格变更', '设备设施变更', '属于变更', '一般变更', '厂内实施细则第__条', '影响性能参数时'],
    ['结构改动', '设备设施变更', '属于变更', '重大变更', '厂内实施细则第__条', '压力容器/管道改造须附改造告知、监督检验、使用登记变更'],
    ['工艺参数变更', '工艺技术变更', '属于变更', '重大变更', '厂内实施细则第__条', '超出设计范围为重大，未超为一般；由工艺专业提报'],
    ['控制方案变更', '工艺技术变更', '属于变更', '重大变更', '厂内实施细则第__条', '联锁定值与控制方案；由仪表专业提报'],
    ['备件代用', '设备设施变更', '走材料代用单 / 同类替换评审', '厂内评审', '厂内实施细则第__条', '同规格不同厂家；是否报变更由厂内定'],
    ['管理变更', '管理变更', '属于变更', '一般变更', '厂内实施细则第__条', '组织机构、制度、人员、承包商；级别由厂内定'],
  ],
};
if (a['spec-template']) {
  fs.mkdirSync(path.dirname(a['spec-template']), { recursive: true });
  writeXlsx(a['spec-template'], SPEC_TEMPLATE);
  console.log(JSON.stringify({ ok: true, specTemplate: a['spec-template'] }));
  process.exit(0);
}

const out = a.out || path.join(__dirname, '..', 'examples');
fs.mkdirSync(out, { recursive: true });

// 设备台账：SAP PM 技术对象导出列名（功能位置 / 设备 / 设备描述 / 对象类型），含材质与设计参数，用于核对原状态与承压设备识别
writeXlsx(path.join(out, 'sample-equip-ledger.xlsx'), {
  '设备台账': [
    ['功能位置', '设备', '设备描述', '对象类型', '主体材质', '型号编号', '设计压力', '设计温度', '介质'],
    ['P-2101A', eqno(1), '柴油加氢进料泵A', '离心泵', '316L', 'DA65-50×6', jitter(6.4, 0.4), jitter(150, 10), '柴油'],
    ['E-2201', eqno(2), '进料换热器', '压力容器（换热器）', '碳钢+304衬里', 'BES800-2.5', jitter(2.5, 0.2), jitter(320, 20), '柴油'],
    ['V-2301', eqno(3), '低压分离器', '压力容器', '16MnR', 'φ1600×6000', jitter(1.6, 0.2), jitter(120, 10), '含硫污水'],
    ['C-2401', eqno(4), '分馏塔', '压力容器（塔）', '碳钢', 'φ2400×32000', jitter(0.8, 0.1), jitter(380, 20), '汽油'],
    ['P-2103A', eqno(5), '急冷油泵A', '离心泵', '碳钢', 'IH100-65-200', jitter(1.6, 0.2), jitter(200, 10), '液化气'],
    ['T-2501', eqno(6), '塔顶冷却器', '压力容器（换热器）', '304', 'BEM500-1.6', jitter(1.6, 0.1), jitter(180, 10), '石脑油'],
  ],
});

// 厂内变更管理制度：5 条；其中「备件代用」定为重大变更，与默认口径（待厂内评审）冲突
writeXlsx(path.join(out, 'sample-plant-spec.xlsx'), {
  '变更判定': [
    ['某厂变更管理实施细则（摘录，虚构）'],
    [],
    ['变更类别', '变更类型', '判定', '变更等级', '条款号'],
    ['材质变更', '设备设施变更', '属于变更', '重大变更', 'Q/XX-虚构-001 第4.2.1条'],
    ['备件代用', '设备设施变更', '属于变更', '重大变更', 'Q/XX-虚构-001 第4.2.5条'],
    ['结构改动', '设备设施变更', '属于变更', '重大变更', 'Q/XX-虚构-001 第4.2.3条'],
    ['工艺参数变更', '工艺技术变更', '属于变更', '一般变更', 'Q/XX-虚构-001 第4.3.2条'],
    ['管理变更', '管理变更', '属于变更', '一般变更', 'Q/XX-虚构-001 第4.4.1条'],
    ['合计', '', '', '', ''],
  ],
});

// 变体：制度表里含无法识别的类别与等级，验证 warning 且不中断
writeXlsx(path.join(out, 'sample-plant-spec-bad.xlsx'), {
  '变更判定': [
    ['变更类别', '变更等级', '条款号'],
    ['材质变更', '重大变更', 'Q/XX-虚构-001 第4.2.1条'],
    ['说不清的一类改动', '重大变更', 'Q/XX-虚构-001 第4.9.9条'],
    ['备件代用', '看情况定', 'Q/XX-虚构-001 第4.2.5条'],
  ],
});

// 供人工回归的典型命令清单
const cases = [
  { name: 'RN1 同类替换（不属于变更）', args: `--tag P-2101A --before "316L 材质 DA65-50×6 机械密封 A厂" --after "316L 材质 DA65-50×6 同型号同厂家机械密封" --reason "密封到期更换" --same-model-material 是 --category 备件代用` },
  { name: 'R1 材质降级（承压设备，附三项法定手续）', args: `--tag E-2201 --before "管束材质 316L" --after "管束材质 碳钢 Q345R" --reason "降本" --category 材质 --ledger examples/sample-equip-ledger.xlsx` },
  { name: 'R3 结构改动（压力容器）', args: `--tag V-2301 --before "筒体无取样口，DN1600" --after "筒体下部新增 DN25 取样管口一个" --reason "增加采样点" --ledger examples/sample-equip-ledger.xlsx` },
  { name: 'R4 工艺超设计（由工艺专业提报）', args: `--tag C-2401 --before "操作压力 0.6 MPa" --after "操作压力 0.95 MPa" --reason "提量" --exceeds-design 是` },
  { name: 'R5 联锁定值（由仪表专业提报）', args: `--tag P-2103A --before "低流量联锁值 12 m3/h" --after "低流量联锁值 8 m3/h" --reason "误停车频繁"` },
  { name: 'R6 同规格不同厂家代用（待厂内评审）', args: `--tag P-2101A --before "机封 316L 型号 5610 A厂" --after "机封 316L 型号 5610 B厂 同规格" --reason "国产替代" --category 备件代用` },
  { name: 'R3+R7 临时结构改动', args: `--tag T-2501 --before "冷却水线 DN150 正常投用" --after "临时加装 DN50 跨线，压力 0.4 MPa" --temporary --until ${date} --special 否` },
  { name: 'U1 描述笼统 / 只给位号', args: `--tag P-2101A --before "换个泵" --after "换成 P-2101B" --reason "坏了"` },
];
fs.writeFileSync(path.join(out, 'sample-cases.md'),
  `# 回归用例命令（date=${date}, seed=${seed}）\n\n由 make-sample.js 生成，供人工回归；断言见 scripts/selftest.js。\n\n`
  + cases.map((c, i) => `## ${i + 1}. ${c.name}\n\n\`\`\`bash\nnode scripts/moc.js ${c.args} --out <输出目录>\n\`\`\`\n`).join('\n'),
  'utf8');

console.log(JSON.stringify({
  ok: true, out, date, seed,
  files: fs.readdirSync(out).filter((f) => f.endsWith('.xlsx') || f === 'sample-cases.md'),
}));
