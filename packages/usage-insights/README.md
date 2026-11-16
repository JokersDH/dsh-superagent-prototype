# @personal-agent/usage-insights

Read-only efficiency observation over facts the product already records. The module turns
`ExecutionOutcome`, `ReviewTiming`, `AttentionPage` and `WorkEvidence` into a deterministic,
sanitized summary and a readable report.

It owns **no** storage, SQL, queue, scheduler, model call or execution authority. It is not a ledger,
not a benchmark and not a benefit measurement.

## What it measures, and what it refuses to claim

| Metric | Unit | What it is |
| --- | --- | --- |
| `outcomes.count` | count | Distinct outcomes per evidence layer. |
| `outcomes.accepted` | count | Outcomes whose recorded acceptance is exactly `accepted`. |
| `execution.durationMs` | ms | Mean duration the producing system recorded. **Not** a queue time. |
| `queue.waitMs` | ms | Mean explicit queued-at → dispatched-at interval bound to the same attempt. |
| `review.readyToAcceptanceMs` | ms | Mean `ReviewTiming.readyToAcceptanceMs`, re-checked against its own timestamps. |
| `review.activeMs` | ms | Mean observed **UI-visibility proxy**. Never human working time or a quality score. |
| `usage.inputTokens` / `usage.outputTokens` | tokens | Sum of **known** tokens only. |
| `usage.cost` | one row per currency | Sum of known recorded cost. Currencies are never added together. |
| `interventions.*` | count | Distinct traceable question / answer / acceptance facts per observed work. |

Invariants enforced by the schema and the analyser:

1. A missing observation is `null` **with a reason** (`timing_missing`, `endpoint_missing`,
   `acceptance_unknown`, `source_missing`, `not_collected`, `insufficient_data`, …). It is never zero.
2. `EvidenceLayer` values (`actual_native`, `controlled`, `protocol_fixture`, `schema`,
   `operator_note`) are never merged. Every outcome-derived row carries exactly one layer.
3. Interaction metrics carry **no** layer: they describe product records, not execution evidence.
4. An identity that arrives twice with the same body counts once; an identity that arrives twice with
   different bodies is quarantined in full — the module never picks a winning version.
5. A truncated page, capped scan or rejected record (`hasMore`, `truncated`,
   `window: caller_limit|storage_cap`, `invalid`, `conflicted`, `unmapped`) can only ever downgrade
   coverage. It can never read as complete, and the per-source `losses` block explains every
   presented record.
6. An empty but complete window is reported as complete with zero counts, not as missing data.
7. A producer's own `actual_native` label is retained as *recorded*, never upgraded: reports say the
   layer was recorded by the producing system.
7a. Every record class obeys the declared project set and window: work entries are filtered by
   `entry.at`, and a work's project comes only from the collector's `workIndex` or the work's own
   outcome. An unmapped work is isolated and counted as unknown — never as one observed problem and
   never as a proven zero.
7b. Declared bounds are applied *before* parsing. `maxRecords` counts **units**: an outcome, a
   work/history container, a timeline entry and an attention item each cost one, and a container is
   charged with all of its derived records. Admission is atomic, so a container that does not fit is
   skipped whole — a wrapper can never hide its children behind one unit. `maxPages` counts page
   documents while their contents are still charged to `maxRecords`. An exact fit is a complete
   enumeration; `stoppedBy` names the bound that actually stopped collection.
7c. A work index that maps one work to two projects permanently tombstones that work for the whole
   input: no later or reordered entry can revive it, and its entries and outcomes are excluded.
8. Operator baselines stay an explicit `operator_note` input. A comparison is
   `observation: 'observational_only'` and produces no percentage saving, saved hours or causality.
9. A readiness/configuration snapshot may be attached for context; it contributes no metric, sample
   or native proof and reports `authority: 'none'`.

## Protocols

- Input bundle: `usage-insights-input/1` (`UsageInsightsInputSchema`)
- Stable summary: `usage-insights/1` (`UsageInsightsSummarySchema`)
- Full analysis: `usage-insights-analysis/1` (`UsageInsightsAnalysisSchema`)
- Operator baseline: `operator-baseline/1` (`OperatorBaselineSchema`)

```ts
// Node: analysis, composition and reports (needs node:crypto for canonical digests)
import { analyzeUsageInsights, composeUsageInsightsInput, renderMarkdown } from '@personal-agent/usage-insights'
// Browser: types, compact projection and admission mirror only — no node: builtins
import { toInsightConsumerView, consumerAdmission } from '@personal-agent/usage-insights/browser'

const analysis = analyzeUsageInsights(bundle)      // pure: same input ⇒ same summaryId
const summary: UsageInsightsSummary = analysis.summary
const markdown = renderMarkdown(analysis)
const view = toInsightConsumerView(summary)        // declares scope/coverage/window for the UI
```

`composeUsageInsightsInput` turns an **already-authorized** read port into a bounded bundle. It adds
no authority: main authenticates and authorizes, and this module only reads the facts that decision
already covers. It creates no HTTP server and no SQL.

In the shipped product the caller is the coordinator's own `usage-observation` reader, which applies
its independent limits (50 works, 10 000 nested records, 2 MiB, 2 s) before calling
`analyzeUsageInsights` and projects the summary into the `usage-observation/1` DTO the workspace
renders. `test/main-consumer.case.ts` exercises that real reader and the real workspace admission
function, so a drift in either consumer fails here.

`analyzeUsageInsights` reads no clock, no filesystem and no network. `capturedAt` comes from the
bundle, so a stored bundle always reproduces its summary.

## Export

Two exports exist, and they are distinguishable on purpose.

`buildInsightExport(summary, { maxRows, maxBytes, previous })` produces the numeric
`usage-insights-export/2` document: the input digest and summary id, window/timezone/scope, per-source
coverage, the attention snapshot, a `snapshot` block and one row per metric+layer+currency with a
stable `rowId`, unit, numeric and formatted value, sample/unknown/excluded counts, row coverage and
the missing reason. Row and byte truncation are explicit, and the recorded `bytes` equals the written
file size.

The `snapshot` block binds the document to exactly one observation: `snapshotId` is the analysis
summary id, `continuity` is `first_observation` (no previous declared), `same_snapshot` (the declared
previous export carries the same id) or `new_snapshot` (a re-read — the document then names the
previous id in `previous`, states `note`, and repeats that note as the first limitation). A previous
export contributes **only** its identity: no value is copied, so an earlier export is never extended
with newer numbers. `previousSnapshotOf(document)` reads that identity from a v2 export, from a
display export, or from a v1 export (`exportedFrom.summaryId`).

`buildDisplayExport(servedDocument, { maxRows, maxBytes, previous })` produces
`usage-insights-display-export/1` from the document the coordinator serves. That document carries
formatted strings only, so the display export has **no numeric field at all**: each row keeps the
served `rowId`, label, layer, unit, formatted string and sample count verbatim, and the document
declares `sourceIdentity.numericValues = false`. Parsing `12.3` back into a number would invent
precision the source never had, so nothing here does it.

`crossCheckAnalysisWithDisplay({ dto, summary })` verifies that the served page and an analysis of the
same window/scope agree row by row. It parses the served strings **for comparison only**; the parsed
value never leaves that module. Agreement is bounded by half the coordinator's one-decimal rounding,
and the result reports every disagreement (`window_mismatch`, `metric_missing_in_display`,
`value_mismatch`, `sample_mismatch`, `header_sample_mismatch`, …) instead of reconciling it.

`expectedDisplayId(row)` mirrors the coordinator's `metricId@layer@currency` id (with the literal
`product` when a row has no evidence layer, and a trailing separator when there is no currency) so a
consumer can map G's `metricRowKey` onto the served id; `metricRowKey` itself stays the stable
identity of the export row.

## Row semantics and support

`rowSemantics(row, summary)` explains one row without changing it: whether the sample count is an
outcome basis or a product-record basis, whether the value is `known`, `unknown` or `partial_proxy`,
and a note (`not observed … never zero`, `UI-visibility proxy, not human working time`). The report
prints that state as a `Value state` column next to the stable `Row id` (`metric@layer@currency`), so a
proxy row is never read as a measurement and two currencies or layers never collapse into one line.
`rowCoverageMeaning(row)` states what a row's coverage does and does not establish: an enumerated
source with no recorded value is *not* a measured zero.

`describeDisplayDocument(document)` returns a sanitized support summary: status, identity, window,
scope, coverage, counts and one entry per row with its layer, unit, value-present flag and sample
count. It accepts **both** the served `usage-observation/1` payload and the `usage-insights-display-export/1`
file a user downloaded (`documentKind` says which), because the file is what a colleague actually has.
It copies **no** formatted value, label, detail or path, so a support ticket cannot be turned into a
numeric claim.

`buildSupportReport({ observation, origin })` adds two blocks a trial report needs: `origin` (build id,
source commit, package digest, capability flags, browser trigger, and the list of capabilities the
package is missing) and `evidence` (`coverageState`, rows with/without a value, whether the observation
is partial, and `absentFacts` — the things that are missing and must not be read as zero). Without a
package the origin is `null` and `exportCapability` is `unverified`; a malformed capability block
degrades to `unverified` instead of being read as "absent". `renderSupportSummary` / `renderSupportReport`
render either as Markdown. The contract for D/E/H is in
`reports/usage-insights/support-contract.zh-CN.md`.

## Compatibility with the product download

main's `GET /v1/insights/export` wraps `buildDisplayExport(observation, { maxRows: 32, maxBytes:
65536 })` in a `usage-observation-download/1` envelope whose contract pins the display document shape
(`snapshot.continuity: first_observation`, `previous: null`, `note: null`, `truncation.maxRows: 32`,
`maxBytes: 65536`, `byRows: false`, `exportedFrom.reader` exact). That shape is therefore frozen for
the served path: adding or removing a display field, changing a default bound or the reader string
would make the product route reject its own export. `test/download-route.case.ts` mounts the real route
and parses the real contract, so such a change fails there first.

## Support port

`support-port.ts` is what main composes (Node only; nothing here enters the browser):

- `readSupportDocument(document, { origin })` accepts the served observation, the downloaded display
  document, or the `usage-observation-download/1` envelope. For an envelope it **recomputes** the
  SHA256 (a shape-valid envelope with a wrong digest is a `mismatch`, not a pass) and checks field
  conservation (`rowsMatch`/`scopeMatches`/`windowMatches`/`headerMatches`). An envelope that fails
  the product contract is still diagnosed, with `contractValid: false`.
- `buildSupportFile(report)` / `readSupportFile(file)` — the shareable `usage-insights-support/1`
  artifact, bounded to 64 KiB, with its own digest.
- `supportLabels(report)` — the three strings the trial workspace already renders (`packageLabel`,
  `sourceLabel`, `note`), with nothing invented when no package was inspected.
- `createSupportHandler({ resolveOrigin })` — a framework-free `(document) => { status, body }` for
  main to mount; refusals never echo the input.
- `originFromManifest(manifest, capabilities, options)` — the single identity implementation: a
  manifest declares identity or it does not. Build + a 40-hex commit is `install-manifest`; only one of
  them is `incomplete-manifest` with the rest `null`; neither is `null`. A branch name, a path or a
  bundle keyword never becomes a commit hash.

## Runtime identity

`runtime-identity.ts` answers "what is running", not "what was shipped": it reads the installation
directory (`install/install.json` plus the installed usage-insights/coordinator/console files) and
reports build, source commit, dirty flag, declared file count and per-capability evidence. A manifest
claim cannot make a missing route look present; a missing or partial manifest stays
`incomplete-manifest`/`unknown`; a branch name or path never becomes a commit hash; and an archive
digest is only reported when a file was actually hashed (a declared expected value with no archive to
hash leaves the comparison `null`, because comparing a value with itself proves nothing). Mismatches
against expected values are returned as `differences`, so an old installation compared with a newer
source keeps both facts.

### Evidence levels

A manifest is a claim. `inspectRuntimeIdentity` therefore separates three levels: `self_declared`
(the manifest says so), `inventory_verified` (the manifest's own file list was checked against the
disk — size and, by default, sha256, with mismatches reported), and `running_confirmed` (a process
start record supplied by main/D names exactly this root). Paths in the inventory resolve relative to
the directory holding `install.json`. Capability signals are counted **outside comments** (a route
mentioned only in a comment is not a route) across the whole built dist closure, and the running claim
is only ever compared, never discovered.

`readSupportDocument` reports `verification` (`contract-digest`, `digest-only`, `shape-only`) so a
consumer can tell what was proven; documents with unknown fields are refused rather than silently
stripped; and `readSupportFile` degrades an older support file (`schema: 'legacy'` + `missingFields`)
instead of refusing it or trusting it.

## CLI

```sh
node tools/usage-insights/cli.mjs help
node tools/usage-insights/cli.mjs analyze --input /abs/bundle.json --format terminal
node tools/usage-insights/cli.mjs report  --input /abs/bundle.json --out /abs/report.md
node tools/usage-insights/cli.mjs verify  --input /abs/bundle.json
node tools/usage-insights/cli.mjs export  --input /abs/bundle.json --out /abs/export.json
node tools/usage-insights/cli.mjs export  --dto /abs/served-observation.json --out /abs/display.json
node tools/usage-insights/cli.mjs catalogue
node tools/usage-insights/cli.mjs collect --base-url http://127.0.0.1:5180 \
  --token-file /abs/private/token --from 2026-11-13T00:00:00Z --to 2026-11-14T00:00:00Z \
  --project project-atlas --include-attention --out /abs/bundle.json --report /abs/report.md
node tools/usage-insights/cli.mjs collect --base-url http://127.0.0.1:5180 \
  --token-file /abs/private/token --days 7 --project project-atlas \
  --out /abs/bundle.json --report /abs/report.md --export /abs/export.json
```

`collect --days 7|30` uses exactly the coordinator's rolling window ending at `--to` (default: now) and
defaults the capture time to that end, so the bundle reproduces the served window; `--days` and
`--from` are mutually exclusive. `--report`, `--export` and `--analyze` all derive from **one**
analysis of the written bundle, so the artifacts of a single run describe one snapshot. Passing
`--previous-export <file>` makes the new export state `same_snapshot` or `new_snapshot` explicitly.

Exit codes: `0` complete observation · `3` partial/bounded or quarantined · `4` insufficient data ·
`5` source unavailable or integrity refused · `2` invalid arguments · `1` internal.

Reports and bundles are created exclusively with mode `0600`; an existing file, a symbolic link or a
symlinked directory is refused. No report contains an absolute user path, a prompt, a payload or a
credential.

## Collection boundary

`collect` issues **GET only** against an explicit loopback origin with an operator-supplied
credential file. It refuses non-loopback hosts, embedded credentials, URL paths and every redirect.
Each request has a timeout inside one overall deadline, and pages, works and bytes are capped.
The token is used from memory and never reaches the bundle, a report or an error message.
It never reads `$HOME`, another instance's credential or a repository database, and it never starts a
task or a model.

## Tests

```sh
pnpm --dir packages/usage-insights typecheck
pnpm --dir packages/usage-insights build
pnpm --dir packages/usage-insights test
node --test tools/usage-insights/test/*.case.mjs
node tools/usage-insights/probe/observe-two-projects.mjs
```

Fixtures under `tools/usage-insights/fixtures/` are synthetic and say so; none of them is native
execution evidence.
