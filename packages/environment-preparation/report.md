# Environment preparation: native MVP round-two delivery

- Package: `packages/environment-preparation/` (branch `codex/g2-workspaces-verification`)
- Base: `5bbd892` (merge `7baeb67`; main-owned workspaces/console kept from origin/main)
- Stable API checkpoint: `8dcbdce`; final source commit is recorded in
  `reports/execution-status.json`.
- Environment: Node v24.21.0, pnpm 11.7.0 via Corepack cache, darwin/arm64; no model calls and no
  networked install.

## Phase results (A1–A6)

| Phase | Result | Evidence |
| --- | --- | --- |
| A1 five admission failures | **PASS** | `node <primary>/tools/bootstrap/review-environment-preparation.mjs --environment $PWD` → `PASS_ENVIRONMENT_ADMISSION`; regression tests for each case |
| A2 receipts/verify/trusted cleanup | **PASS** | HMAC-signed receipts under caller-owned `authorityRoot`; cross-process verify/cleanup; forged receipt, replaced owned path, drift, changed package/lock, corrupt key all refused |
| A3 process port/cancel/concurrency/bounds | **PASS** | injectable `EnvironmentProcessPort` with explicit quiescence; workspace lock (live pid blocks, only ESRCH stale removal); interrupted marker not reused; cancellation in probe/install; output/time/disk budgets with cleanup |
| A4 read-only inspection | **PASS** | `inspectEnvironment` + runtime parser; no environment/install/git/hook writes; Chinese code/message/suggestions; cache sufficiency explicitly `unknown`; stable blocked codes |
| A5 recipes/consumer/recovery/performance | **PASS** | `plain-js` and `dev-deps` offline recipes install and run real node tests; consumer prepare → second-process verify → trusted cleanup; receipt enumeration after lost ref; performance report |
| A6 restricted pnpm workspace | **PASS (package-local)** | one root/one lock, `app workspace:* lib`, offline install, app test calls lib, verify covers all manifests; external links/unknown targets/symlink members/bad globs/peer blocked; business patch includes only member source |

Original 12 tests are preserved; the package now has **31/31** tests.

## Actual commands

```sh
cd packages/environment-preparation
pnpm run typecheck          # PASS
pnpm run test               # 31/31 PASS
pnpm run build              # PASS (dist importable)
node recipes/build-recipes.mjs --out /tmp/pa-env-recipes   # RECIPES_BUILT
node ../../tools/bootstrap/review-environment-preparation.mjs --environment "$PWD"  # run from primary for the official probe
```

Performance measured in `reports/performance.json`: a 10-file installed tree prepared in 2 ms,
verified in 0 ms, cleaned in 1 ms; a 1,000-file tree prepared in 7 ms, verified in 6 ms, cleaned in
0 ms (darwin/arm64, local fixture; these are measurements, not release thresholds).

## Interface summary

```ts
prepareEnvironment(input): ReadyEnvironment | BlockedEnvironment
verifyPreparedEnvironment(ref): EnvironmentVerificationResult
cleanupPreparedEnvironment(ref): TrustedCleanupResult
listPreparedEnvironments(authorityRoot): EnvironmentRef[]
inspectEnvironment(input): EnvironmentInspection
parseEnvironmentInspection(value): EnvironmentInspection
```

`ready` carries `fingerprint`, manager/node identity, policy, allowlisted environment, signed
`environmentRef`, truly owned `ownedPaths`, diagnostics/evidence and `cleanup()`. Inputs include
authorized project/workspace, stable request id, AbortSignal, explicit policy, optional authorized
offline store, authorityRoot, injected process port and `mode: 'single' | 'pnpm_workspace'`.
Workspace markers are never deletion/reuse authority. Receipts bind manifests/locks/dependencies,
installed layout, policy, Node/manager versions, and owned path device/inode identity.

## Integration notes for main

1. Create a private caller-owned `authorityRoot` outside project/workspace; persist the returned
   `environmentRef` (JSON) alongside the attempt.
2. Before native start, verification checks and acceptance, call `verifyPreparedEnvironment`; treat
   `blocked` as non-ready (drift/inputs changed/ownership changed/forged receipt).
3. Pass `ownedPaths`/`excludedPaths` into the workspace freeze/patch integration; only these paths are
   environment state. Member source files stay in the business patch (A6 fixture proves it).
4. Supply the coordinator's owned-process adapter as `processPort`; it must return explicit
   quiescence. Release owned paths with `cleanupPreparedEnvironment` during workspace release; an
   `indeterminate` / `cleanup_unproven` result must remain visible, never treated as cleaned.
5. New root-lock request: `semver`, `yaml` runtime deps and `@types/semver` dev dependency; this
   branch does not commit the root lock.

## Limitations / NOT_TESTED

- Coordinator/workspaces/console/Runner/native vendor integration is **NOT_TESTED** here; this is a
  package-local port plus real Git/offline-pnpm fixtures.
- Offline cache must be warmed by an authorized operator; the module never performs a networked
  install or manager upgrade. npm offline install, arbitrary monorepos, native builds and lifecycle
  scripts are unsupported by design (blocked with stable codes).
- A6 workspace support is intentionally narrow: literal members and one-level `prefix/*`; peer/catalog
  and external links are blocked. Independent Runner recovery and installed-vendor compatibility remain
  separate lanes.
