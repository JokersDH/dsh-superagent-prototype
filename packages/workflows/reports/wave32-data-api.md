# Wave-32 A: ordinary two-project history and persistent reopen data closure

Base `02dc4aa8`; merged `origin/main` `58b4e4c8`. Schema 18, no migration, no candidates table/ledger.
Status: **SOURCE_READY**, not installed. Same-installed-instance restart is still the remaining
integration item.

## Data closure

- `WorkflowIndex.work().completion` keeps strict canonical reviews, per-attempt historical binding,
  `bindingState`, `currentLink`, unclassified reasons, per-ticket coverage and source `available`
  counts. A historical review is not current eligibility; ProductCompletion.current/preflight/accept
  remains the authority.
- Existing Work/contract/revision/link/verification/artifact digest/acceptance/receipt/source
  provenance is linked through the public index. Missing coverage is `unknown`/`truncated`, never a
  complete zero.
- The API is read-only and in the candidate branch; no shared root/contracts/HTTP/UI is edited.

## Actual two-project persistent consumer

`wave32-persistent-two-project.case.ts` uses the **current main product runtime** (not a hand-written
terminal state):

1. creates two original nonempty projects/registries;
2. runs the current project recipe preview → original create Work → question/check →
   currentCandidate → explicit accept for each project;
3. captures distinct Work IDs, contract digests, candidate/artifact/review/verification IDs and the
   create/accept command receipts;
4. closes the product and Store, reopens the same state.sqlite file;
5. reads each Work through the public WorkIndex/completion reader and C's
   `wave30-completion-history.mjs`, and confirms the held queue row is still present.

The two projects remain isolated by project/Work IDs; no fixture project or new Work is substituted
for a recovery. The test state root is a real persistent SQLite state directory, but it is **not a
package-installed instance**; installed-package restart is not claimed.

## Evidence

- `wave32-two-project.txt` — two original projects, distinct contracts, reviews/verifications,
  receipts and held queue after reopen; C history consumer per project.
- `wave32-node.txt` 13/13; `wave32-workflow-tests.txt` 124/124; `wave32-storage-tests.txt` 88/88.
- `wave32-strict-*.txt`, `wave32-build-*.txt`, `wave32-product-strict.txt`.
- `wave32-project-recipes.txt` 5/5, `wave32-main-completion.txt` 8/8 for current main consumers.
- `wave32-completion.txt`, `wave32-dual.txt` retain strict historical/current separation and
  source-level v1/v2 proof.

## Remaining

- Installed same-instance restart with the exact R1 `829RC` (source `82ee5b8f…`, build `8296720d…`,
  tar `04926739…`) or an R2 successor: D/E-owned; A cannot install or certify from source alone.
- B/I live native recovery, F UI/extraction, E final verdict and CAC remain separate NOT_REACHED.
- The ordinary data closure is ready for main/C consumers; source-only is not an installed release.
