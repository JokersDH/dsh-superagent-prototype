# G1 Core And Workspace Handoff

Status: **core/contracts slice accepted; overall G1 pending WP-02/WP-03 integration**.

The first core interface was published in commit `56bba3e`; current source adds the required product factory and active workspace. Contracts remain v1.0.0, schema hash `74ffd32d8eed4e88d8d4fdd98f6e84c3bf449a785f2c76ccffee56c0538ffa3d`.

## Delivered

- Formal `packages/orchestrator-core/`, MIT attribution, immutable upstream test copies and a checked per-file adaptation manifest.
- `createPersonalEngine`, opt-in Ticket completion metadata, current-contract/policy guards and rejection of missing persisted personal metadata.
- Assignment-scoped reports/read ACKs; stale reports cannot update a retry's Assignment.
- Monotonic candidate invalidation on receipt/delivery/read, retries/restarts and structured resumption; no duplicate Input for Broker invalidation.
- Trusted record-based completion, artifact/criteria/quiescence/acceptance checks, no empty required set or machine-failure override.
- Ended/retired personal Tickets do not resume; pending old result messages can be withdrawn; historical completion remains recorded.
- Actual frozen execution facade excluding user/completion methods.
- Shared pnpm workspace/root lock, contracts-before-core check, unactivated CI template and a machine-readable partial gate report.

## Actual Checks

| Check | Result |
| --- | --- |
| Original copied core baseline | 144/144, test files byte-identical to upstream |
| New personal core rules | 33/33; total core 177/177 |
| Contracts | 183/183, typecheck/build/generated identity unchanged |
| Provenance | 18 source/test/license files accounted for; each adapted/new file hashed |
| Root prototype after workspace adoption | 1197/1197, typecheck and original build pass |
| Shared check | `pnpm check:g1-core`, result at `reports/releases/g1-core.json` |
| Target Node 24.22.2 | Core/contracts tests, builds and public ESM smoke verified; clean-checkout commits/counts are recorded separately in `reports/releases/g1-core-clean-checkout.json` |
| Runtime/type dependency audit | 19 built runtime files use only node:crypto; 290 compiled type files contain no DSH host dependency |

`pnpm peers check` still reports two existing upstream DSH peer mismatches (cordis-plugin-include/group). Existing dependency versions were retained; root lock changes add product importers/dependencies. The independent core does not import these peers. No claim of original DSH runtime/native compatibility follows from passing tests.

GitHub rejected creation of the CI workflow because the active OAuth credential lacks workflow scope. The workflow is delivered as `tools/bootstrap/templates/core-contracts.workflow.yml` and is not installed under `.github/workflows/`. All PASS claims above are local verification, not a successful GitHub Actions run.

## Storage Handoff

Use public `Repositories`, `Ticket`, `DomainEvent` from the formal core. Repository method signatures stay compatible. Preserve complete Ticket JSON including `completion`; dropping it fails closed in a personal Engine. The core never creates a Work lifecycle table.

Core repository calls, current-contract lookup, proof lookup, domain events, command receipts and queued effects must share the same connection/transaction. Callback ports queue effects only. MemoryRepositories/fake callback arrays do not prove this property.

## Runtime Handoff

Use `engine.personalExecutor()` rather than casting the full Engine to a narrow type. Ingress must atomically validate ticket/assignment/attempt/epoch/contract, persist/dedupe the fact and invoke the scoped core fact. Keep physical cancellation/quiescence observations after core authorization ends. Native turn end is not ready; new pending Assignments wait for old-writer quiescence.

A new writer attempt or changed config under the same Assignment must invalidate the old candidate in the binding/effect transaction, via a scoped progress/blocked report or the coordinator's narrow invalidation port. A new epoch must not leave an old ready candidate valid merely because the Assignment ID stayed unchanged. Checker IDs must resolve to immutable approved definition revisions, not arbitrary worker-edited commands.

Runtime payloads and schemas remain in contracts. Missing shared semantics go through RFC; no private type/schema fork. Module fixtures may be accepted independently, but their ACKs do not become real durability evidence until storage is wired.

## Sync And Integration

In each own worktree preserve changes, fetch origin and merge the approved main baseline into the feature branch. Use `workspace:*` for public sibling packages, build contracts before core, and keep root manifest/lock commits with the main owner. For new owned manifests a temporary pnpm-generated local lock diff may be used for compilation, excluded from the feature commit; report the dependency request.

Next acceptance is a repeatable real-store/fake-subprocess workflow: atomic intake/effect/receipt, current fenced report, unknown-send reconciliation, logical stop versus physical quiescence, and safe restart. Until those dependencies are accepted, CORE-03/05/06/08/09 cross-module assertions and overall G1 remain pending. Real verification/QuestionBroker/native agent/UI workflows are later packages.
