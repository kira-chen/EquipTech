# scripts 使用说明

## inspection.js —— 主脚本

```bash
node "<技能目录>/scripts/inspection.js" \
  --input "<特种设备台账xlsx路径>" \
  --workshop "<车间名>" \
  --date <YYYY-MM-DD> \
  --out "<输出目录>"
```

### 参数

| 参数 | 必需 | 说明 |
|---|---|---|
| `--input` | 是 | 特种设备台账 xlsx 路径，或同结构 CSV 目录 |
| `--workshop` | 是 | 车间名称 |
| `--date` | 是 | 基准日期 YYYY-MM-DD，到期与超期均相对此日计算 |
| `--out` | 否 | 输出目录，默认系统临时目录 `<os.tmpdir()>/seid-out`，**建议始终传 `--out`** |
| `--lead-days` | 否 | 临期提前提醒天数，默认 90；非负整数，非法取值报错。年度检查临期也用此窗口 |
| `--category` | 否 | 只统计某一类：压力容器/压力管道/锅炉/安全阀/起重机械/场内机动车辆（按设备品种中文写法，不认字母码）；其他取值报错 |
| `--reports` | 否 | 检验报告目录，按位号或设备代码匹配文件名，核对归档缺失；不读报告内容 |
| `--issues` | 否 | 整改项清单 xlsx，统计上周期遗留未闭环项；不提供则该节为 null |

### 产出

| 文件 | 内容 |
|---|---|
| `inspection.json` | `overdue`、`dueSoon`、`normal`、`undetermined`、`dateConflict`、`monitored`、`stopped`、`annualCheck`、`prepMaterials`、`openIssues`、`reports`、`counts`、`byCategory`、`meta`（含 `basisNote` 口径与 `ownership` 归口说明） |
| `inspection.md` | 十节报告，存在超期时开头与超期节各写一次「【注意】存在超期未检特种设备……」；分析段留 `<!-- ANALYSIS_START/END -->` 占位 |
| `报检准备清单.md` | 按设备类别列出需近期报检设备与应备资料勾选清单 |
| `summary.json` | 末行摘要落盘（Windows 控制台乱码兜底） |

`counts` 字段：`total`、`overdue`、`dueSoon`、`normal`、`undetermined`、`tankSuspect`（储罐待核实）、`dateConflict`、`monitored`、`stopped`、`annualOverdue` / `annualDueSoon` / `annualUndetermined`（台账无年度检查列时为 null）、`openIssues` / `openIssuesOverdue`（未提供整改项清单时为 null）、`reportsMissing`（未提供报告目录时为 null）。

### 关键口径

- **到期日以台账「下次检验日期」为准**，脚本按规则计算值仅作校验；两者不一致时列入 `dateConflict` 并出 warning，分组仍按台账日期。到期日按自然月推（`C.addMonths`）。
- **压力容器 / 压力管道周期由安全状况等级决定**，规格型号里的 GC1/GC2 只是管道分级，不决定周期；等级缺失 → `undetermined`，**绝不按最长周期默认**。
- **锅炉检验类型**先看独立「检验类型」列，再从规格型号/名称找「外部检验/内部检验/水压试验」；都没有 → `undetermined` 并标缺「检验类型」。
- **设备类别按设备品种中文写法**识别（压力容器/容器/球罐、压力管道/管道、锅炉、安全阀、起重机械/行车/天车、场内机动车辆/叉车）；不再识别自造字母码（PV/PP/BL/SV/QZ/CC）。「储罐」「常压罐」「油罐」且未写明压力容器 → `undetermined` 并标「储罐待核实」（常压储罐不是特种设备）。
- **安全阀**：校验周期以厂内规定与校验报告为准，脚本不代入；只按台账载明的下次检验日期提示，无则进 `undetermined` 并指向 `valve-instrument-calibration-ledger`。
- **年度检查**：压力容器 / 压力管道按「上次年度检查日期」+ 12 个自然月判到期（使用单位年度检查，车间设备员主责）；台账无该列 → `annualCheck` 为 null 并 warning。
- 压力容器安全状况等级 4 级（监控使用）与 5 级（应停用）不按常规周期推算，单列 `monitored` / `stopped` 并同时进 `undetermined`。
- 别名表 = 局部别名 + 共享 `SYSTEM_ALIASES`（`C.mergeAliases`）：功能位置 → 位号；SAP「设备」8 位流水号 → 设备编号（单列，不作位号）；设备描述 → 设备名称；设备品种 → 设备类别；设备代码/注册代码；使用登记证编号/使用证号；检验机构；检验类型；工厂区段 → 装置。
- 检验周期表为默认参考口径（依据 TSG 21 / TSG D7005 及相应安全技术规范的常规周期），见 `references/inspection-rules.md`；以现行有效法规、检验报告载明与厂内特种设备管理制度为准。

### 退出码
- `0`：成功，末行输出 `{"ok":true,...}`
- `1`：失败，末行输出 `{"ok":false,"error":"...","warnings":[...]}`

## make-sample.js —— 样例生成

```bash
node scripts/make-sample.js --out examples [--seed <n>] [--date <YYYY-MM-DD>]
```

生成 4 份样例：主台账（车间自维护列名，含「上次年度检查日期」列与「储罐」行）、整改项清单、特种设备平台 / SAP PM 导出风格变体（功能位置 / 设备 / 设备描述 / 设备品种 / 设备代码 / 使用登记证编号 / 检验机构 / 检验类型 / 年度检查日期 / 工厂区段，含标题行与合计行）、全部在周期内变体。
seed 改变设备代码与组内日期抖动，不改变结论：主样例恒为 18 台：3 超期、3 临期、7 正常、5 待核实（含 1 储罐待核实）、2 日期不一致、1 监控使用、1 应停用；年度检查 2 超期、1 临期、1 缺失。SAP 变体恒为 5 台：1 超期、1 临期、2 正常、1 待核实。

## selftest.js —— 自测

```bash
node scripts/selftest.js
```

155 条断言，覆盖：分组与天数计算、超期醒目提示的出现与不出现、各类周期查表、等级缺失/类别不识别/锅炉类型不明/日期缺失四类未判定、4 级监控与 5 级停用、日期不一致并列与以台账为准、`--lead-days` 与 `--category`、遗留整改项、报检准备清单、导出风格（标题行/别名列头/合计行/中文等级/中文日期）、缺表缺列、参数校验、报告归档核对、产出结构与声明行、压力管道 GC 级别不决定周期；本轮新增：安全阀不代入周期并互指 valve-instrument-calibration-ledger、「储罐」待核实、字母码不再识别、md 无 emoji、特种设备平台/SAP 列名（功能位置为位号、「设备」不作位号、设备代码、使用登记证编号、检验机构、工厂区段）、锅炉独立「检验类型」列、年度检查到期（addMonths 12 个月、临期/缺失、无列时为 null）、口径声明。全绿退出 0。
