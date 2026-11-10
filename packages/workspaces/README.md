# @personal-agent/workspaces

Controlled git worktrees for attempts (WP-04). The user's project repository is **only read**
(`rev-parse`, `status`, `diff`, `ls-files`) and is never reset, checked out, cleaned or stashed.
Each attempt gets a detached worktree under the product's own state directory.

## Surface

| Export | Purpose |
| --- | --- |
| `new WorkspaceManager(root, { environment? })` | Optional trusted operator port for prepared-environment verification and dependency exclusions. The default has no exclusions. |
| `WorkspaceManager.reserve({ projectPath, assignment, baseCommit? })` | Creates the attempt worktree at the base commit and records the user's dirty tracked changes as an audit patch plus the untracked list. |
| `WorkspaceManager.freeze({ attemptId })` | Writes an attempt-neutral, content-addressed manifest + delivery patch (`manifests/<digest>.json` / `.patch`, never overwritten) plus a per-attempt `manifestRefPath`, and returns `artifactDigest`. The patch includes new/untracked and binary files. |
| `WorkspaceManager.digest({ attemptId })` | Recomputes the artifact digest **without writing** for staleness checks before/after verification. |
| `WorkspaceManager.release({ attemptId })` | Removes only the attempt's own worktree; the manifest stays for audit; repeated release is a no-op. |

## Freeze identity

The manifest is the verification artifact, so its entries must be identity-correct:

| Entry | Identity |
| --- | --- |
| File | SHA-256 of the bytes, plus the executable bit (`mode & 0o111`). |
| Symlink | SHA-256 of `symlink:<link text>` — the link target string, never the target's contents. A dangling link still freezes. |
| Deleted tracked file | `kind: 'deleted'` with a derived digest; a tracked deletion is part of the candidate, not an `lstat` error. |
| Other tracked kind | `kind: 'other'` with its git mode. |
| New/untracked file | Its bytes are included in the delivery patch (text, binary, executable and symlink modes) through a temporary git index; the user's index and worktree are untouched. |

The content-addressed manifest is **attempt-neutral**: two attempts that produce identical content
share one manifest and patch, and the manifest never claims an older attempt ID. Each freeze also
writes `manifests/attempts/<attemptId>.<digest>.json` (returned as `manifestRefPath`) mapping that
attempt to the shared content identity, so audit and current-candidate manifests stay distinct.

`freeze` writes the manifest and the user-patch audit copy under their digest, so re-freezing identical
content is a no-op and two different candidates can never collide; `digest()` computes the same
manifest in memory and writes nothing.

## Prepared environments

`WorkspaceEnvironmentPort.current({ assignment, workspacePath })` is synchronous and runs on every
`freeze` and `digest`. The coordinator adapter must resolve a private, attempt-bound environment
receipt and reverify its content/ownership through the environment module. It returns an opaque
`reference`, a SHA-256 `fingerprint` and verified workspace-relative `excludedPaths`. If an expected
receipt is missing, replaced or stale, it must throw. `undefined` means the attempt deliberately has
no prepared environment. Worker messages and workspace marker files cannot implement this port.

The manager additionally refuses arbitrary source paths, `.git`, traversal, missing directories,
symbolic-link ancestors, and any exclusion tracked in the current index, base commit or later HEAD.
Only `.product-environment` and directories named `node_modules` are eligible. Both the manifest
and the delivery patch omit admitted directories, using literal exclusion pathspecs before the
temporary index is staged. The environment reference, fingerprint, ordered paths and policy version
participate in artifact identity. No user index, ignore file or Git configuration is changed.

The port does not install dependencies, mint deletion rights or replace the caller's resource
barrier. These module tests use a trusted fixture verifier; the production receipt/Runner adapter
and dependency installation remain separate admission steps.

## Boundaries

- A git worktree is **not a sandbox**: it shares the repository's objects, refs, hooks and remotes.
  Delivery stays patch/branch based; nothing here merges, deploys or rewrites user content.
- A failed check must not be "fixed" by resetting the user's tree, so the manager has no such API.

## Run

```sh
pnpm --dir packages/workspaces run typecheck
pnpm --dir packages/workspaces run test
pnpm --dir packages/workspaces run build
```
