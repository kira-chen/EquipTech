# {{workshop}} 备件消耗分析（{{from}} ~ {{to}}）

数据来源：{{source}}　生成时间：{{generatedAt}}（北京时间）

## 一、统计概览

{{table:overview}}

{{!-- 概览含「冲销记录（已抵减）」与「消耗金额（来源：本位币金额列 / 单价表折算）」两行 --}}

## 二、按设备分布

{{table:byEquipment}}

## 三、按备件分布

{{table:byPart}}

## 四、时间分布

{{table:byMonth}}

{{#byType}}
## 五、按设备类型

{{table:byType}}
{{/byType}}

## {{nTop}}、消耗排行（前 {{topN}}）

{{table:topConsumers}}

## {{nAnom}}、异常增长项

基期来源：{{compare.prevSource}}（{{compare.prevPeriod}}）

{{table:anomalies}}

{{table:newInPeriod}}（基期无消耗、本期新出现的备件，无倍数，不计入异常；无则省略）

> 异常增长仅为统计结果，**建议核实是否与某次检修、重复故障或统计口径变化相关；本技能不断言原因**。

## {{nUnattr}}、未归属消耗

{{unattributed}}

## {{nAnalysis}}、消耗分析

<!-- ANALYSIS_START -->
{{analysis}}
<!-- ANALYSIS_END -->

## 附：数据提示

{{warnings}}
