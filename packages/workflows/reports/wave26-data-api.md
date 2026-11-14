# Wave-26 A: restore content identity and bounded data tools

Base: merge `origin/main` `6787bd0` into `codex/g2-workspaces-verification` (`ab33f6c`).
Schema stays 18; no migration and no new table/ledger.

## A1 actual Node entry

The wave-25 dual test had a duplicate `existsSync` import, which Node 24 rejects at module load,
and the input guard used `assert.throws(fn, undefined, name)`, which strict TypeScript rejects.
Both are fixed. The declared Node entry now loads and runs:

```
cd packages/workflows
node --test test/wave25-input-guards.case.ts test/wave25-dual-snapshot-personal.case.ts \
  test/wave25-original-result.case.ts test/wave23-process-reader.case.ts test/wave24-subject-consistency.case.ts
# 5 pass / 0 fail, exit 0 (wave26-node.txt)
```

Strict and build are separate facts: `npx tsc --noEmit -p packages/storage` and
`-p packages/workflows` exit 0; `tsc -p packages/storage/tsconfig.build.json` and
`tsc -p packages/workflows/tsconfig.build.json` exit 0. The production build does not load tests, so
it is not evidence for the Node test entry.

## Content identity protocol

`@personal-agent/storage` exports `readWorkflowContent(databasePath, { limits })`:

- protocol `workflow-content/1`; digest header binds protocol, product schema, the exact omitted
  table list and the limits;
- every durable table except `coordinator_instances`, `writer_claim` and the `conversation_search`
  FTS shadow tables is read in `rowid` order with its column names and values; each collection has
  `rows` and a SHA-256 digest; the aggregate digest is over those collections;
- the omitted tables are root-local runtime presence/ownership and derived FTS storage only. They
  are listed in the report and in the digest header; they are never used as writer-quiescence,
  execution or acceptance evidence. Any other table, including a future business table, is hashed;
- default limits: 256 tables, 200000 rows, 64 MiB canonical bytes. A limit hit returns
  `complete: false`, `digest: null` and a reason; it is never treated as a partial match;
- BLOB/BigInt values are canonicalized (`blob:<base64>`, `bigint:<decimal>`); generated columns and
  generated-column values are read from the actual schema.

`restoreWorkflowSnapshot` accepts an optional independent `contentDigest`; a restored logical
content mismatch refuses before the report/rename. It records `database.sha256`, `content.{protocol,digest,productSchema,
complete,collections,omittedTables,reason,rows,bytes}` and the exact artifact inventory
(`id,digest,bytes`) in `restore-report.json`. The database byte digest remains an observation;
reverification uses logical content plus artifact bytes and the independent snapshot expectation.

## Reverify contract

`verifyRestoredSnapshot(targetStateDir, expected?)` checks:

1. report protocol; `report.targetPath` and `report.rootMapping.to` both resolve to this target;
   optional `expected.sourceStateRoot` must equal `report.rootMapping.from`;
2. optional independent `protocol`, `snapshotDigest`, `databaseSha256`, `evidenceDigest` and
   `contentDigest` must match the report;
3. SQLite integrity/foreign keys/schema;
4. `readWorkflowContent` must be complete and its digest must equal the report;
5. every report artifact must exist as a regular file with its recorded bytes/digest.

The result reports `basis: independent` only when the caller supplied at least one of the independent
snapshot/database/evidence/content expectations; without one it is `report_only` and must not be read
as proof against the producer subject.

An added legitimate conversation message changes the row-content digest and is refused. A replaced
or missing artifact, a rewritten root mapping, a different expected snapshot digest, an incomplete
content proof or a target from another report is refused. A read-only service startup does not
change the proof (the selected runtime tables are omitted explicitly); the dual test re-verifies
after the HTTP startup and stop.

## Other public entries

- `parseDataSubjectExpectation` / `buildDataManifest` / `verifyDataManifest` (wave-25, unchanged)
  for the original expectation/manifest and independent Node reader.
- `applyOriginalResult` (wave-25 data sink, unchanged): only an observed native/indeterminate result;
  complete tuple check, forward-only delivery, duplicate/unknown/foreign refusal. It is not a B
  transport and grants no execution.
- API types are exported from `packages/workflows/src/index.ts` and `packages/storage/src/index.ts`.

## Evidence

- `wave26-node.txt` — actual Node24 entry: 5/5 pass.
- `wave26-strict-storage.txt`, `wave26-strict-workflows.txt` — strict exit 0.
- `wave26-build-storage.txt`, `wave26-build-workflows.txt` — build exit 0.
- `wave26-workflow-tests.txt` — 120/120 via the existing tsx runner.
- `wave26-storage-tests.txt` — 88/88.
- `wave26-content-proof.txt` — durable-row change/add-table changes the digest; writer_claim and
  coordinator_instances changes do not; maxRows and a missing database return incomplete/null.
- `wave26-dual.txt` — same Store v1/v2:
  source manifest `00191204…`; content digest `9c108e07…` (138 rows, 56328 bytes) equals the
  source content proof; database SHA `e6740cf6…`; 17 artifacts; C target proof `ok` and added-message
  target proof `mismatch` for both formats.
- `wave26-original-result.txt` — duplicate/unknown/observed and eight foreign-tuple refusals,
  plus new-PID readback after close.
- `wave26-input-guards.txt` — 13 malformed/incomplete expectation variants refused.

## Not reached

- Installed/frozen D package: no package artifact in this worktree; only the source package entry
  and C's source-level target proof were exercised. Do not relabel source-only as installed.
- B actual business attach: main has not admitted it, so no live reconnect or recovered native
  result is claimed; `applyOriginalResult` remains a data-level sink.
- New F App/readiness package bytes and E's independent final acceptance are separate subjects;
  this report does not cover them.
