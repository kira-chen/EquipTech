# 设备缺陷登记单{{#meta.workshop}}（{{meta.workshop}}）{{/meta.workshop}}

生成时间：{{meta.generatedAt}}（北京时间）　登记方式：{{meta.mode}}　分级方案：{{meta.gradingSchemeName}}

> {{meta.disclaimer}}

## 一、登记概览

| 指标 | 数量 |
|---|---|
| 登记条数 | {{counts.total}} |
{{#counts.byLevel}}| 　{{key}} | {{value}} |
{{/counts.byLevel}}| 疑似重复 | {{counts.possibleDuplicate}} |
| 可生成通知单草稿 | {{counts.notificationDrafts}} |

【注意】建议处理时限为经验默认值（{{meta.dueDays}}），厂内缺陷管理规定另有要求时以厂内为准，可用 `--due` 覆盖。

## 二、缺陷单

{{#defects}}
### {{no}}　{{tag}} {{name}}

| 项目 | 内容 |
|---|---|
| 位号（功能位置） | {{tag}} |
| SAP 设备编号 | {{equipNo}} |
| 设备名称 | {{name}} |
| 缺陷部位 | {{part}} |
| 现象类型 | {{phenomenonCn}} |
| 缺陷描述 | {{desc}} |
| 介质 | {{medium}} |
| 介质危险性 | {{mediumHazard}} |
| 是否影响运行 | {{affectsRun}} |
| 发现时间 | {{foundAt}} |
| 发现人 | {{by}} |
| **等级** | **{{levelCn}}** |
| 定级依据 | {{basis}}（规则 {{ruleId}}） |
| 建议处理时限 | {{dueDays}} 天内，即 {{dueDate}} 前 |
| 建议责任专业 | {{discipline}} |
| 通知单建议 | {{notification.typeCn}}，SAP 优先级 {{notification.sapPriority}} |

{{/defects}}

## 三、未判定清单

{{table:undetermined}}

【未判定】以上缺陷因定级字段缺失未定级，不按最低或最高等级默认，补齐后重新运行即可定级；未判定项不进入通知单草稿。

## 四、疑似重复清单

{{#possibleDuplicate}}
**{{no}}　{{tag}}**：{{desc}}

{{table:similar}}

> {{note}}
{{/possibleDuplicate}}

## 五、维修通知单草稿

{{table:notificationDrafts}}

【注意】通知单号由 SAP 系统生成，本表只给草稿序号；通知单类型（M1 维修申请 / M2 故障报告）与故障代码按厂内目录核对后在 SAP 中创建，优先级按 1 非常高 / 2 高 / 3 中 / 4 低。工单（订单）由计划员或承修单位创建，设备员不填工时与备件。完整列见 `notification.csv`。

## 附：数据提示

{{warnings}}
