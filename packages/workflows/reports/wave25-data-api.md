# Wave-25 A: manifest-driven same-package data and original-result recovery

Source: `codex/g2-workspaces-verification` at `662843e` (merged `origin/main` `11002b8`, `fdb3f16`).
Schema stays 18; this wave adds no migration and no new table/ledger.

## Public APIs

`@personal-agent/workflows` (also re-exported through `packages/workflows/src/index.ts`):

- `parseDataSubjectExpectation(value: unknown): DataSubjectExpectation` — strict runtime parser for the
  independent expectation. Unknown fields, bad IDs/digests, bad snapshot format and empty required sets
  are refused before any store read.
- `buildDataManifest(store, expectation)` — reads binding/current/question/answer/deliveries/commands/
  dispatch/observations/payloads in one synchronous UoW, then bounded payload bytes outside it.
- `verifyDataManifest(store, manifest, unknownExpectation)` — re-parses the expectation, checks the
  manifest digest, rebuilds from the same store and requires exact canonical equality.
- `restoreWorkflowSnapshot(options)` — verified restore of a `workflow-snapshot/1|2` directory into a new
  state root. Re-hashes `product.sqlite` and every `artifacts/<id>` against `snapshot.json`, re-reads
  `workflow-evidence/1|2` from the restored database with the manifest's recipe, then writes
  `restore-report.json` and atomically renames the staging directory.
- `verifyRestoredSnapshot(targetStateDir)` — read-only re-verification that a root still matches its own
  report (target identity, integrity, foreign keys, schema).
- `applyOriginalResult(store, input)` — data-level sink for an already observed native/indeterminate
  result. Re-reads the complete original attempt/ticket/assignment/contract/epoch/question/answer/target
  tuple in one UoW, delegates to the existing forward-only `answers.upsertDelivery`, and returns
  `applied | duplicate | refused`. It never sends, never creates a command receipt, and never turns
  `indeterminate` into success.

`DataSubjectExpectation` fields: `sourceSha`, `snapshotFormat`, optional `dataRoot`, `ticketId`,
`assignmentId`, `attemptId`, `fenceEpoch`, `contract`, `questionId`, `answerId`,
`requiredCommandIds`, `requiredDispatch`, `requiredDeliveryTargets`, optional
`requiredObservationFactIds`, optional `limits`.

## Restore boundaries

- Snapshot and target must be absolute, different directories; the target must be new or empty.
- Independent expectations may pin `protocol`, manifest digest, database SHA-256 and evidence digest.
  A mismatch refuses before a target byte is written.
- An incomplete snapshot, missing/corrupt artifact, wrong artifact digest/size, newer schema, failed
  integrity/foreign-key check or evidence recipe mismatch refuses with `status: blocked`.
- `restore-report.json` binds: snapshot format/digest/createdAt, database SHA-256/bytes, artifact count,
  restored integrity/foreignKeys/schema/event cursor, evidence protocol/digest/family count, logical
  source digest, optional source→target root mapping, pending project rebind and revalidation limits.
- The report is data. It grants no execution, recovery start or human acceptance, and it does not
  claim that the original physical writer has stopped.

## Bounds

- Manifest: 64 commands, 64 dispatch entries, 256 observations, 128 payloads, 1 MiB per payload,
  4 MiB total payload bytes (`DEFAULT_DATA_MANIFEST_LIMITS`).
- Restore: 8 MiB manifest, 512 MiB database, 512 MiB per artifact (`RESTORE_LIMITS`).
- Result evidence: bounded string (1024 chars); no credential or execution grant is accepted.

## Evidence

- `wave25-workflow-tests.txt` — 120/120 pass.
- `wave25-storage-tests.txt` — 87/87 pass.
- `wave25-dual.txt` — one real Store, default v1 and explicit v2: verified restore, same-package
  personal readonly reads (candidates/history/Work/Q&A/delivery/sources), C driver build+verify per
  format, and a different-Node-PID manifest readback of each restored root.
- `wave25-input-guards.txt` — 13 malformed/incomplete expectation variants refused by the runtime parser.
- `wave25-original-result.txt` — original tuple duplicate, unknown preservation, later observed result,
  eight foreign-tuple refusals, and a new-PID readback after close.
- `wave25-reader.txt` — independent-Node reader plus C driver build/verify (
  manifest `fe655219…`, reader PID 99070).
- `wave25-c-driver.txt` — earlier A→C driver invocation retained for reference.

## Not reached

- A8 installed-package tier: no D/E frozen tar exists in this worktree; only the source package entry
  was exercised. Installed PASS must not be inferred.
- A9/A12 B transport/reconnect: main has not admitted a B actual business attach. The A sink is
  data-level and is marked controlled-fixture evidence; no live business reconnect, native send or
  recovered result is claimed.
- D/E package/hash/build/schema/ABI/mode binding and E assertions remain owned by D/E.
