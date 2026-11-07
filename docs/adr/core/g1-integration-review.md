# G1 Integration Review: Domain Binding Pass, Runtime Admission Blocked

Date: 2026-11-07. A source: `8a02f02`; B source: `b4111ed`. Neither active worktree was modified; reviews used clean independent checkouts.

Later review update: the seven original reproductions below now pass on A's first fixes and B `d213d94`. New follow-up cases and the implemented fact ingress are tracked in [g1-ingress-handoff.md](g1-ingress-handoff.md); overall G1 remains pending. The original findings are retained as version-scoped history.

## Verdict

**The main-agent core/SQLite domain adapter is accepted. Whole WP-02, WP-03 and G1 remain unaccepted.** A/B branch code has not been merged into main as production-ready implementation; the reviewed inputs remain on their public feature branches.

Independent positive results:

| Surface | Actual result |
| --- | --- |
| A storage | 34/34, typecheck and build pass |
| A effects | 8/8, build pass |
| B first-batch runtime | 63/63 on target Node 24.22.2 |
| Main structural binding vs actual ProductStore types | Strict TypeScript check passes |
| Main core suite over actual SQLite DomainStore | 178/178 on Node 24.22.2, including all original 144 tests unchanged |

This resolves WP-02 RFC-01 without a second domain-model package. Main's `apps/coordinator/main.ts` is a repository adapter, not a daemon, Source/Policy, HTTP interface or production startup path. It preserves complete aggregate JSON, uses the same UnitOfWork and rejects a native async core callback before invoking it.

## Reproduced Blocking Failures

`tools/bootstrap/review-g1-repros.mjs` runs intentionally separate from passing core checks and currently exits 1. The result is recorded in `reports/releases/g1-review-repros.json`:

| Case | Observed failure |
| --- | --- |
| A-LOCK-INITIALIZATION | A second instance acquired a lock whose first owner had created the still-empty file |
| A-ASYNC-TRANSACTION | Async callback failure left one row committed |
| B-FROZEN-COMMAND | Generated begin omitted contract and failed frozen RunnerCommandSchema; initial input used the policy snapshot ref |
| B-ASSIGNMENT-FENCE | Wrong Assignment with the same attempt/epoch was accepted |
| B-COMMAND-IDENTITY | Different deliver inputs produced the same command ID |
| B-UNKNOWN-STOP | Missing handle became ended/indeterminate, then a repeated stop became confirmed |
| B-PROCESS-GROUP | Parent exit produced confirmed while a same-group descendant was still active (`ps` state S) |

The process fixture owned and cleaned its disposable group. The passing MAIN-SYNC-BRIDGE case confirms the adapter's own native-async preflight; it does not fix the storage package's direct transaction API.

## RFC Decisions And Ownership

The detailed resolutions are in `g1-rfc-resolutions.md`. Keep frozen v1 payload ports and require the existing strict kind/value envelope at authoritative ingress; immutable fact ID/body conflicts do not need a replacement generation. The composition bridge owns full runtime binding/epoch validation, core owns Assignment lifecycle, and all state/receipt/effect changes must use the same transaction. Production runtime binding/lease tables stay with the storage migration owner.

Fix instructions: `agent-tasks/g1-agent-a-review.md` and `agent-tasks/g1-agent-b-review.md`. Owners keep their branches and paths, add the negative cases, rerun old suites, and push new commits. Main will review those specific revisions before enabling coordinator startup/retry resource reuse. Do not silently convert a positive module suite into acceptance of the failed invariants.

## Reproduction And Remaining Work

See `tests/integration/README.md`. The positive SQLite suite still uses the original fake Executor/Outbox callbacks, so it is not atomic durable outbox/dispatch or actual process recovery evidence. The unaccepted runtime path is not wired into an application to hide the failures.

After owner fixes: repeat negatives, run the actual storage/controlled-runner bridge, persist authoritative runtime bindings and immutable payloads, then validate stale facts, duplicate receipts, logical stop versus physical quiescence and restart. Real native Drivers, QuestionBroker, verifier, UI and release tests remain later packages.
