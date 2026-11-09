import { resolve, join } from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { InstanceRegistry, ProductStore, WriterLock } from '@personal-agent/storage'
import { createLocalHttpApp } from '../http/app.ts'
import { localCredentials } from '../http/local-state.ts'
import { listenLocalHttp } from '../http/server.ts'
import { createControlledProduct } from './runtime.ts'
import { ensureScratchProject } from './scratch.ts'
import { PrivateModelProvider } from './model-provider.ts'

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: '8791' },
    state: {
      type: 'string',
      default: fileURLToPath(new URL('../../../.local-state/product-demo', import.meta.url)),
    },
    'console-origin': { type: 'string', default: 'http://127.0.0.1:5174' },
    'local-access': { type: 'boolean', default: false },
    assistant: { type: 'boolean', default: false },
  },
})
const stateRoot = resolve(values.state!),
  port = Number(values.port)
const credential = localCredentials(stateRoot)
const store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
const lock = new WriterLock(stateRoot, new InstanceRegistry(store.db))
try {
  lock.acquire()
} catch (error) {
  store.close()
  throw error
}
const principal = {
  userId: 'local-demo-user',
  authorityRef: 'local-demo-authority',
}
const product = createControlledProduct({
  store,
  principal,
  stateRoot,
  scratchProject: ensureScratchProject(stateRoot),
  projects: [
    {
      id: 'project-atlas',
      displayName: '本地验证项目',
      scope: {
        projectId: 'project-atlas',
        allowedPaths: ['src/'],
        excludedPaths: [],
        externalActions: [],
      },
    },
  ],
  actionSecret: Buffer.from(credential('action.key'), 'hex'),
  ...(values.assistant ? { assistantProvider: new PrivateModelProvider() } : {}),
})
const http = createLocalHttpApp({
  application: product.application,
  principal,
  apiToken: credential('api.key'),
  bootstrapToken: credential('bootstrap.key'),
  allowedOrigins: [`http://127.0.0.1:${port}`, values['console-origin']!],
  mode: 'fixture',
  localDevelopmentAccess: values['local-access'] === true,
  read: product.read,
})
const server = listenLocalHttp(http, port)
product.start()
const heartbeat = setInterval(() => lock.heartbeat(), 5000)
let closing: Promise<void> | undefined
const shutdown = () =>
  (closing ??= (async () => {
    clearInterval(heartbeat)
    const closed = new Promise<void>((resolve) => server.close(() => resolve()))
    server.closeAllConnections()
    await product.close()
    await closed
    lock.release()
    store.close()
  })())
server.once('error', (error) => {
  console.error(error.message)
  process.exitCode = 1
  void shutdown()
})
process.once('SIGTERM', () => {
  void shutdown()
})
process.once('SIGINT', () => {
  void shutdown()
})
server.once('listening', () => {
  console.log(`Controlled product API: http://127.0.0.1:${port}/v1/health`)
  console.log(`Private state/credential references: ${stateRoot}`)
  console.log(
    values.assistant
      ? 'Model dialogue enabled when privately configured; work execution uses controlled scratch profiles.'
      : 'Real scratch subprocess, questions and artifact verification; fixture profiles only; zero vendor calls.',
  )
})
