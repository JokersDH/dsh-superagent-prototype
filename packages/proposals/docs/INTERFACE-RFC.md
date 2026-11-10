# C1 interface RFC — structured proposals

Status: implementation checkpoint. Branch `codex/g3-assistant-context`, base `origin/main`
`3957e30`. Owner: Agent C. Owned paths: `packages/proposals/`.

## Purpose

Let the **existing** reasoner propose work/revision/decisions through structured output while this
module owns parsing, source/project/contract binding, currency and confirmation state. It never runs
a model loop, begins work, runs commands, expands scope or writes a project.

## Consumed shared semantics

`ReasonerProposal`, `ContractRef`, `Scope` from `@personal-agent/contracts`. The shared
`ReasonerProposal` schema is the only accepted executable shape. No private proposal wire type is
defined.

## Required inputs from main

`ProposalTrustedContext` must be supplied from trusted state, never from model output:

| Field | Meaning |
| --- | --- |
| `actorRef` | authenticated local actor |
| `projectId` | current project |
| `grant` | current conversation authorization (`grantId` + `Scope`) |
| `sourceMessageId` | persisted user message that caused the proposal |
| `contract?` | current contract for `propose_revision` |
| `expiresAt?` | caller-selected validity (default TTL 15 minutes) |

Main's model adapter either supplies parsed structured output or a normal reply. Plain text,
Markdown and fenced JSON are never scanned for commands.

## Confirmation contract

`confirm(proposalId, {expectedVersion, expectedDigest, actorRef, barrier?})` re-validates:

1. proposal is `pending` and not expired;
2. actor owns the proposal;
3. version and payload digest still match the reviewed proposal;
4. optional physical-barrier callback returns `ok: true`.

Success returns a `ProposalIntent`; repeated identical confirmation is idempotent. Failed barrier or
stale/mutated/forged confirmation produces no intent.

Main then builds the deterministic `UserCommand` and re-checks actor, project/scope, expected
contract and physical barrier. `ProposalIntent` contains no actor, command id or work scope.

## Intent mapping

| Proposal | Intent | Main command |
| --- | --- | --- |
| `reply` | `reply` | display only |
| `propose_work` | `create_work` (project, goal, source) | `create_work` with user-confirmed scope/criteria/profile |
| `propose_revision` | `revise_work` (expected contract, rationale) | `revise_work` with user-confirmed new contract |
| `propose_decision` | `record_decision` (content, scope, source) | `record_decision` |

## Evidence

- `test/proposals.case.ts` — plain/Markdown/invalid output, forged actor/tool/scope, cross-project,
  source mismatch, stale contract, idempotent create/confirm, duplicate confirmation, rejection,
  supersession, expiry, barrier block, intent shape.
- 10/10 package tests pass; `typecheck` and `build` pass.

## Gaps

1. **Main**: persist proposal records/idempotency or keep the registry process-local; either way the
   same version/digest/actor rules must hold.
2. **Main**: model adapter must mark whether structured output was available; malformed JSON falls
   back to a normal reply, not an executable guess.
3. **Main**: physical-barrier implementation and command revalidation are outside this package.
4. Proposal delivery over HTTP/SSE DTOs is main-owned.

## Wave-04 C2 — persisted prepare/commit

`AssistantProposalService` consumes the shared synchronous `AssistantStatePort.proposals`:

- `prepare` is read-only: structured parse, trusted source/project/contract/scope binding, immutable
  candidate with conversation id and source text digest.
- `persistPending` writes version 1 `pending` in main's UnitOfWork.
- `commit` synchronously re-checks actor, expected version/digest, persisted source identity,
  expiry, optional current-authorization `revalidate` and physical barrier, then writes version 2
  `confirmed` with the main-owned `effectCommandId`. The command/receipt/event must commit in the
  same transaction.
- Same effect command replay is idempotent; another effect command/actor/payload conflicts.
- `reject`/`expire`/`supersede` append version 2 with the corresponding state.

`InMemoryAssistantState` is the reference port fixture. Real SQL persistence is A-owned and
**NOT_TESTED** here; the shared persisted proposal has no rejection-reason field, so the reason stays
caller-side audit.
