# ADR-0014：内置 go-user-system 源码并统一编排

## 状态

已接受，替代 ADR-0013 中“必须另行克隆和启动认证仓库”的运维方式；认证协议与服务边界保持不变。

## 决策

- 通过 Git subtree 将 go-user-system 源码纳入 `services/go-user-system`。
- 根级 Compose 同时编排 KnowTrace、PostgreSQL、go-user-system、MySQL、Redis、两套 Migration 和一次性管理员初始化。
- 根级 `Makefile` 与 `scripts/start-all.ps1` 是统一启动入口。
- MySQL、Redis、PostgreSQL 仍保持独立数据卷；KnowTrace 不直接读取认证数据库。
- 新环境在首次启动时生成本机随机密钥，并在尚无管理员时创建用户名 `KnowTrace` 的管理员。密码只写入被 Git 忽略的 `.env`。
- 管理员初始化命令使用 `bootstrap-admin-if-needed`：只把“已存在任意管理员”视为幂等成功，其他错误继续阻止认证服务启动。
- 从旧独立部署迁移时复用 `go-user-system_mysql_data` 与 `go-user-system_redis_data`，并一次性导入旧数据库/JWT密钥；不重置账号数据。

## 结果

- 新环境只需一个仓库和一条 `make up` 命令。
- 认证后端仍可独立测试、构建和维护，不与 Next.js 业务数据库耦合。
- 完整备份必须同时覆盖 PostgreSQL、MySQL 和上传目录。
- go-user-system 的角色仍只保护其账号/RBAC接口，不自动形成 KnowTrace Workspace 或逐条记录授权。

## 更新上游源码

同步上游前必须先检查本地适配改动并运行两套测试：

```bash
git subtree pull --prefix=services/go-user-system https://github.com/Yotoha0303/go-user-system.git main --squash
make check
```
