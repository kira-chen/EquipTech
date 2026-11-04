# scripts 使用说明

## build.js —— 主脚本

```bash
node "<技能目录>/scripts/build.js" \
  --input "<数据来源路径[,路径2]>" \
  --meeting "<会议类型>" \
  --duration <分钟> \
  --audience <车间|分厂|公司> \
  --out "<输出目录>"
```

### 参数

| 参数 | 必需 | 说明 |
|---|---|---|
| `--input` | 是 | 上游技能 JSON、`.md` 报表或目录；逗号分隔多个 |
| `--meeting` | 是 | 会议名称与类型 |
| `--audience` | 是 | 听众层级三档 `车间` / `分厂` / `公司`。**无默认值**；旧称「设备部」「厂领导」报错 |
| `--audience-spec` | 否 | 厂内层级名称，可带详略档位：`烯烃厂设备科`、`分厂领导:low`、`车间主任:medium`。名称只作展示，`:high|medium|low` 覆盖该层级默认详略 |
| `--duration` | 是 | 汇报时长（分钟） |
| `--weights` | 否 | 六个环节的时间权重，`开场:0.05,关键指标:0.3,主要工作:0.1,存在问题:0.2,需决策:0.3,下步打算:0.05`；须六项齐全且和为 1，否则报错。不传按听众层级默认权重 |
| `--hide-tags` | 否（旗标） | 任何层级都去位号 / 工单号 / SAP 单号（保留设备名称）；作用于存在问题、主要工作，以及 `--need-decision`、`--pending` 文本（`outline.json.needDecision[].text` 也是去位号后的文本，`tagsRemoved: true` 标记）；`outline.json` 的 `issues` 原文不受影响 |
| `--out` | 否 | 输出目录，默认系统临时目录 `<os.tmpdir()>/mmb-out`，**建议始终传** |
| `--topics` | 否 | 议题，逗号分隔；无数据支撑的议题写「需补充」 |
| `--need-decision` | 否 | 需决策事项，分号或换行分隔 |
| `--pending` | 否 | 上次遗留事项 |
| `--workshop` | 否 | 车间名 |

### 默认时间权重（按层级）

| 环节 | 车间 | 分厂 | 公司 |
|---|---|---|---|
| 开场 | 0.05 | 0.05 | 0.05 |
| 关键指标 | 0.20 | 0.25 | 0.30 |
| 主要工作 | 0.30 | 0.20 | 0.10 |
| 存在问题 | 0.25 | 0.25 | 0.20 |
| 需决策 | 0.10 | 0.15 | 0.30 |
| 下步打算 | 0.10 | 0.10 | 0.05 |

### 产出

| 文件 | 内容 |
|---|---|
| `汇报稿.md` | 六节文字稿，无 emoji |
| `要点提纲.md` | 时间分配（权重 + 来源）+ 要点速览（醒目提示用「【注意】」）+ 口头汇报提示 |
| `outline.json` | `meta`（`audience`/`audienceName`/`audienceCn`/`detail`/`hideTags`/`weights`/`weightsSource`）、`metrics`（带来源）、`issues`、`keyPoints`、`needDecision`、`pending`、`noData`、`timeAllocation`、**`slides`**（逐页 `title` / `bullets` / `notes`，供 pptx 技能或工具转换，不得手写 pptx XML） |
| `summary.json` | 末行摘要落盘（含 `audienceCn`、`detail`、`weightsSource`、`slides` 页数） |

### 上游 JSON 识别

| 文件 | 来源技能 | 识别特征 | 抽取内容 |
|---|---|---|---|
| `hazard.json` | hazard-closure-tracker | `majorHazards` | 隐患总数、重大隐患、超期（`counts.total/major/overdue`）、闭环率（`metrics.closureRate`，兼容旧字段 `closeRate`）；未闭环的重大隐患进问题项，已闭环（bucket=closed，已整改且已验收）的进「主要工作」 |
| `status.json` | inspection-data-digest | `byEquipment` + `abnormal` | 设备数、异常、未判定、漏检；异常项进问题项 |
| `orders.json` | work-order-tracker | `byStatus` 或 `metrics.closeRate` | 工单总数、未闭环、超期、停滞、完成率；超期工单进问题项，责任方取 `vendor`（承修单位/工作中心），无 `vendor` 时才用 `owner` |
| `defects.json` | defect-intake-grading | `counts.byLevel` + `defects` | 新增缺陷、各等级分布 |
| `periodic.json` | equipment-weekly-monthly-report | `metrics` + `failures` + `dataGaps` | 指标键映射为中文（设备完好率 % / 静密封点泄漏率 ‰ / 大检修计划完成率 ……）；`dataGaps.recompute` 的指标与 `highlights` 进问题项；超期工单责任方写单位：`highlights[].unit` 或 `orders.overdueList[].workCenter` 有值时写工作中心，旧版只有「责任方 <责任人>」的、检修计划「责任人 <姓名>」的去掉人名并 warning；`basedOn` 数据覆盖进要点 |
| `daily.json` | equipment-daily-report | `counts` + `status` + `orders` | counts 映射为中文（当日作业票、待验收工单……）；`special.list` 中异常的特护设备进问题项 |

### 退出码
- `0`：成功
- `1`：失败（缺必填参数、非法 audience/duration/weights、输入不存在、全部无法识别）

### 四个关键行为

1. **数字不新增不修改不美化**。每个指标带 `source` 字段可追溯；`periodic.json` 中为 null 的指标保留 null，不补数。
2. **听众层级决定详略**。公司层级（或 `--hide-tags`）去位号 / 工单号 / SAP 单号保设备名，时间权重向需决策倾斜。
3. **议题无数据写「需补充」**，不编造。
4. **主要工作与下步打算不代拟**，留占位符。

### 典型链式用法

```bash
# 先用各报表技能产出 JSON
node .../periodic.js --out /tmp/week ...      # equipment-weekly-monthly-report
node .../hazard.js   --out /tmp/haz  ...      # hazard-closure-tracker

# 汇总成分厂月会材料
node scripts/build.js \
  --input /tmp/week/periodic.json,/tmp/haz/hazard.json \
  --meeting "分厂设备月会" --duration 10 --audience 分厂 --audience-spec "炼油一部设备科" \
  --need-decision "机封备件需加急采购；检修力量不足需协调" --out /tmp/mmb
```

## make-sample.js

```bash
node scripts/make-sample.js --out examples [--seed <n>]
```

生成 6 份样例：巡检汇总、工单跟踪（按 work-order-tracker 的 orders.json 结构裁剪）、隐患跟踪（按 hazard-closure-tracker 的 hazard.json 结构裁剪，闭环率字段 `metrics.closureRate`）、周报 `periodic.json`（指标键英文、1 项需复算、1 条重点事项）四个上游 JSON，外加无法识别的 JSON 与 Markdown 报表各一。

## selftest.js

```bash
node scripts/selftest.js
```

145 条断言，覆盖基础生成、数字不新增、听众层级差异（三档 + 旧称拒绝）、`--audience-spec` 名称与详略覆盖、`--weights`（生效 / 缺环节 / 和不为 1 / 未知环节 / 非数字）、`--hide-tags`、`slides` 提纲结构与不代拟、`periodic.json` / `daily.json` 中文标签映射与需复算指标进问题项（需复算指标即使上游带数也不进关键指标）、议题无数据不编造、不代拟、需决策与遗留、无法识别 JSON、隐患 JSON（按上游真实结构读 `metrics.closureRate`、兼容 `closeRate`、null 不补 0；已闭环重大隐患改列主要工作、不进存在问题）、工单责任方取承修单位不点人名（含 periodic.json 重点事项：有 `unit` / `workCenter` 写单位，只有责任人姓名的去掉并 warning）、公司层级需决策与遗留事项同样去位号、超期工单带设备名称与故障描述（公司层级去位号后仍可辨认）、内容量匹配、参数校验、表格输入提示、提纲内容、不做责任归因、无 emoji。
