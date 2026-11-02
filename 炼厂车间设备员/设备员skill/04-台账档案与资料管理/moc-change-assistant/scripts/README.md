# scripts 使用说明

## moc.js —— 主脚本

```bash
node "<技能目录>/scripts/moc.js" \
  --tag "<位号>" --before "<原状态>" --after "<变更后状态>" --reason "<变更原因>" \
  --category <材质|型号|结构|工艺|控制|备件代用|管理> \
  --out "<输出目录>"
```

### 参数

| 参数 | 必需 | 说明 |
|---|---|---|
| `--tag` | 是 | 设备位号（SAP 功能位置）；配 `--ledger` 时也可给 SAP 设备编号 |
| `--before` | 是 | 原状态，**须具体到参数或型号**；笼统描述或只写位号 → 未判定 U1 |
| `--after` | 是 | 变更后状态，同上 |
| `--reason` | 否 | 变更原因；缺失 warning 不中断 |
| `--category` | 否 | 材质 / 型号 / 结构 / 工艺 / 控制 / 备件代用 / 管理；不填时从描述识别，识别不出 → 未判定 U2。「临时」不是类别，写了按临时属性处理并 warning |
| `--same-model-material` | 否 | 是/否；**只有填「是」才可能判「不属于变更」（RN1 同类替换）**，不填绝不默认 |
| `--affects-perf` | 否 | 是/否；型号规格类变更不填 → 未判定 U4 |
| `--exceeds-design` | 否 | 是/否；工艺参数类变更不填 → 未判定 U4 |
| `--special` | 否 | 是/否；是否压力容器 / 压力管道。结构或材质改动时不填 → 按台账设备类别 / 描述推断，推断不出按「待确认」列三项法定手续，不默认免办；取值非法报错 |
| `--temporary` | 否 | 开关参数；标记为临时变更（属性，不改变级别） |
| `--until` | 否 | `YYYY-MM-DD`；临时变更不填 → 未判定 U5，格式非法则报错 |
| `--spec` | 否 | 厂内变更管理实施细则 xlsx（工作表「变更判定」）；**与默认口径冲突时以厂内为准**；预填模板见 `assets/templates/plant-spec-template.xlsx`（`node scripts/make-sample.js --spec-template <路径>` 可再生） |
| `--ledger` | 否 | 设备台账 xlsx（SAP PM / EM 列名），核对原状态、补全设备名称、按对象类型识别承压设备；位号与设备编号都可命中 |
| `--workshop` | 否 | 车间名，写入报告标题 |
| `--applicant` | 否 | 申请人 |
| `--name` | 否 | 设备名称（台账未提供时手工指定，也用于承压设备识别） |
| `--out` | 否 | 输出目录，默认系统临时目录 `<os.tmpdir()>/moc-out`，**建议始终传 `--out`** |

### 产出

| 文件 | 内容 |
|---|---|
| `moc.json` | `isChange`（true/false/**null**）、`changeType` / `changeTypeCn`（工艺技术 / 设备设施 / 管理变更）、`level` / `levelCn`、`temporary`、`basis`、`ruleId`、`defaultVerdict`、`ownership`、`statutory`、`equip`、`assessItems`、`docUpdates`、`undetermined`、`conflicts`、`temporaryPlan`、`counts`、`declaration` |
| `moc.md` | **十节固定**报告（变更概况 / 是否属于变更及依据 / 归口与提报专业 / 需评估项 / 应更新资料 / 待确认信息 / 与厂内制度的冲突点 / 特种设备法定手续提示 / 临时变更期限与恢复计划 / 变更申请要点提示），末尾含固定声明行；不用 emoji，醒目提示用【注意】【未判定】 |
| `summary.json` | 末行摘要落盘 |

### 退出码
- `0`：成功，末行 `{"ok":true,...}`
- `1`：失败，末行 `{"ok":false,"error":"...","warnings":[...]}`

### 判定结果

| `isChange` | `level` | 含义 |
|---|---|---|
| `true` | major / general | 属于变更（重大 / 一般；`temporary: true` 表示临时属性） |
| `null` | **review** | **待厂内评审**：同规格不同厂家代用走材料代用单 / 同类替换评审，是否报变更以厂内制度为准 |
| `false` | none | 不属于变更（同类替换，**仅 RN1 正面命中**） |
| **`null`** | **undetermined** | **未判定 —— 不等于不需要走变更** |

变更类型（三大类）由细分类别映射：材质 / 型号 / 结构 / 备件代用 → 设备设施变更；工艺 / 控制 → 工艺技术变更（由工艺 / 仪表专业提报，`ownership.equipmentEngineerCanSubmit = false`）；管理 → 管理变更（级别由 `--spec` 定，否则 U6）。厂内制度可改变归类并记 warning。

### 承压设备法定手续
结构或材质改动且对象为压力容器 / 压力管道（`--special 是`，或按台账对象类型 / 描述推断）时，`statutory.items` 固定列出**改造告知、监督检验、使用登记变更**三项（只提示名称，不写数值；依据 TSG 21 / TSG D7005 与厂内特种设备管理规定）；推断不出时按「待确认」列出并进未判定清单，不默认免办；`--special 否` 时不附。

## lib/rules.js —— 变更判定规则引擎

可单独 require 做单元测试：

```js
const R = require('./lib/rules');
R.normCategory('材质');                       // 'material'
R.normCategory('临时');                       // null（临时是属性，不是类别）
R.isTempWord('临时措施');                     // true
R.classifyCategory('把联锁报警值从12改到8');   // 'control'
R.classifyCategory('维保单位更换为乙公司');     // 'management'
R.describeQuality('换成 P-2101B');            // {concrete:false, reason:'只给了位号…'}
R.materialRank('316L');                        // {rank:5, name:'316 系不锈钢'}
R.parseBool('');                               // null（未填，绝不按 false）
R.detectPressure('压力容器（换热器）');         // true
R.STATUTORY_ITEMS;                             // 改造告知 / 监督检验 / 使用登记变更
R.judge({category:'material', before:'管束材质 316L', after:'管束材质 碳钢 Q345R',
         beforeQ:R.describeQuality('管束材质 316L'), afterQ:R.describeQuality('管束材质 碳钢 Q345R'),
         sameModelMaterial:null, affectsPerf:null, exceedsDesign:null, temporary:false, until:null});
// → {isChange:true, level:'major', changeType:'equipment_facility', ruleId:'R1', basis:'…材质降级…', missing:[]}
R.assessItems('material', 'major', false);     // 六个专业分组的需评估项（重大时附加会审条目）
R.docUpdates('structure', true);               // 结构类资料清单，并入临时变更台账等临时类资料
```

口径见 `references/moc-rules.md` 与 `references/doc-update-map.md`。

## make-sample.js —— 样例生成

```bash
node scripts/make-sample.js --out examples [--seed <n>] [--date <YYYY-MM-DD>]
node scripts/make-sample.js --spec-template assets/templates/plant-spec-template.xlsx   # 只再生 --spec 预填模板
```

产出设备台账（6 台，SAP PM 技术对象列名：功能位置 / 设备 / 设备描述 / 对象类型 / 主体材质 / 型号编号 / 设计压力 / 设计温度 / 介质）、厂内制度表（5 条，含变更类型列，其中「备件代用」定重大变更与默认口径「待厂内评审」冲突 1 处，条款号用 `Q/XX-虚构-001`）、含无法识别条目的制度变体表，以及回归命令清单 `sample-cases.md`。
seed 只改变 SAP 设备编号与设计参数数值，**判定结论（类型、级别、冲突数、未判定数）不变**。

## selftest.js —— 自测

```bash
node scripts/selftest.js
```

293 条断言：规则引擎七类判定、undetermined 边界、描述具体性与解析、脚本正常路径与产出（十节、无 emoji、声明行）、不属于变更只能正面命中、厂内制度冲突、临时变更、设备台账（SAP 列名、设备编号命中）、参数校验、中石化口径（三大类 × 重大/一般 + 临时属性、管理变更）、R6 代用待评审、承压设备法定手续三项、归口与提报专业、U1 不被单个位号糊弄、厂内制度预填模板、交付对象与制度引用，以及 references / 模板与脚本口径一致性。
