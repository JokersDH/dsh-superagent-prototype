# 三类 consumer：合法 frames 与实际 B bridge 回调

2026-11-14，wave-27 H 的第一/第二结果。目录：`tests/operational-soak/channel/`。

## 入口

```bash
node tests/operational-soak/channel/produce.mjs --out <新目录>
node tests/operational-soak/channel/read.mjs --run <produced-root>
node --test tests/operational-soak/channel/channel.case.mjs
```

产物：

| 文件 | 内容 |
| --- | --- |
| `frames.json` | 共享 `CoordinatorChannel` 的 3 类合法请求 + 4 类合法回复、完整 producer、limits、9 个请求负例、5 个回复负例、generation/CAS/late/close/capacity 契约场景 |
| `consumer-allow.json` | 真实 B runner-service stdio bridge 上三类回调的 actual 计数（allow） |
| `consumer-deny.json` | 同一链路的 native-write guard 拒绝（deny） |
| `report.json` | 汇总、checks、零模型/零信号事实和 NOT_REACHED 列表 |

## 实际测到什么

`consumer-*.json` 的计数来自真实 `serveRunner` 与 bridge 帧，不是静态 descriptor：

- **fact ACK sink**：三次 `io.record` → 三个 `fact` 帧；两次相同 factId 得到同一个 A durable receipt（`seq` 相同，A `facts.record` 幂等）；指定 fact 由 receiver 回 `ack-failed`，driver 捕获失败。`sends/executes` 只按实际帧计数。
- **payload reader**：driver 读 coordinator-owned reference → 真实 `payload-read` 帧 → 回复 `payload`，值类型/内容与注入一致。另有三条 spool 读取（fact payloadRef 本地缺失）同样走原链路，因此 `payloadReadFrames` 可为 4，而显式读取成功为 1。
- **native-write guard**：`hooks.beforeNativeWrite(answer)` → 一个 `native-write-intent` 帧；allow 时只对本次 command 回 `write-admission=true` 并继续；deny 时回 false，driver 收到拒绝且 `admittedWrite=false`。没有缓存/转移旧许可。

零模型：driver 是确定性 fixture；`modelCalls=0`、`vendorTurns=0`、`nativeProfile=null`。零信号：`signalsSent=0`；runner service 在进程内，无 daemon、无 SIGKILL、无全局扫描。

## 合法 frames 与拒绝

- 请求：`fact`（correlation id = factId）、`payload-read`（id = requestId）、`native-write-intent`（仅 answer 命令）；producer 来自登记 tuple（attempt/contract + runnerIdentityRef/source）。
- 回复：`receipt`（persisted=true、factId 对齐）、`ack-failed`、`payload`、`write-admission`。
- 负例：错 source、错 attempt、correlation 不符、v2、缺 id、额外字段、begin 假冒 write-intent、foreign producer、回复 factId/持久化/关联不符——全部由共享 schema/`parseCoordinatorChannelRequest` 拒绝，`sends=0`、`executes=0`。

## 明确未达

`CoordinatorChannel` 模块属于 I（`apps/runner/src/attach-channel/`），本 checkout 没有实现，因此以下只作为**契约场景**交给 I/B，未执行、未声称通过：

- generation 0→1→2 的 CAS、负值/超安全整数拒绝；
- 旧 lease 的回复不被新 lease 接收、旧 `close` 不关闭新连接/attempt；
- 迟到回复、`timeout`、`closed`、`capacity`（facts/bytes/writes）与 `indeterminate` 写；
- **同 Runner 双 client 重绑**、**SIGKILL 跨进程恢复**、**原 Work 人工接受**：NOT_REACHED。

H 不实现这些语义，也不新建 coordinator/ledger/gate；I 实现后，B/H 可直接用 `frames.json` 与 `consumer-*.json` 做正控/负控。

## 与恢复输入的关系

`tests/operational-soak/recovery/` 继续提供原 ProductRuntime/Broker/A Store 的 Work/Answer/native_applied 与 inspect/cancel；本目录补上三类 callback 的实际计数与共享 frames。两者都只使用自建 fixture 根，不读取个人 state/profile/credential。
