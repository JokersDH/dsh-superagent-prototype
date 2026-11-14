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
7b. Declared `maxRecords`/`maxWorks`/`maxPages` are applied *before* parsing, so a truncated
   observation reports `recordsNotParsed`/`worksNotProcessed`/`pagesNotParsed`, partial coverage and
   `stoppedBy`; an exact fit is not truncation.
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
import { analyzeUsageInsights, renderMarkdown } from '@personal-agent/usage-insights'
import type { UsageInsightsInput, UsageInsightsSummary } from '@personal-agent/usage-insights'

const analysis = analyzeUsageInsights(bundle)      // pure: same input ⇒ same summaryId
const summary: UsageInsightsSummary = analysis.summary
const markdown = renderMarkdown(analysis)
```

`analyzeUsageInsights` reads no clock, no filesystem and no network. `capturedAt` comes from the
bundle, so a stored bundle always reproduces its summary.

## CLI

```sh
node tools/usage-insights/cli.mjs help
node tools/usage-insights/cli.mjs analyze --input /abs/bundle.json --format terminal
node tools/usage-insights/cli.mjs report  --input /abs/bundle.json --out /abs/report.md
node tools/usage-insights/cli.mjs verify  --input /abs/bundle.json
node tools/usage-insights/cli.mjs catalogue
node tools/usage-insights/cli.mjs collect --base-url http://127.0.0.1:5180 \
  --token-file /abs/private/token --from 2026-11-13T00:00:00Z --to 2026-11-14T00:00:00Z \
  --project project-atlas --include-attention --out /abs/bundle.json --report /abs/report.md
```

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
