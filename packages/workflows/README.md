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
ports.index.sourceMessage(messageId, projectIds)
ports.state.stateFacts()
ports.discovery.discoverPage()  // explicit internal all-discovery, never [] authorization
ports.assistant.decisions.get(id) / .put(record, expectedVersion)
ports.assistant.proposals.get(id) / .put(record, expectedVersion)
ports.assistant.legacyDecisions({ projectId }) // audit-only, never valid memory

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

## Wave-04 assistant state and membership

- `createWorkflowPorts(store).assistant` implements the main-owned synchronous
  `AssistantStatePort`. Decisions keep their body in the existing `user_decision_versions` ledger and
  add source/actor metadata in `assistant_decision_versions` (v11); there is one decision authority.
  `put` creates with expectedVersion 0/version 1, then requires strict CAS +1. Same revision/body is
  idempotent; source/actor/grant/content changes conflict. A revision may only add revocation metadata
  or move to a new decision ID. Old ledger rows without metadata are returned only by
  `legacyDecisions` as `legacy/missingSource`, never as valid assistant memory.
- Proposals use append-only `assistant_proposal_versions`; immutable source/grant/project/contract/
  payload fields cannot change across versions. Confirmation records the same-transaction
  `effectCommandId` but does not execute a command in storage.
- Conversation membership is indexed in `conversation_members` (v12) from conversation project,
  messages and Work identity. A conversation can belong to multiple projects. The scoped
  `conversations.list/search` require a non-empty `projectIds` array and filter membership **before**
  pagination; an empty array returns no rows. `discovery.discoverPage/discoverSearch` are the
  separately named internal discovery paths; main must still apply per-row authorization.
- Source-message metadata is read-only and digest-bound (`role`, `provenance`, `project`,
  `conversation`, `sequence`, `textDigest`, `textLength`); wrong project scope is invisible. No raw
  history dump or execution permission is added.
- `state.stateFacts()` returns schema/writer/instance/queue/artifact/question/proposal observations for
  D's preflight. A writer row/PID is not a trusted stop proof; D still needs the existing barrier
  receipts.

**Main migration required:** current `ApplicationConversations` passes `projectIds: []` as an
internal discovery convention. That convention is removed. Main must pass the configured allowed
projects to scoped list/search (now indexed by membership), or explicitly call `discovery` for a
candidate page and still filter each row. The package-local application regression currently records
three catalog tests failing for this reason; this is a main-owned composition update, not a storage
writer failure.

## Migrations

Storage appends v8 `conversation-catalog`, v9 `project-settings`, v10 `user-decisions`, v11
`assistant-state`, v12 `conversation-members`; v1–v7 checksums and tables are untouched. A v7/v10
database upgrades in one transaction, keeps existing messages/works/decision bodies, and backfills
conversation rows, FTS, membership and assistant metadata absence. Unknown/upstream databases, drift,
gaps and future schemas keep the existing fail-closed behavior.

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
