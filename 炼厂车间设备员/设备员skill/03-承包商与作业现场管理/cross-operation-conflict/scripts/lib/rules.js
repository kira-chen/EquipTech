'use strict';
/**
 * 交叉作业冲突规则引擎
 * 口径见 references/conflict-rules.md。严重度：高 / 中 / 低 / undetermined 未判定
 * 核心原则：
 *   1. 区域或标高为空 → 空间关系 undetermined，绝不按「不在同一区域」处理
 *   2. 风险冲突判定依赖介质而介质为空 → 该冲突项 undetermined，绝不因缺数据判为无冲突
 *   3. 每条冲突带规则号（S/R/Z 系列）与严重度，可对照 references/conflict-rules.md 复核
 *   4. 同位号「受限空间 + 用火」双票作业（罐内/塔内用火）是合法常态，R2 对同位号只出「提示项」（核对两票关联、
 *      气体分析覆盖、双监护），不计为高冲突；邻近（同区域同层不同位号）仍按 R2 高冲突，上下层由 R5 覆盖
 *   5. 术语按《中国石化作业许可管理规定》八大类：用火作业（"动火"仅作识别别名）
 *   6. --rules 厂内口径可覆盖规则严重度 / 启用状态 / 建议措辞（applyRuleOverrides），不新增规则
 */

// ---------------------------------------------------------------- 作业类型
const TYPE_PATTERNS = [
  ['hotwork', /用火|动火|明火|焊接|气割|切割|打磨|砂轮|电焊|氧焊|烘烤|喷灯/],
  ['confined', /受限空间|进罐|进塔|进容器|入罐|有限空间|进入设备内/],
  ['height', /高处作业|登高|高空|脚手架|搭架|架子|上塔|平台作业|吊篮/],
  ['lifting', /吊装|起重|吊车|汽车吊|行车|葫芦|吊运|起吊/],
  ['blind', /盲板|抽堵|加盲板|拆盲板|插盲板/],
  ['excavation', /动土|开挖|挖掘|破土|开槽|钻探|打桩/],
  ['power', /临时用电|接电|用电作业|电源接引|临电/],
  ['purge', /吹扫|置换|排放|泄压|导淋|退料|排凝|放空|脱水/],
  ['cleaning', /清洗|冲洗|水洗|高压水|化学清洗|带水|蒸煮/],
  ['pipeline', /断路|管线拆装|管线作业|管道拆除|动管线/],
  ['overhaul', /检修|拆解|解体|抽芯|更换|安装|试压|校验/],
];
const TYPE_CN = {
  hotwork: '用火作业', confined: '受限空间作业', height: '高处作业', lifting: '吊装作业',
  blind: '盲板抽堵', excavation: '动土作业', power: '临时用电', purge: '吹扫置换/排放',
  cleaning: '清洗带水作业', pipeline: '断路/管线作业', overhaul: '检修作业', other: '其他作业',
};
/** 一项作业可同时命中多个类型（如「进罐动火」）；全不命中返回 ['other'] */
function classifyTypes(text) {
  const s = String(text || '');
  const hit = [];
  for (const [k, re] of TYPE_PATTERNS) if (re.test(s)) hit.push(k);
  return hit.length ? hit : ['other'];
}

// ---------------------------------------------------------------- 介质可燃性
const MEDIUM_FLAM = /氢|硫化氢|H2S|液化气|LPG|轻烃|石脑油|汽油|瓦斯|干气|燃料气|天然气|甲烷|乙烷|丙烯|乙烯|丁烷|丙烷|丁二烯|裂解气|焦化|苯|甲苯|二甲苯|芳烃|甲醇|乙醇|丙酮|MTBE|甲乙酮|原油|柴油|蜡油|渣油|油浆|重油|燃料油|航煤|煤油|油气|溶剂|粗汽油|污油|轻油|润滑油|导热油|液氨|氨|硫醇|酚|胺液|MDEA|沥青|液硫/i;
const MEDIUM_INERT = /^水$|蒸汽|氮气|N2|空气|除盐水|循环水|净化风|仪表风|惰性气|烟气|二氧化碳|CO2|凝结水|软化水|新鲜水|消防水|生产水|工业水|脱盐水|低压蒸汽|中压蒸汽/i;
/**
 * 返回 'flammable' | 'inert' | null
 * null = 介质为空或不在库中 → 涉及可燃性的冲突项一律 undetermined，不得按无冲突
 */
function mediumFlammable(medium) {
  const s = String(medium || '').trim();
  if (!s) return null;
  // 「瓦斯水 / 含油污水 / 酸性水」等含可燃或有毒组分的水相，不按惰性处理
  if (/瓦斯水|含油污水|含硫污水|酸性水|含油水/.test(s)) return 'flammable';
  if (MEDIUM_FLAM.test(s)) return 'flammable';
  if (MEDIUM_INERT.test(s)) return 'inert';
  return null;
}
const FLAM_CN = { flammable: '可燃/易燃', inert: '惰性或不可燃' };

// ---------------------------------------------------------------- 时段
/** "YYYY-MM-DD HH:mm" → 分钟数；无法解析返回 null */
function toMinutes(dt) {
  if (!dt) return null;
  const m = String(dt).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return null;
  return Math.round(Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00Z`) / 60000);
}
/**
 * 时段重叠判定
 * @param {number} windowMin 重叠判定分钟数，默认 0 = 严格重叠（相接不算重叠）
 *   windowMin > 0 时，两作业间隔在 windowMin 之内也视为重叠（前后衔接过近同样存在交叉风险）
 * @returns {{overlap:boolean|null, minutes:number|null, reason:string}}
 *   任一端时间无法解析 → overlap 为 null（未判定），不得按不重叠处理
 */
function timeOverlap(a, b, windowMin = 0) {
  const a1 = toMinutes(a.start), a2 = toMinutes(a.end);
  const b1 = toMinutes(b.start), b2 = toMinutes(b.end);
  if (a1 === null || a2 === null || b1 === null || b2 === null) {
    return { overlap: null, minutes: null, reason: '起止时间缺失或无法解析，无法判定时段关系' };
  }
  const s = Math.max(a1, b1), e = Math.min(a2, b2);
  const mins = e - s;
  if (mins > 0) return { overlap: true, minutes: mins, reason: `时段重叠 ${mins} 分钟` };
  const gap = -mins;
  if (windowMin > 0 && gap <= windowMin) {
    return { overlap: true, minutes: 0, reason: `时段相接或间隔 ${gap} 分钟，在 --window ${windowMin} 分钟判定范围内` };
  }
  return { overlap: false, minutes: 0, reason: gap === 0 ? '时段首尾相接，不计为重叠' : `时段不重叠，间隔 ${gap} 分钟` };
}

// ---------------------------------------------------------------- 空间关系
/**
 * spatialRelation(a, b)
 * @returns {{relation, relationCn, undetermined:boolean, missing:string[], note}}
 *   relation: 'same'（同区域同层）| 'vertical'（同区域上下层）| 'different'（不同区域）| null（未判定）
 * 硬约束：区域字段任一为空 → undetermined，**绝不按 different 处理**
 *         同区域但标高任一为空 → undetermined（无法判断是否上下层作业）
 */
function spatialRelation(a, b) {
  const miss = [];
  if (!a.area) miss.push(`${a.id} 区域`);
  if (!b.area) miss.push(`${b.id} 区域`);
  if (miss.length) {
    return { relation: null, relationCn: '无法判定', undetermined: true, missing: miss, note: '区域字段为空，无法判定是否同一区域；不得按不在同一区域处理' };
  }
  if (a.area !== b.area) {
    return { relation: 'different', relationCn: '不同区域', undetermined: false, missing: [], note: `分属「${a.area}」与「${b.area}」` };
  }
  const em = [];
  if (a.elev === null) em.push(`${a.id} 标高`);
  if (b.elev === null) em.push(`${b.id} 标高`);
  if (em.length) {
    return { relation: null, relationCn: '无法判定', undetermined: true, missing: em, note: `同在「${a.area}」，但标高字段为空，无法判定是否上下层作业` };
  }
  const d = Math.abs(a.elev - b.elev);
  if (d >= 2) {
    return { relation: 'vertical', relationCn: '同区域上下层', undetermined: false, missing: [], note: `同在「${a.area}」，标高差 ${d.toFixed(1)} 米，构成上下层作业` };
  }
  return { relation: 'same', relationCn: '同区域同层', undetermined: false, missing: [], note: `同在「${a.area}」，标高差 ${d.toFixed(1)} 米` };
}

// ---------------------------------------------------------------- 空间冲突规则
const SEV_ORDER = { 高: 3, 中: 2, 低: 1, 提示: 0 };
/**
 * spatialRules(a, b, rel) → [{ruleId, severity, title, note}]
 * S1 同区域同层同时段作业 → 中
 * S2 同区域上下层，上方高处/吊装作业，下方有人作业 → 高（落物打击）
 * S3 同区域上下层，无上方高处作业 → 低（交叉干扰）
 */
function spatialRules(a, b, rel) {
  const out = [];
  if (rel.relation === 'same') {
    out.push({ ruleId: 'S1', severity: '中', title: '同区域同层同时段作业', note: `${rel.note}，作业面重叠，人员与工机具相互干扰` });
  } else if (rel.relation === 'vertical') {
    const upper = a.elev >= b.elev ? a : b;
    const lower = a.elev >= b.elev ? b : a;
    const upHeight = upper.types.includes('height') || upper.types.includes('lifting');
    if (upHeight) {
      out.push({
        ruleId: 'S2', severity: '高', title: '上下层交叉作业（上方高处/吊装，下方有人）',
        note: `${rel.note}；上方 ${upper.id}（${upper.typeCn}）在 ${lower.id}（${lower.typeCn}）正上方，存在落物打击风险`,
      });
    } else {
      out.push({ ruleId: 'S3', severity: '低', title: '同区域上下层作业', note: `${rel.note}，上方无高处或吊装作业，以相互干扰为主` });
    }
  }
  return out;
}

// ---------------------------------------------------------------- 风险冲突矩阵
/**
 * 冲突矩阵。每条：
 *   ruleId   规则号，对照 references/conflict-rules.md
 *   severity 高/中/低
 *   when(a,b,ctx) → true 命中 / false 不命中 / {undetermined:true, missing:[...]} 缺数据无法判定
 * ctx = {rel, sameArea, vertical, upper, lower}
 * 规则对称：调用方保证按 (a,b) 与 (b,a) 各判一次由 hasType 语义覆盖。
 */
function hasType(w, t) { return w.types.includes(t); }
/** 任一侧命中 t1、另一侧命中 t2 时，返回 [第一侧, 第二侧]，否则 null */
function pair(a, b, t1, t2) {
  if (hasType(a, t1) && hasType(b, t2)) return [a, b];
  if (hasType(b, t1) && hasType(a, t2)) return [b, a];
  return null;
}

const RISK_RULES = [
  {
    ruleId: 'R1', severity: '高', title: '用火 × 可燃介质排放/吹扫置换',
    check(a, b, ctx) {
      const p = pair(a, b, 'hotwork', 'purge');
      if (!p) return null;
      if (!ctx.sameAreaOrUndetermined) return null;
      const [hot, pur] = p;
      const f = pur.flammable;
      if (f === null) {
        return { undetermined: true, missing: [`${pur.id} 涉及介质`], note: `${pur.id} 为吹扫置换/排放作业但介质字段为空，无法判定排放物是否可燃，不得据此判为无冲突` };
      }
      if (f === 'flammable') return { note: `${pur.id} 排放/吹扫 ${pur.medium}（可燃），与 ${hot.id} 用火同时段同区域，存在引燃风险` };
      return null;
    },
  },
  {
    ruleId: 'R2', severity: '高', title: '用火 × 受限空间（邻近，同区域同层）',
    check(a, b, ctx) {
      const p = pair(a, b, 'hotwork', 'confined');
      if (!p) return null;
      const [hot, cfd] = p;
      const sameTag = hot.tag && cfd.tag && hot.tag === cfd.tag;
      // 同位号：罐内/塔内用火是「受限空间票 + 用火票」双票作业，属合法常态 → 提示项（不计冲突）
      if (sameTag) {
        return {
          advisory: true,
          note: `${cfd.id} 受限空间作业与 ${hot.id} 用火同在位号 ${hot.tag}，属受限空间内用火的双票作业（合法常态，不计冲突）；请核对两张票互相关联、气体分析同时覆盖受限空间与用火要求、双监护（属地监护人 + 作业单位监护人）到位、用火级别与票面一致`,
        };
      }
      // 不同位号但同区域同层：邻近用火，烟气与火星可能影响受限空间出入口 → 高
      if (ctx.rel.relation !== 'same') {
        if (ctx.rel.undetermined) return { undetermined: true, missing: ctx.rel.missing, note: `${ctx.rel.note}，无法判定用火点与受限空间出入口是否邻近` };
        return null;
      }
      return { note: `${cfd.id} 受限空间作业与 ${hot.id} 用火同区域同层、不同位号，用火烟气与火星可能影响受限空间出入口与通风，空间内人员撤离受限` };
    },
  },
  {
    ruleId: 'R3', severity: '中', title: '用火 × 高处作业（下方用火，上方有可燃物）',
    check(a, b, ctx) {
      const p = pair(a, b, 'hotwork', 'height');
      if (!p) return null;
      if (ctx.rel.undetermined) return { undetermined: true, missing: ctx.rel.missing, note: `${ctx.rel.note}，无法判定用火与高处作业的上下关系` };
      if (ctx.rel.relation !== 'vertical' && ctx.rel.relation !== 'same') return null;
      const [hot, hi] = p;
      if (ctx.rel.relation === 'vertical' && hot.elev > hi.elev) return null; // 用火在上方，不构成本条
      return { note: `${hot.id} 用火位于 ${hi.id} 高处作业下方或同层，火星飞溅可能引燃上方可燃物或作业人员防护用品` };
    },
  },
  {
    ruleId: 'R4', severity: '高', title: '吊装 × 任何下方作业（落物）',
    check(a, b, ctx) {
      const lift = hasType(a, 'lifting') ? a : hasType(b, 'lifting') ? b : null;
      if (!lift) return null;
      const other = lift === a ? b : a;
      if (hasType(other, 'lifting') && other.id === lift.id) return null;
      if (ctx.rel.undetermined) return { undetermined: true, missing: ctx.rel.missing, note: `${ctx.rel.note}，无法判定 ${other.id} 是否处于 ${lift.id} 吊装覆盖范围内` };
      if (ctx.rel.relation === 'different') return null;
      return { note: `${lift.id} 吊装作业与 ${other.id}（${other.typeCn}）同区域同时段，${other.id} 可能处于吊物运行路径或吊臂覆盖范围下方，存在落物打击风险` };
    },
  },
  {
    ruleId: 'R5', severity: '高', title: '受限空间 × 邻近用火/热工作业（上下层）',
    check(a, b, ctx) {
      const p = pair(a, b, 'confined', 'hotwork');
      if (!p) return null;
      // R2 已覆盖同一空间；本条覆盖同区域邻近（不同位号或上下层）
      const [cfd, hot] = p;
      const sameTag = hot.tag && cfd.tag && hot.tag === cfd.tag;
      if (sameTag) return null;
      if (ctx.rel.undetermined) return null; // 由 R2 统一标未判定，避免重复
      if (ctx.rel.relation !== 'vertical') return null;
      return { note: `${cfd.id} 受限空间作业与邻近的 ${hot.id} 用火同区域上下层，烟气与有害气体可能进入受限空间，且空间内人员撤离受限` };
    },
  },
  {
    ruleId: 'R6', severity: '中', title: '临时用电 × 带水作业/清洗',
    check(a, b, ctx) {
      const p = pair(a, b, 'power', 'cleaning');
      if (!p) return null;
      if (ctx.rel.undetermined) return { undetermined: true, missing: ctx.rel.missing, note: `${ctx.rel.note}，无法判定临时用电与带水作业是否相邻` };
      if (ctx.rel.relation === 'different') return null;
      const [pw, cl] = p;
      return { note: `${pw.id} 临时用电与 ${cl.id} 清洗/带水作业同区域同时段，电缆接头与配电箱受潮存在触电风险` };
    },
  },
  {
    ruleId: 'R7', severity: '高', title: '盲板抽堵 × 同系统其他作业',
    check(a, b, ctx) {
      const bl = hasType(a, 'blind') ? a : hasType(b, 'blind') ? b : null;
      if (!bl) return null;
      const other = bl === a ? b : a;
      if (hasType(other, 'blind')) return null;
      const sameSys = bl.system && other.system && bl.system === other.system;
      if (!sameSys) {
        if (!bl.system || !other.system) {
          if (ctx.rel.relation === 'same' || ctx.rel.relation === 'vertical') {
            return { undetermined: true, missing: [!bl.system ? `${bl.id} 所属系统` : `${other.id} 所属系统`], note: `${bl.id} 盲板抽堵与 ${other.id} 同区域同时段，但系统字段为空，无法判定是否同一系统，不得据此判为无冲突` };
          }
        }
        return null;
      }
      return { note: `${bl.id} 盲板抽堵与 ${other.id}（${other.typeCn}）同属系统「${bl.system}」，抽堵期间系统隔离状态变化，可能导致介质窜入或憋压` };
    },
  },
  {
    ruleId: 'R8', severity: '中', title: '动土 × 地下管线区域作业',
    check(a, b, ctx) {
      const p = pair(a, b, 'excavation', 'pipeline');
      if (!p) return null;
      if (ctx.rel.undetermined) return { undetermined: true, missing: ctx.rel.missing, note: `${ctx.rel.note}，无法判定动土是否处于管线区域` };
      if (ctx.rel.relation === 'different') return null;
      const [ex, pl] = p;
      return { note: `${ex.id} 动土作业与 ${pl.id} 管线作业同区域同时段，开挖可能触及地下管线或影响管线支撑` };
    },
  },
];

/**
 * riskConflicts(a, b, rel)
 * @returns {{hits:[], undetermined:[]}}
 */
function riskConflicts(a, b, rel, overrides = null) {
  const ctx = {
    rel,
    sameAreaOrUndetermined: rel.relation === 'same' || rel.relation === 'vertical' || rel.undetermined,
  };
  const hits = [], und = [], advisories = [];
  for (const r of RISK_RULES) {
    const ov = overrides && overrides[r.ruleId];
    if (ov && ov.enabled === false) continue;
    let res;
    try { res = r.check(a, b, ctx); } catch (e) { res = null; }
    if (!res) continue;
    if (res.undetermined) {
      und.push({ ruleId: r.ruleId, title: r.title, severity: 'undetermined', missing: res.missing || [], note: res.note });
    } else if (res.advisory) {
      advisories.push({ ruleId: r.ruleId, title: '用火 × 受限空间（同位号双票作业）', severity: '提示', note: res.note });
    } else {
      hits.push({ ruleId: r.ruleId, severity: (ov && ov.severity) || r.severity, title: r.title, note: res.note });
    }
  }
  return { hits, undetermined: und, advisories };
}

/**
 * 厂内冲突口径覆盖（--rules）：只允许改已有规则的 严重度 / 启用 / 建议措辞，不新增规则。
 * @param {Array<{ruleId, severity?, enabled?, advice?}>} rows
 * @returns {{overrides: Object, applied: string[], ignored: string[]}}
 */
const KNOWN_RULES = ['S1', 'S2', 'S3', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'Z1', 'Z2', 'Z3', 'Z4'];
function applyRuleOverrides(rows) {
  const overrides = {}, applied = [], ignored = [];
  for (const r of rows || []) {
    const id = String(r.ruleId || '').trim().toUpperCase();
    if (!KNOWN_RULES.includes(id)) { ignored.push(`${r.ruleId || '（空）'}：不是内置规则号，已忽略（--rules 不新增规则）`); continue; }
    const o = overrides[id] || (overrides[id] = {});
    const sev = String(r.severity || '').trim();
    if (sev) {
      if (!SEV_ORDER.hasOwnProperty(sev) || sev === '提示') { ignored.push(`${id}：严重度「${sev}」不在 高/中/低 之内，已忽略`); }
      else o.severity = sev;
    }
    const en = String(r.enabled === undefined || r.enabled === null ? '' : r.enabled).trim();
    if (en) {
      if (/^(否|停用|禁用|不启用|N|NO|FALSE|0)$/i.test(en)) o.enabled = false;
      else if (/^(是|启用|Y|YES|TRUE|1)$/i.test(en)) o.enabled = true;
      else ignored.push(`${id}：启用取值「${en}」无法识别（应为 是/否），已忽略`);
    }
    const adv = String(r.advice || '').trim();
    if (adv) {
      if (!/^建议/.test(adv)) ignored.push(`${id}：建议措辞「${adv.slice(0, 20)}…」须以「建议」开头（不得表述为已批准的安排），已忽略`);
      else o.advice = adv;
    }
    if (Object.keys(o).length) applied.push(id); else delete overrides[id];
  }
  return { overrides, applied: [...new Set(applied)], ignored };
}

// ---------------------------------------------------------------- 资源冲突规则
const RESOURCE_FIELDS = [
  { key: 'guard', ruleId: 'Z1', severity: '高', label: '监护人', note: '同一监护人被排到多项同时段作业，无法同时在岗监护' },
  { key: 'craneId', ruleId: 'Z2', severity: '高', label: '起重设备', note: '同一台起重设备被排到多项同时段作业，无法同时到位' },
  { key: 'circuit', ruleId: 'Z3', severity: '中', label: '电源回路', note: '同一电源回路被多项作业占用，停送电操作相互影响' },
  { key: 'fireCover', ruleId: 'Z4', severity: '中', label: '消防设施覆盖区', note: '多项作业共用同一消防设施覆盖区，一处动用后其余作业消防保障被削弱' },
];

/**
 * Z2 只在起重类设备之间判：「使用设备」写的是吊车、葫芦、卷扬机等起重设备，或该作业本身是吊装作业，才参与比对；
 * 两张票都写「电焊机」「试压泵」这类普通机具不构成 Z2。
 */
const CRANE_RE = /吊|起重|行车|天车|葫芦|卷扬|塔机|门机|桥机|龙门架/;
function craneEligible(work, value) {
  return CRANE_RE.test(String(value || '')) || (Array.isArray(work.types) && work.types.includes('lifting'));
}

// ---------------------------------------------------------------- 协调建议
/**
 * 建议措辞只能是「建议错时 / 建议增加监护 / 建议先后作业 / 建议补充信息」等建议语气，
 * 不得表述为已批准的安排（如「已安排错时」「批准同时进行」）。
 */
const ADVICE = {
  S1: '建议错时安排或明确作业面分隔，落实相互告知',
  'R2-ADV': '建议核对受限空间票与用火票互相关联、气体分析同时满足两票要求、双监护到位；不构成冲突，无需错时',
  S2: '建议先后作业；确需同时进行时，建议在下方设置硬质防护棚并增加专人监护',
  S3: '建议明确上下层作业相互告知，落实警戒与围挡',
  R1: '建议错时安排：排放吹扫结束并经气体检测合格后再行用火',
  R2: '建议错时安排；确需同时进行时，建议用火点避开受限空间出入口与通风口并增加属地监护',
  R3: '建议错时安排；确需同时进行时，建议在用火点上方设置阻燃隔离并增加用火监护人',
  R4: '建议错时安排：吊装作业期间下方停止一切作业并设置警戒区',
  R5: '建议错时安排；确需同时进行时，建议加强受限空间强制通风并连续检测',
  R6: '建议错时安排；确需同时进行时，建议临时用电采用防水接头并加装漏电保护',
  R7: '建议先后作业：盲板抽堵完成并确认隔离到位后再进行同系统其他作业',
  R8: '建议先探明地下管线走向并人工开挖至管线埋深，建议增加管线监护',
  Z1: '建议错时安排或另行指派监护人，一名监护人同一时段只对应一项作业',
  Z2: '建议错时安排起重设备使用时段，或另行调配设备',
  Z3: '建议错时安排，或由电气专业确认分回路供电后再同时作业',
  Z4: '建议错时安排，或补充临时消防措施后再同时作业',
};
function adviceFor(ruleId, overrides = null) {
  if (overrides && overrides[ruleId] && overrides[ruleId].advice) return overrides[ruleId].advice;
  return ADVICE[ruleId] || '建议提交安全环保部门统筹协调';
}

/** 严重度取高者 */
function maxSeverity(list) {
  let best = null;
  for (const s of list) if (SEV_ORDER[s] && (!best || SEV_ORDER[s] > SEV_ORDER[best])) best = s;
  return best;
}

module.exports = {
  classifyTypes, TYPE_CN, TYPE_PATTERNS,
  mediumFlammable, FLAM_CN,
  toMinutes, timeOverlap,
  spatialRelation, spatialRules,
  RISK_RULES, riskConflicts,
  RESOURCE_FIELDS, CRANE_RE, craneEligible,
  ADVICE, adviceFor, maxSeverity, SEV_ORDER,
  KNOWN_RULES, applyRuleOverrides,
};
