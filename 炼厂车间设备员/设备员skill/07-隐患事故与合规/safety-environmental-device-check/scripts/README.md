# scripts 使用说明

## facility.js —— 主脚本

```bash
node "<技能目录>/scripts/facility.js" \
  --input "<安全环保设施台账xlsx>" \
  --workshop "<车间名>" \
  --date <YYYY-MM-DD> \
  --out "<输出目录>"
```

### 参数

| 参数 | 必需 | 说明 |
|---|---|---|
| `--input` | 是 | 安全环保设施台账 xlsx 路径，或同结构 CSV 目录 |
| `--workshop` | 是 | 车间名称 |
| `--date` | 是 | 基准日期 YYYY-MM-DD，用于计算超期与临期 |
| `--out` | 否 | 输出目录，默认系统临时目录 `<os.tmpdir()>/sedc-out`，建议始终传 `--out` |
| `--lead-days` | 否 | 提前提醒天数，默认 15；非负整数 |
| `--category` | 否 | 只统计某一类设施（报警器/安全附件/联锁与防爆/消防/接地/应急器材/环保设施） |
| `--issues` | 否 | 失效整改记录 xlsx；不提供则所有不合格项按未整改处理并 warning |
| `--reports` | 否 | 检测报告目录，仅校验存在性并记录于 meta，不影响判定 |

### 产出

| 文件 | 内容 |
|---|---|
| `facility.json` | overdue / dueSoon / outOfService / unresolvedFail / normal / undetermined / byCategory / metrics / counts / plan；meta 含 statement / scopeNote / periodRule；每条记录带 periodUnit / calcMode / periodMonths |
| `facility.md` | 九节报告；存在失效或超期时开头醒目写入「【注意】」提示；头部归口说明；末尾声明行；说明段留 `<!-- ANALYSIS_START/END -->` 占位 |
| `检测计划.xlsx` | 「检测计划」明细 +「类别汇总」两张表，按设施类别与应检测日期排布 |
| `summary.json` | 末行摘要落盘（Windows 控制台乱码兜底） |

### 判定口径要点

- **状态为失效/故障/停用 → `outOfService` 单列并醒目提示，无论是否在检测周期内都必须列出**，归档优先级最高，不计入完好设施但计入完好率分母。
- **检测周期、上次检测日期、设施类别、当前状态任一缺失 → `undetermined` 单列**，绝不代入同类设施默认周期（脚本不内置任何周期数值）。
- **周期折算**：月/季/年/半年按自然月（`C.addMonths`），天/周/小时按天（`C.addDays`）；与 special-equipment、valve-calibration 的到期口径一致。
- **七类设施**：报警器、安全附件（安全阀/爆破片/阻火器/呼吸阀）、联锁与防爆（联锁/SIS/紧急切断阀/防爆电气）、消防（含消防水系统）、接地、应急器材、环保设施。安全附件只做台账到期与状态，校验周期归 `special-equipment-inspection-due`；SIS 功能测试归仪表。
- **别名**：`ALIASES` 经 `C.mergeAliases` 合并共享 `SYSTEM_ALIASES`，并显式承接 功能位置/设备描述/装置/检验类型/检验周期/检验日期/检验结论/用户状态 等 SAP PM / EM / 特种设备台账导出列名。
- **检测结果不合格且无整改记录 → `unresolvedFail` 醒目提示**，不计入完好设施，不参与到期三态归档。
- **完好率 = 完好台数 ÷ 设施总台数**，完好 = 在用 + 结果未否定 + 未超期（含临期）；分母为 0 或范围内存在状态无法判定的设施时为 `null`，md 显示「—」，**绝不写 0%**。
- 归档优先级：`outOfService` > `unresolvedFail` > `undetermined` > `overdue` / `dueSoon` / `normal`。
- 存在失效设施或超期未检时（`meta.alertNeeded` 为 true），md 开头写入：「【注意】存在失效或超期未检的安全环保设施，可能影响安全保护功能有效性，应立即整改并评估风险」。
- md 末尾固定声明行：「本材料由脚本汇总、模型成文，仅供设备员复核参考，不替代审批、定性、验收与签字；厂内制度与系统数据为准。」（`meta.statement`）。
- 状态与检测结果矛盾、台账下次检测日期与计算值不一致、设施编号重复 → 附节并列 + warning，不擅自采信其一。
- 详细口径见 `references/facility-rules.md`。

### 退出码
- `0`：成功，末行输出 `{"ok":true,...}`
- `1`：失败，末行输出 `{"ok":false,"error":"...","warnings":[...]}`

## make-sample.js —— 样例生成

```bash
node scripts/make-sample.js --out examples [--seed <n>] [--date <YYYY-MM-DD>]
```

生成 4 份样例：主设施台账（七类设施、六种归档）、失效整改记录、系统导出风格变体（标题行+别名+合计行）、SAP/EM 导出列名变体（功能位置/设备描述/装置/检验类型…）。
seed 改变责任人与上次检测日期的小幅偏移，但结论不变：主样例恒为 24 台、3 失效停用、3 超期、2 临期、11 在周期内（完好 13 含临期）、2 不合格未整改、3 待确认；配整改记录时不合格未整改降为 1 项。

## selftest.js —— 自测

```bash
node scripts/selftest.js
```

190 条断言，覆盖：到期三分与天数、醒目提示出现与不出现两个方向、失效设施无论是否在周期内一律单列、失效优先级高于不合格、周期/日期/类别/状态缺失不按默认处理、不合格未整改不计入完好、整改闭环与「整改中」区分、完好率分母为 0 与状态不明两种 null 场景（不写 0%）、分类完好率、五类设施识别、lead-days 可调、检测计划 xlsx 结构与处置要求、状态与结果矛盾、下次日期不一致、编号重复、合计行与空编号跳过、别名列头与标题行表头识别、周期与结果无法解析、缺列不中断、缺唯一数据源报错、参数校验、产出结构与分析段占位、自然月折算（月末钳制、季/半年/年）、新增两类设施识别与过滤、SAP/EM 列名、声明行与归口说明、无 emoji、默认输出目录为临时目录、SKILL 同步项（旧名不出现、功能位置优先于 SAP 设备编号）。全绿退出 0。
