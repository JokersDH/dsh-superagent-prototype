# WP-03 第四批（G1）：严格载荷与每 Attempt 隔离

- 分支：`codex/g1-runtime`（已合并 `origin/main` `5281e84`）
- 任务：`agent-tasks/g1-agent-b-durable-runner.md` 第一批
- 结论：第一批完成，第二批（持久 Journal 与重放）尚未开始

---

## 1. 严格 FakeDriver 载荷

| 项 | 修改前 | 修改后 |
| --- | --- | --- |
| question | 简化对象 `{questionId, nativeRequestId, attemptId}`，**无法通过** `parseRuntimeFactPayload` | `fakeQuestion()` 生成完整 `UserQuestion`：contract/scope/presentation/targets，target 带 `NativeQuestionBinding`（含无损 `WireRequestId`、`connectionEpoch`、`nativeMethod`） |
| answer | `{answerRef, evidenceRefs}` | `fakeAnswerDelivery()` 生成完整 `AnswerDelivery`：`answerId/targetBindingId/status/evidenceRefs` |
| 校验时机 | 无 | `recordFact()` 在 `payloads.store` **之前**调用 `parseRuntimeFactPayload(fact, {kind, value})`；失败抛 `invalid_fact_payload`，不写 sink |

**没有在 ingress 增加任何宽松旁路**：主 Agent 的 `createRuntimeIngress` 仍会再次无条件严格校验。

---

## 2. 每 Attempt 隔离

`ControlledRunnerHost` 改为 **factory** 形态：

```ts
new ControlledRunnerHost(
  spec => ({ spec, options: { payloads, factSink, processHost, journal, stderrRing, progressIntervalMs } }),
  driverFactory,
)
```

- 每个 attempt 得到独立 `RunnerOptions`（自己的 ProcessHost、命令队列、journal、stderr ring、payload store、fact sink），**不共享 ACK 上下文或资源注册表**；
- factory 返回的 `context.spec` 必须与请求的 `AttemptSpec` 完全一致（ticket/assignment/attempt/epoch/contract），否则拒绝；
- 同一 `attemptId` 不能 launch 两次（`single-use`）；
- `ControlledRunnerHost.fromOptions(options, factory)` 保留为单 attempt 兼容 fixture，注释明确不可用于并发 attempt。

---

## 3. feed/record 边界校验

- `AttemptRunner.feed()` 先用冻结 `RunnerCommandSchema` 校验，再（attempt 已 launch 时）比对完整 tuple；
- ticket/assignment/attempt/epoch/contract 任一不符 → `command_identity_mismatch`，**在触达原生进程前**拒绝；
- 跨 contract 命令同样被拒；
- launch 前允许排队（Supervisor 就是先 feed 再 launch）；
- Supervisor 的本地 `fence()` 仍只是诊断，不阻断权威入口对已知重复回执/旧物理观察的处理。

---

## 4. 验证

```sh
cd packages/driver-kit && node --test test/*.test.ts   # 18 pass
cd packages/testing    && node --test test/*.test.ts   #  8 pass
cd packages/execution  && node --test test/*.test.ts   # 44 pass
cd apps/runner         && node --test test/*.test.ts   # 41 pass（+13 第一批）
```

合计 **111 项**，原 98 项全部保留。

类型检查：`tsc` 6.0.3 strict（含测试）→ exit 0。

### 过程中修复的两个真实缺陷

1. **`ProcessHost` 的清理监听累积**：此前每个 host 实例注册一个 `process.once('exit')`，测试里大量创建 host 会累积监听并阻止进程退出。改为进程级单例注册表。
2. **FakeDriver 的 stderr drain 无界**：被 kill 的子进程可能不关闭 stderr，导致 `serve()` 永不返回。改为与 outcome 竞速并限时 250ms（定时器 unref）。

另外把 `ControlledRunnerHost` 的测试改为 **不残留 owned 进程**：书签类断言用不 spawn 的 double，涉及真实进程的用例都显式 stop 并断言 `confirmed`。

---

## 5. 未完成

第二批（持久 `FileCriticalJournal`、payload 持久化、ACK 与 spool 分离、崩溃重放、截断/容量/旧 epoch 规则、restart 不重复 begin）尚未开始。
