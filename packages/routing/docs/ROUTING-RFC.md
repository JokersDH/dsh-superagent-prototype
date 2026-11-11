# C interface RFC — attention, eligibility, advice and review validity

Status: wave-05 implementation. Branch `codex/g3-assistant-context`, main base `a70db20`, merge
`9aab1c8`. Owner: Agent C. Owned paths: `packages/context`, `packages/proposals`,
`packages/knowledge`, `packages/routing`.

## Consumed shared semantics

- `ExecutionProfileRef`, `RouteAdvice`, `ReviewSubject`, `ReviewReport`, `ReviewEvidence`,
  `ExecutionOutcome`, `RoutingEvidencePort` from `packages/contracts/src/routing-review.ts`.
- `UserDecision`, `AssistantStatePort`, `PersistedDecision/Proposal` for assistant persistence.
- No private wire replacement type. `AttentionItem` and `ProfileFacts` are package-local service
  inputs for pure functions; main owns HTTP DTOs.

## C1 decision transaction (closed)

`AssistantDecisionStore` maps production `AssistantStatePort.put` CAS explicitly: create with
`expectedVersion 0`; same-version retry compares the full body/source/actor except `recordedAt` and
returns the current head without writing; older replay verifies the audit body and returns the current
revoked/superseded head; legitimate successors use `expectedVersion = current.version`.

`DecisionTransactionService.prepare` is read-only; `commit`/`revoke` are synchronous and re-check
actor/project/grant/scope, current source digest/conversation and supersession before writing through
A's port. Main writes receipt/event in the same UnitOfWork. Real temporary SQLite and the independent
main probe (`review-persisted-assistant.mjs`, 7/7) pass.

## C2 wave-06 shared AttentionRanker adapter

`sharedAttentionRanker` implements contracts' `AttentionRanker` exactly. The adapter maps shared
`AttentionItem` to ranks with only shared reasons:

- `sinceAt=null` → `unknown_wait`; known waits use `waiting_age` with a capped monotonic age.
- `deadlineAt` → `deadline_overdue` or `deadline_near` inside a documented 24-hour window; far
  deadlines get no urgency reason. `expiresAt` is validity and never a deadline.
- `blockedWorkIds` is outgoing; only the item declaring blocked works gets `blocks_other_work`.
  Incoming `blockedBy` from C's old model is not renamed or inferred.
- Complete permutation, duplicate ids refused, stable order by score → deadline → known sinceAt →
  id. No probability/ROI and no authorization effect.

Main consumes this as `rankSharedAttention`/`sharedAttentionRanker`; it does not copy the algorithm.

## C2 attention and eligibility

`rankAttention(items, {now})` is a pure deterministic order over business deadline, blocking
relations, category and waiting age. `businessDeadline` is separate from question `expiresAt`; missing
business data is `unknown`; expired items are `actionable: false`. `groupAttention` only groups by
project/kind and never merges per-target permission/authentication/candidate approval.

`evaluateEligibility(facts, request)` is a pure filter over trusted facts: admission, exact profile
identity digest, evidence-layer rank, required capability proofs, scope containment, budget
availability, isolation proof and data-egress authorization. It never reads credentials, calls
Catalog or writes admission state.

## C3 cold-start advice

`adviseRoute` emits only `none_eligible`, `only_eligible`, `operator_default` or `fixed_rule`; multiple
eligible profiles without a rule return `needs_operator_choice` rather than a fabricated ranking. The
shared `RouteAdvice` schema is parsed before returning. `validateAdviceForConfirmation` rejects
expiry, task/catalog/policy drift, missing/non-admitted profile, identity drift and scope shrink.
Advice contains no actor/native command/scope grant.

## C4 review evidence

`parseReviewReport` strictly parses `review-report/1`; `assessReviewValidity` checks subject digest,
current candidate generation/artifact/contract/base/environment/check policy, input digest, reviewer
identity/authorization, distinct review attempt, exactly one isolation proof and trusted layer.
`assembleReviewEvidence` is the trusted-producer mapping; it never accepts a model-supplied layer or
attempt. `machinePass`/`humanAcceptance` are always false and `no_findings` is not a PASS.

## C5 consumer and gaps

`test/consumer.case.ts` and `examples/routing-loop.mjs` cover attention → eligibility → advice →
persisted/replayed advice → confirmation revalidation → frozen subject → structured mock review →
persisted ReviewEvidence → candidate/profile invalidation. `InMemoryRoutingEvidence` mirrors A's
append-only sync port (same-body replay, changed-body conflict, subject/profile filters).

Gaps:

1. **A**: `createWorkflowPorts(store).routingEvidence` is not on main; real-SQL persistence for
   advice/reviews/outcomes is **NOT_TESTED**. C5 uses the in-memory reference port with the identical
   interface.
2. **Main**: HTTP/provider/UI wiring for attention, advice confirmation and review evidence; producer
   must assemble trusted `ReviewEvidence` fields.
3. **B/main**: exact profile resolver, real native/controlled evidence and isolation capsule proof.
4. **A/main**: a persisted review-subject index and current-candidate invalidation hook if main wants
   to query old reviews efficiently.

Default routing/review entry remains disabled until the wave-05 R0 gates pass; this package provides
pure rules and fixtures, not admission.
