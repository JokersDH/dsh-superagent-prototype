# G0 Main-Agent Handoff

Date: 2026-11-07. Decision: **G0 passes for G1 implementation on the measured darwin/arm64 baseline.** This does not approve a product release or claim native-agent compatibility.

Machine-readable decision: [g0-status.json](g0-status.json). Frozen contract identity is published in `packages/contracts/generated/manifest.json`; the accepted runtime inputs are in `tools/bootstrap/release-baseline.json`.

## Work Delivered

The shared `@personal-agent/contracts` package has 76 runtime wire schemas, all 14 user command variants, normalized question/answer and fact payloads, type-only Driver/Application ports, generated inferred aliases, built ESM/declarations, JSON Schema 2020-12 and version/source hashes. The former product-spec types re-export this one source.

Strict/contextual validation rejects vacuous acceptance, missing/unregistered machine checks, spoofed user authority fields, unprepared Runner identity, unsafe integer IDs, wrong native answer choices/forms, mismatched current candidate references and unknown-send safe replay. These data checks do not replace trusted authorization, transactional freshness or actual external evidence.

Bootstrap templates preserve the original DSH plugin and validate pnpm workspace discovery in a disposable fixture. Root dependency lock and original runtime behavior remain intact. The eventual root workspace activation/lock consolidation is a WP-16/G1 action.

## Actual Verification

| Check | Result |
| --- | --- |
| contracts `pnpm run check` | PASS: generated artifacts, strict typecheck, 183 tests, ESM/.d.ts build |
| Contracts on target Node 24.22.2 | PASS: 183 tests |
| Standalone package outside repository | PASS: frozen-lock install, all checks, built ESM self-import and parse; no DSH dependencies |
| Bootstrap validator | PASS: packages/apps/nested drivers discovered; original plugin fields/scripts preserved |
| Original root `pnpm check` | PASS: typecheck, 59 files / 1197 tests, original build; existing CommonJS recommendation remains a warning |
| Agent A independent review | PASS: exact 18-file provenance, 144 tests, compiler-backed runtime/type graph |
| Agent B corrected independent review | PASS: Node 24.22.2, pnpm 11.7.0, binding 13.0.3, SQLite 3.53.4; 30 probes and 4+4 tests |

Evidence is in package `reports/`, `tools/bootstrap/reports/`, and the two linked acceptance reports. The broad root `lib/` ignore was corrected to `/lib/`; Agent B's omitted helper was included byte-identically and the corrected checkout independently rerun. Neither other Agent's active worktree was modified.

## Shared Interface Rules

Import public types/parsers from `@personal-agent/contracts` after building; during isolated source development use the package's actual source, not a private copied type model. JSON Schema is structural; trusted ingress uses Zod plus contextual helpers. Runtime facts store `{ kind, value }` behind payloadRef; turn end, cancel acknowledgment, process exit and writer quiescence are distinct.

The first frozen v1 consumer fixture is a regression baseline for future changes, not proof against an earlier released product. A contract/hash change is coordinated by the main owner and followed by consumer/Driver regression.

## Next Wave

- Main Agent: WP-01 formal core extraction and additive completion/fence changes; WP-16 G1 workspace/integration.
- Agent A: WP-02 real storage, repositories, effects and single-owner migrations. Use original ports and the frozen contracts; final acceptance still depends on WP-01.
- Agent B: WP-03 Supervisor/Runner/DriverKit and fixture subprocesses; final acceptance depends on core/storage integration.

Each owner starts a new G1 branch from the integrated main baseline, preserves local changes, and keeps completed G0 evidence immutable. The current G0 branches should not be reused as unlimited authorization to modify shared files.

No automatic merge/deploy, native model tasks, production databases, account/profile changes or learning experiments were performed. G1–G6 remain future work.
