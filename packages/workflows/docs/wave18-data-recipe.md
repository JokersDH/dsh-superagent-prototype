# Wave-18 A data recipe: genuine legacy v1, current v2 and real source confirmation

A owns `packages/storage` and `packages/workflows`; it does not implement activation/private grants.

## Version-aware evidence

- **v2 (current)**: `workflow-snapshot/2` + `workflow-evidence/2` + `familySetVersion:2`, exact current
  21-family set and overall digest; binding body includes `work_id`.
- **v1 (historical producer)**: `workflow-snapshot/1` + `workflow-evidence/1` without a version, the
  exact historical 13-family set and its original field list — notably the binding family has **no**
  `work_id`. The verifier computes the legacy family set/order/digest from the database and requires
  the complete 13-family manifest; a v1 subset is blocked.
- Mixed pairs, v2 without version, future versions and unknown formats are blocked. A v1 label cannot
  promote old capability to current v2.

`readWorkflowEvidence(path, 1)` reproduces the genuine old-producer family digest. The acceptance
probe uses a real old worktree producer:

```sh
PA_ADMISSION_REPORT=/tmp/pa-wave18-a.json node tools/bootstrap/probe-wave18-context.mjs <old-v1-root> $PWD
```

It produces 2/2 PASS (empty and non-empty binding v1), proving the real old producer is not merely
relabeled.

## Required schema

`inspectSchemaInventory` checks actual tables/named indexes against migrations. Current snapshots are
blocked for a missing empty `assistant_reply_results`, a missing index or unknown table even after DB
hash rewrite. Legacy v1 must still satisfy its recorded schema's required objects.

## Source confirmation and combined non-empty recovery

Main `e32a3fc/6050b4b` provides real source prepare/confirm/audit. The clean combination is 14/14 new
HTTP/process tests and 106/106 recovery/candidate/proposal tests. Prepare writes nothing; confirm
writes the exact A fact/event/receipt in the source UoW; exact `ignoreCommitted` rejects other queue/
business/resource changes; the original same-channel token replays the original result after reopen.
All results remain `not_granted`/`startupAvailable:false`.

The candidate restore test builds one non-empty snapshot containing: real SDK reply/candidate and
explicit decision, real context binding via HTTP prepare/send, Work/Ticket/link, original question/
answer/delivery, held queue, runtime resources and an A source activation/receipt. It restores to a
second root, starts actual `recovery_readonly` runtime/HTTP, reads the original context history and
reply, keeps the held queue unchanged and rejects business POSTs without a model/native send.

## D/E commands and negatives

```sh
node --test packages/workflows/test/snapshot-d.case.ts
node --test packages/workflows/test/wave16-candidate-restore.case.ts
node --test packages/workflows/test/wave16-question-restore.case.ts
node --test packages/workflows/test/snapshot-crash.case.ts
```

Negatives: v1 subset, mixed versions, missing empty table/index, unknown table, changed binding
`work_id`/queue/reply bytes, partial manifest, future schema/version. No hand-written SQL or
`verifiedBy` marker is needed; use the public store/snapshot APIs.

Exact source/commands/exits are in `packages/workflows/reports/wave18-status.json`.
