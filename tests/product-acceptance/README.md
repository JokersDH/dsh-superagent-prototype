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
node tests/product-acceptance/run.mjs --suites=selftest --tier=harness-only

# Daily product vertical, negative cases and a loopback SDK mock
node tests/product-acceptance/run.mjs --suites=e2 --tier=e2-controlled-workflow

# Independent browser/geometry/interaction acceptance (Playwright Chromium)
node tests/product-acceptance/run.mjs --suites=e3 --tier=e3-browser-ui

# Bounded mixed cycles plus portability checklist rules
node tests/product-acceptance/run.mjs --suites=e4 --tier=e4-bounded-stability --cycles=12

# Whole package, one fail-closed release claim
node tests/product-acceptance/run.mjs --suites=selftest,e2,e3,e4 --record

# Turn the recorded run into the matrix, execution status and handoff
node tests/product-acceptance/build-handoff.mjs
```

`run.mjs` writes `reports/runs/<UTC timestamp>/report.json`, `release.json` and screenshots under
this directory. A nonzero exit means the gate rejected the claim; the JSON always says why.
`build-handoff.mjs` writes `reports/release-matrix.json`, `reports/execution-status.json` and
`reports/handoff.zh-CN.md` from one recorded run.

Every run prints the source commit, dirty state, Node/platform, the ports it used and the private
state directories it created and removed. Credentials are read from the private state file by the
process that owns it and are never printed, logged or written into a report.

## Tiers

| Tier | Requires |
| --- | --- |
| `harness-only` | The gate self-tests only. No product claim. |
| `e2-controlled-workflow` | The controlled product vertical, negative cases and loopback SDK chat. |
| `e3-browser-ui` | The independent browser suite. |
| `e4-bounded-stability` | Bounded cycles and portability checklist rules. Installation stays NOT_TESTED. |
| `controlled-product-internal-trial` | All of the above; the whole-package claim. |
| `full-product` | Additionally requires portable installation and real native execution. It fails today by design. |

## What each suite asserts

- `selftest/` — 21 bundles prove the gate rejects missing cases, unknown status, uncertain
  acceptance, stale reports, missing candidates, corrupt/unapplied patches, unexecuted native
  evidence, invalid responses, fixture drift and illegal fixtures.
- `cases/e2-daily.mjs` — real SQLite, real scratch subprocess, real verification through
  authenticated loopback HTTP: question/answer/delivery, machine PASS and FAIL, patch application to
  the recorded base commit, artifact byte roundtrip, replay/conflict, stale contract/candidate/answer,
  conversation isolation, stop/continue ticket identity, scope/profile guards, restart persistence
  and a loopback OpenAI-compatible mock chat.
- `cases/e3-browser.mjs` — packaged workbench at 1440×900, 1280×800 and 390×844; conversation-centred
  geometry, no horizontal overflow or cross-region overlap, design tokens, decision inbox, patch
  preview, byte-verified download, UI acceptance and reopen, loading/error/SSE-offline states, tab
  focus, long Chinese/path and list scrolling.
- `cases/e4-stability.mjs` — mixed question/complete/fail/stop cycles with a restart in the middle,
  bounded process/FD/RSS/disk/receipt observation, then portability checklist rules. Installation,
  first-run, backup/restore and upgrade rollback are declared NOT_TESTED while D's paths are absent.

## Boundaries

- Never touches the user's live instances (5180/8796, 5181/8797) or reads an account home, native
  session, real project credential or the default model configuration.
- Each case uses a fresh temporary state directory and an unused loopback port, and removes both.
  A failure keeps its state directory only when `--keep` is passed.
- Playwright is loaded from `apps/console` (the product's own dependency); screenshots are evidence,
  not an aesthetic verdict. Visual comments record concrete geometry/overflow failures only.
- The harness never "fixes" an expectation to make a failing product look green.
