# WP-03 第五批（G1）：持久 Journal 与事实重放

- 分支：`codex/g1-runtime`
- 任务：`agent-tasks/g1-agent-b-durable-runner.md` 第二批
- 前置：第一批 `906a23d`（严格载荷 + 每 attempt 隔离）
- 结论：Runner 级持久恢复完成；native 执行状态未知时只做只读 reconcile，不冒充恢复

---

## 1. 磁盘格式

`apps/runner/src/file-journal.ts`，append-only JSON Lines：

```
<8 hex 长度> <16 hex sha256 前缀> <JSON>\n
```

每条记录是 `{ fact, payload, seq, at }` —— **payload 与 fact 一起落盘**，所以重放不依赖内存 Map。

### 恢复规则

| 状态 | 行为 |
| --- | --- |
| 完整记录 | 回放，`lastSeq` 取最大值 |
| **partial tail**（进程死在写入中间） | 打开时 `truncateSync` 掉残留字节，报告 `partialTailBytes`，**不回放** |
| **校验和不匹配** | 停在该偏移，报告 `corruptAt`，之前的记录仍可用 |
| 容量不足 | `journal_capacity_exhausted`，**拒绝新记录而不是丢弃** |

关键不变量：**seq 跨重启单调递增**。重开 journal 时从 `lastSeq` 继续，绝不重置为 1，因此旧 `factId` 不可能被复用。

---

## 2. ACK 与 spool 分离

`AttemptRunner.#record` 的顺序改为：

1. 本地 spool 写入 `{fact, payload}` —— 从此即使进程死掉也能按原身份重放；
2. 调用 sink（`FactSink`）；
3. 只有 sink 返回 `persisted: true` 的收据才向上传播，同时记入内存 journal。

- 平台持久化 ACK 与 Runner 本地 spool **是两个独立事实**：sink 不可用时 `launch()` 直接 reject，**绝不返回假的 `DurableReceipt`**；
- spool 容量不足 → `capacityExhausted = true`，`feed()` 拒绝新的 `begin`/`deliver`，但 **`cancel`/`answer` 仍被接受**（停止必须始终可行）；
- `launch()` 前检查剩余容量是否够放一条最小记录（256B），不够则**不启动原生 writer**。

---

## 3. 重放语义

`replayJournal(spool, sink)`：

- 只重送**事实**，从不发 `begin`/`deliver`/`answer`/工具动作；
- 同一 `factId` 在 spool 内重复只送一次；
- sink 对已知 `factId` 返回原收据 → 第二次重放不产生新业务；
- `stale_epoch`/`stale_assignment`/`attempt_mismatch` 等被判为**拒绝**而非失败：这些事实可能仍作为物理观察保留，但**不重试为业务**；
- 原生执行状态未知时，恢复流程只调用只读 `reconcile`，**不存在"重新 start attempt 当作恢复"的路径**。

---

## 4. 验证

```sh
cd apps/runner && node --test test/journal-replay.test.ts   # 10 pass
cd apps/runner && node --test test/journal-crash.test.ts    #  5 pass
```

覆盖：顺序恢复、seq 跨重启延续、截断尾修复、校验和损坏定位、容量拒绝、
重放幂等、spool 内重复、旧 epoch 拒绝、重放不发命令、
**写 journal 后 ACK 前退出**、**ACK 后重放不重复**、**重启不重置 seq**、
**sink 不可用无假 ACK**、**容量耗尽不启动 writer**。

全仓回归：

```
packages/driver-kit  18 pass
packages/testing      8 pass
packages/execution   44 pass
apps/runner          56 pass
合计                126 pass / 0 fail   （第一批 111 + 本批 15）
```

类型检查：`tsc` 6.0.3 strict（含测试）→ exit 0。

---

## 5. 过程中修复的真实缺陷

1. **`launch()` 在不可 spool 时仍会启动原生进程** —— 现在先检查剩余容量（≥256B）再启动；
2. **`serve()` 中途失败会留下孤儿进程** —— 测试显式持有 `ProcessHost` 并在 `finally` 中 `stopAll`；
3. 多处 node:test 用例留下 handle 导致进程不退出 —— 已逐项定位并清理，现在四个包都是干净退出。

---

## 6. 未完成 / NOT_TESTED

1. **跨 coordinator 崩溃后重新绑定独立 Runner**（IPC 认证、进程拓扑）—— 任务明确属后续联合验收；
2. 与 `createRuntimeIngress(...).bind(producer)` 的**实际接线**（本批只提供 spool + replay 能力与 sink 接口）；
3. 真实厂商 Driver、native 协议适配（任务禁止本批开启）；
4. A 提供的生产 binding/资源观察表接入；
5. 拟锁 Node 24.22.2 复跑（本机 24.21.0）；
6. Linux/Windows 的 `ps` 语义与文件系统持久性假设。
