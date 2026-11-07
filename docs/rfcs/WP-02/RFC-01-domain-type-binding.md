# RFC-01: Binding the core domain types to the storage repositories (WP-02 → WP-01)

- Status: proposed (open)
- From: WP-02 (Agent A)
- To: WP-01 (main agent, `packages/orchestrator-core/`)
- Date: 2026-11-07
- Related acceptance: DATA-02, DATA-04, CORE-01

## Situation

WP-02 ships `DomainStore` over five tables whose SQL, generated columns, and indexes are extracted
from the upstream store: trigger, disposition, thread, ticket, decision, plus the trigger/thread
index. The public method surface matches the core `Repositories` port method-for-method
(`get/save/list/active/disposition/saveDisposition/byThread`).

However the core's aggregate types (`Ticket`, `Thread`, `Trigger`, `Decision`,
`TriggerDisposition`) still live only in the G0 extraction spike
(`tools/reuse-spike/core-extraction/src/core/`), because `packages/orchestrator-core/` is WP-01's
deliverable and `packages/contracts/` deliberately excludes core domain types. WP-02 therefore
keeps `DomainStore` structural over JSON: it never defines a parallel `Ticket` interface and only
types the fields its SQL reads (`id`, `key`, `at`, `human`, `threads[]`).

## The seam

`DomainStore` methods are generic over the JSON document (`get<T>`, `list<T>`, `active<T>`), and
the write side requires only the identity field plus, for triggers, the `threads`/`at`/`human`
fields the index reads. A binding in WP-01 would look like:

```ts
// packages/orchestrator-core (WP-01), sketch only
const repositories: Repositories = {
  atomic: work => store.uow.atomic(work),
  triggers: {
    get: id => store.domain.triggers.get<Trigger>(id),
    save: trigger => store.domain.triggers.save(trigger),          // Trigger satisfies TriggerIndexInput
    disposition: id => store.domain.triggers.disposition<TriggerDisposition>(id),
    saveDisposition: (id, value) => store.domain.triggers.saveDisposition(id, value),
  },
  threads: { get: key => store.domain.threads.get<Thread>(key), save: t => store.domain.threads.save(t), ... },
  tickets: { ... },
  decisions: { ... },
}
```

## Failure scenarios that need a test

1. A core field rename that changes a generated-column JSON path (`ended`, `undelivered`,
   `assignments[#-1].state`, `pending`, `evaluating`, `subscriptions`) must fail a test, not a
   production scan. Proposal: WP-01 runs the extracted 144-test core suite against
   `DomainStore`-backed repositories (the suite already uses the `Repositories` port), or adds a
   parity test comparing `MemoryRepositories` and SQLite results for the engine flows.
2. A new aggregate field that the active queries should consider must be added to the migration
   (storage owner) — not silently to one implementation.
3. `tickets.list()` order (newest first via rowid DESC) is observable; the core's `MemoryRepositories`
   reverses insertion order. The SQLite store must keep matching semantics.

## Request

- WP-01 owns the core `Repositories` type and should publish the binding (structural casts are
  acceptable; no private type copies). If the main agent prefers a shared domain-model package
  instead of structural binding, this storage package needs a one-line import switch, not a schema
  change.
- WP-03/WP-05/WP-10 must not open their own database writer; schema needs for
  `runtime_bindings`, `writer_leases`, `questions`, `works`, and `contracts` tables come to WP-02
  as a migration request with fixtures.

## Impact

No change to the frozen wire contracts; no change to the schema; no change to acceptance IDs.
Until WP-01 publishes the binding, this RFC stays open and the storage report marks the
type-binding scenario as NOT_TESTED.
