# {{workshop}} 设备{{periodCn}}（{{from}} ~ {{to}}）

统计区间：{{from}} ~ {{to}}，共 {{spanDays}} 天；{{basedOn}}
指标口径：{{rulesSource}}
数据来源：{{sources}}
生成时间：{{generatedAt}}（北京时间）

> {{notice}}

## 一、总体概况

{{table:overview}}

## 二、关键指标

{{table:metrics}}

指标口径说明：{{basedOn}}。泄漏率考核线以厂内指标为准，本技能不比对；未提供的指标写「未提供」，不估算。

{{#recompute}}
【注意】以下指标厂内口径表命中、但算法与脚本默认算法不一致且未提供结构化口径参数，**未出数（显示 —），需按厂内口径复算**：

{{table:recompute}}
{{/recompute}}

{{#noDenominator}}
**以下指标因分母缺失未计算（显示 —），未以在册台数或估计值代替：**

{{table:noDenominator}}
{{/noDenominator}}

{{#notProvided}}
**以下指标本期未提供数据（显示 —），不估算：**

{{table:notProvided}}
{{/notProvided}}

## 三、特护设备运行状况

{{specialSection}}

## 四、故障统计

{{failuresSection}}

{{shutdownSection}}

## 五、检修计划执行

{{maintenanceSection}}

{{#maintUndetermined}}
**未判定项（缺字段，未按按期或延期默认处理）**

{{table:maintUndetermined}}
{{/maintUndetermined}}

## 六、工单与缺陷

{{ordersSection}}

{{defectsSection}}

## 七、备件消耗

{{spareSection}}

## 八、重点事项

{{highlightsSection}}

## 九、环比与同比

{{compareSection}}

## 十、数据缺口

{{table:dataGaps}}

{{#missingDates}}
**缺失日期的数据未按已有天数平均后外推补齐**，所有指标仅基于实际覆盖的天数计算。
{{/missingDates}}

## 十一、设备管理分析

<!-- ANALYSIS_START -->
{{analysis}}
<!-- ANALYSIS_END -->

## 十二、下期重点

_下期重点由车间填写，本技能不代为拟定。_

本材料由脚本汇总、模型成文，仅供设备员复核参考，不替代审批、定性、验收与签字；厂内制度与系统数据为准。

## 附：数据提示

{{warnings}}
