# Wave-16 Agent A handoff

Branch `codex/g2-workspaces-verification`; early `4968e65`, mid/final code `60a23e0`, then this
status commit. Merged main `a64a127`. Schema remains 18; this wave adds no migration and rewrites no
v17/v18 body.

## Complete, versioned snapshot evidence

The previous compatibility check accepted any non-empty family subset, so deleting `effect_queue` or
keeping one family still verified. It is now explicit:

- new snapshots write `workflow-snapshot/2` and `workflow-evidence/2` with `familySetVersion: 2`;
- verification requires the exact current 21-family set, per-family count/digest/truncated values and
  the overall digest;
- removing a family, keeping one, duplicating/unknown names or a future version is blocked;
- legacy `workflow-snapshot/1` manifests without a version are verified only for the families they
  actually recorded, and are not silently promoted to the current full claim.

The fixed-source probe is 4/4 PASS, including a non-empty snapshot with a real queue row and a
positive control.

## Real producer and cross-root recovery

- **Candidate**: local SDK mock → A18 completed reply → actual candidate GET/prepare → explicit
  proposal confirmation (decision version and receipt) → snapshot → second private root restore. The
  restored store reads the original reply artifact body, proposal state, decision and receipt.
- **Question/answer**: the actual controlled Application/Broker/fixture Runner creates real
  Work/Ticket/link, an original question, answer and native delivery plus queue/runtime rows. The
  second-root restore reads all of them; `recoveryTargetInventory` remains `startupAvailable:false`.
- `wave16-data-recipe.md` gives D/E the exact commands, family list/version, 512 KiB bundle limit and
  negative matrix.

## Evidence

| Check | Result |
| --- | --- |
| storage | 87/87 |
| workflows | 109/109 |
| application | 20/20 |
| verification | 23/23 |
| main product/history/reply | 89/89 |
| main target | 50/50 |
| candidate consumer | 31/31 |
| product execution | 20/20 |
| source inspect/prepare combination | 66/66 |
| snapshot probe | 4/4 |
| typecheck/build, coordinator strict | PASS |
| packet static check | PASS |
| model/native | 0 |

Scale (`wave16-performance.json`): 10000 bindings first page 3.8 ms; complete 13105-row source 73 ms;
bounded `maxRows=1000` stops after 28 families in 1.9 ms; 512 KiB bundle; snapshot create 570.1 ms /
verify 80.6 ms.

## Not reached

Main still has no actual source confirm/private authorization/target start; the actual commit route
returns 422. That item is **NOT_REACHED** and separate from the passing inspect/prepare, candidate
confirmation and product execution. Physical writer stop, D installation and E acceptance remain
external. Restored snapshots never inherit executable authorization. Tests used temporary state only;
twelve user services, old ledgers/tars/profiles and shared acceptance reports were untouched.
