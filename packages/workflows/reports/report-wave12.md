# Wave-12 Agent A handoff

Branch `codex/g2-workspaces-verification`; checkpoints `7a8e099` (source/history fixes) and `6d629ef`
(final code/evidence), merged main `b466bc7` in `59dc388`. Schema stays 18; this wave adds no new
migration and rewrites no v17/v18 body.

## Closed probe cases

`probe-wave12-storage.mjs` is 4/4 PASS:

1. exact own confirmation still produces the same fingerprint with the observed cursor advanced;
2. excluding a row no longer consumes the per-family lookahead, so a fifth/sixth real tail row is
   reported or `bounded`, never complete with an old digest;
3. only the exact original intent event sequence (immediately before the original command event) is
   excluded; a later same-body event changes the fingerprint;
4. a corrupted derived `work_id` is rejected instead of returning the immutable body's actual work
   as a match for a foreign work filter.

Source validation, schema/table inventory and all family reads now share one SQLite read
transaction. Missing `schema_meta`/`event_log`, unknown tables, future schemas and scan limits return
`unsupported`/`bounded` with null fingerprints, never an empty complete source.

## Product evidence

| Check | Result |
| --- | --- |
| storage tests | 87/87 |
| workflows tests | 94/94 |
| application regression | 20/20 |
| verification regression | 23/23 |
| main assistant/reply-process consumers | 75/75 |
| main target consumers | 50/50 |
| storage admission probe | 4/4 |
| typecheck/build + coordinator product strict | PASS |
| packet static check | PASS |
| model/native starts | 0 |

Non-empty snapshot restore is read by the real `CompletedAssistantReplies` consumer; the recovered
reply text is the original artifact body, not a test placeholder. Independent SIGKILL windows cover
before/after result commit, after reply message, and before/after source confirmation.

Scale (`wave12-performance.json`): 10000 bindings insert 1168 ms, history first page 2.5 ms with
`assistant_context_history_scope` `EXPLAIN` plan, bundle lookup 0.2 ms, 13105-row source checkpoint
62.2 ms, snapshot create 325 ms / verify 70.6 ms. A page taken before new inserts still returns the
older tail without duplicates.

## D/E/main inputs

`packages/workflows/docs/wave12-source-delivery.md` gives current schema/family/backup inputs, the
public snapshot recipe, and bad-database/missing-artifact reproductions.

- Main has not wired `RecoverySourceStore` into an actual baseline/prepare/confirm flow, so that one
  composition is **NOT_TESTED**. Activation/start, target materialization, schema18 installation and
  E acceptance remain external and are also NOT_TESTED here.
- Tests, fixtures and the benchmark use temporary state only; the nine user services, old ledgers,
  tar artifacts and prior reports were not touched. Shared main acceptance reports were restored
  rather than overwritten.
