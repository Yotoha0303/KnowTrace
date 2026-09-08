#!/usr/bin/env bash
set -Eeuo pipefail

action="${1:-status}"
script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
project_directory="$(cd -- "$script_directory/../.." && pwd -P)"

if (( EUID != 0 )); then
  exec sudo -- "$0" "$@"
fi

"$script_directory/init-observability-env.sh"
export KNOWTRACE_APP_REVISION="$(git -C "$project_directory" rev-parse HEAD 2>/dev/null || echo unknown)"
compose=(docker compose --project-directory "$project_directory" --env-file "$project_directory/.env" --env-file "$project_directory/.env.observability" -f "$project_directory/compose.yaml" -f "$project_directory/compose.production.yaml" -f "$project_directory/compose.observability.yaml" --profile elk)

configure_retention() {
  curl -fsS -X PUT http://127.0.0.1:9200/_ilm/policy/knowtrace-logs-7d \
    -H 'Content-Type: application/json' \
    --data-binary '{"policy":{"phases":{"hot":{"actions":{}},"delete":{"min_age":"7d","actions":{"delete":{}}}}}}' >/dev/null
  curl -fsS -X PUT http://127.0.0.1:9200/_index_template/knowtrace-logs \
    -H 'Content-Type: application/json' \
    --data-binary '{"index_patterns":["knowtrace-logs-*"],"priority":200,"template":{"settings":{"index.lifecycle.name":"knowtrace-logs-7d","index.number_of_shards":1,"index.number_of_replicas":0}}}' >/dev/null
}

configure_kibana() {
  curl -fsS -X POST \
    'http://127.0.0.1:5601/api/saved_objects/index-pattern/knowtrace-logs?overwrite=true' \
    -H 'Content-Type: application/json' \
    -H 'kbn-xsrf: true' \
    --data-binary '{"attributes":{"title":"knowtrace-logs-*","timeFieldName":"@timestamp"}}' >/dev/null
}

case "$action" in
  up)
    available_kib="$(awk '/MemAvailable:/ {print $2}' /proc/meminfo)"
    swap_kib="$(awk '/SwapTotal:/ {print $2}' /proc/meminfo)"
    disk_available_kib="$(df --output=avail -k "$project_directory" | tail -n 1 | tr -d ' ')"
    if (( available_kib < 350000 || swap_kib < 2000000 || disk_available_kib < 8000000 )); then
      echo "错误：ELK 预检不通过；至少需要 350 MiB 可用内存、2 GiB swap 和 8 GiB 可用磁盘。" >&2
      free -h >&2
      df -h "$project_directory" >&2
      exit 1
    fi

    echo "ELK 为按需模式；启动期间可能使用 swap，完成验证后请执行 $0 stop。"
    cleanup_on_error() {
      echo "ELK 启动或验证失败，正在停止按需容器并保留数据卷。" >&2
      "${compose[@]}" stop kibana logstash elasticsearch >/dev/null 2>&1 || true
    }
    trap cleanup_on_error ERR

    "${compose[@]}" pull elasticsearch logstash kibana
    "${compose[@]}" up -d --wait --wait-timeout 600 elasticsearch
    configure_retention
    "${compose[@]}" up -d --wait --wait-timeout 900 logstash kibana
    configure_kibana
    python3 "$script_directory/verify-observability.py" --elk
    trap - ERR
    ;;
  stop)
    "${compose[@]}" stop kibana logstash elasticsearch
    echo "ELK 已停止；Elasticsearch、Logstash 和 Kibana 数据卷均保留。"
    ;;
  status)
    "${compose[@]}" ps elasticsearch logstash kibana
    ;;
  *)
    echo "用法：$0 {up|stop|status}" >&2
    exit 2
    ;;
esac
