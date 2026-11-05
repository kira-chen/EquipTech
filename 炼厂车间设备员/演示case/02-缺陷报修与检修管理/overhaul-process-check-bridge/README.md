# 车间检修方案安全措施核查（overhaul-process-check-bridge）· 演示与回归样例

> 本目录仅开发包含有，发布包不含。全部文件由 `node scripts/make-sample.js` 再生，数据均为虚构（单位写「某甲公司」、人名写「王某某」、电话写「内线 0001」这类明显的假号）。不传 `--seed` 生成的就是入库版本；`--seed <n>` 改方案编号、工期、承修单位、人名与作业顺序，下表计数不变。

本目录有两组样例：

- **规则引擎端到端回归**：`cdu-overhaul.*`、`pump-repair.*` 各四件——方案 Word（`*.docx`）、docx2text 读回结果（`*.docx2text.txt`）、按抽取手册抽取的 plan.json（`*.json`）、check.js 期望报告（`*.expected-report.md`，"生成时间"一行比对时忽略）。两份方案是教学用的结构化理想形态：措施逐条分项、作业表列齐类型标签；真实方案多为整段叙述，抽取时按 `references/extraction-guide.md` 第四节处理。方案正文与规则库沿用 GB 30871 的「动火」写法，即中石化的「用火作业」。
- **合并报告样例**：`sample-overhaul-plan.json` 是 E-1201 换热器检修方案的抽取结果，`sample-overhaul-result.json` 是本技能 `check.js` 对它跑出的**真实输出**（不手写），`sample-overhaul-result-summary-mismatch.json` 是 summary 故意不一致的变体，`sample-workshop-notes*.json` 是车间侧提示。`sample-overhaul-plan.docx` 与 `pump-repair.docx` 是同一份机泵检修方案（与 sample-overhaul-plan.json 不是同一份）。

## 回归样例与期望计数

| 样例 | 方案 | 期望计数（缺失 / 建议完善 / 未判定 / 已有） | 跳过 | 要点 |
|---|---|---|---|---|
| `cdu-overhaul` | 常减压装置停工大检修方案：9 项作业（塔内件更换含受限空间+高处+用火、填料更换、炉管更换、换热器抽芯吊装、空冷器更换、盲板抽堵、罐内防腐、临时用电、射线探伤），工期 45 天 | 4 / 3 / 0 / 56 | 7 | 故意缺失：受限空间气体检测安排（CS-004）、吊装方案（LF-001）、动火分析安排（HW-005）、监火人（HW-006）→ 缺失；应急演练（G-009）、吊装场地确认（LF-004）、双票联办提示（C-001）→ 建议完善；工期 >30 天且写了每周安全大检查 → C-003 已有 |
| `pump-repair` | 机泵单体检修方案：3 项作业（泵解体检修「无特殊作业」、进出口盲板抽堵、临时电源接引），工期 5 天，自行检修 | 0 / 1 / 0 / 37 | 32 | 仅缺施工平面布置图（G-028）；资质与协议写「不适用+理由」长句按已写明 |
| `sample-overhaul` | E-1201 抽管束清洗及法兰补焊方案（`sample-overhaul-plan.json`） | 3 / 5 / 9 / 36 | — | 缺风险辨识 / JSA、用火点可燃物清理、盲板图；「空冷器管束顶部检查」未标作业类型 → 9 条未判定（按作业类型聚合） |

自测（`scripts/selftest.js` 的 R 节）对每份回归样例检查：docx2text 输出与入库 `*.docx2text.txt` 一致（忽略"来源"行）、check.js 计数与跳过数与上表一致、`report.md` 与 `*.expected-report.md` 一致；另检查 `sample-overhaul-result.json` 与 check.js 对 `sample-overhaul-plan.json` 的真实输出一致。

## 示例问题 ↔ 附件对照表

| # | 示例问题 | 附件 | 运行参数 | 预期结果 |
|---|---|---|---|---|
| 1 | P-102 泵解体检修方案，日常维修，核安全措施，设备交出已核实 | `sample-overhaul-plan.docx` | docx2text → 抽取（可对照 `pump-repair.json`）→ `check.js` → `merge-report.js --plan <plan.json> --notes <notes.json> --repair-type 日常维修` | 缺失 0 / 建议完善 1（G-028 施工平面布置图）/ 未判定 0 / 已有 37；车间侧「设备交出条件」已核实，其余未核实 |
| 2 | 常减压装置停工大检修方案，塔内和炉膛要用火，重点看受限空间和用火措施 | `cdu-overhaul.docx` | docx2text → 抽取（可对照 `cdu-overhaul.json`）→ `check.js` → `merge-report.js --repair-type 大检修` | 4 缺失（CS-004、HW-005、HW-006、LF-001）+ 3 建议完善；C-001 双票联办提示；作业类型标签「动火」加注「用火作业」 |
| 3 | 核查结果已跑出，车间四项核实情况在附件，合成车间自查报告 | `sample-overhaul-result.json` + `sample-workshop-notes.json` | `merge-report.js --result sample-overhaul-result.json --plan sample-overhaul-plan.json --notes sample-workshop-notes.json --repair-type 日常维修` | 缺失 3 / 建议完善 5 / 未判定 9 / 已有 36；findings 与 result.json 全等（含 advice、jobs）；方案编号与作业类型取自 plan.json；车间侧四项 已核实 / 未核实 / 不适用 / 已核实 |
| 4 | 按老叫法报的"大修"方案 | `sample-overhaul-result.json` | `--repair-type 大修` | 映射为「大检修」并 warning；判定计数不变 |
| 5 | 班长说交出"应该够了"，填进了车间侧提示 | `sample-overhaul-result.json` + `sample-workshop-notes-bad.json` | `--notes sample-workshop-notes-bad.json` | 「应该够了」按「未核实」处理并 warning；自定义项「脚手架方案」追加并标「车间自查」 |
| 6 | 摘要写缺失 5 项，明细只有 3 条 | `sample-overhaul-result-summary-mismatch.json` | `--result` 该文件 | warning「summary.must_fix=5 与 findings 重新计数 3 不一致」；报告按 3 计，原值 5 留在 `bridge.json.sourceSummary` |
| 7 | 大检修工期超一个月，阶段性检查、应急演练有没有漏 | `cdu-overhaul.docx` | 同第 2 题 | C-003 已有（方案写了每周五安全大检查）；G-009 应急演练建议完善 |
| 8 | 只口述方案要点，无附件 | 无 | 按口述填 plan.json → `check.js` | 没说到的措施按缺失 / 未判定列出，不猜测 |
| 9 | "高处"专项未判定，能否当作没问题 | `sample-overhaul-result.json` | 同第 3 题 | UND-高处 保持未判定，【注意】提示补标作业类型后重新核查 |
| 10 | 车间几项还没核，先出报告 | `sample-overhaul-result.json` | 不传 `--notes` | 四项全部「未核实」，车间自查项提示"待车间自查"；判定计数不变 |
| 11 | 只有扫描 PDF | `sample-overhaul-plan.docx` | 先转 docx / txt | 脚本不读 PDF，扫描件需 OCR |
| 12 | 方案核查通过了，开工还要预检作业票吗 | `pump-repair.docx` | 同第 1 题 | 整改建议 / 声明提示各专项措施以开工时逐票办理的作业票为准，作业票预检用 permit-precheck-bridge |

## 关键验证点

1. **判定只由规则引擎出**：check.js 按规则库判定，模型只抽取、复述与写说明；node 不可用时终止，不凭经验给结论。
2. **结果不得改写**：`bridge.json.findings` 与 `result.json` 的 `findings` JSON 全等（含 `name / advice / jobs`）；规则编号、级别、原文、顺序一致；规则引擎声明行原文在前，本技能声明行在后。
3. **标签原词可追溯**：规则库与 plan.json 的标签「动火」不改写，八大类「用火作业」只作加注。方案编号与作业类型取自 `--plan` 的 plan.json（result.json 不含这两项），不传时留空并 warning。
4. **未判定不默认**：未标注作业类型、工期为空或写成日期区间时出未判定，按作业类型聚合，不按已有或缺失处理。
5. **检修分级只进抬头**：旧值映射 warning，非法值报错，不传不默认，任何分级都不改判定。
6. **分节呈现**：车间侧提示单独成节「车间侧补充提示（非规则判定）」，可选；不传 notes 时全部「未核实」。
7. **作业票为准**：整改建议末尾固定提示各专项措施以开工时逐票办理的作业票为准。
8. **无 emoji**：提示用「【注意】」「【未判定】」。

## 再生样例

```bash
node scripts/make-sample.js            # 入库版本（合并报告样例 seed=1，回归样例为基准）
node scripts/make-sample.js --seed 7   # 方案编号 / 工期 / 人名 / 作业顺序变化，计数不变
```

## MCP 取数对照

本技能不调用业务系统 MCP，下表的方案取自平台知识库（`MCPServer/knowledge/平台知识库/01-设备资料/`），按 SKILL.md 用本技能 docx2text 抽文本 → 抽取 plan.json 并向用户复述 → check.js 出 result.json，再跑 `merge-report.js`。方案内容固定，计数每天稳定。

| # | 示例问题 | MCP 调用 | 运行参数 | 预期结果 |
|---|---|---|---|---|
| M1 | 知识库 P-2101A 机械密封更换方案，日常维修，核安全措施；交出、备件已核实，交叉作业、承包商未核 | 不调用（平台知识库 + 本技能 docx2text、check.js） | `merge-report.js --result <check.js 输出>/result.json --plan <plan.json> --notes <notes.json> --repair-type 日常维修` | 核查与合并计数一致：缺失 0 / 建议完善 0 / 未判定 0 / 已有 38；方案编号 JX-P2101A-2026-11，作业类型「盲板抽堵、临时用电」并加注八大类名称；车间侧四项为 已核实 / 未核实 / 未核实 / 已核实；无 warning |
| M2 | 知识库 T-1201 塔盘检修方案，老叫法「大修」，缺哪些、怎么补；车间几项未核 | 不调用（同上） | `merge-report.js --result <result.json> --plan <plan.json> --repair-type 大修` | 「大修」映射为「大检修」并 warning；缺失 6（CS-004 受限空间气体检测安排、G-013 承包商资质审查、G-014 安全管理协议、G-017 交叉作业协调安排、HP-004 高处作业票办理安排、HW-005 动火分析安排）/ 建议完善 20 / 未判定 0 / 已有 28，逐条带「方案里怎么补」；作业类型含受限空间、动火（加注用火作业）、高处、吊装；车间侧四项全部「未核实」 |
