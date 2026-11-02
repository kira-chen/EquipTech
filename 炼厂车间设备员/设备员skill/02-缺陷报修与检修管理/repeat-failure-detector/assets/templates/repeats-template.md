# {{workshop}} 重复故障识别报告（{{from}} ~ {{to}}）

> {{meta.disclaimer}}
> {{meta.ruleDisclaimer}}。

统计区间：{{from}} ~ {{to}}，共 {{periodDays}} 天{{#fromDefaulted}}（起始日按默认「一年内」口径推算）{{/fromDefaulted}} ｜ 归类维度：{{byCn}} ｜ 数据文件：{{meta.inputs}}
判定阈值：同设备同部位 ≥{{minCount}} 次，同设备同现象/同代码 ≥{{phenMin}} 次，相似度阈值 {{similarity}}
生成时间：{{generatedAt}}（北京时间）

【注意】{{meta.thresholdNote}}。{{meta.codePriority}}。
【注意】{{meta.periodAdvice}}。区间过短会漏判间隔较长的重复故障，过长会掺入已整改的历史问题；跨大检修节点的区间应按大检修后重新起算。

## 一、统计概览

| 指标 | 数量 |
|---|---|
| 数据文件数 | {{counts.files}} |
| 区间内故障记录 | {{counts.records}} |
| 参与判定的记录 | {{counts.valid}} |
| 　其中带 SAP 损坏/故障代码 | {{counts.withCode}} |
| 涉及设备台数 | {{counts.equipment}} |
| 命中重复故障的设备 | {{counts.repeatEquipment}} |
| 同型号共性故障组 | {{counts.modelGroups}} |
| 故障间隔缩短设备 | {{counts.shortening}} |
| 现象无信息量未参与判定 | {{counts.uninformative}} |
| 区间外被跳过记录 | {{counts.outOfRange}} |

## 二、同设备重复故障

{{#byEquipment}}
### {{tag}} {{name}}　区间内 {{count}} 次

| 项目 | 内容 |
|---|---|
| SAP 设备编号 | {{equipNo}} |
| 型号 | {{model}} |
| 设备类型 | {{type}} |
| 首次/末次故障 | {{firstDate}} / {{lastDate}} |
| 故障间隔（天） | {{intervals}} |
| 平均间隔 | {{avgInterval}} |
| 最短间隔 | {{minInterval}} |
| 间隔是否缩短 | {{shortening}} |

{{#hits}}
**命中规则 {{ruleId}}（{{rule}}）**：{{basis}}

判定依据（matchBasis）：
{{matchBasis}}
{{/hits}}

{{table:records}}

【注意】{{note}}。
{{/byEquipment}}

## 三、同型号/同类设备共性故障

{{#byModel}}
### {{dimension}}「{{key}}」　{{equipmentCount}} 台设备 / {{count}} 次

**命中规则 {{ruleId}}（{{rule}}）**：{{basis}}

判定依据（matchBasis）：
{{matchBasis}}

{{table:records}}

【注意】{{note}}。
{{/byModel}}

## 四、故障频次排行

{{table:topFrequency}}

## 五、故障间隔缩短设备

{{table:shorteningInterval}}

## 六、故障现象无信息量清单（未参与判定）

{{table:uninformative}}

【注意】以上记录的故障现象为空或只写「故障」「坏了」这类泛指描述，且无 SAP 损坏代码，**未据此判定为任何一类重复故障**，需补填具体现象或代码后重新统计。

## 七、重复故障分析

<!-- ANALYSIS_START -->
{{analysis}}
<!-- ANALYSIS_END -->

## 附：数据提示

{{warnings}}
