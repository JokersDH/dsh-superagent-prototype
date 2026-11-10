import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ApplicationConversations } from '../src/index.ts'
import { actor, createCommand, fixture } from './helpers.ts'

test('catalog commands keep CAS, replay, actor and transaction boundaries across reopen', t => {
  const h = fixture(t)
  const make = () => new ApplicationConversations(h.store, actor, () => ['project-atlas'], Buffer.alloc(32, 1))
  let catalog = make()
  const create = { kind: 'create_conversation' as const, commandId: 'create-conversation', conversationId: 'catalog-one', projectId: 'project-atlas', title: '方案讨论' }
  const receipt = catalog.dispatch(create, actor)
  assert.equal(receipt.status, 'recorded')
  assert.deepEqual(catalog.dispatch(create, actor), receipt)
  assert.throws(() => catalog.dispatch({ ...create, title: 'Changed' }, actor))
  assert.throws(() => catalog.dispatch({ ...create, commandId: 'spoof' }, { ...actor, userId: 'other' }))
  const rename = catalog.dispatch({ kind: 'rename_conversation', commandId: 'rename-one', conversationId: 'catalog-one', expectedTitleRevision: 1, title: '设计终稿' }, actor)
  assert.equal(rename.status, 'recorded')
  assert.equal(catalog.dispatch({ kind: 'rename_conversation', commandId: 'rename-stale', conversationId: 'catalog-one', expectedTitleRevision: 1, title: 'Stale' }, actor).status, 'rejected')
  catalog.dispatch({ kind: 'archive_conversation', commandId: 'archive-one', conversationId: 'catalog-one', expectedArchiveRevision: 0, archived: true }, actor)
  assert.equal(catalog.list({}).conversations.length, 0)
  assert.equal(catalog.list({ includeArchived: true }).conversations[0]!.title, '设计终稿')
  assert.equal(h.store.product.messages.page('catalog-one').messages.length, 0)
  h.store.db.exec("CREATE TRIGGER reject_catalog_receipt BEFORE INSERT ON command_receipts WHEN NEW.command_id = 'rollback-title' BEGIN SELECT RAISE(ABORT, 'injected receipt failure'); END")
  assert.throws(() => catalog.dispatch({ kind: 'rename_conversation', commandId: 'rollback-title', conversationId: 'catalog-one', expectedTitleRevision: 2, title: 'Must roll back' }, actor))
  assert.equal(catalog.get('catalog-one').title, '设计终稿')
  h.store.db.exec('DROP TRIGGER reject_catalog_receipt')
  h.reopen()
  catalog = make()
  assert.deepEqual(catalog.dispatch(create, actor), receipt)
  assert.ok(catalog.get('catalog-one').archivedAt)
})

test('message-only legacy and mixed-project catalogs are scoped by all persisted messages', t => {
  const h = fixture(t)
  let allowed = ['project-atlas', 'project-other']
  const catalog = new ApplicationConversations(h.store, actor, () => allowed, Buffer.alloc(32, 1))
  h.store.workflows.conversations.create({ id: 'old-chat', title: '旧聊天' })
  h.store.product.messages.append({ id: 'old-message', conversationId: 'old-chat', role: 'user', provenance: 'trusted_user',
    projectId: 'project-atlas', text: '纯聊天迁移记录', sourceRefs: [], createdAt: '2026-11-08T10:00:00.000Z' })
  h.store.db.prepare('UPDATE conversations SET project_id = NULL WHERE id = ?').run('old-chat')
  assert.equal(h.store.workflows.conversations.list({ projectIds: ['project-atlas'] }).conversations.length, 0)
  assert.equal(catalog.list({ query: '迁移' }).conversations[0]!.id, 'old-chat')
  h.store.product.messages.append({ id: 'foreign-message', conversationId: 'old-chat', role: 'user', provenance: 'trusted_user',
    projectId: 'project-other', text: '另一个项目的数据', sourceRefs: [], createdAt: '2026-11-08T10:01:00.000Z' })
  assert.equal(catalog.list({ projectId: 'project-other' }).conversations.length, 1)
  allowed = ['project-atlas']
  assert.equal(catalog.list({ query: '数据' }).conversations.length, 0)
  assert.throws(() => catalog.get('old-chat'))
  assert.throws(() => catalog.list({ projectId: 'project-other' }))
  allowed = []
  assert.equal(catalog.list({}).conversations.length, 0, 'empty configured projects never become global visibility')
})

test('catalog paging is encrypted, query-bound, and keeps archived active work visible', async t => {
  const h = fixture(t)
  const catalog = new ApplicationConversations(h.store, actor, () => ['project-atlas'], Buffer.alloc(32, 1))
  for (let i = 0; i < 3; i++) catalog.dispatch({ kind: 'create_conversation', commandId: `catalog-${i}`, conversationId: `catalog-${i}`, projectId: 'project-atlas', title: `目录 ${i}` }, actor)
  const first = catalog.list({ limit: 1 })
  assert.equal(first.hasMore, true)
  assert.doesNotMatch(Buffer.from(first.nextCursor!, 'base64url').toString('utf8'), /catalog-[012]/)
  const second = catalog.list({ limit: 1, cursor: first.nextCursor! })
  assert.notEqual(first.conversations[0]!.id, second.conversations[0]!.id)
  assert.throws(() => catalog.list({ cursor: first.nextCursor!, query: '目录' }))
  const created = await h.app.dispatch(createCommand('active-catalog-work'), actor)
  catalog.dispatch({ kind: 'archive_conversation', commandId: 'archive-active', conversationId: 'conversation-main', expectedArchiveRevision: 0, archived: true }, actor)
  const active = catalog.list({}).conversations.find(value => value.id === 'conversation-main')
  assert.equal(active?.attention, true)
  assert.ok(active?.archivedAt)
  assert.equal((await h.app.inspect({ workId: created.workId! })).works[0]!.phase, 'queued')
})

test('placeholder title follows the first user message without overwriting an explicit rename', async t => {
  const h = fixture(t)
  const catalog = new ApplicationConversations(h.store, actor, () => ['project-atlas'], Buffer.alloc(32, 1))
  catalog.dispatch({ kind: 'create_conversation', commandId: 'placeholder', conversationId: 'catalog-one', projectId: 'project-atlas', title: '新对话' }, actor)
  await h.app.dispatch({ kind: 'chat', commandId: 'first-message', conversationId: 'catalog-one', projectId: 'project-atlas', text: '分析支付失败的原因' }, actor)
  assert.equal(catalog.get('catalog-one').title, '分析支付失败的原因')
  const current = catalog.get('catalog-one')
  catalog.dispatch({ kind: 'rename_conversation', commandId: 'explicit-title', conversationId: 'catalog-one', expectedTitleRevision: current.titleRevision, title: '支付方案' }, actor)
  await h.app.dispatch({ kind: 'chat', commandId: 'second-message', conversationId: 'catalog-one', projectId: 'project-atlas', text: '补充信息' }, actor)
  assert.equal(catalog.get('catalog-one').title, '支付方案')
})
