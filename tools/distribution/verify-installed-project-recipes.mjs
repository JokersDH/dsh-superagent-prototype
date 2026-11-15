import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
const APP = process.argv[2]
const { ProductStore } = await import(`${APP}/packages/storage/dist/index.js`)
const { createProductRuntime } = await import(`${APP}/apps/coordinator/product/runtime.ts`)
const { ensureStarterProject, NativeProjectRegistry } = await import(`${APP}/apps/coordinator/product/project-registry.ts`)
const { createLocalHttpApp } = await import(`${APP}/apps/coordinator/http/app.ts`)
const { listenLocalHttp } = await import(`${APP}/apps/coordinator/http/server.ts`)
const root = mkdtempSync('/tmp/pa-installed-j-'), stateRoot = join(root, 'state'); mkdirSync(stateRoot, { mode: 0o700 })
const registry = new NativeProjectRegistry(stateRoot)
const records = ['alpha', 'beta'].map(name => { const path = join(root, name); ensureStarterProject(path); const record = registry.prepare({ path, displayName: name, check: 'node_test' }); registry.save(record); return record })
const store = new ProductStore({ path: join(stateRoot, 'state.sqlite') }), principal = { userId: 'installed-j', authorityRef: 'installed-j-authority' }
const product = createProductRuntime({ store, stateRoot, scratchProject: records[0].path, projectRegistry: registry, principal,
  projects: records.map(record => ({ id: record.id, displayName: record.displayName, scope: { projectId: record.id, allowedPaths: ['src/'], excludedPaths: [], externalActions: [] } })), actionSecret: Buffer.alloc(32, 31) })
const app = createLocalHttpApp({ application: product.application, principal, bootstrapToken: 'b'.repeat(64), apiToken: 'a'.repeat(64), mode: 'fixture', localDevelopmentAccess: true,
  allowedOrigins: ['http://127.0.0.1'], read: product.read, operations: product.operations })
const api = listenLocalHttp(app, 0); await once(api, 'listening'); const port = api.address().port, headers = { authorization: `Bearer ${'a'.repeat(64)}`, 'content-type': 'application/json' }
const input = { projectId: records[0].id, kind: 'scoped_change', allowedPaths: ['src/'], profileId: 'profile-fixture-pass' }
const response = await fetch(`http://127.0.0.1:${port}/v1/projects/${records[0].id}/recipes/preview`, { method: 'POST', headers, body: JSON.stringify(input) })
const body = await response.json(); const before = store.events.cursor()
console.log(JSON.stringify({ status: body.status, responseStatus: response.status, title: body.title, inputMatches: JSON.stringify(body.input) === JSON.stringify(input), authorization: body.authorization, fields: body.fields !== null, issues: body.issues, events: before }))
assert.equal(response.status, 200); assert.equal(body.status, 'draft'); assert.equal(body.authorization, 'none'); assert.equal(store.events.cursor(), 0)
api.close(); store.close()
