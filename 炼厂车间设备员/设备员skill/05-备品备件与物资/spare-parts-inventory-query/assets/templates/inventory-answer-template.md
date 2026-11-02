# 备件库存查询 · 回答模板

> 占位符取自 `inventory.json`；数量、库位、候选一律引用脚本产出，不自行统计。回答以对话形式组织，不必照搬节标题。

**查询**：{{meta.query}}{{#meta.tag}}（按设备位号 {{meta.tag}}，匹配依据：{{meta.tagSource}}）{{/meta.tag}}　**数据来源**：{{meta.source}}（SAP MM / EM 库存导出）

## 一、查询结果

{{#counts.matched}}
{{table:matches}}
{{/counts.matched}}
{{^counts.matched}}
库存表中未查到「{{meta.query}}」。未放宽条件返回近似结果；如需模糊匹配请说明，匹配结果需人工核对。
{{/counts.matched}}

## 二、低于安全库存

{{table:belowSafety}}

{{#counts.safetyUndetermined}}
**无法判定是否低于安全库存**（库存量为空或未设安全库存 / 再订货点，未按满足处理）

{{table:safetyUndetermined}}
{{/counts.safetyUndetermined}}

## 三、在途情况

{{#meta.intransitProvided}}{{table:inTransit}}{{/meta.intransitProvided}}
{{^meta.intransitProvided}}未提供在途采购表，不显示在途情况。{{/meta.intransitProvided}}

## 四、同规格候选（代用参考）

{{#meta.alternativesEnabled}}
{{#alternatives}}
### {{code}} {{name}}（类别：{{category}}）
{{#queriedNoStock}}【注意】所查件当前无库存，有库存的同类候选已置顶；仍只是候选，不是代用结论。{{/queriedNoStock}}

{{table:candidates}}

代用前须确认的技术要点：{{checkPoints}}

{{note}}
{{/alternatives}}
{{/meta.alternativesEnabled}}
{{^meta.alternativesEnabled}}未启用代用候选检索。{{/meta.alternativesEnabled}}

## 五、同名多编码待确认

{{table:ambiguous}}

---

{{meta.statement}}

设备台账参数（型号、投用年限、检修历史）请用 equipment-ledger-query 技能；备件需求提报用 spare-parts-demand；消耗分析用 spare-parts-consumption-analysis。

{{!-- 措辞硬约束：不得出现「可以代用」「建议代用」「应该能用」；查不到时不得返回近似型号；同名不同编码不得合并库存量。 --}}
