<!-- 模板占位符 {{路径}} 与 tasks.json 的键一一对应（meta.* / counts.*），数组节用 {{#数组}}…{{/数组}} 包裹，字段取该数组元素的键。脚本本身不读此模板，tasklist.md 由脚本直接生成；本模板仅供用户要求调整版式时参照。 -->
# {{meta.workshop}} 巡检任务清单（{{meta.date}} {{meta.shiftText}}）

数据来源：{{meta.source}}{{#meta.group}} ｜ 人员分组：{{meta.group}}{{/meta.group}}
筛选条件：{{meta.filtersText}}
临期阈值：距到期 ≤ {{meta.dueSoonRule}}
生成时间：{{meta.generatedAt}}（北京时间）

## 一、任务概览

| 指标 | 数量 |
|---|---|
| 台账设备 | {{counts.ledgerEquipment}} |
| 不需巡检（台账标注） | {{counts.excluded}} |
| 本次范围内设备 | {{counts.inScopeEquipment}} |
| 筛选排除 | {{counts.filteredOut}} |
| 任务项合计 | {{counts.tasks}} |
| 涉及设备 | {{counts.taskEquipment}} |
| 其中特护设备任务项 | {{counts.special}} |
| 已逾期 | {{counts.overdue}} |
| 本班到期 | {{counts.due}} |
| 临期 | {{counts.dueSoon}} |
| 未检（无上次记录） | {{counts.never}} |
| 班次级周期项（每班/每 N 小时） | {{counts.hourly}} |
| 不属本班（适用班次不含） | {{counts.otherShift}} |
| 周期待确认 | {{counts.unscheduled}} |
| 无巡检标准 | {{counts.noStandard}} |
| 标准仅适用其他班次的设备 | {{counts.otherShiftOnlyEquipment}} |

所需工具汇总：{{meta.toolsText}}

## 二、任务明细（按建议路线顺序）

{{#route}}
### {{area}}（{{taskCount}} 项）

| 建议顺序 | 位号 | 设备名称 | 专业 | 重要度 | 检查项 | 判定标准 | 所需工具 | 周期 | 优先级 | 到期状态 | 到期日 |
|---|---|---|---|---|---|---|---|---|---|---|---|
{{#tasks}}
| {{routeSeq}} | {{tag}} | {{name}} | {{discipline}} | {{criticalityRaw}} | {{item}} | {{criterion}} | {{tool}} | {{periodText}} | {{priority}} | {{dueStatus}} | {{dueDate}} |
{{/tasks}}
{{/route}}

## 三、逾期与临期专项

**已逾期未检**

| 位号 | 设备名称 | 区域 | 检查项 | 周期 | 上次巡检 | 到期 | 逾期 | 上次结果 |
|---|---|---|---|---|---|---|---|---|
{{#overdue}}
| {{tag}} | {{name}} | {{area}} | {{item}} | {{periodText}} | {{lastDate}} | {{dueDate}} | {{overdueDays}} | {{lastResultRaw}} |
{{/overdue}}

**临期（距到期 ≤ {{meta.dueSoonRule}}）**

| 位号 | 设备名称 | 区域 | 检查项 | 周期 | 到期日 | 距到期天数 | 本项阈值(天) |
|---|---|---|---|---|---|---|---|
{{#dueSoon}}
| {{tag}} | {{name}} | {{area}} | {{item}} | {{periodText}} | {{dueDate}} | {{daysToDue}} | {{dueSoonThreshold}} |
{{/dueSoon}}

## 四、周期待确认

_以下检查项的巡检周期为空或无法解析，脚本未按日检默认处理，也未丢弃，请车间确认周期后再排期。_

| 位号 | 设备名称 | 区域 | 检查项 | 周期原文 | 原因 |
|---|---|---|---|---|---|
{{#unscheduled}}
| {{tag}} | {{name}} | {{area}} | {{item}} | {{periodRaw}} | {{reason}} |
{{/unscheduled}}

**无巡检标准的设备**（未生成任务项，请补齐标准表）

| 位号 | 设备名称 | 区域 | 专业 | 重要度 | 原因 |
|---|---|---|---|---|---|
{{#noStandard}}
| {{tag}} | {{name}} | {{area}} | {{discipline}} | {{criticalityRaw}} | {{reason}} |
{{/noStandard}}

## 五、执行提示与交接事项

<!-- NOTES_START -->
（由模型依据 references/dispatch-rules.md 口径撰写）
<!-- NOTES_END -->

> {{meta.routeNote}}
> {{meta.disclaimer}}

## 附：数据提示

{{#warnings}}
- {{.}}
{{/warnings}}
