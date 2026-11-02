# {{meta.workshop}} 维修工单跟踪（{{range}}）

> {{meta.disclaimer}}

数据来源：{{meta.source}}{{#meta.vendorFilter}} ｜ 承修单位/工作中心：{{meta.vendorFilter}}{{/meta.vendorFilter}}{{#meta.ownerFilter}} ｜ 责任人：{{meta.ownerFilter}}{{/meta.ownerFilter}}
时限口径：{{meta.slaSource}}（抢修 {{meta.slaDays.抢修}} 天、一般 {{meta.slaDays.一般}} 天、计划性 {{meta.slaDays.计划性}} 天）｜ 停滞阈值：{{meta.stallDays}} 天 ｜ 临期窗口：{{meta.dueSoonDays}} 天
{{#metrics.slaNote}}【注意】{{metrics.slaNote}}{{/metrics.slaNote}}
生成时间：{{meta.generatedAt}}（北京时间）

## 一、状态分布

| 状态 | 工单数 |
|---|---|
| 待审核 | {{byStatus.待审核}} |
| 已派工 | {{byStatus.已派工}} |
| 施工中 | {{byStatus.施工中}} |
| 待验收 | {{byStatus.待验收}} |
| 已闭环 | {{byStatus.已闭环}} |
| 已取消 | {{byStatus.已取消}} |
| 未知状态（单列） | {{counts.unknownStatus}} |
| 合计 | {{counts.total}} |

【注意】状态按 SAP 系统状态归一：CRTD/OSNO→待审核，REL/NOPR→已派工，PCNF→施工中，TECO/CNF/「已完成」「完工」→待验收，CLSD/NOCO→已闭环，DLFL/LKD→已取消。「已完成」不等于闭环，须验收关闭后才计入已闭环。

## 二、超期工单

{{table:overdue}}

## 三、停滞工单

_判定口径：未闭环且最后一个有值节点距 {{meta.date}} 已 {{meta.stallDays}} 天及以上（`--stall-days` 可调）。_

{{table:stalled}}

{{#stallUndetermined}}**停滞未判定**（节点时间全缺，不按当前时间补齐）：

{{table:stallUndetermined}}{{/stallUndetermined}}

## 四、临期工单

_判定口径：未闭环且距要求完成时间不超过 {{meta.dueSoonDays}} 天（`--due-soon` 可调）。_

{{table:dueSoon}}

## 五、区间内闭环工单

{{table:closed}}

## 六、指标统计

| 指标 | 数值 |
|---|---|
| 工单总数 | {{counts.total}} |
| 在办（未闭环） | {{counts.open}} |
| 已闭环 | {{counts.closedAll}} |
| 已取消 | {{counts.cancelled}} |
| 完成率 | {{metrics.closeRate}} |
| 平均闭环时长(天) | {{metrics.avgCycleDays}} |
| 闭环时长可计算样本 | {{metrics.cycleSample}} / {{counts.closedAll}} |
| 超期 | {{counts.overdue}} |
| 停滞 | {{counts.stalled}} |
| 临期 | {{counts.dueSoon}} |
| 未知状态 | {{counts.unknownStatus}} |

完成率口径：{{metrics.closeRateBasis}}。

**按时限类别达标情况**

{{table:metrics.byCategory}}

**按 SAP 优先级分布**

{{table:metrics.byPriority}}

## 七、未知状态工单

_状态取值不在 SAP 系统状态与「待审核 / 已派工 / 施工中 / 待验收 / 已闭环 / 已取消」六态枚举内，一律单列，不做就近映射。_

{{table:unknownStatus}}

## 八、工单执行情况说明

<!-- ANALYSIS_START -->
{{analysis}}
<!-- ANALYSIS_END -->

## 附：数据提示

{{warnings}}
