# {{owner}} 待办清单（{{date}}）

前瞻期：{{horizon}} 天 ｜ 生成时间：{{generatedAt}}（北京时间）

汇集来源（共 {{counts.sources}} 项）：{{sources}}

> {{statement}}

## 一、待办概况

| 指标 | 数量 |
|---|---|
| 待办合计 | {{counts.total}} |
| 已逾期 | {{counts.overdue}} |
| 今日到期 | {{counts.today}} |
| 前瞻期内（{{horizon}} 天） | {{counts.upcoming}} |
| 前瞻期外 | {{counts.later}} |
| 无到期日 | {{counts.noDueDate}} |
| 结转项 | {{counts.carriedOver}} |
| 疑似重复 | {{counts.possibleDuplicate}} |
| P1 最高 | {{counts.byPriority.P1}} |
| P2 高 | {{counts.byPriority.P2}} |
| P3 中 | {{counts.byPriority.P3}} |
| P4 低 | {{counts.byPriority.P4}} |

## 二、已逾期

{{table:overdue}}

## 三、今日到期

{{table:today}}

## 四、近期（{{horizon}} 天内）

{{table:upcoming}}

## 五、无到期日

_以下事项来源数据未提供到期日，脚本未自行设定，请设备员确认期限后补填。_

{{table:noDueDate}}

## 六、结转项

_结转项保留原始到期日与原始来源，脚本不自动延期。_

{{table:carriedOver}}

## 七、按来源分类

{{table:byCategory}}

## 八、疑似重复（需确认，未自动合并）

{{possibleDuplicate}}

## 九、前瞻期外（{{horizon}} 天以后）

{{table:later}}

## 附：数据提示

{{warnings}}

---

# {{owner}} 工作日志（{{date}}）

生成时间：{{generatedAt}}（北京时间）

> {{statement}}

## 一、今日完成事项

{{done}}

## 二、待办概况

{{table:summaryCounts}}

逾期与今日到期事项：

{{table:overdueAndToday}}

## 三、需协调事项

<!-- ANALYSIS_START -->
{{coordination}}
<!-- ANALYSIS_END -->

## 四、明日重点

按脚本排序，明日应优先处理的前若干项：

{{table:tomorrow}}

<!-- ANALYSIS_START -->
{{tomorrowNotes}}
<!-- ANALYSIS_END -->

## 附：数据提示

{{warnings}}
