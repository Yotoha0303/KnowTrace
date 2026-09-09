# ELK 按需启动与访问 SOP

## 1. 适用范围

本 SOP 用于 KnowTrace VPS 上已经部署的 Elasticsearch、Logstash 和 Kibana。
它们通过 Docker Compose 的 `elk` profile 按需运行，不是 `apt` 安装的 systemd 服务。

关键文件位于 VPS：

| 文件 | 用途 |
| --- | --- |
| `/opt/knowtrace/compose.observability.yaml` | ELK 与核心监控 Compose overlay |
| `/opt/knowtrace/scripts/linux/elk.sh` | 容量预检、启动、验收与停止 |
| `/opt/knowtrace/deploy/logstash/` | Logstash 配置和处理管道 |
| `/opt/knowtrace/docs/16-stage3-observability.md` | 完整阶段三 Runbook |
| `/opt/knowtrace/.env.observability` | 运行时配置，含敏感信息，不复制到学习记录 |

代码已经推送到 Git 分支 `origin/codex/stage3-observability`。VPS 专用的
`compose.production.yaml` 和两个 `.env` 文件不应提交到 Git。

## 2. 启动前检查

在 Windows PowerShell 登录 VPS：

```powershell
ssh knowtrace-vps
```

进入项目并检查现状：

```bash
cd /opt/knowtrace
scripts/linux/elk.sh status
free -h
swapon --show
df -h /opt/knowtrace
docker stats --no-stream
```

`elk.sh up` 会再次自动检查以下最低条件：

- 可用内存至少 350 MiB；
- swap 总量至少 2 GiB；
- 可用磁盘至少 8 GiB。

2026-09-09 的只读检查为：可用内存约 820 MiB、swap 总量 4 GiB、磁盘可用
约 32 GiB，满足脚本的启动门槛。这只是启动前快照，不保证长期性能。

## 3. 启动和自动验收

在 `/opt/knowtrace` 执行：

```bash
scripts/linux/elk.sh up
```

脚本会依次执行：

1. 初始化可观测性运行环境；
2. 拉取固定版本的 Elasticsearch、Logstash、Kibana 镜像；
3. 先启动并等待 Elasticsearch 健康；
4. 配置 7 天 ILM 和索引模板；
5. 启动 Logstash、Kibana；
6. 创建 `knowtrace-logs-*` Kibana Data View；
7. 运行 `verify-observability.py --elk` 验收。

如果启动或验收失败，脚本会停止三个 ELK 容器，但保留数据卷。

## 4. 验证状态和查看日志

```bash
scripts/linux/elk.sh status
python3 scripts/linux/verify-observability.py --elk
curl -fsS 'http://127.0.0.1:9200/_cluster/health?pretty'
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5601/api/status
```

若启动失败，分别查看最近日志：

```bash
docker logs --tail 200 knowtrace-elasticsearch-1
docker logs --tail 200 knowtrace-logstash-1
docker logs --tail 200 knowtrace-kibana-1
```

验收目标：

- Elasticsearch cluster health 可查询；
- Logstash 可以写入验证事件；
- Elasticsearch 能检索到验证事件；
- Kibana Data View `knowtrace-logs-*` 存在。

## 5. 从 Windows 访问 Kibana

服务器的 `5601` 只绑定 `127.0.0.1`，不要在 UFW 或云防火墙中开放它。

在另一个 Windows PowerShell 窗口建立 SSH 隧道并保持窗口运行：

```powershell
ssh -N -L 5601:127.0.0.1:5601 knowtrace-vps
```

浏览器打开：

`http://127.0.0.1:5601`

关闭隧道窗口或按 `Ctrl+C` 只会断开本机访问，不会停止服务器上的 ELK。

## 6. 使用完立即停止

单台 VPS 只有约 2 GiB 内存，ELK 应保持按需模式：

```bash
cd /opt/knowtrace
scripts/linux/elk.sh stop
scripts/linux/elk.sh status
```

`stop` 会保留 Elasticsearch、Logstash、Kibana 数据卷。禁止执行以下命令：

```text
docker compose down --volumes
docker volume rm knowtrace_elasticsearch_data
```

这些命令会破坏已保留的数据，不属于普通停止或故障恢复步骤。

## 7. 在本地查看完整代码而不切换现有分支

在本地 KnowTrace Git 仓库先确认工作区状态：

```powershell
git status --short --branch
git fetch origin
git show origin/codex/stage3-observability:scripts/linux/elk.sh
git show origin/codex/stage3-observability:compose.observability.yaml
git show origin/codex/stage3-observability:docs/16-stage3-observability.md
```

以上命令不会切换或覆盖当前工作分支。若要把该分支作为独立学习目录，再根据本地
仓库实际位置创建单独 worktree，避免覆盖未提交修改。

## 8. 回滚边界

- 启动后网站变慢、swap 或 I/O 明显升高：保存 `free -h`、`vmstat 1 10`、
  `docker stats --no-stream` 和容器日志，然后运行 `elk.sh stop`。
- 不通过删除数据卷处理启动问题。
- 不开放公网 `5601`、`9200` 或 Logstash 端口。
- `.env`、邮箱授权码、Token 和密码不得写入学习文档或 Git。
