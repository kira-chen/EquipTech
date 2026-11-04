# scripts 使用说明

## qualify.js —— 主脚本

```bash
node "<技能目录>/scripts/qualify.js" \
  --input "<资质清单xlsx>" \
  --contractor "<承包商名称>" \
  --work-type "<作业类型[,作业类型2...]>" \
  --contractor-type <施工类|维保类|技术服务类> \
  --from <YYYY-MM-DD> --to <YYYY-MM-DD> \
  [--edu-valid-days <天>] [--medical-valid-days <天>] [--review-years <年>] \
  --out "<输出目录>"
```

### 参数

| 参数 | 必需 | 说明 |
|---|---|---|
| `--input` | 是 | 资质清单 xlsx（含「单位资质」「人员证书」工作表，至少一张），或同结构 CSV 目录 |
| `--contractor` | 是 | 承包商名称 |
| `--work-type` | 是 | 作业类型，多个用逗号/顿号分隔。**决定核验哪些证书，不得省略**；全部无法识别时报错退出 |
| `--from` | 是 | 作业开始日期 YYYY-MM-DD |
| `--to` | 是 | 作业结束日期 YYYY-MM-DD，须不早于 `--from` |
| `--contractor-type` | 否 | 承包商类别：施工类 / 维保类 / 技术服务类（近义词可识别）。**施工类必备安全生产许可证**，维保类/技术服务类不要求；未给时安许按提示项，不判缺证（《中国石化承包商安全管理规定》） |
| `--edu-valid-days` | 否 | 入厂安全教育有效天数（厂内口径）。未给 → 只有"入厂教育日期"的人员进未判定 |
| `--medical-valid-days` | 否 | 体检有效天数（厂内口径），只对高处/受限空间作业人员生效。未给 → 只有"体检日期"的人员进未判定 |
| `--review-years` | 否 | 特种作业操作证复审周期（年），清单无"下次复审"时自复审日期/发证日期按自然月推算并标"（推算）"。未给 → 不推算，只认"下次复审"列 |
| `--out` | 否 | 输出目录，默认输入文件同目录下 `资质核验/`；**建议始终传 `--out`** |
| `--lead-days` | 否 | 临期提醒天数，默认 **30** |
| `--spec` | 否 | 厂内准入要求清单 xlsx，仅做对照提示，不改变自动判定 |
| `--history` | 否 | 历史准入记录 xlsx，仅做对照 |

可识别作业类型（《中国石化作业许可管理规定》命名）：用火作业（"动火"可识别）、高处作业、受限空间作业、吊装作业、临时用电作业、压力容器焊接（近义写法见 `references/qualification-rules.md`）。

写死阈值只有临期 30 天（`--lead-days` 可调）；入厂教育、体检、复审周期一律不设默认值，由参数接厂内口径。

### 产出

| 文件 | 内容 |
|---|---|
| `qualify.json` | `meta`（含 contractorType/contractorCode/厂内口径参数）、`companyQual`、`personnelQual`（含 nextReview/reviewDerived/eduDate/medicalDate）、`requirements`、`mandatory`（入厂教育/安全协议/体检）、`expired`（计入阻断）、`irrelevantExpired`（与本次作业无关的过期证书，不阻断）、`expiringSoon`、`scopeMismatch`、`missing`、`advisories`、`undetermined`、`unrecognized`、`specExtra`、`history`、`counts`（含 irrelevantExpired/mandatory/mandatoryUndetermined）、`conclusion`、`warnings` |
| `qualify.md` | 九节报告（四节分 4.1 证书要求 / 4.2 必备材料；五节分 5.1~5.6），分析段留 `<!-- ANALYSIS_START/END -->` 占位，末尾含固定声明行；不含 emoji |
| `summary.json` | 末行摘要落盘（Windows 控制台乱码兜底） |

### 判定口径要点

- **有效期为空或无法解析 → `undetermined` 单列，绝不按有效处理**
- **证书类型无法识别 → `unrecognized` 单列，脚本不认定其可替代任何所需证书**
- 证书有效期须覆盖整个作业期；作业结束日前失效的计入已过期
- 压力容器焊接的项目代号（如 SMAW-FeII-6G）为空 → 计入 `undetermined`，不判合格
- 特种作业操作证"下次复审"已过 → 已过期（复审逾期即无效）
- 过期是否阻断看与本次作业是否相关：单位资质、入厂教育/培训/体检等通用项、本次作业类型需要的作业类证书、类型无法识别的证书过期 → `expired`，不建议准入；与本次作业类型无关的作业类证书过期 → `irrelevantExpired`（5.6 节），不阻断，提示该人员不得从事对应作业；`--work-type` 有无法识别的类型时全部进 `expired` 并 warning
- 入厂安全教育、安全协议、体检（高处/受限空间）缺失或无法判定 → `undetermined`，不判合格也不判缺证
- Q1 = 起重机指挥、Q2 = 起重机司机（TSG Z6001-2019）；司索工无取证项目、一般高处检修不需高处作业证 → 提示项，不计缺证
- 结论只有三档：建议准入 / 建议补充材料后再审 / 不建议准入，**不是准入决定**

### 退出码
- `0`：成功，末行输出 `{"ok":true,...}`
- `1`：失败，末行输出 `{"ok":false,"error":"...","warnings":[...]}`

## make-sample.js —— 样例生成

```bash
node scripts/make-sample.js --out examples [--seed <n>] [--date <YYYY-MM-DD>]
```

生成 6 份样例：主样例（问题承包商，施工类）、全部合规变体、压力容器焊接变体、SAP/承包商管理平台导出风格变体（供应商编码、三级安全教育日期、下次复审日期列名，维保类）、厂内准入要求清单、历史准入记录。默认 `--date 2026-10-26`，样例日期相对该日生成，预期计数以在该日附近运行为准（临期项留有 20 天以上余量）。
seed 改变证号与具体日期但不改变结论：主样例恒为 2 过期 + 1 项与本次作业无关的过期（吴长海低压电工证复审逾期）、2 临期、2 范围不符、2 缺失、3 未判定（含 2 项必备材料）、2 类型待确认，结论恒为「不建议准入」。

**样例中人名、单位名、证书编号全部编造，不对应任何真实主体。**

## selftest.js —— 自测

```bash
node scripts/selftest.js
```

206 条断言，覆盖：有效期空/无法解析的未判定、证书类型无法识别不得替代、结论三档与非准入决定表述、固定声明行与不核实真伪、临期默认 30 天与 `--lead-days`、作业期内失效、高处提示项、项目代号缺失、吊装 Q1/Q2 与司索提示项、安许按承包商类别、必备材料（安全协议/入厂教育/体检）缺失→未判定与厂内参数生效、复审逾期按过期与 `--review-years` 推算、ISO 归类收窄、SAP/平台导出列名、用火术语与无 emoji、缺表不中断、表头与合计行、空行跳过、参数校验、厂内要求与历史对照、产出结构、与本次作业无关的过期证书不阻断（相关证书/单位资质/通用项/未识别类型仍阻断，作业类型有未识别项时保持严格）。全绿退出 0。
