# 现场作业监督要点（site-supervision-points）· 演示与回归样例

> 命令在技能目录 `设备员skill/03-承包商与作业现场管理/site-supervision-points/` 下运行，`$CASE` 指本技能的演示目录：`CASE=../../../演示case/03-承包商与作业现场管理/site-supervision-points`。

> 本目录仅开发包含有，发布包不含。由 `node scripts/make-sample.js` 再生。
> 本技能入参来自命令行而非附件，因此样例是**场景参数表**：`sample-scenarios.json` 给出可直接运行的参数；
> `sample-work-plan.xlsx` 是作业许可（电子作业票）系统导出列名风格的台账（许可证编号 / 作业类别 / 作业级别 / 作业地点 / 属地监护人 / 作业单位监护人 / 属地确认人），
> **供人工对照抄参数，脚本不读取、不消费它**——把「作业类别」抄到 `--work-type`、「作业级别」抄到 `--level`、「作业地点」抄到 `--location` 即可。
> 样例中作业单位、人名、位号均为虚构。

## 示例问题 ↔ 场景对照表

| # | 示例问题 | 运行参数（摘自 `sample-scenarios.json`） | 预期结果 |
|---|---|---|---|
| 1 | E-1201 补焊，票上定的一级用火，现场要盯哪些？ | `--work-type "用火作业" --level "一级用火" --scope "换热器封头法兰焊缝补焊" --location "E-1201（常压一区）" --medium 石脑油 --duration 4 --headcount 3` | 23 项要点（18 项「用火作业」+ 5 项「作业许可通用」S01~S05：双监护、JSA 交底、属地确认人）；作业票级别一级用火 → 高风险口径，级别口径提示「用火全过程旁站」；每 30 分钟巡查，约 8 轮；无组合加严项 |
| 2 | 进罐补焊，用火加进罐两张票，监督要点合一起给我 | `--work-type "动火作业,受限空间作业" --scope "缓冲罐内部腐蚀部位补焊" --location "V-1301（常压一区）" --medium 硫化氢 --duration 6 --headcount 5` | 42 项（用火 18 + 受限空间 19 + S 系列 5，只算一份），每条标来源类型；3 项加严（X-HC-1/2/3）；高风险；未传 `--level` → 判定依据注明「频次按作业类型默认口径」 |
| 3 | 今晚拍片子探伤，出个检查表 | `--work-type "放射性探伤作业" --scope "管线焊口射线探伤" --location "管廊三层（常压二区）" --medium 柴油 --duration 3` | `generic=true`，只出 10 项通用监督框架，不纳入 S 系列；2 条 warning 标注「待安全专业补充」 |
| 4 | 进料管线加盲板，介质是我们自己的助剂 | `--work-type "盲板抽堵作业" --scope "进料管线加装盲板" --location "P-2103A 出口管线" --medium "XK-7 特种助剂" --duration 2 --headcount 2` | 18 项要点（13 B + 5 S）；盲板抽堵不分级，判定依据注明「不分级」；`mediumKnown=false`，按最严口径（易燃易爆+有毒有害）；warning 提示核实 MSDS；高风险 |
| 5 | 循环水泵抽芯，日常维修怎么盯 | `--work-type "常规检修作业" --scope "循环水泵抽芯检修、更换机封" --location "P-3101B（循环水站）" --medium 循环水 --duration 8 --headcount 4` | 14 项要点；常规检修单独作业不纳入 S 系列；低危介质不上调，判为低风险；每 2 小时巡查，约 4 轮 |

## MCP 取数对照

平台接入作业票系统 MCP 时不上传附件：`get_permits`（`workshop`：常减压车间，按需加 `tag`）读出那张票，按 SKILL.md「数据获取（MCP）」把各列填成命令行参数（开始/结束时间改写为 `YYYY-MM-DDTHH:mm:00+08:00`，级别为空不传 `--level`）；用火、受限空间、高处、吊装、盲板抽堵票再用 `get_permit_document` 下载 docx 作 `--permit`。演示数据每天按剧本重置，下表只写每天稳定的结论。

| # | 示例问题 | MCP 调用 | 运行参数 | 预期结果 |
|---|---|---|---|---|
| M1 | 今天 E-1201 那张一级用火票，现场要盯哪些？多久看一次？ | 作业票系统 `get_permits`（`workshop`：常减压车间，`tag`：E-1201）取用火作业行；`get_permit_document`（`permit_no`：该票编号） | `--work-type 用火作业 --level 一级 --scope "E-1201 头盖法兰密封面焊缝补焊" --location "E-1201（1#常减压装置常压蒸馏区）" --medium 柴油 --start/--end <票面时间+08:00> --duration <差值> --headcount 3 --unit 示例检维修公司 --permit <docx>` | `permitLevel` 一级用火；23 项（用火 18 + S 系列 5）；高风险，每 30 分钟巡查；级别口径「一级用火：用火全过程旁站」；无组合加严项；无 warning |
| M2 | E-1201 管束今天下午抽芯吊装，票上三级，属地要确认什么？ | 同上，取吊装作业行 | `--work-type 吊装作业 --level 三级 --medium 柴油 --headcount 5 --unit 示例吊装公司 …`（其余同 M1 取法） | `permitLevel` 吊装作业三级；22 项（吊装 17 + S 系列 5）；吊装基础高风险不因三级降级，仍为高风险；级别口径「吊装三级：起吊与落钩到场确认」 |
| M3 | V-1301 进罐清理的受限空间票（昨天开、今天上午结束），出监督要点 | 作业票系统 `get_permits`（`workshop`：常减压车间，`tag`：V-1301）；`get_permit_document` | `--work-type 受限空间作业 --medium 含油污水 --start <昨天 09:00+08:00> --end <今天 11:00+08:00> …`，不传 `--level` | 24 项（受限空间 19 + S 系列 5）；判定依据写「受限空间作业不分级」；介质「含油污水」不在危险特性库 → 按最严口径（易燃易爆、有毒有害）+ warning 核实 MSDS；高风险；作业起止跨两天照常显示 |

## 关键验证点

1. **未覆盖类型不凭通用知识补要点**：场景 3 的放射性探伤不在覆盖范围，脚本只输出 X01～X10 十条程序性通用框架，
   且这 10 条与任何具体作业类型的要点文本都不重合；warning 与 md 均标注「待安全专业补充」。
   **模型交付时不得为它补充射线防护之类的具体措施。**
2. **组合不丢要点、加严单列、S 系列只算一份**：场景 2 的 42 项 = 18 + 19 + 5，一条不少，每条标注来源类型；
   用火与受限空间在分析频次、监护配置、复工复检三处口径不一致，全部进入 `escalated` 单列，不混在要点表里。
3. **介质不在库按最严不按无危险**：场景 4 的「XK-7 特种助剂」不在危险特性库，`hazards` 输出 `["flammable","toxic"]`
   并给 warning，风险等级因此上调，**不按低危或无危险处理**。
4. **检查记录表留空**：所有场景的 `checkSheet.rows` 后三列（检查时间、检查结果、检查人签字）均为空字符串，
   md 中也是空格，**脚本不预填「合格」「已确认」等任何结果**。
5. **缺数据不按 0**：不传 `--duration` 时 `estimatedRounds` 为 `null`，md 显示「—（未提供预计时长）」；
   不传 `--unit`/`--headcount` 时 md 显示「—」。
6. **声明行不可缺**：每份 `supervision.md` 开头与结尾各有一处完整声明行，`supervision.json` 的 `meta.disclaimer` 保存原文。
7. **要点可追溯**：每条要点带规则号（S/H/C/W/L/E/G/R/B/D/X 系列），可对照 `references/supervision-rules.md` 复核。
8. **作业票级别只认票面、只能加严**：场景 1 传 `--level 一级用火`，判定依据写「级别以作业票为准，脚本不自判」；
   传「二级用火」时用火作业基础高风险不降级；传「高处四级」时高处作业从中风险抬到高风险；级别无法识别或与识别类型不符只 warning、仅记录。
9. **频次为默认口径**：md 第三节与 json `frequency.source` 均标注「检查频次为本技能默认口径（非厂内正式口径），厂内有规定以厂内为准」。
10. **术语**：产出用「用火作业」（八大类命名），输入写「动火」也能识别；md 不出现「动火作业票」。

## 再生样例

```bash
node scripts/make-sample.js            # seed=1
node scripts/make-sample.js --seed 9   # 作业单位、监护人、位号尾号变化，五个场景的结论不变
```

## 批量跑通五个场景

```bash
node -e "
const {execFileSync}=require('child_process');
const sc=JSON.parse(require('fs').readFileSync('$CASE/sample-scenarios.json','utf8'));
sc.scenarios.forEach((s,i)=>{
  const args=[];for(const[k,v]of Object.entries(s.args)) args.push(k,v);
  args.push('--out','/tmp/sv'+i);
  const j=JSON.parse(execFileSync('node',['scripts/supervise.js',...args],{encoding:'utf8'}).trim().split('\n').pop());
  console.log(i+1, s.name, j.counts.points, j.counts.escalated, j.risk.levelCn, j.permitLevel);
});
"
```
