# G1 Local Runner Recovery And Owned Resource Barrier

Date: 2026-11-08. Base: `db6ea7d`. Main branch: `codex/g1-runner-reconnect`.

Latest follow-up: [registered recovery and queue composition](g1-registered-recovery-handoff.md) passes 56 cases. Database registration, v2 barrier idempotence and the current owner reviews supersede pending items below; this document preserves the earlier 17-case scope.

**The local recovery transport and registered-owned-resource barrier slice pass. Full G1 and WP-04 admission remain blocked. There is no usable product daemon/UI yet.**

## Implemented Interfaces

- `apps/coordinator/runner-link.ts`: Node HTTP over a private local Unix socket. Protocol v1 is a composition-layer recovery protocol; frozen AgentDriver contracts and schema hash are unchanged.
- `apps/coordinator/resource-barrier.ts`: consumes a fresh authenticated inspection and records an owned-resource barrier through existing ProductStore repositories. No private SQL schema or migration is added.
- `tests/integration/runner-service.fixture.mjs`: independent **test** service around the accepted ProcessHost. This is not B's complete production AttemptRunner daemon.

The recovery API exposes only `GET /v1/inspection` and `POST /v1/cancel`. It has no begin/deliver/answer endpoint. Inspection does not issue native work. Cancellation IDs are deduplicated across connections and concurrent requests; indeterminate backend failures remain cached, so reconnect does not blindly execute the same control again. The cache is bounded to 128 IDs and refuses new IDs when full. Its lifetime is the Runner service process; it is not a persistent command Journal.

The caller supplies a trusted launcher registration: full AttemptRef, runnerIdentityRef, source, socket path, device/inode, and credential reference. A product-generated random 256-bit bearer credential lives in an owned private directory/file (0700/0600), separate from payloads. Requests recheck the pinned socket identity. Authentication errors are redacted. JSON requests/responses are capped at 64 KiB, and the client has an absolute request deadline. This admits same-user local recovery, not network/multiuser operation or isolation against malicious code with the same UID. Each attempt must get a new credential/registration; an agent's text cannot register an endpoint.

`connectRunnerRecovery(...).inspect()/cancel()` mint process-local proofs in a private WeakMap. A JSON clone, a plain object or a mutation of the public inspection view cannot forge/change a proof. Freshness uses monotonic time from the start of the request, not the peer's wall clock. Default lifetime is 5 seconds; persisted proof files are audit evidence and cannot themselves be replayed as fresh authorization.

## Backend Trust Requirements

`RecoveryRunnerPort` is a trusted host port, never a raw Driver report adapter. Its inventory must include **all** owned writers. `terminated` with `admission: closed` is irreversible for that endpoint; it cannot later accept business or create resources. Cancellation closes business admission before stopping resources. Unknown state, partial inventory and unobservable resources remain indeterminate.

For tracked processes, the fixture uses actual ProcessHost stop/group evidence. A process group is not a sandbox: detached/escaped descendants, shared native services and remote side effects need their own ownership/enforcement/reconciliation. Text such as `group-quiescent` from a Driver cannot establish the trusted host claim.

## Barrier Transaction

`confirmOwnedQuiescence(store, proof)` requires terminated state, closed admission, complete inventory and explicit quiescent evidence for every resource. It checks full execution identity and the exact registered `(ref, ownership)` manifest before and inside the transaction. A newly appended resource invalidates an older proof. Empty inventory is admitted only with the same terminal/closed/complete host evidence; it does not manufacture an empty writer fact.

Proof payloads are written first under content-addressed refs; key bytes/credential paths are excluded. The single outer UnitOfWork then commits or rolls back together:

1. Host-derived `writer.observed` fact/receipt and runtime observations, when resources exist.
2. Ending that known attempt's binding.
3. `runtime.barrier.confirmed` event and idempotent command receipt.

Failed transactions may leave unreferenced proof payloads, but leave no accepted barrier, fact receipt, observation or ended binding. Old known attempts can finish cleanup without changing a newer current attempt. Ticket/Assignment completion is not changed.

The receipt scope is deliberately `registered_owned_resources_only`. It does **not** release all workspace leases, authorize repetition of remote external writes, or satisfy core completion by itself. CandidateRef/artifact freeze/Verification binding remains a separate trusted composition step. A future completion adapter must check a genuine barrier receipt and exact complete manifest, not promote arbitrary `observed_quiescent` summaries to authority.

## Measured Evidence

`pnpm check:g1-runner-link`: **17/17**, strict coordinator typecheck, Node **24.22.2**, darwin/arm64. Report: `reports/releases/g1-runner-link.json`.

A clean detached checkout of source `1668468` installed from the frozen lockfile and independently passed **17 + 14 = 31** integration cases and spec checks on the same target runtime. Only generated report timestamps changed. Evidence: `reports/releases/g1-runner-link-clean.json`.

Sixteen guards cover authentication/full identity, pinned inode, no business endpoint, once-only cancel, cached unknown outcome, private credentials, existing-file preservation, forged/stale/mutated proof refusal, partial/unknown/open/unevidenced inventories, manifest changes, receipt rollback, secret exclusion, bounds/timeouts, old-attempt cleanup and zero-resource handling.

The seventeenth scenario starts an independent fixture Runner and one real owned child. One coordinator process opens actual SQLite and inspects it, then is **SIGKILLed**. The owned child keeps writing. A new coordinator process opens the same store, connects to the same pinned Runner, cancels the original child and records the barrier. The test verifies one original begin, one cancellation, physical exit, persisted observations, ended binding and an open Ticket. Owned fixture services/processes are cleaned up.

Existing production/fact recovery remains a separate 14-test suite, including its two SIGKILL windows. Journal admission, power-loss durability, native vendor compatibility, production launcher registration and full recovery/reconciliation are not certified by these tests.

## Latest Owner Reviews

- A `d1be401`: clean snapshot builds; existing workspaces **4/4** and verification **15/15** pass on Node 24.21.0. Six additional admission probes fail: deleted tracked files cannot freeze; changing a dirty symlink target to another equal-content target leaves the digest unchanged; the handoff's boolean freeze guard is ignored; a SIGTERM-resistant check hangs past its deadline; a resource subset is recorded as quiescent while another registered resource is active; same acceptance ID accepts a different candidate/artifact/actor silently. **Not merged.** See `g2-wp04-review.json` and the A follow-up packet.
- B `32540a3`: clean checkout **136/136** and strict runtime typecheck pass on Node 24.21.0. The previous four Journal admission cases now pass, recorded in `g1-journal-review.json`. Three new probes fail: partial write error does not poison the writer, replay accepts persisted=false, and sequence gaps are admitted. **Journal remains unmerged.** See `g1-journal-followup.json` and the B follow-up packet.

These are version-scoped independent reviews; a positive existing suite and a failing negative suite describe different coverage.

## Next Owners

- A: `agent-tasks/g2-agent-a-wp04-admission-fixes.md`. Keep workspace/verification/migration ownership; connect completion to trusted full-manifest barrier evidence through a reviewed interface.
- B: `agent-tasks/g1-agent-b-journal-followup.md`. Keep Runner/Journal ownership; fix I/O-error poisoning, replay ACK and strict sequence admission before daemon integration.
- Main: maintain this recovery composition, review owner fixes, then integrate durable launcher registration with A and the actual recovery backend with B. Only then run the complete restart/cancel/workspace freeze/verification/current-candidate path.
