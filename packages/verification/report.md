# WP-04 报告：工作区、候选冻结与可信验证

- **分支**：`codex/g2-workspaces-verification`（本报告随本轮 commit 提交；commit 见 `git log -1`）
- **Base**：`aae704f`（最新 `origin/main`，经 merge commit `aa86e62` 集成）
- **拥有路径**：`packages/workspaces/`、`packages/verification/`、`docs/rfcs/WP-04/`（外加 storage 观察接口的最小扩展）
- **迁移**：在 storage 单一迁移入口追加 **v6 `completion-evidence`**；v1–v5 checksum 未改写
- **契约身份**：`@personal-agent/contracts` v1.0.0，apiMajor 1，schemaHash `74ffd32d…`（未改契约）

## 1. 第一批：工作区与有界检查

### packages/workspaces（`WorkspaceManager`）

| 接口 | 行为 |
| --- | --- |
| `reserve({ projectPath, assignment, baseCommit? })` | 从用户项目在 base commit 创建 **detached attempt worktree**；用只读 git 命令记录用户 dirty tracked diff（审计 patch 文件）与 untracked 列表；**绝不 reset/clean/stash/checkout 用户工作区** |
| `freeze({ attemptId })` | 生成**内容寻址、不可变** manifest：文件 SHA-256 + 可执行位、符号链接以链接文本（非目标内容）为身份、被删除的 tracked 文件记录为 `deleted`、其他类型记录为 `other`；连同 base/head commit、dirty 状态与环境；写入 `manifests/<digest>.json`/`.patch`，同摘要永不覆盖 |
| `digest({ attemptId })` | 按同一算法**只读复算**摘要（不写文件），供验证前后核对冻结产物 |
| `release({ attemptId })` | 仅移除 attempt 自己的 worktree；manifest 保留审计；重复释放为 no-op |

文档明确：**git worktree 不是沙箱**（共享对象/refs/hooks/remotes），交付保持 patch/branch，不自动 merge/deploy。

### packages/verification（`CheckRegistry` + `VerificationRunner`）

- 注册的检查定义：`executable`/`argv`、workspace 内相对 `cwd`、环境变量白名单、`deadlineMs`（1s–10min）、`outputLimitBytes`（1B–1MB）、不可变 `revision`。同 `(id, revision)` 改正文 → `CheckConflict`；契约 criterion 的 `checkDefinitionRef` 只能解析到已注册检查（未注册 → 拒绝）。
- 执行：`spawn(..., { detached: true })` 独立进程组、脱离事件循环；deadline 先对进程组 SIGTERM、短暂 grace 后 SIGKILL，硬清理上界内无法证明退出 → `NOT_TESTED`（`cleanupUnproven`）；leader 退出后清理残留、销毁管道；输出预算 + 白名单环境；记录真实 exit/signal/duration/output digest 与有界摘要。
- 结果显式：`PASS`（exit 0）、`FAIL`（非零/信号/超时/输出超限）、`NOT_TESTED`（可执行缺失或清理未证明）、受信任的 `SKIPPED`/`NOT_APPLICABLE`（组合根给出的 exclusions，不来自 worker 文本）。
- **强制、fail-closed 的冻结核对**：`verifyArtifact` 为必填，运行前后都必须**精确返回 `true`**；缺失、`false`/`undefined` 或抛错 → `VerificationUnavailable`（不存在默认通过）。
- 产出 contracts `Verification`，绑定 CandidateRef、`artifactDigest` 与 core 的 `completionCriteriaDigest(criteria)`；**从不调用完成 gate，从不结束 Ticket**。

## 2. 第二批：可信完成证据接口

### 迁移 v6（storage 单一入口追加）

`completion_verifications`、`completion_quiescence`、`completion_acceptances` 三张不可变记录表（候选/产物/合同/世代绑定，含索引）。

### `CompletionEvidenceStore implements CompletionVerifier`

| 接口 | 行为 |
| --- | --- |
| `recordVerification(verification)` | 严格 `VerificationSchema.parse` 后不可变写入；同 ID 同正文幂等，不同正文 `EvidenceConflict`；非法正文 `InvalidEvidence` |
| `recordQuiescence({ id, candidate, artifactDigest, attemptId, barrier })` | 只接受**受信任的宿主 barrier receipt**（`scope/attemptId/proofRef/resourceManifestDigest/confirmedEventSeq/writerFactId`）。记录时在同一连接上核对：binding 属于该候选且 `ended`；manifest 摘要等于**全部已注册资源**（子集或事后追加都拒绝）；事件是同一 attempt 的 `runtime.barrier.confirmed`；宿主 writer 事实的逐资源行覆盖每个 `(ref, ownership)` 且为 `quiescent`，保存证明用 `factId`。exit / cancel ACK / 超时 / 缺 PID 均不能产生记录；否则 `QuiescenceUnavailable` |
| `recordAcceptance({ id, candidate, artifactDigest, criterionIds, actorRef })` | 人工接受是独立真实来源（含认证 actor）；不可变，正文逐字段比较 |
| `resolve(proposal)` | **只读、同步、同连接**：Verification 与 quiescence 必须与候选（ticket/assignment/generation/contract）和 artifact 精确匹配；请求的 acceptance 也必须匹配；quiescence 在 resolve 时**重新核对** barrier（binding/manifest/事件/writer 事实），事后资源或 epoch 变化即失效 → `undefined`，由 core gate 拒绝，绝不合成成功 |

### core 完成门集成（真实 SQLite + `createPersonalEngine`）

用 `bindCoreRepositories(store)` 组装真实 personal Engine，`completionVerifier = CompletionEvidenceStore`，走完整链路：`reportAssignment(ready)` → candidate → 冻结工作区 → 跑注册检查 → 记录 evidence → `confirmCompletion(proposal)`。

## 3. 验收映射

| 项 | 结果 | 证据 |
| --- | --- | --- |
| REL-09 不 reset 用户内容；worktree 不宣称沙箱 | **PASS（fixture 级）** | `packages/workspaces/test/workspace.case.ts`：dirty tracked/untracked 内容与 status 在 reserve/freeze/release 前后完全一致；README 明确非沙箱 |
| REL-10 不以旧摘要完成；产物/criteria/environment digest 对齐 | **PASS** | `checks.case.ts`：冻结后修改 → 生成/验证 `VerificationUnavailable`；`evidence.case.ts`：换 artifact 的 proposal `resolve → undefined` 且 core 拒绝；Verification 绑定 core `completionCriteriaDigest` |
| CORE-04 无空集合成功；必需验证与人工接受有真实路径；只有可信当前候选可完成 | **PASS（本包范围）** | `evidence.case.ts`：PASS+接受 → 完成；FAIL+接受与 SKIPPED+接受 → `verificationFailed`（人工接受不能越过）；旧 generation → `staleCandidate` |
| CORE-02 / CORE-03（legacy 模式、同事务失效 generation、无额外 core Input） | 归 core/应用（main） | 本包不改 core；在真实 core 上验证了 gate 行为 |
| AC-UX-07 页面显示未通过/过期候选 | **NOT_TESTED** | UI 属后续包；本包只提供结果与拒绝语义 |
| 验证期间新增输入使旧候选失效 | **PASS** | `evidence.case.ts` 旧 generation 用例（invalidate → staleCandidate） |
| 输出/超时有界 | **PASS** | `checks.case.ts`：deadline 150ms 内 FAIL timedOut；超限输出 FAIL `output_limit`，摘要 ≤2000 字符 |
| 真实失败 / 缺依赖 / SKIPPED / NOT_APPLICABLE | **PASS** | `checks.case.ts`：exit 3 → FAIL；缺失可执行 → NOT_TESTED；显式 exclusions → SKIPPED/NOT_APPLICABLE |
| dirty 用户内容不被 reset | **PASS** | 同上 REL-09 用例 |

本轮结果：workspaces **8/8**、verification **19/19**；storage **66/66**、effects **8/8**、ingress deterministic **18/18**、ingress SQLite **7/7**、core-on-SQLite **178/178**、G1 followup **5/5** 无回归。官方准入 probe `PASS_WP04_ADMISSION`（6/6），原始输出见 `reports/wp04-admission-probe.json`；测试输出见 `packages/workspaces/reports/test-output.txt` 与 `packages/verification/reports/test-output.txt`。

## 3.5 准入修复（6 类）

| 问题类 | 修复 | 证据 |
| --- | --- | --- |
| 冻结遗漏被删除的 tracked 文件 | manifest 记录 `kind: 'deleted'`（按路径派生摘要），删除动作进入审计 patch；不再因 `lstat` 失败而中断 | `workspace.case.ts` "tracked deletion…"；probe `FREEZE-DELETED-TRACKED-FILE` |
| 符号链接/可执行位身份错误 | 符号链接按 `readlink` 文本计算摘要（悬空链接也可冻结），从不读取目标内容；文件记录可执行位；manifest 内容寻址（`<digest>.json`/`.patch`），`digest()` 只读复算不覆盖审计文件 | `workspace.case.ts` symlink/executable/digest 三例；probe `FREEZE-SYMLINK-TARGET` |
| 冻结门禁可被跳过或默认通过 | `verifyArtifact` 为必填；运行前后必须精确返回 `true`；缺失/false/undefined/抛错 → `VerificationUnavailable` | `checks.case.ts` 强制门禁用例；probe `VERIFY-FALSE-FROZEN-GUARD` |
| 检查可能卡死在协调进程里 | `spawn(detached)` 独立进程组、异步执行；deadline → 组 SIGTERM → grace → SIGKILL；硬清理上界内无法证明退出 → `NOT_TESTED`/`cleanupUnproven`；销毁管道、清理残留 | `checks.case.ts` "ignores SIGTERM…"；probe `CHECK-DEADLINE-IGNORING-SIGTERM`（watchdog 未被触发、probe 自行正常退出） |
| 静止证明可被普通观察冒充 | `recordQuiescence` 只接受宿主 barrier receipt，并要求 binding `ended`、manifest 覆盖**全部**注册资源、`runtime.barrier.confirmed` 事件、宿主 writer 事实逐资源 `quiescent`；保存证明 `factId`；resolve 时重核，晚到追加使证据失效 | `evidence.case.ts` 完整清单/子集/无 barrier/错 manifest/他 attempt/晚到追加用例；probe `QUIESCENCE-REQUIRES-ALL-REGISTERED-RESOURCES` |
| 记录正文不可变性与 Verification 入口校验不足 | acceptance/quiescence 正文全字段比较，任何字段变化 `EvidenceConflict`；Verification 先经严格 `VerificationSchema.parse`，非法正文 `InvalidEvidence` | `evidence.case.ts` immutability + strict intake；probe `ACCEPTANCE-ID-IMMUTABILITY` |


## 4. 主 Agent 接线步骤

1. **工作区**：对每个写 attempt，`WorkspaceManager.reserve({ projectPath, assignment })`；候选 ready 后 `freeze()` 得 `artifactDigest`；验证时传入 `verifyArtifact: () => manager.digest(ref) === frozen.artifactDigest`；交付后 `release()`（只删 attempt worktree）。
2. **检查注册**：从受信任的配置加载 `CheckDefinition` 并注册；契约 criterion 的 `checkDefinitionRef` 必须对应已注册 ID。worker 文本、仓库文档都不注册检查。
3. **验证**：`await VerificationRunner.run({ candidate, criteria, artifactDigest, workspacePath, environmentRef, verifyArtifact, exclusions?, environment? })` → `{ verification, evidence }`；`verifyArtifact` 必须提供且返回精确 `true`。持久化 `verification` 到 `CompletionEvidenceStore.recordVerification`；`evidence` 里的输出摘要/exit/duration/`cleanupUnproven` 可作为报告证据。
4. **完成证据**：把 `CompletionEvidenceStore` 作为 `completionVerifier` 传给 `createPersonalEngine`。
   - 静止证据：宿主 barrier（`confirmOwnedQuiescence`）返回 receipt 后，用 `recordQuiescence({ id, candidate, artifactDigest, attemptId, barrier })` 记录；**不要**用 parent exit / cancel ACK / 超时/普通观察推断。接口与缺口见 `docs/rfcs/WP-04/0002-host-barrier-receipt.md`。
   - 人工接受：用户真实接受后 `recordAcceptance({ id, candidate, artifactDigest, criterionIds, actorRef })`。
   - 组合 proposal：`{ ...candidate, verificationId, artifactDigest, humanAcceptanceRef }` → `engine.confirmCompletion(proposal)`；gate 复核后由 core 结束 Ticket。
5. **迁移**：v6 已追加在 storage 单一入口；v1–v5 checksum 不变，已有库打开时自动升级。

## 5. 限制与未决

- 未在用户生产仓执行任意命令、未自动 merge/deploy；所有测试使用临时 git/工作区与固定脚本。
- SKIPPED/NOT_APPLICABLE 是组合根的受信任判断（例如平台不适用）；worker 自述不能产生这些结果。
- 检查定义 revision 与契约 `checkDefinitionRef`（无 revision 字段）的语义见 `docs/rfcs/WP-04/0001-check-definition-revision.md`（不改冻结契约）。
- 宿主 barrier receipt 目前是结构化镜像（`BarrierReceipt`），避免把 coordinator 实现引入共享包；建议 main 把 receipt 与 manifest 摘要助手提升为共享接口，见 `docs/rfcs/WP-04/0002-host-barrier-receipt.md`。
- 进程组隔离不是沙箱；检查仍以当前用户权限运行。`cleanupUnproven` 只表证「无法证明已退出」，不证明资源已停止。
- 页面呈现、真实 native 检查、跨平台矩阵属后续包。
