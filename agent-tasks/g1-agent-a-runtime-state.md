# Agent A 下一批：生产运行状态与授权仓储

阶段：G1 完整闭环的存储部分。上一批输入 `a8d7f10` 的 54 项测试及此前补充复现已由主 Agent 复跑通过。接下来实现缺失的业务保证，不重写 core，不以本任务宣布整个 G1 通过。

工作目录仍为 `/Users/hh/Desktop/joker/superagent-agent-a`；继续 `codex/g1-storage-effects`。先保留改动、fetch/merge 最新 origin/main。只有你拥有 storage/effects 源码与迁移号；root lock、contracts、core、coordinator 由主 Agent 处理。

## 第一批提交：绑定与当前授权不变量

1. `RuntimeBindings.setCurrent(ticketId, attemptId)` 必须拒绝属于别的 Ticket 的绑定；一个 Ticket 的 current 不能回退到旧 epoch，也不能把 ended attempt 重新激活。对相同 current 的幂等重试有明确行为。
2. 将 attemptId/完整 tuple、每 Ticket epoch 单调与状态单调变成可测试存储不变量。active→stopping→ended；stopping 不允许恢复 active，历史绑定保持可读。登记资源只能追加，已有资源的 identity/ownership 不可替换或删除。
3. `RuntimeAuthority` 对同一个 Work 只能有一个当前有效合同。切换版本需要同事务禁旧/启新；同 Work/revision 不同 digest 明确冲突。保留撤销和历史，不能让旧 revision 因“以前 enable 过”继续返回 isCurrent=true。
4. 以上变更使用你分配的下一 migration；已有 schema v1/v2/v3 的 checksum 不能改写。用升级前数据与 reopen 测试证明兼容。

## 第二批提交：运行观察与可恢复证据

提供持久化的 RuntimeObservation/ResourceObservation 仓储，消费主线严格 RuntimeFactPayload 和原 factId/payloadRef。与 FactReceipts、core mutation、events/必要 effects 共用 UnitOfWork。

- 按 attempt/resource 留下实际观察及来源；cancel ACK、parent exit、writer quiescence 分开，不能自动由前两者推断第三者。
- 旧/ended attempt 的物理观察可保存，但不能改变新 attempt 的资源或恢复授权。
- 提供组合根可用的读取/归约接口，不让主 Agent 用私有 SQL 查询你的表。生产字段归你，公共 wire 数据仍来自 contracts。
- 不根据超时或缺 PID 释放资源。主 Agent 会把真实 ProcessHost 的核对结果接入；库层不要制造物理成功。

## 必须验收

保留原 54 项及 core-on-SQLite 178 项；新增错 Ticket pointer、旧 epoch 回退、stopping 复活、资源替换、同 Work 双合同、撤销后 reopen、失败事务中 pointer/授权/观察/receipt 一起回滚，以及旧物理事实不会污染新版的用例。

第一批不依赖 B 的新代码，可先提交并 push；第二批接口就绪后给出类型/调用 fixtures。只提交自己的路径，根 lock 的临时生成差异不提交。交接附 base/commit、schema 迁移号、实际命令、case/evidence、限制和主 Agent 接线方法。
