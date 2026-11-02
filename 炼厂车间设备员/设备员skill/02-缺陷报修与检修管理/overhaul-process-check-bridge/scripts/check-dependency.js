#!/usr/bin/env node
'use strict';
/**
 * 依赖技能可用性检查（仅 Node.js 内置模块）
 * 用法：node scripts/check-dependency.js [--skill-root <被依赖技能根目录>] [--out <dir>]
 * 作用：确认 overhaul-safety-check 是否可调用。**不可用时本 bridge 技能必须终止，不得自行判定方案安全措施是否齐全。**
 * 产出：末行 JSON {"ok":true,"available":bool,"root":"…","script":"…","docx2text":"…","searched":[...],"platformNote":"…"}
 *
 * 路径来源（按优先级）：
 *   1. --skill-root（权威指定，只查这一个路径）
 *   2. 环境变量 SKILL_PACK_ROOT（技能包根目录，WorkBuddy / 豆包 / Claude Code 任一平台都可用它指定）
 *   3. 平台默认技能目录：~/.workbuddy/skills、~/.claude/skills、~/.doubao/skills（豆包路径以平台实际为准）
 *   4. 本技能所在 skill-pack 根目录下：<skill-pack>/【炼化】检修方案安全措施核查/<dep>、<skill-pack>/<dep>，
 *      以及 skill-pack 下任一一级子目录中的 <dep>（目录名带全角括号【】被改名/转码时仍能命中）
 */
const fs = require('fs');
const path = require('path');
const C = require('./lib/common');

const VALUE_OPTS = ['skill-root', 'out'];
const FLAG_OPTS = ['help'];
const DEP_NAME = 'overhaul-safety-check';
const DEP_SCRIPT = 'check.js';
const DEP_PACK_DIR = '【炼化】检修方案安全措施核查';
const DEP_CN = '检修方案安全措施核查';

const PLATFORM_NOTE = '技能目录由平台决定：WorkBuddy 默认 ~/.workbuddy/skills，Claude Code 默认 ~/.claude/skills，豆包以平台实际加载目录为准；'
  + '任一平台都可用环境变量 SKILL_PACK_ROOT 指向技能包根目录，或用 --skill-root 直接指定依赖技能目录。'
  + '目录名含全角括号【】时在 shell 里须加引号，路径被平台转码/改名时脚本会扫描 skill-pack 一级子目录兜底。';

/** 候选搜索路径；显式 --skill-root 时只查这一个路径，不回退 */
function candidates(explicit) {
  if (explicit) return [explicit];
  const list = [];
  const packRoot = process.env.SKILL_PACK_ROOT;
  if (packRoot) {
    list.push(path.join(packRoot, DEP_PACK_DIR, DEP_NAME));
    list.push(path.join(packRoot, DEP_NAME));
    list.push(...scanOneLevel(packRoot));
  }
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (home) {
    list.push(path.join(home, '.workbuddy', 'skills', DEP_NAME));
    list.push(path.join(home, '.claude', 'skills', DEP_NAME));
    list.push(path.join(home, '.doubao', 'skills', DEP_NAME));
  }
  // 本技能位于 <仓库根>/炼厂车间设备员/设备员skill/<二级>/<技能>/scripts，回溯到仓库根后进入 skill-pack-local
  const skillPack = path.resolve(__dirname, '..', '..', '..', '..', '..', 'skill-pack-local');
  list.push(path.join(skillPack, DEP_PACK_DIR, DEP_NAME));
  list.push(path.join(skillPack, DEP_NAME));
  list.push(...scanOneLevel(skillPack));
  const seen = new Set();
  return list.filter((p) => (seen.has(p) ? false : (seen.add(p), true)));
}

/** 扫描 root 下一级子目录中的 <dep>/（兼容全角括号目录被改名的情况），只返回实际存在的 */
function scanOneLevel(root) {
  const out = [];
  let ents = [];
  try { ents = fs.readdirSync(root, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of ents) {
    if (!e.isDirectory()) continue;
    const p = path.join(root, e.name, DEP_NAME);
    if (fs.existsSync(path.join(p, 'scripts', DEP_SCRIPT))) out.push(p);
  }
  return out;
}

function main() {
  const a = C.parseArgs(process.argv.slice(2), VALUE_OPTS, FLAG_OPTS);
  const searched = candidates(a['skill-root']);
  let found = null;
  for (const root of searched) {
    const s = path.join(root, 'scripts', DEP_SCRIPT);
    if (fs.existsSync(s)) { found = { root, script: s }; break; }
  }
  const docx2text = found && fs.existsSync(path.join(found.root, 'scripts', 'docx2text.js')) ? path.join(found.root, 'scripts', 'docx2text.js') : null;
  const summary = {
    ok: true, dependency: DEP_NAME, available: !!found,
    root: found ? found.root : null, script: found ? found.script : null,
    docx2text,
    searched,
    envSkillPackRoot: process.env.SKILL_PACK_ROOT || null,
    platformNote: PLATFORM_NOTE,
    note: found
      ? '依赖技能可用，请按其 SKILL.md 的操作步骤执行核查，读取其 result.json，再用本技能 merge-report.js 转达；不得改写任何判定项'
      : `未找到依赖技能 ${DEP_NAME}。**必须告知用户「需先安装${DEP_CN}技能」并终止，不得用本技能自行判定方案安全措施是否齐全。**`,
  };
  if (a.out) {
    C.ensureDir(a.out);
    fs.writeFileSync(path.join(a.out, 'dependency.json'), JSON.stringify(summary, null, 2), 'utf8');
  }
  console.log(JSON.stringify(summary));
}

try { main(); } catch (e) { C.fail(e, []); }
