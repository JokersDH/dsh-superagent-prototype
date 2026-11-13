# Wave-19 A recipe: default v1, explicit v2 and one real business/recovery chain

A owns `packages/storage`/`packages/workflows`; no private permission, HTTP/UI or E assertions.

## Published format interface

- `readWorkflowEvidence(path, version)` defaults to **1**; `WorkflowSnapshots.create({destination})`
  defaults to **v1**. Only `formatVersion:2` creates the current 21-family format.
- v1: `workflow-snapshot/1` + `workflow-evidence/1`, exact historical 13 families/fields (binding has
  no `work_id`), complete known set and overall digest.
- v2: `workflow-snapshot/2` + evidence/2 + `familySetVersion:2`, exact current 21-family/field set.
- Both formats, create and verify, reject null/unsafe/<1 schema and missing table/index/unknown table.
  Mixed, subset, duplicate, future-version and v1-label-downgrade manifests are blocked.
- Genuine main v1 golden: `tests/integration/fixtures/genuine-v1-evidence.json`; main source/digest
  `e339e38272cdadaf38059ffeea18476a10c839e78427c30940371395c49de4cd`.

## One real chain

```sh
node --test packages/workflows/test/wave19-golden.case.ts
node --test packages/workflows/test/snapshot-d.case.ts
node --test packages/workflows/test/wave16-candidate-restore.case.ts
node --test packages/workflows/test/wave16-question-restore.case.ts
node --test tests/integration/recovery-source-confirmation.case.mjs
```

`wave16-candidate-restore` now uses one Store and one snapshot:

1. actual controlled Application/Effects/Broker/fixture Runner produces Work/Ticket/link, original
   question/answer and `native_applied` delivery plus dispatch/queue/runtime rows;
2. local SDK mock produces the A18 reply and nonempty candidate; explicit HTTP confirmation records
   the decision/receipt;
3. real HTTP context prepare/send creates the context binding;
4. real `POST /v1/recovery/source/prepare`/`confirm` records the original A fact/event/receipt
   (no no-op committer); audit GET and original token replay are checked;
5. explicit v2 snapshot is copied to a second root; actual `recovery_readonly` runtime/HTTP reads
   history/reply, held queue stays unchanged, business POST is rejected and no model/native send
   occurs; restored activation/receipt and `ignoreCommitted` source are verified.

## D/E inputs

- D: use the public create/verify APIs; never trim families or rewrite `familySetVersion`.
- E negatives: v1 subset, mixed versions, missing empty table/index, unknown table, changed
  binding/queue/reply bytes, partial manifest, future schema/version, missing artifact.
- Default v1 and explicit v2 are distinct workflows; portability personal-evidence 1/2 is a different
  protocol and is not covered here.
- Private startup permission/target activation/personal rebind remain main-owned; restored data never
  carries executable authorization.

Exact source/commands/exits: `packages/workflows/reports/wave19-status.json`.
