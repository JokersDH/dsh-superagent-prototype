# wave-31 采用手册：用同一通信实现接原服务

2026-11-15。面向 main/B/H/D/E 的可复现接入说明。实现：`apps/runner/src/attach-channel/`；本轮真实消费者：`apps/runner/test/attach-channel/actual-*.test.ts`。本轮**未新增** tar/安装包；R1/R2 与 D/E 的关系见文末。

## 1. 最小源码闭包

| 文件 | 作用 | 是否必需 |
| --- | --- | --- |
| `src/attach-channel/coordinator-channel.ts` | 唯一 pending/timer/correlation/队列/settlement 实现 | 必需 |
| `src/attach-channel/errors.ts` | 有限失败码与 `NativeWriteDenied` | 必需 |
| `src/attach-channel/attach.ts` | 按连接寻址的拉取 adapter（`bind`/`next`/`receive`/`drop`） | 必需 |
| `src/attach-channel/index.ts` | 公开入口 | 必需 |
| `src/attach-channel/sink-responder.ts` | in-process 车道可选 responder（guard 必填） | 可选 |
| `src/attach-channel/refusals.ts` | 消费者统一失败码映射 | 可选 |

依赖仅为原 `driver-kit` 的 `JsonLineDecoder`/`encodeFrame` 与共享 contracts；不需要任何 review sender/预算/诊断导出。

## 2. 调用图（真实服务）

```
Native Driver ──facts/payloads──▶ AttemptIO
      │                              │
      │ beforeNativeWrite            ▼
      ▼                      Runner service (apps/runner/src/runner-service.ts)
  hooks ────────────────────▶ RunnerAttachChannel (I)
                                   │  bind(CAS) / next(connectionId) / receive(connectionId)
                                   ▼
                         v1 frames: fact / payload-read / native-write-intent
                                   │
             ┌─────────────────────┼─────────────────────────┐
             ▼                     ▼                         ▼
      stdio writer          authenticated remote lease     in-process sink
      (only stdio conn)      (only its own next/receive)    (guard-required responder)
```

- 原 fact 走原 A/public sink（真实 `ProductStore` ingress 已验证，见 I2）。
- payload 由原 immutable Store/responder 定义内容与权限。
- native 许可每次由原 main/Broker guard 决定；缺 guard/deny/throw 均零写（I3）。

## 3. 谁拥有什么

| 事项 | owner |
| --- | --- |
| pending/timer/correlation/队列/settlement | I（唯一实现） |
| 连接、认证、路由、dispatch、begin/prepared、物理生命周期 | B |
| fact 持久化/幂等/UoW | A ingress（main 组合） |
| payload 内容与权限 | 原 Store/responder |
| native 写许可、问题/版本/target/current binding | main/Broker |
| 候选/验证/人工接受/slot 释放 | main/B 原产品链 |

`channel generation` 只是本地连接代际，不替代业务 `fenceEpoch`、principal 或 target 许可。

## 4. 可运行消费者（本轮交付）

```bash
cd apps/runner
node --test --test-timeout=60000 test/attach-channel/*.test.ts     # 132/132
node_modules/.bin/tsc -p apps/runner/src/attach-channel/tsconfig.json
```

| 消费者 | 覆盖 | 结果 |
| --- | --- | --- |
| `actual-service-adoption.test.ts` | 真实 `serveRunner`：原 fact id、fresh intent、旧 allowed 重放拒绝、foreign fact、重复 bootstrap | 4 例 |
| `actual-store-callbacks.test.ts` | 真实 `ProductStore` + `createStoredRuntimeIngress`：receipt 回读、foreign/missing payload 拒绝 | 3 例 |
| `actual-broker-guard.test.ts` | 真实 store binding + 记录的 command body + 一次性 admission：allow/deny/throw/缺失/错 body/复用 | 5 例 |
| `actual-dual-client.test.ts` | 真实 endpoint：A 服务→B CAS 接管→A 被 fence；foreign producer 拒绝 | 2 例 |
| `actual-succession.test.ts` | 前任离开→继任续原 fact 与窗口；stale/future generation 拒绝 | 2 例 |
| `actual-ack-window.test.ts` | 重复 ACK、错 kind/错 id、关闭后迟到 reply | 3 例 |
| `actual-backpressure.test.ts` | 真实服务 64 上限：第 65 条 capacity，排空后恢复 | 1 例 |
| `actual-recovery-support.test.ts` | 正常链单 fact/单 intent/终止；remote deny 零写；recovered 链 NOT_REACHED | 3 例 |
| `actual-multislot.test.ts` | 4 个独立 attempt 端点：隔离、各自 generation | 2 例 |
| `actual-shutdown.test.ts` | shutdown 后 pending 保持 unknown、不伪造 receipt；空载 shutdown 终止；malformed 不改 owner | 3 例 |
| `actual-compatibility.test.ts` | 导出/契约面、v2/缺 id 拒绝、typed failure | 4 例 |

## 5. 错误处理示例

```ts
import { CoordinatorChannelError, NativeWriteDenied, toAttachFailure, type AttachFailureCode } from './attach-channel/index.ts'

try {
  await attach.hooks.beforeNativeWrite(command)
} catch (error) {
  const failure = toAttachFailure(error)          // { code, reason, message }
  if (failure.code === 'native_write_denied') {
    // authoritative denial: do not write; may ask again for the SAME original command
  } else if (failure.code === 'indeterminate') {
    // unknown native outcome: reconcile the original command first; never blind-retry
  } else {
    // stale_connection/closed/timeout/capacity/protocol_error: bounded, secret-free
  }
}
```

消费者扩宽自己的错误 union 用 `AttachFailureCode`，不要用 `as` 绕过。

## 6. 分层结论（不要把模块绿灯读成产品恢复）

| 层 | 状态 |
| --- | --- |
| 模块实现（100 例历史 + 32 例真实消费者） | PASS |
| 真实 B service 采用、单 transport owner、sink guard、direct strict | PASS（见状态文件的 B 证据） |
| 同 attempt 双 client、继任、ACK 窗口、背压、多槽隔离、shutdown 通信语义 | PASS（本轮 consumers） |
| 原 A 持久 ingress（真实 ProductStore） | PASS（I2） |
| 原 Broker 完整 `NativeProductAttempt`（需 spawned child） | NOT_REACHED；I3 用同一 store 上的等价检查 |
| 原问题→`native_applied`→候选/manualaccept/slot 释放的恢复链 | NOT_REACHED（B/main） |
| 真实 vendor/model/native、installed artifact | NOT_TESTED（本轮 0） |

## 7. 已报告的跨 owner 缺口（B 修复）

`runner-service` 的 `closeAdmission` 只 `drop` 固定的 stdio/sink connection id；远端 lease 在 shutdown 后仍是 current，因此迟到 reply 理论上仍可结算 pending（I10 观测到该行为，未作为绿灯断言）。B 终端关闭应改用 `attach.close()`（或同时 drop 当前 remote lease）。模块侧 `close()` 已保证迟到 reply 被拒（`handover.test.ts`）。

## 8. R1/R2 与打包

- R1 固定 artifact：source `82ee5b8f1bc3e4b76233268fe61e4ebfd2f514b2` / `8296720d8a25f38c` / tar SHA `04926739f491c34e9a093b2fc3edff2f85243e4a232af46c7a2430cf13687543`，本轮**未重冻**、未因 docs/E 工具修正重建。
- R2 为 `303b2c6a` 新 source 及后继；本轮 I 只消费其 runtime 源码，**未新建 tar、未安装**。D 冻结后由 E 对同一 artifact 独立验收；I 不代报 installed/native 结论。
- 测试 fixture/key/private root 均未进入运行包。
