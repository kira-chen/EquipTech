# 输入规格：设备专业知识问答

## 一、问题（必需，`--question`）

用户提出的设备专业问题原文。**原样传入，不要替用户改写或"翻译"成更规范的问法**——改写会改变分类结果。

- 空白 / 只有空格 → `ok:false` + exit 1
- 分类规则见 `qa-rules.md` 第一节，实现在 `scripts/lib/rules.js`

### 检索词怎么切出来的

中文问句不带空格，整句当一个检索词必然命中不了，所以脚本分两步：

1. **剥噪声**：去掉疑问词与语气词（请问、帮我、什么是、为什么、怎么、多少、应该、一般、的、吗……）
2. **滑窗切词**：剩下的中文片段按 4→3→2 字滑窗切成候选词，长词排在前；英文与数字片段整体保留。≤4 字的片段也切：片段本身排最前，再跟 3 字、2 字词（「厂备用泵」→ 厂备用泵、厂备用、备用泵、厂备、备用、用泵），否则「我们厂备用泵」剥噪声后剩下的「厂备用泵」在资料里检索不到

命中展示时做**重叠折叠**：同一段里同时命中「机泵备用件」「机泵备用」「备用件」时，只保留最长的几个，短片段丢掉。

**候选词只用于在资料里检索，不参与任何数值判定。** 问题分类走的是 `rules.js` 的正则规则表，与切词无关。

剥完噪声后一个 ≥2 字的词都不剩（例如问题就是「为什么」三个字）→ warning 提示无有效检索词，仅做问题分类，不检索资料。

## 二、厂内资料（可选，`--docs`）

一个目录（递归扫描，最多 6 层）或单个文件。`.` 开头的隐藏文件与 `~$` 开头的 Word 临时文件一律跳过。

| 格式 | 内容可检索 | 说明 |
|---|---|---|
| `.docx` | 是 | 用 `lib/docx-lite` 抽文字层，段落与表格都进检索范围 |
| `.md` | 是 | 按行切段 |
| `.txt` | 是 | 按行切段 |
| `.pdf` | **否** | 一律不解析内容，只做文件定位并 warning。**统一前置步骤：PDF 先用平台 pdf 技能转为 txt/docx 再传入，脚本不读 PDF；扫描件需 OCR** |
| `.png` `.jpg` `.jpeg` `.gif` `.bmp` `.tif` `.tiff` | **否** | 图片格式，无文字层 |
| `.dwg` `.dxf` | **否** | CAD 原图，无文字层可供本脚本检索 |
| `.xlsx` `.xls` `.csv` | **否** | 表格文件，**本技能不作为资料原文**；资料目录定位请用 `technical-document-finder` |
| 其他扩展名 | **否** | 不解析，仅做文件定位并出 warning |

**PDF 与图片一律不解析内容**：即使是电子版可复制文字的 PDF 也不读，统一按「无文字层」处理，进 `unreadable`、`contentSearchable: false`、`paragraphs: null`、出 warning（warning 原文带前置步骤提示），**绝不产生 `passages` 条目**。需要用 PDF 规程时，先用平台 pdf 技能转成 txt/docx 放进 `--docs` 目录再跑。

**引用范围**：`qa.json` 的 `documents` 就是本次允许引用的全部文件清单（`meta.citeScope = 'docs-only'`）。回答里任何引用都必须能在这份清单里找到文件名；平台开放 Grep/Glob 时也只许在 `--docs` 目录内用。

### 段落编号

文字层按行切分，空行跳过，序号从 1 开始连续编号。引用出处写成「文件名 + 第 N 段」。`.docx` 的表格以 `|` 分隔单元格，段号照常连续。

### 不提供资料时

`--docs` 可以不给。此时：

- `meta.docsProvided: false`，`counts.filesScanned: 0`
- 「二、厂内资料原文」一节明写「未提供厂内资料，本节无内容」，**不用通用原理填充该节**
- 数值标准类 → 只指路，不给数
- 本厂规定类 → 明确无法回答
- 原理概念类 → 可按通用原理作答，整段带标注

## 三、设备类型（可选，`--equip-type`）

只接受：`泵` / `压缩机` / `风机` / `换热器` / `容器` / `塔` / `管道` / `阀门` / `电机` / `仪表` / `机组` / `加热炉`。其他取值 → `ok:false` + exit 1。

仅写进 `meta.equipType` 供回答时带上语境，**不参与分类判定，也不影响检索**。

## 四、上下文字数（可选，`--context`，默认 60）

只影响 `passages[].excerpt` 的截取长度。`passages[].text` **始终是完整段落原文**——引用给用户时用 `text`，`excerpt` 只用于长段落预览。非负数字以外的取值 → `ok:false` + exit 1。

## 五、全部命中（可选，`--all-matches`）

默认最多返回 20 段命中；超出时截断并 warning（`passagesTotal` 如实记录总数）。加 `--all-matches` 返回全部。

## 六、会被跳过 / 单列的内容

- 没有文字内容的文本文件 → `unreadable`，原因「文件内无文字内容」
- 解析失败的 `.docx`（损坏、不是真 zip）→ `unreadable`，原因「解析失败：<原因>」，**不中断整体检索**
- 表格文件 → `unreadable`，原因「表格文件，本技能不作为资料原文检索」
- 无文字层文件 → `unreadable` + `documents`（`contentSearchable: false`），只做文件定位

## 七、产出

| 文件 | 内容 |
|---|---|
| `qa.json` | `questionType` / `classification` / `passages` / `sources` / `guidance` / `counts` / `documents` / `unreadable` / `meta` / `warnings` |
| `qa.md` | 七至八节报告，含声明行与 `<!-- ANALYSIS_START/END -->` 占位 |
| `summary.json` | 末行摘要落盘（Windows 控制台乱码兜底） |

### `meta` 新增字段

| 字段 | 含义 |
|---|---|
| `citeScope` | `docs-only`（给了 `--docs`）或 `none`：引用只能来自 `--docs` 范围 |
| `principleMaxChars` | 通用原理段长度上限（字），当前 300 |
| `pdfNote` | PDF 前置步骤提示原文 |

### `classification` 关键字段

| 字段 | 含义 |
|---|---|
| `questionType` | `numeric` / `plant` / `principle` / `undetermined` |
| `ruleId` | 命中的首条规则号，可倒查 `rules.js` |
| `basis` | 判定依据的中文说明，列出全部命中规则 |
| `notice` | 该类的固定表述，**一字不改地说给用户** |
| `matched` | 三组规则各自命中了哪些条，全部保留（可追溯） |
| `mixedPrinciple` | 数值/本厂类问句中是否同时含原理成分 |
| `requiresPlantDocs` | 是否必须有厂内资料才能回答 |
| `blockedFromAnswer` | 是否一律不得给出记忆中的答案（数值类恒为 true） |

### `guidance` 关键字段

| 字段 | 含义 |
|---|---|
| `canAnswer` | 能否给出实质回答 |
| `answerBasis` | `plant-docs` / `general-principle` / `none` |
| `generalPrincipleAllowed` | 是否允许用通用原理作答 |
| `mustSay` | 必须说给用户的句子，逐条照说 |
| `mustNotSay` | 明令禁止的表述，逐条避开 |
| `whereToLook` | 数值类指路：`{ruleId, kind, where, example}`，`example` 为中石化体系常见文件名示例（只引名称，不引数值；**`where` 文本中不含任何数字**） |
| `nextSkills` | 可接的后续技能与理由 |
