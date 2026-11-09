import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

if (process.argv[2] === '--server') {
  const kind = process.argv[3]
  let behavior = {}
  const configuration = {
    protocol: 'application-configuration/1', revision: 'a'.repeat(64),
    profiles: [{ id: 'fixture', revision: 1, displayName: 'Fixture', driverId: 'controlled-fixture', kind: 'controlled_fixture', readiness: 'fixture_ready', dispatchAllowed: true }],
    projects: [{ id: 'project', displayName: 'Project', scope: { projectId: 'project', allowedPaths: ['.'], excludedPaths: [], externalActions: [] }, profileIds: ['fixture'], defaultProfileId: 'fixture', defaultCriteria: [{ id: 'check', kind: 'machine', required: true, description: 'Actual fixture check', checkDefinitionRef: 'check' }], dispatchAllowed: true }],
    checks: [{ id: 'check', revision: 1, displayName: 'Check' }],
  }
  const server = createServer((request, response) => {
    process.send?.({ request: request.url, kind })
    if (kind === 'console') { response.end('<!doctype html><div id="root"></div>'); return }
    response.setHeader('content-type', 'application/json')
    if (request.url === '/v1/health') { response.end(JSON.stringify({ status: 'ok', mode: behavior.mode ?? 'fixture' })); return }
    if (request.headers.authorization !== 'Bearer ' + 'a'.repeat(64)) { response.writeHead(401); response.end('{}'); return }
    if (request.url === '/v1/configuration') {
      response.end(JSON.stringify(behavior.badConfiguration ? { secret: 'do-not-export-this-sentinel' } : configuration))
      return
    }
    if (request.url === '/v1/snapshot') { response.end(JSON.stringify({ cursor: 0, works: [], questions: [] })); return }
    response.writeHead(404); response.end('{}')
  })
  server.listen(0, '127.0.0.1', () => process.send?.({ origin: `http://127.0.0.1:${server.address().port}`, kind }))
  process.on('message', (message) => {
    behavior = message
    process.send?.({ updated: true, kind })
  })
  const close = () => { server.closeAllConnections(); server.close(() => process.exit(0)) }
  process.once('SIGTERM', close)
  process.once('disconnect', close)
} else {
  const state = process.argv[2]
  const { processStart } = await import(pathToFileURL(process.argv[3]))
  const children = []
  const start = (kind) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--server', kind], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] })
    children.push(child)
    child.once('error', reject)
    child.on('message', (message) => {
      if (message.origin) resolve({ child, origin: message.origin })
      else process.send?.(message)
    })
  })
  const [api, console] = await Promise.all([start('api'), start('console')])
  const record = {
    protocol: 'personal-workbench/1', pid: process.pid, processStart: await processStart(),
    apiPid: api.child.pid, consolePid: console.child.pid, apiURL: api.origin, consoleURL: console.origin, mode: 'fixture',
  }
  writeFileSync(join(state, 'api.key'), 'a'.repeat(64), { mode: 0o600 })
  writeFileSync(join(state, 'workbench.json'), JSON.stringify(record), { mode: 0o600 })
  process.on('message', (message) => api.child.send(message))
  process.send?.({ ready: record })
  let closing = false
  const close = async () => {
    if (closing) return
    closing = true
    await Promise.all(children.map((child) => new Promise((resolve) => {
      child.once('exit', resolve)
      if (child.exitCode !== null) resolve()
      else child.kill('SIGTERM')
    })))
    process.exit(0)
  }
  process.once('SIGTERM', close)
  process.once('disconnect', close)
}
