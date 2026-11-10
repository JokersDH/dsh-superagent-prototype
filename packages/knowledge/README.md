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
