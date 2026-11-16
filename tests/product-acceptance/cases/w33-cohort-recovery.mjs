import { DatabaseSync } from 'node:sqlite'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { runCase, LAYERS } from '../lib/status.mjs'
import { LocalProductClient } from '../lib/http-client.mjs'
import { candidateModel } from '../../../tests/integration/fixtures/assistant-candidate-model.mjs'
import { extractOuterZip, privateHome, sha256, verifyOuterZip } from '../lib/outer-zip.mjs'
import { freePort, launcher, liveIdentity, privateRoot, readRecord, releaseRoot, retainMaterial, startOwned, stopOwned } from '../lib/packaged-instance.mjs'

/**
 * Wave-33 non-empty business recovery on the accurate cohort.
 *
 * The installation is the inner package of the one shareable outer ZIP (verified by its own hashes),
 * driven with its bundled Node. A controlled fixture delivery seeds a Work with artifacts and reply
 * history; the state is backed up, restored into a new private root, started recovery-readonly, and
 * the same business facts (phase, artifact ids and artifact bytes, reply text, queue rows) must be
 * read back while every business write is refused and no model request occurs. Negatives cover a
 * tampered bundle verification and starting the restored root in an execution mode.
 */
const mark = message => { if (process.env.PA_E_TRACE) process.stderr.write(`[w33rec] ${message}\n`) }

const recordPids = config => {
  const record = readRecord(config).value ?? null
  if (!record) return []
  return [...new Set([record.pid, record.apiPid, record.consolePid])].filter(Number.isSafeInteger)
    .map(pid => { const identity = liveIdentity(pid)
      return { pid, start: identity.start, uid: identity.uid, parentPid: pid === record.pid ? null : record.pid } })
}
const observe = set => set.map(item => { const identity = liveIdentity(item.pid)
  return { pid: item.pid, expectedStart: item.start, alive: identity.alive, sameIdentity: identity.alive && identity.start === item.start } })

function dbCounts(path) {
  if (!existsSync(path)) return null
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    const count = table => { try { return Number(db.prepare(`SELECT count(*) AS c FROM ${table}`).get()?.c ?? 0) } catch { return null } }
    return { works: count('works'), artifacts: count('artifacts'), messages: count('conversation_messages'),
      effect: (() => { try { return db.prepare('SELECT * FROM effect ORDER BY rowid').all().map(row => ({ ...row })) } catch { return [] } })() }
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
    await stopOwned(root, { mockFile: options.mockFile, birth: started.birth, equivalentProof: true, nodePath: options.nodePath }).catch(() => {})
  }
  return last
}

export async function runCohortRecovery() {
  const cases = []
  const evidence = { subject: null, zip: null, install: null, seed: null, delivery: null, backup: null, restore: null,
    readonly: null, negatives: {}, resources: {} }
  const root = privateRoot('pa-e-w33-recovery-')
  const home = privateHome('pa-e-w33-rechome-')
  let mock = null, failure = null, install = null, nodePath = null

  const stopNode = (rootValue, options) => stopOwned(rootValue, { ...options, nodePath })

  try {
    mark('verify + extract outer ZIP')
    const zip = verifyOuterZip()
    const extracted = extractOuterZip(zip, home)
    install = extracted.install
    nodePath = extracted.nodePath
    root.install = install
    const result = zip.result
    evidence.zip = { sha256: zip.sha256, bytes: zip.bytes, sumsMatch: zip.sumsMatch, resultMatch: zip.resultMatch,
      buildId: result?.inner?.buildId ?? null, source: result?.inner?.source ?? null,
      innerTarSha256: result?.inner?.tarSha256 ?? null, innerTarBytes: result?.inner?.tarBytes ?? null,
      digestsMatch: extracted.digests.installManifest === result?.inner?.installManifestSha256 &&
        extracted.digests.runtime === result?.runtime?.sha256 && extracted.digests.license === result?.runtime?.licenseSha256,
      manifestProtocol: extracted.manifest.protocol,
      runtime: { version: extracted.manifest.runtime?.version ?? null, abi: extracted.manifest.runtime?.abi ?? null,
        platform: extracted.manifest.runtime?.platform ?? null, arch: extracted.manifest.runtime?.arch ?? null,
        sha256: extracted.manifest.runtime?.sha256 ?? null, licenseSha256: extracted.manifest.runtime?.licenseSha256 ?? null } }
    const tarSha = result?.inner?.tarSha256 ?? null
    evidence.install = { buildId: extracted.manifest?.inner?.buildId ?? null, source: extracted.manifest?.inner?.source ?? null,
      tarSha256: tarSha, tarBytes: result?.inner?.tarBytes ?? null, schema: extracted.manifest?.inner?.schema ?? null,
      platform: extracted.manifest?.inner?.platform ?? null, arch: extracted.manifest?.inner?.arch ?? null,
      abi: extracted.manifest?.inner?.abi ?? null, nodeVersion: extracted.manifest?.runtime?.version ?? result?.runtime?.version ?? null }

    const first = launcher(install, ['first-run', '--json'], { env: { PA_CONFIG_ROOT: root.config, PA_DATA_ROOT: root.state }, nodePath })
    if (first.status !== 0) throw new Error(`first-run ${first.status}: ${first.stderr}`)
    const schema = (() => {
      try {
        const db = new DatabaseSync(join(root.state, 'state.sqlite'), { readOnly: true })
        try { return Number(db.prepare("select value from schema_meta where key='product_schema'").get()?.value ?? 0) } finally { db.close() }
      } catch { return null }
    })()
    evidence.subject = { source: evidence.zip.source, buildId: evidence.zip.buildId, schema,
      tarSha256: evidence.zip.innerTarSha256, tarBytes: evidence.zip.innerTarBytes,
      platform: evidence.zip.runtime?.platform ?? null, arch: evidence.zip.runtime?.arch ?? null, abi: evidence.zip.runtime?.abi ?? null }

    mock = await candidateModel()
    mark('seed fixture delivery')
    const phaseSeed = await startPhase(root, { mockFile: mock.file, fixture: true, extraArgs: [], nodePath })
    const seeded = phaseSeed?.started
    const seedValue = await seeded.value
    if (seedValue.status !== 'RUNNING') throw new Error(`seed start ${seedValue.status}/${seedValue.code ?? 'none'}: ${seedValue.stderr ?? ''}`)
    const seedClient = new LocalProductClient({ baseURL: seedValue.instance.apiURL, stateDir: seedValue.instance.state, timeoutMs: 25_000 })
    await waitRunning(seedClient)
    const configuration = await seedClient.configuration()
    const project = configuration.projects.find(item => item.dispatchAllowed)
    if (!project) throw new Error('no dispatchable fixture project')
    const created = await seedClient.dispatch({ commandId: 'w33-rec-work', conversationId: 'conv-w33-rec', kind: 'create_work',
      projectId: project.id, profileId: project.profileIds?.[0] ?? project.defaultProfileId,
      goal: '第三十三轮非空业务恢复受控交付。', scope: project.scope,
      criteria: (project.defaultCriteria ?? []).filter(item => item.required) })
    const workId = created.receipt?.workId ?? created.workId
    let view
    for (let index = 0; index < 220; index += 1) {
      view = await seedClient.work(workId)
      if (view.actions.available.includes('accept_candidate') || ['delivered', 'ended', 'uncertain'].includes(view.phase)) break
      if ((view.openQuestionIds ?? []).length > 0) {
        const snapshot = await seedClient.snapshot({ workId })
        const question = (snapshot.questions ?? [])[0]
        const choice = question?.presentation?.options?.[0]?.id
        if (question && choice) await seedClient.dispatch({ commandId: `w33-rec-answer-${index}`, conversationId: 'conv-w33-rec',
          kind: 'answer_question', questionId: question.id, expectedVersion: question.version, answer: { kind: 'choices', optionIds: [choice] } })
      }
      await new Promise(resolvePromise => setTimeout(resolvePromise, 130))
    }
    const accepted = view?.actions?.available?.includes('accept_candidate')
      ? await seedClient.dispatch({ commandId: 'w33-rec-accept', conversationId: 'conv-w33-rec', kind: 'accept_candidate', candidate: view.actions.currentCandidate })
      : null
    for (let index = 0; index < 160 && accepted; index += 1) {
      const latest = await seedClient.work(workId)
      if (['delivered', 'ended'].includes(latest.phase)) { view = latest; break }
      await new Promise(resolvePromise => setTimeout(resolvePromise, 130))
    }
    const artifactIds = view?.artifactIds ?? []
    const artifacts = []
    for (const id of artifactIds.slice(0, 3)) {
      const value = await seedClient.artifact(id)
      artifacts.push({ id, sha256: value.sha256, bytes: value.bytes.byteLength })
    }
    const page = await seedClient.conversation('conv-w33-rec')
    const seedState = root.state
    const messageShape = (page?.messages ?? []).map(item => ({ role: item.role ?? null, provenance: item.provenance ?? null,
      text: String(item.text ?? '').slice(0, 40) }))
    evidence.seed = { workId, phase: view?.phase ?? null, receipt: created.receipt?.status ?? null,
      accepted: accepted?.receipt?.status ?? null, artifacts, messages: page?.messages?.length ?? 0, messageShape,
      goalEqual: view?.goal === '第三十三轮非空业务恢复受控交付。' || page?.messages?.some(item => item.role === 'user') === true,
      providerRequests: mock.requests.length }
    if (!artifacts.length) throw new Error('seed produced no artifact bytes')
    const before = recordPids(root.config)
    const stopSeed = await stopNode(root, { mockFile: mock.file, birth: seeded.birth })
    evidence.resources.seed = { before, after: observe(before), stop: { clean: stopSeed.clean, package: stopSeed.packageStop?.json?.status ?? null, reason: stopSeed.reason ?? null } }
    if (stopSeed.clean !== true) throw new Error(`seed stop not clean: ${stopSeed.reason}`)
    const requestsAfterSeed = mock.requests.length

    mark('backup + verify')
    const bundle = join(root.own, 'w33-cohort.pab')
    const backup = launcher(install, ['backup', '--out', bundle, '--json'],
      { env: { PA_CONFIG_ROOT: root.config, PA_DATA_ROOT: seedState, PA_MODEL_CONFIG: mock.file }, nodePath, timeoutMs: 120_000 })
    const verify = launcher(install, ['verify-backup', '--bundle', bundle, '--json'],
      { env: { PA_CONFIG_ROOT: root.config, PA_MODEL_CONFIG: mock.file }, nodePath, timeoutMs: 120_000 })
    evidence.backup = { status: backup.json?.status ?? null, verify: verify.json?.status ?? null,
      counts: backup.json?.counts ?? null, sha256: backup.json?.archiveSha256 ?? null,
      bytes: existsSync(bundle) ? statSync(bundle).size : null, database: backup.json?.database ?? null }
    if (backup.json?.status !== 'CREATED' || verify.json?.status !== 'VERIFIED')
      throw new Error(`backup/verify ${backup.json?.status ?? backup.status}/${verify.json?.status ?? verify.status}: ${backup.stderr}`)

    // Negative: a tampered bundle must never verify.
    const tampered = join(root.own, 'w33-cohort-tampered.pab')
    copyFileSync(bundle, tampered)
    const bytes = readFileSync(tampered)
    bytes[bytes.byteLength - 64] = bytes[bytes.byteLength - 64] ^ 0xff
    const { writeFileSync } = await import('node:fs')
    writeFileSync(tampered, bytes)
    const badVerify = launcher(install, ['verify-backup', '--bundle', tampered, '--json'],
      { env: { PA_CONFIG_ROOT: root.config, PA_MODEL_CONFIG: mock.file }, nodePath, timeoutMs: 120_000 })
    evidence.negatives.tamperedBundle = { status: badVerify.status, result: badVerify.json?.status ?? null, code: badVerify.json?.code ?? null }

    mark('restore')
    const restoredState = join(root.own, 'restored')
    mkdirSync(restoredState, { recursive: true, mode: 0o700 })
    const restore = launcher(install, ['restore', '--bundle', bundle, '--to', restoredState, '--json'],
      { env: { PA_CONFIG_ROOT: root.config, PA_DATA_ROOT: seedState, PA_MODEL_CONFIG: mock.file }, nodePath, timeoutMs: 120_000 })
    const marker = join(restoredState, 'restore-report.json')
    const recovery = launcher(install, ['recovery-status', '--json'], { env: { PA_CONFIG_ROOT: root.config, PA_DATA_ROOT: restoredState }, nodePath })
    evidence.restore = { status: restore.json?.status ?? null, exit: restore.status, marker: existsSync(marker),
      recovery: { markerPresent: recovery.json?.markerPresent ?? null, startupMode: recovery.json?.startupMode ?? null,
        authorization: recovery.json?.authorization?.status ?? null },
      counts: dbCounts(join(restoredState, 'state.sqlite')) }
    if (restore.json?.status !== 'RESTORED') throw new Error(`restore ${restore.json?.status ?? restore.status}: ${restore.stderr}`)

    mark('recovery-readonly read-back')
    const restoredRoot = { own: root.own, install, config: root.config, state: restoredState }
    const phaseRead = await startPhase(restoredRoot, { mockFile: mock.file, extraArgs: ['--discussion-only'], nodePath })
    const readied = phaseRead?.started
    const readValue = await readied.value
    if (readValue.status !== 'RUNNING') throw new Error(`readonly start ${readValue.status}/${readValue.code ?? 'none'}: ${readValue.stderr ?? ''}`)
    const client = new LocalProductClient({ baseURL: readValue.instance.apiURL, stateDir: restoredState, timeoutMs: 25_000 })
    await waitRunning(client)
    const restoredPage = await client.conversation('conv-w33-rec')
    const restoredWork = await client.work(workId)
    const restoredArtifacts = []
    for (const item of (restoredWork.artifactIds ?? []).slice(0, 3)) {
      const value = await client.artifact(item)
      restoredArtifacts.push({ id: item, sha256: value.sha256, bytes: value.bytes.byteLength })
    }
    const blockedChat = await client.request('/v1/conversations/commands', { method: 'POST', body: {
      commandId: `w33-rec-readonly-${Date.now()}`, conversationId: 'conv-w33-rec', kind: 'chat', text: '恢复只读期间不得执行。' } })
      .catch(error => ({ status: error.status, body: error.body }))
    const requestsAfterReads = mock.requests.length
    const beforeReadStop = recordPids(root.config)
    const stopRead = await stopNode(restoredRoot, { mockFile: mock.file, birth: readied.birth })
    evidence.readonly = { startupMode: readValue.instance.startupMode ?? null, status: readValue.status,
      work: { phase: restoredWork?.phase ?? null, artifacts: restoredWork?.artifactIds?.length ?? null,
        artifactsEqual: JSON.stringify(restoredWork?.artifactIds ?? []) === JSON.stringify(artifactIds) },
      artifactBytesEqual: JSON.stringify(restoredArtifacts) === JSON.stringify(artifacts),
      messages: restoredPage?.messages?.length ?? 0, messagesEqual: (restoredPage?.messages?.length ?? 0) === evidence.seed.messages,
      // The controlled candidate path records the user goal and the answered question, not a model
      // reply: the restored history must contain exactly those business records.
      goalVisible: (restoredPage?.messages ?? []).some(item => String(item.text ?? '').startsWith('第三十三轮非空业务恢复受控交付。')),
      messageShape: (restoredPage?.messages ?? []).map(item => ({ role: item.role ?? null, provenance: item.provenance ?? null,
        text: String(item.text ?? '').slice(0, 40) })),
      business: { status: blockedChat.status, code: blockedChat.body?.error?.code ?? blockedChat.body?.code ?? null },
      providerRequests: { afterSeed: requestsAfterSeed, afterReads: requestsAfterReads },
      stop: { clean: stopRead.clean, package: stopRead.packageStop?.json?.status ?? null, reason: stopRead.reason ?? null } }
    evidence.resources.readonly = { before: beforeReadStop, after: observe(beforeReadStop) }
    if (stopRead.clean !== true) throw new Error(`readonly stop not clean: ${stopRead.reason}`)

    // Negative: the restored root must never start in an execution (fixture) mode.
    mark('negatives on restored root')
    const fixtureOnRestored = await startPhase(restoredRoot, { mockFile: mock.file, fixture: true, extraArgs: [], nodePath }, 1)
    const fixtureValue = await fixtureOnRestored?.started?.value ?? { status: 'NO_START' }
    const fixtureSet = recordPids(root.config)
    evidence.negatives.fixtureOnRestored = { status: fixtureValue.status, code: fixtureValue.code ?? null,
      startupMode: fixtureValue.instance?.startupMode ?? null, stderr: String(fixtureValue.stderr ?? '').slice(-200) }
    if (fixtureValue.status === 'RUNNING') {
      const fixtureClient = new LocalProductClient({ baseURL: fixtureValue.instance.apiURL, stateDir: restoredState, timeoutMs: 20_000 })
      const write = await fixtureClient.request('/v1/conversations/commands', { method: 'POST', body: {
        commandId: `w33-rec-fixture-${Date.now()}`, conversationId: 'conv-w33-rec', kind: 'chat', text: '不得执行。' } })
        .catch(error => ({ status: error.status }))
      evidence.negatives.fixtureOnRestored.business = write.status
      evidence.negatives.fixtureOnRestored.resources = { before: fixtureSet, after: observe(fixtureSet) }
      const stopped = await stopNode(restoredRoot, { mockFile: mock.file, birth: fixtureOnRestored.started.birth })
      evidence.negatives.fixtureOnRestored.stop = { clean: stopped.clean, reason: stopped.reason ?? null }
    }
  } catch (error) { failure = String(error?.message ?? error).slice(0, 600) }

  const cleanup = async () => {
    const stopped = await stopOwned(root, { mockFile: mock?.file, equivalentProof: true, nodePath }).catch(cause => ({ clean: false, reason: String(cause?.message ?? cause) }))
    if (stopped.clean === true) releaseRoot(root, stopped)
    else retainMaterial(root, stopped.reason ?? 'unknown', { files: ['config/instance.json'] })
    await mock?.close?.().catch(() => {})
    try { rmSync(home, { recursive: true, force: true }) } catch { /* retained */ }
  }

  cases.push(await runCase({ id: 'E33-COHORT-RECOVERY',
    title: 'The cohort package seeds a non-empty delivered Work, backs it up, restores it into a new root and reads the same business facts recovery-readonly',
    layer: LAYERS.INSTALLED, evidence: { cohortRecovery: evidence }, limitations: [
      'The installation is the verified inner package of the outer ZIP, started with its bundled Node; no other build is substituted.',
      'The controlled delivery uses the loopback candidate mock; no vendor model or native run is claimed.',
      'The restored root is read-only business data: it never inherits executable authority, and its queue rows are held.',
    ] }, async ({ assert, evidence: ev }) => {
    assert('RECOVERY_PROVISIONED', failure === null, failure ?? 'no failure')
    assert('RECOVERY_ZIP_IDENTITY', evidence.zip?.sumsMatch === true && evidence.zip?.resultMatch === true && evidence.zip?.digestsMatch === true,
      JSON.stringify(evidence.zip))
    assert('RECOVERY_SEED_DELIVERED', evidence.seed?.phase === 'delivered' && evidence.seed?.accepted === 'recorded' &&
      (evidence.seed?.artifacts?.length ?? 0) >= 1, JSON.stringify(evidence.seed))
    assert('RECOVERY_BACKUP_NONEMPTY', evidence.backup?.status === 'CREATED' && evidence.backup?.verify === 'VERIFIED' &&
      (evidence.backup?.counts?.artifacts ?? 0) >= 1 && (evidence.backup?.counts?.entries ?? 0) >= 1 &&
      (evidence.backup?.database?.eventSeq ?? 0) >= 1 && (evidence.restore?.counts?.works ?? 0) >= 1 &&
      (evidence.restore?.counts?.artifacts ?? 0) >= 1 && (evidence.restore?.counts?.messages ?? 0) >= 1,
      JSON.stringify({ backup: evidence.backup, restored: evidence.restore?.counts }))
    assert('RECOVERY_TAMPERED_REFUSED', evidence.negatives?.tamperedBundle?.result !== 'VERIFIED',
      JSON.stringify(evidence.negatives?.tamperedBundle))
    assert('RECOVERY_RESTORED', evidence.restore?.status === 'RESTORED' && evidence.restore?.marker === true, JSON.stringify(evidence.restore))
    assert('RECOVERY_AUTH_BLOCKED', evidence.restore?.recovery?.markerPresent === true &&
      evidence.restore?.recovery?.startupMode === 'recovery_readonly' && evidence.restore?.recovery?.authorization === 'BLOCKED',
      JSON.stringify(evidence.restore?.recovery))
    const readonly = evidence.readonly ?? {}
    assert('RECOVERY_READONLY_WORK', readonly.startupMode === 'recovery_readonly' && readonly.work?.phase === 'delivered' &&
      readonly.work?.artifactsEqual === true, JSON.stringify(readonly.work))
    assert('RECOVERY_ARTIFACT_BYTES', readonly.artifactBytesEqual === true && (evidence.seed?.artifacts?.length ?? 0) >= 1,
      JSON.stringify({ restored: readonly.artifactBytesEqual, seed: evidence.seed?.artifacts?.length }))
    assert('RECOVERY_HISTORY_READABLE', readonly.messagesEqual === true && (readonly.messages ?? 0) >= 1 &&
      readonly.goalVisible === true && JSON.stringify(readonly.messageShape) === JSON.stringify(evidence.seed?.messageShape),
      JSON.stringify({ messages: readonly.messages, equal: readonly.messagesEqual, goal: readonly.goalVisible,
        seed: evidence.seed?.messageShape, restored: readonly.messageShape }))
    assert('RECOVERY_BUSINESS_422', readonly.business?.status === 422, JSON.stringify(readonly.business))
    assert('RECOVERY_NO_PROVIDER', readonly.providerRequests?.afterSeed === readonly.providerRequests?.afterReads,
      JSON.stringify(readonly.providerRequests))
    assert('RECOVERY_EXECUTION_REFUSED', evidence.negatives?.fixtureOnRestored?.status !== 'RUNNING' ||
      evidence.negatives?.fixtureOnRestored?.business === 422,
      JSON.stringify(evidence.negatives?.fixtureOnRestored))
    assert('RECOVERY_STOP_COMPLETE', evidence.resources?.seed?.stop?.clean === true && readonly.stop?.clean === true &&
      evidence.resources?.seed?.after?.every(item => item.alive === false || item.sameIdentity === false) &&
      evidence.resources?.readonly?.after?.every(item => item.alive === false || item.sameIdentity === false),
      JSON.stringify({ seed: evidence.resources?.seed?.stop, readonly: readonly.stop }))
    ev.cohortRecovery = evidence
  }))

  // Cleanup is unconditional: a failed assertion must never leave the loopback mock listening or a
  // probe-owned root behind.
  await cleanup()
  return { cases, artifacts: {} }
}
