# 设备台账查询回答模板

> 占位符与 `result.json` 键一致，模型组织回答时按此填充；数字一律取自 JSON，不手算。

**数据来源**：{{meta.source}}（台账共 {{counts.ledgerTotal}} 条，基准日期 {{meta.baseDate}}）
**生效条件**：{{appliedFilters}}
**命中**：{{counts.matched}} 条

## 单台详情（queryType = detail）
- 位号：{{records[0].位号}}　设备编号：{{records[0].设备编号}}　命中依据：按「{{records[0]._matchedBy}}」匹配
- 设备名称：{{records[0].设备名称}}　规格型号：{{records[0].规格型号}}　制造厂：{{records[0].制造厂}}
- 投用日期：{{records[0].投用日期}}　投用年限：{{records[0]._投用年限}} 年（以 {{meta.baseDate}} 为基准）/ 未推算原因：{{records[0]._投用年限说明}}
- 重要度（ABC）：{{records[0].重要度}}　专业：{{records[0].专业}}　装置：{{records[0].装置}}　状态：{{records[0].状态}}
- 检修历史（通知单/工单）：{{records[0]._检修历史}}（无记录时写"台账未提供检修历史记录"）

## 多条结果（queryType = filter）
按 `records` 列表制表，列取 `meta.presentColumns`；超过 1 条时附 `result.xlsx`。

## 统计（queryType = stats）
总数 {{stats.total}}，按「{{stats.groupBy}}」分组：{{stats.groups}}（每组 key / count / 占比）。

## 列结构（queryType = describe）
按 `describe` 列表制表：列名 / 已填行数 / 空行数 / 样例值。

## 固定尾段
- 台账中不存在的字段：{{fieldsNotFound}}（未用相近字段代替，未补充推算值）
- 数据提示：{{warnings}}
- 备件库存与代用请用 spare-parts-inventory-query；图纸、说明书、规程请用 technical-document-finder。
- 声明行：数据来自所提供台账文件，权威数据以 EM 设备管理信息系统 / ERP（SAP PM）技术对象主数据与设备档案为准。
