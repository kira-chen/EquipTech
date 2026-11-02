# {{workshop}} 承包商表现记录（{{from}} 至 {{to}}）

{{!-- 口径提示与名称待确认提示由脚本直接写入，非占位符；未提供厂内口径时必须出现，不得删除或弱化 --}}
{{#isDefaultRules}}
> 【注意】**口径提示**：本次评分**采用默认口径，非厂内正式口径，结果仅供参考**。默认口径见 `references/evaluation-rules.md`；如有厂内正式评分标准，请用 `--rules` 传入后重算（模板见 `assets/templates/rules-template.xlsx`）。
{{/isDefaultRules}}
{{^isDefaultRules}}
> **口径提示**：本次评分采用厂内口径（{{rulesFile}}）。
{{/isDefaultRules}}

{{#hasNameAmbiguity}}
> 【注意】**名称待确认**：发现 {{counts.nameAmbiguity}} 组疑似同一单位的承包商名称，**脚本未作合并**，各名称分别统计，详见「五、承包商名称待确认」。合并与否须人工确认。
{{/hasNameAmbiguity}}

评价区间：{{from}} 至 {{to}} ｜ 车间：{{workshop}}{{#contractorFilter}} ｜ 承包商筛选：{{contractorFilter}}{{/contractorFilter}}
评分口径：{{rulesSource}} ｜ 基准分 {{rules.baseScore}} 分 ｜ 分档：{{gradesSource}}
报送对象：承包商考核由安全环保部门归口、业务主管部门配合；本记录为车间（属地单位）侧记录{{#groupedByCode}} ｜ 分组方式：有承包商编码的记录按编码分组{{/groupedByCode}}
数据来源：{{input}} ｜ 生成时间：{{generatedAt}}（北京时间）

**本数据为车间（属地单位）侧记录汇总，承包商考核由安全环保部门归口、业务主管部门配合，分档定性与处罚按厂内制度决定；评分口径若非厂内正式口径，结果仅供参考。**

## 一、评价区间与口径说明

{{table:meta}}

**默认扣分口径**（`--rules` 未传入时生效）

{{table:rules.deduct}}

**分档标准**

{{table:rules.grades}}

## 二、各承包商得分汇总

{{#isDefaultRules}}
_下表得分**采用默认口径，非厂内正式口径，结果仅供参考**；正式考核、分档定性与处罚由安全环保部门归口按厂内制度决定。_
{{/isDefaultRules}}

{{table:byContractor}}

_「未判定条数」为严重程度或类型缺失、未参与扣分的记录条数；这些记录**未按最低档计分**，见「六、未判定记录」。_

## 三、违章明细

_按严重程度分组列出安全违章维度的记录。_

**重大违章（{{violations.major.length}} 条）**

{{table:violations.major}}

**严重违章（{{violations.serious.length}} 条）**

{{table:violations.serious}}

**一般违章（{{violations.minor.length}} 条）**

{{table:violations.minor}}

**严重程度未判定（{{violations.undetermined.length}} 条）**

{{table:violations.undetermined}}

## 四、未整改项

_整改情况填报为未整改 / 整改中的记录，须继续跟踪至整改闭环。_

{{table:unrectified}}

## 五、承包商名称待确认

_同一单位可能以全称与简称混用登记。脚本仅列出疑似同一单位的名称组，**未作任何合并统计**；是否为同一单位须人工确认后，由安全环保部门在汇总时处理。有「承包商编码」的记录已按编码分组，不在此列。_

{{table:nameAmbiguity}}

## 六、未判定记录

_严重程度或记录类型缺失、或日期无法确认归属区间的记录，**不计分、不按最低档处理**，须补齐字段后重新统计。_

{{table:undetermined}}

{{#orderStats}}
## 七、工单履约情况（参考）

_来自工单台账，仅作参考展示，**不参与评分**。_

{{table:orderStats}}
{{/orderStats}}

## {{analysisSectionNo}}、评价说明

<!-- ANALYSIS_START -->
{{analysis}}
<!-- ANALYSIS_END -->

{{!-- 评价说明写作要求：250~400 字，六段结构（评价区间与口径 → 各承包商记录与得分 → 违章记录情况 →
      未整改项 → 名称待确认与未判定项 → 提请安全环保部门/业务主管部门核实事项）。
      只陈述记录事实，**不得使用「该队伍能力差」「不建议再用」这类定性判断**；
      分值、条数一律引用 performance.json。措辞对照表见 references/evaluation-rules.md 第七节。 --}}

## 附：数据提示

{{warnings}}

---

**本数据为车间（属地单位）侧记录汇总，承包商考核由安全环保部门归口、业务主管部门配合，分档定性与处罚按厂内制度决定；评分口径若非厂内正式口径，结果仅供参考。**
