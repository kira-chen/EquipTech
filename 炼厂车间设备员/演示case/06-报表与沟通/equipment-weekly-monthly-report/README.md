# 设备周报月报（equipment-weekly-monthly-report）· 演示与回归样例

> 命令在技能目录 `设备员skill/06-报表与沟通/equipment-weekly-monthly-report/` 下运行，`$CASE` 指本技能的演示目录：`CASE=../../../演示case/06-报表与沟通/equipment-weekly-monthly-report`。

> 本目录仅开发包含有，发布包不含。由 `node scripts/make-sample.js` 再生。

## 示例问题 ↔ 附件对照表

| # | 示例问题 | 附件 | 运行参数 | 预期结果 |
|---|---|---|---|---|
| 1 | 出上周的设备周报，完好率、泄漏率、检修计划完成率都算一下 | `daily/`（5 份 daily.json）+ `sample-period-source-2026-09-14_2026-09-20.xlsx` | `--input $CASE/daily,$CASE/sample-period-source-2026-09-14_2026-09-20.xlsx --workshop 常减压车间 --period weekly --from 2026-09-14 --to 2026-09-20` | 完好率 90.0%（18/20 在用）、主要设备 85.7%（12/14）、备机 50.0%（2/4）、静密封 0.42‰、动密封 1.67‰、检修完成率 50.0%（大检修 0/2、日常维修 3/3、专项 0/1）、工单及时率 62.5%、故障 8 次 / 停机 8 次、非计划停工 1、特护 2 台；warning 列出缺 09-16、09-19，标注「基于 5 天数据（应为 7 天）」；十二节 |
| 2 | 设备台账还没给，先把故障和停机统计出来 | `sample-no-ledger.xlsx` | `--period weekly --from 2026-09-14 --to 2026-09-20` | 完好率 `null`，报告显示「—」并单列「因分母缺失未计算」，**不是 0%**；备机/泄漏率/停工写「未提供」 |
| 3 | 我们厂完好率口径跟你这个不一样，按我们的表算 | 主样例 + `sample-metrics-rules.xlsx` | 加 `--metrics $CASE/sample-metrics-rules.xlsx` | 设备完好率口径表带「分母=在册、剔除封存=否」结构化列 → 按在册算 90.0%，计算方式「厂内口径（结构化参数）」；检修计划完成率算法不一致且无结构化参数 → **显示「—」并标「需按厂内口径复算」**；工单及时率算法一致 → 62.5%；默认口径声明不再出现 |
| 4 | 这是 SAP 导出的技术对象、订单和通知单清单，列名是功能位置、系统状态那种 | `sample-sap-export.xlsx` | `--workshop 加氢车间 --period weekly --from 2026-09-14 --to 2026-09-20` | 在用 7 台（C-2601 封存剔除）完好 6 → 85.7%，A/B 6/6；订单应闭环 5（DLFL 不计）、按期 1、TECO 待验收 1；通知单新增 4、「已完成」归待验收、期末未闭环 3 |
| 5 | 跟上周比一下，哪些指标掉了 | 主样例 + 上期 `periodic.json` | 加 `--prev <上期 periodic.json>` | 环比小节覆盖 16 项指标，正值带 + 号；任一侧为 null 的指标变化显示「—」 |
| 6 | 出个月报，日期我给的是 8-22 到 9-20 | 主样例 | `--period weekly --from 2026-08-22 --to 2026-09-20` | warning「区间与周期不匹配」，不中断，由用户确认 |
| 7 | 只有日报 JSON，没有台账 | `daily/` | `--input $CASE/daily --period weekly --from 2026-09-14 --to 2026-09-20` | 缺陷与工单存量来自日报；特护设备来自日报 `special` 节（K-1601 异常 1/5 天）；完好率、计划完成率、及时率均因分母缺失为 null |

## MCP 取数对照

取数写法见 SKILL.md「数据获取（MCP）」；四个工具都填 workshop，工单和通知单不填 start_date，csv 放进同一个空目录。预期结果只列每天都稳定的剧本结论。

| # | 示例问题 | MCP 调用 | 运行参数 | 预期结果 |
|---|---|---|---|---|
| M1 | 常减压车间近 30 天设备月报，完好率只算本车间 | 设备资产管理 `get_equipment_ledger`（workshop=常减压车间）、`get_failure_history`（workshop=常减压车间，start_date=<30 天前>，for_skill=equipment-weekly-monthly-report）、`get_work_orders`、`get_notifications`（workshop=常减压车间，for_skill=equipment-weekly-monthly-report） | `--input <目录> --workshop 常减压车间 --period monthly --from <30 天前> --to <今天>` | 识别设备台账、故障记录、工单台账、缺陷台账；完好率分母 60 台（常减压车间在用），E-1201 台账为待修计不完好；故障记录含 E-1201；工单及时率分母含统计期前创建、要求完成日期在期内的工单；检修计划完成率分母缺失，备机完好率、密封点泄漏率、非计划停工、特护设备写「未提供」 |
| M2 | 加氢车间上周设备周报，不混入常减压车间 | 同 M1，workshop=加氢车间，`get_failure_history` 的 start_date=<7 天前> | `--input <目录> --workshop 加氢车间 --period weekly --from <7 天前> --to <今天>` | 完好率分母 29 台；故障与超期工单只有加氢车间位号 |
| M3 | 常减压车间本月与上月环比 | M1 的目录；上月另建目录，`get_failure_history` 的 start_date=<60 天前>，先跑 `--from <60 天前> --to <30 天前>` 得上月 periodic.json | M1 参数加 `--prev <上月 periodic.json>` | 环比 16 项；完好率两期都有值，环比节注明基准期完好率是上月报告生成时的台账快照（`compare.prev.snapshotNote`）；上月 periodic.json 的期末未闭环缺陷按发现时间、关闭日期回推到上月期末，上月期末之后发现的单列 `foundAfterTo`、不计入；备机完好率、密封点泄漏率等未提供的指标环比为「—」，不按 0 比 |

## 关键验证点

1. **缺失日期不外推**（案例 1）：区间 7 天只拿到 5 天，新增缺陷是 5 天实际累加，**不是日均 ×7**。
2. **完好率分母按在用、缺「在用」列为 null**（案例 2、4）：没有在用标识就算不出完好率；在册台数、上期台数、估计值都不能当分母。SAP 导出的「设备」是 8 位流水号，不是位号。
3. **口径表三种结果**（案例 3）：一致→照算、结构化→按结构化算、不一致且无结构化→不出数标复算。口径表不再只换文字。
4. **待验收不计闭环**（案例 4）：TECO / 「已完成」单列为待验收。
5. **泄漏率只给数值**：不与 0.5‰ / 2‰ 比对，考核线以厂内指标为准。
6. **非计划停工只计数**：是否构成事件按《炼化企业非计划停工管理规定》另行报送。
7. **未判定项不按默认**：检修计划「已完工但缺实际完成日期」既不算按期也不算延期。
8. **环比同比文件不存在直接报错**，不会悄悄跳过对比章节。

## 再生样例

```bash
node scripts/make-sample.js            # seed=1
node scripts/make-sample.js --seed 6   # 停机/修复时长、备件金额、特护参数变化，各项计数与比率不变
```
