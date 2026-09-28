# 巡检定时任务备忘（6 个 systemd 单元）

最后更新：2026-09-28
状态：**单元文件已就绪，但尚未安装到系统** —— 见第 3 节。

---

## 1. 这 6 个单元是什么

| 单元 | 类型 | 触发时间（UTC） | 做什么 |
| --- | --- | --- | --- |
| `knowtrace-daily-ops.timer` → `.service` | 每天 | `*-*-* 19:30:00` | 只读日巡检：资源、磁盘、容器、健康端点、监控 Targets |
| `knowtrace-weekly-check.timer` → `.service` | 每周一 | `Mon *-*-* 20:00:00` | 只读周巡检：备份完整性校验、日志错误聚类、证书有效期、异常登录 |
| `knowtrace-monthly-ops.timer` → `.service` | 每月 1 日 | `*-*-01 21:00:00` | 月巡检：**演练模式**，只出计划不执行写操作 |

三个 `.service` 都是 `Type=oneshot`，三个 `.timer` 都是 `Persistent=true`。

**触发时间不是随便定的**：已有的 `knowtrace-backup.timer` 在 **19:21 UTC** 跑备份，
所以日巡检排在 19:30（能看到当天的备份）、周巡检排在周一 20:00（校验的是刚生成的归档）。
改时间时别把它们排到备份之前，否则「备份新鲜度」检查会看到昨天的归档。

## 2. 三个单元的关键差异

`ExecStart` 都是同一套参数，只换脚本：

```
/usr/bin/bash /opt/knowtrace-ops/scripts/<脚本>.sh \
    --quiet --record --json /var/lib/knowtrace/reports/ --markdown /var/lib/knowtrace/reports/
```

- `--quiet` 只输出 WARN/FAIL，输出短，适合直接当邮件正文
- `--record` 生成符合 `docs/日常运维/` 格式的记录骨架（**需人工定稿**）
- `--json` / `--markdown` 都传**目录**，脚本自己补时间戳文件名

**唯一的例外**：`monthly-ops.service` 刻意**不带 `--apply`**。定时任务只做只读检查并列出
「将要执行」的动作；写操作永远人工确认后执行：

```bash
sudo bash /opt/knowtrace-ops/scripts/monthly-ops.sh --apply
```

## 3. 安装步骤（还没做）

```bash
# 1) 装单元
sudo cp /opt/knowtrace-ops/systemd/*.service /opt/knowtrace-ops/systemd/*.timer /etc/systemd/system/
sudo chmod 644 /etc/systemd/system/knowtrace-*.service /etc/systemd/system/knowtrace-*.timer

# 2) 生效
sudo systemctl daemon-reload

# 3) 先干跑一次，确认能跑通（不依赖定时器）
sudo systemctl start knowtrace-daily-ops.service
systemctl status knowtrace-daily-ops.service --no-pager

# 4) 确认无误再启用定时
sudo systemctl enable --now knowtrace-daily-ops.timer
sudo systemctl enable --now knowtrace-weekly-check.timer
sudo systemctl enable --now knowtrace-monthly-ops.timer

# 5) 核对下次触发时间
systemctl list-timers 'knowtrace*' --no-pager
```

**装之前建议先设写时间窗**。`ops.conf` 里 `MONTHLY_WRITE_WINDOW` 目前是**空值 = 不限制**，
建议改成低峰时段，例如 `MONTHLY_WRITE_WINDOW=1-6`（UTC 1~6 点）。
它只影响 `monthly-ops.sh --apply` 的人工执行，不影响定时器的只读巡检。

## 4. 沙箱设置（三个单元一致）

```ini
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=full
ReadWritePaths=/var/lib/knowtrace /var/log/knowtrace-logs
```

`ProtectSystem=full` 把 `/usr` `/boot` `/etc` 挂成只读，`ReadWritePaths` 再单独放开
报告目录与记录目录。这是「只读脚本收紧一层权限」的落地，**2026-09-28 已用
`systemd-run --property` 复刻同款设置实测通过**：报告与记录都写得进去。

要注意：这套沙箱下脚本**不能**改 `/etc`。以后若给巡检脚本加写 `/etc` 的需求，
必须同步改 `ReadWritePaths`，否则会以「权限不足」的方式静默失败。

## 5. 退出码语义（重要，别误配告警）

三个单元都有：

```ini
SuccessExitStatus=0 1 2
```

因为脚本退出码表达的是**巡检结论**，不是**服务成败**：

| 退出码 | 含义 |
| --- | --- |
| 0 | 未发现异常 |
| 1 | 存在 WARN |
| 2 | 存在 FAIL |
| 3 | 脚本自身错误（参数、依赖、环境） |

`SuccessExitStatus=0 1 2` 让 systemd 不因「检出 WARN/FAIL」而把单元标成 failed ——
否则 `systemctl --failed` 会长期挂着红，反而让人忽略真正的故障。
结论由 JSON 报告与告警链路负责。

**要改行为**：想让 systemd 因 FAIL 报警，删掉那一行即可（这样退出码 2 会让单元变 failed）。
想让退出码恒为 0，设环境变量 `OPS_EXIT_ZERO=1`。

## 6. 两个踩过的坑

### 6.1 `Documentation=` 必须用百分号编码

```ini
# ✗ 会被整条忽略：systemd 只接受「可打印 ASCII 的 URI」
Documentation=file:/opt/knowtrace-ops/运维脚本使用说明.md

# ✓ 百分号编码后有效（实测 systemd 255）
Documentation=file:///opt/knowtrace-ops/%E8%BF%90%E7%BB%B4%E8%84%9A%E6%9C%AC%E4%BD%BF%E7%94%A8%E8%AF%B4%E6%98%8E.md
```

报错长这样，很容易被忽略（只警告、不阻止加载）：

```
Invalid URL, ignoring: file:/opt/knowtrace-ops/运维脚本使用说明.md
```

自查：`systemd-analyze verify <单元文件>`，输出里 `Invalid URL` 的出现次数应为 0。

### 6.2 报告目录必须显式传，否则会分裂成两份

脚本不带 `--json` 时，兜底目录是 `<工具包>/reports/`。单元里显式传了
`--json /var/lib/knowtrace/reports/`，与 `ops.conf` 的 `REPORTS_DIR` 一致。
**两边必须保持同一个值** —— 一旦不一致，同一批巡检会出现两份互不可见的报告，
`weekly-check` 的「每日巡检有没有在产出」和 `ops-report.py` 的汇总都会看漏。

（2026-09-28 修过这个缺陷：`ops_write_json` 的兜底现在优先跟随 `REPORTS_DIR`；
`daily-check.sh` 也补了 `export REPORTS_DIR`。）

## 7. 日常运维命令

```bash
# 看下次什么时候跑
systemctl list-timers 'knowtrace*' --no-pager

# 手动触发一次（不等到点）
sudo systemctl start knowtrace-daily-ops.service

# 看最近一次执行
systemctl status knowtrace-daily-ops.service --no-pager
journalctl -u knowtrace-daily-ops.service -n 50 --no-pager

# 看有没有失败
systemctl --failed --no-pager

# 临时停掉定时（排查时）
sudo systemctl stop knowtrace-daily-ops.timer
```

`Persistent=true` 的含义：如果机器在触发时刻是关机的，开机后会补跑一次。
所以停机维护后不会漏掉巡检记录。

## 8. 日志去向

- **systemd 侧**：`journalctl -u knowtrace-<任务>.service`
  注意本机 **journal 未持久化**（`/var/log/journal` 不存在），重启后 journal 会丢。
  要长期留痕就靠下面两个。
- **巡检结论**：`/var/lib/knowtrace/reports/*.json` + `*.md`
- **运维记录骨架**：`/var/log/knowtrace-logs/<年月>/<日期>.md`（需人工定稿）

## 9. 相关文件

| 路径 | 说明 |
| --- | --- |
| `ops.conf.example` | 配置模板；阈值、路径、`MONTHLY_*` 开关、`MONTHLY_WRITE_WINDOW` 都在这里 |
| `docs/运维脚本使用说明.md` | 完整手册：安装、用法、安全模型（四道闸） |
| `../scripts/monthly-ops.sh` | 唯一会写服务器的脚本，四道闸保护 |
