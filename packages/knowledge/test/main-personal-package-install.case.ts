import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildPersonalChain, projectId, restoreSnapshot } from './helpers/personal-chain.ts'

const packageTar = process.env.PA_WAVE24_PACKAGE ??
  '/Users/hh/Desktop/joker/pa-artifacts/wave23-target/wave23-target-0ede11d.tar.gz'
const expectedTarSha = 'd039889767cb63902ed5e00d02547c441aa2313ce79555d90747e9a0b1fabf21'
const expectedSource = '0ede11d0a46f377e90657c78b001357c98d4f5e7'

async function availablePort(): Promise<number> {
  const { createServer } = await import('node:net')
  const server = createServer()
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const port = (server.address() as { port: number }).port
  await new Promise<void>((done) => server.close(() => done()))
  return port
}

async function until<T>(read: () => Promise<T> | T, predicate: (value: T) => boolean, timeout = 120000): Promise<T> {
  const deadline = Date.now() + timeout
  let latest: T
  for (;;) {
    latest = await read()
    if (predicate(latest)) return latest
    if (Date.now() > deadline) throw new Error(`Package check timed out: ${JSON.stringify(latest)}`)
    await new Promise((done) => setTimeout(done, 100))
  }
}

test('the exact frozen package truly starts, reuses and stops through the single descriptor', { timeout: 600000 }, async (t) => {
  if (!existsSync(packageTar)) {
    t.diagnostic(`NOT_REACHED: exact package missing at ${packageTar}`)
    return
  }
  assert.equal(createHash('sha256').update(readFileSync(packageTar)).digest('hex'), expectedTarSha)
  const root = mkdtempSync(join(tmpdir(), 'pa-wave24-package-'))
  const install = join(root, 'install')
  const chain = await buildPersonalChain(root)
  const restored = join(root, 'restored')
  restoreSnapshot(chain.v1, restored)
  t.after(async () => { await chain.model.close(); rmSync(root, { recursive: true, force: true }) })
  execFileSync('mkdir', ['-p', install])
  execFileSync('tar', ['-xzf', packageTar, '-C', install])
  const installRoot = join(install, 'install')
  const app = join(installRoot, 'app')
  const pa = join(app, 'apps/launcher/bin/pa.mjs')
  assert.equal(JSON.parse(readFileSync(join(installRoot, 'install.json'), 'utf8')).source.commit, expectedSource)
  assert.equal(statSync(pa).isFile(), true)
  const roots = {
    config: join(installRoot, 'var/config'), data: join(installRoot, 'var/data'), cache: join(installRoot, 'var/cache'),
    logs: join(installRoot, 'var/logs'), workspace: join(installRoot, 'var/workspaces'),
  }
  const env = { ...process.env, PA_MODEL_CONFIG: chain.model.file }
  const parseJson = (text: string): Record<string, any> => {
    const trimmed = text.trim()
    try { return JSON.parse(trimmed) } catch { /* find the first object */ }
    const start = trimmed.indexOf('{')
    if (start < 0) throw new Error(`No JSON in pa output: ${trimmed.slice(-500)}`)
    return JSON.parse(trimmed.slice(start))
  }
  const paRaw = (args: string[], timeout = 120000) => {
    try {
      return { code: 0, stdout: execFileSync(process.execPath, [pa, ...args,
        '--install', app, '--config-root', roots.config, '--cache-root', roots.cache,
        '--logs-root', roots.logs, '--workspace-root', roots.workspace], { encoding: 'utf8', timeout, env }) }
    } catch (error) {
      const failure = error as { status?: number; stdout?: string; stderr?: string }
      return { code: failure.status ?? 1, stdout: String(failure.stdout ?? ''), stderr: String(failure.stderr ?? '') }
    }
  }
  const paCall = (args: string[], timeout = 120000) => {
    const result = paRaw(args, timeout)
    if (!result.stdout) throw new Error(`pa ${args[0]} produced no JSON: ${result.stderr}`)
    return parseJson(result.stdout)
  }
  const firstRun = paCall(['first-run', '--json'])
  assert.equal(firstRun.status, 'OK', JSON.stringify(firstRun))
  assert.equal(paCall(['status', '--json']).status, 'STOPPED')

  const driver = new URL('../../context/tools/personal-review-driver.mjs', import.meta.url).pathname
  const driverCall = (extra: string[], ports: { console: number; api: number }) => {
    const stdout = execFileSync(process.execPath, [driver,
      '--dialect', 'package', '--pa-entry', pa, '--install', app, '--state', restored, '--project', projectId,
      '--allow-path', 'src/', '--console-port', String(ports.console), '--api-port', String(ports.api),
      '--model-config', chain.model.file, '--config-root', roots.config,
      '--cache-root', roots.cache, '--logs-root', roots.logs, '--workspace-root', roots.workspace,
      '--work', chain.workId, '--question', chain.question.id, '--candidate-message', chain.sourceMessageId,
      ...extra], { encoding: 'utf8', timeout: 300000 })
    return JSON.parse(stdout.trim().split('\n').at(-1)!) as Record<string, any>
  }

  // Real package start + read-only flow + verified stop through the same executed descriptor.
  const ports = { console: await availablePort(), api: await availablePort() }
  const first = driverCall([], ports)
  assert.equal(first.status, 'verified-flow', JSON.stringify(first.failure))
  assert.equal(first.verified, true)
  assert.equal(first.dialect, 'package')
  assert.equal(first.sourceOnly, false)
  assert.equal(first.descriptor.entry, pa)
  assert.equal(first.entries.review.sha256, first.descriptor.sha256)
  assert.equal(first.identity.bound, true)
  assert.equal(typeof first.identity.recordPid, 'number')
  assert.equal(typeof first.identity.instanceProcessStart, 'string')
  assert.equal(typeof first.identity.instanceApiPid, 'number')
  assert.equal(first.identity.actualHealthDigest, first.identity.requestedDigest)
  assert.equal(first.data.sources?.state, 'verified')
  assert.equal(first.data.work?.phase, 'delivered')
  assert.deepEqual(first.data.delivery?.statuses, ['native_applied'])
  assert.equal(first.data.chat, 422)
  assert.equal(first.data.candidatePrepare, 422)
  assert.equal(first.cleanup.owned, true)
  assert.equal(first.cleanup.stopped, true)
  assert.equal(first.cleanup.detail, 'pa-stop-verified')
  assert.equal(paCall(['status', '--json']).status, 'STOPPED')
  // A legitimate same-selection reuse keeps the original launcher and read selection.
  const reuseFile = join(root, 'reuse-selection.json')
  paCall(['review-restored', '--json', '--state', restored, '--project', projectId, '--allow-path', 'src/', '--out', reuseFile])
  const reusedPorts = { console: await availablePort(), api: await availablePort() }
  const supervisor = spawn(process.execPath, [pa, 'start', ...['--install', app, '--config-root', roots.config,
    '--cache-root', roots.cache, '--logs-root', roots.logs, '--workspace-root', roots.workspace],
    '--json', '--state', restored, '--port', String(reusedPorts.console), '--api-port', String(reusedPorts.api),
    '--discussion-only', '--review-restored-scope', reuseFile], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] } as never)
  let supervisorLog = ''
  ;(supervisor.stdout as NodeJS.ReadableStream).on('data', (bytes) => { supervisorLog += bytes })
  ;(supervisor.stderr as NodeJS.ReadableStream).on('data', (bytes) => { supervisorLog += bytes })
  t.after(() => { if (supervisor.exitCode === null && supervisor.signalCode === null) supervisor.kill('SIGKILL') })
  const running = await until(() => {
    const line = supervisorLog.split('\n').reverse().find((value) => value.trim().startsWith('{'))
    if (!line) return null
    try { return JSON.parse(line) as Record<string, any> } catch { return null }
  }, (value) => value?.status === 'RUNNING')
  assert.equal(running!.status, 'RUNNING')
  const statusRunning = paCall(['status', '--json', '--state', restored])
  const pid = statusRunning.instance.pid as number
  const api = `http://127.0.0.1:${reusedPorts.api}`
  const health = await until(async () => { try { return (await fetch(`${api}/v1/health`)).json() } catch { return null } }, (value) => value?.mode === 'personal')
  assert.equal(health.startupMode, 'recovery_readonly')
  const apiKey = readFileSync(join(restored, 'api.key'), 'utf8').trim()
  const sources = await (await fetch(`${api}/v1/messages/${chain.contextMessageId}/context/sources?scopeReview=1`, {
    headers: { authorization: `Bearer ${apiKey}` } })).json()
  assert.equal(sources.state, 'verified')
  const reused = driverCall(['--review-file', reuseFile, '--reuse'], reusedPorts)
  assert.equal(reused.status, 'reused', JSON.stringify(reused.failure))
  assert.equal(reused.verified, true)
  assert.equal(reused.identity.recordPid, pid)
  assert.equal(reused.cleanup.owned, false)
  assert.equal(reused.cleanup.detail, 'reused-left-running')
  assert.equal(paCall(['status', '--json', '--state', restored]).instance.pid, pid)
  // A different valid selection cannot reuse or replace the original instance.
  const different = join(root, 'different-selection.json')
  paCall(['review-restored', '--json', '--state', restored, '--project', projectId, '--allow-path', 'src/narrow/', '--out', different])
  const refusedRaw = paRaw(['start', '--state', restored, '--port', String(await availablePort()),
    '--api-port', String(await availablePort()), '--discussion-only', '--review-restored-scope', different, '--json'])
  assert.notEqual(refusedRaw.code, 0)
  const refusedJson = parseJson(refusedRaw.stdout)
  assert.equal(refusedJson.status, 'BLOCKED')
  assert.match(String(refusedJson.code), /review|selection|reused|requested/)
  assert.equal(paCall(['status', '--json', '--state', restored]).instance.pid, pid)
  // Missing selection is refused without touching the live instance.
  const missingRaw = paRaw(['start', '--state', restored, '--port', String(await availablePort()),
    '--api-port', String(await availablePort()), '--discussion-only', '--json'])
  assert.notEqual(missingRaw.code, 0)
  const missingJson = parseJson(missingRaw.stdout)
  assert.equal(missingJson.status, 'BLOCKED')
  assert.equal(paCall(['status', '--json', '--state', restored]).instance.pid, pid)
  // The probe-owned package instance is stopped through its verified identity.
  const stopped = paCall(['stop', '--json', '--state', restored])
  await until(() => supervisor.exitCode !== null || supervisor.signalCode !== null, (done) => done, 15000)
  assert.equal(stopped.status, 'STOPPED')
  assert.equal(paCall(['status', '--json']).status, 'STOPPED')
  assert.equal(chain.model.requests.length, chain.modelCalls)
})
