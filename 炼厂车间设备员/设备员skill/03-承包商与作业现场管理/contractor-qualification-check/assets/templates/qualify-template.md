# {{contractor}} 承包商资质核验（{{baseDate}}）

作业类型：{{workTypes}}{{#unknownWorkTypes}}（另有未识别类型：{{unknownWorkTypes}}）{{/unknownWorkTypes}}
作业期间：{{workFrom}} 至 {{workTo}} ｜ 临期提醒：{{leadDays}} 天 ｜ 承包商类别：{{contractorType}}{{#contractorCode}} ｜ 承包商编码：{{contractorCode}}{{/contractorCode}}
厂内口径参数：入厂教育有效期 {{eduValidDays}} ｜ 体检有效期 {{medicalValidDays}} ｜ 特种作业证复审周期 {{reviewYears}}
资料来源：{{input}}
生成时间：{{generatedAt}}（北京时间）

## 一、核验概览

| 指标 | 数量 |
|---|---|
| 单位资质条目 | {{counts.companyQual}} |
| 人员证书条目 | {{counts.personnelCerts}} |
| 涉及人员 | {{counts.persons}} |
| 已过期 | {{counts.expired}} |
| 临期（{{leadDays}}天内） | {{counts.expiringSoon}} |
| 作业范围不符 | {{counts.scopeMismatch}} |
| 应有未提供 | {{counts.missing}} |
| 未判定 | {{counts.undetermined}} |
| 类型待确认 | {{counts.unrecognized}} |
| 必备材料未判定（入厂教育/安全协议/体检） | {{counts.mandatoryUndetermined}} |

## 二、单位资质核验

{{table:companyQual}}

## 三、人员证书核验

{{table:personnelQual}}

## 四、作业类型证书要求与必备材料对照

### 4.1 作业类型证书要求

{{table:requirements}}

### 4.2 必备材料（入厂安全教育 / 安全协议 / 体检）

> 依据《中国石化承包商安全管理规定》：承包商入厂前须签订安全协议、人员须完成入厂三级安全教育；高处与受限空间作业人员另须体检。有效期按厂内口径（`--edu-valid-days` / `--medical-valid-days`）推算，**缺失或无法判定一律未判定、不按合格处理**。

{{table:mandatory}}

## 五、不符合项清单

### 5.1 已过期

{{table:expired}}

### 5.2 临期（{{leadDays}} 天内到期）

{{table:expiringSoon}}

### 5.3 作业范围不符

{{table:scopeMismatch}}

### 5.4 应有未提供

{{table:missing}}

### 5.5 提示项（不构成缺证）

> 以下材料按《中国石化承包商安全管理规定》与 TSG Z6001-2019 不属于必备证书（司索工无取证项目、一般高处检修不需高处作业证、维保/技术服务类承包商不要求安全生产许可证），**不计入不符合项**，但请按说明确认作业内容或承包商类别。

{{table:advisories}}

## 六、未判定项

> 以下各项因判定所依赖的字段缺失或无法解析而无法判定，**一律未按有效处理**，须补齐材料后重新核验。

{{table:undetermined}}

## 七、类型待确认项

> 以下证书/资质无法匹配到已知类型表，**脚本不认定其可替代任何所需证书**，请核验人确认是否适用于本次作业。

{{table:unrecognized}}

{{#specExtra}}
## 附一、厂内准入要求对照

{{table:specExtra}}
{{/specExtra}}

{{#history}}
## 附二、历史准入记录对照

{{table:history}}
{{/history}}

## 八、核验结论

**{{conclusion}}** —— {{conclusionBasis}}

结论仅分三档：建议准入 / 建议补充材料后再审 / 不建议准入。本结论为核验意见，不是准入决定。

<!-- ANALYSIS_START -->
{{analysis}}
<!-- ANALYSIS_END -->

## 九、声明

本核验为辅助审查，承包商准入须经安全部门按厂内制度审批；证书真伪须通过发证机关渠道核实。

本次核验仅依据所提供清单的书面记载判断有效期与作业范围匹配性，**不核实证书真伪**；证书真伪、有效状态须通过发证机关或政府主管部门查询渠道逐项核实后方可作为准入依据。

## 附：数据提示

{{warnings}}
