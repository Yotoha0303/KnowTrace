# 阶段三：Prometheus、Grafana、ELK 与邮箱告警

## 阶段结果

Prometheus、Grafana、Alertmanager 和 Exporter 已常驻运行；ELK 采用按需 profile。2026-09-09 快照中 12/12 Prometheus targets UP，ELK 三个组件 healthy。外部邮箱告警仍未完成实际收件验收。

完整 Runbook：`服务器文件快照/项目/opt/knowtrace/docs/16-stage3-observability.md`。

## 1. 一键部署核心监控

第一次需要让应用包含 metrics 代码时：

```bash
cd /opt/knowtrace
scripts/linux/deploy-observability.sh --build-app
```

以后只更新监控配置：

```bash
cd /opt/knowtrace
scripts/linux/deploy-observability.sh
```

脚本会执行资源预检、环境初始化、Compose/promtool/amtool 校验、镜像拉取、Nginx metrics 阻断、容器启动和验收。

## 2. 关键配置

| 本地快照 | 作用 |
| --- | --- |
| `compose.observability.yaml` | Prometheus/Grafana/Alertmanager/Exporter 与 ELK 服务 |
| `deploy/monitoring/prometheus.yml` | 抓取目标和 Alertmanager 地址 |
| `deploy/monitoring/rules/knowtrace.yml` | 应用、主机、备份和自监控规则 |
| `deploy/monitoring/blackbox.yml` | HTTP 探针配置 |
| `deploy/grafana/` | 数据源和 dashboard provisioning |
| `deploy/logstash/` | 日志输入、解析和 Elasticsearch 输出 |
| `.env.observability.example` | 非敏感字段模板 |

上述路径均位于 `服务器文件快照/项目/opt/knowtrace/`。

真实 `.env.observability`、metrics token、Grafana密码和渲染后的 Alertmanager秘密配置没有复制。

## 3. SSH 隧道访问

在 Windows PowerShell 保持以下命令运行：

```powershell
ssh -N `
  -L 3001:127.0.0.1:3001 `
  -L 9090:127.0.0.1:9090 `
  -L 9093:127.0.0.1:9093 `
  -L 5601:127.0.0.1:5601 `
  knowtrace-vps
```

访问入口：

- Grafana：`http://127.0.0.1:3001`
- Prometheus：`http://127.0.0.1:9090`
- Alertmanager：`http://127.0.0.1:9093`
- Kibana：`http://127.0.0.1:5601`

不得在 UFW 或云防火墙中直接开放这些端口。

## 4. ELK 按需操作

```bash
cd /opt/knowtrace
scripts/linux/elk.sh status
scripts/linux/elk.sh up
python3 scripts/linux/verify-observability.py --elk
```

使用完停止并保留数据卷：

```bash
scripts/linux/elk.sh stop
scripts/linux/elk.sh status
```

禁止使用 `docker compose down --volumes`。当前机器资源较小，ELK 启动后约使用 2 GiB swap，不应长期常驻。

## 5. 核心监控验收

```bash
python3 scripts/linux/verify-observability.py --core
curl -fsS http://127.0.0.1:9090/-/ready
curl -fsS http://127.0.0.1:9093/-/ready
curl -fsS 'http://127.0.0.1:9200/_cluster/health?pretty'
```

已保存的 Blackbox 演练日志位于 `证据/knowtrace-observability-drill-20260908T044604Z.log`，记录了 target down、告警 firing、Alertmanager 接收、恢复和清除。

## 6. 邮箱告警边界

配置助手：

```bash
cd /opt/knowtrace
scripts/linux/configure-163-alert-email.sh
scripts/linux/test-email-alert.sh
```

授权码必须在隐藏提示中输入，不得写入命令参数、聊天、Git 或本地 Markdown。此前曾在聊天中提供过授权码，应先到邮箱后台作废并重新生成，再做真实收件测试。只有收件箱实际收到告警，才能标记完成。

## 7. 材料入口

- `文档/08-Prometheus容器监控与企业实践.md`
- `文档/02-日志位置与查询.md`
- `文档/02-ELK按需启动与访问.md`
- `服务器文件快照/项目/opt/knowtrace/docs/16-stage3-observability.md`
- `服务器文件快照/项目/opt/knowtrace/scripts/linux/`
- `服务器文件快照/项目/opt/knowtrace/deploy/`
- `证据/knowtrace-observability-drill-20260908T044604Z.log`
- `证据/`、`SOP/`、`故障记录/`、`问题记录/`、`待办/`：从D盘旧包吸收的完整阶段三记录；
- `问题记录/INC-S3-001-阶段三本地完整记录缺失.md`
