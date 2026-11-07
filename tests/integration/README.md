# Core / SQLite Review Harness

`apps/coordinator/main.ts` binds the public core Repositories to structural storage ports. It contains no separate domain types, SQL schema, daemon or native launch path. This adapter addresses WP-02 RFC-01.

The setup substitutes the original test harness's MemoryRepositories with a native SQLite ProductStore through that adapter, preserving every upstream test byte. The same suite also exercises personal completion metadata/rollback/readiness on real SQLite. Temporary files/connections are cleaned after each test.

To reproduce before storage acceptance, use a clean checkout of the reviewed public storage branch and its independent dependencies:

```sh
# In the storage review checkout, which currently predates the shared workspace:
pnpm --dir packages/contracts install --ignore-workspace --frozen-lockfile
pnpm --dir packages/contracts build
pnpm --dir packages/effects install --ignore-workspace --frozen-lockfile
pnpm --dir packages/effects build
pnpm --dir packages/storage install --frozen-lockfile
pnpm --dir packages/storage build

# In main, after the contracts/core workspace has been checked/built:
node tools/bootstrap/check-core-sqlite.mjs --storage /absolute/path/to/storage-review-checkout --record
```

The public branch is `origin/codex/g1-storage-effects`; the reviewed source commit is recorded in the JSON result. Do not run build/rewrite steps in another agent's active worktree.

This is **domain storage parity**, not full coordinator integration. The original tests still use fake Executor/Outbox callbacks. Writer-lock takeover, async transaction enforcement, production runtime tables, persisted payloads and physical stop are separate requirements. Review negative cases with:

```sh
node tools/bootstrap/review-g1-repros.mjs --storage /absolute/storage-review --runtime /absolute/runtime-review --record
```

The original negative cases now pass against A's first fixes and B `d213d94`; the original report is version-scoped. The additional edge cases are captured separately:

```sh
node tools/bootstrap/review-g1-followup.mjs --storage /absolute/storage-review --runtime /absolute/runtime-review --record
```

That command intentionally fails while the follow-up issues remain. The process-group review fixture cleans its owned resources; it never runs a vendor agent/model. A passing positive suite does not erase new safety failures.

The follow-up suite now passes on A `a8d7f10` and B `40ae102`; its report records those exact reviewed inputs. Future failures must stay visible rather than being overwritten with an earlier passing revision's result.

## Authoritative Fact Ingress

`pnpm check:g1-ingress` builds contracts/core/effects/storage, strictly typechecks the composition module, and executes its deterministic and native SQLite ingress suites. The SQLite tests create only `review_ingress_*` fixture tables in temporary databases. They use real core, UnitOfWork, FactReceipts, EventLog and effect queue; production runtime binding/history/resources/migrations are still storage-owner work.

Tests include current/known Runner identity, full tuple, immutable kind/value payload digests, exact replay after restart/revocation, same-ID conflict, stale bindings during async payload reads, physical observations after retirement and receipt-INSERT failure rolling back core/observations/effects/event. This does not enable the runtime under review or claim full G1/IPC/native compatibility.

## Actual Production Repositories And Controlled Child

`pnpm check:g1-production` builds the actual product packages, strictly typechecks runtime source/tests, and runs `production-runtime.case.mjs`. It connects a disposable real fake-Agent process through Runner/Supervisor and the strict bound ingress to actual binding history, content-addressed payloads, event/fact receipts and core. No `review_ingress_*` schema is used in this suite.

Five cases cover fact ACK/reopen/no duplicate begin, logical-stop-before-physical-cleanup with late exit retention, atomic config-drift candidate invalidation/hold/reconcile, rollback on the final receipt write, and current policy revocation despite an enabled contract. Initial intake/resource registration/prepared policy are explicit fixtures; this is not vendor permission proof or complete G1 crash recovery. See the production handoff for pending owner tasks.

## Fact Recovery

`pnpm check:g1-recovery` runs the five production cases, seven recovery cases and two real SIGKILL windows. The recovery worker uses one real fake-Agent child, a synced test decoder snapshot and actual SQLite. Restoring missing payloads precedes authoritative record admission; no second begin is issued. The tests explicitly do not certify the candidate Journal writer or reconnect to an independent live Runner.

To examine candidate file-format interoperability separately, use `node tools/bootstrap/check-journal-interop.mjs --runtime /clean/candidate/checkout --record`. To review its durability/integrity/receipt admission, use `node tools/bootstrap/review-journal.mjs --runtime /clean/candidate/checkout --record`; this currently exits nonzero for four owner fixes. The two reports have different scopes and cannot substitute for one another.
