# VPS 阶段三：指标、可视化、集中日志与邮件告警

## 目标与证据边界

本阶段在单台 2 GiB VPS 上建立可运行、可验证、可回滚的最小可观测性闭环：

- Prometheus 抓取主应用、认证服务、服务器和 HTTP 探针指标；
- Grafana 自动加载数据源和 `KnowTrace VPS 可观测性` dashboard；
- Alertmanager 接收 Prometheus 告警，并在配置 SMTP 后发送邮件；
- Elasticsearch、Logstash、Kibana（ELK）按需启动，集中检索边缘代理和容器日志；
- 通过可恢复的 Blackbox Exporter 停止实验验证“发现 → firing → 送达 Alertmanager → 恢复 → 清除”。

单机 Compose 不能证明高可用、长期容量、SLA、真实值班或外部邮件送达；每一项必须按实际证据表述。

## 架构

```text
公网用户 -> Caddy :443 -> Nginx 127.0.0.1:8080 -> Next.js / Go Auth
                                         ^
Prometheus -> Next.js 私有 /api/metrics --|-- Go /metrics
           -> Node Exporter（主机）
           -> Blackbox Exporter（内部与公网 ready）
           -> Alertmanager -> SMTP（有凭据后）
Grafana ----> Prometheus

Caddy / Nginx / Docker JSON logs -> Logstash -> Elasticsearch -> Kibana
                                      按需 profile，验证后停止
```

## 安全与资源策略

- 9090、3001、9093、9200、5000、5601 只绑定 `127.0.0.1`，不开放 UFW 端口。
- Grafana、Prometheus、Alertmanager 和 Kibana 只通过 SSH 隧道访问。
- `/api/metrics` 需要随机 Bearer token；Prometheus 从 0400 文件读取。Nginx 对公网该路径固定返回 404。
- `.env.observability` 和渲染后的 Alertmanager 配置不进入 Git；权限分别为 0600/0400。
- Prometheus 同时按 7 天和 512 MB 限制时序数据。
- Docker 日志对新建的阶段三容器限制为 10 MB × 3 文件。
- ELK 采用独立内部网络、固定内存上限和 7 天 ILM，只按需运行。另接一个普通管理 bridge 以兼容 Docker Engine 29 的端口发布行为，但所有宿主机端口仍只绑定 `127.0.0.1`。停止命令保留所有数据卷。
- 不使用 `docker compose down --volumes`；它会删除监控或日志数据。

## 关键文件

| 文件 | 用途 |
| --- | --- |
| `compose.observability.yaml` | 核心监控与按需 ELK overlay |
| `deploy/monitoring/prometheus.yml` | 抓取与 Alertmanager 路由 |
| `deploy/monitoring/rules/knowtrace.yml` | 应用、主机、备份和自监控规则 |
| `deploy/grafana/` | 数据源和 dashboard provisioning |
| `deploy/logstash/` | Caddy、Nginx、Docker 与验证事件管道 |
| `scripts/linux/init-observability-env.sh` | 生成本地 secrets、渲染 Alertmanager 配置 |
| `scripts/linux/configure-163-alert-email.sh` | 交互式写入 163 邮箱与隐藏授权码 |
| `scripts/linux/deploy-observability.sh` | 容量预检、配置校验、部署和验收 |
| `scripts/linux/verify-observability.py` | 端点、target、PromQL、Grafana 和 ELK 验收 |
| `scripts/linux/observability-drill.sh` | 可恢复的监控故障演练 |
| `scripts/linux/elk.sh` | ELK 启动、验证、停止 |

## 部署 SOP

### 1. 发布前

```bash
cd /opt/knowtrace
git status --short --branch
free -h
df -h /
docker stats --no-stream
systemctl status knowtrace-backup.timer --no-pager
scripts/linux/backup-all.sh
scripts/linux/verify-restore.sh /var/backups/knowtrace/<新归档>
```

记录当前 commit、生产 overlay 哈希、归档 SHA-256、ready 和容器状态。备份会短暂停止 app/auth 写入入口；在可能有用户时先公告维护窗口。

### 2. 部署核心监控

首次包含主应用指标代码变更：

```bash
cd /opt/knowtrace
scripts/linux/deploy-observability.sh --build-app
```

后续只更新监控配置：

```bash
scripts/linux/deploy-observability.sh
```

脚本依次完成容量检查、secret 初始化、Compose/promtool/amtool 校验、固定镜像拉取、应用更新、Nginx 公网 metrics 阻断、监控启动、备份指标接入和完整验收。

### 3. SSH 隧道访问

在 Windows 单独开一个终端：

```powershell
ssh -N `
  -L 3001:127.0.0.1:3001 `
  -L 9090:127.0.0.1:9090 `
  -L 9093:127.0.0.1:9093 `
  knowtrace-vps
```

然后访问：

- Grafana：`http://127.0.0.1:3001`
- Prometheus：`http://127.0.0.1:9090`
- Alertmanager：`http://127.0.0.1:9093`

Grafana 用户名/密码只在 VPS 的 `/opt/knowtrace/.env.observability` 中查看，不复制到公开文档或聊天。

## 邮件告警

外部邮件默认关闭。使用 `sudoedit /opt/knowtrace/.env.observability` 填写：

```dotenv
ALERT_EMAIL_ENABLED=true
ALERT_SMTP_SMARTHOST=smtp.example.com:587
ALERT_SMTP_FROM=alerts@example.com
ALERT_SMTP_AUTH_USERNAME=alerts@example.com
ALERT_SMTP_AUTH_PASSWORD=<应用专用密码>
ALERT_SMTP_REQUIRE_TLS=true
ALERT_EMAIL_TO=operator@example.com
```

推荐 587/STARTTLS 和应用专用密码，不使用邮箱网页登录密码。更新后：

若提供商只开放 465 隐式 TLS（例如本次 163 邮箱），当前固定版本
Alertmanager 0.28.1 应使用：

```dotenv
ALERT_SMTP_SMARTHOST=smtp.163.com:465
ALERT_SMTP_REQUIRE_TLS=false
```

这里的 `false` 只跳过已建立 TLS 后的第二次 STARTTLS 请求，不会把 465
连接降级为明文。Alertmanager 0.28.1 的邮件实现会先对 465 执行 TLS 握手，
而 `require_tls=true` 还会继续检查并请求 STARTTLS。修改端口或升级
Alertmanager 后必须重新核对该版本实现并做证书、配置和实际收件验证。

163 邮箱可用交互助手配置。授权码只通过隐藏提示输入，不放在命令参数、
Shell 历史、聊天或文档中：

```bash
scripts/linux/configure-163-alert-email.sh
```

如果授权码曾出现在聊天、截图或工单中，先在邮箱后台作废并生成新授权码，
再运行助手；不要继续使用已暴露的授权码。

更新后：

```bash
scripts/linux/init-observability-env.sh
docker compose \
  --env-file .env \
  --env-file .env.observability \
  -f compose.yaml \
  -f compose.production.yaml \
  -f compose.observability.yaml \
  up -d --no-deps --force-recreate alertmanager
scripts/linux/test-email-alert.sh
```

只有 Alertmanager 日志显示发送成功且收件箱实际收到测试邮件，才能标记“外部邮件告警已验证”。

## 故障演练

```bash
scripts/linux/observability-drill.sh blackbox
```

脚本先验证正常基线，再停止 Blackbox Exporter，等待 `KnowTraceMetricsTargetDown` 进入 firing 并出现在 Alertmanager，随后通过 trap 恢复容器，重新验证 12 个 targets 并等待告警清除。它不会停止 KnowTrace 应用或数据库。

## ELK 按需流程

启动前会检查至少 350 MiB 可用内存、2 GiB swap 和 8 GiB 可用磁盘：

```bash
scripts/linux/elk.sh up
```

打开 Kibana 需要另开 SSH 隧道：

```powershell
ssh -N -L 5601:127.0.0.1:5601 knowtrace-vps
```

访问 `http://127.0.0.1:5601`，data view 为 `knowtrace-logs-*`。完成验证后：

```bash
scripts/linux/elk.sh stop
```

`stop` 只停止三个容器，保留 Elasticsearch、Logstash、Kibana 数据卷。ELK 运行时若网站延迟、swap 或 I/O 明显升高，先保存 `docker stats`、`free -h`、`vmstat` 和容器日志，再停止 ELK。

ELK 组件在负载下可能超过 Docker Compose 默认的 10 秒停止等待；脚本使用 60 秒宽限期。退出码 137 且 `OOMKilled=false` 通常表示停止超时后收到 SIGKILL，仍应延长宽限并复测，不能误记为内存 OOM。

若容器内健康、`HostConfig.PortBindings` 有配置，但 `NetworkSettings.Ports` 为 `null`，说明容器只连接了 internal bridge，Docker Engine 29 没有真正建立发布端口。不要开放公网端口或关闭防火墙；确认 ELK 服务同时连接 `logging-internal` 与 `logging-management`，再强制重建这三个按需容器。

若 Kibana 退出码为 134、容器的 `OOMKilled=false`，但日志含 `JavaScript heap out of memory`，这是 Kibana 自身 Node 堆耗尽，不是 Linux OOM Killer。当前实验配置给 Kibana 512 MiB Node 堆和 768 MiB 容器上限，并给 Logstash 512 MiB 上限；重启前仍需检查整机内存和 swap，验证后立即停止 ELK。

若 Logstash 日志显示 `object mapping for [source] tried to parse field [source] as object`，表示自定义事件把 ECS 的 `source` 对象字段当成了字符串。不要删除索引或映射；把自定义字段改为项目专用名称（本项目使用 `verification_source`），重新注入事件并验证。

## 验收命令

```bash
python3 scripts/linux/verify-observability.py --core
curl -sS http://127.0.0.1:9090/api/v1/targets
curl -sS http://127.0.0.1:9090/api/v1/rules
curl -sS http://127.0.0.1:9093/api/v2/status
```

完成定义：

- 主应用私有 metrics 为 200，Nginx/公网 metrics 为 404；
- Prometheus 至少 12 个 active targets 全部 UP；
- 核心 PromQL 有样本，备份新鲜度指标存在；
- Grafana 数据源和 dashboard 通过 API 证实已 provisioning；
- Prometheus 发现 active Alertmanager；
- 故障演练经历正常、firing、送达、恢复、清除；
- ELK 验证事件从 Logstash 写入 Elasticsearch并可检索，Kibana data view 存在；
- 外部邮件必须另有实际收件证据。

## 告警 Runbook

### Target down

先看 Prometheus target 的 `lastError`，再检查对应容器、Docker DNS 和 metrics 鉴权。不要先重启整套服务。

### HTTP probe failed

区分 `up{job="blackbox-exporter"}` 与 `probe_success`：前者表示 Prometheus 能抓取 exporter，后者才表示目标 URL 成功。比较内部 ready 和公网 ready，逐层检查 app → Nginx → Caddy → DNS/TLS。

### Database not ready

保存 app ready 响应和 app/PostgreSQL 日志，检查容器 health、连接数、磁盘和迁移状态。不要删除 volume。

### Auth not ready

同时检查 auth、MySQL、Redis readiness 和认证日志。恢复后必须验证登录/刷新，而不只看容器 running。

### Request errors

按 `route_type`、`route_path` 对照结构化 `[knowtrace-request-error]` 容器日志，并检查同时间的 Caddy/Nginx 请求。动态用户 ID 不进入 Prometheus 标签。

### Host capacity

保存 `uptime`、`free -h`、`vmstat 1 10`、`df -hT /`、`docker stats --no-stream`。若 ELK 正在运行，优先停止按需 ELK并保留卷；不要盲目清缓存或杀数据库。

### Backup freshness

检查 timer、`/var/log/knowtrace-backup.log`、归档 SHA-256 和磁盘。告警恢复前必须生成新归档并通过隔离恢复，不能只手工改时间戳指标。

### Auth HTTP

用路由模板和状态码聚合定位，避免把用户 ID、URL 查询串等高基数字段加入标签。结合日志确认是依赖超时、限流还是应用错误。

### Prometheus self

运行 promtool 检查配置/规则，查看 Prometheus 日志和 `/api/v1/rules` 的 lastError。修复后等待至少一个 15 秒 evaluation 周期。

### Email delivery

检查 Alertmanager `/api/v2/status`、容器日志、SMTP DNS/TCP/STARTTLS 和提供商退信。不要在命令行历史、截图、Git 或故障单中暴露应用专用密码。

## 回滚

1. 保存诊断、当前 commit 和监控卷列表。
2. 停止核心监控但保留数据：对 observability overlay 执行 `stop grafana prometheus alertmanager blackbox-exporter node-exporter`。
3. Nginx 从 `/root/knowtrace-ops/backups/<时间>-stage3-nginx/knowtrace.conf` 恢复，执行 `nginx -t` 后 reload。
4. 应用回退到部署前 commit，保留 `.env`、`.env.observability`、`compose.production.yaml` 和所有数据卷。
5. 验证 app/auth/Nginx/公网 ready 和业务登录。

回滚代码不等于删除监控历史；除非经过单独确认，不删除任何 named volume。
