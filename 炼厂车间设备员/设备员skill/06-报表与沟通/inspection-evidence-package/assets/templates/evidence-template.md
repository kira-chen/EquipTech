# {{workshop}} 迎检资料清单{{#inspection}}　{{inspection}}{{/inspection}}

{{#hasMissing}}
> **【注意】存在未找到对应材料的检查项，缺口项须如实向检查组说明；不得用相近材料充数，不得事后补编记录**

> 未找到对应材料 {{counts.missing}} 项{{#hasPartial}}，覆盖不全 {{counts.partialCoverage}} 项{{/hasPartial}}，明细见第三节。
{{/hasMissing}}
{{^hasMissing}}{{#hasPartial}}
> **【注意】有 {{counts.partialCoverage}} 个检查项的材料未完整覆盖检查期，须如实说明覆盖区间，不得按完整覆盖报送**
{{/hasPartial}}{{/hasMissing}}

## 一、检查基本信息

{{table:overview}}

## 二、逐检查项资料对照

{{table:items}}

## 三、资料缺口清单

{{table:missing}}

> 缺口项一律如实上报。**不得用相近材料充数，不得标注为「可用 XX 替代」，不得事后补编记录。**

## 四、覆盖不全项

{{table:partialCoverage}}

> 覆盖不全项按实际覆盖区间说明，**不得按完整覆盖报送**，缺口区间不得补录记录。

## 五、未对应材料

{{table:unmatched}}

## 六、归集包目录建议

{{collectionTree}}

> 缺口项不建目录。**不得建空目录后补放材料。**

## 七、准备工作提示

<!-- ANALYSIS_START -->
{{analysis}}
<!-- ANALYSIS_END -->

---

> 本清单基于所提供材料比对生成，资料的真实性、完整性由车间负责；缺失资料应如实说明，不得事后补编记录。

## 附：数据提示

{{warnings}}
