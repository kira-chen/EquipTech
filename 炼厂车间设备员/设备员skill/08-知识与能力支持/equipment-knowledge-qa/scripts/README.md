# scripts 使用说明

## qa.js —— 主脚本

```bash
node "<技能目录>/scripts/qa.js" \
  --question "<问题>" \
  --docs "<厂内资料路径>" \
  --out "<输出目录>"
```

`--docs` 可以不给：不给时脚本只做问题分类与作答指引，不检索资料。

### 参数

| 参数 | 必需 | 说明 |
|---|---|---|
| `--question` | 是 | 用户问题原文，**不要替用户改写**（改写会改变分类结果） |
| `--docs` | 否 | 厂内资料目录（递归扫描，最多 6 层）或单个文件。**PDF 先用平台 pdf 技能转为 txt/docx 再传入，脚本不读 PDF；扫描件需 OCR**。引用只能来自此范围 |
| `--out` | 否 | 输出目录，默认系统临时目录 `<os.tmpdir()>/ekqa-out`，**建议始终传 `--out`** |
| `--equip-type` | 否 | `泵`/`压缩机`/`风机`/`换热器`/`容器`/`塔`/`管道`/`阀门`/`电机`/`仪表`/`机组`/`加热炉`，仅写进 meta 供语境用 |
| `--context` | 否 | 摘录上下文字数，默认 60（只影响 `excerpt`，`text` 始终是完整段落） |
| `--all-matches` | 否 | 返回全部命中段落；默认最多 20 段 |

### 产出

| 文件 | 内容 |
|---|---|
| `qa.json` | `questionType` / `classification` / `passages` / `sources` / `guidance` / `counts` / `documents` / `unreadable` / `meta` / `warnings` |
| `qa.md` | 七至八节报告，含声明行与 `<!-- ANALYSIS_START/END -->` 占位 |
| `summary.json` | 末行摘要落盘（Windows 控制台乱码兜底） |

`counts` 字段：`filesScanned` `documentsContentSearchable` `documentsNoTextLayer` `passages` `passagesTotal` `sources` `unreadable` `numericRulesMatched` `plantRulesMatched` `principleRulesMatched` `whereToLook`。

`meta` 新增：`citeScope`（`docs-only` / `none`，引用只能来自 `--docs`）、`principleMaxChars`（通用原理段上限 300 字）、`pdfNote`（PDF 前置步骤提示）。`guidance.whereToLook[]` 新增 `example`（中石化体系炼化厂常见文件名示例，只引名称）。

### 退出码
- `0`：成功，末行输出 `{"ok":true,...}`
- `1`：失败，末行输出 `{"ok":false,"error":"...","warnings":[...]}`（缺 `--question`、空白问题、资料路径不存在、非法 `--equip-type`、非法 `--context`、未知参数、资料目录下无文件）

### 四条必须知道的行为

1. **数值标准类一律拦截**。问句涉及具体数值、限值、公差、力矩、试压压力、周期、频次时，`questionType` 恒为 `numeric`、`blockedFromAnswer: true`，产出里只给「该数值通常记在哪类文件」的指路（`guidance.whereToLook`，**文本中一个数字都没有**），绝不输出记忆中的数值。资料里有原文时可以照录原文，因为那是资料的内容，不是记忆中的数值。

2. **数值类优先级最高**。「机械密封是什么原理，力矩应该是多大」这种混合问句按 `numeric` 处理，同时标 `mixedPrinciple: true`：原理部分可解释并标注「通用原理」，数值部分照样不答，两部分必须分节。

3. **本厂规定类无资料 → 明确答不了**。`guidance.canAnswer: false`、`generalPrincipleAllowed: false`、`answerBasis: 'none'`，`mustSay` 里带「未提供厂内资料，本技能无法回答本厂是怎么规定的」与「未用通用原理代替本厂规定作答」。**不许用通用原理搪塞**。

4. **分不出类别不默认放行**。三组规则都没命中 → `undetermined`（规则 U1），不按原理概念类默认给通用解释，产出里单列一节请用户补充问题意图。句末「X是什么」（如「往复压缩机液击是什么」）按术语定义归 G9；「是什么」前面是原因、要求、标准、做法、流程、型号等泛指词或介质、逻辑、等级、报警值等本厂设备属性，或问句里有「这/那/哪」指代时不归 G9，仍可能是 U1。

5. **引用只能来自 `--docs` 范围**。`documents` 列表即允许引用的文件清单；PDF 不读，warning 提示前置步骤。

6. **通用原理段约束**。`R.PRINCIPLE_MAX_CHARS = 300`，`R.checkPrincipleText(text)` 返回 `{chars, overLength, hasNumber, numbers, ok}`，selftest 用它扫描产出 ANALYSIS 段与 references 示范句。

### lib/rules.js —— 分类规则引擎

规则表分四组，每条带规则号，`classification.matched` 里全部保留，可倒查：

| 组 | 类别 | 条数 | 优先级 |
|---|---|---|---|
| `NUMERIC_RULES` | 数值标准类 | N1~N13 | 最高，命中即停 |
| `PLANT_RULES` | 本厂规定类 | P1~P6 | 次之 |
| `PRINCIPLE_RULES` | 原理概念类 | G1~G9 | 最后 |
| `WHERE_RULES` | 数值类指路 | W0~W7 | 仅 numeric 时用 |

对外导出 `classify(question)`、`whereToLook(question)`、`splitQuery(question)`、`NOTICE`（三类 + 未判定的固定表述）、`PRINCIPLE_MAX_CHARS`、`checkPrincipleText(text)`。改规则只改这个文件，`qa.js` 不重复写判定逻辑。

## make-sample.js

```bash
node scripts/make-sample.js [--seed <n>]
```

生成一套厂内资料样例：`sample-docs/` 下含 `.md` 检修规程（既有机械密封原理描述、也有力矩与周期数值）、`.docx` 车间设备管理规定（本厂规定条款，缺陷按 A/B/C 三级）、`.md` 培训教材（纯原理、**刻意不含数值**）、伪 PDF 装配图（验证无文字层与 PDF 前置提示）、`.xlsx` 设备台账（SAP PM 导出列名：功能位置/设备描述/型号编号/制造商/开始日期，验证表格文件不作资料原文）。

`--seed` 只改厂家、型号、力矩与周期等表面数值，**文件构成不变、可检索资料恒为 3 份、无文字层文件恒为 1 份、表格文件恒为 1 份**，各问题的分类结论也不变。

## selftest.js

```bash
node scripts/selftest.js
```

见 selftest 末行输出的断言数，覆盖：

- **数值类拦截（A 组 36 条）**：18 个数值类问法逐一验证识别、拦截语、`blockedFromAnswer`、不退回通用原理、指路文本不含数字；混合问句优先级；有资料时照录原文并保留拦截声明
- **本厂规定类（B 组 28 条）**：6 个本厂类问法逐一验证；无资料 / 资料未命中 / 资料全无文字层三种情形下均明确答不了且不放行通用原理；命中时基于资料并标出处
- **原理概念类（C 组 19 条）**：9 个原理类问法逐一验证；有资料优先基于资料、未命中时先说明再用通用原理
- **分节标注（D 组 17 条）**：资料原文节与通用原理节分列且有序、`sourceKind` 逐条标注、md 章节齐全、声明行与分析段占位、三个产出文件落盘
- **未判定（E 组 9 条）**：三组均未命中 → `undetermined`，不默认按原理类放行
- **资料解析边界（F 组 28 条）**：PDF/图片无文字层、表格文件不作原文、空文件、损坏 docx 不中断、单文件输入、无有效检索词、截断与 `--all-matches`、资料全无文字层
- **参数校验（G 组 15 条）**：缺值、空白、路径不存在、非法枚举、非法数字、未知参数、空目录
- **rules.js 直接单测（H 组 15 条）**：四类判定、规则号、指路不含数字、切词去疑问词、固定表述与 SKILL.md 一致
- **样例可再生（I 组 9 条）**：seed 变化时文件构成与分类结论不变、非法 seed 报错
- **中石化口径改造（J 组）**：PDF 前置步骤 warning 与 md 提示且不中断、引用范围声明、声明行含「仅供参考，不替代操作规程与检修规程」、指路 `example` 含《炼化企业设备维护检修规程》且无数值、`checkPrincipleText` 正反例、产出 ANALYSIS 段与 sample-output 示范五/六/七原理段无数字无单位且 ≤300 字、md 无 emoji
- **缺陷修复（K 组 21 条，2026-11-03）**：句末「X是什么」归 G9 术语定义，「要求/流程/原因/现象/型号…是什么」与「这/那」指代的反例不归 G9、原有规则号不变；≤4 字中文片段也做 3 字、2 字切分且原片段排最前，「我们厂备用泵怎么规定的」能命中备用件规定原文

## docx2text.js —— 辅助工具

```bash
node scripts/docx2text.js <file.docx>
```

把 `.docx` 抽成纯文本打到 stdout，排查「资料里明明写了却没命中」时用来看脚本实际读到了什么。
