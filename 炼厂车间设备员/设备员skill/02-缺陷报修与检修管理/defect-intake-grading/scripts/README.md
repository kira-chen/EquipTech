# scripts 使用说明

## intake.js —— 主脚本

### 单条登记
```bash
node "<技能目录>/scripts/intake.js" \
  --desc "<缺陷描述>" --tag "<位号>" \
  --medium "<介质>" --affects-run <是|否> \
  --found-at "<北京时间或 ISO8601>" --by "<发现人>" \
  --out "<输出目录>"
```

### 批量登记
```bash
node "<技能目录>/scripts/intake.js" --input "<缺陷记录xlsx 或 SAP 通知单导出>" --out "<输出目录>"
```

### 参数

| 参数 | 必需 | 说明 |
|---|---|---|
| `--desc` | 单条必需 | 缺陷描述 |
| `--tag` | 单条必需 | 位号（功能位置） |
| `--input` | 批量必需 | 缺陷记录 xlsx / csv 目录（与 `--desc` 二选一），支持 SAP 通知单导出列名 |
| `--medium` | 否 | 介质；泄漏类/变形类缺陷缺失时定级为未判定 |
| `--affects-run` | 否 | 是/否；**缺失时定级为未判定** |
| `--found-at` | 否 | 发现时间，接受北京时间（`2026-09-21 08:15`）或 ISO 8601 带时区；无法解析时报错 |
| `--by` | 否 | 发现人 |
| `--part` | 否 | 缺陷部位（对应 SAP 对象部件） |
| `--name` | 否 | 设备名称 |
| `--func-loc` | 否 | SAP 功能位置（默认同 `--tag`），写入通知单草稿 |
| `--equip-no` | 否 | SAP 设备编号（8 位流水号），写入通知单草稿；批量时读「设备」列或由设备台账补 |
| `--grading-scheme` | 否 | `abc`（默认：A 重大/B 严重/C 一般）或 `iv`（旧 I~IV 四级，仅兼容历史台账） |
| `--due` | 否 | 覆盖建议处理时限（天），如 `"A=1,B=3,C=7"`；默认为经验值，厂内规定为准 |
| `--equip-ledger` | 否 | 设备台账（SAP 技术对象导出），校验位号并补全名称、介质、设备编号 |
| `--ledger` | 否 | 现有缺陷台账或通知单清单，用于查重与登记号避让；状态按 SAP 系统状态归一 |
| `--workshop` | 否 | 车间名，写入报告标题 |
| `--prefix` | 否 | 车间内部登记号前缀，默认 `QX`（通知单号由 SAP 生成，脚本不编） |
| `--out` | 否 | 输出目录，默认系统临时目录 `<os.tmpdir()>/dig-out`，**建议始终传 `--out`** |

### 产出

| 文件 | 内容 |
|---|---|
| `defects.json` | 逐条缺陷（含 `notification`：type/sapPriority/faultCode/shortText/requiredStart/requiredEnd；批量时含原记录编号与等级 `sourceNo` / `sourceNoKind`（notification 通知单号 / defect 缺陷编号）/ `sourceLevel` / `sourceLevelDiffers`，单条为 null）、等级、定级依据与规则号、未判定、疑似重复、counts（含 `sourceLevelDiffers`）、meta |
| `defects.md` | 五节报告（登记概览、缺陷单、未判定清单、疑似重复清单、维修通知单草稿），开头带声明行 |
| `ledger.csv` | 台账追加行，带 BOM |
| `notification.csv` | 维修通知单草稿，带 BOM：草稿序号、功能位置、设备编号、通知单类型、优先级、故障代码、通知单短文本、长文本、要求开始、要求结束、报告人、缺陷登记号 |
| `summary.json` | 末行摘要落盘 |

### 退出码
- `0`：成功，末行 `{"ok":true,...}`
- `1`：失败，末行 `{"ok":false,"error":"...","warnings":[...]}`

## lib/rules.js —— 分级规则引擎

可单独 require 做单元测试：
```js
const R = require('./lib/rules');
R.classifyPhenomenon('机封泄漏');           // 'leak'
R.mediumHazard('含硫污水');                 // 'medium'
R.parseAffects('');                          // null（未填）
R.disciplineOf('EM-2502', '循环水泵电机');   // '电气'
R.grade({phenomenon:'leak', mediumHazard:'high', affectsRun:false});
// → {level:'A', levelCn:'A 级（重大）', ruleId:'R2', dueDays:1, sapPriority:1, missing:[]}
R.grade({...}, {scheme:'iv'});               // 旧四级
R.notificationType('A', false);              // 'M2'
```

口径见 `references/grading-rules.md`。

## make-sample.js —— 样例生成

```bash
node scripts/make-sample.js --out examples [--seed <n>] [--date <YYYY-MM-DD>]
```

主样例恒为 6 条：A 级 2、B 级 1、C 级 2、未判定 1；SAP 通知单导出样例 4 条：A 1、B 1、C 1、未判定 1；配 SAP 列名台账恒 1 条疑似重复。

## selftest.js —— 自测

```bash
node scripts/selftest.js
```

185 条断言，含规则引擎单元测试（A/B/C 默认、口语「漏」识别、温升口语与数值写法（温度偏高/升高/持续上升、偏高 8℃、高约 15℃）识别、iv 兼容、介质中危、专业归口顺序、`--due` 解析、通知单类型）、单条登记（本地时间、方案切换、通知单草稿列）、批量（未判定不进草稿）、查重（SAP 状态归一）、台账校验（SAP 列名）、产出完整性、参数校验、别名与合计行、原记录编号与系统等级带出（sourceNo / sourceNoKind / sourceLevel / sourceLevelDiffers）、examples 预期计数。
