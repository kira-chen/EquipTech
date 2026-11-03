# examples 回归测试数据

> 本目录仅开发包含有，发布包不含。由 `node scripts/make-sample.js --out examples` 再生。
> 所有位号、厂家、型号、数值、SAP 设备编号均为虚构。

## 目录构成

```
examples/
├── sample-docs/                          # --docs 指向这里
│   ├── P-1101A常压塔顶回流泵使用说明书.docx   真实 docx，含参数表；力矩 45N·m
│   ├── P-1101A检修规程.md                    同一项力矩写 50N·m（构造版本冲突）
│   ├── P-1101A技术协议.txt                   水压试验压力、材质
│   ├── E-1201原油换热器使用说明书.md          其他设备资料（不得被拿来代答）
│   ├── P-1101A装配图.pdf                     伪 PDF，未转换 → 只定位，提示先用平台 pdf 技能转换
│   ├── P-1101A水压试验报告.pdf               伪 PDF 原件
│   ├── P-1101A水压试验报告.pdf.txt           模拟平台 pdf 技能转换产物 → 可检索，标注须核对原件
│   ├── P-1101A旧版说明书.doc                 伪 .doc，旧版格式 → 只定位，提示另存为 .docx
│   ├── P-1101A铭牌照片.png                   伪图片，无文字层
│   ├── 资料目录清单.xlsx                      含合计行 + 一条无实体文件的登记（性能曲线）
│   └── 资料目录补充.csv                       CSV 格式目录清单：登记 P-1101B 说明书（无实体文件）
├── sample-doc-catalog.xlsx               资料目录清单（单独一份，便于单看）
└── sample-equipment-ledger.xlsx          设备台账（SAP PM 技术对象清单列名：功能位置/设备/设备描述/型号编号/制造商），供 --ledger；
                                          P-1101A / P-1101B 同名「常压塔顶回流泵」、同型号（A/B 泵）
```

## 示例问题 ↔ 附件对照表

| # | 示例问题 | 运行参数 | 预期结果 |
|---|---|---|---|
| 1 | P-1101A 这台泵有哪些资料 | `--docs examples/sample-docs --tag P-1101A` | 8 份相关文件；装配图、水压试验报告 PDF 原件、旧版 .doc、铭牌照片标「否（未解析）」；水压试验报告 .pdf.txt 标「PDF 转换文本，须核对原件」；1 条 catalogOnly（性能曲线）；不抽原文 |
| 2 | 机械密封压盖螺栓上多大力矩 | `--docs examples/sample-docs --tag P-1101A --query "机械密封 安装力矩"` | 命中说明书 45N·m 与检修规程 50N·m，**两个取值全部列出**并提示核实版本 |
| 3 | 从装配图上看叶轮直径多少 | `--docs examples/sample-docs --tag P-1101A --query "叶轮直径"` | 装配图 PDF 未转换，只定位不读内容并提示用平台 pdf 技能转换；文字资料中未命中 → 明确回答未找到 |
| 4 | 水压试验报告里试验压力是多少 | `--docs examples/sample-docs --tag P-1101A --query "试验压力"` | 命中技术协议与 `.pdf.txt` 转换文本各 1 段；转换文本引用标注须核对原件；顶部【注意】提示 1 份转换文本 |
| 5 | 这台泵的汽蚀余量是多少 | `--docs examples/sample-docs --tag P-1101A --query "汽蚀余量 NPSH"` | 命中 0 段，md 写「所提供资料中未找到」+「未用通用知识补充」 |
| 6 | P-9999 的说明书在哪 | `--docs examples/sample-docs --tag P-9999 --query "说明书"` | 关联文件 0 份；E-1201 的说明书进「无法关联」单列，**不被拿来代答** |
| 7 | 只看这台泵的规程 | `--docs examples/sample-docs --tag P-1101A --doc-type 规程` | 只返回检修规程；说明书等注明「被 --doc-type 过滤」 |
| 8 | 用 SAP 台账帮忙关联 | `--docs examples/sample-docs --tag P-1101A --ledger examples/sample-equipment-ledger.xlsx --query "对中"` | `meta.ledgerInfo` 从「设备描述」「型号编号」带出设备名称与型号，`matchedBy` 为位号；名称、型号与 P-1101B 相同，记入 `droppedClues` 并出 warning，不作关联线索；用 `--tag <P-1101A 的 SAP 设备编号>` 也能命中并标「设备编号」，关联依据仍是「文件名含位号：P-1101A」，8 份相关文件不变，md 抬头写「编号（台账位号 P-1101A）」 |
| 9 | P-1101B 有哪些资料（A/B 泵同名） | `--docs examples/sample-docs --tag P-1101B --ledger examples/sample-equipment-ledger.xlsx` | 相关文件 0 份，**P-1101A 的说明书、技术协议、检修规程、试验报告一份都不带出**（修复前按同名「常压塔顶回流泵」带出 4 份）；`资料目录补充.csv` 登记的 P-1101B 说明书进 catalogOnly |

## 关键验证点

1. **PDF 前置转换**（本技能最关键）：案例 3 与 4。未转换的 `P-1101A装配图.pdf` 只定位、`contentSearchable: false`、`paragraphs: null`，**绝不出现在 `passages` 中**，warning 写明"请先用平台 pdf 技能转为 txt/docx"；已转换的 `P-1101A水压试验报告.pdf.txt` 可检索，`convertedFrom` 指向原 PDF，引用处标注"须核对原件"。若回答里出现"图纸上标注……"即为返工项。
2. **.doc 不解析**：`P-1101A旧版说明书.doc` 进 `unreadable`，原因提示另存为 .docx。
3. **命中为空不补知识**：案例 5。资料里没写汽蚀余量就是没写，不得答"一般 NPSHr 取 3~4m"。
4. **不拿别的设备顶上**：案例 6。`E-1201原油换热器使用说明书.md` 里有「法兰螺栓紧固力矩 220N·m」，查 P-9999 或查 P-1101A 时都不得把它当作答案。
5. **版本冲突全列**：案例 2。45N·m（说明书 A/0）与 50N·m（检修规程 B/1）必须都出现，不得择一，且要提示核实受控版本。
6. **引用带出处**：每条 `passages` 都有 `file` 与 `location`（第 N 段），md 里写成「出处：文件名　第 N 段　版本 X」。
7. **目录登记无实体文件单列**：`P-1101A性能曲线.pdf` 在清单里但目录下没有，进 `catalogOnly`；已提供转换文本的水压试验报告不再计入。
8. **合计行跳过**：资料目录清单末行「合计」被跳过并出 warning。
9. **SAP 台账列名**：案例 8。「功能位置」为位号、「设备」为设备编号单列、「设备描述」为设备名称、「型号编号」为规格型号，工作表名「技术对象清单」可识别。
10. **A/B 泵不串台**：案例 9。台账名称、型号在台账中不唯一时不作关联线索；用设备编号查时改用台账位号关联。
11. **CSV 目录清单**：`资料目录补充.csv` 按 CSV 读取（不再当 xlsx 打开失败），`counts.catalogFiles` 为 2。

## 再生样例

```bash
node scripts/make-sample.js --out examples            # seed=1
node scripts/make-sample.js --out examples --seed 7   # 厂家、型号与 SAP 设备编号变化，文件构成与上述预期结论不变
```
