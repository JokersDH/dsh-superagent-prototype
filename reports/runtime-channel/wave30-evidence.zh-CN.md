# wave-30 / I 证据报告：真实采用的通信子系统与原恢复消费者支持

2026-11-15。基线 `861c03ed`；本轮 source 只落在 `apps/runner/src/attach-channel/`、`apps/runner/test/attach-channel/`、`docs/runtime-channel/`、`reports/runtime-channel/`。既有的 fresh nonce / kind namespace / prune 未重写。

## 1. 第一成果：实际采用与单 transport owner

观察源 B `fbc9331`（"one transport owner per callback" 已提交）：

| 核查 | 结果 |
| --- | --- |
| B 共享核心 blob | `coordinator-channel.ts d1ef81`、`attach.ts 321738`，与 I 一致 |
| B 是否用 adapter | 是；旧三张 waiter map 与 B 自建 `connections`+poll queue 均已删除 |
| sink native 许可 | 必须经 `beforeNativeWrite`；缺失/拒绝/抛错零效果；同命令两意图 → guard 两次 |
| remote 回调 | 只经该 lease 的 `next`/`receive`；`pump()` 仅服务 stdio/sink，remote 帧不再写 stdout |
| B direct strict | exit 0（`runner-service.ts` + `recovery-transport.ts`） |
| B focused 通道测试 | 8/8 |
| B 自有 owner 探针 | `b30-transport-owner.mjs`：remote 接管后 remote 服务回调、旧 stdio 0 帧 |

**历史纠正**：wave-29 status 里"B 仍有 stale `channel` 编译错误 / 未用 adapter"描述的是中间 working tree `1930278`；当前 source 已不成立，adoption 清单中已删除该结论，仅保留为历史时间范围记录。I 新增的 `sink-responder.ts`/`refusals.ts` 是可选项——B 用自身 void/throw guard adapter 已达到同等语义，不因未导入这些文件而否定其修复。

I 侧为单 owner 提供并验证的接口（`lane-ownership.test.ts`，5 例）：`next/receive` 按连接寻址；remote 接管后 stdio 车道 `next/receive` 被拒且零副作用；同一请求只暴露一次；跨车道不能双重结算；foreign producer 在每条车道被拒；符合连接 id 的泵不会把 remote 请求写到 stdout。

## 2. 第二成果：并发、容量与唯一 pending

`concurrency.test.ts`（5 例）：

- 并发 fact 独立结算；同一 id 的重复回执只结算一次；
- 同 raw id 跨 kind（fact `payload-1` 与 payload 请求 `payload-1`）互不串用；
- 同一业务命令的顺序 fresh 意图各得新 correlation；并发第二意图 `write_already_pending`；
- 三类 pending 各自饱和时在发送前拒绝（transport 帧数不变），结算/超时后容量恢复，新请求可推进；
- 多次重绑后 adapter 队列仍每 pending 一条，结算后 `outboundCount` 归零。

既有的 `service-consumer.test.ts`（5 例）继续覆盖 sink→attach CAS 接管、数据重排、写 `indeterminate` 与关闭结算。

## 3. 第三成果：handover / 崩溃对账的模块支持

`handover.test.ts`（6 例）：

- 协调器离开后，fact/payload 保持原 id/引用与**剩余窗口**，继任 CAS 绑定后重发同一原始输入并只由继任结算；
- 未决 native 意图在 handover 时 `indeterminate`，不被重排、旧 allowed 无效；
- 剩余窗口不刷新（600ms + 401ms 后 timeout）；
- `timeout` / `closed` / `stale_connection` / denial 四类语义分离，超时不被解释为"未发送"；
- 模块帧集合仅为 `fact`/`payload-read`/`native-write-intent`，从不产生 begin/answer/cancel；
- generation 只用于连接 CAS，不替代业务 `fenceEpoch`/principal（foreign producer 仍 `identity_mismatch`）。

**范围声明**：以上只证明通信语义。原 A 新进程、`question → native_applied → ACK unknown`、Completion/check/currentCandidate/manualaccept、slot 释放仍是 B/main 产品工作，`NOT_REACHED`；module 测试不构成原 Work 恢复证明。

## 4. 第四成果：稳定接口与交接

- 导出/语义未变（wave-29 的 optional responder/refusal 保持可选）；`README` 增补 §4.3 单 transport owner、§4.4 handover，并把测试数更新为 100。
- `reports/runtime-channel/wave30-adoption.json` 绑定 I/B 具体 blob 与 B 的实际行为证据，并列出 stale corrections。
- H 观察源 `f8cf5713`：已绑定当前 source，I 侧 12/12；B 侧 5/6 的唯一原因是 H 仍要求旧 sink-only bug 存在（当前 B 已正确拒绝）——H 须把该断言改为非回归，不是产品/I 缺陷。

## 5. 命令与结果

```bash
node_modules/.bin/tsc -p apps/runner/src/attach-channel/tsconfig.json                 # exit 0
cd apps/runner && node --test --test-timeout=8000 test/attach-channel/*.test.ts      # exit 0, 100/100
node --test packages/contracts/test/coordinator-channel.case.ts                      # exit 0, 5/5
# B 观察（只读）：
cd /Users/hh/Desktop/joker/superagent-agent-b
node --test apps/runner/test/attach-adapter.test.ts apps/runner/test/sink-write-admission.test.ts apps/runner/test/native-write-admission.test.ts   # 8/8
pnpm exec tsc --ignoreConfig --noEmit --strict --exactOptionalPropertyTypes ... apps/runner/src/runner-service.ts packages/execution/src/recovery-transport.ts  # exit 0
node tests/native-acceptance/b30-transport-owner.mjs                                  # 2 PASS / 0 FAIL / 1 NOT_TESTED
```

分层计数：three-callbacks 11、binding 6、rebind 7、faults 18、compatibility 4、independent-consumer 4、fresh-intent 5、b-route 10、guard-responder 8、refusals 6、service-consumer 5、lane-ownership 5、handover 6、concurrency 5 ＝ 100。

## 6. 边界与保留

- 真实 vendor/model/native 调用 **0**；无 server/DB/ledger/Driver/approval/执行生命周期新增；未 signal 或启动任何进程。
- 十二服务 5180/8796–5191/8807 与全部 data/profile/tar/ledger 未触碰；B 的 dirty（两份历史 report、`b16-real-begin.mjs`）只读保留。
- I 不接管 policy：native 许可由 main/Broker guard 决定，fact 落库不等于许可；`module.close` 不是物理 quiescence；`indeterminate` 不自动重发业务命令。
- 未测：真实 A 持久化 ingress、真实 Broker guard、native/installed 事实、同 Runner 双 client、SIGKILL 后原问答、recovered candidate/manualaccept、slot 释放。
