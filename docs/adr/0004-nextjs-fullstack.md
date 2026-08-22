# ADR-0004：采用 Next.js 全栈单体

- 状态：accepted
- 日期：2026-08-14
- 替代：ADR-0001 的 Go API 技术方案

## 背景

当前项目规模很小，主要功能是记录、分类、AI 调用和简单页面。用户不再限制基础语言，并希望前端尽量采用最新的稳定元框架。

## 决策

首版采用 Next.js App Router + TypeScript 全栈单体和 PostgreSQL。使用当前 Active LTS 系列的最新安全补丁，不使用 Preview/Canary 作为默认生产基线。

读取优先使用 Server Components，UI 修改使用 Server Actions，健康检查和未来外部 API 使用 Route Handlers。核心规则放在独立 Application Service 中。

## 原因

- 减少独立前后端 DTO、接口和部署工作。
- 更快形成可用版本。
- 保留通过 Application Service 演进到 App API 或独立后端的可能。

## 后果

正面：

- 单仓库和单应用部署。
- TypeScript 和 Zod 可以共享输入/输出契约。
- 适合快速验证真实记录和 AI 分类效果。

代价：

- 不再以 Go 后端能力训练为首要目标。
- 必须约束框架、业务和数据库依赖方向。
- AI 长任务增长后需要独立 Worker。

## 复查条件

- 需要移动 App 的稳定公共 API。
- AI 任务需要独立伸缩。
- 应用业务复杂度超出单体可维护范围。
