# B 接入交接：唯一通道、单 transport owner 与剩余 owner 工作

2026-11-15（wave-30 修订）。目标读者：B（`apps/runner` 中除 `src/attach-channel/`、`test/attach-channel/` 外的所有者）、main。I 不修改 `runner-service.ts`、`RunnerLinkClient`、routes/auth/dispatch/lifecycle。

## 0. 当前事实（观察源 B `fbc9331`，含 wave-30 单 owner 提交）

| 事实 | 状态 |
| --- | --- |
| import `RunnerAttachChannel` | 是，adapter 是唯一 pending/queue owner |
| 旧三张 waiter map / B 自建 `connections`+poll queue | 已删除 |
| vendored I 核心 blob | `coordinator-channel.ts d1ef81`、`attach.ts 321738`，与本分支一致 |
| sink 车道 native 许可 | 必须经过注入的 `beforeNativeWrite`；缺失/拒绝/抛错 → 零 native 效果；同命令两次意图 → guard 两次 |
| remote lease 回调 | 只经该 lease 自己的 `next`/`receive`；`pump()` 只服务 stdio/sink 两个 adapter 连接，不再写 stdout |
| direct strict 编译 | PASS（`runner-service.ts` + `recovery-transport.ts`，exit 0） |
| focused 通道测试 | 8/8（adapter/sink/native admission） |
| B 自己的 owner 探针 | `b30-transport-owner.mjs`：remote 接管后 remote 服务回调、旧 stdio 0 帧 |

wave-29 报告中"B 仍有 stale `channel` 编译错误 / 未用 adapter"的描述属于中间 working tree（`1930278`），当前 source 不再成立；本文件与 adoption 清单已删除该结论，只保留历史时间范围。

## 1. I 为单 owner 提供的接口契约（B 已按此实现）

`RunnerAttachChannel` 只按连接寻址，因此"一个 callback 一个 transport owner"是可直接表达的：

```ts
const page = attach.next(connectionId, producer)      // 只读；被替换连接 => refused
attach.receive(connectionId, frame, producer)         // 只结算该连接的 pending
attach.drop(connectionId, reason)                     // 该连接消失；未决写 indeterminate
```

- **remote**：请求只能由它自己的 `next` 返回、由它自己的 `receive` 结算；**不得**镜像到 stdout。
- **stdio**：只有 `stdio-<pid>` 连接可 `write(frame)`。
- **sink**：只交给 in-process responder。
- 请求"被读走"不是投递：`next` 幂等返回 head，结算后才出队；重复轮询不会造成重复写。
- 旧连接的回执被结构性拒绝（lease 身份），不需要业务侧再写第二套 fencing。

`apps/runner/test/attach-channel/lane-ownership.test.ts` 固定上述契约（5 例），可直接作为 B 的回归参照。

## 2. 三类回调的权威归属（不要合并）

| 回答 | 权威 | I 的职责 |
| --- | --- | --- |
| fact receipt / ack-failed | 原 A/public sink（幂等、冲突拒绝） | 原 factId/body 关联、deadline、重发 |
| payload value | 原 immutable Store/responder | 原 ref 关联、bytes 限额、重读 |
| write-admission | 当前 main/Broker fresh guard | 每意图 fresh `frame.id`、结算、不缓存 |

`sink-responder.ts`/`refusals.ts` 是可选示例：B 用自己的 void/throw guard adapter 已达到同等语义，**不要求**导入这两个文件；它们存在的意义是让"缺 guard 就不许写"和"有限 code union"在源码层面可复用。

## 3. handover / 崩溃对账：I 提供什么、不提供什么

提供（`handover.test.ts` 6 例）：

- 原协调器离开后，fact/payload 保持原 id/引用与**剩余窗口**，继任 CAS 绑定后重发同一原始输入；
- 未决 native 意图变 `indeterminate`，不迁移/不重放；旧连接回执被拒；
- `timeout` / `closed` / `stale_connection` / denial 语义分离；超时不是"未发送"；
- 模块从不产生 begin/answer/cancel 业务帧；generation 不是业务 epoch。

不提供（B/main 产品工作）：

- 原 A 新进程、`question → native_applied → ACK unknown` 的业务对账；
- 业务命令重新准入、Completion/check/currentCandidate/manualaccept、slot 释放；
- 物理资源身份、信号/出生证明、installed/native 事实。

## 4. 仍未达（I 侧如实记录）

- B/H 的 signal-guard 出生/full argv/资源计划与 H mutable-registry-origin 是 B/H 测试工具工作，不由 module 测试替代。
- 同 Runner 双 client、coordinator SIGKILL 后原问题→交付、recovered candidate/manualaccept、slot 释放：B/main。
- 真实 A 持久化 ingress / 真实 Broker guard / native/installed：module 测试中的 sink/payload/guard 是语义 double，不作业务证明。
- H 需把"旧 sink-only bug 必须存在"的期望改成非回归断言（H owner），否则其当前报告仍会 UNEXPECTED。
