#!/usr/bin/env node
'use strict';
/**
 * 检修完工验收清单生成脚本（仅 Node.js 内置模块）
 * 用法：node "<技能目录>/scripts/acceptance.js" --tag "<位号>" --equip-type "<设备类型>" --scope "<检修内容>" \
 *       --contractor "<承修单位>" --out "<输出目录>"
 * 可选：--plan <检修方案(docx/txt/md/xlsx/csv目录)> --records <验收记录xlsx> --pressure-test --trial-run --special-equipment
 *       --repair-type <大检修|日常维修|抢修|专项>（旧值 大修/中修/小修 自动映射并 warning）
 *       --name <设备名称> --workshop <车间> --finished-at <完工时间> --no <验收单编号>
 * 产出：<out>/acceptance.json、acceptance.md、summary.json；末行打印 JSON 摘要
 *
 * 硬约束：验收项 result 恒为 null（验收结论由验收组填写）；设备类型不覆盖时只出通用框架并 warning；
 *        提供 --plan 时方案质量控制点必须逐条比对，缺口列入 qcGap；签字栏按三级验收（班组/车间/公司设备部门）+ 工艺 + 承修单位，无监理。
 */
const fs = require('fs');
const path = require('path');
const { readXlsx, readCsvDir } = require('./lib/xlsx-lite');
const C = require('./lib/common');
const R = require('./lib/rules');
const lite = require('./lib/docx-lite');

const warnings = [];
const VALUE_OPTS = ['tag', 'equip-type', 'scope', 'contractor', 'out', 'plan', 'records',
  'name', 'workshop', 'finished-at', 'no', 'repair-type'];
const FLAG_OPTS = ['pressure-test', 'trial-run', 'special-equipment', 'help'];

const DECLARATION = '本清单为辅助核对工具，验收结论须由验收组现场确认并签字；未完成签字前设备不得投用。';

// 检修分级（中石化口径）：只写入验收概况与签字栏说明，不改变验收项规则
const REPAIR_TYPES = ['大检修', '日常维修', '抢修', '专项'];
const REPAIR_TYPE_ALIAS = { '大修': '大检修', '装置大检修': '大检修', '停工检修': '大检修', '中修': '日常维修', '小修': '日常维修', '技改': '专项', '技改技措': '专项', '专项检修': '专项' };

// 验收记录列名：局部别名优先，再并入共享系统别名（EM 检修验收记录 / SAP 导出常见列名由共享表提供）
const ALIASES = C.mergeAliases({
  '序号': ['序号', '编号', 'NO', 'No', 'no'],
  '验收项': ['验收项', '验收内容', '验收项目', '检查项', '项目', '内容'],
  '验收结果': ['验收结果', '结果', '结论', '判定', '验收结论', '验收情况'],
  '备注': ['备注', '说明', '问题描述', '不合格描述', '存在问题'],
  '质量控制点': ['质量控制点', '控制点', '质量要求', 'QC点'],
});

// 结果归一：只认明确写法，写不明白的一律「未判定」，不猜
const UNQUALIFIED = /不合格|未通过|不通过|不符合|整改|返工|NG|不达标/i;
const QUALIFIED = /^(合格|通过|符合|OK|√|是|已完成)$|^合格[（(]/i;
function normResult(v) {
  const s = C.str(v);
  if (s === '') return null;
  if (UNQUALIFIED.test(s)) return '不合格';
  if (QUALIFIED.test(s)) return '合格';
  return '未判定';
}

function loadBook(p) { return fs.statSync(p).isDirectory() ? readCsvDir(p) : readXlsx(p); }

/** 读检修方案为纯文本：txt/md 直接读；docx 用 docx-lite 抽文本；xlsx/csv 目录把全部单元格按行拼成文本 */
function readPlanText(p) {
  const st = fs.statSync(p);
  const ext = path.extname(p).toLowerCase();
  if (!st.isDirectory() && ['.txt', '.md', '.csv'].includes(ext)) {
    return fs.readFileSync(p, 'utf8');
  }
  if (ext === '.docx') {
    const res = lite.docxToText(fs.readFileSync(p));
    // 表格行以 | 分隔，拆成单元格再按行拼回，便于按行识别质量控制点
    return String(res.text || '').split(/\r?\n/).map((l) => l.replace(/\s*\|\s*/g, ' ').replace(/[‹›〃]/g, ' ').trim()).join('\n');
  }
  if (ext === '.doc') {
    throw new Error('检修方案为 .doc（旧版 Word）格式，本脚本只解析 .docx；请另存为 .docx/.txt 后重试');
  }
  if (ext === '.pdf') {
    throw new Error('检修方案为 PDF，脚本不读 PDF；请先用平台 pdf 技能转为 txt/docx 再传入（扫描件需 OCR）');
  }
  const book = loadBook(p);
  const L = [];
  for (const [sheet, rows] of Object.entries(book)) {
    L.push(`# ${sheet}`);
    for (const r of rows) L.push((r || []).map((c) => C.str(c)).filter(Boolean).join(' '));
  }
  return L.join('\n');
}

function main() {
  const a = C.parseArgs(process.argv.slice(2), VALUE_OPTS, FLAG_OPTS);
  if (!a.tag) throw new Error('缺少 --tag（设备位号）');
  if (!a['equip-type']) throw new Error('缺少 --equip-type（设备类型）');
  if (!a.scope) throw new Error('缺少 --scope（检修内容）');
  if (!a.contractor) throw new Error('缺少 --contractor（承修单位）');

  let finishedAt = null;
  if (a['finished-at']) {
    finishedAt = C.normDateTime(a['finished-at']);
    if (!finishedAt) throw new Error(`--finished-at 「${a['finished-at']}」不是有效时间，应为 YYYY-MM-DD 或 ISO 8601（如 2026-09-21T16:00:00+08:00）`);
  }

  // 检修分级：不传为 null（不默认）；旧值映射并 warning；非法值报错
  let repairType = null, repairTypeRaw = null;
  if (a['repair-type'] !== undefined) {
    repairTypeRaw = C.str(a['repair-type']);
    if (REPAIR_TYPES.includes(repairTypeRaw)) repairType = repairTypeRaw;
    else if (REPAIR_TYPE_ALIAS[repairTypeRaw]) {
      repairType = REPAIR_TYPE_ALIAS[repairTypeRaw];
      warnings.push(`--repair-type「${repairTypeRaw}」为旧口径，已按中石化检修分级映射为「${repairType}」（大修→大检修，中修/小修→日常维修）`);
    } else throw new Error(`--repair-type 只能是 ${REPAIR_TYPES.join(' / ')}（旧值 大修/中修/小修 可自动映射），收到「${repairTypeRaw}」`);
  } else {
    warnings.push('未指定 --repair-type（大检修 / 日常维修 / 抢修 / 专项），验收概况中检修分级显示「—」，公司设备部门是否参加验收按厂内规定确定');
  }

  const outDir = a.out || path.join(require('os').tmpdir(), 'ca-out');
  const opts = {
    equipType: a['equip-type'],
    scope: a.scope,
    pressureTest: !!a['pressure-test'],
    trialRun: !!a['trial-run'],
    specialEquipment: !!a['special-equipment'],
  };

  // ---- 1. 生成验收项
  const built = R.buildItems(opts);
  const items = built.items;
  if (!built.typeCovered) {
    warnings.push(`设备类型「${a['equip-type']}」不在规则库覆盖范围内（已覆盖：${Object.values(R.TYPE_CN).join('、')}），`
      + `仅输出通用验收框架，专用技术指标标注「${R.TBD}」，须由技术人员按设备技术文件补充，不得凭经验填写数值`);
  }
  const activeFlags = Object.keys(built.flags).filter((k) => built.flags[k]);
  if (!activeFlags.length) {
    warnings.push(`检修内容「${a.scope}」未识别出解体、更换、焊接、清洗、防腐保温、对中、电气等特征，`
      + `条件性验收项可能不全，请核对检修内容描述是否完整`);
  }
  if (!opts.pressureTest) warnings.push('未指定 --pressure-test，未生成试压/气密相关验收项；若本次检修需试压请加该参数重跑');
  if (!opts.trialRun) warnings.push('未指定 --trial-run，未生成试运（试车）相关验收项；若本次检修需试运请加该参数重跑');
  if (built.typeKey === 'compressor') warnings.push('压缩机/机组多属特护设备，验收由公司设备部门牵头，联锁试验由仪表/电气执行；本清单只列车间侧核对项');

  // ---- 2. 应附资料清单
  const requiredRecords = R.buildRecords(built.flags, { ...opts, typeKey: built.typeKey });

  // ---- 3. 方案质量控制点比对
  let qcPoints = null, qcMatched = null, qcGap = null;
  if (a.plan) {
    if (!fs.existsSync(a.plan)) throw new Error(`检修方案不存在: ${a.plan}`);
    let text;
    try { text = readPlanText(a.plan); } catch (e) { throw new Error(`检修方案读取失败: ${e.message}`); }
    qcPoints = R.extractQcPoints(text);
    if (!qcPoints.length) {
      warnings.push(`检修方案「${path.basename(a.plan)}」中未识别出质量控制点条目（未匹配到「质量控制点/控制点/见证点/停止点」等关键词），无法比对，请人工核对方案质量控制点是否都有对应验收项`);
      qcMatched = null; qcGap = null;   // 没识别出控制点就没做比对：缺口未知，不写成 0（空数组）
    } else {
      const m = R.matchQcPoints(qcPoints, items);
      qcMatched = m.matched; qcGap = m.gap;
      for (const g of qcGap) {
        warnings.push(`方案质量控制点「${g.qc}」（方案第${g.srcLine}行）未找到对应验收项，已列入 qcGap，须由验收组确认是否补充`);
      }
    }
  } else {
    warnings.push('未提供检修方案（--plan），未做质量控制点比对；方案中若有质量控制点请提供方案后重跑');
  }

  // ---- 4. 已填验收结果回填（--records）
  let recorded = 0, unqualified = [], undeterminedResult = [], unmatchedRecord = [];
  if (a.records) {
    if (!fs.existsSync(a.records)) throw new Error(`验收记录不存在: ${a.records}`);
    const rows = C.pickSheet(loadBook(a.records), '验收记录', '验收', '检修记录', '记录');
    if (!rows) {
      warnings.push(`验收记录文件「${path.basename(a.records)}」中未找到「验收记录」工作表，未回填任何验收结果`);
    } else {
      const recs = C.toRecords(rows, ['验收项'], '验收记录', ['序号', '验收结果', '备注'], warnings, ALIASES);
      for (const r of recs) {
        const label = C.str(r['验收项']);
        const seqRaw = C.str(r['序号']);
        // 优先按验收项名称匹配；序号只作为名称匹配不到时的兜底。
        // 名称与序号都给出且指向不同项时 → 以名称为准并 warning（序号常因清单重排而失效）
        let byName = null;
        if (label) {
          let best = null;
          for (const it of items) {
            const s = R.textSim(label, it.item);
            if (!best || s > best.s) best = { s, it };
          }
          if (best && best.s >= 0.5) byName = best.it;
        }
        const bySeq = (seqRaw && /^\d+$/.test(seqRaw)) ? items.find((x) => x.seq === Number(seqRaw)) : null;
        if (byName && bySeq && byName.seq !== bySeq.seq) {
          warnings.push(`工作表「验收记录」第${r._row}行 序号 ${seqRaw} 指向「${bySeq.item}」，与验收项名称「${label}」不一致，已按名称匹配到第 ${byName.seq} 项`);
        }
        const hit = byName || bySeq;
        if (!hit) {
          unmatchedRecord.push({ row: r._row, seq: seqRaw || null, item: label, note: '记录中的验收项未匹配到本清单中的任何一项，未回填' });
          warnings.push(`工作表「验收记录」第${r._row}行 验收项「${label || '（空）'}」未匹配到本清单验收项，未回填`);
          continue;
        }
        const res = normResult(r['验收结果']);
        hit.result = res;                       // null 表示尚未填写，脚本不代填
        hit.note = C.str(r['备注']);
        if (res !== null) recorded++;
        if (res === '不合格') unqualified.push({ seq: hit.seq, ruleId: hit.ruleId, categoryCn: hit.categoryCn, item: hit.item, note: hit.note || '', srcRow: r._row });
        if (res === '未判定') {
          undeterminedResult.push({ seq: hit.seq, ruleId: hit.ruleId, item: hit.item, raw: C.str(r['验收结果']), srcRow: r._row, reason: '验收结果无法归类为合格/不合格' });
          warnings.push(`工作表「验收记录」第${r._row}行 验收结果「${C.str(r['验收结果'])}」无法归类为合格/不合格，已列为未判定`);
        }
      }
    }
  }
  const pending = items.filter((x) => x.result === null);

  // ---- 5. 统计
  const byCategory = {};
  for (const c of R.CATEGORIES) {
    const n = items.filter((x) => x.category === c.key).length;
    if (n) byCategory[c.cn] = n;
  }
  const counts = {
    items: items.length,
    byCategory,
    recorded,
    pending: pending.length,
    unqualified: unqualified.length,
    undeterminedResult: undeterminedResult.length,
    requiredRecords: requiredRecords.length,
    qcPoints: qcPoints === null ? null : qcPoints.length,
    qcMatched: qcMatched === null ? null : qcMatched.length,
    qcGap: qcGap === null ? null : qcGap.length,
    unmatchedRecord: unmatchedRecord.length,
  };

  // ---- 6. 产出 JSON
  C.ensureDir(outDir);
  const noProvided = !!a.no;
  const no = a.no || `YS-${C.localDate().replace(/-/g, '')}-${String(a.tag).replace(/[^\w-]/g, '')}`;
  // 三级验收（班组 / 车间 / 公司设备部门）+ 工艺（操作）+ 承修单位；日常维修无监理
  const signatures = [
    { role: '班组（一级验收）', name: null, date: null, note: '' },
    { role: '车间（二级验收，车间设备员/设备主任）', name: null, date: null, note: '' },
    { role: '公司设备管理部门（机动部/设备部，三级验收）', name: null, date: null, note: repairType === '大检修' ? '大检修必签' : (repairType ? '是否参加按厂内规定' : '检修分级未指定，是否参加按厂内规定') },
    { role: '工艺（操作）', name: null, date: null, note: '' },
    { role: '承修单位', name: null, date: null, note: '' },
  ];
  const result = {
    meta: {
      no, noProvided, tag: a.tag, name: a.name || '', workshop: a.workshop || null,
      equipTypeInput: a['equip-type'], equipTypeKey: built.typeKey, equipTypeCn: built.typeCn,
      typeCovered: built.typeCovered,
      scope: a.scope, scopeFlags: built.flags,
      scopeFlagsCn: activeFlags.map((k) => R.SCOPE_CN[k]),
      contractor: a.contractor, finishedAt,
      repairType, repairTypeRaw,
      pressureTest: opts.pressureTest, trialRun: opts.trialRun, specialEquipment: opts.specialEquipment,
      planProvided: !!a.plan, planFormat: a.plan ? (fs.statSync(a.plan).isDirectory() ? 'csv目录' : path.extname(a.plan).toLowerCase().replace('.', '')) : null,
      recordsProvided: !!a.records,
      generatedAt: C.localDateTime(),
      declaration: DECLARATION,
    },
    counts, items, requiredRecords,
    qcPoints, qcMatched, qcGap,
    unqualified, undeterminedResult, unmatchedRecord,
    conclusion: { result: null, date: null, note: null },   // ← 验收结论由验收组填写，脚本恒为 null
    signatures,
    warnings,
  };
  fs.writeFileSync(path.join(outDir, 'acceptance.json'), JSON.stringify(result, null, 2), 'utf8');

  // ---- 7. 产出 Markdown
  const L = [];
  L.push(`# 检修完工验收报告　${a.tag}${a.name ? ' ' + a.name : ''}`);
  L.push('');
  // 不合格项醒目提示（必须在开头）
  if (unqualified.length) {
    L.push(`> 【注意】**存在 ${unqualified.length} 项不合格，整改并复验合格前设备不得投用。** 明细见「四、不合格项与整改要求」。`);
    L.push('');
  }
  if (!built.typeCovered) {
    L.push(`> 【注意】**设备类型「${a['equip-type']}」不在规则库覆盖范围内，本清单仅为通用验收框架**，标注「${R.TBD}」的技术指标须由技术人员按设备技术文件补充后方可使用。`);
    L.push('');
  }
  if (qcGap && qcGap.length) {
    L.push(`> 【注意】**检修方案中有 ${qcGap.length} 个质量控制点未找到对应验收项**，见「六、与检修方案质量控制点对应情况」。`);
    L.push('');
  }
  L.push(`验收单编号：${no}${noProvided ? '' : '（临时编号，以厂内编号为准）'}　生成时间：${C.localDateTime()}（北京时间）`);
  L.push('');

  L.push('## 一、设备与检修概况');
  L.push('');
  L.push(C.mdTable(['项目', '内容'], [
    ['位号', a.tag], ['设备名称', a.name || '—'], ['所属车间', a.workshop || '—'],
    ['设备类型', built.typeCovered ? `${a['equip-type']}（归类：${built.typeCn}）` : `${a['equip-type']}（**规则库未覆盖**）`],
    ['检修分级', repairType ? `${repairType}${repairTypeRaw !== repairType ? `（原填「${repairTypeRaw}」）` : ''}` : '—（未指定）'],
    ['检修内容', a.scope],
    ['检修内容特征', activeFlags.length ? activeFlags.map((k) => R.SCOPE_CN[k]).join('、') : '—（未识别到特征）'],
    ['承修单位', a.contractor],
    ['完工时间', finishedAt || '—'],
    ['是否试压', opts.pressureTest ? '是' : '否'],
    ['是否试运', opts.trialRun ? '是' : '否'],
    ['是否特种设备', opts.specialEquipment ? '是' : '否'],
  ]));

  L.push('## 二、验收项逐项结果');
  L.push('');
  L.push(`共 ${counts.items} 项：${Object.entries(byCategory).map(([k, v]) => `${k} ${v} 项`).join('、')}。`);
  L.push('');
  L.push('**「验收结果」栏留空，由验收组现场逐项填写（合格／不合格），脚本不预填。**');
  L.push('');
  for (const c of R.CATEGORIES) {
    const sub = items.filter((x) => x.category === c.key);
    if (!sub.length) continue;
    L.push(`### ${c.cn}`);
    L.push('');
    L.push(C.mdTable(['序号', '验收内容', '验收标准', '验收方式', '责任方', '验收结果', '备注'],
      sub.map((x) => [x.seq, x.item, x.standard, x.method, x.owner,
        x.result === null ? '　' : (x.result === '不合格' ? '**不合格**' : x.result),
        x.note || '　'])));
  }

  L.push('## 三、应附资料核对');
  L.push('');
  L.push('**「是否提供」栏留空，由验收组核对后填写。**');
  L.push('');
  L.push(C.mdTable(['序号', '资料名称', '要求依据', '是否提供'],
    requiredRecords.map((r, i) => [i + 1, r.name, r.basis, r.provided === null ? '　' : r.provided])));

  L.push('## 四、不合格项与整改要求');
  L.push('');
  if (!a.records) {
    L.push('_未提供验收记录（--records），尚无验收结果；本节待验收组逐项填写后确定。_');
    L.push('');
  } else if (!unqualified.length) {
    L.push('_本次回填的验收结果中无不合格项。未填写结果的验收项仍需验收组确认。_');
    L.push('');
  } else {
    L.push(C.mdTable(['序号', '类别', '验收内容', '不合格情况', '整改要求', '复验人', '复验日期'],
      unqualified.map((x) => [x.seq, x.categoryCn, x.item, x.note || '—', '　', '　', '　'])));
  }

  L.push('## 五、未填写与未判定项');
  L.push('');
  L.push(`未填写验收结果：${pending.length} 项；验收结果无法归类：${undeterminedResult.length} 项。`);
  L.push('');
  if (undeterminedResult.length) {
    L.push(C.mdTable(['序号', '验收内容', '原始填写', '原因', '出处'],
      undeterminedResult.map((x) => [x.seq, x.item, x.raw || '（空）', x.reason, `验收记录 第${x.srcRow}行`])));
  } else {
    L.push('_无验收结果无法归类的项。_');
    L.push('');
  }
  if (unmatchedRecord.length) {
    L.push('记录中未能匹配到本清单的条目：');
    L.push('');
    L.push(C.mdTable(['出处', '记录序号', '记录验收项', '说明'],
      unmatchedRecord.map((x) => [`验收记录 第${x.row}行`, x.seq || '—', x.item || '（空）', x.note])));
  }

  L.push('## 六、与检修方案质量控制点对应情况');
  L.push('');
  if (qcPoints === null) {
    L.push('_未提供检修方案（--plan），未做质量控制点比对。_');
    L.push('');
  } else if (!qcPoints.length) {
    L.push('_已读取检修方案，但未识别出质量控制点条目，请人工核对方案质量控制点是否都有对应验收项。_');
    L.push('');
  } else {
    L.push(`方案质量控制点 ${qcPoints.length} 个，已对应 ${qcMatched.length} 个，缺口 ${qcGap.length} 个。`);
    L.push('');
    L.push('**已对应：**');
    L.push('');
    L.push(C.mdTable(['#', '方案质量控制点', '对应验收项序号', '对应验收内容'],
      qcMatched.map((x) => [x.no, x.qc, x.seq, x.item])));
    L.push('**缺口（未找到对应验收项）：**');
    L.push('');
    if (!qcGap.length) { L.push('_无_'); L.push(''); }
    else L.push(C.mdTable(['#', '方案质量控制点', '方案出处', '最接近的验收项', '处理要求'],
      qcGap.map((x) => [x.no, x.qc, `第${x.srcLine}行`, x.nearest ? `${x.nearest.seq} ${x.nearest.item}（相似度 ${x.nearest.score}）` : '—', x.note])));
  }

  L.push('## 七、遗留问题');
  L.push('');
  L.push('<!-- ANALYSIS_START -->');
  L.push('（由模型依据 references/acceptance-rules.md 口径填写：本次检修遗留未处理事项、需下次检修解决的问题、需持续观察的部位。'
    + '只写用户说明或记录中写明的内容，不得替验收组判定是否影响投用；若无遗留问题写「无」。）');
  L.push('<!-- ANALYSIS_END -->');
  L.push('');

  L.push('## 八、验收结论');
  L.push('');
  L.push('**以下由验收组填写，脚本不预填。**');
  L.push('');
  L.push(C.mdTable(['项目', '填写栏'], [
    ['验收结论（合格／不合格／限期整改后复验）', '　'],
    ['是否同意投用', '　'],
    ['结论说明', '　'],
    ['验收日期', '　'],
  ]));

  L.push('## 九、三级验收签字');
  L.push('');
  L.push('_按三级验收（班组 / 车间 / 公司设备管理部门）执行，工艺（操作）方参与，承修单位签认；日常维修无监理。签字人与日期由现场填写。_');
  L.push('');
  L.push(C.mdTable(['签字方', '签字人', '日期', '说明'],
    signatures.map((s) => [s.role, '　', '　', s.note || '　'])));

  if (warnings.length) {
    L.push('## 附：数据提示');
    L.push('');
    for (const w of warnings) L.push(`- ${w}`);
    L.push('');
  }
  L.push('---');
  L.push('');
  L.push(DECLARATION);
  L.push('');
  fs.writeFileSync(path.join(outDir, 'acceptance.md'), L.join('\n'), 'utf8');

  C.emitOk(outDir, { ok: true, out: outDir, no, tag: a.tag, typeCovered: built.typeCovered, repairType, counts, warnings });
}

try { main(); } catch (e) { C.fail(e, warnings); }
