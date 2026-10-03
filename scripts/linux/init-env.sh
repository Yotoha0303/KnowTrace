#!/usr/bin/env bash
set -Eeuo pipefail
# ============================================================================
# KnowTrace-Workflow 生产环境变量初始化（Linux）
# ============================================================================
#
# 职责：把 .env.example 变成可启动的 .env —— 生成本机密钥、补默认值。
#
# 这是 scripts/init-env.ps1 的 Linux 移植版，语义与它保持一致：
#   * 幂等：值为空、或以 replace / your_ 开头时才生成，已有值一律不动
#   * 不打印密钥值
#   * 只补应用侧密钥；监控侧由 scripts/linux/init-observability-env.sh 负责
#
# 生成的四项：
#   KNOWTRACE_ADMIN_PASSWORD 48 字符（**随机**；用 --use-fixed-admin-credential 可退回固定值）
# 以下三项与 PowerShell 版同名同长度：
#   AUTH_DB_ROOT_PASSWORD   32 字节
#   AUTH_DB_PASSWORD        32 字节
#   AUTH_JWT_SECRET         48 字节
#
# 用法:
#   scripts/linux/init-env.sh [--env-file .env] [--use-fixed-admin-credential]
#
# 为什么管理员口令默认随机（2026-10-02 改）：
#   原先写死 KnowTrace-Workflow@123，而这对凭据**写在公开 README 与 start-all.ps1 里**。
#   2026-10-02 在全新 VPS 上实测：该机公网可访问，管理员口令就是这 13 个字符。
#   学习目录的《从零部署教程》§10 用的是 openssl rand -hex 24（48 字符随机），
#   老机也是 48 字符 —— 只有"照仓库脚本装"的机器是固定值。
#   默认随机 + 显式逃生开关，是本机开发与公网部署都能接受的做法。
#
# 退出码: 0 成功  3 脚本自身错误（缺文件、缺命令）
# ============================================================================

environment_name=".env"
use_fixed_admin_credential=false

while (( $# )); do
  case "$1" in
    --env-file)
      [[ -n "${2:-}" ]] || { echo "错误：--env-file 需要一个值。" >&2; exit 3; }
      environment_name="$2"; shift 2 ;;
    --env-file=*) environment_name="${1#*=}"; shift ;;
    --use-fixed-admin-credential) use_fixed_admin_credential=true; shift ;;
    --help|-h)
      sed -n '2,22p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "错误：未知参数 $1" >&2; exit 3 ;;
  esac
done

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
project_directory="$(cd -- "$script_directory/../.." && pwd -P)"

if (( EUID != 0 )); then
  exec sudo -- "$0" "$@"
fi

command -v python3 >/dev/null || { echo "错误：缺少命令 python3" >&2; exit 3; }
command -v openssl >/dev/null || { echo "错误：缺少命令 openssl" >&2; exit 3; }

environment_file="$project_directory/$environment_name"
example_file="$project_directory/.env.example"

[[ -f "$example_file" ]] || {
  echo "错误：缺少模板 $example_file" >&2
  exit 3
}

admin_flag="false"
[[ "$use_fixed_admin_credential" == true ]] && admin_flag="true"

python3 - "$environment_file" "$example_file" "$admin_flag" <<'PY'
from __future__ import annotations

import base64
import os
import re
import subprocess
import sys
from pathlib import Path

environment_path = Path(sys.argv[1])
example_path = Path(sys.argv[2])
use_fixed_admin_credential = sys.argv[3] == "true"

# ---- 首次运行：从模板建 .env -------------------------------------------------
if not environment_path.exists():
    environment_path.write_bytes(example_path.read_bytes())
    print(f"已从 {example_path.name} 创建 {environment_path.name}。")


def generate_secret(byte_count: int) -> str:
    """URL 安全的 base64，去掉 padding 与换行 —— 与 PowerShell 版一致。"""
    raw = subprocess.run(
        ["openssl", "rand", "-base64", str(byte_count)],
        check=True, capture_output=True,
    ).stdout.decode()
    # openssl 对较长输出会折行，解码前先把所有空白去掉
    raw = re.sub(r"\s+", "", raw)
    return base64.urlsafe_b64encode(base64.b64decode(raw)).decode().rstrip("=")


lines = environment_path.read_text(encoding="utf-8").splitlines()


def find_index(key: str) -> int:
    pattern = re.compile(rf"^{re.escape(key)}=")
    for index, line in enumerate(lines):
        if pattern.match(line):
            return index
    return -1


def get_value(key: str) -> str:
    index = find_index(key)
    return "" if index < 0 else lines[index].split("=", 1)[1]


def set_value(key: str, value: str) -> None:
    index = find_index(key)
    entry = f"{key}={value}"
    if index < 0:
        if lines and lines[-1] != "":
            lines.append("")
        lines.append(entry)
    else:
        lines[index] = entry


def ensure_secret(key: str, byte_count: int) -> None:
    """值为空、或以 replace / your_ 开头时才生成 —— 与 PowerShell 版同一判据。"""
    current = get_value(key).strip()
    if current == "" or re.match(r"^(replace|your_)", current):
        set_value(key, generate_secret(byte_count))
        generated.append(key)


generated: list[str] = []

# ---- 默认值（仅填空，不覆盖已填的）------------------------------------------
if get_value("KNOWTRACE_ADMIN_USERNAME").strip() == "":
    set_value("KNOWTRACE_ADMIN_USERNAME", "KnowTrace-Workflow")
# 管理员口令：默认随机生成（48 字符，与教程 §10 一致）。
# 固定值只在显式传 --use-fixed-admin-credential 时使用 —— 那是给本机开发留的逃生口。
# 判据与 ensure_secret 一致（空 / replace / your_ 开头才生成），保持幂等：
# 已有值一律不动，所以对已部署的机器重跑本脚本不会改掉现有口令。
_admin_password = get_value("KNOWTRACE_ADMIN_PASSWORD").strip()
if use_fixed_admin_credential:
    if _admin_password == "" or re.match(r"^(replace|your_)", _admin_password):
        set_value("KNOWTRACE_ADMIN_PASSWORD", "KnowTrace-Workflow@123")
        generated.append("KNOWTRACE_ADMIN_PASSWORD(FIXED)")
elif _admin_password == "" or re.match(r"^(replace|your_)", _admin_password):
    set_value("KNOWTRACE_ADMIN_PASSWORD", generate_secret(24))
    generated.append("KNOWTRACE_ADMIN_PASSWORD")
else:
    # 关键：已有值不动。特别地，**不要**把已存在的 KnowTrace-Workflow@123 当成"需要替换"，
    # 否则重跑会把已部署环境的已知口令悄悄换掉，导致运维人员登不进去。
    pass
if get_value("AUTH_ENABLED").strip() == "":
    set_value("AUTH_ENABLED", "true")
if get_value("KNOWTRACE_HOST").strip() == "":
    set_value("KNOWTRACE_HOST", "127.0.0.1")

# ---- 本机密钥 ----------------------------------------------------------------
ensure_secret("AUTH_DB_ROOT_PASSWORD", 32)
ensure_secret("AUTH_DB_PASSWORD", 32)
ensure_secret("AUTH_JWT_SECRET", 48)

# ---- 原子写入（0600）---------------------------------------------------------
temporary_path = environment_path.with_name(f"{environment_path.name}.tmp.{os.getpid()}")
try:
    descriptor = os.open(temporary_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as output:
        output.write("\n".join(lines) + "\n")
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary_path, environment_path)
    os.chmod(environment_path, 0o600)
finally:
    temporary_path.unlink(missing_ok=True)

if generated:
    print(f"已在 {environment_path.name} 中生成本机密钥：{', '.join(generated)}（不会打印密钥值）。")
    if "KNOWTRACE_ADMIN_PASSWORD" in generated:
        print("  管理员口令为随机生成，请用以下方式查看（不要贴进聊天或日志）：")
        print(f"    grep '^KNOWTRACE_ADMIN_USERNAME=' {environment_path}")
        print(f"    grep '^KNOWTRACE_ADMIN_PASSWORD=' {environment_path}")
else:
    print(f"{environment_path.name} 已包含统一启动所需密钥。")
# 这一行以前无条件打印「默认管理员凭据：KnowTrace-Workflow / KnowTrace-Workflow@123」。
# 2026-10-02 起管理员口令默认是随机生成的，那句话会**误导人**去用一对
# 已经不成立的凭据（且它在公开 README 里，等于把口令写进日志）。
# 改成按实际情况打印。
if use_fixed_admin_credential:
    print("管理员口令使用固定值 KnowTrace-Workflow@123（--use-fixed-admin-credential；仅本机开发用）。")
else:
    print("管理员口令为随机生成，已写入上方 .env；查看方式见上（勿贴进聊天或日志）。")
    print("  首次登录后请立即修改；修改后 .env 中的值不再代表当前口令。")
PY
