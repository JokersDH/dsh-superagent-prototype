# Wave-04 A delivery: assistant persistence and indexed workflows

- Branch: `codex/g2-workspaces-verification`
- Main base: `8c736f2`; merge checkpoint: `10205bf`
- Stable interface checkpoint: `68852c0`
- Owned paths: `packages/storage/`, `packages/workflows/`
- Model tasks: **0**; unknown sends: **0**. All tests use temporary SQLite state.

## Phase results

| Phase | Result | Evidence |
| --- | --- | --- |
| A1 AssistantStatePort | PASS package-local | v11 companion decision metadata + proposal versions, strict CAS/replay/immutable source/grant, legacy rows audit-only, rollback test |
| A2 membership/indexed catalog | PASS package-local | v12 membership backfill/maintenance, multi-project conversations, scoped list/search before paging, explicit discovery, empty scope is empty |
| A3 C read index | PASS package-local | bounded work/contract/verification/delivery/artifact reads; source message metadata with digest; missing/stale never fabricated |
| A4 snapshot/state | PASS package-local | DB online backup + backup-derived artifact registry + copied bytes/digests; missing/corrupt/IO blocked; observational state facts |
| A5 migration/consumer | PASS package-local with main consumer gap | v10→v12 keeps legacy decision bodies; assistant record→proposal confirm→read→revoke→reopen; second Node process consumes ports/snapshot |

## Actual commands and results

```sh
./packages/storage/node_modules/.bin/tsc -p packages/storage/tsconfig.json       # PASS
./packages/storage/node_modules/.bin/tsc -p packages/storage/tsconfig.build.json
./packages/storage/node_modules/.bin/tsc -p packages/workflows/tsconfig.json    # PASS
./packages/storage/node_modules/.bin/tsc -p packages/workflows/tsconfig.build.json

cd packages/storage && node --test test/*.case.ts       # 75/75
cd packages/workflows && node --test test/*.case.ts     # 15/15
cd packages/application && node --test test/*.case.ts   # 13/16; 3 expected main catalog failures
cd packages/verification && node --test test/*.case.ts  # 23/23
```

Evidence:
`reports/wave04-storage-tests.txt`, `reports/wave04-workflow-tests.txt`,
`reports/wave04-application-regression.txt`, `reports/wave04-verification-regression.txt`,
`reports/wave04-status.json`.

## A1 persisted assistant state

`createWorkflowPorts(store).assistant` is the main-owned `AssistantStatePort`, synchronous and inside
the existing `UnitOfWork`.

- Decisions use the existing `user_decision_versions` body ledger plus a new v11 companion metadata
  row (`sourceMessageId`, `sourceTextDigest`, conversation, actor, recorded/revoking actor). There is
  one decision authority. `put` creates at expected 0/version 1, then strict CAS +1. Same version and
  full body replays; source/actor/content/scope/grant changes conflict. Revocation is a new version
  with `revokedAt`/`revokedBy`. Old rows without metadata are returned only by
  `legacyDecisions` as `legacy/missingSource`; they never enter valid memory.
- Proposals use append-only v11 versions; immutable source/grant/project/contract/payload/digest/
  timestamps cannot change. Confirmed revisions name `effectCommandId`, superseded revisions name
  `supersededBy`; storage does not execute a command. Proposal confirmation remains main's transactional
  composition.
- A decision/proposal write plus event/queue writes shares the caller transaction; injected failure
  rolls back metadata, body and events (tested).

## A2 membership and catalog

`conversation_members` is backfilled from conversation project, Work project and message project, then
maintained on create/Work/message. One conversation can have several project members. Scoped list and
search filter membership **before** limit/cursor; `projectIds: []` returns no rows. `discoverPage` and
`discoverSearch` are the separately named internal all-discovery paths; callers still filter per row.
Directory entries expose full `projectIds`, title/archive revisions and bounded counts; archive only
changes visibility and unused open questions remain in `attention`/`openQuestionCount`.

## A3/A4 consumer surfaces

`sourceMessage(messageId, projectIds)` returns role/provenance/project/conversation/sequence/
textDigest/textLength and returns undefined outside the project scope. `stateFacts()` exposes
observational schema/writer/instance/queue/artifact/question/proposal counts; it is not a trusted
stop proof. `WorkflowSnapshots` still backs up the DB, reads artifact rows from that backup, copies
and verifies bytes, and blocks missing/corrupt/IO cases. No restore is initiated by storage.

## Known main integration gap

`packages/application/src/conversations.ts` still passes `projectIds: []` to storage as an internal
discovery convention. That convention was explicitly removed in wave-04. Its three catalog tests fail
until main either:

1. passes its configured allowed project IDs to `list/search` (membership is now indexed), or
2. uses `discovery.discoverPage/discoverSearch` for a candidate page and filters every row with the
   full `Conversation.projectIds` and its allowed set.

This is a main-owned composition change, not a second writer or a storage bug. The exact failing
tests are listed in `reports/wave04-status.json`.

## Limits / NOT_TESTED

Main HTTP/UI catalog after the above change, C's prepare/commit governance, main proposal confirmation
commands, D's actual restore/rollback closure, native/Codex execution, model/browser/product
acceptance, multi-user ACL, permanent deletion and automatic learning remain NOT_TESTED. This is a
package-local storage/workflow delivery, not a full product/G3 admission.
