import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runCase, LAYERS } from '../lib/status.mjs'
import { LocalProductClient } from '../lib/http-client.mjs'
import { candidateModel } from '../../../tests/integration/fixtures/assistant-candidate-model.mjs'
import { captureSet, createOperation, resourceBirth, rollout } from '../lib/caller-safety.mjs'
import { DEFAULT_FROZEN_DIRS, frozenArtifactSubject, loadFrozenArtifact } from '../lib/frozen-package.mjs'
import { extractFrozen, freePort, launcher, privateRoot, readRecord, sha256, startOwned, stopOwned } from '../lib/packaged-instance.mjs'

/**
 * Wave-35 E7: two colleagues' independent private roots on one frozen install.
 *
 * Each root has its own config/state and its own private model file; both run at the same time with
 * distinct identities and ports. Stopping one leaves the other serving, and doctor/status read each
 * root's own state without printing a key.
 */
const mark = message => { if (process.env.PA_E_TRACE) process.stderr.write(`[w35multi] ${message}\n`) }

const pidSet = config => {
  const record = readRecord(config).value ?? null
  if (!record) return []
  return [...new Set([record.pid, record.apiPid, record.consolePid])].filter(Number.isSafeInteger)
}

async function waitHealth(client, attempts = 60) {
  for (let index = 0; index < attempts; index += 1) {
    try { const health = await client.health(); if (health?.status === 'ok' || health?.ok === true) return true } catch { /* not up */ }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 200))
  }
  return false
}

export async function runMultiInstance() {
  const cases = []
  const target = loadFrozenArtifact('w33', DEFAULT_FROZEN_DIRS.w33)
  const base = privateRoot('pa-e-w35-multi-')
  const roots = ['A', 'B'].map(label => ({
    label, install: base.install, config: join(base.own, label, 'config'), state: join(base.own, label, 'state'),
  }))
  const op = createOperation({ id: 'w35-multi' })
  const evidence = { subject: frozenArtifactSubject(target), instances: {}, isolation: {}, doctor: {}, operation: null }
  const mocks = []
  let failure = null
  const capture = (label, rootValue) => {
    const pids = pidSet(rootValue.config)
    for (const pid of pids) op.track(resourceBirth(pid, { root: rootValue.install, config: rootValue.config, state: rootValue.state, op: `multi:${label}` }))
    return captureSet(pids, { root: rootValue.install, config: rootValue.config, state: rootValue.state, op: `multi:${label}` })
  }
  try {
    mkdirSync(base.install, { recursive: true })
    extractFrozen(target, base.install)
    for (const item of roots) { mkdirSync(item.config, { recursive: true, mode: 0o700 }); mkdirSync(item.state, { recursive: true, mode: 0o700 }) }
    op.addMaterial(base.own, 'two-private-roots')
    for (const item of roots) {
      const first = launcher(base.install, ['first-run', '--json'], { env: { PA_CONFIG_ROOT: item.config, PA_DATA_ROOT: item.state } })
      if (first.status !== 0) throw new Error(`first-run ${item.label} ${first.status}: ${first.stderr}`)
      item.mock = await candidateModel()
      mocks.push(item.mock)
    }
    mark('start both roots')
    for (const item of roots) {
      const ports = [await freePort(), await freePort()]
      const started = startOwned(item, { ports, mockFile: item.mock.file, fixture: false, extraArgs: ['--discussion-only'] })
      item.started = started
      op.track({ ...started.birth, argvSha256: started.birth.argv ? sha256(started.birth.argv) : null,
        op: `multi:${item.label}:launcher` })
      item.value = await started.value
      if (item.value.status !== 'RUNNING') throw new Error(`start ${item.label} ${item.value.status}/${item.value.code ?? 'none'}: ${item.value.stderr ?? ''}`)
      item.client = new LocalProductClient({ baseURL: item.value.instance.apiURL, stateDir: item.state, timeoutMs: 20_000 })
      item.health = await waitHealth(item.client)
      item.readiness = await item.client.request('/v1/readiness').then(value => ({ status: value.status, discussion: value.body?.discussion ?? null })).catch(() => ({ status: 0 }))
      item.set = capture(item.label, item)
      evidence.instances[item.label] = { buildId: item.value.instance.buildId ?? null, mode: item.value.instance.mode ?? null,
        startupMode: item.value.instance.startupMode ?? null, consoleURL: item.value.instance.consoleURL, apiURL: item.value.instance.apiURL,
        health: item.health, readiness: item.readiness, configRoot: item.config, stateRoot: item.state,
        pid: readRecord(item.config).value?.pid ?? null }
    }
    evidence.isolation = {
      distinctPid: evidence.instances.A.pid !== evidence.instances.B.pid,
      distinctConsole: evidence.instances.A.consoleURL !== evidence.instances.B.consoleURL,
      distinctApi: evidence.instances.A.apiURL !== evidence.instances.B.apiURL,
      distinctConfig: evidence.instances.A.configRoot !== evidence.instances.B.configRoot,
      distinctState: evidence.instances.A.stateRoot !== evidence.instances.B.stateRoot,
      distinctModel: roots[0].mock.file !== roots[1].mock.file,
      sameInstall: roots[0].install === roots[1].install,
    }
    for (const item of roots) {
      const doctor = launcher(base.install, ['doctor', '--json'], { env: { PA_CONFIG_ROOT: item.config, PA_DATA_ROOT: item.state, PA_MODEL_CONFIG: item.mock.file }, timeoutMs: 40_000 })
      const key = (() => { try { return JSON.parse(readFileSync(item.mock.file, 'utf8')).apiKey ?? null } catch { return null } })()
      const output = `${doctor.stdout ?? ''}${doctor.stderr ?? ''}`
      evidence.doctor[item.label] = { exit: doctor.status, status: doctor.json?.status ?? null, code: doctor.json?.code ?? null,
        secretLeaked: key !== null && key.length > 0 && output.includes(key) }
    }
    mark('stop A only')
    const stopA = await stopOwned(roots[0], { mockFile: roots[0].mock.file, birth: roots[0].started.birth })
    evidence.instances.A.stop = { clean: stopA.clean, package: stopA.packageStop?.json?.status ?? null, reason: stopA.reason ?? null,
      after: rollout(roots[0].set) }
    const bAlive = await waitHealth(roots[1].client, 10)
    const bRead = await roots[1].client.request('/v1/readiness').then(value => value.status).catch(() => 0)
    evidence.isolation.bAfterAStop = { health: bAlive, readiness: bRead,
      bPidAlive: rollout(roots[1].set).every(item => item.alive === true && item.sameIdentity === true) }
    const stopB = await stopOwned(roots[1], { mockFile: roots[1].mock.file, birth: roots[1].started.birth })
    evidence.instances.B.stop = { clean: stopB.clean, package: stopB.packageStop?.json?.status ?? null, reason: stopB.reason ?? null,
      after: rollout(roots[1].set) }
    if (stopA.clean !== true || stopB.clean !== true) throw new Error(`stop not clean: A=${stopA.reason} B=${stopB.reason}`)
  } catch (error) { failure = String(error?.message ?? error).slice(0, 600); op.fail('case', error); op.retain(`case:${failure}`) }

  if (failure === null && op.releaseAllowed().allowed === true) {
    const released = op.release()
    evidence.operation = { verdict: released.verdict, released: released.released, retained: [], signals: op.signals }
  } else {
    op.retain(failure ?? op.releaseAllowed().reason ?? 'unknown')
    const kept = op.retainAll(failure ?? op.releaseAllowed().reason ?? 'unknown')
    evidence.operation = { verdict: kept.observation ? op.releaseAllowed(kept.observation) : null, released: [],
      retained: kept.retained, reason: kept.reason, signals: op.signals }
  }
  for (const mock of mocks) await mock?.close?.().catch(() => {})

  cases.push(await runCase({ id: 'E7-MULTI-INSTANCE',
    title: 'Two colleagues keep independent private roots, identities and doctor/status on one frozen install',
    layer: LAYERS.INSTALLED, evidence: { multiInstance: evidence }, limitations: [
      'Same physical machine and user account: two explicit private roots, not cross-machine or multi-user isolation.',
      'The loopback model configuration is a private mock; no vendor model or native run is claimed.',
    ] }, async ({ assert, evidence: ev }) => {
    assert('MULTI_PROVISIONED', failure === null, failure ?? 'no failure')
    assert('MULTI_BOTH_RUNNING', evidence.instances.A.health === true && evidence.instances.B.health === true &&
      evidence.instances.A.readiness?.discussion === 'configuration_present' && evidence.instances.B.readiness?.discussion === 'configuration_present',
      JSON.stringify({ A: evidence.instances.A?.health, B: evidence.instances.B?.health }))
    assert('MULTI_ISOLATED', evidence.isolation?.distinctPid === true && evidence.isolation?.distinctConsole === true &&
      evidence.isolation?.distinctApi === true && evidence.isolation?.distinctConfig === true &&
      evidence.isolation?.distinctState === true && evidence.isolation?.distinctModel === true && evidence.isolation?.sameInstall === true,
      JSON.stringify(evidence.isolation))
    assert('MULTI_DOCTOR_OWN_ROOT', ['A', 'B'].every(label => typeof evidence.doctor[label]?.exit === 'number' &&
      evidence.doctor[label].secretLeaked === false), JSON.stringify(evidence.doctor))
    assert('MULTI_STOP_A_KEEPS_B', evidence.instances.A.stop?.clean === true && evidence.isolation.bAfterAStop?.health === true &&
      evidence.isolation.bAfterAStop?.readiness === 200 && evidence.isolation.bAfterAStop?.bPidAlive === true,
      JSON.stringify({ stop: evidence.instances.A.stop, b: evidence.isolation.bAfterAStop }))
    assert('MULTI_BOTH_STOPPED', evidence.instances.B.stop?.clean === true &&
      evidence.instances.A.stop.after.every(item => item.alive === false || item.sameIdentity === false) &&
      evidence.instances.B.stop.after.every(item => item.alive === false || item.sameIdentity === false),
      JSON.stringify({ A: evidence.instances.A.stop, B: evidence.instances.B.stop }))
    assert('MULTI_OPERATION_RELEASED', evidence.operation?.verdict?.allowed === true && evidence.operation.released.length === 1 &&
      evidence.operation.signals.length === 0, JSON.stringify(evidence.operation))
    ev.multiInstance = evidence
  }))
  return { cases, artifacts: {} }
}
