# 检修前设备交出单　{{tag}} {{name}}

{{#notReady}}> **【注意】尚不具备交出条件**：{{readyNote}}，逐项确认完成并四方签字前不得开始检修作业。
{{/notReady}}{{^notReady}}> 清单内 {{counts.total}} 项交出条目现场确认结果均为已完成，无未判定项；仍须四方签字后方可开始检修作业。
{{/notReady}}

> {{meta.declaration}}

## 一、设备与作业信息

| 项目 | 内容 |
|---|---|
| 位号 | {{meta.tag}} |
| 设备名称 | {{meta.name}} |
| 设备类型 | {{meta.equipType}}（归类：{{meta.equipCn}}） |
| 介质 | {{meta.medium}} |
| 介质危险特性 | {{meta.mediumHazardCn}} |
| 取用口径 | {{meta.mediumInLibrary}} 为 false 时写「介质不在库，按最严（高危）口径生成，须核实 MSDS」 |
| 检修内容 | {{meta.scope}} |
| 是否解体拆卸 | {{meta.dismantle}} |
| 是否进受限空间 | {{meta.entry}}（null 写「未说明」） |
| 是否用火作业 | {{meta.hotwork}}（null 写「未说明」） |
| 是否带压 | {{meta.pressured}}（操作压力 {{meta.pressure}} MPa；{{meta.pressureHint}} 非空时写「推断值「…」待确认，不进入判定」） |
| 是否高温 | {{meta.hot}}（操作温度 {{meta.temp}} ℃；{{meta.hotHint}} 同上） |
| 涉及作业许可 | {{meta.permits}}（用火作业 / 受限空间作业 / 盲板抽堵作业，办票预检用 permit-precheck-bridge，级别以作业票为准） |
| 所属车间 | {{meta.workshop}} |
| 计划检修日期 | {{meta.planDate}} |
| 生成时间 | {{meta.generatedAt}}（北京时间） |

## 二、关键条目（必须逐项落实并留痕）

{{table:criticalItems}}

> 关键条目未落实的，一律视为不具备交出条件，不得以「口头确认」代替书面记录。

## 三、交出条件逐项确认

{{table:items}}

> 「完成情况 / 确认人 / 确认时间」三栏由现场确认人填写，脚本不得预填。涉及用火、受限空间、盲板抽堵等作业的，须先办理相应作业许可并实行双监护（属地监护人 + 作业单位监护人）。

## 四、未判定项

{{table:undetermined}}

> 以上条目因判定依据缺失暂未确定是否必需，**不得按「不需要」处理**；补齐信息后重新生成清单。
> 【未判定】带压/高温推断值仅供参考（{{meta.pressureHint}}、{{meta.hotHint}}），须由工艺或车间设备员现场确认后以 --pressured / --hot 回填。

## 五、未完成项

{{table:notDone}}

> 存在任何一项未完成时，本设备不具备交出条件。

## 六、交出确认签字

| 确认方 | 确认内容 | 签字 | 日期时间 |
|---|---|---|---|
| 工艺（操作） | 停车、隔离、泄压、降温、吹扫置换及盲板加装均已完成 | | |
| 设备（车间设备员） | 机械隔离、盘车防转、联轴器拆除及设备状态确认 | | |
| 安全 | 取样分析结果合格、受限空间与用火条件、作业许可与双监护、现场消防与警戒措施 | | |
| 检修（承修单位） | 已接收设备并确认交出条件，具备开工条件 | | |

> {{meta.declaration}}

## 附：数据提示

{{warnings}}
