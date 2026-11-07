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

To examine candidate file-format interoperability separately, use `node tools/bootstrap/check-journal-interop.mjs --runtime /clean/candidate/checkout --record`. To review its durability/integrity/receipt admission, use `node tools/bootstrap/review-journal.mjs --runtime /clean/candidate/checkout --record`; its first review failed four cases, fixed in the latest candidate below. The two reports have different scopes and cannot substitute for one another.

## Independent Runner Recovery

`pnpm check:g1-runner-link` runs 16 protocol/barrier guards and one real independent-process reconnect case. It uses private AF_UNIX HTTP with bearer authentication and pinned socket identity. A coordinator opens actual SQLite and is SIGKILLed; the independent fixture Runner and its owned child keep working. A new coordinator reconnects, cancels that original child and commits a fresh full-manifest owned-resource barrier, without another begin. The Ticket remains open. No production endpoint-registration schema or full Runner daemon is introduced.

See `docs/adr/core/g1-runner-link-handoff.md` for trust requirements and measured limits. A persisted inspection file is audit evidence, never fresh proof. A successful barrier does not itself satisfy candidate/artifact completion or remote side-effect reconciliation.

Latest owner review: B `32540a3` now passes the original four Journal cases; `review-journal-followup.mjs` records three additional failures. `review-wp04.mjs --runtime /clean/WP04/snapshot --commit SOURCE_SHA` records A's six admission failures. These scripts intentionally exit nonzero until fixed; the candidate suites passing 136 and 19 tests respectively do not waive the negative probes. Do not build/write in another agent's active worktree.

## Registered Recovery And Durable Queue

`pnpm check:g1-registered-recovery` runs **56** cases: the prior 31 plus 22 registration/recovery/queue guards and three more real SIGKILL windows. Trusted launcher registration persists in existing immutable command receipts/events. Recovery reads only that database registration; crash tests delete the original launcher handoff file. Cancel identity commits before I/O. A repeated fresh closed-inventory proof reuses the first v2 barrier receipt without new files/observations/events. Real config-change ingress now sends correctly encoded JSON to the existing Effects queue; held recovery backs off and coalesced queue generations are retained.

The new crash windows are before cancellation wire, after actual peer stop, and after committed barrier/before response. Each verifies one native start/cancel, original control receipt, actual SQLite and no false logical completion. The independent service remains a ProcessHost fixture; actual AttemptRunner daemon/vendor integration is pending. See `docs/adr/core/g1-registered-recovery-handoff.md`.

Current reviews supersede earlier failures above: A `fcf3273` passes the previous six probes and 27 owned tests (plus storage 66), but `review-completion-runtime.mjs` records two failures with a genuine main barrier and real core completion. B `74a3068` passes 148 and all seven prior probes, but `review-journal-integrity.mjs` records terminator/envelope/corrupt-prefix failures. Only B's independent ProcessHost observation file is integrated. No candidate Journal or WP-04 enablement is implied.
