# @personal-agent/verification

Registered checks and trusted verification (WP-04). Only definitions a trusted operator registered
can run; a contract criterion's `checkDefinitionRef` resolves to one, and external text or a worker's
self-report can never become an arbitrary shell command.

## Surface

| Export | Purpose |
| --- | --- |
| `CheckRegistry.register(definition)` | Immutable per `(id, revision)`; a changed body must use a new revision; validates executable, deadline (1 s–10 min), output budget (1 B–1 MB), environment allowlist and a workspace-relative `cwd`. |
| `CheckRegistry.require(id)` | Newest revision of a registered check; an unregistered ref is refused. |
| `VerificationRunner.run(plan)` | Async; executes each registered check in its own process group off the event loop, with deadline, output budget and allowlisted environment. Records real exit/signal/duration/output digest + bounded excerpt, and returns a contract `Verification` bound to the candidate, artifact digest and `completionCriteriaDigest(criteria)`. |

Outcomes are explicit: `PASS` (exit 0), `FAIL` (non-zero, signal, timeout, output limit), `NOT_TESTED`
(missing executable, or a child that could not be proven gone), and trusted `SKIPPED`/`NOT_APPLICABLE`
exclusions supplied by the composition root — never derived from worker text.

**Frozen-artifact guard is mandatory and fail-closed.** `plan.verifyArtifact` is required and must
return exactly `true` before the first check and after the last. A missing guard, `false`/`undefined`,
or a throw refuses verification (`VerificationUnavailable`); there is no default that returns true.

**Bounded liveness.** A deadline sends SIGTERM to the check's process group, then SIGKILL after a
short grace. If the group cannot be proven exited within a hard cleanup bound, the check is
`NOT_TESTED` with `cleanupUnproven` — never PASS. Captured pipes are destroyed so descendants cannot
hold the coordinator; a process group is not a sandbox. The runner never calls the core completion
gate and never finishes a Ticket.

| `CompletionEvidenceStore` (batch 2) | Implements the core `CompletionVerifier` port: immutable Verification/quiescence/acceptance records in the WP-04 migration tables (`schema v6`). `recordQuiescence` takes the **trusted barrier receipt** and re-verifies the current-by-ticket attempt pointer, binding state, full registered-resource manifest, `runtime.barrier.confirmed` event topic, producer identity, the committed barrier command result and the host writer fact covering every resource; the proving `factId`s are stored. `resolve` is read-only, synchronous and same-connection, re-checks that whole chain (including the current pointer), and returns `undefined` for any stale (generation/artifact/contract/epoch) or missing record, so a late resource or new attempt invalidates it. Writes join the caller's UnitOfWork; callers checking evidence outside the core gate should resolve inside `store.uow.atomic`. |

Documents stay patch/branch based: the runner does not merge, deploy or touch the user's original
worktree (see `@personal-agent/workspaces`).

## Run

```sh
pnpm --dir packages/verification run typecheck
pnpm --dir packages/verification run test
pnpm --dir packages/verification run build
```

Contracts, core, storage and workspaces must be built first (workspace `dist` exports).

WP-04 uses the storage owner's migration entry (`schema v6`, completion evidence tables); v1–v5
checksums are unchanged. See `report.md` for acceptance evidence and the main-agent wiring steps.
