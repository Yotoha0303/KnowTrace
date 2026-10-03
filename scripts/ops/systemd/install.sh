#!/usr/bin/env bash
set -Eeuo pipefail
# ============================================================================
# KnowTrace-Workflow 运维巡检 —— systemd 单元安装脚本
# ============================================================================
#
# 安装 knowtrace-{daily-ops,weekly-check,monthly-ops} 三个 .service + .timer。
# 不涉及 knowtrace-workflow-backup（那个由 scripts/linux/deploy-observability.sh 装）。
#
# 执行顺序是刻意固定的，别改：
#   装单元 → daemon-reload → **逐个 start 验证** → 全通过才 enable 定时器
#
# 为什么必须「先 start 再 enable」：
#   systemd 的 Documentation= 有两个坑（见 systemd/MEMO.md 第 6.1 节），
#   两种错法都**只是警告、不阻止单元加载**，`systemd-analyze verify` 也查不出来 ——
#   只有真的 start 一次、再读 journal 才能发现。带着坏单元 enable 定时器，
#   等于让一个永远不会正常工作的任务每天定时空跑。
#
# 幂等：重复运行安全，已启用的定时器不会重复启用。
#
# 用法:
#   scripts/ops/systemd/install.sh [--dry-run] [--no-start] [--source <目录>]
#
# 退出码: 0 成功  2 验证失败  3 脚本自身错误
# ============================================================================

source_directory=""
dry_run=false
do_start=true

while (( $# )); do
  case "$1" in
    --source)
      [[ -n "${2:-}" ]] || { echo "错误：--source 需要一个值。" >&2; exit 3; }
      source_directory="$2"; shift 2 ;;
    --source=*) source_directory="${1#*=}"; shift ;;
    --dry-run)  dry_run=true; shift ;;
    --no-start) do_start=false; shift ;;
    --help|-h)  sed -n '2,25p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "错误：未知参数 $1" >&2; exit 3 ;;
  esac
done

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
[[ -n "$source_directory" ]] || source_directory="$script_directory"
source_directory="$(cd -- "$source_directory" && pwd -P)"
target_directory="/etc/systemd/system"

if (( EUID != 0 )); then
  exec sudo -- "$0" "$@"
fi

# ---- 常量 -------------------------------------------------------------------
units=(daily-ops weekly-check monthly-ops)
ops_root="/opt/knowtrace-ops"
ops_conf="/etc/knowtrace/ops.conf"
reports_directory="/var/lib/knowtrace/reports"
records_directory="/var/log/knowtrace-logs"

# Documentation= 坏掉时的报错特征（两种错法，报错不同）
specifier_errors='Failed to resolve unit specifiers|Invalid URL, ignoring|Invalid slot'

log()  { printf '%s\n' "$*"; }
ok()   { printf '  [ OK ] %s\n' "$*"; }
warn() { printf '  [WARN] %s\n' "$*"; }
fail() { printf '  [FAIL] %s\n' "$*"; }

run() {
  if [[ "$dry_run" == true ]]; then
    printf '  (dry-run) %s\n' "$*"
  else
    "$@"
  fi
}

# ---- 1. 预检 -----------------------------------------------------------------
log "== 1/5 预检 =="

(( EUID == 0 )) || { fail "需要 root"; exit 3; }
ok "以 root 运行"

command -v systemctl >/dev/null || { fail "缺少 systemctl（这不是 systemd 系统？）"; exit 3; }
ok "systemctl 可用"

if [[ -d "$ops_root" ]]; then
  ok "部署目录存在：$ops_root"
else
  fail "缺少部署目录 $ops_root"
  log "      先把工具包拷过去：cp -r <仓库>/scripts/ops/{lib,scripts,systemd,docs,ops.conf.example} $ops_root/"
  exit 3
fi

if [[ -f "$ops_conf" ]]; then
  ok "配置文件存在：$ops_conf"
else
  warn "缺少 $ops_conf —— 单元里 Environment=OPS_CONF 指向它，脚本会退回内置默认值"
  warn "  建议：cp $ops_root/ops.conf.example $ops_conf && chmod 600 $ops_conf && 按需编辑"
fi

[[ -d "$reports_directory" ]] && ok "报告目录存在：$reports_directory" || warn "报告目录不存在，稍后创建：$reports_directory"
[[ -d "$records_directory" ]] && ok "记录目录存在：$records_directory" || warn "记录目录不存在，稍后创建：$records_directory"

# 源文件齐不齐
missing=()
for unit in "${units[@]}"; do
  [[ -f "$source_directory/knowtrace-$unit.service" ]] || missing+=("knowtrace-$unit.service")
  [[ -f "$source_directory/knowtrace-$unit.timer"   ]] || missing+=("knowtrace-$unit.timer")
done
if (( ${#missing[@]} )); then
  fail "源目录缺少单元文件：${missing[*]}"
  log "      源目录：$source_directory"
  exit 3
fi
ok "6 个单元文件齐全（3 service + 3 timer）"

# ---- 2. 目录 -----------------------------------------------------------------
log
log "== 2/5 准备目录 =="
run install -d -m 755 "$reports_directory"
run install -d -m 755 "$records_directory"
ok "报告与记录目录就绪"

# ---- 3. 安装单元 -------------------------------------------------------------
log
log "== 3/5 安装单元到 $target_directory =="
for unit in "${units[@]}"; do
  run install -m 644 "$source_directory/knowtrace-$unit.service" "$target_directory/knowtrace-$unit.service"
  run install -m 644 "$source_directory/knowtrace-$unit.timer"   "$target_directory/knowtrace-$unit.timer"
  ok "knowtrace-$unit.{service,timer}"
done
run systemctl daemon-reload
ok "daemon-reload 完成"

if [[ "$do_start" == false ]]; then
  warn "--no-start：跳过启动验证。**不建议**，见本脚本头部说明。"
  log
  log "完成（未启用定时器）。"
  exit 0
fi

# ---- 4. 逐个 start 验证（这一步是重点）---------------------------------------
log
log "== 4/5 逐个启动验证（查 journal 的说明符报错）=="

verification_failed=false
for unit in "${units[@]}"; do
  # 清掉本次之前的时间标记，只看这一次运行产生的日志
  since_marker="$(date -u '+%Y-%m-%d %H:%M:%S')"

  if [[ "$dry_run" == true ]]; then
    log "  (dry-run) systemctl start knowtrace-$unit.service"
    continue
  fi

  systemctl start "knowtrace-$unit.service" 2>/dev/null || true

  # 退出码 1/2 是「巡检结论」（有 WARN/FAIL），不是服务失败；
  # 单元里 SuccessExitStatus=0 1 2 已把它排除在失败之外。
  result="$(systemctl show "knowtrace-$unit.service" -p Result --value 2>/dev/null || echo unknown)"
  documentation="$(systemctl show "knowtrace-$unit.service" -p Documentation --value 2>/dev/null || echo '')"
  journal_errors="$(journalctl -u "knowtrace-$unit.service" --since "$since_marker" --no-pager 2>/dev/null \
                      | grep -Ec "$specifier_errors" || true)"

  unit_ok=true
  if [[ "$result" != "success" ]]; then
    fail "knowtrace-$unit.service 执行结果 Result=$result（期望 success）"
    journalctl -u "knowtrace-$unit.service" -n 15 --no-pager 2>/dev/null | sed 's/^/          /' || true
    unit_ok=false
  fi
  if (( journal_errors > 0 )); then
    fail "knowtrace-$unit.service journal 里有 $journal_errors 行说明符/URL 报错 —— Documentation= 大概率写坏了"
    journalctl -u "knowtrace-$unit.service" --since "$since_marker" --no-pager 2>/dev/null \
      | grep -E "$specifier_errors" | sed 's/^/          /' || true
    log "          修法见 systemd/MEMO.md 第 6.1 节（中文路径要百分号编码，且每个 % 写成 %%）"
    unit_ok=false
  fi
  if [[ -z "$documentation" ]]; then
    warn "knowtrace-$unit.service 的 Documentation= 解析为空（不阻断，但说明那条被丢弃了）"
  fi

  if [[ "$unit_ok" == true ]]; then
    ok "knowtrace-$unit.service 启动验证通过（Result=$result，无说明符报错）"
  else
    verification_failed=true
  fi
done

if [[ "$verification_failed" == true ]]; then
  log
  fail "有单元未通过启动验证 —— **已中止，定时器未启用**"
  log "      修好单元后重新运行本脚本。"
  exit 2
fi

# ---- 5. 启用定时器 -----------------------------------------------------------
log
log "== 5/5 启用定时器 =="
for unit in "${units[@]}"; do
  run systemctl enable --now "knowtrace-$unit.timer" >/dev/null 2>&1
  ok "knowtrace-$unit.timer 已启用"
done

log
log "== 下次触发时间 =="
systemctl list-timers 'knowtrace*' --no-pager 2>/dev/null | sed 's/^/  /' || true

log
log "安装完成。手动跑一次看效果："
log "  sudo systemctl start knowtrace-workflow-daily-ops.service"
log "  报告：sudo ls -t $reports_directory | head"
