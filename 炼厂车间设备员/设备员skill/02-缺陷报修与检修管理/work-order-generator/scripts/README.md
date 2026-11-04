# scripts 使用说明

## workorder.js —— 主脚本（维修通知单草稿）

> 定位：中石化体系炼化厂车间设备员在 SAP PM 创建的是**维修通知单**；维修工单（订单）、工时定额与备件由计划员/承修单位编制。本脚本只生成通知单草稿，通知单号由 SAP 生成，脚本只给草稿序号。脚本文件名沿用 `workorder.js` 以兼容既有调用。

### 接上游 defect-intake-grading（推荐）
```bash
node "<技能目录>/scripts/workorder.js" \
  --defect "<defect-intake-grading 产出的 defects.json>" \
  --applicant "<报告单位>" --due <YYYY-MM-DD> \
  --ledger "<设备台账xlsx>" --history "<历史维修记录xlsx>" \
  --out "<输出目录>"
```

### 单张（文字描述）
```bash
node "<技能目录>/scripts/workorder.js" \
  --defect "<故障描述>" --tag "<功能位置>" \
  --applicant "<报告单位>" --due <YYYY-MM-DD> \
  --out "<输出目录>"
```

### 批量（缺陷表 / SAP 通知单导出）
```bash
node "<技能目录>/scripts/workorder.js" --input "<缺陷记录xlsx>" \
  --applicant "<报告单位>" --due <YYYY-MM-DD> --out "<输出目录>"
```

### 参数

| 参数 | 必需 | 说明 |
|---|---|---|
| `--defect` | 与 `--input` 二选一 | `defects.json` 路径，或一段文字描述。传文件时必须是有效 JSON，否则报错（不静默当文字） |
| `--input` | 与 `--defect` 二选一 | 批量缺陷记录 xlsx / csv 目录，支持 SAP 通知单导出列名 |
| `--tag` | 文字描述时必需 | 功能位置（位号）；多条 JSON 输入时忽略并 warning |
| `--applicant` | **是** | 报告单位（车间），缺失报错 |
| `--due` | **是** | 要求结束日期 YYYY-MM-DD，缺失或非法报错；早于当前日期 → warning，仍生成 |
| `--ledger` | 否 | 设备台账（SAP 技术对象导出），带出设备编号/规格型号/安装位置/所属专业/投用日期；查不到位号 → warning + 标「待补充」 |
| `--history` | 否 | 历史维修记录（SAP 订单历史），附该设备近 N 次维修摘要；未提供 → 章节写「未提供历史维修记录」；既无维修日期也无维修内容的行（多为未完工工单）不列入并 warning |
| `--history-n` | 否 | 历史记录取近 N 次，默认 `3`，须为正整数 |
| `--priority` | 否 | SAP 优先级 `1~4` 或 非常高/紧急/高/中/低；**不指定时按缺陷等级推（A→1、B→2、C→3；旧 I~IV→1~4），两者都没有则判未判定，不按「3 中」默认** |
| `--notif-type` | 否 | 通知单类型 `M1/M2/M3`；不指定时按优先级推（1/2→M2 故障报告，3/4→M1 维修申请），优先级未判定则类型也未判定。厂内 M1/M2 定义可能不同，以厂内为准 |
| `--vendor` | 否 | 建议承修单位（仅建议，派工由厂内流程定） |
| `--reporter` | 否 | 报告人；不给时取缺陷记录的发现人/报告人 |
| `--workshop` | 否 | 车间名，写入报告标题 |
| `--name` / `--part` / `--medium` | 否 | 文字描述路径下补充设备名称/对象部件/介质 |
| `--out` | 否 | 输出目录，默认系统临时目录 `<os.tmpdir()>/wo-out`，**建议始终传 `--out`** |

已废止参数（传入即报未知参数）：`--prefix`、`--order-ledger`（通知单号与工单号均由 SAP 生成，脚本不编号、不避让）。

### 产出

| 文件 | 内容 |
|---|---|
| `notifications.json` | 逐张草稿（`equipment` / `fault` / `notification` / `dispatch` / `priority` / `schedule` / `history`）、`missingInfo`、`undetermined`、`counts`、`meta`（含声明行与说明行） |
| `notifications.md` | 三节报告：通知单草稿清单概览、通知单草稿正文、信息缺口清单（含未判定项）；含分析段占位符，首尾各一处说明行 |
| `notifications.csv` | SAP 通知单草稿列，带 BOM：草稿序号、通知单号(SAP生成，留空)、通知单类型、功能位置、设备编号、设备描述、通知单短文本、长文本、优先级、故障代码、对象部件、要求开始、要求结束、报告单位、报告人、缺陷登记号、建议专业归口、建议承修单位、信息待补充项 |
| `summary.json` | 末行摘要落盘 |

### 退出码
- `0`：成功，末行 `{"ok":true,...}`
- `1`：失败，末行 `{"ok":false,"error":"...","warnings":[...]}`

### 不做的事
- 不凭设备名推测规格型号与备件型号 —— 台账查不到就是 `null`，md 显示「待补充」。
- 不编造历史检修履历 —— 没记录就写「未提供历史维修记录」。
- 不替用户决定优先级 —— 无 `--priority` 且无缺陷等级时判 `undetermined`。
- 不编工单号/通知单号，不给工时与备件 —— 这些由 SAP、计划员与承修单位产生。

## lib/dispatch.js —— 通知单草稿规则引擎

可单独 require 做单元测试：
```js
const D = require('./lib/dispatch');
D.classifyPhenomenon('机封处持续滴漏');            // 'leak'
D.disciplineOf('EM-2502', '循环水泵B电机', '');     // '电气'（先于"泵"判）
D.disciplineOf('T-2401', '分馏塔', '');             // '静设备'（TT-/TI- 才归仪表）
D.decidePriority({explicit:'', defectLevel:'A 级（重大）'});
// → {priority:1, priorityCn:'1 非常高', source:'按缺陷等级 A 默认口径', ruleId:'PA', undetermined:false}
D.decidePriority({explicit:'', defectLevel:''});
// → {priority:null, undetermined:true, ruleId:'PU1', ...}
D.decideNotifType({explicit:'', priority:1});       // {type:'M2', ...}
```

口径见 `references/dispatch-rules.md`。

## make-sample.js —— 样例生成

```bash
node scripts/make-sample.js --out examples [--seed <n>] [--date <YYYY-MM-DD>]
```

主样例恒为 4 条待转通知单的缺陷（动设备 2、静设备 1、仪表 1；A 1 / B 1 / C 2），其中 1 条位号不在设备台账、2 条无历史维修记录；设备台账与历史记录用 SAP 技术对象/订单历史列名。seed 只变滴数与工作中心，不变草稿数、专业分布与边界命中。

## selftest.js —— 自测

```bash
node scripts/selftest.js
```

225 条断言：规则引擎（现象识别与 defect-intake-grading 同口径，含「温度偏高/持续上升」「高约 15℃」温升写法、专业归口顺序、SAP 优先级 1~4 与中文/旧四级映射、通知单类型、工时与备件表已删除）、文字描述路径（不自编工单号、工时备件留空、声明行与【注意】）、defects.json 对接（A/B/C 与旧四级、未判定不默认）、SAP 技术对象台账列名、SAP 订单历史列名（未完工工单行不列入历史）、已废参数报错、要求结束早于当前、批量与 SAP 通知单导出列名、产出完整性（CSV 为 SAP 通知单列、不含 EAM/工时）、参数校验、合计行与缺列缺表、位号与设备编号不混、输入已带通知单号时单列「已有通知单号」并注明勿重复创建（含 defects.json 的 sourceNo）、examples 预期计数。
