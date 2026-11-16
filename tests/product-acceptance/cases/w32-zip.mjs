import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runCase, LAYERS } from '../lib/status.mjs'
import { LocalProductClient } from '../lib/http-client.mjs'
import { candidateModel } from '../../../tests/integration/fixtures/assistant-candidate-model.mjs'
import { extractFrozen, freePort, launcher, privateRoot, releaseRoot, retainMaterial, startOwned, stopOwned } from '../lib/packaged-instance.mjs'
import { captureSet, rollout } from '../lib/caller-safety.mjs'
import { DEFAULT_FROZEN_DIRS, frozenArtifactSubject, loadFrozenArtifact } from '../lib/frozen-package.mjs'

/**
 * Wave-32 ZIP/manifest lifecycle on the one frozen target.
 *
 * The frozen artifact is installed into a private directory (the distribution ZIP/manifest is the only
 * source), then driven through first-run, a model-unconfigured degradation, an existing configuration,
 * project import, one controlled delivery, stop, reopen and a non-empty backup+verify. Every phase
 * records its mode, readiness/discussion facts and a fixed-set stop.
 */
const mark = message => { if (process.env.PA_E_TRACE) process.stderr.write(`[w32] ${message}\n`) }

function fixedSet(config, rootValue, op) {
  const record = JSON.parse(readFileSync(join(config, 'instance.json'), 'utf8'))
  const pids = [...new Set([record.pid, record.apiPid, record.consolePid])].filter(Number.isSafeInteger)
  return captureSet(pids, { root: rootValue.install, config, state: rootValue.state, op })
}
const observe = before => rollout(before)

async function startPhase(root, options, attempts = 3) {
  let last = null
  for (let index = 0; index < attempts; index += 1) {
    const ports = [await freePort(), await freePort()]
    if (ports[0] === ports[1]) continue
    if (last) await new Promise(resolvePromise => setTimeout(resolvePromise, 500))
    const started = startOwned(root, { ports, ...options })
    const value = await started.value
    last = { started, value, ports }
    if (value.status === 'RUNNING' && await waitUp(value.instance.apiURL)) return last
    if (value.status === 'BLOCKED' && value.code !== 'port_in_use' && value.code !== 'instance_conflict') return last
    await stopOwned(root, { mockFile: options.mockFile, birth: started.birth, equivalentProof: true }).catch(() => {})
  }
  return last
}

async function waitUp(apiURL, attempts = 25) {
  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetch(`${apiURL}/v1/health`, { signal: AbortSignal.timeout(2_000) })
      if (response.ok) return true
    } catch { /* not ready yet */ }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 150))
  }
  return false
}

const debugCall = async (label, fn) => {
  try { return await fn() } catch (error) { throw new Error(`${label}: ${String(error?.message ?? error)}`) }
}

async function readiness(client) {
  const value = await debugCall('readiness', () => client.request('/v1/readiness'))
  return { status: value.status, body: value.body ? { status: value.body.status, discussion: value.body.discussion,
    mode: value.body.mode, startupMode: value.body.startupMode, capabilities: value.body.capabilities,
    authorization: value.body.authorization } : null }
}

export async function runZip() {
  const cases = []
  const target = loadFrozenArtifact('target', DEFAULT_FROZEN_DIRS.target)
  const root = privateRoot('pa-e-w32-zip-')
  const absentModel = join(root.own, 'model', 'absent.json')
  const zip = { subject: frozenArtifactSubject(target), phases: {}, importProject: null, delivery: null, backup: null, reopen: null }
  let mock = null, failure = null

  try {
    zip.stage = 'first-run'
    mark('extract frozen artifact')
    extractFrozen(target, root.install)
    const first = launcher(root.install, ['first-run', '--json'], { env: { PA_CONFIG_ROOT: root.config, PA_DATA_ROOT: root.state } })
    if (first.status !== 0) throw new Error(`first-run ${first.status}: ${first.stderr}`)
    zip.phases.firstRun = { status: first.status, result: first.json?.status ?? null }

    zip.stage = 'unconfigured'
    // Model-unconfigured degradation: the product must start and report the honest absence.
    const phaseA = await startPhase(root, { mockFile: absentModel, fixture: false, extraArgs: ['--discussion-only'], timeoutMs: 90_000 })
    const unconfigured = phaseA?.started
    const unconfiguredValue = await unconfigured.value
    if (unconfiguredValue.status !== 'RUNNING') throw new Error(`unconfigured start ${unconfiguredValue.status}/${unconfiguredValue.code ?? 'none'}`)
    const upA = await waitUp(unconfiguredValue.instance.apiURL)
    const clientA = new LocalProductClient({ baseURL: unconfiguredValue.instance.apiURL, stateDir: unconfiguredValue.instance.state, timeoutMs: 20_000 })
    const readinessA = await readiness(clientA)
    const configurationA = await debugCall('configA', () => clientA.configuration())
    const beforeA = fixedSet(root.config, root, 'zip:unconfigured')
    const stopA = await stopOwned(root, { mockFile: absentModel, birth: unconfigured.birth, equivalentProof: true })
    zip.phases.unconfigured = { apiUp: upA, mode: unconfiguredValue.instance.mode, startupMode: unconfiguredValue.instance.startupMode ?? 'normal',
      readiness: readinessA, contextAvailable: configurationA.assistantContextAvailable,
      stop: { clean: stopA.clean, package: stopA.packageStop?.json?.status ?? null, reason: stopA.reason ?? null },
      resources: { before: beforeA, after: observe(beforeA) } }
    if (stopA.clean !== true) throw new Error(`unconfigured stop not clean: ${stopA.reason}`)

    zip.stage = 'configured'
    // Existing configuration: the same installation with a real private model config.
    mock = await candidateModel()
    const phaseB = await startPhase(root, { mockFile: mock.file, fixture: false, extraArgs: ['--discussion-only'], timeoutMs: 90_000 })
    const configured = phaseB?.started
    const configuredValue = await configured.value
    if (configuredValue.status !== 'RUNNING') throw new Error(`configured start ${configuredValue.status}/${configuredValue.code ?? 'none'}`)
    const upB = await waitUp(configuredValue.instance.apiURL)
    const clientB = new LocalProductClient({ baseURL: configuredValue.instance.apiURL, stateDir: configuredValue.instance.state, timeoutMs: 20_000 })
    const readinessB = await readiness(clientB)
    const configurationB0 = await debugCall('configB0', () => clientB.configuration())
    const projectDir = join(root.own, 'imported-project')
    const { mkdirSync, writeFileSync } = await import('node:fs')
    const { execFileSync } = await import('node:child_process')
    mkdirSync(join(projectDir, 'src'), { recursive: true })
    writeFileSync(join(projectDir, 'index.mjs'), 'export const ok = true\n')
    const git = args => execFileSync('git', args, { cwd: projectDir, stdio: 'pipe' })
    git(['init', '-q']); git(['add', 'index.mjs'])
    git(['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'zip import'])
    const imported = await clientB.request('/v1/projects', { method: 'POST', body: { path: projectDir, displayName: 'ZIP 导入项目', check: 'node_test' } })
    // The registration response is the authoritative configuration echo; a second GET is recorded as
    // an observation when it answers, never required to learn the new project identity.
    const echoed = (imported.body?.projects ?? []).filter(item => item.displayName === 'ZIP 导入项目')[0] ?? null
    let readBack = null
    try { readBack = await clientB.configuration() } catch (error) { readBack = { error: String(error?.message ?? error) } }
    zip.importProject = { status: imported.status, projectId: echoed?.id ?? null,
      echoedProjects: (imported.body?.projects ?? []).length, readBack: Array.isArray(readBack?.projects) ? readBack.projects.length : String(readBack?.error ?? 'absent') }
    const beforeB = fixedSet(root.config, root, 'zip:configured')
    const stopB = await stopOwned(root, { mockFile: mock.file, birth: configured.birth, equivalentProof: true })
    zip.phases.configured = { apiUp: upB, mode: configuredValue.instance.mode, readiness: readinessB,
      contextAvailable: configurationB0.assistantContextAvailable,
      stop: { clean: stopB.clean, package: stopB.packageStop?.json?.status ?? null, reason: stopB.reason ?? null },
      resources: { before: beforeB, after: observe(beforeB) } }
    if (stopB.clean !== true) throw new Error(`configured stop not clean: ${stopB.reason}`)

    zip.stage = 'delivery'
    // One controlled delivery through the same installation, then stop/reopen/backup.
    const phaseC = await startPhase(root, { mockFile: mock.file, fixture: true, timeoutMs: 90_000 })
    const fixture = phaseC?.started
    const fixtureValue = await fixture.value
    if (fixtureValue.status !== 'RUNNING') throw new Error(`fixture start ${fixtureValue.status}/${fixtureValue.code ?? 'none'}`)
    const clientC = new LocalProductClient({ baseURL: fixtureValue.instance.apiURL, stateDir: fixtureValue.instance.state, timeoutMs: 25_000 })
    const configurationC = await clientC.configuration()
    const project = configurationC.projects.find(item => item.dispatchAllowed)
    const created = await clientC.dispatch({ commandId: 'w32-zip-work', conversationId: 'conv-w32-zip', kind: 'create_work',
      projectId: project.id, profileId: project.profileIds?.[0] ?? project.defaultProfileId, goal: 'ZIP 生命周期受控交付。',
      scope: project.scope, criteria: (project.defaultCriteria ?? []).filter(item => item.required) })
    const workId = created.receipt?.workId ?? created.workId
    let view
    for (let index = 0; index < 200; index += 1) {
      view = await clientC.work(workId)
      if (view.actions.available.includes('accept_candidate') || ['delivered', 'ended', 'uncertain'].includes(view.phase)) break
      if ((view.openQuestionIds ?? []).length > 0) {
        const snapshot = await clientC.snapshot({ workId })
        const question = (snapshot.questions ?? [])[0]
        const choice = question?.presentation?.options?.[0]?.id
        if (question && choice) await clientC.dispatch({ commandId: `w32-zip-answer-${index}`, conversationId: 'conv-w32-zip',
          kind: 'answer_question', questionId: question.id, expectedVersion: question.version, answer: { kind: 'choices', optionIds: [choice] } })
      }
      await new Promise(resolvePromise => setTimeout(resolvePromise, 120))
    }
    const accepted = view?.actions?.available?.includes('accept_candidate')
      ? await clientC.dispatch({ commandId: 'w32-zip-accept', conversationId: 'conv-w32-zip', kind: 'accept_candidate', candidate: view.actions.currentCandidate })
      : null
    for (let index = 0; index < 120 && accepted; index += 1) {
      const latest = await clientC.work(workId)
      if (['delivered', 'ended'].includes(latest.phase)) { view = latest; break }
      await new Promise(resolvePromise => setTimeout(resolvePromise, 120))
    }
    zip.delivery = { receipt: created.receipt?.status ?? null, workId, phase: view?.phase ?? null,
      accepted: accepted?.receipt?.status ?? null, artifacts: view?.artifactIds?.length ?? 0 }
    const beforeC = fixedSet(root.config, root, 'zip:delivered')
    const stopC = await stopOwned(root, { mockFile: mock.file, birth: fixture.birth, equivalentProof: true })
    zip.phases.delivered = { stop: { clean: stopC.clean, package: stopC.packageStop?.json?.status ?? null, reason: stopC.reason ?? null },
      resources: { before: beforeC, after: observe(beforeC) } }
    if (stopC.clean !== true) throw new Error(`fixture stop not clean: ${stopC.reason}`)

    zip.stage = 'backup'
    const bundle = join(root.own, 'w32-zip.pab')
    const backup = launcher(root.install, ['backup', '--out', bundle, '--json'], { env: { PA_CONFIG_ROOT: root.config, PA_DATA_ROOT: root.state, PA_MODEL_CONFIG: mock.file }, timeoutMs: 90_000 })
    const verify = launcher(root.install, ['verify-backup', '--bundle', bundle, '--json'], { env: { PA_CONFIG_ROOT: root.config, PA_MODEL_CONFIG: mock.file }, timeoutMs: 90_000 })
    zip.backup = { status: backup.json?.status ?? null, verify: verify.json?.status ?? null,
      counts: backup.json?.counts ?? null, sha256: backup.json?.archiveSha256 ?? null }

    zip.stage = 'reopen'
    const phaseD = await startPhase(root, { mockFile: mock.file, fixture: true, timeoutMs: 60_000 })
    const reopened = phaseD?.started
    const reopenedValue = await reopened.value
    zip.reopen = { status: reopenedValue.status }
    if (reopenedValue.status === 'RUNNING') {
      const clientD = new LocalProductClient({ baseURL: reopenedValue.instance.apiURL, stateDir: reopenedValue.instance.state, timeoutMs: 25_000 })
      const work = await clientD.work(workId).catch(() => null)
      const page = await clientD.conversation('conv-w32-zip').catch(() => null)
      zip.reopen.work = { id: workId, found: work !== null, phase: work?.phase ?? null, artifacts: work?.artifactIds?.length ?? null }
      zip.reopen.messages = page?.messages?.length ?? null
      const beforeD = fixedSet(root.config, root, 'zip:reopen')
      const stopD = await stopOwned(root, { mockFile: mock.file, birth: reopened.birth, equivalentProof: true })
      zip.reopen.stop = { clean: stopD.clean, package: stopD.packageStop?.json?.status ?? null,
        resources: { before: beforeD, after: observe(beforeD) } }
    }
  } catch (error) { failure = `${zip.stage ?? 'unknown'}: ${String(error?.message ?? error)}`.slice(0, 600) }

  const cleanup = async () => {
    const stopped = await stopOwned(root, { mockFile: absentModel, equivalentProof: true }).catch(cause => ({ clean: false, reason: String(cause?.message ?? cause) }))
    if (stopped.clean === true) releaseRoot(root, stopped)
    else retainMaterial(root, stopped.reason ?? 'unknown', { files: ['config/instance.json'] })
    await mock?.close?.().catch(() => {})
  }

  cases.push(await runCase({ id: 'E32-ZIP-LIFECYCLE',
    title: 'One frozen distribution drives first-run, unconfigured degradation, existing configuration, import, controlled delivery, stop, reopen and backup',
    layer: LAYERS.INSTALLED, evidence: { zip }, limitations: [
      'The distribution is installed from the frozen tar into a private directory; no other ZIP is produced or consumed.',
      'Configured-model replies are the loopback mock; no vendor model or native run is claimed.',
    ] }, async ({ assert, evidence }) => {
    assert('ZIP_PROVISIONED', failure === null, failure ?? 'no failure')
    assert('ZIP_FIRST_RUN', zip.phases.firstRun?.result === null || zip.phases.firstRun?.status === 0, JSON.stringify(zip.phases.firstRun))
    const unconfigured = zip.phases.unconfigured ?? {}
    assert('ZIP_UNCONFIGURED_HONEST', unconfigured.readiness?.status === 200 && unconfigured.contextAvailable === false &&
      unconfigured.readiness?.body?.discussion !== 'configuration_present', JSON.stringify(unconfigured.readiness))
    assert('ZIP_UNCONFIGURED_STOP', unconfigured.stop?.clean === true && unconfigured.resources?.after?.every(item => item.alive === false || item.sameIdentity === false),
      JSON.stringify({ stop: unconfigured.stop, resources: unconfigured.resources }))
    const configured = zip.phases.configured ?? {}
    assert('ZIP_CONFIGURED_READY', configured.readiness?.status === 200 && configured.readiness?.body?.discussion === 'configuration_present' &&
      configured.contextAvailable === true, JSON.stringify(configured.readiness))
    assert('ZIP_IMPORT', zip.importProject?.status === 200 && typeof zip.importProject?.projectId === 'string', JSON.stringify(zip.importProject))
    assert('ZIP_CONFIGURED_STOP', configured.stop?.clean === true, JSON.stringify(configured.stop))
    assert('ZIP_DELIVERY', zip.delivery?.receipt === 'recorded' && zip.delivery?.accepted === 'recorded' &&
      zip.delivery?.phase === 'delivered' && (zip.delivery?.artifacts ?? 0) >= 1, JSON.stringify(zip.delivery))
    assert('ZIP_BACKUP', zip.backup?.status === 'CREATED' && zip.backup?.verify === 'VERIFIED' && /^[a-f0-9]{64}$/u.test(String(zip.backup?.sha256 ?? '')),
      JSON.stringify(zip.backup))
    assert('ZIP_REOPEN_WORK', zip.reopen?.status === 'RUNNING' && zip.reopen?.work?.found === true &&
      zip.reopen?.work?.phase === 'delivered' && (zip.reopen?.work?.artifacts ?? 0) >= 1 && (zip.reopen?.messages ?? 0) >= 1,
      JSON.stringify(zip.reopen))
    assert('ZIP_REOPEN_STOP', zip.reopen?.stop?.clean === true, JSON.stringify(zip.reopen?.stop))
    evidence.zip = zip
    await cleanup()
  }))

  return { cases, artifacts: {} }
}
