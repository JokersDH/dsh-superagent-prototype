# RFC-0002: Product record repositories for the application and Broker

- Status: implemented by A in wave-02 (`packages/storage/src/product.ts`, migration v7)
- Owner: A (product SQLite/migrations); consumers: main (ApplicationService/QuestionBroker), B (read-only ports if needed)
- Date: 2026-11-08

## Situation

WP-02 delivered core rows, receipts, events, queue/effects, artifacts, runtime ingress and answers.
The application assembler and QuestionBroker also need the records named in the wave-02 integration
RFC: Work identity, contract revisions, contract↔Ticket links, conversation messages/pages, user
questions and the manual dispatch switch. Creating tables or transactions in those modules would
split the product database writer.

## Proposed and implemented interface

`ProductStore.product` exposes six repositories. All writes join the caller's `store.uow` (nested
savepoint), so core rows, receipts, events, effects and these records commit/roll back together.
Every write validates its whole body with the shared runtime schema (`WorkRecordSchema`,
`ContractRevisionSchema`, `TicketLinkSchema`, `ConversationMessageSchema`, `UserQuestionSchema`).

| Repository | Methods | Semantics |
| --- | --- | --- |
| `works` | `insert(work)`, `get(id)`, `listByProject(projectId, {limit?, before?})` | Frozen identity; same ID+body idempotent, changed body `ProductConflict`; list newest first, bounded ≤200; no phase field. |
| `contracts` | `append(revision)`, `getByRef(ref)`, `history(workId, {limit?})` | Append-only by full `(workId, revision, digest)`; idempotent replay; same body conflict; history newest revision first; never changes authority (`store.authority` remains the grant). |
| `links` | `attach(link)`, `listByWork(workId)`, `listByRef(ref)` | Idempotent per `(contract, ticketId)`; one `primary` per contract revision (unique index + explicit conflict); `listByWork` newest revision first, primary before child. |
| `messages` | `append(Omit<ConversationMessage,'sequence'>)`, `getById(id)`, `page(conversationId, {before?, limit?})` | Sequence allocated inside the transaction per conversation; replay of the same ID keeps the original sequence and inserts nothing; different body conflicts. `page` returns the newest `limit` (≤200) older messages in ascending order, `beforeCursor` = oldest returned sequence (exclusive next `before`), `hasMore` reports older rows. |
| `questions` | `insert(question)`, `get(id)`, `listOpen({workId?, limit?})`, `replaceExpected(next, {version, validity})` | Insert is frozen by ID. Replace is CAS on both stored version and validity, requires a strictly newer version and the same contract identity; stale/wrong expectations `ProductConflict` and change nothing. Broker owns question/answer/expiry/target semantics. |
| `dispatchControls` | `get(scope)`, `compareAndSet(scope, expectedRevision, paused)` | Only `{paused, revision}`; init at expected 0/revision 1, then +1 per CAS; stale revision `DispatchConflict`. Not a Work/execution phase. |

`Answers`/`answer_deliveries` are reused; `upsertDelivery` now enforces forward-only status
(`local_recorded → written/native/indeterminate/expired`; `indeterminate → native/expired`;
`native_applied`/`expired` terminal) and refuses backwards updates with `AnswerConflict`.

## Migration

v7 `product-records` is appended to the single registry; v1–v6 checksums are untouched. A v6
database upgrades on open and keeps `completion_*` rows. Tables only serve these records; no
generic entity framework or future-learning tables were added.

## Usage

```ts
const store = new ProductStore({ path: statePath })
store.uow.atomic(() => {
  store.product.works.insert({ id, projectId, conversationId, title, createdAt })
  store.product.contracts.append(revision)
  store.product.links.attach({ contract, ticketId, role: 'primary', authorityRef })
  store.product.messages.append({ id: msgId, conversationId, role: 'user', provenance: 'trusted_user', text, sourceRefs: [], createdAt })
})
const page = store.product.messages.page(conversationId, { limit: 50, before: cursor })
store.product.dispatchControls.compareAndSet('global', control.revision, true)
```

## Evidence

`packages/storage/test/product.case.ts` (8 cases) and the delivery-monotonic case in
`outbox-answers.case.ts`: frozen/conflict bodies, ordering/limits, replay preserving sequence,
exclusive paging, question CAS/contract immutability, dispatch CAS, caller-transaction rollback,
v6→v7 upgrade + reopen, and schema rejection before insert. Full storage suite 75/75.

## Dependency and integration notes

- No new runtime dependency: storage already depends on `@personal-agent/contracts` and
  better-sqlite3. No root manifest/lock request.
- Main can start consuming `store.product` for ApplicationService/QuestionBroker; no HTTP shape is
  defined here. The console fixture adapter uses the same wire schemas and can switch to the real
  transport once main publishes it.
