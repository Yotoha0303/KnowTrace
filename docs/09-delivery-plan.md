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

下一阶段再从以下方向选择，而不是全部同时开始：

- 相似记录。
- 主题档案。
- 来源权威性评价、独立结论审核与可靠知识发布。
- 移动端 API。
- 身份和权限。

## 8. 编码前仍需确认

- 提供一个或多个候选 GitHub 仓库地址；如果没有，直接新建。
- 首个 AI Provider 选择 OpenAI 还是 DeepSeek。
- 首个部署目标是本机、NAS、个人服务器还是云平台。
- 是否接受局域网内所有访问者共享全部数据。

这些选择不影响当前文档的数据边界，但会影响初始化和部署配置。

## 9. 简历成果目标

完成首版后可以如实表述：

> 使用 Next.js App Router、TypeScript 和 PostgreSQL 构建 AI 辅助知识采集系统，实现幂等记录、乐观锁修订、多分类管理、模型 Provider 适配、结构化输出校验、可证伪主张与证据状态机，并通过 Docker 与端到端测试完成单实例交付。
