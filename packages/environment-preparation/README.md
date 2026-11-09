# @personal-agent/environment-preparation

Isolated dependency preparation for a real Node project running inside an attempt worktree. The
original project is read-only; dependencies are prepared only inside the private workspace, with an
explicit policy, bounded subprocesses and an owned cleanup handle. No product wire schema, Work/Ticket
or product database is created here.

## Port

```ts
import { prepareEnvironment } from '@personal-agent/environment-preparation'

const result = await prepareEnvironment({
  projectPath,            // authorized original project (read only)
  workspacePath,          // private attempt worktree (dependencies may be written here)
  requestId,              // stable idempotency key
  policy: 'existing_only' | 'offline_install',
  signal,                 // AbortSignal; cancellation cleans owned state
  storeDir,               // required for offline_install when dependencies exist
  authorityRoot,          // caller-owned private dir outside project/workspace (signed receipts + lock)
  processPort,            // optional injected process runner (default: safe standalone port)
  timeoutMs, maxOutputBytes, maxWorkspaceBytes,
})
if (result.status === 'ready') {
  // result.environment: allowlisted child env (PATH; private HOME/XDG/PNPM_HOME for offline installs)
  // result.excludedPaths: pass to the workspace freeze/patch exclusion port
}
// result.status === 'blocked': { code, message, diagnostics, evidence, cleanup }
```

`ready` contains `fingerprint`, manager/node identity, policy, diagnostics, evidence, an optional signed
`environmentRef`, truly owned `ownedPaths`, and `cleanup()`. With `authorityRoot`, `cleanup()` delegates
to the trusted receipt-bound cleanup; without it a warning marks the legacy in-process mode and no
cross-process receipt exists.

```ts
import { verifyPreparedEnvironment, cleanupPreparedEnvironment } from '@personal-agent/environment-preparation'
const verified = verifyPreparedEnvironment(ref) // serializable ref from another process
const cleaned = await cleanupPreparedEnvironment(ref)
```

The signed receipt lives under `authorityRoot/receipts/<id>.json` (HMAC-SHA256 with a 0600
`authority.key`), outside project/workspace. Workspace markers are never deletion/reuse authority.
Verification rechecks package/lock/dependency identity, owned-path inode identity and the installed
tree digest; replacement, drift, forged/missing receipts block. Trusted cleanup deletes only
identity-matched signed owned paths and removes the receipt only after full cleanup. A live workspace
lock prevents a second installer; stale locks are removed only after explicit ESRCH evidence.
`processPort` lets the coordinator supply its owned-process implementation; it must return explicit
quiescence (`confirmed|indeterminate|unknown`) and the module never treats unproven quiescence as ready.
`blocked` always means no environment may be used; a blocked result still carries `cleanup()` so a
caller can assert leftovers. `EnvironmentPreparationError` is thrown only for an invalid request
(unsafe path containment, invalid requestId, missing AbortSignal) before any filesystem write.

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
- Output is bounded (`maxOutputBytes`, default 256 KiB); the prepared workspace is bounded
  (`maxWorkspaceBytes`, default 1 GiB, `.git` excluded from the size scan).
- The original project's package/lock/git-index and a depth-limited dependency-tree summary are
  snapshotted before and after; any change blocks with `project_modified`.
- Lifecycle scripts are always ignored; a warning records their presence. Native builds are out of
  scope.
- No credentials, `.env`, native profiles or user package-manager config are read or copied. The child
  HOME/XDG/PNPM_HOME point under `.product-environment/home`; `PATH` is the only inherited variable.
  Corepack may read its read-only cache via `COREPACK_HOME`.

## Environment files must not enter the business patch

The prepared state is `.product-environment/` plus `node_modules/`. The package exports
`defaultEnvironmentExclusions` (`EnvironmentExclusionPort`) returning those workspace-relative paths.
The workspace freeze/patch integration must pass these exclusions; do **not** edit the user's
`.gitignore`, shared `.git/info/exclude` or Git config to hide them. The proposed public port is in
[RFC-environment-exclusion.md](./RFC-environment-exclusion.md); this package's tests use the same port
with a real Git fixture. A business patch built with the port contains no dependency tree or local
paths.

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

Measured: Node 24.21.0, pnpm 11.7.0 via Corepack cache, darwin/arm64; 12/12 tests. Offline install
fixtures are generated locally from a tarball dependency with `--offline` only; no registry/network
call is made. Package-manager choice is exercised against the installed pnpm; a fake manager fixture
covers timeout/cancel/output-limit/offline-error paths.

## Dependencies and integration

- No runtime dependency (Node built-ins only). Dev dependencies are `typescript` and `@types/node`;
  the root lock importer must be regenerated by the main agent (this branch does not edit the lock).
- Workspace integration (owned by main): call `prepareEnvironment` after `reserve`, pass
  `excludedPaths` to the freeze/patch logic, pass `result.environment` to registered checks, and call
  `cleanup()` when the attempt/workspace is released. Existing works keep their environment until the
  workspace is released.
- Not a product integration proof: this package's fixtures are package-local; no coordinator, console,
  Runner or native vendor was exercised here.
