# Wave-17 Agent A handoff

Branch `codex/g2-workspaces-verification`; early `27e5ef8`, mid `4402f20`, final status this commit.
Merged main `6050b4b` (source confirmation checkpoint). Schema remains 18; no migration added.

## Closed new snapshot boundaries

- Format must pair: `workflow-snapshot/2` requires `workflow-evidence/2` + `familySetVersion:2` and the
  exact 21-family set; `snapshot/1` requires evidence/1 with no version and only its recorded
  families. Mixed pairs, v2 without version, v2 with evidence/1 and future versions are blocked.
- `inspectSchemaInventory` reads actual tables/named indexes against the migration registry. A current
  snapshot is blocked when an empty required table (`assistant_reply_results`) is dropped, a required
  index is missing or an unknown table appears, even after the DB hash is re-recorded.
- The legacy v1 positive control remains valid for its recorded families; it cannot be relabeled as
  current v2 capability.

## Actual source confirmation and second-root recovery

- Main's real `POST /v1/recovery/source/prepare`/`confirm` and audit are consumed directly: 14/14 new
  HTTP/process tests and 106/106 clean recovery/candidate/proposal combination pass. Prepare writes
  nothing; confirm writes the exact A fact/event/receipt in the source UoW; exact `ignoreCommitted`
  rejects any other queue/business/resource change; the original same-channel token replays the
  original result across expiry/reopen. It remains `not_granted`/`startupAvailable:false`.
- Candidate and real controlled question/answer workflows are snapshotted, copied to a second root,
  and opened by the actual `recovery_readonly` runtime/HTTP. The original reply/message/question/
  answer rows are readable, the old held queue is unchanged, a business POST is rejected and no
  model/native send occurs.
- Independent SIGKILL windows cover source transaction before/after, result/message and snapshot
  registration. A partial manifest is not restored; original artifact bodies are replayed once.

## Evidence

| Check | Result |
| --- | --- |
| storage | 87/87 |
| workflows | 109/109 |
| application | 20/20 |
| verification | 23/23 |
| source prepare/confirm/audit | 14/14 |
| recovery candidate/proposal combination | 106/106 |
| main product/history/reply | 89/89 |
| main target | 50/50 |
| candidate consumer | 31/31 |
| product execution | 20/20 |
| fixed snapshot probe | 4/4 |
| typecheck/build, coordinator strict | PASS |
| packet static check | PASS |
| model/native | 0 |

Scale (`wave17-performance.json`): 10000 bindings first page 3.8 ms; 13105-row source 73 ms; bounded
1000 rows stops after 28 families in 1.9 ms; snapshot create 350.7 ms / verify 73.7 ms. Format/schema
failures reject before body/artifact reads.

## Not reached

Private startup permission, physical writer quiescence and target activation remain main-owned and
NOT_REACHED. D installation and E independent acceptance are external. Restored snapshots never
carry executable authorization. Only temporary state was used; twelve user services, old
ledgers/tars/profiles and shared acceptance reports were untouched.
