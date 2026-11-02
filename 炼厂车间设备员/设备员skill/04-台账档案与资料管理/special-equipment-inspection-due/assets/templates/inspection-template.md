# {{workshop}} 特种设备定检到期管理（基准日 {{date}}）

{{#hasOverdue}}> **【注意】存在超期未检特种设备，超期使用违反《特种设备安全法》，应立即停用并报检**{{/hasOverdue}}

台账文件：{{input}} ｜ 提前提醒：{{leadDays}} 天{{#categoryFilter}} ｜ 仅统计：{{categoryFilter}}{{/categoryFilter}}
生成时间：{{generatedAt}}（北京时间）　提交对象：车间设备主任 / 公司设备管理部门（特种设备管理员）

## 一、到期概览

| 指标 | 数量 |
|---|---|
| 台账设备总数 | {{counts.total}} |
| 已超期 | {{counts.overdue}} |
| 临期（{{leadDays}} 天内） | {{counts.dueSoon}} |
| 周期内正常 | {{counts.normal}} |
| 待核实（未判定） | {{counts.undetermined}} |
| 其中：储罐待核实 | {{counts.tankSuspect}} |
| 日期不一致 | {{counts.dateConflict}} |
| 监控使用 | {{counts.monitored}} |
| 应停用 | {{counts.stopped}} |
| 年度检查超期 | {{counts.annualOverdue}} |
| 遗留整改项 | {{counts.openIssues}} |

按设备类别：

{{table:byCategory}}

## 二、超期清单

{{#hasOverdue}}**【注意】存在超期未检特种设备，超期使用违反《特种设备安全法》，应立即停用并报检**{{/hasOverdue}}

{{table:overdue}}

## 三、临期清单（{{leadDays}} 天内到期）

{{table:dueSoon}}

## 四、检验日期不一致项

{{table:dateConflict}}

## 五、待核实项（周期或到期日无法确定）

{{table:undetermined}}

## 六、遗留整改项

{{table:openIssues}}

## 七、年度检查到期（使用单位年度检查，车间设备员主责）

{{#annualCheck}}{{annualCheck.note}}。

{{table:annualCheck}}{{/annualCheck}}{{^annualCheck}}_台账无「上次年度检查日期」列，本节不出数。_{{/annualCheck}}

## 八、监控使用与应停用设备

{{table:monitoredAndStopped}}

## 九、检验报告归档核对

{{table:reportsMissing}}

## 十、定检管理说明

<!-- ANALYSIS_START -->
{{analysis}}
<!-- ANALYSIS_END -->

---

> 检验周期为默认参考口径，**以现行有效法规与检验机构报告载明为准**；本报告由脚本汇总、模型成文，仅供车间设备员复核参考，不判定检验结论与安全状况等级，不认可任何形式的超期使用；报检手续由特种设备管理员办理。

## 附：数据提示

{{warnings}}
