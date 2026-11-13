# Wave-16 A data recipe: versioned snapshots and non-empty restore

A owns `packages/storage` and `packages/workflows`; no HTTP/UI/contract/authorization changes.

## Snapshot evidence versioning

- Current creation uses `workflow-snapshot/2` and `workflow-evidence/2`.
- `workflow-evidence/2` has `familySetVersion: 2` and must match the **exact current 21-family set**,
  the per-family count/digest/truncated values and the overall digest. Removing a family, keeping one
  family, duplicating a name, inventing a family or claiming a future version is blocked.
- Historical `workflow-snapshot/1` manifests without `familySetVersion` remain verifiable only for
  the families they actually recorded. They are not silently upgraded to the current full claim.
- Current families: decisions, legacy_decisions, proposals, project_settings, contracts,
  verifications, acceptances, outcomes, reviews, recovery_intents, assistant_context_bindings
  (including `work_id`), user_questions, answers, answer_deliveries, effect_queue, runtime_bindings,
  runtime_current, resource_observations, dispatch_receipts, assistant_reply_results,
  recovery_activations.
- Referenced artifacts include review reports, context bundles and completed reply bodies; maximum
  tested bundle is 524288 bytes.

## Run the actual producer → restore chain

```sh
node --test packages/workflows/test/wave16-candidate-restore.case.ts
node --test packages/workflows/test/wave16-question-restore.case.ts
node --test packages/workflows/test/snapshot-d.case.ts
```

- Candidate test: local SDK mock → A18 completed result → candidate GET/prepare over actual HTTP →
  explicit proposal confirmation (decision version/receipt) → snapshot → second root restore.
- Question test: actual controlled Application/Broker/fixture Runner → real Work/Ticket/link,
  question/answer/native delivery, queue/runtime resources → snapshot → second root restore.
- Neither restored copy gains startup authority; `recoveryTargetInventory.inspect` remains
  `startupAvailable: false`.

## D/E inputs

- D may use the public `WorkflowSnapshots.create/verify` recipe and the exact family list above; do
  not trim the list or rewrite `familySetVersion`.
- E negatives:
  - remove `effect_queue`, keep only one family, duplicate a family, unknown family, future version;
  - change binding `work_id`, queue body, reply body, question/answer row or artifact bytes;
  - missing table/artifact, partial manifest, future schema, old v1 manifest subset.
- Main source inspect/prepare is a separate actual consumer. `POST /v1/recovery/commit` and private
  authorization are still not implemented and are NOT_REACHED; this recipe never grants them.

Exact source, commands and exits are in `packages/workflows/reports/wave16-status.json`.
