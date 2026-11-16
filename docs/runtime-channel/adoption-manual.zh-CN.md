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
node --test --test-timeout=60000 test/attach-channel/*.test.ts     # 159/159
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
| `actual-reattach.test.ts` | 临时 detach 后合法继任、未决写 indeterminate、旧 allowed 无效 | 2 例 |
| `actual-transport-integration.test.ts` | journal 页游标、reference 帧、分块 payload digest、未匹配 ACK | 2 例 |
| `actual-main-port-consumer.test.ts` | main `AttachedAttemptPort` + `attachRunnerAttempt` + 真实 Store ingress/payload/guard | 4 例 |
| `actual-caller-succession.test.ts` | 两个真实 caller 的继任、未决写 indeterminate、terminal closed | 3 例 |
| `actual-pressure-diagnostics.test.ts` | 慢 Store、typed ack-failure、64 饱和恢复、四端点隔离 | 4 例 |
| `actual-native-callbacks.test.ts` | 原 class `recordFact`/`readPayload`/`nativeWriteDecision` 作为回调 | 3 例 |
| `actual-guard-and-command.test.ts` | void/throw/late guard 分层、命令传输与 callback generation 独立 | 3 例 |
| `actual-native-succession.test.ts` | 原方法 caller 继任、terminal vs EOF | 2 例 |
| `actual-native-pressure.test.ts` | 原 sink 慢/拒绝、缺失 local payload、64 饱和 | 3 例 |
| `actual-run-handoff.test.ts` | 同 run handoff 记录（原 ID/receipt/nonce/资源/scope） | 1 例 |

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

## 5.0 main 原端口（attachPort）与原 caller

main `fc38` 在 register+ready+current 与 endpoint 存在后返回可选的 `RunningAttempt.attachPort`：

```ts
type AttachedAttemptPort = {
  registration: { socketPath: string; credentialPath: string; socketIdentity: { dev: number; ino: number } }
  producer: RuntimeProducer
}
```

它是**原登记数据**，不是命令许可；真正的写许可仍由 main/Broker 的 current/command digest/live answer guard 判。原 caller 在 `packages/execution/src/attached-attempt.ts`：

```ts
const attached = attachRunnerAttempt({
  endpoint: port.registration,
  producer: port.producer,
  leaseId,                                  // 由调用方显式选择，不另造 owner
  callbacks: {
    fact,                                   // 原 Store ingress
    payload: request => store.read(request.reference),   // 原 immutable body
    nativeWrite: intent => guard(intent.command),        // 每次 fresh
  },
})
await attached.run({ pollMs: 25, deadlineMs })   // 或 pollOnce()
```

注意点：

- caller 以 `channelState()` 的 generation 做首次 CAS；之后的 poll 只读。
- `payload` 回调收到的是 `reference`，返回值必须是**原 JSON body**；journal descriptor/chunk 是另一条协议。
- `nativeWrite` 缺省即拒绝；回调内部异常会转成 ack-failure，不会伪造 receipt/allow。
- 拒绝由 `NativeWriteDenied` 表示；用 `instanceof` 判定或 `toAttachFailure` 归一为 `native_write_denied`。错误对象字段形状保持原样，main 现有 consumer 的观测字符串不变。

## 5.0b 原 class 方法（`attachCallbacks` 的实现）

main `23d5a98e` 把原 stdio 闭包提成 `NativeProductAttempt` 的方法，`RunningAttempt.attachCallbacks` 只是它们的薄包装：

| 方法 | 语义 | 拒绝示例 |
| --- | --- | --- |
| `recordFact(incoming, localPayloadStore, prepared)` | 校验 attempt/source → 原 immutable payload 复制与身份一致 → 原注册 → 原 sink 回执 → policy-prepared | foreign source、payload 身份变化、sink 拒绝 |
| `readPayload(reference)` | 原 immutable payload 读取（环境计划前会 register 并核 current） | 未知引用、current 失效 |
| `beforeNativeWrite(command)` | 原 current + product-command 精确摘要 + live answerWrites 一次性准入；**成功为 void** | 未索引、无 admission、错 body、current 变化、admission 抛错 |
| `nativeWriteDecision(command)` | 仅在上面的守卫成功后返回 `{allowed:true}`，否则 false | 同上 |

**分层规则**：`beforeNativeWrite` 的 void 成功只有在显式 wrapper（main 的 decision）里才变成 `{allowed:true}`；通信层收到裸 void 回调时必须视为**没有允许**（实测为主叫方 typed 拒绝，driver 零写）。错误对象形状保持不变（`NativeWriteDenied` 用 `instanceof`/`toAttachFailure` 判定），以免改变 main 现有消费者的观测字符串。

**运行方式（测试/受控）**：`attachCallbacks` 只在 `launch()` 后返回，而 `launch()` 会 spawn 原生 Runner。I 的消费者因此直接构造同一个类，并把 in-process 服务已注册的 endpoint 注入为 post-registration 状态（等价于 `launch()` 已建立的状态），**不 spawn、不 launch**；生产接线仍由 main/B 负责。

## 5.0c 同 run handoff 记录

`actual-run-handoff.test.ts` 产出的 `RunHandoffRecord` 形状：

```
attempt {ticketId, assignmentId, attemptId, fenceEpoch, contractDigest}
producer {source, runnerIdentityRef}
leaseGenerations [1, 2]
facts [{factId, receiptSeq, storeRowSeq}]
payloads [{reference, readByOriginal}]
intents [{nonce, commandId, decision, guardCalls}]
resources {channelServed{facts,payloads,nativeWrites,errors,refused}, storeFacts, sinkCalls}
scope {applicationWork:NOT_REACHED, questionBroker:NOT_REACHED, native:NOT_TESTED, recoveredCandidate:NOT_REACHED, slotRelease:NOT_REACHED, installed:NOT_INSTALLED}
```

核对点：`receiptSeq === storeRowSeq`、`nonce !== commandId`、generation 单调、guard 每意图一次；记录只陈述已观测事实，不给候选/接受/物理结论。

## 5.1 terminal 与 detach

见 `fault-states.zh-CN.md`：终态（main `finish()` → `attach.close()`）关闭全部 lease/pending，pending fact 为 `closed`、未决 native 为 `indeterminate`、迟到 next/reply 零效果；仍 running 的临时 detach 可以合法继任，但旧 allowed 不迁移。wave-31 关于 shutdown 的相反观察来自缺 `id` 的无效帧，已纠正。

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
