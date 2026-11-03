# scripts 使用说明

## handover.js —— 主脚本

```bash
node "<技能目录>/scripts/handover.js" \
  --input "<本次记录xlsx>" \
  --workshop "<车间名>" \
  --type <值班交接|休假交接|调岗交接> \
  --time <ISO 8601 带时区> \
  --by "<交接人>" \
  --out "<输出目录>"
```

### 参数

| 参数 | 必需 | 说明 |
|---|---|---|
| `--input` | 是 | 本次记录 xlsx（可逗号分隔多个），或同结构 CSV 目录；须含「值班记录 / 工作记录 / 本次记录」（旧名「本班记录」仍可识别）工作表 |
| `--workshop` | 是 | 车间（运行部）名称 |
| `--type` | 是 | 交接类型：`值班交接` / `休假交接` / `调岗交接`；其他取值（如「夜班交接班」）报错——操作班组交接班不在本技能范围 |
| `--time` | 是 | 交接时点，**必须为带时区的 ISO 8601**，如 `2026-09-21T17:00:00+08:00`；「今天下午」这类模糊表述直接报错 |
| `--by` | 是 | 交接人 |
| `--to` | 否 | 接手人；不提供时记录中写「待明确」 |
| `--shift` | 否 | 值次说明（如「10月26日值班」「国庆假期」），仅作标签展示 |
| `--out` | 否 | 输出目录，默认系统临时目录 `<os.tmpdir()>/shr-out`，**建议始终传** |
| `--prev` | 否 | 上次交接记录：本脚本产出的 `handover.json`，或含「未完成事项」表的 xlsx。**不提供则无法核对遗留事项闭环，须人工核对上次交接记录** |
| `--inrepair` | 否 | 在修设备清单 xlsx（含「在修设备」表）；不提供时取本次记录文件中的「在修设备」表与「在修」类事项 |

### 产出

| 文件 | 内容 |
|---|---|
| `handover.json` | `meta`（`skill: 'shift-handover-record'`、`type`、`shift`、`handoverAt`、`declaration`）、`statusChanges`、`abnormalHandled`、`inRepair`、`pending`、`carriedOver`、`prevClosed`、`focusItems`、`undetermined`、`statusUndetermined`、`counts` |
| `handover.md` | 九节工作交接记录（无未判定事项时第七节省略），交接说明段留 `<!-- ANALYSIS_START/END -->` 占位，无 emoji |
| `summary.json` | 末行摘要落盘（含 `type`） |

### 与 worklog-todo-manager 的约定

`handover.json` 满足 `meta.skill === 'shift-handover-record'` 且 `pending` 为数组，worklog-todo-manager 据此识别为「工作交接」来源，把 `pending[]` 逐条纳入待办：读取 `tag / name / content / state / owner / due / dueText / handling / originShift / carryTimes / sheet / row`，期限原样保留、不改写；期限已过的按 P1，其余 P2。

### 结转规则（核心）

上次交接 `pending` 中的每一条，都会在本次记录中按「位号 + 内容相似度」寻找对应处理记录：

| 情形 | 处理 |
|---|---|
| 本次有记录且已闭环 | 不结转，计入 `prevClosed`（`closed: true`） |
| 本次有记录但未闭环 | 结转，标注「上次交接遗留，本次已跟进但未闭环」，**来源记回最初那次交接** |
| 本次无对应记录 | **原样结转**，标注「上次交接遗留，本次未处理」 |

结转项一律保留 `originShift`（最初来源交接）与 `originDue`（原始要求完成时间），**不自动延期**；`carryTimes` 记录累计结转次数，连续多次交接未闭环时，第三次交接仍能看到第一次的遗留项与其原始期限。

### 完成状态口径

「状态」列除中文写法外，认 SAP 系统状态 / 通知单状态（复用 `common.js` 的 `normSapStatus`，口径同中石化口径对照）：

| SAP 状态 | 归一 | 交接处理 |
|---|---|---|
| CLSD、NOCO（已关闭、已验收、已消缺） | 已闭环 | 已完成，不进未完成事项 |
| TECO、CNF（技术完成、完工待验、待验收） | 待验收 | **不算闭环**，进未完成事项，`state` 为「未完成（待验收）」 |
| CRTD、OSNO / REL、NOPR / PCNF | 待审核 / 已派工 / 施工中 | 未完成，`state` 为「未完成（已派工）」等 |
| DLFL、LKD、已删除 | 已取消 | 不默认销账，列入状态未判定，由交接双方确认 |

多码组合（如 `REL CNF`）取最靠后的状态。「要求完成时间已过」统一按北京时间 +08:00 解析，与主机时区无关。

### 列名

局部别名优先，再合并中石化常用系统导出列名：功能位置→位号（「设备 / 设备编号」是 SAP 流水号，不作位号）、设备描述→设备名称、通知单描述→内容、订单 / 通知单→工单号、系统状态→当前状态、基本结束日期→要求完成时间 / 预计完工、主工作中心→责任人。详见 `references/input-spec.md`。

### 退出码
- `0`：成功，末行输出 `{"ok":true,...}`
- `1`：失败，末行输出 `{"ok":false,"error":"...","warnings":[...]}`

## make-sample.js —— 样例生成

```bash
node scripts/make-sample.js --out examples [--seed <n>] [--date <YYYY-MM-DD>]
```

生成 4 份样例：主样例（值班记录 + 在修设备）、上次交接记录（未完成事项表，含「来源交接」列）、极简变体（工作记录，缺责任人、缺在修表）、EM/SAP 导出风格变体（标题行 + 功能位置/设备描述/订单 列名 + 合计行）。
seed 改变数值但不改变结论：主样例恒为 3 项状态变化、5 项异常处理（2 已闭环）、2 台在修、5 项未完成、1 项类型未归类、1 项状态未判定；配上次交接样例（`--prev`）恒为 2 项结转（1 项本次未处理、1 项本次跟进未闭环），未完成事项 6 项（多出的 1 项是本次未处理的结转项）。

## selftest.js —— 自测

```bash
node scripts/selftest.js
```

157 条断言，覆盖：事项分类、SAP 状态码归一（CLSD/NOCO 闭环、TECO/技术完成待验收不算闭环、OSNO/REL/CRTD 未完成、DLFL 与中文「已删除」未判定、多码组合）、「要求完成时间已过」在 TZ=UTC 等非东八区主机下按北京时间判定、make-sample 主样例结论（5 项未完成，带 --prev 6 项）、结转三条路径、连续三次结转（值班→休假→调岗）、责任人/期限缺失写「待明确」、`--time` 强校验、`--type` 三种取值与「交接班」拒绝、`--shift` 可选、`meta.skill` 与 `pending` 数组约定、worklog 读取字段齐全、SAP/EM 列名（功能位置/设备描述/订单/通知单描述/基本结束日期，「设备」流水号不作位号）、在修无状态说明 warning、未判定单列、合计行与别名列头、参数校验、声明行、术语（不含「交接班」「上班次」、无 emoji、「【注意】」提示）与产出结构。全绿退出 0。
