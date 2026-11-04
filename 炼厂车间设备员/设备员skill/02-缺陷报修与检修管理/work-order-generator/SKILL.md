---
name: work-order-generator
description: 维修通知单草稿生成（中石化体系炼化厂车间设备员口径）。当用户提到"出通知单""报修""把这条缺陷转通知单""转成 SAP 通知单草稿""批量报修"并提供缺陷记录、defects.json 或问题描述时使用；从设备台账（SAP 技术对象导出）带出功能位置、设备编号、规格型号，附历史维修记录（SAP 订单历史），按缺陷等级映射 SAP 优先级 1~4 与通知单类型 M1/M2，生成可在 SAP 创建维修通知单的草稿（md + CSV）。不自编工单号、不给工时与备件。缺陷登记与定级用 defect-intake-grading；工单跟踪催办用 work-order-tracker；检修方案与作业步骤用 repair-plan-assistant；重复故障分析用 repeat-failure-detector。
allowed-tools: Read,Write,Bash
agent_created: true
metadata:
  version: 0.2.0
  author: calvin
  tags: [refinery, equipment, notification, sap-pm, sinopec]
---

# 维修通知单草稿生成（work-order-generator）

面向中石化体系炼化厂车间（运行部）设备员，把已登记的缺陷转成可在 SAP PM 创建**维修通知单**的草稿，自动从设备台账带出设备信息、从 SAP 订单历史附历史维修背景。**设备信息、历史记录一律从台账读取，模型不得凭印象填写功能位置、规格或备件型号。**

## 适用条件
- 用户说"出个通知单 / 报修 / 把这条缺陷转通知单 / 这批缺陷批量报修"，并给出缺陷记录、`defects.json`（defect-intake-grading 产出）或问题描述。
- 支持批量：一次把多条缺陷转成多张通知单草稿；缺陷表可直接用 SAP 通知单导出列名（功能位置、设备、设备描述、对象部件、通知单短文本、通知日期、报告人）。
- **车间设备员可做**：在 SAP 创建维修通知单（本技能给草稿）、提出要求结束日期、建议专业归口与承修单位。**由 XX 归口**：维修工单（订单）由计划员或承修单位创建，工时定额、备件清单、派工由承修单位与公司设备管理部门（机动部/设备部）按厂内流程确定，设备员不填。
- 不适用：缺陷的登记与定级；工单执行状态的跟踪催办；检修技术方案与作业步骤编制。

## 前提条件
- 输入：缺陷描述、缺陷记录（`defects.json`、`.xlsx`）或文字。**建议同时提供设备台账**（SAP 技术对象导出：功能位置、设备、设备描述、型号编号、工厂区段、专业类别、开始日期）与**历史维修记录**（SAP 订单历史：订单、功能位置、基本开始日期、订单描述、主工作中心）。
- 必填信息：功能位置（位号）、故障现象、报告单位（车间）、要求结束日期。可选：SAP 优先级、通知单类型、建议承修单位、报告人。
- 环境：可执行 Node.js ≥ 18，脚本仅用内置模块，无需 npm 安装。**若环境无法执行 node（无 Bash 工具或 `node --version` 失败），明确告知用户并终止，不得手工拼装通知单草稿或估算工时。**

## 数据获取（MCP）

平台接入了业务系统 MCP 服务时，按下表调用工具取数，不再请用户上传导出文件；未接入时按操作步骤请用户提供系统导出文件。工具全部只读，不在业务系统里创建或修改任何单据。

| 服务 | 工具 | 参数 | 交给脚本 |
|---|---|---|---|
| 设备资产管理 | `get_notifications` | `open_only=true`；`workshop`：车间 | `--input`（目录 A） |
| 设备资产管理 | `get_equipment_ledger` | `workshop`：车间；单条缺陷时改用 `tag`：位号 | `--ledger`（目录 B） |
| 设备资产管理 | `get_failure_history` | `for_skill=work-order-generator`；`workshop`：车间；单条缺陷时改用 `tag`：位号 | `--history`（目录 C） |

取数后：

1. 工具返回下载链接（60 分钟内有效，过期重新调用）。csv 按原文件名放进新建的空目录，不改文件名，不与其他技能的文件混放；表中目录字母相同的放同一个目录，不同字母分开放，把目录作为“交给脚本”一列的参数值。
2. `get_failure_history`：输出表名为「维修记录」。其中未完工工单（含本次缺陷自己的工单）没有维修日期和检修内容，脚本不列入历史维修摘要并 warning。
3. 批量时三个工具都带 `workshop`（与 `--applicant` 报告单位一致）：不带时其他车间的通知单也会以本车间名义出草稿。
4. 用户口述一条缺陷或给了上游 `defects.json` 时，不调 `get_notifications`，用 `--defect`（文字描述配 `--tag`），台账与维修记录按 `tag` 取。`get_notifications` 取到的是系统里已有的未关闭通知单，脚本把输入里的通知单号原样带到「已有通知单号」列并在 md 注明「系统已存在，勿重复创建」（`counts.existingNotif`），草稿只用于核对补全，不要在 SAP 里重复创建。

## 操作步骤
1. **确认通知单要素** —— 核对功能位置、现象、报告单位、要求结束日期、优先级。缺项时按 `references/intake-questions.md` 一次性列出需补充项，**不得用默认值替用户决定优先级与要求结束日期**。
2. **运行脚本** —— 技能目录以平台实际加载路径为准（Windows 路径加双引号）：
   ```bash
   node "<技能目录绝对路径>/scripts/workorder.js" --defect "<defects.json 或缺陷描述>" --tag "<功能位置>" --applicant "<报告单位>" --due <YYYY-MM-DD> --out "<工作目录>/维修通知单"
   ```
   可选：`--input "<批量缺陷xlsx 或 SAP 通知单导出>"`（替代 `--defect`）、`--ledger "<设备台账xlsx>"`、`--history "<历史维修记录/SAP订单历史xlsx>"`、`--priority <1~4|非常高|高|中|低>`、`--notif-type <M1|M2|M3>`、`--vendor "<建议承修单位>"`、`--reporter "<报告人>"`、`--history-n <近N次,默认3>`、`--workshop "<车间>"`、`--name`/`--part`/`--medium`（文字描述时补充）。
   `--defect` 两条路径都支持：传 `defect-intake-grading` 产出的 `defects.json` 路径（有几条缺陷出几张草稿，带出缺陷登记号、等级与定级规则号），或直接传一段文字描述（此时必须配 `--tag`）。
   读取末行 JSON 摘要（同时写入 `<out>/summary.json`）：`ok` 必须为 `true`，`ok:false` 时把 `error` 告知用户并终止；`warnings` 非空时逐条告知用户（位号不在台账/无历史记录/要求结束早于当前等）。脚本用法详见 `scripts/README.md`。
   - 位号在台账中查不到：warning + 设备编号、规格型号等留空标"待补充"，**不得凭设备名猜测规格型号**。
   - 未提供历史维修记录：对应章节写"未提供历史维修记录"，**不得编造历史检修履历**。
   - 未指定 `--priority` 且缺陷等级缺失或为"未判定"：优先级 `undetermined`，通知单类型也随之未判定，单列一节，**不按"3 中"/M1 默认**。
3. **读取 notifications.json** —— 从 `<输出目录>/notifications.json` 获取：`orders`（逐张草稿：草稿序号、`equipment` 设备信息、`fault` 故障描述与故障代码建议、`notification` 通知单抬头、`dispatch` 归口建议、`priority`、`schedule`、`history`）、`missingInfo`、`undetermined`、`counts`。
4. **撰写草稿正文** —— 按 `assets/templates/workorder-template.md` 成文。专业归口引用 `references/dispatch-rules.md` 并标注"建议值，需车间与承修单位确认"；工时与备件不写数值，只写归口说明。**历史维修摘要只引用台账中实际存在的记录，逐条注明日期、内容、工作中心与原订单号。**
5. **交付前自检** —— 对照 `references/checklist.md` 逐项检查；通过后交付 `notifications.md`、`notifications.json` 与 `notifications.csv`（SAP 通知单列，设备员核对后在 SAP 创建，通知单号由系统生成）。**必须保留说明行"本通知单草稿由车间设备员核对后在 SAP 中创建，通知单号由系统生成；维修工单（订单）、工时与备件由计划员或承修单位编制，本草稿不替代审核派发。"** 需要跟踪后续工单时提示可接 `work-order-tracker`。

## 预期结果
- `notifications.md`：维修通知单草稿，含 通知单草稿清单概览、通知单草稿正文、信息缺口清单（含未判定项）三个部分，开头带声明行。
- `notifications.json` 与 `notifications.csv`（SAP 通知单草稿列：草稿序号、通知单号(SAP生成)、已有通知单号（输入已带时原样写入）、通知单类型、功能位置、设备编号、设备描述、通知单短文本、长文本、优先级、故障代码、对象部件、要求开始、要求结束、报告单位、报告人、缺陷登记号、建议专业归口、建议承修单位、信息待补充项）；`summary.json`：脚本末行摘要。
- 交付时向用户说明：草稿数、优先级与通知单类型分布、位号不在台账数、无历史记录数、未判定数、信息待补充项、脚本 warnings（如有）。

## 不适用范围
- 不做缺陷定级，不判定维修必要性。
- 不创建维修工单（订单）、不编工单号与通知单号、不定工时、不给备件型号与方向。
- 不编制检修技术方案、作业步骤与安全措施。
- 不代为派工、不指定具体施工人员、不签发作业许可。
- 优先级与通知单类型映射为经验默认（A→1、B→2、C→3；1/2→M2、3/4→M1），厂内可配置，用 `--priority`/`--notif-type` 覆盖。

## 参考资料（按需读取，路径相对技能根目录）
| 文件 | 内容 | 何时读取 |
|---|---|---|
| `references/intake-questions.md` | 通知单要素清单与追问话术 | 信息不全时 |
| `references/dispatch-rules.md` | 专业归口判定表、缺陷等级与 SAP 优先级/通知单类型对应表 | 填写建议值时 |
| `references/input-spec.md` | 缺陷表、SAP 通知单导出、设备台账、历史维修记录字段定义与别名表 | 检查输入 / 用户询问格式时 |
| `references/checklist.md` | 交付自检清单（含说明行核对） | 交付前 |
| `scripts/README.md` | 脚本参数与产出说明 | 运行脚本前 |
| `scripts/selftest.js` | 自测：覆盖位号缺失、无历史记录、批量转单、SAP 列名、优先级未判定等边界用例（仅开发包含有，发布包不含） | 修改脚本后（开发包）；文件不存在则跳过 |
| `assets/templates/workorder-template.md` | 通知单草稿模板（{{占位符}} 与 notifications.json 键一致） | 成文时 |
| `references/sample-output.md` | 风格示范产出（内容均为虚构） | 拿不准草稿风格时 |
| `examples/`（仅开发包；仓库内在 `演示case/02-缺陷报修与检修管理/work-order-generator/`） | 回归测试数据，发布包不含 | 目录不存在则跳过 |
