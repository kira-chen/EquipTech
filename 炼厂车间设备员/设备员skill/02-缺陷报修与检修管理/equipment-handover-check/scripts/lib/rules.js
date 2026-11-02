'use strict';
/**
 * 检修前设备交出条目规则引擎
 * 口径见 references/handover-rules.md、references/medium-hazards.md
 * 核心原则：
 *   1. 介质不在危险特性库 → 按最严口径（视同高危）生成条目，并要求核实 MSDS，绝不按无危险处理
 *   2. 判定依据字段缺失（如未说明是否带压/高温）→ 该条目 undetermined 单列，绝不默认为「不需要」
 *   3. 关键条目（置换分析合格、盲板加装、断电挂牌）无论如何都要单列 criticalItems
 *   4. confirmed 一律 null，由现场人员填写，脚本不得预填
 */

// ---------------------------------------------------------------- 介质危险特性
const HAZ_CN = {
  high: '高危（易燃易爆 / 有毒 / 窒息）',
  medium: '中等（可燃、腐蚀或高温烫伤）',
  low: '低（水、蒸汽、氮气等）',
  unknown: '不在危险特性库（已按最严口径处理）',
};

// 高危：易燃易爆 + 剧毒 + 窒息性
const MEDIUM_HIGH = [
  // 含「乙烯/苯」字样的专名先于低碳烃、芳烃判，避免被泛规则抢走
  { re: /环氧乙烷|\bEO\b/i, traits: ['剧毒', '易燃易爆', '易自聚'], key: '环氧乙烷（EO）' },
  { re: /苯乙烯/i, traits: ['易燃', '有毒', '易自聚'], key: '苯乙烯' },
  { re: /硫化氢|H2S/i, traits: ['有毒', '易燃'], key: '硫化氢' },
  { re: /(?<!氮)氢气|富氢|含氢|新氢|循环氢|(?<![一二三])氢(?!氧化|氮)/i, traits: ['易燃易爆', '易扩散'], key: '氢气' },
  { re: /液化气|液化石油气|LPG/i, traits: ['易燃易爆'], key: '液化气' },
  { re: /轻烃|石脑油|汽油|粗汽油|稳定汽油/i, traits: ['易燃易爆'], key: '轻烃/汽油' },
  { re: /瓦斯|干气|燃料气|火炬气/i, traits: ['易燃易爆'], key: '瓦斯气' },
  { re: /丙烯|乙烯|丁烯|丁二烯|丙烷|丁烷|乙烷/i, traits: ['易燃易爆'], key: '低碳烃' },
  { re: /苯|甲苯|二甲苯|对二甲苯|PX|重整生成油/i, traits: ['易燃', '有毒致癌'], key: '芳烃' },
  { re: /氨|液氨/i, traits: ['有毒', '强刺激'], key: '氨' },
  { re: /一氧化碳|CO(?![2O])/i, traits: ['有毒', '易燃'], key: '一氧化碳' },
  { re: /甲醇|乙醇(?!胺)/i, traits: ['易燃', '有毒'], key: '醇类' },
  { re: /环氧|丙烯腈|光气|氰/i, traits: ['剧毒'], key: '剧毒化学品' },
  { re: /氯气|液氯|\bCl2\b/i, traits: ['剧毒', '强氧化'], key: '氯气' },
  { re: /碳四|混合碳四|\bC4\b|碳五|\bC5\b|裂解气|裂解汽油|抽余碳四/i, traits: ['易燃易爆'], key: '碳四/碳五/裂解气' },
  { re: /乙苯|异丙苯|MTBE|甲基叔丁基醚/i, traits: ['易燃', '有毒'], key: '乙苯/醚类' },
  { re: /氮气|N2/i, traits: ['窒息性'], key: '氮气（窒息）' },
  { re: /原油/i, traits: ['易燃', '含硫化氢'], key: '原油' },
];
// 中等：可燃液体、腐蚀性、高温
const MEDIUM_MED = [
  { re: /柴油|航煤|煤油|喷气燃料/i, traits: ['可燃'], key: '中间馏分' },
  { re: /蜡油|渣油|油浆|重油|减压渣油/i, traits: ['可燃', '高温烫伤'], key: '重质油' },
  { re: /润滑油|导热油|密封油|调和油/i, traits: ['可燃'], key: '油品' },
  { re: /硫酸|盐酸|硝酸|磷酸|酸性水|含硫污水/i, traits: ['腐蚀', '有毒'], key: '酸' },
  { re: /碱液|氢氧化钠|烧碱/i, traits: ['腐蚀'], key: '碱' },
  { re: /胺液|MDEA|贫胺|富胺|乙醇胺|MEA|DEA/i, traits: ['腐蚀', '含硫化氢'], key: '胺液' },
  { re: /乙二醇|\bEG\b|二甘醇|三甘醇|丙二醇/i, traits: ['可燃', '高温烫伤'], key: '乙二醇（EG）/多元醇' },
  { re: /乙酸|醋酸|丙酮|乙醛|丁醇|辛醇/i, traits: ['可燃', '腐蚀或刺激'], key: '有机酸/酮醛醇' },
  { re: /催化剂|溶剂|糠醛|抽余|抽出/i, traits: ['可燃或有毒'], key: '溶剂/催化剂' },
];
// 低危
const MEDIUM_LOW = [
  { re: /除盐水|循环水|冷却水|软化水|新鲜水|(?<![污废])水(?!煤气)/i, traits: [], key: '水' },
  { re: /蒸汽|凝结水|伴热/i, traits: ['高温烫伤'], key: '蒸汽' },
  { re: /仪表风|净化风|压缩空气|空气/i, traits: [], key: '空气' },
];

/**
 * classifyMedium(medium)
 * 返回 {level:'high'|'medium'|'low'|'unknown', key, traits[], effective:'high'|'medium'|'low', inLibrary:bool}
 * 不在库 → level 'unknown' 且 effective 'high'（最严口径），**绝不返回 low**
 */
function classifyMedium(medium) {
  const s = String(medium || '').trim();
  if (!s) return { level: 'unknown', key: '', traits: [], effective: 'high', inLibrary: false, raw: '' };
  for (const m of MEDIUM_HIGH) if (m.re.test(s)) return { level: 'high', key: m.key, traits: m.traits, effective: 'high', inLibrary: true, raw: s };
  for (const m of MEDIUM_MED) if (m.re.test(s)) return { level: 'medium', key: m.key, traits: m.traits, effective: 'medium', inLibrary: true, raw: s };
  for (const m of MEDIUM_LOW) if (m.re.test(s)) return { level: 'low', key: m.key, traits: m.traits, effective: 'low', inLibrary: true, raw: s };
  return { level: 'unknown', key: '', traits: [], effective: 'high', inLibrary: false, raw: s };
}

// ---------------------------------------------------------------- 设备类型
const EQUIP_TYPES = [
  { key: 'pump', cn: '泵', re: /泵|机泵/ },
  { key: 'compressor', cn: '压缩机', re: /压缩机|风机|鼓风机|引风机|增压机/ },
  { key: 'vessel', cn: '容器/罐', re: /容器|罐|槽|储罐|缓冲罐|分液罐|分离器|反应器/ },
  { key: 'column', cn: '塔器', re: /塔/ },
  { key: 'exchanger', cn: '换热器', re: /换热器|冷却器|再沸器|冷凝器|空冷/ },
  { key: 'furnace', cn: '加热炉', re: /加热炉|锅炉|炉/ },
  { key: 'pipeline', cn: '管线/阀门', re: /管线|管道|阀门|调节阀|安全阀/ },
  { key: 'electrical', cn: '电气设备', re: /电机|变频|配电|开关柜|变压器|电气|马达/ },
  { key: 'instrument', cn: '仪表', re: /仪表|变送器|分析仪|流量计|联锁/ },
];
const EQUIP_CN = EQUIP_TYPES.reduce((o, t) => (o[t.key] = t.cn, o), { other: '其他设备' });
/**
 * 返回设备类型 key；无法识别返回 'other'（不影响必做条目，只影响专项条目）
 * 先按显式填写的设备类型判，类型判不出再看设备名称。
 * 「循环水泵电机」这类复合名里「泵」会先于「电机」命中，故类型字段优先。
 */
function classifyEquip(type, name) {
  for (const src of [type, name]) {
    const s = String(src || '');
    if (!s.trim()) continue;
    for (const t of EQUIP_TYPES) if (t.re.test(s)) return t.key;
  }
  return 'other';
}
/** 是否为带转动部件的机组（需机械隔离：盘车防转、联轴器拆除） */
const ROTATING = ['pump', 'compressor'];
/** 是否为承压设备本体（需泄压确认） */
const PRESSURE_VESSEL = ['vessel', 'column', 'exchanger', 'furnace', 'pipeline'];

// ---------------------------------------------------------------- 三态解析
/** 返回 true | false | null（未说明 → null，交由规则判 undetermined） */
function tri(v) {
  if (v === true) return true;
  if (v === false) return false;
  const s = String(v === null || v === undefined ? '' : v).trim();
  if (!s) return null;
  if (/^(是|有|需|要|Y|yes|true|1|带压|高温)/i.test(s)) return true;
  if (/^(否|无|不|没|N|no|false|0|常压|常温)/i.test(s)) return false;
  return null;
}

// ---------------------------------------------------------------- 条目分类
const CATEGORY_CN = {
  shutdown: '停车',
  isolation: '工艺隔离',
  depressurize: '泄压',
  cooling: '降温',
  purge: '吹扫置换',
  analysis: '取样分析',
  electrical: '断电挂牌上锁',
  mechanical: '机械隔离',
  housekeeping: '现场清理',
  barrier: '围栏警示',
};

// ---------------------------------------------------------------- 规则表
/**
 * 每条规则：
 *   id       规则号，可追溯到 references/handover-rules.md
 *   category 条目分类
 *   title    条目内容
 *   basis    生成依据（写进交出单，供复核）
 *   verify   确认方式
 *   owner    责任岗位
 *   critical 是否关键条目（置换分析合格 / 盲板加装 / 断电挂牌）
 *   when(ctx) 返回 true 生成 / false 不生成 / {undetermined:'缺失字段说明'} 未判定
 *
 * ctx 字段：
 *   haz       classifyMedium() 结果
 *   equip     设备类型 key
 *   entry     是否进受限空间 true|false|null
 *   hotwork   是否用火作业 true|false|null
 *   pressured 是否带压 true|false|null
 *   hot       是否高温 true|false|null
 *   dismantle 是否解体/拆卸（由检修内容判定）
 *   temp      操作温度（数值或 null）
 *   pressure  操作压力（数值或 null）
 */
const RULES = [
  // ---- H 系列：停车与工艺隔离（所有设备必做）
  {
    id: 'H1', category: 'shutdown', critical: false,
    title: '设备按工艺规程停车，确认无进出料、无运行指令',
    basis: '任何交出检修的设备均须先行停车',
    verify: '现场确认 DCS 状态与就地状态一致', owner: '工艺',
    when: () => true,
  },
  {
    id: 'H2', category: 'isolation', critical: false,
    title: '关闭设备进出口阀门并挂「禁止操作」标识牌',
    basis: '工艺隔离第一道：切断与运行系统的连通',
    verify: '逐阀核对阀位并记录阀号', owner: '工艺',
    when: () => true,
  },
  {
    id: 'H3', category: 'isolation', critical: true,
    title: '在设备进出口加装盲板（规格与位置按盲板图），并登记盲板台账；拆装盲板须先办理盲板抽堵作业许可',
    basis: (ctx) => `介质${hazText(ctx.haz)}，仅关阀不足以保证隔离可靠，须加盲板做实体隔离；盲板抽堵属作业许可八大类之一（《中国石化作业许可管理规定》）`,
    verify: '盲板抽堵作业许可已办理，盲板加装后由工艺与设备双方确认并登记编号', owner: '工艺 + 设备',
    when: (ctx) => (ctx.haz.effective === 'high' || ctx.entry === true || ctx.hotwork === true) ? true
      : (ctx.haz.effective === 'medium' ? true : false),
  },
  {
    id: 'H4', category: 'isolation', critical: false,
    title: '高危介质进出口采用双阀隔离（双阀关闭并在两阀间设置泄放/放空）',
    basis: '高危介质单阀内漏风险大，须双阀加中间泄放确认无内漏',
    verify: '开启两阀间泄放确认无压力、无介质窜出', owner: '工艺',
    when: (ctx) => ctx.haz.effective === 'high',
  },
  {
    id: 'H5', category: 'isolation', critical: false,
    title: '需拆除的连通管线按拆线方案断开，断口做好封堵',
    basis: '检修内容涉及解体或管线拆除，拆线后须封堵防止串料',
    verify: '现场核对断口位置与封堵状态', owner: '检修',
    when: (ctx) => ctx.dismantle === true,
  },

  // ---- P 系列：泄压与降温
  {
    id: 'P1', category: 'depressurize', critical: false,
    title: '设备泄压至常压，就地压力表指示为零并确认无憋压',
    basis: (ctx) => ctx.pressured === true
      ? '设备带压，须泄压至常压方可拆卸法兰或人孔'
      : '未说明是否带压，该类设备通常带压运行，泄压要求待用户确认后再定（脚本不按压力数值推断）',
    verify: '就地压力表读数 + 打开低点放空确认无残压', owner: '工艺',
    when: (ctx) => {
      if (ctx.pressured === true) return true;
      if (ctx.pressured === false) return false;
      // 承压类设备未说明是否带压 → 未判定，绝不默认不需要
      if (PRESSURE_VESSEL.includes(ctx.equip) || ROTATING.includes(ctx.equip)) {
        return { undetermined: '未说明设备是否带压（须给 --pressured 是/否；--pressure 数值只记录不推断）' };
      }
      return false;
    },
  },
  {
    id: 'P2', category: 'cooling', critical: false,
    title: '设备降温至厂内设备交出规定的温度后方可交出（进人作业另按受限空间作业要求），具体限值以厂内制度与检修方案为准',
    basis: (ctx) => ctx.hot === true
      ? '设备为高温设备，未降温直接拆卸存在烫伤与介质自燃风险'
      : '未说明是否高温，该类设备通常带温运行，降温要求待用户确认后再定（脚本不按温度数值推断）',
    verify: '测温枪测量壳体/介质温度并记录数值', owner: '工艺',
    when: (ctx) => {
      if (ctx.hot === true) return true;
      if (ctx.hot === false) return false;
      if (['column', 'exchanger', 'furnace', 'vessel'].includes(ctx.equip) || ctx.haz.effective === 'high') {
        return { undetermined: '未说明设备是否高温（须给 --hot 是/否；--temp 数值只记录不推断）' };
      }
      return false;
    },
  },

  // ---- Q 系列：吹扫置换与分析
  {
    id: 'Q1', category: 'purge', critical: false,
    title: '设备内介质排净（排凝、扫线至污油/火炬系统），确认无存液',
    basis: '交出前必须排净残存介质，避免拆卸时喷溅',
    verify: '低点排凝确认无液体排出', owner: '工艺',
    when: (ctx) => ctx.haz.effective !== 'low' || ctx.dismantle === true,
  },
  {
    id: 'Q2', category: 'purge', critical: false,
    title: (ctx) => `用${ctx.haz.effective === 'high' ? '蒸汽/氮气' : '蒸汽或水'}对设备进行吹扫置换，置换时间与次数按工艺规程执行`,
    basis: (ctx) => `介质${hazText(ctx.haz)}，须彻底置换后方可交出`,
    verify: '记录置换介质、压力、持续时间与置换次数', owner: '工艺',
    when: (ctx) => ctx.haz.effective !== 'low' || ctx.entry === true || ctx.hotwork === true,
  },
  {
    id: 'Q3', category: 'analysis', critical: true,
    title: '置换后取样分析，可燃气体、有毒气体含量合格并出具分析报告',
    basis: (ctx) => `介质${hazText(ctx.haz)}，置换效果必须以分析数据为准，不得凭经验判断`,
    verify: '化验室分析报告或便携式检测仪读数，注明取样点与取样时间', owner: '工艺 + 安全',
    when: (ctx) => ctx.haz.effective === 'high' || ctx.haz.effective === 'medium' || ctx.entry === true || ctx.hotwork === true,
  },
  {
    id: 'Q4', category: 'analysis', critical: true,
    title: '受限空间氧含量分析合格（19.5%~23.5%，依据 GB 30871-2022，以厂内分析标准为准）且有毒有害气体（含硫化氢、一氧化碳）低于接触限值',
    basis: '检修需进入受限空间，氧含量与毒性气体分析是办理受限空间作业许可、进入前的强制条件',
    verify: '取样时效与作业中断后重新分析的要求按受限空间作业许可执行，注明取样点与取样时间', owner: '安全 + 属地监护人',
    when: (ctx) => {
      if (ctx.entry === true) return true;
      if (ctx.entry === false) return false;
      // 容器/塔器类设备未说明是否进人 → 未判定
      if (['vessel', 'column', 'furnace'].includes(ctx.equip)) {
        return { undetermined: '未说明检修是否需要进入受限空间（--entry）' };
      }
      return false;
    },
  },
  {
    id: 'Q5', category: 'purge', critical: false,
    title: '受限空间持续通风，落实双监护（属地监护人 + 作业单位监护人），监护人不得离岗',
    basis: '受限空间作业须保持通风与全程双监护（《中国石化作业许可管理规定》）',
    verify: '确认通风设施运行、两名监护人到岗并登记姓名', owner: '安全 + 检修',
    when: (ctx) => {
      if (ctx.entry === true) return true;
      if (ctx.entry === false) return false;
      if (['vessel', 'column', 'furnace'].includes(ctx.equip)) {
        return { undetermined: '未说明检修是否需要进入受限空间（--entry）' };
      }
      return false;
    },
  },
  {
    id: 'Q6', category: 'analysis', critical: false,
    title: '用火点及周边可燃气体分析合格（合格限值按 GB 30871-2022 与厂内分析标准）',
    basis: '检修涉及用火作业，用火前须做可燃气体分析，并办理用火作业许可（级别以作业票为准，脚本不自判）',
    verify: '分析时效与中断后重新分析的要求按用火作业许可执行', owner: '安全',
    when: (ctx) => ctx.hotwork === true,
  },

  // ---- E 系列：电气隔离
  {
    id: 'E1', category: 'electrical', critical: true,
    title: '设备电源断电，在配电室开关柜挂牌上锁（LOTO），钥匙由检修负责人保管',
    basis: '设备带电动机或电气驱动，须断电并挂牌上锁防止误送电（电气检修由电气专业执行，设备员只核对挂牌记录）',
    verify: '现场验电确认无电压，核对挂牌编号与上锁状态', owner: '电气',
    when: (ctx) => ROTATING.includes(ctx.equip) || ctx.equip === 'electrical' || ctx.equip === 'instrument',
  },
  {
    id: 'E2', category: 'electrical', critical: false,
    title: '高压设备断电后验电并装设接地线，接地线编号登记',
    basis: '电气设备检修须验电、放电并装设接地线消除剩余电荷',
    verify: '验电器验电 + 接地线装设位置与编号记录', owner: '电气',
    when: (ctx) => ctx.equip === 'electrical',
  },
  {
    id: 'E3', category: 'electrical', critical: false,
    title: '相关联锁、自保与报警按审批手续摘除或旁路，并在联锁台账登记',
    basis: '检修期间联锁误动作会造成非计划联动，须按手续摘除并登记',
    verify: '联锁摘除申请单编号 + 仪表确认', owner: '仪表 + 工艺',
    when: (ctx) => ctx.equip === 'instrument' || ROTATING.includes(ctx.equip) || ctx.entry === true,
  },

  // ---- M 系列：机械隔离
  {
    id: 'M1', category: 'mechanical', critical: false,
    title: '转动设备盘车确认无卡涩后采取防转措施（锁定联轴器或加装防转销）',
    basis: '机组存在转动部件，须防止检修中意外转动伤人',
    verify: '现场确认防转措施到位', owner: '检修 + 设备',
    when: (ctx) => ROTATING.includes(ctx.equip),
  },
  {
    id: 'M2', category: 'mechanical', critical: false,
    title: '拆除联轴器（或拆下皮带），使驱动端与被驱动端彻底脱开',
    basis: '解体检修须使驱动端与设备本体脱开，仅靠断电不足以防止盘动',
    verify: '现场确认联轴器已拆除并做好标记', owner: '检修',
    when: (ctx) => ROTATING.includes(ctx.equip) && ctx.dismantle === true,
  },

  // ---- S 系列：现场条件
  {
    id: 'S1', category: 'housekeeping', critical: false,
    title: '检修现场清理干净：清除积油积水、可燃物与杂物，地沟与井口做好封堵',
    basis: '交出前须清理现场，用火作业时更须清除周边可燃物',
    verify: '现场检查并拍照留存', owner: '工艺 + 检修',
    when: () => true,
  },
  {
    id: 'S2', category: 'housekeeping', critical: false,
    title: '用火点周边 15 米内清除可燃物（距离按《中国石化作业许可管理规定》用火作业要求，以厂内制度为准），配置灭火器材与消防水带，必要时铺设防火毯',
    basis: '用火作业须落实消防措施并清理周边可燃物（出处：中石化用火作业规定）',
    verify: '清点消防器材数量与有效期，确认监火人与双监护人到位', owner: '安全 + 检修',
    when: (ctx) => ctx.hotwork === true,
  },
  {
    id: 'S3', category: 'barrier', critical: false,
    title: '检修区域设置围栏与警示标识，必要时设专人看护，禁止无关人员进入',
    basis: '交出区域须与运行区域物理隔开，防止误入与交叉作业',
    verify: '现场确认围栏与标识牌设置到位', owner: '检修',
    when: () => true,
  },
  {
    id: 'S4', category: 'barrier', critical: false,
    title: '高危介质设备交出后在周边设置气体检测报警仪，并明确疏散路线',
    basis: (ctx) => `介质${hazText(ctx.haz)}，交出后仍需对残留逸散做持续监测`,
    verify: '确认报警仪已布置、处于有效期内并已标定', owner: '安全',
    when: (ctx) => ctx.haz.effective === 'high',
  },
];

function hazText(haz) {
  if (!haz.inLibrary) return `「${haz.raw || '未填写'}」不在危险特性库，已按最严（高危）口径处理`;
  return `为${HAZ_CN[haz.level]}${haz.traits.length ? '（' + haz.traits.join('、') + '）' : ''}`;
}
const resolve = (v, ctx) => (typeof v === 'function' ? v(ctx) : v);

/**
 * buildItems(ctx) → {items[], undetermined[], criticalItems[]}
 * items 中每条 confirmed 一律 null（脚本不得预填），由现场人员填写。
 */
function buildItems(ctx) {
  const items = [], undetermined = [];
  let seq = 0;
  for (const rule of RULES) {
    const r = rule.when(ctx);
    if (r === false) continue;
    const base = {
      ruleId: rule.id,
      category: rule.category,
      categoryCn: CATEGORY_CN[rule.category],
      title: resolve(rule.title, ctx),
      basis: resolve(rule.basis, ctx),
      verify: rule.verify,
      owner: rule.owner,
      critical: !!rule.critical,
    };
    if (r === true) {
      items.push({ no: ++seq, ...base, required: true, status: 'pending', confirmed: null, confirmedBy: null, confirmedAt: null });
    } else if (r && r.undetermined) {
      // 未判定：条目仍然列出，但标 undetermined 并单列，绝不按「不需要」处理
      const it = { no: ++seq, ...base, required: null, status: 'undetermined', missing: r.undetermined, confirmed: null, confirmedBy: null, confirmedAt: null };
      items.push(it);
      undetermined.push({ no: it.no, ruleId: rule.id, categoryCn: it.categoryCn, title: it.title, missing: r.undetermined });
    }
  }
  const criticalItems = items.filter((x) => x.critical)
    .map((x) => ({ no: x.no, ruleId: x.ruleId, categoryCn: x.categoryCn, title: x.title, status: x.status, confirmed: x.confirmed }));
  return { items, undetermined, criticalItems };
}

/**
 * requiredPermits(ctx, items) → 本次交出涉及的作业许可（中石化作业许可八大类命名）
 * 只提示需要办理哪些票，级别与审批由作业许可系统与作业票为准；预检用 permit-precheck-bridge。
 */
function requiredPermits(ctx, items) {
  const out = [];
  if (ctx.hotwork === true) out.push('用火作业');
  if (ctx.entry === true) out.push('受限空间作业');
  if (items.some((x) => x.ruleId === 'H3' && x.status !== 'undetermined')) out.push('盲板抽堵作业');
  return out;
}

/** 从检修内容文本判定是否涉及解体/拆卸 */
function isDismantle(scope) {
  return /解体|拆卸|拆除|抽芯|更换|检修内件|开盖|打开人孔|吊出|返厂/.test(String(scope || ''));
}

module.exports = {
  classifyMedium, HAZ_CN, hazText,
  classifyEquip, EQUIP_CN, ROTATING, PRESSURE_VESSEL,
  tri, isDismantle, requiredPermits,
  CATEGORY_CN, RULES, buildItems,
};
