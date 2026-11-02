# 检修方案（初稿）　{{tag}} {{name}}

> {{meta.disclaimer}}
> **{{declaration}}。**

{{#notCovered}}【注意】**设备类型「{{equipType}}」不在本技能覆盖范围内**，以下仅为通用检修框架。具体拆装步骤、力矩值、间隙标准与专业质量控制点**须由技术人员按厂内规程补充**，不得凭通用知识填充。
{{/notCovered}}{{#hasTBC}}【注意】**本方案有 {{counts.toBeConfirmed}} 处具体数值无规程出处，已标「待查规程确认」**（见第八节）。补齐前不得据此施工。
{{/hasTBC}}

## 一、检修概况

| 项目 | 内容 |
|---|---|
| 位号 | {{tag}} |
| 设备名称 | {{name}} |
| 设备类型 | {{equipType}}（归类：{{equipCn}}） |
| 规格型号 | {{model}} |
| 所属车间 | {{workshop}} |
| 检修分级 | {{levelCn}} |
| 计划开工 | {{startDate}} |
| 计划工期 | {{duration}} 天（至 {{endDate}}） |
| 上次检修情况 | {{lastRepair}} |
| 引用规程 | {{specFile}} |
| 生成时间 | {{generatedAt}}（北京时间） |

## 二、检修范围与内容

| 项目 | 内容 |
|---|---|
| 检修内容 | {{scope}} |
| 是否解体 | {{dismantleCn}} |
| 步骤总数 | {{counts.steps}} 条（其中未判定 {{counts.stepsUndetermined}} 条） |
| 质量控制点 | {{counts.qcPoints}} 项（停工待检点 {{counts.qcHold}} 项） |
| 验收项 | {{counts.acceptance}} 项 |

**安全措施**：{{safetyNote}}

<!-- ANALYSIS_START -->
（由设备员补写 200~400 字：检修必要性、范围划定理由、与上次检修及当前缺陷的关系、工期与资源安排的考虑。数量与判定一律引用 plan.json。）
<!-- ANALYSIS_END -->

## 三、JSA/风险分析与 HSE 措施（占位）

| 项目 | 内容 |
|---|---|
| JSA/风险分析编号 | {{hse.jsa.no}} |
| 分析日期 | {{hse.jsa.date}} |
| 参加人 | {{hse.jsa.participants}} |
| 主要危害因素 | {{hse.jsa.mainRisks}} |
| 风险等级 | {{hse.jsa.riskLevel}} |

**作业许可（八大类）**

{{table:hse.permits}}

**双监护与属地确认**

| 角色 | 姓名 |
|---|---|
| 属地监护人 | {{hse.supervision.siteGuardian}} |
| 作业单位监护人 | {{hse.supervision.contractorGuardian}} |
| 属地确认人 | {{hse.supervision.confirmer}} |

【注意】{{hse.supervision.note}}。

**HSE 措施**

{{table:hse.measures}}

【注意】{{hse.note}}

## 四、施工准备

### 4.1 工机具与量具

{{table:tools}}

【注意】量具须在检定有效期内；规格与量程按设备实际尺寸由技术人员确定，本表不给具体数值。

### 4.2 备件与材料

{{table:spares}}

【注意】备件型号、材质与数量按设备型号与图号核对确定，本表不预填规格与数量。

### 4.3 人员与资质

{{table:staff}}

## 五、作业步骤

{{#phases}}
### {{phaseCn}}

{{table:steps}}
{{/phases}}

【注意】数值要求一栏：标注出处的为厂内规程/说明书**原文摘录**；标「**待查规程确认**」的为无出处项，**不得凭经验填写**，见第八节。

## 六、质量控制点

{{table:qcPoints}}

【注意】停工待检点未经确认签字不得转入下道工序。本表供 `completion-acceptance` 竣工验收比对。

## 七、验收标准

{{table:acceptance}}

【注意】验收项与第六节质量控制点配套；**带「待查规程确认」的判据补齐前不得判定验收合格**。

## 八、待确认事项

### 8.1 无出处的具体数值

{{table:toBeConfirmed}}

【注意】以上各项一律标「**待查规程确认**」。**绝不填写凭经验的数值** —— 方案里写错一个力矩值，现场就按错的做。

### 8.2 厂内规程与通用口径冲突点

{{table:conflicts}}

> **一律以厂内规程为准。** 冲突点未经确认前，相关步骤按「待查规程确认」处理，不得任选其一。

### 8.3 未判定的作业步骤

{{table:undetermined}}

【注意】以上步骤因判定依据缺失暂未确定是否执行，**不得按「不需要」删除**；补齐信息后重新生成方案。

{{#notCovered}}
### 8.4 待技术人员补充的内容

{{table:toSupplement}}
{{/notCovered}}

---

**{{declaration}}。**

## 附：数据提示

{{warnings}}
