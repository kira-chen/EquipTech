---
name: worklog-todo-manager
description: 设备员工作日志与待办统一管理。当用户提到"我的待办""今天要干什么""跟进事项""工作日志""这事儿别忘了""到期提醒汇总""我手头的事""昨天没干完的接着排"并提供待办记录或多技能产出时使用；汇集来自巡检、工单、隐患、定检、校验、润滑、缺陷、值班交接等各来源的待办事项，按到期与优先级（对齐 SAP 工单 1~4 与缺陷 A/B/C）排序，输出个人待办清单与工作日志。值班/休假/调岗交接记录本身用 shift-handover-record；工单催办用 work-order-tracker；隐患督办用 hazard-closure-tracker。不用于团队任务分派、不做绩效统计、不替代厂内业务系统（EM/SAP PM）的待办功能。
allowed-tools: Read,Write,Bash
agent_created: true
metadata:
  version: 0.2.0
  author: calvin
  tags: [refinery, equipment, productivity]
---

# 工作日志与待办管理（worklog-todo-manager）

面向中石化体系炼化厂车间（运行部）设备员，把散落在各技能产出与记录中的待办事项汇集成一份个人待办清单，并生成工作日志。**汇集与排序由脚本完成，模型只负责成文；不得擅自判定某项待办"可以不做"或调整其到期日。**

## 适用条件
- 用户说"我今天要干什么 / 待办清单 / 手头有哪些事 / 写工作日志 / 到期提醒汇总 / 昨天没干完的接着排"，并提供待办记录或其他技能的产出文件。
- 汇集来源：工单超期与停滞（work-order-tracker）、隐患整改（hazard-closure-tracker）、特种设备定检（special-equipment-inspection-due）、阀门仪表校验（valve-instrument-calibration-ledger）、润滑（lubrication-manager）、缺陷跟进（defect-intake-grading）、值班/休假/调岗工作交接的未完成事项（shift-handover-record 的 `handover.json`）、上级交办与自记待办（待办表 / 文字）。
- 车间设备员可做的部分：个人待办汇集、排序、结转与工作日志。
- 由 XX 归口：工单与通知单的状态以厂内业务系统（EM/SAP PM）为准，本清单不替代系统待办；待办的关闭与延期由设备员在上游系统或下一次 `--done` 中确认，脚本不自动关闭或延期；绩效与工作量统计归车间/分厂管理口径。
- 不适用：团队任务的分派与跟踪；绩效统计与考核；替代厂内业务系统（EM/SAP PM）的待办与工作流；交接记录本身的生成（用 shift-handover-record）。

## 前提条件
- 输入：待办记录（`.xlsx`/`.csv`/文字，支持 SAP/EM 导出列名：工作事项、要求完成日期、紧急程度、功能位置、工单号/通知单号、处理状态）或其他技能的 JSON 产出（`orders.json`、`hazard.json`、`inspection.json`、`calibration.json`、`lube.json`、`defects.json`、`handover.json`）。`handover.json` 按约定识别：`meta.skill === 'shift-handover-record'` 且含 `pending` 数组。
- 必填信息：使用人姓名或岗位、日期。可选：上一日待办 JSON（用于结转）、优先级口径、前瞻天数。
- 环境：可执行 Node.js ≥ 18，脚本仅用内置模块，无需 npm 安装。**若环境无法执行 node（无 Bash 工具或 `node --version` 失败），明确告知用户并终止，不得基于文字手工成文或自行判定（硬约束 2）。**

## 操作步骤
1. **确认使用人与日期** —— 姓名或岗位、日期、待汇集的来源文件。**来源文件越全，待办越完整；仅提供部分来源时须在产出中说明覆盖范围。**
2. **运行脚本** —— 技能目录以平台实际加载路径为准（Windows 路径加双引号）：
   ```bash
   node "<技能目录绝对路径>/scripts/todo.js" --input "<路径>[,<路径2>...]" --owner "<姓名或岗位>" --date <YYYY-MM-DD> --out "<工作目录>/待办管理"
   ```
   可选：`--prev "<上一日 todo.json>"`（结转未完成项）、`--done "<已完成事项>"`、`--priority-rules "<优先级口径>"`、`--horizon <前瞻天数，默认 7>`。默认输出目录为系统临时目录 `<os.tmpdir()>/wtm-out`，建议始终传 `--out`。
   读取末行 JSON 摘要（同时写入 `<out>/summary.json`）：`ok` 必须为 `true`，`ok:false` 时把 `error` 告知用户并终止；`warnings` 非空时逐条告知用户（来源文件无法识别/待办无到期日/疑似重复待办/旧 I~IV 缺陷口径映射/来源覆盖不全等）。脚本用法详见 `scripts/README.md`。
   - 上一日未完成项：**必须原样结转并保留原始到期日与来源，绝不静默丢弃，也不得自动延期**。
   - 待办无到期日：归入 `noDueDate` 单列，**不得自行设定到期日**。
   - 疑似重复（同一位号或编号来自多个来源，含交接记录与工单）：列出供用户确认，**不得自动合并**。
   - 优先级：工单按 SAP 1 非常高 / 2 高 / 3 中 / 4 低（中文 紧急/高/中/低 同义）；缺陷按 A 级（重大）/ B 级（严重）/ C 级（一般），旧 I~IV 四级口径按 I→A、II→B、III/IV→C 映射并 warning；交接未完成事项期限已过 P1、其余 P2。
3. **读取 todo.json** —— 从 `<输出目录>/todo.json` 获取：`overdue`（已逾期）、`today`（今日到期）、`upcoming`（前瞻期内）、`later`、`noDueDate`、`carriedOver`（结转项，含原始日期）、`byCategory`（按来源分类，含工作交接）、`possibleDuplicate`、`counts`。
4. **生成待办清单与工作日志** —— 按 `assets/templates/todo-template.md` 成文，输出两份：
   - `待办清单.md`：按逾期、今日、近期分组，每项含内容、来源、到期日、优先级。
   - `工作日志.md`：含今日完成事项（用户提供）、待办概况、需协调事项、明日重点。
   **结转项必须标注"结转自 X 月 X 日"；逾期项醒目标注逾期天数。**
5. **交付前自检** —— 对照 `references/checklist.md` 逐项检查；通过后交付两份文件与 `todo.json`。**必须保留两行声明："待办汇集自所提供来源，覆盖范围见清单说明；厂内业务系统（EM/SAP PM）中的待办请以系统为准。"与"本材料由脚本汇总、模型成文，仅供设备员复核参考，不替代审批、定性、验收与签字；厂内制度与系统数据为准。"**

## 预期结果
- `待办清单.md`：八节（一、待办概况；二、已逾期；三、今日到期；四、近期；五、无到期日；六、结转项；七、按来源分类；八、疑似重复）+ 有前瞻期外项时「九、前瞻期外」+ 有 warning 时「附：数据提示」。
- `工作日志.md`：四节（一、今日完成事项；二、待办概况；三、需协调事项；四、明日重点），后两节留 `<!-- ANALYSIS_START/END -->` 占位。
- `todo.json`：结构化待办，供次日结转；`summary.json`：脚本末行摘要。
- 交付时向用户说明：待办总数、逾期数、今日到期数、结转数、无到期日数、疑似重复组数、覆盖的来源（含是否读入交接记录）、脚本 warnings（如有）。

## 不适用范围
- 不判定待办可以不做，不自动延期或关闭事项。
- 不做团队任务分派与他人工作跟踪。
- 不做工作量统计、绩效评价与考核。
- 不替代厂内业务系统（EM/SAP PM）的待办与工作流。

## 参考资料（按需读取，路径相对技能根目录）
| 文件 | 内容 | 何时读取 |
|---|---|---|
| `references/input-spec.md` | 各上游技能 JSON（含 handover.json 约定）的待办字段对接口径、待办记录表字段与 SAP/EM 列名别名、优先级取值 | 检查输入 / 用户询问格式时 |
| `references/todo-rules.md` | 优先级排序口径（SAP 1~4 / 缺陷 A/B/C / 交接事项）、结转规则、重复判定、日志表述规范 | 成文前 |
| `references/checklist.md` | 交付自检清单（含结转项核对） | 交付前 |
| `scripts/README.md` | 脚本参数与产出说明 | 运行脚本前 |
| `scripts/selftest.js` | 自测：覆盖结转、无到期日、重复待办、交接记录、SAP/EM 列名与优先级映射等边界用例（仅开发包含有，发布包不含） | 修改脚本后（开发包）；文件不存在则跳过 |
| `assets/templates/todo-template.md` | 待办清单与工作日志模板（{{占位符}}） | 成文时 |
| `references/sample-output.md` | 风格示范产出（内容均为虚构） | 拿不准清单风格时 |
| `examples/` | 回归测试数据（仅开发包含有，发布包不含） | 目录不存在则跳过 |
