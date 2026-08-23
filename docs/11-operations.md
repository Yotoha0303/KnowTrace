# 运行、备份与恢复

## 1. 部署边界

KnowTrace 的统一容器栈默认启用仓库内 `services/go-user-system` 认证后端，并默认把 Web 与认证端口绑定到 `127.0.0.1`。账户中心复用 Go 后端的资料、密码和 RBAC 管理，但这些角色暂不提供 KnowTrace Workspace 隔离或业务数据细粒度授权。公网部署仍需要 HTTPS、`AUTH_COOKIE_SECURE=true`、网络隔离和安全运维，不能只凭“出现登录页”就声称可安全暴露。

统一启动：

```powershell
make up
# 或
.\scripts\start-all.ps1
```

首次启动会在 `.env` 生成 MySQL/JWT/管理员随机密钥，并在尚无管理员时创建用户名 `KnowTrace` 的管理员；密码只保存在 `KNOWTRACE_ADMIN_PASSWORD`，不会输出到日志。重复启动只检查管理员是否已存在，不会覆盖账号或密码。需要独立复核时仍须准备另一个不同账号；结论作者与复核者不能共享账号。修改密码会使该账号的全部会话失效；当前认证后端不提供设备会话列表和单设备撤销接口。管理员角色分配依赖数字用户 ID，因为后端尚无用户列表接口。

## 2. 容器运行

根级 `Makefile` 是统一入口；`make up`、`make down`、`make restart`、`make ps` 和 `make logs` 分别管理完整栈。直接调用 Compose 前必须先运行 `make init` 生成本机密钥。

启动顺序：MySQL → go-user-system Migration → 幂等管理员初始化 → Redis 与认证后端 → PostgreSQL → KnowTrace Migration → 中断 AI Run 恢复 → Next.js。任一步失败，依赖服务不会以“看似可用”的状态继续启动。

健康检查：

```text
GET /api/health/live   进程存活，不依赖数据库
GET /api/health/ready  应用与 PostgreSQL 均可用
GET /api/health        兼容旧检查，语义等同 ready
GET :8082/readyz       go-user-system、MySQL 与 Redis 就绪
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

页面中的 Excel 导出属于可移植数据交换，只覆盖记录、对象、时间、状态、分类和分类关联。它不能恢复 AI 处理历史、主张证据链、审核发布快照或图片，因此不得替代下述 PostgreSQL 与 `data/uploads` 备份。Excel 导入必须先预检；预检结果会保存为 `data_import_runs`，人工确认后才以单个数据库事务写入。

```powershell
make backup
```

统一备份分别生成 PostgreSQL custom-format 归档、带 SHA-256 manifest 的 go-user-system MySQL SQL 归档，以及 `data/uploads` 图片 ZIP。已有备份不会被覆盖，`backups/` 已加入 `.gitignore`。Excel 导入导出不能替代其中任何一项。

这些备份包含全部知识内容、账号资料、密码哈希、会话元数据和证据图片，应视为敏感文件。至少保留一份不与运行机器共盘的加密副本。

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

1. 执行 `make backup` 并保存三类输出路径。
2. 运行 `make check`。
3. 执行 `make up`。
4. 检查两个 ready 健康端点、两套 Migration 日志和关键 Playwright 流程。
5. 出现不可兼容问题时，停止应用并从升级前备份恢复。
