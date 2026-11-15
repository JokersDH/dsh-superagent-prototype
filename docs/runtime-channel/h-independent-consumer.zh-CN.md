# H 独立 consumer 复现指南

2026-11-15（wave-28 修订）。H 在自己的测试目录（`tests/operational-soak/` 等，按 H 自己所有权）写独立 consumer；I 不改 H 断言，也不为 H 另造测试专用 class。

## 1. 可复制的最小输入

- 公开入口：`apps/runner/src/attach-channel/index.ts`
  - `CoordinatorChannelModule`（三回调）
  - `RunnerAttachChannel`（pull 路由：`bind` / `next` / `receive` / `drop`）
  - `CoordinatorChannelError`、`NativeWriteDenied`、共享 schema 重导出
- 共享类型：`packages/contracts/src/coordinator-channel.ts`（main 0068；不要复制"本地版"）
- 可复制样例：
  - `apps/runner/test/attach-channel/independent-consumer.test.ts`（自包含 producer/时钟/对端，含旧 allowed 重放负例）
  - `apps/runner/test/attach-channel/b-route.test.ts`（B 路由形状：显式 CAS、只读 poll、stale/foreign 拒绝）

## 2. 合法 fixture 要求

- producer：原登记 attempt 元组（`ticketId/assignmentId/attemptId/fenceEpoch/contract{workId,revision,digest}`）+ `runnerIdentityRef` + `source`；额外字段会被严格 schema 拒绝。
- fact：attempt 一致、`source` 等于 producer.source、`payloadRef` 有界 id。
- payload：原 `payload:<digest>` 引用；值须可 JSON 序列化且受 `maxPayloadBytes`。
- native 意图：只用 `kind='answer'` 的 `RunnerCommand`；`frame.id` 是模块生成的 fresh correlation，`command` 原样。
- 不使用真实 credential、模型资源、用户实例目录或全局发现。

## 3. 应能复现的正/负结果

正：

1. 三回调：fact 得 durable receipt、payload 得 immutable 值、answer 得一次许可。
2. 同 controller 重绑：未决 fact/payload 用原 id/原引用在新 lease 完成；未决 write 变 `indeterminate`，随后**新**意图重新经过 guard。
3. 容量回收与 remaining deadline：`next` 返回的 `expiresAt` 不因轮询刷新；结算后出队。

负：

1. 外来 source / 错 attempt / 错 fenceEpoch → `identity_mismatch`，transport 一个帧都没收到。
2. 错 generation 的 bind → `stale_connection`，当前 lease 与 pending 不受影响。
3. 旧 lease 的 `receive`/`close`、旧 leaseId 的 `next` 不影响 replacement，也不改变 generation。
4. 超时/关闭后迟到回执不复活、不二次结算。
5. **P1（wave-28 修正）**：同一 `command.id` 的第二次 `beforeNativeWrite` 必须拿到新的 `frame.id`；重放第一次已结算的 allowed frame 返回 `false`，只有针对新 correlation 的新决定才结算。
6. 超 `maxPendingBytes`/`maxPayloadBytes` → `capacity`，且不留下 pending。

## 4. 复现出问题时的定位

先判归属，再报 owner，不要通过放宽断言"修好"：

- **模块/adapter**（`apps/runner/src/attach-channel/`）：关联、timer、容量、fencing、fresh intent、错误码、结算次数、出站队列。
- **B 服务**：连接↔lease 路由、bind 的 CAS 来源、`close` 顺序、stdio/attach 双车道。
- **共享接口**：字段缺口交 main 最小 RFC；H/I 都不直接改 contracts。

报告附：exact 输入（producer/fact/请求顺序）、时钟推进值、`inspect()`、错误 `code/reason`、源码路径/行号、以及是否经过 B 的真实服务。

## 5. 边界

H 复现的是**通信模块**行为，不是产品/native/安装准入：不证明同 Runner 进程、coordinator SIGKILL 恢复、durable exactly-once 或物理 writer quiescence。H 当前若仍消费旧 stdio service blob，必须显式标注"非当前 I/B source"，并切换到本入口后再声称执行了同一实现。
