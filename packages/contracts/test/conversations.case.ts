import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ConversationCatalogQuerySchema, ConversationCommandSchema, ConversationCatalogSchema } from '../src/index.ts'

test('catalog companion commands retain explicit scope, CAS and a server-owned actor', () => {
  const command = { kind: 'create_conversation', commandId: 'command-one', conversationId: 'conversation-one', projectId: 'project-one', title: '新对话' }
  assert.equal(ConversationCommandSchema.safeParse(command).success, true)
  for (const extra of [{ actor: { userId: 'forged' } }, { scope: { projectId: 'other' } }, { title: '  ' }, { projectId: undefined }])
    assert.equal(ConversationCommandSchema.safeParse({ ...command, ...extra }).success, false)
  assert.equal(ConversationCommandSchema.safeParse({ kind: 'rename_conversation', commandId: 'rename-one', conversationId: 'conversation-one', title: 'Title' }).success, false)
})

test('catalog query and paging reject unknown fields, unbounded reads and missing continuation', () => {
  assert.equal(ConversationCatalogQuerySchema.safeParse({ limit: 51 }).success, false)
  assert.equal(ConversationCatalogQuerySchema.safeParse({ actor: 'forged' }).success, false)
  assert.equal(ConversationCatalogQuerySchema.safeParse({ query: '  ' }).success, false)
  assert.equal(ConversationCatalogQuerySchema.safeParse({ cursor: 'raw\0private-id' }).success, false)
  assert.equal(ConversationCatalogSchema.safeParse({ protocol: 'conversation-catalog/1', conversations: [], hasMore: true }).success, false)
})
