# Agent C：main 可直接组合的导出与最短 recipe（wave-07 C1）

Branch `codex/g3-assistant-context`，base `origin/main` `0df3fd1`（merge `6bff83c`）。
Owned paths: `packages/context`, `packages/proposals`, `packages/knowledge`, `packages/routing`.
本文件只描述库级契约；HTTP/UI/application 组合由 main 拥有。

## 1. 生产 port 实例（A）

```ts
import { ProductStore } from '@personal-agent/storage'
import { createWorkflowPorts } from '@personal-agent/workflows'

const store = new ProductStore({ path })          // one writer / one UnitOfWork
const ports = createWorkflowPorts(store)
ports.assistant        // AssistantStatePort + legacyDecisions
ports.index            // listWorks / work / sourceMessage
ports.routingEvidence  // RoutingEvidencePort + sources(attemptId, projectId)
store.uow.atomic(fn)   // the only transaction boundary main composes into
```

## 2. 稳定导出

| 包 | 导出 | 用途 |
| --- | --- | --- |
| `@personal-agent/context` | `ContextReader`, `buildContextPreview`, `ContextComposer`, `buildCompositionPreview`, `DEFAULT_COMPOSED_GROUPS`, `ReadIndexContextPort`, `LocalProjectSourcePort`, `StaticContextPort`, `CompositeContextPort`, `ContextError` | 有界、带来源的上下文读取、预览与显式预算组合 |
| `@personal-agent/proposals` | `AssistantProposalService` (含 `confirmWithCommand`), `parseStructuredOutput`, `planProposalCommand`, `ProposalError`, `InMemoryAssistantState`(fixture) | 结构化提案、确认、命令计划 |
| `@personal-agent/knowledge` | `DecisionTransactionService`, `AssistantDecisionStore`, `DecisionGovernance`, `decisionContextProvider`, `DEFAULT_DECISION_SCAN`, `DecisionError`, `DecisionConflict` | 明确决定的 prepare/commit/revoke、效力规则与上下文 provider |
| `@personal-agent/routing` | `sharedAttentionRanker`, `rankSharedAttention`, `evaluateEligibility`, `adviseRoute`, `validateAdviceForConfirmation`, `parseReviewReport`, `assessReviewValidity`, `assembleReviewEvidence` | 注意力排序、准入、建议、复核有效性 |

## 3. 最短 recipe：明确决定（record / revoke）

```ts
// main 的认证命令入口内
const decisions = new DecisionTransactionService(
  new AssistantDecisionStore(ports.assistant),
  { getMessage: id => { const m = ports.index.sourceMessage(id, projectIds); return m && {...} } },
  { now: () => new Date() },
)

// 只读 prepare：不写 DB、不入队、不产生 effect。main 用它生成签名预览。
const prepared = decisions.prepare({ decisionId, content, scope, sourceMessageId }, actor)

// 用户明确确认后，在同一 UnitOfWork 内同步提交 + 原命令 receipt/event。
store.uow.atomic(() => {
  const result = decisions.commit(prepared, actor)          // 同步，禁止 await
  store.events.append({ topic: 'application.decision.changed', entityRef: decisionId, payload: {...} })
  store.commands.record(commandId, payloadDigest, () => ({ status: 'recorded' }))
})

// 撤销：先只读 plan，再同步提交（CAS）。
const plan = decisions.prepareRevocation(decisionId, expectedVersion, actor)
store.uow.atomic(() => decisions.commitRevocation(plan, actor))
```

事务失败语义：`commit`/`commitRevocation` 抛错时，main 的 `uow.atomic` 整体回滚，决定、proposal 状态、event、receipt 均不落库。**不要在事务内 `await`**，也不要事务外先写决定再补 receipt。

## 4. 最短 recipe：提案确认 → 原业务命令

```ts
const proposals = new AssistantProposalService(ports.assistant)

// 1) 事务外只读 prepare（解析 + 绑定 + 快照）
const prepared = await proposals.prepare({ proposalId, payload, trusted, conversationId, sourceTextDigest })

// 2) 同一事务内：pending → confirmed，并返回既有 UserCommand
store.uow.atomic(() => {
  proposals.persistPending(prepared)
  const confirmed = proposals.commit(prepared, { expectedVersion: 1, expectedDigest: prepared.payloadDigest,
    actorRef, effectCommandId: commandId, revalidate: () => ({ ok: true }), barrier: () => ({ ok: true }) })
  const plan = planProposalCommand(confirmed.intent, { commandId, conversationId, work, revision })
  // plan.kind: 'command' | 'needs_user_input' | 'no_effect'
  // 只有 'command' 才由 main 在同一事务内 dispatch 既有 UserCommand
})
```

`planProposalCommand` → `UserCommand` 精确映射：

| intent | UserCommand.kind | 必需 caller 输入 |
| --- | --- | --- |
| `reply` | 无（`no_effect`） | — |
| `create_work` | `create_work` | `work.scope`/`criteria`/`profileId` |
| `revise_work` | `revise_work` | 完整 `revision.goal/scope/criteria` |
| `record_decision` | `record_decision` | —（用 intent 自带 scope/source） |

缺失项返回 `needs_user_input` + 具体字段；不会用默认值扩大权限。命令不含 actor 字段。

## 4b. 最短 recipe：一次调用确认提案并拿到原命令

```ts
store.uow.atomic(() => {
  proposals.persistPending(prepared)
  const confirmed = proposals.confirmWithCommand(prepared, {
    expectedVersion: 1, expectedDigest: prepared.payloadDigest, actorRef,
    effectCommandId: commandId,                       // main 生成
    revalidate: () => ({ ok: true }), barrier: () => ({ ok: true }),
    plan: { commandId, conversationId, work },        // create_work 必需
  })
  if (confirmed.command) dispatchExistingUserCommand(confirmed.command)  // 同一事务
})
```

`needs_user_input` 在确认**之前**抛出（提案保持 pending），`reply` 返回 `command: null` 且无业务效果。

## 4c. 状态转换（不混用 reject 与 revoke）

| 对象 | 转换 | 语义 |
| --- | --- | --- |
| 提案 | `pending → confirmed` | 版本 +1，绑定 main 的 `effectCommandId` |
| 提案 | `pending → rejected` | 终态，从未产生命令；不可再确认 |
| 提案 | `pending → expired \| superseded` | 有效期/被替换；不可确认 |
| 决定 | `active → revoked` | 版本 +1，审计保留，不再进入有效上下文 |
| 决定 | `active → superseded` | 新决定覆盖；**替替代者被撤销也不会复活旧决定** |

## 5. 最短 recipe：有界上下文预览

```ts
const bundle = await new ContextReader().read({
  requestId, projectId, purpose: 'conversation_discussion', query,
  grant: { gateway: 'conversation', scope, sourceKinds, maxFiles, maxBytes, maxTokens, maxDurationMs,
           confirmedAt, confirmedBy, grantId },
}, new ReadIndexContextPort({ projectId, index: ports.index, decisions }))

const preview = buildContextPreview(bundle)  // selectedFiles/bytes/tokens/omitted/injectionFlags/validity
```

`bundle.trust === 'untrusted_data'`；预览不等于自动注入，是否进入模型请求由用户授权入口决定。

显式预算组合（推荐给网页）：

```ts
const composer = new ContextComposer({
  port: new ReadIndexContextPort({ projectId, index: ports.index }),
  decisions: decisionContextProvider(governance),   // 只返回有效决定；扫描不完整会抛 scan_incomplete
  conversation: { recent: ... }, artifacts: { recent: ... },
})
const composition = await composer.compose({ requestId, projectId, purpose, query, grant, budget,
  conversationId, workId, contract })
const preview = buildCompositionPreview(composition)
```

组顺序固定：合同/工作 → 有效决定 → 项目事实 → 历史消息 → 产物元数据 → 原始文件。组只能读取 grant
实际包含的 kind；不完整效力扫描使整个组合失败（`ContextError('scan_incomplete')`）。

## 6. 已集成 vs 待集成（source 差异）

已集成到 main 并可消费：A `assistant`/`index`/`routingEvidence`、main 决定 HTTP（`ProductDecisions` + `/v1/decisions*`）、`sharedAttentionRanker` 接线、接受事件 Outcome 投影。

待 main 接线（C 本轮不写 HTTP）：通用 proposal 确认/拒绝入口、context 预览入口、`routingEvidence` 的可信 outcome/review producer、候选变化使旧 review 失效的钩子。

C 侧不重复：决定 HTTP、attention 页面、Outcome 投影、SQL/迁移。

## 7. 调用方输入/错误 fixture

合法：`packages/knowledge/test/full-loop.case.ts`、`packages/proposals/test/command-plan.case.ts`、
`packages/context/test/read-index.case.ts`、`packages/routing/test/real-evidence.case.ts`。

非法/拒绝：未确认或漂移 grant/actor/scope/source/版本 → `stale_authorization`/`actor_mismatch`/`source_stale`；
重复确认幂等；同 ID 改正文 → `payload_mismatch`；撤销/替代后旧重放不复活；效力扫描超预算 →
`DecisionError('scan_incomplete')`（绝不静默返回部分有效知识）。
