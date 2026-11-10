# C1 interface RFC — explicit decision governance

Status: implementation checkpoint. Branch `codex/g3-assistant-context`, base `origin/main`
`3957e30`. Owner: Agent C. Owned paths: `packages/knowledge/`.

## Purpose

Implement the domain rules for explicit user decisions and knowledge pages over the existing shared
contracts, while storage (A) owns persistence/migrations and main owns commands/HTTP. No fact store
is created in arbitrary JSON, no second DB and no automatic learning.

## Consumed shared semantics

`UserDecision`, `KnowledgePage`, `KnowledgeSourceView`, `InterventionRecord`, `Interpretation`,
`Scope` from `@personal-agent/contracts`.

## Required ports

### A — `DecisionStorePort` (production persistence + migration)

| Method | Semantics |
| --- | --- |
| `append({decision,sourceMessageId,actorRef,recordedAt})` | Append version 1 or an unchanged-payload revision; idempotent for same id/version/digest; conflict for payload mismatch/stale version. |
| `get(decisionId)` | Current revision + derived status (`active/revoked/superseded`). |
| `list({projectId,status?,cursor?,limit})` | Bounded keyset page, project-scoped, newest first. |
| `revoke({decisionId,expectedVersion,revokedAt,actorRef})` | CAS on the expected version; idempotent when already revoked at that version. |

Required persisted fields: append-only revision history, content, scope, authority, source message,
actor, recorded/revoked timestamps, `supersedes`. Migration must be append-only and can be added to
an existing product database without rewriting old decisions.

### Main — `DecisionSourcePort` (read-only provenance)

`getMessage(messageId)` returns role, provenance, project, conversation, title and optional
`questionKind`. It must return persisted trusted-user messages only; absence means missing source.

### Main — command/HTTP composition

Map `UserCommand.record_decision` / `revoke_decision` to `DecisionGovernance` with the authenticated
actor and current `grantScope`; project `KnowledgePage` for the workbench. Do not auto-record from
questions, agent replies or UI display messages.

## Rules

- only `role: user` + `provenance: trusted_user` may be recorded;
- permission/authentication answers are never shared decisions;
- project/scope/source must agree; scope must stay inside the current authorization;
- revoked/superseded/expired decisions are excluded from pages and later context;
- supersession requires the replacement to cover the old scope and the old decision to be active;
- source disappearance keeps the audit record but reports `validity: 'missing'`;
- automatic promotion is closed: one-off goal changes, temporary environment fixes and agent
  deviations are classified as not preferences.

## Evidence

- `test/knowledge.case.ts` — record/page, explicit-user only, permission/auth refusal, cross-project,
  scope escalation, revoke/CAS/idempotency, supersede, expiry, missing source, pagination,
  old-version replay, concurrent conflict, auto-promotion closure.
- `test/consumer.case.ts` — full offline assistant loop (context → mock reasoner → proposal →
  confirmation/rejection → decision → context → revoke).
- 13/13 package tests pass; `typecheck` and `build` pass.

## Gaps

1. **A**: SQL migration + `DecisionStorePort` implementation with real CAS/keyset semantics.
2. **Main**: `record_decision`/`revoke_decision` command and HTTP projection; source provenance port.
3. **Main/A**: project-scoped knowledge page and context integration from persisted decisions.
4. Source validity refresh when conversation messages are archived/deleted is main-owned.
5. Cross-project memory inference, automatic rule promotion and learning-effect claims are out of
   scope.

## Wave-04 C2 — persisted decision adapter and vertical

`AssistantDecisionStore` maps the shared synchronous `AssistantStatePort.decisions` to the decision
port: append-only revisions, source message/conversation/digest retention, CAS revocation and
bounded project scans for supersession. The real SQL implementation/migration is A-owned and
**NOT_TESTED** until `createWorkflowPorts(store).assistant` exists.

`test/vertical.case.ts` runs the zero-model vertical over the in-memory port fixture:
real temp file context -> mock structured reasoner -> pending persisted proposal -> commit with
effect command id, revalidate and barrier -> decision record -> new service instances (state reload)
-> revoke and source disappearance. It also covers commit failure with no receipt, duplicate
confirmation, changed payload, foreign actor, cross-project input, supersession and missing source.
No model, network or SQL call is made.

Remaining gaps: real SQLite adapter/migration (A), main HTTP/provider/UI wiring, a reverse
supersession index for scale (the adapter scans at most 5x200 current project records), and the
main-owned source-provenance freshness feed.
