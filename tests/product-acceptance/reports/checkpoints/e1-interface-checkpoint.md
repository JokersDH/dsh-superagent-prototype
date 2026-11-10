# E1 stable interface checkpoint

- Branch: `codex/g3-product-acceptance`
- Base merged: `origin/main` @ `3957e30` (from checkpoint base `85922fd`)
- Owned path: `tests/product-acceptance/` only
- Date: 2026-11-10

## What is stable now

| Interface | Meaning |
| --- | --- |
| `run.mjs --suites=… --tier=…` | Collects cases, binds `source.commit`, applies the gate, writes `report.json`/`release.json`, exits nonzero unless the tier is satisfied. |
| `lib/status.mjs` | `PASS/FAIL/SKIPPED/NOT_TESTED/BLOCKED/UNKNOWN`; only `PASS` satisfies. |
| `lib/release.mjs` | Fail-closed aggregation over explicit required case IDs, layers, evidence keys, freshness, source identity, patch/fixture digests, and native execution. |
| `lib/release-requirements.mjs` | Named tiers `harness-only`, `controlled-product-internal-trial`, `full-product`. Adding a capability to a tier is explicit. |
| `lib/http-client.mjs` | Loopback-only authenticated client; credential read after origin proof; redirects refused. |
| `lib/instance.mjs` | Private product/workbench child with owned temp state/ports, process snapshot and bounded teardown. |
| `lib/fixtures.mjs` | Strict acceptance-owned fixture loader with byte digests. |
| `selftest/gate.mjs` | 21 cases proving the gate rejects bad evidence. |

## Evidence

- `reports/runs/2026-11-10T04-34-33-556Z/` — `harness-only` tier, 21/21 PASS, exit 0.
- `reports/runs/2026-11-10T04-34-36-182Z/` — `controlled-product-internal-trial` tier with only
  selftests supplied: gate FAIL, exit 1, 20 `missing_required_case` failures. This is the required
  proof that absent E2/E3/E4 coverage cannot be aggregated into a release PASS.

## Explicit non-claims

- No product workflow has been accepted yet; E2–E5 are in progress in this package.
- No native execution was performed or implied. `actual-native` evidence requires a real vendor run
  and a separately granted budget.
- The dirtiness flag in the checkpoint reports refers to this worktree's uncommitted E1 files; the
  later whole-package run is recorded on the delivered commit.
