# 安全策略

## 支持范围

KnowTrace 当前处于持续开发阶段，只维护默认分支上的最新代码。

**默认姿态**：面向本机或受保护的可信网络。仓库里的默认 `compose.yaml` 只把应用绑到
`127.0.0.1`，不带反向代理、TLS 或对外监听——**直接把它暴露到公网是不安全的**。

**公网部署的前提条件**（三项都完成才可对外）：

1. **HTTPS 终结**：由反向代理提供证书与安全响应头（HSTS、`X-Content-Type-Options`、`Referrer-Policy`，并隐藏 `Server`）。
2. **网络隔离**：应用、认证服务、数据库与监控组件全部只监听 `127.0.0.1`，仅反向代理与 SSH 对外；内部指标端点不得经由公网边缘转发。
3. **部署加固**：SSH 强化配置、认证强制启用（`AUTH_ENABLED=true`）、指标端点鉴权，以及运维侧的巡检与告警。

**本项目的参考部署**（`https://knowtrace.duckdns.org`）已满足上述三项：
Caddy 终结 TLS 与安全头、nginx 与全部后端仅绑本机、`/api/metrics` 在边缘显式返回 404 并在应用侧要求 Bearer Token、
认证强制启用、Prometheus/Alertmanager 告警链路在线。
配置见 `deploy/` 与 `compose.observability.yaml`，运维细节见 `docs/16-stage3-observability.md`。

> 即便是加固后的部署，也不等同于完成了合规认证、渗透测试或容量验证——
> 本仓库**没有**做过渗透测试，也没有 SLA 或值班体系。把它当作个人/小群体的可信环境，
> 不要当作面向匿名公众的托管服务。

## 私下报告漏洞

请使用 GitHub 的 [Private vulnerability reporting](https://github.com/Yotoha0303/KnowTrace/security/advisories/new) 提交安全问题。不要创建公开 Issue，也不要附带真实密钥、生产数据库、用户内容或可识别个人的信息。

报告中建议包含：

- 受影响的提交或版本；
- 最小复现步骤与影响范围；
- 已尝试的缓解方式；
- 去除敏感数据后的日志或截图。

维护者会先确认收到报告，再评估影响、修复范围和披露时间。修复发布前请避免公开漏洞细节。

## 部署者责任

- 首次启动后立即修改初始化管理员密码；
- 为数据库和 JWT 使用独立随机密钥，不提交 `.env`；
- 通过 HTTPS、反向代理、网络隔离和防火墙限制访问；
- 将数据库备份、认证数据和 `data/uploads` 视为敏感数据；
- 只在明确需要时配置真实 AI Provider Key，并定期轮换。
