# RFC-0001: Console fixture boundary and the routes still owned by main

- Status: implemented and integrated with the main HTTP checkpoint; Catalog read entry still requested
- From: A (wave-02, WP-11 first version)
- Date: 2026-11-08

## Situation

The console must be usable before the product HTTP entry exists. The wire schema is frozen
(`@personal-agent/contracts` v1); the browser sends `UserCommand` only, and the trusted actor is
created server-side. Several pieces the console would like to display have no published route yet:
verification result details, per-target answer deliveries, and the Catalog/profile read entry.

## Implemented boundary

`ConsoleTransport` is the only data boundary:

| Method | Source | Notes |
| --- | --- | --- |
| `dispatch(UserCommand)` | `POST /v1/commands` | No actor field; receipt validated by `CommandReceiptSchema`, rejected receipts are normal results. |
| `snapshot(InspectQuery)` | `GET /v1/snapshot` | `SnapshotSchema`; the same view carries `cursor`. |
| `messages(conversationId, {before,limit})` | `GET /v1/conversations/:id/messages` | `ConversationPageSchema`; `before` is exclusive and returns ascending messages. |
| `changes(after)` | SSE `/v1/events` with `Last-Event-ID` | `ChangeSchema` per frame; `cursor_expired` is an error event → UI refetches the snapshot. |
| `verification?(id)` | fixture or `GET /v1/verifications/:id` | `VerificationSchema`; a missing reader/route yields no detail, never fabricated data. |
| `deliveries?(questionId)` | fixture or `GET /v1/questions/:id/deliveries` | `AnswerDelivery` array; local/native statuses stay distinct. |
| `executors?()` | fixture only | `AgentProfile`/`ProbeReport` fixtures; production Catalog is main-owned. |

All adapters validate with the public schemas. Fixture state lives in `sessionStorage` for the tab and
is never read by production code.

## Integration status (wave-02 main checkpoint `cd09395`)

- Implemented and verified against the main loopback sandbox: `POST/GET/DELETE /v1/session` bootstrap
  with the private token, HttpOnly cookie, server-generated actor; snapshot, messages, SSE, commands,
  verification and delivery readers. `PASS_CONSOLE_HTTP_DEMO` 8/8.
- `VITE_CONVERSATION_ID` selects the product conversation; the main demo uses `conversation-main`
  while the fixture lane keeps `conv-main`.
- Commands send only the frozen `UserCommand` shapes. Pause/resume/continue use `ContractRef` (not a
  full contract revision) and the WorkView's `dispatchHold.revision`; the live application accepted the
  CAS.

## Remaining request to main

1. Publish the Catalog profile/probe read entry for console browsing; until then HTTP mode shows
   "Catalog 尚未接线". Do not add a private `Snapshot.profiles` field.
2. Keep the loopback sandbox's execution intents undelivered until the accepted Runner is composed;
   the console reports empty question/verification panels as NOT_TESTED rather than faking them.
3. Confirm that production acceptance keeps using `CandidateRef` and that stale candidates disappear
   from `actions.available`; the console also keeps its own stale-verification guard.

## Recovery semantics the console relies on

- A rejected receipt is success of the API, not a thrown exception: error `code/message/retry` is
  shown with a recoverable action. Stale candidate/contract values disable acceptance and offer a
  refresh; expired questions surface `question_expired`; stale dispatch revision surfaces `conflict`.
- Event `seq` is deduped; a stream failure reconnects with the last cursor, and `cursor_expired`
  triggers a full snapshot refetch before resuming.
- When the model is offline, the UI keeps snapshot, answer and stop paths enabled and marks chat as
  rejected/unsent. Offline is never inferred from a missing writer; `resourceStatus: indeterminate`
  is shown as unknown.

## Dependencies

- Console deps: React 18.3.1, react-dom 18.3.1, Vite 8.2.2, TypeScript 6.0.3, `@playwright/test`
  1.65.0 for local e2e (Chromium 1254 downloaded into the user cache). The root lock change from this
  install is a temporary install artifact and is **not committed**; main should regenerate the
  authoritative lock when integrating.
- No new runtime dependency for storage/verification; no frozen contract change.
