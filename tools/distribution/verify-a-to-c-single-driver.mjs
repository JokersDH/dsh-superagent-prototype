#!/usr/bin/env node
/** One D driver: validates A producer/manifest, then starts the unique C package driver with the A subject digest. */
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
const { values } = parseArgs({ options: {
  install: { type: 'string' }, state: { type: 'string' }, 'a-repo': { type: 'string', default: '/Users/hh/Desktop/joker/superagent-agent-a' },
  'c-driver': { type: 'string', default: '/Users/hh/Desktop/joker/superagent-agent-c/packages/context/tools/personal-review-driver.mjs' },
  project: { type: 'string', default: 'project-personal-dialogue' }, message: { type: 'string' },
  'console-port': { type: 'string', default: '57300' }, 'api-port': { type: 'string', default: '57301' },
  'model-config': { type: 'string' }, 'config-root': { type: 'string' }, 'cache-root': { type: 'string' }, 'logs-root': { type: 'string' }, 'workspace-root': { type: 'string' }, json: { type: 'boolean', default: false } } })
const result = { protocol: 'wave25-a-to-c-single-driver/1', status: 'FAIL', steps: [] }
const step = (id, status, detail) => result.steps.push({ id, status, detail })
try {
  const install = resolve(values.install), state = resolve(values.state), aRepo = resolve(values['a-repo'])
  const storage = await import(pathToFileURL(join(aRepo, 'packages/storage/dist/index.js')).href)
  const workflows = await import(pathToFileURL(join(aRepo, 'packages/workflows/dist/index.js')).href)
  const store = new storage.ProductStore({ path: join(state, 'state.sqlite') })
  let manifest, expectation
  try {
    const binding = JSON.parse(store.db.prepare('SELECT value FROM runtime_bindings LIMIT 1').get().value)
    const question = store.db.prepare('SELECT id FROM user_questions LIMIT 1').get()
    const answer = store.db.prepare('SELECT answer_id FROM answers WHERE question_id = ?').get(question.id)
    const commands = store.db.prepare('SELECT command_id FROM command_receipts ORDER BY seq').all().map((r) => r.command_id)
    const dispatch = store.db.prepare('SELECT command_id,target FROM dispatch_receipts ORDER BY command_id,target').all().map((r) => ({ commandId: r.command_id, target: r.target }))
    const targets = store.db.prepare('SELECT target_binding_id FROM answer_deliveries WHERE answer_id = ?').all(answer.answer_id).map((r) => r.target_binding_id)
    expectation = { sourceSha: 'a'.repeat(40), snapshotFormat: 1, ticketId: binding.ticketId, assignmentId: binding.assignmentId, attemptId: binding.attemptId, fenceEpoch: binding.fenceEpoch, contract: binding.contract, questionId: question.id, answerId: answer.answer_id, requiredCommandIds: commands, requiredDispatch: dispatch, requiredDeliveryTargets: targets }
    manifest = await workflows.buildDataManifest(store, expectation)
    const verified = await workflows.verifyDataManifest(store, manifest, expectation)
    if (!verified.ok || verified.coverage.commands !== 'complete' || verified.coverage.dispatch !== 'complete' || verified.coverage.observations !== 'complete') throw new Error('A manifest coverage incomplete')
    step('a-producer-manifest', 'PASS', { manifestDigest: manifest.digest, attemptId: expectation.attemptId, questionId: expectation.questionId, answerId: expectation.answerId, coverage: verified.coverage })
    const tampered = structuredClone(manifest); tampered.binding.questionId = 'foreign-question'
    let rejected = false
    try { const bad = await workflows.verifyDataManifest(store, tampered, expectation); rejected = bad.ok === false } catch { rejected = true }
    step('a-tamper-before-c-start', rejected ? 'PASS' : 'FAIL', { rejected })
    if (!rejected) throw new Error('tampered A manifest was not rejected')
  } finally { store.close() }
  const appInstall = join(install, 'app'); const paEntry = join(appInstall, 'apps/launcher/bin/pa.mjs')
  const model = values['model-config']; if (!model) throw new Error('--model-config required for C package start')
  const out = spawnSync(process.execPath, [resolve(values['c-driver']), '--dialect', 'package', '--install', appInstall, '--state', state, '--data-root', state,
    '--config-root', values['config-root'] ? resolve(values['config-root']) : join(resolve(state), '..', 'config'), '--cache-root', values['cache-root'] ? resolve(values['cache-root']) : join(resolve(state), '..', 'cache'), '--logs-root', values['logs-root'] ? resolve(values['logs-root']) : join(resolve(state), '..', 'logs'), '--workspace-root', values['workspace-root'] ? resolve(values['workspace-root']) : join(resolve(state), '..', 'workspace'),
    '--project', values.project, '--allow-path', '.', '--message', values.message, '--package-subject', JSON.stringify(manifest),
    '--console-port', values['console-port'], '--api-port', values['api-port'], '--model-config', resolve(model), '--pa-entry', paEntry,
    '--identity-module', join(appInstall, 'apps/coordinator/product/restored-review.ts'), '--deadline-ms', '180000', '--readiness-ms', '60000'], { encoding: 'utf8', timeout: 240000 })
  let c = null; try { c = JSON.parse(out.stdout) } catch {}
  if (out.status !== 0 || c?.status !== 'verified-flow') throw new Error(`C driver failed: ${out.status} ${String(out.stdout).slice(0,600)} ${String(out.stderr).slice(0,300)}`)
  const subjectEcho = c.packageSubject ?? null
  let echoedManifest = null; try { echoedManifest = JSON.parse(subjectEcho) } catch {}
  if (!echoedManifest || echoedManifest.digest !== manifest.digest) throw new Error('C did not carry the full A manifest subject')
  if (JSON.stringify(echoedManifest) !== JSON.stringify(manifest)) throw new Error('C echoed a different A manifest subject')
  const sourceMessage = c.data?.sources?.binding?.messageId ?? c.data?.history?.conversationId ?? null
  step('c-consumes-a-subject', 'PASS', { subjectDigest: echoedManifest.digest, fullManifestCarried: true, cStatus: c.status, bound: c.identity?.bound, requestedDigest: c.identity?.requestedDigest, actualHealthDigest: c.identity?.actualHealthDigest, assertions: c.assertions?.length ?? 0, cleanup: c.cleanup, sourceMessage })
  result.cDriver = { status: c.status, packageSubject: subjectEcho, identity: c.identity, cleanup: c.cleanup }
  result.limit = 'C receives the full A manifest as package subject and echoes it byte-for-byte; A identity/coverage and tamper rejection are checked before C starts. C does not independently re-validate every manifest field internally.'
  result.status = 'PASS_WITH_LIMIT'
} catch (error) { result.error = String(error?.stack ?? error) }
if (values.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); else console.log(result.status)
process.exitCode = result.status.startsWith('PASS') ? 0 : 1
