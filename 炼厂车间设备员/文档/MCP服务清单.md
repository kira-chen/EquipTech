# 炼厂车间设备员 · Mock MCP 服务清单

用于在不对接真实系统时，为 50 个技能提供演示和联调数据。按来源系统划分为 6 个 MCP 服务，全部只读。规程、资料和制度类内容不做 MCP，使用平台的“知识”功能。

## 一、总览

| 优先级 | 系统 | MCP 服务 | 包含模块 | 工具数 | 覆盖技能数 |
|---|---|---|---|---|---|
| P0 | EAM 设备资产管理 | `eam` | 设备与维修、特种设备、大检修 | 14 | 16 |
| P0 | DCS / SCADA 位号 | `dcs` | 位号、历史值、报警、运行和能效数据 | 6 | 5 |
| P0 | 点检 / 巡检 App | `inspection-app` | 巡检、主备切换、润滑和油液分析 | 9 | 4 |
| P1 | 作业票系统 | `work-permit` | 作业票、区域 | 3 | 3 |
| P1 | 备件库存 MRO | `mro` | 库存、出入库、预留、代用 | 4 | 3 |
| P1 | HSE 管理平台 | `hse` | 隐患与安全环保设施、承包商、LDAR | 9 | 6 |
| 合计 | | | | 45 | 37 |

其余技能的数据来源：

- 9 个技能使用平台知识库，见第八节。
- 4 个技能不需要外部数据，见第九节。

系统名与 Onto-Demo 的源表分组一致，便于以后对接。

## 二、EAM 设备资产管理（`eam`）

### 设备与维修

| 工具 | 返回内容 |
|---|---|
| `list_functional_locations` | 装置、单元、功能位置层级 |
| `get_equipment_ledger` | 位号、设备编号、名称、类型、规格型号、制造厂、重要度、特护标记、介质、状态、投用日期 |
| `get_notifications` | 通知单号、位号、描述、部位、损坏代码、缺陷等级、是否影响运行、发现时间、状态 |
| `get_work_orders` | 工单号、位号、类型、优先级、状态、计划与实际起止时间、最后节点、工作中心 |
| `get_failure_history` | 指定位号的历史通知单、工单和处理结果 |
| `get_maintenance_plans` | 周期检修项、周期、上次执行时间、下次到期时间 |

使用技能：`defect-intake-grading`、`work-order-generator`、`work-order-tracker`、`repeat-failure-detector`、`maintenance-demand-rollup`、`maintenance-record-archive`、`equipment-ledger-query`、`equipment-handover-check`、`nameplate-ocr-intake`、`moc-change-assistant`、`failure-case-retrieval`、`equipment-daily-report`、`equipment-weekly-monthly-report`

### 特种设备

| 工具 | 返回内容 |
|---|---|
| `get_special_equipment` | 设备类别、注册代码、安全状况等级、检验类型、上次和下次检验日期 |
| `get_inspection_issues` | 检验问题、整改要求、整改状态；可按车间（workshop）取 |
| `get_safety_valves` | 位号、整定压力、校验日期、校验周期、结论、送检状态 |

使用技能：`special-equipment-inspection-due`、`valve-instrument-calibration-ledger`

### 大检修（P2）

| 工具 | 返回内容 |
|---|---|
| `get_turnaround_projects` | 项目清单、节点、进度 |
| `get_material_arrivals` | 材料到货情况 |
| `get_workforce_status` | 人员到位情况 |
| `get_startup_conditions` | 开工条件 |
| `get_punch_list` | 三查四定问题 |

使用技能：`turnaround-workshop-tracker`

## 三、DCS / SCADA 位号（`dcs`）

| 工具 | 返回内容 |
|---|---|
| `get_tag_list` | 测点号、位号、参数名、单位 |
| `get_tag_limits` | 高报、高高报、低报、低低报限值 |
| `get_tag_history` | 指定测点和时间范围的多期历史值 |
| `get_alarm_events` | 报警时间、测点、类型、确认状态 |
| `get_run_events` | 启停记录、运行状态、累计运行小时 |
| `get_energy_data` | 流量、压力、温度、电流和功率等能效计算参数，以及设计值 |

使用技能：`parameter-trend-alert`、`anomaly-triage-advisor`、`runtime-hours-tracker`、`equipment-energy-analysis`、`failure-investigation-assistant`

只有最新值快照不够用。趋势和超限统计需要多期历史值，mock 时要单独准备位号历史值表。

## 四、点检 / 巡检 App（`inspection-app`）

### 巡检与主备切换

| 工具 | 返回内容 |
|---|---|
| `get_inspection_records` | 位号、检查项目、结果、测值、单位、是否报警、时间、巡检人、路线 |
| `get_inspection_standards` | 位号或设备类型、检查项目、判定标准、周期、路线 |
| `get_last_inspection` | 各位号各检查项目的上次巡检时间和结果 |
| `get_standby_ledger` | 机组、主备设备、切换周期、盘车周期、试运周期 |
| `get_rotation_records` | 切换、盘车、试运记录；可按车间（workshop）取 |

使用技能：`inspection-data-digest`、`inspection-task-dispatch`、`standby-rotation-reminder`

### 润滑与油液分析（P2）

| 工具 | 返回内容 |
|---|---|
| `get_lubrication_ledger` | 五定信息和周期 |
| `get_lubrication_records` | 加换油记录 |
| `get_oil_analysis` | 油液分析结果和限值 |
| `get_oil_prices` | 油品单价 |

使用技能：`lubrication-manager`

现实中油液分析多在 LIMS，这里为简化并入巡检 App。

## 五、作业票系统（`work-permit`）

| 工具 | 返回内容 |
|---|---|
| `get_permits` | 作业编号、作业类型、级别、位号、区域、楼层或标高、起止时间、监护人、状态；默认返回查询日当天有效的票（含跨天多日票） |
| `get_permit_document` | 作业票 Word 原件 |
| `get_area_map` | 区域、相邻关系、上下层关系 |

使用技能：`cross-operation-conflict`、`site-supervision-points`、`permit-precheck-bridge`

## 六、备件库存 MRO（`mro`）

| 工具 | 返回内容 |
|---|---|
| `get_inventory` | 物料号、名称、规格、库存、库位、在途、再订货点、适用位号（MB52、MMBE） |
| `get_material_movements` | 物料凭证、移动类型、数量、金额、领用设备、日期（MB51） |
| `get_reservations` | 工单预留的物料和数量；可按车间（workshop）取 |
| `get_material_substitutes` | 同规格候选和代用要点 |

使用技能：`spare-parts-inventory-query`、`spare-parts-demand`、`spare-parts-consumption-analysis`

## 七、HSE 管理平台（`hse`）

### 隐患与安全环保设施

| 工具 | 返回内容 |
|---|---|
| `get_hazards` | 隐患编号、等级、五定信息、期限、整改和验收状态 |
| `get_safety_facilities` | 七类设施的台账、检测日期、有效期、状态 |
| `get_rectification_records` | 设施不合格项和整改记录 |

使用技能：`hazard-closure-tracker`、`safety-environmental-device-check`

### 承包商（P2）

| 工具 | 返回内容 |
|---|---|
| `get_contractors` | 单位、类别、资质、有效期、安全协议 |
| `get_personnel_certificates` | 人员、证种、有效期、复审日期、三级教育 |
| `get_admission_requirements` | 按承包商类别的准入要求 |
| `get_site_inspections` | 现场检查、违章、质量、进度记录，带所属车间；可按车间（workshop）取 |

使用技能：`contractor-qualification-check`、`contractor-performance-log`、`completion-acceptance`

### LDAR（P2）

| 工具 | 返回内容 |
|---|---|
| `get_leak_points` | 漏点编号、位号、密封类型、介质、检测值、检测日期、修复状态 |
| `get_seal_point_counts` | 静密封点和动密封点总数 |

使用技能：`leak-point-tracker`

现实中 LDAR 多归环保管理，这里为简化并入 HSE。

## 八、平台知识库

以下技能读取规程、资料和制度，不做 MCP，由平台“知识”功能提供：

`technical-document-finder`、`equipment-knowledge-qa`、`training-material-generator`、`regulation-compliance-check`、`inspection-evidence-package`、`self-audit-form-filler`、`repair-plan-assistant`、`overhaul-process-check-bridge`、`operator-anomaly-guide`

知识库要预置这些资料：

| 资料类别 | 内容 | 要求 |
|---|---|---|
| 设备资料 | 操作规程、说明书、技术协议、检修方案 | 标题或标签带位号或设备类型，否则按位号检索不到 |
| 法规制度 | 法规、标准、集团和企业制度条款 | 保留条款编号 |
| 检查表 | 检查通知、专项检查表、自查表 | 保留原表格结构 |
| 典型案例 | 故障和事故案例 | 带设备类型和故障模式 |

## 九、不需要外部数据的技能

| 技能 | 数据来源 |
|---|---|
| `equipment-event-notice` | 用户描述事件经过 |
| `meeting-material-builder` | 其它技能的 JSON 产出 |
| `shift-handover-record` | 用户记录和上次交接记录 |
| `worklog-todo-manager` | 其它技能的 JSON 产出和用户待办 |

## 十、统一约定

1. **返回文件：** 技能脚本读取 xlsx、CSV 或 JSON，不能直接读取工具返回的文本。每个数据工具都要能把结果导出为 CSV 文件，或返回可下载的文件。
2. **列名：** 使用技能的规范中文列名，如位号、工单号、状态，或《中石化口径对照》第二节收录的系统列名。不要使用 `AUFNR` 这类字段码。各系统源表可以保留不同的命名风格，由 MCP 服务翻译成中文列名后再输出。
3. **设备标识：** 所有服务都用同一套位号。不能只返回 8 位设备编号或口语设备名。
4. **状态：** 已验收关闭的工单用 `CLSD`，`TECO` 只用于待验收工单。
5. **分级：** 缺陷用 A/B/C，隐患用重大/一般，优先级用 SAP 1~4。
6. **保留脏数据：** 少量带单位数值、未知状态和空字段，可以演示未判定能力。
7. **查询参数：** 列表工具支持车间、时间范围、位号、状态和分页。
8. **只读：** 岗位只出草稿，所有工具不写入业务系统。
