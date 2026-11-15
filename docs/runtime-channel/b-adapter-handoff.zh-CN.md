# B 接入交接：以 I 的唯一实现取代原 waiter maps 与自建 channel

2026-11-15（wave-28 修订）。目标读者：B（`apps/runner` 中除 `src/attach-channel/`、`test/attach-channel/` 外的所有者）与 main。I 不修改 `runner-service.ts`、`RunnerLinkClient`、routes/auth/dispatch/lifecycle。

## 0. 当前事实（以实际 tree 为准，不以旧报告为准）

| 事实 | 状态 |
| --- | --- |
| B 已删除旧的 `factWaiters`/`payloadWaiters`/`writeWaiters` | 是，`runner-service.ts` 中 0 处引用 |
| B 曾自建 `business-channel.ts`/`business-dispatch.ts` 作为平行实现 | 曾存在（审计源 `cb4e975`）；当前 tree 已删除这两个文件，仅剩不同职责的 `business-attach.ts`/`business-reconnect.ts` |
| B 是否 import 本模块 | 是。`runner-service.ts` 从 `./attach-channel/index.ts` 引入 `CoordinatorChannelModule`/`DEFAULT_LIMITS`/错误类型，且 vendored `coordinator-channel.ts` 的 blob 与 I 的 `ae93f34` 完全一致 |
| B 还保留自己的连接层 | 是：`connections` map、每连接 `queue`、`currentConnection`、`channelState/channelNext/channelReply` 包装都在 `runner-service.ts` 内 |
| 旧的"runner-service 仍有 15 处 map" | 只适用于 I 分支的旧 main baseline（`d95df88`），**不适用于当前 B**；本文件不再重复该说法 |
| wave-28 的 fresh-intent 修正是否已在 B 生效 | 否。B 当前 vendored 的是 wave-27 版本（`ae93f34`），仍带 P1；B 合并本分支 `wave28` 提交后自动获得修正 |

结论：**"唯一实现"在 module 层面已由 B 自己的切换达成**；剩余工作是 (a) 合并本分支获得 fresh-intent 修正，(b) 用本包的生产 adapter 取代 `runner-service` 内的手写连接队列。二者都属于 B 的 owner 范围。

## 1. 本轮新增的生产 adapter

`apps/runner/src/attach-channel/attach.ts` → `RunnerAttachChannel`，与 B 现有路由签名同形，但把连接/队列/队列清理集中到模块侧：

```ts
import { RunnerAttachChannel, DEFAULT_LIMITS } from './attach-channel/index.ts'

const attach = new RunnerAttachChannel({ producer: channelProducer, limits: DEFAULT_LIMITS })

// 唯一变更入口：显式 full producer + CAS。
const generation = attach.bind({ producer, connectionId: leaseId, expectedGeneration })

// channelNext 等价物：只读。不 bind、不替换 lease、不代别的连接作答。
const next = attach.next(leaseId, producer)
// { ok: true, generation, request, expiresAt, remainingMs } | { ok: false, generation, refused }

// channelReply 等价物：回复只交回产生它的连接。
const reply = attach.receive(leaseId, frame, producer)
// { accepted, generation }

// 连接消失
attach.drop(leaseId, 'socket closed')
```

与 B 当前手写层的差异（这正是需要吸收的部分）：

- B 的 `queue.shift()` 在取走请求后即从队列删除；若客户端拿到后不回，队列里没有记录（只能靠模块超时，且无法再报告 remaining）。adapter 保留条目直到**结算**才出队，并按 correlation 去重，重绑只重建当前 generation。
- B 的 `connections` map 允许保留多个 lease 对象；模块本身只承认一个 active lease，adapter 用一个 `#connectionId` 表达当前连接，stale 连接显式 `refused`。
- adapter 的 `next.receive` 对 stale/foreign 调用**不产生任何副作用**（generation 不变、pending 不动、queue 不动），等价于把 B 的 `assertChannelProducer`/`currentConnection` 检查收进同一处。

## 2. 路由改动（B 侧，精确到当前实现）

`runner-service.ts`（当前 B tree）中：

| 位置 | 现在 | 改为 |
| --- | --- | --- |
| bootstrap 处（`new CoordinatorChannelModule({ producer, limits: DEFAULT_LIMITS })`、`sinkLease`/`stdioLease` 两次 `bind`） | 直接持有模块与两个 lease | `new RunnerAttachChannel({ producer, limits: DEFAULT_LIMITS })`，再用 `attach.bind({...expectedGeneration: 0})` 绑 stdio 或 sink 之一 |
| `channelState` | 返回 `channel.inspect().generation` | 保留（`attach.inspect().generation`）；**只读**，不得据此推断 bind 权限 |
| `channelNext` 内 `connections.get/shift`、首轮 bind、`currentConnection` 维护 | 手写连接层 | `attach.next(leaseId, producer)`；bind 由显式 CAS 调用先行，poll 不再承担 bind |
| `channelReply` 内 `entry.lease.receive(asChannelReply(reply))` | 手写 | `attach.receive(leaseId, reply, producer)` |
| `closeAdmission` | 逐个清理连接/队列 | `attach.close('Attempt admission is closed')`（在 `businessClosed = true` 之后、`processHost/runner` 关闭之前） |
| 收帧分支 `receipt`/`payload`/`write-admission`/`ack-failed`（stdio lane） | 直接调 `stdioLease.receive(...)` | 可保留，也可走同一 adapter：stdio 视为 connectionId `stdio-<pid>` 的 lease |

**CAS 的 expectedGeneration 必须来自调用方自己的状态**（上一次 bind 的返回值或原持久记录），不能由服务端或 `channelState` 现读现填——否则 stale 客户端可以用同一读数重新占位。B 的 `channelState` 只用于让客户端知道"该带哪个 generation"，服务端仍要按原 leaseId 与 `currentConnection` 拒绝非当前连接。

## 3. 三类回调的职责映射

- `recordFact`：B 的 `factSink.record` 直接 `await attach.hooks.factSink.record(fact)`；随后保留 `receipts.set` 与 stdio `receipt` 回显（业务回显，不是第二个 pending owner）。
- `readPayload`：本地 `readLocal` 命中优先的顺序保留；未命中再 `attach.hooks.payloads.read(reference)`。immutable 引用、`maxPayloadBytes`、超限 `capacity` 由模块负责。
- `beforeNativeWrite`：统一 `attach.hooks.beforeNativeWrite(command)`，**移除 `hasLease() ? attach : stdio` 双车道分支**。stdio 与 attach 只是两条传输，同一 attempt 只允许一个 active lease：bootstrap 先绑 stdio，认证 attach 用 CAS 接管后旧 stdio lease 自动失效；未决写变 `indeterminate`，facts/payloads 在新连接重发。
- 每个意图的 `frame.id` 是模块生成的 fresh correlation（`intent-<salt>-<n>`），`command.id`/body 原样保留。B 的 sink lane 回复 `{type:'write-admission', id: outbound.id}` 与 stdio 回显 `id` 都天然正确，不需要把 id 改回 `command.id`。

## 4. 不得改动 / 不属于本包

- 不改 v1 wire、`RUNNER_BRIDGE_PROTOCOL`、认证、HTTP routes、`dispatch`/`begin`/`prepared`/process/lifecycle。
- 不新增第二 coordinator、账本、DB writer、Driver、权限或执行入口。
- 135540 字节 5 块的 journal 分页回放属于 B 的 journal/descriptor 传输，不是 `readPayload` 的 JSON 值能力；两者不要混报。
- 失败码与 `NativeWriteDenied` 语义见 `docs/runtime-channel/README.zh-CN.md` §5。

## 5. 接入后的回归输入（B 自有断言）

1. 正常链：bootstrap → begin → question → answer（native admission）→ delivery → stop；三张旧 map 不存在，且 `business-channel`/`business-dispatch` 不复活。
2. 同命令二次意图：第一次 allowed 结算后，重放旧 allowed frame 不得批准第二次；第二次必须产生新的 guard 决定（guard 计数 2 / 请求 2 / 回复 2）。
3. 重绑：A→B，原 factId/body 重发得到 A 的 durable ACK；未决 native write 为 `indeterminate` 且不迁移。
4. 关闭：`shutdown`/模块 close 后原 pending 不悬挂、不误报成功；close 不等于物理 writer 静止。
5. stale/foreign：旧 leaseId 的 next/reply 被拒且 generation 不变；foreign producer 在 bind/poll/reply 全部被拒。

## 6. 仍未达（I 侧如实记录）

- B 尚未合并本分支的 wave-28 修正，因此 B 当前运行态仍带 P1；合并后以 B 自己的测试为准。
- B 的服务层是否已用本 adapter 取代 `connections` 队列：截至本文**未发生**，`runner-service.ts` 仍保留手写层（已在 §1/§2 给出替换点）。
- 同 Runner 进程双 client、coordinator SIGKILL 后原问题→交付、跨 coordinator 崩溃恢复、durable exactly-once、物理 quiescence：仍属 B/main/A。
