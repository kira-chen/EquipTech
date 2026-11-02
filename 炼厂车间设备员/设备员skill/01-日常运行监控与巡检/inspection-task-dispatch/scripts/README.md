# scripts 使用说明

## dispatch.js —— 主脚本

```bash
node "<技能目录>/scripts/dispatch.js" \
  --input "<xlsx路径>" \
  --workshop "<车间名>" \
  --date <YYYY-MM-DD> \
  [--shift "<班次>"] [--time HH:mm] \
  --out "<输出目录>"
```

### 参数

| 参数 | 必需 | 说明 |
|---|---|---|
| `--input` | 是 | 一个 xlsx 路径，或同结构 CSV 目录；需含工作表「设备台账」，另可含「巡检标准」「上次巡检记录」（智能巡检导出的「巡检明细」「点检数据」亦可） |
| `--workshop` | 是 | 车间（运行部）名称 |
| `--date` | 是 | 任务日期 YYYY-MM-DD |
| `--shift` | 否 | 班次，如「白班」「夜班」「甲班」。给了则按巡检标准「适用班次」过滤（标准未填/每班/全部 → 任何班次都排）；不给按「全天」排，不过滤 |
| `--time` | 否 | 班次开始时间 HH:mm。班次级周期（每班/每 N 小时）仅当上次记录带时间且给了此参数时按小时判逾期；否则按「本班到期」并 warning |
| `--out` | 否 | 输出目录。**默认写系统临时目录 `<os.tmpdir()>/itd-out`，建议始终传 `--out`** |
| `--area` | 否 | 只排指定区域，如 `一区`；与台账「区域/工厂区段」列精确匹配 |
| `--discipline` | 否 | 只排指定专业：静设备 / 动设备 / 电气 / 仪表 |
| `--criticality` | 否 | 只排指定重要度：A（关键）/ B（主要）/ C（一般）；取值非法时报错退出 |
| `--group` | 否 | 人员分组说明，仅写入报告头部，不参与筛选 |
| `--due-soon` | 否 | 临期阈值：`10%`（周期的比例，默认）或 `2`（天数）。写法非法报错退出 |

### 产出

| 文件 | 内容 |
|---|---|
| `tasks.json` | `meta`（含 `shiftText`/`dueSoonRule`/`disclaimer`/`routeNote`）、`counts`、任务清单 `tasks`、特护 `special`、逾期 `overdue`、临期 `dueSoon`、周期待确认 `unscheduled`、无标准 `noStandard`、标准仅适用其他班次的设备 `otherShiftOnly`、不属本班的检查项 `otherShift`、排除 `excluded`/`filteredOut`、路线 `route`、工具 `tools`、`warnings` |
| `tasklist.md` | 五节清单，执行提示段留 `<!-- NOTES_START/END -->` 占位，末尾带路线声明与声明行 |
| `summary.json` | 末行摘要落盘（Windows 控制台乱码兜底） |

### 任务项字段（tasks[]）

`tag` 位号、`equipNo` 设备编号（SAP 8 位流水号，台账有此列时才有值）、`name`、`area`、`discipline`、`criticality`（A/B/C/null）、`criticalityRaw`、`special`（特护）、`item`、`criterion`、`tool`、`periodRaw`/`periodDays`/`periodHours`/`periodText`、`granularity`（day/hour）、`applicableShift`、`matchBy`（位号/设备类型）、`lastDate`/`lastDateTime`/`lastResult`/`lastResultRaw`、`dueDate`、`dueStatus`、`overdueDays`、`overdueHours`、`daysToDue`、`dueSoonThreshold`、`dueNote`、`priority`（P1~P6）、`priorityReason`、`routeSeq`。

### 到期状态取值

| 值 | 含义 | 是否进本班清单 |
|---|---|---|
| `overdue` | 已过到期日（日历周期按天；班次级周期按小时，需上次记录带时间 + `--time`） | 是 |
| `due` | 本班到期（班次级周期无时间信息时一律本班到期） | 是 |
| `dueSoon` | 距到期 ≤ 临期阈值（默认周期的 10%，可 `--due-soon`） | 是 |
| `never` | 无上次巡检记录，按未检处理 | 是 |
| `notDue` | 未到期 | 否 |
| `unscheduled` | 周期为空、无法解析或为运行小时周期 | 否，单列「周期待确认」 |

### 优先级

P1 特护设备（强制最高）> P2 已逾期 > P3 关键设备（A）> P4 上次巡检异常 > P5 临期 > P6 常规/未检。命中即定级，不叠加。

### 退出码
- `0`：成功，末行输出 `{"ok":true,...}`
- `1`：失败，末行输出 `{"ok":false,"error":"...","warnings":[...]}`

仅「设备台账」缺失会导致失败退出；缺「巡检标准」「上次巡检记录」只 warning 并继续。

## make-sample.js —— 样例生成

```bash
node scripts/make-sample.js --out examples [--seed <n>] [--date <YYYY-MM-DD>]
```

生成 3 份样例：主样例（三表齐全，含特护与班次级周期）、无上次巡检记录变体、SAP PM 导出 + 智能巡检明细变体。
seed 改变上次巡检日期/时间但不改变结论：主样例（`--shift 白班`）恒为 6 项任务（3 逾期、2 本班到期、1 临期）、1 项特护、2 项周期待确认、1 台无巡检标准、1 台标「否」不纳入、1 项夜班专属不属本班。

## selftest.js —— 自测

```bash
node scripts/selftest.js
```

212 条断言，覆盖：周期缺失/运行小时不默认日检、无巡检标准单列、标「否」排除、特护强制 P1（特护列与重要度值两种识别）、六级优先级排序、三种过滤器、路线编排、合计行、EM 别名与 SAP PM 列名（功能位置/设备/设备描述/ABC标识/对象类型/特护）、设备编号不当位号、智能巡检一行一检查项按位号聚合与是否报警判异常、班次级周期按小时判逾期与无时间时的处理、临期阈值默认 10% 与 `--due-soon` 按天/百分比、`--shift` 可选与适用班次过滤、数字级别不默认映射、参数校验、默认输出目录为临时目录、声明行与【注意】、模板占位符与 tasks.json 键一致、SKILL/references/README/上架信息与脚本口径一致（互指排除语、旧术语不出现、md 五节、附件存在）。全绿退出 0。
