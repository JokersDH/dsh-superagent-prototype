# Environment preparation: release-closure delivery

- Package: `packages/environment-preparation/` (branch `codex/g2-workspaces-verification`)
- Main base: `f2ca26c`; branch merge: `f35fa29`; source checkpoint tested here: `221ead7`
- Environment: Node v24.21.0, pnpm 11.7.0 via Corepack cache, darwin/arm64. No model calls,
  no networked install, no account/user-project operation.
- Scope: package-local preparation/verification/cleanup and controlled process port. Main
  workspace/Runner/UI integration remains NOT_TESTED.

## Results

| Gate | Result | Evidence |
| --- | --- | --- |
| A-R1 three new failures | **PASS** | Official 8-case probe at `221ead7`; regressions for forged-marker cleanup in both authoritative and legacy modes, EPERM/unknown observation, merged stdout+stderr budget |
| A-R1 original five | **PASS** | Same probe; unowned-path preservation, nested escape, drift reuse, Node range, pnpmfile refusal |
| A-R2 production interface | **PASS (package-local)** | mandatory `authorityRoot` entry, parser-validated ref/results, signed-receipt ownership, workspace inode binding, actual exclusions |
| A-R3 independent consumption | **PASS (package-local)** | `reports/independent-consumption.json` 7/7 through public exports and a second Node process |
| A-R4 main integration | **BLOCKED_EXTERNAL** | latest `origin/main` is `f2ca26c`; no newer main consumer/merge point after `f35fa29`, so no main integration verification is claimed |
| Package tests | **38/38 PASS** | `reports/test-output.txt` |
| Typecheck/build | **PASS** | `pnpm run typecheck`, `pnpm run build` |
| Offline recipes | **PASS** | `plain-js` and `dev-deps` rebuild/install/run their real tests; `reports/recipe-build.json` |

## Actual commands and observed results

```sh
cd packages/environment-preparation
pnpm run typecheck                                  # PASS
pnpm run test                                       # 38/38 PASS
pnpm run build                                      # PASS
node examples/consumption-matrix.mjs --out reports/independent-consumption.json
                                                    # PASS_INDEPENDENT_CONSUMPTION 7/7
node recipes/build-recipes.mjs --out /tmp/pa-env-recipes-verify
                                                    # RECIPES_BUILT (pnpm 11.7.0)

# from the primary checkout; immutable archive of the committed candidate
node /Users/hh/Desktop/joker/superagent/tools/bootstrap/review-environment-preparation.mjs \
  --environment /Users/hh/Desktop/joker/superagent-agent-a --candidate 221ead7
                                                    # PASS_ENVIRONMENT_ADMISSION 8/8
```

The official probe validates all eight admission invariants; it does not substitute for the
independent-consumption or main integration gates. Package tests use local tarball fixtures, a real
offline store and real child processes; no registry request is made.

## A-R1 fixes

- **Cleanup ownership**: blocked/early results never delete anything from a workspace marker.
  With an authority root only signed receipts for that exact workspace, plus device/inode identities
  captured by this preparation before failure cleanup, authorize deletion. Stale/reuse/re-prepare
  paths require a signed receipt; an owned-looking marker without one is blocked as
  `environment_state_untrusted` and preserved. A marker is no longer a claim/delete capability.
- **Process observation**: group liveness is three-state. Only `ESRCH` confirms `gone`; `EPERM` and
  every other observation failure return `unknown`, never `confirmed`. Output-limit, timeout and
  cancellation paths still TERM→KILL the detached group and report `indeterminate`/`unknown` when
  quiescence is unproven. Normal descendants are covered by cancellation/timeout tests.
- **Merged output budget**: stdout and stderr share one `maxOutputBytes` budget in arrival order;
  clipping counts whole UTF-8 code points, sets `outputLimited`, terminates the group, and the
  returned stdout+stderr byte length never exceeds the declared limit.

## A-R2 production interface

- `prepareAuthoritativeEnvironment(input)` requires an absolute caller-owned `authorityRoot` and
  blocks `authority_root_required` before any write; `prepareEnvironment` remains the explicitly
  documented legacy/compatibility surface, not a production credential mode.
- `parsePreparationResult`, `parseEnvironmentRef`, `parseEnvironmentVerification`,
  `parseTrustedCleanupResult` validate protocol/status/identity fields at the consumer boundary.
  Examples use them instead of trusting ad-hoc JSON.
- `projectWorkspaceEnvironment(ref)` verifies synchronously and projects
  `{ reference, fingerprint, excludedPaths }` for main's `WorkspaceEnvironmentPort`. `reference` is
  the opaque receipt id (no host path); a missing/forged/drifted receipt throws, never `undefined`.
- Receipts bind workspace real path **and device/inode**, project, request, input fingerprint,
  installed digest, manager/Node versions, policy, lock/manifest digests, dependencies, owned paths
  and exclusion list. Replacement at the same path now blocks `workspace_replaced`. New receipts
  supersede older receipts for the workspace; missing/corrupt records never recover to ready and are
  never auto-deleted.
- Exclusions contain only paths that exist; `.product-environment` is excluded only when this
  preparation owns it, so a foreign/absent directory is never presented as owned state.
- Process-port semantics are stable: argv-only detached groups, signal cancellation/output/time
  bounds, numeric exit/signal, `outputLimited`, and explicit `quiescence` enum. Main owns process
  inventory, durable intent and barriers; this package has no product state machine.

## A-R3 independent consumption

`reports/independent-consumption.json` records seven cases using only public exports and a second
Node process for verify/cleanup:

1. prepare → serialized ref → second-process verify → trusted cleanup; workspace cleared, project
   test source unchanged.
2. forged workspace marker does not replace the signed reference; second-process verify/cleanup still
   use only the receipt.
3. forged receipt blocks both verify and cleanup with owned content preserved.
4. workspace directory replacement (same path, new inode) blocks verify and cleanup.
5. manifest, lock and installed-tree drift block verification (and cleanup remains fail-closed).
6. controlled offline-error manager reports `offline_cache_missing`; `.pnpmfile.cjs` is refused with
   `project_hooks_unsupported` and never executed.
7. same-workspace concurrency blocks `workspace_busy`, mid-flight cancellation reports `cancelled`
   and kills the group, and a crash-left `preparing` marker is preserved and blocks
   `interrupted_preparation`.

Recipes are rebuildable from local tarballs; source names/versions (`env-dep@1.0.0`,
`env-dev-dep@1.0.0`), test commands, store construction and the no-network policy are documented in
`recipes/README.md`. No dependencies, store or cache are committed.

## Interface summary

```ts
prepareAuthoritativeEnvironment(input): PreparationResult   // authorityRoot required
prepareEnvironment(input): PreparationResult                 // explicit legacy compatibility
verifyPreparedEnvironment(ref): EnvironmentVerificationResult
cleanupPreparedEnvironment(ref): TrustedCleanupResult
listPreparedEnvironments(authorityRoot): EnvironmentRef[]
projectWorkspaceEnvironment(ref): { reference, fingerprint, excludedPaths }
inspectEnvironment(input): EnvironmentInspection
parsePreparationResult / parseEnvironmentRef / parseEnvironmentVerification /
parseTrustedCleanupResult / parseEnvironmentInspection
```

## Main handoff

1. Create a private durable `authorityRoot` outside project/workspace; use
   `prepareAuthoritativeEnvironment`, persist the parser-validated `environmentRef` with the attempt.
2. Re-verify via `verifyPreparedEnvironment` (or `projectWorkspaceEnvironment`) before native start,
   before/after checks and before acceptance. Treat every blocked code as non-ready; a required but
   missing credential must throw, never become `undefined`.
3. Pass `excludedPaths` to workspace freeze/patch before staging; only actual environment dirs are
   excluded. Do not edit user `.gitignore`/index/config.
4. Supply the Runner's owned-process adapter as `processPort`; preserve explicit quiescence and do
   not treat `indeterminate`/`unknown` as stopped. Main owns inventory/durable intent/barrier.
5. Cleanup only via `cleanupPreparedEnvironment` during workspace release; surface leftovers and
   blocked codes. Regenerate the root lock for `semver`, `yaml`, `@types/semver` (not committed here).

## NOT_TESTED / limitations

- Main coordinator/workspaces/Runner/console/native vendor integration and an independent Runner
  installing through this port are **NOT_TESTED**.
- npm offline install, arbitrary monorepos, native builds/lifecycle scripts, real network stores and
  multi-manager support remain unsupported or untested; the restricted `pnpm_workspace` mode is
  package-local and intentionally narrow.
- Offline cache warming and credential/account policy are operator/main concerns. The package uses
  the existing Corepack cache read-only and never downloads a manager.
- A-R4 is blocked on a newer main interface consumer; no main-owned path was modified.
