# @personal-agent/effects

Durable transactional side-effect queue for Scheme B. This package is the **algorithm** only; the
durable rows live in `@personal-agent/storage`'s `effect` table behind the `QueueStore` port, so a
row enqueued inside a command transaction commits or rolls back with that command.

Extracted from the upstream dsh-superagent prototype (MIT, DeepSeek Harness Team,
`src/app/effects.ts`) with two product changes:

1. Persistence goes through the `QueueStore` port instead of direct SQL.
2. An **unknown native send** (`UnknownSend`) parks its row for reconcile instead of entering the
   generic retry/backoff path (REL-02: only a provable `not_sent` may resend, local IDs are not
   proof of native idempotency).

## Behaviour

- **Coalescing**: one row per `(kind, key)`; a newer enqueue replaces the payload, bumps
  `generation`, resets attempts, and keeps the queue position. A running attempt cannot delete or
  overwrite the replaced row (`seq` + `generation` match on completion).
- **Ordered kinds**: run one at a time and block behind their head row even when it is not due.
- **`Later`**: reschedules after the initial retry delay without counting a failure (paused
  processing, full slots).
- **Backoff**: `min(max, initial * 2^attempts)`; `FAILURES_BEFORE_ERROR` consecutive failures mark
  the kind's health entry `error` unless the handler is `quiet`.
- **`UnknownSend`**: parks the row (`parked_reason`, `parked_at`); parked rows are never
  dispatched by this queue, survive restarts, and are not coalesced into dispatch again. A
  reconcile path owns them; `cancel` drops one to hand over.
- **Restart**: waiting rows stay in storage; `start()` resumes. `drain()` stops new dispatches and
  waits for running ones.

## Run

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

Node `>=24.21.0`, pnpm 11.7.0. Zero runtime dependencies. Evidence from the WP-02 run is in
`reports/` (8/8 tests).
