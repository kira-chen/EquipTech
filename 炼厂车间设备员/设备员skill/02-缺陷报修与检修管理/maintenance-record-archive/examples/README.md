# examples 回归测试数据

> 本目录仅开发包含有，发布包不含。由 `node scripts/make-sample.js --out examples` 再生（seed 改文件编号与照片阶段，缺失项结论不变）。

## 示例问题 ↔ 附件对照表

| # | 示例问题 | 附件 | 运行参数 | 预期结果 |
|---|---|---|---|---|
| 1 | 分离器大检修的资料整理一下，这是压力容器，涉及焊接和试压，看看还缺什么 | `sample-materials.xlsx` | `--tag V-2301 --type 大检修 --special-equipment --scope-weld --scope-material --scope-ndt --scope-pressure` | 应归档 21 项、已归档 10 项、缺失 11 项，其中**必备缺失 4 项**（特种设备检验报告、无损检测报告、耐压试验记录、检修总结），报告开头【注意】提示；会议纪要进待认领 |
| 2 | 泵的日常维修资料归档，看看齐不齐 | `sample-minor-complete.xlsx` | `--tag P-1101A --type 日常维修` | 资料齐全，无缺失，**开头不出现必备缺失提示** |
| 3 | 这次是按老叫法报的"大修"，只有一份检修记录卡，其他都还没交，能核对吗 | `sample-sparse.xlsx` | `--tag V-2301 --type 大修 --special-equipment` | 「大修」映射为「大检修」并 warning；大量缺失，必备缺失醒目提示（方案、作业票、验收单、检修总结、特种设备五项）；不建议补编 |
| 4 | 归档完顺便把台账的检修履历更新一下 | 题 1 附件 + `sample-equipment-ledger.xlsx` | 加 `--ledger sample-equipment-ledger.xlsx --contractor 检修公司二队 --content "塔盘更换、人孔密封面补焊"` | 生成 `ledger-update.csv`（EM 检修记录列头：功能位置、设备编号、设备描述、检修类型……），报告声明不直接改写台账 |
| 5 | 台账是 SAP 导出的，列名是功能位置、设备、设备描述，用设备编号 10023001 查 | 题 1 附件 + `sample-equipment-ledger-sap.xlsx` | `--tag 10023001 --type 大检修 --ledger sample-equipment-ledger-sap.xlsx` | 按 SAP 设备编号命中，履历按功能位置 V-2301 写出并 warning 核实；设备编号、设备描述带入 CSV |
| 6 | 资料在这个文件夹里，直接扫一下 | 材料目录 | `--materials <目录路径>` | 递归扫描，跳过隐藏文件，子目录文件带相对路径 |

## 关键验证点

1. **必备缺失醒目提示**：案例 1 与案例 2 构成正反对照。有必备缺失时「【注意】」提示出现在第一节之前，无缺失时完全不出现；不用 emoji。
2. **方案与作业票必备**：案例 3 只有检修记录卡，方案、作业票、验收单均列为必备缺失。
3. **大检修追加项**：案例 1 的检修总结为必备缺失；三查四定问题整改记录、中交记录、试车记录、备件领用单等为一般缺失。
4. **特种设备口径确实加严**：同样的稀疏材料，加 `--special-equipment` 的必备缺失数明显多于不加。
5. **检修分级旧值映射**：案例 3 的「大修」→「大检修」，warning 并在概况表显示原填值；非法值报错。
6. **无法归类不强行归类**：会议纪要列入「待认领」，由人工认领。
7. **不改写台账**：只产出 EM 列头的 `ledger-update.csv` 建议行，报告中明写「本技能不直接改写台账文件」。
8. **SAP 列名**：案例 5 的功能位置 / 设备 / 设备描述经共享别名识别，设备编号与位号分列。
9. **不建议补编**：缺失节固定带一行「不得用其他材料替代，不得事后补编记录」。

## 再生样例

```bash
node scripts/make-sample.js --out examples            # seed=1
node scripts/make-sample.js --out examples --seed 4   # 文件编号变化，缺失项结论不变
```
