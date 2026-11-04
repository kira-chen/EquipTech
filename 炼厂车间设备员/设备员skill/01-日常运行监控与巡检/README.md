# 01 日常运行监控与巡检

面向车间设备员的日常设备状态感知环节，覆盖"派任务 → 收数据 → 看趋势 → 判异常"的闭环，以及润滑、运行时长、备用设备等周期性管理。

| # | 技能目录 | 中文名 | 一句话 | 难度 | 批次 | 状态 |
|---|---|---|---|---|---|---|
| 1 | `inspection-task-dispatch` | 巡检任务下发 | 按班次与周期生成当班巡检任务清单与路线 | 低 | 一 | ✅ 212 条断言 |
| 2 | `inspection-data-digest` | 巡检数据汇总 | 合并多来源巡检记录，输出设备日状态一览与漏检清单 | 低 | 一 | ✅ 135 条断言 |
| 3 | `parameter-trend-alert` | 参数趋势预警 | 计算劣化趋势，越限前预警并给出预计到限时间 | 中 | 三 | ✅ 328 条断言 |
| 4 | `anomaly-triage-advisor` | 异常初判建议 | 结合现象与数据给出可能原因排序、核实项与上报建议 | 高 | 三 | ✅ 293 条断言 |
| 5 | `leak-point-tracker` | 泄漏点跟踪 | 登记跑冒滴漏与 LDAR 漏点，按时限跟踪修复闭环 | 中 | 二 | ✅ 265 条断言 |
| 6 | `lubrication-manager` | 润滑管理 | 加换油到期提醒、油品消耗统计、油液分析异常标记 | 低 | 一 | ✅ 215 条断言 |
| 7 | `runtime-hours-tracker` | 运行时长统计 | 累计运行小时与启停次数，对照阈值预警 | 低 | 二 | ✅ 206 条断言 |
| 8 | `standby-rotation-reminder` | 备用设备切换提醒 | 备泵切换、盘车、试运的到期提醒与执行率统计 | 低 | 二 | ✅ 230 条断言 |

## 数据流
`inspection-task-dispatch` 产出任务 → 执行后记录进入 `inspection-data-digest` → 异常项转 `anomaly-triage-advisor` 初判、或转 02 类的 `defect-intake-grading` 登记缺陷 → 多期数据积累后供 `parameter-trend-alert` 做趋势。

## 实现状态

本类 **8 / 8** 个技能已完整实现（Node 脚本 + selftest + references + 演示case 样例），合计 **1884** 条断言全绿。
