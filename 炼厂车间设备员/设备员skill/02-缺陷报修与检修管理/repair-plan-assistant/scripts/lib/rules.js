'use strict';
/**
 * 检修方案作业步骤规则引擎
 * 口径见 references/procedure-*.md
 * 核心原则（与 SKILL.md 硬约束一一对应）：
 *   1. **具体数值一律不由脚本生成**。力矩、间隙、公差、试压值、对中偏差等只能来自 --spec 指向的厂内规程/说明书原文；
 *      无出处的一律输出「待查规程确认」，并进 toBeConfirmed。脚本内不存任何凭经验的数值。
 *   2. 设备类型不在覆盖范围 → 只出通用框架（G 系列）+ warning，标「待技术人员补充」，
 *      绝不用通用知识填充具体拆装步骤、力矩值与间隙标准。
 *   3. 厂内规程与通用口径冲突 → 以厂内规程为准，冲突点进 conflicts 供用户确认。
 *   4. 判定依据缺失（如未说明是否解体）→ 相关步骤 undetermined 单列，绝不按最省事或最完整默认。
 */

// ---------------------------------------------------------------- 数值占位
/** 方案中凡需要具体数值处一律写这句；配 --spec 命中时替换为规程原文 + 出处 */
const TBC = '待查规程确认';
/** 数值类占位的统一措辞（写进 md 与 json） */
const tbcText = (what) => `${what}：**${TBC}**（厂内规程/说明书未提供，不得凭经验填写）`;

/** 数值关键词：用于在厂内规程正文里定位可引用的原文段落 */
const VALUE_KINDS = [
  { key: 'torque', cn: '紧固力矩', re: /力矩|扭矩|N·m|N\.m|Nm(?![a-z])/i },
  { key: 'clearance', cn: '配合间隙', re: /间隙|游隙|轴向窜量|串量|窜量/ },
  { key: 'tolerance', cn: '公差与跳动', re: /公差|跳动|圆度|椭圆度|不圆度|同轴度|直线度/ },
  { key: 'pressure', cn: '试压/严密性压力', re: /试压|水压试验|气密|严密性|强度试验|试验压力/ },
  { key: 'alignment', cn: '对中偏差', re: /对中|找正|同心度|径向偏差|轴向偏差|联轴器偏差/ },
  { key: 'electrical', cn: '电气试验值', re: /绝缘电阻|兆欧|耐压|直流电阻|介损|吸收比|极化指数/ },
  { key: 'vibration', cn: '振动与温升限值', re: /振动|烈度|温升|轴承温度/ },
  { key: 'balance', cn: '动平衡等级', re: /动平衡|平衡等级|剩余不平衡|G[0-9]/ },
  { key: 'calibration', cn: '校验精度/误差', re: /精度|示值误差|基本误差|回差|允差|准确度等级|零点漂移|切换差/ },
  { key: 'thermal', cn: '炉管/壁厚/温度限值', re: /壁温|炉管|炉膛|蠕变|胀粗|氧含量|排烟温度|管壁温度|翅片/ },
];

// ---------------------------------------------------------------- 设备类型
/**
 * 覆盖范围（超出即只出通用框架）：
 *   pump        离心泵 / 往复泵
 *   rotating    压缩机与机组（含汽轮机、风机拖动机组）
 *   static      塔器、容器、换热器（静设备）
 *   valve       阀门（含安全阀、调节阀）
 *   electrical  电机与电气设备
 */
const EQUIP_TYPES = [
  { key: 'instrument', cn: '仪表回路类（变送器/调节阀/联锁回路）', re: /仪表|变送器|调节阀|控制阀|切断阀|回路|联锁|SIS|DCS|热电偶|热电阻|流量计|液位计|分析仪|压力表|温度计|定位器|执行机构/ },
  { key: 'pump', cn: '泵类（离心泵/往复泵）', re: /泵|柱塞|隔膜|螺杆(?!压缩)/ },
  { key: 'rotating', cn: '机组类（压缩机/风机/汽轮机）', re: /压缩机|机组|汽轮机|透平|膨胀机|风机|鼓风机|引风机|增压机|螺杆压缩/ },
  { key: 'furnace', cn: '加热炉类（管式加热炉/烧嘴/炉管）', re: /加热炉|工业炉|管式炉|烧嘴|燃烧器|炉管|余热锅炉|转化炉|裂解炉|炉/ },
  { key: 'aircooler', cn: '空冷器类（空冷器/风机/管束）', re: /空冷|空气冷却器|空冷器|空冷风机/ },
  { key: 'static', cn: '静设备（塔器/容器/换热器）', re: /塔|容器|罐|槽|换热器|冷却器|再沸器|冷凝器|分离器|反应器|过滤器|管道|管线/ },
  { key: 'valve', cn: '阀门类', re: /阀/ },
  { key: 'electrical', cn: '电气类（电机/变频器/配电）', re: /电机|马达|电动机|变频|配电|开关柜|变压器|电气/ },
];
const EQUIP_CN = EQUIP_TYPES.reduce((o, t) => (o[t.key] = t.cn, o), { generic: '覆盖范围外设备' });
/** 覆盖范围内的类型 key */
const COVERED = EQUIP_TYPES.map((t) => t.key);

/**
 * classifyEquip(type, name) → key；识别不到返回 'generic'
 * 设备类型字段优先于设备名称：「循环水泵电机」按填写的类型判，避免「泵」先命中。
 * 阀门放在泵/机组之后判，「泵出口阀」这类名称里「泵」先命中属预期（以类型字段为准）。
 */
function classifyEquip(type, name) {
  for (const src of [type, name]) {
    const s = String(src || '');
    if (!s.trim()) continue;
    for (const t of EQUIP_TYPES) if (t.re.test(s)) return t.key;
  }
  return 'generic';
}

// ---------------------------------------------------------------- 三态解析
/** true | false | null（未说明 → null，绝不默认 false） */
function tri(v) {
  if (v === true) return true;
  if (v === false) return false;
  const s = String(v === null || v === undefined ? '' : v).trim();
  if (!s) return null;
  if (/^(是|有|需|要|Y|yes|true|1)/i.test(s)) return true;
  if (/^(否|无|不|没|N|no|false|0)/i.test(s)) return false;
  return null;
}

/** 从检修内容文本判定是否解体；识别不到返回 null（不默认「不解体」） */
function isDismantle(scope) {
  const s = String(scope || '');
  if (!s.trim()) return null;
  if (/解体|拆检|拆卸|拆除|抽芯|抽出|开盖|打开人孔|更换.*(转子|叶轮|轴|轴承|机封|机械密封|内件|管束|阀芯|阀瓣|绕组|炉管|烧嘴|翅片管|膜盒|定位器)|(炉管|烧嘴|管束|机封|机械密封|轴承|转子|叶轮|内件|阀芯|绕组|翅片管|变送器|执行机构|膜盒)[^，。；,;]*更换|大修|大检修|返厂|吊出|揭盖|进炉膛|拆表/.test(s)) return true;
  if (/不解体|外部检查|外观检查|不拆|在线|清洗外表|紧固|加油|润滑油更换|测振|点检/.test(s)) return false;
  return null;
}

/** 检修等级：大修/中修/小修/专项；识别不到 null */
/**
 * 检修分级（中石化口径）：装置大检修（停工检修）/ 日常维修 / 抢修 / 专项（技改技措）
 * 旧口径「大修/中修/小修」保留为别名：大修→大检修，中修/小修→日常维修。
 */
const LEVELS = [
  { key: 'overhaul', cn: '大检修（停工检修）', re: /大检修|停工检修|大修|A级检修|全面检修/ },
  { key: 'emergency', cn: '抢修', re: /抢修|紧急抢修|应急抢修|事故抢修/ },
  { key: 'special', cn: '专项（技改技措）', re: /专项|技改|技措|项目检修|改造/ },
  { key: 'routine', cn: '日常维修', re: /日常维修|日常检修|日常|中修|小修|B级检修|C级检修|消缺|临修|临时/ },
];
/** 旧口径别名 → 现口径 */
const LEVEL_ALIASES = { medium: 'routine', minor: 'routine' };
function classifyLevel(scope, level) {
  for (const src of [level, scope]) {
    const s = String(src || '');
    if (!s.trim()) continue;
    if (LEVEL_ALIASES[s.trim()]) return LEVEL_ALIASES[s.trim()];
    for (const t of LEVELS) if (t.key === s.trim()) return t.key;
    for (const t of LEVELS) if (t.re.test(s)) return t.key;
  }
  return null;
}
const LEVEL_CN = LEVELS.reduce((o, t) => (o[t.key] = t.cn, o), {});

// ---------------------------------------------------------------- 步骤阶段
const PHASE_CN = {
  prepare: '施工准备',
  isolate: '隔离交出确认',
  dismantle: '解体拆卸',
  inspect: '检查测量',
  repair: '修复更换',
  assemble: '回装装配',
  test: '试验试运',
  close: '收尾交付',
};
const PHASE_ORDER = ['prepare', 'isolate', 'dismantle', 'inspect', 'repair', 'assemble', 'test', 'close'];

// ---------------------------------------------------------------- 通用框架（G 系列）
/**
 * 每条步骤：
 *   id        步骤号，可追溯到 references/procedure-*.md
 *   phase     阶段
 *   title     步骤内容
 *   note      注意事项
 *   needValue 该步骤涉及的数值类型 key（VALUE_KINDS），为 null 表示无数值要求
 *   when(ctx) true 生成 / false 不生成 / {undetermined:'缺失依据'} 未判定
 *
 * **绝对禁止**：title / note 里写任何具体数值。需要数值处只写 needValue，由 buildPlan 统一挂 TBC 或规程引用。
 */
const GENERIC_STEPS = [
  { id: 'G1', phase: 'prepare', needValue: null, when: () => true,
    title: '编制并审批检修方案、技术交底与安全交底，作业人员资质与人数确认到位',
    note: '本方案为初稿，交底前须经技术负责人审核批准' },
  { id: 'G2', phase: 'prepare', needValue: null, when: () => true,
    title: '工机具、量具、备件、材料到场清点，量具在检定有效期内',
    note: '量具超期或无检定证书的不得用于检修测量' },
  { id: 'G3', phase: 'isolate', needValue: null, when: () => true,
    title: '确认设备已按《检修前设备交出确认》完成停车、隔离、泄压、降温、置换与断电挂牌，交出单四方签字齐全',
    note: '交出条件核对接 equipment-handover-check 技能；安全措施合规性核查接 overhaul-process-check-bridge' },
  { id: 'G4', phase: 'isolate', needValue: null, when: () => true,
    title: '按《中国石化作业许可管理规定》办理相应作业许可（用火、受限空间、高处、吊装、临时用电、动土、断路、盲板抽堵），许可票证到现场悬挂',
    note: '作业票预检接 permit-precheck-bridge，本方案不替代票证办理；拆装盲板须单独办理盲板抽堵作业许可' },
  { id: 'G11', phase: 'isolate', needValue: null, when: () => true,
    title: '作业前完成 JSA/风险分析并交底，落实 HSE 措施：属地监护人与作业单位监护人双监护到位、应急措施与撤离路线明确、个体防护按介质配置',
    note: 'JSA/风险分析与 HSE 措施见方案第三节占位，由车间安全员/属地单位与作业单位共同填写；合规性核查接 overhaul-process-check-bridge' },
  { id: 'G5', phase: 'dismantle', needValue: null,
    when: (ctx) => ctx.dismantle === true ? true
      : (ctx.dismantle === false ? false : { undetermined: '未说明本次检修是否解体（--dismantle / 检修内容中未出现解体类词）' }),
    title: '解体前做好原始记录：部件相对位置打标记、垫片与调整垫记录厚度、拆下件分类摆放登记',
    note: '原始数据是回装的唯一依据，缺失后只能返查规程' },
  { id: 'G6', phase: 'inspect', needValue: null, when: () => true,
    title: '对检修部位做外观检查与尺寸测量，测量数据逐项记入检修记录',
    note: '测量结论须与厂内规程判废标准比对，规程未提供时标「待查规程确认」' },
  { id: 'G7', phase: 'repair', needValue: null, when: () => true,
    title: '按检查结论确定修复或更换方案，更换件须核对型号、材质与合格证明',
    note: '超出方案范围的修复内容须履行方案变更手续' },
  { id: 'G8', phase: 'assemble', needValue: 'torque', when: () => true,
    title: '按拆卸逆序回装，紧固件按规定顺序与力矩对称紧固',
    note: '紧固力矩须引用厂内规程或设备说明书' },
  { id: 'G9', phase: 'test', needValue: null, when: () => true,
    title: '按厂内规定完成检修后试验与试运，试运期间记录运行参数',
    note: '试运合格判据须引用厂内规程；未提供时标「待查规程确认」' },
  { id: 'G10', phase: 'close', needValue: null, when: () => true,
    title: '现场清理、工机具回收、盲板拆除登记、联锁恢复，办理竣工验收与交付运行手续',
    note: '竣工验收接 completion-acceptance 技能；检修记录归档接 maintenance-record-archive' },
];

// ---------------------------------------------------------------- 分类型步骤
const TYPE_STEPS = {
  // ----------------------------------------------------------- 泵类
  pump: [
    { id: 'PU1', phase: 'prepare', needValue: null, when: () => true,
      title: '查阅该泵上次检修记录、运行状态与缺陷记录，明确本次检修的针对性内容',
      note: '重复性故障须先接 repeat-failure-detector 判别，避免重复修同一部位' },
    { id: 'PU2', phase: 'isolate', needValue: null, when: () => true,
      title: '拆除联轴器护罩，测量并记录检修前联轴器对中数据、泵轴窜量与径向跳动作为原始值',
      note: '检修前原始对中数据是判断基础下沉与管线应力的依据，不得省略' },
    { id: 'PU3', phase: 'dismantle', needValue: null,
      when: (ctx) => ctx.dismantle === true ? true : (ctx.dismantle === false ? false : { undetermined: '未说明是否解体' }),
      title: '拆除联轴器（按规定用拉马，不得敲击），断开冷却水、封液、润滑油等附属管线并做好标记封堵',
      note: '拆卸联轴器禁止火焰加热与锤击，防止轴弯曲' },
    { id: 'PU4', phase: 'dismantle', needValue: null,
      when: (ctx) => ctx.dismantle === true ? true : (ctx.dismantle === false ? false : { undetermined: '未说明是否解体' }),
      title: '按顺序拆卸泵盖、叶轮、机械密封与轴承箱，记录各调整垫片厚度与叶轮口环位置',
      note: '机械密封为精密件，拆下后单独包装，动静环密封面不得磕碰' },
    { id: 'PU5', phase: 'inspect', needValue: 'clearance', when: () => true,
      title: '测量口环配合间隙、叶轮与泵体间隙，与规程规定的间隙标准比对',
      note: '间隙标准须引用厂内规程或泵说明书' },
    { id: 'PU6', phase: 'inspect', needValue: 'tolerance', when: () => true,
      title: '检查泵轴弯曲度、轴颈磨损与轴套配合，测量轴的径向跳动',
      note: '轴弯曲度与跳动的判废值须引用厂内规程' },
    { id: 'PU7', phase: 'inspect', needValue: 'clearance', when: () => true,
      title: '检查滚动轴承游隙与滚道磨蚀情况；滑动轴承检查合金层与轴瓦间隙、接触角',
      note: '轴承游隙与轴瓦间隙标准须引用厂内规程或轴承手册原文' },
    { id: 'PU8', phase: 'inspect', needValue: null, when: () => true,
      title: '检查叶轮汽蚀与冲刷磨损、口环磨损、平衡盘（鼓）磨损情况，检查泵体腐蚀与结垢',
      note: '叶轮减薄或汽蚀穿孔的处置须由技术人员判定，不得现场自行补焊' },
    { id: 'PU9', phase: 'repair', needValue: 'balance', when: () => true,
      title: '更换机械密封、轴承、O 形圈与密封垫片；叶轮修复或更换后按规定等级做动平衡',
      note: '动平衡等级与剩余不平衡量须引用厂内规程或说明书' },
    { id: 'PU10', phase: 'assemble', needValue: 'clearance', when: () => true,
      title: '装配转子部件，调整叶轮轴向位置与转子窜量，安装机械密封并按规定压缩量调整',
      note: '转子窜量与机封压缩量须引用厂内规程或机封安装说明书' },
    { id: 'PU11', phase: 'assemble', needValue: 'alignment', when: () => true,
      title: '回装联轴器，用百分表（或激光对中仪）做泵与电机对中，热态膨胀量按规程预留',
      note: '对中径向与轴向偏差允许值、热膨胀预留量须引用厂内规程' },
    { id: 'PU12', phase: 'test', needValue: 'pressure', when: () => true,
      title: '泵体与附属管线按规定压力做严密性试验，检查有无渗漏',
      note: '试验压力与保压时间须引用厂内规程或设备铭牌设计参数' },
    { id: 'PU13', phase: 'test', needValue: 'vibration', when: () => true,
      title: '盘车灵活无卡涩后单机试运，记录振动、轴承温度、电流、出口压力与机封泄漏情况',
      note: '振动与轴承温度限值须引用厂内规程（如 ISO 10816 的厂内采用值）' },
  ],

  // ----------------------------------------------------------- 机组类
  rotating: [
    { id: 'RO1', phase: 'prepare', needValue: null, when: () => true,
      title: '调阅机组运行历史、在线监测（振动/位移/温度）趋势与上次大修记录，明确本次解体范围',
      note: '机组检修范围变更须经技术负责人书面确认' },
    { id: 'RO2', phase: 'prepare', needValue: null, when: () => true,
      title: '确认起重方案与吊装机具（转子、缸体吊装），起重作业单独办理作业许可',
      note: '转子吊装须专用吊具，严禁用钢丝绳直接兜吊轴颈与密封部位' },
    { id: 'RO3', phase: 'isolate', needValue: null, when: () => true,
      title: '确认润滑油、密封油、干气密封气源已隔离泄压，盘车装置断电锁定，透平进汽/进气阀加盲板',
      note: '机组隔离点多，须逐点核对盲板图后确认' },
    { id: 'RO4', phase: 'isolate', needValue: 'alignment', when: () => true,
      title: '记录检修前机组冷态对中数据、缸体标高与各轴承箱位移原始值',
      note: '对中与标高原始值及允许偏差须引用厂内规程' },
    { id: 'RO5', phase: 'dismantle', needValue: null,
      when: (ctx) => ctx.dismantle === true ? true : (ctx.dismantle === false ? false : { undetermined: '未说明是否解体' }),
      title: '揭缸：拆除缸体连接螺栓（按规定顺序松扣）、销子与管口，按标记吊出上缸并翻转存放',
      note: '缸体螺栓松扣顺序与热紧拆卸方式须按厂内规程执行' },
    { id: 'RO6', phase: 'dismantle', needValue: null,
      when: (ctx) => ctx.dismantle === true ? true : (ctx.dismantle === false ? false : { undetermined: '未说明是否解体' }),
      title: '解体前测量并记录各处通流间隙、轴瓦间隙与推力间隙原始值，然后吊出转子放入专用支架',
      note: '原始间隙数据必须在解体前测量，事后无法补测' },
    { id: 'RO7', phase: 'inspect', needValue: 'clearance', when: () => true,
      title: '测量径向轴瓦间隙、推力瓦间隙与轴向总窜量，与规程规定值比对',
      note: '轴瓦间隙与推力间隙标准须引用厂内规程或机组说明书' },
    { id: 'RO8', phase: 'inspect', needValue: 'tolerance', when: () => true,
      title: '检查转子叶片（叶轮）结垢、腐蚀、裂纹与冲蚀，测量轴颈圆度、锥度与转子弯曲',
      note: '转子裂纹须做无损检测，判废标准引用厂内规程；圆度与弯曲允许值同样引用规程' },
    { id: 'RO9', phase: 'inspect', needValue: 'clearance', when: () => true,
      title: '检查迷宫密封（气封）齿磨损与间隙、干气密封件状态，检查联轴器膜片或齿式联轴器磨损',
      note: '密封齿间隙标准须引用厂内规程' },
    { id: 'RO10', phase: 'repair', needValue: 'balance', when: () => true,
      title: '转子清洗除垢、更换密封件与轴瓦；转子经修复或更换叶片后须送专业机构做高速动平衡',
      note: '动平衡转速、平衡等级与剩余不平衡量须引用厂内规程或制造厂技术文件' },
    { id: 'RO11', phase: 'assemble', needValue: 'clearance', when: () => true,
      title: '回装转子，复测并调整通流间隙、轴瓦间隙、推力间隙与密封间隙，做好记录',
      note: '各项间隙的调整目标值须引用厂内规程，不得按经验取中值' },
    { id: 'RO12', phase: 'assemble', needValue: 'torque', when: () => true,
      title: '扣缸：清理结合面、按规定涂密封胶，按顺序与力矩（必要时热紧）紧固缸体螺栓',
      note: '紧固顺序、力矩值与热紧温度/伸长量须引用厂内规程' },
    { id: 'RO13', phase: 'assemble', needValue: 'alignment', when: () => true,
      title: '机组整体对中（含驱动机、增速箱、被驱动机），预留热态位移量',
      note: '各对轮对中允许偏差与热膨胀预留量须引用厂内规程' },
    { id: 'RO14', phase: 'test', needValue: 'pressure', when: () => true,
      title: '机组本体与油系统、气密系统按规定压力做气密性与严密性试验',
      note: '试验压力、介质与保压时间须引用厂内规程' },
    { id: 'RO15', phase: 'test', needValue: null, when: () => true,
      title: '油系统冲洗至清洁度合格，联锁保护（超速、轴位移、振动、低油压）校验并传动试验合格',
      note: '油品清洁度等级与各联锁定值须引用厂内规程与联锁定值表，不得现场估设' },
    { id: 'RO16', phase: 'test', needValue: 'vibration', when: () => true,
      title: '盘车、空负荷试运、升速试验与带负荷试运，逐档记录振动、轴位移、瓦温与油温',
      note: '各转速下振动与瓦温限值、升速禁区须引用厂内规程与机组说明书' },
  ],

  // ----------------------------------------------------------- 静设备
  static: [
    { id: 'ST1', phase: 'prepare', needValue: null, when: () => true,
      title: '调阅设备档案：制造资料、设计参数、上次检验与检修报告、腐蚀监测数据，确认是否属特种设备',
      note: '属特种设备的，检验与修理须符合定期检验要求，接 special-equipment-inspection-due 核对到期情况' },
    { id: 'ST2', phase: 'isolate', needValue: null, when: () => true,
      title: '确认设备已置换分析合格、盲板加装到位；需进人的确认受限空间作业条件（氧含量、有毒气体、通风、监护）',
      note: '受限空间进入条件由安全部门确认，本方案不替代分析与许可' },
    { id: 'ST3', phase: 'dismantle', needValue: null,
      when: (ctx) => ctx.dismantle === true ? true : (ctx.dismantle === false ? false : { undetermined: '未说明是否解体/开盖' }),
      title: '打开人孔（或拆卸管箱、封头），设备内自然通风后强制通风，进人前再次分析合格',
      note: '人孔螺栓拆卸须先确认内部无压，松扣时人员避开法兰正面' },
    { id: 'ST4', phase: 'dismantle', needValue: null,
      when: (ctx) => ctx.dismantle === true ? true : (ctx.dismantle === false ? false : { undetermined: '未说明是否解体/抽芯' }),
      title: '换热器按抽芯方案抽出管束并妥善支撑；塔器按顺序拆卸塔盘（填料），逐层标记编号',
      note: '抽芯与塔内件拆卸须防止碰伤密封面与内件变形' },
    { id: 'ST5', phase: 'inspect', needValue: null, when: () => true,
      title: '清理设备内壁、管束与内件的结垢、聚合物与腐蚀产物，清洗方式按介质特性选择',
      note: '高压水清洗、化学清洗须单独编制作业方案与安全措施' },
    { id: 'ST6', phase: 'inspect', needValue: 'tolerance', when: () => true,
      title: '壁厚测定（重点部位与历次测点对照）、腐蚀形貌检查、焊缝与接管角焊缝无损检测',
      note: '最小允许壁厚、腐蚀速率判据与无损检测合格级别须引用厂内规程与设计文件' },
    { id: 'ST7', phase: 'inspect', needValue: null, when: () => true,
      title: '检查内件：塔盘变形与腐蚀、降液板与堰板、填料与支撑、分布器；换热器检查管板、胀口与折流板',
      note: '内件缺陷的修复或更换须经技术人员判定' },
    { id: 'ST8', phase: 'inspect', needValue: null, when: () => true,
      title: '检查防腐衬里、隔热层与设备基础、支座、地脚螺栓状况',
      note: '衬里鼓包、开裂的处置须按衬里修复工艺执行' },
    { id: 'ST9', phase: 'repair', needValue: null, when: () => true,
      title: '按检查结论修复：堵管或换管、补焊、内件更换、衬里修补；承压部件补焊须有焊接工艺与焊工资质',
      note: '承压部件焊接修复属重大修理，须履行相应审批与检验手续' },
    { id: 'ST10', phase: 'assemble', needValue: null, when: () => true,
      title: '内件回装并复查安装位置与水平度，清点工机具与杂物、确认设备内无遗留后封闭人孔',
      note: '封人孔前的清点与确认须双人签字，避免遗留物进入系统' },
    { id: 'ST11', phase: 'assemble', needValue: 'torque', when: () => true,
      title: '更换人孔与法兰垫片，按对角顺序分次紧固螺栓至规定力矩',
      note: '垫片型号材质、紧固力矩与分次紧固比例须引用厂内规程' },
    { id: 'ST12', phase: 'test', needValue: 'pressure', when: () => true,
      title: '按规定做水压（或气密）试验，升压分段保压、检查焊缝与法兰连接处渗漏',
      note: '试验压力、介质温度、升压速率与保压时间须引用厂内规程与设计文件，严禁自行折算' },
  ],

  // ----------------------------------------------------------- 阀门
  valve: [
    { id: 'VA1', phase: 'prepare', needValue: null, when: () => true,
      title: '核对阀门型号、公称通径、压力等级、材质与执行机构型式，确认备件与阀门检修台位',
      note: '安全阀须同时核对整定压力与上次校验日期，校验接有资质的单位' },
    { id: 'VA2', phase: 'isolate', needValue: null, when: () => true,
      title: '确认阀门所在管段已隔离泄压置换；需拆下返修的做好管口封堵与阀门标识',
      note: '带介质阀门拆下时仍可能残留物料，作业人员按介质要求佩戴防护' },
    { id: 'VA3', phase: 'dismantle', needValue: null,
      when: (ctx) => ctx.dismantle === true ? true : (ctx.dismantle === false ? false : { undetermined: '未说明是否解体' }),
      title: '解体阀门：拆下阀盖、阀杆与阀芯（阀瓣），记录各零件装配关系与填料层数',
      note: '阀盖拆卸前须确认阀腔无压无料' },
    { id: 'VA4', phase: 'inspect', needValue: null, when: () => true,
      title: '检查阀座与阀芯（阀瓣）密封面的冲蚀、划伤与点蚀，检查阀杆弯曲、磨损与螺纹状况',
      note: '密封面缺陷深度超限的须研磨或更换，判废标准引用厂内规程' },
    { id: 'VA5', phase: 'inspect', needValue: null, when: () => true,
      title: '检查阀体腐蚀减薄、填料函与填料压盖、阀门执行机构（气动/电动）与定位器',
      note: '阀体壁厚判废标准引用厂内规程；执行机构故障处理接仪表专业' },
    { id: 'VA6', phase: 'repair', needValue: 'tolerance', when: () => true,
      title: '研磨密封面至接触线连续，更换填料、垫片与紧固件；安全阀更换弹簧或阀芯后重新整定',
      note: '密封面接触宽度、研磨后的平面度、安全阀整定压力与回座压差均须引用厂内规程与铭牌参数' },
    { id: 'VA7', phase: 'assemble', needValue: 'torque', when: () => true,
      title: '按顺序回装阀芯、阀杆、填料与阀盖，填料分层压装、错开切口，阀盖螺栓按规定力矩对称紧固',
      note: '填料压装量与阀盖螺栓力矩须引用厂内规程' },
    { id: 'VA8', phase: 'test', needValue: 'pressure', when: () => true,
      title: '做壳体强度试验与密封（低压密封、高压密封）试验；安全阀做整定压力与密封性试验并铅封出具报告',
      note: '各项试验压力、持续时间与允许泄漏量须引用厂内规程与阀门标准，不得凭经验取值' },
    { id: 'VA9', phase: 'close', needValue: null, when: () => true,
      title: '阀门标识、铅封与检修记录（含试验报告）随阀交付，安全阀校验报告存档并更新校验台账',
      note: '校验台账更新接 valve-instrument-calibration-ledger 技能' },
  ],

  // ----------------------------------------------------------- 电气
  electrical: [
    { id: 'EL1', phase: 'prepare', needValue: null, when: () => true,
      title: '核对电机铭牌参数（功率、电压、电流、转速、绝缘等级、防爆标志）与备件绕组、轴承型号',
      note: '防爆电机的检修与修复须保持防爆性能，由具备防爆维修资质的单位实施' },
    { id: 'EL2', phase: 'isolate', needValue: null, when: () => true,
      title: '确认电机电源已断开、验电、放电并挂牌上锁（LOTO），高压电机装设接地线，钥匙由检修负责人保管',
      note: '送电前的解锁由挂锁人本人完成，严禁他人代解' },
    { id: 'EL3', phase: 'isolate', needValue: 'electrical', when: () => true,
      title: '测量检修前绕组绝缘电阻与吸收比、直流电阻，作为与检修后对比的原始值',
      note: '绝缘电阻、吸收比与直流电阻不平衡率的合格值须引用厂内电气试验规程' },
    { id: 'EL4', phase: 'dismantle', needValue: null,
      when: (ctx) => ctx.dismantle === true ? true : (ctx.dismantle === false ? false : { undetermined: '未说明是否解体' }),
      title: '拆除接线盒接线（做好相序标记）、联轴器与地脚螺栓，吊出电机送检修间；抽出转子时防止碰伤绕组',
      note: '相序标记错误会导致反转，回装前必须核对' },
    { id: 'EL5', phase: 'inspect', needValue: null, when: () => true,
      title: '检查定子绕组绝缘老化、变色、槽楔松动与端部绑扎，检查转子鼠笼条（或滑环、集电环）',
      note: '绕组烧损、鼠笼条断裂的处置须由电气技术人员判定' },
    { id: 'EL6', phase: 'inspect', needValue: 'clearance', when: () => true,
      title: '检查轴承磨损与游隙、轴承室配合，检查定转子气隙均匀度',
      note: '轴承游隙、轴承室配合公差与气隙不均匀度允许值须引用厂内规程或电机说明书' },
    { id: 'EL7', phase: 'repair', needValue: null, when: () => true,
      title: '清洁绕组与通风道、绝缘处理（烘干或浸漆）、更换轴承与密封；绕组重绕须由专业厂家实施',
      note: '烘干温度与时间、浸漆工艺须按厂内规程或绕组绝缘等级执行' },
    { id: 'EL8', phase: 'assemble', needValue: null, when: () => true,
      title: '回装转子与端盖，加注规定牌号与数量的润滑脂，回装接线并核对相序，恢复接地连接',
      note: '润滑脂牌号与加注量须引用厂内规程或说明书；接地连接为强制项' },
    { id: 'EL9', phase: 'test', needValue: 'electrical', when: () => true,
      title: '检修后电气试验：绝缘电阻与吸收比、直流电阻、必要时做耐压试验，出具试验报告',
      note: '各项试验值的合格判据与耐压试验电压须引用厂内电气试验规程，不得凭经验判定' },
    { id: 'EL10', phase: 'test', needValue: 'vibration', when: () => true,
      title: '空载试运转，检查转向、电流、振动、轴承温度与声音；合格后与被驱动机对中并联轴带负荷试运',
      note: '空载电流、振动与轴承温升限值须引用厂内规程' },
  ],

  // ----------------------------------------------------------- 加热炉
  furnace: [
    { id: 'FU1', phase: 'prepare', needValue: null, when: () => true,
      title: '调阅加热炉运行记录（炉膛温度、炉管壁温、排烟温度、氧含量）、上次检修与炉管测厚/蠕变检测报告，明确本次检修范围（炉管、烧嘴、衬里、空气预热器、风机）',
      note: '炉管属受监部件，检修范围变更须经技术负责人确认；属特种设备（余热锅炉）的接 special-equipment-inspection-due' },
    { id: 'FU2', phase: 'isolate', needValue: null, when: () => true,
      title: '确认燃料气/燃料油管线加盲板、吹扫置换分析合格，炉膛通风降温至可进人条件，进炉膛属受限空间作业',
      note: '燃料气盲板位置按盲板图逐点核对；进炉膛前再次做氧含量与可燃气分析' },
    { id: 'FU3', phase: 'dismantle', needValue: null,
      when: (ctx) => ctx.dismantle === true ? true : (ctx.dismantle === false ? false : { undetermined: '未说明是否进炉膛解体（拆烧嘴/拆炉管/拆衬里）' }),
      title: '拆除烧嘴（记录烧嘴编号与安装角度）、打开看火门与人孔，拆除需更换的炉管段与衬里',
      note: '烧嘴与炉管编号须与炉管布置图一致，便于回装与测厚数据对照' },
    { id: 'FU4', phase: 'inspect', needValue: 'thermal', when: () => true,
      title: '炉管外观检查（鼓包、弯曲、氧化皮、结焦）、壁厚测定与蠕变/胀粗测量，测点与历次对照',
      note: '炉管判废的壁厚、胀粗率与蠕变判据须引用厂内规程与设计文件' },
    { id: 'FU5', phase: 'inspect', needValue: null, when: () => true,
      title: '检查炉管吊架、管卡、弯头箱与回弯头，检查耐火衬里脱落、开裂与炉体钢结构变形',
      note: '衬里修补工艺须单独编制' },
    { id: 'FU6', phase: 'inspect', needValue: null, when: () => true,
      title: '检查烧嘴配风器、火嘴头结焦磨损、点火器与火焰检测器，检查空气预热器与引风机状态',
      note: '烧嘴型式与喷嘴孔径按制造厂文件，不得现场扩孔' },
    { id: 'FU7', phase: 'repair', needValue: null, when: () => true,
      title: '更换判废炉管段（焊接须有焊接工艺评定与焊工资质）、更换烧嘴部件、修补衬里',
      note: '炉管焊接属受监焊口，焊后须无损检测并出具报告' },
    { id: 'FU8', phase: 'assemble', needValue: 'torque', when: () => true,
      title: '回装烧嘴（按原编号与角度）、看火门与人孔，法兰螺栓按规定力矩紧固',
      note: '紧固力矩须引用厂内规程' },
    { id: 'FU9', phase: 'test', needValue: 'pressure', when: () => true,
      title: '炉管系统按规定做水压（或气密）试验，燃料气管线做气密试验',
      note: '试验压力与保压时间须引用厂内规程与设计文件' },
    { id: 'FU10', phase: 'test', needValue: 'thermal', when: () => true,
      title: '衬里烘炉（新衬里时）、点火升温按升温曲线执行，记录炉膛温度、炉管壁温与氧含量',
      note: '烘炉与升温曲线、壁温与氧含量限值须引用厂内规程' },
  ],

  // ----------------------------------------------------------- 空冷器
  aircooler: [
    { id: 'AC1', phase: 'prepare', needValue: null, when: () => true,
      title: '调阅空冷器运行记录（出口温度、风机电流、振动）、上次检修记录与管束泄漏历史，明确本次范围（管束、风机、减速/皮带、百叶窗）',
      note: '空冷管束属承压部件，属压力容器管理的接 special-equipment-inspection-due' },
    { id: 'AC2', phase: 'isolate', needValue: null, when: () => true,
      title: '确认管束进出口已隔离泄压置换加盲板，风机电机断电挂牌上锁，高处作业平台与防坠措施到位',
      note: '空冷器检修多为高处作业，须办理高处作业许可' },
    { id: 'AC3', phase: 'dismantle', needValue: null,
      when: (ctx) => ctx.dismantle === true ? true : (ctx.dismantle === false ? false : { undetermined: '未说明是否拆管箱/拆风机' }),
      title: '拆除管箱丝堵或管箱盖（记录位置），拆除风机叶片、皮带或联轴器，吊出需更换的管束或电机',
      note: '丝堵与管箱垫片按编号摆放；吊装须办理吊装作业许可' },
    { id: 'AC4', phase: 'inspect', needValue: 'tolerance', when: () => true,
      title: '管束检查：翅片管翅片倒伏与积灰、管端胀口泄漏、管箱腐蚀；壁厚测定与历次对照',
      note: '翅片管壁厚与胀口泄漏判废标准须引用厂内规程' },
    { id: 'AC5', phase: 'inspect', needValue: 'clearance', when: () => true,
      title: '风机检查：叶片角度与一致性、叶尖与风筒间隙、轮毂与轴承游隙、减速箱或皮带磨损',
      note: '叶尖间隙与轴承游隙标准须引用厂内规程或制造厂说明书' },
    { id: 'AC6', phase: 'repair', needValue: 'balance', when: () => true,
      title: '堵管或换管、翅片梳理清洗、更换风机轴承/皮带/叶片；叶片更换后做静平衡或动平衡',
      note: '平衡等级与叶片角度须引用厂内规程或说明书' },
    { id: 'AC7', phase: 'assemble', needValue: 'torque', when: () => true,
      title: '回装管箱盖与丝堵（更换垫片）、风机叶片与护网，法兰与丝堵按规定力矩紧固',
      note: '紧固力矩须引用厂内规程' },
    { id: 'AC8', phase: 'test', needValue: 'pressure', when: () => true,
      title: '管束按规定做水压（气密）试验，检查管端胀口与丝堵渗漏',
      note: '试验压力与保压时间须引用厂内规程与设计文件' },
    { id: 'AC9', phase: 'test', needValue: 'vibration', when: () => true,
      title: '风机空载试运，检查转向、电流、振动与轴承温度；百叶窗开度与电机调速功能确认',
      note: '振动与轴承温度限值须引用厂内规程' },
  ],

  // ----------------------------------------------------------- 仪表回路
  instrument: [
    { id: 'IN1', phase: 'prepare', needValue: null, when: () => true,
      title: '核对仪表位号、型号、量程、测量介质与联锁归属（SIS/DCS），确认是否涉及联锁回路及联锁定值',
      note: '涉及联锁的，检修前须按厂内规定办理联锁摘除/投用审批；联锁定值变更属工艺/仪表归口，本方案不涉及' },
    { id: 'IN2', phase: 'isolate', needValue: null, when: () => true,
      title: '确认取压/引压管线已关闭隔离阀并泄压，联锁已按审批旁路或摘除，仪表供电/气源断开并挂牌',
      note: '联锁旁路期间的补偿措施由工艺与仪表专业确认' },
    { id: 'IN3', phase: 'dismantle', needValue: null,
      when: (ctx) => ctx.dismantle === true ? true : (ctx.dismantle === false ? false : { undetermined: '未说明是否拆表/拆执行机构' }),
      title: '拆下变送器/执行机构送校验室或在线校验，拆线前做好接线标记与回路编号',
      note: '接线标记错误会导致回路错接，回装前必须核对' },
    { id: 'IN4', phase: 'inspect', needValue: 'calibration', when: () => true,
      title: '按量程做校验（零点、满度、线性、回差），记录校验前后数据',
      note: '示值误差与回差允许值须引用厂内仪表校验规程或仪表说明书；压力表温度计检定属计量归口' },
    { id: 'IN5', phase: 'inspect', needValue: null, when: () => true,
      title: '检查引压管线堵塞、泄漏与伴热，检查调节阀阀芯阀座冲蚀、填料泄漏、定位器与气源过滤减压器',
      note: '调节阀本体解体与密封面研磨接阀门口径（VA 系列）' },
    { id: 'IN6', phase: 'repair', needValue: null, when: () => true,
      title: '更换损坏元件（膜盒、电子件、定位器、填料），回路电缆与接线端子整修',
      note: '防爆区仪表更换件须保持防爆等级' },
    { id: 'IN7', phase: 'assemble', needValue: null, when: () => true,
      title: '回装仪表与执行机构，恢复接线并核对回路编号，引压管线恢复并排气/排污',
      note: '接线核对须双人确认' },
    { id: 'IN8', phase: 'test', needValue: 'calibration', when: () => true,
      title: '回路联校（现场仪表→DCS/SIS 显示），调节阀行程试验与全行程时间，联锁回路按审批做传动试验后投用',
      note: '联校允差与联锁传动试验要求须引用厂内规程；联锁定值与联锁定值表核对，不得现场估设' },
    { id: 'IN9', phase: 'close', needValue: null, when: () => true,
      title: '联锁恢复投用并签字，校验记录与联校记录归档，更新校验台账',
      note: '校验台账更新接 valve-instrument-calibration-ledger' },
  ],
};

// ---------------------------------------------------------------- 工机具 / 备件
/** 工机具：按设备类型给通用清单；**规格与量程一律不填具体数值**，由技术人员按设备规格确定 */
const TOOLS = {
  common: [
    { name: '常用扳手、套筒与梅花扳手', use: '螺栓拆装', spec: '按螺栓规格配置' },
    { name: '力矩扳手', use: '按规定力矩紧固', spec: '量程按规程力矩值选配（力矩值待查规程确认）' },
    { name: '撬棍、铜棒、专用拉马', use: '零件拆卸', spec: '禁止用铁锤直接敲击精密件' },
    { name: '手拉葫芦与吊索具', use: '部件吊装', spec: '额定载荷按起吊重量核算，索具须在检验有效期内' },
    { name: '清洗盘、清洗剂、白布与砂纸', use: '零件清洗', spec: '按介质相容性选择清洗剂' },
    { name: '检修记录表与相机', use: '数据与状态留痕', spec: '原始数据须现场记录' },
  ],
  pump: [
    { name: '百分表与磁性表座（或激光对中仪）', use: '对中、跳动与窜量测量', spec: '在检定有效期内' },
    { name: '外径千分尺、内径千分表、塞尺', use: '间隙与配合尺寸测量', spec: '量程按部件尺寸选配' },
    { name: '机械密封专用安装工具', use: '机封安装', spec: '按机封型号配套' },
    { name: '轴承加热器（感应式）', use: '轴承热装', spec: '加热温度按轴承要求，具体值待查规程确认' },
  ],
  rotating: [
    { name: '专用转子吊具与转子支架', use: '转子吊出与存放', spec: '按制造厂图纸配置' },
    { name: '液压拉伸器 / 螺栓加热棒', use: '缸体螺栓热紧或液压拉伸', spec: '按螺栓规格配套，拉伸值待查规程确认' },
    { name: '内径千分尺、压铅丝与塞尺', use: '通流间隙、轴瓦间隙测量', spec: '在检定有效期内' },
    { name: '光学（激光）对中仪', use: '机组多轴对中', spec: '在检定有效期内' },
    { name: '油系统冲洗滤网与颗粒度检测仪', use: '油冲洗与清洁度检测', spec: '清洁度等级待查规程确认' },
  ],
  static: [
    { name: '超声测厚仪', use: '壁厚测定', spec: '在检定有效期内，测点与历次一致' },
    { name: '无损检测设备（PT/MT/UT/RT）', use: '焊缝与本体检测', spec: '由有资质的检测单位实施' },
    { name: '高压水清洗设备', use: '管束与内壁清洗', spec: '单独编制清洗作业方案' },
    { name: '抽芯机（或卷扬机与抽芯梁）', use: '换热器管束抽出', spec: '按管束重量核算' },
    { name: '试压泵与压力表', use: '水压/气密试验', spec: '压力表量程按试验压力选配（试验压力待查规程确认）' },
    { name: '通风机、照明（安全电压）与气体检测仪', use: '受限空间作业', spec: '照明电压与防爆等级按厂内规定' },
  ],
  valve: [
    { name: '研磨机与研磨膏、研磨平板', use: '密封面研磨', spec: '研磨膏粒度按密封面要求' },
    { name: '填料取出钩与填料压装工具', use: '填料更换', spec: '按填料函尺寸配套' },
    { name: '阀门试压台', use: '壳体与密封试验', spec: '试验压力待查规程确认' },
    { name: '安全阀校验台', use: '安全阀整定与密封试验', spec: '由有资质单位实施，整定压力按铭牌与工艺规定' },
  ],
  electrical: [
    { name: '绝缘电阻表（兆欧表）', use: '绝缘电阻与吸收比测量', spec: '电压等级按电机额定电压选配，在检定有效期内' },
    { name: '直流电阻测试仪', use: '绕组直流电阻测量', spec: '在检定有效期内' },
    { name: '耐压试验装置', use: '交流耐压试验', spec: '试验电压待查规程确认，由持证电气试验人员操作' },
    { name: '轴承加热器与专用拉马', use: '轴承拆装', spec: '禁止明火加热' },
    { name: '相序表与万用表', use: '相序与接线核对', spec: '在检定有效期内' },
    { name: '烘箱或加热装置', use: '绕组烘干', spec: '烘干温度按绝缘等级，具体值待查规程确认' },
  ],
  furnace: [
    { name: '超声测厚仪与炉管外径卡规', use: '炉管壁厚与胀粗测量', spec: '在检定有效期内，测点与历次一致' },
    { name: '无损检测设备（RT/UT/PT）', use: '炉管焊口检测', spec: '由有资质的检测单位实施' },
    { name: '炉膛脚手架与照明（安全电压）', use: '进炉膛作业', spec: '脚手架验收合格后使用' },
    { name: '气体检测仪', use: '炉膛受限空间分析', spec: '在检定有效期内' },
    { name: '试压泵与压力表', use: '炉管水压试验', spec: '压力表量程按试验压力选配（试验压力待查规程确认）' },
  ],
  aircooler: [
    { name: '超声测厚仪', use: '翅片管壁厚测定', spec: '在检定有效期内' },
    { name: '翅片梳与高压水清洗设备', use: '翅片清理', spec: '水压按翅片材质选择，单独编制清洗方案' },
    { name: '角度仪与塞尺', use: '风机叶片角度与叶尖间隙', spec: '在检定有效期内' },
    { name: '高处作业平台与安全带', use: '管束与风机检修', spec: '按高处作业许可要求' },
    { name: '试压泵与压力表', use: '管束水压试验', spec: '试验压力待查规程确认' },
  ],
  instrument: [
    { name: '压力/温度校验仪（标准器）', use: '仪表校验', spec: '准确度等级高于被校仪表，在检定有效期内' },
    { name: '信号发生器与万用表', use: '回路联校', spec: '在检定有效期内' },
    { name: '手操器（HART）', use: '智能变送器组态与标定', spec: '按仪表型号配套' },
    { name: '阀门定位器校验工具', use: '调节阀行程与定位器标定', spec: '按定位器型号' },
  ],
};

/** 备件：只列名称与用途，**数量与规格由技术人员按设备型号确定**，脚本不填 */
const SPARES = {
  pump: [
    { name: '机械密封（含动静环、O 形圈）', when: '解体检修', note: '型号按泵型与介质确定' },
    { name: '轴承（驱动端 / 非驱动端）', when: '解体检修', note: '型号按说明书，游隙组别按规程' },
    { name: '口环（耐磨环）', when: '间隙超标时', note: '材质按介质与泵型确定' },
    { name: '泵体与泵盖密封垫片、O 形圈', when: '解体检修', note: '材质按介质与温度确定' },
    { name: '轴套、轴、叶轮', when: '检查判废后', note: '属大件，须核对图号' },
    { name: '联轴器弹性件（柱销/膜片）', when: '磨损或老化时', note: '按联轴器型号' },
  ],
  rotating: [
    { name: '径向轴瓦与推力瓦', when: '间隙超标或合金损伤', note: '按机组型号，须核对瓦号' },
    { name: '干气密封（或机械密封、浮环密封）组件', when: '解体检修', note: '属精密件，须由制造厂或授权方供货' },
    { name: '迷宫密封（气封）件', when: '齿磨损超标', note: '材质按厂内规程' },
    { name: '缸体结合面密封件与各处 O 形圈', when: '揭缸检修', note: '耐温等级按工况' },
    { name: '联轴器膜片（或齿形套）', when: '磨损或疲劳裂纹', note: '按联轴器型号' },
    { name: '润滑油、密封油与滤芯', when: '大修', note: '油品牌号按厂内规程' },
    { name: '叶轮（叶片）、转子', when: '检查判废后', note: '属重大备件，须专项申请' },
  ],
  static: [
    { name: '人孔与法兰垫片', when: '开盖检修', note: '型号材质按介质、温度与压力等级确定' },
    { name: '换热管（堵管用堵头或换管用管子）', when: '泄漏管处理', note: '材质与母材一致' },
    { name: '塔盘（填料）及其紧固件', when: '内件损坏', note: '按塔内件图纸' },
    { name: '防腐衬里修补材料', when: '衬里缺陷修补', note: '按衬里工艺配套' },
    { name: '螺栓螺母（人孔、法兰）', when: '锈蚀或螺纹损伤', note: '材质等级按设计' },
  ],
  valve: [
    { name: '填料（盘根）', when: '解体检修', note: '材质按介质与温度，层数按填料函深度' },
    { name: '阀盖垫片', when: '解体检修', note: '按阀门压力等级与介质' },
    { name: '阀芯（阀瓣）与阀座', when: '密封面判废后', note: '须与阀体型号配套' },
    { name: '阀杆', when: '弯曲或磨损超标', note: '材质按原设计' },
    { name: '安全阀弹簧', when: '整定压力变更或弹簧失效', note: '弹簧工作范围须覆盖整定压力' },
  ],
  electrical: [
    { name: '轴承（驱动端 / 非驱动端）', when: '解体检修', note: '型号与游隙组别按说明书' },
    { name: '润滑脂', when: '轴承更换或补脂', note: '牌号与加注量按厂内规程' },
    { name: '接线端子、接线板与密封件', when: '老化或烧蚀', note: '防爆电机须用原配防爆件' },
    { name: '绝缘漆与绝缘材料', when: '绝缘处理', note: '等级不低于原绝缘等级' },
    { name: '定子绕组（成套）', when: '绕组烧损', note: '重绕须由专业厂家实施' },
  ],
  furnace: [
    { name: '炉管与回弯头', when: '判废更换', note: '材质规格按设计文件，须核对材质证明' },
    { name: '烧嘴喷头与配风器部件', when: '磨损结焦判废', note: '按烧嘴型号' },
    { name: '耐火衬里材料与锚固件', when: '衬里修补', note: '按衬里设计' },
    { name: '看火门/人孔垫片与紧固件', when: '解体检修', note: '耐温等级按工况' },
  ],
  aircooler: [
    { name: '翅片管', when: '泄漏或减薄判废', note: '材质规格按设计文件' },
    { name: '管箱丝堵与垫片', when: '解体检修', note: '按管箱型式与压力等级' },
    { name: '风机轴承、皮带、叶片', when: '磨损判废', note: '按风机型号' },
    { name: '百叶窗执行机构部件', when: '失灵时', note: '按型号' },
  ],
  instrument: [
    { name: '变送器膜盒/电子件', when: '校验不合格且不可调', note: '按仪表型号' },
    { name: '调节阀填料、定位器、膜片', when: '泄漏或失灵', note: '按阀门与定位器型号' },
    { name: '引压管件、阀门与接线端子', when: '损坏时', note: '材质按介质' },
  ],
  generic: [
    { name: '密封垫片与紧固件', when: '解体检修', note: '型号材质待技术人员确定' },
  ],
};

// ---------------------------------------------------------------- 质量控制点
/**
 * 每个控制点：id / phase / item / method / standard(始终为占位或规程引用) / valueKind / hold(是否停工待检点)
 * standard 一律不写具体数值。
 */
const QC_POINTS = {
  common: [
    { id: 'QC-G1', phase: 'prepare', item: '方案与交底', method: '查方案审批签字与交底记录', valueKind: null, hold: true },
    { id: 'QC-G2', phase: 'isolate', item: '设备交出条件与作业许可', method: '查交出单签字、盲板台账与作业票', valueKind: null, hold: true },
    { id: 'QC-G3', phase: 'inspect', item: '解体后检查数据记录完整性', method: '查检修记录，逐项数据有测量值与判定', valueKind: null, hold: false },
    { id: 'QC-G4', phase: 'assemble', item: '紧固件紧固力矩', method: '力矩扳手复核并记录', valueKind: 'torque', hold: false },
    { id: 'QC-G5', phase: 'close', item: '设备内与现场无遗留物', method: '双人清点确认并签字', valueKind: null, hold: true },
  ],
  pump: [
    { id: 'QC-PU1', phase: 'inspect', item: '口环与叶轮配合间隙', method: '内径千分尺/塞尺测量，逐点记录', valueKind: 'clearance', hold: false },
    { id: 'QC-PU2', phase: 'inspect', item: '泵轴弯曲度与径向跳动', method: '百分表测量', valueKind: 'tolerance', hold: false },
    { id: 'QC-PU3', phase: 'inspect', item: '轴承游隙 / 轴瓦间隙', method: '塞尺或压铅丝测量', valueKind: 'clearance', hold: false },
    { id: 'QC-PU4', phase: 'assemble', item: '转子轴向窜量与机封压缩量', method: '百分表测量并记录', valueKind: 'clearance', hold: true },
    { id: 'QC-PU5', phase: 'assemble', item: '泵与电机对中偏差', method: '百分表或激光对中仪，出具对中记录', valueKind: 'alignment', hold: true },
    { id: 'QC-PU6', phase: 'test', item: '严密性试验', method: '按规定压力保压并检查渗漏', valueKind: 'pressure', hold: true },
    { id: 'QC-PU7', phase: 'test', item: '试运振动与轴承温度', method: '测振仪与测温枪，定时记录', valueKind: 'vibration', hold: true },
  ],
  rotating: [
    { id: 'QC-RO1', phase: 'dismantle', item: '解体前原始间隙数据', method: '压铅丝/塞尺测量并记录（事后不可补测）', valueKind: 'clearance', hold: true },
    { id: 'QC-RO2', phase: 'inspect', item: '轴瓦间隙与推力间隙', method: '压铅丝与百分表测量', valueKind: 'clearance', hold: true },
    { id: 'QC-RO3', phase: 'inspect', item: '转子无损检测与弯曲度', method: '委托有资质单位检测并出具报告', valueKind: 'tolerance', hold: true },
    { id: 'QC-RO4', phase: 'repair', item: '转子动平衡', method: '专业机构高速动平衡并出具报告', valueKind: 'balance', hold: true },
    { id: 'QC-RO5', phase: 'assemble', item: '通流间隙与密封间隙复测', method: '逐点测量并与规程比对', valueKind: 'clearance', hold: true },
    { id: 'QC-RO6', phase: 'assemble', item: '缸体螺栓热紧（拉伸）量', method: '测量螺栓伸长量并记录', valueKind: 'torque', hold: true },
    { id: 'QC-RO7', phase: 'assemble', item: '机组整体对中', method: '激光对中仪，出具对中记录', valueKind: 'alignment', hold: true },
    { id: 'QC-RO8', phase: 'test', item: '油系统清洁度', method: '取样做颗粒度检测', valueKind: null, hold: true },
    { id: 'QC-RO9', phase: 'test', item: '联锁保护校验', method: '逐项传动试验并签字确认', valueKind: null, hold: true },
    { id: 'QC-RO10', phase: 'test', item: '试运振动、轴位移与瓦温', method: '在线监测与就地记录', valueKind: 'vibration', hold: true },
  ],
  static: [
    { id: 'QC-ST1', phase: 'inspect', item: '壁厚测定', method: '超声测厚，测点与历次对照', valueKind: 'tolerance', hold: true },
    { id: 'QC-ST2', phase: 'inspect', item: '焊缝与接管无损检测', method: '有资质单位检测出具报告', valueKind: null, hold: true },
    { id: 'QC-ST3', phase: 'repair', item: '承压部件焊接修复', method: '查焊接工艺评定、焊工资质与焊后检测', valueKind: null, hold: true },
    { id: 'QC-ST4', phase: 'assemble', item: '封闭前设备内清理确认', method: '双人进入确认无遗留并签字', valueKind: null, hold: true },
    { id: 'QC-ST5', phase: 'assemble', item: '法兰与人孔螺栓紧固', method: '对角分次紧固，力矩扳手复核', valueKind: 'torque', hold: false },
    { id: 'QC-ST6', phase: 'test', item: '水压（气密）试验', method: '按规定压力与保压时间执行，全程旁站', valueKind: 'pressure', hold: true },
  ],
  valve: [
    { id: 'QC-VA1', phase: 'inspect', item: '密封面与阀杆检查', method: '着色检查或目视加测量', valueKind: 'tolerance', hold: false },
    { id: 'QC-VA2', phase: 'repair', item: '密封面研磨接触线', method: '着色检查接触连续性', valueKind: 'tolerance', hold: false },
    { id: 'QC-VA3', phase: 'assemble', item: '填料压装与阀盖紧固', method: '按层压装记录，力矩扳手紧固', valueKind: 'torque', hold: false },
    { id: 'QC-VA4', phase: 'test', item: '壳体强度与密封试验', method: '阀门试压台试验并出具报告', valueKind: 'pressure', hold: true },
    { id: 'QC-VA5', phase: 'test', item: '安全阀整定压力与回座', method: '有资质单位校验、铅封并出报告', valueKind: 'pressure', hold: true },
  ],
  electrical: [
    { id: 'QC-EL1', phase: 'isolate', item: '断电挂牌上锁与验电放电', method: '现场确认并记录挂牌编号', valueKind: null, hold: true },
    { id: 'QC-EL2', phase: 'isolate', item: '检修前绝缘与直流电阻原始值', method: '电气试验并记录', valueKind: 'electrical', hold: false },
    { id: 'QC-EL3', phase: 'inspect', item: '轴承游隙与定转子气隙', method: '塞尺测量，气隙四点对称测量', valueKind: 'clearance', hold: false },
    { id: 'QC-EL4', phase: 'assemble', item: '接线相序与接地连接', method: '相序表核对，接地电阻测量', valueKind: 'electrical', hold: true },
    { id: 'QC-EL5', phase: 'test', item: '检修后电气试验', method: '绝缘电阻、吸收比、直流电阻、耐压，出具报告', valueKind: 'electrical', hold: true },
    { id: 'QC-EL6', phase: 'test', item: '空载与带负荷试运参数', method: '记录电流、振动、轴承温度', valueKind: 'vibration', hold: true },
  ],
  furnace: [
    { id: 'QC-FU1', phase: 'isolate', item: '燃料气盲板与炉膛置换分析', method: '查盲板图与分析单', valueKind: null, hold: true },
    { id: 'QC-FU2', phase: 'inspect', item: '炉管壁厚与胀粗测量', method: '测厚仪与卡规，测点与历次对照', valueKind: 'thermal', hold: true },
    { id: 'QC-FU3', phase: 'repair', item: '炉管焊口无损检测', method: '有资质单位检测出报告', valueKind: null, hold: true },
    { id: 'QC-FU4', phase: 'test', item: '炉管水压（气密）试验', method: '按规定压力保压检查', valueKind: 'pressure', hold: true },
    { id: 'QC-FU5', phase: 'test', item: '烘炉/升温曲线执行', method: '逐时记录炉膛温度与壁温', valueKind: 'thermal', hold: true },
  ],
  aircooler: [
    { id: 'QC-AC1', phase: 'inspect', item: '翅片管壁厚与胀口检查', method: '测厚仪，胀口目视与试漏', valueKind: 'tolerance', hold: false },
    { id: 'QC-AC2', phase: 'inspect', item: '风机叶尖间隙与叶片角度', method: '塞尺与角度仪测量', valueKind: 'clearance', hold: false },
    { id: 'QC-AC3', phase: 'repair', item: '风机叶片平衡', method: '静/动平衡并记录', valueKind: 'balance', hold: true },
    { id: 'QC-AC4', phase: 'test', item: '管束水压（气密）试验', method: '按规定压力保压检查丝堵与胀口', valueKind: 'pressure', hold: true },
    { id: 'QC-AC5', phase: 'test', item: '风机试运振动与轴承温度', method: '测振仪与测温枪', valueKind: 'vibration', hold: true },
  ],
  instrument: [
    { id: 'QC-IN1', phase: 'isolate', item: '联锁摘除/旁路审批', method: '查联锁摘除审批单与补偿措施', valueKind: null, hold: true },
    { id: 'QC-IN2', phase: 'inspect', item: '仪表校验数据', method: '标准器校验，记录零点/满度/回差', valueKind: 'calibration', hold: false },
    { id: 'QC-IN3', phase: 'assemble', item: '接线与回路编号核对', method: '双人核对接线标记', valueKind: null, hold: true },
    { id: 'QC-IN4', phase: 'test', item: '回路联校与联锁传动试验', method: '现场→DCS/SIS 联校，联锁按审批传动', valueKind: 'calibration', hold: true },
    { id: 'QC-IN5', phase: 'close', item: '联锁恢复投用确认', method: '查投用签字与台账更新', valueKind: null, hold: true },
  ],
  generic: [],
};

// ---------------------------------------------------------------- 验收标准
/**
 * 每项验收：id / item / basis(判据来源) / valueKind
 * basis 一律为「引用厂内规程」或「待查规程确认」，脚本不给数值。
 */
const ACCEPTANCE = {
  common: [
    { id: 'AC-G1', item: '检修范围内容全部完成，无遗留项', valueKind: null },
    { id: 'AC-G2', item: '检修记录、测量数据、试验报告齐全并签字', valueKind: null },
    { id: 'AC-G3', item: '紧固件按规定力矩紧固并有复核记录', valueKind: 'torque' },
    { id: 'AC-G4', item: '现场清理干净，盲板拆除登记、联锁恢复确认', valueKind: null },
    { id: 'AC-G5', item: '设备标识、保温、护罩、接地恢复完好', valueKind: null },
  ],
  pump: [
    { id: 'AC-PU1', item: '各部配合间隙在规程允许范围内', valueKind: 'clearance' },
    { id: 'AC-PU2', item: '对中偏差在规程允许范围内并有对中记录', valueKind: 'alignment' },
    { id: 'AC-PU3', item: '严密性试验合格无渗漏', valueKind: 'pressure' },
    { id: 'AC-PU4', item: '试运振动值在规程限值内', valueKind: 'vibration' },
    { id: 'AC-PU5', item: '轴承温度稳定且在规程限值内', valueKind: 'vibration' },
    { id: 'AC-PU6', item: '机械密封无泄漏（或泄漏量在规程允许范围内）', valueKind: null },
    { id: 'AC-PU7', item: '运行电流、出口压力与流量满足工艺要求', valueKind: null },
  ],
  rotating: [
    { id: 'AC-RO1', item: '各处间隙（通流、轴瓦、推力、密封）在规程允许范围内', valueKind: 'clearance' },
    { id: 'AC-RO2', item: '转子动平衡合格并有报告', valueKind: 'balance' },
    { id: 'AC-RO3', item: '机组对中偏差在规程允许范围内', valueKind: 'alignment' },
    { id: 'AC-RO4', item: '气密性试验合格', valueKind: 'pressure' },
    { id: 'AC-RO5', item: '油系统清洁度合格，无渗漏', valueKind: null },
    { id: 'AC-RO6', item: '联锁保护校验合格，定值与联锁定值表一致', valueKind: null },
    { id: 'AC-RO7', item: '试运振动、轴位移、瓦温在规程限值内并连续稳定', valueKind: 'vibration' },
  ],
  static: [
    { id: 'AC-ST1', item: '壁厚满足最小允许壁厚要求', valueKind: 'tolerance' },
    { id: 'AC-ST2', item: '无损检测合格并出具报告', valueKind: null },
    { id: 'AC-ST3', item: '内件安装位置、水平度符合图纸要求', valueKind: 'tolerance' },
    { id: 'AC-ST4', item: '水压（气密）试验合格，无渗漏无变形', valueKind: 'pressure' },
    { id: 'AC-ST5', item: '设备内无遗留物，封闭前双人确认签字', valueKind: null },
  ],
  valve: [
    { id: 'AC-VA1', item: '壳体强度试验合格', valueKind: 'pressure' },
    { id: 'AC-VA2', item: '密封试验泄漏量在允许范围内', valueKind: 'pressure' },
    { id: 'AC-VA3', item: '阀门启闭灵活、行程到位、无卡涩', valueKind: null },
    { id: 'AC-VA4', item: '填料函无泄漏', valueKind: null },
    { id: 'AC-VA5', item: '安全阀整定压力与回座压力合格，铅封完好并有校验报告', valueKind: 'pressure' },
  ],
  electrical: [
    { id: 'AC-EL1', item: '绝缘电阻与吸收比合格', valueKind: 'electrical' },
    { id: 'AC-EL2', item: '绕组直流电阻不平衡率合格', valueKind: 'electrical' },
    { id: 'AC-EL3', item: '耐压试验合格（按规程要求做时）', valueKind: 'electrical' },
    { id: 'AC-EL4', item: '接地可靠，接地电阻合格', valueKind: 'electrical' },
    { id: 'AC-EL5', item: '转向正确，空载与带负荷电流正常', valueKind: null },
    { id: 'AC-EL6', item: '振动与轴承温升在规程限值内', valueKind: 'vibration' },
    { id: 'AC-EL7', item: '防爆电机防爆性能未被破坏并有确认记录', valueKind: null },
  ],
  furnace: [
    { id: 'AC-FU1', item: '炉管壁厚与胀粗在规程允许范围内', valueKind: 'thermal' },
    { id: 'AC-FU2', item: '炉管焊口无损检测合格并出具报告', valueKind: null },
    { id: 'AC-FU3', item: '炉管水压（气密）试验合格', valueKind: 'pressure' },
    { id: 'AC-FU4', item: '烧嘴火焰形态正常，炉膛温度、壁温与氧含量在规程限值内', valueKind: 'thermal' },
    { id: 'AC-FU5', item: '衬里完好无脱落，看火门与人孔密封良好', valueKind: null },
  ],
  aircooler: [
    { id: 'AC-AC1', item: '管束水压（气密）试验合格，丝堵与胀口无渗漏', valueKind: 'pressure' },
    { id: 'AC-AC2', item: '风机叶尖间隙与叶片角度在规程允许范围内', valueKind: 'clearance' },
    { id: 'AC-AC3', item: '风机试运振动与轴承温度在规程限值内', valueKind: 'vibration' },
    { id: 'AC-AC4', item: '翅片清洁，百叶窗与调速功能正常', valueKind: null },
  ],
  instrument: [
    { id: 'AC-IN1', item: '仪表校验误差与回差在规程允许范围内并有校验记录', valueKind: 'calibration' },
    { id: 'AC-IN2', item: '回路联校合格，显示与现场一致', valueKind: 'calibration' },
    { id: 'AC-IN3', item: '调节阀行程、全行程时间与泄漏量满足要求', valueKind: null },
    { id: 'AC-IN4', item: '联锁传动试验合格并恢复投用，有签字确认', valueKind: null },
  ],
  generic: [
    { id: 'AC-GEN1', item: '验收项目待技术人员按设备特性与厂内规程补充', valueKind: null },
  ],
};

// ---------------------------------------------------------------- 厂内规程引用
/**
 * matchSpec(specText, valueKind)
 * 在厂内规程正文里找含该类数值关键词、且含数字的段落；找到返回 {quote, line}，找不到返回 null。
 * **只做原文摘录，不做任何换算、取整或归纳。**
 */
/**
 * stripClauseNo(text) → 去掉行首条款编号后的正文（只用于判断「有没有数值」和比数，引用原文仍用整行）
 * 识别：「1.1 」「2.1联轴器」「3、」「第4.2条」「（3）」，以及表格行首单元格「| 1.1 |」。
 * 行首是「数值 + 单位」（如「180 N·m」「0.30 mm」「0.30 毫米」「3 个月」「2.5 级」）时不当条款号：
 * 条款号后须紧跟中文或括号书名号，且不能是中文单位（「级别」「年度」「天车」「周期」等普通词除外）。
 */
const CN_UNIT = '(?:毫米|厘米|微米|丝|级(?!别)|个(?!别)|天(?!车|然)|周(?!期|边|围)|月(?!度)|年(?!度)|小时|分钟|秒|次(?!序)|倍|兆帕|千帕|千克|公斤|吨|毫升|升)';
const CLAUSE_NO = new RegExp(`^(?:第\\s*\\d+(?:\\.\\d+)*\\s*[条章节款]\\s*|[（(]\\d+[)）]\\s*|\\d+(?:\\.\\d+){1,4}[、．.]?\\s*(?!${CN_UNIT})(?=[一-鿿（(《【「|])|\\d+(?:[、．.]\\s*|\\s+)(?!${CN_UNIT})(?=[一-鿿（(《【「|]))`);
function stripClauseNo(text) {
  const s = String(text == null ? '' : text);
  const lead = s.replace(/^[\s|]*/, '');
  const rest = lead.replace(CLAUSE_NO, '');
  if (rest === lead) return s;
  return rest.replace(/^[\s|]*/, '');
}
const hasValue = (text) => /\d/.test(stripClauseNo(text));

function matchSpec(specLines, valueKind) {
  const kind = VALUE_KINDS.find((k) => k.key === valueKind);
  if (!kind || !specLines || !specLines.length) return null;
  for (const L of specLines) {
    if (!kind.re.test(L.text)) continue;
    if (!hasValue(L.text)) continue; // 无数字（条款号不算）的说明性文字不作为数值出处
    return { quote: L.text.trim(), line: L.line };
  }
  return null;
}

/** 通用口径关键词：出现「一般」「通常」「按经验」等表述时，说明是通用口径而非厂内规定 */
const GENERAL_HINT = /一般|通常|惯例|按经验|参照通用|行业习惯/;

/**
 * paramNames(text, kind) → [{name, kw}]
 * 一行里该类数值关键词所在的参数名称：取关键词所在分句（按 ，；。：分）第一个数字之前的文字，
 * 去掉通用口径词与「不大于 / 按 / 控制在」等比较词。如「1.1 口环间隙 0.30~0.45 mm」→ 口环间隙。
 */
const TRAIL_CMP = /(?:不大于|不小于|不超过|不得超过|不得大于|不得小于|不高于|不低于|不应大于|不应小于|小于|大于|低于|高于|应为|应在|控制在|允许值|允许|为|按|约|在|≤|≥|<|>|=|±|\s)+$/;
function paramNames(text, kind) {
  const body = stripClauseNo(text);
  const re = new RegExp(kind.re.source, kind.re.flags.includes('g') ? kind.re.flags : kind.re.flags + 'g');
  const out = [];
  let m;
  while ((m = re.exec(body))) {
    const segStart = Math.max(...['，', ',', '；', ';', '。', '：', ':', '|'].map((c) => body.lastIndexOf(c, m.index))) + 1;
    const segEndRaw = body.slice(m.index).search(/[，,；;。：:|]/);
    const seg = body.slice(segStart, segEndRaw < 0 ? body.length : m.index + segEndRaw);
    const beforeNum = seg.split(/\d/)[0];
    const name = beforeNum.replace(new RegExp(GENERAL_HINT.source + '|情况下|时', 'g'), '').replace(TRAIL_CMP, '').trim();
    out.push({ name, kw: m[0] });
    if (m[0] === '') re.lastIndex++;
  }
  return out;
}
/** 两个参数名称是否指同一参数：互相包含；或同一关键词且关键词之外有共同的二字中文词（如「叶轮口环配合间隙」与「口环间隙」共有「口环」） */
function sameParam(x, y) {
  if (!x.name || !y.name || x.name.includes(y.name) || y.name.includes(x.name)) return true;
  if (x.kw !== y.kw) return false;
  const bigrams = (s) => { const t = s.split(x.kw).join(' '); const b = new Set(); for (let i = 0; i + 1 < t.length; i++) if (/^[一-鿿]{2}$/.test(t.slice(i, i + 2))) b.add(t.slice(i, i + 2)); return b; };
  const bx = bigrams(x.name);
  for (const g of bigrams(y.name)) if (bx.has(g)) return true;
  return false;
}

/**
 * detectConflicts(specLines, valueKind)
 * 同一数值类型、同一参数在规程中出现多个互不相同的数值段落时，列为冲突点供用户确认；
 * 并把「厂内规程 vs 通用口径」的表述差异标出。**一律以厂内规程为准。**
 * 比数前去掉行首条款编号（「1.1」「1.2」不是数值）；不同参数（如口环间隙与轴承游隙）各自取值，不互相比。
 * 名称无法区分时按同一参数比（宁可多报交技术人员确认，不漏报）。
 */
function detectConflicts(specLines, valueKind) {
  const kind = VALUE_KINDS.find((k) => k.key === valueKind);
  if (!kind || !specLines || !specLines.length) return [];
  const hits = specLines.filter((L) => kind.re.test(L.text) && hasValue(L.text))
    .map((L) => ({ L, names: paramNames(L.text, kind), nums: (stripClauseNo(L.text).match(/\d+(?:\.\d+)?/g) || []).join(',') }));
  if (hits.length < 2) return [];
  const related = (h1, h2) => (!h1.names.length || !h2.names.length) || h1.names.some((x) => h2.names.some((y) => sameParam(x, y)));
  const out = [];
  for (let i = 1; i < hits.length; i++) {
    const j = hits.slice(0, i).findIndex((h) => related(h, hits[i]));   // 与之同参数的最早一条
    if (j < 0) continue;
    if (hits[i].nums === hits[j].nums) continue;
    const A = hits[j].L, B = hits[i].L;
    out.push({
      valueKind, valueKindCn: kind.cn,
      a: { quote: A.text.trim(), line: A.line, general: GENERAL_HINT.test(A.text) },
      b: { quote: B.text.trim(), line: B.line, general: GENERAL_HINT.test(B.text) },
    });
  }
  return out;
}

// ---------------------------------------------------------------- 组装
const resolve = (v, ctx) => (typeof v === 'function' ? v(ctx) : v);

/**
 * buildPlan(ctx) → {steps, undetermined, toBeConfirmed, conflicts, tools, spares, qcPoints, acceptance, covered}
 * ctx: {equip, dismantle, level, specLines(可空), specName}
 *
 * 硬约束落点：
 *   - covered===false → 只用 GENERIC_STEPS，每条 note 追加「待技术人员补充」，不引入任何 TYPE_STEPS
 *   - 任何 needValue 的步骤：specLines 命中 → 引用原文 + 出处；未命中 → TBC 并进 toBeConfirmed
 *   - dismantle 为 null 的解体类步骤 → undetermined 单列
 */
function buildPlan(ctx) {
  const covered = COVERED.includes(ctx.equip);
  const specLines = ctx.specLines || null;
  const specName = ctx.specName || null;

  const pool = covered ? GENERIC_STEPS.concat(TYPE_STEPS[ctx.equip] || []) : GENERIC_STEPS.slice();
  // 按阶段排序，阶段内保持定义顺序（通用步骤在前，专业步骤紧随）
  const ordered = PHASE_ORDER.flatMap((p) => pool.filter((s) => s.phase === p));

  const steps = [], undetermined = [], toBeConfirmed = [];
  let seq = 0;
  for (const s of ordered) {
    const r = s.when(ctx);
    if (r === false) continue;
    const base = {
      stepId: s.id, phase: s.phase, phaseCn: PHASE_CN[s.phase],
      title: resolve(s.title, ctx),
      note: resolve(s.note, ctx) + (covered ? '' : '　**待技术人员补充**'),
      valueKind: s.needValue, valueKindCn: s.needValue ? (VALUE_KINDS.find((k) => k.key === s.needValue) || {}).cn : null,
    };
    // 数值要求：只引用规程原文，绝不生成
    if (s.needValue) {
      const hit = matchSpec(specLines, s.needValue);
      if (hit) {
        base.valueSource = 'spec';
        base.valueText = `${base.valueKindCn}：${hit.quote}`;
        base.valueCitation = `${specName || '厂内规程'} 第 ${hit.line} 行`;
      } else {
        base.valueSource = 'tbc';
        base.valueText = tbcText(base.valueKindCn);
        base.valueCitation = null;
        toBeConfirmed.push({
          stepId: s.id, phaseCn: PHASE_CN[s.phase], where: base.title,
          valueKind: s.needValue, valueKindCn: base.valueKindCn,
          reason: specLines ? `已提供的${specName || '厂内规程'}中未找到${base.valueKindCn}的原文依据` : '未提供厂内规程或设备说明书（--spec）',
          action: `查阅厂内检修规程 / 设备说明书补齐${base.valueKindCn}，补齐前不得施工`,
        });
      }
    } else {
      base.valueSource = 'none'; base.valueText = null; base.valueCitation = null;
    }

    if (r === true) {
      steps.push({ no: ++seq, ...base, status: 'normal', missing: null });
    } else if (r && r.undetermined) {
      const it = { no: ++seq, ...base, status: 'undetermined', missing: r.undetermined };
      steps.push(it);
      undetermined.push({ no: it.no, stepId: s.id, phaseCn: it.phaseCn, title: it.title, missing: r.undetermined });
    }
  }

  // 工机具 / 备件 / 质量控制点 / 验收标准
  const tools = TOOLS.common.concat(covered ? (TOOLS[ctx.equip] || []) : []);
  const spares = covered ? (SPARES[ctx.equip] || SPARES.generic) : SPARES.generic;

  const qcRaw = QC_POINTS.common.concat(covered ? (QC_POINTS[ctx.equip] || []) : []);
  const qcPoints = qcRaw.map((q, i) => {
    const out = {
      no: i + 1, qcId: q.id, phase: q.phase, phaseCn: PHASE_CN[q.phase],
      item: q.item, method: q.method, hold: !!q.hold,
      valueKind: q.valueKind, valueKindCn: q.valueKind ? (VALUE_KINDS.find((k) => k.key === q.valueKind) || {}).cn : null,
    };
    if (q.valueKind) {
      const hit = matchSpec(specLines, q.valueKind);
      if (hit) { out.standard = hit.quote; out.standardSource = 'spec'; out.citation = `${specName || '厂内规程'} 第 ${hit.line} 行`; }
      else {
        out.standard = TBC; out.standardSource = 'tbc'; out.citation = null;
        toBeConfirmed.push({
          stepId: q.id, phaseCn: PHASE_CN[q.phase], where: `质量控制点：${q.item}`,
          valueKind: q.valueKind, valueKindCn: out.valueKindCn,
          reason: specLines ? `已提供的${specName || '厂内规程'}中未找到${out.valueKindCn}的原文依据` : '未提供厂内规程或设备说明书（--spec）',
          action: `查阅厂内检修规程 / 设备说明书补齐${out.valueKindCn}合格判据`,
        });
      }
    } else {
      out.standard = '按厂内规程与本方案要求执行，无数值判据';
      out.standardSource = 'none'; out.citation = null;
    }
    if (!covered) out.item += '（待技术人员补充）';
    return out;
  });

  const acRaw = ACCEPTANCE.common.concat(covered ? (ACCEPTANCE[ctx.equip] || []) : ACCEPTANCE.generic);
  const acceptance = acRaw.map((a, i) => {
    const out = {
      no: i + 1, acId: a.id, item: a.item,
      valueKind: a.valueKind, valueKindCn: a.valueKind ? (VALUE_KINDS.find((k) => k.key === a.valueKind) || {}).cn : null,
    };
    if (a.valueKind) {
      const hit = matchSpec(specLines, a.valueKind);
      if (hit) { out.criterion = hit.quote; out.criterionSource = 'spec'; out.citation = `${specName || '厂内规程'} 第 ${hit.line} 行`; }
      else {
        out.criterion = TBC; out.criterionSource = 'tbc'; out.citation = null;
        toBeConfirmed.push({
          stepId: a.id, phaseCn: '验收', where: `验收标准：${a.item}`,
          valueKind: a.valueKind, valueKindCn: out.valueKindCn,
          reason: specLines ? `已提供的${specName || '厂内规程'}中未找到${out.valueKindCn}的原文依据` : '未提供厂内规程或设备说明书（--spec）',
          action: `查阅厂内检修规程 / 设备说明书补齐${out.valueKindCn}验收判据`,
        });
      }
    } else {
      out.criterion = '定性判据，按厂内规程与本方案要求确认';
      out.criterionSource = 'none'; out.citation = null;
    }
    return out;
  });

  // 冲突点：逐个数值类型检查规程内部是否存在互相矛盾的数值段落
  const conflicts = [];
  for (const k of VALUE_KINDS) conflicts.push(...detectConflicts(specLines, k.key));

  return { steps, undetermined, toBeConfirmed, conflicts, tools, spares, qcPoints, acceptance, covered };
}

// ---------------------------------------------------------------- JSA / 风险分析与 HSE 措施占位
/** 作业许可八大类（《中国石化作业许可管理规定》口径） */
const PERMIT_TYPES = ['用火作业', '受限空间作业', '高处作业', '吊装作业', '临时用电作业', '动土作业', '断路作业', '盲板抽堵作业'];
/**
 * buildHse(ctx) → JSA/风险分析与 HSE 措施占位块。
 * 只给结构与「待填」占位，不替用户判定作业级别、风险等级与具体措施；是否涉及各类作业由方案编制人勾选。
 */
function buildHse(ctx) {
  const likely = new Set();
  if (ctx.dismantle === true) likely.add('盲板抽堵作业');
  if (ctx.equip === 'static' || ctx.equip === 'furnace') likely.add('受限空间作业');
  if (ctx.equip === 'aircooler' || ctx.equip === 'furnace' || ctx.equip === 'static') likely.add('高处作业');
  if (ctx.equip === 'rotating' || ctx.equip === 'aircooler' || ctx.equip === 'static') likely.add('吊装作业');
  return {
    jsa: { no: '待填：JSA/风险分析编号', date: '待填：分析日期', participants: '待填：属地单位、作业单位、安全员参加人', mainRisks: '待填：主要危害因素（介质、能量、高处、受限、吊装、用火等）', riskLevel: '待填：按厂内风险分级（本方案不自判）' },
    permits: PERMIT_TYPES.map((t) => ({ type: t, involved: likely.has(t) ? '可能涉及（待确认）' : '待确认', level: '以作业票为准，本方案不自判级别' })),
    supervision: { siteGuardian: '待填：属地监护人', contractorGuardian: '待填：作业单位监护人', confirmer: '待填：属地确认人', note: '中石化为双监护，两方监护人均须到位' },
    measures: [
      { item: '能量隔离', content: '待填：盲板、断电挂牌上锁（LOTO）、泄压置换的具体位置与确认人' },
      { item: '气体检测', content: '待填：分析项目、频次与合格判据（由安全部门确认，本方案不给数值）' },
      { item: '个体防护', content: '待填：按介质特性配置的防护用品' },
      { item: '应急措施', content: '待填：应急物资、撤离路线、联系人与电话' },
      { item: '交叉作业', content: '待填：与同区域其他作业的协调（可接 cross-operation-conflict 核查）' },
    ],
    note: '本节为占位，须由车间安全员/属地单位与作业单位共同填写后，接 overhaul-process-check-bridge 核查合规性；本方案不做安全措施合规性判定。',
  };
}

module.exports = {
  TBC, tbcText, VALUE_KINDS, PERMIT_TYPES, buildHse, LEVEL_ALIASES,
  EQUIP_TYPES, EQUIP_CN, COVERED, classifyEquip,
  tri, isDismantle, classifyLevel, LEVEL_CN,
  PHASE_CN, PHASE_ORDER,
  GENERIC_STEPS, TYPE_STEPS, TOOLS, SPARES, QC_POINTS, ACCEPTANCE,
  matchSpec, detectConflicts, stripClauseNo, GENERAL_HINT, buildPlan,
};
