# scripts 使用说明

## supervise.js —— 主脚本

```bash
node "<技能目录>/scripts/supervise.js" \
  --work-type "<作业类型,类型>" \
  --scope "<作业内容>" \
  --location "<位号或区域>" \
  --medium "<介质>" --duration <小时> --headcount <人数> \
  --env "<环境条件>" --unit "<作业单位>" --level "<作业票级别>" \
  --out "<输出目录>"
```

### 参数

| 参数 | 必需 | 说明 |
|---|---|---|
| `--work-type` | 是 | 作业类型（八大类：用火/受限空间/高处/吊装/临时用电/动土/断路/盲板抽堵，或常规检修），多类型用逗号/顿号/斜杠/加号分隔；"动火"可识别为用火；不在覆盖范围的原样列入 `unknownTypes` |
| `--scope` | 是 | 作业内容 |
| `--location` | 是 | 位号或区域 |
| `--medium` | 否 | 介质；**为空或不在危险特性库时按最严口径 + warning** |
| `--duration` | 否 | 预计时长（小时，正数）；用于推算巡查轮次，**缺失时轮次为 null 不按 0** |
| `--headcount` | 否 | 作业人数（正整数） |
| `--env` | 否 | 环境条件（高温/密闭/带压/邻近运行设备/夜间/露天） |
| `--unit` | 否 | 作业单位 |
| `--start` / `--end` | 否 | ISO 8601 带时区，如 `2026-09-21T09:00:00+08:00`；非法报错 |
| `--level` | 否 | 作业票级别（以票面为准，脚本不自判）：特级/一级/二级用火、高处一~四级、吊装一~三级；只写「一级」时按识别出的作业类型推断。只用于映射检查频次口径（只加严不降级）；无法识别或与识别类型不符 → warning，仅记录不生效 |
| `--permit` | 否 | 作业票路径或票号；**只校验存在性，不解析票内容**，不存在时 warning 不中断 |
| `--out` | 否 | 输出目录，默认系统临时目录 `<os.tmpdir()>/supervision-out`；**建议始终传 `--out`** |

### 产出

| 文件 | 内容 |
|---|---|
| `supervision.json` | `meta`（含 `permitLevel`）、`counts`、`risk`（频次口径与判定依据）、`points`、`frequency`（含 `levelNote`、`source`）、`keyMoments`、`escalated`、`checkSheet`、`warnings` |
| `supervision.md` | 八节报告：作业信息（含作业票级别）/ 监督要点清单（按检查时点分组）/ 检查频次建议（含级别口径与「默认口径、厂内为准」提示）/ 关键时点提示 / 组合加严项 / 现场检查记录表（空白）/ 异常处置提示 / 现场情况说明（分析段占位）；不含 emoji |
| `summary.json` | 末行摘要落盘 |

`supervision.json` 关键字段：

```jsonc
{
  "meta": { "types": ["hotwork","confined"], "unknownTypes": [], "genericOnly": false,
            "mediumKnown": false, "hazards": ["flammable","toxic"], "disclaimer": "..." },
  "counts": { "points": 42, "byMoment": {...}, "byType": {...}, "byMethod": {...}, "escalated": 3 },
  "risk": { "level": "high", "levelCn": "高风险", "reasons": [...] },
  "points": [ { "seq":1, "id":"H01", "momentCn":"作业前", "text":"...",
                "typeCn":"用火作业", "methodCn":"查证件", "owner":"设备员/监护人" } ],
  "frequency": { "intervalMin": 30, "patrol": "...", "standby": "...",
                 "gasTest": "...", "record": "...", "levelNote": "一级用火：...", "source": "检查频次为本技能默认口径...", "estimatedRounds": 12 },
  "keyMoments": [ {"momentCn":"作业前","note":"..."}, ... ],
  "escalated": [ {"id":"X-HC-1","item":"气体分析频次","conflict":"...","action":"..."} ],
  "checkSheet": { "headers": [...], "rows": [...] }   // 后三列一律为空字符串
}
```

### 退出码
- `0`：成功，末行 `{"ok":true,...}`
- `1`：失败，末行 `{"ok":false,"error":"...","warnings":[...]}`

### 硬约束（脚本已实现，模型不得绕过）
1. 作业类型不在覆盖范围 → 只输出 10 项通用监督框架 + warning，标注「待安全专业补充」，**不凭通用安全知识补具体要点**
2. 多类型组合 → 合并各类型要点并标注来源类型，冲突或加严项在 `escalated` 中单列
3. 检查记录表的检查时间/检查结果/检查人签字三列一律留空，**不预填**
4. 介质不在危险特性库 → 按最严口径（易燃易爆 + 有毒有害）+ warning
5. md 中保留声明行「本要点为辅助提示，不替代作业票规定的安全措施与监护人现场职责；发现异常应立即停止作业并按应急程序处置」
6. 不输出超出厂内制度与作业票规定的安全措施
7. 作业票级别由 `--level` 传入，**脚本不自判级别**；级别只映射检查频次口径；频次表为默认口径（非厂内正式口径），md 与 json 均标注来源
8. 术语按《中国石化作业许可管理规定》八大类（用火作业）；识别出任一特殊作业即纳入 S 系列许可通用要点（双监护 S01/S04/S05、JSA 交底 S02、属地确认人 S03），常规检修单独作业与通用框架不纳入

## lib/rules.js —— 监督要点规则引擎

可单独 require 做单元测试：

```js
const R = require('./lib/rules');
R.classifyTypes('用火作业,受限空间作业');   // {types:['hotwork','confined'], unknown:[]}
R.classifyTypes('放射性探伤作业');          // {types:[], unknown:['放射性探伤作业']}
R.mediumHazard('XK-7 特种助剂');            // {hazards:[], known:false} → 调用方按最严口径
R.pointsFor(['hotwork']);                    // 23 条（18 H + 5 S），按检查时点排序，带 seq/id/method/owner
R.parseLevel('一级用火');                     // {type:'hotwork', grade:'一级', risk:'high', cn:'一级用火'}
R.parseLevel('二级', ['height']);             // 只写级别时按识别类型推断 → 高处作业二级
R.escalationsFor(['hotwork','confined']);    // 3 条加严规则
R.riskLevel({types:['hotwork'], hazards:['flammable'], mediumKnown:true, comboCount:1});
```

口径见 `references/supervision-rules.md`。

## make-sample.js —— 样例生成

```bash
node scripts/make-sample.js --out examples [--seed <n>] [--date <YYYY-MM-DD>]
```

产出 `sample-scenarios.json`（5 个可直接运行的场景参数，场景 1 带 `--level 一级用火`）与 `sample-work-plan.xlsx`（作业许可系统导出列名风格的台账：许可证编号/作业类别/作业级别/作业地点/属地监护人/作业单位监护人/属地确认人，**供人工对照抄参数，脚本不读取**）。
seed 只改变作业单位、监护人、位号尾号，**不改变任一场景的结论**。

## selftest.js —— 自测

```bash
node scripts/selftest.js
```

203 条断言：类型识别 18、要点表完整性 32、未覆盖类型只给通用框架 15、多类型组合 16、介质危险特性 14、频次与关键时点 10、检查记录表留空 6、声明行与边界 6、产出完整性 8、参数校验 15、时间与显示 5、中石化口径 47（用火术语、S 系列双监护/JSA/属地确认人的纳入与不纳入、`--level` 解析与映射、级别无法识别/不符仅记录、未提供级别按默认口径、频次口径来源标注、无 emoji、互指），其余为规则引擎细项。
