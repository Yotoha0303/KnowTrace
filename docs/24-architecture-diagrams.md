# 技术架构图

| 项 | 值 |
| --- | --- |
| 建立时间 | 2026-10-02 |
| 用途 | 补齐 `docs/06-architecture.md` 里那张 5 行流程图**覆盖不到**的整体结构 |
| 与 `docs/06` 的关系 | **不替代它**。`docs/06` 讲的是「为什么这样选」（取舍与理由），本文画的是「实际长什么样」（组件、链路、边界） |
| 领域模型 | 见 [`03-domain-model.md`](03-domain-model.md) 的 `erDiagram`，本文不重复 |
| 证据纪律 | 图里每个组件都能在服务器 `docker ps` 找到；端口与链路与 `ss -tlnp` / Caddyfile / nginx conf 一致 |

---

## 1. 部署拓扑

```mermaid
flowchart TB
    subgraph PUB["公网（唯一对外）"]
        USER["使用者浏览器 / 原生客户端"]
    end

    subgraph EDGE["边缘（宿主机，非容器）"]
        CADDY["Caddy<br/>:80 / :443<br/>TLS 终结 + 安全头"]
        NGINX["nginx<br/>127.0.0.1:8080<br/>反代 + /api/metrics 显式 404"]
        SSH["sshd<br/>:22345"]
    end

    subgraph NET["Docker 私有网络 knowtrace_default（172.18.0.0/16）"]
        APP["knowtrace-app<br/>127.0.0.1:3000<br/>Next.js standalone"]
        AUTH["knowtrace-auth<br/>127.0.0.1:8082<br/>go-user-system (Go)"]
        PG["knowtrace-postgres<br/>127.0.0.1:15432<br/>PostgreSQL 18"]
        MYSQL["knowtrace-auth-mysql<br/>mysql:8.0"]
        REDIS["knowtrace-auth-redis<br/>redis:7.4"]
        PROM["prometheus<br/>127.0.0.1:9090"]
        GRAF["grafana<br/>127.0.0.1:3001"]
        AM["alertmanager<br/>127.0.0.1:9093"]
        NE["node-exporter"]
        BB["blackbox-exporter"]
    end

    MAIL["163 SMTP"]

    USER -->|"https"| CADDY
    USER -.->|"ssh（运维）"| SSH
    CADDY -->|"reverse_proxy"| NGINX
    NGINX -->|"proxy_pass"| APP

    APP -->|"BFF：登录/刷新/会话"| AUTH
    APP --> PG
    AUTH --> MYSQL
    AUTH --> REDIS

    PROM -.->|"抓取 /api/metrics（Bearer）"| APP
    PROM -.->|"抓取 /metrics"| AUTH
    PROM -.-> NE
    PROM -.-> BB
    BB -.->|"探测公网 /api/health/ready"| CADDY
    PROM --> AM
    AM -.->|"critical / warning"| MAIL
    GRAF -->|"查询"| PROM

    classDef pub fill:#ffe6e6,stroke:#c33
    classDef edge fill:#fff4d6,stroke:#c93
    classDef data fill:#e6f0ff,stroke:#369
    classDef obs fill:#eaf7ea,stroke:#393
    class USER pub
    class CADDY,NGINX,SSH edge
    class PG,MYSQL,REDIS data
    class PROM,GRAF,AM,NE,BB obs
```

**读这张图要抓住三件事**：

| # | 事实 | 为什么重要 |
| --- | --- | --- |
| 1 | **只有 Caddy（80/443）与 sshd（22345）对外** | 其余全部绑 `127.0.0.1`；数据库没有对公网开放 |
| 2 | **代理是三跳**：Caddy → nginx → app | `docs/06` 的旧图完全没有这一层；限流的真实 IP 就在这条链上传递 |
| 3 | **10 个容器全在同一网络，没有分段** | 见第 4 节的边界说明——这是**已知的收敛点**，不是疏忽 |

---

## 2. 一次请求的鉴权链路（**安全关键路径**）

```mermaid
flowchart TD
    REQ["请求进入 app:3000"] --> PROXY["src/proxy.ts（Next.js Proxy）"]

    PROXY --> Q1{"认证启用？<br/>AUTH_ENABLED"}
    Q1 -->|否| PASS2["放行（个人本机模式）<br/>登录/注册页则跳首页"]
    Q1 -->|是| Q2{"原生客户端？<br/>X-Client: native"}

    Q2 -->|是| NAT["校验 Bearer 令牌<br/>无效 → JSON 401（不回登录页）"]
    Q2 -->|否| Q3{"是公开路径？<br/>/api/v1/auth/* · /api/health<br/>/api/metrics · /favicon.ico"}

    Q3 -->|是| PASS1["直接放行"]
    Q3 -->|否| Q4{"/register 且注册已关？"}
    Q4 -->|是| REGOFF["307 → /login?registration=disabled"]
    Q4 -->|否| Q5{"是登录/注册页？<br/>/login · /register"}

    Q5 -->|是| AUTHIN["已登录则跳首页；<br/>否则放行并清空身份头"]
    Q5 -->|否| P4{"Access Token 有效？"}

    P4 -->|有效| INJ["注入身份头<br/>x-knowtrace-user-id / role-codes"]
    P4 -->|失效| P5{"有 Refresh Token？"}

    P5 -->|有| RENEW["用 Refresh 换新令牌<br/>成功 → 放行并下发新 Cookie"]
    P5 -->|无| P6{"是 Server Action？<br/>Next-Action 头"}

    P6 -->|是| STRIP["放行但剥掉全部身份头<br/>下游会重新校验并返回结构化错误"]
    P6 -->|否| DENY["307 → /login<br/>（API 请求则 JSON 401）"]

    INJ --> SCOPE
    RENEW --> SCOPE
    PASS1 --> SCOPE
    PASS2 --> SCOPE
    STRIP --> SCOPE

    SCOPE["★ currentDataAccessScope()<br/>src/features/auth/access.ts"]
    SCOPE --> S1{"认证启用？"}
    S1 -->|否| LOCAL["local-owner / isAdmin"]
    S1 -->|是| S2{"有可信身份头？"}
    S2 -->|有| FROMHDR["按 userId + roleCodes 解析"]
    S2 -->|无| S3{"有原生令牌？"}
    S3 -->|有| FROMTOK["回认证后端重新校验"]
    S3 -->|无| S4{"Cookie 会话有效？"}
    S4 -->|无| THROW["抛 AUTH_REQUIRED"]
    S4 -->|有| FROMCOOKIE["按会话身份解析"]

    LOCAL --> FILTER
    FROMHDR --> FILTER
    FROMTOK --> FILTER
    FROMCOOKIE --> FILTER
    FILTER["查询级过滤<br/>captureReadCondition()"]

    classDef enforce fill:#ffe6e6,stroke:#c33,stroke-width:2px
    classDef passthru fill:#eaf7ea,stroke:#393
    class SCOPE,THROW enforce
    class PASS1,PASS2,INJ,RENEW,STRIP,AUTHIN passthru
```

**这张图是本文最有价值的一张**，因为它画出了一个**容易误解的事实**：

> **Proxy 不是安全边界，`currentDataAccessScope()` 才是。**

Proxy 做的是**页面前置门禁**（决定「给不给看这个页面」）；
真正的**数据授权**在每个查询里通过 `captureReadCondition(scope)` 执行。所以：

- **Proxy 放行了不等于有权限**——`STRIP` 那条路径就是例子：
  它故意放行 Server Action，但剥掉身份头，让下游**自己**判断并返回结构化错误。
- **新加一个查询而忘记带 `captureReadCondition`，没有任何东西会拦住它**——
  这是当前鉴权模型的**单点风险**（见第 7 节）。

---

## 3. 数据可见性规则（谁看得到什么）

```mermaid
flowchart LR
    ID["身份 → DataAccessScope"] --> W{"同一 Workspace？"}
    W -->|否| NO["看不到（按不存在处理）"]
    W -->|是| A{"scope.isAdmin？"}
    A -->|是| ALL["全部可见"]
    A -->|否| O{"createdById == 自己？"}
    O -->|是| MINE["可见（且可写）"]
    O -->|否| S{"visibility == shared？"}
    S -->|是| SHARED["可见（只读）"]
    S -->|否| NOPE["看不到"]

    classDef warn fill:#fff4d6,stroke:#c93
    class ALL,SHARED warn
```

**这张图解释了 2026-10-01 那次数据暴露事故**——不是某一条规则错了，是**三条规则叠加**：

1. 新用户自动进默认空间（`ensureLegacyWorkspaceMembership`）
2. 成员可读 `shared`（上图「可见（只读）」那条）
3. **管理员的 `private` 会被 `applyAdminSharingPolicy` 强制改回 `shared`**

⇒ **任何注册者必然能读到管理员的全部记录。** 所以「关闭注册」是唯一的零代码缓解。

---

## 4. 信任边界（三层，可信度不同）

```mermaid
flowchart TB
    subgraph L1["第 1 层 · 公网 —— 不可信"]
        direction LR
        A1["任何人"] --> A2["Caddy :80/:443"]
        A1 --> A3["sshd :22345"]
    end

    subgraph L2["第 2 层 · 宿主机回环 —— 运维可信"]
        direction LR
        B1["nginx :8080"]
        B2["app :3000"]
        B3["auth :8082"]
        B4["postgres :15432"]
        B5["prometheus :9090 · grafana :3001 · alertmanager :9093"]
    end

    subgraph L3["第 3 层 · 容器网络 knowtrace_default —— 内部互信"]
        direction LR
        C1["全部 10 个容器同网段"]
        C2["无网络分段"]
    end

    A2 --> B1
    B1 --> B2
    B2 --> B3
    B2 --> B4
    B2 --> B5

    classDef untrusted fill:#ffe6e6,stroke:#c33
    classDef trusted fill:#eaf7ea,stroke:#393
    classDef caveat fill:#fff4d6,stroke:#c93
    class A1 untrusted
    class B1,B2,B3,B4,B5 trusted
    class C1,C2 caveat
```

**第 3 层的边界要写清楚**（这是已知的收敛点，不是疏忽）：

| 事实 | 影响 |
| --- | --- |
| 10 个容器同网段、**无分段** | 应用容器能直连数据库容器；监控容器也能 |
| 认证服务的 `trustedProxies` 设为 `172.18.0.0/16` | 该网络内**任何容器**都能伪造 `X-Forwarded-For` 绕过 IP 维度限流 |
| 已接受的理由 | 网络内无外部方；**账号维度限流（5 次）仍然生效** |

**若将来要收紧**：把数据库与观测栈拆到独立网络，只让 app 能到 postgres、
只让 prometheus 能到各 exporter。**那是基础设施改动，需要单独规划。**

---

## 5. 代码分层与依赖方向

`docs/06` 第 5 节已给出依赖方向与禁止项，此处只把它画出来：

```mermaid
flowchart LR
    P["Page / Client Component"] --> SA["Server Action / Route Handler"]
    SA --> QS["Query Service / Command Service"]
    QS --> REPO["Repository / Provider Port"]
    REPO --> DRIZ["Drizzle ORM"]
    REPO --> SDK["Vendor SDK（AI Provider）"]
    DRIZ --> DB[("PostgreSQL")]
    SDK --> LLM[("AI Provider")]

    BAD1["Client Component 直接导入数据库"] -.->|禁止| DRIZ
    BAD2["React 组件直接执行 Drizzle 查询"] -.->|禁止| DRIZ
    BAD3["Repository 返回 Next.js Response"] -.->|禁止| REPO

    classDef bad fill:#ffe6e6,stroke:#c33,stroke-dasharray:3 3
    class BAD1,BAD2,BAD3 bad
```

实际落地时，业务规则集中在 **`src/features/*/service.ts`（10 个）**，
而不是 `docs/06` 早期规划里写的根级 `services/`——那里现在只有
subtree 引入的 Go 认证服务。**这一点正是 `AGENTS.md` 曾经写错的地方。**

---

## 6. 与 `docs/06` 的关系

| 文档 | 回答 |
| --- | --- |
| [`06-architecture.md`](06-architecture.md) | **为什么这样选**——取舍、理由、被否掉的方案 |
| **本文** | **实际长什么样**——组件、链路、边界、可见性 |

**`docs/06` 的 5 行流程图保留不动**（它是「架构结论」的一句话表达）；
本文是它的**展开与校正**——补上边缘代理、监控栈、Workspace 隔离，
并更正第 8 节「KnowTrace Compose 服务：app、postgres」的过时描述
（**实际 10 个容器**）。

---

## 7. 维护约定

**改以下任何一处时，回来更新对应的图**：

| 改动 | 更新哪张图 |
| --- | --- |
| 加/删容器、改端口映射 | 第 1 节 部署拓扑 |
| 改 `src/proxy.ts` 的分支 | 第 2 节 鉴权链路 |
| 改 `resource-scope.ts` 或 `applyAdminSharingPolicy` | 第 3 节 可见性规则 |
| 拆网络分段、改 `trustedProxies` | 第 4 节 信任边界 |
| 改服务层分层或依赖方向 | 第 5 节 分层 |

**这五处恰好也是本季度改动最密集的地方**——所以这张图的价值不在于「画得全」，
而在于**它是这几条链路的单一参照**，不必每次去代码里重新挖一遍。

### 一张表：图与已知缺口的对应

| 图 | 对应哪些已知问题 |
| --- | --- |
| 第 2 节 鉴权链路 | 2026-10-01 修的「会话续期从不触发」就发生在 `P5 → RENEW` 那条边 |
| 第 3 节 可见性规则 | 2026-10-01 的数据暴露事故 |
| 第 4 节 信任边界 | 2026-10-01 修的「限流按容器 IP 计数」——`trustedProxies` 那一行 |

**三张图各自对应一次真实事故。** 这不是巧合：
**改动最密集的地方，就是最容易画错、也最需要有一张共同参照的地方。**
