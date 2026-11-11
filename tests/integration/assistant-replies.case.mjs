import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { ProductStore } from '../../packages/storage/dist/index.js'
import { createProductApplication } from '../../packages/application/dist/index.js'
import { Effects } from '../../packages/effects/dist/index.js'
import { handleAssistantReplies } from '../../apps/coordinator/product/assistant-replies.ts'
import { AssistantStreams } from '../../apps/coordinator/product/assistant-streams.ts'

const principal = { userId: 'local-user', authorityRef: 'local-authority' },
  actor = { ...principal, source: 'local_ui' }
const scope = { projectId: 'project-1', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
function fixture(t, reply) {
  const root = mkdtempSync('/tmp/pa-assistant-'),
    store = new ProductStore({ path: join(root, 'state.sqlite') })
  const app = createProductApplication({
    store,
    principal,
    projects: [{ id: scope.projectId, scope }],
    profileIds: ['profile-fixture'],
    registeredChecks: ['check-output'],
    actionSecret: Buffer.alloc(32, 1),
    nativeFence: () => 'unknown',
    assistantReplies: true,
  })
  let calls = 0,
    clock = 0
  const effects = new Effects(store.queue, undefined, () => clock)
  const provider = {
    status: () => ({ model: 'mock-model' }),
    reply: async (messages, onDelta, signal) => {
      calls++
      return reply(messages, onDelta, signal)
    },
  }
  const streams = new AssistantStreams()
  handleAssistantReplies(effects, store, provider, streams)
  effects.start()
  t.after(async () => {
    await effects.drain()
    store.close()
    rmSync(root, { recursive: true, force: true })
  })
  const chat = async (id, text, conversationId = 'conversation-1') => {
    const receipt = await app.dispatch({ commandId: id, conversationId, kind: 'chat', projectId: scope.projectId, text }, actor)
    // This direct consumer has no runtime polling loop; notify it after the command commits.
    effects.kick()
    return receipt
  }
  return {
    store,
    app,
    effects,
    streams,
    chat,
    get calls() {
      return calls
    },
    tick: () => {
      clock += 20000
    },
    messages: (id = 'conversation-1') => store.product.messages.page(id).messages,
  }
}
test('a real application chat stores one model reply, replays its receipt and never creates work', async (t) => {
  const h = fixture(t, async () => ({ text: '真实回复', model: 'mock-model' }))
  const first = await h.chat('chat-1', '你好')
  await h.effects.idle()
  assert.equal(h.calls, 1)
  assert.deepEqual(
    h.messages().map((message) => [message.role, message.provenance]),
    [
      ['user', 'trusted_user'],
      ['assistant', 'reasoner_reply'],
    ],
  )
  assert.equal(h.store.domain.tickets.list().length, 0)
  assert.deepEqual(await h.chat('chat-1', '你好'), first)
  await h.effects.idle()
  assert.equal(h.calls, 1)
})
test('each model request sees only its conversation and earlier user turn', async (t) => {
  const requests = []
  const h = fixture(t, async (messages) => {
    requests.push(messages)
    return { text: `reply-${requests.length}`, model: 'mock-model' }
  })
  await h.chat('foreign', '另一个对话的私有内容', 'other-conversation')
  await h.effects.idle()
  await h.chat('first', 'first')
  await h.chat('second', 'second')
  await h.effects.idle()
  assert.equal(
    requests[1].some((message) => message.content.includes('私有内容')),
    false,
  )
  assert.deepEqual(
    requests[2].slice(1).map((message) => message.content),
    ['first', 'reply-2', 'second'],
  )
})
test('provider errors become safe notices, without automatic network retry or raw secret text', async (t) => {
  const h = fixture(t, async () => {
    throw new Error('credential-secret-never-show')
  })
  await h.chat('failure', 'hello')
  await h.effects.idle()
  assert.equal(h.calls, 1)
  assert.equal(h.messages()[1].provenance, 'application_notice')
  assert.doesNotMatch(JSON.stringify(h.messages()), /credential-secret/)
  assert.equal(h.store.queue.dueRows('application.assistant.reply', Number.MAX_SAFE_INTEGER, 10).length, 0)
})
test('work delegation and anchored supplements are not ordinary model conversation context', async (t) => {
  const requests = []
  const h = fixture(t, async (messages) => {
    requests.push(messages)
    return { text: '需求计划', model: 'mock-model' }
  })
  const work = await h.app.dispatch(
    {
      commandId: 'work-command',
      conversationId: 'conversation-1',
      kind: 'create_work',
      projectId: scope.projectId,
      goal: 'Controlled browser work failing',
      scope,
      criteria: [
        {
          id: 'criterion-output',
          kind: 'machine',
          required: true,
          description: 'output check',
          checkDefinitionRef: 'check-output',
        },
      ],
      profileId: 'profile-fixture',
    },
    actor,
  )
  assert.equal(work.status, 'recorded')
  await h.app.dispatch(
    {
      commandId: 'supplement',
      conversationId: 'conversation-1',
      kind: 'chat',
      projectId: scope.projectId,
      text: '工作内部补充',
      anchor: { workId: work.workId },
    },
    actor,
  )
  await h.chat('ordinary', '拆解个人需求管理工具')
  await h.effects.idle()
  assert.deepEqual(
    requests[0].slice(1).map((message) => message.content),
    ['拆解个人需求管理工具'],
  )
})
test('a failed reply commit cannot charge a second model call when its effect is retried', async (t) => {
  const h = fixture(t, async () => ({ text: 'reply', model: 'mock-model' }))
  h.store.db.exec(
    "CREATE TRIGGER fail_assistant_message BEFORE INSERT ON conversation_messages WHEN json_extract(NEW.value, '$.role') = 'assistant' BEGIN SELECT RAISE(ABORT, 'injected response commit failure'); END",
  )
  await h.chat('commit-fail', 'hello')
  await h.effects.idle()
  assert.equal(h.calls, 1)
  h.store.db.exec('DROP TRIGGER fail_assistant_message')
  h.tick()
  await h.effects.idle()
  assert.equal(h.calls, 1)
  assert.equal(h.messages()[1].provenance, 'application_notice')
})
test('a failed application command receipt rolls the chat and model effect back together', async (t) => {
  const h = fixture(t, async () => ({ text: 'reply', model: 'mock-model' }))
  h.store.db.exec(
    "CREATE TRIGGER fail_chat_command BEFORE INSERT ON command_receipts BEGIN SELECT RAISE(ABORT, 'injected command failure'); END",
  )
  await assert.rejects(h.chat('rollback', 'hello'), /injected command failure/)
  await h.effects.idle()
  assert.equal(h.messages().length, 0)
  assert.equal(h.calls, 0)
})
test('stream snapshots recover an in-progress reply and final authority waits for the message commit', { timeout: 5000 }, async (t) => {
  let release, started
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const first = new Promise((resolve) => {
    started = resolve
  })
  t.after(() => release())
  const h = fixture(t, async (_messages, onDelta) => {
    onDelta('第一段')
    started()
    await gate
    onDelta('第二段')
    return { text: '第一段第二段', model: 'mock-model' }
  })
  await h.chat('stream-chat', 'hello')
  await first
  const abort = new AbortController()
  t.after(() => abort.abort())
  const iterator = h.streams.changes('conversation-1', abort.signal)[Symbol.asyncIterator]()
  const live = (await iterator.next()).value
  assert.equal(live.phase, 'streaming')
  assert.equal(live.text, '第一段')
  assert.equal(h.messages().filter((message) => message.role === 'assistant').length, 0)
  release()
  await h.effects.idle()
  const done = (await iterator.next()).value
  assert.equal(done.phase, 'complete')
  assert.equal(done.text, '第一段第二段')
  assert.equal(h.messages().find((message) => message.id === done.replyId).text, done.text)
  abort.abort()
  await iterator.return()
})
test('service close aborts in-progress model generation without another inference', { timeout: 5000 }, async (t) => {
  let started
  const first = new Promise((resolve) => {
    started = resolve
  })
  const h = fixture(t, async (_messages, onDelta, signal) => {
    onDelta('partial')
    started()
    await new Promise((_resolve, reject) =>
      signal.addEventListener('abort', () => reject(new Error('abort')), { once: true }),
    )
  })
  await h.chat('shutdown', 'hello')
  await first
  h.streams.close()
  await h.effects.idle()
  assert.equal(h.calls, 1)
  assert.equal(h.messages()[1].provenance, 'application_notice')
})
