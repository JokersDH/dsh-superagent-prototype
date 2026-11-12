# Wave-15 Agent A handoff

Branch `codex/g2-workspaces-verification`; checkpoints `c4bd52c` and `9f47f3d`, merged main
`697efdc` in `20e1817`. Schema remains 18; no migration was added or rewritten.

## Actual main consumer (inspect/prepare)

Ran the real main suite directly:

- `tests/integration/recovery-logical-source.case.mjs`: **8/8 PASS**;
- logical source + preflight + activation audit + target service/http + restored startup: **66/66 PASS**.

The product HTTP `GET /v1/recovery/inspect` and `POST /v1/recovery/prepare` consume A's
`logicalSource` coverage/fingerprint. An unlogged business change invalidates a prior preview with
`conflict`; missing/unknown/future/bounded sources expose `source_checkpoint_unavailable` and refuse
prepare; heartbeat changes stay stable while writer identity changes invalidate. Prepare still says
`not_granted`/`commitAvailable: false`.

**Confirm/private authorization and target activation are not implemented** by main: the actual
commit route returns 422. That composition is NOT_TESTED and separate from the passing preflight.

## Data chain

- A second real connection and an independent writer process both change the next logical snapshot;
  a heartbeat-only update does not. Negative rowids and rowids above `MAX_SAFE_INTEGER` are read
  exactly; the total budget stops scanning further families rather than only truncating output.
- A non-empty snapshot now includes work/contract/ticket, decision, context bundle/binding, completed
  reply/result, receipts, queue, runtime binding/current and resource observation. It is copied to a
  second temporary root; main reads the original message, contract, request receipt and reply body.
- Snapshot evidence now covers `effect_queue`, `runtime_bindings`, `runtime_current`,
  `resource_observations`, `dispatch_receipts` and binding `work_id`. A changed queue body or derived
  work index blocks verification even with a re-recorded database hash.
- Independent SIGKILL windows cover result/message/source confirmation and snapshot creation; a
  partial snapshot without a manifest is blocked and recovery only replays the original artifact body.
- Existing B runtime bindings/current/fenceEpoch and original receipts survive reopen; no test-only
  table, second ledger or recovery authority was added.

## Evidence

| Check | Result |
| --- | --- |
| storage | 87/87 |
| workflows | 106/106 |
| application | 20/20 |
| verification | 23/23 |
| main product/history/reply | 88/88 |
| main target | 50/50 |
| actual logical source HTTP | 8/8 |
| recovery preflight combination | 66/66 |
| fixed source probe | 4/4 |
| typecheck/build, coordinator strict | PASS |
| packet static check | PASS |
| model/native | 0 |

Scale (`wave15-performance.json`): 10000 bindings, history first page 5.8 ms; complete 13105-row
source 114.6 ms; bounded `maxRows=1000` stops after 28 families/1000 rows in 3.2 ms; 512 KiB bundle;
non-empty snapshot create 873.8 ms / verify 282.1 ms.

## Remaining dependency

`wave15-consumer-map.md` gives exact main/B/D/E calls. The only missing main piece is real confirm /
private authorization / target startup; it is NOT_TESTED. Logical completeness and restored snapshots
never prove physical writer stop or grant installation/activation. All tests used temporary state;
eleven user services, old ledgers/tars/profiles and shared acceptance reports were not touched.
