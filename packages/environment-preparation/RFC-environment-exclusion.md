# Interface proposal: environment exclusions for workspace freeze/patch

- Status: proposal from `@personal-agent/environment-preparation`; workspaces owner/main integration required
- Date: 2026-11-09

## Problem

A real project prepared in an attempt worktree owns `node_modules/` and `.product-environment/`.
If the workspace freeze treats every untracked path as a deliverable, dependency trees and private
environment files enter the business patch. Hiding them by editing the user's `.gitignore`, shared
`.git/info/exclude` or Git config is not acceptable: it changes user-owned configuration and makes the
exclusion invisible to review.

## Proposed port

```ts
export interface WorkspaceEnvironmentExclusion {
  /** Workspace-relative directories/files owned by the environment preparation module. */
  environmentPaths(workspacePath: string): readonly string[]
}
```

The workspace manager accepts this port at reserve/freeze time (constructor, or a `freeze` option) and
records the exclusions in the manifest/patch generation. The environment package already exports the
same shape:

```ts
export interface EnvironmentExclusionPort {
  excludedPaths(workspacePath: string): readonly string[]
}
export const defaultEnvironmentExclusions = { excludedPaths: () => ['.product-environment', 'node_modules'] }
```

Callers should also verify that each excluded path is inside the workspace and is owned by the
preparation module (marker or path shape); a caller must not be able to exclude arbitrary source files
by supplying an untrusted list.

## Compatibility and tests

- Existing workspace manifests/patches remain unchanged when no port is supplied.
- In this branch, the same port is exercised by the environment package's real Git fixture: after a
  real offline install, `git status` reports only the excluded environment paths; the business patch is
  empty and tracked sources are unchanged. See `packages/environment-preparation/test/preparation.case.ts`
  ("environment paths are excluded from the business patch...").
- Integration must not change the user's repository configuration; the exclusion belongs to the
  attempt manifest/patch, not to Git ignore state.

## Impact

No shared wire schema, database migration, Work lifecycle or root dependency change. The workspace
owner can implement the port independently; this package's exported port is intentionally structural
and has no dependency on workspace internals.
