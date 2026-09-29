#!/usr/bin/env bash
set -Eeuo pipefail
# ============================================================================
# 把巡检结论写成 Node Exporter textfile 指标（供 Prometheus 告警）
# ============================================================================
#
# 解决的断裂：daily-ops / weekly-check / monthly-ops 三个巡检脚本跑完后，
# 只会把结论写进 REPORTS_DIR 里的一份 Markdown/JSON。而没人定时看那个目录 ——
# 所以「巡检发现 FAIL」这件事传导不到任何人。
#
# 本脚本读最新的报告 JSON，把结论转成指标，接进项目既有的告警链路：
#
#   巡检脚本 → 报告 JSON → 本脚本 → textfile 指标 → node-exporter
#            → Prometheus 规则(KnowTraceOpsCheck*) → Alertmanager → 邮件
#
# 由三个 .service 的 ExecStartPost 调用（见 systemd/ 下的单元）。
#
# 用法:
#   scripts/linux/write-ops-metrics.sh [--reports-dir <目录>] [--out <目录>]
#
# 退出码: 0 成功（包括「没有报告」这种正常情况）  3 脚本自身错误
# ============================================================================

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
project_directory="${PROJECT_DIR:-$(cd -- "$script_directory/../.." && pwd -P)}"

reports_directory=""
output_directory=""

while (( $# )); do
  case "$1" in
    --reports-dir) reports_directory="${2:-}"; shift 2 ;;
    --reports-dir=*) reports_directory="${1#*=}"; shift ;;
    --out) output_directory="${2:-}"; shift 2 ;;
    --out=*) output_directory="${1#*=}"; shift ;;
    --help|-h) sed -n '2,22p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "错误：未知参数 $1" >&2; exit 3 ;;
  esac
done

# 与 ops.conf 的默认值保持一致；不读 ops.conf 是为了保持本脚本零依赖。
[[ -n "$reports_directory" ]] || reports_directory="/var/lib/knowtrace/reports"
[[ -n "$output_directory" ]]  || output_directory="$project_directory/runtime/node-exporter"

if (( EUID != 0 )); then
  exec sudo -- "$0" "$@"
fi

command -v python3 >/dev/null || { echo "错误：缺少命令 python3" >&2; exit 3; }
[[ -d "$reports_directory" ]] || { echo "错误：报告目录不存在：$reports_directory" >&2; exit 3; }

install -d -m 755 "$output_directory"
output_path="$output_directory/knowtrace-ops.prom"
temporary_path="$(mktemp "$output_directory/.knowtrace-ops.XXXXXX")"
trap 'rm -f -- "$temporary_path"' EXIT

python3 - "$reports_directory" >"$temporary_path" <<'PY'
from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

reports_directory = Path(sys.argv[1])

# worst 结论 → 数值级别。INFO 不参与 worst，但保留映射以防将来出现。
LEVELS = {"ok": 0, "info": 1, "warn": 2, "fail": 3, "unknown": -1}

# 只关心这三个巡检脚本的报告；文件名形如 <script>-<UTC时间戳>.json
WATCHED = ("daily-ops", "weekly-check", "monthly-ops")

latest: dict[str, tuple[float, Path]] = {}

for path in reports_directory.glob("*.json"):
    # 从文件名取脚本名与时间戳（比读文件内容快，且能在文件损坏时仍定位）
    match = re.fullmatch(r"(.+)-(\d{8}T\d{6}Z)\.json", path.name)
    if not match:
        continue
    script_name, stamp = match.group(1), match.group(2)
    if script_name not in WATCHED:
        continue
    try:
        when = datetime.strptime(stamp, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc).timestamp()
    except ValueError:
        continue
    if script_name not in latest or when > latest[script_name][0]:
        latest[script_name] = (when, path)

lines: list[str] = []


def emit(name: str, help_text: str, samples: list[str]) -> None:
    if not samples:
        return
    lines.append(f"# HELP {name} {help_text}")
    lines.append(f"# TYPE {name} gauge")
    lines.extend(samples)


timestamp_samples: list[str] = []
level_samples: list[str] = []
fail_samples: list[str] = []
warn_samples: list[str] = []

for script_name in WATCHED:
    if script_name not in latest:
        # 没有报告 = 从没跑过。不输出该 script 的样本，
        # 让 Prometheus 侧的 absent() 能把「从未运行」识别出来。
        continue

    when, path = latest[script_name]
    try:
        report = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        # 报告损坏：时间戳照报（说明跑过），但结论记为 unknown
        timestamp_samples.append(f'knowtrace_ops_report_timestamp_seconds{{script="{script_name}"}} {when:.0f}')
        level_samples.append(f'knowtrace_ops_report_worst_level{{script="{script_name}"}} {LEVELS["unknown"]}')
        continue

    worst = str(report.get("worst", "unknown")).strip().lower()
    counts = report.get("counts") or {}
    label = f'{{script="{script_name}"}}'

    timestamp_samples.append(f"knowtrace_ops_report_timestamp_seconds{label} {when:.0f}")
    level_samples.append(f"knowtrace_ops_report_worst_level{label} {LEVELS.get(worst, -1)}")
    fail_samples.append(f"knowtrace_ops_report_fail_count{label} {int(counts.get('fail', 0) or 0)}")
    warn_samples.append(f"knowtrace_ops_report_warn_count{label} {int(counts.get('warn', 0) or 0)}")

emit(
    "knowtrace_ops_report_timestamp_seconds",
    "Unix timestamp of the newest inspection report per script.",
    timestamp_samples,
)
emit(
    "knowtrace_ops_report_worst_level",
    "Worst conclusion of the newest report: 0=OK 1=INFO 2=WARN 3=FAIL -1=unknown.",
    level_samples,
)
emit(
    "knowtrace_ops_report_fail_count",
    "Number of FAIL findings in the newest report.",
    fail_samples,
)
emit(
    "knowtrace_ops_report_warn_count",
    "Number of WARN findings in the newest report.",
    warn_samples,
)
PY

if [[ ! -s "$temporary_path" ]]; then
  # 一条样本都没有：写下空文件（清掉旧指标），但仍算成功。
  # 若报告从未生成，Prometheus 侧的 absent() 会报「巡检从未运行」。
  : >"$temporary_path"
fi

chmod 644 "$temporary_path"
mv -f -- "$temporary_path" "$output_path"
trap - EXIT
echo "已更新巡检结论指标：$output_path"
