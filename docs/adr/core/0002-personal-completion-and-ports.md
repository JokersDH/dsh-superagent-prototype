# ADR 0002: Personal Completion And Core Ports

Status: implementation decision for WP-01, based on G0 commit `700c0dd`. Product wire contracts remain v1.0.0; the new domain fields belong to orchestrator-core, not a second Work engine.

## Interface For Storage And Execution Authors

The existing `Repositories` synchronous port stays compatible. Storage persists the full Ticket JSON, including optional `completion`, in the same transaction as receipts/effects/product rows. No new repository method or private Work lifecycle is required.

Personal Ticket creation is opt-in through trusted `EngineOptions.completionPolicy(ticket, outcome) -> { mode, contract }`. `contract` is the immutable validated product ContractRevision. `isCurrentContract(ref)` is required for personal work and reads the Work index on the same transaction connection. An absent/stale guard fails closed. Legacy tickets keep their existing rules.

Additive methods:

- `reportAssignment(ticketId, assignmentId, report)` checks the current pending/running assignment. Personal `ready` requires running and creates a candidate. Ticket-only legacy `report` is refused for personal tickets.
- `inputsReadAssignment(ticketId, assignmentId, inputIds)` scopes read acknowledgments. The old ticket-only read entry is refused for personal work.
- `completionCandidate(ticketId)` returns the current CandidateRef or undefined.
- `invalidateCandidate(ref)` validates ticket/assignment/contract before bumping the generation. Broker uses it in the same transaction as answer/effect persistence; no duplicate core Input.
- `confirmCompletion(proposal)` resolves proof from the trusted synchronous CompletionVerifier port. The caller cannot supply a success boolean or arbitrary evidence object.
- `retireTicket(ticketId, reason)` revokes a revision even if the Ticket already ended; it keeps historical completion evidence and blocks further business use.
- `personalExecutor()` returns an actual frozen runtime facade containing only assignment-scoped execution facts. It omits legacy report, completion, retirement and user-control methods. Do not pass a full Engine to a worker.

Supervisor must still atomically fence attemptId/epoch/contract before these assignment-scoped core methods. The core has no physical process registry. A core ended Ticket does not mean its writer stopped, and a new pending Assignment cannot bypass Supervisor's resource barrier.

## Completion State

Ticket.completion stores mode, immutable ContractRef/criteria, a per-Ticket monotonic generation, current candidate, confirmation, retirement and result notification references. Only core mutates these lifecycle fields. It does not store a separate Work execution state.

Initial generation is zero. A ready candidate increments it. Every accepted new Input, restart/retry, non-ready report and Broker resumption invalidates it; duplicate Inputs do not. Logical counters, not timestamps, establish ordering. Required machine checks must PASS on the same candidate/artifact/criteria; required human checks and human_review mode need trusted user acceptance. Unknown, skipped and not-applicable required machine checks do not pass v1.

CompletionVerifier resolves Verification, candidate-bound quiescence and any human acceptance by stored references inside the current transaction. It performs no asynchronous I/O. Core checks all identities, required criteria, input backlog, quiescence and acceptance before calling the original Tickets.end. The eventual verifier/Broker must write their records through trusted application paths; presence of a valid-looking JSON object is not proof.

## Legacy And Followed Threads

Legacy behavior and all 144 original tests remain unchanged. Personal ready and followed-thread merge/close facts cannot automatically finish the Ticket; thread facts are retained, final completion still goes through verification. Personal dropped ends as dropped, not merged/completed. Formal result replies require the current trusted completed result; previews belong in the application projection.

Ended personal Tickets never auto-resume. Continue creates fresh authority/contract/Ticket through ApplicationService. Retired live Tickets stop; retired ended Tickets remain historical. The Source/Policy must also reject new intake on an old revision's logical Thread; core Ticket guards alone cannot identify every unrelated future Trigger.

## Dependency And Delivery

Runtime core imports stay local plus node:crypto. New product data types are type-only imports from the public contracts package. Production core is a separate package; the G0 extraction remains immutable. A standalone package lock is transitional until the main agent activates/consolidates the root workspace.

Memory tests prove domain behavior only. Real transaction/effect/fence/stop guarantees wait for WP-02/WP-03 integration. Missing callbacks/records fail closed rather than synthesizing success.
