# Wave-28 A: current proof consumers and original completion facts

Base `aeeced18`; merged `origin/main` `ea82d8f` (merge `00d0498`). Schema 18, no migration, no new
table/ledger. Prior artifact inventory, `workflow-content/2`, event/message drift and the ce64
data consumer remain in force.

## Current proof and artifact API

- `parseDataSubjectExpectation`, `buildDataManifest`, `verifyDataManifest`: original
  expectation/required sets/UoW; reader accepts independent JSON and rejects unknown/incomplete sets.
- `readWorkflowContent(path, {version,limits})`: default `workflow-content/2`; legacy
  `workflow-content/1` remains reproducible for old reports. v2 uses SQLite schema metadata and
  omits only real FTS virtual/shadow tables plus `coordinator_instances`/`writer_claim`.
- `restoreWorkflowSnapshot` / `verifyRestoredSnapshot`: independent snapshot/database/evidence/
  content and exact artifact inventory; report-only and independent basis are distinct;
  `artifacts/tmp` is the only explicit storage scratch path and is not artifact content.
- `applyOriginalResult`: data-only original-ID sink; duplicate/indeterminate/foreign behavior is
  unchanged and never replaces a B/I transport.

## Original completion facts

`WorkflowIndex.work()` now returns `completion` from the **existing** original rows:

- `reviews`: bounded `command_receipts` whose stored result has a `proposal.ticketId` matching the
  ticket. These are the original ProductCompletion review receipts (`product-review-*`), not a
  candidates table or a new authority;
- `verifications`: existing `completion_verifications` rows including result bytes and verifier
  identity;
- `acceptances`: existing `completion_acceptances` rows including criterion ids and actor ref;
- the existing `verificationIds`/`acceptanceIds`/`deliverables`/timeline projections stay.

All fields are read-only data. They do not make a candidate current, do not accept, do not merge or
deploy, and do not establish that a recovered attempt is executable. The actual ProductCompletion/
verification/current-candidate/acceptance chain remains in main/application; `wave28-main-completion.txt`
records the current main controlled Product/Broker/check/accept consumer at 8/8.

## Current package subject

D's current `wave27-target-1cdab25` metadata is recorded as a package subject: source
`1cdab25a76748edad5054ce1a5150a69d5ad9361`, build `ecffaa6d3f784426`, schema 18, ABI 137, tar
`dcfda014…`, 20283738 bytes / 6759 entries. This is a D/E package; A did not install or relabel it.
The source C driver and A proof are exercised in this worktree; installed same-package consumption
remains D/E-owned and NOT_REACHED here.

## Evidence

- `wave28-node.txt` — Node24 tests 9/9 (including acceptance completion facts).
- `wave28-workflow-tests.txt` 120/120, `wave28-storage-tests.txt` 88/88.
- `wave28-strict-*.txt`, `wave28-build-*.txt`, `wave28-product-strict.txt` — exit 0.
- `wave28-dual.txt` — v1/v2 content `d60bfa2f…`, 138 rows / 56327 bytes / 17 artifacts; C wave-27
  proof `ok` independent/independent, added-message and emptied-inventory `mismatch`.
- `wave28-completion.txt` — original review/verification/acceptance facts read before/after reopen.
- `wave28-main-completion.txt` — main's actual Product/Broker/check/accept consumer 8/8.
- `wave28-content-proof.txt` — real FTS derived omission and ordinary-prefix inclusion.
- `wave28-original-result.txt` — original-ID duplicate/unknown/foreign/readback.

## Not reached

- Installed/frozen D package same-package dual-format chain (D/E).
- B/I live attach and recovered native result; A only supplies data facts.
- New F App/readiness package and E final verdict.
