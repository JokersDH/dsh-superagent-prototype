# Explicit decisions and knowledge governance

Domain rules for turning an **explicit user message** into reusable `UserDecision` knowledge. It
consumes the shared `UserDecision` / `KnowledgePage` / `KnowledgeSourceView` contracts and two ports;
it creates no database, migration or second writer.

## Ports

- `DecisionStorePort` (owned by storage): append-only revision history, `get`, keyset `list`, and
  CAS `revoke(expectedVersion)`. `InMemoryDecisionStore` is the reference/fixture implementation.
- `DecisionSourcePort` (owned by main): read-only message provenance (`role`, `provenance`,
  `questionKind`, project, title). `StaticDecisionSourcePort` is the fixture adapter.

## Governance rules

Only a trusted `user` message can be recorded. The following are refused:

- assistant/reasoner/application messages;
- permission or authentication answers (they never become shared decisions);
- cross-project scopes or sources;
- scopes outside the current authorization;
- already-expired scopes, blank/NUL/oversized content.

Effectiveness is re-derived from the **current** source on every read: a missing message, a changed
`textDigest`/conversation/project, or non-user/non-trusted provenance makes the decision ineffective
while its append-only audit revisions remain stored. Revocation appends a new revision (CAS on the
expected version) and removes the decision from new knowledge. A new decision may supersede an older explicit decision of the same project when it covers
the old scope. Revoked, superseded and expired decisions never enter new context; the original source
and revision history remain auditable, and a missing source is reported as `validity: 'missing'`.

Automatic promotion stays closed: `evaluateAutomaticPromotion` always returns `eligible: false` and
classifies one-off goal changes, temporary environment fixes and agent deviations as not preferences.
Even `explicit_preference` requires a separate explicit decision command.

## Consumer loop

`test/consumer.case.ts` runs the complete offline loop:

1. authorized bounded context read;
2. mock reasoner returns a plain reply (not executable) and structured proposals;
3. proposal confirmation/rejection;
4. decision record through `DecisionGovernance`;
5. subsequent context read includes the decision as `untrusted_data`;
6. revocation removes it from later reads.

No network, SDK or model call is made; no intent is dispatched.

`examples/assistant-loop.mjs` runs the same loop against the built packages and writes a report.

## Commands

```sh
pnpm --filter @personal-agent/knowledge typecheck
pnpm --filter @personal-agent/knowledge test
pnpm --filter @personal-agent/knowledge build
node packages/knowledge/examples/assistant-loop.mjs
```

## Effectiveness scan bounds (wave-06 continuation)

`AssistantDecisionStore` never reports a partial project scan as complete knowledge:

- `scanProject` pages the project until the port is exhausted. If the documented budget
  (`DEFAULT_DECISION_SCAN`: 200 records/page, 200 pages = 40,000 decisions per project) is exceeded,
  it throws `DecisionError('scan_incomplete')` instead of truncating.
- `getSync` uses a targeted supersession probe that stops once it passes the target's `recordedAt`
  (a superseder must be appended after its target) and also refuses on an exceeded bound.
- `DecisionGovernance.listEffectiveWindow` reports `truncatedByLimit` when **the caller's own cap**
  cut the effective set; `listEffective` keeps the cap-only signature. The store scan underneath is
  still complete-or-refuse.
- Limits are injectable (`new AssistantDecisionStore(port, { pageSize, maxPages })`) for regression
  tests; lowering them proves the refusal path without a huge fixture.

## Persisted adapter (wave-04 C2)

`AssistantDecisionStore` maps the shared synchronous `AssistantStatePort.decisions` to this domain
port without opening SQL or a second database. It preserves source message, conversation and digest,
append-only revisions, CAS revocation and bounded project scans for supersession. Effectiveness is
still re-derived from `DecisionSourcePort` on every read; a missing/stale source excludes the
decision while persisted revisions remain auditable.

`InMemoryAssistantState` (proposals package) is the reference port fixture used by the vertical
until storage publishes the real `createWorkflowPorts(store).assistant` implementation. The real
temporary-SQLite vertical is **BLOCKED/NOT_TESTED** until that port lands.

## Wave-05 C1 — real-store replay and synchronous decision transaction

`AssistantDecisionStore` now maps the production CAS contract explicitly: create uses
`expectedVersion 0`; a same-version retry compares the full body/source/actor except `recordedAt` and
returns the current persisted head without writing; an older replay returns the **current head** so a
revoked/superseded decision is never resurrected; a legitimate successor uses
`expectedVersion = current.version`. Real SQLite replay at two different times is covered by
`test/real-store.case.ts` and the independent `review-persisted-assistant.mjs` probe (7/7).

`DecisionTransactionService` provides read-only `prepare`, `prepareRevocation` plus synchronous
`commit`/`commitRevocation`/`revoke` for main's UnitOfWork. `prepare` writes nothing and returns an immutable decision/source snapshot;
`commit`/`revoke` re-check trusted actor, project/grant/scope, current source digest/conversation and
supersession state, then write through A's synchronous `AssistantStatePort`. Main writes its
receipt/event in the same transaction; failures roll back. See
`examples/decision-transaction.mjs` and `examples/assistant-workflow.mjs` for real temporary-SQLite
consumers. The latter runs the web-flow recipe: authorized context preview -> proposal pending/confirm
with receipt -> `planProposalCommand` mapping the confirmed intent to the existing `UserCommand` ->
decision record with receipt -> revocation plan/commit -> old replay stays revoked.

`test/full-loop.case.ts` covers the same loop plus unconfirmed/drifted confirmation, duplicate
confirmation, receipt-failure rollback (decision + event + receipt), reopen, supersession, revoke with
no resurrection, source loss and same-id body conflict.

## Wave-04 checkpoint

The three independent admission failures are fixed: missing-source decisions are no longer effective
or listed; confirmed proposal replay authenticates the actor first; stored/returned grants, scopes
and records are independent deep-frozen snapshots (`test/knowledge.case.ts`). The persisted
`AssistantStatePort` adapter and prepare/commit split are the next stage.

## Limits

- Production persistence, migrations and HTTP commands are A/main-owned; this package provides the
  port contract, rules and an in-memory fixture. The in-memory cursor is keyset but not a production
  concurrency proof.
- Cross-project memory inference, automatic rule promotion and learning-effect claims are out of
  scope.
