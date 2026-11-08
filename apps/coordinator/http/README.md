# Local Product HTTP Interface

Hono `4.13.17` / official Node adapter `2.1.6`, private loopback entry. The business wire contracts remain frozen v1; no Snapshot extension is introduced.

| Route | Behavior |
| --- | --- |
| GET `/v1/health` | Public minimal health and fixture/product mode |
| POST `/v1/session` | JSON `{bootstrapToken}` creates an opaque HttpOnly, SameSite=Strict local cookie |
| GET/DELETE `/v1/session` | Authenticated session check/signout |
| POST `/v1/commands` | UserCommand only; server creates TrustedActor; normal rejected CommandReceipt remains HTTP 200 |
| GET `/v1/snapshot` | Strict InspectQuery and Snapshot |
| GET `/v1/conversations/:id/messages` | Exclusive before/limit ConversationPage |
| GET `/v1/events?after=SEQ` | SSE Change, `id=seq`; Last-Event-ID wins; expired cursor initially HTTP 409, later `cursor_expired` SSE event |
| GET `/v1/questions/:id/deliveries` | Existing AnswerDelivery array through an injected allowed reader |
| GET `/v1/verifications/:id` | Existing full Verification through an injected allowed reader |
| GET `/v1/artifacts/:id` | Approved ref only, attachment stream; never an arbitrary path |

All `/v1` product data needs a local session or API bearer token. Cookie writes additionally require an exact configured Origin and JSON body; SameSite=Strict, Origin validation and preflight form the CSRF defense (the browser need not manufacture a TrustedActor or CSRF actor field). Local CLI uses `Authorization: Bearer <private api.key>`. Session creation needs the private bootstrap credential. Credentials are not returned in JSON, events, errors or stdout.

Unknown input/actor fields are rejected. Limits: 64KiB request bodies, bounded queries and sessions, loopback Host/Origin allowlist, no-store/nosniff/security headers. Unexpected backend errors are redacted. A missing optional reader returns unsupported_capability, not fake evidence. Console/catalog profile browsing is not yet exposed; A's optional console read adapters can consume these published routes in a later owner update.

## API Sandbox

Build application dependencies, then:

```sh
pnpm --filter @personal-agent/coordinator dev:api --port 8787 --console-origin http://127.0.0.1:5173
```

This uses `.local-state/http-demo/`, actual ProductStore/core and a single-writer lock. `api.key`, `bootstrap.key` and `action.key` remain private local files; only their directory is printed. It is an API sandbox: execution intents stay queued, no vendor/model is invoked, and no fake verification is accepted. Reopening the same state preserves accepted work/conversation/receipts. Existing A console fixture state is a different lane and is not imported.

A browser client first posts the bootstrap credential to `/v1/session`, then uses same-origin cookies (cross-origin development needs credentials and an explicitly configured Origin). The console transport still needs its owner to integrate bootstrap/session errors and the optional detail routes. This entry alone is not a usable full workbench or native product release.
