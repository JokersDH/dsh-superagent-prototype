# Wave-33 A: production history continuation and non-empty data reopen

Base `a9ae5cd1`; merged `origin/main` `e05ee8d8` (`8c85afc8`). Schema 18, no migration, no
candidates table/ledger. Status: **SOURCE_READY**, not installed.

## Outcome 1 — bounded keyset continuation

`ReadIndexPort.completionHistory` / `WorkflowIndex.completionHistory` provides stable pages over
existing facts:

```
{ workId, projectIds:[oneProject], kind: reviews|verifications|acceptances|contracts|attempts,
  limit: 0..200, cursor? }
=> { protocol:'completion-history/1', returned, available, hasMore, nextCursor, coverage, entries, limits }
```

- cursor is base64url of `{v:1,workId,projectId,kind,key}`; wrong work/project/kind/version is
  refused, so a page cannot switch subject or collection;
- verifications/acceptances use timestamp+id keyset ordering with id tie-break; contracts use
  revision+digest; attempts use fenceEpoch+attemptId; newly inserted rows before the keyset boundary
  are not duplicated and are not silently inserted into an existing page; restart without cursor is
  a fresh snapshot;
- `available` is an indexed count for the exact subject/collection, `returned` is this page,
  `coverage` is `complete`/`truncated`; `limit=0` is explicit (0 returned, hasMore when source
  exists, no cursor). The page has a 4 MiB JSON budget and 200-row max.
- reviews are classified by the existing strict canonical/per-attempt-history rules; unclassified
  entries are returned, never filtered into a valid review.

Test: `wave33-continuation.case.ts` creates 120 verifications at two timestamps, reads 50+50+20
unique rows, checks tie ordering, limit 0, foreign work/project, bad cursor and wrong collection.
The old WorkIndex `completion` capped arrays remain compatible and are not relabelled complete.

## Outcome 2 — main/C consumer compatibility

C's `wave30-completion-history.mjs`/`wave31-completion-history.mjs` still consume the old per-ticket
capped arrays and local offset; they correctly show source truncation but do not call the new
continuation API. Main's product TypeScript consumer compiles. A's new continuation port is ready
for C/main wiring; no HTTP cursor signing, principal gate or UI is implemented by A. This outcome is
therefore source-ready/partial, not an installed or fully integrated consumer claim.

## Outcome 3 — non-empty original data and artifact bytes reopen

`wave32-persistent-two-project.case.ts` (now rerun under wave33) uses current main product runtime to
complete two original projects through preview/create/question/check/currentCandidate/manualaccept,
closes Store/product, reopens the same SQLite state, and reads:

- distinct Work IDs, contract digests, canonical reviews, verification/artifact digest and command
  receipts (`wave33-two-project.txt`);
- every original artifact through `store.artifacts.read`: bytes length, recorded digest and SHA-256
  agree; a different Node PID (`wave33-project-reader.mjs`) reads the same Work, receipts and
  artifact bytes after reopen;
- the held queue row survives; no fixture project/new Work substitutes for the original IDs.

Source-level v1/v2 restore/proof remains separately exercised in `wave33-dual.txt`. This is not an
installed instance restart, recovered native execution or final E verdict.

## Evidence

- `wave33-node.txt` 14/14; `wave33-continuation.txt`; `wave33-two-project.txt`.
- `wave33-workflow-tests.txt` 125/125; `wave33-storage-tests.txt` 88/88.
- `wave33-strict-*.txt`, `wave33-build-*.txt`, `wave33-product-strict.txt`.
- `wave33-project-recipes.txt` 5/5; `wave33-main-completion.txt` 8/8.

## Remaining

Installed same-instance restart (R1 `829RC` source `82ee5b8f…`, build `8296720d…`, tar `04926739…`;
R2 source `303b2c6a`, no frozen successor claimed), continuation wiring in main/C HTTP/UI, B/I live
native recovery, F extraction and E final verdict remain NOT_REACHED. CAC excluded.
