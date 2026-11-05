# plan.json 字段定义（检修方案抽取结果）

> 空模板见 `assets/templates/plan.json`。作业类型标签沿用 GB 30871 的「动火」，即中石化的「用火作业」，方案写「用火」的标签填「动火」（见 extraction-guide.md 开头说明）。**方案没写的一律填 `null`（数组保持 `[]`），不得猜测**；每处 null / 推断都在 `extraction_notes[]` 记一条。

## 顶层字段
| 字段 | 类型 | 说明 |
|---|---|---|
| `plan_no` | string\|null | 方案编号/文件号，无则 null |
| `unit` | string\|null | 检修装置/单元名称，如「常减压装置」 |
| `project` | string\|null | 检修项目名称，如「2026 年装置大检修」（按方案原文填写，方案写「停工大修」的照抄） |
| `contractor` | string\|null | 承包商/施工单位；自行检修填承担车间 |
| `duration_days` | number\|null | 计划工期（天）；方案只给起止日期时换算成天数并记 extraction_notes |
| `jobs` | array | 检修作业清单，见下；方案没有作业表则为 `[]` |
| `measures` | object | 方案中已写明的安全措施，见下 |
| `org` | object | 安全组织：`site_manager` 现场负责人、`safety_officer` 安全员、`emergency_contact` 应急联系（人/电话） |
| `attachments` | object | 附件：`risk_assessment_doc` 风险评估、`site_layout` 施工平面图、`emergency_plan_doc` 应急预案 |
| `extraction_notes` | string[] | 抽取备注，格式「字段：方案情况 → 填了什么」 |

## jobs[] 每项作业
| 字段 | 类型 | 说明 |
|---|---|---|
| `name` | string\|null | 作业名称，如「T-101 塔内件更换」 |
| `job_types` | string[]\|null | 作业类型标签数组，取值：动火（即用火作业）/ 受限空间 / 高处 / 吊装 / 临时用电 / 盲板抽堵 / 动土 / 带压堵漏 / 射线探伤 / 化学清洗。识别关键词见 extraction-guide.md；方案完全看不出类型填 `null`（会触发未判定，提醒补标） |
| `medium` | string\|null | 涉及介质，如「常压渣油」 |
| `location` | string\|null | 作业位置（设备位号/区域） |

## measures 取值约定
- `true` 或实质文字 = 方案已写明（文字可摘录原文要点，报告会引用）。
- `null` = 方案未提及；`false` = 方案明确标注未落实/未勾选。二者核查时都算「缺失」。
- 数字 `0`、否定词字符串（无、不涉及、不适用、没有、N/A、待定、暂无，或仅「/ — - ~」等符号）引擎也按未写明处理并在报告注明；抽取时这类栏目应直接填 `false`，见 extraction-guide.md 第四节。
- **不要**因为「常规上肯定会做」就填 true——只看方案文本写没写。

### 通用措施键
`risk_identification`（风险辨识/JSA）、`safety_briefing`（安全交底）、`emergency_plan`（应急预案）、`emergency_drill`（应急演练安排）、`contractor_qualification`（承包商资质审查）、`contractor_agreement`（安全管理协议）、`contractor_training`（入厂安全教育）、`tool_inspection`（工机具检验）、`cross_work_coordination`（交叉作业协调）、`safety_acceptance`（安全验收条款）、`process_handover`（停工处理与装置交出）、`energy_isolation`（能量隔离/挂牌上锁）、`waste_disposal`（废弃物处置）、`fire_access`（消防通道保障）、`phased_safety_check`（阶段性安全检查）、`toxic_protection`（有毒介质职业卫生防护）、`restart_safety`（检修后试车与安全设施恢复）

### 专项措施键（按作业类型）
| 类型 | 键 |
|---|---|
| 动火（用火作业） | `hotwork_permit` 办票、`combustible_cleanup` 清可燃物、`cylinder_distance` 气瓶间距、`fire_watch_equipment` 消防器材、`hotwork_gas_test` 动火分析安排、`fire_watcher` 动火监护人/监火人 |
| 受限空间 | `confined_permit` 办票、`isolation_purge` 隔离置换、`ventilation` 通风、`gas_test_plan` 气体检测安排、`rescue_equipment` 救援器材、`confined_guardian` 专人监护 |
| 高处 | `scaffold_acceptance` 脚手架搭设验收、`fall_protection` 防坠落、`weather_stop` 恶劣天气停工、`highplace_permit` 办票 |
| 吊装 | `lifting_plan` 吊装方案、`lifting_permit` 吊装令/办票、`lifting_warning_zone` 警戒、`lifting_ground_check` 场地确认 |
| 临时用电 | `power_distribution` 配电规范、`leakage_protector` 漏保、`electrician_cert` 持证电工、`temp_power_permit` 办票 |
| 盲板抽堵 | `blind_plate_map` 盲板图、`blind_plate_list` 盲板清单、`blind_plate_permit` 办票 |
| 动土 | `excavation_permit` 办票、`underground_check` 地下设施探测 |
| 带压堵漏 | `pressure_seal_approval` 专项方案审批、`pressure_seal_qualified` 专业队伍 |
| 射线探伤 | `radiation_protection` 辐射防护与警戒、`radiation_schedule` 时段安排 |
| 化学清洗 | `chemical_disposal` 介质处置、`chemical_ppe` 个体防护、`chemical_emergency_flush` 应急冲洗 |
| 动火+高处组合（高处用火） | `spark_containment` 火花防溅落 |

## 核查判定与字段的关系
- 专项规则由 `jobs[].job_types` 触发：任一作业含该类型即核查对应措施；无作业含该类型且所有作业都有标签 → 规则跳过（未适用）。
- 有作业 `job_types` 为 null（未标注）时，未触发的专项规则输出**未判定**而不是跳过（`[]` = 方案标注「无特殊作业」，算已标注）；未判定按作业类型聚合为一条，说明中列出涉及的规则号。
- 类型标签不在合法表（checklist.json 的 meta.job_types）中的会被引擎剔除并记入抽取备注；剔除后为空按未标注处理。
- `duration_days > 30` 触发阶段性安全检查规则（C-003）；`duration_days` 为 null → 未判定。
- 同一作业同时含「受限空间+动火」（受限空间内用火）→ C-001 双票联办提示；「动火+高处」（高处用火）→ C-002 检查 `spark_containment`。
