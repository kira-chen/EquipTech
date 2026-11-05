# scripts 使用说明

> 一条流程五个脚本：`docx2text.js` 读票 → 模型抽取 permit.json 并请用户确认 → `precheck.js` 规则引擎判定 → `merge-report.js` 转达成车间自查报告。规则引擎只判定，`merge-report.js` 只转达、不改写判定。全部仅用 Node.js 内置模块（fs/path/zlib/child_process），Node ≥ 18，无需 npm install。Windows 控制台中文乱码时先执行 `chcp 65001`，或直接看 `--out` 写出的文件。

## docx2text.js —— Word 作业票转结构化文本

```bash
node "<技能目录>/scripts/docx2text.js" --input "<作业票.docx>" [--out "<txt>"] [--json "<blocks.json>"]
```

### 参数

| 参数 | 必需 | 说明 |
|---|---|---|
| `--input` | 是 | `.docx` 作业票；`.doc`/`.wps`/加密文件不支持 |
| `--out` | 否 | 文本输出路径；不传时文本打印到标准输出 |
| `--json` | 否 | 另存段落与表格的结构化块（调试用） |
| `--help` | 否 | 打印用法 |

### 产出

- 文本：段落按顺序输出；表格每行以 `|` 分隔；勾选框统一 `[x]`/`[ ]`，叉选 `[×]`；纵向合并 `〃`；横向合并占位 `‹›`（空串才是留白）；删除线 `~~…~~`；文本框 `【文本框】…`；页眉/页脚追加为「### 页眉/页脚」块；嵌套表格拍平进单元格。支持 ☑/☐/√/■/□ 字符、Wingdings `w:sym`、`w14:checkbox` 内容控件、传统窗体域复选框。
- 末行 JSON 摘要：`{"paragraphs","tables","checked","unchecked","crossed","textboxes","header_footer","out"}`。表格数与文本框数均为 0 时多半是整票图片排版，需改为看图。

### 退出码
- `0`：成功（`--help` 也为 0）
- `1`：失败（缺 `--input`、文件不存在、解析失败），末行 `{"ok":false,"error":"..."}`

## precheck.js —— 规则引擎

读取 `references/rules.json`（130 条规则，GB 30871-2022 整理）对 permit.json 逐条检查。

```bash
node "<技能目录>/scripts/precheck.js" --input "<permit.json>" [--out "<输出目录>"] [--now <ISO 带时区>] [--rules "<rules.json>"]
```

### 参数

| 参数 | 必需 | 说明 |
|---|---|---|
| `--input` | 是 | 抽取好的 permit.json（字段见 `references/permit-schema.md`） |
| `--out` | 否 | 输出目录，默认当前目录下的 `output/`，**建议始终传 `--out`** 指到工作目录 |
| `--now` | 否 | 预检基准时间，必须是 ISO 8601 带时区（如 `2026-08-28T08:50:00+08:00`）；省略取系统时间 |
| `--rules` | 否 | 换用其他规则库文件（默认 `references/rules.json`） |

### 产出

| 文件 | 内容 |
|---|---|
| `result.json` | `{permit_no, type, level, now, summary, skipped, findings[{rule_id, severity, message, detail, basis, rule_type, check_name}], extraction_notes[], disclaimer}`，交 `merge-report.js` |
| `report.md` | 规则引擎报告（按 `assets/templates/report-template.md`：基本信息、预检结论、必须整改、建议完善、未判定、通过项，有 `extraction_notes` 时另有「抽取备注（需人工确认）」） |
| `summary.json` | 四项计数 |

- 时间字段必须是 ISO 8601 带时区，否则按缺失处理并由 G-000 提示，避免无时区字符串随机器时区漂移。
- 加载时归一化：`gas_tests` 按时间升序（`[last]` 即最新）、`cross_jobs` 单对象包成数组、`extraction_notes` 字符串包成数组。
- `when` 依赖字段为空 → `undetermined`（未判定，单列一节）；规则 `on_when_empty:"skip"` 例外。
- 支持的规则类型：required / count_max / enum / range / time_window / time_format / duration_max / time_order / now_in_window / conditional / cross_permit / cross_jobs_valid / derived_level / role_cert / toxic / multi_point_sampling / guardian_independent / briefing_signed / approver_level / fail；字段路径支持 `a.b`、`arr[].x`、`arr[last].x`、`arr[0].x`。详见 `references/permit-schema.md`。
- `type` 枚举与规则原文沿用 GB 30871 的「动火」，即中石化的「用火作业」。

### 退出码
- `0`：成功，末行 `{"must_fix":N,"should_improve":N,"undetermined":N,"pass":N}`
- `1`：失败（缺 `--input` 时打印用法；输入文件不存在、JSON 非法、permit 不是对象、`--now` 无时区时末行 `{"ok":false,"error":"..."}`）

## merge-report.js —— 结果转达

把规则引擎的 `result.json` 逐条深拷贝为车间自查合并报告，**不改写任何判定**。

```bash
node "<技能目录>/scripts/merge-report.js" --result "<result.json>" [--notes "<车间侧 notes.json>"] [--object "<作业票名称或票号>"] [--out "<输出目录>"]
```

### 参数

| 参数 | 必需 | 说明 |
|---|---|---|
| `--result` | 是 | `precheck.js` 产出的 `result.json`（含 `findings` 数组）。传成 `summary.json` 会报错并提示 |
| `--notes` | 否 | 车间侧提示 JSON 数组 `[{item,status,note}]`，状态只认 已核实 / 未核实 / 不适用；格式见 `references/input-spec.md`。没有车间侧信息时不传 |
| `--object` | 否 | 报告抬头的作业票名称；缺省取 `permit_no` 或 `project` |
| `--out` | 否 | 输出目录，默认系统临时目录 `<os.tmpdir()>/ppb-out`，**建议始终传 `--out`** |

### 产出

| 文件 | 内容 |
|---|---|
| `permit-precheck-bridge.md` | 六节报告 + 附（抽取备注、数据提示）+ 两条声明行 + 分析段占位 |
| `bridge.json` | `meta`（source=`precheck.js` / resultFile / objectName / generatedAt / declaration / sourceDisclaimer）、`sourceSummary`、`sourceMeta`（permit_no / type / permitCategory / level / now / project / unit）、`counts`、`findings`、`workshopNotes`、`skipped`、`extractionNotes`、`warnings` |
| `summary.json` | 末行摘要落盘：`{ok, out, source, objectName, counts, warnings}` |

### 关键约定

1. `findings` 逐条 `JSON.parse(JSON.stringify())` 深拷贝，`rule_id / severity / message / detail / basis` 一字不改，不合并、不归类、不重排；规则原文里的「动火」照搬不替换。
2. 按 findings 重新计数；与 `result.json` 的 `summary` 不一致只 warning，原值留在 `sourceSummary`。
3. `severity` 不在四级内 → `counts.other` 单列并 warning，原值保留。
4. `type` 原值照搬；另在 `sourceMeta.permitCategory` 加注作业许可八大类名称（动火 → 用火作业），并在结论段注明「动火」即中石化「用火作业」；不在八大类 → `null` + warning。
5. `disclaimer` 原文置于本技能声明行之前；缺失 → warning，不伪造。
6. 车间侧提示单独成节，不传 `--notes` 时三项全部「未核实」，不替用户推测。
7. 通过项表格并列规则库的正向名称 `check_name` 与 message 原文。
8. md 不用 emoji，提示用「【注意】」「【未判定】」。

### 退出码
- `0`：成功，末行 `{"ok":true,...}`
- `1`：失败（缺 `--result`、文件不存在、JSON 非法、缺 findings 数组、notes 非数组、未知参数），末行 `{"ok":false,"error":"...","warnings":[...]}`

## make-sample.js —— 样例生成

```bash
node scripts/make-sample.js [--out <dir>] [--seed <n>] [--demo <dir>]
```

### 参数

| 参数 | 必需 | 说明 |
|---|---|---|
| `--out` | 否 | 输出目录；不传时写到演示样例目录（仓库内 `炼厂车间设备员/演示case/02-缺陷报修与检修管理/permit-precheck-bridge/`，开发包内技能目录 `examples/`） |
| `--seed` | 否 | 非负整数，默认 1。只改合并报告样例的票号尾号、时间与人名，以及 `--demo` 变体的票号、人名、位号、日期与读数；预期计数不变 |
| `--demo` | 否 | 另生成 9 份变体 Word 作业票（只有 docx）到该目录；写文件前先跑规则引擎核对四项计数，与基线不一致则报错、不写任何变体；不能指向回归样例目录 |

### 产出

| 文件 | 内容 |
|---|---|
| `sample-permit-result.json` 等 5 份 | 合并报告样例：规则引擎结果（3 必须整改 / 2 建议完善 / 1 未判定 / 4 通过）、summary 不一致变体、type 不在八大类变体、车间侧 notes.json 正常与非法变体 |
| `sample-hotwork-permit.docx` | 一级用火票 Word 样例（与 `hotwork-level1-with-issues.docx` 票面相同） |
| `<案例>.json / .docx / .docx2text.txt / .expected-report.md` | 9 个规则引擎回归案例：json 是基准数据（`--out` 指向别处时从演示样例目录复制），docx 由 json 生成（问题项表现为空白栏，三种勾选框写法），文本与期望报告按 `--now 2026-08-28T08:50:00+08:00` 生成，不随 seed 变化 |

内容未变的文件不重写（docx 按读回文本比较，期望报告忽略「生成时间」行）。末行 `{"ok":true,"out","seed","permitNo","now","counts":{案例:"必改/建议/未判定/通过"},"changed":[…],"files":[…],"demo":{dir,seed,date,now,files}|null,"warnings":[…]}`；`--demo` 变体的预检基准时间用 `demo.now`。

### 退出码
- `0`：成功
- `1`：失败（`--seed` 非法、缺回归基准 json、`--demo` 指向回归样例目录、变体计数漂移、未知参数），末行 `{"ok":false,"error":"...","warnings":[]}`

## selftest.js —— 自测

```bash
node scripts/selftest.js                      # 全量
SELFTEST_LEVEL=A node scripts/selftest.js     # 只跑 BVT 和 A
```

回归数据从演示样例目录读（仓库内在 `演示case/`，开发包内在 `examples/`）。覆盖：make-sample 可再生与参数校验；**规则引擎 result.json → 合并报告逐条深拷贝不改写**（findings 全等、规则原文「动火」照搬、八大类加注、未判定不改写、两条声明行顺序、六节结构、无 emoji、不出现旧技能名）；车间侧提示状态校验与不替用户推测；summary 不一致只 warning；未知级别与缺声明行；参数与输入校验；文档口径；完整链路（docx → docx2text → 抽取结果 → precheck → merge-report，带与不带车间侧信息）；规则引擎边界用例 E1~E24（体积分数换算、未判定、无时区时间、有毒气体限值、复检、分档、不级联、证书 N/A、关联票、定性值、docx 读取细节、报告结构、演示变体计数不漂移）；9 个案例端到端回归（docx2text 关键栏目、与入库文本一致、四项计数、期望报告一致）。结尾打印通过数与各级断言数，有失败时退出码 1。
