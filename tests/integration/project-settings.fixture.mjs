import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProductStore } from '../../packages/storage/dist/index.js'
import { NativeProjectRegistry, ensureStarterProject } from '../../apps/coordinator/product/project-registry.ts'
import { createProductRuntime } from '../../apps/coordinator/product/runtime.ts'
import { createLocalHttpApp } from '../../apps/coordinator/http/app.ts'

/** Configuration-only native profile fixture; never start this runtime or dispatch a model task. */
export function projectSettingsFixture() {
  const root = mkdtempSync(join(tmpdir(), 'pa-settings-')), stateRoot = join(root, 'state'), projectPath = join(root, 'project')
  mkdirSync(stateRoot, { mode: 0o700 }); ensureStarterProject(projectPath)
  let registry = new NativeProjectRegistry(stateRoot)
  const record = registry.prepare({ path: projectPath, displayName: '支付服务', check: 'node_test' })
  registry.save(record)
  const principal = { userId: 'settings-user', authorityRef: 'settings-authority' }, actor = { ...principal, source: 'local_ui' }
  const profile = { id: 'configuration-fixture-profile', revision: 1, driverId: 'codex-native', driverApiMajor: 1,
    driverRelease: 'configuration-fixture', executable: process.execPath, argv: [], expectedVersion: process.version,
    nativeConfigRef: 'fixture-settings', permissionPolicyRevision: 'fixture-policy', requiredFeatures: [] }
  let store = new ProductStore({ path: join(stateRoot, 'state.sqlite') }), product
  const make = () => createProductRuntime({ store, principal, stateRoot, scratchProject: projectPath, actionSecret: Buffer.alloc(32, 1), projectRegistry: registry,
    projects: registry.list().map(project => ({ id: project.id, displayName: project.displayName, scope: registry.scope(project) })),
    native: { profile, projects: registry.list().map(project => ({ id: project.id, path: project.path, check: registry.check(project),
      ...(project.environment ? { environment: registry.environment(project) } : {}) })), approvalPolicy: 'on-request' } })
  product = make()
  return { root, stateRoot, projectPath, principal, actor, profile, projectId: record.id,
    get product() { return product }, get store() { return store },
    http: (origin = 'http://127.0.0.1:5180') => createLocalHttpApp({ application: product.application, principal, bootstrapToken: 'b'.repeat(64), apiToken: 'a'.repeat(64),
      allowedOrigins: [origin], mode: 'fixture', localDevelopmentAccess: true, read: product.read, operations: product.operations }),
    reopen: async () => { await product.close(); store.close(); registry = new NativeProjectRegistry(stateRoot); store = new ProductStore({ path: join(stateRoot, 'state.sqlite') }); product = make() },
    close: async () => { await product.close(); store.close(); rmSync(root, { recursive: true, force: true }) } }
}
