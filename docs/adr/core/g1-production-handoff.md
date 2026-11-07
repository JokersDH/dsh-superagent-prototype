# G1 Production-Store / Controlled-Process Handoff

Date: 2026-11-07. **The reviewed fixes and this integration slice pass. Full G1 recovery admission is still pending the next A/B batches.**

## Current Acceptance

Inputs reviewed independently: A `a8d7f10` (already integrated as `dee7fb5`), B `40ae102` (now merged for integration). Both initial and follow-up reproduction scripts pass at those revisions. No A/B active worktree was edited.

| Check | Actual result |
| --- | --- |
| A storage | 54/54 |
| B Runner / DriverKit / Supervisor / fake agent | 98/98, clean checkout on Node 24.22.2 |
| Both owner reproduction scripts | Original and follow-up invariants PASS |
| Runtime source + tests | Strict TypeScript check passes via `tests/integration/tsconfig.runtime.json` |
| New real production-store / controlled-child slice | 5/5 on Node 24.22.2 |
| Original prototype regression | 1197/1197, typecheck/build pass |

The original 178 core / 183 contract test evidence and 25 ingress interface/SQLite-fixture checks remain separate. Counts are not summed into a product reliability claim.

## New Main-Agent Code

`apps/coordinator/stored-ingress.ts` binds RuntimeIngressStore to the actual ProductStore repositories: known/current binding history, immutable payload files/metadata, current authority, core aggregate and fact receipts. It uses public ports and no private SQL.

Current Policy.revalidate is mandatory in addition to the stored contract authorization. An enabled old row cannot bypass current policy revocation. Turn-ended facts call only the scoped core callback; they do not generate a ready candidate or complete a Ticket.

Config drift atomically invalidates the current candidate, moves the binding to stopping, appends the observation and queues `runtime.reconcile`. A last fact-receipt INSERT failure rolls all of that back with the core change. The queue is a durable request, not proof that a reconciliation worker has already run.

Physical exit/cancel/writer facts remain immutable observations. They do not themselves release a whole process group or end a binding. Runtime observation/resource reduction is the next A-owned storage batch.

## Real Child-Process Integration

`tests/integration/production-runtime.case.mjs` connects the real controlled Runner/Supervisor/FakeDriver to real ProductStore bindings, payloads, events and receipts. It uses a disposable directory and a preseeded authorized core fixture, not an implemented user intake/HTTP flow.

The process host registers its actual resource reference before returning it to the fake Driver. The Driver sends its real NDJSON begin to a real child and normalizes turn/exit facts into the strict bound ingress. Durable receipt sequences agree with the database. Reopening returns the original receipt without another native begin; logical stop precedes physical cleanup, and the exit observation still persists after stop.

Initial ExecutionInput and prepared-policy references are structurally validated and stored. The prepared policy is explicitly a fake/advisory fixture and is not evidence of any vendor permission enforcement. The process-host registration wrapper is an integration fixture; the production per-attempt factory/IPC and resource reducer remain next-batch work.

Run `pnpm check:g1-production`. Result: `reports/releases/g1-production-runtime.json`. The script builds actual dependencies, typechecks composition plus runtime tests, and runs the five process/store cases. It starts no web server or vendor model.

## Next Three-Way Assignment

- **Agent A**: `agent-tasks/g1-agent-a-runtime-state.md`. First enforce current pointer/epoch/resource/authority invariants, then provide transactional physical observations and public reducers through owner-managed migrations.
- **Agent B**: `agent-tasks/g1-agent-b-durable-runner.md`. First strict FakeDriver payloads and per-attempt options isolation, then a bounded durable critical journal and stable fact replay without reissuing business actions.
- **Main Agent**: composition, authoritative ingress, production adapter/E2E and gate review. Replace remaining fixture lifecycle pieces with accepted A/B interfaces, then test crash windows, stopped old bindings, duplicate ACKs and recovery.

Stay on the existing G1 feature branches for these batches, merging the approved origin/main baseline without discarding local changes. Owners submit only their paths; main owns root lock/manifest, contracts and coordinator. Deliver runnable increments, not one giant unreviewed branch.

## Still Not Claimed

Full G1 is not passed: coordinator crash/reconnect, durable Runner journals, production resource-barrier recovery, full question/answer/policy workflows, shared services, performance budgets and all complete gate scenarios are not finished. Vendor Drivers, UI/HTTP, knowledge/learning and product release are later work. The GitHub CI remains a template due to the recorded credential scope limitation; PASS results here are local.
