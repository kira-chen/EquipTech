# examples 回归测试数据

> 本目录仅开发包含有，发布包不含。由 `node scripts/make-sample.js --out examples` 再生（seed 改方案编号尾号、工期与人名，计数结论不变）。
> 本技能是**入口与衔接层**：`sample-overhaul-plan.json` 是**虚构的**检修方案数据（源技能 check.js 的输入），`sample-overhaul-result.json` 是 make-sample 调用依赖技能 `check.js` 对它跑出的**真实输出**（规则号与规则库同源，不手写），`*notes*.json` 是车间侧提示，用于回归 `merge-report.js`。`sample-overhaul-plan.docx` 是依赖技能 examples 中泵检修方案样例的副本（与 plan.json 不是同一份方案），供 docx2text 一步演示。

## 示例问题 ↔ 附件对照表

| # | 示例问题 | 附件 | 运行参数 | 预期结果 |
|---|---|---|---|---|
| 1 | 这份日常维修方案的安全措施够不够，帮我核一下 | `sample-overhaul-plan.docx`（走源技能）→ 得到 result.json；回归时直接用 `sample-overhaul-result.json` + `sample-workshop-notes.json` | `merge-report.js --result sample-overhaul-result.json --plan sample-overhaul-plan.json --notes sample-workshop-notes.json --repair-type 日常维修` | 缺失 3 / 建议完善 5 / 未判定 9 / 已有 36；findings 与源文件全等（含 advice、jobs）；方案编号与作业类型取自 plan.json，标签「动火」原值 + 加注「用火作业」；抬头显示检修分级；车间侧四项 已核实 / 未核实 / 不适用 / 已核实 |
| 2 | 这是大修方案，按老叫法报的 | `sample-overhaul-result.json` | `--repair-type 大修` | 映射为「大检修」并 warning；判定计数不变 |
| 3 | 源技能摘要写缺失 5 项，明细只有 3 条，以哪个为准 | `sample-overhaul-result-summary-mismatch.json` | `--result` 该文件 | warning「summary.must_fix=5 与 findings 重新计数 3 不一致」；报告按 3 计，源值 5 留在 `bridge.json.sourceSummary` |
| 4 | 班长说交出"应该够了"，我填进去了 | `sample-overhaul-result.json` + `sample-workshop-notes-bad.json` | `--notes sample-workshop-notes-bad.json` | 「应该够了」按「未核实」处理并 warning；自定义项「脚手架方案」追加并标「车间自查」 |
| 5 | 只发核查结果，车间那几项我还没核 | `sample-overhaul-result.json` | 不传 `--notes` | 四项全部「未核实」，车间自查项提示"待车间自查"；规则判定计数不变 |
| 6 | 依赖技能没装的情况下还能用吗 | 无 | `check-dependency.js --skill-root /不存在的路径` | `available:false`，note 要求告知用户并终止，不自行判定 |

## 关键验证点

1. **依赖缺失必须终止**：方案安全措施涉及安全红线，没有规则引擎支撑时宁可不给结论。
2. **结果不得改写**：`bridge.json.findings` 与源 `findings` JSON 全等（含 `name / advice / jobs`）；规则编号、级别、原文、顺序一致；源技能声明行原文在前，本技能声明行在后。
3. **标签原词可追溯**：源技能"动火"不改写，八大类"用火作业"只作加注。方案编号与作业类型取自 `--plan` 的 plan.json（源技能 result.json 不含这两项），不传时留空并 warning。
4. **检修分级只进抬头**：旧值映射 warning，非法值报错，不传不默认，任何分级都不改判定。
5. **分节呈现**：车间侧提示单独成节「车间侧补充提示（非规则判定）」，不传 notes 时全部「未核实」。
6. **作业票为准**：整改建议末尾固定提示各专项措施以开工时逐票办理的作业票为准。
7. **无 emoji**：提示用「【注意】」「【未判定】」。

## 再生样例

```bash
node scripts/make-sample.js --out examples            # 默认 seed=1
node scripts/make-sample.js --out examples --seed 7   # 方案编号/工期/人名变化，计数不变
```

## MCP 取数对照

本技能不调用业务系统 MCP，下表的方案取自平台知识库（`MCPServer/knowledge/平台知识库/01-设备资料/`），按 SKILL.md 先跑外部技能 overhaul-safety-check（docx2text 抽文本 → 抽取 plan.json 并向用户复述 → check.js 出 result.json），再跑 `merge-report.js`。方案内容固定，计数每天稳定。

| # | 示例问题 | MCP 调用 | 运行参数 | 预期结果 |
|---|---|---|---|---|
| M1 | 知识库 P-2101A 机械密封更换方案，日常维修，核安全措施；交出、备件已核实，交叉作业、承包商未核 | 不调用（平台知识库 + 外部技能 overhaul-safety-check） | `merge-report.js --result <check.js 输出>/result.json --plan <plan.json> --notes <notes.json> --repair-type 日常维修` | 外部核查与合并计数一致：缺失 0 / 建议完善 0 / 未判定 0 / 已有 38；方案编号 JX-P2101A-2026-11，作业类型「盲板抽堵、临时用电」并加注八大类名称；车间侧四项为 已核实 / 未核实 / 未核实 / 已核实；无 warning |
| M2 | 知识库 T-1201 塔盘检修方案，老叫法「大修」，缺哪些、怎么补；车间几项未核 | 不调用（同上） | `merge-report.js --result <result.json> --plan <plan.json> --repair-type 大修` | 「大修」映射为「大检修」并 warning；缺失 6（CS-004 受限空间气体检测安排、G-013 承包商资质审查、G-014 安全管理协议、G-017 交叉作业协调安排、HP-004 高处作业票办理安排、HW-005 动火分析安排）/ 建议完善 20 / 未判定 0 / 已有 28，逐条带「方案里怎么补」；作业类型含受限空间、动火（加注用火作业）、高处、吊装；车间侧四项全部「未核实」 |
