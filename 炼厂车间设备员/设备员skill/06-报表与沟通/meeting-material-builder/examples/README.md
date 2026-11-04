# examples 回归测试数据

> 本目录仅开发包含有，发布包不含。由 `node scripts/make-sample.js --out examples` 再生。

## 示例问题 ↔ 附件对照表

| # | 示例问题 | 附件 | 运行参数 | 预期结果 |
|---|---|---|---|---|
| 1 | 车间例会 15 分钟，把巡检和工单情况讲一下 | `sample-status.json` + `sample-orders.json` | `--meeting 车间设备例会 --duration 15 --audience 车间` | 六节稿件，保留位号；主要工作 4.5 分钟 |
| 2 | 同样的数据，给公司领导汇报 8 分钟 | 同上 | `--duration 8 --audience 公司 --audience-spec "公司设备管理部门（机动部）"` | 问题节去位号保设备名；需决策 2.4 分钟；听众显示「公司（公司设备管理部门（机动部））」 |
| 3 | 把隐患情况也带上 | 上 + `sample-hazard.json` | 加入该 JSON | 重大隐患 2 条进问题项；隐患总数 12、重大隐患 2、超期未整改 3、闭环率 25%（读 `metrics.closureRate`）进关键指标 |
| 4 | 议题里有「能耗管理」，但我没有能耗数据 | 主样例 | 加 `--topics "工单,能耗管理"` | 能耗管理列入「无数据支撑的议题」，写「需补充」，**不编造** |
| 5 | 这个 JSON 是别的系统导出的，能用吗 | `sample-unknown.json` | 与主样例一起传 | warning 提示无法识别并忽略，不中断 |
| 6 | 把周报的指标组织成分厂设备月会的材料，别重算 | `sample-periodic.json` + `sample-hazard.json` | `--meeting 分厂设备月会 --duration 10 --audience 分厂 --audience-spec 炼油一部设备科` | 指标键映射为中文（设备完好率 90%、静密封点泄漏率 0.42‰……）；检修计划完成率（含大检修、日常维修分列）不进关键指标，「检修计划完成率 需按厂内口径复算，本期未出数」进问题项；重大隐患进问题项 |
| 7 | 材料要外发，位号都去掉；关键指标多讲点 | 主样例 | 加 `--hide-tags --weights "开场:0.05,关键指标:0.4,主要工作:0.15,存在问题:0.2,需决策:0.15,下步打算:0.05"` | 车间层级也去位号保设备名；时间分配按用户权重，提纲标「用户指定」 |
| 8 | 要做成 PPT | 任一 | — | `outline.json` 的 `slides` 数组交 pptx 技能转换，不手写 XML |

## MCP 取数对照

本技能读上游技能 JSON，不直接调 MCP。上游按各自 SKILL.md「数据获取（MCP）」取数，且每个工具都填 workshop=常减压车间。预期结果只列每天都稳定的剧本结论。

| # | 示例问题 | MCP 调用 | 运行参数 | 预期结果 |
|---|---|---|---|---|
| M1 | 车间例会 15 分钟：巡检、工单、隐患 | inspection-data-digest（点检巡检App `get_inspection_records` for_skill=inspection-data-digest + 设备资产管理 `get_equipment_ledger` for_skill=inspection-task-dispatch）→ status.json；work-order-tracker（设备资产管理 `get_work_orders`）→ orders.json；hazard-closure-tracker（HSE管理平台 `get_hazards`）→ hazard.json | `--input <status.json>,<orders.json>,<hazard.json> --meeting 车间设备例会 --duration 15 --audience 车间 --workshop 常减压车间` | 3 个来源；存在问题含 P-2101A 振动报警、E-1201；超期工单数、隐患总数、异常设备数与上游 JSON 一致；未闭环重大隐患逐条进存在问题 |
| M2 | 公司级 8 分钟，去位号，请领导定 P-2101A 是否提前检修 | 同 M1 | `--audience 公司 --duration 8 --need-decision "P-2101A 进料泵是否提前安排检修"` | 存在问题一节无位号、工单号；如有超期工单，去位号后保留设备名称和故障描述；需决策 1 项、2.4 分钟，需决策节同样去位号，写「进料泵是否提前安排检修」，不出现 P-2101A |
| M3 | 近 30 天月报 + 隐患组织分厂月会 | equipment-weekly-monthly-report（设备资产管理四个工具，见其 SKILL.md）→ periodic.json；hazard-closure-tracker → hazard.json | `--input <periodic.json>,<hazard.json> --meeting 分厂设备月会 --duration 10 --audience 分厂 --workshop 常减压车间` | 设备完好率、工单及时率与 periodic.json 一致；未提供检修计划，检修计划完成率不进关键指标 |

## 关键验证点

1. **数字不美化**：所有指标带来源文件名，报告固定声明「未做任何新增、修改或美化」。对着领导念一个编出来的数，下次对不上就是事故。
2. **听众层级是实质差异**：案例 1 与 2 用同一份数据，产出的详略、位号、时间分配都不同。公司层级 8 分钟里近三分之一要讲需要他定的事。层级只认 车间 / 分厂 / 公司 三档，厂内名称用 `--audience-spec`。
3. **去位号不等于去信息**：公司层级（或 `--hide-tags`）保留「回流泵B」，只去掉「P-1101B」。写成「相关设备」等于什么都没说。
3a. **不重算周报指标**：案例 6 的指标全部原样引自 `periodic.json`，需复算的写「未计算」。
4. **议题无数据不编造**：案例 4 是本技能的底线。说「数据还没到，下次补」是专业的，编一个数说出去不是。
5. **不代拟主要工作与下步打算**：这两处技能看不到实情，留占位符由汇报人填。

## 再生样例

```bash
node scripts/make-sample.js --out examples            # seed=1
node scripts/make-sample.js --out examples --seed 6   # 数值变化，设备数与超期数等结论不变
```
