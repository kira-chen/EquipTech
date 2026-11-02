---
name: overhaul-process-check-bridge
description: 车间侧检修方案安全措施核查入口（中石化炼化厂车间设备员口径，对接已有 overhaul-safety-check 技能）。当车间设备员提到"方案安全措施够不够""方案里安全措施有没有漏的""大检修方案安全措施核查""日常维修方案安全措施自查"并提供检修方案（Word 或 PDF 转出的 txt/docx）时使用；本技能只做车间侧前置信息补全与结果转达，实际规则判定调用 overhaul-safety-check（通用必备措施 + 用火作业、受限空间、高处、吊装、临时用电、盲板抽堵等专项措施对照）。只核安全措施章节，不审方案技术内容与检修工艺；方案编制与技术审查初稿用 repair-plan-assistant，作业票预检用 permit-precheck-bridge，完工验收用 completion-acceptance。不重复实现规则引擎、不替代技术负责人审核与安全部门审批。
allowed-tools: Read,Write,Bash
agent_created: true
metadata:
  version: 0.2.0
  author: calvin
  tags: [refinery, equipment, safety, overhaul, bridge, sinopec]
---

# 检修方案安全措施核查入口（overhaul-process-check-bridge）

面向中石化体系炼化厂**车间（运行部）设备员**，在检修方案（装置大检修 / 日常维修 / 抢修 / 专项）上报审批前，调用已有的 `overhaul-safety-check` 技能核查方案中的**安全措施章节**是否齐全，并把结果按车间自查口径转达。**本技能是入口与衔接层，不重复实现规则引擎；所有核查判定以 overhaul-safety-check 的 `result.json` 为准，本技能的 `merge-report.js` 只做逐条转达，不改写任何判定。**

## 适用条件
- 车间设备员说"方案安全措施够不够 / 安全措施有没有漏项 / 大检修方案安全措施核查一下 / 方案安全措施自查"，并提供检修方案文件。
- 检修分级按中石化口径：**装置大检修（停工检修）/ 日常维修 / 抢修 / 专项（技改技措）**；旧称大修 / 中修 / 小修可用，脚本自动映射并提示。分级只写入报告抬头，不影响核查规则。
- 适用于车间侧自查：方案上报前的预核查、被退回后的整改复核、检修前的措施落实确认。
- 车间设备员可做的部分：补全设备交出、同期交叉作业、承包商资质、备件与工机具等车间侧信息；运行源技能并转达结果；把"方案里怎么补"转给方案编制人。
- 由其他岗位归口的部分（技能只提示，不代做）：方案批准由技术负责人与安全部门按程序审批；方案技术内容（检修工艺、材料选型、工期）由技术人员审查；各专项措施最终以开工时逐票办理的作业票为准。
- 不适用：作业票预检（用 permit-precheck-bridge）；方案编制或技术内容审查（用 repair-plan-assistant）；正式审批；非危化企业施工组织设计。

## 前提条件
- **依赖技能**：`overhaul-safety-check` 必须已安装并可调用。先运行 `node "<技能目录>/scripts/check-dependency.js"`，`available:false` 时明确告知用户"需先安装检修方案安全措施核查技能"并终止，**不得用本技能自行判定方案安全措施是否齐全**。技能目录由平台决定（WorkBuddy / Claude Code / 豆包），任一平台都可用环境变量 `SKILL_PACK_ROOT` 或 `--skill-root` 指定依赖技能位置。
- 输入：检修方案文件。**PDF 先用平台 pdf 技能转为 txt/docx 再传入，脚本不读 PDF；扫描件需 OCR**。docx 由源技能的 `docx2text.js` 读取；文字描述按源技能抽取手册映射。可选：设备交出单、作业票、风险分析（JSA）记录、承包商资质材料。
- 必填信息：检修项目名称、设备位号、检修内容、涉及的作业类型（用火、受限空间、高处、吊装、临时用电、盲板抽堵等；源技能标签写"动火"，转达时照搬并加注八大类名称）、检修分级。
- 环境：可执行 Node.js ≥ 18，脚本仅用内置模块。**若环境无法执行 node（无 Bash 工具或 `node --version` 失败），明确告知用户并终止，不得凭记忆给方案安全措施结论。**

## 操作步骤
1. **检查依赖** —— 运行：
   ```bash
   node "<技能目录绝对路径>/scripts/check-dependency.js" [--skill-root "<overhaul-safety-check 根目录>"] --out "<工作目录>/方案核查"
   ```
   读取末行 JSON：`available` 为 `true` 才能继续；`root`/`script`/`docx2text` 给出依赖技能路径。`available:false` → 告知用户并终止。
2. **补全车间侧前置信息** —— 按 `references/intake-questions.md` 核对方案之外的车间信息：设备交出条件是否具备（可接 `equipment-handover-check`）、同期是否有交叉作业（可接 `cross-operation-conflict`）、承包商资质（可接 `contractor-qualification-check`）、备件与工机具是否到位（车间自查）。整理成 `notes.json`（格式见 `references/input-spec.md`），**状态只认 已核实 / 未核实 / 不适用，不得替用户推测**。**这些信息不进入规则判定。**
3. **调用 overhaul-safety-check** —— 按其 SKILL.md 的操作步骤执行：docx → `docx2text.js` 转文本 → 抽取 `plan.json` 并向用户复述确认（作业项与类型标签、工期、承修单位、哪些措施为 null）→ `check.js` 生成 `result.json`。**不得改写 result.json 中任何规则命中项、缺失项或结论。**
4. **合并转达** —— 运行：
   ```bash
   node "<技能目录绝对路径>/scripts/merge-report.js" --result "<源技能输出目录>/result.json" --notes "<notes.json>" --object "<方案名称>" --repair-type <大检修|日常维修|抢修|专项> --out "<工作目录>/方案核查"
   ```
   读取末行 JSON 摘要（同时写入 `<out>/summary.json`）：`ok` 必须为 `true`；`warnings` 非空时逐条告知用户（源 summary 与 findings 计数不一致 / 未知级别 / 车间侧状态不合法 / 旧检修分级映射等）。脚本把 findings（含 `name`、`advice`"方案里怎么补"、`jobs` 触发作业）逐条深拷贝转达，重新计数但不改源数据；车间侧提示单独成节"车间侧补充提示（非规则判定）"。
5. **撰写车间侧说明并交付** —— 读取 `overhaul-check-bridge.md`，只在 `<!-- ANALYSIS_START -->` / `<!-- ANALYSIS_END -->` 之间补充：调用了哪个技能、缺失与未判定项数量、车间提示项、下一步整改重点；**不得复述或改写判定结论，不得审查方案技术内容**。对照 `references/checklist.md` 自检后交付合并报告与源技能原始 `result.json`。**必须保留源技能的全部声明行，并保留本技能声明："核查为辅助自查，不替代技术负责人审核与安全部门审批；方案是否批准以审批人意见为准。"**

## 预期结果
- `overhaul-check-bridge.md`：合并报告，六节 + 附：一、核查结论（引自 overhaul-safety-check，含源技能字段表与作业类型标签加注）；二、措施缺失项（缺失 / 建议完善，逐条原文含"方案里怎么补"）；三、未判定项；四、已有措施；五、车间侧补充提示（非规则判定）；六、整改建议（末尾提示各专项措施以作业票为准）；附：源技能抽取说明、数据提示（有时）。末尾依次为源技能声明行与本技能声明行，再接分析段占位。
- `bridge.json`：`meta`（源技能、对象、检修分级、声明行）、`sourceSummary`、`sourceMeta`（方案编号 / 装置 / 项目 / 承修单位 / 工期 / 作业项数 / 作业类型标签）、`counts`（按 findings 重新计数）、`findings`（逐条深拷贝）、`workshopNotes`、`skipped`、`extractionNotes`、`warnings`；`summary.json`：脚本末行摘要；`dependency.json`：依赖检查结果。
- 源技能产出的原始 `result.json` 一并交付，供复核。
- 交付时向用户说明：调用了哪个技能、缺失 / 建议完善 / 未判定数量、车间侧提示项状态、下一步整改重点。

## 不适用范围
- 不自行判定方案安全措施是否齐全，不重复实现或修改规则引擎。
- 不审查方案技术内容的正确性（检修工艺、材料、工期由技术人员审查；方案编制用 repair-plan-assistant）。
- 不替代技术负责人审核与安全部门审批，不替代开工时逐票办理的作业票。
- 源技能不可用时不降级为人工判断，须终止并告知用户。

## 参考资料（按需读取，路径相对技能根目录）
| 文件 | 内容 | 何时读取 |
|---|---|---|
| `references/intake-questions.md` | 车间侧前置信息清单与追问话术 | 信息不全时 |
| `references/input-spec.md` | 源技能 `result.json` 字段、车间侧 `notes.json` 格式、检修分级映射 | 准备 notes.json / 核对输入时 |
| `references/bridge-rules.md` | 与 overhaul-safety-check 的衔接口径、检修分级与大检修节点术语、结果转达规范、禁止改写清单 | 合并结果前 |
| `references/checklist.md` | 交付自检清单（含双重声明行核对） | 交付前 |
| `scripts/README.md` | 两个脚本的参数与产出说明 | 运行脚本前 |
| `scripts/selftest.js` | 自测：依赖探测、源 JSON 逐条转达不改写、检修分级映射、车间侧状态校验等（仅开发包含有，发布包不含） | 修改脚本后（开发包）；文件不存在则跳过 |
| `assets/templates/bridge-template.md` | 合并报告模板（与 merge-report.js 产出结构一致） | 用户要求调整版式时 |
| `references/sample-output.md` | 风格示范产出（内容均为虚构） | 拿不准报告风格时 |
| `examples/` | 回归测试数据（虚构的源技能 result.json 与车间侧 notes.json；仅开发包含有，发布包不含） | 目录不存在则跳过 |
