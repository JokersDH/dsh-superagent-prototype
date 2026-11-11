# Wave-08 A: production recovery activation facts, evidence paging and migration

- Branch: `codex/g2-workspaces-verification`
- Main base: `5d4065b`; merge checkpoint: `a0fa79f`
- Runnable checkpoint: `fcf2563`; final source is recorded in `reports/wave08-status.json`
- Owned paths: `packages/storage/`, `packages/workflows/`
- Model tasks: **0**; unknown sends: **0**; no user service/account/native run

## A1–A6

| Phase | Status | Evidence |
| --- | --- | --- |
| A1 readback fix | PASS | `mapRow` parses the stored envelope and returns its `plan`, cross-checks all indexed columns/digest; full plan/actor/time assertions; hand-edited row refused |
| A2 shared production facts | PASS | v15 `recovery_activations` implements `RecoveryActivationFacts` (`get/forCommand/put`) synchronously in the caller UoW; unique activation/command/plan; conflict on target/plan/principal/machine/resource-policy; same-body replay |
| A3 main consumer | PASS (source half) | real `RecoveryIntentCommitter` on real SQLite: fact+receipt+event commit, replay after reopen, wrong principal, changed policy, receipt-failure rollback, target-revalidation-failure rollback; target startup remains main/D |
| A4 evidence pages | PASS | `evidencePage` complete/caller_limit/storage_cap, stable cursor, cross-work cursor refusal, partial ReviewTiming visible, cross-project rejection; runnable consumer recipe |
| A5 snapshot/migration | PASS | schema 15 snapshot includes legacy `recovery_intents` + `recovery_activations`; v14→v15 keeps legacy audit rows and starts new facts empty; v13→current keeps works/decisions; missing/activation-table-dropped/corrupt/re-hash/future-schema blocked |
| A6 handoff | PASS | full regression, two recipes, single wave08 status |

## Commands and results

```sh
./packages/contracts/node_modules/.bin/tsc -p packages/contracts/tsconfig.build.json
./packages/storage/node_modules/.bin/tsc -p packages/storage/tsconfig.json
./packages/storage/node_modules/.bin/tsc -p packages/storage/tsconfig.build.json
./packages/storage/node_modules/.bin/tsc -p packages/workflows/tsconfig.json
./packages/storage/node_modules/.bin/tsc -p packages/workflows/tsconfig.build.json

cd packages/storage && node --test test/*.case.ts       # 75/75
cd packages/workflows && node --test test/*.case.ts     # 45/45
cd packages/application && node --test test/*.case.ts   # 20/20
cd packages/verification && node --test test/*.case.ts  # 23/23

# main-owned suites, executed read-only on this merged base
node --test tests/integration/decision-commands.case.mjs  # 8/8
node --test tests/integration/review-timing.case.mjs      # 3/3

cd packages/workflows && node examples/d-snapshot-restore.mjs   # schema 15, activation fact
cd packages/workflows && node examples/evidence-consumer.mjs    # paged evidence recipe
cd packages/workflows && node examples/evidence-benchmark.mjs   # measurement
```

Evidence: `reports/wave08-storage-tests.txt`, `reports/wave08-workflow-tests.txt`,
`reports/wave08-application-regression.txt`, `reports/wave08-verification-regression.txt`,
`reports/wave08-decision-integration.txt`, `reports/wave08-review-timing.txt`,
`reports/wave08-d-snapshot-recipe.json`, `reports/wave08-evidence-recipe.json`,
`reports/wave08-performance.json`, `reports/wave08-status.json`.

Benchmark (darwin/arm64, temporary SQLite, 600 verifications/200 intents): first evidence page
4.97 ms, all 3 pages 0.69 ms, recovery-intent page 0.89 ms. Measurements only.

## A2/A3 activation semantics

`recoveryActivations.put` consumes the shared `RecoveryActivationIntentSchema`. It writes one
immutable row inside the caller's transaction; `get`/`forCommand` return the exact intent and refuse
an inconsistent row. Unique activation/command/plan identities mean a plan can never acquire a second
authorization; same-body replay returns the stored fact, any target/plan/principal/machine/resource
policy change conflicts.

The test imports main's real `RecoveryIntentCommitter` (no fake) and proves the source half:
principal check, synchronous revalidation, receipt recording, `facts.put`, event append and the
require-fact consistency check commit together; a trigger failure or failing revalidation leaves no
fact, receipt or event; after close/reopen a lost-response replay returns the original receipt. The
committer explicitly does not start a target; startup is main/D.

## A4 evidence windows

`evidencePage` pages over `(at desc, kind asc, sourceRef asc)`. `caller_limit` means continue;
`storage_cap` names exhausted per-source bounds and never claims absence; `complete` is a full
enumeration of observable facts. A cursor from another work is refused. ReviewTiming stays as observed
(partial 5000 ms in the test, null stays null); duplicate acceptance does not create a second outcome
(covered by `acceptance.case.ts`).

## A5 migration/snapshot

v15 is appended; v14 rows and checksums are unchanged. v14→v15 keeps legacy plan intents readable
through `recoveryIntents` (audit, `not_granted`) and starts `recoveryActivations` empty — there is no
implicit promotion to target/generation authorization. Snapshot evidence now covers both families;
the D recipe records a shared activation fact, snapshots, byte-copies and re-verifies schema 15 with
the target root visible and no credential/token in either family. Dropping the activation table in a
copy changes the evidence digest and blocks verification.

## External gaps

- **main:** recovery commit/HTTP and target-start switching; then A's facts can be exercised end to end.
  Target preparation/start is still not published (source transaction only).
- **main/D:** exact authoritative descriptor, process startup, failure cleanup and rollback. A does not
  authorize startup or claim cross-database/filesystem atomicity.
- **B/main:** physical old-writer barrier stays separate; no PID/old ended state becomes a new proof.
- **root lock:** `packages/workflows` keeps its test-only `@personal-agent/knowledge` request; main
  regenerates the authoritative lock.

## NOT_TESTED

Target start/switch, process cleanup, physical resource revalidation, native/Codex execution, E
acceptance, installed-alpha and review pilot remain NOT_TESTED. Package results are not product
admission.
