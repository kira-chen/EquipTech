# 现场作业监督要点与检查表

生成时间：{{generatedAt}}（北京时间）

> 本要点为辅助提示，不替代作业票规定的安全措施与监护人现场职责；发现异常应立即停止作业并按应急程序处置

## 一、作业信息

| 项目 | 内容 |
|---|---|
| 作业类型（填报） | {{meta.workTypeInput}} |
| 识别作业类型 | {{meta.typesCn}} |
| 未覆盖类型 | {{meta.unknownTypes}} |
| 作业内容 | {{meta.scope}} |
| 位号/区域 | {{meta.location}} |
| 作业单位 | {{meta.unit}} |
| 介质 | {{meta.medium}} |
| 介质危险特性 | {{meta.hazardsCn}} |
| 环境条件 | {{meta.env}} |
| 作业人数 | {{meta.headcount}} |
| 预计时长 | {{meta.durationHours}} |
| 作业起止 | {{meta.startAt}} ～ {{meta.endAt}} |
| 作业票 | {{meta.permit}} |
| 作业票级别（填报） | {{meta.permitLevel.cn}} |
| **风险等级（频次口径）** | **{{risk.levelCn}}** |

判定依据：

{{#risk.reasons}}- {{.}}
{{/risk.reasons}}

## 二、监督要点清单

{{#genericOnly}}
> 填报的作业类型不在本技能覆盖范围，以下**仅为通用监督框架**，具体安全技术要点「待安全专业补充」，不得凭通用安全知识自行补充。
{{/genericOnly}}

{{#moments}}
### {{momentCn}}（{{count}} 项）

| 序号 | 监督要点 | 来源作业类型 | 检查方式 | 责任岗位 | 规则号 |
|---|---|---|---|---|---|
{{#points}}| {{seq}} | {{text}} | {{typeCn}} | {{methodCn}} | {{owner}} | {{id}} |
{{/points}}
{{/moments}}

## 三、检查频次建议

| 项目 | 建议 |
|---|---|
| 风险等级 | {{frequency.levelCn}} |
| 现场巡查 | {{frequency.patrol}} |
| 旁站要求 | {{frequency.standby}} |
| 气体检测 | {{frequency.gasTest}} |
| 记录要求 | {{frequency.record}} |
| 作业票级别口径 | {{frequency.levelNote}} |
| 预计巡查轮次 | {{frequency.estimatedRounds}} |

> 【注意】{{frequency.source}}。

## 四、关键时点提示

| 检查时点 | 要点数 | 提示 |
|---|---|---|
{{#keyMoments}}| {{momentCn}} | {{count}} | {{note}} |
{{/keyMoments}}

## 五、组合加严项

{{table:escalated}}

## 六、现场检查记录表（空白，现场填写）

> 以下记录表由现场检查人填写，脚本不预填任何检查结果。

| 序号 | 检查时点 | 监督要点 | 来源作业类型 | 检查方式 | 责任岗位 | 检查时间 | 检查结果 | 检查人签字 |
|---|---|---|---|---|---|---|---|---|
{{#checkSheet.rows}}| {{seq}} | {{momentCn}} | {{text}} | {{typeCn}} | {{methodCn}} | {{owner}} |   |   |   |
{{/checkSheet.rows}}

## 七、异常处置提示

1. 发现任一要点不符合，立即要求作业单位停止作业，整改合格后方可复工。
2. 涉及气体分析不合格、人员不适、设备泄漏、火情的，按厂应急程序处置并上报值班领导。
3. 作业票有效期届满或作业条件发生变化，须重新办票，不得口头延续。
4. 处置过程与结果记入检查记录表，作为承包商表现记录（contractor-performance-log）的原始依据。

> 本要点仅覆盖厂内制度与作业票通常规定的监督事项，不含超出作业票规定的额外安全措施；需要额外措施时由安全专业评估后写入作业票。

## 八、现场情况说明

<!-- ANALYSIS_START -->
（此处由模型结合现场实际补充说明：本次作业的监督重点、需要特别关注的部位与时段、与同区域其他作业的协调安排。不得在此新增安全技术要点。）
<!-- ANALYSIS_END -->

## 附：数据提示

{{warnings}}

---

本要点为辅助提示，不替代作业票规定的安全措施与监护人现场职责；发现异常应立即停止作业并按应急程序处置
