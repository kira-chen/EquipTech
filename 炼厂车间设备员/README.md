# 炼厂车间设备员技能包

面向中石化体系炼化厂车间设备员的 50 个技能，分 8 类，适配 WorkBuddy 和豆包办公。

## 目录

```
炼厂车间设备员/
├── 设备员skill/   # 8 个分类下的 50 个技能
├── 演示case/      # 各技能的演示与回归样例，按 分类/技能英文名 存放
├── 文档/
│   ├── 规范/      # 中石化口径对照、技能实现规范，长期维护
│   └── 过程记录/  # 核验报告、改造任务书，只作留档
├── 素材/图标/     # 按分类存放的技能图标
├── tools/         # 打包与图标脚本
└── dist/          # 打包产物，不入库
```

## 从哪里开始

- **了解技能：** 看[技能总览](设备员skill/README.md)。示例问题用到的附件在[演示case](演示case/README.md)。
- **开发或修改技能：** 先读[技能实现规范](文档/规范/技能实现规范.md)。术语、分级和系统列名以[中石化口径对照](文档/规范/中石化口径对照.md)为准。
- **参与协同：** 先读[目录与文件管理规范](文档/规范/目录与文件管理规范.md)和 [GitHub 协同规范](文档/规范/GitHub协同规范.md)。
- **打包：** 在 Claude Code 里运行 `/package-skills`，或说“打包设备员技能”。zip 和技能清单生成在 `dist/设备员-发布包/`，都不提交到仓库。

也可以直接在仓库根目录运行脚本，需要 node、zip 和 unzip：

```bash
bash 炼厂车间设备员/tools/package.sh                       # 全部发布包和技能清单
bash 炼厂车间设备员/tools/package.sh --skill leak-point-tracker   # 单个技能
bash 炼厂车间设备员/tools/package.sh --with-examples       # 开发包
```

## 外部依赖

`permit-precheck-bridge` 依赖 `work-permit-precheck`，`overhaul-process-check-bridge` 依赖 `overhaul-safety-check`。这两个技能不在本仓库内，部署时需要另外安装，与 bridge 并排装在同一个技能目录下即可；装在别处时用环境变量 `SKILL_PACK_ROOT` 指向它们所在的目录。
