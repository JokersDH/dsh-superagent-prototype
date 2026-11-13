# Wave-17 A data recipe: version pairing, schema inventory and source confirmation

A owns `packages/storage` and `packages/workflows`; it does not implement activation or private
authorization.

## Snapshot format pairing

| Manifest | Evidence | Required |
| --- | --- | --- |
| `workflow-snapshot/2` | `workflow-evidence/2` + `familySetVersion: 2` | exact current 21-family set and overall digest |
| `workflow-snapshot/1` | `workflow-evidence/1` without `familySetVersion` | only the families actually recorded |

Mixed pairs (`snapshot/1` + `evidence/2`, v2 without version, v2 with evidence/1, future version) are
blocked. A current v2 manifest cannot be downgraded to a subset by changing labels.

## Required schema inventory

`inspectSchemaInventory(databasePath, schema)` checks actual tables and named indexes against the
migration registry up to the recorded schema. Snapshot create and verify require:

- no missing required table (including an empty `assistant_reply_results`),
- no missing required index,
- no unknown table,
- no future schema.

A legacy v1 manifest is still read only for its recorded family capability, but its database must
still satisfy its recorded schema's required objects. Database upgrade and snapshot-format
compatibility are separate.

## Actual source confirmation

Main `e32a3fc`/`6050b4b` exposes real `POST /v1/recovery/source/prepare` and `/confirm`; consume them
directly:

```sh
node --test tests/integration/recovery-source-confirmation.case.mjs   # 14/14
node --test tests/integration/recovery-source-intents.case.mjs ...    # clean combination 106/106
```

Prepare writes nothing. Confirm records the exact A activation fact/event/receipt in the source
UnitOfWork and uses exact `ignoreCommitted`; other queue/business/resource changes and extra writes
roll back. The original same-channel token replays the original result after reopen/expiry; it does
not re-authorize. All outputs remain `not_granted`/`startupAvailable:false`; private permission and
target start are still external.

## Second-root producer/recovery recipe

```sh
node --test packages/workflows/test/wave16-candidate-restore.case.ts
node --test packages/workflows/test/wave16-question-restore.case.ts
node --test packages/workflows/test/snapshot-d.case.ts
node --test packages/workflows/test/snapshot-crash.case.ts
```

Candidate: SDK mock → A18 → candidate GET/prepare → explicit confirmation → snapshot → second root
→ real `recovery_readonly` runtime/HTTP snapshot. The reply body is readable, the held queue is
unchanged, a business POST is rejected and no model/native send occurs.

Question: controlled Application/Broker/fixture Runner → real Work/Ticket/link + question/answer/
native delivery + queue/runtime → snapshot → second root reads all rows; `startupAvailable:false`.

E negatives: remove `effect_queue`, one-family manifest, mixed format pair, missing empty table,
missing required index, unknown table, changed queue/binding/reply bytes, partial manifest, future
schema/version.

Exact source/commands/exits are in `packages/workflows/reports/wave17-status.json`.
