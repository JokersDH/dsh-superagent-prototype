#!/usr/bin/env node
/**
 * D5: non-empty current-schema data through A/main public product paths, then A snapshot backup,
 * a new-root restore copy and A public readers. Also: future schema refusal and schema16 -> 18
 * migration through A's public Store. No SQL is written by D and no model/native request is sent.
 *
 * usage: verify-schema18-data.mjs --install <frozen install> [--legacy-install <schema16 install>] [--json]
 */
import { createServer } from 'node:net'
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, closeSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const { values } = parseArgs({ options: { install: { type: 'string' }, 'legacy-install': { type: 'string' }, json: { type: 'boolean', default: false } } })
const repo = resolve(new URL('../..', import.meta.url).pathname)
const root = mkdtempSync(join(tmpdir(), 'pa-schema18-'))
chmodSync(root, 0o700)
const evidence = { protocol: 'wave12-schema18-data/1', status: 'FAIL', startedAt: new Date().toISOString(), steps: [], limitations: [
  'Data is created through main product operations with a bounded fixture provider; no model/native request is sent.',
  'A owns the snapshot/migrations; D only calls public Store/backup/reader entrypoints and writes no SQL.',
] }
const step = (id, status, detail = {}) => { evidence.steps.push({ id, status, detail }); if (status !== 'PASS') process.stderr.write(`${status} ${id} ${JSON.stringify(detail).slice(0, 400)}\n`) }
const run = (cli, args, timeout = 180_000) => {
  const result = spawnSync(cli, args, { encoding: 'utf8', timeout })
  let json = null; try { json = JSON.parse(result.stdout) } catch { /* not json */ }
  return { status: result.status, json, stdout: result.stdout, stderr: result.stderr }
}
const freePort = () => new Promise((r) => { const server = createServer(); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => r(port)) }) })
const waitHealth = async (port, timeoutMs = 60_000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) { try { const res = await fetch(`http://127.0.0.1:${port}/v1/health`, { signal: AbortSignal.timeout(800) }); if (res.ok) return await res.json() } catch { /* not ready */ } await new Promise((r) => setTimeout(r, 200)) }
  return null
}
const started = new Set()
const rootsAt = (name, install) => {
  const base = join(root, name)
  const roots = { install, config: join(base, 'config'), data: join(base, 'state'), cache: join(base, 'cache'), logs: join(base, 'logs'), workspace: join(base, 'workspace') }
  for (const path of [roots.config, roots.data, roots.cache, roots.logs, roots.workspace]) mkdirSync(path, { recursive: true, mode: 0o700 })
  return roots
}
const argsOf = (roots) => ['--install', roots.install, '--config-root', roots.config, '--data-root', roots.data, '--cache-root', roots.cache, '--logs-root', roots.logs, '--workspace-root', roots.workspace]
const startStop = async (cli, roots, name) => {
  const first = run(cli, ['first-run', '--json', ...argsOf(roots)])
  if (!['READY', 'OK'].includes(first.json?.status)) throw new Error(`${name} first-run failed: ${JSON.stringify(first.json).slice(0, 300)}`)
  const consolePort = await freePort(); let apiPort = await freePort(); if (apiPort === consolePort) apiPort = await freePort()
  const outFd = openSync(join(root, `${name}.out.log`), 'w', 0o600); const errFd = openSync(join(root, `${name}.err.log`), 'w', 0o600)
  const child = spawn(cli, ['start', '--fixture', '--port', String(consolePort), '--api-port', String(apiPort), ...argsOf(roots)], { cwd: roots.install, stdio: ['ignore', outFd, errFd], detached: true })
  child.unref(); closeSync(outFd); closeSync(errFd); started.add(child.pid)
  const health = await waitHealth(apiPort)
  if (health === null) throw new Error(`${name} did not become healthy`)
  const stop = run(cli, ['stop', '--json', ...argsOf(roots)], 60_000)
  if (stop.json?.status !== 'STOPPED') throw new Error(`${name} stop failed: ${JSON.stringify(stop.json).slice(0, 300)}`)
  started.delete(child.pid)
  return health
}
try {
  if (values.install === undefined) throw new Error('--install <frozen install> is required')
  const install = resolve(values.install)
  const cli = join(install, 'bin', 'pa')
  const manifest = JSON.parse(readFileSync(join(install, 'install.json'), 'utf8'))
  const storage = await import(pathToFileURL(join(install, 'app/packages/storage/dist/index.js')).href)
  const runtimeModule = await import(pathToFileURL(join(repo, 'apps/coordinator/product/runtime.ts')).href)
  const coreModule = await import(pathToFileURL(join(install, 'app/packages/orchestrator-core/dist/index.js')).href)
  const requireStorage = createRequire(join(install, 'app/packages/storage/package.json'))
  const Database = requireStorage('better-sqlite3')
  const currentSchema = Number(storage.PRODUCT_SCHEMA_VERSION)
  step('install-identity', 'PASS', { buildId: manifest.buildId, commit: manifest.source.commit, dirty: manifest.source.dirty, schema: manifest.producer.productSchema, aSchema: currentSchema })

  const roots = rootsAt('live18', install)
  await startStop(cli, roots, 'live18')
  const databasePath = join(roots.data, 'state.sqlite')
  if (storage.verifyDatabase(databasePath).productSchema !== currentSchema) throw new Error('initialized state is not the current schema')

  // Real product operations: append a trusted source message, prepare and send selected context with
  // a bounded in-process fixture provider, then let the real effects finish the reply.
  const principal = { userId: 'wave12-d', authorityRef: 'wave12-d-authority' }
  const actor = { ...principal, source: 'local_cli' }
  const projectId = 'wave12-d-project'
  const conversationId = 'wave12-d-conversation'
  const scope = { projectId, allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
  const projectRoot = join(root, 'project'); mkdirSync(join(projectRoot, 'src'), { recursive: true, mode: 0o700 })
  const now = new Date().toISOString()
  let store = new storage.ProductStore({ path: databasePath })
  const stateRoot = roots.data
  const provider = {
    status: () => ({ protocol: 'assistant-provider/1', configured: true, baseURL: 'https://fixture.invalid/v1', model: 'mock-context', models: ['mock-context'], state: 'configured', secureTransport: true }),
    selectModel: () => ({ protocol: 'assistant-provider/1', configured: true, baseURL: 'https://fixture.invalid/v1', model: 'mock-context', models: ['mock-context'], state: 'configured', secureTransport: true }),
    reply: async () => ({ text: 'Wave-12 bounded fixture reply.', model: 'mock-context' }),
  }
  store.product.messages.append({ id: 'wave12-source', conversationId, projectId, role: 'user', provenance: 'trusted_user', text: 'SOURCE: keep the current behavior.', sourceRefs: [], createdAt: now })
  const product = runtimeModule.createProductRuntime({ store, principal, stateRoot, scratchProject: projectRoot,
    projects: [{ id: projectId, displayName: 'Wave 12 project', scope }], actionSecret: Buffer.alloc(32, 12), assistantProvider: provider, now: () => now })
  const prepared = await product.operations.assistantContextPrepare({
    commandId: 'wave12-context-message', text: 'Explain the source constraints.',
    context: { projectId, conversationId, selections: ['conversation', 'project'], budget: { maxFiles: 24, maxBytes: 65536, maxTokens: 16384 } },
  }, actor)
  const receipt = await product.operations.assistantContextSend({ commandId: prepared.commandId, token: prepared.token }, actor)
  if (receipt.status !== 'recorded') throw new Error(`context send was not recorded: ${JSON.stringify(receipt).slice(0, 300)}`)
  product.execution.effects.start(); product.execution.effects.kick()
  await product.execution.effects.idle('application.assistant.reply')
  const messageId = coreModule.key('message', prepared.commandId)
  const requestId = coreModule.key('assistant-request', messageId)
  const reply = store.workflows.assistant.replyResults.forRequest(requestId)
  const history = store.workflows.assistant.contextHistory.page({ projectIds: [projectId], workId: undefined })
  if (reply === undefined) throw new Error(`no completed reply result was persisted for ${requestId}`)
  if (reply.textDigest.length !== 64 || reply.artifactDigest.length !== 64) throw new Error('reply result digests are not bare hex')
  if (!history.records.some((record) => record.messageId === messageId)) throw new Error('the sent message has no context binding in A history')
  // Consume main's current history and frozen-source readers through the public product read port,
  // not by reading A tables directly.
  const historyRead = await product.read.contextHistory({ projectId })
  const historyEntries = historyRead.entries ?? historyRead.records ?? []
  if (!historyEntries.some((entry) => (entry.messageId ?? entry.record?.messageId) === messageId)) throw new Error('main context history did not expose the sent message')
  const sourcesRead = await product.read.contextSources(messageId)
  if (sourcesRead === undefined || sourcesRead === null) throw new Error('main frozen-source reader returned no audit for the sent message')
  // Nonempty suggestion generation through main's candidate reader is NOT_TESTED in this fixture:
  // it requires main/C's verified completed body plus proposal scope, which this isolated data recipe
  // does not create. The source-confirmation recipe consumes the real e32 HTTP path separately.
  const replySnapshot = { requestId, replyMessageId: reply.replyMessageId, sourceMessageId: reply.sourceMessageId, textDigest: reply.textDigest, artifactDigest: reply.artifactDigest, model: reply.model }
  await product.close(); store.close()

  // Reopen through the public Store: the result is durable, not an in-memory fallback.
  store = new storage.ProductStore({ path: databasePath })
  const reopenedReply = store.workflows.assistant.replyResults.forRequest(requestId)
  if (reopenedReply === undefined || reopenedReply.textDigest !== replySnapshot.textDigest) throw new Error('the reply result did not survive a Store reopen')

  const evidenceSummary = storage.readWorkflowEvidence(databasePath)
  const families = Object.fromEntries(evidenceSummary.families.map((family) => [family.name, family.count]))
  if ((families.assistant_context_bindings ?? 0) < 1) throw new Error('the context binding family is empty in A backup evidence')
  if ((families.assistant_reply_results ?? 0) < 1) throw new Error('the reply result family is empty in A backup evidence')
  step('nonempty-product-data', 'PASS', { requestId, messageId, replyMessageId: replySnapshot.replyMessageId, historyEntries: historyEntries.length, sources: Array.isArray(sourcesRead?.sources) ? sourcesRead.sources.length : 'present', families: { assistant_context_bindings: families.assistant_context_bindings, assistant_reply_results: families.assistant_reply_results }, replyDurableAfterReopen: true })

  // A public snapshot backup, new-root restore copy, then A readers on the restored file.
  const snapshot = join(root, 'backup', 'state.sqlite')
  const db = new Database(databasePath)
  let backup
  try { backup = await storage.backupDatabase(db, snapshot) } finally { db.close() }
  if (backup.integrity !== 'ok' || backup.productSchema !== currentSchema) throw new Error(`A snapshot did not verify: ${JSON.stringify(backup)}`)
  const restoredRoot = join(root, 'restored18'); mkdirSync(restoredRoot, { recursive: true, mode: 0o700 })
  copyFileSync(snapshot, join(restoredRoot, 'state.sqlite'))
  // A product restore keeps the private artifact bytes beside the state DB; a DB-only copy would make
  // frozen-source audits unavailable. Only the same private roots are copied, never queues/credentials.
  if (existsSync(join(roots.data, 'artifacts'))) cpSync(join(roots.data, 'artifacts'), join(restoredRoot, 'artifacts'), { recursive: true })
  const restoredStore = new storage.ProductStore({ path: join(restoredRoot, 'state.sqlite') })
  const restoredReply = restoredStore.workflows.assistant.replyResults.forRequest(requestId)
  const restoredHistory = restoredStore.workflows.assistant.contextHistory.page({ projectIds: [projectId] })
  const restoredEvidence = storage.readWorkflowEvidence(join(restoredRoot, 'state.sqlite'))
  if (restoredReply === undefined || restoredReply.textDigest !== replySnapshot.textDigest || restoredReply.artifactDigest !== replySnapshot.artifactDigest)
    throw new Error('the restored snapshot lost or changed the completed reply')
  if (!restoredHistory.records.some((record) => record.messageId === messageId)) throw new Error('the restored snapshot lost the context binding')
  if (restoredEvidence.digest !== evidenceSummary.digest) throw new Error('the restored A evidence digest differs from the source')
  // The restored bytes must feed the same main read ports (history + frozen sources), proving the
  // snapshot keeps current product data rather than only raw tables.
  const restoredProduct = runtimeModule.createProductRuntime({ store: restoredStore, principal, stateRoot: restoredRoot, scratchProject: projectRoot,
    projects: [{ id: projectId, displayName: 'Wave 12 project', scope }], actionSecret: Buffer.alloc(32, 12), assistantProvider: provider, now: () => now })
  const restoredHistoryRead = await restoredProduct.read.contextHistory({ projectId })
  const restoredEntries = restoredHistoryRead.entries ?? restoredHistoryRead.records ?? []
  if (!restoredEntries.some((entry) => (entry.messageId ?? entry.record?.messageId) === messageId)) throw new Error('main context history lost the binding after restore')
  const restoredSources = await restoredProduct.read.contextSources(messageId)
  if (restoredSources === undefined || restoredSources === null) throw new Error('main frozen-source reader lost the audit after restore')
  await restoredProduct.close()
  restoredStore.close()
  step('snapshot-new-root-restore', 'PASS', { backupBytes: backup.bytes, restoredReply: true, restoredBinding: true, restoredHistory: restoredEntries.length, restoredSources: Array.isArray(restoredSources?.sources) ? restoredSources.sources.length : 'present', evidenceDigest: restoredEvidence.digest, startupAvailable: false, noInstanceRecord: !existsSync(join(restoredRoot, 'instance.json')) })

  // Future schema (A public applyMigrations fixture) is refused by the current binary.
  const futurePath = join(root, 'future18', 'state.sqlite'); mkdirSync(join(root, 'future18'), { recursive: true, mode: 0o700 })
  copyFileSync(databasePath, futurePath)
  const futureDb = new Database(futurePath)
  try { storage.applyMigrations(futureDb, { registry: [...storage.MIGRATIONS, { version: currentSchema + 1, name: 'probe_future_wave12', statements: [] }] }) } finally { futureDb.close() }
  const futureRoots = rootsAt('future18-run', install)
  copyFileSync(futurePath, join(futureRoots.data, 'state.sqlite'))
  run(cli, ['first-run', '--json', ...argsOf(futureRoots)])
  const futureStart = run(cli, ['start', '--json', '--fixture', '--port', String(await freePort()), '--api-port', String(await freePort()), ...argsOf(futureRoots)])
  if (futureStart.json?.code !== 'state_schema_newer_than_binary') throw new Error(`future schema was not refused exactly: ${JSON.stringify(futureStart.json).slice(0, 300)}`)
  step('future-schema-refused', 'PASS', { code: futureStart.json.code })

  // schema16 artifact -> current through A's public Store migration (no SQL by D).
  if (values['legacy-install'] === undefined) step('schema16-to-current', 'NOT_TESTED', { reason: 'no --legacy-install provided' })
  else {
    const legacyInstall = resolve(values['legacy-install'])
    const legacyRoots = rootsAt('legacy16', legacyInstall)
    await startStop(join(legacyInstall, 'bin', 'pa'), legacyRoots, 'legacy16')
    const before = storage.verifyDatabase(join(legacyRoots.data, 'state.sqlite')).productSchema
    const migratedRoot = join(root, 'migrated18'); mkdirSync(migratedRoot, { recursive: true, mode: 0o700 })
    copyFileSync(join(legacyRoots.data, 'state.sqlite'), join(migratedRoot, 'state.sqlite'))
    const migratedStore = new storage.ProductStore({ path: join(migratedRoot, 'state.sqlite') })
    migratedStore.close()
    const after = storage.verifyDatabase(join(migratedRoot, 'state.sqlite'))
    if (before !== 16 || after.productSchema !== currentSchema || after.integrity !== 'ok') throw new Error(`schema16 migration failed: ${before} -> ${after.productSchema}`)
    step('schema16-to-current', 'PASS', { before, after: after.productSchema, migratedBy: 'A ProductStore public open' })
  }

  evidence.status = 'PASS'
  evidence.artifact = { install, buildId: manifest.buildId, commit: manifest.source.commit, schema: currentSchema, dirty: manifest.source.dirty }
} catch (error) {
  evidence.status = 'FAIL'
  evidence.error = String(error?.stack ?? error)
} finally {
  for (const pid of started) { try { process.kill(pid, 'SIGTERM') } catch { /* gone */ } }
  evidence.finishedAt = new Date().toISOString()
  rmSync(root, { recursive: true, force: true })
}
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
process.exitCode = evidence.status === 'PASS' ? 0 : 1
