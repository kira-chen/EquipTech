# examples 回归测试数据

> 本目录仅开发包含有（`build.sh --with-examples`），发布包不含。
> 全部样例由 `node scripts/make-sample.js --out examples` 再生，数值随 seed 变化但结论不变。

## 示例问题 ↔ 附件对照表

| # | 示例问题 | 附件 | 运行参数 | 预期结果 |
|---|---|---|---|---|
| 1 | 把各处的待办汇总一下，我今天要干什么 | 6 个上游 JSON + `sample-todo-sheet.xlsx` + `sample-todo-text.txt` | `--owner 张设备 --date 2026-09-21` | 待办 23 项：逾期 8、今日到期 2、近期 7、无到期日 6；疑似重复 3 组 |
| 2 | 只给了工单和隐患的产出，先汇集这两份 | `sample-orders.json,sample-hazard.json` | 同上 | 待办 7 项：逾期 4、近期 2、无到期日 1；不因缺其他来源而报错 |
| 3 | 昨天没干完的别丢了，接着往下排 | 任一来源 + 上一日 `todo.json` | 加 `--prev <上一日 todo.json>` | 上一日未完成项全部结转；到期日与上一日一致；清单标「结转自 X 月 X 日」 |
| 4 | 这个 JSON 是别的系统导的，能一起读吗 | 主样例 + `sample-unknown.json` | 同 #1 | 无法识别的 JSON 记 warning 并忽略，其余来源照常汇集，ok:true |
| 5 | 顺便把今天做完的事记进日志 | 同 #1 | 加 `--done "完成 P-1102A 加油；参加晨会"` | `工作日志.md`「今日完成事项」列出 2 条；`counts.done` 为 2 |
| 6 | 只看未来 3 天的 | 同 #1 | 加 `--horizon 3` | 近期项减少，超出的进「前瞻期外」一节，总数不变 |
| 7 | 我自己记在本子上的几件事也加进来 | `sample-todo-text.txt` | `--owner 张设备 --date 2026-09-21` | 3 条文字待办；写了「截止 日期」的识别出到期日，其余 2 条进无到期日 |
| 8 | 昨天值班交接记录里没完成的事也排进来 | `sample-handover.json`（shift-handover-record 产出） | `--owner 张设备 --date 2026-09-21` | 识别为「工作交接」来源，pending 3 条全部纳入：P-1101B 期限已过 P1、E-1201 近期 P2（detail 带「交接记录中已连续结转 2 次」）、TT-1308 无期限进无到期日不自设 |
| 9 | 交接记录和工单、缺陷一起汇总 | #1 的 8 个来源 + `sample-handover.json` | 同 #1 | 26 项；P-1101B 疑似重复组扩为 4 条（工单 / 缺陷 / 待办表 / 交接），均保留不合并 |
| 10 | 这张跟进表是从 SAP 导出来的，紧急程度写的是 1~4 和 A 级 | `sample-todo-sap-style.xlsx` | `--owner 张设备 --date 2026-09-21` | 列名「工作事项 / 要求完成日期 / 紧急程度 / 功能位置 / 工单号 / 处理状态」直接可读；4 项（已关闭的不进）；「1 非常高」→ P1、「A级」→ P1、「II级」→ P2 并 warning 旧口径、「3 中」→ P3；功能位置归位号、工单号归编号 |

## 关键验证点

1. **多源合并**：6 个上游 JSON 各自的 `overdue` / `dueSoon` / `stalled` / `unverified` / `unresolvedFail` / `defects` 字段全部被识别为待办，`byCategory` 分 8 类。
2. **结转不丢不延期**：`--prev` 传入后 `counts.carriedOver` 等于上一日未完成项数；结转项 `dueDate` 与 `originalDueDate` 相同，逾期天数按新基准日 +1，到期日不变。本日上游重跑时到期日变了的，不静默改写，warning 并在清单两个日期都列。二次结转 `carriedRounds` 累加到 2，`carriedFrom` 仍是最早那天。
3. **无到期日不自设**：工单停滞（WO-26082033）、校验不合格未整改（TT-1308）、未定级缺陷（QX-26090016）、待办表未填到期日的一项、文字待办 2 条，共 6 项进 `noDueDate`，`dueDate` 恒为 `null`，各自写明原因。
4. **疑似重复不自动合并**：P-1101B 同时出现在工单超期、缺陷跟进、待办表；V-1301 出现在工单临期与特种设备定检；PSV-1102 出现在校验超期与待办表。三组均单列供确认，`items[]` 中原始条目一条不少。
5. **无法识别的 JSON**：`sample-unknown.json` 被 warning 忽略，`counts.sources` 不计入它，运行不中断。
6. **合计行与标题行**：`sample-todo-sheet.xlsx` 首行为标题、第三行才是表头，末行是合计行——表头正确识别、合计行跳过并 warning。
7. **已完成不进待办**：待办表中状态为「已完成」的「提交上月设备月报」不出现在任何一节。
8. **声明行**：两份 md 均含「待办汇集自所提供来源，覆盖范围见清单说明；厂内业务系统（EM/SAP PM）中的待办请以系统为准。」与通用声明行「本材料由脚本汇总、模型成文，仅供设备员复核参考，不替代审批、定性、验收与签字；厂内制度与系统数据为准。」。
9. **交接记录对接**（案例 8、9）：`handover.json` 按 `meta.skill === 'shift-handover-record'` 且含 `pending` 数组识别；期限原样、不改写；与工单同位号判疑似重复不合并。
10. **优先级对齐口径表**（案例 10）：SAP 1~4、缺陷 A/B/C 直接认，旧 I~IV 映射并 warning 到行。
11. **检验问题整改**：`inspection.json` 的 `openIssues`（上游带 `--issues`）纳入待办，整改超期 P1、未到期 P2；样例 `sample-inspection.json` 未带整改项（`openIssues` 为 null），汇集时 warning 说明本清单不含检验问题整改，计数不受影响。

## 再生样例

```bash
node scripts/make-sample.js --out examples            # 默认 seed=1
node scripts/make-sample.js --out examples --seed 7   # 数值变化，结论不变
```

## MCP 取数对照

本技能不直接调 MCP。平台接入业务系统 MCP 时，先按 7 个上游技能 SKILL.md「数据获取（MCP）」一节取数并运行，再把 JSON 逗号拼接作 `--input`。下表用常减压车间实跑，上游取数与上游 SKILL.md 一致（能按车间取的都带 `workshop=常减压车间`）：work-order-tracker 用设备资产管理 `get_work_orders`（workshop）；hazard-closure-tracker 用 HSE管理平台 `get_hazards`（workshop）；special-equipment-inspection-due 用设备资产管理 `get_special_equipment`（workshop）作 `--input`、`get_inspection_issues`（workshop）作 `--issues`；valve-instrument-calibration-ledger 用设备资产管理 `get_safety_valves`（workshop）；lubrication-manager 用点检巡检App `get_lubrication_ledger`、`get_lubrication_records`（workshop）与 `get_oil_analysis`（tag=润滑台账里的位号）作 `--input`，`get_oil_prices` 作 `--price`，DCS位号数据 `get_run_events`（workshop，for_skill=lubrication-manager）作 `--run-hours`；defect-intake-grading 用设备资产管理 `get_notifications`（open_only=true，workshop）作 `--input`、`get_equipment_ledger`（workshop）作 `--equip-ledger`；shift-handover-record 用设备资产管理 `get_notifications`、`get_work_orders`（workshop，for_skill=shift-handover-record）。上游有 `--date` 的与本技能用同一天，交接用当天的 `--time`。预期结果按今天及其后 +6、+14、+20、+28、+45 天 6 个日期复跑，只写每天都成立的结论，随日期变的写成「如有…则…」。

| # | 示例问题 | MCP 调用 | 运行参数 | 预期结果 |
|---|---|---|---|---|
| M1 | 常减压车间今天我要干什么，7 个来源汇总排序 | 不直接调；先跑上表 7 个上游技能 | `--input orders.json,hazard.json,inspection.json,calibration.json,lube.json,defects.json,handover.json --owner 赵三 --date <今天>` | `counts.sources = 7`；E-1201 列疑似重复组（缺陷跟进 + 工作交接），原始条目都保留不合并；如有安全阀校验超期（多数日子是 PSV-1202）则列 P1；如有特种设备检验问题整改（`openIssues`）则纳入，整改超期 P1、未到期 P2；如有停滞工单或按运行小时判定的润滑项（如 C-3101B 曲轴箱，标题写「剩余 N 小时」不写日期）则进无到期日、不代填日期；某来源当天无待办时「按来源分类」不出该类（如校验全部正常的日子只有 6 类） |
| M2 | E-1201 管束内漏在待办里出现了几处 | 同 M1 | 同 M1 | E-1201 疑似重复组 2 条：缺陷跟进（B 级）+ 工作交接，未合并 |
| M3 | 明天接着排，今天没干完的别丢 | 同 M1（次日重跑上游） | 同 M1，加 `--prev <今天的 todo.json> --date <明天>` | 今天的事项全部在列：`carriedOver` 等于今天的总数（上游重跑的同一事项按 key 合并结转标记，不重复列）；次日上游新出现的事项另计，不算结转，所以总数一般比今天多；上游没变的到期日不变、逾期天数 +1；如有上游到期日变了的，warning「上游到期日由 X 变为 Y，请在系统核实」，清单列出两个日期 |

