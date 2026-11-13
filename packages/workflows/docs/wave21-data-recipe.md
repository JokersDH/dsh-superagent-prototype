# Wave-21 A recipe: both workflow formats through actual personal readonly

A owns storage/workflows and tests/reports only; main owns CLI/HTTP/UI.

## Same real data, both formats

```sh
node --test packages/workflows/test/wave20-personal-business.case.ts   # default v1 personal
node --test packages/workflows/test/wave21-personal-v2.case.ts         # explicit v2 personal
node --test tests/integration/restored-personal-review.case.mjs        # actual standard start/reuse + narrow scope
```

Each test builds one real source Store:

1. controlled Application/Effects/Broker/fixture Runner → Work/Ticket/question/answer/native_applied
   delivery + dispatch rows (not an external B reconnect or vendor native);
2. local SDK chat/candidate + real HTTP context prepare/send;
3. a default-v1 or explicit-v2 snapshot copied to a second private root;
4. `review-restored.mjs` writes a 600 startup selection;
5. actual personal `recovery_readonly` demo/HTTP reads candidate/history/frozen source/Work and
   `native_applied` delivery; business POST is 422, held queue unchanged, provider count unchanged;
6. a genuinely signed narrower selection (`src/narrow/`, exclude `src/private/`) is accepted for
   startup, history remains readable, and the original wider binding reports `scope_changed` with an
   empty source list — no signature tampering is used as a Scope test.

Main `restored-personal-review` covers standard `tools/dev/start.mjs`/`pnpm start` actual health
identity: same file reuses a live instance without changing PID; missing/different selection,
port/login differences and restart-with-review are rejected before build/spawn/stop; health digest is
observation, not a grant.

## Formats and guards

- default v1: 13 historical families with old binding field list (no `work_id`);
- explicit v2: 21 families, `familySetVersion:2`;
- both keep non-null/safe-integer/≥1 schema and required table/index/unknown-table checks;
- mixed/subset/duplicate/future manifests, missing artifact/table/index and invalid schema are blocked.

## D/E input

D/E may parameterize install root/state root, producer, format 1|2, new port and review output. They
must use the public CLI/APIs, not hand-written SQL, copied credentials or a fabricated `verifiedBy`.
Source facts/read consent/private permission are separate; restored data never grants execution.

Exact source/commands: `packages/workflows/reports/wave21-status.json`.
