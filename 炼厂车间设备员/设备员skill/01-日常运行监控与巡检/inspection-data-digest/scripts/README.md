# scripts 使用说明

## digest.js —— 主脚本

```bash
node "<技能目录>/scripts/digest.js" \
  --input "<xlsx路径>[,<xlsx路径2>...]" \
  --workshop "<车间名>" \
  --date <YYYY-MM-DD> \
  --out "<输出目录>"
```

### 参数

| 参数 | 必需 | 说明 |
|---|---|---|
| `--input` | 是 | 一个或多个 xlsx 路径（逗号分隔），或同结构 CSV 目录 |
| `--workshop` | 是 | 车间（运行部）名称 |
| `--date` | 是 | 汇总日期 YYYY-MM-DD（有 `--shift-window` 时为班次日） |
| `--out` | 否 | 输出目录，默认系统临时目录 `<os.tmpdir()>/idd-out`；**建议始终传 `--out`** |
| `--ledger` | 否 | 设备台账 xlsx（可直接用 SAP PM 技术对象清单：功能位置/设备/技术对象描述/ABC标识），用于识别漏检与特护标记；不提供则漏检为 null |
| `--prev` | 否 | 上一日 status.json，用于状态变化对比 |
| `--shift` | 否 | 班次说明，仅写入报告头部 |
| `--shift-window` | 否 | 班次日起算时刻 `HH:MM`（如 `08:00`）：记录时刻早于该时刻的归前一班次日，夜班跨 0 点记录不丢；不给则按自然日 |
| `--source-type` | 否 | `auto`（默认，按工作表名识别）/ `patrol` 操作工巡检 / `spotcheck` 专职点检 / `monitor` 状态监测；工作表名无法识别时把未识别的表按此类型读取 |

### 判定依据（逐行，按优先级）

1. 「检查结果」列（无异常/未见异常/无泄漏/Running/OK 为正常，NG 按单词边界）
2. 「是否报警」列（是/Y/1/报警/超限/H/L → 异常；否/N/0/正常/无 → 正常）
3. 「测值」对「上限/下限」（高报/低报列）
4. 「运行状态」列值本身是正常/异常措辞时

四者都没有 → 该设备**未判定**，不默认。同一位号多行（一行一检查项）按位号聚合，任一检查项异常则设备异常；没有异常项但有检查项未判定（如「待查」）→ 设备未判定（`unknownState[].partial: true`，`pendingItems` 列出未判定的检查项），不判正常，warning 点名。

### 产出

| 文件 | 内容 |
|---|---|
| `status.json` | `meta`（来源、判定依据、shiftWindow）、`counts`（records/equipment/normal/abnormal/unknown/missed/conflicts/changed/special/specialAbnormal/sixTier）、`byEquipment`、`abnormal`、`missed`、`conflicts`、`unknownState`、`changed`、`warnings` |
| `digest.md` | 七节报告 + 附数据提示 + 声明行，分析段留 `<!-- ANALYSIS_START/END -->` 占位；醒目提示用「【注意】」，不用 emoji |
| `summary.json` | 末行摘要落盘（Windows 控制台乱码兜底） |

### 退出码
- `0`：成功，末行输出 `{"ok":true,...}`
- `1`：失败，末行输出 `{"ok":false,"error":"...","warnings":[...]}`

## make-sample.js —— 样例生成

```bash
node scripts/make-sample.js --out examples [--seed <n>] [--date <YYYY-MM-DD>]
```

生成 5 份样例：主样例（智能巡检明细 + 点检仪数据 + 状态监测三来源，系统导出列名）、SAP PM 风格设备台账、仅巡检明细变体、系统导出风格变体（标题行/别名列头/合计行/跨日）、夜班跨 0 点变体。
seed 改变数值但不改变结论：主样例恒为 8 台设备、2 异常（其中 1 台特护）、1 冲突、1 未判定，配台账恒 2 漏检（其中 1 台特护）。

## selftest.js —— 自测

```bash
node scripts/selftest.js
```

135 条断言，覆盖：三来源合并、就严冲突（定位到检查项）、未判定、漏检有无台账、跨日跳过、合计行、空位号、参数校验、状态变化、多文件、产出结构、结果归一（无异常/Running 为正常）、一行一检查项聚合、是否报警与测值对限值判定、备注不作异常描述、班次日归属、`--source-type`、六档状态、特护标记（特护列为准，重要度 A/关键不算特护，台账特护补到异常清单，表头恰好为「特护」时不被重要度列抢走）、SAP 列名别名合并、声明行与无 emoji、部分检查项「待查」且无异常项时整机判未判定。全绿退出 0。
