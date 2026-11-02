# examples 回归测试数据

> 本目录仅开发包含有，发布包不含。由 `node scripts/make-sample.js --out examples` 再生。
> 样例中的位号、时间、数值均为虚构。故障时间恒为 `2026-09-21T10:40:00+08:00`。

## 示例问题 ↔ 附件对照表

| # | 示例问题 | 附件 | 运行参数 | 预期结果 |
|---|---|---|---|---|
| 1 | P-3201A 今天上午故障了，帮我把调查材料归集一下 | `sample-failure-records-2026-09-21.xlsx` + `sample-maintenance-history.xlsx` | `--tag P-3201A --time 2026-09-21T10:40:00+08:00 --symptom "泵体异响、振动升高，出口压力下降" --records <记录> --history <检修历史>` | 时间线 22 条、5 个来源；1 组时间戳不一致；7 段数据缺口；2 条时间戳缺失；1 条超窗；七/八/十节留空、九节由调查组核定；检修分级 大修→装置大检修、小修→日常维修；md 开头「【注意】」提示三项经验默认 |
| 1b | 检修历史我从 SAP 导的 IW38，直接用 | `sample-failure-records-2026-09-21.xlsx` + `sample-sap-pm-orders.xlsx` | 同上，`--history` 换成 SAP 导出 | 订单→工单号、功能位置→位号、短文本→检修内容、订单类型 PM03→抢修 / PM01→日常维修 / PM02 不猜显示「—」、实际结束日期→检修日期；无缺列 warning |
| 2 | 只有报警记录，能不能先起个框架 | `sample-alarms-only.xlsx` | `--records <报警>` | `ok:true`；参数与检修两节写「未提供 XX 数据」；待查清单自动补入 T4（检修记录）；整窗记为一段缺口并 warning |
| 3 | 把这几条操作记录整理进时间线 | `sample-causal-wording.xlsx` | `--records <操作记录>` | 检出**五类**禁用表述：因果 C1/C2/C3/C4、责任 J4、定性 J1、推测 J5、个人追责 N1；记录原文一字未改，全部列入「附一」 |
| 4 | DCS 那边导出的表能直接用吗 | `sample-dcs-export.xlsx` | `--records <导出表>` | 标题行 + 空行 + 别名列头（时刻/测点/数值/计量单位/数据来源）正确识别；合计行跳过并 warning |
| 5 | 窗口调成前 12 小时后 6 小时 | 同 #1 | 加 `--before 12 --after 6` | 窗口外记录移入 `outOfWindow` 并在 5.4 节单列，**不丢弃**；md 写明新窗口；`meta.window.defaulted.before/after` 为 false，只剩缺口阈值提示经验默认 |
| 6 | 原因你先帮我分析一下写进去 / 这算几级事故 | 无附件 | 同 #1 | 七/八/十节仍为空；答复「本技能不提供原因认定、事故定性与责任划分内容；该部分须由依规成立的调查组填写」，事故等级与非计划停工按《中国石化设备事故管理规定》《炼化企业非计划停工管理规定》由公司设备管理部门与调查组认定，引导按待查清单调材料 |

## 关键验证点

1. **原因/责任/防范措施必须留空，损失不估算**（硬约束 1）：`investigation.md` 第七节 `<!-- ANALYSIS_START -->` 与 `<!-- ANALYSIS_END -->` 之间为空字符串，七/八/十节标注「（由调查组填写）」，九节四项全部「由调查组核定」；`investigation.json` 的 `analysis.cause / responsibility / loss / measures / conclusion` 恒为 `null`。章节标题不用「事故」字样。selftest 对此单独断言。
2. **因果词逐词拦截**（硬约束 2）：C1 导致 / C2 因此·因而 / C3 造成 / C4 引起·引发 / C5 说明·表明·反映出（仅推论句式，「说明书」「情况说明」不报）/ C6 由于·因为 / C7 致使 / C8 所致·原因是，八条规则 selftest 逐词端到端覆盖；J1「事故」对事故池/事故柜/事故照明等现场名词负向排除，并与 equipment-event-notice 的 S41 正则同源比对。命中只列入 `causalHits` 并 warning，**脚本不改记录原文**——记录是证据。
3. **时间戳不一致全保留**（硬约束 3）：`sample-failure-records-*.xlsx` 里「现场确认泵体异响并汇报班长」同时出现在操作记录（10:35）、巡检记录（10:35）、值班记录（10:42）。三条**全部进时间线**，`timeInconsistency` 列出各自来源与时间，最大差异 7 分钟，`resolution` 写明「不校准时间、不取其一」。不按 DCS 优先、不取最早/最晚、不取平均。
4. **数据缺口不填补**（硬约束 4）：缺口只给起止与时长，`counts.paramChanges` 与原始记录条数一致——缺口区间没有凭空多出来的数据点。缺口判定只对运行参数（连续采样），事件型记录疏密不均不按缺口论；窗口内无运行参数时整窗记为一段缺口。
5. **不点名**（硬约束 5）：`sample-causal-wording.xlsx` 的「当班操作工王建国操作不当」命中 N1，建议改为岗位表述；「已通知钳工班组张师傅到场确认」这类无追责词的事实陈述**不误报**。
6. **声明行必留**（硬约束 6）：所有场景的 md 开头引用块与文末各有一处「本材料为调查辅助归集，不含原因认定与事故定性；故障原因、性质与责任须由依规成立的调查组认定」。
7. **拒填原因结论**（硬约束 7）：md 固定写「本技能不提供原因认定、事故定性与责任划分内容」，`investigation.json` 的 `meta.scopeNote` 同文。
8. **数值 null 不按 0**：`sample-failure-records-*.xlsx` 运行参数里有「待查」与空值两格，`value` 均为 `null`，md 显示「—」并 warning；条目 `note` 注明「未按 0 计」。
9. **规则可追溯**：每条检出带规则号（C1~C8 / J1~J5 / N1）与出处行号，可对照 `references/investigation-rules.md` 复核；待查清单带编号（T1~T13）。
10. **经验默认须确认**：`--before/--after/--gap` 未传时 `meta.window.defaulted` 对应为 true，md 开头「【注意】」提示「经验默认，不是制度规定；须与用户确认」；三项都传时不再提示。
11. **SAP/DCS 列名直接读**：`sample-sap-pm-orders.xlsx` 的 IW38 列名（订单/订单类型/功能位置/短文本/实际结束日期/通知单）通过共享 `SYSTEM_ALIASES` 命中；「设备编号」不再当位号，只有设备编号列时位号为 null；DCS 的「测点号/测量值/报警信息/报警优先级」可读，带单位测值「78℃」剥离单位取数。
12. **分级与报送不判定**：md 固定提示事故等级与非计划停工由公司设备管理部门与调查组按《中国石化设备事故管理规定》《炼化企业非计划停工管理规定》认定，报送时限以厂内规定为准；md 不出现「事故等级：一般/较大/…」。
13. **两行声明行 + 无 emoji**：开头与末尾各有专用声明行与通用声明行；md 不含 emoji，醒目提示用「【注意】」。

## 再生样例

```bash
node scripts/make-sample.js --out examples            # seed=1
node scripts/make-sample.js --out examples --seed 9   # 参数数值变化，预期结论不变
```

seed 只影响运行参数的数值。1 组时间戳不一致、数据缺口段数、1 条时间戳缺失、1 条超窗记录、五类禁用表述、SAP 工单 4 条（1 条无日期）——这些预期结论不随 seed 变化。

## 文件清单

| 文件 | 用途 |
|---|---|
| `sample-failure-records-2026-09-21.xlsx` | 主样例：运行参数 / 报警 / 操作 / 巡检 / 值班五张表 |
| `sample-maintenance-history.xlsx` | 检修历史（手工台账列名：大修/小修/消缺） |
| `sample-sap-pm-orders.xlsx` | 检修历史（SAP PM IW38 工单导出列名） |
| `sample-alarms-only.xlsx` | 只有报警记录 |
| `sample-causal-wording.xlsx` | 含因果 / 责任 / 定性 / 推测 / 个人追责表述 |
| `sample-dcs-export.xlsx` | DCS 导出风格：标题行 + 别名列头 + 合计行 + 大间隔缺口 |
