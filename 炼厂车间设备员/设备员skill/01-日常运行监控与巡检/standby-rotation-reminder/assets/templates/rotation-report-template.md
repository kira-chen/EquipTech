<!-- 模板占位符 {{路径}} 与 rotation.json 的键一一对应（meta.* / counts.* / standbyAvailability.* / executionRate.*），数组节用 {{table:数组}} 表示按该数组出表。脚本本身不读此模板，rotation-report.md 由脚本直接生成；本模板仅供用户要求调整版式时参照。 -->
# {{meta.workshop}} 备用设备切换盘车报告（基准日 {{meta.date}}）

数据来源：{{meta.source}}{{#meta.equipmentScope}} ｜ 设备范围：{{meta.equipmentScope}}{{/meta.equipmentScope}} ｜ 提前提醒天数：{{meta.leadDays}} 天 ｜ 长期未切换阈值：{{meta.longIdleBasis}}
生成时间：{{meta.generatedAt}}（北京时间） ｜ 编制：车间设备员 ｜ 报送：车间设备主任 / 公司设备管理部门（机动部/设备部）

> **{{meta.declaration}}。**

## 一、到期概览

| 指标 | 数量 |
|---|---|
| 台账行数 | {{counts.ledgerRows}} |
| 已配对机组（主备组） | {{counts.pairs}} |
| 主备无法配对 | {{counts.pairingIssues}} |
| 当前主用按切换记录推导的机组 | {{counts.rolesFromRecords}} |
| 切换逾期 | {{counts.switchOverdue}} |
| 切换临期（≤{{meta.leadDays}}天） | {{counts.switchDueSoon}} |
| 盘车逾期 | {{counts.turningOverdue}} |
| 盘车临期（≤{{meta.leadDays}}天） | {{counts.turningDueSoon}} |
| 试运逾期 | {{counts.trialOverdue}} |
| 长期未切换（{{meta.longIdleBasis}}） | {{counts.longIdle}} |
| 备机检修中（不进到期清单） | {{counts.standbyInRepair}} |
| 备机停用（不进到期清单） | {{counts.standbyStopped}} |
| 备机可随时投用台数 | {{counts.standbyAvailable}} |
| 备机完好率 | {{counts.standbyAvailabilityRate}} |
| 无法判定 | {{counts.undetermined}} |
| 切换盘车记录条数 | {{counts.records}} |
| 切换执行率 | {{counts.switchRate}} |
| 盘车执行率 | {{counts.turningRate}} |

_「当前主用/当前备用」按切换记录中最近一次带切换方向的记录推导；无方向记录时按台账列展示，角色来源见 rotation.json 的 pairs.roleSource。_

## 二、切换逾期与临期

**切换逾期**

{{table:switchOverdue}}

**切换临期**

{{table:switchDueSoon}}

## 三、盘车逾期与临期

**盘车逾期**

{{table:turningOverdue}}

**盘车临期**

{{table:turningDueSoon}}

**试运逾期与临期**（台账有试运周期时）

{{table:trialOverdue}}

{{table:trialDueSoon}}

## 四、长期未切换清单

{{table:longIdle}}

## 五、备机检修中与停用

{{table:standbyUnavailable}}

_{{standbyAvailability.note}}_

## 六、执行率统计

统计区间：{{executionRate.from}} 至 {{executionRate.to}}（共 {{executionRate.windowDays}} 天）

**合计**

| 工作类型 | 计划次数 | 实际执行次数 | 执行率 |
|---|---|---|---|
| 切换 | {{executionRate.overall.switch.planned}} | {{executionRate.overall.switch.actual}} | {{executionRate.overall.switch.rate}} |
| 盘车 | {{executionRate.overall.turning.planned}} | {{executionRate.overall.turning.actual}} | {{executionRate.overall.turning.rate}} |
| 试运 | {{executionRate.overall.trial.planned}} | {{executionRate.overall.trial.actual}} | {{executionRate.overall.trial.rate}} |

**按机组**

{{table:executionRate.byPair}}

## 七、无法判定与主备配对异常

**无法判定清单**

{{table:undetermined}}

**主备配对异常**

{{table:pairingIssues}}

## 八、备用设备管理说明

<!-- ANALYSIS_START -->
{{analysis}}
<!-- ANALYSIS_END -->

> **{{meta.declaration}}。** 本技能不编制切换操作方案与操作票，不判定工艺是否具备切换条件；切换条件确认由工艺归口，操作票执行由操作班组归口。

> {{meta.generalDeclaration}}

## 附、数据提示

{{#warnings}}
- {{.}}
{{/warnings}}
