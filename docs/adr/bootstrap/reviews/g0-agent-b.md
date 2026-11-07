# G0 Agent B Acceptance

Date: 2026-11-07. Original Agent B commit: `87deffb`. Integration correction: `ad24d87`.

## Verdict

**Accept the G0 OPS-01 platform slice on darwin/arm64 after the packaging correction.** The original remote commit omitted `src/lib/util.mjs`, because the repository's broad `lib/` ignore also matched source folders. It was not independently reproducible as submitted.

The main agent changed the root output ignore to `/lib/` and included Agent B's existing local helper byte-for-byte. Its SHA-256 is `9467fe6facdaaf8865be6ef298b55277648c70ea7d1500f7bd8689adb1a263d1`; no implementation changes or writes to Agent B's worktree were made.

A new independent checkout of the corrected integration downloaded/checksummed the proposed toolchain into its own cache, installed the binding, and ran:

| Command / check | Result |
| --- | --- |
| `node scripts/fetch-runtime.mjs` | PASS, isolated Node 24.22.2 / pnpm 11.7.0 |
| `node scripts/install-deps.mjs` | PASS, better-sqlite3 13.0.3, shipped prebuild, no local build |
| target Node `scripts/run-probes.mjs --profile release-proposed` | PASS, 30/30 checks |
| target Node `--test test/probes.test.mjs` | PASS, 4/4 tests |
| local Node 24.21.0 `--test test/probes.test.mjs` | PASS, 4/4 tests |
| package/lock/workspace diff after install | Unchanged |

Actual engine is SQLite 3.53.4, above admission 3.51.3. WAL/FK/unique/rollback/savepoint, database online backup and the two SIGKILL scenarios were exercised. Detailed independent identity/check/evidence digests are in `tools/bootstrap/reports/g0-agent-b-review.json`.

## Accepted Build Policy

Preserve an explicit version-pinned `allowBuilds: better-sqlite3: false` decision for this prebuilt-only 13.0.3 combination. Revalidate install/load/backup when the version changes; do not generically approve all dependency scripts or silently substitute another SQLite binding.

## Limits And Handoff

This is not product release approval. Other OS/architectures, afterCommit, production Store/Queue/migrations, resource fencing, artifact/journal backup, installer/signing and real business recovery remain NOT_TESTED or later-gate work.

Storage implementation is WP-02 (Agent A); Supervisor/Runner/DriverKit is WP-03 (Agent B). The original report's phrase “WP-03 formal storage” is an ownership typo and is not adopted by this acceptance.
