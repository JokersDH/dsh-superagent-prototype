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
| `beforeNativeWrite(cmd)` | `{v:1,type:'native-write-intent',id:<fresh intent id>,command}` | resolve 仅表示**本次**许可 | 不迁移：立即以 `indeterminate` 拒绝，旧 allowed 不复用 |

- `recordFact` 只接受属于登记 producer 的 fact（attempt 全字段 + source）。
- `beforeNativeWrite` 只接受 `kind='answer'` 的原命令；每次调用都是一次新意图，成功许可**只结算本次**，后一次同文本/同 command id 调用仍要重新走当前 guard。

### 4.1 native 意图的相关 id（wave-28 修正）

原业务身份 `command.id`/attempt/native binding/body **逐字节不变**，但每个 frame 的 `id` 是模块生成的 fresh correlation：

```
{ v: 1, type: 'native-write-intent', id: 'intent-<module salt>-<n>', command: <原命令> }
```

共享 v1 本地 schema 本来就允许 `id` 与 `command.id` 独立，所以没有新 wire 版本、没有新账本、没有 contracts 改动。作用：

- 旧 intent 的 `write-admission`（无论 allowed 还是 denied）即使被重放，也只能匹配它自己的 correlation；结算后该 correlation 不再存在，重放返回 `false`。
- 同一 `command.id` 的**顺序**新意图会得到新的 correlation，必须由当前 coordinator 对**新** frame 作出新决定；不存在"第一次 allowed 批准第二次"的路径。
- 同一 `command.id` 的**并发**第二意图被拒绝（`write_already_pending`），避免两个 promise 争同一次写前许可。
- correlation 由 `intent-<每模块 8 位 salt>-<单调序号>` 组成：模块内不复用、跨模块/attempt 不碰撞；序号到安全整数上界后以 `capacity/intent_correlation_exhausted` 拒绝。

断开/重绑行为不变：未决意图立即 `indeterminate`，旧 allowed 不迁移、不缓存；caller 必须回原 command reconciliation 后再发新意图。
- `readPayload` 的请求 id 由模块生成且不重用；返回值的 `JSON` 字节数超过 `maxPayloadBytes` 时以 `capacity` 拒绝并释放 pending。
- 每次请求都是"先注册 pending + 装 timer，再 send"；同步 send 抛错、同步 reply、异步 send 拒绝、timeout、close 竞争都最多结算一次。

### 断连与重绑的精确语义

- `lease.close()`（当前连接消失）：未决 **native write** → `indeterminate`；**facts/payloads 保留**，可在 replacement lease 上用原身份重发，deadline 不刷新。
- 旧 lease 的 `close()`：no-op，不影响 replacement。
- `module.close()`：终止**全部** pending/timer 并拒绝后续请求与 bind；facts/payloads → `closed`，writes → `indeterminate`。它只关闭通信，**不证明物理 writer 已停**；进程/barrier 仍由 B/main 原控制端证明。

## 4.2 in-process 车道的权限分工（wave-29）

事实落库与 native 写许可是**两种不同的权威**。`createCoordinatorSinkResponder` 把 in-process 车道的三个回答显式化：

```ts
const respond = createCoordinatorSinkResponder({
  facts: { record },                 // 原 A/public sink
  payloads: { read },                // 原 immutable Store/responder
  guardNativeWrite: command => guard(command),   // 必填：当前 main/Broker fresh guard
})
```

- 每个 native 意图调用一次 `guardNativeWrite`；返回 `false`、抛错、或根本没注入，都回答 `allowed:false`。
- 回复回显该意图自己的 `frame.id`；成功不缓存、不跨意图复用。
- fact 失败回答 `ack-failed`；payload 读取失败不回答，交由模块 deadline。
- 该 responder 没有策略：它只是把"缺 guard 就不许写"变成源码结构，而不是 `!businessClosed` 之类默认放行。

## 4.3 一个 callback 只有一个 transport owner（wave-30）

`next(connectionId)` / `receive(connectionId, …)` 都按**连接**寻址：请求只在该连接自己的 lease 上可读、可答，被替换的连接直接被拒（`stale_connection`）且不产生副作用。所以正确的服务端循环是：

- stdio 连接 → 允许 `write(frame)`；
- sink 连接 → 只交给 in-process responder；
- remote lease → 只通过它自己的 `next` 返回、由它自己的 `receive` 结算，**绝不镜像到 stdout**。

`lane-ownership.test.ts`（5 例）固定了该契约：remote 接管后 stdio 车道 `next/receive` 被拒、同一请求只暴露一次、跨车道不能双重结算、foreign producer 在每条车道都被拒。请求被"读走"不是投递：`next` 幂等返回 head，只有结算才出队，所以重复轮询不会造成重复写。

## 4.4 协调器 handover / 崩溃对账支持（wave-30）

模块只提供通信语义，不新建 coordinator：

- 原协调器离开（`lease.close`）后，未决 **fact/payload 保持原 id/引用与剩余窗口**，继任用显式 CAS（`expectedGeneration`）绑定后重发同一原始输入；
- 未决 **native 意图立即 `indeterminate`**，不迁移、不重放，旧连接的回执被结构性拒绝；
- `timeout` / `closed` / `stale_connection` / denial 语义互不混同：超时不是"未发送"，关闭不是"已写"，拒绝不是超时；
- 模块**从不**产生 begin/answer/cancel 等业务帧（`handover.test.ts` 断言帧类型集合仅为三种 v1 数据帧）；
- channel generation 不是业务 `fenceEpoch`/principal/target 许可；原 Work 的 check/candidate/manualaccept/slot 仍由 main/B 原链路完成。

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

消费者（如 B 的 recovery transport）可用 `toAttachFailure(error)` / `refusalFailure(refused)` 得到统一的
`AttachFailureCode`（含 `native_write_denied`），把该类型并入自己的错误 union 即可，无需 unchecked cast；
未知错误固定映射为 `protocol_error/unexpected_error` 且不保留原始 message。

## 6. 容量与结算规则

- 注册/发送前检查：`maxPendingFacts`、`maxPendingPayloads`、`maxPendingWrites`、`maxPendingBytes`（请求字节）。拒绝发生在创建 pending/timer 之前，被拒请求不会到达 transport。
- 回复侧检查：单个 payload 值 `JSON.stringify` 字节数 ≤ `maxPayloadBytes`；超限以 `capacity` 拒绝并释放。
- 同一 correlation id 的并发重复请求被拒绝（`fact_already_pending` / `write_already_pending`），不会静默合并成两个 promise。
- 已结算 id 记在有界 `maxSettledRequests` 环里：迟到的重复回执被识别为"已结算"、不会再触发一次结算；不会复活旧许可。
- `inspect()` 是唯一观测口：`state`/`generation`/三类 pending 数/`pendingBytes`。没有测试专用空方法，也不暴露私有 map。

## 7. 可运行 consumer

生产适配器在 `apps/runner/src/attach-channel/attach.ts`（`RunnerAttachChannel`），面向 `runner-service` 的**拉取**形状：路由取下一个待答请求，coordinator 答复后再交回同一连接。它自身不保存 pending map、timer 或 generation。

```ts
const attach = new RunnerAttachChannel({ producer, limits })

// 唯一的变更入口：显式 full producer + CAS generation。
const generation = attach.bind({ producer, connectionId: leaseRef, expectedGeneration: currentGeneration })

// 只读轮询：不 bind、不替换 lease、不为别的连接作答。
const next = attach.next(leaseRef, producer)
if (next.ok && next.request) deliverOverAuthenticatedRoute(next.request)

// 回复只交回产生它的连接；接受性与拒绝原因由模块判定。
const reply = attach.receive(leaseRef, frame, producer)   // { accepted, generation, refused? }

// 连接消失；未决写变 indeterminate，facts/payload 等重绑。
attach.drop(leaseRef, 'socket closed')
```

- `next`/`receive` 的 refusal 只有 `stale_connection` / `identity_mismatch` / `closed`，且**不产生副作用**；stale/foreign 调用者无法通过 poll 重新占位。
- 出站队列按 `kind:correlation` 去重（每类每个 pending 至多一条，fact id 与 `payload-<n>` 不会互相吞掉），重绑只重建当前 generation 的条目，结算即出队；长度不超过构造函数的三类 pending 上限。
- `next` 是幂等的：在 head 被答复（或超时/关闭）之前，重复轮询返回同一条请求；这使客户端重试不会丢请求，也让一次连接同时只有一个在途请求。
- 独立复现：`apps/runner/test/attach-channel/independent-consumer.test.ts`（只 import 公开入口），B 路由形状：`b-route.test.ts`。

## 8. 验证

```bash
# 严格类型（strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes）
node_modules/.bin/tsc -p apps/runner/src/attach-channel/tsconfig.json
# 行为矩阵（注入时钟，无 sleep、无真实网络/模型）
cd apps/runner && node --test --test-timeout=8000 test/attach-channel/*.test.ts   # 147/147
```

覆盖：模块既有 scope 之外，wave-31 增加了真实消费者：真实 `serveRunner`（原 fact id/fresh intent/重放拒绝）、真实 `ProductStore` ingress（receipt 回读）、真实 Broker 等价 guard、真实 endpoint 双 client 与继任、ACK 窗口、64 上限背压、4 槽隔离、shutdown/malformed、公开接口兼容。完整清单与调用图见 `adoption-manual.zh-CN.md`；terminal/detach 与页/块语义见 `fault-states.zh-CN.md`。wave-33 起同时消费 main 的 `RunningAttempt.attachPort` 数据形状与 `attachRunnerAttempt` caller（真实 Store ingress / 原 payload body / 逐意图 guard），见手册 §2.1。wave-27 的 44 个历史用例保留在原 scope 内。

## 9. 本文明确不证明的事

- **B 已实际接入并闭合单 owner**（观察源 `fbc9331`）：B import `RunnerAttachChannel`，旧三张 waiter map 与自建 poll queue 已删除，sink 意图必须经过注入的 `beforeNativeWrite`（缺失/拒绝/抛错零效果）；remote 接管后旧 stdio 收到 0 帧（B 自己的 `b30-transport-owner` 探针与 focused 8/8、direct strict 0）。
- 历史上"B 仍有 stale channel 编译错误"的观察属于中间 working tree（`1930278`），当前 source 不再成立，已从本文件与 adoption 清单删除。
- 未证明：同 Runner 进程双 client、coordinator SIGKILL 后原问题→交付、跨 coordinator 崩溃恢复、durable exactly-once、物理 writer quiescence。
- 测试中的 `DurableSink`/`ImmutablePayloads`/guard 都是契约/语义 double，不代表 A 的持久化 ingress 或 main/Broker 的真实许可。
- `readPayload` 只承载 immutable payload **JSON 值**（受 `maxPayloadBytes` 约束），不替代 B 的 journal/descriptor 分块回放路线。
- H 仍消费旧快照并在导入前因 source pin 拒绝（`NOT_REACHED_SOURCE_REFUSAL`）；它需要绑定当前 source 后独立执行。
