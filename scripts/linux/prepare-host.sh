#!/usr/bin/env bash
set -Eeuo pipefail
# ============================================================================
# 宿主机准备（幂等）—— 补上 bootstrap 在全新机器上缺的那几步
# ============================================================================
#
# 为什么需要这个脚本：
#   2026-10-02 在全新 Ubuntu 24.04 上实测 bootstrap.sh，apps / monitoring / ops
#   三个阶段各失败一次，根因都不是"脚本写得差"，而是**编排缺步骤**：
#
#     1. 两个 external 数据卷不存在 —— docker compose up 直接报
#        `external volume "go-user-system_mysql_data" not found`，连构建都没开始。
#        唯一创建它们的是 scripts/start-all.ps1（**PowerShell**），Linux 侧没有对应实现。
#     2. /etc/knowtrace/ 父目录不存在 —— ops 阶段 install 报 No such file or directory。
#        （那一处在 bootstrap.sh 里修，不在本脚本）
#     3. /etc/nginx/sites-available/knowtrace.conf 不存在 ——
#        install-observability-nginx.sh 硬要求它已存在，否则 exit 1。
#     4. Ubuntu 的 nginx default 站点占 :80，与 Caddy 抢端口 —— TLS 起不来。
#
#   本脚本把这 4 步收成一处，可在 apps 阶段之前安全重复执行。
#
# 用法:
#   scripts/linux/prepare-host.sh [--dry-run] [--fix-uploads] [--skip-default-site]
#
# 退出码: 0 成功  1 失败  3 脚本自身错误（缺文件、缺命令）
#
# 明确不做（理由见 docs/changes/2026-10-02-补一键部署缺的编排步骤.md §4）：
#   * apt 装包       —— 在服务器上执行 apt 是写操作，且发行版相关
#   * UFW / sshd     —— 自锁风险，永远不该默默执行
#   * Caddyfile      —— 与域名强相关，需显式参数而非固定文件
# ============================================================================

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
project_directory="$(cd -- "$script_directory/../.." && pwd -P)"

dry_run=false
fix_uploads=false
skip_default_site=false

while (( $# )); do
  case "$1" in
    --dry-run)           dry_run=true; shift ;;
    --fix-uploads)       fix_uploads=true; shift ;;
    --skip-default-site) skip_default_site=true; shift ;;
    --help|-h)           sed -n '2,32p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "错误：未知参数 $1" >&2; exit 3 ;;
  esac
done

if (( EUID != 0 )); then
  exec sudo -- "$0" "$@"
fi

run() {
  if [[ "$dry_run" == true ]]; then
    printf '    (dry-run) %s\n' "$*"
  else
    "$@"
  fi
}
ok()   { printf '  [ OK ] %s\n' "$*"; }
skip() { printf '  [跳过] %s\n' "$*"; }
warn() { printf '  [WARN] %s\n' "$*" >&2; }
fail() { printf '  [FAIL] %s\n' "$*" >&2; }

echo "==> 宿主机准备（幂等）"
[[ "$dry_run" == true ]] && echo "    dry-run 模式：不会修改任何东西"

# ---------------------------------------------------------------------------
echo
echo "--- 1/4 外部数据卷 ---"
# 为什么是 external：这两个卷是 go-user-system 的历史命名，统一栈要复用它们，
# 所以 compose.yaml 声明 external: true，Docker 不会替我们创建。
volumes=(go-user-system_mysql_data go-user-system_redis_data)
missing_volumes=()
for volume in "${volumes[@]}"; do
  if docker volume inspect "$volume" >/dev/null 2>&1; then
    skip "卷已存在：$volume"
  else
    missing_volumes+=("$volume")
  fi
done
if (( ${#missing_volumes[@]} )); then
  command -v docker >/dev/null 2>&1 || { fail "缺少命令 docker"; exit 3; }
  for volume in "${missing_volumes[@]}"; do
    run docker volume create "$volume" >/dev/null
    ok "已创建卷：$volume"
  done
else
  ok "两个数据卷均已存在"
fi

# ---------------------------------------------------------------------------
echo
echo "--- 2/4 Nginx 站点配置 ---"
# 这里只"放一份"，不做 reload —— apps 阶段之前应用还没起来，
# install-observability-nginx.sh 的 ready 检查会失败。
# 那个脚本看到目标已存在且内容相同，会走 `cmp -s` 的等值分支，只做 nginx -t。
source_path="$project_directory/deploy/nginx/knowtrace-vps.conf"
target_available="/etc/nginx/sites-available/knowtrace.conf"
target_enabled="/etc/nginx/sites-enabled/knowtrace.conf"

if [[ ! -f "$source_path" ]]; then
  fail "缺少 $source_path"
  exit 3
fi

if [[ -f "$target_available" ]] && cmp -s -- "$source_path" "$target_available"; then
  skip "站点配置已是目标版本"
else
  if [[ -f "$target_available" ]]; then
    timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
    backup_directory="/root/knowtrace-ops/backups/${timestamp}-prepare-host-nginx"
    run install -d -m 700 "$backup_directory"
    run cp -a -- "$target_available" "$backup_directory/knowtrace.conf"
    ok "原站点配置已备份到 $backup_directory"
  fi
  run install -d -m 755 /etc/nginx/sites-available /etc/nginx/sites-enabled
  run install -m 644 -- "$source_path" "$target_available"
  ok "已安装站点配置：$target_available"
fi

if [[ -L "$target_enabled" || -f "$target_enabled" ]]; then
  skip "软链已存在：$target_enabled"
else
  run ln -sf -- "$target_available" "$target_enabled"
  ok "已创建软链：$target_enabled"
fi

# ---------------------------------------------------------------------------
echo
echo "--- 3/4 Nginx 默认站点（它会占 :80，与 Caddy 冲突）---"
default_site="/etc/nginx/sites-enabled/default"
if [[ "$skip_default_site" == true ]]; then
  warn "已按 --skip-default-site 跳过 —— 确认 Caddy 与 Nginx 不会抢 :80"
elif [[ -e "$default_site" ]]; then
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  backup_directory="/root/knowtrace-ops/backups/${timestamp}-default-site"
  run install -d -m 700 "$backup_directory"
  run cp -a -- "$default_site" "$backup_directory/default"
  run rm -f -- "$default_site"
  ok "已移除 default 站点（备份：$backup_directory）"
else
  skip "default 站点不存在"
fi

if command -v nginx >/dev/null 2>&1; then
  if [[ "$dry_run" == true ]]; then
    printf '    (dry-run) nginx -t\n'
  elif nginx -t >/dev/null 2>&1; then
    ok "nginx -t 通过"
  else
    fail "nginx -t 未通过 —— 请手动检查后再继续"
    exit 1
  fi
fi

# ---------------------------------------------------------------------------
echo
echo "--- 4/4 证据图片目录属主（可选，要求数据目录已存在）---"
# 这一步在 apps 阶段之后才有意义：compose.yaml 把 ./data/uploads 作为绑定挂载，
# 会盖掉镜像里的 chown，宿主机首次 up 时该目录由 root 创建，而容器内是 uid 1001。
# 不修则图片上传 100% EACCES（2026-09-13 与 09-19 曾静默发生 42 次）。
uploads_directory="$project_directory/data/uploads"
if [[ "$fix_uploads" != true ]]; then
  skip "未指定 --fix-uploads（bootstrap 会在 apps 阶段之后自动调用一次）"
elif [[ ! -d "$uploads_directory" ]]; then
  skip "数据目录尚不存在：$uploads_directory（等 apps 阶段之后再处理）"
else
  run bash "$script_directory/fix-uploads-ownership.sh"
  ok "属主修复已执行"
fi

echo
echo "宿主机准备完成。"
