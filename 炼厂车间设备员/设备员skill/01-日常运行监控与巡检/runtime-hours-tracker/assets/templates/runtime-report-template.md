<!-- 版式参考。占位符与 runtime.json 的键同名（meta.*、counts.*、表格取自同名数组）；脚本不读取本模板，直接按此版式生成 runtime-report.md。 -->
# {{meta.workshop}} 运行小时与启停次数统计（截至 {{meta.date}}）

统计区间：{{meta.from}} ~ {{meta.date}}　｜　预警比例：{{meta.warnRatio}}
生成时间：{{meta.generatedAt}}（北京时间）

## 一、统计概览

{{table:counts}}

【注意】{{counts.periodOnly}} 台设备无期初累计小时、无上期 JSON，"累计运行"仅为本期增量，不代表自上次大检修以来的累计。

## 二、逐台累计明细

{{table:byEquipment}}

## 三、已超阈值

{{table:exceeded}}

## 四、接近阈值

{{table:dueSoon}}

## 五、未判定项

{{table:undetermined}}

## 六、数据缺口说明

{{table:incomplete}}

## 七、统计说明

<!-- ANALYSIS_START -->
（模型撰写 200~350 字）
<!-- ANALYSIS_END -->

---

> {{meta.statement}}
> {{meta.disclaimer}}

## 附：数据提示

{{list:warnings}}
