# Wave-03 A: workflow storage and consumption package

- Branch: `codex/g2-workspaces-verification`
- Main base: `3957e30`; merge checkpoint: `382d2e8`
- Stable interface checkpoint: `c3e007b` (final source commit is recorded in
  `reports/execution-status.json`)
- Owned paths: `packages/storage/`, `packages/workflows/` and their package-local docs/tests/reports
- Environment: Node 24.21.0, pnpm 11.7.0, darwin/arm64. Native model tasks: **0**. No account,
  `.env`, model call, network install, user service or user project operation.

## Results by phase

| Phase | Result | Scope/evidence |
| --- | --- | --- |
| A1 interface + checkpoint | **PASS (package-local)** | `ProductStore.workflows`, `@personal-agent/workflows` ports, migrations v8–v10, RFC 0001, 9 workflow tests; checkpoint `c3e007b` |
| A2 conversation catalog/search/archive | **PASS (package-local)** | durable identity/title/update/project, bounded catalog/search, FTS5 trigram + short-query fallback, archive visibility only, attention counts, reopen/pagination/CAS tests |
| A3 project settings + read index | **PASS (package-local)** | append-only settings revisions, CAS current/archive, old contract/settings auditable, bounded project/work read index with explicit missing/stale states |
| A4 decisions + snapshot | **PASS (package-local)** | UserDecision append/revoke/current/history/scope query; SQLite backup + backup-derived artifact manifest + copied bytes + digest verification; missing/corrupt/IO failure blocked |
| A5 cross-package consumption | **PASS (package-local)** | second Node process consumes ports/search/snapshot; benchmark on 120 conversations/1,200 messages; main HTTP/DTO and C/D production wiring **NOT_TESTED** |

Package tests: **9/9** workflow, **75/75** storage, **12/12** application regression. Typecheck and builds
pass. Exact commands and outputs are in `reports/`. A separate `@personal-agent/verification` suite
has 22/23 passing: its migration test still asserts `PRODUCT_SCHEMA_VERSION === 7`; that test is
outside this round's owned paths and must be updated by main/the verification owner to assert the
current schema while retaining v1-v6 checksum checks. This is recorded as a cross-module blocker, not
hidden as a pass.

## Implemented storage contract

Migration registry is append-only at v8–v10 (product schema 10):

- `v8 conversation-catalog`: `conversations`, project/updated indexes, FTS5 trigram
  `conversation_search`, and backfill from existing works/messages. Message IDs/sequence are never
  rewritten.
- `v9 project-settings`: immutable `project_settings_versions`, CAS `project_settings_current`,
  archive fields.
- `v10 user-decisions`: append-only `user_decision_versions`, project/version indexes.

v1–v7 checksums and structures are unchanged. A v7 database upgrades transactionally and keeps its
rows; drift/gap/future/unknown-database behavior remains fail-closed through the existing migration
runner.

`ProductStore.workflows` is the only composition root for these records:
`conversations`, `projects`, `decisions`, `index`. All writes join the shared `UnitOfWork`; no second
writer, database, Work/Ticket lifecycle or execution phase is introduced.

## A2: conversation directory, search and archive

- Explicit conversation create/get/list/rename/archive; title revisions and archive revisions are CAS
  protected. Message append automatically creates/touches the directory so existing application
  callers do not need an extra write.
- Public list/search require explicit `projectIds`; limits are 100/50 and cursors are opaque
  `updatedAt\0id` values. Message paging keeps the existing exclusive sequence cursor.
- Search uses FTS5 trigram for ≥3 characters (Chinese/ASCII substrings) and a parameterized `LIKE`
  fallback for shorter queries. Query text is quoted/escaped and bounded; results are conversation
  level with a bounded excerpt.
- Archive sets only `archived_at`/`archive_revision`. Messages, works, artifacts, questions and
  execution facts are untouched. `attention`/`openQuestionCount` stay visible for archived
  conversations; main must surface those pending questions rather than treating archive as resolved.
  Permanent deletion is not part of the port.
- New/empty/long/Chinese title tests, 60-message paging, cross-project search isolation, reopen and
  stale CAS are covered.

## A3: project settings versions and read index

- Settings versions append from revision 1 with `expectedRevision` CAS; an exact replay is stable and
  a changed body conflicts. Current pointer and archive/unarchive are CAS protected. History remains
  readable; archived projects reject new settings until explicitly unarchived.
- Settings carry display name, check kind, environment policy, path digest and source reference;
  no credential or account data is read or stored. A settings revision never rewrites an existing
  Work, contract, Ticket, authorization or environment receipt; test coverage asserts the old
  contract/goal remains unchanged.
- `ReadIndexPort` exposes bounded project/work/artifact reads with explicit provenance. Missing
  settings, current authority or contract are reported as `missing`/`stale`, never fabricated as
  current. Work/artifact listing requires project scope; no SQL is exposed to C/D.

## A4: explicit decisions and consistent snapshot

- UserDecision uses the frozen contract schema. Append is idempotent for an identical version and
  append-only for changes; revoke appends a higher version carrying `revokedAt`; current/history and
  project-scope queries are explicit and bounded. No rule inference, learning, or execution authority
  is added.
- `WorkflowSnapshots` backs up SQLite with the online backup API, reads artifact rows **from the
  backup**, copies every referenced file with digest/byte verification, and writes a 0600 manifest
  atomically. Destination must be a new directory. Missing/corrupt/unreadable artifacts produce
  `blocked`/`complete:false`; verification rechecks DB hash, integrity, schema, foreign keys and every
  artifact. Restore/upgrade remains D's deliberate action in a new state directory.

## Commands and evidence

```sh
cd packages/storage
node --test test/*.case.ts                 # 75/75 PASS
./node_modules/.bin/tsc -p tsconfig.json   # PASS
./node_modules/.bin/tsc -p tsconfig.build.json

cd packages/workflows
node --test test/*.case.ts                 # 9/9 PASS
./node_modules/.bin/tsc -p tsconfig.json   # PASS
./node_modules/.bin/tsc -p tsconfig.build.json
node examples/benchmark.mjs                # bounded benchmark; reports/performance.json

cd packages/application
node --test test/*.case.ts                 # 12/12 PASS (storage compatibility regression)
```

Benchmark (darwin/arm64, local temporary SQLite): 120 conversations/1,200 messages; catalog 0.24 ms,
long search 14.15 ms, short search 7.64 ms, reopen 0.16 ms, snapshot 25.8 ms, verify `ok`. These are
measurements, not release thresholds.

## Main/C/D consumption

1. Main defines the public conversation/project/decision HTTP DTOs and command composition. Do not
   expose the domain types here as a second wire protocol.
2. Main passes an explicit project scope derived from its trusted registry, not user input, and calls
   `createWorkflowPorts(store)`; use `ProductStore.workflows` for direct composition.
3. C consumes `ReadIndexPort` and `DecisionLedgerPort`; it must not open SQLite, write SQL, infer
   rules, or create a second decision lifecycle.
4. D consumes `WorkflowSnapshots` from `@personal-agent/workflows`; record the manifest digest and
   restore only into a new state directory. Do not copy account homes/native sessions or claim a
   backup's rows prove missing files.
5. E verifies public HTTP/UI behavior and the negative snapshot/catalog cases after main wires them.

## Dependency request

- Root workspace/lock owner must add the `packages/workflows` importer:
  `@personal-agent/contracts` and `@personal-agent/storage` are `workspace:^`; test-only
  `better-sqlite3@13.0.3`/`@types/better-sqlite3` already exist in the root lock. No runtime external
  dependency is added by this package.
- This branch does not edit or commit `pnpm-lock.yaml`; the temporary local install links are not
  product evidence.

## NOT_TESTED / limitations

- Main HTTP DTO/commands, coordinator composition, console catalog/search/archive UI, and C/D
  production wiring are **NOT_TESTED** here.
- Native/Codex execution, model tasks, browser acceptance, multi-user/ACL, permanent deletion,
  automatic learning and arbitrary monorepos are out of scope/not tested.
- FTS5 trigram availability is verified against this product's SQLite binding (3.53.4); a different
  SQLite build must be checked by the release owner. Query fallback is intentionally bounded.
- Existing native/UI product evidence is unchanged; this is a package-local workflow/storage
  delivery, not a full G3/product acceptance.
