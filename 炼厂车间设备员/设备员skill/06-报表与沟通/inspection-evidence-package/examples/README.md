# examples 回归测试数据

> 本目录仅开发包含有，发布包不含。由 `node scripts/make-sample.js --out examples` 再生。

## 示例问题 ↔ 附件对照表

| # | 示例问题 | 附件 | 运行参数 | 预期结果 |
|---|---|---|---|---|
| 1 | 下周要来设备专业检查，按这份通知把资料找出来 | `sample-notice.md` + `sample-materials.xlsx` | `--notice sample-notice.md --materials sample-materials.xlsx --workshop 常减压车间 --date-range 2026-07-01~2026-09-30` | 6 检查项：齐全 4、缺口 2、未对应材料 4 |
| 2 | 这是检查表格式的，能读吗 | `sample-checklist.xlsx` + `sample-materials.xlsx` | 同上换 `--notice` | 10 检查项：齐全 7、缺口 2、覆盖不全 1、未对应 1 |
| 3 | 我们材料齐全，核对一下 | `sample-checklist-small.xlsx` + `sample-materials-complete.xlsx` | 同上 | 3 检查项全部齐全，**不出现缺口醒目提示** |
| 4 | 材料才交了三份，看看差多少 | `sample-checklist.xlsx` + `sample-materials-sparse.xlsx` | 同上 | 缺口 9 项，报告开头醒目提示 |
| 5 | 有份台账只覆盖了七八月，检查期是三个月 | `sample-checklist.xlsx` + `sample-materials.xlsx` | 加 `--date-range 2026-07-01~2026-09-30` | 该项列入「覆盖不全」，写明实际覆盖区间与未覆盖的检查期 |
| 6 | 公司设备管理专项检查，要看变更管理、联锁旁路、特护、润滑五定、LDAR、一机一档和用火票 | `sample-checklist-sinopec.xlsx` + `sample-materials-sinopec.xlsx` | `--date-range 2026-07-01~2026-09-30` | 7 检查项：齐全 5（变更台账、特护日报（文件名推出三季度）、润滑五定表、LDAR 报告（Q3）、用火作业票（旧名「动火」也可对上））、缺口 2（联锁旁路审批单与 SIS 测试记录、一机一档），设备台账不充一机一档 |
| 7 | 检查通知是 PDF | — | — | 先用平台 pdf 技能转 txt/docx 再传 `--notice`；直接传 PDF 报错并提示前置转换 |

> 注意样例配对：`sample-materials-complete.xlsx` 只含 3 份材料，是为 `sample-checklist-small.xlsx`（3 个检查项）准备的。与 10 项的完整检查表配对会得到 7 项缺口，这是正确行为而非错误。

## 关键验证点

1. **缺失绝不充数**：这是本技能最重要的行为。找不到对应材料时只写「未找到对应材料」，不写「可用 XX 替代」，也不把相近材料算作证据。迎检时拿错材料比拿不出材料更被动。
2. **覆盖不全不按齐全算**：台账存在但只覆盖检查期的一部分，属于「覆盖不全」而非「齐全」。写明实际区间，让车间自己判断要不要补。
3. **缺口醒目且不淡化**：案例 3 与案例 4 构成正反对照。有缺口时报告开头带醒目提示，无缺口时完全不出现。
4. **不补编不代写**：缺口节固定带一行「不得用相近材料充数，不得事后补编记录」。事后补记录是检查中的高危行为，技能不能为此提供便利。
5. **不判合规**：只报「有没有对应材料」，不报「这项达不达标」。达标与否由检查组判定。
6. **未对应材料单列**：有材料但对不上任何检查项时，列入「未对应材料」由人工确认，不强行归类。
7. **单端日期推断**：资料清单只填起始或截止一端时，另一端按文件名推断并 warning 请核对；推不出保持不详，不按检查期倒推。

## 再生样例

```bash
node scripts/make-sample.js --out examples            # seed=1
node scripts/make-sample.js --out examples --seed 5   # 文号与日期变化，齐全/缺口/覆盖不全的条数不变
```
