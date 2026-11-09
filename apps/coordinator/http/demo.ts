import { resolve, join } from 'node:path'
import { parseArgs } from 'node:util'
import { createProductApplication } from '@personal-agent/application'
import { InstanceRegistry, ProductStore, WriterLock } from '@personal-agent/storage'
import { createLocalHttpApp } from './app.ts'
import { listenLocalHttp } from './server.ts'
import { localCredentials } from './local-state.ts'

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: '8787' },
    state: { type: 'string', default: '.local-state/http-demo' },
    'console-origin': { type: 'string', default: 'http://127.0.0.1:5173' },
  },
})
const port = Number(values.port),
  state = resolve(values.state!)
const credential = localCredentials(state)
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
