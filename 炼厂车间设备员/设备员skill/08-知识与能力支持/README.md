# 08 知识与能力支持

面向能力建设与个人效率，也是数字员工与人协作的接口层。

| # | 技能目录 | 中文名 | 一句话 | 难度 | 批次 | 状态 |
|---|---|---|---|---|---|---|
| 1 | `equipment-knowledge-qa` | 设备知识问答 | 区分厂内资料依据与通用原理，数值类一律要求查规程 | 中 | 三 | ✅ 217 条断言 |
| 2 | `training-material-generator` | 培训材料与考题 | 按车间实际设备生成提纲、讲义与带出处的考题 | 低 | 二 | ✅ 215 条断言 |
| 3 | `operator-anomaly-guide` | 操作工异常指引 | 面向一线的识别要点与上报路径，严守职责边界 | 低 | 二 | ✅ 126 条断言 |
| 4 | `equipment-energy-analysis` | 设备能效分析 | 单机能效计算与同类对标，区别于装置综合能耗 | 中 | 三 | ✅ 215 条断言 |
| 5 | `worklog-todo-manager` | 工作日志与待办 | 汇集各来源待办，逾期与结转项强制保留 | 低 | 一 | ✅ 173 条断言 |

## 三条硬约束
1. **`equipment-knowledge-qa` 不给记忆中的数值。** 涉及限值、间隙、周期、判定标准的问题，一律要求查厂内规程。
2. **`operator-anomaly-guide` 严守操作工职责边界。** 脚本校验并拦截超范围动作（拆检、调整），一律改为"停止操作并上报"。
3. **`worklog-todo-manager` 不自动关闭或延期待办。** 未完成项原样结转并保留原始到期日与来源。

## 枢纽作用
`worklog-todo-manager` 是全部 50 个技能的待办出口，汇集 `inspection-task-dispatch`、`work-order-tracker`、`hazard-closure-tracker`、`special-equipment-inspection-due`、`valve-instrument-calibration-ledger` 等技能的 JSON 产出。

## 实现状态

本类 **5 / 5** 个技能已完整实现（Node 脚本 + selftest + references + examples），合计 **946** 条断言全绿。
