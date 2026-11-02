# scripts 使用说明

## find.js —— 主脚本

```bash
node "<技能目录>/scripts/find.js" \
  --docs "<资料目录或文件>" \
  --tag "<位号>" \
  --query "<查询内容>" \
  --out "<输出目录>"
```

### 参数

| 参数 | 必需 | 说明 |
|---|---|---|
| `--docs` | 是 | 技术资料目录（递归扫描，最多 6 层）或单个文件 |
| `--tag` | 是 | 设备位号（功能位置）或名称；比对时大小写与 `- _ · . /` 不敏感；配 `--ledger` 时也可给 SAP 设备编号 |
| `--query` | 否 | 查询内容；不给则只做资料定位，不抽原文 |
| `--out` | 否 | 输出目录，默认系统临时目录 `<os.tmpdir()>/tdf-out`，**建议始终传 `--out`** |
| `--ledger` | 否 | 设备台账 xlsx（SAP PM 技术对象清单 / EM 导出均可），用设备描述与型号编号补充关联线索；位号与设备编号都可命中并标注命中依据 |
| `--doc-type` | 否 | `图纸` / `说明书` / `规程` / `技术协议` / `检验报告`，只返回该类型 |
| `--context` | 否 | 摘录上下文字数，默认 60（只影响 `excerpt`，`text` 始终是完整段落） |
| `--all-matches` | 否 | 返回全部命中段落；默认最多 30 段 |
| `--max-files` | 否 | 扫描文件数上限，默认 300；超过直接 `ok:false` 报错，**不静默截断**（请按装置/设备分目录或显式提高） |

### 产出

| 文件 | 内容 |
|---|---|
| `matches.json` | `documents`（含 `convertedFrom`）/ `passages`（含 `convertedFrom`）/ `conflicts` / `unreadable` / `unrelated` / `catalogOnly` / `counts` / `meta`（含 `pdfNote`、`maxFiles`） |
| `matches.md` | 六至七节报告，含转换文本【注意】提示、版本声明行与 `<!-- ANALYSIS_START/END -->` 占位 |
| `summary.json` | 末行摘要落盘（Windows 控制台乱码兜底） |

`counts` 字段：`filesScanned` `maxFiles` `catalogFiles` `oldOfficeFiles` `documentsRelated` `documentsContentSearchable` `documentsConverted` `documentsNoTextLayer` `passages` `passagesTotal` `conflicts` `unreadable` `unrelated` `catalogOnly`。

### 退出码
- `0`：成功，末行输出 `{"ok":true,...}`
- `1`：失败，末行输出 `{"ok":false,"error":"...","warnings":[...]}`（资料路径不存在、缺 `--tag`、非法 `--doc-type`、目录下无文件、文件数超过 `--max-files` 等）

### 四条必须知道的行为

1. **PDF 统一前置转换**（SKILL.md / README / input-spec 三处同一口径）：脚本不读 PDF。请先用平台 pdf 技能转为 txt/docx 再传入，扫描件需先 OCR；转换产物按「原名.pdf.txt / .pdf.docx / .pdf.md」命名放同一目录，脚本识别为该 PDF 的转换文本：可检索、沿用目录清单中 PDF 的版本与存放位置、引用处标注"PDF 转换文本，须核对原件"、顶部【注意】提示份数，并且该 PDF 不再算"登记但无实体文件"。未转换的 PDF、图片、CAD 进 `unreadable`，`contentSearchable: false`、`paragraphs: null`，**绝不产生 `passages` 条目**。
2. **.doc / .xls / .ppt 不解析**：旧版 Office 二进制格式进 `unreadable`，原因写明"请另存为 .docx / .xlsx 后传入"；未识别的其他格式出 warning，不静默跳过。
3. **命中为空不放宽**。设备无关联资料或查询词无命中时，`counts` 如实为 0，md 写明「所提供资料中未找到……」并声明未用通用知识、未用其他设备资料代替。
4. **取值不一致全列不取其一**。同一关键词、同一单位、不同文件出现不同数值时进 `conflicts`，两个取值与各自出处、版本全部列出，附「未自行取其一，请核实资料版本」。

别名表 = 局部别名 + 共享 `SYSTEM_ALIASES`（`C.mergeAliases`）：资料目录清单的「功能位置」可作关联位号；设备台账的「功能位置」→ 位号、「设备」→ 设备编号（SAP 流水号，单列）、「设备描述」→ 设备名称、「型号编号」→ 规格型号；工作表名含「技术对象」「功能位置」也可识别。

## make-sample.js

```bash
node scripts/make-sample.js --out examples [--seed <n>]
```

生成一套资料样例：`sample-docs/` 下含真实 `.docx` 说明书（力矩 45N·m）、`.md` 检修规程（同一项写 50N·m，构造版本冲突）、`.txt` 技术协议、其他设备的 `.md` 说明书、伪 PDF 装配图与 PNG 铭牌照片（验证只定位不读内容）、伪 PDF 水压试验报告 + 同名 `.pdf.txt` 转换文本（验证前置转换路径）、伪 `.doc` 旧版说明书、资料目录清单 xlsx（含一条已登记但无实体文件的「性能曲线」）；`examples/` 下另有资料目录清单与 SAP PM 列名的设备台账 xlsx。

`--seed` 只改厂家、型号与 SAP 设备编号等表面数值，**文件构成、版本冲突、未解析文件数不变**。

## selftest.js

```bash
node scripts/selftest.js
```

144 条断言，覆盖：正常检索与产出完整性、未解析文件（PDF/图片）只定位不读内容与前置转换指引、命中为空与设备无资料、版本冲突、关联判定四种依据、资料目录清单与 catalogOnly、空文件与 docx 解析失败、资料类型过滤与未判定、截断与 `--all-matches`、参数校验、单文件输入与 `--context`；本轮新增：PDF 转换文本识别（`convertedFrom`、版本沿用、引用标注、【注意】提示、catalogOnly 不重复计）、.doc/.xls 进 unreadable 并提示另存、未识别格式 warning、`--max-files` 超限报错与校验、SAP PM 台账列名（功能位置/设备/设备描述/型号编号、按设备编号命中）、声明行含"转换文本由模型读取产生、未经脚本验证"、md 无 emoji。
