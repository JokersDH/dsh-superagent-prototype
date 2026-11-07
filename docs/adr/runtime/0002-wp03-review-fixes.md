# WP-03 第二批（G1 验收反馈修复）

- 分支：`codex/g1-runtime`
- 输入 review：`agent-tasks/g1-agent-b-review.md`、`docs/adr/core/g1-rfc-resolutions.md`、`reports/releases/g1-review-repros.json`（被审提交 `b4111ed`）
- 交付：本批修复全部 5 条运行时不变量 + 进程组/身份两组物理停止负例
- 结论：**B-* 五项复现已全部 PASS**；A-*（WP-02）不属于本包范围

---

## 1. 逐条修复对照

| 审查项 | 修复前 | 修复后 | 证据 |
| --- | --- | --- | --- |
| **B-FROZEN-COMMAND** 命令强转、缺 contract、`begin.inputRef` 用 policySnapshotRef | 手写对象 `as RunnerCommand`；`hasContract: false`；`inputRef: policy-snapshot-1` | 用完整 `AttemptRef` 元组构造（含 `contract`），`RunnerCommandSchema.safeParse` 校验后返回解析结果，**无 cast**；`StartInput.initialInputRef` 必填且不得等于 policySnapshotRef；`StartInput` 外层元组必须与 `AttemptSpec` 完全一致 | `supervisor.ts#command`、`assertStartInput`；`supervisor-review.test.ts` 4 项 |
| **B-ASSIGNMENT-FENCE** 错误 assignmentId + 同 attempt/epoch 仍 accepted | 只比对 attempt/epoch | 完整比对 ticket/assignment/attempt/epoch/contract，分别返回 `assignment_mismatch` / `contract_mismatch` | 复现脚本现返回 `accepted: false` |
| **B-UNKNOWN-STOP** 缺句柄写 ended 返回 indeterminate，二次 stop 又 confirmed | `state: 'ended'` + 后续 `no-active-binding` → `confirmed` | 新增 `quiescence: 'unknown'` 第三态；缺句柄/缺 binding/runner 不确定一律 `stopping`，**重复调用保持 unknown/indeterminate**；下一 epoch 被 `previous_attempt_not_quiescent` 阻塞 | 复现脚本两次 `stopping` + `unknown` |
| **B-COMMAND-IDENTITY** `cmd-<attempt>-<kind>` 冲突 | 两次 deliver 同 ID | ID 绑定业务身份：`cmd-<attempt>-<epoch>-deliver:<inputRef>`、`answer:<nativeBindingRef>:<answerRef>`、`cancel:<reason>`；超长时 128 字符内加确定性哈希尾；同输入重试保持同 ID | 复现脚本两 ID 不同 |
| **B-PROCESS-GROUP** 父进程 exit 即视为 group 静止 | `handle.exited.done` → `confirmed` | 静止判定改为「leader 已退出 **且** `ps -g <pgid>` 无任何非僵尸成员」；SIGTERM 未达标则 SIGKILL 整组并重试；仍有存活成员则 `indeterminate` 并报告成员 pid/state | `process-group.test.ts` 5 项 |
| **B-START-MARKER** 缺 marker 仍会 kill | 只处理「两者都存在且不同」 | marker 缺失或漂移一律 **fail closed**：返回 `indeterminate`（`identity-unconfirmed:no-start-marker` / `identity-mismatch`）且不发信号 | `process-group.test.ts` 2 项 |

---

## 2. 关键实现说明

### 2.1 命令构造（禁用 cast）

```ts
const base = { id: commandId(binding, key), ticketId, assignmentId, attemptId,
               fenceEpoch, contract, kind }
const parsed = RunnerCommandSchema.safeParse(candidate)
if (!parsed.success) throw new DriverError('protocol_error', 'invalid_runner_command', …)
return parsed.data
```

`AttemptRef` 契约确实包含 `contract`（`packages/contracts/src/schemas.ts:42`），此前遗漏正是缺陷根源；fixture `makeCommand` 也同步补上，避免测试与契约漂移。

### 2.2 未知停止是不可判定的第三态

```ts
type Quiescence = 'confirmed' | 'indeterminate' | 'unknown'
```

- `unknown`：缺句柄、缺 binding —— 无法证明也无法否证物理 writer 存在；
- `indeterminate`：有句柄但静止未能证实（runner 报告或组内仍有存活成员）；
- 只有 `confirmed` 允许 binding 进入 `ended` 并放行新 epoch。

这直接落实 05 §2「文件锁超时不是 writer 已死的证明」与「core stopped ≠ physical writer stopped」。

### 2.3 进程组静止

```text
leader 退出 ──┬─> ps -g <pgid> 无存活成员 ──> confirmed
              └─> 仍有存活成员 ──> SIGKILL 整组 ──> 仍存活 ──> indeterminate
身份确认失败 ──> 不发信号 ──> indeterminate（fail closed）
```

僵尸进程（`Z`）不计为存活，避免把只是等待回收的进程误判成仍写入。

---

## 3. 测试与证据

```sh
cd packages/driver-kit && node --test test/*.test.ts   # 18 pass
cd packages/testing    && node --test test/*.test.ts   #  8 pass
cd packages/execution  && node --test test/*.test.ts   # 31 pass（含 17 项新增负例）
cd apps/runner         && node --test test/*.test.ts   # 28 pass（含 5 项新增组/身份负例）
node apps/runner/test/g1-review-repros.mjs             # status PASS，B-* 五项
```

- 总计 **85 项**（原 63 项全部保留 + 22 项新增）
- 复现脚本输出：`B-FROZEN-COMMAND / B-ASSIGNMENT-FENCE / B-COMMAND-IDENTITY / B-UNKNOWN-STOP / B-PROCESS-GROUP` 全部 `passesInvariant: true`
- 严格类型检查：`tsc`（TypeScript 6.0.3，strict + noUncheckedIndexedAccess + verbatimModuleSyntax）覆盖四个包源码与测试，**exit 0**

---

## 4. RFC 处置

- **RFC-0001（payload kind）**：接受主 Agent 结论，**不改冻结 ports**。authoritative ingress 用 `parseRuntimeFactPayload(fact, resolvedImmutablePayload)` 无条件校验；payload 引用不可变/内容寻址；同 factId 内容变化是冲突而非新代次。本包未实现该 ingress（属 core/storage bridge），记为 NOT_TESTED。
- **RFC-0002（原子 ingress）**：接受「单一事务 + bridge 裁决完整 binding/epoch/收据/core mutation」。Supervisor 本地 `fence()` 已降级为**纯诊断**，文档注明不覆盖权威裁决。

两份 RFC 标记为 **Accepted（按主 Agent 决议）**，实现接线仍待 WP-02 提供 binding/lease 表。

---

## 5. 仍为 NOT_TESTED

1. durable ACK / 原子 fence / 崩溃恢复（需 core/storage bridge）
2. 真实厂商 Driver 与原生进程
3. 共享服务 session 所有权（RT-09）
4. 未在拟锁 Node 24.22.2 上重跑（本机 24.21.0）
5. Linux/Windows 进程组语义（`ps -g` 参数差异）
