# Wave-10 Agent A handoff

Branch `codex/g2-workspaces-verification`; checkpoint `8e49d67`; merged `origin/main` at
`86c692f` in merge `9767750`. Product schema is 16; the only new migration is append-only v16
`assistant-context-bindings`.

## Delivered

- **A1** `recoveryTargetInventory` now validates the claimed schema against the tables that
  schema's migrations create, trusts only the exact FTS5 table/shadow set, and hashes the private
  DB/WAL copy it actually inspected. A copy race returns `busy_or_changed` and no digest. The
  official probe is `PASS_RECOVERY_TARGET_INVENTORY_ADMISSION` 4/4.
- **A2** A real new target is created by the public `ProductStore` (never a copy), closed and
  reopened: inventory is complete before and after, with the same table set and zero business rows.
  A manifest-only directory and a half-applied claimed schema are `unsupported`, never empty.
- **A3** `AssistantContextBindings` is exposed at `store.workflows.assistant.contextBindings` and
  `ports.assistant.contextBindings`. `put` is synchronous in the caller's existing chat/receipt
  UnitOfWork. Both message and command identities are unique; the same body replays and any identity
  with a different body conflicts. The binding is schema-validated, requires an existing artifact
  whose digest equals `bundleDigest`, stores only references/digests, and is refused on tampered read.
- **A4** Snapshots include the `assistant_context_bindings` family and treat a missing bundle
  artifact reference or missing binding table as `blocked`. A restored binding remains audit-only:
  inventory of the restored bytes still reports `startupAvailable: false`.
- **A5** Tests cover outer receipt failure rolling back binding and artifact row together, lost
  response/readback replay, conflicting payload digests, invalid scope/freshness/bundle, tampered
  rows, and 500 synchronous bindings in a bounded batch.
- **A6** Post-merge regression: storage 85/85, workflows 62/62, application 20/20, verification
  23/23, typecheck/build PASS, model/native sends 0.

## Not tested / external owners

- Main has not published a context-use HTTP/provider/SSE consumer in this checkout, so actual
  per-message authorization and provider send are NOT_TESTED. Main should call the port inside the
  same confirmation command and receipt.
- D's `RecoveryTargetMaterializer` is external. A only initializes an explicit empty target through
  `ProductStore` and inspects it read-only.
- Recovery activation/start and the physical writer barrier remain main/B-owned. `startupAvailable`
  is false everywhere; an empty inventory is not writer quiescence.
- No model/native execution, installation or E acceptance was run in this wave.
