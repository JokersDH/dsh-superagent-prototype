#!/usr/bin/env node
/**
 * Bounded multi-state/ownership probe for the frozen target install. It starts one install against
 * two different state dirs, then checks that a stop aimed at state A never stops the live state B,
 * and that a dead launcher with a live API is not treated as a stopped/owned target.
 *
 * Only processes this probe started are signalled; an unknown live process is reported, not killed.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const spec = JSON.parse(process.env.PA_E_MULTI_SPEC ?? '{}')
const ports = JSON.parse(process.env.PA_E_MULTI_PORTS ?? '[]')
const result = { protocol: 'e4-multistate-child/1', steps: [] }
const step = (id, status, detail) => result.steps.push({ id, status, detail })
const w = realpathSync(mkdtempSync(join(tmpdir(), 'pa-e-multi-')))
const install = join(w, 'install')
const roots = { config: join(w, 'cfg'), dataA: join(w, 'data-a'), dataB: join(w, 'data-b'), cache: join(w, 'cache'), logs: join(w, 'logs'), workspace: join(w, 'ws') }
for (const dir of Object.values(roots)) mkdirSync(dir, { recursive: true, mode: 0o700 })
const baseArgs = ['--config-root', roots.config, '--cache-root', roots.cache, '--logs-root', roots.logs, '--workspace-root', roots.workspace]
const envFor = (data) => ({ ...process.env, PA_CONFIG_ROOT: roots.config, PA_DATA_ROOT: data, PA_CACHE_ROOT: roots.cache, PA_LOGS_ROOT: roots.logs, PA_WORKSPACE_ROOT: roots.workspace })
const start = (data, port, apiPort) => {
  const child = spawn(join(install, 'bin/pa'), ['start', '--fixture', '--json', '--port', String(port), '--api-port', String(apiPort), '--data-root', data, ...baseArgs], { cwd: w, env: envFor(data), stdio: ['ignore', 'pipe', 'pipe'] })
  let buffer = ''
  child.stdout.on('data', (chunk) => { buffer += chunk })
  return new Promise((resolve) => {
    const deadline = Date.now() + 40_000
    const poll = () => {
      const line = buffer.split('\n').find((item) => item.trim().startsWith('{'))
      if (line) { try { return resolve({ child, value: JSON.parse(line) }) } catch { /* keep */ } }
      if (Date.now() > deadline || child.exitCode !== null) return resolve({ child, value: undefined })
      setTimeout(poll, 120)
    }
    poll()
  })
}
const alive = (pid) => { try { return process.kill(pid, 0) === true } catch { return false } }
let childB

try {
  mkdirSync(install, { recursive: true })
  spawnSync('tar', ['-xzf', spec.tarPath, '-C', install, '--strip-components=1'])
  const first = spawnSync(join(install, 'bin/pa'), ['first-run', '--json', ...baseArgs], { cwd: w, env: envFor(roots.dataA), encoding: 'utf8', timeout: 60_000 })
  step('first_run', first.status === 0 ? 'PASS' : 'FAIL', first.stderr.slice(-200))

  const a = await start(roots.dataA, ports[0] ?? 5591, ports[1] ?? 8991)
  step('state_a_start', a.value?.status === 'RUNNING' ? 'PASS' : 'FAIL', JSON.stringify({ status: a.value?.status }))
  const aPid = a.value?.instance?.pid
  spawnSync(join(install, 'bin/pa'), ['stop', '--json', '--data-root', roots.dataA, ...baseArgs], { cwd: w, env: envFor(roots.dataA), encoding: 'utf8', timeout: 30_000 })

  const b = await start(roots.dataB, ports[2] ?? 5592, ports[3] ?? 8992)
  childB = b.child
  const bPid = b.value?.instance?.pid
  const bApi = b.value?.instance?.apiPid
  step('state_b_start', b.value?.status === 'RUNNING' && bPid !== aPid ? 'PASS' : 'FAIL', JSON.stringify({ status: b.value?.status, bPid, aPid }))

  // A stop aimed at state A must not claim or stop state B, which shares only the install path.
  const recorded = (() => { try { return JSON.parse(readFileSync(join(roots.config, 'instance.json'), 'utf8')) } catch { return null } })()
  const bApiPort = b.value?.instance?.apiURL ? Number(new URL(b.value.instance.apiURL).port) : null
  const portOpen = (port) => {
    if (port === null) return false
    const probe = spawnSync(process.execPath, ['-e', `const s=require("net").connect(${port},"127.0.0.1");s.on("connect",()=>{console.log("open");process.exit(0)});s.on("error",()=>{console.log("closed");process.exit(0)});setTimeout(()=>{console.log("closed");process.exit(0)},800)`], { encoding: 'utf8', timeout: 3_000 })
    return probe.stdout.trim() === 'open'
  }
  const apiOpenBefore = portOpen(bApiPort)
  const otherStop = spawnSync(join(install, 'bin/pa'), ['stop', '--json', '--data-root', roots.dataA, ...baseArgs], { cwd: w, env: envFor(roots.dataA), encoding: 'utf8', timeout: 30_000 })
  let otherJson
  try { otherJson = JSON.parse(otherStop.stdout) } catch { otherJson = undefined }
  result.stopOtherState = {
    exit: otherStop.status,
    bPid,
    bApi,
    bAlive: alive(bPid),
    bApiAlive: alive(bApi),
    bApiPort,
    apiOpenBefore,
    apiOpenAfter: portOpen(bApiPort),
    recordedState: recorded?.state ?? null,
    recordedPid: recorded?.pid ?? null,
    reportedStatus: otherJson?.status ?? null,
    reportedState: otherJson?.instance?.state ?? null,
    reportedPid: otherJson?.instance?.pid ?? null,
    stdout: otherStop.stdout.slice(0, 300),
  }
  step('stop_other_state_blocked', alive(bPid) && alive(bApi) && otherStop.status !== 0 ? 'PASS' : 'FAIL', JSON.stringify(result.stopOtherState))

  // Launcher dead, API alive: status must be unverified and no stop may kill the live API.
  // If the previous defect already killed state B's API, this window cannot be measured.
  if (!alive(bApi)) {
    result.deadLauncher = { prerequisite: 'state_b_api_killed_by_stop_for_state_a' }
    step('dead_launcher_api_alive', 'NOT_TESTED', JSON.stringify(result.deadLauncher))
    result.ok = false
    process.stdout.write(`${JSON.stringify(result)}\n`)
    process.exit(0)
  }
  process.kill(bPid, 'SIGKILL')
  await new Promise((resolve) => setTimeout(resolve, 500))
  const deadStatus = spawnSync(join(install, 'bin/pa'), ['status', '--json', ...baseArgs], { cwd: w, env: envFor(roots.dataB), encoding: 'utf8', timeout: 20_000 })
  let dead
  try { dead = JSON.parse(deadStatus.stdout) } catch { dead = undefined }
  const deadStop = spawnSync(join(install, 'bin/pa'), ['stop', '--json', '--data-root', roots.dataB, ...baseArgs], { cwd: w, env: envFor(roots.dataB), encoding: 'utf8', timeout: 30_000 })
  result.deadLauncher = { status: dead?.status ?? null, apiAlive: alive(bApi), stopExit: deadStop.status, apiAliveAfterStop: alive(bApi) }
  step('dead_launcher_api_alive', dead?.status === 'UNVERIFIED' && alive(bApi) && alive(bApi) === (result.deadLauncher.apiAliveAfterStop === true), JSON.stringify(result.deadLauncher))
  try { if (alive(bApi)) process.kill(bApi, 'SIGKILL') } catch { /* gone */ }
  result.ok = result.steps.every((item) => item.status === 'PASS')
} catch (error) {
  result.error = String(error?.message ?? error).slice(0, 500)
} finally {
  try { childB?.kill('SIGKILL') } catch { /* gone */ }
  try { spawnSync(join(install, 'bin/pa'), ['stop', '--json', ...baseArgs], { cwd: w, env: envFor(roots.dataB), encoding: 'utf8', timeout: 20_000 }) } catch { /* best effort */ }
}
process.stdout.write(`${JSON.stringify(result)}\n`)
process.exit(0)
