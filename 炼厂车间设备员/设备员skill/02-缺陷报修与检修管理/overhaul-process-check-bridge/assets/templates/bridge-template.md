# 检修方案安全措施核查结果（车间自查）

规则引擎：`check.js`　｜　检修方案：{{meta.objectName}}　｜　检修分级：{{meta.repairType}}
自查时间：{{meta.generatedAt}}（北京时间）　｜　结果文件：{{meta.resultFile}}

## 一、核查结论（引自规则引擎 check.js）

> 以下内容原文引自规则引擎（check.js）的判定结果，合并时未做任何改写。

共核查 {{findings.length}} 项：缺失（必须补充）{{counts.must_fix}} 项，建议完善 {{counts.should_improve}} 项，未判定 {{counts.undetermined}} 项，已有 {{counts.pass}} 项。

{{table:sourceMeta}}

{{#counts.undetermined}}【注意】未判定项既不代表措施已有，也不代表缺失，需补齐方案信息（作业类型标注、工期等）后重新核查。{{/counts.undetermined}}

## 二、措施缺失项（缺失 / 建议完善）

{{table:findings[must_fix|should_improve]}}

> 逐条照搬规则引擎结果，未合并、未归类、未调整级别。

## 三、未判定项

{{table:findings[undetermined]}}

> 【未判定】以上各项保持规则引擎的「未判定」状态，合并时不改写为已有或缺失；补齐方案信息后重新运行 check.js。

## 四、已有措施

{{table:findings[pass]}}

## 五、车间侧补充提示（非规则判定）

> **以下为车间设备员关注项，不参与上述合规判定，不影响规则引擎结论。**

{{table:workshopNotes}}

## 六、整改建议

{{suggestions}}

各专项措施最终仍以开工时逐票办理的作业票为准（作业票预检用 permit-precheck-bridge）。

## 附：抽取说明（原文）

{{extractionNotes}}

## 附：数据提示

{{warnings}}

---

> {{meta.sourceDisclaimer}}
> 核查为辅助自查，不替代技术负责人审核与安全部门审批；方案是否批准以审批人意见为准。

<!-- ANALYSIS_START -->
{{analysis}}
<!-- ANALYSIS_END -->
