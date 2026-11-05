---
name: equipment-daily-report
description: 车间设备日报生成（中石化体系炼化厂车间设备员口径）。当用户提到"设备日报""今天设备情况""设备运行日报""早会设备汇报""车间设备日报""特护设备日报"并提供巡检汇总、维修通知单/工单、作业票、泄漏点、隐患、异常记录等设备数据（Excel 或上游技能 JSON）时使用；按运行/备用/检修/停用/异常/未判定六档汇总设备状态，单列特护设备运行状况、待验收缺陷与工单、当日作业票、泄漏点与隐患，输出车间设备日报。区别于装置运行日报（工艺口径，用 unit-daily-report）；周报月报用 equipment-weekly-monthly-report；大检修进度日报用 turnaround-workshop-tracker；值班与工作交接记录用 shift-handover-record。
allowed-tools: Read,Write,Bash
agent_created: true
metadata:
  version: 0.2.0
  author: calvin
  tags: [refinery, equipment, report]
---

# 车间设备日报（equipment-daily-report）

面向中石化体系炼化厂车间（运行部）设备员，每日汇总设备状况形成设备日报，供车间早会与上报分厂/公司设备管理部门使用。**所有数字由脚本统计，模型只负责撰写情况说明；事实数字一律引用脚本结果，不得自行统计或估算。**

## 适用条件
- 用户说"出设备日报 / 今天设备情况汇总 / 早会设备汇报材料 / 车间设备日报 / 特护设备日报"，并给出（或即将给出）设备相关数据。
- **与 `unit-daily-report` 的区别**：那个是工艺口径（物料平衡、收率、能耗、产品质量），本技能是设备口径（设备状态、缺陷、工单、作业票、泄漏点、隐患、检修）。用户要"装置日报"时应用那个技能。
- **与 `turnaround-workshop-tracker` 的区别**：大检修期间的"大修进度日报 / 大修日报"是项目进度口径，用那个技能；本技能只在"检修进度"一节转录在施项目的进度表。
- 车间设备员可做：巡检点检数据汇总、缺陷（维修通知单）与工单跟踪、属地作业票汇总、隐患与泄漏点台账汇总。**不做**：设备状态与缺陷等级的重新判定（以上游记录为准）、事故定性、隐患等级认定（安全部门归口）、作业票级别判定（以票面为准）。
- 不适用：周报月报汇总；值班与工作交接记录；工艺运行数据的日报。

## 前提条件
- 输入：一个或多个 `.xlsx`（或 JSON，来自上游技能），可含「巡检汇总」「特护设备」「缺陷台账（维修通知单）」「工单台账」「作业票」「泄漏点」「隐患台账」「异常事件」「检修进度」，至少提供其中一张；列名支持 SAP PM / EM / 作业许可系统 / 智能巡检导出常见列名（功能位置、设备描述、订单、系统状态、基本结束日期、主工作中心、通知单、许可证编号……）。也可直接接收 `inspection-data-digest` 的 `status.json`、`work-order-tracker` 的 `orders.json`、`defect-intake-grading` 的 `defects.json`、`leak-point-tracker` 的 `leaks.json`、`hazard-closure-tracker` 的 `hazard.json`。
- 必填信息：车间名称、日报日期（YYYY-MM-DD）。可选：上一日 daily.json（环比）、值班信息、次日计划（用户提供）。
- 环境：可执行 Node.js ≥ 18，脚本仅用内置模块，无需 npm 安装。**若环境无法执行 node（无 Bash 工具或 `node --version` 失败），明确告知用户并终止，不得手工统计任何数字。**

## 数据获取（MCP）

平台接入了业务系统 MCP 服务时，按下表调用工具取数，不再请用户上传导出文件；未接入时按操作步骤请用户提供系统导出文件。工具全部只读，不在业务系统里创建或修改任何单据。

| 服务 | 工具 | 参数 | 交给脚本 |
|---|---|---|---|
| 设备资产管理 | `get_notifications` | `workshop`：车间名；`for_skill=equipment-daily-report` | `--input`（目录 A） |
| 设备资产管理 | `get_work_orders` | `workshop`：车间名；`for_skill=equipment-daily-report` | `--input`（目录 A） |
| HSE管理平台 | `get_hazards` | `workshop`：车间名 | `--input`（目录 A） |
| 作业票系统 | `get_permits` | `workshop`：车间名；`date`：日报日期 | `--input`（目录 A） |

取数后：

1. 工具返回下载链接（60 分钟内有效，过期重新调用）。csv 按原文件名放进新建的空目录，不改文件名，不与其他技能的文件混放；表中目录字母相同的放同一个目录，把目录作为“交给脚本”一列的参数值。
2. 四个工具都要填 `workshop`：脚本只在输入带车间列时按 `--workshop` 核对（剔除其他车间的行；车间列全不一致时不筛并在报告开头提示）；MCP 导出多数不带车间列，取数时仍必须带 `workshop`，不填会把别的车间的单据算进本车间日报。
3. `get_notifications`、`get_work_orders`：输出表名为「缺陷台账」「工单台账」；**不填 `start_date`**，默认返回近 12 个月及全部未关闭的单据。填了起始日会漏掉起始日之前发现、至今未闭环的缺陷和工单。
4. `get_hazards`：输出表名为「隐患台账」（整改状态、要求整改期限、验收情况；完成态与验收态词表与 hazard-closure-tracker 同口径，验收人、验收日期按独立列读取）；`get_permits`：输出表名为「作业清单」，按作业票读取，默认只含日报日期当天有效（开始不晚于当天、结束不早于当天，含跨天的多日票）且未关闭的票。
5. 设备状态（一节）和特护设备（二节）不要用 `get_inspection_records` 的原始巡检记录直接充当巡检汇总（一台设备多条检查项），也不要把巡检记录 csv 放进目录 A。需要时先按 `inspection-data-digest` 的「数据获取（MCP）」跑出 `status.json`，再与目录 A 一起传：`--input "<status.json>,<目录 A>"`。

## 操作步骤
1. **确认车间与日报日期** —— 从用户消息或文件名中提取；不明确时向用户确认一次。说明各输入文件对应的数据类型，不明确时确认一次。
2. **运行脚本** —— 技能目录以平台实际加载路径为准（Windows 路径加双引号）：
   ```bash
   node "<技能目录绝对路径>/scripts/daily.js" --input "<路径>[,<路径2>...]" --workshop "<车间名>" --date <YYYY-MM-DD> --out "<输入同目录>/设备日报"
   ```
   可选：`--prev "<上一日 daily.json>"`、`--shift "<值班>"`、`--plan "<次日计划文本或文件>"`。建议始终传 `--out`，否则写到系统临时目录。
   读取末行 JSON 摘要（同时写入 `<out>/summary.json`）：`ok` 必须为 `true`，`ok:false` 时把 `error` 告知用户并终止；`warnings` 非空时逐条告知用户（缺表/缺列/数据日期与日报日期不符/数值无法解析/隐患等级未映射等）。脚本用法详见 `scripts/README.md`。
   - 未提供某类数据：对应章节写"本日未提供 XX 数据"，**不得用 0 值或推算值补齐**。
   - 车间范围：表格带「车间 / 所属车间 / 属地车间 / 运行部」列时，剔除其他车间的行并 warning，口径写在日报开头「车间范围：」一行（`meta.workshopScope`）；车间列全不一致时不筛，日报开头有【注意】，多半是传错了文件，须向用户确认。「维护工厂」是 SAP 工厂代码，不当车间列。上游 JSON（含 `--prev`）的 `meta.workshop` 与 `--workshop` 不一致时不纳入并 warning（`meta.upstreamWorkshop`），未注明车间的照常纳入并注明无法核对。
3. **读取 daily.json** —— 从 `<输出目录>/daily.json` 获取：`status`（六档状态 `byState`：运行/备用/检修/停用/异常/未判定）、`special`（特护设备逐台状态与参数）、`defects`（新增与未闭环缺陷，`pendingAccept` 待验收单列）、`orders`（工单分布、待验收、超期）、`permits`（当日作业票按类别计数）、`maintenance`（检修进度）、`leaks`（泄漏点）、`hazards`（隐患）、`events`（异常事件）、`compare`（有 --prev 时的环比）、`counts`。
4. **撰写"设备运行情况说明"** —— 读 `references/report-rules.md` 的表述口径，撰写 250~400 字，按"总体状况 → 特护设备 → 异常与缺陷 → 工单与作业 → 泄漏点与隐患 → 需协调或上报事项 → 次日重点"结构，替换 `daily.md` 中 `<!-- ANALYSIS_START -->` 与 `<!-- ANALYSIS_END -->` 之间的占位文字。**所有数字引用 daily.json；未闭环事项必须逐条列出责任人与计划完成时间，台账中无记录的写"未记录"。** "待验收"是已完工未验收，不得写成已闭环。
5. **交付前自检** —— 对照 `references/checklist.md` 逐项检查；通过后交付 `daily.md` 与 `daily.json`。用户要求 Word 时：平台具备 docx 能力则转换后交付；否则交付 `.md` 并告知"当前环境无法生成 docx，可用 Word 直接打开或粘贴 Markdown"。**不得手写 docx XML 拼装文件。** 次日计划由用户提供，未提供时保留占位说明。

## 预期结果
- `daily.md`：车间设备日报，共十节（有 `--prev` 时十一节）：一、设备状态概览（六档）；二、特护设备运行状况；三、异常与缺陷；四、工单执行；五、当日检修作业与作业票（含检修进度）；六、泄漏点；七、隐患；八、异常事件；（九、环比）；设备运行情况说明；次日计划。末尾带声明行。
- `daily.json`：全部统计指标，供周报月报汇总与下游使用；`summary.json`：脚本末行摘要（含 `sections` 节数）。
- 交付时向用户说明：数据来源文件、六档状态台数、特护设备异常数、未闭环缺陷数（其中待验收数）、超期工单数、作业票数、超期泄漏点与隐患数、脚本 warnings（如有）、说明段需设备员复核。

## 不适用范围
- 不做工艺运行指标的统计与分析（用 unit-daily-report）。
- 不做多日趋势、周月汇总与泄漏率/完好率核算（用 equipment-weekly-monthly-report）。
- 不做大检修项目进度跟踪与大修日报（用 turnaround-workshop-tracker）。
- 不重新判定设备状态与缺陷等级（以上游记录为准）；不认定隐患等级（安全部门归口）；不判定作业票级别（以票面为准）。
- 不做事故定性、责任认定与损失估算。

## 参考资料（按需读取，路径相对技能根目录）
| 文件 | 内容 | 何时读取 |
|---|---|---|
| `references/input-spec.md` | 各类输入表字段定义、系统导出列名别名、与上游技能 JSON 的对接口径 | 检查输入 / 用户询问格式时 |
| `references/report-rules.md` | 日报口径（六档状态、待验收、特护、作业票、泄漏点、隐患）、措辞规范、与装置日报/大修日报的边界 | 撰写说明段前 |
| `references/checklist.md` | 交付自检清单 | 交付前 |
| `scripts/README.md` | 脚本参数与产出说明 | 运行脚本前 |
| `scripts/selftest.js` | 自测：覆盖六档状态、待验收、SAP 列名、缺数据源、环比等边界用例（仅开发包含有，发布包不含） | 修改脚本后（开发包）；文件不存在则跳过 |
| `assets/templates/daily-template.md` | 日报模板（占位符与 daily.json 键一致） | 用户要求调整版式时 |
| `references/sample-output.md` | 风格示范产出（数字均为虚构） | 拿不准日报风格时 |
| `examples/`（仅开发包；仓库内在 `演示case/06-报表与沟通/equipment-daily-report/`） | 回归测试数据（仅开发包含有，发布包不含），含 `upstream/` 上游 JSON 样例 | 目录不存在则跳过 |
