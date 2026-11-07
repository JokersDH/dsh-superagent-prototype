# G0 Agent A Acceptance

Date: 2026-11-07. Reviewed commit: `df2a632e8c20880200ddc9961f5cc985bd42e47f`. Base: `f5c5754ec979fbee1d51c187cf0a5b7198e27477`.

## Verdict

**Accept CORE-01 for the isolated extraction slice.** The main agent independently cloned the committed branch into a new temporary checkout, installed its frozen package lock, and reran the checks. This is independent evidence, not a restatement of Agent A's report.

| Check | Main-agent result |
| --- | --- |
| Owned paths | All 34 changed files are under `tools/reuse-spike/core-extraction/`; no root/contracts/storage/native changes |
| Independent install | PASS, only the three declared development dependencies and their lock-resolved test toolchain |
| Provenance and MIT | PASS, exactly 18 expected source/test/license files byte-identical to upstream `8c32a9d` and manifest SHA-256 |
| `pnpm typecheck` | PASS |
| `pnpm test` | PASS, 2 files / 144 tests in the fresh extracted package |
| Author's graph command | PASS |
| Independent AST graph | PASS, TypeScript 6.0.3 parser/module resolver; both runtime and type closure of the core reach 15 local files and only `node:crypto` externally |

Main-agent AST/provenance details are in `tools/bootstrap/reports/g0-agent-a-review.json`; rerun with `node tools/bootstrap/review-core.mjs <checkout-root>`. The extraction package must first have its own dependencies installed. The review command does not modify Agent A's checkout.

## Nonblocking Observations

Agent A's import graph script uses regular expressions and does not generally cover all TypeScript module forms. The main-agent AST audit independently covers import/export declarations, side-effect imports, import types, import-equals and literal dynamic imports/requires for this fixed slice. Any formal reusable dependency gate should use that compiler-backed approach and add negative fixtures. We do not promote the author's regex scanner into the production toolchain.

`git diff --check` reports one extra blank line at EOF in a captured test-output text file. It does not affect source, tests or provenance; it is not a functional blocker.

Section 6 of Agent A's report is advisory. Completion mode granularity, additive `reportAssignment` compatibility and invalidation at input acceptance must follow the shared ADR/WP-01 contract; this acceptance does not automatically approve those implementation suggestions.

## Next Step And Overall Gate

Agent A's G0-A work is accepted and ready to integrate. Keep the original extraction immutable as a reference baseline. Do not turn it into a second production core or start WP-02 migrations before the shared G0 release.

DATA-01 is owned by the main agent; OPS-01 still requires Agent B's platform evidence. Overall G0 is not passed by this report. Native compatibility, external completion guards, real product persistence and end-to-end recovery remain outside CORE-01.
