# @personal-agent/environment-preparation

Isolated dependency preparation for a real Node project running inside an attempt worktree. The
original project is read-only; dependencies are prepared only inside the private workspace, with an
explicit policy, bounded subprocesses and an owned cleanup handle. No product wire schema, Work/Ticket
or product database is created here.

## Port

Production consumers use the authoritative entry point; `authorityRoot` is mandatory and a missing or
relative value is blocked with `authority_root_required` before any filesystem write. The older
`prepareEnvironment` remains the explicit compatibility surface for in-process experiments and is
not a production credential path.

```ts
import { prepareAuthoritativeEnvironment } from '@personal-agent/environment-preparation'

const result = await prepareAuthoritativeEnvironment({
  projectPath,            // authorized original project (read only)
  workspacePath,          // private attempt worktree (dependencies may be written here)
  requestId,              // stable idempotency key
  policy: 'existing_only' | 'offline_install',
  signal,                 // AbortSignal; cancellation cleans owned state
  storeDir,               // required for offline_install when dependencies exist
  authorityRoot,          // REQUIRED: caller-owned private dir outside project/workspace (signed receipts + lock)
  processPort,            // optional injected process runner (default: safe standalone port)
  timeoutMs, maxOutputBytes, maxWorkspaceBytes,
})
if (result.status === 'ready') {
  // result.environment: allowlisted child env (PATH; private HOME/XDG/PNPM_HOME for offline installs)
  // result.excludedPaths: pass to the workspace freeze/patch exclusion port
}
// result.status === 'blocked': { code, message, diagnostics, evidence, cleanup }
```

`ready` contains `fingerprint`, manager/node identity, policy, diagnostics, evidence, `environmentRef`,
truly owned `ownedPaths`, and `cleanup()`. In production the ref is always present and `cleanup()`
delegates to receipt-bound cleanup. The compatibility entry without an authority root adds an
`authority_root_missing` warning and is intentionally not accepted by `prepareAuthoritativeEnvironment`.

```ts
import {
  verifyPreparedEnvironment, cleanupPreparedEnvironment, parseEnvironmentRef,
  parsePreparationResult, parseEnvironmentVerification, parseTrustedCleanupResult,
  projectWorkspaceEnvironment,
} from '@personal-agent/environment-preparation'
const ref = parseEnvironmentRef(JSON.parse(readFileSync(refPath, 'utf8')))
const result = parsePreparationResult(await prepareAuthoritativeEnvironment(input))
const verified = parseEnvironmentVerification(verifyPreparedEnvironment(ref)) // second process
const cleaned = parseTrustedCleanupResult(await cleanupPreparedEnvironment(ref))
const portEntry = projectWorkspaceEnvironment(ref) // { reference, fingerprint, excludedPaths }
```

The parsers validate protocol/status/identity fields before a UI, doctor or main adapter consumes a
persisted ref/result. `projectWorkspaceEnvironment` verifies synchronously and throws on a
missing/forged/drifted receipt; it never downgrades a required credential to `undefined`. The opaque
`reference` is the receipt id and contains no host path, matching main's `WorkspaceEnvironmentPort`.

The signed receipt lives under `authorityRoot/receipts/<id>.json` (atomic temp+rename, HMAC-SHA256
with a 0600 `authority.key`), outside project/workspace; the authority root/key and receipts must be
persisted on durable storage to reopen in another process. Workspace markers are never deletion/reuse
authority. Verification rechecks package/lock/dependency identity, workspace directory device/inode,
owned-path inode identity and the installed tree digest; replacement, drift, forged/missing receipts
block. Trusted cleanup deletes only identity-matched signed owned paths and removes the receipt only
after full cleanup. A live workspace lock prevents a second installer; stale locks are removed only
after explicit ESRCH evidence. A new signed receipt supersedes older receipts for the same workspace.
`processPort` lets the coordinator supply its owned-process implementation; it must return explicit
quiescence (`confirmed|indeterminate|unknown`) and the module never treats unproven quiescence as ready.
`blocked` always means no environment may be used; a blocked result still carries `cleanup()` so a
caller can assert leftovers. `EnvironmentPreparationError` is thrown only for an invalid request
(unsafe path containment, invalid requestId, missing AbortSignal) before any filesystem write.

## Modes

- `single` (default): one package.json/lock in the workspace.
- `pnpm_workspace` (explicit opt-in): one root `pnpm-workspace.yaml`, one root `pnpm-lock.yaml`, and
  member packages linked with `workspace:*`. Only literal member dirs and one-level `prefix/*`
  patterns are supported; external `file:`/`link:`, unknown workspace targets, symlink members,
  peer/catalog/patch, nested workspaces and project hooks are blocked before install. Preparation and
  verification cover the root and every member manifest; environment exclusions include root and
  package `node_modules`, while member source files remain in the business patch.

## Policy semantics

| Policy | Behaviour |
| --- | --- |
| `existing_only` | No package manager runs. A dependency-free project is ready. Declared dependencies require an existing, workspace-contained `node_modules` whose realpaths resolve inside the workspace; missing/escaping dependencies are blocked. No user HOME is passed. |
| `offline_install` | pnpm only. Requires `pnpm-lock.yaml`, an authorized offline `storeDir`, and a pnpm version that is already executable offline. Runs exactly `pnpm install --offline --frozen-lockfile --ignore-scripts --store-dir <store>` in the workspace. Never falls back to the network, never installs/upgrades a manager. |

`pnpm` under Corepack is allowed to use an already cached manager (`COREPACK_HOME`), but
`COREPACK_ENABLE_NETWORK=0` and the private HOME prevent downloads and user configuration/credential
reads. `npm` projects are detected for `existing_only`; npm offline installation is not implemented
and is blocked explicitly.

## Detection and blocked states

`package.json`, `pnpm-lock.yaml`/`package-lock.json`/`yarn.lock`/`bun.lockb`, `packageManager` and a
minimal `engines.node` check are read structurally. The module does not reimplement a lock resolver.

Blocked codes include: `invalid_package_json`, `unsupported_workspace` (monorepo/workspaces),
`unsupported_manager` (yarn/bun), `ambiguous_lock`, `manager_lock_mismatch`,
`invalid_package_manager`, `missing_lock`, `network_dependency`, `unsafe_link` (link:/file: outside
workspace, escaping node_modules), `dependency_source_missing`, `unsupported_workspace_dependency`,
`node_version_mismatch`, `dependencies_missing`, `manager_missing`, `manager_version_mismatch`,
`offline_install_unsupported`, `offline_store_missing`, `unsafe_store`, `offline_cache_missing`,
`lock_mismatch`, `manager_incompatible`, `install_failed`, `timeout`, `cancelled`, `output_limit`,
`disk_limit`, `cleanup_unproven`, `project_modified`, `workspace_has_dependencies`.

## Isolation and bounds

- Every child is argv-only, detached in its own process group. Timeout, abort and output-limit paths
  send SIGTERM to the group, then SIGKILL after a short grace, and verify the group is gone. A group
  that cannot be proven gone yields `cleanup_unproven`, never `ready`.
- stdout and stderr share one `maxOutputBytes` budget (default 256 KiB) in arrival order; multi-byte
  UTF-8 characters are never split, overflow is reported as `outputLimited` and the group is terminated.
- The prepared workspace is bounded
  (`maxWorkspaceBytes`, default 1 GiB, `.git` excluded from the size scan).
- The original project's package/lock/git-index and a depth-limited dependency-tree summary are
  snapshotted before and after; any change blocks with `project_modified`.
- Lifecycle scripts are always ignored; a warning records their presence. Native builds are out of
  scope.
- No credentials, `.env`, native profiles or user package-manager config are read or copied. The child
  HOME/XDG/PNPM_HOME point under `.product-environment/home`; `PATH` is the only inherited variable.
  Corepack may read its read-only cache via `COREPACK_HOME`.

## Environment files must not enter the business patch

The prepared state is `.product-environment/` plus `node_modules/` (and member `node_modules` in the
explicit pnpm-workspace mode). `defaultEnvironmentExclusions` returns only paths that actually exist;
preparation additionally drops `.product-environment` unless this preparation created it, so an
absent/foreign directory never appears as owned state. The workspace freeze/patch integration must
pass these exclusions; do **not** edit the user's
`.gitignore`, shared `.git/info/exclude` or Git config to hide them. The proposed public port is in
[RFC-environment-exclusion.md](./RFC-environment-exclusion.md); this package's tests use the same port
with a real Git fixture. A business patch built with the port contains no dependency tree or local
paths.

## Read-only inspection (do not install to probe)

```ts
const report = await inspectEnvironment({ projectPath, workspacePath, policy, storeDir })
// parseEnvironmentInspection(report) validates the package-local shape for a UI/doctor consumer
```

Inspection reuses the same parsers/scanners but never creates `.product-environment`, installs,
writes Git/index, runs project hooks or reads user config. It reports project shape, declared/actual
Node and manager, lock digests, installed/dependency state and capabilities (`existingOnly`,
`offlineInstall`, store authorization, hook blocking, `offlineCacheSufficient: 'unknown'`). When cache
sufficiency cannot be proven it returns `unknown`; it never runs an install to decide. Public
`message`/`suggestions`/`diagnostics` are path-free Chinese data; restricted `evidence` contains only
digests. Stable codes cover bad JSON, lock mismatch, unsupported manager/workspace, hooks, escaping
links, manager/Node mismatch, missing dependencies/store and unproven cache.

## Recipes and consumer examples

- `recipes/build-recipes.mjs --out <dir>` rebuilds a `plain-js` and a `dev-deps` offline pnpm project
  from local tarballs, one shared store, real lockfiles and real tests; no node_modules/store is
  committed. The preparation module installs them offline/frozen/ignore-scripts.
- `examples/inspect.mjs`, `examples/prepare-consumer.mjs`, `examples/verify-consumer.mjs` show a
  caller-owned authorityRoot, one-process prepare, parser-validated serialized ref, second-process
  verify and trusted cleanup. No process-global map or private closure is required.
- `examples/consumption-matrix.mjs` reruns the package-local independent-consumption matrix and can
  write `reports/independent-consumption.json`; it uses only public exports and a second Node process.

Recipe/consumer and workspace preparations are package-local evidence; coordinator/product wiring is
still owned by main and remains NOT_TESTED here.

## Idempotency and fingerprint

`fingerprint = sha256(policy, node version, manager/declared/available version, package.json digest,
lock digests, dependency name/spec digest)`. A marker (`.product-environment/state.json`, 0600) records
protocol, `requestId`, fingerprint, manager and phase. The same request + fingerprint and valid
dependencies reuse the environment (`environment_reused`, marker untouched); a changed request or input
clears the owned environment and prepares again (`stale_environment_cleared`). A `preparing` marker
left by a crash is never treated as ready.

## Run

```sh
pnpm --dir packages/environment-preparation run typecheck
pnpm --dir packages/environment-preparation run test
pnpm --dir packages/environment-preparation run build
```

Measured: Node 24.21.0, pnpm 11.7.0 via Corepack cache, darwin/arm64; 38/38 package tests are
recorded in `reports/test-output.txt` and `reports/execution-status.json`. Offline install
fixtures are generated locally from a tarball dependency with `--offline` only; no registry/network
call is made. Package-manager choice is exercised against the installed pnpm; a fake manager fixture
covers timeout/cancel/output-limit/offline-error paths.

## Dependencies and integration

- Runtime dependencies: `semver` (validated Node/manager ranges, no hand-written resolver) and `yaml`
  (standard pnpm-workspace parser). Dev dependencies: `typescript`, `@types/node`, `@types/semver`.
  The root lock importer must be regenerated by the main agent; this branch does not commit it.
- Workspace integration (owned by main): call `prepareAuthoritativeEnvironment` after `reserve` with a
  private authorityRoot, persist the parser-validated `environmentRef` with the attempt, pass
  `excludedPaths` to the freeze/patch logic, pass `result.environment` to registered checks, and call
  `cleanupPreparedEnvironment` when the attempt/workspace is released. Existing works keep their
  environment until the workspace is released. Main may project a verified ref with
  `projectWorkspaceEnvironment`; expected credential failures throw rather than returning undefined.
- Not a product integration proof: this package's fixtures are package-local; no coordinator, console,
  Runner or native vendor was exercised here. Workspace member packages, recipes and consumer examples
  are verified on real offline fixtures; product integration remains NOT_TESTED.
