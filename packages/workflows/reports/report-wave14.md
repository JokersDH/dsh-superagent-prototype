# Wave-14 Agent A handoff

Branch `codex/g2-workspaces-verification`; checkpoints `87504a9` (source bounds) and `794b5aa`
(restore/crash/scale), merged main `1453cf2` in `8fd1aeb`. Schema remains 18; no migration was added
or rewritten.

## Source and exclusion closure

The accepted wave-13 probe is re-run unchanged against this source: **4/4 PASS** (normal business
change, negative rowid, activation index/mirror mismatch, command-event payload). Additional wave-14
checks cover:

- rowids above `Number.MAX_SAFE_INTEGER` read exactly via text/BigInt cursor, and a content change is
  visible;
- the ignored command and intent events must retain their exact inline payload and a null
  `payload_ref`;
- the total row budget stops scanning further families instead of only truncating output;
- a later same-body intent event, changed receipt/result body, missing `schema_meta`/`event_log`,
  unknown tables and future schemas are rejected or non-complete.

All validation, schema inventory and family reads stay in one SQLite read transaction; only
`coordinator_instances.heartbeat_at` is volatile. A complete logical snapshot never grants startup.

## Product evidence

| Check | Result |
| --- | --- |
| storage | 87/87 |
| workflows | 105/105 |
| application | 20/20 |
| verification | 23/23 |
| main product/history/reply consumers | 88/88 |
| main target consumers | 50/50 |
| fixed-source storage probe | 4/4 |
| typecheck/build, coordinator product strict | PASS |
| packet static check | PASS |
| model/native starts | 0 |

A non-empty snapshot containing work/contract/decision/context/reply/receipt/artifacts is copied to a
second temporary root; the real consumer reads the original message, contract, request receipt and
reply body. Existing B runtime bindings/current/fenceEpoch and the original command receipt survive
reopen. Independent processes are SIGKILLed around result/message/source-confirmation and snapshot
creation; a partial snapshot without a manifest is blocked.

Scale (`wave14-performance.json`): 10000 bindings, history first page 6.6 ms; complete 13105-row
source 65.9 ms; bounded `maxRows=1000` scan stops after 28 families/1000 rows in 1.8 ms; non-empty
snapshot create 460.9 ms and verify 70.6 ms. First history page does not read artifact bodies.

## Consumers and remaining dependency

`packages/workflows/docs/wave14-consumer-map.md` gives the exact main/B/D/E calls. Main still has no
actual baseline/prepare/confirm consumer of `RecoverySourceStore`, so that one composition is
**NOT_TESTED**. Activation/start, target materialization, current-schema installation and E release
acceptance remain external and are also NOT_TESTED. Tests use temporary state only; eleven user
services, old ledgers/tars and shared acceptance reports were not touched.
