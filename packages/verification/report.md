# WP-04 报告：工作区、候选冻结与可信验证

- **分支**：`codex/g2-workspaces-verification`（本报告随本轮 commit 提交；commit 见 `git log -1`）
- **Base**：`db6ea7d`（`test(g1): record clean target recovery verification`，含最新 origin/main 集成）
- **拥有路径**：`packages/workspaces/`、`packages/verification/`、`docs/rfcs/WP-04/`
- **迁移**：在 storage 单一迁移入口追加 **v6 `completion-evidence`**；v1–v5 checksum 未改写
- **契约身份**：`@personal-agent/contracts` v1.0.0，apiMajor 1，schemaHash `74ffd32d…`（未改契约）

## 1. 第一批：工作区与有界检查

### packages/workspaces（`WorkspaceManager`）

| 接口 | 行为 |
| --- | --- |
| `reserve({ projectPath, assignment, baseCommit? })` | 从用户项目在 base commit 创建 **detached attempt worktree**；用只读 git 命令记录用户 dirty tracked diff（审计 patch 文件）与 untracked 列表；**绝不 reset/clean/stash/checkout 用户工作区** |
| `freeze({ attemptId })` | 生成内容寻址 manifest：每个文件/符号链接的 SHA-256、base/head commit、dirty 状态、环境（node/platform/arch）；返回 `artifactDigest` |
| `digest({ attemptId })` | 复算摘要，供验证前后核对冻结产物 |
| `release({ attemptId })` | 仅移除 attempt 自己的 worktree；manifest 保留审计；重复释放为 no-op |

文档明确：**git worktree 不是沙箱**（共享对象/refs/hooks/remotes），交付保持 patch/branch，不自动 merge/deploy。

### packages/verification（`CheckRegistry` + `VerificationRunner`）

- 注册的检查定义：`executable`/`argv`、workspace 内相对 `cwd`、环境变量白名单、`deadlineMs`（1s–10min）、`outputLimitBytes`（1B–1MB）、不可变 `revision`。同 `(id, revision)` 改正文 → `CheckConflict`；契约 criterion 的 `checkDefinitionRef` 只能解析到已注册检查（未注册 → 拒绝）。
- 执行：`spawnSync` + deadline + 输出预算 + 白名单环境；记录真实 exit/signal/duration/output digest 与有界摘要。
- 结果显式：`PASS`（exit 0）、`FAIL`（非零/信号/超时/输出超限）、`NOT_TESTED`（可执行缺失）、受信任的 `SKIPPED`/`NOT_APPLICABLE`（组合根给出的 exclusions，不来自 worker 文本）。
- 冻结产物在运行前后各核对一次（`verifyArtifact`），被改则 `VerificationUnavailable`，不产生 Verification。
- 产出 contracts `Verification`，绑定 CandidateRef、`artifactDigest` 与 core 的 `completionCriteriaDigest(criteria)`；**从不调用完成 gate，从不结束 Ticket**。

## 2. 第二批：可信完成证据接口

### 迁移 v6（storage 单一入口追加）

`completion_verifications`、`completion_quiescence`、`completion_acceptances` 三张不可变记录表（候选/产物/合同/世代绑定，含索引）。

### `CompletionEvidenceStore implements CompletionVerifier`

| 接口 | 行为 |
| --- | --- |
| `recordVerification(verification)` | 不可变写入；同 ID 同正文幂等，不同正文 `EvidenceConflict` |
| `recordQuiescence({ id, candidate, artifactDigest, attemptId, resourceRefs })` | **记录时重新从运行时观察核对**：attempt 必须属于候选 assignment，且每个 resource 在观察仓储中必须是显式 `observed_quiescent`（writer.observed quiescent）；exit / cancel ACK / 超时 / 缺 PID 都不能产生该记录；证据（观察 factId）随记录保存；否则 `QuiescenceUnavailable` |
| `recordAcceptance({ id, candidate, artifactDigest, criterionIds, actorRef })` | 人工接受是独立真实来源（含认证 actor）；不可变 |
| `resolve(proposal)` | **只读、同步、同连接**：Verification 与 quiescence 必须与候选（ticket/assignment/generation/contract）和 artifact 精确匹配；请求的 acceptance 也必须匹配；任一缺失/过期/不匹配 → `undefined`，由 core gate 拒绝，绝不合成成功 |

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

本轮结果：workspaces **4/4**、verification **14/14**（批 1 的 8 项保留）；storage **66/66**、effects **8/8**、ingress SQLite **7/7**、core-on-SQLite **178/178** 无回归。

## 4. 主 Agent 接线步骤

1. **工作区**：对每个写 attempt，`WorkspaceManager.reserve({ projectPath, assignment })`；候选 ready 后 `freeze()` 得 `artifactDigest`；验证时传入 `verifyArtifact: () => manager.digest(ref) === frozen.artifactDigest`；交付后 `release()`（只删 attempt worktree）。
2. **检查注册**：从受信任的配置加载 `CheckDefinition` 并注册；契约 criterion 的 `checkDefinitionRef` 必须对应已注册 ID。worker 文本、仓库文档都不注册检查。
3. **验证**：`VerificationRunner.run({ candidate, criteria, artifactDigest, workspacePath, environmentRef, exclusions?, verifyArtifact })` → `{ verification, evidence }`；持久化 `verification` 到 `CompletionEvidenceStore.recordVerification`；`evidence` 里的输出摘要/exit/duration 可作为报告证据。
4. **完成证据**：把 `CompletionEvidenceStore` 作为 `completionVerifier` 传给 `createPersonalEngine`。
   - 静止证据：只在运行时观察出现显式 `observed_quiescent` 后调用 `recordQuiescence({ id, candidate, artifactDigest, attemptId, resourceRefs })`；**不要**用 parent exit / cancel ACK / 超时推断。
   - 人工接受：用户真实接受后 `recordAcceptance({ id, candidate, artifactDigest, criterionIds, actorRef })`。
   - 组合 proposal：`{ ...candidate, verificationId, artifactDigest, humanAcceptanceRef }` → `engine.confirmCompletion(proposal)`；gate 复核后由 core 结束 Ticket。
5. **迁移**：v6 已追加在 storage 单一入口；v1–v5 checksum 不变，已有库打开时自动升级。

## 5. 限制与未决

- 未在用户生产仓执行任意命令、未自动 merge/deploy；所有测试使用临时 git/工作区与固定脚本。
- SKIPPED/NOT_APPLICABLE 是组合根的受信任判断（例如平台不适用）；worker 自述不能产生这些结果。
- 检查定义 revision 与契约 `checkDefinitionRef`（无 revision 字段）的语义见 `docs/rfcs/WP-04/0001-check-definition-revision.md`（不改冻结契约）。
- 页面呈现、真实 native 检查、跨平台矩阵属后续包。
