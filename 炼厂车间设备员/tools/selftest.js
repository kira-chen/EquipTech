#!/usr/bin/env node
'use strict';
/**
 * 设备员技能自测入口：按用例级别并行运行各技能的 scripts/selftest.js，汇总断言数与失败项。
 * 用法：node tools/selftest.js [--level BVT|A|B|C] [--skill <英文名>]... [--jobs N] [--failed-out <文件>]
 *   --level       只跑该级及更高优先级的用例，默认 C（全量）。分级见 文档/规范/自测用例分级规范.md
 *   --skill       只跑指定技能，可重复传；不传时跑全部技能
 *   --jobs        并行数，默认 CPU 核数
 *   --failed-out  把失败技能的英文名逐行写入该文件，供 package.sh 跳过打包
 * 退出码：全部通过 0；有失败 1；参数错误 2。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.dirname(__dirname);
const BASE = path.join(ROOT, '设备员skill');
const LEVELS = ['BVT', 'A', 'B', 'C'];

function die(msg) { console.error(msg); process.exit(2); }
const opt = { level: 'C', skills: [], jobs: os.cpus().length, failedOut: null };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const val = () => { if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) die(`${a} 缺少取值`); return argv[++i]; };
  if (a === '--level') opt.level = val().toUpperCase();
  else if (a === '--skill') opt.skills.push(val());
  else if (a === '--jobs') opt.jobs = Number(val());
  else if (a === '--failed-out') opt.failedOut = val();
  else if (a === '-h' || a === '--help') { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(3, 10).map((l) => l.replace(/^ \* ?/, '')).join('\n')); process.exit(0); }
  else die(`未知参数 ${a}`);
}
if (!LEVELS.includes(opt.level)) die(`--level 只能取 ${LEVELS.join('、')}`);
if (!Number.isInteger(opt.jobs) || opt.jobs < 1) die('--jobs 须为正整数');

const all = [];
for (const cat of fs.readdirSync(BASE).sort()) {
  const cdir = path.join(BASE, cat);
  if (!fs.statSync(cdir).isDirectory()) continue;
  for (const name of fs.readdirSync(cdir).sort()) {
    if (fs.existsSync(path.join(cdir, name, 'SKILL.md'))) all.push({ name, dir: path.join(cdir, name) });
  }
}
let targets = all;
if (opt.skills.length) {
  targets = opt.skills.map((n) => all.find((s) => s.name === n) || die(`找不到技能 ${n}`));
}

function runOne(s) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const file = path.join(s.dir, 'scripts', 'selftest.js');
    if (!fs.existsSync(file)) return resolve({ ...s, code: null, out: '缺少 scripts/selftest.js', ms: 0 });
    const p = spawn(process.execPath, [file], { env: { ...process.env, SELFTEST_LEVEL: opt.level } });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('close', (code) => resolve({ ...s, code, out, ms: Date.now() - t0 }));
  });
}

(async () => {
  const t0 = Date.now();
  const results = [];
  let next = 0;
  const worker = async () => {
    while (next < targets.length) {
      const s = targets[next++];
      const r = await runOne(s);
      const m = r.out.match(/自测：(\d+) 通过，(\d+) 失败/);
      const l = r.out.match(/用例级别 \w+：BVT (\d+)，A (\d+)，B (\d+)，C (\d+)/);
      r.pass = m ? Number(m[1]) : 0;
      r.ok = r.code === 0 && !!m && Number(m[2]) === 0;
      r.by = l ? { BVT: +l[1], A: +l[2], B: +l[3], C: +l[4] } : null;
      results.push(r);
      console.log(`${r.ok ? '✓' : '✗'} ${r.name}  ${r.pass} 条  ${(r.ms / 1000).toFixed(1)}s${r.by ? '' : '  （未分级）'}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(opt.jobs, targets.length) }, worker));

  const failed = results.filter((r) => !r.ok).sort((a, b) => a.name.localeCompare(b.name));
  for (const r of failed) {
    console.log(`\n—— 失败：${r.name}（退出码 ${r.code}）`);
    const lines = r.out.trim().split('\n');
    const i = lines.findIndex((x) => x.includes('失败项'));
    console.log((i >= 0 ? lines.slice(i) : lines.slice(-12)).join('\n'));
  }
  const total = results.reduce((s, r) => s + (r.ok ? r.pass : 0), 0);
  const by = { BVT: 0, A: 0, B: 0, C: 0 };
  for (const r of results) if (r.ok && r.by) for (const k of LEVELS) by[k] += r.by[k];
  const unTiered = results.filter((r) => !r.by).map((r) => r.name);
  console.log(`\n用例级别 ${opt.level}：${targets.length} 个技能，通过 ${targets.length - failed.length} 个，失败 ${failed.length} 个；耗时 ${((Date.now() - t0) / 1000).toFixed(1)} 秒（并行 ${opt.jobs}）。`);
  console.log(`分级断言：BVT ${by.BVT}，A ${by.A}，B ${by.B}，C ${by.C}。`);
  if (unTiered.length) console.log(`未分级：${unTiered.join('、')}。`);
  console.log(`自测断言通过：${total} 条。`);
  if (opt.failedOut) fs.writeFileSync(opt.failedOut, failed.map((r) => r.name).join('\n') + (failed.length ? '\n' : ''));
  process.exit(failed.length ? 1 : 0);
})();
