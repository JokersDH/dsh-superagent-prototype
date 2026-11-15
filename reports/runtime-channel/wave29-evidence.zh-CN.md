# wave-29 / I 证据报告：唯一通道采用、guard 分工与 typed 失败面

2026-11-15。基线 `4d85cc349fba81a3f3d0149f1803e77d4ea454b8`；本轮 source 只落在 `apps/runner/src/attach-channel/`、`apps/runner/test/attach-channel/`、`docs/runtime-channel/`、`reports/runtime-channel/`。

## 1. 第一成果：B 的实际采用（源级核对，不以 import 名称代替）

观察 B `1930278c`（`codex/g1-runtime`，含 merge `codex/g5-coordinator-channel` 到 `4d85cc3`）：

| 核查 | 结果 |
| --- | --- |
| import 与实例化 | `runner-service.ts:35` import `RunnerAttachChannel`，bootstrap 处 `new RunnerAttachChannel(...)` |
| 旧三张 waiter map | 0 处 |
| 自建 `connections`/`currentConnection`/per-lease queue | 已删除；`attach.next/receive/drop/close` 是唯一入口 |
| vendored 模块 blob | `coordinator-channel.ts d1ef81`、`errors.ts ec8ce90`、`attach.ts 321738`，与 I `4d85cc3` 完全一致 |
| poll 是否隐式 bind | 否：先 `attach.next`，只有 `refused==='stale_connection'` 时才用调用方 `expectedGeneration` 做显式 CAS |
| sink 车道 native 许可 | 已修：必须通过注入的 `options.beforeNativeWrite`；缺失/拒绝/抛错 → `allowed:false`（wave-29 审计的 guard0 默认放行在该源已关闭） |
| transport refusal 类型 | 已改为 base code + `serverError` 分离，wave-28 的 TS2345 不再复现 |

**当前 B 的唯一阻塞（B owner）**：直接 strict 编译失败：

```
runner-service.ts(283,10): error TS2304: Cannot find name 'channel'.
runner-service.ts(286,12): error TS2304: Cannot find name 'channel'.
```

`hooks.beforeNativeWrite` 里遗留的旧引用；drop-in 修法是 `attach!.hooks.beforeNativeWrite(command)`（见 `docs/runtime-channel/adoption-manifest.zh-CN.md` §2）。因此"B 已采用 latest source 且可编译运行"在本轮**不成立**，直到 B 自己修复；I 不越界改该文件。

## 2. 第二成果：唯一 pending 与 poll queue 所有者

- B 的 `dispatched` map 只记录"该连接已交付过哪个 head"（key 为 `kind:correlation`），reply/rebind 时删除；不是 pending、timer 或授权。
- I 的 adapter 继续是唯一 owner：`bind` 显式 CAS、`next` 只读且 head-stable、`receive` 按连接路由、settlement/timeout 立即剪枝、queue 按 `kind:correlation` 去重。
- 新增 `service-consumer.test.ts`（5 例）以服务形状验证：sink 车道三回调 → attach 客户端 CAS 接管 → 数据请求按原 id 重排、未决写变 `indeterminate`、旧 allowed 两条车道都无效 → 新意图重新经过 guard；关闭后 `inspect` 全零、无悬挂。

## 3. 第三成果：guard 分工与 typed 失败（新增 source）

### 3.1 `createCoordinatorSinkResponder`

- `guardNativeWrite` 在类型上必填，运行时缺失也 fail-closed：`allowed:false`；
- 每个意图恰好一次 guard 调用；deny / throw 都不得许可；
- 回复回显该意图自己的 `frame.id`；成功不缓存、不跨意图复用；
- fact 失败回答 `ack-failed`，payload 失败不回答（交给模块 deadline）。

`guard-responder.test.ts`（8 例）覆盖 allow/deny/throw/未注入、fact 失败、旧 allowed 重放，以及**显式复现 B 审计中的 `allowed:!businessClosed` hazard**作为标注负例——这是测试 double，不是生产路径，也不改变 B 的设计。

### 3.2 `toAttachFailure` / `AttachFailureCode`

统一失败面：`identity_mismatch | stale_connection | closed | timeout | capacity | protocol_error | indeterminate | native_write_denied`。消费者扩宽自己的 union 即可，无需 unchecked cast；未知错误固定 `protocol_error/unexpected_error`，不保留原始 message；自身错误消息截断到 200 字符。`refusals.test.ts`（6 例）覆盖映射、拒绝类、秘密不泄漏与 union 扩宽。

## 4. 第四/第五/第六成果

- 第四（I12/I16）：原 65 例回归 + 新增故障面全部通过；无 timer/pending 泄漏，close 不宣称 writer 静止。
- 第五（I20）：服务形状 consumer、独立 consumer、typed 失败面可直接复用；B 的采用与本包 source 的 blob/接线均可核对；H 仍 `NOT_REACHED_SOURCE_REFUSAL`（其默认可用化 pin 指向旧快照并因 source 检查在导入前拒绝——该拒绝本身是正确的）。
- 第六（I24）：adoption manifest、操作文档、B/H 交接、本报告与 `wave29-status.json`。

## 5. 命令与结果

```bash
node_modules/.bin/tsc -p apps/runner/src/attach-channel/tsconfig.json                 # exit 0
cd apps/runner && node --test --test-timeout=8000 test/attach-channel/*.test.ts      # exit 0, 84/84
node --test packages/contracts/test/coordinator-channel.case.ts                      # exit 0, 5/5
# B 观察（只读，不修改）：
cd /Users/hh/Desktop/joker/superagent-agent-b && pnpm exec tsc --ignoreConfig --noEmit --strict \
  --exactOptionalPropertyTypes --skipLibCheck --target ES2024 --module NodeNext --moduleResolution NodeNext \
  --allowImportingTsExtensions --types node apps/runner/src/runner-service.ts packages/execution/src/recovery-transport.ts
# exit != 0：仅两处 TS2304 `channel`（runner-service.ts:283/286），见上
```

分层计数：three-callbacks 11、binding 6、rebind 7、faults 18、compatibility 4、independent-consumer 4、fresh-intent 5、b-route 10、guard-responder 8、refusals 6、service-consumer 5 ＝ 84。

## 6. 边界与保留

- 真实 vendor/model/native 调用 **0**；无 server/DB/ledger/Driver/approval/执行生命周期新增；未 signal 或启动任何进程。
- 十二服务 5180/8796–5191/8807 与全部 data/profile/tar/ledger 未触碰；B 的 dirty/未跟踪材料只读核对。
- I 不接管 policy：native 许可由 main/Broker guard 决定，fact 落库不等于许可；`module.close` 不是物理 quiescence；`indeterminate` 不自动重发业务命令。
- 业务恢复（原 A 新进程、question/native_applied/ACK unknown、Completion/candidate/manualaccept/slot）仍由 B/main 负责，I 只提供通信语义。
