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

## Run

```sh
pnpm --dir packages/verification run typecheck
pnpm --dir packages/verification run test
pnpm --dir packages/verification run build
```

Contracts, core, storage and workspaces must be built first (workspace `dist` exports).
