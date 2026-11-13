# Wave-18 Agent A handoff

Branch `codex/g2-workspaces-verification`; source checkpoint `9972c42`, final status this commit.
Merged main `e438ab5`. Schema remains 18; no migration added.

## Genuine legacy v1 compatibility

The previous "legacy" unit case relabeled a new v2 snapshot and removed families. The verifier now
has version-aware evidence specs:

- v2: `workflow-snapshot/2` + `workflow-evidence/2` + `familySetVersion:2`, exact current 21-family
  set, binding body includes `work_id`.
- v1: `workflow-snapshot/1` + `workflow-evidence/1` without version, exact historical 13-family set
  and original fields, with no binding `work_id`.
- Mixed versions, v2 without version, future versions and v1 subsets are blocked.

`probe-wave18-context.mjs` against a real old v1 worktree producer is **2/2 PASS** for empty and
non-empty binding snapshots; the candidate verifier accepts both. Required schema inventory still
rejects a missing empty table, missing index or unknown table even after DB hash rewrite.

## Real confirmation and combined recovery

Main source prepare/confirm/audit is consumed directly: 14/14 new tests and 106/106 clean recovery/
candidate/proposal combination pass. Prepare writes nothing; confirm records the exact A fact/event/
receipt in the source UoW; exact `ignoreCommitted` rejects other queue/business/resource changes; the
original same-channel token replays the original result after reopen without reauthorization. It
remains `not_granted`/`startupAvailable:false`.

One combined non-empty snapshot now contains a real SDK candidate/explicit decision, a real HTTP
context binding, Work/Ticket/link, original question/answer/delivery, held queue, runtime resources
and source activation/receipt. It is copied to a second root and opened by actual
`recovery_readonly` runtime/HTTP: history and original reply are readable, held queue unchanged,
business POST rejected, and no model/native send occurs.

## Evidence

| Check | Result |
| --- | --- |
| storage | 87/87 |
| workflows | 109/109 |
| application | 20/20 |
| verification | 23/23 |
| source confirmation | 14/14 |
| recovery combination | 106/106 |
| main product/history/reply | 89/89 |
| main target | 50/50 |
| candidate consumers | 31/31 |
| product execution | 20/20 |
| genuine v1 producer probe | 2/2 |
| current v2 snapshot probe | 4/4 |
| typecheck/build, coordinator strict | PASS |
| packet static check | PASS |
| model/native | 0 |

Scale (`wave18-performance.json`): 10000 bindings; bounded 1000 rows/28 families 2.8 ms; snapshot
create 428.3 ms / verify 105.4 ms with schema inventory; response bodies remain lazy.

## Not reached

Private startup permission, physical writer proof and target activation remain main-owned and
NOT_REACHED. D installation and E acceptance are external. Snapshots never carry executable
authorization. Only temporary data was used; twelve user services, old ledgers/tars/profiles and
shared acceptance reports were untouched.
