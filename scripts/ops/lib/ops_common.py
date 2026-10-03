#!/usr/bin/env python3
"""KnowTrace-Workflow 运维公共库 —— Python 自动化逻辑层。

定位
----
与 ``lib/ops-common.sh`` 对应：Bash 负责「操作系统层面的动作」，Python 负责
「复杂的判断、数据处理和自动化逻辑」。本模块只提供四件公共事：

1. 读取 ``ops.conf``（与 Bash 完全相同的解析规则和优先级）。
2. 统一的结论分级与退出码约定：``OK`` / ``WARN`` / ``FAIL`` / ``INFO``。
3. 统一的结果渲染：终端文本、JSON 报告、Markdown 报告。
4. 少量无副作用的工具函数（时间解析、大小格式化、只读子进程调用）。

设计约束
--------
* **只读**：本模块不提供任何写配置、删文件、重启服务的接口。
* **不泄露敏感值**：``read_env_file`` 只用于判断配置项的「存在 / 是否默认值」，
  调用方不得把值写进报告；需要展示时使用 :func:`mask_secret`。
* **不把推断写成结论**：没有实际验证的内容一律用 ``INFO``。

退出码约定（与 Bash 脚本一致）：

====  ==============================
0     未发现异常
1     存在 WARN
2     存在 FAIL
3     脚本自身错误（参数、环境、依赖）
====  ==============================
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import re
import shutil
import socket
import subprocess
import sys
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable, Sequence

__all__ = [
    "LEVELS",
    "LEVEL_ORDER",
    "Finding",
    "Section",
    "Report",
    "Table",
    "load_ops_conf",
    "read_env_file",
    "mask_secret",
    "parse_duration_seconds",
    "human_bytes",
    "utc_now",
    "utc_now_iso",
    "repo_root",
    "default_reports_dir",
    "run_readonly",
    "have_command",
    "add_common_arguments",
    "die",
    "EXIT_OK",
    "EXIT_WARN",
    "EXIT_FAIL",
    "EXIT_ERROR",
]

EXIT_OK = 0
EXIT_WARN = 1
EXIT_FAIL = 2
EXIT_ERROR = 3

LEVELS = ("OK", "WARN", "FAIL", "INFO")
LEVEL_ORDER = {"OK": 0, "INFO": 1, "WARN": 2, "FAIL": 3}


# ---------------------------------------------------------------------------
# 路径与配置
# ---------------------------------------------------------------------------


def repo_root() -> Path:
    """返回运维工具包根目录（本文件的上一级）。"""
    return Path(__file__).resolve().parent.parent


def default_reports_dir() -> Path:
    """默认报告目录；可用 OPS_REPORTS_DIR 覆盖。"""
    override = os.environ.get("OPS_REPORTS_DIR", "").strip()
    if override:
        return Path(override)
    return repo_root() / "reports"


@dataclass
class OpsConf:
    """``ops.conf`` 的解析结果。"""

    values: dict[str, str] = field(default_factory=dict)
    source: Path | None = None

    def get(self, key: str, fallback: str = "") -> str:
        value = self.values.get(key, "").strip()
        return value if value else fallback

    def get_int(self, key: str, fallback: int) -> int:
        raw = self.get(key, "")
        try:
            return int(raw)
        except (TypeError, ValueError):
            return fallback

    def get_float(self, key: str, fallback: float) -> float:
        raw = self.get(key, "")
        try:
            return float(raw)
        except (TypeError, ValueError):
            return fallback

    def get_list(self, key: str, fallback: Sequence[str] = ()) -> list[str]:
        raw = self.get(key, "")
        if not raw:
            return list(fallback)
        return [item for item in re.split(r"[\s,]+", raw) if item]


def _candidate_conf_paths(explicit: str | None) -> list[Path]:
    if explicit:
        return [Path(explicit)]
    candidates: list[Path] = []
    env_path = os.environ.get("OPS_CONF", "").strip()
    if env_path:
        candidates.append(Path(env_path))
    candidates.append(repo_root() / "ops.conf")
    candidates.append(Path("/etc/knowtrace/ops.conf"))
    return candidates


def load_ops_conf(explicit: str | None = None, *, required: bool = False) -> OpsConf:
    """加载 ``ops.conf``。

    解析规则刻意保守：只接受 ``KEY=VALUE``，不执行任何内容，不做变量展开，
    因此配置文件中即使出现字面量口令也不会被 shell 解释。
    """
    conf = OpsConf()
    for candidate in _candidate_conf_paths(explicit):
        if explicit and not candidate.is_file():
            die(f"--conf 指定的配置文件不存在: {candidate}")
        if not candidate.is_file():
            continue
        try:
            text = candidate.read_text(encoding="utf-8", errors="replace")
        except OSError as error:
            die(f"无法读取配置文件 {candidate}: {error}")
        for raw_line in text.splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip()
            if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
                continue
            if (
                len(value) >= 2
                and value[0] == value[-1]
                and value[0] in {'"', "'"}
            ):
                value = value[1:-1]
            conf.values[key] = value
        conf.source = candidate
        break

    if required and conf.source is None:
        die("未找到 ops.conf，请使用 --conf 指定或先在仓库根创建 ops.conf")

    return conf


def read_env_file(path: str | Path) -> dict[str, str]:
    """读取 dotenv 风格的键值对。

    ⚠ 返回值包含敏感内容。调用方必须只用于「是否设置 / 是否为占位值」判断，
    不得直接打印或写入报告。
    """
    values: dict[str, str] = {}
    env_path = Path(path)
    if not env_path.is_file():
        return values

    try:
        text = env_path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return values

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        if key:
            values[key] = value
    return values


def mask_secret(value: str, *, keep: int = 2) -> str:
    """把敏感值转成可安全打印的形式：``ab****``（只保留长度信息）。"""
    if not value:
        return "(空)"
    if len(value) <= keep:
        return "*" * len(value)
    return f"{value[:keep]}{'*' * min(len(value) - keep, 8)}（长度 {len(value)}）"


# ---------------------------------------------------------------------------
# 时间与格式化
# ---------------------------------------------------------------------------


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def utc_now_iso() -> str:
    return utc_now().strftime("%Y-%m-%dT%H:%M:%SZ")


_DURATION_UNITS = {
    "s": 1,
    "m": 60,
    "h": 3600,
    "d": 86400,
    "w": 604800,
}


def parse_duration_seconds(text: str, *, default: int = 86400) -> int:
    """把 ``24h`` / ``30m`` / ``7d`` / ``3600`` 解析成秒。"""
    raw = (text or "").strip().lower()
    if not raw:
        return default
    match = re.fullmatch(r"(\d+)\s*([smhdw]?)", raw)
    if not match:
        return default
    amount = int(match.group(1))
    unit = match.group(2) or "s"
    return amount * _DURATION_UNITS.get(unit, 1)


def human_bytes(size: float) -> str:
    """把字节数格式化成便于阅读的形式。"""
    try:
        value = float(size)
    except (TypeError, ValueError):
        return "unknown"
    units = ["B", "KiB", "MiB", "GiB", "TiB"]
    index = 0
    while abs(value) >= 1024 and index < len(units) - 1:
        value /= 1024.0
        index += 1
    if index == 0:
        return f"{int(value)} {units[index]}"
    return f"{value:.1f} {units[index]}"


def parse_timestamp(value: str) -> datetime | None:
    """尽力解析常见日志时间戳，失败返回 None（不猜测）。"""
    if not value:
        return None
    text = value.strip()
    # ISO8601，允许 Z 结尾和带时区偏移
    normalized = text.replace("Z", "+00:00") if text.endswith("Z") else text
    normalized = normalized.replace(",", ".")
    for candidate in (normalized, normalized[:19], normalized[:19] + "+00:00"):
        try:
            parsed = datetime.fromisoformat(candidate)
        except ValueError:
            continue
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)

    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y/%m/%d %H:%M:%S", "%d/%b/%Y:%H:%M:%S %z"):
        try:
            parsed = datetime.strptime(text[: len(fmt) + 6], fmt)
        except ValueError:
            continue
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    return None


# ---------------------------------------------------------------------------
# 结果模型
# ---------------------------------------------------------------------------


@dataclass
class Finding:
    level: str
    check: str
    message: str = ""
    details: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.level = self.level.upper()
        if self.level not in LEVELS:
            self.level = "INFO"


@dataclass
class Table:
    """报告中的一张表；Markdown 输出会渲染成表格。"""

    headers: list[str]
    rows: list[list[str]]

    def to_markdown(self) -> str:
        def cell(value: Any) -> str:
            text = str(value).replace("|", "\\|").replace("\n", " ")
            return text

        lines = [
            "| " + " | ".join(cell(h) for h in self.headers) + " |",
            "| " + " | ".join("---" for _ in self.headers) + " |",
        ]
        for row in self.rows:
            padded = list(row) + [""] * (len(self.headers) - len(row))
            lines.append("| " + " | ".join(cell(c) for c in padded) + " |")
        return "\n".join(lines)


@dataclass
class Section:
    title: str
    findings: list[Finding] = field(default_factory=list)
    tables: list[Table] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


_COLORS = {
    "OK": "\033[32m",
    "WARN": "\033[33m",
    "FAIL": "\033[31m",
    "INFO": "\033[36m",
    "TITLE": "\033[1m",
    "RESET": "\033[0m",
}


class Report:
    """统一的结果收集与渲染器。

    典型用法::

        report = Report(script="cert_check", title="TLS 证书有效期检查")
        with report.section("证书明细"):
            report.ok("cert.expiry", "knowtrace.duckdns.org 剩余 85 天")
        report.finish()
    """

    def __init__(
        self,
        *,
        script: str,
        title: str,
        quiet: bool = False,
        no_color: bool = False,
        extra_meta: dict[str, Any] | None = None,
    ) -> None:
        self.script = script
        self.title = title
        self.quiet = quiet
        self.no_color = no_color or bool(os.environ.get("NO_COLOR")) or not sys.stdout.isatty()
        self.sections: list[Section] = []
        self.extra_meta: dict[str, Any] = extra_meta or {}
        self.generated_at = utc_now_iso()
        self._current: Section | None = None

    # -- 收集 ---------------------------------------------------------------

    def section(self, title: str) -> "Report":
        self._current = Section(title=title)
        self.sections.append(self._current)
        return self

    def _ensure_section(self) -> Section:
        if self._current is None:
            self.section("检查结果")
        assert self._current is not None
        return self._current

    def add(self, level: str, check: str, message: str = "", **details: Any) -> Finding:
        finding = Finding(level=level, check=check, message=message, details=details)
        self._ensure_section().findings.append(finding)
        self._print(finding)
        return finding

    def ok(self, check: str, message: str = "", **details: Any) -> Finding:
        return self.add("OK", check, message, **details)

    def warn(self, check: str, message: str = "", **details: Any) -> Finding:
        return self.add("WARN", check, message, **details)

    def fail(self, check: str, message: str = "", **details: Any) -> Finding:
        return self.add("FAIL", check, message, **details)

    def info(self, check: str, message: str = "", **details: Any) -> Finding:
        return self.add("INFO", check, message, **details)

    def note(self, text: str) -> None:
        self._ensure_section().notes.append(text)
        if not self.quiet:
            print(f"       {text}")

    def table(self, headers: Sequence[str], rows: Iterable[Sequence[Any]]) -> None:
        normalized = [[str(cell) for cell in row] for row in rows]
        self._ensure_section().tables.append(
            Table(headers=list(headers), rows=normalized)
        )
        if not self.quiet:
            self._print_table(headers, normalized)

    # -- 渲染 ---------------------------------------------------------------

    def _color(self, key: str) -> str:
        return "" if self.no_color else _COLORS.get(key, "")

    def reset(self) -> str:
        return self._color("RESET")

    def _print(self, finding: Finding) -> None:
        # quiet 只保留 WARN/FAIL —— 与 lib/ops-common.sh 的 ops_record 保持同一套语义。
        # 这个模式的用途是把输出直接当告警邮件正文，所以 WARN 必须显示，
        # OK/INFO 才是该被压掉的噪声。
        if self.quiet and finding.level not in ("WARN", "FAIL"):
            return
        tag = f"{self._color(finding.level)}[{finding.level:^4}]{self.reset()}"
        if finding.message:
            print(f"{tag} {finding.check:<30} {finding.message}")
        else:
            print(f"{tag} {finding.check}")

    def _print_table(self, headers: Sequence[str], rows: list[list[str]]) -> None:
        widths = [len(str(h)) for h in headers]
        for row in rows:
            for index, cell in enumerate(row):
                if index < len(widths):
                    widths[index] = max(widths[index], len(cell))
        header_line = "  ".join(str(h).ljust(widths[i]) for i, h in enumerate(headers))
        print("       " + header_line)
        print("       " + "  ".join("-" * w for w in widths))
        for row in rows:
            padded = list(row) + [""] * (len(headers) - len(row))
            print(
                "       "
                + "  ".join(cell.ljust(widths[i]) for i, cell in enumerate(padded))
            )

    def heading(self, text: str) -> None:
        if self.quiet:
            return
        width = 76
        print()
        print(f"{self._color('TITLE')}{'=' * width}{self.reset()}")
        print(f"{self._color('TITLE')}{text}{self.reset()}")
        print(f"{self._color('TITLE')}{'=' * width}{self.reset()}")

    # -- 汇总裁剪 -----------------------------------------------------------

    def all_findings(self) -> list[Finding]:
        return [finding for section in self.sections for finding in section.findings]

    def count(self, level: str) -> int:
        return sum(1 for f in self.all_findings() if f.level == level)

    def counts(self) -> dict[str, int]:
        return {level.lower(): self.count(level) for level in LEVELS}

    def worst(self) -> str:
        if self.count("FAIL"):
            return "FAIL"
        if self.count("WARN"):
            return "WARN"
        return "OK"

    def exit_code(self) -> int:
        worst = self.worst()
        if worst == "FAIL":
            return EXIT_FAIL
        if worst == "WARN":
            return EXIT_WARN
        return EXIT_OK

    # -- 输出 ---------------------------------------------------------------

    def render_summary(self) -> None:
        self.heading(f"结论 —— {self.title}")
        print(f"脚本      : {self.script}")
        print(f"主机      : {socket.gethostname()}")
        print(f"执行用户  : {os.environ.get('SUDO_USER') or _current_user()}")
        print(f"执行时间  : {self.generated_at}")
        print(f"结论      : {self.worst()}")
        print(
            "明细      : FAIL={fail} WARN={warn} OK={ok} INFO={info}".format(
                **self.counts()
            )
        )
        failures = [f for f in self.all_findings() if f.level == "FAIL"]
        if failures:
            print("\n需要优先处理的 FAIL 项：")
            for finding in failures:
                print(f"  - {finding.check}: {finding.message}")
        print("\n本脚本只做只读检查，不修改任何服务、配置或数据。")
        print("本次结论只覆盖执行时刻，不能作为持续可用性的证明。")

    # -- 导出 ---------------------------------------------------------------

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema": "knowtrace-ops/1",
            "script": self.script,
            "title": self.title,
            "hostname": socket.gethostname(),
            "user": os.environ.get("SUDO_USER") or _current_user(),
            "generated_at": self.generated_at,
            "worst": self.worst(),
            "exit_code": self.exit_code(),
            "counts": self.counts(),
            "meta": self.extra_meta,
            "findings": [
                {
                    "level": finding.level,
                    "check": finding.check,
                    "message": finding.message,
                }
                for finding in self.all_findings()
            ],
            "sections": [
                {
                    "title": section.title,
                    "notes": section.notes,
                    "findings": [
                        {
                            "level": finding.level,
                            "check": finding.check,
                            "message": finding.message,
                            "details": finding.details,
                        }
                        for finding in section.findings
                    ],
                    "tables": [
                        {"headers": table.headers, "rows": table.rows}
                        for table in section.tables
                    ],
                }
                for section in self.sections
            ],
            "extra": self.extra_meta,
        }

    def write_json(self, path: str | Path) -> Path:
        target = _prepare_output(path, self.script, "json")
        target.write_text(
            json.dumps(self.to_dict(), ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        return target

    def write_markdown(self, path: str | Path, *, source_command: str = "") -> Path:
        target = _prepare_output(path, self.script, "md")
        target.write_text(
            self.to_markdown(source_command=source_command), encoding="utf-8"
        )
        return target

    def to_markdown(self, *, source_command: str = "") -> str:
        worst = self.worst()
        badge = {"OK": "通过", "WARN": "关注", "FAIL": "异常"}[worst]

        lines: list[str] = [
            f"# {self.title}",
            "",
            "| 项目 | 值 |",
            "| --- | --- |",
            f"| 执行脚本 | `{self.script}` |",
            f"| 主机 | `{socket.gethostname()}` |",
            f"| 执行时间(UTC) | `{self.generated_at}` |",
            f"| 总体结论 | **{worst}（{badge}）** |",
            (
                "| 明细 | "
                f"FAIL={self.count('FAIL')} WARN={self.count('WARN')} "
                f"OK={self.count('OK')} INFO={self.count('INFO')} |"
            ),
            "",
        ]

        if source_command:
            lines += ["## 复现命令", "", "```bash", source_command, "```", ""]

        failures = [f for f in self.all_findings() if f.level == "FAIL"]
        if failures:
            lines += ["## 需要优先处理", ""]
            for finding in failures:
                lines.append(f"- **{finding.check}** — {finding.message}")
            lines.append("")

        for section in self.sections:
            lines += [f"## {section.title}", ""]
            for text in section.notes:
                lines.append(f"{text}")
            if section.notes:
                lines.append("")
            if section.findings:
                lines += ["| 级别 | 检查项 | 说明 |", "| --- | --- | --- |"]
                for finding in section.findings:
                    message = finding.message.replace("|", "\\|")
                    lines.append(
                        f"| {finding.level} | `{finding.check}` | {message} |"
                    )
                lines.append("")
            for table in section.tables:
                lines += [table.to_markdown(), ""]

        lines += [
            "## 记录原则",
            "",
            "- 本报告只覆盖执行时刻的状态，不能作为持续可用性的证明。",
            "- 本报告由只读脚本生成，未修改任何服务、配置或数据。",
            "- 报告与终端输出均不含密码、Token、Cookie 或 `.env` 明细。",
            "- 只有实际验证通过的内容才记为 `OK`；推断一律标记为 `INFO`。",
            "",
        ]
        return "\n".join(lines)

    def finish(self) -> int:
        self.render_summary()
        return self.exit_code()


def _current_user() -> str:
    try:
        import getpass

        return getpass.getuser()
    except Exception:  # pragma: no cover - 极端环境下的兜底
        return "unknown"


def _prepare_output(path: str | Path, script: str, suffix: str) -> Path:
    target = Path(path)
    if target.is_dir():
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        target = target / f"{script}-{stamp}.{suffix}"
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
    except OSError as error:
        die(f"无法创建输出目录 {target.parent}: {error}")
    return target


# ---------------------------------------------------------------------------
# 子进程与命令行
# ---------------------------------------------------------------------------


def have_command(name: str) -> bool:
    return shutil.which(name) is not None


@dataclass
class CommandResult:
    returncode: int
    stdout: str
    stderr: str
    argv: list[str]

    @property
    def ok(self) -> bool:
        return self.returncode == 0


def run_readonly(
    argv: Sequence[str],
    *,
    timeout: float = 30.0,
    check: bool = False,
) -> CommandResult:
    """执行一个**只读**命令并返回结果。

    本函数只用于获取信息（``docker ps``、``openssl``、``psql --version`` 等）。
    请勿用它执行任何修改性动作——工具包的约定是「判断用 Python，动作交给人」。
    """
    try:
        completed = subprocess.run(
            list(argv),
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except FileNotFoundError:
        result = CommandResult(127, "", f"命令不存在: {argv[0]}", list(argv))
        if check:
            die(f"缺少必要命令: {argv[0]}")
        return result
    except subprocess.TimeoutExpired:
        result = CommandResult(124, "", f"命令超时: {' '.join(argv)}", list(argv))
        if check:
            die(f"命令超时: {' '.join(argv)}")
        return result
    except OSError as error:
        result = CommandResult(126, "", f"命令执行失败: {error}", list(argv))
        if check:
            die(f"命令执行失败: {error}")
        return result

    return CommandResult(
        completed.returncode,
        completed.stdout or "",
        completed.stderr or "",
        list(argv),
    )


def die(message: str, code: int = EXIT_ERROR) -> None:
    """打印错误并退出（脚本自身错误，不是巡检结论）。"""
    print(f"[FAIL] 严重错误: {message}", file=sys.stderr)
    raise SystemExit(code)


def add_common_arguments(parser: argparse.ArgumentParser) -> None:
    """给子命令加上与 Bash 脚本一致的通用参数。"""
    parser.add_argument("--conf", default=None, help="指定 ops.conf 路径")
    parser.add_argument("--json", dest="json_out", default=None, help="写出 JSON 报告")
    parser.add_argument("--markdown", dest="markdown_out", default=None, help="写出 Markdown 报告")
    parser.add_argument(
        "--no-json",
        action="store_true",
        help="不自动写出 JSON 报告（默认写入 reports/ 目录）",
    )
    parser.add_argument(
        "--report-dir",
        default=None,
        help="报告输出目录（默认 reports/，可用 OPS_REPORTS_DIR 覆盖）",
    )
    parser.add_argument("--quiet", "-q", action="store_true", help="只输出 WARN/FAIL")
    parser.add_argument("--no-color", action="store_true", help="关闭彩色输出")


def emit_reports(report: Report, args: argparse.Namespace, *, command: str = "") -> None:
    """按通用参数写出报告文件，并打印路径。

    报告目录的优先级（避免 Python 报告和 Bash 报告落到两个地方，
    导致 ops-report.py 汇总时只能看到一半）：

    1. ``--json <路径>`` 显式指定
    2. ``--report-dir``
    3. 环境变量 ``OPS_REPORTS_DIR``
    4. ``ops.conf`` 的 ``REPORTS_DIR``
    5. 工具包内的 ``reports/``（兜底）
    """
    if not args.no_json:
        target: Path | None = None
        if args.json_out:
            target = Path(args.json_out)
        elif args.report_dir:
            target = Path(args.report_dir)
        else:
            override = os.environ.get("OPS_REPORTS_DIR", "").strip()
            if override:
                target = Path(override)
        if target is None:
            conf = load_ops_conf(getattr(args, "conf", None))
            configured = conf.get("REPORTS_DIR", "")
            target = Path(configured) if configured else default_reports_dir()

        path = report.write_json(target)
        print(f"JSON 报告 : {path}")

    if args.markdown_out:
        path = report.write_markdown(args.markdown_out, source_command=command)
        print(f"Markdown 报告 : {path}")


def environment_summary() -> dict[str, Any]:
    """给报告附加一小段运行环境信息（不含任何敏感值）。"""
    return {
        "platform": platform.platform(),
        "python": platform.python_version(),
        "hostname": socket.gethostname(),
    }


def remind_evidence() -> list[str]:
    """所有报告末尾都应出现的记录原则。"""
    return [
        "本报告只覆盖执行时刻，不能作为持续可用性的证明。",
        "只有实际验证通过的内容才记 OK；推断一律记 INFO。",
        "报告不含密码、Token、Cookie 或 .env 明细。",
    ]


def seconds_to_human(seconds: float) -> str:
    delta = timedelta(seconds=abs(seconds))
    days = delta.days
    hours, remainder = divmod(delta.seconds, 3600)
    minutes = remainder // 60
    parts = []
    if days:
        parts.append(f"{days}天")
    if hours:
        parts.append(f"{hours}小时")
    if minutes and not days:
        parts.append(f"{minutes}分")
    if not parts:
        parts.append(f"{delta.seconds}秒")
    return "".join(parts)
