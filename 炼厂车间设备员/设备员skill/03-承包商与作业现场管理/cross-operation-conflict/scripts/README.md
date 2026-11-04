# scripts 使用说明

## conflict.js —— 主脚本

```bash
node "<技能目录>/scripts/conflict.js" \
  --input "<作业清单xlsx>" \
  --workshop "<车间名>" \
  --date <YYYY-MM-DD> \
  --out "<输出目录>"
```

### 参数

| 参数 | 必需 | 说明 |
|---|---|---|
| `--input` | 是 | 作业清单 xlsx，或同结构 CSV 目录 |
| `--workshop` | 是 | 车间名称 |
| `--date` | 是 | 检测日期 YYYY-MM-DD；有效期不覆盖该日期的作业（结束不晚于该日 00:00，或开始不早于次日 00:00）会被跳过；前一天开、后一天结束的多日票照常参与判定；重叠分钟与并行时段都截到检测日 [当日 00:00, 次日 00:00) |
| `--out` | 否 | 输出目录，默认输入文件同目录下 `coc-out/`；**建议始终传 `--out`** |
| `--area-map` | 否 | 区域划分表 xlsx，按位号补全为空的区域字段；位号不在表中时区域仍为空 |
| `--rules` | 否 | 厂内冲突口径 xlsx（「冲突口径」表：规则号/严重度/启用/建议；模板 `assets/templates/rules-template.xlsx`）。**真实生效**：覆盖内置规则的严重度（高/中/低）、停用规则、替换建议措辞（须以「建议」开头）；不新增规则。未传时判定口径标注「默认口径，非厂内正式口径」 |
| `--window` | 否 | 时段重叠判定分钟数，非负整数，默认 `0`（严格重叠，首尾相接不算） |
| `--radius` | 否 | 相邻区域判定说明，仅写入报告头部 |
| `--floor-height` | 否 | 层高米数（正数，默认 `4`），仅用于标高写「3层/三层」时的折算；折算值标「推断，待确认」并 warning |

### 产出

| 文件 | 内容 |
|---|---|
| `conflicts.json` | `spatialConflicts` / `riskConflicts` / `resourceConflicts` / `advisories`（同位号双票作业提示项）/ `undetermined` / `timeline` / `segments` / `works`（含 `guardSite`/`guardUnit` 双监护）/ `skipped` / `counts` / `meta`（`rulesApplied`、`floorHeight`、`dualGuard`、`absentColumns`） |
| `conflicts.md` | 七节报告（第三节含提示项小节）+ 开头与末尾固定声明行，分析段留 `<!-- ANALYSIS_START/END -->` 占位；不含 emoji |
| `summary.json` | 末行摘要落盘（Windows 控制台乱码兜底） |

`counts` 字段：`works`（检测作业数）、`skipped`、`spatial`、`risk`、`resource`、`total`、`high`/`medium`/`low`（按严重度）、`undetermined`、`advisory`（提示项，不计入 total）、`maxConcurrent`（同时段最大并行作业数）。

### 退出码
- `0`：成功，末行输出 `{"ok":true,...}`
- `1`：失败，末行输出 `{"ok":false,"error":"...","warnings":[...]}`

### 三条硬约束（脚本行为）

1. **区域或标高字段为空 → 空间关系列入 `undetermined`**，绝不按「不在同一区域」处理。
2. **介质字段为空而涉及风险冲突判定 → 该冲突项标 `undetermined`**，不得因缺数据判为无冲突。
3. **起止时间缺失 → 时段关系 `undetermined`**，不按不重叠跳过。
3a. **时段截到检测日**：多日票的重叠分钟（`overlapMinutes`）、`timeline` 的 `startMin`/`endMin`/`dayStart`/`dayEnd` 与 `segments` 只算检测日 [当日 00:00, 次日 00:00) 内的部分；`works` 与 `timeline` 的 `start`/`end` 仍是作业票原始起止时间。在检测日 00:00 结束的票不覆盖检测日，跳过。结束时间单元格只写日期（无时分）时按当日 24:00（次日 00:00）处理并 warning，不补成当日 00:00。

### 中石化口径（脚本行为）

- 列名接作业许可（电子作业票）系统导出：许可证编号 / 作业类别 / 功能位置 / 作业地点 / 有效期自至 / 作业单位名称 / 属地监护人 / 作业单位监护人（局部别名 + 共享 `SYSTEM_ALIASES`）。
- **双监护**：属地监护人、作业单位监护人两列各自单列并合并参与 Z1 同一监护人判定。
- **同位号「受限空间 + 用火」** → `advisories` 提示项（合法常态，不计冲突，不建议错时）；同区域同层不同位号仍按 R2 高冲突。
- 术语「用火作业」；归口「安全环保部门」。
- 电源回路 / 消防覆盖区缺列只提示一次「通常缺省」，不判 Z3/Z4。
- 标高「N 层」按 `--floor-height` 折算并标推断。

## lib/rules.js —— 冲突规则引擎

可单独 require 做单元测试：
```js
const R = require('./lib/rules');
R.classifyTypes('进罐用火焊补');                 // ['hotwork', 'confined']（"动火"同样可识别）
R.mediumFlammable('石脑油');                     // 'flammable'
R.mediumFlammable('');                            // null（未填 → 未判定，不按不可燃）
R.timeOverlap({start:'2026-09-21 08:00', end:'2026-09-21 10:00'},
              {start:'2026-09-21 10:00', end:'2026-09-21 12:00'}, 0);
// → {overlap:false, ...}；--window 30 时为 {overlap:true, ...}
R.spatialRelation({id:'A', area:'', elev:0}, {id:'B', area:'一区', elev:0});
// → {relation:null, undetermined:true, missing:['A 区域'], ...}
R.riskConflicts(a, b, rel, overrides);            // {hits:[...], undetermined:[...], advisories:[...]}
R.applyRuleOverrides([{ruleId:'R4', severity:'中'}, {ruleId:'Z1', enabled:'否'}]);  // {overrides, applied, ignored}
```

规则号：空间 `S1~S3`、风险 `R1~R8`、资源 `Z1~Z4`，口径见 `references/conflict-rules.md`。

## make-sample.js —— 样例生成

```bash
node scripts/make-sample.js [--seed <n>] [--date <YYYY-MM-DD>] [--template-out assets/templates]
```

生成 6 份样例：主样例（8 项作业）、区域划分表、介质全空变体、区域标高全空变体、施工方导出风格变体、作业许可系统导出变体（双监护两列、无电源回路/消防覆盖区列、标高「3层」）。`--template-out` 另写厂内冲突口径模板 `rules-template.xlsx`。
seed 改变时刻分钟偏移与人名单位，但不改变结论：主样例恒为 8 项作业、6 组高严重度冲突、1 项提示项（同位号双票作业）、11 项无法判定（配区域划分表后降为 7 项）。

## selftest.js —— 自测

```bash
node scripts/selftest.js
```

224 条断言，覆盖：规则引擎单元测试（类型识别、用火术语、介质库补齐、时段重叠、空间关系）、风险冲突矩阵 R1~R8 逐条（含命中与未判定两路；R2 同位号提示项 / 邻近高冲突）、作业许可系统列名与双监护、通常缺省列只提示一次、层高折算与 `--floor-height`、`--rules` 覆盖严重度/停用/建议与非法行忽略、归口术语与无 emoji、区域/标高为空的未判定、`--window` 边界、资源冲突 Z1~Z4（Z2 只比对起重类设备 / 吊装作业，普通机具同名不判）、结束时间只写日期按当日 24:00、timeline 与并行时段分段、声明行与建议措辞、别名列头/标题行/合计行/跨日跳过与多日票不跳过（检测日 00:00 结束 / 次日 00:00 开始的票跳过，重叠分钟与并行时段截到检测日）/空编号/重复编号/标高无法解析、区域划分表补区域、参数校验、产出结构、样例可再生。全绿退出 0。
