# RFC-0002: AssistantState persistence and indexed conversation membership

- Status: implemented package-local (source checkpoint `68852c0`; main consumption pending)
- Owner: A (`packages/storage/`, `packages/workflows/`, migrations v11–v12)
- Inputs: main-owned `packages/contracts/src/assistant-state.ts`, wave-04 A task, 0016
- Consumers: C (`AssistantStatePort` + read index), main (commands/HTTP/composition), D (snapshot/state)

## A1 AssistantState

The port is implemented exactly as published by main; C imports the same contract. Implementation
uses one SQLite writer and the caller's UnitOfWork.

- Decisions: the UserDecision body remains in `user_decision_versions` (v10). V11 adds
  `assistant_decision_versions` keyed by `(id, version)` with source message/digest, conversation,
  actor, recorded time and revoking actor. `put` creates at expectedVersion 0/version 1, then strict
  CAS +1; same revision/body replays, any body/source/actor/grant/content change conflicts. A new
  revision can add `revokedAt`/`revokedBy`; replacing content/scope/source requires a new ID. Old
  ledger rows without metadata are not valid assistant memory; `legacyDecisions` returns them with
  `legacy/missingSource` for audit only.
- Proposals: v11 `assistant_proposal_versions` stores complete source/grant/project/contract/payload/
  digest/time/state/version. Same-version full-body replay is idempotent; new versions must retain all
  immutable fields. Confirmed versions name `effectCommandId`, superseded versions name
  `supersededBy`; validation comes from the shared schema. Storage does not execute the command.
- All methods are synchronous and join the caller's existing transaction. A failure after record,
  event or queue writes rolls back the whole transaction (tested).

## A2 Membership and directory

- V12 `conversation_members(conversation_id, project_id)` is backfilled from `conversations.project_id`,
  `works.project_id` and message `projectId`, then maintained on create, Work insertion and every new
  message. It is a directory index, not an execution fact.
- A conversation can have multiple project members. Scoped list/search require a non-empty
  `projectIds` array and filter membership before pagination/search limits, so later eligible rows are
  not dropped. An empty array is explicitly empty. Explicit all-discovery is separately named
  `discoverPage`/`discoverSearch`; main still owns per-row authorization.
- `Conversation` exposes the full `projectIds`, last sequence, title/archive revisions and bounded
  counts; title/archive/message page updates preserve message IDs/sequence. Archive changes visibility
  only, with `attention`/`openQuestionCount` retained.

**Known main integration break:** current `ApplicationConversations` calls
`list({ projectIds: [] })`/`search({ projectIds: [] })` as a discovery shortcut. After this RFC that
returns empty, so catalog tests fail until main passes its configured project IDs or uses `discovery`.
This is a deliberate authorization correction, not a second writer or a reason to restore the empty
array convention.

## A3 Read index

`WorkflowIndex` exposes bounded project/work/artifact reads and `sourceMessage(messageId, projectIds)`
with role/provenance/project/conversation/sequence/text digest/length. Missing settings, authority or
contract is `missing`; artifacts are not claimed to belong to a Work without completion/acceptance
evidence. Source metadata does not grant file, project or native execution permission.

## A4 Snapshot and state facts

`WorkflowSnapshots` remains the D consumer: online DB backup, artifact registry read from that backup,
copied bytes with digest/length verification, atomic manifest, and blocked missing/corrupt/IO results.
`state.stateFacts()` exposes schema/writer/instance/queue/artifact/open-question/pending-proposal
observations. It never turns a PID or writer row into a trusted stop proof; D/main retain barrier and
restore policy.

## Migration and upgrade

V11 and V12 are appended after v1–v10, whose checksums remain unchanged. A v10 database upgrades in
one transaction; old decision bodies remain in the ledger and are listed as legacy/missing-source.
V7 databases additionally backfill catalog/membership. No separate SQLite database or second Work
lifecycle is introduced. New runtime dependencies: none; the root lock importer for workspaces is
already present in main.

## Consumer order

1. Main passes configured project IDs to scoped list/search, or uses `discovery` only for a candidate
   page with explicit per-row filtering.
2. C consumes `assistant` and read-index source metadata in its async prepare; C's synchronous commit
   revalidates source/grant/actor/contract and calls A's `put` in main's transaction.
3. Main writes its command receipt/event/effect and proposal record in the same transaction.
4. D consumes `WorkflowSnapshots` and observational `stateFacts`; restore/rollback remains D/main.
5. E independently checks public HTTP/UI behavior after main integrates; A does not edit console/HTTP.

## Non-goals

No inference/learning, no automatic revocation, no execution authority in records, no second writer,
no permanent deletion, no HTTP DTO creation, no native/model request.
