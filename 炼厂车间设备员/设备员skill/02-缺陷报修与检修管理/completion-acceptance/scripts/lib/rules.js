'use strict';
/**
 * 检修完工验收规则引擎
 * 口径见 references/acceptance-rules.md。
 *
 * 核心原则（与 SKILL.md 硬约束一致）：
 *  1. 验收项按「设备类型 × 检修内容」生成，每项都带规则号 ruleId，可追溯。
 *  2. 设备类型不在规则库中时，只出通用验收框架，技术指标一律写「待技术人员补充」，
 *     **绝不按经验填写间隙、力矩、振动、试压压力等任何数值**。
 *  3. 验收结论由验收组填写，本引擎生成的每一项 result 恒为 null，不预填「合格」。
 */

// ---------------------------------------------------------------- 五大验收类别
const CATEGORIES = [
  { key: 'appearance', cn: '外观与清洁' },
  { key: 'assembly', cn: '装配质量' },
  { key: 'sealing', cn: '密封与试压' },
  { key: 'trial', cn: '试运' },
  { key: 'records', cn: '资料记录完整性' },
];
const CAT_CN = CATEGORIES.reduce((o, c) => (o[c.key] = c.cn, o), {});
const CAT_ORDER = CATEGORIES.map((c) => c.key);

// 待补充占位：设备类型不覆盖时，技术指标统一用这句，禁止模型改写为具体数值
const TBD = '待技术人员补充';

// ---------------------------------------------------------------- 设备类型识别
/**
 * 用户可能写「离心泵」「机泵」「P-1101 泵」「往复泵」等，统一归到规则库的 key。
 * 不在库中 → 返回 null，由上层走通用框架 + warning。
 */
// 顺序即优先级：空冷器先于换热器、加热炉先于"加热器"、压缩机/机组先于泵
const TYPE_PATTERNS = [
  ['compressor', /压缩机|机组|汽轮机|鼓风机|主风机|透平|增压机|往复机|离心机$|大机组/],
  ['furnace', /加热炉|工艺炉|转化炉|裂解炉|焚烧炉|再沸炉|常压炉|减压炉|焦化炉|重整炉|炉类|(?<!锅)炉$/],
  ['airCooler', /空冷器|空冷|空气冷却器|风冷器/],
  ['centrifugalPump', /离心泵|机泵|水泵|油泵|给水泵|回流泵|渣油泵|进料泵|^泵$|泵类|屏蔽泵|管道泵|往复泵|计量泵/],
  ['heatExchanger', /换热器|冷却器|再沸器|冷凝器|加热器|热交换/],
  ['vesselColumn', /塔器|塔$|容器|储罐|罐$|分离器|缓冲罐|反应器|压力容器|塔容器|塔、?容器/],
  ['valve', /阀门|阀$|闸阀|球阀|截止阀|蝶阀|止回阀|调节阀|安全阀/],
  ['motor', /电机|电动机|马达|电机类/],
];
const TYPE_CN = {
  compressor: '压缩机/机组',
  furnace: '加热炉',
  airCooler: '空冷器',
  centrifugalPump: '离心泵',
  heatExchanger: '换热器',
  vesselColumn: '塔器/容器',
  valve: '阀门',
  motor: '电机',
};
function classifyEquipType(input) {
  const s = String(input || '').replace(/\s/g, '');
  if (!s) return null;
  for (const [k, re] of TYPE_PATTERNS) if (re.test(s)) return k;
  return null;
}

// ---------------------------------------------------------------- 检修内容识别
/**
 * 检修内容（scope）决定哪些条件项要展开：是否解体、是否更换主要部件、
 * 是否涉及焊接、是否清洗、是否防腐保温。
 * 说明：识别结果只用于「加项」，识别不到不减项——宁可多验，不可漏验。
 */
const SCOPE_FLAGS = [
  ['disassembly', /解体|拆检|大修|抽芯|揭盖|开盖|抽管束|拆装/],
  ['partReplace', /更换|换新|更新|新装|配换|换.{0,4}(件|轮|封|承|管|芯|板)/],
  ['welding', /焊接|补焊|堆焊|换管|挖补|动火/],
  ['cleaning', /清洗|清理|除垢|吹扫|喷砂|化学清洗/],
  ['anticorrosion', /防腐|刷漆|涂层|衬里|保温|保冷/],
  ['alignment', /对中|找正|找平|校中/],
  ['electrical', /电气|接线|绝缘|接地|盘柜/],
];
function parseScopeFlags(scope) {
  const s = String(scope || '');
  const flags = {};
  for (const [k, re] of SCOPE_FLAGS) flags[k] = re.test(s);
  return flags;
}
const SCOPE_CN = {
  disassembly: '解体检修', partReplace: '更换主要部件', welding: '焊接作业',
  cleaning: '清洗', anticorrosion: '防腐保温', alignment: '对中找正', electrical: '电气作业',
};

// ---------------------------------------------------------------- 验收项规则库
/**
 * 每条规则：
 *   id       规则号（类型缩写-类别缩写-序号），写进 acceptance.json 以便追溯
 *   cat      五大类别之一
 *   item     验收内容
 *   std      验收标准（**只写"按…执行/符合…"的口径，不写具体数值**——
 *            具体数值以技术文件、制造厂说明书、检修方案为准，脚本不编造）
 *   method   验收方式
 *   owner    责任方
 *   when     可选，条件函数 (flags, opts) => boolean；不写表示通用必验
 */
const GENERIC_RULES = [
  { id: 'GEN-AP-01', cat: 'appearance', item: '设备及周边现场清洁、工完料尽场地清', std: '无遗留工具、废料、油污；脚手架、临时设施拆除', method: '目视检查', owner: '承修单位/车间' },
  { id: 'GEN-AP-02', cat: 'appearance', item: '设备本体外观完好', std: '无碰伤、变形；铭牌、位号标识齐全清晰', method: '目视检查', owner: '车间' },
  { id: 'GEN-AP-03', cat: 'appearance', item: '保温、防腐层恢复', std: '按原设计或检修方案恢复，无破损、无裸露', method: '目视检查', owner: '承修单位', when: (f) => f.anticorrosion || f.disassembly },
  { id: 'GEN-AS-01', cat: 'assembly', item: '螺栓紧固', std: '紧固力矩按设备技术文件或检修方案执行，无缺件、无松动', method: '力矩扳手抽查 + 目视', owner: '承修单位' },
  { id: 'GEN-AS-02', cat: 'assembly', item: '更换部件与图纸/清单一致', std: '规格型号、材质与备件清单一致，有合格证明', method: '核对备件清单与合格证', owner: '车间/公司设备部门', when: (f) => f.partReplace },
  { id: 'GEN-AS-03', cat: 'assembly', item: '附属管线、仪表、附件复位', std: '接口连接正确，支吊架完好，仪表投用', method: '现场核对', owner: '车间/仪表' },
  { id: 'GEN-SE-01', cat: 'sealing', item: '系统严密性检查', std: '按检修方案规定的试验压力与保压时间执行，无泄漏、无压降超标', method: '试压/气密试验并查验记录', owner: '承修单位/车间', when: (f, o) => o.pressureTest },
  { id: 'GEN-SE-02', cat: 'sealing', item: '法兰、接口密封', std: '垫片规格正确、螺栓对称紧固，运行后无渗漏', method: '目视 + 投用后复查', owner: '车间' },
  { id: 'GEN-TR-01', cat: 'trial', item: '试运前具备条件确认', std: '电气、润滑、冷却、公用工程到位，安全附件齐全有效', method: '联合检查确认', owner: '车间/公司设备部门', when: (f, o) => o.trialRun },
  { id: 'GEN-TR-02', cat: 'trial', item: '试运情况', std: '按检修方案规定的时长与工况试运，无异常报警、无被迫停机', method: '试运并记录', owner: '车间/承修单位', when: (f, o) => o.trialRun },
  { id: 'GEN-RC-01', cat: 'records', item: '检修记录完整', std: '检修记录、更换件清单、施工签证齐全，责任人签字', method: '查阅资料', owner: '车间/公司设备部门' },
  { id: 'GEN-RC-02', cat: 'records', item: '隐蔽工程记录', std: '封闭前的检查确认记录齐全并经验收方签字', method: '查阅资料', owner: '车间/公司设备部门', when: (f) => f.disassembly || f.welding },
  { id: 'GEN-RC-03', cat: 'records', item: '特种设备相关资料', std: '按特种设备管理要求提供检验/告知/登记变更资料', method: '查阅资料', owner: '车间/公司设备部门', when: (f, o) => o.specialEquipment },
];

const TYPE_RULES = {
  // ---------------- 离心泵
  centrifugalPump: [
    { id: 'PMP-AP-01', cat: 'appearance', item: '泵体、底座、联轴器护罩外观', std: '无裂纹渗漏痕迹；联轴器防护罩齐全牢固', method: '目视检查', owner: '车间' },
    { id: 'PMP-AS-01', cat: 'assembly', item: '泵与电机对中（找正）', std: '径向与轴向偏差符合设备技术文件或检修方案规定值，有对中记录', method: '百分表/激光对中仪实测并查记录', owner: '承修单位' },
    { id: 'PMP-AS-02', cat: 'assembly', item: '地脚螺栓与底座', std: '地脚螺栓紧固无松动，垫铁接触良好、点焊固定', method: '目视 + 力矩抽查', owner: '承修单位' },
    { id: 'PMP-AS-03', cat: 'assembly', item: '转子盘车', std: '手动盘车灵活均匀，无卡涩、无异常摩擦声', method: '手动盘车', owner: '车间/承修单位' },
    { id: 'PMP-AS-04', cat: 'assembly', item: '轴承间隙与润滑', std: '轴承间隙按技术文件执行；润滑油（脂）牌号与油位符合规定', method: '实测并查记录 + 目视油位', owner: '承修单位' },
    { id: 'PMP-SE-01', cat: 'sealing', item: '机械密封（填料）安装与泄漏', std: '机封安装到位、冲洗方案正确；运行中无泄漏（填料密封按规定允许滴漏量）', method: '试运中观察', owner: '车间' },
    { id: 'PMP-SE-02', cat: 'sealing', item: '进出口管线与壳体静密封', std: '试压或投用后进出口法兰、壳体结合面、排放口无渗漏', method: '试压/投用后检查', owner: '车间' },
    { id: 'PMP-TR-01', cat: 'trial', item: '空负荷（点动/盘车）试验', std: '转向正确，点动无异响、无摩擦', method: '点动试验', owner: '车间/电气', when: (f, o) => o.trialRun },
    { id: 'PMP-TR-02', cat: 'trial', item: '负荷试运振动值', std: '振动值不超过设备技术文件或相应标准规定的合格值，有实测记录', method: '测振仪实测并记录', owner: '车间/公司设备部门', when: (f, o) => o.trialRun },
    { id: 'PMP-TR-03', cat: 'trial', item: '负荷试运轴承温度', std: '轴承温度不超过设备技术文件规定的上限，温升趋于稳定', method: '测温并记录', owner: '车间', when: (f, o) => o.trialRun },
    { id: 'PMP-TR-04', cat: 'trial', item: '试运时长与工况', std: '按检修方案规定时长连续试运，出口压力、流量、电流在规定范围内', method: '试运记录', owner: '车间', when: (f, o) => o.trialRun },
    { id: 'PMP-RC-01', cat: 'records', item: '对中记录、间隙记录、试运记录', std: '记录齐全，实测数据填写完整并签字', method: '查阅资料', owner: '车间/公司设备部门' },
  ],
  // ---------------- 换热器
  heatExchanger: [
    { id: 'HEX-AP-01', cat: 'appearance', item: '壳体、封头、法兰外观', std: '无变形、无明显腐蚀减薄痕迹；铭牌完好', method: '目视检查', owner: '车间' },
    { id: 'HEX-AP-02', cat: 'appearance', item: '管束清洗效果', std: '管程/壳程清洗后无结垢、无堵管，清洗方式与方案一致', method: '目视/通球或内窥检查', owner: '承修单位', when: (f) => f.cleaning || f.disassembly },
    { id: 'HEX-AS-01', cat: 'assembly', item: '管束回装与定位', std: '管束就位正确，滑道、支撑、折流板无损伤', method: '目视 + 回装记录', owner: '承修单位', when: (f) => f.disassembly },
    { id: 'HEX-AS-02', cat: 'assembly', item: '管口、堵管与胀焊', std: '堵管数量与位置有记录并经公司设备部门批准；胀焊质量符合工艺要求', method: '核对记录 + 目视', owner: '车间/公司设备部门', when: (f) => f.welding || f.partReplace },
    { id: 'HEX-AS-03', cat: 'assembly', item: '法兰螺栓对称紧固', std: '按对角顺序分次紧固，力矩按技术文件执行', method: '力矩扳手抽查', owner: '承修单位' },
    { id: 'HEX-SE-01', cat: 'sealing', item: '管程水压试验', std: '按设计或方案规定的试验压力与保压时间执行，无泄漏、无压降超标', method: '水压试验并查记录', owner: '承修单位', when: (f, o) => o.pressureTest },
    { id: 'HEX-SE-02', cat: 'sealing', item: '壳程水压试验', std: '按设计或方案规定的试验压力与保压时间执行，无泄漏、无压降超标', method: '水压试验并查记录', owner: '承修单位', when: (f, o) => o.pressureTest },
    { id: 'HEX-SE-03', cat: 'sealing', item: '法兰、丝堵、放空排凝口密封', std: '投用升温升压后无渗漏，丝堵、放空排凝阀封闭到位', method: '投用后检查', owner: '车间' },
    { id: 'HEX-TR-01', cat: 'trial', item: '投用升温升压检查', std: '按规定升温升压速率投用，过程中无泄漏、无异常温差', method: '投用过程巡检', owner: '车间', when: (f, o) => o.trialRun },
    { id: 'HEX-RC-01', cat: 'records', item: '清洗记录、试压记录、堵管记录', std: '记录齐全并签字；涉及焊接的附焊接与检测记录', method: '查阅资料', owner: '车间/公司设备部门' },
  ],
  // ---------------- 塔器/容器
  vesselColumn: [
    { id: 'VES-AP-01', cat: 'appearance', item: '塔内/容器内部清洁与异物清理', std: '塔盘、内件、容器内无遗留工具、焊渣、杂物，有清理确认记录', method: '进入检查 + 双人确认', owner: '车间/承修单位', when: (f) => f.disassembly },
    { id: 'VES-AP-02', cat: 'appearance', item: '防腐层、衬里检查', std: '衬里/防腐层完整无起鼓、无剥落，按方案修复', method: '目视 + 必要时电火花检测', owner: '承修单位', when: (f) => f.anticorrosion },
    { id: 'VES-AS-01', cat: 'assembly', item: '内件（塔盘、填料、分布器）安装', std: '安装位置、水平度、紧固符合图纸；降液板、浮阀齐全无缺件', method: '进入检查并核对图纸', owner: '承修单位/公司设备部门', when: (f) => f.disassembly || f.partReplace },
    { id: 'VES-AS-02', cat: 'assembly', item: '人孔、手孔封闭', std: '封闭前经验收方确认内部无遗留，垫片规格正确、螺栓齐全对称紧固', method: '封闭前联合确认并签字（H 点）', owner: '工艺（操作）/车间/公司设备部门' },
    { id: 'VES-AS-03', cat: 'assembly', item: '安全附件复位', std: '安全阀、爆破片、液位计、压力表在校验有效期内且已投用', method: '核对校验证书 + 现场确认', owner: '车间/公司设备部门' },
    { id: 'VES-SE-01', cat: 'sealing', item: '气密性试验', std: '按设计或方案规定的试验压力、介质与保压时间执行，无泄漏、压降合格', method: '气密试验并查记录', owner: '承修单位', when: (f, o) => o.pressureTest },
    { id: 'VES-SE-02', cat: 'sealing', item: '接管、法兰密封', std: '所有开口接管封堵或接回正确，投用后无渗漏', method: '目视 + 投用后检查', owner: '车间' },
    { id: 'VES-TR-01', cat: 'trial', item: '投用前置换与升压', std: '按操作规程置换合格后投用，升压过程无异常', method: '分析合格单 + 投用巡检', owner: '车间', when: (f, o) => o.trialRun },
    { id: 'VES-RC-01', cat: 'records', item: '隐蔽工程（封闭前）记录', std: '人孔封闭前检查确认记录齐全，参与方签字', method: '查阅资料', owner: '车间/公司设备部门' },
    { id: 'VES-RC-02', cat: 'records', item: '气密/试压记录、无损检测报告', std: '记录与报告齐全，结论明确并签字', method: '查阅资料', owner: '车间/公司设备部门' },
  ],
  // ---------------- 阀门
  valve: [
    { id: 'VLV-AP-01', cat: 'appearance', item: '阀体外观与标识', std: '阀体无裂纹、无明显腐蚀；型号、公称压力、流向标识清晰正确', method: '目视检查', owner: '车间' },
    { id: 'VLV-AS-01', cat: 'assembly', item: '安装方向与位置', std: '流向与介质流向一致，安装位置便于操作与检修', method: '目视核对', owner: '车间' },
    { id: 'VLV-AS-02', cat: 'assembly', item: '启闭灵活性', std: '全行程启闭灵活无卡涩，手轮/执行机构操作正常', method: '全行程启闭试验', owner: '车间/仪表' },
    { id: 'VLV-AS-03', cat: 'assembly', item: '限位与开度指示', std: '全开全关限位正确，开度指示与实际一致（调节阀含行程标定记录）', method: '现场动作确认 + 查标定记录', owner: '仪表/车间' },
    { id: 'VLV-SE-01', cat: 'sealing', item: '密封（强度与严密性）试验', std: '按方案或阀门技术文件规定的试验压力执行，泄漏量在允许范围内', method: '试验台或现场试压并查记录', owner: '承修单位', when: (f, o) => o.pressureTest },
    { id: 'VLV-SE-02', cat: 'sealing', item: '填料函与阀盖密封', std: '填料压盖松紧适中，运行中无泄漏', method: '投用后检查', owner: '车间' },
    { id: 'VLV-SE-03', cat: 'sealing', item: '连接法兰密封', std: '垫片规格正确，投用后法兰无渗漏', method: '投用后检查', owner: '车间' },
    { id: 'VLV-TR-01', cat: 'trial', item: '带压投用试验', std: '投用后启闭动作正常，无内漏外漏迹象', method: '投用后操作确认', owner: '车间', when: (f, o) => o.trialRun },
    { id: 'VLV-RC-01', cat: 'records', item: '阀门试压记录、检修记录', std: '记录齐全，试验压力与结论填写完整并签字', method: '查阅资料', owner: '车间/公司设备部门' },
    { id: 'VLV-RC-02', cat: 'records', item: '安全阀校验证书', std: '安全阀经法定校验合格，铅封完好，证书在有效期内', method: '查阅校验证书', owner: '车间/公司设备部门', when: (f, o) => o.specialEquipment },
  ],
  // ---------------- 电机
  motor: [
    { id: 'MOT-AP-01', cat: 'appearance', item: '电机外观与散热', std: '外壳无破损，风扇罩完好，散热通道无遮挡、无积灰', method: '目视检查', owner: '电气' },
    { id: 'MOT-AS-01', cat: 'assembly', item: '接线与接线盒', std: '接线牢固、相序标识清晰，接线盒密封符合防爆/防护等级要求', method: '目视 + 紧固检查', owner: '电气' },
    { id: 'MOT-AS-02', cat: 'assembly', item: '接地', std: '接地线连接可靠、截面符合要求，接地电阻有实测记录', method: '目视 + 查实测记录', owner: '电气' },
    { id: 'MOT-AS-03', cat: 'assembly', item: '地脚与联轴器', std: '地脚螺栓紧固，与被驱动机对中记录合格', method: '目视 + 查对中记录', owner: '承修单位', when: (f) => f.alignment || f.disassembly },
    { id: 'MOT-SE-01', cat: 'sealing', item: '绝缘电阻测试', std: '绝缘电阻实测值符合相应电压等级的规定值，有测试记录', method: '兆欧表实测并记录', owner: '电气' },
    { id: 'MOT-TR-01', cat: 'trial', item: '转向确认', std: '点动确认转向与设备要求一致（泵、风机严禁反转运行）', method: '点动试验', owner: '电气/车间', when: (f, o) => o.trialRun },
    { id: 'MOT-TR-02', cat: 'trial', item: '空载电流', std: '三相空载电流平衡，数值符合电机技术文件规定，有实测记录', method: '钳形表实测并记录', owner: '电气', when: (f, o) => o.trialRun },
    { id: 'MOT-TR-03', cat: 'trial', item: '负荷电流与温升', std: '负荷电流不超过额定值，温升在电机绝缘等级允许范围内并趋于稳定', method: '实测并记录', owner: '电气/车间', when: (f, o) => o.trialRun },
    { id: 'MOT-TR-04', cat: 'trial', item: '振动与噪声', std: '振动值符合技术文件规定，运行无异常噪声', method: '测振 + 听音', owner: '车间/公司设备部门', when: (f, o) => o.trialRun },
    { id: 'MOT-RC-01', cat: 'records', item: '绝缘、接地、空载/负荷电流测试记录', std: '记录齐全，实测数据完整并由电气专业签字', method: '查阅资料', owner: '公司设备部门/电气' },
  ],
  // ---------------- 压缩机 / 机组（大机组属特护设备，验收由公司设备部门牵头）
  compressor: [
    { id: 'CMP-AP-01', cat: 'appearance', item: '机组本体、底座、联轴器护罩、油站外观', std: '无渗漏痕迹、无松动；防护罩齐全牢固；油站管线复位', method: '目视检查', owner: '车间' },
    { id: 'CMP-AS-01', cat: 'assembly', item: '转子与轴承装配间隙', std: '轴承间隙、轴向窜量、密封间隙实测值符合设备技术文件或检修方案规定，有记录', method: '实测并查记录（H 点）', owner: '承修单位/公司设备部门', when: (f) => f.disassembly || f.partReplace },
    { id: 'CMP-AS-02', cat: 'assembly', item: '机组对中（找正）', std: '各联轴器对中偏差符合技术文件规定值，冷态/热态对中记录齐全', method: '百分表/激光对中仪实测并查记录', owner: '承修单位' },
    { id: 'CMP-AS-03', cat: 'assembly', item: '盘车与转子状态', std: '盘车灵活无卡涩；转子动平衡（如有）记录合格', method: '手动/盘车器盘车 + 查记录', owner: '车间/承修单位' },
    { id: 'CMP-AS-04', cat: 'assembly', item: '润滑、密封、控制油系统复位', std: '油位、油质、油压与冲洗合格记录符合技术文件；密封气/氮气系统复位', method: '查记录 + 现场核对', owner: '车间/承修单位' },
    { id: 'CMP-SE-01', cat: 'sealing', item: '工艺气路与密封严密性', std: '按方案规定的试验压力与介质执行，无泄漏、压降合格', method: '试压/气密试验并查记录', owner: '承修单位', when: (f, o) => o.pressureTest },
    { id: 'CMP-SE-02', cat: 'sealing', item: '干气密封/油膜密封泄漏', std: '密封一级/二级泄漏量在技术文件规定范围内，有记录', method: '试运中监测并记录', owner: '车间/公司设备部门' },
    { id: 'CMP-TR-01', cat: 'trial', item: '联锁保护试验', std: '振动、轴位移、温度、油压等联锁按逻辑图逐项试验合格，有记录', method: '联锁试验并查记录（由仪表/电气执行）', owner: '仪表/电气/车间', when: (f, o) => o.trialRun },
    { id: 'CMP-TR-02', cat: 'trial', item: '试运振动与轴位移', std: '各测点振动、轴位移不超过技术文件或相应标准规定的合格值，有趋势记录', method: '在线监测 + 测振仪实测', owner: '公司设备部门', when: (f, o) => o.trialRun },
    { id: 'CMP-TR-03', cat: 'trial', item: '试运轴承温度与油温', std: '轴承温度、回油温度不超过技术文件规定上限并趋于稳定', method: '测温并记录', owner: '车间', when: (f, o) => o.trialRun },
    { id: 'CMP-TR-04', cat: 'trial', item: '试运时长、工况与性能', std: '按检修方案规定时长连续试运，出口压力、流量、电流/转速在规定范围内', method: '试运记录', owner: '车间/承修单位', when: (f, o) => o.trialRun },
    { id: 'CMP-RC-01', cat: 'records', item: '间隙记录、对中记录、动平衡记录、联锁试验记录、试运记录', std: '记录齐全，实测数据填写完整并签字', method: '查阅资料', owner: '车间/公司设备部门' },
  ],
  // ---------------- 加热炉
  furnace: [
    { id: 'FUR-AP-01', cat: 'appearance', item: '炉体钢结构、炉衬与保温外观', std: '炉衬无脱落、裂缝超出方案要求的部位已修补；炉墙保温完整', method: '目视检查 + 进炉检查', owner: '车间/承修单位' },
    { id: 'FUR-AS-01', cat: 'assembly', item: '炉管、弯头、吊挂与管架', std: '更换炉管材质、规格与图纸一致；吊挂、管架、导向无变形，膨胀间隙按技术文件', method: '核对材质证明 + 进炉检查', owner: '承修单位/公司设备部门', when: (f) => f.partReplace || f.welding || f.disassembly },
    { id: 'FUR-AS-02', cat: 'assembly', item: '燃烧器、火嘴与风门', std: '燃烧器安装到位、火嘴畅通，风门开关灵活、开度指示正确', method: '现场核对 + 动作试验', owner: '车间/承修单位' },
    { id: 'FUR-AS-03', cat: 'assembly', item: '烟道挡板与引风/鼓风机', std: '挡板全行程动作正常、开度指示与实际一致；风机试运正常', method: '动作试验', owner: '车间/仪表', when: (f, o) => o.trialRun || f.disassembly },
    { id: 'FUR-AS-04', cat: 'assembly', item: '炉管测温热电偶、看火孔、防爆门复位', std: '热电偶安装到位并投用；看火孔、防爆门完好', method: '现场核对', owner: '车间/仪表' },
    { id: 'FUR-SE-01', cat: 'sealing', item: '炉管试压', std: '按设计或方案规定的试验压力与保压时间执行，无泄漏', method: '水压/气压试验并查记录', owner: '承修单位', when: (f, o) => o.pressureTest },
    { id: 'FUR-SE-02', cat: 'sealing', item: '燃料气/燃料油管线严密性', std: '燃料管线试压或气密合格，法兰、阀门无泄漏', method: '气密试验 + 投用前检查', owner: '车间', when: (f, o) => o.pressureTest },
    { id: 'FUR-TR-01', cat: 'trial', item: '烘炉与升温曲线', std: '按检修方案或烘炉方案规定的升温速率与恒温时间执行，有烘炉记录', method: '烘炉记录', owner: '车间', when: (f, o) => o.trialRun && f.anticorrosion },
    { id: 'FUR-TR-02', cat: 'trial', item: '点火与燃烧工况', std: '点火顺序符合操作规程，火焰形态正常，炉膛负压、氧含量在规定范围', method: '点火试运记录', owner: '车间', when: (f, o) => o.trialRun },
    { id: 'FUR-TR-03', cat: 'trial', item: '联锁与熄火保护试验', std: '熄火保护、燃料气低压、炉膛压力等联锁试验合格，有记录', method: '联锁试验并查记录（由仪表执行）', owner: '仪表/车间', when: (f, o) => o.trialRun },
    { id: 'FUR-RC-01', cat: 'records', item: '炉管材质证明、焊接与检测记录、试压记录、烘炉记录', std: '记录齐全并签字', method: '查阅资料', owner: '车间/公司设备部门' },
  ],
  // ---------------- 空冷器
  airCooler: [
    { id: 'ACC-AP-01', cat: 'appearance', item: '管束翅片、管箱、风筒外观', std: '翅片无大面积倒伏、堵塞；管箱丝堵齐全；风筒无破损', method: '目视检查', owner: '车间' },
    { id: 'ACC-AP-02', cat: 'appearance', item: '管束清洗效果', std: '翅片间、管内清洗后无积垢、无堵管，清洗方式与方案一致', method: '目视 / 通球检查', owner: '承修单位', when: (f) => f.cleaning || f.disassembly },
    { id: 'ACC-AS-01', cat: 'assembly', item: '管束回装与膨胀间隙', std: '管束就位正确，固定端/滑动端支撑与膨胀间隙按技术文件', method: '目视 + 回装记录', owner: '承修单位', when: (f) => f.disassembly },
    { id: 'ACC-AS-02', cat: 'assembly', item: '管箱丝堵、垫片与堵管', std: '丝堵按规定力矩紧固、垫片规格正确；堵管数量与位置有记录并经公司设备部门批准', method: '力矩抽查 + 核对记录', owner: '承修单位/公司设备部门', when: (f) => f.partReplace || f.welding },
    { id: 'ACC-AS-03', cat: 'assembly', item: '风机叶片角度、皮带/减速机与百叶窗', std: '叶片角度一致并按技术文件设定，皮带张紧或减速机油位正常，百叶窗动作灵活', method: '现场核对 + 动作试验', owner: '车间/承修单位' },
    { id: 'ACC-SE-01', cat: 'sealing', item: '管程水压试验', std: '按设计或方案规定的试验压力与保压时间执行，无泄漏、无压降超标', method: '水压试验并查记录', owner: '承修单位', when: (f, o) => o.pressureTest },
    { id: 'ACC-SE-02', cat: 'sealing', item: '管箱丝堵与法兰密封', std: '投用升温升压后丝堵、法兰无渗漏', method: '投用后检查', owner: '车间' },
    { id: 'ACC-TR-01', cat: 'trial', item: '风机试运', std: '转向正确，振动、电流、轴承温度符合技术文件规定，无异响', method: '试运并记录', owner: '车间/电气', when: (f, o) => o.trialRun },
    { id: 'ACC-TR-02', cat: 'trial', item: '投用升温升压检查', std: '按规定升温升压速率投用，过程中无泄漏', method: '投用过程巡检', owner: '车间', when: (f, o) => o.trialRun },
    { id: 'ACC-RC-01', cat: 'records', item: '清洗记录、试压记录、堵管记录、风机试运记录', std: '记录齐全并签字', method: '查阅资料', owner: '车间/公司设备部门' },
  ],
};

// 设备类型不覆盖时的「技术指标待补充」占位项：只给框架，不给数值
const UNKNOWN_TYPE_RULES = [
  { id: 'UNK-AS-01', cat: 'assembly', item: '本设备类型专用装配指标（间隙/对中/紧固力矩）', std: TBD, method: TBD, owner: '公司设备部门/技术人员' },
  { id: 'UNK-SE-01', cat: 'sealing', item: '本设备类型专用密封与试压指标', std: TBD, method: TBD, owner: '公司设备部门/技术人员' },
  { id: 'UNK-TR-01', cat: 'trial', item: '本设备类型专用试运指标（振动/温度/电流等）', std: TBD, method: TBD, owner: '公司设备部门/技术人员' },
];

// ---------------------------------------------------------------- 应附资料清单
/**
 * 按「检修内容 + 试压/试运/特种设备」确定，不按设备类型一刀切。
 * required=true 的是必附项；缺一条就要在报告中列为资料缺口。
 */
const RECORD_RULES = [
  { id: 'REC-01', name: '检修记录卡（施工记录）', basis: '所有检修必附', when: () => true },
  { id: 'REC-17', name: '质量验收记录（H/W 点见证）', basis: '所有检修必附；H 点（停止点）须见证签字后方可进入下道工序', when: () => true },
  { id: 'REC-02', name: '更换部件质量证明（备件清单及合格证）', basis: '更换主要部件时必附', when: (f) => f.partReplace },
  { id: 'REC-18', name: '备件领用单', basis: '更换主要部件时必附（与更换部件清单对应）', when: (f) => f.partReplace },
  { id: 'REC-03', name: '材质证明书（材料代用审批）', basis: '涉及受压元件更换或材料代用时必附', when: (f) => f.partReplace || f.welding },
  { id: 'REC-04', name: '焊接记录及焊工资质证明', basis: '涉及焊接作业时必附', when: (f) => f.welding },
  { id: 'REC-05', name: '无损检测报告（RT/UT/PT/MT）', basis: '涉及受压焊缝或按方案要求检测时必附', when: (f) => f.welding },
  { id: 'REC-06', name: '试压（气密）记录', basis: '需试压时必附', when: (f, o) => o.pressureTest },
  { id: 'REC-07', name: '试运（试车）记录（空负荷/负荷）', basis: '需试运时必附', when: (f, o) => o.trialRun },
  { id: 'REC-08', name: '隐蔽工程记录（封闭前检查确认）', basis: '解体或有封闭作业时必附', when: (f) => f.disassembly || f.welding },
  { id: 'REC-09', name: '对中（找正）记录', basis: '涉及对中找正时必附', when: (f, o) => f.alignment || o.equipType === 'centrifugalPump' || o.equipType === 'motor' || o.equipType === 'compressor' },
  { id: 'REC-19', name: '联锁保护试验记录', basis: '压缩机/机组、加热炉试运时必附', when: (f, o) => o.trialRun && (o.equipType === 'compressor' || o.equipType === 'furnace') },
  { id: 'REC-10', name: '清洗记录', basis: '涉及清洗作业时必附', when: (f) => f.cleaning },
  { id: 'REC-11', name: '防腐/保温施工记录', basis: '涉及防腐保温时必附', when: (f) => f.anticorrosion },
  { id: 'REC-12', name: '电气试验报告（绝缘、接地）', basis: '涉及电气作业或电机检修时必附', when: (f, o) => f.electrical || o.equipType === 'motor' },
  { id: 'REC-13', name: '特种设备检验报告及使用登记变更资料', basis: '特种设备必附', when: (f, o) => o.specialEquipment },
  { id: 'REC-14', name: '安全阀（安全附件）校验证书', basis: '特种设备或涉及安全附件时必附', when: (f, o) => o.specialEquipment },
  { id: 'REC-15', name: '施工方案与技术交底记录', basis: '所有检修必附', when: () => true },
  { id: 'REC-16', name: '完工验收签证（本清单签字页）', basis: '所有检修必附', when: () => true },
];

// ---------------------------------------------------------------- 生成
/**
 * buildItems({equipType, scope, pressureTest, trialRun, specialEquipment})
 * 返回 {items, typeKey, typeCn, typeCovered, flags}
 * items 每项 result 恒为 null —— 验收结论由验收组填写，脚本不预填。
 */
function buildItems(opts) {
  const flags = parseScopeFlags(opts.scope);
  const typeKey = classifyEquipType(opts.equipType);
  const covered = !!typeKey;
  const o = {
    pressureTest: !!opts.pressureTest,
    trialRun: !!opts.trialRun,
    specialEquipment: !!opts.specialEquipment,
    equipType: typeKey,
  };

  const pool = GENERIC_RULES.concat(covered ? TYPE_RULES[typeKey] : UNKNOWN_TYPE_RULES);
  const picked = pool.filter((r) => (typeof r.when === 'function' ? r.when(flags, o) : true));

  // 按五大类别顺序编号
  picked.sort((x, y) => CAT_ORDER.indexOf(x.cat) - CAT_ORDER.indexOf(y.cat));
  const items = picked.map((r, i) => ({
    seq: i + 1,
    ruleId: r.id,
    category: r.cat,
    categoryCn: CAT_CN[r.cat],
    item: r.item,
    standard: r.std,
    method: r.method,
    owner: r.owner,
    source: r.id.startsWith('GEN-') ? '通用' : (covered ? TYPE_CN[typeKey] : '待补充'),
    result: null,      // ← 硬约束：验收结论由验收组填写，脚本恒为 null
    note: '',
  }));

  return { items, typeKey, typeCn: covered ? TYPE_CN[typeKey] : null, typeCovered: covered, flags };
}

/** buildRecords(flags, opts) → 应附资料清单 */
function buildRecords(flags, opts) {
  const o = {
    pressureTest: !!opts.pressureTest,
    trialRun: !!opts.trialRun,
    specialEquipment: !!opts.specialEquipment,
    equipType: opts.typeKey || null,
  };
  return RECORD_RULES.filter((r) => r.when(flags, o)).map((r) => ({
    id: r.id, name: r.name, basis: r.basis, provided: null, // provided 同样由验收组核对，不预填
  }));
}

// ---------------------------------------------------------------- 方案质量控制点比对
/**
 * 质量控制点行识别：从方案文本中抽出带「质量控制点 / 控制点 / QC点 / 见证点 / 停止点 / H点 / W点」的条目，
 * 或「质量控制点」小节下的编号条目。
 */
const QC_LINE = /(质量控制点|控制点|QC\s*点|见证点|停止点|停检点|H\s*点|W\s*点|R\s*点)/i;
// 小节标题：整行几乎只有「质量控制点 / 质量要求 / 检验与试验」这几个字（去掉编号后 ≤ 8 字）
const QC_HEADING = /^(质量控制点|质量控制要求|质量要求|检验与试验|检验试验要求)[：:]?$/;
// 章节切换：中文大写序号「一、二、」或 markdown 标题，用于退出小节
const SECTION_START = /^(#{1,6}\s|[一二三四五六七八九十]+[、.．])/;

/** 去掉行首项目符号与编号、以及「质量控制点：」这类前缀 */
function stripLead(s) {
  return s.replace(/^[-*•\s]*/, '')
    .replace(/^(\d+(\.\d+)*|[（(]\d+[)）]|[一二三四五六七八九十]+)[、.．)）]\s*/, '')
    .replace(/^(质量控制点|控制点|QC\s*点|见证点|停止点|停检点)\s*[:：、]?\s*/i, '')
    .trim();
}

function extractQcPoints(text) {
  const lines = String(text || '').split(/\r?\n/);
  const points = [];
  let inSection = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const s = raw.replace(/\s+/g, ' ').trim();
    if (!s) continue;
    const lead = stripLead(s);

    // 1) 是「质量控制点」小节标题 → 进入小节，本行不作为控制点
    if (QC_HEADING.test(lead) || (QC_HEADING.test(s) )) { inSection = true; continue; }

    // 2) 在小节中遇到新的大章节标题 → 退出小节
    if (inSection && SECTION_START.test(s) && !QC_LINE.test(s)) { inSection = false; }

    // 3) 本行含控制点关键词，或处在控制点小节内 → 收为一条控制点
    if (!QC_LINE.test(s) && !inSection) continue;
    if (lead.length < 3) continue;
    if (QC_HEADING.test(lead)) continue;
    points.push({ no: points.length + 1, text: lead, srcLine: i + 1 });
  }
  // 去重（同文本只留一条）
  const seen = new Set();
  return points.filter((p) => { const k = p.text.replace(/\s/g, ''); if (seen.has(k)) return false; seen.add(k); return true; })
    .map((p, i) => ({ ...p, no: i + 1 }));
}

/** 文本 bigram Dice 相似度（与 defect-intake-grading 查重同口径） */
function textSim(a, b) {
  const g = (s) => { const t = String(s).replace(/[\s，,。.；;：:（）()【】\[\]]/g, ''); const out = new Set(); for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2)); return out; };
  const A = g(a), B = g(b);
  if (!A.size || !B.size) return 0;
  let inter = 0; for (const x of A) if (B.has(x)) inter++;
  return (2 * inter) / (A.size + B.size);
}

const QC_MATCH_THRESHOLD = 0.34;

/**
 * matchQcPoints(points, items) → {matched[], gap[]}
 * 每个控制点找相似度最高的验收项；低于阈值即视为缺口，**绝不静默忽略**。
 */
function matchQcPoints(points, items) {
  const matched = [], gap = [];
  for (const p of points) {
    let best = null;
    for (const it of items) {
      const s = Math.max(
        textSim(p.text, it.item),
        textSim(p.text, `${it.item} ${it.standard}`) * 0.95,
      );
      if (!best || s > best.score) best = { score: s, item: it };
    }
    const score = best ? Number(best.score.toFixed(2)) : 0;
    if (best && best.score >= QC_MATCH_THRESHOLD) {
      matched.push({ no: p.no, qc: p.text, srcLine: p.srcLine, seq: best.item.seq, ruleId: best.item.ruleId, item: best.item.item, score });
    } else {
      gap.push({
        no: p.no, qc: p.text, srcLine: p.srcLine,
        nearest: best ? { seq: best.item.seq, item: best.item.item, score } : null,
        note: '方案中的质量控制点未找到对应验收项，需由验收组确认是否补充该验收项',
      });
    }
  }
  return { matched, gap };
}

module.exports = {
  CATEGORIES, CAT_CN, CAT_ORDER, TBD,
  classifyEquipType, TYPE_CN, TYPE_PATTERNS,
  parseScopeFlags, SCOPE_CN,
  GENERIC_RULES, TYPE_RULES, UNKNOWN_TYPE_RULES, RECORD_RULES,
  buildItems, buildRecords,
  extractQcPoints, matchQcPoints, textSim, QC_MATCH_THRESHOLD,
};
