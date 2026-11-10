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

- confirmation requires explicit `expectedVersion` + `expectedDigest`, the same actor and an
  optional physical-barrier callback (`ok: false` blocks confirmation);
- repeated confirmation with the same version/digest is idempotent and returns the original intent;
- old, rejected, superseded or expired proposals are refused;
- a proposal id is idempotent for the same payload and conflicts when the payload/bindings change.

`ProposalIntent` is the only output and deliberately omits actor, command id and work scope. Main
builds the deterministic `UserCommand` and re-checks actor/project/scope/contract/barrier.

## Commands

```sh
pnpm --filter @personal-agent/proposals typecheck
pnpm --filter @personal-agent/proposals test
pnpm --filter @personal-agent/proposals build
```

All tests are no-model: structured/plain/invalid output, forged identity/tool/scope, cross-project,
same-id changed payload, stale contract, duplicate confirmation, rejection, supersession and expiry.
No execution occurs before confirmation.

## Limits

- The package does not call a model or decide when to propose.
- Persisted proposal history is main's storage concern; this registry is the in-memory domain
  implementation/fixture. A persisted adapter must preserve the same version/digest/idempotency rules.
