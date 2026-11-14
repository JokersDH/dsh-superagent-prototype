#!/usr/bin/env node
/**
 * `usage-insights` operator CLI.
 *
 * Read-only by construction: it enumerates a declared input bundle, derives metrics and writes a
 * sanitized report. It never writes product state, never starts a task, never calls a model and never
 * reads a database or a credential on its own.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { chooseModuleEntry } from './lib/module-entry.mjs'
import { basename, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArguments, positiveInteger, requiredString, timestamp, UsageError } from './lib/args.mjs'
import { CollectorError, LoopbackClient, deadlineController, helpers, parseLoopbackBase, readTokenFile, worksFromSnapshot } from './lib/http.mjs'
import { OutputConflictError, writeExclusive } from './lib/output.mjs'

const EXIT = { ok: 0, internal: 1, usage: 2, partial: 3, insufficient: 4, unavailable: 5 }
const DEFAULT_MAX_INPUT_BYTES = 64 * 1024 * 1024

const PACKAGE_ROOT = new URL('../../packages/usage-insights/', import.meta.url)
/**
 * Load the package the CLI is *actually* part of: a stale build must never shadow newer sources, so
 * the choice is made by modification time and reported when the sources win.
 */
async function loadModule() {
  const choice = chooseModuleEntry({
    distEntry: fileURLToPath(new URL('dist/index.js', PACKAGE_ROOT)),
    sourceEntry: fileURLToPath(new URL('src/index.ts', PACKAGE_ROOT)),
    sourceDir: fileURLToPath(new URL('src', PACKAGE_ROOT)),
  })
  if (choice.entry === null) throw new Error('usage-insights package is not built and its source is missing')
  if (choice.stale)
    process.stderr.write('stale_dist: dist/ is older than src/; running the TypeScript sources\n')
  return import(new URL(`file://${choice.entry}`).href)
}

const HELP = `usage-insights — read-only efficiency observation

Commands
  collect    Read a bounded, authenticated snapshot of a loopback product instance into an input bundle.
  analyze    Derive a sanitized summary from an input bundle (pure, deterministic).
  report     Write a Markdown/JSON report to a new 0600 file.
  verify     Validate a bundle, report its digest and coverage, and refuse digest mismatches.
  catalogue  Print the metric catalogue: unit, aggregation and exact measurement definition.
  help       Print this text.

Common options
  --input <file>              Input bundle (JSON, protocol usage-insights-input/1)
  --out <absolute path>       New output file; exclusive create, never overwrites
  --format json|markdown|terminal
  --project <id>              Restrict to a project (repeatable)
  --from <UTC ISO> --to <UTC ISO>   Override the observation window
  --timezone <IANA>           Override the declared time zone
  --baseline <file>           Operator baseline JSON (operator-baseline/1)
  --max-input-bytes <n>       Refuse larger input files before reading (default ${DEFAULT_MAX_INPUT_BYTES})
  --max-records <n>           Analysis bound on presented records; applied before parsing
  --max-works <n>             Analysis bound on attributable works
  --max-pages <n>             Analysis bound on history/attention pages

verify only
  --expect-digest <sha256>    Refuse when the bundle bytes do not match the pinned digest

collect options
  --base-url <http://127.0.0.1:PORT>   Explicit loopback origin (required)
  --token-file <absolute path>         Operator-supplied credential file (required); memory only
  --work <id>                          Collect these works (repeatable); otherwise discover from the snapshot
  --snapshot-limit <n>                 Snapshot page size used for work discovery (default 100)
  --include-attention                  Also read the current attention inbox per project
  --attention-limit <n>                Attention page size 1..20 (default 20)
  --attention-pages <n>                Maximum attention pages per project (default 5)
  --history-pages <n>                  Maximum evidence-history pages per work (default 5)
  --history-limit <n>                   Evidence-history page size 1..100 (default 100)
  --max-works <n>                      Maximum works to read (default 50)
  --request-timeout-ms <n>             Per-request timeout (default 5000)
  --deadline-ms <n>                    Overall collection deadline (default 60000)
  --max-bytes <n>                      Total response byte budget (default 8000000)
  --captured-at <UTC ISO>              Capture timestamp recorded in the bundle (default now)
  --input-id <name>                    Bundle identifier (default collect-<timestamp>)
  --readiness                          Append the configuration-only readiness observation (never a metric)

Exit codes
  0 complete observation      3 partial/partial coverage or quarantined records
  4 insufficient data         5 source unavailable or integrity refused
  2 invalid arguments         1 internal failure

The tool never follows redirects, never reads a credential from the home directory or another
instance, never writes product state and never starts a model or a task.
`

const flag = (type = 'string') => ({ type })
const SPECS = {
  collect: {
    'base-url': flag(), 'token-file': flag(), work: flag('list'), project: flag('list'),
    'snapshot-limit': flag(), 'include-attention': flag('boolean'), 'attention-limit': flag(),
    'attention-pages': flag(), 'history-pages': flag(), 'history-limit': flag(), 'max-works': flag(),
    'request-timeout-ms': flag(), 'deadline-ms': flag(), 'max-bytes': flag(), 'captured-at': flag(),
    'input-id': flag(), 'from': flag(), 'to': flag(), 'timezone': flag(), 'out': flag(),
    'baseline': flag(), 'readiness': flag('boolean'), 'report': flag(), 'analyze': flag('boolean'),
  },
  analyze: {
    input: flag(), out: flag(), format: flag(), project: flag('list'), from: flag(), to: flag(),
    timezone: flag(), baseline: flag(), 'max-input-bytes': flag(),
    'max-records': flag(), 'max-works': flag(), 'max-pages': flag(),
  },
  report: {
    input: flag(), out: flag(), format: flag(), project: flag('list'), from: flag(), to: flag(),
    timezone: flag(), baseline: flag(), 'max-input-bytes': flag(),
    'max-records': flag(), 'max-works': flag(), 'max-pages': flag(),
  },
  verify: {
    input: flag(), 'max-input-bytes': flag(), 'max-records': flag(), 'max-works': flag(), 'max-pages': flag(),
    'expect-digest': flag(),
  },
  catalogue: {},
  help: {},
}

function parseUtc(raw, name) {
  return timestamp(raw, name)
}

function readBundle(path, maxBytes) {
  if (!isAbsolute(path)) throw new UsageError('--input must be an absolute path')
  // Validate type and size *before* reading: an oversized file is refused without being loaded.
  let stat
  try {
    stat = statSync(path)
  } catch {
    throw new UsageError('Input file does not exist or is not readable')
  }
  if (!stat.isFile()) throw new UsageError('Input must be a regular file')
  if (stat.size > maxBytes)
    throw new UsageError(`Input file is ${stat.size} bytes, above the ${maxBytes}-byte budget; refusing before reading`)
  const bytes = readFileSync(path)
  if (bytes.byteLength > maxBytes) throw new UsageError('Input file grew past the configured byte budget while reading')
  const digest = createHash('sha256').update(bytes).digest('hex')
  let value
  try {
    value = JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new UsageError('Input file is not valid JSON')
  }
  return { value, digest, bytes: bytes.byteLength }
}

function applyOverrides(bundle, options, digest) {
  const copy = structuredClone(bundle)
  if (copy?.source && typeof copy.source === 'object') {
    if (copy.source.digest && copy.source.digest !== digest)
      throw new UsageInsightsError('source_unavailable', 'The bundle digest does not match its own bytes; refusing to analyse a changed source')
    copy.source.digest = digest
  }
  if (options.from || options.to) {
    const from = options.from ? parseUtc(options.from, 'from') : copy?.window?.from
    const to = options.to ? parseUtc(options.to, 'to') : copy?.window?.to
    if (!from || !to) throw new UsageError('Overriding the window needs --from and --to')
    copy.window = { from, to }
  }
  if (options.timezone) copy.timezone = options.timezone
  if (options.project?.length) copy.projects = options.project.map(projectId => ({ projectId }))
  const limits = { ...(copy.limits ?? {}) }
  for (const [flagName, field] of [['max-records', 'maxRecords'], ['max-works', 'maxWorks'], ['max-pages', 'maxPages']]) {
    if (options[flagName] === undefined) continue
    limits[field] = positiveInteger(options[flagName], flagName, 1)
  }
  if (Object.keys(limits).length) copy.limits = limits
  return copy
}

class UsageInsightsError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'UsageInsightsError'
    this.code = code
  }
}

function statusOf(analysis) {
  const summary = analysis.summary
  const coverage = summary.coverage.overall
  // Exit status describes the observation, never a benefit claim: a missing or uncollected source is
  // insufficient data, a bounded or quarantined observation is partial, and a fully enumerated
  // window is complete even when individual metrics stay null with a reason.
  if (coverage === 'source_missing' || coverage === 'not_collected') return 'insufficient_data'
  if (coverage !== 'complete' || summary.quarantine.total > 0) return 'partial'
  return 'complete'
}

function unavailable(analysis) {
  return analysis.summary.metrics.filter(row => row.value === null).length
}

function exitFor(status) {
  return status === 'complete' ? EXIT.ok : status === 'partial' ? EXIT.partial : EXIT.insufficient
}

function render(analysis, format, insights) {
  if (format === 'json') return `${JSON.stringify(analysis, null, 2)}\n`
  if (format === 'markdown') return insights.renderMarkdown(analysis)
  return `${insights.renderTerminal(analysis)}\n`
}

function defaultFormat(options, stdoutIsTty) {
  if (options.format) {
    if (!['json', 'markdown', 'terminal'].includes(options.format)) throw new UsageError('--format must be json, markdown or terminal')
    return options.format
  }
  return stdoutIsTty ? 'terminal' : 'json'
}

async function commandAnalyze(options, io) {
  const insights = io.insights
  const maxBytes = positiveInteger(options['max-input-bytes'], 'max-input-bytes', DEFAULT_MAX_INPUT_BYTES)
  const bundle = readBundle(requiredString(options.input, 'input'), maxBytes)
  const formatted = applyOverrides(bundle.value, options, bundle.digest)
  if (options.baseline) formatted.baseline = readBundle(options.baseline, maxBytes).value
  const analysis = insights.analyzeUsageInsights(formatted)
  const format = defaultFormat(options, io.stdoutIsTty)
  const text = render(analysis, format, insights)
  if (options.out) {
    const written = writeExclusive(requiredString(options.out, 'out'), text)
    io.stdout(`wrote ${basename(written)} (${Buffer.byteLength(text)} bytes)\n`)
  } else io.stdout(text)
  const status = statusOf(analysis)
  io.stderr(`status=${status} coverage=${analysis.summary.coverage.overall} unavailableMetrics=${unavailable(analysis)} quarantine=${analysis.summary.quarantine.total}\n`)
  return exitFor(status)
}

async function commandReport(options, io) {
  const insights = io.insights
  if (!options.out) throw new UsageError('--out is required for report')
  const maxBytes = positiveInteger(options['max-input-bytes'], 'max-input-bytes', DEFAULT_MAX_INPUT_BYTES)
  const bundle = readBundle(requiredString(options.input, 'input'), maxBytes)
  const formatted = applyOverrides(bundle.value, options, bundle.digest)
  if (options.baseline) formatted.baseline = readBundle(options.baseline, maxBytes).value
  const analysis = insights.analyzeUsageInsights(formatted)
  const format = options.format ?? 'markdown'
  if (!['json', 'markdown'].includes(format)) throw new UsageError('--format must be json or markdown for report')
  const text = render(analysis, format, insights)
  const written = writeExclusive(requiredString(options.out, 'out'), text)
  const status = statusOf(analysis)
  io.stdout(`wrote ${basename(written)} (${Buffer.byteLength(text)} bytes) status=${status} coverage=${analysis.summary.coverage.overall} unavailableMetrics=${unavailable(analysis)}\n`)
  return exitFor(status)
}

async function commandVerify(options, io) {
  const insights = io.insights
  const maxBytes = positiveInteger(options['max-input-bytes'], 'max-input-bytes', DEFAULT_MAX_INPUT_BYTES)
  const bundle = readBundle(requiredString(options.input, 'input'), maxBytes)
  // A pinned digest turns "the file I analysed earlier" into a checkable identity.
  if (options['expect-digest'] !== undefined) {
    if (!/^[a-f0-9]{64}$/.test(options['expect-digest']))
      throw new UsageError('--expect-digest must be a lowercase sha256 hex digest')
    if (options['expect-digest'] !== bundle.digest)
      throw new UsageInsightsError('source_unavailable',
        `The bundle digest does not match the pinned digest (expected ${options['expect-digest'].slice(0, 12)}…, got ${bundle.digest.slice(0, 12)}…)`)
  }
  const analysis = insights.analyzeUsageInsights(applyOverrides(bundle.value, {}, bundle.digest))
  const status = statusOf(analysis)
  const report = {
    unavailableMetrics: analysis.summary.metrics.filter(row => row.value === null).length,
    protocol: bundle.value?.protocol,
    inputId: analysis.summary.inputId,
    digest: bundle.digest,
    bytes: bundle.bytes,
    records: analysis.summary.limits.recordsSeen,
    accepted: analysis.summary.limits.recordsAccepted,
    notParsed: analysis.summary.limits.recordsNotParsed,
    stoppedBy: analysis.summary.limits.stoppedBy,
    works: analysis.summary.limits.worksSeen,
    losses: analysis.summary.losses,
    quarantine: analysis.summary.quarantine.total,
    coverage: analysis.summary.coverage,
    status,
  }
  io.stdout(`${JSON.stringify(report, null, 2)}\n`)
  return exitFor(status)
}

async function commandCatalogue(_options, io) {
  const insights = io.insights
  io.stdout(`${JSON.stringify(insights.metricDefinitions, null, 2)}\n`)
  return EXIT.ok
}

function soaInput(path, maxBytes) {
  return readBundle(path, maxBytes)
}

async function commandCollect(options, io) {
  const insights = io.insights
  if (!options.out) throw new UsageError('--out is required for collect')
  const base = parseLoopbackBase(requiredString(options['base-url'], 'base-url'))
  const token = readTokenFile(requiredString(options['token-file'], 'token-file'))
  const window = { from: parseUtc(requiredString(options.from, 'from'), 'from'), to: parseUtc(requiredString(options.to, 'to'), 'to') }
  if (Date.parse(window.to) <= Date.parse(window.from)) throw new UsageError('--to must be after --from')
  const timezone = options.timezone ?? 'UTC'
  const requestTimeoutMs = positiveInteger(options['request-timeout-ms'], 'request-timeout-ms', 5000)
  const deadlineMs = positiveInteger(options['deadline-ms'], 'deadline-ms', 60_000)
  const maxBytes = positiveInteger(options['max-bytes'], 'max-bytes', 8_000_000)
  const maxWorks = positiveInteger(options['max-works'], 'max-works', 50)
  const historyPages = positiveInteger(options['history-pages'], 'history-pages', 5)
  const historyLimit = positiveInteger(options['history-limit'], 'history-limit', 100)
  const attentionPages = positiveInteger(options['attention-pages'], 'attention-pages', 5)
  const attentionLimit = positiveInteger(options['attention-limit'], 'attention-limit', 20)
  const snapshotLimit = positiveInteger(options['snapshot-limit'], 'snapshot-limit', 100)
  if (historyLimit > 100) throw new UsageError('--history-limit must be 1..100')
  if (attentionLimit > 20) throw new UsageError('--attention-limit must be 1..20')

  const deadline = deadlineController(deadlineMs)
  const client = new LoopbackClient({ base, token, requestTimeoutMs, deadlineSignal: deadline.signal, maxBytes })
  const issues = []
  const workEvidence = []
  const workHistories = []
  const attentionPagesSeen = []
  let workCoverage = 'complete'
  let attentionCoverage = options['include-attention'] ? 'complete' : 'not_collected'
  let pagesSeen = 0

  try {
    let workIds = options.work ?? []
    let projects = options.project ?? []
    // workId → projectId, taken only from the product's own records. This is the mapping the analysis
    // needs; it is never guessed from a work id or a title.
    const workIndex = new Map()
    if (workIds.length === 0) {
      const snapshot = await client.getJson(`/v1/snapshot?limit=${snapshotLimit}`)
      pagesSeen++
      const works = worksFromSnapshot(snapshot.value)
      for (const work of works) workIndex.set(work.id, work.projectId)
      if (projects.length === 0) projects = [...new Set(works.map(work => work.projectId))].sort()
      workIds = works.filter(work => projects.length === 0 || projects.includes(work.projectId)).map(work => work.id)
    } else {
      // An explicit work list still needs its project identity from the product, not from the caller.
      for (const workId of workIds) {
        if (workIndex.has(workId)) continue
        try {
          const view = await client.getJson(`/v1/works/${encodeURIComponent(workId)}`)
          pagesSeen++
          const projectId = helpers.asString(view.value?.work?.projectId)
          if (!projectId) throw new UsageInsightsError('bad_schema', 'Work view has no project identity')
          workIndex.set(workId, projectId)
          if (projects.length === 0) projects = [projectId]
        } catch (error) {
          issues.push({ ref: workId, code: error.code ?? 'error', message: bounded(error.message) })
          workCoverage = worstCoverage(workCoverage, 'source_missing')
        }
      }
    }
    if (projects.length === 0) throw new UsageInsightsError('source_unavailable', 'No project scope could be determined; pass --project or --work')
    if (workIds.length === 0) {
      workCoverage = 'source_missing'
      issues.push({ ref: 'works', code: 'not_found', message: 'No work was discoverable in the declared scope' })
    }
    const selected = workIds.slice(0, maxWorks)
    if (workIds.length > selected.length) {
      workCoverage = worstCoverage(workCoverage, 'caller_limit')
      issues.push({ ref: 'works', code: 'limits', message: `${workIds.length - selected.length} work(s) were not read because of --max-works` })
    }

    for (const workId of selected) {
      try {
        const evidence = await client.getJson(`/v1/works/${encodeURIComponent(workId)}/evidence`)
        pagesSeen++
        const body = evidence.value
        if (body?.protocol !== 'work-evidence/1' || body?.workId !== workId)
          throw new UsageInsightsError('bad_schema', 'Work evidence identity is not the requested work')
        workEvidence.push(body)
        if (body.truncated) workCoverage = worstCoverage(workCoverage, 'storage_cap')
        let page = 0
        let cursor
        while (page < historyPages) {
          if (deadline.expired()) throw new CollectorError('deadline', 'The collection deadline expired')
          const query = new URLSearchParams({ limit: String(historyLimit) })
          if (cursor) query.set('cursor', cursor)
          const history = await client.getJson(`/v1/works/${encodeURIComponent(workId)}/evidence/history?${query}`)
          pagesSeen++
          if (history.value?.protocol !== 'work-evidence-history/1' || history.value?.workId !== workId)
            throw new UsageInsightsError('bad_schema', 'Work history identity is not the requested work')
          workHistories.push(history.value)
          if (!history.value.hasMore || !history.value.nextCursor) break
          if (history.value.nextCursor === cursor) {
            issues.push({ ref: workId, code: 'unstable_cursor', message: 'The history cursor did not advance; pagination stopped' })
            workCoverage = worstCoverage(workCoverage, 'caller_limit')
            break
          }
          cursor = history.value.nextCursor
          page++
          if (page >= historyPages) {
            workCoverage = worstCoverage(workCoverage, 'caller_limit')
            issues.push({ ref: workId, code: 'limits', message: 'Evidence history was truncated by --history-pages' })
          }
        }
      } catch (error) {
        workCoverage = worstCoverage(workCoverage, 'source_missing')
        issues.push({ ref: workId, code: error.code ?? 'error', message: bounded(error.message) })
      }
    }

    if (options['include-attention']) {
      for (const projectId of [...new Set(projects)]) {
        let cursor
        let page = 0
        while (page < attentionPages) {
          const query = new URLSearchParams({ projectId, limit: String(attentionLimit) })
          if (cursor) query.set('cursor', cursor)
          try {
            const attention = await client.getJson(`/v1/attention?${query}`)
            pagesSeen++
            if (attention.value?.protocol !== 'attention-inbox/1')
              throw new UsageInsightsError('bad_schema', 'Attention identity is not the inbox protocol')
            attentionPagesSeen.push(attention.value)
            if (!attention.value.hasMore || !attention.value.nextCursor) break
            if (attention.value.nextCursor === cursor) {
              attentionCoverage = worstCoverage(attentionCoverage, 'caller_limit')
              issues.push({ ref: projectId, code: 'unstable_cursor', message: 'The attention cursor did not advance; pagination stopped' })
              break
            }
            cursor = attention.value.nextCursor
            page++
            if (page >= attentionPages) {
              attentionCoverage = worstCoverage(attentionCoverage, 'caller_limit')
              issues.push({ ref: projectId, code: 'limits', message: 'Attention was truncated by --attention-pages' })
            }
          } catch (error) {
            attentionCoverage = worstCoverage(attentionCoverage, 'source_missing')
            issues.push({ ref: projectId, code: error.code ?? 'error', message: bounded(error.message) })
            break
          }
        }
      }
    }

    let configSnapshot
    if (options.readiness) {
      try {
        const readiness = await client.getJson('/v1/readiness')
        configSnapshot = { kind: 'readiness', value: readiness.value }
      } catch (error) {
        issues.push({ ref: 'readiness', code: error.code ?? 'error', message: bounded(error.message) })
      }
    }

    // The capture time is stamped now, after every read: a snapshot can never be observed later than
    // the observation it belongs to.
    const capturedAt = options['captured-at'] ? parseUtc(options['captured-at'], 'captured-at') : new Date().toISOString()
    const inputId = options['input-id'] ?? `collect-${capturedAt.replace(/[-:]/g, '').replace(/\..*$/, '')}`
    const bundle = {
      protocol: 'usage-insights-input/1',
      inputId,
      capturedAt,
      timezone,
      window,
      projects: [...new Set(projects)].sort().map(projectId => ({ projectId })),
      source: { kind: 'http_read', descriptor: `loopback ${base.host} read-only`, digest: null, layerAssertion: 'recorded_by_producer', capturedAt },
      declaredCoverage: {
        outcomes: workCoverage === 'complete' ? 'complete' : workCoverage,
        workEvidence: workCoverage,
        attention: attentionCoverage,
      },
      limits: { maxRecords: 50_000, maxWorks, maxPages: Math.max(pagesSeen, 1), requestTimeoutMs, deadlineMs },
      outcomes: [],
      attentionPages: attentionPagesSeen,
      workEvidence,
      ...(workIndex.size ? { workIndex: [...workIndex.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([workId, projectId]) => ({ workId, projectId })) } : {}),
      ...(workHistories.length ? { workHistories } : {}),
      ...(configSnapshot ? { configSnapshot } : {}),
      ...(issues.length ? { collectionIssues: issues.slice(0, 512) } : {}),
    }
    if (options.baseline) bundle.baseline = soaInput(options.baseline, DEFAULT_MAX_INPUT_BYTES).value

    const text = `${JSON.stringify(bundle, null, 2)}\n`
    const written = writeExclusive(requiredString(options.out, 'out'), text)
    io.stdout(`wrote ${basename(written)} (${Buffer.byteLength(text)} bytes) works=${workEvidence.length} pages=${pagesSeen}\n`)
    if (issues.length) io.stderr(`collection issues: ${issues.length} (recorded in the bundle)\n`)

    if (options.analyze || options.report) {
      const analysis = insights.analyzeUsageInsights(bundle)
      const status = statusOf(analysis)
      if (options.report) {
        const reportText = insights.renderMarkdown(analysis)
        const reportPath = writeExclusive(requiredString(options.report, 'report'), reportText)
        io.stdout(`wrote ${basename(reportPath)} (${Buffer.byteLength(reportText)} bytes) status=${status} coverage=${analysis.summary.coverage.overall}\n`)
      } else {
        io.stdout(io.stdoutIsTty ? `${insights.renderTerminal(analysis)}\n` : `${JSON.stringify(analysis.summary, null, 2)}\n`)
      }
      return exitFor(status)
    }
    return workCoverage === 'complete' && attentionCoverage !== 'source_missing' && issues.every(issue => issue.code === 'limits' || issue.code === 'unstable_cursor')
      ? EXIT.ok
      : EXIT.partial
  } catch (error) {
    if (error instanceof CollectorError && error.code === 'deadline') return EXIT.partial
    throw error
  } finally {
    deadline.clear()
  }
}

const worstCoverage = (a, b) => {
  const order = { complete: 0, caller_limit: 1, storage_cap: 2, source_missing: 3, not_collected: 4, unsupported: 5 }
  return (order[b] ?? 0) > (order[a] ?? 0) ? b : a
}

const bounded = value => String(value ?? 'unknown').replace(/\s+/g, ' ').slice(0, 240)

async function main(argv, io) {
  const [command, ...rest] = argv
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    io.stdout(HELP)
    return EXIT.ok
  }
  const spec = SPECS[command]
  if (!spec) {
    io.stderr(`Unknown command: ${command}\n\n${HELP}`)
    return EXIT.usage
  }
  const options = parseArguments(rest, spec)
  switch (command) {
    case 'analyze': return commandAnalyze(options, io)
    case 'report': return commandReport(options, io)
    case 'verify': return commandVerify(options, io)
    case 'catalogue': return commandCatalogue(options, io)
    case 'collect': return commandCollect(options, io)
    default: return EXIT.usage
  }
}

const io = {
  stdout: text => process.stdout.write(text),
  stderr: text => process.stderr.write(text),
  get stdoutIsTty() { return Boolean(process.stdout.isTTY) },
  insights: undefined,
}

try {
  io.insights = await loadModule()
  process.exitCode = await main(process.argv.slice(2), io)
} catch (error) {
  if (error instanceof OutputConflictError) {
    process.stderr.write(`output_conflict: ${error.message}\n`)
    process.exitCode = EXIT.unavailable
  } else if (error instanceof UsageError) {
    process.stderr.write(`invalid_argument: ${error.message}\n`)
    process.exitCode = EXIT.usage
  } else if (error instanceof CollectorError) {
    const detail = error.detail && typeof error.detail === 'object'
      ? Object.entries(error.detail)
        .filter(([, value]) => typeof value === 'number' && Number.isFinite(value))
        .map(([key, value]) => `${key}=${value}`).join(' ')
      : ''
    process.stderr.write(`${error.code}: ${error.message}${detail ? ` (${detail})` : ''}\n`)
    process.exitCode = error.code === 'invalid_argument' ? EXIT.usage : EXIT.unavailable
  } else if (error?.code === 'source_unavailable') {
    process.stderr.write(`source_unavailable: ${error.message}\n`)
    process.exitCode = EXIT.unavailable
  } else if (['EACCES', 'EPERM', 'ENOSPC', 'EROFS', 'EDQUOT'].includes(error?.code)) {
    const label = error.code === 'ENOSPC' ? 'no space left for the output' : 'the output path is not writable'
    process.stderr.write(`output_unavailable: ${label}\n`)
    process.exitCode = EXIT.unavailable
  } else if (error?.name === 'UsageInsightsFault') {
    process.stderr.write(`${error.code}: ${error.message}\n`)
    process.exitCode = error.code === 'invalid_input' || error.code === 'invalid_argument' ? EXIT.usage : EXIT.unavailable
  } else {
    process.stderr.write(`internal_error: ${bounded(error?.message)}\n`)
    process.exitCode = EXIT.internal
  }
}
