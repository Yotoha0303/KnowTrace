# 移动端 API

## 1. 边界

`/api/v1` 是未来移动 App 和受控客户端的第一版稳定 JSON 契约。它复用 Web 的 Application Service，不建立第二套业务规则。

当前开放低风险记录生命周期、只读知识接口、AI 整理触发与运行读取；证据审核、独立复核和发布写操作仍只在 Web 中完成。认证关闭时 API 与本机 Web 一样处于可信环境模式；启用 go-user-system 后，Proxy 会对这些接口返回 JSON `401`，不会跳转登录页。管理员读取全部内容；普通成员可读取本人内容和管理员共享内容，但只能修改本人内容。跨成员私有 UUID 访问按不存在处理。

### 认证与客户端头

`/api/v1/auth/*`、健康检查（`/api/health*`）和 `/api/metrics` 是公开路径，其余端点都要求已登录会话。客户端有两种形态，由 `X-Client` 头区分：

| 头 | 值 | 作用 |
|---|---|---|
| `X-Client` | `native` | 声明原生客户端。此时令牌走 `Authorization: Bearer <token>`，不再读写 Cookie |
| `Authorization` | `Bearer <token>` | 原生客户端的访问令牌；刷新与退出时复用同一个头传刷新令牌 |
| `X-Request-Id` | 8–128 字符 | 可选，用于串联请求日志 |

不发送 `X-Client: native` 的请求一律按浏览器 Cookie 客户端处理（`knowtrace_workflow_access_token` / `refresh_token`）。原生客户端不接收 `Set-Cookie`：它没有浏览器 Cookie 罐，Cookie 无法可靠持久化。

### Workspace 上下文

记录、分类、主张等数据都落在某个 Workspace 内。浏览器客户端用 `knowtrace_workflow_workspace_id` Cookie 表示当前 Workspace；原生客户端不用 Cookie，改为在查询串上传 `x-knowtrace-workflow-workspace-id=<uuid>`：

```http
GET /api/v1/captures?x-knowtrace-workflow-workspace-id=00000000-0000-4000-8000-000000000001
Authorization: Bearer <access-token>
X-Client: native
```

客户端提交的 Workspace 只是**优先项**，服务端不直接采信：它会回落到该身份真实拥有的成员关系。
省略时使用默认 Workspace；指定的 Workspace 若当前账号并非成员，**不会报错**，而是静默回落到默认 Workspace。
真正的权限校验发生在服务端解析出最终 Workspace 之后。

## 2. 通用响应

成功：

```json
{
  "ok": true,
  "data": {},
  "meta": {
    "apiVersion": "v1",
    "requestId": "a-request-id"
  }
}
```

失败：

```json
{
  "ok": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "请检查请求参数。",
    "fieldErrors": { "content": ["请输入记录内容"] }
  },
  "meta": {
    "apiVersion": "v1",
    "requestId": "a-request-id"
  }
}
```

客户端可以传入 8–128 字符的 `X-Request-Id`，否则服务端生成 UUID。所有业务响应带 `Cache-Control: private, no-store`。分页接口使用 `page`（1–500）和 `limit`（1–50），响应 `meta` 增加 `hasMore` 与 `nextPage`。

## 3. 端点

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/v1/captures` | 分页读取 active/archived 记录，可按 Category 限制 |
| POST | `/api/v1/captures` | 幂等创建记录，必须提供 `Idempotency-Key` |
| GET | `/api/v1/captures/:id` | 读取记录、Revision、AI 历史、主张与证据 |
| PATCH | `/api/v1/captures/:id` | 使用 `expectedVersion` 乐观锁修改记录 |
| DELETE | `/api/v1/captures/:id` | 永久删除，必须用 `If-Match` 提供当前版本 |
| GET | `/api/v1/categories` | 读取分类与真实记录计数；`includeArchived=true` 包含归档分类 |
| GET | `/api/v1/subjects` | 读取描述对象索引 |
| GET | `/api/v1/subjects/:subject` | 读取按发生时间排序的对象时间线 |
| GET | `/api/v1/claims` | 按状态或关键词分页读取主张 |
| GET | `/api/v1/knowledge-releases` | 分页读取可靠发布快照，可按 `claimId` 限制 |

认证：

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/api/v1/auth/login` | 用户名密码登录；原生客户端额外返回 Bearer 令牌 |
| POST | `/api/v1/auth/refresh` | 用刷新令牌换新的访问令牌；Cookie 客户端由 Proxy 自动调用 |
| POST | `/api/v1/auth/logout` | 退出并使当前会话失效 |
| GET | `/api/v1/auth/session` | 读取当前用户与角色权限；未登录返回 `401` |

Workspace：

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/v1/workspaces` | 读取当前 Workspace 与本账号可访问的 Workspace 列表 |
| POST | `/api/v1/workspaces` | 创建 Workspace（`name`，1–100 字符） |
| DELETE | `/api/v1/workspaces` | 删除**空** Workspace，必须回填 `confirmationName` |
| POST | `/api/v1/workspaces/current` | 切换当前 Workspace（`workspaceId`） |

AI 运行：

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/api/v1/ai-runs` | 触发一次 AI 整理，返回 `runId` 与 `Location` |
| GET | `/api/v1/ai-runs` | 分页读取运行记录，可按 `captureId`、`status` 过滤 |
| GET | `/api/v1/ai-runs/:runId` | 读取单次运行的状态、用量、延迟、错误码与建议内容 |

## 4. 创建示例

```http
POST /api/v1/captures
Content-Type: application/json
Idempotency-Key: mobile-20260823-0001

{
  "title": "一次客户沟通复盘",
  "subject": "某公司",
  "content": "先记录观察，再区分事实和推断。",
  "occurredAt": "2026-08-23T08:00:00.000Z",
  "contentType": "experience",
  "categoryIds": []
}
```

同一个幂等键配合同一请求体会返回同一 Capture；同一个键配合不同请求体返回 `409 CAPTURE_IDEMPOTENCY_CONFLICT`。

## 5. 修改与删除

`PATCH` 正文包含完整可编辑字段和当前 `expectedVersion`。并发版本落后返回 `409 CAPTURE_VERSION_CONFLICT`，`error.details.currentVersion` 提供当前版本。

详情和修改响应使用当前版本作为 `ETag`。永久删除必须把当前 ETag 放入 `If-Match`：

```http
DELETE /api/v1/captures/00000000-0000-4000-8000-000000000000
If-Match: "3"
```

缺少或非法 `If-Match` 返回 `428 PRECONDITION_REQUIRED`；版本落后返回 `409`。删除仍执行与 Web 相同的级联规则和本地证据图片清理。

## 6. 认证示例

原生客户端登录时带上声明头，服务端在响应体里同时返回访问令牌和刷新令牌：

```http
POST /api/v1/auth/login
Content-Type: application/json
X-Client: native

{ "username": "someone", "password": "..." }
```

```json
{
  "ok": true,
  "data": {
    "user": { "id": 2, "username": "someone", "nickname": "…" },
    "tokenType": "Bearer",
    "accessToken": "…",
    "expiresIn": 900,
    "refreshToken": "…",
    "refreshTokenExpiresIn": 604800
  }
}
```

刷新时把**刷新令牌**放进 `Authorization`（原生客户端用同一个头传两种令牌）：

```http
POST /api/v1/auth/refresh
X-Client: native
Authorization: Bearer <refresh-token>
```

登录类错误不再共用一句「账号或密码错误」。客户端应分支处理这些语义码，不要依赖上游数字码：

```text
AUTH_INVALID_CREDENTIALS    账号或密码错误
AUTH_LOGIN_RATE_LIMITED     登录尝试过于频繁
AUTH_ACCOUNT_DISABLED       账号已停用
AUTH_ACCOUNT_NOT_FOUND      账号不存在
AUTH_REFRESH_REJECTED       刷新令牌失效，需重新登录
AUTH_SESSION_EXPIRED        登录会话已过期
AUTH_SERVICE_UNAVAILABLE    认证服务暂时不可用
AUTH_CONTRACT_INVALID       认证服务返回了无法识别的响应
AUTH_REQUIRED               未携带会话
```

## 7. AI 运行

`POST /api/v1/ai-runs` 触发一次 AI 整理。请求体为 `captureId`、`expectedCaptureVersion`，可选 `provider`（`mock` / `openai` / `deepseek`）与 `connection`。成功返回 `201`，响应头带 `Location: /api/v1/ai-runs/<runId>`。

> [!IMPORTANT]
> 这个端点是**同步阻塞**的：服务端等到模型返回才响应，真实模型实测延迟 7–20 秒。
> 客户端必须设置足够长的超时，并且**不要因为等待就重复提交**——每次调用都会新建一个运行
> 并消耗模型额度。异步化（立即返回 `runId`、客户端轮询）尚未实现。

对 AI 整理的写操作在客户端侧只需要「触发 + 读结果」：建议内容通过 `GET /api/v1/ai-runs/:runId` 的 `suggestion` 字段读取，采纳或驳回仍在 Web 端完成。

## 8. 兼容规则

- `/api/v1` 内只做向后兼容的字段增加；客户端必须忽略不认识的字段。
- 破坏性字段或语义变化使用新的主版本路径。
- 时间统一返回 ISO 8601 UTC 时点，客户端负责本地化显示。
- 普通 Capture 和 AI 建议不因 API 返回而提升可靠性；只有 `knowledge-releases` 是满足当前发布门槛后冻结的版本。
