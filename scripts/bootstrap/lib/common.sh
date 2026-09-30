#!/usr/bin/env bash
# ============================================================================
# bootstrap 公共库 —— 日志、退出码、幂等辅助、步骤记录
# ============================================================================

# 退出码（与项目既有脚本风格一致）
BOOTSTRAP_OK=0
BOOTSTRAP_FAIL=1
BOOTSTRAP_DANGER_DECLINED=2
BOOTSTRAP_USAGE=3

# 颜色（无 tty 时自动关闭）
if [[ -t 1 ]]; then
  c_reset=$'\033[0m'; c_ok=$'\033[32m'; c_warn=$'\033[33m'
  c_fail=$'\033[31m'; c_step=$'\033[36m'; c_dim=$'\033[2m'
else
  c_reset=''; c_ok=''; c_warn=''; c_fail=''; c_step=''; c_dim=''
fi

b_step()  { printf '%s==> %s%s\n' "$c_step" "$*" "$c_reset"; }
b_ok()    { printf '  %s[ OK ]%s %s\n' "$c_ok" "$c_reset" "$*"; }
b_warn()  { printf '  %s[WARN]%s %s\n' "$c_warn" "$c_reset" "$*" >&2; }
b_fail()  { printf '  %s[FAIL]%s %s\n' "$c_fail" "$c_reset" "$*" >&2; }
b_info()  { printf '  %s%s%s\n' "$c_dim" "$*" "$c_reset"; }

# ---- 步骤记录 --------------------------------------------------------------
# 灾难恢复演练时把每一步记下来，那份记录就是重建文档。
# 见 KnowTrace-ops/docs/2026-09-29-一键部署可行性与设计.md §4.2。
BOOTSTRAP_RECORD_FILE="${BOOTSTRAP_RECORD_FILE:-}"

b_record() {
  [[ -n "$BOOTSTRAP_RECORD_FILE" ]] || return 0
  printf '%s  %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*" >> "$BOOTSTRAP_RECORD_FILE"
}

# ---- 危险操作确认 ----------------------------------------------------------
# 默认拒绝。只有显式 --yes 或交互输入 yes 才继续。
b_confirm() {
  local prompt="$1"
  if [[ "$BOOTSTRAP_ASSUME_YES" == true ]]; then
    b_warn "「$prompt」—— 因 --yes 自动确认"
    b_record "AUTO-CONFIRMED: $prompt"
    return 0
  fi
  printf '%s\n' "$prompt"
  printf '继续请输入 yes（其他任何输入都会中止）: '
  local answer=''
  read -r answer || true
  if [[ "$answer" == "yes" ]]; then
    b_record "CONFIRMED: $prompt"
    return 0
  fi
  b_record "DECLINED: $prompt"
  return 1
}

# ---- 幂等辅助 --------------------------------------------------------------
# 值为空或以 replace/your_ 开头时才认为「未设置」—— 与 init-env.sh 的语义一致。
b_file_has_content() {
  [[ -s "$1" ]]
}

# 只在必要时执行；已满足时打印跳过原因（避免「看起来做了其实没做」）
b_already() {
  b_ok "$1（已满足，跳过）"
  b_record "SKIP: $1"
}
