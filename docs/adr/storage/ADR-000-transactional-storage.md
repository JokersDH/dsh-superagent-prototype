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
   Transactions are **strictly synchronous**: a thenable result is rejected at the call site and
   the savepoint rolls back before release, so an async callback can never leave its first half
   committed (review A-ASYNC-TRANSACTION). The generic `Repositories.atomic` adapter pattern
   cannot carry a type-level Promise ban without rejecting generic pass-through, so the runtime
   rejection is the guarantee, with `SyncOperation<T>` exported for typed opt-in call sites.
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
10. **Writer lock: atomic database claim, advisory breadcrumb** (revised after G1 review): ownership
    is one row in `writer_claim`, decided by `INSERT OR IGNORE` (claim), CAS `UPDATE ... WHERE nonce
    = observed` (stale takeover), and conditional `DELETE ... WHERE nonce = mine` (release) — each a
    single SQL statement, so concurrent acquirers and concurrent stale takers can never both win.
    The lockfile is an advisory breadcrumb created atomically with its full content (`link` from a
    written temp file) and replaced by an atomic rename only by the claim winner, so no reader ever
    sees an empty in-flight file. **Empty, unknown, or corrupt lockfile content is not death
    evidence: acquisition fails closed (`unknown` verdict).** Takeover requires the registry and a
    verifiably dead holder (ESRCH); a live PID is never assumed dead, and lease or file age is never
    used. A claim without an audit row is `suspect_pid_reuse` and is refused. A post-claim failure
    (audit insert or breadcrumb write) releases the claim and breadcrumb. Without a registry only a
    free state is acquired; stale takeover fails closed. (REL-03, review A-LOCK-INITIALIZATION.)

11. **Runtime-ingress storage (WP-01 ingress store request)**: migration v3 adds `runtime_bindings`
    (attempt history with complete binding JSON: ticket/assignment/attempt/epoch/contract, runner
    identity/source, state, resources), `runtime_current` (the current-by-ticket pointer, distinct
    from history), `runtime_authority` (enabled contract revisions for the current-authorization
    check) and `ingress_payloads` (immutable content-addressed JSON payload references).
    `RuntimeBindings` enforces the immutable binding identity and never lets an ended attempt
    reactivate; `ImmutablePayloads` writes canonical JSON through `ArtifactStore` (file and record
    complete before returning) and reads back value + host-recorded canonical SHA-256 after
    verifying both the artifact and the record. The composed `RuntimeIngressStore` (reducers and
    the authenticated Runner context) stays in the composition bridge; storage never defines the
    public ingress interface and a compatibility fixture proves the shapes match.

12. **Runtime-state invariants** (migration v4): the current pointer only moves within its own
    ticket and only forward in `fenceEpoch` (a different attempt at the same epoch is ambiguous and
    refused; re-pointing at the same attempt is idempotent), and an ended attempt can never become
    current. A binding's state only advances active → stopping → ended; registered resources may
    only be appended with unchanged ownership. `RuntimeAuthority` allows exactly one enabled
    revision per Work (unique partial index), one digest per Work/revision (unique index; a
    re-issued revision with different content conflicts), requires disabling the old revision in
    the same transaction before enabling a new one, and keeps revoked rows as history that never
    satisfy `isCurrent` again without an explicit re-enable. A pre-v4 database with conflicting
    authority rows fails the upgrade instead of silently choosing one.

13. **Runtime observations** (migration v5): the ingress leaves append-only evidence behind every
    accepted fact. One `runtime_observations` row carries the attempt/assignment/contract identity,
    the strict payload kind, the disposition, the original `factId`/`payloadRef`, the host-recorded
    payload SHA-256 and a normalized non-authoritative detail; physical payloads additionally leave
    `resource_observations` rows per reported resource (exit code/signal or writer status).
    `record` must run inside the ingress transaction, so evidence commits or rolls back with the
    fact receipt, the core mutation and the enqueued events/effects. `RuntimeObservations.summarize`
    is the composition root's read/reduce interface: cancel acknowledgement, process exit and
    writer quiescence stay independent, `observed_quiescent` appears only when a writer observation
    explicitly reports it, and the storage layer has no release API — it never manufactures physical
    success from timeouts, missing PIDs or the coexistence of other facts.

## Consequences

- Migration v3 extends the same owned migration entry (v1 domain/product tables, v2 writer claim,
  v3 runtime-ingress tables); an existing v2 database applies v3 on the next open.
- Migration v2 (`writer_claim`, a single-row table) is part of the same owned migration entry; it
  applies to databases created at v1 on the next open, and archive/audit rows in
  `coordinator_instances` remain append-only.
- Single-process writer only, by construction. Multi-instance support would require optimistic
  versions and a second writer authority — out of scope for the first release.
- The queue's in-memory running set is not durable; a crash mid-handler leaves the row due and it
  replays, so every handler must be idempotent (upstream invariant preserved).
- `Work`, `contracts`, `questions`, `runtime_bindings`, and `writer_leases` tables are not created
  in v1/v2: their owners (WP-01/WP-03/WP-05) submit schema requests to this owner for the next
  migration number. No module may open its own writer.
- A parked row blocks its `(kind, key)` until reconcile cancels it; the reconcile owner must be
  WP-03/WP-05 and is not implemented here.
- `DomainStore` binds to the core `Repositories` port structurally; the binding and the full core
  suite over SQLite (178/178) are the main-agent integration. No second domain-model package.
