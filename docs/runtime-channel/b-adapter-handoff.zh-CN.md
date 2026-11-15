# B 接入交接：唯一通道的实际采用与剩余 owner 工作

2026-11-15（wave-29 修订）。目标读者：B（`apps/runner` 中除 `src/attach-channel/`、`test/attach-channel/` 外的所有者）、main。I 不修改 `runner-service.ts`、`RunnerLinkClient`、routes/auth/dispatch/lifecycle。

## 0. 当前事实（以实际 tree 为准）

观察源：B `1930278c`（含 merge `codex/g5-coordinator-channel` 到 `4d85cc3`）。

| 事实 | 状态 |
| --- | --- |
| B import `RunnerAttachChannel` | 是（`runner-service.ts:35`，bootstrap 处实例化） |
| adapter 是否持有 pending/queue | 是；B 自己的 `connections`/`currentConnection`/per-lease queue 已删除 |
| 旧三张 waiter map | 0 处 |
| vendored I blob | `coordinator-channel.ts`/`errors.ts`/`attach.ts` 与 I `4d85cc3` 完全一致 |
| sink 车道 native 许可 | 已修：必须由注入的 `options.beforeNativeWrite` 决定；缺失/拒绝/抛错 → `allowed:false` |
| 剩余跟踪记录 | B 保留 `dispatched` map，仅避免重复投递同一 head（`kind:correlation`），reply/rebind 时删除；不是 pending owner |
| 当前 B strict 编译 | **FAIL**：`runner-service.ts(283,10)`/`(286,12)` TS2304 `channel`（重构遗留引用） |

wave-28 之前"B 还有旧 maps / 自建 channel"的说法已经作废；本文件不再重复。

## 1. B 需要做的两件事（都在 B owner 内）

### 1.1 修掉两处遗留引用（唯一阻塞）

```ts
// 现在（283/286）：channel 已不存在
const hooks = { beforeNativeWrite: (command: RunnerCommand) => {
  if (!channel || businessClosed || command.kind !== 'answer') return Promise.reject(...)
  return channel.beforeNativeWrite(command)
} }

// 改为：adapter 已经暴露同一语义的 hooks
const hooks = { beforeNativeWrite: (command: RunnerCommand) => {
  if (!attach || businessClosed || command.kind !== 'answer')
    return Promise.reject(new Error('Native write admission is closed'))
  return attach.hooks.beforeNativeWrite(command)
} }
```

`attach.hooks` 的三个方法与模块完全一致（`factSink.record`/`payloads.read`/`beforeNativeWrite`），语义、错误码与 correlation 均由模块负责。

### 1.2 （可选）收口 transport 的 refusal 类型

B 的 `recovery-transport.ts` 已用 base code + `serverError` 的分离写法，wave-28 的 TS2345 已不复现。若后续再需要总映射，可直接消费 I 的导出：

```ts
import { toAttachFailure, refusalFailure, type AttachFailureCode } from './attach-channel/index.ts'

type MyErrorCode = 'transport_lost' | 'process_exited' | AttachFailureCode   // 扩宽 union，不 cast
```

`toAttachFailure` 对未知错误返回 `protocol_error/unexpected_error`，不保留原始 message（避免路径/秘密进入日志）。

## 2. B 当前实现里值得保留/注意的点

- `channelNext`：先用 `attach.next(leaseId, producer)`；只有 `refused === 'stale_connection'`（未知/被替换连接）才用调用方给出的 `expectedGeneration` 做 **显式 CAS bind**。poll 本身不改 generation。
- `channelReply`：`attach.receive(leaseId, frame, producer)`，仅在该连接仍是当前 lease 时 accepted；stale/foreign 不产生副作用。
- `dispatched` map 的 key 是 `kind:correlation`，reply/rebind 时删除；若增加连接类型，记得在 `drop` 路径也清理。
- stdio 的 `write-admission` 目前还 AND 了 `!businessClosed`（更严格，不是绕过）；语义上应理解为"当前 admission 仍开且当前 guard 同意"。
- B 在 `closeAdmission` 里对所有连接 `drop`，但保留 channel 打开；`module.close` 才结算全部 pending。**channel close 不证明 writer 静止**。

## 3. 三类回调的权威归属（不要合并）

| 回答 | 权威 | I 的职责 |
| --- | --- | --- |
| fact receipt / ack-failed | 原 A/public sink（幂等、冲突拒绝） | 原 factId/body 关联、deadline、重发 |
| payload value | 原 immutable Store/responder | 原 ref 关联、bytes 限额、重读 |
| write-admission | 当前 main/Broker fresh guard | 每意图 fresh `frame.id`、结算、不缓存 |

事实落库**不是** native 许可：`createCoordinatorSinkResponder` 已把"缺 guard 就不许写"固化为源码结构（guard 必填、运行时缺失 fail-closed）。B 用自己的 `beforeNativeWrite` 注入也能达到同等语义；两种方式都不要回退到 `!businessClosed` 默认放行。

## 4. 业务恢复仍需要的 interface（I 只提供通信语义）

以下都由 B/main 完成，I 不扩成 coordinator：

- 原 A 新进程与 `native_applied` / `ACK unknown` 的业务对账：I 只保证 fact 可用**原 id/body** 重发并等待原 durable ACK；超时是 unknown，不是"未发送"。
- begin/answer/cancel 等业务命令的重新准入：I 不自动重发任何业务命令；意图 `indeterminate` 后必须回原 command reconciliation。
- Completion/candidate/manualaccept/slot 释放：走原 ProductCompletion/WorkView/Verification，I 不建表、不建账本。
- generation 只代表本地连接代际，不能替代业务 `fenceEpoch`、principal 或 native target 许可。

## 5. 接入后回归（B 自有断言）

1. 正常链：bootstrap → begin → question → answer（native admission）→ delivery → stop；无旧 maps、无第二 pending 所有者。
2. 同命令二次意图：旧 allowed 重放不得批准；guard 调用次数 = 意图数。
3. 重绑：原 factId/body 重发并得原 ACK；未决 write 变 `indeterminate`；stale 连接 next/reply 被拒且 generation 不变。
4. sink 车道无 guard / deny / throw：零 native 写。
5. 关闭：`drop` 后旧连接无副作用；`attach.close` 后无悬挂 pending、无假成功。

## 6. 仍未达（I 侧如实记录）

- B 当前 strict 编译未过（§1.1），因此"latest source 已编译并运行"在 B 侧不成立，直到 B 自己修复。
- 同 Runner 进程双 client、coordinator SIGKILL 后原问题→交付、跨 coordinator 崩溃恢复、durable exactly-once、物理 quiescence：仍属 B/main/A。
- H 尚未绑定当前 source 执行（见 `h-independent-consumer.zh-CN.md`）。
