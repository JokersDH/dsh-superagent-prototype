/**
 * Wave-32 H2/H10 package lifecycle consumer.
 *
 * Uses the immutable package's own `first-run`/`start --fixture --discussion-only`/`status`/
 * `recovery-status`/`stop` entries in a new private root. The executor is a private fixture `codex`
 * shim used only for first-run detection; no real CLI is executed and no model/native turn occurs.
 * It reads the package readiness/health/console/SSE endpoints, checks REUSED on the same selection,
 * and stops only through the package's verified own instance record. No PID signal is sent by H.
 */
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { homeDir, redactPath } from '../../../tools/trial-kit/lib/redact.mjs'

const PA = 'apps/launcher/bin/pa.mjs'

async function runLaunch(packageRoot, roots, args, env = process.env) {
  return await new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [join(packageRoot, PA), ...args,
      '--install', packageRoot, '--config-root', roots.config, '--data-root', roots.data,
      '--cache-root', roots.cache, '--logs-root', roots.logs, '--workspace-root', roots.workspace, '--json'],
    { env, detached: true, stdio: 'ignore' })
    let settled = false
    child.on('exit', (code) => { if (!settled) { settled = true; resolvePromise({ exit: code, detached: false }) } })
    setTimeout(() => {
      if (!settled) {
        settled = true
        child.unref()
        resolvePromise({ exit: 0, detached: true })
      }
    }, 4000)
  })
}

function run(packageRoot, roots, args, env = process.env) {
  const result = spawnSync(process.execPath, [join(packageRoot, PA), ...args,
    '--install', packageRoot, '--config-root', roots.config, '--data-root', roots.data,
    '--cache-root', roots.cache, '--logs-root', roots.logs, '--workspace-root', roots.workspace, '--json'],
  { encoding: 'utf8', timeout: 60000, env })
  let parsed = null
  try { parsed = JSON.parse(result.stdout) } catch { parsed = null }
  return { exit: result.status, stdout: result.stdout.slice(0, 4000), stderr: result.stderr.slice(0, 4000), parsed }
}

async function freePort() {
  return await new Promise((resolvePromise) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolvePromise(port))
    })
  })
}

async function waitStatus(packageRoot, roots, env, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs
  let latest = null
  while (Date.now() < deadline) {
    latest = run(packageRoot, roots, ['status'], env)
    if (latest.parsed?.status === 'RUNNING') return latest
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
  return latest
}

async function waitJson(url, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  let latest = null
  while (Date.now() < deadline) {
    latest = await getJson(url).catch((error) => ({ error: String(error?.name ?? error) }))
    if (latest.status === 200) return latest
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
  return latest
}

async function getJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(3000) })
  const text = await response.text()
  let body = null
  try { body = JSON.parse(text) } catch { body = null }
  return { status: response.status, contentType: response.headers.get('content-type'), body, bytes: Buffer.byteLength(text) }
}

async function postCommand(instance, body) {
  const response = await fetch(`${instance.apiURL}/v1/commands`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: instance.consoleURL }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000),
  })
  const text = await response.text()
  return { status: response.status, body: (() => { try { return JSON.parse(text) } catch { return null } })() }
}

async function waitSnapshot(instance, predicate, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  let latest = null
  while (Date.now() < deadline) {
    latest = await waitJson(`${instance.apiURL}/v1/snapshot`, 3000)
    if (latest?.status === 200 && predicate(latest.body)) return latest.body
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 150))
  }
  return latest?.body ?? null
}

async function readSse(url) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 1200)
  try {
    const response = await fetch(url, { headers: { accept: 'text/event-stream' }, signal: controller.signal })
    let events = 0
    let bytes = 0
    try {
      const reader = response.body?.getReader()
      while (reader !== undefined) {
        const chunk = await reader.read()
        if (chunk.done) break
        bytes += chunk.value.byteLength
        const text = Buffer.from(chunk.value).toString('utf8')
        events += (text.match(/\n\n/g) ?? []).length
        if (events > 0) break
      }
    } catch (error) {
      if (error?.name !== 'AbortError') throw error
    }
    return { status: response.status, contentType: response.headers.get('content-type'), events, bytes, endedBy: 'bounded_abort_or_stream' }
  } catch (error) {
    return { status: null, error: String(error?.name ?? error), events: 0, bytes: 0 }
  } finally { clearTimeout(timeout) }
}

export async function runPackageLifecycle({ packageRoot, releaseManifest, out }) {
  const release = JSON.parse(readFileSync(releaseManifest, 'utf8'))
  const expectedBuild = release.buildId
  mkdirSync(out, { recursive: true, mode: 0o700 })
  const roots = { config: join(out, 'config'), data: join(out, 'data'), cache: join(out, 'cache'), logs: join(out, 'logs'), workspace: join(out, 'workspace') }
  for (const dir of Object.values(roots)) mkdirSync(dir, { recursive: true, mode: 0o700 })
  cpSync(releaseManifest, join(roots.config, 'release.json'))
  const bin = join(out, 'bin')
  mkdirSync(bin, { recursive: true, mode: 0o700 })
  writeFileSync(join(bin, 'codex'), '#!/bin/sh\necho "codex-cli 0.0.0-trial-fixture"\n', { mode: 0o700 })
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` }
  const first = run(packageRoot, roots, ['first-run'], env)
  const port = await freePort()
  const apiPort = await freePort()
  const startArgs = ['start', '--fixture', '--discussion-only', '--port', String(port), '--api-port', String(apiPort)]
  const start = await runLaunch(packageRoot, roots, startArgs, env)
  const status = await waitStatus(packageRoot, roots, env)
  const instance = status.parsed?.instance ?? null
  let readiness = null
  let health = null
  let consolePage = null
  let sse = null
  let snapshot = null
  let configuration = null
  let work = null
  let candidateSeen = false
  let acceptGateObserved = false
  let stale = null
  let accepted = null
  let reopened = null
  if (instance?.apiURL) {
    readiness = await waitJson(`${instance.apiURL}/v1/readiness`)
    health = await waitJson(`${instance.apiURL}/v1/health`)
    sse = await readSse(`${instance.apiURL}/v1/events`)
    snapshot = await waitJson(`${instance.apiURL}/v1/snapshot`)
    configuration = await waitJson(`${instance.apiURL}/v1/configuration`)
  }
  if (instance?.consoleURL) {
    consolePage = await fetch(instance.consoleURL, { signal: AbortSignal.timeout(3000) }).then(async (response) => ({ status: response.status, bytes: (await response.text()).length })).catch((error) => ({ error: String(error?.name ?? error) }))
  }
  let installedWork = null
  if (configuration?.status === 200 && configuration.body?.projects?.length > 0) {
    const project = configuration.body.projects.find((entry) => entry.dispatchAllowed) ?? configuration.body.projects[0]
    const profileId = project.defaultProfileId
    work = await postCommand(instance, { commandId: 'h32-installed-work-1', conversationId: 'h32-installed-chat', kind: 'create_work', projectId: project.id, goal: 'H32 installed controlled trial work', scope: project.scope, profileId, criteria: project.defaultCriteria })
    const asked = await waitSnapshot(instance, (body) => body.questions.some((entry) => entry.contract.workId === work.body?.workId))
    const question = asked?.questions?.find((entry) => entry.contract.workId === work.body?.workId)
    if (question !== undefined) await postCommand(instance, { commandId: 'h32-installed-answer-1', conversationId: 'h32-installed-chat', kind: 'answer_question', questionId: question.id, expectedVersion: question.version, answer: { kind: 'choices', optionIds: ['allow'] } })
    const created = await waitSnapshot(instance, (body) => body.works.some((entry) => entry.work.id === work.body?.workId && entry.actions?.currentCandidate !== undefined && entry.phase !== 'verifying'))
    installedWork = created?.works?.find((entry) => entry.work.id === work.body?.workId) ?? null
    candidateSeen = installedWork?.actions?.currentCandidate !== undefined
    acceptGateObserved = candidateSeen && Array.isArray(installedWork?.actions?.available)
    const available = installedWork?.actions?.available ?? []
    if (installedWork?.actions?.currentCandidate !== undefined && available.includes('accept_candidate')) {
      const candidate = installedWork.actions.currentCandidate
      accepted = await postCommand(instance, { commandId: 'h32-installed-accept-1', conversationId: 'h32-installed-chat', kind: 'accept_candidate', candidate })
      stale = await postCommand(instance, { commandId: 'h32-installed-stale-1', conversationId: 'h32-installed-chat', kind: 'accept_candidate', candidate: { ...candidate, candidateGeneration: candidate.candidateGeneration + 1 } })
      const delivered = await waitSnapshot(instance, (body) => body.works.some((entry) => entry.work.id === work.body?.workId && entry.phase === 'delivered'))
      installedWork = delivered?.works?.find((entry) => entry.work.id === work.body?.workId) ?? installedWork
    }
  }
  const restart = await runLaunch(packageRoot, roots, startArgs, env)
  const restartStatus = await waitStatus(packageRoot, roots, env)
  const reviewNegative = run(packageRoot, roots, ['start', '--discussion-only', '--review-restored-scope', join(out, 'missing-review.json')], env)
  const reopenSnapshot = await waitSnapshot(instance, (body) => body.works.some((entry) => entry.work.id === work?.body?.workId))
  reopened = reopenSnapshot?.works?.find((entry) => entry.work.id === work?.body?.workId) ?? null
  const stop = run(packageRoot, roots, ['stop'], env)
  const afterStop = run(packageRoot, roots, ['status'], env)
  const httpAfterStop = instance?.apiURL ? await getJson(`${instance.apiURL}/v1/health`).then((result) => result.status).catch(() => null) : null
  const checks = {
    firstRunOk: first.parsed?.status === 'OK',
    startRunning: status.parsed?.status === 'RUNNING',
    sameOwnInstance: instance?.buildId === expectedBuild && instance?.mode === 'fixture' && instance?.startupMode === 'normal',
    readinessModeFixture: readiness?.body?.mode === 'fixture' && readiness?.body?.startupMode === 'normal',
    readinessAuthorizationNone: readiness?.body?.authorization === 'none',
    healthOk: health?.body?.status === 'ok',
    consoleServed: consolePage?.status === 200 && consolePage?.bytes > 0,
    sseConnected: sse?.status === 200 && String(sse?.contentType ?? '').includes('text/event-stream'),
    snapshotVisible: snapshot?.status === 200 && snapshot?.body !== null,
    configurationVisible: configuration?.status === 200 && (configuration?.body?.projects?.length ?? 0) > 0,
    installedWorkCreated: work?.status === 200 && work?.body?.status === 'recorded' && typeof work?.body?.workId === 'string',
    installedCandidateSeen: candidateSeen,
    staleCandidateRejected: stale === null || (stale?.status === 200 && stale?.body?.status === 'rejected'),
    installedAcceptGateObserved: acceptGateObserved,
    installedAcceptRecorded: accepted?.status === 200 && accepted?.body?.status === 'recorded',
    installedDelivered: installedWork?.phase === 'delivered' && (installedWork?.artifactIds?.length ?? 0) >= 1 && installedWork?.resourceStatus === 'quiescent',
    reusedSamePid: restartStatus.parsed?.status === 'RUNNING' && restartStatus.parsed?.instance?.pid === instance?.pid,
    reviewOnFixtureRefused: reviewNegative.parsed?.status === 'BLOCKED',
    stoppedOwnInstance: stop.parsed?.status === 'STOPPED' && stop.parsed?.stillAlive === false && stop.parsed?.verification?.ok === true,
    stoppedStatus: afterStop.parsed?.status === 'STOPPED',
    stoppedNotServing: httpAfterStop === null,
    reopenedSameWork: work?.body?.workId !== undefined && reopened?.work?.id === work.body.workId && reopened?.phase === installedWork?.phase,
    noHSignal: true,
  }
  return {
    protocol: 'package-lifecycle/1',
    surface: 'immutable package first-run/start/status/recovery-status/stop + readiness/health/console/SSE',
    expectedBuild, packageRoot, roots, ports: { console: port, api: apiPort },
    instance: instance === null ? null : { ...instance, launcherArgv: (instance.launcherArgv ?? []).map((entry) => redactPath(entry, homeDir())), apiArgv: (instance.apiArgv ?? []).map((entry) => redactPath(entry, homeDir())), launcherCwd: redactPath(instance.launcherCwd, homeDir()) },
    commandExits: { firstRun: first.exit, start: start.exit, status: status.exit, restart: restart.exit, restartStatus: restartStatus.exit, reviewNegative: reviewNegative.exit, stop: stop.exit, afterStop: afterStop.exit },
    installedWork: work === null ? null : { createStatus: work.status, createBody: work.body, workId: work.body?.workId ?? null, acceptAttempted: accepted !== null, staleStatus: stale?.status ?? null, staleBody: stale?.body ?? null, acceptStatus: accepted?.status ?? null, acceptBody: accepted?.body ?? null, final: installedWork === null ? null : { phase: installedWork.phase, artifactIds: installedWork.artifactIds, resourceStatus: installedWork.resourceStatus, available: installedWork.actions?.available ?? [] }, reopened: reopened === null ? null : { phase: reopened.phase, workId: reopened.work?.id, artifactIds: reopened.artifactIds } },
    statuses: { firstRun: first.parsed?.status ?? null, start: start.exit === 0 ? 'STARTED' : 'FAILED', status: status.parsed?.status ?? null, restart: restart.exit === 0 ? 'REUSED_OR_RUNNING' : 'FAILED', reviewNegative: reviewNegative.parsed?.status ?? null, stop: stop.parsed?.status ?? null, afterStop: afterStop.parsed?.status ?? null },
    readiness, health, consolePage, sse, snapshot, checks,
    limits: ['fixture/discussion-only, no model or native turn', 'private fake codex is used only for first-run detection', 'H sends no signal; stop is the package verified own-path', 'SSE is bounded to 1200ms and may emit zero events'],
  }
}
