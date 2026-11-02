# {{workshop}} 安全阀校验台账到期管理（基准日 {{date}}）

数据来源：{{source}}／校验台账 ｜ 统计类别：{{category}}{{#categoryDefaulted}}（默认，车间设备员归口）{{/categoryDefaulted}} ｜ 提前提醒：{{leadDays}} 天
生成时间：{{generatedAt}}（北京时间）　提交对象：车间设备主任 / 公司设备管理部门

> {{statement}}

{{#instrumentInScope}}【注意】{{ownershipNote}}{{/instrumentInScope}}

## 一、到期概览

| 指标 | 数量 |
|---|---|
| 台账记录（本次统计范围） | {{counts.total}} |
| 台账记录（文件总计） | {{counts.totalInLedger}} |
| 超期未校 | {{counts.overdue}} |
| 临期（{{leadDays}} 天内） | {{counts.dueSoon}} |
| 正常 | {{counts.normal}} |
| 不合格未整改 | {{counts.unresolvedFail}} |
| 待确认 | {{counts.undetermined}} |
| 其中：安全附件与安全仪表超期 | {{counts.safetyCriticalOverdue}} |
| 其中：计量/仪表类（仅台账提醒） | {{counts.instrumentItems}} |
| 送检批次 | {{counts.sendBatches}} |

## 二、超期清单

{{table:overdue}}

## 三、不合格未整改清单

{{table:unresolvedFail}}

## 四、临期清单

{{table:dueSoon}}

## 五、待确认项

{{table:undetermined}}

## 六、分类汇总

{{table:byCategory}}

## 七、送检批次建议

{{table:sendList}}

## 附一、台账下次校验日期与计算值不一致

{{table:nextMismatch}}

## 附二、证书编号重复

{{table:dupCerts}}

## 附三、校验证书归档核对

{{table:certs.missing}}

## 八、校验管理说明

<!-- ANALYSIS_START -->
{{analysis}}
<!-- ANALYSIS_END -->

## 附：数据提示

{{warnings}}
