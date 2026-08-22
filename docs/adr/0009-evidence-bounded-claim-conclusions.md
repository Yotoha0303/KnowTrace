# ADR-0009：用证据边界结论替代 verified 布尔值

- 状态：accepted
- 日期：2026-08-15

## 背景

Claim 到 `ready_for_review` 后仍缺少可复用输出。如果只增加 `verified=true`，无法表达反驳、证据不足、结论依据、适用限制以及之后出现的新证据。

## 决策

1. Claim 增加 `concluded` 状态，但不增加 `verified`。
2. 每次结论创建不可变 ClaimReview，assessment 只能为 `supported / refuted / inconclusive`，并要求人工填写依据，可选填写限制。
3. `supported` 至少使用一条支持证据，`refuted` 至少使用一条反驳证据，`inconclusive` 至少使用一条来源确认的采纳证据。
4. ClaimReviewEvidence 复制本次使用的证据、来源 URL、摘录、立场、SourceCheck ID、最终 URL、内容哈希和检查时间。
5. `concluded` 可以重新进入调查；新结论递增 review number，旧结论不可覆盖。
6. 主张库按状态和关键词展示 Claim，并回链到来源 Capture。

## 结果

- 用户得到可以回看和复用的结构化结论，同时能看到证据边界。
- 来源页面后来变化时，历史内容哈希仍能解释当时结论使用的版本。
- 在没有身份系统的当前部署中，“人工结论”不能宣称独立复核或职责分离；如果面向不可信小组或公网，必须先恢复身份与授权模型。
