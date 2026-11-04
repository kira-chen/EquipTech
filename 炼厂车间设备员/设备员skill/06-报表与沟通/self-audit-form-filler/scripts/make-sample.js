#!/usr/bin/env node
'use strict';
/**
 * 生成自查表预填样例（可再生）。用法：node scripts/make-sample.js --out <dir> [--seed <n>]
 * seed 改变表号、设备位号与日期细节，但预期结论不变：
 *   主自查表（15 项）配主台账 + --period 2026-09-30 恒为：
 *   5 项已预填、8 项需责任人判断、2 项缺数据、0 项无法解析。
 */
const fs = require('fs');
const path = require('path');
const { writeXlsx } = require('./lib/xlsx-lite');
const C = require('./lib/common');

const a = C.parseArgs(process.argv.slice(2), ['out', 'seed'], []);
// 默认输出到演示样例目录：仓库内在 炼厂车间设备员/演示case/<分类>/<技能>/，开发包内在技能目录 examples/
const skillsRoot = path.resolve(__dirname, '../../..');
const caseDir = path.basename(skillsRoot) === '设备员skill' ? path.join(skillsRoot, '..', '演示case', path.relative(skillsRoot, path.resolve(__dirname, '..'))) : path.join(__dirname, '..', 'examples');
const out = a.out || caseDir;
const seed = a.seed ? Number(a.seed) : 1;
let s = seed * 7919 + 13;
const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const no = () => String(100 + Math.floor(rnd() * 800));
const tag = (p) => `${p}-${1100 + Math.floor(rnd() * 800)}${'ABC'[Math.floor(rnd() * 3) % 3]}`;
const pick = (arr) => arr[Math.floor(rnd() * arr.length) % arr.length];

fs.mkdirSync(out, { recursive: true });

/* ---------------- 主自查表：设备专项自查，15 项（客观项与判断类混合） ----------------
 * 客观项 7 项：1(有无)、2(数量)、4(到期)、6(日期)、8(有无)、11(齐全计数)、13(数量)
 *   其中 8(作业票)、13(备件)对应的台账故意不提供 → 缺数据 2 项
 * 判断类 8 项：3(健全 J1)、5(明确到人 J3)、7(得当 J5)、9(严格执行 J2)、10(有效 J4)、
 *            12(落实到位 J2)、14(风险可控 J10)、15(总体评价 J13)
 */
writeXlsx(path.join(out, 'sample-self-audit-form.xlsx'), {
  '自查表': [
    [`${pick(['某某', '某'])}炼化公司 设备管理专项检查自查表（${no()}号）`],
    [`填报单位：常减压车间　　填报时间：　　　　`],
    ['序号', '自查类别', '自查内容', '自查依据', '现状', '是否符合', '整改措施', '备注'],
    ['1', '基础管理', '是否建立车间设备台账', 'Q/SH 设备管理规定', '', '', '', ''],
    ['2', '基础管理', '在用设备台数（台）', '', '', '', '', ''],
    ['3', '基础管理', '设备管理制度是否健全', '', '', '', '', ''],
    ['4', '特种设备', '压力容器是否在检验有效期内、有无超期', '特种设备安全法', '', '', '', ''],
    ['5', '特种设备', '特种设备管理责任是否明确到人', '', '', '', '', ''],
    ['6', '安全附件', '安全阀上次校验日期', '', '', '', '', ''],
    ['7', '安全附件', '安全附件管理措施是否得当', '', '', '', '', ''],
    ['8', '作业管理', '是否建立作业票台账', '', '', '', '', ''],
    ['9', '作业管理', '作业票审批是否严格执行', '', '', '', '', ''],
    ['10', '人员管理', '特种作业人员培训是否有效', '', '', '', '', ''],
    ['11', '运行维护', '巡检记录是否逐台齐全', '', '', '', '', ''],
    ['12', '运行维护', '日常维护保养落实是否到位', '', '', '', '', ''],
    ['13', '物资管理', '关键备件库存数量（项）', '', '', '', '', ''],
    ['14', '隐患排查', '现场是否存在隐患、风险是否可控', '', '', '', '', ''],
    ['15', '总体', '本次自查总体评价与自评结论', '', '', '', '', ''],
    ['填报人', '', '', '', '', '', '', ''],
  ],
});

/* ---------------- 主台账数据：5 张表，对应自查项 1/2/4/6/11 ----------------
 * 故意不提供作业票台账与备件台账 → 自查项 8、13 落入 noData
 */
writeXlsx(path.join(out, 'sample-ledger-data.xlsx'), {
  '设备台账': [
    ['位号', '设备名称', '规格型号', '投用日期', '状态'],
    [tag('P'), '常压塔进料泵', 'DFS150-80', '2019-05-12', '在用'],
    [tag('P'), '常压塔进料泵备机', 'DFS150-80', '2019-05-12', '在用'],
    [tag('V'), '原油缓冲罐', 'φ3000×8000', '2018-03-20', '在用'],
    [tag('E'), '原油换热器', 'BES800', '2020-11-02', '在用'],
    [tag('C'), '富气压缩机', '2BE-350', '2021-06-18', '在用'],
    [tag('F'), '常压加热炉', 'GG-40', '2017-09-25', '在用'],
    ['合计', '6 台', '', '', ''],
  ],
  '特种设备检验台账': [
    ['位号', '设备名称', '类别', '上次检验日期', '下次检验日期'],
    ['V-2301', '原油缓冲罐', '压力容器', '2023-08-10', '2026-08-10'],
    ['V-2302', '轻污油罐', '压力容器', '2024-03-15', '2027-03-15'],
    ['V-2303', '瓦斯分液罐', '压力容器', '2024-07-01', '2027-07-01'],
    ['E-1401', '高压换热器', '压力容器', '2023-05-20', '2026-05-20'],
    ['T-1201', '常压塔', '压力容器', '2025-01-08', '2028-01-08'],
  ],
  '安全阀台账': [
    ['位号', '安装位置', '整定压力MPa', '上次校验日期', '下次校验日期'],
    ['SV-1101', '原油缓冲罐顶', '1.6', '2026-03-12', '2027-03-12'],
    ['SV-1102', '常压塔顶', '0.8', '2026-04-05', '2027-04-05'],
    ['SV-1103', '富气压缩机出口', '2.5', '2026-02-20', '2027-02-20'],
  ],
  '巡检记录': [
    ['日期', '位号', '巡检人', '结论'],
    ['2026-09-18', 'P-1101A', '张工', '运行平稳'],
    ['2026-09-18', 'V-2301', '张工', '液位正常'],
    ['2026-09-19', 'P-1101A', '李工', '运行平稳'],
    ['2026-09-19', 'E-1401', '李工', ''],
    ['2026-09-20', 'C-1501', '王工', '振动值偏高'],
    ['2026-09-20', 'F-1601', '王工', ''],
  ],
  '培训记录': [
    ['姓名', '培训项目', '培训日期', '考核结果'],
    ['张工', '特种设备作业', '2026-05-12', '通过'],
    ['李工', '特种设备作业', '2026-05-12', '通过'],
    ['王工', '受限空间作业', '2026-06-20', '通过'],
  ],
});

/* ---------------- 变体：合并单元格复杂表（需先请用户确认解析结果） ----------------
 * 「自查类别」列按大类跨行合并，标题跨列合并，共 8 处合并 → needConfirm = true
 */
const complexRows = [
  [`${pick(['某某', '某'])}炼化公司 安全生产大检查车间自查表（${no()}号）`],
  [],
  ['序号', '自查类别', '自查内容', '现状', '是否符合', '备注'],
  ['1', '设备设施', '是否建立设备台账', '', '', ''],
  ['2', '', '在用设备台数（台）', '', '', ''],
  ['3', '', '设备管理制度是否健全', '', '', ''],
  ['4', '特种设备', '压力容器是否超期未检', '', '', ''],
  ['5', '', '特种设备责任是否落实到位', '', '', ''],
  ['6', '人员管理', '培训是否取得实效', '', '', ''],
];
writeXlsxWithMerges(path.join(out, 'sample-form-merged.xlsx'), '自查表', complexRows, [
  'A1:F1', 'A2:F2', 'B4:B6', 'B7:B8', 'A9:A9', 'C1:D1', 'E1:F1', 'D2:E2',
]);

/* ---------------- 变体：全部为判断类的自查表（预填数必须为 0） ---------------- */
writeXlsx(path.join(out, 'sample-form-all-judgment.xlsx'), {
  '自查表': [
    ['序号', '自查内容', '现状', '备注'],
    ['1', '设备管理制度是否健全', '', ''],
    ['2', '隐患整改是否落实到位', '', ''],
    ['3', '岗位责任是否明确', '', ''],
    ['4', '人员培训是否有效', '', ''],
    ['5', '防范措施是否得当', '', ''],
    ['6', '本次自查总体评价', '', ''],
  ],
});

/* ---------------- 变体：台账为空表（客观项全部落入 noData） ---------------- */
writeXlsx(path.join(out, 'sample-ledger-empty.xlsx'), {
  '设备台账': [['位号', '设备名称', '投用日期']],
  '特种设备检验台账': [['位号', '设备名称', '下次检验日期']],
});

/* ---------------- 变体：带打分与结论列的自查表（得分/扣分/标准分/检查结论/自评 脚本绝不写） ----------------
 * 配主台账 + --period 2026-09-30 恒为：3 项，1 预填（台账有无）、1 预填（到期计数）、1 需判断；打分与结论列全部留空。
 */
writeXlsx(path.join(out, 'sample-form-scored.xlsx'), {
  '自查表': [
    [`${pick(['某某', '某'])}炼化公司 设备管理考核自查表（${no()}号）`],
    ['序号', '自查内容', '标准分', '现状', '是否符合', '得分', '扣分', '检查结论', '自评', '备注'],
    ['1', '是否建立车间设备台账', '10', '', '', '', '', '', '', ''],
    ['2', '压力容器是否在检验有效期内、有无超期', '20', '', '', '', '', '', '', ''],
    ['3', '设备管理制度是否健全', '10', '', '', '', '', '', '', ''],
  ],
});

console.log(JSON.stringify({ ok: true, out, seed, files: fs.readdirSync(out).filter((f) => /\.xlsx$/.test(f)).sort() }));

/* ------------------------------------------------------------------ 带合并单元格的 xlsx 写出
 * lib/xlsx-lite.js 的 writeXlsx 不写 <mergeCells>（它只负责值矩阵）。
 * 样例需要一份真带合并单元格的自查表来验证「结构复杂先确认」这条硬约束，
 * 故在此就地补一段最小实现：先用 writeXlsx 正常写出，再把 mergeCells 注入 sheet1.xml 后重新打包。
 */
function writeXlsxWithMerges(file, sheetName, rows, refs) {
  const zlib = require('zlib');
  writeXlsx(file, { [sheetName]: rows });
  const buf = fs.readFileSync(file);
  // 解包 → 改 sheet1.xml → 重新打包（复用 xlsx-lite 的 crc32）
  const { crc32 } = require('./lib/xlsx-lite');
  const entries = unzipAll(buf);
  const key = 'xl/worksheets/sheet1.xml';
  let xml = entries[key].toString('utf8');
  const mc = `<mergeCells count="${refs.length}">${refs.map((r) => `<mergeCell ref="${r}"/>`).join('')}</mergeCells>`;
  xml = xml.replace('</sheetData>', '</sheetData>' + mc);
  entries[key] = Buffer.from(xml, 'utf8');
  const files = Object.keys(entries).map((n) => ({ name: n, data: entries[n] }));
  fs.writeFileSync(file, zipAll(files, zlib, crc32));
}
function unzipAll(buf) {
  const zlib = require('zlib');
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = {};
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    const lnlen = buf.readUInt16LE(lho + 26), lelen = buf.readUInt16LE(lho + 28);
    const start = lho + 30 + lnlen + lelen;
    const data = buf.subarray(start, start + csize);
    out[name] = method === 8 ? zlib.inflateRawSync(data) : Buffer.from(data);
    p += 46 + nlen + elen + clen;
  }
  return out;
}
function zipAll(files, zlib, crc32) {
  const parts = [], central = [];
  let offset = 0;
  const d = new Date();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const data = f.data;
    const comp = zlib.deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(time, 10); lh.writeUInt16LE(date, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    parts.push(lh, name, comp);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0x0800, 8); cd.writeUInt16LE(8, 10);
    cd.writeUInt16LE(time, 12); cd.writeUInt16LE(date, 14); cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(data.length, 24); cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(0, 38); cd.writeUInt32LE(offset, 42);
    central.push(cd, name);
    offset += lh.length + name.length + comp.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cdBuf, eocd]);
}
