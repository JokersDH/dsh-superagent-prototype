# Independent Product Acceptance (Agent E)

Owner: Agent E. This directory is the only production-independent acceptance surface. It never
imports or edits production state machines, root manifests, shared schemas or migrations. Every case
consumes a public entry point: authenticated loopback HTTP, the packaged console, the read-only
product database, or documented CLI commands.

## Why this directory exists

Main, A, B and C keep publishing their own package tests. A package test passing does not prove the
product: it proves the package. This harness answers a different question — can an outside consumer
take the delivered product as shipped, drive the documented public paths, and see honest failures?

The first job is therefore not to find passes. It is to prove this tool **can fail**. `selftest/`
constructs bad evidence bundles (missing required case, unknown status, uncertain acceptance, illegal
fixture, stale report, no candidate, corrupt patch, unexecuted native) and asserts the release gate
rejects every one. A gate that cannot reject is worthless.

## Status vocabulary

| Status | Meaning |
| --- | --- |
| `PASS` | The exact case ran here and every assertion held. |
| `FAIL` | The case ran and at least one assertion failed. Always blocks a release claim. |
| `SKIPPED` | The case did not run; an explicit reason exists and it is not claimed as covered. |
| `NOT_TESTED` | The capability is absent from the current checkout; nothing was executed. |
| `BLOCKED` | An external dependency or owner gap prevents execution. |
| `UNKNOWN` | Evidence was collected but is insufficient to decide. Never counts as coverage. |

Only `PASS` satisfies a requirement. `NOT_TESTED` may be honest on an internal-trial checklist, but it
can never be aggregated into "release PASS".

## Layers

Every case declares exactly one layer, and a release tier lists the layers it may consume:

- `controlled-fixture` — real product/SQLite/controlled scratch subprocess; zero vendor calls.
- `sdk-mock` — real product + local mock OpenAI-compatible endpoint on loopback; zero external calls.
- `readonly` — inspect-only commands/files; no writes.
- `actual-native` — a real vendor agent (Codex) executed. Budget-gated; not run by default.
- `not-tested` — declared gap, no execution.

`controlled-fixture` and `sdk-mock` never substitute for `actual-native`.

## Run

From the repository root, after `pnpm install --frozen-lockfile --ignore-scripts` and
`pnpm -r --filter '@personal-agent/*' build`:

```sh
# Tool can fail (fast, no server)
node tests/product-acceptance/run.mjs --suites=selftest

# Daily product vertical, negative cases and reader observations
node tests/product-acceptance/run.mjs --suites=e2

# Independent browser/visual acceptance (needs Playwright Chromium)
node tests/product-acceptance/run.mjs --suites=e3

# Bounded stability cycles plus portability fixtures
node tests/product-acceptance/run.mjs --suites=e4 --cycles=12

# Everything executable here, then aggregate one release claim
node tests/product-acceptance/run.mjs --suites=selftest,e2,e3,e4 --record
```

`run.mjs` writes `reports/runs/<UTC timestamp>/report.json`, `release.json` and screenshots under
this directory. A nonzero exit means the gate rejected the claim; the JSON always says why.

Every run prints the source commit, dirty state, Node/platform, the ports it used and the private
state directories it created and removed. Credentials are read from the private state file by the
process that owns it and are never printed, logged or written into a report.

## Boundaries

- Never touches the user's live instances (5180/8796, 5181/8797) or reads an account home, native
  session, real project credential or the default model configuration.
- Each case uses a fresh temporary state directory and an unused loopback port, and removes both.
  A failure keeps its state directory only when `--keep` is passed.
- Playwright is loaded from `apps/console` (the product's own dependency); screenshots are evidence,
  not an aesthetic verdict. Visual comments record concrete geometry/overflow failures only.
- The harness never "fixes" an expectation to make a failing product look green.
