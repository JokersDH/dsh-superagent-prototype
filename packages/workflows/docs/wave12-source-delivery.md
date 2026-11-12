# Wave-12 A delivery recipe: logical source, history and durable replies

This recipe is for D (current install inputs), E (independent negative checks) and main (baseline
composition). It is not a startup grant: `recoverySource.startupAvailable` is always false and an
empty or complete inventory never proves a physical writer stopped.

## Current schema and required storage

- Product schema: 18. A-owned append-only migrations: v17 `assistant-context-history-index`,
  v18 `assistant-reply-results`; v1–v16 bodies are unchanged.
- Source reader: `store.workflows.recoverySource.inspect({ ignoreCommitted?, maxRows?, maxRowsPerFamily? })`.
  It reads every migrated business/resource/queue family plus `schema_meta`, `event_log`,
  `command_receipts`, `fact_receipts`, artifacts and the stable writer identity. `maxRows` defaults
  to 20000 and `maxRowsPerFamily` to 10000; hitting either, a missing/unknown table or a schema
  mismatch returns `bounded` or `unsupported`, never `complete`.
- History: `store.workflows.assistant.contextHistory.page({ projectIds, conversationId?, workId?, limit?, cursor? })`.
- Replies: `store.workflows.assistant.replyResults.forRequest/forReply/put`; reply artifacts are
  registered content-addressed bodies, at most 512 KiB.
- Snapshot families include `assistant_context_bindings`, `assistant_reply_results`,
  `recovery_activations`, `recovery_intents`, outcomes/reviews/decisions/settings/contracts/
  verification/acceptance and legacy decisions. `referencedArtifacts` includes review reports,
  context bundles and completed reply bodies.

## D: public snapshot recipe

```sh
pnpm --filter @personal-agent/storage --filter @personal-agent/workflows build
node --test packages/workflows/test/snapshot-d.case.ts
```

Use `WorkflowSnapshots(store).create({ destination })` on a real non-empty state, copy the snapshot
directory to a second temporary root, then `verify(secondRoot)`. A blocked snapshot means missing
table, changed evidence body, missing referenced artifact, integrity failure or a future schema. A
restored database is auditable data only; do not start a target or inherit an activation from it.

## E: bad database and missing artifact reproductions

```sh
node --test packages/workflows/test/recovery-source.case.ts   # missing schema/event tables, forged ignore, bounded tails
node --test packages/workflows/test/reply-results.case.ts     # missing/changed artifact, foreign principal, tampered row
node --test packages/workflows/test/snapshot-d.case.ts        # missing bundle/result table, result byte change, future schema
node --test packages/workflows/test/reply-crash.case.ts       # real SIGKILL windows and original-body recovery
```

The exact tested source and command exits are recorded in `packages/workflows/reports/wave12-status.json`.
