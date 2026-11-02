# {{workshop}} 自查表预填说明　{{formSource}}

{{#needConfirm}}
> **【注意】本自查表结构复杂（合并单元格较多或表头层次多），预填结果须先与用户核对解析是否正确，确认后再填写提交**

> 复杂之处：{{complexReasons}}。
{{/needConfirm}}
{{#hasJudgment}}
> **【注意】存在须责任人判断的自查项，脚本一律留空未填；不得以「符合」「已落实」「健全」等表述代填**

> 需责任人判断 {{counts.needJudgment}} 项{{#hasNoData}}，缺数据留空 {{counts.noData}} 项{{/hasNoData}}{{#hasUnparsed}}，无法解析 {{counts.unparsed}} 项{{/hasUnparsed}}，明细见第三、四节。
{{/hasJudgment}}

## 一、基本信息

{{table:overview}}

## 二、已预填项与数据来源

{{table:prefilled}}

> 预填内容只是台账事实的搬运，**不代表该项合规达标**；提交前须逐项核对数据来源，核对无误后由责任人确认。

## 三、需责任人判断项（脚本一律留空）

{{table:needJudgment}}

> 以上各项脚本**一个字都没有填**。**不得以「符合」「已落实」「健全」「到位」等表述代填**，须由责任人核实实际情况后本人填写。

## 四、缺数据留空项

{{table:noData}}

> 缺数据就是缺数据。**绝不按「符合」「无」「正常」处理**，也不得用其他台账推算代替。

## 五、无法解析项

{{table:unparsed}}

> 无法判定类型的自查项，脚本未做任何猜测性填写，请人工确认后填写。

## 六、填写与提交提示

<!-- ANALYSIS_START -->
（由模型依据 references/fill-rules.md 口径撰写 200~400 字，结构：预填覆盖情况 → 需责任人判断项的填写要点 → 缺数据项要补什么台账 → 提交前的核对与签字提醒。数字一律引用 filled.json 的 counts；不做合规达标判定；不代填判断类项；不代替责任人签字。）
<!-- ANALYSIS_END -->

---

> 本表为预填稿，判断类项目与最终结论须由责任人核实填写并签字；预填内容需逐项核对后方可提交。

{{#hasWarnings}}
## 附：数据提示

{{list:warnings}}
{{/hasWarnings}}
