# 数据库设计

## 1. 设计原则

- PostgreSQL 是唯一事实来源。
- 主键使用 UUID，生成方式在项目初始化时统一。
- 时间字段使用 `timestamptz` 并保存 UTC。
- 业务枚举使用数据库约束或受控文本值，避免任意字符串。
- 核心关系使用关系表；AI 可演进输出使用带版本的 JSONB。
- 不创建用户、会话、Workspace、成员和 Refresh Token 表。

## 2. 表结构

### captures

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | 主键 |
| title | varchar(200) | 可空 |
| content | text | 当前原始内容 |
| content_type | varchar(30) | 默认 unknown |
| status | varchar(20) | active/archived |
| version | integer | 初始为 1 |
| idempotency_key | varchar(128) | 创建幂等键 |
| archived_at | timestamptz | 可空 |
| created_at | timestamptz | 创建时间 |
| updated_at | timestamptz | 更新时间 |

约束与索引：

- `unique(idempotency_key)`
- `(status, created_at desc, id desc)`
- `char_length(content) between 1 and 20000`
- `version > 0`

### capture_revisions

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | 主键 |
| capture_id | uuid | 外键 |
| version | integer | 历史版本 |
| title | varchar(200) | 当时标题 |
| content | text | 当时正文 |
| content_type | varchar(30) | 当时类型 |
| created_at | timestamptz | 快照时间 |

约束：

- `unique(capture_id, version)`
- Revision 只允许 INSERT 和 SELECT。

### categories

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | 主键 |
| name | varchar(60) | 展示名称 |
| normalized_name | varchar(80) | 唯一比较值 |
| description | varchar(500) | 可空 |
| status | varchar(20) | active/archived |
| created_at | timestamptz | 创建时间 |
| updated_at | timestamptz | 更新时间 |

约束：

- `unique(normalized_name)`
- 规范化至少包含 Unicode 空白整理和大小写处理；具体算法必须有测试。

### capture_categories

| 字段 | 类型 | 说明 |
|---|---|---|
| capture_id | uuid | 联合主键、外键 |
| category_id | uuid | 联合主键、外键 |
| assigned_by | varchar(20) | manual/ai_accepted |
| created_at | timestamptz | 创建时间 |

主键：`(capture_id, category_id)`。

### ai_processing_runs

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | 主键 |
| capture_id | uuid | 输入 Capture |
| capture_version | integer | 输入版本 |
| input_hash | varchar(64) | 输入摘要，用于审计 |
| task_type | varchar(40) | organize/claim_audit |
| provider | varchar(40) | Provider 标识 |
| model | varchar(80) | 模型标识 |
| prompt_version | varchar(40) | Prompt 版本 |
| schema_version | varchar(40) | 输出 Schema 版本 |
| status | varchar(20) | running/succeeded/failed/cancelled |
| input_tokens | integer | 可空 |
| output_tokens | integer | 可空 |
| latency_ms | integer | 可空 |
| error_code | varchar(80) | 可空、脱敏 |
| request_id | varchar(80) | 调用关联标识 |
| started_at | timestamptz | 开始时间 |
| completed_at | timestamptz | 可空 |
| created_at | timestamptz | 创建时间 |

索引：

- `(capture_id, created_at desc)`
- `(status, started_at)` 用于清理超时 running 状态。

### ai_suggestions

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | 主键 |
| processing_run_id | uuid | 唯一外键 |
| capture_id | uuid | 来源 Capture |
| source_capture_version | integer | 来源版本 |
| schema_version | varchar(40) | Payload Schema |
| payload | jsonb | 通过校验的结构化建议 |
| status | varchar(20) | pending/accepted/modified/rejected/stale/rolled_back |
| accepted_payload | jsonb | 保存用户确认结果、采纳前回退快照和可选回退结果 |
| decided_at | timestamptz | 可空 |
| created_at | timestamptz | 创建时间 |

约束：

- `unique(processing_run_id)`
- 决策状态与 `decided_at` 保持一致。

### claims

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | 主键 |
| capture_id | uuid | 来源 Capture，删除时级联 |
| source_suggestion_id | uuid | 来源 Suggestion，可空 |
| source_capture_version | integer | 候选产生时的版本 |
| statement | varchar(1000) | 可证伪陈述 |
| statement_hash | varchar(64) | 来源与规范化陈述的去重摘要 |
| source_excerpt | varchar(1000) | 原文逐字片段 |
| falsification_criteria | varchar(1000) | 可削弱或反驳该主张的条件 |
| status | varchar(30) | candidate/investigating/ready_for_review/withdrawn |
| created_at / updated_at | timestamptz | 时间 |

约束：`unique(statement_hash)`，来源版本大于 0。状态转换由 Application Service 白名单控制。

### claim_evidence

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | 主键 |
| claim_id | uuid | 所属 Claim，删除时级联 |
| source_url | varchar(2000) | 可选 HTTP(S) 来源，空字符串表示无链接 |
| source_title | varchar(300) | 来源标题 |
| excerpt | varchar(2000) | 证据摘录 |
| stance | varchar(20) | supports/contradicts/context |
| note | varchar(1000) | 可空 |
| version | integer | 乐观锁与修订版本，从 1 开始 |
| review_status | varchar(20) | unreviewed/accepted/rejected |
| reviewed_at | timestamptz | 可空 |
| source_check_status | varchar(20) | unchecked/passed/failed |
| source_excerpt_match | boolean | 当前检查是否匹配摘录 |
| source_checked_at | timestamptz | 当前检查时间 |
| latest_source_check_id | uuid | 当前检查快照 ID |
| created_at / updated_at | timestamptz | 创建与最近编辑时间 |

### claim_evidence_revisions

保存 Evidence 编辑前的不可变完整字段快照、旧版本号与当时的 `latest_source_check_id`。`(evidence_id, version)` 唯一；编辑事务写入 Revision 后递增当前版本，并将来源检查投影重置为 unchecked。

### evidence_attachments

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | 主键，也是读取图片时的公开标识 |
| evidence_id | uuid | 所属 Evidence，删除时级联 |
| original_name | varchar(255) | 清理控制字符后的原文件名 |
| storage_path | varchar(255) | 项目上传目录内的不可推测相对文件名，唯一 |
| mime_type | varchar(40) | 从文件头确认的受控图片类型 |
| byte_size | integer | 1 到 10 MB |
| sha256 | varchar(64) | 文件内容哈希 |
| created_at | timestamptz | 上传时间 |

图片二进制不写入 PostgreSQL。数据库级联删除后，服务层删除对应项目文件；文件清理失败最多留下无数据库引用的孤儿文件，不允许造成数据库回滚或记录丢失。

### evidence_source_checks

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | 主键 |
| evidence_id | uuid | 所属 Evidence，删除时级联 |
| verification_method | enum | web/manual_attachment |
| requested_url / final_url | varchar(2000) | 请求与重定向后的最终地址 |
| status | varchar(20) | passed/failed |
| http_status | integer | 可空 |
| content_type | varchar(120) | 可空 |
| content_hash | varchar(64) | 成功时的 SHA-256 |
| fetched_title | varchar(300) | 抓取页面标题，可空 |
| excerpt_match | boolean | 成功时是否匹配摘录 |
| response_bytes | integer | 响应体字节数 |
| error_code | varchar(80) | 失败时的稳定错误码 |
| attachment_snapshot | jsonb | 附件人工核验冻结的 ID、文件名、MIME、大小与 SHA-256 |
| verification_note | varchar(1000) | 附件人工核验的固定确认说明 |
| checked_at | timestamptz | 检查时间 |

SourceCheck 只允许 INSERT/SELECT。`web` 遵守 HTTP 抓取结果约束；`manual_attachment` 必须成功、摘录确认匹配、至少冻结一张附件并保存确认说明。`claim_evidence.latest_source_check_id` 是事务内维护的当前投影标识；历史检查不会被覆盖，Evidence 编辑或新增附件只清除当前投影。

### claim_reviews

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | 主键 |
| claim_id | uuid | 所属 Claim，删除时级联 |
| review_number | integer | Claim 内递增版本 |
| assessment | varchar(20) | supported/refuted/inconclusive |
| rationale | varchar(2000) | 人工结论依据 |
| limitations | varchar(2000) | 限制与未知，可空 |
| created_at | timestamptz | 结论时间 |

约束：`unique(claim_id, review_number)`；Review 只追加。

### claim_review_evidence

联合主键为 `(review_id, evidence_id)`。除 Evidence 和 SourceCheck ID 外，还复制该次结论使用的来源 URL、标题、摘录、立场、最终 URL、内容 SHA-256 与检查时间，保证历史结论可以独立解释。

### claim_ai_audits

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | 主键 |
| processing_run_id | uuid | 唯一关联 AI Run |
| claim_id | uuid | 所属 Claim，删除时级联 |
| source_claim_updated_at | timestamptz | 审查使用的 Claim 时点 |
| source_evidence_fingerprint | varchar(64) | 已确认采纳证据集合摘要 |
| schema_version | varchar(40) | 输出 Schema 版本 |
| evidence_snapshot | jsonb | 本次输入的证据与来源检查快照 |
| payload | jsonb | 校验后的覆盖、平衡、问题与建议 |
| created_at | timestamptz | 审查时间 |

Audit 只追加。当前 Claim 时间或证据指纹与快照不一致时，查询 DTO 把它标记为 stale，不覆盖旧记录。

## 3. 核心事务

### 创建 Capture

1. 校验正文。
2. 用 idempotency_key 查询已有请求。
3. 不存在则创建 Capture。
4. 事务提交后返回成功。

相同幂等键但不同请求体必须返回冲突，而不是复用旧结果。

### 修订 Capture

同一事务中：

1. 查询当前 Capture。
2. 检查 `version = expected_version`。
3. 把当前值写入 Revision。
4. 条件更新 Capture 并增加版本号。

```sql
UPDATE captures
SET title = $1,
    content = $2,
    content_type = $3,
    version = version + 1,
    updated_at = now()
WHERE id = $4
  AND version = $5;
```

### 接受或回退 AI 整理

同一事务中：

1. 锁定 pending Suggestion。
2. 检查来源版本与当前 Capture 版本。
3. 创建或查找被接受的 Category。
4. 幂等写入 capture_categories。
5. 如果标题或 Content Type 改变，按 Capture 修订规则写入 Revision 并增加版本。
6. 在 accepted payload 保存采纳前核心字段、AI 分类、应用版本和本次新建 Claim ID，再更新 Suggestion 决策状态。

正文只允许应用用户明确勾选且原片段仍唯一匹配的局部建议，并遵循 Capture 修订规则。

整体回退锁定已采纳 Suggestion 和 Capture，要求它仍是最近一次已采纳整理、Capture 版本与应用后版本一致、AI 分类未变化且本次 Claim 仍为 candidate。事务恢复采纳前核心字段与 AI 分类、删除这些 candidate Claim、写入新 Revision，并把 Suggestion 设为 rolled_back；任一检查失败都不得局部回退。

### 接纳候选主张与提交审核

- 只有用户明确勾选的 `claimCandidateIndexes` 才创建 Claim，单次最多 3 个。
- `statement_hash` 防止同一来源版本的同一陈述被重复创建。
- Evidence 只能在 Claim 为 `investigating` 时新增、编辑、上传图片、检查来源或审核；编辑与上传还要求 Evidence 为 `unreviewed`。
- 采纳 Evidence 时同时检查最新来源状态为 passed、摘录匹配且快照 ID 未被并发替换。
- 形成结论时先条件更新 `ready_for_review → concluded`，再在同一事务写入 Review 和 Evidence 快照；任一步失败全部回滚。
- `investigating → ready_for_review` 在事务中统计已采纳证据；数量为 0 时拒绝。
- 状态更新同时匹配 `id + expectedStatus`，避免并发静默覆盖。

## 4. AI 调用崩溃恢复

首版是请求内同步调用，但 Run 会在调用前写入 running。如果进程崩溃，Run 可能停留在 running。

容器启动时在 Migration 之后执行维护脚本，把超过 `AI_RUNNING_STALE_AFTER_MS`（默认 5 分钟）的 running AI Run 与主题综合任务标记为 failed，并使用 `AI_RUN_INTERRUPTED` 错误码。该脚本也可以通过 `pnpm db:maintenance` 手动执行。

## 5. 迁移要求

- Drizzle Schema 不是唯一文档；必须生成并提交 SQL Migration。
- 已执行 Migration 不修改，只追加。
- CI 在空数据库执行全部 Migration。
- 生产部署前进行备份和恢复演练。

## 6. 统一检索索引

Migration `0005_knowledge_search.sql` 启用 PostgreSQL `pg_trgm`，为 Capture、Claim、Evidence 和 ClaimReview 的组合文本表达式创建 GIN trigram 索引。这样可以支持中文关键词和不完整片段的 `ILIKE '%query%'` 查询，而不依赖 PostgreSQL 内置英文分词。

查询表达式必须与索引表达式保持一致；用户输入参数化并转义 `%`、`_` 和反斜杠。该扩展可能需要数据库管理员权限，受限托管环境应在迁移前预先启用。

## 7. 描述对象与发生时间

Migration `0006_capture_subject_and_occurred_at.sql` 为 Capture 和 Revision 增加 `subject` 与 `occurred_at`。现有 Capture 以自身 `created_at` 回填发生时间；旧 Revision 继承所属 Capture 的回填值，避免迁移时刻伪装成历史事件时间。

Migration `0010_capture_similarity_search.sql` 在 Capture 的标题、描述对象和正文组合表达式上增加 GiST `gist_trgm_ops` 索引，用于有界近邻候选查询。相似分数不持久化；详情读取时再结合共同 Category 和同一描述对象排序。

- `subject varchar(200)` 可空，是公司、人物、项目等自由文本，不建立强制实体表。
- `occurred_at timestamptz not null` 保存事件时点，默认 `now()` 只作为新建请求的数据库后备。
- `captures_occurred_idx` 支持日期范围筛选。
- `captures_subject_trgm_idx` 支持描述对象部分匹配；组合全文索引同时包含标题、描述对象和正文。

## 8. AI 主题综合快照

Migration `0011_topic_syntheses.sql` 增加 `topic_syntheses`。每次生成先插入 `running` 行，再调用 Provider；成功保存结构化 payload，失败只记录错误和耗时，不覆盖旧档案。

- `source_snapshot jsonb` 冻结当时最多 100 条活跃 Capture、相关 Claim、最新人工 Review 与有效证据数量。
- `source_hash` 对稳定序列化后的快照计算 SHA-256，用于读取时判断过期。
- `status` 表示执行状态，`decision` 独立表示人工接受或驳回；只有 `succeeded + pending + 未过期` 可以决策。
- `provider/model/prompt_version/schema_version/request_id/token/latency` 保留运行审计。
- Category 删除时级联删除综合历史；Capture、Claim 或 Review 变化不会修改旧快照，只会使其过期。
