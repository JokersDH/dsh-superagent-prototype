# Wave-36 A: whole-subsystem history and recovery data closures

Base `eac2c9d8`; merged `origin/main` `7e550991` (`2e4c1110`). Schema 18, no migration, no candidates
table/ledger. Status: **SOURCE_READY**, not installed. The four closures map the old nine outcomes,
not twelve new phases.

## Closure 1 — official history to original artifacts

**A1 exact budget.** `completionHistory` now computes the *final encoded* page (status/reason/
returned/hasMore/nextCursor/coverage, entries and unclassified/omission) against 4 MiB for all five
kinds. A 205×22 KiB stress page returns 187 entries at 4,193,837/4,194,304 bytes with cursor; an
oversized first entry returns blocked/entry_too_large with no dead-end cursor; budget trim returns
page_budget. Synchronous parse/accept bounds are not a preemptible JS SLA.

**A2 default consumer.** main 0092 `ProductCompletionHistory` now actually consumes A's
`completionHistory` through HMAC-scoped cursor, strict three-kind metadata (contracts/verifications/
acceptances), principal/Scope/current-contract fences and recovery readonly. main's
`completion-history.case.mjs` runs 4/4: 65 metadata records across pages, auth/injected/repeated
queries, cursor identity/expiry, oversized-first blocked, corrupt/non-progress producer refused.

**A3 artifacts.** Two-project real runtime writes original Work/contract/candidate/artifact/receipt;
reopen + `ArtifactStore.read` rehashes bytes/digest and a separate Node PID reads the same objects.
Metadata visibility is not body permission; strict canonical/history/current separation remains.

## Closure 2 — authorized non-empty v1/v2 recovery

Source v1/v2 snapshots from one non-empty Store restore to independent roots with content/inventory
and root mapping; C proof `ok` for both, added-message/emptied-inventory `mismatch`; original Q&A/
native_applied/source/historical IDs remain. Held queue/provider/readonly semantics remain; no
credential/old approval/writer-quiescence is transferred. Installed/current-authorized restart is D/E
and NOT_REACHED.

## Closure 3 — multi-project query and fault readback

Existing project/conversation/Work/search/evidence/artifact readers plus bounded history form the
daily query path. 120+ rows, multi-ticket/attempt, exact budget, blocked pages, bad cursor/subject,
store reopen, held queue and new-PID readback are covered. Main/F full multi-page query UI and
multi-project integration remain PARTIAL; no read consumes queue/events/acceptance or creates a new
Work.

## Closure 4 — modules, default product and same-version handoff

`packages/storage/src/index.ts` exports the needed completion/history types and helper;
`packages/workflows/src/ports.ts` exposes `completionHistory` without importing content-proof or
replacing main's recoverySource. Strict/build, main product strict, main history/recipe/completion
consumers pass. Package/install/native/E verdict and the model/D/B/C/I queues are separate layers.

## Evidence

- `wave36-node.txt` 14/14; `wave36-continuation.txt` exact budget; `wave36-two-project.txt`;
  `wave36-dual.txt`.
- `wave36-workflow-tests.txt` 125/125; `wave36-storage-tests.txt` 88/88.
- `wave36-main-history.txt` 4/4; `wave36-project-recipes.txt` 5/5; `wave36-main-completion.txt` 8/8.
- `wave36-strict-*.txt`, `wave36-build-*.txt`, `wave36-product-strict.txt`.

## Remaining

D/E installed same-instance restart and independent E verdict; main/F multi-project history UI;
B/I live native recovery; support/model configuration are main-owned and already present as separate
source. R1/R2/W33 identities preserved; twelve services/state untouched; CAC excluded.
