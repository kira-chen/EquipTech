# examples 回归测试数据

> 本目录仅开发包含有（`build.sh --with-examples`），发布包不含。
> 全部样例由 `node scripts/make-sample.js --out examples` 再生，数值随 seed 变化但结论不变。

## 示例问题 ↔ 附件对照表

| # | 示例问题 | 附件 | 运行参数 | 预期结果 |
|---|---|---|---|---|
| 1 | 这张设备专项自查表帮我预填一下，台账在这 | `sample-self-audit-form.xlsx` + `sample-ledger-data.xlsx` | `--workshop 常减压车间 --period 2026-09-30` | 15 项：5 预填、8 需判断、2 缺数据、0 无法解析 |
| 2 | 这张表合并单元格比较多，能读吗 | `sample-form-merged.xlsx` + `sample-ledger-data.xlsx` | 同上 | `needConfirm:true`，8 处合并；md 开头出现「结构复杂先确认」提示 |
| 3 | 这张表全是「是否健全」「是否到位」这种，能填吗 | `sample-form-all-judgment.xlsx` + `sample-ledger-data.xlsx` | `--workshop 车间` | 6 项全部 `needJudgment`，预填数 0，`cellsWritten` 为 0 |
| 4 | 台账刚建还没录数据，先试着填一下 | `sample-self-audit-form.xlsx` + `sample-ledger-empty.xlsx` | `--workshop 车间` | 预填 0；7 个客观项全部落入 `noData`，无一项被填「符合」 |
| 5 | 不告诉自查时点，直接跑 | 主样例，去掉 `--period` | `--workshop 车间` | `ok:false`，报错要求传 `--period`（到期类不按脚本运行日默认） |
| 6 | 这张考核表有标准分、得分、扣分、检查结论、自评列，预填时别碰 | `sample-form-scored.xlsx` + `sample-ledger-data.xlsx` | `--workshop 车间 --period 2026-09-30` | 3 项：2 预填（台账有无、到期计数）、1 需判断；得分/扣分/检查结论/自评/是否符合列全空，标准分原值保留，`meta.neverWriteCols` 列出 |
| 7 | 自查表是 PDF | — | — | 先用平台 pdf 技能转为 docx/xlsx 再传 `--form`；直接传 PDF 报错并提示前置转换 |

## 关键验证点

1. **判断类绝不预填**：第 3、5、7、9、10、12、14、15 项（健全 J1、明确到人 J3、得当 J5、
   严格执行 J2、有效 J4、落实到位 J2、风险可控 J10、总体评价 J13）全部 `needJudgment`，
   预填稿「现状」列为空，备注列写明命中的规则号。
2. **缺数据不按符合**：第 8 项「是否建立作业票台账」、第 13 项「关键备件库存数量」——
   主台账里故意不提供作业票台账与备件台账，两项落入 `noData` 并写明
   「未提供「作业票台账」类数据表」，**不填「无」也不填「符合」**。
3. **到期只报事实**：第 4 项按 O4 输出「截至 2026-09-30：已过期 2 台/项，未到期 3 台/项」，
   并列出已过期条目的行号，**不写「合规」或「不合规」**。
4. **不代签字**：主样例末行「填报人」被识别为签字栏，跳过并 warning，不计入自查项。
5. **合计行跳过**：主台账「设备台账」末行「合计」被跳过并 warning，设备台数计为 6 而非 7。
6. **合并单元格**：`sample-form-merged.xlsx` 真带 8 处 `<mergeCells>`，触发 `needConfirm`；
   「自查类别」列的合并从属行不被误计为重复自查项。
7. **可写与不可写列**：主样例含「是否符合」「整改措施」两列，打分变体另含「得分」「扣分」「标准分」「检查结论」「自评」，脚本一个字都不写；
   `meta.neverWriteCols` 记录了本表中实际存在的不写列。
8. **自查时点必填**：`--period` 缺失或不是日期直接报错，到期类不按脚本运行日默认。

## 再生样例

```bash
node scripts/make-sample.js --out examples            # 默认 seed=1
node scripts/make-sample.js --out examples --seed 7   # 表号、位号、日期变化，结论不变
```
