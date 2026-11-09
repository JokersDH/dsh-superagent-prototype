# 可被主线直接消费的运行时交付（wave-02 第 3 轮）

- 分支：`codex/g1-runtime`（已合并 `origin/main` `d7f3401`）
- 依据：`agent-tasks/wave-02/agent-b.zh-CN.md`、`docs/rfcs/WP-16/0003`、`0004`

---

## 1. 稳定 RunnerHost / 启动与恢复接口

`apps/runner/src/index.ts` 现在是完整公共面：

```ts
ControlledRunnerHost · AttemptRunner · ProcessHost
AttemptArtifactManifest · serveRecoveryEndpoint · endpointDirectory
serveRunner · RunnerLink · FileCriticalJournal · replayJournal
RUNNER_BRIDGE_PROTOCOL · parseBridgeFrame
```

**接线示例**（可执行）：`apps/runner/scripts/wiring-example.ts`

```sh
node apps/runner/scripts/wiring-example.ts
# launch order: spec-resolved -> spawned -> ready -> resources-registered -> begun
# inspection: admission=open coverage=complete_owned_resources resources=1
# WIRING EXAMPLE DONE
```

### 资源登记顺序（契约）

| 步骤 | 说明 |
| --- | --- |
| 1 `spec-resolved` | 主 Agent 选定 profile/policy/lease |
| 2 `spawned` | 每 attempt 一个进程/端点/凭据 |
| 3 `ready` | Runner 已打开 journal 与 payload 区 |
| 4 `resources-registered` | 组合根登记 owned inventory |
| 5 `begun` | **此时才**发 `begin`，且仅一次 |

`begin` 永不早于 3/4：早于清单产生的事实无法归属到屏障已知的资源。

---

## 2. 恢复语义（已验证）

| 性质 | 验证 |
| --- | --- |
| 原始 payload/ref 恢复 | journal 存 fact+payload，重放保留原引用 |
| 跨 attempt 隔离 | 每 attempt 独立 runner/journal/host（`batch1-isolation`） |
| 持久 ACK | 只有 `persisted:true` 同 fact 回执才传播 |
| 认证重连 | recovery endpoint 需 bearer 凭据；错误凭据 401 |
| SIGKILL | coordinator 被杀后 Runner 与原生子进程存活、journal 保留、孤儿组可归属可杀 |
| 完整资源清单 | `coverage: complete_owned_resources` |
| 停止屏障 | 旧 writer 未证实静止时新 epoch 被阻止 |
| 恢复不重复 begin/deliver/answer | 重放只发送事实；端点无业务路由 |

---

## 3. Codex 协议跑在实际独立 Runner 上

新增 `packages/drivers/codex-native/src/fake-app-server.ts` 与入口场景：

- `codex-fake`：`initialize → thread/start → turn/start → item/* → turn/completed`
- `codex-fake-approval`：先发审批请求（顶层 `id`），回答由 Driver 以**响应帧**回复原 request id

7 项测试（`apps/runner/test/codex-runner.test.ts`）覆盖：turn 完成、审批→问题→回答、cancel 中断、拒绝事实无回执、无命令不自动回答、配置漂移 hold、旧连接回答拒绝。

---

## 4. 已安装 Codex 的只读探针（固定证据）

```sh
node packages/drivers/codex-native/scripts/probe-installed.mjs
```

结果（`packages/drivers/codex-native/fixtures/installed-codex-probe.json`）：

| 项 | 值 |
| --- | --- |
| 版本 | `codex-cli 0.164.0`（与我方 draft profile 的 `expectedVersion` 一致） |
| `RequestId` | `["string","integer"]` —— **证实无损 ID 设计** |
| 协议 schema | 37 个文件，1,933,218 字节，digest `ac2c4019…` |
| 方法数 | 191 |
| Driver 依赖方法 | `initialize`/`thread/start`/`turn/start`/`turn/steer`/`turn/interrupt`/`turn/completed` **全部存在** |
| 审批面 | `serverRequest/resolved` 存在；**无 `answer` 方法** |
| 模型调用 | **NOT_TESTED**（未登录、无 scratch/预算授权） |
| 凭据读取 / 原生 home 修改 | 均为 false |

### 由此修正的真实缺陷

原 Driver 用自造的 `answer` 方法回复。安装版协议**没有**该方法：审批回复是对服务器请求 id 的**响应帧**。
已改为 `connection.claimServerRequest()` + `replyToServerRequest()`：

- request id 无损保留（`42` 仍是整数，`"42"` 仍是字符串）；
- 只能在本连接回答；旧连接/未收到的 id → `stale_server_request`；
- 每个请求最多回答一次。

同时修正：`receive()` 曾把带 `id` 的**服务器请求**当作响应丢弃。

---

## 5. Catalog / 策略 gate 的安全投影

`packages/catalog/src/projection.ts` 输出主线的 `ExecutionProfileView`：

- **不输出** executable / argv / nativeConfigRef / permissionPolicyRevision / digest / evidence；
- readiness 状态严格区分，fixture 恒为 `fixture_ready` 且永不显示为已测厂商；
- 原生 dispatch 需要 `native_test_passed` **且**显式运行时准入；
- 阻止原因映射到冻结 `AppErrorCode`；重复 id 与超限显式丢弃并报告。

---

## 6. 验证汇总

```
driver-kit 18 · testing 8 · execution 44 · catalog 27
policy-preparation 9 · codex-native 18 · runner 117
合计 233 项全通过            tsc strict → exit 0
三探针 PASS · DEMO PASS 11/11 · WIRING EXAMPLE DONE
```

---

## 7. NOT_TESTED / 不声称

1. **真实模型调用与厂商兼容性**：未登录、未执行模型、未在真实 Codex 上跑协议流程。
2. 未在真实安装版 Codex 上验证 `initialize/thread/turn` 的实际行为；只验证了**schema 暴露的方法名**。
3. DSH / ZCode 协议未实现。
4. 生产 coordinator adapter（registry/reconcile/barrier/HTTP）由主 Agent 实现；本批只提供接口、顺序与示例。
5. 跨机器/断电持久性未验证。
6. `pnpm-lock.yaml` 差异未提交。
