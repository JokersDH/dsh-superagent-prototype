# Wave-06 A integration closure: durable consumers, acceptance, C and snapshots

- Branch: `codex/g2-workspaces-verification`
- Main base: `6f6edde`; merge checkpoint: `66360f7`
- Runnable checkpoint: `c3990c2`; final source commit is recorded in `reports/wave06-status.json`
- Owned paths: `packages/storage/`, `packages/workflows/`
- Model tasks: **0**; unknown sends: **0**; no user service, account or native run

## A1–A6

| Phase | Result | Evidence |
| --- | --- | --- |
| A1 compatible checkpoint | PASS package-local | v13 store + shared parsers on merged base 6f6edde; real ProductStore/UoW tests; typecheck/build |
| A2 accepted event → outcome | PASS package-local | same-transaction consume, replay/reopen no double count, failure rolls back, new candidate separate outcome, unknown timing stays null |
| A3 bounded source/timeline reads | PASS package-local | exact project/work/source/timeline reads; main attention already consumes `index.listWorks`; no second lifecycle |
| A4 real C consumer | **PASS (main composition)** | A-owned real-SQLite C suite 4/4 + main-owned decision HTTP/transaction suite 8/8 executed read-only on this base; old “C consumer missing” blocker removed |
| A5 D snapshot/migration | PASS package-local | schema-13 snapshot with decisions/settings/contracts/verification/outcomes/ReviewTiming/review refs; evidence summary; missing file, corrupt byte, re-recorded DB hash, future schema and migration refusal covered; byte-copy restore recipe |
| A6 bounded verification | PASS package-local | 31 workflow / 75 storage / 16 application / 23 verification; fixed-seed benchmark; documented limits |

## Commands and results

```sh
./packages/storage/node_modules/.bin/tsc -p packages/storage/tsconfig.json       # PASS
./packages/storage/node_modules/.bin/tsc -p packages/storage/tsconfig.build.json
./packages/storage/node_modules/.bin/tsc -p packages/workflows/tsconfig.json    # PASS
./packages/storage/node_modules/.bin/tsc -p packages/workflows/tsconfig.build.json

cd packages/storage && node --test test/*.case.ts       # 75/75
cd packages/workflows && node --test test/*.case.ts     # 31/31
cd packages/application && node --test test/*.case.ts   # 16/16
cd packages/verification && node --test test/*.case.ts  # 23/23

# main-owned suites, executed read-only on this merged base
node --test tests/integration/decision-commands.case.mjs  # 8/8
node --test tests/integration/review-timing.case.mjs      # 3/3

cd packages/workflows && node examples/d-snapshot-restore.mjs
cd packages/workflows && node examples/routing-benchmark.mjs
```

Evidence: `reports/wave06-storage-tests.txt`, `reports/wave06-workflow-tests.txt`,
`reports/wave06-application-regression.txt`, `reports/wave06-verification-regression.txt`,
`reports/wave06-decision-integration.txt`, `reports/wave06-review-timing.txt`,
`reports/wave06-d-snapshot-recipe.json`, `reports/wave06-performance.json`,
`reports/wave06-status.json`.

## A2: acceptance in the accepting transaction

`createWorkflowPorts(store).acceptance.consume({eventSeq, projectId, profileRef, layer})` reads the
existing main accepted event (payload `{candidate, actorRef, reviewTiming}`) and writes one
deterministic `ExecutionOutcome` when the candidate, work project, unique ended attempt binding,
verification and acceptance/event reference all match. Main can call it inside the same
`acceptCommand` UnitOfWork: a later failure rolls the outcome back with the acceptance, and the
accepted event is not appended twice. Re-consuming after reopen returns `replayed`; a new candidate
generation creates its own outcome while the older accepted outcome stays readable. Missing attempt,
verification, acceptance or wrong project yields `incomplete` with reasons and no write. Usage stays
`unknown`; `ReviewTiming` is copied (null stays null, UI proxy is not human time).

## A4: C consumer verification

C's real `AssistantDecisionStore`/`DecisionTransactionService` consume A's synchronous
`AssistantStatePort` and `sourceMessage` index. A's own `decision-consumer.case.ts` proves on real
SQLite: prepare is read-only; commit joins the caller UoW with event/receipt; same-body replay is
idempotent; changed body conflicts; revoke appends a version and a stale revoke conflicts; a revoked
decision cannot be a supersession base; source edit/delete reports stale/missing and blocks commit;
a receipt failure rolls back decision rows, event and receipt. Main's own composition suite (8/8)
additionally covers signed preview expiry, grant drift, HTTP identity/schema, recovery read-only and
non-trusted sources. This is controlled/composition evidence, not native execution or a pilot result.

## A5: snapshot evidence for D

The snapshot manifest now includes a bounded `workflow-evidence/1` summary: for each family
(decisions incl. body ledger, legacy decisions, proposals, project settings, contracts,
verifications, acceptances, outcomes, reviews) it records the count and a SHA-256 over identities and
actual row bodies. `complete=false` when a family exceeds 2000 rows. Verification recomputes the
summary, so a row change is blocked even if the database file hash and manifest bytes were
re-recorded. A DB schema newer than this build is blocked (`incompatibleSchema`) and the migration
entry refuses to open it. `examples/d-snapshot-restore.mjs` creates, verifies, byte-copies and
re-verifies a schema-13 snapshot containing a decision, an outcome with ReviewTiming and an artifact.

This is a storage-layer recipe, not a restore implementation: D still owns relocation, first-run,
rollback and explicit re-authorization; the recipe never starts business effects.

## Remaining gaps (owner)

- **main**: call `acceptance.consume` from the real `accept_candidate` transaction (not yet wired);
  keep ReviewTiming observational and avoid a second accepted event.
- **main/C**: any further routing/attention integration uses the same `routingEvidence` port and
  shared schemas; A does not add HTTP/UI.
- **D**: actual restore/upgrade/new-authorization flow; A provides bytes, evidence summary and
  verification negative cases only.
- **B/E**: native control, pilot and value claims; untouched by A (0 model tasks).
- **Dependency request**: `packages/workflows` now declares test-only `@personal-agent/knowledge`
  (`workspace:*`) for the real C consumer test; main regenerates the authoritative root lock.

## NOT_TESTED

Native/Codex execution, E's review pilot, browser/product acceptance, multi-user ACL, real restore on
another machine and large-sample benefit remain NOT_TESTED. Package tests use temporary SQLite state;
none of the results above is a full personal-Alpha or G3 admission.
