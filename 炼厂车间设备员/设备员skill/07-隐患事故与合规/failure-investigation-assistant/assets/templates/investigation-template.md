<!-- 占位符与 investigation.json 键一致：meta.*、counts.*、timeline[].* 等；条件块 {{#x}}…{{/x}} 表示有值时才输出 -->
# {{#meta.workshop}}{{meta.workshop}} {{/meta.workshop}}{{meta.tag}}{{#meta.name}} {{meta.name}}{{/meta.name}} 故障调查资料归集

故障发生时间：{{meta.failureTime}}（北京时间）　时间窗口：故障前 {{meta.window.before}} 小时至故障后 {{meta.window.after}} 小时（{{meta.window.start}} ~ {{meta.window.end}}）
数据来源：{{meta.sources}}
生成时间：{{meta.generatedAt}}（北京时间）

> {{meta.disclaimer}}。
> {{meta.disclaimerGeneral}}

<!-- meta.window.defaulted.before / .after / .gap 任一为 true 时输出下一行，列出为 true 的项 -->
【注意】本次 回溯时长 / 后续时长 / 缺口阈值 使用了经验默认值（{{meta.defaultsNote}}）

【注意】{{meta.gradingNote}}

> 章节框架对应中石化设备事故调查报告常规章节（概况、经过、原因分析、责任分析、损失情况、防范措施）；本材料未作定性，标题统一用「故障」，定性后由调查组改写。

## 一、故障概况

| 项目 | 内容 |
|---|---|
| 设备位号 | {{meta.tag}} |
| 设备名称 | {{meta.name}} |
| 所属车间 | {{meta.workshop}} |
| 发生时间 | {{meta.failureTime}} |
| 故障现象 | {{meta.symptom}} |
| 归集时间窗口 | {{meta.window.start}} ~ {{meta.window.end}}（前 {{meta.window.before}} h / 后 {{meta.window.after}} h） |
| 时间线条目 | {{counts.timeline}} |
| 涉及来源数 | {{counts.sources}} |

> 以上为记录中的事实陈述，不含原因判断。

## 二、故障经过（时间线）

| 时间 | 来源 | 数据类型 | 记录内容 | 相对故障(h) | 出处 |
|---|---|---|---|---|---|
| {{timeline[].time}} | {{timeline[].source}} | {{timeline[].dataType}} | {{timeline[].content}} | {{timeline[].offsetHours}} | {{timeline[].sheet}} 第{{timeline[].row}}行 |

> 时间线按各来源记录原文陈述，条目之间不作因果关联；先后顺序不代表因果关系。

> **只陈述记录中的事实**，不得出现「导致」「因此」「造成」「引起」「说明」「由于」「致使」「所致」一类的因果连接词（规则 C1~C8）。

## 三、故障前后参数与报警

### 3.1 运行参数

| 时间 | 来源 | 位号 | 参数名 | 数值 | 单位 | 相对故障(h) | 出处 |
|---|---|---|---|---|---|---|---|
| {{paramChanges[].time}} | {{paramChanges[].source}} | {{paramChanges[].tag}} | {{paramChanges[].param}} | {{paramChanges[].value}} | {{paramChanges[].unit}} | {{paramChanges[].offsetHours}} | {{paramChanges[].sheet}} 第{{paramChanges[].row}}行 |

### 3.2 报警序列

| 序 | 时间 | 来源 | 报警内容 | 级别 | 相对故障(h) | 出处 |
|---|---|---|---|---|---|---|
| {{alarms[].seq}} | {{alarms[].time}} | {{alarms[].source}} | {{alarms[].content}} | {{alarms[].level}} | {{alarms[].offsetHours}} | {{alarms[].sheet}} 第{{alarms[].row}}行 |

> 参数与报警均为记录原值；数值无法解析的按空值显示为「—」，未按 0 计，未作任何插值。

## 四、相关检修与变更历史

| 检修日期 | 距故障(天) | 类别（原文） | 检修分级 | 工单/通知单 | 检修内容 | 验收结论 | 出处 |
|---|---|---|---|---|---|---|---|
| {{maintenanceHistory[].date}} | {{maintenanceHistory[].daysBeforeFailure}} | {{maintenanceHistory[].category}} | {{maintenanceHistory[].categoryNorm}} | {{maintenanceHistory[].orderNo}} / {{maintenanceHistory[].noticeNo}} | {{maintenanceHistory[].content}} | {{maintenanceHistory[].conclusion}} | {{maintenanceHistory[].sheet}} 第{{maintenanceHistory[].row}}行 |

> 检修历史仅作材料罗列，与本次故障是否相关由调查组认定。检修分级按《中石化口径对照》映射（大修→装置大检修，中修/小修→日常维修；SAP 订单类型只映射 PM01 日常维修 / PM03 抢修，PM02 等厂内可配置项不猜），原文保留；无法映射的显示「—」。

## 五、数据缺口与时间戳差异

### 5.1 数据缺口

| 来源 | 数据类型 | 缺口起 | 缺口止 | 时长(分钟) | 位置 | 处理 |
|---|---|---|---|---|---|---|
| {{dataGaps[].source}} | {{dataGaps[].dataType}} | {{dataGaps[].from}} | {{dataGaps[].to}} | {{dataGaps[].minutes}} | {{dataGaps[].position}} | 原样标注，未插值填补 |

> 缺口判定仅针对连续采样类数据（运行参数），阈值 {{meta.window.gapThresholdMinutes}} 分钟；操作、巡检、值班、报警属事件触发型记录，疏密不均不按缺口论。缺口区间一律原样标注，**不作插值、不作推测填补**。

### 5.2 各来源时间戳差异

**「{{timeInconsistency[].content}}」** —— 最大差异 {{timeInconsistency[].maxDiffMinutes}} 分钟

| 来源 | 记录时间 | 数据类型 | 出处 |
|---|---|---|---|
| {{timeInconsistency[].records[].source}} | {{timeInconsistency[].records[].time}} | {{timeInconsistency[].records[].dataType}} | {{timeInconsistency[].records[].sheet}} 第{{timeInconsistency[].records[].row}}行 |

> 全部保留，按来源分别标注；脚本不校准时间、不取其一。各来源时间戳存在差异，差异原因须由调查组核实系统对时情况后认定。

### 5.3 时间戳缺失条目

| 来源 | 数据类型 | 记录内容 | 原始时间值 | 处理 | 出处 |
|---|---|---|---|---|---|
| {{missingTime[].source}} | {{missingTime[].dataType}} | {{missingTime[].content}} | {{missingTime[].timeRaw}} | 未推测补齐 | {{missingTime[].sheet}} 第{{missingTime[].row}}行 |

### 5.4 超出时间窗口的记录

| 时间 | 来源 | 数据类型 | 记录内容 | 出处 |
|---|---|---|---|---|
| {{outOfWindow[].timeCn}} | {{outOfWindow[].source}} | {{outOfWindow[].dataType}} | {{outOfWindow[].content}} | {{outOfWindow[].sheet}} 第{{outOfWindow[].row}}行 |

> 以上记录不在本次归集窗口内，单列备查；如需纳入请调整 --before / --after 后重新归集。

## 六、待查材料清单

| 编号 | 建议调取的材料 | 用途 | 调取方式 |
|---|---|---|---|
| {{toInvestigate[].id}} | {{toInvestigate[].item}} | {{toInvestigate[].why}} | {{toInvestigate[].source}} |

> 以上为建议进一步收集的材料，供调查组参考；清单不构成对原因的任何指向。

## 七、原因分析

**{{analysis.note}}**

<!-- ANALYSIS_START -->
<!-- ANALYSIS_END -->

> 本节留空。{{meta.scopeNote}}。

> **硬约束：`ANALYSIS_START` 与 `ANALYSIS_END` 之间一个字都不能写。** 不得填入原因判断、倾向性意见或「供调查组参考的初步线索」。

## 八、责任分析

**{{analysis.note}}**

> 本节留空。责任分析由调查组按《中国石化设备事故管理规定》进行；本材料不涉及人员姓名与追责性内容。

## 九、损失情况

**{{analysis.lossNote}}**

| 项目 | 内容 |
|---|---|
| 直接经济损失 | （由调查组核定） |
| 停工 / 降量时间 | （由调查组核定） |
| 是否属非计划停工事件 | （按《炼化企业非计划停工管理规定》由公司设备管理部门认定） |
| 事故等级 | （按《中国石化设备事故管理规定》由调查组认定，本材料不判定） |

## 十、防范措施

**{{analysis.note}}**

> 本节留空。防范措施由调查组按「四不放过」原则（原因未查清不放过、责任人员未处理不放过、整改措施未落实不放过、有关人员未受到教育不放过）制定；本材料不提出措施，避免以措施暗示原因。

## 附一、检出的禁用表述（须改写后成文）

| 规则号 | 类别 | 所在位置 | 原文 | 字位 | 出处 | 建议改法 |
|---|---|---|---|---|---|---|
| {{causalHits[].ruleId}} | {{causalHits[].categoryCn}} | {{causalHits[].field}} | {{causalHits[].text}} | 第{{causalHits[].index}}+1字 | {{causalHits[].loc}} | {{causalHits[].suggest}} |

> 时间线只陈述记录中的事实；以上表述一律改写为客观时序陈述，脚本不自动删改记录原文。

## 附：数据提示

- {{warnings[]}}

---

{{meta.disclaimer}}。

{{meta.disclaimerGeneral}}
