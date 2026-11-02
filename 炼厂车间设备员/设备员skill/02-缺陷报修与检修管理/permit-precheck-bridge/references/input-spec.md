# 输入规格：作业票预检入口

本技能不读表、不读票面；票面由源技能 `work-permit-precheck` 解析。本技能的两个输入是**源技能的 `result.json`** 与**车间侧 `notes.json`**。

## 一、作业票文件（交给源技能）

| 形式 | 处理 |
|---|---|
| `.docx` | 源技能 `scripts/docx2text.js` 转文本后抽取 `permit.json` |
| PDF | **先用平台 pdf 技能转为 txt/docx 再传入，脚本不读 PDF；扫描件需 OCR** |
| 图片 | 由模型读图抽取，每处 null / 推断在源技能 `extraction_notes[]` 记一条 |
| 文字描述 | 按源技能抽取手册直接映射 |

作业许可（电子作业票）系统导出的票面字段，常见列名与源技能字段的对应（供抽取时参照，由源技能 `references/extraction-guide.md` 最终决定）：

| 系统列名 | 源技能字段 | 说明 |
|---|---|---|
| 许可证编号 / 作业票编号 / 票号 / 许可证号 | `permit_no` | |
| 作业类别 / 作业类型 / 许可类别 | `type` | 系统写"用火作业"时源技能按"动火"识别，转达时照搬原词 |
| 作业级别 / 用火级别 / 动火级别 / 高处等级 / 吊装等级 | `level` | 以票面为准，不自判 |
| 作业地点 / 作业区域 / 作业部位 | `location` | |
| 属地监护人 / 属地监护 / 车间监护人 | 监护人（属地） | 中石化为双监护 |
| 作业单位监护人 / 作业监护人 / 施工监护人 | 监护人（作业单位） | |
| 作业负责人 / 施工负责人 | `applicant` 或 `job_leader` | 以源技能 schema 为准 |
| 作业单位 / 施工单位 / 承包商 | `contractor` | |

## 二、源技能 `result.json`（`--result`，必需）

由 `node "<work-permit-precheck>/scripts/precheck.js" --input permit.json --out <dir> --now <ISO 带时区>` 生成，结构：

```jsonc
{
  "permit_no": "DH-2026-0826-017",
  "type": "动火",            // 票面原词；本技能加注八大类名称但不改此值
  "level": "一级",
  "now": "2026-08-26 08:50（北京时间）",
  "summary": { "must_fix": 3, "should_improve": 2, "undetermined": 1, "pass": 39 },
  "skipped": 85,
  "findings": [
    { "rule_id": "G-011", "severity": "must_fix", "message": "…", "detail": "…", "basis": "…", "rule_type": "required", "check_name": "…" }
  ],
  "extraction_notes": ["字段：票面情况 → 填了什么"],
  "disclaimer": "本结果为辅助预检，不替代作业票审批；条款号以 GB 30871-2022 正式文本为准。"
}
```

- `findings` 必须是数组，否则脚本报错终止（常见错误：把 `summary.json` 当 `result.json` 传入）。
- `severity` 四级：`must_fix` 必须整改 / `should_improve` 建议完善 / `undetermined` 未判定 / `pass` 通过。不在四级内的值原样保留并单列。
- `summary` 与 `findings` 计数不一致 → warning，报告按 findings 重算，`summary` 原值留在 `bridge.json.sourceSummary`。
- 无 `disclaimer` → warning，不伪造。

## 三、车间侧 `notes.json`（`--notes`，可选）

数组，每项 `{item, status, note}`：

```json
[
  { "item": "设备交出条件", "status": "已核实", "note": "交出单四方已签字，盲板 3 块已挂牌" },
  { "item": "同区域交叉作业", "status": "未核实", "note": "" },
  { "item": "承包商资质", "status": "不适用", "note": "本厂机修车间自行施工" }
]
```

| 字段 | 取值 | 处理 |
|---|---|---|
| `item` | 固定三项：设备交出条件 / 同区域交叉作业 / 承包商资质；其它自定义项追加并标「车间自查」 | 固定项缺失 → 「未核实」 |
| `status` | **只认 已核实 / 未核实 / 不适用** | 其它写法（「大概没问题」「应该交出了」）→ 按「未核实」并 warning |
| `note` | 自由文字（写核实依据、日期、来源技能） | 原样展示 |

不传 `--notes` → 三项全部「未核实」，**脚本不替用户推测**。

## 四、不会发生的事

- 不会改写源技能任何一条 finding 的级别、措辞或顺序
- 不会把「未判定」归到符合或不符合
- 不会把源技能的"动火"改写成"用火"（只在字段表加注八大类名称）
- 不会在没有 `notes.json` 时把车间侧项标为已核实
- 不会在源技能不可用时自行判定票据
