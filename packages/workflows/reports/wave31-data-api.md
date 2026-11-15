# Wave-31 A: trusted history, ordinary flow and source-level recovery

Base `40626989`; merged `origin/main` `8deda18d` (`463a1378`). Schema 18, no migration, no candidates
table/ledger. The strict canonical/current separation and artifact/content-v2/FTS closures remain.

## Package 1 — trusted history

`WorkflowIndex.work().completion` now exposes:

- canonical reviews classified against their **own** historical attempt binding, with
  `bindingState` and `currentLink` (`current_attempt`/`historical_attempt`);
- `coverage` and `available` counts per ticket (`reviewCandidates`, `verifications`,
  `acceptances`) so a 50-row per-ticket return is never labelled complete when source rows exist;
- strict proposal/verification/artifact/attempt/contract/work checks and explicit unclassified
  reasons. A new current epoch changes only `currentLink`; old canonical reviews stay readable.
  ProductCompletion.current/preflight/accept remains the only current/accept authority.
- provenance through the existing Work/contract/link/verification/artifact digest/acceptance actor
  fields; no private receipt body is promoted to authoritative state.

C's `wave29-completion-facts.mjs` and `wave30-completion-history.mjs` consumers read the same reader;
the epoch+1 test records the old review as `ended`/`historical_attempt` while the current attempt is
different. No event/model/acceptance increment occurs on reads.

## Package 2 — ordinary work and source-level dual format

- Main's current J preview → original form/apply → Application/Work/check/currentCandidate/manualaccept
  flow runs 5/5 (two projects); decision revision/revocation tests run 19/19.
- Original result/unknown/duplicate/foreign behavior remains data-only; no live B/I transport is
  claimed.
- v1/v2 source snapshots are independently created, restored and verified; C proof returns `ok`
  for both, with added-message/emptied-inventory `mismatch`. Business reads remain 422 and provider/
  queue deltas are zero. Source-level recovery is not recovered native execution.

## Package 3 — same-artifact support

- D package metadata is recorded separately; `829RC` R1 source `82ee5b8f…`, build `8296720d…`, tar
  `04926739…` and R2 source `303b2c6a…` are not merged or relabelled. A did not install either.
- Main's G observation display export runs 4/4; A supplies the original Work/completion/source data
  through existing read-only ports, not a second statistics ledger.
- Fault/readback coverage uses original result duplicate/unknown/foreign, restore failure atomicity,
  artifact/content limits and cross-process readers; no signal/credential/user-instance action is
  performed.

## Evidence

- `wave31-node.txt` 12/12; `wave31-workflow-tests.txt` 123/123; `wave31-storage-tests.txt` 88/88.
- `wave31-completion.txt` — strict classification, C consumer, epoch+1 historical review, coverage.
- `wave31-dual.txt` — content `da883878…`, 138 rows / 56328 bytes / 17 artifacts; v1/v2 C proof
  `ok`, drift/emptied `mismatch`.
- `wave31-project-recipes.txt` 5/5; `wave31-main-completion.txt` 8/8; `wave31-observation-download.txt`
  4/4; `wave31-revisions.txt` 19/19.
- `wave31-strict-*.txt`, `wave31-build-*.txt`, `wave31-product-strict.txt`.

## Not reached

Installed/frozen same-package verification, B/I live attach and native recovery, F UI/extraction and
E final verdict remain separate. Source/package/installed/native/private/target/value are not merged.
