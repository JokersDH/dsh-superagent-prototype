# Repository Instructions

## Project And Sources

- Delivery repository: `https://github.com/JokersDH/dsh-superagent-prototype`.
- `origin` is the user's fork. `upstream` is the original DeepSeek repository. Push development branches only to `origin`; never push to `upstream`.
- Read `START-HERE.zh-CN.md`, `product-spec/README.md`, and the assigned file under `agent-tasks/` before implementation.
- Original prototype code is in `src/`, `tests/`, `prompts/`, `skills/`, and `docs/`. Preserve upstream MIT attribution.
- New product directories are `packages/` and `apps/` at this repository root. G0 experiments belong in `tools/reuse-spike/`. Do not create another nested Git repository or an unrelated product checkout.

## Product Wave-05 Assignments (2026-11-10)

- Amendment 01 is mandatory and takes precedence: read `agent-tasks/product-wave-05/AMENDMENT-01.zh-CN.md` and WP-16/0021. Existing Codex same-session vs fresh-session value screening precedes new second-driver implementation. B may continue R0 control, session/capsule support and zero-model protocol discovery; do not expand new-driver work before a promising pilot result. Main/C ship deterministic cross-project attention first, independently of that pilot.
- Main has authorized the separate E-owned `wave05-independent-review-pilot-01` with ceilings of 24 bounded native turn starts, 200000 billable tokens and USD5, whichever comes first. It does not consume/reset B's grant. Reserve conservative per-turn bounds before send; unknown/reasoning/pricing that cannot be bounded blocks sending, no free-subscription assumption or automatic sample replacement. Main/A/C/D regular development and E outside this exact pilot remain zero-model.
- Disposable sealed copies are the default review material. They share no Git/links/inodes with the author and discard scratch writes; host filesystem/tool/network/credential scope still requires enforcement. Input mutation invalidates evidence for the original subject. Native readonly mode is an optional alternative, not a mandatory ban on writing disposable scratch.
- Until R0 persistent-command/control/recovery/release gates are independently admitted, advice/review stay behind an explicit experimental entry, disabled by default. A promising pilot is not production admission. No confidence auto-acceptance, writer racing or authorization bypass is added.
- ExecutionOutcome can carry ReviewTiming. New producers use observed ready-to-acceptance delay and partial UI-visible/focused interval union, or null/unknown. Client activity is observational metadata, never a permission/quality proof; acceptance replay must not duplicate measurements.

- Current new work follows the amendment, `agent-tasks/product-wave-05/README.zh-CN.md` and the role packet. Value screening and attention work precede expanded evidence-based advice and second-protocol review. They supersede new wave-04 scheduling while retaining all measured scope, unresolved integration fixes and old budget ledgers.
- Main owns contracts/application/questions/coordinator/console/root lock and integration. Shared records and the sync `RoutingEvidencePort` are in `packages/contracts/src/routing-review.ts`; read `docs/rfcs/WP-16/0020-wave-05-dispatch-and-shared-inputs.md` first. Frozen Runner/data wire stays unchanged.
- A owns storage/workflows, routing/review/outcome persistence and the sole append-only production migration sequence. C owns context/proposals/knowledge and new `packages/routing/`; it first closes the real-store decision replay and synchronous decision commit gap, then implements eligibility/advice/review validity without a new LLM loop or SQL writer.
- B explicitly owns execution/catalog/policy-preparation/driver-kit/testing, apps/runner, drivers and native-acceptance in this wave. Main does not concurrently edit those sources. B first preserves the accepted Codex/control/recovery path and supplies bounded session/capsule support. New ZCode/DeepSeek Harness driver implementation waits for the pilot gate, reuses the official SDK when applicable and proves the chosen isolation policy. B does not edit coordinator/console/contracts/root lock.
- D owns launcher/distribution/portability; consume main's fixed restored-project readonly startup and continue the actual staged install/diagnostic/backup/restore path. E owns only product-acceptance and independent negative/product/installation/equal-budget evaluation; other agents do not change E's assertions.
- Review execution uses a distinct existing Work/Ticket/Assignment linked by immutable subject; it never takes the author's current assignment/candidate. No same-contract writer racing, confidence auto-acceptance, dynamic Ticket DAG, auto-merge/deploy, or online learned routing is included.
- B gets no new allowance: preserve the existing wave03-b-native limit4 and all actual used/unknown reservations plus historical ledgers; direct CLI/SDK calls also reserve before possible native/model send. Only the separate bounded pilot above changes E's allowance; large-sample benefit experiments still need separate budgeting.
- Preserve all five existing agent worktrees and user services 5180/8796, 5181/8797, 5182/8798 and 5183/8799. Use isolated resources. A-E publish early stable checkpoints and continue their complete five-stage packages, pushing only their own branch; main independently admits source/evidence before integration.

## Historical Product Wave-04 Assignments (2026-11-10)

- Prior work follows `agent-tasks/product-wave-04/README.zh-CN.md` and each role's packet. Its unfinished integration fixes carry into wave-05, preserving all historical test scope, budgets, branches and ownership except the explicit B/C additions above.
- Main has published `packages/contracts/src/assistant-state.ts` for synchronous A persistence/C domain consumers and the restored-state `recovery_readonly` startup entry. Read `docs/rfcs/WP-16/0016-wave-04-interfaces-and-admission.md` before implementing those boundaries.
- A owns storage/workflows and append-only v11+ migrations, including decision provenance/proposal persistence and catalog indexes; C owns domain fixes and prepare/commit consumers, no SQL. Main owns deterministic application/HTTP/provider/UI composition and root lock.
- B must first fix false-PASS matrix branches and real-entry budget accounting, then validate production control/recovery. Existing wave-03 budget and historical attempts persist; no new model allowance is created by the new packet.
- D must first close active-state rollback, restored first-start replay, requested-instance matching and content-digest gaps, then deliver an actual relocatable runtime closure. D may consume main's recovery mode but cannot delete restore markers or self-authorize old native work.
- E must first harden its full-product layer/source/evidence gate, then independently test the integrated catalog/recheck/assistant/distribution flows. Main does not edit E's tests. No full-product release is admitted by the current B/D/E candidate reports.
- Main/A/C/D/E have zero model tasks for this wave. B may only use the verified remainder of its previous grant after pre-send reservation/unknown-send reconciliation. Preserve user services 5180/8796, 5181/8797 and 5182/8798; all probes use isolated resources.

## Historical Product Wave-03 Assignments (2026-11-10)

- Prior execution plan was `agent-tasks/product-wave-03/README.zh-CN.md`; its ownership below is retained by wave-04. The user has five external developers A/B/C/D/E. Prior measured results remain scoped evidence, not whole-product admission.
- Main owns `apps/console/`, `packages/contracts/`, `packages/application/`, `packages/questions/`, `apps/coordinator/`, root configuration/lock and cross-module integration. Main is redesigning the conversation-first graphite/white/evergreen workbench and integrating deterministic product behavior.
- A keeps its current checkout/branch and owns `packages/storage/` plus `packages/workflows/`, including the only production SQL migration ownership. Read `agent-tasks/product-wave-03/agent-a-workflows.zh-CN.md`. Old environment candidates remain preserved; submit any narrow compatibility fixes explicitly.
- B keeps its current checkout/branch and owns `apps/runner/`, `packages/drivers/codex-native/`, `packages/driver-kit/`, `packages/testing/` and `tests/native-acceptance/`. Main must not edit those regions concurrently. Read `agent-tasks/product-wave-03/agent-b-runtime.zh-CN.md`.
- C uses `/Users/hh/Desktop/joker/superagent-agent-c`, branch `codex/g3-assistant-context`, and owns `packages/context/`, `packages/proposals/`, `packages/knowledge/`. Read `agent-tasks/product-wave-03/agent-c-assistant.zh-CN.md`. Reuse the existing reasoner and A's persistent ports, not a private LLM loop or SQL writer.
- D uses `/Users/hh/Desktop/joker/superagent-agent-d`, branch `codex/g3-local-distribution`, and owns `apps/launcher/`, `tools/distribution/`, `packages/portability/`. Read `agent-tasks/product-wave-03/agent-d-delivery.zh-CN.md`. First target is one local daemon per colleague; do not expose the existing single-user loopback entry as a multi-user service.
- E uses `/Users/hh/Desktop/joker/superagent-agent-e`, branch `codex/g3-product-acceptance`, and owns only `tests/product-acceptance/`. Read `agent-tasks/product-wave-03/agent-e-acceptance.zh-CN.md`. Main does not edit that acceptance directory concurrently; E does not edit production code.
- All agents publish one early stable interface checkpoint and then continue their five-stage package. Contracts/root lock have one owner (main), migrations one owner (A). Preserve scopes, existing worktrees and old branch history; A-E push only their own branch. CAC/second-protocol production work follows UI and key capability completion.
- Main's UI/planning wave and A/C/D/E default to zero model calls. B's new user-dispatched feature package permits at most four explicit small native tasks, with old history retained and uncertain sends reconciled. E needs a separately dispatched budget for a future native release run; no phase/date change silently refreshes a budget.

## Historical Native MVP Assignments (2026-11-09)

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
