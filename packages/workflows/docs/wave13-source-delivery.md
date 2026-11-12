# Wave-13 A delivery: current source evidence and persistent data

This handoff is for main (baseline consumer), B (existing control data), D (current install input)
and E (independent negatives). It does not grant activation or startup.

## Current schema and source reader

- Read the current schema from `PRODUCT_SCHEMA_VERSION` and `recoverySource.inspect().productSchema`;
  do not hardcode a schema number in a consumer. The current build is schema 18 with append-only v17
  history indexes and v18 reply results; no v1–v16 body was rewritten.
- `store.workflows.recoverySource.inspect({ ignoreCommitted?, maxRows?, maxRowsPerFamily? })` reads
  all migrated logical business/resource/queue families plus `schema_meta`, `event_log`,
  `command_receipts`, `fact_receipts`, artifacts and the stable writer identity. Defaults are 20000
  total and 10000 per family; limits, missing/unknown tables and future schemas return `bounded` or
  `unsupported` with a null fingerprint.
- `ignoreCommitted` is accepted only when the exact activation row passes the shared strict A fact
  mapper (every indexed column and source/target JSON mirror), the original command receipt/event
  match, and the exact intent event (receipt seq - 1) matches. A later same-body event, changed
  command payload, heartbeat-independent writer fields or any other business/resource change stays
  visible. Only `coordinator_instances.heartbeat_at` is volatile.
- A complete logical fingerprint is not physical writer quiescence and never sets
  `startupAvailable: true`.

## Persistent data functions

```ts
store.workflows.assistant.contextHistory.page({ projectIds, conversationId?, workId?, limit?, cursor? })
store.workflows.assistant.replyResults.forRequest(requestId) / forReply(replyMessageId) / put(result)
new WorkflowSnapshots(store).create({ destination })
new WorkflowSnapshots(store).verify(destination)
```

History is newest-first with a stable message tie-break and max 100; the raw cursor only continues
data and main signs the public principal/project-scoped cursor. Reply results join the existing
before-send receipt and a registered content-addressed artifact; a request receipt alone is unknown.

## D/E inputs and negatives

- Required snapshot evidence families include bindings, reply results, recovery activations/intents,
  decisions/settings/contracts/verifications/acceptances, outcomes/reviews and legacy decisions;
  referenced artifacts include review reports, context bundles and completed reply bodies.
- D should freeze the current schema/families/artifacts and verify a snapshot copied to a second
  temporary root. A restored copy is data only: it does not inherit activation, authorization or a
  writer stop proof.
- E reproductions:

```sh
node --test packages/workflows/test/recovery-source.case.ts   # negative rowid, strict activation, event payload, bounds
node --test packages/workflows/test/reply-results.case.ts     # missing/changed artifact, principal/request mismatch, tamper
node --test packages/workflows/test/snapshot-d.case.ts        # missing bundle/result table, byte change, future schema
node --test packages/workflows/test/reply-crash.case.ts       # result/message/source SIGKILL windows
node --test packages/workflows/test/snapshot-crash.case.ts    # snapshot before/after SIGKILL
```

Exact source, commands, exits and limits are recorded in
`packages/workflows/reports/wave13-status.json`.
