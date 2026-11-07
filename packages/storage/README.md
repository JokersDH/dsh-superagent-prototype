# @personal-agent/storage

Transactional SQLite storage for Scheme B (WP-02). One better-sqlite3 connection carries every
mutating store; a savepoint `UnitOfWork` spans domain rows, product indexes, command/fact
receipts, queue rows, event log entries, dispatch records, channel receipts, and answer
deliveries, so a command commits or rolls back as one (DATA-02/DATA-04).

Domain SQL, generated working-set columns, the outbox receipt pattern, and the queue row
semantics are extracted from the upstream dsh-superagent prototype (MIT, DeepSeek Harness Team,
`src/app/store.ts`, `src/app/effects.ts`, `src/app/outbox.ts`) and adapted: new product schema,
no DSH imports, better-sqlite3 instead of `node:sqlite`.

## Surface

| Export | Purpose |
| --- | --- |
| `ProductStore` | Opens the database and wires every store over the single connection. |
| `ProductDatabase` | Pragmas (WAL, `synchronous=FULL`, `foreign_keys=ON`, busy budget), schema version, integrity checks. |
| `UnitOfWork` (`store.uow`) | Nested savepoint `atomic()`, rollback, `afterCommit()`. |
| `DomainStore` (`store.domain`) | trigger / disposition / thread / ticket / decision tables, trigger-thread index, generated-column active sets. Structural over aggregate JSON — see RFC-01. |
| `CommandReceipts`, `FactReceipts` | Replay dedup by ID + payload digest; conflict refusal; durable receipt sequence. |
| `EventLog` (`store.events`) | Append-only, gap-free `seq` (rowid alias), `after(cursor)` paging. |
| `SQLiteQueueStore` (`store.queue`) | `QueueStore` implementation for `@personal-agent/effects`; parked-row classification. |
| `DispatchLedger` (`store.dispatch`) | `not_sent → written → native_accepted`, with `indeterminate`; blocks resend on written/indeterminate. |
| `ChannelReceipts` (`store.channels`) | Text outbox receipts: idempotent IDs, settle, withdraw, weak per-conversation FIFO. |
| `Answers` (`store.answers`) | One delivery row per native target (`PRIMARY KEY (answer_id, target_binding_id)`); contracts' delivery states. |
| `ArtifactStore` (`store.artifacts`) | Content-addressed files: temp → fsync → rename → reference; digest-verified reads; grace-period orphan GC. |
| `backupDatabase`, `verifyDatabase` | SQLite online backup with WAL; integrity and `foreign_key_check`; restore opens without dispatching business. |
| `WriterLock` | Atomic database claim (`writer_claim`: claim / CAS takeover / conditional release) plus an advisory breadcrumb lockfile written with its full content atomically. Empty/corrupt content fails closed; takeover needs a verifiably dead holder and the registry; suspected PID reuse is refused; a post-claim failure releases the claim. |
| `applyMigrations`, `MIGRATIONS` | The single migration entry; checksums recorded in `schema_meta`; refuses upstream/unknown databases and drift/gap/future versions. |

## Run

This package is a member of the root pnpm workspace (`packages/*`). From the repository root:

```sh
pnpm install
pnpm --dir packages/contracts run build
pnpm --dir packages/orchestrator-core run build
pnpm --dir packages/effects run test
pnpm --dir packages/storage run typecheck
pnpm --dir packages/storage run test
pnpm --dir packages/storage run build
```

Measured environment for the WP-02 evidence: Node v24.21.0, pnpm 11.7.0, darwin/arm64,
better-sqlite3 13.0.3, SQLite 3.53.4. 44/44 storage tests and 8/8 effects tests pass; the official
G1 review repros report A-LOCK-INITIALIZATION, A-ASYNC-TRANSACTION, and MAIN-SYNC-BRIDGE as PASS.
See `report.md` and `reports/`.

## Boundaries

- This package does not start the effect queue on open; recovery is a deliberate reconcile-mode
  startup by the application (WP-10).
- `Work`, `ContractRevision`, questions, runtime bindings, and writer-lease rows belong to other
  packages; they submit schema requests to the storage owner (WP-02) for a later migration number.
- Native send classification wiring is proven here; real native Driver behaviour is
  NOT_TESTED (WP-03/WP-07).
