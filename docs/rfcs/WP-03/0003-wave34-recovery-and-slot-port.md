# RFC: same-Work recovery continuation and slot composition on main

**Status:** candidate (B-owned caller/accounting implemented; main composition pending)
**Owners:** B (execution caller, slot accounting), main (original Application/QuestionBroker, scheduler authority)

## What main already supplies (do not duplicate)

- `RunningAttempt.attachPort`: `{registration, producer}` cloned after the original
  register/ready/current checks.
- `RunningAttempt.attachCallbacks`: the SAME original `readPayload` / `recordFact` /
  `beforeNativeWrite` used by stdio, with the original current/command-digest/live `answerWrites`
  admission and the awaited void/throw→false wrapper.
- `RunningAttempt.feed`: original command intake on the same attempt.

B consumes these through `attachRunningAttempt(handle, leaseId)` (packages/execution/src/attached-attempt.ts).
No copy of the store, guard, payload reader or receipt ledger is created.

## Same-Work continuation (B4)

After the attached consumer serves the original question/answer fact, **main** remains the only owner of
the next step: re-read the original Store binding/commands/observations, run the original frozen
artifact + registered check, expose `currentCandidate`, wait for `actions.available` to contain
`accept_candidate`, then perform the original manual accept. B does not add a candidate table or an
`accepted` flag.

Minimal main-side sequence after attach:

1. `const consumer = attachRunningAttempt(this, 'successor-lease')` on the original `RunningAttempt`.
2. `consumer.run({pollMs, deadlineMs})` serves the original callbacks through `attachCallbacks`.
3. `consumer.feed(originalCommand)` only after the original current/command authority answers
   (main's `nativeFence→index→allowAnswer→send` order).
4. On detach: a pending native intent stays `indeterminate`; the successor re-reads Store state and
   must NOT reuse an old nonce/allowed answer or auto-replay a business command.
5. Main drives check/candidate/manual accept with the original IDs; the consumer only reports
   `served` counts and `feed()` admission, never "delivered".

## Slot composition (B5/B6)

`AttemptSlotScheduler` (packages/execution/src/attempt-slots.ts) is accounting, not a second scheduler:
it starts at 2 slots, queues boundedly, opens to 4, releases only on **confirmed quiescence**, keeps an
`indeterminate` stop occupying its slot, cancels queued work without a running slot, restores from the
original Store binding states (`ended→released`, `active→running`, `stopping→indeterminate`, duplicates
counted once) and refuses shrink/duplicate/overflow.

Main composes it with ONE call site in its executor/scheduler:

- on start admission: `slots.admit({attemptId, ticketId})`; start only when `state==='running'`.
- on stop/cancel result: `slots.settle(attemptId, evidence)` where evidence is the original
  process/child/socket/fd/timer/waiter/queue/journal barrier result (`confirmed` vs `indeterminate`).
- on boot: `slots.restore(originalBindings.map(...))`; do not mark `ended` in the DB to free capacity.
- when a slot frees, start the **original** queue head, not a new local queue.

## Non-goals

- No new Work/attempt/Runner/credential/permission, no public HTTP or wire change.
- No automatic accept, no writer racing, no second lifecycle/ledger/queue.
- Slot accounting is not quiescence: `module close`, one PID, or a phase change never releases a slot.
