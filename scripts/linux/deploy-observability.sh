#!/usr/bin/env bash
set -Eeuo pipefail

build_app=false
for argument in "$@"; do
  case "$argument" in
    --build-app) build_app=true ;;
    *)
      echo "用法：$0 [--build-app]" >&2
      exit 2
      ;;
  esac
done

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
project_directory="$(cd -- "$script_directory/../.." && pwd -P)"

if (( EUID != 0 )); then
  exec sudo -- "$0" "$@"
fi

exec 9>/run/knowtrace-observability.lock
flock -n 9 || {
  echo "错误：另一个可观测性部署正在运行。" >&2
  exit 1
}

[[ -f "$project_directory/.env" ]] || {
  echo "错误：缺少生产环境文件 $project_directory/.env" >&2
  exit 1
}
[[ -f "$project_directory/compose.production.yaml" ]] || {
  echo "错误：缺少 VPS 叠加文件 compose.production.yaml" >&2
  exit 1
}

available_kib="$(awk '/MemAvailable:/ {print $2}' /proc/meminfo)"
disk_available_kib="$(df --output=avail -k "$project_directory" | tail -n 1 | tr -d ' ')"
if (( available_kib < 500000 || disk_available_kib < 8000000 )); then
  echo "错误：核心监控预检不通过；至少需要 500 MiB 可用内存和 8 GiB 可用磁盘。" >&2
  free -h >&2
  df -h "$project_directory" >&2
  exit 1
fi

"$script_directory/init-observability-env.sh"
export KNOWTRACE_APP_REVISION="$(git -C "$project_directory" rev-parse HEAD 2>/dev/null || echo unknown)"
compose=(docker compose --project-directory "$project_directory" --env-file "$project_directory/.env" --env-file "$project_directory/.env.observability" -f "$project_directory/compose.yaml" -f "$project_directory/compose.production.yaml" -f "$project_directory/compose.observability.yaml")

"${compose[@]}" config --quiet
docker run --rm --entrypoint /bin/promtool \
  -v "$project_directory/deploy/monitoring/prometheus.yml:/etc/prometheus/prometheus.yml:ro" \
  -v "$project_directory/deploy/monitoring/rules:/etc/prometheus/rules:ro" \
  -v "$project_directory/runtime/prometheus:/etc/prometheus/secrets:ro" \
  quay.io/prometheus/prometheus:v3.5.5 \
  check config /etc/prometheus/prometheus.yml
docker run --rm --entrypoint /bin/amtool \
  -v "$project_directory/runtime/alertmanager:/etc/alertmanager:ro" \
  quay.io/prometheus/alertmanager:v0.28.1 \
  check-config /etc/alertmanager/alertmanager.json

echo "[1/6] 拉取固定版本的核心监控镜像"
"${compose[@]}" pull node-exporter blackbox-exporter alertmanager prometheus grafana loki alloy

echo "[2/6] 让主应用加载私有 metrics token"
if [[ "$build_app" == true ]]; then
  "${compose[@]}" up -d --no-deps --build --wait --wait-timeout 900 app
else
  "${compose[@]}" up -d --no-deps --no-build --wait --wait-timeout 300 app
fi

echo "[3/6] 安装 Nginx metrics 公网阻断并保留原配置"
"$script_directory/install-observability-nginx.sh"

echo "[4/6] 启动 Alertmanager、Exporter、Prometheus、Grafana 与日志栈"
# 必须显式列出 loki 与 alloy：grafana 依赖 loki 会把它带起，
# 但 **alloy 没有任何被依赖者** —— 不显式列它就永远不会启动，
# 表现为「监控全套正常，只有日志是空的」。
"${compose[@]}" up -d --no-build --wait --wait-timeout 600 \
  alertmanager node-exporter blackbox-exporter prometheus grafana loki alloy

# 规则文件是**绑定挂载**进 Prometheus 的（deploy/monitoring/rules -> /etc/prometheus/rules）。
# 上面的 `up -d` 对「镜像没变、只有挂载内容变了」的容器是空操作 ——
# 容器不重启，Prometheus 也就不重读规则。
# 2026-09-30 实测踩到：新增的 knowtrace.revision 组在宿主机文件里、在容器内都能 grep 到，
# 但 /api/v1/rules 里就是没有它 —— 因为 Prometheus 容器自 09-08 起就没重启过。
#
# HUP 会触发热加载（Prometheus 收到 SIGHUP 重读配置与规则，不重启容器、不丢内存样本）。
# 这里显式验证规则真的加载了，不靠「应该没问题」。
echo "  [..] 触发 Prometheus 重载规则"
docker kill -s HUP knowtrace-prometheus-1 >/dev/null 2>&1 || true
sleep 8
rules_seen=false
for _ in 1 2 3; do
  if curl -s -m 10 http://127.0.0.1:9090/api/v1/rules | grep -q 'knowtrace\.revision'; then
    rules_seen=true
    break
  fi
  sleep 5
done
if [[ "$rules_seen" == true ]]; then
  echo "  [ OK ] knowtrace.revision 规则组已加载"
else
  echo "  [WARN] knowtrace.revision 组未出现在 Prometheus 里 —— 规则可能没生效。" >&2
  echo "         人工核对：curl -s http://127.0.0.1:9090/api/v1/rules | grep revision" >&2
fi

install -m 644 "$project_directory/deploy/systemd/knowtrace-backup.service" /etc/systemd/system/knowtrace-backup.service
install -m 644 "$project_directory/deploy/systemd/knowtrace-backup.timer" /etc/systemd/system/knowtrace-backup.timer
systemctl daemon-reload
systemctl enable --now knowtrace-backup.timer >/dev/null
"$script_directory/write-backup-metrics.sh"

echo "[5/6] 断言运行态 revision"
metrics_token="$(grep -oP '^METRICS_BEARER_TOKEN=\K.*' "$project_directory/.env.observability" 2>/dev/null || true)"
running_revision=""
if [[ -n "$metrics_token" ]]; then
  running_revision="$(curl -sS -m 10 -H "Authorization: Bearer $metrics_token" http://127.0.0.1:3000/api/metrics 2>/dev/null | grep -oP '^knowtrace_build_info\{[^}]*revision="\K[^"]*' | head -1)"
fi

if [[ -z "$running_revision" ]]; then
  echo "  [WARN] 读不到运行态 revision（metrics 端点不可用）—— 无法断言。"
  echo "         指标已由 knowtrace.revision 组的 KnowTraceAppRevisionCheckNotRunning 兜底。"
elif [[ "$running_revision" == "$KNOWTRACE_APP_REVISION" ]]; then
  echo "  [ OK ] 运行态与部署目录一致：${running_revision:0:12}"
else
  # 关键区分：这次不一致**要不要紧**，取决于两者之间的 src/ 有没有变。
  changed_app_files=0
  if git -C "$project_directory" cat-file -e "$running_revision^{commit}" 2>/dev/null; then
    changed_app_files="$(git -C "$project_directory" diff --name-only       "$running_revision..$KNOWTRACE_APP_REVISION" -- src/ drizzle/ Dockerfile package.json pnpm-lock.yaml 2>/dev/null | wc -l)"
  else
    # 运行中的 revision 不在本地历史里（比如历史被重写），无法比较，按要紧处理。
    changed_app_files=-1
  fi

  if (( changed_app_files == 0 )); then
    echo "  [WARN] 运行态 revision 与 HEAD 不一致，但两者之间 src/ 与 schema **没有变化**："
    echo "         运行中 ${running_revision:0:12} / HEAD ${KNOWTRACE_APP_REVISION:0:12}"
    echo "         这次部署只动了监控配置，应用没重建是预期的。"
  else
    echo "  [FAIL] 运行态落后于部署目录，且**应用代码确实变了**："
    echo "         运行中 ${running_revision:0:12} / HEAD ${KNOWTRACE_APP_REVISION:0:12}"
    echo "         相差 $changed_app_files 个 src//drizzle//构建相关文件。"
    echo "         修法：用 --build-app 重跑本脚本 —— 不带它时第 [2/5] 步是 --no-build，"
    echo "               只会重启旧镜像，而脚本照样报成功。"
    exit 2
  fi
fi

# 刷新版本指标，不等下一次日巡检（否则部署完到下次巡检之间指标还是旧结论）。
"$script_directory/write-revision-metrics.sh" >/dev/null 2>&1 || true

echo "核心监控已部署；所有管理端口只绑定 127.0.0.1。"

echo "[6/6] 执行端点、target、PromQL、Alertmanager 和 Grafana provisioning 验收"
python3 "$script_directory/verify-observability.py" --core
# 日志栈是常驻组件（不像 ELK 需按需启停），故一并验收：
# 断言 /ready、容器日志采集是否生效、以及「投递一条→可查回」的端到端链路。
python3 "$script_directory/verify-observability.py" --logs

# ---- 6. 断言运行态 revision == HEAD ----------------------------------------
# 2026-09-29 的生态观察发现：部署目录 HEAD 是 47a4c20，而运行中容器自报
# 7ce26f7d（2026-09-08），差 37 个提交 / 21 天，而所有健康检查与巡检报告全绿。
#
# RCA（2026-09-30 实测确认）：应用重建被 `--build-app` 这个**可选开关**把着。
# 不带该开关时，第 [2/5] 步走的是 `up -d --no-deps --no-build` ——
# 它只是重启旧镜像，脚本却照样打印成功。于是后续每一次「只更新监控配置」的部署，
# 都顺手把应用也留在了原地，而没有任何一步会说出来。
#
# 这里把「跑的是不是这一版代码」变成每次部署的显式结论。
# 分两种情况，因为「监控配置变了但应用代码没变」时不一致是**正常**的：
echo
