# @personal-agent/console

Wave-02 WP-11 operating console. It is a real browser workbench over the public product shapes —
`Snapshot`, `InspectQuery`, `UserCommand`, `CommandReceipt`, `Change`, `AppError` — not a dashboard
mock. The browser never sends a `TrustedActor`; identity is produced by the backend after
authentication.

## Modes

| Mode | Selection | Purpose |
| --- | --- | --- |
| Fixture (default) | `VITE_CONSOLE_MODE` unset | Isolated, schema-valid scenario in the development adapter; state persists in `sessionStorage` for the tab. Never a production business-state source. |
| HTTP | `VITE_CONSOLE_MODE=http` | `HttpTransport` against `/v1`: session bootstrap/check, commands, snapshot, messages, SSE, verification and delivery detail routes. Vite proxies `/v1` to `VITE_API_TARGET` (default `127.0.0.1:8787`). |

The HTTP lane is verified against the main-owned loopback sandbox (`apps/coordinator/http/demo.ts`):
`PASS_CONSOLE_HTTP_DEMO` 8/8 on the real ApplicationService/core/SQLite path. The sandbox queues
execution intents and dispatches no Runner or vendor model, so question/verification panels stay
empty there; that is reported as NOT_TESTED, not faked.

## What the UI covers

- Main conversation as the entry: project/anchor context, message log, `Ctrl/⌘+Enter` send, older-page
  loading, empty/loading states, long text wrapping.
- Work list with project filter, phase/resource/writer indicators, paused-dispatch and open-question
  counts; selected-work detail with contract, criteria, verification results, dispatch revision.
- Work creation (`create_work`) from a compact form; stop, pause/resume dispatch, continue and retry
  are offered only from `actions.available`; acceptance is offered only for a current candidate and
  is disabled for stale or failed verification.
- Concentrated questions (`choices`/`form`/`free_text`/`url_flow`/`review`) with per-target delivery
  rows. A locally recorded answer is shown as 本地已记录（尚未写到原生）; the UI never upgrades it to
  `native_applied` itself.
- SSE dedupe by `seq`, reconnect with `Last-Event-ID` semantics, expired cursor → snapshot refetch,
  refresh persistence, tab-visible refresh, model-offline banner that keeps query/answer/stop usable.
- Rejected receipts and transport errors surface `code`/`message`/`retry` with recoverable actions.
- Executor panel consumes `AgentProfile`/`ProbeReport` fixtures (readiness and capability rows); it
  states that production Catalog wiring belongs to the main agent.
- Responsive single-column layout under 960px; no horizontal overflow; visible keyboard focus.

## Run

Fixture lane (default, no backend):

```sh
pnpm install                                   # root workspace; lock changes are main-owned
pnpm --dir packages/contracts run build        # console imports the built schema/types
pnpm --dir apps/console run typecheck
pnpm --dir apps/console run test               # fixture adapter contract tests (node --test)
pnpm --dir apps/console run dev                # http://127.0.0.1:5173/
pnpm --dir apps/console run build
```

Live product lane (main-owned API sandbox):

```sh
# 1) build application deps if needed, then start the loopback sandbox
pnpm --filter @personal-agent/questions --filter @personal-agent/application run build
pnpm --filter @personal-agent/coordinator dev:api --port 8788 \
  --state /tmp/pa-http-demo --console-origin http://127.0.0.1:5174

# 2) start the console against it (different port keeps the fixture lane intact)
VITE_CONSOLE_MODE=http VITE_API_TARGET=http://127.0.0.1:8788 \
  VITE_CONVERSATION_ID=conversation-main \
  pnpm --dir apps/console run dev -- --port 5174

# 3) live acceptance (reads /tmp/pa-http-demo/bootstrap.key)
node apps/console/e2e/http-demo.mjs
```

Open the console, paste the private `bootstrap.key` from the sandbox state directory into the session
gate, and create a work. The backend sets the HttpOnly session cookie and constructs the
`TrustedActor`; the browser never supplies either. `VITE_CONVERSATION_ID` selects the product
conversation for the demo (default `conv-main`, which is the fixture conversation).

Playwright evidence needs a browser for the installed package:

```sh
cd apps/console
node node_modules/@playwright/test/cli.js install chromium
node e2e/run.mjs
```

The e2e runner expects the dev server at `CONSOLE_URL` (default `http://127.0.0.1:5173/`) and writes
`e2e/report.json` plus `e2e/screenshots/`.

## Boundaries and unwired pieces

- `verification` and `deliveries` are implemented on both lanes; HTTP consumes
  `/v1/verifications/:id` and `/v1/questions/:id/deliveries`. `executors` remains fixture-only until
  the main Catalog read entry exists; HTTP mode shows "Catalog 尚未接线" instead of inventing profiles.
- No new Snapshot field, no vendor `if/else` in pages, no private wire types: every returned document
  is parsed with `@personal-agent/contracts`.
- Closing the browser cannot stop the daemon; nothing here writes product SQLite or native profiles.
- Real HTTP/SSE and authenticated actor flow are verified against the local sandbox; live Catalog,
  Runner dispatch and native Driver behavior remain **NOT_TESTED**.
- See `docs/rfcs/WP-11/0001-console-fixture-boundary.md` and `report.md` for acceptance evidence.
