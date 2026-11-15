# wave-29 采用清单：I 当前 source 与 B/H 的实际接入

2026-11-15。机器可读版本：`reports/runtime-channel/wave29-adoption.json`。本文只描述**当前实际 source**，不把目录/import 名称当采用证明。

## 1. I 当前 source（本轮交付）

分支 `codex/g5-coordinator-channel`，基线 `4d85cc34`，本轮提交见 `wave29-adoption.json.sourceCommit`。

| 文件 | blob（内容哈希） |
| --- | --- |
| `coordinator-channel.ts` | `d1ef81eb9d51b24417645151440eb1e262c20546` |
| `errors.ts` | `ec8ce909d0f30ab1d96488db56cdf3b6a4ab7f49` |
| `attach.ts` | `321738dae3b87e6ad7d235f52aaa65e6f63ab527` |
| `sink-responder.ts`（新） | `992a8cc0fceb55d7b2a9e2e8c8068202a892acb3` |
| `refusals.ts`（新） | `25ebcd26f1fb4aad583048dc672ec2bf09066b32` |
| `index.ts` | `6314546e1d1facde00d0d2195edf1c14ad7a85d2` |
| `tsconfig.json` | `1e5af3ea23fb4288afad29954cb31927f3e1e564` |

验证：direct strict exit 0；`test/attach-channel/*.test.ts` 84/84；共享契约 `coordinator-channel.case.ts` 5/5。

## 2. B 当前实际接入（观察源 `1930278c`）

- B 已 merge `codex/g5-coordinator-channel`（到 `4d85cc3`），vendored 的 `coordinator-channel.ts`/`errors.ts`/`attach.ts` blob 与 I 完全一致；`index.ts` 是 wave-28 版本（缺 sink-responder/refusals 导出，不影响其现有接线）。
- B 的 `runner-service.ts` 实际 import `RunnerAttachChannel`，由 adapter 持有 lease、kind 命名空间队列、settlement pruning 与 deadline；**旧三张 waiter map 与自建 `connections`/`currentConnection` 均已删除**。
- 保留的 `dispatched` map 只是"该连接已交付过哪个 head"的去重记录（`key` 为 `kind:correlation`），在 reply/rebind 时删除；它不是 pending 所有者、timer 或授权。
- sink 车道已修：native 意图必须由注入的 `options.beforeNativeWrite` 决定；**缺失/拒绝/抛错都得到 `allowed:false`**，不再用 `!businessClosed` 默认许可（wave-29 审计的 `B29-FACT-SINK-IS-NOT-NATIVE-ADMISSION` 在该 source 已关闭）。
- `recovery-transport.ts` 已采用"base code + serverError"的分离写法，wave-28 的 TS2345 不再复现。

### 当前 B 的唯一阻塞（B 自己的 owner）

直接 strict 编译 `runner-service.ts` 失败：

```
runner-service.ts(283,10): error TS2304: Cannot find name 'channel'.
runner-service.ts(286,12): error TS2304: Cannot find name 'channel'.
```

这是重构到 adapter 后 `hooks.beforeNativeWrite` 里遗留的旧引用。drop-in 修法（不改变语义）：

```ts
const hooks = { beforeNativeWrite: (command: RunnerCommand) => {
  if (!attach || businessClosed || command.kind !== 'answer')
    return Promise.reject(new Error('Native write admission is closed'))
  return attach.hooks.beforeNativeWrite(command)
} }
```

I 不修改该文件；以上是精确替换点。

## 3. 本轮新增的两块 source（B 可选、消费者可用）

### 3.1 `createCoordinatorSinkResponder`（in-process 车道的 guard 约束）

`facts.record` / `payloads.read` / `guardNativeWrite` 三者都必须由原权威注入；`guardNativeWrite` 在类型上必填，运行时缺失也 fail-closed：

- 每个 native 意图调用一次 guard；`false`、抛错、未注入都回答 `allowed:false`；
- 回复回显请求自己的 `frame.id`（fresh correlation），绝不回 `command.id`，也不缓存成功；
- fact 失败回答 `ack-failed`；payload 失败不回答（交由模块的有限 deadline）。

B 当前用自己注入的 `beforeNativeWrite` 已达成同等语义，**不强制**改用本 responder；它存在的意义是让"只有 FactSink"的接线在源码层面无法默认放行。

### 3.2 `toAttachFailure` / `AttachFailureCode`（消费者类型收口）

把 `CoordinatorChannelError`、`NativeWriteDenied` 与 adapter 的 `refused` 映射成统一的有限 code：`identity_mismatch | stale_connection | closed | timeout | capacity | protocol_error | indeterminate | native_write_denied`。消费者用 `AttachFailureCode` **扩宽自己的 union** 即可，无需 unchecked cast；未知错误不保留原始 message，避免路径/秘密泄漏。

## 4. H 当前状态

H 观察源 `2d1e4941`，其默认 materialization 仍指向旧 `d95df88`/`cb4e975`，并因 main-root pin 不匹配而在导入前拒绝（`NOT_REACHED_SOURCE_REFUSAL`）。H 需要：

1. 显式绑定本文件 §1 的 I commit/blob（不是旧快照）；
2. 在自有目录执行三 callback/CAS/late/fresh/namespace/bounds 的正负例；
3. 旧材料保留为历史，但不得当作 current 运行结果。

## 5. 最小合入清单

1. B 通过原分支并入本轮 commit（或取 §1 的 blob），不手改 I subtree。
2. B 修掉 §2 的两处 `channel` 遗留引用（用 `attach.hooks.beforeNativeWrite`）。
3. B 保留 auth/routes/dispatch/begin/prepared/process/lifecycle；I 不提供 policy。
4. H 按 §4 绑定 exact current source 后执行独立 consumer。
