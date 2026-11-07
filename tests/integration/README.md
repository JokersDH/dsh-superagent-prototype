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

That command intentionally fails while the owner issues remain. It includes a disposable process-group fixture and cleans its owned processes; it never runs a vendor agent/model. A passing positive suite does not erase those failures.
