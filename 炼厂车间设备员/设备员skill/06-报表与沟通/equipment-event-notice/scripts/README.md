# scripts 使用说明

## notice.js —— 主脚本

```bash
node "<技能目录>/scripts/notice.js" \
  --tag "<位号>" --time <ISO8601带时区> \
  --desc "<事件经过>" --status "<当前状态>" \
  --impact "<影响情况>" --measures "<已采取措施>" \
  --followup "<后续安排>" \
  --out "<输出目录>"
```

### 参数

| 参数 | 必需 | 说明 |
|---|---|---|
| `--tag` | 是 | 设备位号，通报必须挂到具体设备 |
| `--desc` | 是 | 事件经过 |
| `--time` | 否（要素必需） | ISO 8601 **带时区**（如 `2026-09-21T08:20:00+08:00` 或 `Z` 结尾）；缺时区或非法格式直接报错 |
| `--status` | 否（要素必需） | 当前状态；缺失列入 `missing` |
| `--impact` | 否（要素必需） | 影响情况（生产/安全/环保）；缺失列入 `missing`，**不按「无影响」默认** |
| `--measures` | 否（要素必需） | 已采取措施；缺失列入 `missing` |
| `--followup` | 否 | 后续安排，非必需要素 |
| `--name` | 否 | 设备名称，写入标题与概况表 |
| `--workshop` | 否 | 车间名，写入标题 |
| `--area` | 否 | 所在区域 |
| `--scope` | 否 | 通报范围，取值 `车间`/`分厂`/`公司`（中石化组织层级三档），默认 `车间`；旧写法「设备部」「全厂」报错 |
| `--scope-name` | 否 | 层级的厂内名称（如「烯烃厂设备科」「公司设备管理部门（机动部）」），只作展示 |
| `--type` | 否 | 事件类型，取值 `故障`/`险肇`/`异常`，默认 `故障`；非法取值报错 |
| `--cause` | 否 | 原因说明；**未同时给 `--cause-confirmed` 时不写入正文** |
| `--cause-confirmed` | 否（旗标） | 声明原因已由正式调查确认，才允许把 `--cause` 写入正文 |
| `--hazard-level-confirmed` | 否（旗标） | 声明「重大隐患」等隐患等级用语已按厂内隐患分级标准确认：S43/S52 命中项移入 `hazardLevelKept` 不再列为禁用，并 warning 要求注明分级依据；不影响 S41「事故」等其它定性词 |
| `--out` | 否 | 输出目录，默认系统临时目录 `<os.tmpdir()>/notice-out`，**建议始终传** |

> `--time`、`--status`、`--impact`、`--measures` 在参数层面可缺省（脚本不中断），但它们是通报必需要素，缺失会进 `missing` 并逐条 warning，**须向用户补充，不得用推测填补**。

### 产出

| 文件 | 内容 |
|---|---|
| `notice.json` | `meta`（含 `scope`/`scopeName`/`scopeCn`/`hazardLevelConfirmed`）、`elements`、`missing`、`speculative`、`hazardLevelKept`、`escalationHint`、`unplannedShutdownHint`、`cause`、`counts`、`warnings` |
| `notice.md` | 七节通报稿 + 附一缺失要素 / 附二检出表述 / 附二之一保留的隐患等级用语 / 附三上报提示 / 附四非计划停工事件提示（均按需出现）+ 末尾固定声明行；无 emoji，醒目提示用「【注意】」 |
| `summary.json` | 末行摘要落盘 |

### 退出码
- `0`：成功，末行 `{"ok":true,...}`
- `1`：失败，末行 `{"ok":false,"error":"...","warnings":[...]}`

### counts 字段

| 字段 | 含义 |
|---|---|
| `elementsTotal` / `elementsPresent` | 要素总数 / 已提供数 |
| `missing` | 缺失的必需要素数 |
| `speculative` | 检出的推测性/定性表述总数 |
| `speculativeBlock` | 必须改写的条数（归因/责任/厂家质量/定性/个人追责） |
| `speculativeReview` | 需有依据方可保留的条数（程度夸大类） |
| `speculativeByCategory` | 按类别的条数 |
| `escalationTriggers` | 上报提示触发情形数 |
| `unplannedShutdownTriggers` | 非计划停工事件提示触发数（E4 停车/停工） |
| `hazardLevelKept` | 按厂内分级确认保留的隐患等级用语条数 |

## lib/rules.js —— 表述检测规则引擎

可单独 require 做单元测试：
```js
const R = require('./lib/rules');
R.scanSpeculative('由于操作不当导致停车', '事件经过');
// → [{ruleId:'S11', category:'attribution', text:'由于', index:0, severity:'block', suggest:'…'}, …]
R.scanBlameNames('当班操作工王建国操作不当', '事件经过');
// → [{ruleId:'N1', text:'王建国', …}]
R.scanEscalation(['装置紧急停车']);
// → {hint:true, text:'请按厂内规定判断是否需走事故快报流程，可使用 incident-flash-report 技能', triggers:[{ruleId:'E4',…}]}
R.checkElements({tag:'P-1', desc:'x'});
// → {elements:[…7项…], missing:[{key:'time',…},{key:'status',…},{key:'impact',…},{key:'measures',…}]}
R.CAUSE_UNDER_ANALYSIS;  // '原因正在分析中'
R.DISCLAIMER;            // '本通报为情况告知，事件原因与性质以正式调查结论为准'
```

规则号口径见 `references/notice-rules.md`：
- `S11`~`S16` 归因类、`S21`~`S26` 责任类、`S31`~`S33` 厂家质量类、`S41`~`S43` 定性类、`S51`~`S53` 程度夸大类
- `N1` 个人姓名追责性表述
- `E1`~`E5` 上报提示触发情形（**只提示不判定**）；E4（停车/停工）同时触发非计划停工事件提示（`unplannedShutdownHint`，按《炼化企业非计划停工管理规定》另行报送，与事故快报分开）
- 规则同源：S1x~S4x 与 `07-隐患事故与合规/failure-investigation-assistant/scripts/lib/rules.js` 的 C1~C8/J1~J5 是同一套口径，S41 的「事故」负向排除词表两边必须一致，改一处须同步另一处

## make-sample.js —— 样例生成

```bash
node scripts/make-sample.js --out examples [--seed <n>] [--date <YYYY-MM-DD>]
```

主样例恒为 4 条事件素材：EV-01 要素齐全无禁用表述；EV-02 含五类禁用表述；EV-03 缺 3 项必需要素；EV-04（通报范围 分厂）触发上报提示与非计划停工提示并含个人追责表述。seed 只改变时间、数值与人名，预期结论不变。

## selftest.js —— 自测

```bash
node scripts/selftest.js
```

172 条断言：规则引擎推测性表述逐条覆盖、个人追责、上报提示、要素校验、正常路径、原因硬约束、推测检出、上报提示产出、个人追责产出、缺失要素、参数校验（含旧写法「设备部/全厂」拒绝）、层级三档与 `--scope-name`、非计划停工事件提示（触发与不触发两个方向、与事故快报分开、不判定、无 emoji、「【注意】」）、`--hazard-level-confirmed`（S43/S52 保留、不放行 S41、无命中时提示未起作用）。
