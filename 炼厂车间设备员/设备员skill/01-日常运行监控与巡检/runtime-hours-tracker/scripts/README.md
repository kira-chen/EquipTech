# scripts 使用说明

## runtime.js —— 主脚本

```bash
node "<技能目录>/scripts/runtime.js" \
  --input "<启停/状态/运行记录 xlsx>" \
  --workshop "<车间名>" \
  --date <YYYY-MM-DD> \
  --out "<输出目录>"
```

### 参数

| 参数 | 必需 | 说明 |
|---|---|---|
| `--input` | 是 | 含「启停记录」「运行状态记录」或「运行记录」工作表的 xlsx（或 CSV 目录）；可另含「阈值表」（别名：阈值、周期阈值、检修周期） |
| `--workshop` | 是 | 车间（运行部）名称 |
| `--date` | 是 | 统计截止日期（日历周期阈值按此日算已运行天数） |
| `--out` | 否 | 输出目录，默认系统临时目录 `<os.tmpdir()>/rht-out`，**建议始终传** |
| `--from` | 否 | 统计起始日期，仅写入报告头部；晚于 `--date` 时报错 |
| `--prev` | 否 | 上期 `runtime.json`，累计续算（与阈值表「期初累计小时」同时给时以 `--prev` 为准并 warning） |
| `--equipment` | 否 | 限定位号，逗号分隔；范围内无记录时报错 |
| `--warn-ratio` | 否 | 接近阈值的预警比例，默认 0.9，须在 0~1 之间 |

### 产出

| 文件 | 内容 |
|---|---|
| `runtime.json` | `meta`、`counts`、`items`、`byEquipment`、`exceeded`、`dueSoon`、`undetermined`、`incomplete`、`warnings` |
| `runtime-report.md` | 七节报告（概览 / 逐台明细 / 已超阈值 / 接近阈值 / 未判定项 / 数据缺口 / 统计说明）+ 附：数据提示 |
| `summary.json` | 末行摘要落盘（含 `counts`、`items`、`warnings`） |

### 供下游（lubrication-manager `--run-hours` 等）读取的字段

`runtime.json` 与 `summary.json` 都带 `items[]`，一行一台：

| 字段 | 含义 |
|---|---|
| `tag` | 位号（功能位置） |
| `name` | 设备名称 |
| `code` | SAP 设备编号（流水号），无则 null |
| `cumulativeHours` | 累计运行小时（期初累计 + 本期增量，或上期续算）；本期不可算时为期初/上期值，无期初无上期时为 null |
| `cumulativeBasis` | `base` 期初+本期 / `prev` 上期续算 / `periodOnly` 仅本期增量（不代表自上次大检修累计） |
| `periodHours` | 本期运行小时，不可算为 null |
| `cumulativeStarts` | 累计启停次数 |
| `asOf` | 统计截止日期 |

### `byEquipment[].thresholds[]` 字段

`kind`（hours 运行小时 / starts 启停次数 / calendar 日历周期 / null 未判定）、`threshold`（小时或次数；日历为总天数）、`thresholdText`（原文如 `3年`）、`current`（累计值；日历为已运行天数）、`remain`、`used`（0~1）、`dueDate`（日历周期到期日，按自然月）、`basis`（rowBase 该行期初+本期 / base / prev / periodOnly / calendar）、`state`（exceeded / dueSoon / normal / undetermined）、`note`（未判定原因）。

### 退出码
- `0`：成功
- `1`：失败（无记录表、非法日期、非法预警比例、范围内无记录、上期 JSON 不存在）

### 关键行为

1. **累计 = 期初累计 + 本期增量**。「期初累计小时」（上次大检修后累计）写在阈值表里，可按部件分行（轴承、机械密封各自归零）；无期初、无 `--prev` 时累计仅为本期增量，概览与 warning 明示，不伪装成自上次大检修累计。
2. **三类阈值分开判**。运行小时（`8000`、`24000h`）、启停次数、日历周期（`3年`、类型写"日历周期（年）"+ 数字）。日历周期按自然月（`addMonths`）算到期日，需「上次归零日期」；运行小时与日历周期是两个维度，同一机组可各有一条。
3. **阈值类型为空不默认按运行小时**。取值带单位（`24000h`、`3年`）可自动归类；无单位 → 未判定单列。
4. **不配对不补停机**。只有开机无停机、时序末条为运行的段不计入累计，单列说明。
5. **重叠不去重**。两段运行区间重叠时原样累加并提示核实。
6. **停机间隔不是数据缺口**。两段运行之间的正常停机不报警。
7. **阈值缺失不预警**。未提供阈值表、阈值无法解析、累计值为 null，都不预警而非按默认值处理。
8. **SAP PM / EM 列名**：功能位置 → 位号；「设备」（8 位流水号）→ 设备编号单列展示，不当位号；设备描述 → 设备名称。

## make-sample.js

```bash
node scripts/make-sample.js --out examples [--seed <n>]
```

主样例恒 6 台设备：2 项超阈值、2 项接近阈值（含 1 项日历周期）、2 项未判定、1 条不配对、1 组重叠、1 处正常停机间隔。另有无阈值表、运行记录（带单位）、SAP 导出列名、运行状态时序四个变体。

## selftest.js

```bash
node scripts/selftest.js
```

156 条断言，覆盖基础累计、阈值列不冲突、不配对不补停机、时间倒序、重叠不去重、停机间隔不误报、阈值缺失不预警、累计续算、运行记录形式、预警比例、设备过滤、参数校验、声明行、别名与合计行、期初累计（设备级/部件级/与 --prev 并存）、日历周期（到期日、临期、缺归零日期未判定、与运行小时两维度）、阈值类型为空与裸「类型」列、SAP PM 列名与设备编号不当位号、运行状态时序折算、带单位数值、术语与声明、默认输出目录。
