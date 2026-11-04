---
name: inspection-evidence-package
description: 迎检资料准备与证据材料归集（中石化体系炼化厂车间设备员口径）。当用户提到"要来检查了""准备检查资料""台账要交上去""按检查通知准备材料""迎检""证据材料""检查组要看哪些资料"并提供检查通知或检查表与本车间台账数据时使用；解析检查项要求，从台账、记录、工单中定位对应证据材料，输出资料清单、缺口清单与归集包目录。覆盖设备专业检查、安全生产检查、特种设备监察、环保检查、内部审计，含变更管理（MOC）、联锁/SIS、特护设备、润滑五定三过滤、LDAR、一机一档、用火等作业许可类检查项。自查表填报用 self-audit-form-filler；合规性判定用 regulation-compliance-check；资料归档用 maintenance-record-archive；不替代实际资料的编制与补录。
allowed-tools: Read,Write,Bash
agent_created: true
metadata:
  version: 0.2.0
  author: calvin
  tags: [refinery, equipment, audit, compliance]
---

# 迎检资料准备（inspection-evidence-package）

面向中石化体系炼化厂车间（运行部）设备员，按分厂、公司设备管理部门或外部监管的检查通知要求，从现有台账与记录中定位对应证据材料，快速形成迎检资料包。**资料是否存在由脚本比对确定，模型只负责成文；不得声称缺失的资料"可以用其他材料替代"，更不得建议补做记录。**

## 适用条件
- 用户说"要来检查了准备材料 / 按这个检查表把资料找出来 / 迎检资料清单 / 台账要交哪些"，并提供检查通知、检查表或检查项清单。
- 覆盖检查类型：设备专业检查、安全生产检查、特种设备监察、环保检查、内部审计；检查项类别 26 类（含变更管理 MOC、安全仪表与联锁 SIS、特护设备、润滑五定三过滤、LDAR、一机一档、作业票按中石化八大类以"用火作业"为正式名称）。
- 车间设备员可做：资料定位、清单与缺口整理、归集包目录。**不做**：检查项是否达标合规的判定（检查组 / regulation-compliance-check）、自查表填报（self-audit-form-filler）、缺失资料的编制与补录。
- 不适用：自查表的填报；合规性是否达标的判定；缺失资料的编制、补录与代写。

## 前提条件
- 输入：检查通知或检查表（`.docx`/`.xlsx`/`.md`/`.txt` 文字件），以及本车间的台账与记录目录或资料清单 xlsx。
- **PDF 前置步骤**：脚本不读 PDF。检查通知是 PDF 的，先用平台 pdf 技能转为 txt/docx 再传入；扫描件需先 OCR。材料目录里的 PDF 文件只按文件名参与比对（文件名能推出时间区间的照常判定覆盖）。
- 必填信息：车间名称、检查名称与时间、检查范围。可选：厂内资料归档规范、上次同类检查的资料包目录、检查期（`--date-range`）。
- 环境：可执行 Node.js ≥ 18，脚本仅用内置模块，无需 npm 安装。**若环境无法执行 node（无 Bash 工具或 `node --version` 失败），明确告知用户并终止，不得凭印象列资料清单。**

## 数据获取（MCP）

平台接入了业务系统 MCP 服务时，按下表调用工具取数，不再请用户上传导出文件；未接入时按操作步骤请用户提供系统导出文件。工具全部只读，不在业务系统里创建或修改任何单据。

| 服务 | 工具 | 参数 | 交给脚本 |
|---|---|---|---|
| 设备资产管理 | `get_equipment_ledger` | `workshop`：车间 | `--materials` |
| 设备资产管理 | `get_special_equipment` | `workshop`：车间 | `--materials` |
| 设备资产管理 | `get_safety_valves` | `workshop`：车间 | `--materials` |
| 点检巡检App | `get_inspection_records` | `workshop`：车间；`start_date`：检查期起始日；`end_date`：检查期截止日 | `--materials` |
| 设备资产管理 | `get_failure_history` | `workshop`：车间；`start_date`：检查期起始日；`end_date`：检查期截止日 | `--materials` |
| HSE管理平台 | `get_hazards` | `workshop`：车间；`start_date`：检查期起始日；`end_date`：检查期截止日 | `--materials` |
| HSE管理平台 | `get_personnel_certificates` | — | `--materials` |
| 设备资产管理 | `get_notifications` | `workshop`：车间；`start_date`：检查期起始日；`end_date`：检查期截止日 | `--materials` |
| 作业票系统 | `get_permits` | `workshop`：车间 | `--materials` |

取数后：

1. 工具返回下载链接（60 分钟内有效，过期重新调用）。csv 按原文件名放进新建的空目录，不改文件名，不与其他技能的文件混放；把目录作为“交给脚本”一列的参数值。
2. `get_inspection_records`：不填 for_skill；不传日期时默认返回近 7 天，系统只保留近 30 天记录。检查期早于近 30 天时返回只有表头的空表，空表照常放进目录即可：脚本不把空表当证据，对应检查项判「未找到对应材料」，须如实说明系统里已查不到检查期的巡检记录、请车间提供存档。
3. `get_permits`：只能按单日取（`date`，默认今天），返回的是这一天有效的票，不是一段检查期的作业票台账。检查期不含今天时，当天的作业清单不是检查期的作业票，**不要放进目录**；作业票检查项按未找到对应材料处理，请车间提供检查期的作业票台账。
4. 给了 `--date-range`（检查期）时，表中带 `start_date`、`end_date` 的工具按检查期起止日期取数；没有检查期时这两个参数不传。
5. MCP 导出的文件名不带日期，给了 `--date-range` 时这些材料会列为「期限未知」，这是预期结果：成稿时说明数据取自业务系统、查询区间为检查期，由设备员核实，不按完整覆盖报送。

检查通知来自平台知识库或用户上传，作 `--notice`（必需）。车间已有资料清单（xlsx）时，也可以直接作 `--materials`，代替上面的 MCP 导出。

## 操作步骤
1. **解析检查项** —— 从检查通知或检查表中提取逐条检查项与对应的资料要求。**检查项表述笼统时（如"设备管理台账"）须按 `references/common-checklists.md` 向用户确认具体指哪些台账，不得自行缩小或扩大范围。**
2. **运行脚本** —— 技能目录以平台实际加载路径为准（Windows 路径加双引号）：
   ```bash
   node "<技能目录绝对路径>/scripts/evidence.js" --notice "<检查通知或检查表路径>" --materials "<台账与记录目录或清单>" --workshop "<车间名>" --date-range "<YYYY-MM-DD~YYYY-MM-DD>" --out "<工作目录>/迎检资料"
   ```
   可选：`--inspection "<检查名称>"`、`--spec "<厂内归档规范>"`、`--last "<上次资料包目录>"`、`--scope "<检查范围>"`。`--date-range` 不提供则完全不做时间覆盖判定。建议始终传 `--out`，否则写到系统临时目录。
   读取末行 JSON 摘要（同时写入 `<out>/summary.json`）：`ok` 必须为 `true`，`ok:false` 时把 `error` 告知用户并终止；`warnings` 非空时逐条告知用户（检查项无法解析/资料命名无法匹配/只填一端日期按文件名推断/时间范围不覆盖等）。脚本用法详见 `scripts/README.md`。
   - 检查项找不到对应资料：列入 `missing` 并明确标注"未找到对应材料"，**绝不用相近材料充数，也不得标注为"可用 XX 替代"**。
   - 资料存在但时间范围不覆盖检查期：列入 `partialCoverage` 并说明覆盖区间，**不得按完整覆盖处理**。
   - 资料存在但全都没有日期（清单未填起止日期、文件名推不出，如 MCP 导出文件）：列入 `unknownPeriod`「期限未知」单列，**不算齐全也不算覆盖不全**，提示车间核实起止日期。
   - 目录里的 csv / xlsx 只有表头、没有数据行（如系统按检查期查不到记录的空导出，含「标题行 + 表头」的导出）：不作证据，warning 逐个列出，`counts.emptyFiles` 计数，对应检查项按未找到对应材料处理。任何类型的 0 字节文件（含 pdf、docx）同样不作证据，warning 单独写「空文件（0 字节）」，`materials[].zeroByte` 标记，也计入 `counts.emptyFiles`。
   - 读不了的 xlsx（损坏或不是有效 xlsx）：单独 warning「无法读取」，不作证据，`counts.unreadableFiles` 计数，提醒用户重新导出。
3. **读取 evidence.json** —— 从 `<输出目录>/evidence.json` 获取：`items`（逐检查项：要求内容、对应材料、文件位置、时间覆盖、状态）、`ready`、`missing`、`partialCoverage`、`unknownPeriod`（期限未知）、`unmatched`（有材料但无法对应检查项）、`materials`（含 `periodBasis` 时间来源、`empty` 空表标记、`unreadable` 读不了标记）、`counts`（含 `emptyFiles`、`unreadableFiles`）。
4. **生成资料清单与归集目录** —— 按 `assets/templates/evidence-template.md` 成文，含：检查基本信息、逐检查项资料对照表、资料缺口清单（醒目）、覆盖不全项、期限未知项、未对应材料、归集包目录建议（按检查项编号组织）、准备工作提示。**缺口项必须醒目列出并说明影响，不得淡化处理。**
5. **交付前自检** —— 对照 `references/checklist.md` 逐项检查；通过后交付 `evidence.md`、`evidence.json` 与 `资料清单.xlsx`。**必须保留声明行："本清单基于所提供材料比对生成，资料的真实性、完整性由车间负责；缺失资料应如实说明，不得事后补编记录"，不得删除或改写。**

## 预期结果
- `evidence.md`：迎检资料清单，共八节：一、检查基本信息；二、逐检查项资料对照；三、资料缺口清单；四、覆盖不全项；五、期限未知项；六、未对应材料；七、归集包目录建议；八、准备工作提示。有缺口或期限未知项时第一节之前带「【注意】」醒目提示；末尾固定声明行；无 emoji。
- `资料清单.xlsx`（资料对照 / 缺口清单 / 期限未知 / 未对应材料 / 声明 五个工作表）与 `evidence.json`；`summary.json`：脚本末行摘要。
- 交付时向用户说明：检查项总数、资料齐全项数、缺口项数、覆盖不全项数、期限未知项数、未对应材料数、脚本 warnings（如有）。

## 不适用范围
- 不编制、补录、代写任何检查资料与记录。
- 不判定检查项是否达标合规。
- 不建议用其他材料替代缺失资料，不建议事后补做记录。
- 不替代车间对资料真实性的责任。

## 参考资料（按需读取，路径相对技能根目录）
| 文件 | 内容 | 何时读取 |
|---|---|---|
| `references/input-spec.md` | 检查表解析规则、PDF 前置步骤、材料清单字段定义、文件名与单端日期推断规则 | 检查输入 / 用户询问格式时 |
| `references/evidence-rules.md` | 26 类资料词表与匹配口径、覆盖判定规则、缺口表述规范与禁止替代原则、与 regulation-compliance-check 词表的差异 | 成文前 |
| `references/common-checklists.md` | 常见检查类型的典型检查项与对应资料参考（含中石化设备管理专项检查项） | 检查项笼统需细化时 |
| `references/checklist.md` | 交付自检清单（含声明行核对） | 交付前 |
| `scripts/README.md` | 脚本参数与产出说明 | 运行脚本前 |
| `scripts/selftest.js` | 自测：覆盖无法解析、时间不覆盖、单端日期推断、材料无法匹配、新增类别等边界用例（仅开发包含有，发布包不含） | 修改脚本后（开发包）；文件不存在则跳过 |
| `assets/templates/evidence-template.md` | 资料清单模板（{{占位符}}） | 成文时 |
| `references/sample-output.md` | 风格示范产出（内容均为虚构） | 拿不准清单风格时 |
| `examples/`（仅开发包；仓库内在 `演示case/06-报表与沟通/inspection-evidence-package/`） | 回归测试数据，发布包不含 | 目录不存在则跳过 |
