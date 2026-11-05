---
name: equipment-weekly-monthly-report
description: 车间设备周报与月报生成（中石化体系炼化厂车间设备员口径）。当用户提到"设备周报""设备月报""这个月设备情况""上月设备指标""设备完好率算一下""检修计划完成率""密封点泄漏率""周报月报指标表"并提供多日 daily.json、区间台账（设备台账/故障记录/检修计划/工单或订单清单/缺陷或通知单/备件消耗/特护设备/备机/密封点统计/停工记录）时使用；按中石化指标集计算设备完好率、主要设备完好率、备机完好率、静/动密封点泄漏率、检修计划完成率（大检修/日常维修分列）、工单及时率、故障停机次数与时长、非计划停工次数，输出周报或月报、指标表与数据缺口。单日用 equipment-daily-report；会议汇报稿用 meeting-material-builder；泄漏点逐点跟踪用 leak-point-tracker；公司级考核口径以公司设备管理部门发布为准。
allowed-tools: Read,Write,Bash
agent_created: true
metadata:
  version: 0.2.0
  author: calvin
  tags: [refinery, equipment, report]
---

# 设备周报月报（equipment-weekly-monthly-report）

面向中石化体系炼化厂车间（运行部）设备员，把区间内的设备数据汇总成周报或月报，含中石化常用指标集与重点事项，报送车间设备主任与分厂/公司设备管理部门。**所有指标由脚本计算，模型只负责撰写分析；指标口径以厂内为准，未提供口径表时报告必须注明采用默认口径。**

## 适用条件
- 用户说"出设备周报 / 设备月报 / 这个月设备指标 / 完好率和泄漏率算一下 / 检修计划完成率"，并给出（或即将给出）区间内的设备数据或多份日报 JSON。
- 支持周报、月报（季报与年报可用 `--period` 指定，但指标口径需用户确认）。
- 车间设备员可做：区间内台账与记录的汇总、指标初算、重点事项提取、数据缺口说明。**不做**：公司级考核口径的裁定（以公司设备管理部门发布口径为准）、非计划停工事件的定性（按《炼化企业非计划停工管理规定》另行报送）、泄漏率考核线的判定（以厂内指标为准，脚本不比对）、跨车间排名。
- 不适用：单日日报（用 equipment-daily-report）；会议汇报稿排版（用 meeting-material-builder）；泄漏点逐点跟踪与修复率（用 leak-point-tracker）。

## 前提条件
- 输入：多份 `daily.json`（来自 equipment-daily-report，含 `special` 节可汇总特护设备）、`leaks.json`（来自 leak-point-tracker，含 `sealPoints` 时可算泄漏率），或区间内的 `.xlsx` 原始数据：设备台账（须含「在用」列，可含「重要度/ABC标识」列）、故障记录、检修计划（可含「检修类别」列）、工单台账/订单清单、缺陷台账/通知单清单、备件消耗、特护设备、备机、密封点统计、停工记录。列名支持 SAP PM / EM 导出常见列名（功能位置、设备描述、ABC标识、订单、系统状态、基本结束日期、实际结束日期、主工作中心、通知单、通知单描述……），「设备编号」不作位号。表名含「设备台账」或「技术对象」即按设备台账读取（如「二作业部设备台账」）；特种设备台账、润滑台账、巡检台账，以及「压力容器设备台账」「安全阀设备台账」「检修设备台账」「密封设备台账」这类「专项名 + 设备台账」的表，不当作全车间设备台账。
- 必填信息：车间名称、报告周期与起止日期。可选：厂内指标口径表（`--metrics`，可带「分母 / 剔除封存」结构化列）、`--intact-denominator 在用|在册`、`--sealed 剔除|计入`、上期 periodic.json（环比）、同期 periodic.json（同比）。
- 环境：可执行 Node.js ≥ 18，脚本仅用内置模块，无需 npm 安装。**若环境无法执行 node（无 Bash 工具或 `node --version` 失败），明确告知用户并终止，不得手工计算任何指标。**

## 数据获取（MCP）

平台接入了业务系统 MCP 服务时，按下表调用工具取数，不再请用户上传导出文件；未接入时按操作步骤请用户提供系统导出文件。工具全部只读，不在业务系统里创建或修改任何单据。

| 服务 | 工具 | 参数 | 交给脚本 |
|---|---|---|---|
| 设备资产管理 | `get_equipment_ledger` | `workshop`：车间名 | `--input` |
| 设备资产管理 | `get_failure_history` | `workshop`：车间名；`start_date`：统计期起始日，与 --from 相同；`for_skill=equipment-weekly-monthly-report` | `--input` |
| 设备资产管理 | `get_work_orders` | `workshop`：车间名；`for_skill=equipment-weekly-monthly-report` | `--input` |
| 设备资产管理 | `get_notifications` | `workshop`：车间名；`for_skill=equipment-weekly-monthly-report` | `--input` |

取数后：

1. 工具返回下载链接（60 分钟内有效，过期重新调用）。csv 按原文件名放进新建的空目录，不改文件名，不与其他技能的文件混放；把目录作为“交给脚本”一列的参数值。
2. 四个工具都要填 `workshop`：脚本只在输入带车间列时按 `--workshop` 核对（剔除其他车间的行；车间列全不一致时不筛并在报告开头提示）；MCP 导出多数不带车间列，取数时仍必须带 `workshop`，不填会把别的车间的设备和单据算进本车间的完好率、及时率。
3. `get_work_orders`、`get_notifications`：输出表名为「工单台账」「缺陷台账」；**不填 `start_date`**，默认返回近 12 个月及全部未关闭的单据。工具按创建/发现日期筛选，填了起始日会漏掉统计期之前创建、要求完成日期落在统计期内的工单（工单及时率分母变小），以及统计期之前发现、至今未闭环的缺陷。
4. 备机完好率、密封点泄漏率、非计划停工、特护设备没有对应的直接导出，报告写「未提供」；需要时先跑 `standby-rotation-reminder`、`leak-point-tracker` 或逐日 `equipment-daily-report`，把产出 JSON 一并传给 `--input`。

## 操作步骤
1. **确认周期与指标口径** —— 车间、周期类型、起止日期；询问是否有厂内指标口径表。未提供口径表时使用 `references/metrics-rules.md` 的默认算法，并必须在报告中注明"采用默认口径，非厂内正式口径"。**口径表命中但算法与默认不一致、又没有结构化口径参数时，该指标不出数并标"需按厂内口径复算"，不得只换文字沿用默认算法结果。**
2. **运行脚本** —— 技能目录以平台实际加载路径为准（Windows 路径加双引号）：
   ```bash
   node "<技能目录绝对路径>/scripts/periodic.js" --input "<路径>[,<路径2>...]" --workshop "<车间名>" --period <weekly|monthly> --from <YYYY-MM-DD> --to <YYYY-MM-DD> --out "<输入同目录>/设备周月报"
   ```
   可选：`--metrics "<指标口径表xlsx>"`、`--intact-denominator <在用|在册>`、`--sealed <剔除|计入>`、`--prev "<上期 periodic.json>"`、`--yoy "<同期 periodic.json>"`、`--spare "<备件消耗xlsx>"`、`--topn <n>`。建议始终传 `--out`，否则写到系统临时目录。
   读取末行 JSON 摘要（同时写入 `<out>/summary.json`）：`ok` 必须为 `true`，`ok:false` 时把 `error` 告知用户并终止；`warnings` 非空时逐条告知用户（日报缺失天数/台账缺「在用」列/重要度无法归类/检修类别无法归类/口径表无法解析/区间与周期不匹配等）。脚本用法详见 `scripts/README.md`。
   - 区间内有缺失日期：warning 列出缺失日期，指标注明"基于 N 天数据（应为 M 天）"，**绝不按已有天数平均后外推补齐**。
   - 设备台账缺「在用」列：设备完好率输出 null（显示 —）并说明原因，**不得按在册台数算**；只有用户明确给 `--intact-denominator 在册` 才按在册计算。
   - 未提供某类表（备机、密封点统计、停工记录、特护设备）：对应指标写"未提供"，不估算。
   - 车间范围：表格带「车间 / 所属车间 / 属地车间 / 运行部」列时，剔除其他车间的行并 warning，口径写在报告开头「车间范围：」一行（`meta.workshopScope`）；车间列全不一致时不筛，报告开头有【注意】，多半是传错了文件，须向用户确认。「维护工厂」不当车间列。daily.json / leaks.json / rotation.json 与 `--prev`、`--yoy` 的 `meta.workshop` 与 `--workshop` 不一致时不纳入并 warning（`meta.upstreamWorkshop`），未注明车间的照常纳入并注明无法核对。
   - 历史区间（`--to` 早于今天）：缺陷台账的期末未闭环按发现时间、闭环时间回推到 `--to`（`--to` 之后发现的不计，`--to` 之后才闭环的仍算未闭环），`defects.foundAfterTo` 给出被排除条数；待验收没有状态变更日期，按当前状态计，`defects.asOfNote` 注明。设备完好率、主要设备完好率来自台账当前状态，`metrics.intactSnapshotNote` 注明不是 `--to` 时点；环比、同比基准期报告若生成日晚于其期末，`compare.*.snapshotNote` 注明基准期完好率是生成时的快照。向用户交付时转述这几条说明。
3. **读取 periodic.json** —— 从 `<输出目录>/periodic.json` 获取：`metrics`（完好率、主要设备完好率、备机完好率、静/动密封点泄漏率、检修计划完成率及分列、工单及时率、MTTR、故障停机时长与次数、非计划停工次数、`modes` 各指标计算方式）、`failures`、`maintenance`（含 `byCategory`）、`orders`、`defects`、`spare`、`special`、`standby`、`seal`、`leakPoints`、`shutdown`、`highlights`（超期工单带 `no` / `tag` / `unit`，责任方写工作中心）、`compare`、`dataGaps`（`missingDates` / `noDenominator` / `notProvided` / `recompute`）、`counts`。
4. **撰写"设备管理分析"** —— 读 `references/metrics-rules.md` 的表述口径，撰写 400~600 字，按"总体评价 → 关键指标与环比同比 → 特护设备与故障分布 → 检修计划执行（大检修/日常维修分述） → 工单与缺陷 → 备件消耗 → 存在问题 → 下期重点"结构，替换 `periodic.md` 中 `<!-- ANALYSIS_START -->` 与 `<!-- ANALYSIS_END -->` 之间的占位文字。**所有指标引用 periodic.json；指标变化的原因只在数据支持时陈述，否则写"原因待分析"；分母缺失或需复算的指标写"未计算"。**
5. **交付前自检** —— 对照 `references/checklist.md` 逐项检查；通过后交付 `periodic.md`、`periodic.json` 与 `指标表.xlsx`。用户要求 Word 时按平台能力转换，**不得手写 docx XML**。

## 预期结果
- `periodic.md`：设备周报或月报，共十二节：一、总体概况；二、关键指标（含分母缺失、未提供、需复算三类说明）；三、特护设备运行状况；四、故障统计（含停工记录）；五、检修计划执行（大检修/日常维修/抢修/专项分列，未判定项单列）；六、工单与缺陷（待验收单列，不计闭环）；七、备件消耗；八、重点事项；九、环比与同比；十、数据缺口；十一、设备管理分析；十二、下期重点。末尾带通用声明行。
- `指标表.xlsx`（指标表 / 故障统计 / 数据缺口三个工作表）与 `periodic.json`；`summary.json`：脚本末行摘要（含 `sections` 节数与 `recompute`）。
- 交付时向用户说明：统计区间与实际覆盖天数、采用的指标口径来源与各指标计算方式、需按厂内口径复算的指标、数据缺口、脚本 warnings（如有）。

## 不适用范围
- 不替代公司设备管理部门发布的考核口径与数据。
- 不做跨车间对比与排名；不做设备管理水平的评价与考核结论。
- 不预测下期指标；不判定非计划停工事件等级；不比对泄漏率考核线。
- 不做泄漏点逐点跟踪（leak-point-tracker）、不做单日日报（equipment-daily-report）。

## 参考资料（按需读取，路径相对技能根目录）
| 文件 | 内容 | 何时读取 |
|---|---|---|
| `references/input-spec.md` | 日报 JSON 与原始表字段定义、SAP PM/EM 列名别名、区间与周期匹配规则 | 检查输入 / 用户询问格式时 |
| `references/metrics-rules.md` | 中石化指标集默认算法、厂内口径表与结构化参数、口径标注要求、分析表述规范、制度引用 | 运行脚本前 / 撰写分析段前 |
| `references/checklist.md` | 交付自检清单（含口径标注与复算核对） | 交付前 |
| `scripts/README.md` | 脚本参数与产出说明 | 运行脚本前 |
| `scripts/selftest.js` | 自测：覆盖缺失日期、在用口径、口径表复算、泄漏率、备机、停工、分级完成率、SAP 列名等边界用例（仅开发包含有，发布包不含） | 修改脚本后（开发包）；文件不存在则跳过 |
| `assets/templates/periodic-template.md` | 周月报模板（{{占位符}}） | 用户要求调整版式时 |
| `references/sample-output.md` | 风格示范产出（数字均为虚构） | 拿不准报告风格时 |
| `examples/`（仅开发包；仓库内在 `演示case/06-报表与沟通/equipment-weekly-monthly-report/`） | 回归测试数据，发布包不含 | 目录不存在则跳过 |
