# Repository Instructions

## Project And Sources

- Delivery repository: `https://github.com/JokersDH/dsh-superagent-prototype`.
- `origin` is the user's fork. `upstream` is the original DeepSeek repository. Push development branches only to `origin`; never push to `upstream`.
- Read `START-HERE.zh-CN.md`, `product-spec/README.md`, and the assigned file under `agent-tasks/` before implementation.
- Original prototype code is in `src/`, `tests/`, `prompts/`, `skills/`, and `docs/`. Preserve upstream MIT attribution.
- New product directories are `packages/` and `apps/` at this repository root. G0 experiments belong in `tools/reuse-spike/`. Do not create another nested Git repository or an unrelated product checkout.

## Native MVP Assignments (2026-11-09)

- Current priority as of 2026-11-10 is `agent-tasks/native-mvp-02/release-closure.zh-CN.md`: A-R1-A-R4, B-R1-B-R4 and the main integration package. It narrows the extended queue to environment admission and a usable single-package product before more P2 features. Preserve earlier work and ownership; do not reset native model budgets because the date or task phase changed.
- Main has admitted A `c005820` at package scope (37 tests and eight independent probes) and integrated the single-package environment/Runner/verification/console path. B `2d71382` passes the two harness admission guards; full native stop/question/recovery claims remain separately measured. See `docs/rfcs/WP-16/0012-environment-product-integration.md` and `reports/releases/environment-mvp/browser/` for current results. The new preview uses 5181/8797 and separate state; the old user instance is preserved. A continues compatibility evidence, B can consume the new public environment path for B-R4; ownership is unchanged.
- Current external task packets are `agent-tasks/native-mvp-02/README.zh-CN.md` and its A/B files. They supersede native-mvp round 1 and the wave-02 path assignments for new work; prior ownership/results below remain historical acceptance context.
- The user expanded this round for continuous execution while away. Read `agent-tasks/native-mvp-02/extended-run.zh-CN.md` and continue A1-A6, B1-B6, or M1-M6 after the first stable checkpoint without per-item approval. Ownership stays unchanged. On a cross-module blocker, publish an owned minimal repro and continue an independent queued phase. Native model budgets remain bounded; do not keep busy through unlimited retries or polling.
- External A continues its existing worktree/branch and owns only `packages/environment-preparation/` for the next package. External B continues its existing worktree/branch and owns only `tests/native-acceptance/` for independent native product and recovery acceptance.
- Main published the console/Codex/Runner MVP at `1f3229f` (implementation `252bf70`). Those product paths remain main-integration owned; external A/B must merge current main and must not overwrite admitted implementations with older candidates.
- A `f1d4b1f` passes 12 package tests but fails five independent environment admission probes. B `0e62a3d` passes eight harness selftests and five current-main read-only probes, but its native lane remains unimplemented. Neither result expands the published native MVP scope. Read `docs/rfcs/WP-16/0009-native-followup-review.md` for evidence and next-round gates.
- Latest extended review supersedes those candidate results: A `b6dd261` passes the old five probes but fails three cleanup/process/output probes; B `e392fc5` passes 14 selftests but can falsely PASS a missing native candidate and sends an invalid continue command. Read `docs/rfcs/WP-16/0011-extended-checkpoint-review.md`; neither final report admits the whole package. Main `04871fb` provides the trusted workspace environment port and read-only doctor; dependency installation stays disabled until A passes.
- Contracts, root lock/config, application/HTTP/coordinator, workspaces/verification/console and cross-module integration remain main-owned. Architecture invariants and delivery/credential rules below are unchanged. Main follows `agent-tasks/native-mvp-02/main-integration.zh-CN.md`; the measured native MVP limits remain in `docs/rfcs/WP-16/0008-native-mvp-integration.md`.

## Prior Wave-02 Assignments

- Current execution plan: `agent-tasks/wave-02/README.zh-CN.md`. These outcome-based packages supersede the old G0 and small-fix stopping instructions; old task files remain reference/acceptance checklists.
- Main agent works in the primary checkout and owns contracts/core, `packages/questions/`, `packages/application/`, deterministic application/HTTP/coordinator composition, root configuration/lock and cross-module integration. Read `agent-tasks/wave-02/main.zh-CN.md`.
- Agent A continues `codex/g2-workspaces-verification` in its existing checkout. It owns storage/effects/migrations, workspaces/verification, and now `apps/console/` under WP-11, plus corresponding WP-02/04/11 docs. Read `agent-tasks/wave-02/agent-a.zh-CN.md`.
- Agent B continues `codex/g1-runtime` in its existing checkout. It owns execution/DriverKit/testing/Runner, now Catalog/policy-preparation and `packages/drivers/codex-native/`, plus corresponding runtime/WP-03/06/07 docs. Read `agent-tasks/wave-02/agent-b.zh-CN.md`.
- B has one narrow extraction exception: it may move the recovery transport into execution, make `apps/coordinator/runner-link.ts` a compatibility re-export, and change only RuntimeProducer type import/re-export in `runtime-ingress.ts`. Keep one implementation/proof WeakMap and protocol-v1 behavior. Main must not edit those regions concurrently; registry/reconcile/barrier and all other coordinator code stay main-owned.
- Each agent publishes one early stable interface checkpoint, then continues independent work without waiting for per-fix approval, and delivers the complete package. Main reviews/integrates accepted commits; A/B push only their assigned branch, never `main`.
- Shared wire schema, root lock and product migrations still have one owner. Package-local manifests/tests/fixtures belong to the package owner. See `docs/rfcs/WP-16/0001-wave-02-integration-boundaries.md` for current implementation interfaces and acceptance boundaries.

## G1 Handoff

- G0 acceptance is recorded in `docs/adr/bootstrap/g0-status.json`; its PASS only allows G1 work, not a product release.
- G0 branches are historical. This wave explicitly continues the current A/B feature branches so their unmerged candidates are preserved; merge the latest `origin/main` before continuing. Do not switch another agent's worktree or discard its changes.
- G1 Agent A: `codex/g1-storage-effects`, WP-02, owns `packages/storage/`, `packages/effects/`, `docs/adr/storage/`, `docs/rfcs/WP-02/`.
- G1 Agent B: `codex/g1-runtime`, WP-03, owns `packages/execution/`, `packages/driver-kit/`, `packages/testing/`, `apps/runner/`, `docs/adr/runtime/`, `docs/rfcs/WP-03/`.
- Main agent keeps WP-01 core, shared contracts, root configuration and WP-16 integration ownership. Follow each task packet's start/accept dependencies and submit RFCs for missing shared semantics.
- Latest G1 assignments are `agent-tasks/g1-agent-a-runtime-state.md` and `agent-tasks/g1-agent-b-durable-runner.md`; prior review fixes are accepted only in their recorded scope. Main also owns `apps/coordinator/` composition adapters/check configuration and integration tests; `apps/coordinator/http/` remains reserved for the later WP-10 work. Production storage schemas stay A-owned and Runner implementations stay B-owned.
- Current handoff: A's runtime-state/observation batch is integrated; A may start WP-04 on `codex/g2-workspaces-verification` under `agent-tasks/g2-agent-a-workspaces-verification.md`, owning `packages/workspaces/`, `packages/verification/`, and `docs/rfcs/WP-04/` while keeping migration ownership. B continues `codex/g1-runtime` with `agent-tasks/g1-journal-acceptance.md`; its Journal candidate is not yet merged/admitted. Main's production fact-recovery adapter is separate from Journal writer certification. Read `docs/adr/core/g1-recovery-handoff.md` for measured scopes.
- Latest 2026-11-08 review: main's authenticated local recovery/owned-resource-barrier slice passes 17 tests; production fact recovery remains 14. A `d1be401` and B `32540a3` remain unmerged candidates: A has six WP-04 admission failures; B fixed the prior four Journal cases but has three follow-up failures. Continue the same ownership/branches with `agent-tasks/g2-agent-a-wp04-admission-fixes.md` and `agent-tasks/g1-agent-b-journal-followup.md`. Current integration instructions and limits are in `docs/adr/core/g1-runner-link-handoff.md`. Do not promote ordinary runtime observation summaries to trusted completion authority.
- Current batch supersedes that review: main's registered recovery/durable queue slice passes 56 integration cases with six SIGKILL windows. A `fcf3273` passes 27 owned tests plus 66 storage and six prior probes, but current-runtime/event-provenance cases fail. B `74a3068` passes 148 and seven prior probes, but strict envelope/terminator/whole-file replay cases fail. Only B's byte-identical ProcessHost observation file is integrated; Journal and WP-04 remain unmerged. The same task files contain the narrowed remaining work. Read `docs/adr/core/g1-registered-recovery-handoff.md`; v2 host events include full attempt/source, writer fact and barrier command ID. Main owns registration/recovery composition; storage/migrations and actual Runner backend stay with A/B.
- Wave-02 planning does not change those measured results or declare G1 passed. A/B must close the existing failures as the first stage, then continue their assigned packages. UI/Driver fixture development may proceed under startAfter rules; production/native acceptance still requires the appropriate accepted dependencies. Current progress audit: `reports/releases/progress-2026-11-08.json`.
- Root workspace is active for `packages/*`, `packages/drivers/*`, and `apps/*`. Root lock changes remain main-agent owned. Use `workspace:*` for sibling product packages and request lock integration; do not edit shared manifests/locks or copy private types. G0 spikes remain outside this workspace and use their independent install instructions with `--ignore-workspace` when needed.
- Dependency-install exception: in a feature worktree, pnpm may generate a temporary root lock diff while resolving a newly owned package. Do not hand-edit, stage or commit that root lock; report the dependency request and the main agent regenerates the authoritative integration lock. This exception permits local compilation, not a second lockfile owner.

## Architecture Invariants

- Ticket/Assignment in the extracted superagent core are the only execution lifecycle. Work stores identity, immutable contract revisions, links, and derived views.
- Legacy core behavior remains covered by its baseline tests. Personal completion requires current-candidate verification and any required human acceptance.
- Native reports and answers carry assignment/attempt/epoch/contract identities. An unknown native send is reconciled before a business retry.
- Core stopped does not prove a physical writer stopped. New execution waits for the resource barrier.
- Shared contracts have one owner; database migrations have one owner; root dependency and integration changes have one owner. Submit an RFC instead of private replacement types.

## Work And Delivery

- Inspect current branch and changes first. Preserve existing user and other-agent edits. Do not reset, clean, force-push, or switch another worktree's branch.
- Commit only owned files using explicit paths, not `git add .` or `git add -A`. Use a task-specific commit message.
- Keep credentials, `.env`, account homes, native session dumps, local databases, build outputs, and dependencies out of Git. Do not reset native agent profiles or upgrade global runtimes for a probe.
- A schema export, fixture, document check, or upstream test result is not native/product compatibility evidence. Report PASS/FAIL/SKIPPED/NOT_TESTED with exact scope.
- Every handoff includes branch/commit/base, owned paths, actual commands/results, evidence locations, limitations, and the next consumer's instructions.

## Documentation Checks

The product-spec generator uses only Node standard libraries:

```sh
node product-spec/tools/generate-spec.mjs
node product-spec/tools/verify-spec.mjs
```

Only the main agent regenerates shared docs. Agents A/B may run `verify-spec.mjs --check` without rewriting its report. Their acceptance evidence goes in their owned experiment directory.
