# 业务需求

## 1. 术语

- **Capture**：用户原始记录及其当前版本。
- **Revision**：Capture 编辑前保存的不可变历史快照。
- **Content Type**：记录的主要内容形态，单选。
- **Category**：用户维护的主题分类，多选。
- **AI Run**：一次 AI 处理执行记录。
- **AI Suggestion**：AI Run 产生的候选整理结果。

## 2. 内容类型

首版固定枚举：

```text
keyword_set       关键词集合
thought_fragment  想法片段
experience        经历记录
observation       观察记录
question          问题
source_note       资料摘录
mixed             混合内容
unknown           尚未判断
```

Content Type 只描述形态，不表示真假。例如 `observation` 表示用户记录了一项观察，不代表该观察已被外部验证。

## 3. 用户故事

### US-01 快速保存

作为使用者，我希望只输入一段内容就能保存，以免整理过程打断想法。

验收标准：

- 正文至少有一个非空白字符。
- 标题、Content Type 和 Category 都可以为空。
- 描述对象可以为空；发生时间默认浏览器当前时间并允许通过日期时间选择器调整。
- 发生时间描述内容中的事件时间，不使用创建时间替代用户明确选择的时间。
- 服务端不自动重写标点、换行和词序。
- 数据库提交成功后才能显示保存成功。
- AI 调用不出现在保存事务中。

### US-02 手动分类

作为使用者，我希望给记录指定内容类型和多个主题分类。

验收标准：

- 一条 Capture 最多一个 Content Type。
- 一条 Capture 可以关联零个或多个 Category。
- 重复关联同一 Category 保持幂等。
- 已归档 Category 不能新增关联，但原有关系保留。
- 修改分类不创建正文 Revision，但需要更新时间。

### US-03 管理分类

作为使用者，我希望创建和维护自己的主题分类。

验收标准：

- Category 名称必填并进行规范化后唯一判断。
- 没有关联任何 Capture 的 Category 可以在二次确认后永久删除；有关联记录时必须拒绝，记录是否归档不影响该限制。
- 支持重命名和归档。
- MVP 不做无限层级目录；Category 为扁平结构。
- Category 归档不影响 Capture 本身。

### US-04 修订内容

作为使用者，我希望修改内容但保留旧版本。

验收标准：

- 更新时提交 `expected_version`。
- 更新前正文、标题、类型和版本写入 Revision。
- 版本冲突返回明确错误，不覆盖较新的版本。
- Revision 只读。

### US-05 AI 整理

作为使用者，我希望主动让 AI 整理某个版本的记录。

验收标准：

- 先保存 Capture，再触发 AI。
- 编辑器存在未保存修改时阻止调用，明确提示先保存并把焦点移到保存按钮；调用入口显示将要分析的版本号。
- 创建 AI Run 后立即记录 `provider/model/prompt_version/capture_version`。
- Run 最终进入 succeeded、failed 或 cancelled。
- AI 返回值必须通过结构校验后才能生成 Suggestion。
- AI 错误不能改变 Capture 或分类。

### US-06 处理 AI 建议

作为使用者，我希望检查建议后选择接受、修改或拒绝。

验收标准：

- Suggestion 显示来源 Capture 版本。
- Capture 已更新时明确标记建议过期。
- 接受标题、Content Type 或 Category 必须是显式操作。
- 接受标题或 Content Type 时复用 Capture 修订规则并增加版本；只接受 Category 时不增加正文版本。
- 摘要和语义单元保留在 Suggestion 中，不替换原文。
- 勾选局部原文建议时，实时显示基于已保存版本的整篇修改前/修改后对比，确认前不写回。
- 最近一次 accepted/modified Suggestion 保存采纳前快照；没有后续 Capture 修改、AI 分类变化或候选主张推进时，允许整体回退并生成新的 Revision。
- 整体回退恢复标题、正文、Content Type 和 AI 分类，删除本次新建且仍为 candidate 的主张；保留手动分类、Suggestion 和版本历史。
- 每个 Suggestion 只允许完成一次最终决策。

### US-07 回看最近记录

作为使用者，我希望按时间查看最近内容，并能进入某个分类。

验收标准：

- 默认按创建时间和 ID 倒序。
- 支持稳定游标分页。
- 可以查看某一个 Category 下的记录。
- 暂不支持多个条件组合筛选。

### US-08 AI 可靠性审查

作为使用者，我希望 AI 帮我检查主张的证据是否单一、不完整或缺少反例，但不能替我决定真假。

验收标准：

- 只使用已采纳、来源通过且摘录匹配的 Evidence。
- 运行时显示处理状态和等待时间。
- 结果包含证据覆盖、正反平衡、问题与待补检查，并固定显示非事实裁决边界。
- 审查保存输入快照、指纹、Provider、模型、耗时和状态。
- 审查不修改 Claim、Evidence、人工 Review 或状态；输入变化后旧结果标记过期。

### US-09 统一检索与主题档案

作为使用者，我希望凭一段不完整线索同时找到相关原文、主张、证据和结论，并能按主题回看知识进展。

验收标准：

- 检索词最多 100 个字符，按对象类型和 Category 组合限制结果。
- 描述对象自由填写、最多 200 字，并同时支持全文命中和独立部分匹配筛选。
- 发生时间支持开始/结束日期筛选，首次进入检索页时两者默认当前日期，结束日期包含当天全部时间；用户可以清空日期查询全部时间。
- 每类结果有界返回，显示对象状态、Category 和来源 Capture 回链。
- Capture、Claim、Evidence 和人工 Review 必须分组展示，不混成无来源摘要。
- Category 页面显示活跃/归档记录、Claim 状态、Evidence 数量、有效采纳证据与最新人工结论。
- 检索与主题档案只读，不改变任何业务状态。

### US-10 无链接证据人工核验

作为使用者，我希望微信截图、聊天记录、现场照片或线下材料即使没有公共网页链接，也能经过明确、可追溯的人工核验后进入证据采纳流程。

验收标准：

- 来源 URL 可以留空；无链接 Evidence 至少上传一张图片后才能进行人工核验。
- 每张图片可以在网页中预览并打开原图；文件仍保存在项目上传目录。
- 人工核验前必须显式确认已查看全部图片，且保存的摘录与附件内容一致。
- 核验记录区分 `web` 与 `manual_attachment`，并保存固定确认说明、时间和所使用的附件。
- 核验记录必须绑定 Evidence 版本与附件 SHA-256；Evidence 或附件变化后旧核验不得继续生效。
- “已保存”“已核验”“已采纳”必须是不同状态，上传图片不能自动推进状态。
- 人工核验通过后仍需单独点击采纳；至少一条已采纳证据后才能提交待审核。
- 当前只记录本地使用者的显式确认；小群体审核者身份、权限和职责分离仍需后续实现。

### US-11 相似记录发现

作为使用者，我希望打开一条记录时看到过去相似的对象、主题或场景，从而复用以前的经验。

验收标准：

- 最多返回 5 条其他 Capture，不返回当前记录，每条都能回到完整原文。
- 命中原因必须显示同一描述对象、共同分类或文字相似度，不提供无解释推荐。
- 只有共同分类但几乎没有文字重合时不能入选，避免大分类产生大量噪声。
- 活跃和归档记录均可作为历史线索，并明确显示状态和发生日期。
- 相似结果只读且实时计算，不创建关系边，不改变任何知识可靠性状态。
- 页面明确声明相似不代表观点一致、内容真实或已经验证。

### US-12 描述对象时间线

作为使用者，我希望按公司、人物或项目回看相关事件，避免把记录时间误当成事件发生时间。

验收标准：

- 对象索引只统计活跃 Capture，并按标准化后的非空描述对象聚合。
- 时间线按 `occurred_at` 升序展示记录、分类、主张和最新人工审核。
- 页面明确区分事件发生时间、记录写入时间与人工审核时间。
- 对象名称可以回到全文检索继续组合筛选。

### US-13 AI 主题综合档案

作为使用者，我希望 AI 把一个 Category 中的散碎材料归纳为系统化档案，同时能检查每个要点来自哪里。

验收标准：

- 调用 AI 前冻结最多 100 条活跃 Capture、相关 Claim、最新人工 Review 和有效证据数量，并保存输入哈希。
- AI 输出通过结构化 Schema；引用的 Capture/Claim ID、依据层级、时间点和边界提示由服务端确定性校验。
- 综合结果区分人工审核依据、候选主张依据和原始记录依据，不把三者混成已证实事实。
- 每次运行保存 Provider、模型、状态、耗时、Token、错误和输入快照；失败不覆盖既有成功档案。
- 成功结果需要人工接受或驳回；当前输入变化后旧结果标记过期且禁止接受。
- OpenAI、DeepSeek、CC-Switch 和本地规则共用现有连接配置；UI 凭据不持久化到数据库。

## 4. 状态

Capture：

```text
active
archived
```

Category：

```text
active
archived
```

AI Run：

```text
running
succeeded
failed
cancelled
```

AI Suggestion：

```text
pending
accepted
modified
rejected
stale
```

Claim：

```text
candidate
investigating
ready_for_review
concluded
withdrawn
```

Evidence Review：`unreviewed / accepted / rejected`。Evidence Source Check：`unchecked / passed / failed`。`passed` 仅表示安全抓取成功；Evidence 仍需摘录匹配和人工采纳。

Claim Assessment：`supported / refuted / inconclusive`。Assessment 描述“基于冻结证据的当前判断”，不是脱离时间与上下文的真实性布尔值。

AI Audit Recommendation：`supported / refuted / inconclusive / needs_more_evidence`。它只能作为人工判断建议，不是 Claim 状态或结论。

## 5. 数据限制

- Capture 正文：1～20,000 个 Unicode 字符，可配置。
- Capture 标题：最多 200 个字符。
- Capture 描述对象：最多 200 个字符，可空。
- Capture 发生时间：必填 ISO 时间；新建时由浏览器当前时间初始化。
- Category 名称：1～60 个字符。
- 每条 Capture 最多关联 20 个 Category。
- 每次 AI 最终展示最多 12 个语义单元、3 个候选分类（其中新分类最多 1 个）、5 条局部原文建议和 10 个待补充问题。
- 所有时间保存为 UTC。

## 6. 非功能需求

### 可靠性

- 创建和修订使用数据库事务。
- 创建支持幂等键，网络重试不产生重复记录。
- AI Run 先落库再调用供应商，调用完成后保存结果。
- 供应商超时后 Run 必须结束为 failed，不能长期停留 running。

### 性能

- 不调用 AI 时，单实例本地环境创建 Capture 的 P95 目标小于 500ms。
- 最近列表默认 20 条，最大 100 条。
- 首版按单实例、20 个同时访问者设计。
- 中文片段检索使用 `pg_trgm` 索引；统一检索每类最多返回 50 条，页面默认 20 条。

### 安全

- 应用不包含身份和授权，必须在文档与部署页面显示该限制。
- AI API Key 可以来自服务端环境变量，也可以由用户在 AI 整理台为单次请求提供；UI Key 不写入数据库、AI Run 或服务端日志。
- UI Key 只有在用户明确勾选时才保存到当前标签页的 `sessionStorage`，关闭标签页后失效。
- 日志不记录完整正文、Prompt、API Key 或供应商原始敏感错误。
- OpenAI 的 CC-Switch 地址只允许本机白名单地址和 `/v1` 路径，不允许客户端指定任意远程 Provider Base URL。
- Evidence 来源检查只允许标准端口 HTTP(S) 公网地址；DNS 和每次重定向都必须经过 SSRF 地址策略，响应体限制为 1 MB。

### 可观测性

- 每个写操作和 AI Run 有可关联的 request_id。
- 记录路由、耗时、状态、错误码。
- AI 日志记录 provider、model、task、latency、token usage，不记录全文。

## 7. 统一错误格式

```json
{
  "error": {
    "code": "CAPTURE_VERSION_CONFLICT",
    "message": "记录已经更新，请刷新后重试",
    "request_id": "req_01...",
    "details": {}
  }
}
```
