/**
 * CLI acceptance for the read-only tool: exit statuses, exclusive private output, digest integrity
 * and the absence of secrets or absolute user paths in generated reports.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
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
