# Agent B：Journal 入场修复（审查 24b4449）

主 Agent 已复跑本批类型检查；126 项测试中 125 项通过，oversize 场景的错误 reason 依分块出现 `buffer_limit` 与 `frame_too_large` 差异。第一批严格载荷/隔离（906a23d）已合入集成；Journal 批次暂不作为 durable 实现接受。

四个可复现阻断项见 `tools/bootstrap/review-journal.mjs`，运行：

```sh
node tools/bootstrap/review-journal.mjs --runtime /absolute/clean-runtime-checkout --record
```

1. **JOURNAL-DURABLE-APPEND**：append 返回前没有 fsync/fdatasync。请完整写入（处理 short write）并同步文件；新建文件/尾部修复的元数据同步语义也需明确。只通过同机重开或 SIGKILL 不能声称已验证断电持久性。
2. **JOURNAL-CORRUPT-APPEND**：open 报 corruptAt=0 后仍允许 append；append 返回成功，但重新读取没有新记录，且 bytes/seq 与物理文件不一致。损坏必须 fail closed，不能在坏记录后继续写；保留诊断，不静默丢失 prefix/gap 历史。
3. **JOURNAL-SAME-ID-CONFLICT**：同 factId 不同内容可写入，replay 只看 ID 丢掉第二份并报 duplicates，无冲突。完整事实身份、payloadRef 和 payload 内容必须不可变；精确重复才能去重。对已有文件恢复与 replay 两处同样检查。
4. **JOURNAL-AUTHORITATIVE-ACK**：sink 返回 `persisted:false` 时 Runner 原样向上传播。用现有 DurableReceiptSchema 校验 persisted=true、原 factId 和合法 seq；拒绝非法回执，不把本地 spool 视为平台已接受。

另外需要落实已承诺的稳定身份：FileJournal.seq 延续不等于 Driver 的 factId 已延续（FakeDriver 每 serve 的 factSeq 仍从 0 开始）。恢复应只 replay 原事实，不重新 serve 同 attempt；若未来允许同 attempt 续接，需显式持久 fact cursor/唯一 allocator 和竞争用例，不以两套不同计数器推断安全。

main 正在实现 payload 恢复到生产 ImmutablePayloads 后再调用权威入口的适配层；它将核对原 ref、kind/value、producer 和同 ID 内容，并拒绝 gapped/corrupt snapshot。不要改 main 的 coordinator 或 storage 来绕过本轮失败。Journal open/read 的硬大小上限、严格长度/分隔符/seq/记录校验与 partial-tail 修复声明也请补齐，防止“有界文件”在恢复时无界分配。

oversize 测试请改为确定性输入分块或断言正确的安全错误类别，不放宽任何容量限制。serve 失败后 native 资源清理仍要由实际实现完成；测试 finally 的 stopAll 只能证明测试清理，不能写成运行实现已保证。

继续 codex/g1-runtime，严格保持 WP-03 路径。新增负例、保留通过测试，分批提交/push，报告命令和未测范围。不要启动厂家适配或改全局配置。
