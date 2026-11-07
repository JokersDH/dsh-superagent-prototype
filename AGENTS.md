# Repository Instructions

## Project And Sources

- Delivery repository: `https://github.com/JokersDH/dsh-superagent-prototype`.
- `origin` is the user's fork. `upstream` is the original DeepSeek repository. Push development branches only to `origin`; never push to `upstream`.
- Read `START-HERE.zh-CN.md`, `product-spec/README.md`, and the assigned file under `agent-tasks/` before implementation.
- Original prototype code is in `src/`, `tests/`, `prompts/`, `skills/`, and `docs/`. Preserve upstream MIT attribution.
- New product directories are `packages/` and `apps/` at this repository root. G0 experiments belong in `tools/reuse-spike/`. Do not create another nested Git repository or an unrelated product checkout.

## Current Three-Agent Assignments

- Main agent owns shared contracts, bootstrap, repository configuration, integration, and G0 acceptance. Work in the primary checkout.
- Agent A uses branch `codex/g0-core-extraction` and edits only `tools/reuse-spike/core-extraction/`. Read `agent-tasks/agent-a.md`.
- Agent B uses branch `codex/g0-platform-validation` and edits only `tools/reuse-spike/platform/`. Read `agent-tasks/agent-b.md`.
- These two assignments are delegated slices of WP-00, not permission to start WP-01/02/03 before G0 passes.
- Each experiment may have its own package manifest and lock inside its owned directory. Agents A/B must not change root manifests/lockfiles, shared contracts, migrations, other agents' paths, or generated product-spec files.
- The main agent reviews and integrates commits. Agents A/B push only their assigned branch; they do not merge or push `main`.

## G1 Handoff

- G0 acceptance is recorded in `docs/adr/bootstrap/g0-status.json`; its PASS only allows G1 work, not a product release.
- The assignments above describe the completed G0 branches. When assigned the next wave, start a new branch from integrated `origin/main`; do not reuse G0 as unlimited ownership.
- G1 Agent A: `codex/g1-storage-effects`, WP-02, owns `packages/storage/`, `packages/effects/`, `docs/adr/storage/`, `docs/rfcs/WP-02/`.
- G1 Agent B: `codex/g1-runtime`, WP-03, owns `packages/execution/`, `packages/driver-kit/`, `packages/testing/`, `apps/runner/`, `docs/adr/runtime/`, `docs/rfcs/WP-03/`.
- Main agent keeps WP-01 core, shared contracts, root configuration and WP-16 integration ownership. Follow each task packet's start/accept dependencies and submit RFCs for missing shared semantics.
- Latest G1 assignments are `agent-tasks/g1-agent-a-runtime-state.md` and `agent-tasks/g1-agent-b-durable-runner.md`; prior review fixes are accepted only in their recorded scope. Main also owns `apps/coordinator/` composition adapters/check configuration and integration tests; `apps/coordinator/http/` remains reserved for the later WP-10 work. Production storage schemas stay A-owned and Runner implementations stay B-owned.
- Current handoff: A's runtime-state/observation batch is integrated; A may start WP-04 on `codex/g2-workspaces-verification` under `agent-tasks/g2-agent-a-workspaces-verification.md`, owning `packages/workspaces/`, `packages/verification/`, and `docs/rfcs/WP-04/` while keeping migration ownership. B continues `codex/g1-runtime` with `agent-tasks/g1-journal-acceptance.md`; its Journal candidate is not yet merged/admitted. Main's production fact-recovery adapter is separate from Journal writer certification. Read `docs/adr/core/g1-recovery-handoff.md` for measured scopes.
- Latest 2026-11-08 review: main's authenticated local recovery/owned-resource-barrier slice passes 17 tests; production fact recovery remains 14. A `d1be401` and B `32540a3` remain unmerged candidates: A has six WP-04 admission failures; B fixed the prior four Journal cases but has three follow-up failures. Continue the same ownership/branches with `agent-tasks/g2-agent-a-wp04-admission-fixes.md` and `agent-tasks/g1-agent-b-journal-followup.md`. Current integration instructions and limits are in `docs/adr/core/g1-runner-link-handoff.md`. Do not promote ordinary runtime observation summaries to trusted completion authority.
- Current batch supersedes that review: main's registered recovery/durable queue slice passes 56 integration cases with six SIGKILL windows. A `fcf3273` passes 27 owned tests plus 66 storage and six prior probes, but current-runtime/event-provenance cases fail. B `74a3068` passes 148 and seven prior probes, but strict envelope/terminator/whole-file replay cases fail. Only B's byte-identical ProcessHost observation file is integrated; Journal and WP-04 remain unmerged. The same task files contain the narrowed remaining work. Read `docs/adr/core/g1-registered-recovery-handoff.md`; v2 host events include full attempt/source, writer fact and barrier command ID. Main owns registration/recovery composition; storage/migrations and actual Runner backend stay with A/B.
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
