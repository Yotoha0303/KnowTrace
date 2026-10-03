# ADR-0016：多平台客户端与原生令牌认证

- 状态：accepted
- 日期：2026-09-30
- 扩展：ADR-0013、ADR-0014、ADR-0015

## 背景

项目进入多平台应用阶段（`docs/18-mobile-client-plan.md`）。现有认证把 access/refresh 令牌只写入 HttpOnly Cookie，并由 `src/proxy.ts` 在页面级做前置门禁、在服务端数据访问层重新校验角色。这套边界对浏览器成立，对原生客户端不成立：

- 原生 App 没有浏览器 Cookie 罐，`Set-Cookie` 无法可靠持久化；
- 手动回放 Cookie 字符串在刷新、并发请求和退出登录三处会持续出现竞态；
- Proxy 只认 Cookie，原生请求会被当作未登录重定向到登录页。

同时需要确定客户端形态与语音输入的实现位置，避免后续重复决策。

## 决策

### 客户端形态

- 采用 **Expo 原生客户端**，复用现有 `/api/v1` 与 Application Service，不重写业务规则，不新建第二套后端。
- 桌面端用 Tauri 套用现有 Web 构建产物，不单独开发；PWA 不作为主路径。

### 认证

- `/api/v1/auth/*` 增加原生令牌模式：请求带 `X-Client: native` 时，登录与刷新响应体直接返回 `accessToken`、`refreshToken` 及过期时间，客户端存入 Keychain/Keystore。
- 原生客户端以 `Authorization: Bearer <accessToken>` 访问业务接口。
- **服务端不信任任何客户端提交的身份或 Workspace**：`src/features/auth/access.ts` 用回带的令牌重新调用认证后端取得用户与角色，并重新解析 Workspace 成员关系。客户端提交的 Workspace 只是「优先项」，服务端始终回落到该身份真实拥有的成员关系。
- Cookie 流程保持不变，Web 行为零变化。
- 上游数字业务码翻译为语义错误码（`src/features/auth/auth-errors.ts`）。客户端只依赖语义码，上游换号不会破坏客户端分支。

### 语音输入

- 使用**端上转写**（系统语音识别），转成文本后走现有 `/api/v1/captures` 链路，服务端不新增音频存储与转写通道。

## 后果

- 原生与 Web 共用同一套业务规则与数据访问边界，新增写入口必须同时满足两端授权规则。
- 令牌脱离 Cookie 后，XSS 不再是唯一泄露面，客户端存储安全（Keychain/Keystore）成为新的责任点；不得使用明文或非加密存储。
- 客户端可控的 `x-knowtrace-workflow-workspace-id` 只是选择项，越权在服务端被拒绝，不构成新的越权面。
- 语义错误码成为 `/api/v1` 契约的一部分，属于向后兼容的字段增加；删除或改变语义需要新的主版本路径。
- 端上转写意味着语音内容不经过服务端，隐私面更小，但识别质量取决于设备；若后续需要统一识别质量，需另立 ADR 并新增音频通道。
