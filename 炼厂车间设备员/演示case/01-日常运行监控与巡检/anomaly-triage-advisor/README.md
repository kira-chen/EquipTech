# 设备异常初判与处置建议（anomaly-triage-advisor）· 演示与回归样例

> 本目录仅开发包含有，发布包不含。由 `node scripts/make-sample.js` 再生（默认 seed=1）。
> 参数数值随 seed 抖动，但每份样例的预期结论（候选原因数、未判定数、关注度档位）不变。

## 样例文件

| 文件 | 内容 | 列名风格 |
|---|---|---|
| `sample-params-pump.xlsx` | P-2101A 离心泵运行参数 5 项（轴承温度、频谱备注、流量、入口压力、电流）+ 1 行他机数据 | 车间手工点检表（位号/参数名/参数值/基准值/单位/备注） |
| `sample-history-pump.xlsx` | P-2101A 历史故障 2 条（含「联轴器不对中」）+ 1 条他机 | 车间台账（故障日期/故障现象/故障原因/处理措施） |
| `sample-limits-pump.xlsx` | 限值表：上限/下限/偏差阈值% 按位号+参数名给 | 厂内限值表 |
| `sample-params-dcs.xlsx` | DCS/EM 导出：带单位数值、高报/低报列 | 功能位置/技术对象描述/测点号/测量值/高报/低报 |
| `sample-history-sap.xlsx` | SAP PM 维修通知单导出 3 条 | 通知单/通知类型/功能位置/设备（8 位流水号）/损坏代码/原因文本 |
| `sample-params-psv.xlsx` | PSV-3102 安全阀，只有系统压力一项（含上限） | 车间手工表 |
| `sample-params-compressor.xlsx` | K-3101 循环氢压缩机出口流量、一级压差、轴瓦温度 | 车间手工表 |
| `sample-params-sparse.xlsx` | 只有 1 行且基准值为空 | 车间手工表 |
| `sample-params-badnum.xlsx` | 标题行 + 别名列头 + 参数值为文字「偏高」+ 合计行 | 某装置导出 |

## 示例问题 ↔ 附件对照表

运行参数统一省略 `--out`（实际使用请始终传 `--out`）。

| # | 示例问题 | 附件 | 运行参数 | 预期结果 |
|---|---|---|---|---|
| 1 | P-2101A 这泵振动比平时大，还有点异响，怎么回事，要不要报工程师 | `sample-params-pump.xlsx` + `sample-history-pump.xlsx` | `--symptom "泵振动比平时大，靠近听有异响" --equip-type 离心泵 --tag P-2101A --params <参数> --history <历史> --sudden 否 --affects-run 否` | 候选 10 项（有依据 3、推测 7）、未判定 2 项、核实项 31 条；4 项参数因无偏差阈值不判趋势（warning 4 条，`paramsNoThreshold:4`）；关注度黄 |
| 2 | 同上，把厂里的限值表也给你，历史记录是 SAP 导出的通知单 | `sample-params-pump.xlsx` + `sample-limits-pump.xlsx` + `sample-history-sap.xlsx` | 例 1 参数加 `--limits <限值表>`，`--history` 换 SAP 文件 | 候选 10 项（有依据 5、推测 5）、未判定 1 项；`paramsTrended:4`、`limits:4`，无 warning；历史 2 条带通知单号与损坏代码；轴承温度按上限 70 判「升高」；关注度黄 |
| 3 | 只有现象描述，什么数据都没有 | 无附件 | `--symptom "泵振动比平时大" --equip-type 离心泵 --tag P-2101A` | 候选 8 项**全部未判定**，关注度未判定（未给突发/影响运行）；候选一条不少 |
| 4 | 参数表基准值是空的，还能初判吗 | `sample-params-sparse.xlsx` | `--symptom "泵振动大" --equip-type 离心泵 --tag P-2101A --params <附件>` | 参数读到 1 行但无基准 → 不判趋势；候选 8 项全部未判定；需补 9 项数据 |
| 5 | 参数表里温度那栏填的是「偏高」两个字 | `sample-params-badnum.xlsx` | `--symptom "泵振动大" --equip-type 离心泵 --tag P-2101A --params <附件> --sudden 否 --affects-run 否` | warning 提示无法解析为数字；`value:null`、`trend:null`，**不按 0 也不臆断为「升高」**；合计行跳过；关注度黄 |
| 6 | 这是 DCS 导出的，数值带单位，有高报低报列 | `sample-params-dcs.xlsx` | `--symptom "泵振动大，轴承温度高" --equip-type 离心泵 --tag P-2101A --params <附件> --sudden 否 --affects-run 否` | 单位自动剥离并各列提示一次；4 项参数按行内高报/低报判趋势（`paramsTrended:4`）；候选 12 项（有依据 7）、未判定 2；关注度黄 |
| 7 | K-3101 循环氢压缩机出力上不去 | `sample-params-compressor.xlsx` | `--symptom "压缩机出力下降，流量上不去" --equip-type 离心压缩机 --tag K-3101 --params <附件> --sudden 否 --affects-run 是` | 切到机组类口径表，候选 3 项（CF1~CF3）、未判定 1；3 项参数无阈值不判趋势；关注度橙 |
| 8 | 特护机组突然振动大 | 无附件 | `--symptom "压缩机振动大" --equip-type 离心压缩机 --tag K-3101 --special 是 --sudden 是 --affects-run 是` | 关注度强制**红**（RK0），warning 含「【注意】已标记为特护设备」，上报建议含公司设备管理部门 |
| 9 | PSV-3102 安全阀出口侧有介质泄漏 | `sample-params-psv.xlsx` | `--symptom "安全阀出口侧有介质泄漏" --equip-type 安全阀 --tag PSV-3102 --params <附件> --sudden 否 --affects-run 否` | 安全阀单列类型（不并入静设备），候选 4 项（VL1~VL4）、未判定 2；系统压力按行内上限判趋势（`paramsTrended:1`）；泄漏现象关注度橙（RK4）；校验与整定结论以校验报告为准 |
| 10 | 这台胶带输送机振动大 | 无附件 | `--symptom "运行时振动大" --equip-type 胶带输送机 --tag BC-01` | `covered:false`，**只给 G1~G4 通用框架**，warning 提示该类型不覆盖 |

## 关键验证点

1. **缺数据不排除原因（最核心）**：例 3、例 4 中全部候选原因都判未判定，但 `candidates` 里一条不少——汽蚀、不对中、转子弯曲、基础松动都还在。未判定只说明「无法评估可能性」，**不等于已排除**。
2. **偏差阈值不写死**：例 1 无限值表、无 `--dev-pct`，4 项参数有实测有基准也**不判升高/偏低**，warning 写明「未按固定百分比默认」；例 2 给了限值表后同样的数据判出 4 项趋势。阈值来源记在 `params[].thresholdSource`。
3. **不给确定性结论**：例 2 中轴承损伤排第一且有两条支持依据（高频频谱 + 轴承温升），可能性仍只写「较高（**需核实**）」，`needVerify` 恒为 `true`。
4. **反证只降权不删除**：例 2 中高频频谱构成「联轴器不对中」的反证，该原因可能性降到「较低」但**仍在候选表内**，对中复测仍在核实项里。
5. **无依据的推测要标注**：无支持依据的原因标 `evidenceLevel:"speculative"`，md 里显示「**推测，待核实**」，不与有依据的原因混同。
6. **数值不可解析不按 0**：例 5 中「偏高」两字 → `value:null`、`trend:null` + warning，**不折算成 0，也不因为字面像「偏高」就判为轴承温升**。
7. **系统列名直接读**：例 6 的「功能位置/技术对象描述/测点号/测量值/高报/低报」与例 2 的「通知单/损坏代码/原因文本」无需改列名；SAP「设备」列（8 位流水号）不当位号，只展示。
8. **类型不覆盖只给框架**：例 10 中绝不出现「汽蚀」「不对中」等泵类原因，只有 G1~G4 四条通用框架项，项名带「通用框架：」前缀。
9. **关注度不做默认、用红/橙/黄**：例 3、例 4 未给「是否突发」「是否影响运行」→ 关注度 `undetermined`，**既不从宽也不从严**；例 8 特护设备强制红；报告关注度不写成字母档（与设备重要度 A/B/C 撞名）。
10. **历史只提示不锁结论**：例 1 的历史记录里 2025-11-12 确认原因是「联轴器不对中」，生成历史提示，但**候选排序与不带 `--history` 时完全一致**。
11. **专业结论不代判**：报告第三节固定声明「频谱、油液分析、无损检测的结论一律由诊断或检测人员出具」；第四节固定声明「不给出是否停机、是否降负荷、是否抢修的意见」；确认为缺陷只提示在 SAP 创建维修通知单。
12. **声明行不可缺**：`triage.md` 开头与结尾各有一处「本结论为初判辅助，由脚本汇总、模型成文，不替代专业诊断与停机决策，须由设备工程师或车间设备主任复核；厂内制度与系统数据为准」。

## 再生样例

```bash
node scripts/make-sample.js            # seed=1
node scripts/make-sample.js --seed 7   # 参数数值、记录人变化
```

seed 变化时轴承温度、流量等数值会抖动，但**结论不变**：例 2 恒为 10 项候选、1 项未判定、关注度黄；例 3 恒为 8 项全未判定。

## MCP 取数对照

平台接入业务系统 MCP 时不用附件：按 SKILL.md「数据获取（MCP）」调用工具，每个工具的 csv 放进各自的空目录（下表 A/B/C）。演示数据每天按剧本刷新，预期结果只列每天稳定的结论。

| # | 示例问题 | MCP 调用 | 运行参数 | 预期结果 |
|---|---|---|---|---|
| M1 | P-2101A 振动比平时大、轴承箱有异响，要不要报工程师 | DCS位号数据 `get_tag_history`（tag=P-2101A，for_skill=anomaly-triage-advisor）→ A；`get_tag_limits`（tag=P-2101A）→ B；设备资产管理 `get_failure_history`（tag=P-2101A，for_skill=anomaly-triage-advisor）→ C | `--symptom "振动比平时大，轴承箱有异响" --equip-type 离心泵 --tag P-2101A --params A --limits B --history C --sudden 否 --affects-run 否` | 泵类口径；首位候选「滚动轴承损伤」可能性 high（频谱备注含高频冲击 + 轴承温升）；驱动端振动、轴承温度按 DCS 高报判「升高」，其余参数正常；带出历史故障记录；关注度黄（RK5），无 warning |
| M2 | E-1201 怀疑管束内漏，渐变，影响运行 | DCS位号数据 `get_tag_history`（tag=E-1201，for_skill=anomaly-triage-advisor）→ A；`get_tag_limits`（tag=E-1201）→ B；设备资产管理 `get_failure_history`（tag=E-1201，for_skill=anomaly-triage-advisor）→ C | `--symptom "怀疑管束内漏" --equip-type 换热器 --tag E-1201 --params A --limits B --history C --sudden 否 --affects-run 是` | 静设备口径；「内漏」同时命中泄漏与性能两类，性能类只因内漏触发，换热器只补 SF2，候选 5 项：SF2「内漏（管束穿孔或内件损坏）」与泄漏类 SL1~SL4；壳程/管程出口温度按高报判正常；关注度橙（RK3） |
| M3 | M-2105A 特护电机温度偏高，DCS 无测点，用巡检记录 | 点检巡检App `get_inspection_records`（tag=M-2105A，for_skill=anomaly-triage-advisor）→ A；设备资产管理 `get_failure_history`（tag=M-2105A，for_skill=anomaly-triage-advisor）→ C | `--symptom "电机温度偏高" --equip-type 电机 --tag M-2105A --params A --history C --special 是 --sudden 否 --affects-run 否` | 电仪类口径，候选 ET1~ET4；巡检记录无测值与基准，4 项全部未判定但一条不少；关注度强制红（RK0），warning 含「【注意】已标记为特护设备」，上报建议含公司设备管理部门 |
