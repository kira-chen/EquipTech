---
name: meeting-material-builder
description: 设备会议汇报稿与要点提纲生成（中石化体系炼化厂车间设备员口径）。当用户提到"设备会材料""汇报稿""月会要讲的""准备个汇报""会议材料""上会的材料""给分厂/公司领导汇报设备情况""汇报提纲"并提供上游技能 JSON（周报 periodic.json、日报 daily.json、巡检 status.json、工单 orders.json、隐患 hazard.json、缺陷 defects.json）或已有报表时使用；按会议类型、时长与听众层级（车间 / 分厂 / 公司）组织汇报要点，生成汇报稿、要点提纲与可转 pptx 的 slides 提纲。周报月报的指标统计用 equipment-weekly-monthly-report（本技能只把 periodic.json 组织成稿，不重算指标）；事件通报用 equipment-event-notice；不生成 PPT 文件本身。
allowed-tools: Read,Write,Bash
agent_created: true
metadata:
  version: 0.2.0
  author: calvin
  tags: [refinery, equipment, communication]
---

# 会议材料与汇报稿（meeting-material-builder）

面向中石化体系炼化厂车间（运行部）设备员，把上游技能产出的数据与报表组织成适合特定会议的汇报材料。**所有数字必须来自所提供的数据或报表，模型不得新增、修改或美化任何数字。**

## 适用条件
- 用户说"准备设备月会材料 / 写个汇报稿 / 上会要讲什么 / 给分厂或公司领导汇报设备情况"，并提供上游技能 JSON 或已生成的报表。
- 覆盖会议类型：车间设备例会、分厂（作业部）设备月会、公司设备管理部门专题会、检修总结会、问题协调会。
- 听众层级按中石化组织层级三档：`车间` / `分厂` / `公司`；各厂名称不同（作业部、烯烃厂设备科、公司机动部……）用 `--audience-spec` 给出。
- **与 `equipment-weekly-monthly-report` 的边界**：周报月报的指标计算（完好率、泄漏率、计划完成率……）在那个技能里完成并产出 `periodic.json`；本技能只把 `periodic.json` 的指标与重点事项组织成汇报稿，不重算、不补算任何指标，表格文件一律提示先用对应报表技能。
- 不适用：报表数据的统计与计算；事件通报的起草（用 equipment-event-notice）；PPT 文件的生成（本技能输出文字稿、提纲与 `slides` 结构化提纲）。

## 前提条件
- 输入：上游技能 JSON（`periodic.json`、`daily.json`、`status.json`、`orders.json`、`defects.json`、`hazard.json`）或 `.md` 报表；`.xlsx` 表格不做二次统计。
- 必填信息：会议名称与类型、汇报时长、听众层级（车间 / 分厂 / 公司）。可选：厂内层级名称与详略档位（`--audience-spec`）、时间权重（`--weights`）、议题要求、上次会议遗留事项、需协调事项、是否一律去位号（`--hide-tags`）。
- 环境：可执行 Node.js ≥ 18（用于从数据文件提取要点）。**若环境无法执行 node（无 Bash 工具或 `node --version` 失败），明确告知用户并终止，不得基于文字手工拼稿或自行提取数字。**

## 数据获取（MCP）

本技能不直接调用 MCP，读上游技能产出的 JSON。平台接入了业务系统 MCP 服务时，先按各上游技能 SKILL.md「数据获取（MCP）」一节取数并运行，再把产出用逗号拼接后交给本技能 `--input`：

- work-order-tracker 的 orders.json
- hazard-closure-tracker 的 hazard.json
- inspection-data-digest 的 status.json
- defect-intake-grading 的 defects.json
- equipment-daily-report 的 daily.json
- equipment-weekly-monthly-report 的 periodic.json

用户只要其中几项时，只运行对应的上游技能。

上游取数时每个工具都要填 `workshop`（车间名）：业务系统导出表里没有车间列，上游脚本的 `--workshop` 只写标题、不筛选，不填会把别的车间的设备和单据汇进本车间的会议材料。

## 操作步骤
1. **确认会议要素** —— 会议类型、时长、听众层级、议题要求。**听众层级决定详略：车间级可含具体位号与细节，分厂级含关键位号，公司级只讲结论、指标与需决策事项并去位号。不确定时必须确认，不得按最详细处理。**
2. **提取汇报要点** —— 技能目录以平台实际加载路径为准（Windows 路径加双引号）：
   ```bash
   node "<技能目录绝对路径>/scripts/build.js" --input "<数据或报表路径>[,<路径2>...]" --meeting "<会议类型>" --duration <汇报分钟数> --audience <车间|分厂|公司> --out "<工作目录>/会议材料"
   ```
   可选：`--audience-spec "<厂内层级名称>[:high|medium|low]"`、`--weights "开场:0.05,关键指标:0.3,主要工作:0.1,存在问题:0.2,需决策:0.3,下步打算:0.05"`、`--hide-tags`、`--topics "<议题1,议题2>"`、`--pending "<上次遗留事项>"`、`--need-decision "<需决策事项>"`、`--workshop`。建议始终传 `--out`，否则写到系统临时目录。
   读取末行 JSON 摘要（同时写入 `<out>/summary.json`）：`ok` 必须为 `true`，`ok:false` 时把 `error` 告知用户并终止；`warnings` 非空时逐条告知用户（数据文件无法识别/议题无对应数据/时长与内容量不匹配等）。脚本用法详见 `scripts/README.md`。
   - 议题在数据中无对应内容：列入 `noData` 并在稿中写"该议题暂无数据支撑，需补充"，**绝不编造内容填充**。
   - `periodic.json` 中"需按厂内口径复算"的指标会进问题项，汇报时写"未计算"，不得补数。
   - 责任方写单位、不点人名：`periodic.json` 超期工单有工作中心的写工作中心；只有责任人姓名的（旧版 periodic.json、检修计划责任人）脚本已去掉人名并 warning，成稿不得补回姓名。
   - 公司层级（或 `--hide-tags`）时，`--need-decision`、`--pending` 里的位号、工单号同样去掉，成稿保持去位号后的写法。
3. **读取 outline.json** —— 从 `<输出目录>/outline.json` 获取：`keyPoints`（按议题组织的要点及数据来源）、`metrics`（关键指标，带来源）、`issues`、`needDecision`、`pending`、`noData`、`timeAllocation`（含权重与来源）、`slides`（逐页标题与要点，供 pptx 技能/工具转换）。
4. **撰写汇报稿** —— 按 `references/meeting-rules.md` 中对应听众层级的表述口径成文。结构：开场（一句话结论）→ 关键指标 → 主要工作 → 存在问题 → 需协调决策事项 → 下步打算。**每个数字后标注来源报表；存在问题部分只陈述事实与影响，不做责任归因；需决策事项必须写清"请求决策的具体内容与可选方案"。**
5. **交付前自检** —— 对照 `references/checklist.md` 逐项检查；通过后交付 `汇报稿.md` 与 `要点提纲.md`。用户需要 PPT 时：**把 `outline.json` 的 `slides` 交给 pptx 相关技能或工具转换，不得手写 pptx XML。**

## 预期结果
- `汇报稿.md`：六节文字稿（开场 / 关键指标 / 主要工作 / 存在问题 / 需协调决策事项 / 下步打算），按听众层级控制详略，附无数据议题与生成提示；无 emoji。
- `要点提纲.md`：时间分配（权重与来源）+ 要点速览 + 口头汇报提示。
- `outline.json`：结构化要点、指标（带来源）、问题项、时间分配、`slides` 提纲；`summary.json`：脚本末行摘要。
- 交付时向用户说明：数据来源、听众层级与详略、无数据支撑的议题、需决策事项数、建议时间分配、是否已去位号。

## 不适用范围
- 不新增、修改、美化任何数字与结论；不重算周报月报指标。
- 不做责任归因与人员评价。
- 不生成 PPT、Word 等文件格式（输出 Markdown 文字稿与 slides 结构化提纲）。
- 不替代汇报人对内容真实性的责任。

## 参考资料（按需读取，路径相对技能根目录）
| 文件 | 内容 | 何时读取 |
|---|---|---|
| `references/meeting-rules.md` | 听众层级三档的详略口径、时间权重、结构模板、措辞规范、与周报/通报的边界 | 成文前 |
| `references/input-spec.md` | 上游 JSON 识别顺序、periodic.json/daily.json 指标键中文映射、参数说明 | 检查输入时 |
| `references/checklist.md` | 交付自检清单（含数字来源核对） | 交付前 |
| `scripts/README.md` | 脚本参数与产出说明 | 运行脚本前 |
| `scripts/selftest.js` | 自测：覆盖无数据议题、层级三档、权重、去位号、slides、周报 JSON 映射等边界用例（仅开发包含有，发布包不含） | 修改脚本后（开发包）；文件不存在则跳过 |
| `assets/templates/report-speech-template.md` | 汇报稿模板（{{占位符}}） | 成文时 |
| `references/sample-output.md` | 风格示范产出（数字均为虚构） | 拿不准汇报稿风格时 |
| `examples/` | 回归测试数据（仅开发包含有，发布包不含） | 目录不存在则跳过 |
