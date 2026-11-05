# 输入规格：车间检修方案安全措施核查

本技能的输入分四类：**检修方案文件**（读取后抽取为 plan.json）、**plan.json**（交给规则引擎 `check.js --input`，合并时再用 `--plan` 传入）、**规则引擎的 `result.json`**（`merge-report.js --result`）与可选的**车间侧 `notes.json`**，另有可选参数 `--repair-type`。

## 一、检修方案文件

| 形式 | 处理 |
|---|---|
| `.docx` | 本技能 `scripts/docx2text.js` 转文本后按抽取手册抽取 `plan.json` |
| PDF | **先用平台 pdf 技能转为 txt/docx 再传入，脚本不读 PDF；扫描件需 OCR** |
| 图片 / 扫描件 | 由模型读图抽取，每处 null / 推断在 `extraction_notes[]` 记一条 |
| 文字描述 | 按抽取手册直接映射 |

## 二、`plan.json`（抽取结果）

字段定义见 `references/plan-schema.md`，抽取方法见 `references/extraction-guide.md`，空模板为 `assets/templates/plan.json`。关键字段：`plan_no`（方案编号）、`unit`（装置）、`project`（检修项目）、`contractor`（承修单位）、`duration_days`（工期）、`jobs[]`（每项作业的名称与 `job_types` 标签）、`measures{}`（方案已写明的措施）、`org{}`、`attachments{}`、`extraction_notes[]`。**方案没写的一律 null**，不按"常规肯定会做"猜。

- `job_types` 取值沿用 GB 30871：动火 / 受限空间 / 高处 / 吊装 / 临时用电 / 盲板抽堵 / 动土 / 带压堵漏 / 射线探伤 / 化学清洗。**用火作业填"动火"**（票面或方案写"用火作业许可证 / 用火安全作业证 / 用火票 / 用火"的都按此映射）；写成"用火"不在合法表内，会被剔除并按未标注处理。
- `job_types: []` = 方案标注"无特殊作业"；`null` = 看不出类型（会产生未判定）。

## 三、检修分级（`--repair-type`，可选）

| 取值 | 说明 |
|---|---|
| 大检修 | 装置大检修（停工检修） |
| 日常维修 | 日常维修 |
| 抢修 | 抢修 |
| 专项 | 专项（技改技措） |
| 大修 / 装置大检修 / 停工检修 | 旧值或别名 → 大检修，warning |
| 中修 / 小修 | 旧值 → 日常维修，warning |
| 技改 / 技改技措 / 专项检修 | 别名 → 专项，warning |

只写入报告抬头与 `meta.repairType`，**不进入判定**；不传则 `null`，不默认。

## 四、规则引擎 `result.json`（`--result`，必需）

由 `node scripts/check.js --input plan.json --out <dir>` 生成，结构：

```jsonc
{
  "unit": "常减压装置（原油换热器 E-1201）",
  "project": "E-1201 抽管束清洗及法兰补焊检修方案",
  "contractor": "检修公司第二工程部",
  "duration_days": 5,
  "jobs_count": 5,
  "summary": { "must_fix": 3, "should_improve": 5, "undetermined": 9, "pass": 36 },
  "skipped": 1,
  "findings": [
    { "rule_id": "HW-002", "severity": "must_fix", "name": "动火点可燃物清理", "message": "含动火作业但方案未写明动火点周边可燃物清理措施", "detail": "方案中未提及（抽取为 null/空）（触发作业：E-1201 法兰补焊）", "advice": "方案里怎么补", "basis": "…", "jobs": ["E-1201 法兰补焊"] },
    { "rule_id": "UND-高处", "severity": "undetermined", "name": "「高处」专项规则未判定", "message": "…", "detail": "作业 X 未标注作业类型；涉及规则：HP-001、…", "advice": "…", "basis": "…", "jobs": [] }
  ],
  "extraction_notes": ["字段：方案情况 → 填了什么"],
  "disclaimer": "本结果为辅助核查，不替代检修方案审批；依据条款按记忆整理，以 GB 30871-2022 正式文本与企业制度为准。"
}
```

- `findings` 必须是数组，否则脚本报错终止（常见错误：把 `summary.json` 当 `result.json` 传入）。
- `severity` 四级：`must_fix` 缺失（必须补充）/ `should_improve` 建议完善 / `undetermined` 未判定 / `pass` 已有。不在四级内的值原样保留并单列。
- `UND-<作业类型>` 是规则引擎把"作业未标注类型导致的未判定"按类型聚合后的一条，`detail` 里列出涉及规则号；合并时照搬，不拆开。
- findings 的 `name / message / advice / basis` 来自规则库原文，其中"动火""大修 / 中修"等写法合并时照搬，不替换。
- `result.json` 顶层**没有 `plan_no`、`job_types`**（以上即 check.js 的全部顶层字段）。方案编号与作业类型标签须用 `--plan` 传入 plan.json 读取，见第六节；旧格式结果若自带这两项且未传 `--plan`，照搬并记来源 `result.json`。
- `summary` 与 `findings` 计数不一致 → warning，报告按 findings 重算，`summary` 原值留在 `bridge.json.sourceSummary`。
- 无 `disclaimer` → warning，不伪造。

## 五、车间侧 `notes.json`（`--notes`，可选）

数组，每项 `{item, status, note}`：

```json
[
  { "item": "设备交出条件", "status": "已核实", "note": "交出清单三方已确认" },
  { "item": "同期交叉作业", "status": "未核实", "note": "" },
  { "item": "承包商资质", "status": "不适用", "note": "本厂机修车间自行检修" },
  { "item": "备件与工机具到位", "status": "已核实", "note": "垫片、螺栓已领用，试压泵到位" }
]
```

| 字段 | 取值 | 处理 |
|---|---|---|
| `item` | 固定四项：设备交出条件 / 同期交叉作业 / 承包商资质 / 备件与工机具到位；其它自定义项追加并标「车间自查」 | 固定项缺失 → 「未核实」 |
| `status` | **只认 已核实 / 未核实 / 不适用** | 其它写法（「应该够了」「大概没问题」）→ 按「未核实」并 warning |
| `note` | 自由文字（写核实依据、日期、用哪个技能核对的） | 原样展示 |

不传 `--notes` → 四项全部「未核实」，**脚本不替用户推测**。只做纯核查时不传即可。

## 六、`plan.json` 作为 `--plan`（可选，建议始终传）

即第 3 步交给 `check.js --input` 的同一份 `plan.json`。`result.json` 不含方案编号与作业类型，merge-report 只从这里读两项：

| 读取 | 来源字段 | 写入 | 规则 |
|---|---|---|---|
| 方案编号 | `plan_no` | `sourceMeta.plan_no`、md 字段表 | 原值；为空 → null 并 warning，不猜测 |
| 作业类型标签 | `jobs[].job_types` | `sourceMeta.jobTypes` / `jobTypesCn` | 各作业原值去重、按出现顺序；`null`（未标注）的作业不计；另加注八大类名称（动火 → 用火作业） |

- 两项只进抬头字段表，**不进入判定**；判定一律以 `result.json` 的 findings 为准。
- `plan.json` 的 `unit` / `project` 与 `result.json` 不一致，或 `jobs` 条数与 `jobs_count` 不一致 → warning，提示核对是否同一份方案（不中断）。
- 不传 `--plan` → 两项为 null / 空数组并 warning；结果若为旧格式、顶层自带 `plan_no` / `job_types`，则照搬并记来源 `result.json`。
- 文件不存在、JSON 非法、不是对象 → `ok:false` 退出 1。

## 七、不会发生的事

- 不会改写规则引擎任何一条 finding 的级别、措辞、建议或顺序
- 不会把「未判定」归到已有或缺失
- 不会替换规则库原文里的"动火"等写法（作业类型标签只作加注）
- 不会按检修分级增减规则（分级只进抬头）
- 不会在没有 `notes.json` 时把车间侧项标为已核实
- 不会在 node 不可用时凭经验判定方案
