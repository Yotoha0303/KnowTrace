# 开发计划

## 1. 交付策略

首版把内容记录、分类和一次 AI 整理作为完整最小切片。随后只增加候选主张与证据调查的最小纵向切片；自动查证、最终知识验证和复杂展示继续延期。

## 2. M0：GitHub 复用评估与工程基线

在写业务代码前执行一次短评估：

1. 列出用户希望考虑的 GitHub 仓库。
2. 检查框架版本、许可证、依赖安全、目录结构和部署方式。
3. 检查是否有可复用的编辑器、页面、数据库配置或 Docker 文件。
4. 评估删除不需要的认证/SaaS 逻辑是否比新建更贵。
5. 形成“复用、局部移植或从稳定模板开始”的决定。

如果没有合适仓库，使用官方 `create-next-app` 最新稳定版初始化，不等待额外选择。

工程基线：

- Next.js App Router、TypeScript、Tailwind。
- PostgreSQL、Drizzle、Migration。
- Zod、结构化日志、Request ID。
- Vitest、Playwright、CI。
- Docker standalone 构建。

## 3. M1：Capture

交付：

- 数据库迁移。
- 快速输入 Server Action。
- 最近记录 Server Component 页面。
- Capture 详情。
- 修订历史和乐观锁。
- 归档与恢复。
- 幂等创建。

完成标准：关键词和想法片段可靠保存，网络重试不重复，并发编辑不覆盖。

## 4. M2：Classification

交付：

- Content Type 枚举。
- Category 创建、重命名、归档和恢复。
- Capture 多分类关联。
- 单 Category 页面。
- 手动分类交互。

完成标准：可以不依赖 AI 完成内容分类。

## 5. M3：AI Processing

交付：

- Provider Port。
- OpenAI/DeepSeek Adapter 中至少一个可运行实现；另一个可以随后补充。
- AI Run 与 Suggestion 表。
- Prompt/Schema 版本。
- 结构化结果校验。
- 标题、摘要、类型、分类和语义建议。
- 接受、修改、拒绝及 stale 判断。
- 超时、错误分类和调用记录。

完成标准：AI 建议可以被审阅采用，任何 AI 故障都不会破坏 Capture。

## 6. M4：交付加固

交付：

- 完整错误页面和空状态。
- 单元、集成和端到端测试。
- Docker Compose。
- 健康检查。
- 备份恢复说明。
- 无鉴权部署警告。
- 示例数据和演示流程。

完成标准：满足 P0 发布门槛。

## 7. M5：基于真实使用再规划

收集以下数据后再决定 P1：

- 实际 Capture 数量和内容类型分布。
- Category 数量及重复情况。
- AI Suggestion 直接接受、修改、拒绝比例。
- 模型调用耗时、失败率和费用。
- 最常见的查找与回看方式。

P1.1 已选择并实现“事实核查与证据工作流”的前半段：

- AI 提取最多 3 个可证伪候选，默认不创建。
- 人工接纳为独立 Claim。
- `candidate → investigating → ready_for_review` 严格状态机。
- Evidence 的来源、立场和一次性人工审核。
- 至少一条已采纳 Evidence 的提交门槛。

P1.2 已实现证据来源完整性检查：

- 公共 HTTP(S) 来源抓取与逐跳 SSRF 防护。
- 页面标题、最终 URL、HTTP 状态、内容哈希和检查时间快照。
- 摘录匹配与 Evidence 采纳门槛。
- 重复检查保留历史，不用新结果覆盖旧审计记录。

P1.3 已实现证据化结论与回看：

- `supported / refuted / inconclusive` 人工结论和依据/限制。
- 结论时冻结 Evidence 与 SourceCheck 哈希快照。
- 重新调查与递增 Review 历史。
- 主张库的状态筛选、关键词搜索和来源记录回链。

P1.4 已实现 AI 可靠性与完整性审查：

- 复用 OpenAI、DeepSeek、CC-Switch 和本地规则连接。
- 只分析来源已确认的采纳证据快照，不自动联网补证。
- 提示证据覆盖、正反平衡、来源独立性和待补检查。
- 保存不可变 Audit 与 AI Run，输入变化时标记旧结果过期。
- 不自动修改 Evidence、人工 Review 或 Claim 状态。

P2.1 已实现统一检索与主题档案：

- 跨 Capture、Claim、Evidence 和 ClaimReview 的分组检索。
- 对象类型与 Category 组合限制、来源 Capture 回链和状态展示。
- Category 聚合指标、Claim 状态和最新人工结论。
- `pg_trgm` 中文片段索引、查询长度与返回量边界。

P2.2 已实现记录上下文字段与筛选：

- Capture 和 Revision 的自由文本描述对象与独立发生时间。
- 新建默认本地当前时间、日历调整和 UTC 持久化。
- 描述对象全文命中与部分匹配筛选。
- 按发生日期范围筛选，明确区分事件时间与记录创建时间。

P2.3 已实现无链接图片证据的本地人工核验：

- Evidence 来源 URL 可留空；至少上传一张图片后才能启动附件核验。
- 图片保存在项目上传目录，可在网页中预览并打开原图。
- 使用者显式确认后冻结 Evidence 版本、附件元数据、SHA-256 组合哈希、确认说明和时间。
- 上传不等于核验；Evidence 编辑或新增图片会使当前附件核验失效。
- 附件核验通过后仍需单独采纳，之后才能推动 Claim 提交待审核。
- 当前是本地单一使用者确认，不提供审核者身份或小群体职责分离。

P2.4 已实现 AI 整理的保存前置、整篇对比与安全回退：

- 未保存修改会阻止 AI 调用、说明原因并定位保存按钮，入口显示明确的已保存版本。
- 局部替换的选择实时生成整篇修改前/修改后对比，确认前不改变 Capture。
- 采纳时保存可审计回退快照；最近一次整理可二次确认后整体回退并生成新 Revision。
- 后续正文修改、AI 分类变化或候选主张推进会阻止回退，避免覆盖更晚工作。

P2.5 已实现可解释的相似记录发现：

- Capture 详情页最多展示 5 条历史线索，并回链完整原记录。
- 复用 PostgreSQL `pg_trgm`，以同一描述对象、共同分类和文字片段作为透明信号。
- GiST trigram 近邻查询和固定阈值保持候选有界，不引入向量库或 Embedding 队列。
- 相似关系不持久化、不自动合并内容，也不改变任何可靠性状态。

P2.6–P2.9 已继续交付：

- go-user-system 登录、刷新轮换和 fail-closed 访问保护。
- 对象时间线，以及带来源回链和输入变化检测的 AI 主题综合。
- 来源权威性评价、跨身份独立复核和可靠知识发布。
- 面向未来 App 的 `/api/v1` 记录生命周期与知识读取接口。

### 已完成的迭代前置项：CC-Switch 当前供应商自动识别

状态：已完成。`US-15` 已实现 CC-Switch 状态、实际供应商和路由协议的自动识别；可用路由检测后可直接运行，模型测试作为可选排障入口。未知供应商仍明确标记为未识别。

四项使用中发现的问题已完成并记录于 [`14-deferred-issues.md`](./14-deferred-issues.md)：无变化保存不再增加 Revision、AI 操作不再强制重复连接测试、管理员内容默认共享且成员只读，以及同一用户导入按稳定标识和版本化指纹防重。

### 已完成：v2 主张与证据链交换包

`US-16 / KT-DEFER-005` 已完成：保留 `.xlsx v1` 基础交换表，同时新增 `.zip v2` 知识链交换包，包含 Capture、Category、Claim、Evidence、核验上下文、人工结论上下文、图片 manifest 与真实图片字节。v2 已实现稳定引用、公式与 ZIP 路径安全校验、工作簿和附件 SHA-256/大小/MIME 校验、服务端预检包暂存、确认时重新校验、Capture/Category 基础防重、Claim/Evidence/Attachment provenance 的 `create / skip / repair / conflict`、单事务写入与附件补偿清理。普通 v2 包仍按**安全降级**处理：已采纳、已核验和已结论状态仅作为迁移审计上下文，不能直接恢复可信状态。数据迁移 UI 已同时接入 v1/v2，生产 Docker 构建通过，数据库 migration `0018`/`0019` 已应用。

恢复验收使用两套独立 KnowTrace App + PostgreSQL 实例执行真实 HTTP 导出→预检→确认流程，已经验证空白目标实例恢复、图片在线访问与 SHA-256 一致、同一 actor 第二次导入全量幂等；同一真实目标 PostgreSQL 上还验证第二 actor 会重新创建 Capture/Claim/Evidence/Attachment，并生成独立 provenance，不跨 actor 错误去重。至此 `US-16` 关闭。完整数据库与上传目录备份仍是最高恢复等级。

### 已完成并部署：P3 / US-17 Workspace 数据隔离

P3 已完成数据边界、上下文、迁移、切换和越权验收，不扩展为复杂组织 RBAC、计费或 Agent 权限系统。

已交付：

1. Workspace、Membership 与服务端 Current Workspace Context；现有数据迁移到明确的默认 Workspace。
2. Capture、Category、Claim、Evidence、Review、AI Run、Topic、可靠发布、搜索、附件、API 与 v1/v2 数据迁移统一使用 Workspace 边界。
3. import fingerprint、provenance 与幂等键升级为 Workspace-aware，同一 actor 在不同 Workspace 不会错误去重。
4. `GET/POST/DELETE /api/v1/workspaces` 与 `POST /api/v1/workspaces/current`，切换时服务端重新验证 Membership，并使用 HttpOnly Cookie 保存当前 Workspace。
5. 桌面 Sidebar 与移动导航共用 Workspace Switcher；创建 Workspace 后可直接切换。Workspace 删除采用保守策略：默认空间不可删除、只有 owner 可删除、必须输入完整空间名称确认、仅空 Workspace 可删除；删除当前 Workspace 后服务端自动切回默认空间。
6. `0021_workspace_audit_identity.sql` 为 AI Processing Run 与 Topic Synthesis 增加显式 Workspace/actor 审计身份；历史无法可靠反推的 actor 使用 `legacy-unknown`，不伪造执行者。
7. 跨 Workspace 越权矩阵覆盖 Capture/Category/Claim/Search/Subject、图片 ID、import run ID、v2 export、幂等和 provenance；真实资源与不存在资源保持同类 404。Workspace 删除真实 HTTP 验收还覆盖默认空间保护、member 拒绝、确认名称校验、空空间删除与 Cookie 回退、非空空间 `WORKSPACE_NOT_EMPTY` 保护。

验收结果：production TypeScript/build 通过；Vitest `36` 个测试文件、`141` 项测试全部通过；两套保留旧数据的隔离 App/PostgreSQL 实例已真实完成 `0020 → 0021` 升级，并执行 Workspace 删除安全矩阵；正式实例已部署包含安全删除能力的最新 App，PostgreSQL/Auth/MySQL/Redis 均恢复 healthy。至此 `US-17` 关闭。

### 下一开发阶段：P4 / US-18 移动 App

P3 已完成并验收，因此后续可以启动 P4。移动 App 首期以现有服务端 API 为唯一业务真相源，优先完成登录、Workspace 选择、快速记录、最近记录、基础搜索、记录详情和图片 Evidence 上传的真实设备闭环。

移动端技术栈在 P4 启动时再评估 React Native/Expo、Flutter 等方案；当前不锁定实现框架，也不以简单 WebView 包装网页作为完成标准。移动 App 不直接连接数据库或本地上传目录，权限、幂等、可信状态和 Workspace 边界继续由服务端统一执行。

## 8. 编码前仍需确认

- 提供一个或多个候选 GitHub 仓库地址；如果没有，直接新建。
- 首个 AI Provider 选择 OpenAI 还是 DeepSeek。
- 首个部署目标是本机、NAS、个人服务器还是云平台。
- 是否接受局域网内所有访问者共享全部数据。

这些选择不影响当前文档的数据边界，但会影响初始化和部署配置。

## 9. 简历成果目标

完成首版后可以如实表述：

> 使用 Next.js App Router、TypeScript 和 PostgreSQL 构建 AI 辅助知识采集系统，实现幂等记录、乐观锁修订、多分类管理、模型 Provider 适配、结构化输出校验、可证伪主张与证据状态机，并通过 Docker 与端到端测试完成单实例交付。
