# Wave-07 A: recovery intent facts, paged evidence and snapshot migration

- Branch: `codex/g2-workspaces-verification`
- Main base: `0df3fd1`; merge checkpoint: `a562a7f`
- Runnable checkpoint: `0c9ca71`; final source: `9f1833d`
- Owned paths: `packages/storage/`, `packages/workflows/`
- Model tasks: **0**; unknown sends: **0**; no user service, account or native run

## Phase results

| Phase | Status | Evidence |
| --- | --- | --- |
| A1 checkpoint | PASS package-local | v14 `recovery_intents`, shared `RecoveryPlan` parser, merged-base rebuild and full regression |
| A2 intent/receipt facts | PASS package-local | immutable one-fact-per-plan, exact replay, drift/expiry/actor/plan conflict, fact+receipt+event rollback, reopen query, old queue byte-identical |
| A3 paged evidence | PASS package-local | `evidencePage` stable cursor with `complete`/`caller_limit`/`storage_cap`; project isolation; 600-row bounded measurement |
| A4 crash/reopen | PASS package-local, activation BLOCKED on main | source-fact commit-before/target-prepare-failure/lost-response/reopen covered; main activation commit is not published (0026), C decision port regression 8/8 |
| A5 snapshot/migration | PASS package-local | v13→v14 keeps works/decisions; snapshot evidence family `recovery_intents`; missing/corrupt/re-hash/future-schema blocked; D recipe now includes an intent |
| A6 handoff | PASS package-local | full regression, benchmark, D/E recipe, single wave07 status |

## Commands and results

```sh
./packages/contracts/node_modules/.bin/tsc -p packages/contracts/tsconfig.build.json
./packages/storage/node_modules/.bin/tsc -p packages/storage/tsconfig.json
./packages/storage/node_modules/.bin/tsc -p packages/storage/tsconfig.build.json
./packages/storage/node_modules/.bin/tsc -p packages/workflows/tsconfig.json
./packages/storage/node_modules/.bin/tsc -p packages/workflows/tsconfig.build.json

cd packages/storage && node --test test/*.case.ts       # 75/75
cd packages/workflows && node --test test/*.case.ts     # 38/38
cd packages/application && node --test test/*.case.ts   # 16/16
cd packages/verification && node --test test/*.case.ts  # 23/23

# main-owned composition suites, read-only execution on this merged base
node --test tests/integration/decision-commands.case.mjs  # 8/8
node --test tests/integration/review-timing.case.mjs      # 3/3

cd packages/workflows && node examples/d-snapshot-restore.mjs   # schema 14, intent not_granted
cd packages/workflows && node examples/evidence-benchmark.mjs   # reports/wave07-performance.json
```

Evidence: `reports/wave07-storage-tests.txt`, `reports/wave07-workflow-tests.txt`,
`reports/wave07-application-regression.txt`, `reports/wave07-verification-regression.txt`,
`reports/wave07-decision-integration.txt`, `reports/wave07-review-timing.txt`,
`reports/wave07-d-snapshot-recipe.json`, `reports/wave07-performance.json`,
`reports/wave07-status.json`.

Benchmark (darwin/arm64, temporary SQLite, 600 verifications/200 intents): first evidence page 6.13 ms
(100 rows), all 3 pages 1.16 ms in-process, recovery-intent page (50 of 200) 0.45 ms. Measurements only,
not production throughput.

## A2 recovery intent semantics

`recoveryIntents.record` consumes the published `RecoveryPlan` shape and stores one immutable fact:

- plan/actor/source mismatch, drift between expected and current inspection fingerprint, expiry and a
  plan that is not `not_granted` are refused before any write;
- exact replay by command or by identical plan returns the original fact/command (one stable
  authorization intent, never a second);
- a changed plan under the same plan ID conflicts; the port never overwrites;
- fact, caller command receipt and `recovery.intent.recorded` event commit or roll back together;
- after reopen the fact is queryable by plan/command/source, and the pre-existing effect queue row is
  byte-identical — recording an intent does not clear, copy or consume old queues;
- a target-preparation failure (D/main, outside the port) leaves the original intent for audit and
  never triggers an implicit second plan. A genuinely new plan requires a new explicit call.

The returned record is always `authorization: 'not_granted'` and `activationAvailable: false`. This
package does not delete restore markers, start native work, or claim a fresh writer proof.

## A3 evidence window semantics

`evidencePage` reuses the single-work timeline facts (contracts, links, questions, verifications,
acceptances, runtime observations, reviews, outcomes with ReviewTiming) and pages over
`(at desc, kind asc, sourceRef asc)`. `complete` means fully enumerated; `caller_limit` means continue
with `nextCursor`; `storage_cap` names the exhausted per-source bound and never claims absence.
Historical decisions/outcomes stay auditable after revocation/expiry; source validity and timing
remain separate facts, not permission or quality.

## A5 snapshot/migration

v14 `recovery-intents` is appended. A v13 database opens at 14 with existing works, decisions and
deliveries intact and an empty intent table. The snapshot evidence summary includes a
`recovery_intents` family; the D recipe creates an intent, snapshots, byte-copies and re-verifies;
the restored DB shows `authorization=not_granted` and no credential. Future-schema snapshots remain
blocked; older schema 13 is migratable by this build.

## Gaps and owners

- **main (BLOCKED for A4 activation):** publish the activation commit/HTTP/schema and switch to a new
  empty execution state. The current `RecoveryPlan` is read-only and the port must not be read as a
  grant. Recovery activation cannot be end-to-end tested until that interface exists.
- **D:** target preparation, relocation, rollback and re-authorization; consume the intent/evidence
  recipe. Cross-DB/filesystem atomicity is not claimed by A.
- **main/C:** optionally adopt `evidencePage` in `/v1/works/:id/evidence` for explicit window
  semantics; current timeline integration remains valid.
- **B/E:** native/pilot unchanged (zero model tasks here).
- **root lock:** `packages/workflows` keeps its test-only `@personal-agent/knowledge` dependency request
  from wave-06; main regenerates the authoritative lock.

## NOT_TESTED

Recovery activation commit/start switching, cross-database atomicity, physical old-writer
revalidation, native execution, E pilot, browser/product acceptance and installed-alpha. A's results
are package-local storage/consumer evidence, not product admission.
