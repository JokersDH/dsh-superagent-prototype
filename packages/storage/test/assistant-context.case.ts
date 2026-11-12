import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import type { AssistantContextBinding } from '@personal-agent/contracts'
import { ProductStore, WorkflowConflict } from '../src/index.ts'
import { makeStore, tempDir, withStore } from './helpers.ts'

const digest = (seed: string): string => seed.repeat(64).slice(0, 64)
const binding = (overrides: Partial<AssistantContextBinding> = {}): AssistantContextBinding => ({
  protocol: 'assistant-context-binding/1',
  commandId: 'cmd-1', messageId: 'msg-1', requestId: 'req-1',
  projectId: 'proj-1', conversationId: 'conv-1', userTextDigest: digest('a'),
  principal: { userId: 'user-1', authorityRef: 'auth-1' },
  purpose: 'conversation_discussion',
  scope: { projectId: 'proj-1', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] },
  selections: ['conversation'],
  bundleRef: 'artifact-placeholder', bundleDigest: digest('b'),
  sources: [{ sourceId: 'src-1', kind: 'conversation_message', sourceDigest: digest('c'), previewDigest: digest('d'), truncated: false }],
  confirmedAt: '2026-11-11T00:00:00.000Z', expiresAt: '2026-11-11T00:04:00.000Z',
  ...overrides,
})

/** Writes the bundle artifact row and returns the binding that names it. */
const withBundle = (store: ProductStore, overrides: Partial<AssistantContextBinding> = {}): AssistantContextBinding => {
  const written = store.artifacts.write(new TextEncoder().encode('{"bounded":true}'))
  store.artifacts.insert(written)
  return binding({ bundleRef: written.id, bundleDigest: written.digest, ...overrides })
}

test('a context binding is readable by message and command and survives a real close/reopen', async () => {
  const dir = tempDir('storage-context-')
  try {
    const first = makeStore(dir)
    const input = withBundle(first.store)
    assert.deepEqual(first.store.workflows.assistant.contextBindings.put(input), { binding: input, replayed: false })
    assert.deepEqual(first.store.workflows.assistant.contextBindings.forMessage('msg-1'), input)
    assert.deepEqual(first.store.workflows.assistant.contextBindings.forCommand('cmd-1'), input)
    first.store.close()
    const reopened = new ProductStore({ path: join(dir, 'product.sqlite') })
    try {
      assert.deepEqual(reopened.workflows.assistant.contextBindings.forCommand('cmd-1'), input)
      assert.equal(reopened.workflows.assistant.contextBindings.forMessage('msg-1')?.userTextDigest, digest('a'))
    } finally { reopened.close() }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('the same identity and body replays once without a second row', async () => {
  await withStore(async ({ store }) => {
    const input = withBundle(store)
    const bindings = store.workflows.assistant.contextBindings
    assert.equal(bindings.put(input).replayed, false)
    assert.deepEqual(bindings.put(input), { binding: input, replayed: true })
    assert.deepEqual(bindings.put(input), { binding: input, replayed: true })
    const count = store.db.prepare('SELECT COUNT(*) AS n FROM assistant_context_bindings').get() as { n: number }
    assert.equal(count.n, 1)
  })
})

test('a changed body conflicts for the same message and for the same command', async () => {
  await withStore(async ({ store }) => {
    const input = withBundle(store)
    const bindings = store.workflows.assistant.contextBindings
    bindings.put(input)
    const other = withBundle(store, { messageId: 'msg-2', bundleDigest: digest('e') })
    assert.throws(() => bindings.put({ ...other, commandId: input.commandId }), (error: unknown) => error instanceof WorkflowConflict)
    assert.throws(() => bindings.put({ ...input, messageId: 'msg-3' }), (error: unknown) => error instanceof WorkflowConflict)
    assert.equal(bindings.forMessage('msg-2'), undefined)
    assert.equal(bindings.forMessage('msg-3'), undefined)
  })
})

test('the shared schema rejects inconsistent scope, freshness and bundle references before writing', async () => {
  await withStore(async ({ store }) => {
    const input = withBundle(store)
    const bindings = store.workflows.assistant.contextBindings
    assert.throws(() => bindings.put({ ...input, scope: { ...input.scope, projectId: 'proj-2' } }), WorkflowConflict)
    assert.throws(() => bindings.put({ ...input, expiresAt: input.confirmedAt }), WorkflowConflict)
    assert.throws(() => bindings.put({ ...input, bundleRef: 'missing', bundleDigest: digest('f') }), WorkflowConflict)
    const other = store.artifacts.write(new TextEncoder().encode('{"other":true}'))
    store.artifacts.insert(other)
    assert.throws(() => bindings.put({ ...input, bundleRef: other.id }), WorkflowConflict)
    const count = store.db.prepare('SELECT COUNT(*) AS n FROM assistant_context_bindings').get() as { n: number }
    assert.equal(count.n, 0)
  })
})

test('a failed outer receipt rolls back the binding and its bundle row together', async () => {
  await withStore(async ({ store }) => {
    const written = store.artifacts.write(new TextEncoder().encode('{"bounded":true}'))
    const input = binding({ bundleRef: written.id, bundleDigest: written.digest })
    assert.throws(() => store.commands.record('cmd-1', digest('a'), () => {
      store.artifacts.insert(written)
      store.workflows.assistant.contextBindings.put(input)
      throw new Error('receipt rendering failed after the binding write')
    }), /receipt rendering failed/)
    assert.equal(store.workflows.assistant.contextBindings.forCommand('cmd-1'), undefined)
    const artifact = store.db.prepare('SELECT 1 AS present FROM artifacts WHERE id = ?').get(written.id) as { present: number } | undefined
    assert.equal(artifact, undefined)
  })
})

test('a committed receipt keeps the binding and a replay does not duplicate it', async () => {
  await withStore(async ({ store }) => {
    const written = store.artifacts.write(new TextEncoder().encode('{"bounded":true}'))
    const input = binding({ bundleRef: written.id, bundleDigest: written.digest })
    const apply = () => {
      store.artifacts.insert(written)
      return store.workflows.assistant.contextBindings.put(input)
    }
    const first = store.commands.record('cmd-1', digest('a'), apply)
    assert.equal(first.replayed, false)
    const replay = store.commands.record('cmd-1', digest('a'), () => { throw new Error('replay must not re-apply') })
    assert.equal(replay.replayed, true)
    const count = store.db.prepare('SELECT COUNT(*) AS n FROM assistant_context_bindings').get() as { n: number }
    assert.equal(count.n, 1)
    assert.deepEqual(store.workflows.assistant.contextBindings.forMessage('msg-1'), input)
  })
})

test('a tampered row is refused on read instead of returning a forged binding', async () => {
  await withStore(async ({ store }) => {
    const input = withBundle(store)
    store.workflows.assistant.contextBindings.put(input)
    store.db.prepare("UPDATE assistant_context_bindings SET bundle_digest = ? WHERE message_id = 'msg-1'").run(digest('9'))
    assert.throws(() => store.workflows.assistant.contextBindings.forMessage('msg-1'), WorkflowConflict)
  })
})

test('a v15 database upgrades append-only to v16 with its prior rows intact', async () => {
  const dir = tempDir('storage-context-upgrade-')
  try {
    const path = join(dir, 'product.sqlite')
    const v15 = new (await import('better-sqlite3')).default(path)
    v15.exec('PRAGMA journal_mode = WAL')
    const { applyMigrations, MIGRATIONS, PRODUCT_SCHEMA_VERSION } = await import('../src/index.ts')
    applyMigrations(v15, { registry: MIGRATIONS.filter(migration => migration.version <= 15) })
    v15.prepare("INSERT INTO project_settings_versions (project_id, revision, display_name, path_digest, check_kind, environment, source_ref, value, digest, created_at) VALUES ('proj-1', 1, NULL, 'p', 'none', NULL, 's', '{\"theme\":\"a\"}', 'd', '2026-11-10T00:00:00.000Z')").run()
    v15.close()
    const upgraded = new ProductStore({ path })
    try {
      assert.equal(upgraded.database.productSchema, PRODUCT_SCHEMA_VERSION)
      assert.equal(PRODUCT_SCHEMA_VERSION, 18)
      const legacy = upgraded.db.prepare("SELECT COUNT(*) AS n FROM project_settings_versions WHERE project_id = 'proj-1'").get() as { n: number }
      assert.equal(legacy.n, 1, 'pre-existing v15 rows survive the append-only upgrade')
      assert.equal(upgraded.workflows.assistant.contextBindings.forMessage('msg-1'), undefined)
      assert.ok(withBundle(upgraded))
      assert.deepEqual(upgraded.database.checkIntegrity(), { integrity: 'ok', foreignKeyViolations: 0 })
    } finally { upgraded.close() }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a lost response replays the recorded command and never re-applies the binding', async () => {
  const dir = tempDir('storage-context-lost-')
  try {
    const path = join(dir, 'product.sqlite')
    const first = new ProductStore({ path })
    const written = first.artifacts.write(new TextEncoder().encode('{"bounded":true}'))
    const input = binding({ bundleRef: written.id, bundleDigest: written.digest })
    first.commands.record('cmd-1', digest('a'), () => {
      first.artifacts.insert(written)
      return first.workflows.assistant.contextBindings.put(input)
    })
    first.close()
    const reopened = new ProductStore({ path })
    try {
      const receipt = reopened.commands.get('cmd-1')
      assert.equal(receipt?.payloadDigest, digest('a'))
      const replay = reopened.commands.record('cmd-1', digest('a'), () => { throw new Error('must not re-apply') })
      assert.equal(replay.replayed, true)
      assert.equal(reopened.workflows.assistant.contextBindings.forCommand('cmd-1')?.bundleRef, written.id)
      assert.throws(() => reopened.commands.record('cmd-1', digest('b'), () => undefined))
    } finally { reopened.close() }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a bounded batch of bindings commits within a small real-SQLite budget', async () => {
  await withStore(async ({ store }) => {
    const written = store.artifacts.write(new TextEncoder().encode('{"bounded":true}'))
    store.artifacts.insert(written)
    const started = performance.now()
    store.uow.atomic(() => {
      for (let index = 0; index < 500; index += 1) {
        store.workflows.assistant.contextBindings.put(binding({
          commandId: `cmd-${index}`, messageId: `msg-${index}`, requestId: `req-${index}`,
          bundleRef: written.id, bundleDigest: written.digest,
        }))
      }
    })
    const elapsed = performance.now() - started
    const count = store.db.prepare('SELECT COUNT(*) AS n FROM assistant_context_bindings').get() as { n: number }
    assert.equal(count.n, 500)
    assert.ok(elapsed < 5000, `500 synchronous bindings took ${elapsed.toFixed(1)}ms`)
    assert.deepEqual(store.database.checkIntegrity(), { integrity: 'ok', foreignKeyViolations: 0 })
  })
})

test('a v16 binding database upgrades append-only to v17/v18 and keeps its rows readable', async () => {
  const dir = tempDir('storage-context-v16-')
  try {
    const path = join(dir, 'product.sqlite')
    const Database = (await import('better-sqlite3')).default
    const { applyMigrations, MIGRATIONS, PRODUCT_SCHEMA_VERSION } = await import('../src/index.ts')
    const { canonicalDigest } = await import('@personal-agent/contracts/canonical')
    const legacy = new Database(path)
    legacy.exec('PRAGMA journal_mode = WAL')
    applyMigrations(legacy, { registry: MIGRATIONS.filter(migration => migration.version <= 16) })
    const value = {
      protocol: 'assistant-context-binding/1', commandId: 'old-command', messageId: 'old-message', requestId: 'old-request',
      projectId: 'proj-1', conversationId: 'conv-1', userTextDigest: digest('a'),
      principal: { userId: 'user-1', authorityRef: 'auth-1' }, purpose: 'conversation_discussion',
      scope: { projectId: 'proj-1', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] },
      selections: ['conversation'], bundleRef: 'old-artifact', bundleDigest: digest('b'),
      sources: [{ sourceId: 'old-source', kind: 'conversation_message', sourceDigest: digest('c'), previewDigest: digest('d'), truncated: false }],
      confirmedAt: '2026-11-11T00:00:00.000Z', expiresAt: '2026-11-11T00:04:00.000Z',
    }
    const valueDigest = canonicalDigest(JSON.parse(JSON.stringify(value)))
    legacy.prepare("INSERT INTO artifacts (id, digest, bytes, path, created_at) VALUES ('old-artifact', ?, 1, 'artifacts/old', ?)")
      .run(digest('b'), value.confirmedAt)
    legacy.prepare(`INSERT INTO assistant_context_bindings
      (message_id, command_id, request_id, project_id, conversation_id, user_text_digest, principal_user_id,
       principal_authority_ref, bundle_ref, bundle_digest, confirmed_at, expires_at, value, digest)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      value.messageId, value.commandId, value.requestId, value.projectId, value.conversationId, value.userTextDigest,
      value.principal.userId, value.principal.authorityRef, value.bundleRef, value.bundleDigest,
      value.confirmedAt, value.expiresAt, JSON.stringify(value), valueDigest,
    )
    legacy.prepare("INSERT INTO command_receipts (command_id, payload_digest, status, seq, result, recorded_at) VALUES ('old-command', ?, 'recorded', 1, 'null', ?)")
      .run(digest('a'), value.confirmedAt)
    legacy.close()

    const upgraded = new ProductStore({ path })
    try {
      assert.equal(upgraded.database.productSchema, PRODUCT_SCHEMA_VERSION)
      assert.deepEqual(upgraded.workflows.assistant.contextBindings.forMessage('old-message'), value)
      assert.deepEqual(upgraded.workflows.assistant.contextBindings.forCommand('old-command'), value)
      assert.equal(upgraded.commands.get('old-command')?.payloadDigest, digest('a'))
      assert.equal(upgraded.workflows.assistant.contextHistory.page({ projectIds: ['proj-1'] }).records[0]?.messageId, 'old-message')
      assert.equal(upgraded.workflows.assistant.replyResults.forRequest('old-request'), undefined)
      assert.deepEqual(upgraded.database.checkIntegrity(), { integrity: 'ok', foreignKeyViolations: 0 })
    } finally { upgraded.close() }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a future schema is refused instead of silently migrated by the store', async () => {
  const dir = tempDir('storage-context-future-')
  try {
    const path = join(dir, 'product.sqlite')
    const created = makeStore(dir)
    created.store.db.prepare("UPDATE schema_meta SET value = '99' WHERE key = 'product_schema'").run()
    const migrations = JSON.parse(String((created.store.db.prepare("SELECT value FROM schema_meta WHERE key = 'migrations'").get() as { value: string }).value))
    migrations.push({ version: 99, name: 'future-v99', checksum: 'x', appliedAt: '2026-11-12T00:00:00.000Z' })
    created.store.db.prepare("UPDATE schema_meta SET value = ? WHERE key = 'migrations'").run(JSON.stringify(migrations))
    created.store.close()
    assert.throws(() => new ProductStore({ path }), /newer than this build|not registered|gap at version 99/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
