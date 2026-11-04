# scripts 使用说明

## consumption.js —— 主脚本

```bash
node "<技能目录>/scripts/consumption.js" \
  --input "<出库记录xlsx>" \
  --workshop "<车间名>" \
  --from <YYYY-MM-DD> --to <YYYY-MM-DD> \
  --out "<输出目录>"
```

### 参数

| 参数 | 必需 | 说明 |
|---|---|---|
| `--input` | 是 | 出库记录 xlsx 或 CSV 目录；工作表可为「出库记录」或 SAP MB51「物料凭证」，列名按局部别名 + 共享 `SYSTEM_ALIASES` 识别 |
| `--workshop` | 是 | 车间名称 |
| `--from` / `--to` | 是 | 统计区间 |
| `--out` | 否 | 输出目录，默认输入文件同目录下 `spc-out/`；**建议始终传 `--out`** |
| `--price` | 否 | 单价表，折算金额。出库记录有「本位币金额」列时该列优先，单价表只补金额为空的记录；**两者都无则不折算** |
| `--ledger` | 否 | 设备台账，按设备类型归类并补设备名 |
| `--prev` | 否 | 基期数据：上期 `consumption.json`，或上期出库表 xlsx（此时必须给 `--prev-from/--prev-to`） |
| `--prev-from` / `--prev-to` | 否 | 基期起止。与 `--prev`（xlsx）配合，或单独给出时在同一 `--input` 导出里切基期；基期不得与本期重叠 |
| `--by` | 否 | 排行维度 equipment / part / month，默认 equipment |
| `--top` | 否 | 排行条数，默认 10 |
| `--anomaly-ratio` | 否 | 异常增长倍数阈值，默认 2，须大于 1 |

### 产出

| 文件 | 内容 |
|---|---|
| `consumption.json` | 各维度分组、排行、异常增长、`newInPeriod`（基期没有该编码、或该编码基期全部单位数量为 0，本期新出现的备件，不计入异常）、`unitMismatch`（基期有该编码消耗、只是单位不同，两期不可比）、未归属、counts（含 `reversals`、`newInPeriod`、`unitMismatch`）、`compare.prevSource`、`meta.amountSource` |
| `consumption.md` | 八到九节报告 |
| `消耗统计表.xlsx` | 按设备 / 按备件 / 按月份 / 未归属 四张表 |
| `summary.json` | 末行摘要落盘 |

### 退出码
- `0`：成功
- `1`：失败（输入不存在、无出库记录表、区间内无记录、非法参数）

### 四个关键行为

1. **单位不换算**。不同单位分别统计，`byUnit` 数组分行输出。
2. **未归属不平摊**。位号为空的记录单列，不分摊也不排除。
3. **无单价不折算**。不使用任何估计单价。
4. **异常增长按区间归一**。两期天数不同时比日均，避免「3个月 vs 1个月」得出虚高倍数。基期没有该编码（或该编码基期全部单位数量都为 0）、本期新出现的备件没有倍数可算，单列 `newInPeriod` 并在异常节列出，不计入异常、也不静默漏掉；基期有该编码消耗、只是单位不同的单列 `unitMismatch`，写「两期单位不同、不可比」，不换算、不算新出现；基期整段无记录时都不列。未提供基期时均为 null。

### 中石化口径（脚本行为）

- **MB51 列名**：物料 / 物料描述 / 基本计量单位 / 过账日期 / 数量 / 移动类型 / 本位币金额 / 订单 / 成本中心 / 功能位置 直接识别；「设备编号」不作位号别名。
- **移动类型**：261/201/221/281/291/601 发料计正；262/202/222/282/292/602 冲销按负数抵减数量与金额；101 收货、311 转储等不计入消耗；各 warning 一次。无移动类型列时全部按消耗计。
- **金额来源**：有「本位币金额」列直接取用（优先，冲销计负），不再乘单价；单价表只补该列为空的记录；两者都无则不折算、不用估计单价。`meta.amountSource` 与 md 概览写明来源。
- **基期三种取法**：`--prev x.json`（上期产出）/ `--prev 上期.xlsx --prev-from --prev-to` / 仅 `--prev-from --prev-to`（同一导出切基期）；md 异常节写明基期来源。

### 典型链式用法

```bash
# 先算上期基线
node scripts/consumption.js --input 上期出库.xlsx --workshop 常减压车间 \
  --from 2026-04-01 --to 2026-06-30 --out /tmp/prev

# 本期对比
node scripts/consumption.js --input 本期出库.xlsx --workshop 常减压车间 \
  --from 2026-07-01 --to 2026-09-30 --price 单价表.xlsx \
  --prev /tmp/prev/consumption.json --out /tmp/cur

# 首次使用：同一份 MB51 导出里切基期（4~6 月为基期，7~9 月为本期）
node scripts/consumption.js --input MB51导出.xlsx --workshop 常减压车间 \
  --from 2026-07-01 --to 2026-09-30 --prev-from 2026-04-01 --prev-to 2026-06-30 --out /tmp/cur
```

## make-sample.js

```bash
node scripts/make-sample.js --out examples [--seed <n>]
```

主样例恒 28 条：3 条未归属、2 条数量未填、5 种单位、跨 3 个月，另含上期基线样例（机封本期为上期数倍，触发异常增长），以及 SAP MB51 变体 `sample-sap-mb51.xlsx`（同一导出含 4~6 月基期与 7~9 月本期、262 冲销行、101 收货行、本位币金额列、无金额无位号的螺栓行）。

## selftest.js

```bash
node scripts/selftest.js
```

127 条断言，覆盖基础统计、未归属不平摊、单位不换算、数量未填不按 0、无单价不折算、异常增长与区间归一、台账归类、参数校验、别名与合计行、产出完整性，以及中石化口径：MB51 列名命中（物料/过账日期/功能位置/成本中心）、101 收货不计、262 冲销按负数抵减数量与金额、本位币金额列优先且单价表只补空值、无金额记录为 null、同一导出切基期、`--prev` 接上期 xlsx、基期参数校验（缺 from/to、倒置、重叠、非法日期）、基期无记录只 warning、基期无消耗本期新出现的备件单列 newInPeriod（不计入异常，基期整段无记录时不列）、两期单位不同单列 unitMismatch 不算新出现、「设备编号」不作位号、无 emoji。
