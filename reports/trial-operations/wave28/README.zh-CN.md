# H wave-28：selected source 消费者、安全信号与原交付支持

2026-11-15，`codex/g4-trial-operations`，基线 `0651a50f`，合并 `origin/main ea82d8f`（H 当前 `089f401`）。本目录是 wave-28 原始材料；wave-25/26/27 的长/短 fixture、392/24 预期断流、旧 30/30 原样保留，不重跑 40 分钟。

H 不是 release/native 权威；E 独立 required，B/I 自己修实现。本轮**不再**把旧 runner-service blob `fbd433` 的 stdio 结果贴给新 B/I。

## 六个结果

| 结果 | 内容 | 位置 |
| --- | --- | --- |
| H4 | 唯一 selected source 绑定 + 实际 I/B 三回调消费者 | `tests/operational-soak/selected/`、`selected-input/` |
| H8 | 独立出生/每次 fresh signal/安全关闭工具 | `tests/operational-soak/procguard/`、`procguard/report.json` |
| H12 | I/B 各自 CAS/lease/detach 观察与诚实未达 | `selected-input/i.json`、`b.json` |
| H16 | 原 question/answer/ACK 支持与窗口 | `delivery/`、`selected-input/` |
| H20 | 原 candidate/accept/slot 与精确包输入 | `delivery/`、`package-1cd/` |
| H24 | 原始材料、诊断、指南与状态 | `../wave28-status.json`、`docs/internal-trial/` |

测试（本机实跑）：`tests/operational-soak/{*.case.mjs,recovery,channel,selected,procguard,delivery}` → **36/36**（preflight 9、machinecheck 5、soak 6、hardening 4、recovery 3、channel 3、selected 3、procguard 2、delivery 1）。

## H1–H4：selected source

| 角色 | 取其实际 source | 证据 |
| --- | --- | --- |
| I | admitted commit `d95df88…`（branch `codex/g5-coordinator-channel`，module blobs `bf5b25…`/`406b1c…`） | worktree 已前进/含未提交编辑，H 只从该 commit 物化到自有新根；物化字节 sha256 复验后才 import |
| B | admitted commit `cb4e975…`（branch `codex/g1-runtime`，runner-service blob `c2990056…`、business-channel blob `75809b…`） | 从 commit 物化 business-channel；runner-service 只作身份核对 |
| main | H 当前 `089f401` 的 `packages/contracts/src/coordinator-channel.ts` blob `cf451e…` | 共享 schema 绑定 |

错误 root（另一 owner 分支）、错 blob、commit 不可达均在 consumer 运行前 REFUSED；consumer 后再次核对 commit/blobs/物化字节，中途变化拒绝。I consumer 实测 10/10，B consumer 9/9。

**I 模块实际语义**：fact receipt/ack-failed、payload、write allow/deny、generation 0→1→2 CAS、旧 lease 回复拒绝/旧 close 不影响新 lease、timeout、capacity、module close 全部实际执行。**复现已知 I P1**：同一 command.id 的第二个 `beforeNativeWrite` 复用同一 correlation frame.id；重放第一个已 settled 的 allowed 回复会 resolve 第二个意图（`sameFrameId=true`、`replayAccepted=true`）。H 记录为 I 缺陷，不修改 I。

**B 实际模块语义**：bind 单调、stale reply 拒绝、detach 写 indeterminate/事实 channel_detached、request/reply 三回调实际执行。差异如实记录：`bind(leaseRef)` 无 expectedGeneration CAS、隐式 `lease(ref)` 可提升 generation、无 per-request timer/pending-byte 上限；B 模块消费不等于完整 runner-service route。

材料：`selected-input/report.json` sha256 `c08fe414…`；`source.json` `cc2c9888…`；`i.json` `594c8a45…`；`b.json` `3ab2f7db…`。

## H5–H8：自有进程出生与 fresh signal

`procguard/report.json`（sha256 `747eae6a…`）记录本次 probe 的 PID/PPID/UID/start/full argv/root/config/operation；8 个纯控制（foreign uid/ppid、recycled start、wrong argv、missing operation/pid、pre-record、sibling）全部拒绝且 **0 个外部信号**。实际只对本次 spawn 的 probe 发送 4 次自有信号：正常 TERM、忽略 TERM 的 probe 经 TERM 后 **fresh 再核** 才 KILL、sibling 自身 TERM。TERM 前 proof 不用于 KILL；unknown pid 拒绝并保留材料。未触碰产品/用户进程，无全局扫描。

## H9–H16：原数据与 ACK 窗口

原 controlled ProductRuntime/Broker/A Store/Verifier 路径实测：

- normal：Work contract → 原 question/answer `native_applied` → registered check → `currentCandidate`（generation 3）→ **manual accept_candidate** → `delivered`，4 个 artifact，`WorkView.work.id` 与 Work id 一致；
- 错误 candidate generation：`rejected`（`verification_failed`），不写 accepted；
- 同 commandId answer 重放返回同一 receipt（`answerReplayIdempotent=true`）；冲突 version 被拒（`question_expired`）；
- 同 commandId accept 重放返回同一 receipt（`duplicateAcceptIdempotent=true`）。

未合成跨 coordinator 恢复：真实 B/I 通道重绑后的原 Work 恢复、SIGKILL 原问答、recovery 后 candidate/accept **NOT_REACHED**；H 不写业务结果或第二 ledger。

## H17–H18：candidate/accept 与 slot

- 2 个和 4 个 controlled works 各自 delivered，`view.work.id` 全部匹配，begin 帧分别 2/4；queue 0、resource quiescent；
- 该 fixture 没有 slot-cap 配置，`uniqueAttempIds` 在 receipt 投影中不可得（保留 null/unknown）；**native 2/4 slot 资源集 NOT_REACHED**，不以五 Work 记录冒充五 attempt，也不清 marker/空集合释放。
- 材料：`delivery/report.json` `f05f1eb2…`、`delivery.json` `6b20078c…`。

## H19：精确包输入

1cd 包（含 main967 F identity，不含 main18f stats）：tar `dcfda014…`，6759 项（6738 regular + 21 links），closure `c964a5aa…`；build `ecffaa6d3f784426`，source `1cdab25a…`，schema 18。预检 32 PASS/1 UNKNOWN、0 FAIL；machinecheck 46 PASS/3 UNKNOWN/0 FAIL，包内 help/status/doctor 实际执行，新根无 state 写入。材料 `package-1cd/…`（preflight `54b44edb…`，machinecheck `8612aaf9…`）。这只是本机只读输入，不是 E installed/release 结论。

## H22：短时新风险

新增一个 20 秒 slow 场景（HTTP/SSE 慢响应）：实际 20.471 s，39 次 poll timeout、50 个 SSE 事件/3 连接、39 预期失败、socket/连接 0；`run-check` CONSISTENT。材料 `runs/…-20s-mixed-slow/run.json` `80b684a8…`，check `b8ed867a…`。**真实产品 readonly/SSE 目标仍 NOT_REACHED**，未读取用户服务或凭据。

## 明确未达

- B runner-service 实际导入/使用 I 唯一通道：**NOT_REACHED**（B 有自己的同职责 channel，未合一）；
- 同 Runner 双 client 经 B 实际 route、SIGKILL 后原 question/answer/target/attempt 恢复、原 Work 人工接受、native 2/4 slot：**NOT_REACHED**；
- I 的同 lease settled-allow 复用问题存在，需 I 以每次 fresh frame.id/guard 决策修复；H 未改 I；
- 真实产品 readonly/SSE、真实 vendor/native：未测。

## 给 I/B/main/F/G/E

- **I**：`selected-input/i.json` 是 actual module 10 项正反 + P1 复现；修复后可用同一 consumer 回归。
- **B**：`selected-input/b.json` 是 actual `createBusinessChannel` 9 项与差异（无 CAS/timer/bounds、隐式 lease）；B 的 runner-service blob `c299` 已核对但未作为本轮 consumer 入口。
- **main**：selected source 绑定、materialized bytes、错误 root/blob 拒绝可直接复用；WorkView 读取使用 `view.work.id`。
- **F**：用户错误仍是 `REFUSED <code>: <message>`；真实产品目标缺失时不要展示“已观察”。
- **G**：delivery/run 材料标注 fixture/controlled layer，不含产品指标。
- **E**：原始文件 sha256 可核；H 的 OK/计数不是 required/release。

## 限制

- 所有 consumer 为进程内/自有 fixture；无 daemon、无用户 state/credential/profile、无真实 CLI/model/native，无 SIGKILL 产品对象；
- selected source 物化是只读证据/导入，不是第二实现或第二 coordinator/ledger/gate；
- 旧 wave25/26/27 原始材料保留，不用旧样本冒充本轮 source/产品结论。
