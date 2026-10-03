# Day 0：宿主机准备与加固（Ansible）

这一层只管**操作系统本身**。四层职责的完整划分见 [`../README.md`](../README.md)。

| 只管 | **绝不管** |
| --- | --- |
| 系统包、`authorized_keys`、sshd 加固、内核参数、UFW、fail2ban | 容器内配置、业务版本、监控组件、组网、内存上限 |

判据：**业务版本天天变，频繁跑 Ansible 很容易改乱底层系统** ——
所以凡是"每次发版都要动"的东西，都不属于这一层。

---

## 为什么是「就地跑」而不是「从控制端推」

通常 Ansible 是从一台控制机连过去推。**这里不是**，`site.yml` 用的是
`hosts: localhost` + `connection: local`，即 playbook 在目标机自己身上执行。

原因：**ansible-core 的 Windows 控制端支持是坏的**。实测（2026-10-03）：

| 版本 | 结果 |
| --- | --- |
| ansible-core 2.21.4（Python 3.12） | `OSError: [WinError 87]` —— `check_blocking_io()` 对控制台句柄调 `os.get_blocking()` 失败 |
| ansible-core 2.17.14（Python 3.12，打过上述补丁） | `ERROR: No module named 'fcntl'` —— `fcntl` 是 POSIX 专有模块，Windows 上根本没有 |

`fcntl` 是硬阻断：ansible-core 依赖它做文件锁，而它在 Windows 上不存在也没有替代。
**不是装个补丁能解决的事**，所以放弃了 Windows 控制端这条路。

被否决的替代方案（留痕，免得以后有人重走）：

| 方案 | 否决理由 |
| --- | --- |
| 给 Windows 装 WSL，在 WSL 里当控制端 | 要在用户机器上开 WSL 功能、装发行版 —— 为一个部署工具动用户的开发环境，代价过大 |
| 保留 dediko（Ansible 的 Docker 镜像） | 要在这台已有 12 个容器的机器上再吊一个容器，还只为了跑一次 Day 0 |

就地跑的附带好处：不需要在机器上建第二个账号、不需要二次 SSH 认证。
代价：playbook 得先送到目标机（用 `ssh … 'bash -s'` 管道过去，不落盘）。

---

## 用法

### 第 0 步：把公钥送上目标机

Ansible 需要读公钥来装进 `authorized_keys`。就地跑，所以公钥得先在目标机上：

```bash
# 从你的机器（假设用管道送过去）
scp -P 22345 ~/.ssh/knowtrace_vps_ed25519.pub \
    root@<host>:/root/knowtrace-ops/knowtrace_vps_ed25519.pub
```

> 位置由 `group_vars/all.yml` 的 `root_public_key_file` 决定，可改。
> 公钥不是机密，但**上游仓库是 public 的**，所以它不入库（见 `.gitignore`）。

### 第 1 步：装 ansible-core 与两个 collection

```bash
apt-get install -y --no-install-recommends ansible-core
ansible-galaxy collection install -r deploy/ansible/requirements.yml
```

只有两个外部 collection，都不是可选的：

| collection | 用途 |
| --- | --- |
| `ansible.posix` | `authorized_key` —— 幂等地维护 `authorized_keys` |
| `community.general` | `ufw` —— 幂等地维护防火墙规则 |

### 第 2 步：先只装公钥，然后**从外部验证一次**

```bash
cd deploy/ansible
ansible-playbook site.yml --tags access
```

然后**另开一个窗口**，用那把私钥登录：

```bash
ssh -i ~/.ssh/knowtrace_vps_ed25519 -p 22345 root@<host> whoami
```

**这一步不能省。** 该机的 `authorized_keys` 原本是 **0 字节空文件**，
也就是说在公钥装上并验证之前，这台机器只有密码登录可用。
先关密码登录再去验证密钥，结果是把自己锁在门外（只能走厂商控制台）。

### 第 3 步：预演，再全量

```bash
ansible-playbook site.yml --check     # 预演，看会改什么
ansible-playbook site.yml             # 全量
ansible-playbook site.yml             # 再跑一次：应当 changed=0（幂等验收）
```

---

## 设计上的几个要点

**sshd drop-in 必须叫 `00-knowtrace-hardening.conf`。**
`/etc/ssh/sshd_config` 第 12 行是 `Include /etc/ssh/sshd_config.d/*.conf`，
而目录里的 `50-cloud-init.conf` 写着 `PasswordAuthentication yes`。
sshd 对同一参数是**首个出现的值生效**，所以排 50 后面（`99-*.conf`）会被它盖掉，
改了等于没改 —— 而且 `sshd -T` 会如实显示 `yes`，看着像"没生效"，
实际是文件名顺序错了。

**每处改动后面都跟一条断言，读的是"实际生效值"而不是"文件内容"。**
改了文件不等于改了行为。`sshd -T`、`sysctl -n`、`ufw status` 读的都是运行态。

> ⚠️ **但断言"规范化输出"时，必须先看它实际印什么。**
> 实测踩到：配置里写 `PermitRootLogin prohibit-password`，
> 而 `sshd -T` 会把它**归一化成同义词 `without-password`** 输出 —— 两者等价
> （`without-password` 是旧名），但只认一种拼写就会**配置正确却报失败**。
> 方向恰好与"部署看着成功"相反：**绿灯被当成红灯**。
> 首次全量执行就是这样在 `hardening` 停下、没走到 `firewall` 的。
> 断言写的是"我认为输出长什么样"，不是"输出实际长什么样" —— 得先取样再写。

**`sshd` 用 reload 不用 restart。** 不影响既有连接，当前会话可作逃生通道；
且 reload 前 `validate: sshd -t -f %s` 已保证新配置是好的。

**UFW 只增不减、绝不 `reset`，且排在最后一个 role。**
它是唯一能让人当场失联的动作。`site.yml` 里前面的任何一步失败，
都还没动网络策略，排查成本最低。

**不改 SSH 端口。** 改端口要连同 UFW 放行、隧道、厂商控制台一起在维护窗口做，
不适合交给日常重跑的 playbook。`hardening` 只**断言**实际端口与
`group_vars/all.yml` 的 `ssh_port` 一致 —— 防止放行清单与实际脱节。

**sysctl 只用 `-p <本文件>`，不用 `--system`。**
后者会顺带加载发行版 `/etc/sysctl.d/10-*.conf`，那不是本次的授权范围。

---

## 已知缺口（本次不修，留痕）

- **fail2ban 的 sshd jail 没配 `port`。** 功能上不受影响（sshd filter 是按日志里的
  `Failed password` 抓的，与端口无关），但 `fail2ban-client` 的端口信息会失真。
  要修得连同 jail.local 一起设计，不在本次范围。
- **`install.sh` 里的 apt 段没有删。** 按「不引入两套并存」的最终形态，那段应该并进
  `roles/baseline`；本次先让两者共存，边界见 [`../README.md`](../README.md)。
- **`prepare-host.sh` 的建卷与 nginx 站点不在这里。** 它们是"让 Compose 能起来"的前置，
  属 Day 1 地基，不是 OS 加固 —— 见 [`../README.md`](../README.md) 的说明。
