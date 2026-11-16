# Wave-34 A: all-kind bounded history and persistent data closure

Base `6bbbea38`; merged `origin/main` `6b306514` (`a32c89e3`). Schema 18, no migration, no candidates
table/ledger. Current main source includes `23d5a98e` native callbacks/support, but A does not claim
native/recovery authority.

## Package 1

### A1 All-kind continuation budget

`ReadIndexPort.completionHistory` now applies one serialized-envelope budget to all five kinds
(`reviews`, `verifications`, `acceptances`, `contracts`, `attempts`):

- 4 MiB covers protocol/work/project/kind/coverage metadata, every entry and top-level
  unclassified facts; max 200 rows; limit 0 is explicit.
- keyset cursor remains `{v:1,workId,projectId,kind,key}`; contracts use revision/digest, attempts
  fenceEpoch/attemptId, acceptances timestamp/id, verification/review timestamp/id; same-time IDs are
  disambiguated.
- a page that cannot fit its first entry returns `status:'blocked'`, `reason:'entry_too_large'`,
  `returned:0`, `hasMore:true`, `nextCursor:null` rather than a dead-end `hasMore` with no cursor.
- a page trimmed by budget returns `status:'ok'`, `reason:'page_budget'`, `hasMore:true` and the
  last included entry's cursor. Source `available`, returned rows and coverage remain distinct.
- live keyset semantics: rows inserted before the boundary need a fresh start; rows after the
  boundary can appear in a later page; no frozen multi-page snapshot is claimed.

`wave33-continuation.case.ts` keeps 120-row 50+50+20 unique coverage, limit 0, foreign
project/work/collection, bad cursor and adds a >4 MiB first verification: it is explicitly blocked
with no cursor.

### A2 Principal/Scope/Cursor consumer

The typed port is available for main. main owns HTTP principal/Scope checks, cursor signing/expiry
and row DTOs; A's base64 cursor is a data position, not authorization. C's current history tools
still consume the old capped WorkIndex arrays and local offset; they do not yet call this
continuation API. This remains **PARTIAL/SOURCE_READY** until main/C wire the typed port.

### A3 Canonical history and artifact content

Existing strict review classification, per-attempt historical binding/currentLink, canonical key,
unclassified reasons and original receipt relationships are retained. `wave32-persistent-two-project`
reads every original artifact through `store.artifacts.read` and re-hashes bytes/digest; a separate
Node PID reads the same Work, receipts and artifact bytes. Metadata visibility is not used as a body
permission.

## Package 2

### A4 Non-empty v1/v2 recovery

The source dual-format test creates/restores v1 and v2 from the same non-empty Store, preserving
original Work/Q&A/native_applied/source facts; C proof is `ok` for both, added-message and
emptied-inventory copies `mismatch`. The restore is data, not credential/approval transfer or writer
quiescence. Installed-package restart remains D/E.

### A5 Scale, compatibility and same-Work readback

120+ history rows, multi-ticket/multi-attempt data, held queue, Store close/reopen and new-PID
readback are exercised. Budget/limit/blocked errors leave the original Store and artifact material
intact; no compacted empty ledger or replacement Work is created. Native/live recovery is not claimed.

### A6 Main/F/C delivery

Current main project recipe 5/5 and product completion 8/8 run against the merged source. A's
continuation port is a candidate source integration; main/C HTTP/UI consumption and F display remain
to be wired. Package/install/native/E verdict are separate layers.

## Evidence

- `wave34-node.txt` 14/14; `wave34-continuation.txt`; `wave34-two-project.txt`; `wave34-dual.txt`.
- `wave34-workflow-tests.txt` 125/125; `wave34-storage-tests.txt` 88/88.
- `wave34-strict-*.txt`, `wave34-build-*.txt`, `wave34-product-strict.txt`.
- `wave34-project-recipes.txt` 5/5; `wave34-main-completion.txt` 8/8.

## Remaining

Continuation wiring into main/C HTTP/UI, installed same-instance restart (D/E with W33 `f880/46e`
and E-independent verdict), B/I live native recovery, F extraction/UI and E final verdict remain
NOT_REACHED. R1/R2 and all twelve services/state are preserved; CAC excluded.
