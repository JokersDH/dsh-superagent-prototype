# @personal-agent/workflows

Wave-03 A's workflow surface over the single product SQLite writer. It exposes durable conversation
catalog/search/archive, versioned project settings, append-only explicit decisions, a bounded read
index and a database-plus-artifact snapshot. SQL and migrations remain in
`@personal-agent/storage`; this package never opens a second writer or creates a Work/Ticket
lifecycle.

## Public ports

```ts
const ports = createWorkflowPorts(store)
ports.conversations.create({ id, projectId, title })
ports.conversations.list({ projectIds: ['project-1'], limit: 30 })
ports.conversations.search({ query: '季度报告', projectIds: ['project-1'], limit: 20 })
ports.conversations.rename(id, expectedTitleRevision, title)
ports.conversations.setArchived(id, expectedArchiveRevision, true)

ports.projects.append({ projectId, expectedRevision, settings })
ports.projects.current(projectId)
ports.projects.history(projectId)
ports.projects.setArchived(projectId, expectedArchiveRevision, archived)

ports.decisions.append(userDecision, { expectedVersion })
ports.decisions.revoke({ id, expectedVersion })
ports.decisions.list({ projectIds, includeRevoked: false })

ports.index.project(projectId)
ports.index.listWorks({ projectIds, query, limit })
ports.index.work(workId, projectIds)
ports.index.listArtifacts({ limit })

const snapshots = new WorkflowSnapshots(store)
await snapshots.create({ destination: '/private/new-snapshot-dir' })
snapshots.verify('/private/new-snapshot-dir')
```

## Semantics

- **Conversation catalog**: `Conversation` identity/title/title revision/created/updated and archive
  revision are persisted; message IDs and per-conversation sequence are never rewritten. Message
  append automatically creates/updates the directory, so existing application callers do not need a
  second state machine. Search uses FTS5 trigram for substrings of at least three characters and a
  parameterized `LIKE` fallback for shorter queries; project IDs are a mandatory public scope.
- **Archive**: archive only changes catalog visibility. Messages, works, artifacts and unresolved
  questions remain readable; `attention` and `openQuestionCount` stay true so main can keep pending
  user requests visible. Permanent deletion is not part of this port.
- **Pagination**: catalog/search are newest-update first with an opaque `updatedAt\0id` cursor;
  messages keep the existing exclusive sequence cursor. Limits are bounded (catalog 100, search 50,
  messages 200). Repeated commands and stale title/archive/settings revisions return a stable
  `WorkflowConflict`.
- **Project settings**: versions are append-only (`revision` starts at 1), current pointer is CAS
  protected, and archive is a CAS visibility flag. A new settings revision never mutates an existing
  contract, Work, environment receipt or Ticket; main chooses whether a *new* grant consumes it.
  `sourceRef`/`pathDigest` are provenance only, not credentials.
- **Decisions**: uses the frozen `UserDecision` wire schema. `append` is idempotent for an identical
  body and append-only otherwise; `revoke` appends a higher version with `revokedAt`. Scope queries
  are explicit and bounded. Storage never infers a rule or grants execution authority.
- **Read index**: only reads existing storage facts. Missing project settings, missing current
  authority or missing contract is reported as `missing`, never fabricated as current. Work/artifact
  lists require explicit project scope and bounded limits. Artifact registry rows are provenance
  facts, not proof that an artifact belongs to a work; completion/acceptance records remain the
  delivery proof supplied by the verification owner.
- **Snapshot**: SQLite online backup is the database of record; artifact rows are read from that
  backup, every source file is copied and digest/byte checked, and a manifest is written atomically.
  Missing or corrupt files make the result `blocked`/`complete: false`; verification rechecks the
  database hash, schema/integrity and every artifact. Restore is a deliberate caller action in a new
  state directory.

## Migrations

Storage appends v8 `conversation-catalog`, v9 `project-settings`, v10 `user-decisions`; v1–v7
checksums and tables are untouched. A v7 database upgrades in one transaction, keeps all existing
messages/works, and backfills conversation rows plus the FTS index. Unknown/upstream databases,
drift, gaps and future schemas keep the existing fail-closed behavior.

## Boundaries

- Public HTTP DTO/commands remain main-owned. The types here are domain/port types, not a second wire
  protocol. `UserDecision` reuses the frozen contract schema; project settings need a main DTO before
  they appear over HTTP.
- C/D consume these ports only. They must not open SQLite, write production SQL or copy private
  wire types. A is the only storage/migration owner.
- No account, `.env`, native profile, model request, network install or production service was used
  by this package's tests. All fixtures use temporary state directories.

## Run

```sh
pnpm --dir packages/storage run build
pnpm --dir packages/workflows run typecheck
pnpm --dir packages/workflows run test
pnpm --dir packages/workflows run build
```
