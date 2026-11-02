# {{meta.workshop}} 泄漏点登记与修复跟踪（截至 {{meta.date}}）

<!-- 版式参考：占位符均为 leaks.json 的键（点路径），{{table:X}} 表示把 leaks.json 的数组 X 渲染成表。脚本不读取本模板，报告由 track.js 直接生成；本文件只在用户要求调整版式时作参照。 -->

> 【注意】**重点提示**（存在超期未修或未判定项时由脚本写入；均无时改为「本期无超期未修漏点，亦无因数据缺失而未判定的记录」）

统计截止：{{meta.date}} ｜ 数据来源：{{meta.input}}（工作表「{{meta.sheet}}」） ｜ 历史台账：{{meta.ledger}}
认定口径：{{meta.rulesSource}}
泄漏认定阈值：气体/轻液 {{meta.thresholds.voc}} μmol/mol；重液 {{meta.thresholds.liquid}} μmol/mol；现场可见泄漏按滴漏或成股流出定性认定
修复时限：首次修复 {{meta.limits.repairDays}} 天内，最终修复 {{meta.limits.finalDays}} 天内（自检测/发现日期起算）；经批准的延迟修复单列，不计超期
密封点总数：{{metrics.leakRate.sealPointsSource}}
{{meta.sourceLine}}
生成时间：{{meta.generatedAt}}（北京时间）

**本报告为车间内部泄漏点跟踪材料，不替代法定 LDAR 检测报告与排污许可执行报告；泄漏认定阈值、修复时限与泄漏率考核线以现行法规与厂内规定为准，达标判定以生态环境主管部门意见为准。**

## 一、总体概览

| 指标 | 数量 |
|---|---|
| 本期记录数 | {{counts.records}} |
| 认定泄漏（合计） | {{counts.leaks}} |
| 　其中：仪器检测认定 | {{counts.instrumentLeaks}} |
| 　其中：现场可见泄漏认定 | {{counts.visibleLeaks}} |
| 　其中：静密封点 | {{counts.staticLeaks}} |
| 　其中：动密封点 | {{counts.dynamicLeaks}} |
| 　其中：静/动未识别 | {{counts.unclassifiedLeaks}} |
| 本期新增漏点 | {{counts.newLeaks}} |
| 历史续跟踪漏点 | {{counts.carryOver}} |
| 未修复（期限内） | {{counts.open}} |
| 超期未修 | {{counts.overdue}} |
| 延迟修复（经批准） | {{counts.delayed}} |
| 本期修复闭环 | {{counts.repaired}} |
| 未判定 | {{counts.undetermined}} |
| 未认定泄漏 | {{counts.noLeak}} |
| 不可达点 | {{counts.unreachable}} |
| 密封点编号重复 | {{counts.duplicateNo}} |

修复率：**{{metrics.repairRate}}%**（最终修复 {{counts.repaired}} / 认定泄漏 {{counts.leaks}}）

平均修复时长：**{{metrics.avgRepairDays}} 天**

**静/动密封点泄漏率（‰）：**

| 密封类型 | 认定泄漏点数 | 密封点总数 | 泄漏率(‰) | 考核线(‰) | 判定 |
|---|---|---|---|---|---|
| 静密封点 | {{metrics.leakRate.static.leaks}} | {{metrics.leakRate.static.total}} | {{metrics.leakRate.static.rate}} | {{metrics.leakRate.static.limit}} | {{metrics.leakRate.static.pass}} |
| 动密封点 | {{metrics.leakRate.dynamic.leaks}} | {{metrics.leakRate.dynamic.total}} | {{metrics.leakRate.dynamic.rate}} | {{metrics.leakRate.dynamic.limit}} | {{metrics.leakRate.dynamic.pass}} |

【注意】{{metrics.leakRate.note}}

**两类来源分别统计，不混算：**（仪器检测 {{counts.instrument}} / {{counts.instrumentLeaks}}；现场可见泄漏 {{counts.visible}} / {{counts.visibleLeaks}}；未判定 {{counts.undetermined}}）

## 二、本期新增漏点

{{table:newLeaks}}

## 三、超期未修清单

{{table:overdue}}

## 四、未修复（期限内）

{{table:open}}

## 五、延迟修复（经批准）

{{table:delayed}}

## 六、未判定清单

_检测值为空或无法解析、介质状态无法归类、泄漏形态不明、不可达点未检测、修复状态无法识别、延迟修复无批准日期的记录。**一律未按 0 计为不泄漏，也未按泄漏认定或按超期处理**，须补测或补录后重新判定。_

{{table:undetermined}}

## 七、本期修复闭环

_已完成最终修复并填写最终修复日期的漏点。状态填「已修复」但无最终修复日期的，仍列在「四、未修复」中，不计入闭环。_

{{table:repaired}}

## 八、编号重复与数据提示

_密封点编号重复时，脚本**两条均保留并各自判定，未自动合并**，须核实是否为同一密封点。_

{{table:duplicates}}

## 九、泄漏管理情况说明

<!-- ANALYSIS_START -->
（模型撰写 200~400 字：总体情况 → 新增漏点 → 超期未修与延迟修复 → 修复闭环与泄漏率 → 下一步安排）
<!-- ANALYSIS_END -->

## 附：数据提示

{{table:warnings}}
