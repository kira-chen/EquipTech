# scripts 使用说明

## triage.js —— 主脚本

```bash
node "<技能目录>/scripts/triage.js" \
  --symptom "<现象描述>" --equip-type "<设备类型>" --tag "<位号>" \
  --params "<运行参数xlsx>" --limits "<限值表xlsx>" --dev-pct "温度=10,压力=8" \
  --history "<历史故障记录xlsx>" \
  --sudden <是|否> --affects-run <是|否> --special <是|否> \
  --time <ISO8601带时区> \
  --out "<输出目录>"
```

### 参数

| 参数 | 必需 | 说明 |
|---|---|---|
| `--symptom` | 是 | 异常现象描述（自由文本） |
| `--tag` | 是 | 设备位号 |
| `--equip-type` | 否 | 设备类型；**缺失或不在五类（泵/机组/静设备/电仪/安全阀）之内时只给通用框架并 warning** |
| `--name` | 否 | 设备名称 |
| `--time` | 否 | 发现时间，ISO 8601 带时区，非法时报错 |
| `--sudden` | 否 | 是否突发；**缺失时关注度判未判定** |
| `--affects-run` | 否 | 是否影响运行；**缺失时关注度判未判定** |
| `--special` | 否 | 是否特护设备（是/否）；**是 → 关注度强制「红」（RK0），上报建议含公司设备管理部门**；非法取值报错 |
| `--recent-repair` | 否 | 近期是否检修 |
| `--load` | 否 | 负荷/工况是否调整 |
| `--params` | 否 | 运行参数 xlsx 或 CSV 目录 |
| `--limits` | 否 | 限值表 xlsx（sheet「限值」：参数名 + 可选 位号/参数类型/偏差阈值%/上限/下限）；位号+参数名精确匹配优先，无位号的行按参数名匹配 |
| `--dev-pct` | 否 | 偏差阈值（百分比）：`15` 对所有类型生效；`温度=10,压力=8,振动=20,电流=10,流量=5,液位=10,其他=15` 按参数类型；格式非法报错 |
| `--history` | 否 | 历史故障记录 xlsx 或 CSV 目录（支持 SAP PM 维修通知单导出列名） |
| `--workshop` | 否 | 车间名 |
| `--out` | 否 | 输出目录，默认系统临时目录 `<os.tmpdir()>/ata-out`，**建议始终传 `--out`** |

### 偏差阈值（不写死）

参数「升高 / 偏低 / 正常」的判定来源按优先级：

1. 参数表行内 `上限/下限`（别名 高报/低报/H/L）→ 按限值判；
2. 限值表（`--limits`）该参数的上限/下限；
3. 参数表行内 `偏差阈值%`；
4. 限值表该参数的 `偏差阈值%`；
5. `--dev-pct` 按参数类型（温度/压力/振动/电流/流量/液位/其他，由参数名与单位识别）给的百分比。

五者都没有 → `trend:null`、`thresholdSource:null`，warning 写明"未按固定百分比默认"，依赖该参数的原因进未判定；`counts.paramsNoThreshold` 计数。高高报/低低报（HH/LL）两级越限属 `parameter-trend-alert`，本脚本只用一级限值。

### 关注度口径

红 / 橙 / 黄 三档（`riskLevel.level`），不再用 A/B/C（与设备重要度分级撞名）。`R.normRiskLevel()` 接受旧写法：A/一级/高 → 红，B/二级/中 → 橙，C/三级/低 → 黄。

### 列名别名

`ALIASES = C.mergeAliases({...局部...})`：局部别名优先，再合并共享 `SYSTEM_ALIASES`（功能位置 / 技术对象 / 技术对象描述 / 检查项 / 测值 / 测点号 / 通知单 / 损坏代码 …）。「设备编号」（SAP 8 位流水号）不作位号别名，单独成列只展示。完整表见 `references/input-spec.md`。

### 产出

| 文件 | 内容 |
|---|---|
| `triage.json` | `candidates`（候选原因、可能性、支持依据、反证、缺失依据、规则号）、`checkItems`、`undetermined`、`riskLevel`（红/橙/黄/undetermined）、`escalation`、`counts`（含 `paramsTrended`/`paramsNoThreshold`/`limits`）、`evidence`、`params`（每项含 `kind`/`upper`/`lower`/`devPct`/`thresholdSource`/`trendBasis`/`tagNo`/`equipNo`）、`limits`、`history`（含 `noticeNo`/`faultCode`）、`historyHints`、`meta.special`、`meta.attentionScheme` |
| `triage.md` | 六节报告：现象复述 / 可能原因排序 / 建议核实项 / 建议动作 / 未判定项 / 上报建议；warnings 非空时附「数据提示」。不用 emoji，提示用「【注意】」 |
| `summary.json` | 末行摘要落盘 |

### 退出码
- `0`：成功，末行 `{"ok":true,...}`
- `1`：失败，末行 `{"ok":false,"error":"...","warnings":[...]}`

## lib/rules.js —— 初判规则引擎

可单独 require 做单元测试：
```js
const R = require('./lib/rules');
R.classifyEquipType('离心泵');                  // 'pump'
R.classifyEquipType('离心压缩机');              // 'compressor'（末尾词优先、最长匹配，不被「泵/机」误抢）
R.classifyEquipType('循环氢压缩机电机');        // 'electrical'（末尾词「电机」）
R.classifyEquipType('安全阀');                  // 'safetyValve'（单列，不并入静设备）
R.classifyEquipType('胶带输送机');              // 'generic'（不硬套）
R.normRiskLevel('A级');                         // '红'
R.compareToBase({value:78, base:62});           // {trend:null}（无阈值不判）
R.compareToBase({value:78, base:62, devPct:10}); // {trend:'升高', basis:'…阈值 ±10%'}
R.classifySymptoms('泵振动大还有异响');         // ['vibration','noise']
R.parseSudden('');                               // null（未填，不按 false）
R.runProbe('freq2x', {});                        // verdict:'unknown'
R.triage({equipType:'离心泵', symptoms:['vibration'], evidence:{}});
// → 全部候选 undetermined，但一条都不少
R.triage({equipType:'闸阀', symptoms:R.classifySymptoms('关不严，内漏'), evidence:{}, symptomText:'关不严，内漏'});
// → 性能类只因「内漏」触发：阀门不补性能条目，首位 SL1；换热器补 SF2、压缩机补 CF2/CF3、泵口环/叶轮内漏补 PF2
//   （不传 symptomText 时按原口径并入整张性能表；triage.js 会传 --symptom 原文）
```

### 规则号编码

| 前缀 | 含义 |
|---|---|
| `PV*` / `PN*` / `PT*` / `PF*` / `PL*` | 泵类：振动 / 异响 / 温度 / 性能 / 泄漏 |
| `CV*` / `CN*` / `CT*` / `CF*` | 机组类：振动 / 异响 / 温度 / 性能 |
| `SL*` / `SF*` / `SV*` / `ST*` | 静设备类：泄漏 / 性能 / 振动 / 温度 |
| `ET*` / `EC*` / `EV*` / `EI*` | 电仪类：温度 / 电流 / 振动 / 仪表 |
| `VL*` / `VF*` | 安全阀：泄漏 / 起跳异常 |
| `G1`~`G4` | 通用排查框架（类型未覆盖时） |
| `RK0` / `RK1`~`RK5` / `RU1` | 特护强制红 / 关注度 红橙黄 / 关注度未判定 |

口径见 `references/fault-patterns-*.md`，每条规则号在口径表里可查到支持依据与反证。

### 三条不可绕过的行为

1. `evidence` 里字段为空 → 探针 `unknown`，**既不算支持也不算反证**；某条原因的全部探针都 unknown → 该原因 `undetermined=true`，**但仍留在 `candidates` 里**。
2. 每条候选原因固定带 `needVerify:true`，`likelihoodCn` 一律含「需核实」或「未判定」。
3. 设备类型不在五张口径表内 → `covered:false`，只返回 `GENERIC_FRAME`，**不套用其他类型的原因**。
4. 偏差阈值不写死：无限值、无 `--dev-pct` → 参数不判趋势，不按 15% 默认。

## make-sample.js —— 样例生成

```bash
node scripts/make-sample.js [--seed <n>] [--date <YYYY-MM-DD>]
```

seed 变 → 参数数值、记录人变；**预期结论不变**（候选原因数、未判定项数、风险等级不随 seed 变化）。

## selftest.js —— 自测

```bash
node scripts/selftest.js
```

293 条断言：规则引擎分类与解析 26 条（含最长匹配/末尾词/安全阀）、证据探针 6 条、**undetermined 不剔除候选 16 条**、不给定论 5 条、类型未覆盖 8 条、关注度红橙黄/旧口径映射/特护 22 条、正常路径 11 条、六节与声明行/术语 21 条、脚本层未判定 13 条、通用框架 9 条、缺表缺列与数值解析 10 条、历史记录 5 条、解析细节 4 条、偏差阈值参数化 34 条、中石化系统列名与带单位数值 23 条、安全阀与特护 14 条、参数校验 12 条、现象模糊 3 条、跨现象合并与核实项去重 9 条、别名合并 1 条、现象口语（温度偏高/较高/越来越高、内漏只按设备类型补性能条目、阀门/安全阀/机封内漏首位候选仍为泄漏表）17 条、文档与上架信息一致性 19 条（触发词、红/橙/黄、口径表不写死 ±15%、md 六节、附件存在）。
