# 特殊作业票预检报告

> **声明：本报告由规则引擎自动生成，仅为辅助预检，不替代作业票审批。** 条款号按记忆整理，以 GB 30871-2022 正式文本及企业制度为准。

## 一、作业票基本信息
| 项目 | 内容 |
|---|---|
| 作业票编号 | {{permit_no}} |
| 作业类型 / 级别 | {{type}} / {{level}} |
| 作业地点 | {{location}} |
| 作业单位 | {{unit}} |
| 介质 | {{medium}} |
| 有效期 | {{start_time}} ～ {{end_time}} |
| 申请人 / 监护人 | {{applicant}} / {{guardian}} |
| 预检基准时间 | {{now}} |

## 二、预检结论
**{{verdict}}**

| 必须整改 | 建议完善 | 未判定 | 通过 | 未适用（跳过） |
|---|---|---|---|---|
| {{must_fix_count}} | {{should_improve_count}} | {{undetermined_count}} | {{pass_count}} | {{skipped_count}} |

## 三、必须整改
{{must_fix_list}}

## 四、建议完善
{{should_improve_list}}

## 五、未判定（票面信息不足）
> 以下规则的判定条件依赖的票面字段为空（空白、看不清或票面无此栏），脚本无法判断是否适用。请补充信息后重新预检，或由审批人现场核实。

{{undetermined_list}}

## 六、通过项
{{pass_list}}

{{extraction_notes_section}}

---
规则库版本 {{rules_version}}，共 {{rules_total}} 条；生成时间 {{generated_at}}。
