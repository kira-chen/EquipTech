# scripts 使用说明

## detect.js —— 主脚本

```bash
node "<技能目录>/scripts/detect.js" \
  --input "<工单台账xlsx[,第二个文件,...]>" \
  --workshop "<车间名>" \
  [--from <YYYY-MM-DD>] [--to <YYYY-MM-DD>] \
  --out "<输出目录>"
```

### 参数

| 参数 | 必需 | 说明 |
|---|---|---|
| `--input` | 是 | 工单台账 / 故障记录 / SAP 通知单（订单）导出 xlsx，或同结构 CSV 目录；**多文件用逗号分隔**（按装置分文件时直接一起传），任一文件不存在报错，某文件无故障表则跳过并 warning |
| `--workshop` | 是 | 车间名称，写入报告标题；输入带车间列时按它核对车间范围 |
| `--to` | 否 | 统计区间截止日 YYYY-MM-DD，默认当日（北京时间） |
| `--from` | 否 | 统计区间起始日 YYYY-MM-DD，默认 `--to` 往前 12 个自然月的次日（「一年内」），默认时 warning 说明；晚于 `--to` 时报错 |
| `--out` | 否 | 输出目录，默认系统临时目录 `<os.tmpdir()>/rfd-out`，**建议始终传 `--out`** |
| `--min-count` | 否 | 同设备同部位重复次数阈值，≥2 的整数，默认 **2**（同一设备同一部位一年内 ≥2 次）；同现象/同代码阈值 = max(2, 该值 - 1) |
| `--ledger` | 否 | 设备台账 xlsx（支持 SAP 技术对象列名），补全设备编号、型号与设备类型以支撑同型号共性故障判定 |
| `--by` | 否 | 第三节归类维度：`equipment`（默认）/ `model` / `part` |
| `--similarity` | 否 | 现象文本相似度阈值，0~1 之间，默认 0.55；带 SAP 损坏代码的记录不走文本相似 |

建议统计区间 6~12 个月（180~365 天）。短于 180 天会 warning 提示可能漏判，长于 365 天会 warning 提示可能掺入已整改的历史问题，均不阻断执行。

### 归类顺序

1. **SAP 损坏/故障代码优先**：两条记录都有代码时，代码相同即归同组（相似度 1），代码不同即不归组（相似度 0），不再看文本。
2. 任一方无代码：按 现象文本 bigram 相似度 × 0.5 + 故障部位（对象部件归一后）相同 × 0.3 + 现象类型相同 × 0.2 比对。
3. 带代码的记录即使短文本为空或只写「故障」，也不列入无信息量；无代码且文本笼统的记录列入 `uninformative`，不参与判定。

### 产出

| 文件 | 内容 |
|---|---|
| `repeats.json` | `byEquipment`（同设备重复故障组，含 SAP 设备编号、损坏/原因代码、通知单号）、`byModel`（同型号共性故障）、`topFrequency`（故障频次排行）、`shorteningInterval`（间隔缩短设备）、`uninformative`（现象无信息量，未参与判定）、`counts`、`meta`（含 `fileStats` 逐文件行数、`fromDefaulted`、两行声明、`workshopScope`）、`warnings` |
| `repeats.md` | 七节报告，开头两行声明，分析段留 `<!-- ANALYSIS_START/END -->` 占位，提示用「【注意】」 |
| `summary.json` | 末行摘要落盘（Windows 控制台乱码兜底） |

### counts 字段

| 字段 | 含义 |
|---|---|
| `files` | 输入文件数 |
| `records` | 区间内故障记录总数（含无信息量的） |
| `valid` | 参与重复判定的记录数 |
| `withCode` | 参与判定记录中带 SAP 损坏/故障代码的条数 |
| `equipment` | 涉及设备台数 |
| `repeatEquipment` | 命中重复故障（D1 或 D2）的设备数 |
| `modelGroups` | 同型号共性故障组数（D3） |
| `shortening` | 故障间隔缩短的设备数（D4） |
| `uninformative` | 故障现象无信息量、未参与判定的记录数（U1） |
| `outOfRange` | 故障时间落在统计区间外被跳过的记录数 |

### 车间范围核对（D007）

每个输入文件的故障记录表带车间列（表头为车间 / 所属车间 / 属地车间 / 运行部，或其后加「名称」）时，剔除其他车间的记录并 warning（先于统计区间过滤）；车间为空的行保留；没有一行是本车间时不筛，warning 与 md 开头写【注意】；无车间列或只有「维护工厂」「车间负责人」这类列时不筛，md 口径写「输入未含车间列，车间范围以取数条件为准」。`meta.workshopScope` 为数组，每个文件一项（sheet、status `noColumn|checked|mismatch`、column、total、kept、dropped、droppedRows、blank）。

### 退出码
- `0`：成功，末行输出 `{"ok":true,...}`
- `1`：失败，末行输出 `{"ok":false,"error":"...","warnings":[...]}`

## lib/detect-rules.js —— 判定规则引擎

可单独 require 做单元测试：

```js
const R = require('./lib/detect-rules');
R.checkInformative('故障');              // {uninformative:true, reason:'故障现象仅填写「故障」，无具体现象信息'}
R.checkInformative('故障', 'LEAK01');    // {uninformative:false, byCode:true}   有 SAP 代码即有信息量
R.classifyPhenomenon('管束内漏');        // 'leak'
R.normPart('对象部件：轴瓦');            // '轴承'
R.similarity(
  {desc:'机封滴漏', part:'机封', phenomenon:'leak', faultCode:'LEAK01'},
  {desc:'密封端面渗出', part:'机械密封', phenomenon:'other', faultCode:'LEAK01'}
);
// → {score:1, byCode:true, matchBasis:['SAP 损坏/故障代码同为「LEAK01」（代码优先于文本相似）','故障部位同为「机械密封」'], ...}
R.DEFAULT_PART_MIN;                      // 2
R.DEFAULT_PERIOD_MONTHS;                 // 12
```

口径见 `references/detection-rules.md`。规则号 D1~D4、U1 可追溯。

## make-sample.js —— 样例生成

```bash
node scripts/make-sample.js [--seed <n>] [--to <YYYY-MM-DD>]
```

生成 6 份样例：主样例（工单台账，覆盖 D1~D4 与无信息描述）、第二装置分文件（与主样例合并验证多文件）、设备台账、全无信息描述变体、MES 导出风格变体、**SAP 通知单导出变体**（功能位置/设备/对象部件/损坏代码/原因代码/通知单短文本/通知日期）。
seed 只改变滴漏滴数与处理方式措辞，不改变结论：主样例在 12 个月区间、默认阈值 2 次下恒为 3 台设备命中重复故障、1 组共性故障、1 台间隔缩短、2 条无信息量；与 unit2 合并后共性故障扩为 3 台 4 次；SAP 样例恒为 2 台命中（按代码归类）、0 条无信息量。

## selftest.js —— 自测

```bash
node scripts/selftest.js
```

232 条断言，覆盖：无信息描述识别（含有代码即有信息）、现象与部位归一、相似度与 matchBasis（代码相同/不同/仅一方有）、D1/D2 基础判定（默认 2 次）、声明行两行、无信息不参与判定、D3 共性故障、频次与间隔、D4 间隔缩短、`--by` 三维度、`--min-count` 抬高阈值、统计区间与区间外、缺字段、设备台账（SAP 列名）、别名与合计行、参数校验、`--similarity`、产出结构、SAP 通知单导出（代码优先归类、对象部件作部位、原因代码不混、通知单号）、多文件合并与跳过、默认「一年内」区间与默认输出目录、别名收窄（裸「编号」不当工单号、「设备」作设备编号）、车间范围核对（混合剔除、空车间保留、全不一致【注意】、无车间列、维护工厂不认、「所属车间」同样核对、多文件逐个核对）、演示case 预期计数。全绿退出 0。
