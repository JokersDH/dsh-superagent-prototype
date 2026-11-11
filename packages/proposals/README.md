# Structured proposals

Parses the existing reasoner's **already structured** output into a validated proposal, binds it to
trusted source/project/authorization/contract identities, tracks currency/state and produces a typed
intent only after explicit confirmation. This package has no model loop, executor, scheduler or
command builder.

## Parsing

`parseStructuredOutput(raw)` accepts only:

- an object with `kind` that parses with the shared `ReasonerProposal` schema;
- otherwise a plain-text reply (`not_structured`) or an `invalid_proposal` with issue paths.

Markdown, fenced JSON and fuzzy prose are **never** parsed into an executable action. A plain reply is
returned with `executable: false`.

## Binding

`ProposalRegistry.create({proposalId, payload, trusted})` requires trusted values:

- `actorRef` from the authenticated actor (never from the model);
- `projectId` and a current conversation `grant.scope` (source/project/scope checks);
- the trusted `sourceMessageId`;
- the current `contract` for `propose_revision`.

Rules:

- payload source id must equal the trusted source message;
- work/decision proposals must target the same project;
- a decision scope must be contained in the current grant (atom containment, no glob inference);
- a revision must reference the current contract exactly;
- strict schemas reject extra keys, so a model cannot smuggle `actorRef`, `commandId`, `tools`,
  `authorityRef` or an extra work `scope`.

## State machine

States: `pending → confirmed | rejected | expired | superseded`. Rules:

- every confirmation path, including an idempotent replay of a confirmed proposal, authenticates the
  owning actor before any state-specific branch;
- confirmation requires explicit `expectedVersion` + `expectedDigest`, the same actor and optional
  `revalidate`/physical-barrier callbacks (`ok: false` blocks or refuses);
- repeated confirmation with the same version/digest is idempotent and returns the original intent;
- old, rejected, superseded or expired proposals are refused;
- a proposal id is idempotent for the same payload and conflicts when the payload/bindings change.

`ProposalIntent` is the only output and deliberately omits actor, command id and work scope. Stored
records and every returned `create`/`get`/`list`/`confirm` value are independent deep-frozen
snapshots, so a caller cannot mutate an already-reviewed grant, scope or payload. Main
builds the deterministic `UserCommand` and re-checks actor/project/scope/contract/barrier.

## Command plan (wave-06 continuation)

`planProposalCommand(intent, {commandId, conversationId, work?, revision?})` maps a confirmed intent to
the **existing** `UserCommand` that main already dispatches:

| Intent | Command | Extra user-confirmed input |
| --- | --- | --- |
| `reply` | none (`no_effect`) | — |
| `create_work` | `create_work` | `work.scope`, `work.criteria`, `work.profileId` |
| `revise_work` | `revise_work` | complete `revision.goal/scope/criteria` |
| `record_decision` | `record_decision` | — (uses the intent's exact scope/source) |

Missing inputs return `needs_user_input` with the exact field list; a rationale is never turned into a
goal or contract. A confirmed scope for another project is refused. The plan contains no actor field,
adds no command kind and executes nothing.

## Single confirmation entry (wave-07 C3)

`AssistantProposalService.confirmWithCommand(prepared, {..., plan})` is main's one synchronous call:
it validates the plan input **before** confirming (an under-specified work/revision proposal throws
`needs_user_input` with the exact missing fields and stays `pending`), confirms with the main-owned
`effectCommandId` (CAS, idempotent replay), and returns the exact existing `UserCommand` to dispatch
in the same UnitOfWork. A `reply` intent confirms nothing executable and returns `command: null`.
C never dispatches the command, never writes its effect and never accepts actor/native authority from
model text.

## Commands

```sh
pnpm --filter @personal-agent/proposals typecheck
pnpm --filter @personal-agent/proposals test
pnpm --filter @personal-agent/proposals build
```

All tests are no-model: structured/plain/invalid output, forged identity/tool/scope, cross-project,
same-id changed payload, stale contract, duplicate confirmation, rejection, supersession and expiry.
No execution occurs before confirmation.

## Persisted prepare/commit (wave-04 C2)

`AssistantProposalService` consumes the shared synchronous `AssistantStatePort.proposals`:

1. `prepare` is async but read-only: parse + trusted binding + immutable source/grant/contract/payload snapshot.
2. `persistPending` writes version 1 pending inside main's UnitOfWork.
3. `commit` is synchronous, checks actor/version/digest/source, optional current-authorization `revalidate`
   and physical barrier, then writes version 2 confirmed with the main-owned `effectCommandId`.
4. Same effect command replay is idempotent; another effect command, actor, payload or state conflicts.
   `reject`/`expire`/`supersede` append version 2 with the corresponding state.

`InMemoryAssistantState` is the reference port fixture; real SQL persistence is A-owned and
**NOT_TESTED** here.

## Wave-04 checkpoint

The confirmed-replay authorization bypass and the shared-grant mutation are fixed; current
source/grant/contract/scope can be revalidated through `revalidate` on both pending and confirmed
paths. Persisted `AssistantStatePort` prepare/commit is the next stage.

## Limits

- The package does not call a model or decide when to propose.
- Persisted proposal history is main's storage concern; this registry is the in-memory domain
  implementation/fixture. A persisted adapter must preserve the same version/digest/idempotency rules.
