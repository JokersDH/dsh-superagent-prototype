# Routing, attention and review validity

Pure, zero-model rules for the cross-project attention view, execution-profile eligibility,
cold-start route advice and independent review evidence. This package has no model loop, SQL writer,
executor or approval authority.

## Attention (`rankAttention` / `groupAttention`)

Deterministic order over questions, candidate acceptances and blocked work across projects and
conversations:

1. blocking relations (an item that unblocks other items);
2. explicit business deadlines (overdue first, then upcoming);
3. category (permission/authentication > review/candidate > clarification);
4. waiting age, then stable project/id tie-breaks.

Rules that matter for safety:

- `businessDeadline` is the only business deadline. A question's `expiresAt` is validity, never a
  business deadline; missing business data stays `deadlineState: 'unknown'`.
- expired items keep `actionable: false` and reason `question_expired_no_action`; their answer can no
  longer be sent.
- grouping is navigation only. Permission/authentication/candidate items stay individually
  confirmable (`requiresPerTargetApproval`); actors and projects are never merged.

## Eligibility (`evaluateEligibility`)

Pure filter over already-fetched trusted facts: admission, exact `ExecutionProfileRef` identity
digest, required evidence layer, related capability proofs, project/scope authorization, budget
availability and isolation/data-egress proof. It returns `eligible` or stable exclusion reasons
(`not_admitted`, `evidence_missing`, `identity_drift`, `scope_denied`, `budget_unavailable`,
`read_only_unproven`, `unsupported_capability`).

Controlled/schema evidence cannot satisfy an `actual_native` requirement, and a native-branded
profile still needs identity and isolation proof. Missing/unknown budget is `budget_unavailable`,
not zero cost.

## Route advice (`adviseRoute`, `validateAdviceForConfirmation`)

Cold start only:

- no eligible profile → `none_eligible`;
- one → `only_eligible`;
- multiple → `operator_default` or `fixed_rule`; otherwise `needs_operator_choice` instead of an
  invented ranking.

Advice is data and never contains actor, native command or widened scope. `measured_history`,
trained reward/probability are not used. Before confirmation main calls
`validateAdviceForConfirmation`, which rejects expiry, project/task/catalog/policy drift, missing or
non-admitted profile, identity drift and scope shrink.

## Review validity (`parseReviewReport`, `assessReviewValidity`, `assembleReviewEvidence`)

`parseReviewReport` strictly parses the shared `review-report/1` schema. Model text, findings and
`reproduction` are untrusted data; no command/check is executed from them.

Validity requires: matching `subjectDigest`, unchanged candidate generation/artifact/contract/base/
environment/check policy, unchanged review input digest, exact reviewer identity and project
authorization, a review attempt distinct from the author assignment, exactly one valid isolation
proof (`sealed_copy` with proof + capsule manifest digest, or `native_read_only`/legacy proof), and a
trusted producer layer equal to the claimed layer.

A current review still reports `machinePass: false` and `humanAcceptance: false`. `no_findings` is
not a PASS; `inconclusive` is explicit; stale input/candidate/profile evidence cannot accept a new
patch.

## Persistence fixture and gap

`InMemoryRoutingEvidence` is a reference implementation of A's shared synchronous
`RoutingEvidencePort` (append-only advice/reviews/outcomes, same-body replay, changed-body conflict,
subject/profile filters). The real `createWorkflowPorts(store).routingEvidence` does not exist on
main yet, so real-SQL evidence for this port is **NOT_TESTED**; C5 uses the fixture with the identical
interface.

## Commands

```sh
pnpm --filter @personal-agent/routing typecheck
pnpm --filter @personal-agent/routing test
pnpm --filter @personal-agent/routing build
node packages/routing/examples/routing-loop.mjs
```

## Limits

- Attention ranking is an explainable priority heuristic, not ROI or a quality score.
- Route advice is cold-start and rule-based; no learning or measured-history ranking.
- No HTTP/provider/UI wiring, no Catalog admission changes and no execution authority.
