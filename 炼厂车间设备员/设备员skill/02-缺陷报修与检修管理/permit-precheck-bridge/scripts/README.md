# scripts 使用说明

> **本技能是入口与衔接层，不含规则引擎。** 作业票合规判定由 `work-permit-precheck` 完成；本目录两个脚本一个管依赖探测、一个管结果转达。

## check-dependency.js —— 依赖可用性检查

每次使用本技能前先运行，确认 `work-permit-precheck` 是否可调用。

```bash
node "<技能目录>/scripts/check-dependency.js" [--skill-root "<被依赖技能根目录>"] [--out "<输出目录>"]
```

### 参数

| 参数 | 必需 | 说明 |
|---|---|---|
| `--skill-root` | 否 | 显式指定依赖技能根目录。**指定后只查这一个路径**，不回退到默认位置 |
| `--out` | 否 | 指定时把结果写入 `<out>/dependency.json` |

### 默认搜索顺序

未指定 `--skill-root` 时按以下顺序查找 `scripts/precheck.js`：

1. 环境变量 `SKILL_PACK_ROOT`（技能包根目录，三个平台通用）下的 `【炼化】特殊作业票预检/work-permit-precheck/`、`work-permit-precheck/`，以及其一级子目录中的 `work-permit-precheck/`（目录名被平台改名或转码时兜底）
2. `~/.workbuddy/skills/work-permit-precheck/`（WorkBuddy）
3. `~/.claude/skills/work-permit-precheck/`（Claude Code）
4. `~/.doubao/skills/work-permit-precheck/`（豆包，以平台实际加载目录为准）
5. 本技能所在 skill-pack 根目录下的同名位置与一级子目录扫描

### 产出（末行 JSON）

```jsonc
{
  "ok": true,
  "dependency": "work-permit-precheck",
  "available": true,              // 关键字段
  "root": "…",                    // 依赖技能根目录
  "script": "…/scripts/precheck.js",
  "docx2text": "…/scripts/docx2text.js", // 依赖目录有该脚本时给路径，否则 null
  "searched": ["…"],              // 查过的路径，便于排错
  "envSkillPackRoot": null,
  "platformNote": "…",
  "note": "…"                     // 下一步该做什么
}
```

### `available: false` 时必须做的事

1. 告知用户「需先安装特殊作业票预检技能」
2. **终止本次任务**
3. **不得用本技能自行判定票据合规性，不得降级为人工判断**

退出码始终为 0（检查本身成功），依赖是否可用看 `available` 字段。参数错误时 `ok:false` + 退出码 1。

## merge-report.js —— 结果转达

把源技能的 `result.json` 逐条深拷贝为车间自查合并报告，**不改写任何判定**。

```bash
node "<技能目录>/scripts/merge-report.js" --result "<源技能 result.json>" [--notes "<车间侧 notes.json>"] [--object "<作业票名称或票号>"] [--out "<输出目录>"]
```

### 参数

| 参数 | 必需 | 说明 |
|---|---|---|
| `--result` | 是 | 源技能 `result.json`（含 `findings` 数组）。传成 `summary.json` 会报错并提示 |
| `--notes` | 否 | 车间侧提示 JSON 数组 `[{item,status,note}]`，状态只认 已核实 / 未核实 / 不适用；格式见 `references/input-spec.md` |
| `--object` | 否 | 报告抬头的作业票名称；缺省取源 `permit_no` 或 `project` |
| `--out` | 否 | 输出目录，默认系统临时目录 `<os.tmpdir()>/ppb-out`，**建议始终传 `--out`** |

### 产出

| 文件 | 内容 |
|---|---|
| `permit-precheck-bridge.md` | 六节报告 + 附（源技能抽取说明、数据提示）+ 双重声明行 + 分析段占位 |
| `bridge.json` | `meta`（source / objectName / declaration / sourceDisclaimer）、`sourceSummary`、`sourceMeta`（permit_no / type / permitCategory / level / now）、`counts`、`findings`、`workshopNotes`、`skipped`、`extractionNotes`、`warnings` |
| `summary.json` | 末行摘要落盘 |

### 关键约定

1. `findings` 逐条 `JSON.parse(JSON.stringify())` 深拷贝，`rule_id / severity / message / detail / basis` 一字不改，不合并、不归类、不重排。
2. 按 findings 重新计数；与源 `summary` 不一致只 warning，源值留在 `sourceSummary`。
3. `severity` 不在四级内 → `counts.other` 单列并 warning，原值保留。
4. 源 `type` 原值照搬；另在 `sourceMeta.permitCategory` 加注作业许可八大类名称（动火 → 用火作业），不在八大类 → `null` + warning。
5. 源 `disclaimer` 原文置于本技能声明行之前；缺失 → warning，不伪造。
6. 车间侧提示单独成节，不传 `--notes` 时三项全部「未核实」，不替用户推测。
7. md 不用 emoji，提示用「【注意】」「【未判定】」。

### 退出码
- `0`：成功，末行 `{"ok":true,...}`
- `1`：失败（缺 `--result`、文件不存在、JSON 非法、缺 findings 数组、notes 非数组、未知参数），末行 `{"ok":false,"error":"...","warnings":[...]}`

## make-sample.js —— 样例生成

```bash
node scripts/make-sample.js --out examples [--seed <n>]
```

生成虚构的源技能 `result.json`（3 必须整改 / 2 建议完善 / 1 未判定 / 4 通过）、summary 不一致变体、type 不在八大类变体、车间侧 notes.json 正常与非法变体；找得到依赖技能时另复制一份用火票 docx 样例。seed 只改票号尾号、时间与人名，计数结论不变。

## selftest.js —— 自测

```bash
node scripts/selftest.js
```

130 条断言，覆盖：依赖存在 / 不存在两条路径、`--skill-root` 只查指定路径、`SKILL_PACK_ROOT` 与一级子目录兜底、三平台默认目录、docx2text 探测、结果落盘；make-sample 可再生；**源技能 JSON → 合并报告逐条深拷贝不改写**（findings 全等、票面原词保留、八大类加注、未判定不改写、双重声明行顺序、六节结构、无 emoji）；车间侧提示状态校验与不替用户推测；summary 不一致只 warning；未知级别与缺声明行；无未判定时不出现【注意】；参数与输入校验；文档口径（用火作业、PDF 前置、互指排除语、references 不与 overhaul bridge 重复）。全绿退出 0。
