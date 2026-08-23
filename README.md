# KnowTrace

KnowTrace 是一个“记录优先、AI 辅助整理”的轻量知识采集系统，面向个人或在同一可信环境中使用的小群体。

用户可以直接输入关键词、想法片段、经历、观察或问题。系统先可靠保存原文，再由 AI 生成候选标题、摘要、少量分类、语义拆分和可逐条选择的局部原文建议。AI 处理结果单独留痕，不会未经确认覆盖原始记录。

## 当前范围

当前版本聚焦九件事：

1. 快速记录原始内容。
2. 手动或 AI 辅助完成内容分类。
3. 保存每一次 AI 处理的输入版本、结果和状态。
4. 从原文中提取少量可证伪主张候选，并由人工决定是否进入证据调查。
5. 对已确认的证据快照运行 AI 可靠性审查，提示覆盖、平衡和待补检查，但不替代人工结论。
6. 统一检索原始记录、主张、证据和人工结论，并按 Category 查看主题档案。
7. 按描述对象回看事件时间线，并生成可回链、可接受或驳回、能识别输入变化的 AI 主题综合档案。
8. 对人工结论执行来源权威性评估、跨身份独立复核和可靠发布，并通过 `/api/v1` 为未来 App 提供稳定数据接口。
9. 通过“数据迁移”导出/导入 Excel：迁移记录原文、对象、时间、状态、分类及关联；导入先预检、再确认，并以单事务写入。

每条记录可以独立保存“描述对象”和“发生时间”。发生时间默认当前时间，可用日历调整；描述对象支持公司、人物、项目等自由文本，并参与全文检索与组合筛选。

当前明确不做：

- KnowTrace 自建另一套密码存储和账号数据库；认证统一由仓库内 `services/go-user-system` 的独立服务负责。Workspace 多租户仍未实现。
- AI 自动联网补证、最终真实性判定和向公网自动分发知识。
- RAG、向量检索和知识图谱。
- 面向大规模团队的复杂分析看板。
- 移动 App。

移动 App 尚未开发，但记录、分类、对象时间线、主张和可靠发布已有版本化 JSON API；契约见 [移动端 API](docs/12-mobile-api.md)。

统一容器栈默认启用 go-user-system 登录。默认只监听本机；在完成 HTTPS、网络隔离和部署加固前仍不应直接暴露到公网。

## 技术方案

- 全栈元框架：Next.js App Router + TypeScript
- UI：React、Tailwind CSS
- 数据库：PostgreSQL
- 数据访问：Drizzle ORM 与 SQL Migration
- 数据校验：Zod
- AI：Provider Adapter，首批兼容 OpenAI/DeepSeek
- 认证后端：仓库内置 go-user-system（Go、MySQL、Redis）
- 部署：根级 Docker Compose 与 Makefile 统一编排
- 测试：Vitest、Testing Library、Playwright

初始化代码时使用当时最新的稳定/LTS 补丁版本，不使用 Preview 或 Canary 作为默认生产基线。

## 核心约束

- 保存记录与调用 AI 是两个独立操作。
- 启动 AI 前必须确认编辑器已完成保存；存在未保存修改时阻止分析并定位到保存按钮，AI 始终读取明确的已保存版本。
- AI 失败不能影响记录保存。
- 原文只通过显式编辑或明确勾选的 AI 局部建议修改，并保留 Revision。
- AI 局部建议在写回前显示整篇原文的修改前/修改后对比；最近一次已采纳整理可整体回退，回退本身生成新 Revision 且不覆盖后续手动工作。
- AI 输出始终绑定具体 Capture 版本。
- AI 分类属于候选建议，合计最多 3 个、新分类最多 1 个；新分类默认不选。
- 再次接受 AI 分类会替换旧 AI 分类关系，但始终保留手动分类。
- 首版中的 Capture 只是记录，不代表内容真实或已经验证。
- AI 主张候选最多 3 个且默认不创建；人工接纳后才成为独立 Claim。
- Claim 按 `candidate → investigating → ready_for_review → concluded` 的受控流程流转，允许退回调查或撤回。
- 至少有 1 条人工采纳的 Evidence 才能进入 `ready_for_review`；该状态仍不表示真实。
- Evidence 采纳前必须通过来源检查，且保存的摘录要能在抓取内容中匹配；每次检查保存不可变元数据快照。
- 调查中的未审核 Evidence 可以编辑；每次编辑保留旧版本，并把当前来源检查重置为待检查。来源 URL 可以留空；无链接 Evidence 上传图片并由本地使用者显式确认图片与摘录一致后，可以采纳并提交待审核。
- 每条 Evidence 可附加最多 5 张 JPEG、PNG、WebP 或 GIF 图片（单张不超过 10 MB），文件保存在项目 `data/uploads/evidence`，数据库保存相对路径、格式、大小和 SHA-256，并可通过网页查看原图。上传本身不等于核验；人工核验会冻结附件快照和组合哈希，后续新增图片会使旧核验失效。
- 来源检查证明“当时可访问且摘录匹配”，不证明来源权威、结论正确或页面永远不变。
- 待审核 Claim 只能形成 `现有证据支持 / 反驳 / 证据不足` 三类人工结论；结论冻结当时使用的 Evidence 与来源哈希，并允许重新调查。
- AI 可靠性审查只读取当时已采纳且来源匹配的 Evidence 快照；覆盖度与正反平衡由服务端确定，结果变化后旧审查明确标记过期。
- AI 主题综合保存当时的主题输入快照和哈希；模型引用的 Capture/Claim ID、依据层级和时间点由服务端重新校验，输入变化后旧档案不能再被接受。
- 可靠发布不是单按钮确认：每条结论证据必须有当前版本的来源权威性评估，至少两类独立来源、至少一条第一手/官方/专业来源，并由不同于结论作者的 go-user-system 登录账号批准独立复核。
- 发布会冻结主张、人工结论、证据来源哈希、权威性评估和独立复核为不可变版本；显式永久删除 Capture 时会级联删除这些版本，避免留下用户已要求删除的内容副本。
- 统一检索按知识对象分组并保留状态与来源回链，检索命中本身不提高内容可靠性。
- 记录详情会按同一对象、共同分类和文字片段显示可解释的相似记录；相似只用于回看，不代表观点一致或内容可靠。
- `occurred_at` 表示内容所描述事件的时间，不等同于记录创建时间；描述对象和发生时间的修改同样进入 Revision。
- 归档可恢复；永久删除必须二次确认，并级联删除版本与 AI 处理历史。

## 本地启动

推荐要求：Docker Desktop、GNU Make 和 Windows PowerShell。首次启动执行：

```bash
make up
```

`make up` 会生成仅保存在 `.env` 的数据库和 JWT 随机密钥，构建并启动 PostgreSQL、MySQL、Redis、go-user-system 和 KnowTrace，执行两套 Migration，并在数据库尚无管理员时创建固定默认管理员。默认用户名为 `KnowTrace`，默认密码为 `KnowTrace@123`。该凭据只适合本机首次登录；重复启动不会覆盖既有管理员或用户后来修改的密码。

如果没有 GNU Make，也可运行：

```powershell
.\scripts\start-all.ps1
```

Migration 会启用 PostgreSQL `pg_trgm` 扩展以支持中文片段检索；受限托管数据库需要管理员预先启用该扩展。

打开 `http://localhost:3000`。默认使用本地规则引擎模拟 AI 整理，不需要 API Key；它用于验证完整审阅流程，不代表事实核验。

### 统一认证后端

go-user-system 源码已迁入 `services/go-user-system`，但继续作为边界独立的 Go 服务运行；KnowTrace 不保存密码。根级 Compose 直接通过内部网络访问 `http://auth:8082`，无需另外克隆或启动认证仓库。账户中心可修改昵称、修改密码、查看自身角色权限，并向有权限的管理员提供角色分配界面。

```dotenv
AUTH_ENABLED=true
AUTH_SERVICE_URL=http://localhost:8082
AUTH_REGISTRATION_ENABLED=false
AUTH_COOKIE_SECURE=false
```

`AUTH_SERVICE_URL` 只供宿主机直接运行 Next.js 开发服务器时使用；统一容器栈固定使用内部服务名。只有确实允许自助注册时才把 `AUTH_REGISTRATION_ENABLED` 改为 `true`。本地 HTTP 保持 `AUTH_COOKIE_SECURE=false`；通过 HTTPS 部署时必须改为 `true`。认证服务异常时请求会被拒绝，不会匿名降级。

当前 go-user-system 已接入的实际能力包括注册（可选）、登录、刷新轮换、退出、个人资料、修改密码、查看角色权限、读取角色/权限目录和管理员分配角色。修改密码会使该账号的全部已有会话失效。上游当前没有用户列表、设备会话列表或按设备撤销接口，因此 KnowTrace 管理员分配角色时需要填写数字用户 ID，也不会展示不存在的单设备会话管理。

如需调用真实模型，可以在记录详情的“AI 整理台”直接输入 OpenAI/DeepSeek API Key，也可以继续在 `.env` 中配置 `OPENAI_API_KEY` 或 `DEEPSEEK_API_KEY` 作为服务端后备值。UI 输入的 Key 只随本次整理请求发送，不写入数据库、AI Run、日志或服务端环境变量；勾选“仅在当前浏览器标签页记住凭据”后，才会写入该标签页的 `sessionStorage`，关闭标签页后失效。

OpenAI/Codex 还支持通过 CC-Switch 本地路由调用。选择 `Codex / OpenAI` 后，默认使用 `CC-Switch（Codex 登录，推荐）`：页面会自动进行不消耗模型额度的健康检查，并提供“测试 AI 连接”按钮，用一个极小请求验证 Codex 登录与模型映射。地址、模型别名和代理令牌收在“高级设置”中，正常使用不需要填写。Docker 默认地址为 `http://host.docker.internal:15721/v1`；该模式使用 `/v1/messages`，由 CC-Switch 管理 OAuth 并把 `claude-` 模型别名映射为 GPT 模型。OAuth token 不应复制到 KnowTrace。

高级的 `CC-Switch OpenAI Responses` 模式使用 `/v1/responses`，要求 CC-Switch 的 Codex Provider 已配置 `base_url`。CC-Switch 地址只允许 `localhost`、回环地址或 `host.docker.internal`，不能借此请求任意远程 URL。若把 CC-Switch 监听地址改成 `0.0.0.0`，应使用系统防火墙限制端口访问范围。

Compose 会把容器内 `/app/data/uploads` 映射到项目的 `data/uploads`。图片文件不会提交到 Git；备份或迁移 KnowTrace 时，需要同时保存 PostgreSQL、go-user-system MySQL 和该上传目录。

“数据迁移”页面生成的 Excel 适合在 KnowTrace 实例间搬运 Capture 与 Category，也便于人工检查。它不是完整备份：不会包含 AI Run、Suggestion、Claim、Evidence、审核/发布快照或图片。重复导入相同记录会跳过；同一稳定标识对应不同内容时会阻止整批导入，不会静默覆盖现有记录。

常用质量检查：

```bash
make check
```

健康检查：`/api/health/live` 只检查进程存活，`/api/health/ready` 同时检查 PostgreSQL；兼容入口 `/api/health` 保留。容器启动时会把超过 5 分钟仍为 running 的 AI Run 或主题综合任务标记为 `AI_RUN_INTERRUPTED`。

统一备份（PowerShell）：

```powershell
# 同时备份 PostgreSQL、go-user-system MySQL 和证据图片
make backup

# 恢复会覆盖当前数据库，必须显式确认
.\scripts\restore.ps1 -BackupPath .\backups\knowtrace-日期.dump -ConfirmDatabaseReset
```

恢复前会停止应用容器，完成后重新启动。认证数据库需要使用 `scripts/backup-auth.ps1` 生成的校验备份另行恢复；所有备份都可能包含敏感信息。

## 文档导航

1. [产品范围](docs/00-product-brief.md)
2. [业务需求](docs/01-requirements.md)
3. [用户流程](docs/02-user-flows.md)
4. [领域模型](docs/03-domain-model.md)
5. [数据库设计](docs/04-database-design.md)
6. [服务端操作契约](docs/05-api-contract.md)
7. [技术架构](docs/06-architecture.md)
8. [AI 处理规范](docs/07-ai-processing.md)
9. [测试与验收](docs/08-test-and-acceptance.md)
10. [开发计划](docs/09-delivery-plan.md)
11. [风险清单](docs/10-risk-register.md)
12. [架构决策记录](docs/adr/README.md)
13. [运行、备份与恢复](docs/11-operations.md)
14. [移动端 API](docs/12-mobile-api.md)
15. [产品愿景完成度审计](docs/13-product-completion-audit.md)

## 首版完成定义

- 首页可以快速记录关键词或想法片段。
- 记录原文、格式和创建时间可靠保存。
- 可以创建、重命名、归档分类。
- 一条记录可以属于多个分类。
- 可以手动指定内容类型和分类。
- 可以主动触发 AI 整理并查看执行状态。
- AI 可以返回标题、摘要、内容类型、少量候选分类和局部原文建议。
- AI 可以返回少量可证伪主张候选，用户可以选择是否创建。
- 可以对主张运行 AI 可靠性审查，并看到处理状态、证据边界、缺口与不可越权提示。
- 可以统一检索记录、主张、证据和结论，并在分类主题档案中回看知识进展。
- 可以按描述对象查看发生时间线，并从 Category 生成带来源回链、人工决策和过期提示的主题综合档案。
- 可以对人工结论评估来源权威性，由不同账号独立复核，并在全部门槛满足后冻结可靠知识版本。
- AI 处理期间显示当前阶段与已等待时间。
- 用户可以接受、修改或拒绝 AI 建议。
- 用户可以在采纳前查看整篇文本前后对比；采纳后若尚未产生后续修改或主张处理，可以整体回退本次 AI 整理。
- 编辑记录时保留历史版本，并阻止并发静默覆盖。
- AI Provider 不可用时，记录、编辑、分类仍然正常。
- 根级 Makefile/Compose 可以在新环境一次启动应用、认证后端和三项数据服务。
- 未来 App 可以通过 `/api/v1` 幂等创建、分页读取、乐观锁更新和有前置版本保护的永久删除 Capture，并读取分类、对象时间线、主张与可靠发布版本。

## 当前实现状态

第一版 Web 应用已实现：快速录入、记录编辑与删除、乐观版本控制、修改历史、多分类、分类管理、归档恢复、AI 结构化整理、处理状态反馈、分类数量约束、可选局部原文建议、来源片段约束、人工接受/修改/驳回，以及 AI 处理历史。P1.1–P1.4 已形成“候选主张—来源检查—证据审核—人工结论—AI 非裁决审查”闭环；P2 已加入统一知识检索、Category 主题档案、对象/时间筛选和可解释的相似记录；P2.6 已完整接入并内置 go-user-system 账号与 RBAC 后端；P2.7 已加入对象时间线及可追溯的 AI 主题综合档案；P2.8 已加入来源权威性评估、身份化独立复核和不可变可靠知识发布版本；P2.9 已交付未来 App 可复用的 `/api/v1` 读取与 Capture 生命周期接口。尚未实现自动联网补证、Workspace 数据隔离、KnowTrace 业务数据的细粒度角色授权、移动 App 和公网发布通道，界面仍不存在含糊的“已验证”入口。

GitHub 仓库：[Yotoha0303/KnowTrace](https://github.com/Yotoha0303/KnowTrace)。
