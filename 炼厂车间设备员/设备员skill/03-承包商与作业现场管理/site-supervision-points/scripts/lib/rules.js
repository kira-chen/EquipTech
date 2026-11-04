'use strict';
/**
 * 现场作业监督要点规则引擎
 * 口径见 references/supervision-rules.md。
 * 核心原则：
 *   1. 作业类型不在覆盖范围 → 只给通用监督框架并标注「待安全专业补充」，
 *      绝不凭通用安全知识为未覆盖类型生成具体要点。
 *   2. 多类型组合 → 合并各类型要点并标注来源类型；冲突或加严项在 escalated 中单列，
 *      不得只按主要类型处理、也不得静默丢弃某一类型的要点。
 *   3. 介质不在危险特性库 → 按最严口径（高危）处理并 warning，绝不按无危险处理。
 *   4. 检查记录表只出空表，脚本不预填任何检查结果。
 *   5. 所有要点均来自本规则表，规则号可追溯（S/H/C/W/L/E/B/G/R/D/X 系列）。
 *   6. 本表只覆盖厂内制度与作业票通常规定的监督内容，不得扩写为额外安全措施。
 *   7. 术语按《中国石化作业许可管理规定》八大类命名（用火作业，不写"动火"；"动火"仅作识别别名）。
 *   8. 八大类特殊作业共有的许可要点（双监护、JSA/风险分析交底、属地确认人）单列 S 系列，
 *      只要识别出任一特殊作业类型即纳入；常规检修单独作业不纳入。
 *   9. 作业票级别（特级/一级/二级用火、高处一~四级、吊装一~三级）由 --level 传入，脚本不自判级别；
 *      级别只用于映射检查频次口径，不改写要点。
 */

// ---------------------------------------------------------------- 检查时点
const MOMENTS = ['before', 'during', 'resume', 'shift', 'closing'];
const MOMENT_CN = {
  before: '作业前',
  during: '作业中',
  resume: '中断后复工',
  shift: '交接班',
  closing: '收尾',
};

// ---------------------------------------------------------------- 检查方式
const METHOD_CN = {
  visual: '目视',
  instrument: '仪器检测',
  ask: '询问',
  doc: '查证件',
};

// ---------------------------------------------------------------- 作业类型识别
const TYPE_PATTERNS = [
  ['hotwork', /用火|动火|明火|焊接|气割|切割|打磨|砂轮|电焊|氧焊|烘烤|喷灯/],
  ['confined', /受限空间|有限空间|进罐|进塔|进容器|入罐|进入设备内/],
  ['height', /高处|登高|高空|脚手架|搭架|架子|吊篮|临边|攀登/],
  ['lifting', /吊装|起重|吊车|汽车吊|行车|葫芦|吊运|起吊/],
  ['power', /临时用电|临电|接电|用电作业|电源接引/],
  ['excavation', /动土|开挖|挖掘|破土|开槽|钻探|打桩/],
  ['blockade', /断路|占路|封路|道路占用/],
  ['blind', /盲板|抽堵|加盲板|拆盲板|插盲板/],
  ['overhaul', /常规检修|检修|拆解|解体|抽芯|更换|安装|试压|校验|保运/],
];
const TYPE_CN = {
  permit: '作业许可通用（八大类共有）',
  hotwork: '用火作业',
  confined: '受限空间作业',
  height: '高处作业',
  lifting: '吊装作业',
  power: '临时用电作业',
  excavation: '动土作业',
  blockade: '断路作业',
  blind: '盲板抽堵作业',
  overhaul: '常规检修作业',
};
/** 八类特殊作业（不含常规检修） */
const SPECIAL_TYPES = ['hotwork', 'confined', 'height', 'lifting', 'power', 'excavation', 'blockade', 'blind'];
/** 规则表覆盖的全部类型 */
const COVERED_TYPES = SPECIAL_TYPES.concat(['overhaul']);

/**
 * 解析用户填写的作业类型串（逗号/顿号/斜杠/加号分隔）
 * @returns {{types:string[], unknown:string[]}}
 *   types   —— 命中覆盖范围的类型 key，去重且保持规则表顺序
 *   unknown —— 无法归入覆盖范围的原始文本，**不得猜测归类**
 */
function classifyTypes(text) {
  const raw = String(text || '')
    .split(/[,，、/／+＋;；|]+/)
    .map((x) => x.trim())
    .filter(Boolean);
  const hit = [], unknown = [];
  for (const item of raw) {
    let found = null;
    for (const [k, re] of TYPE_PATTERNS) if (re.test(item)) { found = k; break; }
    if (found) { if (!hit.includes(found)) hit.push(found); }
    else unknown.push(item);
  }
  const types = COVERED_TYPES.filter((t) => hit.includes(t));
  return { types, unknown };
}

// ---------------------------------------------------------------- 介质危险特性库
const HAZ_CN = {
  flammable: '易燃易爆',
  toxic: '有毒有害',
  corrosive: '腐蚀性',
  hot: '高温烫伤',
  inert: '窒息性（惰性气体）',
  low: '低危',
};
const MEDIUM_LIB = [
  ['toxic', /硫化氢|H2S|一氧化碳|CO\b|氨|液氨|氰|苯|甲苯|二甲苯|甲醇|酚|硫醇|四乙基铅|胺液/i],
  ['flammable', /氢|液化气|轻烃|石脑油|汽油|瓦斯|干气|丙烯|乙烯|丁烷|丙烷|原油|粗汽油|污油|油气|航煤|煤油|柴油|蜡油|渣油|油浆|溶剂|轻油/i],
  ['corrosive', /酸|碱|烧碱|盐酸|硫酸|碱液|次氯酸|氢氟酸/i],
  ['hot', /高温油|导热油|高温蒸汽|过热蒸汽|热油|熔盐/i],
  ['inert', /氮气|N2|惰性气|烟气|二氧化碳|CO2/i],
  ['low', /^水$|除盐水|循环水|空气|净化风|仪表风|新鲜水|凝结水|软化水|蒸汽/i],
];
/**
 * 介质危险特性
 * @returns {{hazards:string[], known:boolean}}
 *   known=false 表示介质为空或不在危险特性库 → 调用方须按最严口径（易燃易爆+有毒有害）处理并 warning，
 *   **绝不按低危或无危险处理**
 */
function mediumHazard(medium) {
  const s = String(medium || '').trim();
  if (!s) return { hazards: [], known: false };
  const hz = [];
  for (const [k, re] of MEDIUM_LIB) if (re.test(s)) hz.push(k);
  if (!hz.length) return { hazards: [], known: false };
  return { hazards: hz, known: true };
}
/** 未知介质时采用的最严口径 */
const STRICTEST_HAZARDS = ['flammable', 'toxic'];

// ---------------------------------------------------------------- 监督要点规则表
/**
 * 每条要点：{id, type, moment, text, method, owner}
 *   id     规则号，可对照 references/supervision-rules.md 复核
 *   type   来源作业类型
 *   moment 检查时点
 *   method 检查方式 visual|instrument|ask|doc
 *   owner  责任岗位
 * 要点内容限于厂内制度与作业票通常规定的监督事项，不含额外安全措施。
 */
const POINTS = [
  // ---- 作业许可通用（八大类共有）S：双监护 / JSA 风险分析交底 / 属地确认人（《中国石化作业许可管理规定》）
  { id: 'S01', type: 'permit', moment: 'before', text: '双监护到位：属地监护人与作业单位监护人均已到岗并在作业票上签字，与票面登记一致，佩戴监护标识', method: 'doc', owner: '设备员' },
  { id: 'S02', type: 'permit', moment: 'before', text: '作业前已完成 JSA/风险分析交底，作业人员逐人签字确认，交底内容与作业票安全措施一致', method: 'doc', owner: '作业负责人/属地监护人' },
  { id: 'S03', type: 'permit', moment: 'before', text: '属地确认人在场确认作业条件（设备交出、安全措施落实），并在作业票属地确认栏签字', method: 'doc', owner: '属地确认人/设备员' },
  { id: 'S04', type: 'permit', moment: 'during', text: '双监护全程在岗：属地监护人与作业单位监护人均不得离岗、不得兼做其他作业，离岗须先停止作业', method: 'visual', owner: '属地监护人/作业单位监护人' },
  { id: 'S05', type: 'permit', moment: 'shift', text: '监护人换人时在作业票上办理监护交接签字，接替人到岗前原监护人不得离开', method: 'doc', owner: '属地监护人/作业单位监护人' },

  // ---- 用火作业 H
  { id: 'H01', type: 'hotwork', moment: 'before', text: '用火作业票在有效期内，用火等级、用火部位与现场一致，审批签字齐全', method: 'doc', owner: '设备员/监护人' },
  { id: 'H02', type: 'hotwork', moment: 'before', text: '用火分析合格且在有效期内（通常取样后 30 分钟内用火），分析点位覆盖用火点及周边', method: 'doc', owner: '分析人员/监护人' },
  { id: 'H03', type: 'hotwork', moment: 'before', text: '用火点周边可燃物已清理或已用阻燃物遮盖，地漏、井口、电缆沟已封堵', method: 'visual', owner: '作业单位/监护人' },
  { id: 'H04', type: 'hotwork', moment: 'before', text: '灭火器、消防水带等消防器材按作业票要求配备到位且在有效期内', method: 'visual', owner: '监护人' },
  { id: 'H05', type: 'hotwork', moment: 'before', text: '用火监护人已到岗，持证且与作业票登记一致，熟悉用火部位与应急程序', method: 'doc', owner: '设备员' },
  { id: 'H06', type: 'hotwork', moment: 'before', text: '与用火点连通的设备、管线已隔绝、置换、清洗合格，盲板已加装并登记', method: 'visual', owner: '工艺员/设备员' },
  { id: 'H07', type: 'hotwork', moment: 'before', text: '焊接设备（焊机、氧气乙炔瓶）状态完好，气瓶间距及与火源距离符合作业票要求', method: 'visual', owner: '作业单位' },
  { id: 'H08', type: 'hotwork', moment: 'during', text: '按作业票规定频次复测用火分析，复测结果记录在用火票上', method: 'instrument', owner: '分析人员/监护人' },
  { id: 'H09', type: 'hotwork', moment: 'during', text: '火花飞溅方向受控，接火盆、挡火板到位，高处用火时下方火花落点已设专人看护', method: 'visual', owner: '监护人' },
  { id: 'H10', type: 'hotwork', moment: 'during', text: '监护人全程在岗且不兼做其他作业，视线不脱离用火点', method: 'visual', owner: '监护人' },
  { id: 'H11', type: 'hotwork', moment: 'during', text: '工艺参数与设备运行状态无异常，未出现可能导致介质外溢的工况波动', method: 'ask', owner: '工艺员' },
  { id: 'H12', type: 'hotwork', moment: 'resume', text: '中断后复工前重新做用火分析，分析合格方可复工', method: 'instrument', owner: '分析人员/监护人' },
  { id: 'H13', type: 'hotwork', moment: 'resume', text: '重新确认隔绝、清理、消防器材与监护人到位等各项措施仍然有效', method: 'visual', owner: '监护人' },
  { id: 'H14', type: 'hotwork', moment: 'shift', text: '交接班时向接班监护人交代用火部位、已完成工作量、分析记录与未完措施', method: 'ask', owner: '监护人' },
  { id: 'H15', type: 'hotwork', moment: 'shift', text: '接班监护人确认用火票仍在有效期内，超期须重新办票', method: 'doc', owner: '设备员' },
  { id: 'H16', type: 'hotwork', moment: 'closing', text: '作业完毕清理火种，熄灭焊渣、清走氧气乙炔瓶与焊把线', method: 'visual', owner: '作业单位/监护人' },
  { id: 'H17', type: 'hotwork', moment: 'closing', text: '现场留人监护不少于 30 分钟，确认无阴燃复燃后方可撤离', method: 'visual', owner: '监护人' },
  { id: 'H18', type: 'hotwork', moment: 'closing', text: '用火票收回、闭环签字，现场恢复至作业前状态', method: 'doc', owner: '设备员' },

  // ---- 受限空间作业 C
  { id: 'C01', type: 'confined', moment: 'before', text: '受限空间作业票在有效期内，进入部位、作业内容与现场一致', method: 'doc', owner: '设备员/监护人' },
  { id: 'C02', type: 'confined', moment: 'before', text: '氧含量检测合格：19.5%～23.5%（富氧作业另按作业票规定），检测点覆盖上中下三个部位', method: 'instrument', owner: '分析人员/监护人' },
  { id: 'C03', type: 'confined', moment: 'before', text: '有毒有害气体（硫化氢、一氧化碳、苯等）与可燃气体检测合格，结果记录在作业票上', method: 'instrument', owner: '分析人员' },
  { id: 'C04', type: 'confined', moment: 'before', text: '通风措施到位，强制通风设备运转正常，通风口位置不与排放口串通', method: 'visual', owner: '作业单位/监护人' },
  { id: 'C05', type: 'confined', moment: 'before', text: '照明使用安全电压（金属容器内不超过 12V），行灯变压器置于受限空间外', method: 'visual', owner: '电气/监护人' },
  { id: 'C06', type: 'confined', moment: 'before', text: '进出口通道畅通，无杂物阻挡，逃生路线明确', method: 'visual', owner: '监护人' },
  { id: 'C07', type: 'confined', moment: 'before', text: '监护人在受限空间外全程守护，与内部作业人保持可靠联络方式', method: 'visual', owner: '监护人' },
  { id: 'C08', type: 'confined', moment: 'before', text: '应急救援准备到位：空气呼吸器、安全绳、救援三脚架等按作业票要求配齐并试用合格', method: 'visual', owner: '监护人/安全员' },
  { id: 'C09', type: 'confined', moment: 'before', text: '与受限空间连通的管线已加盲板隔绝并登记，搅拌等转动部件已断电挂牌', method: 'visual', owner: '工艺员/电气' },
  { id: 'C10', type: 'confined', moment: 'during', text: '作业人进出逐人逐次登记，登记表随时反映内部实际在册人数', method: 'doc', owner: '监护人' },
  { id: 'C11', type: 'confined', moment: 'during', text: '按作业票规定频次复测氧含量与有毒有害气体，连续作业时保持持续监测', method: 'instrument', owner: '监护人' },
  { id: 'C12', type: 'confined', moment: 'during', text: '通风持续运行未中断，作业人未出现头晕、恶心等不适反应', method: 'ask', owner: '监护人' },
  { id: 'C13', type: 'confined', moment: 'during', text: '监护人不得离岗、不得进入受限空间内协助作业', method: 'visual', owner: '监护人' },
  { id: 'C14', type: 'confined', moment: 'resume', text: '中断（含用餐、交接班）后复工前重新检测氧含量与有毒有害气体，合格方可再次进入', method: 'instrument', owner: '分析人员/监护人' },
  { id: 'C15', type: 'confined', moment: 'resume', text: '复工前重新确认通风、照明、隔绝、救援器材各项措施仍然有效', method: 'visual', owner: '监护人' },
  { id: 'C16', type: 'confined', moment: 'shift', text: '交接班时清点内部人员全部撤出并登记销号后方可交班', method: 'doc', owner: '监护人' },
  { id: 'C17', type: 'confined', moment: 'shift', text: '向接班监护人交代检测记录、通风方式、内部作业进度与遗留风险', method: 'ask', owner: '监护人' },
  { id: 'C18', type: 'confined', moment: 'closing', text: '作业完毕清点人员与工具，确认无人员、无工具遗留在受限空间内', method: 'visual', owner: '监护人/作业单位' },
  { id: 'C19', type: 'confined', moment: 'closing', text: '封闭人孔前经设备员确认内部清理合格，作业票收回闭环', method: 'doc', owner: '设备员' },

  // ---- 高处作业 W
  { id: 'W01', type: 'height', moment: 'before', text: '高处作业票在有效期内，作业高度与级别与现场一致', method: 'doc', owner: '设备员/监护人' },
  { id: 'W02', type: 'height', moment: 'before', text: '作业人身体条件符合高处作业要求，无妨碍高处作业的疾病', method: 'ask', owner: '作业单位' },
  { id: 'W03', type: 'height', moment: 'before', text: '安全带完好且在检验有效期内，挂点牢固、高挂低用', method: 'visual', owner: '监护人' },
  { id: 'W04', type: 'height', moment: 'before', text: '防坠落措施到位：安全网、生命线、护栏或防坠器按作业票要求设置', method: 'visual', owner: '作业单位/监护人' },
  { id: 'W05', type: 'height', moment: 'before', text: '脚手架或吊篮经验收挂牌合格，攀登设施稳固，无缺件松动', method: 'doc', owner: '设备员/作业单位' },
  { id: 'W06', type: 'height', moment: 'before', text: '作业下方设警戒区并有专人看护，警戒范围覆盖可能落物范围', method: 'visual', owner: '监护人' },
  { id: 'W07', type: 'height', moment: 'before', text: '工具防坠措施到位：工具袋、防坠绳，零散物件不得裸放在平台边沿', method: 'visual', owner: '作业单位' },
  { id: 'W08', type: 'height', moment: 'before', text: '天气条件符合作业票规定，遇六级以上大风、雷雨、冰雪、浓雾不得作业', method: 'visual', owner: '设备员/监护人' },
  { id: 'W09', type: 'height', moment: 'during', text: '安全带全程系挂不脱钩，移动过程中采用双钩交替挂接', method: 'visual', owner: '监护人' },
  { id: 'W10', type: 'height', moment: 'during', text: '下方警戒区持续有效，无人员穿行或停留', method: 'visual', owner: '监护人' },
  { id: 'W11', type: 'height', moment: 'during', text: '材料工具上下传递使用绳索吊运，严禁抛掷', method: 'visual', owner: '监护人' },
  { id: 'W12', type: 'height', moment: 'resume', text: '中断后复工前重新检查脚手架、安全带挂点与防坠设施是否被移动或损坏', method: 'visual', owner: '监护人' },
  { id: 'W13', type: 'height', moment: 'resume', text: '复工前重新确认天气条件仍符合作业要求', method: 'visual', owner: '设备员/监护人' },
  { id: 'W14', type: 'height', moment: 'shift', text: '交接班时交代未完成部位、临时拆除的护栏与遗留在高处的工具材料', method: 'ask', owner: '监护人' },
  { id: 'W15', type: 'height', moment: 'closing', text: '作业完毕回收高处工具材料，恢复临时拆除的护栏与格栅板', method: 'visual', owner: '作业单位/监护人' },
  { id: 'W16', type: 'height', moment: 'closing', text: '撤除警戒与脚手架经设备员确认后进行，作业票收回闭环', method: 'doc', owner: '设备员' },

  // ---- 吊装作业 L
  { id: 'L01', type: 'lifting', moment: 'before', text: '吊装作业票在有效期内，吊装方案（大件吊装）已审批且与现场一致', method: 'doc', owner: '设备员' },
  { id: 'L02', type: 'lifting', moment: 'before', text: '起重机械与司机、司索、指挥人员证件齐全且在有效期内', method: 'doc', owner: '设备员' },
  { id: 'L03', type: 'lifting', moment: 'before', text: '吊索具检查：钢丝绳无断丝断股、吊带无破损、卡环与吊钩防脱装置完好，均在检验期内', method: 'visual', owner: '司索工/监护人' },
  { id: 'L04', type: 'lifting', moment: 'before', text: '载荷确认：被吊物重量、重心与吊车额定起重量、幅度匹配，不得估重作业', method: 'doc', owner: '设备员/指挥' },
  { id: 'L05', type: 'lifting', moment: 'before', text: '吊车支腿全伸、支垫牢固，站位地基承载满足要求且避开地下管线与沟槽', method: 'visual', owner: '指挥/设备员' },
  { id: 'L06', type: 'lifting', moment: 'before', text: '警戒区按吊装幅度划定并有专人看守，回转半径内无无关人员与设备', method: 'visual', owner: '监护人' },
  { id: 'L07', type: 'lifting', moment: 'before', text: '指挥信号统一，指挥人员唯一且与司机确认手势或对讲频道', method: 'ask', owner: '指挥' },
  { id: 'L08', type: 'lifting', moment: 'before', text: '吊臂与架空电力线、管廊、设备的安全距离符合作业票规定', method: 'visual', owner: '指挥/设备员' },
  { id: 'L09', type: 'lifting', moment: 'during', text: '试吊确认：离地 20～30cm 停稳，检查捆绑牢固、制动可靠后再继续起吊', method: 'visual', owner: '指挥' },
  { id: 'L10', type: 'lifting', moment: 'during', text: '严禁斜拉、斜吊与埋压物强行起吊', method: 'visual', owner: '指挥/监护人' },
  { id: 'L11', type: 'lifting', moment: 'during', text: '任何人员不得在吊物下方或吊臂回转范围内停留、穿行', method: 'visual', owner: '监护人' },
  { id: 'L12', type: 'lifting', moment: 'during', text: '溜绳控制被吊物摆动，风力超过作业票规定时停止吊装', method: 'visual', owner: '指挥' },
  { id: 'L13', type: 'lifting', moment: 'resume', text: '中断后复工前重新检查吊索具、支腿支垫与警戒区是否发生变化', method: 'visual', owner: '指挥/监护人' },
  { id: 'L14', type: 'lifting', moment: 'resume', text: '被吊物不得长时间悬空过夜；中断时应落地稳固后方可离开', method: 'visual', owner: '指挥' },
  { id: 'L15', type: 'lifting', moment: 'shift', text: '交接班时交代吊装进度、临时支撑状态与未拆除的吊索具', method: 'ask', owner: '指挥/监护人' },
  { id: 'L16', type: 'lifting', moment: 'closing', text: '吊物就位并固定稳妥后方可松钩，临时支撑经确认后拆除', method: 'visual', owner: '指挥/设备员' },
  { id: 'L17', type: 'lifting', moment: 'closing', text: '吊索具回收、吊车收臂撤场，警戒撤除，作业票收回闭环', method: 'visual', owner: '设备员' },

  // ---- 临时用电 E
  { id: 'E01', type: 'power', moment: 'before', text: '临时用电作业票在有效期内，接电点、容量与用电设备与现场一致', method: 'doc', owner: '设备员/电气' },
  { id: 'E02', type: 'power', moment: 'before', text: '接电由持证电工操作，作业单位不得私自接电、甩线', method: 'doc', owner: '电气' },
  { id: 'E03', type: 'power', moment: 'before', text: '漏电保护器已安装且动作试验合格，一机一闸一漏一箱', method: 'instrument', owner: '电气' },
  { id: 'E04', type: 'power', moment: 'before', text: '线路绝缘完好，无破损、老化、接头裸露，过路处有防碾压保护', method: 'visual', owner: '电气/监护人' },
  { id: 'E05', type: 'power', moment: 'before', text: '配电箱、用电设备外壳接地或接零可靠，接地电阻符合作业票要求', method: 'instrument', owner: '电气' },
  { id: 'E06', type: 'power', moment: 'before', text: '防爆区域使用符合区域防爆等级的电气设备与接线方式', method: 'visual', owner: '电气/设备员' },
  { id: 'E07', type: 'power', moment: 'before', text: '临时线路架设高度与走向符合规定，不得缠绕在管线、栏杆、脚手架上', method: 'visual', owner: '电气/监护人' },
  { id: 'E08', type: 'power', moment: 'during', text: '专人管理临时用电，配电箱上锁并挂牌标明责任人与用电单位', method: 'visual', owner: '电气' },
  { id: 'E09', type: 'power', moment: 'during', text: '未经许可不得擅自增加用电设备或改变接电点，不得超容量使用', method: 'ask', owner: '电气/监护人' },
  { id: 'E10', type: 'power', moment: 'during', text: '雨雪天气与积水部位加强检查，发现线路进水、外皮破损立即停电处理', method: 'visual', owner: '电气/监护人' },
  { id: 'E11', type: 'power', moment: 'resume', text: '中断后复工前重新检查线路绝缘与漏电保护动作，确认无被碾压、拖拽损伤', method: 'instrument', owner: '电气' },
  { id: 'E12', type: 'power', moment: 'shift', text: '交接班时交代带电线路走向、临时配电箱位置与未拆除的临时电源', method: 'ask', owner: '电气/监护人' },
  { id: 'E13', type: 'power', moment: 'closing', text: '作业完毕先停电后拆线，由持证电工拆除，临时线路不得遗留', method: 'visual', owner: '电气' },
  { id: 'E14', type: 'power', moment: 'closing', text: '恢复原有电气设施状态，作业票收回闭环', method: 'doc', owner: '设备员' },

  // ---- 动土作业 G
  { id: 'G01', type: 'excavation', moment: 'before', text: '动土作业票在有效期内，开挖位置、深度与现场一致', method: 'doc', owner: '设备员' },
  { id: 'G02', type: 'excavation', moment: 'before', text: '地下管线、电缆、光缆走向已查明并现场标识，必要时先人工探挖', method: 'doc', owner: '设备员/工艺员' },
  { id: 'G03', type: 'excavation', moment: 'before', text: '开挖区域设围栏与警示标志，夜间设警示灯', method: 'visual', owner: '作业单位/监护人' },
  { id: 'G04', type: 'excavation', moment: 'during', text: '边坡放坡或支护符合作业票要求，土方堆放距坑边距离满足规定', method: 'visual', owner: '监护人' },
  { id: 'G05', type: 'excavation', moment: 'during', text: '坑内作业深度超过规定时按受限空间管理，先检测后进入', method: 'instrument', owner: '监护人' },
  { id: 'G06', type: 'excavation', moment: 'resume', text: '中断（尤其雨后）复工前检查边坡是否坍塌、坑内是否积水积气', method: 'visual', owner: '监护人' },
  { id: 'G07', type: 'excavation', moment: 'shift', text: '交接班时交代已开挖范围、暴露的地下设施与支护状态', method: 'ask', owner: '监护人' },
  { id: 'G08', type: 'excavation', moment: 'closing', text: '回填前经设备员确认暴露管线无损伤，回填分层夯实并恢复地面标识', method: 'visual', owner: '设备员' },

  // ---- 断路作业 R
  { id: 'R01', type: 'blockade', moment: 'before', text: '断路作业票在有效期内，占路范围、时段与现场一致', method: 'doc', owner: '设备员' },
  { id: 'R02', type: 'blockade', moment: 'before', text: '绕行路线已确定并设置指示标志，消防车通道与应急通道不得同时封堵', method: 'visual', owner: '设备员/安全员' },
  { id: 'R03', type: 'blockade', moment: 'before', text: '断路两端设置路障、警示标志，夜间设警示灯，已通知相关车间与消防队', method: 'visual', owner: '设备员' },
  { id: 'R04', type: 'blockade', moment: 'during', text: '占路范围不得擅自扩大，路面开挖处设置盖板或跨越设施', method: 'visual', owner: '监护人' },
  { id: 'R05', type: 'blockade', moment: 'resume', text: '中断后复工前确认路障、标志、绕行指示仍然完整有效', method: 'visual', owner: '监护人' },
  { id: 'R06', type: 'blockade', moment: 'shift', text: '交接班时交代占路范围、恢复时间与已通知的单位', method: 'ask', owner: '设备员/监护人' },
  { id: 'R07', type: 'blockade', moment: 'closing', text: '作业完毕清理路面、恢复通行并通知相关单位，作业票收回闭环', method: 'visual', owner: '设备员' },

  // ---- 盲板抽堵 B
  { id: 'B01', type: 'blind', moment: 'before', text: '盲板抽堵作业票在有效期内，盲板位置图与现场一致', method: 'doc', owner: '设备员' },
  { id: 'B02', type: 'blind', moment: 'before', text: '介质泄压确认：上下游已切断、泄压至常压并经导淋验证，不得凭压力表读数单一判断', method: 'instrument', owner: '工艺员/监护人' },
  { id: 'B03', type: 'blind', moment: 'before', text: '管线已置换、吹扫合格，高温介质已降温至可作业温度', method: 'instrument', owner: '工艺员' },
  { id: 'B04', type: 'blind', moment: 'before', text: '盲板规格与材质符合管线压力等级与介质要求，带柄盲板便于识别', method: 'doc', owner: '设备员' },
  { id: 'B05', type: 'blind', moment: 'before', text: '盲板逐块编号并登记在盲板管理表上，挂牌标识位置与编号', method: 'doc', owner: '设备员' },
  { id: 'B06', type: 'blind', moment: 'before', text: '作业人按介质特性佩戴防护用品（防毒面具、防酸碱服、防护面罩等）', method: 'visual', owner: '监护人' },
  { id: 'B07', type: 'blind', moment: 'during', text: '按规定顺序拆装：先松远离作业人一侧螺栓，缓慢泄放残余介质后再全部拆除', method: 'visual', owner: '监护人' },
  { id: 'B08', type: 'blind', moment: 'during', text: '作业人站位避开介质可能喷出方向，下风向不得站人', method: 'visual', owner: '监护人' },
  { id: 'B09', type: 'blind', moment: 'during', text: '易燃介质管线抽堵使用防爆工具，不得产生撞击火花', method: 'visual', owner: '监护人' },
  { id: 'B10', type: 'blind', moment: 'resume', text: '中断后复工前重新确认泄压隔绝状态，管线可能重新憋压时须再次泄压验证', method: 'instrument', owner: '工艺员/监护人' },
  { id: 'B11', type: 'blind', moment: 'shift', text: '交接班时逐块核对盲板登记表，已装与已拆数量与现场一致', method: 'doc', owner: '设备员/监护人' },
  { id: 'B12', type: 'blind', moment: 'closing', text: '作业完毕按登记表逐块销号，确认无漏拆、漏装盲板', method: 'doc', owner: '设备员' },
  { id: 'B13', type: 'blind', moment: 'closing', text: '法兰复位紧固到位，试压或气密合格后作业票收回闭环', method: 'visual', owner: '设备员' },

  // ---- 常规检修作业 D
  { id: 'D01', type: 'overhaul', moment: 'before', text: '检修作业票与检修方案齐全，作业内容、范围与现场一致', method: 'doc', owner: '设备员' },
  { id: 'D02', type: 'overhaul', moment: 'before', text: '设备已停车、隔绝、泄压、置换、断电挂牌，交出条件经工艺与设备双方确认', method: 'doc', owner: '工艺员/设备员' },
  { id: 'D03', type: 'overhaul', moment: 'before', text: '作业人员资质与人数与作业票一致，已完成班前安全交底并签字', method: 'doc', owner: '作业单位/设备员' },
  { id: 'D04', type: 'overhaul', moment: 'before', text: '劳保用品穿戴齐全规范，工器具经检查完好', method: 'visual', owner: '监护人' },
  { id: 'D05', type: 'overhaul', moment: 'before', text: '作业区域与运行设备之间的隔离措施到位，警戒标识清晰', method: 'visual', owner: '设备员/监护人' },
  { id: 'D06', type: 'overhaul', moment: 'during', text: '作业内容不超出作业票范围，扩项须重新办票', method: 'ask', owner: '设备员' },
  { id: 'D07', type: 'overhaul', moment: 'during', text: '拆卸件、备件摆放有序，不占用通道与消防设施前方空间', method: 'visual', owner: '监护人' },
  { id: 'D08', type: 'overhaul', moment: 'during', text: '关键工序（找正、紧固力矩、间隙测量）按方案执行并记录，设备员现场确认', method: 'instrument', owner: '设备员' },
  { id: 'D09', type: 'overhaul', moment: 'during', text: '现场文明施工：油污及时清理，废料分类收集，不得随地排放', method: 'visual', owner: '监护人' },
  { id: 'D10', type: 'overhaul', moment: 'resume', text: '中断后复工前重新确认隔绝、断电挂牌措施未被解除或变动', method: 'visual', owner: '设备员/监护人' },
  { id: 'D11', type: 'overhaul', moment: 'shift', text: '交接班时交代拆解进度、已拆部件去向、未完工序与遗留风险，双方签字', method: 'doc', owner: '设备员/作业单位' },
  { id: 'D12', type: 'overhaul', moment: 'closing', text: '回装完毕清点工具与零件，确认无遗留物在设备内部', method: 'visual', owner: '设备员/作业单位' },
  { id: 'D13', type: 'overhaul', moment: 'closing', text: '现场清理恢复，拆除的隔离与挂牌按程序解除，作业票收回闭环', method: 'doc', owner: '设备员' },
  { id: 'D14', type: 'overhaul', moment: 'closing', text: '交付前进行试车或试压验收，验收结论记录在检修记录上', method: 'instrument', owner: '设备员/工艺员' },
];

// ---------------------------------------------------------------- 通用监督框架（未覆盖类型）
/**
 * 通用监督框架：只包含厂内任何作业都适用的程序性检查，不含任何具体作业类型的安全技术要点。
 * 未覆盖的作业类型只输出本框架 + warning，**模型与脚本都不得凭通用安全知识补充具体要点**。
 */
const GENERIC_POINTS = [
  { id: 'X01', type: 'generic', moment: 'before', text: '作业票齐全且在有效期内，作业内容、部位、时段与现场一致', method: 'doc', owner: '设备员' },
  { id: 'X02', type: 'generic', moment: 'before', text: '作业人员资质、人数与作业票一致，已完成安全交底并签字', method: 'doc', owner: '作业单位/设备员' },
  { id: 'X03', type: 'generic', moment: 'before', text: '作业票列明的安全措施逐条现场确认已落实', method: 'visual', owner: '监护人' },
  { id: 'X04', type: 'generic', moment: 'before', text: '监护人到岗并明确职责，应急联络方式畅通', method: 'ask', owner: '设备员' },
  { id: 'X05', type: 'generic', moment: 'during', text: '作业内容不超出作业票范围，扩项或变更须重新办票', method: 'ask', owner: '设备员' },
  { id: 'X06', type: 'generic', moment: 'during', text: '监护人在岗履职，作业条件未发生变化', method: 'visual', owner: '监护人' },
  { id: 'X07', type: 'generic', moment: 'resume', text: '中断后复工前重新确认作业票有效性与各项安全措施仍然有效', method: 'visual', owner: '监护人' },
  { id: 'X08', type: 'generic', moment: 'shift', text: '交接班交代作业进度、已落实措施与遗留风险，双方签字确认', method: 'doc', owner: '设备员/监护人' },
  { id: 'X09', type: 'generic', moment: 'closing', text: '作业完毕清理现场、清点工具，恢复至作业前状态', method: 'visual', owner: '监护人' },
  { id: 'X10', type: 'generic', moment: 'closing', text: '作业票收回闭环签字', method: 'doc', owner: '设备员' },
];
const GENERIC_NOTE = '待安全专业补充';

// ---------------------------------------------------------------- 组合加严规则
/**
 * 组合加严规则：当两种及以上作业类型同时存在时，某些要点的口径须加严或存在冲突需现场裁决。
 * 每条：{id, when:[类型...], item, conflict, action, owner}
 *   conflict —— 冲突或加严的描述（各类型单独口径不一致之处）
 *   action   —— 加严后的执行口径（不超出厂内制度与作业票规定）
 * 未列入本表的组合不自行加严，避免给出超出作业票规定的措施。
 */
const ESCALATIONS = [
  {
    id: 'X-HC-1', when: ['hotwork', 'confined'], item: '气体分析频次',
    conflict: '用火票通常要求按规定频次复测，受限空间要求连续监测；两者频次口径不一致',
    action: '取两者中更严口径：受限空间内用火期间保持连续监测，并按用火票频次单独取样记录',
    owner: '分析人员/监护人',
  },
  {
    id: 'X-HC-2', when: ['hotwork', 'confined'], item: '监护配置',
    conflict: '用火需用火监护人，受限空间需受限空间监护人，同一人无法兼顾两处职责',
    action: '按作业票分别配置监护人，受限空间外监护人不得兼任用火监护，均不得离岗',
    owner: '设备员',
  },
  {
    id: 'X-HC-3', when: ['hotwork', 'confined'], item: '中断后复工',
    conflict: '两类作业均要求复工前重新检测，检测项目不同',
    action: '复工前同时重做用火分析与受限空间氧含量、有毒有害气体检测，全部合格方可复工',
    owner: '分析人员/监护人',
  },
  {
    id: 'X-HW-1', when: ['hotwork', 'height'], item: '火花落点控制',
    conflict: '高处用火的火花飞溅范围大于地面用火，单一挡火板不足以覆盖',
    action: '下方警戒范围按火花可能落点扩展，并在落点处设专人看护与灭火器材',
    owner: '监护人',
  },
  {
    id: 'X-HB-1', when: ['hotwork', 'blind'], item: '作业顺序',
    conflict: '盲板抽堵可能释放残余可燃介质，与用火同期进行存在点火风险',
    action: '盲板抽堵与用火不得同时进行；抽堵完毕并经气体分析合格后方可用火',
    owner: '设备员/监护人',
  },
  {
    id: 'X-LH-1', when: ['lifting', 'height'], item: '警戒与人员站位',
    conflict: '吊装回转半径与高处作业下方警戒区重叠，两处警戒责任不清',
    action: '合并划定警戒区并由统一指挥人员管理；吊物经过时高处作业暂停',
    owner: '指挥/监护人',
  },
  {
    id: 'X-LC-1', when: ['lifting', 'confined'], item: '吊运与人员进出',
    conflict: '受限空间人孔上方吊运会阻断逃生通道',
    action: '吊物经过受限空间出入口上方时，内部作业人员先撤出，作业暂停',
    owner: '指挥/监护人',
  },
  {
    id: 'X-CE-1', when: ['confined', 'power'], item: '照明与用电安全',
    conflict: '临时用电常规电压与受限空间安全电压要求不一致',
    action: '受限空间内照明与电动工具一律按安全电压执行，变压器与配电箱置于空间外',
    owner: '电气/监护人',
  },
  {
    id: 'X-HE-1', when: ['hotwork', 'power'], item: '防爆要求',
    conflict: '用火区域临时用电线路与设备若非防爆型，构成额外点火源',
    action: '用火区域内临时用电设备按区域防爆等级配置，接线点远离用火点',
    owner: '电气/设备员',
  },
  {
    id: 'X-GR-1', when: ['excavation', 'blockade'], item: '通道封堵',
    conflict: '开挖与占路叠加可能同时封堵消防车通道与应急通道',
    action: '保证至少一条消防与应急通道畅通，绕行路线现场标识并通知消防队',
    owner: '设备员/安全员',
  },
  {
    id: 'X-DB-1', when: ['overhaul', 'blind'], item: '交出条件确认',
    conflict: '检修交出确认与盲板登记分属两份记录，易出现漏拆漏装',
    action: '检修开工前与收尾时均以盲板登记表逐块核对，与检修交出确认单一并签字',
    owner: '设备员',
  },
];

/**
 * 计算组合加严项
 * @param {string[]} types 覆盖范围内的作业类型
 * @returns {Array} 命中的加严规则（含中文类型名）
 */
function escalationsFor(types) {
  const set = new Set(types);
  return ESCALATIONS
    .filter((e) => e.when.every((t) => set.has(t)))
    .map((e) => ({
      id: e.id,
      item: e.item,
      types: e.when.slice(),
      typesCn: e.when.map((t) => TYPE_CN[t]),
      conflict: e.conflict,
      action: e.action,
      owner: e.owner,
    }));
}

// ---------------------------------------------------------------- 作业票级别（--level，由作业票给出，脚本不自判）
/**
 * 作业票级别 → 频次口径映射（《中国石化作业许可管理规定》/ GB 30871-2022 的分级名称，只引分级概念不引数值）
 *   用火：特级 / 一级 / 二级；高处：一级 ~ 四级（级别越高越危险）；吊装：一级 ~ 三级（一级最重）
 * 返回 {type, grade, risk, cn}；无法识别 → null（调用方 warning，按作业类型默认口径）
 */
const LEVEL_PATTERNS = [
  ['hotwork', /特级/, '特级', 'high'],
  ['hotwork', /(^|[^特])一级|1级|I级|Ⅰ级/, '一级', 'high'],
  ['hotwork', /二级|2级|II级|Ⅱ级/, '二级', 'medium'],
];
const HEIGHT_LEVELS = [['一级', 'medium', /一级|1级|I级|Ⅰ级/], ['二级', 'medium', /二级|2级|II级|Ⅱ级/], ['三级', 'high', /三级|3级|III级|Ⅲ级/], ['四级', 'high', /四级|4级|IV级|Ⅳ级/]];
const LIFT_LEVELS = [['一级', 'high', /一级|1级|I级|Ⅰ级/], ['二级', 'high', /二级|2级|II级|Ⅱ级/], ['三级', 'medium', /三级|3级|III级|Ⅲ级/]];
function parseLevel(text, types = []) {
  const s = String(text || '').replace(/\s/g, '');
  if (!s) return null;
  const hasHot = /用火|动火/.test(s) || (!/高处|登高|吊装|起重/.test(s) && types.includes('hotwork'));
  const hasHeight = /高处|登高/.test(s) || (!/用火|动火|吊装|起重/.test(s) && !hasHot && types.includes('height'));
  const hasLift = /吊装|起重/.test(s) || (!/用火|动火|高处|登高/.test(s) && !hasHot && !hasHeight && types.includes('lifting'));
  if (hasHot) {
    if (/特级/.test(s)) return { type: 'hotwork', grade: '特级', risk: 'high', cn: '特级用火' };
    if (/二级|2级|II级|Ⅱ级/.test(s)) return { type: 'hotwork', grade: '二级', risk: 'medium', cn: '二级用火' };
    if (/一级|1级|I级|Ⅰ级/.test(s)) return { type: 'hotwork', grade: '一级', risk: 'high', cn: '一级用火' };
    return null;
  }
  if (hasHeight) {
    for (const [g, r, re] of HEIGHT_LEVELS) if (re.test(s)) return { type: 'height', grade: g, risk: r, cn: `高处作业${g}` };
    return null;
  }
  if (hasLift) {
    for (const [g, r, re] of LIFT_LEVELS) if (re.test(s)) return { type: 'lifting', grade: g, risk: r, cn: `吊装作业${g}` };
    return null;
  }
  return null;
}
/** 各级别的旁站/到场口径提示（默认口径，厂内规定为准；具体到场人员与审批层级以作业票为准） */
const LEVEL_NOTE = {
  'hotwork-特级': '特级用火：全程旁站，按作业票要求的公司/分厂级监护与到场确认执行，监护人不得兼任',
  'hotwork-一级': '一级用火：用火全过程旁站，按作业票频次复测用火分析',
  'hotwork-二级': '二级用火：起火与收尾到场确认，过程按频次巡查',
  'height-一级': '高处一级：开工与收尾到场确认，过程按频次巡查',
  'height-二级': '高处二级：开工与收尾到场确认，过程按频次巡查',
  'height-三级': '高处三级：关键工序旁站，下方警戒持续有专人看护',
  'height-四级': '高处四级：全程旁站，按作业票要求的审批层级到场确认',
  'lifting-一级': '吊装一级：起吊、落钩全程旁站，按作业票要求的吊装方案与到场确认执行',
  'lifting-二级': '吊装二级：起吊、落钩旁站',
  'lifting-三级': '吊装三级：起吊与落钩到场确认',
};

// ---------------------------------------------------------------- 风险等级与频次
const RISK_CN = { high: '高风险', medium: '中风险', low: '低风险' };
/** 分级的作业类别：用火（特级/一级/二级）、高处（一~四级）、吊装（一~三级）；其余类别不分级 */
const GRADED_TYPES = ['hotwork', 'height', 'lifting'];
/** 各类型的基础风险等级（依据厂内特殊作业管理口径） */
const TYPE_RISK = {
  hotwork: 'high', confined: 'high', lifting: 'high', blind: 'high',
  height: 'medium', power: 'medium', excavation: 'medium', blockade: 'low',
  overhaul: 'low', generic: 'low',
};
const RISK_ORDER = { low: 0, medium: 1, high: 2 };

/**
 * 风险等级 = 各作业类型基础风险的最大值，遇下列情形上调一级（封顶 high）：
 *   - 介质具易燃易爆或有毒有害特性
 *   - 介质不在危险特性库（按最严口径处理）
 *   - 作业类型数 ≥ 2（组合作业）
 * @returns {{level:string, levelCn:string, reasons:string[]}}
 */
function riskLevel({ types, hazards, mediumKnown, comboCount, level = null }) {
  const reasons = [];
  let lv = 'low';
  for (const t of types) {
    const r = TYPE_RISK[t] || 'low';
    if (RISK_ORDER[r] > RISK_ORDER[lv]) lv = r;
  }
  if (types.length) reasons.push(`作业类型基础风险（默认口径）：${types.map((t) => `${TYPE_CN[t] || t}（${RISK_CN[TYPE_RISK[t] || 'low']}）`).join('、')}`);
  if (level) {
    if (RISK_ORDER[level.risk] > RISK_ORDER[lv]) lv = level.risk;
    reasons.push(`作业票级别：${level.cn}（级别以作业票为准，脚本不自判）→ 频次口径不低于${RISK_CN[level.risk]}`);
  } else {
    // 只有用火、高处、吊装分级（GB 30871-2022）；其余类别票面级别为空，不要求传 --level
    const graded = types.filter((t) => GRADED_TYPES.includes(t));
    if (types.length && !graded.length) reasons.push(`${types.map((t) => TYPE_CN[t] || t).join('、')}不分级，频次按作业类型默认口径`);
    else reasons.push(`未提供作业票级别（--level），频次按作业类型默认口径；有作业票时请按票面级别传入${graded.length ? `（${graded.map((t) => TYPE_CN[t]).join('、')}）` : ''}`);
  }
  const bump = (why) => {
    reasons.push(why);
    if (lv === 'low') lv = 'medium';
    else lv = 'high';
  };
  if (!mediumKnown) bump('介质未填或不在危险特性库，按最严口径上调一级');
  else if (hazards.some((h) => h === 'flammable' || h === 'toxic')) bump(`介质具${hazards.filter((h) => h === 'flammable' || h === 'toxic').map((h) => HAZ_CN[h]).join('、')}特性，上调一级`);
  if (comboCount >= 2) bump(`${comboCount} 类作业组合，上调一级`);
  return { level: lv, levelCn: RISK_CN[lv], reasons };
}

/**
 * 检查频次建议（按风险等级）
 * 只给巡查间隔与旁站要求，不涉及作业票之外的其他措施。
 */
const FREQ_TABLE = {
  high: {
    patrol: '每 30 分钟至少现场巡查一次',
    standby: '关键工序（用火起火、人员进入受限空间、起吊落钩）全程旁站',
    record: '每次巡查在检查记录表上签字记录',
    gasTest: '按作业票规定频次复测，受限空间作业期间保持连续监测',
  },
  medium: {
    patrol: '每 1 小时至少现场巡查一次',
    standby: '关键工序开始与结束时到现场确认',
    record: '每次巡查在检查记录表上签字记录',
    gasTest: '按作业票规定频次复测；条件变化时随时加测',
  },
  low: {
    patrol: '每 2 小时至少现场巡查一次',
    standby: '开工与收尾到现场确认',
    record: '每班在检查记录表上汇总记录一次',
    gasTest: '按作业票规定执行；本类作业通常无强制复测要求',
  },
};

/**
 * 关键时点：固定五个检查时点 + 按作业时长推算的巡查轮次提示
 * @param {number|null} durationHours 预计时长，null 时不推算轮次（不臆测）
 */
function keyMomentsFor(level, durationHours, permitLevel = null) {
  const freq = Object.assign({}, FREQ_TABLE[level]);
  freq.levelNote = permitLevel ? (LEVEL_NOTE[`${permitLevel.type}-${permitLevel.grade}`] || null) : null;
  freq.source = '检查频次为本技能默认口径（非厂内正式口径），厂内有规定以厂内为准；作业票级别对应的监护与到场要求以作业票为准';
  const intervalMin = level === 'high' ? 30 : level === 'medium' ? 60 : 120;
  const rounds = (durationHours === null || durationHours === undefined || !Number.isFinite(durationHours))
    ? null : Math.max(1, Math.ceil((durationHours * 60) / intervalMin));
  return {
    moments: MOMENTS.map((m) => ({ moment: m, momentCn: MOMENT_CN[m], note: MOMENT_NOTE[m] })),
    intervalMin,
    rounds,
    freq,
  };
}
const MOMENT_NOTE = {
  before: '开工前逐项确认作业票措施落实，未确认不得开工',
  during: '按频次巡查，关键工序旁站',
  resume: '任何中断（含用餐、交接班、停电、天气）后复工须重新确认条件',
  shift: '交接班双方现场交接并签字，不得电话交接',
  closing: '作业完毕清理现场、清点人机料，作业票收回闭环',
};

/**
 * 选取监督要点
 * @returns {Array} 要点数组，带 seq、来源类型中文名
 */
function pointsFor(types, { generic } = {}) {
  const hasSpecial = types.some((t) => SPECIAL_TYPES.includes(t));
  const src = generic ? GENERIC_POINTS : POINTS.filter((p) => types.includes(p.type) || (hasSpecial && p.type === 'permit'));
  const ordered = [];
  for (const m of MOMENTS) {
    for (const p of src) {
      if (p.moment !== m) continue;
      ordered.push({
        id: p.id,
        moment: p.moment,
        momentCn: MOMENT_CN[p.moment],
        text: p.text,
        type: p.type,
        typeCn: p.type === 'generic' ? '通用框架' : TYPE_CN[p.type],
        method: p.method,
        methodCn: METHOD_CN[p.method],
        owner: p.owner,
      });
    }
  }
  return ordered.map((p, i) => ({ seq: i + 1, ...p }));
}

module.exports = {
  MOMENTS, MOMENT_CN, METHOD_CN, MOMENT_NOTE,
  TYPE_CN, SPECIAL_TYPES, COVERED_TYPES, classifyTypes,
  HAZ_CN, mediumHazard, STRICTEST_HAZARDS,
  POINTS, GENERIC_POINTS, GENERIC_NOTE,
  ESCALATIONS, escalationsFor,
  RISK_CN, TYPE_RISK, riskLevel, FREQ_TABLE, keyMomentsFor,
  parseLevel, LEVEL_NOTE, GRADED_TYPES,
  pointsFor,
};
