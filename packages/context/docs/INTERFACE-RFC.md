# C1 interface RFC — bounded conversation context

Status: implementation checkpoint. Branch `codex/g3-assistant-context`, base `origin/main`
`3957e30`. Owner: Agent C. Owned paths: `packages/context/`.

## Purpose

Give the main conversation a bounded, source-attributed view of an authorized project and current
task without making the coding executor's workspace permission an implicit upload permission, and
without a model-side repository reader.

## Consumed shared semantics

Only `@personal-agent/contracts` public schemas/types are consumed: `Scope`, `ContractRef`,
`Id`, `Timestamp`. No private wire replacement type is introduced. `ContextRequest` and
`ContextGrant` are package-local service inputs; see the wire-DTO gap below.

## Required ports

### A (storage/workflows read index) — production `ContextReadPort`

| Method | Semantics |
| --- | --- |
| `projectBaseline(projectId)` | Current baseline identity (`commit` for Git, `capturedAt`). `undefined` means unknown, not empty. |
| `listSources({projectId,kinds,allowedPaths,excludedPaths,limit})` | Bounded descriptors for approved project metadata, works, contracts, verifications, deliveries and decisions. No account/credential/native-home content. |
| `readSource({source,maxBytes})` | Bounded UTF-8 content; throws `missing/binary/oversized/denied_path/cross_project`. |
| optional `workContext(workId)` | Current contract + scope + validity. Required to reject stale/foreign contracts. |

Descriptor requirements: stable `sourceId`, project-relative `path`, `kind`, `bytes`, `mediaType`,
`validity` and `baseline` (`commit?`, `contentDigest`, `digestScope`, `capturedAt`). A read index may
not write, fetch, execute project code or grant model permissions.

### Main (application/HTTP/model adapter)

1. Define the public context request/grant DTO in `@personal-agent/contracts` if this surface crosses
   HTTP, and map it to `ContextRequest`; do not copy the private types into a second protocol.
2. Issue a `gateway: 'conversation'` grant only after a visible user confirmation bound to
   project, source kinds, scope and budgets. Never derive it from an executor workspace grant.
3. Keep the model adapter out of the read loop: the model receives only the returned bundle text; it
   cannot call `listSources`/`readSource`, write files or run commands.
4. Revalidate a bundle before reusing it after workspace/project changes.

## Invariants enforced

- executor gateway, purpose mismatch, expired/future confirmation → refused before listing;
- denied account/credential/native-home/binary paths and external schemes/traversal → refused or
  omitted with a reason;
- file-backed kinds additionally obey `allowedPaths`/`excludedPaths`; metadata/work/decision logical
  paths only obey project/denied-path rules;
- hard caps: `maxFiles`, `maxBytes`, `maxTokens` (CJK-aware conservative estimate), `maxDurationMs`,
  `maxSlices`; pagination via opaque non-negative cursor;
- every slice is `untrusted_data`; instruction-like text is flagged, never promoted to authority;
- stale/missing/cross-project sources are omitted with explicit reasons, never fabricated;
- revalidation reports `current | stale | missing` and baseline change.

## Evidence

- `test/interface.case.ts` — grant/purpose/project/expiry/denied-path/contract checks.
- `test/reader.case.ts` — budgets, pagination, omission reasons, injection, revalidation, read-only port.
- `test/local-git.case.ts` — real temporary Git/file fixture, symlink/credential/binary/oversize
  refusal, no mutation, baseline change.
- 28/28 package tests pass; `typecheck` and `build` pass.

## Gaps

1. **Main**: public `ContextRequest`/grant/`ContextBundle` wire DTO and HTTP/SSE projection.
2. **A**: persisted read index implementing `ContextReadPort` with baseline/digest/validity.
3. **Main**: conversation-upload confirmation UI/preview and grant lifecycle.
4. **A/main**: indexes for checks/deliveries/decisions currently have fixture adapters only.
5. Semantic retrieval, PDF/binary extraction and cross-project retrieval are out of scope.

Until these land, main/A can consume the fixture ports and the same package-level interface; no
private alternative implementation should be added to coordinator/console.

## Wave-04 C3 — persisted read-index adapter and preview

`ReadIndexContextPort` consumes A's public read index structurally (`project`, `listWorks`, `work`)
plus an optional effective-decisions callback. It projects bounded JSON descriptors for project
settings metadata, works and current contracts; logical refs are not filesystem paths. Contract
currentness uses `contractState`/`authorityState`; a stale contract yields `contract_stale` before
any work content is uploaded.

`buildContextPreview(bundle, validation?)` returns the selected files, byte/token totals, omission
reasons, injection flags, baseline and revalidation validity for main's preview/confirm UI. It is a
pure projection over an existing bundle and cannot widen a grant or budget.

Remaining gaps: the current read index has no separate verification/delivery detail port, so
verification ids and acceptance flags are summarized inside the work projection; work listing uses
one bounded page (`workLimit`) instead of a cursor; the effective-decisions callback must come from
knowledge governance (main wires it) and only current-source decisions are returned.
