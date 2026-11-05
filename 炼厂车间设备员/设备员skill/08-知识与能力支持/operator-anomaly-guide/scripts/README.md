# scripts 使用说明

## guide.js —— 主脚本

```bash
node "<技能目录>/scripts/guide.js" \
  --scope "<设备类型或范围>" \
  --workshop "<车间名>" \
  --report-to "<上报对象>" \
  --out "<输出目录>"
```

### 参数

| 参数 | 必需 | 说明 |
|---|---|---|
| `--workshop` | 是 | 车间名称；`--ledger` 设备清单带车间列时按它核对车间范围 |
| `--report-to` | 是 | 上报对象。**必填，脚本不自行设定上报路径** |
| `--scope` | 与 `--ledger` 至少一项 | 设备类型、位号或区域，逗号分隔。与 `--ledger` 同时给时按 scope 过滤清单（类型命中或位号 / 名称 / 区域包含），warning 写明保留与剔除台数；清单里没有的类型照常成节并 warning；「全部 / 所有」不过滤 |
| `--ledger` | 与 `--scope` 至少一项 | 设备清单 xlsx，自动按类型归组；可带「车间」列（可选），按 `--workshop` 核对车间范围 |
| `--out` | 否 | 输出目录，默认 `<os.tmpdir()>/oag-out`（系统临时目录，建议始终传 `--out`） |
| `--emergency` | 否 | 紧急上报方式；未提供时标注「待车间补充」 |
| `--spec` | 否 | 操作规程或应急预案路径（仅记录来源） |
| `--format` | 否 | 卡片 / 手册，默认卡片 |
| `--actions` | 否 | 自拟处置动作，逗号分隔。**会经职责边界校验，超范围项被拦截** |
| `--no-touch` | 否（开关） | 去掉全部「摸」类观察点与依赖手摸的异常特征（烫手/手感），并 warning 说明改由巡检仪/测温枪或设备员点检判断。不加时每条「摸」类观察点前自动加「仅在操作规程允许且确认安全（无带电、无高温烫伤、无运转部件）时」 |

设备清单列名经 `C.mergeAliases` 合并共享 `SYSTEM_ALIASES`：SAP PM / EM 导出的「功能位置 / 技术对象」归位号，「设备描述 / 技术对象描述」归设备名称，「对象类型 / 设备分类」归设备类型，「工厂区段 / 单元」归区域。**「设备」「设备编号」列是 SAP 8 位流水号，不当位号。**

### 产出

| 文件 | 内容 |
|---|---|
| `guide.json` | `meta`（含 `noTouch`、`touchQualifier`、`statement`、`workshopScope`：清单车间范围核对结果，未给 `--ledger` 时为空数组）、`counts`（含 `touchPointsRemoved`）、`sections[]`（`observe`、`abnormalSigns`、`immediateActions`、`actionNote`）、`reportPath`、`emergency`、`outOfScope`、`scopeRules` |
| `指引卡.md` | 可打印张贴的指引卡 |
| `summary.json` | 末行摘要落盘 |

### 退出码
- `0`：成功
- `1`：失败（缺 `--report-to`、缺设备范围、清单不存在、非法 format）

### 关键行为

1. **超范围动作一律拦截**。`--actions` 传入的动作经 `lib/scope.js` 校验，命中拆检、调整、更换、用火、带电、拆/接/短接接线、解除/屏蔽/旁路联锁与切除安全阀、堵漏等模式的替换为「停止操作并立即上报」，并在报告中单列。S5 只拦「拆/接/短接/甩开/紧固 接线」等动手动作，「检查接线盒外观」不拦。
2. **紧急撤离条件置顶**。排在所有设备类型之前。
3. **上报路径必填**。不给默认值，避免写错延误。
4. **判据用定性**。不输出需仪器测量的数值。
5. **白名单限定语进正文**。「切换至备用设备」「降低负荷」自带「经值班领导/内操同意后执行」，并在每节「发现异常先做什么」下单独一行【注意】提示。
6. **声明行固定**。培训/指引类口径：「本材料仅供参考，不替代操作规程与检修规程；为设备专业建议稿，由车间工艺/安全审核后纳入岗位操作法或 HSE 作业指导书……」，卡头与卡尾各一处。产出 md 不用 emoji，醒目提示用「【注意】」。
7. **车间范围核对**：`--ledger` 设备清单带车间列（车间/所属车间/属地车间/运行部，或其后加「名称」；「车间负责人」等人员列不算）时按 `--workshop` 核对：剔除其他车间的行并 warning，车间为空的行保留；没有一行是本车间时不筛，warning 与报告开头写【注意】；无车间列不筛，口径写「以取数条件为准」；「维护工厂」不当车间列。`meta.workshopScope` 为数组，每张表一项：`sheet`、`status`（`noWorkshop`/`noColumn`/`checked`/`mismatch`）、`column`、`total`、`kept`、`droppedRows`、`dropped`（按车间的剔除行数）、`blank`。车间列全不一致时指引卡标题下写【注意】提示，编制信息行后写车间范围口径；未给 `--ledger` 时不核对、不写口径。

## lib/scope.js —— 职责边界与观察要点库

```js
const S = require('./lib/scope');
S.checkAction('打开泵盖检查');   // {ok:false, ruleId:'S1', reason:'...', suggestion:'停止操作并立即上报…'}
S.checkAction('更换润滑油');      // {ok:true}  加换油属职责内
S.typeOf('鼓风机电机');           // '电机'（电机优先于风机识别）
S.observeOf('离心泵');            // {看:[...], 听:[...], 摸:[...], 闻:[...], 异常特征:[...]}
S.EMERGENCY;                      // 紧急撤离条件
S.TOUCH_QUALIFIER;                // 「摸」类观察点限定语
S.TYPE_PATTERNS;                  // 设备类型识别表（与 training-material-generator/scripts/lib/tm.js 同源，改一处须同步另一处）
```

口径见 `references/scope-rules.md` 与 `references/observe-points.md`。

**注意类型识别顺序敏感**：电机 → 压缩机 → 离心泵 → …。「鼓风机电机」若被「风机」先命中会漏掉电气专属观察项。

## make-sample.js

```bash
node scripts/make-sample.js [--seed <n>]
```

生成三个样例：`sample-equipment-list.xlsx`（覆盖 6 类设备，含 1 类不在覆盖范围的加热炉）、`sample-no-type.xlsx`（缺类型列）、`sample-sap-export.xlsx`（SAP PM 导出列名：功能位置 / 设备 / 设备描述 / 对象类型 / 工厂区段 / 维护工厂）。

## selftest.js

```bash
node scripts/selftest.js
```

176 条断言，覆盖 16 类超范围动作拦截、拆检/单写堵漏/解除或屏蔽联锁/切除安全阀等漏拦修复与「反应器」归塔器容器（N 组 10 条）、否定/疑问写法与「停用后……报警」不误拦、反向语序包扎/拆保温与「摘掉联锁」「打旁路」不漏网（O 组 9 条）、职责内动作放行、S5 接线规则只拦动手动作、类型识别顺序、类型不覆盖、上报路径必填、定性判据无数值、新声明行出现与旧声明行不出现、白名单限定语进正文、「摸」类观察点默认限定语与 `--no-touch` 去除（含报告示例句不写烫手）、SAP 导出列名、md 无 emoji、9 条参数校验、产出完整性、`--ledger` 与 `--scope` 同时给时按 scope 过滤清单（Q 组 11 条）、P002 清单车间范围核对（W 组 19 条：两车间混合只留本车间、车间为空保留、全不一致不筛并【注意】、无车间列口径说明、「维护工厂」不当车间列、未给清单不核对）。
