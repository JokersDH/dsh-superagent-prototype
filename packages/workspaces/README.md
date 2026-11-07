# @personal-agent/workspaces

Controlled git worktrees for attempts (WP-04). The user's project repository is **only read**
(`rev-parse`, `status`, `diff`, `ls-files`) and is never reset, checked out, cleaned or stashed.
Each attempt gets a detached worktree under the product's own state directory.

## Surface

| Export | Purpose |
| --- | --- |
| `WorkspaceManager.reserve({ projectPath, assignment, baseCommit? })` | Creates the attempt worktree at the base commit and records the user's dirty tracked changes as an audit patch plus the untracked list. |
| `WorkspaceManager.freeze({ attemptId })` | Writes a content-addressed manifest (every file/symlink digest, base/head commit, dirty status) and the environment; returns `artifactDigest`. |
| `WorkspaceManager.digest({ attemptId })` | Recomputes the artifact digest for staleness checks before/after verification. |
| `WorkspaceManager.release({ attemptId })` | Removes only the attempt's own worktree; the manifest stays for audit; repeated release is a no-op. |

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
