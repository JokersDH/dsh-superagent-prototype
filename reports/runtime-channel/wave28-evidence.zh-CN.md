# wave-28 / I 证据报告：fresh intent、唯一 module 与真实 B 接入事实

2026-11-15。基线 `d95df88b`；本轮 source 在 `apps/runner/src/attach-channel/`、`apps/runner/test/attach-channel/`、`docs/runtime-channel/`、`reports/runtime-channel/`。所有权之外的 contracts/root/runner-service/RunnerLinkClient/B 生命周期**零修改**。

## 1. 第一成果：P1 fresh intent（红→绿）

独立审计 `reports/releases/wave28-admission/runtime-channel.json` 的 `I28-SETTLED-ALLOW-REPLAY-IN-SAME-LEASE` 被本地独立复现：

- 修复前：同一 lease 上对同一 `command.id` 连续两次 `beforeNativeWrite`，两次意图共用 `frame.id = command.id`；重放第一次已结算的 `write-admission{allowed:true}` 返回 `true` 并结算第二次意图。
- 复现用例（修复前 3 个失败）：`apps/runner/test/attach-channel/fresh-intent.test.ts`。
- 修复：
  - 每个意图分配 fresh correlation `intent-<module salt>-<n>`（salt 每模块 8 hex，序号单调、不复用、安全整数上界后 `capacity/intent_correlation_exhausted`）；
  - 待结算写以该 correlation 为 key（不再用 `command.id`）；
  - `frame.id` 与 `command.id` 独立本来就由共享 v1 本地 schema 允许：**无新 wire 版本、无 contracts 改动、无新账本**；
  - 同一 `command.id` 的并发第二意图拒绝（`write_already_pending`），顺序新意图必须重新经过当前 guard；
  - 拒绝错误 `NativeWriteDenied` 仍携带原业务 `command.id`；
  - 断开/重绑未决写仍为 `indeterminate`，旧 allowed 不迁移、不缓存、重放返回 `false`。
- 修复后：5/5 通过，含 allow 重放、deny 重放、连续三次 fresh、fact/payload 原 id 稳定、并发拒绝。

## 2. 第二成果：同 controller 真三回调重绑（生产 adapter）

`apps/runner/test/attach-channel/rebind.test.ts`（7 例）改为驱动生产 pull adapter（`src/attach-channel/attach.ts`）：路由 `next` 取请求、coordinator 答复、`receive` 回同一连接。覆盖：

- 原 factId/body 跨 A→B 重发、A 幂等回执、冲突 body 拒绝；
- payload 原 immutable 引用重读、same requestId；
- 未决写 `indeterminate`、旧 allowed 在两个连接上都无效、新意图 guard 计数 1 次；
- deadline 不刷新；结算后出站队列清空（无第二 pending owner）；
- 三回调合一场景：3 pending / 3 queued → 重绑后写结算、2 条数据请求重排入队、全部结算后 `outboundCount = 0`。

## 3. 第三成果：B 唯一实现接入的事实核查

对 B 实际 tree（owner：`/Users/hh/Desktop/joker/superagent-agent-b`，branch `codex/g1-runtime`）做只读核对：

| 核查 | 结果 |
| --- | --- |
| 旧 `factWaiters/payloadWaiters/writeWaiters` | 0 处引用（B 已删除） |
| 自建平行 `business-channel.ts`/`business-dispatch.ts` | 已从 tracked 文件删除；仅剩不同职责的 `business-attach.ts`/`business-reconnect.ts` |
| B 是否 import 本模块 | 是：`runner-service.ts` 从 `./attach-channel/index.ts` 引入 `CoordinatorChannelModule/DEFAULT_LIMITS/sameCoordinatorChannelProducer`，`attach-channel/coordinator-channel.ts` 的 blob 与 I `ae93f34` 完全一致（`bf5b25a6…`） |
| B 是否已含 wave-28 fresh-intent 修正 | 否；B 当前 vendored 的是 wave-27 版本，仍带 P1，合并本分支后消除 |
| B 是否仍保留手写连接层 | 是：`connections` map / 每连接 queue / `currentConnection` / `channelState/channelNext/channelReply`；本包 `RunnerAttachChannel` 是等价且更完整的替换（结算出队、correlation 去重、stale/foreign 零副作用、remaining deadline） |

因此本轮**不再重复"B 仍有旧 maps"的过时结论**（那只适用于 I 分支的旧 main baseline `d95df88`）。第三成果的准确表述是：B 已在 module 层完成唯一实现切换；wave-28 的 P1 修正与 adapter 合并仍待 B 执行（其 owner 范围），交接点见 `docs/runtime-channel/b-adapter-handoff.zh-CN.md`。

## 4. 第四成果：故障/容量/late/close 矩阵（64 例）

- `faults.test.ts` 18 例：timeout/reply、close/reply、同步 send/reply、异步 send 拒绝（数据 `stale_connection`、native `indeterminate`）、容量饱和与回收、per-kind/总 bytes、重复 correlation、非法 limits、错误不含秘密、timed-out intent 重放、close 后重放、write 容量恢复、payload 边界正负。
- `b-route.test.ts` 8 例：未 bind 的 poll 被拒、poll 不 rebind、foreign producer 不读/不答、被替换客户端不能 reclaim、显式 CAS 拒绝 stale/future、跨多次 rebind 队列不累积、native 意图经路由保持业务 id、结算清空队列、remaining deadline 绝对不刷新。
- `compatibility.test.ts` 4 例 + `packages/contracts/test/coordinator-channel.case.ts` 5 例：共享 schema/冻结 hash/v1 协议不变。

## 5. 第五成果：独立 consumer 与真实消费者兼容

- `independent-consumer.test.ts` 4 例：自包含 producer/时钟/对端，执行同一实现，含旧 allowed 重放负例与跨实例 correlation 不重复。
- 生产 adapter 与 B 路由形状的契约由 `b-route.test.ts` 执行；H 指南更新为"复制自包含 consumer、切换当前 source"。
- 未达：H 在其自身目录执行当前 source（H 现在消费的是旧 stdio service blob）；B 尚未合并 wave-28 修正或用 adapter 取代手写连接层。

## 6. 第六成果：接口、文档与交接

- 共享小接口未改；`frame.id`（correlation）与 `command.id`（业务身份）的区别、错误码、close 顺序、remaining deadline 写入 `docs/runtime-channel/README.zh-CN.md`。
- B 迁移清单（含当前 B 的精确替换点与差异）写入 `b-adapter-handoff.zh-CN.md`；H 指南更新为 `h-independent-consumer.zh-CN.md`。
- 状态文件：`reports/runtime-channel/wave28-status.json`。

## 7. 命令与结果

```bash
node_modules/.bin/tsc -p apps/runner/src/attach-channel/tsconfig.json                 # exit 0
cd apps/runner && node --test --test-timeout=8000 test/attach-channel/*.test.ts      # exit 0, 64/64
node --test packages/contracts/test/coordinator-channel.case.ts                      # exit 0, 5/5
```

分层计数：three-callbacks 11、binding 6、rebind 7、faults 18、compatibility 4、independent-consumer 4、fresh-intent 5、b-route 9（含 remaining deadline）＝ 64（wave-27 历史 44 例全部保留在原 scope 内，仅按 fresh correlation 更新断言）。

## 8. 边界与保留资源

- 真实 vendor/model/native 调用 **0**；无新 Driver/CAC/桌面/autoaccept/第二生命周期/DB/账本/server。
- 未启动、未 signal、未停止任何进程；十二服务 5180/8796–5191/8807 与全部 data/profile/tar/ledger 未触碰。
- B 的 dirty/未跟踪材料（`recovery-transport.ts` 修改、两份 report、`b16-real-begin.mjs`、`b28-budget.mjs`）保持原样，I 只读核对。
- 不作 quiescence/native/产品/release 准入声明；`close()` 不停止物理 writer。
