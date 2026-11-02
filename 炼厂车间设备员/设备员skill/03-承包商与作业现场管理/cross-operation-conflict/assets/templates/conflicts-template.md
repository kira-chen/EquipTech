# {{workshop}} 交叉作业冲突检测（{{date}}）

作业清单：{{inputFile}}　｜　时段重叠判定：{{windowText}}
判定口径：{{rulesSource}}{{#radius}}　｜　相邻区域口径：{{radius}}{{/radius}}
生成时间：{{generatedAt}}（北京时间）

> 本检测为辅助排查，交叉作业的最终安排与许可由安全环保部门按厂内制度决定；未列出的冲突不代表不存在。

## 一、检测概览

| 指标 | 数量 |
|---|---|
| 检测作业数 | {{counts.works}} |
| 空间冲突组 | {{counts.spatial}} |
| 风险冲突组 | {{counts.risk}} |
| 资源冲突组 | {{counts.resource}} |
| 　其中高严重度 | {{counts.high}} |
| 　其中中严重度 | {{counts.medium}} |
| 　其中低严重度 | {{counts.low}} |
| 无法判定项 | {{counts.undetermined}} |
| 提示项（同位号双票作业，不计冲突） | {{counts.advisory}} |
| 同时段最大并行作业数 | {{counts.maxConcurrent}} |

作业清单：

{{table:works}}

## 二、空间冲突

{{table:spatialConflicts}}

## 三、风险冲突

{{table:riskConflicts}}

**提示项（同位号受限空间 + 用火双票作业，合法常态，不计冲突）**

{{table:advisories}}

## 四、资源冲突

{{table:resourceConflicts}}

## 五、无法判定项

{{table:undetermined}}

## 六、时段重叠视图

{{table:timeline}}

并行时段分布：

{{table:segments}}

## 七、冲突分析与协调建议

<!-- ANALYSIS_START -->
{{analysis}}
<!-- ANALYSIS_END -->

## 附一、已跳过的作业

{{table:skipped}}

## 附二、数据提示

{{warnings}}

---

> 本检测为辅助排查，交叉作业的最终安排与许可由安全环保部门按厂内制度决定；未列出的冲突不代表不存在。
