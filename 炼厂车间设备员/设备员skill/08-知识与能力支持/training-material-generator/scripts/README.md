# scripts 使用说明

## training.js —— 主脚本

```bash
node "<技能目录>/scripts/training.js" \
  --scope "<设备范围或主题>" \
  --audience <新员工|在岗|转岗|复岗|四新|三级安全教育> \
  --docs "<资料路径>" \
  --out "<输出目录>"
```

### 参数

| 参数 | 必需 | 说明 |
|---|---|---|
| `--audience` | 是 | 培训对象：新员工 / 在岗 / 转岗 / 复岗 / 四新 / 三级安全教育（支持别名，见 `references/input-spec.md`）。**决定内容深度，无法识别时报错，不猜**；三级安全教育只做车间级、班组级 |
| `--scope` | 与 `--ledger` 至少一项 | 设备类型、位号或主题，逗号分隔。与 `--ledger` 同时给时按 scope 过滤清单（类型命中或位号 / 名称 / 区域包含），warning 写明保留与剔除台数；「全部 / 所有」不过滤 |
| `--ledger` | 与 `--scope` 至少一项 | 设备清单 xlsx / CSV 目录，自动按类型归组；支持 SAP PM IH08 技术对象导出列名（功能位置 / 设备描述 / 对象类型 / 工厂区段），8 位「设备」流水号不作位号 |
| `--docs` | 否 | 技术资料路径，逗号分隔多个，也可给目录。支持 `.md` `.txt` `.csv` `.docx`；PDF 先用平台 pdf 技能转 txt/docx，脚本不读。**不给则只出原理题，不出任何数值题** |
| `--out` | 否 | 输出目录，默认系统临时目录 `<os.tmpdir()>/tmg-out`，建议始终传 |
| `--duration` | 否 | 总学时（正数）。不给时各模块学时为 `null`，显示「—」 |
| `--questions` | 否 | 题目数量（正整数）。超过素材上限时按上限出并 warning |
| `--types` | 否 | 题型：单选 / 多选 / 判断 / 简答，逗号分隔，默认四种全用 |
| `--difficulty` | 否 | 基础 / 中等 / 较难，默认按培训对象（新员工、三级安全教育=基础；其余=中等） |
| `--workshop` | 否 | 车间名，写进材料抬头 |
| `--no-negative-judge` | 否 | 判断题只出肯定式（默认交替出肯定式 / 否定式，否定式不改数值） |

### 产出

| 文件 | 内容 |
|---|---|
| `培训提纲.md` | 培训目标、模块与学时分配、各模块内容、实操考核项、不在范围内的内容 |
| `讲义要点.md` | 资料来源、通用原理要点、厂内规定要点（逐条带出处）、无资料支撑的内容 |
| `考题与答案.md` | 题量构成、考题、答案与出处表、无资料支撑未出数值题的主题 |
| `training.json` | `outline` / `keyPoints` / `questions` / `practicalItems` / `noSourceTopics` / `counts` / `blockedTopics` / `forbiddenRules` |
| `summary.json` | 末行摘要落盘 |

### 退出码
- `0`：成功
- `1`：失败（缺 `--audience`、培训对象无法识别、缺设备范围、资料或清单不存在、非法难度 / 题量 / 学时 / 题型、全部主题被剔除）

### 关键行为

1. **数值题必须有出处**。答案含技术数值而 `source` 为空的题目**直接剔除**（不是 warning 后照样输出），并在 warnings 中说明。无资料时 `questionsNumeric` 恒为 0。
2. **题量不足不凑数**。`--questions` 超过素材上限时，warning 写清「只能出 N 道（数值类 a、定性规定类 b、原理概念类 c）」，按 N 道出，md 中同步提示缺口。
3. **数值题干遮蔽规定值**。条款中的数值替换为 `＿＿`（带单位的数、区间两端（含「0.05-0.10mm」连字符区间）、比较词后不带单位的数与分数都遮；负数连同负号遮；字母后的「-」按位号不遮，「数字-数字」编号尾段（「E-1201-3 次」「M20-8.8级」）也不遮，真区间「3-5 天」两端照常遮），答案在答案表里带出处。
4. **干扰项不含数值**。单选 / 多选的干扰项一律是定性表述，不把数值改错当干扰项。
5. **判断题否定式不改数值**。肯定式答案「正确」；否定式由 `NEGATE_RULES` 只改情态/比较词（不得→可以、应→无需…），答案「错误」并给出正确表述与出处，改写前后数字序列必须一致，否则退回肯定式。绝不通过改数值构造错误项。
6. **规程类内容一律不生成**。`--scope` 主题与资料条款两处都过 F1~F5 规则，命中即剔除并单列。
7. **原理与厂内规定分节**。原理条目标注「通用原理（非厂内规定）」，且全库不含任何数值。
8. **学时缺失为 null**。显示「—」，不按 0 也不臆造。
9. **内置原理条目标 builtin**。`PRINCIPLES` 每条 `source: 'builtin'`，题目与讲义要点 `origin: builtin`，声明行点名须经车间技术人员审核；`counts.questionsBuiltinPrinciple` 计数。
10. **产出 md 不用 emoji**，醒目提示用「【注意】」。

## lib/tm.js —— 口径库与数值识别

```js
const T = require('./lib/tm');
T.hasNumericValue('紧固力矩为 120 N·m');   // true
T.hasNumericValue('第3.2条 如实填写');      // false（条款号不算技术数值）
T.normAudience('新人');                     // '新员工'；无法识别返回 null
T.normAudience('新设备投用培训');            // '四新'（先于新员工判定）
T.negateStatement('轴承箱温度不得超过 75 ℃'); // {text:'轴承箱温度可以超过 75 ℃', rule:'J1'}，数值不变
T.digitsOf('不大于 4.5 mm/s');              // '4.5'
T.typeOf('鼓风机电机');                     // '电机'（电机优先于风机）
T.checkTopic('开车步骤');                   // {ok:false, ruleId:'F3', reason:'…'}
T.AUDIENCES['转岗'].modules;                // 转岗的四个模块与权重
T.PRINCIPLES['离心泵'];                     // 通用原理条目（定性，不含数值）
T.STATEMENT;                                // 声明行原文
```

口径见 `references/training-rules.md`。

**注意类型识别顺序敏感**：电机 → 压缩机 → 离心泵 → 换热器 → 塔器容器 → 阀门 → 管道 → 通用。`TYPE_PATTERNS` 与 `operator-anomaly-guide/scripts/lib/scope.js` 逐字同源，改一处须同步另一处（selftest N43 跨目录比对）。

## lib/docsrc.js —— 资料读取与条款抽取

```js
const D = require('./lib/docsrc');
D.expandDocPaths('a.md,docs/', warnings);          // 展开文件与目录
D.extractClauses(paths, warnings);                 // → {clauses, files}
D.citeOf({file:'a.md', loc:'第5行', clause:'4.1'}); // 'a.md 第4.1条（第5行）'
```

每条 clause 形如 `{id, text, topicHint, numeric, source:{file, loc, clause}}`。markdown 标题作为 `topicHint`，引用块与表格分隔行跳过。

`.docx` 经 `docx-lite.js` 的 `docxToText` 先解压取 `word/document.xml` 再解析，只取正文段落与表格（页眉页脚不入条款）；段落位置写「第N段」，表格行写「表N第M行」。文件损坏或不是 zip 包时 warning「资料「X.docx」无法解析（…），已跳过」，不中断。资料目录中的 PDF、pptx 等不读的文件逐个 warning（PDF 提示先用平台 pdf 技能转 txt/docx），不静默丢弃。

## lib/docx-lite.js

从 `04-台账档案与资料管理/technical-document-finder/scripts/lib/docx-lite.js` 复制，用于读 Word 规程（`docsrc.js` 调用其 `docxToText`）。不要改动。

## make-sample.js

```bash
node scripts/make-sample.js [--seed <n>]
```

生成：设备清单 xlsx（6 种类型写法，塔器与容器同归塔器容器，共 5 类）、SAP PM IH08 技术对象导出样式 `sample-sap-export.xlsx`（功能位置 / 设备 8 位流水号 / 设备描述 / 对象类型 / 工厂区段 / ABC标识，首行标题，5 台）、缺类型列变体、厂内规程样例 `sample-spec.md`（含 8 条带数值的条款）、无数值资料 `sample-spec-no-number.md`、含操作步骤的资料 `sample-spec-with-procedure.md`。

`--seed` 改变位号区域与规程中的具体数值，但**含数值条款数、可出数值题数、设备类型数不变**。

## selftest.js

```bash
node scripts/selftest.js
```

254 条断言，覆盖：数值识别（含条款号 / 年份不误判）、六类培训对象深度（含复岗 / 四新 / 三级安全教育的厂级归口声明）、通用原理库无数值全扫与 builtin 标记、规程类拦截（含「用火作业许可证办理流程」）、**无资料时正则扫描产出不得出现带数值的答案**、数值题出处完整性、题量不足不凑数、干扰项无数值、判断题否定式（数字序列一致、复合词不误改、`--no-negative-judge`）、题型限定、设备清单别名与合计行、SAP IH08 列名（功能位置作位号、8 位设备号不作位号）、学时 null、16 项参数校验、资料格式与出处写法（含 docx 段落 / 表格行出处、损坏 docx warning 跳过）、培训类声明行与建议稿抬头、无 emoji、TYPE_PATTERNS 与 operator-anomaly-guide 同源、SKILL/training-rules 文档同步、make-sample SAP 样例可再生、数值题干遮蔽区间两端与比较词后的数（P 组，2026-11-04）、连字符区间两端与负数连同负号遮蔽、位号不遮、「反应器」归塔器容器、资料目录中的 PDF 与不支持格式逐个 warning 不静默丢弃、「数字-数字」编号尾段不遮（P12~P15）、`--ledger` 与 `--scope` 同时给时按 scope 过滤清单（I10~I18）。
