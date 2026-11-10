# RFC-0001: Workflow catalog, settings, decisions and snapshot ports

- Status: proposed/implemented package-local; public HTTP DTO remains main-owned
- Owner: A (`packages/storage/`, `packages/workflows/`, migrations v8–v10)
- Consumers: main (application/HTTP/coordinator composition), C (context/proposals/knowledge),
  D (portability), E (independent acceptance)
- Date: 2026-11-10

## Why one shared storage owner

The existing product database is the only writer for Work identity, contract revisions, messages,
questions, receipts, artifacts and completion evidence. A conversation catalog, project settings,
explicit decisions and a read index must be derived from that same database. Creating another writer,
a second Work lifecycle, a private wire shape or a generic entity framework would violate the
single-writer and frozen-contract boundaries. This RFC therefore asks for one storage-owned
migration sequence and one public port surface; main defines HTTP DTOs and commands.

## Requested shared semantics

### Conversation catalog/search/archive

- Persisted identity: `conversationId`, optional `projectId`, title, title revision, created/updated
  timestamps, archive timestamp/revision. Message IDs/sequence remain the existing records.
- Directory is newest update first with bounded cursor pagination; search is bounded and requires an
  explicit project scope from the public port.
- Archive only changes catalog visibility. It must not hide unresolved questions, active work or
  messages; the directory marks `attention`/`openQuestionCount` so main can keep them visible.
- Main needs a public conversation summary DTO (id, project, title, timestamps, archived marker,
  attention) and commands for rename/archive; A provides the domain port only.

### Project settings versions

- Domain-only settings: display name, check kind, environment policy (including an authorized store
  path), path digest and source reference. The path/credential itself stays with main's private
  registry.
- Append-only revisions with a CAS current pointer and CAS archive/unarchive. Old revisions remain
  auditable; new settings never rewrite an in-flight contract, Ticket, environment receipt or
  authorization.
- Main must publish a public settings DTO/command and decide when a new grant consumes a revision.
  A will not mutate coordinator composition or the private `NativeProjectRegistry`.

### Explicit UserDecision persistence

- Reuse the frozen `UserDecision` contract as the record body. Versions are append-only; `revoke`
  appends a higher version with `revokedAt`; current/history and explicit project-scope queries are
  bounded.
- Storage does not infer rules, learn preferences, or grant execution authority. C implements
  decision governance; main implements commands/HTTP; A only persists and reads.

### Consistent snapshot / artifact manifest

- D needs one new destination containing a SQLite online backup plus the artifact registry read from
  that backup, copied artifact bytes, and a manifest with hashes/bytes. Missing/corrupt files produce
  a blocked, incomplete result, not a green backup.
- Verification is read-only and detects DB/hash/schema/artifact drift. D owns restore/upgrade policy
  and must use a new state directory; A does not auto-restore or copy account/native session data.

### Read index

- C consumes bounded project/work/check/delivery provenance. Missing settings/authority/contract is
  reported as missing, never as current. Artifact registry entries are not claimed to belong to a
  work unless a completion/acceptance record proves it.
- No direct SQL by C/D; no model file or execution permission is granted by reading the index.

## Implemented migration plan

| Version | Name | Purpose |
| --- | --- | --- |
| v8 | `conversation-catalog` | Conversation directory, project/updated indexes, FTS5 trigram search, v7 backfill from works/messages. |
| v9 | `project-settings` | Immutable settings versions, CAS current pointer and archive fields. |
| v10 | `user-decisions` | Append-only UserDecision versions, project/version indexes. |

All statements are append-only at the end of the registry; v1–v7 checksums remain unchanged. A v7
database upgrades with existing rows preserved. Migration failure leaves the DB unchanged and the
same version retries, as the existing migration runner already guarantees. No new runtime external
dependency is required; the test suite uses the existing SQLite binding (main supplies the root lock
importer for the new package).

## Cross-module test update

`packages/verification/test/migrations.case.ts` currently asserts `PRODUCT_SCHEMA_VERSION === 7`.
That package is outside this round's owned paths; its owner/main must update the assertion to
`PRODUCT_SCHEMA_VERSION` (while retaining the v1–v6 checksum checks) when integrating v8–v10. This is
a test expectation change, not a production interface change. The storage suite itself is green at
75/75.

## Consumption order

1. Main publishes conversation/project/decision HTTP DTOs and command composition; it passes private
   project IDs from its registry, not user input alone.
2. C consumes `ReadIndexPort` and `DecisionLedgerPort`; it must not write SQL or invent a second
   decision/rule lifecycle.
3. D consumes `WorkflowSnapshots` in a transfer/restore tool and records the manifest digest.
4. E verifies the public HTTP/UI behavior and the snapshot/negative cases independently.

## Explicit non-goals

Permanent deletion, automatic learning/promotion, native execution authority, account/credential
handling, a second SQLite database, and an HTTP implementation in this package are out of scope.
