# {{meta.workshop}} 设备日报（{{meta.date}}）

数据来源：{{meta.sources}}{{#meta.shift}}　｜　值班：{{meta.shift}}{{/meta.shift}}
生成时间：{{meta.generatedAt}}（北京时间）

## 一、设备状态概览

| 状态（六档） | 台数 |
|---|---|
| 涉及设备 | {{status.equipment}} |
| 运行 | {{status.byState.运行}} |
| 备用 | {{status.byState.备用}} |
| 检修 | {{status.byState.检修}} |
| 停用 | {{status.byState.停用}} |
| 异常 | {{status.byState.异常}} |
| 未判定 | {{status.byState.未判定}} |
| 漏检 | {{status.missed}} |

## 二、特护设备运行状况

共 {{special.total}} 台（来源：{{special.source}}），异常 {{special.abnormal}} 台。
{{table:special.list}}

## 三、异常与缺陷

{{table:status.abnormalList}}

**新增缺陷（维修通知单）{{defects.newCount}} 条**
{{table:defects.newList}}

**未闭环缺陷 {{defects.openCount}} 条**，其中待验收 {{defects.pendingAccept}} 条
{{table:defects.openList}}

## 四、工单执行

| 指标 | 数量 |
|---|---|
| 工单总数 | {{orders.total}} |
| 未闭环 | {{orders.open}} |
| 其中待验收（完工未验收） | {{orders.pendingAccept}} |
| 超期 | {{orders.overdue}} |
| 停滞 | {{orders.stalled}} |
| 本期闭环 | {{orders.closedInRange}} |
| 闭环率 | {{orders.closeRate}} |

{{table:orders.overdueList}}

## 五、当日检修作业与作业票

本日作业票 {{permits.total}} 张：{{permits.byType}}。属地监护人未填 {{permits.noGuardian}} 张。
{{table:permits.list}}

**检修进度**
{{table:maintenance.list}}

## 六、泄漏点

| 指标 | 数量 |
|---|---|
| 泄漏点总数 | {{leaks.leaks}} |
| 本日新增 | {{leaks.newLeaks}} |
| 未修复 | {{leaks.open}} |
| 超期未修 | {{leaks.overdue}} |
| 已修复 | {{leaks.repaired}} |
| 修复率 | {{leaks.repairRate}} |

{{table:leaks.overdueList}}

## 七、隐患

| 指标 | 数量 |
|---|---|
| 隐患总数 | {{hazards.total}} |
| 重大隐患 | {{hazards.major}} |
| 超期未整改 | {{hazards.overdue}} |
| 已闭环 | {{hazards.closed}} |
| 未判定 | {{hazards.undetermined}} |

{{table:hazards.majorList}}
{{table:hazards.overdueList}}

## 八、异常事件

共 {{events.total}} 条，其中未闭环 {{events.unclosed}} 条。
{{table:events.list}}

{{#compare}}
## 九、环比

| 指标 | 较 {{compare.prevDate}} |
|---|---|
| 异常设备 | {{compare.abnormal}} |
| 超期工单 | {{compare.overdueOrders}} |
| 未闭环缺陷 | {{compare.openDefects}} |
| 未修复泄漏点 | {{compare.openLeaks}} |
| 超期隐患 | {{compare.overdueHazards}} |
{{/compare}}

## {{n1}}、设备运行情况说明

<!-- ANALYSIS_START -->
{{analysis}}
<!-- ANALYSIS_END -->

## {{n2}}、次日计划

{{plan}}

本材料由脚本汇总、模型成文，仅供设备员复核参考，不替代审批、定性、验收与签字；厂内制度与系统数据为准。

## 附：数据提示

{{warnings}}
