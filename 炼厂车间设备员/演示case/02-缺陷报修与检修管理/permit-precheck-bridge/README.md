# 车间作业票预检（permit-precheck-bridge）· 演示与回归样例

> 本目录仅开发包含有，发布包不含。由 `node scripts/make-sample.js` 再生（seed 只改合并报告样例的票号尾号、时间与人名，计数结论不变）。全部为虚构数据：装置、位号、人名、票号、证书号都是演示用占位（证书号形如 `TZ-2026-0001`、`QG-2023-118`）。

## 文件说明

| 文件 | 内容 | 用途 |
|---|---|---|
| `<案例>.docx` | 9 张 Word 作业票，版式按 GB 30871 作业证（用火票印"动火安全作业证"），问题项表现为空白栏；三种勾选框写法（内容控件 / ☑☐ 字符 / Wingdings 符号） | 读票演示、docx2text 回归 |
| `<案例>.json` | 按 `references/extraction-guide.md` 抽取的 permit.json（基准数据，手工维护） | 规则引擎输入，代替模型抽取结果 |
| `<案例>.docx2text.txt` | `docx2text.js` 读回结果 | 回归比对 |
| `<案例>.expected-report.md` | `precheck.js --now 2026-08-28T08:50:00+08:00` 的报告 | 回归比对（忽略生成时间行） |
| `sample-hotwork-permit.docx` | 一级用火票 Word 样例，与 `hotwork-level1-with-issues.docx` 票面相同 | 示例问题 1、16、17 |
| `sample-permit-result*.json` | 虚构的规则引擎 `result.json`（含 summary 不一致、type 不在八大类两个变体） | 只回归 `merge-report.js` |
| `sample-workshop-notes*.json` | 车间侧 `notes.json`（正常与状态不合法两份） | `--notes` |

## 示例问题 ↔ 附件对照表

docx 题目统一按 `docx2text.js` 读票 → 用同名 `<案例>.json` 作为抽取结果 → `precheck.js --input <案例>.json --out <dir> --now 2026-08-28T08:50:00+08:00` → `merge-report.js --result <dir>/result.json`，计数为必须整改 / 建议完善 / 未判定 / 通过。

| # | 示例问题 | 附件 | 运行参数 | 预期结果 |
|---|---|---|---|---|
| 1 | F-101 转油线膨胀节焊补一级用火票预检，设备交出已核过 | `sample-hotwork-permit.docx` | 按上述链路，抽取结果用 `hotwork-level1-with-issues.json`；车间侧把设备交出写成「已核实」后传 `--notes` | 3 / 2 / 1 / 39；必须整改 G-011（监护人空白）、HW-012（有效期 10 h）、HW-019（受限空间内动火未关联受限空间票）；建议完善 G-019、HW-005；未判定 G-022（监护人为空无法判定兼任）；字段表 type「动火」、加注「用火作业」 |
| 2 | 受限空间票 + 用火票，同一分馏塔内焊补，分别预检并看关联 | `confined-space-t201.docx + hotwork-t201-inside.docx` | 两张票分别跑链路 | 受限票 0 / 0 / 0 / 45；用火票 2 / 1 / 0 / 42（HW-005 分析距开工 75 min、HW-012 有效期 13 h、HW-029 气瓶间距未勾）；两票互相写了对方票号（CS-014 / HW-019 通过）；模型须另行人工指出：用火票结束 22:00 晚于受限票 20:30、用火票分析 07:45 早于受限票最近一次 08:10，并标明是人工比对 |
| 3 | 夜班 22 点开始的二级用火票，级别与夜间升级 | `hotwork-level2-night.docx` | 按上述链路 | 2 / 1 / 0 / 39；HW-002 必须整改（夜间二级应升级管理）、HW-014 消防器材未勾；G-024 循环水无爆炸下限 → 建议完善；票面「夜间照明/警示灯」行未勾无规则判定，靠模型人工提醒 |
| 4 | 预检结果已跑出，车间三项核实情况在附件，合成车间自查报告 | `sample-permit-result.json + sample-workshop-notes.json` | `merge-report.js --result sample-permit-result.json --notes sample-workshop-notes.json --object "一级用火票"` | 3 / 2 / 1 / 4；findings 与原文件全等；字段表加注「用火作业」而 type 原值仍为「动火」；车间侧三项分别 已核实 / 未核实 / 不适用 |
| 5 | 盲板抽堵票 3 块盲板，无盲板图、材质厚度空白 | `blind-plate-3.docx` | 按上述链路 | 2 / 1 / 0 / 30；BP-003 未附盲板图、BP-007 材质/厚度/压力等级空白 → 必须整改；BP-009 一票多板 → 建议完善；BP-002 编号、BP-004 抽/堵顺序通过 |
| 6 | 一级用火票气体分析做得早，马上开工还能不能开 | `hotwork-level1-with-issues.docx` | 按上述链路 | 3 / 2 / 1 / 39；分析 08:05、开工 09:00、基准 08:50：HW-005 距开工 55 min 落在 30~60 min 档 → 建议完善（开工前重新分析）；G-009 当前在有效期内 |
| 7 | 高处作业票 12.5 米填一级、风力 6 级 | `high-place-level2-issues.docx` | 按上述链路 | 6 / 2 / 0 / 26；HP-002 应为二级、HP-006 六级风、HP-004 防坠落未勾、HP-008 脚手架未验收、HP-005 有效期 9 天、G-014 一人无证 |
| 8 | 氮气置换储罐受限空间票，有毒气体栏「无」，作业到次日上午 | `confined-space-n2-tank.docx` | 按上述链路 | 1 / 0 / 0 / 43；介质无毒 + 有毒气体栏「无」→ CS-004 通过；O₂ 20.8% → CS-002 通过；08:00 至次日 10:00 共 26 h → CS-012 必须整改 |
| 9 | 45 吨吊装票，汽车吊司机证书空着 | `lifting-45t.docx` | 按上述链路 | 2 / 0 / 0 / 35；LF-007（经角色关键词「司机」命中）与 G-014 必须整改；LF-002 二级、LF-003 方案、LF-004 警戒、LF-005 指挥、LF-006 司索通过 |
| 10 | 受限空间票措施都勾了，确认有没有漏项 | `confined-space-ok.docx` | 按上述链路 | 0 / 0 / 0 / 44；报告结论为"预检未发现可机检问题（不构成审批意见）"，仍须审批人按程序审批 |
| 11 | 摘要说建议完善 5 项、明细只有 2 条，按哪个算 | `sample-permit-result-summary-mismatch.json` | `--result` 该文件 | warning「summary.should_improve=5 与 findings 重新计数 2 不一致」；报告按 2 计，原值 5 留在 `bridge.json.sourceSummary` |
| 12 | 射线探伤作业的预检结果，也能转达吗 | `sample-permit-result-unknown-type.json` | `--result` 该文件 | 可转达；type「射线探伤」原值照搬，不在作业许可八大类 → `permitCategory: null` + warning，不强行归类 |
| 13 | 班长说交出"大概没问题"，填进了车间侧提示 | `sample-permit-result.json + sample-workshop-notes-bad.json` | `--notes sample-workshop-notes-bad.json` | 「大概没问题」按「未核实」处理并 warning；自定义项「脚手架验收牌」追加并标「车间自查」 |
| 14 | 只发预检结果，车间几项还没核 | `sample-permit-result.json` | 不传 `--notes` | 车间侧三项全部「未核实」并提示可接技能；规则判定计数不变 |
| 15 | 1 项未判定（是否在受限空间内没填），能不能算通过 | `sample-permit-result.json` | 不传 `--notes` | HW-003 列在「三、未判定项」，保持未判定，【注意】既不代表符合也不代表不符合，补齐后重新预检 |
| 16 | 票面写「动火安全作业证」，报告写动火还是用火 | `sample-hotwork-permit.docx` | 同题 1 | 抽取时 `type` 填「动火」；报告字段表 type「动火」、加注「用火作业」，结论段注明「动火」即中石化「用火作业」；规则原文（如"受限空间内动火…"）照搬不替换；分析段行文写「用火」 |
| 17 | 只有扫描 PDF，读不读 PDF | `sample-hotwork-permit.docx` | 不运行脚本 | 说明脚本不读 PDF：先用平台 pdf 技能转成 docx/txt，扫描件需 OCR，再按题 1 链路预检 |
| 18 | 栏目看不清，先列字段请我确认，不要直接出结论 | `hotwork-level2-night.docx` | 只跑 `docx2text.js` | 流程题：只做读票 + 抽取 + 复述字段（措施栏多处空框、看不清的标出），等用户确认，不运行 `precheck.js` |

## 回归样例与期望计数

`--now 2026-08-28T08:50:00+08:00`，规则库 0.3.0 / 130 条。selftest 的 R 节逐份核对：docx2text 关键栏目、与 `.docx2text.txt` 一致、四项计数、与 `.expected-report.md` 一致（忽略生成时间行）。

| 案例 | 场景 | 必须整改 / 建议完善 / 未判定 / 通过 |
|---|---|---|
| `hotwork-level1-with-issues` | 一级用火：监护人空白、有效期 10 h、受限空间内用火未关联受限空间票；气体分析距开工 55 min、监护人证书空白 | 3 / 2 / 1 / 39 |
| `confined-space-ok` | 受限空间：两点检测（含"上人孔"）、盲板隔离、通风、12V 照明、救援器材、登记、交底签字、仪器校验齐全 | 0 / 0 / 0 / 44 |
| `high-place-level2-issues` | 高处：12.5 m 却填一级、有效期 9 天、六级风、防坠落未勾、脚手架未验收、一人无证；监护人无证、身体状况未确认 | 6 / 2 / 0 / 26 |
| `confined-space-t201` | 受限空间（与 `hotwork-t201-inside` 成对）：T-201 塔内焊补，含用火并关联用火票 DH-2026-0828-021；有效期 08:30~20:30 | 0 / 0 / 0 / 45 |
| `hotwork-t201-inside` | 一级用火（受限空间内）：已关联受限票与盲板票；分析距开工 75 min、有效期 13 h、气瓶间距未勾 | 2 / 1 / 0 / 42 |
| `hotwork-level2-night` | 二级用火、夜班 22:00 未升级；消防器材未勾；介质循环水无爆炸下限 | 2 / 1 / 0 / 39 |
| `confined-space-n2-tank` | 受限空间：柴油罐氮气置换后进入，有毒气体栏「无」；作业 26 h | 1 / 0 / 0 / 43 |
| `lifting-45t` | 吊装二级 45 t：汽车吊司机证书空白 | 2 / 0 / 0 / 35 |
| `blind-plate-3` | 盲板抽堵：3 块盲板，未附盲板图、材质/厚度/压力等级空白、一票多板 | 2 / 1 / 0 / 30 |

合并报告样例 `sample-permit-result.json` 恒为 3 / 2 / 1 / 4（虚构结构，只回归转达逻辑）。

## 关键验证点

1. **判定与转达分开**：`precheck.js` 只判定，`merge-report.js` 只转达；`bridge.json.findings` 与 `result.json` 的 `findings` JSON 全等，规则编号、级别、原文、顺序一致；`bridge.json.meta.source` 为 `precheck.js`。
2. **改前改后判定一致**：9 个案例的 `result.json` 与并入前的规则引擎逐字段一致（只有被替换的证书号本身不同，且证书号不进入 result.json）。
3. **规则原文可追溯**：type 与规则原文里的「动火」不改写，八大类「用火作业」只作加注。
4. **抽取先确认**：读票后先复述字段请用户确认，再跑规则引擎；看不清的字段填 null，不猜。
5. **分节呈现**：车间侧提示单独成节「车间侧补充提示（非规则判定）」，不传 notes 时全部「未核实」。
6. **两条声明行**：规则引擎声明行在前，本技能声明行在后。
7. **无 emoji**：提示用「【注意】」「【未判定】」。

## 再生样例

```bash
node scripts/make-sample.js                              # 默认 seed=1，写到本目录；内容未变的文件不重写
node scripts/make-sample.js --seed 7 --out <临时目录>      # 合并报告样例的票号/时间/人名变化，计数不变
node scripts/make-sample.js --out <临时目录> --demo <目录>  # 另生成 9 份变体 docx（票号、人名、位号、日期、读数都换过），计数不变，基准时间见末行 demo.now
```

## MCP 取数对照

> 平台接入作业票系统 MCP 时不上传附件。`get_permit_document` 返回 `<许可证编号>.docx` 与 `<许可证编号>.permit.json`，下载到同一个新建目录。docx 由本技能 `docx2text.js` 抽文本后由平台模型按抽取手册生成 permit.json；下表核验时以工具附带的真值 permit.json 代替模型抽取结果。预检基准时间取当前时间，过了票面结束时间会多出有效期类不符合项，下表只列与时刻无关的结论。

| # | 示例问题 | MCP 调用 | 运行参数 | 预期结果 |
|---|---|---|---|---|
| M1 | 今天 E-1201 抽芯检修那张一级用火票，从作业票系统调出来预检 | 作业票系统 `get_permits`（workshop=常减压车间）→ `get_permit_document`（permit_no=当天 E-1201 用火作业票，YH-<当天日期>-…） | `docx2text.js --input <票号>.docx` → 抽取 permit.json → `precheck.js --input permit.json --out <dir>` → `merge-report.js --result <dir>/result.json --object <票号>` | docx 文本含票号与 E-1201；字段表 type 原值「动火」、加注「用火作业」、级别一级；必须整改含 HW-019「受限空间内动火，未关联受限空间作业票」（票面勾选了受限空间内用火）；未判定 0；车间侧三项全部「未核实」；merge-report 无 warning |
| M2 | E-1201 管束抽芯的吊装票，提交审批前自查 | 作业票系统 `get_permits`（workshop=常减压车间）→ `get_permit_document`（permit_no=当天 E-1201 吊装作业票，DZ-<当天日期>-…） | 同 M1 | type「吊装」加注「吊装作业」、级别三级；必须整改含 G-014（作业人员资质证书编号未填写）与 LF-007（缺少持证起重机械操作人员）；未判定 0；车间侧三项全部「未核实」 |
| M3 | P-3101A 今天的临时用电票能否调出来预检 | 作业票系统 `get_permits`（workshop=常减压车间）→ `get_permit_document`（permit_no=当天 P-3101A 临时用电作业票，LD-<当天日期>-…） | 不运行脚本 | 工具报错「临时用电作业 暂无 Word 版式」；按 SKILL.md 请用户上传票面，不预检、不自行判定 |
