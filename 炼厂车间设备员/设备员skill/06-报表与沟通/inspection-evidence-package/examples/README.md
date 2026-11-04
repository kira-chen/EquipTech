# examples 回归测试数据

> 本目录仅开发包含有，发布包不含。由 `node scripts/make-sample.js --out examples` 再生。

## 示例问题 ↔ 附件对照表

| # | 示例问题 | 附件 | 运行参数 | 预期结果 |
|---|---|---|---|---|
| 1 | 下周要来设备专业检查，按这份通知把资料找出来 | `sample-notice.md` + `sample-materials.xlsx` | `--notice sample-notice.md --materials sample-materials.xlsx --workshop 常减压车间 --date-range 2026-07-01~2026-09-30` | 6 检查项：齐全 4、缺口 2、未对应材料 4 |
| 2 | 这是检查表格式的，能读吗 | `sample-checklist.xlsx` + `sample-materials.xlsx` | 同上换 `--notice` | 10 检查项：齐全 7、缺口 2、覆盖不全 1、未对应 1 |
| 3 | 我们材料齐全，核对一下 | `sample-checklist-small.xlsx` + `sample-materials-complete.xlsx` | 同上 | 3 检查项全部齐全，**不出现缺口醒目提示** |
| 4 | 材料才交了一份设备台账，看看差多少 | `sample-checklist.xlsx` + `sample-materials-sparse.xlsx` | 同上 | 缺口 9 项、期限未知 1 项（台账未填起止日期），报告开头醒目提示 |
| 5 | 压力容器检验报告只到六月底，检查期是七到九月 | `sample-checklist.xlsx` + `sample-materials.xlsx` | 加 `--date-range 2026-07-01~2026-09-30` | 第 5 项（压力容器定期检验）列入「覆盖不全」，写明材料覆盖 2025-07-01 ~ 2026-06-30、与检查期无交集 |
| 6 | 公司设备管理专项检查，要看变更管理、联锁旁路、特护、润滑五定、LDAR、一机一档和用火票 | `sample-checklist-sinopec.xlsx` + `sample-materials-sinopec.xlsx` | `--date-range 2026-07-01~2026-09-30` | 7 检查项：齐全 5（变更台账、特护日报（文件名推出三季度）、润滑五定表、LDAR 报告（Q3）、用火作业票（旧名「动火」也可对上））、缺口 2（联锁旁路审批单与 SIS 测试记录、一机一档），设备台账不充一机一档 |
| 7 | 检查通知是 PDF | — | — | 先用平台 pdf 技能转 txt/docx 再传 `--notice`；直接传 PDF 报错并提示前置转换 |

> 注意样例配对：`sample-materials-complete.xlsx` 只含 3 份材料，是为 `sample-checklist-small.xlsx`（3 个检查项）准备的。与 10 项的完整检查表配对会得到 7 项缺口，这是正确行为而非错误。

## MCP 取数对照

检查通知用平台知识库的《关于开展2026年四季度设备专业检查的通知》（10 项，开发环境在 `MCPServer/test/kb/inspection-evidence-package/kb/`）作 `--notice`；MCP 导出的 csv 全放进同一个空目录作 `--materials`。预期结果只列每天都稳定的剧本结论。

| # | 示例问题 | MCP 调用 | 运行参数 | 预期结果 |
|---|---|---|---|---|
| M1 | 不限检查期，系统台账记录对一遍 | 设备资产管理 `get_equipment_ledger`、`get_special_equipment`、`get_safety_valves`、`get_failure_history`、`get_notifications`；点检巡检App `get_inspection_records`；HSE管理平台 `get_hazards`、`get_personnel_certificates`；作业票系统 `get_permits`（除人员证书外均 workshop=常减压车间） | `--notice <知识库检查通知> --materials <目录> --workshop 常减压车间` | 10 项：齐全 8、未找到 2（第 9 项应急演练、第 10 项 LDAR）；第 1 项设备台账只对应设备台账.csv（特种设备台账不充数）；第 5 项缺陷对应通知单.csv、故障记录.csv；第 6 项用火作业对应作业清单.csv；第 8 项 P-2101A 检修记录对应故障记录.csv；隐患台账.csv 列入未对应材料 |
| M2 | 检查期近 90 天 | 同 M1；`get_inspection_records`、`get_failure_history`、`get_hazards`、`get_notifications` 加 start_date=<90 天前>、end_date=<今天> | M1 参数加 `--date-range <90 天前>~<今天>` | 齐全 0、期限未知 8、未找到 2：MCP 导出文件名不带日期，一律期限未知，不按齐全报送 |
| M3 | 检查期 60 天前 ~ 31 天前，查不到如实写 | 同 M2，日期改为 start_date=<60 天前>、end_date=<31 天前>；检查期不含今天，不调 `get_permits` | `--date-range <60 天前>~<31 天前>` | 巡检记录.csv 只有表头（系统只留近 30 天），`counts.emptyFiles` 1，第 2 项判未找到对应材料；第 6 项用火作业未找到；第 1 项设备台账期限未知；齐全 0 |

## 关键验证点

1. **缺失绝不充数**：这是本技能最重要的行为。找不到对应材料时只写「未找到对应材料」，不写「可用 XX 替代」，也不把相近材料算作证据。迎检时拿错材料比拿不出材料更被动。
2. **覆盖不全不按齐全算**：台账存在但只覆盖检查期的一部分，属于「覆盖不全」而非「齐全」。写明实际区间，让车间自己判断要不要补。
3. **缺口醒目且不淡化**：案例 3 与案例 4 构成正反对照。有缺口时报告开头带醒目提示，无缺口时完全不出现。
4. **不补编不代写**：缺口节固定带一行「不得用相近材料充数，不得事后补编记录」。事后补记录是检查中的高危行为，技能不能为此提供便利。
5. **不判合规**：只报「有没有对应材料」，不报「这项达不达标」。达标与否由检查组判定。
6. **未对应材料单列**：有材料但对不上任何检查项时，列入「未对应材料」由人工确认，不强行归类。
7. **单端日期推断**：资料清单只填起始或截止一端时，另一端按文件名推断并 warning 请核对；推不出保持不详，不按检查期倒推。
8. **期限未知单列**：材料全都没有日期（清单未填、文件名推不出，如 MCP 导出文件）时，该检查项判「期限未知」单列第五节，不算齐全也不算覆盖不全；文件名里的位号段（E-1201 等）不当年份。

## 再生样例

```bash
node scripts/make-sample.js --out examples            # seed=1
node scripts/make-sample.js --out examples --seed 5   # 文号与日期变化，齐全/缺口/覆盖不全的条数不变
```
