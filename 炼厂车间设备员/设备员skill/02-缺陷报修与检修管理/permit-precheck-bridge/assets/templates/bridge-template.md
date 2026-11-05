# 作业票预检结果（车间自查）

判定来源：规则引擎 precheck.js　｜　作业票：{{meta.objectName}}
自查时间：{{meta.generatedAt}}（北京时间）　｜　判定结果文件：{{meta.resultFile}}

## 一、预检结论（引自规则引擎 precheck.js）

> 以下内容原文引自规则引擎判定结果，本报告未做任何改写。

共检查 {{findings.length}} 项：必须整改 {{counts.must_fix}} 项，建议完善 {{counts.should_improve}} 项，未判定 {{counts.undetermined}} 项，通过 {{counts.pass}} 项。

{{table:sourceMeta}}

{{#sourceMeta.permitCategory=用火作业}}注：作业类型与规则原文沿用 GB 30871-2022 的「动火」一词，即《中国石化作业许可管理规定》的「用火作业」；为保证可追溯，规则原文照搬不替换。{{/sourceMeta.permitCategory}}
{{#counts.undetermined}}【注意】未判定项既不代表符合，也不代表不符合，需补齐信息后重新预检。{{/counts.undetermined}}

## 二、不符合项（必须整改 / 建议完善）

{{table:findings[must_fix|should_improve]}}

> 逐条照搬规则引擎结果，未合并、未归类、未调整级别。

## 三、未判定项

{{table:findings[undetermined]}}

> 【未判定】以上各项保持规则引擎的「未判定」状态，本报告不改写为符合或不符合；补齐字段后重新运行 precheck.js。

## 四、通过项

{{table:findings[pass]}}

## 五、车间侧补充提示（非规则判定）

> **以下为车间设备员关注项，不参与上述合规判定，不影响规则引擎结论。**

{{table:workshopNotes}}

## 六、整改建议

{{suggestions}}

## 附：抽取备注（原文，需人工确认）

{{extractionNotes}}

## 附：数据提示

{{warnings}}

---

> {{meta.sourceDisclaimer}}
> 预检为辅助自查，不替代安全部门审批；票据是否签发以审批人意见为准。

<!-- ANALYSIS_START -->
{{analysis}}
<!-- ANALYSIS_END -->
