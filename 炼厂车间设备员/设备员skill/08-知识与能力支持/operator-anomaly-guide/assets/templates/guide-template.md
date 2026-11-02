# {{meta.workshop}} 设备异常识别与上报指引

发给：岗位操作工　｜　发现异常报告给：**{{reportPath.to}}**
编制：车间设备员（设备专业建议稿）　｜　审核：车间工艺 / 安全　｜　生成时间：{{meta.generatedAt}}（北京时间）

> **这张卡解决四件事：看什么、什么算异常、先做什么、找谁报。**
> 不要求你判断原因，也不要求你动手修。**看到不对，停下来，报上去。**

> 【注意】{{meta.statement}}

## 一、什么情况立即撤离并报警

**以下任一情况，不要犹豫，先撤离到上风向安全区，再报告：**

{{#emergency}}
- {{.}}
{{/emergency}}

紧急上报方式：**{{reportPath.emergency}}**（为空时写「【注意】紧急上报方式待车间补充」）

{{#sections}}
## {{n}}、{{type}}

**本车间该类设备**：{{equipment.tag}}（{{equipment.name}}）…

**日常观察要点**

- **看**：{{observe.看}}
- **听**：{{observe.听}}
- **摸**：{{observe.摸}}（`meta.noTouch` 为 true 时无此行，改写「【注意】本卡不含手摸类观察点」）
- **闻**：{{observe.闻}}

**什么情况算异常**

{{abnormalSigns}}

**发现异常先做什么**

{{immediateActions}}

> 【注意】{{actionNote}}
> 以上动作之外的处置（拆检、调整、更换、堵漏、用火等）**不属于操作工职责**，请勿自行实施。

{{/sections}}

## {{nReport}}、报告要说清的信息

报告给 **{{reportPath.to}}** 时，把下面几项说清楚：

{{reportPath.elements}}

> 说现象，不用说原因。

{{#outOfScope}}
## {{nBlocked}}、已拦截的超范围动作

| 原动作 | 规则 | 原因 | 替代 |
|---|---|---|---|
| {{original}} | {{ruleId}} | {{reason}} | {{suggestion}} |
{{/outOfScope}}

---

> {{meta.statement}}

> 相关技能：设备员自己做异常初判用 anomaly-triage-advisor；培训讲义与考题用 training-material-generator。

{{#warnings}}
## 附：生成提示

- {{.}}
{{/warnings}}
