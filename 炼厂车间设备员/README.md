# 炼厂车间设备员技能包

面向中石化体系炼化厂车间设备员的 50 个技能，分 8 类，适配 WorkBuddy 和豆包办公。

## 目录

```
炼厂车间设备员/
├── 设备员skill/   # 8 个分类下的 50 个技能
├── 演示case/      # 各技能的演示与回归样例，按 分类/技能英文名 存放
├── 文档/
│   ├── 规范/      # 中石化口径对照、技能实现规范，长期维护
│   └── 过程记录/  # 2026-11-03 及以前的核验报告、任务书，只作留档；之后的放仓库根目录 ProjectManage/
├── 素材/
│   ├── 图标/      # 技能图标：A-扁平、C-块面、D-拟物三套，每套按分类存放
│   └── 脚本/      # 图标生成脚本，运行 node 炼厂车间设备员/素材/脚本/make-icons.js
├── tools/         # 打包脚本
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
node 炼厂车间设备员/tools/selftest.js --level BVT          # 只跑自测，按级别并行运行
```

自测用例分为 BVT、A、B、C 四级，定级方法和运行方式见[自测用例分级规范](文档/规范/自测用例分级规范.md)。

## 已并入的旧技能

`work-permit-precheck`（特殊作业票预检）和 `overhaul-safety-check`（检修方案安全措施核查）已分别并入 `permit-precheck-bridge`、`overhaul-process-check-bridge`，规则引擎、规则库和抽取手册都在这两个技能里，不再依赖外部技能。平台上装过这两个旧技能的，上架新包前先卸载；技能清单的「上架说明」列会写明。
