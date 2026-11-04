# 车间设备日报（equipment-daily-report）· 演示与回归样例

> 本目录仅开发包含有，发布包不含。由 `node scripts/make-sample.js` 再生。

## 示例问题 ↔ 附件对照表

| # | 示例问题 | 附件 | 运行参数 | 预期结果 |
|---|---|---|---|---|
| 1 | 出今天的设备日报，早会要用，值班是乙班张工 | `sample-daily-source-2026-09-21.xlsx` | `--workshop 常减压车间 --date 2026-09-21 --shift 乙班张工` | 10 台设备（运行 5 / 备用 1 / 检修 1 / 停用 1 / 异常 2 / 未判定 0）、特护 1 台、3 新增缺陷、5 未闭环（1 待验收）、6 工单（2 超期、1 待验收）、4 作业票（用火 1）、泄漏点未修复 2 超期 1、隐患 3（重大 1、超期 1）、2 事件、3 检修项目；十节 |
| 2 | 今天只有巡检数据，工单和检修进度还没汇总，先出一份 | `sample-inspection-only.xlsx` | `--workshop 加氢车间 --date 2026-09-21` | 其余各节写「本日未提供 XX 数据」，counts 为 null 不是 0 |
| 3 | 把巡检汇总、缺陷登记、工单跟踪、泄漏点、隐患五个技能的结果合成日报 | `upstream/status.json,upstream/orders.json,upstream/defects.json,upstream/leaks.json,upstream/hazard.json` | `--input <五个 JSON 逗号分隔> --workshop 常减压车间 --date 2026-09-21` | 自动识别五类 JSON，来源标注带 (JSON)；备用/检修/停用写「—（未提供）」并 warning |
| 4 | 这是 SAP 导出的工单和通知单清单，列名是功能位置、订单、系统状态那种，能直接出日报吗 | `sample-sap-export.xlsx` | `--workshop 加氢车间 --date 2026-09-21` | 功能位置→位号、设备描述→设备名称、REL/TECO/CLSD/CRTD 归六态；TECO 待验收 1、超期 2；OSNO 通知单未闭环 |
| 5 | 跟昨天对比一下，异常和超期是多了还是少了 | 主样例 + 前一日 daily.json | 加 `--prev <上一日 daily.json>` | 第九节环比，正值带 + 号，共十一节 |
| 6 | 检修进度表里完成比例填得乱七八糟，有 150% 有负数，能处理吗 | `sample-bad-percent.xlsx` | `--workshop 测试车间 --date 2026-09-21` | 0.6→60%；150、-10、「快好了」均为 null 显示「—」并 warning |

## MCP 取数对照

取数写法见 SKILL.md「数据获取（MCP）」；同一车间的四个 csv 放进同一个空目录（目录 A）。预期结果只列每天都稳定的剧本结论。

| # | 示例问题 | MCP 调用 | 运行参数 | 预期结果 |
|---|---|---|---|---|
| M1 | 常减压车间今天的设备日报，缺陷、工单、隐患、作业票从系统取 | 设备资产管理 `get_notifications`、`get_work_orders`（workshop=常减压车间，for_skill=equipment-daily-report）；HSE管理平台 `get_hazards`（workshop=常减压车间）；作业票系统 `get_permits`（workshop=常减压车间，date=今天）→ 目录 A | `--input <目录 A> --workshop 常减压车间 --date <今天>` | 识别缺陷台账、工单台账、作业票（作业清单）、隐患台账四类来源，无 warning；未闭环缺陷含 E-1201（B 级）；E-1201 工单施工中、不超期；当日作业票含 E-1201 盲板抽堵、用火（一级）、吊装（三级）；隐患按整改状态与要求整改期限判定，未判定 0；设备状态、特护设备写「本日未提供」 |
| M2 | 带上今天巡检汇总，特护机组单列，写 P-2101A 振动 | 先跑 inspection-data-digest：点检巡检App `get_inspection_records`（workshop=常减压车间，for_skill=inspection-data-digest）→ 目录 B，设备资产管理 `get_equipment_ledger`（workshop=常减压车间，for_skill=inspection-task-dispatch）→ 目录 C，`digest.js --input <B> --ledger <C>` 得 status.json；再加 M1 的目录 A | `--input <status.json>,<目录 A> --workshop 常减压车间 --date <今天>` | 六档取 status.json 的 `counts.sixTier`，不再出现「三档」warning；特护设备一节按 status.json 的特护标记逐台列出（含 C-3101A 富气压缩机）；P-2101A 在异常设备清单中（振动报警）；其余同 M1 |
| M3 | 加氢车间日报，不混入常减压车间单据 | 同 M1，workshop=加氢车间 | `--input <目录 A> --workshop 加氢车间 --date <今天>` | 缺陷、工单清单只有加氢车间位号（无 E-1201、FV-2101、V-1101 等常减压位号）；当日作业票不含 E-1201 |

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
node scripts/make-sample.js            # seed=1
node scripts/make-sample.js --seed 6   # 检修完成比例与特护参数变化，各项计数不变
```
