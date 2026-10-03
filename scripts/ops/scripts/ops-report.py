#!/usr/bin/env python3
"""巡检报告汇总（KnowTrace-Workflow 运维工具包）。

作用
----
daily-check.sh / weekly-check.sh / monthly-ops.sh 各自会写出 ``knowtrace-ops/1``
格式的 JSON 报告。本脚本把这些报告读回来，回答月度运维真正关心的问题：

* 过去一段时间里，哪一类检查反复失败（按 check 聚合，而不是按日期罗列）；
* 哪些检查已经「过期」——超出它的执行周期还没有新报告（说明定时任务停了）；
* FAIL/WARN 的趋势是变好还是变差。

为什么用 Python
---------------
这是纯粹的「读数据 → 聚合 → 比较 → 输出」任务，Bash 里用 jq 拼装会非常难维护。
本项目已有 jq，但跨多份 JSON 做分组统计、时间窗比较，Python 明显更清楚。

安全性说明
----------
* 只读报告目录，不删除、不移动任何报告。
* 只读取 ``findings`` 里的 ``check`` / ``level`` / ``message``；报告本身已保证
  不含密钥，本脚本也不额外读取 .env 或日志内容。
* 缺失报告时明确报「没有数据」，不会把「没有报告」当成「一切正常」。

退出码：0=无异常  1=存在 WARN  2=存在 FAIL  3=脚本自身错误
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from ops_common import (  # noqa: E402
    EXIT_ERROR,
    Report,
    add_common_arguments,
    emit_reports,
    environment_summary,
    load_ops_conf,
    parse_timestamp,
    seconds_to_human,
)

# 每类巡检的期望周期（秒）。用于判断「报告是不是已经过期」。
DEFAULT_CADENCE = {
    "daily-check": 86400,
    "weekly-check": 7 * 86400,
    "monthly-ops": 31 * 86400,
}

_LEVEL_RANK = {"FAIL": 3, "WARN": 2, "OK": 1, "INFO": 0}


@dataclass
class LoadedReport:
    path: Path
    script: str
    generated_at: datetime | None
    worst: str
    counts: dict[str, int]
    findings: list[dict]
    unreadable: str = ""


@dataclass
class ScriptSummary:
    script: str
    reports: list[LoadedReport] = field(default_factory=list)

    @property
    def latest(self) -> LoadedReport | None:
        dated = [item for item in self.reports if item.generated_at]
        if not dated:
            return self.reports[-1] if self.reports else None
        return max(dated, key=lambda item: item.generated_at)  # type: ignore[arg-type,return-value]

    def age_seconds(self, now: datetime) -> float | None:
        latest = self.latest
        if latest is None or latest.generated_at is None:
            return None
        return (now - latest.generated_at).total_seconds()


def _load_one(path: Path) -> LoadedReport:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        return LoadedReport(path, "unknown", None, "unknown", {}, [], unreadable=str(error))

    if not isinstance(payload, dict) or payload.get("schema") != "knowtrace-ops/1":
        return LoadedReport(path, "unknown", None, "unknown", {}, [], unreadable="格式不符（schema 不是 knowtrace-ops/1）")

    findings = payload.get("findings")
    if not isinstance(findings, list):
        findings = []

    return LoadedReport(
        path=path,
        script=str(payload.get("script", path.stem)),
        generated_at=parse_timestamp(str(payload.get("generated_at", ""))),
        worst=str(payload.get("worst", "unknown")),
        counts=payload.get("counts") or {},
        findings=[item for item in findings if isinstance(item, dict)],
    )


def discover(reports_dir: Path, lookback_days: int) -> tuple[dict[str, ScriptSummary], list[str]]:
    # 注意：不要用 defaultdict(ScriptSummary)——defaultdict 调用工厂函数时不传 key，
    # 而 ScriptSummary.script 是必填字段，会直接 TypeError。
    # 这里先按 script 名聚合报告列表，再显式构造 ScriptSummary。
    grouped: dict[str, list[LoadedReport]] = defaultdict(list)
    problems: list[str] = []

    if not reports_dir.is_dir():
        return {}, [f"报告目录不存在: {reports_dir}"]

    cutoff = datetime.now(timezone.utc) - timedelta(days=lookback_days)

    for path in sorted(reports_dir.glob("*.json")):
        loaded = _load_one(path)
        if loaded.unreadable:
            problems.append(f"{path.name}: {loaded.unreadable}")
            continue
        if loaded.generated_at and loaded.generated_at < cutoff:
            continue
        grouped[loaded.script].append(loaded)

    summaries: dict[str, ScriptSummary] = {}
    for script, reports in grouped.items():
        reports.sort(
            key=lambda item: item.generated_at or datetime.min.replace(tzinfo=timezone.utc)
        )
        summaries[script] = ScriptSummary(script=script, reports=reports)

    return summaries, problems


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="ops-report.py",
        description="汇总 KnowTrace-Workflow 巡检报告（只读）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "示例:\n"
            "  ./scripts/ops-report.py --reports-dir /var/lib/knowtrace/reports\n"
            "  ./scripts/ops-report.py --markdown /var/log/knowtrace-logs/2026-09-汇总.md\n"
        ),
    )
    parser.add_argument("--reports-dir", default=None, help="报告目录（默认取 ops.conf 的 REPORTS_DIR）")
    parser.add_argument("--lookback-days", type=int, default=0, help="回看天数（默认取 ops.conf）")
    add_common_arguments(parser)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    conf = load_ops_conf(args.conf)
    reports_dir = Path(
        args.reports_dir or conf.get("REPORTS_DIR", "/var/lib/knowtrace/reports")
    )
    lookback = args.lookback_days or conf.get_int("REPORT_LOOKBACK_DAYS", 40)
    stale_factor = conf.get_int("REPORT_STALE_FACTOR", 2) or 2

    now = datetime.now(timezone.utc)
    report = Report(
        script="ops_report",
        title="KnowTrace-Workflow 巡检报告汇总",
        quiet=args.quiet,
        no_color=args.no_color,
        extra_meta=environment_summary(),
    )

    report.heading(f"{report.title}  目录={reports_dir}  回看={lookback} 天")

    summaries, problems = discover(reports_dir, lookback)

    # ---- 1. 报告读取情况 --------------------------------------------------
    report.section("1. 报告读取")
    if problems:
        report.warn("report.unreadable", f"{len(problems)} 份报告无法解析，已跳过")
        for item in problems[:10]:
            report.note(f"  - {item}")
    total_reports = sum(len(item.reports) for item in summaries.values())
    if total_reports == 0:
        report.fail(
            "report.empty",
            f"在 {reports_dir} 中没有找到 {lookback} 天内的 knowtrace-ops/1 报告；"
            "巡检闭环尚未建立，本汇总没有素材",
        )
    else:
        report.ok("report.loaded", f"读取到 {total_reports} 份报告，覆盖 {len(summaries)} 类巡检")

    # ---- 2. 各周期巡检的新鲜度 -------------------------------------------
    report.section("2. 巡检周期新鲜度")
    if summaries:
        rows: list[list[str]] = []
        for script in sorted(summaries):
            summary = summaries[script]
            cadence = DEFAULT_CADENCE.get(script, 7 * 86400)
            age = summary.age_seconds(now)
            latest = summary.latest
            if age is None:
                rows.append([script, "-", "无法确定时间", "?"])
                continue
            limit = cadence * stale_factor
            if age > limit:
                state = "过期"
                report.fail(
                    f"cadence.{script}",
                    f"{script} 最近一次报告在 {seconds_to_human(age)}前（周期 {seconds_to_human(cadence)}，"
                    f"容忍 {stale_factor} 倍），定时任务可能已经停了",
                )
            elif age > cadence * 1.2:
                state = "略滞后"
                report.warn(
                    f"cadence.{script}",
                    f"{script} 最近一次报告在 {seconds_to_human(age)}前，超过周期 {seconds_to_human(cadence)}",
                )
            else:
                state = "正常"
                report.ok(f"cadence.{script}", f"{script} 最近报告 {seconds_to_human(age)}前（{latest.worst if latest else '?'}）")
            rows.append([script, seconds_to_human(age) + "前", str(len(summary.reports)), state])
        report.table(["巡检类型", "最近一次", "报告数", "状态"], rows)
    else:
        report.note("没有可用报告，跳过新鲜度判断。")

    # ---- 3. 按检查项聚合：反复失败的是哪些 -------------------------------
    report.section("3. 反复失败的检查项（按次数排序）")
    by_check: dict[str, Counter] = defaultdict(Counter)
    last_message: dict[str, str] = {}
    for summary in summaries.values():
        for loaded in summary.reports:
            for finding in loaded.findings:
                level = str(finding.get("level", "")).upper()
                if level not in ("FAIL", "WARN"):
                    continue
                key = str(finding.get("check", "unknown"))
                by_check[key][level] += 1
                last_message[key] = str(finding.get("message", ""))

    recurring = sorted(
        by_check.items(),
        key=lambda item: (-item[1].get("FAIL", 0), -item[1].get("WARN", 0), item[0]),
    )
    if not recurring:
        report.ok("recurring.none", f"{lookback} 天内没有任何 FAIL/WARN 记录")
    else:
        rows = [
            [key, str(counts.get("FAIL", 0)), str(counts.get("WARN", 0)), last_message.get(key, "")[:80]]
            for key, counts in recurring[:15]
        ]
        report.table(["检查项", "FAIL 次数", "WARN 次数", "最近一次说明"], rows)

        chronic = [key for key, counts in recurring if counts.get("FAIL", 0) >= 3]
        if chronic:
            report.warn(
                "recurring.chronic",
                f"{len(chronic)} 个检查项出现 ≥3 次 FAIL，属于长期未解决问题："
                + "、".join(chronic[:5]),
            )

    # ---- 4. 各巡检类型的最新结论 -----------------------------------------
    report.section("4. 各类巡检的最新结论")
    if summaries:
        rows = []
        for script in sorted(summaries):
            latest = summaries[script].latest
            if latest is None:
                continue
            when = latest.generated_at.strftime("%Y-%m-%d %H:%M") if latest.generated_at else "-"
            counts = latest.counts or {}
            rows.append([
                script,
                when,
                latest.worst,
                f"F{counts.get('fail', 0)}/W{counts.get('warn', 0)}",
            ])
            if latest.worst == "FAIL":
                report.fail(f"latest.{script}", f"{script} 最新一次结论是 FAIL（{when}）")
        report.table(["巡检类型", "生成时间(UTC)", "结论", "FAIL/WARN"], rows)

    # ---- 5. 结论 ----------------------------------------------------------
    report.section("5. 汇总结论")
    if not summaries:
        report.fail("summary", "没有任何报告可以汇总")
    elif report.count("FAIL") == 0 and report.count("WARN") == 0:
        report.ok("summary", f"{lookback} 天内各期巡检均无失败，且报告新鲜")
    else:
        report.note(
            "本汇总只反映「报告里写了什么」。报告过期或定时任务未挂载时，"
            "这里会显示 FAIL —— 这正是它和「一切正常」的区别。"
        )

    code = report.finish()
    emit_reports(report, args, command="ops-report.py --reports-dir <dir>")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
