# 维修通知单草稿{{#workshop}}（{{workshop}}）{{/workshop}}

生成时间：{{meta.generatedAt}}（北京时间）　报告单位：{{meta.applicant}}　要求结束：{{meta.dueDate}}　草稿数：{{counts.total}}

> {{meta.disclaimer}}
> {{meta.notice}}

## 一、通知单草稿清单概览

| 草稿序号 | 功能位置 | 设备描述 | 通知单短文本 | 通知单类型 | 优先级 | 建议专业归口 | 要求结束 |
|---|---|---|---|---|---|---|---|
{{#orders}}| {{draftNo}} | {{equipment.funcLoc}} | {{equipment.name}} | {{notification.shortText}} | {{notification.typeCn}} | {{priority.cn}} | {{dispatch.discipline}} | {{notification.requiredEnd}} |
{{/orders}}

| 统计项 | 数值 |
|---|---|
| 草稿总数 | {{counts.total}} |
{{#counts.byType}}| 　通知单类型 {{key}} | {{count}} |
{{/counts.byType}}{{#counts.byPriority}}| 　优先级 {{key}} | {{count}} |
{{/counts.byPriority}}{{#counts.byDiscipline}}| 　专业归口 {{key}} | {{count}} |
{{/counts.byDiscipline}}| 位号不在台账 | {{counts.notInLedger}} |
| 无历史维修记录 | {{counts.withoutHistory}} |
| 信息待补充草稿 | {{counts.withMissingInfo}} |

【注意】专业归口为建议值，需车间与承修单位确认；工时与备件由承修单位在工单（订单）中填写，草稿不给数值。优先级按 SAP 1 非常高 / 2 高 / 3 中 / 4 低；通知单类型 M1 维修申请 / M2 故障报告 为常见口径，厂内可配置。

## 二、通知单草稿正文

{{#orders}}
### 草稿 {{draftNo}}　{{equipment.funcLoc}} {{equipment.name}}

**通知单抬头**

| 项目 | 内容 |
|---|---|
| 通知单号 | 由 SAP 生成 |
| 通知单类型 | {{notification.typeCn}}（{{notification.typeSource}}） |
| 功能位置 | {{equipment.funcLoc}} |
| 设备编号 | {{equipment.equipNo}} |
| 通知单短文本 | {{notification.shortText}} |
| 优先级 | **{{priority.cn}}** |
| 判定来源 | {{priority.source}} |
| 要求开始 | {{notification.requiredStart}} |
| 要求结束 | {{notification.requiredEnd}}{{#schedule.overdue}}　**（早于当前日期，请确认是否改期）**{{/schedule.overdue}} |
| 报告单位 | {{notification.reportUnit}} |
| 报告人 | {{notification.reporter}} |

**设备信息**

| 项目 | 内容 |
|---|---|
| 设备描述 | {{equipment.name}} |
| 规格型号 | {{equipment.model}} |
| 安装位置 | {{equipment.location}} |
| 所属专业 | {{equipment.discipline}} |
| 投用日期 | {{equipment.commissioned}} |
| 介质 | {{equipment.medium}} |
| 信息来源 | {{equipment.source}} |

{{^equipment.inLedger}}
【注意】位号「{{equipment.tag}}」未在设备台账中查到，设备信息字段留空标「待补充」，需从 SAP 技术对象或现场铭牌核实后补填，未按设备名推测规格型号。
{{/equipment.inLedger}}

**故障描述（长文本）**

| 项目 | 内容 |
|---|---|
| 缺陷登记号 | {{defectNo}} |
| 对象部件 | {{fault.part}} |
| 故障现象 | {{fault.desc}} |
| 现象类型 / 故障代码建议 | {{fault.phenomenonCn}} / {{fault.faultCode}}（代码按厂内目录核对） |
| 缺陷等级 | {{fault.defectLevel}} |
| 定级依据 | {{fault.defectBasis}}（规则 {{fault.defectRuleId}}） |
| 长文本 | {{notification.longText}} |

**归口建议**

| 项目 | 内容 | 说明 |
|---|---|---|
| 专业归口 | {{dispatch.discipline}} | {{dispatch.disciplineNote}} |
| 建议承修单位 | {{dispatch.vendor}} | {{dispatch.vendorNote}} |
| 工时 | — | {{dispatch.laborNote}} |
| 备件 | — | {{dispatch.spareNote}} |

**历史维修记录**

{{#history}}
| 维修日期 | 维修内容 | 承修单位/工作中心 | 原订单号 |
|---|---|---|---|
| {{date}} | {{content}} | {{vendor}} | {{orderNo}} |
{{/history}}
{{^history}}
{{historyNote}}。

【注意】本节内容一律来自历史维修记录或 SAP 订单历史，无记录即留空，不编造检修履历。
{{/history}}

{{#missing}}**本草稿信息待补充**：{{missing}}{{/missing}}

{{/orders}}

## 三、信息缺口清单

{{table:missingInfo}}

{{#undetermined}}
### 未判定项

{{table:undetermined}}

【未判定】以上字段未按默认值填充，请车间确认后补填再在 SAP 创建通知单。
{{/undetermined}}

<!-- ANALYSIS_START -->
（模型补写：本批通知单的停机与作业许可需求、与在途通知单/工单的衔接、需车间决策的事项）
<!-- ANALYSIS_END -->

## 附：数据提示

{{warnings}}

> {{meta.notice}}
