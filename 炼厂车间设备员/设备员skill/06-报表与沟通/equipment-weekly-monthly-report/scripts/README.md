# scripts 使用说明

## periodic.js —— 主脚本

```bash
node "<技能目录>/scripts/periodic.js" \
  --input "<路径>[,<路径2>...]" \
  --workshop "<车间名>" \
  --period <weekly|monthly|quarterly|yearly> \
  --from <YYYY-MM-DD> \
  --to <YYYY-MM-DD> \
  --out "<输出目录>"
```

### 参数

| 参数 | 必需 | 说明 |
|---|---|---|
| `--input` | 是 | 目录（自动扫 `*.json` / `*.xlsx`）、逗号分隔的多个路径、或单个文件；daily.json / leaks.json 与 xlsx 可混合 |
| `--workshop` | 是 | 车间（运行部）名称 |
| `--period` | 是 | `weekly` / `monthly` / `quarterly` / `yearly`；其他值报错 |
| `--from` / `--to` | 是 | 统计区间起止（YYYY-MM-DD）；`to` 早于 `from` 报错 |
| `--out` | 否 | 输出目录，默认系统临时目录 `<os.tmpdir()>/ewmr-out`，**建议始终传** |
| `--metrics` | 否 | 厂内指标口径表 xlsx（工作表「指标口径」，列 指标 / 算法，可选 分母 / 剔除封存）；文件不存在报错 |
| `--intact-denominator` | 否 | `在用` / `在册`：设备完好率分母的结构化口径；不传且台账无「在用」列 → 完好率 null |
| `--sealed` | 否 | `剔除` / `计入`：封存、长期停用设备是否剔除出分母，默认剔除 |
| `--prev` / `--yoy` | 否 | 上期 / 去年同期 `periodic.json`，环比 / 同比；文件不存在报错 |
| `--spare` | 否 | 独立的备件消耗 xlsx；文件不存在报错 |
| `--topn` | 否 | 故障频次与备件排行条数，默认 5 |

### 输入识别

| 传入 | 识别为 | 提供的内容 |
|---|---|---|
| `daily.json`（`meta.date` + `counts.equipment`） | 日报 | 覆盖天数与缺失日期、新增/未闭环/待验收缺陷、期末工单存量、`special` 节汇总为特护设备 |
| `leaks.json`（`counts.leaks` + `repaired`） | 泄漏点跟踪 | 泄漏点概况；含 `sealPoints.static/dynamic.{total,leaks}` 时算静/动密封点泄漏率 |
| xlsx「设备台账 / 技术对象」 | 设备台账 | 完好率分子分母（**须有「在用」列**）、主要设备完好率（须有「重要度 / ABC标识」列） |
| xlsx「故障记录」 | 故障 | 故障次数、故障停机次数（停机时长>0 或 是否停机=是）、按专业/类型分布、MTTR、停机时长 |
| xlsx「检修计划」 | 检修 | 计划项数、按期完成、完成率；有「检修类别」列时按 大检修 / 日常维修 / 抢修 / 专项 分列 |
| xlsx「工单台账 / 订单」 | 工单 | 应闭环、按期闭环、及时率、待验收（TECO/已完成不计闭环）、超期清单；DLFL/已取消不计 |
| xlsx「缺陷台账 / 通知单」 | 缺陷 | 未提供 daily.json 时的缺陷数据源；「已完成」归待验收 |
| xlsx「备件消耗」 | 备件 | 消耗行数、金额合计（本位币金额列可直取）、消耗排行 |
| xlsx「特护设备」 | 特护 | 逐台状态与参数 |
| xlsx「备机」 | 备机 | 备机完好率（检修中不进分子；缺「是否可投用」列且有无法判定的备机 → null） |
| xlsx「密封点统计 / LDAR」 | 密封点 | 静/动密封点泄漏率（‰） |
| xlsx「停工记录」 | 停工 | 非计划停工次数（缺「停工类别」列 → null） |

列名支持 SAP PM / EM 导出常见列名（功能位置、设备描述、ABC标识、使用状态、订单、系统状态、基本结束日期、实际结束日期、主工作中心、通知单、通知单描述、业务完成日期……）；「设备编号 / 设备」不作位号。详见 `references/input-spec.md`。

典型用法：

```bash
# 周报：一个日报目录 + 一份区间台账
node scripts/periodic.js --input "/data/日报,/data/周台账.xlsx" \
  --workshop "常减压车间" --period weekly --from 2026-09-14 --to 2026-09-20 --out /data/周报

# 月报：带厂内口径表、结构化分母口径与环比
node scripts/periodic.js --input "/data/日报,/data/月度台账.xlsx,/data/leaks.json" \
  --workshop "常减压车间" --period monthly --from 2026-09-01 --to 2026-09-30 \
  --metrics "/data/指标口径.xlsx" --intact-denominator 在用 --prev "/out/8月/periodic.json" --out /data/月报
```

### 产出

| 文件 | 内容 |
|---|---|
| `periodic.json` | `meta` / `counts` / `metrics`（含 `modes` 各指标计算方式）/ `failures` / `maintenance`（含 `byCategory`）/ `defects` / `orders` / `spare` / `special` / `standby` / `seal` / `leakPoints` / `shutdown` / `highlights` / `compare` / `dataGaps`（`missingDates`、`noDenominator`、`notProvided`、`recompute`）/ `warnings` |
| `periodic.md` | 十二节报告，含分析段占位符与末尾通用声明行，无 emoji |
| `指标表.xlsx` | 三个 sheet：指标表（含口径来源与计算方式列）、故障统计、数据缺口 |
| `summary.json` | 末行摘要落盘（含 `sections`、`recompute`、`metrics.basedOn`） |

### 退出码
- `0`：成功
- `1`：失败（缺参数、非法周期/日期/结构化口径参数、`from` 晚于 `to`、输入不存在、空目录、无任何可用数据、`--metrics`/`--prev`/`--yoy`/`--spare` 文件不存在或格式不符）

### 关键行为

1. **缺失日期不外推**：区间内没有 daily.json 的日期逐日列出，指标标注「基于 N 天数据（应为 M 天）」。
2. **完好率分母按在用**：台账缺「在用」列 → null 并说明，**不按在册算**；封存 / 长期停用 / 闲置 / 报废剔除；「在用」为空的台不计分母也不按在用默认。仅 `--intact-denominator 在册` 时按在册。
3. **厂内口径表三种结果**：算法表述与默认一致 → 照算并标「与默认算法一致」；带 分母 / 剔除封存 列或 `--intact-denominator` / `--sealed` → 按结构化口径算；算法不一致且无结构化参数 → **该指标 null 并标「需按厂内口径复算」**，绝不只换文字。
4. **待验收不计闭环**：SAP `TECO` / `CNF` / 「已完成 / 完工」归待验收单列；否定前缀（未/待/不/非）先判；`DLFL` / 已取消不计分母。
5. **未判定单列**：检修计划「已完工但缺实际完成日期」、工单「标记闭环但缺闭环时间」均不计按期。
6. **泄漏率不比对考核线**：以厂内指标为准，报告只给 ‰ 数值。
7. **非计划停工只计数不定性**：是否构成非计划停工事件按《炼化企业非计划停工管理规定》另行报送。
8. **周期与区间不匹配只 warning**，由用户确认。

## make-sample.js

```bash
node scripts/make-sample.js --out examples [--seed <n>] [--from YYYY-MM-DD] [--to YYYY-MM-DD]
```

恒定的预期结论（换 seed 只变数值，不变计数与比率）：

- `examples/daily/` 内 5 份 daily.json，区间 7 天 → **缺 2 天**；K-1601 特护 1 天异常
- 设备台账 20 台（含在用、重要度列），完好 18 → 完好率 **90.0%**；A/B 类 14 台、完好 12 → 主要设备完好率 **85.7%**
- 故障记录 8 条（动设备 5 / 静设备 2 / 电气 1），故障停机 8 次，P-1101B 故障 **3 次**居首
- 检修计划区间内 6 项、按期 3 项 → 合计 **50.0%**；大检修 0/2、日常维修 3/3、专项 0/1
- 工单应闭环 8 张、按期 5 张 → 及时率 **62.5%**
- 特护设备 2 台；备机 4 台、可投用 2 → 备机完好率 **50.0%**
- 密封点：静 5/12000 → **0.42‰**；动 1/600 → **1.67‰**；停工记录 2 条、非计划 **1** 次
- 备件 6 行，其中 1 行金额为空
- 变体 `sample-no-ledger.xlsx`（完好率分母缺失）、`sample-metrics-rules.xlsx`（厂内口径表：完好率带结构化分母列可算，检修计划完成率算法不一致 → 需复算）、`sample-sap-export.xlsx`（SAP PM 列名：在用 7 台完好 6 → 85.7%，A/B 6/6，订单应闭环 5、按期 1、待验收 1，通知单新增 4）

## selftest.js

```bash
node scripts/selftest.js
```

265 条断言，覆盖：正常路径指标计算、**缺失日期不外推**、**完好率分母缺失为 null 不是 0%**、**台账缺「在用」列不按在册算**、在用取值剔除封存、主要设备完好率（ABC标识）、**口径表算法不一致 → 需按厂内口径复算**、结构化口径参数（分母列 / `--intact-denominator` / `--sealed`）、静/动密封点泄漏率（表与 leaks.json 两路）、备机完好率、非计划停工次数、检修计划按大检修/日常维修分列（旧口径大修/中修/小修映射）、故障停机次数、SAP PM 列名（TECO 待验收不计闭环、DLFL 不计、通知单「已完成」归待验收）、特护设备（表与日报两路）、环比同比、周期不匹配 warning、未判定项、数值无法解析为 null、合计行与别名列头、产出结构（十二节、无 emoji、声明行、指标表 sheet）、`--topn`。
