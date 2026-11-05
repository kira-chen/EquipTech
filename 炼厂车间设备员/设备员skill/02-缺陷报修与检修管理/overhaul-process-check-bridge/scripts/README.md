# scripts 使用说明

> 判定与转达分开：`check.js` 是规则引擎，只判定；`merge-report.js` 只转达，逐条照搬 `result.json`，不改写任何判定。全部脚本仅用 Node.js ≥18 内置模块。

| 脚本 | 用途 |
|---|---|
| `docx2text.js` | 检修方案 Word → 结构化文本 |
| `check.js` | 规则引擎：plan.json → result.json / report.md / summary.json |
| `merge-report.js` | result.json（+ plan.json、车间侧 notes.json）→ 车间自查合并报告 |
| `make-sample.js` | 生成演示与回归样例 |
| `selftest.js` | 自测 |
| `lib/docx-lite.js` | docx 读写共享库（被 docx2text.js、make-sample.js 引用） |
| `lib/common.js` | 通用共享库（被 merge-report.js、make-sample.js 引用） |

## docx2text.js —— 读取检修方案 Word

```bash
node "<技能目录>/scripts/docx2text.js" --input "<检修方案.docx>" [--out "<plan.txt>"] [--json "<blocks.json>"]
```

### 参数

| 参数 | 必需 | 说明 |
|---|---|---|
| `--input` | 是 | 检修方案 docx（PDF 先用平台 pdf 技能转为 txt/docx，脚本不读 PDF） |
| `--out` | 否 | 文本输出文件；不传时文本打印到 stdout |
| `--json` | 否 | 另存段落 / 表格块结构 JSON |
| `--help` | 否 | 打印用法 |

### 产出

- 文本：段落按顺序输出；表格每行以 `|` 分隔单元格；横向合并占位「‹›」（不是留白）、纵向合并续行「〃」；勾选框统一为 `[x]` / `[ ]`，`[×]` 含义需人工判断；删除线 `~~…~~`；文本框 `【文本框】…`；页眉 / 页脚在末尾单列。
- 末行 JSON 摘要：`{"paragraphs","tables","checked","unchecked","crossed","textboxes","header_footer","out"}`，用于核对是否读全。

### 退出码

- `0`：成功
- `1`：缺 `--input`、文件不存在、解析失败，末行（stdout）`{"ok":false,"error":"…"}`

## check.js —— 规则引擎

```bash
node "<技能目录>/scripts/check.js" --input "<plan.json>" [--out "<输出目录>"] [--rules "<checklist.json>"]
```

### 参数

| 参数 | 必需 | 说明 |
|---|---|---|
| `--input` | 是 | 抽取结果 plan.json（字段见 `references/plan-schema.md`） |
| `--out` | 否 | 输出目录；不传时为当前目录下的 `check/`，**建议始终传 `--out`** |
| `--rules` | 否 | 规则库路径，默认 `references/checklist.json` |

### 产出

| 文件 | 内容 |
|---|---|
| `result.json` | `unit / project / contractor / duration_days / jobs_count / summary / skipped / findings / extraction_notes / disclaimer`；每条 finding 含 `rule_id / severity / name / message / detail / advice / basis / jobs` |
| `report.md` | 按 `assets/templates/report-template.md` 生成的对照表报告（基本信息、核查结论、安全措施对照表、缺失项、建议完善、未判定、已有措施、抽取备注） |
| `summary.json` | 四项计数 `{must_fix, should_improve, undetermined, pass}` |

末行打印四项计数摘要（与 summary.json 相同）。

### 规则类型（references/checklist.json）

- `required`：顶层 / 嵌套字段非空（支持 `min_count`）；值为对象时报告写"（对象值，需人工核对）"，不原样序列化。
- `measure`：措施字段——`null` / 空串 / `false` / 数字 `0` / 否定词（无、不涉及、不适用、没有、N/A、NA、待定、暂无，或仅「/ — - ~」等符号的字符串）视为方案未写明；`true` / 实质文字视为已写明（文字在报告中摘录）。含理由的长句（如"不适用：自行检修……"）按已写明。
- `each_job`：逐项作业检查字段（`job_types` 显式空数组 `[]` = 标注为"无特殊作业"，算已标注；`null` 才算缺）。
- `reminder`：触发即输出提示（如双票联办）。

### 触发机制

- 无 `trigger`：通用规则，每份方案都查。
- `trigger.job_type`：任一作业 `job_types` 含该类型即触发，报告注明触发作业。
- `trigger.job_types_all`：同一项作业同时含全部类型才触发（组合规则）。
- 作业类型标签不在 `meta.job_types` 合法表中 → 剔除并写入 extraction_notes；剔除后为空按未标注（null）处理。用火作业的标签是「动火」（沿用 GB 30871），写「用火」会被剔除。
- 有作业 `job_types` 为 `null`（未标注）时，未被触发的专项规则输出 `undetermined`，不静默跳过；同一作业类型（或组合）聚合为一条 finding，说明中列出涉及规则号，`summary.undetermined` 按聚合后条数计。
- `when` 条件（如 `duration_days > 30`）依赖字段为空 → `undetermined`；`on_when_empty:"skip"` 例外。`duration_days` 为字符串时仅接受"纯数字（可带 天/日）"，日期区间等其他字符串按无法解析 → `undetermined`。

### 退出码

- `0`：成功，末行四项计数摘要，同时写 `<out>/summary.json`
- `1`：缺 `--input`、输入文件不存在、JSON 非法、顶层不是对象，末行 `{"ok":false,"error":"…"}`

## merge-report.js —— 结果转达

把规则引擎的 `result.json` 逐条深拷贝为车间自查合并报告，**不改写任何判定**。

```bash
node "<技能目录>/scripts/merge-report.js" --result "<check.js 输出的 result.json>" [--plan "<交给 check.js 的 plan.json>"] [--notes "<车间侧 notes.json>"] [--object "<方案名称>"] [--repair-type <大检修|日常维修|抢修|专项>] [--out "<输出目录>"]
```

### 参数

| 参数 | 必需 | 说明 |
|---|---|---|
| `--result` | 是 | 规则引擎 `result.json`（含 `findings` 数组）。传成 `summary.json` 会报错并提示 |
| `--plan` | 否（建议始终传） | 交给 `check.js --input` 的 `plan.json`。`result.json` 不含 `plan_no`、`job_types`，方案编号与作业类型标签从这里读取（只进抬头字段表，不进判定）；不传时两项为 null / 空数组并 warning。`unit`/`project` 或作业项数与 result.json 不一致时 warning 提示核对是否同一份方案。文件不存在、JSON 非法或不是对象时报错 |
| `--notes` | 否 | 车间侧提示 JSON 数组 `[{item,status,note}]`，状态只认 已核实 / 未核实 / 不适用；格式见 `references/input-spec.md`。没有车间侧信息时不传，四项全部「未核实」 |
| `--object` | 否 | 报告抬头的方案名称；缺省取 result.json 的 `project`，再缺省取方案编号 |
| `--repair-type` | 否 | 检修分级：大检修 / 日常维修 / 抢修 / 专项。旧值 大修→大检修、中修/小修→日常维修 自动映射并 warning；其它值报错。**只写入抬头，不进入判定**，不传则为 null |
| `--out` | 否 | 输出目录，默认系统临时目录 `<os.tmpdir()>/opcb-out`，**建议始终传 `--out`** |

### 产出

| 文件 | 内容 |
|---|---|
| `overhaul-check-bridge.md` | 六节报告 + 附（抽取说明、数据提示）+ 双重声明行 + 分析段占位 |
| `bridge.json` | `meta`（source / resultFile / planFile / objectName / repairType / repairTypeRaw / generatedAt / declaration / sourceDisclaimer）、`sourceSummary`、`sourceMeta`（plan_no / unit / project / contractor / duration_days / jobs_count / jobTypes / jobTypesCn / planNoSource / jobTypesSource）、`counts`、`findings`、`workshopNotes`、`skipped`、`extractionNotes`、`warnings`。`meta.source` 为 `check.js` |
| `summary.json` | 末行摘要落盘：`{ok, out, source, objectName, repairType, counts, warnings}` |

### 关键约定

1. `findings` 逐条 `JSON.parse(JSON.stringify())` 深拷贝，`rule_id / severity / name / message / detail / advice / basis / jobs` 一字不改，不合并、不归类、不重排；规则库原文里的"动火""大修 / 中修"等写法照搬，不替换。
2. 按 findings 重新计数；与 `summary` 不一致只 warning，原值留在 `sourceSummary`。
3. `severity` 四级中文按规则引擎口径：must_fix 缺失（必须补充）/ should_improve 建议完善 / undetermined 未判定 / pass 已有；不在四级内 → `counts.other` 单列并 warning，原值保留。
4. 方案编号与作业类型标签取自 `--plan`：`plan_no` 原值；作业类型为 `jobs[].job_types` 原值去重（按出现顺序，未标注的作业不计），另加注作业许可八大类名称（动火 → 用火作业）。`sourceMeta.planNoSource` / `jobTypesSource` 记录来源（`plan.json`；未传 `--plan` 时兼容结果顶层自带的旧字段，记 `result.json`；都没有为 null）。不从 findings 反推，不猜测。
5. `disclaimer` 原文置于本技能声明行之前；缺失 → warning，不伪造。
6. 车间侧提示固定四项（设备交出条件 / 同期交叉作业 / 承包商资质 / 备件与工机具到位）单独成节，不传 `--notes` 时全部「未核实」，不替用户推测。
7. 整改建议末尾固定提示"各专项措施最终仍以开工时逐票办理的作业票为准"。
8. md 不用 emoji，提示用「【注意】」「【未判定】」。

### 退出码

- `0`：成功，末行 `{"ok":true,...}`
- `1`：失败（缺 `--result`、文件不存在、JSON 非法、缺 findings 数组、notes 非数组、非法 `--repair-type`、未知参数），末行 `{"ok":false,"error":"...","warnings":[...]}`

## make-sample.js —— 样例生成

```bash
node scripts/make-sample.js [--out <dir>] [--seed <n>]
```

| 参数 | 必需 | 说明 |
|---|---|---|
| `--out` | 否 | 输出目录；不传时写到演示样例目录（仓库内 `演示case/02-缺陷报修与检修管理/overhaul-process-check-bridge/`，开发包内技能目录 `examples/`） |
| `--seed` | 否 | 整数。合并报告样例默认 seed=1；回归样例不传时为基准版本，传了生成决定性变体 |

产出（均为虚构）：

| 文件 | 内容 | 计数（任何 seed 下不变） |
|---|---|---|
| `sample-overhaul-plan.json` | E-1201 换热器检修方案的抽取结果 | — |
| `sample-overhaul-result.json` | **本技能 `check.js` 对上面 plan.json 的真实输出**（不手写） | 3 缺失 / 5 建议完善 / 9 未判定 / 36 已有 |
| `sample-overhaul-result-summary-mismatch.json` | summary 故意写 must_fix=5 的变体 | findings 同上 |
| `sample-workshop-notes.json`、`sample-workshop-notes-bad.json` | 车间侧 notes.json 正常与非法变体 | — |
| `cdu-overhaul.docx / .docx2text.txt / .json / .expected-report.md` | 常减压装置停工大检修方案：Word、docx2text 读回、抽取结果、check.js 期望报告 | 4 缺失 / 3 建议完善 / 0 未判定 / 56 已有，跳过 7 |
| `pump-repair.docx / .docx2text.txt / .json / .expected-report.md` | 机泵单体检修方案（同上四件） | 0 缺失 / 1 建议完善 / 0 未判定 / 37 已有，跳过 32 |
| `sample-overhaul-plan.docx` | 与 `pump-repair.docx` 同一份方案（上架信息示例问题 1 的附件） | — |

seed 只改方案编号、工期、承修单位、人名、日期与作业清单顺序，**教学缺失点的数量与类型不变**；回归样例的计数与期望不符时脚本报错退出，不写出被改坏的样例。

退出码：`0` 成功，末行 `{"ok":true,"out","seed","variantSeed","planNo","counts","files","warnings"}`；`1` 失败（未知参数、`--seed` 不是整数或缺值、check.js / docx2text.js 运行失败、计数与期望不符），末行 `{"ok":false,"error":...}`。

## selftest.js —— 自测

```bash
node scripts/selftest.js                     # 全量
SELFTEST_LEVEL=A node scripts/selftest.js    # 只跑 BVT 和 A 级
```

覆盖：make-sample 可再生（seed 变数值不变计数、变体 docx）；规则引擎（规则库规模与结构、作业类型触发专项、组合规则、工期严格解析、未标注类型按类型聚合未判定、未知标签剔除、措施取值与否定词、对象值、jobs 非对象元素、抽取备注、两份回归样例期望计数、CLI 出错约定）；docx2text 出错约定与读回；端到端回归（docx → docx2text 与入库文本一致 → check.js 计数与期望一致 → report.md 与期望报告一致）；样例 result.json 与 check.js 真实输出逐字一致；**result.json → 合并报告逐条深拷贝不改写**（findings 全等含 name/advice/jobs、标签原词保留、八大类加注、未判定不改写、双重声明行顺序、六节结构、无 emoji、作业票为准提示）；检修分级映射；车间侧提示状态校验与不替用户推测；summary 不一致只 warning；未知级别、缺声明行与无 job_types；`--plan` 补出方案编号与作业类型；参数与输入校验；文档口径。演示样例从演示case 读取，仓库外回落到技能目录 `examples/`。全绿退出 0，有失败列出并退出 1；结尾打印各级断言数。
