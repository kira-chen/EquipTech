# scripts 使用说明

## handover.js —— 主脚本

```bash
node "<技能目录>/scripts/handover.js" \
  --tag "<位号>" \
  --equip-type "<设备类型>" \
  --medium "<介质>" \
  --scope "<检修内容>" \
  --out "<输出目录>"
```

### 参数

| 参数 | 必需 | 说明 |
|---|---|---|
| `--tag` | 是 | 设备位号 |
| `--scope` | 是 | 检修内容；含「解体/拆卸/抽芯/更换/开盖」等词时判定为涉及解体 |
| `--equip-type` | 否 | 设备类型；缺失时仅生成通用条目并 warning |
| `--medium` | 否 | 介质；**缺失或不在危险特性库时按最严（高危）口径生成并 warning** |
| `--name` | 否 | 设备名称 |
| `--entry` / `--no-entry` | 否 | 是否进受限空间；**都不给 → 未说明**，相关条目标未判定 |
| `--hotwork` / `--no-hotwork` | 否 | 是否用火作业；都不给 → 未说明 |
| `--pressured` | 否 | 是/否；由用户/工艺确认；无法识别时按未说明处理并 warning；未给 → 承压设备泄压条目未判定 |
| `--pressure` | 否 | 操作压力(MPa)；**只记录不推断**，未给 `--pressured` 时写 `meta.pressureHint`（推断值，待确认，不进入判定）并 warning |
| `--hot` | 否 | 是/否；未给 → 相关设备降温条目未判定 |
| `--temp` | 否 | 操作温度(℃)；只记录不推断，未给 `--hot` 时写 `meta.hotHint` 并 warning |
| `--workshop` | 否 | 车间/运行部名；可由台账「维护工厂/属地单位」补全 |
| `--requester` | 否 | 申请人 |
| `--plan-date` | 否 | 计划检修日期 YYYY-MM-DD，非法时报错 |
| `--ledger` | 否 | 设备台账 xlsx（厂内台账或 SAP PM 技术对象导出：功能位置/设备/设备描述/对象类型），补全名称/类型/介质/温度/压力/车间；`--tag` 填位号或 SAP 设备编号均可命中 |
| `--confirm` | 否 | 现场确认结果 JSON（由现场人员填写后回填） |
| `--out` | 否 | 输出目录，默认系统临时目录 `<os.tmpdir()>/ehc-out`，**建议始终传 `--out`** |

`--entry` 与 `--no-entry` 同时给出时报错，`--hotwork` 同理。

### 产出

| 文件 | 内容 |
|---|---|
| `handover.json` | `meta`（设备与作业信息、介质口径、`pressureHint`/`hotHint` 推断值、`permits` 涉及的作业许可、声明行）、`ready`、`counts`、`criticalItems`、`items`、`undetermined`、`warnings` |
| `handover.md` | 六节交出单 + 附：设备信息（含涉及作业许可）、关键条目、逐项确认、未判定项（含推断值待确认提示）、未完成项、四方签字栏（工艺（操作）/设备（车间设备员）/安全/检修（承修单位））、附：数据提示 |
| `summary.json` | 末行摘要落盘（Windows 控制台乱码兜底） |

### 退出码
- `0`：成功，末行 `{"ok":true,...}`
- `1`：失败，末行 `{"ok":false,"error":"...","warnings":[...]}`

### 硬约束

1. 介质不在危险特性库 → 按最严（高危）口径生成 + warning 提示核实 MSDS，**绝不按无危险处理**
2. 判定依据缺失 → 条目 `status: "undetermined"`、`required: null` 并单列，**绝不默认为「不需要」**
3. 关键条目（H3 盲板、Q3 置换分析、E1 断电挂牌）单列 `criticalItems`
4. `items[].confirmed` 一律输出 `null`，**脚本不得预填「已完成」**
5. 存在未完成或未判定项时，md 开头写「【注意】尚不具备交出条件」（不用 emoji）
6. 声明行原文写入 md 开头与签字栏之后
7. 未给 `--pressured` / `--hot` 时**不按压力、温度数值推断**；数值只形成「推断值，待确认」提示，不进入判定
8. 术语按中石化口径：用火作业（不写动火）、盲板抽堵作业许可、双监护；作业许可提示按八大类命名，级别不自判

### 现场确认结果回填

```bash
node scripts/handover.js --tag P-1101A --equip-type 离心泵 --medium 液化气 \
  --scope "机封解体更换" --pressured 是 --hot 否 --no-entry --no-hotwork \
  --confirm 现场确认.json --out 交出单
```

`现场确认.json` 由现场确认人填写：

```json
[
  {"ruleId": "H1", "confirmed": "是", "by": "张工", "at": "2026-09-21 10:00"},
  {"ruleId": "H3", "confirmed": "否", "by": "张工", "at": "2026-09-21 10:05"}
]
```

未出现在文件中的条目保持 `confirmed: null`，**不按已完成处理**。

## lib/rules.js —— 交出条目规则引擎

可单独 require 做单元测试：

```js
const R = require('./lib/rules');
R.classifyMedium('液化气');      // {level:'high', effective:'high', inLibrary:true, ...}
R.classifyMedium('再生剂RX-7');  // {level:'unknown', effective:'high', inLibrary:false, ...}
R.classifyEquip('离心泵', '');    // 'pump'
R.tri('');                        // null（未说明，不默认 false）
R.isDismantle('机械密封解体更换'); // true
R.buildItems({haz, equip, entry, hotwork, pressured, hot, dismantle, temp, pressure});
// → {items[], undetermined[], criticalItems[]}
R.requiredPermits(ctx, items);     // ['用火作业','受限空间作业','盲板抽堵作业'] 子集
```

规则号口径见 `references/handover-rules.md`，介质分档见 `references/medium-hazards.md`。

## make-sample.js —— 样例生成

```bash
node scripts/make-sample.js [--seed <n>] [--date <YYYY-MM-DD>]
```

生成 3 份样例：厂内列名设备台账（高危/中危/电气/介质不在库）、SAP PM 技术对象导出列名台账（功能位置/设备/设备描述/对象类型，含碳四、乙二醇、EO/EG）、交出场景对照表（5 个场景）。
seed 改变温度压力数值与检修负责人，但不改变结论：V-3401 恒为介质不在库、恒有未判定项；P-3601A 未给 --pressured/--hot 恒为 2 项未判定。

## selftest.js —— 自测

```bash
node scripts/selftest.js
```

201 条断言，覆盖：介质危险特性 16 条、设备类型与三态 14 条、条目齐全性 22 条、介质不在库最严口径 12 条、未判定不默认 15 条、关键条目 9 条、不得预填 7 条、【注意】提示两个方向 12 条、声明行 4 条、作业类型专项 15 条、台账补全与不按数值推断 17 条、参数校验 15 条、确认回填 5 条、产出结构 11 条、中石化口径（介质库扩充 / SAP 列名 / 用火与盲板抽堵术语 / 作业许可提示 / 无 emoji）27 条。全绿退出 0。
