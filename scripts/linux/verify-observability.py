#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import json
import os
import socket
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


PROJECT_DIRECTORY = Path(__file__).resolve().parents[2]


def read_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        values[key.strip()] = value
    return values


def request(
    url: str,
    *,
    headers: dict[str, str] | None = None,
    data: bytes | None = None,
    method: str | None = None,
    timeout: float = 8.0,
) -> tuple[int, bytes, dict[str, str]]:
    http_request = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={"User-Agent": "KnowTrace-observability-verify/1.0", **(headers or {})},
    )
    with urllib.request.urlopen(http_request, timeout=timeout) as response:
        response_headers = {
            key.lower(): value for key, value in response.headers.items()
        }
        return response.status, response.read(), response_headers


def get_json(url: str, *, headers: dict[str, str] | None = None) -> tuple[int, Any]:
    status, body, _ = request(url, headers=headers)
    return status, json.loads(body.decode("utf-8"))


def wait_http(name: str, url: str, attempts: int = 40, delay: float = 3.0) -> bytes:
    last_error: Exception | None = None
    for _ in range(attempts):
        try:
            status, body, _ = request(url)
            if 200 <= status < 300:
                print(f"PASS {name}: HTTP {status}")
                return body
            last_error = RuntimeError(f"HTTP {status}")
        except (OSError, ValueError, urllib.error.URLError) as error:
            last_error = error
        time.sleep(delay)
    raise RuntimeError(f"{name} 未就绪：{last_error}")


def prometheus_query(expression: str) -> list[dict[str, Any]]:
    query = urllib.parse.urlencode({"query": expression})
    _, payload = get_json(f"http://127.0.0.1:9090/api/v1/query?{query}")
    if payload.get("status") != "success":
        raise RuntimeError(f"Prometheus 查询失败：{expression}")
    return payload.get("data", {}).get("result", [])


def wait_for_prometheus_targets(attempts: int = 30, delay: float = 3.0) -> None:
    last_unhealthy: list[dict[str, Any]] = []
    for _ in range(attempts):
        _, payload = get_json("http://127.0.0.1:9090/api/v1/targets")
        targets = payload.get("data", {}).get("activeTargets", [])
        last_unhealthy = [target for target in targets if target.get("health") != "up"]
        if len(targets) >= 12 and not last_unhealthy:
            print(f"PASS Prometheus targets: total={len(targets)} up={len(targets)}")
            return
        time.sleep(delay)
    details = [
        {
            "scrapeUrl": target.get("scrapeUrl"),
            "health": target.get("health"),
            "lastError": target.get("lastError"),
        }
        for target in last_unhealthy
    ]
    raise RuntimeError(f"Prometheus target 未全部 UP：{json.dumps(details, ensure_ascii=False)}")


def wait_for_prometheus_query(expression: str, attempts: int = 30, delay: float = 3.0) -> bool:
    """等到某个 PromQL 有有效样本为止。

    为什么需要（2026-10-02 裸机演练实测）：
      容器刚重启时，"target 抓取成功"与"就绪指标已是 1"之间有时延 ——
      首次抓取可能拿到 readiness=0。原先直接取瞬时值，于是报出
        FAIL Prometheus 查询没有有效样本：go_user_system_readiness == 1
      而同一时刻 "Auth readiness: HTTP 200"。那是时序竞争，不是故障。

    断言语义不变（这一项确实必须成立），只是**等它成立**而不是抓瞬间。
    """
    for _ in range(attempts):
        if prometheus_query(expression):
            return True
        time.sleep(delay)
    return False


def grafana_auth_headers(values: dict[str, str]) -> dict[str, str]:
    """用 .env.observability 里的管理员凭据构造 Basic Auth。"""
    basic = base64.b64encode(
        f"{values.get('GRAFANA_ADMIN_USER', 'admin')}:{values.get('GRAFANA_ADMIN_PASSWORD', '')}".encode()
    ).decode()
    return {"Authorization": f"Basic {basic}"}


GRAFANA_AUTH_HINT = """Grafana 拒绝了 .env.observability 里的管理员凭据（HTTP {code}）。
这几乎总是**凭据漂移**，而不是 Grafana 坏了：
  Grafana 的 GF_SECURITY_ADMIN_PASSWORD **只在数据卷为空时生效**；
  一旦 grafana.db 存在，密码就以库里的值为准，环境变量不再覆盖它。
  所以如果 .env.observability 是**后来**重新生成的（例如重跑
  init-observability-env.sh），它的密码与容器里的就永远不会一致。

  注意：Dashboard 与 Datasource 的 provisioning 是**文件驱动**的，
  不受此影响——「验不了」不等于「坏了」。

  诊断：python3 scripts/linux/verify-observability.py --check-grafana-auth
  修复（会重置 grafana.db，先确认卷里没有要保留的手工面板）：
    docker compose ... stop grafana
    docker volume rm knowtrace_grafana_data
    docker compose ... up -d grafana
"""


def grafana_auth_failure_message(error: urllib.error.HTTPError) -> str:
    if error.code in (401, 403):
        return GRAFANA_AUTH_HINT.format(code=error.code)
    return f"Grafana API 请求失败：HTTP {error.code}"


def check_grafana_auth(values: dict[str, str]) -> int:
    """只检查 Grafana 凭据，不改动任何东西。"""
    headers = grafana_auth_headers(values)
    try:
        status, _ = get_json("http://127.0.0.1:3001/api/search?query=KnowTrace", headers=headers)
    except urllib.error.HTTPError as error:
        print(f"FAIL {grafana_auth_failure_message(error)}", file=sys.stderr)
        return 1
    except urllib.error.URLError as error:
        print(f"FAIL Grafana 不可达：{error}", file=sys.stderr)
        return 1
    print(f"PASS Grafana admin 凭据可用（HTTP {status}）")
    return 0


def verify_core(values: dict[str, str]) -> None:
    wait_http("KnowTrace liveness", "http://127.0.0.1:3000/api/health/live")
    wait_http("KnowTrace readiness", "http://127.0.0.1:3000/api/health/ready")
    wait_http("Auth readiness", "http://127.0.0.1:8082/readyz")
    wait_http("Prometheus", "http://127.0.0.1:9090/-/ready")
    wait_http("Alertmanager", "http://127.0.0.1:9093/-/ready")
    wait_http("Grafana", "http://127.0.0.1:3001/api/health")

    metrics_token = values.get("METRICS_BEARER_TOKEN", "")
    status, body, headers = request(
        "http://127.0.0.1:3000/api/metrics",
        headers={"Authorization": f"Bearer {metrics_token}"},
    )
    metrics_text = body.decode("utf-8", errors="replace")
    if status != 200 or "knowtrace_build_info" not in metrics_text:
        raise RuntimeError("主应用受保护 metrics 端点缺少预期指标")
    if "text/plain" not in headers.get("content-type", ""):
        raise RuntimeError("主应用 metrics Content-Type 不正确")
    print("PASS KnowTrace protected metrics endpoint")

    try:
        request("http://127.0.0.1:8080/api/metrics")
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
    else:
        raise RuntimeError("Nginx 公网代理层没有屏蔽 /api/metrics")
    print("PASS Nginx blocks public metrics path with 404")

    wait_for_prometheus_targets()
    # 前三项取瞬时值即可（它们不随容器重启而短暂为 0）；
    # 后两项依赖容器内部状态 —— 容器刚重启时可能还没到就绪，故等到成立为止。
    for expression in (
        "knowtrace_build_info",
        "knowtrace_database_ready == 1",
    ):
        if not prometheus_query(expression):
            raise RuntimeError(f"Prometheus 查询没有有效样本：{expression}")
        print(f"PASS PromQL: {expression}")

    for expression in (
        "go_user_system_readiness == 1",
        'probe_success{job="knowtrace-http-public"} == 1',
    ):
        if not wait_for_prometheus_query(expression):
            raise RuntimeError(
                f"Prometheus 查询在等待 90 秒后仍无有效样本：{expression}"
                "（若 HTTP 端点已 200，多半是抓取间隔或指标写入未完成）"
            )
        print(f"PASS PromQL: {expression}")

    # 备份指标单独判：**首次部署时它必然为 0**（备份 timer 要到当晚才跑），
    # 那不是故障。真正的故障是「本地有归档、而指标仍是 0」——指标准入坏了。
    # 2026-10-02 裸机演练实测：原先无条件要求 >= 1，新机器上直接假失败，
    # 把整条一键部署链卡在 monitoring 阶段。
    if prometheus_query("knowtrace_backup_archive_count >= 1"):
        print("PASS PromQL: knowtrace_backup_archive_count >= 1")
    else:
        backup_root = os.environ.get("BACKUP_ROOT", "/var/backups/knowtrace")
        archives = []
        try:
            archives = [
                name for name in os.listdir(backup_root) if name.endswith(".tar.gz")
            ]
        except OSError:
            archives = []
        if archives:
            raise RuntimeError(
                f"本地有 {len(archives)} 个备份归档，但 knowtrace_backup_archive_count 为 0"
                " —— 备份指标写入链路有问题（检查 write-backup-metrics.sh 与 node-exporter 的 textfile 目录）"
            )
        print(
            "PASS PromQL: 尚无备份归档（首次部署的正常状态；"
            "knowtrace-backup.timer 触发后本项会转为 >= 1）"
        )

    _, alertmanagers = get_json("http://127.0.0.1:9090/api/v1/alertmanagers")
    active = alertmanagers.get("data", {}).get("activeAlertmanagers", [])
    if not active:
        raise RuntimeError("Prometheus 未发现 active Alertmanager")
    print(f"PASS Prometheus to Alertmanager discovery: active={len(active)}")

    grafana_headers = grafana_auth_headers(values)
    try:
        _, dashboards = get_json(
            "http://127.0.0.1:3001/api/search?query=KnowTrace%20VPS",
            headers=grafana_headers,
        )
    except urllib.error.HTTPError as error:
        raise RuntimeError(grafana_auth_failure_message(error)) from error
    if not any(item.get("uid") == "knowtrace-vps-overview" for item in dashboards):
        raise RuntimeError("Grafana 没有加载 KnowTrace VPS dashboard")
    print("PASS Grafana provisioned dashboard: knowtrace-vps-overview")

    try:
        _, datasource = get_json(
            "http://127.0.0.1:3001/api/datasources/uid/prometheus",
            headers=grafana_headers,
        )
    except urllib.error.HTTPError as error:
        raise RuntimeError(grafana_auth_failure_message(error)) from error
    if datasource.get("url") != "http://prometheus:9090":
        raise RuntimeError("Grafana Prometheus datasource 配置不正确")
    print("PASS Grafana provisioned Prometheus datasource")


def send_verification_log() -> str:
    """往 Alloy 的 Loki push 入口投递一条测试事件。

    ⚠️ 协议与旧的 Logstash 不同：Alloy 的 `loki.source.api` 收的是
    **Loki push JSON**（`{"streams":[{"stream":{...},"values":[[ns,line],...]}]}`），
    不是原来的 NDJSON。照抄旧格式会**静默投递失败**（HTTP 4xx），
    所以这里按 Loki 协议构造，并检查响应码。
    """
    event_id = f"plg-{int(time.time())}"
    line = json.dumps(
        {"event_id": event_id, "level": "INFO",
         "message": "KnowTrace PLG verification event",
         "verification_source": "scripts/linux/verify-observability.py"},
        ensure_ascii=False,
    )
    payload = {
        "streams": [{
            "stream": {"job": "external", "source": "verify-observability"},
            "values": [[str(time.time_ns()), line]],
        }]
    }
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        "http://127.0.0.1:5000/loki/api/v1/push",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    # 204 是 Loki push 的正常返回
    with urllib.request.urlopen(request, timeout=8) as response:
        if response.status not in (200, 204):
            raise RuntimeError(f"Alloy push 返回 {response.status}（期望 204）")
    print(f"PASS Alloy Loki push accepted verification event: {event_id}")
    return event_id


def wait_for_log_event(event_id: str, attempts: int = 45, delay: float = 3.0) -> None:
    """在 Loki 里等刚才那条事件可查回（LogQL）。

    这一条才是"日志链路真的通了"的判据 —— 只探 /ready 只能证明进程活着，
    证明不了"投递→存储→可查"这段。
    """
    now = int(time.time())
    params = urllib.parse.urlencode({
        "query": f'{{job="external"}} |= "{event_id}"',
        "start": str((now - 900) * 10**9),
        "end": str((now + 60) * 10**9),
        "limit": "10",
    })
    url = f"http://127.0.0.1:3100/loki/api/v1/query_range?{params}"
    for _ in range(attempts):
        try:
            _, payload = get_json(url)
            streams = payload.get("data", {}).get("result", [])
            hits = sum(len(st.get("values", [])) for st in streams)
            if hits >= 1:
                print(f"PASS Loki LogQL query: hits={hits} event_id={event_id}")
                return
        except (OSError, ValueError, urllib.error.URLError):
            pass
        time.sleep(delay)
    raise RuntimeError(f"Loki 中未找到验证事件：{event_id}")


def verify_logs() -> None:
    """验证 PLG 日志栈（替代原先的 ELK 验证）。"""
    wait_http("Loki", "http://127.0.0.1:3100/ready")

    # 容器日志这一路最容易漏：ELK 原来收全部容器日志，漏掉后表现是
    # "容器起来了、Grafana 里日志是空的"。所以显式断言能查到容器日志。
    _, payload = get_json(
        "http://127.0.0.1:3100/loki/api/v1/query_range?"
        + urllib.parse.urlencode({
            "query": '{container=~".+"}',
            "start": str((int(time.time()) - 3600) * 10**9),
            "end": str((int(time.time()) + 60) * 10**9),
            "limit": "5",
        })
    )
    streams = payload.get("data", {}).get("result", [])
    if not streams:
        raise RuntimeError(
            'Loki 里查不到任何容器日志（{container=~".+"}）——'
            "Alloy 的容器日志采集未生效（检查 docker.sock 挂载与 discovery.relabel）"
        )
    containers = sorted({st.get("stream", {}).get("container", "?") for st in streams})
    print(f"PASS Loki 收到容器日志：{len(streams)} 条流，示例容器 {containers[:3]}")

    # 投递一条测试事件并等它可查回 —— 端到端判据
    wait_for_log_event(send_verification_log())

    # Grafana 里必须能看到 Loki 数据源（provisioning 生效）
    environment = PROJECT_DIRECTORY / ".env.observability"
    values = read_env(environment)
    headers = grafana_auth_headers(values)
    try:
        _, ds = get_json("http://127.0.0.1:3001/api/datasources", headers=headers)
    except urllib.error.HTTPError as error:
        raise RuntimeError(grafana_auth_failure_message(error)) from error
    if not any(d.get("type") == "loki" for d in ds):
        raise RuntimeError("Grafana 未加载 Loki 数据源（检查 provisioning/datasources/loki.yml）")
    print("PASS Grafana provisioned Loki datasource")


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify KnowTrace stage-three observability")
    parser.add_argument("--core", action="store_true", help="verify metrics, Grafana and Alertmanager")
    parser.add_argument("--logs", action="store_true", help="verify PLG log pipeline (Loki + Alloy)")
    parser.add_argument(
        "--check-grafana-auth",
        action="store_true",
        help="只检查 Grafana 管理员凭据是否可用，不做任何改动",
    )
    args = parser.parse_args()
    if args.check_grafana_auth:
        # 单独模式：不做其它检查，只回答「凭据能不能用」。
        environment = PROJECT_DIRECTORY / ".env.observability"
        if not environment.exists():
            print(f"FAIL 缺少 {environment}", file=sys.stderr)
            return 1
        return check_grafana_auth(read_env(environment))

    if not args.core and not args.logs:
        parser.error("至少指定 --core 或 --logs")

    environment_path = PROJECT_DIRECTORY / ".env.observability"
    if not environment_path.exists():
        print(f"FAIL 缺少 {environment_path}", file=sys.stderr)
        return 1
    values = read_env(environment_path)

    try:
        if args.core:
            verify_core(values)
        if args.logs:
            verify_logs()
    except (OSError, ValueError, RuntimeError, urllib.error.URLError) as error:
        print(f"FAIL {error}", file=sys.stderr)
        return 1

    print("RESULT all requested observability checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
