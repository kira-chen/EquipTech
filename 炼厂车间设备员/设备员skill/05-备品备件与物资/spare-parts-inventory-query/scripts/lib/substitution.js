'use strict';
/**
 * 备件代用候选检索与技术确认要点
 * 口径见 references/substitution-rules.md
 * **本模块只列候选与参数差异，绝不给出「可以代用」的结论。**
 */

/** 按备件类别应确认的技术要点（代用可行性由设备工程师判定） */
const CHECK_POINTS = {
  '机械密封': ['材质组合（动环/静环/辅助密封）', '介质相容性', '工作压力等级', '工作温度范围', '轴径与安装尺寸', '旋转方向', 'API 682 分类'],
  '轴承': ['内径/外径/宽度', '游隙等级', '精度等级', '润滑方式', '额定转速', '额定动载荷'],
  '密封垫片': ['材质与介质相容性', '压力等级', '温度范围', '公称通径', '密封面形式（RF/FF/RTJ）'],
  '阀门': ['公称通径 DN', '公称压力 PN', '阀体材质', '密封面材质', '连接形式', '驱动方式', '泄漏等级'],
  '电机': ['额定功率', '额定电压', '额定转速', '防爆等级', '防护等级 IP', '绝缘等级', '安装方式', '接线方式'],
  '仪表': ['量程', '精度等级', '输出信号', '过程连接', '防爆等级', '防护等级', '介质相容性'],
  '叶轮': ['材质', '外径与叶片数', '平衡等级', '轴孔尺寸与键槽', '水力性能曲线'],
  '联轴器': ['扭矩容量', '轴径与键槽', '许用不对中量', '转速上限', '材质'],
  '滤芯': ['过滤精度', '材质与介质相容性', '压差承受能力', '尺寸与密封形式', '流通能力'],
  '螺栓紧固件': ['材质与强度等级', '规格与螺距', '表面处理', '使用温度范围'],
  '通用': ['规格型号一致性', '材质与介质相容性', '压力等级', '温度范围', '安装接口尺寸'],
};

/** 从名称推断类别 */
const CATEGORY_PATTERNS = [
  ['机械密封', /机封|机械密封|密封组件/],
  ['轴承', /轴承|滚动体|bearing/i],
  ['密封垫片', /垫片|缠绕垫|密封垫|垫圈|O型圈|O圈/],
  ['阀门', /阀|球阀|闸阀|截止阀|止回阀|调节阀|安全阀/],
  ['电机', /电机|马达|motor/i],
  ['仪表', /变送器|压力表|温度计|流量计|液位计|分析仪|传感器/],
  ['叶轮', /叶轮|导叶|impeller/i],
  ['联轴器', /联轴器|膜片|弹性块|coupling/i],
  ['滤芯', /滤芯|滤网|过滤器芯/],
  ['螺栓紧固件', /螺栓|螺母|双头|垫圈|紧固件/],
];
function categoryOf(name) {
  const s = String(name || '');
  for (const [cat, re] of CATEGORY_PATTERNS) if (re.test(s)) return cat;
  return '通用';
}
function checkPoints(name) {
  return CHECK_POINTS[categoryOf(name)] || CHECK_POINTS['通用'];
}

/** 规格相似度：按「数字+单位」token 与文本重合度粗判，仅用于排序候选，不作判定依据 */
function specSimilarity(a, b) {
  const tok = (s) => String(s || '').toUpperCase().replace(/[，,；;]/g, ' ').split(/\s+/).filter(Boolean);
  const A = new Set(tok(a)), B = new Set(tok(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return (2 * inter) / (A.size + B.size);
}

/** 逐字段比对，返回差异项 */
function diffFields(target, cand, fields) {
  const out = [];
  for (const f of fields) {
    const tv = target[f] === undefined || target[f] === null ? '' : String(target[f]).trim();
    const cv = cand[f] === undefined || cand[f] === null ? '' : String(cand[f]).trim();
    if (tv === '' && cv === '') continue;
    if (tv !== cv) out.push({ field: f, target: tv || null, candidate: cv || null });
  }
  return out;
}

module.exports = { CHECK_POINTS, categoryOf, checkPoints, specSimilarity, diffFields };
