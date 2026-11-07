# ADR-000: Transactional storage, queue, and migrations (WP-02)

- Status: accepted for G1
- Date: 2026-11-07
- Owner: Agent A (WP-02)
- Scope: `packages/storage/`, `packages/effects/`

## Context

WP-02 must deliver a local, single-writer storage layer for Scheme B: core aggregate state,
product indexes, command/fact receipts, a durable effect queue, an event cursor, migrations,
backup/restore, artifact files, and the single-writer lock. The upstream prototype already proves
the domain SQL, the savepoint transaction model, and the effect queue algorithm; G0 fixed
`@personal-agent/contracts` v1.0.0 (schemaHash `74ffd32d…`) as the shared wire surface.

## Decisions

1. **Binding**: better-sqlite3 13.0.3, the combination validated by G0-B (SQLite 3.53.4,
   darwin/arm64, prebuild inside the tarball, `allowBuilds: better-sqlite3: false`). `node:sqlite`
   is not used. Until the main agent activates the root workspace, each package keeps its own
   `package.json`/`pnpm-lock.yaml` (the agreed temporary setup).
2. **One connection + savepoint UnitOfWork**: every mutating store shares the connection;
   `atomic()` nests SAVEPOINTs, rollback discards the level's writes and afterCommit callbacks,
   and `afterCommit()` runs only after the outermost commit (port of upstream `Store.atomic`).
   Product code composes command transactions across stores with `store.uow.atomic`.
3. **Domain aggregates as JSON rows + generated columns**: the five upstream tables
   (trigger, disposition, thread, ticket, decision), the trigger/thread index, and the active-set
   generated columns are extracted verbatim in semantics. `DomainStore` stays structural over the
   JSON: it knows only the paths it indexes. Binding it to the core's `Repositories` port is the
   WP-01 seam (RFC-01).
4. **Receipts carry a payload digest**: `command_receipts` and `fact_receipts` dedup a replay with
   the same ID and digest and refuse the same ID with a different digest — no receipt overwrite
   (DATA-03). The command receipt, its work, its queue rows, and its events share one transaction.
5. **Event log is gap-free**: `seq` is the rowid alias and appends happen inside the same
   transaction as the change, so a rolled-back transaction consumes no sequence number (DATA-08
   storage half).
6. **Queue split**: the algorithm lives in `@personal-agent/effects`; persistence is the
   `QueueStore` port implemented by storage on the same connection. Coalescing keeps queue
   position; `seq` + `generation` conditional updates protect a replaced row. Coalescing SQL has
   `WHERE effect.parked_at IS NULL`: a **parked row is immutable to new enqueues** and must be
   explicitly `cancel`led by reconcile before the same `(kind, key)` can queue again — this
   prevents a second delivery path for one native command.
7. **Unknown native sends park**: handlers throw `UnknownSend`; the row leaves dispatch with
   `parked_reason`/`parked_at` and is never retried by the generic queue (REL-02). The
   `DispatchLedger` writes the intention (`not_sent → markWritten → native_accepted`) before the
   physical write; recovery sees `not_sent` as provably safe, `written`/`indeterminate` as
   reconcile-first.
8. **Migrations are owned and checksummed**: one registry, a contiguous version sequence, each
   migration in `BEGIN IMMEDIATE` with its checksum recorded in the same commit. An edited
   applied migration, a gap, a future version, a failing migration, an unknown database, or the
   upstream application database (its `kv` marker) refuses the open; the file is left unchanged
   (DATA-06).
9. **Artifacts are content-addressed files**: write temp → fsync → rename → fsync dir; the caller
   inserts the reference only afterwards. GC deletes only unreferenced/temporary files older than
   the grace period; referenced files are never deleted (DATA-05).
10. **Writer lock**: lockfile (`pid`, `nonce`, `startedAt`) plus a `coordinator_instances` registry
    row. A live holder is `in_use`; a dead holder (ESRCH) is `stale` and safely taken over; a live
    PID with an unregistered nonce is `suspect_pid_reuse` and is **never** auto-taken over
    (REL-03). PID alone neither proves death nor life.

## Consequences

- Single-process writer only, by construction. Multi-instance support would require optimistic
  versions and a second writer authority — out of scope for the first release.
- The queue's in-memory running set is not durable; a crash mid-handler leaves the row due and it
  replays, so every handler must be idempotent (upstream invariant preserved).
- `Work`, `contracts`, `questions`, `runtime_bindings`, and `writer_leases` tables are not created
  in v1: their owners (WP-01/WP-03/WP-05) submit schema requests to this owner for the next
  migration number. No module may open its own writer.
- A parked row blocks its `(kind, key)` until reconcile cancels it; the reconcile owner must be
  WP-03/WP-05 and is not implemented here.
- The `DomainStore` JSON-path coupling is the risk of the binding seam; RFC-01 asks WP-01 to bind
  the types and to run the extracted core suite against this store so a path rename fails tests.
