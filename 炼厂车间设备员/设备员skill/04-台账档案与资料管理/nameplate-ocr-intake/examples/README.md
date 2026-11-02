# examples 回归测试数据

> 本目录仅开发包含有（`build.sh --with-examples`），发布包不含。
> 全部样例由 `node scripts/make-sample.js --out examples` 再生，数值随 seed 变化但结论不变。厂名、设备代码、SAP 设备编号均为虚构。

**注意**：本技能的读图识别由模型完成，脚本只做识别结果的后处理。因此样例里的 `sample-*-fields.json` 是**模型识别完成后的产物**（模拟模型看完铭牌照片写出的结构化结果，含抄录的铭牌原文 `raw`），不是照片本身。

## 示例问题 ↔ 附件对照表

| # | 示例问题 | 附件 | 运行参数 | 预期结果 |
|---|---|---|---|---|
| 1 | 拍了 P-1101A 的铭牌，帮我对一下台账 | `sample-pump-fields.json` + `sample-equipment-ledger.xlsx` | `--tag P-1101A --equip-type 泵 --ledger ...` | 18 字段：14 清晰、2 模糊、2 无法辨认；**3 项与台账冲突**（型号/出厂编号/制造日期），冲突项建议录入值全部留空；全部字段带 raw，0 项量级问题 |
| 2 | 新上的电机 M-1501，铭牌拍好了，建个档 | `sample-motor-fields.json` + 主台账 | `--tag M-1501 --equip-type 电机 --ledger ...` | 台账中无此位号 → **新增建档**，0 冲突；**2 项单位需核对**（额定功率印马力、重量印吨），识别值保持铭牌原值未换算 |
| 3 | V-1301 缓冲罐的铭牌，看看台账里的对不对 | `sample-vessel-fields.json` + 主台账 | `--tag V-1301 --equip-type 容器 --ledger ...` | 全部 20 项清晰可读（含设备代码），与台账**完全一致**，0 冲突，warning 提示「无须重复录入」；腐蚀裕量未抄 raw → 1 项「未提供原文」提示 |
| 4 | 这是 SAP 导出的技术对象清单，拿铭牌对一下 | `sample-pump-fields.json` + `sample-sap-pm-ledger.xlsx` | `--tag P-1101A --equip-type 泵 --ledger sample-sap-pm-ledger.xlsx` | 「功能位置」作位号命中，台账设备编号单列展示；「制造商」「型号编号」「制造商序列号」对齐；**2 项冲突**（型号/出厂编号；SAP 无制造日期列进 unmapped）；「建造年份」不与制造日期比对 |
| 5 | 缓冲罐铭牌上的设备代码跟特种设备台账一致吗 | `sample-vessel-fields.json` + `sample-sap-pm-ledger.xlsx` | `--tag V-1301 --equip-type 容器 --ledger sample-sap-pm-ledger.xlsx` | 设备代码对齐台账「设备代码」列且一致，0 冲突 |
| 6 | 台账是 EM 导出的，列名不一样还有标题行，能对上吗 | `sample-pump-fields.json` + `sample-alias-ledger.xlsx` | `--tag P-1101A --equip-type 泵 --ledger sample-alias-ledger.xlsx` | 可读；别名列头（设备位号/型号/生产厂家）识别正常并能取到台账现值（制造厂一致、型号 1 项冲突）；台账确实没有的「出厂编号」「制造日期」等列进 `unmapped`，**未硬塞进相近列** |
| 7 | 就这张铭牌照片，台账我没带 | `sample-pump-fields.json` | 不加 `--ledger` | `conflicts` 为 `null`，报告写「未提供台账文件，未做查重与比对——**这不代表台账中没有该位号**」 |
| 8 | （用户只说"帮我录一下这张铭牌"，没给位号） | 任意 fields.json | 不加 `--tag` | **报错终止**，`error` 提示位号须由用户提供，不得从照片或文件名推断 |
| 9 | 只知道 SAP 设备编号，台账里是哪台 | `sample-pump-fields.json` + `sample-sap-pm-ledger.xlsx` | `--tag <台账里 P-1101A 那行的「设备」值> --equip-type 泵 --ledger ...` | 按「设备编号」列命中并 warning 说明，`meta.ledgerTag` 带出功能位置 P-1101A，用户给的标识原样保留不改写 |

## 关键验证点

1. **识别值由模型读图产生、未经脚本验证**：报告顶部与末尾的声明行写明这一点；脚本不读图，只用模型同时抄录的 `raw` 做量级核对。
2. **raw 必填与量级校验**：泵、电机样例所有 clear/blurry 字段都带 `raw`，`counts.rawIssues` 为 0；容器样例「腐蚀裕量」故意漏抄 raw → warning + 建议录入行注明"未做量级校验"。把任一字段的 value 改成原文的 10 倍（如设计压力 4.0 → 40）重跑，该字段会被改判为部分模糊、建议录入值留空。
3. **三档置信度**：泵样例的「效率」「叶轮材质」为 blurry（`2Cr1▢` 保留占位符未补全），「汽蚀余量」「设计温度」为 unreadable（`value` 为 `null`），两类在报告中分节单列。
4. **位号不推断**：泵样例的 `photo` 字段是 `P-1101A铭牌-20260921.jpg`，出厂编号是 `DL-2019-XXXX`，脚本都不拿来当位号；出厂编号还会触发 warning「这是制造厂产品序号，不是位号」。
5. **位号与设备编号分列**：SAP 台账「功能位置」是位号、「设备」是 8 位流水号；按设备编号查时单独标注，不把设备编号写成位号。
6. **冲突不自动覆盖**（关键）：泵样例与台账的 3 项差异逐项列出识别值与台账现值，每项给出「识别错误 / 设备已更换」两种可能；出厂编号不一致时 hint 指向「可能已更换，核对是否走过变更流程」；这 3 项在 `intake.csv` 里建议录入值为空。
7. **单位只校验不换算**：电机样例额定功率铭牌印「马力」，输出中 `value` 仍是马力数值，`unitCheck.reference` 给出 kW 换算参考值。
8. **不补铭牌外参数**：三份样例的产出里都没有「投用日期」——铭牌上的是制造日期，脚本只写进「制造日期」列，绝不填进台账的投用日期；SAP「建造年份」同样不比对。
9. **台账只读**：运行前后台账文件字节不变（selftest 4.12 断言）。
10. **合计行与标题行**：主台账末行「合计」跳过并 warning；别名台账首行是标题、第三行才是表头，仍能正确识别。

## 再生样例

```bash
node scripts/make-sample.js --out examples            # 默认 seed=1
node scripts/make-sample.js --out examples --seed 7   # 数值与 SAP 设备编号变化，结论不变
```

## 逐例命令

```bash
cd <技能目录>
node scripts/intake.js --fields examples/sample-pump-fields.json   --tag P-1101A --equip-type 泵   --ledger examples/sample-equipment-ledger.xlsx --out /tmp/noi-pump
node scripts/intake.js --fields examples/sample-motor-fields.json  --tag M-1501  --equip-type 电机 --ledger examples/sample-equipment-ledger.xlsx --out /tmp/noi-motor
node scripts/intake.js --fields examples/sample-vessel-fields.json --tag V-1301  --equip-type 容器 --ledger examples/sample-equipment-ledger.xlsx --out /tmp/noi-vessel
node scripts/intake.js --fields examples/sample-pump-fields.json   --tag P-1101A --equip-type 泵   --ledger examples/sample-sap-pm-ledger.xlsx     --out /tmp/noi-sap
node scripts/intake.js --fields examples/sample-vessel-fields.json --tag V-1301  --equip-type 容器 --ledger examples/sample-sap-pm-ledger.xlsx     --out /tmp/noi-sap-vessel
node scripts/intake.js --fields examples/sample-pump-fields.json   --tag P-1101A --equip-type 泵   --ledger examples/sample-alias-ledger.xlsx     --out /tmp/noi-alias
node scripts/intake.js --fields examples/sample-pump-fields.json   --tag P-1101A --equip-type 泵                                                  --out /tmp/noi-noledger
```
