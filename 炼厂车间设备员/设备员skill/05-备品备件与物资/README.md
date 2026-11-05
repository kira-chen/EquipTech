# 05 备品备件与物资

备件是设备员与物资部门的接口，三个技能对应"要多少、有没有、用了多少"。

| # | 技能目录 | 中文名 | 一句话 | 难度 | 批次 | 状态 |
|---|---|---|---|---|---|---|
| 1 | `spare-parts-demand` | 备件需求提报 | 按检修计划与历史消耗推算需求，生成申报清单 | 低 | 二 | ✅ 240 条断言 |
| 2 | `spare-parts-inventory-query` | 库存查询与代用提示 | 查库存在途，无货时列同规格候选与需确认的技术要点 | 低 | 二 | ✅ 138 条断言 |
| 3 | `spare-parts-consumption-analysis` | 消耗统计分析 | 按设备与品类统计消耗，识别异常增长项 | 中 | 三 | ✅ 157 条断言 |

## 边界提示
`spare-parts-inventory-query` **只列代用候选与技术差异点，不给"可以代用"的结论**，代用可行性须由设备工程师判定。`spare-parts-consumption-analysis` 识别出的消耗异常设备，建议接 02 类的 `repeat-failure-detector` 做重复故障核查。


## 实现状态

本类 **3 / 3** 个技能已完整实现（Node 脚本 + selftest + references + 演示case 样例），合计 **535** 条断言全绿。
