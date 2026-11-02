# 设备专业知识问答

问题：{{question}}
问题类型：**{{classification.typeCn}}**（规则 {{classification.ruleId}}）　{{#equipType}}设备类型：{{equipType}}　{{/equipType}}生成时间：{{generatedAt}}（北京时间）
厂内资料：{{#docsProvided}}{{docsRoot}}（扫描 {{counts.filesScanned}} 个文件，可检索 {{counts.documentsContentSearchable}} 份）{{/docsProvided}}{{^docsProvided}}**未提供**{{/docsProvided}}

## 一、问题分类

{{table:classification}}

> **{{classification.notice}}**

{{#isNumeric}}**本问题属数值标准类，已拦截：本技能不输出任何记忆中的数值、限值、周期。**{{/isNumeric}}
{{#isUndetermined}}**本问题未能归入三类中的任一类，未按任一类默认处理。**{{/isUndetermined}}
{{#mixedPrinciple}}> 问句中同时含原理成分：原理部分可按通用原理解释，但须与本节类型对应的限制分节呈现。{{/mixedPrinciple}}

命中的全部规则（可追溯到 `scripts/lib/rules.js`）：

{{table:matchedRules}}

## 二、厂内资料原文

> 引用只能来自 `--docs` 范围内的文件（{{docsRoot}}），引用必须带文件名与段号；不得引用范围外的任何文件或记忆中的"规程原文"。

{{#hasPassages}}
命中 {{counts.passagesTotal}} 段。原文照录，解释另列：

{{#passages}}
**出处：{{file}}　{{location}}**（命中词：{{keywords}}）

> {{text}}

{{/passages}}

来源清单：

{{table:sources}}
{{/hasPassages}}
{{^hasPassages}}
{{#docsProvided}}
**所提供资料中未涉及该问题**（扫描 {{counts.filesScanned}} 个文件，可检索 {{counts.documentsContentSearchable}} 份，命中 0 段）。

> 未用通用知识补充到本节，也未用其他设备的资料代替。
{{/docsProvided}}
{{^docsProvided}}
**未提供厂内资料，本节无内容。**

> 本节只放厂内资料原文。未提供资料时不以通用原理填充本节。
{{/docsProvided}}
{{/hasPassages}}

## 三、通用原理适用性

{{#generalPrincipleAllowed}}
**可用通用原理作答**，但必须整段标注：

> 以下为通用原理说明，**非本厂规定**，具体以厂内规程为准。

通用原理段落中**不得出现任何具体数值、限值、周期**；涉及数值一律转「四、数值类处理」。

【注意】通用原理段 **不超过 {{principleMaxChars}} 字**，且**不得出现任何数字或单位**。
{{/generalPrincipleAllowed}}
{{^generalPrincipleAllowed}}
**不可用通用原理作答本问题。**

> {{blockReason}}
{{/generalPrincipleAllowed}}

## 四、数值类处理

{{#isNumeric}}
**该数值须以厂内规程/设备说明书为准，本技能不提供记忆中的数值。**

该类数值通常在以下厂内文件中规定（**只指路，不给数**）：

{{table:whereToLook}}   ← 列：规则号 | 数值类别 | 通常规定在 | 中石化体系炼化厂常见文件示例（只引名称）

> 文件名为常见示例，各厂受控文件名可能不同；本技能不转述上述文件中的任何数值。
{{/isNumeric}}
{{^isNumeric}}
本问题不属数值标准类。若回答过程中出现具体数值、限值、周期，同样适用：**该数值须以厂内规程/设备说明书为准，本技能不提供记忆中的数值。**
{{/isNumeric}}

## 五、必须说明的话

{{#guidance.mustSay}}- {{.}}
{{/guidance.mustSay}}

**禁止的表述：**

{{#guidance.mustNotSay}}- {{.}}
{{/guidance.mustNotSay}}

{{table:answerability}}

## 六、无法检索内容的文件

{{table:unreadable}}

> 以上文件**只做了文件定位，未读取其中任何内容**；其中的数值、材质、编号一律不得据此作答。
{{#hasPdf}}> 【注意】{{pdfNote}}。{{/hasPdf}}

## 七、回答组织

<!-- ANALYSIS_START -->
（由模型依据 references/qa-rules.md 口径撰写：结论或定义 → 展开解释 → 来源标注 → 适用提示。厂内资料原文与通用原理必须分节，各自带标注；引用只能来自上述 --docs 范围内的文件并带文件名与段号；通用原理段长度不得超过第三节给出的上限，且不得出现任何数字或单位；数值标准类只说明去哪查，不给数值；本厂规定类无资料时直接说无法回答，不用通用原理搪塞。）
<!-- ANALYSIS_END -->

## 八、相关技能

{{table:nextSkills}}

---

> 本回答区分「厂内资料原文」与「通用原理」两类内容；通用原理非本厂规定，具体执行以厂内规程为准。涉及数值、限值、周期的问题一律以厂内规程/设备说明书为准，本技能不提供记忆中的数值。仅供参考，不替代操作规程与检修规程。

{{#warnings}}
## 附：数据提示

{{#each}}- {{.}}
{{/each}}
{{/warnings}}
