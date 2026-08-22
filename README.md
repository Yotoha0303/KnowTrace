# KnowTrace

KnowTrace 是一个“记录优先、AI 辅助整理”的轻量知识采集系统，面向个人或在同一可信环境中使用的小群体。

用户可以直接输入关键词、想法片段、经历、观察或问题。系统先可靠保存原文，再由 AI 生成候选标题、摘要、少量分类、语义拆分和可逐条选择的局部原文建议。AI 处理结果单独留痕，不会未经确认覆盖原始记录。

## 当前范围

当前版本聚焦六件事：

1. 快速记录原始内容。
2. 手动或 AI 辅助完成内容分类。
3. 保存每一次 AI 处理的输入版本、结果和状态。
4. 从原文中提取少量可证伪主张候选，并由人工决定是否进入证据调查。
5. 对已确认的证据快照运行 AI 可靠性审查，提示覆盖、平衡和待补检查，但不替代人工结论。
6. 统一检索原始记录、主张、证据和人工结论，并按 Category 查看主题档案。

每条记录可以独立保存“描述对象”和“发生时间”。发生时间默认当前时间，可用日历调整；描述对象支持公司、人物、项目等自由文本，并参与全文检索与组合筛选。

当前明确不做：

- 应用内注册、登录、用户、角色与 Workspace。
- AI 自动联网补证、最终真实性判定和可靠知识发布。
- RAG、向量检索和知识图谱。
- 面向大规模团队的复杂分析看板。
- 移动 App。

没有应用内鉴权意味着该版本只能部署在个人电脑、可信局域网或有外部访问保护的环境中，不应直接暴露到公网。

## 技术方案

- 全栈元框架：Next.js App Router + TypeScript
- UI：React、Tailwind CSS
- 数据库：PostgreSQL
- 数据访问：Drizzle ORM 与 SQL Migration
- 数据校验：Zod
- AI：Provider Adapter，首批兼容 OpenAI/DeepSeek
- 部署：单实例 Docker Compose
- 测试：Vitest、Testing Library、Playwright

初始化代码时使用当时最新的稳定/LTS 补丁版本，不使用 Preview 或 Canary 作为默认生产基线。

## 核心约束

- 保存记录与调用 AI 是两个独立操作。
- AI 失败不能影响记录保存。
- 原文只通过显式编辑或明确勾选的 AI 局部建议修改，并保留 Revision。
- AI 输出始终绑定具体 Capture 版本。
- AI 分类属于候选建议，合计最多 3 个、新分类最多 1 个；新分类默认不选。
- 再次接受 AI 分类会替换旧 AI 分类关系，但始终保留手动分类。
- 首版中的 Capture 只是记录，不代表内容真实或已经验证。
- AI 主张候选最多 3 个且默认不创建；人工接纳后才成为独立 Claim。
- Claim 按 `candidate → investigating → ready_for_review → concluded` 的受控流程流转，允许退回调查或撤回。
- 至少有 1 条人工采纳的 Evidence 才能进入 `ready_for_review`；该状态仍不表示真实。
- Evidence 采纳前必须通过来源检查，且保存的摘录要能在抓取内容中匹配；每次检查保存不可变元数据快照。
- 调查中的未审核 Evidence 可以编辑；每次编辑保留旧版本，并把当前来源检查重置为待检查。每条 Evidence 可附加最多 5 张 JPEG、PNG、WebP 或 GIF 图片（单张不超过 10 MB），文件保存在项目 `data/uploads/evidence`，数据库保存相对路径、格式、大小和 SHA-256。
- 来源检查证明“当时可访问且摘录匹配”，不证明来源权威、结论正确或页面永远不变。
- 待审核 Claim 只能形成 `现有证据支持 / 反驳 / 证据不足` 三类人工结论；结论冻结当时使用的 Evidence 与来源哈希，并允许重新调查。
- AI 可靠性审查只读取当时已采纳且来源匹配的 Evidence 快照；覆盖度与正反平衡由服务端确定，结果变化后旧审查明确标记过期。
- 统一检索按知识对象分组并保留状态与来源回链，检索命中本身不提高内容可靠性。
- `occurred_at` 表示内容所描述事件的时间，不等同于记录创建时间；描述对象和发生时间的修改同样进入 Revision。
- 归档可恢复；永久删除必须二次确认，并级联删除版本与 AI 处理历史。

## 本地启动

要求：Node.js 24、pnpm 11、Docker Desktop。

```bash
docker compose up -d postgres
pnpm install
pnpm db:migrate
pnpm dev
```

Migration 会启用 PostgreSQL `pg_trgm` 扩展以支持中文片段检索；受限托管数据库需要管理员预先启用该扩展。

打开 `http://localhost:3000`。默认使用本地规则引擎模拟 AI 整理，不需要 API Key；它用于验证完整审阅流程，不代表事实核验。

如需调用真实模型，可以在记录详情的“AI 整理台”直接输入 OpenAI/DeepSeek API Key，也可以继续在 `.env` 中配置 `OPENAI_API_KEY` 或 `DEEPSEEK_API_KEY` 作为服务端后备值。UI 输入的 Key 只随本次整理请求发送，不写入数据库、AI Run、日志或服务端环境变量；勾选“仅在当前浏览器标签页记住凭据”后，才会写入该标签页的 `sessionStorage`，关闭标签页后失效。

OpenAI/Codex 还支持通过 CC-Switch 本地路由调用。选择 `Codex / OpenAI` 后，默认使用 `CC-Switch（Codex 登录，推荐）`：页面会自动进行不消耗模型额度的健康检查，并提供“测试 AI 连接”按钮，用一个极小请求验证 Codex 登录与模型映射。地址、模型别名和代理令牌收在“高级设置”中，正常使用不需要填写。Docker 默认地址为 `http://host.docker.internal:15721/v1`；该模式使用 `/v1/messages`，由 CC-Switch 管理 OAuth 并把 `claude-` 模型别名映射为 GPT 模型。OAuth token 不应复制到 KnowTrace。

高级的 `CC-Switch OpenAI Responses` 模式使用 `/v1/responses`，要求 CC-Switch 的 Codex Provider 已配置 `base_url`。CC-Switch 地址只允许 `localhost`、回环地址或 `host.docker.internal`，不能借此请求任意远程 URL。若把 CC-Switch 监听地址改成 `0.0.0.0`，应使用系统防火墙限制端口访问范围。

也可以一次启动完整容器环境：

```bash
docker compose up --build
```

Compose 会把容器内 `/app/data/uploads` 映射到项目的 `data/uploads`。图片文件不会提交到 Git；备份或迁移 KnowTrace 时，需要同时保存 PostgreSQL 备份和该上传目录。

常用质量检查：

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

健康检查：`/api/health/live` 只检查进程存活，`/api/health/ready` 同时检查 PostgreSQL；兼容入口 `/api/health` 保留。容器启动时会把超过 5 分钟仍为 running 的 AI Run 标记为 `AI_RUN_INTERRUPTED`。

备份与恢复（PowerShell）：

```powershell
# 生成并校验 PostgreSQL custom-format 备份，保存在项目 backups/ 下
.\scripts\backup.ps1

# 恢复会覆盖当前数据库，必须显式确认
.\scripts\restore.ps1 -BackupPath .\backups\knowtrace-日期.dump -ConfirmDatabaseReset
```

恢复前会停止应用容器，完成后重新启动。备份文件可能包含全部记录和 AI 结果，应按敏感数据保存。

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
- AI 处理期间显示当前阶段与已等待时间。
- 用户可以接受、修改或拒绝 AI 建议。
- 编辑记录时保留历史版本，并阻止并发静默覆盖。
- AI Provider 不可用时，记录、编辑、分类仍然正常。
- Docker Compose 可以在新环境启动应用和数据库。

## 当前实现状态

第一版 Web 应用已实现：快速录入、记录编辑与删除、乐观版本控制、修改历史、多分类、分类管理、归档恢复、AI 结构化整理、处理状态反馈、分类数量约束、可选局部原文建议、来源片段约束、人工接受/修改/驳回，以及 AI 处理历史。P1.1 已加入“候选主张—证据—人工审核”最小流程和严格状态机；P1.2 已加入带 SSRF 防护的来源检查、内容哈希快照和摘录匹配门槛；P1.3 已加入证据化人工结论、历史快照与可搜索主张库；P1.4 已加入不可越权的 AI 可靠性审查、输入快照与过期提示；P2.1 已加入统一知识检索、中文片段索引和 Category 主题档案。尚未实现自动联网补证、来源权威性评级和多人职责分离，界面仍不存在含糊的“已验证”入口。

GitHub 仓库：[Yotoha0303/KnowTrace](https://github.com/Yotoha0303/KnowTrace)。
