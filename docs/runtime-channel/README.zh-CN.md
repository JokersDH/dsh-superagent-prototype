# CoordinatorChannel 具体模块：用法与不变量

2026-11-14，wave-27 / I。实现：`apps/runner/src/attach-channel/`。共享小接口：[`packages/contracts/src/coordinator-channel.ts`](../../packages/contracts/src/coordinator-channel.ts)（main 0068 发布，本文不复制、不修改）。测试：`apps/runner/test/attach-channel/`。

## 1. 它解决什么

`runner-service` 原先分别维护 `factWaiters`、`payloadWaiters`、`writeWaiters` 三张 map，并在收帧分支里各自判断关联、超时与晚到。三套规则容易漂移，重绑后也没有统一的所有者。本模块把**注册、deadline、回复关联、字节/容量、lease fencing、单次结算**集中到一个实现里，caller 只剩：

- 每次连接一次 `bind`；
- 把该连接解码后的回复交给**该连接自己的 lease**；
- Driver 侧三个普通异步回调。

模块深度不体现在行数，而体现在：删除它时，上述复杂度会整体回到 caller（三张 map、timer、generation、去重）。它是唯一持有 pending 的实现。

它**不创建**：socket、server、数据库、账本、Driver、权限、执行生命周期；也不持有凭据。`send` 是 caller 已认证的 v1 传输，`receive` 是 caller 已解码的回复。

## 2. 构造

```ts
import { CoordinatorChannelModule, DEFAULT_LIMITS } from '../../src/attach-channel/index.ts'

const channel = new CoordinatorChannelModule({
  producer,                    // 原可信登记的完整 producer（深拷贝并冻结）
  limits,                      // 必须显式：每类/total pending、bytes、timeout、settled 上限
  now, schedule,               // 可选；生产用 Date.now + 有界 timer，测试注入可控时钟
})
```

- `producer` 只取 `attempt`（ticket/assignment/attempt/fenceEpoch/contract）+ `runnerIdentityRef` + `source`，通过共享 schema 严格解析；**额外字段直接拒绝**，不从请求里推断身份。
- 构造后 caller 再修改自己的对象无效：模块持有冻结副本。
- `limits` 必须是有限安全整数范围内的合法值；`DEFAULT_LIMITS` 是可直接使用的基线值，但**不做隐式 fallback**（无期限等待不会发生）。
- `schedule(delayMs, cb)` 必须返回取消函数；默认实现用 `setTimeout(...).unref()`。

## 3. bind / generation / lease

```ts
const lease = channel.bind({ producer, connectionId, expectedGeneration: 0, send })
```

- 初始 `generation = 0`；首次成功 bind 要求 `expectedGeneration = 0` 并返回 `generation = 1`。
- 之后每次成功 bind 以**当前** generation 做比较更新并递增；不重用、不溢出安全整数（`MAX_SAFE_INTEGER` 后拒绝）。
- 失败（身份/参数/CAS）**不改变**当前 lease、pending 或 timer。
- 成功替换时旧的 `receive` 立刻失效、旧的 `close` 变成 no-op；同一时刻只有一个 live lease。旧 socket 的回复不能结算新连接上的同一请求。
- `connectionId` 是调用方连接标识，不是认证凭证；`generation` 也不代替业务 `fenceEpoch` 或主线授权。

**路由义务（B 必须遵守）**：每条已认证连接保存它自己 `bind` 得到的 lease，只把该 socket 解码出的回复交给该 lease 的 `receive`。把旧 socket 的字节喂给"当前 lease"会破坏 fencing——模块无法从 v1 frame 里分辨物理来源（v1 没有、也不应新增 generation 字段）。

## 4. 三个回调

| 回调 | 发出的原 v1 frame | 成功后 | 断连/重绑后 |
| --- | --- | --- | --- |
| `recordFact(fact)` | `{v:1,type:'fact',id:factId,fact}` | 返回原 `DurableReceipt` | 保留 pending，用**原 factId/原 body** 在新 lease 重发，等原 A 幂等 durable ACK |
| `readPayload(ref)` | `{v:1,type:'payload-read',id:requestId,requestId,reference}` | 返回原 immutable JSON | 保留 pending，用同一 `reference` 与新 lease 关联重读；不换引用 |
| `beforeNativeWrite(cmd)` | `{v:1,type:'native-write-intent',id:cmd.id,command}` | resolve 仅表示**本次**许可 | 不迁移：立即以 `indeterminate` 拒绝，旧 allowed 不复用 |

- `recordFact` 只接受属于登记 producer 的 fact（attempt 全字段 + source）。
- `beforeNativeWrite` 只接受 `kind='answer'` 的原命令；每次调用都是一次新意图，成功许可**只结算本次**，后一次同文本/同 command id 调用仍要重新走当前 guard。
- `readPayload` 的请求 id 由模块生成且不重用；返回值的 `JSON` 字节数超过 `maxPayloadBytes` 时以 `capacity` 拒绝并释放 pending。
- 每次请求都是"先注册 pending + 装 timer，再 send"；同步 send 抛错、同步 reply、异步 send 拒绝、timeout、close 竞争都最多结算一次。

### 断连与重绑的精确语义

- `lease.close()`（当前连接消失）：未决 **native write** → `indeterminate`；**facts/payloads 保留**，可在 replacement lease 上用原身份重发，deadline 不刷新。
- 旧 lease 的 `close()`：no-op，不影响 replacement。
- `module.close()`：终止**全部** pending/timer 并拒绝后续请求与 bind；facts/payloads → `closed`，writes → `indeterminate`。它只关闭通信，**不证明物理 writer 已停**；进程/barrier 仍由 B/main 原控制端证明。

## 5. 错误与失败码

模块只抛两类拒绝：

1. `CoordinatorChannelError`，`code` 取共享联合：

| code | 含义 | caller 应做 |
| --- | --- | --- |
| `identity_mismatch` | producer/attempt/source 不符（发送前拒绝） | 修调用方身份，不要重试 |
| `stale_connection` | 无 live lease、generation CAS 失败、或帧没发出去 | 重新 bind 或重发（facts/payloads 安全） |
| `closed` | 模块已关闭 | 停止使用 |
| `timeout` | 本请求 deadline 到期，已释放资源 | facts 保持 unknown，可用原 id 再确认；payloads 可重读 |
| `capacity` | pending 数、pending bytes 或单个 payload bytes 超限 | 降并发或等回收 |
| `protocol_error` | 帧/关联/schema 不符，或 coordinator `ack-failed` | 修正请求或按 A 语义核对 fact |
| `indeterminate` | native 意图在断连/关闭/发送不确定时未决 | 回原 command reconciliation 后再发**新**意图 |

2. `NativeWriteDenied`：当前 coordinator guard 的**权威否定**。它不是通道故障（不等于 timeout/indeterminate），caller 不得写，之后可针对原 command 重新询问。

`reason` 是稳定短标识（如 `generation_mismatch`、`write_intent_send_failed`、`fact_ack_failed`）。错误消息/堆栈**不含** payload 原文、凭据、私有绝对路径；至多出现有界 ID 与状态。

## 6. 容量与结算规则

- 注册/发送前检查：`maxPendingFacts`、`maxPendingPayloads`、`maxPendingWrites`、`maxPendingBytes`（请求字节）。拒绝发生在创建 pending/timer 之前，被拒请求不会到达 transport。
- 回复侧检查：单个 payload 值 `JSON.stringify` 字节数 ≤ `maxPayloadBytes`；超限以 `capacity` 拒绝并释放。
- 同一 correlation id 的并发重复请求被拒绝（`fact_already_pending` / `write_already_pending`），不会静默合并成两个 promise。
- 已结算 id 记在有界 `maxSettledRequests` 环里：迟到的重复回执被识别为"已结算"、不会再触发一次结算；不会复活旧许可。
- `inspect()` 是唯一观测口：`state`/`generation`/三类 pending 数/`pendingBytes`。没有测试专用空方法，也不暴露私有 map。

## 7. 可运行 consumer

`apps/runner/test/attach-channel/adapter.ts` 是可复制的 Runner 侧适配器（`RunnerAttachChannel`）：一 attempt 一 channel、一连接一 lease、三 hooks、`accept(connectionId, frame)`/`drop(connectionId)` 编码路由义务，自身不持有任何 waiter map。

独立复现：`apps/runner/test/attach-channel/independent-consumer.test.ts` 只 import 公开入口与共享类型，自带 producer/时钟/对端，H 可原样复制到自己目录。

```ts
const attach = new RunnerAttachChannel({ producer, limits })
const generation = attach.bind({ connectionId: 'conn-1', expectedGeneration: 0, transport: { send } })
const driverHooks = attach.hooks               // { factSink, payloads, beforeNativeWrite }
socket.on('frame', frame => attach.accept('conn-1', frame))   // 只喂本连接
socket.on('close', () => attach.drop('conn-1', 'socket closed'))
// 重连后：attach.bind({ connectionId: 'conn-2', expectedGeneration: generation, transport })
```

## 8. 验证

```bash
# 严格类型（strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes）
node_modules/.bin/tsc -p apps/runner/src/attach-channel/tsconfig.json
# 行为矩阵（注入时钟，无 sleep、无真实网络/模型）
cd apps/runner && node --test --test-timeout=5000 test/attach-channel/*.test.ts
```

## 9. 本文明确不证明的事

- 没有接入真实 B `runner-service`/`RunnerLinkClient`，因此"原三 maps 已删除"未达（I9–I12 见 handoff 文档）。
- 未证明同 Runner 进程双客户端、coordinator SIGKILL 后原问题→交付、跨 coordinator 崩溃恢复。这些仍属 B/main/A。
- 未证明 durable exactly-once：fact 重传不等于业务命令重试；payload 重读不等于 effect 重放。
- `close()` 不停止物理 writer；不提供 native 发送、执行生命周期或权限。
