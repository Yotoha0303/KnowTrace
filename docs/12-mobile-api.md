# 移动端 API

## 1. 边界

`/api/v1` 是未来移动 App 和受控客户端的第一版稳定 JSON 契约。它复用 Web 的 Application Service，不建立第二套业务规则。

当前开放低风险记录生命周期与只读知识接口；AI 调用、证据审核、独立复核和发布写操作仍只在 Web 中完成。认证关闭时 API 与本机 Web 一样处于可信环境模式；启用 go-user-system 后，Proxy 会对这些接口返回 JSON `401`，不会跳转登录页。

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

## 6. 兼容规则

- `/api/v1` 内只做向后兼容的字段增加；客户端必须忽略不认识的字段。
- 破坏性字段或语义变化使用新的主版本路径。
- 时间统一返回 ISO 8601 UTC 时点，客户端负责本地化显示。
- 普通 Capture 和 AI 建议不因 API 返回而提升可靠性；只有 `knowledge-releases` 是满足当前发布门槛后冻结的版本。
