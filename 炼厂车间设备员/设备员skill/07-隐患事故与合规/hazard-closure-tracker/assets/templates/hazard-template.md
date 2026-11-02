# {{workshop}} 隐患整改闭环跟踪（截至 {{date}}）

{{!-- 开头提示由脚本直接写入，非占位符；存在重大隐患或超期未整改项时必须出现，不得删除或弱化 --}}
{{#alerts}}
> 【注意】**重点提示**
>
{{#each alerts}}> - {{this}}
{{/each}}
{{/alerts}}
{{^alerts}}
> 本期无重大隐患，亦无超期未整改项。
{{/alerts}}

统计范围：截至 {{meta.date}}{{#meta.from}}（自 {{meta.from}} 起，按发现日期）{{/meta.from}}{{#meta.levelFilter}} ｜ 等级筛选：{{meta.levelFilter}}{{/meta.levelFilter}}{{#meta.ownerFilter}} ｜ 责任人筛选：{{meta.ownerFilter}}{{/meta.ownerFilter}}
时限口径：{{meta.rulesSource}}（重大隐患：{{metrics.rules.major}}；一般隐患：{{metrics.rules.general}}）
数据来源：{{meta.input}} ｜ 生成时间：{{meta.generatedAt}}（北京时间）

**隐患认定、等级与整改验收以安全部门意见为准。** 本材料由脚本汇总、模型成文，仅供设备员复核参考，不替代审批、定性、验收与签字；厂内制度与系统数据为准。

## 一、总体概览

| 指标 | 数量 |
|---|---|
| 隐患总数 | {{counts.total}} |
| 重大隐患 | {{counts.major}} |
| 超期未整改 | {{counts.overdue}} |
| 临期（≤{{metrics.dueSoonDays}}天） | {{counts.dueSoon}} |
| 整改中（期限内） | {{counts.inProgress}} |
| 已整改已验收（闭环） | {{counts.closed}} |
| 已整改未验收 | {{counts.unverified}} |
| 未判定 | {{counts.undetermined}} |
| 状态与验收矛盾 | {{counts.conflicts}} |
| 五定不全（未闭环项） | {{counts.fiveFixedIncomplete}} |

闭环率：**{{metrics.closureRate}}**（已整改且已验收 {{counts.closed}} / 总数 {{counts.total}}）

平均闭环时长：**{{metrics.avgClosureDays}}**

## 二、重大隐患专列

{{table:majorHazards}}

## 三、超期未整改清单

{{table:overdue}}

## 四、临期清单

{{table:dueSoon}}

## 五、已整改未验收

_整改状态填报为「已整改」但台账无验收记录，**不计入已闭环**，须安排验收销号。_

{{table:unverified}}

## 六、未判定项

_判定所依赖的字段缺失，**未按最宽松时限处理**，须补齐后重新跟踪。_

{{table:undetermined}}

## 七、状态与验收矛盾

{{table:conflicts}}

## 八、五定不全

_未闭环项按「五定」（定整改方案、定资金、定责任人、定期限、定应急措施）逐项核对，缺哪项列哪项；**脚本不补填任何一项**，须由责任单位补齐后更新台账。_

{{table:fiveFixedIncomplete}}

## 九、闭环指标

**按等级分布**

{{table:metrics.byLevel}}

**按责任单位分布**

{{table:metrics.byUnit}}

**按来源分布**

{{table:metrics.bySource}}

**与上期对比**

{{table:trend}}

## 十、隐患整改情况说明

<!-- ANALYSIS_START -->
{{analysis}}
<!-- ANALYSIS_END -->

## 附：数据提示

{{warnings}}
