# RFC-0002：Supervisor 的 fenced ingress 需要 core/storage 提供一个原子入口

- 状态：Proposed
- 提出者：Agent B（WP-03）
- 影响包：`packages/orchestrator-core`（WP-01，归主 Agent）、`packages/storage`（WP-02，归 Agent A）、`packages/execution`（WP-03）
- 关联验收：RT-01、RT-04、RT-06、REL-04、REL-05、REL-06

## 1. 具体失败场景

`AttemptSupervisor`（`packages/execution/src/supervisor.ts`）现在是“先查内存 binding，再调用 sink.record”的两步：**检查与写入不在同一个事务里**。在单进程单线程下这没有窗口，但一旦出现下列任一情况，就会出现错误的接受或拒绝：

1. **并发的新 epoch**：`start(epoch=2)` 正在保存新 binding 时，`record(epoch=1)` 已通过 fence 检查、尚未落库。结果：旧 epoch 的事实被写进新绑定的账本，RT-01 被破坏。
2. **崩溃在写事务中间**：事实已 INSERT、binding 未更新（或反之）。重启后 `current(ticketId)` 与事实账本不一致，恢复流程无法判断“这条事实是否属于当前派工”。
3. **重复投递 + 延迟到达**：同一 factId 两次到达，中间夹了一次 epoch 变更。幂等键相同但绑定不同，需要数据库层来裁决，而不是靠调用方顺序。

这不是“Supervisor 写得不够小心”，而是**接口把原子性留给了调用方**，而调用方（core Executor bridge）在另一条事务边界上。

## 2. 最小 fixture

| 输入 | 期望 |
| --- | --- |
| binding: `ticket-1/attempt-1/epoch=1`；并发 `start(attempt-2, epoch=2)` | `record(attempt-1)` 与 `start` 二选一成功；事实绝不能落到 epoch=2 的账本 |
| 事务内 INSERT fact 后进程被 SIGKILL（binding 未更新） | 重启后 `current()` 与 fact 账本一致；要么都在、要么都不在 |
| 同一 `factId` 到达两次 | 第二次返回首次的 `DurableReceipt`，`seq` 不变，不产生第二条业务记录 |

## 3. 拟议变更

请在 core/storage 侧提供一个**单一事务入口**，供 Supervisor 调用：

```ts
// 由 packages/orchestrator-core + packages/storage 提供，WP-03 只消费
interface FencedIngress {
  /**
   * 在同一个写事务内：
   * 1. 读取当前 binding（ticketId -> attemptId/fenceEpoch/state）；
   * 2. 若 fact 的 identity 不匹配当前 binding，返回 refused（不写）；
   * 3. 若 factId 已存在，返回既有 receipt（不重复写）；
   * 4. 否则 INSERT fact、更新任何派生视图，提交后返回 { persisted: true, seq }。
   */
  recordFenced(fact: CriticalFact): Promise<
    | { accepted: true; receipt: DurableReceipt }
    | { accepted: false; reason: 'stale_epoch' | 'unknown_binding' | 'not_active' | 'attempt_mismatch' }
  >;
}
```

约束：

- **只由 core 决定 fence 结果**，Runner/Driver/Supervisor 不得自建第二个判定实现（否则就是“私有 replacement type”）；
- 提交后回调（`afterCommit`）只用于发通知，不用于再决定业务；
- 存储容量不足时必须显式拒绝（`capacity_exhausted`），不能静默淘汰已接受的事实（REL-05）。

## 4. WP-03 侧的适配成本

`AttemptSupervisor` 已经把所有调用收敛在 `record(fact)` 与 `fence(fact)` 两个方法上，接上 `FencedIngress` 只需：

1. `SupervisorOptions.sink` 的类型从 `FactSink` 换成 `FencedIngress`；
2. `record` 改为单次调用，删除本地 `fence` 预检（或保留为纯诊断用途）；
3. `apps/runner` 的 `AttemptRunner` 同样改为直接转调。

因此本 RFC 不要求改 WP-03 的对外形状，只要求 core/storage 提供该入口。

## 5. 兼容与恢复影响

- 不改变任何 wire schema；改变的是本地事务边界，`schemaHash` 不受影响。
- 数据库需要一个“当前 binding”的可查询投影（`ticket.active` 已有类似生成列经验可复用，见 G0 Agent B 的 platform 报告），以及 fact 的唯一键（`factId`）。
- 恢复：`current()` 必须能区分“无 binding”“binding 已 ended”，否则 `not_active` 与 `unknown_binding` 会被混淆，UI 会给出错误提示。

## 6. 本批（WP-03 第一批）的处理

- Supervisor 明确实现为**可替换 sink**：本批用 `InMemoryFactLedger`，并且**测试只声称“同一进程内的 fence 顺序”**，不声称原子性；
- 报告把“durable ACK / atomic fence / recovery”记为 NOT_TESTED，并注明等待本 RFC 落地；
- 未在 WP-03 内新增任何事实表或第二写者。
