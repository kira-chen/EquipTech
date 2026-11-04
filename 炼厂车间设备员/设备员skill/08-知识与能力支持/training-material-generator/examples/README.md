# examples 回归测试数据

> 本目录仅开发包含有，发布包不含。由 `node scripts/make-sample.js --out examples` 再生。

## 示例问题 ↔ 附件对照表

| # | 示例问题 | 附件 | 运行参数 | 预期结果 |
|---|---|---|---|---|
| 1 | 给新员工做一套培训材料，8 学时 | `sample-equipment-list.xlsx` | `--ledger <附件> --audience 新员工 --duration 8` | 提纲为「设备认识 / 结构原理 / 安全注意事项 / 异常识别与上报」四模块，学时按权重分摊；**无资料，考题全部为原理概念题，一道数值题都没有** |
| 2 | 按我们的规程出 12 道题 | `sample-equipment-list.xlsx` + `sample-spec.md` | `--ledger <清单> --docs sample-spec.md --audience 在岗 --questions 12` | 8 道数值题全部带出处（文件 + 条款号 + 行号），题干中数值遮成 `＿＿`；讲义分「通用原理」「厂内规定」两节 |
| 3 | 出 200 道题 | `sample-equipment-list.xlsx` + `sample-spec.md` | 在案例 2 的参数上把 `--questions 12` 换成 `--questions 200`：`--ledger <清单> --docs sample-spec.md --audience 在岗 --questions 200` | **warning 说明只能出 35 道**（数值类 8、定性规定类 4、原理概念类 23），按 35 道出，md 中提示缺口，**未用编造的数值题凑数** |
| 4 | 资料里没写数值，还能出考核题吗 | `sample-equipment-list.xlsx` + `sample-spec-no-number.md` | `--ledger sample-equipment-list.xlsx --docs sample-spec-no-number.md --audience 在岗` | `clausesNumeric = 0`、`questionsNumeric = 0`；`noSourceTopics` 登记「无资料支撑」；**产出中无任何带单位的数值答案** |
| 5 | 我把整本资料给你，里面有开停车步骤 | `sample-equipment-list.xlsx` + `sample-spec-with-procedure.md` | `--ledger sample-equipment-list.xlsx --docs sample-spec-with-procedure.md --audience 在岗` | 「开车步骤」「停车步骤」条款被排除并 warning，`blockedTopics` 带规则号 F3；泵的数值条款照常可用 |
| 6 | 给转岗的人做材料 | `sample-equipment-list.xlsx` | `--ledger <附件> --audience 转岗` | 提纲首模块是「与原岗位的差异点」，第二模块「本车间特有设备」并列出位号；不出现新员工的「设备认识」模块 |
| 7 | 只出单选和判断 | `sample-equipment-list.xlsx` + `sample-spec.md` | 在案例 2 的参数上加 `--types "单选,判断"`：`--ledger <清单> --docs sample-spec.md --audience 在岗 --questions 12 --types "单选,判断"` | 全部题目为这两型；**单选干扰项全是定性表述，没有数值干扰项** |
| 8 | 清单里没填设备类型列 | `sample-no-type.xlsx` | `--ledger <附件> --audience 新员工` | 按名称推断；「循环水泵电机」归电机而非泵 |
| 9 | 清单是 SAP 里 IH08 导出来的 | `sample-sap-export.xlsx` | `--ledger <附件> --audience 新员工` | 功能位置 / 设备描述 / 对象类型 / 工厂区段列名直接可读，5 台；位号取功能位置，8 位「设备」流水号不出现在提纲里 |
| 10 | 休了半年病假回来的员工做复岗培训 | `sample-equipment-list.xlsx` | `--ledger <附件> --audience 复岗` | 提纲首模块「离岗期间的变化点」，含变更管理台账、未闭环的缺陷与隐患、修订的规程与系统（EM / SAP PM） |
| 11 | 新上了一台空压机，投用前给岗位做四新培训 | `sample-equipment-list.xlsx` + `sample-spec.md` | `--ledger <清单> --scope 压缩机 --docs sample-spec.md --audience 新设备投用` | 「新设备投用」归四新而不是新员工；清单按 `--scope` 过滤，只保留 K-1601 空压机 1 台，warning「保留 1 台，剔除 8 台」；提纲含「新设备 / 新材料的结构与特点」「投用前条件确认（PSSR）」 |
| 12 | 新员工三级安全教育车间级和班组级的设备部分 | `sample-equipment-list.xlsx` | `--ledger <附件> --audience 班组级安全教育` | 归三级安全教育；提纲首模块声明「厂级安全教育内容由公司安全环保部门归口，本材料不生成」，含车间级与班组级两个模块 |
| 13 | 判断题别全是"正确"，出几道错的 | `sample-equipment-list.xlsx` + `sample-spec.md` | 在案例 2 的参数上加 `--types 判断`：`--ledger <清单> --docs sample-spec.md --audience 在岗 --questions 12 --types 判断` | 判断题交替肯定式 / 否定式，否定式只改"不得→可以"这类情态词、**数值原样**，答案「错误」并给正确表述与出处；`--no-negative-judge` 可关闭 |

## 关键验证点

1. **无出处不出数值题**（案例 1、4）——本技能的命脉。编一个「轴承温度不得超过 75℃」比不给数值危险得多：没有数值，员工会去查规程；有一个错数值，员工会背下来照着用。selftest 用正则扫产出的答案表，出现任何带单位的数值而无出处即失败。
2. **数值题的出处要能追到条款**（案例 2）——出处写法是「文件名 第4.1条（第6行）」，审核人拿着这行就能翻到原文核对。
3. **题量不足不凑数**（案例 3）——warning 里写清可出题数与构成，缺口留给用户去补资料，不拿编造的题填。
4. **规程类内容不生成**（案例 5）——用户常把整本规程丢进来，开停车步骤那几章不能进讲义与考题，以厂内正式规程为准。
5. **培训对象决定深度**（案例 1、6）——新员工讲认识与上报，在岗讲故障与标准，转岗讲差异点。深度错了整套材料就白做。
6. **干扰项不能是数值**（案例 7）——把 75℃ 改成 85℃ 当干扰项，本身就是在编造数值。
7. **类型识别顺序**（案例 8）——「循环水泵电机」若被「泵」先命中，会套用泵的原理条目，漏掉绝缘、缺相这些电机专属考点。`TYPE_PATTERNS` 与 operator-anomaly-guide 同源。
8. **SAP 导出直接可读**（案例 9）——功能位置作位号，8 位设备流水号不当位号也不当名称。
9. **六类培训对象**（案例 10~12）——复岗讲变化点与当前状态，四新讲差异与投用前条件确认，三级安全教育只做车间级、班组级，厂级由公司安全环保部门归口；「新设备」「班组级」这类写法按顺序归类，不落到新员工。
10. **否定式判断题不改数值**（案例 13）——改写前后数字序列必须一致，否则退回肯定式；错误项靠改情态词构造，绝不靠改数值。
11. **内置原理条目要审**——原理题与讲义原理要点 `origin: builtin`，声明行点名须经车间技术人员审核，交付时报 `questionsBuiltinPrinciple`。

## 再生样例

```bash
node scripts/make-sample.js --out examples            # seed=1
node scripts/make-sample.js --out examples --seed 3   # 规程中的数值与区域变化
```

seed 改变时，规程样例里的力矩、温度、周期等数值与 SAP 样例的工厂区段会变，但**含数值条款数（8 条）、设备类型数、SAP 样例 5 台、可出数值题数不变**，预期结论一致。

## MCP 取数对照

平台接入业务系统 MCP 时不上传附件：设备资产管理 `get_equipment_ledger` 返回「设备台账.csv」，放进新建空目录作 `--ledger`；车间管理规定等资料来自平台知识库，放进另一个目录作 `--docs`。下表用演示知识库（动设备管理规定.md、静设备管理规定.docx、无数值说明.txt、压缩机说明书.pdf）实跑，预期结果为每天都稳定的结论。

| # | 示例问题 | MCP 调用 | 运行参数 | 预期结果 |
|---|---|---|---|---|
| M1 | 给常减压车间在岗人员做 4 学时设备培训，按车间管理规定出题 | 设备资产管理 `get_equipment_ledger`（workshop=常减压车间）；知识库资料目录 | `--ledger <台账目录> --docs <知识库目录> --audience 在岗 --workshop 常减压车间 --duration 4` | 8 类设备；资料抽出 18 条、可用 17 条、含数值 9 条；「4.6 进料泵切换步骤」被 F3 剔除；9 道数值题全部带出处（`.md 第4.1条（第4行）`、`.docx 第3.1条（第2段）`、`.docx（表1第2行）` 等），题干数值遮成 `＿＿`；压缩机说明书.pdf warning「本脚本不读 PDF…已跳过」；电机、通用、阀门、管道 4 类登记无资料支撑 |
| M2 | 加氢车间新员工 8 学时设备培训，没有规程 | 设备资产管理 `get_equipment_ledger`（workshop=加氢车间） | `--ledger <台账目录> --audience 新员工 --workshop 加氢车间 --duration 8` | `questionsNumeric = 0`，考题全部为原理概念题；8 类设备全部登记无资料支撑；R-5101 加氢精制反应器列在「塔器容器」下，反应加热炉与变送器归「通用」 |
| M3 | 常减压车间复岗培训 | 同 M1 | `--ledger <台账目录> --docs <知识库目录> --audience 复岗 --workshop 常减压车间` | 提纲四模块：离岗期间的变化点 / 本岗设备当前状态 / 规程与安全要求复训 / 复岗确认；首模块含变更管理台账与期间修订的规程与系统（EM / SAP PM）；数值题均带出处 |
