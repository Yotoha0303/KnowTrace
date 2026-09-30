#!/usr/bin/env bash
# ============================================================================
# bootstrap 主入口 —— 把「从零到可用」的既有零件串成一条链
# ============================================================================
#
# 为什么存在
# ----------
# 2026-09-29/30 核查发现：Linux 侧每个零件都能用，但**没有任何编排入口**。
# README 推荐的 `make up` 走的是 PowerShell（scripts/start-all.ps1），
# 在新 Linux 服务器上 `make`、`powershell`、`pwsh` 一个都不存在。
# 于是「从零部署」实际是 7 步手工命令 + 一堆没自动化的系统准备。
#
# 本脚本不重新实现任何东西，只做三件事：
#   1. 预检（不合格直接拒绝）
#   2. 按阶段调用既有脚本（apps / monitoring / ops）
#   3. 每步记进 --record 记录文件（灾难恢复演练时它就是重建文档）
#
# 与 2026-09-29 设计文档的关系
# ---------------------------
# 那份文档 §4.2 主张「先手工重建成一次，把踩到的每一步记下来，再写脚本」，
# 反对凭空想象地写。本脚本遵守这个约束：**它编排的每一步都是已实测过的命令**，
# 没有任何推断出来的步骤。见 KnowTrace-ops/docs/2026-09-29-一键部署可行性与设计.md。
#
# 明确不自动化（沿用 §3.3）
# ------------------------
#   * 云厂商侧（买机器、DNS、安全组）
#   * 首次 SSH 连接（鸡生蛋）
#   * 系统包安装 / sshd 加固 / UFW —— 有「自锁」风险（见 §2.3），
#     一律不默默执行，只打印指引
#   * 告警凭据（163 授权码）—— 设计上必须隐藏输入
#
# 用法
# ----
#   bootstrap.sh --stage <apps|monitoring|ops|verify> [选项]
#   bootstrap.sh --all [--yes]
#
# 阶段
#   apps        拉代码 + 生成 .env + 起应用栈（会构建镜像，耗时最长）
#   monitoring  调 deploy-observability.sh（监控栈 + Nginx 阻断）
#   ops         装运维巡检的 systemd 单元
#   verify      全链路验收
#
# 选项
#   --dir <路径>     项目目录（默认脚本所在的仓库根）
#   --record <文件>  把每一步追加写入该文件（重建文档）
#   --yes            危险/耗时步骤自动确认（CI 用；人类别用）
#   --dry-run        只打印将要做什么，不执行
#   --help
#
# 退出码
#   0 成功   1 失败   2 危险步骤被拒绝   3 用法错误
# ============================================================================

set -Eeuo pipefail

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=lib/common.sh
. "$script_directory/lib/common.sh"
# shellcheck source=lib/preflight.sh
. "$script_directory/lib/preflight.sh"

BOOTSTRAP_DIR="$(cd -- "$script_directory/../.." && pwd -P)"
BOOTSTRAP_ASSUME_YES=false
BOOTSTRAP_DRY_RUN=false
BOOTSTRAP_STAGES=()

usage() {
  # 退出码按项目惯例：--help 是**正常**请求，返回 0；
  # 参数错误才返回 BOOTSTRAP_USAGE(3)。与 install.sh / init-env.sh 一致。
  sed -n '2,52p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit "$1"
}

while (( $# )); do
  case "$1" in
    --stage)
      [[ -n "${2:-}" ]] || { echo "错误：--stage 需要一个值" >&2; exit "$BOOTSTRAP_USAGE"; }
      case "$2" in
        apps|monitoring|ops|verify) BOOTSTRAP_STAGES+=("$2") ;;
        *) echo "错误：未知阶段 $2（可选 apps|monitoring|ops|verify）" >&2; exit "$BOOTSTRAP_USAGE" ;;
      esac
      shift 2 ;;
    --all)     BOOTSTRAP_STAGES=(apps monitoring ops verify); shift ;;
    --dir)     BOOTSTRAP_DIR="$(cd -- "$2" && pwd -P)"; shift 2 ;;
    --record)  BOOTSTRAP_RECORD_FILE="$2"; shift 2 ;;
    --yes)     BOOTSTRAP_ASSUME_YES=true; shift ;;
    --dry-run) BOOTSTRAP_DRY_RUN=true; shift ;;
    --help|-h) usage 0 ;;
    *) echo "错误：未知参数 $1" >&2; exit "$BOOTSTRAP_USAGE" ;;
  esac
done

if (( ${#BOOTSTRAP_STAGES[@]} == 0 )); then
  echo "错误：至少需要一个阶段（--stage <阶段> 或 --all）" >&2
  usage "$BOOTSTRAP_USAGE"
fi

# 需要 root：既有脚本（init-env.sh 等）自己会 sudo，但预检要读 /proc 与 docker
if (( EUID != 0 )); then
  exec sudo -- "$0" "$@"
fi

cd -- "$BOOTSTRAP_DIR"

# compose 调用方式：**必须**两个 --env-file + 三个 -f。
# 漏掉会在 MetricsBearerToken / KNOWTRACE_APP_REVISION 上静默失效，
# 而部署看起来仍然成功（2026-09-30 事故的教训）。
compose=(
  docker compose
  --project-directory "$BOOTSTRAP_DIR"
  --env-file "$BOOTSTRAP_DIR/.env"
  --env-file "$BOOTSTRAP_DIR/.env.observability"
  -f "$BOOTSTRAP_DIR/compose.yaml"
  -f "$BOOTSTRAP_DIR/compose.production.yaml"
  -f "$BOOTSTRAP_DIR/compose.observability.yaml"
)

b_record "=== bootstrap 开始 $(date -u '+%Y-%m-%dT%H:%M:%SZ') dir=$BOOTSTRAP_DIR stages=${BOOTSTRAP_STAGES[*]} ==="

# ---------------------------------------------------------------------------
b_stage_apps() {
  b_step "阶段：apps —— 生成配置并启动应用栈"

  # 1) .env
  if b_file_has_content "$BOOTSTRAP_DIR/.env"; then
    b_already ".env 已存在"
  else
    if [[ "$BOOTSTRAP_DRY_RUN" == true ]]; then
      b_info "(dry-run) bash scripts/linux/init-env.sh"
    else
      bash scripts/linux/init-env.sh
      b_record "RUN: scripts/linux/init-env.sh"
    fi
  fi

  # 2) .env.observability —— 由 monitoring 阶段真正需要；apps 阶段先确保存在，
  #    因为 compose 合并时它会参与变量插值（缺了 METRICS_BEARER_TOKEN 会直接报错）。
  if b_file_has_content "$BOOTSTRAP_DIR/.env.observability"; then
    b_already ".env.observability 已存在"
  else
    if [[ "$BOOTSTRAP_DRY_RUN" == true ]]; then
      b_info "(dry-run) bash scripts/linux/init-observability-env.sh"
    else
      bash scripts/linux/init-observability-env.sh
      b_record "RUN: scripts/linux/init-observability-env.sh"
    fi
  fi

  # 3) 配置校验 —— 先校验再构建，避免构建完才发现 compose 写错
  if [[ "$BOOTSTRAP_DRY_RUN" == true ]]; then
    b_info "(dry-run) compose config --quiet"
  else
    "${compose[@]}" config --quiet
    b_ok "compose 配置校验通过"
    b_record "VERIFY: compose config --quiet 通过"
  fi

  # 4) 构建并启动
  b_info "将执行：up -d --build --wait（含镜像构建，2 vCPU 机器上约 3–5 分钟）"
  if [[ "$BOOTSTRAP_DRY_RUN" == true ]]; then
    b_info "(dry-run) ${compose[*]} up -d --build --wait"
    return 0
  fi
  export KNOWTRACE_APP_REVISION="$(git -C "$BOOTSTRAP_DIR" rev-parse HEAD 2>/dev/null || echo unknown)"
  export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=1024}"
  b_info "KNOWTRACE_APP_REVISION=${KNOWTRACE_APP_REVISION:0:12}（构建期烘进镜像）"
  "${compose[@]}" up -d --build --wait --wait-timeout 1200
  b_record "RUN: compose up -d --build --wait（revision=${KNOWTRACE_APP_REVISION:0:12}）"
  b_ok "应用栈已启动"
}

# ---------------------------------------------------------------------------
b_stage_monitoring() {
  b_step "阶段：monitoring —— 监控栈 + 边缘阻断 + 自带验收"
  if [[ "$BOOTSTRAP_DRY_RUN" == true ]]; then
    b_info "(dry-run) bash scripts/linux/deploy-observability.sh"
    return 0
  fi
  # 不带 --build-app：apps 阶段已经构建过。带它会重复构建（这台机器上很贵）。
  bash scripts/linux/deploy-observability.sh
  b_record "RUN: scripts/linux/deploy-observability.sh"
  b_ok "监控栈就绪"
}

# ---------------------------------------------------------------------------
b_stage_ops() {
  b_step "阶段：ops —— 安装巡检 systemd 单元"
  local ops_root="/opt/knowtrace-ops"
  local conf="/etc/knowtrace/ops.conf"

  if [[ "$BOOTSTRAP_DRY_RUN" == true ]]; then
    b_info "(dry-run) cp -a scripts/ops/{lib,scripts,systemd,docs,ops.conf.example} $ops_root/"
    b_info "(dry-run) bash $ops_root/systemd/install.sh --source $ops_root/systemd"
    return 0
  fi

  install -d -m 755 "$ops_root"
  # cp -a 而不是 cp -r：cp -r 不修正已存在目标的权限位，
  # 某文件第一次以错误模式拷进去后每次重拷都不会自愈（见 09-29 文档 N3）。
  cp -a scripts/ops/lib scripts/ops/scripts scripts/ops/systemd scripts/ops/docs scripts/ops/ops.conf.example "$ops_root/"
  b_ok "工具包已同步到 $ops_root"

  if [[ ! -f "$conf" ]]; then
    install -m 600 "$ops_root/ops.conf.example" "$conf"
    b_warn "已创建 $conf（0600）—— **需要你编辑**：至少确认 PROJECT_DIR / CERT_DOMAINS / PUBLIC_HEALTH_URL"
  else
    b_already "已存在 $conf"
  fi

  install -d -m 755 /var/lib/knowtrace/reports /var/log/knowtrace-logs
  bash "$ops_root/systemd/install.sh" --source "$ops_root/systemd"
  b_record "RUN: systemd/install.sh（先 start 验证，再 enable 定时器）"
  b_ok "巡检定时器已安装"
}

# ---------------------------------------------------------------------------
b_stage_verify() {
  b_step "阶段：verify —— 全链路验收"
  local failures=0

  check() {
    local label="$1" url="$2" expect="${3:-200}"
    local got
    got="$(curl -s -o /dev/null -w '%{http_code}' -m 10 "$url" 2>/dev/null || echo 000)"
    if [[ "$got" == "$expect" ]]; then
      b_ok "$label → $got"
    else
      b_fail "$label → $got（期望 $expect）"
      failures=$(( failures + 1 ))
    fi
  }

  check "应用存活"  "http://127.0.0.1:3000/api/health/live"
  check "应用就绪"  "http://127.0.0.1:3000/api/health/ready"
  # /api/metrics 无 token 时返回 404 是**设计行为**（404-instead-of-401），不是故障
  check "指标端点（未授权应为 404）" "http://127.0.0.1:3000/api/metrics" 404

  command -v ss >/dev/null 2>&1 && {
    b_info "监听端口："
    ss -tlnp 2>/dev/null | awk 'NR>1 {print "    " $4}' | sort -u | head -12
  }

  b_info "容器状态："
  docker ps --format '    {{.Names}}\t{{.Status}}' 2>/dev/null | sort | head -12

  if (( failures == 0 )); then
    b_ok "验收通过"
    b_record "VERIFY: 全链路验收通过（$failures 个失败）"
  else
    b_fail "验收有 $failures 项失败"
    b_record "VERIFY: 失败 $failures 项"
    return 1
  fi
}

# ---------------------------------------------------------------------------
b_step "预检"
b_check_os
b_check_commands
b_check_docker_running
b_check_resources
b_check_ports

if ! b_detect_existing_deployment; then
  b_warn "本目录已有容器在运行 —— 这可能是重复部署。"
  if ! b_confirm "确认要在已有部署的目录上继续吗？"; then
    b_fail "已中止（危险步骤被拒绝）"
    exit "$BOOTSTRAP_DANGER_DECLINED"
  fi
fi

b_record "PREFLIGHT: 通过"

for stage in "${BOOTSTRAP_STAGES[@]}"; do
  b_stage_"$stage"
done

b_step "完成"
b_info "阶段：${BOOTSTRAP_STAGES[*]}"
if [[ -n "$BOOTSTRAP_RECORD_FILE" ]]; then
  b_info "步骤记录：$BOOTSTRAP_RECORD_FILE"
fi
b_info "未自动化的部分（需人工）：系统包安装、sshd 加固、UFW、反向代理与证书、DNS。"
b_info "指引见 docs/KnowTrace-VPS-部署学习-2026-09-06/阶段一/文档/04-从零部署到当前线上状态-完整实操教程.md"
b_record "=== bootstrap 结束 $(date -u '+%Y-%m-%dT%H:%M:%SZ') ==="
