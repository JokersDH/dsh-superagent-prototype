# @personal-agent/portability

Local distribution and migration support for one personal install. Owner: Agent D (WP-12 under
`agent-tasks/product-wave-03`). This package never opens a second production writer and never
dispatches business.

## Scope

- `resolveRoots` / `ensureRoots` — the six product roots (`install`, `config`, `data`, `cache`,
  `logs`, `workspace`) with private-directory and outside-the-checkout guarantees. `data` is the
  coordinator `--state` directory, so no extra database is introduced.
- `validateManifest` / `canonicalJson` / `assertSafeEntryPath` — the versioned `pa-backup/1`
  manifest contract and fail-closed path/summary validation.
- `writeTarGz` / `readTarGz` — deterministic ustar+gzip IO with fail-closed header checksum, path,
  duplicate, entry-type and size/decompression-bomb limits.
- `snapshotState` — consistent database snapshot through `@personal-agent/storage`'s
  `backupDatabase`/`verifyDatabase` ports from a read-only source connection, plus referenced
  content-addressed artifacts copied and re-hashed and the non-secret project binding file.
- `createBundle` / `verifyBundle` — manifest-first complete bundle, exact member/digest comparison,
  database integrity/foreign-key/schema re-check, artifact reference validation.
- `restoreBundle` — verified bundle into a brand-new private directory via staging + atomic rename,
  explicit path remapping, `restore-report.json` with `requiresRevalidation`/`pendingRebind`; never
  starts the daemon or replays business. `readRestoreReport` reads the report back.
- Rollback orchestration (keep failed state, restore the verified prior snapshot, put it back on
  failure) lives in `apps/launcher/lib/restore.mjs` because it owns the managed instance roots.

## What a backup is not

A backup is not "the SQLite file opens". It must list and verify the referenced artifacts, record
schema/producer/version facts, exclude credentials, account homes, native sessions, environment
authority receipts, runtime sockets/PIDs, caches and `node_modules`, and restore only into a new
inactive directory. Project/worktree content is never implicit.

Actual tests: `node --test packages/portability/test/*.case.ts` (roots, manifest, deterministic
archive round-trip, unsafe/malformed/bomb archives, complete bundle, live-writer consistency,
missing/corrupt artifacts, truncated/unsupported/tampered bundles, restore/remap/refusal). See
`docs/rfcs/WP-12/0001-local-distribution-rfc.zh-CN.md` and
`0002-consumption-guide.zh-CN.md` for the format, exclusions, negative cases, consume steps and the
ports still requested from main/A.
