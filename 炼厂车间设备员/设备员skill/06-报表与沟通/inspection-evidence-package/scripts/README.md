# scripts 使用说明

## evidence.js —— 主脚本

```bash
node "<技能目录>/scripts/evidence.js" \
  --notice "<检查通知或检查表路径>" \
  --materials "<台账与记录目录或清单xlsx>" \
  --workshop "<车间名>" \
  --date-range "<YYYY-MM-DD~YYYY-MM-DD>" \
  --out "<输出目录>"
```

### 参数

| 参数 | 必需 | 说明 |
|---|---|---|
| `--notice` | 是 | 检查通知或检查表：`.docx` / `.xlsx` / `.md` / `.txt`。**PDF 先用平台 pdf 技能转为 txt/docx 再传入（扫描件需 OCR），脚本不读 PDF** |
| `--materials` | 是 | 台账与记录目录（递归扫描），或资料清单 `.xlsx` |
| `--workshop` | 是 | 车间名称 |
| `--inspection` | 否 | 检查名称，写入报告头部 |
| `--date-range` | 否 | 检查期 `起~止`；**不提供则完全不做时间覆盖判定**并 warning |
| `--scope` | 否 | 检查范围说明，仅写入报告头部 |
| `--spec` | 否 | 厂内资料归档规范文件，仅登记；文件不存在时报错 |
| `--last` | 否 | 上次同类检查的资料包目录，仅登记；目录不存在时报错 |
| `--out` | 否 | 输出目录，默认系统临时目录 `<os.tmpdir()>/iep-out`，**建议始终传** |

### 产出

| 文件 | 内容 |
|---|---|
| `evidence.json` | items、ready、missing、partialCoverage、unmatched、materials、counts、meta.statement |
| `evidence.md` | 七节报告；有缺口时开头带醒目提示；末尾固定声明行；分析段留占位 |
| `资料清单.xlsx` | 四个工作表：资料对照、缺口清单、未对应材料、声明 |
| `summary.json` | 末行摘要落盘（Windows 控制台乱码兜底） |

### 退出码
- `0`：成功，末行输出 `{"ok":true,...}`
- `1`：失败，末行输出 `{"ok":false,"error":"...","warnings":[...]}`
  （含通知/材料不存在、检查期格式非法或起止倒置、工作表无法识别、解析不出任何检查项、通知格式不支持）

### 关键行为（不得靠模型绕过）

1. **缺口醒目提示**：存在「未找到对应材料」的检查项时，`evidence.md` 在第一节之前写入
   `【注意】存在未找到对应材料的检查项，缺口项须如实向检查组说明；不得用相近材料充数，不得事后补编记录`，
   并写明缺口数量。该提示由脚本直接写入，**模型不得删除或弱化**。
2. **缺失绝不充数**：`missing` 项的 `evidence` 恒为空数组，报告中不出现任何「可用 XX 替代」式表述。
3. **覆盖不全不按齐全处理**：材料时间不详、部分覆盖、无交集，三种情形一律进 `partialCoverage`。
4. **声明行**：`evidence.md` 末尾固定写入
   `本清单基于所提供材料比对生成，资料的真实性、完整性由车间负责；缺失资料应如实说明，不得事后补编记录。`
   同句也写入 `evidence.json` 的 `meta.statement` 与 `资料清单.xlsx` 的「声明」表。
5. **不判合规**：脚本只判资料在不在、覆不覆盖检查期，**不输出任何达标/合规结论**。
6. **单端日期推断**：资料清单只填了起始或截止一端时，另一端按文件名推断（`periodBasis` 标「清单填报+文件名推断」并 warning 请核对）；推不出则保持 null 并按已填一端判覆盖，不猜。
7. **无 emoji**：产出 md 醒目提示一律用「【注意】」。

## lib/evidence-spec.js —— 比对规则表

```js
const S = require('./lib/evidence-spec');
S.itemCategories('设备台账是否建立健全');        // → ['ledger']
S.matchItem('特种作业人员是否持证上岗', '设备台账.xlsx');  // → {matched:false}
S.coverage({from:'2026-07-01',to:'2026-09-30'}, null, null); // → 'unknown'
```

口径见 `references/evidence-rules.md`，两者同源。资料类别 25 类（2026-10-26 补 变更管理 MOC / 安全仪表与联锁 SIS / 特护设备 / 润滑五定三过滤 / LDAR / 一机一档，作业票类补「用火」「作业许可」）。匹配从严：只认「同一具体资料类别」与
「具体特征词直接命中」两种依据，泛词（设备/记录/台账/车间/资料）一律不构成匹配。与 `regulation-compliance-check` 的 compliance-spec.js（25 类）不是同一张表，差异见 evidence-rules.md 第八节。

## docx2text.js —— docx 文字层导出（排障用）

```bash
node scripts/docx2text.js --input <检查通知.docx>
```

主脚本内部直接调用 `lib/docx-lite.js` 解析 docx；本脚本用于人工确认 Word 检查表的文字层读出效果。

## make-sample.js —— 样例生成

```bash
node scripts/make-sample.js --out examples [--seed <n>]
```

生成 8 份样例：主检查表（10 项，含标题行与检查类别列）、主资料清单、齐全变体（检查表+清单）、
材料极少变体、Markdown 文字通知、中石化设备管理专项检查变体（MOC / 联锁 / 特护 / 五定三过滤 / LDAR / 一机一档 / 用火作业票，7 项：5 齐全、2 缺口）。
seed 改变文件编号与措辞，但结论不变：主样例配检查期 `2026-07-01~2026-09-30` 恒为
**7 项齐全、2 项未找到对应材料、1 项覆盖不全、1 份未对应材料**。

## selftest.js —— 自测

```bash
node scripts/selftest.js
```

139 条断言，覆盖：规则表单元测试（含 25 类与 MOC / 联锁 / 特护 / 润滑 / LDAR / 一机一档 / 用火 的归类与不充数）、缺失绝不充数、缺口醒目不淡化（「【注意】」、无 emoji）、覆盖不全的四种情形
（部分/无交集/时间不详/日期无法解析）、单端日期按文件名推断与推不出不猜、未指定检查期、正反对照（有无缺口）、声明行、
不判合规、未对应材料不强行对应、md/目录/合计行/别名表头/空行解析、参数校验（含 PDF 前置提示）、产出结构完整性。
全绿退出 0。
