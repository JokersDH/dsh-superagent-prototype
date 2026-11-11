# RFC-0007: Read-only target inventory, source/target binding and evidence projection

- Status: implemented package-local; D materializer and main activation/start remain external
- Owner: A (`packages/storage/`, `packages/workflows/`)
- Shared ports: `contracts/recovery-target.ts` (`RecoveryTargetInventoryReader`), 0025/0026/0029/0031
- Model budget: 0; all fixtures are temporary

## A1/A2: target inventory

`recoveryTargetInventory.inspect(stateRoot)` (also `createRecoveryTargetInventoryReader()`) implements the
published `RecoveryTargetInventoryReader` synchronously:

- The only paths read are `<stateRoot>/state.sqlite` and `state.sqlite-wal`. They are copied to a
  private `0700` temp directory and opened **readonly** there, so the target directory is never
  created, migrated, locked, checkpointed or written. `-shm` is shared memory and is excluded.
- `databaseDigest` is SHA-256 over length-marked DB and WAL byte digests, accepted only when both
  files' size/mtime/inode stayed stable across the read; otherwise the digest is null and
  `busy_or_changed` is reported. It is a snapshot byte digest, not proof that the directory or
  credentials are complete.
- Table classes come from this build's migration registry (`migratedTableNames`), with explicit
  metadata/business sets, FTS shadow tables treated as derived metadata, and a test that every
  migrated table is classified. Unknown tables are `unknown` + `unknown_table`.
- `productSchema` is read from `schema_meta`; older supported schemas (13/14) are classified without
  migration, newer/absent/unsupported schemas produce `unsupported_schema`. Missing DB, corrupt DB,
  symlinked root/DB, non-private root and an unstable snapshot are reported as issues, never as an
  empty valid target. `completeness` is `complete`/`bounded`/`unsupported` accordingly.
- `startupAvailable` is always `false`, and target bytes, WAL, marker files and queue rows are
  unchanged by inspection (asserted by hashing the directory before/after).

## A3: source/target consumer

`RecoveryIntentCommitter` (main) records the source fact/receipt/event; `bindRecoveryTargetConfiguration`
binds the committed source to an inert preparation with a configuration digest. A's test uses these
real main classes and an explicitly-labelled empty target fixture (the D materializer is not in this
checkout):

- the preparation is `startupAvailable: false` and carries the same source receipt/activation;
- a changed configuration digest is refused before any file work;
- an empty current-schema target inventories `complete` with no business rows and `startupAvailable:
  false`; source queue/marker and activation facts are unchanged;
- missing, partial/corrupt or residual-business targets are `unsupported`/flagged and never become a
  start permission; a forged target directory cannot create source activation facts.

D still owns actual materialization, byte identity, staging cleanup and process start; main alone may
authorize activation after re-reading source facts and current resources.

## A4/A5: snapshot materials and evidence projection

The snapshot evidence summary keeps `recovery_intents` (legacy audit) and `recovery_activations`;
`examples/d-snapshot-restore.mjs` now also creates a separate empty target DB, inventories it and
prints its completeness/digest/business-row state, so D/E can compare source snapshot bytes with the
target observation. Restoration still requires a new explicit confirmation; no activation authority
or credential is carried in either snapshot family.

`projectWorkEvidence({delivered, currentAccepted, window})` is a pure helper for 0025 semantics:
`recorded` only when the current accepted outcome is in the window; otherwise `source_missing`
(delivered and complete window), `not_in_window` (delivered with a bounded/caller-limited window) or
`not_accepted`. It never infers quality, permission or completeness from UI activity.

## External gaps

- D: `RecoveryTargetMaterializer` implementation (prepare/read/discardStaging) is not in this
  checkout; A's target is an explicit empty-DB fixture and the tests do not claim D materialization.
- main: activation commit/HTTP/start switch and authoritative descriptor; A only reads source facts
  and target observations.
- Physical writer barrier stays with main/B; inventory emptiness is not quiescence proof.
- Root lock remains main-owned; no new package dependency was added by this work.
