// 生成设备员技能图标，三种风格各一套：素材/图标/<风格>/<分类>/<技能名>.svg、.png（128×128）和预览.html
// 字形定义在 素材/脚本/icons/0N.js，公共部件在 素材/脚本/icons/lib.js。PNG 用本机 Chrome 无头模式导出，找不到 Chrome 时只出 SVG。
// 用法：node 素材/脚本/make-icons.js [--only 02,03] [--style A,C,D] [--out 目录] [--sheet 对比图.png]
//   --only   只生成指定分类（此时不更新总览页）
//   --style  只生成指定风格
//   --sheet  另存一张 A/C/D 并排的对比截图，方便检查
const fs = require('fs'), os = require('os'), path = require('path'), { execFile } = require('child_process');
const { plateDefs, plateFlat, plate3d, materialDefs } = require('./icons/lib');
const arg = n => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : undefined; };
const root = arg('out') || path.join(__dirname, '../图标');
const only = arg('only') && arg('only').split(',');
const SIZE = 128;
const STYLES = {
  A: { dir:'A-扁平', key:'flat', svg:(n, d, g) => `<defs>${plateDefs(n, d.c)}\n  </defs>${plateFlat(n)}${g}` },
  C: { dir:'C-块面', key:'solid', svg:(n, d, g) => `<defs>${plateDefs(n, d.c)}${materialDefs}\n  </defs>${plate3d(n, d.c)}\n  <g transform="translate(0 -6)" filter="url(#ds)">${g}\n  </g>` },
  D: { dir:'D-拟物', key:'real', svg:(n, d, g) => `<defs>${plateDefs(n, d.c)}${materialDefs}\n  </defs>${plate3d(n, d.c)}\n  <g transform="translate(0 -6)">${g}\n  </g>` },
};
const styles = (arg('style') || 'A,C,D').split(',');
const groups = fs.readdirSync(path.join(__dirname, 'icons')).filter(f => /^0\d\.js$/.test(f)).sort()
  .map(f => require('./icons/' + f)).filter(g => !only || only.includes(g.name.slice(0, 2)));

const chrome = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', process.env.CHROME].find(p => p && fs.existsSync(p));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'icons-'));
let seq = 0;
const shot = (src, png, w, h) => new Promise((ok, fail) => execFile(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars',
  `--user-data-dir=${path.join(tmp, 'p' + seq++)}`, '--default-background-color=00000000', `--window-size=${w},${h}`,
  `--screenshot=${png}`, 'file://' + path.resolve(src)], err => err ? fail(err) : ok()));
const pool = async (jobs, n = 6) => { const run = async () => { while (jobs.length) await jobs.shift()(); }; await Promise.all(Array.from({ length: n }, run)); };

const style = `<style>body{font-family:-apple-system,"PingFang SC",sans-serif;background:#f4f5f7;margin:0;padding:32px}
main{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:28px;margin-bottom:40px}
figure{margin:0;text-align:center}img{width:128px;height:128px;filter:drop-shadow(0 6px 14px rgba(0,0,0,.15))}
figcaption{margin-top:10px;font-size:14px}figcaption span{display:block;color:#888;font-size:12px;margin-top:4px}</style>`;
const page = (title, body) => `<!doctype html><meta charset="utf-8"><title>${title}</title>\n${style}\n${body}`;
const fig = (src, d, name) => `<figure><img src="${src}"><figcaption><b>${d.cn}</b><span>${name}</span></figcaption></figure>\n`;

const jobs = [], missing = [];
let n = 0;
for (const s of styles) {
  const st = STYLES[s];
  let all = '';
  for (const { name: cat, icons } of groups) {
    const out = path.join(root, st.dir, cat);
    fs.mkdirSync(out, { recursive: true });
    let cards = '', allCards = '';
    for (const [name, d] of Object.entries(icons)) {
      const g = d[st.key];
      if (!g) { missing.push(`${st.dir}/${name}`); continue; }
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${SIZE}" height="${SIZE}">
  ${st.svg(name, d, typeof g === 'function' ? g(d.c[1]) : g)}
</svg>
`;
      const file = path.join(out, name + '.svg');
      fs.writeFileSync(file, svg);
      if (chrome) jobs.push(() => shot(file, path.join(out, name + '.png'), SIZE, SIZE));
      cards += fig(name + '.svg', d, name);
      allCards += fig(`${cat}/${name}.svg`, d, name);
      n++;
    }
    fs.writeFileSync(path.join(out, '预览.html'), page(`${cat.slice(0, 2)} 类技能图标（${st.dir}）`, `<h2>${cat}</h2><main>${cards}</main>`));
    all += `<h2>${cat}</h2><main>${allCards}</main>\n`;
  }
  if (!only) fs.writeFileSync(path.join(root, st.dir, '预览.html'), page(`设备员技能图标（${st.dir}）`, all));
}

// A/C/D 并排对比页
const head = `<tr><th></th>${Object.values(STYLES).map(st => `<td class="h">${st.dir}</td>`).join('')}</tr>`;
const compare = (prefix, big) => groups.map(({ name: cat, icons }) => `<h2>${cat}</h2><table>${head}` + Object.entries(icons).map(([name, d]) =>
  `<tr><th>${d.cn}<span>${name}</span></th>` + Object.values(STYLES).map(st =>
    `<td>${d[st.key] ? `<img src="${prefix}${st.dir}/${cat}/${name}.svg"${big ? ' class="big"' : ''}>` : '—'}</td>`).join('') + '</tr>').join('\n') + '</table>').join('\n');
const cmpStyle = `<style>body{font-family:-apple-system,"PingFang SC",sans-serif;background:#f4f5f7;margin:0;padding:24px}
table{border-spacing:20px 10px}th{text-align:left;font-size:14px;width:170px}th span{display:block;color:#888;font-size:11px;font-weight:normal}
td{text-align:center}td.h{font-weight:bold;font-size:14px}
img{width:128px;height:128px}img.big{width:200px;height:200px}h2{margin:16px 0 0}</style>`;
if (!only) fs.writeFileSync(path.join(root, '对比.html'), `<!doctype html><meta charset="utf-8"><title>图标风格对比</title>\n${cmpStyle}\n${compare('', false)}`);

(async () => {
  await pool(jobs);
  const sheet = arg('sheet');
  if (sheet && chrome) {
    const html = path.join(tmp, 'sheet.html'), rows = groups.reduce((a, g) => a + Object.keys(g.icons).length, 0);
    fs.writeFileSync(html, `<!doctype html><meta charset="utf-8">\n${cmpStyle}\n${compare('file://' + path.resolve(root) + '/', true)}`);
    await shot(html, path.resolve(sheet), 1000, 90 + rows * 222 + groups.length * 100);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('ok', n, chrome ? 'svg+png' : 'svg（未找到 Chrome，未导出 PNG）');
  if (missing.length) console.log('未定义字形', missing.length, '个：', missing.join(' '));
})();
