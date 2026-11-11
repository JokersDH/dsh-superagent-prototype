# RFC-0006: Production recovery activation facts (shared 0027 port)

- Status: implemented package-local and consumed by main's `RecoveryIntentCommitter`
- Owner: A (`packages/storage/`, `packages/workflows/`, migration v15)
- Shared schema: `packages/contracts/src/recovery-activation.ts`
- Model budget: 0; temporary SQLite only

## 1. What A now provides

`createWorkflowPorts(store).recoveryActivations` implements the published
`RecoveryActivationFacts` port exactly:

```ts
get(activationId) / forCommand(commandId)
put(intent) -> { intent, replayed }
```

It is wired to `store.workflows.recoveryActivations` and joins the caller's existing source
`UnitOfWork`. No second connection, file/socket/network access, async dispatch, new Work or ticket
lifecycle is created. The intent schema requires source/target roots to differ, a five-minute
confirmation window, machine and resource-policy digests, and a principal; validation uses the shared
parser, so a private wire shape is not introduced.

## 2. Identity and conflicts

- One row per `activationId`, `commandId` and `planId` (unique constraints), so there is at most one
  stable activation intent per plan.
- Same complete body replays the stored intent (`replayed: true`); a changed target, plan, principal,
  machine digest or resource-policy digest under any of those identities throws
  `WorkflowConflict`. Nothing is overwritten and no second authorization is implied.
- On read, the indexed columns are cross-checked against the immutable JSON body and its digest; a
  hand-edited row is refused rather than returned.
- The record contains only identities/digests and roots. It carries no credential, model token or
  executable authority. A row is a fact; main still decides whether a target may start.

## 3. Main consumer

`apps/coordinator/product/recovery-intents.ts` (`RecoveryIntentCommitter`) already implements the
source transaction: principal/actor check, payload conflict, synchronous runtime revalidation,
command receipt, `facts.put`, `application.recovery.intent` event and receipt consistency checks.
A's package test constructs that real class (no fake committer) on the real `ProductStore` and
verifies:

- commit writes intent + command receipt + event together; replay returns the same receipt seq;
- wrong principal is refused before any fact; changed resource-policy digest conflicts;
- a receipt trigger failure rolls back intent, receipt and event;
- a failing target revalidation (target preparation unavailable) writes nothing;
- after close/reopen the fact is readable and a lost-response replay returns the original receipt;
- legacy v14 plan intents remain audit-only and are never returned by `recoveryActivations`.

The test does not start a target, process, or native task. Main/D still own marker checks, target
materialisation, process startup and physical resource proof.

## 4. Migration and legacy data

v15 `recovery-activations` is appended after v1–v14; v14 checksums and `recovery_intents` rows are
unchanged. A v14 database upgrades in place: legacy plan intents remain readable through
`recoveryIntents` (explicitly `authorization: not_granted`), while `recoveryActivations` starts empty
and cannot inherit them. A v13 database additionally keeps works/decisions/deliveries. Unknown or
newer schemas still fail closed; nothing is silently downgraded to an empty dataset.

## 5. Snapshot and D/E consumption

The snapshot evidence summary includes both `recovery_intents` (legacy audit) and
`recovery_activations` (new facts). `examples/d-snapshot-restore.mjs` records a shared activation
intent, creates a schema-15 snapshot, byte-copies it and re-verifies; the restored database exposes
the source/target roots, and neither the legacy nor the activation row contains credential/token
material. Dropping the activation table in a copy is detected as changed evidence, not as an empty
valid backup.

## 6. Remaining external work

- Main: HTTP commit surface and target-start switching; provide the exact authoritative descriptor to
  D/E after the source receipt is committed.
- D: new empty target state, relocation, failure cleanup and rollback. A's facts do not authorize
  startup or carry cross-filesystem atomicity.
- B/main: physical old-writer barrier remains separate; no PID or old ended state becomes a new proof.
- Old `RecoveryPlan` intents are retained for audit only; do not migrate them into activation facts.

## Non-goals

No HTTP authorization, marker deletion, queue copy/clear, native session reuse, automatic retry,
second scheduler, credentials in facts, or model calls.
