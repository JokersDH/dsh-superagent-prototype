# Wave-14 A consumer map

A owns only `packages/storage` and `packages/workflows`. The source reader and snapshot never grant
activation, target startup or a physical-writer proof.

## main

- Source baseline: **NOT_TESTED**. Main has not wired `store.workflows.recoverySource.inspect` into
  an actual prepare/confirm flow. Main should snapshot before confirmation, then compare
  `inspect({ ignoreCommitted: commit })` with that baseline and keep marker/host/physical checks
  separate.
- History/reply: already consumed (88/88 current main consumers). `contextHistory.page` raw data is
  behind main's signed principal/project cursor; `replyResults` is consumed by
  `CompletedAssistantReplies` with the existing before-send receipt and artifact.

## B

Existing public stores are sufficient; no new port or migration was added.

```ts
store.bindings.current<T>(ticketId)   // current attempt binding, including fenceEpoch
store.bindings.binding<T>(attemptId)  // immutable attempt history
store.commands.get(commandId)         // original receipt/payload digest
store.dispatch / store.answers        // existing control/answer stores
```

Tests reopen SQLite and verify attempt, fenceEpoch, current pointer and original receipt survive; a
recovery source snapshot includes `runtime_bindings`, `runtime_current`, dispatch/answer families and
signals any change.

## D

- Read the current schema dynamically from `PRODUCT_SCHEMA_VERSION` and
  `recoverySource.inspect().productSchema`; do not hardcode 18.
- Required snapshot evidence families include bindings, reply results, recovery activations/intents,
  decisions/settings/contracts/verifications/acceptances, outcomes/reviews and legacy decisions.
- Referenced artifacts include review reports, context bundles and completed reply bodies.
- `WorkflowSnapshots.create/verify` is the public recipe; copy to a second temporary root and verify
  there. A restored copy is data only and does not inherit activation or authorization.

## E

```sh
node --test packages/workflows/test/recovery-source.case.ts
node --test packages/workflows/test/reply-results.case.ts
node --test packages/workflows/test/snapshot-d.case.ts
node --test packages/workflows/test/reply-crash.case.ts
node --test packages/workflows/test/snapshot-crash.case.ts
```

These cover negative rowids, 64-bit rowids, strict activation/index/mirror validation, command-event
payload/payload_ref, later same-body events, bounded scans, missing tables/artifacts, changed bytes,
future schema and independent SIGKILL windows. The exact source, commands, exits and limits are in
`packages/workflows/reports/wave14-status.json`.
