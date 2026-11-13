# Wave-22 Agent A handoff

Branch `codex/g2-workspaces-verification`; source checkpoint `d8adbb7`, final status this commit.
Merged main `712e191`. Schema remains 18; no migration added.

## Existing attempt facts and one-process read

`wave22-attempt-facts.case.ts` drives the real controlled product through Work/question, then uses only
existing public ports:

- `bindings.binding/current` for attempt, ticket, assignment, contract, fence epoch, runner/session
  and resource identities;
- `commands.get` for original command receipt/body;
- `dispatch.get/beginSend/markWritten/markIndeterminate` for write-before intent, written and unknown;
- `observations.forAttempt`/`forFact`/`forResource` + `payloads.read` for observed accepted facts;
- `product.questions`, `answers.get/deliveries` and recovery activation/source facts.

A command receipt alone is not native observation. `not_sent`/`written` are intent, `indeterminate`
is unknown, and only real native accepted/answer observations are results. The test answers the
question, reaches `native_applied`, closes and reopens SQLite, and finds the same attempt/contract/
epoch/question/answer/delivery/observation identities. Reads do not authorize resend, and an ended
binding is not physical writer-stop proof. No ledger or probe-only method was added.

## Scope diagnostics and dual-format personal read

The v1/v2 real business personal tests are preserved. The signed narrow selection
(`src/narrow/`, exclude `src/private/`) is accepted for startup; history remains readable, while the
wider binding returns `scope_changed`/empty and `?scopeReview=1` reports sorted
`selection_narrowed`+`exclusion_added`, partial, `withheldSourceCount` equal to the binding sources,
and `authorization=none`. Default sources shape remains unchanged, and state/body/artifact guards
remain the only release rule. Main context/products 91/91 include the actual opt-in consumer.

## Evidence

| Check | Result |
| --- | --- |
| storage | 87/87 |
| workflows | 115/115 |
| application | 20/20 |
| verification | 23/23 |
| restored personal | 12/12 |
| recovery combination | 106/106 |
| main product/history/reply | 91/91 |
| main target | 50/50 |
| candidate consumers | 31/31 |
| product execution | 20/20 |
| genuine v1 producer | 2/2 |
| typecheck/build, coordinator strict | PASS |
| packet static check | PASS |
| model/native | 0 |

## Dependency and limits

B has not delivered the same-Runner business attach port. A5 (new coordinator results landing in the
original A store with idempotent native_applied/unknown) is **NOT_REACHED**; an inspect/cancel wrapper
is not business resume. The attempt-fact reader and D/E parameterized recipe are ready.

Private startup permission, physical writer proof and target activation remain main-owned and
NOT_REACHED. D installed consumer and E independent acceptance remain separate. Restored data/read
consent never grants execution. Only temporary state was used; twelve user services, old
ledger/tar/profile and shared reports were untouched.
