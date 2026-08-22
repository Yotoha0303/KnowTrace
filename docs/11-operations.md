# 运行、备份与恢复

## 1. 部署边界

KnowTrace 默认不启用登录，只能部署在个人电脑、可信局域网，或由反向代理/VPN 提供访问控制的环境。可以通过 `AUTH_ENABLED=true` 接入独立 go-user-system；这会建立身份门槛，并为结论作者、独立复核者和发布者提供服务端身份。账户中心复用上游的资料、密码和 RBAC 管理，但这些角色暂不提供 KnowTrace Workspace 隔离或业务数据细粒度授权。公网部署仍需要 HTTPS、`AUTH_COOKIE_SECURE=true`、网络隔离和安全运维，不能只凭“出现登录页”就声称可安全暴露。

启用认证前先确认：

```powershell
Invoke-WebRequest http://localhost:8082/readyz
$env:AUTH_ENABLED="true"
$env:AUTH_SERVICE_URL="http://localhost:8082"
$env:AUTH_REGISTRATION_ENABLED="false" # 确认上游开放注册后才启用
$env:AUTH_COOKIE_SECURE="false" # 仅本地 HTTP
```

go-user-system 的密码、JWT 密钥、MySQL 和 Redis 备份不属于 KnowTrace 备份，必须按其仓库运维文档单独管理。需要独立复核时至少准备两个不同账号；结论作者与复核者不能共享账号。修改密码会使该账号的全部会话失效；当前上游不提供设备会话列表和单设备撤销接口。管理员角色分配依赖数字用户 ID，因为上游尚无用户列表接口。

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

备份包含全部 Capture、Revision、Category、AI Run、Suggestion、Claim、Evidence、来源检查、来源权威性评估、人工/独立复核和可靠发布快照，应视为敏感文件。至少保留一份不与运行机器共盘的加密副本。

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
