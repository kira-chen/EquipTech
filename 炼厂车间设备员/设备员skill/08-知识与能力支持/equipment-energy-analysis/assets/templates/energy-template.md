# {{workshop}} 设备能效分析与对标（{{from}} 至 {{to}}）

设备类型：{{equipType}}　｜　偏低判定：低于基准的 {{thresholdPct}}　｜　设计参数：{{designProvided}}
生成时间：{{generatedAt}}（北京时间）

> 本报告为单台设备的能效口径分析，不是装置综合能耗统计；装置级能耗与对标请使用 energy-weekly-report 技能。

## 一、统计概览

{{table:overview}}

## 二、逐台能效明细

{{table:byEquipment}}

{{designNote}}

## 三、能效偏低清单

{{table:lowEfficiency}}

> 以上仅列出需核实的方向，未判定能效偏低的原因；确认原因需结合现场检查、工况核对与仪表校验。

## 四、同类设备对比

{{table:groupComparison}}

## 五、数据不足与异常值

### 5.1 计算参数不全

{{table:insufficientData}}

> 以上设备效率均为 —，**未用典型效率值或典型参数代替缺失项**，需补齐参数后重算。

### 5.2 超出物理合理范围

{{table:implausible}}

> 以上结果已原样保留、**未截断到合理范围后呈现**，属数据问题而非设备结论，请先核实原始数据的单位、量程与取数时点。

### 5.3 费用差额测算

{{table:savingPotential}}

> 合计费用差额：{{savingTotal}} 元。费用差额为按当前运行条件、以组内最优或设计效率为参照的静态测算，未考虑工况变化、负荷率、检修投入与工艺约束，不等于可实现的节能收益。

## 六、能效分析

<!-- ANALYSIS_START -->
{{analysis}}
<!-- ANALYSIS_END -->

---

> 费用差额为按当前运行条件、以组内最优或设计效率为参照的静态测算，未考虑工况变化、负荷率、检修投入与工艺约束，不等于可实现的节能收益。

> 本报告为单台设备的能效口径分析，不是装置综合能耗统计；装置级能耗与对标请使用 energy-weekly-report 技能。

## 附：数据提示

{{warnings}}
