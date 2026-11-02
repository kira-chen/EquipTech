# 作业票预检结果（车间自查）

调用技能：`work-permit-precheck`　｜　作业票：{{meta.objectName}}
自查时间：{{meta.generatedAt}}（北京时间）　｜　源结果文件：{{meta.resultFile}}

## 一、预检结论（引自 work-permit-precheck）

> 以下内容原文引自源技能判定结果，本技能未做任何改写。

共检查 {{findings.length}} 项：必须整改 {{counts.must_fix}} 项，建议完善 {{counts.should_improve}} 项，未判定 {{counts.undetermined}} 项，通过 {{counts.pass}} 项。

{{table:sourceMeta}}

{{#counts.undetermined}}【注意】未判定项既不代表符合，也不代表不符合，需补齐信息后重新预检。{{/counts.undetermined}}

## 二、不符合项（必须整改 / 建议完善）

{{table:findings[must_fix|should_improve]}}

> 逐条照搬源技能结果，未合并、未归类、未调整级别。

## 三、未判定项

{{table:findings[undetermined]}}

> 【未判定】以上各项保持源技能的「未判定」状态，本技能不改写为符合或不符合；补齐字段后重新运行源技能。

## 四、通过项

{{table:findings[pass]}}

## 五、车间侧补充提示（非规则判定）

> **以下为车间设备员关注项，不参与上述合规判定，不影响源技能结论。**

{{table:workshopNotes}}

## 六、整改建议

{{suggestions}}

## 附：源技能抽取说明（原文）

{{extractionNotes}}

## 附：数据提示

{{warnings}}

---

> {{meta.sourceDisclaimer}}
> 预检为辅助自查，不替代安全部门审批；票据是否签发以审批人意见为准。

<!-- ANALYSIS_START -->
{{analysis}}
<!-- ANALYSIS_END -->
