# 检修完工验收（completion-acceptance）· 演示与回归样例

> 本目录为技能 `completion-acceptance` 的演示与回归样例，不进发布包；开发包（`build.sh --with-examples`）中位于技能目录 `examples/`。
> 全部样例由 `node scripts/make-sample.js` 再生，数值随 seed 变化但结论不变。

## 示例问题 ↔ 附件对照表

| # | 示例问题 | 附件 | 运行参数 | 预期结果 |
|---|---|---|---|---|
| 1 | P-1101B 泵解体检修完了，换了机封和轴承，日常维修，出个验收清单 | 无 | `--tag P-1101B --equip-type 离心泵 --scope "解体检修，更换机械密封与轴承，重新对中" --contractor 检修一队 --repair-type 日常维修 --pressure-test --trial-run` | 24 项验收项，五类齐全；全部 `result` 为 null；签字栏五方（班组/车间/公司设备管理部门/工艺（操作）/承修单位）无监理；`qcPoints` 为 null 并 warning 未提供方案 |
| 2 | 按检修方案对一下，验收项有没有漏掉方案里的质量控制点 | `sample-plan-pump.txt` | 同上 + `--plan sample-plan-pump.txt` | 控制点 6 个、已对应 5 个、缺口 1 个（联轴器弹性块磨损量检查）；md 开头【注意】提示缺口 |
| 3 | 验收组已经填了一部分结果，汇总一下有哪些不合格 | 同上 + `sample-acceptance-record.xlsx` | 再加 `--records sample-acceptance-record.xlsx` | 回填 7 项；2 项不合格（对中、机封）；1 项未判定（「待复测」）；1 项未匹配（联轴器弹性块）；md 开头出现【注意】不合格提示 |
| 4 | 验收记录是 EM 系统导出的，列名不一样 | `sample-acceptance-record-em.xlsx` | `--tag P-1101B --equip-type 离心泵 --scope "解体检修，更换机械密封与轴承，重新对中" --contractor 检修一队 --records sample-acceptance-record-em.xlsx --repair-type 小修` | 「验收项目 / 验收结论 / 问题描述」列名识别，标题行与合计行跳过；回填 3 项、1 项不合格；「小修」映射为「日常维修」并 warning |
| 5 | 换热器抽管束清洗完了要验收，方案是 Excel | `sample-plan-hex.xlsx` | `--tag E-1201 --equip-type 换热器 --scope "抽管束化学清洗、更换法兰垫片、保温恢复" --contractor 检修三队 --plan sample-plan-hex.xlsx --pressure-test` | xlsx 方案可读，控制点 4 个全部对应，`qcGap` 为 0；验收项含管束清洗、管程/壳程水压试验、保温恢复 |
| 6 | 循环氢压缩机大检修完工，方案是 Word，帮我出验收清单并对方案控制点 | `sample-plan-compressor.docx` | `--tag K-3101 --equip-type 循环氢压缩机 --scope "解体大修，更换轴承、干气密封，对中" --contractor 检修公司 --plan sample-plan-compressor.docx --trial-run --pressure-test --repair-type 大检修` | docx 直接读取；归类压缩机/机组（CMP-），验收项含间隙、对中、干气密封、联锁、轴位移；控制点 5 个全部对应；应附资料含联锁保护试验记录；公司设备部门签字栏标「大检修必签」；warning 提示机组验收由公司设备部门牵头 |
| 7 | 方案里没写质量控制点，还能比对吗 | `sample-plan-no-qc.txt` | `--tag V-1301 --equip-type 容器 --scope "清罐、防腐层修补、人孔垫片更换" --contractor 检修四队 --plan sample-plan-no-qc.txt` | `qcPoints` 为 0 并 warning「未识别出质量控制点」，`qcMatched`、`qcGap` 为 `null`（未比对），报告写明需人工核对，**不报成「无缺口」** |
| 8 | 是台离心式除尘器，八类里都不是 | 无 | `--tag X-3101 --equip-type 离心式除尘器 --scope "解体大修，更换滤芯" --contractor 检修二队 --trial-run` | `typeCovered=false`，只出通用框架 + 3 条「待技术人员补充」占位项，md 开头醒目提示；验收标准中**无任何经验数值** |

## 关键验证点

1. **不预填合格**：任何一次运行，未在 `--records` 中填写的验收项 `result` 恒为 `null`；`conclusion.result` 与五方 `signatures` 恒为 `null`；md 的结果栏、结论栏、签字栏留空。
2. **三级验收无监理**：签字栏固定为 班组 / 车间 / 公司设备管理部门 / 工艺（操作）/ 承修单位；大检修时公司设备部门栏标"必签"。
3. **控制点不静默丢弃**：示例 2 中 `qcMatched + qcGap === qcPoints`，缺口进 `warnings` 且在 md 开头提示；示例 6 验证 docx 方案可读且 XML 标签已去除。
4. **无方案不按 0 计**：示例 1 的 `counts.qcPoints/qcMatched/qcGap` 三项均为 `null`，报告写「未提供检修方案，未做质量控制点比对」。
5. **类型不覆盖不编数值**：示例 8 的占位项验收标准恒为「待技术人员补充」，不出现 mm / ℃ / MPa / A / N·m 等数值。
6. **不合格提示的出现与不出现**：示例 3、4 出现「【注意】存在 N 项不合格」；示例 1、2 无不合格项时该提示不出现；全程无 emoji。
7. **未判定不按合格**：示例 3 中「待复测」归为未判定并单列，不计入合格。
8. **EM 列名**：示例 4 的「验收项目 / 验收结论 / 问题描述」经共享别名识别。
9. **检修分级不默认**：不传 `--repair-type` 时为 null 并 warning；旧值映射 warning。
10. **声明行**：每次运行 md 末尾都保留「本清单为辅助核对工具……未完成签字前设备不得投用。」

## 再生样例

```bash
node scripts/make-sample.js            # 默认 seed=1
node scripts/make-sample.js --seed 7   # 数值变化，结论不变
```

## MCP 取数对照

不上传附件；按 SKILL.md「数据获取（MCP）」读台账、工单字段填参数。预期结果只写每天稳定的结论。

| # | 示例问题 | MCP 调用 | 运行参数 | 预期结果 |
|---|---|---|---|---|
| M1 | E-1201 抽芯检修工单还在施工，明早完工，先准备验收清单 | 设备资产管理 `get_equipment_ledger`（tag=E-1201）、`get_work_orders`（tag=E-1201） | `--tag E-1201 --equip-type 换热器 --name 柴油-原油换热器 --workshop 常减压车间 --special-equipment --scope "管束抽芯检修，管程壳程试压，更换法兰垫片" --contractor 检维修中心静设备班 --repair-type 日常维修 --pressure-test`（台账「设备代码」不为空 → `--special-equipment`；工单为 PM01 施工中，无实际结束日期，不传 `--finished-at`） | 归类换热器；检修分级日常维修；验收项含管束回装与定位、管程水压试验、壳程水压试验、特种设备相关资料；应附资料含试压记录、特种设备检验报告、安全阀校验证书；未提供方案时 `qcPoints` 为 null 并 warning |
| M2 | P-2101A 换驱动端轴承、重新对中，日常维修，要试运，先出验收清单 | 设备资产管理 `get_equipment_ledger`（tag=P-2101A） | `--tag P-2101A --equip-type 离心泵 --name 进料泵 --workshop 常减压车间 --scope "解体检修，更换驱动端轴承，联轴器对中" --contractor 检维修中心动设备班 --repair-type 日常维修 --trial-run` | 归类离心泵；台账「设备代码」为空，不按特种设备；验收项含对中、轴承间隙与润滑、负荷试运振动值、负荷试运轴承温度；应附资料含对中记录、试运记录，不含特种设备资料；未指定试压有 warning |
