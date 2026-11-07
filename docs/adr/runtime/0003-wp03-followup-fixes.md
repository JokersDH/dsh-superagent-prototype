# WP-03 第三批（G1 补充验收修复）

- 分支：`codex/g1-runtime`（已同步 `origin/main` `d85531d`）
- 输入：`agent-tasks/g1-followup-review.md`、`reports/releases/g1-review-followup.json`（被审 `d213d94`）
- 前一轮修复状态：主 Agent 已在干净 checkout / Node 24.22.2 复验，**全部 7+1 项基线复现 PASS**
- 本批结论：**B 侧 4 条新复现全部 PASS**；A-ASYNC-AFTER-AWAIT 属 WP-02，未处理

---

## 1. 逐条修复

| 复现 | 原因 | 修复 |
| --- | --- | --- |
| **B-COMMAND-DELIMITER**<br>`answer(a:b, c)` 与 `answer(a, b:c)` 同 ID | 用未转义分隔符拼字符串 | 改为 **canonical JSON + SHA-256**：`canonicalCommandKey()` 按固定字段表逐项编码（缺失字段显式写 `<absent>`，均用 `JSON.stringify` 转义），再取 sha256 十六进制摘要；ID = 可读前缀 + 64 位十六进制摘要，总长 ≤128，字符集符合契约 `IdSchema` |
| **B-COMMAND-EXPECTED-TURN**<br>同 inputRef、不同 expectedTurnRef 同 ID | `expectedTurnRef` 未参与 ID | `CommandKey.deliver` 现包含 `expectedTurnRef`，且 `#command` **从同一 CommandKey 派生线上命令**，ID 与实际发送字节不可能不一致 |
| **B-ENDED-EPOCH-REUSE**<br>binding 已 ended 仍可复用同 attempt/epoch | 只检查 active binding | 新增两本历史账：`#epochs`（ticket 维度 epoch 高水位，**ended 后仍生效**）与 `#usedAttempts`（ticket 下已用过的 attemptId）。同 attemptId 复用 → `attempt_id_reused`；epoch 不高于高水位 → `stale_start` |
| **B-CANCEL-DURING-LAUNCH**<br>launch 未完成时 stop，之后仍发 begin | `start` 在 await 前保存 binding，await 后未复核 | 新增 `#launching` 令牌：stop 命中在途 launch 时置 `cancelled`。`start` 在 `await launch()` 之后**重新读取当前 binding**，若已取消或不再是自己 → 清理句柄（`attempt.stop()`）并抛 `start_cancelled`，**绝不发送 begin** |
| **停止轮询生命期**<br>顶层 `await stop()` 时 Node 提前退出（exit 13） | 轮询 timer 被 `unref()` | `sleep()` 改为**保持引用**的 timer：stop 的完成属于调用方 await 的工作，不得依赖恰好存在的其他句柄 |
| **`#liveMembers` 吞掉 ps 异常** | 所有异常都当空组 | 重构为 `#observeGroup()`，返回 `observed`（含存活成员列表，可为空）或 `unobservable`（工具缺失/权限/解析失败）。只有 `observed && live.length === 0` 才算静止；不可观察 → `indeterminate` 并记录 `group-unobservable:<why>` |

### 1.1 关于“生产接线”约束

`agent-tasks/g1-followup-review.md` 要求 Supervisor 本地预检**不能丢掉**旧绑定的物理观察与已持久化的重复回执。本批的处理：

- `fence()` 与 `record()` 的本地预检已在文档中明确为**纯诊断**，权威裁决属 `apps/coordinator/runtime-ingress.ts` 的 `createRuntimeIngress`（ADR 0004）；
- 本包**未**新建任何 binding/事实表，也未绕过 `RuntimeIngressStore`；
- 实际接线（消费可信 bound sink）留待组合根完成，本批不宣称已接入。

---

## 2. 验证

### 2.1 官方复现脚本

```sh
node tools/bootstrap/review-g1-followup.mjs --storage /tmp/g1-storage --runtime <this-checkout>
```

| case | 结果 | 观察 |
| --- | --- | --- |
| A-ASYNC-AFTER-AWAIT | **FAIL（属 Agent A）** | `rowsWrittenAfterRollback: 1`，未处理 |
| B-COMMAND-DELIMITER | **PASS** | 两个 ID 为不同 sha256 |
| B-COMMAND-EXPECTED-TURN | **PASS** | `turn-1` / `turn-2` 得不同 ID |
| B-ENDED-EPOCH-REUSE | **PASS** | `refusedSameAttemptEpochAfterEnd: true` |
| B-CANCEL-DURING-LAUNCH | **PASS** | `startRejected: true`、`beginSentAfterStop: false` |

脚本整体仍非零退出，因为 A 段一项失败；B 段全绿。

### 2.2 本地测试

```sh
cd packages/driver-kit && node --test test/*.test.ts   # 18 pass
cd packages/testing    && node --test test/*.test.ts   #  8 pass
cd packages/execution  && node --test test/*.test.ts   # 44 pass（新增 13 项跟进负例）
cd apps/runner         && node --test test/*.test.ts   # 28 pass
```

合计 **98 项**（上一轮 85 + 新增 13），原有测试全部保留通过。

新增覆盖：
- 分隔符碰撞、ID 字符集与长度上限、缺失字段的显式编码、同逻辑重试同 ID
- `expectedTurnRef` 变化必须换 ID
- ended 后同 attempt/epoch 拒绝、跨 epoch 复用 attemptId 拒绝、epoch 高水位跨 ended 生效
- launch 期间 stop → start 拒绝且不发 begin；无 launch 时 stop 行为不变
- 只 `await` stop 的子进程必须正常完成（防 exit 13 回归）
- `ps` 不可用 → `indeterminate` 且证据包含 `group-unobservable`

### 2.3 类型检查

`tsc`（TypeScript 6.0.3，strict + noUncheckedIndexedAccess + verbatimModuleSyntax）覆盖四包源码与测试：**exit 0**

---

## 3. 仍未完成（NOT_TESTED）

1. **A-ASYNC-AFTER-AWAIT** — WP-02 范围，未处理
2. Supervisor 与生产 `RuntimeIngressStore` 的实际接线（可信 bound sink、旧物理观察保留、重复回执复用）
3. durable ACK / 原子 fence / 崩溃恢复
4. 真实厂商 Driver、共享 service session（RT-09）
5. 拟锁 Node 24.22.2 复跑（本机 24.21.0；上两轮主 Agent 已在 24.22.2 复验 85/85）
6. Linux/Windows 的 `ps -g` 语义与 exit code 判定
