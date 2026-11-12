import { resolve, join } from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { InstanceRegistry, ProductStore, WriterLock } from '@personal-agent/storage'
import { createLocalHttpApp } from '../http/app.ts'
import { localCredentials } from '../http/local-state.ts'
import { listenLocalHttp } from '../http/server.ts'
import { createProductRuntime } from './runtime.ts'
import { ensureScratchProject } from './scratch.ts'
import { PrivateModelProvider } from './model-provider.ts'
import { DISCUSSION_PROJECT, preparePersonalStartup } from './native-startup.ts'
import { NativeProjectRegistry } from './project-registry.ts'

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
    native: { type: 'boolean', default: false },
    'discussion-only': { type: 'boolean', default: false },
    'startup-mode': { type: 'string', default: 'normal' },
  },
})
const stateRoot = resolve(values.state!),
  port = Number(values.port)
if (!['normal', 'recovery_readonly'].includes(values['startup-mode']!)) throw new Error('Unsupported startup mode')
const recovery = values['startup-mode'] === 'recovery_readonly' || existsSync(join(stateRoot, 'restore-report.json'))
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
let product: ReturnType<typeof createProductRuntime> | undefined
try {
  const personal = values.native || values['discussion-only']
  const personalStartup = personal && !recovery ? preparePersonalStartup(stateRoot, { discussionOnly: values['discussion-only'] }) : undefined
  const native = personalStartup && 'native' in personalStartup ? personalStartup.native : undefined
  const executionUnavailable = personalStartup && 'executionUnavailable' in personalStartup ? personalStartup.executionUnavailable : undefined
  const restoredProjects = recovery ? new NativeProjectRegistry(stateRoot).list().map(project => ({ id: project.id,
    displayName: project.displayName, scope: { projectId: project.id, allowedPaths: ['.'], excludedPaths: ['.git'], externalActions: [] } })) : []
  const activeProduct = createProductRuntime({
    store,
    principal,
    stateRoot,
    startupMode: recovery ? 'recovery_readonly' : 'normal',
    scratchProject: executionUnavailable || recovery ? join(stateRoot, 'discussion-scratch') : ensureScratchProject(stateRoot),
    projects: [
      ...(personalStartup?.projects ?? []),
      ...restoredProjects.filter(project => project.id !== 'project-atlas'),
      ...(personal ? [DISCUSSION_PROJECT] : []),
      ...(!executionUnavailable ? [{
        id: 'project-atlas',
        displayName: '流程测试项目',
        scope: {
          projectId: 'project-atlas',
          allowedPaths: ['src/'],
          excludedPaths: [],
          externalActions: [],
        },
      }] : []),
    ],
    actionSecret: Buffer.from(credential('action.key'), 'hex'),
    ...(values.assistant && !recovery ? { assistantProvider: new PrivateModelProvider() } : {}),
    ...(native ? { native } : {}),
    ...(personalStartup ? { projectRegistry: personalStartup.registry, workspaceRoot: personalStartup.workspaceRoot } : {}),
    ...(executionUnavailable ? { executionUnavailable } : {}),
  })
  product = activeProduct
  const http = createLocalHttpApp({
    application: activeProduct.application,
    principal,
    apiToken: credential('api.key'),
    bootstrapToken: credential('bootstrap.key'),
    allowedOrigins: [`http://127.0.0.1:${port}`, values['console-origin']!],
    mode: personal ? 'personal' : 'fixture',
    startupMode: recovery ? 'recovery_readonly' : 'normal',
    localDevelopmentAccess: values['local-access'] === true,
    read: activeProduct.read,
    operations: activeProduct.operations,
  })
  const server = listenLocalHttp(http, port)
  if (!recovery) activeProduct.start()
  const heartbeat = setInterval(() => lock.heartbeat(), 5000)
  let closing: Promise<void> | undefined
  const shutdown = () =>
    (closing ??= (async () => {
      clearInterval(heartbeat)
      const closed = new Promise<void>((resolve) => server.close(() => resolve()))
      server.closeAllConnections()
      await activeProduct.close()
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
    console.log(`Personal product API: http://127.0.0.1:${port}/v1/health`)
    console.log(`Private state/credential references: ${stateRoot}`)
    console.log(
      recovery
        ? 'Recovery read-only: business queues and model providers are disabled; local revalidation is required.'
        : executionUnavailable
        ? `Personal discussion mode: execution unavailable (${executionUnavailable}); business queues are retained.`
        : personal
        ? 'Native Codex MVP enabled: isolated worktrees, registered checks and reviewed patch delivery.'
        : values.assistant
        ? 'Model dialogue enabled when privately configured; work execution uses controlled scratch profiles.'
        : 'Real scratch subprocess, questions and artifact verification; fixture profiles only; zero vendor calls.',
    )
  })
} catch (error) {
  await product?.close()
  lock.release()
  store.close()
  throw error
}
