# {{meta.workshop}} {{meta.period}} 月度检修计划申报（检修需求汇总）

> {{meta.disclaimer}}
> {{meta.declaration}}。

数据来源：{{meta.sources}}
上报周期：{{meta.period}}{{#meta.due}} ｜ 上报截止：{{meta.due}}{{/meta.due}}{{#meta.window}} ｜ 停机窗口：{{meta.window}}{{/meta.window}} ｜ 申报对象：{{meta.reportTo}}
周期性检修项：{{cyclicText}}　备件库存表：{{spareText}}
生成时间：{{meta.generatedAt}}（北京时间）

## 一、汇总概览

| 指标 | 数量 |
|---|---|
| 正式清单需求条数 | {{counts.demands}} |
| 　未闭环缺陷/通知单 | {{counts.bySource.未闭环缺陷}} |
| 　未闭环工单 | {{counts.bySource.未闭环工单}} |
| 　周期性检修项 | {{counts.bySource.周期性检修项}} |
| 　隐患整改项 | {{counts.bySource.隐患整改项}} |
| 需停机项 | {{counts.needShutdown}} |
| 停机与否未填 | {{counts.shutdownUnknown}} |
| 备件缺口项 | {{counts.spareGap}} |
| 　其中备件未核实/未判定 | {{counts.spareUnverified}} |
| 疑似重复（待确认） | {{counts.possibleDuplicate}} |
| 未判定项（优先级/数量/状态/停工） | {{counts.undetermined}} |
| 已完工待验收（本期不重复申报） | {{counts.skippedDone}} |
| 无依据项（未进正式清单） | {{counts.noBasis}} |

{{table:byPriority}}

{{table:byCategory}}

净需求：正式清单 {{netDemand.total}} 条；若 {{netDemand.possibleDuplicatePairs}} 组疑似重复经确认全部合并，则为 {{netDemand.netIfAllMerged}} 条。{{netDemand.note}}。

【注意】检修类别按 装置大检修（停工检修）/ 日常维修 / 抢修 / 专项 口径由来源与工单类型推定，为建议值；工单类型编码 PM01/PM02/PM03 为常见口径，厂内可配置。

{{#netDemand.windowConflict}}停机窗口核对：{{netDemand.windowConflict.note}}{{conflictMark}}{{/netDemand.windowConflict}}

## 二、需求明细

{{table:demands}}

### 申报理由

{{table:reasons}}

## 三、需停机项

{{table:needShutdown}}

{{#shutdownUnknown}}
**「是否需停机」未填项**（未按需停机或不需停机默认）：

{{table:shutdownUnknown}}
{{/shutdownUnknown}}

## 四、备件缺口

{{#noSpareTable}}【注意】未提供备件库存表（--spare），下列项目的备件到位情况一律为「未核实」，不得按有库存处理。{{/noSpareTable}}

{{table:spareGap}}

## 五、疑似重复待确认

{{duplicates}}

## 六、未判定项

{{table:undetermined}}

【未判定】以上字段未按默认值填充：工单/周期项无等级不按「高/中」默认，备件需求数量未填不按 1 件默认，状态无法判断是否闭环的记录未纳入正式清单，「是否需停机」未填不按两端默认。请车间核实后补填重新汇总。

## 七、建议核实区（无依据，未进正式清单）

{{table:noBasis}}

{{#template}}
## 八、上报模板列名核对

{{table:templateColumns}}

【注意】无法匹配的列：{{template.unmatched}}。这些列在「检修需求表.xlsx」中留空，请人工确认填写口径后补填。
{{/template}}

## {{lastSectionNo}}、汇总说明

<!-- ANALYSIS_START -->
（由模型依据 references/rollup-rules.md 口径撰写 200~400 字，结构：
 一、本期需求总数与来源构成 —— 总数、四类来源各多少、检修类别分布、无依据项与未判定项多少
 二、需停机项与停机窗口衔接 —— 需停机几项、合计工期、与窗口是否冲突；未填停机与否的项点名
 三、备件缺口与到货跟催 —— 区分「已核实不足」「未核实」「未判定」，点名需跟催的型号
 四、与上期遗留项的衔接及需公司设备管理部门（机动部/设备部）协调事项
 数量一律引用 demands.json，申报理由须引用来源记录原文要点，不得夸大紧急程度。）
<!-- ANALYSIS_END -->

## 附：数据提示

{{warnings}}

> {{meta.declaration}}。
