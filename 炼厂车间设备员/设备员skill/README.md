# 设备员 skill · 车间设备员数字员工技能包

面向**中石化体系炼化厂车间（运行部）设备员**岗位的 ReAct 数字员工技能集，8 大类 50 个技能。不绑定具体企业，厂与厂之间有差异的口径通过 `--rules`/`--spec` 等参数接厂内口径。

**口径与改造文件**：`../文档/规范/中石化口径对照.md`（术语、系统列名、分级、层级、指标、制度引用的唯一依据）、`../文档/过程记录/核验报告-2026-10-26.md`（问题清单）、`../文档/过程记录/改造任务书-2026-10-26.md`（改造执行说明与断点续做规则）。目录结构为「设备员skill / 二级分类 / 技能英文名 / SKILL.md」。

> **当前状态（2026-10-27）：50 / 50 个技能全部完成中石化口径改造（第二轮），合计 9407 条 selftest 断言全绿，每个技能目录含上架信息.md 与样例问题.md。**
>
> 每个技能含：SKILL.md + Node 主脚本 + make-sample + selftest + references + examples 对照表 + 模板。
> 全部遵守 `../文档/规范/技能实现规范.md` 的九条硬约束，仅用 Node.js 内置模块，无 npm 依赖。


## 为什么选车间设备员

| 层级 | 岗位 | 千万吨级厂人数 | AI 可替代性 |
|---|---|---|---|
| 决策层 | 设备部部长、总工 | 3~6 | 低（只需结论式报表） |
| 厂级管理 | 设备工程师、计划员、特种设备管理员 | 30~60 | 中（判断为主，AI 做辅助） |
| **车间管理** | **车间设备主任、车间设备员** | **60~150** | **高（六七成时间是信息整合）** |
| 执行层 | 维修工、点检员、检修公司工人 | 500~1000+ | 低（体力与现场感知） |

车间设备员是设备管理的信息中枢：收巡检数据、写台账、填报修单、跟检修进度、编日报周报、应对检查。这些是典型的信息搬运与整合工作，场景高度重复且跨车间可复用，是 ReAct 智能体最能落地的一层。

## 8 大类 50 个技能总览

| 二级目录 | 技能数 | 覆盖环节 |
|---|---|---|
| [01 日常运行监控与巡检](01-日常运行监控与巡检/) | 8 | 派任务、收数据、看趋势、判异常、润滑、运行时长、备机切换 |
| [02 缺陷报修与检修管理](02-缺陷报修与检修管理/) | 12 | 缺陷登记到检修闭环归档的完整链条 |
| [03 承包商与作业现场管理](03-承包商与作业现场管理/) | 4 | 资质核验、现场监督、交叉作业、表现记录 |
| [04 台账档案与资料管理](04-台账档案与资料管理/) | 6 | 台账查询、资料检索、变更管理、法定台账 |
| [05 备品备件与物资](05-备品备件与物资/) | 3 | 需求提报、库存查询、消耗分析 |
| [06 报表与沟通](06-报表与沟通/) | 7 | 日报周报、交接班、迎检、自查表、汇报稿、通报 |
| [07 隐患事故与合规](07-隐患事故与合规/) | 5 | 隐患闭环、故障调查、案例检索、合规自查、安全设施 |
| [08 知识与能力支持](08-知识与能力支持/) | 5 | 知识问答、培训材料、操作工指引、能效分析、待办管理 |

各类的技能明细表、数据流与边界说明见各二级目录下的 `README.md`。

## 实现进度

全部 50 个技能按 `../文档/规范/技能实现规范.md` 建设，逐一通过三步验证（样例再生 / 自测全绿 / 真实参数跑通），合计 **9407 条断言**。

| 技能 | 分类 | 断言 |
|---|---|---|
| `anomaly-triage-advisor` | 01 | ✅ 276 条 |
| `inspection-data-digest` | 01 | ✅ 115 条 |
| `inspection-task-dispatch` | 01 | ✅ 212 条 |
| `leak-point-tracker` | 01 | ✅ 253 条 |
| `lubrication-manager` | 01 | ✅ 198 条 |
| `parameter-trend-alert` | 01 | ✅ 247 条 |
| `runtime-hours-tracker` | 01 | ✅ 156 条 |
| `standby-rotation-reminder` | 01 | ✅ 227 条 |
| `completion-acceptance` | 02 | ✅ 199 条 |
| `defect-intake-grading` | 02 | ✅ 146 条 |
| `equipment-handover-check` | 02 | ✅ 199 条 |
| `maintenance-demand-rollup` | 02 | ✅ 195 条 |
| `maintenance-record-archive` | 02 | ✅ 132 条 |
| `overhaul-process-check-bridge` | 02 | ✅ 138 条 |
| `permit-precheck-bridge` | 02 | ✅ 130 条 |
| `repair-plan-assistant` | 02 | ✅ 285 条 |
| `repeat-failure-detector` | 02 | ✅ 218 条 |
| `turnaround-workshop-tracker` | 02 | ✅ 323 条 |
| `work-order-generator` | 02 | ✅ 203 条 |
| `work-order-tracker` | 02 | ✅ 184 条 |
| `contractor-performance-log` | 03 | ✅ 198 条 |
| `contractor-qualification-check` | 03 | ✅ 181 条 |
| `cross-operation-conflict` | 03 | ✅ 206 条 |
| `site-supervision-points` | 03 | ✅ 203 条 |
| `equipment-ledger-query` | 04 | ✅ 119 条 |
| `moc-change-assistant` | 04 | ✅ 293 条 |
| `nameplate-ocr-intake` | 04 | ✅ 191 条 |
| `special-equipment-inspection-due` | 04 | ✅ 155 条 |
| `technical-document-finder` | 04 | ✅ 144 条 |
| `valve-instrument-calibration-ledger` | 04 | ✅ 138 条 |
| `spare-parts-consumption-analysis` | 05 | ✅ 112 条 |
| `spare-parts-demand` | 05 | ✅ 181 条 |
| `spare-parts-inventory-query` | 05 | ✅ 118 条 |
| `equipment-daily-report` | 06 | ✅ 158 条 |
| `equipment-event-notice` | 06 | ✅ 172 条 |
| `equipment-weekly-monthly-report` | 06 | ✅ 270 条 |
| `inspection-evidence-package` | 06 | ✅ 139 条 |
| `meeting-material-builder` | 06 | ✅ 118 条 |
| `self-audit-form-filler` | 06 | ✅ 212 条 |
| `shift-handover-record` | 06 | ✅ 124 条 |
| `failure-case-retrieval` | 07 | ✅ 166 条 |
| `failure-investigation-assistant` | 07 | ✅ 306 条 |
| `hazard-closure-tracker` | 07 | ✅ 151 条 |
| `regulation-compliance-check` | 07 | ✅ 180 条 |
| `safety-environmental-device-check` | 07 | ✅ 190 条 |
| `equipment-energy-analysis` | 08 | ✅ 215 条 |
| `equipment-knowledge-qa` | 08 | ✅ 217 条 |
| `operator-anomaly-guide` | 08 | ✅ 126 条 |
| `training-material-generator` | 08 | ✅ 215 条 |
| `worklog-todo-manager` | 08 | ✅ 173 条 |

### 验证方式

```bash
cd <二级目录>/<技能目录>
node scripts/make-sample.js --out examples   # 再生样例
node scripts/selftest.js                     # 断言全绿
node scripts/<主脚本>.js <参数>               # 真实跑一次
```

### 已验证的端到端链路

```
巡检任务下发 → 巡检数据汇总 ─┐
缺陷登记 ──────────────────┼→ 设备日报 → 周报月报 → 会议材料
工单跟踪 ──────────────────┘     ↓
                            待办汇集
```

六步链路实测通过，下游技能按特征字段自动识别上游 JSON 来源类型，无需用户指明。


## 与 skill-pack 已有 6 个技能的关系

| 已有技能 | 关系 |
|---|---|
| `work-permit-precheck` | **被复用**。`permit-precheck-bridge` 调用它，不重复实现 GB 30871 规则引擎。 |
| `overhaul-safety-check` | **被复用**。`overhaul-process-check-bridge` 调用它，不重复实现 70 条规则。 |
| `unit-daily-report` | **并行不重叠**。工艺口径装置日报 vs 设备口径 `equipment-daily-report`。 |
| `incident-flash-report` | **并行不重叠**。法定事故快报 vs 内部通报 `equipment-event-notice`。 |
| `energy-weekly-report` | **并行不重叠**。装置综合能耗 vs 单机能效 `equipment-energy-analysis`。 |
| `emission-daily-check` | **并行不重叠**。排放浓度日检 vs 泄漏点跟踪 `leak-point-tracker`。 |

安装 bridge 技能时必须同时安装被依赖技能，否则 bridge 须终止并告知用户，不得降级为自行判断。

## 共享数据约定

50 个技能必须共享同一份设备台账与工单数据，否则各技能各自维护会很快失去一致性。主要的 JSON 流转关系：

```
inspection-task-dispatch  → tasks.json
inspection-data-digest    → status.json   →  equipment-daily-report
defect-intake-grading     → defects.json  →  work-order-generator
work-order-generator      → workorders.json → work-order-tracker
work-order-tracker        → orders.json   →  equipment-daily-report
equipment-daily-report    → daily.json    →  equipment-weekly-monthly-report
hazard-closure-tracker    → hazard.json   ┐
special-equipment-...-due → inspection.json ├→ worklog-todo-manager（待办总出口）
valve-instrument-...      → calibration.json ┘
```

## 贯穿 50 个技能的六条硬约束

摘自 `skill-pack-local/技能工程规范.md`，本技能包全部遵守：

1. **脚本出数，模型成文。** 所有数字、判定、计数由 Node 脚本计算，模型只做解读与撰写，不得自行统计或估算。
2. **node 不可用则终止。** 环境无法执行 node 时明确告知用户并终止，不得手工估算或判定。
3. **缺数据不静默补齐。** 无法解析的数值输出 null 显示"—"，绝不按 0 计；缺表缺列写"未提供 XX 数据"，不得用推算值填充。
4. **未判定单列一节。** 判定条件依赖的字段为空时输出 `undetermined` 并单列说明，不得按最宽松或最严格默认处理。
5. **声明行不得删改。** 涉及安全、合规、法定事项的技能，报告中的声明行与醒目提示由模型保留原文，不得删除、弱化或改写。
6. **不越界。** 辅助判断不替代审批、定性、准入、验收与签字；各技能 SKILL.md 的「不适用范围」是硬边界。

## 共享代码库

50 个技能共用两个零依赖库，位于各技能的 `scripts/lib/`（两个 bridge 技能不读表，不带 xlsx-lite）：

| 文件 | 来源 | 提供 |
|---|---|---|
| `xlsx-lite.js` | 复制自 `unit-daily-report` | `readXlsx` / `writeXlsx` / `readCsvDir`，含日期样式与墙钟修复、GBK CSV 回退 |
| `common.js` | 本技能包新建 | 参数解析、北京时间、数值与日期归一、周期解析、表头识别、系统列名别名、SAP 状态映射、巡检结果归一、Markdown 表格、成功/失败输出 |

`common.js` 的关键函数（2026-10-26 升级后）：

```js
parseArgs(argv, VALUE_OPTS, FLAG_OPTS)   // 缺值/未知参数抛错
parsePeriod('每班')  // → 1/3 天（每班按 8 小时）；支持 每N小时/每天/每周/每月/每季/半年/一周/两年；无法解析 → null
parsePeriodDetail(v) // → {days, hours, unit, raw}
parseRunHours('2000h') // → 2000（运行小时，>168h 才算；日历周期返回 null）
fmtPeriod(days) / addMonths(d, n)        // 人读周期文本；按自然月加减（定检/校验到期用它）
makeNum(warnings)('78℃') // → 78，剥离单位后缀，每 sheet/列只 warning 一次；'<0.1' → null
SYSTEM_ALIASES / mergeAliases(局部别名)   // 中石化常用系统（SAP PM/MM、EM、作业许可、特种设备台账、智能巡检）列名
SAP_STATUS / normSapStatus('TECO')       // → '待验收'；CRTD/REL/TECO/CLSD、OSNO/NOPR/NOCO 与中文六态映射；"已完成"归待验收
classifyResult('无异常')                   // → 'normal'；先整词匹配否定/正常集合再匹配异常集合，NG 按单词边界
normDate / normDateTime / diffDays / addDays / toRecords / pickSheet / fmt / emitOk / fail / mdTable
```

修改 `common.js` 后必须同步到全部 50 个技能的 `scripts/lib/` 并跑全量回归：

```bash
for d in */*/; do [ -f "$d/scripts/selftest.js" ] && (cd "$d" && node scripts/selftest.js | tail -1); done
```

## 改造进度与下一步

- 2026-10-26 第一轮（已完成）：共享库升级并同步；10 处出错数 bug 修复；5 个 SKILL.md 改为 node 不可用即终止；17 个脚本默认输出目录改为系统临时目录；清理遗留产物；`tools/build.sh` 排除 `*-out/`。
- 2026-10-26~27 第二轮（已完成）：按 `../文档/过程记录/改造任务书-2026-10-26.md` 逐技能做中石化口径改造（术语、系统列名、分级、层级、指标、制度引用、PDF 前置步骤、上架信息与样例问题）。完成标记：技能目录内同时存在 `上架信息.md` 与 `样例问题.md`。
- 待办：抽取共享材料类别词表（inspection-evidence-package / regulation-compliance-check / self-audit-form-filler）；各类 README 更新断言数；`演示附件/` 与 make-demo；`tools/build.sh` 全量打包到 dist/。
