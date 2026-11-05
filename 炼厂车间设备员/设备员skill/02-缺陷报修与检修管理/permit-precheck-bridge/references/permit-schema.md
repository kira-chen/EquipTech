# 作业票统一数据模型（permit.json）

空模板：`assets/templates/permit.json`（数组类字段在模板中为 `[]`，元素结构见本文各表）。所有字段允许 `null`（表示票面缺失/看不清，**不得猜测**）。时间一律 ISO 8601 带时区，如 `2026-08-28T09:00:00+08:00`；**无时区的时间会被脚本视为缺失**并由 G-000 提示。

> `type` 枚举沿用 GB 30871 的「动火」，即中石化的「用火作业」（票面"用火作业许可证 / 用火安全作业证 / 用火票"都填「动火」）。下表「适用类型」列和规则说明里的「动火」指这个取值。

## 顶层字段
| 字段 | 类型 | 说明 | 相关规则 |
|---|---|---|---|
| `type` | enum | 动火（即用火作业）/ 受限空间 / 高处 / 吊装 / 临时用电 / 盲板抽堵 / 动土 / 断路 | G-002 |
| `permit_no` | string | 作业票编号 | G-001 |
| `level` | string | 动火（用火）：特级/一级/二级；高处：一级/二级/三级/特级；吊装：一级/二级/三级；其他类型可 null | G-021, HW-001, HP-002, LF-002 |
| `location` | string | 装置/单元/设备位号 + 具体部位 | G-003 |
| `unit` | string | 属地单位 / 作业单位 | G-004 |
| `medium` | object | `{name, lel_pct, flammable, toxic}`；`lel_pct` 介质爆炸下限（体积%），用于 GB 5.3 体积分数判定（≥4% → ≤0.5%；<4% → ≤0.2%），缺失时 G-024 提示；`toxic=false` 时允许 `gas_tests[].toxic=[]` | G-005, G-024, HW-007/008, CS-004/019/020 |
| `start_time` / `end_time` | ISO | 作业票有效期起止 | G-006~009, *-duration |
| `applicant` | string | 申请人/作业负责人（签字栏空白→null） | G-010 |
| `guardian` / `guardian_cert` | string | 监护人及其证书；监护人不得兼任申请人/作业人员 | G-011, G-019, G-022 |
| `briefing_signed` | bool | 安全交底**签字**确认（整体一栏时用此字段；逐人签字用 `workers[].briefing_signed`，任一满足即通过） | G-023 |
| `approvers` | string[] | 各级审批人签字（含职务） | G-012 |
| `workers` | `[{name, role, cert, briefing_signed}]` | `role` 用于角色匹配（指挥/起重指挥、司索、起重机司机/吊车司机/司机、电工/电气、焊）；`cert` 证书编号，非特种作业可填 "N/A-非特种作业"（角色规则把 N/A 开头视为无证：焊工填 N/A 会触发 HW-024）；`briefing_signed` 该人是否在安全交底栏签字 | G-013/014/023, HW-024, LF-005~007, TE-004 |
| `gas_tests` | `[{time, location, o2, lel, combustible_vol, toxic[], analyst, instrument_ok}]` | 脚本加载后**按 time 升序排序**，`[last]` 即最新一次。`o2` 氧含量 %；`lel` 检测仪读数 %LEL；`combustible_vol` 体积分数 %（可选，缺失时脚本按 `lel × medium.lel_pct / 100` 派生）；`toxic[{name,value,unit}]` 单位 mg/m3，`[]` 表示未检测（`medium.toxic=false` 时通过，否则建议完善）；`instrument_ok` 检测仪在校验有效期内 | G-024, HW-004~010/023/026, CS-001~005/018~021 |
| `measures` | object | 安全措施勾选项，见下表；勾选=true，未勾选=false，票面无此项=null | 多条 |
| `cross_jobs` | `[{type, permit_no}]` | 关联的其他作业票；单个对象会被包成数组；`type` 按包含匹配（"盲板抽堵作业"也能命中），不在八类内由 G-025 提示 | G-025, HW-019~021, CS-014, HP-012 |
| `attachments` | object | `{scheme, blind_plate_map, underground_map, detour_plan}`，填附件名/编号，无则 null | HP-011, LF-003, BP-003, DG-001, RB-001 |
| `night_or_holiday` | bool | 夜间（通常 18:00~次日 6:00）或法定节假日 | HW-002 |
| `in_confined_space` | bool | 用火点是否在受限空间内 | HW-003/009/019 |
| `hot_work_inside` | bool | 受限空间/高处作业中是否含用火 | CS-014, HP-012 |
| `outdoor` | bool | 露天作业 | HW-022 |
| `height_m` | number | 作业高度（m） | HW-020, HP-001/002 |
| `load_mass_t` | number | 吊装质量（t） | LF-001/002 |
| `depth_m` | number | 动土深度（m） | DG-003 |
| `voltage` / `power_source` | number / string | 临时用电电压（V）、接电点 | TE-001, TE-008 |
| `hazardous_area` | bool | 是否爆炸危险区域 | TE-005 |
| `lighting_voltage` | number | 受限空间照明电压（V） | CS-008/009 |
| `wet_or_metal_container` | bool | 潮湿/狭小金属容器 | CS-009 |
| `interrupted_minutes` | number | 作业中断时长（min），审批前预检通常为 null | HW-011 |
| `blind_plates` | `[{no, location, action, spec}]` | `action`：堵/抽 + 顺序号，如 "堵-1"；多于 1 块由 BP-009 提示一票一板 | BP-001~004, BP-009 |
| `weather` | `{wind_level, thunderstorm, rain}` | 风力等级（整数）、雷雨 | HW-022, HP-006/007, LF-009 |
| `notes` | string | 票面上的备注栏原文 / 一句话总体疑点 | — |
| `extraction_notes` | string[]（可选） | 抽取阶段逐条记录的待人工确认事项：空白栏、看不清、由其他信息推断、单位不一致、检出限以下等。**每条写清「哪个字段、票面什么样、填了什么」**，如 `"guardian：监护人签字栏空白，填 null"`。脚本会在报告末尾单列「抽取备注（需人工确认）」一节并写入 result.json；缺失或为空数组时不显示 | 报告展示，不参与规则判定 |

## measures 勾选项
| 键 | 含义 | 适用类型 |
|---|---|---|
| risk_identified | 风险辨识 | 全部 |
| briefing_done | 安全教育/交底 | 全部 |
| emergency_plan | 应急措施 | 全部 |
| warning_zone | 警戒区/标识 | 全部、吊装必需 |
| ppe_confirmed | 个体防护 | 全部 |
| isolation_done / isolation_by_blind | 与系统隔离 / 隔离方式为加盲板 | 动火、受限空间 |
| purge_clean | 清洗置换吹扫 | 动火 |
| fire_equipment | 消防器材 | 动火 |
| drains_sealed | 排水井/地漏封堵 | 动火 |
| combustibles_cleared | 可燃物清理 | 动火 |
| retest_after_interrupt | 中断后复检 | 动火 |
| cylinder_distance_ok | 乙炔/氧气瓶间距≥5m、距火点≥10m | 动火 |
| video_monitoring | 特级用火全程视频监控 | 动火（特级） |
| ventilation | 通风 | 受限空间 |
| rescue_equipment | 应急救援器材 | 受限空间 |
| entry_register | 进出登记 | 受限空间 |
| continuous_monitoring | 连续/定时/随时监测 | 受限空间、动火（特级必需） |
| energy_locked | 停电上锁挂牌 | 受限空间 |
| guardian_outside | 监护人在外全程监护 | 受限空间 |
| safety_belt / fall_protection | 安全带 / 防坠落 | 高处 |
| scaffold_checked / tools_secured / health_checked | 脚手架验收 / 防坠物 / 身体状况 | 高处 |
| equipment_inspected / ground_bearing / overhead_lines_cleared / ten_no_lift_checked | 机具检查 / 地基 / 架空线距离 / “十不吊”确认 | 吊装 |
| rcd_installed / grounding / explosion_proof / cable_protected | 漏保 / 接地 / 防爆 / 线路保护 | 临时用电 |
| pressure_relieved / blind_plate_spec_ok / nonsparking_tools | 泄压 / 盲板规格 / 防爆工具 | 盲板抽堵 |
| underground_confirmed / slope_support / access_ladder | 地下管线确认 / 支护 / 上下通道 | 动土 |
| night_warning_light | 夜间警示灯 / 红灯 | 动土、断路 |
| warning_signs / fire_access_kept | 警示标志 / 消防通道 | 断路 |

## 规则类型（rules.json）
`required`（含 `truthy`、`min_count`、`arr[].x` 逐项）、`count_max`、`enum`（允许值全为数字时先数值化）、`range`（`derive:"combustible_from_lel"` 可由 %LEL 派生体积分数；定性值如"合格"→建议完善）、`time_window`（`max_minutes` + 可选 `soft_minutes` 分档；开工后的复检与当前时间比较）、`time_format`、`duration_max`、`time_order`、`now_in_window`、`conditional`（`when` + `then`）、`cross_permit`、`cross_jobs_valid`、`derived_level`、`role_cert`（`roles[]` 关键词数组）、`toxic`、`multi_point_sampling`、`guardian_independent`、`briefing_signed`、`approver_level`、`fail`。

任何规则均可带 `when` 条件（op：eq/ne/in/not_in/exists/missing/truthy/gt/gte/lt/lte，以及 `duration_gt`/`duration_lte` 比较起止时长小时数）。**`when` 依赖字段为空时输出 `undetermined`（未判定）**而非静默跳过；规则带 `on_when_empty:"skip"` 的例外（HW-007/008、CS-019/020 由 G-024 覆盖，HW-011 审批前中断时长为空即视为未中断）。严重度：`must_fix` / `should_improve` / `undetermined` / `pass`；`check_name` 为通过项显示的正向名称。
