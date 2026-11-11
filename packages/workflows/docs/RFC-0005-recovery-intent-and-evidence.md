# RFC-0005: Recovery intent facts and paged historical evidence

- Status: implemented package-local; main's activation commit/HTTP remains PLANNED and main-owned
- Owner: A (`packages/storage/`, `packages/workflows/`, migration v14)
- Inputs: `contracts/recovery-state.ts` (RecoveryPlan/Prepare/Inspection), 0025, 0026
- Model budget: 0; temporary SQLite only

## Why A stores an intent fact

0026 fixes the activation semantics: main validates the explicit user decision, A records the exact
plan and a stable activation identity in the source UnitOfWork, D starts a new empty execution state,
and no old queue/marker/writer proof is reused implicitly. Storage therefore needs one immutable,
idempotent fact per plan that can be queried after a crash or lost response. This is not an
authorization service and does not add a second execution lifecycle.

## A1/A2: synchronous fact port

`createWorkflowPorts(store).recoveryIntents` (also `store.workflows.recoveryIntents`) provides:

```ts
record({ commandId, actor, plan, expectedInspectionFingerprint, sourceFingerprint, confirmedAt? })
  -> { record, replayed }
getByPlan(planId) / getByCommand(commandId)
list({ sourceFingerprint?, limit?, cursor? })
```

- The input plan is the published `RecoveryPlan` parser. The port refuses a plan whose
  `authorization` is not `not_granted` or whose `commitAvailable` is not `false`, so a fact can never
  be mistaken for a granted commit.
- `plan.inspectionFingerprint` must equal the caller's expected fingerprint, and the current
  `sourceFingerprint` must equal it; drift rejects the intent. An expired plan rejects.
- One row per `planId` (unique) and per `commandId` (PK). An exact same command/body or a second
  command with the identical plan payload replays the original fact and returns its original
  `commandId`. Any changed plan/target/actor/source conflicts; nothing is overwritten.
- The row is written inside the caller's `UnitOfWork`. Callers write their command receipt and
  `recovery.intent.recorded` event in the same transaction; an injected receipt failure rolls fact,
  event and receipt back together. No await or business dispatch happens in the transaction.
- The fact records plan bindings/executor digest/blockers but no credential, model request, restore
  marker deletion or queue change. `authorization` on the returned record is always `not_granted` and
  `activationAvailable` is always `false`.

## A3: paged historical evidence

`index.evidencePage({ workId, projectIds, limit, cursor })` reuses the existing single-work timeline
sources and adds stable pagination over `(at desc, kind asc, sourceRef asc)`:

- `window: 'caller_limit'` + `hasMore/nextCursor`: the caller page ended; continue for more.
- `window: 'storage_cap'`: a bounded per-source scan (contracts/links/questions 500, verifications/
  acceptances/observations/reviews/outcomes 200) was exhausted; later facts may exist and are **not**
  claimed absent. `sourcesCapped` names the bound.
- `window: 'complete'`: the observable facts for this work were fully enumerated.

Existing `timeline(limit ≤ 500)` keeps working for main's current `/v1/works/:id/evidence`; its
`truncated` now also reflects the per-source cap. Historical decisions/outcomes remain readable after
revocation/expiry; source validity and currentness stay separate and are never inferred from the
timeline.

## A5: snapshot and migration

v14 `recovery-intents` is appended after v1–v13. The snapshot evidence summary gains a
`recovery_intents` family whose digest covers the plan payload, so a byte-restored snapshot can prove
the intent and its `not_granted` state. A v13 database upgrades in place with existing works,
decisions and deliveries intact; the intent table starts empty. Snapshots from a newer schema remain
`incompatibleSchema`; an older schema (13) is migratable by this build.

## What remains main/D

- Main owns the public commit/HTTP/schema, the user confirmation protocol, switching to a new empty
  execution state, and the startup/queue isolation. `RecoveryPlan` in the current main checkpoint is
  read-only (`authorization=not_granted`, `commitAvailable=false`); this port does not change that.
- D owns target preparation bytes, relocation, rollback and re-authorization. A's fact/plan/evidence
  recipe is an input, not a permission.
- A cannot test cross-database or filesystem atomicity; only the source-DB transaction is proven.
  Physical old-writer proof remains with main/B's barrier.

## Non-goals

No marker deletion, queue clearing/copying, session resumption, automatic retry, new Work lifecycle,
second scheduler, credentials in facts, or model calls.
