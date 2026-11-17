import { mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { runCase, notTested, LAYERS } from '../lib/status.mjs'
import { LocalProductClient } from '../lib/http-client.mjs'
import { candidateModel } from '../../../tests/integration/fixtures/assistant-candidate-model.mjs'
import { captureSet, createOperation, resourceBirth, rollout } from '../lib/caller-safety.mjs'
import { extractOuterZip, privateHome, verifyOuterZip, W35_ZIP_DIR, W35_ZIP_NAME } from '../lib/outer-zip.mjs'
import { freePort, launcher, privateRoot, readRecord, startOwned, stopOwned } from '../lib/packaged-instance.mjs'

/**
 * Wave-36 closure 2: the current W35 package's Work-history surface.
 *
 * main publishes the classified completion-history consumer in source (0092), but the frozen W35
 * package bytes were built before it. This case proves the installed surface (authenticated GET) and
 * records the successor requirement instead of borrowing source-level results.
 */
export async function runHistorySurface() {
  const cases = []
  const evidence = { zip: null, probe: null, resources: {}, operation: null }
  const root = privateRoot('pa-e-w36-history-')
  const home = privateHome('pa-e-w36-hishome-')
  const operation = createOperation({ id: 'w36-history-surface' })
  operation.addMaterial(root.own, 'install-config-state')
  operation.addMaterial(home, 'outer-home')
  let mock = null, failure = null
  try {
    const zip = verifyOuterZip(W35_ZIP_DIR, W35_ZIP_NAME)
    const extracted = extractOuterZip(zip, home)
    root.install = extracted.install
    evidence.zip = { sha256: zip.sha256, bytes: zip.bytes, buildId: zip.result?.inner?.buildId ?? null,
      source: zip.result?.inner?.source ?? null, installManifestDigest: extracted.digests.installManifest,
      installManifestSha256: zip.result?.inner?.installManifestSha256 ?? null }
    const first = launcher(root.install, ['first-run', '--json'], { env: { PA_CONFIG_ROOT: root.config, PA_DATA_ROOT: root.state } })
    if (first.status !== 0) throw new Error(`first-run ${first.status}: ${first.stderr}`)
    mock = await candidateModel()
    const ports = [await freePort(), await freePort()]
    const started = startOwned(root, { ports, mockFile: mock.file, fixture: true, extraArgs: [] })
    operation.track({ ...started.birth, argvSha256: started.birth.argv ? (await import('node:crypto')).createHash('sha256').update(started.birth.argv).digest('hex') : null, op: 'history:launcher' })
    const value = await started.value
    if (value.status !== 'RUNNING') throw new Error(`start ${value.status}/${value.code ?? 'none'}: ${value.stderr ?? ''}`)
    const client = new LocalProductClient({ baseURL: value.instance.apiURL, stateDir: value.instance.state, timeoutMs: 20_000 })
    for (let index = 0; index < 60; index += 1) { try { if ((await client.health())?.status === 'ok') break } catch { /* wait */ } await new Promise(resolvePromise => setTimeout(resolvePromise, 150)) }
    const configuration = await client.configuration()
    const project = configuration.projects.find(item => item.dispatchAllowed)
    const created = await client.dispatch({ commandId: 'w36-history-work', conversationId: 'conv-w36-history', kind: 'create_work',
      projectId: project.id, profileId: project.profileIds?.[0] ?? project.defaultProfileId, goal: 'W35 历史接口安装面核对。',
      scope: project.scope, criteria: (project.defaultCriteria ?? []).filter(item => item.required) })
    const workId = created.receipt?.workId ?? created.workId
    const unauthorized = await client.request(`/v1/works/${encodeURIComponent(workId)}/completion-history`, { authenticated: false })
      .catch(error => ({ status: error.status, body: error.body }))
    const authenticated = await client.request(`/v1/works/${encodeURIComponent(workId)}/completion-history`, {})
      .catch(error => ({ status: error.status, body: error.body }))
    const record = readRecord(root.config).value ?? null
    const pids = record ? [...new Set([record.pid, record.apiPid, record.consolePid])].filter(Number.isSafeInteger) : []
    const config = join(home, 'Library/Application Support/PersonalAgent', `Preview-${zip.result?.inner?.buildId}`, 'config')
    for (const pid of pids) operation.track(resourceBirth(pid, { root: root.install, config: root.config, state: root.state, op: 'history:instance' }))
    const set = captureSet(pids, { root: root.install, config: root.config, state: root.state, op: 'history:instance' })
    const stop = await stopOwned(root, { mockFile: mock.file, birth: started.birth })
    evidence.probe = { workId, receipt: created.receipt?.status ?? null,
      authenticated: { status: authenticated.status, code: authenticated.body?.error?.code ?? authenticated.body?.code ?? null,
        hasHistoryBody: Boolean(authenticated.body?.entries ?? authenticated.body?.items ?? authenticated.body?.history) },
      unauthorized: { status: unauthorized.status },
      installed: authenticated.status === 200 ? 'present' : 'absent' }
    evidence.resources = { before: set, after: rollout(set), stop: { clean: stop.clean, package: stop.packageStop?.json?.status ?? null, reason: stop.reason ?? null } }
    if (stop.clean !== true) throw new Error(`stop not clean: ${stop.reason}`)
  } catch (error) { failure = String(error?.message ?? error).slice(0, 600); operation.fail('case', error); operation.retain(`case:${failure}`) }
  await mock?.close?.().catch(() => {})
  if (failure === null && operation.releaseAllowed().allowed === true) {
    const released = operation.release()
    evidence.operation = { verdict: released.verdict, released: released.released, retained: [], signals: operation.signals }
  } else {
    operation.retain(failure ?? operation.releaseAllowed().reason ?? 'unknown')
    const kept = operation.retainAll(failure ?? 'unknown')
    evidence.operation = { verdict: kept.observation ? operation.releaseAllowed(kept.observation) : null, released: [], retained: kept.retained, reason: kept.reason, signals: operation.signals }
  }

  if (failure !== null) {
    cases.push(await runCase({ id: 'E36-COMPLETION-HISTORY-INSTALLED',
      title: 'The frozen W35 package exposes the classified completion-history route',
      layer: LAYERS.INSTALLED, evidence: { historySurface: evidence }, limitations: ['Probe failure is recorded, not a product claim.'] },
      async ({ assert }) => { assert('HISTORY_PROBED', false, failure) }))
  } else if (evidence.probe.installed === 'present') {
    cases.push(await runCase({ id: 'E36-COMPLETION-HISTORY-INSTALLED',
      title: 'The frozen W35 package exposes the classified completion-history route',
      layer: LAYERS.INSTALLED, evidence: { historySurface: evidence }, limitations: ['Metadata projection only; no execution permission.'] },
      async ({ assert }) => {
        assert('HISTORY_AUTHENTICATED', evidence.probe.authenticated.status === 200 && evidence.probe.authenticated.hasHistoryBody,
          JSON.stringify(evidence.probe.authenticated))
        assert('HISTORY_UNAUTHORIZED', [401, 403].includes(evidence.probe.unauthorized.status), JSON.stringify(evidence.probe.unauthorized))
        assert('HISTORY_STOP', evidence.resources.stop?.clean === true, JSON.stringify(evidence.resources.stop))
      }))
  } else {
    cases.push(notTested({ id: 'E36-COMPLETION-HISTORY-INSTALLED',
      title: 'The frozen W35 package exposes the classified completion-history route',
      layer: LAYERS.INSTALLED, evidence: { historySurface: evidence }, limitations: [
        'The route is absent from the frozen W35 bytes; source publication is not an installed consumer.',
      ] }, `NOT_INSTALLED: /v1/works/:id/completion-history returned ${evidence.probe.authenticated.status} on the frozen W35 package (build ${evidence.zip?.buildId}); main 0092 source is newer than this package. Required successor: a D-frozen runtime built from a source containing the classified history consumer, then E re-measures this surface with the same subject, authorized/unauthorized/malformed identities and the 128KiB/stream limits.`))
  }
  return { cases, artifacts: {} }
}
