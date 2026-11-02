<!-- 版式参考模板。占位符与 status.json 键名一致（meta.*、counts.*、byEquipment/abnormal/missed/conflicts/unknownState/changed/warnings）。
     脚本 digest.js 直接生成 digest.md，不读取本模板；用户要求调整版式时据此改脚本输出段落。 -->
# {{meta.workshop}} 设备状态一览（{{meta.date}}）

数据来源：{{meta.sources}}{{#meta.shift}} ｜ 班次：{{meta.shift}}{{/meta.shift}}{{#meta.shiftWindow}} ｜ 班次日起算 {{meta.shiftWindow}}（夜班跨 0 点记录归前一班次日）{{/meta.shiftWindow}}
判定依据：{{meta.basisUsed}} ｜ 生成时间：{{meta.generatedAt}}（北京时间）

## 一、状态概览

| 指标 | 数量 |
|---|---|
| 记录条数 | {{counts.records}} |
| 涉及设备 | {{counts.equipment}} |
| 运行 | {{counts.sixTier.运行}} |
| 备用 | {{counts.sixTier.备用}} |
| 检修 | {{counts.sixTier.检修}} |
| 停用 | {{counts.sixTier.停用}} |
| 异常 | {{counts.sixTier.异常}} |
| 未判定 | {{counts.sixTier.未判定}} |
| 特护设备（其中异常） | {{counts.special}}（{{counts.specialAbnormal}}） |
| 漏检 | {{counts.missed}} |
| 记录冲突 | {{counts.conflicts}} |

## 二、异常项清单

{{table:abnormal}}  <!-- 列：tag(特护前缀 special) name area discipline desc source time by -->

## 三、漏检清单

{{table:missed}}  <!-- 列：tag name area discipline；meta.ledgerProvided=false 时写"未提供设备台账，无法识别漏检设备" -->

## 四、记录冲突

{{conflicts}}  <!-- 每台：tag name basis + records 表（param source result value time by sheet row） -->

## 五、未判定项

{{table:unknownState}}  <!-- 列：tag name rawResults reason -->

## 六、状态变化

{{table:changed}}  <!-- 列：tag name from to；changed=null 时写"未提供上一日 status.json" -->

## 七、设备状态分析

<!-- ANALYSIS_START -->
（模型撰写 200~400 字）
<!-- ANALYSIS_END -->

## 附：数据提示

{{warnings}}

---
本材料由脚本汇总、模型成文，仅供设备员复核参考，不替代审批、定性、验收与签字；厂内制度与系统数据为准。
