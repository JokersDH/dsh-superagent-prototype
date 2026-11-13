# Wave-20 Agent A handoff

Branch `codex/g2-workspaces-verification`; source checkpoint `8f02bdf`, final status this commit.
Merged main `773b34d`. Schema remains 18; no migration added.

## Strict and real business→personal chain

- Fixed the two real strict failures: the unified fixture supplies a complete `AgentProfile`, and the
  optional `read.recovery` is narrowed after `assert.ok`; no `any` masking.
- `wave20-personal-business` uses one source Store for: real controlled Application/Effects/Broker
  Work/Ticket/question/answer/`native_applied` delivery; local SDK chat/candidate; real HTTP context
  prepare/send. It copies a v1 snapshot to a second root, writes the marker/private credentials, runs
  the actual `review-restored.mjs` CLI to produce a 600 startup config, then starts the actual
  personal `recovery_readonly` demo process.
- Personal HTTP reads candidate/history/frozen sources, the real Work snapshot and the
  `native_applied` delivery. Business answer POST is 422, held queue remains and provider request
  count is unchanged. Work/answer/delivery remain in the restored SQLite.
- Main `restored-personal-review` (11/11) covers unbound 403 → explicit consent → 200 and
  source/root/principal/host/key/expiry/unsafe path/file invalidation.

## Dual format and source confirmation

Default workflow v1 (13 families) and explicit v2 (21 families) remain separate; both keep
non-null/safe-integer/≥1 schema and required table/index/unknown-table guards. Genuine v1 producer
probe is 2/2. Real source prepare/confirm/audit is 14/14 with original fact/receipt/token replay; the
no-op committer remains only a module fixture.

## Evidence

| Check | Result |
| --- | --- |
| storage | 87/87 |
| workflows | 113/113 |
| application | 20/20 |
| verification | 23/23 |
| restored personal process | 11/11 |
| source confirmation | 14/14 |
| recovery combination | 106/106 |
| main product/history/reply | 89/89 |
| main target | 50/50 |
| candidate consumers | 31/31 |
| product execution | 20/20 |
| genuine v1 producer | 2/2 |
| typecheck/build, coordinator strict | PASS |
| packet static check | PASS |
| model/native | 0 |

Scale (`wave20-performance.json`): default v1 create 241.9 ms / verify 63.1 ms (13 families); explicit
v2 create 111 ms / verify 57.9 ms (21 families); personal business test ~1.1 s.

## Not reached

Private startup permission, physical writer proof and target activation remain main-owned and
NOT_REACHED. Personal read consent is not an execution grant. D installation and E acceptance are
external. Only temporary state was used; twelve user services, old ledger/tar/profile and shared
acceptance reports were untouched.
