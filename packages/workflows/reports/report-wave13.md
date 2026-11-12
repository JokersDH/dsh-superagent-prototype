# Wave-13 Agent A handoff

Branch `codex/g2-workspaces-verification`; checkpoints `565fef0` (strict source fixes) and `d25d9a0`
(snapshot crash + current-schema inputs), merged main `e1e0c97`. Schema remains 18; no new migration
or v17/v18 rewrite this wave.

## Closed source probe

`probe-wave13-storage.mjs` is 4/4 PASS:

1. a normal business change remains visible;
2. a negative-rowid logical row is read from the first batch and its content change changes the
   fingerprint instead of disappearing behind `rowid > -1`;
3. an ignored activation must pass the shared strict A fact mapper across every indexed column and
   `source_json`/`target_json` mirror; a changed `target_json` is rejected;
4. the original command event must still carry `{"status":"recorded"}`; changing it to `rejected`
   rejects the ignore instead of silently excluding it.

The reader validates schema/fact/receipt/events and scans all logical families inside one SQLite read
transaction. Missing `schema_meta`/`event_log`, unknown tables, future schemas and scan limits return
`unsupported`/`bounded` with a null fingerprint; only `coordinator_instances.heartbeat_at` is volatile.

## Product evidence

| Check | Result |
| --- | --- |
| storage | 87/87 |
| workflows | 100/100 |
| application | 20/20 |
| verification | 23/23 |
| main product/history/reply consumers | 88/88 |
| main target consumers | 50/50 |
| storage probe | 4/4 |
| typecheck/build, coordinator product strict | PASS |
| packet static check | PASS |
| model/native starts | 0 |

Non-empty source tests combine work, queue, runtime binding/current with fenceEpoch, context binding
and command receipts; another real SQLite connection write is visible on the next snapshot. Existing
B runtime stores are used directly; no test-only ledger, table or recovery method was added.
Snapshot crash tests kill independent processes before and after snapshot creation, and reply crash
tests cover result/message/source-confirmation windows using the original artifact body.

Scale (`wave13-performance.json`): 10000 bindings, history first page 2.6 ms with
`assistant_context_history_scope`, 13105-row source checkpoint 56.4 ms, non-empty snapshot create
311 ms / verify 70.6 ms.

## D/E/main inputs

`packages/workflows/docs/wave13-source-delivery.md` publishes the dynamic current schema read,
required families, snapshot functions and D/E negative commands. `wave13-status.json` records exact
source/command/exit/scope.

Main has not wired `RecoverySourceStore` into baseline/prepare/confirm; that single composition is
**NOT_TESTED**. Activation/start, target materialization, current-schema installation and E release
acceptance remain external and are also NOT_TESTED. Tests use temporary state only; ten user
services, old ledgers/tars and shared acceptance reports were not touched.
