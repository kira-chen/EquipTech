# 02 缺陷报修与检修管理

技能数量最多的一类，覆盖从发现缺陷到检修闭环归档的完整链条，是车间设备员工作量最集中的环节。

| # | 技能目录 | 中文名 | 一句话 | 难度 | 批次 | 状态 |
|---|---|---|---|---|---|---|
| 1 | `defect-intake-grading` | 缺陷登记与分级 | 口语化描述转结构化缺陷记录并定级 | 低 | 一 | ✅ 202 条断言 |
| 2 | `work-order-generator` | 维修通知单草稿 | 缺陷转 SAP 维修通知单草稿，带台账与历史背景；工单由计划员创建 | 低 | 一 | ✅ 238 条断言 |
| 3 | `work-order-tracker` | 工单跟踪催办 | 状态分布、超期与停滞识别、催办清单、完成率 | 低 | 一 | ✅ 198 条断言 |
| 4 | `repeat-failure-detector` | 重复故障识别 | 识别同设备与同型号重复故障，提示做根因分析 | 中 | 三 | ✅ 232 条断言 |
| 5 | `maintenance-demand-rollup` | 检修需求汇总 | 汇总本车间检修需求，生成可上报设备部的清单 | 低 | 一 | ✅ 271 条断言 |
| 6 | `repair-plan-assistant` | 检修方案辅助 | 按设备类型匹配作业步骤、工机具、质量控制点 | 中 | 二 | ✅ 334 条断言 |
| 7 | `equipment-handover-check` | 设备交出确认 | 按介质与作业类型生成交出条件清单与交出单 | 中 | 二 | ✅ 201 条断言 |
| 8 | `permit-precheck-bridge` | 车间作业票预检 | 读取作业票，按 GB 30871 规则逐项预检，附车间侧核实情况 | 低 | 一 | ✅ 297 条断言 |
| 9 | `overhaul-process-check-bridge` | 车间检修方案安全措施核查 | 读取检修方案，对照通用与专项安全措施清单核查，附车间侧核实情况 | 低 | 一 | ✅ 394 条断言 |
| 10 | `completion-acceptance` | 完工验收 | 生成验收项清单、记录结果、输出验收报告 | 中 | 二 | ✅ 210 条断言 |
| 11 | `maintenance-record-archive` | 检修记录归档 | 核对应归档资料完整性，更新台账检修履历 | 低 | 一 | ✅ 146 条断言 |
| 12 | `turnaround-workshop-tracker` | 大修车间跟踪 | 大修期间项目进度、资源到位、开工条件一张表 | 中 | 二 | ✅ 340 条断言 |

## 关于两个 bridge 技能
`permit-precheck-bridge` 与 `overhaul-process-check-bridge` 自带规则引擎：作业票预检按 GB 30871-2022 整理的 130 条规则（`scripts/precheck.js`），检修方案核查按 70 条安全措施规则（`scripts/check.js`）。原来的 `work-permit-precheck`、`overhaul-safety-check` 两个独立技能已并入，不再需要另外安装。规则引擎只判定，`merge-report.js` 只把判定结果连同车间侧核实情况逐条转达，不改写判定。

## 数据流
`defect-intake-grading` → `work-order-generator` → `work-order-tracker` → `completion-acceptance` → `maintenance-record-archive`，构成缺陷闭环主链。`maintenance-demand-rollup` 从缺陷与工单取数上报；`repair-plan-assistant` 产出的方案交由 `overhaul-process-check-bridge` 核查。

## 实现状态

本类 **12 / 12** 个技能已完整实现（Node 脚本 + selftest + references + 演示case 样例），合计 **3063** 条断言全绿。
