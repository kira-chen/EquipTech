# 设备异常初判报告　{{meta.tag}} {{meta.name}}

> 占位符与 `triage.json` 键一致（`{{a.b}}` = JSON 路径；`{{#each x}}…{{/each}}` 表示按数组逐行）。脚本自身不读本模板，直接生成 `triage.md`；本模板供模型在需要重排版时对照使用，数字一律取自 JSON。

设备类型：{{meta.equipTypeCn}}（原填「{{meta.equipTypeRaw}}」）　｜　发现时间：{{meta.occurredAt}}
生成时间：{{meta.generatedAt}}（北京时间）

> **{{meta.disclaimer}}。**

## 一、现象复述

| 项目 | 内容 |
|---|---|
| 位号 | {{meta.tag}} |
| 设备名称 | {{meta.name}} |
| 设备类型 | {{meta.equipTypeCn}} |
| 识别到的现象 | {{meta.symptomsCn}} |
| 现象描述（原文） | {{meta.symptomText}} |
| 发现时间 | {{meta.occurredAt}} |
| 是否特护设备 | {{meta.special}} |
| 参数数据 | {{counts.params}} 项（可判趋势 {{counts.paramsTrended}}，缺偏差阈值 {{counts.paramsNoThreshold}}） |
| 偏差阈值来源 | {{meta.devPct}} / 限值表 {{counts.limits}} 行 |
| 历史故障记录 | {{counts.history}} 条 |

已采信的依据：

| 依据项 | 取值 | 来源 |
|---|---|---|
{{#each evidence}}| {{label}} | {{value}} | {{source}} |
{{/each}}

## 二、可能原因排序

| 序 | 候选原因 | 可能性 | 依据充分度 | 支持依据 | 反证 | 规则号 |
|---|---|---|---|---|---|---|
{{#each candidates}}| {{@index}} | {{cause}} | {{likelihoodCn}} | {{evidenceLevel}} | {{supports}} | {{againsts}} | {{ruleId}} |
{{/each}}

各候选原因的机理与缺失依据：

{{#each candidates}}- **{{cause}}**（{{ruleId}}，{{likelihoodCn}}）：{{mechanism}}。尚缺依据：{{unknowns}}。
{{/each}}

## 三、建议核实项

| 优先级 | 核实项 | 对应候选原因 | 规则号 |
|---|---|---|---|
{{#each checkItems}}| {{priority}} | {{item}} | {{forCauses}} | {{ruleId}} |
{{/each}}

> 以上核实项由设备员或对应专业人员现场执行。**频谱、油液分析、无损检测的结论一律由诊断或检测人员出具，本报告不代为判读。**

## 四、建议动作

| 项目 | 内容 |
|---|---|
| 关注度提示 | {{riskLevel.levelCn}} |
| 提示依据 | {{riskLevel.basis}}（规则 {{riskLevel.ruleId}}） |

> 关注度用 红/橙/黄 三档（与设备重要度 A/B/C 分级无关），只表示建议的关注强度，不是处置指令。
> **本报告不给出是否停机、是否降负荷、是否抢修的意见**，该类决策由设备工程师会同生产调度按厂内规定作出。

## 五、未判定项

| 候选原因 | 缺失依据 | 说明 | 规则号 |
|---|---|---|---|
{{#each undetermined}}| {{cause}} | {{missingLabels}} | {{note}} | {{ruleId}} |
{{/each}}

> 以上原因**仍保留在候选清单内**，只是因缺数据暂无法评估可能性，不得视为已排除。

建议补充以下数据后重新初判：
{{#each missingFields}}- {{label}}
{{/each}}

## 六、上报建议

{{escalation.text}}

<!-- ANALYSIS_START -->
（由模型撰写 150~300 字的初判说明。）
<!-- ANALYSIS_END -->

核实后确认为缺陷的，由车间设备员按厂内流程在 SAP PM 创建维修通知单；需要查同类设备的历史案例时，可接 `07-隐患事故与合规/failure-case-retrieval`。

**{{meta.disclaimer}}。**
