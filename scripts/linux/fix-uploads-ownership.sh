#!/usr/bin/env bash
#
# 修复证据图片目录的属主，让容器内的非 root 进程可以写。
#
# 为什么需要：
#   compose.yaml 把 ./data/uploads 作为绑定挂载覆盖到 /app/data/uploads，
#   这会盖掉 Dockerfile 中 `chown -R nextjs:nodejs /app/data` 的结果。
#   宿主机首次 docker compose up 时该目录由 root 创建，而容器内进程是 uid 1001，
#   于是 writeEvidenceImage 的 writeFile(..., {flag:"wx"}) 每次都抛 EACCES，
#   图片上传功能完全不可用且只在请求层表现为“上传失败”。
#   2026-09-13 与 09-19 共静默失败 42 次。
#
# 何时执行：
#   1. 首次部署之后、每次 docker compose up 之后（up 可能重建绑定挂载目录）；
#   2. 从备份恢复并重新落地 data/uploads 之后（tar 解出的文件属主是解包者，通常是 root）。
#
# 本脚本幂等：属主已正确时不产生任何变更。

set -Eeuo pipefail
umask 022

PROJECT_DIR="${PROJECT_DIR:-/opt/knowtrace}"
UPLOADS_DIR="$PROJECT_DIR/data/uploads"

# 必须与容器内实际进程身份一致。实测（docker exec knowtrace-app-1 id）：
#   uid=1001(nextjs) gid=65533(nogroup) groups=65533(nogroup)
#
# 注意 gid 不是 1001：Dockerfile 里的
#   addgroup --system --gid 1001 nodejs
#   adduser  --system --uid 1001 nextjs
# adduser 没有 --ingroup，所以 nextjs 的主组是 alpine 的默认系统组 nogroup(65533)，
# 而不是 nodejs(1001)。nodejs 组虽然存在，但不是进程的主组。
UPLOADS_UID="${UPLOADS_UID:-1001}"
UPLOADS_GID="${UPLOADS_GID:-65533}"

log() {
  printf '%s %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"
}

die() {
  log "ERROR: $*" >&2
  exit 1
}

[[ "$UPLOADS_UID" =~ ^[0-9]+$ ]] || die "UPLOADS_UID 必须是数字: $UPLOADS_UID"
[[ "$UPLOADS_GID" =~ ^[0-9]+$ ]] || die "UPLOADS_GID 必须是数字: $UPLOADS_GID"
[[ "$UPLOADS_DIR" == /* ]] || die "上传目录必须是绝对路径: $UPLOADS_DIR"

[[ "$(id -u)" == "0" ]] || die "需要 root 才能修改属主；请用 sudo 执行。"

# 创建而不是报错：首次部署时目录可能还不存在。
mkdir -p "$UPLOADS_DIR/evidence"

# 目录必须可进入（x）；evidence 需要可写（w）。
chmod 755 "$UPLOADS_DIR"
chmod 755 "$UPLOADS_DIR/evidence"

before="$(stat -c '%u:%g' "$UPLOADS_DIR")"
chown -R "$UPLOADS_UID:$UPLOADS_GID" "$UPLOADS_DIR"
after="$(stat -c '%u:%g' "$UPLOADS_DIR")"

if [[ "$before" == "$after" ]]; then
  log "属主已是 $after，无需变更。"
else
  log "属主 $before -> $after"
fi

# 真实校验：不只是看属主，而是以目标 uid 实际写一个文件。
probe="$UPLOADS_DIR/evidence/.ownership-probe-$$"
if setpriv --reuid="$UPLOADS_UID" --regid="$UPLOADS_GID" --clear-groups \
     sh -c "printf '' > '$probe'" 2>/dev/null; then
  rm -f "$probe"
  log "OK：已确认 uid $UPLOADS_UID 可以写入 $UPLOADS_DIR/evidence"
  printf 'UPLOADS_OWNERSHIP=PASS\n'
else
  rm -f "$probe" 2>/dev/null || true
  die "属主已设置为 $after，但以 uid $UPLOADS_UID 写入探测失败。请人工检查挂载是否为只读、或所在文件系统是否允许该 uid 写入。"
fi
