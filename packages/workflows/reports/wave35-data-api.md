# Wave-35 A: exact bounded history and persistent data product

Base `49082c5b`; merged `origin/main` `5860da13` (`555f65f7`). Schema 18, no migration, no candidates
table/ledger. Status: **SOURCE_READY**, not installed; main/C history UI wiring remains pending.

## Package 1

### A1 exact final-envelope reader

The 4 MiB budget in `completionHistory` is now applied to the **final serialized page** including
status/reason/returned/hasMore/nextCursor/coverage, every entry and top-level unclassified facts:

- an entry that alone cannot fit returns `status:blocked`, `reason:entry_too_large`, returned 0,
  `hasMore:true`, `nextCursor:null`;
- a page trimmed by budget returns `status:ok`, `reason:page_budget`, last included cursor and
  explicit `omittedUnclassifiedReviews` when unclassified bodies had to be omitted;
- all five kinds share the same accounting; 120-row 50+50+20 path remains; a 205×22KB stress page
  returns 187 entries, exactly 4,193,837 bytes <= 4,194,304, with a cursor.

Deadline/parse limits are honest synchronous acceptance budgets, not a claim of preemptible JS SLA.
Keyset remains live; rows before the boundary need a fresh start, rows after may enter a later page.

### A2 main-authorized history consumer

The typed `ReadIndexPort.completionHistory` is available, with project/work/kind/context binding.
main owns principal/Scope checks, signed HTTP cursor and row DTO; A's base64 cursor is not authority.
C's current history tools still read capped WorkIndex arrays; main/C multi-page integration is
**PARTIAL/SOURCE_READY**.

### A3 canonical history and original artifact content

Strict canonical review classification, per-attempt historical binding/currentLink, receipts and
verification relationships remain. The two-project test reads every original artifact through
`ArtifactStore.read` and re-hashes bytes/digest; a different Node PID reads the same Work, receipts
and artifact bytes after reopen. Metadata visibility is not body permission.

## Package 2

### A4 non-empty v1/v2 recovery

Same non-empty Store produces/restores v1 and v2; C target proof `ok`, added-message and
emptied-inventory `mismatch`; original Q&A/native_applied/source and held state remain. Source
restore does not copy credentials, old approval or physical writer proof.

### A5 original-ID reopen and receipts

Store close/reopen preserves two original projects, distinct Work/contracts/reviews/verifications,
create/accept receipts and held queue; new-PID reader returns original Work and artifact bytes.

### A6 scale/compatibility/fault

120+ history rows, multi-ticket/attempt, oversized first entry, budget trim, bad cursor/subject and
reopen are finite; blocked pages retain original data and do not create replacement Work/ledger.

## Package 3

### A7–A9 daily query/module/delivery

Existing WorkIndex/projects/conversations/search/evidence and artifact readers remain the query
closure; exports/strict/build pass. Current main project-recipes 5/5 and Product/Broker/check/accept
8/8 run, but main/F/C multi-page history UI and default integration are not wired. Package,
installed, native and E verdict remain separate.

## Evidence

- `wave35-node.txt` 14/14; `wave35-continuation.txt` exact budget; `wave35-two-project.txt`;
  `wave35-dual.txt`.
- `wave35-workflow-tests.txt` 125/125; `wave35-storage-tests.txt` 88/88.
- `wave35-strict-*.txt`, `wave35-build-*.txt`, `wave35-product-strict.txt`.
- `wave35-project-recipes.txt` 5/5; `wave35-main-completion.txt` 8/8.

## Remaining

main/C signed HTTP cursor + principal/Scope + history UI, D/E installed same-instance restart and
E independent verdict, B/I live native recovery, F extraction and CAC remain NOT_REACHED. Twelve
services/state and R1/R2/W33 identities are preserved.
