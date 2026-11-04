# 演示case

炼厂车间设备员 50 个技能的演示与回归样例，按 `<分类>/<技能英文名>/` 存放，层级与 [设备员skill](../设备员skill/README.md) 一致。全部为虚构数据，不进发布包。

- **找附件：** 各技能 `上架信息.md`、`样例问题.md` 里示例问题的附件只写文件名，文件在对应技能的目录下。
- **看预期：** 每个技能目录的 `README.md` 是示例问题 ↔ 附件 ↔ 运行参数 ↔ 预期结果的对照表，以及关键验证点和 MCP 取数对照。
- **再生样例：** 在技能目录下运行 `node scripts/make-sample.js`，默认写回这里。二进制样例重新生成后与旧文件字节不同，生成后跑该技能的 `selftest.js`。
- **开发包：** `package.sh --with-examples` 把这里的样例放进包内 `<技能>/examples/`。

## 01-日常运行监控与巡检

| 技能英文名 | 技能名称 | 文件数 |
|---|---|---|
| [anomaly-triage-advisor](01-日常运行监控与巡检/anomaly-triage-advisor/README.md) | 设备异常初判与处置建议 | 10 |
| [inspection-data-digest](01-日常运行监控与巡检/inspection-data-digest/README.md) | 巡检点检数据汇总 | 6 |
| [inspection-task-dispatch](01-日常运行监控与巡检/inspection-task-dispatch/README.md) | 巡检点检任务清单生成 | 4 |
| [leak-point-tracker](01-日常运行监控与巡检/leak-point-tracker/README.md) | 泄漏点登记与修复跟踪 | 7 |
| [lubrication-manager](01-日常运行监控与巡检/lubrication-manager/README.md) | 设备润滑五定管理 | 8 |
| [parameter-trend-alert](01-日常运行监控与巡检/parameter-trend-alert/README.md) | 参数越限与劣化趋势预警 | 5 |
| [runtime-hours-tracker](01-日常运行监控与巡检/runtime-hours-tracker/README.md) | 运行小时与启停次数统计 | 6 |
| [standby-rotation-reminder](01-日常运行监控与巡检/standby-rotation-reminder/README.md) | 备用设备切换与盘车提醒 | 4 |

## 02-缺陷报修与检修管理

| 技能英文名 | 技能名称 | 文件数 |
|---|---|---|
| [completion-acceptance](02-缺陷报修与检修管理/completion-acceptance/README.md) | 检修完工验收 | 7 |
| [defect-intake-grading](02-缺陷报修与检修管理/defect-intake-grading/README.md) | 设备缺陷登记与分级 | 6 |
| [equipment-handover-check](02-缺陷报修与检修管理/equipment-handover-check/README.md) | 检修前设备交出确认 | 4 |
| [maintenance-demand-rollup](02-缺陷报修与检修管理/maintenance-demand-rollup/README.md) | 检修需求汇总上报 | 7 |
| [maintenance-record-archive](02-缺陷报修与检修管理/maintenance-record-archive/README.md) | 检修记录归档 | 6 |
| [overhaul-process-check-bridge](02-缺陷报修与检修管理/overhaul-process-check-bridge/README.md) | 车间检修方案安全措施核查入口 | 7 |
| [permit-precheck-bridge](02-缺陷报修与检修管理/permit-precheck-bridge/README.md) | 车间作业票预检入口 | 7 |
| [repair-plan-assistant](02-缺陷报修与检修管理/repair-plan-assistant/README.md) | 检修方案辅助编制 | 6 |
| [repeat-failure-detector](02-缺陷报修与检修管理/repeat-failure-detector/README.md) | 重复故障识别 | 7 |
| [turnaround-workshop-tracker](02-缺陷报修与检修管理/turnaround-workshop-tracker/README.md) | 大检修车间侧跟踪 | 6 |
| [work-order-generator](02-缺陷报修与检修管理/work-order-generator/README.md) | 维修通知单草稿生成 | 5 |
| [work-order-tracker](02-缺陷报修与检修管理/work-order-tracker/README.md) | 维修工单跟踪与催办 | 6 |

## 03-承包商与作业现场管理

| 技能英文名 | 技能名称 | 文件数 |
|---|---|---|
| [contractor-performance-log](03-承包商与作业现场管理/contractor-performance-log/README.md) | 承包商表现记录 | 8 |
| [contractor-qualification-check](03-承包商与作业现场管理/contractor-qualification-check/README.md) | 承包商资质核验 | 7 |
| [cross-operation-conflict](03-承包商与作业现场管理/cross-operation-conflict/README.md) | 交叉作业冲突检测 | 7 |
| [site-supervision-points](03-承包商与作业现场管理/site-supervision-points/README.md) | 现场作业监督要点 | 3 |

## 04-台账档案与资料管理

| 技能英文名 | 技能名称 | 文件数 |
|---|---|---|
| [equipment-ledger-query](04-台账档案与资料管理/equipment-ledger-query/README.md) | 设备台账查询 | 5 |
| [moc-change-assistant](04-台账档案与资料管理/moc-change-assistant/README.md) | 设备变更管理辅助 | 5 |
| [nameplate-ocr-intake](04-台账档案与资料管理/nameplate-ocr-intake/README.md) | 铭牌识别与台账录入 | 7 |
| [special-equipment-inspection-due](04-台账档案与资料管理/special-equipment-inspection-due/README.md) | 特种设备定检到期管理 | 5 |
| [technical-document-finder](04-台账档案与资料管理/technical-document-finder/README.md) | 技术资料检索与原文引用 | 14 |
| [valve-instrument-calibration-ledger](04-台账档案与资料管理/valve-instrument-calibration-ledger/README.md) | 安全阀校验台账到期管理 | 4 |

## 05-备品备件与物资

| 技能英文名 | 技能名称 | 文件数 |
|---|---|---|
| [spare-parts-consumption-analysis](05-备品备件与物资/spare-parts-consumption-analysis/README.md) | 备件消耗分析 | 6 |
| [spare-parts-demand](05-备品备件与物资/spare-parts-demand/README.md) | 备件需求提报 | 8 |
| [spare-parts-inventory-query](05-备品备件与物资/spare-parts-inventory-query/README.md) | 备件库存查询 | 7 |

## 06-报表与沟通

| 技能英文名 | 技能名称 | 文件数 |
|---|---|---|
| [equipment-daily-report](06-报表与沟通/equipment-daily-report/README.md) | 车间设备日报 | 10 |
| [equipment-event-notice](06-报表与沟通/equipment-event-notice/README.md) | 设备事件通报起草 | 3 |
| [equipment-weekly-monthly-report](06-报表与沟通/equipment-weekly-monthly-report/README.md) | 设备周报月报 | 10 |
| [inspection-evidence-package](06-报表与沟通/inspection-evidence-package/README.md) | 迎检资料准备 | 9 |
| [meeting-material-builder](06-报表与沟通/meeting-material-builder/README.md) | 设备会议汇报稿 | 7 |
| [self-audit-form-filler](06-报表与沟通/self-audit-form-filler/README.md) | 自查表预填 | 7 |
| [shift-handover-record](06-报表与沟通/shift-handover-record/README.md) | 设备员工作交接记录 | 5 |

## 07-隐患事故与合规

| 技能英文名 | 技能名称 | 文件数 |
|---|---|---|
| [failure-case-retrieval](07-隐患事故与合规/failure-case-retrieval/README.md) | 故障案例检索 | 7 |
| [failure-investigation-assistant](07-隐患事故与合规/failure-investigation-assistant/README.md) | 故障调查辅助 | 7 |
| [hazard-closure-tracker](07-隐患事故与合规/hazard-closure-tracker/README.md) | 隐患整改闭环跟踪 | 6 |
| [regulation-compliance-check](07-隐患事故与合规/regulation-compliance-check/README.md) | 法规制度符合性自查 | 9 |
| [safety-environmental-device-check](07-隐患事故与合规/safety-environmental-device-check/README.md) | 安全环保设施状态检查 | 5 |

## 08-知识与能力支持

| 技能英文名 | 技能名称 | 文件数 |
|---|---|---|
| [equipment-energy-analysis](08-知识与能力支持/equipment-energy-analysis/README.md) | 设备能效分析 | 5 |
| [equipment-knowledge-qa](08-知识与能力支持/equipment-knowledge-qa/README.md) | 设备专业知识问答 | 6 |
| [operator-anomaly-guide](08-知识与能力支持/operator-anomaly-guide/README.md) | 操作工异常识别指引卡 | 4 |
| [training-material-generator](08-知识与能力支持/training-material-generator/README.md) | 培训材料与考题生成 | 7 |
| [worklog-todo-manager](08-知识与能力支持/worklog-todo-manager/README.md) | 工作日志与待办管理 | 12 |
