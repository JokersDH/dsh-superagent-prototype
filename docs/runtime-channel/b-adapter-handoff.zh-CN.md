# B 接入交接：用 CoordinatorChannel 取代原三张 waiter map

2026-11-14，wave-27 / I。目标读者：B（`apps/runner` 中除 `src/attach-channel/`、`test/attach-channel/` 外的唯一所有者）与 main。

模块与接口已可用；**B 的真实接入尚未发生**，所以本文件是替换点与义务清单，不是"已接入"声明。I 不修改 `runner-service.ts`、`runner-link-client.ts`、routes/auth/dispatch/lifecycle 或 contracts。

## 1. 现在要做的事（按顺序）

1. 在 `runner-service.ts` 顶部新增一次构造：每个 attempt 一个 channel，producer 取 bootstrap 时已认证的登记（`frame.producer` 与 `spec` 的 attempt 元组），**不要**用 fact/命令自己携带的身份。
2. 把三处 pending 注册替换成 channel 调用；把四个收帧分支（`receipt`/`payload`/`write-admission`/`ack-failed`）替换成 `lease.receive(frame)`。
3. 删除三张 map 与 `closeAdmission` 里的遍历；改为 `channel.close()`（见 §4 顺序）。
4. 传输层保持原样：`write({...})` 作为 `send` 注入；socket 关闭时对该连接的 lease 调 `close()`，重连时用**当前** `generation` 重新 `bind`。

## 2. 精确替换点（today 的 `apps/runner/src/runner-service.ts`）

| 位置 | 现在 | 替换为 |
| --- | --- | --- |
| `:144` `factWaiters` 声明 | `Map<string, {resolve,reject}>` | 删除 |
| `:150` `payloadWaiters` 声明 | 同上 | 删除 |
| `:151` `writeWaiters` 声明 | 同上 | 删除 |
| `:152-156` `hooks.beforeNativeWrite` | 手工 set waiter + `write({type:'native-write-intent'})` | `command => channel.beforeNativeWrite(command)`，保留 B 自己的 `businessClosed`/admission 前置判断 |
| `:226-234` `payloads.read` 远程分支 | `payloadWaiters.set(requestId, …)` + `write({type:'payload-read',…})` | `return channel.readPayload(reference)`（本地 `readLocal` 命中优先的现有顺序可保留） |
| `:242-250` `factSink.record` 远程分支 | `factWaiters.set(fact.factId, …)` + `write({type:'fact',…})` | `const receipt = await channel.recordFact(fact)`；保留其后的 `receipts.set` 与 `write({type:'receipt',…})` 业务回显 |
| `:325-332` `case 'receipt'` | 查 `factWaiters` | `lease.receive(frame)`（整段可删，并入统一入口） |
| `:334-341` `case 'payload'` | 查 `payloadWaiters` | 同上 |
| `:342-346` `case 'write-admission'` | 查 `writeWaiters` | 同上；允许/拒绝语义由模块给出（拒绝抛 `NativeWriteDenied`） |
| `:348-363` `case 'ack-failed'` | 查 `factWaiters` + 写 progress | `lease.receive(frame)` 负责拒绝原 promise；progress 诊断保留在原位置 |
| `:129-136` `closeAdmission` 的三 map 遍历 | `for (const waiters of [...]) reject/clear` | `channel.close('attempt admission closed')`；`businessClosed`/`processHost`/`runner` 的关闭顺序保持 |

替换后 `runner-service` 不再持有任何 pending map、timer 或 generation；这正是"一个 pending 所有者"（I10）的可检查结论。

## 3. 连接与路由义务

B 同时负责 socket 与认证，所以 B 必须：

- **一连接一 lease**：把 `bind` 返回的 lease 与该连接对象绑定，回复只喂给这个 lease。
- **不得**把旧 socket 的解码帧交给"当前 lease"：v1 frame 没有 generation 字段，模块只能靠 lease 身份 fencing；交叉投递会让旧回复结算新 pending。
- socket 断开 → 该 lease `close()`；重连 → 用 `channel.inspect().generation` 作 `expectedGeneration` 重新 `bind`。
- `RunnerLinkClient` 的 responder（`:123-154` 的 `handle`）负责**相反方向**：收到 fact/payload-read/native-write-intent 后用 sink/payload store/guard 回 `receipt`/`payload`/`write-admission`/`ack-failed`。这部分逻辑与 wire 都不变，只是回执最终经当前 lease 送达。

最小调用片段（也可直接复制 `apps/runner/test/attach-channel/adapter.ts`）：

```ts
const attach = new RunnerAttachChannel({ producer, limits })
let generation = attach.bind({ connectionId: 'conn-1', expectedGeneration: 0, transport: { send: frame => write(frame) } })
socket.on('frame', frame => attach.accept('conn-1', frame))
socket.on('close', () => attach.drop('conn-1', 'socket closed'))
// 重连
generation = attach.bind({ connectionId: 'conn-2', expectedGeneration: generation, transport: { send: frame => write(frame) } })
```

## 4. 关闭顺序（不要交换）

1. `businessClosed = true`（原业务拒绝语义，保持）
2. `channel.close('attempt admission closed')` —— facts/payloads 得 `closed`，pending write 得 `indeterminate`
3. 原有的 `processHost.closeAdmission()`、`runner.closeAdmission()`、`preparation.abort()` 顺序不变

`indeterminate` 是刻意的：如果 native 是否已写出无法确定，caller 必须回原 command reconciliation，不得把 `close` 当作"未发送"。**channel 的 close 不停止物理 writer**；quiescence 仍由原 process host/barrier 证明。

## 5. 不得改动 / 不属于本包

- 不改 v1 wire、`RUNNER_BRIDGE_PROTOCOL`、认证、HTTP routes、`dispatch`/`begin`/`prepared`/stop 生命周期。
- 不新增第二 coordinator、账本、DB writer、Driver、权限或执行入口。
- 失败码与 `NativeWriteDenied` 语义见 `docs/runtime-channel/README.zh-CN.md` §5；B 若需要额外状态，加在 B 自己的业务错误里，不要改共享联合类型。

## 6. 接入后的回归输入（B 自有断言）

- 原正常链：bootstrap → begin → question → answer(+native admission) → delivery → stop 全绿，且三张 map 已不存在。
- 重绑：A 断开、B 接上，未决 fact 用原 id 得到 A 的 durable ACK；未决 native write 变 `indeterminate`，且**没有**新的 guard 决策被旧回复触发。
- 关闭：`shutdown` 后原 pending 不悬挂、不误报成功。
- 旧回复：旧 socket 迟到 receipt/payload/write-admission 不改变新连接状态。

## 7. 仍未达（I 侧如实记录）

- **B 真实接入未达**：截至本文件，`runner-service.ts` 仍持有三张 map；I12 不标 PASS。
- 同 Runner 进程双客户端、coordinator SIGKILL 后原问题→交付、跨 coordinator 崩溃恢复：仍属 B/main/A。
- H 的独立 consumer 可复现模块行为（见 `h-independent-consumer.zh-CN.md`），但独立复现不等于产品/native 准入。
