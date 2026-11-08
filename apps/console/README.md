# @personal-agent/console

Wave-02 WP-11 operating console. It is a real browser workbench over the public product shapes —
`Snapshot`, `InspectQuery`, `UserCommand`, `CommandReceipt`, `Change`, `AppError` — not a dashboard
mock. The browser never sends a `TrustedActor`; identity is produced by the backend after
authentication.

## Modes

| Mode | Selection | Purpose |
| --- | --- | --- |
| Fixture (default) | `VITE_CONSOLE_MODE` unset | Isolated, schema-valid scenario in the development adapter; state persists in `sessionStorage` for the tab. Never a production business-state source. |
| HTTP | `VITE_CONSOLE_MODE=http` | `HttpTransport` against `/v1`: `POST /v1/commands`, `GET /v1/snapshot`, `GET /v1/conversations/:id/messages`, SSE `GET /v1/events?after=`. Vite proxies `/v1` to `127.0.0.1:8787`. |

The HTTP path is implemented but **NOT_TESTED** against a live server: the product transport belongs
to the main agent and was not published in this round.

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

```sh
pnpm install                                   # root workspace; lock changes are main-owned
pnpm --dir packages/contracts run build        # console imports the built schema/types
pnpm --dir apps/console run typecheck
pnpm --dir apps/console run test               # fixture adapter contract tests (node --test)
pnpm --dir apps/console run dev                # http://127.0.0.1:5173/
pnpm --dir apps/console run build
```

Playwright evidence needs a browser for the installed package:

```sh
cd apps/console
node node_modules/@playwright/test/cli.js install chromium
node e2e/run.mjs
```

The e2e runner expects the dev server at `CONSOLE_URL` (default `http://127.0.0.1:5173/`) and writes
`e2e/report.json` plus `e2e/screenshots/`.

## Boundaries and unwired pieces

- Fixture-only transport methods (`verification`, `deliveries`, `executors`) are optional extension
  points. The HTTP transport omits them until the main transport publishes matching read routes; the
  UI then shows "尚未从产品路由读取" instead of inventing data.
- No new Snapshot field, no vendor `if/else` in pages, no private wire types: every returned document
  is parsed with `@personal-agent/contracts`.
- Closing the browser cannot stop the daemon; nothing here writes product SQLite or native profiles.
- Real HTTP/SSE, authenticated actor production, and live Catalog wiring are **NOT_TESTED**.
- See `docs/rfcs/WP-11/0001-console-fixture-boundary.md` and `report.md` for acceptance evidence.
