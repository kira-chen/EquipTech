# scripts 使用说明

## rollup.js —— 主脚本

```bash
node "<技能目录>/scripts/rollup.js" \
  --input "<xlsx路径>[,<路径2>...]" \
  --workshop "<车间名>" --period <YYYY-MM> \
  --out "<输出目录>"
```

完整参数示例：

```bash
node scripts/rollup.js \
  --input "缺陷与工单.xlsx,隐患台账.xlsx" --workshop 加氢车间 --period 2026-10 \
  --include-cyclic --spare "备件库存.xlsx" --template "月度检修计划申报表.xlsx" \
  --window "10月检修窗口共5天" --due 2026-09-25 --out "检修需求"
```

### 参数

| 参数 | 必需 | 说明 |
|---|---|---|
| `--input` | 是 | 一个或多个 xlsx（逗号分隔），也可传同结构 CSV 目录；需含「缺陷台账/通知单」「工单台账/订单」「周期检修项」「隐患台账」中至少一张，支持 SAP PM 导出列名 |
| `--workshop` | 是 | 车间名，写入标题与申报表「车间」列 |
| `--period` | 是 | 上报周期 `YYYY-MM`，格式或月份非法时报错 |
| `--out` | 否 | 输出目录，默认系统临时目录 `<os.tmpdir()>/mdr-out`，**建议始终传 `--out`** |
| `--include-cyclic` | 否 | 开关参数；**不加时周期性检修项一律不纳入**（文件中有该表会 warning 提示）。加了之后按下次到期日（上次检修 + 检修周期）对 `--period` 筛选：不晚于月末的纳入（早于月初的标「已超期」），晚于月末的单列「周期外周期项（本期不申报）」并 warning 写明条数，算不出到期日的照常纳入并逐条 warning |
| `--spare` | 否 | 备件库存 xlsx（支持 SAP MM 列名：物料、物料描述、非限制使用库存）；**不提供时备件到位情况一律写「未核实」，绝不默认「有库存」** |
| `--template` | 否 | 厂内上报模板 xlsx（月度检修计划申报表），按模板列名与列序输出；无法匹配的列留空并 warning |
| `--window` | 否 | 停机窗口说明（自由文本），脚本从中提「N 天」核对需停机项合计工期 |
| `--due` | 否 | 上报截止日期 `YYYY-MM-DD`，非法时报错；只写入表头，**不参与周期项到期筛选**（周期项一律按 `--period` 月末筛） |

### 产出

| 文件 | 内容 |
|---|---|
| `demands.json` | `demands`（逐条需求）、`netDemand`、`needShutdown`、`shutdownUnknown`、`spareGap`、`possibleDuplicate`、`undetermined`、`noBasis`、`linkedNotif`、`cyclicOutOfPeriod`、`template`、`counts`、`meta`（含声明行、说明行、申报对象、列头、申报周期起止 `periodStart`/`periodEnd`）、`warnings` |
| `需求汇总.md` | 八～九节申报稿，开头带声明行与说明行，含分析段占位符，提示用「【注意】」「【未判定】」；加 `--include-cyclic` 时另有附节「周期外周期项（本期不申报）」 |
| `检修需求表.xlsx` | 六张表：检修需求表（月度检修计划申报表列头）、需停机项、备件缺口、疑似重复待确认、未判定项、建议核实区；加 `--include-cyclic` 时另有第七张「周期外周期项（本期不申报）」 |
| `summary.json` | 末行摘要落盘 |

### 月度检修计划申报表默认列头

序号、车间、功能位置、设备名称、检修项目名称、检修内容、检修类别、来源、依据编号、是否停工、计划开始、计划结束、工期(天)、主要备件材料、备件到位情况、建议专业、优先级、申报理由、备注。厂内模板列名不同时用 `--template` 覆盖。

### demands.json 关键字段

| 字段 | 含义 |
|---|---|
| `demands[].basisNo` | 依据单号（缺陷编号/通知单号、工单号、周期项编号、隐患编号），**正式清单每条必有** |
| `demands[].basis` | 依据全文，含来源工作表与行号，可回溯 |
| `demands[].category` | 检修类别（建议）：抢修 / 日常维修 / 计划检修 / 专项（隐患整改）/ 专项（技改技措）；按来源与工单类型（PM01/PM02/PM03）推定 |
| `demands[].needShutdown` | `true` / `false` / **`null`（未填，绝不默认）** |
| `demands[].planEnd` | 计划结束：周期项应完成日 / 工单基本结束日期 / 隐患整改期限，取不到为 `null` |
| `demands[].dueStatus` / `overdue` | 周期项到期情况：`本期到期` / `已超期`（下次到期日早于周期月初，`overdue: true`）/ `到期日未知`（缺上次检修或周期无法解析，`overdue: null`）；其他来源为 `null` |
| `cyclicOutOfPeriod[]` / `counts.cyclicOutOfPeriod` | 下次到期日晚于 `--period` 月末的周期项（含下次到期日、出处），**不进 demands，本期不申报**；`counts.cyclicOverdue`、`counts.cyclicDueUnknown` 分别为已超期、到期日算不出的纳入条数 |
| `demands[].durationDays` | 预计工期天数；「72小时」这类、或表头带小时单位（「预计工期(h)」）的纯数字按 24 小时折天；无法解析为 **`null`**，绝不按 0 |
| `demands[].spareState` | `none` 无备件需求 / `ok` 到位 / `short` 不足 / **`unverified` 未核实或未判定** |
| `demands[].priority` | 1 紧急 / 2 高 / 3 中 / 4 低 / **`null` 未判定**（工单无等级、周期项、管理层级写法的隐患等级都不默认） |
| `undetermined[]` | 未判定项：`kind` 为 `priority`（优先级）/ `spareQty`（需求数量）/ `status`（状态无法判断是否闭环，未纳入正式清单）/ `shutdown`（是否停工未填） |
| `counts.skippedDone` | 状态为「已完成/完工/TECO」（待验收）的条数，本期不重复申报 |
| `counts.linkedNotif` / `linkedNotif[]` | 已转工单的通知单（工单「通知单号」对应，去前导零再比）：按工单申报一次、不再单列，工单缺的等级/停机/工期/备件/描述/专业沿用通知单；`orderState` 为「已完工待验收」或「已闭环」的本期不申报 |
| `demands[].notifNo` | 工单需求对应的通知单号（工单表无「通知单号」列时为 `null`） |
| `netDemand.netIfAllMerged` | 「若疑似重复全部确认合并」的条数**下界**，不是已合并结果 |
| `noBasis` | 无依据项，**未进正式清单**，只作建议核实区 |
| `possibleDuplicate` | 疑似重复对，**两条均保留在正式清单中**，待用户确认 |

### 退出码
- `0`：成功，末行 `{"ok":true,...}`，同时写 `<out>/summary.json`
- `1`：失败，末行 `{"ok":false,"error":"...","warnings":[...]}`

### 会报错终止的情形
- 缺 `--input` / `--workshop` / `--period`，或值参数缺取值、未知参数
- `--period` 非 `YYYY-MM` 或月份非 01~12；`--due` 非法日期
- `--input` / `--spare` / `--template` 路径不存在
- 输入中找不到四类来源工作表中的任何一张
- 各来源中没有任何未闭环需求项（全部已闭环/已取消；或周期项全部在周期外，错误信息列出周期外条数与到期日）
- **全部需求项都无依据单号**（正式清单会为空；若另有状态未判定项则不报错，只 warning）

## make-sample.js —— 样例生成

```bash
node scripts/make-sample.js --out examples [--seed <n>] [--period <YYYY-MM>]
```

主样例恒定结论（`--seed` 只改滴数、工期等数值细节，不改结论）：
不含周期项时正式清单 10 条（缺陷 4 + 工单 4 + 隐患 2）、无依据 1 条、疑似重复 1 组、需停机 4 项、停机未填 1 项、优先级未判定 2（无等级工单 + 「B级」隐患）、已完成工单 1 条不重复申报；
加 `--include-cyclic`（`--period 2026-10`）后正式清单 12 条（周期项 ZQ-001、ZQ-003 本期到期）、需停机 5 项、优先级未判定 4；ZQ-002（1年，上次 2025-11-10 → 2026-11-10）晚于周期末，单列周期外 1 条。
SAP 导出样例（`sample-sap-export.xlsx`）：通知单 2 条 + 订单 2 条纳入，NOCO 已闭环与 TECO 待验收不纳入，PM03→抢修、PM02→计划检修。

## selftest.js —— 自测

```bash
node scripts/selftest.js
```

255 条断言：多源合并、疑似重复不自动合并、备件未核实口径（写了型号只按型号查；来源表无备件列判需求未知，不判「无备件需求」）、无依据不进正式清单、模板列名匹配（申报表列头）、需停机与窗口、优先级排序、参数校验与空输入、产出完整性（六张表、声明行与说明行）、数值与表头识别、多文件与专业归属、四处默认填补改未判定（工单无等级/周期项/需求数量/状态）、待验收不重复申报、隐患台账来源（重大→紧急、管理层级写法不映射、已销号不纳入）、SAP 通知单/订单列名与检修类别、申报表列头、口径用语（公司设备管理部门）、默认输出目录、通知单↔工单配对沿用备件/描述/专业与 CLSD 工单、通知单号前导零、同型号多库位合计、表头带小时单位、设备资产管理系统导出形态（工期小时折天、工单「通知单号」配对不重复申报）、周期项按申报周期筛到期（周期外单列不申报、已超期标注、到期日算不出照常纳入并 warning、给了 --due 仍按周期末、md/xlsx 单列周期外）、examples 预期计数。全绿退出 0。

## lib/

`lib/common.js` 与 `lib/xlsx-lite.js` 为技能包共用工具，各技能直接复制使用，**不要单独改动**。
