#!/usr/bin/env python3
"""Bounded, read-only HTTP baseline for KnowTrace health endpoints."""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import math
import os
import platform
import statistics
import sys
import time
import urllib.error
import urllib.request
from collections import Counter
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path


MAX_REQUESTS = 5_000
MAX_CONCURRENCY = 50


@dataclass(frozen=True)
class Sample:
    status: int | None
    elapsed_ms: float
    bytes_read: int
    error: str | None


def bounded_int(name: str, minimum: int, maximum: int):
    def parse(value: str) -> int:
        parsed = int(value)
        if not minimum <= parsed <= maximum:
            raise argparse.ArgumentTypeError(
                f"{name} must be between {minimum} and {maximum}"
            )
        return parsed

    return parse


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Run a bounded GET-only baseline. Use a health/read endpoint; "
            "this tool intentionally cannot send write requests."
        )
    )
    parser.add_argument("url", help="HTTP(S) health or read-only URL")
    parser.add_argument(
        "--requests",
        type=bounded_int("requests", 1, MAX_REQUESTS),
        default=200,
    )
    parser.add_argument(
        "--concurrency",
        type=bounded_int("concurrency", 1, MAX_CONCURRENCY),
        default=5,
    )
    parser.add_argument(
        "--timeout",
        type=bounded_int("timeout", 1, 60),
        default=10,
        help="Per-request timeout in seconds",
    )
    parser.add_argument("--expect-status", type=int, default=200)
    parser.add_argument("--output", type=Path, help="Optional JSON result path")
    args = parser.parse_args()
    if not args.url.startswith(("http://", "https://")):
        parser.error("url must start with http:// or https://")
    if args.concurrency > args.requests:
        parser.error("concurrency cannot exceed requests")
    return args


def percentile(sorted_values: list[float], percent: float) -> float:
    if not sorted_values:
        return 0.0
    index = max(0, math.ceil((percent / 100) * len(sorted_values)) - 1)
    return sorted_values[index]


def fetch(url: str, timeout: int) -> Sample:
    request = urllib.request.Request(
        url,
        method="GET",
        headers={
            "Accept": "application/json,text/plain,*/*",
            "Cache-Control": "no-cache",
            "User-Agent": "KnowTrace-Stage2-Baseline/1.0",
        },
    )
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read()
            return Sample(
                status=response.status,
                elapsed_ms=(time.perf_counter() - started) * 1000,
                bytes_read=len(body),
                error=None,
            )
    except urllib.error.HTTPError as exc:
        body = exc.read()
        return Sample(
            status=exc.code,
            elapsed_ms=(time.perf_counter() - started) * 1000,
            bytes_read=len(body),
            error=f"HTTPError: {exc.reason}",
        )
    except Exception as exc:  # Network failures vary by platform and resolver.
        return Sample(
            status=None,
            elapsed_ms=(time.perf_counter() - started) * 1000,
            bytes_read=0,
            error=f"{type(exc).__name__}: {exc}",
        )


def main() -> int:
    args = parse_args()
    started_at = datetime.now(timezone.utc)
    wall_started = time.perf_counter()

    with concurrent.futures.ThreadPoolExecutor(
        max_workers=args.concurrency
    ) as executor:
        futures = [
            executor.submit(fetch, args.url, args.timeout)
            for _ in range(args.requests)
        ]
        samples = [future.result() for future in concurrent.futures.as_completed(futures)]

    wall_seconds = time.perf_counter() - wall_started
    latencies = sorted(sample.elapsed_ms for sample in samples)
    statuses = Counter(
        str(sample.status) if sample.status is not None else "network_error"
        for sample in samples
    )
    failures = [
        sample
        for sample in samples
        if sample.status != args.expect_status or sample.error is not None
    ]
    error_examples = list(dict.fromkeys(sample.error for sample in failures if sample.error))[:5]

    result = {
        "schema_version": 1,
        "started_at_utc": started_at.isoformat(),
        "finished_at_utc": datetime.now(timezone.utc).isoformat(),
        "url": args.url,
        "method": "GET",
        "expected_status": args.expect_status,
        "requests": args.requests,
        "concurrency": args.concurrency,
        "timeout_seconds": args.timeout,
        "wall_seconds": round(wall_seconds, 6),
        "requests_per_second": round(args.requests / wall_seconds, 3),
        "status_counts": dict(sorted(statuses.items())),
        "failed_requests": len(failures),
        "bytes_read_total": sum(sample.bytes_read for sample in samples),
        "latency_ms": {
            "min": round(min(latencies), 3),
            "mean": round(statistics.fmean(latencies), 3),
            "p50": round(percentile(latencies, 50), 3),
            "p95": round(percentile(latencies, 95), 3),
            "p99": round(percentile(latencies, 99), 3),
            "max": round(max(latencies), 3),
        },
        "error_examples": error_examples,
        "client": {
            "python": platform.python_version(),
            "platform": platform.platform(),
            "proxy_environment_present": any(
                os.getenv(name)
                for name in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy")
            ),
        },
        "scope_note": (
            "This is a bounded health-endpoint baseline, not a business-flow, "
            "capacity, soak, or real-user result."
        ),
    }

    rendered = json.dumps(result, ensure_ascii=False, indent=2)
    print(rendered)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n", encoding="utf-8")

    return 0 if not failures else 2


if __name__ == "__main__":
    sys.exit(main())
