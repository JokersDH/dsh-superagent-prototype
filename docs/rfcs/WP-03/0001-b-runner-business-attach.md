# B / WP-03: Runner business attach — minimal interface for main

Status: candidate, unadmitted. Scope: `apps/runner/`, `packages/execution/`. No shared contract or frozen wire
change is proposed. No new ledger, coordinator or execution lifecycle is introduced.

## Why

Inspect and cancel are control operations and are not a business resume. After a coordinator leaves, a new
process needs three things from the SAME Runner: the facts it already recorded, the ability to send the
original command, and a statement of which attempt that traffic belongs to. This document is the interface
main can consume; it is published early so main does not wait for the whole package.

## Surface

```ts
// apps/runner/src/business-attach.ts
attachBusinessRunner({
  endpoint,            // registered endpoint incl. pinned socketIdentity (from A's loadRecoveryRunner)
  binding,             // ticket/assignment/attempt/epoch/contract/runnerIdentityRef/source
  expected,            // what the caller believes is current
  beforeCommand,       // the Broker's own before-write guard, run before anything leaves
  reconcile,           // commandId -> not_seen | intent_recorded | observed | unknown
}) => {
  inspect(): Promise<VerifiedRunnerInspection>
  facts(since?, maxBytes?): Promise<{ producer, frames, next, done }>
  send(command): Promise<{ sent, kind, proof } | { refused }>
  close(): void
}
```

Wire additions, all on the existing authenticated socket and behind the same bearer auth:

- `GET /v1/facts?since=<seq>&maxBytes=<n>` — one page. The response carries the server's own registered
  producer, the journal's immutable `seq` as the page-end cursor, `done`, and the effective `budget`.
  `maxBytes` above the inline ceiling is honoured only up to that ceiling and the reduction is reported,
  never applied silently.
- `GET /v1/payload?ref=&offset=&length=` — one bounded chunk of an immutable payload, with `total` and a
  SHA-256 `digest` so the caller can reassemble and verify. This exists so a legitimate frame larger than
  the response cap is readable by reference instead of the cap being widened or the payload truncated.
- `POST /v1/commands` — body `{ producer, command }`. The server validates the producer envelope AND that
  the command's own ticket, epoch, attempt id and full contract match the claimed attempt, all before the
  backend is touched. Comparing only ticket and epoch was a real defect.

## Relationship to existing code

- `RunnerLink` still spawns the Runner and owns the stdio bootstrap.
- `AttemptRunner` still applies commands; the attach command path calls the same `feed`. The socket does
  not itself add begin-once, prepared-policy or receiver rules: those live in the original feed path and
  are only inherited to the extent that path enforces them today. This RFC does not claim more.
- `FileCriticalJournal` remains the only fact store. Replay pages are the journal's own entries, with its
  own sequence; nothing is renumbered or re-derived.

## Guarantees

- a page is only exposed after its producer matches the caller's trusted producer;
- a foreign producer, a replaced socket inode or a non-current epoch is refused before any write;
- `send` runs the caller's before-write guard and returns the post-command proof; `sent` is admission of a
  command, never a claim of quiescence;
- an observed command is not resent, a pending intent is still sent, an unknown refuses. "Exactly once"
  is NOT claimed: the socket provides identity-checked admission and idempotent replay of the same id, not
  a transactional guarantee that the writer saw the command exactly once.

## Not claimed

Unified dispatch with the stdio path is not delivered, so begin-once and receiver-observed counts remain
properties of the original stdio channel and are not re-proven here. Fact receipt ACK rebinding, fact-receipt ACK rebinding, immutable payload read rebinding and
native-write-admission rebinding are NOT delivered yet. Receipts, payload reads and write admission still
belong to the original stdio channel. Nothing here is admitted for use by the default product.
