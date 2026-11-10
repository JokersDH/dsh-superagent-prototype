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
- Later stages add `createBundle` (consistent snapshot through `@personal-agent/storage`'s
  `backupDatabase`/`verifyDatabase` ports, referenced content-addressed artifacts, non-secret
  config), `verifyBundle`, deterministic tar.gz IO, verified restore into a new private directory,
  explicit path remapping and rollback support.

## What a backup is not

A backup is not "the SQLite file opens". It must list and verify the referenced artifacts, record
schema/producer/version facts, exclude credentials, account homes, native sessions, environment
authority receipts, runtime sockets/PIDs, caches and `node_modules`, and restore only into a new
inactive directory. Project/worktree content is never implicit.

See `docs/rfcs/WP-12/0001-local-distribution-rfc.zh-CN.md` for the format, exclusions, negative
cases and the ports still requested from main/A.
