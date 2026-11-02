<!--
  报告模板：占位符一律写成 lube.json 的键路径（{{meta.xxx}} / {{counts.xxx}}），
  列表节用 {{#列表键}} … {{/列表键}} 包住一行，行内占位符为该列表元素的字段名。
  脚本 lube.js 不读取本模板，报告由 renderMd 直接生成；本模板只供用户要求调整版式时由模型照 lube.json 填写。
-->
# {{meta.workshop}} 设备润滑管理报告（基准日 {{meta.date}}）

数据来源：{{meta.source}} ｜ 提前提醒：{{meta.leadDays}} 天 / 运行小时周期 {{meta.leadHours}} h
生成时间：{{meta.generatedAt}}（北京时间）

> {{meta.declaration}}

## 一、到期概览

| 指标 | 数量 |
|---|---|
| 台账润滑项 | {{counts.ledgerItems}} |
| 已逾期 | {{counts.overdue}} |
| 临期（≤{{meta.leadDays}}天 / ≤{{meta.leadHours}}h） | {{counts.dueSoon}} |
| 周期内正常 | {{counts.normal}} |
| 无法判定 | {{counts.undetermined}} |
| 其中按运行小时周期管理 | {{counts.runHoursItems}} |
| 加换油记录条数 | {{counts.consumptionRecords}} |
| 油液分析异常项（超厂内限值） | {{counts.oaAbnormal}} |
| 油液分析参考比对超限项（非厂内标准） | {{counts.oaRefExceeded}} |

## 二、五定齐备率

| 五定 | 对应台账列 | 已填/应填 | 齐备率 | 说明 |
|---|---|---|---|---|
{{#wuding}}| {{key}} | {{col}} | {{filled}}/{{total}} | {{rate}}% | {{missing}} 项未填 |
{{/wuding}}

## 三、逾期清单

| 位号 | 设备名称 | 润滑部位 | 油品 | 方式 | 周期 | 责任人 | 上次加换油 | 应到期 | 逾期 | 逾期程度 |
|---|---|---|---|---|---|---|---|---|---|---|
{{#overdue}}| {{tag}} | {{name}} | {{part}} | {{oil}} | {{mode}} | {{periodRaw}} | {{owner}} | {{lastDate}} | {{dueDate}} | {{overdueDays}}天 / {{overdueHours}}h | {{level}} |
{{/overdue}}

## 四、临期清单

| 位号 | 设备名称 | 润滑部位 | 油品 | 方式 | 周期 | 责任人 | 上次加换油 | 应到期 | 剩余 |
|---|---|---|---|---|---|---|---|---|---|
{{#dueSoon}}| {{tag}} | {{name}} | {{part}} | {{oil}} | {{mode}} | {{periodRaw}} | {{owner}} | {{lastDate}} | {{dueDate}} | {{remainDays}}天 / {{remainHours}}h |
{{/dueSoon}}

## 五、无法判定清单

【未判定】以下润滑项因周期、上次加换油日期或运行小时数据缺失/无法解析，未作到期判定；**未按常见周期默认处理**，请补齐台账后重跑。

| 位号 | 设备名称 | 润滑部位 | 油品 | 周期原文 | 上次加换油原文 | 缺失原因 | 出处 |
|---|---|---|---|---|---|---|---|
{{#undetermined}}| {{tag}} | {{name}} | {{part}} | {{oil}} | {{periodRaw}} | {{lastDate}} | {{reason}} | {{sheet}} 第{{row}}行 |
{{/undetermined}}

## 六、油品消耗统计

**按油品**

| 油品牌号 | 消耗量（按单位分列） | 记录条数 | 数量缺失条数 |
|---|---|---|---|
{{#consumption.byOil}}| {{key}} | {{units}} | {{records}} | {{unknownQty}} |
{{/consumption.byOil}}

**按设备**

| 位号 | 设备名称 | 消耗量（按单位分列） | 记录条数 | 数量缺失条数 |
|---|---|---|---|---|
{{#consumption.byEquipment}}| {{key}} | {{name}} | {{units}} | {{records}} | {{unknownQty}} |
{{/consumption.byEquipment}}

【注意】单位混用：以下条目的加换油记录使用了多种计量单位，已按单位分别统计，**未做任何换算**，请核实计量口径：

{{#consumption.mixedUnits}}- {{scope}}「{{key}}」：{{units}}
{{/consumption.mixedUnits}}

**金额折算**

| 油品牌号 | 单位 | 消耗量 | 单价(元) | 金额(元) | 说明 |
|---|---|---|---|---|---|
{{#consumption.amount.items}}| {{oil}} | {{unit}} | {{qty}} | {{price}} | {{amount}} | {{note}} |
{{/consumption.amount.items}}

合计金额：{{consumption.amount.total}} 元

## 七、油液分析

_{{oilAnalysis.note}}_

**异常项（超出厂内限值）**

| 位号 | 设备名称 | 取样日期 | 检测项 | 检测值 | 厂内限值 | 化验结论 |
|---|---|---|---|---|---|---|
{{#oilAnalysis.abnormal}}| {{tag}} | {{name}} | {{sampleDate}} | {{item}} | {{value}} | {{limit}} | {{conclusion}} |
{{/oilAnalysis.abnormal}}

**参考限值比对项（非厂内标准，仅供参考）**

| 位号 | 设备名称 | 取样日期 | 检测项 | 检测值 | 参考限值 | 参考出处 | 参考比对 | 化验结论 |
|---|---|---|---|---|---|---|---|---|
{{#oilAnalysis.refChecked}}| {{tag}} | {{name}} | {{sampleDate}} | {{item}} | {{value}} | {{refLimit}} | {{refStandard}} | {{exceededRef}} | {{conclusion}} |
{{/oilAnalysis.refChecked}}

**无判定限值项（仅列示数值，未作异常判定）**

| 位号 | 设备名称 | 取样日期 | 检测项 | 检测值 | 限值原文 | 说明 | 出处 |
|---|---|---|---|---|---|---|---|
{{#oilAnalysis.noLimit}}| {{tag}} | {{name}} | {{sampleDate}} | {{item}} | {{valueRaw}} | {{limitRaw}} | {{reason}} | {{sheet}} 第{{row}}行 |
{{/oilAnalysis.noLimit}}

**正常项**

| 位号 | 检测项 | 检测值 | 厂内限值 |
|---|---|---|---|
{{#oilAnalysis.normal}}| {{tag}} | {{item}} | {{value}} | {{limit}} |
{{/oilAnalysis.normal}}

## 八、润滑管理情况说明

<!-- ANALYSIS_START -->
（模型依据 references/lube-rules.md 撰写 200~350 字）
<!-- ANALYSIS_END -->

## 附一、油品牌号写法不一致提示

| 疑似同一油品的写法 |
|---|
{{#oilNameConflicts}}| {{names}} |
{{/oilNameConflicts}}

## 附二、数据提示

{{#warnings}}- {{.}}
{{/warnings}}
