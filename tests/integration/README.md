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

## Authoritative Fact Ingress

`pnpm check:g1-ingress` builds contracts/core/effects/storage, strictly typechecks the composition module, and executes its deterministic and native SQLite ingress suites. The SQLite tests create only `review_ingress_*` fixture tables in temporary databases. They use real core, UnitOfWork, FactReceipts, EventLog and effect queue; production runtime binding/history/resources/migrations are still storage-owner work.

Tests include current/known Runner identity, full tuple, immutable kind/value payload digests, exact replay after restart/revocation, same-ID conflict, stale bindings during async payload reads, physical observations after retirement and receipt-INSERT failure rolling back core/observations/effects/event. This does not enable the runtime under review or claim full G1/IPC/native compatibility.
