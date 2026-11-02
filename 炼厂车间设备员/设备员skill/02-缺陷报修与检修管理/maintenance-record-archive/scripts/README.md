# scripts 使用说明

## archive.js —— 主脚本

```bash
node "<技能目录>/scripts/archive.js" \
  --tag "<位号或 SAP 设备编号>" --project "<项目名称>" --type <大检修|日常维修|抢修|专项> \
  --from <YYYY-MM-DD> --to <YYYY-MM-DD> \
  --materials "<材料清单xlsx或目录>" \
  --out "<输出目录>"
```

### 参数

| 参数 | 必需 | 说明 |
|---|---|---|
| `--tag` | 是 | 设备位号（功能位置）；提供 `--ledger` 时也可用 SAP 设备编号查台账（命中后按功能位置写出并 warning） |
| `--project` | 是 | 检修项目名称 |
| `--type` | 是 | 检修分级：大检修 / 日常维修 / 抢修 / 专项。旧值 大修→大检修、中修/小修→日常维修 自动映射并 warning；其它值报错 |
| `--materials` | 是 | 材料清单 xlsx（工作表名含「材料清单 / 资料清单 / 归档清单 / 材料」），或材料目录（递归扫描、跳过隐藏文件）。**只按文件名归类，不读文件内容** |
| `--from` / `--to` | 否 | 检修起止日期；`--to` 早于 `--from` 报错 |
| `--contractor` | 否 | 承修单位 |
| `--content` | 否 | 检修内容（写入 EM 履历建议的「检修内容」列） |
| `--ledger` | 否 | 设备台账，厂内台账（位号 / 设备名称）或 SAP PM 技术对象导出（功能位置 / 设备 / 设备描述 / 对象类型）；生成履历更新建议 |
| `--out` | 否 | 输出目录，默认系统临时目录 `<os.tmpdir()>/mra-out`，**建议始终传 `--out`** |
| `--special-equipment` | 否 | 特种设备，启用五项必备资料要求（检验报告、承压件材质证明、焊工资质与焊接记录、无损检测报告、耐压试验记录） |
| `--scope-material` | 否 | 涉及更换承压件 |
| `--scope-weld` | 否 | 涉及焊接 |
| `--scope-ndt` | 否 | 涉及无损检测 |
| `--scope-pressure` | 否 | 涉及试压 |
| `--scope-trial` | 否 | 涉及试运 |

### 产出

| 文件 | 内容 |
|---|---|
| `archive.json` | `meta`（含 `type / typeRaw / typeMapped`）、`counts`、`required`、`archived`、`missing`、`mandatoryMissing`、`unclassified`、`ledgerUpdate`、`warnings` |
| `archive.md` | 五节报告 + 附；有必备缺失时开头带「【注意】必备资料缺失 N 项，不满足归档要求」；末尾声明行；不用 emoji |
| `ledger-update.csv` | 履历更新建议一行（带 BOM），**按 EM 检修记录列头**：功能位置、设备编号、设备描述、检修类型、检修项目、检修内容、实际开始日期、实际结束日期、承修单位、归档资料数、缺失资料数、必备缺失数、备注；提供 `--ledger` 时生成 |
| `summary.json` | 末行摘要落盘 |

### 关键行为

1. **必备资料**：检修方案、作业许可（作业票）、检修记录卡、验收单对所有分级必备；大检修另含检修总结；特种设备另含五项。缺失即 `mandatoryMissing`，开头提示由脚本写入，模型不得删除或弱化。
2. **文件名无法归类** → `unclassified` 单列，不按文件名猜测强行归类。
3. **台账只出建议**：`ledger-update.csv` 由用户确认后录入 EM/台账，脚本不改写用户文件；位号与设备编号均未命中 → warning + md【注意】提示先确认位号。
4. **列名别名**经 `C.mergeAliases` 并入共享系统别名：功能位置 → 位号；设备 / 设备编码 / 技术对象编号 → 设备编号（单独成列，不再作位号别名）；设备描述 / 技术对象描述 → 设备名称。
5. **检修分级不默认**：缺 `--type` 报错；旧值映射 warning 并在概况表显示原填值。

### 退出码
- `0`：成功
- `1`：失败（缺必需参数、非法分级、材料不存在、日期非法、`--to` 早于 `--from`、无材料清单表）

## lib/archive-spec.js —— 归档规范表

```js
const S = require('./lib/archive-spec');
S.normRepairType('大修');                                   // {type:'大检修', raw:'大修', mapped:true}
S.requiredMaterials('大检修', {weld:true, ndt:true}, true);  // 应归档清单
S.classify('焊工资质证明.pdf', required);                    // → ['seWeld']
```

口径见 `references/archive-spec.md`，两者同源。

## make-sample.js

```bash
node scripts/make-sample.js --out examples [--seed <n>]
```

生成 5 份样例：主材料清单（11 份材料 + 1 份无法归类，作业票按作业许可系统命名）、日常维修齐全变体、材料极少变体、厂内设备台账、SAP PM 技术对象导出台账。

## selftest.js

```bash
node scripts/selftest.js
```

132 条断言，覆盖：规范表单元测试（四档分级、旧值映射、方案与作业票必备、大检修追加项、抢修/专项追加项）、必备缺失提示的出现与不出现（【注意】无 emoji）、分级旧值映射 warning 与非法值报错、待认领不强行归类、目录递归扫描、台账履历（厂内台账 / SAP 导出 / 按设备编号命中 / EM 列头 CSV）、范围开关、14 条参数校验、合计行与空文件名、产出完整性与字段名对齐、文档口径。
