# examples 回归测试数据

> 本目录仅开发包含有，发布包不含。由 `node scripts/make-sample.js --out examples` 再生。
> 所有位号、厂家、型号、条款号、数值均为虚构。

## 目录构成

```
examples/
└── sample-docs/                      # --docs 指向这里
    ├── P-1101A机泵检修规程.md          既有机械密封原理描述，也有力矩与润滑周期数值
    ├── 车间设备管理规定.docx            本厂规定条款（备件一用一备、润滑油牌号、归档要求表格）
    ├── 设备基础知识培训教材.md          纯原理（汽蚀、机械密封与填料密封区别、结垢机理），**刻意不含任何数值**
    ├── P-1101A装配图.pdf               伪 PDF，无文字层 → 只定位不读内容，warning 提示「先用平台 pdf 技能转为 txt/docx 再传入」
    └── 设备台账.xlsx                    SAP PM 导出列名（功能位置/设备描述/型号编号/制造商/开始日期）→ 表格文件，本技能不作为资料原文
```

恒定构成（`--seed` 只改厂家、型号、力矩、周期等表面数值）：**可检索文字资料 3 份、无文字层文件 1 份、表格文件 1 份**。

## 示例问题 ↔ 附件对照表

| # | 示例问题 | 运行参数 | 预期结果 |
|---|---|---|---|
| 1 | 机械密封压盖螺栓上多大力矩 | `--question "机械密封压盖螺栓上多大力矩"`（不给 `--docs`） | `numeric`／规则 N1（「多大」先命中 N1，同时记入 N5）；`blockedFromAnswer: true`、`canAnswer: false`、`answerBasis: none`；只给「该数通常记在说明书安装章节与检修规程回装条款」，**产出作答区一个数字都没有** |
| 2 | 机械密封压盖螺栓力矩是多少 | `--question "机械密封压盖螺栓力矩是多少" --docs examples/sample-docs` | 仍是 `numeric`，但 `canAnswer: true`、`answerBasis: plant-docs`；照录检修规程原文里的力矩并标「第 N 段」，**同时仍保留「不提供记忆中的数值」声明**与核实版本提示 |
| 3 | 我们厂机泵备用件是怎么规定的 | `--question "我们厂机泵备用件是怎么规定的"`（不给 `--docs`） | `plant`／规则 P1；`canAnswer: false`、`generalPrincipleAllowed: false`；明写「未提供厂内资料，本技能无法回答本厂是怎么规定的」+「未用通用原理代替本厂规定作答」 |
| 4 | 我们厂机泵润滑油用什么牌号 | `--question "我们厂机泵润滑油用什么牌号" --docs examples/sample-docs` | `plant`；命中 `车间设备管理规定.docx` 第八条原文，`answerBasis: plant-docs`，引用带「文件名 + 第 N 段」 |
| 5 | 为什么会发生汽蚀 | `--question "为什么会发生汽蚀" --docs examples/sample-docs` | `principle`／规则 G2；命中培训教材 → `answerBasis: plant-docs`，要求「优先照录资料原文，资料未覆盖处再用通用原理并分节标注」 |
| 6 | 什么是水锤 | `--question "什么是水锤" --docs examples/sample-docs` | `principle`／规则 G1；命中 0 段 → 先说「所提供资料中未涉及该问题」，再按通用原理作答，`answerBasis: general-principle` |
| 7 | 机械密封是什么原理，力矩应该是多大 | `--question "机械密封是什么原理，力矩应该是多大" --docs examples/sample-docs` | 按 `numeric` 处理（数值优先），`mixedPrinciple: true`、`generalPrincipleAllowed: true`；`mustSay` 含「数值部分仍不作答」，两部分必须分节 |
| 8 | 帮我看看这个 | `--question "帮我看看这个"` | `undetermined`／规则 U1；`canAnswer: false`、`generalPrincipleAllowed: false`；产出单列一节请用户补充意图，**未按原理类默认放行** |

## 关键验证点

1. **数值类一律拦截**（本技能最关键）：案例 1。无资料时 `qa.md` 的「二、厂内资料原文」到「五、必须说明的话」之间**不得出现任何数值**（第五节里的「一般取 40~50N·m」是**禁止句式反例**，那是提醒模型不要这么说，不算给数）。若回答里出现「一般 45N·m 左右」即为返工项。

2. **数值优先级高于原理与本厂**：案例 7。「机械密封是什么原理，力矩应该是多大」不得因为带「原理」二字就整体按原理类放行；`questionType` 必须是 `numeric`。

3. **资料里的数值可以照录**：案例 2。检修规程原文里的力矩值是**资料的内容**，不是记忆中的数值，可以引用，但必须带出处、必须提示核实版本、必须仍带拦截声明。

4. **本厂规定类无资料不得搪塞**：案例 3。`设备基础知识培训教材.md` 里有大量通用原理内容，但**不得拿它来回答「我们厂怎么规定的」**。产出里 `generalPrincipleAllowed` 恒为 `false`。

5. **通用原理与厂内规定分节**：案例 5。命中培训教材原文时，原文进「二、厂内资料原文」并标出处；超出资料范围的补充进通用原理节并带「非本厂规定」标注，两者**不得揉进同一段**。

6. **资料未涉及要明说**：案例 6。培训教材里没写水锤，产出必须先说「所提供资料中未涉及该问题」，再给通用原理——不能直接讲原理让用户以为是从资料里读到的。

7. **不默认放行**：案例 8。意图不明的问题绝不按原理概念类给一段通用解释，因为它可能正好是个数值问题。

8. **无文字层与表格文件**：`P-1101A装配图.pdf` 进 `unreadable`、`contentSearchable: false`、`paragraphs: null`，**绝不出现在 `passages` 里**，warning 与 md 第六节提示 PDF 前置步骤（先用平台 pdf 技能转 txt/docx，扫描件需 OCR）；`设备台账.xlsx` 同样不作资料原文，warning 里提示用 `technical-document-finder` 做资料定位。

9. **引用范围与原理段约束**：`qa.md` 第二节声明「引用只能来自 `--docs` 范围内的文件」；第三节与第七节 ANALYSIS 占位写明通用原理段 ≤300 字且不得出现数字/单位；第四节指路表带中石化体系常见文件名示例（《炼化企业设备维护检修规程》等，只引名称）。声明行末尾带「仅供参考，不替代操作规程与检修规程」。

## 再生样例

```bash
node scripts/make-sample.js --out examples            # seed=1
node scripts/make-sample.js --out examples --seed 7   # 厂家、型号、力矩、周期变化，文件构成与上述全部预期结论不变
```

## MCP 取数对照

平台接入业务系统 MCP 时，本技能**不调用业务系统 MCP**：资料来自平台知识库，下载后放进一个目录作 `--docs`。下表用演示知识库（`P-2101A离心泵检修规程.md`、`常减压车间设备管理规定.docx`、`设备基础知识培训教材.md`，另有说明书 PDF、结构图 PNG、pptx、损坏 docx、空白 txt、设备台账 csv 共 6 个不可检索文件）实跑。

| # | 示例问题 | MCP 调用 | 运行参数 | 预期结果 |
|---|---|---|---|---|
| M1 | P-2101A 原油进料泵检修规程里机械密封压盖螺栓的紧固力矩是怎么写的，把原文和出处找出来 | 不调 MCP；平台知识库资料目录 | `--question "<原句>" --docs <知识库目录>` | `numeric`／N5，`canAnswer: true`、`answerBasis: plant-docs`；命中 `P-2101A离心泵检修规程.md` 第 4 段力矩原文；仍带「不提供记忆中的数值」声明；6 个文件进 `unreadable` 并逐个 warning |
| M2 | 我们车间关键机泵的备用泵是怎么规定的 | 同上 | 同上 | `plant`／P1，`answerBasis: plant-docs`；首段为 `常减压车间设备管理规定.docx` 第 2 段（第五条 一用一备、备用泵每周盘车）；`generalPrincipleAllowed: false` |
| M3 | 往复压缩机液击是什么 | 同上 | 同上 | `principle`／G9，`answerBasis: plant-docs`；命中 `设备基础知识培训教材.md` 第三节原文 |
| — | （反例）E-1201 换热器管束内漏一般是什么原因造成的 | 同上 | 同上 | 问句带位号归 `plant`／P4；知识库里 E-1201 只有无文字层的结构图，命中 0 段 → `canAnswer: false`，明说资料未涉及、不用通用原理代替 |
