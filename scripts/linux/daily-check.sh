#!/usr/bin/env bash

set -u

# ============================================================
# KnowTrace Daily Operations Check
# Read-only inspection script
# ============================================================

DATE="$(date '+%Y-%m-%d %H:%M:%S')"
HOST="$(hostname)"
USER_NAME="$(whoami)"
CURRENT_DIR="$(pwd)"

# ------------------------------------------------------------
# Configuration
# ------------------------------------------------------------

PROJECT_DIR="${PROJECT_DIR:-/opt/knowtrace}"

# 如果 KnowTrace 实际部署目录不同：
# export PROJECT_DIR=/your/path

HEALTH_LIVE_URL="${HEALTH_LIVE_URL:-http://127.0.0.1/api/health/live}"
HEALTH_READY_URL="${HEALTH_READY_URL:-http://127.0.0.1/api/health/ready}"

BACKUP_DIR="${BACKUP_DIR:-/opt/backups}"

# 如果没有证书检查对象，可以留空
CERT_DOMAIN="${CERT_DOMAIN:-}"

LOG_LINES="${LOG_LINES:-100}"

# ------------------------------------------------------------
# Helper
# ------------------------------------------------------------

section() {
    echo
    echo "============================================================"
    echo "$1"
    echo "============================================================"
}

ok() {
    echo "[ OK ] $1"
}

warn() {
    echo "[WARN] $1"
}

fail() {
    echo "[FAIL] $1"
}

info() {
    echo "[INFO] $1"
}

# ------------------------------------------------------------
# 1. Host identity
# ------------------------------------------------------------

section "1. 主机身份"

echo "Date        : $DATE"
echo "Hostname    : $HOST"
echo "User        : $USER_NAME"
echo "Directory   : $CURRENT_DIR"

info "确认以上信息后，再进行任何修改性操作。"

# ------------------------------------------------------------
# 2. System uptime / load
# ------------------------------------------------------------

section "2. 系统运行时间与负载"

uptime

# ------------------------------------------------------------
# 3. CPU / Memory / Swap
# ------------------------------------------------------------

section "3. CPU / 内存 / Swap"

echo "--- Memory ---"
free -h

echo
echo "--- Load ---"
cat /proc/loadavg

echo
echo "--- Top CPU ---"
ps -eo pid,ppid,comm,%cpu,%mem --sort=-%cpu | head -n 11

echo
echo "--- Top Memory ---"
ps -eo pid,ppid,comm,%cpu,%mem --sort=-%mem | head -n 11

# ------------------------------------------------------------
# 4. Disk
# ------------------------------------------------------------

section "4. 磁盘"

df -h

echo
echo "--- Docker disk usage ---"

if command -v docker >/dev/null 2>&1; then
    docker system df
else
    warn "Docker 未安装或 docker 命令不可用"
fi

# ------------------------------------------------------------
# 5. Login / SSH security
# ------------------------------------------------------------

section "5. 最近登录"

last -n 10

echo
echo "--- SSH failed login attempts ---"

if command -v journalctl >/dev/null 2>&1; then

    journalctl --since "24 hours ago" \
        | grep -Ei \
        "Failed password|authentication failure|Invalid user" \
        | tail -n 30 \
        || true

else
    warn "journalctl 不可用"
fi

# ------------------------------------------------------------
# 6. Project directory
# ------------------------------------------------------------

section "6. KnowTrace 项目目录"

if [ -d "$PROJECT_DIR" ]; then

    ok "项目目录存在：$PROJECT_DIR"

    echo
    echo "--- Directory ---"
    ls -la "$PROJECT_DIR"

    echo
    echo "--- Disk usage ---"
    du -sh "$PROJECT_DIR"/* 2>/dev/null \
        | sort -h \
        | tail -n 20

else

    warn "项目目录不存在：$PROJECT_DIR"

fi

# ------------------------------------------------------------
# 7. Docker containers
# ------------------------------------------------------------

section "7. Docker 容器"

if command -v docker >/dev/null 2>&1; then

    echo "--- Running containers ---"
    docker ps

    echo
    echo "--- All containers ---"
    docker ps -a

    echo
    echo "--- Restart counts ---"

    docker ps -a \
        --format '{{.Names}}\t{{.Status}}' \
        | while IFS=$'\t' read -r name status; do

            echo "$name : $status"

        done

else

    warn "Docker 不可用"

fi

# ------------------------------------------------------------
# 8. Container logs
# ------------------------------------------------------------

section "8. Docker 日志关键错误扫描"

if command -v docker >/dev/null 2>&1; then

    containers=$(docker ps --format '{{.Names}}')

    if [ -n "$containers" ]; then

        while read -r container; do

            echo
            echo "--- $container ---"

            docker logs \
                --tail "$LOG_LINES" \
                "$container" 2>&1 \
                | grep -Ei \
                "error|warn|panic|timeout|connection refused|permission denied" \
                | tail -n 20 \
                || echo "未发现匹配关键字"

        done <<< "$containers"

    else

        warn "当前没有运行中的容器"

    fi

fi

# ------------------------------------------------------------
# 9. KnowTrace health check
# ------------------------------------------------------------

section "9. KnowTrace Health Check"

check_http() {

    URL="$1"

    if command -v curl >/dev/null 2>&1; then

        HTTP_CODE=$(curl \
            -k \
            -s \
            -o /tmp/knowtrace_health.tmp \
            -w "%{http_code}" \
            --max-time 5 \
            "$URL" \
            || echo "000")

        echo "$URL -> HTTP $HTTP_CODE"

        case "$HTTP_CODE" in

            2*)
                ok "$URL"
                ;;

            *)
                warn "$URL -> HTTP $HTTP_CODE"
                ;;

        esac

    else

        warn "curl 不可用，跳过 HTTP health check"

    fi
}

check_http "$HEALTH_LIVE_URL"
check_http "$HEALTH_READY_URL"

rm -f /tmp/knowtrace_health.tmp

# ------------------------------------------------------------
# 10. Backup
# ------------------------------------------------------------

section "10. 备份检查"

if [ -d "$BACKUP_DIR" ]; then

    echo "Backup directory:"
    ls -lah "$BACKUP_DIR"

    echo
    echo "Recent backup files:"

    find "$BACKUP_DIR" \
        -type f \
        -mtime -7 \
        -printf '%TY-%Tm-%Td %TH:%TM %s %p\n' \
        2>/dev/null \
        | sort \
        | tail -n 20

else

    warn "备份目录不存在：$BACKUP_DIR"

fi

# ------------------------------------------------------------
# 11. Certificate
# ------------------------------------------------------------

section "11. TLS 证书"

if [ -n "$CERT_DOMAIN" ]; then

    if command -v openssl >/dev/null 2>&1; then

        echo | openssl s_client \
            -connect "${CERT_DOMAIN}:443" \
            -servername "${CERT_DOMAIN}" \
            2>/dev/null \
            | openssl x509 \
                -noout \
                -subject \
                -issuer \
                -dates

    else

        warn "openssl 不可用"

    fi

else

    info "未设置 CERT_DOMAIN，跳过证书检查"

fi

# ------------------------------------------------------------
# 12. Listening ports
# ------------------------------------------------------------

section "12. 对外监听端口"

if command -v ss >/dev/null 2>&1; then

    ss -lntup

else

    warn "ss 不可用"

fi

# ------------------------------------------------------------
# 13. Firewall
# ------------------------------------------------------------

section "13. 防火墙"

if command -v ufw >/dev/null 2>&1; then

    ufw status verbose

elif command -v firewall-cmd >/dev/null 2>&1; then

    firewall-cmd --state
    firewall-cmd --list-all

else

    info "未发现 ufw / firewalld"

fi

# ------------------------------------------------------------
# 14. Docker compose status
# ------------------------------------------------------------

section "14. Docker Compose"

if [ -d "$PROJECT_DIR" ]; then

    cd "$PROJECT_DIR" || true

    if docker compose version >/dev/null 2>&1; then

        docker compose ps

    else

        info "docker compose 不可用"

    fi

    cd - >/dev/null || true

fi

# ------------------------------------------------------------
# 15. Summary
# ------------------------------------------------------------

section "15. 巡检结束"

echo "检查时间 : $DATE"
echo "主机     : $HOST"
echo "用户     : $USER_NAME"
echo
echo "本脚本只进行只读巡检。"
echo "发现异常后，应先保存证据，再进行人工分析。"
echo
echo "建议记录："
echo "1. 异常现象"
echo "2. 命令输出"
echo "3. 关键证据"
echo "4. 初步推断"
echo "5. 处理动作"
echo "6. 验证结果"
echo "7. 遗留风险"

echo
echo "============================================================"
echo "Daily Check Finished"
echo "============================================================"
