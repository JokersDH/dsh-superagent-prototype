#!/usr/bin/env node
/**
 * Parameterized personal-read review driver. It prepares a fresh explicit consent with the
 * package's own review entry, starts the package's own personal entry, and records the actual
 * health identity plus the ordinary and opt-in frozen-source responses.
 *
 * It reports what the installed files are; it does not certify a package release. A different
 * install root must be supplied by D, and E must bind the reported entry hashes to that package's
 * own artifact before treating the output as installed evidence.
 */
import { createHash } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, statSync, closeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const args = process.argv.slice(2)
const { values } = parseArgs({ args, options: {
  install: { type: 'string' }, state: { type: 'string' }, project: { type: 'string' },
  'allow-path': { type: 'string', multiple: true }, 'exclude-path': { type: 'string', multiple: true },
  'console-port': { type: 'string' }, 'api-port': { type: 'string' }, 'model-config': { type: 'string' },
  format: { type: 'string' }, work: { type: 'string' }, question: { type: 'string' },
  message: { type: 'string' }, 'candidate-message': { type: 'string' }, 'package-subject': { type: 'string' },
  'start-entry': { type: 'string' }, 'review-entry': { type: 'string' }, 'work-dir': { type: 'string' },
} })
const fail = (message) => { console.error(JSON.stringify({ protocol: 'personal-review-driver/1', status: 'failed', error: message })); process.exitCode = 1 }
const required = (name) => {
  const value = values[name]
  if (typeof value !== 'string' || !value.length) throw new Error(`Missing --${name}`)
  return value
}
const absolute = (name, value) => {
  if (!isAbsolute(value)) throw new Error(`--${name} must be absolute`)
  return resolve(value)
}
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
const hashEntry = (path) => existsSync(path) && statSync(path).isFile() ? sha256(path) : null

async function waitFor(read, deadlineMs) {
  const deadline = Date.now() + deadlineMs
  for (;;) {
    if (Date.now() > deadline) throw new Error('Personal entry did not become healthy in time')
    try { if (await read()) return } catch { /* retry until deadline */ }
    await new Promise((done) => setTimeout(done, 100))
  }
}

async function main() {
  const install = absolute('install', required('install'))
  const state = absolute('state', required('state'))
  const project = required('project')
  const consolePort = Number(required('console-port')), apiPort = Number(required('api-port'))
  const modelConfig = absolute('model-config', required('model-config'))
  const format = values.format ?? 'v1'
  if (!['v1', 'v2'].includes(format)) throw new Error('--format must be v1 or v2')
  if (!Number.isSafeInteger(consolePort) || !Number.isSafeInteger(apiPort) || consolePort < 1 || apiPort < 1) throw new Error('Ports must be positive integers')
  const workDir = mkdtempSync(join(values['work-dir'] ? absolute('work-dir', values['work-dir']) : tmpdir(), 'pa-personal-driver-'))
  mkdirSync(workDir, { recursive: true, mode: 0o700 })
  const reviewEntry = values['review-entry'] ? absolute('review-entry', values['review-entry']) : join(install, 'tools/dev/review-restored.mjs')
  const startEntry = values['start-entry'] ? absolute('start-entry', values['start-entry']) : join(install, 'tools/dev/start.mjs')
  for (const [name, path] of [['review-entry', reviewEntry], ['start-entry', startEntry]]) {
    if (!existsSync(path)) throw new Error(`The package does not contain a ${name}: ${path}`)
  }
  const entries = {
    review: { path: reviewEntry, sha256: hashEntry(reviewEntry) },
    start: { path: startEntry, sha256: hashEntry(startEntry) },
    demo: { path: join(install, 'apps/coordinator/product/demo.ts'), sha256: hashEntry(join(install, 'apps/coordinator/product/demo.ts')) },
    restoredReview: { path: join(install, 'apps/coordinator/product/restored-review.ts'), sha256: hashEntry(join(install, 'apps/coordinator/product/restored-review.ts')) },
  }
  if (!entries.start.sha256 || !entries.review.sha256) throw new Error('The package entries are not readable regular files')

  const consoleURL = `http://127.0.0.1:${consolePort}`, api = `http://127.0.0.1:${apiPort}`
  const reviewFile = join(workDir, `review-${process.pid}.json`)
  const prepared = JSON.parse(execFileSync(process.execPath, [reviewEntry,
    '--state', state, '--project', project,
    ...(values['allow-path'] ?? []).flatMap((path) => ['--allow-path', path]),
    ...(values['exclude-path'] ?? []).flatMap((path) => ['--exclude-path', path]),
    '--output', reviewFile,
  ], { cwd: install, encoding: 'utf8', timeout: 30000 }))
  if (prepared.startupAvailable !== false) throw new Error('The review entry did not return a non-executable selection')
  if ((statSync(reviewFile).mode & 0o077) !== 0) throw new Error('The review entry did not create a private 0600 file')

  const child = spawn(process.execPath, [startEntry, '--state', state, '--port', String(consolePort), '--api-port', String(apiPort),
    '--discussion-only', '--review-restored-scope', reviewFile], {
    cwd: install, env: { ...process.env, PA_MODEL_CONFIG: modelConfig }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (bytes) => { output += bytes })
  child.stderr.on('data', (bytes) => { output += bytes })
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return
    const exited = new Promise((done) => child.once('exit', done))
    const timer = setTimeout(() => child.kill('SIGKILL'), 10000)
    child.kill('SIGTERM')
    try { await exited } finally { clearTimeout(timer) }
  }
  try {
    await waitFor(async () => (await fetch(`${api}/v1/health`)).ok, 180000)
    const health = await (await fetch(`${api}/v1/health`)).json()
    if (health.mode !== 'personal' || health.startupMode !== 'recovery_readonly') throw new Error(`Unexpected health: ${JSON.stringify(health)}`)
    const apiKeyPath = join(state, 'api.key')
    const fd = openSync(apiKeyPath, 'r')
    let apiKey
    try { apiKey = readFileSync(fd, 'utf8').trim() } finally { closeSync(fd) }
    const headers = { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }
    const history = await (await fetch(`${api}/v1/context/history?projectId=${encodeURIComponent(project)}`, { headers })).json()
    const historyEntry = values.message ?? history.entries?.[0]?.messageId
    const ordinary = historyEntry ? await (await fetch(`${api}/v1/messages/${encodeURIComponent(historyEntry)}/context/sources`, { headers })).json() : null
    const reviewed = historyEntry ? await (await fetch(`${api}/v1/messages/${encodeURIComponent(historyEntry)}/context/sources?scopeReview=1`, { headers })).json() : null
    if (ordinary && 'scopeReview' in ordinary) throw new Error('The default sources response unexpectedly contains scopeReview')
    if (reviewed) {
      const { scopeReview, ...withoutReview } = reviewed
      const stable = (value) => { const { observedAt, ...rest } = value; void observedAt; return JSON.stringify(rest) }
      if (stable(withoutReview) !== stable(ordinary)) throw new Error('The opt-in response changed authoritative source data')
      if (scopeReview?.authorization !== 'none') throw new Error('Scope diagnostics must not authorize')
      if (scopeReview.partial !== (reviewed.state !== 'verified')) throw new Error('Scope diagnostics disagree with the authoritative state')
      if (scopeReview.withheldSourceCount !== (reviewed.state === 'scope_changed' ? reviewed.binding.sources.length : 0))
        throw new Error('Withheld count disagrees with the original binding')
      if (scopeReview.reasons.length > 7 || scopeReview.withheldSourceCount > 64) throw new Error('Scope diagnostics exceed their bound')
    }
    const refused = []
    const post = async (path, body) => (await fetch(`${api}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })).status
    refused.push(['chat', await post('/v1/commands', { kind: 'chat', commandId: 'driver-chat', projectId: project, conversationId: history.conversationId ?? 'driver', text: 'x' })])
    if (values['candidate-message']) {
      const id = required('candidate-message')
      const candidates = await (await fetch(`${api}/v1/messages/${encodeURIComponent(id)}/candidates`, { headers })).json()
      refused.push(['candidates', candidates.executable === false && candidates.authorization === 'none' ? 200 : 500])
      const index = candidates.candidates?.[0]?.index, digest = candidates.candidates?.[0]?.payloadDigest
      refused.push(['candidatePrepare', await post('/v1/assistant/candidates/prepare', index === undefined ? { messageId: id } : { messageId: id, index, payloadDigest: digest })])
    }
    let work = null, delivery = null
    if (values.work) work = await (await fetch(`${api}/v1/works/${encodeURIComponent(required('work'))}`, { headers })).json()
    if (values.question) delivery = await (await fetch(`${api}/v1/questions/${encodeURIComponent(required('question'))}/deliveries`, { headers })).json()
    const result = {
      protocol: 'personal-review-driver/1', status: 'ok', format, sourceOnly: true,
      packageSubject: values['package-subject'] ?? null,
      install,
      entries,
      review: { file: reviewFile, sha256: sha256(reviewFile), mode: statSync(reviewFile).mode & 0o777, startupAvailable: prepared.startupAvailable },
      health: { mode: health.mode, startupMode: health.startupMode, restoredReviewDigest: health.restoredReviewDigest ?? null },
      sources: ordinary === null ? null : {
        messageId: historyEntry, state: ordinary.state,
        defaultHasScopeReview: 'scopeReview' in ordinary,
        diagnostic: reviewed?.scopeReview ?? null,
      },
      history: { conversationId: history.conversationId ?? null, entries: history.entries?.length ?? 0 },
      work: work ? { phase: work.phase ?? null } : null,
      delivery: delivery ? delivery.map((entry) => entry.status) : null,
      refused: Object.fromEntries(refused),
    }
    process.stdout.write(JSON.stringify(result) + '\n')
  } finally {
    await stop()
  }
}
try { await main() } catch (error) { fail(error instanceof Error ? error.message : String(error)) }
