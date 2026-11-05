# scripts 使用说明

## acceptance.js —— 主脚本

```bash
node "<技能目录>/scripts/acceptance.js" \
  --tag "<位号>" \
  --equip-type "<设备类型>" \
  --scope "<检修内容>" \
  --contractor "<承修单位>" \
  --repair-type <大检修|日常维修|抢修|专项> \
  --out "<输出目录>"
```

### 参数

| 参数 | 必需 | 说明 |
|---|---|---|
| `--tag` | 是 | 设备位号 |
| `--equip-type` | 是 | 设备类型。已覆盖：压缩机/机组、加热炉、空冷器、离心泵、换热器、塔器/容器、阀门、电机（按此优先级归类，空冷器不归换热器）；不在其中时只出通用框架并 warning |
| `--scope` | 是 | 检修内容。脚本据此识别解体／更换／焊接／清洗／防腐保温／对中／电气特征，决定条件性验收项与应附资料 |
| `--contractor` | 是 | 承修单位（报告中显示为"承修单位"） |
| `--repair-type` | 否 | 检修分级：大检修 / 日常维修 / 抢修 / 专项。旧值 大修→大检修、中修/小修→日常维修 自动映射并 warning；其它值报错；**不传为 null 并 warning，不默认**。只影响概况表与签字栏说明，不改变验收项 |
| `--out` | 否 | 输出目录，默认系统临时目录 `<os.tmpdir()>/ca-out`，**建议始终传 `--out`** |
| `--plan` | 否 | 检修方案，支持 `.docx`（随技能携带的 docx-lite 读取，表格行拆成文本）/ `.txt` / `.md` / `.csv` / `.xlsx` / CSV 目录。`.doc` 与 PDF 报错并提示另存或前置转换。提供后比对方案质量控制点与验收项 |
| `--records` | 否 | 验收记录 xlsx（工作表名含「验收记录」「验收」「检修记录」即可，EM「检修验收记录」导出可直接用），用于回填已填写的验收结果 |
| `--name` | 否 | 设备名称 |
| `--workshop` | 否 | 所属车间 |
| `--finished-at` | 否 | 完工时间，`YYYY-MM-DD` 或 ISO 8601 带时区 |
| `--no` | 否 | 验收单编号；不传时生成临时编号 `YS-<日期>-<位号>` 并在报告标注"以厂内编号为准" |
| `--pressure-test` | 否 | 开关。本次检修需试压/气密 → 生成试压类验收项与试压记录要求 |
| `--trial-run` | 否 | 开关。本次检修需试运 → 生成试运类验收项与试运（试车）记录要求；压缩机/机组、加热炉另要求联锁保护试验记录 |
| `--special-equipment` | 否 | 开关。属特种设备 → 生成法定检验资料与安全附件校验要求 |

### 产出

| 文件 | 内容 |
|---|---|
| `acceptance.json` | `meta`（含 `repairType / repairTypeRaw / planFormat / noProvided`）、`items`（验收项：序号、规则号、类别、验收内容、验收标准、验收方式、责任方、`result`）、`requiredRecords`、`qcPoints`/`qcMatched`/`qcGap`、`unqualified`、`undeterminedResult`、`unmatchedRecord`、`conclusion`、`signatures`（五方）、`counts`、`warnings` |
| `acceptance.md` | 九节验收报告 + 附，遗留问题段留 `<!-- ANALYSIS_START/END -->` 占位，末尾固定声明行；提示用「【注意】」，不用 emoji |
| `summary.json` | 末行摘要落盘（Windows 控制台乱码兜底） |

### 关键约定（与 SKILL.md 硬约束一致）

1. **`items[].result` 恒为 `null`**，除非 `--records` 中有对应的填写。脚本永不预填「合格」；`conclusion.result` 与五方 `signatures` 同样恒为 `null`。
2. **三级验收签字栏**：班组（一级）/ 车间（二级，车间设备员/设备主任）/ 公司设备管理部门（机动部/设备部，三级）/ 工艺（操作）/ 承修单位；**无监理**。大检修时公司设备部门栏标"必签"，其它分级标"按厂内规定"。
3. **设备类型不覆盖** → `meta.typeCovered=false`，只出通用框架，专用技术指标写「待技术人员补充」，报告开头醒目提示。此时**不得由模型补填任何数值**。
4. **`--plan` 的质量控制点逐条比对**：`qcMatched + qcGap` 恒等于 `qcPoints`，缺口逐条进 `warnings`，绝不静默忽略。未提供方案时三者均为 `null`（不按 0 计）；提供了方案但读不出控制点时 `qcPoints` 为 0、`qcMatched`/`qcGap` 为 `null`（未比对，缺口未知）并 warning。
5. **存在不合格项**时 md 开头出现「【注意】存在 N 项不合格……不得投用」；不存在时不出现该提示。
6. 验收结果只认明确写法：`合格/通过/符合/OK/√/是/已完成` → 合格；`不合格/未通过/不通过/不符合/整改/返工/NG/不达标` → 不合格；其他文字 → **未判定**并单列；空 → 保持 `null`。
7. 记录回填**优先按验收项名称匹配**（bigram Dice ≥ 0.5），序号仅作兜底；两者冲突时按名称并 warning。列名别名经 `C.mergeAliases` 并入共享系统别名（EM：验收项目 / 验收结论 / 问题描述）。
8. 验收标准一律写"按技术文件 / 方案执行"，不含任何数值。

### 退出码
- `0`：成功，末行输出 `{"ok":true,...}`
- `1`：失败，末行输出 `{"ok":false,"error":"...","warnings":[...]}`

## docx2text.js —— Word 方案转文本（随技能携带）

```bash
node scripts/docx2text.js --input <检修方案.docx> [--out <txt>]
```

与 permit-precheck-bridge、overhaul-process-check-bridge 中的同名脚本相同，仅用内置模块；主脚本内部已直接读 docx，本工具供人工查看方案全文或排查抽取问题。出错时末行 `{"ok":false,"error":"…"}` 退出码 1。

## make-sample.js —— 样例生成

```bash
node scripts/make-sample.js [--seed <n>]
```

生成 6 份样例：离心泵检修方案（txt，6 个质量控制点，1 个缺口）、验收记录（xlsx，2 不合格 / 1 未判定 / 1 未匹配）、EM 检修验收记录导出（xlsx，系统列名 + 标题行 + 合计行，1 不合格）、换热器检修方案（xlsx，4 个控制点全对应）、压缩机机组检修方案（docx，docx-lite 生成，5 个控制点全对应）、无控制点方案（txt）。seed 改变实测数值与人名，不改变结论。

## selftest.js —— 自测

```bash
node scripts/selftest.js
```

210 条断言，覆盖：验收项生成与五大类别、result 恒 null、声明行、三级验收五方签字无监理、承修单位口径、临时编号标注、设备类型不覆盖（含「不得出现经验数值」断言）、八类设备识别（空冷器不归换热器）与新增三类验收要点、保温/防腐恢复项不重复、方案控制点比对（txt / xlsx / docx 三种格式）与缺口、未提供方案不按 0 计、方案读不出控制点时 qcGap/qcMatched 为 null（不写成 []）、.doc / PDF / 损坏 docx 明确报错、不合格项【注意】提示出现与不出现、无 emoji、未判定与未匹配不静默、EM 导出列名、应附资料随检修内容增减（含质量验收记录 H/W 点、备件领用单、联锁试验记录）、试压/试运开关、检修分级映射（旧值 warning、非法报错、不传不默认）、参数校验、九节结构与占位符、summary.json 落盘、文档口径。全绿退出 0。
