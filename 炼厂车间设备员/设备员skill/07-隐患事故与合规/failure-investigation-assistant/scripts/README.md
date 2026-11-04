# scripts 使用说明

## investigate.js —— 主脚本

```bash
node "<技能目录>/scripts/investigate.js" \
  --tag "<位号>" --time <ISO8601带时区> \
  --symptom "<故障现象>" \
  --records "<记录路径>[,<路径2>...]" \
  --out "<输出目录>"
```

### 参数

| 参数 | 必需 | 说明 |
|---|---|---|
| `--tag` | 是 | 设备位号，调查材料必须挂到具体设备 |
| `--time` | 是 | 故障发生时间，ISO 8601 **带时区**（如 `2026-09-21T10:40:00+08:00` 或 `Z` 结尾）；缺时区或非法格式直接报错 |
| `--symptom` | 是 | 故障现象（客观描述，不含原因判断） |
| `--records` | 是 | 故障相关记录路径，多个用英文逗号分隔；`.xlsx` 或同结构 CSV 目录 |
| `--before` | 否 | 回溯小时数，默认 `72`（**经验默认，须与用户确认**）；须为正数 |
| `--after` | 否 | 后续小时数，默认 `24`（经验默认，须与用户确认）；须为正数 |
| `--gap` | 否 | 数据缺口判定阈值（分钟），默认 `120`（经验默认，须与用户确认）；须为正数。三项未传时 `meta.window.defaulted` 对应为 true，md 开头「【注意】」提示 |
| `--history` | 否 | 检修历史 xlsx（含「检修历史」工作表，或 SAP PM 工单导出 IW38/IW39 列名） |
| `--params` | 否 | 运行参数 xlsx（含「运行参数」工作表） |
| `--name` | 否 | 设备名称，写入标题与概况表 |
| `--workshop` | 否 | 车间名，写入标题 |
| `--out` | 否 | 输出目录，默认系统临时目录 `<os.tmpdir()>/fia-out`，**建议始终传 `--out`** |

> 可识别的工作表：`运行参数`（别名 参数记录/DCS/趋势）、`报警记录`（报警/SOE/事件记录）、`操作记录`、`巡检记录`（点检记录）、`值班记录`（交接班记录）、`检修历史`（检修记录/维修记录/工单/维修订单/IW38/IW39/IW47）。一张都找不到时报错退出。
> 列名别名 = 局部别名 + 共享 `SYSTEM_ALIASES`（`C.mergeAliases`）；「设备编号」不是位号别名。PDF 先用平台 pdf 技能转 txt/docx 再整理成表，脚本不读 PDF。

### 产出

| 文件 | 内容 |
|---|---|
| `investigation.json` | `meta`（含 `window.defaulted`、`defaultsNote`、`gradingNote`、`reportFramework`、两行声明）、`timeline`、`paramChanges`、`alarms`、`maintenanceHistory`（含 `categoryNorm` 检修分级、`orderNo`、`noticeNo`）、`dataGaps`、`timeInconsistency`、`missingTime`、`outOfWindow`、`causalHits`、`toInvestigate`、`counts`、`analysis`（cause/responsibility/loss/measures 恒为 null）、`warnings` |
| `investigation.md` | 十节调查框架（对齐中石化设备事故调查报告常规章节）+ 附一检出的禁用表述 + 附数据提示 + 末尾两行固定声明；**七、原因分析 / 八、责任分析 / 十、防范措施恒为空，九、损失情况由调查组核定** |
| `summary.json` | 末行摘要落盘 |

### 退出码
- `0`：成功，末行 `{"ok":true,...}`
- `1`：失败，末行 `{"ok":false,"error":"...","warnings":[...]}`

### counts 字段

| 字段 | 含义 |
|---|---|
| `timeline` | 窗口内、有时间戳的时间线条目数 |
| `paramChanges` / `alarms` / `maintenanceHistory` | 运行参数 / 报警 / 检修历史条目数 |
| `dataGaps` | 数据缺口区间数（**仅对连续采样类数据即运行参数判定**） |
| `timeInconsistency` | 同一内容在不同来源之间时间戳不一致的组数 |
| `missingTime` | 时间戳缺失或无法解析的条目数（未推测补齐） |
| `outOfWindow` | 超出时间窗口、单列备查的条目数 |
| `causalHits` | 检出的因果/定性/责任/推测/个人追责表述总数 |
| `causalByCategory` | 按类别的条数 |
| `toInvestigate` | 建议进一步收集的材料条数 |
| `sources` | 时间线涉及的来源数 |

## lib/rules.js —— 禁止表述与待查清单规则引擎

可单独 require 做单元测试：
```js
const R = require('./lib/rules');
R.scanCausal('轴承温度升高导致振动增大', '时间线');
// → [{ruleId:'C1', category:'causal', text:'导致', index:6, severity:'block', suggest:'…'}]
R.scanBlameNames('当班操作工王建国操作不当', '操作记录');
// → [{ruleId:'N1', text:'王建国', …}]
R.buildToInvestigate({alarms:0, maintenanceHistory:0, dutyLogs:0, dataGaps:2, timeInconsistency:1});
// → [{id:'T1',…},{id:'T2',…},{id:'T4',…},{id:'T11',…},{id:'T12',…}, …]
R.DISCLAIMER;            // '本材料为调查辅助归集，不含原因认定与事故定性；…'
R.ANALYSIS_PLACEHOLDER;  // '（由调查组填写）'
R.REFUSAL_NOTE;          // '本技能不提供原因认定、事故定性与责任划分内容；…'
```

规则号口径见 `references/investigation-rules.md`（与 `06-报表与沟通/equipment-event-notice/scripts/lib/rules.js` 同源，改一处须同步另一处）：
- `C1`~`C8` 因果连接类（时间线禁止；`C5` 只拦「说明/表明/反映出 + 结论」推论句式，说明书/情况说明不命中）
- `R.normRepairCategory(v)` 检修分级映射（大修→装置大检修，中修/小修→日常维修，PM01/PM03 映射，PM02 不猜→null）
- `J1`~`J2` 定性类、`J3`~`J4` 责任类、`J5` 推测类
- `N1` 个人姓名追责性表述
- `T1`~`T13` 待查材料清单条目

## make-sample.js —— 样例生成

```bash
node scripts/make-sample.js [--seed <n>] [--date <YYYY-MM-DD>]
```

主样例恒为：1 处时间戳不一致（3 个来源、最大差 7 分钟）、数条运行参数缺口、1 条时间戳缺失、1 条超窗记录；变体样例分别覆盖单一来源、因果与追责表述、DCS 导出风格表头、SAP PM 工单导出（IW38 列名：订单/订单类型/功能位置/短文本/实际结束日期/通知单）。seed 只改变参数数值，上述预期结论不变。

## selftest.js —— 自测

```bash
node scripts/selftest.js
```

313 条断言（改造前 223）：因果词规则逐词覆盖（含 C5 推论句式 8 条正反例）、J1 负向排除与 event-notice S41 同源比对、检修分级映射、定性/责任/推测、个人追责、待查清单、正常路径、七/八/十节留空与九节不估算、时间戳不一致、数据缺口、两行声明行与分级衔接、无 emoji、拒填原因结论、缺失/超窗、数值 null、缺表缺列、表头识别、时间窗口与经验默认提示、窗口终点晚于当前时间时缺口只判到当前时间、参数校验、检修历史（含 SAP IW38 列名、「系统状态」列不被别名「系统」当作来源、功能位置优先于设备编号、DCS 测点号/带单位测值）、默认输出目录、结构完整性、多文件。
