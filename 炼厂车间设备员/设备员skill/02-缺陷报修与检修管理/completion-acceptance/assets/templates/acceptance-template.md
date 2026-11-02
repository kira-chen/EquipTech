# 检修完工验收报告　{{meta.tag}} {{meta.name}}

{{#hasUnqualified}}
> 【注意】**存在 {{counts.unqualified}} 项不合格，整改并复验合格前设备不得投用。** 明细见「四、不合格项与整改要求」。
{{/hasUnqualified}}
{{^meta.typeCovered}}
> 【注意】**设备类型「{{meta.equipTypeInput}}」不在规则库覆盖范围内，本清单仅为通用验收框架**，标注「待技术人员补充」的技术指标须由技术人员按设备技术文件补充后方可使用。
{{/meta.typeCovered}}
{{#hasQcGap}}
> 【注意】**检修方案中有 {{counts.qcGap}} 个质量控制点未找到对应验收项**，见「六、与检修方案质量控制点对应情况」。
{{/hasQcGap}}

验收单编号：{{meta.no}}{{^meta.noProvided}}（临时编号，以厂内编号为准）{{/meta.noProvided}}　生成时间：{{meta.generatedAt}}（北京时间）

## 一、设备与检修概况

| 项目 | 内容 |
|---|---|
| 位号 | {{meta.tag}} |
| 设备名称 | {{meta.name}} |
| 所属车间 | {{meta.workshop}} |
| 设备类型 | {{meta.equipTypeInput}} |
| 检修分级 | {{meta.repairType}} |
| 检修内容 | {{meta.scope}} |
| 检修内容特征 | {{meta.scopeFlagsCn}} |
| 承修单位 | {{meta.contractor}} |
| 完工时间 | {{meta.finishedAt}} |
| 是否试压 | {{meta.pressureTest}} |
| 是否试运 | {{meta.trialRun}} |
| 是否特种设备 | {{meta.specialEquipment}} |

## 二、验收项逐项结果

共 {{counts.items}} 项：{{counts.byCategory}}。

**「验收结果」栏留空，由验收组现场逐项填写（合格／不合格），脚本不预填。**

{{#categories}}
### {{categoryCn}}

{{table:items[category]}}
{{/categories}}

## 三、应附资料核对

**「是否提供」栏留空，由验收组核对后填写。**

{{table:requiredRecords}}

## 四、不合格项与整改要求

{{table:unqualified}}

## 五、未填写与未判定项

未填写验收结果：{{counts.pending}} 项；验收结果无法归类：{{counts.undeterminedResult}} 项。

{{table:undeterminedResult}}

{{table:unmatchedRecord}}

## 六、与检修方案质量控制点对应情况

{{qcSection}}

## 七、遗留问题

<!-- ANALYSIS_START -->
{{analysis}}
<!-- ANALYSIS_END -->

## 八、验收结论

**以下由验收组填写，脚本不预填。**

| 项目 | 填写栏 |
|---|---|
| 验收结论（合格／不合格／限期整改后复验） | 　 |
| 是否同意投用 | 　 |
| 结论说明 | 　 |
| 验收日期 | 　 |

## 九、三级验收签字

_按三级验收（班组 / 车间 / 公司设备管理部门）执行，工艺（操作）方参与，承修单位签认；日常维修无监理。签字人与日期由现场填写。_

| 签字方 | 签字人 | 日期 | 说明 |
|---|---|---|---|
| 班组（一级验收） | 　 | 　 | 　 |
| 车间（二级验收，车间设备员/设备主任） | 　 | 　 | 　 |
| 公司设备管理部门（机动部/设备部，三级验收） | 　 | 　 | {{signatures[2].note}} |
| 工艺（操作） | 　 | 　 | 　 |
| 承修单位 | 　 | 　 | 　 |

## 附：数据提示

{{warnings}}

---

本清单为辅助核对工具，验收结论须由验收组现场确认并签字；未完成签字前设备不得投用。
