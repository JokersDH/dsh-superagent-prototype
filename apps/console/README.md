# @personal-agent/console

Wave-02 WP-11 operating console. It is a real browser workbench over the public product shapes —
`Snapshot`, `InspectQuery`, `UserCommand`, `CommandReceipt`, `Change`, `AppError` — not a dashboard
mock. The browser never sends a `TrustedActor`; identity is produced by the backend after
authentication.

For personal use, run `pnpm start` from the repository root and open `http://127.0.0.1:5180`.
See [the Chinese usage guide](../../docs/ASSISTANT-GUIDE.zh-CN.md). The integrated workbench adds
private model dialogue, Markdown, independent conversation URLs and a safe model selector. Its light
layout keeps the conversation central and opens work/model details on demand. Execution remains
controlled; model replies have no repository or terminal tools. The imported A checkpoint evidence
below describes that checkpoint; current main acceptance is in `reports/releases/`.

## Modes

| Mode | Selection | Purpose |
| --- | --- | --- |
| Fixture (default) | `VITE_CONSOLE_MODE` unset | Isolated, schema-valid scenario in the development adapter; state persists in `sessionStorage` for the tab. Never a production business-state source. |
| HTTP | `VITE_CONSOLE_MODE=http` | `HttpTransport` against `/v1`: session bootstrap/check, commands, snapshot, messages, SSE, verification and delivery detail routes. Vite proxies `/v1` to `VITE_API_TARGET` (default `127.0.0.1:8787`). |

The HTTP lane is verified against the controlled product (`apps/coordinator/product/demo.ts`):
`PASS_CONSOLE_CONTROLLED_PRODUCT` 13/13 covering configuration-driven delegation, question/answer,
PASS/FAIL verification, delivery manifest and output download, acceptance, stop, revision, stale
question/candidate rejection, refresh, SSE reconnect and configuration failure/blocked states. The
older queue-only sandbox has no configuration port, so new delegation is correctly disabled there;
it is no longer the browser acceptance lane.

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
- Responsive navigation and detail drawers on narrow screens; no horizontal overflow; visible keyboard focus.

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

Controlled product lane (real question, registered check, trusted verification and artifacts):

```sh
pnpm --filter @personal-agent/coordinator dev:product -- \
  --port 8792 --state /tmp/pa-product-demo --console-origin http://127.0.0.1:5174

VITE_CONSOLE_MODE=http VITE_API_TARGET=http://127.0.0.1:8792 \
  pnpm --dir apps/console run dev -- --port 5174

node apps/console/e2e/controlled-demo.mjs    # PASS_CONSOLE_CONTROLLED_PRODUCT 13/13
```

After session bootstrap the console fetches `GET /v1/configuration` and initializes the project,
profile, scope and default-criteria controls from it; there are no hard-coded project/profile/check
values in HTTP mode. Only `dispatchAllowed` projects/profiles can be selected. A configuration read
failure or an unschedulable executor disables new delegation with the transport/blocked reason while
keeping the draft; query, answer and stop remain available, and existing works keep their executor.
The browser reads the published delivery manifest, patch, output and check evidence through
`/v1/artifacts/:id`; acceptance uses only `actions.currentCandidate`. Revision uses the current
contract scope/criteria and creates a new revision, invalidating old candidates.

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
