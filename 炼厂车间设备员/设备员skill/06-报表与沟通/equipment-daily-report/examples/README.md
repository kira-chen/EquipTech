# examples 回归测试数据

> 本目录仅开发包含有，发布包不含。由 `node scripts/make-sample.js --out examples` 再生。

## 示例问题 ↔ 附件对照表

| # | 示例问题 | 附件 | 运行参数 | 预期结果 |
|---|---|---|---|---|
| 1 | 出今天的设备日报，早会要用，值班是乙班张工 | `sample-daily-source-2026-09-21.xlsx` | `--workshop 常减压车间 --date 2026-09-21 --shift 乙班张工` | 10 台设备（运行 5 / 备用 1 / 检修 1 / 停用 1 / 异常 2 / 未判定 0）、特护 1 台、3 新增缺陷、5 未闭环（1 待验收）、6 工单（2 超期、1 待验收）、4 作业票（用火 1）、泄漏点未修复 2 超期 1、隐患 3（重大 1、超期 1）、2 事件、3 检修项目；十节 |
| 2 | 今天只有巡检数据，工单和检修进度还没汇总，先出一份 | `sample-inspection-only.xlsx` | `--workshop 加氢车间 --date 2026-09-21` | 其余各节写「本日未提供 XX 数据」，counts 为 null 不是 0 |
| 3 | 把巡检汇总、缺陷登记、工单跟踪、泄漏点、隐患五个技能的结果合成日报 | `upstream/status.json,upstream/orders.json,upstream/defects.json,upstream/leaks.json,upstream/hazard.json` | `--input <五个 JSON 逗号分隔> --workshop 常减压车间 --date 2026-09-21` | 自动识别五类 JSON，来源标注带 (JSON)；备用/检修/停用写「—（未提供）」并 warning |
| 4 | 这是 SAP 导出的工单和通知单清单，列名是功能位置、订单、系统状态那种，能直接出日报吗 | `sample-sap-export.xlsx` | `--workshop 加氢车间 --date 2026-09-21` | 功能位置→位号、设备描述→设备名称、REL/TECO/CLSD/CRTD 归六态；TECO 待验收 1、超期 2；OSNO 通知单未闭环 |
| 5 | 跟昨天对比一下，异常和超期是多了还是少了 | 主样例 + 前一日 daily.json | 加 `--prev <上一日 daily.json>` | 第九节环比，正值带 + 号，共十一节 |
| 6 | 检修进度表里完成比例填得乱七八糟，有 150% 有负数，能处理吗 | `sample-bad-percent.xlsx` | `--workshop 测试车间 --date 2026-09-21` | 0.6→60%；150、-10、「快好了」均为 null 显示「—」并 warning |

## 关键验证点

1. **缺数据不补零**：案例 2 是本技能最关键的行为。「本日未提供工单数据」与「本日无超期工单」意思完全不同。
2. **六档状态**：案例 1 的巡检汇总同时含「运行 / 正常 / 无异常 / 备用 / 检修 / 停用 / 异常」写法，脚本归入六档，不再只分正常/异常。
3. **待验收单列**：「已完成」通知单与 TECO 工单单列待验收，不计闭环。
4. **上游 JSON 自动识别**：案例 3 验证与五个上游技能的链式对接；`upstream/` 内的 JSON 按各技能产出的特征字段裁剪。
5. **SAP 列名**：案例 4 验证共享别名表；「设备编号」不是位号。
6. **术语**：作业票「动火」显示为「用火」；隐患「A/B/C 级」不映射。
7. **次日计划不代拟**：不传 `--plan` 时报告明确写「由车间填写，本技能不代为拟定」。

## 再生样例

```bash
node scripts/make-sample.js --out examples            # seed=1
node scripts/make-sample.js --out examples --seed 6   # 检修完成比例与特护参数变化，各项计数不变
```
