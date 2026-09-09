# ISSUE-S3-006：验证事件与 ECS source 字段映射冲突

- 范围：Logstash → Elasticsearch 端到端验收。
- 状态：已关闭。
- 修复 commit：`2bd564b`。
- 影响：验证事件进入 Logstash，但 Elasticsearch 以 400 拒绝并写入 DLQ。

## 证据

当时索引已经有 809 条真实日志，说明管道并非整体失效。Logstash 报错：

```text
document_parsing_exception
object mapping for [source] tried to parse field [source] as object,
but found a concrete value
```

## 根因

ECS 日志已把 `source` 建成对象；验证事件把它作为脚本路径字符串，产生同一索引内的类型冲突。

## 修复

把验证事件字段从通用 `source` 改为项目专用 `verification_source`。没有删除索引、强改 mapping 或绕过 Logstash。

## 验证

```text
Logstash TCP input accepted
Elasticsearch event search: hits=1
```

## 经验

向共享日志索引加入字段前先遵循 ECS 命名；出现 mapping 冲突时优先改事件模型，不要删除有证据价值的索引。
