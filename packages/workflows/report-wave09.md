# Wave-09 A: read-only target inventory, source/target consumption and evidence projection

- Branch: `codex/g2-workspaces-verification`
- Main base: `531c6b6`; merge checkpoint: `73754cc`
- Runnable checkpoint: `ab6c4e1`; final source is recorded in `reports/wave09-status.json`
- Owned paths: `packages/storage/`, `packages/workflows/`
- Migrations: **none added** (schema remains v15); model tasks **0**; unknown sends **0**

## A1–A6

| Phase | Status | Evidence |
| --- | --- | --- |
| A1 read-only inventory | PASS | `recoveryTargetInventory.inspect` implements the shared port; DB/WAL copied to a private temp dir and opened readonly; complete table classification from the migration registry; stable digest; `startupAvailable: false` |
| A2 negative inventory | PASS | missing/corrupt DB, unknown table, future schema, older schema (13), symlinked root/DB, non-private root, live WAL, business residue; target dir bytes unchanged; no migration during inspection |
| A3 source/target consumption | PASS (read half) | real `RecoveryIntentCommitter` + `bindRecoveryTargetConfiguration`; inert preparation, config-digest drift refused, empty target complete, source queue/marker/facts unchanged; D materializer absent → fixture explicitly labelled |
| A4 snapshot materials | PASS | snapshot families unchanged (legacy intents + activations); D recipe creates/inventories an empty target and prints completeness/digest/business rows; no credential or activation authority in the bundle |
| A5 evidence window recipe | PASS | `evidencePage` + `projectWorkEvidence` helper; complete/caller_limit/storage_cap, partial timing, cross-work cursor refusal, cross-project rejection; source_missing vs not_in_window explicit |
| A6 regression/handoff | PASS | storage 75, workflows 56, application 20, verification 23, main decision 8, review timing 3 |

## Commands and results

```sh
./packages/storage/node_modules/.bin/tsc -p packages/storage/tsconfig.json
./packages/storage/node_modules/.bin/tsc -p packages/storage/tsconfig.build.json
./packages/storage/node_modules/.bin/tsc -p packages/workflows/tsconfig.json
./packages/storage/node_modules/.bin/tsc -p packages/workflows/tsconfig.build.json

cd packages/storage && node --test test/*.case.ts       # 75/75
cd packages/workflows && node --test test/*.case.ts     # 56/56
cd packages/application && node --test test/*.case.ts   # 20/20
cd packages/verification && node --test test/*.case.ts  # 23/23

node --test tests/integration/decision-commands.case.mjs  # 8/8 (read-only execution)
node --test tests/integration/review-timing.case.mjs      # 3/3 (read-only execution)

cd packages/workflows && node examples/d-snapshot-restore.mjs
cd packages/workflows && node examples/evidence-consumer.mjs
cd packages/workflows && node examples/evidence-benchmark.mjs
```

Evidence: `reports/wave09-storage-tests.txt`, `reports/wave09-workflow-tests.txt`,
`reports/wave09-application-regression.txt`, `reports/wave09-verification-regression.txt`,
`reports/wave09-decision-integration.txt`, `reports/wave09-review-timing.txt`,
`reports/wave09-d-snapshot-recipe.json`, `reports/wave09-evidence-recipe.json`,
`reports/wave09-performance.json`, `reports/wave09-status.json`.

Benchmark (temporary SQLite, 600 verifications/200 intents): first evidence page 8.45 ms,
all 3 pages 1.09 ms, recovery-intent page 1.08 ms. Measurements only.

## Inventory semantics

- Only `<stateRoot>/state.sqlite` and `state.sqlite-wal` are read. Both are copied to a private
  `0700` temp directory and opened readonly; `-shm` is excluded. The target directory, WAL and marker
  files are unchanged (hashed before/after in tests).
- `databaseDigest` = SHA-256 over the DB and WAL digests, accepted only when size/mtime/inode are
  stable across the read. Unstable reads report `busy_or_changed` and a null digest.
- Table classes derive from `MIGRATIONS` (validated by a coverage test); metadata tables are
  bookkeeping, FTS shadow tables are derived metadata, all others are business. Unknown tables are
  `unknown` + `unknown_table`; any business table with rows adds `business_rows_present`.
- schema 13/14/15 are classified without migration; newer/absent schema → `unsupported_schema`.
  Missing, corrupt, symlinked, non-private or partial targets are explicit issues/completeness values,
  never an empty valid target. `startupAvailable` is always false.

## A3/A4 consumption

The source side uses main's real `RecoveryIntentCommitter` (v15 facts) and
`bindRecoveryTargetConfiguration`. The binder refuses a configuration digest different from the
committed intent before any file work; the preparation is inert. An empty target created through the
product's empty-schema initialization inventories `complete`, has no business rows and
`startupAvailable: false`; source queue, restore marker and activation facts are unchanged.

D's `RecoveryTargetMaterializer` is not present in this checkout, so the target database is an
explicit fixture, not a claim of D materialization, byte identity or staging cleanup. The snapshot
recipe prints source snapshot verification plus target completeness/digest/business rows for D/E
comparison; neither family carries credentials or activation authority.

## A5 evidence windows

`projectWorkEvidence({delivered, currentAccepted, window})` maps 0025 semantics without guessing
tables: recorded only when the current accepted outcome is in the window; delivered + complete →
`source_missing`; delivered + bounded → `not_in_window`; otherwise `not_accepted`. Pagination,
partial ReviewTiming and cross-work cursor refusal are covered by tests; acceptance replay still
does not duplicate outcomes or timing.

## External gaps

- **D:** target materializer/prepare/read/discardStaging, byte identity, staging cleanup and start.
  A only inspects an existing target readonly; emptiness is not writer quiescence.
- **main:** activation commit/HTTP and authoritative start switch after re-reading source facts,
  current host/profile/resources and target bytes.
- **B/main:** physical old-writer barrier unchanged.
- **Root lock:** main-owned; no new package dependency added in this wave.
- **NOT_TESTED:** target materialization/start, process cleanup, native execution, installed-alpha,
  E acceptance and the review pilot.
