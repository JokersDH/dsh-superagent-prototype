# G1 Fact Recovery And Journal Admission

Date: 2026-11-07. **Production observations and the bounded fact-recovery adapter pass their measured scope. Journal writer admission and full G1 remain blocked.**

## Reviewed Inputs

- Agent A `247339b`: 66/66 storage tests and strict typecheck independently pass on Node 24.22.2. Migrations v4/v5 add current runtime/authority invariants and append-only observations. Integrated into main.
- Agent B `906a23d`: strict normalized payloads and per-attempt Runner context factory integrated. The main controlled-process tests now consume that factory.
- Agent B `24b4449`: the complete candidate branch ran 126 tests with 125 passing and one oversize reason assertion differing (`buffer_limit` versus `frame_too_large`). Typecheck passes. The Journal commit is not merged as a durable implementation.

## New Main-Agent Implementation

`stored-ingress.ts` now writes A's RuntimeObservations inside the authoritative fact transaction, along with core/receipt/event/queued reconciliation. Exit, cancel and writer observations remain independent and never automatically release resources.

`recover-facts.ts` accepts a decoder-owned bounded snapshot plus an independently trusted archived producer. It validates every record before writing anything: strict kind/value schema, full producer tuple, original content-addressed payloadRef, and same-ID immutable body. Corrupt/gapped snapshots, changed same-ID bodies, wrong refs and excessive batches fail closed.

For accepted snapshots, the adapter restores the missing payload files/metadata under their **original** references, then calls authoritative ingress. Exact known repeats return their original receipts. Old business facts are refused while known physical evidence can be retained. An unexpected storage failure stops further replay; this avoids advancing business facts past an unknown gap.

The module has no Runner start/deliver/answer interface and never invokes native commands. A successfully replayed fact is not an execution restart or a whole-environment replay.

## Executed Evidence

`pnpm check:g1-recovery` builds actual dependencies, typechecks main/runtime, and runs:

| Scope | Result |
| --- | --- |
| Production-store + controlled fake child integration | 5/5 |
| Recovery strictness/payload restore/receipt replay/late physical facts/rollback | 7/7 |
| Real SIGKILL before fact record and after DB commit | 2/2 |

The crash worker starts one real fake-Agent child and waits for its turn event. A synced decoder-export fixture is saved, then the worker is killed at the defined window. The parent restores through production SQLite and verifies a single original begin in the independent fake-Agent receipts. The after-commit case keeps the original receipt sequence; the before-record case applies once. Owned fixture processes are cleaned using PID/start-marker/command checks.

These snapshots are **test decoder exports**, not the unaccepted FileCriticalJournal writer. SIGKILL and same-machine reopen do not prove power-loss durability or IPC reconnect to an independent live Runner. Test fixture intake/producer mapping is not product authentication.

The optional `check-journal-interop.mjs --runtime <clean candidate checkout> --record` also ran three passing valid-format/safety cases against actual candidate Journal frames: payload restoration, late physical-only evidence and main refusal of conflicting IDs. Its PASS is format interoperability only.

## Journal Blocking Evidence

`review-journal.mjs --runtime <candidate checkout> --record` reproduced four failures against `24b4449`:

1. append returned with zero fsync calls.
2. append after corruptAt=0 reported success but a subsequent open recovered no new record.
3. same factId/different payload was counted as a duplicate without conflict.
4. Runner propagated a sink receipt with persisted=false.

The report is `reports/releases/g1-journal-review.json`. B's existing “crash before ACK” test throws from a sink in the same process; main's SIGKILL tests are the separate real process-exit evidence. Neither substitutes for the remaining writer fixes.

## Next Owners

- A can start WP-04 in `agent-tasks/g2-agent-a-workspaces-verification.md`; final acceptance still waits for runtime/verification integration. A remains the migration owner.
- B fixes the bounded Journal admission cases in `agent-tasks/g1-journal-acceptance.md`. Preserve the existing contracts and use stable immutable fact identities; do not broaden ingress to hide failures.
- Main continues production composition, payload/fact recovery and gate tests. Do not enable the candidate spool or declare full G1/product release until writer admission and independent-Runner reconnect/resource-barrier scenarios have actual evidence.
