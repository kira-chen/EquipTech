# 设备缺陷登记与分级（defect-intake-grading）· 演示与回归样例

> 本目录仅开发包含有，发布包不含。由 `node scripts/make-sample.js` 再生。

## 示例问题 ↔ 附件对照表

| # | 示例问题 | 附件 | 运行参数 | 预期结果 |
|---|---|---|---|---|
| 1 | 这几条缺陷帮我登记一下，定个级 | `sample-defects-2026-09-21.xlsx` | `--input <附件> --workshop 加氢车间` | 6 条；A 级 2、B 级 1、C 级 2、未判定 1；通知单草稿 5 条 |
| 2 | 登记的时候对一下设备台账，介质我没填全，顺便把 SAP 设备编号补上 | 上 + `sample-equip-ledger.xlsx`（SAP 技术对象列名：功能位置/设备/设备描述） | 加 `--equip-ledger` | P-2103A 从台账补出液化气与设备编号 10002103；补全后仍因「是否影响运行」为空判未判定 |
| 3 | 查一下有没有跟以前通知单重复的缺陷 | 上 + `sample-defect-ledger.xlsx`（SAP 通知单列名：通知单/功能位置/通知单短文本/系统状态） | 加 `--ledger` | 1 条疑似重复（P-2101A 与通知单 10234501，NOPR，相似度约 0.77）；10234502 为 NOCO 不参与 |
| 4 | 单独登记一条：P-101A 机封滴漏，液化气，不影响运行，给我通知单草稿 | 无附件 | `--desc "机封处持续滴漏约5滴/分" --tag P-101A --medium 液化气 --affects-run 否 --found-at "2026-09-21 08:20"` | A 级，规则 R2，时限 1 天；通知单 M2、优先级 1 |
| 5 | 这是 SAP 通知单导出，帮我按 A/B/C 定级 | `sample-sap-notification-export.xlsx` | `--input <附件>` | 4 条；A 1（PSV-2503 液化气内漏）、B 1（含硫污水泄漏）、C 1（EM-2502 电机异响，归电气）、未判定 1 |
| 6 | 这批缺陷介质栏是空的，能定级吗 | `sample-no-medium.xlsx` | `--input <附件>` | 2 条均未判定、通知单草稿 0 条：P-3101 泄漏类缺介质（U2）；P-3102 振动类不需要介质，但「是否影响运行」为空（U1） |

## 关键验证点

1. **未判定不默认**：`sample-defects` 中 P-2103A 的「是否影响运行」为空，即使介质是高危的液化气，也判未判定（规则 U1），不按 A 级从严、也不按 C 级从宽，且不进入通知单草稿。
2. **介质不在库不按低危**：`sample-no-medium` 中介质为空的泄漏缺陷判未判定（规则 U2）；`sample-sap-notification-export` 中含硫污水按中危（B 级），不按"水"归低危。
3. **SAP 列名直读**：功能位置→位号、设备→设备编号（不当位号）、设备描述→设备名称、通知单短文本→缺陷描述、对象部件→缺陷部位、故障停机→是否影响运行、通知日期→发现时间、报告人→发现人。
4. **查重按 SAP 状态**：NOPR/OSNO 参与查重，NOCO 不参与；疑似重复项仍正常登记并分配登记号，只是列入待确认清单。
5. **专业归口顺序**：EM-2502 电机归电气（不被"泵"抢成动设备）；PSV- 安全阀归静设备。
6. **定级可追溯**：每条缺陷的定级依据都带规则号（R1~R9、U1~U2），可对照 `references/grading-rules.md` 复核；`--grading-scheme iv` 可切回旧四级看历史台账。

## 再生样例

```bash
node scripts/make-sample.js            # seed=1
node scripts/make-sample.js --seed 9   # 滴漏滴数、发现人变化，等级分布不变
```

## MCP 取数对照

不上传附件；按 SKILL.md「数据获取（MCP）」取数，csv 按原文件名放进各自目录。预期结果只写每天稳定的结论。

| # | 示例问题 | MCP 调用 | 运行参数 | 预期结果 |
|---|---|---|---|---|
| M1 | P-2101A 驱动端振动变大、轴承箱异响，不影响生产，登记定级并查重 | 设备资产管理 `get_equipment_ledger`（tag=P-2101A）→ 目录 B；`get_notifications`（tag=P-2101A，open_only=true）→ 目录 C | `--desc "P-2101A 进料泵驱动端振动明显变大，轴承箱有异响，暂不影响生产" --tag P-2101A --affects-run 否 --found-at "<今天> 10:30" --by "设备员 赵三" --workshop 常减压车间 --equip-ledger <目录B> --ledger <目录C>` | C 级（R7 振动类不影响运行）；台账补出介质柴油、设备编号 10002100、设备名称进料泵；专业动设备；通知单草稿 M1、优先级 3；剧本 09:00 时 P-2101A 无未关闭通知单，疑似重复 0 |
| M2 | E-1201 循环水回水有油花、可能内漏，影响运行，登记并看是否报过 | 设备资产管理 `get_equipment_ledger`（tag=E-1201）→ 目录 B；`get_notifications`（tag=E-1201，open_only=true）→ 目录 C | `--desc "E-1201 循环水回水发现油花，管束可能内漏，换热效果变差" --tag E-1201 --affects-run 是 --workshop 常减压车间 --equip-ledger <目录B> --ledger <目录C>` | 泄漏类、介质柴油（台账补），B 级（R4 影响运行）；疑似重复 1 条：剧本通知单「E-1201 管束内漏，需抽芯试压」（NOPR），仍正常登记、由用户确认是否新建 |
| M3 | 常减压车间未关闭通知单按 A/B/C 重新过一遍 | 设备资产管理 `get_notifications`（workshop=常减压车间，open_only=true）→ 目录 A；`get_equipment_ledger`（workshop=常减压车间）→ 目录 B | `--input <目录A> --equip-ledger <目录B> --workshop 常减压车间` | 条数等于工具返回行数；每条都带原通知单号（`sourceNo`，`sourceNoKind=notification`）与系统缺陷等级（`sourceLevel`），md 注明「系统已存在通知单 …，勿重复创建」；其中 E-1201「管束内漏，需抽芯试压」为 B 级（R4），`sourceLevel` 为 B、`sourceLevelDiffers=false`；如有系统等级与脚本定级不一致的，计入 `counts.sourceLevelDiffers` 并逐条 warning；通知单已在系统中，`notification.csv` 不再拿去建单；通知单导出不带车间列，md 口径写「车间范围：输入未含车间列，车间范围以取数条件为准。」 |
