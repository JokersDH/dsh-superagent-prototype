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

## Wave 27: what this channel actually is, and what it is not

### Pages are budgeted as whole encoded responses

The facts page budget used to count only the sum of frame bodies. The producer envelope and the wrapper
are part of the response, so an assembled page could overrun the transport cap and surface as an unknown
outcome even though every record was legal. The whole encoded page is budgeted now: a page that would
overrun is trimmed from the tail and returned with `done=false` and a real cursor, so the caller continues
instead of losing the replay, and a page that cannot fit one frame is refused explicitly. The 64 KiB
transport cap is unchanged; this is correct accounting, not a wider cap. A large frame becomes a reference
descriptor with its byte count and digest, and its payload is read back in chunks under the reported
decoded length, so intermediate chunks are legal.

### The payload route is bound to the registered producer

A payload read names its producer and is refused when it is not the registered one, and the route reports
the decoded byte length rather than the base64 character count.

### One dispatch, one channel, no separate waiter maps

The Runner used to keep three independent waiter maps for fact receipts, payload reads and native-write
admission. A reply from an older coordinator could settle a waiter created by a newer one. They are gone:
one generation-scoped channel owns both directions. The lease generation starts at 0, the first
compare-and-set bind returns 1, generations are monotonic and never reused, a replaced lease has its
waiters settled as failures rather than left behind, and a reply is served only for the lease generation
that created the waiter.

The stdio handler and the authenticated endpoint share ONE command admission, so begin-once, the prepared
policy, admission state and the receiver log cannot be bypassed by choosing a channel.

### Handover and crash recovery, and their limits

Client A serves the three callbacks, leaves with a pending native write, and client B takes the same
Runner: the pending write becomes `state_indeterminate` / `write_indeterminate_after_detach`, A's later
reply is refused, B replays the same original fact ids and pays nothing for A's pending work. No business
command is replayed and no permission migrates on rebind; the caller returns to the original command
reconciliation and a fresh guard.

With a real coordinator SIGKILL, a new process PID that holds only the registration resumes the same
attempt at the same epoch and re-reads the same original fact ids. The begin window is observed closed: a
re-fed begin with its original id is refused as `duplicate_begin` instead of being replayed, and a re-fed
deliver keeps its original command id. A refusal is a refusal with its own reason, not an unknown outcome.

### Scope, stated plainly

Observed on real spawned fixture-lane Runner/child processes: pages and references, the dual-client
handover over the authenticated transport, the SIGKILL resume with the original ids, stale-epoch refusal,
late-receipt refusal, and the quiescence of the resources the Runner started. Observed in-process or on a
controlled endpoint: the pending-native-write indeterminate proof and the channel capacity and fault
behaviour.

Still not observed here, and not claimed: the answer acknowledgement window with the original
question/answer on the product lane, the same-Work current-candidate comparison, the 2/4 slot accounting,
and any installed-Codex or gateway behaviour. Returning a resource means every tracked writer is
quiescent, not that the inventory is empty, because the Runner keeps the record of what it started; one
such record honestly carries `sigterm-failed` alongside `group-quiescent`. A closed module is not physical
quiescence. No real vendor, model or native turn was spent for any of this.
