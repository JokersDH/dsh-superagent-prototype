import { DatabaseSync } from 'node:sqlite'
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runCase, LAYERS } from '../lib/status.mjs'
import { LocalProductClient } from '../lib/http-client.mjs'
import { candidateModel } from '../../../tests/integration/fixtures/assistant-candidate-model.mjs'
import { captureSet, createOperation, resourceBirth, rollout } from '../lib/caller-safety.mjs'
import { DEFAULT_FROZEN_DIRS, frozenArtifactSubject, loadFrozenArtifact } from '../lib/frozen-package.mjs'
import { extractFrozen, freePort, launcher, liveIdentity, privateRoot, readRecord, sha256, startOwned, stopOwned } from '../lib/packaged-instance.mjs'
import { verifyOuterZip } from '../lib/outer-zip.mjs'

/**
 * Wave-34 same-cohort non-empty business recovery.
 *
 * The subject is the locked W33 inner tar (f880/ee45), extracted into a private root and driven by
 * the frozen install's own CLI. The fixture produces one accepted Work with every referenced artifact
 * and one Work still waiting on a real question; both are backed up, restored into a new root and read
 * back recovery-readonly. All artifact bytes, the conversation history, the held question and the
 * direct Store registry must match; business writes, answers and provider calls must not occur. The
 * caller owns one operation and keeps the whole material set on any unknown.
 */
const mark = message => { if (process.env.PA_E_TRACE) process.stderr.write(`[w34rec] ${message}\n`) }

function dbCounts(path) {
  if (!existsSync(path)) return null
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    const count = table => { try { return Number(db.prepare(`SELECT count(*) AS c FROM ${table}`).get()?.c ?? 0) } catch { return null } }
    return { works: count('works'), artifacts: count('artifacts'), messages: count('conversation_messages'),
      questions: count('user_questions'), answers: count('question_answers'),
      effect: (() => { try { return db.prepare('SELECT * FROM effect ORDER BY rowid').all().map(row => ({ ...row })) } catch { return null } })() }
  } finally { db.close() }
}

async function waitRunning(client, attempts = 60) {
  for (let index = 0; index < attempts; index += 1) {
    try { const health = await client.health(); if (health?.status === 'ok' || health?.ok === true) return true } catch { /* not up */ }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 200))
  }
  return false
}

async function startPhase(root, options, attempts = 2) {
  let last = null
  for (let index = 0; index < attempts; index += 1) {
    const ports = [await freePort(), await freePort()]
    if (ports[0] === ports[1]) continue
    if (last) await new Promise(resolvePromise => setTimeout(resolvePromise, 500))
    const started = startOwned(root, { ports, ...options })
    const value = await started.value
    last = { started, value }
    if (value.status === 'RUNNING') return last
    if (value.status === 'BLOCKED' && value.code !== 'port_in_use' && value.code !== 'instance_conflict') return last
    await stopOwned(root, { mockFile: options.mockFile, birth: started.birth, equivalentProof: true }).catch(() => {})
  }
  return last
}

/** The frozen install's own storage readers, over a copy: no migration, no write to the restored root. */
async function directStoreRead(install, statePath, own) {
  const entry = join(install, 'app/packages/storage/dist/index.js')
  if (!existsSync(entry)) return { available: false, reason: 'storage_dist_absent', entry }
  const copy = join(own, 'direct-read')
  mkdirSync(copy, { recursive: true, mode: 0o700 })
  copyFileSync(statePath, join(copy, 'state.sqlite'))
  for (const suffix of ['-wal', '-shm']) if (existsSync(`${statePath}${suffix}`)) copyFileSync(`${statePath}${suffix}`, join(copy, `state.sqlite${suffix}`))
  const module = await import(pathToFileURL(entry).href)
  const registry = module.readArtifactRegistry(join(copy, 'state.sqlite'))
  const evidence = module.readWorkflowEvidence(join(copy, 'state.sqlite'), 1)
  return { available: true, entry, registry,
    families: (evidence?.families ?? []).map(family => ({ name: family.name, count: family.count, digest: family.digest })),
    protocol: evidence?.protocol ?? null }
}

export async function runCohortRecovery() {
  const cases = []
  const target = loadFrozenArtifact('w33', DEFAULT_FROZEN_DIRS.w33)
  const evidence = { subject: frozenArtifactSubject(target), artifact: { role: target.role, name: target.name,
    tarSha256: target.tarSha256, tarBytes: target.tarBytes, installManifestSha256: target.installManifestSha256,
    buildId: target.buildId, source: target.sourceCommit, schema: target.productSchema, abi: target.abi,
    platform: target.platform, arch: target.arch, node: target.node },
    seed: null, pending: null, delivery: null, backup: null, restore: null, directRead: null, readonly: null,
    negatives: {}, resources: {} }
  const root = privateRoot('pa-e-w34-recovery-')
  const operation = createOperation({ id: 'w34-cohort-recovery' })
  operation.addMaterial(root.own, 'install-config-state-model')
  let mock = null, failure = null, install = null

  const track = (label, pid, { state, config, role }) => {
    try { operation.track(resourceBirth(pid, { root: root.install, config, state, op: `cohort:${label}`, role })); return true } catch (error) {
      operation.fail(`track:${label}`, error); operation.retain(`track_failed:${label}`); return false
    }
  }
  const trackBirth = (label, birth) => {
    // startOwned's birth has pid/start/uid/argv; the argv digest is added here so the set is complete.
    const argv = birth.argv ?? (birth.pid ? liveIdentity(birth.pid).command : null)
    try { operation.track({ ...birth, argv, argvSha256: argv ? sha256(argv) : null, op: `cohort:${label}` }); return true } catch (error) {
      operation.fail(`track-birth:${label}`, error); operation.retain(`track_birth_failed:${label}`); return false
    }
  }
  const capture = (label, config, state) => {
    const record = readRecord(config).value ?? null
    const pids = record ? [...new Set([record.pid, record.apiPid, record.consolePid])].filter(Number.isSafeInteger) : []
    for (const pid of pids) track(label, pid, { state, config, role: 'product' })
    return captureSet(pids, { root: root.install, config, state, op: `cohort:${label}` })
  }

  try {
    mark('extract locked W33 tar')
    // The tar cohort is the inner package of the one outer ZIP; bind it to that outer identity too.
    const outer = verifyOuterZip()
    evidence.zip = { sha256: outer.sha256, bytes: outer.bytes, sumsMatch: outer.sumsMatch, resultMatch: outer.resultMatch,
      buildId: outer.result?.inner?.buildId ?? null, source: outer.result?.inner?.source ?? null,
      innerTarSha256: outer.result?.inner?.tarSha256 ?? null, innerTarBytes: outer.result?.inner?.tarBytes ?? null,
      digestsMatch: outer.result?.inner?.tarSha256 === target.tarSha256 && outer.result?.inner?.buildId === target.buildId }
    extractFrozen(target, root.install)
    install = root.install
    const first = launcher(install, ['first-run', '--json'], { env: { PA_CONFIG_ROOT: root.config, PA_DATA_ROOT: root.state } })
    if (first.status !== 0) throw new Error(`first-run ${first.status}: ${first.stderr}`)

    mock = await candidateModel()
    mark('seed accepted Work + pending question')
    const phaseSeed = await startPhase(root, { mockFile: mock.file, fixture: true, extraArgs: [] })
    const seeded = phaseSeed?.started
    trackBirth('seed', seeded.birth)
    const seedValue = await seeded.value
    if (seedValue.status !== 'RUNNING') throw new Error(`seed start ${seedValue.status}/${seedValue.code ?? 'none'}: ${seedValue.stderr ?? ''}`)
    const seedClient = new LocalProductClient({ baseURL: seedValue.instance.apiURL, stateDir: seedValue.instance.state, timeoutMs: 25_000 })
    await waitRunning(seedClient)
    const configuration = await seedClient.configuration()
    const schema = (() => {
      try {
        const db = new DatabaseSync(join(root.state, 'state.sqlite'), { readOnly: true })
        try { return Number(db.prepare("select value from schema_meta where key='product_schema'").get()?.value ?? 0) } finally { db.close() }
      } catch { return null }
    })()
    evidence.installedSchema = schema
    const project = configuration.projects.find(item => item.dispatchAllowed)
    if (!project) throw new Error('no dispatchable fixture project')
    const criteria = (project.defaultCriteria ?? []).filter(item => item.required)

    // Work A: answer every question, then accept, so it has a delivered phase and real artifacts.
    const created = await seedClient.dispatch({ commandId: 'w34-rec-work', conversationId: 'conv-w34-rec', kind: 'create_work',
      projectId: project.id, profileId: project.profileIds?.[0] ?? project.defaultProfileId,
      goal: '第三十四轮非空业务恢复受控交付。', scope: project.scope, criteria })
    const workId = created.receipt?.workId ?? created.workId
    let view
    for (let index = 0; index < 220; index += 1) {
      view = await seedClient.work(workId)
      if (view.actions.available.includes('accept_candidate') || ['delivered', 'ended', 'uncertain'].includes(view.phase)) break
      if ((view.openQuestionIds ?? []).length > 0) {
        const snapshot = await seedClient.snapshot({ workId })
        const question = (snapshot.questions ?? [])[0]
        const choice = question?.presentation?.options?.[0]?.id
        if (question && choice) await seedClient.dispatch({ commandId: `w34-rec-answer-${index}`, conversationId: 'conv-w34-rec',
          kind: 'answer_question', questionId: question.id, expectedVersion: question.version, answer: { kind: 'choices', optionIds: [choice] } })
      }
      await new Promise(resolvePromise => setTimeout(resolvePromise, 130))
    }
    const accepted = view?.actions?.available?.includes('accept_candidate')
      ? await seedClient.dispatch({ commandId: 'w34-rec-accept', conversationId: 'conv-w34-rec', kind: 'accept_candidate', candidate: view.actions.currentCandidate })
      : null
    for (let index = 0; index < 160 && accepted; index += 1) {
      const latest = await seedClient.work(workId)
      if (['delivered', 'ended'].includes(latest.phase)) { view = latest; break }
      await new Promise(resolvePromise => setTimeout(resolvePromise, 130))
    }
    const artifactIds = view?.artifactIds ?? []
    const artifacts = []
    for (const id of artifactIds) {
      const value = await seedClient.artifact(id)
      artifacts.push({ id, sha256: value.sha256, bytes: value.bytes.byteLength })
    }
    const page = await seedClient.conversation('conv-w34-rec')
    const messageShape = (page?.messages ?? []).map(item => ({ role: item.role ?? null, provenance: item.provenance ?? null,
      text: String(item.text ?? '').slice(0, 60) }))
    // Work B: leave a required question open so the restored root proves a real pending queue is held.
    const pendingCreated = await seedClient.dispatch({ commandId: 'w34-rec-pending', conversationId: 'conv-w34-pending', kind: 'create_work',
      projectId: project.id, profileId: project.profileIds?.[0] ?? project.defaultProfileId,
      goal: '第三十四轮待回答业务。', scope: project.scope, criteria })
    const pendingWorkId = pendingCreated.receipt?.workId ?? pendingCreated.workId
    let pendingView = null
    for (let index = 0; index < 120; index += 1) {
      pendingView = await seedClient.work(pendingWorkId)
      if ((pendingView.openQuestionIds ?? []).length > 0) break
      await new Promise(resolvePromise => setTimeout(resolvePromise, 120))
    }
    const pendingSnapshot = await seedClient.snapshot({ workId: pendingWorkId })
    const pendingQuestion = (pendingSnapshot.questions ?? [])[0] ?? null
    evidence.seed = { workId, phase: view?.phase ?? null, receipt: created.receipt?.status ?? null,
      accepted: accepted?.receipt?.status ?? null, artifactIds: artifactIds.length, artifacts,
      messages: page?.messages?.length ?? 0, messageShape, providerRequests: mock.requests.length }
    evidence.pending = { workId: pendingWorkId, receipt: pendingCreated.receipt?.status ?? null,
      phase: pendingView?.phase ?? null, openQuestionIds: pendingView?.openQuestionIds ?? [],
      recordedQuestions: (pendingSnapshot.questions ?? []).map(item => item.id),
      question: pendingQuestion ? { id: pendingQuestion.id, version: pendingQuestion.version } : null }
    if (!artifacts.length) throw new Error('seed produced no artifact bytes')
    if (!pendingQuestion) throw new Error('seed produced no pending question')

    const seedState = root.state
    const seedSet = capture('seed', root.config, seedState)
    const stopSeed = await stopOwned(root, { mockFile: mock.file, birth: seeded.birth })
    evidence.resources.seed = { before: seedSet, after: rollout(seedSet), stop: { clean: stopSeed.clean,
      package: stopSeed.packageStop?.json?.status ?? null, reason: stopSeed.reason ?? null } }
    if (stopSeed.clean !== true) throw new Error(`seed stop not clean: ${stopSeed.reason}`)
    const requestsAfterSeed = mock.requests.length
    const countsBefore = dbCounts(join(seedState, 'state.sqlite'))

    mark('backup + verify')
    const bundle = join(root.own, 'w34-cohort.pab')
    const backup = launcher(install, ['backup', '--out', bundle, '--json'],
      { env: { PA_CONFIG_ROOT: root.config, PA_DATA_ROOT: seedState, PA_MODEL_CONFIG: mock.file }, timeoutMs: 120_000 })
    const verify = launcher(install, ['verify-backup', '--bundle', bundle, '--json'],
      { env: { PA_CONFIG_ROOT: root.config, PA_MODEL_CONFIG: mock.file }, timeoutMs: 120_000 })
    evidence.backup = { status: backup.json?.status ?? null, verify: verify.json?.status ?? null,
      counts: backup.json?.counts ?? null, sha256: backup.json?.archiveSha256 ?? null,
      bytes: existsSync(bundle) ? statSync(bundle).size : null, database: backup.json?.database ?? null }
    if (backup.json?.status !== 'CREATED' || verify.json?.status !== 'VERIFIED')
      throw new Error(`backup/verify ${backup.json?.status ?? backup.status}/${verify.json?.status ?? verify.status}: ${backup.stderr}`)

    // Negative: a same-size content mutation must never verify.
    const tampered = join(root.own, 'w34-cohort-tampered.pab')
    copyFileSync(bundle, tampered)
    const bytes = readFileSync(tampered)
    bytes[bytes.byteLength - 64] = bytes[bytes.byteLength - 64] ^ 0xff
    writeFileSync(tampered, bytes)
    const badVerify = launcher(install, ['verify-backup', '--bundle', tampered, '--json'],
      { env: { PA_CONFIG_ROOT: root.config, PA_MODEL_CONFIG: mock.file }, timeoutMs: 120_000 })
    evidence.negatives.tamperedBundle = { status: badVerify.status, result: badVerify.json?.status ?? null, code: badVerify.json?.code ?? null }

    mark('restore')
    const restoredState = join(root.own, 'restored')
    mkdirSync(restoredState, { recursive: true, mode: 0o700 })
    const restore = launcher(install, ['restore', '--bundle', bundle, '--to', restoredState, '--json'],
      { env: { PA_CONFIG_ROOT: root.config, PA_DATA_ROOT: seedState, PA_MODEL_CONFIG: mock.file }, timeoutMs: 120_000 })
    const marker = join(restoredState, 'restore-report.json')
    const recovery = launcher(install, ['recovery-status', '--json'], { env: { PA_CONFIG_ROOT: root.config, PA_DATA_ROOT: restoredState } })
    evidence.restore = { status: restore.json?.status ?? null, exit: restore.status, marker: existsSync(marker),
      recovery: { markerPresent: recovery.json?.markerPresent ?? null, startupMode: recovery.json?.startupMode ?? null,
        authorization: recovery.json?.authorization?.status ?? null },
      counts: dbCounts(join(restoredState, 'state.sqlite')) }
    if (restore.json?.status !== 'RESTORED') throw new Error(`restore ${restore.json?.status ?? restore.status}: ${restore.stderr}`)

    evidence.directRead = await directStoreRead(install, join(restoredState, 'state.sqlite'), root.own).catch(error => ({ available: false, reason: String(error?.message ?? error) }))

    mark('recovery-readonly read-back')
    const restoredRoot = { own: root.own, install, config: root.config, state: restoredState }
    const phaseRead = await startPhase(restoredRoot, { mockFile: mock.file, extraArgs: ['--discussion-only'] })
    const readied = phaseRead?.started
    trackBirth('readonly', readied.birth)
    const readValue = await readied.value
    if (readValue.status !== 'RUNNING') throw new Error(`readonly start ${readValue.status}/${readValue.code ?? 'none'}: ${readValue.stderr ?? ''}`)
    const client = new LocalProductClient({ baseURL: readValue.instance.apiURL, stateDir: restoredState, timeoutMs: 25_000 })
    await waitRunning(client)
    const restoredPage = await client.conversation('conv-w34-rec')
    const restoredWork = await client.work(workId)
    const restoredArtifacts = []
    for (const id of restoredWork.artifactIds ?? []) {
      const value = await client.artifact(id)
      restoredArtifacts.push({ id, sha256: value.sha256, bytes: value.bytes.byteLength })
    }
    const pendingWork = await client.work(pendingWorkId).catch(() => null)
    const pendingRestored = pendingWork ? await client.snapshot({ workId: pendingWorkId }).catch(() => null) : null
    const unauthorized = await client.request(`/v1/works/${encodeURIComponent(workId)}`, { authenticated: false })
      .catch(error => ({ status: error.status, body: error.body }))
    const wrongToken = await client.request(`/v1/works/${encodeURIComponent(workId)}`, { authenticated: false,
      headers: { authorization: 'Bearer 0000000000000000000000000000000000000000' } })
      .catch(error => ({ status: error.status, body: error.body }))
    const answerAttempt = await client.dispatch({ commandId: `w34-rec-answer-readonly-${Date.now()}`, conversationId: 'conv-w34-pending',
      kind: 'answer_question', questionId: pendingQuestion.id, expectedVersion: pendingQuestion.version,
      answer: { kind: 'choices', optionIds: [pendingQuestion.presentation?.options?.[0]?.id ?? 'option-1'] } })
      .catch(error => ({ status: error.status, error: error.body }))
    const blockedChat = await client.request('/v1/conversations/commands', { method: 'POST', body: {
      commandId: `w34-rec-readonly-${Date.now()}`, conversationId: 'conv-w34-rec', kind: 'chat', text: '恢复只读期间不得执行。' } })
      .catch(error => ({ status: error.status, body: error.body }))
    const requestsAfterReads = mock.requests.length
    const readSet = capture('readonly', root.config, restoredState)
    const stopRead = await stopOwned(restoredRoot, { mockFile: mock.file, birth: readied.birth })
    const countsAfter = dbCounts(join(restoredState, 'state.sqlite'))
    const readonly = { startupMode: readValue.instance.startupMode ?? null, status: readValue.status,
      work: { phase: restoredWork?.phase ?? null, artifactIds: restoredWork?.artifactIds ?? [],
        artifactsEqual: JSON.stringify(restoredWork?.artifactIds ?? []) === JSON.stringify(artifactIds) },
      artifactsEqual: JSON.stringify(restoredArtifacts) === JSON.stringify(artifacts),
      artifacts: restoredArtifacts, messages: restoredPage?.messages?.length ?? 0,
      messageShape: (restoredPage?.messages ?? []).map(item => ({ role: item.role ?? null, provenance: item.provenance ?? null,
        text: String(item.text ?? '').slice(0, 60) })),
      goalVisible: (restoredPage?.messages ?? []).some(item => String(item.text ?? '').startsWith('第三十四轮非空业务恢复受控交付。')),
      // A clean stop withdraws open questions in this product; the restored root must still hold the
      // Work, its recorded question rows and the same effect rows, and must accept no answer.
      pending: { workId: pendingWorkId, found: pendingWork !== null, phase: pendingWork?.phase ?? null,
        openQuestionIds: pendingWork?.openQuestionIds ?? [], questions: (pendingRestored?.questions ?? []).map(item => item.id),
        recordedBeforeStop: evidence.pending.recordedQuestions,
        questionsRecorded: dbCounts(join(restoredState, 'state.sqlite'))?.questions ?? null,
        held: JSON.stringify(countsBefore?.effect) === JSON.stringify(dbCounts(join(restoredState, 'state.sqlite'))?.effect) },
      // The product binds reads to loopback: a header-less GET is served (documented policy), while a
      // present-but-wrong bearer must be refused.
      unauthorized: { status: unauthorized.status }, wrongToken: { status: wrongToken.status },
      answer: { status: answerAttempt.status ?? null, code: answerAttempt.error?.error?.code ?? answerAttempt.error?.code ?? null },
      business: { status: blockedChat.status, code: blockedChat.body?.error?.code ?? blockedChat.body?.code ?? null },
      providerRequests: { afterSeed: requestsAfterSeed, afterReads: requestsAfterReads },
      counts: { before: countsBefore, after: countsAfter },
      stop: { clean: stopRead.clean, package: stopRead.packageStop?.json?.status ?? null, reason: stopRead.reason ?? null } }
    evidence.readonly = readonly
    evidence.resources.readonly = { before: readSet, after: rollout(readSet) }
    if (stopRead.clean !== true) throw new Error(`readonly stop not clean: ${stopRead.reason}`)

    mark('negatives on restored root')
    const fixtureOnRestored = await startPhase(restoredRoot, { mockFile: mock.file, fixture: true, extraArgs: [] }, 1)
    const fixtureValue = await fixtureOnRestored?.started?.value ?? { status: 'NO_START' }
    if (fixtureOnRestored?.started) trackBirth('fixture-on-restored', fixtureOnRestored.started.birth)
    const fixtureSet = capture('fixture-on-restored', root.config, restoredState)
    evidence.negatives.fixtureOnRestored = { status: fixtureValue.status, code: fixtureValue.code ?? null,
      startupMode: fixtureValue.instance?.startupMode ?? null, stderr: String(fixtureValue.stderr ?? '').slice(-200) }
    if (fixtureValue.status === 'RUNNING') {
      const fixtureClient = new LocalProductClient({ baseURL: fixtureValue.instance.apiURL, stateDir: restoredState, timeoutMs: 20_000 })
      const write = await fixtureClient.request('/v1/conversations/commands', { method: 'POST', body: {
        commandId: `w34-rec-fixture-${Date.now()}`, conversationId: 'conv-w34-rec', kind: 'chat', text: '不得执行。' } })
        .catch(error => ({ status: error.status }))
      evidence.negatives.fixtureOnRestored.business = write.status
      const stopped = await stopOwned(restoredRoot, { mockFile: mock.file, birth: fixtureOnRestored.started.birth })
      evidence.negatives.fixtureOnRestored.resources = { before: fixtureSet, after: rollout(fixtureSet) }
      evidence.negatives.fixtureOnRestored.stop = { clean: stopped.clean, reason: stopped.reason ?? null }
    }
  } catch (error) {
    failure = String(error?.message ?? error).slice(0, 600)
    operation.fail('case', error)
    operation.retain(`case_error:${failure}`)
  }

  // One teardown: prove the complete set exited, then release the whole material set; otherwise retain.
  let teardown = null
  try { teardown = await stopOwned(root, { mockFile: mock?.file, equivalentProof: true }) } catch (error) { teardown = { clean: false, reason: String(error?.message ?? error) } }
  if (teardown?.clean !== true) operation.retain(`teardown:${teardown?.reason ?? 'unknown'}`)
  const observation = operation.observe()
  const verdict = operation.releaseAllowed(observation)
  if (failure === null && verdict.allowed === true) {
    const released = operation.release({ observation })
    evidence.operation = { verdict, released: released.released, retained: [], observation, signals: operation.signals }
  } else {
    operation.retain(failure ?? verdict.reason ?? 'unknown')
    const kept = operation.retainAll(failure ?? verdict.reason ?? 'unknown')
    evidence.operation = { verdict, released: [], retained: kept.retained, reason: kept.reason, observation,
      signals: operation.signals, failures: operation.failures }
    if (process.env.PA_E_TRACE) process.stderr.write(`[w34rec] retained ${JSON.stringify(kept.retained)} reason=${kept.reason}\n`)
  }
  await mock?.close?.().catch(() => {})

  cases.push(await runCase({ id: 'E33-COHORT-RECOVERY',
    title: 'The locked W33 cohort seeds an accepted Work with every artifact and a held question, backs up, restores and reads the same business facts recovery-readonly',
    layer: LAYERS.INSTALLED, evidence: { cohortRecovery: evidence }, limitations: [
      'The installation is the frozen W33 tar (f880/ee45) extracted privately and started with the frozen CLI; no other build is substituted.',
      'The controlled delivery uses the loopback candidate mock; no vendor model or native run is claimed.',
      'The restored root is read-only business data: it never inherits executable authority, its pending queue is held and no answer is accepted.',
    ] }, async ({ assert, evidence: ev }) => {
    assert('RECOVERY_PROVISIONED', failure === null, failure ?? 'no failure')
    assert('RECOVERY_SUBJECT', evidence.subject?.buildId === target.buildId && evidence.subject?.tarSha256 === target.tarSha256 &&
      evidence.artifact.installManifestSha256 === target.installManifestSha256, JSON.stringify(evidence.artifact))
    assert('RECOVERY_SCHEMA', (evidence.installedSchema ?? 0) > 0 && evidence.subject.schema === evidence.installedSchema,
      JSON.stringify({ installed: evidence.installedSchema, subject: evidence.subject?.schema }))
    assert('RECOVERY_SEED_DELIVERED', evidence.seed?.phase === 'delivered' && evidence.seed?.accepted === 'recorded' &&
      (evidence.seed?.artifactIds ?? 0) >= 1, JSON.stringify({ phase: evidence.seed?.phase, accepted: evidence.seed?.accepted, artifacts: evidence.seed?.artifactIds }))
    assert('RECOVERY_ALL_ARTIFACT_BYTES', evidence.seed?.artifacts?.length === evidence.seed?.artifactIds &&
      evidence.seed.artifacts.every(item => /^[a-f0-9]{64}$/u.test(item.sha256) && item.bytes > 0), JSON.stringify({ count: evidence.seed?.artifacts?.length, ids: evidence.seed?.artifactIds }))
    assert('RECOVERY_PENDING_SEEDED', evidence.pending?.question !== null && (evidence.pending?.openQuestionIds?.length ?? 0) >= 1,
      JSON.stringify(evidence.pending))
    assert('RECOVERY_BACKUP_NONEMPTY', evidence.backup?.status === 'CREATED' && evidence.backup?.verify === 'VERIFIED' &&
      (evidence.backup?.counts?.artifacts ?? 0) >= 1 && (evidence.backup?.database?.eventSeq ?? 0) >= 1 &&
      (evidence.restore?.counts?.works ?? 0) >= 2 && (evidence.restore?.counts?.artifacts ?? 0) >= (evidence.seed?.artifacts?.length ?? 1) &&
      (evidence.restore?.counts?.questions ?? 0) >= 1 && (evidence.restore?.counts?.messages ?? 0) >= 1,
      JSON.stringify({ backup: evidence.backup, restored: evidence.restore?.counts }))
    assert('RECOVERY_TAMPERED_REFUSED', evidence.negatives?.tamperedBundle?.result !== 'VERIFIED', JSON.stringify(evidence.negatives?.tamperedBundle))
    assert('RECOVERY_RESTORED', evidence.restore?.status === 'RESTORED' && evidence.restore?.marker === true, JSON.stringify(evidence.restore))
    assert('RECOVERY_AUTH_BLOCKED', evidence.restore?.recovery?.markerPresent === true &&
      evidence.restore?.recovery?.startupMode === 'recovery_readonly' && evidence.restore?.recovery?.authorization === 'BLOCKED',
      JSON.stringify(evidence.restore?.recovery))
    const readonly = evidence.readonly ?? {}
    assert('RECOVERY_READONLY_WORK', readonly.startupMode === 'recovery_readonly' && readonly.work?.phase === 'delivered' &&
      readonly.work?.artifactsEqual === true, JSON.stringify(readonly.work))
    assert('RECOVERY_ARTIFACT_BYTES', readonly.artifactsEqual === true &&
      JSON.stringify(readonly.artifacts) === JSON.stringify(evidence.seed?.artifacts), JSON.stringify({ equal: readonly.artifactsEqual, restored: readonly.artifacts?.length }))
    assert('RECOVERY_HISTORY_READABLE', readonly.messages === evidence.seed?.messages && readonly.goalVisible === true &&
      JSON.stringify(readonly.messageShape) === JSON.stringify(evidence.seed?.messageShape),
      JSON.stringify({ messages: readonly.messages, seed: evidence.seed?.messages, goal: readonly.goalVisible }))
    assert('RECOVERY_PENDING_RECORDED', readonly.pending?.found === true && (readonly.pending?.recordedBeforeStop?.length ?? 0) >= 1 &&
      (readonly.pending?.questionsRecorded ?? 0) >= 1 && readonly.pending?.held === true && readonly.answer?.status === 422,
      JSON.stringify({ pending: readonly.pending, answer: readonly.answer }))
    assert('RECOVERY_QUEUE_HELD', JSON.stringify(readonly.counts?.before?.effect) === JSON.stringify(readonly.counts?.after?.effect) &&
      readonly.counts?.before?.questions === readonly.counts?.after?.questions &&
      readonly.counts?.before?.answers === readonly.counts?.after?.answers,
      JSON.stringify({ before: readonly.counts?.before, after: readonly.counts?.after }))
    assert('RECOVERY_DIRECT_STORE', evidence.directRead?.available === true &&
      (evidence.directRead.registry ?? []).length >= (evidence.seed?.artifacts?.length ?? 1) &&
      evidence.seed.artifacts.every(item => evidence.directRead.registry.some(row => row.id === item.id && row.digest === item.sha256 && row.bytes === item.bytes)),
      JSON.stringify({ available: evidence.directRead?.available, registry: evidence.directRead?.registry?.length, reason: evidence.directRead?.reason }))
    assert('RECOVERY_UNAUTHORIZED_READ', [401, 403].includes(readonly.unauthorized?.status) ||
      ([401, 403].includes(readonly.wrongToken?.status) && readonly.unauthorized?.status === 200),
      JSON.stringify({ unauthorized: readonly.unauthorized, wrongToken: readonly.wrongToken }))
    assert('RECOVERY_BUSINESS_422', readonly.business?.status === 422, JSON.stringify(readonly.business))
    assert('RECOVERY_NO_PROVIDER', readonly.providerRequests?.afterSeed === readonly.providerRequests?.afterReads,
      JSON.stringify(readonly.providerRequests))
    assert('RECOVERY_EXECUTION_REFUSED', evidence.negatives?.fixtureOnRestored?.status !== 'RUNNING' ||
      evidence.negatives?.fixtureOnRestored?.business === 422, JSON.stringify(evidence.negatives?.fixtureOnRestored))
    assert('RECOVERY_STOP_COMPLETE', evidence.resources?.seed?.stop?.clean === true && readonly.stop?.clean === true &&
      evidence.resources?.seed?.after?.every(item => item.alive === false || item.sameIdentity === false) &&
      evidence.resources?.readonly?.after?.every(item => item.alive === false || item.sameIdentity === false),
      JSON.stringify({ seed: evidence.resources?.seed?.stop, readonly: readonly.stop }))
    assert('RECOVERY_OPERATION_RELEASED', evidence.operation?.verdict?.allowed === true && evidence.operation.released.length === 1 &&
      evidence.operation.signals.length === 0 && evidence.operation.retained.length === 0,
      JSON.stringify({ verdict: evidence.operation?.verdict, retained: evidence.operation?.retained, signals: evidence.operation?.signals?.length }))
    ev.cohortRecovery = evidence
  }))

  return { cases, artifacts: {} }
}
