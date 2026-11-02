# 故障案例检索结果

> **{{meta.disclaimer}}**
> {{meta.disclaimerGeneral}}

检索条件：现象「{{meta.query.symptom}}」｜设备类型「{{meta.query.equipType}}」{{#meta.query.part}}｜故障部位「{{meta.query.part}}」{{/meta.query.part}}{{#meta.query.model}}｜型号「{{meta.query.model}}」{{/meta.query.model}}
案例库：{{meta.casesFile}}（可检索案例 {{counts.casesTotal}} 条）｜相似度下限 {{meta.minScore}}｜返回上限 {{meta.top}} 条
生成时间：{{meta.generatedAt}}（北京时间）

## 一、检索概览

| 指标 | 数量 |
|---|---|
| 案例库可检索案例 | {{counts.casesTotal}} |
| 现象为空已跳过 | {{counts.casesSkipped}} |
| 达到相似度下限 | {{counts.aboveMin}} |
| 本次返回命中 | {{counts.matches}} |
| 低于下限（单列，相似度较低，仅供参考） | {{counts.belowMinTotal}} |
| 最高相似度 | {{counts.topScore}} |

本次生效权重：现象文本 {{meta.weights.text}}｜设备类型 {{meta.weights.type}}｜故障部位 {{meta.weights.part}}

## 二、命中案例

{{^matches}}
**{{meta.emptyText}}**

案例库共 {{counts.casesTotal}} 条可检索案例，按相似度下限 {{meta.minScore}} 无一条达到标准（最高 {{counts.topScore}}）。**不降低标准返回不相关案例，也不以通用知识补充。**
{{/matches}}
{{#matches}}
### {{caseNo}}　相似度 {{score}}

| 项目 | 内容 |
|---|---|
| 设备 | {{equipName}} / {{tag}} / {{model}} |
| 设备编号 | {{equipNo}} |
| 设备类型 | {{equipType}} |
| 故障部位 | {{part}} |
| 故障代码 | {{code}} |
| 发生时间 | {{time}} |
| 工况 | {{condition}} |
| 现象描述 | {{symptom}} |
| 当时判定原因 | {{cause}} |
| 处置方式 | {{action}} |
| 效果 | {{effect}} |
| 案例来源 | {{source}} |
| 出处 | {{origin}} |

**匹配依据**：{{#matchBasis}}{{.}}；{{/matchBasis}}

**不同点**：{{#differences}}{{.}}；{{/differences}}

{{/matches}}

## 三、低相似度案例（仅供参考）

{{^lowSimilarity}}
_无_
{{/lowSimilarity}}
{{#lowSimilarity}}
| {{caseNo}} | {{score}} | {{equipType}} | {{part}} | {{symptom}} | {{note}} |
{{/lowSimilarity}}

以上案例相似度低于下限，**相似度较低，仅供参考，不得作为主要参考**。

## 四、检索结果解读

<!-- ANALYSIS_START -->
（200~400 字，结构：命中情况与相似度水平 → 逐条案例的可参考之处与不同点 → 与当前故障的关键差异 → 下一步建议。数字一律引用 cases.json，不得新增案例库以外的案例。）
<!-- ANALYSIS_END -->

## 五、使用说明

- {{meta.disclaimer}}
- {{meta.disclaimerGeneral}}
- 本结果是现象文本与设备类型、故障部位字段的机械匹配，不是失效机理分析。
- 当前故障的原因初判请接 `01-日常运行监控与巡检/anomaly-triage-advisor`，本技能不做原因判定。
- 案例仅来自所提供的案例库，未引用任何库外经验。

{{#warnings.length}}
## 附：数据提示

{{#warnings}}
- {{.}}
{{/warnings}}
{{/warnings.length}}
