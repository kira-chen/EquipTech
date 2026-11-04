# 输入规格：会议材料生成

## 支持的输入

`--input` 接受逗号分隔的多个路径，也可以是一个目录（自动扫描 `.json` / `.xlsx` / `.md`）。

### 1. 上游技能 JSON（推荐）

| 文件 | 来源技能 | 识别特征 | 抽取内容 |
|---|---|---|---|
| `hazard.json` | hazard-closure-tracker | `majorHazards` | 隐患总数、重大隐患、超期（`counts.total/major/overdue`）、闭环率（`metrics.closureRate`，兼容旧字段 `closeRate`）；未闭环的重大隐患进问题项，已闭环（bucket=closed，已整改且已验收）的进「主要工作」 |
| `status.json` | inspection-data-digest | `byEquipment` + `abnormal` | 设备数、异常、未判定、漏检；异常项进问题项 |
| `orders.json` | work-order-tracker | `byStatus` 或 `metrics.closeRate` | 工单总数、未闭环、超期、停滞、完成率；超期工单进问题项，责任方取 `vendor`（承修单位/工作中心），无 `vendor` 时才用 `owner` |
| `defects.json` | defect-intake-grading | `counts.byLevel` + `defects` | 新增缺陷、各等级分布 |
| `periodic.json` | equipment-weekly-monthly-report | `metrics` + `failures` + `dataGaps` | 指标键映射为中文标签与单位（见下表）；`dataGaps.recompute` 需复算指标与 `highlights` 进问题项；超期工单责任方写单位（`highlights[].unit` 或 `orders.overdueList[].workCenter`），只有责任人姓名的（旧版 periodic.json、检修计划「责任人」）去掉人名并 warning；`basedOn` 数据覆盖进要点 |
| `daily.json` | equipment-daily-report | `counts` + `status` + `orders` | counts 映射为中文；`special.list` 中状态为异常的特护设备进问题项 |

指标键 → 中文标签（只做展示映射，不改数值；null 保留 null）：

| 键 | 标签 | 单位 |
|---|---|---|
| intactRate / majorRate / standbyRate | 设备完好率 / 主要设备完好率 / 备机完好率 | % |
| staticLeakRate / dynamicLeakRate | 静密封点泄漏率 / 动密封点泄漏率 | ‰ |
| planRate / planRateOverhaul / planRateRoutine | 检修计划完成率 / 大检修计划完成率 / 日常维修计划完成率 | % |
| orderRate | 工单及时率 | % |
| mttr / downtime | 平均修复时间 / 故障停机时长 | 小时 |
| downtimeCount / unplannedShutdowns / faultCount | 故障停机次数 / 非计划停工次数 / 故障次数 | 次 |
| newDefects / openDefects / pendingAcceptDefects | 新增缺陷（维修通知单）/ 未闭环缺陷 / 待验收缺陷 | 条 |
| overdueOrders / openOrders / pendingAcceptOrders | 超期工单 / 未闭环工单 / 待验收工单 | 张 |
| equipment / abnormal / specialEquipment / specialAbnormal | 涉及设备 / 异常设备 / 特护设备 / 特护设备异常 | 台 |
| permits / maintProjects / openLeaks / overdueLeaks / hazards / overdueHazards / events / unclosedEvents | 当日作业票 / 检修项目 / 未修复泄漏点 / 超期泄漏点 / 隐患 / 超期隐患 / 异常事件 / 未闭环事件 | 张 / 项 / 个 / 条 / 起 |

**识别顺序按特征字段独占性排列**，避免互相抢占。无法识别的 JSON 会 warning 并忽略，不中断；全部无法识别时报错。

### 2. Markdown 报表

作为已有材料记入来源，不抽取指标。

### 3. Excel 表格

**本技能不做二次统计。** 会 warning 提示先用对应的报表技能生成 JSON 再来汇报。

## 参数

| 参数 | 必需 | 说明 |
|---|---|---|
| `--input` | 是 | 数据来源 |
| `--meeting` | 是 | 会议名称与类型 |
| `--audience` | 是 | 车间 / 分厂 / 公司（中石化组织层级三档）。**无默认值**，决定详略与时间权重；旧称「设备部」「厂领导」报错 |
| `--audience-spec` | 否 | 厂内层级名称，可带 `:high|medium|low` 覆盖详略档位 |
| `--duration` | 是 | 汇报时长（分钟），须为正数 |
| `--weights` | 否 | 六个环节时间权重 `环节:权重,…`，六项齐全、和为 1 |
| `--hide-tags` | 否 | 旗标，任何层级都去位号 / 工单号 / SAP 单号 |
| `--out` | 否 | 输出目录，默认系统临时目录 `<os.tmpdir()>/mmb-out`，建议始终传 |
| `--topics` | 否 | 议题，逗号分隔。无数据支撑的议题写「需补充」 |
| `--need-decision` | 否 | 需决策事项，分号或换行分隔；公司层级或 `--hide-tags` 时同样去位号、工单号、SAP 单号（`--pending` 同理） |
| `--pending` | 否 | 上次会议遗留事项 |
| `--workshop` | 否 | 车间名，写入稿件头部 |

## 产出

| 文件 | 内容 |
|---|---|
| `汇报稿.md` | 六节完整文字稿，按听众层级控制详略 |
| `要点提纲.md` | 时间分配建议 + 要点速览 + 口头汇报提示 |
| `outline.json` | 结构化要点、指标（带来源）、问题项、时间分配（含权重与来源）、`slides` 逐页提纲（供 pptx 转换） |
| `summary.json` | 末行摘要落盘 |
