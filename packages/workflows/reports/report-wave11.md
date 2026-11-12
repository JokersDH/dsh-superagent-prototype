# Wave-11 Agent A handoff

Branch `codex/g2-workspaces-verification`; early checkpoint `bec0b82`, second `d652ec0`; merged
`origin/main` `b466bc7` in `c2ab04c`. Product schema is 18; migrations are append-only v17
`assistant-context-history-index` and v18 `assistant-reply-results`. No v1–v16 body was rewritten.

## Delivered ports

- `store.workflows.recoverySource.inspect` returns a bounded logical snapshot over 46
  business/resource/queue families plus the stable writer identity. `ignoreCommitted` is accepted
  only after matching the exact A activation row, original command receipt/event, and exact intent
  event. Only `coordinator_instances.heartbeat_at` is volatile; any other confirmation, receipt,
  event, business, resource or writer change is visible. Complete snapshots still expose
  `startupAvailable: false`.
- `store.workflows.assistant.contextHistory.page` gives newest-first project/conversation/work
  keyset paging with a `messageId` tie-break, max 100, and a raw data cursor. Bad rows fail instead of
  being skipped; `bundleStatus` is a registry/digest-only check for main.
- `store.workflows.assistant.replyResults` records a real returned reply only after the existing
  before-send request receipt and a registered artifact. Request and reply identities are both
  unique; same body replays, different body conflicts. A request receipt alone stays unknown.

## Evidence

| Check | Result |
| --- | --- |
| storage tests | 87/87 |
| workflows tests | 88/88 |
| application regression | 20/20 |
| verification regression | 23/23 |
| main assistant consumers | 71/71 |
| main target consumers | 50/50 |
| coordinator product typecheck | PASS |
| packet static check | PASS |
| model/native starts | 0 |

Five independent processes were SIGKILLed at: after before-send receipt/before result, after result,
after reply message, before source confirmation, after source confirmation. Reopen showed one stable
reply at most and no fabricated complete source after an uncommitted confirmation.

Benchmark (`wave11-performance.json`): 100 works 6.1 ms, 1000 works 36.6 ms, 2000-message
conversation 540.6 ms, 5000 bindings 648.3 ms, history first page 3.1 ms, bundle lookup 0.2 ms,
8103-row source checkpoint 38.7 ms, non-empty snapshot create 207 ms and verify 49.4 ms.

## Scope changes and limitations

- One assertion in `tests/integration/assistant-context-product.case.mjs` was updated because the
  real durable result now survives the injected reply failure; the old fixture expected an
  unknown-result notice from its in-process map. Production code was not changed. Main may review or
  revise this test on integration.
- Main still owns history/source HTTP/UI, public cursor signing, recovery activation/start and
  target materialization; those compositions are NOT_TESTED here. A snapshots and restored backups
  never grant startup authority.
- No actual model/provider/native run, installation, upgrade or E acceptance was performed.
