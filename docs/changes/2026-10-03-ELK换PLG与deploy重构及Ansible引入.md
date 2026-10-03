# 2026-10-03 架构调整：ELK→PLG、deploy/ 重构、引入 Ansible 做 Day 0

| 项 | 值 |
| --- | --- |
| 记录时间 | 2026-10-03（**变动前先写**） |
| 驱动 | 用户决定：ELK 开销太大 → 换 PLG 栈；并按《部署与运维工具了解》做**职责划分**，不再让单个 bash 承担全流程 |
| 参考文档 | `其他收获/部署与运维工具了解.md`（§四「自动化架构与日/周/月运维规划」） |
| 用户已定 | ① ELK **删除** ② Loki **本地文件系统** ③ Grafana **用官方推荐** ④ ELK 记录**改写** ⑤ 按文档**分阶段**划分职责 |
| 前置状态 | 用户已把 `deploy/*` 移进 `deploy/config_backup/`（13 个文件），新建的 4 个目录为空 |

---

## 1. 为什么不能只改 compose

ELK 并非只由 compose 承载。实际牵动 **4 条线、11 个文件**：

| 线 | 牵动 |
| --- | --- |
| **编排** | `compose.observability.yaml`：3 个服务 + `logging-internal`/`logging-management` 两个网络 |
| **采集** | `deploy/logstash/`（caddy JSON 日志 / nginx access+error / **所有容器 json 日志** / TCP:5000） |
| **运维脚本** | `scripts/linux/elk.sh`（容量预检+启停）、`ops.conf.example`（`MANAGED_PORTS` 含 9200/5601/5000、`MONTHLY_STOP_ELK`、`ELK_SCRIPT`）、`daily-ops.sh` 的 `docker.elk` 段 |
| **验收与文档** | `verify-observability.py --elk`（含 Kibana 数据视图）、`docs/16-stage3-observability.md`（整篇按 ELK 写） |

**采集这一条最容易出错**：ELK 原来收 **所有容器的 json 日志**，换成 Loki 后若漏掉这条，表现是
**容器起来了、Grafana 里日志是空的** —— 本仓库最贵的故障形状。

---

## 2. 目标结构（用户已确认）

```
deploy/
├── ansible/     ← 新建：Day 0 宿主机（依赖 / UFW / sshd / sysctl）
├── caddy/       ← 新建：Caddyfile（**当前不在仓库**，只在 install.sh 的 heredoc 与文档快照里）
├── alloy/       ← 新建：替代 logstash/（用户选 Grafana 官方推荐 → Alloy 而非 Promtail）
├── nginx/       ← 从 config_backup 放回
├── monitoring/  ← 放回（prometheus.yml / blackbox.yml / rules/）
├── grafana/     ← 放回，并**新增 Loki 数据源**
├── systemd/     ← 放回（backup / offsite-backup 两组单元）
└── （不建 compose/、不建 ops/）   ← 见下
```

| 不建 | 理由 |
| --- | --- |
| `deploy/compose/` | 三个 compose 在**仓库根**，被 20+ 处引用（Dockerfile/Makefile/bootstrap/所有 linux 脚本/CI）。移动=打断全部 |
| `deploy/ops/` | `scripts/ops/` 已是权威（22 个文件，`notes/03` 明确记载）；再建一个=两个 ops 目录 |
| `deploy/{monitoring,grafana,nginx,systemd}/` 改名 | 19 处引用已指向这些路径 |

---

## 3. 职责划分（按文档分层，不重叠）

文档的核心主张：**别让一个 Shell 脚本走天下**。据此把现有流程按层拆开：

| 层 | 时机 | 负责 | 载体 | 现有实现 |
| --- | --- | --- | --- | --- |
| **Day 0 宿主机** | 一次 | OS 依赖、UFW、sshd 加固、sysctl、装 Docker | **Ansible**（新增） | `install.sh` 里的 apt + 手工 UFW/sshd |
| **Day 1 服务编排** | 每次发版 | 应用与监控容器怎么起、怎么组网、内存上限 | **Compose** | `compose{,.production,.observability}.yaml` |
| **Day 1 流量入口** | 一次 | 域名→证书→反代→Basic Auth | **Caddy** | `deploy/caddy/Caddyfile`（新增） |
| **Day 2+ 周期** | 定时 | 备份、清理、巡检、审计 | **systemd timer + 脚本** | `scripts/ops/` + `deploy/systemd/` |

**各层不得越界**（文档原话）：Ansible 不管容器内配置；Compose 不管宿主机安全；
Caddy 不承担核心加固；周期任务只管触发。

### 3.1 与现有脚本的关系（必须说清，否则会出现两套）

`install.sh` / `bootstrap.sh` / `prepare-host.sh` 目前**同时**做了 Day 0 与 Day 1。
引入 Ansible 后：

| 现有 | 调整为 |
| --- | --- |
| `install.sh` 的 apt 装包段 | → **Ansible**（`deploy/ansible/site.yml`） |
| UFW / sshd / sysctl | → **Ansible**（原本就是"只打印不执行"，现在有正确载体） |
| `prepare-host.sh` 的建卷 / nginx 站点 / 释放 :80 | **留在原处** —— 它们是"让 Compose 能起来"的前置，属 Day 1 的地基，不是 OS 加固 |
| `bootstrap.sh --all` 的四阶段 | **保留** —— 它是编排入口；但 Day 0 部分改为调用 Ansible |

> **不引入两套并存**：Ansible 就位后，`install.sh` 里的 apt/UFW 段**删除**，改为
> 提示"Day 0 由 `deploy/ansible/site.yml` 负责"。

---

## 4. 分阶段执行（每阶段独立可验证）

| 阶段 | 内容 | 验证方式 |
| --- | --- | --- |
| **P1 结构** | 从 `config_backup` 放回 4 个目录；删 `logstash/`；删空目录 `compose/` `ops/`；建 `caddy/` | `grep -rn "deploy/"` 的 19 处引用**全部能解析到文件** |
| **P2 PLG** | compose 删 ELK 三服务与两网络、加 Loki+Alloy；`logstash/`→`alloy/`；Grafana 加 Loki 数据源 | 裸机部署后：**Grafana 里能查到容器日志**（不只是容器起来） |
| **P3 收尾** | 删 `elk.sh`；清理 `ops.conf.example` 的 ELK 键；改 `daily-ops.sh`；`verify-observability.py` 去 `--elk` 加 Loki 断言 | `--stage verify` 全绿 |
| **P4 Ansible** | 新建 `deploy/ansible/{inventory.ini,site.yml,roles/}`；`install.sh` 的 Day 0 段改为调用它 | 在裸机上只跑 Ansible 即得到"加固后的宿主机" |
| **P5 文档** | 改写 `docs/16`（ELK→PLG）；`deploy/README` 说明分层职责 | — |

**每阶段结束都在用户重装的机器上验证**，不攒到最后。

---

## 5. 验收（可判定，沿用本项目纪律）

| # | 标准 |
| --- | --- |
| 1 | 19 处 `deploy/` 引用全部解析到**存在的文件**（脚本化检查，不靠眼看） |
| 2 | 裸机跑完 `install.sh --all`：退出码 0 |
| 3 | **Grafana 数据源里有 Loki，且能查到真实容器日志**（用 LogQL 查 `{container=~".+"}` 有结果） |
| 4 | 无 Elasticsearch/Logstash/Kibana 任何容器**与**配置残留 |
| 5 | Ansible：`ansible-playbook --check` 在裸机上无失败；重复执行**幂等**（第二次全 ok/changed=0） |
| 6 | 职责无重叠：`install.sh` 不再包含 apt 装包与 UFW 逻辑 |

---

## 6. 边界（本次不做）

| 不做 | 原因 |
| --- | --- |
| 移动根级 compose 文件 | 20+ 处引用；用户已确认不建 `deploy/compose/` |
| 建 `deploy/ops/` | 与 `scripts/ops/` 撞名；用户已确认不动 ops |
| 引入 VictoriaMetrics / Restic / Cloudflare Tunnel | 文档提到的**替代方案**，但用户本次只指定 ELK→Loki |
| 改业务代码（`src/`） | 本次只动部署与运维层 |

---

## 7. 回滚

- 每阶段一个提交，`git revert` 可退回
- `config_backup/` 在 P1 完成前**不删**，作为原始结构的热备份
- P2 起需重建监控容器；应用容器不受影响（ELK 与 app 无耦合）
