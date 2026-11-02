# 输入规格：设备事件通报

本技能的主输入是**命令行文字参数**，不读取表格。`examples/` 里的 xlsx 是回归测试用的事件素材表，按行取值拼成命令行参数运行，脚本本身不解析它。

## 调用形式

```bash
node scripts/notice.js \
  --tag "P-2101A" --name "柴油加氢进料泵A" --workshop "加氢车间" --area "一区" \
  --time 2026-09-21T08:20:00+08:00 \
  --type 故障 --scope 车间 \
  --desc "<事件经过>" \
  --status "<当前状态>" \
  --impact "<影响情况>" \
  --measures "<已采取措施>" \
  --followup "<后续安排>" \
  --out "<输出目录>"
```

## 参数取值口径

### `--time`（发生时间）

必须是 **ISO 8601 带时区**：`2026-09-21T08:20:00+08:00`，或 `Z` 结尾的 UTC（`2026-09-21T00:20:00Z`，脚本换算为北京时间显示）。

| 输入 | 结果 |
|---|---|
| `2026-09-21T08:20:00+08:00` | 接受 → 显示 `2026-09-21 08:20:00` |
| `2026-09-21T00:20:00Z` | 接受 → 换算为 `2026-09-21 08:20:00` |
| `2026-09-21T08:20:00` | **报错**：缺时区 |
| `2026-09-21 08:20` | **报错**：缺时区 |
| `昨天下午` | **报错**：非有效时间 |

**发生时间不是发现时间**。只知道发现时间的，应在 `--desc` 里写明「XX 时 XX 分巡检发现……」，并向用户确认发生时间是否可追溯。

### `--scope`（通报范围）与 `--scope-name`

取值限定中石化组织层级三档 `车间` / `分厂` / `公司`，默认 `车间`。旧写法「设备部」「全厂」报错——通报范围决定读者面，不能含糊。各厂层级名称不同（分厂可能叫作业部、烯烃厂；公司层级是公司设备管理部门（机动部/设备部）），用 `--scope-name` 给出厂内名称，只作展示。

### `--hazard-level-confirmed`

「重大隐患」是分级定性用语（S43/S52）。只有已按厂内隐患分级标准确认、且能注明分级依据（文号或隐患台账编号）时才传此旗标；传了之后这些用语移入 `hazardLevelKept`，不再列为禁用，但 warning 仍要求在通报中注明依据。旗标不放行「事故」（S41）等其它定性词。隐患等级认定由安全环保部门归口。

### `--type`（事件类型）

取值限定 `故障` / `险肇` / `异常`，默认 `故障`。**不含「事故」**：事故是正式定性用语，未经定性不得使用（规则 S41）。

| 取值 | 用在什么情况 |
|---|---|
| 故障 | 设备功能丧失或下降，已影响或可能影响运行 |
| 险肇 | 未造成后果但已具备造成后果条件的情形 |
| 异常 | 参数或状态偏离正常范围，尚未构成故障 |

### `--cause` 与 `--cause-confirmed`

| 传参 | 正文原因一栏 |
|---|---|
| 都不传 | 「原因正在分析中」 |
| 只传 `--cause` | 「原因正在分析中」，**`--cause` 内容不进正文**，warning 提示 |
| `--cause` + `--cause-confirmed` | 写入 `--cause` 内容，并注明「如与调查结论不一致以结论为准」 |

`--cause-confirmed` 是用户对「原因已由正式调查确认」的显式声明。没有这个声明，脚本一律按未确认处理。

### 必需要素与必需参数的区别

| | 参数层面 | 要素层面 |
|---|---|---|
| `--tag` | **必需**，缺则报错退出 | 必需要素 |
| `--desc` | **必需**，缺则报错退出 | 必需要素 |
| `--time` | 可缺省 | 必需要素，缺则进 `missing` + warning |
| `--status` | 可缺省 | 必需要素，缺则进 `missing` + warning |
| `--impact` | 可缺省 | 必需要素，缺则进 `missing` + warning |
| `--measures` | 可缺省 | 必需要素，缺则进 `missing` + warning |
| `--followup` | 可缺省 | 非必需要素 |

要素缺失**不中断**脚本：通报稿照常产出，缺的地方写「（未提供 XX，须补充后成文，不得推测填补）」，同时在「附一、缺失要素」一节单列。这样用户能先看到框架，再按清单补齐。

## 产出

| 文件 | 内容 |
|---|---|
| `notice.json` | `meta`、`counts`、`elements`、`missing`、`speculative`、`escalationHint`、`cause`、`warnings` |
| `notice.md` | 七节通报稿 + 附一缺失要素 + 附二检出表述 + 附三上报提示 + 附数据提示 + 末尾声明行 |
| `summary.json` | 末行摘要落盘 |

### notice.json 主要字段

```jsonc
{
  "meta": { "scope": "分厂", "scopeName": "烯烃厂设备科", "scopeCn": "分厂（烯烃厂设备科）", "type": "故障", "tag": "P-2101A", "eventTime": "2026-09-21 08:20:00",
            "causeConfirmed": false, "hazardLevelConfirmed": false, "disclaimer": "本通报为情况告知，事件原因与性质以正式调查结论为准" },
  "counts": { "elementsTotal": 7, "elementsPresent": 7, "missing": 0,
              "speculative": 0, "speculativeBlock": 0, "speculativeReview": 0,
              "speculativeByCategory": {}, "escalationTriggers": 0, "unplannedShutdownTriggers": 0, "hazardLevelKept": 0 },
  "elements": [ { "key": "impact", "cn": "影响情况", "required": true, "present": true, "value": "…", "arg": "--impact" } ],
  "missing":  [ { "key": "status", "cn": "当前状态", "arg": "--status", "ask": "…", "note": "要素缺失，须向用户补充，不得用推测填补" } ],
  "speculative": [ { "ruleId": "S11", "category": "attribution", "categoryCn": "归因类（未经调查的因果表述）",
                     "field": "事件经过", "fieldKey": "desc", "text": "由于", "index": 0,
                     "severity": "block", "why": "…", "suggest": "…", "context": "…" } ],
  "escalationHint": { "hint": true, "text": "请按厂内规定判断是否需走事故快报流程，可使用 incident-flash-report 技能",
                      "triggers": [ { "ruleId": "E4", "keyword": "紧急停车", "note": "描述中提到装置停车" } ],
                      "note": "本提示仅供参考，脚本不判定事件性质，…" },
  "unplannedShutdownHint": { "hint": true, "text": "描述中提到装置停车/停工，可能构成非计划停工事件，请按《炼化企业非计划停工管理规定》与厂内规定判断并另行报送（与事故快报分开），本技能不判定", "triggers": [ { "ruleId": "E4", "keyword": "紧急停车" } ] },
  "hazardLevelKept": [],
  "cause": { "text": "原因正在分析中", "confirmed": false, "note": "…" }
}
```

- `speculative[].index` 是该表述在**所属字段文本**中的字符下标（从 0 开始），md 里显示为「第 N 字」（N = index + 1）。
- `speculative[].severity`：`block` 必须改写；`review` 需有依据方可保留。
- 同一位置被多条规则命中时**全部保留**（如「严重违反」同时命中 S42 与 S51），规则号可追溯。

## 事件素材表（examples/，仅回归测试用）

sheet 名「事件素材」，列：素材编号、位号、设备名称、所在区域、发生时间、事件类型、通报范围、事件经过、当前状态、影响情况、已采取措施、后续安排、预期验证点。

每行对应一次 `notice.js` 调用，空单元格表示该参数不传（用于验证要素缺失的处理）。
