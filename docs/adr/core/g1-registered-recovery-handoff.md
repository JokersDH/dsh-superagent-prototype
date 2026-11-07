# G1 Registered Recovery And Queue Composition

Date: 2026-11-08. Main base: `aae704f`. Branch: `codex/g1-registered-recovery`.

**The registered local recovery/queue composition slice passes 56 integration tests with six real SIGKILL windows on Node 24.22.2, darwin/arm64. Full G1 is still blocked. No product daemon/UI or vendor compatibility is claimed.**

## Delivered Code

| File | Responsibility |
| --- | --- |
| `apps/coordinator/runner-registry.ts` | Trusted launcher registers one immutable authenticated endpoint per known attempt; SQLite reopen discovers it by stable command ID |
| `apps/coordinator/reconcile-runner.ts` | One bounded physical recovery: inspect, commit cancel intent if stopping, send the same control ID, confirm the complete owned-resource barrier |
| `apps/coordinator/recovery-effects.ts` | Connect the existing `runtime.reconcile` queue to recovery; concurrency 2 by default, configurable 1–4, retry backoff 2–60 seconds |
| `apps/coordinator/resource-barrier.ts` | Stable v2 barrier identity per attempt/manifest; repeated fresh terminal proof reuses the first receipt without growing proof files/facts/events |
| `apps/coordinator/stored-ingress.ts` | Configuration drift now enqueues a JSON-encoded payload reference, as the existing Effects decoder requires |
| `tests/integration/registered-recovery*` | Production SQLite/queue/host composition guards and three additional independent-process crash windows |

Only public existing ProductStore repositories are used. There is no new SQL schema, migration or parallel execution lifecycle. Ticket/Assignment still own business state; registration and control receipts own durable operation identities.

## Registration And Trust

`registerRecoveryRunner(store, verifiedInspection)` is a **trusted launcher-only** entry. The proof comes from the authenticated private/pinned local connection, matches the binding's complete AttemptRef/runner/source, and is checked again at commit. JSON clones, unknown/stale identities, ended new bindings and replacement endpoints are refused. Exact re-registration returns the original receipt. A registered endpoint may be used later to clean up an old known attempt; it never changes the current pointer.

The existing immutable command receipt is the source of truth for this one launch command's result. It stores the endpoint/key-file **references**, full producer, first proof ref and matching event sequence. `loadRecoveryRunner` validates strict shape, canonical digest, binding identity and the committed registration event. It does not guess paths, scan socket directories, trust worker text, or read a launcher manifest during recovery. Credentials remain in private files, excluded from public event/proof payloads. This uses existing single-writer operation storage; any future dedicated A-owned index must preserve the command IDs/receipts and be a projection, not a second authority.

The same-user/local threat model from the prior Runner-link handoff still applies. The actual production launcher/supervisor must call this API and preserve private state directories; this batch does not build a production launcher daemon.

## Recovery Sequence

1. Load the known immutable registration from the database, then query that pinned endpoint outside a transaction.
2. A complete running inspection returns `running` with `businessResumed: false`. Missing/changed/unknown state returns `held`; no begin/deliver/answer is exposed.
3. Re-read the binding after inspection. Only a persisted `stopping` attempt gets a cancel. Its stable command ID/body and `runtime.recovery.cancel-requested` event commit **before** the peer call.
4. Retries/reopens use the exact same ID on the same pinned service. The service's per-ID control cache prevents a second backend cancellation. An unavailable/replaced service stays held; no replacement is launched.
5. Only a fresh terminal/closed/complete proof with the exact current registered resource manifest can confirm physical quiescence. The Ticket remains unchanged by this physical path. Old cleanup cannot end a newer attempt or re-enable authority.

`handleRunnerRecovery(effects, store)` attaches this sequence to the existing Effects queue. Held results retain the row and produce a bounded machine-code failure/backoff, rather than a false success. Coalesced queue generations remain intact. These retries are **physical queries and the same deduplicated cancellation**, not permission to replay an unknown business/native send. The application must kick the existing scheduler from its daemon heartbeat; the helper starts no process/timer.

The previous raw-reference queue encoding was not valid JSON and would fail before its handler. New config-change facts now encode the reference correctly. Legacy unreleased developer rows need an explicit validated re-enqueue; no database content is silently rewritten.

## Barrier Compatibility And Verifier Handoff

Barrier v2 deduplicates by immutable attempt identity plus complete resource manifest. Every use still requires a fresh authenticated terminal proof. Its receipt/proof remains the **first committed** evidence for that closed inventory. A changed manifest requires new proof and a new receipt. Older v1 receipts/events remain historical and are not reinterpreted as fresh proofs; no released-product database migration is claimed.

`runtime.barrier.confirmed` now additionally records `barrierCommandId`, full `attempt`, `source`, and the exact `writerFactId` (or null for zero resources). A verifier must check the event **topic**, complete identity, matching committed command result, exact writer fact, manifest and **current runtime pointer/epoch**. A receipt for old cleanup is valid history, not evidence that a newer current writer has stopped. Candidate/artifact/criteria/acceptance checks still belong to the trusted completion path; a barrier alone cannot complete a Ticket.

## Evidence

`pnpm check:g1-registered-recovery` builds real dependencies, strictly typechecks coordinator/runtime and runs:

| Suite | Passed |
| --- | --- |
| Existing link/barrier/independent Runner reconnect | 17 |
| Registration/recovery/production queue guards | 22 |
| New real SIGKILL windows | 3 |
| Existing production/fact recovery including two SIGKILL windows | 14 |
| Total | **56** |

New crash windows are after committed cancel intent/before wire, after real peer stop/before barrier, and after barrier commit/before user receipt. Workers recover using only SQLite registration: the initial launcher handoff file is removed. Each scenario verifies one native start, one cancellation, preserved original intent receipt, one physical observation and no duplicate barrier after commit. The first older reconnect window plus the two fact-recovery windows make six SIGKILL windows in this check. These are same-machine process-crash observations, not power-loss or native vendor certification.

## Reviewed Owner Inputs

- A `fcf3273`: clean source builds; storage **66/66**, workspaces **8/8**, verification **19/19**, and all six prior admission probes pass on Node 24.22.2. The main probe was updated only to await the intentionally async verifier and supply the now-required explicit frozen guard.
- Two new completion probes still fail against A: a genuine historical barrier completes the core Ticket while a newer same-assignment epoch is active; a matching payload under an unrelated event topic is also accepted. `reports/releases/g2-completion-runtime-review.json` records actual `ended=completed`. WP-04 is not integrated.
- B `74a3068`: clean source **148/148**, strict runtime typecheck, the original four plus follow-up three admission probes pass on the target Node. Three previously requested integrity boundaries still fail: incorrect terminator accepted, malformed fact envelope accepted, corrupt Journal prefix replayed successfully. `reports/releases/g1-journal-integrity.json` records this. Journal remains unmerged.
- B's **ProcessHost observation file only** is integrated byte-for-byte from `74a3068`: bounded successful `ps -A` inventory is required; overflow/failure cannot prove an empty group. This self-contained accepted improvement does not admit the Journal/replay implementation.

## Next Work

A continues the same branch under `agent-tasks/g2-agent-a-wp04-admission-fixes.md`, now narrowed to current runtime authority and committed host-proof provenance. B continues `agent-tasks/g1-agent-b-journal-followup.md`, now narrowed to complete-file integrity/framing/envelope admission. Main reviews these boundaries, then composes their accepted modules with the actual AttemptRunner recovery backend. Vendor Drivers, QuestionBroker, product entrypoints/UI, load/soak and release gates remain separate work.
