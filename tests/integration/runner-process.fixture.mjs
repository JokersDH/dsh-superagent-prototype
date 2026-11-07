import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createRunnerCredential, connectRunnerRecovery } from '../../apps/coordinator/runner-link.ts'
import { producer } from './runtime-ingress-fixture.ts'

const servicePath = fileURLToPath(new URL('./runner-service.fixture.mjs', import.meta.url))
function worker(path, args, expectReply = true) {
  const child = spawn(process.execPath, [path, ...args], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
  let stderr = ''
  child.stderr.on('data', chunk => { stderr += chunk.toString() })
  const exit = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })) })
  const message = expectReply ? new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill('SIGTERM'); reject(new Error(`Fixture timed out: ${stderr}`)) }, 7000)
    child.once('message', value => { clearTimeout(timeout); resolve(value) })
    child.once('error', error => { clearTimeout(timeout); reject(error) })
    child.once('exit', (code, signal) => { clearTimeout(timeout); reject(new Error(`Fixture exited before reply: ${code}/${signal} ${stderr}`)) })
  }) : undefined
  return { child, exit, message, stderr: () => stderr }
}

export async function ownedRunnerFixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'pa-peer-'))
  createRunnerCredential(join(directory, 'runner.key'))
  const service = worker(servicePath, [directory]), clients = []
  let endpoint
  t.after(async () => {
    for (const client of clients) {
      if (client.child.exitCode === null && client.child.signalCode === null) client.child.kill('SIGKILL')
      await client.exit
    }
    if (endpoint) {
      try { await connectRunnerRecovery(endpoint, producer).cancel({ ...producer.attempt, id: 'cleanup-cancel', kind: 'cancel' }) } catch {}
    }
    if (service.child.connected) service.child.send('shutdown')
    const timeout = setTimeout(() => service.child.kill('SIGTERM'), 3000)
    await service.exit
    clearTimeout(timeout)
    rmSync(directory, { recursive: true, force: true })
  })
  const ready = await service.message
  endpoint = ready.endpoint
  return { directory, ready, startClient: (path, args, expectReply = true) => {
    const client = worker(path, [directory, ...args], expectReply); clients.push(client); return client
  } }
}
