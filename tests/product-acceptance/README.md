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
- `installed` — a staged bundle executed outside the development checkout.
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
| `harness-only` | The 72 gate self-tests only. No product claim. |
| `e2-controlled-workflow` | The controlled product vertical, negative cases and loopback SDK chat. |
| `e3-browser-ui` | The independent browser suite. |
| `e4-bounded-stability` | Bounded cycles and portability checklist rules. Installation stays NOT_TESTED. |
| `controlled-product-workflow` | All workflow/safety cases; excludes installation and native. |
| `advisory-routing` | Workflow plus advisory attention/route-advice records (experiment only, never the default path). |
| `controlled-review` | Advisory routing plus a controlled independent review with sealed-copy isolation. |
| `actual-heterogeneous-review` | Every lower tier plus a real review executed by a different protocol with version, identity, budget, isolation and subject proof. |
| `module` | Gate self-tests plus frozen contract/capsule fixtures; no product workflow. |
| `actual-native-control` | Controlled workflow plus real native stop/question/recovery control proof. |
| `installed-alpha` | Controlled workflow plus a staged installation outside the checkout. |
| `review-value` | Actual heterogeneous review plus a complete real pilot result; a BLOCKED pilot fails. |
| `local-alpha` | Workflow plus a staged installation outside the checkout; native excluded. |
| `full-product` | Every lower tier plus staged installation and real native execution. It fails today by design. |

`full-product` is a strict superset of the lower tiers by construction, and a required case that is
`NOT_TESTED` fails it. There is no allow-gap switch.

## What each suite asserts

- `selftest/` — 72 bundles prove the gate rejects missing cases, unknown status/layer, uncertain
  acceptance, stale reports, dirty/missing/cross-commit source, unbound cases, empty evidence,
  missing candidates, corrupt/unapplied patches, byte-mismatched downloads, unexecuted or incomplete
  native proof, installation that is not staged, invalid responses, fixture drift and illegal
  fixtures. It also rejects advisory advice that enters the default path, overlaps eligibility,
  lacks evidence or is expired, review dispositions that contradict their findings, review reuse of
  the author assignment, missing sealed-copy isolation, and heterogeneous claims that are not a
  different protocol or lack execution/version/identity/budget/subject proof. The exact wave-04
  false pass is reproduced and must stay rejected.
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


## Independent review pilot (`pilot/`)

The wave-05 task grants `wave05-independent-review-pilot-01` (24 native turns, 200k billable tokens,
USD 5 total). The pilot is **prepared and precommitted but not executed**:

```sh
node tests/product-acceptance/pilot/build-cases.mjs --check   # 8 synthetic cases / 4 seeded defects
node tests/product-acceptance/pilot/harness.mjs --freeze      # hash protocol, cases, oracle, scoring
node tests/product-acceptance/pilot/harness.mjs --dry-run     # scoring/budget/refusal self-test, no model
node tests/product-acceptance/pilot/harness.mjs --preflight   # exit 3 = BLOCKED
```

`pilot/cases/` holds four seeded-defect and four clean candidates; `pilot/hidden/` holds the hidden
oracle tests (4 fail on the defective cases, 4 pass on the clean ones); `pilot/oracle.json` fixes the
labels and keywords. `score.mjs` is hashed into the manifest, so editing the scoring rules after
freezing is refused.

Preflight is **BLOCKED (`pricing_unavailable`, `b_runtime_interface_missing`)**: Codex 0.164.0 is
available and authenticated with an API key, but no operator-provided USD schedule exists for the
configured model, and B has not published the bounded run interface
(`tools/experiments/review-pilot-01/runtime-interface.json`). The protocol forbids treating
subscription/key access as zero cost or fabricating a session runner. Consequently **zero model
turns were started**; `pilot/ledger.json` records 0 turns, 0 reservations and an unknown cost.

The two freeze points from WP-16/0023 are implemented: stage one hashes protocol/cases/oracle/scoring
before any author call, and `freezeCandidate()` digests the real author capsule before any review.
To unblock, the operator supplies `pilot/pricing.json` (`model`, `inputPerMillion`,
`outputPerMillion`, `currency: "USD"`, `source`, `observedAt`) and B publishes the runtime
interface; then `--preflight` must PASS before `--execute`.
