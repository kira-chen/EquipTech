'use strict';
// 用法：node tools/make-list.js               校验全部发布包，并生成 技能清单.xlsx / 技能清单.md
//       node tools/make-list.js --check <名>   只校验一个发布包
//       node tools/make-list.js --deps         逐行输出依赖技能「英文名 主脚本」，供 package.sh 查找
// 技能信息读自各技能的 上架信息.md，产物写入 dist/设备员-发布包/
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// 两个 bridge 技能依赖的技能不在本仓库，上架时随发布包一起上传（D008）
const DEPS = [
  { name: 'work-permit-precheck', script: 'precheck.js', cn: '特殊作业票预检', bridge: 'permit-precheck-bridge' },
  { name: 'overhaul-safety-check', script: 'check.js', cn: '检修方案安全措施核查', bridge: 'overhaul-process-check-bridge' },
];
if (process.argv[2] === '--deps') {
  DEPS.forEach((d) => console.log(`${d.name} ${d.script}`));
  process.exit(0);
}

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'dist', '设备员-发布包');
const base = path.join(root, '设备员skill');
const checkOnly = process.argv[2] === '--check' ? process.argv[3] : null;
if (process.argv[2] === '--check' && !checkOnly) throw new Error('--check 缺少技能英文名');
fs.mkdirSync(out, { recursive: true });

// 校验 zip 根目录名 = 技能英文名，含 SKILL.md，且不含开发与上架用文件
function checkZip(name, zip) {
  if (!fs.existsSync(zip)) throw new Error(`缺少发布包 ${zip}`);
  const list = execFileSync('unzip', ['-Z1', zip]).toString('latin1').split('\n').filter(Boolean);
  if (!list.includes(`${name}/SKILL.md`)) throw new Error(`${name}.zip 根目录不是 ${name}/ 或缺 SKILL.md`);
  const bad = list.filter((f) => /\/examples\/|\/(selftest|make-sample|make-demo|run-examples|make-sample-docx)\.js$|[^\x20-\x7e]/.test(f));
  if (bad.length) throw new Error(`${name}.zip 含不应发布的文件：${bad[0]}`);
}

if (checkOnly) {
  checkZip(checkOnly, path.join(out, `${checkOnly}.zip`));
  console.log(JSON.stringify({ ok: true, checked: checkOnly }));
  process.exit(0);
}

const cats = fs.readdirSync(base).filter((d) => /^0\d-/.test(d)).sort();
const rows = [];
for (const cat of cats) {
  const skills = fs.readdirSync(path.join(base, cat)).filter((d) => fs.existsSync(path.join(base, cat, d, 'SKILL.md'))).sort();
  for (const name of skills) {
    const dir = path.join(base, cat, name);
    const skillMd = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8');
    const fmName = (skillMd.match(/^name:\s*(\S+)/m) || [])[1];
    if (fmName !== name) throw new Error(`SKILL.md name「${fmName}」与目录「${name}」不一致`);
    const s = fs.readFileSync(path.join(dir, '上架信息.md'), 'utf8');
    const cn = ((s.match(/\*\*技能名称\*\*[：:]\s*(.+)/) || [])[1] || '').trim();
    const brief = ((s.match(/\*\*技能简介\*\*[：:]\s*(.+)/) || [])[1] || '').trim();
    const desc = ((s.split('**技能描述**')[1] || '').split('**示例问题**')[0] || '').trim().replace(/\s*\n\s*/g, '');
    const qsRaw = (s.split('**示例问题**')[1] || '').split('\n').filter((l) => /^\s*\d+\.\s/.test(l));
    const qs = qsRaw.map((l) => {
      const m = l.match(/^\s*(\d+)\.\s*(.*?)\s*(?:\*\*附件：\*\*\s*(.*))?$/);
      const q = m[2].replace(/[\s　]+$/, '').trim();
      const att = (m[3] || '').replace(/`/g, '').trim();
      return { no: +m[1], q, att };
    });
    if (!cn || !brief || !desc || qs.length !== 5) throw new Error(`${name} 上架信息解析不完整（名称/简介/描述/5 题）`);
    const zip = path.join(out, `${name}.zip`);
    checkZip(name, zip);
    rows.push({ cat: cat.replace(/^\d\d-/, ''), catNo: cat.slice(0, 2), name, cn, brief, desc, qs, size: fs.statSync(zip).size });
  }
}

// 依赖技能：发布包目录里有 zip 即为已打包（package.sh 全量打包前会先清掉旧的依赖包）
const deps = DEPS.map((d) => {
  const zip = path.join(out, `${d.name}.zip`);
  const packed = fs.existsSync(zip);
  if (packed) checkZip(d.name, zip);
  const bridge = rows.find((r) => r.name === d.bridge);
  return { ...d, packed, size: packed ? fs.statSync(zip).size : null, bridgeCn: bridge ? bridge.cn : d.bridge };
});
const note = (r) => {
  const d = deps.find((x) => x.bridge === r.name);
  if (!d) return '';
  return `须同时上传 ${d.name}.zip${d.packed ? '' : '（本次未打包，上架包不完整）'}`;
};
const missing = deps.filter((d) => !d.packed);

// ---------------- 技能清单.md
const esc = (t) => String(t).replace(/\|/g, '\\|');
const md = [];
md.push('# 设备员技能包清单');
md.push('');
md.push(`共 ${rows.length} 个技能，每个技能一个 zip，文件名即技能英文名。示例问题的附件在 演示case/<分类>/<技能英文名>/ 下，发布包不含。`);
md.push('');
md.push(`另有 ${deps.length} 个依赖技能的发布包须一并上传，见文末「随包上传的依赖技能」。`
  + (missing.length ? `**本次未打包：${missing.map((d) => d.name).join('、')}，上架包不完整。**` : ''));
md.push('');
md.push('| 序号 | 分类 | 技能英文名 | 技能中文名 | 技能中文描述 | 示例问题 | 上传说明 |');
md.push('|---|---|---|---|---|---|---|');
rows.forEach((r, i) => {
  md.push(`| ${i + 1} | ${esc(r.cat)} | \`${r.name}\` | ${esc(r.cn)} | ${esc(r.desc)} | ${r.qs.map((x) => `${x.no}. ${esc(x.q)}`).join('<br>')} | ${esc(note(r))} |`);
});
md.push('');
md.push('## 随包上传的依赖技能');
md.push('');
md.push('这两个技能不在设备员技能包内，是两个 bridge 技能的依赖，上传时须与 50 个技能包一起上传、装在同一个技能目录下。');
md.push('');
md.push('| 序号 | 技能英文名 | 技能中文名 | 被依赖的技能 | 压缩包 | 大小（KB） | 状态 |');
md.push('|---|---|---|---|---|---|---|');
deps.forEach((d, i) => {
  md.push(`| ${i + 1} | \`${d.name}\` | ${esc(d.cn)} | \`${d.bridge}\`（${esc(d.bridgeCn)}） | ${d.name}.zip | ${d.packed ? Math.round(d.size / 102.4) / 10 : '—'} | ${d.packed ? '已打包' : '未打包'} |`);
});
md.push('');
fs.writeFileSync(path.join(out, '技能清单.md'), md.join('\n'), 'utf8');

// ---------------- 技能清单.xlsx（自写 OOXML：表头加粗底色、自动换行、列宽、冻结首行、筛选）
const x = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const col = (i) => { let s = ''; i += 1; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
function sheet(header, data, widths) {
  const r = [];
  r.push(`<row r="1">${header.map((h, j) => `<c r="${col(j)}1" t="inlineStr" s="1"><is><t>${x(h)}</t></is></c>`).join('')}</row>`);
  data.forEach((rowv, i) => {
    const n = i + 2;
    r.push(`<row r="${n}">${rowv.map((v, j) => (typeof v === 'number'
      ? `<c r="${col(j)}${n}" s="3"><v>${v}</v></c>`
      : `<c r="${col(j)}${n}" t="inlineStr" s="2"><is><t xml:space="preserve">${x(v)}</t></is></c>`)).join('')}</row>`);
  });
  const last = `${col(header.length - 1)}${data.length + 1}`;
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    + `<cols>${widths.map((w, j) => `<col min="${j + 1}" max="${j + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
    + `<sheetData>${r.join('')}</sheetData>`
    + `<autoFilter ref="A1:${last}"/>`
    + '</worksheet>';
}
const s1 = sheet(
  ['序号', '分类', '技能英文名', '技能中文名', '技能简介', '技能中文描述', '示例问题', '上传说明'],
  rows.map((r, i) => [i + 1, r.cat, r.name, r.cn, r.brief, r.desc, r.qs.map((q) => `${q.no}. ${q.q}`).join('\n'), note(r)]),
  [6, 16, 32, 22, 45, 70, 80, 30],
);
const qRows = [];
rows.forEach((r, i) => r.qs.forEach((q) => qRows.push([i + 1, r.name, r.cn, q.no, q.q, q.att || '无'])));
const s2 = sheet(['技能序号', '技能英文名', '技能中文名', '题号', '示例问题', '演示附件（演示case/<分类>/<技能英文名>/ 下，发布包不含）'], qRows, [8, 32, 22, 6, 80, 60]);
const s3 = sheet(['序号', '压缩包文件名', '技能中文名', '大小（KB）'], rows.map((r, i) => [i + 1, `${r.name}.zip`, r.cn, Math.round(r.size / 102.4) / 10]), [6, 40, 24, 12]);
const s4 = sheet(['序号', '技能英文名', '技能中文名', '被依赖的技能', '压缩包文件名', '大小（KB）', '状态'],
  deps.map((d, i) => [i + 1, d.name, d.cn, `${d.bridge}（${d.bridgeCn}）`, `${d.name}.zip`, d.packed ? Math.round(d.size / 102.4) / 10 : '—',
    d.packed ? '已打包，须与 50 个技能包一起上传' : '未打包，上架包不完整']),
  [6, 28, 22, 44, 32, 12, 30]);

const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<fonts count="2"><font><sz val="11"/><name val="等线"/></font><font><b/><sz val="11"/><name val="等线"/></font></fonts>'
  + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFDDEBF7"/><bgColor indexed="64"/></patternFill></fill></fills>'
  + '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>'
  + '<border><left style="thin"><color rgb="FFBFBFBF"/></left><right style="thin"><color rgb="FFBFBFBF"/></right><top style="thin"><color rgb="FFBFBFBF"/></top><bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="4">'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
  + '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf>'
  + '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
const names = ['技能清单', '示例问题与附件', '压缩包清单', '随包上传的依赖技能'];
const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'xlsx-'));
const put = (p, d) => { fs.mkdirSync(path.dirname(path.join(tmp, p)), { recursive: true }); fs.writeFileSync(path.join(tmp, p), d, 'utf8'); };
put('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
  + names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') + '</Types>');
put('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
put('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
  + names.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets>'
  + '</workbook>');
put('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
  + `<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
put('xl/styles.xml', styles);
[s1, s2, s3, s4].forEach((d, i) => put(`xl/worksheets/sheet${i + 1}.xml`, d));
const xlsx = path.join(out, '技能清单.xlsx');
try { fs.unlinkSync(xlsx); } catch (e) {}
execFileSync('zip', ['-X', '-r', '-q', xlsx, '[Content_Types].xml', '_rels', 'xl'], { cwd: tmp });
fs.rmSync(tmp, { recursive: true, force: true });

console.log(JSON.stringify({ ok: true, skills: rows.length, questions: qRows.length, deps: deps.map((d) => ({ name: d.name, packed: d.packed })), out }));
