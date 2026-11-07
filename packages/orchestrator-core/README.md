# Personal Orchestrator Core

This is the formal WP-01 package derived from DeepSeek superagent commit `8c32a9d`. `LICENSE` and both original test files are copied byte-identically. `upstream.json` locks the source; `generated/upstream-diff.json` accounts for each adaptation and new source file. The original `src/core/` and G0 extraction remain untouched.

## Check

From the repository root, use the shared workspace and its root lock:

```sh
pnpm install --frozen-lockfile
pnpm check:g1-core
```

The contracts dependency uses its public built entry and `workspace:*`; the check builds contracts before checking core. Root lock/workspace changes are owned by the main agent. Original G0 spike/package locks are retained as historical independent evidence; reproduce those with explicit `--ignore-workspace` where needed, rather than treating them as the live G1 lock.

## Legacy And Personal Modes

Legacy behavior remains the default for the reusable Engine. B product assembly uses `createPersonalEngine(options)`, requiring `completionPolicy` and `isCurrentContract`; an absent per-ticket configuration cannot silently downgrade to legacy behavior. `completionPolicy` returns `{ mode: 'verified' | 'human_review', contract }`, and `isCurrentContract(ref)` matches the current immutable Work contract. Both callbacks execute inside the core transaction. No model or worker may select its own mode or mutate the contract.

Personal ready reports create a logical CandidateRef and remain open. New Inputs, actual delivery/read, retries/restarts, non-ready reports and explicit Broker invalidation invalidate a candidate. Repeated Input IDs do not. A generation is never a timestamp.

Personal ended tickets never auto-resume. A new explicitly authorized contract/Ticket is the application continuation path. `retireTicket` records supersession even when stopping an already-ended Ticket would be a no-op, withdraws pending result messages, and preserves historical evidence.

The product factory also refuses stored Tickets that lost `completion`. Storage must persist the entire optional core extension; stripping unknown JSON fields must not silently reactivate legacy completion. Legacy records need an explicit migration/import decision, not a fallback inside a personal Engine.

## Execution Port

Give trusted Supervisor the actual frozen object returned by `engine.personalExecutor()`. It exposes assignment-scoped facts, `reportAssignment` and `inputsReadAssignment`, and has no legacy report, completion, retirement, user control or configuration property. Drivers do not receive the Engine.

Supervisor still owns the atomic attemptId/fenceEpoch/contract check and receipt de-duplication. These core methods only establish the Assignment-level fence. Native facts after logical stop may still update Supervisor's physical records; they must not revive core work. A new core Assignment must wait for Supervisor's old-writer barrier before begin.

## Trusted Completion

`completionCandidate(ticketId)` returns the active candidate. `invalidateCandidate(AssignmentRef)` is used in the same transaction as a structured answer that resumes execution; it adds no duplicate core Input.

`confirmCompletion(CompletionProposal)` only resolves proof via `EngineOptions.completionVerifier`. Its synchronous `resolve` reads trusted records on the same connection and returns:

- Verification with the same Ticket/Assignment/contract/generation, artifact digest and `completionCriteriaDigest(criteria)`.
- Candidate-bound quiescence with a stored identity and the same artifact. The provider must establish actual resource quiescence/freshness, not merely repeat the caller's claim.
- Matching stored human acceptance for all required human criteria, or for human_review mode.

All required machine criteria must PASS with evidence. Human acceptance cannot override FAIL/SKIPPED/NOT_TESTED/NOT_APPLICABLE or missing machine checks. Pending/unread Inputs, changed candidates or stale authorization block completion. Proof lookup is read-only; an accidental reentrant candidate change is rejected. Application command receipts handle response-loss idempotency; confirming an already-ended Ticket is refused.

Only the original Tickets.end writes final lifecycle state and queues the stop effect. Followed-thread merges/closures cannot bypass this personal gate. Dropped/closed/stopped are not successful delivery. Formal personal result replies require a current verified completion; previews/status belong to the application view.

## Scope Of Evidence

The original 144-test legacy baseline plus focused new tests cover domain rules. MemoryRepositories rolls back its own maps only; fake port arrays are not durable transactional effects. Real SQLite, inbox/effect atomicity, physical stop and recovery need WP-02/WP-03 integration. This package does not implement a Work engine, native Driver, UI or production verifier.

The interface decision and exact scope are in `docs/adr/core/0002-personal-completion-and-ports.md` at repository root.
