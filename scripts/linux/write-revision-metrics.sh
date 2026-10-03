#!/usr/bin/env bash
set -Eeuo pipefail
# ============================================================================
# KnowTrace-Workflow 运行态版本核对 —— 把「跑的是不是这一版代码」写成指标
# ============================================================================
#
# 为什么需要这个脚本
# ------------------
# 2026-09-29 的生态观察发现：VPS 上 /opt/knowtrace 的 HEAD 是 47a4c20（最新），
# 但**运行中的容器自报 revision 是 7ce26f7d（2026-09-08）**，差 37 个提交 / 21 天。
# 而当时 4 层健康检查、12 个抓取目标、20+ 条告警规则、整份巡检报告**全部显示正常** ——
# 因为整套体系验证的是「可用性」（服务是否回答），
# 没有一个在验证「同一性」（回答的是不是我以为的那份代码）。
#
# 本脚本补上那一步：把「期望 revision」与「运行中 revision」都写成指标，
# 由 Prometheus 规则 KnowTraceAppRevisionMismatch 负责告警。
#
# 两个值分别来自
# --------------
#   期望值：PROJECT_DIR 的 `git rev-parse HEAD`（部署目录到底拉到了哪一版）
#   运行值：应用 /api/metrics 里 knowtrace_build_info 的 revision 标签
#           （由 compose 的 KNOWTRACE_APP_REVISION 环境变量注入，compose.observability.yaml:11）
#
# ⚠️ 这个脚本能成立的前提是 KNOWTRACE_APP_REVISION 被正确注入
# --------------------------------------------------------------------------
# 它需要 compose.observability.yaml 参与合并 —— 即部署命令必须带第三个 -f：
#
#   docker compose -f compose.yaml -f compose.production.yaml \
#                  -f compose.observability.yaml up -d --build --wait
#
# 只带前两个 -f 时该变量不注入，revision 会变成字面量 "unknown"。
# 这是 2026-09-30 实测确认的 RCA，详见 docs/16-stage3-observability.md 的
# 「运行态版本核对」一节。
#
# 退出码
# ------
#   0 = 已成功判定（无论一致还是不一致 —— 结论由指标承载，不由退出码承载）
#   0 = 判定失败（缺少 token / 应用不可达）—— 同样写进指标，让告警去报
#
# 本脚本**只读**：不改代码、不重启服务、不碰部署目录。唯一写入是指标文件。
# ============================================================================

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
project_directory="${PROJECT_DIR:-$(cd -- "$script_directory/../.." && pwd -P)}"
textfile_directory="${TEXTFILE_DIRECTORY:-$project_directory/runtime/node-exporter}"
observability_env="$project_directory/.env.observability"
metrics_url="${METRICS_URL:-http://127.0.0.1:3000/api/metrics}"

install -d -m 755 "$textfile_directory"
output_path="$textfile_directory/knowtrace-app-revision.prom"
temporary_path="$(mktemp "$textfile_directory/.knowtrace-app-revision.XXXXXX")"
trap 'rm -f -- "$temporary_path"' EXIT

# ---- 期望值：部署目录的 HEAD -----------------------------------------------
expected_revision=""
if git -C "$project_directory" rev-parse --git-dir >/dev/null 2>&1; then
  expected_revision="$(git -C "$project_directory" rev-parse HEAD 2>/dev/null || true)"
fi

# ---- 运行值：应用自报的 revision --------------------------------------------
# token 从 env 文件读取后**只放进变量**，不 echo、不进日志、不进指标标签。
running_revision=""
determined=false
reason=""

if [[ -z "$expected_revision" ]]; then
  reason="deploy_directory_is_not_a_git_repository"
elif [[ ! -f "$observability_env" ]]; then
  reason="missing_env_observability"
else
  metrics_token="$(grep -oP '^METRICS_BEARER_TOKEN=\K.*' "$observability_env" 2>/dev/null || true)"
  if [[ -z "$metrics_token" ]]; then
    reason="missing_metrics_bearer_token"
  else
    # 无 token 时 /api/metrics 返回 404（设计上的 404-instead-of-401），
    # 所以这里必须区分「404 说明没拿到 token」与「连不上」。
    response="$(curl -sS -m 10 -H "Authorization: Bearer $metrics_token" "$metrics_url" 2>/dev/null || true)"
    running_revision="$(printf '%s\n' "$response" \
      | sed -n 's/^knowtrace_build_info{.*revision="\([^"]*\)".*/\1/p' | head -1)"
    if [[ -z "$running_revision" ]]; then
      reason="app_metrics_unreachable_or_revision_absent"
    elif [[ "$running_revision" == "unknown" ]]; then
      # 这是「部署命令漏了第三个 -f」的特征表现，单独给一个 reason 便于排障。
      reason="knowtrace_app_revision_not_injected"
    else
      determined=true
    fi
  fi
fi

# 差异里有没有**应用代码**。
# 为什么需要：revision 不一致本身不都是问题 —— 只改 docs 的提交也会让两者不等，
# 而那种情况下应用行为完全相同。若不区分，这条告警会在每次文档提交后误报，
# 很快就被训练成「忽略它」（参见 KnowTrace-career-assets 素材 A17：
# 「永久性 WARN 会训练人忽略 WARN」）。
#   -1 = 无法判断（运行中的 revision 不在本地历史里，例如历史被重写）
#   >=0 = 差异中触及应用代码的文件数
app_changed=-1
if [[ "$determined" == true && "$expected_revision" != "$running_revision" ]]; then
  if git -C "$project_directory" cat-file -e "${running_revision}^{commit}" 2>/dev/null; then
    # 这些路径覆盖「改动会改变应用行为」的全部类别：源码、schema、构建、依赖、容器编排。
    app_affecting_paths=(
      src/
      drizzle/
      Dockerfile
      package.json
      pnpm-lock.yaml
      compose.yaml
      compose.production.yaml
      compose.observability.yaml
    )
    app_changed="$(git -C "$project_directory" diff --name-only \
      "${running_revision}..${expected_revision}" -- \
      "${app_affecting_paths[@]}" 2>/dev/null | wc -l)"
  fi
elif [[ "$determined" == true ]]; then
  app_changed=0
fi

now_epoch="$(date -u +%s)"
match=0
if [[ "$determined" == true && "$expected_revision" == "$running_revision" ]]; then
  match=1
fi

# ---- 写指标 ----------------------------------------------------------------
{
  echo '# HELP knowtrace_app_revision_check_timestamp_seconds Unix timestamp of the last successful revision determination.'
  echo '# TYPE knowtrace_app_revision_check_timestamp_seconds gauge'
  # 判定失败时**不写**这个样本，让 absent() 规则去报「核对再也没跑成功」——
  # 这正是他们已有的手法（见 knowtrace.ops-check 的 KnowTraceOpsCheckNeverRan）。
  if [[ "$determined" == true ]]; then
    echo "knowtrace_app_revision_check_timestamp_seconds $now_epoch"
  fi

  echo '# HELP knowtrace_app_revision_match 1 when the running revision equals the deploy directory HEAD.'
  echo '# TYPE knowtrace_app_revision_match gauge'
  if [[ "$determined" == true ]]; then
    echo "knowtrace_app_revision_match $match"
  fi

  echo '# HELP knowtrace_app_revision_app_changed_files Files under app-affecting paths that differ between the running and expected revision. -1 = unknown.'
  echo '# TYPE knowtrace_app_revision_app_changed_files gauge'
  if [[ "$determined" == true ]]; then
    echo "knowtrace_app_revision_app_changed_files $app_changed"
  fi

  echo '# HELP knowtrace_app_expected_revision_info Deploy directory HEAD revision.'
  echo '# TYPE knowtrace_app_expected_revision_info gauge'
  if [[ -n "$expected_revision" ]]; then
    echo "knowtrace_app_expected_revision_info{revision=\"$expected_revision\"} 1"
  fi

  echo '# HELP knowtrace_app_running_revision_info Revision reported by the running application.'
  echo '# TYPE knowtrace_app_running_revision_info gauge'
  if [[ -n "$running_revision" ]]; then
    echo "knowtrace_app_running_revision_info{revision=\"$running_revision\"} 1"
  fi

  # 判定失败的原因。1 = 当前是这个原因，0 = 不是。
  # 用「每个原因一条样本」而不是一条带标签的枚举，是为了让 absent() /
  # 比较运算在 PromQL 里好写，也避免标签值随原因集合变化而漂移。
  echo '# HELP knowtrace_app_revision_undetermined Reason the revision could not be determined (1 = current reason).'
  echo '# TYPE knowtrace_app_revision_undetermined gauge'
  for candidate in deploy_directory_is_not_a_git_repository \
                   missing_env_observability \
                   missing_metrics_bearer_token \
                   app_metrics_unreachable_or_revision_absent \
                   knowtrace_app_revision_not_injected; do
    value=0
    [[ "$reason" == "$candidate" ]] && value=1
    echo "knowtrace_app_revision_undetermined{reason=\"$candidate\"} $value"
  done
} >"$temporary_path"

chmod 644 "$temporary_path"
mv -f -- "$temporary_path" "$output_path"
trap - EXIT

# ---- 人类可读的一行结论（进 journal）---------------------------------------
if [[ "$determined" == true ]]; then
  if (( match == 1 )); then
    echo "运行态版本一致：${expected_revision:0:12}"
  else
    if (( app_changed == 0 )); then
      echo "运行态 revision 落后，但差异内**没有应用代码**（只改了 docs 等）："
      echo "   部署目录 ${expected_revision:0:12} / 运行中 ${running_revision:0:12} —— 不需要重建"
    else
      echo "⚠️ 运行态版本不一致，且差异里**有应用代码**（$app_changed 个文件）："
      echo "   部署目录 ${expected_revision:0:12} / 运行中 ${running_revision:0:12}"
      echo "   修法：scripts/linux/deploy-observability.sh --build-app"
    fi
  fi
else
  echo "运行态版本无法判定（reason=$reason）—— 已写入指标，由告警规则负责"
fi

exit 0
