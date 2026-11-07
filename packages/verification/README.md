# @personal-agent/verification

Registered checks and trusted verification (WP-04). Only definitions a trusted operator registered
can run; a contract criterion's `checkDefinitionRef` resolves to one, and external text or a worker's
self-report can never become an arbitrary shell command.

## Surface

| Export | Purpose |
| --- | --- |
| `CheckRegistry.register(definition)` | Immutable per `(id, revision)`; a changed body must use a new revision; validates executable, deadline (1 s–10 min), output budget (1 B–1 MB), environment allowlist and a workspace-relative `cwd`. |
| `CheckRegistry.require(id)` | Newest revision of a registered check; an unregistered ref is refused. |
| `VerificationRunner.run(plan)` | Executes the registered checks for a frozen candidate with `spawnSync` (deadline, output budget, allowlisted environment), records real exit/signal/duration/output digest + bounded excerpt, and returns a contract `Verification` bound to the candidate, artifact digest and `completionCriteriaDigest(criteria)`. |

Outcomes are explicit: `PASS` (exit 0), `FAIL` (non-zero, signal, timeout, output limit), `NOT_TESTED`
(missing executable), and trusted `SKIPPED`/`NOT_APPLICABLE` exclusions supplied by the composition
root — never derived from worker text. A changed frozen artifact (checked before and after the run)
or an unregistered check refuses verification entirely. The runner never calls the core completion
gate and never finishes a Ticket.

| `CompletionEvidenceStore` (batch 2) | Implements the core `CompletionVerifier` port: immutable Verification/quiescence/acceptance records in the WP-04 migration tables (`schema v6`). `recordQuiescence` re-checks the runtime observation store and requires explicit `observed_quiescent` writer facts per resource — exits, cancel ACKs, timeouts or missing PIDs never qualify. `resolve` is read-only, synchronous and same-connection, and returns `undefined` for any stale (generation/artifact/contract) or missing record. |

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
