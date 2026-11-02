# examples 回归测试数据

> 本目录仅开发包含有，发布包不含。由 `node scripts/make-sample.js --out examples` 再生。

## 示例问题 ↔ 附件对照表

| # | 示例问题 | 附件 | 运行参数 | 预期结果 |
|---|---|---|---|---|
| 1 | P-1101A 是什么型号，用了多久，修过几次 | `sample-equipment-ledger.xlsx` + `sample-maintenance-history.xlsx` | `--query "P-1101A" --history <历史>` | 单台详情（位号与设备编号分别展示，按位号命中）+ 4 条检修历史（倒序，含工单号）+ 投用年限约 14.4 年并注明基准 |
| 2 | 动设备里哪些是 2015 年以前投用的，按投用时间排 | `sample-equipment-ledger.xlsx` | `--query '{"type":"filter","where":[["专业","eq","动设备"],["投用日期","lt","2015-01-01"]],"orderBy":{"field":"投用日期","dir":"asc"}}'` | 3 台，P-1101A/B 在前 |
| 3 | 台账里各专业各有多少台 | `sample-equipment-ledger.xlsx` | `--query '{"type":"stats","groupBy":"专业"}'` | 动设备 5、静设备 4、电气 2、仪表 1，含占比 |
| 4 | 设计压力大于 1.0 的有哪些 | `sample-equipment-ledger.xlsx` | `--query '{"type":"filter","where":[["设计压力","gt","1.0"]]}'` | **报错终止**，列出台账实际字段并提示 `--describe`，不返回全部数据 |
| 5 | 这是 SAP 导出的技术对象清单，设备编号 10007947 是哪台，投用多久了 | `sample-sap-pm-ledger.xlsx` | `--query "<该台设备编号>"`（看 make-sample 产出） | 按设备编号命中 1000-CDU-V1301 原油缓冲罐；只有建造年份 2012 无开始日期，**投用年限不推算**并 warning |
| 6 | SAP 清单按 ABC 标识各有几台 | `sample-sap-pm-ledger.xlsx` | `--query '{"type":"stats","groupBy":"重要度"}'` | A 类 2、B 类 4 |
| 7 | 这个台账先告诉我有哪些列 | `sample-sap-pm-ledger.xlsx` | `--describe` | 列名、已填/空行数、样例值；投用日期 5 填 1 空 |
| 8 | 这是 EM 导出的台账，列名跟标准不一样，能查吗 | `sample-alias-ledger.xlsx` | `--query "P-2101"` | 可查；设备位号/EM编码分列，标题行与合计行正确处理 |

## 关键验证点

1. **字段不存在必须报错**：案例 4 是本技能最关键的行为。若静默跳过条件返回全部 12 台，用户会误以为这 12 台都满足「设计压力 > 1.0」。
2. **位号与设备编号分列**：SAP「功能位置」是位号，「设备」是 8 位流水号；两者都能命中但分别展示并写明命中依据。
3. **空值不留白**：P-1103 的规格型号为空，显示「—（台账未填）」而非空白或「无」。
4. **派生值注明基准**：投用年限随当前日期变化，必须写明按哪一天计算；只有建造年份的设备不推算。
5. **无历史不编造**：P-1103 在检修历史表中没有记录，返回空列表，不虚构检修履历。
6. **查不到不放宽**：查 P-9999 时明确回答未查到，并声明未返回近似结果。
7. **备件不在本技能**：`--spare` 传入即报错并指向 spare-parts-inventory-query。

## 再生样例

```bash
node scripts/make-sample.js --out examples            # seed=1
node scripts/make-sample.js --out examples --seed 5   # 厂家、型号与设备编号变化，台数、专业分布与预期结论不变
```
