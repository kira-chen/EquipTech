# scripts 使用说明

## daily.js —— 主脚本

```bash
node "<技能目录>/scripts/daily.js" \
  --input "<路径>[,<路径2>...]" \
  --workshop "<车间名>" \
  --date <YYYY-MM-DD> \
  --out "<输出目录>"
```

### 参数

| 参数 | 必需 | 说明 |
|---|---|---|
| `--input` | 是 | 一个或多个路径，可混合 xlsx / CSV 目录与上游技能 JSON |
| `--workshop` | 是 | 车间（运行部）名称 |
| `--date` | 是 | 日报日期 YYYY-MM-DD |
| `--out` | 否 | 输出目录，默认系统临时目录 `<os.tmpdir()>/edr-out`，**建议始终传** |
| `--prev` | 否 | 上一日 `daily.json`，用于环比 |
| `--shift` | 否 | 值班信息（设备员值班人，不是操作班组班次） |
| `--plan` | 否 | 次日计划文本或文件路径；未提供时不代拟 |

### 上游 JSON 自动识别

| 传入 | 来源技能 | 识别特征 | 提供章节 |
|---|---|---|---|
| `status.json` | inspection-data-digest | `byEquipment` + `abnormal` | 一、设备状态（有 `counts.sixTier` 取六档；旧版仅运行/异常/未判定三档，备用/检修/停用写未提供并 warning）；二、特护设备（`byEquipment[].special`） |
| `orders.json` | work-order-tracker | `byStatus` 或 `metrics.closeRate` | 四、工单执行（待验收取 `counts.pendingAccept` 或 `byStatus['待验收']`） |
| `defects.json` | defect-intake-grading | `defects` + `counts.byLevel` | 三、新增缺陷 |
| `leaks.json` | leak-point-tracker | `counts.leaks` + `repaired` | 六、泄漏点 |
| `hazard.json` | hazard-closure-tracker | `majorHazards` | 七、隐患 |

典型链式用法：
```bash
node scripts/daily.js --input /tmp/insp/status.json,/tmp/ord/orders.json,/tmp/def/defects.json,/tmp/lpt/leaks.json,/tmp/hz/hazard.json \
  --workshop "常减压车间" --date 2026-09-21 --out /tmp/edr
```

### xlsx 工作表（sheet 名包含匹配）

巡检汇总 / 特护设备 / 缺陷台账（通知单） / 工单台账（订单） / 作业票（作业许可、作业票清单、以「作业清单」开头的表；「检修作业清单」不算） / 泄漏点（漏点、密封点、LDAR） / 隐患台账 / 异常事件 / 检修进度。列名别名见 `references/input-spec.md`，含 SAP PM / 智能巡检 / 作业许可系统导出列名。

### 口径要点

- 设备状态六档：运行 / 备用 / 检修 / 停用 / 异常 / 未判定。空值或无法归档 → 未判定，不计运行。
- 缺陷与工单状态按 SAP 六态归一；「已完成 / 完工 / TECO / 技术完成」归**待验收**单列，不算闭环；否定前缀（未/待/不/非）先判；已取消不计。
- 作业票「动火」统一显示为「用火」；级别以票面为准，脚本不自判；属地监护人未填仅计数提示。
- 隐患等级只认「重大隐患 / 一般隐患」（HSE 平台的「重大 / 一般」同样识别）；「A/B/C 级」不映射（多为管理层级），原文展示并 warning；无整改期限 → 未判定，不默认天数；完成态（已整改 / 已完成 / 已销号 / 已处理等，词表与 hazard-closure-tracker 同口径）有验收记录计已闭环，无验收记录单列已整改未验收，不判超期；验收情况「验收未通过 / 否 / 不合格」等不算通过；验收人、验收日期独立读列，验收情况为空时填了任一项即算有验收记录。
- 泄漏率不在日报核算（周报月报核算），日报只列点数；表输入不算修复率，修复率来自 leaks.json。

### 产出

| 文件 | 内容 |
|---|---|
| `daily.json` | 各章节数据与 counts，供周报月报使用；`meta.stateScheme` 记录六档；`meta.workshopScope` 各表车间范围核对结果（数组）；`meta.upstreamWorkshop` 上游 JSON 车间核对（`matched` / `unknown` / `excluded`） |
| `daily.md` | 十节（有环比时十一节）报告，末尾声明行，无 emoji |
| `summary.json` | 末行摘要落盘（含 `sections` 节数） |

### 退出码
- `0`：成功
- `1`：失败（含无任何可用数据、非法日期、输入不存在、上一日 daily.json 不存在）

**关键行为**：未提供的章节 counts 为 `null`（不是 0），报告写「本日未提供 XX 数据」。「无异常」与「未提供数据」严格区分。

**车间范围核对**：九张业务表带车间列（车间 / 所属车间 / 属地车间 / 运行部）时按 `--workshop` 剔除其他车间的行并 warning，车间列为空的行保留；车间列全不一致时不筛、日报开头【注意】；无车间列时口径写「以取数条件为准」；维护工厂与「车间监护人」等人员列不当车间列。上游 JSON（含 `--prev`）`meta.workshop` 不一致的不纳入并在开头【注意】，未注明车间的照常纳入并说明无法核对。规则见 `references/input-spec.md`「车间范围核对」。

## make-sample.js

```bash
node scripts/make-sample.js [--seed <n>] [--date <YYYY-MM-DD>]
```

主样例恒为：10 台设备（运行 5 / 备用 1 / 检修 1 / 停用 1 / 异常 2 / 未判定 0，特护 1 台）、3 条新增缺陷、5 条未闭环缺陷（1 待验收）、6 张工单（2 超期、1 待验收）、4 张作业票、3 个泄漏点（2 未修复、1 超期）、3 条隐患（1 重大、1 超期）、2 条异常事件（1 未闭环）、3 个检修项目。seed 只改检修完成比例与特护参数数值。
另产出 `sample-sap-export.xlsx`（SAP PM / 智能巡检列名）、`sample-inspection-only.xlsx`、`sample-bad-percent.xlsx`、`upstream/*.json`（五个上游技能 JSON 样例）。

## selftest.js

```bash
node scripts/selftest.js
```

235 条断言，覆盖车间范围核对（九张表混合剔除、车间列为空保留、全不一致不筛并开头【注意】、无车间列、维护工厂与车间监护人不当车间列、「所属车间」可识别；上游 JSON 一致纳入 / 不一致不纳入 / 未注明照常纳入、顶层 workshop、带 meta.workshopScope 照常读取、`--prev` 车间不一致不做环比）、全量 xlsx、缺数据不补零、五类上游 JSON 对接与合并（含 status.json 六档 `sixTier` 与特护标记）、六档状态、待验收单列、特护设备、作业票术语、泄漏点、隐患等级与未判定、SAP 列名（设备编号不是位号）、HSE 平台隐患台账与作业票系统作业清单列名（整改状态、要求整改期限、已整改未验收；完成态与验收态判定与 hazard-closure-tracker 同口径：完成词开头归已整改、否定写法归未整改、无验收记录不计闭环；验收人/验收日期独立列）、「检修作业清单」不当作业票、完成比例异常值、环比、次日计划不编造、参数校验、产出结构与声明行、别名与合计行。
