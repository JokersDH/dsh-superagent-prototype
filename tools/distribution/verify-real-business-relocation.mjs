#!/usr/bin/env node
/**
 * D3/D5: actual workflow-evidence v1/v2 + personal-evidence bundle APIs on real B/A normal business
 * data, then relocate that same data to a second private root and read it through restored HTTP.
 *
 * The business state is produced by B's submitted normal producer (Work/Broker/answer/native_applied,
 * zero real vendor/native turns) and retained by a D-owned copy for this read-only evidence. No SQL is
 * written by D, no old queue is replayed and only the independently owned restored daemon is stopped.
 */
import { createServer } from 'node:net'
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { cleanupBornResources, waitBornRecord } from './lib/live-cleanup.mjs'

const { values } = parseArgs({ options: { install: { type: 'string' }, business: { type: 'string' }, fault: { type: 'string' }, json: { type: 'boolean', default: false } } })
const root = mkdtempSync(join(tmpdir(), 'pa-real-business-'))
chmodSync(root, 0o700)
const evidence = { protocol: 'wave19-real-business-relocation/1', status: 'FAIL', steps: [], nativeTurns: 0, vendorSends: 0,
  limitations: ['Business data is the retained B submitted normal-producer state (zero real vendor/native turns); D only reads it.',
    'Restored nonempty candidates/historical source reads still require main restored-personal project rebinding; they are not claimed here.'] }
const step = (id, status, detail = {}) => { evidence.steps.push({ id, status, detail }); if (status !== 'PASS') process.stderr.write(`${status} ${id} ${JSON.stringify(detail).slice(0, 400)}\n`) }
const run = (cli, args, allow = [0]) => { const r = spawnSync(cli, args, { encoding: 'utf8', timeout: 240_000 }); let json = null; try { json = JSON.parse(r.stdout) } catch {} if (!allow.includes(r.status)) throw new Error(`command failed ${r.status} [${args.join(' ')}]: ${r.stdout.slice(0, 350)} ${r.stderr.slice(0, 150)}`); return { status: r.status, json } }
const freePort = () => new Promise((r) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)) }) })
const waitHealth = async (port, ms = 60_000) => { const end = Date.now() + ms; while (Date.now() < end) { try { const res = await fetch(`http://127.0.0.1:${port}/v1/health`, { signal: AbortSignal.timeout(700) }); if (res.ok) return await res.json() } catch {} await new Promise((r) => setTimeout(r, 200)) } return null }

let born = null
try {
  if (values.install === undefined || values.business === undefined) throw new Error('--install and --business are required')
  const install = resolve(values.install), businessState = resolve(values.business)
  const db = join(businessState, 'state.sqlite')
  if (!existsSync(db)) throw new Error(`business state has no state.sqlite: ${businessState}`)
  const storage = await import(pathToFileURL(join(install, 'app/packages/storage/dist/index.js')).href)
  const portability = await import(pathToFileURL(join(install, 'app/packages/portability/dist/index.js')).href)
  const verify = storage.verifyDatabase(db)
  if (verify.integrity !== 'ok' || verify.productSchema !== 18) throw new Error(`business db is not a verified schema18 state: ${JSON.stringify(verify)}`)
  const v1 = storage.readWorkflowEvidence(db, 1)
  const v1default = storage.readWorkflowEvidence(db)
  const v2 = storage.readWorkflowEvidence(db, 2)
  if (v1.protocol !== 'workflow-evidence/1' || v1default.digest !== v1.digest) throw new Error('default workflow evidence is not the exact v1 recipe')
  if (v2.protocol !== 'workflow-evidence/2' || v2.familySetVersion !== 2) throw new Error('explicit v2 workflow evidence is not version 2')
  if (v1.families.length !== 13 || v2.families.length !== 21) throw new Error(`unexpected family counts v1=${v1.families.length} v2=${v2.families.length}`)
  const counts = Object.fromEntries(v2.families.map((f) => [f.name, f.count]))
  for (const [name, minimum] of [['user_questions', 1], ['answers', 1], ['answer_deliveries', 1], ['runtime_bindings', 1], ['dispatch_receipts', 1]]) {
    if (!(counts[name] >= minimum)) throw new Error(`real business family ${name} is empty`)
  }
  const missingPath = join(root, 'missing-version3.sqlite')
  let rejected = null
  try { storage.readWorkflowEvidence(missingPath, 3) } catch (error) { rejected = error }
  if (!(rejected instanceof TypeError)) throw new Error('unsupported workflow evidence version did not reject with TypeError')
  if (existsSync(missingPath)) throw new Error('unsupported version created a database file')
  step('workflow-evidence-v1-v2-real-data', 'PASS', { databaseSchema: verify.productSchema, v1Protocol: v1.protocol, v1Families: v1.families.length, v1Digest: v1.digest,
    v2Protocol: v2.protocol, v2FamilySetVersion: v2.familySetVersion, v2Families: v2.families.length, v2Digest: v2.digest,
    questions: counts.user_questions, answers: counts.answers, deliveries: counts.answer_deliveries, runtimeBindings: counts.runtime_bindings, dispatchReceipts: counts.dispatch_receipts, unsupportedVersionRejected: true })

  const staging = join(root, 'staging'); mkdirSync(staging, { mode: 0o700 })
  const bundlePath = join(root, 'real-business.pab')
  const created = await portability.createBundle({ stateDir: businessState, outputPath: bundlePath, stagingRoot: staging, productVersion: '0.1.0', toolVersion: 'wave19-d/1', instance: { running: false, access: null } })
  const verified = await portability.verifyBundle(bundlePath)
  const manifest = verified.manifest
  if (manifest.evidence.protocol !== 'personal-evidence' || ![1, 2].includes(manifest.evidence.formatVersion)) throw new Error('bundle evidence is not a supported personal-evidence protocol')
  if (verified.database.productSchema !== 18 || verified.database.integrity !== 'ok') throw new Error('bundle database did not verify')
  if (manifest.database.eventSeq === undefined) throw new Error('bundle manifest has no event cursor')
  step('personal-evidence-bundle-real-data', 'PASS', { bundle: created.bundlePath, archiveSha256: verified.archiveSha256, entries: verified.entries.length,
    evidenceProtocol: manifest.evidence.protocol, evidenceFormatVersion: manifest.evidence.formatVersion, bundleFormatVersion: manifest.formatVersion,
    databaseSchema: verified.database.productSchema, manifestDigest: verified.manifestDigest })

  // Relocate the same real business database into a fresh private root and start it read-only.
  const cli = join(install, 'bin/pa')
  const setup = join(root, 'setup')
  const setupRoots = Object.fromEntries(['config', 'cache', 'logs', 'workspace'].map((k) => [k, join(setup, k)]))
  for (const p of Object.values(setupRoots)) mkdirSync(p, { recursive: true, mode: 0o700 })
  const setupArgs = ['--install', install, '--config-root', setupRoots.config, '--data-root', join(setup, 'unused-state'), '--cache-root', setupRoots.cache, '--logs-root', setupRoots.logs, '--workspace-root', setupRoots.workspace]
  const first = run(cli, ['first-run', '--json', ...setupArgs])
  if (!['READY', 'OK'].includes(first.json?.status)) throw new Error('setup first-run failed')
  const restoredRoot = join(root, 'restored')
  const restoredRoots = Object.fromEntries(['config', 'cache', 'logs', 'workspace'].map((k) => [k, join(restoredRoot, k)]))
  for (const p of Object.values(restoredRoots)) mkdirSync(p, { recursive: true, mode: 0o700 })
  const restoredState = join(restoredRoot, 'state')
  const restoredResult = run(cli, ['restore', '--json', '--bundle', bundlePath, '--to', restoredState, ...setupArgs])
  if (restoredResult.json?.status !== 'RESTORED') throw new Error(`restore failed: ${JSON.stringify(restoredResult.json).slice(0, 300)}`)
  const restoredArgs = ['--install', install, '--config-root', restoredRoots.config, '--data-root', restoredState, '--cache-root', restoredRoots.cache, '--logs-root', restoredRoots.logs, '--workspace-root', restoredRoots.workspace]
  const restoredFirst = run(cli, ['first-run', '--json', ...restoredArgs])
  if (!['READY', 'OK'].includes(restoredFirst.json?.status)) throw new Error('restored first-run failed')
  const consolePort = await freePort(); let apiPort = await freePort(); if (apiPort === consolePort) apiPort = await freePort()
  const outFd = openSync(join(root, 'restored.out.log'), 'w', 0o600), errFd = openSync(join(root, 'restored.err.log'), 'w', 0o600)
  // No --fixture: the restore marker forces recovery_readonly while the requested mode stays personal.
  const daemon = spawn(cli, ['start', '--port', String(consolePort), '--api-port', String(apiPort), ...restoredArgs], { cwd: install, stdio: ['ignore', outFd, errFd], detached: true })
  daemon.unref(); closeSync(outFd); closeSync(errFd)
  const health = await waitHealth(apiPort)
  born = health === null ? null : { record: await waitBornRecord(restoredRoots.config), args: restoredArgs }
  if (values.fault === 'after-start') throw new Error('injected_fault:after-start')
  if (health === null) throw new Error(`restored instance not healthy: ${readFileSync(join(root, 'restored.err.log'), 'utf8').slice(0, 400)}`)
  const token = readFileSync(join(restoredState, 'api.key'), 'utf8').trim()
  const auth = { authorization: `Bearer ${token}` }
  const get = async (path) => { const res = await fetch(`http://127.0.0.1:${apiPort}${path}`, { headers: auth }); return { status: res.status, body: await res.json() } }
  const post = async (path, body) => { const res = await fetch(`http://127.0.0.1:${apiPort}${path}`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: res.status, body: await res.json() } }
  const inspect = await get('/v1/recovery/inspect')
  if (inspect.status !== 200 || inspect.body.state !== 'recovery_readonly') throw new Error('restored state is not recovery_readonly')
  const snapshot = await get('/v1/snapshot')
  if (snapshot.status !== 200) throw new Error(`restored snapshot ${snapshot.status}`)
  const works = snapshot.body.works ?? []
  if (works.length < 1) throw new Error('restored snapshot has no real Work')
  const workId = works[0].id ?? works[0].workId
  const work = workId ? await get(`/v1/works/${encodeURIComponent(workId)}`) : { status: null, body: null }
  const workReadable = work.status === 200
  if (workId && !workReadable && ![400, 403].includes(work.status)) throw new Error(`restored Work read failed unexpectedly: ${work.status}`)
  const questions = snapshot.body.questions ?? []
  // Resolved questions are not part of the open-question snapshot projection; the retained database
  // family counts prove the real question/answer rows. This is recorded, not treated as absence.
  const businessMutation = await post('/v1/assistant/suggestions', { enabled: false })
  if (businessMutation.status !== 422 || businessMutation.body.error?.code !== 'unsupported_capability') throw new Error(`business mutation not refused: ${businessMutation.status}`)
  const afterRead = storage.readWorkflowEvidence(db, 2)
  if (afterRead.digest !== v2.digest) throw new Error('real business source changed while being read-only inspected')
  step('real-business-second-root-readonly', 'PASS', { restoredMode: health.mode, markerState: inspect.body.state, works: works.length, openQuestions: questions.length, sourceQuestionFamilies: counts.user_questions,
    workRead: workReadable ? 200 : 'NOT_TESTED', workReadLimit: workReadable ? null : { httpStatus: work.status, code: work.body?.error?.code, reason: 'restored actor is not authorized for the historical Work' }, businessRefused: true, sourceDigestUnchanged: true, oldQueueReplayed: false })

  // Source facts remain data-only on the same relocated business data; no target starts.
  const projectDir = join(root, 'project'); mkdirSync(projectDir, { mode: 0o700 })
  writeFileSync(join(projectDir, 'README.md'), '# wave19 real business project\n', { mode: 0o600 })
  const git = (...args) => { const r = spawnSync('git', ['-c', 'user.email=wave19@fixture.invalid', '-c', 'user.name=wave19', ...args], { cwd: projectDir, encoding: 'utf8' }); if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed`) }
  git('init', '-q'); git('add', 'README.md'); git('commit', '-q', '-m', 'wave19 real business project')
  const targetState = join(root, 'source-target-state')
  const preflight = { expectedFingerprint: inspect.body.inspectionFingerprint,
    bindings: [{ sourceProjectId: inspect.body.projects[0].id, project: { path: projectDir, check: 'node_test' } }] }
  const prepared = await post('/v1/recovery/source/prepare', { preflight, targetStateRoot: targetState })
  if (prepared.status !== 200) throw new Error(`source prepare ${prepared.status} ${JSON.stringify(prepared.body).slice(0, 350)}`)
  const confirmed = await post('/v1/recovery/source/confirm', { token: prepared.body.token })
  if (confirmed.status !== 200 || confirmed.body.authorization !== 'not_granted' || confirmed.body.startupAvailable !== false) throw new Error('source confirm advertised authorization')
  const activationId = confirmed.body.committed?.intent?.activationId
  const audit = await get(`/v1/recovery/activations/${encodeURIComponent(activationId)}`)
  if (audit.status !== 200 || audit.body.authorization !== 'not_granted' || audit.body.startupAvailable !== false) throw new Error('source audit advertised authorization')
  step('real-business-source-facts', 'PASS', { activationId, authorization: confirmed.body.authorization, startupAvailable: confirmed.body.startupAvailable, audit: audit.body.authorization, targetStarted: false })

  // Stop only this independently spawned restored daemon group.
  try { process.kill(-daemon.pid, 'SIGTERM') } catch {}
  await new Promise((r) => setTimeout(r, 800))
  try { process.kill(-daemon.pid, 'SIGKILL') } catch {}
  evidence.status = 'PASS'
  const manifestJson = JSON.parse(readFileSync(join(install, 'install.json'), 'utf8'))
  evidence.build = { buildId: manifestJson.buildId, commit: manifestJson.source.commit, schema: manifestJson.producer.productSchema }
  evidence.business = { source: businessState, tables: counts, workflowEvidenceV1: v1.digest, workflowEvidenceV2: v2.digest, bundle: verified.archiveSha256 }
} catch (error) { evidence.status = 'FAIL'; evidence.error = String(error?.stack ?? error) }
finally {
  let retained = false
  if (evidence.status !== 'PASS' && born) {
    if (!born.record) { evidence.cleanup = [{ status: 'UNKNOWN', unknown: [{ reason: 'record_never_observed' }], retained: true }]; retained = true }
    else {
      const report = await cleanupBornResources({ cli: join(values.install, 'bin/pa'), install: resolve(values.install), roots: { config: born.record.configRoot, data: born.record.state }, records: [born.record], args: born.args, env: process.env })
      evidence.cleanup = [report]; retained = report.retained
    }
    if (retained) evidence.retainedRoot = root
  }
  if (!retained) rmSync(root, { recursive: true, force: true })
}
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
process.exitCode = evidence.status === 'PASS' ? 0 : 1
