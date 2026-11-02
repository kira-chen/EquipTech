# scripts 使用说明

> **分工**：读图识别由**模型**完成（识别值由模型读图产生，未经脚本验证），`intake.js` 只做识别结果的**后处理**——字段对齐台账（SAP PM / EM 列名）、铭牌原文 raw 量级校验、单位换算校验、与台账现值比对查重、置信度校验、生成待确认录入行。**脚本不读取图片，也不修改用户台账文件。**

## intake.js —— 主脚本

```bash
node "<技能目录>/scripts/intake.js" \
  --fields "<识别结果JSON或json文件路径>" \
  --tag "P-1101A" \
  --equip-type "泵" \
  --ledger "<台账xlsx>" \
  --out "<输出目录>"
```

### 参数

| 参数 | 必需 | 说明 |
|---|---|---|
| `--fields` | 是 | 模型识别出的铭牌字段 JSON，或存放该 JSON 的 `.json` 文件路径（推荐，避免命令行转义）。格式见 `references/input-spec.md`，clear/blurry 字段须带 `raw` 铭牌原文 |
| `--tag` | 是 | 设备位号（功能位置），**必须由用户提供**。缺失时报错终止，脚本不从照片、喷漆字或文件名推断。也可给 SAP 设备编号：按台账「设备编号」列命中并标注，不把它当位号 |
| `--equip-type` | 是 | 设备类型：泵 / 电机 / 压缩机 / 换热器 / 容器 / 阀门 / 仪表（支持英文与常见别名）。无法归类时报错，不按通用兜底 |
| `--ledger` | 否 | 设备台账 xlsx 或 CSV 目录（SAP PM 技术对象清单 / EM 导出 / 车间自维护台账），**只读**，用于查重与字段比对；不提供则 `conflicts` 为 `null` |
| `--out` | 否 | 输出目录，默认系统临时目录 `<os.tmpdir()>/noi-out`，**建议始终传 `--out`** |
| `--photo` | 否 | 铭牌照片文件名，仅写入报告头部；也可写在 `--fields` 的 `photo` 字段 |

### `--fields` 格式要点

```jsonc
{
  "photo": "P-1101A铭牌.jpg",
  "fields": [
    {"name":"制造厂","value":"大连耐酸泵厂","confidence":"clear","raw":"大连耐酸泵厂"},
    {"name":"设计压力","value":"4.0","confidence":"clear","unit":"MPa","raw":"4.0MPa"},
    {"name":"效率","value":"72.5","confidence":"blurry","unit":"%","reason":"油污遮挡小数位","raw":"72.▢%"},
    {"name":"汽蚀余量","value":null,"confidence":"unreadable","reason":"锈蚀脱漆无法辨认"}
  ]
}
```

**每个字段必须带 `confidence`，三档之一**：`clear`（清晰可读）/ `blurry`（部分模糊需核对）/ `unreadable`（无法辨认，`value` 必须为 `null`）。缺置信度、置信度非法、或 `unreadable` 却带值 → **报错终止**。

**`raw`（铭牌原文）对 clear / blurry 字段必填**：缺失 → warning + `rawMissing:true`，建议录入行注明"未做量级校验"；识别值中的数字与 raw 不一致且相差 10 的整数倍 → 疑似小数点错位，**改判 blurry**；不一致且无倍数关系 → warning；raw 含 ▢ 时不做数字比对。

### 产出

| 文件 | 内容 |
|---|---|
| `intake.json` | `fields`（逐字段识别与对齐结果，含 `raw` / `rawMissing` / `rawCheck`）、`needVerify`、`unreadable`、`conflicts`、`unmapped`、`unitIssues`、`rawIssues`、`proposed`、`counts`、`meta`（含 `ledgerMatchedBy` / `ledgerTag` / `ledgerEquipNo` / `recognitionNote`）、`warnings` |
| `intake.md` | 七节录入建议报告（需人工核对项含 3.1 识别模糊 / 3.2 单位 / 3.3 raw 量级校验），含固定声明行与 `<!-- ANALYSIS_START/END -->` 占位 |
| `intake.csv` | 待确认录入行，**UTF-8 带 BOM**（Excel 直接打开不乱码）；模糊项与冲突项的建议录入值留空 |
| `summary.json` | 末行摘要落盘（Windows 控制台乱码兜底） |

`counts` 字段：`fields` `clear` `blurry` `unreadable` `conflicts`（无台账为 null）`unmapped` `unitIssues` `rawMissing` `rawIssues` `templateMissing`。

### 退出码
- `0`：成功，末行输出 `{"ok":true,...}`
- `1`：失败，末行输出 `{"ok":false,"error":"...","warnings":[...]}`

### 几条不做的事

- **不读图**：识别值由模型读图产生，脚本只校验不验证识别正确性；raw 量级校验只能发现"识别值与模型自己抄录的原文对不上"。
- **不猜模糊字符**：`▢` 原样进报告，`blurry` 字段的建议录入值一律留空。
- **不自动换算单位**：只做校验并给换算参考值，`value` 保持铭牌原值。
- **不自动覆盖台账**：位号已存在且参数不一致时，逐项列出差异与两种可能（识别错误 / 设备已更换）交用户判断；相差 10 的整数倍提示疑似小数点错位。
- **不修改台账文件**：`--ledger` 只读；正式录入走 EM / SAP 主数据维护流程。
- **不把设备编号当位号**：SAP「功能位置」是位号，「设备」是 8 位流水号，分列；按设备编号命中时单独标注。
- **不补铭牌上没有的参数**：制造日期**不会**写进台账的「投用日期」列；SAP「建造年份」也不对齐制造日期。

别名表 = 局部别名 + 共享 `SYSTEM_ALIASES`（`C.mergeAliases`）：功能位置 → 位号；设备 → 设备编号；设备描述 → 设备名称；制造商 → 制造厂；型号编号 → 规格型号；制造商序列号 → 出厂编号；设备代码 / 注册代码 → 设备代码；工作表名含「技术对象」「功能位置」亦可识别。

## make-sample.js —— 样例生成

```bash
node scripts/make-sample.js --out examples [--seed <n>]
```

生成 6 份样例：主台账（车间自维护列名，含合计行）、别名列头台账变体、SAP PM 技术对象清单（功能位置 / 设备 / 设备描述 / 对象类型 / 制造商 / 型号编号 / 制造商序列号 / 建造年份 / 设备代码 / 工厂区段 / ABC标识）、泵 / 电机 / 容器三份识别结果 JSON（全部字段带 raw，容器样例含设备代码且故意漏抄 1 项 raw）。
seed 改变数值但不改变结论：泵样例恒 2 blurry、2 unreadable、配主台账 3 冲突、配 SAP 台账 2 冲突（制造日期列 SAP 没有）；电机样例恒 1 blurry、1 unreadable、2 项单位需核对、位号不在台账（新增建档）；容器样例恒全 clear、0 冲突、1 项 raw 缺失（腐蚀裕量）、设备代码与 SAP 台账一致。

## selftest.js —— 自测

```bash
node scripts/selftest.js
```

191 条断言，覆盖：三档置信度与全部非法输入、模糊字符不猜测、位号必须用户提供、台账冲突不自动覆盖、台账文件字节未被修改、单位校验不换算、不补铭牌外参数、声明行、csv BOM 与冲突留空、设备类型识别、别名列头/标题行/合计行/缺列/缺位号列/台账空值、参数校验、产出完整性；本轮新增：新声明行（模型读图产生、未经脚本验证）出现且旧声明行不出现、raw 必填（缺失 warning / 量级错位改判 blurry / 不一致 warning / 原文无数字 / unreadable 不要求）、SAP PM 列名（功能位置为位号、「设备」流水号单列、制造商 / 型号编号 / 制造商序列号对齐、建造年份不作投用日期）、按设备编号命中台账并标注、设备代码字段对齐、md 无 emoji。全绿退出 0。
