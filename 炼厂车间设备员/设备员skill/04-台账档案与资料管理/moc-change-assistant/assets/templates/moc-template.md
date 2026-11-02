# 设备变更（MOC）评估要点{{#workshop}}（{{workshop}}）{{/workshop}}

生成时间：{{generatedAt}}（北京时间）　位号：{{tag}}{{#name}}　设备：{{name}}{{/name}}　提交对象：车间设备主任 / 公司设备管理部门（变更管理归口部门）

## 一、变更概况

| 项目 | 内容 |
|---|---|
| 设备位号 | {{tag}} |
| 设备名称 | {{name}} |
| 原状态 | {{before}} |
| 变更后状态 | {{after}} |
| 变更原因 | {{reason}} |
| 变更类别（细分） | {{categoryCn}}（{{categorySource}}） |
| 变更类型（中石化三大类） | {{changeTypeCn}} |
| 是否临时变更 | {{temporaryCn}} |
| 申请人 | {{applicant}} |
| 台账核对 | {{ledgerNote}} |

## 二、是否属于变更及依据

| 项目 | 内容 |
|---|---|
| **是否属于变更** | **{{isChangeCn}}** |
| **变更类型** | **{{changeTypeCn}}** |
| **建议变更级别** | **{{levelCn}}{{#temporary}}（临时）{{/temporary}}** |
| 判定依据 | {{basis}} |
| 依据条款 | {{ruleId}} |
| 口径来源 | {{basisSource}} |

{{#undetermined}}
> 【未判定】判定要素不全。未判定不等于「不需要走变更」，补齐下列要素后须重新判定。
{{/undetermined}}
{{#review}}
> 【注意】同规格不同厂家代用不自动判为变更，建议走材料代用单 / 同类替换评审；是否需报变更以厂内制度为准（可用 --spec 传入厂内制度定级）。
{{/review}}

## 三、归口与提报专业

| 项目 | 内容 |
|---|---|
| 提报专业 | {{ownership.owner}} |
| 车间设备员可否直接提报 | {{ownership.equipmentEngineerCanSubmit}} |
| 说明 | {{ownership.note}} |

## 四、需评估项（按专业）

{{#assessItems}}
### {{discipline}}

{{#items}}
- [ ] {{item}}
{{/items}}

{{/assessItems}}

## 五、应更新资料清单

{{table:docUpdates}}

## 六、待确认信息

{{table:undetermined}}

{{#undetermined}}
> 信息不足时**不得**判定为「不需要走变更」，须补齐上述要素后重新运行判定。
{{/undetermined}}

## 七、与厂内制度的冲突点

{{table:conflicts}}

## 八、特种设备法定手续提示（压力容器 / 压力管道）

{{#statutory}}
【注意】{{statutory.note}}（判断依据：{{statutory.source}}）

{{table:statutory.items}}
{{/statutory}}
{{^statutory}}_不适用：本次变更不涉及承压设备结构或材质改动，或已确认对象不是压力容器 / 压力管道。_{{/statutory}}

## 九、临时变更期限与恢复计划

{{#temporaryPlan}}
| 项目 | 内容 |
|---|---|
| 恢复期限 | {{temporaryPlan.until}} |
| 期限要求 | {{temporaryPlan.note}} |

恢复计划须明确（由申请人填写）：

{{#temporaryPlan.required}}
- [ ] {{item}}
{{/temporaryPlan.required}}
{{/temporaryPlan}}
{{^temporaryPlan}}_不适用：非临时变更。_{{/temporaryPlan}}

## 十、变更申请要点提示

<!-- ANALYSIS_START -->
（由模型依据 references/moc-rules.md 口径撰写 200~400 字，结构：变更必要性 → 判定结论（变更类型、级别、是否临时）与依据条款 → 归口提报专业 → 需重点评估的专业与理由 → 资料更新、特种设备法定手续与审批提示。所有结论与条款号一律引用 moc.json，不得自行放宽或收紧。）
<!-- ANALYSIS_END -->

## 附：数据提示

{{warnings}}

---

> 本判定为辅助参考，变更是否成立、变更类型、级别与审批要求以厂内变更管理部门按《中国石化变更管理规定》及厂内实施细则认定为准；未经批准不得实施变更。
