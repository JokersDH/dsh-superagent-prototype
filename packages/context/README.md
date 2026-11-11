# Bounded conversation context

Read-only, provenance-carrying project/task context for the main conversation. It never uploads a
whole repository: every read needs an explicit **conversation** grant, every slice has a source,
baseline and content identity, and hard budgets bound files/bytes/token estimate/time.

## Authorization model

Two authorization families exist and are not interchangeable:

- `gateway: 'executor'` — the coding executor's workspace authorization. This package refuses it.
- `gateway: 'conversation'` — a separate, user-visible upload permission bound to the project, the
  requested source kinds, a scope and budgets. It must carry a past `confirmedAt`/`confirmedBy`.

Project metadata, works, checks, deliveries and explicit decisions are safe default reads. Source
files and documents are only listed when the grant's `sourceKinds` includes `document` or
`source_file`; the default never widens an executor authorization into a model upload.

## Request and bundle

`ContextRequest` / `ContextGrant` are package-local service inputs, not a public wire protocol. Main
owns the public DTO; if these need to cross HTTP, main should add the wire schema to
`@personal-agent/contracts` and adapt. The bundle is `context-bundle/1` with:

- `status`: `sufficient | partial | insufficient` plus `omitted[]` reason codes and explanations;
- per slice: kind, project-relative path, character range, `truncated`, bytes, token estimate,
  relevance, `untrusted_data` trust, source baseline (`commit`, `contentDigest`, `digestScope`);
- `injectionFlags[]` for instruction-like text. Flags are observability only; they never change
  authorization, budgets, trust or tool access.

A stale/missing/foreign/cross-project source is omitted with a reason instead of being invented.
When a listed source changed between listing and reading, it is omitted as `stale`.

## Ports

`ContextReadPort` is the only dependency:

- `projectBaseline(projectId)` — current baseline identity (for example a Git commit);
- `listSources({projectId, kinds, allowedPaths, excludedPaths, limit})` — approved descriptors;
- `readSource({source, maxBytes})` — bounded UTF-8 text;
- optional `workContext(workId)` — current contract + scope, used to reject stale contracts.

Implementations in this package:

- `LocalProjectSourcePort` — read-only filesystem/Git-fixture reader. It refuses symlinks, denied
  account/credential/native-home paths, binary files and out-of-root traversal, hashes files for
  provenance and never writes, fetches or executes project code.
- `StaticContextPort` — reference/fake port for approved metadata/evidence/decision descriptors.
- `CompositeContextPort` — merges ports and records source ownership for reads.

A production adapter for persisted works/checks/deliveries belongs to main/A; it implements the same
port and must not expose account material or grant model file/tool permission.

## Invalidation

`ContextReader.revalidate(bundle, port)` re-checks the project baseline and source digests. A changed
workspace baseline, changed content or a missing source yields `stale`/`missing`; old bundles are not
reported as current. Revalidation is read-only.

## Commands

```sh
pnpm --filter @personal-agent/context typecheck
pnpm --filter @personal-agent/context test
pnpm --filter @personal-agent/context build
```

Tests use a real temporary Git/file fixture and fake read ports, including long Chinese text, denied
paths, symlinks, binary/oversized inputs, budgets, pagination, contract staleness, prompt injection,
source disappearance and baseline changes. No model or network call is made.

## Persisted index adapter and authorization preview (wave-04 C3)

`ReadIndexContextPort` consumes A's public read index structurally (`project`, `listWorks`, `work`)
and an optional effective-decisions callback. It projects bounded JSON metadata for project settings,
works and current contracts; logical refs never become filesystem paths. Verification/delivery
identifiers and acceptance flags are summarized inside the work projection because the current read
index has no separate detail port. `buildContextPreview(bundle, validation?)` returns the selected
files, byte/token totals, omission reasons, injection flags, baseline and revalidation validity that
main needs before confirming a conversation upload.

## Context composer (wave-07 C2)

`ContextComposer` composes an explicit-scope, caller-budgeted context in a fixed priority order:
current contract/work → effective decisions → project facts (metadata/verification/delivery) →
conversation messages → artifact metadata → raw project files. Rules:

- a group can only read source kinds the caller's grant actually includes; a plan never widens
  authorization (an ungranted group is `empty` with `denied_kind`, and its unused budget carries to
  later groups);
- the global `maxSlices`/`maxBytes`/`maxTokens` caps hold across all groups; files are an absolute
  count cap, not a proportional budget;
- an incomplete decision-effectiveness scan fails the whole composition with
  `ContextError('scan_incomplete')` instead of composing possibly-stale knowledge;
- revoked/superseded/expired/source-invalid decisions are excluded by the provider, not re-derived
  here; cross-project decisions/messages are omitted with a reason;
- a missing optional provider is `unavailable` with `source_unavailable`, never silently empty;
- every slice is `untrusted_data`; artifact paths are not included (identity/digest/size/time only);
- bytes/tokens are conservative estimates for bounded composition, not billing guarantees.

`buildCompositionPreview` returns the same safety fields main's upload confirmation needs, and
`buildSourceManifest` gives main a stable per-source projection (`sourceId/kind/group/path/contentDigest/
baselineCommit/truncated/bytes/tokens/trust`) plus `omitted`, `injectionFlagPaths` and `budgetClamped`.

### Unified authorization gate (wave-08)

Every source family (port, decisions, conversation, artifacts) passes one gate **before any provider
call**: conversation gateway, project match, purpose match, past `confirmedAt`, unexpired grant and a
positive-integer caller budget. Caller budgets are clamped to the grant (never escalated) and the
clamped dimensions are reported in `budgetClamped`. A grant that expires during the composition
refuses with `grant_expired`; no partial result is returned. Zero/negative/NaN budgets are
`invalid_input` and read nothing.
See `examples/composition-performance.mjs` and `reports/composition-performance.json` for a bounded
deterministic measurement (0 model/network calls).

## Limits

- Relevance ranking is a deterministic lexical heuristic, not semantic retrieval.
- Local reads are text-only; binary/PDF/images are out of scope.
- No production HTTP wiring or persisted read index is claimed here; see the RFC.
