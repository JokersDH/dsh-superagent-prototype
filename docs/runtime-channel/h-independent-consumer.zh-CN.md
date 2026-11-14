# H 独立 consumer 复现指南

2026-11-14，wave-27 / I。H 在自己的测试目录（`tests/operational-soak/` 或 `tools/trial-kit/` 下，按 H 自己所有权）写独立 consumer；I 不改 H 断言，也不为 H 另造测试专用 class。

## 1. 可复制的最小输入

- 公开入口：`apps/runner/src/attach-channel/index.ts`（只导出共享类型、一个实现、两个错误类）。
- 共享类型：`packages/contracts/src/coordinator-channel.ts`（main 0068 发布；不要复制一份"本地版"）。
- 可复制样例：`apps/runner/test/attach-channel/independent-consumer.test.ts`（自包含 producer/时钟/对端，不 import I 的 fixtures）与 `adapter.ts`（Runner 侧适配器）。

## 2. 合法 fixture 要求

- producer 必须是**原登记语义**的 attempt 元组：`ticketId/assignmentId/attemptId/fenceEpoch/contract{workId,revision,digest}` + `runnerIdentityRef` + `source`；额外字段会被严格 schema 拒绝。
- fact 用原 `CriticalFact`：attempt 元组一致、`source` 等于 producer.source、`payloadRef` 是有界 id。
- payload 用原 `payload:<digest>` 形状的引用；值必须可 JSON 序列化并受 `maxPayloadBytes` 约束。
- native 意图只用 `kind='answer'` 的 `RunnerCommand`；其余 kind 会被 `unsupported_command` 拒绝，这不是缺陷。
- 不要使用真实 credential、模型资源、用户实例目录或全局发现。

## 3. 应能复现的正/负结果

正：

1. 单连接三回调：fact 得 durable receipt、payload 得 immutable 值、answer 得一次许可。
2. 同 controller 重绑：未决 fact/payload 用原 id/原引用在新 lease 完成；未决 write 变 `indeterminate`，随后**新**意图重新经过 guard。
3. 容量回收：结算后同类 pending 再次可注册。

负：

1. 外来 source / 错 attempt / 错 fenceEpoch → `identity_mismatch`，且 transport 一个帧都没收到。
2. 错 generation 的 bind → `stale_connection`，当前 lease 与 pending 不受影响。
3. 旧 lease 的 `receive`/`close` 不影响 replacement。
4. 超时/关闭后迟到回执不复活、不二次结算。
5. 超 `maxPendingBytes`/`maxPayloadBytes` → `capacity`，且不留下 pending。

## 4. 复现出问题时的定位

先判断归属，再报给对应 owner，不要通过放宽断言"修好"：

- **模块实现**（`apps/runner/src/attach-channel/`）：关联、timer、容量、fencing、错误码、结算次数。
- **B 适配器**（H 若用 B 的接线）：连接↔lease 路由、`drop` 调用点、`close` 顺序。
- **共享接口**：若发现字段缺口，交 main 最小 RFC；H/I 都不直接改 contracts。

报告请附：exact 输入（producer/fact/请求顺序）、注入时钟推进值、实际 `inspect()`、错误 `code/reason`、源码路径与行号。

## 5. 边界

H 复现的是**通信模块**行为，不是产品/native/安装准入：不证明同 Runner 进程、coordinator SIGKILL 恢复、durable exactly-once 或物理 writer quiescence；这些仍由 B/main/A 的原始证据负责。
