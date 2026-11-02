# 输入规格：检修方案安全措施核查入口

本技能不读表、不读方案；方案由源技能 `overhaul-safety-check` 解析。本技能的两个输入是**源技能的 `result.json`** 与**车间侧 `notes.json`**，另有可选参数 `--repair-type`。

## 一、检修方案文件（交给源技能）

| 形式 | 处理 |
|---|---|
| `.docx` | 源技能 `scripts/docx2text.js` 转文本后抽取 `plan.json` |
| PDF | **先用平台 pdf 技能转为 txt/docx 再传入，脚本不读 PDF；扫描件需 OCR** |
| 图片 / 扫描件 | 由模型读图抽取，每处 null / 推断在源技能 `extraction_notes[]` 记一条 |
| 文字描述 | 按源技能抽取手册直接映射 |

源技能抽取时的关键字段：`unit`（装置）、`project`（检修项目）、`contractor`（承修单位）、`duration_days`（工期）、`jobs[]`（每项作业的名称与 `job_types` 标签）、`measures{}`（方案已写明的措施）、`org{}`、`attachments{}`。**方案没写的一律 null**，不按"常规肯定会做"猜。

## 二、检修分级（`--repair-type`，可选）

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

## 三、源技能 `result.json`（`--result`，必需）

由 `node "<overhaul-safety-check>/scripts/check.js" --input plan.json --out <dir>` 生成，结构：

```jsonc
{
  "unit": "常减压装置（原油换热器 E-1201）",
  "project": "E-1201 抽管束清洗及法兰补焊检修方案",
  "contractor": "检修公司第二工程部",
  "duration_days": 5,
  "jobs_count": 4,
  "summary": { "must_fix": 3, "should_improve": 2, "undetermined": 1, "pass": 40 },
  "skipped": 24,
  "findings": [
    { "rule_id": "G-003", "severity": "must_fix", "name": "风险辨识与 JSA", "message": "…", "detail": "…", "advice": "方案里怎么补", "basis": "…", "jobs": ["触发作业名"] },
    { "rule_id": "UND-高处", "severity": "undetermined", "name": "「高处」专项规则未判定", "message": "…", "detail": "作业 X 未标注作业类型；涉及规则：HP-001、…", "advice": "…", "basis": "…", "jobs": [] }
  ],
  "extraction_notes": ["字段：方案情况 → 填了什么"],
  "disclaimer": "本结果为辅助核查，不替代检修方案审批；依据条款按记忆整理，以 GB 30871-2022 正式文本与企业制度为准。"
}
```

- `findings` 必须是数组，否则脚本报错终止（常见错误：把 `summary.json` 当 `result.json` 传入）。
- `severity` 四级：`must_fix` 缺失（必须补充）/ `should_improve` 建议完善 / `undetermined` 未判定 / `pass` 已有。不在四级内的值原样保留并单列。
- `UND-<作业类型>` 是源技能把"作业未标注类型导致的未判定"按类型聚合后的一条，`detail` 里列出涉及规则号；本技能照搬，不拆开。
- `job_types`（顶层，可选）：源技能当前版本不输出该字段；若有则原值照搬并加注八大类名称。
- `summary` 与 `findings` 计数不一致 → warning，报告按 findings 重算，`summary` 原值留在 `bridge.json.sourceSummary`。
- 无 `disclaimer` → warning，不伪造。

## 四、车间侧 `notes.json`（`--notes`，可选）

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
| `note` | 自由文字（写核实依据、日期、来源技能） | 原样展示 |

不传 `--notes` → 四项全部「未核实」，**脚本不替用户推测**。

## 五、不会发生的事

- 不会改写源技能任何一条 finding 的级别、措辞、建议或顺序
- 不会把「未判定」归到已有或缺失
- 不会把源技能的"动火"标签改写成"用火"（只作加注）
- 不会按检修分级增减规则（分级只进抬头）
- 不会在没有 `notes.json` 时把车间侧项标为已核实
- 不会在源技能不可用时自行判定方案
