#!/usr/bin/env bash
# 设备员技能打包入口：自测 → 打包 → 校验 zip → 生成技能清单。产物在 dist/，不入库。
# 用法：tools/package.sh                     打全部发布包并生成技能清单
#       tools/package.sh --skill <英文名>     只打一个技能，可重复传
#       tools/package.sh --with-examples      打开发包，含自测脚本与 演示case/ 下的回归样例
#       tools/package.sh --test-level <级别>  自测只跑该级及更高优先级的用例（BVT/A/B/C），默认 C 全量
#       tools/package.sh --skip-test          跳过自测，只在刚跑过自测时使用
# 全量打发布包时，同时打两个 bridge 依赖的技能：设置环境变量 SKILL_PACK_ROOT 指向它们所在目录，未设置时打包照常完成但上架包不完整
set -uo pipefail
TOOLS="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$TOOLS")"
BASE="$ROOT/设备员skill"
ONLY=(); DEV=0; TEST=1; TLEVEL=C
while [ $# -gt 0 ]; do case "$1" in
  --skill) [ $# -ge 2 ] || { echo "--skill 缺少技能英文名"; exit 2; }; ONLY+=("$2"); shift 2;;
  --with-examples) DEV=1; shift;;
  --test-level) [ $# -ge 2 ] || { echo "--test-level 缺少级别"; exit 2; }; TLEVEL="$(printf %s "$2" | tr a-z A-Z)"; shift 2;;
  --skip-test) TEST=0; shift;;
  -h|--help) sed -n 2,8p "$0"; exit 0;;
  *) echo "未知参数 $1"; exit 2;;
esac; done
for c in node zip unzip; do command -v "$c" >/dev/null || { echo "缺少命令 ${c}，无法打包"; exit 2; }; done

ALL=(); while IFS= read -r f; do ALL+=("$(dirname "$f")"); done < <(find "$BASE" -mindepth 3 -maxdepth 3 -name SKILL.md | LC_ALL=C sort)
TARGETS=()
if [ ${#ONLY[@]} -eq 0 ]; then TARGETS=("${ALL[@]}"); else
  for n in "${ONLY[@]}"; do hit=""; for d in "${ALL[@]}"; do [ "$(basename "$d")" = "$n" ] && hit="$d"; done
    [ -n "$hit" ] || { echo "找不到技能 $n"; exit 2; }; TARGETS+=("$hit"); done
fi

LOG="$(mktemp -t equip-package)"; BAD="$(mktemp -t equip-selftest)"; trap 'rm -f "$LOG" "$BAD"' EXIT
FAILED=(); ASSERTS=0; BUILT=0
if [ "$TEST" = 1 ]; then
  # 自测由 tools/selftest.js 并行跑完，自测失败的技能不打包
  sk=(); for d in "${TARGETS[@]}"; do sk+=(--skill "$(basename "$d")"); done
  node "$TOOLS/selftest.js" --level "$TLEVEL" "${sk[@]}" --failed-out "$BAD" >"$LOG" 2>&1
  rc=$?; [ "$rc" = 2 ] && { cat "$LOG"; exit 2; }
  [ "$rc" = 0 ] || sed -n '/^—— 失败/,/^用例级别/p' "$LOG" | sed '$d'
  ASSERTS="$(sed -nE 's/^自测断言通过：([0-9]+) 条。$/\1/p' "$LOG")"
fi
for d in "${TARGETS[@]}"; do
  n="$(basename "$d")"
  if [ "$TEST" = 1 ] && grep -qx "$n" "$BAD"; then echo "自测失败，跳过打包：$n"; FAILED+=("$n"); continue; fi
  args=(); [ "$DEV" = 1 ] && args+=(--with-examples)
  if ! bash "$TOOLS/build.sh" "$d" ${args[@]+"${args[@]}"} >"$LOG" 2>&1; then echo "打包失败：$n"; cat "$LOG"; FAILED+=("$n"); continue; fi
  if [ "$DEV" = 0 ] && ! node "$TOOLS/make-list.js" --check "$n" >"$LOG" 2>&1; then echo "包校验失败：$n"; tail -3 "$LOG"; FAILED+=("$n"); continue; fi
  BUILT=$((BUILT + 1))
done

# 依赖技能（D008）：只在全量发布包时打，只从 SKILL_PACK_ROOT 的直接子目录或其一级子目录查找（与 check-dependency.js 规则一致），
# 不用平台默认技能目录，避免打进过时的副本。先清掉旧包，找不到时不中断，结尾提示上架包不完整
DEP_OK=(); DEP_MISS=()
find_dep() {  # $1 英文名，$2 主脚本
  local r="${SKILL_PACK_ROOT:-}" s
  [ -n "$r" ] && [ -d "$r" ] || return 1
  [ -f "$r/$1/scripts/$2" ] && { echo "$r/$1"; return 0; }
  for s in "$r"/*/; do [ -f "${s}$1/scripts/$2" ] && { echo "${s%/}/$1"; return 0; }; done
  return 1
}
if [ ${#ONLY[@]} -eq 0 ] && [ "$DEV" = 0 ]; then
  while read -r n s; do
    rm -f "$ROOT/dist/设备员-发布包/$n.zip"
    d="$(find_dep "$n" "$s")" || { DEP_MISS+=("$n"); continue; }
    c=""
    if [ "$TEST" = 1 ] && [ -f "$d/scripts/selftest.js" ]; then
      if ! node "$d/scripts/selftest.js" >"$LOG" 2>&1; then echo "依赖技能自测失败，未打包：$n"; tail -8 "$LOG"; FAILED+=("$n"); continue; fi
      c="$(grep -oE '[0-9]+/[0-9]+ (通过|passed)' "$LOG" | tail -1 | cut -d/ -f1)"
    fi
    if ! bash "$TOOLS/build.sh" "$d" >"$LOG" 2>&1; then echo "依赖技能打包失败：$n"; cat "$LOG"; FAILED+=("$n"); continue; fi
    if ! node "$TOOLS/make-list.js" --check "$n" >"$LOG" 2>&1; then echo "依赖技能包校验失败：$n"; tail -3 "$LOG"; FAILED+=("$n"); continue; fi
    DEP_OK+=("${n}${c:+（自测 ${c} 条通过）}")
  done < <(node "$TOOLS/make-list.js" --deps)
fi
join() { local out="" x; for x in "$@"; do out="${out:+${out}、}${x}"; done; echo "$out"; }

LIST="未生成"
if [ ${#FAILED[@]} -eq 0 ] && [ "$DEV" = 0 ]; then
  n_zip=0; for d in "${ALL[@]}"; do [ -f "$ROOT/dist/设备员-发布包/$(basename "$d").zip" ] && n_zip=$((n_zip + 1)); done
  if [ "$n_zip" -ge "${#ALL[@]}" ]; then node "$TOOLS/make-list.js" >"$LOG" 2>&1 || { cat "$LOG"; FAILED+=("技能清单"); }; LIST="已更新"
  else LIST="未生成：发布包只有 $n_zip 个，全量打包后才会生成"; fi
fi
echo "打包完成：成功 $BUILT 个，失败 ${#FAILED[@]} 个。"
[ "$TEST" = 1 ] && echo "自测断言通过：${ASSERTS:-0} 条（用例级别 ${TLEVEL}）。" || echo "自测：已跳过。"
echo "技能清单：${LIST}。"
if [ "$DEV" = 1 ]; then echo "产物目录：$ROOT/dist/设备员-开发包"; else echo "产物目录：$ROOT/dist/设备员-发布包"; fi
if [ ${#ONLY[@]} -eq 0 ] && [ "$DEV" = 0 ]; then
  [ ${#DEP_OK[@]} -gt 0 ] && echo "依赖技能：已打包 $(join "${DEP_OK[@]}")，上架时须与 50 个技能包一起上传。"
  [ ${#DEP_MISS[@]} -gt 0 ] && echo "【注意】依赖技能未打包，上架包不完整：$(join "${DEP_MISS[@]}")。设置 SKILL_PACK_ROOT 指向依赖技能所在目录后重新全量打包。"
fi
if [ ${#FAILED[@]} -gt 0 ]; then echo "失败项：${FAILED[*]}"; exit 1; fi
