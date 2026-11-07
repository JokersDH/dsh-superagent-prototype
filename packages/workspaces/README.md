# @personal-agent/workspaces

Controlled git worktrees for attempts (WP-04). The user's project repository is **only read**
(`rev-parse`, `status`, `diff`, `ls-files`) and is never reset, checked out, cleaned or stashed.
Each attempt gets a detached worktree under the product's own state directory.

## Surface

| Export | Purpose |
| --- | --- |
| `WorkspaceManager.reserve({ projectPath, assignment, baseCommit? })` | Creates the attempt worktree at the base commit and records the user's dirty tracked changes as an audit patch plus the untracked list. |
| `WorkspaceManager.freeze({ attemptId })` | Writes an immutable, content-addressed manifest + audit patch (`manifests/<digest>.json` / `.patch`, never overwritten) and returns `artifactDigest`. |
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

`freeze` writes the manifest and the user-patch audit copy under their digest, so re-freezing identical
content is a no-op and two different candidates can never collide; `digest()` computes the same
manifest in memory and writes nothing.

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
