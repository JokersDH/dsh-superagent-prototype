# RFC-0004: accepted-event projection, timing and snapshot consumption

- Status: implemented and integrated package-local; main production wiring of `acceptance.consume`
  still pending, C decision consumer verified through main's own composition on base `6f6edde`
- Owner: A (`packages/storage/`, `packages/workflows/`, schema v13)
- Inputs: `application.candidate.accepted` event, shared `ReviewTiming`, routing/review/outcome schemas, 0023
- Model budget: 0; temporary SQLite fixtures only

## A1/A2: deterministic accepted projection

`createWorkflowPorts(store).acceptance.consume({eventSeq, projectId, profileRef, layer})` reads the
existing event and existing storage facts, then writes one `ExecutionOutcome` if complete:

1. The event must be exactly `application.candidate.accepted` and its candidate must parse.
2. The source Work must belong to the requested project.
3. Exactly one ended `runtime_bindings` row must match candidate ticket/assignment/contract; it
   supplies `attemptId`/`fenceEpoch`. Zero or multiple rows become `attempt_missing`/`attempt_ambiguous`.
4. A completion verification must match ticket/assignment/candidate generation.
5. A completion acceptance is preferred when present. For machine-only contracts without a separate
   acceptance row, the exact accepted event reference (`accepted-event-<seq>`) is the acceptance
   source; the event itself is never re-emitted.
6. A trusted main producer supplies the exact `ExecutionProfileRef` and evidence `layer`. A refuses to
   infer either from a brand, filename, model text or fixture.

The outcome ID is deterministic from the candidate, so re-consuming the same event returns
`replayed`; a changed candidate/source cannot overwrite the record. Missing sources return
`incomplete` with reasons and write nothing. No second accepted event, acceptance command, UI activity
fact or zero-cost usage is created. `ReviewTiming` is copied only as observed; null/partial remains
null/partial. Ready-to-acceptance wall time and active UI proxy time remain separate.

## A3: bounded source reads

The projection and `routingEvidence` queries require an exact project. Their cursor pages are
bounded; work/source queries are read-only. Historical rows remain readable for audit, but C/main must
revalidate candidate/contract/profile/layer before treating any row as current. A does not produce a
second Work lifecycle or a physical-writer stop claim.

## A4: real C consumer (resolved on base `6f6edde`)

C's `AssistantDecisionStore`/`DecisionTransactionService` now consume A's synchronous
`AssistantStatePort` and `index.sourceMessage` through main's `ProductDecisions` composition. On this
branch's merged base, two independent suites pass against real SQLite:

- `packages/workflows/test/decision-consumer.case.ts` (A-owned test, 4 cases): prepare writes nothing;
  commit joins the caller UoW with event/receipt; same-body replay at a later clock is idempotent;
  changed body is `payload_mismatch`; revoke appends version 2 and a stale revoke is `stale_version`;
  a revoked record cannot be a supersession base; source edit/delete yields `stale`/`missing` and
  blocks commit; a receipt trigger failure rolls back decision rows, event and receipt, and a later
  identical commit succeeds.
- `tests/integration/decision-commands.case.mjs` (main-owned, executed read-only, 8/8) covers
  signature/expiry/grant drift, HTTP identity/schema, recovery read-only, replay/revoke and
  non-trusted-source rejection through the actual `ProductDecisions` + HTTP composition.

This replaces the previous "C consumer missing" blocker. It does not prove native execution, the E
pilot, attention ranking benefit or full product admission. The C test dependency is requested as
`@personal-agent/knowledge` (test-only `workspace:*`); main regenerates the authoritative root lock.

## A5: snapshots and D consumption

The single-work timeline includes the projected outcome and its optional ReviewTiming. Snapshot
creation reads artifact references from the backup DB and rejects an absent review report artifact.
The manifest now also carries a **bounded workflow-evidence summary**: per-family identities plus a
SHA-256 over the actual record bodies (decisions incl. their body ledger, proposals, settings,
contracts, verification/acceptance fields, outcomes incl. ReviewTiming, review evidence), with
`complete=false` when a family exceeds the 2000-row bound. This lets D report what a backup covers and
detects a row change even when the database bytes and manifest hash are re-recorded.

Snapshots from a schema newer than this build are `incompatibleSchema`/blocked, and opening that
database is refused by the migration entry (gap/future-version). A byte-copy "restore" into a new
directory re-verifies DB hash, integrity, foreign keys, artifact bytes/digests and evidence digest;
`examples/d-snapshot-restore.mjs` is the runnable recipe. Actual restore/rollback and
re-authorization policy remain D/main.

## Migration

No migration is needed beyond v13 `routing-evidence`: the projection is derived from existing events,
bindings, completion records and the v13 outcome table. v13 remains the current product schema in this
package. Any future source index would be an append-only A migration; this package does not prebuild
an analysis warehouse.

## Consumer order

1. Main writes the accepted event/command receipt once in its transaction and optionally calls
   `acceptance.consume` with its trusted profile/layer and exact project.
2. Main calls `acceptance.consume` from the same acceptance transaction (pending main wiring); it
   must not append another accepted event.
3. C reads `routingEvidence`/timeline, validates currentness against its own subject/grant rules, and
   never treats a historical outcome as current authority.
4. D snapshots via `WorkflowSnapshots`; report artifact references must be registered and copied,
   and the evidence summary must remain complete for a full backup claim.
5. E independently verifies that replay, stale candidate, revoked source and mutated input remain
   rejected; A's fixture tests are not a substitute for E's gate.

## Explicit non-goals

No automatic acceptance, no review PASS, no confidence/routing score, no model call, no second driver,
no external HTTP write endpoint, no fabricated usage or human time.
