# G1 Fact Ingress Handoff

Date: 2026-11-07. **Ingress interface and review-fixture scope accepted; full G1 remains pending production wiring and follow-up owner fixes.**

Later update: owner fixes in A `a8d7f10` / B `40ae102` now pass both reproduction suites; the first actual production-store/controlled-process adapter is implemented. See [g1-production-handoff.md](g1-production-handoff.md) for the current acceptance and next tasks. The below text preserves the earlier version-scoped review.

## Main-Agent Delivery

`apps/coordinator/runtime-ingress.ts` implements the authoritative admission module described by ADR 0004. It consumes a trusted bound Runner identity, validates the immutable kind/value payload and SHA-256, and applies known/current binding, Assignment/contract/authority and receipt checks inside one synchronous outer transaction.

Exact duplicates return their committed original receipt without reapplying, including after stop/revocation. Same-ID/different-body conflicts. New stale business facts are refused; known historical physical observations can still be recorded without resuming or completing core work. Context is copied before async reads, and current identities are checked after those reads. Native async reducers and enclosing transactions are refused, and a store cannot produce a successful receipt without the matching applied/persisted fact.

Public wire contracts/hash remain v1.0.0; no private wire schema or production runtime SQL schema was added. A production RuntimeIngressStore adapter and authenticated IPC context are still needed. The actual SQLite fixture explicitly creates `review_ingress_*` tables only in temporary test databases; production migrations remain A's responsibility.

## Actual Verification

| Check | Result |
| --- | --- |
| Deterministic ingress/core tests | 18/18 |
| Native SQLite admission/rollback/reopen tests | 7/7 |
| Clean checkout, target Node 24.22.2, frozen lock | 25/25, builds/typecheck pass, lock unchanged |
| Current storage package | 44/44, strict typecheck passes |
| Effects package | 8/8 |
| B repaired branch `d213d94` | 85/85 on target Node 24.22.2 |
| Original root regression after integration | 1197/1197, typecheck/build pass |

Run `pnpm check:g1-ingress`; reports are `reports/releases/g1-ingress.json` and `g1-ingress-clean-checkout.json`. Core's prior 178-test and contracts' 183-test evidence is unchanged. The original DSH CommonJS build recommendation remains a warning, not a new failure.

## Review Update

A's first fixes are already present in integrated main; they were preserved. B's `d213d94` was reviewed from a separate clean checkout and is not enabled as a production runtime. The initial seven blocking reproductions now pass at those measured revisions (`g1-review-repros.json`); MAIN-SYNC-BRIDGE also passes.

New follow-up reproductions still fail (`g1-review-followup.json`): native async callback body can write after await/rollback; answer key delimiters collide; deliver expectedTurnRef changes do not change ID; an ended epoch can be reused; cancellation during an awaited launch still permits begin afterward. The process stop polling also needs a referenced lifetime and observation-error handling before general admission.

The full instructions and commands are in `agent-tasks/g1-followup-review.md`. The failed scope is not hidden by passing module counts, and the unsafe runtime is not wired to a user-facing coordinator.

## Next Integration

1. A fixes the remaining async boundary, then supplies production known/current binding history, owned resources, immutable payload metadata and transactional reducers through the single migration owner.
2. B fixes the remaining command/recovery races and routes authoritative facts through the bound ingress sink. Diagnostic local prechecks must not lose old physical observations or known duplicate ACKs.
3. Main replaces review-only repositories with production adapters and repeats real-store/controlled-subprocess rollback, stale/duplicate, stop and restart cases. Only then evaluate full G1 admission.

No server was started because this is not an HTTP/UI app yet. No vendor model, credentials, global runtime changes or learning experiments were used. CI remains an unactivated template due to the previously recorded workflow permission limitation.
