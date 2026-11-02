# examples 回归测试数据

> 本目录仅开发包含有（`build.sh --with-examples`），发布包不含。
> 全部样例由 `node scripts/make-sample.js --out examples` 再生，数值随 seed 变化但结论不变。

## 示例问题 ↔ 附件对照表

| # | 示例问题 | 附件 | 运行参数 | 预期结果 |
|---|---|---|---|---|
| 1 | 把各处的待办汇总一下，我今天要干什么 | 6 个上游 JSON + `sample-todo-sheet.xlsx` + `sample-todo-text.txt` | `--owner 张设备 --date 2026-09-21` | 待办 23 项：逾期 8、今日到期 2、近期 7、无到期日 6；疑似重复 3 组 |
| 2 | 只给了工单和隐患的产出，先汇集这两份 | `sample-orders.json,sample-hazard.json` | 同上 | 待办 7 项：逾期 4、近期 2、无到期日 1；不因缺其他来源而报错 |
| 3 | 昨天没干完的别丢了，接着往下排 | 任一来源 + 上一日 `todo.json` | 加 `--prev <上一日 todo.json>` | 上一日未完成项全部结转；到期日与上一日一致；清单标「结转自 X 月 X 日」 |
| 4 | 这个 JSON 是别的系统导的，能一起读吗 | 主样例 + `sample-unknown.json` | 同 #1 | 无法识别的 JSON 记 warning 并忽略，其余来源照常汇集，ok:true |
| 5 | 顺便把今天做完的事记进日志 | 同 #1 | 加 `--done "完成 P-1102A 加油；参加晨会"` | `工作日志.md`「今日完成事项」列出 2 条；`counts.done` 为 2 |
| 6 | 只看未来 3 天的 | 同 #1 | 加 `--horizon 3` | 近期项减少，超出的进「前瞻期外」一节，总数不变 |
| 7 | 我自己记在本子上的几件事也加进来 | `sample-todo-text.txt` | `--owner 张设备 --date 2026-09-21` | 3 条文字待办；写了「截止 日期」的识别出到期日，其余 2 条进无到期日 |
| 8 | 昨天值班交接记录里没完成的事也排进来 | `sample-handover.json`（shift-handover-record 产出） | `--owner 张设备 --date 2026-09-21` | 识别为「工作交接」来源，pending 3 条全部纳入：P-1101B 期限已过 P1、E-1201 近期 P2（detail 带「交接记录中已连续结转 2 次」）、TT-1308 无期限进无到期日不自设 |
| 9 | 交接记录和工单、缺陷一起汇总 | #1 的 8 个来源 + `sample-handover.json` | 同 #1 | 26 项；P-1101B 疑似重复组扩为 4 条（工单 / 缺陷 / 待办表 / 交接），均保留不合并 |
| 10 | 这张跟进表是从 SAP 导出来的，紧急程度写的是 1~4 和 A 级 | `sample-todo-sap-style.xlsx` | `--owner 张设备 --date 2026-09-21` | 列名「工作事项 / 要求完成日期 / 紧急程度 / 功能位置 / 工单号 / 处理状态」直接可读；4 项（已关闭的不进）；「1 非常高」→ P1、「A级」→ P1、「II级」→ P2 并 warning 旧口径、「3 中」→ P3；功能位置归位号、工单号归编号 |

## 关键验证点

1. **多源合并**：6 个上游 JSON 各自的 `overdue` / `dueSoon` / `stalled` / `unverified` / `unresolvedFail` / `defects` 字段全部被识别为待办，`byCategory` 分 8 类。
2. **结转不丢不延期**：`--prev` 传入后 `counts.carriedOver` 等于上一日未完成项数；结转项 `dueDate` 与 `originalDueDate` 相同，逾期天数按新基准日 +1，到期日不变。二次结转 `carriedRounds` 累加到 2，`carriedFrom` 仍是最早那天。
3. **无到期日不自设**：工单停滞（WO-26082033）、校验不合格未整改（TT-1308）、未定级缺陷（QX-26090016）、待办表未填到期日的一项、文字待办 2 条，共 6 项进 `noDueDate`，`dueDate` 恒为 `null`，各自写明原因。
4. **疑似重复不自动合并**：P-1101B 同时出现在工单超期、缺陷跟进、待办表；V-1301 出现在工单临期与特种设备定检；PSV-1102 出现在校验超期与待办表。三组均单列供确认，`items[]` 中原始条目一条不少。
5. **无法识别的 JSON**：`sample-unknown.json` 被 warning 忽略，`counts.sources` 不计入它，运行不中断。
6. **合计行与标题行**：`sample-todo-sheet.xlsx` 首行为标题、第三行才是表头，末行是合计行——表头正确识别、合计行跳过并 warning。
7. **已完成不进待办**：待办表中状态为「已完成」的「提交上月设备月报」不出现在任何一节。
8. **声明行**：两份 md 均含「待办汇集自所提供来源，覆盖范围见清单说明；厂内业务系统（EM/SAP PM）中的待办请以系统为准。」与通用声明行「本材料由脚本汇总、模型成文，仅供设备员复核参考，不替代审批、定性、验收与签字；厂内制度与系统数据为准。」。
9. **交接记录对接**（案例 8、9）：`handover.json` 按 `meta.skill === 'shift-handover-record'` 且含 `pending` 数组识别；期限原样、不改写；与工单同位号判疑似重复不合并。
10. **优先级对齐口径表**（案例 10）：SAP 1~4、缺陷 A/B/C 直接认，旧 I~IV 映射并 warning 到行。

## 再生样例

```bash
node scripts/make-sample.js --out examples            # 默认 seed=1
node scripts/make-sample.js --out examples --seed 7   # 数值变化，结论不变
```
