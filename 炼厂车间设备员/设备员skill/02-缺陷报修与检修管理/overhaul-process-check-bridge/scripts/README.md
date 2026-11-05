# scripts 使用说明

> **本技能是入口与衔接层，不含规则引擎。** 方案安全措施的核查判定由 `overhaul-safety-check` 完成；本目录两个脚本一个管依赖探测、一个管结果转达。

## check-dependency.js —— 依赖可用性检查

每次使用本技能前先运行，确认 `overhaul-safety-check` 是否可调用。

```bash
node "<技能目录>/scripts/check-dependency.js" [--skill-root "<被依赖技能根目录>"] [--out "<输出目录>"]
```

### 参数

| 参数 | 必需 | 说明 |
|---|---|---|
| `--skill-root` | 否 | 显式指定依赖技能根目录。**指定后只查这一个路径**，不回退到默认位置 |
| `--out` | 否 | 指定时把结果写入 `<out>/dependency.json` |

### 默认搜索顺序

未指定 `--skill-root` 时按以下顺序查找 `scripts/check.js`：

1. 环境变量 `SKILL_PACK_ROOT`（技能包根目录，三个平台通用）下的 `overhaul-safety-check/`，以及其一级子目录中的 `overhaul-safety-check/`
2. 与本技能同级的 `../overhaul-safety-check/`，以及同级一级子目录中的 `overhaul-safety-check/`（第三方平台把技能并排装在同一个技能目录下时命中）
3. `~/.workbuddy/skills/overhaul-safety-check/`（WorkBuddy）
4. `~/.claude/skills/overhaul-safety-check/`（Claude Code）
5. `~/.doubao/skills/overhaul-safety-check/`（豆包，以平台实际加载目录为准）

### 产出（末行 JSON）

```jsonc
{
  "ok": true,
  "dependency": "overhaul-safety-check",
  "available": true,              // 关键字段
  "root": "…",
  "script": "…/scripts/check.js",
  "docx2text": "…/scripts/docx2text.js", // 依赖目录有该脚本时给路径，否则 null
  "searched": ["…"],
  "envSkillPackRoot": null,
  "platformNote": "…",
  "note": "…"
}
```

### `available: false` 时必须做的事

1. 告知用户「需先安装检修方案安全措施核查技能」
2. **终止本次任务**
3. **不得用本技能自行判定方案安全措施是否齐全，不得降级为人工判断**

退出码始终为 0（检查本身成功），依赖是否可用看 `available` 字段。参数错误时 `ok:false` + 退出码 1。

## merge-report.js —— 结果转达

把源技能的 `result.json` 逐条深拷贝为车间自查合并报告，**不改写任何判定**。

```bash
node "<技能目录>/scripts/merge-report.js" --result "<源技能 result.json>" [--plan "<源技能输入 plan.json>"] [--notes "<车间侧 notes.json>"] [--object "<方案名称>"] [--repair-type <大检修|日常维修|抢修|专项>] [--out "<输出目录>"]
```

### 参数

| 参数 | 必需 | 说明 |
|---|---|---|
| `--result` | 是 | 源技能 `result.json`（含 `findings` 数组）。传成 `summary.json` 会报错并提示 |
| `--plan` | 否（建议始终传） | 交给源技能 `check.js --input` 的 `plan.json`。源技能 `result.json` 不含 `plan_no`、`job_types`，方案编号与作业类型标签从这里读取（只进抬头字段表，不进判定）；不传时两项为 null / 空数组并 warning。`unit`/`project` 或作业项数与 result.json 不一致时 warning 提示核对是否同一份方案。文件不存在、JSON 非法或不是对象时报错 |
| `--notes` | 否 | 车间侧提示 JSON 数组 `[{item,status,note}]`，状态只认 已核实 / 未核实 / 不适用；格式见 `references/input-spec.md` |
| `--object` | 否 | 报告抬头的方案名称；缺省取源 `project`，再缺省取方案编号 |
| `--repair-type` | 否 | 检修分级：大检修 / 日常维修 / 抢修 / 专项。旧值 大修→大检修、中修/小修→日常维修 自动映射并 warning；其它值报错。**只写入抬头，不进入判定**，不传则为 null |
| `--out` | 否 | 输出目录，默认系统临时目录 `<os.tmpdir()>/opcb-out`，**建议始终传 `--out`** |

### 产出

| 文件 | 内容 |
|---|---|
| `overhaul-check-bridge.md` | 六节报告 + 附（源技能抽取说明、数据提示）+ 双重声明行 + 分析段占位 |
| `bridge.json` | `meta`（source / resultFile / planFile / objectName / repairType / repairTypeRaw / declaration / sourceDisclaimer）、`sourceSummary`、`sourceMeta`（plan_no / unit / project / contractor / duration_days / jobs_count / jobTypes / jobTypesCn / planNoSource / jobTypesSource）、`counts`、`findings`、`workshopNotes`、`skipped`、`extractionNotes`、`warnings` |
| `summary.json` | 末行摘要落盘 |

### 关键约定

1. `findings` 逐条 `JSON.parse(JSON.stringify())` 深拷贝，`rule_id / severity / name / message / detail / advice / basis / jobs` 一字不改，不合并、不归类、不重排。
2. 按 findings 重新计数；与源 `summary` 不一致只 warning，源值留在 `sourceSummary`。
3. `severity` 四级中文按源技能口径：must_fix 缺失（必须补充）/ should_improve 建议完善 / undetermined 未判定 / pass 已有；不在四级内 → `counts.other` 单列并 warning，原值保留。
4. 方案编号与作业类型标签取自 `--plan`：`plan_no` 原值；作业类型为 `jobs[].job_types` 原值去重（按出现顺序，未标注的作业不计），另加注作业许可八大类名称（动火 → 用火作业）。`sourceMeta.planNoSource` / `jobTypesSource` 记录来源（`plan.json`；未传 `--plan` 时兼容源结果顶层自带的旧字段，记 `result.json`；都没有为 null）。不从 findings 反推，不猜测。
5. 源 `disclaimer` 原文置于本技能声明行之前；缺失 → warning，不伪造。
6. 车间侧提示固定四项（设备交出条件 / 同期交叉作业 / 承包商资质 / 备件与工机具到位）单独成节，不传 `--notes` 时全部「未核实」，不替用户推测。
7. 整改建议末尾固定提示"各专项措施最终仍以开工时逐票办理的作业票为准"。
8. md 不用 emoji，提示用「【注意】」「【未判定】」。

### 退出码
- `0`：成功，末行 `{"ok":true,...}`
- `1`：失败（缺 `--result`、文件不存在、JSON 非法、缺 findings 数组、notes 非数组、非法 `--repair-type`、未知参数），末行 `{"ok":false,"error":"...","warnings":[...]}`

## make-sample.js —— 样例生成

```bash
node scripts/make-sample.js [--seed <n>]
```

生成虚构的检修方案 `sample-overhaul-plan.json`（E-1201 换热器检修，按源技能 plan-schema 填写），再**调用依赖技能 `check.js` 跑出真实 `sample-overhaul-result.json`**（3 缺失 / 5 建议完善 / 9 未判定 / 36 已有；规则号、原文与规则库同源，不手写），另生成 summary 不一致变体（must_fix 改写为 5）、车间侧 notes.json 正常与非法变体，并复制依赖技能的泵检修方案 docx 样例。seed 只改方案编号尾号、工期、承修单位与人名，计数结论不变。**找不到依赖技能时 ok:false 退出 1**（不手写替代品）。

## selftest.js —— 自测

```bash
node scripts/selftest.js
```

装有依赖技能 overhaul-safety-check 时 180 条断言（未安装时跳过其中 17 条，163 条），覆盖：依赖存在 / 不存在两条路径、`--skill-root` 只查指定路径、`SKILL_PACK_ROOT` 与一级子目录兜底、与依赖技能并排安装的同级目录、三平台默认目录、docx2text 探测、结果落盘；make-sample 可再生；**源技能 JSON → 合并报告逐条深拷贝不改写**（findings 全等含 name/advice/jobs、标签原词保留、八大类加注、未判定不改写、双重声明行顺序、六节结构、无 emoji、作业票为准提示）；检修分级映射（旧值 warning、非法值报错、不传不默认）；车间侧提示状态校验与不替用户推测；summary 不一致只 warning；未知级别、缺声明行与无 job_types；样例 result.json 与依赖技能真实输出逐字一致（顶层字段、规则号与规则名）；真实链路 check.js → merge-report 下 `--plan` 补出方案编号与作业类型、不传时留空并 warning、plan 与 result 不一致 warning、`--plan` 文件校验；无未判定时不出现【注意】；参数与输入校验；文档口径（触发词限定安全措施核查、PDF 前置、互指排除语、references 不与 permit bridge 重复）。全绿退出 0。
