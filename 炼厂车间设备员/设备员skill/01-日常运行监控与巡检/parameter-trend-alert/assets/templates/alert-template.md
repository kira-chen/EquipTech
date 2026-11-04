# {{meta.workshop}} 参数越限与劣化趋势预警（截至 {{meta.date}}）

回溯窗口：最近 {{meta.periods}} 期　｜　R² 下限：{{meta.r2Min}}　｜　到限关注窗口：{{meta.horizonDays}} 天
数据形态：{{meta.inputShape}}　｜　限值：{{meta.twoLevelLimits}}
生成时间：{{meta.generatedAt}}（北京时间）

> 占位符均为 `trends.json` 的键路径；表格占位 `{{table:<数组键>}}` 表示按该数组逐行填表（列见 scripts/trend.js 的对应节）。脚本本身不读本模板，产出以 trend.js 为准；本模板仅供用户要求调整版式时参照。

## 一、预警概览

| 指标 | 数值 |
|---|---|
| 参数序列数 | {{counts.series}} |
| 已越限 | {{counts.overLimit}} |
| 　其中越高高报/低低报（HH/LL） | {{counts.overHighHigh}} |
| 　其中越高报/低报（H/L） | {{counts.overHigh}} |
| 趋势恶化 | {{counts.deteriorating}} |
| 趋势稳定 | {{counts.stable}} |
| 数据不足（<3 期） | {{counts.insufficientData}} |
| 停运中（不判定） | {{counts.stopped}} |
| 数值无法解析的采集点 | {{counts.invalidPoints}} |
| 采集时间重复 | {{counts.duplicateTimes}} |

## 二、已越限

{{table:overLimit}}
（列：tag（pointTag）| name | param | unit | lastValue | lastTime | limitLevelText（停运设备后标「（停运中）/（疑似停运）」）| limitValue | exceedBy）

## 三、趋势恶化

{{table:deteriorating}}
（列：tag（pointTag）| name | param | unit | periodsUsed | lastValue | slope | changeRate | r2 | daysToLimit | etaLimitKind | etaDate | confidenceText）

> {{meta.statement}}

## 四、趋势稳定

{{table:stable}}
（列：tag（pointTag）| name | param | unit | periodsUsed | lastValue | slope | changeRate | r2 | confidenceText）

## 五、数据不足说明

{{table:insufficientData}}
（列：tag（pointTag）| name | param | periodsUsed | lastValue | lastTime | note）

### 停运中（不判定）

（仅 `stopped` 非空时出现）
{{table:stopped}}
（列：tag（pointTag）| name | param | unit | lastValue | lastTime | runState（停运中/疑似停运）| runStateBasis）

### 数据质量明细

{{table:items[].invalidPoints}}
{{table:items[].duplicateTimes}}

## 六、趋势研判与建议

（`counts.excludedStoppedPoints` > 0 时脚本在此写说明行：已剔除停机期 {{counts.excludedStoppedPoints}} 个点……）

<!-- ANALYSIS_START -->
（模型撰写 200~400 字）
<!-- ANALYSIS_END -->

---

> {{meta.statement}}
> {{meta.disclaimer}}

## 附：数据提示

{{warnings}}
