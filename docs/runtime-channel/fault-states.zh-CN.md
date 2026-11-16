# 通信故障与终态操作说明（wave-32）

2026-11-16。面向 B/E/H：在原 `serveRunner` 消费者中，事实、payload、写前授权与 terminal/detach 的准确语义。实现：`apps/runner/src/attach-channel/`；验证：`apps/runner/test/attach-channel/actual-*.test.ts`。

## 1. 三种"断开"必须区分

| 事件 | 触发 | 未决 fact/payload | 未决 native 意图 | 迟到 reply / next |
| --- | --- | --- | --- | --- |
| **lease 替换**（合法继任） | 新连接显式 CAS `expectedGeneration` 绑定 | 保留原 id/引用，向新 lease 重发，窗口不刷新 | 立即 `indeterminate`，不迁移 | 旧 lease 的 next/reply 被拒（structural fence） |
| **临时 detach**（attempt 仍 running） | 连接消失，但没有终态 finish | 保留，等待重接 | `indeterminate` | 旧连接 0 效果；新连接可继续 |
| **terminal close**（服务终态） | driver 结束或 `shutdown` → main `finish()` 调 `attach.close()` | 以 `closed` 拒绝 | 以 `indeterminate` 拒绝 | next → `stale_connection/channel_closed`；reply → 409 `stale_lease`；0 效果 |

实测（main `b72e935d` 的 terminal fence）：

- 待处理 fact 在 terminal 收到 `closed`，**不会**被伪造成 receipt；
- 待处理 native 意图收到 `indeterminate`（"未知是否已写"，不是"未发送"）；
- `channelState` 仍可读（只读），但不授予任何 poll/reply 权限；
- 迟到 reply 不能复活已退役 pending；旧 allowed 帧在任何连接上都无效。

## 2. 一个容易踩的坑：malformed shutdown

`shutdown` 帧必须带 `id`。缺 `id` 的 `{type:'shutdown'}` 会被 `parseBridgeFrame` 判为 `protocol_error/unexpected_error`，**不会执行**终态关闭。wave-31 的一个探针曾漏掉 `id`，因此那条"shutdown 后 pending 仍未知"的结论属于无效帧路径，已在本轮纠正（见 `actual-shutdown.test.ts` 第三例）。

## 3. 事实、payload 与页/块的所有权

| 数据 | owner | 说明 |
| --- | --- | --- |
| fact 持久化/幂等 | 原 ingress（A/main） | 通道只传已校验 request/reply；不造 `persisted:true` |
| payload 值 | 原 immutable Store/responder | `payload-read` 整值受 `maxPayloadBytes`；重读同引用 |
| journal 分页 `facts(since,maxBytes)` | B 恢复传输 | 与通道并存；`maxBytes` 最小 1024；大 payload 以 reference 帧返回 `payloadBytes/payloadDigest` |
| 分块 `payload(ref,offset,length)` | B 恢复传输 | 返回 `{total,digest,base64}`；分块重组后与原 JSON 的 sha256 一致 |

通道 **不** 承担 journal 分页/分块协议；两套共存于同一认证端点（`actual-transport-integration.test.ts`）。

## 4. 最小适配片段（B/E/H 可直接引用）

```ts
import { RunnerAttachChannel, DEFAULT_LIMITS, toAttachFailure } from './attach-channel/index.ts'

const attach = new RunnerAttachChannel({ producer, limits: DEFAULT_LIMITS })

// 唯一变更入口：显式 full producer + CAS
const generation = attach.bind({ producer, connectionId, expectedGeneration })

// 只读 poll：不 bind、不换 lease、不代其它连接作答
const page = attach.next(connectionId, producer)
// { ok:true, generation, request, expiresAt, remainingMs } | { ok:false, refused }

// 回复只交回产生它的连接
const reply = attach.receive(connectionId, frame, producer)   // { accepted, generation }

// 临时 detach（attempt 仍 running）
attach.drop(connectionId, 'socket closed')

// 终态（服务结束）——必须调用，才会关闭全部 pending
attach.close('Runner service is terminal')
```

错误一律用 `toAttachFailure(error)` 归一：

| code | 含义 | 后端/消费者动作 |
| --- | --- | --- |
| `native_write_denied` | 当前 guard 的权威否定 | 不写；可对同一原 command 重新询问 |
| `indeterminate` | native 结果未知 | 回原 command reconciliation；禁止盲重试 |
| `closed` | 通道/attempt 终态 | 停止使用 |
| `timeout` | 本请求窗口到期 | facts 可用原 id 再确认；payloads 可重读 |
| `stale_connection` / `identity_mismatch` | 旧连接或非登记 producer | 不得迁移旧许可 |
| `capacity` | pending/bytes 超界 | 降并发或等待回收 |

## 5. 验收对照

| 场景 | 用例 |
| --- | --- |
| terminal：pending fact/write、迟到 reply | `actual-shutdown.test.ts` 前两例 |
| malformed shutdown 不执行 | `actual-shutdown.test.ts` 第三例 |
| 临时 detach + 继任 + 旧 allowed 无效 | `actual-reattach.test.ts` 两例 |
| 页游标 / reference 帧 / 分块 digest | `actual-transport-integration.test.ts` |
| 原 Store 回执 | `actual-store-callbacks.test.ts` |
| guard 缺/deny/throw/错 body | `actual-broker-guard.test.ts` |

## 6. 范围

以上是**通信层**语义。原 A 新进程、`question→native_applied→ACK unknown`、Completion/check/currentCandidate/manualaccept、slot 释放仍由 B/main 原链完成；本说明不把这些标为已验证。真实 vendor/model/native 与 installed 字节仍分开记录。
