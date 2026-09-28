# scripts/ops —— 运维工具包

日 / 周 / 月三档巡检脚本，以及它们的公共库、定时任务单元和使用手册。
按 `../../KnowTrace-ops/` 里那份《bash与python的运维使用建议》第 5 节的规划落位。

## 目录

| 路径 | 内容 |
| --- | --- |
| `scripts/daily-check.sh` | 日巡检（12 个章节，覆盖最广）：主机/负载/内存/磁盘/inode、systemd 服务、Docker、容器日志扫描、健康端点、备份新鲜度、监听端口与 UFW、仓库状态 |
| `scripts/daily-ops.sh` | 日巡检（精简版）：资源、磁盘、容器、健康端点、**监控 Targets**，带统一结论与退出码 |
| `scripts/weekly-check.sh` | 周巡检：备份完整性校验、日志错误聚类与上周基线对比、证书有效期、异常登录 |
| `scripts/monthly-ops.sh` | 月巡检：隔离恢复演练、依赖更新检查、故障复盘、文档更新。**唯一会写服务器的脚本** |
| `scripts/log_analyzer.py` | 被 weekly 调用：日志错误聚类 + 与基线对比 |
| `scripts/ops-report.py` | 被 monthly 调用：多期报告汇总、巡检闭环新鲜度 |
| `scripts/cert_check.py` | 被 weekly 调用：TLS 证书有效期与链校验 |
| `scripts/security-check.sh` | 被 weekly 调用：异常登录与端口合规 |
| `lib/` | Bash 与 Python 公共库，两个日巡检脚本都依赖 |
| `systemd/` | 6 个定时任务单元 + [`MEMO.md`](systemd/MEMO.md)（安装/回滚/退出码语义/踩过的坑）。**2026-09-28 已安装并 enable** |
| `docs/运维脚本使用说明.md` | 完整手册：安装、用法、安全模型、阈值说明 |
| `ops.conf.example` | 配置模板。**实际使用的 `ops.conf` 不入库**（含内网地址与账号名，已在 `.gitignore`） |

## daily-check.sh 与 daily-ops.sh 的分工

仓库里原本有一份 `scripts/linux/daily-check.sh`（429 行，输出原始数据），
**已于 2026-09-28 删除**，由本目录的版本取代：

- `daily-check.sh` —— 覆盖最广的巡检，12 个章节，输出带结论分级与退出码
- `daily-ops.sh` —— 精简版，聚焦「日清单」五项，与 weekly / monthly 共用同一套报告格式

两者可以并存，报告都写进 `ops.conf` 的 `REPORTS_DIR`（`/var/lib/knowtrace/reports`）。
如果没有特别需要，**建议只挂一个**，避免同一目录下出现两套日巡检报告。

## 结论分级与退出码

| 级别 | 含义 |
| --- | --- |
| `OK` | 已确认符合预期（必须实际验证过） |
| `WARN` | 需要关注，但尚未影响可用性 |
| `FAIL` | 已确认异常，需要处理 |
| `INFO` | 事实记录，不构成判断（包括所有「无法验证」的情况） |

| 退出码 | 含义 |
| --- | --- |
| 0 | 未发现异常 |
| 1 | 存在 WARN |
| 2 | 存在 FAIL |
| 3 | 脚本自身错误（参数、依赖、环境） |

## 常用参数

`--conf <文件>` `--json <文件或目录>` `--markdown <文件或目录>` `--no-json`
`--quiet/-q` `--no-color` `--record`（生成记录骨架） `--help/-h`

## 快速开始

```bash
# 1) 部署（不要放进 /opt/knowtrace，避免被部署覆盖）
sudo mkdir -p /opt/knowtrace-ops
sudo cp -r lib scripts systemd docs ops.conf.example /opt/knowtrace-ops/

# 2) 配置
sudo cp /opt/knowtrace-ops/ops.conf.example /opt/knowtrace-ops/ops.conf
sudo chmod 600 /opt/knowtrace-ops/ops.conf
sudo vi /opt/knowtrace-ops/ops.conf    # 至少确认 PROJECT_DIR / CERT_DOMAINS / PUBLIC_HEALTH_URL

# 3) 报告目录
sudo mkdir -p /var/lib/knowtrace/reports

# 4) 试跑（只读，不会改任何东西）
sudo bash /opt/knowtrace-ops/scripts/daily-check.sh

# 5) 挂定时任务 —— 已挂好，见 systemd/MEMO.md
#    重建顺序：先 cp 单元 + daemon-reload，再「手工 start 验证」，
#    确认 journal 无 specifier 报错后才 enable --now
```

## 只读保证

`daily-check.sh` / `daily-ops.sh` / `weekly-check.sh` **不做任何修改性动作**。
唯一写入是报告文件与 `--record` 生成的记录骨架。

`monthly-ops.sh` 是唯一会改动服务器的，用**四道闸**保护（`--apply` + `ops.conf` 开关 +
未被 `--without-*` 关闭 + `MONTHLY_WRITE_WINDOW` 时间窗），之后还需输入 `yes`。
`apt` 升级另需 `--apply-updates`；重启系统永不自动执行。详见 `docs/运维脚本使用说明.md` 第 5 节。
