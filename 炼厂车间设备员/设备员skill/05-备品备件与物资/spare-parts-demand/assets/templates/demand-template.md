# {{workshop}} 备件需求申报稿（{{period}}）

数据来源：{{sources}}　推算口径：{{methodText}}
需求周期：{{period}}（按 {{months}} 个月计）　历史回溯：{{lookback}} 个月　历史期数下限：{{meta.minPeriods}} 期　建议到货提前：{{meta.leadDays}} 天
生成时间：{{generatedAt}}（北京时间）

> 本清单为车间申报稿，采购数量与定额以物资部门审定为准。

## 一、需求概况与口径说明

| 项目 | 数值 |
|---|---|
| 正式清单项数 | {{counts.items}} |
| 　其中检修计划驱动 | {{counts.itemsFromPlan}} |
| 　其中历史消耗驱动 | {{counts.itemsFromHistory}} |
| 净需求行数（按编码+单位） | {{counts.netDemand}} |
| 需采购项数 | {{counts.needPurchase}} |
| 库存充足无需采购项数 | {{counts.sufficient}} |
| 低置信度项（期数不足） | {{counts.lowConfidence}} |
| 编码待确认组数 | {{counts.codeAmbiguity}} |
| 无依据待核实项 | {{counts.noHistory}} |
| 单位不一致项 | {{counts.unitConflicts}} |

**口径说明**

{{methodNote}}

## 二、需求明细

{{table:items}}

## 三、{{netSectionTitle}}

{{grossWarning}}

{{table:netDemand}}

{{!-- netDemand 各行含 grossPlan（计划毛需求）/ grossHistory（历史毛需求）/ gross（合计）/ onHand / inTransit / net，表头：备件编码 | 名称 | 单位 | 计划毛需求 | 历史毛需求 | 毛需求合计 | 在库 | 在途 | 净需求 | 说明 --}}

## 四、低置信度项（历史期数不足，单列不进正式清单）

{{table:lowConfidence}}

## 五、编码待确认项（未自动合并）

{{codeAmbiguity}}

{{unitConflicts}}

## 六、无依据项（建议核实，不进正式清单）

{{table:noHistory}}

## 七、申报说明

<!-- ANALYSIS_START -->
{{analysis}}
<!-- ANALYSIS_END -->

---

> 本清单为车间申报稿，采购数量与定额以物资部门审定为准。

## 附：数据提示

{{warnings}}
