# examples 回归测试数据

> 本目录仅开发包含有，发布包不含。由 `node scripts/make-sample.js --out examples` 再生（seed 改票号尾号、时间与人名，计数结论不变）。
> 本技能是**入口与衔接层**：`*.json` 是**虚构的**源技能 `result.json` 与车间侧 `notes.json`，只用于回归 `merge-report.js`；真实票面的规则判定仍要跑 `work-permit-precheck`。`sample-hotwork-permit.docx` 是依赖技能 examples 中用火（动火）票样例的副本，供端到端演示。

## 示例问题 ↔ 附件对照表

| # | 示例问题 | 附件 | 运行参数 | 预期结果 |
|---|---|---|---|---|
| 1 | 这张一级用火票帮我预检一下，设备交出我已经核过了 | `sample-hotwork-permit.docx`（走源技能）→ 得到 result.json；回归时直接用 `sample-permit-result.json` + `sample-workshop-notes.json` | `merge-report.js --result sample-permit-result.json --notes sample-workshop-notes.json --object "一级用火票"` | 必须整改 3 / 建议完善 2 / 未判定 1 / 通过 4；findings 与源文件全等；字段表加注「用火作业」而 type 原值仍为「动火」；车间侧三项分别 已核实 / 未核实 / 不适用 |
| 2 | 只发票，车间那几项我还没核 | `sample-permit-result.json` | 不传 `--notes` | 车间侧三项全部「未核实」并提示可接技能；规则判定计数不变 |
| 3 | 源技能的 summary 写的建议完善 5 项，但明细只有 2 条，以哪个为准 | `sample-permit-result-summary-mismatch.json` | `--result` 该文件 | warning「summary.should_improve=5 与 findings 重新计数 2 不一致」；报告按 2 计，源值 5 留在 `bridge.json.sourceSummary` |
| 4 | 这是射线探伤的票，也能转达吗 | `sample-permit-result-unknown-type.json` | `--result` 该文件 | 可转达；type「射线探伤」原值照搬，不在作业许可八大类 → `permitCategory: null` + warning，不强行归类 |
| 5 | 班长说交出"大概没问题"，我顺手填进去了 | `sample-permit-result.json` + `sample-workshop-notes-bad.json` | `--notes sample-workshop-notes-bad.json` | 「大概没问题」按「未核实」处理并 warning；自定义项「脚手架验收牌」追加并标「车间自查」 |
| 6 | 依赖技能没装的情况下还能用吗 | 无 | `check-dependency.js --skill-root /不存在的路径` | `available:false`，note 要求告知用户并终止，不自行判定 |

## 关键验证点

1. **依赖缺失必须终止**：作业票合规判定涉及安全红线，没有规则引擎支撑时宁可不给结论。
2. **结果不得改写**：`bridge.json.findings` 与源 `findings` JSON 全等；规则编号、级别、原文、顺序一致；源技能声明行原文在前，本技能声明行在后。
3. **票面原词可追溯**：源技能"动火"不改写，八大类"用火作业"只作加注。
4. **分节呈现**：车间侧提示单独成节「车间侧补充提示（非规则判定）」，不传 notes 时全部「未核实」。
5. **无 emoji**：提示用「【注意】」「【未判定】」。

## 再生样例

```bash
node scripts/make-sample.js --out examples            # 默认 seed=1
node scripts/make-sample.js --out examples --seed 7   # 票号/时间/人名变化，计数不变
```
