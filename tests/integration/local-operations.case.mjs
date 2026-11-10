import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { ApplicationConfigurationSchema } from '../../packages/contracts/dist/index.js'
import { diagnose } from '../../tools/dev/doctor.mjs'
import { instanceState, localJson, localOrigin, probeInstance, readInstanceRecord, readPrivateState, verifyLauncher } from '../../tools/dev/local-instance.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const parseConfiguration = (value) => ApplicationConfigurationSchema.parse(value)
const code = (expected) => (error) => error.code === expected
const execute = promisify(execFile)

function temporary(t) {
  const directory = mkdtempSync('/tmp/pa-local-operations-')
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  return directory
}
async function fixture(t) {
  const directory = temporary(t), state = join(directory, 'state')
  mkdirSync(state, { mode: 0o700 })
  mkdirSync(join(directory, 'tools/dev'), { recursive: true })
  mkdirSync(join(directory, 'packages/contracts'), { recursive: true })
  symlinkSync(join(root, 'packages/contracts/dist'), join(directory, 'packages/contracts/dist'))
  const executable = join(directory, 'tools/dev/workbench.mjs')
  cpSync(new URL('./local-operations.fixture.mjs', import.meta.url), executable)
  const child = spawn(process.execPath, [executable, state, join(root, 'tools/dev/local-instance.mjs')], {
    cwd: directory, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  })
  let stderr = ''
  child.stderr.on('data', (bytes) => { stderr = (stderr + bytes).slice(-2000) })
  t.after(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return
    const exit = once(child, 'exit')
    child.kill('SIGTERM')
    const deadline = setTimeout(() => child.kill('SIGKILL'), 3000)
    try { await exit } finally { clearTimeout(deadline) }
  })
  const record = await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error('fixture startup timeout: ' + stderr)), 8000)
    child.on('message', (message) => { if (message.ready) { clearTimeout(deadline); resolve(message.ready) } })
    child.once('error', reject)
    child.once('exit', () => { clearTimeout(deadline); reject(new Error('fixture exited: ' + stderr)) })
  })
  return {
    root: directory, state, record,
    probe: (extra = {}) => probeInstance({ root: directory, state, parseConfiguration, ...extra }),
    save: (value) => writeFileSync(join(state, 'workbench.json'), JSON.stringify(value), { mode: 0o600 }),
    behavior: (value) => new Promise((resolve) => {
      const onMessage = (message) => { if (message.updated) { child.off('message', onMessage); resolve() } }
      child.on('message', onMessage)
      child.send(value)
    }),
  }
}
async function server(t, handler) {
  const instance = createServer(handler)
  await new Promise((resolve) => instance.listen(0, '127.0.0.1', resolve))
  t.after(async () => { instance.closeAllConnections(); await new Promise((resolve) => instance.close(resolve)) })
  return `http://127.0.0.1:${instance.address().port}`
}

test('local origins refuse remote/DNS/userinfo/path/query inputs before any credential read', () => {
  for (const value of ['https://127.0.0.1:8000', 'http://localhost:8000', 'http://example.invalid:8000', 'http://127.0.0.1:8000/', 'http://user:secret@127.0.0.1:8000', 'http://127.0.0.1:8000?token=secret', undefined])
    assert.throws(() => localOrigin(value), code('invalid_local_origin'))
  assert.equal(localOrigin('http://127.0.0.1:8000'), 'http://127.0.0.1:8000')
  assert.equal(instanceState('/repository', 'private-state'), '/repository/private-state')
})
test('read-only state reads never create credentials and reject loose permissions and symlinks', (t) => {
  const directory = temporary(t), state = join(directory, 'state')
  assert.throws(() => readPrivateState(state, 'api.key'), code('state_missing'))
  assert.equal(existsSync(state), false)
  mkdirSync(state, { mode: 0o700 })
  writeFileSync(join(state, 'api.key'), 'a'.repeat(64), { mode: 0o644 })
  assert.throws(() => readPrivateState(state, 'api.key'), code('unsafe_state_file'))
  chmodSync(join(state, 'api.key'), 0o600)
  assert.equal(readPrivateState(state, 'api.key', 64).length, 64)
  symlinkSync(join(state, 'api.key'), join(state, 'other.key'))
  assert.throws(() => readPrivateState(state, 'other.key'))
  chmodSync(state, 0o755)
  assert.throws(() => readPrivateState(state, 'api.key'), code('unsafe_state_directory'))
})
test('local API reads reject redirects without sending credentials to the target', async (t) => {
  let targetRequests = 0
  const target = await server(t, (_request, response) => { targetRequests++; response.end('{}') })
  const origin = await server(t, (_request, response) => { response.writeHead(302, { location: target + '/v1/configuration' }); response.end() })
  await assert.rejects(localJson(origin, '/v1/configuration', { bearer: 'private-sentinel' }), code('api_unavailable'))
  assert.equal(targetRequests, 0)
})
test('local API reads bound streaming bodies and hanging responses', async (t) => {
  const large = await server(t, (_request, response) => { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ text: 'x'.repeat(1024) })) })
  await assert.rejects(localJson(large, '/v1/health', { maxBytes: 32 }), code('api_response_too_large'))
  const hanging = await server(t, (_request, response) => { response.setHeader('content-type', 'application/json'); response.write('{') })
  await assert.rejects(localJson(hanging, '/v1/health', { timeoutMs: 50 }), code('api_timeout'))
})
test('an owned launcher, its listeners and authenticated shared configuration can be verified read-only', async (t) => {
  const h = await fixture(t)
  const before = ['api.key', 'workbench.json'].map((name) => readFileSync(join(h.state, name), 'utf8'))
  const instance = await h.probe({ expectedMode: 'fixture' })
  assert.equal(instance.health.mode, 'fixture')
  assert.equal(instance.configuration.projects[0].id, 'project')
  assert.deepEqual(await instance.read('/v1/snapshot'), { cursor: 0, works: [], questions: [] })
  assert.deepEqual(['api.key', 'workbench.json'].map((name) => readFileSync(join(h.state, name), 'utf8')), before)
  assert.equal(instance.identity.legacy, false)
})
test('legacy metadata is verified against actual health, not its historical wrong mode label', async (t) => {
  const h = await fixture(t)
  const { protocol, processStart, ...legacy } = h.record
  h.save({ ...legacy, mode: 'controlled-fixture' })
  const instance = await h.probe()
  assert.equal(instance.identity.legacy, true)
  assert.equal(instance.health.mode, 'fixture')
})
test('PID start changes and foreign listener PIDs cannot reuse an instance or read its credential', async (t) => {
  const h = await fixture(t)
  h.save({ ...h.record, processStart: 'a different process start' })
  await assert.rejects(h.probe(), code('process_identity_mismatch'))
  h.save({ ...h.record, apiPid: process.pid })
  await assert.rejects(h.probe())
  await assert.rejects(verifyLauncher(root, h.record), code('process_identity_mismatch'))
  h.save({ ...h.record, apiURL: 'http://example.invalid:9000' })
  assert.throws(() => readInstanceRecord(h.state), code('invalid_local_origin'))
})
test('wrong mode and a mismatching state credential fail instead of silently reusing a service', async (t) => {
  const h = await fixture(t)
  await assert.rejects(h.probe({ expectedMode: 'personal' }), code('instance_mode_mismatch'))
  writeFileSync(join(h.state, 'api.key'), 'b'.repeat(64))
  await assert.rejects(h.probe(), code('authentication_failed'))
})
test('doctor exports only validated summaries and does not confuse fixtures with native admission', async (t) => {
  const h = await fixture(t)
  const report = await diagnose({ repositoryRoot: h.root, state: h.state })
  assert.equal(report.checks.find((check) => check.id === 'instance').status, 'PASS')
  assert.equal(report.checks.find((check) => check.id === 'native-admission').status, 'NOT_TESTED')
  assert.equal(report.checks.find((check) => check.id === 'environment').status, 'NOT_TESTED')
  assert.doesNotMatch(JSON.stringify(report), new RegExp('a'.repeat(64)))
  await h.behavior({ badConfiguration: true })
  const invalid = await diagnose({ repositoryRoot: h.root, state: h.state })
  assert.equal(invalid.status, 'BLOCKED')
  assert.doesNotMatch(JSON.stringify(invalid), /do-not-export-this-sentinel|authorization|Bearer /)
})
test('doctor with absent state remains read-only and has a strict non-green result', async (t) => {
  const state = join(temporary(t), 'missing')
  const report = await diagnose({ repositoryRoot: root, state })
  assert.equal(report.status, 'BLOCKED')
  assert.equal(report.checks.find((check) => check.id === 'instance').code, 'state_missing')
  assert.equal(existsSync(state), false)
})

test('explicit diagnostic export is private, contains no raw credential and never overwrites a file', async (t) => {
  const directory = temporary(t), output = join(directory, 'diagnosis.json')
  const args = ['tools/dev/doctor.mjs', '--state', join(directory, 'absent-state'), '--json', '--output', output]
  await assert.rejects(execute(process.execPath, args, { cwd: root }), (error) => error.code === 1)
  const bytes = readFileSync(output, 'utf8')
  assert.equal(JSON.parse(bytes).status, 'BLOCKED')
  assert.equal(statSync(output).mode & 0o777, 0o600)
  await assert.rejects(execute(process.execPath, args, { cwd: root }), (error) => error.code === 1)
  assert.equal(readFileSync(output, 'utf8'), bytes)
  assert.equal(existsSync(join(directory, 'absent-state')), false)
})

test('the real launcher records fixture identity and shuts down its own listeners without touching the user instance', { timeout: 30000 }, async (t) => {
  const state = join(temporary(t), 'state')
  const userRecord = join(root, '.local-state/workbench/workbench.json')
  const before = existsSync(userRecord) ? readFileSync(userRecord) : undefined
  const reservePort = async () => {
    const socket = createServer()
    await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve))
    const port = socket.address().port
    await new Promise((resolve) => socket.close(resolve))
    return port
  }
  const consolePort = await reservePort(), apiPort = await reservePort()
  const child = spawn(process.execPath, ['tools/dev/workbench.mjs', '--fixture', '--state', state, '--port', String(consolePort), '--api-port', String(apiPort)], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
  })
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exit = once(child, 'exit')
      child.kill('SIGTERM')
      const deadline = setTimeout(() => child.kill('SIGKILL'), 12000)
      try { await exit } finally { clearTimeout(deadline) }
    }
  })
  await new Promise((resolve, reject) => {
    let output = ''
    const deadline = setTimeout(() => reject(new Error('real launcher startup timeout: ' + output.slice(-1000))), 20000)
    const capture = (bytes) => {
      output += bytes
      if (output.includes('Workbench: ')) { clearTimeout(deadline); resolve() }
    }
    child.stdout.on('data', capture)
    child.stderr.on('data', capture)
    child.once('exit', () => { clearTimeout(deadline); reject(new Error('real launcher exited before ready: ' + output.slice(-1000))) })
  })
  const instance = await probeInstance({ root, state, expectedMode: 'fixture', parseConfiguration })
  assert.equal(instance.record.protocol, 'personal-workbench/1')
  assert.equal(instance.record.mode, 'fixture')
  assert.equal(instance.identity.legacy, false)
  assert.equal(instance.configuration.profiles.some((profile) => profile.kind === 'native'), false)
  const exited = once(child, 'exit')
  child.kill('SIGTERM')
  await exited
  for (const pid of [instance.record.apiPid, instance.record.consolePid])
    assert.throws(() => process.kill(pid, 0), (error) => error.code === 'ESRCH')
  if (before) assert.deepEqual(readFileSync(userRecord), before)
  else assert.equal(existsSync(userRecord), false)
})
