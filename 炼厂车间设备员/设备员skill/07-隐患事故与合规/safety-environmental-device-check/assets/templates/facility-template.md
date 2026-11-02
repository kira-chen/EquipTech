# {{workshop}} 安全环保设施状态检查（基准日 {{date}}）

{{#alertNeeded}}
> **{{alert}}**

> 失效或停用 {{counts.outOfService}} 台、超期未检 {{counts.overdue}} 台，明细见第二、三节。
{{/alertNeeded}}

数据来源：{{source}}／安全环保设施台账{{#category}} ｜ 筛选类别：{{category}}{{/category}} ｜ 提前提醒：{{leadDays}} 天
生成时间：{{generatedAt}}（北京时间）

> {{meta.scopeNote}}

## 一、总体概览与完好率

| 指标 | 数量 |
|---|---|
| 设施总台数 | {{counts.total}} |
| 完好（在检测周期内且结果合格，含临期） | {{metrics.intact}} |
| 失效或停用 | {{counts.outOfService}} |
| 超期未检 | {{counts.overdue}} |
| 临期（{{leadDays}} 天内） | {{counts.dueSoon}} |
| 不合格未整改 | {{counts.unresolvedFail}} |
| 待确认 | {{counts.undetermined}} |
| 其中：失效设施同时已超期 | {{counts.outOfServiceOverdue}} |
| 状态与结果矛盾 | {{counts.contradiction}} |

**总体完好率：{{metrics.intactRate}}**（完好台数 {{metrics.intact}} ÷ 设施总台数 {{counts.total}}；完好 = 在用 + 检测结果未否定 + 未超期（含临期））

_应检测日期按「上次检测日期 + 检测周期」计算：月/季/年/半年按自然月折算，天/周按天折算；台账未登记周期的不代入任何默认周期。_

{{#metrics.rateNote}}_{{metrics.rateNote}}，完好率显示为「—」，不按 0% 处理。_{{/metrics.rateNote}}

## 二、失效停用设施（醒目）

_状态为失效、故障或停用的设施，无论是否在检测周期内一律列出；整改完成前按失去该项安全保护功能管理。_

{{table:outOfService}}

## 三、超期未检清单

{{table:overdue}}

## 四、不合格未整改清单

{{table:unresolvedFail}}

## 五、临期清单

{{table:dueSoon}}

## 六、待确认项

{{table:undetermined}}

## 七、分类完好率

{{table:byCategory}}

## 八、检测计划安排

{{table:plan}}

## 附一、状态与检测结果矛盾

{{table:contradiction}}

## 附二、台账下次检测日期与计算值不一致

{{table:nextMismatch}}

## 附三、设施编号重复

{{table:dupIds}}

## 九、安全环保设施状态说明

<!-- ANALYSIS_START -->
{{analysis}}
<!-- ANALYSIS_END -->

---

> {{meta.statement}}

## 附：数据提示

{{warnings}}
