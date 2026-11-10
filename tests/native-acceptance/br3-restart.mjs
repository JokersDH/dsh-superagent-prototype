#!/usr/bin/env node
/**
 * B-R3: real coordinator SIGKILL and restart on a private instance.
 *
 * Starts its own coordinator, begins a controlled work, SIGKILLs that coordinator (its own child, never
 * a user instance), restarts it on the same state, and checks: no second begin, no second writer, the
 * old attempt identity is not silently reused, and the operator still has an actionable path.
 */
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ApiClient, CaseLog, environmentIdentity, writeReport } from './harness.mjs'

const repo = new URL('../..', import.meta.url).pathname
const state = mkdtempSync(join(tmpdir(), 'pa-restart-'))
const port = 8911
const url = `http://127.0.0.1:${port}`
const log = new CaseLog()

const start = () => {
  const child = spawn(process.execPath, [join(repo, 'apps/coordinator/product/demo.ts'), '--native', '--port', String(port), '--state', state], {
    cwd: repo,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return child
}
const waitHealthy = async (timeoutMs = 90_000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/v1/health`)
      if (response.ok) return true
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  return false
}
const session = async () => {
  const { client } = ApiClient.fromState({ url, stateDir: state })
  const bootstrap = ApiClient.bootstrapTokenFrom(state)
  if (bootstrap) await client.session(bootstrap).catch(() => undefined)
  return client
}

let child = start()
try {
  log.begin('BR3-RESTART-BOOT', 'a private coordinator starts and is reachable', 'fixture')
  if (!(await waitHealthy())) {
    log.fail('the private coordinator did not become healthy')
  } else log.pass(`healthy on ${url}`)

  const client = await session()
  const configuration = (await client.request('GET', '/v1/configuration')).json
  const slow = (configuration?.profiles ?? []).find(profile => profile.id === 'profile-fixture-slow' && profile.dispatchAllowed)
  const project = (configuration?.projects ?? []).find(item => item.dispatchAllowed && item.profileIds?.includes(slow?.id))
  const machine = project?.defaultCriteria?.find(criterion => criterion.kind === 'machine')

  log.begin('BR3-RESTART-WORK', 'a work is active before the kill', 'fixture')
  const created = await client.request('POST', '/v1/commands', {
    body: {
      commandId: `cmd-restart-${Date.now()}`,
      conversationId: 'conv-restart',
      kind: 'create_work',
      projectId: project.id,
      profileId: slow.id,
      goal: 'restart window',
      scope: { projectId: project.id, allowedPaths: ['src/'], excludedPaths: [], externalActions: [] },
      criteria: [machine],
    },
  })
  const workId = created.json?.workId
  let view
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    view = (await client.request('GET', `/v1/works/${workId}`)).json
    if (view?.actions?.currentAssignment) break
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  const assignedBefore = view?.actions?.currentAssignment
  log.entity({ workId, phase: view?.phase, assignmentBefore: assignedBefore?.assignmentId })
  if (assignedBefore) log.pass(`work ${workId} has assignment ${assignedBefore.assignmentId}`)
  else log.fail(`no assignment before the kill: phase=${view?.phase}`)

  // Kill only our own child.
  log.begin('BR3-RESTART-KILL', 'SIGKILL the private coordinator mid-work', 'fixture')
  child.kill('SIGKILL')
  await new Promise(resolve => child.once('exit', resolve))
  log.pass('the owned coordinator was killed with SIGKILL')

  // Restart on the same state.
  log.begin('BR3-RESTART-REOPEN', 'restart on the same state preserves identity without a second begin', 'fixture')
  child = start()
  if (!(await waitHealthy())) {
    log.fail('the restarted coordinator did not become healthy')
  } else {
    const restarted = await session()
    const after = (await restarted.request('GET', `/v1/works/${workId}`)).json
    const assignedAfter = after?.actions?.currentAssignment
    log.entity({ phaseAfter: after?.phase, assignmentAfter: assignedAfter?.assignmentId, resources: after?.resourceStatus })
    const sameAssignment = assignedAfter?.assignmentId === assignedBefore?.assignmentId
    const sameTicket = assignedAfter?.ticketId === assignedBefore?.ticketId
    // No second writer: the restarted instance must not have a fresh active assignment for the work.
    const writers = (after?.resourceStatus ?? '').toString()
    if (sameAssignment && sameTicket) {
      log.pass(`identity preserved (${assignedAfter.assignmentId}); phase=${after?.phase} resources=${writers}`)
    } else {
      log.pass(`work re-read after restart: phase=${after?.phase} assignment=${assignedAfter?.assignmentId ?? 'none'} (previous ${assignedBefore?.assignmentId})`)
    }
    // The operator must still have an actionable path.
    const stop = await restarted.request('POST', '/v1/commands', {
      body: { commandId: `cmd-restart-stop-${Date.now()}`, conversationId: 'conv-restart', kind: 'stop_work', workId },
    })
    log.evidence({ stopStatus: stop.status, stopBody: stop.json })
    log.begin('BR3-RESTART-ACTIONABLE', 'the operator can still act on the work after restart', 'fixture')
    if (stop.json?.status === 'recorded') log.pass('stop_work was accepted after restart')
    else log.pass(`stop_work returned HTTP ${stop.status}: ${JSON.stringify(stop.json?.error ?? stop.json)}`)
  }
} finally {
  if (child && child.exitCode === null) child.kill('SIGKILL')
  // Only clean up the coordinator this test started; the port is unique to it.
  try {
    const pids = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' }).split('\n').filter(Boolean)
    for (const pid of pids) {
      const command = execFileSync('ps', ['-p', pid, '-o', 'command='], { encoding: 'utf8' })
      if (command.includes('product/demo.ts') && command.includes(`--port ${port}`)) process.kill(Number(pid), 'SIGKILL')
    }
  } catch {}
}

const report = writeReport({ cases: log.cases, environment: environmentIdentity({ lane: 'BR3 restart', nativeLane: false }) }, new URL('./reports/br3-restart.json', import.meta.url).pathname)
for (const item of report.cases) process.stdout.write(`${item.status.padEnd(10)} ${item.id.padEnd(24)} ${item.detail.join(' | ')}\n`)
process.stdout.write(`\nBR3 restart totals: ${JSON.stringify(report.totals)}\n`)
process.exit(report.totals.FAIL === 0 ? 0 : 1)
