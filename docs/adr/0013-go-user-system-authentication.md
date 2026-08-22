# ADR-0013：通过 go-user-system 提供可选身份认证

- 状态：accepted
- 日期：2026-08-22
- 替代：ADR-0006

## 背景

记录优先 MVP 已经形成稳定基线。产品接下来要支持个人和可信小组持续积累可能包含私人经历、证据图片与人工判断的内容，因此仅依赖“不要暴露到公网”的部署约束不足以形成可复用产品。用户授权复用其现有 `go-user-system`，而不是在 KnowTrace 中重新实现密码、刷新令牌与会话撤销。

## 决策

- 身份、密码校验、访问令牌、刷新轮换、撤销和 RBAC 数据由独立的 `go-user-system` 负责。
- KnowTrace 使用同源 BFF Route Handler 代理登录、刷新、退出和会话查询；浏览器只接收 `HttpOnly`、`SameSite=Lax` Cookie，不读取令牌。
- Next.js Proxy 保护页面和 Route Handler；每个 Server Action 及证据图片读取入口再次验证会话，不能把 Proxy 当作唯一安全边界。
- 认证通过 `AUTH_ENABLED` 显式启用。关闭时保持个人本机模式；启用时，登录服务不可用或返回异常必须拒绝访问，不能降级为匿名。
- KnowTrace 不保存密码，也不提供注册入口。用户创建和角色管理继续由 go-user-system 的管理员流程负责。
- 当前登录只建立共享知识域的访问门槛，不等同于 Workspace 隔离或完整的操作者审计；后续审核职责分离将基于该身份继续扩展。

## 会话边界

```text
Browser
  -> KnowTrace /api/v1/auth/* (same origin)
  -> go-user-system /api/v1/auth/* and /api/v1/users/me

Browser cookies:
  knowtrace_access_token  HttpOnly, Path=/
  refresh_token           HttpOnly, Path=/
```

刷新只在登录页恢复流程中执行，避免多个并发页面请求同时轮换同一 refresh token。访问令牌过期后，请求被引导到登录页，再由 BFF 尝试一次刷新并返回原目的地址。

## 后果

- KnowTrace 与认证服务必须分别运行各自数据库；go-user-system 生产模式还需要 Redis。
- 页面请求需要向认证服务校验 access token，登录服务的可用性和延迟成为受保护页面的依赖。
- 本地 HTTP 使用 `AUTH_COOKIE_SECURE=false`；HTTPS 部署必须设为 `true`。
- 仅启用登录仍不能声称支持数据租户隔离、逐条资源授权或不可抵赖的审核审计。
