# scripts 使用说明

## retrieve.js —— 主脚本

```bash
node "<技能目录>/scripts/retrieve.js" \
  --cases "<案例库路径>" \
  --symptom "<当前故障现象描述>" \
  --equip-type "<设备类型>" \
  --out "<输出目录>"
```

### 参数

| 参数 | 必需 | 说明 |
|---|---|---|
| `--cases` | 是 | 案例库：xlsx / 同结构 CSV 目录 / docx（Word 表格）/ md（管道表格），SAP PM 通知单导出（IW28 列名）可直接用。PDF 拒读（先用平台 pdf 技能转 txt/docx）。**缺失/不存在/无可检索案例一律 ok:false + exit 1，本技能不可用** |
| `--symptom` | 是 | 当前故障现象描述。去标点后不足 2 字报错，并提示补充关键特征 |
| `--equip-type` | 是 | 当前设备类型，如「离心泵」「往复压缩机」「换热器」「阀门」 |
| `--part` | 否 | 当前故障部位。不给则部位维度不参与计算，权重归一化重分配 |
| `--model` | 否 | 当前设备型号。不计入相似度，仅作匹配依据加注与同分排序 |
| `--fault-code` | 否 | SAP 损坏/原因代码。代码相同者排序优先、matchBasis 加注，不计入相似度；案例库无代码列时 warning |
| `--weights` | 否 | `text=0.55,type=0.30,part=0.15`（默认）。三项之和须为 1，text > 0，缺省项取默认；自定义时 warning 并在 md 标「（自定义）」 |
| `--top` | 否 | 返回条数上限，默认 5（正整数）。只截断呈现，不改变达标判定 |
| `--min-score` | 否 | 相似度下限，默认 0.3（0~1）。低于此值只进 `lowSimilarity` |
| `--out` | 否 | 输出目录，默认系统临时目录 `<os.tmpdir()>/fcr-out`，**建议始终传** |
| `--all-fields` | 否 | 保留标志位，当前不改变产出 |

### 产出

| 文件 | 内容 |
|---|---|
| `cases.json` | `meta`（案例库、工作表、格式、检索条件、生效权重 `weights`/`weightsCustom`、两行声明）、`counts`（含 `codeHits`）、`matches[]`、`lowSimilarity[]`、`warnings` |
| `cases.md` | 五节报告（检索概览 / 命中案例 / 低相似度案例 / 检索结果解读 / 使用说明）+ 有 warning 时「附：数据提示」（【注意】前缀，不用 emoji），解读段留 `<!-- ANALYSIS_START/END -->` 占位，两行声明原样写入 |
| `summary.json` | 末行摘要落盘（Windows 控制台乱码兜底） |

`matches[]` 与 `lowSimilarity[]` 每条均含 `matchBasis`（匹配依据）与 `differences`（不同点），交付时两者都不能省。

### 相似度口径

```
提供 --part：相似度 = 0.55 × 现象文本 bigram Dice + 0.30 × 设备类型匹配 + 0.15 × 故障部位匹配
未提供   ：相似度 = 0.647 × 现象文本 bigram Dice + 0.353 × 设备类型匹配
```

生效权重写入 `cases.json` 的 `meta.weights`；`--weights` 可改默认口径。`--fault-code` 代码相同只影响排序（在相似度下限分层之后），不改相似度数值。详见 `references/retrieval-rules.md`。

### 退出码
- `0`：成功，末行输出 `{"ok":true,...}`（**命中为空也是成功**，`counts.matches` 为 0）
- `1`：失败，末行输出 `{"ok":false,"error":"...","warnings":[...]}`；`error` 已写明"本技能不可用，不得用通用知识替代"

## make-sample.js —— 样例生成

```bash
node scripts/make-sample.js --out examples [--seed <n>]
```

生成 6 份样例：主案例库（16 条，泵 5 / 压缩机 3 / 大机组 3 / 换热器 3 / 阀门 2）、系统导出风格变体、SAP PM 通知单导出（IW28 列名）、Word 表格案例库（docx）、无现象描述变体、仅泵类变体。
seed 只改变数值细节（滴速、温度、振动值、发生日期），**不改变案例条数与检索结论**：主案例库检索机封滴漏恒为 4 命中 / 12 低分；仅泵类库检索往复压缩机恒为 0 命中；SAP 导出带 `--fault-code LEAK01` 恒为 2 命中 / 2 代码相同。

## selftest.js —— 自测

```bash
node scripts/selftest.js
```

166 条断言，覆盖：无案例库五种不可用情形、命中为空不补位、低相似度单列标注、匹配依据与不同点齐全、两行声明保留、权重归一化与 `--weights` 校验、SAP IW28 列名（位号/设备编号分列、描述归现象、损坏代码）、`--fault-code` 排序优先且不改相似度、docx/md 案例库与 PDF 拒读、大机组机型归一、缺列与跳过行、日期不可解析、参数校验、`--top` 截断、默认输出目录在 tmpdir、产出结构与术语。全绿退出 0。
