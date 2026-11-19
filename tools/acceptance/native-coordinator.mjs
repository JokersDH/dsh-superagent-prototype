import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ProductStore } from '../../packages/storage/dist/index.js'
import { createProductRuntime } from '../../apps/coordinator/product/runtime.ts'
import { createLocalHttpApp } from '../../apps/coordinator/http/app.ts'
import { listenLocalHttp } from '../../apps/coordinator/http/server.ts'
import { key } from '../../packages/orchestrator-core/dist/index.js'

const [root] = process.argv.slice(2)
const config = JSON.parse(readFileSync(join(root, 'probe-config.json'), 'utf8'))
if (config.root !== root) throw new Error('Wrong isolated probe root')
const store = new ProductStore({ path: join(root, 'state', 'db.sqlite') })
const principal = { userId: 'milestone-probe-user', authorityRef: 'milestone-probe-authority' }
const scope = { projectId: 'isolated-project', allowedPaths: ['.'], excludedPaths: ['.git'], externalActions: [] }
const profile = { id: 'probe-codex', revision: 1, driverId: 'codex-native', driverApiMajor: 1,
  driverRelease: 'milestone-probe', executable: process.execPath,
  argv: [config.proxy, config.codex, config.ledger, config.grant, String(config.limit), config.taskId, config.collaboration ?? 'default'],
  expectedVersion: process.version, nativeConfigRef: 'explicit-isolated-codex', permissionPolicyRevision: 'isolated-worktree-1', requiredFeatures: [] }
const check = { id: 'probe-check', revision: 1, executable: process.execPath,
  argv: ['-e', config.check], deadlineMs: 10000, outputLimitBytes: 16384 }
const product = createProductRuntime({ store, stateRoot: join(root, 'state'), scratchProject: join(root, 'project'), principal,
  actionSecret: Buffer.alloc(32, 83), projects: [{ id: scope.projectId, displayName: 'Isolated native acceptance', scope }],
  native: { profile, approvalPolicy: config.approvalPolicy ?? 'on-request',
    ...(config.collaboration === 'plan' ? { collaborationMode: 'plan' } : {}),
    projects: [{ id: scope.projectId, path: join(root, 'project'), check }] } })
const app = createLocalHttpApp({ application: product.application, principal, apiToken: config.token,
  bootstrapToken: config.token, allowedOrigins: config.uiOrigin ? [config.uiOrigin] : [],
  localDevelopmentAccess: !!config.uiOrigin, mode: 'personal', read: product.read, operations: product.operations })
const server = listenLocalHttp(app, 0)
product.start()
server.once('listening', () => {
  const port = server.address().port
  if ((port >= 5180 && port <= 5191) || (port >= 8796 && port <= 8807)) throw new Error('Protected port')
  process.send?.({ type: 'ready', pid: process.pid, nonce: config.nonce, root, port })
})
process.on('message', async message => {
  if (message?.kind === 'inspect') {
    const view = await product.application.inspect({ workId: message.workId })
    const first = view.works[0], ticketId = first?.links[0]?.ticketId
    const binding = ticketId && store.bindings.current(ticketId)
    const events = store.events.after(0, 10000)
    const productCommands = events.filter(event => event.topic === 'command').flatMap(event => {
      const receipt = store.commands.get(event.entityRef)
      return receipt?.result?.command ? [receipt.result.command] : []
    })
    process.send?.({ type: 'inspection', requestId: message.requestId, view, binding,
      workspace: binding ? product.workspaces.attemptPath(binding.attemptId) : null,
      observations: binding ? store.observations.forAttempt(binding.attemptId, 10000) : [],
      beginCommands: productCommands.filter(command => command.kind === 'begin'),
      answerCommands: productCommands.filter(command => command.kind === 'answer'),
      deliverCommands: productCommands.filter(command => command.kind === 'deliver'),
      resources: binding ? store.observations.summarize(binding.attemptId) : null,
      held: binding ? store.commands.get(key('product-runtime-failure', binding.attemptId))?.result : null,
      parked: store.queue.parked('application.execute') })
  } else if (message?.kind === 'shutdown') {
    try {
      await product.close()
      server.closeAllConnections()
      await new Promise(resolve => server.close(resolve))
      store.close(); process.send?.({ type: 'closed' }); process.disconnect?.()
    } catch (error) { process.send?.({ type: 'error', error: String(error.stack ?? error) }) }
  }
})
