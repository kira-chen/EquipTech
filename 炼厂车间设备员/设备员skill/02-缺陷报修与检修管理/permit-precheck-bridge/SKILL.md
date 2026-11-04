---
name: permit-precheck-bridge
description: 车间侧作业票预检入口（中石化炼化厂车间设备员口径，对接已有 work-permit-precheck 技能）。当车间设备员提到"这张作业票帮我看一下""票填得对不对""用火票预检""受限空间票能不能过""作业许可票自查"并提供作业票（Word 或 PDF 转出的 txt/docx、图片）时使用；本技能只做车间侧前置信息补全与结果转达，实际规则判定调用 work-permit-precheck（按《中国石化作业许可管理规定》八大类：用火、受限空间、高处、吊装、临时用电、动土、断路、盲板抽堵）。不重复实现规则引擎、不替代作业票审批签发；检修方案安全措施核查用 overhaul-process-check-bridge，设备交出条件用 equipment-handover-check，交叉作业冲突用 cross-operation-conflict。
allowed-tools: Read,Write,Bash
agent_created: true
metadata:
  version: 0.2.0
  author: calvin
  tags: [refinery, equipment, safety, permit, bridge, sinopec]
---

# 作业票预检入口（permit-precheck-bridge）

面向中石化体系炼化厂**车间（运行部）设备员**，在票据提交审批前调用已有的 `work-permit-precheck` 技能完成作业票预检，并把结果按车间自查口径转达。**本技能是入口与衔接层，不重复实现规则引擎；所有合规判定以 work-permit-precheck 的 `result.json` 为准，本技能的 `merge-report.js` 只做逐条转达，不改写任何判定。**

## 适用条件
- 车间设备员说"帮我看看这张票 / 票填得对不对 / 用火票预检 / 受限空间票查一下 / 作业许可票自查"，并提供作业票文件。
- 作业类型属于作业许可八大类：**用火作业**（票面常写"动火"，源技能按"动火"识别，转达时照搬票面原词）、受限空间作业、高处作业、吊装作业、临时用电作业、动土作业、断路作业、盲板抽堵作业。
- 适用于车间侧自查场景：票据提交审批前的预检、退票后的整改复核、属地监护前的票面核对。
- 车间设备员可做的部分：补全设备交出、交叉作业、承包商资质等车间侧信息；运行源技能并转达结果；把整改重点告知作业负责人。
- 由其他岗位归口的部分（技能只提示，不代做）：作业票审批签发由作业许可系统与各级审批人负责；气体分析由分析人员出结论；作业级别以票面与审批人判定为准，技能不自判。
- 不适用：检修方案安全措施核查（用 overhaul-process-check-bridge）；安全部门的正式审批；无票据文件仅口头描述；非特殊作业的一般维修工单。

## 前提条件
- **依赖技能**：`work-permit-precheck` 必须已安装并可调用。先运行 `node "<技能目录>/scripts/check-dependency.js"`，`available:false` 时明确告知用户"需先安装特殊作业票预检技能"并终止，**不得用本技能自行判定票据合规性**。技能目录由平台决定（WorkBuddy / Claude Code / 豆包），两个技能并排装在同一个技能目录下时脚本会自动找到；装在别处时，任一平台都可用环境变量 `SKILL_PACK_ROOT` 或 `--skill-root` 指定依赖技能位置。
- 输入：作业票文件。**PDF 先用平台 pdf 技能转为 txt/docx 再传入，脚本不读 PDF；扫描件需 OCR**。docx 由源技能的 `docx2text.js` 读取；图片由模型读图抽取并在源技能 `extraction_notes` 中声明。可选：对应的检修方案、设备交出单、作业人员资质材料。
- 必填信息：作业类型（八大类之一）、作业设备位号、作业时间。作业许可系统导出的票面字段常见列名：许可证编号、作业类别、作业级别、作业地点、属地监护人、作业单位监护人、作业负责人、作业单位。
- 环境：可执行 Node.js ≥ 18，脚本仅用内置模块。**若环境无法执行 node（无 Bash 工具或 `node --version` 失败），明确告知用户并终止，不得凭记忆给票据合规结论。**

## 数据获取（MCP）

平台接入作业票系统 MCP 时，作业票 Word 原件直接从工具取，不再请用户上传。工具只读，不审批、不签发作业票。

| 服务 | 工具 | 参数 | 用途 |
|---|---|---|---|
| 作业票系统 | `get_permits` | `workshop`：车间；`date`：作业日期，默认今天 | 找到要预检的许可证编号 |
| 作业票系统 | `get_permit_document` | `permit_no`：许可证编号 | 取作业票 Word 原件 |

取数后：

1. `get_permit_document` 返回「<许可证编号>.docx」和「<许可证编号>.permit.json」两个下载链接（60 分钟内有效），按原文件名下载到同一个新建目录。
2. docx 按操作步骤交外部技能 work-permit-precheck 的 docx2text.js 抽文本，再按其抽取规则生成 permit.json 后预检。工具附带的 permit.json 是演示数据的票面真值，只用于核对抽取结果，不能代替抽取。
3. 只有用火、受限空间、高处、吊装、盲板抽堵五类作业票有 Word 原件；临时用电、动土、断路作业暂无，需请用户上传。

## 操作步骤
1. **检查依赖** —— 运行：
   ```bash
   node "<技能目录绝对路径>/scripts/check-dependency.js" [--skill-root "<work-permit-precheck 根目录>"] --out "<工作目录>/作业票预检"
   ```
   读取末行 JSON：`available` 为 `true` 才能继续；`root`/`script`/`docx2text` 给出依赖技能路径。`available:false` → 告知用户并终止。
2. **补全车间侧前置信息** —— 按 `references/intake-questions.md` 核对票据之外的车间信息：设备是否已交出（可接 `equipment-handover-check`）、同区域是否有交叉作业（可接 `cross-operation-conflict`）、承包商资质是否已核验（可接 `contractor-qualification-check`）。把核实情况整理成 `notes.json`（格式见 `references/input-spec.md`），**状态只认 已核实 / 未核实 / 不适用，不得替用户推测**。**这些信息不进入规则判定。**
3. **调用 work-permit-precheck** —— 按其 SKILL.md 的操作步骤执行：docx → `docx2text.js` 转文本 → 抽取 `permit.json` 并向用户复述确认 → `precheck.js` 生成 `result.json`。**不得改写 result.json 中任何判定项、等级或结论。**
4. **合并转达** —— 运行：
   ```bash
   node "<技能目录绝对路径>/scripts/merge-report.js" --result "<源技能输出目录>/result.json" --notes "<notes.json>" --object "<作业票名称或票号>" --out "<工作目录>/作业票预检"
   ```
   读取末行 JSON 摘要（同时写入 `<out>/summary.json`）：`ok` 必须为 `true`；`warnings` 非空时逐条告知用户（源 summary 与 findings 计数不一致 / 未知级别 / 车间侧状态不合法等）。脚本把 findings 逐条深拷贝转达，重新计数但不改源数据；车间侧提示单独成节"车间侧补充提示（非规则判定）"。
5. **撰写车间侧说明并交付** —— 读取 `permit-precheck-bridge.md`，只在 `<!-- ANALYSIS_START -->` / `<!-- ANALYSIS_END -->` 之间补充：调用了哪个技能、必须整改与未判定项数量、车间提示项、下一步整改重点；**不得复述或改写判定结论**。对照 `references/checklist.md` 自检后交付合并报告与源技能原始 `result.json`。**必须保留源技能的全部声明行，并保留本技能声明："预检为辅助自查，不替代安全部门审批；票据是否签发以审批人意见为准。"**

## 预期结果
- `permit-precheck-bridge.md`：合并报告，六节 + 附：一、预检结论（引自 work-permit-precheck，含源技能字段表）；二、不符合项（必须整改 / 建议完善，逐条原文）；三、未判定项；四、通过项；五、车间侧补充提示（非规则判定）；六、整改建议；附：源技能抽取说明、数据提示（有时）。末尾依次为源技能声明行与本技能声明行，再接分析段占位。
- `bridge.json`：`meta`（源技能、对象、声明行）、`sourceSummary`、`sourceMeta`（票号 / 类型 / 级别 / 预检时间）、`counts`（按 findings 重新计数）、`findings`（逐条深拷贝）、`workshopNotes`、`skipped`、`extractionNotes`、`warnings`；`summary.json`：脚本末行摘要；`dependency.json`：依赖检查结果。
- 源技能产出的原始 `result.json` 一并交付，供复核。
- 交付时向用户说明：调用了哪个技能、必须整改 / 建议完善 / 未判定数量、车间侧提示项状态、下一步整改重点。

## 不适用范围
- 不自行判定作业票合规性，不重复实现或修改规则引擎，不判定用火 / 高处 / 吊装级别。
- 不替代安全部门审批与作业许可签发，不替代属地监护人、作业单位监护人的现场职责。
- 不做检修方案的安全措施核查，不做设备交出条件核对（分别用对应技能）。
- 源技能不可用时不降级为人工判断，须终止并告知用户。

## 参考资料（按需读取，路径相对技能根目录）
| 文件 | 内容 | 何时读取 |
|---|---|---|
| `references/intake-questions.md` | 车间侧前置信息清单与追问话术 | 信息不全时 |
| `references/input-spec.md` | 源技能 `result.json` 字段、车间侧 `notes.json` 格式、作业许可系统列名对照 | 准备 notes.json / 核对输入时 |
| `references/bridge-rules.md` | 与 work-permit-precheck 的衔接口径、八大类术语、结果转达规范、禁止改写清单 | 合并结果前 |
| `references/checklist.md` | 交付自检清单（含双重声明行核对） | 交付前 |
| `scripts/README.md` | 两个脚本的参数与产出说明 | 运行脚本前 |
| `scripts/selftest.js` | 自测：依赖探测、源 JSON 逐条转达不改写、车间侧状态校验等（仅开发包含有，发布包不含） | 修改脚本后（开发包）；文件不存在则跳过 |
| `assets/templates/bridge-template.md` | 合并报告模板（与 merge-report.js 产出结构一致） | 用户要求调整版式时 |
| `references/sample-output.md` | 风格示范产出（内容均为虚构） | 拿不准报告风格时 |
| `examples/` | 回归测试数据（虚构的源技能 result.json 与车间侧 notes.json；仅开发包含有，发布包不含） | 目录不存在则跳过 |
