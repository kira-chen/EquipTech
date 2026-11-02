# 技术资料检索结果

设备：{{tag}}{{#ledgerInfo.name}}　{{ledgerInfo.name}}{{/ledgerInfo.name}}　查询内容：{{query}}
资料路径：{{docsRoot}}（扫描 {{counts.filesScanned}} 个文件）　检索时间：{{generatedAt}}（北京时间）
{{#docTypeFilter}}资料类型过滤：{{docTypeFilter}}{{/docTypeFilter}}

## 一、相关资料文件

{{table:documents}}

> 「内容可检索＝否（未解析）」的文件只做了文件定位，未读取其中内容；「PDF 转换文本」的内容由平台 pdf 技能转换产生，须核对原件。

## 二、原文引用

{{#hasPassages}}
命中 {{counts.passagesTotal}} 段。原文照录，解释另列：

{{#passages}}
**出处：{{file}}　{{location}}{{#version}}　版本 {{version}}{{/version}}**（命中词：{{keywords}}{{#convertedFrom}}；PDF 转换文本，须核对原件 {{convertedFrom}}{{/convertedFrom}}）

> {{text}}

{{/passages}}
{{/hasPassages}}
{{^hasPassages}}
**所提供资料中未找到与「{{query}}」相关的内容。**

> 未用通用知识补充，也未用其他设备的资料代替。
{{/hasPassages}}

## 三、多处原文不一致

{{#conflicts}}
### 关键词「{{keyword}}」（单位 {{unit}}）

{{table:values}}

> 多处原文取值不一致，已全部列出，未自行取其一；请核实资料版本后以受控文件为准
{{/conflicts}}
{{^conflicts}}未发现同一内容在不同资料中取值不一致的情况。{{/conflicts}}

## 四、无法检索内容的文件

{{table:unreadable}}

> 以上文件**只做了文件定位，未读取其中任何内容**；图纸上的尺寸、材质、编号等一律不得据此作答，需人工打开原件查看。PDF 请先用平台 pdf 技能转为 txt/docx（扫描件需 OCR）后重跑；.doc/.xls 请另存为 .docx/.xlsx。

{{#catalogOnly}}
## 五、资料目录已登记但未提供实体文件

{{table:catalogOnly}}

> 以上仅为台账登记信息，**未读到文件内容**，需按存放位置调阅原件。
{{/catalogOnly}}

## 六、无法关联的文件

{{table:unrelated}}

## 七、资料解读

<!-- ANALYSIS_START -->
（由模型依据 references/retrieval-rules.md 口径撰写：先照录原文与出处，再用一两句话解释；解释不得引入原文没有的数值或结论；多处不一致时全部列出并提示核实版本；资料中没有的内容写「资料中未找到」。）
<!-- ANALYSIS_END -->

---

> 引用内容来自所提供资料，资料版本有效性请以受控文件系统为准；未能解析的文件已列出。经平台 pdf 技能转换的文本属模型读取产生，未经脚本验证，须人工核对原件。

{{#warnings}}
## 附：数据提示

{{#each}}- {{.}}
{{/each}}
{{/warnings}}
