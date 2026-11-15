# 第三十轮 Agent C：正式历史消费者、两项目普通流、J 包双恢复与支持系统

2026-11-15，基线合并 `8a00a7bc`（`origin/main` `6f385a54`；RFC 0077/0078/0079）。
C 仅改 context/proposals/knowledge/routing；真实 vendor model/native 0；未改 UI/HTTP/SQL/root lock/E 断言。
`e1a486ec` 的原 ProductCompletion/严格 facts/J 普通流结果保留，旧 proof 三反例与同次 manifest 双格式未重派。

## C1 正式历史/当前完成消费者

新工具 `packages/context/tools/wave30-completion-history.mjs` 消费 A 修复后的
`WorkflowIndex.work(...).completion`（A head `40626989`，dirty `workflows.ts` SHA `7199eed0…`）：

- review 的 binding 由 `runtime_bindings WHERE attempt_id` 解析，A 输出 `bindingState` 与
  `currentLink: current_attempt|historical_attempt`；C 只透传，不复制 SQL/分类算法。
- C 输出 `canonical`、`historical:true`、`currentEligibility`（仅 data link）与
  `authorization:none`；当前资格仍由 `ProductCompletion.metadata/current/preflight/accept` 决定。
- `coverage` 明确 `complete|bounded`、`returned/available/limit/truncated`；`--limit 0` 不得冒充完整。
- 未知 Work → `status:'missing'` exit 1；raw receipt 不是 review；接受/验证计数不因读取变化。

实测（`main-personal-completion-history.case.ts`）：源库与 A restore 目标 facts 一致；
同 ticket 新 epoch binding + `setCurrent` + `end(old)` 后旧 review 仍 canonical 但
`currentLink:historical_attempt`、`currentEligibility:historical_only`；A 拒绝篡改 attempt 的
assignment（`BindingConflict`）与让 ended attempt 变 current；读取不新增 model/验证/接受。

## C2 两项目真实普通流

`main-personal-two-project-flow.case.ts`：两个受登记项目在同一当前 runtime 内完成
普通讨论 → 候选 prepare/confirm → 选中上下文 send/frozen（各自 project scope）→
J preview `draft`（`authorization:none`，无 token，无 root）→ 原 `create_work` → 人工
`accept_candidate` delivered → `/v1/works/:id/evidence(/history)`；7/30 天 `/v1/insights`
仅按项目/窗口/层显示。

负例：path/body 项目不一致 400；未登记项目 403；preview 读取不新增 Work；cancel 只读；
同 commandId+body 重试返回同一 workId，改 body 冲突；package.json facts 变化使 factsDigest
失效（旧 digest 不是授权）；insights 窗口 90 400；读证据/观察/预览不增 Work 与模型调用。

## C3 当前 J 包双格式恢复

精确 `1fbaf94` 包（tar SHA `daee1a94…`、build `2d94a7c31ef97b57`、schema18/Node24.21/ABI137）
包含 `packages/project-recipes` 与 `usage-observation`。同一 Store 数据用 A 正式路径分别
restore v1/v2 到两个新根，单 driver 消费原 expectation/manifest/target proof 后，
包内 prepare/start/readiness/HTTP/STOPPED；两格式 facts 的 canonical review、
verificationId、acceptance 与源库一致；readiness `authorization:none`/`recovery_readonly`/
`readonly`/dispatchable 0。console 只有“观察窗口”缺失校验文案，无 30 天 selector 控件
（window selector UI 仍 main/F）；D 后续新 freeze 未到，故旧 1ba/1cd/ce64 结果不贴此包。
E 独立 verdict 仍 ce64，C 工具 verified 不升级为 release。

## C4 accepted/unknown、撤销替代与支持

`main-personal-decision-support-flow.case.ts`：原人工接受是唯一 accepted（actorRef 为原
acceptance 记录）；`w24-unknown` dispatch 保持 `indeterminate` 且 `beginSend` 拒绝重发，
written 保持 `written`。真实决定 HTTP：record A → supersede 为 B（A 变 `superseded`）→
revoke B（version 2，`revoked`）；被替代/撤销后不能再作 predecessor（409/422）；
旧 token 重放返回原 receipt 但状态仍是 `superseded`，不复活、不进入当前上下文；
撤销后 decisions group 不再包含本轮决定。整个过程不增 acceptance/verification/model。

## 未达与分层

- A 严格 history 分类仍在 dirty worktree；打包 A 集成 NOT_REACHED（C 工具 source-level）。
- live B/I callback、private/target/native 未准入 NOT_REACHED；C 不造 coordinator/ledger。
- J window selector 属 main/F UI，1fba console 无控件；package-level J 数据/预览读取已核。
- D 1fba 含统计不含新窗口 selector；E 仍 ce64；1ba/1cd/ce64 不贴 1fba。
- 长期撤权、并发 writer、48h soak、F UI/E release 未测。
- 十二服务/state/tar/ledger 与 lock 差异保持；仅信号本轮证明出生资源。
