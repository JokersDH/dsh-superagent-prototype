/**
 * Fixture adapter contract tests: the development scenario is schema-valid, commands replay by ID,
 * CAS/expiry refusals are receipts, delivery status stays local until the native path says otherwise,
 * SSE replay/exhaustion behave, and page-session persistence restores the conversation.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CommandReceiptSchema, ConversationPageSchema, SnapshotSchema, UserCommandSchema } from '@personal-agent/contracts'
import type { UserCommand } from '@personal-agent/contracts'
import { FixtureAdapter } from '../src/fixture.ts'
import { TransportError } from '../src/transport.ts'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
  get length(): number { return this.values.size }
  clear(): void { this.values.clear() }
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null }
  removeItem(key: string): void { this.values.delete(key) }
  setItem(key: string, value: string): void { this.values.set(key, value) }
}

const chat: UserCommand = { commandId: 'cmd-chat-1', conversationId: 'conv-main', kind: 'chat', text: '继续补充重试约束。', projectId: 'project-atlas' }
const snapshotOf = async (adapter: FixtureAdapter) => SnapshotSchema.parse(await adapter.snapshot({ conversationId: 'conv-main', limit: 100 }))

test('the seeded fixture snapshot and every command receipt are schema-valid', async () => {
  const adapter = new FixtureAdapter(new MemoryStorage())
  const snapshot = await snapshotOf(adapter)
  assert.equal(snapshot.works.length, 5)
  assert.equal(snapshot.questions.length, 5)
  assert.equal(snapshot.conversation?.messages.length, 4)
  assert.ok(snapshot.works.some(work => work.work.id === 'work-gamma' && work.resourceStatus === 'indeterminate'))
  assert.equal(UserCommandSchema.safeParse(chat).success, true)
  const receipt = CommandReceiptSchema.parse(await adapter.dispatch(chat))
  assert.equal(receipt.status, 'recorded')
})

test('command IDs replay by body: the same body returns the original receipt, another body conflicts', async () => {
  const adapter = new FixtureAdapter(new MemoryStorage())
  const first = await adapter.dispatch(chat)
  const replay = await adapter.dispatch(chat)
  assert.deepEqual(replay, first)
  const conflict = CommandReceiptSchema.parse(await adapter.dispatch({ ...chat, text: '不同正文' }))
  assert.equal(conflict.status, 'rejected')
  assert.equal(conflict.status === 'rejected' ? conflict.error.code : '', 'conflict')
})

test('a question answer records local deliveries per target and never claims native application', async () => {
  const adapter = new FixtureAdapter(new MemoryStorage())
  const snapshot = await snapshotOf(adapter)
  const question = snapshot.questions.find(item => item.id === 'q-choice')!
  const answer: UserCommand = {
    commandId: 'cmd-answer-1', conversationId: 'conv-main', kind: 'answer_question', questionId: question.id,
    expectedVersion: question.version, answer: { kind: 'choices', optionIds: ['opt-backoff'] },
  }
  assert.equal((await adapter.dispatch(answer)).status, 'recorded')
  const deliveries = await adapter.deliveries(question.id)
  assert.deepEqual(deliveries.map(item => item.status), ['local_recorded'])
  const after = await snapshotOf(adapter)
  assert.equal(after.questions.some(item => item.id === question.id), false, 'the answered question leaves the open list')
  const stale = CommandReceiptSchema.parse(await adapter.dispatch({ ...answer, commandId: 'cmd-answer-2' }))
  assert.equal(stale.status === 'rejected' ? stale.error.code : '', 'question_expired')
})

test('dispatch-hold CAS and stale-candidate acceptance are explicit rejected receipts', async () => {
  const adapter = new FixtureAdapter(new MemoryStorage())
  const snapshot = await snapshotOf(adapter)
  const alpha = snapshot.works.find(work => work.work.id === 'work-alpha')!
  const pause: UserCommand = {
    commandId: 'cmd-pause-1', conversationId: 'conv-main', kind: 'pause_dispatch', expected: alpha.contract,
    expectedHoldRevision: alpha.actions.dispatchHold.revision,
  }
  assert.equal((await adapter.dispatch(pause)).status, 'recorded')
  const stalePause = CommandReceiptSchema.parse(await adapter.dispatch({ ...pause, commandId: 'cmd-pause-2' }))
  assert.equal(stalePause.status === 'rejected' ? stalePause.error.code : '', 'conflict')
  const updated = await snapshotOf(adapter)
  assert.equal(updated.works.find(work => work.work.id === 'work-alpha')!.actions.dispatchHold.paused, true)
  assert.deepEqual(updated.works.find(work => work.work.id === 'work-alpha')!.actions.available.includes('resume_dispatch'), true)

  const staleWork = snapshot.works.find(work => work.work.id === 'work-stale')!
  const accept: UserCommand = {
    commandId: 'cmd-accept-stale', conversationId: 'conv-main', kind: 'accept_candidate',
    candidate: staleWork.actions.currentCandidate!,
  }
  const refused = CommandReceiptSchema.parse(await adapter.dispatch(accept))
  assert.equal(refused.status === 'rejected' ? refused.error.code : '', 'stale_candidate')
  assert.equal((await snapshotOf(adapter)).works.find(work => work.work.id === 'work-stale')!.phase, 'verifying')

  const beta = snapshot.works.find(work => work.work.id === 'work-beta')!
  const accepted = CommandReceiptSchema.parse(await adapter.dispatch({
    commandId: 'cmd-accept-beta', conversationId: 'conv-main', kind: 'accept_candidate', candidate: beta.actions.currentCandidate!,
  }))
  assert.equal(accepted.status, 'recorded')
  assert.equal((await snapshotOf(adapter)).works.find(work => work.work.id === 'work-beta')!.phase, 'delivered')
})

test('stop reports stopping with an unknown writer, not a stopped result', async () => {
  const adapter = new FixtureAdapter(new MemoryStorage())
  const receipt = await adapter.dispatch({ commandId: 'cmd-stop-1', conversationId: 'conv-main', kind: 'stop_work', workId: 'work-alpha' })
  assert.equal(receipt.status, 'recorded')
  const work = (await snapshotOf(adapter)).works.find(item => item.work.id === 'work-alpha')!
  assert.equal(work.phase, 'stopping')
  assert.equal(work.resourceStatus, 'indeterminate')
  assert.deepEqual(work.actions.available, [])
})

test('the event stream replays after a cursor, emits new changes, and exposes cursor expiry', async () => {
  const adapter = new FixtureAdapter(new MemoryStorage())
  const before = (await snapshotOf(adapter)).cursor
  await adapter.dispatch(chat)
  const iterator = adapter.changes(before)[Symbol.asyncIterator]()
  const first = await iterator.next()
  assert.equal(first.done, false)
  assert.equal(first.value?.topic, 'conversation.message')
  await iterator.return?.()

  adapter.expireCursor()
  await assert.rejects(async () => {
    const expired = adapter.changes(before - 1)[Symbol.asyncIterator]()
    await expired.next()
  }, (error: unknown) => error instanceof TransportError && error.code === 'cursor_expired')
})

test('page-session fixture state survives a reload and model-offline still allows queries, answers and stops', async () => {
  const storage = new MemoryStorage()
  const first = new FixtureAdapter(storage)
  await first.dispatch(chat)
  const reloaded = new FixtureAdapter(storage)
  const snapshot = await snapshotOf(reloaded)
  assert.ok(snapshot.conversation?.messages.some(message => message.text === chat.text))

  reloaded.setModelOffline(true)
  const rejected = CommandReceiptSchema.parse(await reloaded.dispatch({ ...chat, commandId: 'cmd-chat-offline' }))
  assert.equal(rejected.status === 'rejected' ? rejected.error.code : '', 'unsupported_capability')
  assert.equal((await snapshotOf(reloaded)).works.length, 5, 'querying still works')
  const question = (await snapshotOf(reloaded)).questions.find(item => item.id === 'q-free')!
  assert.equal((await reloaded.dispatch({
    commandId: 'cmd-answer-offline', conversationId: 'conv-main', kind: 'answer_question', questionId: question.id,
    expectedVersion: question.version, answer: { kind: 'free_text', text: '离线仍可回答' },
  })).status, 'recorded')
  assert.equal((await reloaded.dispatch({ commandId: 'cmd-stop-offline', conversationId: 'conv-main', kind: 'stop_work', workId: 'work-long' })).status, 'recorded')
})

test('conversation pages are exclusive and ascending with a usable before cursor', async () => {
  const adapter = new FixtureAdapter(new MemoryStorage())
  const page = ConversationPageSchema.parse(await adapter.messages('conv-main', { limit: 2 }))
  assert.deepEqual(page.messages.map(message => message.sequence), [3, 4])
  assert.equal(page.hasMore, true)
  const older = ConversationPageSchema.parse(await adapter.messages('conv-main', { ...(page.beforeCursor !== undefined ? { before: page.beforeCursor } : {}), limit: 2 }))
  assert.deepEqual(older.messages.map(message => message.sequence), [1, 2])
  assert.equal(older.hasMore, false)
})
