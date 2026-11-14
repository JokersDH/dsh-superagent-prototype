/**
 * CLI acceptance for the read-only tool: exit statuses, exclusive private output, digest integrity
 * and the absence of secrets or absolute user paths in generated reports.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const CLI = fileURLToPath(new URL('../cli.mjs', import.meta.url))
const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url))
const complete = join(FIXTURES, 'example-controlled.json')
const unknown = join(FIXTURES, 'example-unknown.json')
const partial = join(FIXTURES, 'example-partial.json')
const baseline = join(FIXTURES, 'operator-baseline.example.json')

const run = (args) => {
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

const workspace = () => mkdtempSync(join(tmpdir(), 'usage-insights-cli-'))

test('help lists the read-only commands and exits zero', () => {
  const result = run(['help'])
  assert.equal(result.status, 0)
  for (const command of ['collect', 'analyze', 'report', 'verify', 'catalogue']) assert.ok(result.stdout.includes(command))
  assert.ok(result.stdout.includes('never follows redirects'))
})

test('analyze emits a deterministic summary and refuses a missing argument', () => {
  const first = run(['analyze', '--input', complete])
  assert.equal(first.status, 0)
  const body = JSON.parse(first.stdout)
  assert.equal(body.protocol, 'usage-insights-analysis/1')
  assert.equal(body.summary.coverage.overall, 'complete')
  assert.match(body.summary.summaryId, /^[a-f0-9]{64}$/)
  const second = run(['analyze', '--input', complete])
  assert.equal(JSON.parse(second.stdout).summary.summaryId, body.summary.summaryId)
  assert.equal(run(['analyze']).status, 2)
  assert.equal(run(['analyze', '--input', 'relative.json']).status, 2)
  assert.equal(run(['analyze', '--input', complete, '--nope', 'x']).status, 2)
})

test('a bounded observation exits 3 while an unknown-only observation keeps explicit nulls', () => {
  const bounded = run(['analyze', '--input', partial])
  assert.equal(bounded.status, 3)
  assert.ok(bounded.stderr.includes('status=partial'))
  const sparse = run(['analyze', '--input', unknown])
  assert.equal(sparse.status, 0, 'a complete window with unknown metrics is still a complete observation')
  const body = JSON.parse(sparse.stdout)
  const duration = body.summary.metrics.find(row => row.metricId === 'execution.durationMs')
  assert.equal(duration.value, null)
  assert.equal(duration.nullReason, 'timing_missing')
})

test('report writes a new 0600 file and never overwrites or follows a link', () => {
  const directory = workspace()
  const target = join(directory, 'report.md')
  const written = run(['report', '--input', complete, '--out', target])
  assert.equal(written.status, 0)
  assert.equal(statSync(target).mode & 0o777, 0o600)
  const content = readFileSync(target, 'utf8')
  assert.ok(content.includes('Read-only observation'))
  assert.equal(content.includes(complete), false, 'the report must not embed the input path')
  assert.equal(content.includes(directory), false, 'the report must not embed the output path')
  const again = run(['report', '--input', complete, '--out', target])
  assert.equal(again.status, 5)
  assert.ok(again.stderr.includes('output_conflict'))
  assert.equal(readFileSync(target, 'utf8'), content, 'the previous report is untouched')

  const link = join(directory, 'link.md')
  symlinkSync(target, link)
  assert.equal(run(['report', '--input', complete, '--out', link]).status, 5)
  const nested = join(directory, 'missing', 'report.md')
  assert.equal(run(['report', '--input', complete, '--out', nested]).status, 5)
})

test('a bundle whose recorded digest no longer matches its bytes is refused', () => {
  const directory = workspace()
  const tampered = join(directory, 'tampered.json')
  const body = JSON.parse(readFileSync(complete, 'utf8'))
  body.source.digest = 'a'.repeat(64)
  writeFileSync(tampered, JSON.stringify(body))
  const result = run(['analyze', '--input', tampered])
  assert.equal(result.status, 5)
  assert.ok(result.stderr.includes('source_unavailable'))
})

test('malformed JSON, oversized input and unknown formats are rejected', () => {
  const directory = workspace()
  const broken = join(directory, 'broken.json')
  writeFileSync(broken, '{not json')
  assert.equal(run(['analyze', '--input', broken]).status, 2)
  assert.equal(run(['analyze', '--input', complete, '--max-input-bytes', '10']).status, 2)
  assert.equal(run(['analyze', '--input', complete, '--format', 'yaml']).status, 2)
})

test('verify reports the digest, the counts and the coverage', () => {
  const result = run(['verify', '--input', complete])
  assert.equal(result.status, 0)
  const report = JSON.parse(result.stdout)
  assert.match(report.digest, /^[a-f0-9]{64}$/)
  assert.equal(report.works, 1)
  assert.equal(report.coverage.overall, 'complete')
})

test('a project filter refuses records outside the selected scope', () => {
  const directory = workspace()
  const multi = join(directory, 'multi.json')
  const body = JSON.parse(readFileSync(complete, 'utf8'))
  body.projects = [{ projectId: 'project-atlas' }]
  writeFileSync(multi, JSON.stringify(body))
  const filtered = run(['analyze', '--input', multi, '--project', 'project-atlas'])
  assert.equal(filtered.status, 0)
  const other = run(['analyze', '--input', multi, '--project', 'project-orbit'])
  const analysis = JSON.parse(other.stdout)
  assert.equal(analysis.summary.projects.length, 1)
  assert.ok(analysis.summary.quarantine.byCode.some(entry => entry.code === 'out_of_scope_project'))
})

test('a baseline file is compared observationally and never becomes a measured metric', () => {
  const result = run(['analyze', '--input', complete, '--baseline', baseline])
  assert.equal(result.status, 0)
  const summary = JSON.parse(result.stdout).summary
  assert.equal(summary.baseline.status, 'comparable')
  assert.equal(summary.baseline.observation, 'observational_only')
  assert.equal(summary.metrics.find(row => row.metricId === 'execution.durationMs').value, 90_000)
})

test('catalogue documents every metric unit, aggregation and definition', () => {
  const result = run(['catalogue'])
  assert.equal(result.status, 0)
  const catalogue = JSON.parse(result.stdout)
  assert.equal(catalogue['review.activeMs'].unit, 'ms')
  assert.ok(catalogue['review.activeMs'].definition.includes('visibility proxy'))
  assert.equal(catalogue['interventions.total'].scope, 'work')
})

test('a copied fixture stays byte-identical after a read-only analysis', () => {
  const directory = workspace()
  const copy = join(directory, 'copy.json')
  copyFileSync(complete, copy)
  const before = readFileSync(copy)
  const result = run(['analyze', '--input', copy])
  assert.equal(result.status, 0)
  assert.deepEqual(readFileSync(copy), before)
  mkdirSync(join(directory, 'unused'))
})

test('an unwritable destination fails explicitly and leaves no temporary file', () => {
  const directory = workspace()
  const locked = join(directory, 'locked')
  mkdirSync(locked, { mode: 0o500 })
  const result = run(['report', '--input', complete, '--out', join(locked, 'report.md')])
  assert.equal(result.status, 5)
  assert.ok(result.stderr.includes('output_unavailable'))
  assert.deepEqual(readdirSync(locked), [])
  chmodSync(locked, 0o700)

  const target = join(directory, 'taken.md')
  writeFileSync(target, 'existing')
  const conflict = run(['report', '--input', complete, '--out', target])
  assert.equal(conflict.status, 5)
  const leftovers = readdirSync(directory).filter(name => name.startsWith('.usage-insights-'))
  assert.deepEqual(leftovers, [], 'a refused write must not leave a temporary file behind')
  assert.equal(readFileSync(target, 'utf8'), 'existing')
})

test('hostile operator notes are escaped in the report', () => {
  const directory = workspace()
  const baselineBody = JSON.parse(readFileSync(baseline, 'utf8'))
  baselineBody.operatorNote = '<img src=x onerror=alert(1)> | `curl evil` ## heading'
  const hostile = join(directory, 'baseline.json')
  writeFileSync(hostile, JSON.stringify(baselineBody))
  const target = join(directory, 'report.md')
  const result = run(['report', '--input', complete, '--baseline', hostile, '--out', target])
  assert.equal(result.status, 0)
  const content = readFileSync(target, 'utf8')
  // Escaping keeps the characters but neutralizes them: inside the operator line every `<` and
  // backtick must be preceded by a backslash, so no tag or code span can be produced.
  const noteLine = content.split('\n').find(line => line.startsWith('Operator note'))
  assert.ok(noteLine, 'the operator note is rendered as its own line')
  assert.equal(/(?<!\\)</.test(noteLine), false, 'no unescaped angle bracket in operator text')
  assert.equal(/(?<!\\)`/.test(noteLine), false, 'no unescaped backtick in operator text')
  assert.equal(content.split('\n').some(line => line.trimStart().startsWith('## heading')), false,
    'operator text can never become a heading')
  assert.ok(noteLine.includes('\\<img'), 'the hostile tag is present but escaped')
  assert.ok(content.includes('observational only') || content.includes('observational'))
})

// ---- declared bounds and pre-read sizing (G3) ------------------------------------------------

test('an oversized input file is refused before it is parsed', () => {
  const directory = workspace()
  // Invalid JSON on purpose: if the file were read and parsed first, the error would be about JSON.
  const oversized = join(directory, 'oversized.json')
  writeFileSync(oversized, `{"protocol": "${'x'.repeat(4096)}"}`)
  const result = run(['analyze', '--input', oversized, '--max-input-bytes', '1024'])
  assert.equal(result.status, 2)
  assert.ok(/refusing before reading|above the 1024-byte budget/.test(result.stderr), result.stderr)
  assert.equal(result.stderr.includes('not valid JSON'), false)
})

test('the CLI applies an explicit record bound and reports partial status', () => {
  // The shipped example costs nine units: two outcomes, one work container, four entries and two
  // embedded outcomes.
  const exact = run(['analyze', '--input', complete, '--max-records', '9', '--format', 'json'])
  assert.equal(exact.status, 0, 'an exact bound enumerates everything')
  assert.equal(JSON.parse(exact.stdout).summary.limits.stoppedBy, 'none')

  const bounded = run(['analyze', '--input', complete, '--max-records', '1', '--format', 'json'])
  assert.equal(bounded.status, 3, 'a truncated observation is partial')
  const summary = JSON.parse(bounded.stdout).summary
  assert.equal(summary.limits.maxRecords, 1)
  assert.equal(summary.limits.limitsAppliedBeforeParsing, true)
  assert.equal(summary.limits.recordsNotParsed, 8)
  assert.equal(summary.limits.stoppedBy, 'records')
  for (const flag of ['--max-records', '--max-works', '--max-pages']) {
    assert.equal(run(['analyze', '--input', complete, flag, '0']).status, 2, `${flag} 0 must be refused`)
    assert.equal(run(['analyze', '--input', complete, flag, 'abc']).status, 2)
  }
})

test('verify reports losses, the stop reason and the applied bounds', () => {
  const result = run(['verify', '--input', partial])
  assert.equal(result.status, 3)
  const report = JSON.parse(result.stdout)
  assert.equal(report.stoppedBy, 'source')
  assert.equal(typeof report.losses, 'object')
  assert.equal(report.losses.workEvidence.outOfScope !== undefined, true)
})

test('an uncollected source is insufficient data rather than a partial success', () => {
  const directory = workspace()
  const body = JSON.parse(readFileSync(complete, 'utf8'))
  body.declaredCoverage = { outcomes: 'not_collected', workEvidence: 'not_collected', attention: 'not_collected' }
  body.outcomes = []
  body.workEvidence = []
  const target = join(directory, 'uncollected.json')
  writeFileSync(target, JSON.stringify(body))
  const result = run(['analyze', '--input', target])
  assert.equal(result.status, 4)
  assert.ok(result.stderr.includes('status=insufficient_data'))
})

test('a pinned digest refuses a changed bundle and accepts the original', () => {
  const directory = workspace()
  const copy = join(directory, 'copy.json')
  copyFileSync(complete, copy)
  const first = run(['verify', '--input', copy])
  const digest = JSON.parse(first.stdout).digest
  assert.equal(run(['verify', '--input', copy, '--expect-digest', digest]).status, 0)
  const body = JSON.parse(readFileSync(copy, 'utf8'))
  body.inputId = 'changed-bundle'
  writeFileSync(copy, JSON.stringify(body))
  const refused = run(['verify', '--input', copy, '--expect-digest', digest])
  assert.equal(refused.status, 5)
  assert.ok(refused.stderr.includes('pinned digest'))
  assert.equal(run(['verify', '--input', copy, '--expect-digest', 'not-a-digest']).status, 2)
})

test('a report never republishes collection diagnostics or a secret from a bundle', () => {
  const directory = workspace()
  const body = JSON.parse(readFileSync(complete, 'utf8'))
  body.collectionIssues = [{ ref: 'work-1', code: 'port_error', message: 'reader failed with token=SUPER-SECRET-TOKEN-VALUE', stage: 'evidence' }]
  const input = join(directory, 'with-issues.json')
  writeFileSync(input, JSON.stringify(body))
  const target = join(directory, 'report.md')
  const result = run(['report', '--input', input, '--out', target])
  assert.equal(result.status, 0, result.stderr)
  const content = readFileSync(target, 'utf8')
  assert.equal(content.includes('SUPER-SECRET-TOKEN-VALUE'), false, 'diagnostic text stays out of the shared report')
  assert.equal(content.includes('collectionIssues'), false)
})
