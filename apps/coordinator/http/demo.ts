import { randomBytes } from 'node:crypto'
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { parseArgs } from 'node:util'
import { createProductApplication } from '@personal-agent/application'
import { InstanceRegistry, ProductStore, WriterLock } from '@personal-agent/storage'
import { createLocalHttpApp } from './app.ts'
import { listenLocalHttp } from './server.ts'

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: '8787' },
    state: { type: 'string', default: '.local-state/http-demo' },
    'console-origin': { type: 'string', default: 'http://127.0.0.1:5173' },
  },
})
const port = Number(values.port),
  state = resolve(values.state!)
mkdirSync(state, { recursive: true, mode: 0o700 })
const directory = lstatSync(state)
if (!directory.isDirectory() || directory.isSymbolicLink() || (directory.mode & 0o077) !== 0 || (process.getuid && directory.uid!==process.getuid()))
  throw new Error('HTTP demo state requires a private owned directory')
function credential(name: string): string {
  const path = join(state, name)
  try {
    const fd = openSync(path, 'wx', 0o600)
    try {
      const bytes = Buffer.from(randomBytes(32).toString('hex'))
      for (let offset = 0; offset < bytes.length; ) offset += writeSync(fd, bytes, offset)
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== 64 || (stat.mode & 0o077) !== 0 || (process.getuid && stat.uid!==process.getuid()))
    throw new Error('Invalid local credential file')
  const value = readFileSync(path, 'utf8')
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error('Invalid local credential encoding')
  return value
}
const store = new ProductStore({ path: join(state, 'state.sqlite'), artifactsRoot: join(state, 'artifacts') })
const lock = new WriterLock(state, new InstanceRegistry(store.db))
try {
  lock.acquire()
} catch (error) {
  store.close()
  throw error
}
const principal = { userId: 'local-demo-user', authorityRef: 'local-demo-authority' }
const application = createProductApplication({
  store,
  principal,
  projects: [
    {
      id: 'project-atlas',
      scope: { projectId: 'project-atlas', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] },
    },
  ],
  profileIds: ['profile-codex-local'],
  registeredChecks: ['check:unit', 'check-unit', 'unit-tests'],
  actionSecret: Buffer.from(credential('action.key'), 'hex'),
  nativeFence: () => 'unknown',
})
const http = createLocalHttpApp({
  application,
  principal,
  apiToken: credential('api.key'),
  bootstrapToken: credential('bootstrap.key'),
  allowedOrigins: [`http://127.0.0.1:${port}`, values['console-origin']!],
  mode: 'fixture',
  read: { deliveries: async (questionId) => application.questions.currentDeliveries(questionId) },
})
const server = listenLocalHttp(http, port)
const heartbeat = setInterval(() => lock.heartbeat(), 5000)
const shutdown = () => {
  clearInterval(heartbeat)
  server.close(() => {
    lock.release()
    store.close()
  })
  server.closeAllConnections()
}
server.once('error', (error) => {
  clearInterval(heartbeat)
  lock.release()
  store.close()
  console.error(error.message)
  process.exitCode = 1
})
process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)
server.once('listening', () => {
  console.log(`Local API sandbox: http://127.0.0.1:${port}/v1/health`)
  console.log(`Private state/credential references: ${state}`)
  console.log('Execution effects are retained but not dispatched; no vendor model is called.')
})
