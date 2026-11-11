# Wave-06 A delivery: durable consumers, acceptance projection and migration

- Branch: `codex/g2-workspaces-verification`
- Main base: `82db295`; merge checkpoint: `f3b4d64`
- Stable interface checkpoint: `f26f2eb` (routing evidence), delivery source recorded in status
- Owned paths: `packages/storage/`, `packages/workflows/`
- Model tasks: **0**; unknown sends: **0**; no user service or account operation

## A1–A6 results

| Phase | Result | Evidence |
| --- | --- | --- |
| A1 shared-port checkpoint | PASS package-local | v13 routing store, acceptance projection, shared parsers, real ProductStore/UoW tests |
| A2 accepted event projection | PASS package-local | deterministic outcome only from exact candidate/work/attempt/profile/verification/acceptance sources; replay/gap/conflict tests; no duplicate accepted event or timing zeros |
| A3 bounded source/timeline reads | PASS package-local | exact project queries, stable cursors, source-message digest, work timeline; main attention currently consumes existing index; no second lifecycle |
| A4 C real consumer | BLOCKED external | no C `packages/routing` implementation/checkpoint is present in this checkout; same-port fixture only, owner C/main |
| A5 snapshot/upgrade/D recipe | PASS package-local | v12→v13 upgrade, routing/review artifact refs, decision/setting/verification/outcome data, second-process snapshot/read; D restore policy remains external |
| A6 bounded verification | PASS package-local | 75 storage, 23 workflow, 16 application, 23 verification; build/typecheck; fixed-seed benchmark |

## Commands/results

```sh
./packages/storage/node_modules/.bin/tsc -p packages/storage/tsconfig.json       # PASS
./packages/storage/node_modules/.bin/tsc -p packages/storage/tsconfig.build.json
./packages/storage/node_modules/.bin/tsc -p packages/workflows/tsconfig.json    # PASS
./packages/storage/node_modules/.bin/tsc -p packages/workflows/tsconfig.build.json

cd packages/storage && node --test test/*.case.ts       # 75/75
cd packages/workflows && node --test test/*.case.ts     # 23/23
cd packages/application && node --test test/*.case.ts   # 16/16
cd packages/verification && node --test test/*.case.ts  # 23/23
cd packages/workflows && node examples/routing-benchmark.mjs  # reports/wave06-performance.json
```

Benchmark (temporary SQLite, darwin/arm64, 500 advice/100 reviews/200 outcomes): seed 90.7 ms;
advice page 0.33 ms, review page 0.26 ms, outcome page 0.17 ms. These are measurements, not
production throughput or release thresholds.

Evidence: `reports/wave06-storage-tests.txt`, `reports/wave06-workflow-tests.txt`,
`reports/wave06-application-regression.txt`, `reports/wave06-verification-regression.txt`,
`reports/wave06-performance.json`, `reports/wave06-status.json`.

## A1/A2 acceptance projection

`createWorkflowPorts(store).acceptance.consume({eventSeq, projectId, profileRef, layer})` reads
`application.candidate.accepted` and reconstructs one deterministic `ExecutionOutcome` only when:

- the event and candidate are exact, and the work belongs to the requested project;
- exactly one ended attempt binding matches candidate ticket/assignment/contract;
- a completion verification matches ticket/assignment/generation;
- a completion acceptance is present, or the exact accepted event reference is used for a
  machine-only contract without a human acceptance row;
- the trusted main producer supplies the exact profile and declared evidence layer.

Same event/profile/layer replays the same outcome; duplicate accepted events are never emitted.
Missing attempt/verification returns an `incomplete` gap with reasons and writes nothing. It does not
invent a profile, layer, usage, human time or acceptance. ReviewTiming is copied as observed;
`activeReviewMs=null` remains unknown, not zero, and wall-clock waiting is never combined with the UI
proxy.

## A3/A4/A5

Bounded routing/work/source reads and timeline are in `routingEvidence` and `WorkflowIndex`; project
scope is explicit and empty is not global. The timeline includes optional ReviewTiming and avoids
causal or writer-stop claims. Snapshots read artifact registry and review report references from the
backup DB, copy/verify bytes, and block missing/corrupt/IO cases. v13 is appended; v12 data survives.
History remains auditable but C/main must revalidate current candidate/contract/grant before using it.

## External gaps / NOT_TESTED

- **A4 C integration is BLOCKED external:** no C routing module/checkpoint is available in this
  checkout. C must consume the same `RoutingEvidencePort`/`assistant` ports; A's tests use the same
  shared schemas but are not a C consumer certification.
- Main production wiring of acceptance.consume and HTTP/UI is not part of A; E pilot/native
  execution, item 2 review, and D's actual restore/rollback are **NOT_TESTED**.
- No model task, second driver, automatic acceptance, network install or user service was used.
