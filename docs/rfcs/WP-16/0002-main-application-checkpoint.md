# Main Application / Broker / HTTP Checkpoint

Date: 2026-11-08. Main base: `5ac39b5`; storage import commit: `4a09ce4`, identical to A `a6bb40a` for `packages/storage/`.

## Implemented Scope

`packages/questions/` implements current-fence intake, strict presentation/option/form answers, expiry/defer/auth URL intent, conservative explicit business reuse, immutable answer/claim/evidence records, per-target queueing, original lossless binding/version, pre-wire dispatch intent, bounded delivery and native-consumption observation. It never creates generic core input for a question answer.

`packages/application/` implements the deterministic `ApplicationService` over actual core/ProductStore. Core remains the only execution lifecycle. Supported commands: chat/discussion and explicit anchored supplement; create/revise/stop/continue; future-dispatch pause/resume CAS; assignment retry/action token; structured answer; current-candidate acceptance through an injected trusted verifier/review port. Unsupported knowledge/learning commands return explicit rejected receipts.

`apps/coordinator/http/` is a Hono loopback interface with local Cookie/Bearer authentication, server-generated actor, exact Host/Origin validation, cookie-write CSRF defense, strict JSON/schema/size checks, stable/redacted errors, snapshot/messages/work detail, public-only cancellable SSE and allowed reader hooks. `server.ts` uses the official Node HTTP/1 adapter; `demo.ts` is a private-state/single-writer API sandbox.

The former `apps/coordinator/main.ts` repository binder is a compatibility re-export of `packages/application/src/core-repositories.ts`. Its implementation is preserved; core SQLite and previous runtime suites were rerun after extraction. B-owned recovery transport/type regions were not edited.

## Frozen Business / New HTTP Semantics

Business wire schemas/hash remain contracts v1. A browser submits only UserCommand; the backend constructs TrustedActor. Do not add an actor field or treat a native/Runner credential as a user credential.

| HTTP | Result |
| --- | --- |
| GET `/v1/health` | Minimal public `{status,mode}` |
| POST `/v1/session` | JSON `{bootstrapToken}` -> authenticated opaque HttpOnly, SameSite=Strict cookie |
| GET/DELETE `/v1/session` | Check/sign out; cookie writes need exact authorized Origin |
| POST `/v1/commands` | UserCommand -> CommandReceipt; expected business rejection is HTTP 200/rejected receipt |
| GET `/v1/snapshot` | strict InspectQuery query parameters -> Snapshot with consistent cursor |
| GET `/v1/works/:id` | WorkView |
| GET `/v1/conversations/:id/messages` | exclusive `before`/bounded `limit` -> ConversationPage |
| GET `/v1/events` | Change SSE, Last-Event-ID preferred; named heartbeat is ignorable |
| GET `/v1/questions/:id/deliveries` | AnswerDelivery array from the injected allowed reader |
| GET `/v1/verifications/:id` | full frozen Verification from an injected allowed reader |
| GET `/v1/artifacts/:id` | approved opaque reference, attachment stream; no arbitrary path |

Error envelope is `{error: AppError}`. Typical statuses: invalid/schema 400, auth 401, forbidden 403, stale/conflict/cursor 409, unsupported/verification 422, unavailable 503; oversized body 413. Rejected command receipts remain typed normal responses. An initial expired SSE cursor returns HTTP 409 to ordinary clients; an EventSource `Accept: text/event-stream` receives `cursor_expired` and closes, so the browser can reload Snapshot. A later gap also emits that named event.

For cross-origin development, use explicit loopback allowedOrigins and credentials. For the current same-origin Vite `/v1` proxy (8787 target), browser cookies are sent normally. Cookie POSTs require exact Origin plus JSON; Bearer CLI calls use the private API token. No request waits for an LLM. Bootstrap/session UI and optional detail reader methods still need A's console owner to connect; optional methods must not remain fixture data in HTTP mode.

## Runtime And Completion Adapters

Core callbacks enqueue `application.execute` intents; they do not launch a native process inside a transaction. Start/deliver/stop effects carry current ticket/assignment/contract; actual host wiring must check dispatch hold, current authorization, prior resource barriers and prepared policy before any begin. B's runtime-host/source checkpoints are not automatically admitted by these module results.

`QuestionBroker.deliver` takes a transport with a synchronous `beforeWrite` callback after all preparation awaits and immediately before its first external write. The callback rechecks target eligibility and commits the dispatch write marker. Unknown, invalid/late receipts or timeout park; only explicit evidenced `not_sent/same_key_safe` before a marker can retry. `http/question-effects.ts` maps these classes to existing Effects UnknownSend/Later. Consumption requires a matching original binding/write intent and native evidence; response_written is not native_applied. Evidence bundles preserve all refs across reopen.

The application host provides a current native-connection fence; unknown/stale channels cannot receive answers. Completion view/accept callbacks are trusted coordinator ports: current view must be read-only on the same snapshot, and accept must join the same UnitOfWork. The real core always checks its authoritative completion verifier. Module tests use a controlled verifier; no claim is made that the full artifact/verification/Runner pipeline is accepted.

## Independent Evidence

- `pnpm check:g2-application`: **90/90**, Node 24.22.2 darwin/arm64. 14 Broker + 11 application + 9 HTTP are new; 56 prior recovery/physical cases remain green. Strict package/default coordinator/HTTP checks pass.
- `node tools/bootstrap/check-core-sqlite.mjs --storage <main> --record`: **178/178**, Node 24.21.0, actual updated repository binder and SQLite v7. This is a separate domain-storage parity scope.
- A storage checkpoint: **75/75**, independently executed on Node 24.22.2. Workspaces 8 pass; verification suite has **21 passing / 1 failing** due `MIGRATIONS.length === 6` against v7. Both existing completion-boundary probes now pass. Verification/console were not imported by the storage-only integration.
- Actual sandbox process on loopback: `smoke-g2-api.mjs` creates/reads/stops work and returns the original durable receipt for duplicate command; it invokes no vendor/model.

Reports: `reports/releases/g2-application.json`, `g1-core-sqlite.json`, `g2-completion-runtime-review.json` and the main wave-02 progress file. No UI screenshot/native evidence is substituted for product E2E.

## Pending Integration, Collected Once

1. A: update the stale migration-count test while preserving v1–v6 checksums/versions, then re-run the committed verification suite. Existing product storage can already be consumed from main. Console candidate `c0b3c38` is still fixture acceptance pending independent review, session bootstrap/error handling and detail-route consumption.
2. B: newest B1–B4 source/report has arrived but remains independent-review pending. In particular, envelope validation must actually use the frozen schemas/kind/value identity rules, and independent-process lifetime/reconnect/barrier must be proven with coordinator SIGKILL (its report marks those untested). Keep following the whole wave-02 package; these are not requests to stop after another tiny fix.
3. Main: compose the accepted real Runner, native connection fence, safe payload/fact bridge, A workspace/check/verifier and console into G2-Demo-Fake. Catalog public browsing stays a main-owned derived read interface; no private Snapshot.profiles extension.

G1/G2 full product gates and vendor compatibility are still pending. The running API sandbox queues execution intents and does not dispatch them, which is visible in its mode/startup output and keeps the first checkpoint honest.
