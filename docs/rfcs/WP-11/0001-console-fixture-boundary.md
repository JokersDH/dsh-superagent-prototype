# RFC-0001: Console fixture boundary and the routes still owned by main

- Status: implemented (console fixture lane); production wiring requested from the main agent
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
| `verification?(id)` | fixture only | Optional. HTTP omits it and the panel says the detail route is not wired. |
| `deliveries?(questionId)` | fixture only | Optional. Per-target status comes from the backend once a route exists. |
| `executors?()` | fixture only | `AgentProfile`/`ProbeReport` fixtures; production Catalog is main-owned. |

All adapters validate with the public schemas. Fixture state lives in `sessionStorage` for the tab and
is never read by production code.

## Request to main

1. Publish the read routes for verification detail, per-target answer deliveries, and the Catalog
   profile/probe entry, or fold them into existing `Snapshot`/application ports through the versioned
   contract process. The console will consume them through the optional methods above; no
   `Snapshot.profiles` field should be added privately.
2. Publish the authenticated HTTP/SSE server (status/error envelope, `cursor_expired` event, `Last-Event-ID`).
   Until then HTTP mode is implemented but **NOT_TESTED**.
3. Decide whether dispatch/pause expected revisions and candidate acceptance use the existing
   `expectedHoldRevision`/`CandidateRef` fields as assumed; the UI passes exactly those.

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
