# WP-03 第一批（G1）：DriverKit、受控 Runner 与假 Agent 子进程

- 分支：`codex/g1-runtime`
- base：`700c0dd`（G0 集成基线；本轮开始时 `origin/main` 最新）
- 负责范围：`packages/driver-kit/`、`packages/testing/`、`packages/execution/`、`apps/runner/`、`docs/adr/runtime/`、`docs/rfcs/WP-03/`
- 未改动：`packages/contracts/`（只读消费）、根 `package.json`/`pnpm-lock.yaml`、`src/`、`product-spec/`、其他 Agent 路径
- 结论：**第一批范围 PASS；整体 WP-03 未完成**（durable ACK、原子 fence、恢复、真实 Driver 均 NOT_TESTED）

---

## 1. 本批交付了什么

| 包 | 内容 | 测试 |
| --- | --- | --- |
| `packages/driver-kit` | 有界 JSON-lines 分帧（UTF-8/CRLF/未知通知/大帧/EOF）；优先级命令队列（cancel > answer > begin/deliver）；progress 合并器；`AttemptIO` 构造与 fact 盖章辅助；稳定 Driver 错误 | 18 |
| `packages/testing` | 可编程假 Agent 子进程（10 个故障场景）+ 参考 `FakeDriver`（实现 `AgentDriverV1`）+ 内存假件（payload store、fact 账本、fake clock、runner host）+ 冻结形状 fixtures + 进程直连 harness | 8 |
| `packages/execution` | `AttemptSupervisor`：start/deliver/answer/stop、epoch fence、`reconcile_first` 分类；本地端口 `RunnerHost` / `FactSink` / `BindingStore` / `RunningAttempt` | 14 |
| `apps/runner` | `ProcessHost`（argv-only spawn、进程组、启动身份 marker、物理停止证据、stderr tee）；`BoundedJournal` + `StderrRing`；`AttemptRunner`；`ControlledRunnerHost` | 23 |

合计 **63 个 node:test 用例，全部通过**。全部使用 Node 内置测试运行器与类型擦除执行 `.ts`，没有引入新依赖，也没有新增 lockfile。

---

## 2. 对外接口（下游需要知道的形状）

### 2.1 DriverKit

```ts
// 分帧
new JsonLineDecoder({ maxFrameBytes, maxBufferedBytes })   // push(chunk) -> DecodedFrame[]
decodeJsonLines(asyncIterable<Uint8Array>)                 // 生成器；end() 校验尾部
encodeFrame(value, { maxFrameBytes })                      // 单帧编码，超限抛 frame_too_large

// 控制优先级
new CommandQueue({ maxPending })   // push(cmd) 按 kind 权重插队，同级 FIFO；AsyncIterable<RunnerCommand>
COMMAND_PRIORITY                   // cancel 0 / answer,pause 1 / begin,deliver 2

// 进度
new ProgressCoalescer({ publish, windowMs })  // 合并到窗口内最新一条；flush() 在 turn 边界调用

// AttemptIO
createAttemptIO(parts)        // 校验 commands/record/publishProgress/runtime/payloads 齐备
attemptIdentity(spec)         // 提取 ticket/assignment/attempt/epoch/contract
criticalFact(spec, input)     // 盖章，payloadRef 由调用方从 payloads.store 获得
factIdFor(attemptId, seq)     // fact-attempt-1-1
```

错误统一为 `DriverError`，`code` 取自冻结契约的 `DriverErrorCode`，另加稳定 `reason`（`invalid_utf8`、`invalid_json`、`frame_too_large`、`buffer_limit`、`trailing_partial_frame`、`relative_executable`、`stdin_closed`、`capacity_exhausted` 等）。测试与诊断只匹配 `reason`/`code`，不匹配文案。

### 2.2 execution（Supervisor 与其端口）

```ts
new AttemptSupervisor({ runner, bindings, sink, preparedPolicyRef, stopDeadlineMs })
  start(input)        // 新 epoch 必须先让旧 attempt 物理静止（REL-04）；然后 launch + begin
  deliver(ticketId, inputRef, expectedTurnRef?)
  answer(ticketId, nativeBindingRef, answerRef)
  stop(ticketId, reason)   // -> { state: 'ended' | 'stopping', quiescence, evidenceRefs }
  waitExit(ticketId)
  record(fact)        // 过 fence 才进 sink；不匹配返回 { refused: reason }
  fence(fact)         // 纯判定，无副作用
  reconcileUnknownSend(ref)  // 永远 recommend reconcile_first，绝不 same_key_safe
```

端口（本地 TS，非 wire）：`RunnerHost.launch`、`RunningAttempt.feed/waitExit/stop`、`FactSink.record`、`BindingStore.current/save`。

### 2.3 apps/runner

```ts
new ProcessHost({ stderrRing })       // 实现冻结的 OwnedProcessHost
  spawn(ProcessSpec) -> { resourceRef, identity, stdout, stderr, exited, write }
  stopOwned(ref, deadlineMs) -> { quiescence: 'confirmed'|'indeterminate', evidenceRefs }
  stopAll(deadlineMs)

new AttemptRunner({ payloads, factSink, processHost, journal, stderrRing })
  feed(command)   // 关键容量满时拒收 begin/deliver，仍接受 cancel/answer
  launch(spec, driver) -> { exit, journal, journalCoverage, stderr, capacityExhausted, progress }
  stopPhysical(deadlineMs)

new ControlledRunnerHost(runnerOptions, driverFactory)   // 实现 RunnerHost
```

### 2.4 假 Agent 协议（测试本地，非厂商协议）

stdin：`{type:'begin'|'deliver'|'answer'|'cancel'|'shutdown'}`；stdout：`ready|progress|question|answer_observed|cancel_observed|turn_ended|unknown_notification|fatal|exit`。每个被消费的帧同步追加到 `$FAKE_AGENT_RECEIPTS` 侧信道文件，作为**独立于 stdout 的请求计数与控制延迟见证**。

场景：`happy`、`waiting-user`、`burst`（400 progress + 64KB stderr）、`torture`（半帧/CRLF/未知通知）、`malformed-utf8`、`oversize`（2MiB 单帧）、`exit-after-begin`（exit 7）、`crash-after-begin`（SIGKILL）、`eof-after-begin`（关 stdout 但进程活着）、`ignore-cancel`、`explode`。

---

## 3. 用例 → 证据映射（本批实际执行）

| ID | 本批覆盖到的部分 | 结果 | 证据（测试） |
| --- | --- | --- | --- |
| RT-01 | 旧 epoch/旧 attempt 的 fact 被 fence 拒绝，不改变当前派工，仍可记诊断 | **PASS（进程内）** | `packages/execution/test/supervisor.test.ts`「a fact from a superseded epoch is refused and never applied」 |
| RT-02 | prepared policy ref 不匹配时 begin 不落到原生；cancel/诊断仍可用 | **PASS（假 Agent 计数）** | `supervisor.test.ts` begin 携带 ref；`attempt-runner.test.ts` 控制优先用例 |
| RT-03 | 等待用户时 cancel 在业务 Promise 未完成的情况下送达 | **PASS** | `apps/runner/test/attempt-runner.test.ts`「cancel reaches the native side while a question is pending」 |
| RT-04 | 未知发送一律 `reconcile_first`，无 `same_key_safe` | **PASS（分类层）** | `supervisor.test.ts`「an unknown send is reconciled first…」 |
| RT-06 | stop 只到 stopping，物理证据才到 ended；indeterminate 保持 stopping | **PASS（spawned_process）** | `supervisor.test.ts` ×2 + `apps/runner/test/supervisor-e2e.test.ts` |
| RT-07 | progress 合并、stderr 环形有界、critical 保留容量、控制不被淹没 | **PASS（单进程）** | `attempt-runner.test.ts`「burst…」、`process-host.test.ts` journal/ring |
| RT-08 | 配置/binary 指纹变化导致准备失效 | **NOT_TESTED** | 需要 profile 准备与指纹来源（WP-01/WP-02） |
| RT-09 | 共享 service 上只影响自己 session | **NOT_TESTED** | 只实现了 `spawned_process` |
| RT-10 | native end_turn 只产生事实/候选，不能完成 Ticket | **NOT_TESTED** | 需要 core completion gate |
| REL-04 | 新 epoch 前旧 attempt 必须静止，否则拒启；不重复 start | **PASS（进程内）** | `supervisor.test.ts`「a new epoch refuses to start…」 |
| REL-05 | journal gap 显式化；容量不足停止新受理 | **PASS（内存）** | `process-host.test.ts` journal、`attempt-runner.test.ts` REL-05 用例 |
| REL-06 | 禁止重复外部写，仅只读/patch-only 接续 | **NOT_TESTED** | 属资源屏障与外部写 gate，本批未接 |
| REL-07 | 拆帧/UTF-8/未知通知/大帧/EOF 有界解析，stderr 不作业务事实 | **PASS** | `framing.test.ts`（9）、`fake-agent.test.ts`、`attempt-runner.test.ts` |
| REL-08 | 固定硬件性能预算（p50/p95/内存） | **NOT_TESTED** | 未校准硬件/负载，不做预算声明 |

---

## 4. 明确 NOT_TESTED（不得被下批当作已完成）

1. **durable ACK**：`FactSink` 只有内存实现；`DurableReceipt.persisted` 目前由假件返回，**不构成持久化证明**（等待 RFC-0002 + WP-02 storage）。
2. **原子 fence**：fence 检查与写入不是同一事务（RFC-0002）。本批只证明了单进程顺序下的行为。
3. **崩溃恢复**：coordinator 崩溃后重连 Runner、重新核对绑定、避免重复 start —— 需要 Runner journal 落盘与恢复流程，本批未实现（REL-04 只测了进程内新 epoch）。
4. **真实 Driver / 真实原生进程**：`FakeDriver` 不是任何厂商协议，`FakeAgent` 不是 Codex/ACP/ZCode。**mock 通过不代表原生兼容**。
5. **共享服务 session**：只实现 `spawned_process` 所有权；`shared_service_session` 的控制隔离（RT-09）未做。
6. ~~类型检查~~ **已补做**：见 §7.1（在仓库外副本中用 TypeScript 6.0.3 + zod 4.4.3 完成严格模式类型检查，含测试文件，0 错误）。
7. **macOS 之外的平台**：`ProcessHost` 用 `ps -o lstart=` 做启动身份；Linux 需验证，Windows 完全未测。
8. **性能预算**（REL-08）：未测。

---

## 5. 关键设计决定

1. **控制通道与业务通道分离**：`AttemptIO.commands` 是独立 AsyncIterable，Driver 的控制循环从不 `await` 业务 Promise；`CommandQueue` 用权重插队而不是把 cancel 塞进同一条 FIFO。这直接支撑 RT-03。
2. **进程身份用“启动 marker + 进程组”**：仅 PID 不足以证明所有权（PID 可复用）。spawn 时记录 `ps -o lstart=`，stop 前比对；不一致就返回 `indeterminate`，绝不发信号。停止先 SIGTERM 整组、超时再 SIGKILL 整组，只有观察到 exit 才 `confirmed`。
3. **stderr 在 host 层 tee 到有界环**：Driver 仍然拿到 stderr（诊断需要），但容量由 Runner 控制，防止某个 Driver 无界读取把内存吃光（REL-07）。
4. **critical 与 diagnostic 分明**：critical 走 `record`（有 receipt、有保留容量、满了拒绝新业务）；diagnostic 走 `ProgressCoalescer` + journal ring（可丢、有 gap 计数）。**progress 永远不能挤掉关键事实**。
5. **一切不可判定都返回 indeterminate**：未知资源、身份不一致、停止超时、未知发送。没有“猜一个成功”的分支。
6. **不复制契约**：所有 wire 类型来自 `packages/contracts`；本包只定义本地端口。4 个 package.json 用 `workspace:*` 声明兄弟依赖，不改根 lock。

---

## 6. 未决 RFC

- **RFC-0001**：`AttemptIO.payloads.store` 缺 fact kind 与 generation，ingress 无法自证 payload 合法。
- **RFC-0002**：fenced ingress 需要 core/storage 提供单一事务入口，Supervisor 不应自己实现 fence 裁决。

两份都在 `docs/rfcs/WP-03/`，状态 Proposed，等待主 Agent 与 WP-01/WP-02 owner 答复。

---

## 7. 实际执行命令与结果

```sh
cd packages/driver-kit && node --test test/*.test.ts     # 18 pass / 0 fail
cd packages/testing    && node --test test/*.test.ts     #  8 pass / 0 fail
cd packages/execution  && node --test test/*.test.ts     # 14 pass / 0 fail
cd apps/runner         && node --test test/*.test.ts     # 23 pass / 0 fail
```

运行时：macOS 26.6 / arm64，Node v24.21.0（本机观察值；G0 的拟锁组合是 24.22.2，本批未用拟锁 Node 重跑，属于 NOT_TESTED 范围）。

### 7.1 严格类型检查（仓库外副本，不产生受版本管理的文件）

根 workspace 尚未激活，本分支不安装根依赖。为验证真实类型（而非仅类型擦除执行），把
`packages/contracts`、`packages/driver-kit`、`packages/execution`、`packages/testing`、`apps/runner`
复制到 `/tmp` 下的临时工作区，软链一份隔离的 `node_modules`（TypeScript 6.0.3、zod 4.4.3、@types/node 24.10.0），
用与 `packages/contracts/tsconfig.json` 一致的编译选项检查：

```sh
/tmp/g1-typecheck/node_modules/.bin/tsc -p /tmp/g1-check-work/tsconfig.check.json
# exit 0 — strict + noUncheckedIndexedAccess + verbatimModuleSyntax，源码与测试全覆盖
```

首轮发现 6 个真实类型错误（全部在本批新增代码内，已修复）：

| 位置 | 问题 |
| --- | --- |
| `packages/testing/src/fake-driver.ts` | `encodeFrame` 里 `id` 被展开覆盖（TS2783） |
| `packages/testing/src/fake-driver.ts` | 原生 request id 是 `unknown`，不能直接当 JSON（TS2345） |
| `packages/driver-kit/test/progress.test.ts` | `published` 隐式 `any[]`（TS7034/7005） |
| `packages/execution/test/supervisor.test.ts` | 条件类型写坏导致参数类型不可赋值（TS2344/2322） |

这属于本批自检发现并修复的真实缺陷，不是外部模块问题；`packages/contracts` 未作任何修改。

---

## 8. 下一批（同分支继续）的建议顺序

1. 等 RFC-0002 落地后接 `FencedIngress`，把 durable ACK / 原子 fence 变成真实验收（RT-01/05/06）。
2. Runner journal 落盘 + 启动恢复：REL-04 真实崩溃场景、REL-05 gap 声明。
3. `prepare-before-begin` 与 fingerprint 失效（RT-08），需要 WP-01/WP-02 的 profile 事实。
4. 共享服务 session 所有权（RT-09）与 `unknown send` 的真实 reconcile（RT-04 端到端）。
5. conformance runner CLI：把本批 63 个用例整理成任何 Driver 都能跑的 `driver-kit conform`。
