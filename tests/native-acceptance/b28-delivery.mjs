#!/usr/bin/env node
/**
 * Wave-28 B13-B16: the ORIGINAL candidate/verification/acceptance path, not a private table.
 *
 * This consumes the same main-owned product runtime the integration suite uses (createControlledProduct
 * with the registered fixture check). It does not read a candidates table, does not construct a
 * candidateId/workId shape, and never writes an accepted field: the only acceptance path exercised is
 * the real application command with the full CandidateRef from WorkView.actions.currentCandidate.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CaseLog, writeReport } from './harness.mjs'
import { ProductStore } from '../../packages/storage/dist/index.js'
import { createControlledProduct, FIXTURE_CHECK } from '../../apps/coordinator/product/runtime.ts'

const log = new CaseLog()
const principal = { userId: 'wave28-b-user', authorityRef: 'wave28-b-authority' }
const actor = { ...principal, source: 'local_cli' }
const scope = { projectId: 'wave28-b-scratch', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
const criteria = [
  { id: 'criterion-output', kind: 'machine', required: true, description: 'Fixed output matches', checkDefinitionRef: FIXTURE_CHECK },
  { id: 'criterion-human', kind: 'human', required: true, description: 'Review generated patch' },
]
const until = async (read, predicate, timeout = 30_000) => {
  const deadline = Date.now() + timeout
  let latest
  while (Date.now() < deadline) {
    latest = await read()
    if (predicate(latest)) return latest
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  return latest
}
const root = mkdtempSync(join(tmpdir(), 'pa-wave28-b-'))
const stateRoot = join(root, 'state')
const scratchProject = join(root, 'project')
mkdirSync(stateRoot); mkdirSync(scratchProject)
const git = args => execFileSync('git', args, { cwd: scratchProject, stdio: 'pipe' })
git(['init', '-q']); mkdirSync(join(scratchProject, 'src')); writeFileSync(join(scratchProject, 'src', '.gitkeep'), '')
git(['add', 'src/.gitkeep'])
git(['-c', 'user.name=Wave28 Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'base'])
const store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
const product = createControlledProduct({ store, principal, projects: [{ id: scope.projectId, scope }], actionSecret: Buffer.alloc(32, 1), stateRoot, scratchProject })
let seq = 0
const command = value => product.application.dispatch({ commandId: `wave28-b-${++seq}`, conversationId: 'conversation-product', ...value }, actor)
const view = async workId => (await product.application.inspect(workId ? { workId } : {})).works[0]
try {
  product.start()

  log.begin('B28-DELIVERY-REAL-CHECK-AND-CANDIDATE', 'a real Work runs the registered check and exposes the current candidate', 'controlled_process')
  const created = await command({ kind: 'create_work', projectId: scope.projectId, goal: 'Produce the controlled scratch artifact', profileId: 'profile-fixture-question', scope, criteria })
  // The dispatch result shape is not assumed: the work identity is taken from the real WorkView.
  const firstView = await until(() => view(), value => Boolean(value?.work?.id))
  const workId = created?.workId ?? firstView?.work?.id ?? null
  const question = await until(async () => (await product.application.inspect({})).questions, value => value.length >= 1).then(value => value[0])
  if (question) await command({ kind: 'answer_question', questionId: question.id, expectedVersion: question.version, answer: { kind: 'choices', optionIds: [question.presentation?.options?.[0]?.id ?? 'accept'] } }).catch(() => undefined)
  const ready = await until(() => view(workId), value => Boolean(value?.actions?.currentVerificationId) && (value?.actions?.available ?? []).includes('accept_candidate'))
  const candidate = ready?.actions?.currentCandidate ?? null
  const deliveries = question ? product.application.questions.currentDeliveries(question.id) : []
  log.evidence({ dispatch: created ?? null, workId, verificationId: ready?.actions?.currentVerificationId ?? null, candidate, phase: ready?.phase ?? null,
    resourceStatus: ready?.resourceStatus ?? null, artifactIds: ready?.artifactIds ?? null, delivery: deliveries[0]?.status ?? null })
  if (candidate && ready?.actions?.currentVerificationId && ready?.resourceStatus === 'quiescent' && (ready?.artifactIds?.length ?? 0) > 0 && deliveries[0]?.status === 'native_applied') {
    log.pass(`work ${workId} ran verification ${ready.actions.currentVerificationId}, ${ready.artifactIds.length} artifacts, delivery native_applied and a complete current candidate`)
  } else log.fail(`the real check chain did not complete: ${JSON.stringify({ candidate: Boolean(candidate), verification: ready?.actions?.currentVerificationId ?? null, resources: ready?.resourceStatus ?? null, delivery: deliveries[0]?.status ?? null })}`)

  log.begin('B28-DELIVERY-EXPLICIT-ACCEPT', 'the full current candidate is accepted by the real command', 'controlled_process')
  const accepted = candidate ? await command({ kind: 'accept_candidate', candidate }).catch(error => ({ error: String(error?.message ?? error).slice(0, 200) })) : { error: 'no_candidate' }
  const delivered = await until(() => view(workId), value => value?.phase === 'delivered')
  log.evidence({ accepted: accepted?.status ?? accepted?.error ?? null, phase: delivered?.phase ?? null, artifactIds: delivered?.artifactIds ?? null })
  if (accepted?.status === 'recorded' && delivered?.phase === 'delivered' && JSON.stringify(delivered?.artifactIds) === JSON.stringify(ready?.artifactIds)) {
    log.pass(`the explicit accept recorded and the work is delivered with the same ${delivered.artifactIds.length} artifacts`)
  } else log.fail(`explicit acceptance did not deliver: ${JSON.stringify({ accepted, phase: delivered?.phase ?? null })}`)

  log.begin('B28-DELIVERY-STALE-CANDIDATE-REFUSED', 'a stale candidate generation is refused', 'controlled_process')
  const staleCandidate = candidate ? { ...candidate, candidateGeneration: Number(candidate.candidateGeneration ?? 1) + 99 } : null
  const stale = staleCandidate ? await command({ kind: 'accept_candidate', candidate: staleCandidate }).then(value => ({ status: value.status })).catch(error => ({ error: String(error?.message ?? error).slice(0, 160) })) : { error: 'no_candidate' }
  const phaseAfterStale = (await view(workId))?.phase ?? null
  log.evidence({ stale, phaseAfterStale })
  if (stale?.status !== 'recorded') log.pass(`a candidate with generation +99 was refused (${JSON.stringify(stale).slice(0, 120)}) and the work stayed ${phaseAfterStale}`)
  else log.fail('a stale candidate generation was accepted')

  log.begin('B28-DELIVERY-ARTIFACT-AND-LOCATION-READABLE', 'the delivered artifacts and the workspace location stay readable', 'controlled_process')
  const location = await product.read.workLocation(workId)
  const artifactBodies = []
  for (const id of delivered?.artifactIds ?? []) { const artifact = await product.read.artifact(id); artifactBodies.push(Boolean(artifact?.body)) }
  log.evidence({ workspacePath: Boolean(location?.workspacePath), baseCommit: Boolean(location?.baseCommit), artifactsReadable: artifactBodies.filter(Boolean).length })
  if (location?.workspacePath && location?.baseCommit && artifactBodies.length > 0 && artifactBodies.every(Boolean)) log.pass(`the delivered work keeps its workspace location and all ${artifactBodies.length} artifacts are readable by their published ids`)
  else log.fail(`artifacts or location not readable: ${JSON.stringify({ location, artifactBodies })}`)

  log.begin('B28-DELIVERY-NO-PRIVATE-STATE', 'no candidate table and no direct write were used', 'controlled_process')
  const candidateTables = store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND lower(name) LIKE '%candidate%'").all().map(row => String(row.name))
  log.evidence({ candidateTables, harnessWrites: 0, acceptancePath: 'application command accept_candidate' })
  if (candidateTables.length === 0) log.pass('the acceptance ran through the original completion/verification path with no candidates table and no harness write')
  else log.fail(`unexpected candidate tables exist: ${JSON.stringify(candidateTables)}`)

  log.begin('B28-SCOPE-NOT-NATIVE', 'fixture lane; installed Codex not executed', 'controlled_process')
  log.notTested('no installed agent executed and no gateway contacted')
} finally {
  try { await product.close() } catch {}
  try { store.close() } catch {}
  rmSync(root, { recursive: true, force: true })
}
const report = writeReport({ cases: log.cases, environment: { note: 'wave-28 original candidate/accept path', modelCalls: 0, nativeTurns: 0 }, extra: { scope: 'fixture check lane; native NOT_TESTED' } }, undefined)
for (const item of report.cases) process.stdout.write(`${item.status.padEnd(10)} ${item.id.padEnd(48)} ${item.detail.join(' | ')}\n`)
process.stdout.write(`\nB28-delivery totals: ${JSON.stringify(report.totals)}\n`)
process.exit(report.totals.FAIL === 0 ? 0 : 1)
