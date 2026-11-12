# Wave-15 A consumer map

A owns `packages/storage` and `packages/workflows`; no parallel authorization port, second connection
authority or ledger is introduced.

## main: actual inspect/prepare (PASS)

main `697efdc` consumes `store.workflows.recoverySource` inside `ProductRecovery.inspect()` and the
real runtime `GET /v1/recovery/inspect` / `POST /v1/recovery/prepare`.

- `logicalSource` exposes only `coverage` and `fingerprint`; the fingerprint participates in
  `inspectionFingerprint`.
- An unlogged business change invalidates a prior preview with `conflict`.
- `bounded`/`unsupported`/read failure produces `source_checkpoint_unavailable` and refuses prepare.
- heartbeat-only change stays stable; writer identity changes invalidate.
- prepare still returns `authorization: not_granted` and `commitAvailable: false`.

Actual evidence: `packages/workflows/reports/wave15-logical-source-consumer.txt` (8/8) and
`wave15-recovery-combination.txt` (66/66).

**Confirm/private authorization is not implemented by main yet**: the actual commit route returns
422 and every plan remains not-granted. This composition is NOT_TESTED; it is separate from the
inspect/prepare consumer above.

## B: existing control data

B should keep using the existing public stores; no new A port was added:

```ts
store.bindings.current<T>(ticketId)   // current attempt with fenceEpoch
store.bindings.binding<T>(attemptId)  // attempt history
store.commands.get(commandId)         // original receipt identity
store.dispatch / store.answers        // existing control/answer data
```

Wave-15 tests reopen SQLite and verify attempt, current pointer, fenceEpoch and original receipt;
source snapshots include runtime/queue/resource/dispatch families.

## D: dynamic install/snapshot inputs

- Read `PRODUCT_SCHEMA_VERSION` and `recoverySource.inspect().productSchema`; do not hardcode 18.
- Snapshot evidence now also covers `effect_queue`, `runtime_bindings`, `runtime_current`,
  `resource_observations`, `dispatch_receipts`, and the binding `work_id` derived column.
- Referenced artifacts include review reports, context bundles and reply bodies; the maximum tested
  reply/bundle artifact is 524288 bytes.
- `WorkflowSnapshots.create/verify`; copy to a second temporary root and verify. Verification
  compares every family recorded by the manifest, so older snapshots remain valid for their
  recorded families while new snapshots cover the current family set.
- A restored snapshot is data only: no activation, authorization or physical-writer proof.

## E: negatives

```sh
node --test packages/workflows/test/recovery-source.case.ts
node --test packages/workflows/test/snapshot-d.case.ts
node --test packages/workflows/test/snapshot-crash.case.ts
node --test packages/workflows/test/reply-crash.case.ts
node --test tests/integration/recovery-logical-source.case.mjs
```

Covers negative/64-bit rowids, exact activation/receipt/event fields, payload_ref, later same-body
events, bounded scans, missing tables/artifacts, changed binding `work_id`/queue body, partial
manifests, future schema and independent SIGKILL windows.
