#!/usr/bin/env bash
# ============================================================================
# bootstrap 预检 —— OS / 内存 / 磁盘 / docker / 端口占用 / 命令
# ============================================================================
#
# 照抄 deploy-observability.sh 的先例：不合格直接拒绝，不带着问题往下跑。
# 「预检前置」是项目既有脚本的一贯做法，这里保持一致。

b_check_commands() {
  local missing=()
  # 应用侧必需
  for c in git docker openssl awk sed grep curl python3; do
    command -v "$c" >/dev/null 2>&1 || missing+=("$c")
  done
  if (( ${#missing[@]} )); then
    b_fail "缺少必需命令：${missing[*]}"
    b_info "Debian/Ubuntu: apt-get install -y git openssl curl python3"
    return 1
  fi
  b_ok "必需命令齐备"

  # docker compose 子命令（v2 插件）
  if ! docker compose version >/dev/null 2>&1; then
    b_fail "docker compose（v2 插件）不可用"
    b_info "本脚本假定 Docker Compose v2。装法见 https://docs.docker.com/engine/install/"
    return 1
  fi
  b_ok "docker compose v2 可用（$(docker compose version --short 2>/dev/null || echo '版本未知')）"

  # 可选命令——缺了只是少功能，不阻断
  local optional_missing=()
  for c in make flock jq bc ss systemctl ufw; do
    command -v "$c" >/dev/null 2>&1 || optional_missing+=("$c")
  done
  if (( ${#optional_missing[@]} )); then
    b_warn "缺少可选命令：${optional_missing[*]}（不影响 app 阶段，相关能力会跳过）"
  fi
  return 0
}

b_check_os() {
  if [[ ! -r /etc/os-release ]]; then
    b_warn "读不到 /etc/os-release，跳过 OS 识别"
    return 0
  fi
  # shellcheck disable=SC1091
  . /etc/os-release
  b_ok "OS: ${PRETTY_NAME:-unknown}"
  case "${ID:-}" in
    ubuntu|debian) : ;;
    *) b_warn "非 Debian 系（ID=${ID:-unknown}）—— 本脚本只在 Ubuntu/Debian 上验证过" ;;
  esac
  return 0
}

b_check_resources() {
  local available_kib disk_available_kib
  available_kib="$(awk '/MemAvailable:/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)"
  disk_available_kib="$(df --output=avail -k "$BOOTSTRAP_DIR" 2>/dev/null | tail -n 1 | tr -d ' ' || echo 0)"
  available_kib="${available_kib:-0}"; disk_available_kib="${disk_available_kib:-0}"

  b_info "可用内存 $(( available_kib / 1024 )) MiB / 可用磁盘 $(( disk_available_kib / 1024 / 1024 )) GiB"

  # 阈值比 deploy-observability.sh 宽，因为本脚本还要跑 docker build。
  # 2026-09-30 的事故证明了在上限附近构建会把机器压死（负载 124 / 可用内存 15 MB）。
  if (( available_kib < 700000 )); then
    b_fail "可用内存不足 700 MiB —— 不足以安全完成 docker build"
    b_info "这台机器上 next build 曾把 2 vCPU/1.8 GB 的实例压到负载 124。"
    b_info "先从 app 阶段分出 --build-host 或加 swap，不要硬上。"
    return 1
  fi
  if (( disk_available_kib < 12000000 )); then
    b_fail "可用磁盘不足 12 GiB（镜像 + 构建缓存 + 数据卷）"
    return 1
  fi
  b_ok "内存与磁盘预检通过"
  return 0
}

b_check_docker_running() {
  if ! docker info >/dev/null 2>&1; then
    b_fail "docker daemon 不可达"
    b_info "启动：systemctl enable --now docker"
    return 1
  fi
  b_ok "docker daemon 可达"
  return 0
}

# 端口占用：默认应用到主机的 3000 与监控端口。
# 已在用的端口**不一定是错**（可能就是要复用的既有部署），所以这里只警告不阻断——
# 但如果同一个项目目录已经在跑，那就是重复部署，需要显式确认。
b_check_ports() {
  command -v ss >/dev/null 2>&1 || { b_warn "无 ss，跳过端口检查"; return 0; }
  local busy=()
  local ports=(3000 3001 9090 9093 8080)
  for p in "${ports[@]}"; do
    if ss -tlnH "sport = :$p" 2>/dev/null | grep -q .; then busy+=("$p"); fi
  done
  if (( ${#busy[@]} )); then
    b_warn "以下端口已被占用：${busy[*]}"
    b_info "若这是既有部署且你要复用，忽略；若是重复部署，先停掉旧的。"
  else
    b_ok "关键端口空闲"
  fi
  return 0
}

# 本目录是否已经是一个跑着的部署
b_detect_existing_deployment() {
  if docker compose --project-directory "$BOOTSTRAP_DIR" ps -q 2>/dev/null | grep -q .; then
    b_warn "本目录已有容器在运行"
    return 1
  fi
  return 0
}
