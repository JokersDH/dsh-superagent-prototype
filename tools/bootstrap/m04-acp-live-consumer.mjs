/** Explicit M04 operator consumer. Uses the original product; never a direct ACP prompt shortcut. */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, renameSync, openSync, fsyncSync, closeSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createInterface } from 'node:readline/promises'
import { ProductStore, WriterLock, InstanceRegistry } from '../../packages/storage/dist/index.js'
import { createProductRuntime } from '../../apps/coordinator/product/runtime.ts'
import { prepareAcpStartup } from '../../apps/coordinator/product/acp-startup.ts'
import { inspectAcpConnection } from '../../apps/coordinator/product/acp-inspection.ts'
import { NativeProjectRegistry } from '../../apps/coordinator/product/project-registry.ts'
import { ProductExecutorTrials } from '../../apps/coordinator/product/executor-trial.ts'
import { createLocalHttpApp } from '../../apps/coordinator/http/app.ts'
import { localCredentials } from '../../apps/coordinator/http/local-state.ts'
import { key } from '../../packages/orchestrator-core/dist/index.js'
import { openAcpLiveBrowser } from '../../tests/integration/fixtures/acp-live-browser.mjs'

const { values } = parseArgs({ options: { execute: { type: 'boolean' }, state: { type: 'string' }, inputs: { type: 'string' },
  ledger: { type: 'string' }, case: { type: 'string' } } })
if (!values.execute || !values.state || !values.inputs || !values.ledger || !['allow', 'deny', 'stop'].includes(values.case))
  throw new Error('Requires explicit --execute --state --inputs --ledger --case allow|deny|stop under the human-authorized M04 sender')
const stateRoot = resolve(values.state), ledgerPath = resolve(values.ledger), plan = JSON.parse(readFileSync(values.inputs, 'utf8'))
const scenario = plan.scenarios.find(item => item.name === values.case)
assert(scenario && plan.profileId === scenario.command.profileId)
const output = join(stateRoot, `live-${values.case}-${scenario.command.commandId}.json`)
const principal = { userId: 'local-demo-user', authorityRef: 'local-demo-authority' }
const credential = localCredentials(stateRoot)
const store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
const lock = new WriterLock(stateRoot, new InstanceRegistry(store.db)); lock.acquire()
let product, browser, entry, workId, counted = false, answered = new Set(), lastWork, lastQuestions = [], productClosed = false
let actualCreateCommand = scenario.command
const report = { source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), case: values.case,
  stateRoot, inputFile: resolve(values.inputs), status: 'SETUP', nativeQuestions: [], reviewedPatch: false }
const writeLedger = ledger => {
  const temporary = ledgerPath + '.main-active.tmp'
  writeFileSync(temporary, JSON.stringify(ledger, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  const fd = openSync(temporary, 'r'); try { fsyncSync(fd) } finally { closeSync(fd) }
  renameSync(temporary, ledgerPath)
}
const save = () => writeFileSync(output, JSON.stringify(report, (key, value) => /token|api.?key|secret|password/i.test(key) ? '<REDACTED>' : value, 2) + '\n', { mode: 0o600 })
function reserve(command = scenario.command) {
  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
  assert.equal(ledger.owner, 'main'); assert.equal(ledger.limit, 6); assert.equal(ledger.inFlight, null)
  assert(ledger.sent < ledger.limit && ledger.unknownOutcome === 0, 'no new send after a prior unknown or exhausted grant')
  assert(!ledger.entries.some(item => item.commandId === command.commandId || item.scenarioId === scenario.command.commandId), 'reconcile the original entry instead of repeating a Work')
  actualCreateCommand = structuredClone(command)
  report.createCommandId = command.commandId
  entry = { id: command.commandId, commandId: command.commandId, scenarioId: scenario.command.commandId, case: values.case, stateRoot,
    source: report.source, profileId: plan.profileId, state: 'reserved', reservedAt: new Date().toISOString() }
  ledger.entries.push(entry); ledger.inFlight = entry.id; ledger.state = 'active'; ledger.blockers = []
  writeLedger(ledger)
}
async function observeSend() {
  if (!entry || !lastWork || (counted && report.sendOutcome !== 'UNKNOWN')) return
  const link = lastWork.links.find(item => item.role === 'primary' && item.contract.revision === lastWork.contract.revision)
  const binding = link && store.bindings.current(link.ticketId)
  if (!binding) return
  report.attemptId = binding.attemptId; report.binding = binding
  const rows = store.observations.forAttempt(binding.attemptId).filter(item => item.kind === 'dispatch.observed')
  for (const row of rows) {
    const payload = (await store.payloads.read(row.payloadRef)).value
    if (payload?.kind !== 'dispatch.observed' || !['written', 'native_accepted', 'indeterminate'].includes(payload.value.delivery)) continue
    const indexed = store.commands.get(key('product-command', payload.value.commandId))?.result
    if (indexed?.command?.kind !== 'begin') continue
    const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8')), current = ledger.entries.find(item => item.id === entry.id)
    if (counted) {
      if (current.state !== 'unknown' || payload.value.delivery !== 'native_accepted' ||
          current.nativeDispatch?.commandId !== payload.value.commandId) continue
      ledger.unknownOutcome--; current.state = 'sent'; report.sendOutcome = 'RECONCILED'
      current.reconciliation = { commandId: payload.value.commandId, delivery: payload.value.delivery, factId: row.factId }
      writeLedger(ledger); report.sendReconciliation = current.reconciliation
      return
    }
    current.state = 'sent'; current.sentAt = row.observedAt; current.attemptId = binding.attemptId
    current.nativeDispatch = { commandId: payload.value.commandId, delivery: payload.value.delivery, factId: row.factId }
    ledger.sent++
    if (payload.value.delivery === 'indeterminate') { ledger.unknownOutcome++; current.state = 'unknown'; report.sendOutcome = 'UNKNOWN' }
    writeLedger(ledger); counted = true; report.sendEvidence = current.nativeDispatch
    console.log(JSON.stringify({ stage: 'actual_send_observed', case: values.case, sent: ledger.sent, limit: ledger.limit, workId, attemptId: binding.attemptId }))
    return
  }
}
try {
  const inspect = id => inspectAcpConnection(stateRoot, id ?? plan.profileId)
  const trials = new ProductExecutorTrials({ store, principal, inspect })
  const inspected = await trials.read(plan.profileId)
  assert.equal(inspected.confirmationAvailable, true)
  // The current human explicitly confirmed this dedicated profile trial and the same grant takeover.
  report.trialReceipt = await trials.confirm({ commandId: inspected.confirmationCommandId, profileId: plan.profileId,
    revision: inspected.profile.revision, identityDigest: inspected.identityDigest, policyDigest: inspected.policyDigest,
    confirmUnverifiedVersion: true }, { ...principal, source: 'local_cli' })
  const startup = await prepareAcpStartup(stateRoot, store, principal)
  assert(startup.executors.some(item => item.profile.id === plan.profileId), 'normal startup must admit the actual profile')
  const registry = new NativeProjectRegistry(stateRoot), records = registry.list()
  product = createProductRuntime({ store, stateRoot, principal, actionSecret: Buffer.from(credential('action.key'), 'hex'),
    scratchProject: plan.registration.path, projects: records.map(item => ({ id: item.id, displayName: item.displayName, scope: registry.scope(item) })),
    executors: startup.executors, inspectedProfiles: startup.inspectedProfiles, projectRegistry: registry, inspectExecutor: inspect })
  const configuration = await product.read.registerProject(plan.registration)
  const configuredProject = configuration.projects.find(item => item.id === scenario.command.projectId)
  assert.equal(configuredProject?.defaultCriteria[0].checkDefinitionRef,
    scenario.command.criteria[0].checkDefinitionRef)
  const makeApp = origin => createLocalHttpApp({ application: product.application, principal, apiToken: credential('api.key'), bootstrapToken: credential('bootstrap.key'),
    mode: 'personal', allowedOrigins: origin ? [origin] : [], localDevelopmentAccess: Boolean(origin), read: product.read, operations: product.operations })
  const app = makeApp()
  const post = async body => {
    const response = await app.request('http://127.0.0.1/v1/commands', { method: 'POST', headers: { authorization: `Bearer ${credential('api.key')}`,
      'content-type': 'application/json' }, body: JSON.stringify({ conversationId: scenario.command.conversationId, ...body }) })
    const value = await response.json(); assert.equal(response.status, 200, 'original product HTTP command must be received')
    assert.equal(value.status, 'recorded', `original command refused: ${value.error?.code ?? 'unknown'}`)
    return value
  }
  if (values.case === 'allow') {
    browser = await openAcpLiveBrowser({ createApp: makeApp, outputRoot: join(stateRoot, `screenshots-${scenario.command.commandId}`),
      conversationId: scenario.command.conversationId,
      onCreateCommand: command => {
        assert.equal(command.profileId, plan.profileId); assert.equal(command.projectId, scenario.command.projectId)
        assert.deepEqual(command.criteria, configuredProject.defaultCriteria)
        assert.deepEqual(command.scope, configuredProject.scope)
        reserve(command)
      } })
  } else reserve()
  report.status = 'RUNNING'; save()
  product.start()
  workId = (browser ? await browser.delegate({ goal: scenario.command.goal, projectId: scenario.command.projectId, profileId: plan.profileId })
    : await post(scenario.command)).workId
  report.workId = workId; save()
  const deadline = Date.now() + 240000
  let stopIssued = false
  while (Date.now() < deadline) {
    const snapshot = await product.application.inspect({ workId })
    lastWork = snapshot.works[0]; lastQuestions = snapshot.questions
    await observeSend()
    report.phase = lastWork.phase; report.resourceStatus = lastWork.resourceStatus
    const question = snapshot.questions.find(item => item.kind === 'permission' && !answered.has(item.id))
    if (question) {
      report.nativeQuestions.push({ id: question.id, version: question.version, targets: question.targets, prompt: question.prompt,
        options: question.presentation.options }); answered.add(question.id)
      assert(question.targets.every(target => target.attemptId === report.attemptId), 'native question must keep the original attempt')
      if (values.case === 'stop' && !stopIssued) {
        report.beforeStop = { phase: lastWork.phase, resourceStatus: lastWork.resourceStatus, currentCandidate: lastWork.actions.currentCandidate,
          question: { id: question.id, targets: question.targets } }
        assert.equal(lastWork.resourceStatus, 'active'); assert.equal(lastWork.actions.currentCandidate, undefined)
        await post({ kind: 'stop_work', commandId: `stop-${workId}`, workId }); stopIssued = true
      } else if (values.case !== 'stop') {
        const option = question.presentation.options.find(item => item.semantic === (values.case === 'allow' ? 'allow_once' : 'deny'))
        assert(option, 'the actual native request must offer the requested original option')
        if (browser) await browser.answerPermission(question, 'allow_once')
        else await post({ kind: 'answer_question', commandId: `answer-${question.id}`, questionId: question.id, expectedVersion: question.version,
          answer: { kind: 'choices', optionIds: [option.id] } })
      }
      save(); console.log(JSON.stringify({ stage: 'native_question', case: values.case, questionId: question.id, action: values.case }))
    }
    if (values.case === 'allow' && lastWork.actions.available.includes('accept_candidate')) {
      const verification = await product.read.verification(lastWork.actions.currentVerificationId)
      const machineCriterion = actualCreateCommand.criteria.find(item => item.kind === 'machine' && item.checkDefinitionRef === scenario.command.criteria[0].checkDefinitionRef)
      assert(machineCriterion?.required, 'the actual original registered test remains required')
      assert.equal(verification.results.find(item => item.criterionId === machineCriterion.id).outcome, 'PASS')
      const location = await product.read.workLocation(workId)
      assert.equal(readFileSync(join(location.workspacePath, plan.unchangedCheckPath), 'utf8'), plan.unchangedCheck)
      const status = execFileSync('git', ['-c', 'core.hooksPath=/dev/null', 'status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: location.workspacePath, encoding: 'utf8' })
      const changed = status.split('\0').filter(Boolean).map(item => item.slice(3))
      assert.deepEqual(changed, [plan.sourcePath])
      report.reviewedSource = readFileSync(join(location.workspacePath, plan.sourcePath), 'utf8')
      report.verification = verification; report.candidate = lastWork.actions.currentCandidate
      const review = product.completion.current(report.candidate)
      assert(review, 'review must resolve the original frozen current candidate')
      let manifest, manifestArtifact
      for (const id of review.artifactIds) {
        const artifact = store.artifacts.read(id)
        try { const value = JSON.parse(artifact.data.toString('utf8')); if (value.kind === 'product-artifact/1') { manifest = value; manifestArtifact = artifact } } catch {}
      }
      assert(manifest && manifest.artifactDigest === review.proposal.artifactDigest)
      assert.deepEqual(manifest.candidate, report.candidate)
      const patch = store.artifacts.read(manifest.patch.artifactId)
      assert.equal(createHash('sha256').update(patch.data).digest('hex'), manifest.patch.sha256)
      report.reviewedManifest = manifest; report.reviewedPatchText = patch.data.toString('utf8')
      assert.match(manifestArtifact.record.digest, /^[a-f0-9]{64}$/)
      assert.match(patch.record.digest, /^[a-f0-9]{64}$/)
      report.reviewDigest = createHash('sha256').update(JSON.stringify({ candidate: report.candidate,
        artifactDigest: review.proposal.artifactDigest, manifestDigest: manifestArtifact.record.digest,
        patchDigest: patch.record.digest, verificationId: verification.id })).digest('hex')
      report.status = 'AWAITING_OPERATOR_REVIEW'; save()
      console.log(JSON.stringify({ stage: 'review_required', workId, candidate: report.candidate,
        source: report.reviewedSource, patch: report.reviewedPatchText, reviewDigest: report.reviewDigest,
        instruction: 'Review frozen patch/manifest/checks; type accept followed by this digest only after review' }))
      const operator = createInterface({ input: process.stdin, output: process.stdout })
      const decision = await operator.question('Operator review: ')
      operator.close()
      assert.equal(decision.trim(), `accept ${report.reviewDigest}`, 'manual review must bind the complete original frozen patch and manifest')
      report.reviewedPatch = true
      if (browser) await browser.acceptCandidate(lastWork.actions.currentCandidate)
      else await post({ kind: 'accept_candidate', commandId: `accept-${workId}`, candidate: lastWork.actions.currentCandidate })
      assert.equal((await product.application.inspect({ workId })).works[0].phase, 'delivered')
      assert(report.nativeQuestions.length > 0, 'real native approval must have occurred')
      report.status = 'PASS'; break
    }
    if (values.case === 'deny' && answered.size && lastWork.resourceStatus === 'quiescent') {
      const location = await product.read.workLocation(workId)
      assert.equal(readFileSync(join(location.workspacePath, plan.sourcePath), 'utf8'), plan.sourceBaseline)
      assert.equal(execFileSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: location.workspacePath, encoding: 'utf8' }), '')
      report.denialDeliveries = []
      for (const question of report.nativeQuestions) {
        const deliveries = product.application.questions.currentDeliveries(question.id)
        for (const target of question.targets) {
          const delivered = deliveries.find(item => item.targetBindingId === target.id && item.answerId === key('answer', `answer-${question.id}`) && ['response_written', 'native_applied'].includes(item.status))
          assert(delivered, 'deny needs the original native answer observation, not only a local command receipt')
          report.denialDeliveries.push(delivered)
        }
      }
      assert.notEqual(lastWork.phase, 'delivered'); report.status = 'PASS'; break
    }
    if (values.case === 'stop' && stopIssued && lastWork.resourceStatus === 'quiescent') {
      assert.equal(lastWork.phase, 'ended'); report.status = 'PASS'; break
    }
    if (lastWork.resourceStatus === 'quiescent' && ['needs_user', 'ended'].includes(lastWork.phase) && !snapshot.questions.length)
      throw new Error('Actual Work ended before its required acceptance observation')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  if (report.status !== 'PASS') throw new Error('Actual Work did not meet the bounded native observation')
  const final = (await product.application.inspect({ workId })).works[0]
  const binding = store.bindings.current(final.links.find(item => item.role === 'primary' && item.contract.revision === final.contract.revision).ticketId)
  assert.equal(binding.state, 'ended'); assert.equal(final.resourceStatus, 'quiescent')
  report.finalWork = final; report.binding = binding
  report.originalProjectPreserved = execFileSync('git', ['status', '--porcelain'], { cwd: plan.registration.path, encoding: 'utf8' }).trim() === ''
  assert(report.originalProjectPreserved)
  report.progressEvents = store.events.after(0).filter(item => item.topic === 'application.execution.progress' && item.entityRef === workId).length
  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8')), current = ledger.entries.find(item => item.id === entry.id)
  assert(counted, 'a native PASS needs original actual-send evidence')
  assert(current.state !== 'unknown' && ledger.unknownOutcome === 0 && report.sendOutcome !== 'UNKNOWN', 'UNKNOWN must reconcile from the original begin before a PASS can clear occupancy')
  current.result = 'PASS'; current.finishedAt = new Date().toISOString(); current.workId = workId
  ledger.inFlight = null; ledger.state = 'ready'; writeLedger(ledger); save()
  console.log(JSON.stringify({ stage: 'finished', case: values.case, status: report.status, workId, attemptId: report.attemptId, sent: ledger.sent }))
} catch (error) {
  report.status = 'FAIL_OR_UNKNOWN'; report.failure = error instanceof Error ? error.message.replace(/sk-[\w-]+/g, '<REDACTED>') : 'unknown'
  try { await product?.close(); productClosed = true } catch { report.closeOutcome = 'UNKNOWN' }
  const originalCreate = store.commands.get(actualCreateCommand.commandId)
  if (!workId && originalCreate?.status === 'recorded' && originalCreate.result?.workId) workId = originalCreate.result.workId
  if (workId && !lastWork) lastWork = (await product.application.inspect({ workId })).works[0]
  if (lastWork) await observeSend().catch(() => undefined)
  if (entry) {
    const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8')), current = ledger.entries.find(item => item.id === entry.id)
    // A create without an authoritative no-send proof cannot be treated as free or replayed.
    const link = lastWork?.links.find(item => item.role === 'primary' && item.contract.revision === lastWork.contract.revision)
    const binding = link && store.bindings.current(link.ticketId)
    report.attemptId ??= binding?.attemptId
    const beginIndexed = report.attemptId && store.db.prepare("SELECT command_id FROM command_receipts WHERE json_extract(result,'$.command.attemptId') = ? AND json_extract(result,'$.command.kind') = 'begin'").get(report.attemptId)
    const noSendProven = productClosed && !counted && !beginIndexed
    const terminal = report.attemptId && store.observations.forAttempt(report.attemptId).some(item => item.kind === 'turn.ended')
    const knownOutcome = terminal && binding?.state === 'ended' && report.sendOutcome !== 'UNKNOWN'
    if (!noSendProven && !knownOutcome) {
      if (!counted) ledger.sent++
      if (current.state !== 'unknown') ledger.unknownOutcome++
      current.state = 'unknown'; report.sendOutcome = 'UNKNOWN'
    } else if (noSendProven) current.state = 'not_sent'
    current.result = report.status; current.workId = workId; current.finishedAt = new Date().toISOString()
    if (report.sendOutcome !== 'UNKNOWN') ledger.inFlight = null
    ledger.state = report.sendOutcome === 'UNKNOWN' ? 'reconcile_required' : 'failed'; writeLedger(ledger)
    if (!noSendProven) counted = true
  }
  save(); console.log(JSON.stringify({ stage: 'failed', case: values.case, status: report.status, failure: report.failure, workId, evidence: output }))
  process.exitCode = 1
} finally {
  if (browser) { report.screenshots = [...browser.screenshots]; await browser.close() }
  if (!productClosed) await product?.close()
  lock.release(); store.close(); save()
  // Keep original state, native journals, resources and the grant material for independent review.
}
