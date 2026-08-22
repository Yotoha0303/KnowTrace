# 运行、备份与恢复

## 1. 部署边界

KnowTrace 当前没有应用内登录、权限和成员审计。只能部署在个人电脑、可信局域网，或由反向代理/VPN 提供访问控制的环境；不能直接暴露到公网。

## 2. 容器运行

```powershell
docker compose up -d --build
docker compose ps
```

应用容器启动顺序：执行所有未应用 SQL Migration → 恢复中断 AI Run → 启动 Next.js。任一步失败，应用进程不会以“看似可用”的状态继续启动。

健康检查：

```text
GET /api/health/live   进程存活，不依赖数据库
GET /api/health/ready  应用与 PostgreSQL 均可用
GET /api/health        兼容旧检查，语义等同 ready
```

Compose 使用 ready 端点判断应用健康。

## 3. 中断 AI Run 恢复

`AI_RUNNING_STALE_AFTER_MS` 默认 300000，允许范围为 60000～86400000。启动维护会把超时的 `running` Run 更新为：

```text
status       failed
error_code   AI_RUN_INTERRUPTED
completed_at 当前时间
latency_ms   从 started_at 计算
```

手动执行：

```powershell
pnpm db:maintenance
```

## 4. 备份

```powershell
.\scripts\backup.ps1
```

脚本在 PostgreSQL 容器中使用 `pg_dump --format=custom --create`，先用 `pg_restore --list` 校验，再复制到项目的 `backups/`。文件名包含时间与随机后缀，已有备份不会被覆盖。`backups/` 已加入 `.gitignore`。

备份包含全部 Capture、Revision、Category、AI Run、Suggestion、Claim、Evidence、来源检查和人工结论，应视为敏感文件。至少保留一份不与运行机器共盘的加密副本。

## 5. 恢复

恢复是破坏性操作。先复制一份当前备份，再显式确认：

```powershell
.\scripts\restore.ps1 `
  -BackupPath .\backups\knowtrace-20260815-000000-abcd1234.dump `
  -ConfirmDatabaseReset
```

脚本会：校验归档 → 停止 app → 清理并重建 `knowtrace` 数据库 → 恢复归档 → 重新启动 app。恢复后检查：

```powershell
Invoke-WebRequest http://localhost:3000/api/health/ready
docker compose logs --tail=100 app
```

首次验证新备份时，应恢复到隔离临时数据库，不要直接覆盖当前数据。2026-08-15 已执行一次隔离恢复演练，确认 4 个 Migration 记录以及 `captures`、`claim_reviews` 等核心表可恢复。

## 6. 升级步骤

1. 执行 `backup.ps1` 并保存输出路径。
2. 运行 `pnpm typecheck`、`pnpm lint`、`pnpm test` 和 `pnpm build`。
3. 执行 `docker compose up -d --build app`。
4. 检查 ready 健康端点、Migration 日志和关键 Playwright 流程。
5. 出现不可兼容问题时，停止应用并从升级前备份恢复。
