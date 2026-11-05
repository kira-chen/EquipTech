#!/usr/bin/env bash
# 单个设备员技能打包。日常请用 tools/package.sh，它会先跑自测并校验 zip。
# 用法：tools/build.sh <技能目录> [--install-workbuddy] [--with-examples]
#   默认            → dist/设备员-发布包/<name>.zip  只含运行所需文件
#   --with-examples → dist/设备员-开发包/<name>-dev.zip  全部文件，演示case/ 下的样例放入包内 examples/，仅内部使用
#   --install-workbuddy 同时把打出的包解压安装到 ~/.workbuddy/skills/
set -euo pipefail
SKILL_DIR="${1:?用法: tools/build.sh <技能目录> [--install-workbuddy] [--with-examples]}"
SKILL_DIR="${SKILL_DIR%/}"
NAME="$(basename "$SKILL_DIR")"
shift || true
INSTALL=0; DEV=0
for a in "$@"; do case "$a" in --install-workbuddy) INSTALL=1;; --with-examples) DEV=1;; *) echo "未知参数 $a"; exit 1;; esac; done
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [ "$DEV" = 1 ]; then DIST="$ROOT/dist/设备员-开发包"; ZIP="$DIST/$NAME-dev.zip"; else DIST="$ROOT/dist/设备员-发布包"; ZIP="$DIST/$NAME.zip"; fi
mkdir -p "$DIST"
[ -f "$SKILL_DIR/SKILL.md" ] || { echo "缺少 $SKILL_DIR/SKILL.md"; exit 1; }
grep -q '^name:' "$SKILL_DIR/SKILL.md" && grep -q '^description:' "$SKILL_DIR/SKILL.md" || { echo "SKILL.md frontmatter 缺少 name/description"; exit 1; }
find "$SKILL_DIR" -name '.DS_Store' -delete
EXCL=('*/node_modules/*' '*/.git/*' '*/.DS_Store' '*-out/*' '*/*-out/*')   # *-out/ 为脚本默认运行产物目录，不打包
if [ "$DEV" = 0 ]; then
  # 发布包排除开发与上架用文件：回归样例、上架文案、样例生成与自测脚本
  EXCL+=("$NAME/examples/*" "$NAME/上架信息.md" "$NAME/样例问题.md" "$NAME/演示附件/*" \
         "$NAME/scripts/make-sample.js" "$NAME/scripts/make-demo.js" "$NAME/scripts/selftest.js")
fi
rm -f "$ZIP"
SRC_PARENT="$(dirname "$SKILL_DIR")"
CASE_DIR="$ROOT/演示case/$(basename "$SRC_PARENT")/$NAME"   # 演示样例在技能目录外，开发包里放回 <name>/examples/
if [ "$DEV" = 1 ] && [ -d "$CASE_DIR" ]; then
  STAGE="$(mktemp -d -t equip-build)"; trap 'rm -rf "$STAGE"' EXIT
  cp -R "$SKILL_DIR" "$STAGE/$NAME" && cp -R "$CASE_DIR" "$STAGE/$NAME/examples"
  SRC_PARENT="$STAGE"
fi
( cd "$SRC_PARENT" && zip -rq "$ZIP" "$NAME" -x "${EXCL[@]}" )
echo "已生成: $ZIP"
if [ "$INSTALL" = 1 ]; then
  mkdir -p ~/.workbuddy/skills && rm -rf ~/.workbuddy/skills/"$NAME" && unzip -q "$ZIP" -d ~/.workbuddy/skills/
  echo "已安装到 ~/.workbuddy/skills/$NAME"
fi
