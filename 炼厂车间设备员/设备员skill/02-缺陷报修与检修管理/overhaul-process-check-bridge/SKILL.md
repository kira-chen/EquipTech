---
name: overhaul-process-check-bridge
description: 车间检修方案安全措施核查（中石化炼化厂车间设备员口径）。当车间设备员提到"方案安全措施够不够""方案里安全措施有没有漏的""方案里还缺哪些安全措施""帮我核查这份检修方案的安全措施""检修方案安全措施审查""大检修方案安全措施齐不齐 / 核查一下""日常维修方案安全措施自查"，并提供检修方案（Word 或 PDF 转出的 txt/docx、图片）或口述方案要点时使用；本技能自己读取方案、抽取 plan.json 并向用户复述确认，再用内置规则引擎（70 条：通用必备措施 + 用火作业、受限空间、高处、吊装、临时用电、盲板抽堵、动土、带压堵漏、射线探伤、化学清洗等专项措施 + 组合规则）逐项判定"已有 / 缺失 / 建议完善 / 未判定"，可选补充车间侧信息后合并成车间自查报告。只核安全措施章节，不审方案技术内容与检修工艺；方案编制与技术审查初稿用 repair-plan-assistant，作业票预检用 permit-precheck-bridge，完工验收用 completion-acceptance。不替代技术负责人审核与安全部门审批。
allowed-tools: Read,Write,Bash
agent_created: true
metadata:
  version: 0.3.0
  author: calvin
  tags: [refinery, equipment, safety, overhaul, bridge, gb30871, sinopec]
---

# 车间检修方案安全措施核查（overhaul-process-check-bridge）

面向中石化体系炼化厂**车间（运行部）设备员**，在检修方案（装置大检修 / 日常维修 / 抢修 / 专项）上报审批前，核查方案**安全措施章节**是否齐全，并按车间自查口径出报告。流程分两段，各由一个脚本负责：**规则引擎 `check.js` 只判定**（按 `references/checklist.json` 逐条对照，结果写 `result.json`）；**`merge-report.js` 只转达**，逐条照搬 `result.json`，不改写任何判定，车间侧信息单独成节。

## 适用条件
- 车间设备员说"方案安全措施够不够 / 安全措施有没有漏项 / 大检修方案安全措施核查一下 / 方案安全措施自查"，并提供检修方案文件或方案要点。
- 检修分级按中石化口径：**装置大检修（停工检修）/ 日常维修 / 抢修 / 专项（技改技措）**；旧称大修 / 中修 / 小修可用，脚本自动映射并提示（大修→大检修，中修/小修→日常维修）。分级只写入报告抬头，不影响核查规则。
- 适用于车间侧自查：方案上报前的预核查、被退回后的整改复核、检修前的措施落实确认。
- 车间设备员可做的部分：读方案并核查安全措施；补全设备交出、同期交叉作业、承包商资质、备件与工机具等车间侧信息；把"方案里怎么补"转给方案编制人。
- 由其他岗位归口的部分（技能只提示，不代做）：方案批准由技术负责人与安全部门按程序审批；方案技术内容（检修工艺、材料选型、工期）由技术人员审查；各专项措施最终以开工时逐票办理的作业票为准。
- 不适用：作业票预检（用 permit-precheck-bridge）；方案编制或技术内容审查（用 repair-plan-assistant）；进度、费用审查；正式审批；非危化企业施工组织设计。

## 前提条件
- 输入：检修方案文件。**PDF 先用平台 pdf 技能转为 txt/docx 再传入，脚本不读 PDF；扫描件需 OCR**。docx 用本技能的 `scripts/docx2text.js` 读取；图片直接读图；口述要点按抽取手册直接映射。可选：设备交出单、作业票、风险分析（JSA）记录、承包商资质材料。
- 必填信息：检修项目名称、设备位号、检修内容、涉及的作业类型（用火、受限空间、高处、吊装、临时用电、盲板抽堵等）、检修分级。
- 作业类型标签：`plan.json` 的 `job_types` 与规则库沿用 GB 30871 的写法，用火作业的标签值是"动火"（即中石化的"用火作业"），抽取时照填"动火"，不要改成"用火"，否则规则不触发。
- 环境：可执行 Node.js ≥ 18，脚本仅用内置模块。**若环境无法执行 node（无 Bash 工具或 `node --version` 失败），明确告知用户并终止，不得凭记忆给方案安全措施结论。**

## 数据获取（MCP）

本技能不调用业务系统 MCP。检修方案 Word 原件由用户上传或来自平台知识库，docx 交本技能的 `scripts/docx2text.js` 转文本后抽取 `plan.json`；车间侧补充提示由设备员提供。合并报告时用 `--plan` 传入同一份 plan.json，方案编号和作业类型从这里读取。

## 操作步骤
1. **读取方案** —— 用户给 `.docx` 时先转成文本：
   ```bash
   node "<技能目录绝对路径>/scripts/docx2text.js" --input "<检修方案.docx>" --out "<工作目录>/方案核查/plan.txt"
   ```
   表格行以 `|` 分隔，`[x]`/`[ ]` 为勾选状态，`‹›` 为横向合并占位（不是留白），`〃` 为纵向合并续行；末行 JSON 摘要（段落数、表格数）用于核对是否读全，出错时末行为 `{"ok":false,...}`。图片或扫描件直接读图；口述要点直接进入下一步。
2. **抽取 plan.json 并向用户复述确认** —— 复制 `assets/templates/plan.json`，按 `references/extraction-guide.md` 抽取：基本信息（装置、检修项目、工期、承修单位、方案编号）、`jobs[]`（每项作业的名称、作业类型标签、介质、位置，类型识别关键词见抽取手册）、`measures{}`（方案中**已写明**的措施，摘录原文要点）、`org{}`、`attachments{}`。键名对照 `references/plan-schema.md`。**方案没写的一律填 `null`，不得按"常规肯定会做"猜测**；作业类型栏写"无特殊作业"填 `[]`，看不出类型填 `null`；每处 null / 推断都记入 `extraction_notes[]`。保存为 `<工作目录>/方案核查/plan.json`。抽取后按手册第五节 10 项自检，然后**向用户复述关键信息并请其确认**：作业项数与各自类型标签、工期、承修单位、哪些措施抽取为 null、备注条数。用户确认（或更正）后再进入第 3 步；用户明确要求直接出结果或平台无法二次交互时可继续，但交付说明与报告抽取说明中须注明「抽取结果未经用户确认」。
3. **规则引擎判定** —— 运行：
   ```bash
   node "<技能目录绝对路径>/scripts/check.js" --input "<工作目录>/方案核查/plan.json" --out "<工作目录>/方案核查/check"
   ```
   脚本按 `references/checklist.json`（70 条：通用必备 + 按作业类型触发的专项 + 组合规则）生成 `result.json`、`report.md`、`summary.json`，末行输出 `{"must_fix":N,"should_improve":N,"undetermined":N,"pass":N}`；输入不合法时末行为 `{"ok":false,"error":"…"}` 并退出码 1。`undetermined`（未判定）表示判定依赖的方案信息为空（如工期未填、作业未标注类型），作业未标注类型导致的未判定按作业类型聚合为一条。组合规则：同一作业含"受限空间+用火"→ 提示双票联办；含"用火+高处"→ 查火花防溅落；工期 >30 天 → 查阶段性安全检查安排。**判定一律以 result.json 为准，不得改写任何规则命中项、缺失项或结论。**
4. **补全车间侧信息（可选）** —— 按 `references/intake-questions.md` 核对方案之外的车间信息：设备交出条件（可接 `equipment-handover-check`）、同期交叉作业（可接 `cross-operation-conflict`）、承包商资质（可接 `contractor-qualification-check`）、备件与工机具（车间自查）。整理成 `notes.json`（格式见 `references/input-spec.md`），**状态只认 已核实 / 未核实 / 不适用，不得替用户推测**。这些信息不进入规则判定。用户只要纯核查、没有车间侧信息时跳过本步，第 5 步不传 `--notes`，报告第五节四项全部写「未核实」。
5. **合并成车间自查报告** —— 运行：
   ```bash
   node "<技能目录绝对路径>/scripts/merge-report.js" --result "<工作目录>/方案核查/check/result.json" --plan "<工作目录>/方案核查/plan.json" [--notes "<notes.json>"] --object "<方案名称>" --repair-type <大检修|日常维修|抢修|专项> --out "<工作目录>/方案核查"
   ```
   读取末行 JSON 摘要（同时写入 `<out>/summary.json`）：`ok` 必须为 `true`；`warnings` 非空时逐条告知用户（summary 与 findings 计数不一致 / 未知级别 / 车间侧状态不合法 / 旧检修分级映射等）。脚本把 findings（含 `name`、`advice`"方案里怎么补"、`jobs` 触发作业）逐条深拷贝转达，重新计数但不改原数据；车间侧提示单独成节"车间侧补充提示（非规则判定）"。方案编号（`plan_no`）与作业类型标签从 `--plan` 读取，只进抬头字段表，不进入判定；不传 `--plan` 时这两项留空并 warning。findings 的措施名称、问题、建议、依据原文来自规则库，其中"动火""大修/中修"等写法保持原样照搬，合并时不替换（全项目统一改为"用火"另行处理）。
6. **撰写说明并交付** —— 读取 `overhaul-check-bridge.md`，只在 `<!-- ANALYSIS_START -->` / `<!-- ANALYSIS_END -->` 之间补充：缺失 / 建议完善 / 未判定项数量、最紧急的缺失项及"方案里怎么补"（可把 `advice` 展开成能直接粘进方案的措辞）、未判定项缺哪些信息、车间提示项、下一步整改重点；对因抽取为 null 而触发的问题注明"方案未写明 / 未识别，请核对原件"。**不得复述或改写判定结论，不得审查方案技术内容。** 对照 `references/checklist.md` 自检后交付合并报告、`result.json` 与 `bridge.json`。
   - **必须保留规则引擎的声明行**："本结果为辅助核查，不替代检修方案审批；依据条款按记忆整理，以 GB 30871-2022 正式文本与企业制度为准。"（脚本从 result.json 的 `disclaimer` 读入，置于报告末尾）
   - **必须保留本技能声明行**："核查为辅助自查，不替代技术负责人审核与安全部门审批；方案是否批准以审批人意见为准。"
   - **人工提醒（不可机检，交付时逐条列出）**：报告中标注"待核实 / 通行做法"的依据请对照企业制度核对（清单见 `references/checklist-ref.md` 第 5 节）；方案中"另行编制 / 见专项方案"的文件应在审批前收齐；各专项措施最终仍以开工时逐票办理的作业票为准；以下事项规则库不覆盖，请审批人按方案实际情况人工核对——夜间施工安排、雨季 / 高温季节施工防护、消防道路占用的审批与恢复、临时设施（办公 / 休息 / 危化品暂存）布置合规性。

## 预期结果
- `overhaul-check-bridge.md`：合并报告，六节 + 附：一、核查结论（引自规则引擎 check.js，含 result.json 字段表与作业类型标签加注）；二、措施缺失项（缺失 / 建议完善，逐条原文含"方案里怎么补"）；三、未判定项；四、已有措施；五、车间侧补充提示（非规则判定）；六、整改建议（末尾提示各专项措施以作业票为准）；附：抽取说明、数据提示（有时）。末尾依次为规则引擎声明行与本技能声明行，再接分析段占位。
- `check/result.json`：规则引擎的原始结果（结构化 findings，可回填审批系统），一并交付供复核；同目录 `report.md` 为引擎按 `assets/templates/report-template.md` 出的对照表报告，`summary.json` 为四项计数。
- `bridge.json`：`meta`（source 为 `check.js`、对象、检修分级、声明行）、`sourceSummary`、`sourceMeta`（方案编号与作业类型标签取自 plan.json；装置 / 项目 / 承修单位 / 工期 / 作业项数取自 result.json）、`counts`（按 findings 重新计数）、`findings`（逐条深拷贝）、`workshopNotes`、`skipped`、`extractionNotes`、`warnings`；`summary.json`：脚本末行摘要。
- 中间产物：`plan.txt`（docx 转文本）、`plan.json`（抽取结果，已经用户确认）。
- 交付时向用户说明：缺失 / 建议完善 / 未判定数量、最紧急的缺失项、未判定项缺哪些信息、车间侧提示项状态、下一步整改重点、人工提醒清单。

## 不适用范围
- 不审查方案技术内容的正确性（检修工艺、材料、工期由技术人员审查；方案编制用 repair-plan-assistant）。
- 不改写规则引擎的判定，不在规则库之外凭经验增减措施项。
- 不替代技术负责人审核与安全部门审批，不替代开工时逐票办理的作业票。
- node 不可用时不降级为人工判断，须终止并告知用户。

## 参考资料（按需读取，路径相对技能根目录）
| 文件 | 内容 | 何时读取 |
|---|---|---|
| `references/extraction-guide.md` | 抽取手册：三步流程、字段对照表、作业类型识别关键词表（含"用火作业"写法映射）、措施抽取规则、10 项自检 | 第 2 步抽取前 |
| `references/plan-schema.md` | plan.json 字段定义与 measures 键名 | 第 2 步抽取时 |
| `references/checklist-ref.md` | 核查清单人读版（通用 / 专项 / 组合规则表、待核实依据汇总） | 第 6 步解释问题、列人工提醒时 |
| `references/checklist.json` | 规则库机器版（70 条），check.js 自动读取 | 需要增删规则时 |
| `references/intake-questions.md` | 车间侧前置信息清单与追问话术 | 信息不全时 |
| `references/input-spec.md` | 方案文件、`plan.json`、`result.json`、车间侧 `notes.json` 格式、检修分级映射 | 准备输入 / 核对输入时 |
| `references/bridge-rules.md` | 判定与转达的分工、检修分级与大检修节点术语、结果转达规范、禁止改写清单 | 合并结果前 |
| `references/checklist.md` | 交付自检清单（含双重声明行核对） | 交付前 |
| `references/sample-output.md` | 风格示范产出（内容均为虚构） | 拿不准报告风格时 |
| `assets/templates/plan.json` | plan.json 空模板 | 第 2 步 |
| `assets/templates/report-template.md` | 规则引擎报告模板 | check.js 自动使用 |
| `assets/templates/bridge-template.md` | 合并报告模板（与 merge-report.js 产出结构一致） | 用户要求调整版式时 |
| `scripts/README.md` | 全部脚本的参数、产出与退出码 | 运行脚本前 |
| `scripts/selftest.js` | 自测：规则引擎各类规则与边界、docx 读取、端到端回归、逐条转达不改写、检修分级映射、车间侧状态校验等（仅开发包含有，发布包不含） | 修改脚本后（开发包）；文件不存在则跳过 |
| `examples/`（仅开发包；仓库内在 `演示case/02-缺陷报修与检修管理/overhaul-process-check-bridge/`） | 回归测试数据（虚构的检修方案 docx 与 plan.json、规则引擎真实 result.json 输出、期望报告、车间侧 notes.json；发布包不含） | 目录不存在则跳过 |
