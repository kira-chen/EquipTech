# GitHub 协同规范

仓库地址：<https://github.com/kira-chen/EquipTech>。所有成员和 AI 助手都要遵守。

核心规则：

- **远端只保留 `main` 一个分支。**
- **任何人提交的版本，都按“冲突检测 → 冲突处理 → 合并到 main”进入 `main`。**
- **`main` 始终可用，不强制推送。**

## 一、首次配置

需要 Git 2.38 或更高版本，冲突检测命令依赖它。

```bash
git clone git@github.com:kira-chen/EquipTech.git
cd EquipTech
git config core.quotepath false      # 让中文文件名正常显示
git config pull.ff only              # 防止 pull 时产生意外合并
```

`skill-pack-local/` 和 `炼厂车间设备员/dist/` 不入库，需要时在本地生成或单独获取。

## 二、日常节奏

| 时机 | 要做的事 |
|---|---|
| 开工前 | 拉取最新的 `main`，开本地工作分支 |
| 工作中 | 小步提交，一次提交只做一件事 |
| 一件事完成 | 立即走第三节的合并流程，不积压 |
| 每天收工前 | 已完成的工作合并到 `main`。未完成的工作留在本地分支，不推送到远端 |
| 合并完成后 | 删除本地工作分支 |

工作分支只存在于本地，尽量当天合并，最长不超过 2 天。工作太大时拆成几次提交，分别合并。

```bash
git switch main
git pull
git switch -c work/leak-point-tracker-rate     # 本地分支，不推送
# 修改后
git status
git add <具体文件>
git commit -m "fix(leak-point-tracker): 修正静密封点泄漏率分母"
```

**提交信息：** `<类型>(<技能或范围>): <做了什么>`。类型用 `feat`（新增）、`fix`（修复）、`docs`（文档）、`refactor`（调整结构或共享库）、`chore`（工具和配置）。

## 三、合并流程

每次合并都按这 5 步执行，在本地工作分支上开始。

**第 1 步：冲突检测。** 这条命令不改动工作区。

```bash
git fetch --prune origin
git merge-tree --write-tree --name-only HEAD origin/main
```

退出码为 0 表示没有冲突。退出码为 1 表示有冲突，输出里会列出冲突文件。

**第 2 步：冲突处理。** 合并最新的 `main`，有冲突时按第六节解决。

```bash
git merge origin/main
git status                    # 查看冲突文件
# 解决冲突后
git add <已解决的文件>
git commit
```

**第 3 步：验证。** 按第四节跑验证，不通过不能继续。

**第 4 步：合并到 main 并推送。**

```bash
git switch main
git pull
git merge --ff-only <工作分支>
git push origin main
```

`--ff-only` 失败或推送被拒绝，说明这期间有人更新了 `main`。回到工作分支，从第 1 步重新开始，不要强制推送。

**第 5 步：清理。**

```bash
git branch -d <工作分支>
```

### 处理他人提交的版本

检查远端是否有 `main` 以外的分支：

```bash
git fetch --prune origin
git ls-remote --heads origin
```

发现其他分支时，按同样的流程处理：

1. 用 `git switch -c work/<分支名> origin/<分支名>` 取到本地。
2. 执行第 1 到第 4 步，把它合并到 `main`。
3. 确认已合并后，删除远端分支：

```bash
git fetch --prune origin
git branch -r --merged origin/main      # 确认该分支在列表中
git push origin --delete <分支名>
git branch -d work/<分支名>
```

没有完成、自测不通过或无法判断取舍的版本，先联系提交人，不要合并，也不要删除它的远端分支。

## 四、合并前验证

| 改动范围 | 要跑的验证 |
|---|---|
| 单个技能 | `bash 炼厂车间设备员/tools/package.sh --skill <英文名>` |
| 共享库、打包工具、多个技能 | `bash 炼厂车间设备员/tools/package.sh` |
| 第 2 步解决过冲突 | 涉及的每个技能都要验证，涉及共享库时跑全量 |
| 所有改动 | [目录与文件管理规范](目录与文件管理规范.md)第七节的提交前检查 |

打包产物在 `dist/`，不提交。自测失败的改动不能合并。

## 五、容易冲突的地方

动这些文件前先在协同群里说一声，尤其是前 4 项。

| 位置 | 为什么容易出问题 | 怎么处理 |
|---|---|---|
| `scripts/lib/` 的共享库 | 同一文件有多份副本，一次改动就可能涉及 50 个文件 | 同一时间只有一人修改。发生冲突时，以最新 `main` 为基础重新应用改动，再同步全部副本，不要逐个文件解决 |
| `文档/规范/中石化口径对照.md` | 所有技能的统一口径，表面无冲突也可能口径矛盾 | 由负责人确认。合并后检查受影响的技能 |
| `设备员skill/README.md` 和分类 `README.md` | 技能数、断言数容易被多人同时改 | 不要把两边数字相加。合并后按实际结果重新统计 |
| `tools/`、`.claude/skills/package-skills/` | 影响所有人的打包结果 | 单独提交，合并前跑全量打包 |
| 同一技能的 `SKILL.md` | description 决定技能何时被触发，合并后可能与其它技能抢触发词 | 合并时保留两边的有效内容，并核对同类技能的触发词 |
| `上架信息.md` | 技能清单从这里解析，格式错了全量打包会报错 | 保持字段格式和 5 个示例问题，合并后跑打包 |
| 主脚本的输出 JSON | 文本上没有冲突，下游技能也可能读不到字段 | 在提交信息里写明字段变更，并验证下游技能 |
| `演示case/` 的 xlsx、docx | 二进制文件，Git 无法合并 | 见第六节，不要手工修补文件 |
| 目录移动和改名 | 影响所有人的本地工作和桥接技能的依赖路径 | 提前通知，等其他人的工作合并后进行，用 `git mv` |
| `.claude/settings.json`、`.gitignore` | 影响所有成员的权限和入库范围 | 由负责人确认 |

## 六、解决冲突

- **文本文件：** 理解两边改动的目的后再合并，保留两边的有效改动。只选自己一边可能丢掉别人的修改。
- **拿不准时：** 先问改动人，不要猜。需要放弃这次合并时，运行 `git merge --abort`。
- **二进制样例：** 保留改动了样例逻辑的一方，或者运行该技能的 `make-sample.js` 重新生成：

  ```bash
  git checkout --theirs <样例文件>      # 保留 main 的版本
  git checkout --ours <样例文件>        # 保留工作分支的版本
  node <技能目录>/scripts/make-sample.js   # 默认写入 演示case/<分类>/<技能>/
  ```

  `make-sample.js` 重新生成的文件内容逻辑一致，但不会和旧文件字节相同，所以不能靠比对文件判断是否一致。处理后要跑该技能的自测。

## 七、禁止操作

- 不要把工作分支推送到远端，也不要在远端保留 `main` 以外的分支。
- 不要跳过冲突检测和验证，直接推送 `main`。
- 不要使用 `git push --force`、`--force-with-lease`，也不要 rebase 或 `reset --hard` 已推送的内容后强推。
- 不要提交 `dist/`、`skill-pack-local/`、临时文件、真实业务数据和密钥。
- 不要用 `--no-verify` 跳过检查，也不要为了通过验证修改自测。
- 不要在未看清改动时使用 `git add .`。

密钥或真实数据误提交后，立即告知负责人。删除文件后它们仍在提交历史中，令牌要立即作废，历史清理由负责人决定。

## 八、AI 助手

- 只在用户要求时提交和推送。用户要求推送时，默认按第三节完成全部 5 步。
- 不在 `main` 上直接改动。开工前确认当前分支，并检查远端是否有其他分支。
- 遇到冲突时说明冲突内容和处理建议，影响业务口径的取舍交给用户决定。
