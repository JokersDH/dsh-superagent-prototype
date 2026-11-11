# B5 控制/问题/恢复交接（wave-06）

日期：2026-11-11。branch `codex/g1-runtime`，base `82db295`，merge `543ccac`。**本文件不含任何模型调用**，`wave03-b-native` 保持 UNVERIFIED（见 §5），E 的 pilot grant 未被触碰。

严格区分证据层：**受控（controlled）** 与 **实际原生（actual native）** 在本文件中不混用。

## 1. 单一恢复实现（已核对）

恢复传输与证明只有一份实现：

- `packages/execution/src/recovery-transport.ts` 第 118 行 `const verified = new WeakMap<...>()`，全仓检索 `new WeakMap` 在产品源码中仅此一处。
- 未发现第二条 proof store（`proofStore` / `verificationProof` / `ProofRegistry` 检索为空）。
- protocol-v1 语义未改动。

这与 0023 §1「B旧recovery transport的窄例外仍保持一份实现/proof WeakMap及protocol-v1」一致。

## 2. 受控（controlled）窗口实测 —— 零模型

在 `82db295` 基线上重跑，全部通过生产 `ProcessHost` / 自管理实例：

| 用例集 | 结果 | 说明 |
| --- | --- | --- |
| B3 生产停止 | **6/6 PASS** | inventory/active/production-stop/escalation/unknown-owner/closed-admission；quiescence 由「writer 不再增长」确认，非仅"进程已退出" |
| B4 恢复窗口 | **3 PASS + 1 NOT_TESTED** | idle 重启不产生 begin；running 窗口 assignment 保留且无第二个 begin receipt；question 窗口**未出现**，如实 NOT_TESTED |
| B3 问答控制 | **5 PASS + 1 NOT_TESTED** | legal-answer / duplicate-replay(同 commandId 同 receipt 单次投递) / unknown-target(业务层 invalid_request) / stopped-work(stale_binding + 无额外投递 + quiescent)；stale-version 未推进到 v2，NOT_TESTED |

关键区分：`B3-PRODUCTION-STOP` 证明的是**受控进程**在真实 `ProcessHost` 下的停止与静默确认，**不是**真实 vendor Codex 的停止证明。

## 3. 实际原生（actual native）—— NOT_TESTED

以下需要真实模型 turn，本包未执行（grant UNVERIFIED，且 0023 禁止 B 代 E 消耗）：

- 真实 Codex 活跃 writer 上的停止
- 逐 target 的问题/审批投递
- epoch/attempt 漂移检测
- 未知发送在真实对话中的核对

没有出现目标窗口就记为 NOT_TESTED，不重跑碰运气。

## 4. 已交付的零模型新增能力（本包）

| 模块 | 作用 | 用例 |
| --- | --- | --- |
| `ledger-audit.mjs` | 把「无账本」与「没花钱」区分开；只允许 VERIFIED 且有余量时真实发送 | 10/10 |
| `pilot-runner.mjs` | E 可调用的 arm→session 计划；无 hook/无价格/hook 拒绝一律拒发；报告绑定 subjectDigest | 19/19 |
| `b3-sealed-copy.mjs` | 密封副本与宿主边界**分别**取证 | 8 PASS / 1 FAIL（见下） |
| `cost-preflight.mjs` | 逐计费分量的单 turn 上界预检 | 10/10 |

## 5. 预算账（核对结论）

| grant | limit | 账本 | 判定 | 可真实发送 |
| --- | --- | --- | --- | --- |
| `wave03-b-native` | 4 | `reports/model-budget.json` **不存在** | **UNVERIFIED** | **否** |
| `wave05-independent-review-pilot-01` | 24 turn / 200k tok / USD5 | E 所有 | 未触碰 | 仅 E |

`wave03-status.json` 声明 `used: 0` 却指向一个在本分支历史中从未存在的文件（`git log --all` 该路径为空）。这正是 packet 禁止的「从旧摘要推定余额」，故按 UNVERIFIED 处理，fail-closed 阻断真实发送。历史轮次 3 次单独记账，未合并、未用于补足。

## 6. 已知 FAIL / 局限（不掩盖）

- **B3-HARDLINK-ESCAPE (FAIL)**：本机文件系统允许 `linkSync` 建立硬链接。实测创建一个指向作者文件的硬链接后写入，会改动冻结源。结论：**只有"复制字节"能保护源，OS 本身不禁止硬链接**。胶囊构造器通过 `cpSync` + inode 实测（B3-NO-SHARED-INODE PASS）保证不共享 inode，但若调用方改用硬链接，边界不成立。这是需要 main/E 知晓的实际宿主限制。
- **宿主边界**：实测 `cwd=capsule` 仍可按绝对路径读取作者 home 的凭据文件（`B3-HOST-BOUNDARY` PASS 记录的是"确认副本不是沙箱"这一**诚实结果**，不是隔离通过）。文件/工具/网络/凭据范围仍需单独强制，本包未实现沙箱。
- **pricing_unavailable**：`codex app-server generate-ts` 751 个绑定中检索 `price`/`Price` **无任何结果**，协议无价格面。usage 有细粒度字段但在 turn 结束后才到达。故 B4 对当前运行时判 **BLOCKED**。

## 7. 下一步消费者

- **main**：可用 `pilot-runner.mjs` 的 `planRun` 做试点准入前置校验；`maySendReal` 作为真实发送的闸门。不要用 `wave03-status.json` 当余额依据。
- **E**：`planRun` 已实现 arm→session 强制映射（fresh 必须 ephemeral 且不继承作者 thread；continue 必须给真实 authorThreadId）。E 只需实现自己的 `budgetHook.reserve` 并传入 `bound.basis.priceSource`。价格未定前，billable run 会被 `budget_refused` 拒绝——这是预期行为，不是 bug。
- **D**：诊断消费例见 §5/§6，可读且不含秘密。
