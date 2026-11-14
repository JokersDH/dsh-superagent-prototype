# Wave-27 A: independent content closure and complete recovery data tools

Base: `06390ae` plus merge of `origin/main` `ca01e17` (`0aaa791`). Schema 18; no migration, no new
ledger, no second confirmation authority.

## Artifact inventory closure

`RestoreExpectation.artifacts` and `VerifyRestoredExpectation.artifacts` are an exact independent
inventory (`id`, `digest`, `bytes`). `restoreWorkflowSnapshot` compares it with the original snapshot
manifest before copying; `verifyRestoredSnapshot` compares it with both the report inventory and the
target directory. The rules are:

- ids are unique, safe artifact ids, digests are 64-hex, bytes are non-negative safe integers;
  per-file bytes, cumulative bytes and count are bounded; duplicate/foreign/oversized entries refuse;
- `report.snapshot.artifacts` must equal `report.artifacts.length`; report and independent inventory
  must match exactly, so emptying or deleting one report entry cannot pass an independent check;
- target `artifacts/` may contain only the required ids plus the storage-owned `tmp` scratch
  directory; an extra file, missing file, symlink/non-regular entry, size change or digest change
  refuses. `tmp` is not an artifact row and is never content evidence;
- an empty inventory is valid only when the independent original inventory is truly empty; the
  target is then required to have no artifact entries.

A real restored root has 17 artifacts. The test deletes a real file and empties `report.artifacts`
and `report.snapshot.artifacts`; independent verification still refuses because the expected
inventory is non-empty. C's wave-27 target proof receives the same inventory and also reports
`mismatch`.

## Content proof versions

- `workflow-content/1` is the wave-26 recipe and remains reproducible for already-recorded reports:
  it skips tables by the `conversation_search` name prefix.
- `workflow-content/2` is the current producer. It uses `PRAGMA table_list` plus `sqlite_master`
  SQL: only a real `USING fts4/fts5` virtual table and its actual `shadow` tables are derived and
  omitted. An ordinary table such as `conversation_search_private_audit` is included and changes the
  digest. Unknown virtual/shadow tables, or missing schema metadata, return `complete: false` and
  `digest: null` instead of silently skipping bytes.
- Both versions explicitly omit only `coordinator_instances` and `writer_claim` (root-local runtime
  presence/ownership), plus the actual FTS root/shadow names. Omitted names, schema, protocol and
  limits are bound into the digest header. Omission is not writer-quiescence proof.
- `restore.report.content.protocol` selects the exact recipe when verifying; a report with an
  unknown protocol refuses. `verifyRestoredSnapshot` reports `basis: independent` only when the
  caller supplied both independent content identity and independent artifact inventory; otherwise
  it is `report_only`.

## Public entries and limits

- `readWorkflowContent(path, { version, limits })`; default version 2; tables 256, rows 200000,
  canonical bytes 64 MiB.
- `restoreWorkflowSnapshot` artifacts: max 4096, 512 MiB per file, 2 GiB cumulative; manifest 8 MiB,
  database 512 MiB.
- `verifyRestoredSnapshot(target, expected)` accepts `sourceStateRoot`, `protocol`, `snapshotDigest`,
  `databaseSha256`, `evidenceDigest`, `contentDigest` and `artifacts`.
- `buildDataManifest`/`verifyDataManifest`/`parseDataSubjectExpectation` and `applyOriginalResult`
  retain their wave-25/26 scope; the latter remains a data sink, not a B transport.

## Evidence

- `wave27-node.txt` — actual Node24 entry: 5/5.
- `wave27-workflow-tests.txt` 120/120, `wave27-storage-tests.txt` 88/88.
- `wave27-strict-*.txt`, `wave27-build-*.txt`, `wave27-product-strict.txt` — exit 0.
- `wave27-dual.txt` — source manifest `e0acaae2…`; content `c341e3d0…` (workflow-content/2, 138 rows,
  56328 bytes, 17 artifacts), v1/v2 source snapshots `885eef82…`/`6adab7ad…`; C wave-27 proof
  independent/independent `ok` for both, added-message and emptied-inventory copies `mismatch`.
- `wave27-content-proof.txt` — real FTS derived rows ignored, ordinary same-prefix table included;
  runtime tables omitted; maxRows/missing DB incomplete.
- `wave27-original-result.txt` — original-ID duplicate, unknown, observed and eight foreign
  refusals plus new-PID readback.

## Not reached

- Installed/frozen D package same-package chain: the A worktree has no admitted package; C's source
  driver and A's source restore proof were exercised. Do not infer installed PASS.
- B/I live attach and recovered native result: not admitted; `applyOriginalResult` remains data-only.
- New F App/readiness package bytes and E final assertion are separate subjects.
