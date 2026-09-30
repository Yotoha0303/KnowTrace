#!/usr/bin/env bash
set -Eeuo pipefail
# ============================================================================
# KnowTrace 部署 —— 让「部署成功」= 「运行态确实变了」
# ============================================================================
#
# 为什么需要这个脚本
# ------------------
# 2026-09-29 实测：/opt/knowtrace 的 HEAD 是 47a4c20，但运行中的容器自报
# revision 是 7ce26f7d（2026-09-08），差 37 个提交 / 21 天。
# 而当时 4 层健康检查、12 个抓取目标、整份巡检报告**全部正常**。
#
# 根因（2026-09-30 实测确认）：
#   容器 label com.docker.compose.project.config_files 显示，容器创建于
#   2026-09-08T03:04:41Z，是用**带第三个 -f（compose.observability.yaml）**的命令创建的：
#       docker compose -f compose.yaml -f compose.production.yaml \
#                      -f compose.observability.yaml up -d --build --wait
#   而 .env.observability 里没有 KNOWTRACE_APP_REVISION，该变量由
#   compose.observability.yaml 注入，值落回默认的 "unknown"。
#   之后的部署走的是**只带前两个 -f** 的命令 —— 那种组合不注入该变量，
#   于是 revision 一直显示 unknown，直到镜像始终没被重建。
#
# 本脚本把整条链路固定下来，并**在最后断言运行态 revision == HEAD**：
#   构建 → 起容器 → 读 /api/metrics 的 build_info → 与 HEAD 比对 → 不一致就非零退出
#
# 这三条断言的关系（别混淆）
#   · HEAD == 期望 sha          ← 只证明「文件到位」（E-01 的判据，必要不充分）
#   · 容器健康 + 探针 200        ← 只证明「服务可用」（可用性）
#   · 运行态 revision == HEAD   ← **才是「部署真的生效」**（同一性，本脚本补上的）
#
# 用法
#   deploy/deploy.sh [--no-pull] [--skip-verify] [--dry-run]
#
# 退出码
#   0 部署成功且运行态与 HEAD 一致
#   2 部署执行了但运行态与 HEAD 不一致（**这是要报警的**）
#   3 脚本自身错误 / 前置条件不满足
# ============================================================================

project_directory="${PROJECT_DIR:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)}"
compose_files=(-f compose.yaml -f compose.production.yaml -f compose.observability.yaml)

do_pull=true
do_verify=true
dry_run=false

while (( $# )); do
  case "$1" in
    --no-pull)     do_pull=false; shift ;;
    --skip-verify) do_verify=false; shift ;;
    --dry-run)     dry_run=true; shift ;;
    --help|-h)     sed -n '2,45p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "错误：未知参数 $1" >&2; exit 3 ;;
  esac
done

log()  { printf '%s\n' "$*"; }
fail() { printf '[FAIL] %s\n' "$*" >&2; }

if (( EUID != 0 )); then
  exec sudo -- "$0" "$@"
fi

cd -- "$project_directory"

# ---- 1. 前置条件 -----------------------------------------------------------
log "== 1/6 前置条件 =="

if [[ ! -f .env ]]; then
  fail "缺少 $project_directory/.env"; exit 3
fi
if [[ ! -f .env.observability ]]; then
  fail "缺少 $project_directory/.env.observability —— 部署需要它来注入 METRICS_BEARER_TOKEN。
      先跑 scripts/linux/init-observability-env.sh"
  exit 3
fi
if ! grep -q '^METRICS_BEARER_TOKEN=' .env.observability; then
  fail ".env.observability 里没有 METRICS_BEARER_TOKEN —— 部署后无法核对运行态版本"
  exit 3
fi
log "  [ OK ] .env 与 .env.observability 就绪"

# 未跟踪文件会挡住 git pull（这是踩过的坑之一）。只提示，不自动删。
untracked="$(git status --porcelain --untracked-files=normal | grep -c '^??' || true)"
if (( untracked > 0 )); then
  log "  [WARN] 有 $untracked 项未跟踪文件 —— 可能会挡住 git pull。先看："
  git status --porcelain --untracked-files=normal | grep '^??' | sed 's/^/         /' || true
fi

# ---- 2. 取代码 -------------------------------------------------------------
log
log "== 2/6 取代码 =="

if [[ "$do_pull" == true ]]; then
  if [[ "$dry_run" == true ]]; then
    log "  (dry-run) git pull --ff-only"
  else
    branch="$(git rev-parse --abbrev-ref HEAD)"
    if [[ "$branch" != "main" ]]; then
      fail "当前分支是 $branch，不是 main。**先核对分支再部署** —— 停在遗留分支上会让 pull 静默空转。"
      exit 3
    fi
    git pull --ff-only
  fi
else
  log "  (--no-pull) 跳过 git pull"
fi

expected_revision="$(git rev-parse HEAD)"
log "  部署目录 HEAD = ${expected_revision:0:12}"
log "  分支 = $(git rev-parse --abbrev-ref HEAD)"

# ---- 3. 构建 ---------------------------------------------------------------
log
log "== 3/6 构建 =="
log "  KNOWTRACE_APP_REVISION=${expected_revision:0:12}（烘进镜像，不是运行时注入）"

# 2 vCPU / ~1.8GB 的机器上 next build 容易 OOM（见素材 A8）。
# 这里给 Node 设一个上限，让它在被 OOM killer 杀掉之前先自己失败、
# 并留下可读的错误，而不是把整个机器拖进 swap 抖动。
export KNOWTRACE_APP_REVISION="$expected_revision"
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=1024}"

if [[ "$dry_run" == true ]]; then
  log "  (dry-run) docker compose ${compose_files[*]} build app"
else
  docker compose "${compose_files[@]}" build app
fi

# ---- 4. 起容器 -------------------------------------------------------------
log
log "== 4/6 启动 =="
if [[ "$dry_run" == true ]]; then
  log "  (dry-run) docker compose ${compose_files[*]} up -d --wait"
else
  # --wait 会在 healthcheck 通过后才返回。
  # 构建失败时不会替换任何容器 —— 所以这一步之前，服务一直是旧容器在跑。
  docker compose "${compose_files[@]}" up -d --wait
fi

# ---- 5. 断言运行态 ---------------------------------------------------------
log
log "== 5/6 断言运行态 =="

if [[ "$do_verify" == false ]]; then
  log "  (--skip-verify) 跳过。**不建议** —— 这一步就是本脚本存在的理由。"
  exit 0
fi

metrics_token="$(grep -oP '^METRICS_BEARER_TOKEN=\K.*' .env.observability)"
running_revision=""
for attempt in 1 2 3 4 5; do
  response="$(curl -sS -m 10 -H "Authorization: Bearer $metrics_token" \
              http://127.0.0.1:3000/api/metrics 2>/dev/null || true)"
  running_revision="$(printf '%s\n' "$response" \
    | sed -n 's/^knowtrace_build_info{.*revision="\([^"]*\)".*/\1/p' | head -1)"
  [[ -n "$running_revision" ]] && break
  [[ "$dry_run" == true ]] && break
  log "  第 $attempt 次没读到 build_info，等 5s 重试…"
  sleep 5
done

if [[ -z "$running_revision" ]]; then
  fail "读不到运行态 revision（/api/metrics 无 build_info）"
  fail "单独核对：sudo bash scripts/linux/write-revision-metrics.sh"
  exit 2
fi

log "  期望 revision = ${expected_revision:0:12}"
log "  运行 revision = ${running_revision:0:12}"

if [[ "$running_revision" == "$expected_revision" ]]; then
  log "  [ OK ] 运行态与部署目录一致"
else
  fail "运行态与部署目录**不一致** —— 部署动作成功了，但运行的还是旧代码"
  fail "  期望 ${expected_revision}"
  fail "  实际 ${running_revision}"
  fail "排查：docker inspect <容器> -f '{{index .Config.Labels \"com.docker.compose.project.config_files\"}}'"
  fail "      确认构建和 up 用的是同一组 -f；再用 docker inspect -f '{{.Created}}' 看镜像是不是刚建的"
  exit 2
fi

# ---- 6. 刷新版本指标 -------------------------------------------------------
log
log "== 6/6 刷新版本指标 =="
# 不等下一次日巡检 —— 否则部署完到下一次巡检之间，指标还是旧结论。
if [[ -x scripts/linux/write-revision-metrics.sh ]]; then
  bash scripts/linux/write-revision-metrics.sh || true
else
  log "  [WARN] scripts/linux/write-revision-metrics.sh 不存在或不可执行，指标将在下一次日巡检时刷新"
fi

log
log "部署完成：${expected_revision:0:12}"
