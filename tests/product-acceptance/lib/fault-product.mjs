import { execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProductStore } from '../../../packages/storage/dist/index.js'
import { ApplicationFault } from '../../../packages/application/dist/index.js'
import { createControlledProduct } from '../../../apps/coordinator/product/runtime.ts'
import { createLocalHttpApp } from '../../../apps/coordinator/http/app.ts'
import { listenLocalHttp } from '../../../apps/coordinator/http/server.ts'
import { LocalProductClient } from './http-client.mjs'
import { pickPort } from './instance.mjs'

const API_TOKEN = 'a'.repeat(64)
const BOOTSTRAP_TOKEN = 'b'.repeat(64)

export const FAULT_API_TOKEN = API_TOKEN

/** Disposable Git project for the controlled scratch executor. */
export function scratchProject() {
  const root = mkdtempSync(join(tmpdir(), 'pa-fault-'))
  const project = join(root, 'project')
  mkdirSync(project)
  const git = (args) => execFileSync('git', args, { cwd: project, stdio: 'pipe' })
  git(['init', '-q'])
  mkdirSync(join(project, 'src'))
  writeFileSync(join(project, 'src/.gitkeep'), '')
  git(['add', 'src/.gitkeep'])
  git(['-c', 'user.name=Acceptance Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'base'])
  return { root, project }
}

/**
 * In-process product composition whose completion port can fail on demand. Only the failure is
 * injected; every observable assertion still goes through the public HTTP API and the real
 * application/verification composition.
 */
export async function startFaultProduct({ stateRoot, projectPath, scope, projects, principal, allowedOrigins, localDevelopmentAccess = false }) {
  const owner = principal ?? { userId: 'wave04-recovery-user', authorityRef: 'wave04-recovery-authority' }
  const configured = projects ?? [{ id: scope.projectId, scope }]
  const store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
  const product = createControlledProduct({
    store,
    principal: owner,
    projects: configured.map((item) => ({ id: item.id, scope: item.scope })),
    actionSecret: Buffer.alloc(32, 1),
    stateRoot,
    scratchProject: projectPath,
  })
  const verify = product.completion.verify.bind(product.completion)
  const fault = { active: false }
  product.completion.verify = async (...args) => {
    if (fault.active) throw new ApplicationFault('verification_failed', 'acceptance-injected-failure')
    return verify(...args)
  }
  const port = await pickPort()
  const server = listenLocalHttp(
    createLocalHttpApp({
      application: product.application,
      principal: owner,
      bootstrapToken: BOOTSTRAP_TOKEN,
      apiToken: API_TOKEN,
      allowedOrigins: allowedOrigins ?? [`http://127.0.0.1:${port}`],
      mode: 'fixture',
      localDevelopmentAccess,
      read: product.read,
      operations: product.operations,
    }),
    port,
  )
  await once(server, 'listening')
  product.start()
  return {
    store,
    product,
    fault,
    port,
    client: new LocalProductClient({ baseURL: `http://127.0.0.1:${port}`, token: API_TOKEN, timeoutMs: 20_000 }),
    async close() {
      await product.close()
      await new Promise((resolveClose) => server.close(resolveClose))
      server.closeAllConnections?.()
    },
    async reopen() {
      const next = createControlledProduct({
        store,
        principal: owner,
        projects: configured.map((item) => ({ id: item.id, scope: item.scope })),
        actionSecret: Buffer.alloc(32, 1),
        stateRoot,
        scratchProject: projectPath,
      })
      const nextPort = await pickPort()
      const nextServer = listenLocalHttp(
        createLocalHttpApp({
          application: next.application,
          principal: owner,
          bootstrapToken: BOOTSTRAP_TOKEN,
          apiToken: API_TOKEN,
          allowedOrigins: allowedOrigins ?? [`http://127.0.0.1:${nextPort}`],
          mode: 'fixture',
          localDevelopmentAccess,
          read: next.read,
          operations: next.operations,
        }),
        nextPort,
      )
      await once(nextServer, 'listening')
      next.start()
      return {
        product: next,
        port: nextPort,
        client: new LocalProductClient({ baseURL: `http://127.0.0.1:${nextPort}`, token: API_TOKEN, timeoutMs: 20_000 }),
        async close() {
          await next.close()
          await new Promise((resolveClose) => nextServer.close(resolveClose))
          nextServer.closeAllConnections?.()
        },
      }
    },
  }
}
