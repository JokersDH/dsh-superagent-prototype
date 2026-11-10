# Wave-05 A delivery: routing/review/outcome evidence

- Branch: `codex/g2-workspaces-verification`
- Main base: `a70db20`; merge checkpoint: `c0b8316`
- A1 stable checkpoint: `f26f2eb`; delivery source: `1bd0996`
- Owned paths: `packages/storage/`, `packages/workflows/`
- Model tasks: **0**; unknown sends: **0**. All tests use temporary SQLite state.

## Phase results

| Phase | Result | Evidence |
| --- | --- | --- |
| A1 immutable RoutingEvidencePort | PASS package-local | v13 `route_advice`/`review_evidence`/`execution_outcome`, shared parsers, replay/conflict, transactional rollback |
| A2 bounded scoped indexes | PASS package-local | project-scoped advice/review/outcome pages, exact subject/profile filters, stable cursors, no empty-global scope |
| A3 outcome source projection | PASS package-local | binding/verification/acceptance/observation sources; missing usage stays unknown; no artifact ownership inference |
| A4 timeline and snapshot | PASS package-local | bounded single-work evidence timeline with optional ReviewTiming; review report artifact refs checked against backup registry; missing/corrupt/IO blocked |
| A5 migration/consumer | PASS package-local with C gap | v12→v13 preserves old rows; second Node process reads records; C routing module and main HTTP/UI composition are not present/wired |

## Commands and results

```sh
./packages/storage/node_modules/.bin/tsc -p packages/storage/tsconfig.json       # PASS
./packages/storage/node_modules/.bin/tsc -p packages/storage/tsconfig.build.json
./packages/storage/node_modules/.bin/tsc -p packages/workflows/tsconfig.json    # PASS
./packages/storage/node_modules/.bin/tsc -p packages/workflows/tsconfig.build.json

cd packages/storage && node --test test/*.case.ts       # 75/75
cd packages/workflows && node --test test/*.case.ts     # 21/21
cd packages/application && node --test test/*.case.ts   # 16/16
cd packages/verification && node --test test/*.case.ts  # 23/23
cd packages/workflows && node examples/routing-benchmark.mjs
```

Benchmark (darwin/arm64, temporary SQLite, fixed dataset 500 advice/100 reviews/200 outcomes):
seed 94.33 ms; advice page 0.30 ms, review subject page 0.25 ms, outcome profile page 0.16 ms.
These are measurements, not thresholds.

Evidence:
`reports/wave05-storage-tests.txt`, `reports/wave05-workflow-tests.txt`,
`reports/wave05-application-regression.txt`, `reports/wave05-verification-regression.txt`,
`reports/wave05-performance.json`, `reports/wave05-status.json`.

## Implemented interface

`createWorkflowPorts(store).routingEvidence` is the shared synchronous `RoutingEvidencePort`:

- advice: `put/get/list` with project/time cursor and expiry/evidence fields preserved;
- reviews: `put/get/list` with exact canonical `ReviewSubject` filter; sealed-copy and legacy native
  read-only isolation are stored exactly as the shared parser accepts them;
- outcomes: `put/get/list` with exact `ExecutionProfileRef` filter; accepted outcomes retain their
  candidate/artifact/verification/acceptance/evidence references; missing usage is `unknown`;
- `sources(attemptId, projectId)` returns existing binding, verification, acceptance and runtime
  observation facts without asserting artifact ownership or a trusted stop;
- `timeline` links work/contract/link/question/verification/acceptance/runtime/review/outcome facts
  in bounded time order and includes optional ReviewTiming data; it does not claim causality.

All writes join the caller's UnitOfWork; the test injects failure after a write and verifies the rows,
events and receipts roll back together. Records are immutable; same ID + complete body replays, any
changed body conflicts.

## Migration

v13 `routing-evidence` is appended after v1–v12. Existing v12 works, contracts, authorizations,
decisions, deliveries and artifacts are not rewritten; the v12→v13 test keeps an old contract,
current authority and completion verification readable. No new runtime dependency or root-lock
request is needed.

## Snapshot and trust boundary

`WorkflowSnapshots` still creates a new SQLite online backup, reads artifact references from that
backup, copies and digest-verifies artifact bytes, and writes an atomic manifest. It now also collects
`review_evidence.report_artifact_ref` references; an absent report artifact makes the snapshot
blocked/incomplete. A control/protocol/schema fixture remains a declared layer, never native training
data. Review reports do not become verification PASS or human acceptance.

## Blockers / NOT_TESTED

- C's real routing module and its prepare/commit consumer are not present in this checkout; A's port is
  fixture-verified and must be consumed from `createWorkflowPorts(store).routingEvidence` without SQL
  or a second writer.
- Main HTTP/UI advice/confirm/review surfaces and the E pilot are not implemented by A; native
  execution, model calls, browser/product acceptance and large-sample benefit are NOT_TESTED.
- ReviewTiming is persisted as an outcome field and shown in the timeline when present; A does not
  synthesize accepted events, zero active time, or a second candidate/acceptance record.
