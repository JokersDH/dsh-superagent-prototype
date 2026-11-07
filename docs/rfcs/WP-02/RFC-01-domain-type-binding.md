# RFC-01: Core domain type binding (WP-02 → WP-01) — RESOLVED

- Status: **resolved** (main agent's G1 RFC resolution, 2026-11-07)
- From: WP-02 (Agent A)
- To: WP-01 (main agent, `packages/orchestrator-core/`)
- Related acceptance: DATA-02, DATA-04, CORE-01

## Resolution

The main agent resolved this without a second domain-model package. The formal core
(`packages/orchestrator-core`) owns `Repositories`, `Ticket`, `Thread`, `Trigger`, `Decision`, and
`TriggerDisposition`. The composition root (`apps/coordinator/main.ts`, main-agent integration)
maps them to `DomainStore`'s generic JSON methods over the same `UnitOfWork`; storage's
`DomainStore` remains generic and defines no parallel domain types.

`packages/storage/test/core-binding.case.ts` now asserts, against the public core types, that:

1. `DomainStore` structurally satisfies the core `Repositories` port (compile-time assignment of
   the same adapter shape the composition root publishes).
2. Saving through the core-typed port preserves the complete aggregate JSON — every field,
   including personal `completion` metadata and unknown future fields, with no stripping.
3. The core's transactional `atomic` runs a synchronous savepoint through the same connection.

Additionally, the main agent's `tools/bootstrap/check-core-sqlite.mjs` runs the complete core suite
over the actual `ProductStore`: **178/178 tests pass** (144 byte-identical upstream tests + 34
personal completion tests), and the typed binding check passes.

## Original proposal (historical)

The request below asked for a binding decision; it is kept for context.

The core's aggregate types live in `packages/orchestrator-core`; `DomainStore` is generic over the
aggregate JSON (`get<T>`, `list<T>`, `active<T>`) and types only the fields its SQL reads (`id`,
`key`, `at`, `human`, `threads[]`). Failure scenarios that need a test (all now covered by the
core suite run over SQLite and by `core-binding.case.ts`):

1. A core field rename that changes a generated-column JSON path (`ended`, `undelivered`,
   `assignments[#-1].state`, `pending`, `evaluating`, `subscriptions`) must fail a test, not a
   production scan.
2. A new aggregate field that the active queries should consider must be added by the storage
   owner as a migration.
3. `tickets.list()` order (newest first via rowid DESC) must keep matching the core memory
   implementation's semantics.

## Impact

No change to the frozen wire contracts; no schema change for this RFC. Storage remains the single
migration owner; other packages submit schema requests (the v2 `writer_claim` migration in this
round is the storage owner's own REL-03 change).
