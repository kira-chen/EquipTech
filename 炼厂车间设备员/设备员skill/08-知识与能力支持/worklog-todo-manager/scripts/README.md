# scripts 使用说明

## todo.js —— 主脚本

```bash
node "<技能目录>/scripts/todo.js" \
  --input "<路径>[,<路径2>...]" \
  --owner "<姓名或岗位>" \
  --date <YYYY-MM-DD> \
  --out "<输出目录>"
```

### 参数

| 参数 | 必需 | 说明 |
|---|---|---|
| `--input` | 是 | 一个或多个路径（逗号分隔）：上游技能 JSON、待办表 xlsx / CSV 目录、`.txt`/`.md` 文字待办，可混传 |
| `--owner` | 是 | 使用人姓名或岗位 |
| `--date` | 是 | 基准日期 YYYY-MM-DD，逾期天数与分桶以此为准 |
| `--out` | 否 | 输出目录，默认系统临时目录 `<os.tmpdir()>/wtm-out`，建议始终传 `--out` |
| `--prev` | 否 | 上一日 `todo.json`，未完成项原样结转；文件不存在或解析失败即报错 |
| `--done` | 否 | 今日完成事项，文字（按换行 / `;` / `；` 拆条）或文本文件路径；不提供则日志该节留空 |
| `--priority-rules` | 否 | 厂内优先级口径说明，写入 `meta.priorityRules` 供成文引用，不改判脚本优先级 |
| `--horizon` | 否 | 前瞻天数，默认 7，须为不小于 0 的整数 |

### 可识别的上游 JSON

| 来源技能 | 文件 | 取作待办的字段 |
|---|---|---|
| work-order-tracker | `orders.json` | `overdue[]`、`stalled[]`、`dueSoon[]` |
| hazard-closure-tracker | `hazard.json` | `overdue[]`、`dueSoon[]`、`unverified[]` |
| special-equipment-inspection-due | `inspection.json` | `overdue[]`、`dueSoon[]` |
| valve-instrument-calibration-ledger | `calibration.json` | `overdue[]`、`dueSoon[]`、`unresolvedFail[]` |
| lubrication-manager | `lube.json` | `overdue[]`、`dueSoon[]` |
| defect-intake-grading | `defects.json` | `defects[]`（按 `dueDate`；等级 A/B/C，旧 I~IV 映射并 warning） |
| shift-handover-record | `handover.json` | `pending[]`（交接未完成事项；约定 `meta.skill === 'shift-handover-record'` 且含 `pending` 数组；旧版无 `meta.skill` 按结构推断并 warning） |

按特征字段自动识别，无需用户指明。待办表支持 SAP/EM 导出列名（工作事项 / 要求完成日期 / 紧急程度 / 功能位置 / 工单号 / 通知单号 / 处理状态）。**无法识别的 JSON 记 warning 并忽略，不中断其余来源的汇集**；全部来源都无法识别且无结转项时才报错。

### 产出

| 文件 | 内容 |
|---|---|
| `todo.json` | `counts`、`overdue`、`today`、`upcoming`、`later`、`noDueDate`、`carriedOver`、`byCategory`、`possibleDuplicate`、`done`、`items`、`warnings`；次日作 `--prev` 入参 |
| `待办清单.md` | 八节（九节，有前瞻期外项时）：待办概况、已逾期、今日到期、近期、无到期日、结转项、按来源分类、疑似重复、前瞻期外 |
| `工作日志.md` | 四节：今日完成事项、待办概况、需协调事项、明日重点；后两节留 `<!-- ANALYSIS_START/END -->` 占位 |
| `summary.json` | 末行摘要落盘（Windows 控制台乱码兜底） |

两份 md 均含两行声明：「待办汇集自所提供来源，覆盖范围见清单说明；厂内业务系统（EM/SAP PM）中的待办请以系统为准。」与「本材料由脚本汇总、模型成文，仅供设备员复核参考，不替代审批、定性、验收与签字；厂内制度与系统数据为准。」；不用 emoji。

### 优先级口径
工单按 SAP 1 非常高 / 2 高 / 3 中 / 4 低（中文 紧急/高/中/低 同义）：1 → P1；2 且超期 → P1；其余超期与停滞 → P2；临期 → P3。缺陷 A 级（重大）→ P1、B 级（严重）→ P2、C 级（一般）/ 未定级 → P3；旧 I~IV 四级口径按 I→A、II→B、III/IV→C 映射并 warning。交接未完成事项期限已过 → P1，其余 → P2。详见 `references/todo-rules.md`。

### 三条硬规矩（脚本层面保证）
1. `--prev` 的未完成项**全部结转**，保留原始到期日与来源，**绝不自动延期**。
2. 无到期日的事项进 `noDueDate` 单列，**绝不自行设定到期日**。
3. 疑似重复列入 `possibleDuplicate` 供确认，**两条原始待办都保留，绝不自动合并**。

### 退出码
- `0`：成功，末行输出 `{"ok":true,...}`
- `1`：失败，末行输出 `{"ok":false,"error":"...","warnings":[...]}`

## make-sample.js —— 样例生成

```bash
node scripts/make-sample.js --out examples [--seed <n>] [--date <YYYY-MM-DD>]
```

生成 11 份样例：6 个上游技能 JSON、1 份交接记录 `sample-handover.json`（meta.skill 约定，pending 3 条）、1 份待办表 xlsx、1 份 SAP/EM 风格待办表 `sample-todo-sap-style.xlsx`、1 份文字待办、1 个无法识别的 JSON。
seed 改变逾期天数等数值，但不改变结论：全量输入（6 JSON + 待办表 + 文字）恒为待办 23 项 —— 逾期 8、今日到期 2、前瞻期内 7、无到期日 6，疑似重复 3 组；加交接记录后 26 项、P-1101B 疑似重复组 4 条。

## selftest.js —— 自测

```bash
node scripts/selftest.js
```

173 条断言，覆盖：多源 JSON 合并、逾期天数计算、`--horizon`、无到期日不自设、疑似重复不自动合并、结转不丢不延期（含二次结转与同事项去重）、无法识别的 JSON、xlsx 待办表、纯文字待办、`--done` 提供与不提供、参数校验与空输入、优先级排序口径、产出结构与两行声明、交接记录 handover.json（meta.skill 约定、旧版结构推断 warning、pending 非数组不识别、与工单同位号疑似重复不合并）、SAP 工单 1~4 与缺陷 A/B/C 映射、旧 I~IV 口径 warning、SAP/EM 待办表列名（功能位置 / 工单号）、EAM 旧称不出现、无 emoji、默认输出目录为临时目录、make-sample 交接与 SAP 风格样例可再生。全绿退出 0。
